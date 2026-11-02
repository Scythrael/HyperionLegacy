// complementTableDisplay.ts: the pure display logic behind the Complement tab's CREW GROUPS table, the Graduate
// confirm and the MANIFEST (0.14.0 CP-9, docs/plans/2026-10-14-complement-and-acquisition-plan.md; signed mockup
// docs/mockups/2026-11-02-cp9-complement-manifest-mockup.html, user picks 2026-11-02: chips for sort and filter, one
// chip per buff, Graduate on each row, a paged read-only manifest).
//
// WHY its own module: the repo has no Svelte component test harness, so every decision the panel makes (group names,
// sort orders, filter counts, buff chip kinds, the selection summary, the manifest page and its pager) lives here as
// plain functions with tests. ComplementPanel.svelte only draws what these return. Pure: reads state, never mutates.

import type { CrewBucket, CrewProfession, CrewRace, CrewRank, CrewRarity, CrewSignature, GameState, NotableCrewMember } from "./game/model";
import { CREW_PROFESSIONS } from "./game/commandStructure";
import { signatureKey } from "./game/crew";
import { crewRankLabel } from "./game/crewRank";
import { CREW_RACES } from "./game/crewRaces";
import { crewBuffLabel, isHeldCrewBuff, SECOND_LEVEL_EXCLUSIVE } from "./game/crewBuffs";
import { manifestRows } from "./game/crewGraduation";

// Division display labels (US English), keyed by CrewProfession.
export const DIVISION_LABEL: Record<CrewProfession, string> = {
  security: "Security",
  engineering: "Engineering",
  science: "Science",
  medical: "Medical",
  operations: "Operations",
  flightDeck: "Flight Deck",
};

// Crew rarity labels and their order (low to high), for the Rarity column and its sort.
export const CREW_RARITY_LABEL: Record<CrewRarity, string> = {
  derelict: "Derelict",
  standard: "Standard",
  augmented: "Augmented",
  stellar: "Stellar",
  radiant: "Radiant",
  luminous: "Luminous",
  constellar: "Constellar",
};
const RARITY_ORDER: Record<CrewRarity, number> = {
  derelict: 0,
  standard: 1,
  augmented: 2,
  stellar: 3,
  radiant: 4,
  luminous: 5,
  constellar: 6,
};

export function raceLabel(race: CrewRace | string): string {
  return CREW_RACES[race as CrewRace]?.label ?? race;
}

// "Vael science group", "Station-born flight deck group": a group's name, from its origin and division.
export function crewGroupName(race: CrewRace | string, profession: CrewProfession): string {
  return `${raceLabel(race)} ${DIVISION_LABEL[profession].toLowerCase()} group`;
}

// ============================================================================
// Buff chips (every buff a crewmember carries, buff1 to buff3)
// ============================================================================

// profession: a division pool buff (green); exclusive: a second-level ship-wide buff (cyan, a diamond); held: in the
// catalog but on hold, contributing nothing (dashed; crewBuffs.ts HELD_CREW_BUFF_IDS).
export type BuffChipKind = "profession" | "exclusive" | "held";
export interface BuffChip {
  id: string;
  label: string;
  kind: BuffChipKind;
  title: string; // the hover text, saying what the kind means
}

const EXCLUSIVE_IDS: ReadonlySet<string> = new Set(SECOND_LEVEL_EXCLUSIVE.map((d) => d.id));

export function buffChip(id: string): BuffChip {
  const label = crewBuffLabel(id);
  if (isHeldCrewBuff(id)) return { id, label, kind: "held", title: "On hold: does nothing on ship crew" };
  if (EXCLUSIVE_IDS.has(id)) return { id, label, kind: "exclusive", title: "Second-level exclusive buff: ship-wide" };
  return { id, label, kind: "profession", title: "Division buff" };
}

// Every buff of a signature, in order: buff1, then buff2 when present, then buff3 when present.
export function buffChips(sig: Pick<CrewSignature, "buff1Id" | "buff2Id" | "buff3Id">): BuffChip[] {
  const ids = [sig.buff1Id, ...(sig.buff2Id ? [sig.buff2Id] : []), ...(sig.buff3Id ? [sig.buff3Id] : [])];
  return ids.map(buffChip);
}

// ============================================================================
// The crew groups table
// ============================================================================

export interface CrewGroupRow {
  key: string; // crew.ts signatureKey: the bucket's identity
  order: number; // the bucket's place in the complement (the stable tie-break)
  sig: CrewSignature; // the bucket's signature (the Graduate confirm previews the name from it)
  name: string;
  profession: CrewProfession;
  divisionLabel: string;
  rank: CrewRank;
  rankLabel: string;
  rarity: CrewRarity;
  rarityLabel: string;
  race: CrewRace;
  buffs: BuffChip[];
  count: number;
}

// One row per non-empty bucket of a ship's bulk complement (notables are not groups; they have their own cards).
export function crewGroupRows(buckets: readonly CrewBucket[]): CrewGroupRow[] {
  const rows: CrewGroupRow[] = [];
  const byKey = new Map<string, CrewGroupRow>();
  buckets.forEach((b, i) => {
    if (b.count <= 0) return;
    // Two buckets with one signature (never made by the engine's merge, but legal in a save) read as one group.
    const key = signatureKey(b);
    const seen = byKey.get(key);
    if (seen) {
      seen.count += b.count;
      return;
    }
    const row: CrewGroupRow = {
      key,
      order: i,
      sig: {
        profession: b.profession,
        rarity: b.rarity,
        rank: b.rank,
        race: b.race,
        buff1Id: b.buff1Id,
        buff2Id: b.buff2Id,
        ...(b.buff3Id !== undefined ? { buff3Id: b.buff3Id } : {}),
      },
      name: crewGroupName(b.race, b.profession),
      profession: b.profession,
      divisionLabel: DIVISION_LABEL[b.profession],
      rank: b.rank,
      rankLabel: crewRankLabel(b.rank),
      rarity: b.rarity,
      rarityLabel: CREW_RARITY_LABEL[b.rarity] ?? b.rarity,
      race: b.race,
      buffs: buffChips(b),
      count: b.count,
    };
    byKey.set(key, row);
    rows.push(row);
  });
  return rows;
}

export type GroupSort = "rank" | "rarity" | "division" | "count";
export const GROUP_SORTS: readonly { id: GroupSort; label: string }[] = [
  { id: "rank", label: "Rank" },
  { id: "rarity", label: "Rarity" },
  { id: "division", label: "Division" },
  { id: "count", label: "Count" },
];

const divisionIndex = (p: CrewProfession): number => CREW_PROFESSIONS.indexOf(p);

// Sort a copy: Rank (highest first), Rarity (rarest first), Division (the game's division order, then highest rank),
// Count (largest first). Every tie falls back to rank, rarity, division and finally the complement's own order, so a
// sort is stable and never shuffles on a re-render.
export function sortCrewGroups(rows: readonly CrewGroupRow[], sort: GroupSort): CrewGroupRow[] {
  const byRank = (a: CrewGroupRow, b: CrewGroupRow) => b.rank - a.rank;
  const byRarity = (a: CrewGroupRow, b: CrewGroupRow) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity];
  const byDivision = (a: CrewGroupRow, b: CrewGroupRow) => divisionIndex(a.profession) - divisionIndex(b.profession);
  const byCount = (a: CrewGroupRow, b: CrewGroupRow) => b.count - a.count;
  const chains: Record<GroupSort, ((a: CrewGroupRow, b: CrewGroupRow) => number)[]> = {
    rank: [byRank, byRarity, byDivision],
    rarity: [byRarity, byRank, byDivision],
    division: [byDivision, byRank, byRarity],
    count: [byCount, byRank, byRarity, byDivision],
  };
  const chain = chains[sort];
  return [...rows].sort((a, b) => {
    for (const cmp of chain) {
      const d = cmp(a, b);
      if (d !== 0) return d;
    }
    return a.order - b.order;
  });
}

// null = every division.
export function filterCrewGroups(rows: readonly CrewGroupRow[], division: CrewProfession | null): CrewGroupRow[] {
  return division === null ? [...rows] : rows.filter((r) => r.profession === division);
}

// How many GROUPS each division holds (the filter chips' small numbers), plus "all".
export function divisionGroupCounts(rows: readonly CrewGroupRow[]): { all: number; byDivision: Record<CrewProfession, number> } {
  const byDivision = Object.fromEntries(CREW_PROFESSIONS.map((p) => [p, 0])) as Record<CrewProfession, number>;
  for (const r of rows) byDivision[r.profession] += 1;
  return { all: rows.length, byDivision };
}

// The selection bar: how many ticked groups still exist and how many crew they hold.
export function selectionSummary(rows: readonly CrewGroupRow[], selected: ReadonlySet<string>): { groups: number; crew: number } {
  let groups = 0;
  let crew = 0;
  for (const r of rows) {
    if (!selected.has(r.key)) continue;
    groups += 1;
    crew += r.count;
  }
  return { groups, crew };
}

// The header tick box over the rows in view: none, some (mixed) or all ticked.
export function headerTickState(rows: readonly CrewGroupRow[], selected: ReadonlySet<string>): "none" | "some" | "all" {
  if (rows.length === 0) return "none";
  const n = rows.filter((r) => selected.has(r.key)).length;
  return n === 0 ? "none" : n === rows.length ? "all" : "some";
}

// The table shows this many groups first, then this many more per "Show more".
export const GROUP_PAGE_STEP = 25;

// ============================================================================
// The manifest (read-only, one paged list; names generated for the page in view only)
// ============================================================================

export const MANIFEST_PAGE_SIZE = 50;

export type ManifestLine =
  | { kind: "group"; key: string; title: string; rankLabel: string; count: number }
  | {
      kind: "row";
      number: number; // 1-based place in the (filtered) list
      name: string;
      rankLabel: string;
      divisionLabel: string;
      originLabel: string;
      rarity: CrewRarity;
      rarityLabel: string;
      buffs: BuffChip[];
    };

export interface ManifestNotableLine {
  id: string;
  name: string;
  rankLabel: string;
  divisionLabel: string;
  originLabel: string;
  rarity: CrewRarity;
  rarityLabel: string;
  buffs: BuffChip[];
}

export interface ManifestView {
  page: number; // 0-based, clamped
  pageCount: number; // at least 1
  total: number; // bulk crew in the filter (the paged rows)
  from: number; // 1-based first row on the page (0 when empty)
  to: number; // 1-based last row on the page
  lines: ManifestLine[];
  notables: ManifestNotableLine[]; // the ship's notables in the filter, listed first on page 1 only
  notableTotal: number; // the ship's notables in the filter, on every page
}

export function manifestPageCount(total: number, size: number = MANIFEST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

// One manifest page: the ship's notables first (page 1 only, with their saved names), then MANIFEST_PAGE_SIZE rows of
// generated names in complement order, a group header before each group's first row on the page. Only the page in view
// is generated (crewGraduation.ts manifestRows), so a 900-crew ship opens as fast as a 50-crew one.
export function manifestView(state: GameState, shipId: string, page: number, division: CrewProfession | null): ManifestView {
  const buckets = state.ships.find((s) => s.id === shipId)?.complement?.buckets ?? [];
  const countByKey = new Map<string, number>();
  for (const b of buckets) if (b.count > 0) countByKey.set(signatureKey(b), (countByKey.get(signatureKey(b)) ?? 0) + b.count);
  const total = manifestRows(state, shipId, 0, 0, division).total;
  const pageCount = manifestPageCount(total);
  const p = Math.max(0, Math.min(pageCount - 1, Math.floor(Number.isFinite(page) ? page : 0)));
  const { rows } = manifestRows(state, shipId, p * MANIFEST_PAGE_SIZE, MANIFEST_PAGE_SIZE, division);
  const lines: ManifestLine[] = [];
  let lastKey: string | null = null;
  for (const r of rows) {
    if (r.signatureKey !== lastKey) {
      lines.push({
        kind: "group",
        key: r.signatureKey,
        title: crewGroupName(r.race, r.profession),
        rankLabel: crewRankLabel(r.rank),
        count: countByKey.get(r.signatureKey) ?? 0,
      });
      lastKey = r.signatureKey;
    }
    lines.push({
      kind: "row",
      number: r.index + 1,
      name: r.name,
      rankLabel: crewRankLabel(r.rank),
      divisionLabel: DIVISION_LABEL[r.profession],
      originLabel: raceLabel(r.race),
      rarity: r.rarity,
      rarityLabel: CREW_RARITY_LABEL[r.rarity] ?? r.rarity,
      buffs: buffChips(r),
    });
  }
  const shipNotables = state.notableCrew.filter(
    (n) => (n.assignedShipId ?? null) === shipId && (division === null || n.profession === division),
  );
  return {
    page: p,
    pageCount,
    total,
    from: rows.length === 0 ? 0 : p * MANIFEST_PAGE_SIZE + 1,
    to: p * MANIFEST_PAGE_SIZE + rows.length,
    lines,
    notables: p === 0 ? shipNotables.map(notableLine) : [],
    notableTotal: shipNotables.length,
  };
}

export function notableLine(n: NotableCrewMember): ManifestNotableLine {
  return {
    id: n.id,
    name: n.name,
    rankLabel: crewRankLabel(n.rank),
    divisionLabel: DIVISION_LABEL[n.profession],
    originLabel: raceLabel(n.race),
    rarity: n.rarity,
    rarityLabel: CREW_RARITY_LABEL[n.rarity] ?? n.rarity,
    buffs: buffChips(n),
  };
}

// The pager's buttons for page `page` (0-based) of `count`: the first, the last, and the pages around the current one,
// with a gap where pages are skipped ("1 2 3 ... 16"). Every number is 0-based; the panel shows number + 1.
export function pagerItems(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const keep = new Set<number>([0, count - 1, page - 1, page, page + 1]);
  if (page <= 2) [1, 2, 3].forEach((i) => keep.add(i));
  if (page >= count - 3) [count - 4, count - 3, count - 2].forEach((i) => keep.add(i));
  const sorted = [...keep].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((i, j) => {
    if (j > 0 && i - sorted[j - 1] > 1) out.push("gap");
    out.push(i);
  });
  return out;
}
