# 0.11.2 "UI Restructure" shell correction design

**Status:** CORRECTION to `2026-07-20-ui-restructure-0.11.2-design.md`. That doc drove the built 0.11.2 shell but omitted four things the user had specified. This doc captures those four, plus the two scoping decisions the user made on 2026-07-21, and is the design the corrected shell builds to. Everything in the 2026-07-20 doc that WAS built correctly (Warehouse Materials/Finished Goods split, Salvage Bay, sub-categories, terminology sweep, the FOUNDRY/DRYDOCK/STORES/CREW programs) STANDS unchanged. This doc only corrects the shell.

**Next step:** a COMPLETE nav mockup (every program, not a slice), user sign-off, then build. Mockup-gate is mandatory this time.

---

## 0. Why this doc exists (the receipts)

The built 0.11.2 shell diverged from what the user specified. Root cause: the 2026-07-20 design doc was authored capturing the storage/salvage/nav-program decisions in detail but silently dropping four shell elements, and the approval mockup showed only nav + Warehouse, so the user approved believing the rest was included. The four elements WERE on record:

- **SESSION_HANDOFF.md line 119:** "a HELP tab + desk-terminal-OS UI restructure as 0.11.1; a Legacy/meta tab (Overview/Achievements/Completion/Leaderboards/Statistics)".
- **SUGGESTIONS.md (Tab Layout Unification entry):** System's rail = a static settings-category nav (Options / Appearance / Save Data / Patch Notes / Debug), "OS/Discord-style left nav", NO locked/earned gating.
- **SUGGESTIONS.md (HELP tab entry, line 47):** a Help manual (Beginner's Tutorial + Systems Encyclopedia), living doc.

This correction is billable session time that a complete mockup would have prevented. The standing rule now: verify the design doc against notes + stated intent before building, and never gate approval on a partial mockup. See memory `feedback_verify_notes_before_build`.

## 1. The four corrections

### 1a. HOME program at the FRONT of the nav (new)

A new program, **first** in the nav order (before CREW). It is the player's landing / meta home. Contents:

- **Overview** (landing): a lightweight dashboard rail entry. Minimal this patch (a welcome / at-a-glance surface); grows later.
- **Help** (LIVE this patch): the core-systems manual from the 2026-07-20 doc section 6 moves HERE, into Home, rather than being a standalone top-level program or a System-rail category. This is a deliberate placement change from the old SUGGESTIONS.md:47 note (which put Help under System); the user's 2026-07-21 direction ("Home should have the new help section") supersedes it. Same content design as before: static `HELP_TOPICS` data table, plain-string render, one section per system.
- **Statistics** (LIVE this patch, per user 2026-07-21): a real panel built from EXISTING save data (playtime, lifetime totals the game already tracks: missions completed, materials gathered, credits earned, ships built, salvage counts, FA/crafting levels, etc.). Built so the numbers it surfaces are the same signals a future achievement engine will read. "Everything that makes sense right now." This is the stats portion only, NOT the achievement system.
- **Achievements / Completion / Leaderboards / Legacy** (RESERVED): locked "coming soon" rail entries, honest signals like the existing locked tabs. These depend on systems that do not exist yet (achievement engine, backend for leaderboards). No engine work this patch.

Rail layout matches the house pattern (left rail + content), same look.

### 1b. SYSTEM as a MODAL opened from the PLAYER PORTRAIT (not a nav program, not a header gear)

**Remove SYSTEM from the top-level nav.** It becomes a **full-screen modal** (a box covering most of the screen) with options segregated into **tabs across the top**, restoring the modal idiom the user expects ("the way it used to pop up").

**Entry point = the player portrait (user decision 2026-07-21).** An earlier idea was a top-right header gear button, but on mobile that button overlaps the exp bar (the header row is cramped). Instead the existing player PORTRAIT in the header becomes the entry point: tapping it opens the modal. The portrait gets a small **gear badge** in a corner as the affordance (so it reads as interactive, preserving the "settings" signal a bare portrait would lose) and a solid crimson border in place of its current decorative dashed one. This clears the header (no element fights the exp bar) and gives the portrait a real purpose. Rationale: Profile (name/portrait) and System (Options/Save Data/etc.) are both "meta / about me and my game," so one consolidated door is cleaner than two; the portrait is a large, familiar mobile tap target (Discord/most mobile games use avatar-as-menu).

**Modal top tabs (Profile leads):**
- **Profile** (NEW, first tab, what the portrait lands on): character name + portrait. Actions (Change Name, Change Portrait) are PLACEHOLDERS this patch (wired later); the tab exists and displays name/level now.
- **Options** (the existing settings/options content, verbatim)
- **Save Data** (export/import/delete save, existing controls)
- **Patch Notes** (existing patch-notes view)
- **Community** (see 1c)
- **Debug** (existing dev/debug tools, same gating as today)
- (**Appearance** only if there is existing theme content to fill it; otherwise omit, do not ship an empty tab. Confirm when reading the current System panel.)

**Modal title:** "System" (working default; the Profile tab makes the profile role self-evident). Trivial to rename.

The modal reuses the existing `.modal-backdrop` / `Panel.modal-dialog` pattern and `focusTrap` (already the codebase idiom: delete-save, import-confirm). No new modal machinery. Opaque background (Brave disables backdrop-filter). NOT locked/gated (always available).

### 1c. COMMUNITY: a Discord button inside the System modal

Per user 2026-07-21: **just a button** whose label/face is an **SVG Discord icon**, opening the Discord **invite link**. Self-contained: no embedded iframe, no external frame loaded into the shell, nothing that can break or phone out. Lives as the **Community** tab (or a clearly-placed control) inside the System gear-modal's About/Community area. The invite URL is a single constant to fill in.

### 1d. BATTLESPACE merged INTO Operations

**Remove BATTLESPACE from the top-level nav.** Its (currently locked/stub) content becomes a **section within OPERATIONS, placed BELOW the missions/dispatch content** (a separated "Battlespace" section under the dispatch surface). Operations already organizes fleet activity by function; combat dispatch belongs with mission dispatch. Content moves verbatim (it is a locked stub today: Skirmishes/Campaign/Exercises/Invasion), only its home changes.

## 2. Resulting top-level nav (after correction)

`HOME` (Overview / Help / Statistics / [reserved: Achievements / Completion / Leaderboards / Legacy]) -> `CREW` -> `OPERATIONS` (Dispatch + Mission Control + Battlespace-below) -> `FOUNDRY` -> `DRYDOCK` -> `STORES` -> `HOMEWORLD`.

Top-level program count goes from the built 7 programs + 2 utilities (SYSTEM, HELP) to **7 programs, zero top-level utilities**: SYSTEM becomes the header gear button, HELP folds into HOME, BATTLESPACE folds into OPERATIONS. This is BETTER for the mobile constraint (fewer top-level entries, section 3b of the 2026-07-20 doc flagged 7+2 as "upper end").

## 3. Scoping decisions (user, 2026-07-21)

1. **Home meta:** build Help + a real Statistics panel now (stats that make sense and would wire into achievements later, not the achievement system). Achievements/Completion/Leaderboards/Legacy reserved.
2. **Community:** a single Discord-invite button with an SVG Discord icon. No embedded widget.

## 4. Anti-Regression and preservation

- **Content moves verbatim** (same discipline as the 2026-07-20 doc section 3c): the Options/Save-Data/Patch-Notes/Debug panels move into the System modal as-is; the Battlespace stub moves into Operations as-is; the Help manual is the same `HELP_TOPICS` design. Only navigation chrome changes.
- **Everything already built and correct in 0.11.2 STANDS**: Warehouse split, Salvage Bay, sub-categories, terminology sweep, FOUNDRY/DRYDOCK/STORES/CREW. Do NOT touch those.
- **EquipmentTooltip unchanged** (hard constraint, carried from 0.11.0).
- **Modal idiom reused**: `.modal-backdrop` + `Panel.modal-dialog` + `focusTrap`, opaque background, no backdrop-filter reliance (Brave).
- **No em dashes, no "--"** in any new/changed string, comment, or doc.
- **Save impact:** still expected NO SAVE_VERSION bump. Statistics reads existing state; the Discord URL and Help topics are static; the gear-modal is UI. Confirm during planning. APP_VERSION stays "0.11.2" (this is completing 0.11.2, not a new version).

## 5. Mockup gate (SATISFIED 2026-07-21)

A COMPLETE mockup (every program, mobile layout, crimson theme, tabs on the BOTTOM, left rail for categories, top subtabs) was iterated to v3 and APPROVED by the user 2026-07-21. Key layout lock learned during this gate: the existing layout is untouchable (bottom nav + left rail + top subtabs); this patch is a rearrange, not a redesign (see memory `project_fleet_admiral_layout_locked`). v3 established the portrait-entry decision (1b). The approved mockup showed: HOME first on the bottom bar with its rail + Statistics; the portrait gear-badge opening the modal on the Profile tab; the Community/Discord tab; Operations with Battlespace below Dispatch.

## 6. Build sequence (for the plan doc)

Each step gated green (npm run check + npm test) before the next, content-verbatim moves:
1. HOME program shell + move Help into it (Help already built, just re-homed).
2. Statistics panel (new, reads existing save state; add tests for the derived stats).
3. System modal with top tabs (Profile / Options / Save Data / Patch Notes / Community / Debug); entry = the player portrait (gear badge + solid border + tap handler); move Options/Save-Data/Patch-Notes/Debug in verbatim; add the placeholder Profile tab; remove SYSTEM from nav.
4. Community Discord button (SVG icon + invite constant) in the modal's Community tab.
5. Merge Battlespace section into Operations (below dispatch); remove BATTLESPACE from nav.
6. Nav-order + mobile pass (7 programs, no top-level utilities); smoke-assert each program renders its expected panels.
7. Patch-note text update; final holistic review; push to staging; user device-test; explicit go before prod.
