# Session Log

Two sentences per session: what you worked on, what's next. Ops §8.E.8 —
this is the single highest-value habit for not losing the thread after a
break.

---

**Session 1** — Scaffolded the project (Vite + Svelte + TS), built the
closed-form generator stack (miner → refinery → fabricator), one prestige
tier, versioned save/load with a migration stub, and a dev-gated debug
panel. Verified the closed-form tick property with a unit test and a clean
production build. Next: play it for real, then start on §10.6's first
addition (missions) or push toward the boss-encounter design question
(§5.1) since that's flagged highest priority in the open design doc.

**Session 2** — Renamed the project from working title "Fleet Admiral" to
"Hyperion Legacy" per design doc §8.E.10 (package.json, index.html, README,
both design docs). Confirmed GitHub remote and Vercel preview deployment
are already live. Next: continue building per §10.6 (missions or boss
encounter design, §5.1).

**Session 3** — Added the tick bar: resource production now grants in discrete
lumps on a 10-second cycle (`tickDurationSeconds` on `GameState`, persisted
through saves and prestige) instead of continuous smooth accrual, with a new
UI panel showing cycle progress and time remaining. Next: continue per
§10.6 (missions or the boss-encounter design question, §5.1).

**Session 4** — Redesigned panel styling from rounded rectangles to an
angular, chamfered-corner HUD look (clip-path corners, drop-shadow glow,
corner accent marks) via a new reusable Panel.svelte component used by
every panel in the app, plus a matching smaller-scale treatment on the
tick bar's track; code review caught a rotation/clipping bug in the corner
accents partway through, which was fixed and re-reviewed before moving on.
Options menu, theme switching, and an in-game delete-save option are
explicitly deferred to a follow-up design. Next: get eyes on this in an
actual browser and tune pixel values (chamfer size, glow intensity, corner
accent placement) before considering it finished — the tick bar's fill is
geometrically safe at any width (it's cropped by its already-clipped
parent, not given its own clip-path), so the low-fill-percentage look is
purely an aesthetic gut-check, not a suspected bug.

**Session 5** — Added a player-facing options menu (new always-visible gear
icon, distinct from the relabeled dev-only "Dev" button): 6 selectable
accent-color themes (cyan/green/blue/red/white/gray) via CSS custom
properties and a `data-theme` attribute, backed by a tested `theme.ts`
module and persisted under its own `localStorage` key separate from the
save file so theme survives a delete; and a typed-confirmation ("type
DELETE") modal — the first modal in this codebase — gating the existing
reset-save function for real players. Code review surfaced more than the
plan scoped: 8 hardcoded-cyan CSS rules in App.svelte and 1 in
Panel.svelte's glow filter (all would otherwise not have repainted on
theme switch, fixed by referencing `--color-accent-rgb`), plus two
accessibility gaps — a missing `aria-label` on the icon-only Options gear
button and on the delete-confirm text input. The modal's lack of focus
trapping and Escape-to-close was identified but deliberately not fixed
this pass; logged in KNOWN_ISSUES.md as worth solving once when this
becomes a template for future modals, rather than bolted on under review
pressure for this one (doesn't weaken the typed-confirmation safety gate
either way). 8 tasks in the original plan, 11 commits once review-driven
fixes are counted. Next: get eyes on this in an actual browser — check all
6 themes actually look distinct and readable (especially white/gray
against existing text colors), confirm the delete modal correctly covers
the full viewport rather than being clipped or mispositioned, and manually
click through the "type DELETE" flow end-to-end since it hasn't been
exercised outside of code review.

**Session 6** — Added the Research system (right-sized against the design
doc's fuller §4.8 vision, which assumes Energy/materials/synthesis that
don't exist in this prototype yet): one timed project, Alloy Synthesis
(500 components, 180 game-seconds), unlocking a 4th resource+module tier
(alloys/Synthesizer) that slots into the existing generic MODULES/
RESOURCE_KEY patterns — `tick()`'s production loop needed zero changes to
make alloys accrue once unlocked. Research progresses on the same
game-time clock as everything else (verified with the same "one big jump
equals many small ticks" closed-form test used for resource production),
so it advances correctly through offline catch-up and the dev speed
multiplier rather than needing a separate wall-clock timer. Generator
Stack and Resources both show visible locked placeholders for
Synthesizer/alloys until research completes, per the design doc's
"visible walls are motivating" principle already applied to the panel
redesign. 7 tasks in the original plan, 12 commits once review-driven
fixes are counted — notably a `.resource-grid` CSS fix (still hardcoded
to 3 columns despite `RESOURCE_ORDER` having 4 entries since Task 1,
which is what actually made the 4th, locked alloys card render instead of
wrapping onto its own row) and a defensive clamp on the research progress
bar to `[0,1]`. Next: get eyes on this in an actual browser — start
research, confirm the progress bar advances and completes, confirm
Synthesizer actually becomes buyable and starts producing alloys
afterward, and try the dev panel's offline-simulation buttons to confirm
research also completes correctly across a simulated offline gap.

**Session 7** — Began the Captain/Ship feature (Phase 1 of
docs/plans/2026-07-03-captain-ship-design.md), scoped down from the master
design doc's fuller vision (which assumes augments/mission-spoils/parallel
multi-ship operation that don't exist yet): the single implicit production
pool became an array of independent per-captain stacks (`captains:
CaptainState[]`), each with its own resources/modules/research/tick cadence.
`tick()`'s body was extracted into `tickCaptainStack()`, reused in a loop —
the closed-form invariant (one big jump equals many small ticks) now holds
per captain, verified with a captain exercising modules, research, AND a
specialization simultaneously. Added a two-tier prestige system: Captain
Prestige (per captain, grants Captain Points, lets the player pick one of 3
specializations — Mining/Refining/Fabrication, each a flat +25% to its
resource) and an extended Fleet Prestige (gates on combined lifetime
components across every captain, collapses the whole roster back to the
starting 2). Save schema bumped to v5, migrating the old flat shape into
captains[0] with a fresh captains[1] alongside it. The tick-bar loop in
App.svelte was rewritten to track each captain's cycle independently rather
than one shared cycle. 7 tasks in the original plan, 13 commits once
review-driven fixes are counted — notably a guard against `captainPrestige`
being called with an unmatched `captainId` (plus restoring research-progress
test coverage caught missing in the same pass), and cloning nested fields in
the v4→v5 migration so a captain's resources/modules don't alias the
original save object. Code review also surfaced two pre-existing-but-worth-
noting quirks, now logged in KNOWN_ISSUES.md rather than fixed under review
pressure: the tick-bar poll losing production on a long throttled/
backgrounded-tab gap (predates this branch, confirmed via `git show
94d1801~1`, but now applies per-captain instead of once), and a cosmetic
stale-tick-bar-progress-after-prestige quirk (both prestige tiers reset a
captain's stack but not its `barCycleStart`, self-corrects within one
cycle). Next: get eyes on this in an actual browser — switch between
captain tabs, confirm each captain's stack ticks and produces
independently, run both prestige tiers, confirm the specialization picker
actually boosts the right resource, and confirm a real existing save
migrates cleanly to the 2-captain shape with progress intact. Phase 2 (a
fleet-wide skill tree that makes captain-slot count actually unlockable,
replacing today's fixed 2) is a separate, not-yet-started design.

**Session 8** — HOTFIX: user reported Captain 2 "never improves" on the live
Phase 1 deploy. Root cause: `freshCaptains()` deliberately gave Captain 2 a
totally empty stack (0 modules) to feel distinct from a reset captain, but
every module costs ore and only the Mining Laser produces ore — so a captain
starting at 0 miners has no possible path to ever afford anything, a genuine
softlock, not a balance nitpick. Fixed `freshCaptains()` so both captains
share the same 1-free-miner floor (the same baseline `freshCaptainStack()`
already uses for both prestige tiers), and added a `MIGRATIONS[5]` (v5→v6)
step repairing any already-serialized save with a captain permanently stuck
at 0 miners, since a shipped migration body can't be edited retroactively
(same constraint that shaped the v2→v3 hotfix earlier this project). Safe to
apply unconditionally since there's no "sell modules" mechanic anywhere in
this game — a captain sitting at exactly 0 miners can only be this bug, never
a deliberate player choice. Next: confirm on the live site that Captain 2 is
now buyable/playable, and that an existing affected save gets repaired on
next load.

**Session 9** — Added the Fleet Admiral Skill Tree (Phase 2 of the captain/ship
feature, docs/plans/2026-07-06-skill-tree-design.md): a generic branch/node
skill tree (Command: 3 ranks unlocking captain slots 2/3/4 at increasing
Skill Point cost; Research: 1 node cutting Alloy Synthesis's duration by
25%), earned at 1 Skill Point per Fleet Prestige. Captain-slot count is now
a real, derived, persistent number (`captainSlotCount`) instead of a
hardcoded 2 — fixing the exact gap flagged in KNOWN_ISSUES.md when Phase 1
shipped (now removed from that file): Fleet Prestige rebuilds the roster at
however many slots have actually been earned, and Skill Points/unlocked
nodes survive a Fleet Prestige the same way Augment Points already do. A
brand-new game now starts with just 1 captain — existing saves are
grandfathered via a v6→v7 migration that marks the first Command rank as
already-unlocked so returning players don't lose their existing 2nd captain.
`tickCaptainStack` gained a 4th parameter for research-speed buffs, computed
once per `tick()` the same way the fleet multiplier already is; the
closed-form invariant was re-verified with all four multipliers (fleet/
captain/specialization/research speed) active at once. 5 tasks in the
original plan, 7 commits once review-driven fixes are counted — notably
Task 1 needed an authorized deviation fixing 8 pre-existing
`freshCaptains()` call sites within `model.test.ts` itself (plus 1 new one)
so the whole file stayed internally consistent with the new required `count`
parameter, and Task 3 needed an authorized-by-precedent deviation deleting a
redundant "chained v1→v6 migration" test block, strictly superseded by the
new v1→v7 chained test. Code review also surfaced two forward-looking,
currently-unreachable gaps, deliberately left as in-code comments only
(same "not reachable today but worth knowing" treatment already given to
`MIGRATIONS[2]`/`[3]`, not duplicated into KNOWN_ISSUES.md): `buySkillNode`
computing a new captain id off `captains.length + 1` relies on an unenforced
invariant that `captains.length` always matches `captainSlotCount(state)`,
and `MIGRATIONS[6]` only ever grandfathers `commandRank1`, never rank 2/3,
which is fine since no real pre-v7 save can have more than 2 captains. Next:
get eyes on this in an actual browser — unlock Command rank 1, confirm a new
captain tab appears and is immediately playable (not another softlock),
unlock the Research node and confirm Alloy Synthesis actually completes
sooner, and confirm an existing save keeps its 2nd captain after migrating.
The resourcing/combat/science specialization redesign and "fleet starbase"
navigation ideas raised during this feature's brainstorm remain explicitly
deferred to a future, not-yet-started design.

**Session 10** — Added Home Planet & Mission Expeditions (Phase 3a,
docs/plans/2026-07-06-home-planet-expeditions-plan.md): a fleet-wide
`homePlanet.storage` resource pool fed by sending a captain on one of two
launch missions (`shortOreRun`, `longOreRun`) via a new generic mission
engine — `tickCaptainMission`, a closed-form phase-cycling state machine
(ordersReceived -> transitOut -> extracting -> transitBack -> unloading,
looping until recalled) that advances on the same game-time clock as
production and research, plus a loot table rolled on each unload. Dispatch/
Recall actions and new MISSIONS/HOME PLANET panels were wired into
App.svelte, and a v7->v8 save migration backfills `homePlanet.storage` and
`mission: null` onto existing captains.

The standout story of this feature was Task 2's closed-form correctness
guarantee — "one big tick jump equals many small tick calls summing to the
same total," the same invariant proven for production and research in
earlier phases — which took three independent review rounds to actually
hold, not one:

- Round 1 found the closed-form test itself failing: stepping 400 calls of
  0.1 ticks landed in `transitOut` instead of `extracting`, because summing
  0.1 (non-terminating in binary) drifts to 9.999999999999982 instead of an
  exact 10 at the phase boundary, which a strict `>=` completion check
  missed. Fixed (`bf34ddf`) by snapping tentative post-step progress to the
  exact phase boundary whenever float drift lands within 1e-9.
- Round 2 found that fix was itself incomplete: `phaseProgressTicks` still
  landed at 2.58e-15 instead of exactly 0, because the boundary-snap
  corrected the applied ticks but never corrected `remaining`, so a
  sub-epsilon residue from a phase completing mid-call leaked forward as
  float noise into the next phase's starting progress. Fixed (`1ffd2f1`) by
  clamping `remaining` to exactly 0 once within epsilon, immediately after
  the subtraction.
- The same round separately uncovered a genuine, independent bug in the
  test itself, pre-existing since the state machine's original commit
  (`9dda625`): the stepped-loop line `stepped = tickCaptainMission(0.1,
  stepped, ...)` reassigned `stepped` to the function's full `{ captain,
  homePlanetDelta }` return value instead of unwrapping `.captain`, so every
  call after the first fed a malformed object with no `.mission` field back
  into the next call, and `homePlanetDelta` was never accumulated across the
  400 calls. Neither round 1 nor round 2's own sanity-check work had
  noticed, because both had been independently verifying the fix via their
  own correctly-chained simulations rather than the actual (buggy) test
  code — a bug hiding in the verification harness itself, invisible to
  manual review because the reviewers' own mental/simulated models silently
  "fixed" the same chaining mistake they were checking for. This is a direct
  consequence of Node/npm/tsc being unavailable in this environment: a real
  test runner would have caught the malformed intermediate object on its
  first assertion, instantly. A third review round then re-verified both
  fixes plus the corrected test against 14 existing tests and 3 additional
  stress cases (0.037 x 1000 ticks, randomized chunk sizes summing to 90),
  confirming exact (not approximate) agreement with the single-big-call
  result before moving on.

Task 6 (wiring the new HOME PLANET panel into App.svelte) surfaced one more
real bug while testing the panel against Fleet Prestige: `prestige()` in
tick.ts builds its returned `GameState` as a hand-reconstructed object
literal rather than spreading `...state`, and had never included the new
`homePlanet` field — every Fleet Prestige silently wiped mission-loot
storage, and would have been a TypeScript compile error if a compiler were
available in this environment. Fixed (`7d1384a`) by adding `homePlanet:
state.homePlanet` alongside the literal's existing `skillPoints`/
`unlockedSkillNodes` carry-over lines, since Home Planet storage is
fleet-wide progress meant to survive Fleet Prestige exactly like those two
already do. `captainPrestige` was never affected, since it spreads
`...state` first — the gap was specific to `prestige()`'s
literal-reconstruction style.

7 tasks in the original plan, 11 commits once review-driven fixes are
counted (`d18e866` docs-only follow-up on Task 1; `bf34ddf`/`1ffd2f1` the
two-round Task 2 float-drift saga above; `e291279` removing a ~2% flaky-test
risk from an unmocked-rng loot assertion in Task 3; `7d1384a` the Task 6
prestige fix above). Save schema is now v8. Branch `feat/home-planet-
expeditions` is implementation-complete and locally committed, ready for a
final holistic review — not yet merged or pushed. Next: get eyes on this in
an actual browser — dispatch a captain on each of the two missions, watch a
full phase cycle complete and loot land in Home Planet storage, click
Recall mid-mission and confirm the captain actually returns to base only
after the current cycle's unloading finishes (not immediately), run Fleet
Prestige and confirm `homePlanet.storage` survives it, and confirm an
existing pre-v8 save migrates cleanly with a `null` mission and empty
storage backfilled.

**Session 11** — Added Navigation Restructuring & Progression Overhaul
(Phase 4, docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
replaced the single-column panel layout with a 5-tab bottom navigation shell
(Homeworld / Sector Space / Fleet Ops / Battlespace / System), retired the
entire Generator Stack economy and everything built on top of it (Research,
Specializations, Skill Tree, both Prestige tiers), and replaced it with two
new systems built on the mission-loot economy from Phase 3a: Homeworld
crafting (a `RECIPES` table and `craftRecipe()` feeding two new fleet-wide
structures, Refinery and Fabrication) and captain XP/leveling
(`xpForNextLevel`, `unlockCaptainSlot()`, replacing the Skill Tree's Command
branch as the way new captain slots get earned). Save schema migrated
v8 -> v9, backfilling `xp`/`level`/`statPoints` on every captain and
`refinedMaterial`/`components` on `homePlanet.storage`. New Refinery,
Fabrication, and Captain Leveling panels landed under Homeworld/Fleet Ops,
plus an Export Save button under System. 8 tasks in the original plan, 13
commits once review-driven fixes are counted. `SAVE_VERSION` is now 9.

This was the largest architectural change this project has made: a full
removal of one entire game system and its replacement with two others, not
an addition on top of existing systems. The removal was deliberately split
across 3 separate commits — `model.ts` (`ddf3cfa`), then `tick.ts`
(`f3a330b`), then `App.svelte` (`e15a668`) — specifically because there is
no compiler in this environment to catch a missed reference across files;
the codebase was allowed to sit in a temporarily inconsistent state between
those commits on purpose, the same sequencing discipline that kept Phase 1's
original per-captain refactor safe. That discipline paid off directly: while
removing the dead panels/handlers from `App.svelte` (Task 4), the
implementer found a genuinely dangling call to the already-deleted
`tickCaptainStack` still sitting inside `App.svelte`'s live tick-bar loop —
left in, it would have crashed the app on the very first idle-captain tick
after this branch shipped. Caught and fixed in the same commit, before it
ever reached a runnable state.

A second near-miss ran the opposite way — caught early, fixed late, on
purpose. Building the Homeworld crafting engine (Task 5, `200bc0a`), the
implementer noticed `App.svelte`'s live tick-bar loop rebuilds
`homePlanet.storage` without spreading the existing object first, which
would silently corrupt the new `refinedMaterial`/`components` fields to
`NaN` the moment a player both received mission loot and crafted something
in close succession. At the time nothing called `craftRecipe` from the UI
yet, so the bug was real but inert — flagging and fixing it immediately
would have meant touching UI code out of scope for a model/tick-layer task.
It was deliberately left for Task 8 (`a5ca225`), which fixed the spread
bug FIRST, before adding the crafting UI that would have actually triggered
it — so the feature never had a live-but-broken window. "Flag it now, fix
it when you get there" beat "leave a landmine and hope someone remembers,"
specifically because the fix was scheduled against a known future commit
rather than left as a hope.

A third bug, unrelated to either of the above, surfaced from a much older
task. While implementing the v8->v9 save migration (Task 7), reading
`save.test.ts` in full (this project's standing practice for touching any
file, precisely because there's no compiler to lean on instead) turned up a
pre-existing v4->v5 migration test that had been silently broken since
Task 2 (`ddf3cfa`, all the way back at the start of this same Phase 4
branch): it asserted `modules.miner` and `lifetimeComponents` on a captain
object, both fields Task 2's Generator Stack removal had made nonexistent.
That test had been a latent, runtime-crashing bug for 4 more tasks' worth of
commits, undiscovered simply because nothing had reason to re-read that
specific test file until Task 7 touched `save.ts`/`save.test.ts` again.
Fixed in `5e36995`. This is the same lesson as the crafting-storage bug from
a different angle: a change in one file can silently invalidate assumptions
baked into a completely unrelated file's tests, and in an environment with
no compiler or test runner, the only real defense is deliberately re-reading
full files — not just diffs — at the start of every task that touches them.
That practice is exactly what caught this one.

The highest-risk single task was captain leveling (Task 6, `78b7835`),
which required hooking new XP-awarding logic into `tickCaptainMission()` —
the three-review-round, closed-form, float-drift-tolerant mission state
machine from Phase 3a (see Session 10's entry above for that saga). Both
reviewers for Task 6 independently re-traced the closed-form guarantee (one
big `ticksElapsed` call must equal many small calls summing to the same
result) end-to-end for the new XP logic, and both confirmed it correctly
piggybacks on the function's existing, already-proven cycle-completion
boundary check rather than introducing new, separate bookkeeping that could
desync from it.

The other 5 review-driven commits were smaller: `da9f1ad` (stale comment
referencing a deleted `ResearchState`), `4b9c301` (docs noting orphaned CSS
from the Task 4 panel removal, and flagging the now-stale prestige/tick-bar
entry in this same KNOWN_ISSUES.md that this session's docs pass just
deleted), `118c1f3` (test fixtures updated for `homePlanet.storage`'s
widened type), and `c64cb4c` (fixed two comments citing the wrong task
number for the Generator Stack removal, plus one that incorrectly claimed a
second test block was broken when it wasn't).

Branch `feat/phase4-nav-progression-overhaul` is implementation-complete
and locally committed (13 commits over `dbc437d`), ready for a final
holistic review — not yet merged or pushed. Next: get eyes on this in an
actual browser — click through all 5 tabs, confirm nothing that used to be
reachable is now permanently hidden, dispatch a captain on a mission and
confirm it awards XP/levels correctly on cycle completion (including a big
offline-catchup jump that completes multiple cycles at once), craft both
Refinery and Fabrication recipes and confirm the storage math is right,
unlock a new captain slot and confirm the new captain is immediately
playable, try Export Save, and confirm an existing pre-v9 save migrates
cleanly with captain leveling fields and crafting storage backfilled.

**Session 12** — Added Captain & Homeworld Talent Trees
(docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md): two parallel
talent trees, each 5 branches (3 real, 2 stubs). Captain Talents (per
captain, spent from existing `statPoints`) get real content on Command
(`extractionYieldMult`) and Resourcefulness (`rareLootChanceMult`); Tactical/
Science/Diplomacy are visible-but-empty stub branches. Homeworld Talents
(fleet-wide, spent from a new `adminPoints` pool) get real content on Fleet
Logistics (absorbs the old 3-tier captain-slot-unlock job), Industry
(`recipeBonusOutput`), and Economy (a small `passiveTrickle` of `commonOre`,
explicitly the thinnest branch per the design doc); Homeland Defense/
Citizenry are the other 2 stubs. A new Fleet Admiral leveling system
(`recomputeFleetAdmin`) feeds `adminPoints`, recomputed each `tick()` call and
each live-loop poll from the sum of every captain's current level, on a
curve deliberately much steeper than a captain's own — same closed-form
"resolve every level crossed in one pass" shape already proven for captain
leveling, but structurally simpler here since it recomputes an absolute sum
rather than accumulating a delta. The old `CAPTAIN_SLOT_UNLOCKS`/
`unlockCaptainSlot()` mechanism (Phase 4) was removed in its own dedicated
task, once the new Fleet Logistics branch was proven to do the same job —
same 3-commit-split discipline (model/tick/App.svelte) Phase 4's own big
removal used, so the codebase never carried two competing slot-unlock
systems at once for longer than a task boundary. Save schema migrated
v9 -> v10, backfilling `unlockedCaptainTalents` (empty) on every captain and
`unlockedHomeworldTalents`/`fleetAdminXp`/`fleetAdminLevel`/`adminPoints`
(empty/0/1/0) on `GameState`. New Captain Talents and Homeworld Talents
panels landed under Fleet Ops and Homeworld respectively.

7 tasks in the original plan, 12 commits once review-driven fixes AND one
extra, unplanned design-correction commit are counted. The design correction
(`e61108e`): `HOMEWORLD_TALENTS`'s `unlockCaptainSlot`-effect nodes originally
carried vestigial `atLevel`/`statPointCost`/`componentsCost` fields, copied
over from the old `CAPTAIN_SLOT_UNLOCKS` shape, that `buyHomeworldTalent`
never actually enforced — flagged honestly rather than silently shipped (see
`41de64e`, which surfaced the gap in the same task it was introduced). Rather
than bolting on an ad hoc enforcement path, the user was asked directly and
confirmed the right fix was removal: Homeworld Talents are fleet-wide Fleet
Admiral prestige, gated purely on `adminPoints`, entirely independent of any
individual captain's own level/statPoints — those only ever gate that
captain's own, separate Captain Talents tree. The three dead fields and their
UI/comment scaffolding were removed rather than enforced. Next: get eyes on
this in an actual browser — unlock a Command and a Resourcefulness talent on
a captain and confirm the extraction-yield/rare-loot effects actually apply,
level several captains and confirm the Fleet Admiral bar advances and grants
`adminPoints`, buy a Fleet Logistics slot-unlock node and confirm a new
captain appears immediately, confirm both stub-branch sets (5 total) render
as labeled-but-empty rather than missing entirely, and confirm an existing
pre-v10 save migrates cleanly with all new fields backfilled.

**Session 13** — Added the UI Redesign
(docs/plans/2026-07-07-ui-redesign-plan.md): a mechanics change followed by a
full navigation rebuild. First, `tickDurationSeconds` was collapsed from a
per-captain field to one true fleet-wide cadence on `GameState` — `tick()`
and the live poll loop in `App.svelte` now compute `ticksElapsed` ONCE per
cycle and apply it uniformly to every captain on a mission, replacing the old
per-captain `captainCycles` map with a single shared cycle object. Save
schema migrated v10 -> v11, reading the value off the first captain (every
pre-v11 save had all captains sharing the same cadence already, so this is
lossless) and stripping the now-removed field from each captain via the same
destructure-strip idiom MIGRATIONS[4] used. Then the UI itself: a new global
always-on-top `.top-bar` header (fixed to the top of the viewport) now shows
Fleet Admiral level/XP and the fleet-wide tick bar regardless of which tab is
open, superseding the old per-captain TICK panel entirely. The bottom nav
grew from 5 tabs to 6, splitting the old "Fleet Ops" tab into "Fleet
Captain's" (a left-hand vertical captain list driving Overview/Talents
sub-tabs — relocates the existing CAPTAIN LEVELING/CAPTAIN TALENTS panels
unchanged, plus a new idle/on-mission status line) and "Fleet Operations" (a
mission-first layout: one panel per mission type showing embarked captains
with progress/Recall alongside eligible idle captains with Dispatch buttons,
rather than everything scoped to a single `activeCaptain`) — this required
widening `doDispatchCaptainOnMission`/`doRecallCaptain` to take an explicit
captain id instead of always targeting `activeCaptain`. A new reusable
`<SubTabs>` component (plain callback prop, matching this codebase's existing
no-event-dispatcher convention) now also organizes the Homeworld tab
(Resources / Refinery-Fabrication / Homeworld Talents) and the System tab
(Options / Log / Debug), the last of which absorbed and removed the separate
`devPanelOpen` toggle — the dev debug panel's visibility is now just another
sub-tab selection, dev-mode-gated the same as before.

11 tasks in the original plan, 14 commits (no review-driven code fixes
needed — the 3 extra commits beyond the 11 task commits were all small
in-flight doc/comment wording corrections). Task 11's
final sweep confirmed two CSS rule groups in `App.svelte` are now genuinely
orphaned — `.captain-tabs`/`.captain-tab` (superseded by the new
`.captain-list`/`.captain-list-item`) and `.icon-btn` (its only consumer, the
header's "Dev" toggle button, was removed when `devPanelOpen` folded into the
Debug sub-tab) — both logged in KNOWN_ISSUES.md rather than deleted, same
"leave for a dedicated stylesheet cleanup" treatment as the Phase 4 orphans
already there. Also logged in KNOWN_ISSUES.md: the new `.top-bar` and the
existing `.nav-tabs` are both fixed-position with matching z-index on
opposite viewport edges with no collision detection, a pre-existing exposure
(not a regression) that the new top-bar narrows the safe margin on. The
dev-only loss of being able to view the debug panel simultaneously alongside
Options/Log (now mutually exclusive sub-tabs) was judged too trivial to log —
`DEV_MODE_ENV`-gated, never seen by a player. A copy/UX note from code review
(FLEET CAPTAIN'S and FLEET OPERATIONS sharing a first word at a small,
letter-spaced font size) was logged in SUGGESTIONS.md instead, since it's a
design tweak rather than a bug. Next: get eyes on this in an actual browser —
confirm the top-bar doesn't overlap page content or the bottom nav at
realistic viewport sizes, confirm the fleet-wide tick bar advances correctly
with multiple captains on missions simultaneously, click through both new
tabs' sub-tab switching, and confirm an existing pre-v10 save migrates
cleanly through both the talent-tree (v9->v10) and tick-duration (v10->v11)
backfills in sequence.

**Session 14** — Added Scroll Containment & Locked Placeholders
(docs/plans/2026-07-07-scroll-containment-locked-placeholders-plan.md),
following the user's own hand-drawn mockup. Converted the app shell from
whole-page scroll to a fixed-height flex column: `.root`/`.frame` no longer
scroll at all (with a `100vh`-then-`100dvh` fallback pair, since a bare
`height: 100dvh` would leave `.root` with NO height on a `dvh`-unsupported
browser — a code-quality review caught this before merge). `.top-bar` and
`.nav-tabs` dropped `position: fixed` entirely, becoming normal flex
children; each tab now wraps its actual content in one `.tab-scroll-area`
(`flex:1; min-height:0; overflow-y:auto`) — the ONLY scrollable region, for
every tab. Added a reusable "🔒 Coming Soon!" locked-placeholder pattern:
`SubTabs.svelte` gained a `locked?: boolean` field (native `disabled`
button, grayed, hover tooltip, no click), 2 locked entries appended to every
sub-tab row (Homeworld/Fleet Captain's/System), captain-list slots shown up
to a roadmap cap of 10 (grayed beyond the current real cap of 4, per the
user's own confirmed future-roadmap intent), and Sector Space/Battlespace
restyled to match. Logged in KNOWN_ISSUES.md: captain slots 5-10 have no
real unlock mechanism yet, locked sub-tabs are removed from keyboard tab
order (native `disabled`, mouse-hover-only tooltip discovery), and the
now-stale UI-Redesign-era `.top-bar`/`.nav-tabs` fixed-position collision
entry was corrected to reflect that neither element is `position: fixed`
anymore. Next: get eyes on this in an actual browser to confirm the scroll
genuinely stays contained per tab.

**Session 15** — User reported (with a mockup + a live screenshot
side-by-side) that the shipped UI didn't match expectations: the app was
confined to a narrow ~720px centered column even on a wide desktop monitor,
and Scroll Containment's own Task 1 had made this WORSE by removing the one
thing that used to span the full browser width (`.top-bar`/`.nav-tabs`'s old
`position: fixed` behavior) without flagging how much that would matter.
Root-caused and fixed directly (small, well-understood, no game logic) rather
than via the full brainstorm/plan cycle: `.frame`'s `max-width` raised from
720px to 1400px (wide but capped for readability; mobile unaffected, since
`.frame` has no explicit `width`). `Panel.svelte`'s chamfered clip-path
corner-accent style was retired entirely (swapped `filter: drop-shadow` for
a plain `box-shadow`) in favor of the flat, clean rectangular look the
header/tick-bar and bottom nav already used — this flows to every panel in
the app automatically, since they all share one component. Per further user
request, the standalone "FLEET ADMIRAL" title header panel was retired
outright: the level/XP/tick bar (top) and bottom nav now ARE the header/
footer, and the branding text moved into a new About sub-tab under System,
which also gained a manually-bumped `APP_VERSION` constant and a short
`PATCH_NOTES` list (distinct from `save.ts`'s `SAVE_VERSION`, which tracks
the save schema, not user-visible changes). One real process gap surfaced
while writing this entry: Session 14's own Task 6 never actually wrote its
promised session-log entry (only the KNOWN_ISSUES.md notes landed) and the
review pass for that task didn't catch the omission either — backfilled
above as Session 14, and worth remembering to explicitly verify a docs task
touched EVERY file its own step list named, not just the ones a report
happens to describe. Next: user to confirm the widened layout, flat panel
style, and About tab all look right live; no further code changes pending.

**Session 16** — Several more direct CSS/layout follow-ups from live feedback
on the widened UI (all pushed individually, one commit each): raised
`.frame`'s width-cap from a too-tight 1400px to 2400px, then removed the
pixel-based `max-width` entirely once a user's ultrawide monitor showed the
same "cap becomes the binding constraint" problem happening a second time
at a larger scale (a fixed-pixel ceiling can never scale with an arbitrarily
wide screen, so `width: 100%` alone is the correct fix); made header/footer
span edge-to-edge by moving the frame's horizontal inset onto `.tab-body`
alone; tightened that inset ~30% and added a "Patch Notes" sub-tab separate
from "About." Then wired up the 5 previously-inert Homeworld/Captain Talent
effects (extractionYieldMult, rareLootChanceMult, fleetExtractionYieldMult,
recipeBonusOutput, passiveTrickle) that were purchasable but did nothing --
new helper functions (`captainExtractionYieldMult`, `captainRareLootChanceMult`,
`fleetExtractionYieldMult`) in tick.ts, a `bonuses` parameter added to
`tickCaptainMission`, `craftRecipe` reading `recipeBonusOutput` off
`state.unlockedHomeworldTalents`, and a new passive-trickle accumulation loop
in `tick()`. First review caught that App.svelte's own duplicated live-poll
tick loop (used during actual play, distinct from `tick()` which only runs
for offline catch-up) hadn't been updated to match -- fixed by mirroring the
same bonus/trickle logic there too, confirmed correct by a follow-up review.
Removed the now-stale "5 of 6 talent effects have zero gameplay effect" entry
from KNOWN_ISSUES.md. Next: Ships & Crew system (currently just a `ShipType`
stub with no modules/crew at all) is the agreed-on next big feature, per the
master design doc's committed-systems list.

**Session 17** — Fleet Operations Mission UI (branch feat/fleet-operations-mission-ui,
docs/plans/2026-07-07-fleet-operations-mission-ui-plan.md), built via
subagent-driven-development with two-stage review per task. Replaced the flat
one-Panel-per-mission dispatch list with: a 4-button mission-category list
(only Resource-Gathering real, Patrol/Surveying/Long-Term Exploration locked),
difficulty-tier SubTabs within it (Tier I real, containing both launch
missions via a new `MissionDef.tier` field; Tiers II-V locked), and mission
cards with a theme-aware portrait-frame placeholder. Clicking a mission now
opens a captain-selection popup showing a LIVE drop-rate/timing preview,
computed with the exact same talent-bonus math `tick.ts` uses for the real
mission (extracted `applyRareLootChanceMult` into its own exported function
specifically so the preview and the real roll can't drift apart), before
Dispatch. Also folded in two smaller mid-plan requests: renamed the "Fleet
Operations"/"Fleet Captain's" nav-tab labels to "Operations"/"Command"
(display text only), and expanded Battlespace from one generic placeholder to
4 named locked options (Fleet Skirmishes, Campaign, Fleet Exercises,
Invasion). Two review findings surfaced and were fixed in-branch: an
intermediate task's comment briefly overclaimed a not-yet-built popup as
already wired (corrected once the popup actually landed), and the new popup
shares (and slightly worsens, via missing aria-labels) the delete-save
modal's known focus-trap/Escape gap -- logged in KNOWN_ISSUES.md rather than
fixed here, matching that entry's own "fix both together in one pass" note.
Several detailed future-feature ideas were logged in SUGGESTIONS.md this
session too: selectable background styles, an actual talent-tree visual/
tooltip pass, Battlespace's 4 real modes (Story Campaign fleshed out in
detail -- chapters, tiered I-X difficulty, boss/capital-ship/invasion
chapter-cappers, doubles as a gating tutorial for the other 3 modes), and a
spotlight-style in-game tutorial system. Next: final holistic review of this
branch, then merge and (pending explicit confirmation) push; Ships & Crew
remains the next big feature after that.

**Session 18** — Loot Tier Rework, Talent Split, Import Save (branch
feat/loot-tier-rework, docs/plans/2026-07-07-loot-tier-rework-plan.md).
Reworked mission extraction (`tickCaptainMission` in `tick.ts`) from a single
weighted `MissionDef.lootTable` pick (one tier per tick, mutually exclusive)
to independent per-tier rolls: uncommon and rare material can now BOTH occur
in the same tick, each replacing that many units of common ore rather than
adding on top of it. Worked example from the design doc: base rate 10/tick,
uncommon rolls 2 + rare rolls 1 -> 7 common + 2 uncommon + 1 rare (still 10
total). The new `rollExtractionTick` makes exactly 3 `rng()` calls per tick
in a fixed, documented order (uncommon-occurrence, uncommon-amount-if-
occurred, rare-occurrence) so the closed-form "one big jump equals many small
ticks" guarantee and hand-traced deterministic tests both still hold. Both
launch missions' old lootTable weights converted losslessly to the new
`uncommonChance`/`rareChance` fields (`shortOreRun` 1.9%/0.1%, `longOreRun`
8%/2%, same tuning as before, just expressed independently instead of as
pick-weights).

This forced a split of the 2 existing talent bonus effect types
(`extractionYieldMult`, `rareLootChanceMult`) into 5 tier-specific ones on
Captain Talents (`commonYieldMult`, `uncommonYieldMult`, `uncommonChanceMult`,
`rareChanceMult`) and Homeworld Talents (`rareYieldMult`) — yield mults scale
the amount actually delivered for their own tier (only when that tier occurs
this tick), chance mults scale the occurrence roll itself, both clamped so a
chance can never exceed 100%. All 5 already-shipped nodes were retargeted, not
replaced: Keen Eye I/II (`resourcefulnessRareChanceI/II`) now drive
`uncommonChanceMult`/`rareChanceMult`, and Fleet Requisitions
(`fleetLogisticsYield`) now drives the fleet-wide `rareYieldMult`. The other
two, `commandExtractionI`/`commandExtractionII`, were also renamed from
"Command Efficiency I/II" to "Bulk Extraction"/"Refined Extraction" per a
mid-plan user request — the old pair read as one generic upgrade line even
though they now target two different tiers (common vs. uncommon), unlike Keen
Eye's genuine tier-I/tier-II progression. Only the display `label` changed;
the `CaptainTalentKey` identifiers themselves are untouched internal keys,
same "only rename what's user-facing" precedent as the earlier nav-tab
rename. No new nodes, no cost/prerequisite changes, and every existing
player's `unlockedCaptainTalents`/`unlockedHomeworldTalents` save data carries
forward unaffected (those arrays store keys, not effect shapes).

Also added Import Save, the write-side counterpart to the existing Export
Save: a new `importRawSave()` in `save.ts` validates the file actually
deserializes before writing anything (rejects garbage/corrupt input, leaves
the existing save untouched on failure), writing the raw LZ-compressed-base64
string as-is rather than re-serializing it. The UI is a file input styled as a
button next to Export Save; selecting a file opens a confirmation modal
(reusing the existing `.modal-backdrop`/`Panel.modal-dialog` pattern, plain
Cancel/Import, no typed-safety-word gate since this is a deliberate file pick,
not an irreversible in-place delete) showing an inline error on failure rather
than closing. On confirmed success the page does a full `window.location.reload()`
rather than hot-swapping in-memory state, matching the existing "load happens
once, at mount" pattern.

`APP_VERSION` was reset to `"0.2.0"` to start a disciplined versioning scheme
going forward (Z bumps per fix, Y bumps per feature) — the existing
`0.6.0`-`0.9.0` `PATCH_NOTES` history is left untouched (never rewrite
patch-note history), which deliberately produces a one-time visual oddity
where `0.2.0` (newest) sits above `0.9.0` (older) in the newest-first list.
Flagged to and accepted by the user as an intentional reset marker, not a bug.

Two smaller mid-plan requests were folded in: the Captain Talents panel's
"tactical"/"science" branch headers now display as "Tactician"/"Explorer"
(display label only, via a new `CAPTAIN_TALENT_BRANCH_LABEL` map — the
`CaptainTalentBranch` union keys themselves are unchanged, same precedent as
the extraction-talent rename above); and the top bar was redesigned per the
user's own ASCII mockup, replacing the old stacked full-width layout with a
portrait placeholder (reusing the existing `.mission-portrait-frame` pattern
from the mission cards, no real art yet) beside an inline Fleet Admiral
level/XP row, with a single one-line tick-bar row underneath.

10 tasks in the original plan, 16 commits once review-driven fixes are
counted. This branch's verification was unusually rigorous even by this
project's standard: an independent controller review caught and fixed a
genuine test-flakiness bug in Task 4 (`d2391ed`) — two `tick()`-wiring tests
asserted a deterministic total delivered of 11 using REAL `Math.random()`,
but that total is only exact when neither uncommon nor rare occurs that roll;
with `shortOreRun`'s nonzero `uncommonChance`/`rareChance`, roughly 2% of runs
would have spuriously failed. Fixed by mocking `Math.random` to a fixed 0.5
(fails both occurrence checks) so the assertion is genuinely deterministic,
not merely usually-true. The same review pass also caught a stale identifier
left over from the rename in a Task 5 comment (`abb8117`) — `fleetYieldMult`
where the actual variable is `fleetRareYield` — and, on Task 7, a rejected
`File.text()` promise in the Import Save flow that was previously silently
swallowed (`ec00d34`): if reading the selected file ever rejected, the modal
would simply never open with no feedback at all; now a `.catch()` surfaces
an inline error the same way an invalid save file already does. Two more
non-blocking code-quality refinements landed on Task 8c: a CSS specificity fix (`5678003`)
replacing a source-order-dependent override (`.top-bar-portrait` beating
`.mission-portrait-frame` only because of where it sat in the stylesheet,
protected by two large warning comments) with a `.top-bar-header
.top-bar-portrait` descendant selector that wins on specificity regardless of
ordering; and a deduplicated `$: fleetAdminXpRatio` reactive variable
replacing the same XP-ratio division computed inline twice (bar width,
readout percentage), matching the existing `globalTickProgress`/
`globalTickRemaining` pattern. All fixed and committed as part of this
branch's normal review cycle, not left as follow-up debt. Next: get eyes on
this in an actual browser — dispatch a captain and confirm uncommon/rare can
now both land in the same tick's cargo delta, unlock Bulk Extraction/Refined
Extraction/Keen Eye I-II/Fleet Requisitions and confirm each scales the
correct tier, exercise Export then Import Save end-to-end (including
importing a deliberately corrupted file to confirm the inline-error path),
and confirm the new header layout/labels look right at real viewport sizes.
Final holistic review of this branch is still pending before merge/push.
