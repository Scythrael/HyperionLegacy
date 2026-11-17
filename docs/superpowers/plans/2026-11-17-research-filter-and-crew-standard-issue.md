# Research filter + Standard-Issue crew modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Research Lab's Research tab a search box plus Status, Category and Tier filters (researched blueprints hidden unless a Settings toggle shows them), and give every ship, new and existing, a Standard-Issue Sensor Suite, Bridge Module and Crew Quarters.

**Architecture:** Part A is display only: a pure filter module over the existing `blueprintTierGroups`, a localStorage view preference (the `shipRosterViewPreference.ts` shape), and App.svelte wiring. Part B is engine plus save: a shared `seedCrewModuleStandardIssueForShip` helper called wherever `seedStandardIssueForShip` is, and a versioned migration (SAVE_VERSION 71 to 72) that fills empty crew-module slots once. Parts A and B are independent and go to two builders.

**Tech Stack:** Svelte 5, TypeScript, Vitest (`node "F:/Windows Folders/Documents/fleet-admiral/node_modules/vitest/vitest.mjs" run <files>`).

**Spec:** docs/superpowers/specs/2026-11-17-research-filter-and-crew-standard-issue-design.md

## Global Constraints

- Branch base: feat/crew-0.14.0. Never push; commit on the builder branch, messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Determinism: offline equals live; one economyTick call equals 997 s chunks equals 1 s steps, byte for byte.
- Moved goldens are traced with a test-only switch (fixture pattern, e.g. `src/lib/game/fixRoundESwitch.fixture.ts`) and named in the commit message; never re-pin blind.
- Player text: US English; no em dashes and no "--" anywhere (comments too); "install" never "fit"; Roman numerals for tiers; no emoji (SVG via `<Icon>` only).
- Help texts state the real rule with numbers read from engine constants, pinned in a test.
- Gates per part: full suite (`timeout 3000`), `npm run check` 0 errors, `npm run test:perf`, `RELEASE_GATE=1` on `src/lib/game/no-dead-stats.test.ts src/lib/game/wiring.completeness.test.ts`.

## Review Focus

- A search with leading/trailing spaces or mixed case ("  TITANIUM ") matches like "titanium". Test in Task A1.
- A masked (undiscovered relic) blueprint never matches on its hidden name or recipe, only its mask text. Test in Task A1.
- A stored view naming a family or tier that no longer exists, or malformed JSON, falls back per field without dropping the others. Test in Task A2.
- A save where a ship already has a crafted bridge but empty quarters gets only the missing two, and a ship mid-mission keeps its run stamp unchanged. Test in Task B2.
- Loading a migrated (v72) save again never re-seeds a slot the player emptied after migration. Test in Task B2.

---

## Part A: Research tab search and filter (builder 1)

### Task A1: Pure filter over the tier groups

**Files:**
- Create: `src/lib/researchFilter.ts`
- Test: `src/lib/researchFilter.test.ts`

**Interfaces:**
- Produces:
  - `type ResearchStatusFilter = "all" | "canResearch" | "inProgress" | "locked" | "researched"`
  - `interface ResearchFilterView { search: string; status: ResearchStatusFilter; family: ResearchFamily | "all"; tier: number | "all" }`
  - `const DEFAULT_RESEARCH_FILTER_VIEW: Readonly<ResearchFilterView>` = `{ search: "", status: "all", family: "all", tier: "all" }`
  - `researchStatusOf(state: GameState, bpKey: string): Exclude<ResearchStatusFilter, "all">`: researched (blueprintUnlocked), inProgress (an active research project or a queued research order for it), canResearch (canResearch ok), else locked (masked relic cards are locked).
  - `filterBlueprintTierGroups(state, groups, view, showCompleted: boolean): { groups: typeof groups; hiddenResearched: number; matched: number }`: keeps the input shape (tiers, sections, blueprints, order); drops empty sections and tiers. With `showCompleted` false, researched blueprints are removed and counted in `hiddenResearched`, and a `status: "researched"` view behaves as "all".
  - `researchSearchText(state, bp): string`: lowercase; masked card = mask title + detail only; else label + recipe input item labels + output item label + hull unlocked (unlock-only).

- [ ] Step 1: Write failing tests: `matches a name and a recipe material case-insensitively with trimmed search`; `masked relic blueprint matches only its mask text and counts as locked`; `status, family and tier combine (AND)`; `showCompleted false hides researched and counts them`; `empty sections and tiers are dropped and order is preserved`.
- [ ] Step 2: Run, expect FAIL (module missing).
- [ ] Step 3: Implement in `src/lib/researchFilter.ts` reusing `blueprintUnlocked`, `canResearch`, `blueprintRelicLocked`, `undiscoveredResearchMask`, `researchFamilyOf` (dataStudy.ts), `canEnqueueOrder`/queue state as App.svelte already reads them. No new rules.
- [ ] Step 4: Run, expect PASS.
- [ ] Step 5: Commit `feat(0.14.0): research filter (pure)`.

### Task A2: Remembered view and the Settings toggle preference

**Files:**
- Create: `src/lib/researchViewPreference.ts`
- Test: `src/lib/researchViewPreference.test.ts`

**Interfaces:**
- Produces: `loadResearchFilterView(): ResearchFilterView`, `saveResearchFilterView(v: ResearchFilterView): void` (key `fleet_admiral_research_filter_view`, per-field fallback like `loadShipRosterView`); `loadShowCompletedResearch(): boolean` default false, `saveShowCompletedResearch(on: boolean): void` (key `fleet_admiral_show_completed_research`, the `tickReadoutPreference.ts` shape). Both through `safeStorage`.

- [ ] Step 1: Failing tests: round trip; unknown family / tier / status or non-string search falls back per field; malformed JSON gives defaults; blocked storage gives defaults; show-completed defaults false.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run, expect PASS.
- [ ] Step 5: Commit `feat(0.14.0): research view preference`.

### Task A3: Research tab filter bar and Settings toggle

**Files:**
- Modify: `src/App.svelte` (Research sub-tab ~13958 onward: the RESEARCH panel's `{#each blueprintTierGroups}`; the Options/Settings block beside "Show tick counts")
- Test: a component or App-level test following the repo's existing Svelte test pattern (e.g. how Ships roster search is tested), plus `src/lib/researchFilter.test.ts` for any helper added.

**Interfaces:**
- Consumes: Task A1 and A2 exports; `familyLabel` (src/lib/dataStudyDisplay.ts); `tierNumeral`.

- [ ] Step 1: Failing test: rendering the Research tab with a search typed shows only matching cards; with the toggle off a researched card is absent and the hidden-count line reads "N researched blueprints hidden" with a pointer to Settings; "No blueprints match these filters." plus a Clear filters button when nothing matches.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement: a filter bar at the top of the RESEARCH panel (under the order queue panel): search input (labeled, `aria-label="Search blueprints or materials"`), three chip groups (Status: All, Can research, In progress or queued, Locked, plus Researched only when the toggle is on; Category: All plus one chip per family present via `familyLabel`; Tier: All plus each tier present in Roman numerals). Chips are buttons with `aria-pressed`. Each group single-select. Render `filterBlueprintTierGroups(...)` in place of `blueprintTierGroups`; card markup unchanged. Settings gains "Show completed research" (off by default) next to "Show tick counts". Save the view on every change. At 375 px each chip group wraps or scrolls in its own row; no page sideways scroll. Use existing tokens and chip styles.
- [ ] Step 4: Run tests, expect PASS; then verify in the browser preview (`preview_start({name:"dev"})`) at 1280 and 375, light and dark.
- [ ] Step 5: Commit `feat(0.14.0): Research tab search and filters; Show completed research setting`.

---

## Part B: Standard-Issue crew modules (builder 2)

### Task B1: Seed the three modules wherever a ship is born

**Files:**
- Modify: `src/lib/game/model.ts` (beside `seedStandardIssueForShip` ~13822; freshState ~16546), `src/lib/game/tick.ts` (shipBuild completion ~14263 and the captain-slot hull grant ~6969)
- Create: `src/lib/game/crewModuleSiSwitch.fixture.ts` (test-only switch restoring "no crew-module seeding")
- Test: `src/lib/game/crewModuleStandardIssue.test.ts`

**Interfaces:**
- Produces: `CREW_MODULE_STANDARD_ISSUE: Readonly<Record<"sensor" | "bridge" | "quarters", string>>` = `{ sensor: "sensorBalanced", bridge: "bridgeBalancedCommand", quarters: "quartersUtilitarian" }` (mint order sensor, bridge, quarters); `seedCrewModuleStandardIssueForShip(shipId: string, startId: number, skip?: ReadonlySet<string>): { pieces: EquipmentInstance[]; nextId: number }` via `generateStandardIssue({ slotType, fittedToShipId, allocateId, varietyKey })`, skipping slot types in `skip`.

- [ ] Step 1: Failing tests: a fresh game's ship-1, a built ship, and a captain-slot hull grant each carry exactly one Standard-Issue sensor (Balanced Array), bridge (Balanced Command) and quarters (Utilitarian Quarters), Standard rarity, quality 0, `isStandardIssueBaseline` true; ids are consecutive after the economy and combat pieces; the ship's berths rise by Utilitarian's 12; a crafted Balanced Command at higher quality amplifies more than the Standard-Issue one (moduleEffectScale).
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement the helper and call it right after `seedStandardIssueForShip` at each birth site, threading `nextEquipmentId`. Then run the full suite; trace every moved golden with the switch off and name it in the commit.
- [ ] Step 4: Run, expect PASS (with named moved pins).
- [ ] Step 5: Commit `feat(0.14.0): Standard-Issue Sensor Suite, Bridge Module and Crew Quarters on every new ship`.

### Task B2: One-time migration for existing ships, and Help

**Files:**
- Modify: `src/lib/game/save.ts` (`SAVE_VERSION` 71 to 72, a `MIGRATIONS[71]` step), Help texts that say these slots start empty (search helpTopics* for the bridge / quarters / sensor slots)
- Test: `src/lib/game/crewModuleStandardIssue.test.ts` (migration describe), the Help pin test that covers those topics

**Interfaces:**
- Consumes: `seedCrewModuleStandardIssueForShip` (Task B1).

- [ ] Step 1: Failing tests: a v71 save's ships gain the three pieces only in EMPTY slots (a ship with a crafted bridge keeps it and gains sensor and quarters only); ids thread from `nextEquipmentId`; a ship on a mission keeps its run stamp unchanged; re-loading the migrated v72 save after the player uninstalls the Standard-Issue bridge leaves it empty; Help text names the free set with numbers from constants.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement the versioned migration (runs once per save by construction; no extra flag) and the Help edits.
- [ ] Step 4: Run, expect PASS; then full gates.
- [ ] Step 5: Commit `feat(0.14.0): existing ships get the Standard-Issue crew modules once (save v72)`.
