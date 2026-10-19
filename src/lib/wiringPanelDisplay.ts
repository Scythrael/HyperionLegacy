// WR-3 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md): the Debug "Wiring" panel's view model.
//
// For the CURRENT save, every wiring registry entry (src/lib/game/wiring/registry.ts) becomes one row: its source,
// whether this save owns it (allocated, seated, installed, built), its status chip (live, pending, deferred, held,
// seam), its contexts, and its LIVE CONTRIBUTION: the entry's seam probe read on the save vs the same save without
// the source, beside the value the entry's curve expects at the catalog magnitude. The user's OC-K1 answer: "Simple
// table, no mockup (Recommended)".
//
// Pure: nothing here writes state; every "without" state is a fresh copy. The registry and its probes are NEVER
// imported statically (only as types), so the app bundle does not carry them: `loadWiringDeps` imports them lazily
// when the dev opens the panel, and tests pass them in directly.
//
// What the probes read (probes.ts): ship-1, captain 1 and the fixture member ids; the panel measures those subjects
// on a live save (game/wiring/panelOwnership.ts says how, and holds the per-catalog ownership readers).

import type { Catalogs, Curve, WiringEntry, WiringStatus, WiringSystem } from "./game/wiring/registry";
import type { ContextId, ProbeId } from "./game/wiring/probes";
import { SHIP_TYPES, type GameState } from "./game/model";
import {
  PANEL_CAPTAIN_ID,
  PANEL_SHIP_ID,
  SAVE_MAGNITUDE_CATALOGS,
  ownershipOf,
  wiringProbeView,
  type Owned,
  type Ownership,
} from "./game/wiring/panelOwnership";

// The ownership side (one reader per registry catalog) lives in game/wiring/panelOwnership.ts; re-exported here so
// the panel and its tests have one entry point.
export {
  CONTENT_CATALOGS,
  PANEL_CAPTAIN_ID,
  PANEL_SCIENCE_ID,
  PANEL_SECURITY_ID,
  PANEL_SHIP_ID,
  SAVE_MAGNITUDE_CATALOGS,
  UNMEASURED_CATALOGS,
  catalogClassified,
  ownershipOf,
  wiringProbeView,
} from "./game/wiring/panelOwnership";
export type { Owned, Ownership } from "./game/wiring/panelOwnership";

// ============================================================================
// Dependencies (the registry side, injected)
// ============================================================================

export interface WiringDeps {
  readonly registry: readonly WiringEntry[];
  readonly systems: readonly WiringSystem[];
  readonly catalogs: Catalogs;
  readonly readProbe: (id: ProbeId, s: GameState, ctx: ContextId) => number;
  readonly curveExpected: (curve: Curve, off: number, m: number, unit?: number) => number | null;
}

// The registry and its probes, imported lazily (a separate chunk; production never opens the Debug tab).
export async function loadWiringDeps(): Promise<WiringDeps> {
  const [reg, probes] = await Promise.all([import("./game/wiring/registry"), import("./game/wiring/probes")]);
  return {
    registry: reg.WIRING_REGISTRY,
    systems: reg.WIRING_SYSTEMS,
    catalogs: reg.CATALOGS,
    readProbe: probes.readProbe,
    curveExpected: reg.curveExpected,
  };
}

// ============================================================================
// Rows
// ============================================================================


// contributing: owned, and a live context moved. nothing: owned, and no live context moved (a live entry whose
// wire is broken here, or an owned source that is not live yet). info: owned, but its entry asserts no direction
// (content read verbatim, a baseline rung). unmeasured: owned, but the panel cannot take it off this save.
export type Verdict = "contributing" | "nothing" | "info" | "error" | "unmeasured" | "notOwned" | "content";

export interface StatusChip {
  readonly kind: WiringStatus["kind"];
  readonly label: string; // "live", "partial", "pending", "deferred", "held", "seam"
  readonly detail: string; // the owner and the user's reference, if any
}

export interface ContextReading {
  readonly context: ContextId;
  readonly now: number | null;
  readonly without: number | null;
  readonly expected: number | null; // the curve at the catalog magnitude, from `without`
  readonly moved: boolean;
  readonly onCurve: boolean | null; // null when the curve gives no expected value
  readonly error?: string;
}

export interface WiringRow {
  readonly id: string;
  readonly system: WiringSystem;
  readonly source: string; // "<catalog>: <key>"
  readonly claim: string;
  readonly status: StatusChip;
  readonly ownership: Ownership;
  readonly ownershipNote?: string;
  readonly probe?: string;
  readonly liveContexts: readonly ContextId[];
  readonly pendingContexts: readonly ContextId[];
  readonly outOfScope: readonly { readonly context: ContextId; readonly reason: string }[];
  readonly magnitude: number | null;
  readonly readings: readonly ContextReading[];
  readonly verdict: Verdict;
  readonly note?: string;
}

export function statusChip(status: WiringStatus): StatusChip {
  switch (status.kind) {
    case "live":
      return { kind: "live", label: "live", detail: "" };
    case "pending":
      return {
        kind: "pending",
        label: status.contexts?.length ? "partial" : "pending",
        detail: status.contexts?.length ? `${status.owner} (not yet: ${status.contexts.join(", ")})` : status.owner,
      };
    case "deferred":
      return { kind: "deferred", label: "deferred", detail: `${status.owner}; ${status.userRef}` };
    case "held":
      return { kind: "held", label: "held", detail: status.userRef };
    case "seam":
      return { kind: "seam", label: "seam", detail: `${status.owner}; ${status.userRef}` };
  }
}

function pendingContextsOf(status: WiringStatus): readonly ContextId[] {
  return status.kind === "pending" || status.kind === "deferred" ? status.contexts ?? [] : [];
}


// ============================================================================
// Measuring
// ============================================================================


// Same value: exact, to a part in a billion (the sensitivity level's exact test).
function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// One measuring pass over one save: the probe view and a memo of its own readings (shared by every entry).
export interface MeasureSession {
  readonly view: GameState;
  readonly deps: WiringDeps;
  readonly memo: Map<string, { value?: number; error?: string }>;
}

export function measureSession(save: GameState, deps: WiringDeps): MeasureSession {
  return { view: wiringProbeView(save), deps, memo: new Map() };
}

function read(session: MeasureSession, probe: ProbeId, s: GameState, ctx: ContextId): { value?: number; error?: string } {
  const cacheable = s === session.view;
  const k = `${probe}|${ctx}`;
  if (cacheable && session.memo.has(k)) return session.memo.get(k)!;
  let out: { value?: number; error?: string };
  try {
    out = { value: session.deps.readProbe(probe, s, ctx) };
  } catch (err) {
    out = { error: errorText(err) };
  }
  if (cacheable) session.memo.set(k, out);
  return out;
}

export function measureEntry(e: WiringEntry, session: MeasureSession): WiringRow {
  const { deps, view } = session;
  let magnitude: number | null = null;
  try {
    magnitude = e.magnitude(deps.catalogs);
  } catch {
    magnitude = null;
  }
  let own: Owned;
  try {
    own = ownershipOf(e, view);
  } catch (err) {
    own = { ownership: "unmeasured", note: `ownership check failed: ${errorText(err)}` };
  }
  const readings: ContextReading[] = [];
  const measurable = own.ownership === "owned" && own.measure !== false && e.probe !== undefined;
  if (measurable) {
    const withState = own.withState ?? view;
    const withoutState = own.withoutState ?? e.off(view);
    for (const ctx of e.contexts) {
      const now = read(session, e.probe!, withState, ctx);
      const without = read(session, e.probe!, withoutState, ctx);
      const error = now.error ?? without.error;
      if (error !== undefined || now.value === undefined || without.value === undefined) {
        readings.push({ context: ctx, now: now.value ?? null, without: without.value ?? null, expected: null, moved: false, onCurve: null, error });
        continue;
      }
      let expected: number | null = null;
      try {
        expected = magnitude === null || !SAVE_MAGNITUDE_CATALOGS.has(e.source.catalog) ? null : deps.curveExpected(e.curve, without.value, magnitude);
      } catch {
        expected = null;
      }
      const tol = e.tolerance;
      const onCurve =
        expected === null ? null : tol !== undefined ? Math.abs(now.value - expected) <= tol : same(now.value, expected);
      readings.push({ context: ctx, now: now.value, without: without.value, expected, moved: !same(now.value, without.value), onCurve });
    }
  }
  return {
    id: e.id,
    system: e.system,
    source: `${e.source.catalog}: ${e.source.key}`,
    claim: e.claim,
    status: statusChip(e.status),
    ownership: own.ownership,
    ...(own.note ? { ownershipNote: own.note } : {}),
    ...(e.probe ? { probe: e.probe } : {}),
    liveContexts: e.contexts,
    pendingContexts: pendingContextsOf(e.status),
    outOfScope: (e.outOfScope ?? []).map((o) => ({ context: o.context, reason: o.reason })),
    magnitude,
    readings,
    verdict: verdictOf(e, own, measurable, readings),
    ...(e.note ? { note: e.note } : e.notApplicable ? { note: e.notApplicable } : {}),
  };
}

function verdictOf(e: WiringEntry, own: Owned, measurable: boolean, readings: readonly ContextReading[]): Verdict {
  if (own.ownership !== "owned") return own.ownership;
  if (own.measure === false) return "unmeasured";
  if (readings.some((r) => r.moved)) return "contributing";
  if (readings.some((r) => r.error !== undefined)) return "error";
  // Nothing claimed to move (a baseline rung such as standard rarity), or content read verbatim: information only.
  if (e.direction === "none" || e.notApplicable || (e.status.kind === "live" && e.contexts.length === 0)) return "info";
  if (!measurable && e.status.kind === "live") return "unmeasured";
  return "nothing";
}

export function measureWiringSync(save: GameState, deps: WiringDeps): WiringRow[] {
  const session = measureSession(save, deps);
  return deps.registry.map((e) => measureEntry(e, session));
}

// The same pass in slices, yielding between them so the page stays responsive on a big save.
export async function measureWiring(
  save: GameState,
  deps: WiringDeps,
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void; yieldFn?: () => Promise<void> } = {},
): Promise<WiringRow[]> {
  const chunk = opts.chunk ?? 40;
  const yieldFn = opts.yieldFn ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const session = measureSession(save, deps);
  const rows: WiringRow[] = [];
  const total = deps.registry.length;
  for (let i = 0; i < total; i += chunk) {
    for (const e of deps.registry.slice(i, i + chunk)) rows.push(measureEntry(e, session));
    opts.onProgress?.(rows.length, total);
    if (rows.length < total) await yieldFn();
  }
  return rows;
}

// ============================================================================
// Filters, groups, text
// ============================================================================

export type WiringView = "all" | "owned" | "ownedNothing" | "pending" | "notLive";

export const WIRING_VIEW_OPTIONS: readonly { readonly key: WiringView; readonly label: string }[] = [
  { key: "all", label: "All" },
  { key: "owned", label: "Owned" },
  { key: "ownedNothing", label: "Owned but contributing nothing" },
  { key: "pending", label: "Pending (incl. partial)" },
  { key: "notLive", label: "Deferred, held, seam" },
];

export interface WiringFilter {
  readonly system: WiringSystem | "all";
  readonly view: WiringView;
  readonly search: string;
}

export function rowMatches(r: WiringRow, f: WiringFilter): boolean {
  if (f.system !== "all" && r.system !== f.system) return false;
  const q = f.search.trim().toLowerCase();
  if (q && !`${r.id} ${r.source} ${r.claim}`.toLowerCase().includes(q)) return false;
  switch (f.view) {
    case "all":
      return true;
    case "owned":
      return r.ownership === "owned";
    case "ownedNothing":
      return r.verdict === "nothing" || r.verdict === "error";
    case "pending":
      return r.status.kind === "pending";
    case "notLive":
      return r.status.kind === "deferred" || r.status.kind === "held" || r.status.kind === "seam";
  }
}

export interface WiringGroup {
  readonly system: WiringSystem;
  readonly rows: readonly WiringRow[];
  readonly owned: number;
  readonly contributing: number;
  readonly nothing: number;
}

// The rows that pass the filter, grouped by system in the registry's system order (empty groups dropped).
export function groupWiringRows(rows: readonly WiringRow[], systems: readonly WiringSystem[], f: WiringFilter): WiringGroup[] {
  const shown = rows.filter((r) => rowMatches(r, f));
  return systems
    .map((system) => {
      const inSystem = shown.filter((r) => r.system === system);
      return {
        system,
        rows: inSystem,
        owned: inSystem.filter((r) => r.ownership === "owned").length,
        contributing: inSystem.filter((r) => r.verdict === "contributing").length,
        nothing: inSystem.filter((r) => r.verdict === "nothing" || r.verdict === "error").length,
      };
    })
    .filter((g) => g.rows.length > 0);
}

export interface WiringTotals {
  readonly entries: number;
  readonly owned: number;
  readonly contributing: number;
  readonly nothing: number;
  readonly byStatus: Readonly<Record<WiringStatus["kind"], number>>;
}

export function wiringTotals(rows: readonly WiringRow[]): WiringTotals {
  const byStatus: Record<WiringStatus["kind"], number> = { live: 0, pending: 0, deferred: 0, held: 0, seam: 0 };
  for (const r of rows) byStatus[r.status.kind] += 1;
  return {
    entries: rows.length,
    owned: rows.filter((r) => r.ownership === "owned").length,
    contributing: rows.filter((r) => r.verdict === "contributing").length,
    nothing: rows.filter((r) => r.verdict === "nothing" || r.verdict === "error").length,
    byStatus,
  };
}

// Who the panel measures on this save, in words (the subjects the probes read).
export function wiringSubjectsText(save: GameState): string {
  const ship = save.ships.find((sh) => sh.id === PANEL_SHIP_ID);
  const captain = save.captains.find((c) => c.id === PANEL_CAPTAIN_ID);
  const aboard = (team: string) => save.awayMembers.find((m) => m.assignedShipId === PANEL_SHIP_ID && m.teamType === team)?.name ?? "none aboard";
  const shipText = ship ? `${ship.name?.trim() || SHIP_TYPES[ship.typeKey]?.label || ship.typeKey} (${ship.id})` : `no ${PANEL_SHIP_ID} in this fleet`;
  return `Ship: ${shipText}. Captain: ${captain ? captain.label : `no captain ${PANEL_CAPTAIN_ID}`}. Security: ${aboard("security")}. Science: ${aboard("science")}.`;
}

// A reading for the table: integers as they are, fractions to 4 significant digits.
export function formatNumber(n: number | null): string {
  if (n === null) return "n/a";
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(0);
  return Number(n.toPrecision(4)).toString();
}

// "1.05 vs 1 (+0.05, +5%)": the reading now, without the source, and the move.
export function contributionText(r: ContextReading): string {
  if (r.error !== undefined) return `probe error: ${r.error}`;
  if (r.now === null || r.without === null) return "n/a";
  const delta = r.now - r.without;
  const sign = delta > 0 ? "+" : "";
  const pct = r.without !== 0 ? `, ${sign}${formatNumber((delta / Math.abs(r.without)) * 100)}%` : "";
  return `${formatNumber(r.now)} vs ${formatNumber(r.without)} (${sign}${formatNumber(delta)}${pct})`;
}

export function expectedText(r: ContextReading): string {
  if (r.expected === null) return "n/a";
  return `${formatNumber(r.expected)}${r.onCurve === false ? " (off curve)" : r.onCurve ? " (on curve)" : ""}`;
}

export const OWNERSHIP_LABEL: Readonly<Record<Ownership, string>> = {
  owned: "owned",
  notOwned: "not owned",
  content: "content",
  unmeasured: "n/a",
};

export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  contributing: "contributing",
  nothing: "contributing nothing",
  info: "information only",
  error: "probe error",
  unmeasured: "not measurable here",
  notOwned: "",
  content: "",
};

export const SYSTEM_LABEL: Readonly<Record<WiringSystem, string>> = {
  captain: "Captain",
  fleetAdmiral: "Fleet Admiral",
  facility: "Facilities",
  ship: "Ship",
  crew: "Crew and officers",
  away: "Away team and ground",
  expedition: "Expedition content",
  relic: "Relics and the Museum",
  mission: "Missions and patrols",
  salvage: "Salvage",
};
