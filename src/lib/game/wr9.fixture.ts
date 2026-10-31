// Wiring WR-9 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-9): the shared fixtures of
// wr9Goldens.test.ts and wr9.test.ts. TEST-ONLY (imported by *.test.ts files only).
//
// Missions (OC-E4, Pilot Cunning): captain 1 dispatched on each of three missions (an ore run, a survey, a supply run)
// from a save whose Pilot has Cunning 20, then run for MISSION_TICKS ticks in 100-tick economyTick calls on a seeded stream.
// Expeditions (OC-E9): the WR-11 Ground Ops runs with an XO holding Command Presence and an Operations officer with
// Integrity 20. Complement (OC-E12): a batch of generated complement crew per seed.

import Decimal from "break_infinity.js";
import { freshState, type GameState, type OfficerStats, type MissionKey } from "./model";
import { dispatchCaptainOnMission, economyTick } from "./tick";
import { generateComplementCrew } from "./crewGeneration";
import { seatOfficer } from "./wiring/probes";
import { makeRng } from "./combat/rng";
import { wr11Hash, wr11State } from "./wr11.fixture";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { dispatchPastPropulsion } from "./awayTeamTestFixtures";

export const wr9Hash = wr11Hash;

const NEUTRAL: OfficerStats = { strength: 10, integrity: 10, cunning: 10, constitution: 10 };

// ===== Missions =====

export const WR9_MISSIONS: readonly MissionKey[] = ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"];
export const MISSION_TICKS = 40_000;

// A save whose Pilot (seated on ship-1, Ace Navigator) has Cunning `cunning`, with credits for the supply run.
export function wr9MissionState(cunning = 20): GameState {
  const base = freshState();
  const s: GameState = { ...base, credits: new Decimal(10_000_000) };
  const leveled: GameState = { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, level: 30 } : c)) };
  return seatOfficer(leveled, "pilot", ["pilot.transitCut"], { stats: { ...NEUTRAL, cunning } });
}

export function wr9MissionDispatch(missionKey: MissionKey, cunning = 20): GameState {
  const r = dispatchCaptainOnMission(wr9MissionState(cunning), 1, missionKey);
  if (!r.success) throw new Error(`mission dispatch refused: ${r.reason}`);
  return r.next;
}

// The run after `ticks` ticks, in `steps` equal economyTick calls on one seeded stream (100-tick calls by default: a
// berth freed inside one call is claimable only on the next, so one huge call would hold at the berth).
export function wr9MissionRun(missionKey: MissionKey, ticks = MISSION_TICKS, steps = ticks / 100, cunning = 20): GameState {
  const r = makeRng(0x9e9);
  const rng = () => r.next();
  let s = wr9MissionDispatch(missionKey, cunning);
  for (let i = 0; i < steps; i++) s = economyTick(s, ticks / steps, rng);
  return s;
}

// What a mission run hashes: the captain (its mission, counters, XP), the fleet's holdings and lifetime stats.
export function wr9MissionHash(s: GameState): string {
  return wr9Hash({ captains: s.captains, inventory: s.inventory, credits: s.credits, lifetimeStats: s.lifetimeStats, fleetAdminXp: s.fleetAdminXp });
}

// ===== Expeditions =====

export const WR9_EXP_SEEDS = [0x1234, 0x3c3c, 0xbebe] as const;

// The WR-11 save with an XO holding Command Presence and an Operations officer with Integrity `integrity`.
export function wr9ExpeditionState(seed: number, integrity = 20): GameState {
  let s = wr11State(seed);
  s = seatOfficer(s, "executive", ["xo.commandOutput"], { stats: NEUTRAL });
  return seatOfficer(s, "operations", ["ops.cargoExpand"], { stats: { ...NEUTRAL, integrity } });
}

export function wr9ExpeditionRun(seed: number, integrity = 20): { out: string[]; claimed: GameState } {
  const s = wr9ExpeditionState(seed, integrity);
  const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const done = advanceExpedition(res.expedition, 2_000_000);
  if (done.phase !== "complete") throw new Error(`run did not complete: ${done.phase}`);
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  if (!claim.success) throw new Error("claim refused");
  return { out: [wr9Hash(res.expedition), wr9Hash(done), wr9Hash(claim.next)], claimed: claim.next };
}

// ===== Complement generation =====

export const WR9_CREW_SEEDS = [1, 0xc0ffee, 0x5eed5eed] as const;
export const WR9_CREW_BATCH = 400;

export function wr9CrewBatch(seed: number): string {
  const out = [];
  for (let i = 0; i < WR9_CREW_BATCH; i++) out.push(generateComplementCrew(seed, i));
  return wr9Hash(out);
}
