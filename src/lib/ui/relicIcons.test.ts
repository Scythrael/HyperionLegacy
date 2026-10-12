import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ICON_NAMES } from "./icons";
import { RELICS, RELIC_SETS, MUSEUM_STATS, getRelicById } from "../game/relics";
import {
  RELIC_ICON,
  relicIcon,
  relicSetEmblem,
  relicSetShortLabel,
  relicRarityColor,
  RELIC_RARITY_LABEL,
  MUSEUM_STAT_LABEL,
  formatMuseumPct,
  formatMuseumStatBonus,
  RELIC_SET_IDS,
} from "./relicIcons";

// Exploration 0.14.0 (E4c): the ONE UI-side relic display vocabulary. The user's hard requirement is that
// every relic graphic is SVG through <Icon>, so the mapping is gated here: every relic has a REAL registry
// glyph, no two relics share one, a set's emblem is its capstone, and no relic surface carries an emoji.

const EMOJI = /\p{Extended_Pictographic}/u;

describe("relic -> icon mapping", () => {
  it("maps every one of the 17 relics to a real, distinct registry glyph", () => {
    const names = new Set<string>(ICON_NAMES);
    for (const r of RELICS) {
      const icon = RELIC_ICON[r.id];
      expect(icon, `relic ${r.id} has no glyph`).toBeDefined();
      expect(names.has(icon), `relic ${r.id} maps to unknown glyph ${icon}`).toBe(true);
    }
    expect(Object.keys(RELIC_ICON).sort()).toEqual(RELICS.map((r) => r.id).sort());
    expect(new Set(Object.values(RELIC_ICON)).size).toBe(RELICS.length);
  });

  it("falls back to the unidentified-token glyph for an unknown relic id, never blank", () => {
    expect(relicIcon("notARelic")).toBe("relic");
    expect(relicIcon("ancientDriveCoil")).toBe("relicAncientDriveCoil");
  });

  it("a set's EMBLEM is its capstone relic's glyph", () => {
    for (const set of RELIC_SETS) {
      const capstone = set.relicIds.find((rid) => getRelicById(rid)!.rarity === "capstone")!;
      expect(relicSetEmblem(set.id)).toBe(RELIC_ICON[capstone]);
    }
  });
});

describe("relic display vocabulary", () => {
  it("short set labels drop the trailing 'Set'", () => {
    expect(RELIC_SET_IDS.map(relicSetShortLabel)).toEqual(["Precursor", "Shipwright", "Xenobiology", "Deep Earth"]);
  });

  it("names every museum stat (exhaustive), with clean text", () => {
    for (const stat of MUSEUM_STATS) {
      const label = MUSEUM_STAT_LABEL[stat];
      expect(label.length, `stat ${stat} has no label`).toBeGreaterThan(0);
      expect(EMOJI.test(label)).toBe(false);
    }
  });

  it("tints rarity classes through the shared --rarity-* tokens (theme-safe, never hex)", () => {
    for (const rarity of ["common", "uncommon", "rare", "capstone"] as const) {
      expect(relicRarityColor(rarity)).toMatch(/^var\(--rarity-[a-z]+\)$/);
      expect(RELIC_RARITY_LABEL[rarity].length).toBeGreaterThan(0);
    }
  });

  it("formats museum fractions as one-decimal percents", () => {
    expect(formatMuseumPct(0)).toBe("+0%");
    expect(formatMuseumPct(0.001)).toBe("+0.1%");
    expect(formatMuseumPct(0.01)).toBe("+1.0%");
    expect(formatMuseumPct(0.015)).toBe("+1.5%");
    expect(formatMuseumPct(0.126)).toBe("+12.6%");
    // Float noise from an accumulated sum does not leak into the label.
    expect(formatMuseumPct(0.1 + 0.2)).toBe("+30.0%");
  });
});

describe("museum stat bonus text (GO-6: the hazard resist reads EFFECTIVE)", () => {
  it("every stat but hazard resist reads its plain bonus", () => {
    expect(formatMuseumStatBonus("researchSpeed", 0.015)).toBe("+1.5% research speed");
    expect(formatMuseumStatBonus("rareMaterialChance", 0.3)).toBe("+30.0% rare material chance");
  });

  it("hazard resist shows the effective resist on the curve toward the cap, never the raw sum", () => {
    expect(formatMuseumStatBonus("hazardResist", 0.3)).toBe("+28.5% hazard resist (diminishing from +30.0%)");
    expect(formatMuseumStatBonus("hazardResist", 0.01)).toBe("+1.0% hazard resist (diminishing)");
    expect(formatMuseumStatBonus("hazardResist", 0)).toBe("+0% hazard resist");
  });
});

describe("no emoji on the relic surfaces (user hard requirement: every graphic is SVG)", () => {
  const FILES = [
    "src/lib/RelicStudyPanel.svelte",
    "src/lib/MuseumPanel.svelte",
    "src/lib/ui/relicIcons.ts",
    "src/lib/relicReveal.ts",
  ];
  it.each(FILES)("%s contains no emoji", (path) => {
    const src = readFileSync(path, "utf-8");
    expect(src.length, `${path} is empty`).toBeGreaterThan(100);
    const hits = [...src].filter((c) => EMOJI.test(c));
    expect(hits).toEqual([]);
  });
});
