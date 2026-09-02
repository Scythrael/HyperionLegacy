import { describe, it, expect } from "vitest";
import { ICON_PATHS, ICON_NAMES, iconA11y, type IconName } from "./icons";

// This repo has no Svelte component test harness (79 test files, none of them
// .svelte), and Unit 4.1 is not the place to invent one for a single component.
// So the component is kept thin and the two things worth gating are tested as
// plain data and a plain function instead:
//   1. the path map (every name draws something, and it is valid stroke data),
//   2. iconA11y, which owns the "decorative unless labelled" decision the
//      design's gate asks about.
// What is therefore NOT gated: that Icon.svelte spells the attributes right.
// svelte-check covers the types, and the visual check in both themes covers the
// rest, as the unit's gate says.

describe("ICON_PATHS", () => {
  it("gives every name at least one non-empty path string", () => {
    for (const name of ICON_NAMES) {
      const paths: readonly string[] = ICON_PATHS[name];
      expect(Array.isArray(paths), `icon ${name} must store an array of paths`).toBe(true);
      expect(paths.length, `icon ${name} has no path data`).toBeGreaterThan(0);
      for (const d of paths) {
        expect(typeof d, `icon ${name} has a non-string path`).toBe("string");
        expect(d.trim().length, `icon ${name} has an empty path`).toBeGreaterThan(0);
      }
    }
  });

  it("has unique names and exposes all of them through ICON_NAMES", () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    expect(ICON_NAMES.length).toBe(Object.keys(ICON_PATHS).length);
  });

  // Every path starts with a moveto, otherwise the segment has no start point
  // and renders nothing. Cheap catch for a truncated copy/paste.
  it("starts every path with a moveto command", () => {
    for (const name of ICON_NAMES) {
      for (const d of ICON_PATHS[name] as readonly string[]) {
        expect(d.trimStart().startsWith("M"), `icon ${name} path does not start with M: ${d}`).toBe(true);
      }
    }
  });

  // The drawing contract is stroke-only on a 24x24 grid. Path data carries no
  // color or fill, so the check that matters is that nobody smuggled markup or
  // a style string into what is rendered as a "d" attribute.
  it("stores path data only, never markup or styling", () => {
    const legal = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,+-]+$/;
    for (const name of ICON_NAMES) {
      for (const d of ICON_PATHS[name] as readonly string[]) {
        expect(legal.test(d), `icon ${name} path has illegal characters: ${d}`).toBe(true);
      }
    }
  });

  // The set the 0.13.3 design names as needed this release. Mirrors the
  // required-ids guard in helpTopics.test.ts: a later unit that renames one of
  // these fails here instead of silently rendering nothing.
  it("covers the set the crafting release needs", () => {
    const required: IconName[] = [
      "refinery", "fabricator", "research", "fuel", "warehouse", "salvage", "shipyard", "docks",
      "queue", "clock", "check", "warning",
      "ore", "ingot", "wafer", "component", "equipment", "ship", "credits",
      "chevronUp", "chevronDown", "chevronRight", "close",
    ];
    for (const name of required) {
      expect(ICON_NAMES, `missing icon: ${name}`).toContain(name);
    }
  });
});

describe("iconA11y", () => {
  it("is decorative when no title is given", () => {
    // The default case, and the important one: an icon beside a visible label
    // must not be announced, or the label is read twice.
    expect(iconA11y()).toEqual({ role: undefined, ariaHidden: "true", ariaLabel: undefined });
  });

  it("treats an empty or whitespace title as decorative", () => {
    // An empty accessible name is worse than none: it announces an unnamed image.
    expect(iconA11y("")).toEqual({ role: undefined, ariaHidden: "true", ariaLabel: undefined });
    expect(iconA11y("   ")).toEqual({ role: undefined, ariaHidden: "true", ariaLabel: undefined });
  });

  it("becomes a labelled image when a title is given", () => {
    expect(iconA11y("Move up")).toEqual({ role: "img", ariaHidden: undefined, ariaLabel: "Move up" });
  });
});
