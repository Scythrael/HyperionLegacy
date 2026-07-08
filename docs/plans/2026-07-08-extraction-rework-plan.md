# Extraction Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix a real regression (extraction rate left unscaled after the Tick Granularity Rebalance,
silently 10x-ing real-time common-ore income) and replace the independent-and-subtractive loot-tier
mechanic with a sequential, mutually-exclusive roll that removes the old 1-3-unit uncommon cap and
flat-1 rare cap.

**Architecture:** `rollExtractionTick` (tick.ts) is rewritten from "roll uncommon and rare
independently, subtract whatever hits from a shared pool, common absorbs the leftover" to "roll rare
first, then uncommon if rare missed, else common — guaranteed, no cap, full per-tick amount to
whichever tier wins." `MISSIONS`' `extractionRatePerTick`/`cargoCapacity` both divide by 10 (10→1,
900→90), keeping the 90-tick extraction phase length unchanged. Talent/bonus-scaling changes are
deliberately OUT of scope — sequenced as a separate follow-up per the user's explicit request.

**Tech Stack:** Vite + Svelte + TypeScript, Vitest (present but not executable in this environment — no
Node/npm/tsc available; every task is verified by manual hand-trace, same as every prior feature this
session).

---

### Task 0: Set up git worktree

**REQUIRED SUB-SKILL:** Use superpowers:using-git-worktrees.

Create worktree at `.worktrees/feat-extraction-rework` on new branch `feat/extraction-rework`, branched
from `main` (confirm exact current commit via `git log --oneline -1` before branching — should be at or
after `c055a6f`). `.worktrees/` is already gitignored. No `npm install` step — no usable Node/npm in
this environment.

---

### Task 1: `model.ts` — rescale `extractionRatePerTick`/`cargoCapacity`

**Files:** Modify `src/lib/game/model.ts` (read the current `MISSIONS` table yourself first — do not
trust line numbers here, they may have drifted since this plan was written).

**Step 1:** Change both missions' `extractionRatePerTick` from `10` to `1`, and `cargoCapacity` from
`900` to `90`. Do NOT touch `uncommonChance`/`rareChance`/`transitOutTicks`/`transitBackTicks`/
`unloadTicks`/`tier`/`fleetAdminXpPerCycle`/`label` — none of those change in this rework.

**Step 2:** The `MISSIONS` table's own header comment currently references an example calculation like
"900/10 = 90" (from the prior branch) — update it to "90/1 = 90" if it exists, preserving the same
sentence structure/meaning (the invariant is still "cargoCapacity MUST divide evenly by
extractionRatePerTick").

**Step 3 — verify by hand-trace:** Confirm `requiredTicksForPhase("extracting", MISSIONS.shortOreRun)`
(the unchanged function — `Math.ceil(missionDef.cargoCapacity / missionDef.extractionRatePerTick)`)
computes `Math.ceil(90/1) = 90` for both missions — UNCHANGED from before this rework, confirming the
mission-duration rebalance from the prior branch stays intact; only the per-tick amount and mechanic
change.

**Step 4:** Grep the whole file for any other reference to the old `10`/`900` values in a
`MISSIONS`-related comment that might need updating alongside the table itself.

**Step 5: Commit.**

```bash
git add src/lib/game/model.ts
git commit -m "fix: rescale extractionRatePerTick/cargoCapacity 10x down (regression fix)"
```

---

### Task 2: `model.test.ts` — update hardcoded assertions

**Files:** Modify `src/lib/game/model.test.ts` (read it fresh — it's short).

**Step 1:** Update the `"has exactly 2 missions with the specified tick counts and cargo/extraction
values"` test: `MISSIONS.shortOreRun.extractionRatePerTick` assertion `10→1`, `.cargoCapacity` assertion
`900→90`; `MISSIONS.longOreRun.cargoCapacity` assertion `900→90`. `longOreRun.extractionRatePerTick`
isn't currently asserted in this test (confirm this yourself against the live file) — if it IS asserted
somewhere, update it too.

**Step 2:** Update the `"extracting is cargoCapacity / extractionRatePerTick, rounded up"` test's
comment and assertion: `Math.ceil(90/1) = 90` (unchanged result, new numbers) — the assertion itself
(`requiredTicksForPhase("extracting", MISSIONS.shortOreRun)).toBe(90)`) does NOT need to change (still
`90`), but the comment explaining the math needs updating to show `90/1` instead of `900/10`.

**Step 3:** Grep the whole file for `MISSIONS.` and confirm nothing else references the old values.

**Step 4: Commit.**

```bash
git add src/lib/game/model.test.ts
git commit -m "test: update model.test.ts for rescaled extractionRatePerTick/cargoCapacity"
```

---

### Task 3: `tick.ts` — rewrite `rollExtractionTick`'s mechanic

**Files:** Modify `src/lib/game/tick.ts` (read `rollExtractionTick` and its header comment fresh — search
for `function rollExtractionTick`).

**Step 1:** Replace the ENTIRE function (including its header comment, which needs a full rewrite, not
a patch) with:

```ts
// Sequential, mutually exclusive per-tier roll for ONE whole tick of extraction
// (2026-07-08 Extraction Rework -- see the design doc). Replaces the old
// independent-and-subtractive Loot Tier Rework mechanic: uncommon and rare no
// longer both roll independently and get carved out of a shared pool -- instead,
// each tick rolls AT MOST one tier, in strict priority order (rare, then
// uncommon, then a guaranteed common floor), and whichever tier wins gets the
// FULL extractionRatePerTick amount in that material -- no more capping
// uncommon at a 1-3-unit bucket or rare at a flat 1 unit.
//
// Exactly 1 or 2 rng() calls happen (never 3+), in this fixed order:
//   1. does rare occur (rng() < effective rare chance) -- if yes, STOP here, award rare.
//   2. IF rare did not occur: does uncommon occur (rng() < effective uncommon
//      chance) -- if yes, STOP here, award uncommon. If uncommon ALSO fails,
//      common is awarded unconditionally (no 3rd roll needed).
// This fixed call count/order matters for hand-tracing a deterministic test rng,
// and for the closed-form guarantee tickCaptainMission depends on (use a
// CONSTANT, non-stateful rng in tests -- see that function's own comment).
//
// yieldMults scale the FULL per-tick amount of whichever tier wins --
// commonYieldMult/uncommonYieldMult/rareYieldMult each only ever apply to
// their OWN tier's award, never blended together, since exactly one tier wins
// per tick now (unlike the old mechanic, where commonYieldMult scaled a
// "leftover after carve-out" amount that could be affected by how much
// uncommon/rare had already consumed). A direct consequence: uncommonYieldMult
// and rareYieldMult now CAN change the deterministic per-tick total when that
// tier wins (they couldn't meaningfully before, since the old mechanic capped
// their amounts at 1-3/1 units against a much larger base rate) -- see
// tick.test.ts's updated comments for what this means for testing wiring.
function rollExtractionTick(
  missionDef: MissionDef,
  bonuses: {
    commonYieldMult: number;
    uncommonYieldMult: number;
    uncommonChanceMult: number;
    rareYieldMult: number;
    rareChanceMult: number;
  },
  rng: () => number
): Record<LootMaterialKey, Decimal> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));
  const baseAmount = new Decimal(missionDef.extractionRatePerTick);

  if (rng() < effectiveRareChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: baseAmount.times(1 + bonuses.rareYieldMult) };
  }
  if (rng() < effectiveUncommonChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: baseAmount.times(1 + bonuses.uncommonYieldMult), rareMaterial: new Decimal(0) };
  }
  return { commonOre: baseAmount.times(1 + bonuses.commonYieldMult), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
}
```

`effectiveUncommonChance`/`effectiveRareChance`'s formulas are byte-identical to today's — only what
happens once you know which tier occurred changes.

**Step 2 — hand-trace verification before committing:** Confirm at least these 4 scenarios yourself
against the actual new code: (a) `rng` constant `0` — `0 < effectiveRareChance` is true for any mission
with a positive `rareChance`, so rare ALWAYS wins on the very first call, full `baseAmount` (scaled by
`rareYieldMult`); (b) `rng` constant `0.5` on shortOreRun (`rareChance=0.001`, `uncommonChance=0.019`) —
`0.5 < 0.001`? no. `0.5 < 0.019`? no. → common wins, full `baseAmount` (scaled by `commonYieldMult`);
(c) `rng` constant `0.01` on shortOreRun — `0.01 < 0.001`? no. `0.01 < 0.019`? yes → uncommon wins, full
`baseAmount` (scaled by `uncommonYieldMult`), common and rare both `0`; (d) confirm `rollExtractionTick`
never makes more than 2 `rng()` calls in any branch.

**Step 3:** Grep the rest of `tick.ts` for any other reference to the old mechanic's shape (e.g. any
comment elsewhere in the file describing "independent rolls" or "carve out") that might need a
cross-reference update, though the function itself is the only place the actual logic lives.

**Step 4: Commit.**

```bash
git add src/lib/game/tick.ts
git commit -m "feat: rollExtractionTick -- sequential mutually-exclusive roll, no per-tier cap"
```

---

### Task 4: `tick.test.ts` — comprehensive rewrite (the largest task)

**Files:** Modify `src/lib/game/tick.test.ts` (read the WHOLE file fresh before editing — it's long,
and this task's guidance below is a fully-verified reference, not a starting point to re-derive from
scratch, but every value MUST still be independently re-confirmed against the live `model.ts`/`tick.ts`
before committing, not transcribed blindly).

**Critical context:** `ALWAYS_MIN_ROLL` (`() => 0`) changes meaning completely under the new mechanic.
Today it means "every roll delivers uncommon=1 AND rare=1" (both occur, carved from a 10-unit pool).
Under the new mechanic, `rng()` returning `0` means rare wins on the very first check, EVERY SINGLE
TIME, for the rest of the mission — since `0 < effectiveRareChance` is true for any mission with a
positive `rareChance`. This affects every test using this constant across the WHOLE file, not just the
"extraction loot rolls" describe block.

**Below is the complete, independently-verified list of every test that needs a change, organized by
what kind of change it needs. Re-derive each value yourself from the live code before committing — this
list has been checked but is not a substitute for your own verification.**

#### Group A — needs NO changes (confirm this yourself, don't just skip on faith)
Tests that either don't touch extraction at all (idle-captain/no-mission/ordersReceived-only tests),
have `mission.cargo`/`homePlanetDelta` pre-set directly as literals rather than rolled (the two
"completing a full cycle"/"delivers cargo to homePlanet.storage" tests, and the "recall takes effect"
test, none of which assert cargo amounts that were actually rolled), or assert XP/level/statPoints only
(XP awarding is independent of which loot tier occurred). Read each candidate yourself and confirm it
truly doesn't depend on the mechanic or the rate rescale before leaving it untouched.

#### Group B — the "extraction loot rolls" describe block: full rewrite

1. `"rolls loot once per whole tick crossed during extracting..."` (`NOTHING_OCCURS`, 3.5 ticks,
   shortOreRun): under the new mechanic, `NOTHING_OCCURS` (`0.5`) still fails both rare (`0.5 < 0.001`?
   no) and uncommon (`0.5 < 0.019`? no) checks, same as today — common wins each of the 3 rolls, but the
   amount per roll is now `1` (the rescaled `extractionRatePerTick`), not `10`. New expected:
   `commonOre.equals(3)` (was `30`).

2. `"a large jump resolves every extraction tick's loot roll..."` (`NOTHING_OCCURS`, 90 ticks,
   shortOreRun): 90 rolls (unchanged tick count, `cargoCapacity 90 / rate 1 = 90`), all common at the
   new rate. New expected: `commonOre.equals(90)` (was `900` — note this is NOT the same number as the
   tick count by coincidence of the OLD numbers; recompute it yourself: 90 rolls × 1 unit/roll = 90).
   `phase` stays `"transitBack"` (unaffected).

3. `"neither tier occurs: pure commonOre at the unmodified extractionRatePerTick"` (`NOTHING_OCCURS`, 1
   tick): rare check first (`0.5 < 0.001`? no), uncommon check (`0.5 < 0.019`? no), common wins, amount
   `1` (was `10`). Update the comment to describe the NEW check order (rare first, then uncommon) — the
   current comment describes the OLD order (uncommon first, then rare).

4. `"both tiers occur in the same tick, at their minimum amounts"` — **this test's entire premise is
   now impossible** (mutual exclusivity means only one tier can ever win per roll). DELETE this test,
   don't adapt it. Replace it with a new test proving `ALWAYS_MIN_ROLL`'s new behavior: `rng`
   constant `0` on shortOreRun → rare check `0 < 0.001`? yes → rare wins on the FIRST call (only 1
   `rng()` call made). Expected: `rareMaterial.equals(1)`, `commonOre.equals(0)`,
   `uncommonMaterial.equals(0)`. Title it something like `"ALWAYS_MIN_ROLL (rng=0) always lands on rare
   first, since 0 passes any positive rare-chance check"`.

5. `"uncommon amount can land on bucket 2 or 3 of the 75/20/5 distribution"` — **this test's entire
   premise no longer exists** (there is no more amount-bucket roll for uncommon; it always gets the full
   `extractionRatePerTick`). DELETE this test entirely, do not adapt it. Do not replace it with anything
   — there's no equivalent concept in the new mechanic (uncommon's amount is now always deterministic
   given it wins, nothing left to test a "which bucket" distribution for).

6. `"omitting the bonuses arg behaves exactly as before (defaults to no bonus)"` (`NOTHING_OCCURS`, 1
   tick, no 4th arg): common wins (same reasoning as #3), amount `1` (was `10`).

7. `"commonYieldMult scales only the leftover commonOre amount, not occurrence"` (`NOTHING_OCCURS`, 1
   tick, `commonYieldMult: 0.25`): common wins, amount `1 * (1+0.25) = 1.25` (was `12.5`). Update the
   test's title/comment: there's no more "leftover" — common gets the FULL amount when it wins, scaled
   by `commonYieldMult`. Consider renaming to `"commonYieldMult scales the common tier's full amount
   when it wins, not whether it wins"`.

8. `"uncommonYieldMult scales only uncommon's rolled amount, when uncommon actually occurred"` (`rng`
   constant `0.01`, `uncommonYieldMult: 0.5`): rare check first — `0.01 < 0.001`? no (0.01 > 0.001,
   rare's chance is smaller than the roll value). uncommon check — `0.01 < 0.019`? yes → uncommon wins.
   Amount `1 * (1+0.5) = 1.5`. Since uncommon won, `commonOre` and `rareMaterial` are BOTH now `0`
   (mutual exclusivity) — this is a real behavior change from today's test, which had `commonOre.equals(8.5)`
   (the old "leftover after carve-out"). New expected: `uncommonMaterial.equals(1.5)`,
   `commonOre.equals(0)` (was `8.5`), `rareMaterial.equals(0)` (unchanged, was already `0`).

9. `"rareYieldMult scales only rare's rolled amount, when rare actually occurred"` (`rng` constant
   `0.0005`, `rareYieldMult: 0.4`): rare check FIRST — `0.0005 < 0.001`? yes → rare wins immediately
   (only 1 `rng()` call made this roll, since rare is checked first and already won — uncommon is never
   even rolled). Amount `1 * (1+0.4) = 1.4`. Since rare won, `uncommonMaterial` and `commonOre` are BOTH
   `0` — this test's OLD premise ("uncommonMaterial staying at the unscaled baseline of 1... proves
   rareYieldMult only scales rare's own tier") no longer makes sense, since uncommon and rare can't
   co-occur anymore. Rewrite the test's whole framing: the NEW proof that rareYieldMult only affects
   rare is that `uncommonMaterial`/`commonOre` are exactly `0` when rare wins (nothing else to scale).
   New expected: `rareMaterial.equals(1.4)`, `uncommonMaterial.equals(0)` (was `1`), `commonOre.equals(0)`
   (was `7.6`).

10. `"uncommonChanceMult shifts a borderline rng value across the uncommon occurrence threshold"`
    (longOreRun, `rng` constant `0.1`): **unboosted** — rare check first (`0.1 < 0.02`? no), uncommon
    check (`0.1 < 0.08`? no) → common wins, amount `1` (was `10`). **boosted**
    (`uncommonChanceMult: 1`, `effectiveUncommonChance = 0.08*(1+1) = 0.16`) — rare check
    (`0.1 < 0.02`? no, unaffected by `uncommonChanceMult`), uncommon check (`0.1 < 0.16`? yes) → uncommon
    wins, amount `1 * (1+0) = 1` (`uncommonYieldMult` defaults to `0` on this call — same number as
    before by coincidence, but now because it's the FULL base amount, not a 1-3-bucket roll). Since
    uncommon won, `commonOre` is now `0` (was `9`, the old leftover). New expected — unboosted:
    `commonOre.equals(1)` (was `10`), `uncommonMaterial.equals(0)`. boosted: `uncommonMaterial.equals(1)`
    (same number, new reasoning), `commonOre.equals(0)` (was `9`).

11. `"rareChanceMult shifts a borderline rng value across the rare occurrence threshold"` (longOreRun,
    `rng` constant `0.09`): **unboosted** — rare check FIRST (`0.09 < 0.02`? no), uncommon check
    (`0.09 < 0.08`? no, since `0.09 > 0.08`) → common wins, amount `1` (was `10`). **boosted**
    (`rareChanceMult: 4`, `effectiveRareChance = 0.02*(1+4) = 0.1`) — rare check FIRST:
    `0.09 < 0.1`? YES → rare wins on the very FIRST call (uncommon is never even checked, since rare is
    checked first in the new order and already won — this differs from the OLD test's premise, which
    checked uncommon first, found it failed, THEN checked rare). Amount `1 * (1+0) = 1`. Since rare won,
    `commonOre` is now `0` (was `9`). New expected — unboosted: `commonOre.equals(1)` (was `10`),
    `rareMaterial.equals(0)`. boosted: `rareMaterial.equals(1)` (same number, new reasoning, and now only
    1 `rng()` call instead of 2), `commonOre.equals(0)` (was `9`), `uncommonMaterial.equals(0)`
    (unchanged).

Every comment in this describe block referencing the OLD "call 1 (uncommon occurrence)... call 2 (rare
occurrence)" order needs rewriting to the NEW "call 1 (rare occurrence)... call 2 (uncommon
occurrence)" order, not just the numeric values.

#### Group C — needs a value/comment update only (mechanic-order-sensitive but not conceptually broken)

12. `"a big jump can complete multiple full auto-repeat cycles..."` (line ~440, `ALWAYS_MIN_ROLL`,
    `ticksElapsed=298`, fresh mission, 2 full cycles): under the new mechanic, `rng=0` constant means
    rare wins EVERY single roll (90 rolls/cycle), not the old "uncommon=1 AND rare=1 every roll." New
    per-cycle total: `90 rolls × 1 unit rare each = 90 rare, 0 common, 0 uncommon` per cycle. 2 cycles =
    `180 rare, 0 common, 0 uncommon`. Rewrite the comment completely (the old one explains an "8 common,
    1 uncommon, 1 rare per roll" split that no longer exists) and update the 3 assertions:
    `homePlanetDelta.rareMaterial.equals(180)` (was `commonOre.equals(1440)`... this whole test's
    numeric shape changes entirely — re-derive it fresh, don't try to patch the old numbers).
    `phase`/`phaseProgressTicks` assertions (still `"ordersReceived"`/`0`) are unaffected.

13. `"mission loot aggregates across all captains on missions into state.homePlanet.storage in one
    tick() call"` (uses real, unmocked `Math.random`, asserts TIER-AGNOSTIC totals): this test's
    strategy (assert the TOTAL delivered equals `extractionRatePerTick`, regardless of which tier won)
    still works under the new mechanic — whichever tier wins, it gets exactly `baseAmount` when all
    yield-mults are `0` (true here, no talents unlocked). Only the NUMBERS need rescaling: captain 0's
    total goes from `10` to `1` (1 roll at the new rate). Captain 1's pre-seed needs updating too: it's
    meant to represent "89 prior whole-tick rolls, 1 tick away from completing the 90-tick extracting
    phase" — `phaseProgressTicks: 89` stays the same (the 90-tick requirement is unchanged), but
    `cargo.commonOre` pre-seed should become `new Decimal(89)` (89 rolls × 1 unit each), not `890`. Final
    assertion: `cap1CargoTotal.equals(90)` (was `900`) — `89` pre-seeded + `1` more roll of the new rate.
    Rewrite the whole hand-trace comment block to show the new `requiredTicks = Math.ceil(90/1) = 90`
    and the new pre-seed/total numbers.

14. `"commandExtractionI (Captain Talent, commonYieldMult) boosts a mission captain's extraction via
    tick()"` (`Math.random` mocked to `0.5`): under the new mechanic, `0.5` still fails both rare
    (`0.5<0.001`) and uncommon (`0.5<0.019`) checks for shortOreRun — same mocking strategy works
    unchanged. Common wins, amount `1 * (1+0.1) = 1.1` (was `11`). Update the assertion
    (`toBeCloseTo(1.1, 6)`) and the comment's arithmetic.

15. `"commandExtractionI (Captain Talent) and a Homeworld Talent's rareYieldMult both wire through
    tick() without interfering with each other"` (`Math.random` mocked to `0.5`): same reasoning as #14
    — `0.5` still forces common to win (rare's own `rareYieldMult` from `fleetLogisticsYield` is
    irrelevant here since rare didn't occur). Amount `1 * (1+0.1) = 1.1` (was `11`). This test's ORIGINAL
    mocking strategy is still valid, unlike #16 below — just update the number.

16. **`"fleetLogisticsYield (Homeworld Talent, rareYieldMult) is wired through tick() without breaking
    the per-tick total invariant"` — this test needs a genuine strategy redesign, not a value patch.**
    Read the design doc's note on this: under the OLD mechanic, the "total always equals
    `extractionRatePerTick`, regardless of RNG" invariant held for ANY yield-mult except
    `commonYieldMult`, because uncommon/rare's amounts were capped small (1-3/1 units) against a much
    larger shared pool, so their yield-mults barely moved the total. **Under the NEW mechanic, this is
    no longer true**: if rare wins the (unmocked, real-RNG) roll in this test, the total becomes
    `extractionRatePerTick * (1 + rareYieldMult)`, not `extractionRatePerTick` exactly — `rareYieldMult`
    now DOES change the deterministic total whenever rare happens to win, because rare gets the FULL
    per-tick amount, not a capped fraction of it. The old test's premise (assert an invariant that
    survives unmocked randomness) doesn't cleanly apply anymore. **Recommended replacement strategy**:
    mock `Math.random` to a fixed value that forces RARE to win (e.g. a value comfortably below
    `longOreRun`'s or `shortOreRun`'s `rareChance`, whichever mission this test uses — read the test to
    confirm which), then assert the resulting `rareMaterial` amount is EXACTLY
    `extractionRatePerTick * (1 + rareYieldMult)` and that `commonOre`/`uncommonMaterial` are both `0`.
    This is a MORE precise test than the old invariant-based one, not a downgrade — the new mechanic
    makes every tier's outcome fully deterministic once you know which tier won, so there's no need to
    rely on an RNG-survives-anything invariant anymore. Confirm `fleetLogisticsYield`'s actual
    `rareYieldMult` value (read `HOMEWORLD_TALENTS` in `model.ts`) before computing the exact expected
    number.

17. `"with no unlocked Homeworld Talents, extraction and passive production are unaffected (regression
    guard)"` (unmocked `Math.random`, asserts `totalDelivered.equals(10)` exactly — not `toBeCloseTo`):
    with ALL yield-mults at `0` (no talents unlocked), whichever tier wins still delivers EXACTLY
    `extractionRatePerTick` (scaled by `1+0=1`), so this specific invariant DOES still hold exactly
    under the new mechanic (unlike #16, which involves a nonzero `rareYieldMult`). Only the number
    changes: `totalDelivered.equals(1)` (was `10`). `homePlanet.storage.commonOre.equals(0)` (passive
    trickle check) is unaffected.

#### Group D — confirm unaffected (no code touches extraction rolls, but re-verify yourself)

The `captainCommonYieldMult`/`captainUncommonYieldMult`/`captainUncommonChanceMult`/
`captainRareChanceMult`/`fleetRareYieldMult` describe block (pure talent-list-reading helpers, no
connection to `rollExtractionTick`'s internals), the two `passiveTrickle` tests (separate code path,
unrelated to mission extraction), and the `dispatchCaptainOnMission`/`recallCaptain`/`craftRecipe`/
`buyCaptainTalent`/`buyHomeworldTalent`/`applyFleetAdminXp` describe blocks (none touch extraction) all
need zero changes — confirm this yourself by reading each, don't just take it on faith.

**Step (final): No test runner available** — verify entirely via hand-trace/reading, per this
environment's established constraint. Every changed assertion must be justified by shown arithmetic in
the commit, not just "this looks like the right pattern."

**Commit.**

```bash
git add src/lib/game/tick.test.ts
git commit -m "test: rewrite tick.test.ts for the sequential mutually-exclusive extraction mechanic"
```

---

### Task 5: Docs + session log

**Files:** Modify `SESSION_LOG.md`. Modify `KNOWN_ISSUES.md`/`SUGGESTIONS.md` only if something
genuinely new warrants it (the design doc's own "explicitly out of scope" section already logged the
deferred talent work, ship-stat cargo capacity, and farming-efficiency mission type — don't re-log
what's already logged).

**Step 1:** Read the 2-3 most recent `SESSION_LOG.md` entries (Session 20, Session 21) to match the
established "**Session N** — Title" format exactly. This would be Session 22.

**Step 2:** Append a new entry summarizing: the regression (extraction rate left unscaled after the
Tick Granularity Rebalance, ~10x-ing real-time common-ore income — caught by the user during live
testing), the new sequential mutually-exclusive roll mechanic (rare → uncommon → common, full per-tick
amount, no more 1-3/1 caps), the `extractionRatePerTick`/`cargoCapacity` rescale (10→1, 900→90, keeping
the 90-tick extraction phase unchanged), and the deliberate sequencing decision (talent changes — the
Resourcefulness bonus-roll talent — explicitly deferred to a follow-up per the user's own request, not
bundled into this branch).

**Step 3: Commit.**

```bash
git add SESSION_LOG.md
git commit -m "docs: session log for Extraction Rework"
```

Do NOT push — origin/main triggers a live Vercel production redeploy; wait for explicit confirmation
before any push, per this project's established practice.

---

## After all tasks: final holistic review

Once all 5 tasks (plus Task 0's worktree setup) are committed and individually reviewed, dispatch one
final holistic review of the WHOLE branch before presenting merge options — same pattern as every prior
feature this session. Specifically re-verify:

1. Grep the ENTIRE `src/` directory for any remaining reference to the OLD `extractionRatePerTick: 10`/
   `cargoCapacity: 900` values, or any remaining description of the OLD independent-and-subtractive
   mechanic (in comments, not just code).
2. Confirm `rollExtractionTick` never makes more than 2 `rng()` calls in any code path, and that its
   3 possible return shapes (`{0,0,rare}`, `{0,uncommon,0}`, `{common,0,0}`) are truly mutually exclusive
   — no code path can return more than one nonzero field.
3. Confirm every test using `ALWAYS_MIN_ROLL` was re-examined for the new "rare always wins" meaning —
   grep for `ALWAYS_MIN_ROLL` one more time and manually classify every hit.
4. Confirm `model.test.ts`'s `requiredTicksForPhase("extracting", ...)` assertion still correctly
   returns `90` for both missions after the rescale.
5. Re-read the design doc's "Explicitly out of scope" section one more time and confirm nothing from it
   was accidentally built as part of this branch (no new `CaptainTalentEffect` union member, no
   `bonusRollChance` field, no third mission type, no ship-stat cargo capacity).
