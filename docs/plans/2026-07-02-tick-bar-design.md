# Tick Bar — Design

*Approved 2026-07-02. Companion to `fleet_admiral_master_design.md` and `fleet_admiral_technical_spec.md`.*

## Purpose

Add a visible "tick bar" panel that turns resource production from continuous
smooth accrual into discrete lump-sum grants on a fixed cadence, matching the
OSRS/Melvor tick pattern the player wants. The tick duration starts at 10
seconds and is designed to be shortened later by captain/ship bonuses —
this doc only builds the mechanism, not any bonus that uses it yet.

## Decisions

**Discrete resource grants, not a cosmetic pulse.** Resources are held and
granted in one lump exactly when the bar fills. This replaces the current
100ms continuous accrual in `App.svelte`, but requires no change to
`tick()` itself — `tick(deltaSeconds, state)` is already closed-form, so
calling it once every `tickDurationSeconds` instead of every 100ms produces
mathematically identical totals over time.

**One global tick clock (for now).** A single `tickDurationSeconds` value
governs all production simultaneously. Per-module or per-captain/ship
independent tick timers are an explicitly deferred idea (see Future Work) —
not needed until captains/ships exist.

**`tickDurationSeconds` lives on `GameState`.** Default `10` in
`freshState()`. This is what future bonuses will mutate. It persists across
saves (see Save Migration) and survives Tier 1 prestige (see Prestige).

**Bar cycle time is floored at 1 real second.** `barSeconds = Math.max(1,
tickDurationSeconds / speed)`. At the existing dev-speed presets (1x/10x/
100x/1000x), the bar never flickers faster than once per real second — at
high speed multiple game-ticks just batch into that one visual cycle via a
single `tick()` call, which is still correct because of the closed-form
property.

## Data Model Changes

`src/lib/game/model.ts`:
- Add `tickDurationSeconds: number` to `GameState`.
- `freshState()` sets it to `10`.

`src/lib/game/save.ts`:
- Bump save `version` to `2`.
- Migration `migrate_v1_to_v2`: if `tickDurationSeconds` is missing, default
  to `10`.

`src/lib/game/tick.ts`:
- **No changes.** `tick()` stays exactly as-is; it already accepts an
  arbitrary `deltaSeconds` and is exercised by the existing closed-form
  regression test.

`prestige()` in `tick.ts`:
- Carry `tickDurationSeconds` forward from the pre-prestige state into the
  reset state, the same way `augmentPoints` already carries forward. Once a
  bonus exists that shortens it, that improvement should survive a Tier 1
  reset rather than reverting to 10s.

## Timing Loop (`App.svelte`)

Replace the current "call `tick(delta)` every 100ms" loop with:

```
barCycleStart = Date.now()   // reset whenever a tick fires

// every 100ms:
if (speed === 0) return;     // paused — bar freezes, no-op (matches tick()'s own deltaSeconds<=0 no-op)

barSeconds = Math.max(1, state.tickDurationSeconds / speed)
progress = (Date.now() - barCycleStart) / 1000 / barSeconds

if (progress >= 1) {
  gameSecondsThisCycle = barSeconds * speed   // == tickDurationSeconds at normal speeds,
                                                // a whole multiple of it once the 1s floor kicks in
  state = tick(gameSecondsThisCycle, state)
  barCycleStart = Date.now()
}
```

`progress` (clamped 0–1) drives the bar's fill percentage and the countdown
readout (`(barSeconds * (1 - progress)).toFixed(1) + "s"`).

**Offline catch-up is unchanged.** The existing one-shot
`tick(offlineSeconds, loadedSave.state)` call on load stays exactly as-is.
The bar simply starts a fresh cycle once active play resumes.

**Known edge case (accepted, not fixed):** switching dev-speed presets
mid-cycle recomputes `barSeconds` against the same `barCycleStart`, causing
the bar to visibly jump. This is a dev-only control, not seen by a normal
player, so it's not worth the complexity of preserving fractional progress
across a speed change.

## UI

New panel in `App.svelte`, positioned in `<main>` between the `RESOURCES`
section and the `GENERATOR STACK` section. Styled consistently with existing
panels (`.panel` / `.panel-title` conventions, cyan glass theme):

- Panel title, e.g. `TICK`.
- Horizontal progress bar, fill 0→100% over the cycle.
- Countdown readout showing seconds remaining in the current cycle.

No log entry fires on every routine tick — the 8-entry log would get
flooded every 10 seconds and drown out prestige/dev-panel events.

## Testing

- `tick.test.ts` (closed-form regression) is untouched and stays valid,
  since `tick()`'s signature and behavior don't change.
- Manual verification after implementation:
  - Bar fills over 10s at 1x speed; resources jump once when it fills.
  - Dev-speed presets (10x/100x/1000x) scale the bar per the 1s floor;
    resource totals over a fixed wall-clock window match what continuous
    accrual would have produced (sanity-check against the existing offline
    simulator, which exercises the same `tick()` math).
  - Pause (0x) freezes the bar with no resource change.
  - Reloading mid-cycle starts a clean new cycle (no carried-over partial
    progress needs to persist — it's session-only, not saved).
  - An old (pre-`tickDurationSeconds`) save loads via migration with the
    field defaulted to `10`.

## Future Work (explicitly out of scope here)

- Actual bonuses/research that reduce `tickDurationSeconds`.
- Per-captain/per-ship independent tick clocks, once those entities exist.
- Visual "+N ore" feedback text on each tick fire.
