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
//
// The first-find relic registry (`relicDiscovered`) is left out: its writers inside economyTick (the relic study lanes,
// tick.ts resolveRelicStudies) already deposit in completion order however the time is cut (orderingParity.test.ts),
// and its other writers (a grant bundle in processSpeed.ts, the dev Museum grant) are single actions, not chunked time.

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
  return keysSorted(map);
}

// `map` with its keys in code unit order (the same object when they already are). Pure.
function keysSorted<T>(map: Record<string, T>): Record<string, T> {
  const keys = Object.keys(map);
  const ordered = [...keys].sort();
  if (ordered.every((k, i) => k === keys[i])) return map;
  const out: Record<string, T> = {};
  for (const k of ordered) out[k] = map[k];
  return out;
}

// ===== PART 2 ("Ordering determinism part 2 BUILT (2026-11-11)" in the same roadmap doc) =====
//
// (1) The key order of `inventory`. A call meets two new items in pass order (each captain over the whole call, then the
// processes), 1 s steps in time order, so the keys landed in another order (the shortRangeCycle, refugeeGoldens and
// emodEm4 parity tests sorted object keys to hide it). Same rule as part 1: an item that gains its FIRST key puts the
// whole map in canonical order; a write to a key already held keeps the order as it is (the hot path: one spread, no
// sort). Every inventory write goes through ONE seam (inventory.ts setItemBuckets). A deleted key (only the save
// migration and a dev probe delete) leaves the rest in their order. Nothing reads the order (the Warehouse and every
// other surface iterate the ITEMS catalog; the engine's own key walks, the cap clamp and the load-time discovery
// reconcile, act per key). Old saves load as they are; their first new key sorts them in every chunking alike.
//
// (2) The completion log. resolveProcesses met a call's completions in process array order, 1 s steps in completion
// order, so a call that finished two processes out of array order logged them (and numbered them `done-N`) the other
// way round. Now a call records its completions ordered by the whole tick each completed on, then by the process id
// (compareProcessIds): the order 1 s steps give in every chunking. The entries themselves (text, stamps) are unchanged.

// The test-only switch golden files use to prove what part 2 moved (ordering2Switch.fixture.ts). With it OFF a new
// inventory key is appended where the spread puts it and the log records in array order: the game before part 2.
export const ORDERING2_SWITCH = { live: true };

// `inv` with `item` set to `value`. A key already held keeps its place; a NEW key puts the whole map in canonical order
// (with the switch off it is appended). The single inventory write seam is inventory.ts setItemBuckets, which calls
// this. Pure: never mutates.
export function withInventoryKey<T>(inv: Record<string, T>, item: string, value: T): Record<string, T> {
  const isNew = inv[item] === undefined;
  const next = { ...inv, [item]: value };
  return isNew && ORDERING2_SWITCH.live ? keysSorted(next) : next;
}

// A total, chunk-free order on process ids: shorter first, then code unit order, so "proc-9" comes before "proc-10"
// (the "proc-N" ids nextProcessId mints in creation order). Negative when `a` comes first.
export function compareProcessIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
