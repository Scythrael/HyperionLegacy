// Field Kits FKR-8 (docs/plans/2026-10-14-field-kits-plan.md FKR-8; the wiring plan's OC-F1): the field devices roll 50
// to 75% PER USE (x1.06 with a Codebreaker aboard) and work on the GROUND (ambush and reinforcement chances, a Lure's
// salvage drop scale), on a run carrying the field devices stamp only (written at dispatch when a Security member wears
// a device). fieldDevicesGoldens.test.ts pins whole runs; this file pins the rules one reader at a time.

import { describe, expect, it } from "vitest";
import { freshState, type EquipmentInstance, type Expedition, type ExpeditionActivity, type ExpeditionBody, type GroundTeamRun, type SnapshotMember } from "./model";
import { dispatchPastPropulsion, withMinimumAwayTeam } from "./awayTeamTestFixtures";
import {
  CODEBREAKER_DEVICE_BONUS,
  FIELD_DEVICES_VERSION,
  FIELD_KITS_CATALOG_VERSION,
  fieldDeviceChance,
  fieldDeviceDial,
  fieldDeviceLureDial,
  fieldDevicePercent,
  fieldDeviceSalvageMult,
  fieldDeviceUseKey,
  fieldDevicesLive,
  fieldDevicesStamp,
  LURE_SALVAGE_PER_DIAL,
} from "./fieldKits";
import { ambushStrike, groundDeviceChance, visitReinforcements, type GroundTaskRef } from "./groundOps";
import { rollReinforcements, type ObjectiveAffix } from "./affixes";
import { CLOAKED_SALVAGE_SCALE, PROBE_SALVAGE_SCALE, shipSalvageScale } from "./shipScanEvents";
import { encounterChance, expeditionCandidates, shipScanEventChance, PRE_FKR8_DEVICE_EFFECTIVENESS } from "./expedition";
import { scanStepKey } from "./gambit";

const SEED = 0x51ab3;
const member = (memberId: string, teamType: "security" | "science", varieties: string[] = [], traits: string[] = []): SnapshotMember =>
  ({ memberId, teamType, traits, gear: varieties.map((varietyKey, i) => ({ pieceId: `p-${memberId}-${i}`, slotType: "memberTool", varietyKey, points: 0 })) }) as unknown as SnapshotMember;

// A run with the field devices stamp (`stamped`), or one dispatched before FKR-8 (the Field Kits flag alone).
function run(security: SnapshotMember[], stamped = true, science: SnapshotMember[] = [member("sci-1", "science")]): Expedition {
  const fieldKits = { catalog: FIELD_KITS_CATALOG_VERSION, ...(stamped ? { devices: FIELD_DEVICES_VERSION } : {}) };
  return { id: "exp-dev", seed: SEED, fieldKits, roster: { security, science }, bodies: [], hazardResist: 0 } as unknown as Expedition;
}
const crewOf = (ids: string[], downed: string[] = []): GroundTeamRun[] => [{ securityIds: ids, scienceIds: [], downedThisTask: downed } as unknown as GroundTeamRun];
const ref = (flatIndex: number, task: Partial<ExpeditionActivity>): GroundTaskRef =>
  ({ body: { id: "b", hazard: 0 }, bodyIndex: 0, flatIndex, task: { id: `t-${flatIndex}`, poiId: "derelictOutpost", ...task } }) as unknown as GroundTaskRef;
const R1: ObjectiveAffix = { id: "reinforcing", rank: 1, alignment: "negative" };

describe("the flag: the field devices stamp", () => {
  it("only a run carrying the stamp rolls devices on the ground; the stamp is written only when a device is worn", () => {
    expect(fieldDevicesLive({ fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION, devices: FIELD_DEVICES_VERSION } } as Expedition)).toBe(true);
    expect(fieldDevicesLive({ fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION } } as Expedition)).toBe(false);
    expect(fieldDevicesLive({} as Expedition)).toBe(false);
    expect(fieldDevicesStamp({ security: [member("a", "security", ["lureBeacon"])] })).toEqual({ devices: FIELD_DEVICES_VERSION });
    expect(fieldDevicesStamp({ security: [member("a", "security", ["shroudEmitter"])] })).toEqual({ devices: FIELD_DEVICES_VERSION });
    expect(fieldDevicesStamp({ security: [member("a", "security", ["medKit", "stunGrenade"])] })).toEqual({});
    expect(fieldDevicesStamp(undefined)).toEqual({});
  });

  it("a real dispatch stamps it when a Security member wears a Lure Beacon, and leaves the record as before when none does", () => {
    const launch = (gear: EquipmentInstance[]) => {
      const s0 = withMinimumAwayTeam({ ...freshState(), expeditionSeed: 0x7a11, nextAwayMemberId: 100 });
      const sec = s0.awayMembers.find((m) => m.teamType === "security")!.id;
      const s = { ...s0, equipment: [...s0.equipment, ...gear.map((g) => ({ ...g, fittedToMemberId: sec }))] };
      const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
      if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
      return res.expedition;
    };
    const tool = (variety: string): EquipmentInstance => ({ id: "equip-951", slotType: "memberTool", moduleVariant: variety, rarity: "standard", ascension: "none", quality: 0, iLevel: 10, blueprintKey: "bp-test", implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: 0, durabilityMax: 100, fittedToShipId: null, fittedToMemberId: null });
    const lured = launch([tool("lureBeacon")]);
    expect(lured.fieldKits?.devices).toBe(FIELD_DEVICES_VERSION);
    expect(fieldDevicesLive(lured)).toBe(true);
    const plain = launch([]);
    expect(plain.fieldKits).toBeDefined();
    expect("devices" in (plain.fieldKits ?? {})).toBe(false);
  });
});

describe("the per-use roll on the ground (groundDeviceChance)", () => {
  const lure = run([member("sec-1", "security", ["lureBeacon"])]);

  it("a Lure raises the chance by its dial x this use's rolled percent (50 to 75), keyed by the use", () => {
    for (let k = 0; k < 64; k += 1) {
      const pct = fieldDevicePercent(SEED, fieldDeviceUseKey("ambush", k, 0));
      expect(pct).toBeGreaterThanOrEqual(50);
      expect(pct).toBeLessThanOrEqual(75);
      expect(groundDeviceChance(lure, crewOf(["sec-1"]), 0.3, "ambush", k, 0)).toBeCloseTo(0.3 * (1 + 0.4 * (pct / 100)), 12);
    }
  });

  it("the roll varies PER USE and is the same for the same use", () => {
    const seen = new Set<number>();
    for (let k = 0; k < 64; k += 1) seen.add(groundDeviceChance(lure, crewOf(["sec-1"]), 0.3, "ambush", k, 0));
    expect(seen.size).toBeGreaterThan(10);
    expect(groundDeviceChance(lure, crewOf(["sec-1"]), 0.3, "reinforcement", 4, 2)).toBe(groundDeviceChance(lure, crewOf(["sec-1"]), 0.3, "reinforcement", 4, 2));
  });

  it("each use kind and index keys its own roll (no collisions over a grid of uses)", () => {
    const keys = new Set<number>();
    let n = 0;
    for (const use of ["ambush", "reinforcement", "salvage"] as const) {
      for (let a = 0; a < 40; a += 1) {
        for (let b = 0; b < 8; b += 1) {
          keys.add(fieldDeviceUseKey(use, a, b));
          n += 1;
        }
      }
    }
    expect(keys.size).toBe(n);
  });

  it("a Codebreaker anywhere on the expedition (Science here) lifts the effect by 6%", () => {
    const cb = run([member("sec-1", "security", ["lureBeacon"])], true, [member("sci-1", "science", [], ["codebreaker"])]);
    for (let k = 0; k < 16; k += 1) {
      const plain = groundDeviceChance(lure, crewOf(["sec-1"]), 0.3, "ambush", k, 0) / 0.3 - 1;
      const lifted = groundDeviceChance(cb, crewOf(["sec-1"]), 0.3, "ambush", k, 0) / 0.3 - 1;
      expect(lifted).toBeCloseTo(plain * (1 + CODEBREAKER_DEVICE_BONUS), 12);
    }
  });

  it("a Shroud lowers it; dials sum; the result stays a probability", () => {
    const shroud = run([member("sec-1", "security", ["shroudEmitter"])]);
    const c = groundDeviceChance(shroud, crewOf(["sec-1"]), 0.3, "ambush", 0, 0);
    expect(c).toBeLessThan(0.3);
    expect(c).toBeGreaterThanOrEqual(0.3 * (1 - 0.4 * 0.75) - 1e-12);
    expect(fieldDeviceDial([member("a", "security", ["lureBeacon", "shroudEmitter"]), member("b", "security", ["lureBeacon"])])).toBeCloseTo(0.4);
    expect(fieldDeviceLureDial([member("a", "security", ["lureBeacon", "shroudEmitter"])])).toBeCloseTo(0.4);
    expect(fieldDeviceChance(0.9, 0.8, 0.75)).toBe(1);
    expect(fieldDeviceChance(0.3, -2, 0.75)).toBe(0);
  });

  it("no device worn, a member downed in the objective, or a run dispatched before FKR-8: the chance as is (no roll read)", () => {
    const none = run([member("sec-1", "security", [])]);
    expect(groundDeviceChance(none, crewOf(["sec-1"]), 0.3, "ambush", 0, 0)).toBe(0.3);
    expect(groundDeviceChance(lure, crewOf(["sec-1"], ["sec-1"]), 0.3, "ambush", 0, 0)).toBe(0.3);
    expect(groundDeviceChance(run([member("sec-1", "security", ["lureBeacon"])], false), crewOf(["sec-1"]), 0.3, "ambush", 0, 0)).toBe(0.3);
    expect(groundDeviceChance(lure, crewOf(["sec-2"]), 0.3, "ambush", 0, 0)).toBe(0.3); // the wearer is not in this crew
  });
});

describe("the readers: the ambush roll and the reinforcement roll keep their draws", () => {
  it("a Lure only ever ADDS ambush strikes (same draws, a higher chance), and strikes at the same second", () => {
    const lure = run([member("sec-1", "security", ["lureBeacon"])]);
    const plain = run([member("sec-1", "security", [])]);
    let added = 0;
    for (let k = 0; k < 256; k += 1) {
      const r = ref(k, { fightPoints: [], ambushChance: 0.3 });
      const a = ambushStrike(plain, r, 100, crewOf(["sec-1"]));
      const b = ambushStrike(lure, r, 100, crewOf(["sec-1"]));
      if (a !== null) expect(b).toBe(a);
      else if (b !== null) added += 1;
    }
    expect(added).toBeGreaterThan(0);
  });

  it("rollReinforcements without a scaler is exactly as before; with one, the strike points are the same draws", () => {
    for (let k = 0; k < 64; k += 1) {
      const before = rollReinforcements(SEED, k, 0, [R1]);
      expect(rollReinforcements(SEED, k, 0, [R1], (c) => c)).toEqual(before);
      const up = rollReinforcements(SEED, k, 0, [R1], () => 1);
      expect(up.length).toBeGreaterThan(0);
      if (before.length > 0) expect(up).toEqual(before);
    }
  });

  it("a landing crew's Shroud lowers the visits that bring reinforcements (visitReinforcements)", () => {
    const shroud = run([member("sec-1", "security", ["shroudEmitter"])]);
    const plain = run([member("sec-1", "security", [])]);
    let p = 0;
    let s = 0;
    for (let k = 0; k < 256; k += 1) {
      const r = ref(k, { fightPoints: [0.5], affixes: [R1] });
      if (visitReinforcements(plain, crewOf(["sec-1"]), r, 0).length > 0) p += 1;
      if (visitReinforcements(shroud, crewOf(["sec-1"]), r, 0).length > 0) s += 1;
    }
    expect(s).toBeLessThan(p);
  });
});

describe("the ship side (OC-F1: the devices moved to the ground)", () => {
  const body = { id: "b", hazard: 0.4, planetType: "terrestrial" } as unknown as ExpeditionBody;

  it("a stamped run's ship-event chance reads no device; a run dispatched before FKR-8 reads it at full strength", () => {
    const lure3 = run([member("sec-1", "security", ["lureBeacon"])], true);
    const lure2 = run([member("sec-1", "security", ["lureBeacon"])], false);
    expect(shipScanEventChance(lure3, body)).toBe(encounterChance(0.4, 0, 0));
    expect(PRE_FKR8_DEVICE_EFFECTIVENESS).toBe(1);
    expect(shipScanEventChance(lure2, body)).toBeCloseTo(encounterChance(0.4, 0.4, 0), 12);
  });

  it("a Lure raises a won ship battle's salvage scale at the boundary's rolled percent; a Shroud never lowers it", () => {
    const lure = run([member("sec-1", "security", ["lureBeacon"])]);
    for (let step = 1; step < 10; step += 1) {
      const pct = fieldDevicePercent(SEED, fieldDeviceUseKey("salvage", scanStepKey(0, step), 0));
      expect(shipSalvageScale(lure, 0, step, false)).toBeCloseTo(PROBE_SALVAGE_SCALE * (1 + 0.4 * (pct / 100) * LURE_SALVAGE_PER_DIAL), 12);
      expect(shipSalvageScale(lure, 0, step, true)).toBeCloseTo(CLOAKED_SALVAGE_SCALE * fieldDeviceSalvageMult(0.4, pct / 100), 12);
    }
    expect(shipSalvageScale(run([member("sec-1", "security", ["shroudEmitter"])]), 0, 1, false)).toBe(PROBE_SALVAGE_SCALE);
    expect(shipSalvageScale(run([member("sec-1", "security", ["lureBeacon"])], false), 0, 1, false)).toBe(PROBE_SALVAGE_SCALE);
  });
});
