# Ship Systems Legibility (completing 0.11.0) Design

**Status:** DRAFT for user review. Raised during 0.11.0 device testing (user: "10/10 for how much I like it, not for completeness; shouldn't ship until it's done"). This work makes 0.11.0 COMPLETE before it promotes to production: you can SEE your crafted systems, READ what is installed and what it grants, and every item has a proper name. Material Lines (0.11.1) comes after this.

**Goal:** Close the four legibility gaps in the shipped-but-unpromoted 0.11.0 equipment feature so a player can name, see, and understand their ship systems. Display and naming only, no economy or stat changes.

**Scope guard:** NO new stats, slots, varieties, recipes, or balance changes. NO Material Lines work (that is 0.11.1). This is purely making the existing 0.11.0 systems legible.

---

## The four gaps (all confirmed against the code)

### Gap 1: Placeholder item names

- `refinedMaterial` has the placeholder label **"Refined Material"** (model.ts). It is the generic refined bulk milled from Titanium Ore (via `refineCommonOre`), used as filler in several recipes and facility upgrades. Needs a proper in-fiction name.
- `components` has the placeholder label **"Components"** and is **DEAD**: nothing produces it. All 12 `outputItem: "components"` references are equipment blueprints, and the Task 19 mint OVERRIDES that output to mint an `EquipmentInstance` instead. The legacy instant craft that once produced it was retired in Phase 4. So `components` is a vestigial ITEMS entry.

**Design:**
- Rename `refinedMaterial`'s label. CANDIDATES (user picks): "Machined Stock", "Alloy Billet", "Milled Alloy". The id stays `refinedMaterial` (label-only, no migration).
- Resolve `components`: RECOMMENDATION is to RETIRE the dead item and drop the vestigial `outputItem: "components"` from the equipment blueprints (see Gap 2). Verify in the plan that no live save holds a `components` stack (nothing has produced it since Phase 4); if the risk is nonzero, keep the ITEMS entry (so an old stack still renders) but rename it honestly and stop referencing it. OPEN CALL: retire vs keep-and-rename.

### Gap 2: The Fabricator mislabels what equipment crafts produce

An equipment blueprint carries `recipe.outputItem: "components"` (vestigial), so the Fabricator's order/queue UI shows an equipment craft as producing "Components" instead of the actual ship system. The Task 19 mint already branches on `equipmentOutput`; the DISPLAY does not.

**Design:** where the Fabricator surface renders a blueprint's output, branch on `equipmentOutput`: show the real ship-system name (the variety label, e.g. "Prospector Hold") and its slot, not the recipe's `outputItem`. This is the core of "the items being crafted need proper names." Retire the now-unused `outputItem`/`outputQty` on equipment blueprints if the type allows it cleanly (make them optional, mirroring how the mint already ignores them), else leave them set but never displayed.

### Gap 3: Ship Systems do not appear in the Warehouse

Crafted systems are `EquipmentInstance`s in `state.equipment`, a SEPARATE structure from the keyed inventory the Warehouse renders, so the Warehouse's shipModule/shipSystem grouping (App.svelte:586) shows nothing. The player cannot see the systems they own.

**Design:** add a **Ship Systems** view to the Warehouse that reads `state.equipment` (a read-only display bridge, NOT a data move; the equipment pool stays the source of truth). Proposed shape:
- Grouped by slot type (Cargo Bay / FTL Drive / Reactor Core / Spec Utility), the same four the install panel uses.
- Each system shows: name (variety label), rarity (with the rarity color), quality tier (0-5 badge), and STATUS: "Fitted to [ship name]" or "Spare".
- Read-only here (installing/uninstalling stays in the Ship Systems panel); optionally a link that opens the Ship Systems panel for a fitted system's ship. OPEN CALL: read-only list vs. also-link-to-panel.
- Standard-Issue baselines: show them too (honest: they are systems you own), or filter them out as noise? RECOMMENDATION: show spare/crafted systems prominently and mark Standard-Issue baselines distinctly (or collapse them), since every ship has four and they would flood the list. OPEN CALL.

### Gap 4: Slots do not show what is installed or what it grants

`ShipSystemsPanel` slots have static hover labels (Cargo Bay, Reactor Core, ...) but show neither the INSTALLED system's name nor the stats it contributes. The panel already computes base-vs-fitted derived stats; it just is not surfaced per-slot.

**Design:** for each live slot, show the fitted system's identity + its stat contribution:
- Occupant name + rarity color + quality badge, in or beside the slot (and in the slot's hover tooltip).
- The stat delta THAT system grants (e.g. "+40 cargo capacity", "+6% transit speed"), computed as the difference the piece makes. This reuses the existing `equipmentStatMods` / `shipDerivedStats` machinery: the per-piece contribution is derivable by diffing the ship's stats with and without that one piece, or by folding the single piece.
- Format: a compact readout on slot select (the panel already has a stats area) plus the name in the hover tooltip. Keep it within the LOCKED scroll-containment + existing panel layout.

---

## What this touches

- `model.ts`: `refinedMaterial` label; retire/rename `components`; make equipment blueprints' `outputItem`/`outputQty` optional if retiring (a `BlueprintDef` shape tweak); a display-name helper for crafted instances (variety label + rarity + quality) if one does not already exist.
- `App.svelte`: the Fabricator output display (Gap 2); the Warehouse Ship Systems view (Gap 3).
- `ShipSystemsPanel.svelte`: per-slot occupant name + granted-stats readout (Gap 4).
- Tests: model.test.ts naming/standing-rule guards (the "every item has a non-empty unlockHint" guard already exists; extend if `components` is retired); a helper-level test for the per-piece stat contribution and the crafted-instance display name. Svelte views are device-checked, not unit-tested here.

## Save / migration

- All renames are LABEL-only (ids unchanged): no save migration.
- Retiring `components` (if chosen): verify no live save holds it. If any could, keep the ITEMS entry so an old stack still renders. Either way, NO save-version bump for a display pass. Confirm in the plan.
- No change to `state.equipment`, the inventory shape, or any economy path. Offline/live parity is untouched (this is display only).

## Definition of done (what makes 0.11.0 "complete" and promotable)

1. Every item the player can hold or craft has a proper name (no "Refined Material" / "Components" placeholders visible).
2. Crafting a ship system shows that system's name in the Fabricator, not "Components".
3. The Warehouse shows the systems you own, with rarity and quality, and whether each is fitted or spare.
4. Each ship slot shows what is installed and the stats it grants.
5. Full gate green (check 0 errors, tests pass, build), device-checked by the user, THEN promote 0.11.0 to prod.

## Open calls for user review

1. **`refinedMaterial` name:** "Machined Stock", "Alloy Billet", "Milled Alloy", or your own?
2. **Dead `components` item:** retire it (my rec, pending save-safety check) or keep-and-rename?
3. **Warehouse Ship Systems view:** read-only list, or also link fitted systems to their ship's install panel? And do Standard-Issue baselines show (marked/collapsed) or get filtered as noise?
4. **Anything else you noticed while testing** that belongs in "make 0.11.0 complete" before it ships to prod?
