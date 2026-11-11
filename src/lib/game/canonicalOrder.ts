// ORDERING DETERMINISM (docs/plans/2026-10-22-roadmap-and-release-gates.md, "Ordering wrinkles found by CP-14 / CP-16
// parity tests", and "Ordering determinism slice BUILT (2026-11-11)"): the one order the codex's `discovered` list and
// the four lifetime tally maps (itemsGathered, itemsRefined, itemsCrafted, missionsCompleted) are kept in, so one
// economyTick call, 997 s chunks and 1 s steps leave them byte-identical.
//
// The order is CANONICAL (code unit order of the item id or key), applied when an entry is ADDED. Why not first-seen
// order by each event's own time: a call does not meet its events in time order. economyTick runs each captain over the
// whole call before the next captain, then the processes, the relic study lanes and the rest in their own passes, so a
// big call meets captain 1's later find before captain 2's earlier one. Recovering time order would need the exact game
// second of every grant and every completion from every one of those passes, and even then two events inside one live
// step (the game steps 1 s or less) would tie and fall back to pass order, which a finer step would split. No first-seen
// order is reachable by every chunking; a canonical one is, and neither list carries meaning in its order (the UI reads
// `discovered` as a set, the tallies by key or as a sum, and the offline summary lists mission types in a fixed order).
//
// Re-sorting the WHOLE list or map whenever an entry is added (rather than only placing the new entry) also makes an
// older save in first-seen order land on the same order however the time after it is cut: the first addition in any
// chunking sorts it. A save is loaded as it is (nothing reordered on load, no SAVE_VERSION bump). Pure: never mutates.

// The test-only switch golden files use to prove what the slice moved (orderingSwitch.fixture.ts). With it OFF an
// entry is appended in the order a call meets it: the game before the slice exactly.
export const CANONICAL_ORDER_SWITCH = { live: true };

// `discovered` with `id` added (the same array when it is already listed). Pure.
export function withDiscovered(discovered: string[], id: string): string[] {
  if (discovered.includes(id)) return discovered;
  const next = [...discovered, id];
  return CANONICAL_ORDER_SWITCH.live ? next.sort() : next;
}

// `map` with its keys in canonical order (the same object when they already are, or with the switch off). Called by a
// writer after it adds a key. Pure.
export function inCanonicalKeyOrder<T>(map: Record<string, T>): Record<string, T> {
  if (!CANONICAL_ORDER_SWITCH.live) return map;
  const keys = Object.keys(map);
  const ordered = [...keys].sort();
  if (ordered.every((k, i) => k === keys[i])) return map;
  const out: Record<string, T> = {};
  for (const k of ordered) out[k] = map[k];
  return out;
}
