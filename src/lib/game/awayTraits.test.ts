// E-CREW: sanity tests for the first-pass away-team trait catalog (awayTraits.ts). The catalog is
// data only; the effect descriptors are dormant until later tasks consume them. The player-facing
// numbers are GENERATED from the effects (awayTraitEffectText), never hand-written in a description.

import { describe, it, expect } from "vitest";
import {
  AWAY_TRAITS,
  awayTraitEffectText,
  awayTraitsForTeam,
  getAwayTrait,
  traitDisplayText,
  type AwayTraitEffect,
} from "./awayTraits";

const SECURITY_NAMES = ["Steady Aim", "Breacher", "Bulwark", "Field Medic", "Saboteur", "Quick Draw", "Iron Will", "Veteran"];
const SCIENCE_NAMES = ["Keen Eye", "Patient Hands", "Green Thumb", "Codebreaker", "Deep Survey", "Steady"];

// No em dash (spelled by code point) and no double hyphen in player-facing text.
function expectCleanText(text: string, label: string): void {
  expect(text, label).not.toContain(String.fromCharCode(0x2014));
  expect(text, label).not.toMatch(/-{2}/);
}

describe("AWAY_TRAITS catalog", () => {
  it("carries every trait the approved mockup names, on the right squad", () => {
    expect(awayTraitsForTeam("security").map((t) => t.label).sort()).toEqual([...SECURITY_NAMES].sort());
    expect(awayTraitsForTeam("science").map((t) => t.label).sort()).toEqual([...SCIENCE_NAMES].sort());
  });

  it("has unique ids, a description, at least one team type and at least one effect per trait", () => {
    const ids = AWAY_TRAITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of AWAY_TRAITS) {
      expect(t.description.length, t.id).toBeGreaterThan(0);
      expect(t.teamTypes.length, t.id).toBeGreaterThan(0);
      expect(t.effects.length, t.id).toBeGreaterThan(0);
    }
  });

  it("keeps numbers out of descriptions (they come from the effects, so they cannot drift)", () => {
    for (const t of AWAY_TRAITS) expect(t.description, t.id).not.toMatch(/\d/);
  });

  it("writes no em dashes or double hyphens in player-facing text", () => {
    for (const t of AWAY_TRAITS) expectCleanText(`${t.label} ${traitDisplayText(t)}`, t.id);
  });

  it("Field Medic carries the medic effect, so Security can cure", () => {
    const medic = AWAY_TRAITS.find((t) => t.label === "Field Medic");
    expect(medic?.effects).toEqual([{ kind: "medic" }]);
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

describe("trait text", () => {
  it("renders every effect kind from its numbers", () => {
    const cases: [AwayTraitEffect, string][] = [
      [{ kind: "stat", stat: "accuracy", value: 0.05 }, "+5% accuracy"],
      [{ kind: "stat", stat: "relicFind", value: 0.05 }, "+5% relic chance"],
      [{ kind: "medic" }, "Cures an ally's afflictions in battle"],
      [{ kind: "firstStrike" }, "Acts first on the opening round"],
      [{ kind: "guard", allyHpBelow: 0.4 }, "Takes hits meant for allies below 40% HP"],
      [{ kind: "resistStatus", status: "fear", value: 0.5 }, "Resists Fear (50%)"],
      [{ kind: "poiYield", pois: ["ancientRuins"], value: 0.1 }, "+10% yield at Ancient Ruins"],
      [{ kind: "poiYield", pois: ["ancientRuins", "crashedShip"], value: 0.1 }, "+10% yield at Ancient Ruins and Crashed Ship"],
      [
        { kind: "poiYield", pois: ["ancientRuins", "crashedShip", "buriedVault"], value: 0.1 },
        "+10% yield at Ancient Ruins, Crashed Ship and Buried Vault",
      ],
    ];
    for (const [effect, text] of cases) expect(awayTraitEffectText(effect)).toBe(text);
  });

  it("every catalog effect renders a clean, non-empty line", () => {
    for (const t of AWAY_TRAITS) {
      for (const e of t.effects) {
        const text = awayTraitEffectText(e);
        expect(text.length, t.id).toBeGreaterThan(0);
        expect(text, t.id).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it("traitDisplayText joins the flavor line and the generated effect text", () => {
    const veteran = getAwayTrait("veteran")!;
    expect(traitDisplayText(veteran)).toBe(`${veteran.description} +8% armor.`);
  });
});
