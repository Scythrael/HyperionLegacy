// ============================================================================
// Crafting Allocation Redesign -- Task C1: derived material-allocation core
//
// Author: Claude (Opus 4.8) | Date: 2026-07-16
// Plan: docs/plans/2026-07-16-crafting-allocation-redesign-plan.md (Task C1)
// Design: docs/plans/2026-07-16-crafting-allocation-redesign-design.md (§1)
//
// PURPOSE
//   The foundation of the material-allocation subsystem. When the player starts a
//   craft, its yet-to-run iterations RESERVE their inputs so a second craft (or a
//   different consumer) can't spend the same units first -- no double-spend, and a
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
//   GameState yet -- Task C2 adds them and wires these helpers to read them. Keeping
//   `lines` a parameter makes the whole core fully unit-testable NOW, before any
//   state or engine change. This module mutates NOTHING and imports only the static
//   recipe registries.
// ============================================================================

import Decimal from "break_infinity.js";
import { REFINE_RECIPES, BLUEPRINTS } from "./model";

// --- Functions ---------------------------------------------------------------

// The two facilities that own craft lines. A refine line runs a REFINE_RECIPES
// entry; a fabricate line runs a (researched) BLUEPRINTS entry. Named union (not a
// bare string), matching model.ts's convention for every small enum so a future
// facility kind slots in as a new literal without touching call sites.
export type CraftLineKind = "refine" | "fabricate";

// One active production line = one configured craft occupying one facility slot.
// `remaining` is the count of iterations NOT YET STARTED (whose inputs are still
// reserved in `inventory`); an iteration drops out of `remaining` the moment its
// timed job starts and its inputs are consumed. This is the ONLY field allocation
// math reads besides the recipe -- see the module header for why in-flight
// iterations are deliberately excluded.
export interface CraftLine {
  id: string;
  kind: CraftLineKind;
  recipeKey: string; // REFINE_RECIPES key when kind==="refine"; BLUEPRINTS key when "fabricate"
  remaining: number; // iterations not yet started (inputs still reserved, not yet consumed)
}

// Inputs consumed by a SINGLE iteration of this line, as a fresh Decimal map keyed
// by itemId. Refine recipes already store their inputs as Decimals
// (RefineRecipeDef.input: Record<string, Decimal>), so we clone those values into a
// new object (never alias the shared registry Decimal -- callers must not mutate
// the table). Fabricate recipes store PLAIN NUMBER quantities
// (BlueprintDef.recipe.inputs: Record<string, number>), so each is wrapped in a new
// Decimal here -- the same "plain number in the table, Decimal at the math site"
// convention the fuel/refine engines use.
//
// DEFENSIVE: an unknown recipeKey (or a kind with no matching registry entry)
// returns {} -- an empty input map, so the line reserves nothing rather than
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
  inventory: Record<string, Decimal>,
  lines: CraftLine[],
  itemId: string,
): Decimal {
  const stock = inventory[itemId] ?? new Decimal(0);
  const reserved = allocatedItem(lines, itemId);
  return Decimal.max(new Decimal(0), stock.minus(reserved));
}
