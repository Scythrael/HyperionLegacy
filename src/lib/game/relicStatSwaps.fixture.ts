// TEST-ONLY: the switch-off for the four theme-matched exceptional piece stats (user 2026-11-13 "Approve the 4 swaps
// (Recommended)", relics.ts EXCEPTIONAL_STAT_THEME_SWAPS). withoutThemeSwaps runs `fn` with every swapped piece (and the
// full set of a set whose first piece swapped) back on its pre-swap cycle stat, so a moved pin is reproduced exactly as it
// was captured (the withoutCp12 precedent: the catalog objects are mutated for the call and restored in `finally`).
// Never imported by app code.
import { EXCEPTIONAL_PIECE_STAT_CYCLE, EXCEPTIONAL_SETS, EXCEPTIONAL_STAT_THEME_SWAPS, type MuseumStat } from "./relics";

// Each piece's stat before the swaps: the plain cycle over the catalog, in order.
export const PRE_SWAP_PIECE_STAT: Readonly<Record<string, MuseumStat>> = (() => {
  const out: Record<string, MuseumStat> = {};
  let cursor = 0;
  for (const set of EXCEPTIONAL_SETS) for (const p of set.pieces) out[p.id] = EXCEPTIONAL_PIECE_STAT_CYCLE[cursor++ % EXCEPTIONAL_PIECE_STAT_CYCLE.length];
  return out;
})();

export function withoutThemeSwaps<T>(fn: () => T): T {
  const undo: (() => void)[] = [];
  try {
    for (const set of EXCEPTIONAL_SETS) {
      for (const p of set.pieces) {
        if (EXCEPTIONAL_STAT_THEME_SWAPS[p.id] === undefined) continue;
        const piece = p as { stat: MuseumStat };
        const was = piece.stat;
        piece.stat = PRE_SWAP_PIECE_STAT[p.id];
        undo.push(() => (piece.stat = was));
      }
      const full = set.fullSet[0] as { stat: MuseumStat };
      const first = PRE_SWAP_PIECE_STAT[set.pieces[0].id];
      if (full.stat !== first) {
        const was = full.stat;
        full.stat = first;
        undo.push(() => (full.stat = was));
      }
    }
    return fn();
  } finally {
    for (const u of undo.reverse()) u();
  }
}
