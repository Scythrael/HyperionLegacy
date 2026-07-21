# 0.11.2 UI Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development in-session) to implement this plan task-by-task.

**Goal:** Reorganize the navigation into function-named terminal programs, split the single Warehouse into Materials and Finished Goods, add a Salvage Bay facility and a Help manual, and sweep "fitment" to "install ship systems" in all user-facing text, with no save-shape change.

**Architecture:** UI-only restructure of the (large, legacy `$:`-reactive) `src/App.svelte`, plus a small additive static-data field on `ITEMS` and one localStorage preference module. Nav reorg moves content panels VERBATIM (only navigation chrome changes), keeping existing internal `activeTab` keys where they already exist and only adding new keys for the genuinely new programs. No `economyTick`/offline logic changes, so offline==live parity is untouched.

**Tech Stack:** Svelte 5 (legacy `$:` reactivity in App.svelte, NOT runes), TypeScript, Vitest. Gate every task with `npm run check` (expect "COMPLETED ... 0 ERRORS", the 2 known RadialWeb a11y warnings are allowed) and `npm test` (currently 915 passing on this branch).

**Branch:** `feat/ui-restructure-0.11.2` (already carries the cleanup refactors + the design doc).

**Design doc:** `docs/plans/2026-07-20-ui-restructure-0.11.2-design.md` (read it first).

---

## Conventions for EVERY task

- **Gate before commit:** run `npm run check` (0 errors) and `npm test` (all green) before each commit. A UI move is "done" only when both gate green.
- **No em dashes, no "--" as punctuation** in any new/changed string, comment, or commit message (CSS `var(--x)` excepted). Use colons, commas, periods, parentheses.
- **Move panels verbatim:** during nav tasks, cut a content block from one `{#if activeTab === ...}` region and paste it under the new program's region UNCHANGED. Do not "improve" moved markup (Omega 15a). One concern per commit.
- **Reviewer context (give to BOTH the spec and quality reviewers):** the nav reorg is done incrementally, so intermediate commits may show the new programs alongside the not-yet-removed old `locations`/`facilities` tabs. That coexistence is intentional and is cleaned up in Task 7, do not flag it as a defect.
- **Preserve the EquipmentTooltip** (`src/lib/EquipmentTooltip.svelte`) design unchanged (design decision 8).

---

## PHASE 1: Navigation reorganization (terminal programs)

Current top level (`App.svelte:547`): `type TabKey = "locations" | "facilities" | "fleetCaptains" | "fleetOperations" | "battlespace" | "system"`. Nav buttons at `App.svelte:~6182`. The Facilities tab (`activeTab === "facilities"`, ~3544) has an owner-grouped rail (`activeFacility`) with Refinery/Fabricator/Warehouse/Mission Control/Fuel Depot/Research Lab (Homeworld group), Shipyard (Fleet Sector group), locked Ships group. The Locations tab (`activeTab === "locations"`, ~3190) has a places rail (`activeLocationPlace`) with Homeworld (Overview/Administration) and Sector (Docks/Requisition) plus locked Alliance Sector/Colony Registry.

**Strategy (Anti-Regression):** KEEP existing internal keys where they already exist (`fleetCaptains`, `fleetOperations`, `battlespace`, `system`) and only relabel their buttons. ADD new keys for the new programs (`foundry`, `drydock`, `stores`, `homeworld`). REMOVE `locations` and `facilities` once emptied (Task 7). The `activeFacility` rail state is reused within each program that has a facility rail.

### Task 1: FOUNDRY program (Refinery, Fabricator, Research Lab, Fuel Depot)

**Files:** Modify `src/App.svelte` (TabKey ~547, nav buttons ~6182, Facilities region ~3544, new foundry region).

**Steps:**
1. Add `"foundry"` to the `TabKey` union.
2. Add a `FOUNDRY` nav button beside the others (label "Foundry"), `on:click={() => (activeTab = "foundry")}`, `class:active={activeTab === "foundry"}`.
3. Create a `{#if activeTab === "foundry"}` region that reproduces the Facilities layout shell (the `tab-scroll-area` > `fleet-captains-layout` > `captain-list` rail + `fleet-captains-content`), containing ONLY the Refinery, Fabricator, Research Lab, and Fuel Depot rail buttons and their content panes. Move those four facilities' rail buttons AND their `{#if activeFacility === ...}` content panes VERBATIM out of the Facilities region into here. Drop the "Homeworld" owner-header label (function-grouped now) or replace with a quiet "Foundry" context; keep it minimal.
4. Leave the Facilities region intact for the remaining facilities (Warehouse, Mission Control, Shipyard) until their tasks; it still renders for now.
5. Set a sensible default `activeFacility` for foundry (e.g. keep "refinery").
6. Gate: `npm run check` (0 errors), `npm test` (915 green). Manually confirm (read the diff) that the four panes moved unchanged.
7. Commit: `feat: add Foundry program (Refinery/Fabricator/Research Lab/Fuel Depot)`.

**Expected:** check 0 errors, tests green, the four production facilities render under a new Foundry program identical to before.

### Task 2: DRYDOCK program (Shipyard + Docks + Requisition)

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Add `"drydock"` to `TabKey`; add a `DRYDOCK` nav button.
2. Create `{#if activeTab === "drydock"}` with a facility/place rail containing: Shipyard (move its rail button + content pane verbatim from Facilities) and Docks + Requisition (move verbatim from the Locations Sector place: the `activeStarbaseSubTab` Docks/Requisition panes).
3. Introduce a small local rail-selection state if needed (e.g. reuse `activeFacility` for shipyard and keep `activeStarbaseSubTab` for the Docks/Requisition sub-tabs, or a new `activeDrydockSection`). Keep the moved panes' internal state variables unchanged.
4. Requisition default placement: keep it beside Docks here (design 3b).
5. Gate (check + test green). Commit: `feat: add Drydock program (Shipyard build + Docks assign + Requisition)`.

**Expected:** ship-building (Shipyard) and ship-assignment (Docks) now live together; panes render unchanged.

### Task 3: STORES program (Warehouse now, Salvage Bay later)

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Add `"stores"` to `TabKey`; add a `STORES` nav button.
2. Create `{#if activeTab === "stores"}` with a facility rail containing the Warehouse (move its rail button + full content pane verbatim from Facilities). Leave a placeholder for the Salvage Bay rail item (added in Task 11), or omit it until then.
3. Gate (check + test green). Commit: `feat: add Stores program (Warehouse)`.

### Task 4: HOMEWORLD program (Overview + Administration)

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Add `"homeworld"` to `TabKey`; add a `HOMEWORLD` nav button.
2. Create `{#if activeTab === "homeworld"}` and move the Locations Homeworld place verbatim: the Overview and Administration (`activeHomeworldSubTab` resources/talents) panes.
3. Re-home the locked "places" Alliance Sector and Colony Registry as locked rail items here (or under a fitting program), keeping the honest "coming soon" affordance.
4. Gate (check + test green). Commit: `feat: add Homeworld program (Overview + Administration)`.

### Task 5: OPERATIONS program absorbs Mission Control

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Relabel the existing `fleetOperations` nav button to "Operations" (keep the internal key `fleetOperations`).
2. Move the Mission Control facility (rail button + content pane) verbatim from the Facilities region into the Operations tab (as a section or a rail entry alongside dispatch). Keep dispatch exactly as is.
3. Gate (check + test green). Commit: `feat: fold Mission Control into the Operations program`.

### Task 6: CREW relabel

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Relabel the `fleetCaptains` nav button to "Crew" (keep the internal key). No content move.
2. Relabel `battlespace` -> "Battlespace" (already), `system` -> "System" (already); confirm labels read as terminal programs.
3. Gate (check + test green). Commit: `feat: relabel Command to Crew`.

### Task 7: Remove the emptied Locations and Facilities tabs

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Confirm the Locations and Facilities regions now contain NO remaining unique content (all moved). Delete the `{#if activeTab === "locations"}` and `{#if activeTab === "facilities"}` regions and their nav buttons.
2. Remove `"locations"` and `"facilities"` from the `TabKey` union. Fix the default `activeTab` if it pointed at either (set to a sensible landing program, e.g. keep `"fleetCaptains"`/Crew, or Operations).
3. Remove any now-dead facility-rail scaffolding unique to the old Facilities owner-grouping.
4. Gate (check + test green). Manually click through every program (read the template) to confirm nothing was orphaned.
5. Commit: `refactor: remove the emptied Locations and Facilities tabs`.

**Expected:** the nav is now CREW / OPERATIONS / FOUNDRY / DRYDOCK / STORES / HOMEWORLD / BATTLESPACE + SYSTEM (+ HELP added in Task 14). check 0 errors, 915 tests green.

---

## PHASE 2: Warehouse reorganization

Current Warehouse (inline in App.svelte): `WarehouseCat` (~599), `activeWarehouseCat` (~616), `WAREHOUSE_CAT_TABS` (~621), `WAREHOUSE_CAT_CATEGORIES: Partial<Record<WarehouseCat, ItemCategory[]>>` (~644), `warehouseCategoryGlyph` (~682). Items: `ITEMS` in `src/lib/game/model.ts` with `category: "raw" | "refined" | "minorComponent" | "majorComponent" | "salvagedMaterial"`.

### Task 8: Add the `subCategory` field to raw items (data + test)

**Files:** Modify `src/lib/game/model.ts` (the `ItemDef` type + the raw `ITEMS` entries), `src/lib/game/model.test.ts`.

**Step 1: Write the failing test** (extend the catalog standing-rule test):

```ts
// Every RAW item must declare a Warehouse subCategory so it cannot render ungrouped.
it("every raw item declares a subCategory", () => {
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.category === "raw") {
      expect(def.subCategory, `raw item ${id} missing subCategory`).toBeDefined();
    }
  }
});
```

**Step 2:** Run `npx vitest run src/lib/game/model.test.ts -t "subCategory"`. Expect FAIL (field absent).

**Step 3: Implement.** Add an optional field to the item type: `subCategory?: RawSubCategory;` and a union `export type RawSubCategory = "oresMetals" | "volatiles" | "organicCompounds" | "recoveredTech";`. Assign on each raw item:
- oresMetals: `commonOre` (Titanium Ore), `uncommonMaterial`, `rareMaterial`, `ferriteOre`, `cobaltOre`, `osmiumOre`, `denseOre`.
- volatiles: `deuteriumIce`.
- organicCompounds: `fibrousBiomass`, `volatileResin`, `exoticSporeCluster`.
- recoveredTech: `scrapAlloy`, `salvagedCircuitry`.
(Non-raw items keep no subCategory.)

**Step 4:** Run the test. Expect PASS. Run full `npm test` (green) + `npm run check` (0 errors).

**Step 5: Commit:** `feat: add Warehouse subCategory to raw items`.

### Task 9: Warehouse Materials tab with themed sub-category sections

**Files:** Modify `src/App.svelte` (the Warehouse content pane).

**Steps:**
1. Restructure the Warehouse top-level tabs into `Materials` and `Finished Goods` (replace/augment `WAREHOUSE_CAT_TABS`). Materials shows the fungible categories; Finished Goods is Task 10.
2. In the Materials tab, group tiles by sub-category: render a labeled section per `RawSubCategory` (Ores & Metals, Volatiles, Organic Compounds, Recovered Tech) for raw items, then Refined, then Components (minor+major), then Salvaged Materials. Keep the existing fill-tile rendering, rarity color, `?`-mask for undiscovered, per-tier split, and the tile tooltip (`showWarehouseTooltip`) unchanged.
3. Group ordering: derive from a static ordered list of sections so it is stable and testable.
4. Gate (check + test green). Commit: `feat: Warehouse Materials tab with themed sub-categories`.

### Task 10: Warehouse Finished Goods tab

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Add the Finished Goods tab. Move the 0.11.0 Ship Systems tiles (the equipment list, using `EquipmentTooltip`, `equipmentRarityColor`, `equipmentIcon` already imported) into it UNCHANGED. Show the Ship Systems storage cap readout here.
2. Add reserved, locked "soon" sub-tabs: Weapons, Modules, Consumables (honest coming-soon, no content), matching the locked-tab idiom.
3. Move the 0.11.0 Salvaged Materials tab OUT of Finished Goods: salvaged materials are a MATERIALS sub-category (Task 9). Confirm no duplicate rendering.
4. Reuse the EquipmentTooltip unchanged (constraint).
5. Gate (check + test green). Commit: `feat: Warehouse Finished Goods tab (Ship Systems + reserved slots)`.

---

## PHASE 3: Salvage Bay facility

Salvage functions (pure, already exist): `salvageEquipment(state, id)`, `salvageSalvagedMaterial(state, itemId)` from `src/lib/game/salvage.ts`. They are LIVE-only instant actions (Math.random), never in economyTick.

### Task 11: Salvage Bay facility shell in STORES

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Add a "Salvage Bay" rail item to the STORES program (beside Warehouse).
2. Build its panel: an Overview + the two salvage surfaces. Equipment recycle: list spare Ship Systems, each with a Salvage action calling `salvageEquipment`. Salvaged-material loot roll: list salvaged materials (Damaged Reactor Housing), each with a Salvage action calling `salvageSalvagedMaterial`. Wire to the existing state-update flow the 0.11.0 salvage buttons already use (find and reuse that handler).
3. Reuse EquipmentTooltip for the spare-system rows.
4. Gate (check + test green). Commit: `feat: add Salvage Bay facility (recycle + loot-roll surfaces)`.

### Task 12: Salvage result display

**Files:** Modify `src/App.svelte` (+ a tiny helper if the salvage fns do not already return the result payload).

**Steps:**
1. After a salvage action, show a clear "you got" readout: the item(s) and amounts returned (recycle) or rolled (loot). Read the salvage functions' return value; if they already return the yielded items, render them; if not, capture the inventory delta.
2. Keep it in the Salvage Bay panel (not a modal, unless the existing salvage confirm already uses one).
3. Gate (check + test green). Commit: `feat: Salvage Bay result readout`.

### Task 13: Per-quality configurable salvage confirm preference

**Files:** Create `src/lib/salvageConfirmPreference.ts`; create `src/lib/salvageConfirmPreference.test.ts`; modify `src/App.svelte`.

**Step 1: Write the failing test:**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadSalvageConfirmQualities, saveSalvageConfirmQualities, salvageNeedsConfirm } from "./salvageConfirmPreference";

describe("salvageConfirmPreference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to confirming ALL quality tiers when unset (safe default)", () => {
    expect(loadSalvageConfirmQualities()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("persists and reloads the selected set", () => {
    saveSalvageConfirmQualities([3, 4, 5]);
    expect(loadSalvageConfirmQualities()).toEqual([3, 4, 5]);
  });

  it("salvageNeedsConfirm is true only for a quality in the selected set", () => {
    saveSalvageConfirmQualities([4, 5]);
    expect(salvageNeedsConfirm(2)).toBe(false);
    expect(salvageNeedsConfirm(5)).toBe(true);
  });
});
```

**Step 2:** Run `npx vitest run src/lib/salvageConfirmPreference.test.ts`. Expect FAIL (module missing).

**Step 3: Implement** (mirror `refineConfirmPreference.ts`, localStorage only, NOT on GameState):

```ts
// Per-quality salvage-confirm preference (0.11.2). localStorage only, same shape
// and rationale as src/lib/refineConfirmPreference.ts. The player selects which
// quality tiers (0 to 5) require a confirm before salvaging; default is ALL
// (safe: confirm everything until the player opts out of the low tiers).
const KEY = "fleet_admiral_salvage_confirm_qualities";
const ALL_QUALITIES = [0, 1, 2, 3, 4, 5];

export function loadSalvageConfirmQualities(): number[] {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [...ALL_QUALITIES];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) return parsed;
  } catch {
    // fall through to safe default on any parse problem
  }
  return [...ALL_QUALITIES];
}

export function saveSalvageConfirmQualities(qualities: number[]): void {
  localStorage.setItem(KEY, JSON.stringify(qualities));
}

export function salvageNeedsConfirm(quality: number): boolean {
  return loadSalvageConfirmQualities().includes(quality);
}
```

**Step 4:** Run the test. Expect PASS. Full `npm test` green.

**Step 5: Commit:** `feat: per-quality salvage confirm preference`.

### Task 13b: Wire the per-quality confirm into the Salvage Bay UI

**Files:** Modify `src/App.svelte`.

**Steps:**
1. Gate the salvage confirm dialog on `salvageNeedsConfirm(itemQuality)`: skip the dialog when the item's quality is not in the selected set, show it otherwise. Equipment salvage uses the item's quality tier; salvaged-material salvage maps its rarity onto a tier for the same control (define the rarity to tier mapping inline, documented).
2. Add a small settings control (in the Salvage Bay Overview or System > Options) letting the player toggle each quality tier on/off, persisting via `saveSalvageConfirmQualities`.
3. Gate (check + test green). Commit: `feat: wire per-quality confirm into Salvage Bay`.

---

## PHASE 4: Help program

### Task 14: Help manual (data table + program tab)

**Files:** Create `src/lib/helpTopics.ts`; create `src/lib/helpTopics.test.ts`; modify `src/App.svelte` (add HELP nav button + region).

**Step 1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { HELP_TOPICS } from "./helpTopics";

describe("HELP_TOPICS", () => {
  it("covers the core systems", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    for (const sys of ["missions", "refining", "fabricating", "research", "shipyard", "docks", "storage", "salvage", "fuel"]) {
      expect(ids, `missing help topic: ${sys}`).toContain(sys);
    }
  });
  it("every topic has a non-empty title and body", () => {
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
});
```

**Step 2:** Run it. Expect FAIL (module missing).

**Step 3: Implement** `src/lib/helpTopics.ts`: `export interface HelpTopic { id: string; title: string; body: string; }` and `export const HELP_TOPICS: HelpTopic[] = [ ... ]` with one entry per core system, written from the player's side (plain strings, no markdown processor, no em dashes / no "--"). Add the HELP nav button (utility, beside System) and a `{#if activeTab === "help"}` region that renders the topics (a simple list or left-rail of topic titles + a body pane, reusing the existing rail/SubTabs idiom). Add `"help"` to `TabKey`.

**Step 4:** Run the test. Expect PASS. Full `npm test` green, `npm run check` 0 errors.

**Step 5: Commit:** `feat: add Help program with a core-systems manual`.

---

## PHASE 5: Terminology sweep + version

### Task 15: "fitment" to "install ship systems" sweep

**Files:** Modify `src/App.svelte`, `src/lib/ShipSystemsPanel.svelte`, `src/lib/EquipmentTooltip.svelte` (strings only), any pushLog strings; create a guard test.

**Step 1: Write the failing guard test** (`src/lib/game/terminology.test.ts` or extend an existing UI-string test): assert that the rendered-string sources contain no user-facing "fitment"/"fitted"/"fit " in display strings. A pragmatic version: read the `.svelte` files and assert no match of the user-facing patterns (excluding code identifiers like `fitEquipment`). If a full source-scan test is too broad, instead enumerate the known display strings and assert their new wording.

**Step 2:** Run it. Expect FAIL (current strings still say "Fitted to").

**Step 3:** Convert every user-facing occurrence: "Fitted to X" -> "Installed on X", "Fit"/"Fitment" labels -> "Install"/"Installed", hints/logs likewise. Leave code identifiers (`fitEquipment`, `unfitEquipment`, `fittedToShipId`, `EquipmentInstance`) untouched. Honor no em dash / no "--".

**Step 4:** Run the guard test (PASS) + full `npm test` (green) + `npm run check` (0 errors).

**Step 5: Commit:** `refactor: sweep user-facing "fitment" to "install ship systems"`.

### Task 16: Version bump + patch note

**Files:** Modify `src/lib/patchNotes.ts`.

**Steps:**
1. Set `APP_VERSION = "0.11.2"`.
2. Add a `PATCH_NOTES` entry for 0.11.2 (plain string, renders exactly, no em dash / no "--"): the terminal nav reorg, the reorganized Warehouse (Materials vs Finished Goods), the Salvage Bay, the Help manual, the install-ship-systems wording.
3. Confirm NO `SAVE_VERSION` bump was needed (no GameState shape change across the patch). If any surfaced state did change, add a numbered migration per the frozen-migration discipline and bump `SAVE_VERSION`.
4. Gate (check + test green). Commit: `chore: bump to 0.11.2 with UI restructure patch note`.

---

## After the plan: holistic review + staging

- Dispatch a final holistic review of the whole branch (cross-task integration: nav completeness, no orphaned panels, tooltip preserved, parity untouched). Reviewer prompt MUST say "static review only, no WebSearch/WebFetch, keep it fast and bounded."
- Controller independently verifies the risky seams: click-through of every program (no orphaned/duplicated panel), the Warehouse Materials/Finished-Goods split renders all items once, the salvage confirm gates at the selected tiers.
- Gate green, push to `origin/staging`, user device-tests (mobile Brave + PC), then explicit go before any prod promotion.

## Open items carried from design (resolve inline during the relevant task)

- Requisition + locked-places final placement (Task 2 / Task 4).
- The exact per-quality confirm control UI + the material-rarity to quality-tier mapping (Task 13b).
- Utility items (Help/System) placement on mobile (Task 14).
- Program icons.
