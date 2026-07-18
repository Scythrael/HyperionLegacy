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
//   free(item)      = max(0, inventory[item] − allocated(item))
//
//   Only NOT-YET-STARTED iterations (`remaining`) count toward allocation: an
//   in-flight timed job already consumed its inputs at start (deduct-at-start), so
//   those units already left `inventory` and must NOT be double-counted. This is
//   what keeps `free ≥ 0` (design §1).
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
import { REFINE_RECIPES, BLUEPRINTS } from "./model";
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

// Total amount of `itemId` RESERVED across all given lines =
//   Σ over lines of  line.remaining × inputsPerIteration(line)[itemId].
// A line that doesn't consume `itemId` contributes 0 (its perIteration map has no
// entry for that key -> `?? new Decimal(0)`). No lines -> 0. PURE: reads only the
// passed lines + the static registries.
export function allocatedItem(lines: CraftLine[], itemId: string): Decimal {
  let total = new Decimal(0);
  for (const line of lines) {
    const perIteration = lineInputsPerIteration(line);
    const perItem = perIteration[itemId] ?? new Decimal(0);
    // remaining is a plain iteration COUNT -> wrap in Decimal for the product.
    total = total.plus(new Decimal(line.remaining).times(perItem));
  }
  return total;
}

// Usable stock of `itemId` = inventory − allocated, clamped at 0. The clamp is
// defensive: allocation should never exceed stock in normal operation (a line only
// reserves what it could afford at start), but a missing inventory key or any future
// edge must yield 0, never a negative "free" (design §1: free ≥ 0 always). PURE.
export function freeItem(
  inventory: Record<string, Decimal[]>,
  lines: CraftLine[],
  itemId: string,
): Decimal {
  // Quality-bucketed inventory (Task 9a): usable stock is the item's TOTAL across all
  // quality buckets, read via itemTotal (absent key -> 0, same as the old scalar
  // `inventory[itemId] ?? 0`). Allocation reserves against the total; buckets are an
  // internal storage detail the allocation math does not care about.
  const stock = itemTotal(inventory, itemId);
  const reserved = allocatedItem(lines, itemId);
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
//   The craft LINES are the SINGLE reservation source (Shipyard controller
//   correction: a ship BUILD consumes its whole BOM at START, deduct-at-start,
//   never a time-spread reservation, so it is NOT summed here; only refine +
//   fabricate lines reserve over time). Both line arrays are concatenated and
//   handed to the pure freeItem, so this inherits freeItem's clamp (free >= 0),
//   its absent-key handling (missing inventory key -> 0), and its derived-not-
//   stored guarantee with ZERO new math, it is a thin wrapper, not a second
//   implementation of the allocation formula.
//
// STRUCTURAL PARAM (not the GameState import): this module deliberately imports
//   ONLY the recipe registries (see the header's SCOPE note). Typing the param as
//   the minimal shape it actually reads, inventory + the two OPTIONAL line
//   arrays, keeps that tiny dependency surface intact (no import cycle risk with
//   model.ts's GameState) while still accepting a full GameState by structural
//   compatibility (its required CraftLine[] arrays satisfy the optional fields).
//   The `?? []` tolerates a pre-C2/pre-C6 save shape that predates either array.
// ============================================================================
export function freeItemForState(
  state: {
    inventory: Record<string, Decimal[]>;
    refineLines?: CraftLine[];
    fabricateLines?: CraftLine[];
  },
  itemId: string,
): Decimal {
  const lines = [...(state.refineLines ?? []), ...(state.fabricateLines ?? [])];
  return freeItem(state.inventory, lines, itemId);
}
