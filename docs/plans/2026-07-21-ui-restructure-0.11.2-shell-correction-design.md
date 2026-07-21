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

### 1b. SYSTEM as a header gear-button MODAL (not a nav program)

**Remove SYSTEM from the top-level nav.** Instead, a **gear button in the top-right of the header** opens a **full-screen modal** (a box covering most of the screen), with options segregated into **tabs across the top**. This restores the modal idiom the user expects ("the way it used to pop up"). Tabs (from the SUGGESTIONS.md System-rail list, presented as top tabs in the modal):

- **Options** (the existing settings/options content moves here verbatim)
- **Save Data** (export/import/delete save, the existing controls)
- **Appearance** (if there is existing theme/appearance content; otherwise reserved)
- **Patch Notes** (the existing patch-notes view)
- **Community** (see 1c)
- **Debug** (the existing dev/debug tools, same gating as today)

The modal reuses the existing `.modal-backdrop` / `Panel.modal-dialog` pattern and `focusTrap` (already the codebase idiom for modals: delete-save, import-confirm). No new modal machinery invented. Opaque background (Brave disables backdrop-filter). NOT locked/gated (settings are always available).

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

## 5. Mockup gate (mandatory)

Before any code: ONE mockup depicting the COMPLETE shell, every program, sent as an HTML file (inline widget does not render for this user):
- The 7-program nav with HOME first.
- HOME open, showing its rail (Overview / Help / Statistics / reserved entries) and a sketch of the Statistics panel.
- The header gear button, and the System modal open with its top tabs (Options / Save Data / Appearance / Patch Notes / Community / Debug), including the Community Discord button.
- OPERATIONS open, showing Dispatch with the Battlespace section below it.
User signs off on THIS before build. Partial mockups are not acceptable (that is what caused the redo).

## 6. Build sequence (for the plan doc)

Each step gated green (npm run check + npm test) before the next, content-verbatim moves:
1. HOME program shell + move Help into it (Help already built, just re-homed).
2. Statistics panel (new, reads existing save state; add tests for the derived stats).
3. System header gear-button + modal with top tabs; move Options/Save-Data/Patch-Notes/Debug in verbatim; remove SYSTEM from nav.
4. Community Discord button (SVG icon + invite constant) in the modal.
5. Merge Battlespace section into Operations (below dispatch); remove BATTLESPACE from nav.
6. Nav-order + mobile pass (7 programs, no top-level utilities); smoke-assert each program renders its expected panels.
7. Patch-note text update; final holistic review; push to staging; user device-test; explicit go before prod.
