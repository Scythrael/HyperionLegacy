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
- Several talent contexts are hub-led gateway STUBS -- a hub node plus minimal/no real content -- pending
  the underlying systems they represent (Radial Skill Web, Session 25). On Captain Talents, the Tactician
  (`tactical`) and Explorer (`science`) specs are hub-only until combat/Battlespace and a redefined science
  mechanic exist; only Prospector (`resourcefulness`) is a fully-built tree. On Fleet Admiral (Homeworld)
  Talents, Homeland Defense and Citizenry (and the lean Economy/Industry categories) are similarly hub-led
  until their population/defense/economy systems exist; only Fleet Logistics is rich. Independently of the
  stubs, several talent effects across the built trees remain purchasable-but-unwired (same standing gap the
  earlier talent work already carried) -- they'll be wired as each underlying system ships, per the density-
  expansion note in SUGGESTIONS.md. Deliberate scope shape, not a bug: the radial framework renders a
  hub-only branch correctly and takes new nodes without a rendering change.
- The Radial Skill Web's Checkpoint-B visual TUNABLEs are deliberately first-pass values pending a later
  tuning pass, not final: the `.web-viewport` height (`46vh` with its clamps), pulse-travel speed, powered/
  dormant glow strengths, connector and dormant stroke widths, tooltip sizing, and spec/category card sizing.
  All were eyeballed on the two device checkpoints (Session 25) and marked `TUNABLE` in `RadialWeb.svelte`;
  known, deliberately deferred to a focused tuning pass rather than tweaked blind here. Not a bug.
- The Radial Skill Web node tooltip does not move keyboard focus into the dialog on open, restore focus to
  the originating node on close, or trap Tab within the dialog, so its `aria-modal="true"` overstates the
  actual DOM behavior (Escape-to-close does work). Known, deliberately deferred a11y gap -- already logged
  in SUGGESTIONS.md ("Radial Skill Web tooltip -- focus trap / restore (a11y)") alongside the other Radial
  Skill Web v1 refinements; noted here so it isn't rediscovered as a surprise once the visual pass looks done.
- Ship module/equipment slots are inert (Ships: Stats Foundation, Session 26). `SHIP_TYPES` carries
  `moduleSlots`/`equipmentSlots` and the Docks UI renders module pips, but there is NO module/equipment/
  reactor-core system behind them yet -- they are displayed-but-non-functional this pass. Deliberate: the
  buckets were baked into the data model now so the Research system can wire them later without a data-model
  rewrite, per the forward-compat section of `docs/plans/2026-07-09-ships-stats-foundation-design.md`.
  Research is the intended next feature. Not a bug -- a deliberately-inert forward hook.
- Transit speed is quantized by `ceil()` (Ships: Stats Foundation). `effectiveMissionDef` rescales a
  mission's transit ticks via `Math.ceil(base / transitSpeedMult)`, so a hull's *effective* transit speed
  slightly under-delivers its raw `transitSpeedMult` and varies with the mission's base transit length
  (e.g. a 0.8x hull on a 25-tick transit -> `ceil(25/0.8)` = 32 ticks = ~0.78x effective; on a 70-tick
  transit -> 88 = ~0.795x). Intentional -- integer tick thresholds are load-bearing for the closed-form
  "one big jump equals many small ticks" guarantee -- so this is a balance-tuning fact to account for when
  tuning hull speeds, not a bug.
- Partial-final-extraction-tick risk for FUTURE non-rate-1 missions (Ships: Stats Foundation). The
  extract-phase length is `ceil(cargoCapacity / extractionRatePerTick)`. Today every hull cargo (60/90/180)
  is an integer and every mission's `extractionRatePerTick` is 1, so this always divides evenly and every
  extraction tick delivers a full base amount. A FUTURE mission with `extractionRatePerTick > 1` combined
  with a hull whose cargo isn't a clean multiple of it would introduce a partial final extraction tick --
  revisit `effectiveMissionDef`/`requiredTicksForPhase` (both already carry an in-code comment flagging
  this) when such content is added. Not reachable today; documented so it isn't rediscovered as a surprise.
- FIXED (this branch) -- live-loop `bonuses` + credits divergence from `tick()` (originally surfaced by
  the Ships: Stats Foundation holistic review, Session 26). `App.svelte`'s live `setInterval` poll is a
  SEPARATE copy of the mission-tick math from `tick.ts`'s canonical `tick()` (which only runs on offline
  catch-up + the dev button). Two fields' worth of drift were closed here:
  (1) BONUS-ROLL: the live-loop copy built a 5-field `bonuses` object (common/uncommon yield, uncommon/rare
      chance, rareYield) where `tick()` passes 8 -- it now also includes `bonusRollChance`,
      `bonusRollChanceMult`, and `specBonusRollChance`, so the resourcefulness bonus-roll (Lucky Strike I/II
      + the spec bonus-roll) fires during LIVE play, not only offline catch-up.
  (2) CREDITS: the live-loop copy neither destructured `creditsDelta` from `tickCaptainMission` nor applied
      it -- so mission-cycle credits were awarded ONLY during offline catch-up (`tick()`), never live play.
      The live loop now accumulates `creditsDelta` per captain and applies it once via
      `state.credits.plus(creditsDelta)` (guarded on `> 0`), mirroring `tick()` exactly.
  Both were confirmed pre-existing at the branch base (`38da5ee`), NOT introduced by the ships feature --
  same "live loop drifted from `tick()`" class of bug as the ship-stats gap the ships-feature holistic
  review already fixed (`9fc67a6`, adding the 5th `shipStats` arg to the live loop). What REMAINS open is
  the broader tick-path UNIFICATION refactor (still logged in SUGGESTIONS.md): having the live loop CALL
  `tick()` rather than duplicate its math, so the two paths structurally cannot drift again. Until that
  lands, any new field added to `tick()`'s per-captain handling must be hand-mirrored into this live loop
  -- these two fixes patch the current drift, they do not prevent the next one.
- The Fleet Admiral XP curve `250000 * level^2` (`xpForNextFleetAdminLevel`, `model.ts`) is a DEVICE-TUNED
  STARTING value, not a finished number (Progression Pacing Rework, Session 27). It was rescaled x100 from
  the old `2500 * level^2` to offset the switch to per-tick, per-active-mission FA XP (XP now stacks across
  every captain on a mission, every tick), but the exact factor is the single most playtest-sensitive number
  in this whole rework -- how fast the Fleet Admiral climbs drives the entire progression feel. It MUST be
  calibrated on-device against real multi-captain play; the closed-form tests only guarantee offline==live
  parity at whatever value is set, they say nothing about whether the pace FEELS right. Not a bug -- a
  deliberately-placeholder tuning value flagged so it isn't mistaken for balanced.
- The captain-slot Fleet-Admiral-level walls -- L5 / L25 to unlock slots 3 / 4 (the "wall breaker"
  requirement layered on top of the existing Fleet Logistics talent cost, Session 27) -- are tunable STARTING
  values, not final gates. Slot 2's original L1 wall was a functional no-op (players start at FA level 1, so
  "requires L1" was always already satisfied) and has been REMOVED -- the first captain unlock is now
  intentionally ungated (cost + adjacency only). The L5/L25 walls were picked to space the later slot
  unlocks across early/mid FA progression, but the right levels depend entirely on how the (also-unfinalized)
  FA XP curve above actually paces out in real play. Expect to retune these together with the curve during
  the same on-device calibration pass.
- The live-loop lifetime-stats PARITY test (`tick.test.ts`) replicates App.svelte's live-loop fold rather
  than driving the actual Svelte component (unavoidable -- there is no DOM/component harness in this
  environment). It guards two real things: that `tick()` and the shared lifetime-stats helper agree (no
  `tick()`-vs-shared-helper drift), and that the fold math itself is correct. It does NOT, and cannot, catch
  DELETION of the `foldLifetimeStatsDelta` call site inside App.svelte's live loop -- if that call were
  removed, live-play lifetime stats would silently stop accruing and this test would still pass. Same class
  of gap as the broader two-tick-path divergence risk (see the tick-path UNIFICATION entry above / in
  SUGGESTIONS.md); it resolves for free once the live loop CALLS `tick()` instead of duplicating its math.
- The RadialWeb walled-node SQUARE badge (the `{@const nodeState}` computed inside the node markup,
  `RadialWeb.svelte`) may lag a PURE Fleet-Admiral level-up until the next node-set change -- e.g. leveling
  the FA up enough to satisfy a captain-slot node's level wall, with nothing else changing, might not re-tint
  that node's square until the next reveal/learn re-derives the node set. This is PARITY with the existing
  points-affordability square behavior (the "can you afford this node" tint already had this same reactive
  boundary), not a new regression this feature introduced -- and the node's TOOLTIP (which shows the actual
  requirement text) is fully reactive, so the true state is always one hover away. Worth folding into the
  same reactivity pass whenever the affordability-square staleness is addressed.
- ⚠️ HARD MERGE GATE (Phase 1 -- Facility Framework + Refinery): this branch MUST NOT merge to production
  until `npm run check` (svelte-check) runs clean at home. Every prior branch this project shipped was
  verified by static reading only (no Node/npm/tsc/vitest in this environment), and that was acceptable
  because those were mostly ADDITIVE changes on top of stable code. Phase 1 is different in kind: it is a
  ~163-site keyed-inventory REPLACEMENT refactor (the old `homePlanet.storage` fixed-key union swapped for
  a keyed `inventory` map across model/tick/save/App), the largest replace-not-add change since the Phase 4
  generator-stack removal -- exactly the class of change a real typecheck exists to catch, and exactly the
  class this machine cannot verify. Do NOT treat "reads correctly by eye" as sufficient here. Known items
  already flagged that svelte-check will surface (and that must be triaged, not blindly silenced, at that
  run): (a) an unused `_removedHomePlanet` destructure in `save.ts`'s v17->v18 migration
  (`const { homePlanet: _removedHomePlanet, ...rest } = state;`) -- intentional (it strips the old field
  out of the spread) and underscore-prefixed so it should be lint-exempt, but confirm the project's
  svelte-check config actually honors the underscore convention; and (b) several FROZEN pre-Phase-1
  migrations (`save.ts` MIGRATIONS[7]/[8], the v7->v8 / v8->v9 steps) are annotated `: GameState` yet build
  an intermediate object literal carrying a `homePlanet` field that `GameState` no longer declares -- since
  `homePlanet` was removed from the type in Task 7, those return-type annotations are now loose/excess-property
  mismatches. They are shipped, frozen migration bodies (must NOT be rewritten), so the correct fix is almost
  certainly widening those specific annotations to `: any` (matching how the new v17->v18 step is already
  annotated `17: (state: any): any =>`), NOT touching the migration logic. Decide that at the typecheck, with
  the compiler's actual error text in hand.
- Refinery batch/continuous refine orders are DEFERRED -- Phase 1 shipped ONLY single manual refine jobs
  (`startRefineJob` starts exactly one `refineJob` process per call: one slot, one iteration). The count-N /
  continuous auto-repeat order system (per-iteration atomic deduct, closed-form offline-bulk resolution) was
  split out as the highest-complexity, no-typecheck-risk piece and is fully specced in SUGGESTIONS.md
  ("Refinery batch/continuous refine ORDERS"). It is the biggest closed-form-math risk left in this epic and
  the one most in need of a REAL test run -- do it next, ideally once Node is available so vitest can actually
  exercise the offline-bulk iteration math rather than hand-tracing it.
- All Phase 1 balance values are FIRST-PASS PLACEHOLDERS, to tune at the device checkpoint, not final
  numbers: the refine recipe ratio (commonOre x100 -> refinedMaterial x1) and its 10-tick duration
  (`REFINE_RECIPES`, `model.ts`); the refinery upgrade material costs and durations (commonOre
  100/750/3000/8000 + refinedMaterial 25/75; durationTicks 20/45/90/180, `FACILITIES.refinery`, `model.ts`);
  and the progression gates on the upgrade rungs -- the Fleet-Admiral-level walls (L2 / L5 / L8 for rungs
  2/3/4) plus the `industryHub` Homeworld-talent gate on the top two rungs. All were picked to prove the
  gating mechanics work end-to-end, NOT calibrated against real play -- expect to retune them together with
  the FA XP curve during the same on-device pass (same "device-tuned starting value" posture as the FA curve
  / slot-wall entries above).
- Two "Refinery" surfaces now COEXIST, sharing a name: (1) the OLD Homeworld -> Refinery INSTANT-craft
  sub-tab (`RECIPES` / `craftRecipe` in `model.ts`/`App.svelte` -- click a button, materials convert
  immediately, no time cost), and (2) the NEW Facilities -> Refinery, a timed facility you build/upgrade and
  that runs refine jobs over real ticks. This is DELIBERATE (both paths coexist until the planned Fabricator
  subsumes the instant-craft path), not a bug -- but the shared "Refinery" label across two mechanically
  different surfaces is a real player-confusion risk. Consider renaming or retiring the instant-craft one
  once the Fabricator work makes it redundant, so the name collision doesn't outlive its reason to exist.
- The bottom nav bar now has 7 tabs -- Facilities was inserted as a new 3rd tab, giving the full row
  Homeworld / Sector Space / Facilities / Command / Operations / Battlespace / System (up from 6). Check for
  crowding / label truncation / wrapping on a narrow (phone-portrait) viewport at the device test -- this can
  only be verified in a real renderer, which this environment doesn't have. Not a known break, just an
  unverified layout risk the added tab widens.
