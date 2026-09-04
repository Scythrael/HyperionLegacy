// ============================================================================
// Crafting Allocation Redesign, Task C1: derived material-allocation core
//
// Author: Claude (Opus 4.8) | Date: 2026-07-16
// Plan: docs/plans/2026-07-16-crafting-allocation-redesign-plan.md (Task C1)
// Design: docs/plans/2026-07-16-crafting-allocation-redesign-design.md (§1)
//
// PURPOSE
//   The foundation of the material-allocation subsystem. When the player starts a
//   craft, its yet-to-run iterations RESERVE their inputs so a second craft (or a
//   different consumer) can't spend the same units first, no double-spend, and a
//   cancel simply releases the reservation. Crucially, allocation is DERIVED, never
//   stored: the active craft LINES are the single source of truth, and
//   `allocated(item)` is recomputed from them on demand. This kills any risk of a
//   stored ledger drifting out of sync with reality (design §1).
//
//   allocated(item) = Σ over active lines L of  L.remaining × inputsPerIteration(L)[item]
//                   + Σ over QUEUED craft orders Q of  iterations(Q) × inputsPerIteration(Q)[item]
//   free(item)      = max(0, inventory[item] − allocated(item))
//
//   Only NOT-YET-STARTED iterations (`remaining`) count toward allocation: an
//   in-flight timed job already consumed its inputs at start (deduct-at-start), so
//   those units already left `inventory` and must NOT be double-counted. This is
//   what keeps `free ≥ 0` (design §1).
//
// ⚠️ QUEUED ORDERS RESERVE TOO (0.13.3 follow-up, 2026-09-04, user-approved behavior
//   change). The second sum above is new. Before it, a queued craft order reserved
//   NOTHING, so a player could park an order and then watch a facility upgrade, a ship
//   build, or a second line spend the very materials that order was waiting to use. The
//   order then sat blocked on a shortage the player had no way to see coming. A queued
//   order now holds its inputs from the moment it is queued until the moment it promotes
//   into a real line (which is the SAME reservation, just carried by a CraftLine instead
//   of a QueuedJob, so there is no instant where the units look free).
//
// ⚠️ RESERVED BY DERIVATION, NEVER BY DEDUCTION, AND THAT IS A HARD RULE.
//   Nothing is withdrawn from `inventory` at enqueue and nothing is deposited back on
//   cancel. The reservation is recomputed from state.processQueue on every read, exactly
//   the way the line half already works and exactly the way reservation.ts derives the
//   salvage reservations. The reason is concrete, not stylistic: clampInventoryToCaps
//   trims over-cap stacks and DISCARDS the overflow, and it runs on every load. A cancel
//   that deposited materials back while the player sat at cap would push the refund over
//   the cap and the game would silently destroy it, which the project forbids outright.
//   A derived reservation never moves a material, so there is no deposit, no overflow and
//   no loss. (Ship builds are the counter-example: they deduct their whole BOM atomically
//   at start, which is exactly why a build cannot be cancelled. Do not copy that here.)
//
// SCOPE (Task C1 is the PURE foundation ONLY)
//   These helpers take the `lines` array as a PARAMETER rather than reading it off
//   GameState, because the `refineLines`/`fabricateLines` arrays don't exist on
//   GameState yet, Task C2 adds them and wires these helpers to read them. Keeping
//   `lines` a parameter makes the whole core fully unit-testable NOW, before any
//   state or engine change. This module mutates NOTHING and imports only the static
//   recipe registries.
// ============================================================================

import Decimal from "break_infinity.js";
// SHIP_TYPES joins the two recipe registries here for the queue-engine extension
// (2026-09-04): a QUEUED SHIP BUILD reserves its bill of materials by derivation, and the
// BOM lives on SHIP_TYPES[key].buildRecipe.components. Same runtime-import direction the two
// registries above already use, so the module graph is unchanged.
import { REFINE_RECIPES, BLUEPRINTS, SHIP_TYPES } from "./model";
import type { ShipTypeKey } from "./model";
// TYPE-ONLY, AND IT MUST STAY THAT WAY. model.ts already imports CraftLine /
// CraftLineKind / CraftLineMode FROM this file (as types), so a RUNTIME import in this
// direction would close a real cycle. Both directions are erased at build time, so the
// module graph stays a DAG and this file stays the pure leaf its header promises.
import type { QueuedJob, QueuedOrder } from "./model";
import { itemTotal } from "./inventory";

// --- Functions ---------------------------------------------------------------

// The two facilities that own craft lines. A refine line runs a REFINE_RECIPES
// entry; a fabricate line runs a (researched) BLUEPRINTS entry. Named union (not a
// bare string), matching model.ts's convention for every small enum so a future
// facility kind slots in as a new literal without touching call sites.
export type CraftLineKind = "refine" | "fabricate";

// A production line's RUN MODE (Task C2). Structurally identical to the RefineOrderMode /
// FabricateOrderMode single-order shapes it replaced (removed from model.ts in Task C4),
// kept as a discriminated union so a future mode slots in without touching every
// consumer that switches on `kind`:
//   - batch: run a FIXED number of iterations, then the line clears itself.
//   - continuous: run UNBOUNDED until the player cancels the line.
//
// ⚠️ RELATIONSHIP TO CraftLine.remaining (the allocation basis), READ THIS:
//   For a BATCH line, `mode.remaining` and the top-level `line.remaining` are the
//   SAME live count (iterations not yet started) and are ALWAYS updated together in
//   one object construction by the engine (processRefineLines/processFabricateLines,
//   tick.ts), they cannot drift because they are never written apart. `line.remaining`
//   is the field the PURE allocation helpers below read (they know nothing about
//   `mode`); `mode.remaining` is the same value carried on the discriminated union so
//   the engine/UI can switch on `mode.kind` and read the count in one place. (This
//   duplication is a deliberate, contained mirror of the retired order shape, not a
//   stored ledger, flagged as an Omega-4 consolidation candidate for a later pass.)
//   For a CONTINUOUS line, `mode` carries no count; the top-level `line.remaining` is
//   held at 1 (it reserves exactly its ONE queued next iteration, so that iteration's
//   inputs are guaranteed affordable from `free` when its slot next frees) and is
//   never decremented.
export type CraftLineMode =
  | { kind: "batch"; remaining: number }
  | { kind: "continuous" };

// One active production line = one configured craft occupying one facility slot.
// `remaining` is the count of iterations NOT YET STARTED (whose inputs are still
// reserved in `inventory`); an iteration drops out of `remaining` the moment its
// timed job starts and its inputs are consumed. This is the ONLY field allocation
// math reads besides the recipe, see the module header for why in-flight
// iterations are deliberately excluded, and see CraftLineMode above for how
// `remaining` relates to `mode` per run mode.
export interface CraftLine {
  id: string;
  kind: CraftLineKind;
  recipeKey: string; // REFINE_RECIPES key when kind==="refine"; BLUEPRINTS key when "fabricate"
  remaining: number; // iterations not yet started (inputs still reserved, not yet consumed), allocation basis
  mode: CraftLineMode; // batch (fixed N) or continuous (unbounded); see CraftLineMode's ⚠️ note
}

// Inputs consumed by a SINGLE iteration of this line, as a fresh Decimal map keyed
// by itemId. Refine recipes already store their inputs as Decimals
// (RefineRecipeDef.input: Record<string, Decimal>), so we clone those values into a
// new object (never alias the shared registry Decimal, callers must not mutate
// the table). Fabricate recipes store PLAIN NUMBER quantities
// (BlueprintDef.recipe.inputs: Record<string, number>), so each is wrapped in a new
// Decimal here, the same "plain number in the table, Decimal at the math site"
// convention the fuel/refine engines use.
//
// DEFENSIVE: an unknown recipeKey (or a kind with no matching registry entry)
// returns {}, an empty input map, so the line reserves nothing rather than
// throwing. This mirrors the forward-loose, runtime-guarded lookups the rest of the
// engine uses on these Record<string, ...> registries.
export function lineInputsPerIteration(line: CraftLine): Record<string, Decimal> {
  const result: Record<string, Decimal> = {};

  if (line.kind === "refine") {
    const recipe = REFINE_RECIPES[line.recipeKey];
    if (!recipe) return result; // unknown recipe -> reserve nothing
    // recipe.input values are ALREADY Decimals; clone into a fresh map so the
    // returned object never aliases the shared registry instance.
    for (const [itemId, amount] of Object.entries(recipe.input)) {
      result[itemId] = new Decimal(amount);
    }
    return result;
  }

  // kind === "fabricate"
  const blueprint = BLUEPRINTS[line.recipeKey];
  if (!blueprint) return result; // unknown blueprint -> reserve nothing
  // recipe.inputs values are PLAIN NUMBERS -> wrap each in a Decimal.
  for (const [itemId, qty] of Object.entries(blueprint.recipe.inputs)) {
    result[itemId] = new Decimal(qty);
  }
  return result;
}

// ----------------------------------------------------------------------------
// Queued craft orders: how many iterations one reserves, and what that costs
// ----------------------------------------------------------------------------

// Iterations a queued craft order reserves: a batch reserves its FULL count, a
// continuous order reserves exactly its ONE queued next iteration (the same rule a
// running continuous line follows, see CraftLineMode's ⚠️ note above).
//
// THIS IS THE CANONICAL DEFINITION and it lives here, in the leaf, because the
// reservation math is what makes the number load-bearing: it has to be the SAME count
// the promotion gate later validates and the same count startLine will reserve as a
// line. tick.ts's queuedLineIterations now delegates to this rather than carrying its
// own copy, so the queue's reservation and the queue's gate can never drift apart.
export function queuedOrderIterations(mode: CraftLineMode): number {
  return mode.kind === "batch" ? mode.remaining : 1;
}

// TOTAL inputs one QUEUED order reserves, as a fresh Decimal map keyed by itemId =
// iterations(order) × inputsPerIteration(order's recipe).
//
// A SALVAGE order returns {} deliberately: a salvage reserves its TARGET, not a
// material input, and that reservation is derived separately by reservation.ts. Folding
// the two would give one item id two different reservation meanings.
//
// Reuses lineInputsPerIteration by handing it a PROBE line carrying only the two fields
// that lookup reads (kind + recipeKey), which is the same probe idiom
// maxAffordableIterations already uses. An unknown recipe therefore yields {} through
// lineInputsPerIteration's own defensive empty map: a garbage order reserves nothing
// rather than throwing or reserving a phantom amount.
//
// A RESEARCH order returns {} deliberately too: research costs TIME and CREDITS only (no
// material inputs at all, locked design #3), and credits are outside the derived-reservation
// model entirely. See the Research Lab's QUEUE_ADAPTERS row for why a credit reservation is
// not a thing this engine can honestly derive.
//
// A SHIP BUILD order returns its FULL BILL OF MATERIALS (queue-engine extension, 2026-09-04).
// This is the A8 precedent applied to the most expensive order in the game: nothing is
// withdrawn when the build is queued and nothing is deposited when it is removed, the
// reservation simply stops being derived. It matters more here than anywhere else, because
// startShipBuild spends the whole BOM atomically at start; without this arm a queued build
// would watch another line, another build or a facility upgrade eat its hull plating and then
// sit at the head of the queue starving. Its CREDITS are deliberately not reserved (same
// reason as research); a queued build short of credits waits visibly at promotion.
//
// ⚠️ WRITTEN AS AN EXHAUSTIVE SWITCH, NOT AS AN EARLY RETURN ON `!== "craftLine"`. That is
// the whole reason this rewrite exists: the old guard meant "every non-craft order reserves
// nothing", which was the correct reading of two arms and became a SILENT under-reservation
// the moment a fourth arm carried real materials. A missing arm is now a compile error.
//
// PURE: reads only the passed order + the static registries.
export function queuedOrderInputs(order: QueuedOrder): Record<string, Decimal> {
  switch (order.type) {
    case "salvage":
    case "research":
      return {};
    case "craftLine": {
      const perIteration = lineInputsPerIteration({
        id: "",
        kind: order.kind,
        recipeKey: order.recipeKey,
        remaining: 0,
        mode: order.mode,
      });
      const iterations = queuedOrderIterations(order.mode);
      const result: Record<string, Decimal> = {};
      for (const [itemId, per] of Object.entries(perIteration)) {
        // per is a fresh Decimal from lineInputsPerIteration (never the registry's own
        // instance), and .times returns a new one, so nothing shared is touched here.
        result[itemId] = per.times(iterations);
      }
      return result;
    }
    case "shipBuild": {
      // An unknown hull key yields {} through the same defensive shape lineInputsPerIteration
      // uses for an unknown recipe: a garbage order reserves nothing rather than throwing, and
      // the promotion gate refuses it with canBuildShip's accurate `notFound`.
      const def = SHIP_TYPES[order.typeKey as ShipTypeKey];
      if (def === undefined) return {};
      const result: Record<string, Decimal> = {};
      // A ship BOM is a plain-number map (recipe scale, not idle scale), wrapped in a fresh
      // Decimal at exactly the point startShipBuild wraps it, so the reservation and the
      // eventual deduct are provably the same numbers. One hull per order, so there is no
      // iteration multiplier here (see QueuedOrder's note on why the arm carries no count).
      for (const [itemId, amount] of Object.entries(def.buildRecipe.components)) {
        result[itemId] = new Decimal(amount);
      }
      return result;
    }
  }
}

// Total amount of `itemId` RESERVED, across both reservation sources =
//   Σ over lines  of  line.remaining × inputsPerIteration(line)[itemId]
// + Σ over queued of  iterations(order) × inputsPerIteration(order)[itemId].
// A line or order that doesn't consume `itemId` contributes 0 (its perIteration map has
// no entry for that key -> `?? new Decimal(0)`). Nothing running and nothing queued -> 0.
// PURE: reads only the passed lines/queue + the static registries.
//
// ⚠️ `queued` IS A REQUIRED PARAMETER, NOT AN OPTIONAL ONE WITH A `[]` DEFAULT. A default
// would let a call site silently keep the OLD, leaky answer (queued orders reserving
// nothing) just by not being updated, which is precisely the bug this change exists to
// close. Making it required turns every unconverted call site into a compile error, so
// the compiler enumerates them instead of the reader having to.
export function allocatedItem(lines: CraftLine[], queued: QueuedJob[], itemId: string): Decimal {
  let total = new Decimal(0);
  for (const line of lines) {
    const perIteration = lineInputsPerIteration(line);
    const perItem = perIteration[itemId] ?? new Decimal(0);
    // remaining is a plain iteration COUNT -> wrap in Decimal for the product.
    total = total.plus(new Decimal(line.remaining).times(perItem));
  }
  for (const job of queued) {
    // queuedOrderInputs has already multiplied by the order's iteration count, so this
    // arm adds the whole amount rather than a per-iteration one. A queued SALVAGE order
    // contributes {} (see queuedOrderInputs), so it adds 0 here.
    const inputs = queuedOrderInputs(job.order);
    total = total.plus(inputs[itemId] ?? new Decimal(0));
  }
  return total;
}

// Usable stock of `itemId` = inventory − allocated, clamped at 0. The clamp is
// defensive: allocation should never exceed stock in normal operation (a line only
// reserves what it could afford at start, and as of 0.13.3 a queued order is only
// accepted when its inputs are free, see canReserveOrder below), but a missing inventory
// key, an out-of-band inventory drop (a mission consuming stock, an over-cap clamp), or
// any future edge must yield 0, never a negative "free" (design §1: free ≥ 0 always).
// PURE.
export function freeItem(
  inventory: Record<string, Decimal[]>,
  lines: CraftLine[],
  queued: QueuedJob[],
  itemId: string,
): Decimal {
  // Quality-bucketed inventory (Task 9a): usable stock is the item's TOTAL across all
  // quality buckets, read via itemTotal (absent key -> 0, same as the old scalar
  // `inventory[itemId] ?? 0`). Allocation reserves against the total; buckets are an
  // internal storage detail the allocation math does not care about.
  const stock = itemTotal(inventory, itemId);
  const reserved = allocatedItem(lines, queued, itemId);
  return Decimal.max(new Decimal(0), stock.minus(reserved));
}

// ============================================================================
// Shipyard Task S2, state-taking convenience over freeItem.
//
// PURPOSE
//   `freeItem(inventory, lines, itemId)` above is the PURE core: it takes the
//   reservation `lines` array explicitly (so C1 could unit-test it before the
//   lines lived on GameState). But every MATERIAL SPEND-GATE in the engine
//   (canBuildFacilityUpgrade, and S3's canBuildShip) has the whole GameState in
//   hand and just wants "usable stock of X". Re-threading the lines at each call
//   site duplicates the "combine both facilities' line arrays" step (it already
//   appears inline in tick.ts's canStartLine preview and in App.svelte). This
//   convenience folds that step into ONE place so a spender writes
//   `freeItemForState(state, itemId)` and nothing more.
//
//   The craft LINES were the SINGLE reservation source (Shipyard controller
//   correction: a ship BUILD consumes its whole BOM at START, deduct-at-start,
//   never a time-spread reservation, so it is NOT summed here; only refine +
//   fabricate lines reserve over time). As of the 0.13.3 follow-up the QUEUED
//   craft orders are a second source, so this wrapper folds in state.processQueue
//   as well. That is the whole protection the change buys: every material spender
//   in the engine (facility upgrades, docks + equipment-storage expansions, ship
//   builds, new craft lines) already gates on this one function, so they ALL now
//   respect a queued order's reservation without a single edit at their own sites.
//   Both line arrays are concatenated and handed, with the queue, to the pure
//   freeItem, so this inherits freeItem's clamp (free >= 0), its absent-key
//   handling (missing inventory key -> 0), and its derived-not-stored guarantee
//   with ZERO new math, it is a thin wrapper, not a second implementation of the
//   allocation formula.
//
// STRUCTURAL PARAM (not the GameState import): this module deliberately imports
//   ONLY the recipe registries (see the header's SCOPE note). Typing the param as
//   the minimal shape it actually reads, inventory + the two OPTIONAL line
//   arrays + the OPTIONAL queue, keeps that tiny dependency surface intact (no
//   import cycle risk with model.ts's GameState) while still accepting a full
//   GameState by structural compatibility (its required arrays satisfy the
//   optional fields). The `?? []` tolerates a pre-C2/pre-C6 save shape that
//   predates either line array, and a pre-0.13.3 shape that predates processQueue.
// ============================================================================
export function freeItemForState(
  state: {
    inventory: Record<string, Decimal[]>;
    refineLines?: CraftLine[];
    fabricateLines?: CraftLine[];
    processQueue?: QueuedJob[];
  },
  itemId: string,
): Decimal {
  const lines = [...(state.refineLines ?? []), ...(state.fabricateLines ?? [])];
  return freeItem(state.inventory, lines, state.processQueue ?? [], itemId);
}

// ============================================================================
// canReserveOrder: THE ENQUEUE AFFORDABILITY POLICY, ISOLATED ON PURPOSE
// (Crafting 0.13.3 follow-up, 2026-09-04, user-approved behavior change.)
//
// ⚠️ THIS REVERSES DESIGN SECTION 5.3. That section said, in as many words, that
// enqueue deliberately does NOT check affordability, because "queue work you cannot
// afford yet" was the queue's whole purpose. It was written when a queued order
// reserved nothing. Now that a queued order RESERVES its inputs, that policy no longer
// type-checks against reality: reserving materials you do not hold reserves nothing, it
// just prints a number the player cannot act on and lets the queue claim stock that is
// not there. So enqueue now requires the order's inputs to be FREE right now. The design
// doc and the code disagree on this point until the doc is amended; this comment is the
// record of which one is current, so a future reader does not "restore" 5.3 by mistake.
//
// ⚠️ THE POLICY LIVES HERE, IN ONE PREDICATE, WITH ONE CALLER (canEnqueueOrder in
// tick.ts). That isolation is deliberate and it was the user's explicit condition: they
// weighed this against the alternative policy ("reserve what you can, queue the rest
// anyway, and let the reservation grow as stock arrives") and may revisit it. Switching
// policies must stay a ONE-SITE change, so nothing outside this function may encode the
// rule, and no caller may re-derive it.
//
// WHAT IT DOES NOT DECIDE, also deliberately:
//   - A SALVAGE order always passes. Salvage reserves a TARGET, not material inputs, and
//     that reservation (plus its own duplicate/holding rules) belongs to reservation.ts
//     and canStartSalvage. Answering ok here keeps this predicate about materials only.
//   - An UNKNOWN recipe always passes, because queuedOrderInputs returns {} for one and
//     the loop below never runs. That is the honest answer for THIS question (a recipe
//     with no inputs reserves nothing, so nothing can be short) and it preserves the
//     existing behavior for a garbage key: it enqueues, and the promotion gate refuses it
//     with `notFound`, which is the accurate reason. Reporting "materials" there would be
//     a true refusal with a false explanation.
//
// PURE predicate: reads state, spends nothing, mutates nothing, same posture as
// canStartLine / canEnqueueOrder. Typed-reason return, matching the file's gate idiom.
// ============================================================================

// Why an order's inputs cannot be reserved. Exactly one member today, and it is named
// `materials` on purpose: it is the SAME token canStartLine already returns for the same
// underlying condition, so the UI reuses one sentence instead of inventing a second
// wording for "not enough of it".
export type ReserveBlockReason = "materials";

export function canReserveOrder(
  state: {
    inventory: Record<string, Decimal[]>;
    refineLines?: CraftLine[];
    fabricateLines?: CraftLine[];
    processQueue?: QueuedJob[];
  },
  order: QueuedOrder,
): { ok: true } | { ok: false; reason: ReserveBlockReason } {
  // The order's FULL cost (iterations already folded in), or {} for a salvage order or an
  // unknown recipe. An empty map means the loop never runs and the answer is ok.
  const inputs = queuedOrderInputs(order);
  for (const [itemId, required] of Object.entries(inputs)) {
    // FREE, not raw stock: the pool this order would draw from is what is left after the
    // running lines AND the already-queued orders have taken their share. Asking against
    // raw inventory would let two queued orders both claim the same units, which is the
    // double-book this whole change exists to prevent.
    if (freeItemForState(state, itemId).lt(required)) return { ok: false, reason: "materials" };
  }
  return { ok: true };
}
