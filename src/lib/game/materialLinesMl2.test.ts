// ML-2 (0.14.0): the Material Lines recipe rework (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4
// "ML-2", L2 "Six economy/defense slots", L11 "Approve all three") combined with the recipe realism audit the user
// signed off (docs/plans/2026-10-21-recipe-realism-audit.md USER ANSWERS Groups A to D):
//   - every reworked recipe as approved (the four ML-2 amendments, the three wrong ground rows, the four odd ground
//     rows, the Power Coupling), the Reactor Cores' fuel still appended by withReactorFuel
//   - Biofiber (5 Fibrous Biomass, 20 ticks) and Resin Distillate (3 Volatile Resin, 20 ticks), each with consumers
//   - the standing rules: distinct input maps per slot, the no-wall walker, the realism guards (fabrics take Biofiber,
//     seals and agents take Resin Distillate, Purified Biomass stays food and medical, no strut in an implant; the
//     every-core-is-fueled guard lives in reactorTech.test.ts)
//   - in-flight safety: a job started on an old recipe completes off its stored effect; a standing line on a reworked
//     recipe waits for the new input (no throw, no negative bucket) and resumes when stocked
//   - the text fixes T1 to T8, and no Quartermaster kit price moved.

// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// FR-C lane 1 I3 (the lane join wired: startLine opens an order for a batch) came after every pin here: the file runs with
// it off (laneJoinSwitch.fixture.ts), so its pins keep proving their own slice; laneJoinWired.test.ts traces the move.
import { laneJoinOffForThisFile } from "./laneJoinSwitch.fixture";
laneJoinOffForThisFile();
import { GAS_CANISTER_IDS } from "./gasGiantContent";
import { describe, expect, it } from "vitest";
// FR-C R2-5 / R8-6 (the finite-work FA XP folded into lifetimeStats, the auto-salvage log stamp) came after every pin
// here: the file runs with them off (recapFoldsSwitch.fixture.ts), so its pins keep proving their own slice;
// faXpAwardedStat.test.ts and offlineRecapSections.test.ts pin the moves.
import { recapFoldsOffForThisFile } from "./recapFoldsSwitch.fixture";
recapFoldsOffForThisFile();
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  FIELD_KITS_HIDDEN_BLUEPRINTS,
  ITEMS,
  MISSIONS,
  REFINE_RECIPES,
  freshState,
  refineRecipeOffered,
  type GameState,
  type MissionKey,
} from "./model";
import { canDispatch, economyTick, startLine } from "./tick";
import { addItemQuality, itemTotal } from "./inventory";
import { reactorCoreFuel } from "./reactorTech";
import { FIELD_KIT_PRICES } from "./fieldKits";
import { WIRING_REGISTRY } from "./wiring/registry";
import { stateHash } from "./firstRunsGoldens.fixture";
import { ML2_GOLDEN, ML2_REWORKED, stockedFor, withPreMl2Recipes } from "./ml2RecipeGoldens.fixture";

// Every reworked recipe as approved (the Reactor Cores' OTHER inputs; their fuel is withReactorFuel's, appended last).
const APPROVED: Record<string, Record<string, number>> = {
  // audit call 8: silicon power electronics in a metal housing
  powerCouplingBp: { polysilicateWafer: 3, titaniumIngot: 1 },
  // ML-2 cargo (E-MAT 3c), the Prospector Hold as amended (audit call 5)
  prospectorHoldBp: { frameSegment: 2, titaniumIngot: 1, reclaimedAlloy: 2 },
  haulerHoldBp: { structuralAssembly: 1, ferriteIngot: 2, reclaimedAlloy: 2 },
  // ML-2 FTL (L11: the Sprint Drive and the Efficient Core differentiated)
  sprintDriveBp: { powerCoupling: 2, cobaltCoil: 2 },
  economyDriveBp: { powerCoupling: 2, reclaimedCircuit: 3 },
  // ML-2 reactor (L11: the Structural Assembly dropped from the High-Output Core)
  highOutputCoreBp: { powerCoupling: 3, iridiumCatalyst: 1, osmiumPlate: 1 },
  efficientCoreBp: { powerCoupling: 2, cobaltCoil: 1, reclaimedCircuit: 2 },
  // ML-2 utility
  surveyRigBp: { powerCoupling: 2, photonicGel: 2 },
  refineryFeedRigBp: { titaniumIngot: 2, biocatalyst: 2 },
  // ML-2 shields (the Capacitor Bank keeps today's recipe, audit call 5)
  rechargeArrayBp: { powerCoupling: 2, polysilicateWafer: 1, cobaltCoil: 2 },
  // ML-2 plating, Ablative and Composite as amended (audit call 5 + the Biofiber follow-up)
  reinforcedPlatingBp: { ferriteIngot: 2, titaniumIngot: 1, frameSegment: 1 },
  ablativePlatingBp: { frameSegment: 2, titaniumIngot: 1, biofiber: 2 },
  compositePlatingBp: { titaniumIngot: 1, frameSegment: 2, structuralAssembly: 1, osmiumPlate: 1, biofiber: 1 },
  // audit call 9 (Biofiber where a fabric belongs; seals take Resin Distillate)
  ballisticWeaveBp: { titaniumIngot: 1, polysilicateWafer: 1, biofiber: 2 },
  fieldSuitBp: { titaniumIngot: 1, polysilicateWafer: 2, biofiber: 1 },
  hazardSuitBp: { titaniumIngot: 3, polysilicateWafer: 2, resinDistillate: 1 },
  // audit call 7 (the Toxin Grenade takes Resin Distillate per the Group B follow-up)
  toxinGrenadeBp: { titaniumIngot: 1, powerCoupling: 1, resinDistillate: 1 },
  medKitBp: { polysilicateWafer: 1, titaniumIngot: 1, purifiedBiomass: 2 },
  // audit call 9
  atmoProbeBp: { polysilicateWafer: 2, powerCoupling: 1, titaniumIngot: 2 },
  // audit call 7
  archaeoScannerBp: { polysilicateWafer: 4, powerCoupling: 1 },
};

// Rows the audit kept as they are (call 5: the Capacitor Bank; call 10: the two weapon rows wait for 0.16.0; call 11:
// the Impact Grenade and the Combat Stim).
const KEPT: Record<string, Record<string, number>> = {
  capacitorBankBp: { powerCoupling: 3, polysilicateWafer: 3, structuralAssembly: 1 },
  plasmaBp: { polysilicateWafer: 2, powerCoupling: 2 },
  pointDefenseArrayBp: { polysilicateWafer: 3, powerCoupling: 1 },
  impactGrenadeBp: { titaniumIngot: 1, polysilicateWafer: 1, powerCoupling: 1 },
  combatStimBp: { volatileResin: 1, purifiedBiomass: 1 },
};

const inputsOf = (bp: string): Record<string, number> => (BLUEPRINTS[bp] ?? FIELD_KITS_HIDDEN_BLUEPRINTS[bp]).recipe.inputs;

function holdingAll(s: GameState, stock: Record<string, number>, times = 1): GameState {
  let inventory = s.inventory;
  for (const [id, n] of Object.entries(stock)) inventory = addItemQuality(inventory, id, new Decimal(n * times), 0);
  return { ...s, inventory };
}

function run(s0: GameState, ticks: number): GameState {
  let s = s0;
  for (let i = 0; i < ticks; i++) s = economyTick(s, 1, () => 0.99);
  return s;
}

describe("ML-2 recipes, as approved", () => {
  it("covers exactly the reworked set", () => {
    expect(Object.keys(APPROVED).sort()).toEqual([...ML2_REWORKED].sort());
  });

  it("every reworked recipe takes exactly its approved inputs (a Reactor Core's fuel still appended last)", () => {
    for (const [bp, want] of Object.entries(APPROVED)) {
      const def = BLUEPRINTS[bp];
      const out = def.equipmentOutput;
      const fuel = out?.slotType === "reactorCore" ? reactorCoreFuel(out.varietyKey, def.tier) : {};
      expect(Object.entries(def.recipe.inputs), bp).toEqual(Object.entries({ ...want, ...fuel }));
    }
    expect(BLUEPRINTS.highOutputCoreBp.recipe.inputs.deuteriumCanister).toBe(2);
    expect(BLUEPRINTS.efficientCoreBp.recipe.inputs.deuteriumCanister).toBe(1);
  });

  it("the rows the audit kept are unchanged", () => {
    for (const [bp, want] of Object.entries(KEPT)) expect(inputsOf(bp), bp).toEqual(want);
  });

  it("the outputs did not move: each reworked blueprint still makes what it made", () => {
    expect(BLUEPRINTS.powerCouplingBp.recipe.outputItem).toBe("powerCoupling");
    for (const bp of ML2_REWORKED.filter((k) => k !== "powerCouplingBp")) {
      expect(BLUEPRINTS[bp].equipmentOutput?.varietyKey, bp).toBe(bp.replace(/Bp$/, ""));
    }
  });
});

describe("Biofiber and Resin Distillate (audit Group B call 6)", () => {
  const NEW: Record<string, { item: string; raw: string; ratio: number }> = {
    refineBiofiber: { item: "biofiber", raw: "fibrousBiomass", ratio: 5 },
    refineResinDistillate: { item: "resinDistillate", raw: "volatileResin", ratio: 3 },
  };

  it("are tier 1 refined goods with an honest Refinery hint, not seeded and not sold", () => {
    const fresh = freshState();
    for (const { item } of Object.values(NEW)) {
      const def = ITEMS[item];
      expect(def.category, item).toBe("refined");
      expect(def.tier, item).toBe(1);
      expect(def.unlockHint, item).toContain("at the Refinery");
      expect(def.reserved, item).toBeUndefined();
      expect(def.sellValue, item).toBeUndefined();
      expect(fresh.discovered, item).not.toContain(item);
    }
    expect(ITEMS.biofiber.label).toBe("Biofiber");
    expect(ITEMS.resinDistillate.label).toBe("Resin Distillate");
  });

  it("refine 5:1 and 3:1 in 20 ticks, through the real line engine, and are on offer", () => {
    for (const [key, { item, raw, ratio }] of Object.entries(NEW)) {
      const r = REFINE_RECIPES[key];
      expect(Object.keys(r.input), key).toEqual([raw]);
      expect(Number(r.input[raw]), key).toBe(ratio);
      expect(r.output.itemId, key).toBe(item);
      expect(r.output.amount.toString(), key).toBe("1");
      expect(r.durationTicks, key).toBe(20);
      expect(refineRecipeOffered(key), key).toBe(true);
      const s0 = holdingAll({ ...freshState(), facilities: { ...freshState().facilities, refinery: { level: 1 } } }, { [raw]: ratio });
      const started = startLine(s0, "refine", key, { kind: "batch", remaining: 1 });
      expect(started.started, key).toBe(true);
      const s = run(started.next, 22);
      expect(itemTotal(s.inventory, raw).toString(), key).toBe("0");
      expect(itemTotal(s.inventory, item).toString(), key).toBe("1");
      expect(s.discovered, key).toContain(item);
    }
  });

  it("each refine is a live registry entry with its content probe", () => {
    for (const key of Object.keys(NEW)) {
      const e = WIRING_REGISTRY.find((w) => w.id === `facility:REFINE_RECIPES:${key}`);
      expect(e?.status.kind, key).toBe("live");
      expect(e?.probe, key).toBe(`content:refine:${key}`);
    }
  });

  it("each has blueprint consumers (never a hidden, useless shelf item)", () => {
    const consumers = (item: string) => Object.keys(BLUEPRINTS).filter((k) => BLUEPRINTS[k].recipe.inputs[item] !== undefined).sort();
    expect(consumers("biofiber")).toEqual(["ablativePlatingBp", "ballisticWeaveBp", "compositePlatingBp", "fieldSuitBp"]);
    expect(consumers("resinDistillate")).toEqual(["hazardSuitBp", "toxinGrenadeBp"]);
  });
});

describe("ML-2 standing rules", () => {
  const equipmentBps = Object.values(BLUEPRINTS).filter((bp) => bp.equipmentOutput !== undefined);
  const slotsWithBps = [...new Set(equipmentBps.map((bp) => bp.equipmentOutput!.slotType))];

  // E-MAT test strategy 5, per slot. Implants are the one exception, and it predates ML-2: several implant blueprints
  // already shared "Wafer + Coupling" stacks (Reflex Booster, Targeting Optic and Synaptic Accelerator; Med-Nanite Swarm
  // and Cipher Wetware), and the audit's approved Archaeo-Scanner fix (Wafer 4 + Coupling 1, call 7) joins the second.
  // Implants are biocompatible electronics, so the shared stacks read true; telling them apart is 0.16.0's theming.
  // Complement CP-11: the audit's section 5 table gave three quarters pairs one map each; the user chose to tell them
  // apart (2026-11-03, "Tell them apart"), so Engineering, Science and the Guest Wing each swap one input ([PROPOSAL],
  // model.ts CREW_MODULE_BLUEPRINTS) and the rule holds for the quarters with no exception.
  it("no two varieties of one slot share an identical input map (implants excepted, see above)", () => {
    const dupes: string[] = [];
    for (const slot of slotsWithBps.filter((s) => s !== "implant")) {
      const seen = new Map<string, string>();
      for (const bp of equipmentBps.filter((b) => b.equipmentOutput!.slotType === slot)) {
        const map = JSON.stringify(Object.entries(bp.recipe.inputs).sort());
        if (seen.has(map)) dupes.push(`${slot}: ${seen.get(map)} = ${bp.key}`);
        seen.set(map, bp.key);
      }
    }
    expect(dupes).toEqual([]);
    // The six slots ML-2 reworked, explicitly.
    for (const slot of ["cargoBay", "ftlDrive", "reactorCore", "specUtility", "shieldEmitters", "hullPlating"]) expect(slotsWithBps, slot).toContain(slot);
  });

  // The no-wall walker (E-MAT test strategy 3; audit Group A call 2: the Cometary Ice Harvest counts as an open early
  // mission): every slot keeps a variety, not gated on a relic, whose full input tree, walked through the Refinery
  // recipes on offer and the material blueprints, bottoms out in what the missions a fresh save can fly at once drop.
  it("no wall: every equipment slot keeps a variety whose whole tree bottoms out in the day-one missions' drops", () => {
    const fresh = freshState();
    const dayOne = (Object.keys(MISSIONS) as MissionKey[]).filter(
      (k) => k !== "localFuelRun" && MISSIONS[k].unlockLevel <= 1 && MISSIONS[k].requiresCaptainLevel === undefined && MISSIONS[k].requiresCargoCapacity === undefined && canDispatch(fresh, 1, k).ok,
    );
    expect(dayOne).toEqual(expect.arrayContaining(["shortOreRun", "longOreRun", "cometIceHarvest"]));
    const drops = new Set<string>();
    for (const k of dayOne) {
      const m = MISSIONS[k];
      drops.add(m.lootTable.common);
      if (m.uncommonChance > 0) drops.add(m.lootTable.uncommon);
      if (m.rareChance > 0) drops.add(m.lootTable.rare);
    }
    // Gas Giant Study GG-3: every gas giant study (an expedition's ship study, no squad needed) returns canisters of every
    // gas; GG-7's Elite Quarters (Lab tier III; CP-11's quarters take components only) takes Ammonia and Hydrogen, so the
    // walk proves those inputs gatherable. The Deuterium Canister is left out: its day-one route (the Cometary Ice Harvest's
    // ice through the Refinery) is the one the Reactor Core anchors must keep proving.
    for (const id of GAS_CANISTER_IDS) if (id !== "deuteriumCanister") drops.add(id);
    const reachable = (item: string, path: ReadonlySet<string>): boolean => {
      if (drops.has(item)) return true;
      if (path.has(item)) return false;
      const next = new Set([...path, item]);
      const routes = [
        ...Object.entries(REFINE_RECIPES).filter(([k, r]) => r.output.itemId === item && refineRecipeOffered(k)).map(([, r]) => Object.keys(r.input)),
        ...Object.values(BLUEPRINTS).filter((bp) => bp.recipe.outputItem === item && bp.requiresRelicDiscovery === undefined).map((bp) => Object.keys(bp.recipe.inputs)),
      ];
      return routes.some((inputs) => inputs.every((i) => reachable(i, next)));
    };
    // A slot whose only blueprints are discovery payoffs (the sensor array was one until CP-11: a relic's and, since
    // GG-7, a decoded ancient entry's) has no ordinary variety to keep open; the Standard-Issue piece covers it. GG-7's
    // special blueprints are discovery payoffs like a relic's (requiresDecode).
    const ordinary = (bp: (typeof equipmentBps)[number]) => bp.requiresRelicDiscovery === undefined && bp.requiresDecode === undefined;
    const ordinarySlots = slotsWithBps.filter((slot) => equipmentBps.some((bp) => bp.equipmentOutput!.slotType === slot && ordinary(bp)));
    expect(ordinarySlots.length).toBeGreaterThan(8);
    // Complement CP-11: the bridge, quarters and sensor slots gained ordinary, components-only blueprints, so the walk
    // below now proves each keeps a no-wall variety too.
    for (const slot of ["bridge", "quarters", "sensor"]) expect(ordinarySlots, slot).toContain(slot);
    for (const slot of ordinarySlots) {
      const open = equipmentBps.filter(
        (bp) => bp.equipmentOutput!.slotType === slot && ordinary(bp) && Object.keys(bp.recipe.inputs).every((i) => reachable(i, new Set())),
      );
      expect(open.length, `${slot} has a no-wall variety`).toBeGreaterThan(0);
    }
    // The six economy and defense slots keep their anchors open (the variety a Standard-Issue piece reads).
    for (const bp of ["balancedHoldBp", "balancedDriveBp", "balancedCoreBp", "yieldRigBp", "balancedEmitterBp", "reinforcedPlatingBp"]) {
      expect(Object.keys(BLUEPRINTS[bp].recipe.inputs).every((i) => reachable(i, new Set())), bp).toBe(true);
    }
  });

  it("realism guard: fabrics take Biofiber; seals and grenade agents take Resin Distillate", () => {
    for (const bp of ["ablativePlatingBp", "compositePlatingBp", "ballisticWeaveBp", "fieldSuitBp"]) expect(inputsOf(bp).biofiber, bp).toBeGreaterThan(0);
    for (const bp of ["hazardSuitBp", "toxinGrenadeBp"]) expect(inputsOf(bp).resinDistillate, bp).toBeGreaterThan(0);
  });

  it("realism guard: Purified Biomass stays the food and medical feedstock (kits, the Med Kit, the living sensor)", () => {
    const users = Object.keys(BLUEPRINTS).filter((k) => BLUEPRINTS[k].recipe.inputs.purifiedBiomass !== undefined).sort();
    // Complement CP-11: Medical Quarters' sickbay stock (audit call 13, user: "Medical Quarters takes 1 Purified Biomass").
    expect(users).toEqual(["antitoxinBp", "bioResonanceArrayBp", "combatStimBp", "firstAidKitBp", "injuryKitBp", "medKitBp", "medicalQuartersBp", "splintBp", "traumaKitBp"]);
    // Its one Refinery use is the living Biocatalyst culture.
    expect(Object.keys(REFINE_RECIPES).filter((k) => REFINE_RECIPES[k].input.purifiedBiomass !== undefined)).toEqual(["synthBiocatalyst"]);
  });

  it("realism guard: no implant takes a load-bearing strut (the Archaeo-Scanner row)", () => {
    for (const bp of Object.values(BLUEPRINTS).filter((b) => b.equipmentOutput?.slotType === "implant")) {
      expect(bp.recipe.inputs.frameSegment, bp.key).toBeUndefined();
      expect(bp.recipe.inputs.structuralAssembly, bp.key).toBeUndefined();
    }
  });

  it("no ordinary equipment blueprint takes a raw input (the two new goods are refined)", () => {
    for (const bp of equipmentBps.filter((b) => b.requiresRelicDiscovery === undefined)) {
      for (const i of Object.keys(bp.recipe.inputs)) expect(ITEMS[i].category, `${bp.key} ${i}`).not.toBe("raw");
    }
  });

  it("the Power Coupling's new recipe moves no Quartermaster kit price (its worth stays 80)", () => {
    expect(FIELD_KIT_PRICES).toEqual({ firstAidKit: 60, antitoxin: 60, combatStim: 150, splint: 95, traumaKit: 660, injuryKit: 420 });
  });
});

describe("ML-2 in-flight safety (patch note: active lines on reworked recipes may wait)", () => {
  it("a job started on the old recipe completes off its stored effect, byte-identical to the capture", () => {
    for (const [i, bp] of ML2_REWORKED.entries()) {
      let draws = 0;
      let x = 0x2b1 >>> 0;
      const rng = () => {
        draws += 1;
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 4294967296;
      };
      // Started under the old recipe (the line and its first tick, where the job takes its inputs and stores its
      // effect, as a pre-patch save holds it), then run to completion under the new one.
      let s = withPreMl2Recipes(() => {
        const started = startLine(stockedFor(bp), "fabricate", bp, { kind: "batch", remaining: 1 });
        expect(started.started, bp).toBe(true);
        const first = economyTick(started.next, 1, rng);
        expect(first.activeProcesses.some((p) => p.kind === "fabricateJob"), bp).toBe(true);
        return first;
      });
      for (let t = 1; t < BLUEPRINTS[bp].craftDurationTicks + 4; t++) s = economyTick(s, 1, rng);
      expect([bp, `${stateHash(s)}:${draws}`]).toEqual(ML2_GOLDEN.fabricate[i]);
    }
  });

  it("a standing line on a reworked recipe waits for the new input (no throw, no negative bucket), then resumes", () => {
    const bp = "prospectorHoldBp";
    const old = { frameSegment: 2, titaniumIngot: 3 };
    const base: GameState = { ...freshState(), facilities: { ...freshState().facilities, fabricator: { level: 1 } }, researchedBlueprints: [bp] };
    // Two iterations of the OLD recipe in stock; the line starts its first job before the patch (its first tick).
    const s0 = withPreMl2Recipes(() => {
      const started = startLine(holdingAll(base, old, 2), "fabricate", bp, { kind: "batch", remaining: 2 });
      expect(started.started).toBe(true);
      return run(started.next, 1);
    });
    expect(s0.activeProcesses.filter((p) => p.kind === "fabricateJob")).toHaveLength(1);
    const ticks = BLUEPRINTS[bp].craftDurationTicks;
    let s = run(s0, ticks + 4);
    // The first job finished off its stored effect; the second iteration needs Reclaimed Alloy, so the line waits.
    expect(s.blanks[bp]?.toString()).toBe("1");
    expect(s.fabricateLines).toHaveLength(1);
    expect(s.activeProcesses.filter((p) => p.kind === "fabricateJob")).toHaveLength(0);
    for (const [id, buckets] of Object.entries(s.inventory)) for (const b of buckets) expect(b.gte(0), id).toBe(true);
    // Nothing was taken from the waiting iteration's stock: the second old set is all still there.
    expect([itemTotal(s.inventory, "frameSegment").toString(), itemTotal(s.inventory, "titaniumIngot").toString()]).toEqual(["2", "3"]);
    // Stocked with the missing input, it resumes and finishes.
    s = holdingAll(s, { reclaimedAlloy: 2 });
    s = run(s, ticks + 4);
    expect(s.blanks[bp]?.toString()).toBe("2");
    expect(s.fabricateLines).toHaveLength(0);
  });
});

describe("ML-2 text fixes (audit T1 to T8, 'Apply all')", () => {
  it("each item now says what it physically is", () => {
    expect(ITEMS.cobaltCoil.flavor).toContain("cobalt magnetic core in a titanium housing"); // T1
    expect(ITEMS.iridiumCatalyst.flavor).toMatch(/catalyst.*cladding/); // T2
    expect(ITEMS.frameSegment.flavor).toContain("tool chassis"); // T3
    expect(ITEMS.purifiedBiomass.flavor).toContain("food and medical"); // T4, in the form call 6 (c) leaves it
    expect(ITEMS.ferriteOre.flavor).toContain("iron-rich ore"); // T5
    expect(ITEMS.ferriteOre.flavor).not.toContain("alloy");
    expect(BLUEPRINTS.refineryFeedRigBp.flavor).toContain("bioleaching"); // T6
    expect(FIELD_KITS_HIDDEN_BLUEPRINTS.impactGrenadeBp.flavor).toMatch(/contact.*coupling.*charge/); // T7
    expect(ITEMS.deuteriumIce.unlockHint).toContain("Cometary Ice Harvest"); // T8
    expect(ITEMS.deuteriumIce.unlockHint).toContain("Deuterium Canister");
    expect(ITEMS.deuteriumIce.flavor).not.toMatch(/no longer burns/);
    expect(ITEMS.powerCoupling.flavor).toContain("titanium housing");
  });
});
