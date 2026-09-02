// icons.ts: the path data behind the shared <Icon> component (0.13.3 Unit 4.1).
//
// WHY this file exists: the 2026-09-01 design-system decision is that content
// icons MOVE TO SVG OVER TIME. Emoji render differently on every OS and cannot
// take the theme's color, so new icons are inline stroke SVG that inherit
// currentColor. 0.13.3 introduces a lot of item, recipe and queue-row icons, so
// the migration needs ONE home rather than one-off inline <path> markup
// accreting across App.svelte. This module is that home: adding an icon is a
// DATA addition here, never new markup at the call site.
//
// MIGRATION POLICY (enforced in review, from the design): all NEW icons are
// SVG through <Icon>. Existing emoji (HOME_ICON_GLYPH, the roster glyph, the
// loadout-board tiles, the warehouse material glyphs) migrate ONLY on a surface
// a later unit already rewrites. There is no standalone emoji sweep in 0.13.3.
//
// DRAWING CONTRACT, so a new icon matches the ones already here:
//   - One 24x24 grid (viewBox "0 0 24 24"), the same grid the 0.13.2 nav icons
//     use, so an icon can sit beside a nav glyph without looking off-scale.
//   - STROKE ONLY. No fills, no closed shapes relying on fill-rule. <Icon>
//     renders fill="none" stroke="currentColor" stroke-width="1.75" with round
//     caps and joins, matching the nav-icon idiom (App.svelte NAV_TABS).
//   - Keep the visual weight even: roughly 1 to 3 strokes of detail, nothing
//     that turns to mud at the 1em default size.
//   - Never bake a color in. Color arrives from the row via currentColor, which
//     is what makes these theme-aware for free.
//
// SHAPE NOTE (deliberate, small deviation from the design doc): the design
// wrote this as Record<IconName, string>. It is stored as a string ARRAY per
// icon instead, mirroring how App.svelte's NAV_TABS stores iconPaths: string[].
// Both render identically (a multi-subpath "d" is legal SVG), but one entry per
// visual part keeps multi-part glyphs readable and lets the test assert
// "every name has at least one path" in the obvious way. A single-part icon is
// simply a one-element array.

// The whole icon set as plain data. `as const satisfies` does two jobs at once:
// `satisfies` checks the shape (every value is a non-empty-ish list of path
// strings) WITHOUT widening the keys, and `as const` keeps the literal key set
// so IconName below is the exact union of what is defined here. Consequence:
// adding a key adds a name, and a typo at a call site is a compile error, the
// same discipline PROCESS_XP_AWARDS and QUEUE_ADAPTERS use for their maps.
export const ICON_PATHS = {
  // --- Facilities (one glyph per console, all visually distinct at a glance) ---

  // Refinery: a furnace body on a hearth line with a flame inside (raw ore in,
  // heat applied, refined material out).
  refinery: ["M3 21h18", "M5 21V7h14v14", "M12 17.5c-1.7 0-3-1.2-3-2.8 0-1.9 2-2.6 2-4.7 1.6.9 4 2.4 4 4.7 0 1.6-1.3 2.8-3 2.8z"],
  // Fabricator: a gantry with an extruder head laying a part on a bed. Reads as
  // "a machine that builds a thing", which is exactly what the console does.
  fabricator: ["M4 4h16", "M12 4v6", "M9 10h6l-1.5 3.5h-3z", "M5 20h14", "M9 20v-3h6v3"],
  // Research: a laboratory flask with a fill line.
  research: ["M10 3v6.5L5.2 18a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3L14 9.5V3", "M9 3h6", "M8.4 14h7.2"],
  // Fuel: a fuel pump (body, window, base, hose arm).
  fuel: ["M4 20V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15", "M3 20h11", "M6 7h5v4H6z", "M13 9h3a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V9l-2.5-2.5"],
  // Warehouse: a wide store building with a roll-up door.
  warehouse: ["M3 10l9-6 9 6v11H3z", "M8 21v-7h8v7", "M8 17.5h8"],
  // Salvage: the cyclic two-arrow loop, the universal "reclaim / recycle" read.
  salvage: ["M4 12a8 8 0 0 1 13.7-5.6L20 9", "M20 4v5h-5", "M20 12a8 8 0 0 1-13.7 5.6L4 15", "M4 20v-5h5"],
  // Shipyard: a hull suspended inside a construction gantry.
  shipyard: ["M3 4h18", "M6 4v5", "M18 4v5", "M12 21l5-9H7z"],
  // Docks: a berthed hull sitting on a pier with two pilings.
  docks: ["M3 14h18", "M6 14v6", "M18 14v6", "M12 3l4 8H8z"],

  // --- Queue and process state ---

  // Queue: a stack of layers. Deliberately NOT a plain list, because a list
  // glyph already reads as "menu"; a stack reads as "work piled behind the
  // running job", which is what queue depth actually is.
  queue: ["M12 3l8 4-8 4-8-4z", "M4 12l8 4 8-4", "M4 16.5l8 4 8-4"],
  // Clock: pending / waiting / time remaining.
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7.5V12l3 2"],
  // Check: done / satisfied requirement.
  check: ["M4 12.5l5 5L20 6.5"],
  // Warning: blocked, at cap, or a destructive action. The bang's dot is drawn
  // as a hair-length line so the round linecap paints it; a true zero-length
  // segment is not reliably rendered across engines.
  warning: ["M12 4L2.5 20h19z", "M12 10v4", "M12 16.9v.2"],

  // --- Materials and goods (Warehouse, recipe rows, salvage results) ---

  // Ore: a faceted raw rock with a seam. Sized to fill the grid like its
  // neighbours; a squat rock reads as a smaller icon at the same nominal size.
  ore: ["M7 20l-3.5-7L8 6h8l4.5 7-3.5 7z", "M8 6l4 7 4-7", "M12 13v7"],
  // Ingot: two stacked trapezoid bars, the refined counterpart to ore. They
  // share the y=14 edge on purpose, which is what makes them read as stacked.
  ingot: ["M5 14h14l2.5 6H2.5z", "M8.5 7h7l2 7h-11z"],
  // Wafer: a die inside a chip package with contact pins.
  wafer: ["M6 6h12v12H6z", "M9.5 9.5h5v5h-5z", "M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3"],
  // Component: a hex nut with a bore, the "fabricated part" read.
  component: ["M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"],
  // Equipment: a gear, used for installable ship systems and combat gear.
  equipment: ["M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M12 2v3M12 19v3M4.2 6.6l2.6 1.5M17.2 15.9l2.6 1.5M4.2 17.4l2.6-1.5M17.2 8.1l2.6-1.5"],
  // Ship: the same delta silhouette the Ships nav tab uses. Reusing it on
  // purpose: one concept, one glyph, so a hull reads the same everywhere.
  ship: ["M12 3l8 17-8-4-8 4z"],
  // Credits: a coin stamped with a C.
  credits: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M15 9.5a3.5 3.5 0 1 0 0 5"],

  // --- UI verbs (the controls the queue rows need) ---

  // Chevrons. The design listed one "chevron"; it is split by direction here
  // because a queue row needs move-up and move-down as two distinct, separately
  // labelled buttons, and rotating one glyph with CSS would hide that intent
  // from the markup. chevronRight doubles as the navigable-row affordance.
  chevronUp: ["M6 15l6-6 6 6"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronRight: ["M9 6l6 6-6 6"],
  // Close: remove a queued order, dismiss a modal.
  close: ["M6 6l12 12", "M18 6L6 18"],
} as const satisfies Record<string, readonly string[]>;

/**
 * Every icon this build knows how to draw.
 *
 * Derived FROM the data above rather than declared beside it, so the union and
 * the path map can never drift: a new key in ICON_PATHS is automatically a new
 * legal name, and a name that is not a key does not typecheck at the call site.
 */
export type IconName = keyof typeof ICON_PATHS;

/**
 * The icon names as a runtime array, for tests and for any future gallery or
 * dev-panel listing. Kept derived from the same object for the same reason.
 */
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/**
 * The accessibility attributes an icon should carry, given its optional label.
 *
 * This lives here, as a plain function, rather than inline in Icon.svelte for
 * one reason: this repo has NO Svelte component test harness (79 test files,
 * zero .svelte tests), so logic left in a template cannot be gated. Pulling the
 * one real decision out means the unit's a11y contract is node-testable without
 * inventing a component-testing stack for a single component.
 *
 * The decision itself: an icon sitting beside a visible text label is
 * DECORATIVE and must not be announced, or a screen reader reads the same thing
 * twice. So the DEFAULT is aria-hidden. A caller passing a title is saying "this
 * glyph is the only thing carrying this meaning", and then it becomes a labelled
 * image instead.
 *
 * Undefined members mean "omit this attribute" (Svelte drops undefined attrs).
 */
export function iconA11y(title?: string): {
  role: "img" | undefined;
  ariaHidden: "true" | undefined;
  ariaLabel: string | undefined;
} {
  // Whitespace-only is treated as no label: an empty accessible name is worse
  // than none, because it announces an unnamed image.
  const labelled = typeof title === "string" && title.trim().length > 0;
  if (!labelled) {
    return { role: undefined, ariaHidden: "true", ariaLabel: undefined };
  }
  return { role: "img", ariaHidden: undefined, ariaLabel: title };
}
