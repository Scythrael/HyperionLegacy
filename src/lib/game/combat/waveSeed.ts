// ============================================================================
// combat/waveSeed.ts -- pure per-wave SEED DERIVATION, shared by the live tick
// loop and the display-only patrol replay (Combat 0.13.0, Phase 12b-1 review).
//
// WHY THIS IS ITS OWN LEAF:
// Both the LIVE patrol loop (tick.ts) and the DISPLAY-ONLY replay (patrolReplay.ts)
// must derive every wave's enemy / battle / loot seed IDENTICALLY, or a watched
// replay would drift from the fight the live loop actually ran. These primitives
// originally lived in tick.ts, which forced the display module to import UP from the
// live loop. Relocating them into this tiny, dependency-free combat/ leaf gives both
// callers ONE source of truth to import DOWN from, so no import direction inverts and
// the two paths cannot diverge. This module imports NOTHING (it is pure integer math
// over uint32), so it can never introduce an import cycle.
//
// PURE + DETERMINISTIC: every operation is masked to uint32 (>>> 0 / Math.imul), so a
// derived seed is byte-identical on every JS engine, the same cross-device determinism
// the combat PRNG (combat/rng.ts) demands. Nothing here reads or writes game state.
//
// ⚠️ LOCKED VALUES: the four salt constants below are persisted-save contracts. Once
// patrols shipped live, a saved masterSeed + these exact salts is what makes an
// in-flight patrol replay (and relaunch, and roll its loot) identically on reload. Do
// NOT change any salt value or the derivation math -- the parity/determinism tests gate
// this, and a changed value silently desyncs every saved patrol.
// ============================================================================

// murmur3 fmix32 finalizer (public-domain constants): avalanches a uint32 so tiny
// input changes decorrelate. Used only by deriveWaveSeed. Every op is masked to
// uint32 (>>> 0 / Math.imul) so the result is identical on every JS engine, the same
// cross-device determinism combat/rng.ts's mulberry32 demands.
function fmix32(hash: number): number {
  let h = hash >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// deriveWaveSeed: THE per-wave battle-seed derivation. A pure uint32 function of
// (masterSeed, waveIndex, salt) so a wave's seed is a function of PERSISTED STATE, not
// tick timing (the parity invariant): the same wave replays identically whether the
// patrol advanced as one big offline jump or many small live ticks. resolveBattle /
// generateEnemyWave further scramble it via makeStreams / makeRng, so this only has to
// be a well-mixed distinct integer per (wave, salt). The `salt` decorrelates the
// ENEMY-GENERATION seed from the BATTLE seed for the SAME wave (see the two salts
// below): two independent derivations off one master seed, belt-and-suspenders against
// any correlation between "what is in the wave" and "how the wave's rolls fall".
// Exported so the parity/determinism tests can hand-verify the derivation.
export function deriveWaveSeed(masterSeed: number, waveIndex: number, salt: number): number {
  // Combine the three inputs into one uint32 (odd-constant multiplies spread each
  // input's bits across the word), then avalanche with fmix32. waveIndex + 1 so
  // wave 0 does not collapse its multiply to 0.
  const combined =
    (Math.imul(masterSeed >>> 0, 0x9e3779b9) ^
      Math.imul((waveIndex + 1) >>> 0, 0x85ebca6b) ^
      (salt >>> 0)) >>>
    0;
  return fmix32(combined);
}

// The two decorrelation salts for deriveWaveSeed. Arbitrary-but-fixed nonzero
// constants (same spirit as rng.ts's COSMETIC_SEED_XOR): one for the wave's ENEMY
// TEAM generation, one for the wave's BATTLE. Distinct so the two streams cannot
// correlate. Do NOT change these once patrols ship live: a persisted masterSeed +
// these salts is what makes a saved patrol replay identically on reload.
// Exported (Phase 12b-1) so the DISPLAY-ONLY patrol replay derives each wave's enemy /
// battle seed with the EXACT same salts the live loop uses: identical salts + identical
// masterSeed + waveIndex => identical enemy team + identical battle, the structural parity
// the watchable replay depends on. Do NOT change these once patrols ship live.
export const WAVE_ENEMY_SEED_SALT = 0x1b873593;
export const WAVE_BATTLE_SEED_SALT = 0xcc9e2d51;

// The relaunch salt. A repeat-dispatch patrol that completes its route RELAUNCHES with a
// fresh master seed derived PURELY from the captain's OWN current master seed via
// deriveWaveSeed(currentSeed, 0, RELAUNCH_SEED_SALT), forming an independent per-captain
// seed chain (seed0 -> f(seed0) -> f(f(seed0)) -> ...). This is what makes multi-patrol
// offline==live parity hold: the relaunch seed is a function of that captain's persisted
// state ALONE, so it does not depend on how many OTHER patrol captains relaunched first
// (fleet-map iteration order) or on how ticks are batched. It deliberately does NOT touch
// the fleet-wide GameState.nextPatrolSeed counter (that stays exclusively the discrete
// player-DISPATCH path's, dispatchCaptainOnPatrol). A third distinct salt so a relaunch
// seed never collides with the same cycle's enemy/battle wave seeds. Do NOT change it once
// patrols ship live (a saved in-flight patrol's future relaunch chain depends on it).
export const RELAUNCH_SEED_SALT = 0x27d4eb2f;

// Combat 0.13.0 (Phase 10, design S12): the LOOT salt. Each WON wave's reward is rolled
// from deriveWaveSeed(masterSeed, waveIndex, WAVE_LOOT_SEED_SALT), a FOURTH distinct salt
// so a wave's loot stream DECORRELATES from that same wave's enemy-gen and battle streams
// (WAVE_ENEMY/WAVE_BATTLE salts) and from the relaunch chain (RELAUNCH salt). That
// separation is what stops loot from correlating with which enemies spawned or how the
// fight resolved: it is its own independent, seed-derived sequence. Because it derives off
// the SAME persisted masterSeed + waveIndex, a won wave's loot is fixed the instant that
// wave resolves and is byte-identical offline vs live (the parity gate). Do NOT change it
// once patrols ship live (a saved patrol's future wave loot depends on it).
//
// ⚠️ Value chosen to be distinct not only from the other 3 salts but ALSO from every
// constant used INSIDE deriveWaveSeed / fmix32 (0x9e3779b9 the masterSeed multiplier,
// 0x85ebca6b the waveIndex multiplier + first fmix32 constant, 0xc2b2ae35 the second fmix32
// constant). An earlier value (0x85ebca6b) accidentally equalled the waveIndex multiplier +
// first fmix32 constant, which for waveIndex 0 made the salt and waveIndex terms cancel
// (imul(1, 0x85ebca6b) ^ 0x85ebca6b == 0). That was not a correctness bug (fmix32 is a
// bijection, so decorrelation still held), but it defeated the "distinct nonzero salt" intent
// and tripled a magic literal. 0x165667b1 is xxHash's PRIME32_5, an odd 32-bit constant not
// used anywhere in the mixer, so no term can cancel for any waveIndex.
export const WAVE_LOOT_SEED_SALT = 0x165667b1; // xxHash PRIME32_5: odd, distinct from the 3 salts AND from every deriveWaveSeed/fmix32 constant
