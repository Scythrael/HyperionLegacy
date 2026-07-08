# Fleet Admiral XP Rework — Design

## Context

Live-tested after the Loot Tier Rework shipped: the user found Fleet Admiral leveling essentially
frozen ("18/500 exp... with plenty of idle time"). Root cause, confirmed against the actual code
(`tick.ts`'s `recomputeFleetAdmin`): Fleet Admiral XP is not earned from missions at all today — it's
recomputed fresh every call as the **sum of every captain's current level**
(`state.captains.reduce((sum, c) => sum + c.level, 0)`), compared against
`xpForNextFleetAdminLevel(level) = 500 * level * level`. Reaching even Fleet Admiral level 1 requires a
single captain's level (or several captains' levels summed) to reach 500 — achievable only after roughly
a quarter-million completed mission cycles. This mismatch against the original design intent ("level-50
captains might only mean a level 3-4 Fleet Admiral") was already flagged in `model.ts`'s own comment when
Fleet Admiral leveling first shipped, but never fixed.

**Confirmed direction**: switch Fleet Admiral XP to an earn-per-mission-completion model, mirroring how
captain XP already works, rather than deriving it from captain levels at all.

## Mechanic

- `MissionDef` (`model.ts`) gains a new field: `fleetAdminXpPerCycle: number`. `shortOreRun: 1`,
  `longOreRun: 2` — confirmed exact values from the user.

  **Balance caveat (user's explicit note, 2026-07-08):** missions are only the FIRST of several
  intended Fleet Admiral XP sources — other actions (crafting, talent purchases, etc., per the
  "completing other actions will add exp" future scope noted above) will add their own XP later. The
  `2500 * level^2` curve and these per-mission values are deliberately NOT calibrated to make missions
  alone carry the full weight of Fleet Admiral progression — don't tune this curve later as if missions
  were meant to be the sole/primary source; the curve should account for multiple future income
  streams stacking together, not just this one.
- `tickCaptainMission` (`tick.ts`), at the exact point it already awards captain XP on cycle completion
  (`xp += XP_PER_MISSION_CYCLE`), ALSO accumulates a local `fleetAdminXpDelta` by
  `missionDef.fleetAdminXpPerCycle` per cycle completed within the call (mirroring how `homePlanetDelta`
  is already accumulated locally and returned, since Fleet Admiral XP — like `homePlanetDelta` — is
  fleet-wide bookkeeping, not per-captain state). `tickCaptainMission`'s return shape gains this new
  field alongside the existing `captain`/`homePlanetDelta`.
- `tick()` (and `App.svelte`'s live-tick-loop mirror of it) sums `fleetAdminXpDelta` across every
  captain's call this poll (same "accumulate locally across captains, apply once" shape already used for
  `homePlanetDelta`), then applies it to `state.fleetAdminXp` in one place.
- `recomputeFleetAdmin` is replaced by a new function with a materially different contract —
  `applyFleetAdminXp(state, fleetAdminXpDelta)` — that ADDS the delta to the existing `fleetAdminXp` and
  resolves level-ups via a `while` loop that SUBTRACTS the threshold each level (mirroring captain XP's
  own subtract-and-carry-forward shape exactly, not the old "just recompute a running total, never
  subtract" shape). This is a genuine behavior change from today's `recomputeFleetAdmin`, not a rename.
- `xpForNextFleetAdminLevel`'s curve keeps its quadratic shape (confirmed with the user), multiplier
  bumped from `500` to `2500`: `xpForNextFleetAdminLevel(level) = 2500 * level * level`. Treated as a
  launch-placeholder balance constant, same convention as `MISSIONS`/`RECIPES`/talent costs elsewhere in
  this codebase (tunable later, not gatekept on perfect balance analysis now).
- **The same unbounded-loop risk already identified for captain XP in the (separate, not-yet-started)
  Big-Number Migration plan applies here too**, and is MORE immediately relevant: a large offline
  catch-up `ticksElapsed` could complete many mission cycles across many captains in one `tick()` call,
  each contributing 1-2 Fleet Admiral XP — summing to a potentially large `fleetAdminXpDelta` applied in
  one shot. `applyFleetAdminXp`'s level-up loop needs the same bounded-iteration safeguard
  (`MAX_LEVEL_UPS_PER_TICK`-style cap, carrying any leftover XP forward to the next call) the Big-Number
  plan already designed for captain XP — building it now, while `fleetAdminXp` is still a plain
  `number`, means the Big-Number migration plan's own Task 5 (bounded level-up loop fix) only needs to
  ADD Decimal typing to an already-bounded loop afterward, not build the bound itself. **The Big-Number
  migration plan (`docs/plans/2026-07-08-big-number-migration-plan.md`) will need a small follow-up edit
  after this feature ships**, to reflect that `applyFleetAdminXp` (not `recomputeFleetAdmin`) is the
  function Task 5 touches, and that the bounded-loop CONSTANT already exists (only its Decimal-awareness
  needs adding).

## Explicitly out of scope (logged to SUGGESTIONS.md instead, not built here)

- "Completing other actions will add exp" (crafting, talent purchases, etc. beyond mission-cycle
  completion) — vague, unscoped, the user's own phrasing frames this as a future direction, not a
  concrete ask for this pass.
- "Talents that increase exp based on what you have specced" — a new Captain/Homeworld Talent effect
  type boosting Fleet Admiral XP-per-mission. The user explicitly said "there are going to be talents,"
  framing this as future work, not part of this fix.

## Save migration

`fleetAdminXp`'s STORED value shape doesn't change (still a `number` today, pre-Big-Number-Migration) —
no new field is added to `GameState` that didn't already exist. `MissionDef`'s new
`fleetAdminXpPerCycle` field lives on the STATIC `MISSIONS` table (code, not save data), so it needs no
migration either. **No new save migration step is needed for this feature.**

## Sequencing

This branch (`feat/fleet-admiral-xp-rework` or similar) starts now, merges before the Big-Number
Migration's implementation begins (that migration's plan is written and committed, but implementation
hasn't started) — both touch `tick.ts`/`model.ts`, and `fleetAdminXp` is directly in the Big-Number
migration's scope, so landing this mechanic change first avoids redoing it under Decimal typing.
