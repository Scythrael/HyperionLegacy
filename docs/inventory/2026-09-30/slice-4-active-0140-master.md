# Slice 4: Active 0.14.0 + master design + lore (planned-functionality inventory)

Reviewer: slice 4 of 6. Read-only review of branch `feat/crew-0.14.0` at HEAD `15a91e3` PLUS the uncommitted
working tree (E4d relic-unlock gear + the sensor install tile are in progress, uncommitted: `utilityGear.ts`,
`relic-unlocks.test.ts`, and edits to `model.ts`, `ShipSystemsPanel.svelte`, `sensorArrays.ts`, `expedition.ts`).
"working tree" in a row means the code exists only uncommitted.

Source abbreviations:
- saga = docs/plans/2026-09-15-exploration-crew-saga-0.14.0-design.md
- crew = docs/plans/2026-09-22-crew-0.14.0-plan.md
- expl = docs/plans/2026-09-24-exploration-0.14.0-plan.md
- 2.0 = docs/plans/2026-09-18-2.0-three-pronged-prestige-flagship-active-design.md
- md = docs/projectdocs/fleet_admiral_master_design.md (undated, pre-implementation)
- ts = docs/projectdocs/fleet_admiral_technical_spec.md (undated, pre-implementation)
- lore = docs/lore/first-cause-dimensional-traversal.md

Flag key: GAP / DRIFT / DECIDE / OK (OK-recorded = known deviation already recorded in the docs; counted as OK).

## Saga design doc (Parts A to I + open-decisions index)

| ID | Item (short) | Source | Target | Doc status | Code status | Flag | Note |
|---|---|---|---|---|---|---|---|
| S4-A01 | Fuel becomes REACH: derived range stat, instant free refuel at home, no stockpile | saga:45-69 (2026-09-15/16) | 0.13.6 (pulled in, A.6) | locked | BUILT (shipped 0.13.6; `canReach`, fuel-to-reach.test.ts; expl:46-51) | OK | |
| S4-A02 | Net deletion of the old fuel economy (tank, refinery pipelines, Fuel Depot, ice grind, auto-buy, fuel runway) | saga:55-56; expl:329-333 (OPEN 1) | 0.14.0 | open | PARTIAL: reach mechanic live, but the vestigial economy still runs: tick.ts `processFuelPipelines` (~4215), Fuel Depot UI (32 refs in App.svelte), `fuelRunwayProjection` (App.svelte:747) | DECIDE | Remove or keep is unresolved OPEN 1. |
| S4-A03 | Shared POWER GRID / mass budget: reach trades against weapons/shields/cargo/sensors (the archetype tradeoff) | saga:72-80, 149-166; expl E0:61-64 | 0.14.0 (E0) | locked archetypes, mechanic proposed, IN E0 scope | PARTIAL: mass-vs-thrust penalty exists (model.ts ~2528); reactor budget helpers `powerBudget`/`canFitByPower` (combat/power.ts) are never called outside tests; crew modules + sensors carry powerDraw 0 (model.ts SLOT_BASE_PHYSICALS ~7765-7782); E0 shipped fixed stats with "NO B.3 power-allocation preset" (model.ts:1187-1190) | GAP | E0 is committed as done (142d5ab) without the grid trade; no later phase owns it. |
| S4-A04 | Relativity curve: exponential power cost of velocity, soft drive ceiling, DT hook | saga:75-80 | 0.14.0 / DT | proposed | NOT BUILT | DECIDE | |
| S4-A05 | Deuterium becomes the crafting INPUT for reach (drives, engines, reactor cores) | saga:82-86; expl E0:65-66 | 0.14.0 (E0) | proposed in saga, IN plan scope | NOT BUILT: `deuteriumIce` is DEPRECATED + sell-only ("orphaned by fuel-to-reach", model.ts ~6264); no blueprint consumes it; its unlockHint still says "refine it into fuel at the Fuel Depot" (model.ts:6340) | GAP | E0 scope item never built and not carried to any later phase. |
| S4-A06 | Multiple fuel types by ship rank vs drive-tech tiers (reach classes) | saga:91-94, 598 | 0.14.0 | open | NOT BUILT | DECIDE | |
| S4-A07 | Auto fuel gathering subsumed; survives as deuterium crafting-material sourcing / explorer-created mining facility | saga:95-98 | 0.14.0 | open | NOT BUILT | DECIDE | Depends on S4-A05. |
| S4-A08 | Round-trip vs stranding (one-way / colony reach) | saga:111-112, 600 | 0.14.0 | open | NOT BUILT (every expedition returns) | DECIDE | |
| S4-A09 | Refuel is instant at home | saga:67-68, 113, 600 | 0.13.6 | locked | BUILT | OK | |
| S4-A10 | Maneuverability: real combat axis (evasion) vs flavor | saga:114, 123 | 0.14.0 | open | NOT BUILT (`maneuverability` is a reserved unfolded stat key, model.ts:2150) | DECIDE | |
| S4-A11 | Open-decisions index says fuel-to-reach ships WITH 0.14.0, "not a 0.13.6 stopgap" | saga:599 vs saga:100-108 | n/a | stale | SUPERSEDED (shipped 0.13.6) | DRIFT | Doc self-contradiction: A.6 body says pulled into 0.13.6; the index line was never updated. Doc-only fix. |
| S4-A12 | Pre-I.7 roadmap line (0.15.0 Story, 0.15.1 Accounts, 0.16.0 Online) | saga:29-31 | n/a | superseded by I.7 (saga:588-592) | SUPERSEDED | OK | I.7 explicitly supersedes. |
| S4-B01 | Explorer class fantasy (Enterprise-D x Voyager glass tank, marathon runner) | saga:120-127 | 0.14.0 | locked | BUILT: `orion`/`aurora`/`eir` (model.ts:1191-1239) | OK | |
| S4-B02 | Explorer weapons are UTILITY/SCIENCE (phaser-as-drill), survey uses instead of offense | saga:124-126, 136 | 0.14.0 | locked fantasy, proposed mapping | NOT BUILT: explorers get weaponHardpoints 1 + a default autocannon (model.ts:1171-1173) | DRIFT | No recorded decision to drop utility weapons. |
| S4-B03 | Sensors as a new stat ("exploration's damage") | saga:137; I.6 | 0.14.0 | locked | BUILT: `ShipDerivedStats.sensors` folded live (E1a), consumed by survey yield + expedition scan/foreknowledge | OK | |
| S4-B04 | Explorer hulls carry HIGH BASE sensors | saga:577-579 (I.6, 2026-09-23); expl:352-354 | 0.14.0 | locked | NOT BUILT: ShipTypeDef has no sensors field (model.ts:1187-1188 "DEFERRED") | GAP | Deferred in E0 and again in E1a "to I.6" with no owning phase. |
| S4-B05 | Power allocation: build-time/per-mission preset vs active reroute | saga:141-147, 601 | 0.14.0 | open (preset proposed) | NOT BUILT | DECIDE | |
| S4-B06 | Archetype poles: Destroyer / Battleship / Explorer on one grid | saga:149-166 | 0.14.0 | locked | PARTIAL: all three hulls exist; the grid that differentiates them does not (S4-A03) | OK | Tracked via S4-A03. |
| S4-B07 | Full hull roster: Carrier, explorer sub-types (Cruiser / Survey / Medical transport), explorer extra module slots | saga:167-169, 602 | 0.14.0 | open | PARTIAL: Carrier built; Aurora = survey, Eir = medical transport, Orion = core; no Cruiser; explorer moduleSlots 4-5 (inert) | DECIDE | Full roster list + stat tuning open. |
| S4-C01 | Three crew pieces: Senior Staff, Ground Crews, Complement; Ground Crews' home slot (reserved vs new) | saga:180-186, 269 | 0.14.0 | open (home slot) | PARTIAL: Senior Staff + Complement built; Ground Crews have no slot/home | DECIDE | |
| S4-C02 | Senior Staff seats filled from an hourly-refresh candidate roster; random name + race + two rolled bonuses | saga:188-193 | 0.14.0 | locked | BUILT: seniorStaff.ts `seniorStaffCandidates`, `OFFICER_ROSTER_WINDOW_SECONDS` 3600 | OK | |
| S4-C03 | Some officer skills roll FAR RARER than others (chasing a rare roll is the loop) | saga:196-197 | 0.14.0 | locked (C.0) | NOT BUILT: `rollCandidate` picks both bonuses uniformly (seniorStaff.ts:303-307) | DRIFT | Crew plan dropped bonus-roll rarity silently (its "no rarity" lock is about officer rarity tier, not roll odds). |
| S4-C04 | Promotion via missions + "achievements", Ensign..Commander | saga:193-195 | 0.14.0 | locked, later refined | BUILT as objective checklist (seniorStaff.ts `PROMOTION_OBJECTIVE_SETS`); Cadet start + non-mission counters deferred (crew:133, 600-603) | OK-recorded | |
| S4-C05 | Fire officers you dislike | saga:196 | 0.14.0 | locked | BUILT: `fireOfficer` | OK | |
| S4-C06 | Ground Crews obtained LIKE Senior Staff (hourly-refresh roster, fireable), a few loadouts per task | saga:201-203 (2026-09-17) | 0.14.0 | locked | NOT BUILT | DRIFT | expl:222-225 (2026-10-01) lists "how members are recruited (a candidate roster like officers?)" as OPEN, though C.0 already specified it. |
| S4-C07 | Boarding Party (beam over, internal damage, disrupt systems, capture PRISONERS to homeworld) | saga:204-206, 270 | 0.14.0 or later | open (placeholder) | NOT BUILT | DECIDE | |
| S4-C08 | Science Team (surveys, archaeology, relics) + Security Team (random battles) planet drops | saga:207-216 | 0.14.0 | locked, revised 2026-10-01 | PARTIAL: both roles exist as crew-derived strengths in gambit.ts; Science still fights (secureObjective) | OK-recorded | Security=battles / Science=fieldwork rework recorded (expl:284-294). |
| S4-C09 | FFXII gambits are PER-MEMBER rules ("a medic set to prioritize healing", "a designated member cures it") | saga:212-214; expl:171 | 0.14.0 | locked | PARTIAL: programs are ACCOUNT-WIDE per role (`GameState.gambitPrograms.security/science`, model.ts:6099), snapshotted per expedition; no per-member, per-team, or per-ship programs | DRIFT | Ties the roster rework; no recorded decision to make programs account-wide. |
| S4-C10 | Equipment is ONLY for ground crews; Senior Staff carry none | saga:217-218 | 0.14.0 | locked | BUILT by omission (officers have no gear) | OK | |
| S4-C11 | Per-TEAM slot layout: Science 1 weapon + 4 tools, Security 2 weapons (long + short range) + 2 tools, Armor per team, Boarding TBD | saga:228-231 | 0.14.0 | locked (2026-09-17) | NOT BUILT | DRIFT | expl:206-208 (2026-10-01) moves Armor/Weapon/Tool to each MEMBER and lists "slot counts" OPEN; the C.0 per-team counts were not carried forward. Decide per-team vs per-member. |
| S4-C12 | Tools tune to CONTEXT: Science tools per planet/environment type; combat tools = in-battle effects (stun/poison) + an ENCOUNTER-RATE dial (avoid or farm fights) | saga:219-228 | 0.14.0 | locked (2026-09-17) | NOT BUILT | DRIFT | Absent from the 2026-10-01 roster section and its OPEN list ("gear catalog" only); compression risk. |
| S4-C13 | Ground gear = new craftable/lootable item classes on the item lifecycle + Armory patterns | saga:230-231, 271-272 | 0.14.0 | locked | NOT BUILT | OK-recorded | Part of the recorded roster rework. |
| S4-C14 | Exploration onboarding: short test mission, moderate survey, then the first real ~6h long-haul | saga:232-236 | 0.14.0 | locked | BUILT: survey missions (E1a) + expedition `SHAKEDOWN_TRANSIT_SECONDS` 1800 then `TRANSIT_SECONDS` 21600 (expedition.ts:96-97) | OK | |
| S4-C15 | Harder later expeditions take DAYS in transit; REACH gates how far you can commit | saga:236-241; saga:394-396 | 0.14.0 | locked | NOT BUILT: one fixed `TRANSIT_SECONDS`; `startExpedition` has no reach/distance check, no difficulty tiers, no hull gate (expedition.ts:465-476) | GAP | Fuel-to-reach does not touch expeditions at all, so "reach gates commitment" (the core Part A/E link) is absent. |
| S4-C16 | Expedition RECALL re-runs the same transit home (a massive commitment) | saga:237-239 | 0.14.0 | locked | NOT BUILT: no recall/abort for expeditions (no recall symbol in expedition.ts) | GAP | A dispatched ship is locked for the full run. |
| S4-C17 | Complement PASSIVE mode default: periodic transports, random assortment, zero micromanagement | saga:244-247 | 0.14.0 | locked | BUILT: transports.ts `deliverDueTransports`, autoCrew.ts `autoCrewShip` | OK | |
| S4-C18 | Complement ACTIVE mode: player assigns specific crew to a specific ship | saga:248-252; crew:113-115, 359 (Phase 4) | 0.14.0 | locked | PARTIAL: mode toggle built (ComplementPanel `onSetMode`; crewOverlay.ts:378 skips autofill) but NO player assignment of buckets exists (`moveBetweenBucketLists` is only called by autoCrew) | GAP | Active mode just freezes the crew; there is nothing to curate with. Crew plan:606 calls crew go-live done. |
| S4-C19 | Complement size by ship type: prospectors 50-200, combat 50-500, explorers "well over a few THOUSAND" | saga:253-255; crew:373-374 | 0.14.0 | locked bands, tuning open | PARTIAL: `SPEC_BASE_TOTAL` general 30 / prospector 50 / tactician 80 / explorer 500, x tier (commandStructure.ts:51-56); explorers cap at 750 | DRIFT | Explorer band below the locked "thousands". See S4-C26. |
| S4-C20 | Per-type (division) caps within a complement | saga:254-255 | 0.14.0 | locked | BUILT: commandStructure.ts `divisionCap` | OK | |
| S4-C21 | Complement SECURITY branch fulfills internal-security hook (C.4) | saga:256-260, 323-331 | later hook | deferred | PARTIAL: boardingDefense / counterInfiltration buffs exist but are no-ops (crewOverlay.ts:57-61) | OK | Deferred by design. |
| S4-C22 | Prospector unload worked example (crew cut unload up to ~75%) | saga:261-267 | 0.14.0 | illustrative | BUILT: unload scales with cargo + crew `unloadSpeedMult` (aa09d82) | OK | |
| S4-C23 | Random crew identity: name, race, gender, rarity, racial, profession, bonus | saga:293-295 | 0.14.0 | locked | BUILT: crewGeneration.ts, crew.ts `generateCrewIdentity` | OK | |
| S4-C24 | Manage by POLICY: auto-assign, SORT, MASS-ACTION, pluck out STANDOUTS (graduate to notables) | saga:296-299; crew:257-258, 359-360 (Phase 4) | 0.14.0 | locked | PARTIAL: auto-assign built; sort / mass-action / standout graduation NOT BUILT. Nothing ever creates a `NotableCrewMember` (`nextNotableId` only in freshState + migration) | GAP | Personnel Rosters pin notables and GL-1 folds them, but no notable can exist; ComplementPanel.svelte:339 tells players to "graduate" standouts with no way to do it. |
| S4-C25 | Lazy crew MANIFEST view (names generated on open) | saga:337-339; crew:255-256 | 0.14.0 | locked | PARTIAL: `generateCrewIdentity` exists; no manifest view in ComplementPanel (rank graphs + notables only) | GAP | |
| S4-C26 | One large explorer hardcoded to a 1,017 complement (+ full crew capacity, evac space); base capacity is a LOCKED per-HULL value | saga:305-307; crew:182-186 | 0.14.0 | locked | NOT BUILT: capacity is per-SPEC x tier, so Orion = Aurora = Eir = 750 even though Eir is "the largest crew the fleet fields" (model.ts:1238) | DRIFT | No recorded decision to drop the 1,017 flagship or the per-hull principle. |
| S4-C27 | Crew leveling + rank-up 1-10 | saga:308-309 | 0.14.0 | superseded | SUPERSEDED by crew:123-126 (rank locked at generation) | OK-recorded | |
| S4-C28 | Crew augmentation / cybernetics | saga:309-310 | 0.14.0 | cut (crew:34-37), revived for ground teams (expl:276-283) | NOT BUILT | OK-recorded | |
| S4-C29 | crewCapacity / maxCapacity stats that evac/transport/colony missions gate on | saga:310-311 | 0.14.0 | locked | PARTIAL: crewStations live via quarters; no mission gates on it yet | OK | E5 pending. |
| S4-C30 | Refugees -> posted at facilities as mini Senior Staff | saga:317-321; expl E5:296-299 | 0.14.0 (E5) | built | BUILT in 0.14.0 E5 (Refugee Posts; E5-7 close-out 2026-11-03) | OK | docs/plans/2026-11-02-refugee-posts-e5-plan.md. |
| S4-C31 | Espionage / infiltrator content layer (sensors flag, Security runs it down) | saga:323-331 | later / 2.0 | deferred hook | NOT BUILT | OK | |
| S4-C32 | Data-scale: aggregate rollups + notable roster + lazy seeded generation | saga:333-340, 604 | 0.14.0 | locked | BUILT: crew.ts bucket histogram | OK | |
| S4-C33 | Senior Staff "Crew & Command" vocabulary: officer STATS (Strength/Integrity/Cunning/Constitution), stations, Recruiter's Office, TRAITS, Weapons officer specializing in a weapon type | saga:284-289 | 0.14.0 | listed as "ties in" | NOT BUILT: officers carry 2 bonuses + racial only | DRIFT | Crew plan locked a 2-bonus model without recording that the 4-stat block, traits, and weapon-type specialization were dropped. |
| S4-C34 | Captain identity (C.6): structured names first/callsign/last + earned RANK prefix | saga:342-349; expl E-CAP:311-314 | 0.14.0 | locked | NOT BUILT (captainName.ts is only rename validation) | OK | Planned phase not started. |
| S4-C35 | Captain portrait-border color-coding (pattern/effects later as cosmetics; full-UI tint rejected) | saga:346-347 | 0.14.0 | locked | NOT BUILT | OK | Planned (E-CAP). |
| S4-C36 | Earned captain-bound medals/ranks/surname unlocks via a PERSONNEL achievement tier; SVG ribbons, hover flavor | saga:347-349 | 0.14.0 | locked | NOT BUILT | OK | See S4-EX30 for the missing achievement framework. |
| S4-D01 | Away-team combat is exploration's combat (turn-based, auto-resolved) | saga:353-359 | 0.14.0 | locked | BUILT: gambit.ts `resolveGroundBattle` (E3a) + GambitEditorPanel (E3b) | OK | |
| S4-D02 | Room-to-room randomly generated dungeon navigation | saga:357-359 | 2.0 | superseded by I.5 | SUPERSEDED (2.0 active overlay) | OK | |
| S4-D03 | Offline interaction flag for away missions | saga:360-363, 605 | 0.14.0 | resolved by I.5 | BUILT (semi-idle, deterministic) | OK | |
| S4-D04 | ONE shared turn-based engine + loadout slots for Away Missions / Landing Party / Invasion | saga:364-366; expl:210-213 | 0.14.0 foundation | locked | PARTIAL: interpreter is generic in shape; no loadout slots; Landing Party / Invasion not built | OK | |
| S4-D05 | Away team is a party selector SEPARATE from ship-crew stations (no impact on ship ops) | saga:367-368 | 0.14.0 | locked (from SUGGESTIONS) | PARTIAL: team strength is derived from the ship's own complement divisions + seated officers (gambit.ts `deriveAwayTeam` 1007-1047), no separate party | DECIDE | Roster plan says "base strength flows from crew"; decide whether away members come out of the complement. |
| S4-D06 | LEVIATHAN boss encounters (random during surveying, cascading, closest team pulled in, beam-out escape) | saga:370-389; lore:69-76 | deep-future | idea | NOT BUILT | DECIDE | I.6 (locked, 0.14.0) lists "Leviathan bosses flagged early" as a sensor role and E4d ships a Leviathan Scale relic, but no 0.14.0 phase builds Leviathans. |
| S4-E01 | Long-range explorer missions into the receding frontier | saga:394-396 | 0.14.0 | locked | BUILT: expeditions (E2) | OK | Distance gating missing, see S4-C15. |
| S4-E02 | Discovery-gated Research + artifact set bonuses | saga:397-399 | 0.14.0 | locked | PARTIAL: relic sets + Museum built (relics.ts); discovery-gated blueprints in working tree (`requiresRelicDiscovery`, `blueprintRelicLocked`, model.ts ~7640-7716) | OK | E4d in progress. |
| S4-E03 | Exploration rewards source rare materials (+deuterium) | saga:398-399 | 0.14.0 | locked | PARTIAL: surveys/expeditions haul rare materials; deuterium deprecated | OK | |
| S4-E04 | Banked sci-fi system names | saga:401-404 | 0.14.0 | locked | BUILT: expedition.ts banked system list (~175-184) | OK | |
| S4-E05 | Explorer hulls acquired by REAL discovery-gated acquisition (found in the field), blueprint is a placeholder | model.ts:1182-1185 (E0 code comment, pointing at "E4 research") | 0.14.0 (E4) | planned in code | NOT BUILT: still blueprint-research gated; E4d lineup (expl:254-275) does not include it | GAP | Plan-level drop: deferred to E4 by E0, absent from E4. |
| S4-F01 | 0.14.0 nouns (reach, explorer hull, crew, away teams, sensors, survey maps) reusable by 2.0 Science mode | saga:408-415 | 0.14.0 | locked | BUILT (vocabulary) | OK | |
| S4-G01 | Phased saga order; does crew ship ahead of exploration | saga:419-443, 606 | 0.14.0 | resolved (one patch, crew.md:9-14) | n/a | OK | |
| S4-H01 | Finish the SUS slot: 8 more focused item types (9 total), roles NAMED by the user | saga:453-459; expl E-SUS:316-320 | 0.14.0 | open | PARTIAL: Prospecting Rig + (working tree) Damage Control Suite (tactician, recovery) + Pathfinder Suite (explorer) in utilityGear.ts = 2 of 8 named | OK-recorded | 6 roles still unnamed (DECIDE carried by the user list). |
| S4-H02 | Universal MODULES = accessory layer on generic moduleSlots | saga:465-471; expl E-MOD:301-309 | 0.14.0 | locked | NOT BUILT (moduleSlots inert, model.ts:142) | OK | Planned phase not started. |
| S4-H03 | Module categories: Passive / Proc / Conditional / Active (auto-cast gambit-like; manual = 2.0) / Set | saga:473-476 | 0.14.0 | locked | NOT BUILT | OK | Planned. |
| S4-H04 | Draw = UNIQUE procs/actives; NO baked-in downsides | saga:477-480 | 0.14.0 | locked | NOT BUILT | OK | Planned. |
| S4-H05 | Module sourcing: craftable (quality/rarity/iLevel) AND salvage PRECURSOR -> REPAIR -> chance at an EXCLUSIVE module | saga:481-486 | 0.14.0 | locked | NOT BUILT | OK | Planned. |
| S4-H06 | Precursor Lens special module = first E-MOD content | expl:264-275 | 0.14.0 (E-MOD) | resolved 2026-10-01 | NOT BUILT | OK-recorded | Known: waits on E-MOD. |
| S4-H07 | CHAOTIC GEAR (big bonus + big debuff) | saga:488-492 | future | idea | NOT BUILT | OK | |
| S4-I01 | Mission taxonomy: each pillar gets a 2nd type | saga:501-506 | 0.14.0 / 0.14.x | locked direction | PARTIAL: exploration has 2 types; others deferred | OK | |
| S4-I02 | FLEET OPERATIONS (combat 2nd type) | saga:503, 586 | 0.14.x | deferred | NOT BUILT | OK | |
| S4-I03 | PROSPECTING 2nd type | saga:504, 586 | 0.14.x | deferred | NOT BUILT | OK | |
| S4-I04 | TRADING pillar (buy low / sell high) | saga:507, 585 | 0.14.x | deferred | NOT BUILT (prestige Trade branch ships as gateways) | OK | |
| S4-I05 | ENDLESS MODE (scales harder, grants bonuses) | saga:508, 586 | 0.14.x | considered, on roadmap | NOT BUILT | DRIFT | Contradicts md 6.11 / 7.14 ("Endless Game / No Ending: Rejected") with no recorded reconciliation. |
| S4-I06 | BALANCING SYSTEM meta-need: repeatable way to balance generated content | saga:509-510 | unspecified | idea | NOT BUILT | DECIDE | No target release. |
| S4-I07 | Short/local planetary SURVEYS of known systems + local phenomena | saga:512-514 | 0.14.0 | locked | BUILT: survey missions (model.ts ~595-630, `missionType: "survey"`) | OK | |
| S4-I08 | TRANSPORT supply run fills the hold with BOUGHT **or CRAFTED** supplies (prospecting -> crafting -> supply loop) | saga:515-518; expl E1:72-74 | 0.14.0 | locked scope (I.7) | PARTIAL: credit-only supply run built; crafted-supplies-in loop explicitly deferred in code (model.ts:316-318) with no owning phase | GAP | |
| S4-I09 | Transport variants: refugees, PRISONERS to a penal colony, supply drop-offs | saga:516-517 | 0.14.0 | locked examples | BUILT in 0.14.0 G1 (Short-Range Missions: Refugee Relocation, Prisoner Transport, Supply Drop-off; G1-7 close-out 2026-11-02) | OK | Prisoners became a set-and-forget short-range job on guest quarters + Security crew rating (user 2026-10-19), not a Boarding Party mission. Refugees to facility crews stays E5 (S4-C30). |
| S4-I10 | Expedition TRANSIT ~6h + shorter inaugural shakedown | saga:521-522 | 0.14.0 | locked | BUILT (expedition.ts:96-97) | OK | |
| S4-I11 | Mid-transit chance to CHART AN ANOMALY (adds time, bonus), player opt-in | saga:522, 564-565 | 0.14.0 | locked | BUILT: `anomalyOptIn` (expedition.ts:729-743); bonus is a placeholder finding | OK | |
| S4-I12 | SCANNING via Wide / Focused / Balanced arrays (sensor-item variants) | saga:523-525; I.6:577-579 | 0.14.0 | locked | PARTIAL: catalog + engine built (sensorArrays.ts), but Wide/Focused/Balanced have NO acquisition path: the only sensor blueprint is relic-gated `bioResonanceArrayBp` (model.ts:7685-7700); the install tile exists only in the working tree | GAP | A new player cannot get any sensor array (or any sensors stat) until after relic progress, so survey sensor scaling and expedition foreknowledge (`SENSOR_REVEAL_IN_RANGE` 8) are unreachable early. Beyond the recorded "install tile" gap. |
| S4-I13 | LANDMARKS / PoIs (ruins, crashed ships, minerals, caves, special) | saga:526-527 | 0.14.0 | locked | BUILT: expeditionContent.ts (9 PoIs) | OK | |
| S4-I14 | 100% scan -> activity list from planet type + discoveries | saga:528 | 0.14.0 | locked | BUILT | OK | |
| S4-I15 | MULTI-BODY systems: 1-3 planets + satellites + other bodies | saga:529-530 | 0.14.0 | locked | PARTIAL: 1-3 bodies (expedition.ts:121-122); satellites only as gas-giant flavor (`orbitalOnly`) | OK | Simplification recorded at expl:133-136. |
| S4-I16 | Certain finds need planet type + an exploration BUILD (e.g. underground civilization -> relics) | saga:531-532 | 0.14.0 | locked | PARTIAL: planet-type eligibility + array pool bias built | OK | |
| S4-I17 | Battles auto-resolve; WIN -> continue, LOSE -> evacuate + restart task; always win something | saga:533-535 | 0.14.0 | locked | BUILT: `MAX_BATTLE_ATTEMPTS` 3 then evacuate with partial haul (gambit.ts:102, 1330-1395) | OK | |
| S4-I18 | Task rewards: ENEMY DROPS + RANDOM-EVENT DROPS + treasure chest / Expeditionary Findings with relic chance | saga:536-537; expl:157-158 | 0.14.0 | locked | PARTIAL: one haul + one relic roll per task (gambit.ts `rollHaul`, `rollRelicToken`); no enemy-drop or random-event layers; every activity forces a battle (no non-hostile site) | GAP | Hostile-only contact is planned in the squad-split rework (expl:288-292); the drop layers are not planned anywhere. |
| S4-I19 | GROUND-TEAM CAPACITY: one task at a time; higher-tier ships carry multiple teams -> simultaneous tasks | saga:538-539; expl E3:151-152 | 0.14.0 | locked | NOT BUILT: activities complete sequentially with one implicit team (expedition.ts `resolveActivitiesPhase` 708-722) | GAP | Not in the roster OPEN list either. |
| S4-I20 | Active choice point: WHICH ACTIVITIES to run | saga:564-565; expl:27-29, 91 | 0.14.0 | locked (I.5) | NOT BUILT: every discovered activity auto-runs | GAP | |
| S4-I21 | All done -> fly home; finds become usable at home | saga:540 | 0.14.0 | locked | BUILT: `claimExpedition` deposit (E4a) | OK | |
| S4-I22 | Relics UNIDENTIFIED -> Research studies -> MUSEUM (new Archive tab) | saga:542-545 | 0.14.0 | locked | BUILT: relics.ts, RelicStudyPanel.svelte, MuseumPanel.svelte | OK | |
| S4-I23 | Relic bonus, set bonus, bonus grows with copies | saga:545-546 | 0.14.0 | locked | BUILT: `MUSEUM_COPY_LADDER`, `setTierLevels`, `museumBonuses` | OK | |
| S4-I24 | PERSISTENT NAMED AWAY-TEAM ROSTER per ship, Armor/Weapon/Tool + implant slots | saga:552-558; expl:198-225 (2026-10-01) | 0.14.0 | locked | NOT BUILT: `buildTeamCombatants` mints anonymous members per battle (gambit.ts:1054) | OK-recorded | Known deviation. |
| S4-I25 | SEMI-IDLE model (active setup, idle execution) | saga:560-569 | 0.14.0 | locked | BUILT | OK | |
| S4-I26 | Sensor role: survey power (%/sec scan) | saga:573 | 0.14.0 | locked | BUILT: `SCAN_SENSOR_COEFF` (expedition.ts) + survey yield | OK | |
| S4-I27 | Sensor role: FOREKNOWLEDGE (rewards/hazards/odds before committing) | saga:573-574 | 0.14.0 | locked | BUILT: `SENSOR_REVEAL_*` thresholds (expedition.ts:156-159) | OK | |
| S4-I28 | Sensor role: rare/anomaly detection (relics + Leviathans flagged early) | saga:574-575 | 0.14.0 | locked | PARTIAL: relic signature at `SENSOR_REVEAL_RELIC`; no Leviathans | OK | See S4-D06. |
| S4-I29 | Sensor role: FRONTIER GATING (a sensor threshold to attempt deeper regions) | saga:575 | 0.14.0 | locked | NOT BUILT: no regions/tiers exist; thresholds only reveal info | GAP | No phase owns it. |
| S4-I30 | Sensor role: DAY-ONE combat cloak/threat-detection hook in patrols (Science-officer synergy) | saga:575-576 | 0.14.0 | locked | NOT BUILT: cloak is only enemy ambush flavor (combat/resolveBattle.ts:218-219); combat never reads sensors | GAP | No phase owns it. |
| S4-I31 | Science officers + Science crew division AMPLIFY sensors | saga:578-579 | 0.14.0 | locked | NOT BUILT: `crew.sensors` / `surveyAptitude` map to nothing (crewOverlay.ts:57-61); no officer bonus targets sensors | GAP | expl:42-43 claims crew shapes exploration "by construction"; deferred in E1a (expl:352-354) with no owner. |
| S4-I32 | 0.14.0 cut line (crew + core exploration + both types + relics/museum + sensors + explorer hull + ground teams) | saga:582-584 | 0.14.0 | locked | n/a | OK | |
| S4-I33 | Roadmap: 0.14.x pillars + online, 0.15.0 tutorial + storytelling, 0.15.x online, 0.16.0 content flood | saga:588-592 | roadmap | locked | n/a | OK | |

## Crew plan (crew portion)

| ID | Item (short) | Source | Target | Doc status | Code status | Flag | Note |
|---|---|---|---|---|---|---|---|
| S4-CP01 | 7 seats (XO, Pilot, Operations, Science, Tactical, Medical, Engineering); Communications held; no Security officer | crew:42-44 | 0.14.0 | locked | BUILT: seniorStaff.ts `SENIOR_STAFF_SEATS` | OK | |
| S4-CP02 | 6 complement professions | crew:46-47 | 0.14.0 | locked | BUILT | OK | |
| S4-CP03 | 10 races (6 human origins + 4 allied species), context-scaled racial, inclusive cosmetic gender | crew:60-69 | 0.14.0 | locked | BUILT: crewRaces.ts | OK | Allied species are NEW canon (crew:67). |
| S4-CP04 | Profession buff POOLS, each earning its keep in today's missions (Ops, Flight-Deck, Engineering, Security, Science, Medical) | crew:71-80 | 0.14.0 | locked | PARTIAL: only transit, range/fuel, cargo, extraction, unload fold; Security (boarding defense, counter-infiltration, AWAY-TEAM PROTECTION), Science (RARE-FIND, SURVEY APTITUDE), Medical (crew-effectiveness, reduced losses, TRIAGE), Flight-Deck drone handling, Engineering hull repair + power efficiency are NO-OPs (crewOverlay.ts:57-72) | GAP | Exploration consumers now exist (survey, relic find, away team) yet none of these are wired, and no phase owns it. |
| S4-CP05 | Second-level-EXCLUSIVE buff pool (crew-output mult, craft duplicate chance, mission-turnaround cut, prevent-a-crew-loss) | crew:85-86 | 0.14.0 | proposed | NOT BUILT as effects (keys roll but are dormant, crewOverlay.ts:57-60) | GAP | Players can roll buffs that do nothing; no crew-loss system exists at all. |
| S4-CP06 | Rarity = multiplicative magnitude, crew capped at STELLAR (x0.9/1.0/1.15/1.35) | crew:87-91 | 0.14.0 | locked | BUILT: crewRarity.ts `CREW_RARITY_CAP` | OK | |
| S4-CP07 | 8-tier complement ladder; buff count by rank; Commander reserved for SS | crew:94-98 | 0.14.0 | locked | BUILT: crewRank.ts | OK | |
| S4-CP08 | Command structure is a PER-HULL-TYPE template (destroyer weights Security/Eng/Flight, medical hull Medical/Science, etc.) | crew:99-102 | 0.14.0 | locked | PARTIAL: per-SPEC weights (`SPEC_DIVISION_WEIGHTS`, commandStructure.ts) so destroyer/battleship/carrier and Orion/Aurora/Eir share templates | DRIFT | Eir (medical transport) gets the same mix as Orion. |
| S4-CP09 | Inclusive/cascading rank caps | crew:103-105 | 0.14.0 | locked | BUILT: `inclusiveRankCap` | OK | |
| S4-CP10 | Total cap from hull `crewStations` + quarters module | crew:106-107 | 0.14.0 | locked | BUILT: `quartersCapacityBonus` | OK | Module unobtainable, see S4-CP23. |
| S4-CP11 | Passive auto-fill top-rank-down | crew:110-112 | 0.14.0 | locked | BUILT | OK | |
| S4-CP12 | Senior Staff give LARGER, SWEEPING, UNIQUE bonuses | crew:117-121 | 0.14.0 | locked | PARTIAL: rank scaling built, but 11 of 16 officer bonus stat keys are DORMANT (crewOverlay.ts:85-95): both TACTICAL bonuses (weapon/shield effectiveness), Science Discovery Instinct, Medical Fleet Triage + Rapid Recovery, XO Command Presence + Morale Anchor, Pilot Evasive Command, Eng Reactor Overdrive, both "any" bonuses | GAP | A Tactical officer contributes nothing; the "crew never double-dips weapons" rule (written for the complement) was applied to officers too. The 09-25 deferral list (crew:591-603) does not cover officer bonuses. |
| S4-CP13 | Complement progression by acquiring better pools; SS promoted individually | crew:123-126 | 0.14.0 | locked | BUILT | OK | |
| S4-CP14 | Seats are TYPED; officer fills only its matching seat | crew:129-132 | 0.14.0 | locked | BUILT | OK | |
| S4-CP15 | SS rank ladder of 5 starting at Cadet | crew:133-135 | 0.14.0 | locked | BUILT | OK | |
| S4-CP16 | Candidate roster base 10, EXPANDABLE via an upgrade | crew:136-137 | 0.14.0 | locked | PARTIAL: `seniorStaffRosterSize` field (model.ts:6057), nothing raises it | GAP | No upgrade designed or scheduled. |
| S4-CP17 | Officer power keys off the stats the hull accentuates (officer<->ship synergy) | crew:138-139 | 0.14.0 | locked | PARTIAL: only via the Focused Command bridge module (crewModules.ts:299-306), which cannot be obtained | GAP | Base officer output has no hull synergy. |
| S4-CP18 | Captain retirement + XO succession: +1 secondary point, base-tree respec, account EXP stack, cap 5 then lock | crew:142-166, 563-576 | 0.14.0 | locked | BUILT: captainRetirement.ts, captainSecondaryTree.ts, App Prestige tab | OK | |
| S4-CP19 | SOFT captain level cap (diminishing returns past a threshold) | crew:159-161, 164-166 | 0.14.0 (Phase 1c) | locked | NOT BUILT: `xpForNextLevel` = 300 * level, linear (model.ts:8647-8649) | GAP | Phase 1c (C-3b) shipped without it. |
| S4-CP20 | Player ADVISED before the final (5th) retirement | crew:155 | 0.14.0 | locked | NOT BUILT: retire ActionModal has no final-retirement warning | GAP | |
| S4-CP21 | Retiring captain departs with a HALL OF COMMAND honor (ties C.6) | crew:147 | 0.14.0 | locked | NOT BUILT (no symbol anywhere) | GAP | Not in the E-CAP phase text (expl:311-314). |
| S4-CP22 | Hull-specialist 8th seat KILLED (fantasy moves to bridge variants) | crew:167-171 | 0.14.0 | locked | n/a | OK | |
| S4-CP23 | BRIDGE (3) + QUARTERS (9) module variant sets, craftable + rollable on bridge/quarters slots | crew:172-189, 331-339 | 0.14.0 | locked | PARTIAL: catalogs + effects built (crewModules.ts) but NO blueprint mints them (blueprint equipmentOutput slots are only cargoBay/ftlDrive/reactorCore/sensor/shieldEmitters/hullPlating/specUtility) AND no install tile (ShipSystemsPanel has no bridge/quarters slot meta) | GAP | Known install-UI gap is recorded; the missing acquisition path is NOT recorded. Unreachable feature. |
| S4-CP24 | Bridge set size: lean 3-4 vs 9 seat-focused | crew:181 | 0.14.0 | open | PARTIAL: 3 built (crewModules.ts BRIDGE_MODULES) | DECIDE | |
| S4-CP25 | Capacity principle (capacity from hull; only Efficient quarters scales capacity) | crew:182-186 | 0.14.0 | locked | BUILT in crewModules.ts | OK | |
| S4-CP26 | Quarters as home for per-type cap shaping, crew comfort/efficiency, MORALE / RETENTION levers | crew:336-339 | 0.14.0 | proposed | PARTIAL: `crewEfficiency` reserved; no morale/attrition system (`officer.crewRetention` dormant "no attrition system yet") | DECIDE | |
| S4-CP27 | Bucket data model + notables + migration 54->55 | crew:212-306 | 0.14.0 | locked | BUILT | OK | |
| S4-CP28 | Engine seams (overlay, unload, game-time roster refresh, transport accumulator, auto-crew) | crew:310-329 | 0.14.0 | locked | BUILT | OK | |
| S4-CP29 | Phase 5 UI as SEPARATE desktop + mobile view layers | crew:361-363 | 0.14.0 | locked (standing directive) | PARTIAL: crew UIs are single container-query layouts ("no JS mobile branch", commit 47843e9) | DRIFT | Verify against the platform-independent-presentation directive. |
| S4-CP30 | Phase 6 ship prep (APP_VERSION, QA sheet, patch notes, Discord) | crew:364-365 | 0.14.0 | planned | NOT BUILT (release not prepped) | OK | |
| S4-CP31 | Personnel bucket lives on the ship (Senior Staff + Complement sub-tabs) | crew:384-387 | 0.14.0 | locked | BUILT (ee95d7a) | OK | |
| S4-CP32 | Ship STATS screen: (i) definitions + tap-value SOURCE popover; staff detail lists provided stats | crew:389-398, 579-584 | 0.14.0 | locked | BUILT (ba14780 STAT_INFO + popover) | OK | |
| S4-CP33 | "Install preview" toggle showing crew-inclusive before->after deltas | crew:583-584 | 0.14.0 | locked | PARTIAL: gear-only install compare exists; no toggle symbol found | OK | Minor; compare covers most of it. |
| S4-CP34 | Objective-gated promotion with working placeholder criteria; home in SS detail | crew:400-406 | 0.14.0 | locked | BUILT (b08b27d) | OK | |
| S4-CP35 | Complement graph overhaul (clamped axis, double-layer bars, utilization hue, wide tap zones, compact labels) | crew:408-436 | 0.14.0 | locked | BUILT: ComplementPanel.svelte | OK | |
| S4-CP36 | Graph palette is a player "mini graph theming option"; ALL game graphs separately colorable | crew:425-427, 437 | 0.14.0 | locked | PARTIAL: complement graph uses its own fixed hsl palette (ComplementPanel.svelte:24-28, 148-150); no player-facing graph palette setting | GAP | Minor. |
| S4-CP37 | Personnel Rosters facility: save / update (confirm) / delete, unsaved-swap warning | crew:439-445 | 0.14.0 | locked | BUILT: PersonnelRostersPanel.svelte (unsaved warning covers the name field only) | OK | |
| S4-CP38 | Load a roster via a DROPDOWN from the ship's personnel screen | crew:440-441 | 0.14.0 | locked | NOT BUILT: apply happens only inside the Personnel Rosters facility (PersonnelRostersPanel.svelte:538) | GAP | |
| S4-CP39 | Optional linked Armory loadout: exact caps preview + GEAR TRAVELS with the roster | crew:480-489 | 0.14.0 | locked (synthesis) | PARTIAL: link stored (`setLinkedLoadout`); `applyRoster` applies people only, gear swap left to the Armory (personnelRosters.ts:268-273) | GAP | |
| S4-CP40 | Priority-ordered pins with position indicator + reorder; partial roster auto-fills remainder (not persisted) | crew:454-489 | 0.14.0 | locked | BUILT: `reorderNotable`, `moveNotableUp/Down`, `applyRoster` | OK | Notables cannot be created (S4-C24). |
| S4-CP41 | Favoriting officers + notable crew | crew:452-453 | 0.14.0 | locked | BUILT (6a01481) | OK | |
| S4-CP42 | Captain PRESTIGE secondary tree content: 3 trees x 3 branches x 5 talents (revised Prospector = Extraction/Logistics/Trade) | crew:491-553 | 0.14.0 | locked framing, first-pass numbers | BUILT catalog + radial UI (47843e9) | OK | |
| S4-CP43 | Secondary-talent EFFECT application (captain->ship prestige overlay, 9 capstone procs) | crew:595-599 | balance pass | deferred | NOT BUILT | OK-recorded | Trigger "when the exploration half exists" is now met. |
| S4-CP44 | Promotion non-mission counters (shipsDestroyed, crewHours, personnelAchievement) | crew:600-603 | balance pass | deferred | NOT BUILT (placeholders, model.ts:5309-5330) | OK-recorded | |
| S4-CP45 | Fleet-wide FABRICATION perks move to the Homeworld (adminPoints) tree | crew:541-545 | unspecified ("future") | resolved, unscheduled | NOT BUILT | DECIDE | No target release. |
| S4-CP46 | Trade + Fleet Ops talents ship as gateways | crew:497, 536-540 | 0.14.0 | locked | BUILT (isHub / `none` effects) | OK | |
| S4-CP47 | Captain RACIAL-bonus application (XO identity carried as data) | crew:569-570 | 0.14.0 (ties E-CAP) | documented follow-on | NOT BUILT | GAP | E-CAP phase text (expl:311-314) omits it. |
| S4-CP48 | Retirement guards (level gate, < 5, seated XO, idle) + XO consumed | crew:564-576 | 0.14.0 | locked | BUILT | OK | |
| S4-CP49 | Notable-to-ship assignment folds into the crew overlay (GL-1) | crew:555-561 | 0.14.0 | locked | BUILT (c5f8778) | OK | |

## Exploration plan (exploration portion)

| ID | Item (short) | Source | Target | Doc status | Code status | Flag | Note |
|---|---|---|---|---|---|---|---|
| S4-EX01 | Crown-jewel invariant: offline == live, no Date.now/Math.random, additive-neutral | expl:23-31 | 0.14.0 | locked | BUILT (expedition.ts header, deterministic seeds) | OK | |
| S4-EX02 | E0: explorer hull(s) + contrast pole wired into SHIP_TYPES + explorer complement band | expl:55-60 | 0.14.0 | planned | BUILT (Orion/Aurora/Eir) | OK | Grid/deuterium parts: S4-A03, S4-A05. |
| S4-EX03 | E1a: survey missions, sensors stat goes live, rare/exotic materials + credits + XP | expl:69-77, 343-354 | 0.14.0 | locked | BUILT (3d12594) | OK | |
| S4-EX04 | E1b: transport/supply missions + Exploration Ops tab | expl:72-74, 347-349 | 0.14.0 | locked | BUILT credit loop (94ee17f) | OK | Crafted-supplies gap: S4-I08. |
| S4-EX05 | E2a: expedition state machine TRANSIT -> SCANNING -> ACTIVITIES -> RETURN | expl:79-92 | 0.14.0 | locked | BUILT (896e157) | OK | |
| S4-EX06 | E2b: 8 planet types + hazard tiers + 9 PoIs (surface/underground pools) + gas-giant orbital-only | expl:94-147 | 0.14.0 | locked | BUILT: expeditionContent.ts (5302a09) | OK | |
| S4-EX07 | E2c: Expedition Console (dispatch, in-progress, foreknowledge, anomaly opt-in) | expl:91 | 0.14.0 | locked | BUILT: ExpeditionPanel.svelte (04406b5) | OK | Activity selection missing: S4-I20. |
| S4-EX08 | E3: away-team gambit resolver REUSES/EXTENDS `src/lib/game/combat/` (no 2nd battle engine) | expl:37-38, 153-154 | 0.14.0 | locked | PARTIAL: gambit.ts is a separate engine (`resolveGroundBattle`), reusing only combat/rng and salvage loot pools | DRIFT | No recorded decision to build a second engine. |
| S4-EX09 | E3 gambit MODEL at FFXII depth: target selectors, granular HP thresholds, statuses + cures, role actions, enemy roles, presets | expl:163-196 | 0.14.0 | locked | BUILT: model.ts `GambitTargetSelector`/`GambitActionId`, gambit.ts `GAMBIT_STATUSES`, `ENEMY_ROLE_PROGRAMS`, `GAMBIT_PRESETS`, GambitEditorPanel | OK | |
| S4-EX10 | Non-target conditions: opening round, outnumbered, enemy group count >= N, skill/item available, objective in reach; Burn status | expl:177-181 | 0.14.0 first-pass | locked model | PARTIAL: openingRound + outnumbered built; group-count, item-available, objective-in-reach conditions and Burn not built | OK | Content depth is balance-pass per expl:193-196. |
| S4-EX11 | Gambit interpreter GENERALIZABLE so ship combat adopts it later (gambits-everywhere) | expl:167-168 | later | locked direction | PARTIAL (ground-only today) | OK | |
| S4-EX12 | Away-team roster OPEN design items: recruitment, members per squad, gear catalog + crafting, slot counts, member progression, death/injury on fall | expl:222-225 | 0.14.0 | open (mockup first) | NOT BUILT | DECIDE | See also S4-C06, S4-C11, S4-C12 for earlier intent already answering parts. |
| S4-EX13 | E4a: claim DEPOSITS materials (via `addToInventory`), credits, relics | expl:237-241 | 0.14.0 | locked | BUILT (fdc0c9c) | OK | |
| S4-EX14 | Relics + artifacts COMBINED (union: unidentified -> study -> first-find unlock -> museum copies, sets, doubling ladder, bottleneck) | expl:242-253 | 0.14.0 | locked | BUILT: relics.ts (4 sets, 17 relics, ladder 10/20/40/80/160, +0.005) | OK | |
| S4-EX15 | E4b Museum bonuses live (14 stats) + E4c Relic Study + Museum UI | git 4b534b5, 4bf7fe0 | 0.14.0 | locked | BUILT | OK | |
| S4-EX16 | E4d: Ancient Drive Coil -> COMBAT utility (recovery: faster post-loss repair + between-wave regen) | expl:258-259, 274-275 | 0.14.0 | locked | PARTIAL (working tree): utilityGear.ts Damage Control Suite, patrolWave/tick edits | OK | Uncommitted. |
| S4-EX17 | E4d: Deep-Vein Compass -> EXPLORER utility (sensors + scan speed + hazard resist) | expl:260-261 | 0.14.0 | locked | PARTIAL (working tree): utilityGear.ts Pathfinder Suite | OK | Uncommitted. |
| S4-EX18 | E4d: Leviathan Scale -> RELIC-HUNTER scanning array | expl:262-263 | 0.14.0 | locked | PARTIAL (working tree): `bioResonanceArrayBp` / `sensorBioResonance` | OK | Uncommitted. |
| S4-EX19 | Heart of the Archive -> NEURAL BACKUP implant (unique-equipped, one per fleet, once per battle, ~50% revive) | expl:266-273 | 0.14.0 | locked | NOT BUILT | OK-recorded | |
| S4-EX20 | FULL CYBERNETICS in 0.14.0 (implant system + starting catalog; per-member; Security combat vs Science overworld implants) | expl:276-294 (2026-10-01) | 0.14.0 | locked | NOT BUILT | OK-recorded | Recorded as a decision, but there is no numbered phase for it in the plan's phase list. |
| S4-EX21 | Equipment-icon SVG migration pass after E4 | expl:283 | 0.14.0 | planned | NOT CHECKED | OK | |
| S4-EX22 | Squad split: CONTACT (Security-only battle, in-fight medic skills + kit) then FIELDWORK (Science strength + implants + Museum Science power drive speed/yield/relic odds) | expl:284-294 | 0.14.0 | locked | NOT BUILT (Science still fights, has `secureObjective`) | OK-recorded | |
| S4-EX23 | E5 refugees -> facility crews via an E1 transport variant | expl:296-299 | 0.14.0 | built | BUILT in 0.14.0 E5 (the Evacuation short-range template; E5-7 close-out 2026-11-03) | OK | Same as S4-C30. |
| S4-EX24 | E-MOD universal modules, same slot-activation pattern as crew modules + sensors | expl:301-309 | 0.14.0 | planned | NOT BUILT | OK | Same as S4-H02..H05. |
| S4-EX25 | E-CAP wires to crew/officer + objective-gated promotion | expl:311-314 | 0.14.0 | planned | NOT BUILT | OK | |
| S4-EX26 | Sensor-array install tile | known-gap list (caller); ShipSystemsPanel.svelte working tree comment | 0.14.0 | known gap | PARTIAL (working tree adds `{ slotType: "sensor" }`, uncommitted) | OK-recorded | Acquisition gap is separate: S4-I12. |
| S4-EX27 | OPEN 1: vestigial fuel cleanup | expl:329-333 | 0.14.0 | open | n/a (see S4-A02) | OK | Pointer only; the DECIDE is counted at S4-A02. |
| S4-EX28 | OPEN 6: should E-CAP / E-MOD land earlier | expl:340-341 | 0.14.0 | open | n/a | DECIDE | |
| S4-EX29 | OPEN 4/5: expedition tuning numbers; gambit depth | expl:336-339 | 0.14.0 | resolved / balance pass | n/a | OK | |
| S4-EX30 | E-CAP needs a PERSONNEL achievement tier, but there is NO achievement system in the code at all | expl:312-313; saga:347-349; crew:602-603 | 0.14.0 | locked dependency | NOT BUILT (no achievement module under src/lib/game) | GAP | The base achievements framework (SUGGESTIONS "ACHIEVEMENTS: THREE TIERS", md 4.14) is not a phase in the 0.14.0 plan, yet E-CAP and the promotion counter depend on it. |

## 2.0 three-pronged design (deep-future; only conflicts with 0.14.0 flagged)

| ID | Item (short) | Source | Target | Doc status | Code status | Flag | Note |
|---|---|---|---|---|---|---|---|
| S4-T01 | 2.0 gated by STORY chapters; System 1 Prestige, System 2 Flagship, System 3 Active Mode | 2.0:14-19 | 2.0 | idea | NOT CHECKED | OK | |
| S4-T02 | "THE INCIDENT" is introduced in 0.14.0 as the story's intro | 2.0:20-23 (2026-09-18) | 0.14.0 | stated | NOT BUILT; absent from every 0.14.0 plan | DRIFT | I.7 roadmap (2026-09-23) puts storytelling in 0.15.0; decide whether the incident intro rides 0.14.0. |
| S4-T03 | Each prestige turns the game on its head (e.g. galaxy-wide anomaly hazards) | 2.0:28-32 | 2.0 | idea | NOT CHECKED | OK | |
| S4-T04 | Flagship/Dreadnought: passive 11th ship ("captains go up to 10"), Senior Staff man it with mode-exclusive bonuses | 2.0:38-49 | 2.0 | idea | NOT CHECKED | OK | 0.14.0 SS nouns are the reuse point. |
| S4-T05 | Dreadnought R&D gradual and in-lore across the first loop (secrecy) | 2.0:50-54 | 2.0 | idea | NOT CHECKED | OK | |
| S4-T06 | Dreadnought role switching: ONE modular prototype hull (lean) vs three capital hulls (old log) | 2.0:55-64, 120-121 | 2.0 | open | NOT CHECKED | DECIDE | |
| S4-T07 | Active Tactical: turn-based RPG battle, 3 ships scaling to 11 | 2.0:71-77 | 2.0 | idea | NOT CHECKED | OK | |
| S4-T08 | Active Prospecting: asteroids + tractor beam | 2.0:79-83 | 2.0 | idea | NOT CHECKED | OK | |
| S4-T09 | Active Exploration: FrontierNav grid played like a Wizardry-homage dungeon crawler | 2.0:85-95 | 2.0 | idea | NOT CHECKED | OK | |
| S4-T10 | Two currencies (minigame + whole-game; mode must contribute globally) | 2.0:97-107 | 2.0 | idea | NOT CHECKED | OK | |
| S4-T11 | Open forks: story chapter count, per-loop modifiers, exclusive seat bonuses, difficulty ladder | 2.0:119-130 | 2.0 | open | NOT CHECKED | DECIDE | |

## Lore

| ID | Item (short) | Source | Target | Doc status | Code status | Flag | Note |
|---|---|---|---|---|---|---|---|
| S4-L01 | First Traversal hopelessness cliffhanger cinematic ends a campaign | lore:12-29 (2026-09-16) | DT | idea | NOT CHECKED | OK | |
| S4-L02 | DT = knowledge-intact loop; bring captains forward, more each traversal | lore:31-41 | DT | idea | NOT CHECKED | OK | |
| S4-L03 | DT scaling: cosmetic inflation, ~10-25% net delta per tier, win-rate unit, one type-aware centralized seam, additive DT0 | lore:43-67 | DT | locked direction | NOT CHECKED | OK | |
| S4-L04 | Per-dimension symmetric modifiers, buffs-as-verbs, gates dreadnought around DT V; Dimension-Shifted gear | lore:55-60 | DT | idea | NOT CHECKED | OK | |
| S4-L05 | Leviathans as an escalation FORM of the antagonist | lore:69-76 | DT / exploration | idea | NOT BUILT | OK | See S4-D06. |
| S4-L06 | Protagonist callsign "Scythrael" (role fixed, NAME TENTATIVE, confirm before baking) | lore:78-91 | story / E-CAP callsigns | tentative | NOT BUILT | DECIDE | Confirm before any captain-identity callsign content. |
| S4-L07 | Millennium in hiding thread; magic crew member drip | lore:84-91 | far future | hold | NOT CHECKED | OK | Do not extrapolate. |
| S4-L08 | Archive AI from Intact Data Core -> unique Senior Staff officer; may know the DBDs, never names them | lore:93-102 (2026-10-01) | later (SUGGESTIONS) | deferred | PARTIAL: Intact Data Core flavor egg shipped (a3c72ee); AI officer not built | OK | |

## Master design doc (pre-implementation foundation, undated)

| ID | Item (short) | Source | Target | Doc status | Code status | Flag | Note |
|---|---|---|---|---|---|---|---|
| S4-MD00 | Master design + tech spec were never updated after implementation; many "committed" systems are superseded without a recorded decision | md:1-3; ts:1-7 | n/a | stale | n/a | DECIDE | Retire, annotate, or reconcile. Rows below flag only conflicts that touch 0.14.0 systems. |
| S4-MD01 | Campaign of SECTORS ending in fleet-scale BOSSES; finishable 40-60h | md:25, 44-47, 151-156, 244-250 | v1 | committed | SUPERSEDED (no sectors/bosses; story chapters + DT spine) | OK | Covered by MD00. |
| S4-MD02 | Four-layer time scales (tick / mission / sector / campaign) | md:54-68 | v1 | committed | PARTIAL (tick + missions) | OK | |
| S4-MD03 | Captains: traits, specializations, augment builds, reassignable | md:79-84 | v1 | committed | PARTIAL: talents + retirement; no traits, no augments | OK | Augments: S4-MD08. |
| S4-MD04 | Ships as platforms with module + crew slots | md:86-90 | v1 | committed | PARTIAL (moduleSlots inert until E-MOD) | OK | |
| S4-MD05 | Crew GAIN SKILLS over time and are AUGMENTABLE | md:92-97 | v1 | committed | NOT BUILT (crew rank locked at generation; crew augments cut) | OK-recorded | Decisions recorded in crew:34-37, 123-126. |
| S4-MD06 | Economy: common/rare matter + ENERGY derived currency; cargo overflow -> energy keystone; synthesis | md:99-121 | v1 | committed | SUPERSEDED (credits + warehouse caps + material-at-cap idle) | OK | Covered by MD00. |
| S4-MD07 | RELICS are UNIQUE, non-farmable, one unique effect + lore fragment each (true scarcity tier) | md:108, 215, 522-523; ts:481 | v1 | committed | SUPERSEDED: relics now stack as Museum COPIES on a doubling ladder (relics.ts `MUSEUM_COPY_LADDER`); each has a flavor line | DRIFT | E4 decisions cite the 2026-07-29 notes, not this; uniqueness/scarcity intent silently reversed. |
| S4-MD08 | Augments/cybernetics applied PRIMARILY to CAPTAINS (augment tree per captain, capability unlocks) | md:137-143, 320 | v1 | committed | NOT BUILT; 0.14.0 revives cybernetics only for away-team members (expl:276-283) | DRIFT | Captain augments are absent from every current doc. |
| S4-MD09 | Two-tier prestige: T1 captain augmentation reset; T2 retire ship to a standing fleet | md:145-149 | v1 | committed | PARTIAL: captain retirement mini-prestige is a T1 analog; ship-to-standing-fleet absent; DT is the mega-prestige | DECIDE | |
| S4-MD10 | Research DISCOVERS new materials; research-generated content | md:122-125 | v1 | committed | PARTIAL (blueprint research; relic-gated research in working tree) | OK | |
| S4-MD11 | Mission types incl. exploration, salvage, mining, trade routes, intercept/raid | md:127-135 | v1 | committed | PARTIAL (trade = 0.14.x) | OK | |
| S4-MD12 | Hostile encounters as content gates, not a passive tax | md:158-163 | v1 | committed | BUILT (opt-in patrols) | OK | |
| S4-MD13 | ACHIEVEMENTS first-class: 300-600, 8 categories, mixed rewards, retroactive, unlock feedback | md:165-195; ts:99-178 | v1 | committed | NOT BUILT | DECIDE | Blocks E-CAP (S4-EX30). |
| S4-MD14 | COMPENDIUM (relics, materials, ship classes, captain types, codex, bosses) as a hub | md:197-226; ts:180-188 | v1 | committed | NOT BUILT (Museum covers relics only) | DECIDE | |
| S4-MD15 | Open 5.4 captain progression incl. portrait + history | md:262-269 | v1 | open | PARTIAL; portrait/history ride E-CAP | OK | |
| S4-MD16 | Open 5.3/5.5 enemy identity + driving force | md:252-281 | v1 | open | n/a: resolved in lore (First Cause / DBDs, gathering threat) | OK | |
| S4-MD17 | Open 5.9 / 6.8 prestige walls visible (completion, diminishing returns, next thing) | md:292-293, 322-328 | v1 | principle | PARTIAL: retirement pips/lock; diminishing-returns soft level cap missing (S4-CP19) | OK | |
| S4-MD18 | 6.11 / 7.14 The game has an ending; endless game rejected | md:338-342, 392-393 | v1 | committed | n/a | OK | Conflict recorded at S4-I05. |
| S4-MD19 | 7.5 fuel-as-jump-cost rejected for capability gates | md:365-366 | v1 | rejected | n/a: consistent with fuel-to-reach (reach from hull/drive capability) | OK | |
| S4-MD20 | 7.12 crew get no full RPG identity | md:386-388 | v1 | rejected | n/a: named, geared away-team members planned (expl:201-209) | OK | Away team is not the complement; user decided 2026-10-01. |
| S4-MD21 | Parking lot 8.A.1-8.A.4 (boss fleet composition, sector modifiers, emergency events, manual scanning) | md:407-431 | idea | idea | NOT BUILT (planet hazard tiers are a partial analog of 8.A.2) | OK | |
| S4-MD22 | Parking lot 8.B.1-8.B.7 (relationships, standing-fleet orders, research unlocks classes, first-captain arc, Hall of Records, cosmetic distinctions, difficulty predictions) | md:439-466 | idea | idea | PARTIAL: hull blueprints (8.B.3), threatAssessment.ts (8.B.7), lifetimeStats (8.B.5 partial) | OK | |
| S4-MD23 | Parking lot 8.C active minigames | md:470-490 | idea | superseded by 2.0 active mode | NOT BUILT | OK | |
| S4-MD24 | Parking lot 8.D (traits, synthesis per captain, mid-mission decisions, captain death, NG+, lore via relics, recruitment variety, factions, carrier, battle playout, difficulty settings) | md:498-541 | idea | idea | PARTIAL: carrier + CombatView built; relic flavor lines; rest not built | OK | |
| S4-MD25 | Dev practices 8.E (save versioning, closed-form offline, debug panel, number formatting) | md:549-581 | v1 | committed | BUILT | OK | |
| S4-MD26 | Parking lot 8.F (ship names, salvage decommission, pre-fight sim, retroactive unlocks, ship logs, weekly events, resource sinks, voice lines, cross-ship transfer, cutscenes) | md:594-622 | idea | idea | PARTIAL: renameShip, salvageShip, forecast/threat built; rest not built | OK | |
| S4-MD27 | 9.4 dev tooling (speed multiplier presets, bookmarks, live constants, curve visualizer, greedy-buy sim, snapshots, instant offline sim, speedrun) | md:642-722 | v1 | recommended | PARTIAL (debug panel, offline summary; no speed multiplier or bookmarks found) | OK | |
| S4-MD28 | 9.6 glassy holographic visual direction | md:848-945 | v1 | recommended | SUPERSEDED (0.12.0 console redesign) | OK | |

## Technical spec (pre-implementation, undated)

| ID | Item (short) | Source | Target | Doc status | Code status | Flag | Note |
|---|---|---|---|---|---|---|---|
| S4-TS01 | Flat entity store, cross-refs by id | ts:121-155 | v1 | decision | BUILT (officers flat + `assignedShipId`, equipment `fittedToShipId`) | OK | |
| S4-TS02 | Crew as individual entities with per-role skill level + augment state | ts:61-67 | v1 | decision | SUPERSEDED by the bucket histogram (crew:212-261) | OK-recorded | |
| S4-TS03 | Relic entity with discovered timestamp + effect + lore | ts:92-97 | v1 | decision | PARTIAL: museum copy counts + flavor; no per-relic discovered timestamp | OK | |
| S4-TS04 | Achievement entity + event-driven triggers + retroactive check on load | ts:99-178 | v1 | decision | NOT BUILT | OK | Counted under S4-MD13 / S4-EX30. |
| S4-TS05 | Tick closed-form in game-seconds; speed multiplier modifies delta | ts:192-240 | v1 | decision | BUILT (closed form); speed multiplier not found | OK | |
| S4-TS06 | Production formula: additive within layer, multiplicative across (crew x captain x fleet x prestige) | ts:266-292 | v1 | decision | PARTIAL (crew overlay; retirement EXP multiplicative) | OK | |
| S4-TS07 | CAPABILITY system: binary `category.specific` strings at captain/ship/fleet gating sectors/missions | ts:296-339 | v1 | decision | NOT BUILT (gates are level/cargo/blueprint checks) | DECIDE | 0.14.0 hazards ("needs a hardened team") and frontier gating (S4-I29) are natural consumers. |
| S4-TS08 | Prestige state categories A-E; Augment Points + Fleet Points currencies | ts:343-382 | v1 | decision | SUPERSEDED (retirement points + DT) | OK | |
| S4-TS09 | Save JSON + LZ-string + Base64, chained migrations, corrupt-save handling | ts:386-437 | v1 | decision | BUILT | OK | |
| S4-TS10 | Multiple save slots | ts:428-431 | future | idea | NOT BUILT | OK | |
| S4-TS11 | Fleet soft cap 8-10 ships | ts:441-466 | v1 | decision | PARTIAL (docks 8 -> 16, 10 captains) | OK | |
| S4-TS12 | Campaign soft gates, one-time per-sector rare drops | ts:470-503 | v1 | decision | SUPERSEDED | OK | |
| S4-TS13 | Monetization (supporter edition, palette packs, donation link, charity packs; no gacha/time-skips) | ts:507-735 | v1.5+ | deferred | NOT BUILT | OK | |
| S4-TS14 | Architectural prep from day one: CSS palette tokens, nullable `user_id` in save, feature flags, auth interface, `checkEntitlements()` | ts:714-724 | v1 | decision | PARTIAL: theme tokens exist; user_id / feature flags / auth seam / entitlement hook not found (captainName.ts is the only server seam) | DECIDE | Online now 0.14.x / 0.15.x. |
