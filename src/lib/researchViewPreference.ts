// Research tab view preference (0.14.0, user 2026-11-17 "Research screen cleanup"). Two per-device DISPLAY
// preferences, localStorage only, NOT on GameState, so no save-schema change and no SAVE_VERSION bump. Nothing in the
// tick reads either.
//
// 1. The filter view (search, Status, Category, Tier): remembered between sessions like the Ships roster's view
//    (shipRosterViewPreference.ts shape). A stored value this build does not know (a family or tier that no longer
//    exists, an unknown status, a non-string search) falls back to that field's default on its own, so one bad field
//    never discards the others; malformed JSON or a blocked store gives the defaults.
// 2. "Show completed research" (Settings): default OFF, the tickReadoutPreference.ts shape. Off, researched blueprints
//    are hidden from the Research tab list.
//
// localStorage is reached through safeStorage (guarded get/set), so a blocked or full store degrades to the defaults
// instead of throwing, exactly like the sibling preference modules.
import { safeGetItem, safeSetItem } from "./safeStorage";
import { BLUEPRINTS } from "./game/model";
import { RESEARCH_FAMILIES, type ResearchFamily } from "./game/gasGiantContent";
import { DEFAULT_RESEARCH_FILTER_VIEW, RESEARCH_STATUS_KEYS, type ResearchFilterView, type ResearchStatusFilter } from "./researchFilter";

const RESEARCH_FILTER_VIEW_KEY = "fleet_admiral_research_filter_view";
const SHOW_COMPLETED_RESEARCH_KEY = "fleet_admiral_show_completed_research";

// The tiers the catalog holds (a stored tier outside it falls back to All).
const KNOWN_TIERS: ReadonlySet<number> = new Set(Object.values(BLUEPRINTS).map((bp) => bp.tier));

export function loadResearchFilterView(): ResearchFilterView {
  const raw = safeGetItem(RESEARCH_FILTER_VIEW_KEY);
  if (raw === null) return { ...DEFAULT_RESEARCH_FILTER_VIEW };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_RESEARCH_FILTER_VIEW };
  }
  const o = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  return {
    search: typeof o.search === "string" ? o.search : DEFAULT_RESEARCH_FILTER_VIEW.search,
    status: RESEARCH_STATUS_KEYS.includes(o.status as ResearchStatusFilter) ? (o.status as ResearchStatusFilter) : DEFAULT_RESEARCH_FILTER_VIEW.status,
    family:
      o.family === "all" || (RESEARCH_FAMILIES as readonly string[]).includes(o.family as string)
        ? (o.family as ResearchFamily | "all")
        : DEFAULT_RESEARCH_FILTER_VIEW.family,
    tier: typeof o.tier === "number" && KNOWN_TIERS.has(o.tier) ? o.tier : DEFAULT_RESEARCH_FILTER_VIEW.tier,
  };
}

// Best-effort: a rejected write is a silent no-op (the safeStorage posture), so the view simply does not persist.
export function saveResearchFilterView(view: ResearchFilterView): void {
  safeSetItem(
    RESEARCH_FILTER_VIEW_KEY,
    JSON.stringify({ search: view.search, status: view.status, family: view.family, tier: view.tier })
  );
}

export function loadShowCompletedResearch(): boolean {
  const raw = safeGetItem(SHOW_COMPLETED_RESEARCH_KEY);
  return raw === null ? false : raw === "true";
}

export function saveShowCompletedResearch(enabled: boolean): void {
  safeSetItem(SHOW_COMPLETED_RESEARCH_KEY, String(enabled));
}
