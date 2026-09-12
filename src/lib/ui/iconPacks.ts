// ============================================================================
// iconPacks.ts: the SWAPPABLE ICON SET layer.
// 0.13.5 Phase 2. Design: 2026-09-11-presentation-0.13.5-scope.md section 3C.
//
// ⚠️ THIS IS AN ARCHITECTURE TASK, NOT A COSMETIC ONE, AND THE ORDERING IS THE POINT.
//
// The user's stated long-term plan is PAID COSMETIC PACKS: a pack bundles a colour theme, a layout
// skin, a custom ICON SET and lighting effects, and sells as one unit. That makes the icon layer a
// PRODUCT SURFACE rather than decoration, and it changes what "done" means for the emoji-to-SVG
// sweep. The record is explicit: "do the registry and pack-readiness design BEFORE the sweep, or
// the sweep becomes the thing that blocks packs."
//
// icons.ts already gives us the first requirement (a NAMED REGISTRY, with IconName derived from
// the data so a typo is a compile error). This module adds the other three:
//
//   2. THE ACTIVE SET IS SWAPPABLE AT RUNTIME, alongside the theme, because a pack changes both
//      together and a player switching packs should not have to reload.
//   3. A DEFINED FALLBACK when a pack omits an icon, so a PARTIAL pack degrades to the base set
//      rather than rendering nothing. This is what makes packs shippable incrementally: a pack
//      author can restyle twelve glyphs and ship, instead of being required to draw all sixty-four.
//   4. NO PACK MAY CHANGE AN ICON'S MEANING. A pack may restyle the warning mark; it may never
//      replace it with something that does not read as a warning.
//
// ⚠️ REQUIREMENT 4 IS THE ONE THAT NEEDS ENFORCEMENT RATHER THAN GOOD INTENTIONS, because it is a
// SAFETY property, not a taste one. An icon that stops reading as a warning is an accessibility
// and comprehension failure that a paying customer could ship to themselves. It is enforced two
// ways here: a pack can only override names that ALREADY EXIST in the base registry (so it cannot
// invent a glyph with no agreed meaning), and every name carries a SEMANTIC CLASS that a pack
// cannot alter (so tooling and review have something concrete to check a submission against).
//
// ⚠️ NOTHING IS SWEPT BY THIS UNIT. No emoji is converted here. This is the seam the sweep will
// land on, built first on purpose.
// ============================================================================

import { writable } from "svelte/store";
import { ICON_PATHS, type IconName } from "./icons";
import { safeGetItem, safeSetItem } from "../safeStorage";

// ---------------------------------------------------------------------------
// SEMANTIC CLASSES
// ---------------------------------------------------------------------------

// What an icon MEANS, independent of how it is drawn.
//
// ⚠️ THIS EXISTS SO REQUIREMENT 4 IS CHECKABLE. "A pack may not change meaning" is unenforceable
// against freeform art, but it IS enforceable as "a pack's replacement for a `danger` glyph must
// still be classified `danger`". A review process, or a future submission validator, has something
// concrete to compare against rather than an opinion.
//
// The classes are deliberately coarse. Finer ones would be a taxonomy nobody maintains.
export type IconSemantic =
  // Carries a SAFETY or ATTENTION meaning. ⚠️ The most restricted class: a pack that makes one of
  // these unrecognisable is the failure mode requirement 4 exists to prevent.
  | "alert"
  // Names a THING in the game (an item, a facility, a ship). Restyling freely is fine.
  | "subject"
  // Names an ACTION the player can take. Should stay recognisable as that action.
  | "action"
  // Pure decoration or structure (chevrons, dividers). Least restricted.
  | "ornament";

// What each icon MEANS. ⚠️ EXHAUSTIVE over IconName, so adding an icon to the registry without
// classifying it is a COMPILE ERROR. That is deliberate: an unclassified icon is one a pack could
// replace with anything, which is exactly the hole requirement 4 exists to close. Same discipline
// as PROCESS_XP_AWARDS and QUEUE_ADAPTERS.
export const ICON_SEMANTICS: Record<IconName, IconSemantic> = {
  // ALERT: the restricted class. A pack may restyle these; it may never make them stop reading as
  // what they are. `check` is included deliberately: a confirmation mark that stops reading as
  // success is as harmful as a warning that stops reading as danger, just in the other direction.
  warning: "alert",
  check: "alert",

  // SUBJECT: names a thing. Restyling freely is the whole point of a pack.
  refinery: "subject",
  fabricator: "subject",
  research: "subject",
  fuel: "subject",
  warehouse: "subject",
  shipyard: "subject",
  docks: "subject",
  ore: "subject",
  ingot: "subject",
  wafer: "subject",
  component: "subject",
  equipment: "subject",
  ship: "subject",
  credits: "subject",

  // ACTION: something the player does. Should stay recognisable as that action.
  salvage: "action",
  queue: "action",
  close: "action",

  // ORNAMENT: structure and direction. Least restricted.
  clock: "ornament",
  chevronUp: "ornament",
  chevronDown: "ornament",
  chevronRight: "ornament",
};

// ---------------------------------------------------------------------------
// A PACK
// ---------------------------------------------------------------------------

// An icon pack: a display name plus PARTIAL path overrides.
//
// ⚠️ Partial: `Partial<Record<IconName, ...>>` is the shape that makes requirement 3 structural
// rather than a runtime check someone can forget. A pack literally cannot list a name that is not
// already in the base registry (that is a compile error), and it is under no obligation to list
// them all.
export interface IconPack {
  id: string;
  label: string;
  paths: Partial<Record<IconName, readonly string[]>>;
}

// The base set is a pack with no overrides: it IS ICON_PATHS. Modelling it this way means the
// "no pack selected" path and the "pack selected" path are the same code, so the default can never
// be the one that is broken.
export const BASE_PACK: IconPack = {
  id: "base",
  label: "Standard",
  paths: {},
};

// Every pack the build knows about. ⚠️ Only the base set today: shipping a second pack is a
// CONTENT decision (and a commercial one), not something this architectural unit should invent.
// The registry exists so adding one later is a data addition.
export const ICON_PACKS: IconPack[] = [BASE_PACK];

// ---------------------------------------------------------------------------
// RESOLUTION
// ---------------------------------------------------------------------------

// The paths to draw for `name` under `pack`.
//
// ⚠️ THIS IS REQUIREMENT 3, AND IT IS WHY THE FALLBACK IS PER-ICON RATHER THAN PER-PACK. A pack
// that overrides twelve glyphs falls back to the base set for the other fifty-two, each
// independently. A per-pack "is this pack complete?" gate would force pack authors to draw
// everything before shipping anything, which is the opposite of what makes a pack economy work.
//
// A pack entry that is present but EMPTY is treated as absent, not as "draw nothing": an empty
// array is far more likely to be a mistake in a pack than a deliberate invisible icon, and
// rendering nothing at all is the worse failure.
export function resolveIconPaths(name: IconName, pack: IconPack): readonly string[] {
  const override = pack.paths[name];
  if (override !== undefined && override.length > 0) return override;
  return ICON_PATHS[name];
}

// ---------------------------------------------------------------------------
// THE ACTIVE PACK (requirement 2)
// ---------------------------------------------------------------------------

const ICON_PACK_KEY = "fleet_admiral_icon_pack";

// ⚠️ Device-side, like the theme, and for the same reason: it is a display preference the
// simulation never reads. Same sorting rule as every other setting in 0.13.5.
export function loadIconPackId(): string {
  const raw = safeGetItem(ICON_PACK_KEY);
  if (raw === null) return BASE_PACK.id;
  // An unknown id (a pack the player owned on another device, a pack removed from the build)
  // degrades to the base set rather than leaving the interface iconless.
  return ICON_PACKS.some((p) => p.id === raw) ? raw : BASE_PACK.id;
}

export function saveIconPackId(id: string): void {
  safeSetItem(ICON_PACK_KEY, id);
}

export function packById(id: string): IconPack {
  return ICON_PACKS.find((p) => p.id === id) ?? BASE_PACK;
}

// ---------------------------------------------------------------------------
// THE LIVE STORE (requirement 2: swappable AT RUNTIME)
// ---------------------------------------------------------------------------

// ⚠️ A STORE, NOT A MODULE VARIABLE, AND THAT IS WHAT MAKES REQUIREMENT 2 REAL. A plain variable
// would be read once when each Icon rendered and never again, so switching packs would only take
// effect on a reload. The requirement is explicitly "swappable at runtime, alongside the theme",
// because a pack changes both together and a player who buys one should see it immediately.
//
// Every <Icon> subscribes, so one write re-renders every glyph in the game at once. That is the
// same shape the theme already has, which is the point: packs and themes should behave alike
// because they ship together.
export const activeIconPack = writable<IconPack>(BASE_PACK);

// Load the stored choice and publish it. Call once at startup, beside the theme load.
//
// ⚠️ Separated from the store's initial value on purpose: a module-level load would run at IMPORT
// time, before safeStorage can be sure a DOM exists, and would make this module unusable from a
// test or a non-browser context without stubbing storage. An explicit call keeps the import pure.
export function initIconPack(): void {
  activeIconPack.set(packById(loadIconPackId()));
}

// Switch packs: persist and publish, in that order, through ONE function.
//
// ⚠️ ONE WRITER, for the same reason applyAccessibility is one writer. Two call sites that each
// "just set the store" and "just save the id" are two chances to do one and forget the other,
// which is how a setting ends up applying but not persisting (or the reverse).
export function setIconPack(id: string): void {
  saveIconPackId(id);
  activeIconPack.set(packById(id));
}
