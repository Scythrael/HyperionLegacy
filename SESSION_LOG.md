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
