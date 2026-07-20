// ============================================================================
// Equipment recycle-salvage, 0.11.0 Storage/Salvage Task C1.
// Author: Scythrael (via Claude) | 2026-07-20
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
//   - DO NOT wire salvageEquipment into any economy-tick path. salvage.test.ts greps
//     tick.ts to prove it stays out; that guard is load-bearing.
//
// IMMUTABILITY: like every equipment.ts / tick.ts state-transform, this returns a
// NEW GameState and never mutates the input. On a rejected salvage it returns the
// SAME-REFERENCE state plus a reason (mirroring the { ok, reason } reject convention
// used across the codebase), so a no-op is unambiguously a no-op.
//
// Contents (Functions -> tunables -> types -> action):
//   SALVAGE_FRACTION_MIN / _MAX          the recovery-rate band (rolled per salvage)
//   SALVAGE_QUALITY_BONUS_PER_TIER       small per-quality-tier yield bonus
//   SalvageResult                        the discriminated success | reject union
//   salvageEquipment                     the action
// ============================================================================

import Decimal from "break_infinity.js";
import type { GameState } from "./model";
import { BLUEPRINTS } from "./model";
import { addItemQuality } from "./inventory";

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
// A discriminated union: on SUCCESS, `recovered` (the per-input floored amounts
// deposited, keyed by itemId) is present and `next` is a NEW state; on REJECT,
// `reason` is present and `next` is the SAME-REFERENCE input state (no-op). Both
// branches carry `next` so a caller can uniformly read `result.next`, and the
// presence of `recovered` vs `reason` (or the `ok` flag) discriminates the outcome.
export type SalvageResult =
  | { ok: true; next: GameState; recovered: Record<string, number> }
  | { ok: false; next: GameState; reason: SalvageRejectReason };

// The reasons a salvage is refused. Only a SPARE CRAFTED system can be salvaged:
//   notFound      no equipment piece with that id
//   fitted        the piece is fitted to a ship (unfit it first; a live slot's piece
//                 is not spare)
//   notCraftable  a Standard-Issue baseline (blueprintKey null): free/craft-less, so
//                 there are no crafting inputs to give back (and it auto-refits anyway)
export type SalvageRejectReason = "notFound" | "fitted" | "notCraftable";

// ----------------------------------------------------------------------------
// salvageEquipment
// ----------------------------------------------------------------------------
// Recycle a SPARE CRAFTED ship system: consume it, return floor(qty * fraction) of
// each of its blueprint's crafting inputs to inventory at quality tier 0, and free
// the storage slot it occupied.
//
// rng defaults to Math.random and is injectable ONLY for tests (see the PARITY
// BOUNDARY note at the top: this is a live instant action, so a real random roll is
// correct here). `talentBonus` is the extension point for the LATER FA salvage-yield
// talent (Task C4): it is added flat onto the fraction and defaults to 0, so wiring
// the talent later is a one-argument change with no shape churn.
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
  // fraction = band + quality bonus + talent bonus. The quality bonus rewards
  // recycling a better system; the talent bonus is the reserved FA-talent hook.
  const band = SALVAGE_FRACTION_MIN + rng() * (SALVAGE_FRACTION_MAX - SALVAGE_FRACTION_MIN);
  const fraction = band + piece.quality * SALVAGE_QUALITY_BONUS_PER_TIER + talentBonus;

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
