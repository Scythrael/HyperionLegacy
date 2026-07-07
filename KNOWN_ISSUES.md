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
- 5 of the 6 "real" launch Captain/Homeworld Talent nodes (Captain &amp;
  Homeworld Talent Trees) — every effect type except `unlockCaptainSlot` —
  are purchasable, recorded, and shown as "Owned" in the UI, but have zero
  gameplay effect: `extractionYieldMult`/`rareLootChanceMult`
  (`tickCaptainMission`'s extraction/loot math), `fleetExtractionYieldMult`
  (same), `recipeBonusOutput` (`craftRecipe`), and `passiveTrickle` (no
  passive-income tick exists yet) are none of them actually read anywhere
  outside `CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS`'s own table definitions.
  Deliberate for this pass (the tables/buy-functions/UI were the scope; wiring
  each effect into its consuming system is follow-up work) but worth writing
  down since a player can spend real statPoints/adminPoints and see nothing
  change.
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
