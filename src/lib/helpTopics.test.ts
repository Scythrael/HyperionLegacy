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
  // 0.13.9: 0.13.6 turned fuel into REACH (lightyears, free instant refuel) and retired the Fuel
  // Depot and the Local Deuterium Skim, but the manual kept describing the old fuel economy. Only
  // the fuel topic may name the retired pieces (to say they are retired); no topic may describe
  // fuel as something you burn, refine, or buy.
  it("describes fuel as reach, never the retired fuel economy (0.13.9)", () => {
    const retiredNames = /fuel depot|deuterium skim/i;
    const oldEconomy = /burns? (round-trip )?fuel|fuel cost|refines? deuterium|auto-bought|fuel gauge|gauge in the top bar/i;
    for (const t of HELP_TOPICS) {
      if (t.id !== "fuel") expect(retiredNames.test(t.body), `retired fuel facility named in: ${t.id}`).toBe(false);
      expect(oldEconomy.test(t.body), `old fuel-economy wording in: ${t.id}`).toBe(false);
    }
    const fuel = HELP_TOPICS.find((t) => t.id === "fuel")!;
    expect(fuel.body).toMatch(/lightyears/i);
    expect(fuel.body).toMatch(/retired/i);
  });
  // 0.13.9: the manual still sent players to the 0.11.x programs (Foundry, Drydock, Stores) long
  // after the 0.12.0 console nav and the 0.13.2 Ships tab replaced them. Only current names now.
  it("uses the current nav names, never the retired Foundry / Drydock / Stores programs (0.13.9)", () => {
    const retiredNav = /\b(Foundry|Drydock|Stores)\b|\bprogram\b/;
    for (const t of HELP_TOPICS) {
      expect(retiredNav.test(t.body), `retired nav name in: ${t.id}`).toBe(false);
    }
  });
  // 0.13.9 final review: three more stale facts. Since 0.13.6 the admiral portrait opens Crew >
  // Admiral and the System window's settings tab is labeled Settings (opened by the top-bar gear);
  // and since "every hull is combat-capable" any hull can patrol (only a missing reactor blocks).
  it("never repeats the retired portrait / Options / combat-hull-only claims (0.13.9)", () => {
    const stale = /admiral portrait|from Options|Only a combat hull/i;
    for (const t of HELP_TOPICS) {
      expect(stale.test(t.body), `stale claim in: ${t.id}`).toBe(false);
    }
  });
});
