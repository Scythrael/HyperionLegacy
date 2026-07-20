# Session Handoff: Hyperion Legacy (fleet-admiral)

**Updated:** 2026-07-18, FEATURE-COMPLETE 0.11.0 BUILT + holistic-reviewed clean + on staging (`dc7027e`), AWAITING the user's device-test then explicit go to promote to prod. Very long session. Read this FIRST, then the memory files and the docs it points to.

---

## 0. TL;DR (read this, then the sections you need)

- **Production (crystalisoft.com) is at 0.10.2** (`origin/main` = `8e3b26b`). Stable, public, do NOT touch without explicit user go-ahead.
- **Staging (devpreview.crystalisoft.com) is at `dc7027e`** = **FEATURE-COMPLETE 0.11.0**, holistic-reviewed clean, on devpreview for the user's device-test. The whole equipment feature: engine + item cleanup + capped/upgradable storage + full salvage + Warehouse legibility UI + iLevel/icons.
- **NEXT ACTION: the user device-tests on devpreview; when happy, they give explicit go and you PROMOTE staging to prod** (`git checkout main; git merge --ff-only feat/ship-equipment-0.11.0; npm run check; git push origin main`). Do NOT promote without that explicit go.
- **What feature-complete 0.11.0 shipped (2026-07-18):** item cleanup (`refinedMaterial` merged to `titaniumIngot`; dead `components` removed; `intactReactorCore` relabeled "Damaged Reactor Housing" + new `salvagedMaterial` category + reserved exotics; `cockpit` slot key renamed `bridge` = "Bridge Module"); capped Ship Systems storage (base 25) with a timed upgrade (25/50/100/200/400); FULL salvage (`salvage.ts`: `salvageEquipment` recycle + `salvageSalvagedMaterial` tiered loot roll, FA-level-gated ceiling, `fleetLogisticsSalvage` talent), all LIVE-ONLY (never in economyTick); Warehouse Ship Systems + Salvaged Materials tabs (tiled, icon + iLevel + rarity) + `EquipmentTooltip.svelte` + slot readouts; `iLevel` field on every item + per-variety icons.
- **Roadmap:** 0.11.0 = above. **0.11.1 = UI restructure** (Quartermaster facility split, material recategorization, salvage-as-own-facility, Help tab, desk-OS lens; captured in `docs/plans/2026-07-18-0.11.1-ui-restructure-notes.md`, this was the user's CONDITION for leaving the tabs in the Warehouse now). 0.11.2 = Material Lines (design done, branch `feat/material-lines-0.11.1`, RENUMBER). 0.12.0 = combat (weapons/shields, per-slot implicits, tooltip weapon rows; HARD PREREQ: captain ids to a monotonic counter first).
- Branch: `feat/ship-equipment-0.11.0` = staging tip `dc7027e`. `main` is a clean ancestor (promotion is a pure ff).
- `SAVE_VERSION` is **30** (v28->v29 item-catalog reconcile + storage-level seed, v29->v30 iLevel backfill). `APP_VERSION` is **"0.11.0"** (patch note expanded for the completion features). Tests: **891 passing, 33 files**.
- The user hates losing context across sessions AND ships feature-complete (no layered releases). The memory files + this doc are the safety net. Trust them, but verify any file/line/flag still exists before acting on it.

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

## 5. NEXT

### 5a. IMMEDIATE: finish 0.11.0 to feature-complete (design LOCKED, BUILD not started)

This is the actual next build. Three committed design docs on branch `feat/ship-equipment-0.11.0` (on top of staging tip `4485f10`, not yet pushed) fully specify it:
- `docs/plans/2026-07-18-ship-systems-legibility-0.11.0-design.md`: names (Titanium Ingot merge, remove dead `components`), Ship Systems visible in the Warehouse, slots show installed system + granted stats, Fabricator labels crafts by real name.
- `docs/plans/2026-07-18-storage-salvage-0.11.0-design.md`: capped + upgradable Ship Systems storage (reuse the material-tab `storageCapMult` rung pattern); equipment recycle-salvage (consume a spare system, return a variable ~30-40% of its recipe inputs); salvaged-material loot salvage (Damaged Reactor Housing = renamed `intactReactorCore` reclassified to a new "salvaged material" category + own Warehouse tab; tiered rarity loot roll reusing the mission-loot machinery, progression-gated ceiling up to Radiant; exclusive salvage items DEFINED + droppable but RESERVED with honest tooltips; ONE FA salvage talent). ALL data changes under ONE migration + a SAVE_VERSION bump.
- `docs/plans/2026-07-18-salvaging-design-notes.md`: the fuller/future salvage vision + BALANCE RULE: salvage supplements, never replaces, missions/refining/fabricating (super-rare refined/component drops; steep top-tier odds). Salvage-feeds-research is a LATER extension.

RESOLVED design calls (build to these): loot tiers map to gear rarity names (standard..radiant + reserved above); exclusive items reserved this patch; one combined FA salvage talent; storage cap base 25 via multiplier rungs. NEXT STEP: writing-plans for this whole scope, then subagent-driven build, gate green, push to staging, USER device-tests, THEN promote 0.11.0 to prod.

### 5b. THEN 0.11.1 = Help + UI/desk-OS restructure. THEN 0.11.2 = "Material Lines" (below; design LOCKED, doc written on branch `feat/material-lines-0.11.1`, RENUMBER to 0.11.2)

The dead-end-ores question grew into a real feature. Current state: crafting is fully playable off just 2 ores (`commonOre` Titanium + `uncommonMaterial` Polysilicate); the other ~10 mission items (from the Lunar Mine / Salvage / Forage runs) have NO refine recipe and no sink. Material Lines gives all 12 mission items a purpose. NOTE: the Damaged Reactor Housing is now handled by 0.11.0 salvage (not reserved by Material Lines), and `refinedMaterial` is merged into `titaniumIngot` by 0.11.0, so the Material Lines doc's references to those need reconciling when it is built.

USER-LOCKED design decisions (2026-07-18):
- **Model: "themed by system."** Each ship system is crafted from its thematically-matched material lines, so every mission supplies different slots and all four missions matter. Structural ores feed holds; heavy metals + a salvaged core feed reactors; electronics/coils feed FTL drives; organics/exotics feed the spec-utility sensor rigs.
- The 4 mission lines get identities: Local Asteroid (structural + electronic spine), Lunar Mine (heavy metals: Ferrite/Cobalt/Osmium), Salvage (recovered tech: Scrap/Circuitry/Reactor Cell), Forage (organic chemistry: Biomass/Resin/Spore).
- **All 12 items get a use OR an honest "not used in any recipe yet, reserved for future" tooltip** (inverse of the existing "no source yet" masking). Bounds scope.
- **The rare salvage item (`intactReactorCore`) is a CRAFTING INGREDIENT, never an installable system, and must be RENAMED** (it collides with the `reactorCore` slot name; e.g. "Derelict Reactor Cell").
- Recipes must be **thematically coherent** ("do these inputs make sense for this system?"); items may be renamed/repurposed to make that true. Multi-input "chemical process" refines (compounds, e.g. resin + wafer to a "photonic gel" for survey sensors) are wanted.
- **Design-critical check:** mission-unlock order == crafting access, so a themed requirement must not wall off a slot the player has no mission for yet. Verify the unlock progression lines up with the recipe requirements before finalizing.
- Reclaimed targets ALREADY exist in ITEMS with broken-promise hints: `reclaimedAlloy` ("Refined from salvage"), `purifiedBiomass` ("Refined from foraged biomass"). No recipe wired yet.

NEXT ACTION: write the 0.11.1 design doc (superpowers:brainstorming is effectively done; go to design doc then writing-plans then subagent-driven build). The concrete recipe rework of the 12 equipment blueprints + the compound refines is the core of it.

**HARD PREREQ for 0.12.0 (combat), not 0.11.x:** migrate captain ids to a monotonic counter before any captain-death feature ships.

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
