// WR-5b (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5b): golden hashes
// captured on the code BEFORE any WR-5b engine edit (the CP-0 / FK-3 / G2-0 / SF-0 / WR-4 pattern). Each fixture is
// run once with NO captain node and once per Tactician node (the captain owning only that node, a hand-edited save;
// the allocation rules are not the subject here).
//
//   patrol : a Repeat Crimson Reaver Warband patrol on a carrier (weapons and an Attack drone screen) with a Damage
//            Control Suite installed: the dispatch record, the display replay at 12 s and 25 s (one won
//            cycle, then the relaunched cycle a wave lost on a plain carrier), the state after 900 s (or the end).
//   event  : the Ground Ops ship-event profile frozen at dispatch, and one battle of its combatant against the
//            Cloaked Vessel (resolveBattle, a fixed seed).
//   repair : a damaged carrier's Shipyard repair duration (437 hull to restore).
//
// Before WR-5b every node was inert, so each node's hashes equaled the no-node hashes (bar the whole-state hash,
// which carries the captain's owned node list). The no-node row must never move; a node's row moves exactly where
// its commit says.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type EquipmentInstance, type GameState, type PatrolMissionState, type SecondaryTalentKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, shipRepairDurationTicks } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { resolveBattle } from "./combat/resolveBattle";
import { shipToCombatant } from "./combat/bridge";
import { makeWeaponInstance } from "./combat/weapons";
import { equippedFor } from "./equipment";
import { officerRepairSpeedBonus } from "./crewOverlay";
import { generateEquipment } from "./itemgen";
import { DAMAGE_CONTROL_SUITE_KEY } from "./utilityGear";
import { CLOAKED_VESSEL_HULL, buildShipCombatant, snapshotShipEventProfile } from "./shipScanEvents";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(JSON.stringify(v));

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

function dcSuite(): EquipmentInstance {
  const piece = generateEquipment({
    slotType: "specUtility",
    varietyKey: DAMAGE_CONTROL_SUITE_KEY,
    blueprintKey: null,
    iLevel: 30,
    quality: 2,
    rarity: "augmented",
    ascension: "none",
    rng: seededRng(30 * 31 + 2),
    allocateId: () => "dcs-1",
  });
  return { ...piece, fittedToShipId: "ship-1" };
}

// A carrier with its Standard Issue combat gear and a Damage Control Suite, captain 1 owning `nodes`.
function carrier(nodes: readonly SecondaryTalentKey[]): GameState {
  const base = freshState();
  const onCarrier: GameState = {
    ...base,
    credits: new Decimal(1_000_000),
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "carrier" } : sh)),
  };
  const s = installMissingCombatBaselines(onCarrier);
  return {
    ...s,
    equipment: [...s.equipment, dcSuite()],
    captains: s.captains.map((c) => (c.id === 1 ? { ...c, unlockedSecondaryTalents: [...nodes] } : c)),
  };
}

function patrolRow(s0: GameState): string[] {
  const r = dispatchCaptainOnPatrol(s0, 1, "crimsonReaverWarband", "balanced", true);
  if (!r.success) throw new Error(`patrol refused: ${r.reason}`);
  let s = r.next;
  const out = [hash(s.captains[0].mission)];
  for (let i = 1; i <= 900; i++) {
    s = economyTick(s, 1, () => 0.5);
    if (i === 12 || i === 25) out.push(hash(replayPatrol(s, s.captains[0])));
    if ((s.captains[0].mission as PatrolMissionState | null) === null) break;
  }
  out.push(hash({ ...s, runCounts: undefined }));
  return out;
}

function eventRow(s0: GameState): string[] {
  const profile = snapshotShipEventProfile(s0, s0.ships[0]);
  const ship = buildShipCombatant("ship-1", profile.battle!, 0, 0);
  const hull = CLOAKED_VESSEL_HULL;
  const enemy = shipToCombatant({
    id: "enemy-1",
    team: "enemy",
    stats: hull.stats,
    weaponLoadout: hull.weapons.map((w, i) => makeWeaponInstance(w, `enemy-1-w${i}-${w}`)),
    stance: hull.stance,
  });
  const fight = resolveBattle({ combatants: [ship, enemy] }, 0x5b5b);
  return [hash(profile), hash({ outcome: fight.outcome, final: fight.finalCombatants })];
}

function repairRow(s0: GameState): string {
  const ship = { ...s0.ships[0], damaged: true, repairDamage: 437 };
  return String(shipRepairDurationTicks(ship, equippedFor(s0, ship.id), officerRepairSpeedBonus(s0, ship)));
}

const TACTICIAN: readonly SecondaryTalentKey[] = [
  "gunnery1", "gunnery2", "gunnery3", "gunnery4", "gunnery5",
  "aegis1", "aegis2", "aegis3", "aegis4", "aegis5",
  "fleetOps1", "fleetOps2", "fleetOps3", "fleetOps4", "fleetOps5",
];

// [patrol dispatch, patrol replay @12 s, @25 s, patrol final state, event profile, event battle, repair ticks]
const GOLDEN: Record<string, string[]> = {
  none: ["5178250e", "f8d1a282", "19067d1b", "43013dc9", "8481e801", "4e0baba", "156"],
  gunnery1: ["5178250e", "f8d1a282", "19067d1b", "50194f86", "8481e801", "4e0baba", "156"],
  gunnery2: ["5178250e", "f8d1a282", "19067d1b", "b12b0125", "8481e801", "4e0baba", "156"],
  gunnery3: ["5178250e", "f8d1a282", "19067d1b", "e7b5da0", "8481e801", "4e0baba", "156"],
  gunnery4: ["5178250e", "f8d1a282", "19067d1b", "e82f99e7", "8481e801", "4e0baba", "156"],
  gunnery5: ["5178250e", "f8d1a282", "19067d1b", "a24252b2", "8481e801", "4e0baba", "156"],
  aegis1: ["5178250e", "f8d1a282", "19067d1b", "a4382707", "8481e801", "4e0baba", "156"],
  aegis2: ["5178250e", "f8d1a282", "19067d1b", "f1e822fc", "8481e801", "4e0baba", "156"],
  aegis3: ["5178250e", "f8d1a282", "19067d1b", "87cf0441", "8481e801", "4e0baba", "156"],
  aegis4: ["5178250e", "f8d1a282", "19067d1b", "8a41a126", "8481e801", "4e0baba", "156"],
  aegis5: ["5178250e", "f8d1a282", "19067d1b", "d802aceb", "8481e801", "4e0baba", "156"],
  fleetOps1: ["5178250e", "f8d1a282", "19067d1b", "ff5f4d56", "8481e801", "4e0baba", "156"],
  fleetOps2: ["5178250e", "f8d1a282", "19067d1b", "c16cb235", "8481e801", "4e0baba", "156"],
  fleetOps3: ["5178250e", "f8d1a282", "19067d1b", "a82b2f70", "8481e801", "4e0baba", "156"],
  fleetOps4: ["5178250e", "f8d1a282", "19067d1b", "bc73e8f7", "8481e801", "4e0baba", "156"],
  fleetOps5: ["5178250e", "f8d1a282", "19067d1b", "c6259382", "8481e801", "4e0baba", "156"],
};

describe("WR-5b tactician goldens", () => {
  for (const key of ["none", ...TACTICIAN]) {
    it(`${key}: patrol, ship event, Shipyard repair`, () => {
      const s0 = carrier(key === "none" ? [] : [key as SecondaryTalentKey]);
      const row = [...patrolRow(s0), ...eventRow(s0), repairRow(s0)];
      expect(row).toEqual(GOLDEN[key]);
    }, 60_000);
  }
});
