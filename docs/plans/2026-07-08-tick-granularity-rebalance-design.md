# Tick Granularity Rebalance — Design

## Motivation

`tickDurationSeconds` (fleet-wide, `GameState`) currently defaults to `10` — every mission phase
duration (`transitOutTicks`, `transitBackTicks`, `unloadTicks`, and the derived `extracting` tick
count) is defined in whole ticks, so every real-world phase duration is forced into 10-second
increments. The user wants sub-10-second precision for tuning mission/phase durations going forward
(e.g. a transit taking exactly 37 seconds, not rounded up to 40) — this is a balance-precision need,
explicitly NOT a "make the whole game run faster" change (that's already available via the existing
`speed` multiplier, which is untouched by this design).

While addressing this, two secondary items surfaced:
- Every mission's phase durations get a genuine rebalance (not just a mechanical ×10 unit conversion),
  since finer resolution is now available.
- The tick-bar's visual cadence (how often the shared header bar fills and resets) will cycle 10x
  faster once ticks are 1 second instead of 10 — this needs to be observable and optionally
  disableable, without committing to a full visual redesign before anyone has actually seen it.

## Core mechanism

- `tickDurationSeconds`'s `freshState()` default changes from `10` to `1`.
- `tick.ts`'s phase-advancement logic (`requiredTicksForPhase`, `MISSION_PHASE_ORDER`, the closed-form
  tick-application loop in `tickCaptainMission`) is already unit-agnostic — it only counts ticks,
  whatever a tick currently represents in real seconds. None of it needs to change.
- `MISSIONS` (`src/lib/game/model.ts`) is rebalanced to new tick-counts (below), not just multiplied by
  10 — a genuine retuning, using the new 1-second resolution.
- Future talent/ship-component/module speed bonuses (not built in this plan) will layer on as tick-count
  adjustments read at the point `requiredTicksForPhase` is consulted, the same way extraction bonuses
  already flow through a `bonuses` object today. Always resolves to whole ticks (= whole seconds, once
  this ships). This design doesn't build any of that — it just avoids blocking it.

### Rebalanced `MISSIONS` table

| Mission | Phase | Today (10s ticks) | New (1s ticks) |
|---|---|---|---|
| Short Ore Run | Transit out | 3 ticks = 30s | 25 ticks = 25s |
| | Extracting | 10 ticks = 100s | 90 ticks = 90s |
| | Transit back | 3 ticks = 30s | 25 ticks = 25s |
| | Unloading | 1 tick = 10s | 8 ticks = 8s |
| | **Total** | **170s** | **148s** |
| Long Ore Run | Transit out | 8 ticks = 80s | 70 ticks = 70s |
| | Extracting | 10 ticks = 100s | 90 ticks = 90s |
| | Transit back | 8 ticks = 80s | 70 ticks = 70s |
| | Unloading | 1 tick = 10s | 8 ticks = 8s |
| | **Total** | **270s** | **238s** |

Extraction's `cargoCapacity`/`extractionRatePerTick` pair is retuned so each extraction phase still
delivers its intended total yield across the new (larger) tick-count for that phase — exact values
finalized during implementation, keeping the "divides evenly" invariant `requiredTicksForPhase`'s
`extracting` case already depends on.

## Save migration (v12 → v13)

`tickDurationSeconds` and any in-progress mission's `phaseProgressTicks` both need conversion for
existing saves. Because `MISSIONS`' tick-counts are being genuinely rebalanced (not scaled by a clean
factor), an in-progress mission's old progress doesn't map onto the new tick-counts via simple
multiplication — instead, this migration preserves the RELATIVE (percentage) position within the
captain's current phase, remapped onto the new tick-count for that same phase.

The pre-rebalance (v12-era) `MISSIONS` tick-counts are snapshotted as literal values inside the
migration function itself — not read from the live `model.ts` constants, which will already reflect
the new rebalanced values by the time this migration runs:

```ts
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

`phaseProgressTicks` is already documented as continuous/fractional-capable, so the remapped result
needs no rounding — a captain 60% through the old 10-tick extracting phase lands at exactly 60%
through the new 90-tick extracting phase. `mission.cargo` (already-collected resources) is untouched.
The `OLD_MISSION_TICKS_V12` snapshot stays frozen at these literal values permanently, regardless of
any future rebalance, so this migration keeps producing the correct v12→v13 ratio indefinitely.
`SAVE_VERSION` bumps from `12` to `13`.

User's explicit reasoning for this more elaborate (vs. a simple phase-progress reset) approach:
"more freedom allows for more creative systems... the more fluid and dynamic something is [vs] the
more rigid it is, the less capable... flexibility and dynamicism involves complexity" — chosen
deliberately over the simpler reset, not because the simpler option was wrong.

## Tick-bar enable/disable toggle

- New `src/lib/tickBarPreference.ts` module, following `src/lib/theme.ts`'s exact existing pattern: a
  dedicated `localStorage` key (`fleet_admiral_tick_bar_enabled`), `loadTickBarEnabled()` /
  `saveTickBarEnabled()` functions, default `true`. Deliberately separate from the save file (like the
  theme), so it survives "delete save" and carries no `GameState`/migration implications.
- Options panel gains a new checkbox: "Enable Tick Bar", with a plain static description line beneath
  it (a tooltip is a future polish item, not built now) explaining: checked = the bar fills once per
  tick; unchecked = the tick-bar section is removed entirely from the header.
- `App.svelte` reads this preference once on load (same timing as the theme load) and conditionally
  renders the EXISTING tick-bar markup/CSS unchanged — no changes to the bar's fill/animation logic
  itself. The entire point of this piece is to let the user observe the now-10x-faster-cycling bar
  live, and decide from there whether it needs a redesign — that decision and any resulting visual
  work is explicitly out of scope for this plan.
- Default state: ON for both new games and existing saves (matches current behavior; nobody's UI
  changes unless they actively opt out).

## Explicitly out of scope for this plan

- A configurable/"variable" tick-bar fill rate (e.g. an option to have the bar represent multiple
  ticks per fill cycle instead of exactly one). User floated this and it was deliberately deferred:
  risks visually disagreeing with per-mission "N ticks remaining" readouts, and there's no need to
  design it before anyone has observed the plain on/off version live.
  See KNOWN_ISSUES.md / SUGGESTIONS.md if revisited later.
- Any future talent/ship-component/module mission-speed bonuses — this design keeps the door open
  (whole-tick-based bonuses layered at `requiredTicksForPhase` read time) but builds none of it.
- A future online-only tick-speed buff (25%/50% cut, from purchasable/awarded global buffs, explicitly
  NOT affecting offline catch-up) — already compatible with this design without any changes, since it
  would hook into the existing runtime-only `speed` multiplier (never persisted, never touches
  `tickDurationSeconds`, already decoupled from offline catch-up's real-elapsed-time calculation).

## Small adjacent fix bundled into this plan

The mission-preview panel's "Total: X ticks" readout (`App.svelte`, around the Fleet Operations
mission-detail popup) has always undercounted by omitting the 1-tick `ordersReceived` phase from its
sum (`transitOutTicks + extractingTicks + transitBackTicks + unloadTicks`, missing the leading
`ordersReceived` tick). Pre-existing bug, unrelated to this migration, caught while investigating the
user's original tick-count report — fixed here since the same file/area is already being touched.
