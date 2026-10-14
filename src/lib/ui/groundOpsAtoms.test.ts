import { describe, it, expect } from "vitest";
import { THREAT_TIER_ORDER, threatAssessment } from "../game/combat/threatAssessment";
import { GROUND_TEAM_KINDS } from "../game/groundComposition";
import { ICON_NAMES } from "./icons";
import { ICON_SEMANTICS } from "./iconPacks";
import { TEAM_KIND_GLYPHS, teamBadgeView, threatChipView } from "./groundOpsAtoms";

// One assessment per tier, driven through the real mapping so the chip reads exactly what dispatch shows.
const SAMPLES: Record<string, [number, number]> = {
  guaranteed: [64, 64],
  likely: [90, 100],
  worthy: [70, 100],
  dice: [50, 100],
  notAdvised: [30, 100],
  extreme: [10, 100],
  impossible: [0, 64],
};

// Any pictographic code point (the emoji ranges plus the variation selector that turns a symbol into one).
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

describe("threatChipView", () => {
  it("covers every tier with the SVG dot, the band color and no emoji anywhere", () => {
    for (const tier of THREAT_TIER_ORDER) {
      const [wins, samples] = SAMPLES[tier];
      const a = threatAssessment(wins, samples);
      expect(a.tier).toBe(tier);
      for (const full of [false, true]) {
        const v = threatChipView(a, full);
        expect(v.glyph).toBe("threatDot");
        expect(v.color).toBe(a.colorHex);
        for (const text of [v.text, v.title ?? "", v.range, v.voice, v.ariaLabel]) {
          expect(EMOJI.test(text), `${tier}: ${text}`).toBe(false);
          expect(text.includes(String.fromCharCode(0x2014)) || text.includes("-".repeat(2)), `${tier}: ${text}`).toBe(false);
        }
      }
    }
  });

  it("shows the short name in a cell and moves the full name into the bubble", () => {
    const a = threatAssessment(70, 100);
    const v = threatChipView(a);
    expect(v.text).toBe("Worthy");
    expect(v.title).toBe("A Worthy Adversary");
    expect(v.range).toBe(a.fuzzyRange);
    expect(v.voice).toBe(a.voice);
  });

  it("shows the full name on the face when asked (the patrol card), with no repeated title", () => {
    const v = threatChipView(threatAssessment(50, 100), true);
    expect(v.text).toBe("It's Time to Toss the Dice");
    expect(v.title).toBeNull();
  });

  it("keeps the patrol chip's accessible name: context, full name, odds phrase, officer line", () => {
    const a = threatAssessment(0, 64);
    expect(threatChipView(a, true).ariaLabel).toBe(`Threat Assessment: Impossible. ${a.fuzzyRange}. ${a.voice}`);
    expect(threatChipView(a, false, "Team B odds").ariaLabel.startsWith("Team B odds: Impossible. ")).toBe(true);
  });
});

describe("teamBadgeView", () => {
  it("labels by position, A / B / C, whatever the team is called", () => {
    expect(teamBadgeView(0).letter).toBe("A");
    expect(teamBadgeView(1, null, "Night Owls").letter).toBe("B");
    expect(teamBadgeView(2).letter).toBe("C");
  });

  it("adds the kind glyph only when a kind is given", () => {
    expect(teamBadgeView(0).glyph).toBeNull();
    expect(teamBadgeView(0, "strike").glyph).toBe("strikeTeam");
    expect(teamBadgeView(1, "survey").glyph).toBe("surveyTeam");
    expect(teamBadgeView(1, "ground").glyph).toBe("groundTeam");
  });

  it("names the badge for a screen reader from the team's name and kind", () => {
    expect(teamBadgeView(0).ariaLabel).toBe("Team A");
    expect(teamBadgeView(0, null, "  ").ariaLabel).toBe("Team A");
    expect(teamBadgeView(0, null, "Alpha").ariaLabel).toBe("Alpha");
    expect(teamBadgeView(1, "strike", "Bravo").ariaLabel).toBe("Bravo, Strike team");
  });

  it("maps every team kind to a registered, classified glyph, each one different", () => {
    const glyphs = GROUND_TEAM_KINDS.map((k) => TEAM_KIND_GLYPHS[k]);
    expect(new Set(glyphs).size).toBe(GROUND_TEAM_KINDS.length);
    for (const g of glyphs) {
      expect(ICON_NAMES).toContain(g);
      expect(ICON_SEMANTICS[g]).toBe("subject");
    }
  });
});
