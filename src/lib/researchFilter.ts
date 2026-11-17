// Research tab search and filter (0.14.0, user 2026-11-17 "Research screen cleanup": "It's hard to keep track of
// things in there"; design docs/superpowers/specs/2026-11-17-research-filter-and-crew-standard-issue-design.md
// section 1). A PURE filter over the Research list's tier groups (App.svelte blueprintTierGroups): a search box plus
// Status, Category and Tier chips, combined with AND, and researched blueprints hidden unless the "Show completed
// research" setting is on.
//
// DISPLAY ONLY. Every verdict is read off the engine's own predicates (blueprintUnlocked, canResearch,
// blueprintRelicLocked, the research lab's queue), never re-derived, so the filter cannot disagree with the card it
// filters. Nothing here touches GameState or the save.
//
// NO LEAK. A blueprint still locked behind an undiscovered relic renders as a MASKED card (only the mask's title and
// detail). Its search text is that mask text alone, it always counts as Locked, and its family is not shown either
// (it appears under Category All only), so no filter can reveal what the mask hides.
import {
  EQUIPMENT_SLOTS,
  ITEMS,
  SHIP_TYPES,
  blueprintKind,
  blueprintRelicLocked,
  blueprintUnlocked,
  equipmentSlotLabel,
  type BlueprintDef,
  type GameState,
  type ShipTypeKey,
} from "./game/model";
import { canResearch, queuedForFacility } from "./game/tick";
import { undiscoveredResearchMask } from "./game/relics";
import { researchFamilyOf } from "./game/dataStudy";
import { RESEARCH_FAMILIES, type ResearchFamily } from "./game/gasGiantContent";
import { familyLabel } from "./dataStudyDisplay";
import { tierNumeral } from "./game/galaxy";

export type ResearchStatusFilter = "all" | "canResearch" | "inProgress" | "locked" | "researched";

export interface ResearchFilterView {
  search: string;
  status: ResearchStatusFilter;
  family: ResearchFamily | "all";
  tier: number | "all";
}

// Every chip on All and an empty search: the whole list (less researched blueprints while they are hidden).
export const DEFAULT_RESEARCH_FILTER_VIEW: Readonly<ResearchFilterView> = { search: "", status: "all", family: "all", tier: "all" };

// The status chips in display order. Researched is offered only while completed research is shown.
export const RESEARCH_STATUS_KEYS: readonly ResearchStatusFilter[] = ["all", "canResearch", "inProgress", "locked", "researched"];
const STATUS_LABEL: Readonly<Record<ResearchStatusFilter, string>> = {
  all: "All",
  canResearch: "Can research",
  inProgress: "In progress or queued",
  locked: "Locked",
  researched: "Researched",
};

// The shape of one Research list tier group (App.svelte blueprintTierGroups): the tier, its flat blueprint list, and
// its shelves (an unlabeled main shelf, then the labeled member shelves).
export interface ResearchTierGroupShape {
  tier: number;
  blueprints: BlueprintDef[];
  sections: { key: string; label: string | null; blueprints: BlueprintDef[] }[];
}

// A blueprint's status for the Status chips. Masked relic cards are Locked (the card offers no action). Otherwise:
// researched (blueprintUnlocked), in progress or queued (a running lab project, which canResearch reports as
// inProgress, or a waiting research order in the lab's queue), can research (canResearch ok), else locked (any other
// canResearch refusal: lab level, a free slot, credits, decoding). Pure.
export function researchStatusOf(state: GameState, bpKey: string): Exclude<ResearchStatusFilter, "all"> {
  if (blueprintRelicLocked(state, bpKey)) return "locked";
  if (blueprintUnlocked(state, bpKey)) return "researched";
  const gate = canResearch(state, bpKey);
  if (!gate.ok && gate.reason === "inProgress") return "inProgress";
  const queued = queuedForFacility(state, "researchLab").some(
    (job) => job.order.type === "research" && job.order.blueprintKey === bpKey
  );
  if (queued) return "inProgress";
  return gate.ok ? "canResearch" : "locked";
}

// The hull an unlock-only blueprint grants build access to (the reverse of ShipTypeDef.requiresBlueprint), the same
// scan the card's "Unlocks:" line reads. Pure.
function hullUnlockedBy(bpKey: string): string | undefined {
  for (const k of Object.keys(SHIP_TYPES)) {
    const def = SHIP_TYPES[k as ShipTypeKey];
    if (def.requiresBlueprint === bpKey) return def.label;
  }
  return undefined;
}

// What a crafted output reads as on the card: an equipment piece's slot and variety, else the output item's label.
// (A weapon or drone pod reads as its blueprint label, which the search text already carries.) Pure.
function outputLabel(bp: BlueprintDef): string {
  if (bp.equipmentOutput) {
    const { slotType, varietyKey } = bp.equipmentOutput;
    const variety = EQUIPMENT_SLOTS[slotType]?.varieties.find((v) => v.key === varietyKey);
    return `${equipmentSlotLabel(slotType, varietyKey)} ${variety?.label ?? varietyKey}`;
  }
  const out = bp.recipe.outputItem;
  return out !== undefined ? ITEMS[out]?.label ?? out : "";
}

// The lowercase text a search runs against. A masked card: its mask title and detail only. Otherwise the blueprint's
// name, its recipe's material names, its output, and for an unlock-only blueprint the hull it unlocks. Pure.
export function researchSearchText(state: GameState, bp: BlueprintDef): string {
  if (blueprintRelicLocked(state, bp.key)) {
    const mask = undiscoveredResearchMask(bp.requiresRelicDiscovery);
    return `${mask.title} ${mask.detail}`.toLowerCase();
  }
  const parts: string[] = [bp.label];
  if (blueprintKind(bp) === "unlockOnly") {
    parts.push(hullUnlockedBy(bp.key) ?? "");
  } else {
    for (const inId of Object.keys(bp.recipe.inputs)) parts.push(ITEMS[inId]?.label ?? inId);
    parts.push(outputLabel(bp));
  }
  return parts.filter((p) => p !== "").join(" ").toLowerCase();
}

// The family a Category chip filters on; null for a masked card (its family stays hidden). Pure.
function visibleFamilyOf(state: GameState, bp: BlueprintDef): ResearchFamily | null {
  return blueprintRelicLocked(state, bp.key) ? null : researchFamilyOf(bp);
}

// Filter the tier groups by the view. Keeps the input shape and order (tiers, shelves, blueprints); drops empty shelves
// and empty tiers. With showCompleted false, researched blueprints are removed and counted in hiddenResearched (only
// those the view would otherwise show), and a stored Researched status behaves as All. `matched` is the number of
// blueprints left. Pure.
export function filterBlueprintTierGroups<G extends ResearchTierGroupShape>(
  state: GameState,
  groups: readonly G[],
  view: ResearchFilterView,
  showCompleted: boolean
): { groups: G[]; hiddenResearched: number; matched: number } {
  const query = view.search.trim().toLowerCase();
  const status: ResearchStatusFilter = !showCompleted && view.status === "researched" ? "all" : view.status;
  let hiddenResearched = 0;
  let matched = 0;
  const keep = (bp: BlueprintDef): boolean => {
    if (view.family !== "all" && visibleFamilyOf(state, bp) !== view.family) return false;
    if (query !== "" && !researchSearchText(state, bp).includes(query)) return false;
    const s = researchStatusOf(state, bp.key);
    if (status !== "all" && s !== status) return false;
    if (s === "researched" && !showCompleted) {
      hiddenResearched += 1;
      return false;
    }
    return true;
  };
  const out: G[] = [];
  for (const g of groups) {
    if (view.tier !== "all" && g.tier !== view.tier) continue;
    const kept = new Set<string>();
    const sections = g.sections
      .map((sec) => {
        const blueprints = sec.blueprints.filter(keep);
        for (const bp of blueprints) kept.add(bp.key);
        return { ...sec, blueprints };
      })
      .filter((sec) => sec.blueprints.length > 0);
    if (sections.length === 0) continue;
    matched += kept.size;
    out.push({ ...g, blueprints: g.blueprints.filter((bp) => kept.has(bp.key)), sections });
  }
  return { groups: out, hiddenResearched, matched };
}

// The Status chips: All, Can research, In progress or queued, Locked, plus Researched while completed research is
// shown. Pure.
export function researchStatusOptions(showCompleted: boolean): { key: ResearchStatusFilter; label: string }[] {
  return RESEARCH_STATUS_KEYS.filter((k) => showCompleted || k !== "researched").map((key) => ({ key, label: STATUS_LABEL[key] }));
}

// The Category chips: All, then each research family present in the list (masked cards excluded, so a chip never
// hints at a hidden project), in the game's family order, plus the selected family if it has gone missing so the
// pressed chip never vanishes. Pure.
export function researchCategoryOptions(
  state: GameState,
  groups: readonly ResearchTierGroupShape[],
  selected: ResearchFamily | "all" = "all"
): { key: ResearchFamily | "all"; label: string }[] {
  const present = new Set<ResearchFamily>();
  for (const g of groups) for (const bp of g.blueprints) {
    const f = visibleFamilyOf(state, bp);
    if (f !== null) present.add(f);
  }
  if (selected !== "all") present.add(selected);
  return [
    { key: "all" as const, label: "All" },
    ...RESEARCH_FAMILIES.filter((f) => present.has(f)).map((f) => ({ key: f, label: familyLabel(f) })),
  ];
}

// The Tier chips: All, then each tier present, in Roman numerals. Pure.
export function researchTierOptions(groups: readonly ResearchTierGroupShape[]): { key: number | "all"; label: string }[] {
  return [{ key: "all" as const, label: "All" }, ...groups.map((g) => ({ key: g.tier, label: tierNumeral(g.tier) }))];
}

// The Research list's empty state when no blueprint passes the filters (a Clear filters button sits beside it).
export const RESEARCH_FILTER_EMPTY_TEXT = "No blueprints match these filters.";

// The line under the filter bar while completed research is hidden. Pure.
export function researchHiddenCountText(n: number): string {
  return `${n} researched blueprint${n === 1 ? "" : "s"} hidden (Settings > Show completed research)`;
}
