// 0.14.0 SENSORS (DORMANT): the SCANNING-ARRAY catalog + its pure EFFECT readers for the sensor slot.
//
// A sensor is a normal EquipmentInstance on the `sensor` slot (model.ts EQUIPMENT_SLOTS): a craftable,
// rollable, ALLOW-EMPTY singleton (quality / rarity / iLevel). WHICH scanning array it is lives on the
// instance as `moduleVariant` (a catalog id, stamped by generateEquipment), exactly like a crew module.
// This module owns the SENSOR_ARRAYS catalog (4 arrays since E4d added the
// Bio-Resonance relic hunter) and the pure functions that turn an installed
// piece into its scan-behavior params.
//
// ⚠️ NOTHING HERE IS CONSUMED YET (DORMANT). Exploration (the scan/survey system, design I.2) is the
// consumer of these params and is NOT built. So this file is pure DATA + pure READERS: it mutates no
// state, and no game system reads it. It exists so the sensor ITEM can be built, held, and equipped
// ahead of the exploration system, and so the array's first-pass tunable params have a durable home.
//
// PAIRING (design I.6, LOCKED): REACH = how far you can GO; SENSORS = how far / well you can SEE + ACT.
// TWO EFFECT AXES, deliberately separated:
//   1. The scalar sensor ROLES, all driven by the `sensors` POWER stat (NOT by the variant): survey
//      power (%/sec scan), foreknowledge (preview a destination's rewards/hazards), rare/anomaly
//      detection, frontier gating (a threshold to attempt deeper regions), and a combat cloak/threat
//      hook. These scale with the piece's `sensors` line (rarity/quality/iLevel via the budget), which
//      is why the slot's signature stat is `sensors`. This file does NOT model them: they belong with
//      the exploration consumer, keyed off the folded `sensors` total.
//   2. The scanning-ARRAY character, driven by the VARIANT (this catalog): WIDE-beam vs FOCUSED-beam vs
//      BALANCED shape HOW a scan sweeps a body (cadence, coverage per pass, and which discovery odds it
//      biases). That is what SENSOR_ARRAYS + sensorArrayEffect below describe.
//
// ⚠️ ALL MAGNITUDES BELOW ARE FIRST-PASS + TUNABLE launch placeholders (the balance pass + the
// exploration build own the real numbers), the same posture as SHIP_TYPES / the crew-module catalogs.
// EXPLICITLY DEFERRED (design I.6, do NOT build here): explorer-hull BASE sensors (the explorer hull is
// not built) and Science-officer / Science-division sensor AMPLIFICATION (belongs with the crew overlay
// + exploration). This file is the sensor ITEM only.

import type { GameState, ShipInstance, EquipmentInstance, EquipmentRarity, EquipmentAscension } from "./model";
import { equippedFor } from "./equipment";
// Reuse the crew modules' rarity/quality effect scale: it is the identical "standard/q0 == 1.0, richer
// amplifies" curve a sensor wants, so a second copy of the same constants would only risk drift. It is a
// pure arithmetic helper, not crew-specific, and crewModules.ts does not import this file (no cycle).
import { moduleEffectScale } from "./crewModules";
import { viewPieceEfficiency } from "./gearWear";
import { GG7_NUMBERS, RESONANCE_SENSOR_ARRAY } from "./specialBlueprints";

// ============================================================================
// The scanning arrays (3): WIDE-beam / FOCUSED-beam / BALANCED
// ============================================================================

// E4d added "bioResonance": the relic-hunter array (the only one that raises relic find chance). Gas Giant Study GG-7
// added "resonance": the Resonance Sensor Array, a special blueprint (the only array that lifts the canister bands of a
// gas giant study).
export type SensorArrayKind = "wide" | "focused" | "balanced" | "bioResonance" | "resonance";

export interface SensorArrayDef {
  id: string; // == the sensor slot variety key (stamped onto the instance as moduleVariant)
  label: string;
  slot: "sensor";
  kind: SensorArrayKind;
  // FIRST-PASS TUNABLE scan-behavior params, ALL consumed by the future exploration scan loop:
  //
  // scanRateMult: multiplier on the per-pass scan CADENCE (how often a pass fires). 1.0 == the BALANCED
  //   baseline. Wide < 1 (slower passes); Focused > 1 (faster cadence). The array's fixed CHARACTER, so
  //   it does NOT scale with rarity/quality (see sensorArrayEffect).
  scanRateMult: number;
  // coverageWidth: relative area a SINGLE pass sweeps (the "% scanned per pass" lever). 1.0 == the
  //   BALANCED baseline. Wide > 1 (wider coverage per pass); Focused < 1 (smaller % per pass). Also the
  //   array's fixed character, not rarity-scaled.
  coverageWidth: number;
  // landmarkOddsBias: ADDITIVE bias to the odds of certain (surface) LANDMARK types on a pass, the
  //   WIDE-beam quirk ("better odds of certain landmark types"). 0 for an array that does not favor them.
  //   SCALES with rarity/quality (a richer sensor detects more), see sensorArrayEffect.
  landmarkOddsBias: number;
  // undergroundPoiOddsBias: ADDITIVE bias to the odds of UNDERGROUND special PoIs, the FOCUSED-beam
  //   quirk ("higher odds of underground special PoIs"). 0 otherwise. SCALES with rarity/quality.
  undergroundPoiOddsBias: number;
  // Exploration 0.14.0 (E4d): an ADDITIVE relic-find bonus fraction, folded into the expedition's
  //   dispatch-time relicFindBonus snapshot (alongside the museum's relicFindChance; a won task's relic
  //   token chance is x (1 + bonus), capped at certain, gambit.ts rollRelicToken). 0 for every array except
  //   the Bio-Resonance Array, the relic hunter. SCALES with rarity/quality like the discovery biases (see
  //   sensorArrayRelicFindBonus). Deliberately NOT part of sensorArrayEffect / ExpeditionScanParams, so the
  //   scan-param snapshot shape every existing expedition stores is unchanged.
  relicFindBonus: number;
  // Gas Giant Study GG-7 (user 2026-10-27, "Better canister odds"): a RELATIVE lift on the Augmented and Stellar band
  //   odds of every gas giant study of a run (gasGiantStudy.ts liftedBandOdds), frozen at dispatch (Expedition.bandLift).
  //   0 for every array except the Resonance Sensor Array. SCALES with rarity/quality (sensorArrayCanisterBandLift).
  canisterBandLift: number;
}

// FIRST-PASS magnitudes. BALANCED is the 1.0/1.0 baseline with a small even bias to both discovery
// kinds; WIDE trades cadence for coverage + a landmark bias; FOCUSED trades coverage for cadence + an
// underground-PoI bias. TUNABLE.
export const SENSOR_ARRAYS: readonly SensorArrayDef[] = [
  // WIDE-beam: slower passes, wider coverage, better odds of certain (surface) landmark types.
  {
    id: "sensorWideBeam",
    label: "Wide-Beam Array",
    slot: "sensor",
    kind: "wide",
    scanRateMult: 0.8,
    coverageWidth: 1.5,
    landmarkOddsBias: 0.15,
    undergroundPoiOddsBias: 0,
    relicFindBonus: 0,
    canisterBandLift: 0,
  },
  // FOCUSED-beam: faster per-pass cadence, smaller % per pass, higher odds of UNDERGROUND special PoIs.
  {
    id: "sensorFocusedBeam",
    label: "Focused-Beam Array",
    slot: "sensor",
    kind: "focused",
    scanRateMult: 1.3,
    coverageWidth: 0.6,
    landmarkOddsBias: 0,
    undergroundPoiOddsBias: 0.2,
    relicFindBonus: 0,
    canisterBandLift: 0,
  },
  // BALANCED: the neutral middle option, a mix of both.
  {
    id: "sensorBalanced",
    label: "Balanced Array",
    slot: "sensor",
    kind: "balanced",
    scanRateMult: 1.0,
    coverageWidth: 1.0,
    landmarkOddsBias: 0.05,
    undergroundPoiOddsBias: 0.05,
    relicFindBonus: 0,
    canisterBandLift: 0,
  },
  // BIO-RESONANCE (Exploration 0.14.0, E4d): the RELIC HUNTER. The only array that raises relic find chance
  // (relicFindBonus, +25% relative at standard/q0, rarity/quality-scaled), paid for with the SLOWEST scan
  // cadence of any array (scanRateMult 0.7) and no discovery-odds bias. The first CRAFTABLE array (its
  // blueprint is discovery-gated by the Leviathan Scale). FIRST-PASS TUNABLE.
  {
    id: "sensorBioResonance",
    label: "Bio-Resonance Array",
    slot: "sensor",
    kind: "bioResonance",
    scanRateMult: 0.7,
    coverageWidth: 1.0,
    landmarkOddsBias: 0,
    undergroundPoiOddsBias: 0,
    relicFindBonus: 0.25,
    canisterBandLift: 0,
  },
  // RESONANCE (Gas Giant Study GG-7, user call 11 "Three now"): the Resonance Sensor Array, a special blueprint opened
  // by a decoded ancient entry (model.ts resonanceSensorArrayBp, cooled on a Helium-3 Canister). It reads a giant's
  // depths from orbit, so every gas giant study of its run rolls richer canister bands (user 2026-10-27, "Better canister
  // odds"; [PROVISIONAL] size in specialBlueprints.ts GG7_NUMBERS). Balanced cadence and coverage, no discovery bias.
  {
    id: RESONANCE_SENSOR_ARRAY,
    label: "Resonance Sensor Array",
    slot: "sensor",
    kind: "resonance",
    scanRateMult: 1.0,
    coverageWidth: 1.0,
    landmarkOddsBias: 0,
    undergroundPoiOddsBias: 0,
    relicFindBonus: 0,
    canisterBandLift: GG7_NUMBERS.resonanceSensorArray.canisterBandLift,
  },
];

// ============================================================================
// Catalog lookup (built once; ids asserted globally unique)
// ============================================================================

const SENSOR_ARRAY_BY_ID: Map<string, SensorArrayDef> = (() => {
  const map = new Map<string, SensorArrayDef>();
  for (const def of SENSOR_ARRAYS) {
    if (map.has(def.id)) throw new Error(`Duplicate sensor array id: ${def.id}`);
    map.set(def.id, def);
  }
  return map;
})();

// Look up a sensor array def by id (its moduleVariant), or undefined. Pure reader.
export function getSensorArrayById(id: string): SensorArrayDef | undefined {
  return SENSOR_ARRAY_BY_ID.get(id);
}

// ============================================================================
// Installed-array resolution (pure reads over the fitment authority)
// ============================================================================

// A resolved installed sensor array: the catalog def + the concrete instance (for its rarity/quality).
export interface InstalledSensorArray {
  def: SensorArrayDef;
  instance: EquipmentInstance;
}

// The sensor array installed on a ship, or null (empty slot / no recognizable variant). Reads the
// fitment authority (equippedFor) filtered to the sensor slot; a slot is a singleton so at most one
// matches. Mirrors crewModules' installedQuartersModule / installedBridgeModule. Pure.
export function installedSensorArray(state: GameState, ship: ShipInstance): InstalledSensorArray | null {
  const piece = equippedFor(state, ship.id).find((e) => e.slotType === "sensor");
  if (!piece || piece.moduleVariant === undefined) return null;
  const def = getSensorArrayById(piece.moduleVariant);
  return def ? { def, instance: piece } : null;
}

// ============================================================================
// Effect params (pure)
// ============================================================================

// The resolved, rarity/quality-scaled scan-behavior params exploration will consume. The array's fixed
// CHARACTER (scanRateMult / coverageWidth) is the variant's identity and is NOT rarity-scaled; the
// DISCOVERY-ODDS biases (landmarkOddsBias / undergroundPoiOddsBias) DO scale (a richer sensor detects
// more), via moduleEffectScale (standard/q0 == 1.0). Pure arithmetic.
export interface SensorArrayEffect {
  scanRateMult: number;
  coverageWidth: number;
  landmarkOddsBias: number;
  undergroundPoiOddsBias: number;
}

// GEAR WEAR step 3: a worn array (read through the worn-gear view, gearWear.ts viewPieceEfficiency; exactly 1 on a
// stored piece) scans at its efficiency and biases its discoveries at it. Its coverage width is a count of bodies and
// never wears.
export function sensorArrayEffect(installed: InstalledSensorArray): SensorArrayEffect {
  const wear = viewPieceEfficiency(installed.instance);
  const scale = moduleEffectScale(installed.instance.rarity, installed.instance.quality, installed.instance.ascension) * wear;
  return {
    scanRateMult: installed.def.scanRateMult * wear,
    coverageWidth: installed.def.coverageWidth,
    landmarkOddsBias: installed.def.landmarkOddsBias * scale,
    undergroundPoiOddsBias: installed.def.undergroundPoiOddsBias * scale,
  };
}

// Exploration 0.14.0 (E4d): the installed array's RELIC-FIND bonus, rarity/quality-scaled (moduleEffectScale,
// standard/q0 == 1.0, like the discovery biases), or 0 when no array is installed. 0 for every array except
// the Bio-Resonance Array, so an existing loadout snapshots exactly the museum's relicFindChance. Kept OUT of
// sensorArrayEffect so the stored ExpeditionScanParams shape never changes. Pure.
export function sensorArrayRelicFindBonus(installed: InstalledSensorArray | null): number {
  if (installed === null || !(installed.def.relicFindBonus > 0)) return 0;
  return installed.def.relicFindBonus * moduleEffectScale(installed.instance.rarity, installed.instance.quality, installed.instance.ascension) * viewPieceEfficiency(installed.instance);
}

// Gas Giant Study GG-7: the installed array's CANISTER BAND lift, rarity/quality-scaled and worn like the relic find
// bonus, or 0 (no array, or any array but the Resonance Sensor Array). The dispatch freezes it on a study run
// (Expedition.bandLift, written only when above 0). Pure.
export function sensorArrayCanisterBandLift(installed: InstalledSensorArray | null): number {
  if (installed === null || !(installed.def.canisterBandLift > 0)) return 0;
  return installed.def.canisterBandLift * moduleEffectScale(installed.instance.rarity, installed.instance.quality, installed.instance.ascension) * viewPieceEfficiency(installed.instance);
}

// A convenience direct scale reader (rarity/quality -> effect scale), so a consumer that only needs the
// scalar can avoid resolving the full effect object. Pure passthrough to the shared curve. Unused this
// patch (dormant), kept for symmetry with the crew-module readers.
export function sensorEffectScale(rarity: EquipmentRarity, quality: number, ascension: EquipmentAscension = "none"): number {
  return moduleEffectScale(rarity, quality, ascension);
}
