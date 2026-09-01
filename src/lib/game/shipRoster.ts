// ============================================================================
// shipRoster.ts: pure view-model for the Ships-tab fleet roster (0.13.2, Unit 3)
// Author: Claude (Opus 4.8) | 2026-09-01
//
// WHAT THIS IS. The Ships tab (0.13.2) upgrades the old flat card grid into a
// sortable / favoritable / filterable roster. All of that shaping is done HERE,
// in one pure function, so the Svelte side is a thin presenter over a computed
// model (Omega 14e: the console is the user's eyes, but also Omega 9: the logic
// stays readable as rule-based data, testable without a DOM).
//
// WHAT IT PRODUCES. buildShipRoster(state, opts) returns { groups: [...] }, an
// ordered list of labelled groups of rows. Favorites (a per-device localStorage
// set of ship ids, owned by App.svelte) are pinned into their own top group; the
// remaining ships fall under a single group, or, when the player groups by class,
// under one group per hull class. Rows inside every group are sorted by the chosen
// sort key.
//
// WHAT IT DOES NOT DO (deliberate reuse, Omega 15b / the plan's "do NOT re-derive"):
//   - the captain-and-status derivation mirrors the exact live card logic (a hull's
//     captain is resolved by assignedCaptainId; status comes from that captain's
//     mission kind).
//   - the Battle Rating is scored through the SAME path the ShipSystemsPanel uses
//     (shipToCombatant over equippedFor + battleRating), never a re-implementation.
//   - the attention predicate reuses computeCombatReadout (combatFit.ts) for the
//     "an empty required combat slot" signal, plus the ship's own `damaged` flag.
//
// PURE: every function reads its inputs and returns fresh values, mutating nothing.
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
// ============================================================================

import { SHIP_TYPES } from "./model";
import type { GameState, ShipInstance } from "./model";
import { equippedFor } from "./equipment";
import { computeCombatReadout } from "./combatFit";
import { shipToCombatant, combatHullTypeOf } from "./combat/bridge";
import { battleRating } from "./combat/rating";

// ----------------------------------------------------------------------------
// Public vocabulary
// ----------------------------------------------------------------------------

// How the roster rows are ordered inside each group.
//   attention : the default. Ships that need the player (damaged / empty required
//               combat slot) float to the top, then by Battle Rating (strongest
//               first), then by name. So "what needs me + my best hulls" reads first.
//   name      : display name, A to Z.
//   class     : hull class label, A to Z, then name within a class.
//   rating    : Battle Rating, strongest first, then name.
//   status    : activity bucket (see STATUS_SORT_RANK below), then name.
export type ShipSortKey = "attention" | "name" | "class" | "rating" | "status";

// The roster's top-level shaping.
//   all        : every ship, one flat list (below the Favorites group, if any).
//   needsOrders: only ships that are idle or parked (no active mission or patrol),
//                the "give this hull something to do" set. A flat list.
//   byClass    : every ship, but the non-favorites are split into one group per
//                hull class (class label as the group header).
export type ShipFilterKey = "all" | "needsOrders" | "byClass";

// A ship's current activity, derived from the aboard captain's mission EXACTLY as
// the live roster card derives it (App.svelte ships block):
//   parked    : no captain assigned (assignedCaptainId === null).
//   idle      : a captain is aboard but has no mission (mission === null).
//   gathering : the captain is on an extraction mission (mission.kind "extraction").
//   patrol    : the captain is on a combat patrol (mission.kind "patrol").
export type ShipStatus = "parked" | "idle" | "gathering" | "patrol";

// One roster row: a compact, fully-derived snapshot of a single hull. Everything
// the row markup renders is precomputed here so the row template does no rescanning
// (Omega 14 perf note: the roster re-renders each tick for 50+ ships).
export interface ShipRosterRow {
	id: string;                       // ShipInstance.id, the stable row key + favorite key
	name: string;                     // display name: ship.name ?? hull-class label
	className: string;                // hull-class label (SHIP_TYPES[typeKey].label)
	captainName: string | null;       // aboard captain's label, or null when parked
	status: ShipStatus;               // activity bucket (see ShipStatus)
	damaged: boolean;                 // ship.damaged === true (limped home from a lost patrol)
	needsAttention: boolean;          // the attention predicate (damaged OR empty required combat slot)
	attentionReason: string | null;   // a short human reason when needsAttention, else null
	battleRating: number;             // the same "how geared" scalar the install panel shows
	favorite: boolean;                // is this ship in the favorites set
	typeKey: string;                  // hull type key (for the row's icon / lookups)
}

// One labelled group of rows. label === null renders as a header-less flat list
// (the single-group "all ships" case with no favorites); a string label renders a
// group header ("Favorites", "All ships", or a hull-class name under By class).
export interface ShipRosterGroup {
	label: string | null;
	rows: ShipRosterRow[];
}

// The whole shaped roster: an ordered list of groups. Favorites (when any) first,
// then the rest.
export interface ShipRoster {
	groups: ShipRosterGroup[];
}

// The inputs that shape the roster. `state` is the live GameState (the roster reads
// ships / captains / equipment off it); the rest are the player's non-persisted UI
// selections plus the per-device favorites set.
export interface BuildShipRosterOptions {
	sortKey: ShipSortKey;
	filterKey: ShipFilterKey;
	searchText: string;
	favorites: Set<string>;
}

// The activity-bucket order used by the "status" sort. Chosen so the list reads from
// "needs orders" (parked, then idle) toward "actively working" (gathering, patrol).
// A stable, documented order (Omega 9: rule-based), with a name tiebreak applied on top.
const STATUS_SORT_RANK: Record<ShipStatus, number> = {
	parked: 0,
	idle: 1,
	gathering: 2,
	patrol: 3,
};

// ----------------------------------------------------------------------------
// deriveStatus: the captain-and-status read, mirroring the live card EXACTLY
// ----------------------------------------------------------------------------
// Resolve a hull's aboard captain (by assignedCaptainId, the single source of truth
// for assignment) and its activity status from that captain's mission. This is the
// SAME derivation the roster card and the ship page use (App.svelte ships block), only
// lifted out so it is computed once per ship here. PURE.
function deriveStatus(
	state: GameState,
	ship: ShipInstance,
): { captainName: string | null; status: ShipStatus } {
	// No captain assigned => parked (the hull sits in dock with no one aboard).
	if (ship.assignedCaptainId === null) {
		return { captainName: null, status: "parked" };
	}
	// A captain is assigned but may have vanished from state (a hand-edited save); a
	// missing captain reads as parked, the same graceful fallback the card's ?? null uses.
	const captain = state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null;
	if (captain === null) {
		return { captainName: null, status: "parked" };
	}
	// Captain aboard with no mission => idle (available to dispatch).
	if (captain.mission === null) {
		return { captainName: captain.label, status: "idle" };
	}
	// On a mission: the discriminated-union kind picks the bucket. "extraction" is a
	// resource-gathering run; "patrol" is a combat patrol. (Narrowing on mission.kind
	// is exactly what every other mission consumer does.)
	const status: ShipStatus = captain.mission.kind === "patrol" ? "patrol" : "gathering";
	return { captainName: captain.label, status };
}

// ----------------------------------------------------------------------------
// deriveAttention: the attention predicate (damaged OR empty required combat slot)
// ----------------------------------------------------------------------------
// A ship "needs attention" when either:
//   1. it is DAMAGED (ship.damaged === true: it limped home from a lost patrol and
//      cannot be re-dispatched until a Shipyard bay repairs it), or
//   2. it is a combat hull with an EMPTY required combat slot (no weapon / no shield
//      emitter / no hull plating), read from computeCombatReadout's missingRequired.
// The reason string is a short, single phrase for the amber flag, damaged taking
// priority, then the first missing slot in the readout's stable order. PURE, and cheap:
// it folds the already-fetched gear once (no extra state scans).
function deriveAttention(
	ship: ShipInstance,
	gear: ReturnType<typeof equippedFor>,
): { needsAttention: boolean; attentionReason: string | null } {
	const damaged = ship.damaged === true;

	// Every hull is combat-capable (combatHullTypeOf is non-null for every real hull),
	// but we still guard on it so a corrupt typeKey degrades to "not a combat hull"
	// (no readout, no missing-slot flag) instead of throwing.
	const isCombatHull = combatHullTypeOf(ship.typeKey) !== null;
	const def = SHIP_TYPES[ship.typeKey];

	let missingReason: string | null = null;
	if (isCombatHull && def) {
		const readout = computeCombatReadout(gear, def, def.weaponHardpoints, def.droneBays ?? 0);
		// missingRequired is in a stable order (weapon, shieldEmitters, hullPlating);
		// surface the first as the reason so the flag names the most useful next install.
		if (readout.missingRequired.includes("weapon")) {
			missingReason = "Needs a weapon";
		} else if (readout.missingRequired.includes("shieldEmitters")) {
			missingReason = "No shield emitter";
		} else if (readout.missingRequired.includes("hullPlating")) {
			missingReason = "No hull plating";
		}
	}

	const needsAttention = damaged || missingReason !== null;
	// Damaged is the louder, blocking condition (it stops dispatch), so it wins the
	// single reason slot; otherwise report the empty-slot reason.
	const attentionReason = damaged ? "Damaged" : missingReason;
	return { needsAttention, attentionReason };
}

// ----------------------------------------------------------------------------
// buildRow: fold one ShipInstance into a fully-derived ShipRosterRow
// ----------------------------------------------------------------------------
// Reads the ship's fitted gear ONCE (equippedFor) and reuses it for both the Battle
// Rating (via the same shipToCombatant + battleRating path the install panel uses) and
// the attention predicate, so a row costs one gear fetch. PURE.
function buildRow(state: GameState, ship: ShipInstance, favorites: Set<string>): ShipRosterRow {
	const def = SHIP_TYPES[ship.typeKey];
	const className = def?.label ?? ship.typeKey;
	const name = ship.name ?? className;

	const { captainName, status } = deriveStatus(state, ship);

	// The fitted combat gear, fetched once and shared by the rating + attention folds.
	const gear = equippedFor(state, ship.id);

	// Battle Rating via the SAME path ShipSystemsPanel scores with: build the player
	// Combatant from the installed gear and score it. A hull that does not resolve to a
	// combat class (corrupt typeKey) or has no SHIP_TYPES entry scores 0 rather than throwing.
	const hullType = combatHullTypeOf(ship.typeKey);
	const rating =
		def && hullType
			? battleRating(
					shipToCombatant({
						id: ship.id,
						team: "player",
						stats: def,
						hullType,
						installedGear: gear,
					}),
				)
			: 0;

	const { needsAttention, attentionReason } = deriveAttention(ship, gear);

	return {
		id: ship.id,
		name,
		className,
		captainName,
		status,
		damaged: ship.damaged === true,
		needsAttention,
		attentionReason,
		battleRating: rating,
		favorite: favorites.has(ship.id),
		typeKey: ship.typeKey,
	};
}

// ----------------------------------------------------------------------------
// Comparators
// ----------------------------------------------------------------------------
// A name tiebreak used by every sort so ordering is deterministic even when the
// primary key ties (Alpha: accuracy / stable output). Case-insensitive A to Z.
function byName(a: ShipRosterRow, b: ShipRosterRow): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// Return the comparator for a given sort key. Each falls back to byName on a tie so
// the list never reorders arbitrarily between ticks.
function comparatorFor(sortKey: ShipSortKey): (a: ShipRosterRow, b: ShipRosterRow) => number {
	switch (sortKey) {
		case "name":
			return byName;
		case "class":
			// Class label A to Z, then name within the class.
			return (a, b) => a.className.localeCompare(b.className, undefined, { sensitivity: "base" }) || byName(a, b);
		case "rating":
			// Strongest first, then name.
			return (a, b) => b.battleRating - a.battleRating || byName(a, b);
		case "status":
			// Activity bucket order (STATUS_SORT_RANK), then name.
			return (a, b) => STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status] || byName(a, b);
		case "attention":
		default:
			// Needs-attention first (true sorts before false), then strongest, then name.
			return (a, b) =>
				Number(b.needsAttention) - Number(a.needsAttention) || b.battleRating - a.battleRating || byName(a, b);
	}
}

// Sort a COPY of the rows (never mutate the caller's array) with the chosen comparator.
function sortRows(rows: ShipRosterRow[], sortKey: ShipSortKey): ShipRosterRow[] {
	return [...rows].sort(comparatorFor(sortKey));
}

// ----------------------------------------------------------------------------
// buildShipRoster: the one public entry point
// ----------------------------------------------------------------------------
// Fold the live fleet into the shaped, grouped, sorted view model the Ships tab
// renders. Order of operations (documented so the interactions are painfully clear):
//   1. Build one row per ship.
//   2. FILTER (hard): apply the search text (matches name OR class), then the
//      needsOrders filter (parked or idle only) when selected. Filters remove rows
//      from consideration entirely, favorites included, so search is a true filter.
//   3. PARTITION: pull the surviving favorites into their own pinned top group.
//   4. GROUP the rest: one flat group normally, or one group per class under By class.
//   5. SORT rows inside every group by the chosen sort key.
// PURE.
export function buildShipRoster(state: GameState, opts: BuildShipRosterOptions): ShipRoster {
	const { sortKey, filterKey, searchText, favorites } = opts;

	// 1. One row per ship.
	const allRows = state.ships.map((ship) => buildRow(state, ship, favorites));

	// 2a. Search filter (case-insensitive, trimmed). Empty search keeps everything.
	//     Matches the display name OR the hull-class label so either finds the ship.
	const needle = searchText.trim().toLowerCase();
	const searched =
		needle === ""
			? allRows
			: allRows.filter(
					(r) => r.name.toLowerCase().includes(needle) || r.className.toLowerCase().includes(needle),
				);

	// 2b. needsOrders filter: only ships that are idle or parked (no active mission or
	//     patrol), the actionable "give this hull orders" set. all / byClass keep everything.
	const filtered =
		filterKey === "needsOrders"
			? searched.filter((r) => r.status === "parked" || r.status === "idle")
			: searched;

	// 3. Partition survivors into favorites vs the rest. Favorites pin to the top ONLY
	//    when at least one survivor is favorited (an empty favorites set => no pinned group).
	const favoriteRows = filtered.filter((r) => r.favorite);
	const restRows = filtered.filter((r) => !r.favorite);
	const hasFavorites = favoriteRows.length > 0;

	const groups: ShipRosterGroup[] = [];

	// Favorites group first, sorted by the chosen key, when any exist.
	if (hasFavorites) {
		groups.push({ label: "Favorites", rows: sortRows(favoriteRows, sortKey) });
	}

	// 4 + 5. The rest.
	if (filterKey === "byClass") {
		// Group the non-favorites by hull-class label, one group per class. Class groups
		// are ordered by class label A to Z; rows inside each are sorted by the chosen key.
		const byClass = new Map<string, ShipRosterRow[]>();
		for (const row of restRows) {
			const bucket = byClass.get(row.className);
			if (bucket === undefined) {
				byClass.set(row.className, [row]);
			} else {
				bucket.push(row);
			}
		}
		const classLabels = [...byClass.keys()].sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
		for (const label of classLabels) {
			groups.push({ label, rows: sortRows(byClass.get(label) ?? [], sortKey) });
		}
	} else if (restRows.length > 0) {
		// One flat group. Label it "All ships" when a Favorites group sits above it (so the
		// two headers read clearly); leave it header-less (null) when it is the only group.
		groups.push({ label: hasFavorites ? "All ships" : null, rows: sortRows(restRows, sortKey) });
	}

	return { groups };
}
