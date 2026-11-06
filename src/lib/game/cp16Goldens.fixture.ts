// Complement CP-16 GOLDENS (the final-retirement warning and the Hall of Command; plan
// docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-16, OC-22, the CP-16 notables answer of 2026-11-06): every
// path the slice's counters and notables can reach, through the live engine, captured on the code BEFORE the slice
// (CP16_PINS_PRE). TEST-ONLY (imported by *.test.ts files only).
//
// Each row is the whole state (stateHash) and the captains on their own (hash), so a pin that moves names what moved:
//   mission      : a Short Ore Run flown by a level 9 captain 50 XP short of level 10, for 1000 s (six cycles): in 1 s
//                  steps, in one call and in 997 s chunks (the three agree).
//   patrol       : Dispatch Once on a Destroyer to its end, the captain 1 XP short of level 10.
//   shortRange   : an Eir's first short-range run (900 s), the captain 1 XP short of level 20.
//   evacuation   : a training Evacuation flown to its delivery and five seconds on (a refugee comes home).
//   expedition   : an Orion's Tier I and Tier II dispatch, the run 30 days on, and its claim.
//   retire       : a first retirement and a fifth (final) one.
//   save         : the stepped mission state serialized, and the same save through deserialize + migrate.

import Decimal from "break_infinity.js";
import { PATROLS, xpForNextLevel, type GameState, type PatrolKey, type ShipTypeKey, type ShortRangeMissionState } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick } from "./tick";
import { resolveCrew } from "./crewOverlay";
import { dispatchCaptainOnShortRange, shortRangeBoardSlots, startShortRangeCycle } from "./shortRangeBoard";
import { rollShortRangeJob } from "./shortRange";
import { advanceExpedition, claimExpedition } from "./expedition";
import { retireCaptain, RETIRE_LEVEL_GATE } from "./captainRetirement";
import { deserialize, migrate, serialize } from "./save";
import { hash, onHull, stateHash, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion, withoutRelicStagger } from "./awayTeamTestFixtures";
import { asPreStaggerShortRange } from "./shortRangeRelics.fixture";
import { WIRING_CAPTAIN_ID, editCaptain, editShip, installPiece, seatOfficer, wiringBase } from "./wiring/probes";

const RNG = (): number => 0.5;
const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`cp16 goldens: ${what}`);
};

// The captain `short` XP below the next level from `level` (so the run crosses it).
export function nearLevel(s: GameState, level: number, short: number): GameState {
  return editCaptain(s, { level, xp: new Decimal(xpForNextLevel(level) - short) });
}

// A whole state and its captains.
function row(s: GameState): string[] {
  return [stateHash(s), hash(s.captains)];
}

// ===== mission =====
export const CP16_MISSION_SECONDS = 1000;
// Eight transit berths: a single call reads the berths free at its start (tick.ts berthBudget), so one berth would hold
// the ship at home inside a long call where 1 s steps free it each cycle; with eight the three cuts agree.
export function cp16MissionStart(): GameState {
  const r = dispatchCaptainOnMission({ ...nearLevel(wiringBase(), 9, 50), transitBerthCapacity: 8 }, WIRING_CAPTAIN_ID, "shortOreRun");
  must(r.success, `ore run: ${r.reason}`);
  return r.next;
}
export function steppedBy(s: GameState, seconds: number, chunk: number): GameState {
  let out = s;
  for (let left = seconds; left > 0; left -= chunk) out = economyTick(out, Math.min(chunk, left), RNG);
  return out;
}

// ===== patrol =====
const PATROL_KEY = Object.keys(PATROLS)[0] as PatrolKey;
export function cp16PatrolStart(): GameState {
  const base = nearLevel(asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(100_000) }), 9, 1);
  const r = dispatchCaptainOnPatrol(base, WIRING_CAPTAIN_ID, PATROL_KEY, "balanced", false);
  must(r.success, `destroyer: ${r.reason}`);
  return r.next;
}
function patrolRow(): string[] {
  let s = cp16PatrolStart();
  let ticks = 0;
  while (s.captains[0].mission !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  return [`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, ...row(s)];
}

// ===== shortRange =====
// A crewed Eir with a sensor array, Mission Control at Level 3 (four slots, two of them Tier II), every berth rung.
export function cp16Board(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  const s = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  return { ...s, transitBerthCapacity: 8, facilities: { ...s.facilities, missionControl: { ...s.facilities.missionControl, level: 3 } } };
}
// The slot's first job (from cycle 0 on) the crewed Eir meets the sheet of, dispatched.
export function cp16ShortRangeStart(slotId: number): GameState {
  const base = nearLevel(cp16Board(), 19, 1);
  for (let cycle = 0; cycle < 200; cycle++) {
    const s = { ...base, shortRangeBoard: { version: 1 as const, nextCycle: { [slotId]: cycle } } };
    const r = dispatchCaptainOnShortRange(s, WIRING_CAPTAIN_ID, slotId);
    if (r.success) return asPreStaggerShortRange(r.next);
  }
  throw new Error(`cp16 goldens: no job on short-range slot ${slotId} the Eir meets`);
}

// ===== evacuation =====
// Captain 1 on slot 0's next Evacuation (the training run), through the board's own cycle-start seam.
export function cp16EvacuationStart(): GameState {
  const s = cp16Board();
  const slot = shortRangeBoardSlots(s)[0];
  let idx = -1;
  for (let i = 0; i < 4000 && idx < 0; i++) if (rollShortRangeJob(s, slot, i).template === "evacuation") idx = i;
  must(idx >= 0, "no evacuation roll");
  const withBoard = { ...s, shortRangeBoard: { version: 1 as const, nextCycle: { 0: idx } } };
  const ship = withBoard.ships.find((sh) => sh.assignedCaptainId === WIRING_CAPTAIN_ID)!;
  const start = startShortRangeCycle(withBoard, ship, slot, idx, undefined, false);
  must(start.roll.template === "evacuation", "the cycle is not an evacuation");
  const mission: ShortRangeMissionState = { kind: "shortRange", slotId: 0, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false };
  return { ...withBoard, captains: withBoard.captains.map((c) => (c.id === WIRING_CAPTAIN_ID ? { ...c, mission } : c)), runCounts: start.runCounts };
}
export function cp16EvacuationSeconds(s: GameState): number {
  return (s.captains[0].mission as ShortRangeMissionState).plan.totalTicks + 5;
}

// ===== expedition =====
export function cp16ExpeditionBase(hull: ShipTypeKey = "orion"): GameState {
  return asExpeditionVeteran(withCrew(onHull(hull), "d18"));
}
export function cp16ExpeditionDispatch(candidateId: string): GameState {
  const res = dispatchPastPropulsion(cp16ExpeditionBase(), "ship-1", WIRING_CAPTAIN_ID, candidateId);
  must(res.success, `orion ${candidateId}: ${res.reason}`);
  return res.next;
}
// The dispatch, then the run advanced to CP16_EXPEDITION_END (the SF-0 sweep's end) and claimed at that instant. The
// Tier II run (cand-2-0) completes and brings home two relics; the d18 crew's Tier I runs never finish their objectives,
// so only their dispatch is pinned.
export const CP16_EXPEDITION_END = 3_000_000;
export function cp16Expedition(candidateId: string): { dispatched: GameState; claimed: GameState } {
  const res = dispatchPastPropulsion(cp16ExpeditionBase(), "ship-1", WIRING_CAPTAIN_ID, candidateId);
  must(res.success, `orion ${candidateId}: ${res.reason}`);
  const exp = withoutRelicStagger(res.expedition!);
  const at = CP16_EXPEDITION_END;
  const done = advanceExpedition(structuredClone(exp), at);
  must(done.phase === "complete", `${candidateId}: the run is not complete at ${at} s`);
  const out = { ...res.next, gameTimeSeconds: at, expeditions: res.next.expeditions.map((e) => (e.id === done.id ? done : e)) };
  const claim = claimExpedition(out, done.id);
  must(claim.success, `${candidateId}: claim ${claim.reason}`);
  return { dispatched: res.next, claimed: claim.next };
}

// ===== retire =====
export function cp16RetireReady(retirements: number): GameState {
  const s = seatOfficer(editCaptain(wiringBase(), { level: RETIRE_LEVEL_GATE + 3, retirements }), "executive", [], { id: "officer-xo" });
  return { ...s, gameTimeSeconds: 3 * 86400 + 1234 };
}

// ===== save =====
function saveRows(s: GameState): string[] {
  const raw = serialize(s, 0, 0);
  const loaded = deserialize(raw);
  return [hash(raw), hash(loaded === null ? null : serialize(migrate(loaded), 0, 0))];
}

export function cp16Rows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  const ore = cp16MissionStart();
  const stepped = steppedBy(ore, CP16_MISSION_SECONDS, 1);
  got["mission:ore:steps"] = row(stepped);
  got["mission:ore:oneCall"] = row(steppedBy(ore, CP16_MISSION_SECONDS, CP16_MISSION_SECONDS));
  got["mission:ore:chunks"] = row(steppedBy(ore, CP16_MISSION_SECONDS, 997));
  got["patrol:destroyer"] = patrolRow();
  got["shortRange:eir:tierOne"] = row(steppedBy(cp16ShortRangeStart(0), 900, 1));
  const evac = cp16EvacuationStart();
  const evacDone = steppedBy(evac, cp16EvacuationSeconds(evac), 1);
  got["evacuation:steps"] = [...row(evacDone), hash(evacDone.refugees)];
  got["expedition:cand-0:dispatch"] = row(cp16ExpeditionDispatch("cand-0"));
  const run = cp16Expedition("cand-2-0");
  got["expedition:cand-2-0:dispatch"] = row(run.dispatched);
  got["expedition:cand-2-0:claim"] = row(run.claimed);
  got["retire:first"] = row(retireCaptain(cp16RetireReady(0), WIRING_CAPTAIN_ID));
  got["retire:final"] = row(retireCaptain(cp16RetireReady(4), WIRING_CAPTAIN_ID));
  got["save"] = saveRows(stepped);
  return got;
}

// Captured on feat 9c1f93f, before the slice.
export const CP16_PINS_PRE: Record<string, unknown> = {
  "mission:ore:steps": ["cde30256", "c49d345f"],
  "mission:ore:oneCall": ["cde30256", "c49d345f"],
  "mission:ore:chunks": ["cde30256", "c49d345f"],
  "patrol:destroyer": ["won:14", "97f0d505", "abc6f91d"],
  "shortRange:eir:tierOne": ["64c679e1", "a7f0f72b"],
  "evacuation:steps": ["55ad70db", "d1eeb064", "4cfbf093"],
  "expedition:cand-0:dispatch": ["42ba7159", "602d32d8"],
  "expedition:cand-2-0:dispatch": ["c848471d", "602d32d8"],
  "expedition:cand-2-0:claim": ["62f6eca5", "602d32d8"],
  "retire:first": ["53755cef", "c46eaf7c"],
  "retire:final": ["a8a99293", "62129c60"],
  "save": ["186c29de", "5b2eaec2"],
};
