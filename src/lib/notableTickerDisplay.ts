// notableTickerDisplay.ts: the pure display logic behind the fleet-wide NOTABLE CREW band under the Personnel tab row
// (0.14.0, signed mockup docs/mockups/2026-11-12-personnel-notable-ticker-mockup.html, option A; the user's answers
// in docs/plans/2026-10-14-complement-and-acquisition-plan.md "USER ANSWERS (2026-11-12 afternoon)").
//
// What the band shows comes straight from the engine, nothing new: each notable's name, rank, division and ship (or
// "Unassigned"), the favorite star, and the fleet's count against NOTABLE_CREW_CAP. Notable crew have no titles or
// milestones in the engine, so none are shown. The record card adds the origin and the buffs.
//
// ORDER (the user's "favorites first, then the rest"): favorites first, then every other notable; inside each part
// the GRADUATION order, oldest first. Graduation order is read from the notable id's number (crewGraduation.ts
// graduateStandout names each graduate `notable-<nextNotableId>`, and nextNotableId only grows), so it does not
// depend on how the list is stored; an id without a number sorts after the numbered ones by its text, and a full tie
// keeps the stored order. Unassigned notables sit in place among the others.
//
// WHY its own module: the repo has no Svelte component test harness, so every decision NotableTicker.svelte makes
// lives here as plain functions with tests. Pure: reads state, never mutates.

import { NOTABLE_CREW_CAP, shipDisplayLabels, type GameState, type NotableCrewMember } from "./game/model";
import { crewRankLabel } from "./game/crewRank";
import { DIVISION_LABEL, buffChips, raceLabel, type BuffChip } from "./complementTableDisplay";

export const UNASSIGNED_LABEL = "Unassigned";

// The hover text of Send back and Retire, shared by the Complement strip's cards and the band's record card.
export const NOTABLE_SEND_BACK_TITLE = "Unassign from this ship. They keep their name, and a Personnel roster can assign them to a ship again.";
export const NOTABLE_RETIRE_TITLE = "Retire from the fleet with your thanks. No penalty, and it frees a notable slot.";

// The empty band's hint. True to the engine: the only way a notable is made is crewGraduation.ts graduateStandout,
// the "Graduate one" button on a crew group of a ship's Complement tab.
export const NOTABLE_TICKER_EMPTY_HINT = "No notable crew yet. On a ship's Complement tab, use Graduate one on a crew group to name a standout.";

export interface NotableTickerEntry {
  id: string;
  name: string;
  rankLabel: string;
  divisionLabel: string;
  originLabel: string; // shown in the All list only (the band entry is name, rank, division, ship)
  shipId: string | null; // null when unassigned (or its ship is gone)
  shipLabel: string; // the ship's display label, or UNASSIGNED_LABEL
  favorite: boolean;
  ariaLabel: string; // the entry button's accessible name
}

// The number in a notable id ("notable-12" -> 12), or null when it has none. Pure.
export function notableIdNumber(id: string): number | null {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

// Graduation order, oldest first (see the header). Stable on a full tie (Array.prototype.sort is stable).
function byGraduation(a: NotableCrewMember, b: NotableCrewMember): number {
  const na = notableIdNumber(a.id);
  const nb = notableIdNumber(b.id);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na !== null && nb === null) return -1;
  if (na === null && nb !== null) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Favorites first, then the rest; each part in graduation order. Pure, returns a new list.
export function orderNotables(notables: readonly NotableCrewMember[]): NotableCrewMember[] {
  const sorted = [...notables].sort(byGraduation);
  return [...sorted.filter((n) => n.favorite === true), ...sorted.filter((n) => n.favorite !== true)];
}

// The ship a notable is aboard, or null: unassigned, or (defensively) a ship no longer in the fleet. Pure.
function shipOf(labels: Map<string, string>, n: NotableCrewMember): string | null {
  const id = n.assignedShipId ?? null;
  return id !== null && labels.has(id) ? id : null;
}

// Every notable in the fleet as a band entry, in the band's order. Pure.
export function notableTickerEntries(state: GameState): NotableTickerEntry[] {
  const labels = shipDisplayLabels(state.ships);
  return orderNotables(state.notableCrew).map((n) => {
    const shipId = shipOf(labels, n);
    const shipLabel = shipId === null ? UNASSIGNED_LABEL : labels.get(shipId)!;
    const rankLabel = crewRankLabel(n.rank);
    const divisionLabel = DIVISION_LABEL[n.profession];
    const favorite = n.favorite === true;
    const where = shipId === null ? UNASSIGNED_LABEL : `aboard ${shipLabel}`;
    return {
      id: n.id,
      name: n.name,
      rankLabel,
      divisionLabel,
      originLabel: raceLabel(n.race),
      shipId,
      shipLabel,
      favorite,
      ariaLabel: `${n.name}, ${rankLabel}, ${divisionLabel}, ${where}${favorite ? ", favorite" : ""}. Open the record.`,
    };
  });
}

// The band label's count: "12 / 50", at the cap in the warning color (the same fact the Graduate button refuses on).
export interface NotableTickerCount {
  count: number;
  cap: number;
  text: string;
  atCap: boolean;
  title: string;
}
export function notableTickerCount(state: GameState): NotableTickerCount {
  const count = state.notableCrew.length;
  return {
    count,
    cap: NOTABLE_CREW_CAP,
    text: `${count} / ${NOTABLE_CREW_CAP}`,
    atCap: count >= NOTABLE_CREW_CAP,
    title: `Notable crew in the fleet, assigned or not, against the cap of ${NOTABLE_CREW_CAP}`,
  };
}

// The All list: everyone, grouped by ship (ships by label, A to Z, then by id), Unassigned last; inside a group the
// band's order. Pure.
export interface NotableAllGroup {
  key: string; // the ship id, or "" for Unassigned
  label: string;
  entries: NotableTickerEntry[];
}
export function notableAllGroups(entries: readonly NotableTickerEntry[]): NotableAllGroup[] {
  const groups = new Map<string, NotableAllGroup>();
  for (const e of entries) {
    const key = e.shipId ?? "";
    let g = groups.get(key);
    if (!g) {
      g = { key, label: e.shipLabel, entries: [] };
      groups.set(key, g);
    }
    g.entries.push(e);
  }
  const ships = [...groups.values()].filter((g) => g.key !== "");
  ships.sort((a, b) => a.label.localeCompare(b.label, "en") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const un = groups.get("");
  return un ? [...ships, un] : ships;
}

// The record card for one notable, or null when it is gone (retired). Pure.
export interface NotableRecordView {
  id: string;
  name: string;
  favorite: boolean;
  subLine: string; // "Lieutenant · Science · Vael"
  buffs: BuffChip[];
  shipId: string | null;
  shipLabel: string;
}
export function notableRecordView(state: GameState, notableId: string): NotableRecordView | null {
  const n = state.notableCrew.find((x) => x.id === notableId);
  if (!n) return null;
  const labels = shipDisplayLabels(state.ships);
  const shipId = shipOf(labels, n);
  return {
    id: n.id,
    name: n.name,
    favorite: n.favorite === true,
    subLine: `${crewRankLabel(n.rank)} · ${DIVISION_LABEL[n.profession]} · ${raceLabel(n.race)}`,
    buffs: buffChips(n),
    shipId,
    shipLabel: shipId === null ? UNASSIGNED_LABEL : labels.get(shipId)!,
  };
}
