// TEST-ONLY helpers for the safe first expedition's PROOF (docs/plans/2026-10-15-safe-first-runs-plan.md section 4
// SF-2 and the USER ANSWERS), shared by safeFirstExpedition.test.ts (a fixed sample, the default run) and
// safeFirstExpedition.sweep.test.ts (500 seeds, gated). The method is SF-0's (firstRunsGoldens.fixture.ts): freshState,
// ship-1 retyped to the explorer with its Standard-Issue gear, no officers, nothing edited after dispatch (everything
// on auto), the run advanced with no player action. Never imported by app code.
//
// The user's bar (OC-1 "Finish 100%, no setbacks"; OC-2 "Weakest crew still wins"): every objective completes, no lost
// fights, no hull damage, no ship-event setbacks; members may still take hits in fights they win. Gear wear is not
// built yet, so there is none to check.

import { expect } from "vitest";
import type { CrewBucket, Expedition, GameState, ShipTypeKey } from "./model";
import { advanceExpedition, claimExpedition, startExpedition } from "./expedition";
import { groundOpsStuckTaskIds } from "./groundOps";
import { isTrainingRun } from "./enemyRanks";
import { OFFICER_ROSTER_WINDOW_SECONDS } from "./seniorStaff";
import { CREW_PROFESSIONS, complementTotalCap, divisionCap } from "./commandStructure";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { CREW_RACE_IDS } from "./crewRaces";
import { isShipEventSetback, onHull, runOutcome, SWEEP_END, withCrew, type CrewName } from "./firstRunsGoldens.fixture";

export const EXPLORERS: readonly ShipTypeKey[] = ["orion", "aurora", "eir"];
export const FRESH_CANDIDATES: readonly string[] = ["cand-0", "cand-1", "cand-2"];

// The proof's crews: the D18 minimum (1 Security + 1 Science, rank 1, no gear: the weakest launchable crew), the real
// fresh board's first Security and first Science hire (or all ten hires) at a board window, a full rank-1 crew, and a
// full rank-1 crew with a passive complement aboard.
export interface ProofCrew {
  name: string;
  crew: CrewName;
  window?: number;
  complement?: boolean;
}
export const D18: ProofCrew = { name: "d18", crew: "d18" };
export const boardCrew = (window: number, all = false): ProofCrew => ({ name: `${all ? "board10" : "board2"}@${window}`, crew: all ? "board10" : "board2", window });
export const RANK1: ProofCrew = { name: "rank1", crew: "rank1" };
export const RANK1_COMPLEMENT: ProofCrew = { name: "rank1+complement", crew: "rank1", complement: true };

// A passive complement filling every division of `hull` to its cap (trimmed to the hull's total), rank 1, each
// division's first profession buff. Pure.
export function passiveComplement(hull: ShipTypeKey): CrewBucket[] {
  let left = complementTotalCap(hull);
  const buckets: CrewBucket[] = [];
  for (const profession of CREW_PROFESSIONS) {
    const count = Math.min(left, divisionCap(hull, profession));
    if (count <= 0) continue;
    left -= count;
    buckets.push({ profession, rarity: "standard", rank: 1, race: CREW_RACE_IDS[0], buff1Id: CREW_PROFESSION_BUFFS[profession][0].id, buff2Id: null, count });
  }
  return buckets;
}

// A fresh save on `hull` (its expedition seed `seed`; undefined = the default, so the three fresh candidates) with
// `crew` aboard ship-1. A board crew is hired at its window (the clock moved to that window's start). Pure.
export function provingState(hull: ShipTypeKey, crew: ProofCrew, seed?: number): GameState {
  let s = onHull(hull, seed);
  if (crew.window !== undefined) s = { ...s, gameTimeSeconds: crew.window * OFFICER_ROSTER_WINDOW_SECONDS };
  s = withCrew(s, crew.crew);
  if (crew.complement) {
    const buckets = passiveComplement(hull);
    s = { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets, mode: "passive" } } : sh)) };
  }
  return s;
}

// What one proven training run held, for the sweep's sums.
export interface TrainingProof {
  done: Expedition;
  objectives: number;
  fights: number; // fight steps (every one won)
  events: number; // ship events fired (every one passed)
}

// Dispatch candidate `cand` from `state` and PROVE the training run: it is stamped as one; at every 10,000 s
// checkpoint no objective is stuck; it reaches complete with every objective done, the ground window closed, no lost
// fight (so the backstop never had to fire), no send-back, no hull damage, no ship-event setback, no boarding loss;
// the claim succeeds, leaves the ship undamaged and marks training done. Fails the test (expect) on any miss.
export function proveTrainingRun(state: GameState, cand: string, label: string): TrainingProof {
  const res = startExpedition(state, "ship-1", 1, cand);
  expect(res.success, `${label}: dispatch ${res.reason}`).toBe(true);
  const exp = res.expedition!;
  expect(isTrainingRun(exp), `${label}: stamped`).toBe(true);
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 10_000; e.phase !== "complete" && t < SWEEP_END; t += 10_000) {
    e = advanceExpedition(e, t);
    expect(groundOpsStuckTaskIds(e), `${label}: stuck at ${t}`).toEqual([]);
  }
  const done = advanceExpedition(e, SWEEP_END);
  const o = runOutcome(done);
  const tasks = done.bodies.flatMap((b) => b.activities);
  const history = done.groundOps?.history ?? [];
  expect(
    { phase: o.phase, objectives: o.objectives, lost: o.lostFights, sentBack: o.sentBack, hull: o.hullDamage, setbacks: o.setbacks, boarded: o.boardingLoss },
    label,
  ).toEqual({ phase: "complete", objectives: `${tasks.length}/${tasks.length}`, lost: 0, sentBack: 0, hull: 0, setbacks: 0, boarded: 0 });
  expect(done.groundOps?.endedAt, `${label}: the window closed`).toBeTypeOf("number");
  expect(history.some((r) => r.fellBack === true), `${label}: the backstop never fired`).toBe(false);
  expect((done.groundOps?.log ?? []).some((l) => l.kind === "trainingFellBack"), `${label}: no fell-back line`).toBe(false);
  expect((done.scanEvents ?? []).some(isShipEventSetback), `${label}: no ship-event setback`).toBe(false);
  const claim = claimExpedition({ ...res.next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done.id);
  expect(claim.success, `${label}: claimed`).toBe(true);
  const ship = claim.next.ships.find((s) => s.id === "ship-1")!;
  expect(ship.damaged === true || (ship.repairDamage ?? 0) > 0, `${label}: the ship comes home undamaged`).toBe(false);
  expect(claim.next.runCounts?.expedition.trainingDone, `${label}: training done`).toBe(true);
  return {
    done,
    objectives: tasks.length,
    fights: history.filter((r) => r.outcome !== undefined).length,
    events: (done.scanEvents ?? []).filter((x) => x.kind === "shipEvent").length,
  };
}
