# Fleet Admiral XP Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace Fleet Admiral XP's "recomputed from the sum of captain levels" mechanic (effectively
frozen under realistic play) with an earn-per-mission-completion model, mirroring how captain XP already
works.

**Architecture:** `MissionDef` gains a per-mission flat Fleet Admiral XP award. `tickCaptainMission`
accumulates it locally (same "accumulate across captains, apply once" shape `homePlanetDelta` already
uses) and returns it as a new field. `recomputeFleetAdmin` is replaced by `applyFleetAdminXp`, which adds
the delta and resolves level-ups by subtracting the threshold each time (mirroring captain XP's own
loop), capped at a bounded max iterations per call to guard against a large offline-catchup jump.

**Tech Stack:** Vite + Svelte 5 + TypeScript + Vitest. No new dependencies.

---

## Before you start

Node.js/npm/tsc are not available in this environment — verify everything by reading code and
hand-tracing, same as every other feature this session. Confirmed via `git log --oneline -- src/lib/game/tick.ts src/lib/game/model.ts`
before this plan was written: nothing has touched either file since the Loot Tier Rework merge
(`6e471cf`/`d6d0218`), so the line numbers below are accurate against the current `main` branch.

This branch must merge **before** the Big-Number Migration's implementation begins
(`docs/plans/2026-07-08-big-number-migration-plan.md` is written and committed, but not yet started) —
both touch `tick.ts`/`model.ts`, and `fleetAdminXp` is directly in that migration's scope. The last task
in this plan includes a small follow-up note for that other plan document.

---

### Task 0: Set up git worktree

**Step 1:** Verify `main` is clean:

```bash
cd "F:/Windows Folders/Documents/fleet-admiral"
git status
git branch --show-current
```

Expected: `On branch main`, `nothing to commit, working tree clean`.

**Step 2:** Create the worktree:

```bash
git worktree add .worktrees/feat-fleet-admiral-xp-rework -b feat/fleet-admiral-xp-rework
cd .worktrees/feat-fleet-admiral-xp-rework
```

All subsequent tasks operate inside
`F:\Windows Folders\Documents\fleet-admiral\.worktrees\feat-fleet-admiral-xp-rework`.

---

### Task 1: `model.ts` — `fleetAdminXpPerCycle` field + curve bump

**Files:** Modify `src/lib/game/model.ts` (396 lines), `src/lib/game/model.test.ts` (202 lines).

**Step 1:** Add `fleetAdminXpPerCycle: number` to the `MissionDef` interface (currently lines 37-57),
placed near `extractionRatePerTick`/`cargoCapacity` with a comment distinguishing it from those (it's a
FLAT per-cycle award, not a per-tick rate):

```ts
export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // total units/tick, regardless of which tier they land as
  cargoCapacity: number; // total units across all tiers; MUST divide evenly by extractionRatePerTick
  // for this launch's requiredTicksForPhase() to have no partial-final-tick
  // edge case -- see that function's comment below if this is ever violated.
  uncommonChance: number;
  rareChance: number;
  tier: MissionTier;
  // Flat Fleet Admiral XP awarded once per completed mission CYCLE (not per
  // tick, unlike extractionRatePerTick above) -- mirrors how captain XP is
  // awarded (see tick.ts's XP_PER_MISSION_CYCLE), but each mission has its
  // OWN value rather than one shared constant, so a longer/harder mission
  // can be worth more. This is only the FIRST of several planned Fleet
  // Admiral XP sources (2026-07-08 user note: crafting, talent purchases,
  // and a future talent-tree effect boosting this value are all planned
  // later) -- the values here and xpForNextFleetAdminLevel's curve below are
  // deliberately NOT calibrated as if missions alone must carry the full
  // weight of Fleet Admiral progression. Don't "fix" this later assuming
  // it's undertuned for mission-only play -- it's intentionally left room
  // for other income streams to stack on top.
  fleetAdminXpPerCycle: number;
}
```

**Step 2:** Add the values to both `MISSIONS` entries (currently lines 65-88):

```ts
export const MISSIONS: Record<"shortOreRun" | "longOreRun", MissionDef> = {
  shortOreRun: {
    label: "Short Ore Run",
    transitOutTicks: 3,
    transitBackTicks: 3,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    uncommonChance: 0.019,
    rareChance: 0.001,
    tier: "I",
    fleetAdminXpPerCycle: 1,
  },
  longOreRun: {
    label: "Long Ore Run",
    transitOutTicks: 8,
    transitBackTicks: 8,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    uncommonChance: 0.08,
    rareChance: 0.02,
    tier: "I",
    fleetAdminXpPerCycle: 2,
  },
};
```

**Step 3:** Bump `xpForNextFleetAdminLevel`'s multiplier (currently lines 174-192 — the function itself
plus its existing "CAUTION" comment above it) from `500` to `2500`, and REPLACE the existing caution
comment (which documented the now-fixed mismatch) with one explaining the new model:

```ts
// Deliberately much steeper than a captain's own xpForNextLevel -- the
// intent (per design doc) is that Fleet Admiral levels lag well behind
// individual captain levels. A simple quadratic-ish curve achieves that
// without needing per-level hand-tuning (unlike a Fleet-Logistics-style
// finite talent table).
//
// 2026-07-08 (docs/plans/2026-07-08-fleet-admiral-xp-rework-plan.md):
// multiplier bumped from 500 to 2500 as part of switching Fleet Admiral XP
// from "recomputed as the sum of captain levels" (effectively frozen under
// realistic play -- confirmed live, see this plan's design doc) to
// "earned per completed mission cycle," mirroring captain XP. This value is
// a launch placeholder, same convention as MISSIONS/RECIPES/talent costs
// elsewhere in this codebase -- and per the user's own explicit note,
// deliberately NOT calibrated assuming mission XP is the only income source
// Fleet Admiral leveling will ever have (more sources are planned later).
export function xpForNextFleetAdminLevel(level: number): number {
  return 2500 * level * level;
}
```

**Step 4: Verify.** Re-read the whole `MissionDef` interface and both `MISSIONS` entries once more —
confirm `fleetAdminXpPerCycle` is present, correctly typed `number`, and set to `1`/`2` respectively.
Confirm `xpForNextFleetAdminLevel`'s body now reads `2500`, not `500`.

**Step 5: Update `model.test.ts`.** Read the file's `describe("MISSIONS — launch set", ...)` block
(currently lines 99-125) and add an assertion for the new field to the existing
`"has exactly 2 missions with the specified tick counts and cargo/extraction values"` test (lines
100-110) — do not create a whole new `it(...)` for one field, extend the existing one, matching this
test's existing "one test, many related assertions" shape:

```ts
    expect(MISSIONS.shortOreRun.fleetAdminXpPerCycle).toBe(1);
    expect(MISSIONS.longOreRun.fleetAdminXpPerCycle).toBe(2);
```

Do NOT touch `freshState()`'s own test (currently around lines 197-198, asserting
`state.fleetAdminXp`/`fleetAdminLevel` default to `0`/`1`) — `freshState()`'s defaults are unchanged by
this plan, only how `fleetAdminXp` accumulates OVER TIME changes.

**Step 6: Commit.**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: add fleetAdminXpPerCycle to MissionDef, bump xpForNextFleetAdminLevel curve"
```

---

### Task 2: `tick.ts` — `fleetAdminXpDelta` accumulation + `applyFleetAdminXp` + wiring

**Files:** Modify `src/lib/game/tick.ts` (576 lines — read the whole file fresh first, don't trust
line numbers from any other conversation; the numbers below were confirmed against the current file at
plan-writing time).

**Step 1:** Add the bounded-loop constant near the other tuning constants (`MISSION_TICK_EPSILON`,
`XP_PER_MISSION_CYCLE`, currently around lines 115-121):

```ts
// A very large offline-catchup ticksElapsed could complete many mission
// cycles across many captains in one tick() call, each contributing 1-2
// Fleet Admiral XP -- summing to a potentially large delta applied in one
// shot. Capping applyFleetAdminXp's level-up loop at a fixed max per call
// and carrying any leftover XP forward (it keeps resolving on the NEXT
// tick() call, which happens continuously during live play) avoids an
// unbounded loop. This same constant is reused (not redefined) by the
// separate, not-yet-started Big-Number Migration
// (docs/plans/2026-07-08-big-number-migration-plan.md), which needs the
// identical safeguard for captain XP once that field becomes Decimal-typed.
const MAX_LEVEL_UPS_PER_TICK = 10_000;
```

**Step 2:** `tickCaptainMission`'s return type (currently line 206) gains a new field:

```ts
): { captain: CaptainState; homePlanetDelta: Record<LootMaterialKey, number>; fleetAdminXpDelta: number } {
```

**Step 3:** Inside `tickCaptainMission`, add a local accumulator near the other per-call locals
(currently around lines 213-220, alongside `homePlanetDelta`/`xp`/`level`/`statPoints`):

```ts
  let fleetAdminXpDelta = 0;
```

**Step 4:** At the cycle-completion XP award (currently lines 292-297, `xp += XP_PER_MISSION_CYCLE;`
through the level-up `while` loop), add the Fleet Admiral accumulation immediately after the captain XP
award line:

```ts
        xp += XP_PER_MISSION_CYCLE;
        fleetAdminXpDelta += missionDef.fleetAdminXpPerCycle;
        while (xp >= xpForNextLevel(level)) {
```

(the `while` loop and everything after it is UNCHANGED — this only adds the one new accumulation line,
right after the existing captain XP award, since both fire on the exact same "one full cycle just
completed" event).

**Step 5:** Update the function's final `return` statement (currently line 316):

```ts
  return { captain: { ...captain, mission, xp, level, statPoints }, homePlanetDelta, fleetAdminXpDelta };
```

**Step 6:** Replace `recomputeFleetAdmin` (currently lines 328-341) entirely with `applyFleetAdminXp`:

```ts
// Replaces the old recomputeFleetAdmin (which recomputed fleetAdminXp fresh
// each call as the sum of every captain's level -- effectively frozen under
// realistic play, see this plan's design doc for the live-tested root
// cause). This function instead ADDS an already-computed delta (summed
// across every captain's completed mission cycles this call, fleet-wide,
// same "accumulate locally, apply once" shape as homePlanetDelta) and
// resolves level-ups by SUBTRACTING the threshold each time -- mirroring
// captain XP's own subtract-and-carry-forward loop exactly, capped at
// MAX_LEVEL_UPS_PER_TICK to guard against a very large offline-catchup
// delta (see that constant's own comment above).
export function applyFleetAdminXp(state: GameState, fleetAdminXpDelta: number): GameState {
  if (fleetAdminXpDelta <= 0) return state; // cheap no-op on the overwhelmingly common poll where nobody's mission cycle completed

  let xp = state.fleetAdminXp + fleetAdminXpDelta;
  let level = state.fleetAdminLevel;
  let adminPoints = state.adminPoints;
  let levelUpsThisCall = 0;
  while (xp >= xpForNextFleetAdminLevel(level) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK) {
    xp -= xpForNextFleetAdminLevel(level);
    level += 1;
    adminPoints += 1;
    levelUpsThisCall += 1;
  }

  return { ...state, fleetAdminXp: xp, fleetAdminLevel: level, adminPoints };
}
```

**Step 7:** Update `tick()`'s captain loop (currently lines 361-377) to accumulate `fleetAdminXpDelta`
across every captain, mirroring exactly how `homePlanetDelta` is already accumulated:

```ts
  const homePlanetDelta = emptyLootTotals();
  let fleetAdminXpDelta = 0;
  const fleetRareYield = fleetRareYieldMult(state);
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const bonuses = {
      commonYieldMult: captainCommonYieldMult(captain),
      uncommonYieldMult: captainUncommonYieldMult(captain),
      uncommonChanceMult: captainUncommonChanceMult(captain),
      rareYieldMult: fleetRareYield,
      rareChanceMult: captainRareChanceMult(captain),
    };
    const { captain: updated, homePlanetDelta: delta, fleetAdminXpDelta: captainFleetAdminXpDelta } = tickCaptainMission(
      ticksElapsed,
      captain,
      Math.random,
      bonuses
    );
    (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
      homePlanetDelta[key] += delta[key];
    });
    fleetAdminXpDelta += captainFleetAdminXpDelta;
    return updated;
  });
```

**Step 8:** Update `tick()`'s final `return` statement (currently lines 401-422) to call
`applyFleetAdminXp` instead of `recomputeFleetAdmin`:

```ts
  return applyFleetAdminXp(
    {
      ...state,
      captains,
      gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
      homePlanet: {
        storage: {
          ...state.homePlanet.storage,
          commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
          uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
          rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
        },
      },
    },
    fleetAdminXpDelta
  );
```

**Step 9: Verify.** Grep the whole file for `recomputeFleetAdmin` and confirm zero remaining references
(it's fully replaced, not kept alongside the new function). Hand-trace: 1 captain running `shortOreRun`,
completes exactly 1 cycle within a `tick()` call. `tickCaptainMission` returns
`fleetAdminXpDelta: 1` (from `missionDef.fleetAdminXpPerCycle`). `tick()`'s `.map()` accumulates
`fleetAdminXpDelta = 0 + 1 = 1`. `applyFleetAdminXp(state, 1)`: `1 <= 0` is false, proceeds.
`xp = state.fleetAdminXp + 1`. Assuming `state.fleetAdminXp` starts at `0` and `state.fleetAdminLevel`
is `1`: `xp = 1`. `xpForNextFleetAdminLevel(1) = 2500`. `1 >= 2500` is false — loop doesn't run.
Returns `{ ...state, fleetAdminXp: 1, fleetAdminLevel: 1, adminPoints: 0 }`. Confirms Fleet Admiral XP
now genuinely increments per completed mission, unlike the old frozen-in-practice mechanic.

**Step 10: Commit.**

```bash
git add src/lib/game/tick.ts
git commit -m "feat: Fleet Admiral XP earned per mission cycle, applyFleetAdminXp replaces recomputeFleetAdmin"
```

---

### Task 3: `tick.test.ts` — comprehensive updates

**Files:** Modify `src/lib/game/tick.test.ts` (1052 lines).

**Step 1:** Update the import (currently line 10): replace `recomputeFleetAdmin` with
`applyFleetAdminXp`.

**Step 2:** Delete the ENTIRE `describe("recomputeFleetAdmin", ...)` block (currently lines 983-1052,
the last block in the file — confirmed via grep that every `fleetAdmin`-related assertion in this file
lives inside this one block, nothing elsewhere references it). This mechanic no longer exists in this
shape; the tests are being replaced wholesale, not patched, same convention this codebase's own
`tick.test.ts`/`model.test.ts` already established for the Loot Tier Rework's removed mechanism.

**Step 3:** Add a new `describe("applyFleetAdminXp", ...)` block in its place:

```ts
describe("applyFleetAdminXp", () => {
  it("is a no-op (same state reference) when the delta is zero or negative", () => {
    const state = freshState();
    const result = applyFleetAdminXp(state, 0);
    expect(result).toBe(state);
    const resultNegative = applyFleetAdminXp(state, -5);
    expect(resultNegative).toBe(state);
  });

  it("adds the delta to fleetAdminXp when no level-up threshold is crossed", () => {
    // xpForNextFleetAdminLevel(1) = 2500 * 1 * 1 = 2500. A delta of 100 stays
    // well under that -- no level-up, xp just accumulates.
    const state = freshState();
    const result = applyFleetAdminXp(state, 100);
    expect(result.fleetAdminXp).toBe(100);
    expect(result.fleetAdminLevel).toBe(1);
    expect(result.adminPoints).toBe(0);
  });

  it("resolves exactly one level-up and carries the remainder forward, mirroring captain XP's subtract-and-carry shape", () => {
    // xpForNextFleetAdminLevel(1) = 2500. Starting fleetAdminXp at 2000, delta
    // 600 -> xp = 2600. 2600 >= 2500 -> level 2, xp -= 2500 -> xp = 100.
    // xpForNextFleetAdminLevel(2) = 2500*4 = 10000. 100 >= 10000? No -- loop stops.
    const state = freshState();
    state.fleetAdminXp = 2000;
    const result = applyFleetAdminXp(state, 600);
    expect(result.fleetAdminLevel).toBe(2);
    expect(result.fleetAdminXp).toBe(100);
    expect(result.adminPoints).toBe(1);
  });

  it("a large single delta resolves every level-up crossed, not just one", () => {
    // Hand-traced: fleetAdminXp starts 0, delta 13000.
    // xpForNextFleetAdminLevel(1)=2500: 13000>=2500 -> level 2, xp=10500.
    // xpForNextFleetAdminLevel(2)=10000: 10500>=10000 -> level 3, xp=500.
    // xpForNextFleetAdminLevel(3)=22500: 500>=22500? No -- loop stops.
    // Final: level 3, xp 500, adminPoints 2.
    const state = freshState();
    const result = applyFleetAdminXp(state, 13000);
    expect(result.fleetAdminLevel).toBe(3);
    expect(result.fleetAdminXp).toBe(500);
    expect(result.adminPoints).toBe(2);
  });

  it("caps at MAX_LEVEL_UPS_PER_TICK level-ups per call, leaving the remainder unresolved rather than looping unboundedly", () => {
    // Can't hand-trace 10,000 individual level-up steps one by one -- instead,
    // construct a delta PROVABLY large enough to require MORE than
    // MAX_LEVEL_UPS_PER_TICK (10,000) level-ups to fully resolve if uncapped,
    // using the closed-form sum of xpForNextFleetAdminLevel's quadratic
    // thresholds: sum_{k=1}^{n} 2500*k^2 = 2500 * n*(n+1)*(2n+1)/6 is the
    // EXACT total XP needed to go from level 1 through exactly n level-ups
    // (level 1 -> level n+1). A naive "10,001 * 2500" delta (linear
    // reasoning applied to a QUADRATIC curve) is nowhere near enough --
    // verified by direct calculation before writing this test: the true sum
    // for 10,000 level-ups is 833,458,337,500,000, not merely 25,002,500.
    // Adding ONE MORE full threshold's worth on top of the exact
    // 10,000-level-up sum guarantees the delta requires at least one level-up
    // beyond what the cap allows, if the cap weren't there.
    const sumOfSquaresTo = (n: number) => (n * (n + 1) * (2 * n + 1)) / 6;
    const xpForExactly10000LevelUps = 2500 * sumOfSquaresTo(10_000); // 833,458,337,500,000
    const oneMoreThreshold = 2500 * 10_001 * 10_001; // xpForNextFleetAdminLevel(10001)
    const delta = xpForExactly10000LevelUps + oneMoreThreshold;

    const result = applyFleetAdminXp(freshState(), delta);

    // Uncapped, this delta would resolve AT LEAST 10,001 level-ups (level 1 ->
    // 10,002 or beyond). WITH the cap, at most MAX_LEVEL_UPS_PER_TICK (10,000)
    // level-ups can happen in this one call -- fleetAdminLevel started at 1,
    // so it can reach AT MOST level 10,001, never higher, no matter how much
    // XP the delta represents.
    expect(result.fleetAdminLevel).toBeLessThanOrEqual(10_001);
    expect(result.adminPoints).toBeLessThanOrEqual(10_000);
    // The cap stopping the loop mid-resolution (not the loop naturally
    // running out of xp to consume) means a meaningful amount of xp must
    // remain unconsumed -- this delta was deliberately built to have MORE
    // than the exact resolving sum, so some remainder greater than 0 must
    // be left over.
    expect(result.fleetAdminXp).toBeGreaterThan(0);
  });
});
```

**Step 4:** Search the whole file for any OTHER test asserting on `tickCaptainMission`'s return shape via
a full-object comparison (e.g. `toEqual({ captain: ..., homePlanetDelta: ... })` with no
`fleetAdminXpDelta` key) — if any exist, they'd now fail since the real return object has an extra key.
Based on this file's existing structure (every `tickCaptainMission` test destructures only the specific
fields it needs, e.g. `const { captain } = tickCaptainMission(...)` or
`const { captain, homePlanetDelta } = tickCaptainMission(...)`, never a whole-object `toEqual`), no such
test is expected to exist — confirm this by grep`ing for `toEqual(` near `tickCaptainMission` call sites
before concluding no changes are needed there.

**Step 5: Commit.**

```bash
git add src/lib/game/tick.test.ts
git commit -m "test: replace recomputeFleetAdmin tests with applyFleetAdminXp coverage"
```

---

### Task 4: `App.svelte` — live tick loop wiring

**Files:** Modify `src/App.svelte` (1871 lines).

**Step 1:** Update the import (search for `recomputeFleetAdmin` in the import block, currently around
line 32): replace with `applyFleetAdminXp`.

**Step 2:** Add a local `fleetAdminXpDelta` accumulator inside the `setInterval` callback, near the
existing `homePlanetDelta` declaration (currently around line 294):

```ts
      let fleetAdminXpDelta = 0;
```

**Step 3:** Inside the per-captain loop (currently around lines 318-357), capture and accumulate the new
field from `tickCaptainMission`'s return (mirroring `tick.ts`'s own wiring from Task 2, Step 7):

```ts
          const { captain: updatedCaptain, homePlanetDelta: delta, fleetAdminXpDelta: captainFleetAdminXpDelta } = tickCaptainMission(
            ticksElapsed,
            captain,
            Math.random,
            bonuses
          );
          captains[i] = updatedCaptain;
          fleetAdminXpDelta += captainFleetAdminXpDelta;
          if (delta.commonOre !== 0 || delta.uncommonMaterial !== 0 || delta.rareMaterial !== 0) {
            anyLootDelivered = true;
            homePlanetDelta.commonOre += delta.commonOre;
            homePlanetDelta.uncommonMaterial += delta.uncommonMaterial;
            homePlanetDelta.rareMaterial += delta.rareMaterial;
          }
```

**Step 4:** Update the final call site (currently around line 415, `state = recomputeFleetAdmin(state);`)
to call `applyFleetAdminXp` with the accumulated delta instead:

```ts
      state = applyFleetAdminXp(state, fleetAdminXpDelta);
```

Note this call now needs to happen OUTSIDE the `if (progress >= 1)` block it currently sits inside (or
rather, `fleetAdminXpDelta` needs to be declared before that block and default to `0` if `progress < 1`
this poll, same as `homePlanetDelta` already is) — read the surrounding structure carefully: confirm
`fleetAdminXpDelta`'s declaration (Step 2 above) is placed at the SAME scope level as `homePlanetDelta`'s
own declaration (i.e., before the `if (progress >= 1)` block, defaulting to `0`, only incremented INSIDE
that block when a captain's mission cycle actually completes this poll), so the `applyFleetAdminXp` call
at the end always has a defined value to pass, whether or not `progress >= 1` this particular poll.

**Step 5: Verify.** Re-read the whole `setInterval` callback once more, start to finish. Confirm
`fleetAdminXpDelta` is declared once, accumulated only inside the per-captain loop, and consumed exactly
once at the final `applyFleetAdminXp` call. Confirm no reference to `recomputeFleetAdmin` remains
anywhere in `App.svelte` (grep the whole file).

**Step 6: Commit.**

```bash
git add src/App.svelte
git commit -m "feat: App.svelte live tick loop -- Fleet Admiral XP earned per mission cycle"
```

---

### Task 5: Docs + session log + Big-Number Migration plan follow-up

**Files:** Modify `SESSION_LOG.md`. Modify
`docs/plans/2026-07-08-big-number-migration-plan.md`. Modify `KNOWN_ISSUES.md` only if something
genuinely warrants a new entry.

**Step 1:** Append a new SESSION_LOG.md entry (match the established format, read the most recent entry
first) summarizing: the live-tested root cause (Fleet Admiral XP recomputed from captain-level sum,
effectively frozen), the new earn-per-mission-cycle mechanic (`fleetAdminXpPerCycle` on `MissionDef`,
`applyFleetAdminXp` replacing `recomputeFleetAdmin`), the curve bump to `2500 * level^2`, the
`MAX_LEVEL_UPS_PER_TICK` bounded-loop safeguard (and that it's designed to be reused, not redefined, by
the still-pending Big-Number Migration), and the user's explicit balance caveat that mission XP is only
the first of several planned Fleet Admiral XP sources.

**Step 2:** Update `docs/plans/2026-07-08-big-number-migration-plan.md`'s Task 5 (currently titled
"`tick.ts` — XP/leveling arithmetic + bounded level-up loop fix") — read that task's current text in
full first. It currently describes introducing `MAX_LEVEL_UPS_PER_TICK` and rewriting
`recomputeFleetAdmin` from scratch; both of those now already exist (this plan built them). Amend that
task's text to reflect: `MAX_LEVEL_UPS_PER_TICK` already exists (from this plan) and should be REUSED,
not redefined; the function to make Decimal-aware is now `applyFleetAdminXp` (not
`recomputeFleetAdmin`, which no longer exists); the bounded-loop STRUCTURE is already correct and only
needs its arithmetic operators swapped to `Decimal` methods (per that plan's own rewrite-pattern table),
not designed from scratch. Do not rewrite that whole task — a targeted edit noting what changed and why
is sufficient, so a future reader of that plan isn't confused finding a function name that no longer
exists.

**Step 3:** Only if something genuinely warrants it, add a `KNOWN_ISSUES.md` entry — read 2 existing
entries for style match first. Consider whether the "no cap-hit test is hand-traceable, only bounds are
asserted" aspect of Task 3's `MAX_LEVEL_UPS_PER_TICK` test is worth a note, or whether it's already
adequately explained by the test's own comment. Use judgement; it's fine to add nothing if nothing
genuinely warrants it.

**Step 4: Commit.**

```bash
git add SESSION_LOG.md docs/plans/2026-07-08-big-number-migration-plan.md KNOWN_ISSUES.md
git commit -m "docs: session log for Fleet Admiral XP Rework + Big-Number Migration plan follow-up"
```

Do NOT push — origin/main triggers a live Vercel production redeploy; wait for explicit confirmation
before any push, per this project's established practice.

---

## After all tasks: final holistic review

Once all 5 tasks (plus Task 0's worktree setup) are committed and individually reviewed, dispatch one
final holistic review of the whole branch before presenting merge options, same pattern as every other
feature this session. Specifically re-verify, viewing the branch as a whole:

1. Grep the ENTIRE `src/` directory for any remaining reference to `recomputeFleetAdmin` — it should be
   fully gone, not left as dead code or a stale import anywhere.
2. Confirm `MAX_LEVEL_UPS_PER_TICK` is defined exactly ONCE in `tick.ts`, not accidentally duplicated.
3. Confirm the full live-play path is coherent end-to-end: a captain completes a mission cycle in the
   LIVE tick loop (`App.svelte`) → `fleetAdminXpDelta` accumulates → `applyFleetAdminXp` is called → the
   SAME captain completing a cycle during OFFLINE CATCH-UP (`tick()` in `tick.ts`, called once at load)
   produces the identical `fleetAdminXpDelta`/`applyFleetAdminXp` behavior — both paths must agree, same
   closed-form spirit as every other mechanic in this codebase.
4. Confirm the `docs/plans/2026-07-08-big-number-migration-plan.md` follow-up edit (Task 5, Step 2) reads
   coherently on its own — a future reader starting THAT plan fresh should not be confused about which
   function/constant already exists versus which this plan still expects them to build.
