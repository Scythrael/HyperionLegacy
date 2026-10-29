// Gas Giant Study GG-7 (0.14.0): the canisters' crafting uses and the three special blueprints (plan
// docs/plans/2026-10-17-gas-giant-study-plan.md section GG-7; user calls 7, 10 and 11). The pre-GG-7 pins are in
// gasGiantSpecialsGoldens.test.ts; this file proves what GG-7 adds.

import { makeRng } from "./combat/rng";
import { describe, expect, it } from "vitest";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  GAS_GIANT_BLUEPRINTS,
  ITEMS,
  RESEARCH_FACILITY_KEY,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  freshState,
  moduleEffectScale,
  type AwayMember,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type ShipGroundTeam,
} from "./model";
import { canResearch } from "./tick";
import { advanceExpedition, flaggedScanTimeline } from "./expedition";
import { generateEquipment } from "./itemgen";
import {
  NEBULA_SWEEP_SECONDS,
  gearPermilleStamp,
  liftedBandOdds,
  nebulaCanisterRange,
  nebulaSweepSeconds,
  rollNebulaReward,
  rollStudyReward,
  studyBandOdds,
} from "./gasGiantStudy";
import { GAS_CANISTER_IDS, GIANT_CLASSES } from "./gasGiantContent";
import { GG7_NUMBERS, PRESSURE_FORGED_PLATING_VARIETY, RAMSCOOP_COLLECTOR_MODULE, RESONANCE_SENSOR_ARRAY, SPECIAL_BLUEPRINT_KEYS, SPECIAL_BLUEPRINT_TIER } from "./specialBlueprints";
import { UNIVERSAL_MODULES, moduleNebulaSweep, validateUniversalModuleCatalog } from "./shipModules";
import { SENSOR_ARRAYS, sensorArrayCanisterBandLift } from "./sensorArrays";
import { researchFamilyOf } from "./dataStudy";
import { dispatchPastPropulsion, plainAwayMember } from "./awayTeamTestFixtures";
import { ancientEntriesText, decodeGateText, decodeLockText, specialBlueprintCards } from "../dataStudyDisplay";
import { giantCardView, minText, nebulaRowView, studyLegsView } from "../gasGiantStudyDisplay";
import { moduleEffectSentence } from "../ui/moduleEffectText";

const T0 = 100_000;
const FINAL = T0 + 8_000_000;
const SEC = ["member-1", "member-2", "member-3"];
const SCI = ["member-11", "member-12", "member-13"];

function crewed(saveSeed: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [{ kind: "ground", security: SEC, science: SCI, helpOthers: false }];
  return {
    ...base,
    expeditionSeed: saveSeed,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// The piece blueprint `key` mints, installed on ship-1.
function withMinted(s: GameState, key: string, rarity: EquipmentInstance["rarity"] = "standard", quality = 0): GameState {
  const out = BLUEPRINTS[key].equipmentOutput!;
  const piece = generateEquipment({ slotType: out.slotType, varietyKey: out.varietyKey, blueprintKey: key, iLevel: 20, quality, rarity, ascension: "none", rng: () => 0.5, allocateId: () => `gg7-${key}` });
  return { ...s, equipment: [...s.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === out.slotType)), { ...piece, fittedToShipId: "ship-1" }] };
}

// The first grid candidate whose dispatch carries `want` (a nebula or a study), with its id.
function firstCandidate(want: (e: Expedition) => boolean): { id: string; saveSeed: number } {
  for (const saveSeed of [0x51f15e, 0x2b7c0d3]) {
    for (let tier = 1; tier <= 7; tier++) {
      for (let slot = 0; slot < 3; slot++) {
        const id = `cand-${tier}-${slot}`;
        const res = dispatchPastPropulsion(crewed(saveSeed), "ship-1", 1, id);
        if (res.success && res.expedition && want(res.expedition)) return { id, saveSeed };
      }
    }
  }
  throw new Error("no candidate");
}
const NEBULA = firstCandidate((e) => e.nebula !== undefined);
const STUDY = firstCandidate((e) => e.study !== undefined && e.bodies.some((b) => b.giant !== undefined));

function dispatch(at: { id: string; saveSeed: number }, edit: (s: GameState) => GameState = (s) => s): Expedition {
  const res = dispatchPastPropulsion(edit(crewed(at.saveSeed)), "ship-1", 1, at.id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return res.expedition;
}

describe("GG-7: every canister has a consumer (the dead-stock rule, user call 7)", () => {
  it("each of the six canisters is an input of at least one researchable blueprint, and still sells", () => {
    for (const id of GAS_CANISTER_IDS) {
      const users = Object.values(BLUEPRINTS).filter((bp) => (bp.recipe.inputs[id] ?? 0) > 0);
      expect(users.length, id).toBeGreaterThan(0);
      expect(ITEMS[id].sellValue, id).toBeGreaterThan(0);
    }
  });
  it("the new uses sit where the user placed them", () => {
    const takes = (key: string, id: string) => (BLUEPRINTS[key].recipe.inputs[id] ?? 0) > 0;
    // Recipe realism call 3: Helium-3 in no Reactor Core in 0.14.0; the Resonance Sensor Array takes one.
    expect(BLUEPRINTS.resonanceSensorArrayBp.recipe.inputs.helium3Canister).toBe(1);
    for (const bp of Object.values(BLUEPRINTS)) if (bp.equipmentOutput?.slotType === "reactorCore") expect(bp.recipe.inputs.helium3Canister, bp.key).toBeUndefined();
    // Call 14: Quarters take Ammonia and Hydrogen (Lab tier III and up).
    expect(takes("eliteQuartersBp", "ammoniaCanister") && takes("eliteQuartersBp", "hydrogenCanister")).toBe(true);
    expect(BLUEPRINTS.eliteQuartersBp.tier).toBeGreaterThanOrEqual(3);
    // Audit section 9: diamond from methane.
    expect(takes("pressureForgedPlatingBp", "methaneCanister")).toBe(true);
    // Call 7: Deuterium Class III+, the cell Class VI and VII (G2-4's rows).
    expect(takes("classIIIDriveBp", "deuteriumCanister") && takes("classVIDriveBp", "antimatterCell") && takes("classVIIDriveBp", "antimatterCell")).toBe(true);
  });
  it("every GG-7 blueprint is a NEW row (no existing recipe moved) and maps to one research family", () => {
    expect(Object.keys(GAS_GIANT_BLUEPRINTS).sort()).toEqual(["eliteQuartersBp", "pressureForgedPlatingBp", "ramscoopCollectorBp", "resonanceSensorArrayBp"]);
    for (const [key, bp] of Object.entries(GAS_GIANT_BLUEPRINTS)) {
      expect(BLUEPRINTS[key]).toBe(bp);
      expect(researchFamilyOf(bp), key).toBeTruthy();
    }
    expect(researchFamilyOf(BLUEPRINTS.resonanceSensorArrayBp)).toBe("sensors");
    expect(researchFamilyOf(BLUEPRINTS.pressureForgedPlatingBp)).toBe("defense");
  });
});

describe("GG-7: the special blueprints (user call 11, \"Three now\")", () => {
  it("three, on existing slots, at the mockup's Lab tiers, each opened by a decoded entry", () => {
    expect([...SPECIAL_BLUEPRINT_KEYS]).toEqual(["pressureForgedPlatingBp", "ramscoopCollectorBp", "resonanceSensorArrayBp"]);
    expect(BLUEPRINTS.pressureForgedPlatingBp.equipmentOutput).toEqual({ slotType: "hullPlating", varietyKey: PRESSURE_FORGED_PLATING_VARIETY });
    expect(BLUEPRINTS.ramscoopCollectorBp.equipmentOutput).toEqual({ slotType: "module", varietyKey: RAMSCOOP_COLLECTOR_MODULE });
    expect(BLUEPRINTS.resonanceSensorArrayBp.equipmentOutput).toEqual({ slotType: "sensor", varietyKey: RESONANCE_SENSOR_ARRAY });
    for (const key of SPECIAL_BLUEPRINT_KEYS) {
      expect(BLUEPRINTS[key].tier).toBe(SPECIAL_BLUEPRINT_TIER[key]);
      expect(BLUEPRINTS[key].requiresDecode).toBe(GG7_NUMBERS.decodeEntry[key]);
    }
    expect([3, 4, 5]).toEqual(SPECIAL_BLUEPRINT_KEYS.map((k) => SPECIAL_BLUEPRINT_TIER[k]));
    // No Annihilation Core in 0.14.0 (it moves with the burn).
    expect(Object.keys(BLUEPRINTS).some((k) => /annihilation/i.test(k))).toBe(false);
    expect(EQUIPMENT_SLOTS.hullPlating.varieties.some((v) => v.key === PRESSURE_FORGED_PLATING_VARIETY)).toBe(true);
    expect(EQUIPMENT_SLOTS.sensor.varieties.some((v) => v.key === RESONANCE_SENSOR_ARRAY)).toBe(true);
    expect(EQUIPMENT_SLOTS.module.varieties.some((v) => v.key === RAMSCOOP_COLLECTOR_MODULE)).toBe(true);
    expect(validateUniversalModuleCatalog()).toEqual([]);
  });

  it("each is refused as `undecoded` until ONE culture reaches its entry, then researchable at its Lab tier", () => {
    const lab = (decoded: Record<string, number> | undefined): GameState => {
      const base = freshState();
      return { ...base, credits: new Decimal(1e15), facilities: { ...base.facilities, [RESEARCH_FACILITY_KEY]: { level: 7 } }, ...(decoded ? { ancientDecoded: decoded } : {}) };
    };
    for (const key of SPECIAL_BLUEPRINT_KEYS) {
      const need = GG7_NUMBERS.decodeEntry[key];
      expect(canResearch(lab(undefined), key), key).toEqual({ ok: false, reason: "undecoded" });
      expect(canResearch(lab({ a: need - 1, b: need - 1 }), key), key).toEqual({ ok: false, reason: "undecoded" });
      expect(canResearch(lab({ a: need }), key), key).toEqual({ ok: true });
    }
    // The Lab tier still binds once decoded.
    const low = { ...lab({ a: 9 }), facilities: { ...freshState().facilities, [RESEARCH_FACILITY_KEY]: { level: 2 } } };
    for (const key of SPECIAL_BLUEPRINT_KEYS) expect(canResearch(low, key)).toEqual({ ok: false, reason: "tierLocked" });
  });

  it("Pressure-Forged Plating mints on the Hull Plating lines, leaning into kinetic dampening", () => {
    let kForged = 0;
    let kPlain = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const mint = (key: string) => {
        // WR-7: a well-mixed stream (the old Park-Miller start from seed x 7919 drew nearly the same low first values every
        // seed, so the picks walked the pool in order; it read the lean only while unlisted stats crowded the pool), at
        // Standard rarity (two affixes): since "Unlisted = never rolls" a Stellar piece draws three of the plating's six
        // listed lines, which blurs any lean.
        const stream = makeRng(seed * 2 + 1);
        const rng = () => stream.next();
        const out = BLUEPRINTS[key].equipmentOutput!;
        return generateEquipment({ slotType: out.slotType, varietyKey: out.varietyKey, blueprintKey: key, iLevel: 20, quality: 0, rarity: "standard", ascension: "none", rng, allocateId: () => key });
      };
      const forged = mint("pressureForgedPlatingBp");
      expect(forged.slotType).toBe("hullPlating");
      expect(forged.implicitStats.hullStrength ?? 0).toBeGreaterThan(0);
      kForged += (forged.rolledStats.kineticDampening ?? 0) + (forged.implicitStats.kineticDampening ?? 0);
      const plain = mint("reinforcedPlatingBp");
      kPlain += (plain.rolledStats.kineticDampening ?? 0) + (plain.implicitStats.kineticDampening ?? 0);
    }
    expect(kForged).toBeGreaterThan(kPlain * 2);
  });
});

describe("GG-7: the Ramscoop Collector boosts the nebula sweep, never gates it", () => {
  it("the dispatch freezes the boost on the nebula stamp only when the ship carries one", () => {
    const plain = dispatch(NEBULA);
    expect(plain.nebula?.ramscoop).toBeUndefined();
    expect(Object.keys(plain.nebula!)).toEqual(Object.keys({ kindId: plain.nebula!.kindId }));
    const scooped = dispatch(NEBULA, (s) => withMinted(s, "ramscoopCollectorBp"));
    expect(scooped.nebula?.ramscoop).toBe(Math.round(GG7_NUMBERS.ramscoopCollector.nebulaSweep * moduleEffectScale("standard", 0, "none") * 1000));
    // A study-only system (no nebula) never carries it.
    const studyOnly = firstCandidate((e) => e.study !== undefined && e.nebula === undefined);
    expect(dispatch(studyOnly, (s) => withMinted(s, "ramscoopCollectorBp")).nebula).toBeUndefined();
  });

  it("a better piece boosts more (rarity and quality scale it, never capped)", () => {
    const at = (rarity: EquipmentInstance["rarity"], q: number) => dispatch(NEBULA, (s) => withMinted(s, "ramscoopCollectorBp", rarity, q)).nebula!.ramscoop!;
    expect(at("radiant", 5)).toBeGreaterThan(at("standard", 0));
    const piece = { slotType: "module", moduleVariant: RAMSCOOP_COLLECTOR_MODULE, rarity: "standard", quality: 0, ascension: "none" } as EquipmentInstance;
    expect(moduleNebulaSweep([piece], () => 1)).toBe(GG7_NUMBERS.ramscoopCollector.nebulaSweep);
    expect(moduleNebulaSweep([piece], () => 4)).toBe(GG7_NUMBERS.ramscoopCollector.nebulaSweep * 4);
  });

  it("the sweep is shorter and fills more canisters; without the stamp it is the GG-4 sweep exactly", () => {
    const base = { kindId: "emissionNebula" as const };
    expect(nebulaSweepSeconds({ nebula: base })).toBe(NEBULA_SWEEP_SECONDS);
    expect(nebulaSweepSeconds({ nebula: { ...base, ramscoop: 500 } })).toBe(Math.round(NEBULA_SWEEP_SECONDS / 1.5));
    const region = { version: 1 as const, tier: 2 as const, enemyTerritory: false, bearing: 0, distanceLy: 10 };
    const [lo, hi] = nebulaCanisterRange({ region, nebula: base });
    const [blo, bhi] = nebulaCanisterRange({ region, nebula: { ...base, ramscoop: 500 } });
    expect(blo).toBeGreaterThan(lo);
    expect(bhi).toBeGreaterThan(hi);
    let plain = 0;
    let boosted = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const exp = { id: "x", seed: seed * 0x9e3779b1, systemName: "LB-0001", region, nebula: base };
      const count = (e: typeof exp & { nebula: { kindId: "emissionNebula"; ramscoop?: number } }) => GAS_CANISTER_IDS.reduce((a, id) => a + (rollNebulaReward(e, 0).materials?.[id] ?? 0), 0);
      plain += count(exp);
      boosted += count({ ...exp, nebula: { ...base, ramscoop: 500 } });
    }
    expect(boosted / plain).toBeGreaterThan(1.4);
    expect(boosted / plain).toBeLessThan(1.6);
  });

  it("a whole run with the module: the sweep leg is shorter, the run still completes, and one call == 997 s steps", () => {
    const exp = dispatch(NEBULA, (s) => withMinted(s, "ramscoopCollectorBp"));
    const done = advanceExpedition(exp, FINAL);
    expect(done.phase).toBe("complete");
    const leg = done.groundOps!.studyLegs!.find((l) => l.nebula === 1)!;
    const paused = (leg.pauses ?? []).reduce((a, p) => a + (p.to - p.from), 0);
    expect(leg.endsAt - leg.startsAt - paused).toBe(nebulaSweepSeconds(exp));
    let stepped = exp;
    for (let t = T0; t < FINAL && stepped.phase !== "complete"; t += 997) stepped = advanceExpedition(stepped, t);
    stepped = advanceExpedition(stepped, FINAL);
    expect(JSON.stringify(stepped)).toBe(JSON.stringify(done));
    // Never a gate: the same system without the module still sweeps.
    const without = advanceExpedition(dispatch(NEBULA), FINAL);
    expect(without.groundOps!.studyLegs!.some((l) => l.nebula === 1 && l.done)).toBe(true);
  });
});

describe("GG-7: the Resonance Sensor Array lifts the canister bands (user 2026-10-27, \"Better canister odds\")", () => {
  it("is the only array with the lift, scaled by rarity and quality", () => {
    for (const a of SENSOR_ARRAYS) expect(a.canisterBandLift > 0, a.id).toBe(a.id === RESONANCE_SENSOR_ARRAY);
    const def = SENSOR_ARRAYS.find((a) => a.id === RESONANCE_SENSOR_ARRAY)!;
    const piece = (rarity: EquipmentInstance["rarity"], quality: number) => ({ def, instance: { rarity, quality, ascension: "none" } as EquipmentInstance });
    expect(sensorArrayCanisterBandLift(piece("standard", 0))).toBeCloseTo(GG7_NUMBERS.resonanceSensorArray.canisterBandLift, 12);
    expect(sensorArrayCanisterBandLift(piece("radiant", 5))).toBeGreaterThan(sensorArrayCanisterBandLift(piece("standard", 0)));
    expect(sensorArrayCanisterBandLift(null)).toBe(0);
  });

  it("lifts Augmented and Stellar, Standard gives way, Radiant holds; no lift is the class's own odds object", () => {
    const sudarskyI = GIANT_CLASSES.find((c) => c.id === "sudarskyI")!;
    expect(sudarskyI.bandOdds).toEqual({ standard: 66, augmented: 26, stellar: 6, radiant: 2 });
    expect(liftedBandOdds(sudarskyI.bandOdds, 0.5)).toEqual({ standard: 50, augmented: 39, stellar: 9, radiant: 2 });
    expect(studyBandOdds({}, sudarskyI)).toBe(sudarskyI.bandOdds);
    expect(studyBandOdds({ bandLift: 500 }, sudarskyI)).toEqual({ standard: 50, augmented: 39, stellar: 9, radiant: 2 });
    // Unbounded and never negative: a huge lift empties Standard and keeps growing the richer bands.
    expect(liftedBandOdds(sudarskyI.bandOdds, 20)).toMatchObject({ standard: 0, radiant: 2 });
  });

  it("the dispatch freezes it only on a study run whose ship carries the array, and the run's canisters come richer", () => {
    const plain = dispatch(STUDY);
    expect(plain.bandLift).toBeUndefined();
    const tuned = dispatch(STUDY, (s) => withMinted(s, "resonanceSensorArrayBp"));
    expect(tuned.bandLift).toBe(gearPermilleStamp(GG7_NUMBERS.resonanceSensorArray.canisterBandLift * moduleEffectScale("standard", 0, "none")));
    // The same draws, richer bands: over a reseeded batch of the run's first giant study, more canisters above Standard,
    // and the same canister count study for study (the lift never moves the count draws).
    const i = plain.bodies.findIndex((b) => b.giant !== undefined);
    let above = [0, 0];
    for (let k = 1; k <= 300; k++) {
      const seed = (plain.seed ^ Math.imul(k, 0x9e3779b1)) >>> 0;
      const [a, b] = [plain, tuned].map((e) => rollStudyReward({ ...e, seed }, i, 0).materials ?? {});
      const count = (m: Record<string, number>) => GAS_CANISTER_IDS.reduce((n, id) => n + (m[id] ?? 0), 0);
      expect(count(b)).toBe(count(a));
      const rich = (m: Record<string, number>) => GAS_CANISTER_IDS.reduce((n, id) => n + (ITEMS[id].band !== "standard" ? (m[id] ?? 0) : 0), 0);
      above = [above[0] + rich(a), above[1] + rich(b)];
    }
    expect(above[1]).toBeGreaterThan(above[0] * 1.25);
    // A nebula-only system has no giant to study, so nothing is frozen there.
    const nebulaOnly = firstCandidate((e) => e.nebula !== undefined && e.study === undefined);
    expect(dispatch(nebulaOnly, (s) => withMinted(s, "resonanceSensorArrayBp")).bandLift).toBeUndefined();
  });
});

describe("GG-7: the study screens read the run's own sweep length and band odds", () => {
  it("a Ramscoop run's nebula row and upcoming sweep row print its shorter sweep", () => {
    const exp = dispatch(NEBULA, (s) => withMinted(s, "ramscoopCollectorBp"));
    const short = minText(nebulaSweepSeconds(exp));
    expect(short).not.toBe(minText(NEBULA_SWEEP_SECONDS));
    expect(nebulaRowView(exp, T0)!.chips[0].text).toBe(`Nebula sweep ${short}`);
    let run = exp;
    for (let t = T0; t < FINAL && run.groundOps?.startedAt === undefined; t += 600) run = advanceExpedition(run, t);
    expect(run.groundOps?.studyLegs?.some((l) => l.nebula === 1) ?? false).toBe(false);
    const ahead = studyLegsView(run, null, run.groundOps!.startedAt!, flaggedScanTimeline)!.rows.find((r) => r.key === "sweep-ahead")!;
    expect(ahead.when).toBe(`after the last body, ${short}`);
    // Without the module the GG-6 text holds.
    expect(nebulaRowView(dispatch(NEBULA), T0)!.chips[0].text).toBe(`Nebula sweep ${minText(NEBULA_SWEEP_SECONDS)}`);
  });
  it("a Resonance run's body card shows its lifted band odds", () => {
    const plain = dispatch(STUDY);
    const tuned = dispatch(STUDY, (s) => withMinted(s, "resonanceSensorArrayBp"));
    const i = plain.bodies.findIndex((b) => b.giant !== undefined);
    expect(JSON.stringify(giantCardView(tuned, i)!.bands)).not.toBe(JSON.stringify(giantCardView(plain, i)!.bands));
  });
});

describe("GG-7: the Data study tab's special blueprint cards and decoded count", () => {
  const view = (decoded: Record<string, number> | undefined, researched: string[] = []) => ({ ancientDecoded: decoded, researchedBlueprints: researched, activeProcesses: [] as GameState["activeProcesses"] });
  it("locked cards name their entry; an opened one reads ready; a researched one reads researched", () => {
    const locked = specialBlueprintCards(view(undefined));
    expect(locked.map((c) => [c.name, c.state, c.chipText])).toEqual(
      SPECIAL_BLUEPRINT_KEYS.map((k) => [BLUEPRINTS[k].label.replace(/ Blueprint$/, ""), "locked", `Entry ${GG7_NUMBERS.decodeEntry[k]}`]),
    );
    expect(locked.map((c) => c.text)).toEqual([
      "Hull plating forged under crushing pressure. Lab tier III.",
      "Boosts the nebula sweep: bigger, faster hauls. Never a gate. Lab tier IV.",
      "A sensor array tuned by ancient records: richer canisters (more Augmented and Stellar) from gas giant studies. Lab tier V.",
    ]);
    const one = specialBlueprintCards(view({ "culture-t1-1": GG7_NUMBERS.decodeEntry.pressureForgedPlatingBp }, []));
    expect(one[0]).toMatchObject({ state: "open", chipText: "Unlocked: ready to research", glyph: "discovery" });
    const done = specialBlueprintCards(view({ "culture-t1-1": 9 }, ["ramscoopCollectorBp"]));
    expect(done[1]).toMatchObject({ state: "researched", chipText: "Researched", glyph: "check" });
    expect(done[2].state).toBe("open");
  });
  it("the count is the furthest culture's (the gate's own reading, never a sum); the research refusal names one culture", () => {
    expect(decodeGateText()).toBe("Special blueprints open as one culture's entries are decoded: each locked card names the entry it waits on.");
    // One entry in each of three cultures reads 1, and the Ramscoop's "Entry 2" card stays locked to match.
    const spread = { a: 1, b: 1, c: 1 };
    expect(ancientEntriesText({ ancientDecoded: spread })).toBe("Entries decoded by the furthest culture so far: 1.");
    expect(specialBlueprintCards(view(spread))[1]).toMatchObject({ state: "locked", chipText: `Entry ${GG7_NUMBERS.decodeEntry.ramscoopCollectorBp}` });
    expect(ancientEntriesText({ ancientDecoded: { a: 1, b: 2 } })).toBe("Entries decoded by the furthest culture so far: 2.");
    expect(ancientEntriesText({ ancientDecoded: undefined })).toBe("Entries decoded by the furthest culture so far: 0.");
    expect(decodeLockText(1)).toBe("Decode 1 ancient entry of one culture first");
    expect(decodeLockText(3)).toBe("Decode 3 ancient entries of one culture first");
  });
  it("the Ramscoop's module card states the boost the engine freezes", () => {
    const def = UNIVERSAL_MODULES.find((d) => d.id === RAMSCOOP_COLLECTOR_MODULE)!;
    expect(moduleEffectSentence(def, 1)).toBe("Nebula sweeps: +50% canisters, and the sweep runs that much faster. Nebulae stay gatherable without it.");
  });
});
