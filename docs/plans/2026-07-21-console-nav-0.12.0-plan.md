# 0.12.0 "Console" Navigation Redesign, implementation plan

> **For Claude:** Execute PHASE BY PHASE, and within a phase TASK BY TASK, via subagent-driven development (fresh subagent per task, spec review + code-quality review between tasks), the same workflow that shipped the 0.11.2 shell. The mockups in the scratchpad + `docs/plans/2026-07-21-console-nav-0.12.0-design.md` are the reference; honor every locked constraint there. This is a large epic spanning multiple sessions; the design doc + this plan carry it forward.

**Goal:** Replace the 0.11.2 tab-nav (bottom tabs to left rail to top subtabs) with the console model: five perspective-bucket bottom tabs (Home / Personnel / Facilities / Logistics / Operations), no left rail, each tab landing on an overview whose buttons summon panels in place. Responsive: full-width desktop, single-column mobile.

**Architecture:** Mostly `src/App.svelte` plus new/moved Svelte components. Introduce ONE reusable console primitive (overview + summoned-panel mechanism) and convert each perspective onto it. Preserve the RadialWeb talent tree, the ShipSystemsPanel paper-doll, and the EquipmentTooltip verbatim. No economy/tick/save-shape changes are the TARGET (this is IA + presentation); any state touched follows frozen-migration discipline.

**Tech Stack:** Vite + Svelte 5 legacy `$:` reactivity (NOT runes), TypeScript, existing focusTrap, existing SubTabs, existing modal idiom.

**Branch:** `feat/console-nav-0.12.0` (design doc already committed here).

**Governing constraints (from the design doc, do not violate):**
- Five perspectives are hard categories; sort anything by "whole game / person / building / item / mission?"
- Buckets are for FINDING; the same action bridges across perspectives (multi-path is a feature).
- No left rail anywhere. Overview + buttons-summon-panels-in-place + Close. Optional slim top rail. System stays the portrait modal.
- Responsive: desktop uses all available width (multi-column overviews; panel may sit beside overview); mobile single-column minimizes scrolling.
- Crimson via existing tokens; no em dashes / no "--"; Brave has no backdrop-filter (opaque only).
- PRESERVE verbatim: RadialWeb (captain + FA trees), ShipSystemsPanel paper-doll (ship equip layout), EquipmentTooltip.
- 0.11.2 non-nav work carries forward (Statistics, Help, salvage declutter, Community/portrait modal).

---

## Migration strategy (keep the app functional throughout)

Big-bang the SHELL, then convert perspectives one at a time so the app never enters a broken half-state:

1. **Phase 0** builds the console primitive and swaps the bottom nav to the 5 perspective tabs, each initially a "perspective container" that HOSTS the existing relevant panels unchanged (Personnel hosts the old Command captains + Homeworld admin; Logistics hosts the old Warehouse + ship-systems; Facilities hosts the old facility panels; Operations hosts the old operations + battlespace; Home hosts the 0.11.2 Home). Nothing is rewritten yet; everything is reachable. Gate green.
2. **Phases 1 to 5** each replace ONE perspective's hosted-old-content with its real console overview + summoned panels, one perspective per phase, each gated green and reviewed before the next.
3. **Phase 6** folds in, cleans up, writes the patch note, bumps to 0.12.0.

---

## Phase 0: Console shell + primitive (foundation)

**Goal:** the 5-tab bottom nav + the reusable overview/summoned-panel primitive, with every old panel still reachable inside its new perspective container.

- **T0.1 Console primitive.** A reusable mechanism/component for "an overview whose buttons summon a panel in place; Close returns; responsive (mobile replaces the overview, desktop may show side-by-side)". Decide the shape (a `ConsolePanel`/`ConsoleView` wrapper + a per-perspective `activePanel` state idiom) and prove it with a trivial example. Reuses focusTrap only if a panel is modal-like; primary model is in-content swap, not overlay. Unit/smoke test the swap + Close + responsive breakpoint.
- **T0.2 Bottom nav to 5 tabs.** Change `TabKey` to `home | personnel | facilities | logistics | operations`. Update the `.nav-tabs` row. Remove the old System/Help/Battlespace top-level entries (System already the portrait modal from 0.11.2; Help folds into Home; Battlespace into Operations).
- **T0.3 Perspective containers host old content.** Each new tab renders the existing relevant panels VERBATIM (mechanical remap, the same discipline as the 0.11.2 verbatim moves). This is the "nothing breaks" checkpoint: every current screen is still reachable, just regrouped under the 5 tabs. Left rail may remain TEMPORARILY inside a container here; it is removed per-perspective in Phases 1 to 5.
- **T0.4 Responsive scaffolding.** Establish the full-width-desktop / single-column-mobile layout rules for the console shell (container max-widths, breakpoints) so every subsequent phase inherits them.
- Gate: check + test green; manual, every old screen reachable under the new 5 tabs.

## Phase 1: Personnel (person perspective)

**Reference:** `console-personnel-captain.html`. **Reuse:** RadialWeb (verbatim).

- **T1.1** Top rail Admiral | Captain Roster.
- **T1.2** Captain Roster overview (grid of captain cards: portrait, level, ship, idle/on-mission status; tap opens a captain).
- **T1.3** Captain console overview (identity + XP + summary + the button set: Assign Ship / Talents / Equip / Rename).
- **T1.4** Summoned panels: Talents (RadialWeb, full space), Assign Ship, Equip, Rename. Wire the existing captain-talent logic into the Talents panel verbatim.
- **T1.5** Admiral view: FA overview + the FA prestige tree (RadialWeb) as a summoned panel (this is where the old Homeworld Administration tree re-homes). FA upgrades live here.
- **T1.6** Remove the old Command/Homeworld left-rail content now that it is re-homed. Gate green.

## Phase 2: Logistics (item perspective)

**Reference:** `console-logistics-ship.html`. **Reuse:** ShipSystemsPanel paper-doll + EquipmentTooltip (verbatim).

- **T2.1** Top rail Ships | Ship Equipment | Crew Equipment | Materials.
- **T2.2** Ships overview (list of hulls + captain + status), and the ship console (composed read: captain, installed systems via the PAPER-DOLL, stat breakdown) + buttons (Ship Installs / Stat Breakdown / Assign Captain).
- **T2.3** Ship Installs panel = the existing outfit flow, using the paper-doll; multi-path (also reachable from Ship Equipment). Honor the on-mission/drydock lock. EquipmentTooltip reused.
- **T2.4** Ship Equipment / Crew Equipment / Materials overviews (the Warehouse content re-homed; Materials keeps the 0.11.2 themed sub-categories; Crew Equipment reserved/stub until crew exists).
- **T2.5** Salvage surface re-home (item salvage from the item; the declutter behavior stays). Gate green.

## Phase 3: Facilities (building perspective)

**Reference:** `console-facilities-refinery.html`.

- **T3.1** Facilities dashboard (grid of building cards with live status: level, slots, active job progress).
- **T3.2** Building console template (overview: level + live jobs + buttons Operate / Upgrade), applied to Refinery first.
- **T3.3** Operate panel (the existing production-line/job flow per building) + Upgrade panel (the existing upgrade rungs, now summoned from the building). Batch job builder shows TOTAL batch time (fold in the batch-refine-total-time fix).
- **T3.4** Apply the template to Fabricator, Research Lab, Fuel Depot, Shipyard. Reserved locked "Ship Facilities" card. Gate green per building.

## Phase 4: Operations (mission perspective)

**Reference:** `console-operations-mission.html`.

- **T4.1** Top rail: Gathering | Combat | Exploration + locked Battlespace (PvE) + Battlespace (PvP).
- **T4.2** Mission list per type (in-progress with captain/progress + available cards with graphic/level/time/drop icons).
- **T4.3** "View Mission Info" in-place swap (rich detail: drop table with rates, requirements, rewards, fuel cost, flavor). **Drop icons carry a hover/tap tooltip showing held / cap for that item.**
- **T4.4** "Assign Mission" panel (idle captains + fit check + fuel cost + Dispatch), wiring the existing dispatch logic. Reserve the Battlespace locked tabs. Gate green.

## Phase 5: Home (whole-game perspective)

- **T5.1** Home dashboard overview (at-a-glance whole-game readouts) + buttons/sections: Help, Statistics (both carry forward from 0.11.2), reserved meta (Achievements / Completion / Leaderboards). Gate green.

## Phase 6: Fold-in, cleanup, ship

- **T6.1** Remove any remaining left-rail scaffolding + dead 0.11.2 nav code; confirm no orphaned panels/state.
- **T6.2** Full responsive pass (desktop full-width + mobile min-scroll) across all five perspectives.
- **T6.3** Patch note rewrite for 0.12.0 "Console"; APP_VERSION to "0.12.0"; confirm SAVE_VERSION (expect no bump; verify per phase).
- **T6.4** Holistic review of the whole epic (spec vs design doc + governing constraints; parity untouched; preserved components intact). Push to staging; user device-tests; explicit go before prod (prod stays 0.11.1 until then; 0.11.2 folds in here, shipped once).

---

## Definition of done

- Bottom nav is exactly Home / Personnel / Facilities / Logistics / Operations; System is the portrait modal; no left rail anywhere.
- Every perspective uses the console overview + summoned-panel model; multi-path actions work from both relevant perspectives.
- RadialWeb, ShipSystemsPanel paper-doll, and EquipmentTooltip are reused unchanged.
- Responsive: full-width desktop, single-column mobile; mission drop tooltips show held/cap.
- 0.11.2 non-nav work carried forward; batch-refine total-time fixed.
- `npm run check` 0 errors, `npm test` green, no SAVE_VERSION bump, APP_VERSION "0.12.0".
