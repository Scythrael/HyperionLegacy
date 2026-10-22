// ============================================================================
// dataStudy.ts: Gas Giant Study GG-5 (0.14.0, E-CREW Task 15b), the RESEARCH LAB'S DATA STUDY LANE, engine rules.
// Plan: docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-5; user answers of 2026-10-19 (calls 8 to 10, 12)
// and the signed-off v3 mockup (2026-10-21, "as drawn": data study is its own Research Lab tab, oldest held data
// first, no research-data warehouse shelf, decode the next entry of the fragment's OWN culture).
//
// The user's words (verbatim, plan section 1): "I was thinking the research facility could do so. Where the data is
// collected and returned. As that data is collected and returned, as each one completes (kinda like a set of items
// that you can have your team study) you gain various types of things to help you. Possibly learning a new recipe for
// crafting (rarely), and then something like some of those boosts to learning different types of research."
// Call 8 "Auto when idle (Recommended)", with a pause toggle. Call 9 "Your six + 2, +12% (Recommended)": +12% per boost
// on the next project of the family, D23 stacking; 5% recipe chance. Call 10 "One lane (Recommended)": the Ancient Data
// Fragment is a data type whose study decodes the next entry; culture names come with Relics v2. Call 12: a data study
// takes 20 minutes.
//
// THE LANE: the Research Lab studies one held research data item at a time on its OWN lane (DATA_STUDY_LANES at Lab
// Level I and up, read through model.ts labTier), never blocking blueprint research or relic identification. When the
// lane is idle it starts the OLDEST held item on its own (tick.ts processDataStudyLane, once per whole tick inside
// economyTick, so offline == live); the pause toggle (GameState.dataStudyPaused) holds the queue and the running study.
// A study takes DATA_STUDY_TICKS. Its completion (tick.ts resolveProcesses' studyData branch):
//   - a research data item banks ONE boost for its family (GameState.researchBoosts); the next blueprint research of
//     that family uses them all (tick.ts startResearch: its time / (1 + researchBoostSpeed(n)), on the D23 curve,
//     never capped), and at DATA_STUDY_RECIPE_PERMILLE the Lab also learns a recipe: one not-yet-researched blueprint of
//     the family at or below the Lab's tier is granted as researched (no invented blueprints; none left = nothing);
//   - an Ancient Data Fragment decodes the next entry of the culture it came from (GameState.ancientDecoded) and gives
//     that culture one study point (the Museum v2 culture record, feedCultureData: the seam Relics v2 OC-9 asked 15b to
//     call). Decoded entries open the decode-gated blueprints (model.ts blueprintDecodeLocked; GG-7 authors them).
//
// PURE: no Svelte, no clock, integer draws on keyed streams only. IMPORT DIRECTION: model, content, inventory, the
// relic culture readers and combat/rng; never tick.ts or expedition.ts (both import this module).
// ============================================================================

import {
  BLUEPRINTS,
  RELIC_DEFAULT_SEED,
  blueprintDecodeLocked,
  blueprintKind,
  blueprintRelicLocked,
  emptyMuseumV2,
  ITEMS,
  labTier,
  type BlueprintDef,
  type DataStudyHeldEntry,
  type EquipmentSlotType,
  type Expedition,
  type ExpeditionFinding,
  type GameState,
  type MuseumV2,
  type TimedProcess,
} from "./model";
import { ANCIENT_DATA_FRAGMENT_ID, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES, type ResearchFamily } from "./gasGiantContent";
import { itemTotal } from "./inventory";
import { diminishing } from "./diminishing";
import { cultureForBody, expeditionRegionTier, legacyTokenCultureId } from "./relicBlanks";
import { makeRng } from "./combat/rng";

// ============================================================================
// Constants
// ============================================================================

// The completion's recipe roll (odd, distinct; salts.test.ts).
export const DATA_STUDY_SALT = 0x2d6f4a9b;

// User call 12 (2026-10-19, "Proposed"): a data study takes 20 minutes (one tick is one second at the default cadence).
export const DATA_STUDY_TICKS = 1200;

// [PROVISIONAL] (the mockup shows Lab level 1 only; the plan's "Lab 1 has 1 slot" leaves room for more later): ONE lane
// at every Lab level (the signed-off v3 mockup, as drawn: "Lane 1 of 1, Lab level 1").
export const DATA_STUDY_LANES = 1;

// User call 9: +12% speed on the next project of the family for one banked boost.
export const RESEARCH_BOOST_PER = 0.12;
// [PROVISIONAL] the D23 knee the banked boosts stack on (plan GG-5: diminishing(n, 4) / diminishing(1, 4)): two boosts
// give about +22%, four about +40%, never capped.
export const RESEARCH_BOOST_KNEE = 4;

// User call 9: a 5% chance per study of learning a recipe.
export const DATA_STUDY_RECIPE_PERMILLE = 50;

// ============================================================================
// Research families of blueprints (user call 9: "Research may be expanded as well into different categories")
// ============================================================================

// [PROPOSAL] the family each output slot researches under: drives propel; shields and plating defend; ship weapons and
// drone pods fight; reactors, utility rigs and modules are systems; hull unlocks and the hull's own structures (holds,
// bridge, quarters) are hull design; sensor arrays sense; everything a squad member wears is field gear. A Record over
// the whole slot union, so a new slot cannot compile without a family.
export const RESEARCH_FAMILY_BY_SLOT: Readonly<Record<EquipmentSlotType, ResearchFamily>> = {
  cargoBay: "hullDesign",
  ftlDrive: "propulsion",
  reactorCore: "systems",
  specUtility: "systems",
  shieldEmitters: "defense",
  hullPlating: "defense",
  weapon: "weapons",
  droneBay: "weapons",
  module: "systems",
  bridge: "hullDesign",
  quarters: "hullDesign",
  thrusters: "propulsion",
  sensor: "sensors",
  propellantTanks: "propulsion",
  memberArmor: "field",
  memberWeapon: "field",
  memberTool: "field",
  implant: "field",
};
// [PROPOSAL] the utility rigs that are scanning gear research as sensors (the Survey Rig and the Pathfinder Suite: scan
// yield and scan speed).
export const RESEARCH_FAMILY_OVERRIDE: Readonly<Record<string, ResearchFamily>> = {
  surveyRigBp: "sensors",
  pathfinderSuiteBp: "sensors",
};

// The ONE family a blueprint researches under: its override, else its output shape (an unlock-only hull is hull design;
// a crafted weapon or drone pod is weapons; an equipment piece reads its slot; a material output is materials, except a
// field kit, which is field gear). Pure.
export function researchFamilyOf(bp: Pick<BlueprintDef, "key" | "unlockOnly" | "weaponOutput" | "droneOutput" | "equipmentOutput" | "recipe">): ResearchFamily {
  const own = RESEARCH_FAMILY_OVERRIDE[bp.key];
  if (own !== undefined) return own;
  switch (blueprintKind(bp as BlueprintDef)) {
    case "unlockOnly":
      return "hullDesign";
    case "weapon":
    case "drone":
      return "weapons";
    case "equipment":
      return RESEARCH_FAMILY_BY_SLOT[bp.equipmentOutput!.slotType] ?? "systems";
    default: {
      const out = bp.recipe.outputItem;
      return out !== undefined && ITEMS[out]?.category === "fieldKit" ? "field" : "materials";
    }
  }
}

// The family of a research data item, or null for any other item (the Ancient Data Fragment included). Pure.
const FAMILY_BY_DATA_ITEM: ReadonlyMap<string, ResearchFamily> = new Map(RESEARCH_FAMILIES.map((f) => [RESEARCH_DATA_ITEM[f], f] as const));
export function researchFamilyOfDataItem(itemId: string): ResearchFamily | null {
  return FAMILY_BY_DATA_ITEM.get(itemId) ?? null;
}

// Every item the lane studies, in family order, then the fragment.
export const DATA_STUDY_ITEM_IDS: readonly string[] = [...RESEARCH_FAMILIES.map((f) => RESEARCH_DATA_ITEM[f]), ANCIENT_DATA_FRAGMENT_ID];
const DATA_STUDY_ITEM_SET: ReadonlySet<string> = new Set(DATA_STUDY_ITEM_IDS);
export function isResearchDataItem(itemId: string): boolean {
  return DATA_STUDY_ITEM_SET.has(itemId);
}

// ============================================================================
// Banked boosts (user call 9: +12% each, D23 stacking)
// ============================================================================

// The speed `n` banked boosts give the next project of their family: RESEARCH_BOOST_PER x diminishing(n, knee) /
// diminishing(1, knee) (one boost is exactly +12%; more stack concave and unbounded, D23). 0 for none. Pure.
export function researchBoostSpeed(n: number): number {
  if (!(n > 0)) return 0;
  return (RESEARCH_BOOST_PER * diminishing(n, RESEARCH_BOOST_KNEE)) / diminishing(1, RESEARCH_BOOST_KNEE);
}

// The boosts banked for `family` (0 with none). Pure.
export function researchBoostsBanked(state: Pick<GameState, "researchBoosts">, family: ResearchFamily): number {
  const n = state.researchBoosts?.[family];
  return typeof n === "number" && n > 0 ? Math.floor(n) : 0;
}

// The boost record with `family`'s banked boosts spent (undefined when nothing is left). Pure.
export function withBoostsSpent(boosts: GameState["researchBoosts"], family: ResearchFamily): GameState["researchBoosts"] {
  if (!boosts || !(family in boosts)) return boosts;
  const rest = { ...boosts };
  delete rest[family];
  return Object.keys(rest).length > 0 ? rest : undefined;
}

// ============================================================================
// The held queue (oldest first, as drawn)
// ============================================================================

// Whole units of `itemId` held. Pure.
function heldUnits(state: Pick<GameState, "inventory">, itemId: string): number {
  return Math.max(0, Math.floor(itemTotal(state.inventory, itemId).toNumber()));
}

// The held research data in study order (the signed-off mockup: "oldest held data first"): first the units held with
// no arrival entry (held from before GG-5: the oldest), item by item in DATA_STUDY_ITEM_IDS order; then the arrival
// entries (GameState.dataStudyHeld) the inventory still covers, in arrival order (an item's first `held` entries are
// covered; any past that, a unit that left the inventory another way, are skipped). Pure.
export function heldDataQueue(state: Pick<GameState, "inventory" | "dataStudyHeld">): DataStudyHeldEntry[] {
  const queue = state.dataStudyHeld ?? [];
  const held: Record<string, number> = {};
  const queued: Record<string, number> = {};
  for (const id of DATA_STUDY_ITEM_IDS) held[id] = heldUnits(state, id);
  for (const e of queue) queued[e.itemId] = (queued[e.itemId] ?? 0) + 1;
  const out: DataStudyHeldEntry[] = [];
  for (const id of DATA_STUDY_ITEM_IDS) for (let k = 0; k < held[id] - (queued[id] ?? 0); k += 1) out.push({ itemId: id });
  const seen: Record<string, number> = {};
  for (const e of queue) {
    if (!isResearchDataItem(e.itemId)) continue;
    seen[e.itemId] = (seen[e.itemId] ?? 0) + 1;
    if (seen[e.itemId] <= (held[e.itemId] ?? 0)) out.push({ ...e });
  }
  return out;
}

// The arrival entries once `taken` (the queue's head) left the inventory at a study's start: a head with no entry left
// none; a head from the queue removes that item's first entry. Entries the inventory no longer covers are dropped.
// undefined when none is left. Pure.
export function heldAfterStart(
  state: Pick<GameState, "inventory" | "dataStudyHeld">,
  taken: DataStudyHeldEntry,
  inventoryAfter: GameState["inventory"],
): DataStudyHeldEntry[] | undefined {
  const queue = state.dataStudyHeld ?? [];
  const queued = queue.filter((e) => e.itemId === taken.itemId).length;
  const fromQueue = heldUnits(state, taken.itemId) <= queued;
  let skipped = !fromQueue;
  const kept: DataStudyHeldEntry[] = [];
  const seen: Record<string, number> = {};
  for (const e of queue) {
    if (!skipped && e.itemId === taken.itemId) {
      skipped = true;
      continue;
    }
    seen[e.itemId] = (seen[e.itemId] ?? 0) + 1;
    if (seen[e.itemId] <= heldUnits({ inventory: inventoryAfter }, e.itemId)) kept.push(e);
  }
  return kept.length > 0 ? kept : undefined;
}

// The culture of a fragment held with no arrival entry (from before GG-5): a pure hash of the save's relic seed and the
// study index (the Relics v2 legacy-token rule), so it never needs storing. Pure.
export function legacyFragmentCulture(state: Pick<GameState, "relicSeed">, studyIndex: number): string {
  return legacyTokenCultureId(state.relicSeed ?? RELIC_DEFAULT_SEED, `data-study-${studyIndex}`);
}

// ============================================================================
// The lane
// ============================================================================

// How many data studies the Research Lab runs at once: DATA_STUDY_LANES from Lab Level I, else 0. Its OWN lane,
// independent of blueprint research and relic identification. Pure.
export function dataStudyLaneCount(state: GameState): number {
  return labTier(state) >= 1 ? DATA_STUDY_LANES : 0;
}

// The data studies in flight, in activeProcesses order. Pure.
export function dataStudiesInFlight(state: Pick<GameState, "activeProcesses">): TimedProcess[] {
  return state.activeProcesses.filter((p) => p.kind === "dataStudy");
}

// Is the lane paused (call 8's toggle)? Pure.
export function dataStudyPaused(state: Pick<GameState, "dataStudyPaused">): boolean {
  return state.dataStudyPaused === true;
}

// THE PAUSE TOGGLE (call 8; the UI is GG-6): paused, no new study starts and the running one waits; on again, the lane
// resumes where it was. The SAME state when nothing changes. Pure.
export function setDataStudyPaused(state: GameState, paused: boolean): GameState {
  if (paused === dataStudyPaused(state)) return state;
  if (paused) return { ...state, dataStudyPaused: true };
  const rest = { ...state };
  delete rest.dataStudyPaused;
  return rest;
}

// ============================================================================
// The completion
// ============================================================================

// What a completion reads (the resolver's running values, so two completions in one call build on each other).
export interface DataStudyView {
  researchedBlueprints: readonly string[];
  labTier: number;
  relicDiscovered: readonly string[];
  ancientDecoded: GameState["ancientDecoded"];
  activeProcesses: readonly TimedProcess[];
}

// The blueprints a study of `family` can teach: of the family, at or below the Lab's tier, not researched, no research
// in flight for it, not locked behind a relic or an ancient entry; BLUEPRINTS order. Pure.
export function dataStudyRecipeCandidates(view: DataStudyView, family: ResearchFamily): string[] {
  const inFlight = new Set(view.activeProcesses.flatMap((p) => (p.effect.type === "unlockBlueprint" ? [p.effect.key] : [])));
  const gate = { relicDiscovered: [...view.relicDiscovered], ancientDecoded: view.ancientDecoded } as unknown as GameState;
  return Object.keys(BLUEPRINTS).filter((key) => {
    const bp = BLUEPRINTS[key];
    return (
      researchFamilyOf(bp) === family &&
      bp.tier <= view.labTier &&
      !view.researchedBlueprints.includes(key) &&
      !inFlight.has(key) &&
      !blueprintRelicLocked(gate, key) &&
      !blueprintDecodeLocked(gate, key)
    );
  });
}

// The recipe a completed study learns, or null: draw 1 the chance at DATA_STUDY_RECIPE_PERMILLE, draw 2 the pick among
// `candidates` (both always taken), on the study's own stream keyed by the save's relic seed and its index. A hit with
// no candidate learns nothing. `permille` defaults to the user's 5% (the wiring probe reads it at 0 too). Pure.
export function rollDataStudyRecipe(
  relicSeed: number | undefined,
  studyIndex: number,
  candidates: readonly string[],
  permille: number = DATA_STUDY_RECIPE_PERMILLE,
): string | null {
  const rng = makeRng(((relicSeed ?? RELIC_DEFAULT_SEED) ^ DATA_STUDY_SALT ^ Math.imul(studyIndex >>> 0, 0x9e3779b9)) >>> 0);
  const hit = rng.chance(permille, 1000);
  const pick = rng.nextInt(Math.max(1, candidates.length));
  return hit && candidates.length > 0 ? candidates[pick] : null;
}

// The Relics v2 CULTURE SEAM (plan 2026-10-17 OC-9, "relic finds and 15b ancient data both add study points"): the
// Museum v2 record with `points` more study points on `cultureId` (its finds and every other part kept). Pure.
export function feedCultureData(museum: MuseumV2 | undefined, cultureId: string, points: number): MuseumV2 {
  const base = museum ?? emptyMuseumV2();
  if (!(points > 0)) return base;
  const c = base.cultures[cultureId];
  return { ...base, cultures: { ...base.cultures, [cultureId]: c ? { ...c, points: c.points + points } : { points, finds: {} } } };
}

// The entries decoded on `cultureId` (0 with none). Pure.
export function ancientEntriesDecoded(state: Pick<GameState, "ancientDecoded">, cultureId: string): number {
  const n = state.ancientDecoded?.[cultureId];
  return typeof n === "number" && n > 0 ? Math.floor(n) : 0;
}

// ============================================================================
// Arrivals (the claim)
// ============================================================================

// The culture of the Ancient Data Fragment in `finding` of `exp`: a study finding names its body
// ("<expeditionId>-find-study-<bodyIndex>", gasGiantStudy.ts rollStudyReward), whose culture is the Relics v2 body culture
// (relicBlanks.ts cultureForBody at the run's region tier); any other finding falls back to the legacy hash. Pure.
export function fragmentCultureOf(exp: Pick<Expedition, "id" | "seed" | "region" | "risk">, finding: Pick<ExpeditionFinding, "id">, relicSeed: number | undefined): string {
  const prefix = `${exp.id}-find-study-`;
  if (finding.id.startsWith(prefix)) {
    const bodyIndex = Number(finding.id.slice(prefix.length));
    if (Number.isInteger(bodyIndex) && bodyIndex >= 0) return cultureForBody(exp.seed, bodyIndex, expeditionRegionTier(exp));
  }
  return legacyTokenCultureId(relicSeed ?? RELIC_DEFAULT_SEED, finding.id);
}

// The arrival entries a claim of `findings` appends (GameState.dataStudyHeld): one per research data unit, finding by
// finding, item by item in DATA_STUDY_ITEM_IDS order; a fragment carries its culture. Empty without `exp`'s data. Pure.
export function dataArrivals(
  findings: readonly ExpeditionFinding[],
  exp: Pick<Expedition, "id" | "seed" | "region" | "risk"> | undefined,
  relicSeed: number | undefined,
): DataStudyHeldEntry[] {
  const out: DataStudyHeldEntry[] = [];
  for (const f of findings) {
    if (!f.materials) continue;
    for (const id of DATA_STUDY_ITEM_IDS) {
      const qty = Math.floor(f.materials[id] ?? 0);
      for (let k = 0; k < qty; k += 1) {
        if (id === ANCIENT_DATA_FRAGMENT_ID) out.push({ itemId: id, cultureId: exp ? fragmentCultureOf(exp, f, relicSeed) : legacyTokenCultureId(relicSeed ?? RELIC_DEFAULT_SEED, f.id) });
        else out.push({ itemId: id });
      }
    }
  }
  return out;
}
