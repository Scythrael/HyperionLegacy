# Known Issues

Things known to be broken or missing, deliberately deferred. Ops §8.E.7:
write it down so you don't relitigate it later.

- No offline-cap or offline-efficiency reduction yet — offline time is
  applied at full rate regardless of duration. Fine for prototype; revisit
  before any real playtest longer than a day.
- Refinery/Fabricator are priced in ore, not their own tier's precursor
  resource. Decoupled parallel producers, not a real consumption chain yet.
  Matches "many parallel small stacks" model from tech spec §3, but worth
  a deliberate look once missions/research complicate the economy.
- No captains, crew, ships, sectors, or bosses. This is the §10.5 minimal
  prototype scope on purpose.
- Corrupt-save handling doesn't yet surface a raw-export option to the
  player (tech spec §6 requirement) — currently just fails to load silently
  and starts fresh.
- Switching the dev panel's speed presets mid-cycle causes the tick bar to
  visibly jump, since `barCycleStart` isn't reset when `speed` changes.
  Dev-only control gated behind `DEV_MODE_ENV`, never seen by a normal
  player, so preserving fractional progress across a speed change isn't
  worth the added complexity.
- The delete-save confirmation modal (the first modal in this codebase)
  doesn't trap focus or move it to the input on open, and Escape doesn't
  close it — only the Cancel/Delete buttons do. Doesn't create a safety
  risk (the typed-"DELETE" gate to the actual deletion is unaffected
  either way), but a keyboard user can currently Tab past the backdrop
  into page content behind it. Worth fixing once this modal pattern gets
  reused for anything else, so the fix lands once instead of per-modal.
- Theme switching only affects the "primary"/accent color tokens — it does
  not recolor `.log-entry` text (`#9fc4cc`, hardcoded, predates the theme
  feature) or the Starfield's dots (`#bfe9f5`, same). Intentional scope
  limit per the design doc, not a bug, but worth writing down so "theme
  switching looks incomplete" doesn't get rediscovered as a surprise.
- The tick-bar poll (`App.svelte`, 100ms `setInterval`) only fires ONE
  `tickCaptainStack`/`tick` call per poll when a cycle completes, even if
  the real-world gap since the last poll was long enough to cover several
  cycles (e.g. a throttled or backgrounded browser tab). Production for the
  "extra" cycles in that gap is lost rather than credited — it isn't
  clamped or caught up, it just never happened. Predates the captain/ship
  feature (present in the old single-cycle code too — confirmed via
  `git show 94d1801~1`), but now applies independently to every captain's
  own cadence instead of one shared clock, so a backgrounded tab with N
  captains running loses progress N times over instead of once. Worth
  fixing (compute cycles-elapsed and batch them into one closed-form
  `tickCaptainStack` call per captain, rather than one bounded tick) before
  any real playtest that leaves the tab backgrounded for a while. Since
  Home Planet & Mission Expeditions (Phase 3a), this same gap also applies
  to `tickCaptainMission` for any captain on a mission — a missed poll can
  silently drop an extraction tick's loot roll, which (unlike production
  throughput) can never be recovered. Same root cause, same fix.
- Both prestige tiers (`captainPrestige`, fleet-wide `prestige` in
  `tick.ts`) reset a captain's resources/modules/research via
  `freshCaptainStack()`, but neither touches that captain's entry in
  `App.svelte`'s `captainCycles` map (`barCycleStart`/`nowTick`). For up to
  one cycle after a prestige, the affected captain's tick-bar can show
  leftover progress from before the reset instead of starting at 0 — purely
  a cosmetic display quirk, self-corrects on the captain's next real cycle
  boundary, no resource/math corruption. Pre-existing since Task 6 added
  `captainPrestige` (Task 7's Fleet Prestige has the identical gap). Worth
  a one-line fix (reset `captainCycles[id].barCycleStart` alongside the
  state reset) whenever someone is next in that function for another
  reason.
