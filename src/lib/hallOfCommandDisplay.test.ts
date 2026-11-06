// Complement CP-16: the Archive's Hall of Command view model (hallOfCommandDisplay.ts).

import { describe, expect, it } from "vitest";
import { HALL_OF_COMMAND_HELP, gameDayOf, gameDayText, hallOfCommandRows } from "./hallOfCommandDisplay";
import type { HallOfCommandEntry } from "./game/model";
import { MAX_CAPTAIN_RETIREMENTS } from "./game/captainRetirement";

const entry = (over: Partial<HallOfCommandEntry>): HallOfCommandEntry => ({
  captainName: "Kira Nerys",
  levelReached: 31,
  retirementNumber: 2,
  missionsFlown: 148,
  retiredAtGameSeconds: 11 * 86_400 + 5,
  notables: [
    { kind: "levelMilestone", label: "Reached level 10", atGameSeconds: 86_400 },
    { kind: "firstExpedition", label: "First expedition", atGameSeconds: 2 * 86_400 + 1 },
  ],
  ...over,
});

describe("CP-16 Hall of Command display", () => {
  it("in-game days: Day 1 is the first 24 hours", () => {
    expect(gameDayOf(0)).toBe(1);
    expect(gameDayOf(86_399)).toBe(1);
    expect(gameDayOf(86_400)).toBe(2);
    expect(gameDayText(11 * 86_400)).toBe("Day 12");
  });

  it("no entries, no rows (the panel stays hidden)", () => {
    expect(hallOfCommandRows({})).toEqual([]);
    expect(hallOfCommandRows({ hallOfCommand: [] })).toEqual([]);
  });

  it("one card per entry, newest first, with every line the entry stores", () => {
    const rows = hallOfCommandRows({ hallOfCommand: [entry({}), entry({ captainName: "Second", retirementNumber: MAX_CAPTAIN_RETIREMENTS, missionsFlown: 1, notables: [] })] });
    expect(rows.map((r) => r.name)).toEqual(["Second", "Kira Nerys"]);
    const [last, first] = rows;
    expect(first).toMatchObject({ level: "Level 31", retirement: `Retirement 2 of ${MAX_CAPTAIN_RETIREMENTS}`, missions: "148 missions", retiredOn: "Day 12", final: false });
    expect(first.notables.map((n) => [n.label, n.day])).toEqual([
      ["Reached level 10", "Day 2"],
      ["First expedition", "Day 3"],
    ]);
    expect(last).toMatchObject({ missions: "1 mission", final: true, notables: [] });
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("the help line is plain US English with no em dashes", () => {
    expect(HALL_OF_COMMAND_HELP).not.toMatch(/\u2014|-{2}|\bfit/);
    expect(HALL_OF_COMMAND_HELP).toContain(`${MAX_CAPTAIN_RETIREMENTS} retirements`);
  });
});
