# Progression Pacing Rework — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert mission XP from lump-per-cycle to continuous per-tick accrual (captains + Fleet Admiral),
recalibrate the curves, add captain-slot Fleet-Admiral-level walls, relabel "Coming Soon"→"Locked", and
reserve the `lifetimeStats` schema — all without regressing the closed-form mission math.

**Architecture:** The per-tick XP + lifetime-stat logic lives INSIDE `tickCaptainMission` (already shared
by both offline `tick()` and `App.svelte`'s live loop), returned as deltas both loops already accumulate.
XP rate = `BASE_XP_PER_TICK[source] × talent/buff mults` (mirrors existing effect-aggregation helpers).
No full tick-path unification (deferred). See the [design doc](2026-07-11-progression-pacing-rework-design.md).

**Tech Stack:** TypeScript, Svelte, `break_infinity.js` (`Decimal`), Vitest.

**⚠️ ENVIRONMENT:** No Node/npm/tsc on this machine. "Run the test" steps mean: author the Vitest test,
hand-trace it to confirm it would fail/pass, and rely on CI/Vercel-preview for real execution. Never claim
a test ran locally. Device-check checkpoints call for a Vercel preview branch + the user's manual test.

**⚠️ ANTI-REGRESSION:** `tickCaptainMission` is delicate, closed-form working code. Every task that touches
it must keep the "one big jump == many small ticks" guarantee (see `tick.test.ts`'s closed-form tests) and
must NOT change credits (still per-cycle) or the loot/extraction math.

---

## Task 1: Reserve the `lifetimeStats` schema

**Files:**
- Modify: `src/lib/game/model.ts` (the `GameState` interface + `freshState`)
- Test: `src/lib/game/model.test.ts`

**Step 1 — Write the failing test:** assert `freshState().lifetimeStats` exists with zeroed counters
(`itemsGathered`/`itemsRefined`/`itemsCrafted` = `{}`, `missionsCompleted` = `{}`, `creditsEarned`/
`captainXpAwarded`/`fleetAdminXpAwarded` = `new Decimal(0)`).

**Step 2 — Verify it fails** (hand-trace: `lifetimeStats` undefined → test throws).

**Step 3 — Implement:** add to `GameState`:
```ts
lifetimeStats: {
  itemsGathered: Record<string, Decimal>;
  itemsRefined: Record<string, Decimal>;
  itemsCrafted: Record<string, Decimal>;
  missionsCompleted: Record<string, Decimal>;
  creditsEarned: Decimal;
  captainXpAwarded: Decimal;
  fleetAdminXpAwarded: Decimal;
};
```
and initialise it in `freshState()` (empty maps + `new Decimal(0)` scalars).

**Step 4 — Verify it passes** (hand-trace).

**Step 5 — Commit:** `feat(progression): reserve lifetimeStats schema on GameState`

---

## Task 2: Save migration v16 → v17

**Files:**
- Modify: `src/lib/game/save.ts` (`SAVE_VERSION`, add `MIGRATIONS[16]`)
- Test: `src/lib/game/save.test.ts`

**Step 1 — Failing test:** a v16 save (no `lifetimeStats`) run through `migrate()` yields v17 with a
fully-initialised `lifetimeStats` (zeroed), and existing fields untouched. Add a round-trip test mirroring
the existing v15→v16 test's shape.

**Step 2 — Verify fails.**

**Step 3 — Implement:** `MIGRATIONS[16] = (state) => ({ ...state, lifetimeStats: <zeroed init> })`; bump
`SAVE_VERSION = 17`. Follow the file's existing migration conventions (see the header comment + prior
entries; `type Migration = (state:any)=>any` allows free field addition).

**Step 4 — Verify passes.**

**Step 5 — Commit:** `feat(save): migrate v16->v17 (reserve lifetimeStats)`

---

## Task 3: XP-rate pipeline (`BASE_XP_PER_TICK` + `xpPerTick` helper)

**Files:**
- Modify: `src/lib/game/model.ts` (add `BASE_XP_PER_TICK` per mission; default 1)
- Modify: `src/lib/game/tick.ts` (add `xpPerTick(...)` aggregation helper + a `fleetAdminXpPerTick` seam)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing test:** `xpPerTick("shortOreRun", captainWithNoTalents)` returns the base (1). Assert
the multiplier seam exists (a captain/FA XP mult that reduces over unlocked talents — currently no XP
talents, so it returns 1). Mirror the existing `captainCommonYieldMult` test style.

**Step 2 — Verify fails.**

**Step 3 — Implement:** `BASE_XP_PER_TICK: Record<MissionKey, number>` (both = 1). `xpPerTick(missionKey,
captain, state?)` = base × `talentXpMult(...)` × `buffXpMult(...)`, where the mult helpers `reduce` over
unlocked talents/buffs (return 1 today — reserve the seam, NO placeholder talents). Keep the same
plain-number vs Decimal discipline the neighbouring helpers use.

**Step 4 — Verify passes.**

**Step 5 — Commit:** `feat(progression): add tunable per-tick XP rate pipeline (seam)`

---

## Task 4: Captain XP → per-tick accrual + curve to 300×level

**Files:**
- Modify: `src/lib/game/model.ts` (`xpForNextLevel`: `100*level` → `300*level`)
- Modify: `src/lib/game/tick.ts` (`tickCaptainMission`: replace the `xp += XP_PER_MISSION_CYCLE` lump at
  the cycle-completion site with per-tick accrual across the ticks advanced this call)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing tests:**
(a) **Accrual:** a captain advanced N ticks on `shortOreRun` gains `N × xpPerTick` captain XP (minus what
level-ups consumed) — not a lump only on cycle completion.
(b) **Closed-form parity (CRITICAL):** `tickCaptainMission(320, base, ALWAYS_MIN_ROLL)` equals stepping
1 tick × 320 — for `xp`/`level`/`statPoints` too, not just loot (extend the existing closed-form test).
(c) **Curve:** `xpForNextLevel(3) === 900`.

**Step 2 — Verify fails.**

**Step 3 — Implement:** in `tickCaptainMission`, add `xpPerTick × (ticks advanced this call)` to `xp` each
call (the mission is in-progress every advanced tick), then run the existing subtract-threshold level-up
loop (capped by `MAX_LEVEL_UPS_PER_TICK`, carry-forward preserved). Remove the per-cycle
`xp += XP_PER_MISSION_CYCLE` lump. Change `xpForNextLevel` to `300 * level`. Keep credits per-cycle
untouched. **Do not alter the phase-advancement / loot / closed-form structure.**

**Step 4 — Verify passes** (especially the parity test).

**Step 5 — Commit:** `feat(progression): captain XP accrues per active tick; curve 300xlevel`

---

## Task 5: Fleet Admiral XP → per-tick, stacking across active missions

**Files:**
- Modify: `src/lib/game/tick.ts` (`tickCaptainMission` returns per-tick `fleetAdminXpDelta`; drop the
  per-cycle `fleetAdminXpPerCycle` add)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing tests:** (a) one captain advanced N ticks yields `fleetAdminXpDelta === N × fleetAdminXpPerTick`
(base 1). (b) `tick()` with 2 active captains over N ticks accumulates `2 × N` FA XP (stacking). (c)
closed-form parity for the FA delta.

**Step 2 — Verify fails.**

**Step 3 — Implement:** replace the `fleetAdminXpDelta += missionDef.fleetAdminXpPerCycle` (per-cycle) with
`fleetAdminXpDelta += fleetAdminXpPerTick × (ticks advanced)`. `tick()` already sums each captain's delta
and hands it to `applyFleetAdminXp` — unchanged. Keep `fleetAdminXpPerCycle` field OR repurpose to a
per-tick base (decide in-task; prefer a clearly-named `fleetAdminXpPerTick` base, default 1). Note: only
missions are XP sources in THIS feature — facility processes are added as sources in Phase 1 (the delta
contract is ready for them).

**Step 4 — Verify passes.**

**Step 5 — Commit:** `feat(progression): Fleet Admiral XP accrues per active tick, stacking`

---

## Task 6: Lifetime-stat deltas from `tickCaptainMission`

**Files:**
- Modify: `src/lib/game/tick.ts` (extend `tickCaptainMission` return with `lifetimeStatsDelta`; accumulate
  in `tick()`)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing tests:** over a full short cycle, `tick()` increments `lifetimeStats.missionsCompleted.shortOreRun`
by 1, `itemsGathered.commonOre` by the loot gathered, `creditsEarned` by `creditsPerCycle`, `captainXpAwarded`
+ `fleetAdminXpAwarded` by the XP granted. Closed-form parity for the deltas.

**Step 2 — Verify fails.**

**Step 3 — Implement:** add `lifetimeStatsDelta` to the return (Decimal maps/scalars, same shape as
`homePlanetDelta`); populate it alongside the existing loot/credits/XP computation. `tick()` folds it into
`state.lifetimeStats`. (No `itemsRefined`/`itemsCrafted` yet — those come from Phase 1's engine.)

**Step 4 — Verify passes.**

**Step 5 — Commit:** `feat(progression): accumulate mission-side lifetime stats`

---

## Task 7: Live-loop parity (App.svelte)

**Files:**
- Modify: `src/App.svelte` (the `setInterval` live loop, ~line 455–693)
- Test: `src/lib/game/tick.test.ts` (a parity test at the game-logic layer)

**⚠️ Read `App.svelte:455–693` fully first.** The loop already calls `tickCaptainMission` (line 616) and
accumulates `fleetAdminXpDelta` → `applyFleetAdminXp` (line 693). This task ensures the NEW return field
(`lifetimeStatsDelta`) and any NEW input (XP mults, if `xpPerTick` needs `state`) are threaded here too —
the exact spot past drift happened (dropped ship stats/credits).

**Step 1 — Failing test:** a parity test asserting that folding N ticks through `tick()` vs. through the
live-loop's accumulation pattern yields identical `lifetimeStats`, captain `xp/level`, and `fleetAdminXp`.
(Extract the loop's accumulation into a testable pure helper if needed — minimal, don't rewrite the loop.)

**Step 2 — Verify fails.**

**Step 3 — Implement:** thread `lifetimeStatsDelta` accumulation + any new `xpPerTick` input in the live
loop, mirroring the existing `fleetAdminXpDelta`/`creditsDelta` handling. Update `state.lifetimeStats` once
per poll like the other deltas.

**Step 4 — Verify passes.**

**Step 5 — Commit:** `feat(progression): thread lifetime stats + XP through the live loop`

**→ DEVICE CHECKPOINT A:** Vercel preview branch; user verifies live play — captain leveling pace feels
like today, FA levels faster (and faster with more captains active), offline catch-up matches live.

---

## Task 8: Fleet Admiral curve recalibration (starting values)

**Files:**
- Modify: `src/lib/game/model.ts` (`xpForNextFleetAdminLevel`)
- Test: `src/lib/game/model.test.ts`

**Step 1 — Failing test:** the curve is monotonic increasing, gives a "fast early" first few levels and a
much steeper high end (assert a couple of threshold sanity points at the chosen scale). Values are a
STARTING point — this is the most playtest-sensitive number (see design §4).

**Step 2 — Verify fails.**

**Step 3 — Implement:** rescale the curve up (per-tick FA income is ~100–150×/mission × stacking) with a
fast-early-slow-late shape. Land a defensible starting formula; leave a comment that it's device-tuned.

**Step 4 — Verify passes.**

**Step 5 — Commit:** `balance(progression): rescale Fleet Admiral XP curve (starting values)`

**→ DEVICE CHECKPOINT B:** user tunes FA pace on device; iterate the constant only.

---

## Task 9: Captain-slot Fleet-Admiral-level walls (data + gate)

**Files:**
- Modify: `src/lib/game/model.ts` (add `requiresFleetAdminLevel?: number` to `HomeworldTalentDef`; set on
  `fleetLogisticsSlot1`=1, `fleetLogisticsSlot2`=5, `fleetLogisticsSlot3`=25)
- Modify: `src/lib/game/tick.ts` (`buyHomeworldTalent`, ~line 1066 `unlockCaptainSlot` path — block if
  `state.fleetAdminLevel < requiresFleetAdminLevel`)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing tests:** buying `fleetLogisticsSlot2` at FA level 4 fails (returns same-state, unchanged);
at level 5 succeeds. Existing adminPoint-cost + graph-adjacency gates still apply (layered, not replaced).

**Step 2 — Verify fails.**

**Step 3 — Implement:** add the field + set L1/L5/L25 on the three slot nodes; add the level check in
`buyHomeworldTalent` alongside the existing cost/adjacency checks. **Only these three exist** — the L125
slot-5 wall is added when a `fleetLogisticsSlot4` talent is created (out of scope; "no placeholders").

**Step 4 — Verify passes.**

**Step 5 — Commit:** `feat(progression): layer FA-level walls on captain-slot unlocks (L1/L5/L25)`

---

## Task 10: Slot-wall UI (show requirement + red "missing")

**Files:**
- Modify: the talent-node UI (`src/lib/RadialWeb.svelte` and/or its tooltip) — **read it first** to match
  the existing readiness/affordability rendering.

**Step 1:** identify how a node currently shows "can't afford" (adminPoints). **Step 2:** add the
FA-level requirement to that display — met = normal, unmet = red "Requires Fleet Admiral Level N". **Step 3:**
hand-verify the render logic reads `requiresFleetAdminLevel` and `state.fleetAdminLevel`.

**Step 4 — Commit:** `feat(progression): show FA-level requirement on slot-unlock nodes`

---

## Task 11: "Coming Soon" → "Locked" relabel

**Files:**
- Modify: `src/lib/SubTabs.svelte` (the `locked` "🔒 Coming Soon!" pattern) — **read it first.**

**Step 1:** distinguish the two states — content that EXISTS but is gated → **"Locked"** (+ its
requirement); content that does not exist yet → keep **"Coming Soon"**. This likely means a per-item label
or a second flag distinguishing "locked" from "coming soon". **Step 2:** apply "Locked" to the level-walled
captain slots. **Step 3:** hand-verify both states render correctly.

**Step 4 — Commit:** `feat(ui): distinguish Locked (exists, gated) from Coming Soon (not built)`

---

## Task 12: Version bump + docs

**Files:** `model.ts`/wherever `APP_VERSION`+`PATCH_NOTES` live; `KNOWN_ISSUES.md`; `SESSION_LOG.md`.

- Bump `APP_VERSION` (minor) + a `PATCH_NOTES` entry summarising the pacing rework.
- Log any deferred tunables (FA curve final values) in `KNOWN_ISSUES.md`; append a `SESSION_LOG.md` entry.
- **Commit:** `chore(progression): version bump + patch notes + docs`

**→ DEVICE CHECKPOINT C (final):** full playthrough — captain pace parity, FA pace, slot walls gate,
"Locked" vs "Coming Soon" correct, offline == live, save migrates v16→v17 cleanly.

---

## Notes for the executor
- **Order matters:** Tasks 1–2 (schema) before 6–7 (stat deltas). Task 4/5 (the delicate closed-form
  edits) each need their parity test GREEN before moving on.
- **Never** claim a test ran locally — this machine has no Node. Author + hand-trace; CI/preview executes.
- **Anti-Regression:** if any closed-form parity test would break, STOP and re-read `tickCaptainMission`
  before proceeding. Do not "fix" the loot/extraction/credits math.
- Reference @superpowers:executing-plans for the task-by-task loop and @superpowers:test-driven-development
  for the red-green discipline.
