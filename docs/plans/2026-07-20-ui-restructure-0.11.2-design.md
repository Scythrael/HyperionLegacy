# 0.11.2 "UI Restructure" design

**Status:** VALIDATED design (user-approved via the nav+Warehouse mockup and the brainstorm Q&A on 2026-07-20). Next step is a plan doc (writing-plans), then subagent-driven build. Supersedes the Quartermaster-facility plan in `2026-07-18-0.11.1-ui-restructure-notes.md` (see "Supersessions" below).

Builds on 0.11.0 "Ship Systems" (equipment engine, capped Systems storage, `salvage.ts` recycle + loot roll, Warehouse Ship Systems + Salvaged Materials interim tabs, EquipmentTooltip) and the 0.11.1 "Fleet Management" emergency softlock fix (docks capacity + ship salvage). This is the planned restructure that 0.11.0 shipping gear inside the Warehouse was conditioned on.

---

## 1. Goal

Reorganize the game's navigation and storage so the whole thing reads like a fleet admiral's command terminal listing its offerings, and give the 0.11.0 finished goods (plus salvage and a Help manual) a proper home. Same visual look throughout: this is an information-architecture and naming reorganization, NOT a visual redesign or reskin. The existing Panel chamfer/glow theme, the EquipmentTooltip, and all content panels are preserved.

## 2. What the user decided (locked, do not re-litigate)

1. **One feature-complete patch.** Everything below ships together as 0.11.2, not in layers.
2. **The desk-terminal-OS lens = a navigation reorganization + renaming**, same look. Tabs become function-named "programs" a terminal would present.
3. **Storage stays ONE place** (the Warehouse). No separate Quartermaster facility. The finished-goods vs materials split is a top-level tab split WITHIN the Warehouse, not a second building. (User reasoning, self-generated: installing happens in the Ship Systems panel and salvaging in the Salvage Bay, so a second passive storage screen would add navigation cost for no player benefit.)
4. **Salvaging is its own facility** (the Salvage Bay): storage is one place, salvage is a place you DO something.
5. **Deuterium Ice gets its own "Volatiles" sub-category** in the Warehouse (it is raw but only feeds the Fuel Depot, so it is not grouped with crafting ores).
6. **Program names FOUNDRY / DRYDOCK / STORES are kept** (working titles accepted).
7. **Salvage confirm is a per-quality configurable preference**: the player can select, across all quality tiers, which ones require a confirm before salvaging. Defaults safe (confirm on everything).
8. **The current EquipmentTooltip design survives unchanged** (Anti-Regression hard constraint). Every gear display reuses it as-is.
9. **Help tab = a core systems manual** (static, structured, grows as features ship).
10. **"fitment" to "install ship systems" terminology sweep** of ALL user-facing text. Code vocabulary (`fitEquipment`, `EquipmentInstance`, `fittedToShipId`, etc.) stays internal.

## 3. Navigation reorganization (the "terminal programs")

Today the top level is 6 tabs: Locations, Facilities, Command, Operations, Battlespace, System. The muddiness: Locations and Facilities both organize BY PLACE (Homeworld/Sector), while Command/Operations organize by function, and ship work is split (Docks lives under Locations, the Shipyard that builds those hulls lives under Facilities). The reorg makes every top-level entry a functional program.

### 3a. Before to after mapping

| Program (working name) | Contents | Pulled from today |
|---|---|---|
| **CREW** | Captains + captain talents | Command (fleetCaptains), unchanged content |
| **OPERATIONS** | Dispatch missions + the Mission Control unlock track | Operations + Mission Control (moved out of Facilities) |
| **FOUNDRY** | Refinery, Fabricator, Research Lab, Fuel Depot | Facilities (the make-stuff facilities) |
| **DRYDOCK** | Shipyard (build hulls) + Docks (assign hulls to captains) + Requisition | Facilities to Shipyard, Locations to Sector (Docks + Requisition) |
| **STORES** | Warehouse (Materials + Finished Goods) + Salvage Bay | Facilities to Warehouse + the new Salvage Bay |
| **HOMEWORLD** | Homeworld Overview + Administration (homeworld talents) | Locations to Homeworld |
| **BATTLESPACE** | Combat (unchanged, future) | Battlespace |
| **SYSTEM** / **HELP** | Options; the new manual | System + new Help |

### 3b. Placement details to finalize during planning (minor, non-blocking)

- **Requisition** currently sits beside Docks under Locations to Sector. Default: keep it with Docks in DRYDOCK (they are siblings today, least disruptive). Reconsider if Requisition reads more homeworld than fleet.
- **Locked "places"** Alliance Sector and Colony Registry (Locations) and the locked "Ship Facilities" group (Facilities): re-home as locked rail items under the most fitting program (HOMEWORLD for the sectors, DRYDOCK or FOUNDRY for ship facilities). They are honest "coming soon" signals; keep them.
- **Mobile:** the user tests on mobile (Brave). Keep the top-level program count and label lengths mobile-friendly (icon+label, no hover). 7 programs + 2 utilities is at the upper end; consider utility placement (Help/System as end-of-bar or a corner) so the primary row is not cramped.

### 3c. Anti-Regression approach (this is the riskiest part of the patch)

The nav reorg moves large content panels between tabs. Follow exactly how the earlier Locations-merge was done: **content panels move VERBATIM, only the navigation chrome around them changes.** No panel is rewritten during the move. Each moved panel is gated green (npm run check + npm test) before the next. Per-facility SubTab state variables and their content are preserved. This is a mechanical relocation, not a redesign.

## 4. Warehouse reorganization

The Warehouse stays the single storage destination. Its interior is restructured into a top-level split.

### 4a. Top-level tabs: Materials and Finished Goods

- **Materials** (bulk, fungible, auto-accumulating stacks with per-tier caps): raw, refined, components, salvaged materials.
- **Finished Goods** (individual instances): Ship Systems now; Weapons / Modules / Consumables as reserved (locked "soon") tabs combat will fill. This is where the 0.11.0 Ship Systems tab moves to (from its interim Warehouse home), given a real first-class section. Installing still happens in the Ship Systems panel; this tab is where SPARES live and where the Systems storage cap is shown.
- Tier split (T1/T2) is retained within each.

### 4b. Materials sub-categories (themed, presentation only)

Within Materials, raw items are grouped by theme instead of one flat grid. Proposed taxonomy (from the real item set):

- **Ores & Metals:** Titanium Ore, Polysilicate Ore, Iridium Ore, Ferrite, Cobalt Ore, Osmium Ore, Dense Ore (T2 stub, masked).
- **Volatiles:** Deuterium Ice (its own group, signals fuel feedstock not crafting ore).
- **Organic Compounds:** Fibrous Biomass, Volatile Resin, Exotic Spore Cluster.
- **Recovered Tech:** Scrap Alloy, Salvaged Circuitry.
- **Refined:** Titanium Ingot, Polysilicate Wafer, Reclaimed Alloy, Purified Biomass.
- **Components:** Frame Segment, Power Coupling (minor), Structural Assembly (major).
- **Salvaged Materials:** Damaged Reactor Housing (+ the reserved exclusive-salvage exotics from 0.11.0).

The `?`-masked undiscovered-item rule (unlockHint tooltip) is preserved within each sub-category.

### 4c. Data mechanism for sub-categories (implementation call)

The existing `ITEMS[id].category` field (`raw` / `refined` / `minorComponent` / `majorComponent` / `salvagedMaterial`) already distinguishes Refined / Components / Salvaged Materials. The `raw` category needs sub-dividing into Ores & Metals / Volatiles / Organic Compounds / Recovered Tech. Add an OPTIONAL `subCategory` (or `group`) field to the relevant `ITEMS` entries (raw items), read by the Warehouse to place tiles. This is static catalog data, NOT saved state, so it is additive with NO save migration. Items without a subCategory fall back to their category's default group. The standing-rule catalog test (model.test.ts) is extended to assert every raw item has a subCategory (so a new raw item cannot land ungrouped).

### 4d. Warehouse name

Keep the name "Warehouse." The STORES program name carries the grouping; "Warehouse" is still accurate for the storage building even though it now surfaces finished-goods spares.

## 5. Salvage Bay (own facility)

Moves the 0.11.0 salvage ACTIONS (which already exist as pure functions in `salvage.ts`) into a dedicated facility surface. No new salvage math this patch; this is the proper home + the result/confirm UX.

- **Two salvage models, kept distinct** (they already are in code): equipment recycle (a spare Ship System returns ~30 to 40 percent of its recipe inputs, variable) and salvaged-material loot roll (Damaged Reactor Housing rolls the tiered loot table).
- **Result display:** a clear "here is what you got" readout after each salvage (the item(s) and amounts returned/rolled). This is the surface the future loot-crate reveal (SUGGESTIONS backlog) builds on.
- **Configurable per-quality confirm:** a salvage-confirm preference (localStorage, mirroring `refineConfirmPreference.ts`, NOT on GameState). The player selects, across all quality tiers, which qualities require a confirm before salvaging. Default: confirm on all (safe). Equipment salvage keys on the item's quality tier; salvaged-material salvage keys on the item's rarity (map both onto the same selectable-tier control, defined at plan time). This replaces the plain 0.11.0 confirm dialog.
- **EquipmentTooltip is reused unchanged** for any gear shown in the Salvage Bay (constraint from decision 8).

## 6. Help tab (core systems manual)

- A new top-level HELP program (utility, beside SYSTEM). Static, no interactivity, no markdown processor dependency (render plain strings, same discipline as patch notes so the text renders exactly).
- Structured manual covering the main loops: missions/dispatch, refining, fabricating, research, shipyard/ship-building, docks, storage (Warehouse), salvage, fuel. One section per system, written from the player's side (what it does, how to use it), grows as features ship.
- Content is a data table (e.g. `HELP_TOPICS`) so topics are declarative and testable, not hand-inlined markup.

## 7. Terminology sweep: "fitment" to "install ship systems"

Update ALL user-facing text so the vocabulary is about installing ship systems (install / uninstall / installed on), never "fit / fitment / fitted." Sweep: the Ship Systems panel, the Warehouse Finished Goods tab ("Fitted to X" to "Installed on X"), tooltips/labels, pushLog messages, help text. Code vocabulary stays internal (`fitEquipment` / `unfitEquipment` / `fittedToShipId` are fine). Method: grep user-facing strings for "fit" / "fitment" / "fitted" and convert each. Honor the no-em-dash and no "--" rule in every new/changed string.

## 8. Data and save-migration impact

- **Nav reorg:** UI-only. No model or save change.
- **Warehouse reorg:** UI-only plus the additive static `subCategory` field on ITEMS (catalog data, not saved state). No save migration.
- **Salvage Bay:** UI + the new salvage-confirm PREFERENCE lives in localStorage (like refineConfirmPreference), NOT on GameState. No save migration.
- **Help:** static data. No save change.
- **Net:** 0.11.2 is expected to need NO SAVE_VERSION bump (no GameState shape change). Confirm during planning; if some surfaced state does change, follow the frozen-migration discipline. APP_VERSION bumps to "0.11.2" and the patch note is added (single-string render).

## 9. Constraints and preservation (Anti-Regression)

- **EquipmentTooltip design survives unchanged** (decision 8). Do not restructure it.
- **Content panels move verbatim** during the nav reorg (section 3c).
- **No em dashes, no "--" as punctuation** in any new/changed string, comment, doc, or commit (CSS custom properties `var(--x)` excepted).
- **Brave disables backdrop-filter**: never rely on blur for legibility; opaque or near-opaque backgrounds only.
- **Mobile-first nav** (icon+label, no hover).
- **offline==live parity** is not affected (these are UI/presentation changes; no economyTick logic changes). The cleanup refactors already on this branch (foldXpLevelUps, PROCESS_XP_AWARDS) are separately proven behavior-preserving.

## 10. Testing approach

- Nav reorg: each moved panel gated green (check + test) before the next; a smoke assertion that each program renders its expected facilities/panels.
- Warehouse: sub-category placement is correct and exhaustive (every raw item has a subCategory, catalog test extended); Materials vs Finished Goods split renders; masked `?` items still mask.
- Salvage Bay: the recycle + loot-roll functions are unchanged (their existing tests still pass); new tests for the result readout data and the per-quality confirm preference (selection persists, gates the confirm at the chosen tiers, defaults safe).
- Help: topics render from the data table; a test that every listed system has a topic.
- Terminology: a test/grep guard that no user-facing string contains "fitment"/"fitted"/"fit" (scoped to rendered strings), mirroring the em-dash discipline.
- Full suite stays green (currently 915 on this branch). npm run check 0 errors.

## 11. Supersessions and ties

- **Supersedes** the Quartermaster-facility plan in `2026-07-18-0.11.1-ui-restructure-notes.md`: storage stays one place; no Quartermaster building. The rest of that doc (terminology sweep, Help, desk-OS lens, the "give finished goods a real home" promise) is honored here.
- **Material Lines (0.11.3, branch `feat/material-lines-0.11.1`):** the Warehouse sub-category recategorization here is PRESENTATION only and does not touch recipes. Material Lines does the recipe rework and will reconcile against these sub-categories. Do not do recipe work in 0.11.2.
- **Combat (0.12.0):** the reserved Weapons/Modules/Consumables Finished-Goods tabs and the Salvage Bay result surface are the seams combat plugs into. Per-slot implicits + the full implicit set remain deferred to combat. HARD PREREQ for combat (not 0.11.2): migrate captain ids to a monotonic counter.

## 12. Open items for the plan doc (not blockers)

- Exact placement of Requisition and the locked "places" (section 3b).
- The precise per-quality confirm control (a threshold vs a multi-select of tiers; equipment-quality vs material-rarity mapping) (section 5).
- Whether the top-level utility items (Help/System) sit in the program bar or a corner, on mobile.
- Final program icons.
