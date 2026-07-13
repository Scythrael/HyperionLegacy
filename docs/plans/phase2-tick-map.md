# Phase 2 · Task A1 — Current tick-path map (factual base for the step-forward refactor)

Investigation-only note. Grounds Group A of
`2026-07-13-phase-2-warehouse-refine-economy-plan.md`. No code changed by this task.

## The two paths

### Offline catch-up — `tick(deltaSeconds, state)` — `src/lib/game/tick.ts:1035-1224`
Closed-form **per span** (does NOT loop per tick):
1. `ticksElapsed = deltaSeconds / state.tickDurationSeconds`.
2. `state.captains.map(...)` — for each captain on a mission: build the 8-field `bonuses` object
   (`captainCommonYieldMult` … `captainSpecBonusRollChance`) + resolve the captain's ship →
   `shipDerivedStats`, then `tickCaptainMission(ticksElapsed, captain, Math.random, bonuses, shipStats)`.
   Accumulate `homePlanetDelta` (loot), `fleetAdminXpDelta`, `creditsDelta`, and fold
   `lifetimeStatsDelta` via `foldLifetimeStatsDelta`.
3. `passiveTrickle`: for each unlocked `economyTrickle` talent, `homePlanetDelta[mat] += perTick * ticksElapsed`.
4. Loot fold: `addToInventory` for each `LOOT_MATERIAL_KEYS` → new `inventory` + `discovered`.
5. `postMissionState` = `{...state, captains, gameTimeSeconds += deltaSeconds, credits += creditsDelta,
   inventory, discovered, lifetimeStats}`.
6. `resolveProcesses(postMissionState, ticksElapsed)` → `postProcessState` + `processFleetAdminXpDelta`
   (folds into `fleetAdminXpDelta`).
7. `return applyFleetAdminXp(postProcessState, fleetAdminXpDelta)`.

### Live play — App.svelte `setInterval` (~100ms) — `src/App.svelte:541-~790`
Fires the **same body** once per tick-bar cycle:
- `progress = (now - cycle.barCycleStart)/1000/barSeconds`; when `progress >= 1`:
  - `ticksElapsed = gameSecondsThisCycle / state.tickDurationSeconds` (same conversion tick() uses).
  - Per captain: same `bonuses` build + `tickCaptainMission(ticksElapsed, …)` + `foldLifetimeStatsDelta`.
  - Same `passiveTrickle` (`perTick * ticksElapsed`) + loot `addToInventory`.
  - Fold `captains`/`lifetimeStats` into `state` **BEFORE** `resolveProcesses` (load-bearing order,
    App.svelte:757-770, mirrors tick.ts's `postMissionState → resolveProcesses`).
  - `resolveProcesses` (shared) + `applyFleetAdminXp` at the end.
  - `cycle.barCycleStart = now` (resets; poll-lag overshoot discarded — same as always).

## Shared, single-source functions (both paths import + call — the drift-PROOF parts)
`tickCaptainMission`, `addToInventory`, `resolveProcesses`, `foldLifetimeStatsDelta`, `applyFleetAdminXp`.
(App.svelte:87-131 imports them with comments explicitly naming the drift-proof intent.)

## The DIVERGENCE SURFACE (hand-mirrored in BOTH paths — the drift-PRONE parts)
This is what `economyTick` will absorb so it lives in one place:
- The 8-field `bonuses` object construction + ship-stat resolution.
- The `passiveTrickle` loop.
- The loot → `addToInventory` fold across `LOOT_MATERIAL_KEYS`.
- The **ordering** (mission/lifetime fold BEFORE `resolveProcesses`).
- The `credits += creditsDelta`, `fleetAdminXpDelta` accumulation (mission + process), `gameTimeSeconds`
  increment, and the final `applyFleetAdminXp` pass.
- Historical drift bugs (ship stats, bonus-roll, credits — all logged) came from exactly this surface:
  a field wired into one wrapper but not the other.

## KEY INSIGHT for the refactor (why this is tractable + safe)
Both paths **already** pass `ticksElapsed` to the **same closed-form subsystems**. The difference is only
granularity: live fires ~per-bar with a small `ticksElapsed`; offline fires ONCE with the whole span. So:

- **A2 (extract `economyTick(state, ticksElapsed)`):** a MECHANICAL lift of the divergence-surface body
  (steps 2-7 above) into one function. Not a math rewrite.
- **A3 (live loop calls it):** replace App.svelte's hand-mirrored copy with `economyTick(state, oneBarTicks)`.
- **A4 (chunked offline):** replace tick()'s single big-span call with a loop of `economyTick` over chunks
  bounded by **breakpoints**.

### Breakpoints (what forces a chunk boundary)
- **Today, already handled closed-form *within* one call:** process completion (`resolveProcesses` resolves
  all completions in a span), FA level-ups (`applyFleetAdminXp`'s capped loop). So **for today's systems a
  single `economyTick` over the whole span == the current `tick()`** — meaning A2–A4 are behavior-preserving
  and A5's regression oracle should pass by construction.
- **Introduced by Phase 2 (the REASON chunking is added now):** a **cap hit** (auto-stop, Group B) and a
  **refine-order pause/resume** (Group D). These couple production↔storage↔consumption, so a single big
  closed-form span would be wrong once they exist. The chunk loop steps to the next such breakpoint, applies
  the discrete event, and continues. **Group A builds the chunk-loop infrastructure; B/D register the new
  breakpoints into it.**

## Implication for Group A execution
- The refactor is **mostly mechanical extraction + forward-looking chunk infrastructure**, NOT a from-scratch
  simulator. Risk is concentrated in (a) not dropping a divergence-surface field during extraction (A3 review
  focus), and (b) the chunk-boundary math being exact (A4/A5). Both are hand-traceable against the current
  closed-form.
- `economyTick` must be **pure/deterministic given (state, ticksElapsed, rng)** so a chunk of size K equals
  the closed-form for K ticks — which the existing subsystems already guarantee.
