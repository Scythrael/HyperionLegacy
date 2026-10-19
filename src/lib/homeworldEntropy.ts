// homeworldEntropy.ts (Expedition Tiers G2-1, docs/plans/2026-10-14-expedition-tiers-g2-plan.md): THE ONE ENTROPY
// SOURCE of the homeworld placement. Every other per-save seed is a fixed constant; the homeworld must differ per
// player (user 3b.6: "every homeworld system should be different for each player"), so its seed is drawn here ONCE,
// at the browser boundary, and stored on the save (GameState.homeworld): App.svelte passes a draw to freshState on
// every new game, and save.ts loadFromLocalStorage passes one to migrate for the SAVE v70 step (user G2: each existing
// save gets its own random homeworld). The engine never draws: galaxy.ts derives the placement from the stored seed.

interface RandomSource {
  getRandomValues(array: Uint32Array<ArrayBuffer>): unknown;
}

// A uniform 32-bit seed from Web Crypto. Without it (a very old browser), time mixed with Math.random: still
// different per player, which is all the placement needs. `source` is injectable for tests.
export function drawHomeworldSeed(source: RandomSource | null | undefined = globalThis.crypto): number {
  try {
    if (source && typeof source.getRandomValues === "function") {
      const out = new Uint32Array(1);
      source.getRandomValues(out);
      return out[0] >>> 0;
    }
  } catch {
    // fall through to the fallback
  }
  return (Math.floor(Math.random() * 0x100000000) ^ Date.now()) >>> 0;
}
