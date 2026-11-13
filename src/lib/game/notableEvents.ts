// ============================================================================
// notableEvents.ts: the hidden CHAT-EVENT LEDGER (0.14.0; E-CREW plan G4 "record chat-worthy events (first: a relic
// set completed) for when chat lands"; user "Hidden until chat (Recommended)": record now, no screen in 0.14.0).
//
// GameState.notableEvents holds the events in the order they happened, each appended ONCE by its unique key. Two kinds:
//   - "relicSetCompleted": an exceptional relic set whole in the Museum (tick.ts, the relic study that completed it).
//   - "systemCompleted": a system with every body scanned and every objective done, written at its claim (completion.ts).
// Nothing reads it for play or display. Shaped to merge with the Relics v2 content slice's ledger (the hub's note,
// 2026-11-13): the same field (`notableEvents`), the same helper names and the same event shape, the union by kind.
// ============================================================================

import type { GameState, NotableEvent, RegionTier } from "./model";

export type { NotableEvent };

// The ledger of a save (empty when it has none). Pure.
export function notableEventsOf(state: Pick<GameState, "notableEvents">): NotableEvent[] {
  return Array.isArray(state.notableEvents) ? state.notableEvents : [];
}

// `events` with each of `add` appended once by its key, in order (the SAME array when nothing is new). Pure.
export function withNotableEvents(events: readonly NotableEvent[] | undefined, add: readonly NotableEvent[]): NotableEvent[] {
  const base = events ?? [];
  const keys = new Set(base.map((e) => e.key));
  const fresh: NotableEvent[] = [];
  for (const e of add) {
    if (keys.has(e.key)) continue;
    keys.add(e.key);
    fresh.push(e);
  }
  return fresh.length === 0 ? (base as NotableEvent[]) : [...base, ...fresh];
}

export function relicSetCompletedKey(setId: string): string {
  return `relic-set-completed:${setId}`;
}
export function systemCompletedKey(systemId: string): string {
  return `system-completed:${systemId}`;
}

export function relicSetCompletedEvent(setId: string, tier: RegionTier, atGameSeconds: number): NotableEvent {
  return { key: relicSetCompletedKey(setId), kind: "relicSetCompleted", atGameSeconds, setId, tier };
}
export function systemCompletedEvent(sys: { systemId: string; systemName: string; tier: RegionTier }, atGameSeconds: number): NotableEvent {
  return { key: systemCompletedKey(sys.systemId), kind: "systemCompleted", atGameSeconds, systemId: sys.systemId, systemName: sys.systemName, tier: sys.tier };
}
