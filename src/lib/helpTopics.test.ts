import { describe, it, expect } from "vitest";
import { HELP_TOPICS } from "./helpTopics";

describe("HELP_TOPICS", () => {
  it("covers the core systems", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    for (const sys of ["missions", "refining", "fabricating", "research", "shipyard", "docks", "storage", "salvage", "fuel"]) {
      expect(ids, `missing help topic: ${sys}`).toContain(sys);
    }
  });
  it("every topic has a non-empty title and body", () => {
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
  // Task 15 (0.11.2): player-facing vocabulary is INSTALL ship systems, never the
  // old fit/fitment/fitted/unfit wording. Word-boundary matches so this stays
  // non-fragile (it never trips on unrelated words like "outfit" or "benefit").
  it("uses install vocabulary, never fit/fitment/fitted/unfit", () => {
    const banned = /\b(fitment|fitted|unfit|unfitted)\b/i;
    for (const t of HELP_TOPICS) {
      expect(banned.test(t.title), `stale fit-wording in title: ${t.id}`).toBe(false);
      expect(banned.test(t.body), `stale fit-wording in body: ${t.id}`).toBe(false);
    }
  });
});
