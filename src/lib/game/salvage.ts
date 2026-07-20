// ============================================================================
// Salvage engine, 0.11.0 Storage/Salvage Tasks C1 (equipment recycle) + C2/C3
// (salvaged-material loot roll).
// Author: Scythrael (via Claude) | 2026-07-20
//
// TWO DISTINCT salvage models, deliberately kept as two code paths (design's "two
// models, two code paths" note):
//   salvageEquipment         recycle a SPARE crafted system -> a % of its crafting
//                            inputs back (Task C1).
//   salvageSalvagedMaterial  consume one SALVAGED MATERIAL -> a weighted, tiered,
//                            progression-gated LOOT roll for one material drop (C2/C3).
// BOTH are LIVE-ONLY instant actions under the SAME parity boundary (see below).
//
// salvageEquipment: a LIVE-ONLY, player-initiated INSTANT action that consumes a
// SPARE CRAFTED ship system and returns a fraction of the materials that crafted it
// (its blueprint recipe.inputs) to inventory at quality tier 0, freeing a storage
// slot. It is the always-available escape valve that keeps a full equipment store
// from ever becoming a softlock (the guarantee deferred from Task B1): the storage
// cap is NEVER consulted here, so any spare can always be recycled.
//
// PARITY BOUNDARY (why this file has no offline-parity concern, and MUST NOT):
//   - This action is DISCRETE and INSTANT, triggered by a player click, not by the
//     passage of time. It is NOT a ProcessLine, has no duration, and does NOT run
//     inside economyTick / the offline tick() / resolveProcesses.
//   - It uses Math.random directly (injectable ONLY so tests can pin the roll). A
//     random INSTANT action is fine precisely because it never executes in the
//     offline-catch-up seam, where a divergent RNG stream would break parity.
//   - DO NOT wire salvageEquipment OR salvageSalvagedMaterial into any economy-tick
//     path. salvage.test.ts greps tick.ts to prove BOTH stay out; that guard is
//     load-bearing.
//
// IMMUTABILITY: like every equipment.ts / tick.ts state-transform, this returns a
// NEW GameState and never mutates the input. On a rejected salvage it returns the
// SAME-REFERENCE state plus a reason (mirroring the { ok, reason } reject convention
// used across the codebase), so a no-op is unambiguously a no-op.
//
// Contents (Functions -> tunables -> types -> action):
//   salvageTalentBonus                   auto-read FA salvage-talent bonus from state
//   SALVAGE_FRACTION_MIN / _MAX          the recovery-rate band (rolled per salvage)
//   SALVAGE_QUALITY_BONUS_PER_TIER       small per-quality-tier yield bonus
//   SalvageResult                        the discriminated success | reject union
//   salvageEquipment                     the action
// ============================================================================

import Decimal from "break_infinity.js";
import type { GameState, EquipmentRarity, SalvagedMaterialItemId, SalvageLootTier } from "./model";
import { BLUEPRINTS, ITEMS, SALVAGE_LOOT_POOLS, HOMEWORLD_TALENTS } from "./model";
import { addItemQuality, itemTotal, removeItemLowestFirst } from "./inventory";

// ----------------------------------------------------------------------------
// salvageTalentBonus (0.11.0 Storage/Salvage, Task C4)
// ----------------------------------------------------------------------------
// Resolve the combined Fleet-Admiral salvage talent's live bonus from state.
// Reads state.unlockedHomeworldTalents the SAME way tick.ts's fleetRareYieldMult
// does (reduce over the learned keys, discriminate on the effect `type`), so this
// stays consistent with every other Homeworld-talent-effect read in the codebase.
//
// Returns the effect payload's own numbers when the `salvageBoost` node is learned,
// and {0, 0} otherwise. The values are NOT re-declared here, they are read straight
// off HOMEWORLD_TALENTS' effect payload (model.ts, seeded by the SALVAGE_TALENT_*
// consts), so there is exactly ONE source of truth for the tunables. Summing over
// all learned talents (rather than short-circuiting on the first) is future-proof:
// if a second salvage-boosting node is ever added, both stack additively with no
// change here. PURE: reads state, allocates a fresh object, mutates nothing.
export function salvageTalentBonus(state: GameState): {
  yieldBonus: number;
  ceilingBonus: number;
} {
  return state.unlockedHomeworldTalents.reduce(
    (acc, key) => {
      const effect = HOMEWORLD_TALENTS[key].effect;
      if (effect.type === "salvageBoost") {
        acc.yieldBonus += effect.yieldBonus;
        acc.ceilingBonus += effect.ceilingBonus;
      }
      return acc;
    },
    { yieldBonus: 0, ceilingBonus: 0 }
  );
}

// ----------------------------------------------------------------------------
// Tunables (the salvage-yield knobs)
// ----------------------------------------------------------------------------
// First-pass recovery band: each salvage recovers a VARIABLE fraction of the
// crafting inputs, rolled uniformly in [MIN, MAX] with the injected rng. Kept as a
// band (not a flat rate) so recycling is a slightly lossy gamble, never a reliable
// way to launder materials back and forth. These are the first-pass values from the
// design (~30-40%); tune here.
export const SALVAGE_FRACTION_MIN = 0.3;
export const SALVAGE_FRACTION_MAX = 0.4;

// Per-quality-tier yield bonus: a higher-quality system was worth more to build, so
// it gives back a little more. Added ON TOP of the band, scaling with the salvaged
// piece's own quality rung (0..5), e.g. a quality-5 system recovers +0.10 over a
// quality-0 one. Small on purpose, so quality nudges yield without dominating it.
export const SALVAGE_QUALITY_BONUS_PER_TIER = 0.02;

// ----------------------------------------------------------------------------
// SalvageResult
// ----------------------------------------------------------------------------
// A discriminated union: on SUCCESS, `recovered` (the per-item amounts deposited,
// keyed by itemId) is present and `next` is a NEW state; on REJECT, `reason` is
// present and `next` is the SAME-REFERENCE input state (no-op). Both branches carry
// `next` so a caller can uniformly read `result.next`, and the presence of `recovered`
// vs `reason` (or the `ok` flag) discriminates the outcome.
//
// `rolled` is present ONLY on the salvaged-material LOOT roll (salvageSalvagedMaterial):
// it hands the UI the single item + its tier + its quality so it can narrate the drop
// ("you salvaged a Stellar-tier Anomalous Alloy"). The equipment recycle path
// (salvageEquipment) leaves it undefined, it deposits a spread of inputs, not one
// tiered roll, so its `recovered` map already tells the whole story.
export type SalvageResult =
  | { ok: true; next: GameState; recovered: Record<string, number>; rolled?: SalvageRoll }
  | { ok: false; next: GameState; reason: SalvageRejectReason };

// The single tiered drop a salvaged-material roll produced, for the UI. `itemId` is the
// deposited item, `tier` its gear-rarity tier name, `quality` the 0..5 bucket it landed
// in (the tier's quality). Amount is always exactly 1 (one salvaged material -> one
// rolled drop), so it is implied, not repeated here.
export interface SalvageRoll {
  itemId: string;
  tier: EquipmentRarity;
  quality: number;
}

// The reasons a salvage is refused.
//   Equipment recycle (salvageEquipment), only a SPARE CRAFTED system qualifies:
//     notFound             no equipment piece with that id
//     fitted               the piece is fitted to a ship (unfit it first)
//     notCraftable         a Standard-Issue baseline (blueprintKey null): craft-less,
//                          nothing to refund
//   Salvaged-material loot roll (salvageSalvagedMaterial):
//     notSalvagedMaterial  the item id is not a `salvagedMaterial` category item (only
//                          salvaged materials carry a loot pool)
//     noneHeld             the player holds zero of that salvaged material
export type SalvageRejectReason =
  | "notFound"
  | "fitted"
  | "notCraftable"
  | "notSalvagedMaterial"
  | "noneHeld";

// ----------------------------------------------------------------------------
// salvageEquipment
// ----------------------------------------------------------------------------
// Recycle a SPARE CRAFTED ship system: consume it, return floor(qty * fraction) of
// each of its blueprint's crafting inputs to inventory at quality tier 0, and free
// the storage slot it occupied.
//
// rng defaults to Math.random and is injectable ONLY for tests (see the PARITY
// BOUNDARY note at the top: this is a live instant action, so a real random roll is
// correct here).
//
// TALENT AUTO-APPLY (Task C4): the combined FA salvage talent's yield bump is folded
// in INTERNALLY via salvageTalentBonus(state), so the talent ALWAYS takes effect in
// real play, no UI caller has to remember to pass it. `talentBonus` remains an
// EXPLICIT ADDITIVE override (defaults to 0) layered ON TOP of the auto-read bonus:
// real callers pass nothing and get exactly the talent bonus, while tests stay
// deterministic (they control the talent purely through the state they build, and
// can still pass an extra flat amount when a test needs one). This is the "add it to
// whatever the caller passed" option from the task, chosen over making the param the
// sole hook because it guarantees auto-apply without any caller-side wiring.
//
// REJECTS (same-ref no-op + reason) when the target is not a spare crafted system:
// missing id, fitted piece, or Standard-Issue baseline. Only then does it compute a
// reward and build a new state.
export function salvageEquipment(
  state: GameState,
  instanceId: string,
  rng: () => number = Math.random,
  talentBonus = 0
): SalvageResult {
  // --- Locate + validate the target -----------------------------------------
  const piece = state.equipment.find((e) => e.id === instanceId);
  // Missing id: nothing to salvage.
  if (!piece) {
    return { ok: false, next: state, reason: "notFound" };
  }
  // Fitted piece: it lives in a live slot, not the spare pool. It must be unfit first.
  if (piece.fittedToShipId !== null) {
    return { ok: false, next: state, reason: "fitted" };
  }
  // Standard-Issue baseline (blueprintKey null): free + craft-less, so there is no
  // recipe to refund. These are managed by the never-empty invariant, not salvaged.
  if (piece.blueprintKey === null) {
    return { ok: false, next: state, reason: "notCraftable" };
  }

  // --- Compute the recovery fraction ----------------------------------------
  // band = MIN + rng()*(MAX-MIN)  ->  the uniform roll in [MIN, MAX].
  // fraction = band + quality bonus + auto-read talent bonus + explicit override.
  // The quality bonus rewards recycling a better system; salvageTalentBonus(state)
  // folds in the learned FA salvage talent automatically (so it always applies in
  // real play); `talentBonus` is the extra test-override layered on top.
  const band = SALVAGE_FRACTION_MIN + rng() * (SALVAGE_FRACTION_MAX - SALVAGE_FRACTION_MIN);
  const fraction =
    band +
    piece.quality * SALVAGE_QUALITY_BONUS_PER_TIER +
    salvageTalentBonus(state).yieldBonus +
    talentBonus;

  // --- Deposit the recovered inputs at quality 0 ----------------------------
  // The blueprint that crafted this piece is guaranteed to exist (a crafted piece
  // carries a real blueprintKey). For each input, recover floor(qty * fraction) and
  // deposit it into the QUALITY-0 bucket (crude recovery: recycled scrap is base
  // quality regardless of the salvaged system's quality).
  const inputs = BLUEPRINTS[piece.blueprintKey].recipe.inputs;
  const recovered: Record<string, number> = {};
  let inventory = state.inventory;
  for (const [itemId, qty] of Object.entries(inputs)) {
    const amount = Math.floor(qty * fraction);
    // Record every input's floored amount (including 0) so the caller sees the full
    // breakdown of what this recipe gave back.
    recovered[itemId] = amount;
    // Only touch inventory for a positive recovery (depositing 0 would needlessly
    // materialize an empty bucket).
    if (amount > 0) {
      inventory = addItemQuality(inventory, itemId, new Decimal(amount), 0);
    }
  }

  // --- Consume the piece + return the new state -----------------------------
  // The salvaged piece is removed from the pool (state.equipment is a plain array),
  // freeing its storage slot. A fresh array + a fresh inventory keep the input state
  // untouched (immutability).
  const equipment = state.equipment.filter((e) => e.id !== instanceId);
  return { ok: true, next: { ...state, equipment, inventory }, recovered };
}

// ============================================================================
// Salvaged-material loot roll (0.11.0 Storage/Salvage, Task C2, design §3)
// ============================================================================
// salvageSalvagedMaterial: the SECOND, distinct salvage model (kept a separate code
// path from salvageEquipment on purpose, per the design's "two models, two code paths"
// note). It consumes ONE unit of a SALVAGED MATERIAL (e.g. the Damaged Reactor Housing)
// and rolls its weighted, TIERED loot pool (SALVAGE_LOOT_POOLS, model.ts) for a single
// material drop, deposited at the rolled tier's quality.
//
// SAME PARITY BOUNDARY as salvageEquipment (see the file header): this is a LIVE-ONLY,
// player-initiated INSTANT action. It uses Math.random (injectable ONLY for tests) and
// MUST NOT be wired into economyTick / the offline tick() / resolveProcesses. A random
// instant action is fine precisely because it never runs in the offline-catch-up seam.
// salvage.test.ts greps tick.ts to prove BOTH salvage functions stay out; that guard is
// load-bearing.

// ----------------------------------------------------------------------------
// Progression-gated ceiling (the tunable FA-level thresholds)
// ----------------------------------------------------------------------------
// The rarity CEILING is the highest loot tier INDEX (into a pool's ordered tier array)
// the player can currently roll. It rises with Fleet Admiral level: a fresh player only
// reaches the low tier; a developed one can hit the top (radiant this patch). This is
// the design's "early salvage rolls low; the ceiling rises as you invest" made concrete.
//
// Each threshold: at fleetAdminLevel >= minLevel, tiers up to (and including) maxTierIndex
// are eligible. Ordered ascending; the ceiling is the maxTierIndex of the HIGHEST
// threshold the player meets. FIRST-PASS tunable values (same spirit as the loot weights).
export const SALVAGE_CEILING_THRESHOLDS: { minFleetAdminLevel: number; maxTierIndex: number }[] = [
  { minFleetAdminLevel: 1, maxTierIndex: 0 },  // fresh save: standard tier only
  { minFleetAdminLevel: 5, maxTierIndex: 1 },  // augmented unlocks
  { minFleetAdminLevel: 10, maxTierIndex: 2 }, // stellar unlocks (first exclusive exotics)
  { minFleetAdminLevel: 15, maxTierIndex: 3 }, // radiant unlocks (top of this patch's ladder)
];

// Resolve the base ceiling (before any talent bonus) for a Fleet Admiral level: the
// maxTierIndex of the highest threshold whose minFleetAdminLevel the player meets. A
// level below the first threshold still yields index 0 (the floor is always the low
// tier, never "nothing"). PURE.
function baseCeilingForLevel(fleetAdminLevel: number): number {
  let ceiling = 0;
  for (const t of SALVAGE_CEILING_THRESHOLDS) {
    if (fleetAdminLevel >= t.minFleetAdminLevel) {
      ceiling = t.maxTierIndex;
    }
  }
  return ceiling;
}

// Weighted pick over a list by each element's `.weight`, using ONE rng() draw. Returns
// the chosen element. Walks the cumulative weight and picks the first bucket the scaled
// roll falls into. Assumes a non-empty list with positive total weight (the loot pools
// and their tiers both satisfy this by construction). PURE apart from the single rng()
// call it is handed.
function weightedPick<T extends { weight: number }>(items: T[], rng: () => number): T {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll < 0) {
      return it;
    }
  }
  // Floating-point edge (roll landed exactly on the total): fall back to the last item.
  return items[items.length - 1];
}

// ----------------------------------------------------------------------------
// salvageSalvagedMaterial
// ----------------------------------------------------------------------------
// Consume ONE unit of a salvaged material and roll its tiered loot pool for a single
// drop, deposited at the rolled tier's quality bucket.
//
// rng defaults to Math.random, injectable ONLY for tests (see the parity note above).
// It makes exactly TWO draws per successful roll: (1) pick the tier among the
// ceiling-eligible tiers by tier weight, (2) pick the item within that tier by drop
// weight.
//
// TALENT AUTO-APPLY (Task C4): the combined FA salvage talent's ceiling bump is folded
// in INTERNALLY via salvageTalentBonus(state), so the talent ALWAYS raises the loot
// ceiling in real play, no UI caller has to remember to pass it. `ceilingBonus` remains
// an EXPLICIT ADDITIVE override (defaults to 0) layered ON TOP of the auto-read bonus
// (same pattern as salvageEquipment's talentBonus): real callers pass nothing and get
// exactly the talent's reach, tests control the talent through the state they build and
// may still pass an extra index. The sum is clamped to the pool's real top index below,
// so no override or bonus can ever index past the defined tiers.
//
// REJECTS (same-ref no-op + reason):
//   notSalvagedMaterial  itemId is not a `salvagedMaterial` category item (no loot pool)
//   noneHeld             the player holds zero of that salvaged material
export function salvageSalvagedMaterial(
  state: GameState,
  itemId: string,
  rng: () => number = Math.random,
  ceilingBonus = 0
): SalvageResult {
  // --- Validate the target is a salvaged material WITH a loot pool ----------
  // Category gate first: only `salvagedMaterial` items are salvaged for loot. An
  // unknown id (ITEMS[itemId] undefined) fails this same check.
  if (ITEMS[itemId]?.category !== "salvagedMaterial") {
    return { ok: false, next: state, reason: "notSalvagedMaterial" };
  }
  // A salvaged material without a pool entry would be a data gap; treat it as
  // not-salvageable rather than throwing (fail-safe, mirrors the engine's loose lookups).
  const pool = SALVAGE_LOOT_POOLS[itemId as SalvagedMaterialItemId];
  if (!pool || pool.length === 0) {
    return { ok: false, next: state, reason: "notSalvagedMaterial" };
  }

  // --- Require the player to actually hold one -----------------------------
  if (itemTotal(state.inventory, itemId).lte(0)) {
    return { ok: false, next: state, reason: "noneHeld" };
  }

  // --- Resolve the ceiling + the eligible tier slice -----------------------
  // base ceiling (FA level) + auto-read talent ceiling bonus + explicit override,
  // clamped to the pool's real top index below so a large bonus can never index past
  // the defined tiers. salvageTalentBonus(state) folds in the learned FA salvage
  // talent automatically (always applies in real play); `ceilingBonus` is the extra
  // test-override on top.
  const rawCeiling =
    baseCeilingForLevel(state.fleetAdminLevel) +
    salvageTalentBonus(state).ceilingBonus +
    ceilingBonus;
  const ceiling = Math.min(Math.max(rawCeiling, 0), pool.length - 1);
  const eligibleTiers: SalvageLootTier[] = pool.slice(0, ceiling + 1);

  // --- Roll: tier, then item within the tier -------------------------------
  const tier = weightedPick(eligibleTiers, rng); // draw 1
  const drop = weightedPick(tier.drops, rng);    // draw 2

  // --- Consume one salvaged material + deposit the rolled drop --------------
  // Consume ONE unit lowest-quality-first (salvaged materials live in bucket 0 today,
  // so this drains bucket 0; lowest-first keeps it correct if they ever carry quality).
  let inventory = removeItemLowestFirst(state.inventory, itemId, new Decimal(1));
  // Deposit the single rolled drop at the tier's quality bucket (higher tier -> higher
  // quality), reusing the 0-5 quality system.
  inventory = addItemQuality(inventory, drop.itemId, new Decimal(1), tier.quality);

  return {
    ok: true,
    next: { ...state, inventory },
    recovered: { [drop.itemId]: 1 },
    rolled: { itemId: drop.itemId, tier: tier.tier, quality: tier.quality },
  };
}
