// ============================================================================
// notableEvents.ts: THE NOTABLE-EVENT LEDGER (0.14.0). Relics v2 R2-5 (docs/plans/2026-10-17-relics-v2-plan.md section 4
// R2-5, OC-16) built its minimal form for the 2026-10-16 decision ("The event ledger now (Recommended)": one
// notable-event ledger, read by the future achievements system, the Hall of Command and future chat); completion
// tracking (docs/plans/2026-11-13-completion-tracking-design.md, user "Hidden until chat (Recommended)") adds its second
// kind through the same append. An append-only list on GameState (notableEvents), idempotent by key, no UI.
//
// Two kinds (model.ts NOTABLE_EVENT_KINDS and the NotableEvent union):
//   - "relicSetCompleted": an exceptional relic set whole in the Museum (tick.ts, the relic study that completed it).
//   - "systemCompleted": a system with every body scanned and every objective done, written at its claim (completion.ts).
//
// Pure: no draw, no clock. An event's time is the game second it happened at, handed in by the writer.
// ============================================================================

import { NOTABLE_EVENT_KINDS, type GameState, type NotableEvent, type RegionTier } from "./model";
import { getExceptionalSetById } from "./relics";

export type { NotableEvent };

// The ledger key of a set completion (one per set, ever).
export function relicSetCompletedKey(setId: string): string {
  return `relicSetCompleted:${setId}`;
}
// The ledger key of a system completion (one per system, ever).
export function systemCompletedKey(systemId: string): string {
  return `systemCompleted:${systemId}`;
}

// The ledger (absent = empty). Pure.
export function notableEventsOf(state: Pick<GameState, "notableEvents">): readonly NotableEvent[] {
  return state.notableEvents ?? [];
}

// One set completion event. Pure.
export function relicSetCompletedEvent(setId: string, tier: RegionTier, atGameSeconds: number): NotableEvent {
  return { key: relicSetCompletedKey(setId), kind: "relicSetCompleted", atGameSeconds, setId, tier };
}

// One system completion event. Pure.
export function systemCompletedEvent(sys: { systemId: string; systemName: string; tier: RegionTier }, atGameSeconds: number): NotableEvent {
  return { key: systemCompletedKey(sys.systemId), kind: "systemCompleted", atGameSeconds, systemId: sys.systemId, systemName: sys.systemName, tier: sys.tier };
}

// The set completion events for every set in `after` that is not in `before` (setsCompleted lists, in their order),
// stamped `atGameSeconds`. An unknown set id records nothing. Pure.
export function relicSetCompletedEvents(before: readonly string[], after: readonly string[], atGameSeconds: number): NotableEvent[] {
  if (after.length === before.length) return [];
  const had = new Set(before);
  const out: NotableEvent[] = [];
  for (const setId of after) {
    if (had.has(setId)) continue;
    const set = getExceptionalSetById(setId);
    if (!set) continue;
    out.push(relicSetCompletedEvent(setId, set.tier, atGameSeconds));
  }
  return out;
}

// The ledger with `add` appended, each event once (an event whose key is already in the ledger, or earlier in `add`, is
// skipped). The SAME reference when nothing is added. Pure.
export function withNotableEvents(events: readonly NotableEvent[] | undefined, add: readonly NotableEvent[]): NotableEvent[] | undefined {
  if (add.length === 0) return events as NotableEvent[] | undefined;
  const keys = new Set((events ?? []).map((e) => e.key));
  const fresh: NotableEvent[] = [];
  for (const e of add) {
    if (keys.has(e.key)) continue;
    keys.add(e.key);
    fresh.push(e);
  }
  return fresh.length === 0 ? (events as NotableEvent[] | undefined) : [...(events ?? []), ...fresh];
}

const TIERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

// The kind-specific fields an entry of a known kind must carry to be kept on load.
function kindFieldsOk(e: any): boolean {
  if (e.kind === "relicSetCompleted") return typeof e.setId === "string" && TIERS.includes(e.tier);
  if (e.kind === "systemCompleted") return typeof e.systemId === "string" && typeof e.systemName === "string" && TIERS.includes(e.tier);
  return true; // a kind added to NOTABLE_EVENT_KINDS without a field rule here keeps its entries
}

// Every-load hygiene (no SAVE_VERSION bump): a malformed ledger field is dropped, and malformed or repeated entries are
// left out (the first entry of a key is kept). Identity on every well-formed save and on every save without a ledger.
// Pure.
export function withNotableEventsOnLoad(state: any): any {
  if (!state || typeof state !== "object" || !Object.prototype.hasOwnProperty.call(state, "notableEvents")) return state;
  const raw = state.notableEvents;
  if (!Array.isArray(raw)) {
    const { notableEvents: _drop, ...rest } = state;
    return rest;
  }
  const keys = new Set<string>();
  const kept: NotableEvent[] = [];
  for (const e of raw) {
    // Any kind in NOTABLE_EVENT_KINDS is kept (a slice adding a kind adds it to that list) when it carries its own
    // fields (a set completion its set id and region tier; a system completion its system id, name and region tier).
    const known = !!e && typeof e === "object" && (NOTABLE_EVENT_KINDS as readonly string[]).includes(e.kind);
    const ok =
      known &&
      kindFieldsOk(e) &&
      typeof e.key === "string" &&
      typeof e.atGameSeconds === "number" &&
      Number.isFinite(e.atGameSeconds) &&
      !keys.has(e.key);
    if (!ok) continue;
    keys.add(e.key);
    kept.push(e as NotableEvent);
  }
  if (kept.length === raw.length) return state;
  return { ...state, notableEvents: kept };
}
