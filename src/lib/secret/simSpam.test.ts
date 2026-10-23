// simSpam.test.ts: Fleet spam (a Fleet the moment one pays anything) no longer speeds up Skill Points
// (0.13.11.1, user: "Yes, double it"). With the doubling bar a Fleet only pays once it doubles the
// Augment Points held, which is what the default 100% target waits for, so the spamming player
// learns every skill no sooner than the steady player and reaches the finale no sooner either.
import { describe, it, expect } from "vitest";
import { simulatePlayer } from "./sim";
import { SKILLS } from "./config";
import { timeline, DEFAULT_STEADY, TARGET_MARGIN } from "./simReport";

const allSkillsAt = (events: Record<string, number>) => Math.max(...SKILLS.map((d) => events[`skill:${d.id}`] ?? Infinity));

describe("Fleet spam", () => {
  it("learns every skill and reaches the finale no sooner than steady play", () => {
    const steady = simulatePlayer({ profile: "steady", days: 8, stopAfterFinale: true });
    const spam = simulatePlayer({ profile: "steady", days: 8, stopAfterFinale: true, style: { spam: true } });
    timeline("steady (to the finale)", steady);
    timeline("Fleet spam", spam);
    expect(Number.isFinite(allSkillsAt(steady.events))).toBe(true);
    expect(allSkillsAt(spam.events)).toBeGreaterThanOrEqual(allSkillsAt(steady.events));
    for (const d of SKILLS) expect(spam.events[`skill:${d.id}`], d.id).toBeGreaterThanOrEqual(steady.events[`skill:${d.id}`]);
    expect(spam.final.fleetTotal).toBeLessThanOrEqual(steady.final.fleetTotal);
    expect(spam.events.finale).toBeGreaterThanOrEqual(DEFAULT_STEADY.finale * (1 - TARGET_MARGIN));
  }, 600000);
});
