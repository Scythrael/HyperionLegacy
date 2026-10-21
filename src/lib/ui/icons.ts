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
