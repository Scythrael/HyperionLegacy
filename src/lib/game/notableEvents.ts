// ============================================================================
// notableEvents.ts: Relics v2 R2-5 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-5, OC-16). THE MINIMAL
// NOTABLE-EVENT LEDGER the 2026-10-16 decision asked for ("The event ledger now (Recommended)": one notable-event
// ledger, first relic set, first Tier II run, captain milestones, read by the future achievements system, the Hall of
// Command and future chat). This slice builds its minimal form: an append-only list on GameState (notableEvents),
// idempotent by key, no UI. The one kind it records so far is an exceptional set completion (relics v2 call 16 "Every
// set"); later slices add their own kinds through the same append.
//
// Pure: no draw, no clock. An event's time is the game second it happened at, handed in by the writer.
// ============================================================================

import { NOTABLE_EVENT_KINDS, type GameState, type NotableEvent } from "./model";
import { getExceptionalSetById } from "./relics";

// The ledger key of a set completion (one per set, ever).
export function relicSetCompletedKey(setId: string): string {
  return `relicSetCompleted:${setId}`;
}

// The ledger (absent = empty). Pure.
export function notableEventsOf(state: Pick<GameState, "notableEvents">): readonly NotableEvent[] {
  return state.notableEvents ?? [];
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
    out.push({ key: relicSetCompletedKey(setId), kind: "relicSetCompleted", atGameSeconds, setId, tier: set.tier });
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
    // Any kind in NOTABLE_EVENT_KINDS is kept (a slice adding a kind adds it to that list); a relicSetCompleted event
    // must also carry its set id and region tier.
    const known = !!e && typeof e === "object" && (NOTABLE_EVENT_KINDS as readonly string[]).includes(e.kind);
    const kindFields = !known || e.kind !== "relicSetCompleted" || (typeof e.setId === "string" && [1, 2, 3, 4, 5, 6, 7].includes(e.tier));
    const ok =
      known &&
      kindFields &&
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

