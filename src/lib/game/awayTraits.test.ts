// E-CREW: sanity tests for the first-pass away-team trait catalog (awayTraits.ts). The catalog is
// data only; the effect descriptors are dormant until later tasks consume them.

import { describe, it, expect } from "vitest";
import { AWAY_TRAITS, awayTraitsForTeam, getAwayTrait } from "./awayTraits";

const SECURITY_NAMES = ["Steady Aim", "Breacher", "Bulwark", "Field Medic", "Saboteur", "Quick Draw", "Iron Will", "Veteran"];
const SCIENCE_NAMES = ["Keen Eye", "Patient Hands", "Green Thumb", "Codebreaker", "Deep Survey", "Steady"];

describe("AWAY_TRAITS catalog", () => {
  it("carries every trait the approved mockup names, on the right squad", () => {
    expect(awayTraitsForTeam("security").map((t) => t.label).sort()).toEqual([...SECURITY_NAMES].sort());
    expect(awayTraitsForTeam("science").map((t) => t.label).sort()).toEqual([...SCIENCE_NAMES].sort());
  });

  it("has unique ids, a description, and at least one team type per trait", () => {
    const ids = AWAY_TRAITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of AWAY_TRAITS) {
      expect(t.description.length, t.id).toBeGreaterThan(0);
      expect(t.teamTypes.length, t.id).toBeGreaterThan(0);
    }
  });

  it("writes no em dashes or double hyphens in player-facing text", () => {
    for (const t of AWAY_TRAITS) {
      const text = `${t.label} ${t.description}`;
      expect(text, t.id).not.toContain(String.fromCharCode(0x2014)); // the em dash, spelled by code point
      expect(text, t.id).not.toMatch(/-{2}/);
    }
  });

  it("Field Medic carries the medic effect, so Security can cure", () => {
    const medic = AWAY_TRAITS.find((t) => t.label === "Field Medic");
    expect(medic?.effect).toEqual({ kind: "medic" });
    expect(medic?.teamTypes).toContain("security");
  });

  it("no trait rolls for the wired-only Prospecting squad yet", () => {
    expect(awayTraitsForTeam("prospecting")).toEqual([]);
  });

  it("getAwayTrait finds by id and tolerates an unknown id", () => {
    const first = AWAY_TRAITS[0];
    expect(getAwayTrait(first.id)).toBe(first);
    expect(getAwayTrait("noSuchTrait")).toBeUndefined();
  });
});
