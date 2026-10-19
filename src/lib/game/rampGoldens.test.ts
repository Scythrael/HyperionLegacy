// Safe first runs SF-3 GOLDENS FIRST (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-3): the runs AFTER the
// training run, captured on the code BEFORE the ramp and the tier hazard ceiling (on top of a678241), so SF-3's engine
// commit has to name every move it makes. Real dispatches (both stamps as the game writes them: no strip), the run
// advanced in one call to SWEEP_END, nothing edited after dispatch (the SF-0 method, firstRunsGoldens.fixture.ts).
//
//   1. ramp     : an Orion with the D18 minimum crew and a full rank 1 crew, the training run done and `c` runs completed
//                 after it (c = 0: run 2, the curve's floor; 5: run 7; 9: run 11, full strength), each fresh-save
//                 candidate: the dispatch record, the run at SWEEP_END, its outcome line.
//   2. veteran  : the same Orion rank 1 runs from a veteran save (an expedition flown before 0.14.0).
//   3. freighter: a fresh save's first expedition from the General Freighter (not an explorer, so never the training
//                 run): the first ordinary run of a new save.
//
// RE-PINNED BY SF-3: see the GOLDEN header.

import { describe, expect, it } from "vitest";
import type { Expedition, GameState } from "./model";
import { advanceExpedition, startExpedition } from "./expedition";
import { hash, onHull, runOutcome, SWEEP_END, withCrew, type CrewName, type RunOutcome } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran } from "./awayTeamTestFixtures";
import { runCountsOf } from "./runDifficulty";

const CANDS = ["cand-0", "cand-1", "cand-2"];

function line(o: RunOutcome): string {
  return `${o.phase} ${o.objectives} lost:${o.lostFights} sent:${o.sentBack} stuck:${o.stuck.join("+") || "none"} hull:${o.hullDamage} setbacks:${o.setbacks} boarded:${o.boardingLoss} vault:${o.vaultSites}`;
}

// `state` with its training run behind it and `completed` runs flown after it (not a veteran). Pure.
function afterTraining(state: GameState, completed: number): GameState {
  const counts = runCountsOf(state);
  return { ...state, nextExpeditionId: completed + 2, runCounts: { ...counts, expedition: { completed, trainingDone: true, veteran: false } } };
}

function run(state: GameState, cand: string): { exp: Expedition; done: Expedition } {
  const res = startExpedition(state, "ship-1", 1, cand);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { exp: res.expedition, done: advanceExpedition(res.expedition, SWEEP_END) };
}

function rows(state: GameState): string[] {
  return CANDS.flatMap((cand) => {
    const { exp, done } = run(state, cand);
    return [hash(exp), hash(done), `${cand} ${line(runOutcome(done))}`];
  });
}

// Captured on a678241, before any SF-3 engine edit.
const GOLDEN: Record<string, unknown> = {
  "ramp:orion:d18:c0": [
    "ce84b1d0",
    "f574da1f",
    "cand-0 activities 1/11 lost:40 sent:585 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "d5d5d01b",
    "fbf34d3",
    "cand-1 activities 7/10 lost:40 sent:583 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "1e28f2fe",
    "7f33cde5",
    "cand-2 activities 7/9 lost:40 sent:554 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "ramp:orion:d18:c5": [
    "23489115",
    "af759232",
    "cand-0 activities 1/11 lost:40 sent:585 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "6840940a",
    "c2650e3a",
    "cand-1 activities 7/10 lost:40 sent:583 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "366701c5",
    "4d0ded5e",
    "cand-2 activities 7/9 lost:40 sent:554 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "ramp:orion:d18:c9": [
    "70080fba",
    "be36992d",
    "cand-0 activities 1/11 lost:40 sent:585 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "551dc511",
    "9cc09c7",
    "cand-1 activities 7/10 lost:40 sent:583 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "db1fdb00",
    "7af0dc7f",
    "cand-2 activities 7/9 lost:40 sent:554 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "ramp:orion:rank1:c0": [
    "c3c40923",
    "185f067b",
    "cand-0 activities 6/11 lost:78 sent:515 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "1b169260",
    "8386bb07",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "3efc3c93",
    "1d786b8c",
    "cand-2 activities 7/9 lost:40 sent:577 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "ramp:orion:rank1:c5": [
    "909fcaf4",
    "b92b7cbe",
    "cand-0 activities 6/11 lost:78 sent:515 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "59914f4b",
    "ffdf6f8d",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "4b9f4352",
    "df4a5be9",
    "cand-2 activities 7/9 lost:40 sent:577 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "ramp:orion:rank1:c9": [
    "44314565",
    "109f644b",
    "cand-0 activities 6/11 lost:78 sent:515 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "322d1c2e",
    "4b5e9987",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "67e0356d",
    "93037156",
    "cand-2 activities 7/9 lost:40 sent:577 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "ramp:veteran:orion:rank1": [
    "4ef72392",
    "7ef68ab8",
    "cand-0 activities 6/11 lost:78 sent:515 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "3dcd529d",
    "69784381",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "7ff36c50",
    "63ca74cb",
    "cand-2 activities 7/9 lost:40 sent:577 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "ramp:freighter:rank1": [
    "9ded3b2b",
    "e1f0581d",
    "cand-0 activities 6/11 lost:78 sent:515 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "caefc2c",
    "cadbb888",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "db331cd7",
    "e1b80d77",
    "cand-2 activities 7/9 lost:40 sent:577 stuck:buriedVault+geothermalChamber hull:80 setbacks:2 boarded:0 vault:1",
  ],
};

function pin(key: string, value: unknown): void {
  expect(value, key).toEqual(GOLDEN[key]);
}

describe("SF-3 goldens 1: runs on the curve (Orion, training done, c runs completed)", () => {
  for (const crew of ["d18", "rank1"] as CrewName[]) {
    for (const completed of [0, 5, 9]) {
      it(`${crew}, ${completed} completed: each fresh candidate's record, run and outcome`, () => {
        pin(`ramp:orion:${crew}:c${completed}`, rows(afterTraining(withCrew(onHull("orion"), crew), completed)));
      });
    }
  }
});

describe("SF-3 goldens 2 and 3: a veteran's run and a fresh freighter's first run", () => {
  it("a veteran Orion rank 1", () => {
    pin("ramp:veteran:orion:rank1", rows(asExpeditionVeteran(withCrew(onHull("orion"), "rank1"))));
  });
  it("a fresh General Freighter rank 1 (its first expedition, an ordinary run)", () => {
    pin("ramp:freighter:rank1", rows(withCrew(onHull("generalFreighter"), "rank1")));
  });
});
