# Tick Granularity Rebalance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Drop `tickDurationSeconds` from 10 to 1 (real seconds per tick), rebalance `MISSIONS`' phase
durations to use the new resolution, migrate existing saves without losing in-progress mission
position, and add an options-menu toggle to hide the now-10x-faster-cycling tick bar.

**Architecture:** `tick.ts`'s phase-advancement logic is already unit-agnostic (it only counts ticks,
never assumes what a tick represents in real seconds), so no tick-loop logic changes. This plan only
touches: `model.ts`'s content values, a new save migration (v12→v13) that remaps in-progress mission
progress proportionally, a new small `localStorage`-backed preference module mirroring `theme.ts`, and
test-file updates to match the new content values.

**Tech Stack:** Vite + Svelte + TypeScript, Vitest (present but not executable in this environment — no
Node/npm/tsc available; every task is verified by manual hand-trace, same as every prior feature this
session).

---

### Task 0: Set up git worktree

**REQUIRED SUB-SKILL:** Use superpowers:using-git-worktrees.

Create worktree at `.worktrees/feat-tick-granularity-rebalance` on new branch
`feat/tick-granularity-rebalance`, branched from `main` (currently at commit `d1128a3`, i.e. the design
doc's own commit — confirm via `git log --oneline -1` before branching). `.worktrees/` is already
gitignored (confirmed by every prior feature this session). No `npm install` step — this project has no
usable Node/npm in this environment; skip straight to verifying you can read the existing source files.

---

### Task 1: `model.ts` — tick default + `MISSIONS` rebalance

**Files:**
- Modify: `src/lib/game/model.ts:404` (freshState's `tickDurationSeconds` default)
- Modify: `src/lib/game/model.ts:80-105` (the `MISSIONS` table)

**Step 1: Read the current file first.** Re-confirm exact current line numbers yourself (they may have
drifted) — search for `tickDurationSeconds: 10,` inside `freshState()`, and the `MISSIONS` object.

**Step 2: Change the default.**

```ts
tickDurationSeconds: 1,
```

**Step 3: Rebalance `MISSIONS`.** Replace the whole object with:

```ts
export const MISSIONS: Record<"shortOreRun" | "longOreRun", MissionDef> = {
  shortOreRun: {
    label: "Short Ore Run",
    transitOutTicks: 25,
    transitBackTicks: 25,
    unloadTicks: 8,
    extractionRatePerTick: 10,
    cargoCapacity: 900,
    uncommonChance: 0.019, // was lootTable weight 19/1000 (1.9%)
    rareChance: 0.001, // was lootTable weight 1/1000 (0.1%)
    tier: "I",
    fleetAdminXpPerCycle: 1,
  },
  longOreRun: {
    label: "Long Ore Run",
    transitOutTicks: 70,
    transitBackTicks: 70,
    unloadTicks: 8,
    extractionRatePerTick: 10,
    cargoCapacity: 900,
    uncommonChance: 0.08, // was lootTable weight 80/1000 (8%)
    rareChance: 0.02, // was lootTable weight 20/1000 (2%)
    tier: "I",
    fleetAdminXpPerCycle: 2,
  },
};
```

Note `extractionRatePerTick` stays `10` for both missions (unchanged from today) — only
`cargoCapacity` changes (100→900), so `requiredTicksForPhase("extracting", ...)` = `900/10 = 90` ticks
exactly, satisfying the "must divide evenly" invariant documented on `MissionDef.cargoCapacity` and on
the `MISSIONS` object's own header comment. This deliberately preserves per-tick extraction-roll
behavior (uncommon/rare yield amounts, common-ore baseline) — see the design doc's rebalance table for
why `90` ticks was the target, and this plan's own reasoning for why the rate itself shouldn't drop to
`1`.

Per-mission new totals (transit out + extracting + transit back + unloading, NOT counting the
1-tick `ordersReceived` phase which is fixed and mission-independent):
- `shortOreRun`: 25 + 90 + 25 + 8 = 148 ticks = 148s.
- `longOreRun`: 70 + 90 + 70 + 8 = 238 ticks = 238s.

**Step 4: Verify by hand-trace.** Confirm `requiredTicksForPhase("extracting", MISSIONS.shortOreRun)`
(unchanged function, `Math.ceil(missionDef.cargoCapacity / missionDef.extractionRatePerTick)`) computes
`Math.ceil(900/10) = 90`. Confirm the same for `longOreRun`.

**Step 5: Commit.**

```bash
git add src/lib/game/model.ts
git commit -m "feat: rebalance tickDurationSeconds to 1s and MISSIONS tick-counts"
```

---

### Task 2: `model.test.ts` — update hardcoded assertions

**Files:** Modify `src/lib/game/model.test.ts` (215 lines).

**Step 1:** Read the whole file (it's short). Update every assertion that hardcodes an old `MISSIONS`
value or old `tickDurationSeconds` default:

- Line ~40: `expect(state.tickDurationSeconds).toBe(10);` → `.toBe(1)`. Also update the enclosing `it(...)`
  description string ("fleet-wide tickDurationSeconds 10") to say `1` instead.
- Lines ~108-119 (`"has exactly 2 missions with the specified tick counts and cargo/extraction
  values"`): update to the new values —
  ```ts
  expect(MISSIONS.shortOreRun.transitOutTicks).toBe(25);
  expect(MISSIONS.shortOreRun.transitBackTicks).toBe(25);
  expect(MISSIONS.shortOreRun.unloadTicks).toBe(8);
  expect(MISSIONS.shortOreRun.extractionRatePerTick).toBe(10);
  expect(MISSIONS.shortOreRun.cargoCapacity).toBe(900);

  expect(MISSIONS.longOreRun.transitOutTicks).toBe(70);
  expect(MISSIONS.longOreRun.transitBackTicks).toBe(70);
  expect(MISSIONS.longOreRun.cargoCapacity).toBe(900);

  expect(MISSIONS.shortOreRun.fleetAdminXpPerCycle).toBe(1);
  expect(MISSIONS.longOreRun.fleetAdminXpPerCycle).toBe(2);
  ```
- Lines ~142-146 (`"transitOut/transitBack/unloading match the mission definition directly"`): update
  to `25`/`25`/`8`.
- Lines ~148-153 (`"extracting is cargoCapacity / extractionRatePerTick, rounded up"`): update the
  comment and assertion —
  ```ts
  it("extracting is cargoCapacity / extractionRatePerTick, rounded up", () => {
    // 900 / 10 = exactly 90 -- extractionRatePerTick deliberately stays 10 (unchanged
    // from before the tick-granularity rebalance) so per-tick extraction-roll behavior
    // is unaffected; only cargoCapacity grew, extending the phase to 90 ticks.
    expect(requiredTicksForPhase("extracting", MISSIONS.shortOreRun)).toBe(90);
  });
  ```

**Step 2:** Confirm no other test in this file references a `MISSIONS` value or `tickDurationSeconds`
(grep the file yourself for `MISSIONS.` and `tickDurationSeconds` to be sure nothing was missed).

**Step 3: Commit.**

```bash
git add src/lib/game/model.test.ts
git commit -m "test: update model.test.ts for rebalanced MISSIONS/tickDurationSeconds"
```

---

### Task 3: `tick.test.ts` — comprehensive rewrite for new extraction/tick-count values

**Files:** Modify `src/lib/game/tick.test.ts` (1147 lines).

**This is the largest task in this plan.** `extractionRatePerTick` stays `10` (unchanged), so most
PER-TICK extraction-roll hand-traces (uncommon/rare occurrence math, yield-scaling math) are UNAFFECTED
and must NOT be touched. What DOES need updating is every assertion that hardcodes the OLD total
tick-counts (`cargoCapacity: 100` → `900`, `10 ticks completes extracting` → `90 ticks`,
`transitOutTicks: 3` → `25`, `transitBackTicks: 3` → `25`, `unloadTicks: 1` → `8`, and any full-cycle
test that sums these into a total).

**Step 1:** Read the WHOLE file first (it's long, ~1147 lines). Grep it yourself for
`extractionRatePerTick`, `cargoCapacity`, `transitOutTicks`, `transitBackTicks`, `unloadTicks`,
`missionDef.transitOutTicks`, and any hardcoded tick-count number in a comment or assertion, to build a
complete list of what needs touching — do not trust any pre-enumerated list, re-derive it from the live
file.

**Step 2: Apply changes methodically.** For each hit:
- Any assertion/comment claiming `cargoCapacity 100 / rate 10` → `cargoCapacity 900 / rate 10` (note
  the RATE doesn't change, only capacity).
- Any assertion claiming extracting completes in exactly `10` ticks → `90` ticks.
- Any assertion/comment claiming `transitOutTicks=3`/`transitBackTicks=3`/`unloadTicks=1` (shortOreRun)
  → `25`/`25`/`8`. Any claiming `transitOutTicks=8`/`transitBackTicks=8` (longOreRun) → `70`/`70`
  (longOreRun's `unloadTicks` also becomes `8`, same as shortOreRun).
- Any full-cycle or "big jump equals many small ticks" closed-form test that sums a mission's total
  tick count (e.g. summing `transitOut + extracting + transitBack + unload` or similar) needs its total
  recomputed against the new per-phase values.
- Per-tick extraction-roll assertions that only depend on `extractionRatePerTick` (still `10`) — e.g.
  "both tiers occur in the same tick" style tests computing `commonAmount = max(0, 10 - uncommon -
  rare) * (1+mult)` — do NOT need their internal math changed, only re-verify (don't assume) that
  nothing in that specific test ALSO references `cargoCapacity`/total-ticks-to-complete alongside the
  per-tick math.

**Step 3: Hand-trace verification.** For at least 4 representative tests spanning different concerns
(one pure per-tick extraction roll — should be UNCHANGED math, confirming your read that rate-only
tests don't need touching; one phase-progression/tick-count test — should show the new 25/90/25/8
values; one full-cycle XP-completion test; one `vi.spyOn(Math, "random")`-mocked total-delivered test),
show your work confirming the updated expected value is correct against the actual current
`tick.ts` code (unchanged from this rebalance) plus the new `model.ts` values (Task 1).

**Step 4:** No test runner available — cannot execute these. Every changed assertion must be justified
by a shown hand-trace, not just "this looks like the right pattern," per this codebase's established
rigor for test-file rewrites of this size (see the Loot Tier Rework's and Big-Number Migration's
tick.test.ts rewrites for precedent).

**Step 5: Commit.**

```bash
git add src/lib/game/tick.test.ts
git commit -m "test: update tick.test.ts for rebalanced MISSIONS tick-counts"
```

---

### Task 4: `save.ts` — v12→v13 migration (save-compatibility-critical)

**Files:**
- Modify: `src/lib/game/save.ts:7` (import line), `:9` (`SAVE_VERSION`), `:202-327` (`MIGRATIONS`)
- Modify: `src/lib/game/save.test.ts` (1076 lines)

**Step 1: Read the ENTIRE current `save.ts` first**, especially the `MIGRATIONS` table's existing
entries (lines 202-327) and the unconditional `hydrateDecimals()` call in `migrate()` (line 336) — this
codebase just went through an extensive Big-Number Migration with a similar "must run regardless of
which migration steps actually executed" concern; match that same rigor and comment density here.

**Step 2:** Update the import line (currently `import { type GameState, type CaptainState,
freshCaptains } from "./model";`) to also import `requiredTicksForPhase`, `MISSIONS`, and the
`MissionKey`/`MissionPhase` types:

```ts
import { type GameState, type CaptainState, type MissionKey, type MissionPhase, freshCaptains, requiredTicksForPhase, MISSIONS } from "./model";
```

**Step 3:** Bump `SAVE_VERSION` from `12` to `13`.

**Step 4:** Add `MIGRATIONS[12]` (the v12→v13 step), inserted before the object's closing brace at line
327. Use this exact code (from the approved design doc, verbatim):

```ts
// v12 -> v13: Tick Granularity Rebalance (docs/plans/2026-07-08-tick-granularity-
// rebalance-plan.md). tickDurationSeconds drops from 10 to 1 real second per tick,
// and MISSIONS' phase tick-counts are genuinely rebalanced (not just multiplied by
// 10), so an in-progress mission's old phaseProgressTicks doesn't map onto the new
// tick-counts via simple multiplication. Instead, this preserves the RELATIVE
// (percentage) position within the captain's current phase, remapped onto the new
// tick-count for that same phase. The pre-rebalance (v12-era) MISSIONS tick-counts
// are snapshotted as literal values here -- NOT read from the live MISSIONS/
// requiredTicksForPhase in model.ts, which already reflect the NEW post-rebalance
// values by the time this migration runs -- so this keeps producing the correct
// v12 ratio permanently, even after MISSIONS is rebalanced again in some future
// update. phaseProgressTicks is already documented as continuous/fractional, so
// the remapped result needs no rounding.
const OLD_MISSION_TICKS_V12: Record<MissionKey, {
  transitOutTicks: number; transitBackTicks: number; unloadTicks: number;
  extractionRatePerTick: number; cargoCapacity: number;
}> = {
  shortOreRun: { transitOutTicks: 3, transitBackTicks: 3, unloadTicks: 1, extractionRatePerTick: 10, cargoCapacity: 100 },
  longOreRun: { transitOutTicks: 8, transitBackTicks: 8, unloadTicks: 1, extractionRatePerTick: 10, cargoCapacity: 100 },
};

function oldRequiredTicksForPhase_v12(phase: MissionPhase, missionKey: MissionKey): number {
  const def = OLD_MISSION_TICKS_V12[missionKey];
  switch (phase) {
    case "ordersReceived": return 1;
    case "transitOut": return def.transitOutTicks;
    case "extracting": return Math.ceil(def.cargoCapacity / def.extractionRatePerTick);
    case "transitBack": return def.transitBackTicks;
    case "unloading": return def.unloadTicks;
  }
}
```

And the migration entry itself, added to the `MIGRATIONS` object:

```ts
12: (state: any): GameState => ({
  ...state,
  tickDurationSeconds: 1,
  captains: state.captains.map((c: any) => {
    if (!c.mission) return c;
    const oldRequired = oldRequiredTicksForPhase_v12(c.mission.phase, c.mission.missionKey);
    const progressRatio = Math.min(1, c.mission.phaseProgressTicks / oldRequired);
    const newRequired = requiredTicksForPhase(c.mission.phase, MISSIONS[c.mission.missionKey]);
    return { ...c, mission: { ...c.mission, phaseProgressTicks: progressRatio * newRequired } };
  }),
}),
```

Place the `OLD_MISSION_TICKS_V12` const and `oldRequiredTicksForPhase_v12` function just above the
`MIGRATIONS` object declaration (matching where other migration-specific helpers/comments live in this
file), not inside the migration entry itself.

**Step 5: Hand-trace verification before committing.** Walk through at least 3 scenarios yourself: (a)
a captain with `mission: null` — confirm the migration returns that captain completely unchanged
(early-return branch); (b) a captain 60% through `shortOreRun`'s old `extracting` phase
(`phaseProgressTicks: 6`, old required `Math.ceil(100/10) = 10`, ratio `0.6`) — confirm the new
required ticks is `Math.ceil(900/10) = 90`, and the migrated `phaseProgressTicks` is `0.6 * 90 = 54`;
(c) a captain exactly AT a phase boundary (`phaseProgressTicks` equal to old required, ratio `1.0`) —
confirm `Math.min(1, ...)` correctly caps at `1.0` and the result is exactly `newRequired` (no overshoot
past the phase boundary).

**Step 6: Update `save.test.ts`.** Read the whole file's existing migration-test conventions first (it
already has a dedicated `describe` block per past migration, following the same shape). Add a new
`describe("migrate — Tick Granularity Rebalance (v12 -> v13)", ...)` block covering:
- A captain with `mission: null` — confirm untouched (still `null` after migration).
- A captain mid-phase in `transitOut` for `shortOreRun` at some fractional old-progress value — confirm
  the exact hand-traced remapped `phaseProgressTicks` from Step 5's scenario (b), or an equivalent you
  construct and trace yourself.
- A captain mid-phase in `extracting` for `longOreRun` — same style of hand-traced assertion.
- The full `freshState()` → `serialize()` → `deserialize()` → `migrate()` round-trip test this
  codebase's convention includes for every past migration — confirm a fresh v13 state passes through
  unchanged (0 in-progress missions, so the new migration step is a pure `tickDurationSeconds` no-op on
  this path since `freshState()` already produces `1` directly, never touching `MIGRATIONS[12]` at all
  for a save already at the current version — but DO exercise `MIGRATIONS[12]` directly in the
  mid-phase tests above, not just through this round-trip).
- Update all `SAVE_VERSION`-referencing assertions in the file (search for `toBe(12)` / `.version`
  assertions) to `13`.

**Step 7: Commit.**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: save.ts v12->v13 migration -- percentage-preserving tick remap"
```

---

### Task 5: `tickBarPreference.ts` module + Options toggle + conditional render

**Files:**
- Create: `src/lib/tickBarPreference.ts`
- Modify: `src/App.svelte`

**Step 1: Read `src/lib/theme.ts` in full first** (36 lines) — mirror its exact structure, since this
new module is the same category of thing (a display preference, deliberately separate from the save
file so it survives "delete save").

**Step 2: Create `src/lib/tickBarPreference.ts`:**

```ts
// Tick-bar visibility persistence -- a display preference, deliberately
// separate from src/lib/game/save.ts's save-file contract so it survives a
// "delete save" (same rationale as src/lib/theme.ts).

const TICK_BAR_ENABLED_KEY = "fleet_admiral_tick_bar_enabled";

export function loadTickBarEnabled(): boolean {
  const raw = localStorage.getItem(TICK_BAR_ENABLED_KEY);
  return raw === null ? true : raw === "true";
}

export function saveTickBarEnabled(enabled: boolean): void {
  localStorage.setItem(TICK_BAR_ENABLED_KEY, String(enabled));
}
```

Default `true` when the key is entirely absent (matches `theme.ts`'s `DEFAULT_THEME` fallback pattern),
so existing users see no change unless they actively opt out.

**Step 3: Wire into `App.svelte`.** Read the current file's theme-loading code first (search for
`loadTheme()` — currently called inside `onMount`, around line 220) and mirror its exact timing/pattern
for the new preference:

- Add the import: `import { loadTickBarEnabled, saveTickBarEnabled } from "./lib/tickBarPreference";`
  (near the existing `import { loadTheme, saveTheme, ... } from "./lib/theme";` line, currently line 45).
- Add a `let tickBarEnabled = true;` state variable (near `let currentTheme: ThemeName = "cyan";`,
  currently line 100).
- Inside `onMount`, alongside `currentTheme = loadTheme();` (currently line 220), add:
  `tickBarEnabled = loadTickBarEnabled();`.

**Step 4: Wrap the existing tick-bar header markup in a conditional.** Read the current markup first
(search for `top-bar-tick-row` — currently lines 670-676):

```svelte
{#if tickBarEnabled}
      <div class="top-bar-tick-row">
        <span class="top-bar-tick-label">TICK:</span>
        <div class="tick-bar-track top-bar-tick-track">
          <div class="tick-bar-fill" style="width:{globalTickProgress * 100}%"></div>
        </div>
        <span class="top-bar-tick-readout">{globalTickRemaining.toFixed(1)}s</span>
      </div>
      {/if}
```

Do NOT change `globalTickProgress`/`globalTickRemaining`/`globalBarSeconds` (currently lines 642-644)
or the bar's own fill/animation CSS — this task only conditionally renders the EXISTING markup, no
visual redesign.

**Step 5: Add the Options-panel checkbox.** Read the current Options panel markup first (search for
`panel-title">OPTIONS` — currently around line 1091-1120). Add a new row, e.g. directly above the
existing `.theme-row` div:

```svelte
<div class="dev-row">
  <label class="dev-label">
    <input
      type="checkbox"
      checked={tickBarEnabled}
      on:change={(e) => {
        tickBarEnabled = (e.target as HTMLInputElement).checked;
        saveTickBarEnabled(tickBarEnabled);
      }}
    />
    Enable Tick Bar
  </label>
</div>
<p class="prestige-text">When enabled, the tick bar in the header fills once per tick. When disabled, it's removed from the header entirely.</p>
```

Reuse whatever existing class names (`dev-row`, `dev-label`, `prestige-text`, or equivalents already
present in this file) keep the new control visually consistent with the rest of the Options panel — read
the surrounding markup's actual class names yourself and adjust to match, don't assume the ones above
are exactly right if the live file differs.

**Step 6: Hand-trace verification.** Confirm: (a) on first-ever load (`localStorage` empty),
`tickBarEnabled` resolves to `true` and the header shows the tick bar exactly as it does today; (b)
after unchecking the box, `tickBarEnabled` becomes `false`, the header's tick-bar row disappears
entirely (not just visually hidden — the `{#if}` removes it from the DOM), and `localStorage` now holds
`"false"`; (c) reloading the page after that re-reads `"false"` from `localStorage` and keeps the bar
hidden.

**Step 7: Commit.**

```bash
git add src/lib/tickBarPreference.ts src/App.svelte
git commit -m "feat: Enable Tick Bar options toggle"
```

---

### Task 6: `App.svelte` — fix `totalTicks` undercounting `ordersReceived`

**Files:** Modify `src/App.svelte` (search for `totalTicks` — currently around lines 1259-1273).

**Step 1:** Read the current code first:

```svelte
{@const totalTicks = transitOutTicks + extractingTicks + transitBackTicks + unloadTicks}
```
```svelte
<div class="research-cost"><strong>Total: {totalTicks} ticks ({(totalTicks * state.tickDurationSeconds).toFixed(1)}s)</strong></div>
```

This has always omitted the mission-independent 1-tick `ordersReceived` phase every mission actually
starts with (pre-dating this rebalance entirely — caught while investigating an unrelated user report
during this feature's brainstorming).

**Step 2:** Fix the sum:

```svelte
{@const totalTicks = 1 + transitOutTicks + extractingTicks + transitBackTicks + unloadTicks}
```

The seconds-conversion line (`(totalTicks * state.tickDurationSeconds).toFixed(1)`) needs no separate
change — it already multiplies whatever `totalTicks` is.

**Step 3: Hand-trace verification.** For `shortOreRun` post-rebalance: `1 + 25 + 90 + 25 + 8 = 149`
ticks (at `tickDurationSeconds: 1`, this reads as `149.0s`) — matches the true full-cycle length
including `ordersReceived`, one more than the 148-tick total quoted in this plan's Task 1 (which
deliberately excluded `ordersReceived` since it's fixed/mission-independent).

**Step 4: Commit.**

```bash
git add src/App.svelte
git commit -m "fix: include ordersReceived's 1 tick in the mission-preview Total readout"
```

---

### Task 7: Docs + session log

**Files:** Modify `SESSION_LOG.md`. Modify `KNOWN_ISSUES.md` only if something genuinely warrants a
new entry (use judgement — the deferred variable-tick-bar-rate idea and the ship-loss/escape-pods idea
are already captured in `SUGGESTIONS.md` from this feature's brainstorming; don't duplicate them here
unless there's a genuinely new KNOWN_ISSUES-shaped gap, like a caveat about the migration's one-time
percentage-remap behavior).

**Step 1:** Read the 2-3 most recent `SESSION_LOG.md` entries first (Session 19, Session 20) to match
the established "**Session N** — Title" format and voice exactly.

**Step 2:** Append a new entry summarizing: the motivation (sub-10-second mission-duration precision,
explicitly NOT a "make the whole game faster" change — that's the existing `speed` multiplier's job),
the rebalanced `MISSIONS` values and why `extractionRatePerTick` deliberately stayed `10` (avoiding a
balance regression where fixed 1-3-unit tier yields would swallow a smaller per-tick budget), the
percentage-preserving v12→v13 migration and why it's more elaborate than a simple reset (user's explicit
reasoning: "flexibility and dynamicism involves complexity" — chosen deliberately, not because the
simpler option was wrong), the "Enable Tick Bar" toggle (mirrors `theme.ts`'s localStorage pattern,
default on, fully removes the header row when off), the deferred variable-fill-rate tick-bar idea and
the future online-only tick-speed-buff compatibility note (both already logged elsewhere — reference,
don't re-explain in full), and the adjacent `totalTicks`/`ordersReceived` bugfix.

**Step 3: Commit.**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: session log for Tick Granularity Rebalance"
```

Do NOT push — origin/main triggers a live Vercel production redeploy; wait for explicit confirmation
before any push, per this project's established practice.

---

## After all tasks: final holistic review

Once all 7 tasks (plus Task 0's worktree setup) are committed and individually reviewed, dispatch one
final holistic review of the WHOLE branch before presenting merge options — same pattern as every prior
feature this session. Specifically re-verify:

1. Grep the ENTIRE `src/` directory for any remaining hardcoded reference to the OLD `MISSIONS` values
   (`transitOutTicks: 3`, `cargoCapacity: 100`, etc.) outside of `save.ts`'s intentional
   `OLD_MISSION_TICKS_V12` snapshot (which must NOT be touched — that's a deliberate historical record,
   not a bug).
2. Confirm `SAVE_VERSION` is `13` everywhere it's asserted in `save.test.ts`, with no leftover `12`
   assertions.
3. Trace a COMPLETE round trip by hand one more time: a hand-constructed v12-shaped save with a captain
   mid-`extracting` on `longOreRun` → `migrate()` → confirm the final `phaseProgressTicks` matches the
   expected percentage-preserved value against the NEW `longOreRun` extracting tick-count (90).
4. Confirm the tick-bar toggle's default (`true`) doesn't regress the visual behavior for any existing
   player who never touches the Options panel — the header should look identical to before this branch
   unless they explicitly opt out.
5. Confirm `tick.ts` itself has zero diff in this branch (this whole plan should only touch `model.ts`,
   `save.ts`, `App.svelte`, and test files — `tick.ts`'s phase-advancement logic was never meant to
   change).
