// Objective affixes UI step (0.14.0): the display decisions of an objective's affix pills, its alert and the
// Impossible countdown (objectiveAffixDisplay.ts). Display only: every number is the engine's (affixes.ts).

import { describe, expect, it } from "vitest";
import type { ExpeditionActivity, ObjectiveAffix } from "./game/model";
import { REINFORCING_RANKS, alertResetsAt, escalationAt } from "./game/affixes";
import {
  DEADLY_REINFORCING_NOTE,
  IMPOSSIBLE_HEX,
  affixNamePill,
  affixPillView,
  countdownText,
  forecastAffixPills,
  objectiveAffixesView,
  objectiveAlertView,
} from "./objectiveAffixDisplay";

const T = 50_000;
const R3: ObjectiveAffix = { id: "reinforcing", rank: 3, alignment: "negative" };

function objective(over: Partial<ExpeditionActivity> = {}): ExpeditionActivity {
  return { id: "x-act-0", bodyId: "body-1", poiId: "derelictOutpost", done: false, status: "queued", difficulty: 5, difficultyScore: 8, affixes: [R3], ...over };
}

describe("affix pills", () => {
  it("a pill per affix: the rank in the label, the alignment color AND word, the short line as its tooltip", () => {
    const p = affixPillView(R3);
    expect(p).toMatchObject({ key: "reinforcing-3-negative", label: "Reinforcing III", color: "red", alignment: "Negative" });
    expect(p.tooltip).toMatch(/^Quick to reinforce: a 40% chance of up to 2 extra battles during each visit\./);
    // The accessible name carries everything the pill shows and its bubble (nothing hover-only).
    expect(p.ariaLabel).toBe(`Reinforcing III, negative affix. ${p.tooltip}`);
  });

  it("alignment colors are the user's green / yellow / red", () => {
    expect(affixPillView({ ...R3, alignment: "positive" }).color).toBe("green");
    expect(affixPillView({ ...R3, alignment: "neutral" }).color).toBe("yellow");
    expect(affixPillView({ ...R3, alignment: "positive" }).alignment).toBe("Positive");
  });

  it("the block lists only well-formed affixes, and is null with no affix and no alert", () => {
    const v = objectiveAffixesView(objective({ affixes: [R3, { id: "reinforcing", rank: 99, alignment: "negative" }] }), T)!;
    expect(v.pills.map((p) => p.label)).toEqual(["Reinforcing III"]);
    expect(v.alert).toBeNull();
    expect(objectiveAffixesView(objective({ affixes: undefined }), T)).toBeNull();
  });

  it("a name-only pill for the telescope (the rank is not rolled yet), and the forecast shows it only on a Deadly fight", () => {
    expect(affixNamePill("reinforcing", "why")).toMatchObject({ label: "Reinforcing", color: "red", alignment: "Negative", tooltip: "why" });
    expect(forecastAffixPills({ difficulty: 5, fightPoints: 3 }).map((p) => [p.label, p.tooltip])).toEqual([["Reinforcing", DEADLY_REINFORCING_NOTE]]);
    expect(forecastAffixPills({ difficulty: 4, fightPoints: 3 })).toEqual([]);
    expect(forecastAffixPills({ difficulty: 5, fightPoints: 0 })).toEqual([]);
    expect(forecastAffixPills(null)).toEqual([]);
  });
});

describe("the alert and the Impossible countdown", () => {
  it("on alert: the level, the extra enemies, the Heightened Senses stacks, the raised rating and when it clears", () => {
    const task = objective({ difficultyScore: 6, difficulty: 4, alert: { level: 2, lastAt: T - 600 } });
    const v = objectiveAlertView(task, T)!;
    const bonus = Math.round((escalationAt(2).damageMult - 1) * 100);
    expect(v.held).toBe(false);
    expect(v.headline).toBe("On alert (level 2)");
    expect(v.effects).toBe(`2 more enemies per fight, Heightened Senses x2 (+${bonus}% enemy damage)`);
    expect(v.ratingText).toBe("Rating raised to Deadly"); // score 6 + 2
    expect(v.resetText).toBe(`The alert clears in ${countdownText(T - 600 + REINFORCING_RANKS[2].resetSeconds, T)}`);
    expect(objectiveAlertView({ ...task, alert: { level: 1, lastAt: T - 10 } }, T)!.effects).toMatch(/^1 more enemy per fight, Heightened Senses x1 \(\+18% enemy damage\)$/);
  });

  it("held at Impossible: the user's countdown, ticking down with the clock, then gone at the reset", () => {
    const task = objective({ alert: { level: 3, lastAt: T - 100 } }); // score 8 + 3 = 11: Impossible
    const resets = alertResetsAt(task)!;
    const v = objectiveAlertView(task, T)!;
    expect(v.held).toBe(true);
    expect(v.headline).toBe(`Impossible: resets in ${countdownText(resets, T)}`);
    expect(v.headline).toBe("Impossible: resets in 48m 20s");
    expect(v.ratingText).toBeNull();
    expect(v.resetText).toMatch(/the threat appears to have retreated, and the objective returns to normal difficulty\.$/);
    expect(objectiveAlertView(task, T + 1)!.headline).toBe("Impossible: resets in 48m 19s");
    expect(objectiveAlertView(task, resets - 0.5)!.headline).toBe("Impossible: resets in 1s");
    expect(objectiveAlertView(task, resets)).toBeNull();
    expect(objectiveAffixesView(task, resets)!.alert).toBeNull();
  });

  it("countdowns round up to the second and never go negative", () => {
    expect(countdownText(T + 59.2, T)).toBe("1m");
    expect(countdownText(T + 3725, T)).toBe("1h 2m");
    expect(countdownText(T, T)).toBe("now");
    expect(countdownText(T - 5, T)).toBe("now");
  });

  it("the Impossible color is the threat ramp's crimson (user 2026-10-14)", () => {
    expect(IMPOSSIBLE_HEX).toBe("#e11d48");
  });

  it("no em dash, no double hyphen, never 'task' in anything shown", () => {
    const held = objectiveAffixesView(objective({ alert: { level: 3, lastAt: T - 100 } }), T);
    const alert = objectiveAffixesView(objective({ difficultyScore: 6, alert: { level: 2, lastAt: T - 100 } }), T);
    const text = JSON.stringify([held, alert, forecastAffixPills({ difficulty: 5, fightPoints: 1 })]);
    expect(text).not.toMatch(/—|-{2}/);
    expect(text).not.toMatch(/\btasks?\b/i);
  });
});
