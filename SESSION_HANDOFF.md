# SESSION HANDOFF, Combat 0.13.0 build (as of 2026-07-29)

Authoritative resume doc for a fresh session. Read this + the memory doc, then continue at the REMAINING WORK below.

## TL;DR
- **Branch:** `feat/combat-0.13.0`, tip **`26b03a2`**. Tree clean, all committed.
- **Gate now:** `npm run check` = 0 errors (2 pre-existing RadialWeb a11y warnings, ignore); `npm test` = **1570 passing**.
- **Deploy state:** devpreview (`origin/staging`) = `26b03a2` (the full combat build, live for the user to test). **PROD (`origin/main`) = `e282614` = 0.12.1 + hotfixes, UNTOUCHED.** Combat ships as 0.13.0 only after P14 fold-in + user device-test + explicit go.
- **Done:** the ENTIRE combat epic through the playable, polished COMBAT VIEW (desktop + mobile) + live durability + combat-log OPTIONS. See "What's done" below.
- **Next:** the user is doing mobile VISUAL PASSES on devpreview. Then: **P12c Visual mode** -> **durability tuning** -> **P13 offline summary** -> **P14 fold-in** (ship it).

## Read these first
1. Memory `project_fleet_admiral_combat_0130.md` (phase-by-phase status, every decision + seam; the authoritative running log).
2. `docs/plans/2026-07-22-combat-0.13.0-design.md` (full design, S1..S20) + `-plan.md` (phased plan).
3. `SUGGESTIONS.md` (backlog; several items added this session, see below).

## Hard invariants (do NOT break)
- **Deterministic + seeded + headless.** `resolveBattle(participants, seed, { generateLog }) -> { outcome, log, finalCombatants }` is pure. Same seed => same outcome. RE-RUN the parity suite after any combat change.
- **Offline == live is a HARD invariant.** Two RNG streams: `combat` (outcomes) + `cosmetic` (flavor). Offline skips cosmetic + log; outcome identical. Any new OUTCOME roll draws from `combat`, independent of `generateLog`. Display-only additions (flavor, range/phase, shieldDamage/hullDamage, condition pips) are `generateLog`-GATED and must stay outcome-neutral (parity fuzz proves it).
- **Integer / fixed-point sim math** (NO Decimal in combat; Decimal is only the idle economy). Time in integer deci-seconds; MAX_TICKS=600 (60 rounds).
- **SAVE_VERSION is 33** (B2 durability persistence bumped 32->33 with a backfill migration). Existing saves PRESERVED, never nuked. Any new persisted state bumps + backfills.
- **No em dashes, no "--" as prose punctuation** (CSS `var(--x)` and `// -- section` code dividers are tolerated but the user prefers real punctuation; there is a pending decide-once on the combat/ `// -- Phase N` markers).
- **⚠️ SVELTE REACTIVITY FOOTGUN (caused a hard freeze this session):** NEVER call `tick()` (or await it) inside a reactive `$:`, and add NO reactive `$:` with side effects (DOM writes / scroll / focus). CombatView's derivations return fresh objects every flush => the component is perpetually dirty => a reactive tick() drives Svelte's flush-until-stable into a synchronous infinite loop that hard-freezes the tab. Use `afterUpdate`/`onMount` for post-render DOM work; toggle plain `let` state from click handlers only. Also: no `{@html}` with user-editable text (captain names) = XSS.

## What's DONE (all reviewed + green, all on devpreview)
- **Combat ENGINE, Phases 1-11 + balance + rewards** (deterministic sim, 3 weapon families, disruptions/DoTs, drones, positioning/stance, loot, limp-home + Shipyard repair, captain identity).
- **Patrol dispatch loop + UI** (9b.5*): dispatchable Patrols, Combat Patrols tab under Operations.
- **P12a flavor/log engine** (layered cosmetic pools) + **P12b-1 display-only deterministic replay** (`patrolReplay.ts`; the combat view's data source, parity-locked) + **Unit A** range/band + phase + effect-expiry emission.
- **Live durability (B1 + B2):** weapons/reactor/ftl wear on hits (combat stream), condition effects (weapon offline/degraded, reactor damage mult, ftl evasion/speed), per-system condition pips; cross-wave persistence (SAVE_VERSION 33 + migration) + repair. WARNING: **LATENT at first-pass constants** (base 100 durability rarely reaches the 50% Degraded threshold in the short starter) -> the DURABILITY TUNING call is deferred to the user (bite-now vs S20).
- **Combat view UI (Unit C) + MOBILE layout:** desktop 3-col card arena; mobile compact-row roster + status band + tap-to-expand (`@media max-width:760px`). Log-Guided streaming; Visual mode is a STUB (P12c).
- **Combat-log OPTIONS** (in the System > Options settings modal): `combatLogPreference.ts` localStorage prefs = style (Default flavor / Simplified), damage colors (shield blue / hull orange), speed (fast 1s / slow 5s), auto-scroll. Simplified renderer (`simplifiedLogTokens`). Display-only `shieldDamage`/`hullDamage` on CombatEvent (outcome-neutral) feed the split. Combat panel trimmed to Mode + Close; modal height locked.

## Bugs fixed this session (context)
- **PROD hotfix (shipped to prod 0.12.1, e282614):** SubTabs flex-collapse, ore over-cap clamp + upgrade-affordability, storage-tooltip flicker, all-facility-upgrade popover. (Cherry-picked off origin/main; see the hotfix-workflow memory.)
- **Patrol selector non-reactive** (helper-call hid the reactive dep) -> read the record directly in the `{@const}`.
- **Combat view OPEN-FREEZE** (the reactive-tick() auto-scroll loop above) -> `afterUpdate` hook.
- **dronePips double-count** (refab counted as offline) + rendered em dashes + `--` comment punctuation.

## REMAINING WORK (in order)
1. **User visual passes on devpreview** (in progress): mobile row density; locked-height proportions (desktop / mobile / short viewport); damage-color contrast; Options section spacing. One open UX call flagged: on mobile, whether the TARGET enemy's active status pips show INLINE (currently tap-to-expand only).
2. **DURABILITY TUNING decision** (user's call): durability is wired but latent; decide whether to tune constants so it bites now, or defer to the S20 balance pass.
3. **P12c: Visual mode** (design S16) - the damage-pop presentation over the ships (the currently-stubbed toggle). Reuse the same event stream; family/type-styled damage numbers.
4. **P13: Offline overhaul** - While-You-Were-Away summary (patrols resolved, loot, ships in repair, captain statuses); confirm offline catch-up parity.
5. **P14: Fold-in** - HELP encyclopedia entries, 0.13.0 patch notes, `APP_VERSION` 0.12.1 -> 0.13.0, holistic review vs the design doc, then promote: devpreview -> user device-test -> **explicit prod go** (push feat/combat-0.13.0 content to origin/main).

## Deploy / git model (IMPORTANT)
- **`origin/main` = PROD** (Vercel). **`origin/staging` = devpreview.** Push to staging = `git push --force-with-lease origin feat/combat-0.13.0:staging` (combat branch mirrors devpreview; it is built on prod 0.12.1 + carries the hotfixes, so a force-push loses nothing).
- **Prod is UNTOUCHED and stays 0.12.1 until P14.** Never push combat to origin/main without the user's explicit go.
- WARNING: **VERIFY REMOTE TIPS, not local branch pointers** (local main/staging have been stale before). Always `git fetch` + read `origin/main`/`origin/staging` before any deploy.

## Backlog added this session (SUGGESTIONS.md)
- **Renamable ships** (custom hull names, mirrors captain rename; would enrich the combat view + Simplified log).
- **"Hack the Gibson"** easter-egg encounter + achievement (Hackers reference; gated rare encounter for hack-module ships).
- **Accessibility + theming roadmap:** high-contrast mode + more accessibility options, and **FREE pride themes (Trans, LGBT)** - never paywalled; paid tier = specialty cosmetic layouts (glows/transitions) only. The combat-log options are the first bricks; keep the Options section extensible.
