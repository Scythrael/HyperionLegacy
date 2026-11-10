// Complement CP-19: the Personnel Rosters track card's words (personnelRostersTrackDisplay.ts), read from the engine.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PERSONNEL_ROSTERS_FACILITY_KEY, type GameState } from "./game/model";
import { startFacilityUpgrade } from "./game/tick";
import { rostersTrackView } from "./personnelRostersTrackDisplay";
import { personnelRostersBoardHelpText } from "./helpTopics";
import { editCaptain, wiringBase } from "./game/wiring/probes";

const KEY = PERSONNEL_ROSTERS_FACILITY_KEY;
const atLevel = (s: GameState, level: number): GameState => ({ ...s, facilities: { ...s.facilities, [KEY]: { level } } });
const minutes = (t: number): string => `${t / 60}m`;

describe("CP-19 the Personnel Rosters track card", () => {
  it("a new save: Level 1 of 6, a board of 10, the next rung's cost, time and board", () => {
    const v = rostersTrackView(wiringBase(), { duration: minutes });
    expect(v.subtitle).toBe("Level 1 of 6 · 10 candidates per board");
    expect(v.board).toBe(10);
    expect(v.recruiterLine).toBeNull();
    expect(v.next).toEqual({ level: 2, credits: 3_000, durationTicks: 120, boardNow: 10, boardNext: 12, gainLine: "Level 2 adds 2 candidate slots to each board." });
    expect(v.ladder.map((r) => [r.level, r.boardText, r.costText, r.status])).toEqual([
      [1, "10 candidates per board", "Pre-granted", "current"],
      [2, "12 candidates per board", "3,000 credits · 2m", "next"],
      [3, "14 candidates per board", "6,000 credits · 4m", "later"],
      [4, "16 candidates per board", "9,000 credits · 7m", "later"],
      [5, "18 candidates per board", "12,000 credits · 12m", "later"],
      [6, "20 candidates per board", "15,000 credits · 20m", "later"],
    ]);
  });

  it("while a rung builds the next row reads In progress; at the top the card is fully upgraded", () => {
    const r = startFacilityUpgrade({ ...wiringBase(), credits: new Decimal(10_000) }, KEY);
    const v = rostersTrackView(r.next);
    expect(v.building).toBe(true);
    expect(v.ladder[1].statusText).toBe("In progress");
    const top = rostersTrackView(atLevel(wiringBase(), 6));
    expect(top.maxed).toBe(true);
    expect(top.next).toBeNull();
    expect(top.board).toBe(20);
  });

  it("the Recruiter's share is shown, and every number on the card includes it (the board the player sees)", () => {
    const s = editCaptain(atLevel(wiringBase(), 2), { unlockedSecondaryTalents: ["commandCrew4"] });
    const v = rostersTrackView(s);
    expect(v.board).toBe(13);
    expect(v.recruiterLine).toBe("Includes +1 from your Recruiter captain talent.");
    expect(v.next?.boardNext).toBe(16);
    expect(v.next?.gainLine).toBe("Level 3 adds 3 candidate slots to each board.");
  });

  it("Help says the board size and how to grow it, in the engine's numbers", () => {
    expect(personnelRostersBoardHelpText()).toBe(
      "CANDIDATE BOARDS: the officer board and the away-team recruit board each show 10 candidates at Personnel Rosters Level 1, where every save starts. The facility's Upgrades tab grows both boards: each level adds 2 candidate slots to each board, up to 20 at Level 6, and costs credits (3,000, 6,000, 9,000, 12,000 and 15,000) and a build time shown on the card. New slots join the end of the board; the candidates already on it stay the same. A captain with the Recruiter talent adds 8% on top, rounded up (the best one in the fleet counts).",
    );
  });
});
