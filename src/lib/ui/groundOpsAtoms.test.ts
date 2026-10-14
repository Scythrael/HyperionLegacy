import { describe, it, expect } from "vitest";
import { THREAT_TIER_ORDER, threatAssessment } from "../game/combat/threatAssessment";
import { GROUND_TEAM_KINDS } from "../game/groundComposition";
import { ICON_NAMES } from "./icons";
import { ICON_SEMANTICS } from "./iconPacks";
import {
  CHIP_TEXT_MIN_CONTRAST,
  TEAM_KIND_GLYPHS,
  chipBackground,
  contrastRatio,
  readableChipText,
  teamBadgeView,
  threatChipView,
} from "./groundOpsAtoms";

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

describe("threat chip text contrast (GO-10 review; user 2026-10-14 on the Impossible tier)", () => {
  it("every tier's face text meets WCAG AA on its own chip, and the bright tiers keep their band color", () => {
    for (const tier of THREAT_TIER_ORDER) {
      const [wins, samples] = SAMPLES[tier];
      const a = threatAssessment(wins, samples);
      const v = threatChipView(a);
      expect(contrastRatio(v.textColor, chipBackground(a.colorHex)), tier).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v.textColor, chipBackground(a.colorHex)), tier).toBeGreaterThanOrEqual(CHIP_TEXT_MIN_CONTRAST);
      if (["guaranteed", "likely", "worthy", "dice", "notAdvised"].includes(tier)) expect(v.textColor, tier).toBe(a.colorHex);
    }
  });

  it("lifts the darker bands toward white (Extreme, Impossible) but keeps the band color for the border and dot", () => {
    for (const [wins, samples] of [SAMPLES.extreme, SAMPLES.impossible]) {
      const a = threatAssessment(wins, samples);
      const v = threatChipView(a);
      expect(v.color).toBe(a.colorHex);
      expect(v.textColor).not.toBe(a.colorHex);
    }
  });

  it("the Impossible band itself reads at 3:1 or better on the panel (non-text contrast) and glows; no other tier glows", () => {
    const impossible = threatAssessment(...SAMPLES.impossible);
    expect(contrastRatio(impossible.colorHex, "#0a141e")).toBeGreaterThanOrEqual(3);
    for (const tier of THREAT_TIER_ORDER) {
      const v = threatChipView(threatAssessment(...SAMPLES[tier]));
      expect(v.glow, tier).toBe(tier === "impossible");
    }
  });

  it("readableChipText returns white only as a last resort and is a valid hex", () => {
    expect(readableChipText("#000000")).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(readableChipText("#000000"), chipBackground("#000000"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("teamBadgeView", () => {
  it("labels by position, A / B / C, whatever the team is called", () => {
    expect(teamBadgeView(0).letter).toBe("A");
    expect(teamBadgeView(1, null, "Night Owls").letter).toBe("B");
    expect(teamBadgeView(2).letter).toBe("C");
  });

  it("never draws the kind glyph on a small badge (it blurs below 20 px; callers show the kind as text)", () => {
    expect(teamBadgeView(0, "strike", "Alpha", "sm").glyph).toBeNull();
    expect(teamBadgeView(0, "strike", "Alpha", "sm").ariaLabel).toBe("Alpha, Strike team");
    expect(teamBadgeView(0, "strike", "Alpha", "md").glyph).toBe("strikeTeam");
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
