// E5 Refugee Posts (0.14.0; design docs/plans/2026-11-02-refugee-posts-e5-design.md, plan
// docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-1): the refugee record, the waiting list and the postings,
// the eight backgrounds, the posts each facility opens per level, and the readers the later slices build on.
//
// E5-1 is data only: nothing on the tick reads or writes `GameState.refugees` yet (E5-2 adds the arrivals, E5-4 the
// posting actions and the facility buffs). A save without the field reads as the empty state (refugeesOf), so a new
// game and every old save start with zero refugees, and no key is added until the first arrival.
//
// Every number here the user did not give is a [PROPOSAL] (mine, the user's to change) or [PROVISIONAL] (a first-pass
// value for the balance pass), each in one named constant.

import type { GameState } from "./model";
import type { ShortRangeTier } from "./shortRange";

// ===== the backgrounds =====

export type RefugeeBackground =
  | "refiner"
  | "fuelHandler"
  | "dispatcher"
  | "scholar"
  | "machinist"
  | "shipwright"
  | "salvager"
  | "stargazer";

// The eight homeworld facilities a refugee can be posted at (design section 7, "Facility list (fact)").
export type RefugeeFacilityKey =
  | "refinery"
  | "fuelStorage"
  | "missionControl"
  | "research"
  | "fabricator"
  | "shipyard"
  | "salvageBay"
  | "subspaceTelescope";

// In the order the backgrounds are listed below (the order lists and pickers read). [PROPOSAL]
export const REFUGEE_FACILITY_KEYS: readonly RefugeeFacilityKey[] = [
  "refinery",
  "fuelStorage",
  "missionControl",
  "research",
  "fabricator",
  "shipyard",
  "salvageBay",
  "subspaceTelescope",
];

// Each background, the facility it matches and the facility stat it improves there (as drawn in the signed mockup;
// [PROPOSAL]). Two stats are the user's calls on the E5-0 study (plan "USER ANSWERS (2026-11-02)"): the Refiner gives
// each finished refine batch a chance of extra output (a speed share is swallowed by tick rounding at Levels 1 to 3),
// and the Stargazer raises the chance to spot rare planet aspects (a percent scan range only touched edge systems and
// was display only). E5-4 wires each stat through its consumer; this table is the label and the match only.
export const REFUGEE_BACKGROUNDS: Readonly<
  Record<RefugeeBackground, { label: string; facility: RefugeeFacilityKey; statLabel: string }>
> = {
  refiner: { label: "Refiner", facility: "refinery", statLabel: "extra output chance" },
  fuelHandler: { label: "Fuel handler", facility: "fuelStorage", statLabel: "fleet reach" },
  dispatcher: { label: "Dispatcher", facility: "missionControl", statLabel: "short-range run speed" },
  scholar: { label: "Scholar", facility: "research", statLabel: "research speed" },
  machinist: { label: "Machinist", facility: "fabricator", statLabel: "craft speed" },
  shipwright: { label: "Shipwright", facility: "shipyard", statLabel: "build speed" },
  salvager: { label: "Salvager", facility: "salvageBay", statLabel: "salvage yield" },
  stargazer: { label: "Stargazer", facility: "subspaceTelescope", statLabel: "rare aspect spotting" },
};

// The backgrounds in roll order (E5-2 rolls uniformly over these; [PROPOSAL]). Frozen: a roll's index reads this.
export const REFUGEE_BACKGROUND_KEYS: readonly RefugeeBackground[] = [
  "refiner",
  "fuelHandler",
  "dispatcher",
  "scholar",
  "machinist",
  "shipwright",
  "salvager",
  "stargazer",
];

// The skill each evacuation tier rolls, inclusive, whole numbers (a harder evacuation brings a more capable person;
// design 2.9). [PROPOSAL] (mockup)
export const REFUGEE_SKILL_SPANS: Readonly<Record<ShortRangeTier, readonly [number, number]>> = {
  1: [20, 50],
  2: [40, 75],
};

// Portrait shapes (simple SVG silhouettes, plan Global Constraints): four hair shapes, eight color sets.
export const REFUGEE_PORTRAIT_HAIRS = 4;
export const REFUGEE_PORTRAIT_PALETTES = 8;

// ===== the record and the state =====

export interface RefugeeRecord {
  id: number; // 1, 2, 3 ... in arrival order, never reused
  name: string;
  background: RefugeeBackground;
  skill: number; // fixed at arrival, whole number
  // Where they came from: the evacuation's tier and destination (the label is derived, shortRangeDestinationLabel).
  origin: { tier: ShortRangeTier; destinationIndex: number };
  portrait: { hair: 0 | 1 | 2 | 3; palette: number /* 0..7 */ };
  arrivedAtSeconds: number;
  posting: RefugeeFacilityKey | null; // null = on the waiting list
}

// The whole refugee record (GameState.refugees). `list` holds everyone at home, in arrival order; among the people
// posted at one facility, list order is the posting order (hydrateRefugees returns the LAST of an overflow first, so
// E5-4's posting action keeps a newly posted person after everyone already posted there). `greet`: the ids whose
// arrival card has not been seen yet. `arrivedTotal` counts every arrival ever (relocations never lower it).
export interface RefugeeState {
  version: 1;
  list: RefugeeRecord[];
  nextId: number;
  arrivedTotal: number;
  greet: number[];
  hintSeen?: true;
}

// A save without the field: nobody yet.
function emptyRefugees(): RefugeeState {
  return { version: 1, list: [], nextId: 1, arrivedTotal: 0, greet: [] };
}

// The refugee state, or the empty one when the save has none (a new game, every old save). Pure.
export function refugeesOf(state: Pick<GameState, "refugees">): RefugeeState {
  return state.refugees ?? emptyRefugees();
}

// ===== posts =====

// A post opens at Level 1 and one more every REFUGEE_POSTS_EVERY levels after it: Levels 1, 4, 7, 10 ... [PROPOSAL]
// (mockup).
export const REFUGEE_POSTS_EVERY = 3;

// The posts a facility opens at `level`: 0 unbuilt, else 1 + floor((level - 1) / REFUGEE_POSTS_EVERY). A non-finite
// or negative level opens none. Pure.
export function refugeePostsAt(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  return 1 + Math.floor((Math.floor(level) - 1) / REFUGEE_POSTS_EVERY);
}

function facilityLevel(state: Pick<GameState, "facilities">, facility: RefugeeFacilityKey): number {
  const raw = state.facilities?.[facility]?.level;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

// The posts `facility` has at its current level. Pure.
export function refugeePostCount(state: Pick<GameState, "facilities">, facility: RefugeeFacilityKey): number {
  return refugeePostsAt(facilityLevel(state, facility));
}

// The people posted at `facility`, in posting order. Pure.
export function refugeesPostedAt(state: Pick<GameState, "refugees">, facility: RefugeeFacilityKey): RefugeeRecord[] {
  return refugeesOf(state).list.filter((r) => r.posting === facility);
}

// Everyone on the waiting list, in arrival order. Pure.
export function refugeeWaiting(state: Pick<GameState, "refugees">): RefugeeRecord[] {
  return refugeesOf(state).list.filter((r) => r.posting === null);
}

// Every open post on the homeworld: the posts of the eight facilities minus the people posted, never below 0 (a
// facility holding more than its posts counts 0 open, never a negative). Pure.
export function refugeeOpenPosts(state: Pick<GameState, "refugees" | "facilities">): number {
  let open = 0;
  for (const facility of REFUGEE_FACILITY_KEYS) {
    open += Math.max(0, refugeePostCount(state, facility) - refugeesPostedAt(state, facility).length);
  }
  return open;
}

// ===== shape checks and hydration =====

function isWholeCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isRefugeeBackground(v: unknown): v is RefugeeBackground {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REFUGEE_BACKGROUNDS, v);
}

export function isRefugeeFacilityKey(v: unknown): v is RefugeeFacilityKey {
  return typeof v === "string" && (REFUGEE_FACILITY_KEYS as readonly string[]).includes(v);
}

// A stored record's shape check (hydrateRefugees drops one that fails). Pure.
export function isWellFormedRefugeeRecord(v: unknown): v is RefugeeRecord {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  const origin = r.origin as Record<string, unknown> | null | undefined;
  const portrait = r.portrait as Record<string, unknown> | null | undefined;
  return (
    isWholeCount(r.id) && r.id >= 1 &&
    typeof r.name === "string" && r.name.length > 0 &&
    isRefugeeBackground(r.background) &&
    typeof r.skill === "number" && Number.isFinite(r.skill) && r.skill >= 0 &&
    !!origin && typeof origin === "object" && (origin.tier === 1 || origin.tier === 2) && isWholeCount(origin.destinationIndex) &&
    !!portrait && typeof portrait === "object" &&
    isWholeCount(portrait.hair) && portrait.hair < REFUGEE_PORTRAIT_HAIRS &&
    isWholeCount(portrait.palette) && portrait.palette < REFUGEE_PORTRAIT_PALETTES &&
    typeof r.arrivedAtSeconds === "number" && Number.isFinite(r.arrivedAtSeconds) && r.arrivedAtSeconds >= 0 &&
    (r.posting === null || isRefugeeFacilityKey(r.posting))
  );
}

// The refugee state as it loads (save.ts hydration, after the board check). Nobody is ever lost to a value the game
// can still read:
//   - a posting to a key that is not one of the eight returns that person to the waiting list (posting null);
//   - a facility holding more people than its posts (a hand-edited save, or a future level loss) returns the extra
//     people to the waiting list, the last posted first (plan Review Focus 1);
//   - only a record whose identity cannot be read (unknown background, non-finite skill, a missing name ...) or a
//     repeated id is dropped; the rest keep their order;
//   - `nextId` is raised past every id held, `arrivedTotal` to at least the people at home, `greet` keeps only ids
//     still at home.
// A whole value that is not a version-1 object is dropped (it reads as the empty state). A state without the field,
// or whose field needs nothing, is returned as is (the same reference), so a clean load adds no key and moves nothing.
export function hydrateRefugees(state: GameState): GameState {
  const raw = (state as { refugees?: unknown }).refugees;
  if (raw === undefined) return state;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as { version?: unknown }).version !== 1) {
    const { refugees: _dropped, ...rest } = state;
    return rest as GameState;
  }
  const stored = raw as Record<string, unknown>;
  let changed = false;

  // 1. Records: unknown postings back to waiting, then the shape check, then repeated ids.
  const inList: unknown[] = Array.isArray(stored.list) ? stored.list : [];
  if (!Array.isArray(stored.list)) changed = true;
  const seen = new Set<number>();
  let list: RefugeeRecord[] = [];
  for (const entry of inList) {
    let candidate = entry;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const posting = (candidate as { posting?: unknown }).posting;
      if (posting !== null && !isRefugeeFacilityKey(posting)) {
        candidate = { ...(candidate as object), posting: null };
        changed = true;
      }
    }
    if (!isWellFormedRefugeeRecord(candidate) || seen.has(candidate.id)) {
      changed = true;
      continue;
    }
    seen.add(candidate.id);
    list.push(candidate);
  }

  // 2. Overflow: per facility, the people past its posts (in posting order) return to waiting.
  const facilities = state.facilities;
  for (const facility of REFUGEE_FACILITY_KEYS) {
    const posts = refugeePostsAt(facilityLevel({ facilities }, facility));
    if (list.filter((r) => r.posting === facility).length <= posts) continue;
    changed = true;
    let kept = 0;
    list = list.map((r) => {
      if (r.posting !== facility) return r;
      kept += 1;
      return kept <= posts ? r : { ...r, posting: null };
    });
  }

  // 3. Counters.
  const maxId = list.reduce((m, r) => Math.max(m, r.id), 0);
  const nextId = isWholeCount(stored.nextId) && stored.nextId > maxId ? stored.nextId : maxId + 1;
  const arrivedTotal = isWholeCount(stored.arrivedTotal) && stored.arrivedTotal >= list.length ? stored.arrivedTotal : list.length;
  const ids = new Set(list.map((r) => r.id));
  const inGreet: unknown[] = Array.isArray(stored.greet) ? stored.greet : [];
  const greet = inGreet.filter((g): g is number => isWholeCount(g) && ids.has(g)).filter((g, i, a) => a.indexOf(g) === i);
  if (nextId !== stored.nextId || arrivedTotal !== stored.arrivedTotal || !Array.isArray(stored.greet) || greet.length !== inGreet.length) {
    changed = true;
  }
  const hintSeenOk = stored.hintSeen === undefined || stored.hintSeen === true;
  if (!hintSeenOk) changed = true;
  const extraKeys = Object.keys(stored).some((k) => !["version", "list", "nextId", "arrivedTotal", "greet", "hintSeen"].includes(k));
  if (extraKeys) changed = true;
  if (!changed) return state;

  const refugees: RefugeeState = {
    version: 1,
    list,
    nextId,
    arrivedTotal,
    greet,
    ...(stored.hintSeen === true ? { hintSeen: true as const } : {}),
  };
  return { ...state, refugees };
}
