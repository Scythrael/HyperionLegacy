# Home Mission-Control Dashboard, Build Plan (0.13.1)

Date: 2026-08-28. Branch: `feat/0.13.1-qol`. Design: `2026-08-28-home-dashboard-0.13.1-design.md`.

Build style: incremental, one concern per unit, each unit gated GREEN before the next:
`npm run check` (0 errors) + `npm test -- --run` (full suite) + `npx vitest run -t "parit"` (parity 101).
No `SAVE_VERSION` bump (read-only view + pure derivations + a nav shortcut). No prod push until the whole dashboard is QA'd; work lands on `feat/0.13.1-qol` -> `staging` (devpreview) for on-device checks.

No em dashes / no "--" as punctuation (project rule).

---

## Unit order (data + logic first, UI last, so the hard parts are unit-tested before any pixels)

### Unit 1: Dashboard model types + the pure builder (skeleton)
- New module `src/lib/game/homeDashboard.ts`. Define the normalized shapes: `ActivityRow`, `Prompt`, `LockedSlot`, `HomeDashboardModel` (`{ needsOrders, inProgress, locked, allCaughtUp }`), and a `JumpTarget` union (the nav destinations from design Section 8).
- Implement `buildHomeDashboard(state, derived)` for the IN-PROGRESS list ONLY first: enumerate `state.activeProcesses` generically (progress + `remainingReadout` inputs + label + jump target by `kind`/`effect.type`) and the two captain-mission arms (patrol: phase + waves + hull/shield; extraction: phase + per-phase readout). Leave `needsOrders`/`locked`/`allCaughtUp` as stubs.
- **Tests:** `homeDashboard.test.ts`, feed synthetic states (one of each `TimedProcessKind` + a patrol + an extraction + idle) and assert the `inProgress` rows (label, progress fraction, jump target, hull/shield for combat). Locks the generic enumeration.
- Gate.

### Unit 2: Idle detection + `isActionable` availability predicates
- In `homeDashboard.ts` (or a sibling), implement per-activity `isIdle` (reuse the Facilities-dashboard conditions, design Section 7) and the NEW `isActionable` predicates: dispatchable captain (fuel + `missionUnlocked`), research (an unresearched, prereq-met, affordable blueprint), refine/fabricate (an affordable recipe), shipyard (affordable buildable hull + a free dock).
- FIRST STEP is location: find where each setup UI already computes "what is available/affordable" and REUSE/extract it (do not re-derive economy math). Cite each source in a comment.
- Fill in `buildHomeDashboard`'s `needsOrders` (idle AND actionable only) + `allCaughtUp` (nothing actionable anywhere).
- **Tests:** assert actionable-idle produces a prompt; idle-but-nothing-available produces NO prompt; everything-idle-or-capped sets `allCaughtUp`. Include the "all blueprints researched" and "docks full" edge cases explicitly.
- Gate.

### Unit 3: Locked slots + the jump dispatcher
- `buildHomeDashboard`'s `locked` list: not-yet-unlocked features via the existing idiom (locked ConsoleTabs like `Crew Equipment`, reserved Achievements/Leaderboards; not-built/not-founded facilities as level-0). Pure.
- `jumpToActivity(target)` helper (in App.svelte, since it sets component-local tab vars): a single typed entry point performing the `activeTab` + sub-tab assignments (design Section 8 table). No behavior beyond the assignments.
- **Tests:** `locked` derivation (pure) unit-tested; `jumpToActivity` is thin UI glue, verified live in Unit 5.
- Gate.

### Unit 4: (verify the model end-to-end, still no Home UI)
- Wire a DEV-only readout or a temporary test that runs `buildHomeDashboard` against a realistic seeded/loaded state and dumps the three lists, to confirm the model is complete and correct against a real save before building pixels. (Can be a throwaway test asserting "a freshly-loaded default state yields the expected starter rows/prompts".)
- Gate. (This unit may fold into Unit 2/3's tests if they already cover a realistic state.)

### Unit 5: The Home Overview dashboard UI
- Replace the placeholder (`App.svelte:8554-8561`) Overview body with the dashboard: NEEDS YOUR ORDERS (amber prompts or the caught-up banner), IN PROGRESS (compact rows), NOT YET UNLOCKED (dimmed chips), rendered straight from `$: dashboardModel = buildHomeDashboard(state, ...)`.
- Components per design Section 9 (compact row = a button that calls `jumpToActivity`; amber prompt with pulse; locked chip; caught-up banner). Use the game's CSS tokens (theme-aware), match the mockup.
- Responsive: two-column In-Progress grid on desktop, single-column on mobile (the mockup's breakpoint). Wide content scrolls within its container; no horizontal body scroll.
- `prefers-reduced-motion` disables the pulse; jump controls are real buttons with aria-labels.
- **Verify:** live in-browser at desktop + mobile viewports (dev server), driving a seeded state through idle/active/caught-up. Confirm jumps land on the right tab.
- Gate.

### Unit 6: Polish + edge states + perf pass
- Edge states: zero captains, nothing running (=> caught-up banner), a facility not built (=> locked/idle, not a broken row), storage-full shipyard (=> not actionable).
- Perf: confirm ONE reactive `dashboardModel` derivation (no per-row reactives); the board is read-only. Spot-check tick churn.
- Copy pass (real, friendly strings; sell-peace tone). No "--"/em dashes.
- Gate.

### Unit 7 (DEFERRED, log only): source-panel row unification
- Migrate Operations mission cards + Facilities cards to the shared row component for strict no-drift. Not required for MVP (Unit 1-6 share the DATA helpers already). Log in SUGGESTIONS.md; do NOT tangle into the MVP.

---

## Testing + QA

- **Unit tests:** Units 1-3 (the pure model, availability predicates, locked derivation) get real assertions in `homeDashboard.test.ts`. This is where correctness lives; the UI is thin.
- **Live verification:** Unit 5-6 driven in-browser (desktop + mobile) on the dev server, plus the on-device pass via devpreview once pushed to staging.
- **QA cadence:** a DELTA QA (per the delta-vs-full rule): the dashboard is a new additive screen, so the sheet covers the dashboard's own behavior (each activity type surfaces correctly; idle vs actionable vs caught-up; every jump lands on the right tab; desktop + mobile) PLUS a regression spot-check that the source panels + nav are untouched. Full QA is reserved for the eventual 0.13.1 launch pass across the whole bundle.

## Definition of done (dashboard)
- Every timed activity + every captain mission appears, live-updating, with honest progress.
- Idle surfaces as a prompt only when actionable; idle-but-nothing-available hides; nothing-actionable-anywhere shows "All caught up, Admiral".
- Every prompt + row jumps to the correct tab.
- Desktop + mobile clean; reduced-motion + aria covered.
- Gates green throughout (check 0 / suite / parity 101); no `SAVE_VERSION` bump.
- Delta-QA passed on devpreview.

## Open taste-calls to confirm with the user before/**during** build (non-blocking)
1. Idle-but-nothing-available: hide from Needs Orders (recommended) vs keep a calm visible "caught up" note.
2. In-Progress ordering/grouping: flat list (mockup) vs grouped by Fleet / Foundry / Drydock. (Default: flat, most-recently-changed or by-type.)
3. Whether Fuel Depot's steady topping-up should always show, or collapse when the tank is full.
