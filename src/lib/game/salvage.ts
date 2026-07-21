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
//   - DO NOT wire salvageEquipment, salvageSalvagedMaterial, OR salvageShip into any
//     economy-tick path. salvage.test.ts greps tick.ts to prove ALL THREE stay out; that
//     guard is load-bearing. (salvageShip is INSTANT this patch but is slated to become a
//     multi-tick TIMED teardown in a later task, at which point it moves into the tick path
//     and takes on its OWN offline-parity obligation, see the salvageShip header.)
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
import { BLUEPRINTS, ITEMS, SALVAGE_LOOT_POOLS, HOMEWORLD_TALENTS, SHIP_TYPES } from "./model";
import { addItemQuality, itemTotal, removeItemLowestFirst } from "./inventory";
// onMissionLock is the equipment fitment's shared "is this ship's captain out on a
// mission?" guard. salvageShip (below) reuses it verbatim so a hull that is locked for
// FITMENT mid-mission is locked for SALVAGE too, one source of truth for that lock.
import { onMissionLock } from "./equipment";

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
//   Equipment recycle (salvageEquipment), a spare system (crafted OR baseline) qualifies:
//     notFound             no equipment piece with that id
//     fitted               the piece is fitted to a ship (unfit it first)
//   (A Standard-Issue baseline is NOT refused: it salvages as a zero-reward declutter,
//    see salvageEquipment below. So there is no baseline-specific reject reason.)
//   Salvaged-material loot roll (salvageSalvagedMaterial):
//     notSalvagedMaterial  the item id is not a `salvagedMaterial` category item (only
//                          salvaged materials carry a loot pool)
//     noneHeld             the player holds zero of that salvaged material
//   Ship salvage (salvageShip), tearing a whole hull down for parts:
//     shipNotFound         no ship in the fleet with that id
//     shipOnMission        the ship's assigned captain is out on an active mission, so
//                          the hull cannot be torn apart mid-flight (same lock fitment uses)
export type SalvageRejectReason =
  | "notFound"
  | "fitted"
  | "notSalvagedMaterial"
  | "noneHeld"
  | "shipNotFound"
  | "shipOnMission";

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
// REJECTS (same-ref no-op + reason) only when the target is missing or fitted. A spare
// piece is always salvageable: a CRAFTED spare recovers a rolled fraction of its recipe
// inputs; a Standard-Issue BASELINE has no recipe, so it salvages as a zero-reward
// DECLUTTER (removed, recovers nothing), see the baseline branch below.
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
  // recipe to refund. Rather than block it, salvage it as a pure DECLUTTER (user
  // decision 2026-07-21): remove the spare baseline and recover NOTHING. The zero
  // reward is deliberate and load-bearing: baselines are free (a spare one can be
  // produced at no material cost), so ANY payout here would be a farmable resource
  // source (Omega 6). An empty `recovered` map tells the caller to render a
  // "discarded, no materials" outcome instead of a recovery summary. This only ever
  // runs on a SPARE baseline: a fitted one is caught by the `fitted` guard above, and
  // the live-slot never-empty invariant is untouched (this removes a pool spare, not
  // a slot occupant).
  if (piece.blueprintKey === null) {
    const equipment = state.equipment.filter((e) => e.id !== instanceId);
    return { ok: true, next: { ...state, equipment }, recovered: {} };
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

// ============================================================================
// Ship salvage (break down a hull you no longer need)
// ============================================================================
// salvageShip: a THIRD salvage entry point (a distinct code path again, per the design's
// "each salvage model is its own path" posture), tearing a whole SHIP down for a fraction
// of what the hull cost to build. It mirrors salvageEquipment's recycle band and its
// LIVE-ONLY, INSTANT, same-ref-reject shape, but operates on a ShipInstance instead of a
// spare EquipmentInstance and additionally refunds credits.
//
// ⚠️ DELIBERATELY INSTANT FOR NOW: unlike recycling one spare system, physically tearing an
// entire hull apart is NOT a plausibly-instant act. This function is intentionally instant
// THIS patch to ship the capability with the same simple, proven live-action shape as the
// other two salvages; a FUTURE task converts it into a MULTI-TICK TIMED teardown process
// (a TimedProcess / ProcessLine with a durationTicks, like a ship BUILD in reverse). Do NOT
// treat this instant form as final. When the timed version lands it must move OUT of this
// live-only file into the process engine, at which point the parity concerns below change,
// so the conversion is not a trivial rename.
//
// SAME PARITY BOUNDARY as the other two salvages (see the file header): this is a LIVE-ONLY,
// player-initiated INSTANT action. It uses Math.random (injectable ONLY for tests) and MUST
// NOT be wired into economyTick / the offline tick() / resolveProcesses. salvage.test.ts
// greps tick.ts to prove ALL THREE salvage functions stay out of the economy seam; that
// guard is load-bearing. (Once salvageShip becomes a timed teardown it WILL live in the
// tick path, and THAT change must carry its own offline==live parity proof.)

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
// rng defaults to Math.random and is injectable ONLY for tests (see the PARITY BOUNDARY note
// above: this is a live instant action, so a real random roll is correct here).
//
// REJECTS (same-ref no-op + reason): the ship id must resolve to a real hull (shipNotFound),
// and its assigned captain must NOT be on an active mission (shipOnMission, via the shared
// onMissionLock guard reused from the fitment system). Only then is a reward computed and a
// new state built.
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
  // On-mission lock: reuse the fitment system's shared guard (Omega 4, DRY) so a hull whose
  // captain is out flying cannot be torn apart mid-mission, the SAME rule that blocks changing
  // its fitment. The ship is known to exist here (checked above), so any block onMissionLock
  // reports is specifically the on-mission case; map it to this file's reason vocabulary.
  const lock = onMissionLock(state, shipId);
  if (!lock.ok) {
    return { ok: false, next: state, reason: "shipOnMission" };
  }

  // --- Return crafted systems to the spare pool; discard baselines ----------
  // fittedToShipId is the SINGLE SOURCE OF TRUTH for where a piece lives (model.ts). For the
  // pieces fitted to THIS hull:
  //   crafted   (blueprintKey !== null)  -> unfit to the spare pool (set fittedToShipId null),
  //                                         so the player NEVER loses hard-crafted gear when a
  //                                         hull is scrapped, it survives as a reusable spare.
  //   baseline  (blueprintKey === null)  -> DISCARDED (dropped from the array). Standard-Issue
  //                                         is free + craftless, so there is nothing to preserve;
  //                                         the never-empty invariant mints a fresh one for any
  //                                         OTHER hull that needs it, not this destroyed one.
  // Pieces fitted to a DIFFERENT ship (or already spare) are untouched.
  //
  // NOTE (equipment-cap overflow, allowed): the returned crafted spares may push the spare
  // pool OVER equipmentStorageCap. That is intentional and fine, the cap gates CRAFTING new
  // systems (canFabricate), NOT returns from a scrapped hull. A player who overflows simply
  // cannot craft more until they trim the pool (via salvageEquipment) back under the cap; no
  // spare is ever destroyed by the cap here.
  const equipment = state.equipment
    // Drop this hull's free baselines.
    .filter((e) => !(e.fittedToShipId === shipId && e.blueprintKey === null))
    // Unfit this hull's crafted systems back to the spare pool.
    .map((e) =>
      e.fittedToShipId === shipId && e.blueprintKey !== null ? { ...e, fittedToShipId: null } : e
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
