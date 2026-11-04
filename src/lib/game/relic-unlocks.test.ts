// Exploration 0.14.0 (Phase E4d) tests: DISCOVERY-GATED RESEARCH + the three relic-unlocked items.
//
// Covers:
//   - THE GATE: a blueprint carrying requiresRelicDiscovery cannot be researched (canResearch /
//     startResearch / blueprintResearchable / canEnqueueOrder) until its relic's FIRST FIND lands in
//     state.relicDiscovered, with the `undiscovered` reason token; ungated blueprints are unchanged; the
//     masked catalog copy names the SET and never leaks the relic (or the project). Heart of the Archive gates
//     Neural Backup (E-CREW Task 7); the Precursor Lens gates its module (E-MOD EM-8).
//     End to end through a real relic study.
//   - HULL GATING: the Damage Control Suite installs on tactician hulls only, the Pathfinder Suite on
//     explorer hulls only (per-variety equipRequirement), prospecting rigs keep the slot's prospector gate,
//     and the Armory applies the same gate to a loadout install.
//   - DAMAGE CONTROL SUITE: faster post-loss repair (shipRepairDurationTicks, processShipRepairs) + the
//     between-wave hull patch-up (the shared leaf; resolvePatrolWaves; live == replay parity; big == stepped),
//     byte-identical without the suite.
//   - PATHFINDER SUITE + BIO-RESONANCE ARRAY: feed the dispatch-time expedition snapshot additively (in-flight
//     runs fixed); Bio-Resonance raises the relic chance and slows scanning; it is craftable (the Fabricator
//     mint path stamps a real, installable sensor array).
//   - The identification reveal's "Research unlocked" line selection.
//   - ADDITIVE-NEUTRAL evidence: no item -> exact zeros, identical snapshots, identical patrol outcomes.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  SHIP_TYPES,
  PATROLS,
  REPAIR_BASE_TICKS,
  REPAIR_TICKS_PER_HULL,
  RESEARCH_FACILITY_KEY,
  blueprintResearchable,
  blueprintRelicLocked,
  blueprintsUnlockedByRelic,
  equipmentSlotLabel,
  type GameState,
  type EquipmentInstance,
  type EquipmentRarity,
  type EquipmentSlotType,
  type ShipInstance,
  type ShipTypeKey,
  type PatrolMissionState,
  type RelicVaultToken,
  type TimedProcess,
  type Expedition,
  withGeneralMuseumRecord,
} from "./model";
import { RELICS, RELIC_SETS, getRelicById, getRelicSetById, undiscoveredResearchMask, museumBonuses } from "./relics";
import {
  canResearch,
  startResearch,
  canEnqueueOrder,
  startRelicStudy,
  resolveProcesses,
  identifyStudiedRelic,
  shipRepairDurationTicks,
  processShipRepairs,
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
} from "./tick";
import { generateEquipment } from "./itemgen";
import { canFitEquipment, equippedFor } from "./equipment";
import { installIntoLoadout } from "./armory";
import { craftLineOutputLabel } from "./craftQueue";
import {
  damageControlEffect,
  damageControlRepairTicks,
  damageControlWaveRegen,
  pathfinderEffect,
  DC_REPAIR_SPEED_B,
  DC_REPAIR_SPEED_R,
  DC_WAVE_REGEN_B,
  DC_WAVE_REGEN_R,
} from "./utilityGear";
import { damageControlBeforeWave } from "./combat/patrolWave";
import { resolvePatrolWaves, replayPatrol } from "./combat/patrolReplay";
import { combatHullTypeOf, foldedPlayerDefense, defaultSystemDurabilityForHull } from "./combat/bridge";
import { installedSensorArray, sensorArrayEffect, sensorArrayRelicFindBonus, getSensorArrayById, SENSOR_ARRAYS } from "./sensorArrays";
import { expeditionCandidates, resolveExpeditions, advanceExpedition, expeditionGearBonuses, startExpedition } from "./expedition";
import { ensureMinimumAwayTeam, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
import { rollRelicToken } from "./gambit";
import { effectiveShipStats } from "./crewOverlay";
import { buildRelicReveal, researchUnlockedByFind } from "../relicReveal";

// --- fixtures ----------------------------------------------------------------------------------------

// A deterministic stream (identical sequences when re-created).
function seededRng(seed = 0x12345678): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

// Mint a piece through the REAL generation path (so moduleVariant stamping + per-variety overrides are
// exercised), optionally fitted to a ship.
function mint(
  slotType: EquipmentSlotType,
  varietyKey: string,
  id: string,
  opts: { fittedTo?: string | null; iLevel?: number; quality?: number; rarity?: EquipmentRarity; blueprintKey?: string | null } = {},
): EquipmentInstance {
  const piece = generateEquipment({
    slotType,
    varietyKey,
    blueprintKey: opts.blueprintKey ?? null,
    iLevel: opts.iLevel ?? 40,
    quality: opts.quality ?? 3,
    rarity: opts.rarity ?? "stellar",
    ascension: "none",
    rng: seededRng(),
    allocateId: () => id,
  });
  return { ...piece, fittedToShipId: opts.fittedTo ?? null };
}

const withHull = (s: GameState, typeKey: ShipTypeKey): GameState => ({
  ...s,
  ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)),
});
const withEquipment = (s: GameState, ...pieces: EquipmentInstance[]): GameState => ({ ...s, equipment: [...s.equipment, ...pieces] });
const ship1 = (s: GameState): ShipInstance => s.ships.find((sh) => sh.id === "ship-1")!;

// A state able to research ANY blueprint that is not otherwise blocked: lab at its top level (2), rich.
function labReady(s: GameState = freshState()): GameState {
  return {
    ...s,
    credits: new Decimal(1_000_000),
    facilities: { ...s.facilities, [RESEARCH_FACILITY_KEY]: { level: 2 } },
  };
}
const discovered = (s: GameState, ...relicIds: string[]): GameState => ({ ...s, relicDiscovered: [...(s.relicDiscovered ?? []), ...relicIds] });

// The E4d lineup, as authored (relic -> blueprint). E-CREW Task 7 adds Heart of the Archive's Neural Backup
// (the implant system it waited on now exists), so the gate loops below cover it too.
const LINEUP: { relic: string; bp: string }[] = [
  { relic: "ancientDriveCoil", bp: "damageControlSuiteBp" },
  { relic: "deepVeinCompass", bp: "pathfinderSuiteBp" },
  { relic: "leviathanScale", bp: "bioResonanceArrayBp" },
  { relic: "heartOfTheArchive", bp: "neuralBackupBp" },
  // E-MOD EM-8: the Precursor Lens module (the E4d resolution: it shipped with the module phase).
  { relic: "precursorLens", bp: "precursorLensBp" },
];
const GATED = Object.values(BLUEPRINTS).filter((bp) => bp.requiresRelicDiscovery !== undefined);
const UNGATED = Object.values(BLUEPRINTS).filter((bp) => bp.requiresRelicDiscovery === undefined);

// ============================================================================
describe("E4d gate data: the discovery-gated blueprints", () => {
  it("exactly the lineup blueprints are gated, each by a REAL relic, and they are equipment blueprints", () => {
    expect(GATED.map((bp) => bp.key).sort()).toEqual(LINEUP.map((l) => l.bp).sort());
    for (const { relic, bp } of LINEUP) {
      expect(BLUEPRINTS[bp].requiresRelicDiscovery).toBe(relic);
      expect(getRelicById(relic), relic).toBeDefined();
      expect(BLUEPRINTS[bp].equipmentOutput).toBeDefined();
      // Tier 2 = the Research Lab's ceiling (a tier-3 blueprint would be permanently unresearchable).
      expect(BLUEPRINTS[bp].tier).toBeLessThanOrEqual(2);
    }
  });

  it("blueprintsUnlockedByRelic maps each lineup relic to its project (the Precursor Lens's module since EM-8)", () => {
    for (const { relic, bp } of LINEUP) expect(blueprintsUnlockedByRelic(relic).map((b) => b.key)).toEqual([bp]);
    // A common relic gates nothing.
    expect(blueprintsUnlockedByRelic("glyphTablet")).toEqual([]);
  });

  it("the Damage Control Suite recipe uses Anomalous Alloy; Pathfinder uses refined metals; Bio-Resonance uses organics", () => {
    expect(BLUEPRINTS.damageControlSuiteBp.recipe.inputs.anomalousAlloy).toBeGreaterThan(0);
    expect(BLUEPRINTS.pathfinderSuiteBp.recipe.inputs.titaniumIngot).toBeGreaterThan(0);
    const bio = BLUEPRINTS.bioResonanceArrayBp.recipe.inputs;
    expect((bio.fibrousBiomass ?? 0) + (bio.volatileResin ?? 0) + (bio.exoticSporeCluster ?? 0)).toBeGreaterThan(0);
  });
});

// ============================================================================
describe("E4d gate: canResearch / startResearch / blueprintResearchable", () => {
  it("a gated blueprint is LOCKED with the `undiscovered` reason until its relic is discovered, then researchable", () => {
    for (const { relic, bp } of LINEUP) {
      const locked = labReady();
      expect(blueprintRelicLocked(locked, bp)).toBe(true);
      expect(canResearch(locked, bp)).toEqual({ ok: false, reason: "undiscovered" });
      expect(blueprintResearchable(locked, bp)).toBe(false);
      const blocked = startResearch(locked, bp);
      expect(blocked.started).toBe(false);
      expect(blocked.reason).toBe("undiscovered");
      expect(blocked.next).toBe(locked); // same-ref no-op: nothing spent

      const open = discovered(locked, relic);
      expect(blueprintRelicLocked(open, bp)).toBe(false);
      expect(canResearch(open, bp)).toEqual({ ok: true });
      expect(blueprintResearchable(open, bp)).toBe(true);
      const started = startResearch(open, bp);
      expect(started.started).toBe(true);
      expect(started.next.activeProcesses.some((p) => p.effect.type === "unlockBlueprint" && p.effect.key === bp)).toBe(true);
    }
  });

  it("only THE gating relic unlocks it (another rare relic of a different set does not)", () => {
    const s = discovered(labReady(), "leviathanScale", "deepVeinCompass");
    expect(canResearch(s, "damageControlSuiteBp")).toEqual({ ok: false, reason: "undiscovered" });
  });

  it("gate ORDER: `undiscovered` surfaces before tierLocked (the relic is the more fundamental lock)", () => {
    const lowLab: GameState = { ...labReady(), facilities: { ...freshState().facilities, [RESEARCH_FACILITY_KEY]: { level: 1 } } };
    expect(canResearch(lowLab, "damageControlSuiteBp")).toEqual({ ok: false, reason: "undiscovered" });
    // Once discovered, the tier gate is what remains (tier 2 > lab level 1).
    expect(canResearch(discovered(lowLab, "ancientDriveCoil"), "damageControlSuiteBp")).toEqual({ ok: false, reason: "tierLocked" });
  });

  it("UNGATED blueprints are unchanged: the same verdict with no relics discovered as with every relic discovered", () => {
    const none = labReady();
    const all = discovered(labReady(), ...RELICS.map((r) => r.id));
    for (const bp of UNGATED) {
      expect(blueprintRelicLocked(none, bp.key)).toBe(false);
      expect(canResearch(none, bp.key)).toEqual(canResearch(all, bp.key));
      expect(blueprintResearchable(none, bp.key)).toBe(blueprintResearchable(all, bp.key));
    }
    // And on a fresh save too (lab level 1, starting credits).
    const fresh = freshState();
    const freshAll = discovered(freshState(), ...RELICS.map((r) => r.id));
    for (const bp of UNGATED) expect(canResearch(fresh, bp.key)).toEqual(canResearch(freshAll, bp.key));
  });

  it("canEnqueueOrder refuses a still-gated project with `undiscovered`, and accepts it once discovered", () => {
    const order = { type: "research" as const, blueprintKey: "pathfinderSuiteBp" };
    expect(canEnqueueOrder(labReady(), "researchLab", order)).toEqual({ ok: false, reason: "undiscovered" });
    expect(canEnqueueOrder(discovered(labReady(), "deepVeinCompass"), "researchLab", order).ok).toBe(true);
  });

  it("END TO END: a real relic study's FIRST FIND of the Ancient Drive Coil opens the Damage Control Suite project", () => {
    // Find a Shipwright token whose keyed identification reveals the Ancient Drive Coil (a pure search over
    // token ids: identifyStudiedRelic is the same derivation the resolver uses).
    const base = labReady();
    const studyIndex = base.nextRelicStudyIndex ?? 1;
    const poiId = RELIC_SETS.find((st) => st.id === "shipwright")!.sources[0];
    let tok: RelicVaultToken | null = null;
    for (let k = 1; k <= 2000 && tok === null; k++) {
      const t: RelicVaultToken = { id: `tok-${k}`, tier: "radiant", quality: 0, setId: "shipwright", poiId };
      if (identifyStudiedRelic(base, t, studyIndex) === "ancientDriveCoil") tok = t;
    }
    expect(tok).not.toBeNull();
    const s: GameState = { ...base, relicVault: [tok!] };
    expect(canResearch(s, "damageControlSuiteBp")).toEqual({ ok: false, reason: "undiscovered" });
    const started = startRelicStudy(s, tok!.id);
    expect(started.started).toBe(true);
    const proc = started.next.activeProcesses.find((p) => p.kind === "relicStudy")!;
    const after = resolveProcesses(started.next, proc.remainingTicks, () => 0).next;
    expect(after.relicDiscovered).toContain("ancientDriveCoil");
    expect(canResearch(after, "damageControlSuiteBp")).toEqual({ ok: true });
    // The other two stay locked (their relics were not found).
    expect(canResearch(after, "pathfinderSuiteBp")).toEqual({ ok: false, reason: "undiscovered" });
  });
});

// ============================================================================
describe("E4d masked catalog copy (no spoilers)", () => {
  it("names the relic's SET, never the relic itself nor the project it unlocks", () => {
    for (const bp of GATED) {
      const relic = getRelicById(bp.requiresRelicDiscovery!)!;
      const setLabel = getRelicSetById(relic.setId)!.label;
      const mask = undiscoveredResearchMask(bp.requiresRelicDiscovery);
      expect(mask.title).toBe("Undiscovered research");
      expect(mask.detail).toBe(`Requires a ${setLabel} relic discovery`);
      const text = `${mask.title} ${mask.detail}`.toLowerCase();
      expect(text).not.toContain(relic.label.toLowerCase()); // the relic stays a secret
      expect(text).not.toContain(bp.label.replace(/\s+Blueprint$/, "").toLowerCase()); // so does the project
    }
  });

  it("an unknown / absent relic id falls back to a neutral line (never an id leak)", () => {
    expect(undiscoveredResearchMask("notARelic").detail).toBe("Requires a relic discovery");
    expect(undiscoveredResearchMask(undefined).detail).toBe("Requires a relic discovery");
  });

  it("no em dashes or double hyphens in the new copy", () => {
    const copy = [
      ...GATED.flatMap((bp) => [bp.label, bp.flavor ?? "", bp.unlockHint ?? "", undiscoveredResearchMask(bp.requiresRelicDiscovery).detail]),
      ...EQUIPMENT_SLOTS.specUtility.varieties.map((v) => v.label),
      getSensorArrayById("sensorBioResonance")!.label,
    ];
    for (const line of copy) {
      expect(line.includes("—"), line).toBe(false);
      expect(line.includes("--"), line).toBe(false);
    }
  });
});

// ============================================================================
describe("E4d reveal: the 'Research unlocked' line", () => {
  it("a FIRST FIND of a gating relic lists its project; a repeat copy or a non-gating relic lists nothing", () => {
    expect(researchUnlockedByFind("ancientDriveCoil", true)).toEqual(["Damage Control Suite"]);
    expect(researchUnlockedByFind("deepVeinCompass", true)).toEqual(["Pathfinder Suite"]);
    expect(researchUnlockedByFind("leviathanScale", true)).toEqual(["Bio-Resonance Array"]);
    expect(researchUnlockedByFind("ancientDriveCoil", false)).toEqual([]); // repeat copy
    expect(researchUnlockedByFind("glyphTablet", true)).toEqual([]); // gates nothing
    expect(researchUnlockedByFind("precursorLens", true)).toEqual(["Precursor Lens"]); // E-MOD EM-8
    expect(researchUnlockedByFind("precursorLens", false)).toEqual([]); // repeat copy
    expect(researchUnlockedByFind("heartOfTheArchive", true)).toEqual(["Neural Backup"]); // E-CREW Task 7
  });

  it("buildRelicReveal carries researchUnlocked (first find only)", () => {
    const rec = {
      id: "done-1",
      kind: "relicStudy" as const,
      reward: "relic" as const,
      atMs: 0,
      startedAtMs: 0,
      iterations: 1,
      items: [],
      pieces: 1,
      subjectKey: "leviathanScale",
      level: null,
      fuelAmount: null,
      creditsAmount: null,
      stale: false,
    };
    const s: GameState = withGeneralMuseumRecord(freshState(), { leviathanScale: 1 });
    expect(buildRelicReveal(s, rec, true, "radiant")!.researchUnlocked).toEqual(["Bio-Resonance Array"]);
    expect(buildRelicReveal(s, rec, false, "radiant")!.researchUnlocked).toEqual([]);
  });
});

// ============================================================================
describe("E4d items: generation + hull gating", () => {
  it("the utility families roll their OWN lines, stamp moduleVariant, and never roll the rig's extraction stat", () => {
    const dcs = mint("specUtility", "damageControlSuite", "dcs-1");
    expect(dcs.moduleVariant).toBe("damageControlSuite");
    expect(Object.keys(dcs.implicitStats).sort()).toEqual(["repairSpeed", "waveHullRegen"]);
    for (const k of Object.keys(dcs.rolledStats)) expect(["repairSpeed", "waveHullRegen"]).toContain(k);
    expect(dcs.implicitStats.extractionYieldMult).toBeUndefined();

    const pf = mint("specUtility", "pathfinderSuite", "pf-1");
    expect(pf.moduleVariant).toBe("pathfinderSuite");
    expect(Object.keys(pf.implicitStats).sort()).toEqual(["expeditionScanSpeed", "hazardResist", "sensors"]);
    for (const k of Object.keys(pf.rolledStats)) expect(["sensors", "expeditionScanSpeed", "hazardResist"]).toContain(k);
  });

  it("equipmentSlotLabel: existing varieties keep the catalog label; the relic-unlocked families read 'Spec Utility'", () => {
    for (const slotType of Object.keys(EQUIPMENT_SLOTS)) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
        if (v.key === "damageControlSuite" || v.key === "pathfinderSuite") continue;
        expect(equipmentSlotLabel(slotType, v.key)).toBe(EQUIPMENT_SLOTS[slotType].label);
      }
      expect(equipmentSlotLabel(slotType)).toBe(EQUIPMENT_SLOTS[slotType].label);
    }
    expect(equipmentSlotLabel("specUtility", "yieldRig")).toBe("Prospecting Rig");
    expect(equipmentSlotLabel("specUtility", "damageControlSuite")).toBe("Spec Utility");
    expect(equipmentSlotLabel("specUtility", "pathfinderSuite")).toBe("Spec Utility");
    expect(craftLineOutputLabel("fabricate", "damageControlSuiteBp")).toBe("Spec Utility · Damage Control Suite");
    expect(craftLineOutputLabel("fabricate", "yieldRigBp")).toBe("Prospecting Rig · Yield Rig");
    // Complement CP-12 (OC-25): the slot reads "Sensor Suite"; the array keeps its own name.
    expect(craftLineOutputLabel("fabricate", "bioResonanceArrayBp")).toBe("Sensor Suite · Bio-Resonance Array");
  });

  it("existing rigs are UNCHANGED: no moduleVariant, the slot's signature line", () => {
    const rig = mint("specUtility", "yieldRig", "rig-1");
    expect(rig.moduleVariant).toBeUndefined();
    expect(Object.keys(rig.implicitStats)).toEqual(EQUIPMENT_SLOTS.specUtility.implicitStats);
  });

  const fitVerdict = (typeKey: ShipTypeKey, piece: EquipmentInstance) =>
    canFitEquipment(withEquipment(withHull(freshState(), typeKey), piece), "ship-1", piece.id);

  it("the Damage Control Suite installs on TACTICIAN hulls only", () => {
    const dcs = mint("specUtility", "damageControlSuite", "dcs-1");
    for (const t of ["destroyer", "battleship", "carrier"] as ShipTypeKey[]) expect(fitVerdict(t, dcs)).toEqual({ ok: true });
    for (const t of ["generalFreighter", "prospectorMiner", "orion"] as ShipTypeKey[]) {
      expect(fitVerdict(t, dcs)).toEqual({ ok: false, reason: "hullSpec" });
    }
  });

  it("the Pathfinder Suite installs on EXPLORER hulls only", () => {
    const pf = mint("specUtility", "pathfinderSuite", "pf-1");
    for (const t of ["orion", "aurora", "eir"] as ShipTypeKey[]) expect(fitVerdict(t, pf)).toEqual({ ok: true });
    for (const t of ["generalFreighter", "prospectorMiner", "destroyer"] as ShipTypeKey[]) {
      expect(fitVerdict(t, pf)).toEqual({ ok: false, reason: "hullSpec" });
    }
  });

  it("a prospecting rig keeps the slot's prospector gate (refused on tactician / explorer hulls)", () => {
    const rig = mint("specUtility", "yieldRig", "rig-1");
    expect(fitVerdict("prospectorMiner", rig)).toEqual({ ok: true });
    expect(fitVerdict("destroyer", rig)).toEqual({ ok: false, reason: "hullSpec" });
    expect(fitVerdict("orion", rig)).toEqual({ ok: false, reason: "hullSpec" });
  });

  it("the Bio-Resonance Array is an ungated sensor array (any hull, like its siblings)", () => {
    const bio = mint("sensor", "sensorBioResonance", "bio-1");
    expect(bio.moduleVariant).toBe("sensorBioResonance");
    expect(fitVerdict("generalFreighter", bio)).toEqual({ ok: true });
    expect(fitVerdict("orion", bio)).toEqual({ ok: true });
  });

  it("the Armory applies the same hull gate to a loadout install", () => {
    const dcs = mint("specUtility", "damageControlSuite", "dcs-1");
    const base = withEquipment(freshState(), dcs);
    const withLoadout = (typeKey: ShipTypeKey): GameState => ({
      ...base,
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: typeKey, slots: {}, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    });
    const onProspector = withLoadout("prospectorMiner");
    expect(installIntoLoadout(onProspector, "loadout-1", "specUtility", "dcs-1")).toBe(onProspector); // refused
    const onDestroyer = installIntoLoadout(withLoadout("destroyer"), "loadout-1", "specUtility", "dcs-1");
    expect(onDestroyer.loadouts[0].slots.specUtility).toBe("dcs-1");
  });
});

// ============================================================================
describe("E4d Damage Control Suite: faster post-loss repair", () => {
  const dcsOn = (shipId: string) => mint("specUtility", "damageControlSuite", "dcs-1", { fittedTo: shipId });

  it("damageControlEffect is exact zeros without the suite (absent gear, empty gear, other gear)", () => {
    expect(damageControlEffect(undefined)).toEqual({ repairTimeReduction: 0, waveHullRegenFraction: 0 });
    expect(damageControlEffect([])).toEqual({ repairTimeReduction: 0, waveHullRegenFraction: 0 });
    expect(damageControlEffect(freshState().equipment)).toEqual({ repairTimeReduction: 0, waveHullRegenFraction: 0 });
    // A Pathfinder (a different family in the same slot) contributes nothing here.
    expect(damageControlEffect([mint("specUtility", "pathfinderSuite", "pf")])).toEqual({ repairTimeReduction: 0, waveHullRegenFraction: 0 });
  });

  it("the suite's effect is positive, below its curve's asymptote (no hard cap, D23), and grows with a richer roll", () => {
    const weak = damageControlEffect([mint("specUtility", "damageControlSuite", "a", { iLevel: 10, quality: 0, rarity: "standard" })]);
    const strong = damageControlEffect([mint("specUtility", "damageControlSuite", "b", { iLevel: 40, quality: 5, rarity: "radiant" })]);
    expect(weak.repairTimeReduction).toBeGreaterThan(0);
    expect(weak.waveHullRegenFraction).toBeGreaterThan(0);
    expect(strong.repairTimeReduction).toBeGreaterThan(weak.repairTimeReduction);
    expect(strong.waveHullRegenFraction).toBeGreaterThan(weak.waveHullRegenFraction);
    expect(strong.repairTimeReduction).toBeLessThan(DC_REPAIR_SPEED_B / (1 - DC_REPAIR_SPEED_R));
    expect(strong.waveHullRegenFraction).toBeLessThan(DC_WAVE_REGEN_B / (1 - DC_WAVE_REGEN_R));
  });

  it("damageControlRepairTicks: base unchanged at 0, ceil + >= 1 otherwise", () => {
    expect(damageControlRepairTicks(170, 0)).toBe(170);
    expect(damageControlRepairTicks(170, 0.2)).toBe(Math.ceil(170 * 0.8));
    expect(damageControlRepairTicks(1, 0.5)).toBe(1);
  });

  it("shipRepairDurationTicks is SHORTER with the suite installed, and unchanged without it", () => {
    const ship: ShipInstance = { id: "ship-1", typeKey: "destroyer", assignedCaptainId: null, damaged: true, repairDamage: 300 };
    const base = REPAIR_BASE_TICKS + Math.ceil(300 * REPAIR_TICKS_PER_HULL);
    expect(shipRepairDurationTicks(ship)).toBe(base);
    expect(shipRepairDurationTicks(ship, [])).toBe(base);
    const gear = [dcsOn("ship-1")];
    const r = damageControlEffect(gear).repairTimeReduction;
    expect(shipRepairDurationTicks(ship, gear)).toBe(Math.ceil(base * (1 - r)));
    expect(shipRepairDurationTicks(ship, gear)).toBeLessThan(base);
  });

  it("processShipRepairs starts the shorter repair for a damaged hull carrying the suite (fixed at start)", () => {
    const s0 = installMissingCombatBaselines(withHull(freshState(), "destroyer"));
    const damaged = (s: GameState): GameState => ({
      ...s,
      ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 200 } : sh)),
    });
    const plain = processShipRepairs(damaged(s0)).activeProcesses.find((p) => p.kind === "shipRepair")!;
    const withSuite = damaged(withEquipment(s0, dcsOn("ship-1")));
    const fast = processShipRepairs(withSuite).activeProcesses.find((p) => p.kind === "shipRepair")!;
    expect(plain.durationTicks).toBe(REPAIR_BASE_TICKS + Math.ceil(200 * REPAIR_TICKS_PER_HULL));
    expect(fast.durationTicks).toBe(shipRepairDurationTicks(ship1(withSuite), equippedFor(withSuite, "ship-1")));
    expect(fast.durationTicks).toBeLessThan(plain.durationTicks);
  });
});

// ============================================================================
describe("E4d Damage Control Suite: between-wave hull regen", () => {
  // The Warband (not the Sweep): a destroyer clears the Sweep without losing hull, which would make the
  // patch-up a no-op; the Warband wounds it between waves on several seeds, so the regen really fires.
  const PATROL_KEY = "crimsonReaverWarband";
  const DEF = PATROLS[PATROL_KEY];
  const RNG = () => 0.5;

  function patrolState(seed: number, suite: "fitted" | "spare" | "none"): GameState {
    let s = installMissingCombatBaselines({
      ...withHull(freshState(), "destroyer"),
      nextPatrolSeed: seed,
      credits: new Decimal(100000),
    });
    if (suite !== "none") s = withEquipment(s, mint("specUtility", "damageControlSuite", "dcs-1", { fittedTo: suite === "fitted" ? "ship-1" : null, iLevel: 40, quality: 5, rarity: "radiant" }));
    return s;
  }
  function dispatch(s: GameState): GameState {
    const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(s, 1, PATROL_KEY, "balanced", false));
    expect(r.success).toBe(true);
    return r.next;
  }

  it("the shared leaf: no regen before the OPENING wave or without the suite; + floor(max * f) clamped otherwise", () => {
    expect(damageControlBeforeWave(0, 300, 100, 0.05)).toBe(100); // opening wave: untouched
    expect(damageControlBeforeWave(2, 300, 100, 0)).toBe(100); // no suite: untouched
    expect(damageControlBeforeWave(1, 300, 100, 0.05)).toBe(115); // +floor(300 * 0.05)
    expect(damageControlBeforeWave(1, 300, 295, 0.05)).toBe(300); // clamped to max
    expect(damageControlBeforeWave(1, 300, 320, 0.05)).toBe(320); // never lowers an over-max carry
    expect(damageControlWaveRegen(300, 100, 0.001)).toBe(100); // a sub-point fraction rounds to nothing
  });

  it("resolvePatrolWaves: a later wave opens with the patched hull; the opening wave and a no-suite run are untouched", () => {
    const stats = SHIP_TYPES.destroyer;
    const hullType = combatHullTypeOf("destroyer")!;
    let qualifying = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = patrolState(seed, "fitted");
      const gearWith = equippedFor(s, "ship-1");
      const gearWithout = gearWith.filter((e) => e.id !== "dcs-1");
      const frac = damageControlEffect(gearWith).waveHullRegenFraction;
      expect(frac).toBeGreaterThan(0);
      const run = (gear: EquipmentInstance[]) => {
        const folded = foldedPlayerDefense(stats, gear);
        return {
          folded,
          r: resolvePatrolWaves({
            playerId: "ship-1",
            stats,
            hullType,
            stance: "balanced",
            installedGear: gear,
            masterSeed: seed * 7919,
            factionId: "test",
            def: DEF,
            startHull: Math.floor(folded.hullMax * 0.7), // a damaged start so the carry is below max
            startShield: folded.shieldMax,
            startDrones: [],
            startSystemDurability: defaultSystemDurabilityForHull(hullType, stats, gear),
          }),
        };
      };
      const plain = run(gearWithout).r;
      const { r: patched, folded } = run(gearWith);
      // The opening wave never regens.
      expect(patched.waves[0].playerStart.hull).toBe(Math.floor(folded.hullMax * 0.7));
      // Without the suite the hull carries straight through (attrition).
      if (plain.waves.length >= 2 && plain.waves[0].playerWon) {
        expect(plain.waves[1].playerStart.hull).toBe(plain.waves[0].playerEnd!.hull);
      }
      if (patched.waves.length >= 2 && patched.waves[0].playerWon) {
        const end0 = patched.waves[0].playerEnd!.hull;
        expect(patched.waves[1].playerStart.hull).toBe(damageControlWaveRegen(folded.hullMax, end0, frac));
        if (end0 < folded.hullMax) {
          expect(patched.waves[1].playerStart.hull).toBeGreaterThan(end0);
          qualifying++;
        }
      }
    }
    expect(qualifying).toBeGreaterThan(0); // non-vacuous: the patch-up really fired
  });

  // Drive the LIVE loop to completion, capturing the carry hull the instant each wave is won.
  function runLive(state0: GameState): { wonHulls: number[]; wavesWon: number; damaged: boolean } {
    let s = state0;
    let prev = 0;
    let wavesWon = 0;
    const wonHulls: number[] = [];
    for (let i = 0; i < 60; i++) {
      s = economyTick(s, 1, RNG);
      const m = s.captains[0].mission as PatrolMissionState | null;
      if (m && m.kind === "patrol") {
        wavesWon = m.wavesWon;
        if (m.wavesWon > prev) {
          wonHulls.push(m.playerHull);
          prev = m.wavesWon;
        }
      }
    }
    return { wonHulls, wavesWon, damaged: s.ships[0].damaged === true };
  }

  it("LIVE == REPLAY with the suite fitted (per-won-wave carry hull, wins, defeat), across seeds", () => {
    let liveDiffers = 0;
    for (const seed of [1, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]) {
      const dispatched = dispatch(patrolState(seed, "fitted"));
      const replay = replayPatrol(dispatched, dispatched.captains[0]);
      const live = runLive(dispatched);
      const won = replay.waves.filter((w) => w.playerWon);
      expect(replay.wavesWon).toBe(live.wavesWon);
      expect(won.map((w) => w.playerEnd!.hull)).toEqual(live.wonHulls);
      expect(replay.defeated).toBe(live.damaged);
      // Non-vacuity: the live loop really applies the patch-up (its carry differs from the same patrol
      // flown with the suite sitting unfitted in the pool) on at least one seed.
      const without = runLive(dispatch(patrolState(seed, "spare")));
      if (JSON.stringify(without.wonHulls) !== JSON.stringify(live.wonHulls)) liveDiffers++;
    }
    expect(liveDiffers).toBeGreaterThan(0);
  });

  it("OFFLINE == LIVE with the suite fitted: one big economyTick == stepped 1-tick calls", () => {
    for (const seed of [2, 9, 21]) {
      const d = dispatch(patrolState(seed, "fitted"));
      const big = economyTick(d, 40, RNG);
      let stepped = d;
      for (let i = 0; i < 40; i++) stepped = economyTick(stepped, 1, RNG);
      expect(big.captains).toEqual(stepped.captains);
      expect(big.ships).toEqual(stepped.ships);
    }
  });

  it("ADDITIVE-NEUTRAL: a suite sitting in the pool UNFITTED changes nothing about the patrol", () => {
    for (const seed of [1, 4, 8, 15]) {
      const none = runLive(dispatch(patrolState(seed, "none")));
      const spare = runLive(dispatch(patrolState(seed, "spare")));
      expect(spare).toEqual(none);
      const a = dispatch(patrolState(seed, "none"));
      const b = dispatch(patrolState(seed, "spare"));
      expect(economyTick(b, 30, RNG).captains).toEqual(economyTick(a, 30, RNG).captains);
    }
  });
});

// ============================================================================
describe("E4d expedition gear: Pathfinder Suite + Bio-Resonance Array feed the dispatch snapshot", () => {
  // D18: the ship gets the minimum away team first (the gate itself is tested in expedition.test.ts).
  const dispatch = (base: GameState) => {
    const s = ensureMinimumAwayTeam(base);
    const cand = expeditionCandidates(s, "ship-1")[0];
    return dispatchPastPropulsion(s, "ship-1", 1, cand.id);
  };
  // NOTE: the snapshot reads whatever is installed; these fixtures place the piece straight onto ship-1 (the
  // install GATE is covered above), so the snapshot math is tested in isolation from hull rules.
  const pathfinder = () => mint("specUtility", "pathfinderSuite", "pf-1", { fittedTo: "ship-1" });
  const bio = (over: { quality?: number; rarity?: EquipmentRarity } = {}) =>
    mint("sensor", "sensorBioResonance", "bio-1", { fittedTo: "ship-1", ...over });
  const balanced = () => mint("sensor", "sensorBalanced", "bal-1", { fittedTo: "ship-1" });

  it("no gear: the snapshot is EXACTLY the museum's (zeros on an empty museum) and gear bonuses are zero", () => {
    const s = freshState();
    expect(expeditionGearBonuses(s, ship1(s))).toEqual({ scanSpeed: 0, hazardResist: 0, relicFindChance: 0 });
    const exp = dispatch(s).expedition!;
    expect(exp.scanSpeedBonus).toBe(0);
    expect(exp.relicFindBonus).toBe(0);
    expect(exp.hazardResist).toBe(0);
    // Every pre-E4d array carries relicFindBonus 0, so an existing array loadout snapshots the museum's value exactly.
    for (const def of SENSOR_ARRAYS.filter((a) => a.id !== "sensorBioResonance")) expect(def.relicFindBonus).toBe(0);
    const withBal = withEquipment(s, balanced());
    expect(sensorArrayRelicFindBonus(installedSensorArray(withBal, ship1(withBal)))).toBe(0);
    expect(dispatch(withBal).expedition!.relicFindBonus).toBe(0);
  });

  it("the Pathfinder Suite adds its scan speed + hazard resist to the snapshot (and its sensors fold into sensorPower)", () => {
    const plain = freshState();
    const s = withEquipment(plain, pathfinder());
    const fx = pathfinderEffect(equippedFor(s, "ship-1"));
    expect(fx.scanSpeed).toBeGreaterThan(0);
    expect(fx.hazardResist).toBeGreaterThan(0);
    const exp = dispatch(s).expedition!;
    expect(exp.scanSpeedBonus).toBe(fx.scanSpeed);
    expect(exp.hazardResist).toBe(fx.hazardResist);
    expect(exp.relicFindBonus).toBe(0); // the suite does not touch relic odds
    expect(exp.sensorPower).toBe(effectiveShipStats(s, ship1(s)).sensors);
    expect(exp.sensorPower).toBeGreaterThan(dispatch(plain).expedition!.sensorPower);
  });

  it("gear stacks ADDITIVELY on top of the museum's snapshot values", () => {
    const museum: Record<string, number> = {};
    for (const r of RELICS) museum[r.id] = 40;
    const s = withGeneralMuseumRecord(withEquipment(freshState(), pathfinder(), bio()), museum);
    const b = museumBonuses(s);
    const gear = expeditionGearBonuses(s, ship1(s));
    const exp = dispatch(s).expedition!;
    expect(exp.scanSpeedBonus).toBe(b.scanSpeed + gear.scanSpeed);
    expect(exp.hazardResist).toBe(b.hazardResist + gear.hazardResist);
    expect(exp.relicFindBonus).toBe(b.relicFindChance + gear.relicFindChance);
  });

  it("the Bio-Resonance Array snapshots a rarity/quality-scaled relic-find bonus and the SLOWEST scan cadence", () => {
    const s = withEquipment(freshState(), bio());
    const installed = installedSensorArray(s, ship1(s))!;
    expect(installed.def.kind).toBe("bioResonance");
    const exp = dispatch(s).expedition!;
    expect(exp.sensorArrayId).toBe("sensorBioResonance");
    expect(exp.relicFindBonus).toBe(sensorArrayRelicFindBonus(installed));
    expect(exp.relicFindBonus).toBeGreaterThan(0);
    // A richer array finds more.
    const rich = withEquipment(freshState(), bio({ quality: 5, rarity: "radiant" }));
    expect(sensorArrayRelicFindBonus(installedSensorArray(rich, ship1(rich)))).toBeGreaterThan(exp.relicFindBonus);
    // The cost: the slowest cadence of any array.
    for (const def of SENSOR_ARRAYS) {
      if (def.id !== "sensorBioResonance") expect(installed.def.scanRateMult).toBeLessThan(def.scanRateMult);
    }
    expect(sensorArrayEffect(installed).scanRateMult).toBe(installed.def.scanRateMult);
  });

  it("Bio-Resonance RAISES relic find chance (through the real consumer) and SCANS SLOWER than a Balanced array", () => {
    const bioState = withEquipment(freshState(), bio());
    const balState = withEquipment(freshState(), balanced());
    const bioExp = dispatch(bioState).expedition!;
    const balExp = dispatch(balState).expedition!;
    // Relic chance: the snapshotted bonus feeds rollRelicToken's findBonus (the one consumer).
    const poi = RELIC_SETS[0].sources[0];
    let hitsBal = 0;
    let hitsBio = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      if (rollRelicToken(seed, 0, poi, "r", balExp.relicFindBonus)) hitsBal++;
      if (rollRelicToken(seed, 0, poi, "r", bioExp.relicFindBonus)) hitsBio++;
    }
    expect(hitsBio).toBeGreaterThan(hitsBal);
    // Scanning: the same body, the same elapsed time, less of it scanned under the Bio-Resonance cadence.
    const scanning = (e: Expedition): Expedition => ({
      ...e,
      phase: "scanning",
      phaseAnchorSeconds: 0,
      bodies: [{ id: "body-1", planetType: "terrestrial", scanTotal: 200, scanProgress: 0, hazard: 0.2, scanned: false, discoveries: [], activities: [] }],
    });
    expect(bioExp.sensorPower).toBe(balExp.sensorPower); // same sensors line, so only the cadence differs
    const bioProg = advanceExpedition(scanning(bioExp), 100).bodies[0].scanProgress;
    const balProg = advanceExpedition(scanning(balExp), 100).bodies[0].scanProgress;
    expect(bioProg).toBeLessThan(balProg);
  });

  it("IN-FLIGHT runs are fixed: changing the ship's gear after dispatch changes nothing", () => {
    const launched = dispatch(withEquipment(freshState(), pathfinder(), bio())).next;
    const later = { ...launched, gameTimeSeconds: launched.gameTimeSeconds + 40_000 };
    const stripped = { ...later, equipment: later.equipment.filter((e) => e.id !== "pf-1" && e.id !== "bio-1") };
    expect(resolveExpeditions(stripped).expeditions).toEqual(resolveExpeditions(later).expeditions);
    // And the reverse: gear added after a bare dispatch does not reach back into the run.
    const bare = dispatch(freshState()).next;
    const bareLater = { ...bare, gameTimeSeconds: bare.gameTimeSeconds + 40_000 };
    const geared = withEquipment(bareLater, pathfinder(), bio());
    expect(resolveExpeditions(geared).expeditions).toEqual(resolveExpeditions(bareLater).expeditions);
  });
});

// ============================================================================
describe("E4d Bio-Resonance Array: the first CRAFTABLE sensor array", () => {
  it("a completing Fabricator job on its blueprint mints a real, installable sensor array", () => {
    const s0 = freshState();
    const job: TimedProcess = {
      id: "proc-bio",
      kind: "fabricateJob",
      remainingTicks: 1,
      durationTicks: BLUEPRINTS.bioResonanceArrayBp.craftDurationTicks,
      effect: { type: "addEquipment", blueprintKey: "bioResonanceArrayBp" },
    };
    const before = s0.equipment.length;
    const after = resolveProcesses({ ...s0, activeProcesses: [job] }, 1, seededRng(7)).next;
    expect(after.equipment.length).toBe(before + 1);
    const minted = after.equipment[after.equipment.length - 1];
    expect(minted.slotType).toBe("sensor");
    expect(minted.moduleVariant).toBe("sensorBioResonance");
    expect(minted.blueprintKey).toBe("bioResonanceArrayBp");
    expect(minted.implicitStats.sensors).toBeGreaterThan(0);
    // Installable, and once installed it resolves as the Bio-Resonance array.
    expect(canFitEquipment(after, "ship-1", minted.id)).toEqual({ ok: true });
    const fitted = { ...after, equipment: after.equipment.map((e) => (e.id === minted.id ? { ...e, fittedToShipId: "ship-1" } : e)) };
    expect(installedSensorArray(fitted, ship1(fitted))?.def.id).toBe("sensorBioResonance");
  });

  it("the two utility blueprints mint their families through the same path", () => {
    for (const [bpKey, variant] of [["damageControlSuiteBp", "damageControlSuite"], ["pathfinderSuiteBp", "pathfinderSuite"]] as const) {
      const job: TimedProcess = {
        id: `proc-${bpKey}`,
        kind: "fabricateJob",
        remainingTicks: 1,
        durationTicks: BLUEPRINTS[bpKey].craftDurationTicks,
        effect: { type: "addEquipment", blueprintKey: bpKey },
      };
      const after = resolveProcesses({ ...freshState(), activeProcesses: [job] }, 1, seededRng(3)).next;
      const minted = after.equipment[after.equipment.length - 1];
      expect(minted.slotType).toBe("specUtility");
      expect(minted.moduleVariant).toBe(variant);
    }
  });
});
