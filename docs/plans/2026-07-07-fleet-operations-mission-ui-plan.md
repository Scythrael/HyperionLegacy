# Fleet Operations Mission UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Fleet Operations' flat mission-per-panel layout with a category-list + tier-tabs +
mission-card + captain-selection-popup flow, showing live drop-rate and timing previews before a
captain is dispatched.

**Architecture:** A left-side category button list (Resource-Gathering real, 3 others locked)
mirrors `.captain-list`'s visual language. Selecting Resource-Gathering reveals a `SubTabs` row for
difficulty tiers (Tier I real — containing both existing missions — Tiers II-V locked). Tier I shows
the already-embarked captains (preserved from today's UI) plus two selectable mission cards with a
portrait-frame placeholder and base drop-rate stats. Clicking a card opens a captain-selection
popup (reusing the existing modal pattern) that recalculates drop-rate/timing stats for whichever
captain is picked, then dispatches on confirm. A small tick.ts refactor extracts the loot-table
reweighting math into its own exported function so the popup's preview and the real dispatch use
the exact same calculation, not a hand-duplicated copy.

**Tech Stack:** Svelte 5 (non-runes: plain `let`/`$:`), TypeScript, Vitest (present but
unexecutable — Node/npm confirmed absent; all "testing" is manual code tracing).

---

## Before you start

Read `docs/plans/2026-07-07-fleet-operations-mission-ui-design.md` in full — it's short and covers
the "why" behind every decision below. Read the CURRENT `src/App.svelte` (specifically the
`fleetCaptains` tab block, roughly lines 614-735, and the `fleetOperations` tab block, roughly lines
737-798) and `src/lib/game/tick.ts` in full before touching anything — this file has been
restructured multiple times this session, do not trust line numbers from memory, re-derive them
from the live file. Node.js/npm/tsc are NOT installed in this environment — no dev server, no test
runner, no compiler. Every verification step is manual code tracing/hand-tracing math against the
actual implementation, never live execution.

---

### Task 1: Add a `tier` field to `MissionDef`/`MISSIONS`

**Files:**
- Modify: `src/lib/game/model.ts` (the `MissionDef` interface and `MISSIONS` const, both currently
  around lines 36-81 — re-find the exact lines by reading the file, don't trust this estimate)

**Step 1: Add the field**

Add `tier: "I" | "II" | "III" | "IV" | "V";` to the `MissionDef` interface, with a comment
explaining it's a display-only grouping (drives which `SubTabs` tier a mission renders under in
Fleet Operations) with no effect on tick math. Set `tier: "I"` on both existing entries
(`shortOreRun`, `longOreRun`) — both are Tier I, confirmed with the user, neither is meant to be a
separate tier.

This is a static-data-only change: `MISSIONS` is a module-level `const`, not part of `GameState` —
it is NEVER persisted to a save file and has no migration to write. Confirm this yourself by
checking `save.ts` doesn't reference `MISSIONS` before treating this as risk-free.

**Step 2: Verify no other code destructures `MissionDef` exhaustively**

Grep for `MissionDef` and `Object.keys(MISSIONS)`/`Object.entries(MISSIONS)` across `src/` to
confirm nothing assumes a fixed field list that a new field would break (TypeScript structural
typing means adding a field is backwards-compatible for any code that only reads named fields, but
confirm nothing does a strict shape comparison).

**Step 3: Commit**

```bash
git add src/lib/game/model.ts
git commit -m "feat: add tier field to MissionDef, both launch missions are Tier I"
```

---

### Task 2: Extract `applyRareLootChanceMult` as its own exported function in tick.ts

**Files:**
- Modify: `src/lib/game/tick.ts` (the `tickCaptainMission` function, currently building
  `effectiveLootTable` inline)
- Modify: `src/lib/game/tick.test.ts` (add a small direct test for the extracted function)

**Context:** `tickCaptainMission` currently computes `effectiveLootTable` inline (a `rareLootChanceMult > 0`
ternary that reweights every non-`"commonOre"` entry). Fleet Operations' new mission cards/popup need
the EXACT SAME reweighting for a live preview, computed BEFORE any captain is dispatched. Rather than
copy-pasting this logic into `App.svelte` (which could silently drift from the real behavior if
either copy is edited later without the other), extract it into its own exported pure function that
both `tickCaptainMission` and `App.svelte` call.

**Step 1: Add the import**

Add `type LootTableEntry` to `tick.ts`'s existing import block from `./model` (it's not currently
imported as a standalone type — `tick.ts` only uses it implicitly via `MissionDef.lootTable`).

**Step 2: Extract the function**

Above `tickCaptainMission`, add:

```ts
// Extracted so both the real roll (tickCaptainMission, below) and any UI
// preview of the SAME math (Fleet Operations' mission cards/captain-selection
// popup, App.svelte) share one implementation -- a hand-copied second version
// of this reweighting logic in App.svelte could silently drift from the real
// one if either copy were edited later without the other. Boosts every
// NON-common tier's weight rather than hardcoding "rareMaterial" specifically,
// so this generalizes to any future lootTable shape without changes here.
export function applyRareLootChanceMult(lootTable: LootTableEntry[], rareLootChanceMult: number): LootTableEntry[] {
  if (rareLootChanceMult <= 0) return lootTable;
  return lootTable.map((entry) =>
    entry.material === "commonOre" ? entry : { ...entry, weight: entry.weight * (1 + rareLootChanceMult) }
  );
}
```

**Step 3: Update `tickCaptainMission` to call it**

Replace the existing inline ternary:

```ts
  const effectiveLootTable =
    rareLootChanceMult > 0
      ? missionDef.lootTable.map((entry) =>
          entry.material === "commonOre" ? entry : { ...entry, weight: entry.weight * (1 + rareLootChanceMult) }
        )
      : missionDef.lootTable;
```

with:

```ts
  const effectiveLootTable = applyRareLootChanceMult(missionDef.lootTable, rareLootChanceMult);
```

**Step 4: Verify this is a pure refactor, not a behavior change**

Hand-trace: for `rareLootChanceMult <= 0`, both the old and new code return `missionDef.lootTable`
unchanged (old: ternary's false branch; new: the function's early return). For `rareLootChanceMult >
0`, both produce the identical mapped array. This MUST NOT change any existing test's expected
output — re-read every test in the `"tickCaptainMission — extraction loot rolls"` describe block
(added in the previous session's talent-effects commit) and confirm none of their expected values
change. Do not "improve" anything else in this function while touching it — this task is scoped to
the extraction only.

**Step 5: Add a direct unit test for the extracted function**

```ts
describe("applyRareLootChanceMult", () => {
  it("returns the SAME array reference when rareLootChanceMult is 0 or negative", () => {
    const table = [{ material: "commonOre" as const, weight: 900 }];
    expect(applyRareLootChanceMult(table, 0)).toBe(table);
    expect(applyRareLootChanceMult(table, -1)).toBe(table);
  });

  it("leaves commonOre's weight untouched but boosts every other entry", () => {
    const table = [
      { material: "commonOre" as const, weight: 900 },
      { material: "uncommonMaterial" as const, weight: 80 },
      { material: "rareMaterial" as const, weight: 20 },
    ];
    const boosted = applyRareLootChanceMult(table, 1); // +100%
    expect(boosted).toEqual([
      { material: "commonOre", weight: 900 },
      { material: "uncommonMaterial", weight: 160 },
      { material: "rareMaterial", weight: 40 },
    ]);
  });
});
```

Add `applyRareLootChanceMult` to `tick.test.ts`'s existing import from `./tick`.

**Step 6: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "refactor: extract applyRareLootChanceMult so Fleet Operations' preview can reuse it"
```

---

### Task 3: New App.svelte script-side state and handlers

**Files:**
- Modify: `src/App.svelte` (`<script>` section)

**Step 1: Add imports**

Add `applyRareLootChanceMult` to the existing import from `./lib/game/tick` (it already imports
`captainExtractionYieldMult`, `captainRareLootChanceMult`, `fleetExtractionYieldMult` from the
previous session's talent-effects commit).

**Step 2: Add category/tier state**

Near the other tab-scoped state (e.g. near `FleetCaptainSubTab`'s declaration), add:

```ts
// Fleet Operations mission-category buttons (2026-07-07 Fleet Operations
// Mission UI). Only "resourceGathering" has real content today -- the other
// 3 render locked/"Coming Soon", same pattern as locked captain-list slots
// and locked sub-tabs. Confirmed with the user: Patrol needs combat
// (Battlespace is still a stub), Surveying/Long-Term Exploration have no
// backing mechanics yet.
type MissionCategoryKey = "resourceGathering" | "patrol" | "surveying" | "longTermExploration";
let activeMissionCategory: MissionCategoryKey = "resourceGathering";

// Difficulty tiers within Resource-Gathering, reusing the SubTabs component's
// existing locked-tab support. Tier I is real and contains BOTH launch
// missions (see model.ts's new MissionDef.tier field) -- confirmed with the
// user neither shortOreRun nor longOreRun is meant to be a separate tier.
// Tiers II-V are locked placeholders for future mission content.
type MissionTierKey = "tierI" | "tierII" | "tierIII" | "tierIV" | "tierV";
let activeMissionTier: MissionTierKey = "tierI";
```

**Step 3: Add captain-selection popup state**

```ts
// Fleet Operations captain-selection popup (2026-07-07 Fleet Operations
// Mission UI) -- null missionPopupKey means the popup is closed. Selecting a
// mission card opens it with no captain chosen yet (missionPopupCaptainId
// null); picking a captain inside the popup recalculates the preview stats
// but does NOT dispatch -- only the Dispatch button does that.
let missionPopupKey: MissionKey | null = null;
let missionPopupCaptainId: number | null = null;

function openMissionPopup(missionKey: MissionKey) {
  missionPopupKey = missionKey;
  missionPopupCaptainId = null;
}

function closeMissionPopup() {
  missionPopupKey = null;
  missionPopupCaptainId = null;
}

function doDispatchFromPopup() {
  if (missionPopupKey === null || missionPopupCaptainId === null) return;
  doDispatchCaptainOnMission(missionPopupCaptainId, missionPopupKey); // existing function, unchanged
  closeMissionPopup();
}
```

**Step 4: Verify no naming collisions**

Grep for `activeMissionCategory`, `activeMissionTier`, `missionPopupKey`, `missionPopupCaptainId`,
`MissionCategoryKey`, `MissionTierKey` across `App.svelte` to confirm none of these names are
already used for something else.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: Fleet Operations script-side state for categories, tiers, and the captain-selection popup"
```

---

### Task 4: Rebuild the Fleet Operations tab markup — category list, tier tabs, mission cards

**Files:**
- Modify: `src/App.svelte` (the `{#if activeTab === "fleetOperations"}` block, currently around
  lines 737-798 — re-find exact lines by reading the file fresh)

**Step 1: Replace the existing flat per-mission Panel loop**

Today's block iterates `Object.entries(MISSIONS)` and renders one `Panel` per mission with embarked
captains + a flat dispatch list. Replace the WHOLE `{#if activeTab === "fleetOperations"}` ...
`{/if}` block with the new structure below. Preserve the embarked-captains display exactly as it is
today (progress bar, phase label, cargo-so-far, Recall button) — this is existing, load-bearing
functionality, not something this task touches the behavior of, only where it's positioned.

```svelte
{#if activeTab === "fleetOperations"}
<div class="tab-scroll-area">
<div class="fleet-ops-layout">
  <div class="mission-category-list">
    <button
      class="mission-category-item"
      class:active={activeMissionCategory === "resourceGathering"}
      on:click={() => (activeMissionCategory = "resourceGathering")}
    >
      Resource-Gathering
    </button>
    <div class="mission-category-item locked" title="Coming soon — combat isn't built yet">
      🔒 Patrol Missions
    </div>
    <div class="mission-category-item locked" title="Coming soon — not yet available">
      🔒 Surveying
    </div>
    <div class="mission-category-item locked" title="Coming soon — not yet available">
      🔒 Long-Term Exploration
    </div>
  </div>

  <div class="mission-category-content">
    {#if activeMissionCategory === "resourceGathering"}
      <SubTabs
        tabs={[
          { key: "tierI", label: "Tier I" },
          { key: "tierII", label: "Tier II", locked: true },
          { key: "tierIII", label: "Tier III", locked: true },
          { key: "tierIV", label: "Tier IV", locked: true },
          { key: "tierV", label: "Tier V", locked: true },
        ]}
        active={activeMissionTier}
        onSelect={(key) => (activeMissionTier = key as MissionTierKey)}
      />

      {#if activeMissionTier === "tierI"}
        {@const tierIMissions = (Object.entries(MISSIONS) as [MissionKey, typeof MISSIONS[MissionKey]][]).filter(([, def]) => def.tier === "I")}
        {@const embarked = state.captains.filter((c) => c.mission !== null && tierIMissions.some(([key]) => key === c.mission!.missionKey))}

        {#if embarked.length > 0}
          <div class="panel-title">IN PROGRESS</div>
          {#each embarked as captain}
            {@const mission = captain.mission!}
            {@const missionDef = MISSIONS[mission.missionKey]}
            {@const requiredTicks = requiredTicksForPhase(mission.phase, missionDef)}
            {@const progress = Math.min(1, mission.phaseProgressTicks / requiredTicks)}
            {@const remainingTicks = Math.max(0, requiredTicks - mission.phaseProgressTicks)}
            <div class="mission-card">
              <div class="research-name">{captain.label} — {missionDef.label}</div>
              <div class="research-cost">Phase: {MISSION_PHASE_LABEL[mission.phase]}</div>
              <div class="research-bar-track">
                <div class="research-bar-fill" style="width:{progress * 100}%"></div>
              </div>
              <div class="research-readout">{remainingTicks.toFixed(1)} ticks remaining in phase</div>
              <div class="research-cost">
                Cargo so far: {formatNumber(mission.cargo.commonOre)} ore, {formatNumber(mission.cargo.uncommonMaterial)} uncommon,
                {formatNumber(mission.cargo.rareMaterial)} rare
              </div>
              {#if mission.recalled}
                <p class="prestige-text mission-recalled-text">Recall ordered — returning to base once the current cycle's unloading completes.</p>
              {:else}
                <button class="recall-btn" on:click={() => doRecallCaptain(captain.id)}>Recall Captain</button>
              {/if}
            </div>
          {/each}
        {/if}

        <div class="panel-title">AVAILABLE MISSIONS</div>
        <div class="mission-list">
          {#each tierIMissions as [missionKey, missionDef]}
            {@const totalWeight = missionDef.lootTable.reduce((sum, e) => sum + e.weight, 0)}
            <button class="mission-card mission-card-selectable" on:click={() => openMissionPopup(missionKey)}>
              <div class="mission-portrait-frame" aria-hidden="true">🖼️</div>
              <div class="mission-card-body">
                <div class="research-name">{missionDef.label}</div>
                <div class="research-cost">Cargo capacity: {formatNumber(missionDef.cargoCapacity)}</div>
                {#each missionDef.lootTable as entry}
                  <div class="research-cost">
                    {entry.material}: {formatNumber(missionDef.extractionRatePerTick)}/tick ({((entry.weight / totalWeight) * 100).toFixed(1)}%)
                  </div>
                {/each}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>
</div>
{/if}
```

Note: `Object.entries(MISSIONS)` loses the precise key type in TypeScript (widens to
`string`) — the existing code already handles this with `missionKey as MissionKey` at the dispatch
call site; the `as [MissionKey, typeof MISSIONS[MissionKey]][]` cast above follows the same
established pattern, don't invent a different one.

**Step 2: Verify the embarked-captains query is correct**

Hand-trace: `embarked` filters `state.captains` for captains whose `mission.missionKey` is one of
Tier I's mission keys — confirm this correctly includes a captain on EITHER `shortOreRun` or
`longOreRun`, and correctly EXCLUDES an idle captain (`mission === null`, short-circuited by the
`c.mission !== null &&` guard before ever reading `c.mission!.missionKey`).

**Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat: Fleet Operations category list, tier tabs, and Tier I mission cards"
```

---

### Task 5: Captain-selection popup markup

**Files:**
- Modify: `src/App.svelte` (add near the existing `{#if deleteModalOpen}` modal block, at the end
  of the template, so it overlays everything regardless of which tab is active)

**Step 1: Add the popup markup**

```svelte
{#if missionPopupKey !== null}
  {@const missionDef = MISSIONS[missionPopupKey]}
  {@const selectedCaptain = missionPopupCaptainId !== null ? state.captains.find((c) => c.id === missionPopupCaptainId) ?? null : null}
  {@const idleCaptains = state.captains.filter((c) => c.mission === null)}
  <div class="modal-backdrop">
    <Panel class="modal-dialog">
      <div class="panel-title">{missionDef.label.toUpperCase()}</div>

      {#if selectedCaptain === null}
        <p class="modal-instruction">Select a captain to preview mission stats.</p>
        {#if idleCaptains.length === 0}
          <p class="prestige-text">No eligible captains available.</p>
        {:else}
          <div class="modal-captain-list">
            {#each idleCaptains as captain}
              <button class="dev-btn" on:click={() => (missionPopupCaptainId = captain.id)}>{captain.label}</button>
            {/each}
          </div>
        {/if}
      {:else}
        {@const extractionYieldMult = captainExtractionYieldMult(selectedCaptain) + fleetExtractionYieldMult(state)}
        {@const rareLootChanceMult = captainRareLootChanceMult(selectedCaptain)}
        {@const effectiveLootTable = applyRareLootChanceMult(missionDef.lootTable, rareLootChanceMult)}
        {@const totalWeight = effectiveLootTable.reduce((sum, e) => sum + e.weight, 0)}
        {@const amountPerTick = missionDef.extractionRatePerTick * (1 + extractionYieldMult)}
        {@const transitOutTicks = missionDef.transitOutTicks}
        {@const extractingTicks = requiredTicksForPhase("extracting", missionDef)}
        {@const transitBackTicks = missionDef.transitBackTicks}
        {@const unloadTicks = missionDef.unloadTicks}
        {@const totalTicks = transitOutTicks + extractingTicks + transitBackTicks + unloadTicks}

        <div class="research-name">Captain: {selectedCaptain.label}</div>

        <div class="panel-title">DROP RATES</div>
        {#each effectiveLootTable as entry}
          <div class="research-cost">
            {entry.material}: {formatNumber(amountPerTick)}/tick ({((entry.weight / totalWeight) * 100).toFixed(1)}%)
          </div>
        {/each}

        <div class="panel-title">TIMING</div>
        <div class="research-cost">Transit out: {transitOutTicks} ticks ({(transitOutTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
        <div class="research-cost">Extracting: {extractingTicks} ticks ({(extractingTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
        <div class="research-cost">Transit back: {transitBackTicks} ticks ({(transitBackTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
        <div class="research-cost">Unloading: {unloadTicks} ticks ({(unloadTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
        <div class="research-cost"><strong>Total: {totalTicks} ticks ({(totalTicks * state.tickDurationSeconds).toFixed(1)}s)</strong></div>
      {/if}

      <div class="modal-row">
        <button class="dev-btn" on:click={closeMissionPopup}>Cancel</button>
        {#if selectedCaptain !== null}
          <button class="dev-btn" on:click={doDispatchFromPopup}>Dispatch</button>
        {/if}
      </div>
    </Panel>
  </div>
{/if}
```

**Step 2: Verify the bonus math matches tick.ts exactly**

Hand-trace against `tick.ts`'s own `tick()`: `extractionYieldMult` here is
`captainExtractionYieldMult(selectedCaptain) + fleetExtractionYieldMult(state)`, and
`rareLootChanceMult` is `captainRareLootChanceMult(selectedCaptain)` — confirm this is byte-identical
to the `bonuses` object `tick()` builds per captain (it is, by construction, since both call the
same three imported functions the same way). Confirm `effectiveLootTable`/`amountPerTick`'s formulas
match `tickCaptainMission`'s own (`applyRareLootChanceMult(...)` and
`extractionRatePerTick * (1 + extractionYieldMult)`).

**Step 3: Verify popup state resets correctly**

Trace: opening a NEW mission's popup while one is already open (shouldn't be reachable via the UI
since the category/tier view is hidden behind the backdrop, but verify `openMissionPopup` always
resets `missionPopupCaptainId` to `null` so a stale captain selection from a previous popup can't
leak into a new one).

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: captain-selection popup with live drop-rate and timing preview"
```

---

### Task 6: CSS — portrait-frame placeholder, mission-category list, popup captain list

**Files:**
- Modify: `src/App.svelte` (`<style>` section)

**Step 1: Mission-category list**

Reuse the flat, thin-gap "button-style pass" look already established for `.captain-list`/
`.captain-list-item` (2026-07-07) — do not reinvent a different visual language:

```css
.fleet-ops-layout { display: flex; gap: 12px; align-items: flex-start; }
.mission-category-list { display: flex; flex-direction: column; gap: 2px; flex: 0 0 140px; }
.mission-category-item {
  background: rgba(var(--color-accent-rgb), 0.06);
  border: 1px solid rgba(var(--color-accent-rgb), 0.2);
  padding: 10px 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.mission-category-item.active {
  background: rgba(var(--color-accent-rgb), 0.15);
  color: var(--color-accent-bright);
  border-color: var(--color-accent);
}
.mission-category-item.locked {
  opacity: 0.5;
  cursor: not-allowed;
}
.mission-category-item.locked:hover {
  border-color: rgba(var(--color-accent-rgb), 0.3);
}
.mission-category-content { flex: 1; min-width: 0; }
```

**Step 2: Portrait-frame placeholder**

Theme-aware via existing CSS variables (`--color-accent`/`--color-text-secondary`), not a hardcoded
color — must visually update when the player switches themes in Options, same as every other themed
element:

```css
.mission-card-selectable {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  background: rgba(var(--color-accent-rgb), 0.06);
  border: 1px solid rgba(var(--color-accent-rgb), 0.2);
  padding: 12px;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.mission-card-selectable:hover {
  border-color: var(--color-accent);
}
.mission-portrait-frame {
  flex: 0 0 64px;
  height: 64px;
  border: 1px dashed rgba(var(--color-accent-rgb), 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--color-text-secondary);
  background: rgba(var(--color-accent-rgb), 0.03);
}
.mission-card-body { flex: 1; min-width: 0; }
```

**Step 3: Popup captain list**

```css
.modal-captain-list { display: flex; flex-direction: column; gap: 2px; margin: 10px 0; }
```

(Reuses `.dev-btn` for the individual captain buttons — already flat-cornered from the 2026-07-07
button-style pass, no new button style needed.)

**Step 4: Verify no class-name collisions**

Grep every new class name (`fleet-ops-layout`, `mission-category-list`, `mission-category-item`,
`mission-category-content`, `mission-card-selectable`, `mission-portrait-frame`,
`mission-card-body`, `modal-captain-list`) across `App.svelte` to confirm none already exist with
different meaning.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "style: portrait-frame placeholder and mission-category list CSS"
```

---

### Task 7: Docs + session log

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if anything genuinely worth flagging surfaced during
  implementation — read 2 existing entries for wording/style match first, don't force an entry that
  isn't needed)

**Step 1: Append a SESSION_LOG.md entry**

Two sentences minimum, following this file's established "Session N — what was worked on, what's
next" format (match "Session 16"'s style/tone exactly): summarize the category-list/tier-tabs/
mission-card/captain-popup rebuild, the tick.ts `applyRareLootChanceMult` extraction, and that ship
selection remains deferred (logged in SUGGESTIONS.md) as the exact hook point for the next feature
(Ships & Crew).

**Step 2: Final commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: session log for Fleet Operations Mission UI"
```

Do NOT push — origin/main triggers a live Vercel production redeploy; wait for explicit
confirmation from the user before any push, per this project's established practice.
