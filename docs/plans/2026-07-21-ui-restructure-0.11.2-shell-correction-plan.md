# 0.11.2 Shell Correction Implementation Plan

> **For Claude:** Execute task-by-task. This is RELOCATION surgery in `src/App.svelte` (a huge legacy-Svelte `$:` file), NOT a redesign. The UI layout is HARD-LOCKED (bottom nav = top-level tabs, left rail = categories, top subtabs = per-facility; crimson theme via the theme system). Reuse existing classes/components VERBATIM (`.captain-list` / `.captain-list-item` for rails, `Panel`, `.tab-scroll-area`, `.fleet-captains-layout`, the existing modal idiom). Do NOT introduce new visual language, new colors, or new layout patterns. Every moved block moves byte-for-byte; only the navigation chrome around it changes. See `docs/plans/2026-07-21-ui-restructure-0.11.2-shell-correction-design.md` and memory `project_fleet_admiral_layout_locked`.

**Goal:** Correct the built 0.11.2 shell so it matches the approved v3 mockup: a HOME program first on the bottom nav (holding Help + a live Statistics panel + reserved meta), the System tab converted to a modal opened from the player portrait (Profile / Options / Log / Save Data / Patch Notes / Community / Debug top tabs), a Community Discord button, and Battlespace merged into Operations below Dispatch.

**Architecture:** All in `src/App.svelte` plus a new `src/lib/helpTopics.ts` consumer (Help already exists), a new stats-deriving block, and a Discord invite constant. No GameState shape change (expected NO SAVE_VERSION bump). APP_VERSION stays "0.11.2".

**Tech Stack:** Vite + Svelte 5 legacy `$:` reactivity (NOT runes), TypeScript, existing `focusTrap` action, existing `.modal-backdrop`/`Panel` modal idiom.

**Branch:** continue on `feat/ui-restructure-0.11.2` (already checked out).

---

## Pre-flight (read before Task 1)

Read these `App.svelte` regions so you understand current structure (anchors are grep strings, line numbers drift):
- Header/portrait: `class="mission-portrait-frame top-bar-portrait"` (~3264).
- Nav bar buttons: `class="nav-tab"` block (~6740).
- `type TabKey =` (~554) and `let activeTab` (~555).
- Battlespace tab: `{#if activeTab === "battlespace"}` (~6311).
- Help tab: `{#if activeTab === "help"}` (~6339).
- System tab: `{#if activeTab === "system"}` (~6376) through its close, incl. all `activeSystemSubTab` blocks (options / log / debug / about / patchNotes).
- Operations tab: `{#if activeTab === "fleetOperations"}` (~5936) to understand its rail/content so Battlespace can nest below its dispatch content.
- Find the existing modal idiom in-file (search `modal-backdrop` / `focusTrap` / import-save modal) to reuse for the System modal.

Confirm during pre-flight (adjust tasks if reality differs): where Save Data (export/import/delete) currently lives (likely inside the Options block), what the About block contains, and what "Log" shows.

---

### Task 1: HOME program shell + move Help into it

**Files:** Modify `src/App.svelte`.

**Step 1:** Add `"home"` to the `TabKey` union (first). Add state `let activeHomeSection: "overview" | "help" | "statistics" = "overview";` near the other `active*` lets. Change the initial `let activeTab: TabKey` to `"home"` (Home is the landing).

**Step 2:** Add the HOME tab region (mirror the Help/System tab structure exactly: `{#if activeTab === "home"}` + `.tab-scroll-area` + `.fleet-captains-layout` + `.captain-list` rail + `.fleet-captains-content`). Rail items: a group header "HOME" then Overview / Help / Statistics; a group header "LEGACY" then locked `.captain-list-item.locked` items Achievements / Completion / Leaderboards (reuse the exact locked idiom, `🔒` prefix, `title="Coming soon..."`). Use `activeHomeSection` for selection.

**Step 3:** MOVE the Help content VERBATIM: cut the inner content of `{#if activeTab === "help"}` (the `HELP_TOPICS` rail + content) and re-home it as the Home "help" section. Two clean options, pick the least-churn one at build time: (a) render the existing Help layout inside Home's content pane when `activeHomeSection === "help"`, or (b) keep a small nested rail. Simplest: when `activeHomeSection === "help"`, render the existing `HELP_TOPICS` rail+content block unchanged. Preserve `activeHelpTopic`. Do NOT alter `helpTopics.ts` or topic bodies.

**Step 4:** Overview section: a minimal `Panel` with `.panel-title` "OVERVIEW" and a short welcome line (`.prestige-text`). Placeholder, grows later. No new classes.

**Step 5:** Remove the standalone `{#if activeTab === "help"}` tab region (now homed in Home) and the Help `nav-tab` button (Task 6 handles the nav bar; remove the region here).

**Step 6:** `npm run check` (0 errors) + `npm test` (all green). Commit: `feat: add Home program, re-home Help into its rail`.

---

### Task 2: Statistics panel (new, reads existing save state)

**Files:** Modify `src/App.svelte`. Test: extend the existing model/derived test file that covers UI-facing derivations, or add `src/lib/game/statistics.test.ts` if the derivation is extracted.

**Step 1:** Identify which lifetime/career stats the save ALREADY stores (grep GameState + SESSION_HANDOFF): e.g. `fleetAdminLevel`, crafting level/xp, lifetime mission completions counter, materials gathered totals, ships built, salvage counts, credits/adminPoints, play time if tracked. Only surface fields that EXIST. Do not invent counters or add new tracked state this patch (that is a separate feature).

**Step 2:** Add a pure derivation (a `$:` reactive or a small exported helper `deriveStatistics(state)`) producing a display list grouped (Career / Operations / Economy, or whatever the real fields support). Prefer an exported pure function so it is unit-testable.

**Step 3:** Write a failing test asserting the derivation maps a known `GameState` to expected stat rows. Run it (fails). Implement. Run (passes).

**Step 4:** Render the Statistics section in Home (`activeHomeSection === "statistics"`) using existing tokens: `Panel`, `.panel-title`, and a simple stat-row list (reuse an existing row class; if none fits, a minimal scoped class that only sets flex+gap, no new visual language). Optional top subtabs ONLY if the real field count warrants grouping; otherwise one flat list.

**Step 5:** `npm run check` + `npm test`. Commit: `feat: Home Statistics panel from existing save data`.

---

### Task 3: System tab to portrait-opened modal (top tabs)

**Files:** Modify `src/App.svelte`.

**Step 1:** Add state `let systemModalOpen = false;` and keep `activeSystemSubTab` as the modal's active-tab state (extend its union with `"profile"` and `"community"`).

**Step 2:** Make the portrait interactive. At `class="mission-portrait-frame top-bar-portrait"` (~3264): change to a `<button>` (or add role/tabindex + keydown), remove `aria-hidden`, add `aria-label="Open menu"`, `on:click={() => { systemModalOpen = true; activeSystemSubTab = "profile"; }}`. Add a small gear badge element (a `<span>` with the gear glyph) positioned in a corner via a scoped class that only does absolute positioning + the existing crimson tokens (no new palette). Give the portrait its solid crimson border (reuse the token used elsewhere; the dashed style is decorative-only today).

**Step 3:** Convert the System content into a modal. Reuse the in-file modal idiom (`.modal-backdrop` + `Panel` dialog + `focusTrap` + Escape-to-close, exactly as the import/delete-save modals do). Render it `{#if systemModalOpen}`. Inside: a TOP tab bar (the settings categories as horizontal tabs, NOT the left rail) driven by `activeSystemSubTab`. Move the EXISTING per-subtab content blocks (options / log / debug / about / patchNotes) into the modal body VERBATIM. Debug tab stays `{#if DEV_MODE}`-gated exactly as now.

**Step 4:** Add the **Profile** tab (first): a `Panel` showing portrait glyph + `Fleet Admiral · Level {state.fleetAdminLevel}` + two placeholder rows (Name / Portrait) with disabled/stub "Change" buttons (clearly non-functional this patch; no handlers or a no-op with a "coming soon" title). No new state written.

**Step 5:** Remove the `{#if activeTab === "system"}` tab region and (Task 6) its nav button. Remove `"system"` from `TabKey`.

**Step 6:** `npm run check` + `npm test`. Manual: portrait opens modal, Escape/backdrop closes, focus trap works, Debug only in DEV. Commit: `feat: System becomes a portrait-opened modal with top tabs + Profile`.

---

### Task 4: Community tab + Discord button

**Files:** Modify `src/App.svelte`. Add a `DISCORD_INVITE_URL` constant (top of script, with the other constants).

**Step 1:** Decide Community placement: add a **Community** tab to the modal (or, if the existing About block is thin, rename About to "Community" / "About"). Default: a dedicated Community tab after Patch Notes.

**Step 2:** Render the Community body: a `Panel` with a Discord button. The button is a real `<a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">` styled as a button (reuse an existing button class; Discord brand color is allowed as a one-off inline/scoped token since it is a brand mark, keep it self-contained). Inline the Discord SVG glyph (from the mockup) as the icon. No iframe, no embedded widget.

**Step 3:** Set `DISCORD_INVITE_URL` to the real invite (ask user for the exact link; use a clearly-marked placeholder `https://discord.gg/REPLACE_ME` until provided, and flag it before staging).

**Step 4:** `npm run check` + `npm test`. Commit: `feat: Community tab with Discord invite button`.

---

### Task 5: Merge Battlespace into Operations (below Dispatch)

**Files:** Modify `src/App.svelte`.

**Step 1:** Read the Operations tab (`{#if activeTab === "fleetOperations"}`) to find where its dispatch/missions content ends within the content pane.

**Step 2:** MOVE the Battlespace `Panel` block (the `BATTLESPACE` title + `.battlespace-locked-list` with the 4 locked items) VERBATIM to sit BELOW the Operations dispatch content, as a separated section (a divider/heading then the moved Panel). Keep the exact locked-list markup and classes. Per the design (user words: "separated section of Battlespace options below missions"), it is a section in the content, not a new rail item.

**Step 3:** Remove the `{#if activeTab === "battlespace"}` region and (Task 6) its nav button. Remove `"battlespace"` from `TabKey`.

**Step 4:** `npm run check` + `npm test`. Commit: `feat: merge Battlespace into Operations below dispatch`.

---

### Task 6: Nav bar reorder + cleanup + mobile pass

**Files:** Modify `src/App.svelte`.

**Step 1:** In the `nav-tab` block (~6740), the bottom nav becomes exactly, in order: **Home, Crew, Operations, Foundry, Drydock, Stores, Homeworld**. Remove the Battlespace, Help, and System buttons. Add the Home button first.

**Step 2:** Verify no dangling references to removed `activeTab` values ("battlespace" / "help" / "system") anywhere (grep). Verify `TabKey` union now has exactly the 7 programs. Verify default `activeTab === "home"`.

**Step 3:** Mobile check (Brave, narrow): 7 bottom tabs fit/scroll as the existing bar does; the portrait+badge does not overlap the exp bar; modal is full-screen with opaque background (no backdrop-filter reliance).

**Step 4:** `npm run check` + `npm test`. Commit: `feat: bottom nav reorder to 7 programs, remove relocated tabs`.

---

### Task 7: Patch note + version + final review

**Step 1:** Update the 0.11.2 patch note text in `src/lib/patchNotes.ts` to describe the shell as actually shipped (Home program with Help + Statistics; System moved to the portrait menu; Community/Discord; Battlespace under Operations). Honor no-em-dash / no "--". APP_VERSION stays "0.11.2".

**Step 2:** Confirm SAVE_VERSION unchanged (no GameState shape change). If any surfaced state changed, STOP and follow frozen-migration discipline.

**Step 3:** Full `npm run check` (0 errors) + `npm test` (all green). Grep guard: no user-facing "fitment"/"fitted" regressions; no em dashes / "--" in new strings.

**Step 4:** Holistic review of the whole shell correction (spec compliance vs the design doc + code quality). Then push to `staging`, user device-tests on mobile, explicit go before any prod promote. Prod stays at 0.11.1 (`babed10`) until then.

---

## Definition of done

- Bottom nav is exactly Home / Crew / Operations / Foundry / Drydock / Stores / Homeworld.
- Home holds Overview + Help (working) + Statistics (real data) + reserved locked meta.
- Portrait (with gear badge) opens the System modal on the Profile tab; tabs Profile / Options / Log / Save Data(if separate) / Patch Notes / Community / Debug(DEV); Escape+backdrop close; focus-trapped.
- Community tab has a working Discord invite button (real URL), no iframe.
- Battlespace is a section below Operations dispatch; no top-level Battlespace tab.
- No layout/theme redesign anywhere; all moved content byte-identical.
- `npm run check` 0 errors, `npm test` green, no SAVE_VERSION bump, APP_VERSION "0.11.2".
