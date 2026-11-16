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

// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, expect, it } from "vitest";
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import type { Expedition, GameState } from "./model";
import { advanceExpedition } from "./expedition";
import { hash, onHull, runOutcome, SWEEP_END, withCrew, type CrewName, type RunOutcome } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPreG2NamesDispatch, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { runCountsOf } from "./runDifficulty";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): the star rule (lane 3 I2, STAR_BODIES_SWITCH: a real star's bodies are drawn from the star,
// not from its candidate slot) moves the d18 and rank1 rows' fresh candidates (the list after the training run holds
// Wolf 359). The pins here predate the round and are about another slice, so the file runs with that fix off
// (fixRoundESwitch.fixture.ts); every other fix of the round runs here. The round's own pins:
// expeditionFixRoundE.test.ts and expeditionFixRoundEGoldens.test.ts.
fixRoundESwitchesOffForThisFile("starBodies");
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

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
  // Merged with G2-2 / G2-3 (region names, the voyage): dispatched as before G2-2 (the banked name, no region, no
  // voyage), so the fixed pre-G2-3 legs fly and these pins keep proving only SF-3 moved them.
  const res = asPreG2NamesDispatch(dispatchPastPropulsion(state, "ship-1", 1, cand));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { exp: res.expedition, done: advanceExpedition(res.expedition, SWEEP_END) };
}

function rows(state: GameState): string[] {
  return CANDS.flatMap((cand) => {
    const { exp, done } = run(state, cand);
    return [hash(exp), hash(done), `${cand} ${line(runOutcome(done))}`];
  });
}

// Captured on a678241, before any SF-3 engine edit (every record unstamped, every run at nominal Tier I on the raw
// hazard). RE-PINNED BY SF-3, every key on purpose (the dispatch record now carries the ordinary stamp
// `difficulty: { version 1, firstRun false, ramp, tier 1 }`, so every record hash moves):
//   ramp:orion:*:c0    run 2, the curve's floor: guards at 0.35 of nominal on the hazard at most 0.1, every unled enemy
//                      Weak (x0.7), no rolled affix, no ambush, every ship-event check passed and no hull wear. Both
//                      crews finish all three candidates (the D18 minimum was 1/11, 7/10, 7/9 stuck).
//   ramp:orion:*:c5    run 7, still the low end (strength 0.62, Weak): rank 1 finishes all three; the D18 minimum finishes
//                      more objectives but stays stuck (Vault, Subterranean, ordinary sites at nominal-ish strength).
//   ramp:orion:*:c9    run 11, full strength: the only change is the Tier I hazard ceiling (the vault fix): the guards
//                      and the ship battles' enemy read hazard 0.1 (cand-0 volcanic 0.65, cand-1 ocean 0.4, cand-2 toxic
//                      0.9), so fewer battles are lost (cand-2 hull 55 to 14) and more salvage is held when a boarding
//                      takes its share (boarded 0 to 11). Rank 1 now finishes cand-1 and clears every ordinary site,
//                      but still holds a Subterranean final (cand-0) and a Vault final (cand-2): the FKR-1 Elite and
//                      Boss leads of Challenging and harder objectives.
//   ramp:veteran:*     a veteran reads full strength: the same outcome lines as c9 (the ceiling only).
//   ramp:freighter:*   a new save's freighter run is an ordinary run with no completed run behind it: run 2's floor.
// RE-PINNED BY THE SF-3 REVIEW (user 2026-10-21 "Fade Weak", "Smooth the last steps"), c5 and c9 only (c0, veteran
// and freighter unchanged: the floor and full strength read the same numbers):
//   ramp:orion:*:c5    run 7: unled enemies x0.82 (Weak fading) where they stood at a flat x0.7, and the stamp carries
//                      the odds' lagging position (oddsRamp): the D18 minimum holds one more Subterranean objective on
//                      cand-0 and cand-1, rank 1 loses one more fight on cand-0 and still finishes all three.
//   ramp:orion:*:c9    run 11 is no longer full strength (0.93, unled enemies x0.97, odds at run 10's 0.79): rank 1 now
//                      finishes all three candidates (cand-0 Subterranean and cand-2 Vault finals won); the D18 minimum
//                      is unchanged apart from a few send-backs and 2 less hull wear on cand-2.
const GOLDEN: Record<string, unknown> = {
  "ramp:orion:d18:c0": [
    "baeff32f",
    "5dbe48e0",
    "cand-0 complete 11/11 lost:38 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "dc68585a",
    "a848ce52",
    "cand-1 complete 11/11 lost:4 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "ea328255",
    "aeeed4c3",
    "cand-2 complete 9/9 lost:1 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "ramp:orion:d18:c5": [
    "18c1ce14",
    "b422fdec",
    "cand-0 activities 2/11 lost:40 sent:545 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "e27be221",
    "527b9ce9",
    "cand-1 activities 9/11 lost:40 sent:579 stuck:subterraneanCivilization+subterraneanCivilization hull:0 setbacks:1 boarded:3 vault:2",
    "eb01ecb0",
    "11e140b2",
    "cand-2 activities 7/9 lost:40 sent:570 stuck:buriedVault+geothermalChamber hull:0 setbacks:1 boarded:11 vault:1",
  ],
  "ramp:orion:d18:c9": [
    "142bab2c",
    "d6ab446a",
    "cand-0 activities 1/11 lost:40 sent:583 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "1b81a061",
    "db3f9036",
    "cand-1 activities 7/10 lost:40 sent:581 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "dc2078",
    "24003c84",
    "cand-2 activities 7/9 lost:40 sent:572 stuck:buriedVault+geothermalChamber hull:12 setbacks:2 boarded:11 vault:1",
  ],
  "ramp:orion:rank1:c0": [
    "1364d0e6",
    "b703b9cc",
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "7d5bc41b",
    "94a10cce",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "6908f762",
    "c9f4816d",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "ramp:orion:rank1:c5": [
    "11b641d7",
    "dd792e1a",
    "cand-0 complete 11/11 lost:2 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "a7dcdffe",
    "308fa1ae",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:1 boarded:3 vault:2",
    "10c7ee5d",
    "3ce55b8",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:1 boarded:11 vault:1",
  ],
  "ramp:orion:rank1:c9": [
    "ba8e526f",
    "c78adbe7",
    "cand-0 complete 11/11 lost:40 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "3939a83e",
    "b557931c",
    "cand-1 complete 10/10 lost:5 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "f145c005",
    "ddb77cc",
    "cand-2 complete 9/9 lost:39 sent:0 stuck:none hull:12 setbacks:2 boarded:11 vault:1",
  ],
  "ramp:veteran:orion:rank1": [
    "7ccbdad2",
    "6c49114c",
    "cand-0 activities 10/11 lost:41 sent:69 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cde99c25",
    "35bd3d4f",
    "cand-1 complete 10/10 lost:39 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "1ae28980",
    "2c3a8492",
    "cand-2 activities 8/9 lost:40 sent:569 stuck:buriedVault hull:14 setbacks:2 boarded:11 vault:1",
  ],
  "ramp:freighter:rank1": [
    "40cc6874",
    "38d58766",
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "439a8df1",
    "b9a285ef",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "75fda92c",
    "3b299a97",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
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
