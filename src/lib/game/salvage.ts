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
// BOTH run on TWO CALLERS now (live instant + timed job), under the SAME rng rule (below).
//
// salvageEquipment: consumes a SPARE CRAFTED ship system and returns a fraction of the
// materials that crafted it (its blueprint recipe.inputs) to inventory at quality tier 0,
// freeing a storage slot. It is the always-available escape valve that keeps a full
// equipment store from ever becoming a softlock (the guarantee deferred from Task B1):
// the storage cap is NEVER consulted here, so any spare can always be recycled.
//
// ⚠️ PARITY BOUNDARY, REWRITTEN FOR CRAFTING 0.13.3 (Phase 2 Unit 2.3, design 7.4/7.5).
// This file USED to say "never wire any of these into an economy-tick path", and
// salvage.test.ts held a source grep on tick.ts proving it. That boundary is GONE: 0.13.3
// makes salvage a TIMED, queued process, so a salvageJob completing inside
// resolveProcesses now calls all three of these functions. The rule that replaced it:
//
//   THE RNG IS THE BOUNDARY. Every function here draws through its injected `rng`
//   parameter and NEVER through a bare Math.random of its own. The parameter defaults to
//   Math.random, which is correct and only correct for the LIVE INSTANT callers
//   (App.svelte's recycle / loot-roll / hull-teardown buttons): a player-clicked action
//   happens at a real moment in real time and has nothing to stay in lockstep with. The
//   TICK caller must ALWAYS pass resolveProcesses' threaded seeded rng instead, because a
//   completion inside the offline-catch-up seam has to draw exactly what the same
//   completion draws live, or a long offline span recovers different materials than the
//   identical span played at the keyboard.
//
//   DRAW COUNTS ARE FIXED AND DOCUMENTED, which is what makes the stream position
//   predictable across a whole span of completions: salvageEquipment draws ONCE (the
//   recovery band), salvageSalvagedMaterial draws EXACTLY TWICE (loot tier, then item
//   within the tier), salvageShip draws ONCE (the recovery band). Every rejection returns
//   BEFORE its draw, so a refused salvage costs the stream nothing. Changing any of those
//   counts changes the stream for every later completion in the same span: treat them as
//   load-bearing, not as an implementation detail.
//
//   salvage.test.ts still greps tick.ts, but for the REAL invariant now: every salvage
//   call site there passes rng, and tick.ts adds no bare Math.random. See that guard's
//   own header for what it defends and why it was not simply deleted.
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
//   (re-exported from reservation.ts)    the DERIVED salvage-reservation helpers, 0.13.3
//   selectAutoSalvageTargets             the PURE auto-salvage rule evaluator, 0.13.3 Unit 5.1
//                                        (reads state, draws NO rng, returns targets only)
// ============================================================================

import Decimal from "break_infinity.js";
import type {
  GameState,
  EquipmentRarity,
  EquipmentInstance,
  SalvagedMaterialItemId,
  SalvageLootTier,
  SalvageTargetRef,
} from "./model";
import {
  BLUEPRINTS,
  ITEMS,
  SALVAGE_LOOT_POOLS,
  HOMEWORLD_TALENTS,
  SHIP_TYPES,
  isStandardIssueBaseline,
  rarityIndex,
} from "./model";
// The DERIVED reservation pass (every queued OR in-flight salvage target). Imported as a
// real binding here, because the re-export block below only FORWARDS the name to consumers
// and does not bind it locally. The auto-salvage selector at the bottom of this file has to
// ask "is this piece already spoken for", and it must NOT re-derive that set itself: one
// source of truth (Omega 4), and a second derivation would be a second thing to keep in
// sync with the queue.
import { salvageReservations } from "./reservation";
import { addItemQuality, itemTotal, removeItemLowestFirst } from "./inventory";
// onMissionLock is the equipment install system's shared "is this ship's captain out on a
// mission?" guard. salvageShip (below) reuses it verbatim so a hull that is locked for
// INSTALLING mid-mission is locked for SALVAGE too, one source of truth for that lock.
import { onMissionLock } from "./equipment";

// --- Derived salvage reservations (Crafting 0.13.3, Phase 2 Unit 2.1) --------
// Re-exported so "the salvage reservation helpers live in salvage.ts" stays TRUE for
// callers, which is where the build plan said to look for them. They are IMPLEMENTED in
// reservation.ts because the consumer that matters most, canFitEquipment, lives in
// equipment.ts, and this file already imports equipment.ts (onMissionLock above): a
// direct definition here would force equipment.ts to import salvage.ts and close an
// import CYCLE. reservation.ts is a type-only leaf both sides can depend on. See its
// header for the full reasoning and for the in-flight extension point Unit 2.2 fills in.
export {
  salvageReservations,
  salvageReservedInstanceIds,
  salvageReservedShipIds,
  salvageReservedMaterialCount,
  isDuplicateSalvageTarget,
  // 0.13.3 batch-salvage follow-up: the unit count a queued salvage order stands for, and
  // the enqueue-time bound that keeps a batch inside what the player actually holds. Both
  // belong to the same reservation module for the same reason as the five above, so both
  // are re-exported here rather than becoming a second place to import salvage helpers from.
  salvageOrderUnits,
  exceedsFreeSalvageUnits,
  type SalvageReservations,
  type QueuedSalvageOrder,
} from "./reservation";

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
//   Equipment recycle (salvageEquipment):
//     notFound             no equipment piece with that id
//     fitted               the piece is fitted to a ship (unfit it first)
//   (A spare Standard-Issue baseline, combat OR economy, is NOT refused: it is DESTROYED as a
//    zero-reward declutter, see salvageEquipment below. That destroy path is the always-available
//    storage escape valve, so there is no baseline-specific reject reason.)
//   Salvaged-material loot roll (salvageSalvagedMaterial):
//     notSalvagedMaterial  the item id is not a `salvagedMaterial` category item (only
//                          salvaged materials carry a loot pool)
//     noneHeld             the player holds zero of that salvaged material
//   Ship salvage (salvageShip), tearing a whole hull down for parts:
//     shipNotFound         no ship in the fleet with that id
//     shipOnMission        the ship's assigned captain is out on an active mission, so
//                          the hull cannot be torn apart mid-flight (same lock install uses)
//     lastShip             this is the fleet's ONLY hull (state.ships.length === 1). Tearing
//                          it down would leave the player with no ship AND all mission income
//                          stopped, then facing a 2000-credit + FA-level-3 Shipyard re-founding:
//                          a practical softlock. Refused outright, no dev-mode escape hatch (a
//                          peace-design guarantee, not a balance knob).
export type SalvageRejectReason =
  | "notFound"
  | "fitted"
  // A recipe-less NON-baseline spare (blueprintKey null but not a standard-rarity floor, e.g. a
  // dev-granted radiant item): no recipe to refund and not a declutterable baseline, so it is
  // refused rather than destroyed for nothing. Dev-only reachable in a shipped build.
  | "noRecipe"
  | "notSalvagedMaterial"
  | "noneHeld"
  | "shipNotFound"
  | "shipOnMission"
  | "lastShip";

// ----------------------------------------------------------------------------
// salvageEquipment
// ----------------------------------------------------------------------------
// Recycle a SPARE CRAFTED ship system: consume it, return floor(qty * fraction) of
// each of its blueprint's crafting inputs to inventory at quality tier 0, and free
// the storage slot it occupied.
//
// rng: ONE draw, the recovery band. The default (Math.random) serves the LIVE instant
// caller; the timed salvageJob completion in resolveProcesses passes the seeded, threaded
// stream instead. See the rewritten PARITY BOUNDARY note at the top of this file.
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
// REJECTS (same-ref no-op + reason) only when the target is missing (notFound) or fitted
// (fitted). Otherwise a spare piece is removable: a CRAFTED spare SALVAGES for a rolled
// fraction of its recipe inputs; a spare Standard-Issue baseline (combat OR economy) has no
// recipe, so it is DESTROYED as a zero-reward DECLUTTER (removed, recovers nothing), the
// always-available storage escape valve, see the baseline branch below.
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
  // Spare Standard-Issue baseline (blueprintKey null): free + craft-less, so there is no recipe
  // to refund. Rather than block it, DESTROY it as a pure DECLUTTER (user decision 2026-07-21,
  // re-affirmed 2026-08-17): remove the spare baseline and recover NOTHING. This covers BOTH
  // economy AND combat baselines deliberately: destroy is the ALWAYS-AVAILABLE storage escape
  // valve, so a spare pool that fills with un-removable Standard-Issue gear can never become a
  // hard softlock (an earlier guard that blocked combat baselines reintroduced exactly that
  // storage-fill softlock, so combat baselines destroy here too). Note the distinction the user
  // drew: a baseline can be DESTROYED (removed for nothing) but never SALVAGED for components,
  // which is why the reward is empty, not a recipe refund. The zero reward is also load-bearing
  // against farming: baselines are free (a spare one can be produced at no material cost), so ANY
  // payout here would be a farmable resource source (Omega 6). An empty `recovered` map tells the
  // caller to render a "discarded, no materials" outcome instead of a recovery summary. This only
  // ever runs on a SPARE baseline: a fitted one is caught by the `fitted` guard above, and the
  // live-slot never-empty invariant is untouched (this removes a pool spare, not a slot occupant).
  // ⚠️ Uses the STRICT isStandardIssueBaseline predicate (blueprintKey null AND rarity "standard"),
  // NOT bare blueprintKey===null (audit fix, AUDIT-2): dev-granted gear is also blueprintKey null but
  // RADIANT, and the raw test would zero-DESTROY such a valuable spare. The sibling salvageShip in
  // this file already uses this predicate (below); salvageEquipment was the one missed destroy site.
  if (isStandardIssueBaseline(piece)) {
    const equipment = state.equipment.filter((e) => e.id !== instanceId);
    return { ok: true, next: { ...state, equipment }, recovered: {} };
  }

  // A RECIPE-LESS non-baseline piece: blueprintKey null but NOT a standard-rarity floor (e.g. a
  // dev-granted radiant spare, devGrantEquipment). It has no recipe to refund AND is not a
  // declutterable Standard-Issue baseline, so REFUSE rather than (a) silently destroy a valuable item
  // for nothing or (b) crash the `BLUEPRINTS[piece.blueprintKey].recipe` read below on a null key.
  // The piece stays in the pool, recoverable. Dev-only in a shipped build (prod has no null-blueprint
  // non-standard item), but a correctness + data-safety guard regardless. (audit AUDIT-2)
  if (piece.blueprintKey === null) {
    return { ok: false, next: state, reason: "noRecipe" };
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
// SAME RNG RULE as salvageEquipment (see the rewritten PARITY BOUNDARY note in the file
// header): the live instant caller takes the Math.random default, and the timed
// salvageJob completion in resolveProcesses passes the seeded threaded stream. This is
// the two-draw arm (tier, then item), and that count is load-bearing for the stream
// position of every completion after it in the same span.

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
// rng: exactly TWO draws per successful roll, (1) pick the tier among the
// ceiling-eligible tiers by tier weight, (2) pick the item within that tier by drop
// weight. The default (Math.random) serves the LIVE instant caller; the timed salvageJob
// completion passes the seeded threaded stream. See the file-header rng rule.
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

// ============================================================================
// Ship salvage (break down a hull you no longer need)
// ============================================================================
// salvageShip: a THIRD salvage entry point (a distinct code path again, per the design's
// "each salvage model is its own path" posture), tearing a whole SHIP down for a fraction
// of what the hull cost to build. It mirrors salvageEquipment's recycle band and its
// LIVE-ONLY, INSTANT, same-ref-reject shape, but operates on a ShipInstance instead of a
// spare EquipmentInstance and additionally refunds credits.
//
// ⚠️ THE TIMED TEARDOWN THIS HEADER PROMISED HAS LANDED (Crafting 0.13.3 Unit 2.3). This
// used to be instant-only, with a note saying a future task would convert it into a
// multi-tick process. That task is done, and it did NOT need this function moved or
// rewritten: the process engine now runs a salvageJob whose completion calls THIS
// function, so the teardown takes real time (a share of the hull's own build duration,
// SALVAGE_SHIP_BUILD_DIVISOR) while the reward math stays the one proven copy. The
// INSTANT form is still reachable from the live Docks button and stays supported; the two
// callers differ ONLY in which rng they hand in.
//
// SAME RNG RULE as the other two salvages (see the rewritten PARITY BOUNDARY note in the
// file header): ONE draw, the recovery band. The default (Math.random) serves the live
// instant caller; the timed completion in resolveProcesses passes the seeded threaded
// stream, which is what makes a hull torn down during a long offline span recover exactly
// what it would have recovered live.

// The result of a ship salvage. Discriminated union in the SAME posture as SalvageResult:
// on SUCCESS a NEW state plus `recovered` (the per-component amounts deposited at quality 0)
// and `creditsRecovered` (added to the balance); on REJECT the SAME-REFERENCE input state
// plus a reason (no-op). Kept a SEPARATE type from SalvageResult because a ship salvage also
// returns credits (a hull's build cost includes a flat credit price), which the equipment/
// material salvages never do, so bolting `creditsRecovered` onto the shared union would give
// every consumer a field only this path populates.
export type SalvageShipResult =
  | { ok: true; next: GameState; recovered: Record<string, number>; creditsRecovered: number }
  | { ok: false; next: GameState; reason: SalvageRejectReason };

// ----------------------------------------------------------------------------
// salvageShip
// ----------------------------------------------------------------------------
// Break down a hull in the fleet: return its INSTALLED CRAFTED systems to the spare pool,
// discard its free Standard-Issue baselines, unassign its captain, refund a rolled fraction
// of the hull's build components (at quality 0) + build credits, and remove the ship from
// the fleet (freeing a docks slot immediately).
//
// rng: ONE draw, the recovery band. Default Math.random for the live instant caller, the
// seeded threaded stream from the timed salvageJob completion (see the rng rule above).
//
// REJECTS (same-ref no-op + reason): the ship id must resolve to a real hull (shipNotFound),
// its assigned captain must NOT be on an active mission (shipOnMission, via the shared
// onMissionLock guard reused from the install system), and it must NOT be the fleet's ONLY
// hull (lastShip). Only then is a reward computed and a new state built.
//
// LAST-HULL GUARD (peace-design softlock block): salvaging the fleet's only ship strands the
// player with no hull and no mission income, then a 2000-credit + FA-level-3 Shipyard re-founding
// to get back in the game, a practical softlock. So a length===1 fleet is refused outright. There
// is deliberately NO dev-mode escape hatch: this is a hard player-protection guarantee, not a
// tunable. It is checked AFTER shipNotFound/shipOnMission so those more specific, actionable
// reasons win when they also apply (e.g. a lone hull that is out on a mission reports "recall
// first", the step the player can actually take).
export function salvageShip(
  state: GameState,
  shipId: string,
  rng: () => number = Math.random
): SalvageShipResult {
  // --- Locate + validate the target -----------------------------------------
  // Missing id: nothing to salvage.
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) {
    return { ok: false, next: state, reason: "shipNotFound" };
  }
  // On-mission lock: reuse the install system's shared guard (Omega 4, DRY) so a hull whose
  // captain is out flying cannot be torn apart mid-mission, the SAME rule that blocks changing
  // its installed systems. The ship is known to exist here (checked above), so any block onMissionLock
  // reports is specifically the on-mission case; map it to this file's reason vocabulary.
  const lock = onMissionLock(state, shipId);
  if (!lock.ok) {
    return { ok: false, next: state, reason: "shipOnMission" };
  }
  // Last-hull guard: refuse to tear down the fleet's ONLY ship. Doing so would leave the player
  // with zero hulls (all mission income stopped) facing a 2000-credit + FA-level-3 Shipyard
  // re-founding, a practical softlock and a peace-design violation. Same-ref no-op + reason, like
  // the guards above, so nothing is destroyed or mutated on refuse. No dev-mode bypass by design:
  // this is a hard player-protection floor. Checked LAST so shipNotFound/shipOnMission (the more
  // specific, actionable reasons) take precedence when they also hold.
  if (state.ships.length === 1) {
    return { ok: false, next: state, reason: "lastShip" };
  }

  // --- Return crafted systems to the spare pool; discard baselines ----------
  // fittedToShipId is the SINGLE SOURCE OF TRUTH for where a piece lives (model.ts). For the
  // pieces fitted to THIS hull:
  //   genuine Standard-Issue FLOOR (isStandardIssueBaseline) -> DISCARDED (dropped from the array).
  //                                         It is free + craftless, so there is nothing to preserve.
  //   EVERYTHING ELSE fitted here (crafted AND dev/valuable) -> unfit to the spare pool (set
  //                                         fittedToShipId null), so the player NEVER loses gear when
  //                                         a hull is scrapped; it survives as a reusable spare.
  // ⚠️ Uses the STRICT isStandardIssueBaseline predicate (blueprintKey null AND rarity "standard"),
  // NOT bare blueprintKey===null: dev-granted gear is also blueprintKey null but RADIANT, and
  // discarding it here silently deleted valuable items on a hull scrap. A false-negative (a real
  // baseline recovered as a spare) is harmless; a false-positive would delete a real item.
  // Pieces fitted to a DIFFERENT ship (or already spare) are untouched.
  //
  // NOTE (equipment-cap overflow, allowed): the returned crafted spares may push the spare
  // pool OVER equipmentStorageCap. That is intentional and fine, the cap gates CRAFTING new
  // systems (canFabricate), NOT returns from a scrapped hull. A player who overflows simply
  // cannot craft more until they trim the pool (via salvageEquipment) back under the cap; no
  // spare is ever destroyed by the cap here.
  const equipment = state.equipment
    // Drop ONLY this hull's genuine Standard-Issue floors.
    .filter((e) => !(e.fittedToShipId === shipId && isStandardIssueBaseline(e)))
    // Recover EVERY other piece on this hull (crafted AND dev/valuable) to the spare pool.
    .map((e) =>
      e.fittedToShipId === shipId && !isStandardIssueBaseline(e) ? { ...e, fittedToShipId: null } : e
    );

  // --- Unassign the captain --------------------------------------------------
  // The ship->captain link (ShipInstance.assignedCaptainId) is the ONLY link between a hull
  // and its captain: CaptainState carries NO reciprocal assignedShipId (model.ts deliberately
  // does not duplicate the reference so the two can never disagree). So removing the ship from
  // state.ships (below) severs the ONLY link, there is no captain->ship field to also clear.
  // The formerly-assigned captain simply becomes ship-less (idle, no hull) until reassigned,
  // which is acceptable, no captain is ever left pointing at a destroyed hull.

  // --- Recover build materials + credits ------------------------------------
  // Mirror salvageEquipment's recovery band: recover a VARIABLE fraction, rolled uniformly in
  // [MIN, MAX] with the injected rng, of what the hull cost to BUILD (its buildRecipe). No
  // quality/talent bonus applies here: a hull has no quality rung, and the FA salvage talent
  // buffs fine MATERIAL recycling, not a coarse hull teardown. So the fraction is the raw band.
  const recipe = SHIP_TYPES[ship.typeKey].buildRecipe;
  const fraction = SALVAGE_FRACTION_MIN + rng() * (SALVAGE_FRACTION_MAX - SALVAGE_FRACTION_MIN);

  // Deposit floor(count * fraction) of each build component into the QUALITY-0 bucket (crude
  // recovery, same as recycled scrap). Record every component's floored amount (including 0)
  // so the caller sees the full breakdown; only touch inventory for a positive recovery.
  const recovered: Record<string, number> = {};
  let inventory = state.inventory;
  for (const [itemId, count] of Object.entries(recipe.components)) {
    const amount = Math.floor(count * fraction);
    recovered[itemId] = amount;
    if (amount > 0) {
      inventory = addItemQuality(inventory, itemId, new Decimal(amount), 0);
    }
  }

  // Refund floor(credits * fraction) of the hull's flat build-credit cost onto the balance.
  // state.credits is a Decimal, so add via .plus (creditsRecovered is a plain number, which
  // Decimal.plus accepts). The reported number is the same plain integer.
  const creditsRecovered = Math.floor(recipe.credits * fraction);
  const credits = state.credits.plus(creditsRecovered);

  // --- Remove the hull + return the new state -------------------------------
  // Drop the ship from state.ships (a plain array), freeing a docks slot IMMEDIATELY, since
  // canStartShipBuild's storage gate reads state.ships.length. Fresh ships/equipment arrays +
  // a fresh inventory + the updated credits keep the input state untouched (immutability).
  const ships = state.ships.filter((s) => s.id !== shipId);
  return {
    ok: true,
    next: { ...state, ships, equipment, inventory, credits },
    recovered,
    creditsRecovered,
  };
}

// ============================================================================
// AUTO-SALVAGE RULE EVALUATION (Crafting 0.13.3, Phase 5 Unit 5.1)
// Design: docs/plans/2026-09-01-crafting-0.13.3-design.md section 7.6
// Plan:   docs/plans/2026-09-01-crafting-0.13.3-plan.md (Phase 5, Unit 5.1)
//
// ⚠️ PARITY-CRITICAL, AND THE REASON THIS FUNCTION IS PURE.
// The rules are evaluated INSIDE THE TICK (tick.ts, autoSalvageOrders -> the head of
// promoteQueuedOrders), which means they also run inside the OFFLINE CATCH-UP seam. The
// only way a long offline span can enqueue exactly what the same span stepped live would
// have enqueued is for the decision to be a pure function of the saved state:
//
//   * NO rng. Not one draw, not even for a tie-break. A draw here would move the seeded
//     stream's position and change every salvage reward that completes after it.
//   * NO clock, NO Date.now, NO wall time, NO localStorage. The offline resolver can read
//     the SAVE and nothing else, which is exactly why the per-quality confirm preference
//     was migrated INTO GameState for this release (plan, "RESOLVED ASSUMPTION").
//   * NO iteration over an unordered container. Candidates are sorted by instance id
//     before anything is selected (see CANDIDATE ORDER below).
//
// WHAT IT DOES NOT DO: it does not enqueue, it does not mutate, it does not consult the
// queue depth, and it does not know what a facility is. It answers ONE question,
// "which spare systems do the player's rules say to salvage, best `limit` first", and
// hands the list back. The caller (tick.ts) owns the depth budget and the enqueue, so
// every gate enqueueOrder applies (depth cap, duplicate refusal, facility shape) applies
// to an auto-added order exactly as it applies to a hand-clicked one.
// ============================================================================

// ----------------------------------------------------------------------------
// autoSalvageProtectedQualities
// ----------------------------------------------------------------------------
// The set of quality tiers the player has asked to be CONFIRMED before salvage, read
// straight off the save (state.salvageConfirmQualities, migrated into GameState by Unit
// 1.1). A tier in this set can NEVER be auto-salvaged: the player explicitly asked to be
// asked about it, and an automation rule must not answer that question for them. This is
// the guard that prevents the "it silently ate my Q4 drop" outcome.
//
// ⚠️ FAIL SAFE ON A MISSING FIELD. A save that somehow arrives without the array (a
// hand-edited save, a partial fixture, a future migration bug) is treated as
// "EVERY tier is protected", not as "nothing is protected". The two readings differ by
// which way the mistake destroys items: reading a missing preference as unprotected would
// let the rules silently destroy gear the player never consented to lose, and salvage is
// irreversible. So the undefined case returns null, which the caller reads as "protect
// everything, select nothing".
function autoSalvageProtectedQualities(state: GameState): Set<number> | null {
  const configured = state.salvageConfirmQualities;
  if (!Array.isArray(configured)) return null; // missing field -> protect everything
  return new Set(configured);
}

// ----------------------------------------------------------------------------
// autoSalvageDuplicateKey
// ----------------------------------------------------------------------------
// THE DUPLICATE IDENTITY, per the locked user decision: "same blueprint + same slot".
//
// Design section 7.6 phrased this as "same slotType + varietyKey". The two are the same
// grouping expressed two ways, because a blueprint's equipmentOutput pins exactly one
// (slotType, varietyKey) pair: two pieces from the same blueprint are always the same
// variety in the same slot. The blueprint key is used here because it is stored ON the
// instance (piece.blueprintKey) and needs no BLUEPRINTS lookup that could miss, and
// because it is the wording the user locked. slotType is folded into the key anyway, so a
// hypothetical future blueprint that minted into two slots would still group correctly.
//
// A Standard-Issue baseline has blueprintKey null and is excluded from the candidate pool
// long before this is called, so the key is never built from a null.
function autoSalvageDuplicateKey(piece: EquipmentInstance): string {
  return `${piece.blueprintKey ?? "baseline"}::${piece.slotType}`;
}

// ----------------------------------------------------------------------------
// autoSalvageIsBetter
// ----------------------------------------------------------------------------
// "KEEP THE BEST" (locked user decision), as a total order so a group always has exactly
// one keeper and the choice never depends on array order.
//
// Ranked: iLevel DESC, then quality DESC, then rarity DESC (rarityIndex, the same ordinal
// the budget pipeline uses), then instance id ASC as the final tie-break. The id tie-break
// is what makes the order TOTAL: without it two pieces identical on all three stats would
// be ordered by whichever the comparator happened to see first, which is array order,
// which is exactly the kind of "discovered rather than declared" ordering that turns into
// an offline/live divergence the first time an array is rebuilt in a different sequence.
//
// Returns true when `a` should be kept over `b`.
function autoSalvageIsBetter(a: EquipmentInstance, b: EquipmentInstance): boolean {
  if (a.iLevel !== b.iLevel) return a.iLevel > b.iLevel;
  if (a.quality !== b.quality) return a.quality > b.quality;
  const rarityA = rarityIndex(a.rarity);
  const rarityB = rarityIndex(b.rarity);
  if (rarityA !== rarityB) return rarityA > rarityB;
  return a.id < b.id; // total-order tie-break: never array order
}

// ----------------------------------------------------------------------------
// selectAutoSalvageTargets
// ----------------------------------------------------------------------------
// THE PURE RULE EVALUATOR. Given the saved state and how many orders the caller has room
// for, return up to `limit` salvage targets the player's rules say should be queued, in a
// deterministic order.
//
// PURE: reads state, allocates its own arrays, mutates nothing, draws no randomness, and
// returns the same answer for the same state every time. Node-testable with no tick.
//
// ⚠️ EQUIPMENT ONLY. The ship arm and the salvaged-material arm of SalvageTargetRef are
// NEVER auto-selected, on purpose and per design 7.6, which scopes the rules to "spare
// systems". Auto-tearing-down a HULL is a fleet-shape decision with a captain on it and a
// docks slot behind it; auto-spending SALVAGED MATERIALS is a gambling action (the loot
// roll) whose value depends on the player's Fleet Admiral level. Neither is a "tidy my
// spare pool" chore, which is the entire job this feature exists to do.
//
// THE PIPELINE, in order (each stage is small on purpose):
//
//   0. TWO O(1) EARLY EXITS, before the pool is ever touched. Rules off (the default for
//      every existing save) and no budget both return an empty array without scanning
//      anything, which is what keeps this affordable at the head of EVERY tick.
//   1. THE CANDIDATE POOL. Spare, non-baseline, not reserved. See the pool comment for
//      why reserved pieces are removed HERE and not only in the final safety pass.
//   2. THE RULES select from the pool (max-quality, duplicates). Union, not either/or.
//   3. THE HARD SAFETY FILTERS run over the selection, in full, as the last word. Nothing
//      leaves this function without passing them, whatever a rule concluded.
//   4. Truncate to `limit`, in the deterministic candidate order.
//
// ⚠️ WHY THE FILTERS APPEAR TWICE (stage 1 and stage 3), which looks redundant and is not:
//   * Stage 3 is the LOAD-BEARING one. It is the "after the rules select" pass the build
//     plan requires, it stands on its own, and it is what the safety tests exercise. If a
//     future rule is added and forgets to start from the pool, stage 3 still blocks every
//     protected piece.
//   * Stage 1 exists because the DUPLICATES rule RANKS a group, and what is in the group
//     changes the answer. A piece already queued or in flight for salvage is on its way
//     OUT of the pool, so letting it hold the "keeper" slot would auto-queue the last
//     remaining free copy of a variety and destroy both. Removing reserved pieces before
//     ranking is strictly the safer reading and can only ever select FEWER items.
//   * The CONFIRM-protected tier is deliberately NOT removed at stage 1. A confirm-ON
//     piece still counts as the keeper of its group (the preference means "ask me before
//     destroying this tier", not "this piece does not exist"), and stage 3 is what makes
//     sure it is never itself selected.
export function selectAutoSalvageTargets(state: GameState, limit: number): SalvageTargetRef[] {
  const rules = state.autoSalvage;

  // --- 0. EARLY EXITS -------------------------------------------------------
  // Opt-in, default off: this is the branch every save that has not touched the feature
  // takes, on every tick, forever. It must cost nothing.
  if (!rules?.enabled) return [];
  // No budget -> nothing to say. The caller has already decided the queue has no room, so
  // scanning the pool would be work whose result is discarded.
  if (limit <= 0) return [];
  // Fail-safe: an unreadable confirm preference protects EVERY tier (see the helper).
  const protectedQualities = autoSalvageProtectedQualities(state);
  if (protectedQualities === null) return [];

  // --- 1. THE CANDIDATE POOL ------------------------------------------------
  // The reservation set is derived ONCE here, not per piece: salvageReservations walks the
  // queue and the in-flight processes a single time and bins every target (its header says
  // "call this once, not per tile", and that applies just as much inside the tick).
  const reserved = salvageReservations(state).instanceIds;
  const pool = state.equipment.filter(
    (piece) =>
      // SPARE only. fittedToShipId is the single source of truth for where a piece lives;
      // an installed piece is in use and is never a candidate.
      piece.fittedToShipId === null &&
      // NEVER a Standard-Issue baseline. A baseline DESTROYS for zero reward, and
      // automatically destroying an item is a data-loss shape, so baselines are excluded
      // from the auto rules entirely and Destroy stays a manual, deliberate act.
      !isStandardIssueBaseline(piece) &&
      // Already queued or in flight -> already spoken for (see the stage 1 note above).
      !reserved.has(piece.id)
  );
  if (pool.length === 0) return [];

  // --- CANDIDATE ORDER: DECLARED, NEVER DISCOVERED --------------------------
  // Sorted by instance id, ascending, before any rule looks at the pool. state.equipment
  // is a plain array whose order is already deterministic today, so this sort changes
  // nothing about the CURRENT answer; it is here so the answer cannot start depending on
  // storage order later (the moment anything rebuilds, migrates or re-keys that array,
  // an unsorted scan would silently pick different pieces offline than live). String
  // comparison is used rather than a numeric parse of the "equip-N" suffix because the
  // requirement is a TOTAL, STATE-ONLY order, not a human-friendly one.
  const candidates = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // --- 2. THE RULES ---------------------------------------------------------
  // Selected as a Set of instance ids, so the two rules UNION cleanly: a piece both rules
  // point at is selected once, not twice.
  const selected = new Set<string>();

  // RULE A, MAX QUALITY. "Auto-queue spares at or below this quality tier." null = the
  // rule is off (which is NOT the same as 0: maxQuality 0 means "Q0 and below", a real
  // and useful setting). This rule is deliberately allowed to select the ONLY copy of a
  // variety: the player said the tier is worthless to them, and that is the whole point.
  if (rules.maxQuality !== null) {
    for (const piece of candidates) {
      if (piece.quality <= rules.maxQuality) selected.add(piece.id);
    }
  }

  // RULE B, DUPLICATES. Same blueprint + same slot, KEEP THE BEST, auto-queue the rest
  // (locked user decision). keepPerVariety is fixed at 1 this release and not yet
  // player-editable, but it is read from the rules rather than hardcoded so 5.2 (or a
  // later release) can expose it with no engine change.
  //
  // ⚠️ GROUPED OVER THE SPARE POOL ONLY. An INSTALLED piece does not count toward its
  // variety's keep quota, because the rules never touch installed gear. Counting it would
  // silently make the rule far more aggressive than the plain-language summary promises
  // ("keeping the best 1 of each type"): a player with one installed Capacitor Bank would
  // find EVERY spare Capacitor Bank queued, including their upgrade-in-waiting.
  if (rules.duplicates) {
    const keep = Math.max(0, rules.keepPerVariety);
    // Group in candidate order, so each group's member list is itself deterministic.
    const groups = new Map<string, EquipmentInstance[]>();
    for (const piece of candidates) {
      const key = autoSalvageDuplicateKey(piece);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [piece]);
      else group.push(piece);
    }
    // ⚠️ Iterating a Map is safe here ONLY because insertion order is itself derived from
    // `candidates` (which is sorted), and because the per-group result does not depend on
    // the order the groups are visited: each group is ranked independently. The final
    // output is re-ordered by `candidates` below regardless, so group visit order cannot
    // leak into the answer.
    for (const group of groups.values()) {
      if (group.length <= keep) continue; // nothing beyond the keep quota
      // Rank a COPY (sort mutates) by the total order, best first, and select everything
      // past the keep quota.
      const ranked = [...group].sort((a, b) => (autoSalvageIsBetter(a, b) ? -1 : 1));
      for (const piece of ranked.slice(keep)) selected.add(piece.id);
    }
  }

  if (selected.size === 0) return [];

  // --- 3. THE HARD SAFETY FILTERS, THE LAST WORD ----------------------------
  // Re-stated in full and applied AFTER the rules, so no rule (present or future) can
  // route around them. Walked in `candidates` order, which is the sorted order, so the
  // returned list is deterministic and the `limit` truncation below always cuts the same
  // pieces on the same state.
  //
  // ⚠️ THE ESCAPE VALVE IS INTACT: equipmentStorageCap / equipmentAtCap is NOT consulted
  // anywhere in this function, deliberately. Salvage is the always-available relief for a
  // full spare pool (salvage.ts header, 0.11.1's softlock fix), and auto-salvage is most
  // useful precisely when the pool is full. A cap check here would disable the feature at
  // the exact moment it is needed.
  const out: SalvageTargetRef[] = [];
  for (const piece of candidates) {
    if (out.length >= limit) break; // --- 4. bounded output, in deterministic order
    if (!selected.has(piece.id)) continue;
    if (isStandardIssueBaseline(piece)) continue;       // never auto-destroy a baseline
    if (piece.fittedToShipId !== null) continue;        // never touch installed gear
    if (reserved.has(piece.id)) continue;               // never double-queue a reserved target
    if (protectedQualities.has(piece.quality)) continue; // the player asked to be ASKED about this tier
    out.push({ kind: "equipment", instanceId: piece.id });
  }
  return out;
}
