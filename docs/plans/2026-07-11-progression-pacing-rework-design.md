# Progression Pacing Rework (Design)

**Date:** 2026-07-11
**Type:** Feature design doc. Next step after approval: `writing-plans` → implementation plan.
**Status:** Draft for review.
**Relation:** PREREQUISITE to the [Ship Production Economy epic](2026-07-10-ship-production-economy-epic.md)
— must land BEFORE Phase 1 (it defines the Fleet Admiral XP curve Phase 1's facility processes award
into, and it's the first feature to ship the `lifetimeStats` schema).

---

## 1. What ships

1. **Per-tick XP** — replace lump-per-cycle XP with continuous per-tick accrual, for captains AND the
   Fleet Admiral, from missions AND (forward) facility processes.
2. **Tunable XP-rate pipeline** — base rate per source × talent/buff multipliers, so EXP/minute is easy
   to tune per action/mission/talent.
3. **Curve recalibration** — captains "feel the same"; Fleet Admiral ramps faster early, slower later.
4. **Captain-slot level walls** — an FA-level requirement LAYERED on the existing talent unlock.
5. **"Coming Soon" → "Locked"** relabel for existing-but-locked content.
6. **Reserve `lifetimeStats`** (save v16→v17) + wire the mission-side counters here (first & only
   necessary touch of the closed-form mission code).

⚠️ **This edits WORKING, closed-form mission XP code.** Anti-Regression + closed-form discipline
throughout; its own device check before merge.

---

## 2. The per-tick XP model

Today (grounding): XP is a **lump at each mission-cycle completion**, inside `tickCaptainMission` —
`xp += XP_PER_MISSION_CYCLE` (=50) for the captain; `fleetAdminXp += fleetAdminXpPerCycle` (Short 1 /
Long 2) for the FA — each followed by a subtract-threshold level-up loop capped at
`MAX_LEVEL_UPS_PER_TICK` with carry-forward.

New model — **every active tick awards XP** (accrual, not lump):
- **Captain:** the piloting captain earns `xpPerTick` every tick their mission is in progress (all
  phases — transit/extract/unload). A mission's total captain XP = its duration in ticks × rate.
  Captain XP is from **MISSIONS ONLY** (confirmed 2026-07-11) — facility processes grant NO captain XP
  (no captain pilots them). Captains' leveling PACE stays identical to today (§4).
- **Fleet Admiral:** earns `xpPerTick` **per active action, stacking** — every running mission AND
  every running refine/upgrade/fabrication process each contributes. 7 things running = 7 FA XP/tick
  (before buffs).
- **Facility processes** award **FA XP only** (no captain pilots a refinery).
- **Credits are unchanged** — still `creditsPerCycle` lump at cycle completion. Only XP moved per-tick.
- The old `XP_PER_MISSION_CYCLE` lump and the per-cycle FA award are removed (replaced by accrual).

**Closed-form / offline-safe:** durations are deterministic, so XP over elapsed E = active-ticks × rate,
computed without simulation — mirrors the mission tick's existing closed-form guarantee. Level-up loops
keep the subtract-threshold + `MAX_LEVEL_UPS_PER_TICK` carry-forward pattern (unchanged).

---

## 3. Tunable XP-rate pipeline

`xpPerTick` is NOT a hard constant — it's a base rate per source through a multiplier pipeline, so
total EXP/minute is trivially tunable:

```
xpPerTick(source, captain?, state) = BASE_XP_PER_TICK[source]        // default 1; per mission/action, tunable
                                   × talentXpMult(...)               // captain and/or FA talent effects
                                   × buffXpMult(...)                 // future global buffs
```

- Mirrors the existing effect-aggregation helpers (`captainCommonYieldMult`, `bonusRollChanceMult`,
  `fleetRareYieldMult`, …) — reduce over unlocked talents/buffs. New talents that boost XP plug in
  without touching the award site (the `fleetAdminXpPerCycle` comment already anticipated this).
- `BASE_XP_PER_TICK` is a small data table (launch-placeholder convention, like `MISSIONS`/`RECIPES`):
  per mission and per facility-process type, so a harder mission/process can be worth more per tick.

---

## 4. Curve recalibration (starting values — PLAYTEST-driven; "hard to tell too fast/slow")

**Captain** — today `xpForNextLevel(level) = 100 × level`; effective rate today ≈ 0.34 XP/tick (short,
50 over 148 ticks) / 0.21 (long, 50 over 238). New rate = 1.0 XP/tick (normalized across missions).
- **Consequence:** per-tick *normalizes* XP/tick to 1.0 — the "spam short runs to out-level" quirk goes
  away (longer mission → proportionally more XP). This is a deliberate behavioral shift.
- **Captain curve — LOCKED to short-run parity** (user 2026-07-11: "keep the curve feeling the same,"
  balance around the short run). Short cycle = **149 ticks** (`1 orders + 25 + 90 + 25 + 8`, per
  `tick.test.ts:64`) → new XP/cycle = 149 (at 1/tick) vs old 50. Scale by 149/50 = 2.98 →
  **`xpForNextLevel(level) = 300 × level`** (clean; exact parity is 298, ~0.7% off — negligible). Was
  100 × level. Short-run leveling then ~identical to today (today 2L short-cycles per level; new
  300L ÷ 149 ≈ 2L). Future missions tuned per-mission via `BASE_XP_PER_TICK` (§3), not the curve.

**Fleet Admiral** — today `xpForNextFleetAdminLevel` (≈ ×2500, quadratic-ish); today FA earns 1–2/cycle.
New: 148–238 per cycle per mission (≈ **100–150× more**), × stacking across concurrent actions.
- The FA curve needs a **large upward rescale** AND a **fast-early-slow-later shape** (FA power is high;
  levels should slow as they climb). Starting form: a steeper polynomial (or piecewise) tuned so early
  FA levels come quickly and high levels stretch out.
- ⚠️ **The single most playtest-sensitive number in this rework** — with stacking, FA pace depends on
  how busy the fleet is. Do NOT hard-lock; ship a starting curve, tune on device.

**Migration note:** stored `level`/`fleetAdminLevel` are preserved; the curve change only affects FUTURE
progression. Any instant level-crossing on load is resolved by the existing capped level-up loop. No
data corruption — it's a pace rebalance, not a schema change to the leveling fields.

---

## 5. Captain-slot level walls (LAYERED — not a reversal)

Captain slots today unlock via the Fleet Logistics `unlockCaptainSlot` Homeworld Talents (adminPoint
cost). This ADDS an FA-level requirement on top — you need **the level AND the talent** (history: the
old level-only gate was removed 2026-07-07; this is additive, confirmed by the user 2026-07-11).
- Ladder (×5, **tunable**): slot 2 → FA L1, slot 3 → L5, slot 4 → L25, slot 5 → L125; grow for 6+.
- Data change on `HOMEWORLD_TALENTS` (a level requirement on the `unlockCaptainSlot` entries) — no save
  migration. UI shows the level requirement, **red "missing"** when unmet (same readiness idiom as the
  facility framework's material/prereq readouts).
- Rationale: **captains are "wall breakers"** — deliberate progression walls a new captain helps break.

---

## 6. "Coming Soon" → "Locked" relabel

Cross-cutting UI: content that EXISTS but isn't yet unlocked (e.g. the level-walled captain slots) shows
**"Locked"** with its requirement; **"Coming Soon"** stays reserved for content that doesn't exist yet.
Small pass; rides here because it pairs with the slot walls.

---

## 7. Lifetime Stats — reserved + counting starts HERE

This is the first-shipping feature, so it carries the `lifetimeStats` schema (see the epic §4 PREREQUISITE
+ Phase 1 design §8 for the full rationale — lifetime totals are UNRECOVERABLE, so they must start now).
- Schema (save **v16→v17**, all `Decimal`): `itemsGathered` / `itemsRefined` / `itemsCrafted`
  (`Record<itemId, Decimal>`, refined/crafted seeded empty until their phases), `missionsCompleted`
  (`Record<missionType, Decimal>`), `creditsEarned`, `captainXpAwarded`, `fleetAdminXpAwarded`.
- **Mission-side increments wired HERE** (missions completed, materials gathered, credits + XP earned) —
  the same careful pass through the closed-form mission code, via the shared helper (§8). Refine/craft
  increments come later in Phase 1's engine. Existing saves seed all counters at 0 (pre-launch history
  is genuinely unknown; current players accrue from here forward).

---

## 8. Implementation approach — the shared helper (Root Cause)

**Corrected understanding (grounded 2026-07-11):** `tickCaptainMission` is ALREADY the shared per-captain
function — BOTH offline `tick()` and `App.svelte`'s live poll loop call it (App.svelte:616). So the
per-tick XP accrual + level-up logic (which lives INSIDE `tickCaptainMission`, at the current
`xp += XP_PER_MISSION_CYCLE` site) changes in ONE place and both paths get it automatically.

The real (narrower) drift surface is the **inputs each loop computes and passes in** (`bonuses`,
`shipStats` today) and the **outputs each loop accumulates** (`fleetAdminXpDelta`, `creditsDelta`
today) — historical drift (dropped ship stats/credits) was here, not in the math. So:
- Put the per-tick XP accrual + lifetime-stat increments INSIDE `tickCaptainMission`, returned as
  deltas (extend the existing `{ captain, homePlanetDelta, fleetAdminXpDelta, creditsDelta }` return
  with `lifetimeStatsDelta`). Both loops already destructure + accumulate that return shape.
- Any NEW input the rate pipeline needs (XP multipliers) must be computed and passed by BOTH loops —
  mirror exactly how `bonuses`/`shipStats` are already threaded, and add a **parity test** asserting
  `tick()` and a simulated live-loop run produce identical XP/level/stat results for the same elapsed
  ticks (the guard against the input/output-wiring drift).
- Do NOT attempt the full tick-path unification (live loop → `tick()`); it's the separate deferred
  refactor. This feature only extends the already-shared function + its delta contract.

---

## 9. Save migration (v16 → v17)

Add `MIGRATIONS[16]`; bump SAVE_VERSION 17. Initialise `lifetimeStats` (all counters at 0 / empty maps).
Leveling fields (`xp`/`level`/`statPoints`/`fleetAdminXp`/`fleetAdminLevel`) are unchanged in shape.
Add a v16→v17 round-trip test per `save.test.ts` conventions.

---

## 10. Verification (no Node locally)

Manual code tracing + hand-read Vitest files + Vercel preview branch for device testing (the user
QA-tests on desktop + Android). Critical checks: (1) live loop and offline `tick()` yield identical
XP/levels via the shared helper; (2) closed-form offline XP over long elapsed matches active-ticks × rate;
(3) captain leveling pace ~unchanged at the chosen curve; (4) FA pace feels right with 1 vs several
concurrent actions (the stacking); (5) slot walls gate correctly (level AND talent).

---

## 11. Open items for the plan step

1. Curve constants — captain **LOCKED at 296 × level** (exact short-run parity, §4); FA curve form/scale
   still open (most playtest-sensitive, tune on device).
2. `BASE_XP_PER_TICK` values per mission + per facility-process type (start all at 1).
3. Whether captain XP gets its own talent-mult pipeline NOW or just reserves the seam (no captain XP
   talents exist yet — likely reserve, matching "no placeholders").
4. Slot-wall ladder final numbers (start ×5: 1/5/25/125).
5. Exact shared-helper boundary (how much of the per-captain tick logic to extract without over-reaching).
