// WR-7 follow-up OC-D5 favorsSpec GOLDENS (plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, WR-7 carry
// note "Not built"; USER ANSWERS 2026-10-29 "OC-D5 favorsSpec: +10% on its ship type (Recommended)"): every run type a
// favored piece reaches, through the live engine (1 s economyTick steps), captured on the code BEFORE the favored bonus
// (feat 502a0c8; FAVORS_PINS_PRE). Each mission, short-range and patrol run is read twice: as dispatched (`fresh`), and
// with the run's favored stamp removed right after dispatch (`inFlight`: a run dispatched before the bonus). The stamp
// itself is left out of every hash (asPreFavored), so a pin moves only when the run plays differently.
//
//   mission      : a Short Ore Run, 2000 s, on a Prospector (favored: Prospector Hold + Yield Rig) and a General
//                  Freighter (the same pieces, unfavored).
//   shortRange   : an Eir's first short-range run, 900 s, with a Pathfinder Suite (favored) and a Prospector Hold
//                  (unfavored).
//   patrol       : Dispatch Once to its end on a Destroyer with a Damage Control Suite (favored), a Hauler with a
//                  Prospector Hold (favored) and a General Freighter with the hold (unfavored).
//   patrolRepeat : a Repeat Destroyer patrol with the suite, balanced for 2500 s and aggressive for 3000 s (the relaunch
//                  path; the aggressive run takes hull damage, so the suite's between-wave patch-up acts).
//   expedition   : an Orion's Ground Operations dispatch with a Pathfinder Suite (favored), a Prospector Hold and a
//                  Damage Control Suite (both unfavored): the voyage, the frozen run, and the whole run 30 days on.

import Decimal from "break_infinity.js";
import { PATROLS, type CaptainMissionState, type EquipmentInstance, type GameState, type PatrolKey, type ShipTypeKey } from "./model";
import type { CombatStance } from "./combat/positioning";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick } from "./tick";
import { resolveCrew } from "./crewOverlay";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { advanceExpedition } from "./expedition";
import { hash, onHull, stateHash, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion, withoutRelicStagger } from "./awayTeamTestFixtures";
import { asPreStaggerShortRange } from "./shortRangeRelics.fixture";
import { editShip, installPiece, wiringBase } from "./wiring/probes";

const RNG = (): number => 0.5;
const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`favorsSpec goldens: ${what}`);
};

export type FavorsPiece = Omit<Partial<EquipmentInstance>, "slotType"> & { slotType: string };
// The favored-spec pieces as crafted (their variety resolves from the blueprint or the stamped moduleVariant).
export const FAVORS_HOLD: FavorsPiece = { slotType: "cargoBay", blueprintKey: "prospectorHoldBp", implicitStats: { cargoCapacity: 20 }, rolledStats: { engineEfficiency: 4, massReduction: 3 } };
export const FAVORS_RIG: FavorsPiece = { slotType: "specUtility", blueprintKey: "yieldRigBp", implicitStats: { extractionYieldMult: 12 }, rolledStats: { sensors: 4, materialQualityChance: 6 } };
export const FAVORS_DC: FavorsPiece = { slotType: "specUtility", blueprintKey: "damageControlSuiteBp", moduleVariant: "damageControlSuite", implicitStats: { repairSpeed: 10, waveHullRegen: 10 }, rolledStats: { massReduction: 2 } };
export const FAVORS_PF: FavorsPiece = { slotType: "specUtility", blueprintKey: "pathfinderSuiteBp", moduleVariant: "pathfinderSuite", implicitStats: { sensors: 8, expeditionScanSpeed: 10, hazardResist: 10 }, rolledStats: {} };

export const withPieces = (s: GameState, pieces: readonly FavorsPiece[]): GameState => pieces.reduce(installPiece, s);

// A run as dispatched before the favored bonus: captain 1's mission without its favored stamp (no-op on a record
// that carries none).
export function asPreFavored(s: GameState): GameState {
  return {
    ...s,
    captains: s.captains.map((c, i) => {
      if (i !== 0 || c.mission === null) return c;
      const { favoredSpec: _drop, ...rest } = c.mission as CaptainMissionState & { favoredSpec?: 1 };
      return { ...c, mission: rest as typeof c.mission };
    }),
  };
}
export type FavorsVariant = "fresh" | "inFlight";
const asVariant = (s: GameState, v: FavorsVariant): GameState => (v === "fresh" ? s : asPreFavored(s));

// ===== mission =====
export function favorsMissionBase(hull: ShipTypeKey): GameState {
  const base = withPieces(onHull(hull), [FAVORS_HOLD, FAVORS_RIG]);
  return { ...base, credits: new Decimal(1_000_000), captains: base.captains.map((c) => ({ ...c, level: 10 })) };
}
export function favorsMissionRow(hull: ShipTypeKey, v: FavorsVariant): string[] {
  const r = dispatchCaptainOnMission(favorsMissionBase(hull), 1, "shortOreRun");
  must(r.success, `${hull}: ${r.reason}`);
  let s = asVariant(r.next, v);
  for (let i = 0; i < 2000; i++) s = economyTick(s, 1, RNG);
  return [hash(asPreFavored(r.next).captains[0].mission), stateHash(asPreFavored(s))];
}

// ===== shortRange =====
export function favorsShortRangeBase(piece: FavorsPiece): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  return installPiece(installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }), piece);
}
export function favorsShortRangeRow(piece: FavorsPiece, v: FavorsVariant): string[] {
  const r = dispatchCaptainOnShortRange(favorsShortRangeBase(piece), 1, 0);
  must(r.success, String(r.reason));
  const pre = asVariant(asPreStaggerShortRange(r.next), v);
  let s = pre;
  for (let i = 0; i < 900; i++) s = economyTick(s, 1, RNG);
  return [hash(asPreFavored(pre).captains[0].mission), stateHash(asPreFavored(s))];
}

// ===== patrol =====
export const FAVORS_PATROL_KEY = Object.keys(PATROLS)[0] as PatrolKey;
export function favorsPatrolBase(hull: ShipTypeKey, piece: FavorsPiece): GameState {
  return installPiece(asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) }), piece);
}
// Dispatch Once runs to its end; a Repeat run (`repeatTicks` set) runs that many seconds.
export function favorsPatrolRow(hull: ShipTypeKey, piece: FavorsPiece, v: FavorsVariant, repeatTicks?: number, stance: CombatStance = "balanced"): string[] {
  const repeat = repeatTicks !== undefined;
  const r = dispatchCaptainOnPatrol(favorsPatrolBase(hull, piece), 1, FAVORS_PATROL_KEY, stance, repeat);
  must(r.success, `${hull}: ${r.reason}`);
  const row = [hash(structuredClone(asPreFavored(r.next).captains[0].mission))];
  let s = asVariant(r.next, v);
  let ticks = 0;
  while (s.captains[0].mission !== null && (!repeat || ticks < repeatTicks)) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, stateHash(asPreFavored(s)));
  return row;
}

// ===== expedition =====
export function favorsExpeditionBase(piece: FavorsPiece): GameState {
  return installPiece(asExpeditionVeteran(withCrew(onHull("orion"), "d18")), piece);
}
export function favorsExpeditionRow(piece: FavorsPiece): string[] {
  const res = dispatchPastPropulsion(favorsExpeditionBase(piece), "ship-1", 1, "cand-0");
  must(res.success, `orion: ${res.reason}`);
  const exp = withoutRelicStagger(res.expedition!);
  const done = advanceExpedition(structuredClone(exp), exp.phaseAnchorSeconds + 30 * 86400);
  return [hash(exp.voyage), hash(exp), hash(done)];
}

export function favorsRows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const v of ["fresh", "inFlight"] as FavorsVariant[]) {
    for (const hull of ["prospectorMiner", "generalFreighter"] as ShipTypeKey[]) got[`mission:${hull}:${v}`] = favorsMissionRow(hull, v);
    got[`shortRange:eir:pathfinder:${v}`] = favorsShortRangeRow(FAVORS_PF, v);
    got[`shortRange:eir:hold:${v}`] = favorsShortRangeRow(FAVORS_HOLD, v);
    got[`patrol:destroyer:dc:${v}`] = favorsPatrolRow("destroyer", FAVORS_DC, v);
    got[`patrol:prospectorHauler:hold:${v}`] = favorsPatrolRow("prospectorHauler", FAVORS_HOLD, v);
    got[`patrol:generalFreighter:hold:${v}`] = favorsPatrolRow("generalFreighter", FAVORS_HOLD, v);
    got[`patrolRepeat:destroyer:dc:${v}`] = favorsPatrolRow("destroyer", FAVORS_DC, v, 2500);
    got[`patrolRepeat:destroyer:dc:aggressive:${v}`] = favorsPatrolRow("destroyer", FAVORS_DC, v, 3000, "aggressive");
  }
  got["expedition:orion:pathfinder"] = favorsExpeditionRow(FAVORS_PF);
  got["expedition:orion:hold"] = favorsExpeditionRow(FAVORS_HOLD);
  got["expedition:orion:dc"] = favorsExpeditionRow(FAVORS_DC);
  return got;
}

// Captured on feat 502a0c8, before the favored bonus.
export const FAVORS_PINS_PRE: Record<string, unknown> = {
  "mission:prospectorMiner:fresh": ["21b85cb7","85953c6a"],
  "mission:generalFreighter:fresh": ["21b85cb7","1044846d"],
  "shortRange:eir:pathfinder:fresh": ["ece9d2a1","a645dc89"],
  "shortRange:eir:hold:fresh": ["ece9d2a1","9e6f9d9d"],
  "patrol:destroyer:dc:fresh": ["31e77619","won:14","7e03e0cd"],
  "patrol:prospectorHauler:hold:fresh": ["f98b7306","won:14","6fa4a481"],
  "patrol:generalFreighter:hold:fresh": ["e38d27d1","won:14","b1674fd"],
  "patrolRepeat:destroyer:dc:fresh": ["88ed10aa","won:2500","24c15260"],
  "patrolRepeat:destroyer:dc:aggressive:fresh": ["57019dfe","won:3000","21922196"],
  "mission:prospectorMiner:inFlight": ["21b85cb7","85953c6a"],
  "mission:generalFreighter:inFlight": ["21b85cb7","1044846d"],
  "shortRange:eir:pathfinder:inFlight": ["ece9d2a1","a645dc89"],
  "shortRange:eir:hold:inFlight": ["ece9d2a1","9e6f9d9d"],
  "patrol:destroyer:dc:inFlight": ["31e77619","won:14","7e03e0cd"],
  "patrol:prospectorHauler:hold:inFlight": ["f98b7306","won:14","6fa4a481"],
  "patrol:generalFreighter:hold:inFlight": ["e38d27d1","won:14","b1674fd"],
  "patrolRepeat:destroyer:dc:inFlight": ["88ed10aa","won:2500","24c15260"],
  "patrolRepeat:destroyer:dc:aggressive:inFlight": ["57019dfe","won:3000","21922196"],
  "expedition:orion:pathfinder": ["9b7820ac","a2bd4d4","5455a84c"],
  "expedition:orion:hold": ["9b7820ac","e32d11be","ff32edf8"],
  "expedition:orion:dc": ["9b7820ac","2dc87c4c","a98e1a70"],
};
