# Known Issues

Things known to be broken or missing, deliberately deferred. Ops §8.E.7:
write it down so you don't relitigate it later.

- No offline-cap or offline-efficiency reduction yet — offline time is
  applied at full rate regardless of duration. Fine for prototype; revisit
  before any real playtest longer than a day.
- Homeworld Refinery/Fabrication (Phase 4) each run exactly one hand-picked
  recipe (`refineUnobtainium`, `fabricateComponents`) with no player choice
  of inputs/outputs yet — proves the crafting mechanic, not the "fully
  fleshed out crafting system" the design doc gestures at. Add entries to
  `RECIPES` (`model.ts`) when that's ready to grow; no auto-craft toggle
  exists yet either (manual Craft-button only), which is a deliberate
  near-term follow-up per Task 5's implementation notes.
- The Refinery/Fabrication panel's title (`App.svelte`) is a hardcoded
  `recipeKey === "refineUnobtainium" ? "REFINERY" : "FABRICATION"` ternary,
  not derived from `RECIPES` data — correct for both of today's launch
  recipes, but a 3rd, non-fabrication recipe would silently fall into the
  "FABRICATION" label. Add a `structureLabel` field to `RecipeDef` if/when
  a 3rd recipe is actually added.
- `buyHomeworldTalent()` (`tick.ts`) builds its new-captain object literal
  inline (`id`/`label`/`shipType`/`...freshCaptainStack()`) instead of
  reusing a shared helper — currently byte-identical to `freshCaptains()`'s
  own construction, so no bug today, but a future field added to that shape
  would need updating in both places. Worth consolidating next time either
  function is touched.
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
  That reuse has now happened (Fleet Operations' captain-selection popup,
  2026-07-07) — the new modal has the SAME focus-trap/Escape gap, plus it has
  ZERO `aria-label`s anywhere (the delete modal at least labels its text
  input), so it's actually a step behind, not just a repeat. Worth fixing
  both modals together in one pass rather than patching them separately.
  The Import Save confirmation modal (2026-07-07, Loot Tier Rework) is now a
  THIRD instance of the same gap — same `.modal-backdrop`/`Panel.modal-dialog`
  reuse, no Escape handling, no focus trap. Three instances now sharing one
  unfixed pattern; this is the point where fixing it once (rather than a
  fourth bespoke patch next time) stops being optional cleanup and starts
  being the cheaper option.
- Theme switching only affects the "primary"/accent color tokens — it does
  not recolor `.log-entry` text (`#9fc4cc`, hardcoded, predates the theme
  feature) or the Starfield's dots (`#bfe9f5`, same). Intentional scope
  limit per the design doc, not a bug, but worth writing down so "theme
  switching looks incomplete" doesn't get rediscovered as a surprise.
- The tick-bar poll (`App.svelte`, 100ms `setInterval`) only fires ONE
  `tick` call per poll when a cycle completes, even if the real-world gap
  since the last poll was long enough to cover several cycles (e.g. a
  throttled or backgrounded browser tab). Progress for the "extra" cycles in
  that gap is lost rather than credited — it isn't clamped or caught up, it
  just never happened. Predates the captain/ship feature (present in the old
  single-cycle code too — confirmed via `git show 94d1801~1`), and has
  moved with the economy ever since: it applied to every captain's
  `tickCaptainStack` cadence once captains landed, then (Phase 3a) also to
  `tickCaptainMission` for any captain on a mission — a missed poll there can
  silently drop an extraction tick's loot roll, which (unlike production
  throughput) can never be recovered. As of Phase 4 (Generator Stack
  removal), `tickCaptainStack` no longer exists and idle captains
  (`mission: null`) have no passive economy left to lose ticks from at
  all — `tickCaptainMission` is now the ONLY per-captain tick path, so this
  gap applies solely to captains on a mission. Worth fixing (compute
  cycles-elapsed and batch them into one closed-form `tickCaptainMission`
  call per mission captain, rather than one bounded tick) before any real
  playtest that leaves the tab backgrounded for a while.
- Phase 4 (Generator Stack removal) left several CSS rules in `App.svelte`'s
  `<style>` block orphaned with no markup referencing them: `.research-status`,
  `.module-*`, `.prestige-row`/`-yield`/`-btn`, `.spec-*`.
  (`.tick-bar-*` is no longer in this list -- the TICK panel was re-added,
  now shown on every tab rather than just Fleet Ops. `.skill-*` is no longer
  in this list either -- the Captain &amp; Homeworld Talent Trees feature
  reactivated those classes for its own Captain Talents/Homeworld Talents
  panels.) Inert (no broken references, at worst an unused-selector warning),
  deliberately left for a dedicated stylesheet cleanup rather than expanding
  the panel-removal task into a full CSS audit.
- UI Redesign (Task 11 final sweep) orphaned two more CSS rule groups in
  `App.svelte`'s `<style>` block, confirmed via grep to have zero remaining
  markup references anywhere in the file: `.captain-tabs`/`.captain-tab`
  (Task 8 replaced the horizontal captain-pill row with the vertical
  `.captain-list`/`.captain-list-item` layout) and `.icon-btn` (Task 10
  removed the header's dev-only "Dev" toggle button, its only consumer, when
  `devPanelOpen` was folded into the System tab's Debug sub-tab). Same
  category as the Phase 4 orphans above -- inert, no broken references,
  deliberately left for the same dedicated stylesheet cleanup rather than
  deleting piecemeal task-by-task.
- RESOLVED as a side effect of Scroll Containment & Locked Placeholders'
  Task 1: `.top-bar` and `.nav-tabs` are no longer `position: fixed` at all
  (both are now normal flex children of `.frame`'s fixed-height column), so
  the "two independently-fixed elements silently overlap on a short
  viewport" failure mode this entry used to describe can no longer happen --
  neither element is out-of-flow anymore. The underlying concern (total
  fixed-chrome height -- header + top-bar + nav -- versus a short viewport)
  still exists in a different form: `.tab-body`'s `min-height: 0` lets it
  get squeezed toward zero visible height instead, with all overflow
  correctly absorbed by `.tab-scroll-area` rather than clipping -- correct
  behavior, but could look cramped on a landscape phone. Worth a real-device
  check on a short viewport before shipping to handheld landscape use; no
  fix attempted here since it can't be verified without a renderer in this
  environment.
- Captain-list slots 5-10 (shown locked/"Coming Soon!") have no unlock mechanism behind them yet --
  `HOMEWORLD_TALENTS`' Fleet Logistics branch only defines 3 slot-unlock tiers
  (`fleetLogisticsSlot1/2/3`), capping the real fleet at 4 captains. Slots 5-10 are a deliberate
  future-roadmap signal (more Fleet Logistics tiers planned later), not a bug -- but there's
  currently no in-game path to ever reach them. Add more `unlockCaptainSlot`-effect entries to
  `HOMEWORLD_TALENTS` when that's ready.
- Scroll Containment & Locked Placeholders' Task 2 code-quality review flagged that locked sub-tabs
  (`SubTabs.svelte`) use a native `disabled` button, which removes them from the keyboard tab order
  entirely -- a keyboard-only user has no way to discover the "Coming soon" `title` tooltip at all,
  unlike a mouse user, who can hover. Not a regression (locked tabs didn't exist before this feature,
  so there's no prior keyboard-actionable state to compare against), but a real accessibility gap in
  the new locked-tab pattern specifically. Worth revisiting (e.g. `aria-disabled` plus a focusable,
  non-disabled button) once this locked-tab pattern is reused enough to justify the change.
- `MAX_LEVEL_UPS_PER_TICK = 10_000` (`tick.ts`) caps how many level-ups `tickCaptainMission`'s captain-XP
  loop and `applyFleetAdminXp` will each resolve in a single call, carrying any leftover XP forward to the
  next call rather than looping unboundedly. If a single call's XP delta is ever large enough to need MORE
  than 10,000 level-ups to fully resolve -- most plausibly after a very long offline-catchup delta once
  captain `xp`/`fleetAdminXp` are `Decimal`-scale -- the displayed level will lag a few ticks behind what
  the accumulated XP actually supports, catching up over subsequent ticks/calls as the carried-forward
  remainder keeps draining. Deliberate trade-off (see SESSION_LOG.md Session 19 and Session 20): a bounded
  per-call cap with carry-forward is simpler and more robust than an algebraic closed-form/log-based
  level-up formula, especially since the underlying XP curve itself might change. Not a bug -- but worth
  a real playtest with a deliberately huge offline gap to confirm the lag is only ever a few ticks in
  practice, not something that compounds or never fully drains.
