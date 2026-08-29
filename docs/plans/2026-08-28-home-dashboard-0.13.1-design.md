# Home Mission-Control Dashboard, Design (0.13.1)

Date: 2026-08-28. Status: DESIGN LOCKED (pending build-time detail). Branch: `feat/0.13.1-qol`.
Grounded in: the exploration map (this session) + mockup v2 (artifact `aec49862`, `scratchpad/home-dashboard-mockup.html`).

No em dashes / no "--" as punctuation (project rule): commas, periods, parens, colons only.

---

## 1. Goal + why

The Home "Command Home" screen is a blank placeholder today (`App.svelte:8554-8561`: "Welcome, Admiral... the whole game at a glance. Pick a tab above."). Its own comment reserves it for "at-a-glance readouts... added later." This design fills it with a **mission-control dashboard**: one screen that shows everything happening across the fleet at a glance, flags anything idle that the player could act on, and jumps them straight to the right tab to act.

Why it is the 0.13.1 headline (user call 2026-08-28):
- **New-player onboarding.** A new player's core confusion is "what do I do next." A board that answers it on the home screen (here is what's running, here is what's idle, tap to act) is one of the best onboarding aids a game like this can have.
- **Ease-of-use / sell-peace.** It removes the tab-to-tab hunting to find the one finished/idle thing, and it rewards a genuine breather when there is nothing to do, instead of manufacturing a chore list.

---

## 2. Scope

**MVP (this design):**
- Read-only aggregate status of EVERY timed activity + every captain mission.
- Idle detection that surfaces only ACTIONABLE idle work as a prompt, with a one-tap jump to its setup tab.
- The three idle-resolution states (actionable prompt / idle-but-nothing-available / whole-fleet caught up).
- Locked slots for not-yet-unlocked features (mirrors the game's existing "coming soon" idiom).
- Desktop (two-column) + mobile (single-column) responsive layouts.

**Deferred (fast-follow within 0.13.1 or later):**
- Inline-setup of the single highest-frequency action (e.g. "start next research" without leaving Home). Route-and-launch is v1; inline-setup is a possible follow-on, never a duplicate of a full picker.
- Tuning coexistence with a future chat panel (which may slide up from under the nav buttons and eat vertical space).
- Migrating the SOURCE panels (Operations mission cards, Facilities cards) to a shared row component for strict no-drift (MVP reuses the shared DATA helpers instead, see Section 5).

**Non-goals (hard):**
- NEVER rebuild a setup / picker / config UI on Home. Every actionable item is a shortcut into the existing tab, nothing more (user hard constraint, confirmed 2026-08-28).
- No new gameplay, no economy change, no `SAVE_VERSION` bump. This is a read-only view plus a nav shortcut over existing state.

---

## 3. The two functions

1. **Read-only aggregate status.** Show, compactly, every ongoing activity: captain missions (combat patrol + gathering/extraction), research, all crafting queues (refining, fabrication, ship building), fuel-depot topping-up, AND any facility upgrade, storage/docks expansion, or ship repair in flight. Each as a compact row (icon, what, phase/status, a slim progress bar, and real time-remaining for timed jobs).

2. **Idle detection + shortcut.** Anything idle that the player CAN act on is flagged (an amber "ready for orders" prompt) with a button that jumps to its real build/setup tab. It never rebuilds that UI; it routes to it.

---

## 4. Locked design principles

- **Attention-first hierarchy.** Top: NEEDS YOUR ORDERS (actionable idle). Middle: IN PROGRESS (everything running). Bottom: NOT YET UNLOCKED (locked slots). The dashboard's job is to make "what do I do next" obvious, so idle/actionable sits first and running work is calm status below it.

- **Route-and-launch, never embed.** A prompt jumps to its setup tab (idle captain, tap, land in Operations with dispatch ready). A running row jumps to view that activity. The setup always happens in its one canonical place; Home is a status board + launcher.

- **Honest progress.** Timed jobs (refine / fabricate / research / ship build / upgrades / repairs) show a real `MM:SS remaining` via the existing `remainingReadout` helper (progress = `(durationTicks - remainingTicks) / durationTicks`). Missions have NO whole-clock ETA in the engine (extraction reports per-PHASE time only; patrols report wave/phase only), so missions show phase + wave count + hull/shield, never a fabricated countdown.

- **DRY via shared data helpers.** The dashboard reuses the SAME derivation helpers the source panels use (`remainingReadout` for ETA text, the Facilities dashboard's idle conditions, the mission-label lookups, the availability predicates), so a running job cannot read one way on Home and another on its own panel. (Unifying the row COMPONENTS is a deferred nicety; sharing the data is the MVP guarantee.)

- **Sell-peace tone.** Idle is amber "ready for orders / opportunity" with a soft pulse, NOT a red alarm (red reads as "you're failing"; amber reads as "your move"). When nothing is actionable anywhere, the board says "All caught up, Admiral, enjoy the quiet", a breather the player earned, never an empty box or a nagging chore list. (User accepted amber + caught-up 2026-08-28; revisitable.)

---

## 5. Data foundation (the reusable seam)

**One array holds every timed job:** `state.activeProcesses: TimedProcess[]` (`model.ts:2990`). `TimedProcess` (`model.ts:2182`) = `{ id, kind, remainingTicks, durationTicks, effect, lineId? }`, where `kind: TimedProcessKind` (`model.ts:2092`) is one of `refineJob | facilityUpgrade | fuelRefineJob | researchProject | fabricateJob | shipBuild | equipmentStorageUpgrade | docksExpansion | shipRepair`. So "everything that takes time" is enumerable generically: progress = `(durationTicks - remainingTicks) / durationTicks`, ETA = `remainingReadout(remainingTicks, durationTicks, showTickCounts, state.tickDurationSeconds)`, then branch on `effect.type` (and `kind`) for the label + jump target. This is the single most reusable seam; the dashboard leans on it hard.

**Captain missions** live separately: `state.captains[].mission` (`model.ts`), a discriminated union: `null` (idle), `kind:"extraction"` (gathering, `model.ts:1507`), or `kind:"patrol"` (combat, `model.ts:1572`). Progress is phase/wave based (Section 4, honest progress).

**Derive ONE compact summary model, once, reactively** (perf, Section 10): a single `$: dashboardModel = buildHomeDashboard(state, ...derivedCounts)` that returns:
```
{
  needsOrders: Prompt[],        // actionable idle only
  inProgress:  ActivityRow[],   // every running job + mission
  locked:      LockedSlot[],    // not-yet-unlocked features
  allCaughtUp: boolean,         // true => show the "All caught up" banner instead of prompts
}
```
The UI renders straight from this model; it does not re-scan state per row.

---

## 6. Sections + real content

**NEEDS YOUR ORDERS** (amber prompts, top). One prompt per actionable-idle slot: idle captain (dispatchable), idle research slot (blueprints available), idle refine/fabricate bay (affordable recipe exists), idle shipyard (buildable hull + a free dock). Real status strings already exist in the Facilities dashboard (`App.svelte:4883-5110`), e.g. `"Idle, {n} slot{s} free"`. Each prompt has a jump button (Section 8).

**IN PROGRESS** (compact rows, middle). Every running activity:
- Combat patrol: `{captain.label} vs {faction.name}`, phase (`"Engaging"` etc.), `Waves X / Y`, hull + shield bars.
- Extraction: `{captain.label}, {mission.label}`, phase (`"Extracting"` etc.), `remainingReadout(...) + " in phase"`.
- Research: `Researching, {blueprint.label}`, bar, `MM:SS remaining`.
- Refinery / Fabricator: `{item.label}`, bar, `MM:SS`.
- Shipyard: `Building, {ship.label}`, bar, `MM:SS`.
- Fuel Depot: `Topping up`, `{fuelFillPct}% full` (or "Tank full").
- Facility upgrade / storage / docks expansion: `{facility}, upgrade to Level {n}`, bar, `MM:SS`.
- Ship repair: `Repairing, {ship} hull`, bar, `MM:SS`.

**NOT YET UNLOCKED** (dimmed chips, bottom). Locked features via the existing idiom (Section 8): locked ConsoleTabs (`Crew Equipment`, reserved Achievements/Leaderboards) and not-built/not-founded facilities.

**CAUGHT-UP STATES** (how idle resolves, Section 7).

---

## 7. Idle-resolution logic (the "nothing available" caveat)

The core quality decision (user ask 2026-08-28): the board must never nag toward a dead end. Three outcomes per idle slot:

1. **Idle + something to do** => an amber prompt + jump. Normal case.
2. **Idle + nothing available** (all blueprints researched, no affordable recipe, docks full, no dispatchable mission) => NOT a prompt (a prompt here dead-ends on an empty picker). Instead a calm dim "caught up" note with no button, OR it drops off the Needs-Orders list entirely. (Taste call still open: keep the calm note visible vs hide it. Recommendation: hide from Needs-Orders, so the section only ever holds real actions; the slot still shows its idle status in the In-Progress/status area.)
3. **Nothing actionable anywhere** => the Needs-Orders section renders one satisfying line: "All caught up, Admiral. Every bay's busy and nothing new is available. Enjoy the quiet."

**The new logic this requires:** an `isActionable(slot, state)` predicate per activity, layered on top of the existing `isIdle` conditions:
- Captain: a dispatchable mission exists (fuel present + at least one unlocked mission/patrol the captain can take). Reuse `missionUnlocked` (`App.svelte:7888`) + fuel/dispatch gates.
- Research: an unresearched blueprint with met prerequisites the player can afford. Reuse the research picker's own availability logic (`researchedBlueprints`, prereqs, cost).
- Refinery / Fabricator: at least one recipe whose inputs the player has (affordability). Reuse the recipe pickers' affordability checks.
- Shipyard: an affordable, buildable hull AND `ships.length < shipStorageCapacity` (a free dock).
These predicates are the meatiest new work; each REUSES the availability logic that already exists inside the corresponding setup UI (locate + extract rather than re-derive).

---

## 8. Jump-shortcuts (nav targets)

Nav is a bottom 5-button bar; switching is a plain `activeTab = "<key>"` assignment plus setting the bucket's sub-tab var (there is no central router). From the map, one dispatch per activity:

| Activity | `activeTab` | sub-tab assignments |
|---|---|---|
| Gathering dispatch | `fleetOperations` | `activeOperationsTab = "gathering"` |
| Combat patrol dispatch | `fleetOperations` | `activeOperationsTab = "combat"` |
| Research | `facilities` | `facilitiesView="console"`, `activeFoundryFacility="research"`, `activeResearchSubTab="research"` |
| Refining | `facilities` | `activeFoundryFacility="refinery"`, `activeRefinerySubTab="orders"` |
| Fabrication | `facilities` | `activeFoundryFacility="fabricator"`, `activeFabricatorSubTab="craft"` |
| Ship building | `facilities` | `activeFoundryFacility="shipyard"`, `activeShipyardSubTab="build"` |
| Fuel Depot | `facilities` | `activeFoundryFacility="fuelStorage"` |

Encapsulate as one helper `jumpToActivity(target: JumpTarget)` that performs the assignments, so the dashboard (and any future caller) has a single typed entry point instead of scattering tab pokes.

---

## 9. Component spec (from the mockup)

- **Compact in-progress row:** `icon · primary label (with dim secondary) · [phase chip | status] · [meta] · [right-aligned ETA] · chevron`, over a slim 3px progress bar (or dual hull/shield bars for combat). The whole row is a button (tap to jump-and-view). Hover raises the border.
- **Amber prompt:** soft-pulsing amber dot (respects `prefers-reduced-motion`) · icon · label + amber sub-line · a filled amber "Go / Dispatch / Craft / Start" button.
- **Locked chip:** dashed border, 0.6 opacity, lock glyph + label + "Coming soon" pill.
- **Caught-up banner:** green check + "All caught up, Admiral" + one calm sub-line.
- Palette + type match the game console (dark navy, cyan accent `--color-accent`, amber `--color-warning` for ready, green `--color-success` for caught-up, `--color-danger` reserved). Use the game's own CSS tokens, not literals, so it recolors with the player's theme.

---

## 10. Performance

The board subscribes to a lot (all `activeProcesses` + all captains + slot counts) and updates every tick. To avoid re-rendering the whole panel each tick: compute ONE reactive `dashboardModel` (Section 5) as a pure derivation, and let Svelte diff the rendered lists. Do not attach per-row reactive statements. Keep the model allocation lean (map/filter once). This matters on mobile and once a chat panel shares the viewport.

---

## 11. Deferrals / future

- Inline-setup for the single highest-frequency action (log only; route-and-launch is v1).
- Chat-panel coexistence tuning (the board must shrink/scroll gracefully when a future chat slides up).
- Unifying the source-panel row components with the Home row (strict no-drift); MVP shares the data helpers instead.
- Per-activity richer detail on Home (cargo readouts, wave-by-wave, etc.) if it earns the space.

---

## 12. Locked decisions (summary)

1. Home Overview placeholder becomes the dashboard. No `SAVE_VERSION` bump.
2. Attention-first: Needs Orders (actionable idle) / In Progress (all timed + missions) / Locked.
3. Route-and-launch only; never rebuild a setup UI.
4. Honest progress: MM:SS for timed jobs; phase + waves + hull for missions.
5. Amber "ready" idle tone; "All caught up, Admiral" earned-breather state.
6. Idle surfaces as a prompt ONLY when actionable; idle-but-nothing-available hides from Needs Orders.
7. Enumerate `state.activeProcesses` generically + reuse existing data/availability helpers (DRY by data).
8. One reactive `dashboardModel` derivation for perf.
9. Build MVP-first; inline-setup, chat coexistence, and component unification deferred.
