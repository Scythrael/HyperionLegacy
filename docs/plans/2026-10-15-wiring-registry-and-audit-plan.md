# Everything Wired: the effect registry and full inert-effect audit (0.14.0) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan slice by slice
> (the user's standing workflow: one fresh implementer per slice, two-stage review per slice, holistic review at the
> end, QA sheet to the user, deploy only on the user's word).

**Goal:** Every configured value in Hyperion Legacy, past systems and new, does what its text says, in every context
its text claims, and a test proves it. No placeholders, no "No bonus yet", no dead rolls, no gate that can never open.
A typed registry lists every effect source with the game value it moves and the curve it moves it on; a sensitivity
test per entry turns the source on and asserts the value moves in the right direction by the configured amount; a
completeness test fails the build when a new catalog entry or field is not in the registry. A simulated player then
plays the game headless with and without each choice, and a Debug "Wiring" panel shows every bonus's live
contribution on the current save.

**Architecture:** The registry is pure data plus pure probe functions in `src/lib/game/wiring/` (engine-side, no UI, no
state writes). It grows out of `no-dead-stats.test.ts` (liveness, 149 entries) and adds a second, stricter level
(magnitude and direction at the consumer seam) plus context coverage (catches PARTIAL). Wiring slices then make each
INERT / PARTIAL / UNFED / NO-EFFECT item live, the Ground Operations way: run consumers FROZEN at dispatch onto
optional record fields (absent = today's number), ship-sheet consumers through the existing overlays, goldens captured
BEFORE each engine change.

**Tech stack:** Svelte 5 (legacy mode) + TypeScript, Vitest. Engine in `src/lib/game/*.ts` (pure), UI in
`src/lib/*.svelte` + `src/App.svelte` handlers. Branch `feat/crew-0.14.0`, SAVE_VERSION 69 (G2-1 takes v70).

**Status:** PLAN. Audit done read-only on `6b2b20c` (nine auditors, every claim with file:line). Nothing here is
built. **[PROPOSAL]** marks anything the user has not named or decided. **[PROVISIONAL]** marks a first-pass value
picked so a build stays green while an open call waits; each lives in ONE named constant.

**Sources (authority order: user decisions > design > code):**
- `docs/plans/2026-10-15-wiring-audit-and-safe-first-runs-capture.md` sections 2, 3, 5, 6, 7 (the ruling).
- `docs/plans/2026-10-14-complement-and-acquisition-plan.md` (CP-0 to CP-21, OC-1 to OC-20, the 2026-10-14 talent
  verification).
- `docs/plans/2026-10-02-crew-made-real-e-crew-design.md` D12, D14, D23, D24, D26; E-CREW plan Task 22 / 22b.
- `docs/plans/2026-10-14-field-kits-plan.md` (FK-4 Fear, Iron Will, Cortex Shield; FK-5 to FK-7; open calls 6, 7, 8).
- `docs/plans/2026-10-15-safe-first-runs-plan.md` (SF-0 to SF-7; the 200-seed patrol table, section 2.5 E).
- `docs/plans/2026-10-14-expedition-tiers-g2-plan.md` (G2-0 to G2-9: regions, voyage, reach gate).
- `SUGGESTIONS.md` ~980 (industry branch re-wire), ~1844 to ~1863 (balance harness, named policies, speedrun bench).
- `src/lib/game/no-dead-stats.test.ts` (the base this plan extends).

## 0. Standing rules (inherited; apply to every slice)

- **Gate** after every slice: `npm run check` (0 errors; the 2 known RadialWeb warnings are fine) and `npx vitest run`
  (all files pass).
- **Goldens first:** any slice that changes an engine path captures its golden hashes in a separate, earlier commit
  (the CP-0 / FK-3 / G2-0 / SF-0 pattern). A save that does not own the source being wired is byte-identical in every
  golden.
- **Determinism:** `makeRng((seed ^ SALT ^ key) >>> 0)` only; integer draws; never `Math.random` or `Date.now()` in
  engine code; never a new draw on a shared stream (economy, transport, battle). A chance effect reuses an existing
  roll (a raised threshold) where it can; otherwise it gets its own private salted stream. New salts are odd, distinct,
  exported, and their module joins `salts.test.ts` MODULES. Whole-unit outcomes use the existing `chanceRound`.
- **Freeze at dispatch (D24, GO precedent):** a value that acts on a run (expedition, Ground Ops, patrol cycle) is read
  once at dispatch onto an optional record field; a run dispatched before the slice never gains it. Offline == live
  (one call == 997 s == 1 s) holds for every wired value.
- **Diminishing returns (D23):** stacking bonuses pass `diminishing()` (`diminishing.ts`); never a hard cap. A wiring
  slice that meets an existing cap replaces it (section 2.12, bug B8).
- **Text rules:** US English; no em dashes and no double hyphen anywhere (text, comments, code); "install" is the only
  verb for putting gear on; player-facing text says "objective", never "task"; SVG glyphs only.
- **Shared tree:** other agents work in the same checkout. Stage only your own files by explicit path; never
  `git add -A`; never push.
- **Commits:** one per slice (goldens first, alone), ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **NEW: the registry rule.** From WR-1 on, a slice that adds or changes any effect source updates its registry entry
  in the same commit. A slice that makes a pending entry live flips it to `live` in the same commit (the list cannot
  rot, exactly like `PENDING_IN_RELEASE`).

## 1. The user's words (verbatim; authoritative)

**T1, everything wired (capture section 2):** "Option 2. We're building the foundation and everything should work.
Everything should be wired in and if we have a configured value for everything we build, it wil work. No
placeholders. No non-functional systems. After the tutorial/campaign/quest patch, we're going for balancing/content,
and we will need those to function. We will do bug fixes as needed of course, but we do not want to have to wire up the
foundation as this is the time to be doing that. Let's make sure that everything is working. That every function we've
built in is actually wired in and is doing something. Not just with what we're doing for exploration, but for past
systems as well. If something is not properly wired in and does nothing with or without an initialized and/or assigned
value, then it needs to be wired in."

**The framework request (capture section 5):** "Is there a method/scaffolding/framework you can build that would make
testing for certain things work at a glance for testing? Or would it not be a problem for you to be able to basically
simulate a player playing the game and speccing into things like aplayer normally would, in order to make absolutely
sure that everything we've built so far includes no broken wiring or placeholders that don't actually function. So if
you spec into something that provides 8% to a stat, it provides that 8%. The 8% will change, but the effect of that 8%
will not. The form of how that 8% might change (linear, logarithmic diminishing returns, etc), but the fact that it
impacts the game does not."

**Framework order (capture section 7):** "All three, list first": the bonus registry + per-bonus sensitivity tests
first, then the simulated player, then the Debug "Wiring" panel; the wiring audit uses them.

**Staging (capture section 4):** "But with the mention of making sure wiring is indeed working, we want to ensure that
everything is working." Reading: staging waits for the wiring check to pass.

**Scope moves that bind this plan (capture section 3, T3):** "Move all five (Recommended)": patrol cloak detection,
the Spacer long-haul ramp, the candidate board expansion, graph color options and the antimatter burn move to 0.14.x.
So their registry entries are `deferred` (user-deferred past 0.14.0), not `pending`.

**D23 (design 145 to 148):** "Diminishing returns will 100% come into play, but without removing the entire ability
to push past a certain point."

**Working rule (capture section 6):** "Keep writing all of the things down and keep presenting them until you get
your answers." Section 5 below re-presents every unanswered call.

## 2. The audit

### 2.0 Method and legend

Nine read-only auditors covered every catalog in `src/lib/game` on `6b2b20c`: captain talents; Fleet Admiral,
facilities, research and services; ship hulls, gear, modules, combat and repair; crew, officers and complement (plus
the exact no-dead-stats coverage); away teams and ground effects; expedition content; relics and the Museum; missions,
patrols, factions and transports; salvage and item generation. Each row names where the value is configured, what its
text claims, the game value it should move, and every engine read (file:line; engine = `src/lib/game/**`).

Statuses:
- **LIVE:** an engine read changes an outcome in every context the text claims.
- **PARTIAL:** read in some claimed contexts only (missions but not expeditions; Ground Ops but not legacy; one
  mission type).
- **INERT:** never read outside its catalog and the UI text, or the only reader is unreachable.
- **UI-ONLY:** only display code reads it. Acceptable ONLY for labels, flavor and readouts that claim no effect; a
  UI-ONLY value whose text promises an effect counts as dead (e.g. reactor `powerOutput`).
- **NO-EFFECT:** read and set, but structurally cannot change an outcome (combat range with every ship at position 0).
- **UNFED:** a consumer exists, but nothing ever sets its input (`particleTraceDetector` is hard-coded 0).
- **MISSING:** a claimed attribute with no field at all (hull base sensors).
- **HELD:** deliberately held by a user decision and never rolls (Craft Duplicate, D14).

Counts are AUDIT ROWS. Some rows group many items sharing one reader (all 72 blueprints are one row; all 25
Warehouse T1 rungs are one row), so a count is a measure of distinct wiring questions, not of catalog size. A few
items appear in two systems' tables (the medical bay conditions, crew-module keys); the totals below count each once.

**A key structural finding first:** every expedition dispatched since GO-7b is a Ground Operations run
(`expedition.ts:1203` always stamps `groundOps`). The legacy path runs only for saves with a run already in flight
before GO-7b. An effect read ONLY by the legacy path is therefore effectively dead for new play; this plan counts it
PARTIAL and asks one policy call (OC-G1).

### 2.1 Totals by system and status

| System | LIVE | PARTIAL | INERT | UI-ONLY | NO-EFFECT | UNFED | MISSING | HELD | Not live |
|:-|-:|-:|-:|-:|-:|-:|-:|-:|-:|
| A. Captain (primary, secondary, state) | 15 | 0 | 49 | 0 | 0 | 0 | 0 | 0 | **49** |
| B. Fleet Admiral (Homeworld talents, FA constants) | 16 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | **4** |
| C. Facilities, research, services, items, fuel | 36 | 2 | 9 | 1 | 0 | 0 | 0 | 0 | **11** |
| D. Ship (hull, gear lines, slots, modules, utility, arrays, combat, repair) | 121 | 27 | 26 | 17 | 12 | 12 | 1 | 0 | **78** |
| E. Crew and officers (bonuses, facets, complement, racials, rank, notables) | 57 | 3 | 24 | 0 | 0 | 0 | 0 | 1 | **27** |
| F. Away team and ground (traits, gear effects, stats, gambits, statuses, systems) | 60 | 10 | 30 | 1 | 0 | 0 | 0 | 0 | **40** |
| G. Expedition content (PoIs, planets, tunables, risk, telescope, rewards) | 78 | 6 | 14 | 16 | 0 | 0 | 0 | 0 | **20** |
| H. Relics and the Museum | 25 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | **3** |
| I. Missions, patrols, factions, transports, allocation | 62 | 1 | 3 | 13 | 0 | 0 | 0 | 0 | **4** |
| J. Salvage and item generation | 37 | 5 | 6 | 6 | 0 | 0 | 0 | 0 | **11** |
| **Total** | **507** | **57** | **165** | **55** | **12** | **12** | **1** | **1** | **247** |

"Not live" = PARTIAL + INERT + NO-EFFECT + UNFED + MISSING. UI-ONLY rows that promise an effect (D: reactor
`powerOutput`, `powerDraw`, `powerDrawReduction`; G: `orbitalOnly`) are also work and appear in their tables, but stay
in the UI-ONLY column. Pure labels and
flavor are not counted as work. Of the 247, about 60 already have an owning slice in another plan (CP-2 to CP-5,
CP-8, CP-11, CP-14, FK-4 to FK-7, the Science line swap, E-MOD, G2, SF); the rest are owned by WR slices below.

### 2.2 A. Captain (talents, spec, state)

**LIVE (15):** the 7 primary prospector talents (`model.ts:11544` to `11609`, folded by the six `captain*` reducers
`tick.ts:530` to `617` into `resolvedBonuses` `tick.ts:2183`, read by `rollExtractionTick` `tick.ts:1685`, the bonus
roll `tick.ts:2273`, the Science-cunning rare find `tick.ts:2335`); `CAPTAIN_SPEC_BONUS.resourcefulness`
(`model.ts:11661` -> `tick.ts:607`); `logistics4` Efficient Stowage (`groundOps.ts:154`, `178`, frozen at
`groundOps.ts:210`, Ground Ops reload only); captain level gates (`tick.ts:4831`), statPoints, `BASE_XP_PER_TICK`
(`tick.ts:782` -> `2535`), `xpForNextLevel`, the retirement XP multiplier (`captainRetirement.ts:148` -> `tick.ts:3741`),
secondaryPoints.

Note on the primary talents: the text says "Common Ore yield" (`tick.ts:810`) but the bonus lifts the common tier of
every non-transport mission's own material (a text fix, B24).

**Not live (49):**

| id | configured | claim (UI text) | should move | read today | status | owner |
|:-|:-|:-|:-|:-|:-|:-|
| tacticianHub "Combat Readiness" | model.ts:11620 | "No bonus yet, unlocks this branch" | (none configured; combat exists now) | none; `neighbors: []` | INERT placeholder | WR-6, OC-A40 |
| explorerHub "Survey Doctrine" | model.ts:11632 | same | (none configured; exploration exists now) | none | INERT placeholder | WR-6, OC-A41 |
| spec tactical / science | specCards model.ts:12634, 12645 | "Full talent web arrives when the combat/science system lands" | a spec bonus like resourcefulness | `chooseCaptainSpec` tick.ts:2132 accepts; nothing reads | INERT | WR-6, OC-A42 |
| captain `race` | model.ts:3893 | "racial bonus is a follow-on" (comment) | a captain racial | written at captainRetirement.ts:131 only | INERT | WR-6, OC-A43 |
| gear gates `minCaptainLevel` / `requiresTalent` / `captainSpec` | model.ts:2051 to 2055 | (no slot sets them) | install gate | equipment.ts:450 to 461 (captainSpec only) | INERT seam | WR-4, OC-C4 |
| 44 secondary nodes (all except logistics4) | model.ts:11776 to 12094 | "+X% stat", "5% chance-based bonus (first-pass)", capstone taglines (App.svelte:8877 to 8909), 6 x "No bonus yet (system pending)" | see section 5.A table | none (only tooltip text) | INERT (38 effect claims + 6 placeholders) | WR-5a/b/c |

Secondary tree breakdown (45 nodes, one rank each): 26 statMult (1 LIVE, 25 INERT), 4 procChance (all INERT; UI says
"(first-pass)"), 9 capstones (all INERT, no magnitude configured, an `id` only), 6 `none` placeholders (trade1 to
trade4, fleetOps4, surveySensors4). trade5 and fleetOps5 are capstones of placeholder branches. The `model.ts:11673`
header "DORMANT, nothing applies these" is stale. Save impact: the secondary tree exists on the branch only (main has
no secondary tree), so no production save owns a node.

### 2.3 B. Fleet Admiral (Homeworld talents and constants)

**LIVE (16):** fleetLogisticsHub / Yield (rare yield, `tick.ts:626`), the three captain-slot nodes (`tick.ts:12002`),
the queue-depth nodes (`tick.ts:688`, `697`; all five facility adapters), economyHub / economyTrickle (passive ore,
`tick.ts:4257`), industryBonusOutput (+2 crafted iLevel, `tick.ts:729`), and every FA constant (queue depth, crafting
iLevel per node, `QUALITY_STEP_CHANCE`, FA XP, crafting XP, `SALVAGE_CEILING_THRESHOLDS`, FA walls).

**Not live (4):**

| id | configured | claim | should move | read today | status | owner |
|:-|:-|:-|:-|:-|:-|:-|
| fleetLogisticsSalvage | model.ts:12304 | "+10% recovery, +1 loot tier"; flavor "every wreck and spare hull" | recycle fraction AND hull teardown | salvage.ts:442, 595; `salvageShip` skips it on purpose (salvage.ts:903, 911) | PARTIAL | WR-6, OC-B1 |
| industryHub "Works Directorate" | model.ts:12496 | "No bonus yet" | (text says nothing; it is a hidden gate on Refinery rungs 3 and 4, model.ts:4710, 4720, tick.ts:5884) | gate only | INERT effect (LIVE gate) | WR-6, OC-B2 |
| homelandDefenseHub | model.ts:12452 | "No bonus yet" | no defense system exists | none | INERT placeholder (costs 1 AP) | WR-6, OC-B3 |
| citizenryHub | model.ts:12463 | "No bonus yet" | no population system exists | none | INERT placeholder (costs 1 AP) | WR-6, OC-B3 |

Text fix (B24): the economy tooltip shows the raw key "commonOre" (`tick.ts:848`), not "Titanium Ore".

### 2.4 C. Facilities, research, services, items, fuel

**LIVE (36):** Refinery slots and speed (`tick.ts:6309`, `6352`), Warehouse T1 (25 rungs, `tick.ts:7588`), Research Lab
slots and tier gate (`tick.ts:6420`, `7319`), Fabricator slots (`tick.ts:6442`), Shipyard founding, build speed, bays
(`tick.ts:6944`, `6505`), `SHIPYARD_BAY_BASE`, `BUILD_CONCURRENCY_CAP`, repair ticks (`model.ts:1628`), Salvage Bay lanes
(`tick.ts:6602`), Subspace Telescope levels (information only, by design; `telescope.ts:166`), storage / docks / berth
rungs (`model.ts:10754`, `tick.ts:11664`, `berths.ts:104`), FA and talent rung gates (`tick.ts:5879`, `5884`), Armory
loadout cap (`armory.ts:44`), medical bay health / poison / bleed / downed cure times (`medicalBay.ts:57`), the four
sensor arrays (`expedition.ts:1249`, `1357`), all 72 blueprints (research cost, time, Lab tier; `tick.ts:7300`), hull
blueprints (`tick.ts:7030`), relic-gated blueprints (`tick.ts:7317`), relic study (`tick.ts:7452`), Museum stats (14,
see H), Quartermaster requisition and sell (`quartermaster.ts:531`, `720`), the two refine recipes, fuel reach
(`fuel.ts:68` to `135` -> `tick.ts:4750`).

**Not live (11):**

| id | configured | claim | should move | read today | status | owner |
|:-|:-|:-|:-|:-|:-|:-|
| Fuel Depot (fuelStorage), 9 rungs: storageCapMult, addFuelPipelines, fuelYieldMult, fuelInputMult | model.ts:4520 to 4557, 4744 | tank cap, pipelines, yield, ice cost | state.fuel | `processFuelPipelines` returns early (`FUEL_DEPOT_PIPELINES_RETIRED`, tick.ts:10494); nothing spends state.fuel since 0.13.6; card hidden (homeDashboard.ts:388) | INERT (retired 0.13.9) | WR-4, OC-C1 |
| FUEL_TANK_BASE_CAP, FUEL_REFINE_*, FUEL_DEPOT_BASE_PIPELINES, FUEL_CREDITS_PER_UNIT + `buyFuel` | model.ts:1435 to 1478; tick.ts:7919 | buy and store fuel | state.fuel | `buyFuel` still spends real credits from the hidden Depot console (App.svelte:12996) | INERT, and a credit sink for nothing (bug B5) | WR-4, OC-C1 |
| warehouseT2, 5 rungs | model.ts:4484, 4734 | doubles the tier-2 cap | tier-2 cap | tick.ts:7588, but the only tier-2 item `denseOre` (model.ts:8170) has no source and rungs 2 to 5 cost denseOre (4510) | PARTIAL (unbuildable past rung 1) | WR-4, OC-C2 |
| `requiresResearch` rung gate | model.ts:4309 | research gate | rung unlock | tick.ts:5898 returns failure for ANY listed topic | INERT and BROKEN (bug B1) | WR-4 (fix, no call) |
| `requiresFacilityLevels`, `requiresMissionCompletions` | model.ts:4310, 4312 | rung gates | rung unlock | tick.ts:5910, 5927 (correct logic, no rung uses them) | INERT seam | WR-4, OC-C4 |
| `MISSION_CONTROL_UNLOCK_COMPLETIONS` 50 | model.ts:4631 | completion gate | Mission Control level 2 | only inside a commented-out rung (4782) | INERT | WR-4, OC-C4 |
| medical bay blindness, neurotoxin, hemorrhage, concussion, fracture | medicalBay.ts:62 to 66 | cure times ("16b") | bay time | never applied | INERT | FK-4 (counted in F) |
| ItemDef.equipStats | model.ts:8057 | "forward" equip stats | none | no item fills it | INERT seam | WR-4, OC-C4 |
| reclaimedAlloy, purifiedBiomass | model.ts:8321, 8329 | "Refined ... at the Refinery" | crafting feedstock | no recipe makes or uses them | INERT (claim broken, bug B6) | WR-4, OC-C3 |
| precursorCircuit | model.ts:8393 | "reserved for a future recipe" | feedstock | salvage drops it (8527, 8588); nothing consumes it | PARTIAL (honest text) | WR-10, OC-J3 |
| Archive completion % | archive.ts:17 to 49 | score only (no bonus promised) | none | App.svelte:7289 | UI-ONLY (honest) | none |

### 2.5 D. Ship

#### D1. Hull stats (ShipTypeDef model.ts:126; SHIP_TYPES model.ts:1046 to 1330)

**LIVE (13):** spec (hull gates, crew cap, Focused Command), tier (crew cap), extractionYieldMult, hullIntegrity,
shieldCapacity, shieldRecharge, weaponHardpoints, droneBays, buildRecipe, requiresBlueprint, awayTeams size and
teamType, groundSquads. (`bridge.ts:126` to `128`, `equipment.ts:516`, `530`, `commandStructure.ts:148`, `tick.ts:6966`.)

| field | configured | claim | read today | status | owner |
|:-|:-|:-|:-|:-|:-|
| cargoCapacity | model.ts:130 | hold | missions only (model.ts:3715; tick.ts:4863) | PARTIAL | WR-7, OC-D8 |
| transitSpeedMult | model.ts:131 | speed (Aurora "fastest cruise", Runner "fast transit") | missions only; patrols use fixed PATROLS ticks (tick.ts:2974); expeditions fixed TRANSIT_SECONDS (expedition.ts:1215) | PARTIAL | G2-3 + WR-7, OC-D8 |
| fuelCapacity, engineEfficiency | model.ts:145, 146 | range, burn (Orion "enormous reach") | missions and patrols (tick.ts:4740, 4892, 5348); no expedition range gate | PARTIAL | G2-4 (reach gate) |
| moduleSlots | model.ts:147 | module slots (Aurora "most module slots") | none; every hull has the same slot set | INERT | WR-7, OC-D4 |
| equipmentSlots | model.ts:148 | forward bucket | none (0 on every hull) | INERT seam | WR-7, OC-C4 |
| cost | model.ts:171 | credit buy | none (retired S4) | INERT (retired) | WR-4 (remove field, no call) |
| awayTeams[].count | model.ts:210 | squad count | none (retired SQ-2) | INERT (retired) | WR-4 (remove field, no call) |
| description | per hull | flavor | UI only; Aurora (module slots, fastest cruise), Eir (largest crew), Orion (reach) are partly false | UI-ONLY (false claims) | WR-7, OC-D13; "heavy cruiser" wording is SF-6 |
| (sensors) | none | explorer sensor advantage | no field (S4-B04; hullDerivedStats sets 0 at model.ts:3595) | MISSING | CP-14 |
| label | model.ts:127 | name | UI | UI-ONLY | none |

#### D2. Ship gear stat lines (LIVE_STAT_KEYS model.ts:2871; fold `equipmentStatMods` model.ts:3490)

**LIVE (10 of 22 keys):** extractionYieldMult, massReduction (consumed at mint, itemgen.ts:425), shieldCapacity,
shieldRecharge, hullStrength, shieldCoherence, ablativeArmor, kineticDampening (`bridge.ts:856` to `876`),
waveHullRegen (`tick.ts:3002`), expeditionScanSpeed and hazardResist (`expedition.ts:1174`, `1176`). Also LIVE outside
the vocabulary: weaponYield and weaponAccuracy (listed as RESERVED, bug B18), droneHp and droneAccuracy (in no list).

| key | read today | status | owner |
|:-|:-|:-|:-|
| cargoCapacity, fuelCapacity, transitSpeedMult, engineEfficiency | as D1 | PARTIAL (4) | WR-7, OC-D8 / G2 |
| sensors | survey yield (tick.ts:2120), expedition foreknowledge and scan (expedition.ts:525, 1244), GO sensor ghost (shipScanEvents.ts:168); never patrol combat | PARTIAL | CP-15 (patrol cloak, user-deferred to 0.14.x) |
| repairSpeed (Damage Control Suite) | Shipyard repair (tick.ts:7172); not GO field repair (groundOps.ts:2213) | PARTIAL | WR-7, OC-D10 |
| powerOutput | display only (ShipSystemsPanel.svelte:475, 490) | UI-ONLY (promises a budget) | E-MOD + WR-7, OC-D1 |
| powerDrawReduction | into piece.powerDraw, display only | UI-ONLY (promises a budget) | E-MOD + WR-7, OC-D1 |
| materialQualityChance | default case, ignored; tooltip only (EquipmentTooltip.svelte:214) | INERT (rolls on every Prospecting Rig; the Refinery-Feed Rig's identity) | WR-7, OC-D2 |
| crewStations, crewEfficiency | ignored; tooltip prints rolled values (EquipmentTooltip.svelte:595 to 604) | INERT | WR-7, OC-D3 |
| `damageResist_<family>`, `disruptionResist_<family>` | read in combat (bridge.ts:160 to 169, resolveBattle.ts:478, 986); no affix pool rolls them | UNFED (counted in D7) | WR-8, OC-D12 |

RESERVED_STAT_KEYS (14): no slot references them; vocabulary only, not configured. Not work, except the B18
relabel.

#### D3. EQUIPMENT_SLOTS descriptors (ship slots) and curves

**LIVE (9):** cargoBay, shieldEmitters, hullPlating, sensor arrays wiring, variety implicit / affix / requirement
overrides, slot `equipRequirement`, defaults and Standard Issue, PERCENT_STAT_CURVES, mass drag constants.

| item | read today | status | owner |
|:-|:-|:-|:-|
| ftlDrive (implicit transit + engineEff) | missions only | PARTIAL | WR-7, OC-D8 |
| reactorCore (implicit powerOutput, base mass 12) | signature UI-only; the mass drags speed and fuel, so a crafted Reactor Core is net negative today (bug B10) | PARTIAL | E-MOD + WR-7, OC-D1 |
| specUtility rigs (yield, survey, refinery-feed) | yield LIVE; materialQualityChance INERT | PARTIAL | WR-7, OC-D2 |
| bridge, quarters slots | wiring LIVE (crewModules.ts) but no blueprint makes any of the 12 modules and no install tile exists | PARTIAL (unobtainable) | CP-11, CP-12 |
| variety `statRatios` | only multiplies affix pick weights (itemgen.ts:269); an unlisted key keeps weight 1, so Hauler Hold ("none into mass") rolls massReduction MORE than Prospector Hold (bug B11) | PARTIAL | WR-7, OC-D6 |
| variety `favorsSpec` | none | INERT | WR-7, OC-D5 |
| SLOT_BASE_PHYSICALS powerDraw | display only | UI-ONLY (promises a budget) | E-MOD + WR-7, OC-D1 |
| SLOT_BASE_PHYSICALS durability (economy, defense, crew, sensor, member pieces) | never read | INERT | WR-8, OC-D14 |

#### D4. Crew modules (crewModules.ts, read by crewOverlay.ts)

**LIVE (6):** MODULE_RARITY_STEP / QUALITY_STEP / moduleEffectScale, Operations Quarters, Utilitarian / Efficient /
Elite wings, Balanced Command, Focused Command + HULL_ROLE_SEATS, Flag Command.

| item | read today | status | owner |
|:-|:-|:-|:-|
| Security, Engineering, Science, Medical, Flight-Deck Quarters | only on the division keys that have readers; the dead keys (droneHandling, hullRepairRate, powerEfficiency, counterInfiltration, awayTeamProtection, surveyAptitude, crewEffectiveness, triage) make part of each module do nothing | PARTIAL | CP-2, CP-3, CP-4, E-MOD |
| baseCapacity (wings 6, Utilitarian 12, Efficient 40) | raises only the TOTAL cap; division caps still bind (commandStructure.ts:174, 233, 262 to 271): +0 or +1 berth (bug B22) | PARTIAL | CP-5 + WR-7, OC-D7 |

#### D5. Utility gear (utilityGear.ts) and sensor arrays (sensorArrays.ts)

**LIVE (12):** Damage Control waveHullRegen, Pathfinder sensors / scan speed / hazard resist, hull gates, array
scanRateMult and coverageWidth (multiplied), landmark and underground odds bias, Bio-Resonance relicFindBonus.

| item | read today | status | owner |
|:-|:-|:-|:-|
| DC repairSpeed | Shipyard only | PARTIAL (also in D2) | WR-7, OC-D10 |
| DC_REPAIR_SPEED_MAX .5, DC_WAVE_REGEN_MAX .1, PF_SCAN_SPEED_MAX .3, PF_HAZARD_RESIST_MAX .3 | utilityGear.ts:45, 50, 57, 62 (`Math.min` at :78) | INERT (can never bind) and against D23 (bug B8) | WR-4 (no call: D23 rules) |
| sensorEffectScale | utilityGear/sensorArrays.ts:210, no caller | INERT | WR-7 (fold into the array reader or delete; no call) |
| Expedition.sensorArrayId | written (expedition.ts:521, 1158), never read | INERT record field | WR-4 (record-only; classify as identity, no call) |
| ARRAY_CHARACTER | display; no Bio-Resonance entry (blank line); "Focused: faster" while net rate is 0.78x (bug B12) | UI-ONLY (false claim) | WR-7, OC-D11 |

#### D6. Repair, salvage-side ship values, loadout, roster

**LIVE (8):** REPAIR_* constants, field repair constants (GO only, by design), bays, CUNNING_FREE_REPAIR_TICKS, salvage
fractions and lock. UI-ONLY (2): shipLoadout preview (leaves out officer combat mods, modules, sensors and suites, a
display gap), shipRoster labels (shows a ship on an expedition as "idle", no "repairing" status, bug B19).
INERT (1): `shipLoadout.compareInstall` (tests only; delete or use, WR-4, no call).

#### D7. Combat (combat/*.ts; 116 rows)

**LIVE (59):** the weapon family triangle, yield, cooldown, accuracy, projectiles, shieldAttenuation, effect procs and
escalation, durability wear and quality; eight ship status effects; drone roles, size, tier, hp, accuracy, yield,
cooldown, intercept, reflect, support repair, refab between waves; degrade thresholds; enemy pools, weapons and drones;
the bridge gear fold and officerCombat.

| item | read today | status | owner |
|:-|:-|:-|:-|
| weapon `range`, drone `range`, stance (incl. the patrol stance the player picks), BAND_* constants, enemy stance, speed and position | every ship spawns at position 0 (bridge.ts:932 to 933; no caller passes position or speed), so all are co-located (bug B3) | NO-EFFECT (6 rows) | WR-8, OC-D9 |
| sensorPowerDrain, coolantLeak, FTL_SPEED_PENALTY | depend on range or position | NO-EFFECT (3) | WR-8, OC-D9 |
| manifoldOverheat | enemy evasion is always 0 | NO-EFFECT | WR-8, OC-D12 |
| Torpedo armorPen | enemy armor is 0 | NO-EFFECT | WR-8, OC-D12 |
| qualityDurabilityMax (reactor, FTL) | always quality 0 | NO-EFFECT | WR-8, OC-D14 |
| particleTraceDetector | bridge.ts:960 hard 0; read resolveBattle.ts:1374 | UNFED | CP-15 (user-deferred to 0.14.x: `deferred`) |
| rapidChargeAfterAmbush, inCombatReplenishPercent, antiDrone (PDA and EMP claim the role, no def sets it), smartReflect, drone status `disrupted`, drone evasion when targeted, damageResist / disruptionResist, overchargedCapacitors, reactor/FTL systems from installed gear (bridge.ts:945 uses a fresh quality-0 system), ShipDerivedStats in combat (powerOutput, sensors, mass) | consumer exists, nothing sets it | UNFED (11 more) | WR-8, OC-D12 |
| weapon `powerDraw` and the power.ts helpers (`powerBudget`, `canFitByPower`, `totalPowerDraw`: no callers) | none | INERT | E-MOD + WR-7, OC-D1 |
| Tachyon anti-shield exception, Voltaic chain | comments only | INERT | WR-8, OC-D12 |
| the "vs Drones" triangle column, the `inhibit` status, status persistence between battles (reset every wave, bridge.ts:953), `ResolveOptions.objective`, `TargetingPolicy.escortShare`, `builtInBays`, `frameHp`, the DoT rng | none | INERT (8 more) | WR-8, OC-D12 |
| status `color` | none | INERT (display seam) | WR-11 (use in the combat view or delete; no call) |
| ambush opener / `ambushEligible` (expedition cloaked events only), `precharge` (GO battles only, not patrols), armorPen / shieldCoherence / ablativeArmor / kineticDampening (player side only; enemies carry none), evasion and FTL_EVASION_PENALTY (only through Evasive Command), drone replenish (between waves only) | some contexts | PARTIAL (10) | WR-8, OC-D9 / OC-D12 |
| weaponType flavor, status `system`, names, drone models, condition pips, combatPhase, bandFor, logs, roundState | display | UI-ONLY (10, honest) | none |

### 2.6 E. Crew and officers

**LIVE (57):** 14 Senior Staff bonuses (Command Presence, transit cut, evasion, unload surge, cargo, yield surge,
discovery, weapon and shield command, Fleet Triage, Recovery, Range Master, Inspiring Leader, Veteran Instincts); 26
officer stat facets; 10 complement buffs (unload, load, cargo, transit out / back, range, boarding, extraction, rare
find, reduced losses); 3 racials (Station-born, Ossir, Draell); rank magnitude, rarity, generation weights, officer
seat presence (`gambit.ts:1316`).

| id | configured | claim | should move | read today | status | owner |
|:-|:-|:-|:-|:-|:-|:-|
| eng.overdrive Reactor Overdrive | seniorStaffBonuses.ts:77 | power efficiency | power budget | none (crewOverlay.ts:101 pending) | INERT | E-MOD, OC-D1 |
| xo.moraleAnchor | seniorStaffBonuses.ts:54 | Fear resist; "complement attrition" | squadFearResist; an attrition system that does not exist | wired (gambit.ts:1376, 1452), nothing inflicts Fear | INERT | FK-4; attrition half OC-E7 |
| facet pilot:cunning | officerStats.ts:183 | (no effect decided) | Flight Deck over-delivery | none | INERT (pending user) | WR-9, OC-E4 |
| facet Constitution on battle bonuses | crewOverlay.ts:452 | ramps with hours out | battle mods | cycle 1 of a patrol frozen at 0 hours (tick.ts:5402); a Dispatch Once patrol never ramps | PARTIAL | WR-9, OC-E13 |
| 11 complement buffs: droneHandling, hullRepair, power, counterInfiltration, awayTeam, survey, effectiveness, triage, crewOutputMult, missionTurnaround, preventCrewLoss | crewBuffs.ts:78 to 110 | design 6.2 | see CP plan | none | INERT (11) | CP-2 (hullRepair, effectiveness, outputMult, turnaround), CP-3 (counterInfiltration, awayTeam, survey, triage, preventCrewLoss), CP-4 (droneHandling), E-MOD (power) |
| excl.craftDuplicate | crewBuffs.ts:108 | held for homeworld staffing | none | never rolls | HELD (D14) | none |
| racials earthBorn, martian, belter, outerColony, vael, stheni, spacer | crewRaces.ts:66 to 137 | each race's key | as the matching buff | none | INERT (7) | CP-2 (earthBorn, stheni), CP-3 (outerColony, vael), CP-4 (belter), E-MOD (martian), spacer = `deferred` (T3: the Spacer long-haul ramp moved to 0.14.x) |
| notables (create) | model.ts:6292 | standouts graduate | assigned notable buffs | read paths live (crewOverlay.ts:285 to 300, gambit.ts:1310) but nothing creates one | INERT (unreachable) | CP-8 |
| officer promotion | seniorStaff.ts:135 to 223 | officers promote by objectives | rank factor, stat points | `promotionCounters` read at :190, never incremented (crewHours, shipsDestroyed, personnelAchievement); every officer is a cadet x0.85 forever (bug B4) | INERT (unreachable) | WR-4, OC-E10 |
| crew rank `enlisted` flag | crewRank.ts:22 | (flag) | unknown | never read | INERT | WR-9, OC-E11 |
| buffCountForRank = 3 | crewRank.ts:49 | three buffs at high rank | a third buff | only gates the 35% exclusive pick (crewGeneration.ts:99) | PARTIAL | WR-9, OC-E12 |
| command structure caps | commandStructure.ts:54 to 85 | per-hull caps | auto-fill and transfer | passive ships only (autoCrew.ts:54); active ships never filled; not enforced on load | PARTIAL | CP-5, CP-7 |

Also flagged (not separate rows, they ride CP slices or the calls): the transit buffs merge out and back into one
multiplier (OC-E5); Rapid Loadout is Ground Ops only (OC-E6); Museum crewBonuses skips the directly read officer
bonuses (OC-E8, also H); Command Presence does not scale expedition rewards (OC-E9); Operations Integrity does not
reach the Ground Ops offload (rides OC-E9's slice); SeniorStaffPanel shows the 7 inert racials as "+N% Stat" with no
pending marker (text fix with each CP slice).

### 2.7 F. Away team and ground

**LIVE (60):** traits steadyAim, breacher, veteran, bulwark, fieldMedic, keenEye, patientHands, greenThumb, codebreaker,
deepSurvey, steady, quickDraw (weak); gear effects groupHit, stun and poison inflict, Med Kit heal (gated), Neural
Backup revive, unique-installed rule, Toxin Filters, Shroud and Lure (legacy path), planet-tuned tools, race implant
slots; Security HP / PWR / ARM / ACC, Science FIELD / RELIC / HAZ, specs, Security rank, injury gate, Fleet Triage;
gambit actions attack, execute, suppress, taunt, brace, cure, aidHeal, useItem, hold, 17 selectors, 6 presets, enemy
programs; statuses poison, stun (on enemies), weakened, suppressed, shielded; bay health / poison / downed; ground
systems (fight points, hazard penalty, compositions, threat samples, step timings, ambush tables, bay care, risk
factors at Tier I, Reinforcing, Rocky Outcroppings, ship events, automatic field repair).

| id | configured | claim | read today | status | owner |
|:-|:-|:-|:-|:-|:-|
| ironWill | awayTraits.ts:89 | resists Fear 50% | wired, nothing inflicts Fear | INERT | FK-4 |
| saboteur | awayTraits.ts:75 | +10% status chance | only with an `inflict` piece worn (gambit.ts:1446) | PARTIAL | WR-10, OC-F4 (FK-1 grenade bonus) |
| quickDraw | awayTraits.ts:82 | acts first | the team always acts first (gambit.ts:1194), so it only reorders teammates | LIVE (weak), flagged | WR-10, OC-F5 |
| cortexShield resist stun, fear | model.ts:2764 | resists stun and panic | nothing stuns or frightens the squad | INERT | FK-4; stun half FK open call 6 |
| shroudEmitter, lureBeacon on Ground Ops | model.ts:2607, 2619 | "wildlife walks right past" / "they come carrying things" | on GO they move the SHIP event chance (expedition.ts:1560, Q11 provisional); no drop multiplier | PARTIAL (claim mismatch) | FK-7 + OC-F1 |
| weaponRange on member weapons | model.ts:2465 to 2480 | long vs short | read only under Rocky Outcroppings cover (GO) | PARTIAL (by design) | none (registry context note) |
| sidearm range, Science combat lines | model.ts:2488 | short | Science never fights (D2) | INERT | Science line swap (D26) |
| fieldDevice effectiveness (untrained 1, trained 1, specialist always false) | expedition.ts:274 to 277, 1466 | reduced device ability | both values 1; specialist unreachable | INERT knob | FK-7 |
| member slot physicals (mass, powerDraw, durability) | model.ts:10021 to 10024 | reserved | none | INERT | WR-8, OC-D14 |
| SnapshotMember implants / traits / rank fields | awayTeam.ts:776 to 781 | record | never read (engine reads effects) | INERT record | none (identity) |
| statusChance, Security Debuff spec base 0.1 | gambit.ts:105 | inflict chance | only with inflict gear | PARTIAL | WR-10, OC-F4 |
| Science HP / PWR / ARM / ACC / status | | none | none | INERT | Science line swap |
| Security FIELD / RELIC | | none (by design) | none | INERT (by design) | none (registry: display) |
| Security HAZ (Assault Hardsuit) | groundTasks.ts:196 | less hazard slowdown | GO task work only (D26 says so) | PARTIAL (by design) | none |
| Prospecting team type | awayTeam.ts:184, 206 | a team type | no recruits, specs or gear | INERT | WR-10, OC-F11 |
| Science member rank | model.ts:6418 "nudges magnitude" | rank factor | fieldwork never reads rankFactor (fieldwork.ts:129) | PARTIAL | WR-10, OC-F7 |
| Ossir Stoneskin | medicalBay.ts:71 | bay time x1.25 | GO only (legacy injuries.ts:93 ignores perks); battle half FK-4 | PARTIAL | FK-4 + OC-G1 |
| complement ground buffs (4) and Morale Anchor | crewBuffs.ts:87 to 110 | squad HP, resist, heals, bay care | none | INERT (counted in E) | CP-3, FK-4 |
| fallBack | gambit.ts | "disengage this round" | identical to Hold (gambit.ts:887) | PARTIAL | WR-10, OC-F6 |
| shieldAlly, analyze, secureObjective, takeCover | gambit.ts:362 to 372 | Science actions | never offered or run; `analyze` is the only Corroded source | INERT | WR-10, OC-F10 |
| status picker entries that never match | GambitEditorPanel.svelte:160 | pick any of 9 statuses | only foe stun / poison / suppressed and ally poison / weakened / shielded can fire | PARTIAL | FK-9 + WR-10 |
| account gambit pair (DEFAULT_GAMBIT_PROGRAMS, state.gambitPrograms, Expedition.gambitPrograms) | model.ts:6934 | account programs | only the Balanced preset copy and a notice | INERT (D19) | WR-10, OC-F12 |
| statuses bleed, corroded, inspired, fear | gambit.ts:170 to 180 | battle statuses | nothing inflicts bleed / corroded / inspired / fear on anyone | INERT (4) | FK-4 (fear, bleed per FK call 7), FK-5 (inspired), OC-F9 (corroded) |
| bay bleed + 5 FK conditions | medicalBay.ts:57 to 67 | cure times | never applied | INERT (6) | FK-4 |
| treatmentShare | medicalBay.ts:103; injuries.ts:61 | treatment | always 0 | INERT | FK-5 / FK-6 |
| memberFallOutcome | injuries.ts:39 | (Safety Interlock hook) | single branch | INERT hook | OC-F13 |
| SURVEY_AMBUSH_CHANCE 0 | groundOps.ts:393 | fallback | pre-SQ-4 runs only | PARTIAL fallback | none (legacy) |
| legacy-only: MAX_BATTLE_ATTEMPTS, EVAC_REWARD_FRACTION, ENCOUNTER_DROP_SCALE, scan ground battles, softenAmbush, flat 2 h injury | gambit.ts:141, 1649, 1973, 2004 to 2053; injuries.ts:25 | legacy path | pre-GO-7b runs only | PARTIAL | OC-G1 |
| tier-dormant rows (RISK_TIER_ODDS II to VII, enemy territory, hostile sites, SCIENCE_HEAVY, affix rows above Tier I, DIFFICULTY_TIER_ROLL_MULT above base) | riskFactors.ts, affixes.ts:293 to 315 | tiers | unreachable at Tier I | INERT (unreachable) | G2-2, SF-3 |
| taskChainFollowUp, calmObjective, affix `weightFor` | riskFactors.ts:431; affixes.ts:95, 125 | hooks | no caller | INERT hooks | OC-C4 |
| player-ordered field repair | expedition.ts:2263 to 2275 | order a repair | engine only, no UI | PARTIAL (no UI) | WR-10, OC-F14 |
| Neural Backup | model.ts:2776 | flavor: brings the wearer back | revives the FIRST downed ally (gambit.ts:1150) (bug B13) | LIVE (claim mismatch) | WR-10, OC-F2 |
| Med Kit | model.ts:9656 | "Keeps a downed friend in the fight" | no revive (aidHeal skips the downed, gambit.ts:857) | LIVE (claim mismatch) | WR-10, OC-F3 |

### 2.8 G. Expedition content

**LIVE (78):** PoI ids, pools, planetWeights; planet ids, hazard tiers and scalars (read by ten consumers), surface /
underground bias; transit, shakedown, anomaly timing and chance, scan rate, body counts, discovery attempts, encounter
steps and chances, supply caches, candidate count, banked systems, salts, activity seconds; all fieldwork curves; array
odds and relic bonus; risk factors at Tier I (jitter, lifeless types, clearing sites, fight mods, needs, difficulty,
risk reward, ambush, flora); ship events; Ground Ops step timings; field repair; the reward tables (materials,
credits, relic odds and tiers, encounter guards, hazard scaling, the deposit).

| id | configured | claim | read today | status | owner |
|:-|:-|:-|:-|:-|:-|
| PoI `flavor` | expeditionContent.ts:97 to 162 | per-PoI reward character ("high relic odds", "biotech + research", "supplies + data") | never rendered; relic chance and haul do not vary by PoI (gambit.ts:1696, 1718) | INERT (false claims) | WR-11, OC-G4 |
| hostile / clearing site `flavor` | expeditionContent.ts:314 to 333 | flavor | never rendered | INERT | WR-11 (render; no call) |
| `orbitalOnly` (Gas Giant) | expeditionContent.ts:215 | "no surface landing; finds are satellite ops" | UI only; GO lands teams and fights there | UI-ONLY (false claim) | gas giant study 15b + OC-G2 |
| anomaly finding payload | expedition.ts:1955 | "logged a finding"; opting in costs 1 h | no payload (deposit :2108) (bug B15) | INERT | WR-11, OC-G3 |
| ANOMALY_CHANCE_PERMILLE vs sensors | expedition.ts:199, 1952 | "if sensors detect one" | sensors not read | PARTIAL (claim) | WR-11, OC-G3 |
| foreknowledge `relicSignature` | expedition.ts:564, 680 | relic lead flag | the UI never reads it; always true | INERT | WR-11 (delete or render; no call) |
| FIELD_DEVICE_TRAINED_EFFECTIVENESS | expedition.ts:277 | specialist at full strength | specialist check always false | INERT | FK-7 |
| SUBSPACE_TELESCOPE_LEVELS.reachTier 2 to 7 | model.ts:4660 | reach farther regions | every candidate is Tier I | INERT (unreachable) | G2-2 |
| blind launch path | expedition.ts:597, 1066 | warning and counter | unreachable | INERT | G2-2 |
| ODDS_RISKY_BELOW | launchRecommendation.ts:283 | odds weigh in | behind tier > 2 | INERT (unreachable) | G2-2 |
| RISK_TIER_ODDS | riskFactors.ts:90 | grades by tier | row I only | PARTIAL | G2-2 |
| ENEMY_TERRITORY_COMBAT_STEP, HOSTILE_SITE_RULES, SCIENCE_HEAVY_* | riskFactors.ts:100, 126, 304 | tiers | unreachable | INERT (3) | G2-2 |
| ShipEventProfile `evasion`, `shieldCapacity` | shipScanEvents.ts:167 | frozen inputs | never read (checks rebuild the combatant, :277) | INERT | WR-11, OC-G5 |
| FIGHT_POINTS_DEFAULT / MIN, SURVEY_AMBUSH_CHANCE, EVAC_REWARD_FRACTION, MAX_BATTLE_ATTEMPTS, ENCOUNTER_DROP_SCALE | various | fallbacks and legacy | old runs only | PARTIAL (5) | OC-G1 |
| planet comments (Ocean slower work, Frozen best relic survival, Toxic hardened team) | comments only | not player text | not modeled | INERT (comment) | OC-G6 |
| label, TELESCOPE detail / names / lore, SENSOR_REVEAL thresholds, RISK grade names, launch wording | various | display | UI | UI-ONLY (16, honest) | none |

### 2.9 H. Relics and the Museum

**LIVE (25):** Museum cargo, salvage yield, sensors (multiplier: does nothing on a 0-sensor ship, note), scan speed,
science team power (narrow), mining yield, rare chance, extraction speed, hazard resist, research speed, crafting
quality, relic find; the relic catalog, sources, rarity weights, study lanes and time, first finds; four relic-gated
blueprints.

| id | configured | claim | read today | status | owner |
|:-|:-|:-|:-|:-|:-|
| Museum transitSpeed (Shipwright 2pc) | relics.ts:338 | transit speed | missions only | PARTIAL | G2-3 + OC-D8 |
| Museum crewBonuses (Xeno 4pc) | relics.ts:346 | crew bonuses | crew.* only; officer bonuses through officerBonusTotal (crewOverlay.ts:362) not amplified | PARTIAL | WR-9, OC-E8 |
| Precursor Lens first find | model.ts:9443 | special module | unlocks nothing today | INERT (deferred to E-MOD by decision) | E-MOD |
| relic flavor / labels | relics.ts:146, 159 | card text | UI | UI-ONLY (honest) | none |

Calls H1 (scienceTeamPower scope) and H2 (salvageYield scope) are in section 5.H.

### 2.10 I. Missions, patrols, factions, transports, allocation

**LIVE (62):** every MISSIONS timing, rate, chance, loot, type, transport cost and margin, FA XP, credits, unlock and
captain-level gates, cargo gate; BASE_XP_PER_TICK; PATROLS pools, waves, counts, legs, windows, chances; patrol loot
tables; pirate hulls; threat bands; forecast samples; wave salts; combat tuning constants; crew transports (window,
batch, seed); allocation reads; launch recommendation constants.

| id | configured | claim | read today | status | owner |
|:-|:-|:-|:-|:-|:-|
| MISSIONS.cargoCapacity (90 / 120 / 150) | model.ts:282 | per-cycle units | overwritten by the hull hold (model.ts:3733) | INERT | WR-11, OC-I1 |
| primaryMaterial on transports | model.ts:702, 723 ("inert for transport") | auto-stop only | canDispatch blocks transports at ore cap (tick.ts:4876, no exemption; tick.ts:4076 has one) (bug B2) | PARTIAL (blocks wrongly) | WR-4, OC-I3 |
| voidJackals, ironVultures, ashenCorsairs | model.ts:828 to 838 | "roster for enemy generation to seed from" (model.ts:819) | no patrol references them | INERT | WR-11, OC-I2 |
| Faction.id field | model.ts:824 to 839 | key for enemy gen | never read (map key used) | INERT | WR-11, OC-I2 |
| patrol factionId | model.ts:919, 980 | faction fought | id prefix only; its spelling sorts against "ship-N" for turn order (resolveBattle.ts:1648) (bug B14) | LIVE (side effect) | WR-4, OC-I4 |
| labels, faction name / flavor, threat chip text, rating weights, flavor picks | various | display | UI | UI-ONLY (13, honest) | none |

Display drift (not status-changing; WR-4 text fixes, no call): berth ETA uses the raw unloadTicks and understates big
holds (berths.ts:192, 206); the dispatch popup's rare chance omits the Museum and survey crew terms (App.svelte:19404);
the stale "NOT wired" comments (model.ts:748, transports.ts:14).

### 2.11 J. Salvage and item generation

**LIVE (37):** salvage fractions, quality bonus, rounding, FA ceilings, Museum yield, durations, bay base slots, loot
tier order, weights, quality, drops; item budget, rarity, quality mult, iLevel cap, FA iLevel, crafted defense bases,
affix counts, weapon and pod pools, base masses (their comments say inert; they are live), quality step, rarity roll,
minted fields.

| id | configured | claim | read today | status | owner |
|:-|:-|:-|:-|:-|:-|
| SALVAGE_TALENT_YIELD_BONUS | model.ts:12180 | "+10% salvage recovery"; "spare hull" | recycle only; adds 10 percentage points, not +10% | PARTIAL | WR-6, OC-B1 |
| SALVAGE_TALENT_CEILING_BONUS | model.ts:12181 | "+1 loot tier reach" | clamped at index 3; wasted from FA 15 (salvage.ts:597) (bug B16) | PARTIAL | WR-11, OC-J1 |
| SalvageRoll `rolled` | salvage.ts:272 to 283 | "the UI narrates the drop" | dropped (tick.ts:10915) | INERT | WR-11, OC-J2 |
| loot tier names (damagedWeaponSystem) | model.ts:8548 | tier names | unread (Reactor pool feeds relic tiers) | PARTIAL | WR-11, OC-J2 |
| dead-end drops scrapAlloy, salvagedCircuitry, precursorCircuit | model.ts:8491, 8502, 8527, 8588 | "it melts down fine" | roll fine, nothing uses them | LIVE (dead end) | WR-11, OC-J3 |
| QUALITY_DURABILITY_BONUS, item durability | itemgen.ts:178, 433 | quality raises durability | weapons only; never written back after a battle | PARTIAL | WR-8, OC-D14 |
| DRONE_POD_BASE_DURABILITY | itemgen.ts:636 | pods wear | never read | INERT | WR-8, OC-D14 |
| DRONE_POD_BASE_POWER_DRAW, weapon powerDraw, reactor implicit, powerDrawReduction | itemgen.ts:635, 573 | power budget | display only | UI-ONLY (4, promise a budget) | E-MOD + OC-D1 |
| `achievementBoost` | itemgen.ts:189 | reserved | always 0 | INERT seam | OC-C4 |
| affixCount derelict / luminous / constellar | itemgen.ts:227, 239 | safety branches | unreachable rarities | INERT | WR-11, OC-J4 |
| `ascension` | itemgen.ts:440 | (none) | always "none" | INERT seam | OC-C4 |
| talentBonus / ceilingBonus params | salvage.ts:366, 567 | test override | test-only | INERT (by design) | none |

### 2.12 What `no-dead-stats.test.ts` already covers

Run on `6b2b20c`: 155 passed, 1 skipped (the RELEASE_GATE block), 34 s.

- **Catalogs (149 entries, EXPECTED_COUNTS :910):** officer 16 (one officer at the bonus's seat, magnitude x5, vs the
  same officer bare), crew 21 (18 profession buffs + 3 rollable exclusives, a 400-head bucket vs a dummy buff), racial
  10 (an officer of the race, no bonuses, vs no officer), gear 74 (every member gear variety x team x rollable ground
  line at 60 points, effect pieces balanced with an inert filler line), facet 28 (a full bridge + complement, one stat
  raised to 70).
- **Probes (:636):** ship stats, reach, repair time, ship battle (full and 40% hull), expedition readers, injury
  recovery (legacy and Ground Ops bay), expedition battles, expedition run + claim (both engines), three mission
  cycles, a Repeat patrol, a patrol defeat repair, ship scan events. Fingerprints use allow-listed outcome fields; NaN
  or Infinity throws.
- **PENDING_IN_RELEASE (29):** E-MOD 3, Task 23 13, Task 23 all-buffs 2, Task 23 long-haul 1, Field Kits Fear 1,
  Science line swap 7, Cortex resist 1, Pilot Cunning 1. The test fails if a listed entry turns live; the release gate
  fails while any entry is not in DEFERRED_PAST_0140 (empty today).
- **Not covered:** captain primary and secondary talents; Fleet Admiral talents; away traits (Task 22b, never built);
  ground effects as mechanics (heal, inflict, resist, revive, group hit are cancelled out, not probed); ship gear
  lines; crew modules; sensor arrays; utility gear; relics and the Museum; facilities and research; hull fields;
  missions, patrols, factions; salvage and itemgen; combat descriptors; gambit actions and statuses; notables, crew
  rank and rarity scalars, command caps, generation weights; officer rank and promotion; deriveAwayTeam strength and
  teamKit; the per-head complement racial path; each of Inspiring Leader's individual stats.
- **Design limits:** liveness only (passes if ANY probe moved); no direction (a buff that hurts passes); no magnitude
  or proportionality; one context is enough, so PARTIAL items pass; keyed by statKey, so transitOut and transitBack are
  indistinguishable; exaggerated scale (x5, 400 heads, stat 70) can hide an effect that rounds to nothing at real
  magnitudes; fixed scaffold (one ship, destroyer battles, three missions, one patrol, four seeds); never compares the
  UI text against the mechanic.

### 2.13 Bugs found (not just inert)

Each is an audit finding with file:line; the fixing slice proves it first with a failing test.

| # | Bug | Where | Fix owner |
|:-|:-|:-|:-|
| B1 | `requiresResearch` rung gate returns failure for ANY listed topic and never checks it; a rung that used it could never be built (latent: none uses it) | tick.ts:5898 | WR-4: check `blueprintUnlocked(state, topicId)` (model.ts:10924) |
| B2 | `canDispatch` blocks the two transport missions with "materialAtCap" when Titanium Ore is full, though transports never deliver ore (the auto-stop at tick.ts:4076 already exempts them) | tick.ts:4876 | WR-4 (OC-I3 confirms intent) |
| B3 | Ship combat positions are always 0 (no caller passes position or speed), so stance (incl. the stance the player picks per patrol), weapon and drone range, sensorPowerDrain, coolantLeak and the FTL speed penalty can never change a battle | combat/bridge.ts:932 to 933 | WR-8, OC-D9 |
| B4 | Promotion counters are never incremented, so no officer can ever promote; every officer is a cadet (x0.85) forever and the promotion rows on screen are unmeetable | seniorStaff.ts:138, 190 | WR-4, OC-E10 |
| B5 | Fuel Depot rungs do nothing since 0.13.9, and `buyFuel` still spends real credits on fuel nothing consumes (reachable from the hidden Depot console) | tick.ts:10494, 7919; App.svelte:12996 | WR-4, OC-C1 |
| B6 | Reclaimed Alloy and Purified Biomass say "Refined at the Refinery" but no recipe makes or uses them | model.ts:8321, 8329 | WR-4, OC-C3 |
| B7 | Warehouse T2 cannot be built past rung 1: its only item (Dense Ore) has no source and rungs 2 to 5 cost Dense Ore | model.ts:4484, 4510, 8170 | WR-4, OC-C2 |
| B8 | Utility gear hard caps (`Math.min`) violate D23 (they never bind today: the curve limits are 0.40 / 0.08 / 0.30 / 0.30) | utilityGear.ts:45, 50, 57, 62, 78 | WR-4 (D23 rules; replace with the curve, no value changes today) |
| B9 | The Warband patrol is nearly unwinnable for explorers (Orion, Aurora, Eir 1 of 200 wins) and economy hulls (0 to 8 of 200) on Standard Issue | safe-first-runs plan 2.5 E | SF-4 (balance; the sim in WR-2 re-measures it) |
| B10 | A crafted Reactor Core is net negative: its signature line does nothing (no power budget) and its base mass 12 slows transit and fuel efficiency | model.ts:2172; SLOT_BASE_PHYSICALS | E-MOD + OC-D1 |
| B11 | `statRatios` biases inverted: an unlisted stat keeps weight 1, so Hauler Hold ("none into mass") rolls massReduction more than Prospector Hold (weight 2 vs 0.3) | itemgen.ts:269 | WR-7, OC-D6 |
| B12 | Sensor array net rates contradict the UI: Focused reads "faster" but nets 0.78x; Bio-Resonance has no character line (blank) | expedition.ts:1249; ExpeditionPanel.svelte:133 to 137 | WR-7, OC-D11 |
| B13 | Neural Backup revives the first downed ally, while its flavor says it brings the wearer back | gambit.ts:1150 | WR-10, OC-F2 |
| B14 | The patrol faction id's spelling decides turn order (enemy ids sort against "ship-N") | tick.ts:3157; resolveBattle.ts:1648 | WR-4, OC-I4 |
| B15 | Charting the anomaly costs 1 h and pays nothing | expedition.ts:1955, 2108 | WR-11, OC-G3 |
| B16 | Salvage Operations says "+10%" but adds 10 percentage points; its +1 tier reach is wasted from FA 15 | tick.ts:853; salvage.ts:597 | WR-6 / WR-11, OC-B1 / OC-J1 |
| B17 | The Constitution battle ramp is skipped on patrol cycle 1, so a Dispatch Once patrol never ramps | tick.ts:5402 | WR-9, OC-E13 |
| B18 | Vocabulary drift: RESERVED_STAT_KEYS lists weaponYield and weaponAccuracy, which roll and are read; droneHp and droneAccuracy are in no list, so the drift guard cannot see them | model.ts:2926; itemgen.ts:513, 630 | WR-1 (the completeness test absorbs the guard; no call) |
| B19 | The ship roster shows a ship on an expedition as "idle" and has no "repairing" status | shipRoster.ts:127 | WR-4 (text and status, no call) |
| B20 | Display drift: berth ETA understates big holds; dispatch popup rare chance omits Museum and survey crew terms | berths.ts:192, 206; App.svelte:19404 | WR-4 (no call) |
| B21 | Gas giants: the UI says "orbital ops" and "satellite", but teams land and fight on them | expeditionContent.ts:215; groundOps.ts:374 | 15b + OC-G2 |
| B22 | Quarters capacity raises only the total cap; division caps still bind, so the bonus is +0 or +1 berth | commandStructure.ts:174, 233 | CP-5 + OC-D7 |
| B23 | Auto-fill ignores notable occupancy (caps overflow once CP-8 creates notables) | crewOverlay.ts:664 | CP-8 (already planned) |
| B24 | False or stale player text: primary talents say "Common Ore" for every mission's common tier (tick.ts:810); spec cards say combat and science "arrive when the system lands" (model.ts:12640); the economy tooltip shows the raw key "commonOre" (tick.ts:848); the FTL Drive blurb says "fuel burn"; hull descriptions (Aurora, Eir, Orion) claim what the engine does not do | as listed | WR-4 text (hulls via OC-D13) |
| B25 | All three explorers share spec and tier, so they get the same crew cap; Eir's "largest crew" is false | commandStructure.ts:148 | CP-5 (already planned) |

Stale comments (fix in passing, no call): model.ts:11673, 6307, 9174, 748, 5821, 2254; transports.ts:14; sensorArrays.ts:1 to
13; itemgen.ts:15, 459, 520, 629; equipment.ts:136; resolveBattle.ts:1544; durability.ts:156; salvage.ts:266; tick.ts:11485;
commandStructure.ts header.

## 3. The registry design

### 3.1 Files

- `src/lib/game/wiring/registry.ts`: the typed entries (pure data + small pure transforms). Engine-side, imported by
  tests and, lazily, by the Debug panel only.
- `src/lib/game/wiring/probes.ts`: pure seam probes (a function computing the game value an entry should move, from a
  state) and the minimal fixture builders (from `freshState()`).
- `src/lib/game/wiring/catalogs.ts`: programmatic enumeration of every effect source in every catalog.
- `src/lib/game/wiring/fieldRoles.ts`: the classification of every FIELD of every catalog def type.
- `src/lib/game/wiring/liveness.testkit.ts`: the no-dead-stats probes and fingerprint, moved out of the test file
  unchanged (test-only import; tree-shaken from the app).
- Tests: `wiring.sensitivity.test.ts`, `wiring.completeness.test.ts`, `wiring.liveness.test.ts`
  (`no-dead-stats.test.ts` becomes a thin wrapper, section 3.6).

### 3.2 The entry type

```ts
type WiringStatus =
  | { kind: "live" }
  | { kind: "pending"; owner: string }                 // a 0.14.0 slice brings it live (release gate blocks)
  | { kind: "deferred"; owner: string; userRef: string } // the user deferred it past 0.14.0 (T3 etc.)
  | { kind: "held"; userRef: string };                   // D14 Craft Duplicate only

type Curve =
  | { kind: "linearRelative" }                 // value(on) = value(off) x (1 + m)
  | { kind: "linearAbsolute" }                 // value(on) = value(off) + m
  | { kind: "divisor" }                        // durations: value(on) = value(off) / (1 + m)
  | { kind: "diminishing"; knee: number }      // through diminishing(m, knee) from diminishing.ts
  | { kind: "chanceAbsolute" }                 // the probability fed to the roll rises by m
  | { kind: "gate" }                           // a refusal becomes an allowance (or a count rises by m)
  | { kind: "event"; metric: string };         // capstones and procs: an expected-value metric over seeds

interface WiringEntry {
  id: string;                     // "<system>:<catalog>:<key>", e.g. "captain:secondary:gunnery1"
  system: "captain" | "fleetAdmiral" | "facility" | "ship" | "crew" | "away" | "expedition" | "relic"
        | "mission" | "salvage";
  source: { catalog: string; key: string };  // must match catalogs.ts enumeration
  claim: string;                  // the player text it renders (pulled from the same helper the UI uses)
  probe: ProbeId;                 // the seam: e.g. "missionYieldMult", "shipyardRepairTicks", "scanRatePerSecond"
  contexts: readonly ContextId[]; // EVERY context the claim covers: "mission:extraction", "mission:survey",
                                  // "mission:transport", "patrol", "expedition:groundOps", "expedition:legacy",
                                  // "shipyard", "shipEvent", "craft", "salvage", "research"...
  outOfScope?: readonly { context: ContextId; reason: string; userRef?: string }[]; // explicit, never silent
  direction: "up" | "down";
  curve: Curve;
  magnitude: (cfg: Catalogs) => number;  // READ FROM THE CATALOG, never a literal: retuning 8% keeps the test green
  on: (s: GameState) => GameState;       // grant the source (allocate the node, seat the officer, install the piece)
  off: (s: GameState) => GameState;      // the same state without it (the Debug panel uses this on a live save)
  status: WiringStatus;
}
```

### 3.3 The sensitivity test (one per entry, per context)

For every entry and every context in `contexts`: build the context fixture, compute `probe(off(s))` and `probe(on(s))`,
and assert:
1. **Direction:** the value moved the declared way (a buff that hurts fails).
2. **Magnitude through the curve:** the move equals `curve(magnitude)` within a tolerance: exact (1e-9 relative) at a
   pure seam; within one rounding step where the outcome is an integer (ticks, units). The magnitude comes from the
   catalog, so "the 8% will change, but the effect of that 8% will not": a retune stays green, a broken wire fails.
   Changing the curve's FORM (linear to diminishing) is a deliberate edit of the entry, matching "the form of how that
   8% might change".
3. **Chance and event entries:** the seam is the probability passed to the existing roll (asserted exactly), plus an
   expected-value check over a fixed seed batch (direction only, with a minimum effect size) so a chance that is
   computed but never reaches the roll fails.
4. **Outcome liveness:** the entry's source also moves at least one real consequence in the liveness testkit (the
   no-dead-stats fingerprint), so a seam that nothing downstream reads fails too.

Probes are seam-level pure functions extracted where a consumer today computes its value inline (for example
`effectiveScanRate(exp)`, `missionCycleYieldMult(state, ship, mission)`, `shipyardRepairTicks(state, ship)`). Each
extraction is behavior-preserving and pinned by the existing goldens.

Context coverage is what catches PARTIAL: an entry that claims "mission and expedition" but only moves missions fails
in the expedition context, unless that context is listed in `outOfScope` with a reason (a user decision or the
claim's own wording). A PARTIAL item becomes live by wiring the context or by the user agreeing to narrow the claim
(then the UI text changes in the same commit).

### 3.4 The completeness test (enumerated, never hand-listed)

- `catalogs.ts` enumerates, programmatically, every effect source: `CAPTAIN_TALENTS`, `CAPTAIN_SPEC_BONUS`,
  `SECONDARY_CAPTAIN_TALENTS`, `HOMEWORLD_TALENTS`, `SENIOR_STAFF_BONUSES`, `CREW_PROFESSION_BUFFS` +
  `SECOND_LEVEL_EXCLUSIVE`, `CREW_RACES`, seats x `OFFICER_STAT_KEYS`, the away traits, every `EQUIPMENT_SLOTS` slot and
  variety (ship and member) x every rollable line x every effect descriptor, `LIVE_STAT_KEYS`, every `FACILITIES` rung
  effect field, the storage / docks / berth rungs, `SUBSPACE_TELESCOPE_LEVELS`, the crew module catalog,
  `SENSOR_ARRAYS`, the utility gear readers, the Museum stats, the relic first-find unlocks, numeric `ShipTypeDef`
  fields x `SHIP_TYPES`, MISSIONS and PATROLS fields, weapon defs, drone roles, ship and ground statuses, gambit
  actions and selectors, objective affixes, `POI_CATALOG` and `PLANET_TYPES` fields, `ITEMS` with effect fields,
  `REFINE_RECIPES`, `SALVAGE_LOOT_POOLS` outputs.
- The test fails when any enumerated source has no registry entry, when an entry names a source that no longer
  exists, and when two entries share an id.
- **Field roles:** for every catalog def type, every key of every def must be classified in `fieldRoles.ts` as
  `effect` (has registry entries), `display` (label, flavor; must claim no effect), `identity` (ids, keys, record
  fields), `gate`, or `seam` (framework hook with an owner). A NEW field on any def fails until classified, which is
  how a future "+5% something" field cannot ship silently. `display` fields are scanned: a display string matching a
  number with a percent or a plus sign fails unless it is the label of an `effect` entry (the claim-text check).
- **Unread constants:** a source scan (the existing `fs-for-tests.d.ts` pattern) lists every exported UPPER_CASE
  constant in `src/lib/game/**` (non-test) and fails when one has no reference outside its declaration and no
  `seam` entry with an owner. This catches `MISSION_CONTROL_UNLOCK_COMPLETIONS`-style leftovers.
- **Release gate:** with `RELEASE_GATE=1`, the suite fails while any entry is `pending`. `deferred` entries must carry
  a `userRef` (for example "capture 2026-10-15 section 3 T3").

### 3.5 Fixtures and determinism

- Minimal fixtures built from `freshState()` with one ship per hull, one captain, Standard Issue gear, fixed seeds;
  context builders reuse `awayTeamTestFixtures.ts` and the no-dead-stats scaffold.
- Magnitudes at REAL values (not x5) for the sensitivity level; the liveness level keeps its exaggerated scale (the
  two levels together catch both "rounds to nothing" and "reads nothing").
- No probe writes state; every probe is pure, so the Debug panel can run seam probes on a live save safely.
- Runtime budget: the default suite stays under about 60 s added (seam probes are cheap; liveness keeps its cache).

### 3.6 How it subsumes no-dead-stats

1. WR-1 moves the probes, fingerprint and entry builders into `liveness.testkit.ts` unchanged.
2. Every one of its 149 entries becomes a registry entry with the SAME id (`officer:`, `crew:`, `racial:`, `gear:`,
   `facet:` prefixes kept as the source key); a parity test proves the id sets are equal before anything else changes.
3. `PENDING_IN_RELEASE` becomes the registry statuses (`pending` with the same phase strings as owners); the
   "listed but live" and "dead but unlisted" failures carry over unchanged; `DEFERRED_PAST_0140` becomes `deferred`.
4. `no-dead-stats.test.ts` keeps its name (history and docs point at it) as a thin file that runs the registry's
   liveness level; the release-gate command stays `RELEASE_GATE=1 npx vitest run src/lib/game/no-dead-stats.test.ts`
   and additionally runs the registry gate.
5. Task 22b (away traits and ground effects) is delivered by the registry's away entries, not as a separate category.

## 4. Slices

Order follows the user's framework order (capture section 7: registry, then the simulated player, then the Debug
"Wiring" panel, and the audit uses them): WR-1 to WR-3 build the framework, WR-4 onward wire systems through it.
Each slice: one implementer, the two-stage review. Every engine slice captures its goldens first, in its own commit.

### WR-1: The registry, the completeness test, and sensitivity tests for every LIVE entry (tests + pure module)

**Files:** new `src/lib/game/wiring/*` (section 3.1), new tests, `no-dead-stats.test.ts` (thin wrapper), probe
extractions in consumers (behavior-preserving, goldens unchanged).
**Behavior:** none. Every LIVE row of section 2 gets an entry with probe, contexts, direction, curve and catalog
magnitude, and its sensitivity test is GREEN. Every non-live row gets an entry with `pending` (owner slice) or
`deferred` (user ref). PARTIAL items carry their missing contexts as expected failures recorded by the status (the
test asserts they still do NOT move, so they cannot silently change, exactly like the no-dead-stats allow-list).
**Tests:** id parity with the 149 no-dead-stats entries; completeness by enumeration; field roles; unread constants;
the claim-text check; release gate (expected to fail today, run only with the env var). B18 is fixed here (the
completeness test replaces the vocabulary drift guard's blind spot).
**Determinism / save:** none. **UI:** none.
Commit `test(0.14.0): wiring registry and sensitivity tests for live effects (WR-1)`.

#### WR-1 carry note (built 2026-10-15; tests and pure modules only, no engine change, goldens and parity untouched)

**Built:** `src/lib/game/wiring/` `registry.ts` (the typed entries), `probes.ts` (seam probes + fixtures),
`catalogs.ts` (programmatic source enumeration), `fieldRoles.ts` (every field of 31 catalog def types + the unread
constant list), `liveness.testkit.ts` (the no-dead-stats probes, moved unchanged); tests `wiring.sensitivity.test.ts`,
`wiring.completeness.test.ts`, `wiring.liveness.test.ts`; `no-dead-stats.test.ts` is now the thin liveness runner
(same name, same release-gate command, plus the registry gate).

**Size:** 1026 entries: 693 live, 58 PARTIAL (live contexts asserted, missing contexts carried by the status), 272
pending, 3 deferred (Spacer ramp, patrol cloak `particleTraceDetector`, sensors in patrol combat: T3), 1 held (Craft
Duplicate). By system: captain 60, fleetAdmiral 21, facility 171, ship 275, crew 102, away 165, expedition 52, relic 44,
mission 128, salvage 8. Sensitivity: 781 live checks + 37 "pending still does nothing" checks, about 1 s in total
(every test well under 50 ms); the liveness level is unchanged (about 23 s, longest test 1.3 s). The 149 no-dead-stats
ids are registry ids (parity test), the 29 allow-list owners carried over verbatim, and `racial:spacer` is now
`deferred` (T3), so it no longer blocks the release gate.

**Deviations from section 3 (all additive):** two curve kinds the code needed, `bonusRelative` (amplifiers: crew
modules, the museum crew bonus, crew rarity and rank) and `equals` (content data read verbatim: hull, mission, pirate,
planet, array, recipe, blueprint, status fields); a probe takes `(state, context)` and a few switch on the context
(one probe id per entry, as specified); content sources (weapons, drone roles, statuses, gambit actions) toggle through
a WeakSet mark on the fixture (`sourceOn`), since a save does not own them; `notApplicable` marks a catalog field that
does not apply to one def (8 rows); `audit` rows register the not-live items with no catalog key (seams, record fields,
legacy-only constants, combat descriptors nothing feeds), each with its owner. No probe extraction was needed: every
probe reads an exported function (the extraction thresholds bisect a constant-draw economyTick instead). Item 4 of
3.3 (outcome liveness) holds for the 149 liveness entries only; WR-2's ablation covers the rest.

**Audit rows found misclassified:** Precursor Lens (section 2.9, INERT): its copies feed the Precursor set's per-copy
research speed and its set tiers like every relic; only the first-find module unlock waits for E-MOD, so it is PARTIAL.
No row the audit calls LIVE failed its sensitivity check. Not in the audit (recorded `notApplicable`, a question for the
user under T1): the two transports carry `lootTable`, `creditsPerCycle` 0 and loot chances 0 that nothing reads.

**For WR-2 / WR-3:** the registry is engine-side and pure; `readProbe(entry.probe, entry.on(save), ctx)` vs
`entry.off(save)` is the Debug panel's live contribution. Planet pool biases are measured by cancelling them with the
array bias over 8 dispatches (an event check); the sim should re-measure them at scale.

### WR-2: The simulated player (headless, engine-only)

**Files:** new `src/lib/game/sim/` (`simPlayer.ts`, `policies.ts`, `actions.ts`), tests.
**Behavior:** a scripted headless playthrough driven through the SAME pure engine functions the `do*` handlers in
`App.svelte` call (build, hire, seat, allocate talents, install, research, dispatch, launch, claim), advanced with the
closed-form `tick(span)` (a simulated hour is one call).
- `allAuto` policy [PROPOSAL]: a fresh save, build the first explorer, the default complement, every crew setting on
  auto, no gear or crew changes. This is the user's T2 baseline.
- `scripted(choices)`: the same run plus one choice (a talent node, an officer bonus, a gear line, a module, a
  facility rung, a relic set tier).
- **Ablation:** for every registry entry with a player choice, run `scripted([choice])` against `allAuto` to a fixed
  horizon and compare the entry's sim metric (haul, credits, run length, wins, repair time); assert the direction and
  a minimum effect size over a fixed seed batch. Pending entries are expected to show no difference (and fail when
  they start to differ without a status flip).
- **Safe first runs:** the SF plan's guarantees are re-proven through `allAuto`: the first expedition is 100%
  complete with no loss on every seed of the batch; the first gathering mission, the first combat mission and the
  first patrol likewise; the short-range template entries arrive with G1. The SF slices own the CONTENT changes; WR-2
  owns the harness and these assertions, which turn green as SF-2 / SF-4 land.
**Determinism:** fixed seeds only; one call == 997 s == 1 s parity on one run per policy; never `Math.random`.
**Runtime:** the default batch [PROPOSAL 20 seeds x 24 simulated hours] keeps the suite fast; `SIM_FULL=1` runs every
entry x 200 seeds (the balance-pass seed, SUGGESTIONS ~1844 to ~1863; named archetype policies wait for that pass).
**Save:** none (the sim never touches a real save). **UI:** none.
Commit `feat(0.14.0): headless simulated player with ablation and safe-first-run checks (WR-2)`.

#### WR-2 carry note (built 2026-10-16; tests and pure test-side modules only, no engine change, no golden moved)

**Built:** `src/lib/game/sim/` `actions.ts` (the player's hands: thin wrappers over the engine functions the App's
handlers call: dispatch, recall, patrol, launch, claim, board hire, the Quartermaster kit (requisition + install on
the member), cheapest-first captain / secondary / Homeworld talents and facility rungs), `policies.ts` (policies as
data), `simPlayer.ts` (the driver, the report, the outcome metrics), `ablation.ts` (the choice ablation); tests
`simPlayer.test.ts` (8 default tests, each under 0.7 s) and `simPlayer.sweep.test.ts` (gated: `npm run test:sim`,
vitest mode `sim`, or `SIM_FULL=1`; `SIM_SEEDS=0,1,2` widens the ablation's seeds). Commit
`test(0.14.0): headless simulated player and choice ablation (WR-2)`.

**Policies:** `allAuto` (the T2 baseline: Orion already built, the weakest launchable crew, nothing changed: a 20
minute Short Ore Run, one Dispatch Once Sweep, then expeditions on repeat, never Skip), `newcomer` (the SUGGESTIONS
archetype on the REAL new game: General Freighter, the board's lowest-rank Security and Science, the Quartermaster
kit, cheapest talents and rungs, 2 h of gathering), `scripted(choices, base)`. The other five archetypes wait for the
balance pass (their tuning targets are its job).

**Deviations (all honest limits, none an engine hook):**
- Time advances through `tick()` (the real offline path), not one `economyTick(span)` per hour: measured, one
  `economyTick` over 3,600 s of a Short Ore Run credits 60 and hauls 176 Titanium Ore where 3,600 one-second ticks
  credit 720 and haul 2,119 (economyTick is closed-form per tick only). One simulated hour costs about 0.1 s, so the
  default runs are 0.5 to 8 h, not 24 h, and the sweep plays 1 seed per choice by default, not 200 (200 x 475
  choices is days). Offline == live holds exactly: one call, 997 s chunks and 1 s ticks per look give identical
  reports (default test on 2 h, gated on both whole runs).
- "Build the first explorer" is a shortcut: `freshState()` with ship-1 retyped to the Orion FIRST, then its own
  Standard Issue installed (exactly the SF-0 `onHull` method; a test pins the loadout equal, one weapon on the
  one-hardpoint hull). It skips the hull blueprint and the whole build chain (Shipyard founding, salvaged components),
  so allAuto proves "unlosable once you own an explorer", NOT that a player can reach one; that is the balance pass's
  speedrun policy. (WR-2 review: the first build retyped AFTER the freighter's baselines, leaving the Orion two
  autocannons; the Sweep then ended at 574 shield left instead of 236. Fixed; every number below is re-measured.)
- Explorers only (user rules since the WR-2 brief): the training run is the first expedition FROM AN EXPLORER, and only
  explorers will reach expedition systems (G2's reach gate). The newcomer's freighter launch is therefore "not the
  training run"; its pins (`simPlayer.test.ts` newcomer test, the gated first-run batch) are CURRENT BEHAVIOR that G2
  flips to a refusal. The engine's shakedown flag means "first expedition on the account" (`expedition.ts`
  startExpedition, `nextExpeditionId === 1`); SF must change it to "first from an explorer".
- `exercised` counts the Shipyard context only for repair seams (`repairTicks`, `officerRepairBonus`, `turnaround`,
  `dcRepairReduction`): the sim repairs a lost hull but never builds, buys bays or docks, so the Ship Docks rungs and
  the build-speed and bay rungs read "context not played".
- For the registry owner: `SUBSPACE_TELESCOPE_LEVELS` rungs 2, 4, 6 and 8 repeat the rung below's `detail` by design,
  yet the registry emits a `detail` entry for every rung (registry.ts telescope loop); emit it only where detail
  changes. Not a one-line `catalogs.ts` filter (the completeness test enumerates every rung's fields), so left as a note.
- The weakest crew is the wiring fixture's pair (`withAwayTeam`: rank 1, no traits), since the recruit board never
  offers a traitless rank 1 pair; it is also what lets every member-scoped registry transform land on the sim's crew.
- The sim's new game is `installMissingCombatBaselines(freshState())`, exactly as App.svelte starts one: a bare
  `freshState()` freighter has no weapons, shields or plating and loses its first Sweep in 10 ticks (a test-fixture
  trap, not a game bug).
- A run whose objectives stop completing for 2 h while one is stuck is recorded STALLED and the run ends there
  (`SIM_STALL_SECONDS`, PROVISIONAL), since the newcomer never presses Skip.
- Ablation verdicts: `moves` (an outcome metric moved: resources, XP, deliveries, the patrol's waves and pools left,
  each expedition's objectives, fights, send-backs, hull, setbacks, findings, injuries and a timeline digest of how it
  went), `seamOnly` (the registry's seam probe reads differently on the sim's save but no outcome moved: "only moves
  display" in this play), `dead`, `noChange` (the transform leaves the save identical: content marks), `skipped`.
  `exercised` says whether a claimed context is one the policy plays; a dead live entry in a played context is a
  `surprise`, as is a wholly pending entry that moves.

**Findings (gated sweep, allAuto, seed 0, 8 h horizon, 477 runs in 127 s; re-measured on the legal Orion, the same
counts as before the fix):** 475 player choices: 114 move an outcome,
190 move only their seam, 134 move nothing, 32 noChange, 5 skipped. Of the 134 dead: 110 pending (as expected; 104 in a
context the sim does not play), 1 deferred, 1 held, and 22 live: the 8 Ship Docks rungs (context not played: the sim
never docks a second ship) and 14 surprises in played contexts, none a broken wire found so far: the 7 crew amplifier
modules (3 bridge, 4 quarters) with no officer or complement to amplify, the medic heal ground effect (no Medical
Training), Lucky Strike II (a proc that never rolled in 7 deliveries), the 4 Telescope detail rungs that repeat the
rung below by design (the registry note above), and the museum sensors stat (its seam reads the same on the sim's
save: worth a look in WR-3's panel). Of the 178 live seamOnly, 60 are in contexts the sim does not
play (warehouse caps, storage, berths, Shipyard build and bay rungs, research) and the rest are mostly member gear lines, traits,
officer facets and relics whose seam moves while the run stalls on fights first (seed 0's shakedown completes 0 of 11). The 5
skipped are fixture limits (the captain-slot nodes need admin points; the droneHp / droneAccuracy transforms install a
role-less pod on an Orion).

**With `SIM_SEEDS=0,1,2`** (all three shakedown candidates, 1,431 runs in 873 s; measured before the review fix, on
the two-gun Orion): 131 move, 173 seamOnly, the same
134 dead (the same 22 live ones), 32 noChange, 5 skipped. The 17 that newly move are fight and fieldwork sources (6
Security weapon or tool groundPower lines, Flora Scanner fieldwork and hazard resist, Breacher, Field Medic, Revive),
4 relics and the 2 rare-yield Homeworld nodes, which seed 0 alone did not reach.

**Safe first runs, today (characterization, pinned):** the allAuto newcomer delivers its gathering run (7 deliveries,
first at 180 s, never a defeat) and wins its first Sweep (2 waves, 0 lost, 340 hull and 236 shield left), but the first expedition (the shakedown)
STALLS on all three fresh-save candidates: cand-0 0/11 done, stuck on Derelict Outpost, 3 lost fights; cand-1 4/10,
stuck on Geothermal Chamber, 4 lost fights, 2 ship-event setbacks, 3 credits to boarders; cand-2 4/9, stuck on the
Buried Vault, 4 lost fights, 55 hull damage, 2 setbacks. The newcomer (board hires, kit, on the freighter: not the training run, G2 refuses
it) matches it (cand-2: 80 hull damage, cand-1: 3 setbacks). SF-2 flips `simPlayer.test.ts`'s pin and the gated "no seed is safe" count; SF-4 owns the
patrol side (`patrol` records are already in the report).

### WR-3: The Debug "Wiring" panel (`?dev` only)

**Files:** `App.svelte` Debug tab (one sub-panel), a small display helper `src/lib/wiringPanelDisplay.ts` + test.
**Behavior:** for the current save, every registry entry grouped by system: the source, whether this save owns it
(allocated, seated, installed, built), its status chip (live / pending / deferred / held), its contexts, and its LIVE
CONTRIBUTION: the seam probe on the save vs `off(save)`, with the expected value from the curve. Filters: "owned but
contributing nothing", "pending", per system. Pure reads; no state writes; seam probes only (no liveness runs); the
registry is imported lazily so production bundles do not carry it.
**UI:** dev-only table; one DOM, readable at 375 px. A text sketch is in OC-K1 (whether the user wants a mockup first).
Commit `feat(0.14.0): Debug Wiring panel shows every bonus's live contribution (WR-3)`.

#### WR-3 carry note (built 2026-10-19; one commit, UI and a pure helper only, no engine change, no golden moved)

**Built:** `src/lib/wiringPanelDisplay.ts` (the view model: the measuring pass, verdicts, filters, groups, text) +
`wiringPanelDisplay.test.ts` (20 tests); `src/lib/game/wiring/panelOwnership.ts` (the per-catalog ownership readers
and the probe view; beside the registry because it is keyed by catalog NAME, and the completeness test's unread-constant
scan skips that folder, so naming `FIELD_KIT_PRICES` there never counts as reading the constant); a "WIRING (dev-only)" panel in App.svelte's Debug tab under
the DEBUG PANEL (OC-K1: "Simple table, no mockup"). "Measure this save" takes a snapshot of `state` and measures every
entry (1,170 today) in slices with a progress line; filters: system, Show (All / Owned / Owned but contributing nothing
/ Pending incl. partial / Deferred, held, seam) and a search on id, source and claim. Columns: Source (id, claim, probe,
catalog magnitude), Owned (+ verdict), Status (live / partial / pending / deferred / held / seam chip with owner and
user ref), Contexts (live, "not yet", out of scope), Contribution (now vs without), Expected. At 640 px and below
each row stacks into a labeled card (same DOM). No glyphs.

**Lazy:** the helper imports the registry and probes as types only; `loadWiringDeps` imports them dynamically. Checked
with builds: a preview build emits `registry` (96 kB) and `probes` (45 kB) chunks, loaded on the button; a production
build carries neither (DEV_MODE is a build constant, the panel is dead code). A pass on a new game takes about 10 ms.

**How it measures (deviations from "probe(save) vs off(save)", all because the registry's transforms are FIXTURE
transforms):** the probes read ship-1, captain 1 and the fixture members, so the panel measures those subjects: ship-1,
captain 1, and the first Security and Science member aboard ship-1, aliased to `member-901` / `member-902` in a probe
view (`wiringProbeView`, never written back). Ownership and "without" come from one reader per player-choice catalog
(27: talents, nodes, Homeworld, officers, complement buffs, rarity, rank, racials, facets, traits, member and ship gear
lines, modules, arrays, Museum stats, relics, set tiers, rungs): "without" removes just that source (the bonus zeroed,
the line dropped, the node unbought), where `off` would seat a blank fixture officer, empty the whole Museum, or be the
identity. Rung tracks are measured as the rung's own step (the entry's on vs off on the save). Content catalogs (missions,
enemies, POIs, recipes...) read "content"; derived or seam rows read "n/a" with a reason; hull data and one-time grants
(captain slots) are owned but "not measurable here". Expected is shown only where the registry magnitude is what the save
owns (talents, nodes, Homeworld, rungs, traits): elsewhere it is the fixture's (20 gear points, a 20-head bucket, an
ensign), and an additive stack can read "off curve" without a broken wire. A test fails when a new catalog is not
classified.

**Readings:** a new game owns 21 (the starting facility and telescope rungs, Standard Issue lines, hull data) and
"contributing nothing" is EMPTY (the section 7 QA line holds). On a sample save, Inspiring Leader reads "contributing
nothing" when the complement carries no cargo buff: its registry probe is the crew map's cargo slot, so it is the
probe's view, not a dead wire (the same seamOnly shape WR-2 reports). No [PROVISIONAL] or [PROPOSAL] values.

### WR-4: Bugs and seams (engine fixes with clear answers, text fixes)

**Goldens first** (`wiringGoldens.test.ts`: mission dispatch at ore cap incl. transports, a Shipyard repair, a
Repeat patrol, a facility rung check, the utility suite readers).
**Changes:** B1 (`requiresResearch` checks the blueprint), B2 (transport exemption, pending OC-I3 confirmation; the
build default follows the "inert for transport" comment), B8 (utility caps become the D23 curve; values identical
today), B14 (turn order no longer depends on the faction id's spelling: sort by side then index [PROPOSAL]), B18 done
in WR-1, B19, B20, B24 text; retired fields removed (`ShipTypeDef.cost`, `awayTeams[].count`,
`shipLoadout.compareInstall`); framework seams per OC-C4; Fuel Depot per OC-C1; Warehouse T2 per OC-C2; recipes per
OC-C3; promotion counters per OC-E10 (B4).
**Save:** OC-C1 removal of `state.fuel` needs a migration (coordinate the version with G2-1's v70); promotion counters
start at 0 at release [PROPOSAL, no backfill].
**Tests:** a failing test per bug first; registry entries flipped to live.

#### WR-4 carry note (built 2026-10-16; five commits: goldens, bugs and seams, B14, B4, OC-C1 + save v70)

**Built** (tests: `wiringBugs.test.ts`, one block per item; goldens: `wiringGoldens.test.ts`, captured first):
- B1 `requiresResearch` checks `blueprintUnlocked` (reason names the blueprint). No rung uses it: the seam stays on OC-C4.
- B2 / OC-I3: `canDispatch` exempts transports from the ore-cap gate (the auto-stop already did).
- B8: the four utility `*_MAX` caps and `Math.min` are gone; values identical (each cap sat at or above its curve's
  asymptote). The bounded `plusToPercent` curve itself stays a balance-pass item (diminishing.ts header).
- B14 / OC-I4: `resolveBattle` orders the cast by side (player first, OC-I4's proposal) then input order.
- B19: roster and ship page read "On expedition" / "Repairing" (`shipRoster.ts shipUnderRepair`).
- B20: the berth ETA and the softlock ceiling use the fleet's hold-scaled unload (`berths.ts worstUnloadTicks`); the
  dispatch popup reads `tick.ts missionDropChances` (museum rare chance and survey crew rare find included).
- B24 (part): tier talents say "common / uncommon / rare material ... on missions"; the trickle names its item; the
  FTL Drive baseline blurb says range.
- Retired: `ShipTypeDef.cost`, `awayTeams[].count` (fixture-only shorthand in `registerSyntheticHull`),
  `shipLoadout.compareInstall`.
- B4 / OC-E10: `crewHours` (the call's span for every officer whose ship is out on a run: a captain mission or patrol
  in any phase, or an expedition not yet home), `shipsDestroyed` (patrol wave kills live; expedition ship battles won,
  at the claim), `personnelAchievement` (objectives done, at the claim); `crewOverlay.foldOfficerPromotionCounters`;
  start at 0. Checklist text: "Command N hours on runs", "The ship's squads complete 1 objective".
- OC-C2: the Lunar Mine Contract's uncommon strike is Dense Ore; Cobalt Ore keeps its Survey Mineral Anomaly source.
- OC-C3: `refineReclaimedAlloy`, `refinePurifiedBiomass`; Damage Control Suite +2 Reclaimed Alloy; Bio-Resonance Array
  2 Purified Biomass in place of 12 Fibrous Biomass.
- OC-C1 / B5: the Fuel Depot is the FLEET REACH track (`{ fleetReachBonus }` rungs, same nine costs and durations, so a
  save keeps its levels; `tick.ts fleetReachBonus`, applied in `shipReachDef`, the one seam every gate and readout
  reads); its card and console are back (Overview + Upgrades, "Extend Reach"); Home offers its upgrade. Retired: Buy
  Fuel, the tank (`fuelCap`, `FUEL_TANK_BASE_CAP`), the refinery (`processFuelPipelines`, `FUEL_REFINE_*`,
  `FUEL_DEPOT_BASE_PIPELINES`, the three processing effects, `addFuel`), the fuel flow summary and runway projection,
  and `GameState.fuel`. Help's fuel topic says so and reads the per-level number from the constant.
- **SAVE v70 (taken here):** `MIGRATIONS[69]` = `dropRetiredFuelV70` (drops `fuel` and any in-flight `fuelRefineJob`).
  save.ts lists what v70 contains above `SAVE_VERSION`; **G2-1 (homeworld) and SF-1 (run counters) APPEND their steps to
  `MIGRATIONS[69]` and the list while v70 has not reached staging** (no v71). `fuelRefineJob` stays a log-only kind so
  old completed-events entries render.

**[PROPOSAL] numbers (the user tunes):** Dense Ore on the Lunar Mine (not the survey), its 8% uncommon chance kept,
Warehouse T2 rung costs unchanged (75% of the cap they double, the T1 shape); Scrap Alloy 10:1 and Fibrous Biomass 6:1,
both 20 ticks (a duration must keep the speed rung's XP per tick exact); Damage Control Suite 2 Reclaimed Alloy;
Bio-Resonance Array 2 Purified Biomass; Fuel Depot +5% fleet reach per level (linear, +45% at level 9).

**Goldens moved (every move verified):** dispatch (transports launch, B2) and the Lunar Mine runs (Dense Ore; naming it
back reproduces every old hash); every patrol state and replay (B14), plus the gated forecast bands and the 200-seed
win table (the SF plan's section 2.5 E numbers are now stale: freshly measured in `firstRunsGoldens.test.ts` WINS);
officer-bearing states (B4; with the fold disabled every old hash reproduces); every whole-state hash (the removed
`fuel` key only: each new hash equals the old code's hash with `fuel` stripped, 197 pairs, and the two mixed-string
pins reproduce with `fuel` re-inserted); the reach golden's Depot-top half (with the bonus zeroed it reproduces).
Balance fixtures that leaned on the old turn order: the payoff benchmark enemy is 1800/900; the saturated Sweep's
inferiority check is "never above the destroyer" (strict on the Warband); the registry drone duel's enemy does not
recharge shields.

**Registry:** live now: Warehouse T2 rungs 2 to 5, the nine Fuel Depot rungs (probe `fleetReach`), the transport
`primaryMaterial` (notApplicable), the two new refine recipes (auto-registered). Removed audit rows (fixed): utility
caps, sensorArrayId (identity), roster status, compareInstall, awayTeams count, the two refined items, B14, B4.
`facility:audit:fuelPurchase` became `facility:audit:fuelAutoBuy` (pending S4-A02, below). PatrolDef.factionId is
identity.

**Not built (no user answer yet; never guessed):** OC-C4 framework seams (`requiresFacilityLevels`,
`requiresMissionCompletions`, `MISSION_CONTROL_UNLOCK_COMPLETIONS`, gear gates, `equipStats`, `achievementBoost`,
`ascension`, `equipmentSlots`, the objective hooks); B24's spec card text (OC-A42) and hull descriptions (OC-D13); the
mission fuel-budget / credit auto-buy plumbing (`FUEL_CREDITS_PER_UNIT`, `REFUEL_PENALTY_TICKS`, `refuelDelayTicks`,
unreachable since 0.13.6: S4-A02 "remove or keep" is open); the stale-comment sweep beyond the files touched.

**WR-4 review follow-up (2026-10-16):**
- **Fuel refund (user: "Refund as credits", then "Only above the free tank"):** `dropRetiredFuelV70` refunds ONLY the
  fuel beyond the free 500-unit starter tank (tank + any in-flight batch's output - `V70_FREE_STARTER_TANK`, clamped at
  0) at the frozen `V70_FUEL_REFUND_CREDITS_PER_UNIT` (20, the old price), noted once on `fuelRefundCredits`; the game
  logs "Fuel is a reach stat now, so the fuel you held beyond the free starter tank was refunded: +N credits." once on
  load and drops the note. A save at or below 500 gets nothing and no note. The ships' fuel capacity / range stat is
  untouched. SF-1's `withRunCountsV70` runs after it in `MIGRATIONS[69]`.
- **B14 reaches beyond patrols:** every `resolveBattle` caller now puts the player first: the expedition ship events
  (`expedition-N-shipevent...` used to sort ahead of `ship-1`, so the enemy acted first in a non-ambush event;
  shipScanEvents.ts shipEventBattleWon), the patrol forecast (rating.ts) and the dev battle views. Measured over 300
  Tier I expedition seeds (one Ground Ops run each, the D18 minimum crew): Orion 239 ship battles, 221 won / 18 lost,
  and destroyer 239, 239 / 0, IDENTICAL before (id order) and after (side order); no expedition golden moved either.
  Patrols are where the order changes outcomes (the WINS table).
- **Range readout:** the Ship Systems Range row reads the Depot bonus too (the same factor shipReachDef applies).
- **Locked Warehouse tier:** a tier not yet unlocked still STORES its items at the base cap (tierCap at level 0), so the
  Materials view now says "Base cap N / item" and that unlocking raises it (it used to say the storage was locked), and
  Dense Ore's hint says the same.

### WR-5a / WR-5b / WR-5c: Captain secondary talents (prospector, tactician, explorer trees)

**Files:** `model.ts` (effects gain magnitudes for capstones), the captain fold in `tick.ts` (missions), `crewOverlay.ts`
(ship sheet), `combat/bridge.ts` (`applyOfficerCombat` sibling `applyCaptainCombat`), `expedition.ts` / `groundOps.ts`
(dispatch snapshots), `App.svelte` text (the "(first-pass)" and "No bonus yet" strings go away).
**Behavior:** each node wired per its section 5.A row (build defaults = the [PROPOSAL] column, marked [PROVISIONAL]
until the user answers; the nine "no call" rows build exactly as their text says). Which ship a captain's talents act
on and when they freeze: OC-A2.
**Determinism:** run consumers frozen at dispatch (the logistics4 precedent, `groundOps.ts:210`); patrol consumers
frozen per cycle beside `officerCombat`; chance effects reuse existing rolls or a private salted stream (capstones).
**Save:** none (branch-only tree; no production save owns a node). A save with no node allocated is byte-identical.
**Tests:** one sensitivity entry per node per context; ablation in the sim; goldens.
WR-5a prospector (extraction, logistics, trade; 14 nodes), WR-5b tactician (gunnery, aegis, fleetOps; 15 nodes), WR-5c
explorer (surveySensors, expeditionRelics, commandCrew; 15 nodes). Sequential (shared `tick.ts` and `bridge.ts`).

#### WR-5a carry note (built 2026-10-17; two commits: goldens, then the wiring)

**Built:** `captainSecondaryEffects.ts` (pure readers, by node KEY, magnitudes from the catalog; each node's player
text, which the talent tooltip and the registry claim both read), `crewOverlay.ts applyCaptainOverlay` (layered last in
`effectiveShipStats`; `shipStatsBeforeCaptain` feeds a new "Captain" bucket in the ship readout's source split), the
mission seams in `tick.ts`, two optional fields (`ShipDerivedStats.unloadCargoCapacity`, `CaptainState.motherlodeCycles`,
no save bump), `MOTHERLODE_SALT` (salts.test.ts). Tests: `captainSecondaryEffects.test.ts` (one block per node, own-ship,
offline == live), `captainTalentGoldens.test.ts` (captured first). The stale DORMANT headers are gone (model.ts,
captainSecondaryTree.ts, groundOps.ts).

**Rulings applied:** OC-A1: the five ship-stat nodes compound as their own (1 + x) factor beside crew, museum and
officers (none has a D23 curve); Deep Veins adds into the captain's rare and uncommon chance-mult sums; the margin nodes
add into one (1 + sum) on rewardMargin. OC-A2: the captain who commands the ship (`assignedCaptainId`); missions read
live like officers, Ground Ops reads the frozen dispatch factors, patrols read the sheet per cycle. OC-A3: capstone
`magnitude` field (optional until WR-5b / WR-5c give theirs).

**Nodes:** extraction1 yield x1.05; extraction2 rare and uncommon chance x1.05 (rolls, bonus roll, popup);
extraction3 extractionSpeedMult x1.08; extraction4 rollQuality bonus 0.05 on that captain's deliveries (its
own deliveries only; draw-count invariant); extraction5 5% per delivered non-transport cycle, haul x2 (private
stream on the lifetime counter, before Command Presence); logistics1 cargo x1.05 (gates read it); logistics2
reach x1.05 (range 100 -> 105 ly on the freighter); logistics3 unloadSpeedMult x1.08 (missions + frozen Ground
Ops offload); logistics5 cargo x1.10 above the hold, unload scales with the hold below it; trade1 / trade3 margin x1.05
x1.05; trade2 supplies paid x0.95 at the same sale value (the gate reads the paid cost); trade4 1 credit/tick
docked; trade5 x2 on every Trade 1 to 4 value.

**Picks put to the user (answered 2026-10-17, below):** trade4 Trade Routes reads "per delivered transport cycle, paid while docked" as: 1
credit/tick while the captain is docked (no mission, no expedition), only once the FLEET has delivered at least one
supply run cycle (lifetime completions; "an established route"). Alternatives: no route gate; or a per-cycle bonus paid
at each delivery. Also: extraction4's per-item merge (two captains delivering the same item in one tick share the larger
bonus); trade2 adds the discount saved to the net rather than shrinking the load (a smaller load would lower the profit).

**Registry:** the 14 nodes flipped to live with sensitivity checks at catalog magnitude (16 checks for the 14, 17 with
logistics4, unchanged; new probes `deliveryQualityClimb`, `motherlodeRate`, `transportCycleCredits`, `dockedCredits`).
Pending secondary entries left: 30 (WR-5b 15, WR-5c 15).

**WR-5a review follow-up (user rulings 2026-10-17):**
- "Block buying while out": `canBuySecondaryTalent` / `buySecondaryTalent` take the state and refuse while the
  captain's ship is crew-locked (crewLock.ts: a mission, a patrol or an unclaimed expedition);
  `secondaryTalentBuyLock` / `secondaryTalentBuyLockText` name why, and the Prestige panel shows it above the web.
- "Always multiply": every "+X%" node is its own x (1 + X) factor. Fuel Discipline is +5% REACH ((1 +
  engineEfficiency) x 1.05; registry probe `shipRange`), Deep Veins composes (1 + mult)(1 + 0.05) at both roll sites
  (`withDeepVeins`), Market Contacts and Premium Goods are two margin factors (Trade Baron doubles each). Only the trade
  golden moved (e6b7c5c9 -> 496e435c); the extraction and logistics pins hold (no other bonus on those values there).
- Assayer "Own ship only": the deposit fold grades the Assayer captain's own share with its bonus and the rest without,
  both off ONE roll's recorded draws (no draw added).
- Trade Routes and Shrewd Negotiator stay as built (no longer provisional).
- Minors: the Motherlode probe measures doubled hauls over 1,000 real deliveries (tolerance 0.02); the Trade Baron check
  reads the doubled docked trickle; the Shrewd Negotiator test exercises the working-capital gate; Assayer's text says
  "climb a quality step"; the supply run card shows the representative captain's margin and purchase cost
  (`captainSupplyRunTerms`); save.ts names `motherlodeCycles` among the optional fields.

**Goldens moved (every move explained in the file):** extraction (both runs), logistics (ore run, range, Ground Ops
record), trade (the supply run). Unmoved: the no-node control, the other-tree nodes, the docked 200 s without a route,
the dispatch gates, and every other golden in the suite.

#### WR-5b carry note (built 2026-10-17; two commits: goldens, then the wiring)

**Built:** `captainTacticianEffects.ts` (the readers: `captainCombatMods`, the frozen `CaptainCombatMods` record, the
repair and patrol reward factors, each node's exact text), `combat/captainEdge.ts` (the battle side: the fold onto a
fresh player combatant and its drone screen, the projectile and drone damage banks, the incoming hit chance, the
weapon charge clock, Bulwark's lethal-hit save), `captainSecondaryEffects.ts` (the tooltip and registry claim text;
App.svelte's describer reads it). Tests: `captainTacticianEffects.test.ts` (21: every node at its consumer, a real
resolveBattle or patrol, at its catalog magnitude), `tacticianGoldens.test.ts` (captured first).

**Rulings applied:** every node is its own x (1 + m) factor folded after the officers ("Always multiply"); it acts on
the ship its captain commands; frozen per patrol cycle (`PatrolMissionState.captainCombat`, dispatch and each
relaunch, read by the live loop and the replay) and at dispatch for the Ground Ops ship events
(`ShipEventBattle.captainCombat`); the Shipyard repair reads it when the repair starts. No draw anywhere: fractional
factors bank integer thousandths (a weapon's `damageCarryMilli`, the battle's per-combatant drone carry) or
hundredths (the weapon charge clock), so 5% of a 4-point hit is exact over a battle. No new salt.

**Each node:** gunnery1 projectile damage x1.05; gunnery2 weapon accuracy x1.05 (rounded); gunnery3 x1.08 while the
target is above half hull; gunnery4 the cooldown clock runs 1.08x; gunnery5 x1.5 on each weapon's first shot of a
battle (capstone 0.5); aegis1 shield pool and recharge x1.05; aegis2 hull pool x1.05; aegis3 the Shipyard divisor,
the Ground Ops field repair divisor and the Damage Control Suite's between-wave fraction x1.08; aegis4 incoming hit
chance / 1.05; aegis5 one lethal hit per battle leaves 1 hull (capstone 1); fleetOps1 drone hit damage x1.05;
fleetOps2 drone hit points x1.05; fleetOps3 won patrol waves' loot and credits x1.08 (the wave's existing private
output-rounding stream); fleetOps4 drone replenish rate x1.05; fleetOps5 +1 squadron copied from the first installed
pod (capstone 1; none without a pod).

**[PROVISIONAL]:** aegis4 as a divisor on the incoming hit chance (the ship's own evasion is 0 without an Evasive
Command officer, so a multiplier on it would be dead; alternative +5 evasion points). fleetOps4 Wing Commander as the
plan table's drone replenish (no multi-ship system). gunnery5's "first shot" is each weapon's first shot of the
battle: OC-D9 (enemies start at range) is not built, every fight opens at position 0; when it lands the opening shot
is still each weapon's first.

**Registry:** the 15 Tactician entries are live (30 sensitivity checks: patrol + shipEvent for the battle nodes,
Shipyard + Ground Ops + patrol for aegis3, patrol for fleetOps3); claims read the tooltip helper. New probes in
`probes.ts` (captainShotDamage, captainShotDamageHighHealth, captainOpeningShot, captainWeaponAccuracy,
captainWeaponCooldown, captainIncomingHit, captainLethalSurvived, captainDroneShot, battleDroneHp,
battleDroneReplenish, battleDroneSquadrons, patrolRewardMult, captainRepairRate); `playerCombatant` and `repairTicks`
now read the captain too (unchanged without a node).

**Goldens moved (every move in `tacticianGoldens.test.ts`'s header):** the no-node row never moved; each node's row
moves only in the columns its effect touches (the dispatch record carries the frozen record; replays and the event
battle where the fight changes; the final state where the run ends differently; the repair ticks for aegis3 only).
No other golden in the suite moved.

**Not in this slice / merge notes:** WR-5a (built in parallel) adds the "no secondary buys while the captain's ship
is out" guard; WR-5b relies on it (not duplicated). `captainSecondaryEffects.ts` is created here AND by WR-5a: keep
WR-5a's file and route its text through `prospectorText(key) ?? tacticianEffectText(key) ?? genericText(effect)`
(and drop its alphaStrike / bulwark / wolfpack taglines); `model.ts` capstone type gains `magnitude?` on both sides; the
registry's `TACTICIAN_SEAMS` and WR-5a's `PROSPECTOR_SEAMS` sit side by side in `secondaryEntries`. The patrol
forecast (`rating.ts`, App's dispatch forecast) and the ship sheet's hull and shield readouts include neither officers
nor the captain today; they stay that way (a display follow-up if wanted).

#### WR-5c carry note (built 2026-10-17 in parallel with WR-5a / WR-5b; two commits: goldens, then the wiring)

**Built:** `captainExplorerEffects.ts` (pure readers + each node's exact text; imports only model.ts), a compatible
`captainSecondaryEffects.ts` (tooltip describer; App.svelte's describer block is the same as WR-5a's), goldens
`captainExplorerGoldens.test.ts` (captured first: every node read exactly the baseline), tests
`captainExplorerEffects.test.ts`. Every node acts on the ship its captain commands, as its own x (1 + X) factor, read
from the catalog; runs freeze it (scan params, sensor power, squad strengths, the new optional
`Expedition.explorerCaptain`); missions and the sheet read it live like the officers; patrols freeze it with the
officer combat record. No SAVE bump (branch-only tree).
- surveySensors1 Keen Sensors: sheet sensors x1.05, last in `effectiveShipStats` (surveys, run sensorPower, telescope
  lift and ship events all read the sheet).
- surveySensors2 Cartographer: `scanParams.captainScanRateMult` 1.08, x the scan rate.
- surveySensors3 Anomaly Sense: `scanParams.captainDiscoveryMult` 1.05, x each attempt's odds (`discoveryOddsPermille`).
- surveySensors4 Foreknowledge: new effect `levelLift` (1); candidates read +1 telescope detail (`readSystem` captain sight).
- surveySensors5 Deep Scan (magnitude 1): candidates read at Forecast with every foreknowledge field; the first
  `captainSureFinds` attempts of each body land (the draw is still taken).
- expeditionRelics1 Expedition Lead: Security and Science strengths x1.05 in `deriveAwayTeam` (preview == dispatch).
- expeditionRelics2 Field Science: relic chance x1.05 as its own factor (`relicChancePermille`).
- expeditionRelics3 Away-Team Doctrine: Security power and accuracy x1.05 in Ground Ops fights (threat memo keyed).
- expeditionRelics4 Preservationist: the relics that ship recovers carry `studySpeed` 0.08 to the vault; their study
  speed x1.08 (600 ticks -> 556).
- expeditionRelics5 Relic Hunter (magnitude 1): relic tier ceiling +1, never past the top.
- commandCrew1 Inspiring Leader: the complement's buffs x1.05 (officers not scaled).
- commandCrew2 Mentor: every officer bonus and racial x1.05 (crew map, `officerBonusTotal`, combat profile).
- commandCrew3 Drillmaster: every promotion counter increment x1.08 (economyTick live; the claim reads the frozen copy).
- commandCrew4 Recruiter: both boards `ceil(10 x 1.08) = 11` (`candidateBoardSize`; built compounding per captain,
  replaced 2026-10-19 by the user's "Best one counts": the best Recruiter in the fleet counts, a second adds nothing).
- commandCrew5 Legendary Captain (magnitude 0.1): complement and officers x1.10.

**[PROVISIONAL] picks (the user tunes):** Field Science is a factor, not +0.05 into the find sum ("Always multiply");
Preservationist is study SPEED x1.08 (a divisor), stamped per relic (own ship); Deep Scan keeps the telescope's range
(blind stays blind) and its sure attempt is the surface roll (underground on a world with no surface pool); Recruiter
counts every captain who owns it (the boards are fleet-wide); Drillmaster scales all four counters, so
`missionsCompleted` can be fractional (the checklist already floors).

**Registry:** the 15 explorer entries are live as 23 (a node with two or three claimed values gets `<key>:<part>`
entries); new probes `expDiscoveryOdds`, `expDiscoveries`, `candDetail`, `runTaskSecPower`, `runTaskSecAccuracy`,
`runRelicChance`, `runRelicTierCeiling`, `runRelicStudyTicks`, `crewMapCargo`, `missionCrewHours`, `claimObjectives`,
`officerBoard`, `recruitBoard`. Goldens moved: only the variants owning a node, each part explained beside its hash.

**Merge with WR-5a (both add `captainSecondaryEffects.ts`):** keep WR-5a's file; route the explorer keys through
`explorerTalentText` (`prospectorText(key) ?? explorerTalentText(key) ?? genericText(...)`), add the `levelLift` case to
its magnitude and generic-text switches, drop its deepScan / relicHunter / legendaryCaptain taglines. model.ts: both add
`magnitude?` to `capstone` (same line); keep `levelLift`. crewOverlay.ts `effectiveShipStats`: compose WR-5a's
`applyCaptainOverlay` with `applyCaptainSensors` (and leave Keen Sensors out of `shipStatsBeforeCaptain`). registry.ts
`secondaryEntries`: keep the `flatMap` and the explorer route.

### WR-6: Placeholders and partial talents elsewhere (captain primary, spec, race; Homeworld)

tacticianHub, explorerHub, the tactical / science spec bonuses, the captain racial (OC-A40 to OC-A43);
fleetLogisticsSalvage on hull teardown (OC-B1, B16 wording); industryHub, homelandDefenseHub, citizenryHub (OC-B2,
OC-B3). **Save impact:** Homeworld talents exist on main; production players who own those hubs gain their effect at
0.14.0 (patch notes). Goldens first.

#### WR-6 carry note (built 2026-10-19; two commits: goldens, then the wiring; no SAVE bump)

**Built:** `captainPrimaryEffects.ts` (`captainPrimaryMult`: the hubs and specs as their own x (1 + m) factors);
new effect types `weaponDamageMult` / `scanRateMult` / `relicFindMult` (captain) and `fabricatorBonusOutput` /
`patrolShieldMult` / `transportCrewBonus` (Homeworld); no node carries `none` any more. Tests:
`wiringPlaceholderTalents.test.ts` (14), goldens `placeholderTalentGoldens.test.ts` (captured first).
- tacticianHub Combat Readiness and the tactical spec: weapon damage, folded into the frozen captain combat record
  beside Weapons Drill (patrols per cycle, Ground Ops ship events at dispatch).
- explorerHub Survey Doctrine: `captainScanRateMult` beside Cartographer. Science spec: `relicFindMult` beside Field
  Science (both frozen at dispatch).
- Captain race: the commanding captain's racial joins the crew map at the officer magnitude (not scaled by the bridge
  module or Mentor), Earth-born included in the Crew Effectiveness lift.
- Salvage Operations: `hullTeardownFraction` adds its yield to a hull teardown; text says "percentage points" (B16).
  Its +1 tier reach stays WR-11 (OC-J1).
- Works Directorate: a Fabricator job's extra output (a second blank, or the material output twice) is rolled when
  the job STARTS (`startProcess`, `WORKS_DIRECTORATE_SALT`, keyed by the process number) and stamped
  (`TimedProcess.bonusOutput`), so a job in flight never changes and offline == live. Its text names the Refinery gate.
- Home Guard: patrol shield pool and recharge, folded into the patrol cycle's frozen record at dispatch and relaunch
  (`patrolCaptainCombatMods`); ship events do not read it. Civic Charter: `transportBatchSize` (13), which adds crew
  and never rerolls the first 12.
- Text: spec and category cards and the hub flavors name only live effects; stale DORMANT comments fixed in passing.

**Sizes (confirmed by the user 2026-10-19, docs/plans/2026-10-19-merge-batch-answers.md; no longer provisional):**
`TACTICIAN_HUB_WEAPON_DAMAGE` 0.05 (OC-A40), `EXPLORER_HUB_SCAN_RATE` 0.05 (OC-A41), `TACTICAL_SPEC_WEAPON_DAMAGE`
0.01 and `SCIENCE_SPEC_RELIC_FIND` 0.01 (OC-A42; "combat damage" built as weapon damage), `CAPTAIN_RACIAL_SCALE` 1
(OC-A43), and the sizes the user did not name for OC-B2 / OC-B3: `WORKS_DIRECTORATE_BONUS_CHANCE` 0.05,
`HOME_GUARD_PATROL_SHIELD` 0.05, `CIVIC_CHARTER_TRANSPORT_CREW` 1.

**Registry:** the 9 WR-6 entries are live (13 sensitivity checks across their contexts); new probes `fabricatorBonusShare`,
`patrolShieldPool`, `transportCrewDelivered`; the teardown context reads `hullTeardownFraction`. The registry throws
if a node or spec ever goes back to a placeholder. The Debug panel reads captain race ownership. simPlayer.test.ts's
"inert hub is dead" example moved to the Martian racial; Home Guard is pinned moving (`patrol:shieldLeft`).

**Goldens moved:** only `placeholderTalentGoldens.test.ts`, each source's own columns (reasons in MOVES); no other
golden in the suite moved. **For WR-12:** Help text and the 0.14.0 patch note (production owners of the hubs and
tactical / science specs gain their effects).

**Integration follow-up (2026-10-19, after the CP-8 and WR-6 merges):** the [PROVISIONAL] tags on the eight sizes above
dropped (user 2026-10-19, all Recommended). The Works Directorate roll is now keyed by the save's seed as well as the
process number (`worksDirectorateSeed`: the homeworld seed, the only per-save seed that differs between players, 0
without one), so job N no longer rolls identically in every save; no production save carries a stamped job yet, and
the only golden that moved is WR-6's own `industryHub` craft column. **Patch notes (WR-12) must tell current players
who own industryHub (Works Directorate), the Tactician or Explorer hubs (Combat Readiness, Survey Doctrine), the
tactical or science specs, Homeland Defense (Home Guard) or Citizenry (Civic Charter) that those now have real
effects.**

### WR-7: Ship systems (non-combat)

~~materialQualityChance (OC-D2)~~ (dropped from WR-7: Material Lines X1, user 2026-10-19 "Material Lines builds it";
BUILT in ML-3, 2026-10-21), crewStations / crewEfficiency lines (OC-D3), moduleSlots (OC-D4), favorsSpec (OC-D5),
statRatios (OC-D6, B11), quarters capacity with CP-5 (OC-D7), cargo / transit / fuel scope on expeditions and patrols
with G2-3 / G2-4 (OC-D8), DC repairSpeed in Ground Ops field repair (OC-D10), array cadence vs coverage (OC-D11, B12),
hull description truth (OC-D13), `sensorEffectScale`. The power budget (OC-D1) is wired here ONLY if the user puts it
in this slice; otherwise it stays in E-MOD and its entries stay `pending` on E-MOD. Goldens first (ship sheet for every
hull with every line, the CP-0 pattern).

#### WR-7 carry note (built 2026-10-29 on 4ff232e; two commits: goldens, then the wiring; no SAVE bump)

**Reconciled first (already live, no build):** moduleSlots (E-MOD EM-5 / EM-7: `ship:SHIP_TYPES:*:moduleSlots` live,
the shared module slot cap), materialQualityChance (ML-3, `ship:gearLine:materialQualityChance` live), the power budget
(EM-1 to EM-10; the one open row is `wear:WEAR_EFFICIENCY:reactorCore:powerOutput`, the user's EM-4 call), hull
descriptions (SF-6 heavy cruiser and battleship lines, EM-5 / EM-7 "most module slots": `ship:audit:hullDescriptions`
flips LIVE as a text row, every clause checked by trainingRunDisplay.test.ts and wr7ShipSystems.test.ts).

**Built:**
- OC-D11 "Split the two" (B12): `Expedition.arraySplit` (stamped at dispatch when the array's coverage is not 1): the
  scan rate reads the cadence alone and `coverageAttempts` scales each body's discovery attempts (the roll is 3 to 5:
  at the WR-7 build Wide 5 / 6 / 8, Focused 2 / 2 / 3; after the
  review retune Wide 4 / 5 / 6, Focused 2 / 3 / 4). The preview run carries the same stamp. `expeditionDispatchDisplay.ts arrayCharacterLine`: a true line
  per array kind (Bio-Resonance and Resonance had none). Rows `ship:audit:arrayCharacter`, new `ship:wr7:coverageAttempts`.
- OC-D6 "Unlisted = never rolls" (B11): `itemgen.ts varietyStatBias` (an empty statRatios stays neutral). The plating and
  emitter varieties list the WR-8 resist lines at `VARIETY_RESIST_RATIO` [PROVISIONAL 0.1]. Consequences named for the
  user: mass relief no longer rolls on any plating or emitter, the Hauler Hold, the Economy and Balanced Drives, the
  High-Output Core, the three prospecting rigs or the Pathfinder Suite; nor do the Prospector Hold's yield, the Sprint
  Drive's fuel or the cores' engine efficiency (each variety's ratios never listed them).
- OC-D10 "Field repairs too": `ShipEventBattle.dcRepairTimeReduction` (frozen at dispatch, written only above 0);
  `fieldRepairSeconds` applies it as the Shipyard does. A run without it repairs exactly as before.
- OC-D3 "They scale the module" + "Crew Stations also adds capacity": `crewModules.ts crewModuleLineScale` (x (1 +
  diminishing(points, 100) / 100)) on the quarters and bridge boosts; `crewStationsBerths` adds berths (1 per point at
  the build; a small curve after the review, below) [PROVISIONAL knee 100]. OC-D7 "Spread across divisions" (B22): `commandStructureWithBonus` (the
  division and rank caps are the role weights of the larger total; bonus 0 is the cached template, same reference);
  the Complement panel reads it. Rows: the gear lines, every `QUARTERS_MODULES:*:capacity` (Elite notApplicable: 0
  berths), `ship:audit:rrCrewModuleExtras`.
- OC-D8 "Speed counts everywhere": the tank and engine efficiency rows go live at the expedition reach gate G2-4 built
  (probe `reachGateFactor`: the gate's reach split back into one factor); the gear transit line got its seam (it was
  "WR-1 follow-up"; sheet and voyage live); cargo stays missions-only (`outOfScope` + a Help line in the Missions topic).
- Deleted: `sensorEffectScale` (no caller), `ShipTypeDef.equipmentSlots` (OC-C4 "Keep tested hooks": no planned use).

**Review round (2026-10-29, two commits: the review fixes, then the user's balance answers):** the quarters bonus never
removes a seat at any rank (`atLeastInclusive`, swept for bonus 1 to 200 on every hull and division); the module lines
are stamped per run (`moduleLines` on captain missions and short-range runs, carried each cycle; an unstamped run reads
its modules without the lines). User answers (USER ANSWERS 2026-10-29): Crew Stations berths ride a small curve,
`round(0.0416 x diminishing(points, 300))` [PROVISIONAL]: 25 points 1, 50 points 2, 113 points 4; Elite Quarters adds
none (its registry row's "adds no berths" is true and tested), the Guest Wing gains them. Arrays even per hour
[PROVISIONAL coverage]: Wide 1.25 (0.8 x 5 attempts = 1.00x Balanced), Focused 0.75 (1.3 x 3 = 0.975x); cores accepted as
built; `VARIETY_RESIST_RATIO` stays 0.1 [PROVISIONAL].

**Not built (owner "WR-7 follow-up"):**
- ~~OC-D8 patrol legs ("patrol legs scale with transitSpeedMult"). Built and measured in the WR-7 worktree, then held
  out: a cycle frozen with `legTicks` (written only when the rounded legs differ from the route's, so a speed-1 cycle
  and a cycle in flight keep their record), every route reader through one `patrolRouteOf`, reach and fuel left on the
  route's legs (distance). It moved about 240 patrol pins and behavior harnesses that fly a fixed route length (the
  Battleship's 3-tick legs take 5), so it is a slice of its own, goldens first (the WR-8 precedent). Every transit
  source's patrol context stays pending on it (`PATROL_LEGS_OWNER`).~~ BUILT (WR-7 follow-up, 2026-10-30 on 0fcee45;
  two commits: goldens, then the wiring; no SAVE bump): model.ts `patrolLegTicksFor` (each leg = the route's leg / the
  ship's sheet transit speed, rounded up, the mission rule), `PatrolMissionState.legTicks` (frozen at dispatch, tick.ts
  `patrolDispatchRoute`, and at each relaunch from economyTick's live sheet speed), `patrolRouteOf` / `patrolRouteTicks`
  read by the phases, wave schedule, route end, limp home (2x the frozen return leg), Constitution clock and cut, recall,
  the display replay, the dispatch forecast and the patrol card's route line; reach and fuel stay on the def. Registry:
  the transit sources' patrol context went live (the speed line, the ten hulls, the museum) and `ship:audit:patrolLegs`
  measures the sheet speed scaling the legs (divisor, within one tick). Goldens: patrolLegsGoldens (every patrol on every
  hull; 78 of 160 rows moved, all traced to the legs and returning with `PATROL_LEGS_SWITCH` off), wr7Goldens' 11
  patrol rows re-pinned; the golden files about other slices run with the legs off (patrolLegsSwitch.fixture.ts), every
  pin in them having returned with the switch off; harnesses that flew a fixed route length read `patrolRouteOf`. Only
  the sweeping transitSpeedMult scales the legs: the per-leg Fast Departure / Fast Return lifts stay missions and
  expeditions (they claim no patrol context).
- ~~OC-D5 favorsSpec ("+10% on its ship type"): its lines fold in three readers (equipmentStatMods, the Damage Control and
  Pathfinder effects) read live by missions in flight and per patrol cycle, so it needs a per-run stamp on missions,
  patrol cycles and expeditions first.~~ BUILT (WR-7 follow-up, 2026-10-29 on 502a0c8; two commits: goldens, then the
  wiring; no SAVE bump): model.ts `withFavoredLines` (every line of a favored piece x 1.1 [PROVISIONAL 10%] on a hull
  of its spec; the variety resolves from the stamped moduleVariant or the blueprint, so Standard Issue favors none).
  Readers: the sheet (shipDerivedStats), the Damage Control Suite (patrol patch-up, field repair, Shipyard repair, gear
  repair rates) and the Pathfinder Suite (expedition snapshot). Stamp `favoredSpec: 1` on captain missions, short-range
  runs and patrols (dispatch, carried every cycle); an unstamped run reads its pieces as stored. Expeditions freeze every
  reading at dispatch, so no stamp. Tooltip line (EquipmentTooltip, ui/favoredSpecText.ts). Registry row
  `ship:audit:favorsSpec` LIVE (sheet, mission:extraction, mission:shortRange). Goldens moved: wr7Goldens' nine favored
  sheet rows, favorsSpecGoldens' Prospector mission and Orion Pathfinder expedition, wiringGoldens' Shipyard repair
  process (the Destroyer's suite); each returns with FAVORED_SPEC_SWITCH off. Open: the gear repair rates read the suite
  favored also for a ship out on a run from before (one shared reading keeps offline == live).

**Goldens moved (each attributed by switching that one change off and seeing the pins return):** OC-D6 (the crafted
mints): emodEm2 / EM-4 / EM-5 / EM-0 crafted sheets and patrols, gearWear step 3 and step 4 crafted rows (incl. the
ground rows' crafted pieces), materialLines, ML-2, reactorFuel inspect, rarity LIVE and RESERVED mints; the EM-4
fixture's `ref` and `top` cores re-chosen (see emodEm4.fixture.ts: the best core 0.14.0 can mint is now an Efficient
Core at +35%, inside the user's +30 to +40% band). OC-D3: shortRange golden 3 (the quarters varieties' sheets), the
EM-0 full crafted loadout and EM-1 power numbers. OC-D7: shortRangeRelics recalls (the Guest Wing's berths fill more
crew). OC-D10: tactician goldens (the ship-event battle freezes the suite's reduction). Registry: the snapshot and
count pins (net -10 entries: ten `equipmentSlots` rows and `sensorEffectScale` out, `coverageAttempts` in).

### WR-8: Combat descriptors (positions, UNFED inputs, durability)

Positions and range (OC-D9, B3), the UNFED set and INERT descriptors (OC-D12), durability for non-weapon gear and
installed reactor / FTL pieces (OC-D14). This is the largest determinism risk: every patrol golden and the
`patrolReplay` parity proof move. **Goldens first** (every hull x both routes x Dispatch Once and Repeat, the forecast
band, the GO ship battles). The patrol cloak input (`particleTraceDetector`) stays `deferred` (T3).

#### WR-8 carry note (built 2026-10-22 on 8688c61; two commits: goldens, then the wiring; no SAVE bump)

**Built:** `combat/combatRules.ts` (the rules, their constants and the `CombatRulesStamp`). Every rule acts only on a
battle whose run carries the stamp: a patrol cycle is stamped when it starts (dispatch and EVERY relaunch, the
officerCombat precedent), an expedition's ship-event battle inputs at dispatch (`ShipEventBattle.combatRules`), and the
dispatch forecast reads the stamp a dispatch would write now (`crewOverlay.ts shipCombatRulesStamp`). In-flight runs
are byte-identical (proved: dispatched inside the test switch, advanced by the WR-8 engine, every Once patrol, ship
event and battle row equals the pre-WR-8 capture). Under the stamp:
- OC-D9: enemies open at `ENCOUNTER_OPEN_DISTANCE` and close; patrols `precharge`; a ship holds at its stance's band
  capped at its own reach (`resolveBattle.ts combatReach`, Sensor Power Drain included), and opens the range only when
  FASTER than its target (equal speed holds, so every fight closes). Combat speed = `RULES_COMBAT_SPEED` x sheet transit
  / hull base transit (gear, crew, captain, mass drag), frozen in the stamp.
- OC-D12: `WEAPON_RULE_TRAITS` (Point Defense and EMP anti-drone, Point Defense's Inhibit as a drone effect slot,
  Tachyon's own vs-Shields column, the Voltaic arc), the vs-Drones column on drone absorbs, an EW anti-drone hit
  disrupts a drone it does not destroy, the support pulse charges Overcharged Capacitors, the Inhibit reader
  (`droneCooldown`), pirate armor / dampening / evasion (`PIRATE_HULLS`), statuses carried between the waves of one
  cycle (`PatrolMissionState.playerStatusEffects`), and the installed Reactor Core and FTL drive qualities frozen in the
  stamp (`reactorQuality` / `ftlQuality`) set the combat pools.
- Gear lines (no stamp needed: gear is locked while out): `damageResist_*` on Hull Plating and `disruptionResist_*` on
  Shield Emitters on `familyResistPercent` (whole percents rounded down, so never 100); pod lines In-Combat Replenish
  and Smart Reflect (Defense pods only) on `podLineShare`. Rapid Charge is NOT in the pod pool (see the review fixes).
- Retired: `frameHp` / `COMBAT_FRAME_HP_FRACTION` and `CombatDefaultLoadout.builtInBays` (OC-D12 "coded or deleted").
  `ResolveOptions.objective`, `TargetingPolicy.escortShare` and the DoT rng are `seam` rows (OC-C4 "Keep tested hooks").

**Registry:** every WR-8 pending entry is live (combatDescriptorProbes.ts: exact seams for the open distance, speed
stamp, pools, Tachyon column, status carry and the gear lines; seeded battle events for the rest). New rows:
`ship:wr8:*` (weapon / drone range, stance, speed kite, the status readers, Voltaic, vs-Drones, persistence, Inhibit
source / reader, Overcharge, enemy mitigation), `ship:wr8:powerInCombat` pending on EM-3, `ship:wr8:ambushInPatrols`
deferred (T3: only a cloak ambushes). The hull and gear-line transit
speed flat checks at `patrol` now read the legs alone (`patrolOutboundTicks`): transit speed reaches combat now.

**Goldens moved (combatDescriptorGoldens.test.ts header names each one):** every patrol record, replay and state hash
(the stamp); outcomes: Freighter Sweep lost (was won), Hauler Warband lost (was won), Battleship Warband Repeat flies a
third cycle; forecast bands down on the hard routes; cloaked ship battles 7 flips to win, 2 to loss. The 30 golden files
pinned before WR-8 run with the rules switched off (`combatRulesSwitch.fixture.ts combatRulesOffForThisFile`, or
`withCombatRulesOff` around the pre-WR-8 tests in officerBonuses / officerStatFacets); the registry snapshots read
WR-8 back (`combatDescriptorRegistry.fixture.ts wr8ReadBack`). patrol-tick's attrition fixture re-seeded (19 -> 554);
simPlayer's training Sweep ends at 713 shield (was 732).

**[PROVISIONAL] (one constant each):** `ENCOUNTER_OPEN_DISTANCE` 300, `RULES_COMBAT_SPEED` 30 and `combatSpeedFor`
(relative to the hull; alternative absolute), `PIRATE_HULLS` armor / dampening / evasion (Raider 5/0/5, Marauder 20/5/3,
Corsair Carrier 15/5/0), `FAMILY_RESIST_KNEE` 50, `POD_LINE_KNEE` 20, `SUPPORT_OVERCHARGE_ESCALATION` 30, the
`WEAPON_RULE_TRAITS` numbers (Inhibit 40 / 25, Tachyon 110, Voltaic 30%), the resist line split (plating damage,
emitter disruption) and pool weights 1. Measured (100 seeds, veteran, Standard Issue, Balanced): Orion Sweep 94 -> 74%
win, Freighter Sweep 97 -> 86%, Carrier Warband 53 -> 25%, Destroyer Warband 19 -> 6% (Aggressive 14%): the balance
pass owns the numbers.

**For gear wear step 4:** WR-8 built "reactor and FTL from the installed piece" (quality, frozen in the stamp) and
flipped `ship:audit:qualityDurabilityMax` live; step 4 opens those pools at the piece's true condition (bridge.ts
`freshSystem` opens FULL today) and keeps battle wear, the start floor and `podDurability`. Its owner string
(`GEAR_WEAR_STEP_4`) can drop the installed-piece clause. **For WR-7:** OC-D6 "unlisted = never rolls" must list the
six resist keys in the plating / emitter varieties' `statRatios`, or they stop rolling (`ship:audit:familyResists`'s
roll probe fails loudly). **For EM-3:** add `powerSupplyPercent` to `CombatRulesStamp` (frozen at the cycle start
beside `speed`, every patrol cycle and ship-event run already carries the stamp) and read it beside
`reactorDamagePercent`; the reactor pool is the installed piece's under the stamp; flip `ship:wr8:powerInCombat`.
**For EM-4:** combat speed already reads the sheet's transit speed, so a reactor surplus lift on `transitSpeedMult`
also speeds combat (a combat golden move to name); `ship:audit:reactorCoreNet` stays EM-4's.

**Review fixes (2026-10-22, one commit):** (1) Rapid Charge could never act in 0.14.0 (only an explorer on an
expedition is ambushed, and no explorer has a drone bay), so `droneRapidCharge` is out of `DRONE_POD_AFFIX_POOL` and
`ship:audit:rapidChargeAfterAmbush` plus the new `ship:wr8:podRapidChargeLine` are DEFERRED (owner "CP-15 patrol cloak,
T3, or explorer drone bays"); the engine reader stays (resolveBattle's return-fire delay, bridge.ts podLinePoints) and
`combatEventRapidCharge` is their check once a podded ship can be ambushed. Re-pinned: itemgen.test's pod vocabulary,
pool and craft preview (the line gone), the switch fixture (two pod lines). (2) `droneTakesHit`: a drone that survives
takes the whole projectile (no rounding leak; only a destroyed drone passes overflow), with a test. (3) The stance help
(App.svelte HelpTip, helpTopics.ts Combat Patrols) states the rule: the stance's range, never beyond the longest
weapon's reach, only a faster ship opens the range. (4) statusEffects.ts names Inhibit's and Overcharged Capacitors'
sources and readers. (5) `familyResistPercent` rounds down (tops out at 99), with a test. No golden moved.
**HELD for the user:** `safeFirstPatrol.sweep.test.ts` CURVE_WINS (the SF-4 curve table: every hull's wins per curve
position moved under the rules; the "wins never rise as the curve climbs" check still passes), and pirate armor, open
distance and the reach rule. (Released by the user's decisions below.)

**User decisions on the balance drop (2026-10-22, one commit):** the rule: "if it's a systemic issue, we fix the
systemic issue. But the actual balancing of the content can wait. If it's just a balancing numbers thing, option 1."
- A, the system fix: the stances decide where a ship parks (`resolveBattle.ts stanceHoldDistance`, under the stamp
  only). Aggressive: its shortest firing gun's reach. Balanced: the farthest reach at which the sources reaching it
  deliver more than `BALANCED_FIREPOWER_SHARE` (0.5) of its expected damage (exactly half is a tie and goes closer), so
  a Standard-Issue Destroyer parks at autocannon range. Defensive: its longest reach, backing off only when faster.
  "Standoff" is DEFENSIVE everywhere player-facing (App.svelte stance button and help, helpTopics.ts, CombatView); the
  stored key stays `standoff`. Defensive (`combatRules.ts DEFENSIVE_STANCE`, set by bridge.ts on a combatant built
  under the rules) does all four: 20% less damage taken and 10% less dealt (guns and drones), shields recharge 25%
  faster and stop 15% more per point, Point Defense / EMP and drone squadrons turn on the in-range foe fielding the
  most drones first (`guardTarget`), and 30% missile intercept with working Point Defense or EMP. Every percent banks
  its remainder (`Combatant.defensiveCarry`, the shield's `shieldBonus` accumulator), so it is exact over a fight, not
  a floored point per small hit. Every pirate flies its own stance under the same rules, so the Corsair Carrier
  (stored `standoff`) is Defensive too.
- B, the numbers (option 1 "Soften pirates for now"): Raider armor 3 / evasion 3 (was 5 / 5), Marauder 10 / 2 (was
  20 / 3), Corsair Carrier 8 / 1 (was 15 / 0), no pirate dampening (a percent dampening floors a whole point off every
  small hit; the field and its three registry rows are gone).
- Registry: new live rows `ship:wr8:stanceAggressive` / `stanceBalanced` / `stanceBalancedShare` / `stanceDefensive`
  (exact parking seams on Standard-Issue patrol builds) and `ship:wr8:defensiveDamageTaken` / `DamageDealt` /
  `ShieldRecharge` / `ShieldAbsorb` / `GuardWeapons` / `GuardDrones` (exact curves or seeded battles);
  `ship:wr8:defensiveMissileIntercept` is PENDING (the engine reads it; no pirate or ship-event vessel installs a
  missile in 0.14.0). The stance and kite rows' claims were rewritten.
- Measured (100 seeds, veteran, Standard Issue, Balanced; pre-WR-8 / first WR-8 pin / now): Orion Sweep 94 / 74 / 87,
  Freighter Sweep 97 / 86 / 88, Carrier Warband 53 / 25 / 42, Destroyer Warband 19 / 6 / 15, Battleship Warband 80 /
  67 / 79. Stances now (Aggressive / Balanced / Defensive): Destroyer Sweep 100 / 100 / 100, Warband 15 / 15 / 12;
  Carrier Sweep 100 / 100 / 100, Warband 42 / 42 / 40. Orion and Battleship land on target; Freighter, Carrier and
  Destroyer stay short, and the pirate numbers cannot close it (zero pirate armor and evasion: 88 / 88 / 45 / 18 / 82).
  The shortfall is the approach itself: data points for the balance pass (same five): open at 200 instead of 300:
  85 / 89 / 39 / 16 / 82; no patrol precharge: 86 / 92 / 43 / 20 / 82; pirates without the Defensive modifiers:
  87 / 88 / 45 / 15 / 82. [PROVISIONAL]: every DEFENSIVE_STANCE number, BALANCED_FIREPOWER_SHARE, the pirate numbers.
- Goldens moved (combatDescriptorGoldens.test.ts header names each): the Freighter wins its Sweep again (Once and all
  three Repeat cycles); the Battleship Warband Repeat loses its second cycle (tick 40); forecasts Freighter Sweep 56,
  Destroyer Warband 9, Battleship Warband 53 likely, Carrier Warband 29 dice, Orion Sweep 58 likely; the Cloaked
  Vessel (Balanced, autocannon plus railgun) parks at autocannon range, so the default-seed cand-2 expedition loses
  its cloaked fight for all three explorers and the battle grid loses a few more cloaked fights. CURVE_WINS re-pinned
  with the pre-WR-8 table in its header: the early Sweep stays gentle (194+ of 200 through c4 on every hull); the early
  Warband is harder for the light hulls (Freighter c0 129, was 181). simPlayer's training Sweep ends at 751 shield
  (was 713). In-flight runs stay byte-identical.
- For WR-12: the patch note names the stance "Defensive"; the shipped patch notes stay as written.

**User decision on the remaining gap (2026-10-22, answer 5 "Closing is evasive (Recommended)", one commit):** under
the stamp every combatant carries `evasiveClose` (bridge.ts); in its movement phase it is active while the ship can move,
its target is farther than where it parks and none of its working guns reaches any foe (a gunless ship reads its
offense squadrons; a ship with no source never evades). While active every hit is `CLOSING_EVASION_PCT` (40,
[PROVISIONAL]) smaller, banked so it is exact, never 100. Both sides. No draw, so offline == live; in-flight runs stay
byte-identical. Also fixed here: resolveBattle's clone now copies the banked Defensive and evasive remainders (the
second commit shared them with the caller, so a second resolve of the same input could differ), with a test.
- Registry: `ship:wr8:closingEvasive` live (`combatEventClosingEvasive`: an autocannon ship closing on a railgun
  platform takes less). Stance help (App.svelte, helpTopics.ts) says a ship closing in is harder to hit.
- Measured (same five; pre-WR-8 / before answer 5 / now): Orion Sweep 94 / 87 / 88, Freighter Sweep 97 / 88 / 90,
  Carrier Warband 53 / 42 / 39, Destroyer Warband 19 / 15 / 15, Battleship Warband 80 / 79 / 78. Stances (Aggressive /
  Balanced / Defensive): Destroyer Sweep 100 / 100 / 100, Warband 15 / 15 / 10; Carrier Sweep 100 / 100 / 100,
  Warband 39 / 39 / 41. 70% and 90% move nothing further (Freighter 92, Carrier 40 / 37, Destroyer 12 / 13): the
  approach is about 7 s of a long fight and both sides close. Ablations (each piece switched off with the rest live):
  the pre-WR-8 numbers come back exactly (94 / 97 / 53 / 19 / 79) only with ALL of open distance, precharge, status
  carry, the vs-Drones column, pirate mitigation, Point Defense traits and pirate Defensive off; with everything but
  the open distance off, 92 / 95 / 46 / 23 / 88. The Carrier's gap is spread across those rules, not the approach.
- Goldens: patrol outcomes and ticks hold (replays and hashes move); forecasts Freighter Sweep 58, Battleship Warband 52,
  Carrier Warband 26 (bands hold); ship events unchanged (the default-seed cand-2 cloaked fight is still lost for all
  three explorers); three cloaked battle-grid fights won back. simPlayer's training Sweep ends at 737 shield (was 751).
- CURVE_WINS: at 200 seeds the "wins never rise" check failed by one or two seeds (Aurora Warband c3 19 -> 20) at every
  value from 20 to 60; per seed the c2 -> c3 step flips about a dozen outcomes each way, so it is sampling noise. The
  curve now runs 400 seeds (`CURVE_SEEDS`), where every row falls; the pre-WR-8 200-seed table stays in the header.
  Freighter Warband c0 is 262 of 400 (131 of 200; it was 181 of 200 before WR-8): closing evasion does not restore the
  light-hull early Warband. The 400-seed sample was approved by the user (answer 7).

**User decisions 6 and 7 (2026-10-22, one commit):** (6) "Ship it, soften early curve": the WR-8 rules and numbers stay
as c627efe left them (tougher full-strength Warbands are 0.16.0 balance); for peace now the existing safe-first patrol
curve starts lower for a cycle under the combat rules: `runDifficulty.ts PATROL_RULES_RAMP_FLOOR` 0.2 [PROVISIONAL]
(the shared `RAMP_FLOOR` stays 0.35 for expeditions, short-range runs and pre-WR-8 cycles), the same climb, exactly
nominal at full strength, so c10 is unchanged. Picked from floors 0.2 to 0.35 and an ease-in exponent 1 to 1.5 (200
seeds): 0.2 with the plain climb is the closest single curve (a higher floor leaves the Freighter and the explorers
harsh, an exponent makes c2 and c5 far too easy). (7) 400 seeds for the monotonicity sweep: approved.
Curve, Warband wins of 200 at c0 / c2 / c5 / c10 (pre-WR-8 -> now; now measured of 400 and halved):
Freighter 181 / 135 / 49 / 5 -> 186.5 / 158.5 / 50.5 / 3; Hauler 194 / 170 / 75 / 10 -> 196 / 181 / 77 / 4.5; Runner
60 / 24 / 5 / 0 -> 83.5 / 48 / 5 / 0.5; Miner 80 / 36 / 7 / 0 -> 119.5 / 67 / 8.5 / 0.5; Destroyer 200 / 198 / 173 / 44
-> 199.5 / 197 / 166 / 32; Battleship 200 / 200 / 199 / 158 -> 200 / 200 / 200 / 174; Carrier 200 / 200 / 197 / 109 ->
200 / 200 / 187.5 / 75; Orion 105 / 77 / 21 / 1 -> 94.5 / 63 / 11.5 / 1; Aurora 97 / 68 / 15 / 1 -> 84.5 / 54.5 /
11.5 / 1; Eir 106 / 75 / 18 / 1 -> 98.5 / 64 / 12.5 / 1. Every Sweep row is 400 of 400 through c4. Every row still falls
as the curve climbs. No default-suite golden moved (the combat goldens fly veterans); `safeFirstPatrol.test.ts` reads
the rules floor for a live dispatch.

**Follow-up review fixes (2026-10-23, one commit, after the feat merge ce8721d):** (1) a weapon's on-hit module procs
fire on the ship the shot struck (`aim`: a Defensive ship's guard shot), not its target. (2) The guard drone volley
(`fireSquadronAtDrones`) returns what it did: the struck foe's on-hit procs fire when a drone connects, its log line
carries the real damage (`screenDamage` plus the shield / hull split) and `dronesDestroyed`, a kill logs `destroyed`,
and the Simplified log says "hits X's drone screen for N, downing D". (3) The evasive close is read after the move,
so it stops the tick a gun reaches. (4) A shield hit that drains the pool banks no absorb remainder. (5) The stance
help says Defensive point defense goes after drones first "and missiles, when enemies carry them". (6) "installed"
in shipModuleProcs.test.ts. Tests for each code fix (combatDescriptors.test.ts). Goldens: only fix 3 moves an
outcome (an ablation with it undone reproduces the last pin): eir cand-2 loses one cloaked battle-grid fight again,
forecasts Freighter Sweep 57 and Carrier Warband 23 (not advised, was 26 dice), simPlayer's training Sweep 733 shield;
fixes 2 and 4 move only the Warband patrols' replays and hashes. CURVE_WINS re-pinned for fix 3 (48 cells, 9 of 400
at most; Freighter Warband c0 still 373), every row still falls.
**Coverage note (for WR-12 / 0.16.0):** after the merge no golden pins the combat rules, gear wear and ship modules
TOGETHER: combatDescriptorGoldens runs with use wear off and no modules, and the EM-6 and gear wear goldens run with
the combat rules off. A combined capture (a stamped patrol and expedition with worn gear and installed modules) is
logged for WR-12 or the 0.16.0 balance pass.

### WR-9: Crew and officers beyond the CP slices

Pilot Cunning (OC-E4), the transit split (OC-E5), Rapid Loadout scope (OC-E6), Morale Anchor's attrition half (OC-E7),
Museum crewBonuses on officers (OC-E8), Command Presence and Operations Integrity on expeditions (OC-E9), `enlisted`
(OC-E11), the third buff (OC-E12), the Constitution cycle-1 ramp (OC-E13, B17), Counter-Infiltration / Prevent a Crew
Loss / Crew Output Multiplier readings (OC-E1 to OC-E3, feeding CP-2 / CP-3 as their consumers). Runs AFTER CP-2 and
CP-3 (shared `crewOverlay.ts`, `groundOps.ts`).

### WR-10: Away team and ground beyond Field Kits and CP-3

Shroud and Lure on Ground Ops (OC-F1, with FK-7), Neural Backup (OC-F2, B13), Med Kit (OC-F3), Saboteur and status
chance (OC-F4), Quick Draw (OC-F5), Fall Back (OC-F6), Science rank (OC-F7), Corroded (OC-F9), the Science gambit
actions (OC-F10), the Prospecting team type (OC-F11), the account gambit pair (OC-F12), the fall-outcome hook (OC-F13),
player-ordered field repair UI (OC-F14). Runs AFTER FK-4 to FK-7 and CP-3 (shared `gambit.ts`, `groundFight.ts`,
`groundOps.ts`, `medicalBay.ts`). Goldens: reuse FK-3 plus a WR capture.

### WR-11: Expeditions, relics, missions, salvage leftovers

PoI flavor (OC-G4), site flavor (render), the anomaly (OC-G3, B15), `relicSignature`, ShipEventProfile frozen fields
(OC-G5), planet comments (OC-G6), MISSIONS.cargoCapacity (OC-I1), the unused factions (OC-I2), the salvage ceiling
(OC-J1), `rolled` narration (OC-J2), dead-end loot (OC-J3), unreachable affix counts (OC-J4), Museum science team power
and salvage yield scope (OC-H1, OC-H2), status `color`. Runs after SF-2 / SF-3 and G2-2 / G2-3 land (shared
`expedition.ts`, `riskFactors.ts`). Goldens: G2-0 and SF-0 plus a WR capture.

### WR-12: Close-out

`RELEASE_GATE=1` passes (no `pending` entry left; every `deferred` entry has a user ref); `SIM_FULL=1` passes; the
Help text for every newly live effect (Task 34 style); the curated desktop + mobile QA sheet (section 7); holistic
review; staging only on the user's word (capture section 4: after the T2 fix lands AND this gate passes).

## 5. OPEN CALLS for the user

Every row: **[PROPOSAL]** is the build default (marked [PROVISIONAL] in code until answered); alternatives follow. No
row introduces a new game entity; every proposal plugs into an existing value (file:line in section 2).

### 5.A Captain (42 calls: 3 general, 35 secondary nodes, 4 primary)

- **OC-A1, default meaning of "+X% stat".** [PROPOSAL] a relative multiplier on the named existing value, added to
  that value's other bonuses before its existing curve (so the D23 curve applies where the value already has one).
  Alt: a flat add; each node individually.
- **OC-A2, where and when a captain's talents act.** [PROPOSAL] on the ship that captain commands, frozen at dispatch
  for runs (logistics4 precedent) and per cycle for patrols. Alt: fleet-wide; live (not frozen).
- **OC-A3, capstone magnitudes and placeholders.** [PROPOSAL] give every capstone the magnitude in the table and
  replace every "No bonus yet" with the proposed real effect, so no placeholder remains. Alt: remove placeholder nodes
  and rebalance the branch; keep (violates T1).

Secondary nodes (the nine marked "no call" build exactly as their text says):

| node | text | [PROPOSAL] | alternatives |
|:-|:-|:-|:-|
| extraction1 Prospector's Eye | +5% extraction yield | x1.05 on the ship's extractionYieldMult (all tiers, extraction + survey; tick.ts:2103) | +0.05 on each tier yield mult; common tier only |
| extraction2 Deep Veins | 5% rare/uncommon find | +5% relative on uncommonChanceMult and rareChanceMult (existing rolls, no new draw) | +5 points absolute; a separate per-cycle bonus find roll |
| extraction3 Efficient Haul | +8% extraction speed | no call: shorter extracting phase through the Museum extractionSpeed fold (model.ts:3720) | |
| extraction4 Assayer | 5% material quality | +5% to the delivered unit's quality climb through rollQuality's bonus at tick.ts:4317 | Refinery output quality; salvage quality |
| extraction5 Motherlode | double haul / rare burst | 5% per delivered cycle: the haul doubles (private salted stream, chanceRound) | +1 rare unit roll per cycle |
| logistics1 Quartermaster | +5% cargo | effectiveShipStats cargo; counts toward requiresCargoCapacity gates (like ops.cargoExpand) | excluded from gates |
| logistics2 Fuel Discipline | +5% fuel efficiency / reach | engineEfficiency (reach and burn, one value) | reach only; burn only |
| logistics3 Rapid Turnaround | +8% unload | both mission unloadSpeedMult and Ground Ops offload (like ops.unloadSurge) | missions only; Ground Ops only |
| logistics5 Overloaded Holds | carry beyond cap | +10% cargo above the hull with no unload penalty for the overflow | a different X |
| trade1 Market Contacts | No bonus yet | +5% transport rewardMargin on the two supply runs (tick.ts:2385) | remove; wait for a trade system |
| trade2 Shrewd Negotiator | better buy prices | -5% transport supplyCostPerCargo (model.ts:706) | remove; wait |
| trade3 Premium Goods | better sell margins | +5% transport rewardMargin (stacks with trade1) | +5% Quartermaster sellValue |
| trade4 Trade Routes | passive income | a credit trickle per delivered transport cycle, paid while docked [PROVISIONAL 1 credit/tick] | remove; wait |
| trade5 Trade Baron | best margins + trickle | x2 the trade1 to trade4 values | a flat margin bump |
| gunnery1 Weapons Drill | +5% weapon damage | no call: OfficerCombatMods.weaponDamage path (bridge.ts:718) | |
| gunnery2 Marksman | +5% accuracy | x1.05 on weapon accuracy (existing clamp) | +5 accuracy points |
| gunnery3 Overcharge | +8% damage vs high-health | +8% while the target is above 50% hull (mirror underFire) | scale with target hullMax; until first breach |
| gunnery4 Ammo Reserves | +8% faster cooldown | no call: cooldown / 1.08 | |
| gunnery5 Alpha Strike | opening volley bonus | +50% damage on the first round | double damage on the first volley |
| aegis1 Shield Discipline | +5% shield | no call: OfficerCombatMods.shield (bridge.ts:725) | |
| aegis2 Reinforced Hull | +5% hull / armor | the hull pool via OfficerCombatMods.hull | plating armor; both |
| aegis3 Damage Control | +8% hull repair rate | all three repair systems (Shipyard divisor, between-wave regen, Ground Ops field repair) | Shipyard only |
| aegis4 Point Defense | +5% evasion | combat evasion (patrol + ship-event battles) | also expedition encounterEvasion |
| aegis5 Bulwark | survive one lethal hit | once per battle, a lethal hit leaves 1 hull | a damage floor |
| fleetOps1 Drone Handler | +5% drone effectiveness | drone damage yield | drone hp; replenish rate |
| fleetOps2 Squadron Tactics | +5% drone durability | no call: drone hp | |
| fleetOps3 Patrol Efficiency | +8% patrol returns | +8% wave loot (materials and credits) through rollWaveLoot's existing rounding | credits only; less patrol fuel |
| fleetOps4 Wing Commander | No bonus yet | +5% drone replenish between waves (droneDefense.ts:175) | remove; wait for multi-ship |
| fleetOps5 Wolfpack | extra squadron | +1 drone squadron launched (one more pod's worth from installed pods) | +5% to all combat mods |
| surveySensors1 Keen Sensors | +5% sensors | x1.05 on ShipDerivedStats.sensors (survey and expedition); does nothing at 0 sensors | a flat +sensors |
| surveySensors2 Cartographer | +8% scan rate | no call: scanSpeedBonus (expedition.ts:1174) | |
| surveySensors3 Anomaly Sense | rare / anomaly detection | +5% relative discovery chance (expedition.ts:1357) | crewRareFind; the anomaly chart chance |
| surveySensors4 Foreknowledge | No bonus yet (preview) | +1 telescope detail level for candidates (telescope.ts:166) | lower reveal thresholds |
| surveySensors5 Deep Scan | full reveal + rare find | full foreknowledge at launch; each body's first discovery attempt succeeds | +1 relic tier on one find |
| expeditionRelics1 Expedition Lead | +5% ground team effectiveness | x1.05 securityStrength and scienceStrength (gambit.ts:1346) | member stats; fieldwork yield |
| expeditionRelics2 Field Science | +relic chance | no call: relicFindBonus +0.05 (the Keen Eye trait unit) | |
| expeditionRelics3 Away-Team Doctrine | +5% gambit win odds | +5% squad power and accuracy | stronger program effects; a retreat-safe chance |
| expeditionRelics4 Preservationist | +8% relic quality / research | -8% relic study time (relics.ts:117) | relic tier bias in rollRelicToken |
| expeditionRelics5 Relic Hunter | guaranteed relic / +tier | +1 relic tier ceiling (gambit.ts:1701) | first vault each run always drops a relic |
| commandCrew1 Inspiring Leader | +5% crew effectiveness | no call: scale shipCrewContribution (crewOverlay.ts:236, the CP-2 seam) | |
| commandCrew2 Mentor | +5% officer output | x1.05 officerBonusTotal (crewOverlay.ts:362) | faster candidate refresh |
| commandCrew3 Drillmaster | +8% promotion progress | no call: x1.08 promotion counter increments (needs B4 fixed) | |
| commandCrew4 Recruiter | +8% candidate roster | +1 candidate on both boards (8% of 10 rounds up); the 0.14.x board upgrade stacks later | complement caps |
| commandCrew5 Legendary Captain | crew multiplier + officer aura | +10% to all complement buffs and officer bonuses on the captain's ship | crew only |

- **OC-A40, tacticianHub.** [PROPOSAL] +5% weapon damage on the captain's ship (unlocking the branch stays). Alt: +5%
  shields; a gate only with honest text.
- **OC-A41, explorerHub.** [PROPOSAL] +5% expedition scan rate. Alt: +5% sensors; gate only with honest text.
- **OC-A42, tactical / science spec bonuses.** [PROPOSAL] mirror resourcefulness: tactical +1% combat damage, science
  +1% relic find; the stale spec card text is rewritten. Alt: no spec bonus and honest card text.
- **OC-A43, captain race.** [PROPOSAL] the captain carries the race's racial at the officer magnitude (the existing
  `officerRacialBonus` path). Alt: identity only (and the "follow-on" comment goes).

### 5.B Fleet Admiral (3 calls)

- **OC-B1, Salvage Operations on hull teardown.** [PROPOSAL] add the yield bonus to `salvageShip` (salvage.ts:911) and
  say "+10 points" in the text. Alt: recycle only and fix the "spare hull" flavor.
- **OC-B2, Works Directorate (industryHub).** [PROPOSAL] the bonus-output chance on Fabricator crafts SUGGESTIONS ~980
  describes, resolved in bulk for offline batches, and its text names the Refinery gate it already is. Alt: a pure gate
  with honest text; a refine speed bonus.
- **OC-B3, Homeland Defense and Citizenry hubs.** [PROPOSAL] Homeland Defense: +5% patrol shields; Citizenry: +1 crew
  per transport batch (`TRANSPORT_BATCH_SIZE`). Alt: hide both until their systems exist and refund the AP.

### 5.C Facilities, items, framework seams (4 calls)

- **OC-C1, Fuel Depot remnants and `buyFuel`.** [PROPOSAL] remove the retired Depot rungs, `state.fuel`, the FUEL_*
  depot constants and `buyFuel` (credits refunded for any fuel bought, at the buy price). Alt: turn the storage rungs
  into a range bonus; keep everything hidden (violates T1).
- **OC-C2, Warehouse T2 and Dense Ore.** [PROPOSAL] hide Warehouse T2 until tier-2 content exists and refund rung 1.
  Alt: add a Dense Ore source (a mission primaryMaterial or expedition loot); point T2 at existing goods.
- **OC-C3, Reclaimed Alloy and Purified Biomass.** [PROPOSAL] add refine recipes scrapAlloy -> reclaimedAlloy and
  fibrousBiomass -> purifiedBiomass (which also gives scrapAlloy a use, OC-J3). Alt: reword as a future recipe;
  salvage outputs.
- **OC-C4, framework seams with no data** (`requiresFacilityLevels`, `requiresMissionCompletions`,
  `MISSION_CONTROL_UNLOCK_COMPLETIONS`, captain gear gates, `ItemDef.equipStats`, `achievementBoost`, `ascension`,
  `equipmentSlots`, `taskChainFollowUp`, affix `calmObjective` / `weightFor`). [PROPOSAL] keep the ones whose logic is
  correct as `seam` entries, each with a fixture test proving it works when data arrives, and an owner; delete the ones
  with no planned use (`equipmentSlots`, `ascension`, `ItemDef.equipStats`). Alt: delete every unused seam; keep all.

### 5.D Ship (14 calls)

- **OC-D1, the power budget** (reactor powerOutput, powerDraw on every piece, powerDrawReduction, Reactor Overdrive,
  Power Discipline, the Martian racial). [PROPOSAL] an install gate (`canFitByPower` at the install check) plus a
  combat over-budget penalty, in E-MOD as designed; this plan only registers them. Alt: install gate only; keep
  non-binding and soften the UI copy (leaves 7 dead effects: violates T1).
- **OC-D2, materialQualityChance.** [PROPOSAL] a chance that a delivered unit climbs one quality step (the existing
  rollQuality bonus at tick.ts:4317). Alt: Refinery output quality; a chance to deposit the next material tier.
- **OC-D3, crewStations / crewEfficiency rolled lines.** [PROPOSAL] they scale the module's effect (`moduleEffectScale`,
  crewModules.ts:58), crewStations also adding capacity. Alt: hide them in the tooltip and stop rolling them.
- **OC-D4, moduleSlots.** [PROPOSAL] a cap on how many module-class slots (bridge, quarters, sensor, specUtility) a hull
  can fill, enforced at install. Alt: extra specUtility slots per hull; delete the field and fix Aurora's text.
- **OC-D5, favorsSpec.** [PROPOSAL] +10% to the piece's lines when installed on a hull of the favored spec. Alt: bias the
  crafted variety roll; a UI hint only.
- **OC-D6, statRatios.** [PROPOSAL] an absent key defaults to weight 0 (fixes B11). Alt: a real budget split by ratio;
  fix the comments only.
- **OC-D7, quarters capacity.** [PROPOSAL] the bonus spreads across division caps by the hull's role weights (with CP-5).
  Alt: a wing adds to its own division; the Crewman cap only.
- **OC-D8, cargo / transit / fuel beyond missions** (hull, gear, crew and the Museum transit bonus). [PROPOSAL]
  expedition transit and range come from G2-3 / G2-4 (the voyage engine and reach gate); patrol legs scale with
  transitSpeedMult; cargo stays missions-only and its text says so. Alt: missions-only for all, with honest text.
- **OC-D9, combat positions.** [PROPOSAL] enemies spawn at range and close (enemyWave.ts:227, shipScanEvents.ts:367);
  stance and weapon range then matter; patrols gain `precharge`. Alt: co-location is intended, so stance, range and
  speed are deleted; range on expeditions only. (Moves every patrol golden either way.)
- **OC-D10, Damage Control Suite in Ground Ops field repair.** [PROPOSAL] frozen in the ship-event snapshot
  (shipScanEvents.ts:162) and applied in the field repair time. Alt: Shipyard only, with honest text.
- **OC-D11, sensor array cadence vs coverage.** [PROPOSAL] coverageWidth drives the discovery attempts
  (expedition.ts:1355) and scanRateMult alone drives the rate, so Focused is truly faster. Alt: keep the product and
  fix the UI copy.
- **OC-D12, the combat UNFED and INERT descriptors.** [PROPOSAL] antiDrone on the PDA and EMP defs; the resist families
  join the plating and emitter affix pools; inhibit from the PDA; overchargedCapacitors from the support drone pulse;
  rapidChargeAfterAmbush and inCombatReplenishPercent and smartReflect as defense-pod affix lines; enemy armor and
  evasion on the pirate hulls (armorPen, manifoldOverheat); statuses persist across waves of one patrol; the comment-only
  exceptions get coded or deleted. Alt: delete each unused descriptor.
- **OC-D13, hull descriptions.** [PROPOSAL] make the text true where an owning slice makes it true (CP-5 crew sizes,
  G2 reach and speed, OC-D4 module slots) and rewrite the rest. Alt: rewrite all now.
- **OC-D14, durability for non-weapon gear** (economy, defense, crew, sensor, member pieces, pods, installed reactor
  and FTL). [PROPOSAL] pods and installed reactor / FTL pieces wear in battle like weapons; economy, crew, sensor and
  member durability is removed until persistent wear exists. Alt: all wear; all removed except weapons.

### 5.E Crew and officers (13 calls; CP plan OC-1, OC-3, OC-4 still open and not recounted)

- **OC-E1, Counter-Infiltration.** [PROPOSAL] the squad's resist to enemy-inflicted statuses (CP-3 reading). Alt: a
  ship-side boarding resist (its name).
- **OC-E2, Prevent a Crew Loss.** [PROPOSAL] shorter bay time (CP-3 reading). Alt: a chance to prevent a downing.
- **OC-E3, Crew Output Multiplier.** [PROPOSAL] mission and patrol haul (CP-2 reading). Alt: all crew output.
- **OC-E4, Pilot Cunning.** [PROPOSAL] a chance per mission cycle to shorten the return leg by one tick (Flight Deck
  over-delivery). Alt: patrol relaunch speed; expedition encounter evasion.
- **OC-E5, Fast Departure and Fast Return.** [PROPOSAL] each acts on its own leg (model.ts:3719 vs 3727). Alt: keep
  the merge.
- **OC-E6, Rapid Loadout.** [PROPOSAL] Ground Ops reload only (missions have no load phase) and the text says so. Alt:
  add a mission load step.
- **OC-E7, Morale Anchor "complement attrition".** [PROPOSAL] drop the attrition half from the text (no system exists
  or is planned). Alt: build attrition.
- **OC-E8, Museum crewBonuses.** [PROPOSAL] also multiply officerBonusTotal. Alt: complement only, text says so.
- **OC-E9, Command Presence and Operations Integrity on expeditions.** [PROPOSAL] Command Presence scales Ground Ops
  objective hauls; Operations Integrity steadies the Ground Ops offload. Alt: missions and patrols only, text says so.
- **OC-E10, promotion counters (B4).** [PROPOSAL] crewHours from the officer's ship hours out on any run; shipsDestroyed
  from patrol and ship-event kills; personnelAchievement from objectives completed by the ship's squads. Alt: replace the
  objective sets with simpler time-based promotion.
- **OC-E11, the `enlisted` flag.** [PROPOSAL] delete (identity only). Alt: enlisted ranks take no exclusive buff.
- **OC-E12, a third buff at buffCount 3.** [PROPOSAL] the top rank rolls a third buff from its profession pool. Alt:
  the count stays 2 and the label changes.
- **OC-E13, Constitution on patrol cycle 1 (B17).** [PROPOSAL] cycle 1 ramps at its own mid-cycle sample, like
  relaunches. Alt: by design (a fresh patrol starts at 0 hours), text says so.

### 5.F Away team and ground (15 calls; FK open calls 6, 7, 8 still open and not recounted)

- **OC-F1, Shroud and Lure on Ground Ops.** [PROPOSAL] they scale the ground ambush and reinforcement chances, and Lure
  adds a drop scale on probe salvage. Alt: keep the ship-event chance (FK-7 default) and reword.
- **OC-F2, Neural Backup (B13).** [PROPOSAL] it revives the wearer only. Alt: keep any ally and fix the flavor.
- **OC-F3, Med Kit "keeps a downed friend in the fight".** [PROPOSAL] fix the flavor (revive belongs to Neural Backup and
  FK-5 kits). Alt: a weak revive on the Med Kit.
- **OC-F4, Saboteur and the Debuff spec status chance.** [PROPOSAL] status chance also gates Suppress's status
  (gambit.ts:830), so both act without inflict gear. Alt: FK-1's grenade-only bonus.
- **OC-F5, Quick Draw.** [PROPOSAL] the member acts before stun and fear checks on the opening round. Alt: an extra
  opening action.
- **OC-F6, Fall Back.** [PROPOSAL] the member gains Shielded for the round. Alt: an evade; an alias of Hold with honest
  text.
- **OC-F7, Science member rank.** [PROPOSAL] rankFactor multiplies fieldwork (fieldwork.ts:129). Alt: rank stays trait
  count only, text says so.
- **OC-F8, the Cortex Shield stun half.** Answered in FK open call 6 (not recounted).
- **OC-F9, Corroded.** [PROPOSAL] some enemy casters inflict it (the withFloraToxins post-generation pattern). Alt:
  retire Corroded.
- **OC-F10, the Science gambit actions (shieldAlly, analyze, secureObjective, takeCover).** [PROPOSAL] delete them
  (Science never fights, D2). Alt: use them in fieldwork rounds.
- **OC-F11, the Prospecting team type.** [PROPOSAL] remove it until a prospecting ground role is designed. Alt: design it
  now.
- **OC-F12, the account gambit pair (D19).** [PROPOSAL] delete the unused account fields. Alt: account-wide defaults
  applied to new members.
- **OC-F13, the fall-outcome hook (Safety Interlock).** [PROPOSAL] keep as a `seam` owned by the safety interlocks the
  user named in T2 ("with safety interlocks disengaged, you will die"). Alt: delete until then.
- **OC-F14, player-ordered field repair.** [PROPOSAL] a button on the expedition ship lane (needs a sketch). Alt: delete
  the engine path.
- **OC-F15, the grenade and kit counts on the legacy path.** Folded into OC-G1 (not recounted).

### 5.G Expedition content (6 calls)

- **OC-G1, the legacy expedition path.** [PROPOSAL] legacy-only effects are accepted as PARTIAL by design (only old
  in-flight runs read them) and registered with `outOfScope: expedition:legacy`; at 0.14.0 any legacy run still in a
  save resolves as it always has. Alt: migrate legacy runs to Ground Ops at load; port each effect to Ground Ops.
- **OC-G2, `orbitalOnly` gas giants (B21).** [PROPOSAL] the gas giant study (15b, "should only be from the ship")
  replaces ground objectives there, and FIELD_REPAIR_PLANET_TYPES derives from `!orbitalOnly`. Alt: fix the UI copy.
- **OC-G3, the anomaly (B15).** [PROPOSAL] the chart chance scales with sensor power and the finding pays a small haul
  through the deposit. Alt: remove the opt-in; reword.
- **OC-G4, PoI flavor.** [PROPOSAL] render it, and give each PoI the modifier its flavor names (relic odds on Buried
  Vault and Subterranean, materials on Bloom, Geothermal, Outpost, Crashed Ship) through rollRelicToken and rollHaul.
  Alt: render it with the reward claims removed.
- **OC-G5, ShipEventProfile frozen evasion and shields.** [PROPOSAL] delete the unread fields. Alt: the checks read the
  frozen values.
- **OC-G6, planet comments (Ocean, Frozen, Toxic).** [PROPOSAL] model Ocean's slower surface work only (taskWorkSeconds);
  drop the other two comments. Alt: model all; drop all.

### 5.H Relics and the Museum (2 calls)

- **OC-H1, Science team power.** [PROPOSAL] also scales the named Science members' fieldwork. Alt: crew layer only,
  text says so.
- **OC-H2, Museum salvage yield.** [PROPOSAL] recycle and teardown only, text says so. Alt: also loot-pool rolls and
  patrol / expedition salvage.

### 5.I Missions, patrols, factions (4 calls)

- **OC-I1, MISSIONS.cargoCapacity.** [PROPOSAL] delete the field (the hull hold rules, by the existing comment). Alt: a
  per-mission cap; the transport load size.
- **OC-I2, the three unused factions.** [PROPOSAL] each gets one patrol route of its own (the existing PatrolDef
  pattern) when the user names its content; until then they are hidden from any text. Alt: faction-specific hull pools
  now; delete them.
- **OC-I3, transports at ore cap (B2).** [PROPOSAL] a full ore warehouse never blocks a supply run. Alt: it does
  (intended), and the text says why.
- **OC-I4, turn order and faction ids (B14).** [PROPOSAL] the player side acts first within a speed tie, never by id
  spelling. Alt: enemies first.

### 5.J Salvage and item generation (4 calls)

- **OC-J1, the +1 tier reach at FA 15 and up.** [PROPOSAL] the overflow shifts the tier weights up (weightedPick). Alt:
  populate a luminous tier; say so in the tooltip.
- **OC-J2, the `rolled` narration.** [PROPOSAL] carry it to the completed-events log ("Recovered 3 Scrap Alloy, Standard
  quality"). Alt: delete the field.
- **OC-J3, dead-end loot (Scrap Alloy, Salvaged Circuitry, Precursor Circuit).** [PROPOSAL] Scrap Alloy via OC-C3;
  Salvaged Circuitry and Precursor Circuit get a Quartermaster sellValue now and recipes in the content pass. Alt: swap
  the pool staples.
- **OC-J4, unreachable affix counts (derelict, luminous, constellar).** [PROPOSAL] keep as safety branches covered by a
  test. Alt: delete.

### 5.K Framework (3 calls)

- **OC-K1, the Wiring panel layout.** [PROPOSAL] no mockup (dev-only): a table per system with columns Source, Owned,
  Status, Contexts, Contribution (now vs without), Expected; a "contributing nothing" filter. Alt: a mockup first.
- **OC-K2, the sim's default batch.** [PROPOSAL] 20 seeds x 24 simulated hours in the default suite, 200 seeds under
  `SIM_FULL=1`. Alt: bigger default, slower suite.
- **OC-K3, what may stay display-only.** [PROPOSAL] labels, flavor and readouts that claim no effect; anything with a
  number and a percent or a plus sign in its text must be an effect entry. Alt: stricter (every flavor line is checked
  by hand).

**Count of open calls by system:** Captain 42, Fleet Admiral 3, Facilities 4, Ship 14, Crew 13, Away 13 (F8 and F15 are
pointers, not counted), Expedition 6, Relics 2, Missions 4, Salvage 4, Framework 3: **108 calls**. The nine "no call" captain rows
build directly.

**The ten that matter most** (they unblock the most entries):
1. OC-A1 to OC-A3 plus the node table: 44 captain nodes and every placeholder.
2. OC-D1, the power budget: 7 dead effects and a net-negative Reactor Core.
3. OC-D9, combat positions: stance (which the player sets every patrol), range and four penalties.
4. OC-E10, promotion counters: promotion is impossible today.
5. OC-G1, the legacy path policy: decides a dozen PARTIAL rows at once.
6. OC-D8, transit, fuel and cargo beyond missions: hull identities (Orion reach, Aurora speed) and the Museum transit.
7. OC-C1, the Fuel Depot remnants: a live credit sink for nothing.
8. OC-D12, the combat UNFED set: 11 consumers nothing feeds.
9. OC-B2 / OC-B3, the Homeworld placeholder hubs: production players own them.
10. OC-D2, materialQualityChance: rolls on every Prospecting Rig and does nothing.

## 6. Size and ordering (honest)

| Slice | Size | Depends on | Notes |
|:-|:-|:-|:-|
| WR-1 registry + live sensitivity | L | none | about 500 live rows to register; probe extractions; biggest single test slice of the release |
| WR-2 simulated player | L | WR-1 | the safe-first-run assertions turn green with SF-2 / SF-4 |
| WR-3 Wiring panel | M | WR-1 | dev-only |
| WR-4 bugs and seams | M | WR-1; calls C1 to C4, E10, I3, I4 | can start on the no-call fixes at once |
| WR-5a / 5b / 5c captain nodes | 3 x L | WR-1; OC-A1 to OC-A3 (build defaults allowed) | sequential; shared tick.ts / bridge.ts |
| WR-6 placeholders elsewhere | M | WR-5 pattern | touches production Homeworld saves |
| WR-7 ship non-combat | L | CP-5, G2-3 / G2-4 for OC-D8 | power only if OC-D1 says so |
| WR-8 combat | L | WR-1 goldens | the largest determinism risk; every patrol golden moves |
| WR-9 crew beyond CP | M | CP-2, CP-3 | |
| WR-10 ground beyond FK | M | FK-4 to FK-7, CP-3 | |
| WR-11 expedition / relic / mission / salvage | M | SF-2 / SF-3, G2-2 / G2-3 | |
| WR-12 close-out | S | all | release gate, QA sheet |

**Total:** 14 slices (16 commits with goldens), roughly the size of the complement plan (22 slices). About 60 of the 247
not-live rows are already owned by CP, FK, G2, SF and E-MOD slices; WR wires the other ~185 and registers all 247.

**Ordering [PROPOSAL]:** WR-1 now (no engine change, safe beside every other plan) -> WR-2 and WR-3 in parallel ->
WR-4 -> WR-5a / b / c -> WR-6 -> WR-8 (before more patrol goldens accrue) -> WR-7 (after CP-5 and G2-3 / G2-4) ->
WR-9 (after CP-2 / CP-3) -> WR-10 (after FK-7) -> WR-11 (after SF-3 and G2-3) -> WR-12.

**Scope push-back (standing rule):** 0.14.0 already carries CP (22), FK (10), G2 (10), SF (8) and E-MOD. This plan adds
14 slices and 108 user calls. The user's T1 ruling makes the wiring itself non-negotiable, so the honest levers are
calls, not cuts: answering OC-A1 to OC-A3 and the node table in one sitting unblocks 44 entries; the "remove" options in
OC-C1, OC-C2, OC-F10, OC-F11, OC-F12, OC-G5 and OC-I1 are the cheapest honest way to satisfy "no placeholders" for
retired or never-designed things; OC-D9 (positions) is the one item whose cost is out of line with its visibility and
is the first candidate to ask the user about a 0.14.x deferral, recorded as `deferred` only on the user's word.

## 7. QA checklist (desktop 1280 px and mobile 375 px, light and dark), for WR-12

- [ ] `?dev` Debug > Wiring lists every system; a fresh save shows owned sources only for Standard Issue and the
      default complement; "contributing nothing" is empty except `deferred` rows.
- [ ] Allocate one captain node per tree; the Wiring panel shows its contribution and the matching readout moves.
- [ ] No talent, Homeworld node or tooltip reads "No bonus yet" or "(first-pass)".
- [ ] A patrol with a different stance gives a different battle log (if OC-D9 lands).
- [ ] An officer promotes after meeting an objective set (OC-E10).
- [ ] A supply run dispatches with a full ore warehouse (OC-I3).
- [ ] No Fuel Depot surface or fuel purchase remains (OC-C1), or the chosen alternative works.
- [ ] Sensor array descriptions match their measured scan rates.
- [ ] The first expedition on a fresh Orion with everything on auto completes at 100% (SF + WR-2 assertion), checked by
      hand once.

## USER ANSWERS (2026-10-15)

- **OC-A1 + OC-A2 (captain talent "+X%"):** "Multiplier, own ship (Recommended)": a relative multiplier on the named
  existing value, stacking with its other bonuses before any existing D23 curve; acts on the ship that captain
  commands, frozen at dispatch for runs (logistics4 precedent), per cycle for patrols.
- **OC-D9 (combat positions):** "Enemies start at range (Recommended)": fights open at range and close; stance, range
  and speed matter; patrols gain precharge. Patrol goldens move (re-capture first, explain every moved hash).
- **OC-D1 (power budget):** "Install gate + combat penalty (Recommended)": canFitByPower at the install check plus a
  combat over-budget penalty; Reactor Overdrive, Power Discipline and the Martian racial act on it.
- **OC-E10 (promotion):** "Count the objectives (Recommended)": crewHours from the officer's ship hours out on any run,
  shipsDestroyed from patrol and ship-event kills, personnelAchievement from objectives completed by the ship's squads.
- **OC-D12 (unfed combat inputs, 2026-10-16):** "Feed them all (Recommended)": antiDrone on Point Defense and EMP;
  damageResist / disruptionResist lines on plating and emitters; particleTraceDetector from sensors; rapid charge,
  in-combat replenish and smart reflect as drone pod lines; pirate hulls get armor and evasion; conditions persist
  across the waves of one patrol; overchargedCapacitors and inhibit get sources and readers.
- **OC-D14 durability (2026-10-16, verbatim):** "Everything wears in different ways. Similar to reality. Use. Battle
  damage. Etc. But can easily be repaired over time." So: ALL gear wears (not weapons only), each kind in its own way
  (use wear for economy / crew / sensor / member gear, battle damage for combat systems), and wear repairs easily over
  time (no punishing repair grind; peace is the product). Needs a short wear-model design (rates per kind, what wear
  does, how repair over time works, UI) before build: NEW SYSTEM, design + user sign-off first.
- **OC-G4 site flavor:** "Show it and make it true (Recommended)": show each site's flavor and give it what it names
  (better relic odds at Buried Vault and Subterranean sites; more materials at Bloom, Geothermal, Outpost, Crashed Ship).
- **OC-C3 Reclaimed Alloy / Purified Biomass:** "Add Refinery recipes (Recommended)": Scrap Alloy refines into
  Reclaimed Alloy and Fibrous Biomass into Purified Biomass; each becomes an input to existing Fabricator recipes
  (exact inputs [PROPOSAL] in the build, user to tweak).
- **Achievements foundation (2026-10-16):** "The event ledger now (Recommended)": 0.14.0 builds one notable-event ledger
  (first relic set, first Tier II run, captain milestones) read by the future achievements system, the Hall of Command
  and future chat (absorbs G4). Achievements themselves come with the tutorial / quests patch.
- **OC-A3 capstone magnitudes:** "Proposed sizes (Recommended)" (the plan's node table, all tunable).
- **OC-B2 / OC-B3 Fleet Admiral placeholder hubs:** "Give them real effects (Recommended)": Homeland Defense helps
  patrol combat; Citizenry helps crew recruitment; Works Directorate gives a Fabricator bonus and keeps gating Refinery.
- **OC-C1 Fuel Depot:** "Turn into range (Recommended)": repurpose its storage levels into a fleet reach bonus.
- **OC-C2 Warehouse T2:** "Add a Dense Ore source (Recommended)": Dense Ore drops from a mining mission or expedition
  mineral sites, so T2 storage and its rungs are reachable.
- **OC-I3 / B2 transports at ore cap:** "Let them launch (Recommended)". (Transport missions are 0.14.0-only; main has
  none, so no production hotfix.)
- **B14 turn order:** "Fix: by side, then order (Recommended)": patrol goldens re-recorded with explanation.
- **Promotion backfill:** "Start at 0 (Recommended)".
- **OC-G1 legacy expedition path:** "Delete it (Recommended)": remove the pre-Ground-Ops path and its legacy-only
  effects; a dev save with an old in-flight run gets that run finished at load. (Production never had expeditions.)
  NOTE: goldens that pin legacy runs (FK-3, G2-0, SF-0, CP-0 legacy fixtures) must be retired / re-pointed in the same
  slice, with the reason in the commit.
- **OC-D8 speed / cargo beyond missions:** "Speed counts everywhere (Recommended)": expedition travel and reach via the
  G2 voyage engine and reach gate; patrol legs scale with transitSpeedMult; cargo stays missions-only, text says so.
- **OC-E5 Fast Departure / Fast Return:** "Each its own leg (Recommended)".
- **OC-D2 materialQualityChance:** "Chance to upgrade a unit (Recommended)": each delivered unit may climb one quality step.
- **OC-D10 DC Suite:** "Field repairs too (Recommended)". **OC-D11 sensor arrays:** "Split the two (Recommended)":
  coverage width drives discovery attempts, cadence alone drives scan speed. **OC-E9 XO on expeditions:**
  "Expeditions too (Recommended)". **OC-D4 module slots:** "Cap module-class slots (Recommended)".
- **Fuel refund at v70 (2026-10-16):** "Refund as credits (Recommended)": leftover fuel converts to credits at the old
  purchase price (FUEL_CREDITS_PER_UNIT) with a one-time log note.
- **Fuel refund scope (2026-10-16):** the user confirmed the ship fuel / range STAT stays (only the retired stockpile
  goes); refund "Only above the free tank (Recommended)": credits at the old price for fuel beyond the free 500-unit
  starter tank only. (Supersedes the full refund built in 32d64ff.)
- **OC-E1 Counter-Infiltration:** "Resist enemy debuffs (Recommended)". **OC-E2 Prevent a Crew Loss:** "Shorter bay
  time (Recommended)". **OC-E3 Crew Output Multiplier:** "More mission + patrol haul (Recommended)". **OC-E4 Pilot
  Cunning:** "Quicker trips home (Recommended)": a chance per mission cycle to shorten the return leg.
- **OC-E7 Morale Anchor attrition:** "Drop that half (Recommended)". **OC-E8 Museum crewBonuses:** "Officers too
  (Recommended)". **OC-E12 third buff:** "Roll a third buff (Recommended)": top crew rank rolls a third buff from its
  profession pool (moves crew-generation goldens: re-capture first). **OC-E13 Constitution cycle 1:** "Ramp cycle 1
  too (Recommended)".
- **OC-F1 Shroud / Lure:** "Move them to the ground (Recommended)": they scale ground ambush and reinforcement
  chances; Lure adds a salvage drop scale (supersedes FK-7's ship-event default; FK plan to note).
- **OC-F2 Neural Backup:** "Revives the wearer (Recommended)". **OC-F4 Saboteur / Debuff spec:** "Also power Suppress
  (Recommended)". **OC-F5 Quick Draw:** "Beats stun and fear (Recommended)".
- **OC-F3 Med Kit:** "Fix the flavor (Recommended)". **OC-F6 Fall Back:** "Brace for the round (Recommended)": Shielded
  for that round. **OC-F7 Science rank:** "Rank boosts fieldwork (Recommended)". **OC-F9 Corroded:** "Some enemies
  cause it (Recommended)": certain enemy casters inflict Corroded.
- **OC-F10 Science gambit actions (verbatim):** "Keep this in place. Because perhaps, I might eventually want tools that
  have a chance to "proc" in battle where the science team might add a random effect to the battle party without
  directly participating. So keep these in, but they will ultimately be disabled." So: keep shieldAlly / analyze /
  secureObjective / takeCover, disabled (not offered), registered as `seam` (owner: a future Science battle-proc tool
  system); logged in SUGGESTIONS.
- **OC-F12 account gambit pair:** "Account-wide defaults (Recommended)": the account default program is given to newly
  hired members.
- **OC-F13 fall-outcome hook:** "Keep as a seam (Recommended)" (owner: future Safety Interlocks).
- **OC-G2 gas giants:** "Ship-only study (Recommended)": gas giants get the ship-side study (15b) instead of ground
  objectives; no landing, no field repair there.
- **OC-G3 anomaly:** "Sensors + a small reward (Recommended)". **OC-G6 planet notes:** "Model Ocean only
  (Recommended)". **OC-H1 Xeno Science team power:** "Members too (Recommended)". **OC-H2 Museum salvage yield:** "Keep
  scope, honest text (Recommended)".
- **OC-I2 factions:** "Routes when you name content (Recommended)": hidden from text until the user names content.
  **OC-J1 salvage reach past the top tier:** "Shift odds upward (Recommended)". **OC-J2 salvage narration:** "Show it
  (Recommended)". **OC-J3 dead-end loot:** "Sell now, recipes later (Recommended)".
- **OC-D3 module lines:** "They scale the module (Recommended)" (Crew Stations also adds capacity). **OC-D5 favorsSpec:**
  "+10% on its ship type (Recommended)". **OC-D6 statRatios:** "Unlisted = never rolls (Recommended)" (fixes B11;
  moves crafted-roll goldens: re-capture first). **OC-D7 quarters capacity:** "Spread across divisions (Recommended)".
- **OC-D13 hull descriptions:** "Make them true as built (Recommended)". **OC-B1 Salvage Operations on hull teardown:**
  "Apply to hull teardown (Recommended)". **OC-I1 MISSIONS.cargoCapacity:** "Delete it (Recommended)". **OC-K1 Wiring
  panel:** "Simple table, no mockup (Recommended)".
- **OC-C4 framework hooks:** "Keep tested hooks (Recommended)". **OC-K3 display-only rule:** "Text that claims no effect
  (Recommended)": anything with a number and % or + must be a real tested effect. **OC-K2 sim size:** "20 seeds x 24h
  default (Recommended)", 200 seeds in full mode. **OC-G5 + OC-J4:** "Delete frozen copies, keep safeties
  (Recommended)". => ALL wiring open calls except the 35 captain node rows (covered by OC-A1..A3 "Proposed sizes" and
  the plan's node table defaults) are now answered.
- **WR-5a calls (2026-10-17):** "Block buying while out (Recommended)": no secondary talent buys while the captain's
  ship is out (shipCrewLocked); "Always multiply (Recommended)": every "+X%" talent is its own x(1 + X) factor (applies
  to WR-5b / WR-5c too); Assayer "Own ship only (Recommended)"; Trade Routes / Shrewd Negotiator "As built
  (Recommended)" (docked pay after one delivered supply run; discount adds to profit).

## USER ANSWERS (2026-10-22): WR-8 review, patrol balance and the range rule (verbatim)

Context: WR-8 review measured patrol wins per 100 (veteran, Standard Issue, Balanced): Orion Sweep 89 to 70, Freighter
Sweep 96 to 80, Carrier Warband 55 to 26, Destroyer Warband 22 to 7. Causes about equal: (1) provisional pirate
armor/evasion vs the 6 to 10 damage autocannon (a NUMBERS issue); (2) fighting through an approach, with the "hold no
farther than the LONGEST weapon's reach" rule parking a Balanced Destroyer where its autocannon never fires (a SYSTEM
issue).

1. Patrol balance: "Let's remember that if it's a systemic issue, we fix the systemic issue. But the actual balancing
   of the content can wait. If it's just a balancing numbers thing, option 1. Otherwise, we should fix the system
   itself." Reading: soften the provisional pirate armor/evasion numbers for now (option 1, "Soften pirates for now";
   0.16.0 owns real numbers) AND fix the parking system.
2. Range rule: "Stance should decide. However, there's something missing. We should change Standoff to Defensive, and
   make it more defensively oriented for it's actual behavior. That makes more sense. We have aggression which is
   offense, but standoff doesn't really feel like it means "defensive", evne though it's the closest thing to it."
   Reading: each stance sets where a ship holds; Standoff is renamed Defensive and gains defensive behavior (what it
   does: next round of questions).
3. Defensive (renamed Standoff) does ALL FOUR: "Takes less, deals less" (incoming damage reduced, for example -20%,
   outgoing reduced a bit); "Shields first" (shields recharge faster and absorb more); "Guards against threats"
   (point defense and drones focus incoming drones and missiles before enemy ships); "Keeps its distance" (holds at
   its longest gun's reach and backs off when enemies close, only if fast enough).
4. Balanced parks "Where most firepower reaches (Recommended)" (the range covering the biggest share of its damage).
   Aggressive closes so every gun fires (its shortest gun's reach).
My calls: the player-facing label becomes "Defensive" everywhere (picker, Help, patch note, logs); the stored key stays
`standoff` so saves need no migration (same pattern as the Settings tab key "options"); the new behavior applies via
the WR-8 rules stamp, so in-flight runs replay unchanged. All Defensive numbers are [PROVISIONAL] for 0.16.0.
5. Approach (after the stance fix and softer pirates: Orion 87, Freighter 88, Carrier Warband 42, Destroyer Warband 15, Battleship 79; zero pirate armor did not close the gap, the cause is short-gun ships eating railgun fire while closing): "Closing is evasive (Recommended)" (a ship closing to its stance range moves evasively; incoming fire is reduced while it is still out of its own guns' reach).
6. After evasive closing (c627efe: Orion 88, Freighter 90, Carrier Warband 39, Destroyer Warband 15, Battleship 78; the remaining gap is spread across several new rules working as designed): "Ship it, soften early curve (Recommended)" (tougher Warbands are content balance for 0.16.0; tune the existing safe-first ramp so light hulls' early Warbands are as gentle as before WR-8, Freighter c0 Warband back near 181 of 200).
7. Patrol monotonicity sweep at 400 seeds instead of 200: "Yes, 400 seeds".

## USER ANSWERS (2026-10-29): WR-7 review balance calls (verbatim picks)

Context: the WR-7 review found every quarters piece carries Crew Stations points (implicit plus rolled, about 23 to
113), so 1 berth per point gave +35 to +151 berths; the High-Output Core lost mass relief under OC-D6 (nets about +11%
speed vs the Efficient Core's +35%); Wide arrays netted about 1.27x the finds per hour of Balanced, Focused about 0.76x.

1. Crew Stations berth size: "Small curve (Recommended)": a gentle diminishing curve, about +1 berth near 25 points and
   about +4 near 113 [PROVISIONAL]. Quarters' own base stays the main source of berths.
2. Elite Quarters and the Guest Wing: "Elite stays at 0 (Recommended)": Elite Quarters adds no berths, its Crew
   Stations line only scales its effect; the other quarters (the Guest Wing included) gain the berth bonus.
3. Cores: "Accept: power vs speed (Recommended)": High-Output is the heavy power core, Efficient the light fast core.
4. Sensor arrays: "Even out per hour (Recommended)": tune Wide and Focused so finds per hour land near Balanced
   (about 0.95 to 1.05x); Wide = more per world but slower, Focused = quick looks.
5. Still open: `VARIETY_RESIST_RATIO` 0.1 [PROVISIONAL] (resist lines on plating and emitters).

## USER ANSWERS (2026-10-30): OC-D8 patrol legs follow-up

- Fast Departure / Fast Return on patrols: "Yes, each its own leg (Recommended)". Fast Departure shortens a patrol's
  outbound legs and Fast Return its legs home, matching missions (OC-E5 "Each its own leg"). Built as a small
  follow-up, goldens first, frozen per cycle like `legTicks`.
- Engineering calls (hub, no user question needed): the 15 other golden files run with PATROL_LEGS_SWITCH off (the
  *Switch.fixture.ts precedent; patrolLegsGoldens pins every hull with the legs on); the wiring.sensitivity vacuity
  floor dropped 15 -> 6 because it counts pending entries (7 left).
- Review minors for the follow-up: the Constitution `runHours` multiplies routesThisRun by the current cycle length
  (tick.ts ~3479/3848), so a run mixing cycle lengths is slightly off; accumulate flown ticks instead (deterministic,
  old runs fall back). The model.ts ~1117 comment ("a mission leg's own rule") becomes true once the lifts land.
- Constitution run clock (user, 2026-10-30): "Count only flown (Recommended)". Ticks a Constitution return cut
  (returnCutTicks) skips do NOT count toward the run clock; it measures time actually spent out on patrol.
- Hub engineering call: the officers' `crewHours` float drift (one economyTick(span) adds span/3600 once vs 1 s steps
  adding 1/3600 span times; tick.ts ~4485) violates "one call == chunked == 1 s steps" and gets fixed with a
  whole-number seconds counter, not tolerated by a 12-digit comparison.
- BUILT (OC-D8 follow-up): each patrol cycle freezes its outbound leg (`transitOutTicks`, home to the patrol zone)
  at the sweeping speed x Fast Departure and its leg home (`transitBackTicks`; a limp home is twice it) x Fast Return,
  into the same `legTicks` (written only when they differ). The Constitution run clock sums each completed cycle's
  route ticks (`routeTicksThisRun`, written only when a run mixes cycle lengths). Test switches
  PATROL_LEG_LIFTS_SWITCH / PATROL_RUN_CLOCK_SWITCH; registry crew:audit:patrolDepartureLeg / patrolReturnLeg.
- BUILT (fix round, 2026-10-30): the run clock counts only flown ticks for cycles stamped `cutFlown` (old and in-flight
  cycles add their full route, byte-identical); crewHours accrues in whole milliseconds (`crewHoursMs`, milliseconds
  because Drillmaster x1.08 makes seconds x mult fractional; exact while the multiplier is 1 or 1.08), old saves
  convert on first increment; test switch CREW_HOURS_MS_SWITCH. No SAVE_VERSION bump.

## WR-11 BUILT (2026-10-30)

Goldens first (wr11Goldens.test.ts on a158982), test switch WR11_SWITCH (wr11Switch.fixture.ts); every moved pin returns
with it off. No SAVE_VERSION bump: every new field is optional and stamped at dispatch or at a salvage job's start.

- OC-G4: each PoI's flavor shows on the objective card and the queue row (expeditionContent.ts groundSiteFlavor) and is
  true: a run stamped with the site rules (Expedition.siteRules) multiplies the relic chance at Buried Vault x1.5 and
  Subterranean Civilization x2, and the haul's materials at Xeno-Flora Bloom, Geothermal Chamber, Derelict Outpost and
  Crashed Ship x1.25 (credits unchanged) [PROVISIONAL sizes]. Flavor lines reworded so every claim is real.
- Hostile and clearing site flavor: rendered the same way.
- OC-G3: on a stamped run the chart chance is 1000 - 650 / (1 + sensorPower / 40) permille (35% at 0 sensors, never
  certain) and a charted anomaly brings home a small haul (rollHaul on the default table at 0.5 x the tier haul)
  [PROVISIONAL]. The old-run text no longer claims a finding.
- relicSignature: deleted (always true; relicSets is the lead). OC-G5: ShipEventProfile evasion / shieldCapacity deleted.
- OC-G6: Ocean surface objectives take x1.25 work time on a stamped run [PROVISIONAL]; Frozen and Toxic comments dropped.
- OC-I1: MISSIONS.cargoCapacity deleted (RunMissionDef carries the hull's hold; missionDefWithoutShip reads the 90
  reference hold for a caller without a ship). OC-I2: deferred with the user's words (hidden from every text).
- OC-J1: the salvage talent's +1 reach past the pool's top tilts the tier weights up (weight x factor^i, factor =
  1 + diminishing(0.5 x overflow, 1)) on a job stamped at its start (rollRules); RR-7's reserved FA 20 row tilts nothing.
- OC-J2: a material salvage's log entry carries its loot tier; the Home board row reads "Standard quality" and the like.
- OC-J3: Salvaged Circuitry 12 cr and Precursor Circuit 300 cr at the Quartermaster [PROVISIONAL prices].
- OC-J4: the safety rows stay, each covered by a test. Status `color`: deleted.
- OC-H1: the Museum's Science team power is frozen on the run (museumSciencePower) and scales each named Science
  member's own fieldwork. OC-H2: the stat reads "salvage yield (recycling and hull teardown)".

## WR-9 BUILT (2026-10-31)

Goldens first (wr9Goldens.test.ts on b5c0eab), test switch WR9_SWITCH (wr9Switch.fixture.ts); every moved pin returns
with it off. No SAVE_VERSION bump: every new field is optional and stamped at dispatch (or rolled at generation).
Reconciled first: OC-E1, OC-E2 (and the CP-3 review calls: the 0.9 x tanh share, the combined resist under 90%, the
rounded-up HP) were built by CP-3; OC-E3, OC-E5 (missions), OC-E8 and OC-E13 by CP-2; OC-E5 on patrol legs and the
flown-tick run clock by the OC-D8 follow-up. Nothing left of those.

- OC-E4 "Quicker trips home": a captain mission dispatch stamps the Flight Deck's Cunning facet
  (CaptainMissionState.pilotCunning, carried to every repeated cycle); each cycle's return leg rolls it once on the
  Flight Deck's private Cunning stream of the captain's lifetime cycle key and, on a proc, runs
  PILOT_CUNNING_RETURN_CUT_TICKS (1) shorter, never below one tick [PROVISIONAL size]. A run in flight from before WR-9
  has no stamp and flies as it did. Captain missions only: short-range board runs roll no Cunning (out of scope with a
  reason, [PROPOSAL, the user's to confirm]). The XO keeps no over-delivery of its own (its share raises the others).
- OC-E6: Rapid Loadout already acted on the Ground Ops reload only; the Return Trip Help now says missions have no load
  step. Audit: a mission cycle is unchanged by it (a move of 0).
- OC-E7: Morale Anchor's text drops the attrition half ("Steadies the away team: every member resists Fear.").
- OC-E9 "Expeditions too": Command Presence (the officers' officer.shipOutputMult only; Crew Output Multiplier stays
  missions and patrols per OC-E3) is frozen on the run (Expedition.groundOutputShare) and scales every objective's haul
  through rollHaul's scale (the same draws). Operations Integrity is frozen in the Ground Ops factors (offloadSteady):
  an offload whose batch carries at least FULL_HOLD_FRACTION (90%) of its objective's segments runs x (1 + facet)
  faster, the twin of a mission's full-hold unload [interpretation of "steadies the offload", flagged for the user].
  Command Presence and Help text updated.
- OC-E11: the `enlisted` flag is deleted (identity only).
- OC-E12 "Roll a third buff": a rank whose buffCountForRank is 3 (Lieutenant, Lieutenant Commander) rolls a third buff
  (CrewSignature.buff3Id) from its profession pool, distinct from its profession buffs, drawn after every earlier draw
  (every other field of every crewmember is unchanged). Crew rolled before WR-9 keep two buffs (no backfill). The
  third buff counts in the contribution, the crew-key guard and the signature key (a two-buff key is unchanged).
- Registry: facet:pilot:cunning and six crew audit rows live; added crew:audit:pilotCunningReturn and
  crew:audit:opsIntegrityOffload (each measured on its consumer). Registry pins read WR-9 back (wr9Registry.fixture.ts).
