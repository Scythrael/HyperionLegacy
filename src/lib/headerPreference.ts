// ============================================================================
// headerPreference.ts: whether the header is expanded, remembered per device.
// 0.13.5, from the approved mockup (brief 3, the collapsible header).
//
// ⚠️ THE DEFAULT IS PER-PLATFORM, AND THAT IS THE WHOLE POINT OF THE FEATURE. Mobile defaults to
// COMPACT because header rows cost vertical space on every screen forever; desktop defaults to
// EXPANDED because it has room the mobile layout simply ignores. Same component, same data, one
// different default. That is the platform split's cheapest and clearest instance: share the logic,
// differ only in presentation.
//
// ⚠️ AND A REMEMBERED CHOICE BEATS THE DEFAULT. A header that reopens collapsed every session
// annoys a desktop player, and one that stays expanded eats the phone screen it was meant to save.
// So the default only applies until the player says otherwise, after which their choice is what
// loads. An ABSENT key means "never chosen", which is distinct from "chose collapsed" and is why
// this loader returns null rather than false for a missing value.
//
// Device-side, via safeStorage, by the release's own storage rule: the simulation never reads it.
// ============================================================================

import { safeGetItem, safeSetItem } from "./safeStorage";

const HEADER_EXPANDED_KEY = "fleet_admiral_header_expanded";

// The width at or below which we treat the viewport as a phone for the DEFAULT only. Matches the
// breakpoint the rest of the app already uses for its compact treatment, so the header does not
// invent a second idea of "narrow".
const COMPACT_DEFAULT_MAX_WIDTH = 768;

// The stored choice, or null when the player has never made one.
//
// ⚠️ null is NOT false. Collapsing the header on a desktop is a real choice that must survive a
// reload, and it is indistinguishable from "no preference" if a missing key reads as false.
export function loadHeaderExpanded(): boolean | null {
  const raw = safeGetItem(HEADER_EXPANDED_KEY);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

export function saveHeaderExpanded(expanded: boolean): void {
  safeSetItem(HEADER_EXPANDED_KEY, expanded ? "true" : "false");
}

// What the header should start as: the player's remembered choice if they have one, otherwise the
// platform default.
//
// Takes the width as a PARAMETER rather than reading window itself, so this stays a pure function
// that a test can drive at any viewport without stubbing globals.
export function resolveHeaderExpanded(stored: boolean | null, viewportWidth: number): boolean {
  if (stored !== null) return stored;
  return viewportWidth > COMPACT_DEFAULT_MAX_WIDTH;
}
