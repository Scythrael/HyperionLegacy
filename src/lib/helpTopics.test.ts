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
});
