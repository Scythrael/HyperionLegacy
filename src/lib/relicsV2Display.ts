// ============================================================================
// relicsV2Display.ts: Relics v2 R2-7 / R2-8 view models (docs/plans/2026-10-17-relics-v2-plan.md section 4; the
// signed-off Relics v2 mockup, 2026-10-21 "I approve all 4 mockups as is": shelves by rarity band per tier, a hatched
// past-cap bar, culture samples under each type, an inline reveal card).
//
// PURE: every function reads GameState through the engine's own readers (relics.ts, relicBlanks.ts, tick.ts) and returns
// plain data the panels draw, so every number on screen is the engine's number. No state is written here.
// Tiers read in Roman numerals (galaxy.ts regionTierNumeral); colors are CSS tokens (--region-tier-*, --rarity-*).
// ============================================================================

import type { CompletionLogEntry, GameState, RegionTier, RelicVaultToken, TimedProcess } from "./game/model";
import { labTier } from "./game/model";
import {
  CULTURE_ROSTER,
  CULTURE_CONTENT,
  CULTURE_STUDY_POINTS,
  RELIC_BANDS,
  RELIC_SOFT_CAP,
  REGION_TIER_LIST,
  MUSEUM_STATS,
  cultureCode,
  cultureIsNamed,
  cultureListName,
  cultureTier,
  exceptionalSetsOfTier,
  generalRelicSampleName,
  getExceptionalPieceById,
  getExceptionalSetById,
  getRelicTypeById,
  museumActiveRecord,
  museumBonusesFromRecord,
  museumTierCurveBonuses,
  museumTierFrozen,
  museumTierTotal,
  relicBandOf,
  relicTypesInBand,
  type MuseumStat,
  type RelicBand,
} from "./game/relics";
import { vaultTokenCultureId, vaultTokenRegionTier, vaultTokenSource } from "./game/relicBlanks";
import { relicQueueOf, relicStudiesInFlight, relicStudyDurationFor, relicStudySlotCount } from "./game/tick";
import { RELIC_STUDY_LANES_BY_LAB } from "./game/relicIdentify";
import { regionTierNumeral, tierNumeral } from "./game/galaxy";
import { groundSiteLabel } from "./game/expeditionContent";
import { ancientEntriesDecoded } from "./game/dataStudy";
import { MUSEUM_STAT_LABEL, formatMuseumStatBonus, relicIcon } from "./ui/relicIcons";
import { researchUnlockedByFind } from "./relicReveal";
import type { IconName } from "./ui/icons";

// ===== Vocabulary =====

export const BAND_LABEL: Readonly<Record<RelicBand, string>> = { standard: "Standard", augmented: "Augmented", stellar: "Stellar", radiant: "Radiant" };

export function bandColor(band: RelicBand): string {
  return `var(--rarity-${band})`;
}

export function regionTierColor(tier: RegionTier): string {
  return `var(--region-tier-${tier})`;
}

export function tierLabel(tier: RegionTier): string {
  return `Tier ${regionTierNumeral(tier)}`;
}

// "Tier II · stellar blank". Pure.
export function blankTitle(token: Pick<RelicVaultToken, "tier" | "regionTier">): string {
  return `${tierLabel(vaultTokenRegionTier(token))} · ${relicBandOf(token.tier)} blank`;
}

// Where a blank came from: its site, else its source. Pure.
export function blankSourceText(token: RelicVaultToken): string {
  if (token.poiId !== undefined) return groundSiteLabel(token.poiId) ?? token.poiId;
  switch (vaultTokenSource(token)) {
    case "shortRange":
      return "a short-range mission";
    case "completion":
      return "a fully surveyed planet";
    case "grant":
      return "a reward";
    default:
      return "an expedition";
  }
}

// A general type's Museum stat(s) in words ("transit speed", "research speed and crafting quality"). Pure.
export function typeStatText(typeId: string): string {
  const stats = getRelicTypeById(typeId)?.stats ?? [];
  return stats.map((s) => MUSEUM_STAT_LABEL[s.stat]).join(" and ");
}

// Whole minutes, at least 1 ("10 min"); "1 h 35 min" past an hour. Ticks are seconds. Pure.
export function minutesText(ticks: number, tickSeconds = 1): string {
  const min = Math.max(1, Math.round((ticks * tickSeconds) / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ===== The Warehouse row: Unidentified Relics, tier x rarity =====

export interface VaultMatrixRow {
  tier: RegionTier;
  counts: Record<RelicBand, number>;
  total: number;
}
export interface VaultMatrix {
  rows: VaultMatrixRow[]; // only tiers holding a blank, Tier I first
  bandTotals: Record<RelicBand, number>;
  total: number;
}

// The vault as a region tier by rarity band count matrix. Pure.
export function vaultMatrix(vault: readonly RelicVaultToken[]): VaultMatrix {
  const zero = (): Record<RelicBand, number> => ({ standard: 0, augmented: 0, stellar: 0, radiant: 0 });
  const byTier = new Map<RegionTier, Record<RelicBand, number>>();
  const bandTotals = zero();
  for (const t of vault) {
    const tier = vaultTokenRegionTier(t);
    const band = relicBandOf(t.tier);
    const row = byTier.get(tier) ?? zero();
    row[band] += 1;
    byTier.set(tier, row);
    bandTotals[band] += 1;
  }
  const rows = REGION_TIER_LIST.filter((t) => byTier.has(t)).map((tier) => {
    const counts = byTier.get(tier)!;
    return { tier, counts, total: RELIC_BANDS.reduce((n, b) => n + counts[b], 0) };
  });
  return { rows, bandTotals, total: vault.length };
}

// The claim log's blank count by region tier ("Tier I 2, Tier II 1"), over the findings' relic tokens that reach the
// vault (the same rule summarizeExpeditionFindings counts: a token at a relic site). Empty when there is none. Pure.
export function claimedBlanksByTierText(findings: readonly { relic?: { regionTier?: RegionTier } | null; poiId?: string }[], atRelicSite: (poiId: string | undefined) => boolean): string {
  const counts = new Map<RegionTier, number>();
  for (const f of findings) {
    if (!f.relic || !atRelicSite(f.poiId)) continue;
    const t = vaultTokenRegionTier(f.relic);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return REGION_TIER_LIST.filter((t) => counts.has(t))
    .map((t) => `${tierLabel(t)} ${counts.get(t)}`)
    .join(", ");
}

// ===== The Identification tab: lanes, queue, unqueued blanks =====

export interface LaneView {
  index: number; // 1-based
  kind: "busy" | "free" | "locked";
  title?: string;
  source?: string;
  band?: RelicBand;
  durationTicks?: number;
  remainingTicks?: number;
  pct?: number;
  opensAt?: string; // "Research Lab III" for a locked lane
}

const MAX_LANES = RELIC_STUDY_LANES_BY_LAB[RELIC_STUDY_LANES_BY_LAB.length - 1].lanes;

function studyToken(p: TimedProcess): RelicVaultToken | null {
  return p.effect.type === "identifyRelic" ? p.effect.token : null;
}

// Every lane the Lab can ever run (four), each busy with its study, free, or locked with the Lab tier that opens it.
// Pure.
export function identificationLanes(state: GameState): LaneView[] {
  const studies = relicStudiesInFlight(state);
  const open = relicStudySlotCount(state);
  const out: LaneView[] = [];
  for (let i = 0; i < MAX_LANES; i++) {
    const p = studies[i];
    const token = p ? studyToken(p) : null;
    if (p && token) {
      const pct = p.durationTicks > 0 ? Math.max(0, Math.min(100, ((p.durationTicks - p.remainingTicks) / p.durationTicks) * 100)) : 100;
      out.push({ index: i + 1, kind: "busy", title: blankTitle(token), source: blankSourceText(token), band: relicBandOf(token.tier), durationTicks: p.durationTicks, remainingTicks: p.remainingTicks, pct });
    } else if (i < open) {
      out.push({ index: i + 1, kind: "free" });
    } else {
      const rung = RELIC_STUDY_LANES_BY_LAB.find((r) => r.lanes === i + 1);
      out.push({ index: i + 1, kind: "locked", opensAt: `Research Lab ${tierNumeral(rung?.level ?? 1)}` });
    }
  }
  return out;
}

export interface QueueRowView {
  token: RelicVaultToken;
  title: string;
  source: string;
  band: RelicBand;
  durationTicks: number;
}

// The identification queue in order (stale ids, whose blank left the vault, are skipped), each with the study time it
// would take if it started now (the engine's own duration seam). Pure.
export function identificationQueue(state: GameState): QueueRowView[] {
  const vault = new Map((state.relicVault ?? []).map((t) => [t.id, t] as const));
  const out: QueueRowView[] = [];
  for (const id of relicQueueOf(state)) {
    const token = vault.get(id);
    if (!token) continue;
    out.push({ token, title: blankTitle(token), source: blankSourceText(token), band: relicBandOf(token.tier), durationTicks: relicStudyDurationFor(state, state.museumV2, token) });
  }
  return out;
}

// About how long the queue takes to clear with the Lab's lanes: the queued study time plus what the running studies
// still need, shared over the lanes, rounded up (an estimate: the "about" in the header). Pure.
export function queueClearTicks(rows: readonly QueueRowView[], lanes: number, runningRemaining = 0): number {
  const sum = rows.reduce((n, r) => n + r.durationTicks, 0) + runningRemaining;
  return lanes > 0 ? Math.ceil(sum / lanes) : sum;
}

// The vault blanks NOT in the queue, highest region tier first, then rarest. Pure.
export function unqueuedBlanks(state: GameState): RelicVaultToken[] {
  const queued = new Set(relicQueueOf(state));
  const rank = (t: RelicVaultToken) => vaultTokenRegionTier(t) * 10 + RELIC_BANDS.indexOf(relicBandOf(t.tier));
  return (state.relicVault ?? []).filter((t) => !queued.has(t.id)).sort((a, b) => rank(b) - rank(a));
}

// The Lab tier as players read it ("Research Lab V"), or null before it is built. Pure.
export function labLabel(state: GameState): string | null {
  const level = labTier(state);
  return level >= 1 ? `Research Lab ${tierNumeral(level)}` : null;
}

// ===== The reveal card (the inline reveal) =====

export interface RelicRevealV2 {
  recordId: string;
  kind: "general" | "exceptional";
  id: string; // the general type id or the exceptional piece id
  title: string; // the type's name, or the piece's approved name (named on reveal, call 8)
  flavor: string;
  tier: RegionTier;
  glyph: IconName;
  color: string;
  subtitle: string;
  effect: string;
  progress: string;
  firstFind: boolean;
  researchUnlocked: string[];
  cultureRevealed: string | null; // "the Halvessi" when this find's point revealed the culture's name
}

// The reveal card of one completed study, from its completion record (the authoritative id), the post-completion state,
// the studied blank (its tier and culture) and the cultures named before it landed. null for an unknown id. Pure.
export function buildRelicRevealV2(
  state: GameState,
  record: Pick<CompletionLogEntry, "id" | "subjectKey">,
  firstFind: boolean,
  token: RelicVaultToken | null,
  namedBefore: ReadonlySet<string>,
): RelicRevealV2 | null {
  const id = record.subjectKey;
  if (id === null) return null;
  const museum = state.museumV2;
  const piece = getExceptionalPieceById(id);
  if (piece) {
    const set = getExceptionalSetById(piece.setId)!;
    const held = set.pieces.filter((p) => (museum.exceptional[p.id] ?? 0) > 0).length;
    const copies = museum.exceptional[id] ?? 0;
    const complete = museum.setsCompleted.includes(set.id);
    return {
      recordId: record.id,
      kind: "exceptional",
      id,
      title: piece.label,
      flavor: piece.flavor,
      tier: set.tier,
      glyph: "exceptional",
      color: regionTierColor(set.tier),
      subtitle: `Exceptional find · ${set.label} · ${tierLabel(set.tier)}`,
      effect:
        copies > 1
          ? `A duplicate: it counts toward ${tierLabel(set.tier)}'s total and adds no bonus.`
          : `${formatMuseumStatBonus(piece.stat, piece.value)} while held.`,
      progress: complete ? `${set.label} complete: ${held} of ${set.pieces.length}, full set ${formatMuseumStatBonus(set.fullSet[0].stat, set.fullSet[0].value)}.` : `${set.label} now ${held} of ${set.pieces.length}.`,
      firstFind,
      researchUnlocked: [],
      cultureRevealed: null,
    };
  }
  const type = getRelicTypeById(id);
  if (!type) return null;
  const tier = token ? vaultTokenRegionTier(token) : 1;
  const cultureId = token ? vaultTokenCultureId(state, token) : null;
  const band = type.band;
  let subtitle = `${tierLabel(tier)} · ${band}`;
  let progress = "";
  let cultureRevealed: string | null = null;
  if (cultureId !== null) {
    const named = cultureIsNamed(museum, cultureId);
    subtitle += named ? ` · ${generalRelicSampleName(museum, cultureId, id)}` : ` · reads as ${generalRelicSampleName(museum, cultureId, id)}`;
    const points = museum.cultures[cultureId]?.points ?? 0;
    if (named && !namedBefore.has(cultureId)) {
      // The reveal box on the card says it (progress stays empty so it is not said twice).
      cultureRevealed = `the ${CULTURE_CONTENT[cultureId]?.name ?? cultureListName(museum, cultureId)}`;
    } else if (named) {
      progress = `A find of ${cultureListName(museum, cultureId)}.`;
    } else {
      progress = `Culture ${cultureCode(cultureId)} study ${Math.min(points, CULTURE_STUDY_POINTS)} / ${CULTURE_STUDY_POINTS}.`;
    }
  }
  return {
    recordId: record.id,
    kind: "general",
    id,
    title: type.label,
    flavor: type.flavor,
    tier,
    glyph: relicIcon(id),
    color: bandColor(band),
    subtitle,
    effect: `Adds a ${tierLabel(tier)} copy: ${typeStatText(id)}.`,
    progress,
    firstFind,
    researchUnlocked: researchUnlockedByFind(id, firstFind),
    cultureRevealed,
  };
}

// The last `n` identifications from the completed-events record, newest first: the type or piece name and its glyph.
// Pure.
export function recentIdentifications(state: GameState, n = 6): { id: string; recordId: string; label: string; glyph: IconName; exceptional: boolean }[] {
  const out: { id: string; recordId: string; label: string; glyph: IconName; exceptional: boolean }[] = [];
  const log = state.completionLog ?? [];
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
    const e = log[i];
    if (e.kind !== "relicStudy" || e.reward !== "relic" || e.subjectKey === null) continue;
    const piece = getExceptionalPieceById(e.subjectKey);
    const type = getRelicTypeById(e.subjectKey);
    if (!piece && !type) continue;
    out.push({ id: e.subjectKey, recordId: e.id, label: piece ? piece.label : type!.label, glyph: piece ? "exceptional" : relicIcon(e.subjectKey), exceptional: !!piece });
  }
  return out;
}

// ===== The Museum v2 page =====

export interface MuseumSampleView {
  cultureId: string;
  name: string; // "Relic Sample K17-42" or "Halvessi Glyph Tablet"
  cultureName: string; // "Culture K-17" or "Halvessi"
  count: number;
}
export interface MuseumTypeView {
  id: string;
  label: string;
  flavor: string;
  glyph: IconName;
  statText: string;
  count: number; // live copies at this tier (call 4: they keep counting past the cap)
  opensAt: RegionTier | null; // the type's first tier when it is above this one (the tier stagger), else null
  samples: MuseumSampleView[];
}
export interface MuseumBandView {
  band: RelicBand;
  label: string;
  types: MuseumTypeView[];
}
export interface ExceptionalPieceView {
  id: string;
  label: string | null; // null until held (a piece is named on reveal)
  flavor: string | null;
  statText: string;
  copies: number;
}
export interface ExceptionalSetView {
  id: string;
  label: string;
  flavor: string;
  tier: RegionTier;
  held: number;
  size: number;
  complete: boolean;
  pieces: ExceptionalPieceView[];
  fullSetText: string;
}
export interface MuseumTierView {
  tier: RegionTier;
  total: number;
  frozen: boolean;
  fillPct: number;
  overPct: number;
  capPct: number;
  untilCap: number;
  pastCap: number;
  bonuses: string[]; // this tier's own bonus lines (the record the regular game reads)
  bands: MuseumBandView[];
  sets: ExceptionalSetView[];
}

// One region tier's Museum shelf. `bonuses` reads exactly what the engine reads for the tier (museumActiveRecord: the
// snapshot once the tier is frozen): Tier I through the v1 set math (kept, R2-4), Tiers II to VII through the D23 curve.
// The exceptional pieces' flat bonuses are shown on their own set cards. Pure.
export function museumTierView(state: GameState, tier: RegionTier): MuseumTierView {
  const museum = state.museumV2;
  const total = museumTierTotal(museum, tier);
  const frozen = museumTierFrozen(museum, tier);
  const scale = Math.max(RELIC_SOFT_CAP, total) * 1.08;
  const active = museumActiveRecord(museum, tier);
  const bonus = tier === 1 ? museumBonusesFromRecord(active) : museumTierCurveBonuses(active, tier as 2 | 3 | 4 | 5 | 6 | 7);
  const live = museum.general[String(tier) as keyof typeof museum.general] ?? {};
  const roster = CULTURE_ROSTER[tier];
  const bands: MuseumBandView[] = RELIC_BANDS.map((band) => ({
    band,
    label: BAND_LABEL[band],
    types: relicTypesInBand(band).map((t) => {
      const samples: MuseumSampleView[] = [];
      for (const c of roster) {
        const n = museum.cultures[c]?.finds[t.id] ?? 0;
        if (n > 0) samples.push({ cultureId: c, name: generalRelicSampleName(museum, c, t.id), cultureName: cultureListName(museum, c), count: n });
      }
      return {
        id: t.id,
        label: t.label,
        flavor: t.flavor,
        glyph: relicIcon(t.id),
        statText: typeStatText(t.id),
        count: live[t.id] ?? 0,
        opensAt: t.firstTier > tier ? t.firstTier : null,
        samples,
      };
    }),
  }));
  return {
    tier,
    total,
    frozen,
    fillPct: (Math.min(total, RELIC_SOFT_CAP) / scale) * 100,
    overPct: total > RELIC_SOFT_CAP ? ((total - RELIC_SOFT_CAP) / scale) * 100 : 0,
    capPct: (RELIC_SOFT_CAP / scale) * 100,
    untilCap: Math.max(0, RELIC_SOFT_CAP - total),
    pastCap: Math.max(0, total - RELIC_SOFT_CAP),
    bonuses: MUSEUM_STATS.filter((s: MuseumStat) => bonus[s] > 0).map((s) => formatMuseumStatBonus(s, bonus[s])),
    bands,
    sets: exceptionalSetViews(state, tier),
  };
}

// The exceptional set cards of one region tier: each piece named once held (else "not found yet"), its stat and value,
// duplicates counted (call 7), the full-set bonus and whether it is active. Pure.
export function exceptionalSetViews(state: GameState, tier: RegionTier): ExceptionalSetView[] {
  const held = state.museumV2.exceptional;
  return exceptionalSetsOfTier(tier).map((set) => {
    const pieces = set.pieces.map((p) => {
      const copies = held[p.id] ?? 0;
      return { id: p.id, label: copies > 0 ? p.label : null, flavor: copies > 0 ? p.flavor : null, statText: formatMuseumStatBonus(p.stat, p.value), copies };
    });
    const have = pieces.filter((p) => p.copies > 0).length;
    return {
      id: set.id,
      label: set.label,
      flavor: set.flavor,
      tier: set.tier,
      held: have,
      size: set.pieces.length,
      complete: have === set.pieces.length,
      pieces,
      fullSetText: set.fullSet.map((b) => formatMuseumStatBonus(b.stat, b.value)).join(", "),
    };
  });
}

// Every exceptional piece held, of the 54. Pure.
export function exceptionalPiecesHeld(state: GameState): number {
  return Object.values(state.museumV2.exceptional).filter((n) => n > 0).length;
}

// Every general copy the Museum holds, over every tier. Pure.
export function generalCopiesTotal(state: GameState): number {
  let n = 0;
  for (const rec of Object.values(state.museumV2.general)) for (const c of Object.values(rec ?? {})) n += c > 0 ? c : 0;
  return n;
}

// ===== The Cultures tab =====

export interface CultureRowView {
  id: string;
  tier: RegionTier;
  name: string; // the bare name once revealed, else "Culture K-17"
  named: boolean;
  points: number;
}

// Every culture the fleet has met (a study point or a find), Tier I first, in roster order. Pure.
export function cultureRows(state: GameState): CultureRowView[] {
  const museum = state.museumV2;
  const out: CultureRowView[] = [];
  for (const tier of REGION_TIER_LIST) {
    for (const id of CULTURE_ROSTER[tier]) {
      const rec = museum.cultures[id];
      if (!rec && !cultureIsNamed(museum, id)) continue;
      out.push({ id, tier, name: cultureListName(museum, id), named: cultureIsNamed(museum, id), points: rec?.points ?? 0 });
    }
  }
  return out;
}

export interface CultureDetailView {
  id: string;
  tier: RegionTier;
  title: string;
  code: string;
  named: boolean;
  lore: string | null; // shown once the culture is identified (structure answer 4)
  points: number;
  fromFinds: number;
  fromData: number;
  toGo: number;
  finds: { typeId: string; glyph: IconName; name: string; typeLabel: string; count: number }[];
  decoded: number;
}

// One culture's detail. Pure.
export function cultureDetail(state: GameState, cultureId: string): CultureDetailView {
  const museum = state.museumV2;
  const rec = museum.cultures[cultureId] ?? { points: 0, finds: {} };
  const named = cultureIsNamed(museum, cultureId);
  const fromFinds = Object.values(rec.finds).reduce((a, b) => a + b, 0);
  return {
    id: cultureId,
    tier: cultureTier(cultureId) ?? 1,
    title: cultureListName(museum, cultureId),
    code: cultureCode(cultureId),
    named,
    lore: named ? (CULTURE_CONTENT[cultureId]?.lore ?? null) : null,
    points: rec.points,
    fromFinds,
    fromData: Math.max(0, rec.points - fromFinds),
    toGo: Math.max(0, CULTURE_STUDY_POINTS - rec.points),
    finds: Object.entries(rec.finds)
      .filter(([, n]) => n > 0)
      .map(([typeId, count]) => ({ typeId, glyph: relicIcon(typeId), name: generalRelicSampleName(museum, cultureId, typeId), typeLabel: getRelicTypeById(typeId)?.label ?? typeId, count })),
    decoded: ancientEntriesDecoded(state, cultureId),
  };
}
