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
  // neighbors; a squat rock reads as a smaller icon at the same nominal size.
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

  // --- Relics + Museum (Exploration 0.14.0, phase E4) ---
  // The user asked for every relic graphic to be SVG (2026-10-01), so the whole relic surface is
  // born on <Icon> rather than migrated later. One glyph per relic so a Museum roster reads at a
  // glance; a set's capstone glyph doubles as that set's emblem.

  // Relic (unidentified): a sealed hex token with a question mark. The hex is the same token the
  // approved mockup's Relic Vault used; the "?" is what separates it from `component`'s hex nut.
  relic: ["M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z", "M10 9.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.9", "M12 15.9v.2"],
  // Museum: a classical front (pediment, entablature, four columns, stepped base).
  museum: ["M3 9l9-5 9 5z", "M4 11h16", "M6.5 11v6M10.5 11v6M13.5 11v6M17.5 11v6", "M4 17h16M3 20h18"],
  // Study: a magnifying glass, the "examine this unknown thing" verb.
  study: ["M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M15.3 15.3L20 20"],
  // Discovery: a four-point sparkle with a small companion, the "first find" moment.
  discovery: ["M11 3c.6 4.3 1.9 5.9 6 6.5-4.1.6-5.4 2.2-6 6.5-.6-4.3-1.9-5.9-6-6.5 4.1-.6 5.4-2.2 6-6.5z", "M19 15v4M17 17h4"],

  // Precursor Set (the lost civilization).
  // Glyph Tablet: an arch-topped stone slab with engraved lines.
  relicGlyphTablet: ["M6 21V8a6 6 0 0 1 12 0v13z", "M9.5 10.5h5M9.5 14h3M9.5 17.5h5"],
  // Resonance Shard: a crystal kite with sound arcs on either side.
  relicResonanceShard: ["M12 3l4 8-4 10-4-10z", "M8 11h8", "M19.5 8.5a5 5 0 0 1 0 5M4.5 8.5a5 5 0 0 0 0 5"],
  // Star-Chart Fragment: a torn sheet with a marked star and a plotted course. The star is a
  // four-point sparkle, not a plus, so it cannot be misread as an "add" control.
  relicStarChartFragment: ["M4 4h11l-2 4.5 2.5 3.5-2.5 3.5 2 4.5H4z", "M8.5 7c.3 1.7.9 2.3 2.5 2.5-1.6.2-2.2.8-2.5 2.5-.3-1.7-.9-2.3-2.5-2.5 1.6-.2 2.2-.8 2.5-2.5z", "M6.5 17.5c1.5 0 2.7-.8 3.2-2.2"],
  // Precursor Lens: a telescope on a tripod (the lens as an instrument). Concentric rings were
  // tried first and read as a target or a radio button at 1em.
  relicPrecursorLens: ["M4 15l11-6 1.8 3.4-11 6z", "M15.2 7.6l3.4-1.8 2.4 4.6-3.4 1.8z", "M10.5 14.5L8 21M10.5 14.5l3.5 6.5"],
  // Heart of the Archive (capstone): a cut gem circled by an orbit, a core that still turns.
  relicHeartOfTheArchive: ["M12 4l5 7-5 9-5-9z", "M7 11h10", "M2.5 13c0-2 4.3-3.6 9.5-3.6s9.5 1.6 9.5 3.6-4.3 3.6-9.5 3.6-9.5-1.6-9.5-3.6z"],

  // Shipwright Set (lost ships).
  // Hull Rivet: a curved hull panel with its row of rivets. A side-view rivet was tried first and
  // read as a flying saucer at 1em.
  relicHullRivet: ["M3 9c5-3 13-3 18 0v8c-5-3-13-3-18 0z", "M7 11.6v.2M12 10.8v.2M17 11.6v.2"],
  // Flight Recorder: the black box, a handled case carrying a data trace.
  relicFlightRecorder: ["M5 8h14v12H5z", "M9 8V5h6v3", "M7.5 14h2l1.5-3 2 6 1.5-3h2"],
  // Ancient Drive Coil: a wound coil between two end plates.
  relicAncientDriveCoil: ["M5 4.5h14M5 19.5h14", "M7 4.5l10 3-10 3 10 3-10 3 10 3"],
  // Captain's Sigil (capstone): a medallion bearing the fleet delta, on a ribbon.
  relicCaptainsSigil: ["M12 3.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M12 6.5l3 6-3-1.5-3 1.5z", "M9.5 15L8 21l4-2 4 2-1.5-6"],

  // Xenobiology Set (strange life).
  // Spore Capsule: a sealed pill with spores drifting off it.
  relicSporeCapsule: ["M9 7a3 3 0 0 1 6 0v10a3 3 0 0 1-6 0z", "M9 12h6", "M18.5 5.5v.2M20.5 8.5v.2M19.5 2.5v.2"],
  // Bioluminescent Seed: a teardrop seed throwing off light.
  relicBioluminescentSeed: ["M12 5c2.5 3 4 5.3 4 7.5a4 4 0 0 1-8 0C8 10.3 9.5 8 12 5z", "M12 10v5", "M4.5 9l1.3.7M19.5 9l-1.3.7M3.5 14.5h1.4M20.5 14.5h-1.4"],
  // Leviathan Scale: the overlapping scale pattern (two scales over one). A single shield-shaped
  // scale was tried first and read as a shield.
  relicLeviathanScale: ["M4 5c0 4 1.8 6.5 4 6.5S12 9 12 5M12 5c0 4 1.8 6.5 4 6.5S20 9 20 5", "M8 11.5c0 4 1.8 6.5 4 6.5s4-2.5 4-6.5", "M4 11.5c0 4 1.8 6.5 4 6.5M20 11.5c0 4-1.8 6.5-4 6.5"],
  // Living Crystal (capstone): a crystal prism with a leaf growing from it.
  relicLivingCrystal: ["M10 2.5l3 4.5v9l-3 5-3-5V7z", "M7 7h6", "M13 13.5c2.8-2.2 5.5-2 7.5-1.3-1 3-3.8 4.6-7.5 3.8"],

  // Deep Earth Set (the planet's interior).
  // Geode Core: a split rough stone with a crystal-starred hollow.
  relicGeodeCore: ["M7 5l6-1.5 5.5 3 2 6-2.5 6-6 1.5-5.5-2.5L4 12z", "M12 8.5l1.2 2.3 2.3.5-1.6 1.8.3 2.4-2.2-1-2.2 1 .3-2.4-1.6-1.8 2.3-.5z"],
  // Magma Pearl: a sphere with fire held inside it.
  relicMagmaPearl: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M12 16c-1.9 0-3.2-1.3-3.2-3 0-2 2-2.8 2-5 1.8 1 4.4 2.6 4.4 5 0 1.7-1.3 3-3.2 3z"],
  // Deep-Vein Compass: a compass rose whose needle points down the vein.
  relicDeepVeinCompass: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M15.5 8.5l-2 5-5 2 2-5z", "M12 3v2"],
  // Tectonic Keystone (capstone): a stone arch with its keystone set at the crown. A lone wedge
  // was tried first and read as a letter W at 1em; the arch is what makes it a keystone, and the
  // block joints are what stop the bare arch reading as a horseshoe magnet.
  relicTectonicKeystone: ["M3 21v-8a9 9 0 0 1 18 0v8", "M7 21v-8a5 5 0 0 1 10 0v8", "M9.6 4.3h4.8l-1.1 3.9h-2.6z", "M8.5 9.5L5.6 6.6M15.5 9.5l2.9-2.9M3 13h4M17 13h4"],

  // --- Away Team (E-CREW "Crew Made Real", 0.14.0) ---
  // Drawn from the approved whole-build mockup's glyph sheet. The Science squad reuses `research`
  // (the same flask), so it gets no glyph of its own here.

  // Team: two figures, one in front of the other (a squad of people, not one person).
  team: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20c.6-3.6 3.2-6 6.5-6s5.9 2.4 6.5 6", "M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5c1.9.8 3.1 2.8 3.5 5.5"],
  // Security: a heater shield, the squad that fights.
  security: ["M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"],
  // Armor: a vest with a collar and a plate seam (a member's Armor slot).
  armor: ["M8 3h8l3 4-2 2v11H7V9L5 7z", "M9.5 3c.5 1.6 1.4 2.4 2.5 2.4S14 4.6 14.5 3", "M7 13h10"],
  // Weapon (hand): a side-on sidearm, the member's Weapon slot. Named apart from ship weapons.
  weaponHand: ["M3 13h12l3-3h3v4h-3l-1 1H9l-1 4H5l1-4H3z"],
  // Tool: an open-jaw wrench, the member's Tool slot. The mockup's wrench was redrawn here because
  // at 16px its half-open head read as a test tube; a closed jaw outline with a notch reads as a wrench.
  tool: ["M19.8 7.2a5 5 0 0 1-6.5 6.5L7 20a2.1 2.1 0 0 1-3-3l6.3-6.3a5 5 0 0 1 6.5-6.5L13.5 7.5l3 3z"],
  // Implant: a socketed module with leads on every side (a cybernetic slot). Fewer, longer leads
  // than `wafer`, so the two never read alike.
  implant: ["M8 8h8v8H8z", "M12 8V4M12 20v-4M8 12H4M20 12h-4", "M10.5 10.5h3v3h-3z"],
  // Injury: a medical cross in outline, the recovering-member mark.
  injury: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"],
  // Recruit: a figure with a plus, the "hire someone" verb (the board and an open squad slot).
  recruit: ["M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3.5 20c.6-3.6 3.2-6 6.5-6s5.9 2.4 6.5 6", "M19 8v6M16 11h6"],
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
