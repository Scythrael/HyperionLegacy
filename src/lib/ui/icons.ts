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
  // Exceptional relic (Relics v2 R2-7 / R2-8, verbatim from the signed-off Relics v2 mockup, 2026-10-21 "as drawn"): a
  // five-point star with a short upright stroke inside, tinted by its region tier. The stroke separates it from `star`.
  exceptional: ["M12 2.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z", "M12 9v3.5"],
  // The fourteen EXCEPTIONAL SET glyphs (user 2026-11-13 "One per set (Recommended)"), one per set, themed to its name and
  // tinted by its region tier where it is shown. `exceptional` above stays only where no set is known.
  // Waystation (Tier I): a hanging lantern with its flame.
  excWaystation: ["M10 3h4", "M12 3v3", "M8.5 6h7l-.7 12H9.2z", "M12 10.2c.9 1.1 1.4 2 1.4 2.7a1.4 1.4 0 0 1-2.8 0c0-.7.5-1.6 1.4-2.7z", "M7 20.5h10"],
  // Hearthward (Tier II): a house with a hearth fire inside, not a door.
  excHearthward: ["M4 11l8-7 8 7", "M6 9.8V20h12V9.8", "M12 18.2c-1.4 0-2.3-.9-2.3-2.1 0-1.4 1.3-2 1.3-3.6 1.3.8 3.3 1.9 3.3 3.6 0 1.2-.9 2.1-2.3 2.1z"],
  // Lightkeeper (Tier III): a lighthouse throwing two beams.
  excLightkeeper: ["M9.2 20.5L10.5 9h3l1.3 11.5", "M10 9V6h4v3", "M12 3.5V6", "M3.5 5l5 2M20.5 5l-5 2", "M6 20.5h12"],
  // Deepcut (Tier III): a pick over a plumb bob.
  excDeepcut: ["M3.5 8.5C7 4.6 12.8 3.6 18 5.5", "M10.6 5.6l8.4 14.9", "M6 11.5v5", "M4.5 16.5h3L6 20z"],
  // Stormglass (Tier IV): a storm cloud with a bolt beneath.
  excStormglass: ["M7 14.5a3.8 3.8 0 0 1 .4-7.6 5 5 0 0 1 9.6 1.4 3.1 3.1 0 0 1 .2 6.2z", "M12.5 12.5l-2.2 3.7h3l-2.1 4.3"],
  // Keelsong (Tier IV): a hull under two beamed notes (a song sung into the keel).
  excKeelsong: ["M3 14h18l-3.4 6H6.4z", "M10 11.5V5l6-1.5v6.5", "M10 11.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z", "M16 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"],
  // Tidewright (Tier V): a compass needle above two waves.
  excTidewright: ["M12 2.5l1.6 4.5L12 11.5 10.4 7z", "M3 15c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0", "M3 19.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0"],
  // Ember Court (Tier V): the well loved teapot, steam rising.
  excEmberCourt: ["M5.5 12h11v2.5a5.5 5.5 0 0 1-11 0z", "M5.5 13L2.8 10.4", "M16.5 12.6a2.4 2.4 0 0 1 0 4.8", "M8.5 12v-1.6h5V12", "M11 10.4V9", "M9.5 6.5c0-1 1-1.4 1-2.5M12.5 6.5c0-1 1-1.4 1-2.5"],
  // Veilward (Tier VI): a hooded veil with a small bright star held inside it.
  excVeilward: ["M12 3c3.9 2 5.8 6 5.8 11v6.5H6.2V14C6.2 9 8.1 5 12 3z", "M12 10l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"],
  // Starwake (Tier VI): a sailing ship under a star.
  excStarwake: ["M12 4v13", "M12 5l6.5 10.5H12", "M4.5 18h15l-2.2 3H6.7z", "M6 4.5l.6 1.4 1.4.6-1.4.6L6 8.5l-.6-1.4L4 6.5l1.4-.6z"],
  // Grand Orrery (Tier VI): a sun in a tilted orbit with one planet, on a stand.
  excGrandOrrery: ["M12 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z", "M3 10.5a9 3.8 0 1 0 18 0 9 3.8 0 1 0-18 0z", "M20.8 10.4v.2", "M12 14.3v6M9 20.5h6"],
  // Dawnmaker (Tier VII): a sun rising over the horizon, its rays.
  excDawnmaker: ["M3 17h18", "M7 17a5 5 0 0 1 10 0", "M12 7.5v2.5M6.3 10.3l1.6 1.6M17.7 10.3l-1.6 1.6M3.8 14.5h1.8M18.4 14.5h1.8", "M8 20.5h8"],
  // Kinring (Tier VII): a ring of worlds, four held on one circle.
  excKinring: ["M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M12 17.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M19 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"],
  // Long Vigil (Tier VII): an hourglass, the watch kept longer than any record (an eye read too close to the Orrery).
  excLongVigil: ["M6.5 3h11M6.5 21h11", "M8 3c0 4.5 3.2 6 4 9-.8 3-4 4.5-4 9", "M16 3c0 4.5-3.2 6-4 9 .8 3 4 4.5 4 9", "M10 18.6h4", "M11.2 8h1.6"],
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
  // Weapon (hand): a side-on pistol (slide, front sight, raked grip, trigger guard), the member's
  // Weapon slot. Named apart from ship weapons. The mockup's long-barreled glyph read as a hair dryer
  // at 16px, so it was redrawn as a compact sidearm.
  weaponHand: ["M3.5 7.5h17v4H11l-1.5 7.5h-4l1.3-7.5H3.5z", "M11 11.5c.2 1.8 1 2.7 2.6 2.7h.4v-2.7", "M17.5 7.5v-1.5"],
  // Tool: a wrench, the member's Tool slot, drawn as one outline whose head carries an open jaw (the
  // notch). The mockup's wrench was redrawn because its head outline stopped short and read as a test
  // tube at 16px; the continuous outline with the notch reads as a wrench.
  tool: ["M19.8 7.2a5 5 0 0 1-6.5 6.5L7 20a2.1 2.1 0 0 1-3-3l6.3-6.3a5 5 0 0 1 6.5-6.5L13.5 7.5l3 3z"],
  // Implant: a socketed module with leads on every side (a cybernetic slot). Fewer, longer leads
  // than `wafer`, so the two never read alike.
  implant: ["M8 8h8v8H8z", "M12 8V4M12 20v-4M8 12H4M20 12h-4", "M10.5 10.5h3v3h-3z"],
  // Injury: a medical cross in outline, the recovering-member mark.
  injury: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"],
  // Recruit: a figure with a plus, the "hire someone" verb (the board and an open squad slot).
  recruit: ["M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3.5 20c.6-3.6 3.2-6 6.5-6s5.9 2.4 6.5 6", "M19 8v6M16 11h6"],

  // Ground Operations + Squads (0.14.0, GO-10).
  // The shared atoms for the ground-ops screens (GO-11 to GO-18) and the squad redesign (SQ-7).

  // Team kinds (Squads design 2.1): each is the PAIR of squads it holds, drawn as two small squad emblems,
  // the front one lower left and the back one upper right with its hidden part knocked out (a 2 unit gap
  // from the front outline, so the two never merge at 16px). Shield = a Security squad, flask = a Science
  // squad (the same two marks as `security` and `research`, shrunk). Ground = Security + Science.
  groundTeam: [
    "M8 8l6 2.2v4.3c0 3.3-2.5 5.9-6 7.1-3.5-1.2-6-3.8-6-7.1v-4.3z",
    "M13.76 8l.84-1.5V2M13.5 2h5M17.4 2v4.5l4.3 7.7a1.2 1.2 0 0 1-1.05 1.8H15.8",
  ],
  // Strike = Security + Security.
  strikeTeam: [
    "M8 8l6 2.2v4.3c0 3.3-2.5 5.9-6 7.1-3.5-1.2-6-3.8-6-7.1v-4.3z",
    "M10 7V4.6l6-2.2 6 2.2v4.3c0 3.3-2.5 5.9-6 7.1l-.9-.35",
  ],
  // Survey = Science + Science.
  surveyTeam: [
    "M5.5 7.5h5M6.6 7.5V12L2.3 19.7a1.2 1.2 0 0 0 1.05 1.8h9.3a1.2 1.2 0 0 0 1.05-1.8L9.4 12V7.5",
    "M11.44 12.16L14.6 6.5V2M13.5 2h5M17.4 2v4.5l4.3 7.7a1.2 1.2 0 0 1-1.05 1.8H13.7",
  ],
  // Fight point: two crossed swords (blade and grip in one stroke, a guard across each), the "a fight
  // happens here" mark on a task bar. The guards are what keep it from reading as `close`; pommel caps and
  // wider guards were tried and turned it into a hash mark at 16px.
  fightPoint: ["M4 4l15.5 15.5", "M20 4L4.5 19.5", "M12.5 17.5l5-5", "M6.5 12.5l5 5"],
  // Medical bay: a rounded panel bearing a cross (the bay), kept apart from `injury` (a bare outline cross,
  // the member's state).
  medBay: ["M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z", "M12 8v8M8 12h8"],
  // Offload: haul dropping into the ship's hold (an arrow down into a tray). `reload` is its mirror.
  offload: ["M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14", "M12 3.5v11", "M7.5 10l4.5 4.5 4.5-4.5"],
  // Reload: the team's kit coming back up out of the hold (an arrow up out of the same tray).
  reload: ["M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14", "M12 15V4", "M7.5 8.5L12 4l4.5 4.5"],
  // Deploy: a lander (the fleet delta, nose down) descending to a planet's horizon. An exhaust trail above
  // it was tried and turned the glyph into a stick figure at 16px.
  deploy: ["M12 16L7.5 5l4.5 2.5L16.5 5z", "M3 21c2.5-1.6 5.6-2.5 9-2.5s6.5.9 9 2.5"],

  // Ship-side scan events (GO-8 / GO-9; the GO-15 scan track pips).
  // Debris field: the fleet delta broken into two drifting shards, with loose fragments.
  shipDebris: ["M10.5 3.5L3.5 18.5l4.5-2.2.8-5.6z", "M14.2 6.5l6.3 13.5-5-2.4-.6-5.4z", "M17.5 3.5l1.5-.5", "M5 6l-.5-1.5"],
  // Hostile probe: a satellite body between two solar panels, with an antenna dish on top.
  shipProbe: ["M9.5 10h5v5h-5z", "M2.5 9h4v7h-4z", "M17.5 9h4v7h-4z", "M6.5 12.5h3M14.5 12.5h3", "M12 10V6.5", "M9.5 5c1.4 1 3.6 1 5 0"],
  // Sensor ghost: a sheet ghost (a reading that may not be real).
  sensorGhost: ["M6 20.5V11a6 6 0 0 1 12 0v9.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z", "M10 10.5v1.5M14 10.5v1.5"],
  // Cloaked vessel: the fleet delta drawn in broken strokes (a ship you can only half see). The ghost that
  // turns out to be a real, hidden ship.
  cloakedVessel: ["M9.8 7.7L12 3l2.2 4.7", "M15.3 10.1l1.8 3.8M8.7 10.1l-1.8 3.8", "M18.3 16.5L20 20l-3.2-1.6M5.7 16.5L4 20l3.2-1.6", "M14 17l-2-1-2 1"],
  // Radiation storm: the radiation trefoil (three blades around a core).
  radiationStorm: [
    "M13.65 14.86L16.75 20.23A9.5 9.5 0 0 1 7.25 20.23L10.35 14.86A3.3 3.3 0 0 0 13.65 14.86z",
    "M13.65 9.14L16.75 3.77A9.5 9.5 0 0 1 21.5 12H15.3A3.3 3.3 0 0 0 13.65 9.14z",
    "M8.7 12H2.5A9.5 9.5 0 0 1 7.25 3.77L10.35 9.14A3.3 3.3 0 0 0 8.7 12z",
    "M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  ],
  // Boarding: an arrow driving into the fleet delta's flank (hostiles forcing their way aboard). A grappling
  // hook was tried first and read as an anchor ("docked") at 16px.
  boarding: ["M9 3l6.5 16-6.5-3.5L2.5 19z", "M22 11.5h-7", "M18 8.5l-3 3 3 3"],
  // Supply cache: a lidded supply crate with a handle slot (the scan step's small find).
  supplyCache: ["M4 9h16v11H4z", "M3 5h18v4H3z", "M10 13h4"],

  // G1-1 (Short-Range Missions): the Guest Wing quarters module, berths for passengers. A bed seen from the side: a tall
  // headboard, the frame line with its foot leg, a pillow at the head and a raised blanket over the sleeper. Reviewed at
  // 16 / 28 / 56 px: the pillow and the blanket keep a 2.5-unit gap (0.75 clear of the 1.75 stroke) so they stay two
  // bumps at 16 px; the headboard rising above the blanket is what keeps it reading as a bed, not a sofa or a crate.
  guestWing: [
    "M4 5v14",
    "M4 14h16v5",
    "M6.5 11h2a1 1 0 0 1 1 1v2h-4v-2a1 1 0 0 1 1-1z",
    "M12 14v-2.5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5V14",
  ],

  // Threat dot: the tier marker on a threat chip (GO-10 ThreatChip; replaces the patrol chip's emoji). A
  // SOLID disc drawn stroke-only: concentric rings 1.5 apart under the 1.75 stroke overlap with no gap, so
  // the contract (stroke only, currentColor) holds and the dot still takes the tier color; the last hair
  // segment plugs the pinhole the innermost ring leaves at 56px.
  threatDot: [
    "M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z",
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
    "M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
    "M12 11.9v.2",
  ],

  // Subspace Telescope (Squads design 6): a radio dish with its feed, a stand and two signal arcs. Not the
  // optical tripod telescope, which is the Precursor Lens relic.
  telescope: ["M5 8a7 7 0 0 0 9 9z", "M9.5 12.5l4-4", "M7 16l1.5 4.5", "M5 20.5h7", "M16 4.5a3.5 3.5 0 0 1 3.5 3.5", "M16.5 1.5a6.5 6.5 0 0 1 6 6"],
  // Risk factors (Squads design 5.1): Combat risk, Fauna, Flora, Hazard.
  // Combat risk: a crosshair (known enemy territory).
  riskCombat: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M12 2v5M12 17v5M2 12h5M17 12h5", "M12 11.9v.2"],
  // Fauna: a paw print (four toes over a pad).
  riskFauna: [
    "M8.5 16.5c0-2.5 1.6-4.5 3.5-4.5s3.5 2 3.5 4.5c0 1.7-1.4 2.7-3.5 2.7s-3.5-1-3.5-2.7z",
    "M6.5 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM9.8 4.9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM14.2 4.9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM17.5 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z",
  ],
  // Flora: a leaf on its stem.
  riskFlora: ["M5 19c0-7.5 5-13 14.5-14.5C18.5 13.5 13 19 5 19z", "M3 21l10-10"],
  // Hazard: a hazard-label diamond with a bang. A diamond, not `warning`'s triangle, so "this body is
  // hazardous" never reads as a UI warning.
  riskHazard: ["M12 2.5l9.5 9.5-9.5 9.5L2.5 12z", "M12 8v5", "M12 16.4v.2"],
  // Blind launch (Squads design 6.6): an eye struck through (beyond the telescope's range).
  blindLaunch: [
    "M3 3l18 18",
    "M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.3-3.2 3.6",
    "M6.4 7.6C4.6 8.9 3.2 10.6 2.5 12c1 1.5 4.5 6 9.5 6 1.4 0 2.7-.3 3.8-.9",
    "M9.9 9.9a3 3 0 0 0 4.2 4.2",
  ],
  // Lock: a padlock (crew locked while out; "no crew covers it").
  lock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V8a4 4 0 0 1 8 0v3"],
  // Flag: a pennant on a pole (something waits on your choice, e.g. "Pick a type").
  flag: ["M5 21V4", "M5 4h12l-2.5 4 2.5 4H5"],

  // Squad Loadouts (0.14.0 GO-17 UI, the approved squad loadouts mockup's glyphs).
  // Locker: a two-door gear locker with handles (a loadout resting in the Armory).
  locker: ["M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M12 3v18", "M9.5 10v2", "M14.5 10v2"],
  // Check in: an arrow down onto the shelf line (the set goes back into the locker).
  checkIn: ["M12 4v11", "M7.5 10.5L12 15l4.5-4.5", "M5 19h14"],
  // Check out / put on: an arrow up off the shelf line (the set comes out onto a team).
  checkOut: ["M12 15V4", "M7.5 8.5L12 4l4.5 4.5", "M5 19h14"],
  // Save a set: the classic disk (body with a clipped corner, shutter, label).
  saveSet: ["M5 4h11l3 3v13H5z", "M8 4v5h7V4", "M8 20v-6h8v6"],
  // Skipped: a circle with a bar (a piece left out of an install, with its reason beside it).
  skipped: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M8 12h8"],

  // Field Kits (0.14.0 FKR-3): one glyph per kit, the bone severity line and the five enemy rank chips.
  // The kits. First Aid Kit: a carry case with a handle and a cross. Kept apart from `medBay` (a handleless rounded
  // panel) by the handle, and from the Trauma Kit (the same case) by its mark.
  kitFirstAid: ["M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z", "M9 8V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V8", "M12 11v6M9 14h6"],
  // Antitoxin: a drop with a cross in it (an antidote).
  kitAntitoxin: ["M12 3c3.3 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.7-6.8 6-11z", "M12 11.5v5M9.5 14h5"],
  // Combat Stim: an auto-injector on the diagonal (needle, barrel, plunger and its thumb bar).
  kitCombatStim: ["M7.1 14.1l7-7 2.8 2.8-7 7z", "M8.5 15.5l-5 5", "M15.5 8.5l3-3", "M17 4l3 3"],
  // Splint: a straight board bound by two short straps. Straps reaching far past the board read as a hash mark at
  // 16px, so they stop just past its edges.
  kitSplint: ["M9.5 2.5h5v19h-5z", "M7.7 8.3l8.6-2", "M7.7 17.8l8.6-2"],
  // Trauma Kit: the carry case with a heartbeat trace (the serious cases).
  kitTrauma: ["M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z", "M9 8V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V8", "M6 14.5h3l1.5-3 3 5.5 1.5-2.5h3"],
  // Injury Kit: an adhesive bandage on the diagonal with its pad (patched up for the medical bay).
  kitInjury: ["M9.97 18.97l9-9a3.5 3.5 0 0 0-4.94-4.94l-9 9a3.5 3.5 0 0 0 4.94 4.94z", "M12 9.2l2.8 2.8-2.8 2.8-2.8-2.8z"],

  // The bone line (lightest first): one bone on the diagonal drawn three ways. A vertical bone read as an hourglass
  // at 16px, and the three ranks blurred together, so the bone lies diagonal and each rank opens a wider gap.
  // Fracture: a whole bone with a crack across it.
  boneFracture: [
    "M13.78 7.82A2.6 2.6 0 1 1 17.98 6.02 2.6 2.6 0 1 1 16.18 10.22L10.22 16.18A2.6 2.6 0 1 1 6.02 17.98 2.6 2.6 0 1 1 7.82 13.78z",
    "M9.6 10.3l2.4.85v1.7l2.4.85",
  ],
  // Broken Bone: the bone in two pieces with jagged ends.
  boneBroken: [
    "M13.78 7.82A2.6 2.6 0 1 1 17.98 6.02 2.6 2.6 0 1 1 16.18 10.22L14.83 11.58 13.39 11.41 13.23 9.97 11.79 9.81z",
    "M10.22 16.18A2.6 2.6 0 1 1 6.02 17.98 2.6 2.6 0 1 1 7.82 13.78L9.17 12.42 10.61 12.59 10.77 14.03 12.21 14.19z",
  ],
  // Shattered Bone: two short end pieces, a wide gap and splinters flying off to the sides. Splinters inside the gap
  // filled it back in at 16px (it read as the Fracture), so they sit outside it.
  boneShattered: [
    "M13.78 7.82A2.6 2.6 0 1 1 17.98 6.02 2.6 2.6 0 1 1 16.18 10.22L15.61 10.8 14.17 10.63 14 9.2 12.57 9.03z",
    "M10.22 16.18A2.6 2.6 0 1 1 6.02 17.98 2.6 2.6 0 1 1 7.82 13.78L8.39 13.2 9.83 13.37 10 14.8 11.43 14.97z",
    "M9.74 8.32l-.14 1.84",
    "M14.4 13.84l-.14 1.84",
  ],

  // Enemy rank chips: one hexagonal chip, its mark reading as a scale. Weak: a chevron down (below the line);
  // Normal: a level bar; Strong: one chevron up; Elite: two chevrons up; Boss: a crown. The chip frame keeps the
  // chevrons from reading as the `chevronUp` / `chevronDown` ornaments.
  rankWeak: ["M12 2.5l8.5 4.9v9.7L12 22l-8.5-4.9V7.4z", "M8.5 10.5l3.5 3.5 3.5-3.5"],
  rankNormal: ["M12 2.5l8.5 4.9v9.7L12 22l-8.5-4.9V7.4z", "M8 12.2h8"],
  rankStrong: ["M12 2.5l8.5 4.9v9.7L12 22l-8.5-4.9V7.4z", "M8.5 14l3.5-3.5 3.5 3.5"],
  rankElite: ["M12 2.5l8.5 4.9v9.7L12 22l-8.5-4.9V7.4z", "M8.5 12l3.5-3.5 3.5 3.5", "M8.5 16l3.5-3.5 3.5 3.5"],
  rankBoss: ["M12 2.5l8.5 4.9v9.7L12 22l-8.5-4.9V7.4z", "M7.5 15.5v-6l2.5 2.5 2-3.5 2 3.5 2.5-2.5v6z"],

  // Field Kits pack screen (0.14.0 FKR-9, the signed-off packing mockup's new glyphs). Reviewed at 16 / 28 / 56 px.
  // Grenade: a round body, the fuze cap on top, the safety lever (spoon) running off to the right and the pull ring
  // hanging off the cap's left side. The mockup's ring (r 1.5, its edge 0.3 units clear of the cap) closed into a dot
  // at 16px and floated loose of the cap; this ring is r 2.25 (a 2.75 unit hole, about 1.8px at 16px) and overlaps
  // the cap's left leg, so it reads as a ring hooked on the pin at every size. The cap's legs stop where they meet
  // the body's curve, so the cap never cuts into it.
  grenade: ["M11 9a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M9 9.4V6h4v3.4", "M13 6h2.5l3 4.5", "M6 2.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5z"],
  // The three Security specs (model.ts SecuritySpec), the role mark on a member's pack card and run readout.
  // Offense: one sword on the diagonal (an outlined blade with its tip up and right, a cross guard, the grip). One
  // blade, so it never reads as `fightPoint` (two crossed swords); the mockup's crosshair was `riskCombat` without
  // its dot, the same shape at 16px, so it was redrawn.
  roleOffense: ["M20 4l-1 4-8.5 8.5-3-3L16 5z", "M5 13l6 6", "M8 16l-4 4"],
  // Defense: the heater shield split down the middle (a heraldic half). The mockup's plain shield IS `security`
  // (the squad), so the center line keeps the spec apart from the squad at every size.
  roleDefense: ["M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z", "M12 3v18"],
  // Debuff: a trend line falling to a down-right arrowhead (the target's numbers going down). The mockup's drop with
  // an arrow sat beside `kitAntitoxin` (a drop with a cross) and the two blurred together at 16px.
  roleDebuff: ["M3 6.5l6 6 4-4 7.5 7.5", "M20.5 10v6h-6"],
  // Home: a house with eaves over its walls and a narrow door (kits coming home at claim). Kept apart from
  // `warehouse` (walls flush with a wide roof, a wide roll-up door with a band) by the overhang and the door.
  home: ["M4 11l8-7 8 7", "M6 9.5V20h12V9.5", "M10 20v-5h4v5"],
  // Gas Giant Study (0.14.0 GG-1): the Gas Storage Canisters.
  // Gas canister: a domed gas cylinder with a label band, its valve neck and handwheel on top (the five gases).
  gasCanister: ["M8 10a4 4 0 0 1 8 0v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z", "M8 14.5h8", "M12 6V3.5", "M9.5 3.5h5"],
  // Antimatter Containment Cell: a cell frame (two end plates on two posts) holding a charge that touches nothing,
  // so it reads as a magnetic bottle rather than a gas cylinder.
  antimatterCell: ["M4.5 3.5h15", "M4.5 20.5h15", "M7 3.5v17", "M17 3.5v17", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"],
  // Gas Giant Study GG-6 (0.14.0, the signed-off v3 mockup, user 2026-10-21 "approve as is"): the study screens' glyphs.
  // Reviewed at 16 / 28 / 56 px.
  // Research data: a data crystal (a tall hexagon) carrying two lines of text, the held research data items. Kept apart
  // from `relicResonanceShard` (a jagged shard, no text) by its even sides and the two lines.
  researchData: ["M12 3l6.5 3.8v7.4L12 21l-6.5-6.8V6.8z", "M9 10h6", "M9 13.5h4"],
  // Ancient Data Fragment: a torn page (a straight spine on the left, a jagged tear down the right) with three short
  // lines of script. Kept apart from `relicGlyphTablet` by the tear.
  ancientFragment: ["M6 4h8.5l-1.5 4 3 3-2 4 2.5 5H6z", "M9 9h2.5", "M9 13h3", "M9 17h2"],
  // Galileo-Class Probe: a domed descent probe on its heat-shield cone, an antenna on top and a drogue line below (the
  // 1995 Galileo probe's silhouette). Kept apart from `shipProbe` (the hostile probe) by the dome and the shield.
  galileoProbe: ["M7 11a5 5 0 0 1 10 0v3H7z", "M5 14h14l-2.5 3.5h-9z", "M12 6V3", "M10 21l2-3.5 2 3.5"],
  // Gas giant: a round body crossed by one tilted ring, the orbital-only body a ship studies.
  giant: ["M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M2.5 15.5c2.5-1.3 6-2.6 9.5-3.4s7-1.1 9-.6"],
  // Nebula: a soft cloud with one bright band through it and a small star sparkle above, the system feature the ship
  // sweeps.
  nebula: ["M4.5 15.5a4 4 0 0 1 3-6.3 5 5 0 0 1 9.6 1.3 3.3 3.3 0 0 1 0 6.5H8a3.5 3.5 0 0 1-3.5-1.5z", "M9 14h6", "M19 4.5v3M17.5 6h3"],
  // Pause: two upright bars (the data study lane's auto-study switch when it is off).
  pause: ["M8.5 5v14", "M15.5 5v14"],

  // Reactor fuel ladder (0.14.0): the Cometary Ice Harvest mission. A comet: a round nucleus at the upper right and three
  // streaks of tail flaring away to the lower left, the middle one longest. The streaks leave the nucleus at its two
  // side tangents and its trailing edge, 3 units apart, so they stay three lines at 16 px.
  comet: ["M16.5 4.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M14.4 9.6L4 20", "M14.4 5.4L8.6 11.2", "M18.6 9.6L12.8 15.4"],

  // ML-2 recipe realism (0.14.0, audit Group B call 6): the two new refined goods.
  // Biofiber: two strands twisted into one braided fiber, crossing three times across the grid, so it reads as a cord
  // (not `ingot` or `wafer`, the other refined goods, and not a wave: the strands cross). The lobes run the full 12
  // units of height; a flatter braid turned to a smudge at 16 px (reviewed at 16, 28 and 56 px).
  biofiber: ["M3 6c3 0 3 12 6 12s3-12 6-12 3 12 6 12", "M3 18c3 0 3-12 6-12s3 12 6 12 3-12 6-12"],
  // Resin Distillate: a test tube with its fill line and one drop falling into it (the distillate). A tube, not a flask,
  // so it stays apart from `research`; the drop is small and sits over the mouth, apart from `kitAntitoxin`. The tube
  // is 8 units wide so it does not read as a thin line at 16 px.
  resinDistillate: ["M8 10h8v7.5a4 4 0 0 1-8 0z", "M8 14.5h8", "M12 2.5c1.2 1.5 2 2.6 2 3.5a2 2 0 0 1-4 0c0-.9.8-2 2-3.5z"],
  // Short-Range Missions (0.14.0 G1-6, the signed-off board mockup's two new glyphs, user 2026-10-21 "approve as is").
  // Short-range: a short hop from a home body (lower left, r 3) to a small nearby body (upper right, r 2.5) along one
  // arc with an arrowhead. The Home row icon of a short-range run and its completion row. Reviewed at 16 / 28 / 56 px:
  // the arc leaves the home body 0.8 units off its edge and the arrow tip lands 0.6 units off the target's edge, so
  // under the 1.75 stroke both ends TOUCH their bodies (it reads as "from here to there", never a loose arrow); the
  // target ring's 1.6 unit inner radius stays open at 16 px, so it reads as a second, smaller body rather than a dot; the 3.8 unit
  // arrow arms stay two strokes at 16 px. Kept apart from `comet` (a body trailing three straight streaks) by the two
  // bodies and the single curved path.
  shortRange: ["M5 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M19 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", "M6.5 15.5C7.5 10 11 7 15.8 5.9", "M12.6 4.2l3.4 1.6-1.6 3.4"],
  // Comm booster: a relay mast (an A-frame with one cross brace and an emitter knob at its apex) under two signal
  // arcs. The Comm Booster Build job. Reviewed at 16 / 28 / 56 px: the brace meets both legs exactly (y 17.5, x 9.7 and
  // 14.3) so it never pokes past them; both arcs are centered on the apex, the inner one 2.75 units clear of it and the
  // outer 2.25 units clear of the inner under the stroke (about 1.5 px at 16 px), so the arcs stay two lines. Kept
  // apart from `telescope` (a dish on a stand, the arcs off to one side) by the open frame and the centered arcs.
  commBooster: ["M12 10.5L8.5 21", "M12 10.5l3.5 10.5", "M9.7 17.5h4.6", "M12 10.4v.2", "M8.8 7.5a4.5 4.5 0 0 1 6.4 0", "M6 4.7a8.5 8.5 0 0 1 12 0"],
  // Expedition Tiers G2-6 (the signed-off dispatch console mockup's four glyphs, user 2026-10-21 "approve as is", for
  // the icons.ts review). Reviewed at 16 / 28 / 56 px in both themes.
  // Drive: a ship's FTL drive (its class on the console header and the gate rows): a combustion chamber on top, its
  // flared bell below and three exhaust streaks splaying out of the bell. The mockup drew it on its side (chamber,
  // bell and exhaust ticks to the right); at every size that silhouette read as a loudspeaker, so the review stood it
  // upright, the way a rocket engine reads. The streaks start 3 units under the bell's rim and sit 3 units apart, so
  // they stay three strokes at 16 px; kept apart from `deploy` (a lander over a ground arc) by the chamber and the bell.
  drive: ["M9.5 2.5h5v5h-5z", "M10 7.5L6.5 16h11L14 7.5", "M9 19l-.5 2.5", "M12 19v2.5", "M15 19l.5 2.5"],
  // Reach: a span between two end ticks with an arrowhead at each end (how far the ship goes and back: the round trip
  // against its deep-space reach). The arrowheads stop 2.5 units short of the ticks, so at 16 px they never fuse.
  reach: ["M3 6v12M21 6v12", "M5.5 12h13", "M8.5 9l-3 3 3 3", "M15.5 9l3 3-3 3"],
  // Recall: a U-turn arrow (the ship turns for home). Kept apart from `reload` (two arrows on a full circle) by the one
  // open turn and its single arrowhead.
  recall: ["M17 20v-9a5 5 0 0 0-10 0v2", "M4 10.5l3 3 3-3"],
  // Resume: a bookmark with a forward chevron inside (a system kept to pick up where you left off). The chevron's 5
  // unit height keeps it a chevron, not a dot, at 16 px.
  resume: ["M7 3h10v18l-5-3.5L7 21z", "M10.5 8.5l2.5 2.5-2.5 2.5"],
  // Completion tracking (0.14.0, the approved 2026-11-13 mockup, "every body, every objective"): a system completed, an
  // orbit with a planet riding it and a check inside. The planet's gap in the orbit keeps it apart from a check in a
  // circle at 16 px; kept apart from `check` (one step done), `circle` (not reached), `skipped` (a circle with a bar) and
  // `giant` (a ringed planet). Always drawn with the word "Completed" beside it, except on the telescope map (its legend
  // says it). Reviewed at 16 / 28 / 56 px.
  systemComplete: ["M20.1 9.4A8.5 8.5 0 1 1 14.6 3.9", "M18 3.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z", "M8.2 12.2l2.6 2.6 5-5.2"],

  // E-MOD EM-7: the v1 universal modules (the signed-off Relics, Refinery and Modules mockup, section C, "approved as
  // drawn"; each path is the mockup's own). The Long-Baseline Array draws with `telescope` (a long receiver), as the
  // mockup does.
  // Auxiliary Capacitor: a battery body with its terminal nub and two cell bars.
  moduleCapacitor: ["M4 8h14v8H4z", "M18 10.5h2v3h-2", "M8 10.5v3M11 10.5v3"],
  // Structural Bracing: a square frame cross-braced corner to corner.
  moduleBracing: ["M4 4h16v16H4z", "M4 4l16 16M20 4L4 20"],
  // Arc Discharger: a spark trace jumping across a line (a discharge).
  moduleArc: ["M3 12h3.5l2-5 3 10 2-6 1.5 3H21"],
  // Prospector's Echo: an ore nugget with two echo arcs off its shoulder.
  moduleEcho: ["M8 20l-3-6 3.5-5h5l3.5 5-3 6z", "M17.5 5.5a4 4 0 0 1 2.5 3.5", "M15.5 2.5a7 7 0 0 1 6 6"],
  // Last Stand Protocol: a shield with an exclamation mark (fights hardest when nearly down).
  moduleLastStand: ["M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z", "M12 8v5", "M12 16v.2"],
  // Shield Surge: a shield with a rising arrow (the shields come back up).
  moduleSurge: ["M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z", "M12 16V9", "M9 11.5l3-3 3 3"],
  // Signal Integrator: a waveform through a vertical tick (a signal being read).
  moduleSignal: ["M3 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0", "M12 3v4M12 17v4"],
  // Gas Giant Study GG-7 (EM-8 fix round, SVG only, never emoji): the Ramscoop Collector, a gas-scoop intake funnel. A
  // wide elliptical mouth tapering into a feed pipe, with three streamlines of gas flowing into the mouth.
  moduleRamscoop: ["M8.5 5a1.5 7 0 1 0 0 14a1.5 7 0 1 0 0-14", "M8.5 5l7.5 5M8.5 19l7.5-5", "M16 10h5M16 14h5", "M2 8.5h2.5M1.5 12h3M2 15.5h2.5"],
  // E-MOD EM-10: the Ship Systems Power bar and Modules row headings (the same mockup, section C, its own paths).
  // Module: a chip with pins top and bottom and a die in the middle (a slot-in accessory).
  module: ["M5 6h14v12H5z", "M8 6V3.5M12 6V3.5M16 6V3.5M8 20.5V18M12 20.5V18M16 20.5V18", "M9 10h6v4H9z"],
  // Power: a lightning bolt (the ship's power budget).
  power: ["M13 2.5L5 13.5h6l-1 8 8-11h-6z"],
  // E-MOD EM-10 review (SVG only, never emoji): the five Spec Utility varieties, which share the Modules row and its
  // install picker. They replace the emoji placeholders EquipmentTooltip carried for them.
  // Yield Rig: a cut gem with a plus beside it (more of what is mined).
  rigYield: ["M3 9l3-5h8l3 5-7 11z", "M3 9h14", "M8 4l2 5 2-5", "M19.5 14v6M16.5 17h6"],
  // Survey Rig: a mast on a tripod sending out two sweep arcs (it reads the ground).
  rigSurvey: ["M12 10.5V15", "M12 15l-5 6M12 15l5 6", "M9.2 7.8a4 4 0 0 1 5.6 0", "M6.4 5a8 8 0 0 1 11.2 0"],
  // Refinery-Feed Rig: a lab flask with its fill line (ore prepared for the refinery).
  rigRefineryFeed: ["M9 3h6", "M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3", "M7.5 15h9"],
  // Damage Control Suite: an extinguisher, its valve and hose (fires out, breaches sealed).
  suiteDamageControl: ["M8 10a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v11H8z", "M11.5 7V4", "M9.5 4h5l3 3", "M10.5 13h2"],
  // Pathfinder Suite: a folded map (the explorer's route finder).
  suitePathfinder: ["M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z", "M9 4v14", "M15 6v14"],

  // --- 0.13.11 Codes pad and the secret game ---

  // Arrows: a shaft and a head, one per direction, for the combo pad's D-pad and its slots.
  // Separate names (not one rotated glyph) so each pad button names its own direction.
  arrowUp: ["M12 5v14", "M6 11l6-6 6 6"],
  arrowDown: ["M12 5v14", "M6 13l6 6 6-6"],
  arrowLeft: ["M5 12h14", "M11 6l-6 6 6 6"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  // Star: a five-point outline, the mark of a named achievement.
  star: ["M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"],
  // Circle: an empty ring, "not reached yet" beside a check for "reached".
  circle: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"],

  // --- 0.13.11.1 header block and the minigame panel ---

  // Controller: a gamepad (D-pad cross on the left, two buttons on the right), the Minigames
  // button. The buttons are hair-length lines so the round caps paint them as dots.
  controller: ["M7 7.5h10a4.5 4.5 0 0 1 4.5 4.5v1a3.5 3.5 0 0 1-6.4 2L14.4 14H9.6l-.7 1a3.5 3.5 0 0 1-6.4-2v-1A4.5 4.5 0 0 1 7 7.5z", "M7.5 9.8v4.4M5.3 12h4.4", "M15.6 11v.2", "M17.8 13v.2"],
  // Help: a question mark, the Help button (the dot is a hair-length line, as in warning).
  help: ["M8 8.6a4 4 0 1 1 5.8 3.6c-1.1.5-1.8 1.5-1.8 2.7v.5", "M12 19.2v.2"],
  // Gear: settings. The same cog the header gear always drew, moved into the registry.
  gear: ["M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z", "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"],
  // Chart: three rising bars on a baseline, the minigame's Stats button.
  chart: ["M4 20h16", "M7 16v-5", "M12 16V7", "M17 16v-8"],

  // --- 0.14.0 CP-9: the complement crew groups table, Graduate and the Manifest ---

  // Graduate: a mortarboard (the board, its crown and the tassel), the "Graduate one" action.
  graduate: ["M2.5 9.5L12 5l9.5 4.5L12 14z", "M6.5 11.5v4.5c3 2.4 8 2.4 11 0v-4.5", "M21.5 9.5v5.5"],
  // Manifest: a clipboard with listed lines, the ship's roster of generated names.
  manifest: ["M6 4.5h12V21H6z", "M9.5 4.5V3h5v1.5", "M9 9.5h6M9 13h6M9 16.5h3.5"],
  // Transfer: two opposed arrows, moving crew between ships (wired by CP-10).
  transfer: ["M4 8.5h14l-3.5-3.5", "M20 15.5H6l3.5 3.5"],
  // Sort: an up arrow beside a down arrow, the sort chips' label.
  sort: ["M7.5 19V5", "M4 8.5l3.5-3.5L11 8.5", "M16.5 5v14", "M13 15.5l3.5 3.5 3.5-3.5"],
  // Diamond: the mark of a second-level exclusive crew buff.
  diamond: ["M12 3.5l7.5 8.5-7.5 8.5-7.5-8.5z"],
  // Chevron left: the manifest pager's previous page (chevronRight is its next).
  chevronLeft: ["M15 6l-6 6 6 6"],

  // --- 0.14.0 CP-10: the transfer picker and the crew pool ---

  // Crew pool: three heads and shoulders, the crew waiting at home for a ship (the pool tab and its destination card).
  crewPool: [
    "M12 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
    "M6 7.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z",
    "M18 7.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z",
    "M7 19.5c0-3.2 2.2-5.5 5-5.5s5 2.3 5 5.5",
    "M2.5 18.5c0-2.6 1.5-4.4 3.5-4.6",
    "M21.5 18.5c0-2.6-1.5-4.4-3.5-4.6",
  ],
  // Minus and plus: the transfer stepper's one less and one more.
  minus: ["M5.5 12h13"],
  plus: ["M5.5 12h13", "M12 5.5v13"],

  // --- 0.14.0 E5-5: Refugee Posts (the signed mockup docs/mockups/2026-11-02-e5-refugee-posts-mockup.html) ---

  // Posts: a staff badge on its clip with a head and shoulders, a person holding a post at a facility.
  refugeePosts: ["M6.5 7.5h11V21h-11z", "M10 3.5h4v4h-4z", "M12 10.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z", "M9 18.5c.6-1.7 1.7-2.5 3-2.5s2.4.8 3 2.5"],
  // The eight backgrounds, one per facility family. Each differs from its facility's own glyph, so a chip reads as a
  // person's trade, not as the building.
  // Refiner: a crucible tipped over a pour, a drop falling (the furnace is the Refinery's own).
  refugeeRefiner: ["M4.5 6.5h11l-1.3 8.2a2 2 0 0 1-2 1.8H7.8a2 2 0 0 1-2-1.8z", "M15.5 9h2.5l2-2.5", "M18.5 13v2", "M18.5 18.5v.5"],
  // Fuel handler: a jerrycan with its spout and a cross stamp.
  refugeeFuelHandler: ["M6 7.5h9.5l3 3V21H6z", "M8.5 4h4v3.5", "M9 12.5l6 6", "M15 12.5l-6 6"],
  // Dispatcher: a routing fork, one line from a hub splitting three ways, an arrowhead on each branch. Kept apart
  // from `commBooster`/`rigSurvey` (masts with arcs), `transfer` (two opposed arrows) and `arrowUp` (one shaft).
  refugeeDispatcher: ["M12 17v-5", "M12 12L6.5 6.5", "M12 12l5.5-5.5", "M12 12V3.5", "M6.5 10.5v-4h4", "M13.5 6.5h4v4", "M9.5 6L12 3.5 14.5 6", "M12 17.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"],
  // Scholar: an open book with its spine.
  refugeeScholar: ["M3 5.5c3-1.5 6-1.5 9 1 3-2.5 6-2.5 9-1v13.5c-3-1.5-6-1.5-9 1-3-2.5-6-2.5-9-1z", "M12 6.5v13.5"],
  // Machinist: an open-end wrench whose jaw grips a hex nut, its head to the upper LEFT. Kept apart from `tool` (a
  // closed-outline wrench, head upper right, no nut), `gear`/`equipment` (cogs) and `component` (a nut alone).
  refugeeMachinist: ["M9.4 2.3L13 5.9A5 5 0 0 1 13.8 11.8L19.4 17.4A1.4 1.4 0 0 1 17.4 19.4L11.8 13.8A5 5 0 0 1 5.9 13L2.3 9.4L4 7.8L8.3 12.1L12.1 8.3L7.8 4z", "M5.9 5.9L5.3 8.3L7 10L9.4 9.4L10 7L8.3 5.3z"],
  // Shipwright: a hammer (its head and handle).
  refugeeShipwright: ["M13.5 3.5l6 6-2.5 2.5-6-6z", "M12.5 8.5L4 17l3 3 8.5-8.5"],
  // Salvager: a horseshoe magnet with its pole marks.
  refugeeSalvager: ["M6 4v8a6 6 0 0 0 12 0V4", "M10 4v8a2 2 0 0 0 4 0V4", "M6 7.5h4", "M14 7.5h4"],
  // Stargazer: an eye looking up a sightline to a four-point star. Kept apart from `relicPrecursorLens` and
  // `telescope` (instruments), `blindLaunch` (an eye struck through) and `discovery` (sparkles alone).
  refugeeStargazer: ["M18 2.5l1.1 3.1 3.1 1.1-3.1 1.1L18 10.9l-1.1-3.1-3.1-1.1 3.1-1.1z", "M1.8 16c1.8-3 4-4.5 6.7-4.5s4.9 1.5 6.7 4.5c-1.8 3-4 4.5-6.7 4.5S3.6 19 1.8 16z", "M8.5 14.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z", "M12.6 11.6l1.6-1.6"],

  // --- 0.14.0 E5-6: the Refugees tab, the arrival card and the log lines ---

  // Arrival: a house with someone standing in it, a person come home (the arrival log line and the Refugees tab).
  // Kept apart from `home` (an empty house with a door) by the head and shoulders inside.
  refugeeArrival: ["M3.5 11L12 4l8.5 7", "M5.5 9.5V20h13V9.5", "M12 10.8a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z", "M8.6 20c.4-2.3 1.7-3.6 3.4-3.6s3 1.3 3.4 3.6"],
  // Farewell: a leaf with its vein, someone gone on to lead a new camp (the mockup's leaf).
  refugeeFarewell: ["M5 19c0-8 5-14 15-15-1 10-7 15-15 15z", "M5 19l8-8"],
  // Info: a circled i, a one-time note (the first-arrival hint).
  info: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M12 11v6", "M12 7.5v.5"],

  // --- 0.14.0 E5-6b: the echo refugees' one shared mark (the user's "One shared mark": one subtle original glyph) ---

  // Echo: a winking face, the quiet wink an echo's own flavor line carries (beside their name on the arrival card, the
  // Refugees tab, the Posts popover and the picker). Kept apart from `info` (a larger circle with an i), `circle` (an
  // empty ring) and `controller` by the closed eye and the smile.
  refugeeEcho: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z", "M9 9.3v1.4", "M13.6 10.3c.8-.8 2.1-.8 2.9 0", "M8.2 13.8c.9 1.7 2.3 2.6 3.8 2.6s2.9-.9 3.8-2.6"],

  // --- 0.14.0 CP-11: the crew module and early sensor array blueprints (CP-12's tiles reuse them) ---

  // Bridge Module: a command chair seen from behind (backrest, armrests, pedestal) facing a wide viewscreen with a readout
  // trace. Reviewed at 16 / 28 / 56 px: the armrests standing out past the backrest are what keep it a chair, not
  // `equipment` or a monitor on a stand; the screen's trace was a cross at first and read as `plus` / medical.
  bridge: ["M2.5 3h19v7h-19z", "M7 7l3-2 3 2.5 3.5-1.5", "M9 12.5h6v5.5H9z", "M5.5 15.5h3.5", "M15 15.5h3.5", "M5.5 15.5v3", "M18.5 15.5v3", "M12 18v3", "M9 21h6"],
  // Crew Quarters: a bunk bed, two decks between two posts, a pillow on each. Kept apart from `guestWing` (one bed seen
  // from the side, headboard and blanket) by the second deck and the posts on both ends.
  quarters: ["M4 3v18", "M20 3v18", "M4 10.5h16", "M4 18h16", "M6.5 10.5V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5", "M6.5 18v-1.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V18"],
  // Sensor Array: a flat phased-array panel (its grid) on a mast, sending out three straight beams. Kept apart from
  // `telescope` (a curved dish with arcs) and `commBooster` / `rigSurvey` (masts with arcs) by the flat grid and rays.
  sensorArray: ["M3.5 4.5l9 2.5v8l-9-2.5z", "M3.5 8.5l9 2.5", "M8 5.75v8", "M8 14v6", "M5 20.5h6", "M15.5 8.5l5-2.5", "M15.5 11.5h5.5", "M15.5 14.5l5 2.5"],

  // --- 0.14.0 CP-12 fix round: every sensor array variety draws its own glyph (the standing distinct-icon rule) ---
  // One family: each keeps `sensorArray`'s phased-array panel on its mast (the left half, path for path) and swaps the
  // three straight beams for its own mark on the right. `sensorArray` itself stays the slot's glyph (the Sensor Suite
  // tile and SLOT_SVG_FALLBACK).
  // Wide-Beam Array: a wide fan, two rays opening 100 degrees with the arc that closes them (slower passes, more ground).
  sensorWideBeam: ["M3.5 4.5l9 2.5v8l-9-2.5z", "M3.5 8.5l9 2.5", "M8 5.75v8", "M8 14v6", "M5 20.5h6", "M14.5 11l5-6", "M14.5 11l5 6", "M19.5 5a7.8 7.8 0 0 1 0 12"],
  // Focused-Beam Array: a narrow beam, the Wide-Beam's fan closed down to about 40 degrees (two long rays and the short
  // arc that closes them). A first draft (two rays meeting at a target ring) read as scissors at every size.
  sensorFocusedBeam: ["M3.5 4.5l9 2.5v8l-9-2.5z", "M3.5 8.5l9 2.5", "M8 5.75v8", "M8 14v6", "M5 20.5h6", "M14.5 11l7-2.5", "M14.5 11l7 2.5", "M21.5 8.5a7.4 7.4 0 0 1 0 5"],
  // Balanced Array: a balanced, symmetric fan, two concentric arcs centered on the panel (mirror images above and below
  // the center line), neither wide nor narrow.
  sensorBalanced: ["M3.5 4.5l9 2.5v8l-9-2.5z", "M3.5 8.5l9 2.5", "M8 5.75v8", "M8 14v6", "M5 20.5h6", "M15.5 8.3a3.5 3.5 0 0 1 0 5.4", "M18 5.6a7 7 0 0 1 0 10.8"],
  // Resonance Sensor Array: resonance waves, two stacked sine waves off the panel (it reads a giant by its resonances).
  // Kept apart from `moduleSignal` (one waveform through a tick, no panel) by the panel and the second wave.
  sensorResonance: ["M3.5 4.5l9 2.5v8l-9-2.5z", "M3.5 8.5l9 2.5", "M8 5.75v8", "M8 14v6", "M5 20.5h6", "M14.5 8.5c1-1.6 2-1.6 3 0s2 1.6 3 0", "M14.5 14c1-1.6 2-1.6 3 0s2 1.6 3 0"],
  // Bio-Resonance Array: a leaf with its vein off the panel (the array that hears living things). Its own glyph, apart
  // from the Leviathan Scale relic that unlocks it (`relicLeviathanScale`, overlapping scales) and from
  // `refugeeFarewell` (a leaf alone, larger, no panel).
  sensorBioResonance: ["M3.5 4.5l9 2.5v8l-9-2.5z", "M3.5 8.5l9 2.5", "M8 5.75v8", "M8 14v6", "M5 20.5h6", "M14.5 17.5c0-6 2.5-9.8 7-10.5-.4 6.2-3 9.8-7 10.5z", "M14.5 17.5l4.5-6"],

  // --- 0.14.0 gear wear step 5 ---
  // Gear condition: a gauge, a half dial over its base line with three ticks and the needle off its center (the wear
  // UI's Gear chip and the Fleet care line). Kept apart from `relicTectonicKeystone` (a full arch on legs with a
  // keystone) and from `tool` (a wrench): a dial reads as a reading, not as a repair action.
  gearCondition: ["M4.5 15.5a7.5 7.5 0 0 1 15 0", "M12 8v1.7", "M6.7 10.2l1.2 1.2", "M17.3 10.2l-1.2 1.2", "M12 15.5l3.2-4.2", "M4 19h16"],
  // Overtime (the 2026-11-09 gear repair Overtime mockup): a clock with a forward chevron, "the same job, sooner". Kept
  // apart from `clock` (no chevron) and from the plain chevrons (no dial).
  overtime: ["M9.5 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M9.5 8.5V12l2.2 1.4", "M17.5 8.5L21 12l-3.5 3.5"],

  // --- 0.14.0 OT-UI (the 2026-11-10 Overtime buttons mockup, user "Replace them now") ---
  // Hull repair: a hull plate cracked top to bottom, a riveted patch plate across the crack (the Ship Systems damaged
  // banner and Command Home's ship repair rows; was the wrench and hammer emoji). A hammer was tried first and read as
  // `refugeeShipwright` (the same angled hammer) at 16 px. Kept apart from `refugeeShipwright` (a hammer), `tool` and
  // `refugeeMachinist` (wrenches), `fabricator` (a gantry) and `relicHullRivet` (a curved panel, no patch).
  hullRepair: ["M3 4.5h18v15H3z", "M12 4.5l-1.3 2.5 1.6 2", "M12 15l-1.4 2.2 1.1 2.3", "M6.5 9h11v6h-11z", "M9 12h.01M15 12h.01"],
  // Facility upgrade: a flat-roofed block with its door and an arrow rising beside it (Command Home's facility upgrade
  // rows; was the hammer and wrench emoji). Kept apart from `warehouse` (a pitched roof) and `arrowUp` (no block).
  facilityUpgrade: ["M4 21V10h9v11", "M2.5 21h12", "M7.5 21v-4h2v4", "M18.5 20V5", "M15 8.5L18.5 5 22 8.5"],
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
