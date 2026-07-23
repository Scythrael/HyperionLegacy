# SESSION HANDOFF, Combat 0.13.0 build (as of 2026-07-23)

Authoritative resume doc for a fresh session. Read this + the two combat docs below, then continue at **Phase 9b**.

## TL;DR
- **Branch:** `feat/combat-0.13.0` (tip `b930932`, 38 commits since main). Tree clean.
- **Gate right now:** `npm run check` = 0 errors (2 pre-existing RadialWeb a11y warnings, ignore); `npm test` = 1190 passing.
- **Done:** the ENTIRE combat ENGINE (Phases 1-8) + combat hulls (Phase 9a). Combat is playable via a DEV button today; the real MISSION loop is not built yet.
- **Next:** Phase 9b (playable Patrol missions). Then 10 rewards, 11 loss/repair, 12 UI (MOCKUP-GATED), 13 offline, 14 fold-in.
- **PROD is 0.12.1** (unaffected); combat ships as 0.13.0 later, after user device-test + explicit go.

## Read these first
1. `docs/plans/2026-07-22-combat-0.13.0-design.md`  (the full design, 20 sections S1..S20)
2. `docs/plans/2026-07-22-combat-0.13.0-plan.md`  (the phased plan; Phase 1 detailed, 2-14 outlined, expand each just-in-time)
3. Memory `project_fleet_admiral_combat_0130.md` (phase-by-phase status, every decision + seam)

## Hard invariants (do NOT break)
- **Deterministic + seeded + headless.** `resolveBattle(participants, seed, { generateLog }) -> { outcome, log }` is pure. Same seed => same outcome.
- **Offline == live is a HARD invariant** (parity suite in `src/lib/game/combat/resolveBattle.test.ts`). Two RNG streams: `combat` (outcomes) + `cosmetic` (flavor). Offline skips cosmetic, outcome identical. Every new outcome-roll MUST draw from the `combat` stream, independent of `generateLog`. RE-RUN the parity suite after any combat change.
- **Integer / fixed-point math** in the sim (NO Decimal; Decimal is only the idle economy). Time in integer deci-seconds (dt=1, round=10).
- **No em dashes, no "--" in PROSE / user-facing strings** (CSS `var(--x)` and `// --- section ---` code-comment dividers are fine, they match the existing codebase).
- **SAVE_VERSION is currently 31** (Phase 1 bumped it). Phase 9b+ that add persisted state bump it further with a backfill migration; existing saves are PRESERVED, never nuked.
- **Combat UI (Phase 12) is MOCKUP-GATED**: build an HTML mockup, send it to the user (SendUserFile; inline widgets do not render for this user), get sign-off BEFORE any combat-UI code. User has pre-approved that a mockup is required.

## Workflow
Subagent-driven development (the user's standard): a fresh implementer subagent per coherent unit, gate green + controller-verify the risky seam, commit. SUB-PHASE big phases (drones was 7a/7b; Phase 9 is 9a done + 9b/9c...). Keep the combat memory doc current after each phase (compaction insurance). Give each subagent full context in the prompt (do not make it read the plan). Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **The user drives pace; when they say continue, continue (see feedback memory `feedback_respect_continue_decisions`).**

## What is built (Phases 1-8 + 9a), all in `src/lib/game/combat/` unless noted
- **P1 Captain Identity** (model.ts/tick.ts/save.ts/App.svelte): `nextCaptainId` monotonic counter; `captainName.ts` `validateCaptainName` (client courtesy seam, real mod server-side 0.14.0); `renameCaptain`; live Rename UI. SAVE_VERSION 31.
- **P2 sim core:** `rng.ts` (mulberry32, two streams), `types.ts`, `resolveBattle.ts` (fixed 0.1s loop, round cap + tiebreak, pure). Flagship parity suite.
- **P3 shot pipeline + weapons:** families kinetic/particle/ew + triangle; mitigation shields->attenuation(particle-only)->ablativeArmor->kineticDampening->hull; `weapons.ts` WEAPON_DEFS = the 9 (Plasma/Graviton/Voltaic, Railgun/Autocannon/ConcussionTorpedo, PointDefense/EMP/Tachyon).
- **P4 status effects:** `statusEffects.ts` unified DoT/debuff/buff, the 12-entry disruption table, ranks 1->3, DoT per-tick damage + 1 log line/round, wired to weapon effectSlots.
- **P5 defense/durability/power:** per-family resists (damage + disruption), `durability.ts` (+ systemCondition 4-state), `power.ts` (powerBudget). Renamed reserved stat keys bleedthrough->shieldAttenuation, bleedthroughResist->shieldCoherence.
- **P6 positional:** `positioning.ts` bands Short100/Med200/Long300, stance aggressive/balanced/standoff movement, formal targeting, openers (precharge + longest-range opener), ambush SYMMETRIC (hull-direct + delayed return fire + torpedoes-barred + cloak), counter-module flags. Wired movement/sensor debuffs.
- **P7 drones:** `drones.ts` + `droneDefense.ts`. Roles attack/defense/support, individual-unit tracking, offense; defense interactions (deflect/reflect/smart-reflect PARTICLE-ONLY, meat-shield overflow, attack counter, multi-projectile saturation); replenishment; support kit.
- **P8 rating:** `rating.ts` battleRating (monotonic scalar) + engagementForecast (Monte-Carlo winrate over resolveBattle, 64 samples, advisory).
- **P9a combat hulls:** `SHIP_TYPES` destroyer/battleship/carrier (live combat stats) + `COMBAT_DEFAULT_LOADOUT` (bridge.ts) + `shipToCombatant` builds real combatants (hullType + default loadout, carrier gets a drone squadron).
- **DEV TEST HARNESS:** `bridge.ts` (`shipToCombatant`, `sampleLoadout`), `logFormat.ts` (`formatCombatLog`, `=== Round N ===`), and a dev **"Run Test Battle"** button in App.svelte Debug panel (bridges ships[0] vs a pirate, resolveBattle, renders the log; read-only). This is how combat is testable in-game TODAY. It is NOT the Phase-12 UI.

## PHASE 9b (next): playable Patrol mission loop
Goal: dispatch a Patrol from the game, it runs multi-wave seeded battles, resolves, and you see the result. This BUMPS SAVE_VERSION (careful migration). Sub-phase it; the pieces:
1. **Combat hull gating:** the 3 warships now appear as buildable Shipyard cards with NO tier/research gate (`canBuildShip` tick.ts ~3038 has no gate; Shipyard UI App.svelte ~5585 enumerates all SHIP_TYPES). Add the tier/research gate so warships are earned, not free at start.
2. **Faction data:** a lightweight `Faction` (id/name/flavor) in model.ts; reputation scalar + consequences are DEFERRED (seam only). A few named pirate factions.
3. **Patrol MissionDef(s):** new combat mission type. Card shows "Combat Waves: min-max". Enemy generation deterministic/seeded per encounter (build enemy Combatants from hull + loadout; enemies may bring drones so anti-drone matters).
4. **Wave generator:** min guaranteed via spread catch-up checkpoints, max ceiling, per-tick rolls, stop at max, infamy-talent raises max, deterministic count (design S14). Between waves: shields regen + drones replenish (`replenishDrones`) per tick, hull persists.
5. **Dispatch + resolution:** dispatch a captain + ship + STANCE (pass precharge:true) from Operations; run over the mission timer; at each encounter tick call `resolveBattle` with a seed derived from a persisted master seed + encounter index (so offline==live). Dispatch Once / Dispatch Repeatedly toggle.
6. **SAVE_VERSION bump + migration** for the new mission/combat/faction/master-seed state. Backfill old saves. Extend save.test.ts.
NOTE: 9b can use the P9a DEFAULT loadouts (no weapon/drone CRAFTING yet). Weapons/drone-pods as craftable+fittable EQUIPMENT (Fabricator + hardpoints + hangar bays) is a follow-on sub-phase, not required for a first playable patrol.

## Remaining after 9b
- **Weapons + drone pods as craftable/fittable equipment** (Fabricator mints; weapon hardpoints; hangar bays; installCap/class gates). Replaces default loadouts.
- **P10 rewards:** seeded loot tables, wreck salvage + guaranteed "Damaged [System]" reverse-eng components (Damaged-Reactor-Housing idiom), cargo loot, credit bounty, captain+FA XP. No functional-gear drops.
- **P11 loss/repair:** limp-home 2x, auto-route to Shipyard, repair as timed process, Shipyard Bays shared build/repair (>=1 reserved for repair, idle-build-flex, "waiting for repair" queue).
- **P12 combat UI (MOCKUP-GATED):** portraits + hull/shield bars + square status pips + drone squadron pips + ship-system condition pips + range/band readout + phase narration + Log-Guided (default) & Visual (damage-pops) modes. Under Operations, watch-live on an active patrol. Data-driven LAYERED flavor pools (signature->type->family->generic, cosmetic RNG) replace the dev logFormat. Fix "bleed-through" -> attenuation wording.
- **P13 offline overhaul:** While-You-Were-Away summary (patrols resolved, waves won/lost, loot+bounty, ships in repair, captain status). Offline combat headless (no log gen), identical to live.
- **P14 fold-in:** HELP entries, 0.13.0 patch notes, APP_VERSION 0.13.0, holistic review, then staging -> user device-test -> explicit prod go. Balance-tuning pass (all the flagged S20 numbers) once systems are live.

## Accumulated integration seams (TODO-commented in code, wire during 9b+)
Stance/precharge/ambush set per encounter by the mission layer; module ITEMS granting particleTraceDetector / rapidChargeAfterAmbush / smartReflect / inCombatReplenishPercent; `antiDrone` weapon flag on PointDefense/EMP; between-wave `replenishDrones` call; escortShare targeting (escort missions = fast-follow); durability NOT rolled live yet (wire at integration, re-verify parity); carrier bay count currently in COMBAT_DEFAULT_LOADOUT.builtInBays; per-weapon-type resists (v1 is family-granularity).

## Deferred to later patches (NOT 0.13.0), see design S19 + SUGGESTIONS.md
Escort missions; combat-chance in non-combat missions; player cloaking; specialty weapons (Neutron anti-crew, Ion, Laser, Hyperon, Mass Driver, Breaching Lance, etc.); set-bonus RESOLUTION (hooks: setId, chase affixes like +1 Drone Hangar); weapon+captain proficiency; refit + configurable bay allocation; captain death + crew promotion; escape pods; faction reputation (bounties/law-enforcement incarceration/diplomacy spec); 2.0 interactive turn-based Battlespace + SVG animation; ground combat; away-mission turn-based; **Celestial-class apex = Jupiter-class**.
