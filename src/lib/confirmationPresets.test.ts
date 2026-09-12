// ============================================================================
// confirmationPresets.test.ts
// 0.13.5. The ladder's invariants, plus the two rules that make the dropdown honest.
//
// ⚠️ The load-bearing cases here are DISTINCTNESS and MONOTONICITY. Distinctness is what lets the
// selected rung be DERIVED rather than stored (no stored id means no stale label, but a duplicate
// rung would make the derivation ambiguous). Monotonicity is what makes a named ladder a real
// ladder: "Advanced" must ask for no more than "Beginner", or the names mislead.
// ============================================================================

import { describe, it, expect } from "vitest";
import { QUALITY_TIERS } from "./game/inventory";
import {
  ALL_QUALITY_TIERS,
  CONFIRMATION_PRESETS,
  CONFIRMATION_PRESET_ORDER,
  confirmationCount,
  presetOverwriteNeedsConfirm,
  resolveConfirmationLevel,
  settingsMatch,
  type ConfirmationSettings,
} from "./confirmationPresets";

describe("the ladder itself", () => {
  it("offers the six rungs the user named, in their order", () => {
    // Non-vacuity guard AND a spec check: the record lists these six names in this order, and the
    // dropdown is built from CONFIRMATION_PRESET_ORDER, so this pins both.
    expect(CONFIRMATION_PRESET_ORDER).toEqual([
      "allEnabled",
      "tutorial",
      "beginner",
      "intermediate",
      "advanced",
      "allOff",
    ]);
  });

  it("⚠️ every rung is DISTINCT, which is what lets the selected rung be derived rather than stored", () => {
    // If two rungs shared a value set, resolveConfirmationLevel would return whichever came first
    // and the dropdown would show one name for a state the player selected under another. Storing
    // the id would paper over that with a second source of truth; keeping them distinct removes it.
    for (const a of CONFIRMATION_PRESET_ORDER) {
      for (const b of CONFIRMATION_PRESET_ORDER) {
        if (a === b) continue;
        expect(
          settingsMatch(CONFIRMATION_PRESETS[a].values, CONFIRMATION_PRESETS[b].values),
          `${a} and ${b} are the same settings, so the derived label would be ambiguous`,
        ).toBe(false);
      }
    }
  });

  it("⚠️ is MONOTONE: each rung asks for strictly fewer confirmations than the one above it", () => {
    // The names promise an ordering. A rung that asked for MORE than the safer rung above it would
    // make "Advanced" mean something other than "bother me less", which no amount of help text
    // rescues. Strict, not merely non-increasing: an equal pair would be a duplicate in disguise.
    const counts = CONFIRMATION_PRESET_ORDER.map((id) => ({
      id,
      n: confirmationCount(CONFIRMATION_PRESETS[id].values),
    }));
    for (let i = 1; i < counts.length; i++) {
      expect(
        counts[i].n,
        `${counts[i].id} asks for ${counts[i].n}, which is not fewer than ${counts[i - 1].id}'s ${counts[i - 1].n}`,
      ).toBeLessThan(counts[i - 1].n);
    }
  });

  it("anchors both ends: everything on, then nothing on", () => {
    expect(CONFIRMATION_PRESETS.allEnabled.values).toEqual({
      refine: true,
      baselineWarning: true,
      salvageQualities: ALL_QUALITY_TIERS,
    });
    expect(CONFIRMATION_PRESETS.allOff.values).toEqual({
      refine: false,
      baselineWarning: false,
      salvageQualities: [],
    });
    expect(confirmationCount(CONFIRMATION_PRESETS.allOff.values)).toBe(0);
  });

  it("derives the quality tiers from QUALITY_TIERS, so a new top tier is covered automatically", () => {
    expect(ALL_QUALITY_TIERS.length).toBe(QUALITY_TIERS);
    // Advanced is expressed as "the top tier only", so it must move with the ceiling rather than
    // naming a literal that a seventh tier would leave behind.
    expect(CONFIRMATION_PRESETS.advanced.values.salvageQualities).toEqual([QUALITY_TIERS - 1]);
  });

  it("gives every rung its own help text, since the record put the help box beside the control", () => {
    const blurbs = CONFIRMATION_PRESET_ORDER.map((id) => CONFIRMATION_PRESETS[id].blurb);
    for (const b of blurbs) expect(b.length).toBeGreaterThan(20);
    expect(new Set(blurbs).size).toBe(blurbs.length);
    // The end of the scale must SAY what it turns off, per the record's explicit ask.
    expect(CONFIRMATION_PRESETS.allOff.blurb).toMatch(/Standard-Issue/);
  });
});

describe("resolveConfirmationLevel: the dropdown's displayed value", () => {
  it("names the rung when the settings are exactly that rung", () => {
    for (const id of CONFIRMATION_PRESET_ORDER) {
      expect(resolveConfirmationLevel(CONFIRMATION_PRESETS[id].values)).toBe(id);
    }
  });

  it("⚠️ reports CUSTOM as soon as one checkbox is edited by hand", () => {
    // Requirement 3, and the whole reason Custom exists. Flip one boolean off a clean rung.
    const edited: ConfirmationSettings = {
      ...CONFIRMATION_PRESETS.beginner.values,
      refine: !CONFIRMATION_PRESETS.beginner.values.refine,
    };
    expect(resolveConfirmationLevel(edited)).toBe("custom");
  });

  it("reports CUSTOM for a hand-edited quality set too, not just the booleans", () => {
    const base = CONFIRMATION_PRESETS.beginner.values;
    const edited: ConfirmationSettings = {
      ...base,
      salvageQualities: base.salvageQualities.filter((t) => t !== base.salvageQualities[0]),
    };
    expect(resolveConfirmationLevel(edited)).toBe("custom");
  });

  it("compares quality tiers as a SET, so click order never fakes a Custom state", () => {
    const base = CONFIRMATION_PRESETS.beginner.values;
    const reordered: ConfirmationSettings = {
      ...base,
      salvageQualities: [...base.salvageQualities].reverse(),
    };
    expect(resolveConfirmationLevel(reordered)).toBe("beginner");
  });

  it("names the rung when a hand-edit happens to land exactly on one", () => {
    // Not a lie: if the player's settings ARE Intermediate, saying Intermediate is correct, however
    // they got there. This case exists so nobody "fixes" it into a sticky Custom flag later.
    const viaHand: ConfirmationSettings = { ...CONFIRMATION_PRESETS.intermediate.values };
    expect(resolveConfirmationLevel(viaHand)).toBe("intermediate");
  });
});

describe("presetOverwriteNeedsConfirm: confirm ONLY when something would be lost", () => {
  it("does NOT confirm when switching between clean rungs", () => {
    // ⚠️ The point of the rule. A clean rung is reproducible in one click, so a dialog here is pure
    // friction, and this whole feature exists to reduce friction rather than add a new source of it.
    for (const from of CONFIRMATION_PRESET_ORDER) {
      for (const to of CONFIRMATION_PRESET_ORDER) {
        expect(
          presetOverwriteNeedsConfirm(CONFIRMATION_PRESETS[from].values, to),
          `${from} -> ${to} should not need a confirm`,
        ).toBe(false);
      }
    }
  });

  it("DOES confirm when the current state is Custom, because hand-tuned settings would be lost", () => {
    const custom: ConfirmationSettings = {
      refine: false,
      baselineWarning: true,
      salvageQualities: [0, 5],
    };
    expect(resolveConfirmationLevel(custom)).toBe("custom");
    for (const to of CONFIRMATION_PRESET_ORDER) {
      expect(presetOverwriteNeedsConfirm(custom, to)).toBe(true);
    }
  });
});
