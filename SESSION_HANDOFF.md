# Session Handoff — Hyperion Legacy (fleet-admiral)

**Updated:** 2026-07-18, mid 0.11.0 build (very long session). Purpose: let the next session resume with zero context loss. Read this FIRST, then the memory files and the docs it points to.

---

## 0. TL;DR (read this, then the sections you need)

- **Production (crystalisoft.com) is at 0.10.2** (`origin/main` = `8e3b26b`). Stable, public, do NOT touch without explicit user go-ahead.
- **Staging (devpreview.crystalisoft.com) is at `0c19ea2`** = **0.11.0 work-in-progress** (equipment engine, functionally complete through Task 20). The user tests here on their devices. Pushing vetted WIP to staging is standing-authorized; promoting to prod is NOT.
- **0.11.0 = ship equipment (systems) + gear crafting. The ENGINE is done and on staging.** What remains before 0.11.0 can close: (1) two open USER DECISIONS (dead-end ores, crafting-quality source, see Section 6), (2) the version bump + patch notes (Task 23), (3) the holistic branch review + a clean final merge (Task 24). See Section 5.
- Branch: `feat/ship-equipment-0.11.0` (= staging tip `0c19ea2`). `main` is a clean ancestor.
- `SAVE_VERSION` is **28**. `APP_VERSION` is still **"0.10.2"** (bump to 0.11.0 is the deferred Task 23). Tests: **836 passing, 31 files**.
- The user hates losing context across sessions. The memory files + this doc are the safety net. Trust them, but verify any file/line/flag still exists before acting on it.

---

## 1. How this project is run (the workflow the user ALWAYS wants)

See memory `feedback_fleet_admiral_workflow` for the authoritative version. In short, for every feature:

1. **Brainstorm** (superpowers:brainstorming) then a **design doc** then a **plan doc** (superpowers:writing-plans) in `docs/plans/`, then a **branch**, then **subagent-driven-development**: one implementer subagent per task, then a spec-compliance reviewer, then a code-quality reviewer. Even small tasks.
2. **Independently verify subagent claims** before trusting them, especially high-risk seams (parity, data safety, migrations). The controller (you) re-reads the critical code and re-runs gates. The user values this and has seen it catch real bugs (e.g. the Task 20 stat-neutral parity proof, the crash hotfix).
3. After all tasks: a **holistic review** of the whole branch, then a clean final state on **staging**, gate-green, push.
4. **Production is NOT frozen.** Ship vetted work to `origin/staging` (devpreview) freely. Promote to `origin/main` (prod, public) ONLY with fresh explicit user confirmation each time. Keep `main` a clean fast-forward ancestor of `staging` (never commit directly to main).
5. **Branch before building, always.** Gate every task with `npm run check` (expect "COMPLETED ... 0 ERRORS") and `npm test`.
6. Genuine design ambiguity: ask the user (AskUserQuestion), do not let a subagent guess.
7. Deferred ideas go to `SUGGESTIONS.md`, not into current scope.

**Reviewer/subagent prompts must say "static review only, no WebSearch/WebFetch, keep it fast and bounded"** (a review once hung 18 minutes on a network call).

---

## 2. Environment and hard conventions (do not rediscover these)

- **Node:** `node` resolves at `C:\Program Files\nodejs\node.exe` and was on PATH this session (plain `npm run check` / `npm test` / `npm run build` worked). If a shell ever cannot find it, prepend `export PATH="/c/Program Files/nodejs:$PATH"` on the SAME Bash line. Scripts: `npm run check` (svelte-check + tsc), `npm test` (vitest, **836 passing, 31 files**), `npm run build`.
- **This repo lives at `F:\Windows Folders\Documents\fleet-admiral`.** The controller's default Bash cwd and path-less Grep default to the OTHER project (`RPG-Idle-Game`). Always pass explicit `fleet-admiral` paths, or `cd` first.
- **NO EM DASHES and NO "--" as punctuation. Anywhere.** Rendered game text, code strings, code comments, docs, commit messages, and chat replies. Use colons, periods, commas, parentheses. The ONLY legitimate "--" is CSS custom properties (`var(--color-x)`), which are required syntax. See memory `feedback_no_em_dashes`. All of `src/` is punctuation-clean; markdown docs still contain some (sweep on request).
- **Deploy topology:** `origin/main` = production = crystalisoft.com (public). `origin/staging` = devpreview.crystalisoft.com. Vercel auto-builds both.
- **devpreview is behind Vercel authentication.** An automated browser cannot fetch it. Live verification of staging must be done by the USER in their logged-in browser. Local `preview_start` reads launch.json from the OTHER project dir, so it is unreliable here (memory `reference_browser_preview_rooted_primary_dir`).
- **The user tests on mobile (Brave) and PC (Brave).** Brave disables `backdrop-filter` (frosted glass), so never rely on blur for legibility; use opaque or near-opaque backgrounds.

---

## 3. Exact state of the repo right now

- Current branch: `feat/ship-equipment-0.11.0`, tip `0c19ea2`. `origin/staging` == this tip (pushed). `origin/main` (prod) = `8e3b26b` (0.10.2), a clean ancestor.
- `SAVE_VERSION` = **28** (`save.ts`). `APP_VERSION` = **"0.10.2"** (`src/lib/patchNotes.ts`) still, bump is Task 23.
- To ship more vetted 0.11.0 WIP to devpreview: commit on the branch, gate green, `git push origin HEAD:staging` (clean fast-forward). Do NOT touch `main`.

---

## 4. 0.11.0 build state (what EXISTS on the branch)

Design docs: `docs/plans/2026-07-17-ship-equipment-combat-epic-design.md` (the WHOLE vision: equipment + combat + crew + exploration vocabulary), `docs/plans/2026-07-17-equipment-0.11.0-design.md` (the buildable non-combat slice), `docs/plans/2026-07-17-equipment-0.11.0-plan.md` (24-task plan). 0.11.0 ships the equipment slice; 0.12.0 is combat. Each ships as ONE complete patch.

Built and gate-green on the branch (see TaskList / git log for the per-task commits):
- **Model:** `EquipmentInstance` + slot/rarity/ascension enums, 4 LIVE slots (`EQUIPMENT_SLOTS`: cargoBay / ftlDrive / reactorCore / specUtility), `DEFAULT_EQUIPMENT_VARIETY`, the full stat vocabulary (`LIVE_STAT_KEYS` / `RESERVED_STAT_KEYS`), 12 equipment blueprints, `rollCraftedRarity`, `rollQuality`, Crafting Level XP (`craftingLevel` / `craftingXp` / `craftingXpForNext` / `applyCraftingXp`).
- **Item generation:** `src/lib/game/itemgen.ts` (iLevel then budget then ratio-distribution then seeded weighted affix roll). `generateEquipment` for crafted gear; `generateStandardIssue` + `seedStandardIssueForShip` for the baseline (model.ts).
- **Inventory:** quality-bucketed (`Record<string, Decimal[]>`, index = quality tier 0-5), `src/lib/game/inventory.ts` helpers.
- **Fitting:** `src/lib/game/equipment.ts` (`equippedFor`, `fittedInSlot`, `canFitEquipment`, `fitEquipment` atomic-swap, `unfitEquipment` now auto-refits Standard-Issue = never-empty invariant, on-mission lock).
- **Stat fold:** `shipDerivedStats(ship, pieces)` + `equipmentStatMods` in model.ts. Folds equipment into ship stats on BOTH the live and offline paths (parity verified by construction). `plusToPercent` curve.
- **Crafting-real loop:** the Fabricator mints real `EquipmentInstance`s (Task 19), offline/live parity via the shared seeded rng draw order. Research Lab previews equipment blueprints by system name.
- **UI:** `src/lib/ShipSystemsPanel.svelte` (the real player-facing "Ship Systems" install screen: paper-doll ship + slots + stats panel + install/uninstall; labels say "Ship Systems"/"Install", code stays "equipment"). Entry points from Docks + the Fleet Captain Overview. Plus a DEV_MODE-gated equipment harness in App.svelte.
- **Saves:** `SAVE_VERSION` 25 then 26 (inventory bucketing) then 27 (equipment-field backfill, the crash hotfix) then 28 (Standard-Issue seed). Migrations are frozen once shipped to PROD; the 0.11.0 ones are still on-branch (editable).

**Task 20 (last completed):** every ship is born fully fitted with a craft-less Standard-Issue baseline on all 4 live slots (migration seeds existing ships, freshState + ship-build + captain-unlock seed new ones, one shared helper). Baseline gear is **STAT-NEUTRAL this patch** (magnitude 0, mass 0, power 0) so it folds bit-identically to a bare hull and does NOT shift the shipped economy; its magnitude is a single deferred TUNABLE knob (`STANDARD_ISSUE_IMPLICIT_MAGNITUDE`), to be set during the device-check tuning pass. The interim not-yet-migrated guards were retired (crafting XP + equipment pool now read directly and fail loud). Reviewed (spec-compliant, no blockers); review fixes in `0c19ea2`.

---

## 5. What REMAINS to close 0.11.0

1. **Two open user decisions (Section 6) that may add scope.** Neither blocks the engine; both should be settled before the holistic review so the branch is reviewed as it will ship.
2. **Task 23: version bump + patch notes.** `APP_VERSION` to "0.11.0" in `src/lib/patchNotes.ts` + a hand-written `PATCH_NOTES` entry (no markdown processor, no em dashes / "--"). Do this LAST, once scope is final.
3. **Task 24: holistic review + clean final state on staging.** Full gate (`npm run check` 0 errors + `npm test` + `npm run build`). Controller re-verifies the flagged seams (fitting fold-in parity, quality-roll bulk parity, affix-roll offline parity, cargo clamp parity, migration on a real save). Consolidation candidate flagged in the plan: the subtract-and-carry level-up loop is duplicated 3 ways (captain XP, FA XP, crafting XP); consider a shared `foldXpLevelUps` helper, but as a DELIBERATE separately-tested refactor (it touches shipped code), not mid-feature. Also: FA XP uses a blacklist and crafting XP a whitelist in `resolveProcesses`, so a future `TimedProcessKind` inherits FA XP but not crafting XP by default; revisit when the next kind lands.
4. **Prod promotion:** ONLY on explicit user go-ahead.

**HARD PREREQ for 0.12.0 (combat), not 0.11.0:** migrate captain ids to a monotonic counter before any captain-death feature ships.

---

## 6. Open decisions + follow-ups (logged so they are not lost)

**Two decisions waiting on the USER (surfaced, not yet answered):**
- **Dead-end ores.** 10 of 12 raw ores (iridium, ferrite, cobalt, osmium, scrap, circuitry, reactorCore, biomass, resin, spore) have no refine recipe, so they cannot feed crafting. Controller lean: add a small refine-expansion IN 0.11.0 so the loop is not half-connected. Decision: in-patch vs 0.11.1 fast-follow.
- **Crafting-quality source (plan Task 14, the 9c/9d question).** Crafted quality currently ROLLS. Alternative: derive it from the quality of the input materials fed to the Fabricator. Not blocking; a design call.

**Smaller items:**
- `EquipmentInstance` field comment at `model.ts:694` ("Nothing generates, fits, or reads these yet") is now stale (Task 20 generates/fits). Trivial doc fix.
- Per-hull slot availability is NOT wired: the seeder fits all 4 live slots on EVERY hull, even the General Freighter (design gives it only 3, no Spec Utility; `SHIP_TYPES.generalFreighter.equipmentSlots === 0`). Harmless now (stat-neutral, UI shows 4 for all). When per-hull slots get enforced, the seeder must consult a per-hull live-slot list.
- Equipment mints do not tally `lifetimeStats.itemsCrafted` (future nicety).
- `unfitEquipment` on a RESERVED (non-live) slot would throw in `generateStandardIssue` (no default variety) rather than no-op; no current caller touches reserved slots.
- **Pre-existing:** `loadFromLocalStorage` calls `migrate(save)` outside try/catch, so a valid-but-unmigratable save throws out of `onMount` rather than reaching the corrupt-save recovery modal. Good small hardening follow-up.
- **2 pre-existing RadialWeb a11y warnings** (pointer handlers, lines ~792/952) are the only `npm run check` warnings; known, left.
- Markdown docs still contain em dashes (design docs, SUGGESTIONS.md, KNOWN_ISSUES.md). `src/` is clean.

**Bigger future (logged in SUGGESTIONS.md):** 0.12.0 combat, then crew + exploration; an Active-Play / Fleet-Admiral-Flagship 2.0 expansion (far future, "not any time this year"); a HELP tab + desk-terminal-OS UI restructure as 0.11.1; a Legacy/meta tab (Overview/Achievements/Completion/Leaderboards/Statistics); a notification-glow "needs attention" system; Daily Rewards (online-integration-gated). Game name "Hyperion Legacy" is tentative.

---

## 7. Where things live (orientation)

- **Engine:** `src/lib/game/tick.ts` (closed-form timed-process engine + offline `tick()`; the live loop in `App.svelte` calls the SAME `economyTick(_, 1)` per step, which is what makes offline==live parity hold by construction). `src/lib/game/model.ts` (all data + `shipDerivedStats` + equipment defs). `src/lib/game/save.ts` (SAVE_VERSION, migrations, load/save, corrupt handling). `src/lib/game/itemgen.ts`, `inventory.ts`, `equipment.ts` (the 0.11.0 equipment engine). `src/lib/game/allocation.ts` (material free/allocated model).
- **UI:** `src/App.svelte` (the game, huge; legacy Svelte `$:` reactivity, NOT runes). `src/Root.svelte` (router + `.app-shell` + update banner). `src/lib/ShipSystemsPanel.svelte` (equipment install screen). Other `src/lib/` components (Panel, Starfield, RadialWeb, SubTabs, TreeSelector, UpdateBanner, focusTrap).
- **Version/notes:** `src/lib/patchNotes.ts` (`APP_VERSION` + `PATCH_NOTES`; no markdown processor, the string renders exactly).
- **Docs:** `docs/plans/*`. `KNOWN_ISSUES.md`. `SUGGESTIONS.md`. `SESSION_LOG.md`.
- **Memory (auto-loads each session):** `MEMORY.md` index plus `feedback_fleet_admiral_workflow`, `project_fleet_admiral`, `feedback_no_em_dashes`, `feedback_visual_ui_needs_mockup`, `reference_browser_preview_rooted_primary_dir`, `project_fuel_runway_measured_locked`, `user_context`.

---

## 8. Working style the user likes

- Momentum. The user says "continue", "go", "vroom vroom" and wants you to proceed, not stall. But still gate, verify, and confirm before anything outward-facing (prod pushes). Token efficiency matters to them: do not over-build or over-explain.
- Visual/spatial UI is MOCKUP-GATED: show a mockup before building layouts (memory `feedback_visual_ui_needs_mockup`). The inline visualize widget did NOT render for the user; send an HTML file via SendUserFile (display: render) or publish an Artifact.
- Push back with truth when warranted (Intellectual Sparring Partner), and explain tradeoffs, per `CLAUDE.md`.
- The user controls when to start a new conversation. Do not lose their context; that is what this doc is for.
