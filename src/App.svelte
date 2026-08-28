<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Decimal from "break_infinity.js";
  import Starfield from "./lib/Starfield.svelte";
  import Panel from "./lib/Panel.svelte";
  import SubTabs from "./lib/SubTabs.svelte";
  import ConsoleTabs from "./lib/ConsoleTabs.svelte";
  // Ship Systems (0.11.0 equipment 0.11.0 fitting UI), the REAL, player-facing
  // install/uninstall screen for one ship. A reusable modal-hosted panel opened
  // from BOTH the Docks ship list and the Fleet Captain's Overview. It reads the
  // equipment helpers + derived stats; its Install/Uninstall bubble back up to
  // the installSystem/uninstallSystem handlers below (which own persistence), so
  // the fit logic + doSave live in exactly one place. Distinct from the retained
  // DEV_MODE equipment harness (System > Debug), which stays for testing.
  import ShipSystemsPanel from "./lib/ShipSystemsPanel.svelte";
  // Combat View (Combat 0.13.0, Phase 12b Unit C): the DISPLAY-ONLY "watch the
  // combat" arena + Log-Guided log, opened as a modal from an in-flight patrol's
  // View Combat Log button. It reads a pure replay of the patrol (replayPatrol)
  // and never mutates game state; open/close is managed by combatViewCaptainId.
  import CombatView from "./lib/CombatView.svelte";
  // Equipment 0.11.0 Phase D (2026-07-20): the reusable rarity-bordered equipment
  // card, rendered inline below the Ship Systems bay grid when a tile is selected.
  // equipmentRarityColor (its module-context export) is the SINGLE rarity->color
  // source the bay TILES also read, so tile border/dot and the tooltip never drift.
  import EquipmentTooltip, { equipmentRarityColor, equipmentIcon } from "./lib/EquipmentTooltip.svelte";
  // Radial Skill Web (Task 11b, minimal buildable integration), the pannable
  // fog-of-war talent web that REPLACES the old depth-row talent panels in
  // BOTH the Captain Talents and Homeworld Talents sub-tabs below. It owns its
  // own tooltip + Learn button internally (see RadialWeb.svelte), so App.svelte
  // no longer renders any per-node talent markup or the shared talent tooltip
  // overlay. Branches are HARDCODED here for now (captain -> "resourcefulness"/
  // Prospector, homeworld -> "fleetLogistics"); Tasks 14/15 layer the spec/
  // category selection UX in front of this.
  import RadialWeb from "./lib/RadialWeb.svelte";
  // Radial Skill Web (Task 14), the card spec-picker shown in the Captain
  // Talents panel when a captain has NOT yet chosen a spec (activeCaptain.spec
  // === null). Picking a card commits that spec for free (chooseCaptainSpec);
  // once chosen, the panel renders that spec's RadialWeb instead (see the
  // captain Talents sub-tab markup below).
  import TreeSelector from "./lib/TreeSelector.svelte";
  // Player-facing release marker + patch-note history. Extracted from this
  // file so src/Landing.svelte can render the same news strip from one source.
  import { APP_VERSION, PATCH_NOTES } from "./lib/patchNotes";
  // Help program's core-systems manual (0.11.2 UI Restructure, Task 14). Static
  // structured topics, rendered verbatim like PATCH_NOTES (no markdown).
  import { HELP_TOPICS } from "./lib/helpTopics";
  import {
    freshState,
    specCards,
    // Radial Skill Web (Task 15), the 5 homeworld-category cards shown by the
    // Homeworld Talents TreeSelector (keys ARE the HomeworldTalentBranch
    // literals). Unlike specCards these do NOT lock in; picking one is pure
    // navigation into that category's web (see selectedCategory/viewCategory).
    categoryCards,
    MISSIONS,
    // Combat 0.13.0 (Phase 9b.5d): the static Combat Patrol content the new
    // Operations > Combat Patrols surface enumerates. PATROLS is the patrol roster
    // (label / wave band / transit legs / hull pool), FACTIONS supplies the fought
    // faction's display name + flavor. Both are the SAME tables the dispatch/tick
    // engine reads (canDispatchPatrol / dispatchCaptainOnPatrol), so the card can
    // never show a patrol the backend would reject.
    PATROLS,
    FACTIONS,
    requiredTicksForPhase,
    // Fuel Economy v2 (F4 UI): effectiveMissionDef rescales a base mission's transit
    // by the flying hull's speed, so the fuel-chip expenditure math can measure a burn
    // rate against the REAL (ship-adjusted) cycle length, not the un-adjusted base.
    effectiveMissionDef,
    xpForNextLevel,
    xpForNextFleetAdminLevel,
    CAPTAIN_TALENTS,
    HOMEWORLD_TALENTS,
    // Progression Pacing Rework (Task 11), live ceiling of captain slots the
    // current content can actually unlock (1 base + the 3 fleetLogisticsSlot
    // nodes = 4 today). The captain-list below uses it to split empty slots into
    // "Locked" (exists, gated by a Fleet Logistics talent) vs "Coming Soon" (a
    // roadmap slot past 4 with no unlock path built yet). See model.ts.
    MAX_UNLOCKABLE_CAPTAINS,
    // Ships, Stats Foundation (Task 11 UI), the shared, immutable hull-stat
    // table (SHIP_TYPES) plus the per-instance stat projection
    // (shipDerivedStats) drive the Sector Space > Starbase > Docks/Requisition
    // panels below. SHIP_TYPES is iterated for the Requisition buy list AND read
    // per-ship in Docks for labels/stats/moduleSlots; shipDerivedStats projects
    // one ShipInstance's 3 mission-relevant stats (cargoCapacity/
    // transitSpeedMult/extractionYieldMult) for the Docks ship rows.
    SHIP_TYPES,
    shipDerivedStats,
    // Equipment 0.11.0 DEV readout (Debug tab only): the live slot table drives
    // the [DEV] grant selector's slot/variety options, and the three instance
    // types annotate the dev handlers + template. NOT a shipped-UI dependency,
    // it feeds only the DEV_MODE-gated Equipment debug panel added this task.
    EQUIPMENT_SLOTS,
    type EquipmentInstance,
    type EquipmentSlotType,
    // Equipment 0.11.0 Phase D (2026-07-20): the two PURE derived readers the Ship
    // Systems bay header shows, spareEquipmentCount(state) = how many spare CRAFTED
    // systems occupy storage (the numerator), equipmentStorageCap(state) = the current
    // spare cap (the denominator). The SAME fns the fabricate gate + storage-upgrade
    // engine consult, so the displayed "X / cap" can never drift from the real limit.
    // EquipmentRarity types the rarity->tile-color loop var below.
    equipmentStorageCap,
    spareEquipmentCount,
    type EquipmentRarity,
    // Facility Framework + Refinery (Phase 1, Task 12 UI), the static data
    // tables the Foundry program reads. FACILITIES drives the Refinery's upgrade
    // track (next-rung materials/prereqs); REFINE_RECIPES drives the Production
    // sub-tab's per-slot line configurator (recipe dropdown + REQUIRES preview);
    // ITEMS supplies the [Bracketed Item] display labels for both. All three are
    // the SAME tables the tick.ts backend fns below (startLine / canStartLine /
    // canBuildFacilityUpgrade / startFacilityUpgrade) read, so the UI can never
    // show a recipe/upgrade the backend would reject on a data mismatch.
    FACILITIES,
    REFINE_RECIPES,
    ITEMS,
    // Research (Task R5 UI), the static blueprint table + the pure "is it
    // researched?" reader the Research Lab panel below iterates/reads. BLUEPRINTS
    // is the SINGLE source the Research sub-tab groups by tier (label / tier /
    // recipe / cost / duration); blueprintUnlocked(state, key) marks a researched
    // blueprint with its ✓ ("craftable once the Fabricator is online") state;
    // RESEARCH_FACILITY_KEY is the stable "research" facility key the rail entry +
    // upgrade wiring reference (never the raw string). All read the SAME data the
    // tick.ts research fns (canResearch / startResearch / researchSlotCount) use,
    // so the panel can't drift from what the backend enforces.
    BLUEPRINTS,
    blueprintKind,
    blueprintUnlocked,
    RESEARCH_FACILITY_KEY,
    // Fabricator (Phase 4, Task F4 UI), the stable "fabricator" facility key the
    // Fabricator rail entry + panel + upgrade wiring reference (never the raw
    // string), mirroring RESEARCH_FACILITY_KEY. Drives the Overview slot/level
    // reads, the Craft-tab canFabricate gate, and the Upgrades tab's
    // canBuildFacilityUpgrade/doStartFacilityUpgrade(FABRICATOR_FACILITY_KEY) calls.
    FABRICATOR_FACILITY_KEY,
    // Shipyard (Phase 5, Task S5 UI), the stable "shipyard" facility key the Shipyard
    // rail entry + Build/Upgrades panel + founding/upgrade wiring reference (never the raw
    // string), mirroring RESEARCH_FACILITY_KEY / FABRICATOR_FACILITY_KEY. Drives the
    // founded-vs-unfounded Build split (facilities[SHIPYARD_FACILITY_KEY].level >= 1), the
    // per-hull canBuildShip gate, and the Upgrades tab's canBuildFacilityUpgrade/
    // doStartFacilityUpgrade(SHIPYARD_FACILITY_KEY) calls (the founding rung is level 0->1).
    SHIPYARD_FACILITY_KEY,
    // Shipyard (Task S5 UI): the hull-type key type, types the per-hull loop var + the
    // doStartShipBuild param, so SHIP_TYPES lookups (label/cargoCapacity/spec/buildRecipe)
    // and the canBuildShip/shipBuildDurationTicks calls are key-checked at compile time.
    type ShipTypeKey,
    // Mission Rework (Task 8 UI): the buy-fuel price per unit, shown on the Fuel
    // Storage facility's buy control so the credits cost of +10/+100/Fill reads
    // straight off the SAME constant buyFuel (tick.ts) charges, price shown can
    // never drift from price charged.
    FUEL_CREDITS_PER_UNIT,
    // FUEL_REFINE_DURATION_TICKS import removed in the net-display fix (2026-07-16):
    // its only App.svelte use was the inline fuel-throughput math, which moved into
    // fuelFlowSummary (tick.ts). The helper reads the constant directly now, so
    // App.svelte no longer needs it.
    // CAPTAIN_SPEC_BONUS / CaptainState import removed in Task 11b: their only
    // App.svelte uses were the deleted spec-picker (CAPTAIN_SPEC_BONUS) and the
    // removed talentTooltipInfo lookup (CaptainState). HomeworldTalentBranch was
    // also dropped then (the old homeworld branch each-block cast), but Task 15
    // re-introduces it below to type the Homeworld category selector's local
    // selectedCategory navigation state (see type import below).
    type GameState,
    type MissionKey,
    type MissionPhase,
    type LootMaterialKey,
    type CaptainTalentBranch,
    type CaptainTalentKey,
    type HomeworldTalentKey,
    type HomeworldTalentBranch,
    // (ShipTypeKey, Task 11 UI, was dropped in S4 with the Requisition buy
    //  handler that was its only consumer. The Docks ship-row loop var and
    //  parked-ship picker list are all inferred from state.ships
    //  (ShipInstance[]), so no ship-type key type is imported here anymore.)
    // Phase 2 (Warehouse UI, Group C): ItemCategory drives the category->tab
    // mapping (raw/refined/component/ship-equipment grids); ItemDef is the tile
    // metadata (rarity/tier/unlockHint/label) the fill-tiles + tooltip read.
    type ItemCategory,
    type ItemDef,
    // Research (Task R5 UI): the blueprint def shape, types the reason→text
    // helper's `bp` param (so tierLocked can read bp.tier for its "Requires
    // Research Lab level N" message) and the per-blueprint markup loop var.
    type BlueprintDef,
    // Combat 0.13.0 (Phase 9b.5a): CaptainState.mission is now a discriminated union
    // (extraction | patrol | null). extractionMissionOf narrows it to the extraction arm
    // (or null) so the status readouts + in-progress list below can read extraction-only
    // fields (missionKey/phase/cargo) type-safely without hand-narrowing at each site. No
    // patrol UI this unit (that is 9b.5c); a patrolling captain simply reads as not-on-an-
    // extraction-run in these extraction-scoped views.
    extractionMissionOf,
    // Combat 0.13.0 (Phase 9b.5d): the persisted patrol-mission shape + its key/phase
    // types, so the Combat Patrols in-flight readout can read a patrolling captain's
    // live carry-state (playerHull / playerShield / wavesWon / phase) type-safely.
    // extractionMissionOf narrows the OTHER arm; a patrol is read by hand-narrowing
    // `mission.kind === "patrol"` (there is no patrolMissionOf helper, and the
    // discriminant narrows cleanly at each site).
    type PatrolKey,
    // Combat 1.0 (Unit 2.4): ShipInstance types the resolved patrol ship, PatrolDef the
    // patrol, both passed to the advisory forecast helper (battleRating + Threat
    // Assessment on the dispatch card).
    type ShipInstance,
    type PatrolDef,
    type PatrolMissionState,
    type PatrolPhase,
    // Combat 0.13.0 (offline recap): the wall-stop reason union, mapped to a friendly note in
    // the "While you were away" Captains rows (offlineStopReasonNote below).
    type CaptainStopReason,
  } from "./lib/game/model";
  // Equipment 0.11.0 DEV readout (Debug tab only). The fitment helpers
  // (equippedFor / canFitEquipment / fitEquipment / unfitEquipment /
  // fittedInSlot) and the pure generator (generateEquipment) are the SAME
  // functions the real fitting UI will call later; the dev panel wires them
  // so the equipment system can be device-tested now. See the devEquip*
  // handlers in the script block and the Equipment debug Panel in the System
  // tab. EquipFitBlockReason types the reason token surfaced on a blocked fit.
  import {
    equippedFor,
    fittedInSlot,
    canFitEquipment,
    fitEquipment,
    unfitEquipment,
    // Combat 1.0 (Unit 1.8b): the player-facing Ship Systems panel now uninstalls BY
    // INSTANCE id (a weapon is a MULTI slot, so "uninstall the weapon" needs an id).
    // unfitEquipmentInstance uninstalls the exact piece (economy never-empty restore,
    // combat allow-empty). The dev harness below still uses the by-slotType unfitEquipment.
    unfitEquipmentInstance,
    type EquipFitBlockReason,
  } from "./lib/game/equipment";
  import { generateEquipment } from "./lib/game/itemgen";
  // Combat 0.13.0 dev harness (Debug tab only): the ship->Combatant bridge
  // (shipToCombatant + the illustrative sampleLoadout), the sim entry point
  // (resolveBattle), and the plain dev log renderer (formatCombatLog). These wire
  // the REAL combat engine so a seeded test battle can be run + read on-device
  // BEFORE the mockup-gated combat UI (Phase 12) exists. NOT a shipped-UI
  // dependency; feeds only the DEV_MODE-gated "Run Test Battle" control below.
  // Combat 0.13.0 (Phase 9b.5d, Combat Patrols dispatch UI) adds combatHullTypeOf to
  // this bridge import: it narrows an assigned hull's typeKey to a combat hull
  // (destroyer/battleship/carrier) or null, so the dispatch card can show the
  // read-only "combat hull" check that mirrors canDispatchPatrol's notCombatHull gate.
  import {
    shipToCombatant,
    sampleLoadout,
    combatHullTypeOf,
    installedDronesForPatrol,
    defaultSystemDurabilityForHull,
    foldedPlayerDefense,
    type CombatHullType,
  } from "./lib/game/combat/bridge";
  import { resolveBattle } from "./lib/game/combat/resolveBattle";
  import { formatCombatLog } from "./lib/game/combat/logFormat";
  // Combat 0.13.0 (Phase 9b.5d): PIRATE_HULLS supplies the enemy-hull display names
  // for a patrol's hostile-pool summary; CombatStance types the player's per-patrol
  // stance choice fed to dispatchCaptainOnPatrol.
  import { PIRATE_HULLS } from "./lib/game/combat/enemyHulls";
  import type { CombatStance } from "./lib/game/combat/positioning";
  // Combat 1.0 (Unit 2.4): the two ADVISORY dispatch-card readouts. battleRating is the
  // "how geared am I" scalar; threatAssessment maps a seeded FULL-PATROL win/loss tally
  // into the named, colored Threat band the card shows (the exact win % is deliberately
  // NOT surfaced). DEFAULT_SAMPLES is rating.ts's sample count, imported (not copied) so
  // the card's forecast sweep and the engine default cannot drift.
  //
  // Unit 2.4 review (multi-wave honesty): the forecast runs the REAL FULL patrol cycle via
  // resolvePatrolWaves (patrolReplay.ts) rather than a single generated wave, so hull /
  // shield / drone / durability attrition carries between waves and a "win" means the ship
  // survived EVERY wave. resolvePatrolWaves is the same pure, display-only, parity-proven
  // resolver the combat-view replay uses; it composes the shared per-wave leaves
  // (buildPatrolPlayerCombatant + generateEnemyWaveDetailed + resolveBattle) and never
  // touches the live tick loop. The forecast drives it from a FIXED seed, never the live
  // patrol master seed. All display-only + pure.
  import { battleRating, DEFAULT_SAMPLES } from "./lib/game/combat/rating";
  import { threatAssessment, type ThreatAssessment } from "./lib/game/combat/threatAssessment";
  import { resolvePatrolWaves } from "./lib/game/combat/patrolReplay";
  // Equipment 0.11.0 Phase D (2026-07-20): salvageEquipment(state, id) recycles ONE
  // spare CRAFTED system back into a fraction of its crafting inputs, returning a
  // SalvageResult (discriminated on `ok`: success carries { next, recovered }, reject
  // carries { next: <same ref>, reason }). doSalvageEquipment below reassigns state +
  // logs the recovered materials on success, mirroring the do* handler idiom.
  // SalvageRejectReason types the reason->text mapper.
  //
  // salvageSalvagedMaterial(state, itemId) is the SECOND salvage model (0.11.0 Task C2):
  // it consumes ONE unit of a `salvagedMaterial` item (the Damaged Reactor Housing) and
  // rolls its tiered loot pool for a single drop. The SUCCESS branch additionally carries
  // `rolled` ({ itemId, tier, quality }) so doSalvageSalvagedMaterial below can narrate the
  // exact drop it produced. Same discriminated SalvageResult / reject convention.
  // salvageShip(state, shipId) is the THIRD salvage entry point: it breaks down a whole
  // HULL from the Docks for a fraction of its build cost. Its SUCCESS branch carries a
  // { next, recovered, creditsRecovered } shape (SalvageShipResult, credits are unique to
  // the ship path), reject is the same same-ref + reason convention. doSalvageShip below
  // reassigns state + logs the recovered materials, credits, and returned systems. It is
  // INSTANT this patch and slated to become a timed teardown later (see salvage.ts).
  import { salvageEquipment, salvageSalvagedMaterial, salvageShip, type SalvageRejectReason } from "./lib/game/salvage";
  import {
    tick,
    // Phase 2 (Task A3, docs/plans/phase2-tick-map.md): the shared per-span
    // economy body. The live poll loop below now calls THIS, the exact same
    // function tick()'s offline catch-up runs, instead of hand-mirroring the
    // per-captain mission / passiveTrickle / loot / resolveProcesses / credits /
    // applyFleetAdminXp math inline, which is precisely the surface that used to
    // drift between the two paths (ship stats, bonus-roll, credits, all logged).
    economyTick,
    tickCaptainMission,
    dispatchCaptainOnMission,
    recallCaptain,
    // Combat 0.13.0 (Phase 9b.5d): the patrol dispatch gate + action the new Combat
    // Patrols surface drives. canDispatchPatrol is the ONE source of truth for "can
    // this captain fly this patrol right now?" (the card consults it for the disabled
    // Dispatch button + the block-reason text); dispatchCaptainOnPatrol performs the
    // dispatch. PatrolDispatchBlockReason types the reason the block-reason helper maps
    // to player text (mirrors DispatchBlockReason for extraction missions).
    canDispatchPatrol,
    dispatchCaptainOnPatrol,
    type PatrolDispatchBlockReason,
    // "Every hull is combat-capable": freshState() seeds only the economy Standard-Issue
    // (model.ts cannot import the combat tables at runtime), so a brand-new game's starting
    // freighter is combat-BARE. This shared seeder installs every hull's Standard-Issue
    // combat set (now including the economy hulls' weak set), the SAME fold the save
    // migration + a fresh build use, so a new game's starter is dispatchable exactly like a
    // loaded/migrated save. Applied to freshState() at every new-game site via newGame() below.
    installMissingCombatBaselines,
    applyFleetAdminXp,
    // Ships, Stats Foundation (Task 11 UI), the remaining pure ship action
    // wired into the Sector Space > Starbase Docks panel below.
    // assignShipToCaptain(state, captainId, shipId) backs BOTH Docks pickers
    // (assign-parked-to-captain AND swap-captain-to-parked-ship both resolve to
    // this one call, see doAssignShip's header). Returns { next, success },
    // wired exactly like every other do* handler in this file.
    // (buyShip, the instant Requisition credit-buy, was RETIRED in S4.)
    assignShipToCaptain,
    // Facility Framework + Refinery (Phase 1, Task 12 UI), the pure backend fns
    // wired into the Foundry program below. refineSlotCount(state) => how many
    // parallel refine jobs the refinery can run right now (derived from its
    // upgrade level); canBuildFacilityUpgrade(state, facilityKey) is the PURE
    // readiness predicate ({ ok, reason? }) the Upgrades sub-tab reads for its
    // Build-button gate + red "missing" reason; startFacilityUpgrade(state,
    // facilityKey) starts the next upgrade, returning { next, started } (NOT
    // { next, success } like the other actions), see doStartFacilityUpgrade
    // below, which destructures `started`.
    // (startRefineJob, the one-shot manual refine start, was RETIRED in S4;
    //  the per-slot Production configurator drives refining now, via startLine.)
    refineSlotCount,
    canBuildFacilityUpgrade,
    startFacilityUpgrade,
    // Equipment 0.11.0 Phase D (2026-07-20): the Systems Bay "Upgrade Bay" seams.
    // canUpgradeEquipmentStorage(state) is the ONE gate ({ ok, reason? }) the button
    // reads for its enabled/blocked+reason state (next-rung cost / in-flight / maxed);
    // startEquipmentStorageUpgrade(state) starts the next rung, returning { next, started }
    // like startFacilityUpgrade, so doUpgradeEquipmentBay below destructures `started`.
    canUpgradeEquipmentStorage,
    startEquipmentStorageUpgrade,
    // Fleet Management (Docks Expansion): the Docks "Expand Docks" seams. canUpgradeDocks(state)
    // is the ONE gate ({ ok, reason? }) the button reads for its enabled/blocked+reason state
    // (next-rung cost / in-flight / maxed); startDocksExpansion(state) starts the next rung,
    // returning { next, started } like startEquipmentStorageUpgrade, so doExpandDocks below
    // destructures `started`.
    canUpgradeDocks,
    startDocksExpansion,
    // Crafting Allocation Redesign (Task C3/C4), the per-slot production LINE seams the
    // Refinery + Fabricator configurators wire up (replacing the retired standing-order
    // actions). startLine(state, kind, recipeKey, mode) appends a configured line (gated by
    // canStartLine, returns { next, started, reason? }); cancelLine(state, lineId) removes a
    // line and releases its unstarted reservation; canStartLine(state, kind, recipeKey, count)
    // is the ONE typed-reason gate each Start button reads for enabled/blocked state;
    // maxAffordableIterations(state, kind, recipeKey) is the affordable-now quantity cap the
    // amount field clamps to. All PURE except startLine/cancelLine which return new state.
    startLine,
    cancelLine,
    canStartLine,
    maxAffordableIterations,
    type StartLineBlockReason,
    // Phase 2 (Warehouse UI, Group C), the two PURE cap-reader fns the
    // Warehouse fill-tiles + Overview read. tierCap(state, tier) => the CURRENT
    // per-item storage cap for a warehouse tier (derived from its facility
    // level); materialAtCap(state, itemId) => whether an item's stock has
    // reached that cap (the auto-stop "full/expand-me" signal). Both are the
    // SAME fns the backend auto-stop uses, so the UI's "full" can never drift
    // from what actually idles a producer.
    tierCap,
    materialAtCap,
    buyCaptainTalent,
    buyHomeworldTalent,
    respecCaptainTalents,
    respecHomeworldTalents,
    chooseCaptainSpec,
    // Combat 0.13.0, Phase 1, Task 1.6: the pure captain-rename seam. Same
    // { next, success, reason? } contract as the other tick.ts action fns above
    // (chooseCaptainSpec / assignShipToCaptain), so the Rename UI applies the
    // identical reassign-state + pushLog + doSave pattern on success and reads
    // the returned validation reason on failure. renameCaptain owns the actual
    // validation (it calls validateCaptainName internally), the UI never
    // duplicates it, it only maps the reason to a human message.
    renameCaptain,
    // Renamable Ships: the pure ship-rename seam. UNLIKE renameCaptain it returns a
    // PLAIN GameState (a ship name is a cosmetic label with no gameplay effect, so
    // the caller needs only the resulting state). It trims the input, CLEARS the
    // name on an empty/whitespace request, and silently no-ops (same state ref) on a
    // rejected name. doRenameShip below applies the reassign-state + pushLog + doSave
    // pattern, diffing the ship's display name before/after to log what happened.
    renameShip,
    RESPEC_COST_CREDITS,
    // captainCommonYieldMult / captainUncommonYieldMult / fleetRareYieldMult were
    // removed here (2026-07-15): their ONLY consumer was the captain popup's
    // per-tier drop-rate TEXT rows, which the drops icon row replaced. The live
    // economy computes those yield mults internally inside economyTick, so nothing
    // in App.svelte references them anymore.
    captainUncommonChanceMult,
    captainRareChanceMult,
    captainBonusRollChance,
    captainBonusRollChanceMult,
    captainSpecBonusRollChance, // added so the live tick loop below can build the same 8-field `bonuses` object tick() does, enables the resourcefulness spec bonus-roll during LIVE play, not just offline catch-up
    xpPerTick, // Mission Rework (Task 2): the SHARED per-tick XP RATE helper, consumed by the Operations mission cards to show each mission's exp/tick (captain-independent today, so the fleet's representative captain is passed)
    // Mission Rework (Task 8 UI): the consolidated dispatch gate + the mission-
    // unlock/fuel-cap/buy-fuel backend seams the Operations dispatch + the two new
    // Facilities panels wire up. canDispatch(state, captainId, missionKey) is the
    // ONE source of truth for the Dispatch button's enabled/blocked+reason state;
    // missionUnlocked gates which missions the Operations list shows as available vs
    // locked, and drives Mission Control's Overview; fuelCap(state) is the live tank
    // cap the Fuel Storage gauge reads; buyFuel(state, units) backs its +10/+100/Fill
    // buttons. All PURE (canDispatch/missionUnlocked/fuelCap) except buyFuel, which
    // returns a new state (same-ref no-op convention on a failed/zero buy).
    canDispatch,
    missionUnlocked,
    fuelCap,
    buyFuel,
    // Fuel Economy v2 (F4 UI): the three Fuel Depot pipeline derivations (all PURE,
    // derive-on-read from the fuelStorage upgrade track). The fuel chip's PRODUCTION
    // rate = fuelPipelineCount * fuelBatchOutput / FUEL_REFINE_DURATION_TICKS, and its
    // ice-cost line = fuelPipelineCount * fuelBatchInput / FUEL_REFINE_DURATION_TICKS.
    // Reading the SAME helpers the tick engine uses keeps the readout drift-proof.
    fuelPipelineCount,
    fuelBatchOutput,
    fuelBatchInput,
    // Fuel net-display fix (2026-07-16): the PURE, read-only fuel-economy summary.
    // Mirrors processFuelPipelines' ice/tank/pipeline gates so the DISPLAYED net
    // matches what the refinery actually does, effectiveProductionPerTick is 0
    // when out of Deuterium Ice (fixing the "net positive while out of ice" bug).
    // The per-tick mission-burn sum (formerly computed inline in the fuel reactive
    // block below) now lives inside this helper: ONE source of truth in the engine.
    fuelFlowSummary,
    // Fuel-runway readout (Wave 2), PURE two-phase "ticks until fuel-empty"
    // projection over the live-measured net fuel & ice rates (see the EMA in the
    // poll loop). Full-sustainability model: credits mission-mined Deuterium Ice.
    fuelRunwayProjection,
    // Research (Task R5 UI), the three PURE research seams the Research Lab panel
    // wires up. researchSlotCount(state) => how many parallel research projects the
    // lab can run right now (derived from its upgrade level, parallels refineSlotCount);
    // canResearch(state, key) is the ONE consolidated gate ({ ok } | { ok, reason }) the
    // Research button reads for its enabled/blocked+reason state; startResearch(state, key)
    // starts one project (deduct-at-start credits + a timed unlock process). startResearch
    // returns { next, started, reason? }, doStartResearch below destructures `started`
    // and bails on a same-ref no-op, exactly like doStartFacilityUpgrade/doStartRefineJob.
    researchSlotCount,
    canResearch,
    startResearch,
    type ResearchBlockReason,
    // Fabricator (Phase 4, Task F4 UI), fabricateSlotCount(state) => how many parallel
    // fabricate jobs the fabricator can run right now (derived from its upgrade level,
    // parallels researchSlotCount/refineSlotCount, and the number of Fabricator production-
    // line slots). The standing fabricate-order seams (startFabricateOrder/stopFabricateOrder)
    // AND canFabricate/FabricateBlockReason were RETIRED from the UI in C4, the Craft tab now
    // uses the shared startLine/canStartLine + startLineBlockText seams above.
    fabricateSlotCount,
    // Shipyard (Phase 5, Task S5 UI), the three PURE ship-build seams the Shipyard
    // Build panel wires up. canBuildShip(state, typeKey) is the ONE consolidated gate
    // ({ ok } | { ok, reason }) each hull's Build button reads for its enabled/blocked+
    // reason state; startShipBuild(state, typeKey) starts ONE build (deduct-at-start
    // BOM + credits + a timed shipBuild process), returning { next, started, reason? }
    //, doStartShipBuild below destructures `started` and bails on a same-ref no-op,
    // exactly like doStartFacilityUpgrade/doStartResearch. shipBuildDurationTicks(state,
    // typeKey) is the effective (build-speed-adjusted) build time the hull card's ⏱
    // readout formats. ShipBuildBlockReason types the reason→text map. All read the SAME
    // tick.ts fns + model.ts tables the engine enforces, so the panel can't drift.
    canBuildShip,
    startShipBuild,
    shipBuildDurationTicks,
    type ShipBuildBlockReason,
    type DispatchBlockReason,
    foldLifetimeStatsDelta, // Task 7 (Progression Pacing Rework): the shared per-captain lifetimeStats fold, called by BOTH tick() and this live loop so live play accrues lifetime stats identically to offline catch-up
    addToInventory, // Phase 1 Task 5: the shared inventory add seam, called by BOTH tick() and this live loop so live loot delivery writes inventory/discovered byte-identically to offline catch-up (drift-proof)
    resolveProcesses, // Phase 1 Task 9: the SINGLE timed-process completion resolver, called by BOTH tick() and this live loop with the SAME ticksElapsed so process completion + lump FA XP resolve identically live and offline (drift-proof)
    processShipRepairs, // Combat 1.0 (QA #3): the auto-repair pass. The Ship Systems panel's manual "Repair now" trigger runs THIS immediately (via repairShipNow) so a damaged hull can claim a free Shipyard bay without waiting a tick; a safe no-op when every bay is busy.
    LOOT_MATERIAL_KEYS,
    describeCaptainTalentEffect,
    describeHomeworldTalentEffect,
  } from "./lib/game/tick";
  // Mission Rework (Task 8 UI): the PURE fuel-cost math. fuelNeeded(mission, shipDef)
  // returns the round-trip fuel a hull burns for a mission, shown per mission on the
  // Operations dispatch surface (list card = representative captain's hull; popup =
  // the SELECTED captain's hull, the authoritative dispatching cost). Imported from
  // fuel.ts directly (its own module; tick.ts does not re-export it).
  // fuelNeeded prices an extraction round trip; fuelForRoundTrip (Combat 0.13.0,
  // Phase 9b.5d) prices a PATROL round trip from its two transit legs + the flying
  // hull's engine efficiency, the SAME figure canDispatchPatrol / dispatchCaptainOnPatrol
  // spend, so the patrol card's "fuel per run" can never mislead about the real cost.
  import { fuelNeeded, fuelForRoundTrip } from "./lib/game/fuel";
  // Combat 0.13.0, Phase 1, Task 1.6: MAX_CAPTAIN_NAME backs the Rename input's
  // maxlength attribute (the input can't exceed the same ceiling renameCaptain
  // enforces) and the "Max N characters" error copy. Imported from captainName.ts
  // directly (its own module; tick.ts does not re-export it, the same as fuelNeeded
  // above). validateCaptainName is NOT imported here on purpose: renameCaptain
  // already runs it and returns the reason, so the UI never re-validates.
  import { MAX_CAPTAIN_NAME } from "./lib/game/captainName";
  // Crafting Allocation Redesign (Task C1/C4), the DERIVED material-allocation helpers the
  // per-line configurator's REQUIRES preview reads: lineInputsPerIteration(line) => a recipe's
  // per-iteration input map (for the "per/ea" column); allocatedItem(lines, item) => units
  // reserved by all active lines; freeItem(inventory, lines, item) => usable stock (inventory −
  // allocated, clamped ≥ 0). CraftLine/CraftLineMode/CraftLineKind type the line arrays + the
  // batch|continuous run-mode the configurator builds for startLine.
  import {
    lineInputsPerIteration,
    allocatedItem,
    freeItem,
    // Shipyard (Task S5 UI): the reservation-aware FREE-stock reader for the hull-card
    // REQUIRES box. freeItemForState(state, itemId) = inventory MINUS what active craft
    // lines reserve, the SAME pool canBuildShip gates a build's BOM against, so the "free
    // {n}" the card shows (red when free < need) matches exactly what the build can spend.
    freeItemForState,
    type CraftLine,
    type CraftLineMode,
    type CraftLineKind,
  } from "./lib/game/allocation";
  // Quality-bucketed inventory helpers (Equipment 0.11.0, Task 9a): itemTotal(inv, item)
  // reads an item's on-hand TOTAL across its quality buckets (absent -> 0), the bucketed
  // twin of the old scalar `inventory[item] ?? new Decimal(0)`. addItemQuality deposits
  // into a quality bucket (dev-grant handler uses quality 0). See src/lib/game/inventory.ts.
  import { itemTotal, addItemQuality, QUALITY_TIERS } from "./lib/game/inventory";
  import { summarizeOfflineProgress, type OfflineSummary } from "./lib/game/offlineSummary";
  import { formatNumber, formatDuration, formatClock } from "./lib/game/format";
  import { deriveStatistics } from "./lib/game/statistics";
  import { saveToLocalStorage, loadFromLocalStorage, clearSave, downloadRawSave, importRawSave, hasRawSave, exportRawSave } from "./lib/game/save";
  import { loadTheme, saveTheme, THEME_NAMES, THEME_PREVIEW_COLORS, type ThemeName } from "./lib/theme";
  import { loadTickBarEnabled, saveTickBarEnabled } from "./lib/tickBarPreference";
  import { loadShowTickCounts, saveShowTickCounts } from "./lib/tickReadoutPreference";
  import { loadRefineConfirmEnabled, saveRefineConfirmEnabled } from "./lib/refineConfirmPreference";
  import {
    loadSalvageConfirmQualities,
    saveSalvageConfirmQualities,
    salvageNeedsConfirm,
  } from "./lib/salvageConfirmPreference";
  // Combat-log DISPLAY preferences (Combat 0.13.0). localStorage-backed, surfaced in
  // the Options settings as the first section of a growing accessibility/theming hub.
  import {
    loadCombatLogStyle,
    saveCombatLogStyle,
    loadCombatDamageColors,
    saveCombatDamageColors,
    loadCombatLogSpeed,
    saveCombatLogSpeed,
    loadCombatAutoScroll,
    saveCombatAutoScroll,
    type CombatLogStyle,
    type CombatLogSpeed,
  } from "./lib/combatLogPreference";
  import { focusTrap } from "./lib/focusTrap";

  // DEV_MODE, Vercel §9.5.3: true on Preview, false on Production. Locally,
  // set VITE_DEV_MODE=true in .env.local (see .env.example).
  const DEV_MODE_ENV = import.meta.env.VITE_DEV_MODE === "true";

  // The Debug tab + [DEV] grant controls gate on build-time DEV_MODE only, so
  // they show on preview/local dev builds but NEVER on production.
  //
  // DEV_MODE is true when EITHER:
  //   - VITE_DEV_MODE=true (local .env.local, per the note above), OR
  //   - __IS_PREVIEW_BUILD__, injected by vite.config.ts from Vercel's build-time
  //     VERCEL_ENV, true ONLY on Preview deployments. This auto-enables the dev
  //     panel on every preview deploy (e.g. devpreview.crystalisoft.com) with NO
  //     Vercel-dashboard env config, and stays HARD-OFF on the Production build
  //     (VERCEL_ENV==='production' => __IS_PREVIEW_BUILD__ false) no matter which
  //     URL serves it. This is the security boundary (Omega 6): the [DEV] grants
  //    , free FA levels / admin / stat points / CREDITS, must never be reachable
  //     by real players, especially once leaderboards/multiplayer exist.
  //
  // A `?dev` URL bypass was added during Progression-Pacing-Rework device testing,
  // then REMOVED before merging to main (2026-07-11, user decision) so production
  // ships NO self-serve cheat surface. Not reinstated: the preview-build signal
  // above replaces the need for it without exposing anything on production.
  const DEV_MODE = DEV_MODE_ENV || __IS_PREVIEW_BUILD__;

  // Player-facing app version + patch notes moved to ./lib/patchNotes.ts
  // (2026-07-15) so the public Landing page can share the same source of
  // truth. Imported at the top of this <script>; used unchanged by the About
  // sub-tab (APP_VERSION) and the Patch Notes sub-tab (PATCH_NOTES) below.

  // Public Discord invite for the community. Kept as a named constant here so the
  // Community sub-tab (Task 4, 0.11.2) has a single, obvious source. Landing.svelte
  // currently hardcodes the same invite inline (its link chip); this task does not
  // refactor Landing, so the two references are intentionally kept in sync by hand.
  const DISCORD_INVITE_URL = "https://discord.gg/rcY7uqchTC";

  // Display-only phase labels for the MISSIONS panel's phase readout. Purely
  // a UI concern, nothing outside this file needs to map a MissionPhase to
  // display text, so it lives here rather than in model.ts. Must stay in
  // sync with MissionPhase's literal union, a new phase added there
  // without a matching entry here would silently render "undefined" instead
  // of a label.
  const MISSION_PHASE_LABEL: Record<MissionPhase, string> = {
    ordersReceived: "Orders Received",
    transitOut: "Transiting Out",
    extracting: "Extracting",
    transitBack: "Transiting Back",
    unloading: "Unloading",
  };

  // Combat 0.13.0 (Phase 9b.5d): display-only labels for a patrol's PatrolPhase, the
  // patrol counterpart to MISSION_PHASE_LABEL. Same UI-only rationale (nothing outside
  // this file maps a phase to text) and the same "keep in sync with the literal union"
  // caveat: a new PatrolPhase added in model.ts without an entry here would render
  // "undefined". "limpingHome" is the DEFEAT state (the ship lost and is limping its
  // wreck home to repair), phrased as a plain player-facing label.
  const PATROL_PHASE_LABEL: Record<PatrolPhase, string> = {
    transitOut: "Transiting Out",
    engaging: "Engaging",
    transitBack: "Returning",
    limpingHome: "Limping Home",
  };

  // Radial Skill Web (Task 11b) removed the depth-row talent rendering that
  // lived here: the CAPTAIN_TALENT_BRANCH_LABEL map (keyed on the removed
  // command/diplomacy branches), the talentDepth helper (walked the removed
  // `.requires` chains), and the TALENT_ROW_HEIGHT layout constant are all
  // gone. RadialWeb.svelte now owns talent layout/labels/positioning; nothing
  // in App.svelte needs branch-depth math anymore.

  // "Every hull is combat-capable": seed the starting freighter's weak Standard-Issue
  // combat set so a brand-new game's hull is dispatchable (freshState alone leaves it
  // combat-bare; see the installMissingCombatBaselines import note above).
  let state: GameState = installMissingCombatBaselines(freshState());
  let createdAt = Date.now();
  let currentTheme: ThemeName = "cyan";
  let tickBarEnabled = true;
  // Whether the raw tick numbers are shown next to the human-readable clock
  // timers on every "N remaining" / "Duration" readout. Persisted in
  // localStorage (loadShowTickCounts), NOT on GameState, exactly like
  // tickBarEnabled above, so it survives a delete-save and needs no save
  // migration. Loaded in onMount alongside tickBarEnabled; default FALSE
  // (players see just the clock; tick counts are an opt-in power-user detail).
  let showTickCounts = false;
  // Phase 2 (Task D3): whether the "are you sure you wish to refine this item?"
  // confirmation modal is shown before starting a refine order. Persisted in
  // localStorage (loadRefineConfirmEnabled), NOT on GameState, exactly like
  // tickBarEnabled above, so it survives a delete-save and needs no save
  // migration. Loaded in onMount alongside tickBarEnabled; default TRUE.
  let refineConfirmEnabled = true;
  // Combat-log DISPLAY preferences (Combat 0.13.0). localStorage-backed (NOT on
  // GameState), loaded at declaration like salvageConfirmQualities below, so they
  // survive a delete-save and need no save migration. The combat view reads the same
  // saved values when it opens; these mirrors drive the Options controls' active state.
  let combatLogStyle: CombatLogStyle = loadCombatLogStyle();
  let combatDamageColors = loadCombatDamageColors();
  let combatLogSpeed: CombatLogSpeed = loadCombatLogSpeed();
  let combatAutoScroll = loadCombatAutoScroll();
  let deleteModalOpen = false;
  let deleteConfirmText = "";

  // Homeworld Talents "Reset" confirmation modal (Task 13), same
  // "state near deleteModalOpen, markup near the delete modal" pattern as
  // deleteModalOpen/deleteConfirmText above. Fleet-wide, no per-captain
  // scoping (mirrors respecHomeworldTalents itself, which takes no
  // captainId). No typed-confirmation-word gate here (unlike Delete
  // Save), the cost + irreversibility warning text inside the modal is
  // the friction, same level as the Import Save modal's plain Cancel/
  // Import pair.
  let homeworldRespecModalOpen = false;

  // Captain Talents "Reset" confirmation modal (Task 13), per-captain,
  // scoped to activeCaptain (mirrors respecCaptainTalents, which takes a
  // captainId). Task 14 (Radial Skill Web) removed the old selectedSpecInModal
  // "keep the current spec" state entirely: Reset now always CLEARS the spec to
  // null (Confirm passes an explicit `null` to respecCaptainTalents), so the
  // TreeSelector reappears afterward for a free re-pick. There is no in-modal
  // spec chooser to hold a pending selection anymore, so no such variable is
  // needed.
  let captainRespecModalOpen = false;

  // Import Save modal (Task 7, Loot Tier Rework, see
  // docs/plans/2026-07-07-loot-tier-rework-plan.md), same
  // "state near deleteModalOpen, markup near the delete modal" pattern as
  // that existing flow. pendingImportRaw holds the SELECTED file's raw text
  // (already read off disk by the time the modal opens) so confirmImport has
  // no async work left to do, only the file input's on:change handler
  // touches the filesystem/File API. importError surfaces a rejected
  // (corrupt/non-save) file inline in the modal without closing it, so the
  // user can immediately try a different file.
  let importModalOpen = false;
  let pendingImportRaw: string | null = null;
  let importError: string | null = null;

  // Corrupt-save recovery modal (P4). Reached ONLY when loadFromLocalStorage()
  // returned null AND hasRawSave() is true: a save raw exists on disk but could
  // not be deserialized. Rather than silently starting a fresh game (which the
  // next autosave would then write OVER the unloadable raw, destroying the only
  // recovery material), we suppress autosave, stash the raw text here, and show
  // this modal so the player can copy/download their backup BEFORE deciding to
  // start fresh. Same "state near deleteModalOpen, markup near the modal" pattern
  // as the flows above. corruptRawSave holds the raw string for the readonly
  // textarea; it stays put until the player explicitly resolves the modal.
  let saveCorruptModalOpen = false;
  let corruptRawSave = "";

  // While-You-Were-Away offline summary (Combat 0.13.0, Phase 13, design Section 17).
  // A PLAIN let (never a reactive `$:`), set imperatively ONCE in onMount on the
  // successful-load + offline-advanced path. Holds the pure before/after diff of the
  // pre-tick and post-tick GameState snapshots (see offlineSummary.ts); null keeps the
  // modal closed. It is set exactly once at load and only cleared by the Continue
  // button, so it never re-triggers a render off `state` (no side-effecting reactive).
  let offlineSummary: OfflineSummary | null = null;
  // The smallest absence (in real seconds) that is worth interrupting the player with a
  // modal. Below this the welcome-back LOG line still fires, but a full modal for a few
  // seconds/minutes of drift would be noise. One minute is the floor (design Section 17
  // is results-only; this is a UX gate, not a sim value).
  const OFFLINE_SUMMARY_MIN_SECONDS = 60;

  // Fleet Operations captain-selection popup (2026-07-07 Fleet Operations
  // Mission UI), null missionPopupKey means the popup is closed. Selecting a
  // mission card opens it with no captain chosen yet (missionPopupCaptainId
  // null); picking a captain inside the popup recalculates the preview stats
  // but does NOT dispatch, only the Dispatch button does that.
  let missionPopupKey: MissionKey | null = null;
  let missionPopupCaptainId: number | null = null;

  // Combat 0.13.0 (Phase 9b.5d, Combat Patrols dispatch UI) state. The dispatch
  // surface mirrors the extraction flow's split: the per-patrol CARD holds the
  // player's inline choices (which captain, which stance, once vs repeatedly), and a
  // REUSED captain-picker MODAL (the same .modal-captain-list idiom the mission popup
  // uses) sets the chosen captain. All three choices are keyed by PatrolKey so each
  // patrol card keeps its own selection independently (there is one patrol today, but
  // this stays correct the day a second patrol is authored, rather than sharing one
  // captain/stance across cards). Absent-is-default: a key with no entry reads as no
  // captain selected / stance "balanced" / dispatch-once, resolved by the accessor
  // helpers below. patrolPickerKey is the PatrolKey whose captain-picker modal is
  // open (null = closed), mirroring missionPopupKey.
  let patrolCaptainByKey: Partial<Record<PatrolKey, number>> = {};
  let patrolStanceByKey: Partial<Record<PatrolKey, CombatStance>> = {};
  let patrolRepeatByKey: Partial<Record<PatrolKey, boolean>> = {};
  let patrolPickerKey: PatrolKey | null = null;

  // Radial Skill Web (Task 11b), the old shared talent-tooltip mechanism
  // (openTooltipKey + the talentTooltipInfo lookup + the activeTooltipInfo
  // reactive) was removed here. It resolved a talent key into tooltip content
  // by reading each def's now-removed `.requires` field, so it no longer
  // compiles. RadialWeb.svelte now owns the talent tooltip (and its Learn
  // button) internally, so App.svelte no longer tracks an open talent node or
  // renders a talent tooltip overlay at all. (The DELETE SAVE / respec / Import
  // modals still use .modal-backdrop and are untouched; the orphaned
  // .tooltip-backdrop / .talent-tooltip CSS was removed in Task 17.)
  let speed = 1;
  let logEntries: string[] = [];
  let activeCaptainIndex = 0;
  let paused = false;

  // Outer bottom nav (Task 1, Phase 4; split from 5 to 6 tabs in the UI
  // Redesign, Task 7, see docs/plans/2026-07-07-ui-redesign-plan.md), no
  // router library (see design doc: single-page idle game, no deep-linking/
  // history need). Default lands on Fleet Captain's since captains/missions
  // are the core loop today.
  // 0.11.2 nav restructure: the old catch-all "facilities" tab was split into
  // function-named programs. Every facility it held moved to its own top-level
  // tab (Refinery/Fabricator/Research Lab/Fuel Depot to Foundry; Shipyard to
  // Drydock; Warehouse to Stores; Mission Control to Operations), and the emptied
  // Facilities tab was then removed (Task 7). The union below is the resulting
  // program set (see the .nav-tabs row for their left-to-right order).
  type TabKey = "home" | "personnel" | "facilities" | "logistics" | "fleetOperations";
  let activeTab: TabKey = "home";

  // Home program (0.11.2 Shell Correction, Task 1): the landing program, first
  // on the bottom nav. 0.12.0 "Console" nav (Home is the PATTERN-SETTER for the
  // whole redesign, REVISED per user 2026-07-21): the old left rail is GONE. Home
  // presents a horizontally-SCROLLING top-tab row; selecting a tab shows its page
  // IN PLACE directly below the row, and the selected tab GLOWS to mark where you
  // are. There is no Back control, you move by tapping another tab. activeHomeTab
  // drives the swap. This scrolling-tabs + glow + page-below idiom is the copyable
  // template every other perspective (Personnel / Facilities / Logistics /
  // Operations) reuses, so keep it clean: one "active tab" state per perspective,
  // a .console-tabs row, one content branch per tab. The reserved meta tabs
  // (Achievements / Completion / Leaderboards) stay honest "coming soon" locked
  // affordances, same crimson locked idiom the System / Battlespace slots use.
  let activeHomeTab: "overview" | "help" | "statistics" = "overview";

  // Help program (0.11.2 UI Restructure, Task 14): a left rail of topic titles
  // (.captain-list, reused verbatim) + a content pane showing the selected
  // topic. activeHelpTopic is a topic id from HELP_TOPICS (helpTopics.ts),
  // defaulting to the first (missions), same rail-selection idiom as the System
  // program's activeSystemSubTab.
  let activeHelpTopic: string = "missions";

  // Home > Statistics (0.12.0 Console): the three stat groups (Lifetime / Career /
  // Fleet) render as stacked, always-visible sections rather than inner sub-tabs,
  // so there is no third tab layer under the console tabs. The old activeStatsSubTab
  // was retired with that flatten (2026-07-21). Rows still come from
  // deriveStatistics(state), a pure read over existing save fields.

  // Personnel program (0.12.0 "Console" nav, Phase 1, see
  // docs/plans/2026-07-21-console-nav-0.12.0-design.md + -plan.md). Replaces the
  // old "Crew" tab (fleetCaptains + its Overview/Talents SubTabs). The perspective
  // is "through a PERSON": the Fleet Admiral and the Captains. A slim TOP rail
  // (the shared <ConsoleTabs> primitive, same idiom Home uses) splits it into:
  //   - "admiral"  , the Fleet Admiral (overview + the FA prestige tree). STUB
  //                  this task, built out in a follow-up (CN2b); shows a
  //                  placeholder Panel only.
  //   - "roster"   , the Captain Roster. Built out now.
  // Defaults to "roster" so Personnel opens on the captains (the FA view is the
  // stub for now, so landing there would show nothing useful).
  let activePersonnelTab: "admiral" | "roster" = "roster";

  // Captain Roster inner view (0.12.0 Console, Phase 1). The roster is NOT a
  // nested tab row (that would re-introduce the tab depth the console redesign
  // removes, see the FLATTEN principle on Home Statistics). Instead it is a
  // single console page that swaps IN PLACE between two views, the same
  // overview-then-summoned-content model the console uses everywhere:
  //   - "grid"     , the roster grid of captain cards (the landing view).
  //   - "captain"  , the selected captain's flat console (identity + leveling +
  //                  actions + talents), reached by tapping a card and left via a
  //                  "Captains" back control. The selected captain is the existing
  //                  activeCaptainIndex / activeCaptain (unchanged), so every
  //                  per-captain read/write below keeps working verbatim; this
  //                  flag only decides grid-vs-detail, not WHICH captain.
  // Defaults to "grid" so Personnel > Captain Roster lands on the grid.
  let personnelRosterView: "grid" | "captain" = "grid";

  // Captain Talents modal (0.12.0 Console, Phase 1 follow-up). The captain's
  // talent tree no longer renders inline on the captain page; a "Talents" button
  // in CAPTAIN ACTIONS opens it in its OWN modal, built on the SAME shared modal
  // idiom the System (gear-portrait) modal uses (.modal-backdrop + focusTrap +
  // .system-modal-dialog/header/body, Escape + ✕ + backdrop-click close, opaque
  // surface since Brave has no backdrop-filter). This frees the captain page for
  // leveling + actions. captainTalentsModalOpen gates it; it is scoped to the
  // currently-selected activeCaptain (the modal only renders on the captain view,
  // so activeCaptain is always defined while it is open). onCaptainTalentsBackdropClick
  // mirrors onSystemBackdropClick (close only when the click hit the backdrop
  // itself, not a bubble from the dialog surface).
  let captainTalentsModalOpen = false;
  function onCaptainTalentsBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      captainTalentsModalOpen = false;
    }
  }

  // Captain Rename modal (Combat 0.13.0, Phase 1, Task 1.6). The "Rename" button
  // in CAPTAIN ACTIONS opens this small text-input modal, built on the SAME
  // Panel.modal-dialog + .modal-input + .modal-row + focusTrap idiom the DELETE
  // SAVE modal below uses (Escape / Cancel close, one shared modal visual
  // language). Like the captain-talents modal above it is scoped to the
  // currently-selected activeCaptain: the captain page (and this modal) only
  // render while activeCaptain is defined, so activeCaptain is always the target.
  //   - captainRenameModalOpen gates the modal.
  //   - captainRenameInput is the in-progress name, two-way bound to the input;
  //     openCaptainRenameModal seeds it with the captain's CURRENT label so the
  //     player edits from the existing name rather than a blank field.
  //   - captainRenameError holds the inline validation message, empty until a Save
  //     fails, so nothing shows on first open.
  // Naming has NO mission lock (a captain can be renamed idle or on a mission), so
  // this action is ungated, unlike Assign Ship which is disabled while out.
  let captainRenameModalOpen = false;
  let captainRenameInput = "";
  let captainRenameError = "";
  function openCaptainRenameModal(): void {
    captainRenameInput = activeCaptain.label;
    captainRenameError = "";
    captainRenameModalOpen = true;
  }
  function cancelCaptainRename(): void {
    captainRenameModalOpen = false;
    captainRenameInput = "";
    captainRenameError = "";
  }
  // Maps a failed-rename reason (forwarded from renameCaptain -> validateCaptainName)
  // to the short human message shown inline under the input. notFound cannot happen
  // from this UI (activeCaptain is always a live captain), but it is handled by the
  // default so the message is never blank on an unexpected reason.
  function captainRenameReasonMessage(
    reason: "notFound" | "empty" | "tooLong" | "charset" | "noAlphanumeric" | "profanity" | undefined,
  ): string {
    switch (reason) {
      case "empty":
        return "Name cannot be empty";
      case "tooLong":
        return `Max ${MAX_CAPTAIN_NAME} characters`;
      case "charset":
        return "Letters, numbers, spaces, and . ' - _ only";
      case "noAlphanumeric":
        return "Name needs at least one letter or number";
      case "profanity":
        return "Please choose a different name";
      default:
        return "That name can't be used";
    }
  }
  // Save handler: routes the input through the pure renameCaptain seam and applies
  // the SAME { next, success } reassign-state + pushLog + doSave pattern every
  // other do* handler uses (see chooseSpec / doAssignShip). On failure it keeps the
  // modal open and shows the mapped reason; on success it swaps in `next`, logs the
  // old -> new name (old label captured before the swap; new label read back from
  // `next`, the source of truth, since renameCaptain stores the cleaned/trimmed
  // name), closes the modal, and saves.
  function doRenameCaptain(): void {
    const captain = activeCaptain;
    const previousLabel = captain.label;
    const { next, success, reason } = renameCaptain(state, captain.id, captainRenameInput);
    if (!success) {
      captainRenameError = captainRenameReasonMessage(reason);
      return;
    }
    state = next;
    const newLabel = next.captains.find((c) => c.id === captain.id)?.label ?? captainRenameInput;
    pushLog(`[${previousLabel}] Renamed to: ${newLabel}.`);
    cancelCaptainRename();
    doSave();
  }

  // Admiral Prestige modal (0.12.0 Console, Phase 1 / CN2b). The Fleet Admiral
  // prestige tree (the old Homeworld ADMINISTRATION RadialWeb) no longer has its
  // own tab; the Personnel > Admiral page's "Prestige" button opens it HERE, in
  // the EXACT same modal idiom as the captain-talents modal above (.modal-backdrop
  // + focusTrap + .system-modal-dialog/header/body, Escape + ✕ + backdrop-click
  // close, opaque surface for Brave). admiralPrestigeModalOpen gates it; it reads
  // fleet-wide state (state.adminPoints / state.unlockedHomeworldTalents), so no
  // per-captain scoping is involved. onAdmiralPrestigeBackdropClick mirrors the
  // captain-modal + System-modal backdrop handlers (close only on a click that
  // landed on the backdrop itself, not one bubbling up from the dialog surface).
  let admiralPrestigeModalOpen = false;
  function onAdmiralPrestigeBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      admiralPrestigeModalOpen = false;
    }
  }

  // (0.12.0 Console, CN4b: the StarbaseSubTab / activeStarbaseSubTab state was
  //  RETIRED with the Docks fold. The Docks was a single-tab SubTabs strip, and
  //  the Docks facility now shows only its storage/expansion surface directly, so
  //  there is no sub-tab left to track.)

  // Foundry program rail state (0.11.2 nav restructure, Task 1).
  // The FOUNDRY program (Refinery/Fabricator/Research Lab/Fuel Depot) uses
  // its OWN dedicated rail-selection state. A dedicated key union
  // (the four moved facilities only) keeps invalid selections unrepresentable.
  // 0.12.0 "Console" nav (Logistics, CN3a): the WAREHOUSE joins this rail. The
  // Warehouse is a BUILDING the player manages (its storage state + per-tier
  // storage-expansion), so under the perspective model its management belongs to
  // Facilities, NOT to Logistics (which is the ITEM perspective, the material
  // CATALOG). Facilities is not converted yet, so the Warehouse's transitional
  // home is the Foundry tab (which becomes Facilities later). Only the warehouse-
  // as-building views (Overview + Upgrade) live here; the material catalog itself
  // moved to Logistics > Materials. This keeps the ONLY material-storage-expansion
  // UI reachable through the transition.
  // 0.12.0 Console (Facilities, CN4b): the Shipyard + Docks fold in here from the
  // retired Drydock tab. Both are BUILDINGS the player manages, so they belong to
  // the Facilities (building) perspective. "shipyard" = the hull-build facility
  // (moved verbatim); "docks" = ship-STORAGE management only (berth capacity +
  // expansion; per-hull list/assign/salvage live in Logistics > Ships).
  type FoundryFacilityKey = "refinery" | "fabricator" | "research" | "fuelStorage" | "warehouse" | "salvageBay" | "shipyard" | "docks";
  // 0.12.0 "Console" nav (Facilities, CN4a): the LEFT RAIL that this key used to
  // drive is RETIRED. Facilities is the BUILDING perspective and now lands on a
  // DASHBOARD (a responsive grid of building cards, the SAME .roster-grid model
  // the Personnel Captain Roster + Logistics Ships console use). facilitiesView
  // is the grid-vs-console swap ("dashboard" = the card grid landing; "console" =
  // one building's console, its existing content rendered VERBATIM below a
  // back-to-dashboard control). activeFoundryFacility is REPURPOSED, unchanged
  // name to avoid churn across its 20+ content-branch guards, as WHICH building's
  // console is open; it is only meaningful while facilitiesView === "console".
  // Tapping a dashboard card sets BOTH (activeFoundryFacility = the card's key,
  // facilitiesView = "console"); the back control returns to "dashboard". This
  // mirrors logisticsShipsView/selectedShipId and personnelRosterView/activeCaptainIndex.
  let activeFoundryFacility: FoundryFacilityKey = "refinery";
  let facilitiesView: "dashboard" | "console" = "dashboard";
  // Display labels for the six building cards + the console back-row heading.
  // One source of truth so a card and its console name the building identically.
  const FACILITY_LABELS: Record<FoundryFacilityKey, string> = {
    refinery: "Refinery",
    fabricator: "Fabricator",
    research: "Research Lab",
    fuelStorage: "Fuel Depot",
    warehouse: "Warehouse",
    salvageBay: "Salvage Bay",
    shipyard: "Shipyard",
    docks: "Docks",
  };

  // (0.12.0 Console, CN4b: the DRYDOCK program is RETIRED. Its two facilities
  //  folded into the Facilities console, Shipyard and Docks are now cards on the
  //  Facilities dashboard (activeFoundryFacility === "shipyard" / "docks"), so the
  //  DrydockSection / activeDrydockSection rail state is gone. The Shipyard content
  //  still uses ShipyardSubTab / activeShipyardSubTab, which stay declared below.)

  // Logistics program tab state (0.12.0 "Console" nav, Phase 3 / CN3a). Replaces
  // the old Stores program (the activeStoresFacility Warehouse | Salvage Bay left
  // rail, now RETIRED). Logistics is the ITEM perspective: everything at the item
  // scope. A slim TOP rail (the shared <ConsoleTabs> primitive, same idiom Home
  // and Personnel use) splits it into:
  //   - "ships"         , the ship console (paper-doll + installs), built out in
  //                       CN3b. Per-hull management (assign/swap/salvage) lives
  //                       here now; the Docks facility (Facilities) keeps only
  //                       ship-STORAGE capacity + expansion (CN4b).
  //   - "shipEquipment" , the spare Ship Systems bay (moved verbatim from the old
  //                       Warehouse Finished Goods > Ship Systems), + compact
  //                       locked markers for the reserved Weapons/Modules/Consumables.
  //   - "crewEquipment" , reserved/locked (crew equipment does not exist yet).
  //   - "materials"     , the material CATALOG (moved verbatim from the old
  //                       Warehouse Materials tab: themed sub-categories, tier
  //                       splits, masked undiscovered items). The DEFAULT (the
  //                       most-used view).
  // Salvaging is a FACILITY action (user decision 2026-07-21), so the Salvage Bay
  // is NOT a Logistics tab; it lives in the Foundry rail (activeFoundryFacility
  // === "salvageBay"), the same way the warehouse building-management does. The
  // material CATALOG's salvaged-material tiles stay here in Materials, browse-only.
  // Defaults to "materials" so Logistics opens on the most-used inventory view.
  let activeLogisticsTab: "ships" | "shipEquipment" | "crewEquipment" | "materials" = "materials";

  // Ships console inner view (0.12.0 Console, Phase 2 / CN3b). The Ships tab is NOT
  // a nested tab row (that would re-introduce the tab depth the console redesign
  // removes); it is a single console page that swaps IN PLACE between two views,
  // the SAME grid-then-detail model the Personnel Captain Roster uses:
  //   - "grid" , the fleet grid of ship cards (the landing view).
  //   - "ship" , the selected ship's flat page (identity + captain + status +
  //              actions), reached by tapping a card and left via a "Ships" back
  //              control. The selected ship is tracked by selectedShipId (the
  //              ship's stable id, the same key the equipment/salvage flows use),
  //              NOT an index, since ships can be salvaged out from under an index.
  // Defaults to "grid" so Logistics > Ships lands on the fleet grid. selectedShipId
  // is null while on the grid; a card tap sets it AND flips the view to "ship".
  let logisticsShipsView: "grid" | "ship" = "grid";
  let selectedShipId: string | null = null;

  // Vanished-hull guard. If the selected ship disappears while its page is open
  // (the player salvaged it, so it is no longer in state.ships), fall back to the
  // grid and clear the dangling id so the next card tap starts clean. This reads
  // ONLY plain lets (logisticsShipsView / selectedShipId / state.ships), never a
  // reactive derive of selectedShipId, so it introduces NO cyclical dependency
  // (the ship page looks the hull up inline via {@const}, not via a $: derive).
  $: if (
    logisticsShipsView === "ship" &&
    selectedShipId !== null &&
    !state.ships.some((s) => s.id === selectedShipId)
  ) {
    logisticsShipsView = "grid";
    selectedShipId = null;
  }

  // The Logistics top rail, in display order. Crew Equipment is a locked reserved
  // slot (same honest "coming soon" affordance the System / Battlespace slots use);
  // ConsoleTabs grays it and blocks selection.
  const LOGISTICS_TABS: { key: string; label: string; locked?: boolean }[] = [
    { key: "ships", label: "Ships" },
    { key: "shipEquipment", label: "Ship Equipment" },
    { key: "crewEquipment", label: "Crew Equipment", locked: true },
    { key: "materials", label: "Materials" },
  ];

  // Operations program sub-tab state (0.11.2 nav restructure, Task 5).
  // The OPERATIONS program (0.12.0 "Console" nav, CN5): the MISSION perspective,
  // driven by the shared <ConsoleTabs> slim TOP rail (same idiom Home / Personnel
  // / Logistics use), one tab per mission TYPE. Two tabs are live today and are
  // the only ones ever selectable:
  //   - "gathering": the existing resource-gathering mission dispatch (in-progress
  //     + available cards + the assign/dispatch flow + the tier selector), moved
  //     VERBATIM out of the old activeOperationsSubTab "dispatch" pane. This was
  //     the single live entry in the retired mission-category rail
  //     (activeMissionCategory === "resourceGathering"); with the rail gone it is
  //     promoted directly under this tab.
  //   - "missionControl": the mission-UNLOCK facility, moved VERBATIM (it was the
  //     old activeOperationsSubTab "missionControl" pane).
  // The rail's other slots are LOCKED, reserved "coming soon" ConsoleTabs with no
  // page (combat/exploration missions and the combat-era Battlespace do not exist
  // yet): Combat + Exploration (the old locked Patrol / Surveying / Long-Term
  // Exploration mission categories fold into these two) and Battlespace (PvE) /
  // Battlespace (PvP) (which absorb the old 4-item Battlespace stub panel).
  // ConsoleTabs blocks selection of locked tabs, so onSelect only ever hands back
  // "gathering" or "missionControl"; the type is scoped to those two reachable
  // states. Defaults to "gathering" so the tab opens on live mission dispatch.
  // Combat 0.13.0 (Phase 9b.5d): "combat" is now a LIVE Operations sub-tab (the Combat
  // Patrols dispatch surface), no longer a locked reserved slot. Gathering stays the
  // default landing tab; missionControl + combat are the other two live tabs.
  type OperationsTab = "gathering" | "missionControl" | "combat";
  let activeOperationsTab: OperationsTab = "gathering";

  // ---- Warehouse facility view (Phase 2, Group C; 0.11.2 Task 9 restructure) --
  // 0.12.0 "Console" nav (Logistics, CN3a): the Warehouse's two CONTENT tabs left
  // for Logistics (Materials -> Logistics > Materials; Finished Goods / Ship
  // Systems -> Logistics > Ship Equipment). What remains here is the warehouse-as-
  // a-BUILDING management, its two facility-management views, now hosted in the
  // Foundry tab (Warehouse rail entry) since Facilities is not converted yet:
  //   - Overview: at-a-glance storage state (T1 level + cap, items-at-cap ⚠, the
  //     discovered/total catalog count, and the FULL-material attention card).
  //   - Upgrade: the per-tier storage-expansion Build/Unlock cards (the ONLY UI
  //     to expand material storage capacity).
  //
  // Kept a typed literal union (not a free string) so a future tab is added
  // deliberately, the same discipline RefinerySubTab/FoundryFacilityKey use.
  type WarehouseCat =
    | "overview"
    | "upgrade";
  let activeWarehouseCat: WarehouseCat = "overview";

  // The 2 warehouse management SubTabs, in display order (Overview then Upgrade),
  // mirroring the Refinery's Overview/Upgrades management axis.
  const WAREHOUSE_CAT_TABS: { key: WarehouseCat; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "upgrade", label: "Upgrade" },
  ];

  // FINISHED GOODS secondary tabs (0.11.2 Task 10) were RETIRED in the 0.12.0
  // "Console" nav (Logistics, CN3a). The old Finished Goods > Ship Systems bay
  // became the Logistics > Ship Equipment tab, which shows the Ship Systems bay
  // DIRECTLY (no inner SubTabs strip, per the console FLATTEN principle: an inner
  // tab layer under ConsoleTabs collapses). The reserved Weapons / Modules /
  // Consumables families are now compact locked "coming soon" markers inline in
  // that tab, preserving the combat-roadmap signal without a nested tab layer.
  // The reserved-slot chip labels live in LOGISTICS_RESERVED_GOODS below.
  // Combat 1.0 (BUG-U2): "Weapons" dropped, they are now craftable + real and show in the Ship
  // Systems bay above (BUG-U1), so a "coming soon" chip for them is stale. Modules + Consumables
  // remain genuine reserved families with no engine yet.
  const LOGISTICS_RESERVED_GOODS: string[] = ["Modules", "Consumables"];

  // The warehouse TIERS that have their own facility + cap system today (design
  // §3.1: each tier is its own facility). Drives the Upgrade tab's per-tier
  // cards AND the "is this tier's storage unlocked?" check for tier panels.
  // T1 is the BASE tier (available from level 0); T2 is the unlock stub.
  const WAREHOUSE_TIERS: { tier: number; key: string; label: string }[] = [
    { tier: 1, key: "warehouseT1", label: "Tier 1" },
    { tier: 2, key: "warehouseT2", label: "Tier 2" },
  ];

  // A tier's storage is "unlocked" when its warehouse facility is built. T1 is
  // the base tier, always unlocked (cap active at level 0, no unlock rung). A
  // higher tier (T2+) is locked until its unlock rung (level 0 -> 1) completes,
  // i.e. facility level > 0. A tier with NO warehouse facility at all (none
  // today beyond T2) is treated as unlocked so its items still show (fail-open,
  // matching tierCap's own uncapped fail-open for un-warehoused tiers).
  function warehouseTierUnlocked(tier: number): boolean {
    if (tier <= 1) return true;
    const facilityKey = `warehouseT${tier}`;
    if (!FACILITIES[facilityKey]) return true; // no facility gate for this tier
    return (state.facilities[facilityKey]?.level ?? 0) > 0;
  }

  // ---- Materials tab sections (0.11.2 Task 9) --------------------------------
  // The Materials tab replaces the old flat Raw/Refined/Components/Salvaged
  // catalog tabs with ONE scrollable pane: a Tier selector, then a FIXED series
  // of themed labeled sections. Each section is defined by a membership predicate
  // over the static ITEMS table and renders the SAME fill-tile grid the old
  // catalog tabs used, for its items AT the selected tier. The four raw
  // sub-category sections partition the raw items by their `subCategory` field
  // (added in Task 8); refined/components/salvaged each match on ItemCategory.
  type MaterialsSectionKey =
    | "oresMetals"
    | "volatiles"
    | "organicCompounds"
    | "recoveredTech"
    | "refined"
    | "components"
    | "salvaged";

  // Section display order (mockup order). The four raw sub-category sections
  // first, then Refined, then Components, then Salvaged Materials last (salvaged
  // is rendered with its own select-to-salvage tile, so it is handled separately
  // in the markup, but it lives in this list to keep the ordering in one place).
  const MATERIALS_SECTIONS: { key: MaterialsSectionKey; label: string }[] = [
    { key: "oresMetals", label: "Ores & Metals" },
    { key: "volatiles", label: "Volatiles" },
    { key: "organicCompounds", label: "Organic Compounds" },
    { key: "recoveredTech", label: "Recovered Tech" },
    { key: "refined", label: "Refined" },
    { key: "components", label: "Components" },
    { key: "salvaged", label: "Salvaged Materials" },
  ];

  // SINGLE source of section membership. Raw sub-category sections match on the
  // raw `subCategory` field (so the four of them partition the raw items with no
  // overlap: every raw item has exactly one subCategory); the rest match on
  // ItemCategory. Components folds minor+major, matching the old Components tab.
  function itemInMaterialsSection(item: ItemDef, key: MaterialsSectionKey): boolean {
    switch (key) {
      case "oresMetals":
      case "volatiles":
      case "organicCompounds":
      case "recoveredTech":
        return item.category === "raw" && item.subCategory === key;
      case "refined":
        return item.category === "refined";
      case "components":
        return item.category === "minorComponent" || item.category === "majorComponent";
      case "salvaged":
        return item.category === "salvagedMaterial";
    }
  }

  // Items in a section AT a given tier, in ITEMS registry order (deterministic,
  // matching how the old catalog grid ordered its tiles). PURE over the static
  // ITEMS table + tier; the per-tile fill/count/cap read live `state` in the
  // markup instead, so this only re-runs when the selected tier changes.
  function materialsSectionItems(key: MaterialsSectionKey, tier: number): (ItemDef & { id: string })[] {
    const out: (ItemDef & { id: string })[] = [];
    for (const id of Object.keys(ITEMS)) {
      const item = ITEMS[id];
      if (item.tier !== tier) continue;
      if (!itemInMaterialsSection(item, key)) continue;
      out.push({ id, ...item });
    }
    return out;
  }

  // Selected tier for the Materials tab's tier selector (T1 default). Distinct
  // from the Upgrade tab (which shows ALL tiers as management cards); here one
  // tier's stock shows at a time, matching the Materials mockup.
  let activeMaterialsTier = 1;

  // ALL material sections for the selected tier, each with its resolved item list.
  // Salvaged Materials is now INCLUDED here (user 2026-07-21) so it renders with the
  // SAME fill-tile grid as Ores / Refined / Components, integrated with the rest of
  // the materials rather than a separate select-to-salvage block. The salvage ACTION
  // lives in the Foundry Salvage Bay facility now, so the Materials tiles are just
  // browse-only stock, identical to any other material (same fill-tile + tooltip).
  // Re-derives when the selected tier changes.
  $: materialsStandardSections = MATERIALS_SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    items: materialsSectionItems(s.key, activeMaterialsTier),
  }));

  // Salvaged Materials for the SALVAGE BAY facility (0.11.2 Task 11): every
  // salvagedMaterial item ACROSS ALL tiers, in ITEMS registry order. The Salvage
  // Bay has no tier selector (unlike the Warehouse Materials tab), so it gathers
  // the whole salvaged catalog in one section. PURE over the static ITEMS table,
  // so it is computed once as a const (the per-tile held count reads live `state`
  // in the markup). Today this is the single Damaged Reactor Housing; more
  // salvaged materials fold in automatically as they are added to ITEMS.
  const salvageBaySalvagedItems: (ItemDef & { id: string })[] = Object.keys(ITEMS)
    .filter((id) => ITEMS[id].category === "salvagedMaterial")
    .map((id) => ({ id, ...ITEMS[id] }));
  // The salvaged materials the player actually HOLDS (count > 0). The Salvage Bay
  // salvaged section lists these only, mirroring the Ship Systems section (which
  // lists only held spares), so an empty hold shows the friendly stub instead of
  // an unactionable zero-count tile. Reactive: reads live inventory.
  $: salvageBayHeldSalvaged = salvageBaySalvagedItems.filter((entry) => itemTotal(state.inventory, entry.id).gt(0));
  // Whole-tier empty check: drives a friendly stub when the selected tier holds
  // no materials at all (e.g. a higher tier before its items exist).
  $: materialsTierEmpty = materialsStandardSections.every((s) => s.items.length === 0);

  // Per-category placeholder glyph for a discovered tile (real icons land later,
  // per the mockup's "icons are placeholders" note). A generic emoji per
  // category group, deliberately simple; the fill + count + rarity ring carry
  // the real at-a-glance information, not the glyph.
  function warehouseCategoryGlyph(category: ItemCategory): string {
    switch (category) {
      case "raw":
        return "🪨";
      case "refined":
        return "🔷";
      case "minorComponent":
      case "majorComponent":
        return "⚙️";
      case "shipModule":
      case "shipSystem":
        return "🛡️";
      // salvagedMaterial (0.11.0 Task A3): a broken-down item you strip for parts,
      // not a raw resource or a finished part, so it gets its own recycle glyph.
      case "salvagedMaterial":
        return "♻️";
    }
  }

  // Combat 0.13.0 (offline recap "why did it stop early"): map a captain's wall-stop reason
  // (offlineSummary attaches it only when the captain went mission -> idle DURING the window) to a
  // friendly, sentence-case note shown after its XP in the "While you were away" Captains rows. So
  // a reduced haul reads as an explained early stop, not a bug. No ALL CAPS / "!" / em dashes.
  function offlineStopReasonNote(reason: CaptainStopReason): string {
    switch (reason) {
      case "fuel":
        return "stopped early, out of fuel";
      case "cargo":
        return "stopped early, cargo hold full";
      case "defeat":
        return "lost the patrol, ship in repair";
    }
  }

  // Rarity -> tile accent color. Reuses existing theme tokens where one fits
  // (uncommon -> success green, legendary -> warning amber); rare/epic/common
  // have no matching token so use fixed hex (the mockup's own rarity palette).
  // Drives the fill gradient, the rare+ ring, and the tooltip rarity label.
  function warehouseRarityColor(rarity: ItemDef["rarity"]): string {
    switch (rarity) {
      case "common":
        return "#8b9cb0";
      case "uncommon":
        return "var(--color-success)";
      case "rare":
        return "#4fa3f2";
      case "epic":
        return "#b07cf2";
      case "legendary":
        return "var(--color-warning)";
    }
  }

  // Mission DROP icon row (2026-07-15 UI), the tiers a mission ACTUALLY drops,
  // as {key, chancePct} descriptors driving both the icon row and each icon's
  // tooltip. common ALWAYS drops; uncommon/rare are INCLUDED ONLY when their
  // chance is > 0 (so Local Deuterium Skim, whose uncommon/rare chances are both
  // 0, shows a single icon; resource runs show three). chancePct is THIS tier's
  // per-tick win chance as a percent: common = 1 - uncommon - rare, uncommon =
  // uncommonChance, rare = rareChance.
  //
  // The chances are passed IN rather than read off a MissionDef so the ONE builder
  // serves both callers without changing any value: the AVAILABLE-MISSIONS card
  // hands in the mission's BASE chances (matching that card's old text rows) and
  // the captain popup hands in the captain-EFFECTIVE chances it already computed
  // (matching the popup's old text rows). Filtering on the passed chance is
  // equivalent to filtering on the base chance for the zero case, since an
  // effective chance is base * (1 + mult) and is 0 exactly when the base is 0.
  function missionDropTiers(
    loot: { common: string; uncommon: string; rare: string },
    uncommonChance: number,
    rareChance: number,
  ): Array<{ key: string; chancePct: number }> {
    const tiers: Array<{ key: string; chancePct: number }> = [];
    tiers.push({ key: loot.common, chancePct: (1 - uncommonChance - rareChance) * 100 });
    if (uncommonChance > 0) tiers.push({ key: loot.uncommon, chancePct: uncommonChance * 100 });
    if (rareChance > 0) tiers.push({ key: loot.rare, chancePct: rareChance * 100 });
    return tiers;
  }

  // % of cap an item's stock fills, clamped to [0,100] for the tile fill height
  // and tooltip mini-bar. cap is always >= the tier base (>= 1M), never 0, so
  // the divide is safe. An at-cap item reads 100 exactly (materialAtCap's >=).
  function warehouseFillPct(count: Decimal, cap: Decimal): number {
    if (cap.lte(0)) return 0; // defensive, no real tier cap is ever <= 0
    const pct = count.div(cap).times(100).toNumber();
    return Math.max(0, Math.min(100, pct));
  }

  // Warehouse tile tooltip (Phase 2, Group C), a single fleet-positioned
  // element (not one-per-tile), the SAME pattern the currency-chip tooltip uses,
  // so it escapes the scroll container's clipping. Holds only the hovered/tapped
  // itemId + a viewport position; the tooltip MARKUP re-derives name/count/cap/
  // pct/atCap from live `state` each render, so the readout stays live (fills
  // move) even while the pointer rests on a tile. null = hidden.
  // dropChancePct discriminates the TWO tooltip flavors this one element now
  // serves (mission drops UI, 2026-07-15): null = a Warehouse TILE tooltip
  // (stored/cap/fill%/flavor, the original behavior); a number = a mission DROP
  // ICON tooltip (rarity-colored name + stored qty + flavor + THIS number as the
  // per-tick drop chance). One open-tooltip model either way, opening one kind
  // replaces the other, and only one tab/popup surfaces its icons at a time.
  let warehouseTooltip: { itemId: string; x: number; y: number; dropChancePct: number | null } | null = null;

  // Approximate tooltip footprint, used only to keep it on-screen (clamp +
  // flip-above). A slight over-estimate is fine, it just biases toward
  // flipping above / nudging left a touch early, never clips.
  const WAREHOUSE_TOOLTIP_W = 220;
  const WAREHOUSE_TOOLTIP_H = 190;

  // Position the tooltip from the hovered tile's on-screen rect: below it by
  // default, flipped above if it would overflow the viewport bottom, and clamped
  // horizontally. Mirrors the mockup's own showTip() geometry.
  // dropChancePct defaults to null so EXISTING warehouse-tile callers are
  // unchanged (they pass 2 args); mission drop icons pass the third arg to tag
  // this as a drop tooltip and carry the chance to display.
  function showWarehouseTooltip(event: Event, itemId: string, dropChancePct: number | null = null) {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    let x = Math.min(window.innerWidth - WAREHOUSE_TOOLTIP_W - 8, rect.left);
    x = Math.max(8, x);
    let y = rect.bottom + 8;
    if (y + WAREHOUSE_TOOLTIP_H > window.innerHeight) {
      y = rect.top - WAREHOUSE_TOOLTIP_H - 8;
    }
    y = Math.max(8, y);
    warehouseTooltip = { itemId, x, y, dropChancePct };
  }

  function hideWarehouseTooltip() {
    warehouseTooltip = null;
  }

  // Tap toggles (mobile): tap a tile to show its tooltip, tap the same tile
  // again to hide. On desktop the pointer-hover handlers below drive it; this
  // makes tap work too. This is the SOLE show/hide path on touch (hover is
  // mouse-gated), so a first tap can no longer be undone by the synthetic
  // pointerenter that a tap also fires, see hoverEnterWarehouseTooltip.
  function toggleWarehouseTooltip(event: Event, itemId: string, dropChancePct: number | null = null) {
    if (warehouseTooltip && warehouseTooltip.itemId === itemId) {
      hideWarehouseTooltip();
    } else {
      showWarehouseTooltip(event, itemId, dropChancePct);
    }
  }

  // Hover is MOUSE-ONLY, the SAME fix the currency chip uses (see
  // hoverEnterCurrency/hoverLeaveCurrency). A touch tap ALSO fires synthetic
  // pointerenter/pointerleave (pointerType "touch") plus focus/blur; before
  // this, that synthetic pointerenter showed the tooltip and the tap's on:click
  // then toggled it right back off, so the FIRST tap showed nothing (RadialWeb
  // mobile lesson). Gating the hover show/hide to pointerType "mouse" leaves
  // touch driven solely by tap (on:click toggle) + tap-outside
  // (handleWarehouseOutsidePointer) + context-change clears.
  function hoverEnterWarehouseTooltip(event: PointerEvent, itemId: string, dropChancePct: number | null = null) {
    if (event.pointerType === "mouse") showWarehouseTooltip(event, itemId, dropChancePct);
  }
  // Guarded by itemId so leaving tile A can't clear a tooltip that hover has
  // already switched to tile B (parallels hideCurrency's key guard).
  function hoverLeaveWarehouseTooltip(event: PointerEvent, itemId: string) {
    if (event.pointerType === "mouse" && warehouseTooltip?.itemId === itemId) {
      hideWarehouseTooltip();
    }
  }

  // Focus shows the tooltip for KEYBOARD users ONLY. A touch tap (and a mouse
  // click) also fires `focus` on the <button>; before this gate, focus showed
  // the tooltip and then the SAME tap's on:click toggled it right back OFF, so
  // on mobile the first tap flashed nothing and it took a SECOND tap to actually
  // show it (the reported two-tap bug). `:focus-visible` matches ONLY
  // keyboard-driven focus (browsers deliberately suppress it for pointer/touch
  // focus), so Tab-focus still surfaces the tooltip for a11y while touch is
  // driven solely by the on:click toggle (one tap) and mouse by hover. Desktop
  // hover/click behavior is unchanged.
  function focusShowWarehouseTooltip(event: FocusEvent, itemId: string, dropChancePct: number | null = null) {
    const el = event.currentTarget as HTMLElement | null;
    if (el && el.matches(":focus-visible")) showWarehouseTooltip(event, itemId, dropChancePct);
  }

  // Touch/click dismissal, mirrors handleCurrencyOutsidePointer. Hide the
  // warehouse tooltip on any pointer-down that isn't on a warehouse tile.
  // pointerdown fires for mouse AND touch (RadialWeb mobile lesson);
  // .closest(".warehouse-tile") keeps a tap on a tile from self-dismissing here
  // (that tap's on:click toggles it instead). The tooltip itself is
  // non-interactive, so a tap landing on it dismissing is fine/expected.
  function handleWarehouseOutsidePointer(event: PointerEvent) {
    if (warehouseTooltip === null) return;
    const target = event.target as Element | null;
    // Spare BOTH trigger kinds: a warehouse tile (its own on:click toggles) and a
    // mission drop icon (.drop-icon, added 2026-07-15), a tap landing on either
    // must not self-dismiss here before that element's toggle runs.
    if (target && target.closest(".warehouse-tile, .drop-icon")) return;
    warehouseTooltip = null;
  }

  // Clear the warehouse tooltip whenever the surrounding navigation changes
  // (review Minor): the tooltip is anchored to a specific tile's rect, so leaving
  // that view would otherwise leave it hovering over unrelated content. The
  // material fill-tiles (the only tiles that raise this tooltip) now live in the
  // Logistics > Materials tab (0.12.0 "Console" nav, CN3a), so nav within/away is
  // tracked via activeLogisticsTab (switching Logistics tabs) and activeTab
  // (leaving Logistics entirely). Referencing both vars makes this reactive
  // statement re-run on either change (the initial null -> null run is harmless).
  $: activeLogisticsTab, activeTab, hideWarehouseTooltip();

  // Collapse any expanded "View Info" mission detail when the player leaves the
  // Gathering view (0.12.0 "Console" nav, CN5b): the expanded card belongs to the
  // Operations > Gathering tab, so switching Operations tabs (activeOperationsTab)
  // or leaving Operations entirely (activeTab) should return every card to its
  // compact summary. Same idiom as the warehouse-tooltip reset above; referencing
  // both vars re-runs this on either change (the initial null -> null is harmless).
  $: activeOperationsTab, activeTab, (expandedMissionKey = null);

  // The Refinery's three sub-tabs: Overview (level + refine slots + active jobs +
  // one-shot Start Refine Job), Orders (Phase 2 Task D4, the batch/continuous
  // ORDER management view, design §4.4's dedicated refinery management view), and
  // Upgrades (the next upgrade rung's material/prereq readiness + Build). Defaults
  // to Overview since running refine jobs is the more common day-to-day action
  // than buying the occasional upgrade, the same "default to the commonly-checked
  // view" reasoning the other sub-tab groups use.
  type RefinerySubTab = "overview" | "orders" | "upgrades";
  let activeRefinerySubTab: RefinerySubTab = "overview";

  // Mission Rework (Task 8 UI): the two new facilities' sub-tab axes. Both mirror
  // the Refinery/Warehouse pattern EXACTLY, an Overview (the at-a-glance state)
  // and an Upgrades (the next-rung readiness + Build) view, so their content
  // panes reuse the same SubTabs + Panel + upgrade-rung idiom. Kept as their own
  // typed literal unions + let state (not shared with RefinerySubTab) so each
  // facility's tab selection is independent, same discipline as the others.
  type MissionControlSubTab = "overview" | "upgrades";
  let activeMissionControlSubTab: MissionControlSubTab = "overview";
  type FuelStorageSubTab = "overview" | "upgrades";
  let activeFuelStorageSubTab: FuelStorageSubTab = "overview";
  // Research (Task R5 UI): the Research Lab's THREE-tab axis, Overview (slots in
  // use + in-progress projects + researched/available counts + the Fabricator
  // signpost), Research (the tier-grouped blueprint list with per-blueprint
  // Research buttons), and Upgrades (the lab's tier/slot track). Same independent
  // typed-union + let-state discipline as the two facilities above; defaults to
  // Overview (the at-a-glance "what's cooking" view), matching the others.
  type ResearchSubTab = "overview" | "research" | "upgrades";
  let activeResearchSubTab: ResearchSubTab = "overview";

  // Fabricator (Task F4 UI): the Fabricator's THREE-tab axis, Overview (slots in use +
  // in-flight craft jobs + researched/fabricable counts + the Shipyard signpost), Craft
  // (the tier-grouped RESEARCHED-blueprint list with per-blueprint order controls), and
  // Upgrades (the fabricator's tier/slot track). Same independent typed-union + let-state
  // discipline as ResearchSubTab above; defaults to Overview, matching the others.
  type FabricatorSubTab = "overview" | "craft" | "upgrades";
  let activeFabricatorSubTab: FabricatorSubTab = "overview";

  // Shipyard (Task S5 UI): the Shipyard's TWO-tab axis, Build (the founded-vs-unfounded
  // hull-build surface: the "Found the Shipyard" prompt when unfounded, else the in-flight
  // build card + one card per SHIP_TYPES hull with its BOM/cost/time + Build button) and
  // Upgrades (the shipyard's founding + build-speed track, wired to the SHARED facility-
  // upgrade seams exactly like the Fabricator/Research Upgrades tabs). Same independent
  // typed-union + let-state discipline as FabricatorSubTab above; defaults to Build (the
  // primary "make a ship" view, the Shipyard has no at-a-glance Overview, unlike the
  // producer facilities, because its single build slot's status lives on the Build tab).
  type ShipyardSubTab = "build" | "upgrades";
  let activeShipyardSubTab: ShipyardSubTab = "build";

  // Crafting Allocation Redesign (Task C4): the per-line CONFIGURATOR's local form state.
  // A configured craft becomes a real line ONLY on Start (via startLine), until then the
  // selections live here, in COMPONENT-LOCAL state, never on GameState. Only ONE configurator
  // is expanded at a time (the mockup's "one open form"), so a single shared form suffices:
  //   - openConfig: which idle slot's form is expanded ({ kind, slotIndex }), or null (all
  //     collapsed). `kind` picks the dropdown data source + the startLine kind.
  //   - cfgTier: the selected tier (refine has no tiers -> always 1; fabricate = a real tier).
  //   - cfgRecipeKey: the selected REFINE_RECIPES / BLUEPRINTS key (the item dropdown value).
  //   - cfgQty: the batch quantity, clamped 1..maxAffordableIterations at start (defense in
  //     depth on top of the field's min/max) so a blank/fractional/over-cap entry can't start.
  let openConfig: { kind: CraftLineKind; slotIndex: number } | null = null;
  let cfgTier = 1;
  let cfgRecipeKey = "";
  let cfgQty = 1;

  // Crafting Allocation Redesign (Task C4): the Start-confirmation handshake, REUSED from the
  // retired refine-order flow. When the player clicks a configurator's Start AND
  // refineConfirmEnabled is on, we stash the about-to-start line in pendingLineStart and open
  // the modal instead of starting immediately; Confirm reads pendingLineStart to start it (and,
  // if the don't-show-again box is ticked, disables the pref). Cancel drops it. Null when no
  // confirmation is pending. The confirm now covers BOTH facilities (the shared doStartLine
  // handler), and is materially SOFTER than before: a started line reserves materials that a
  // Cancel fully refunds. Same "state near the modal flag" pattern as deleteModalOpen.
  let refineConfirmModalOpen = false;
  let refineConfirmDontShowAgain = false;
  let pendingLineStart: { kind: CraftLineKind; recipeKey: string; mode: CraftLineMode } | null = null;

  // Ship assign/swap picker modals (Ships, Stats Foundation, Task 11 UI) --
  // mirrors the Fleet Operations mission popup's missionPopupKey/
  // missionPopupCaptainId state pair: a null id means the modal is closed. Both
  // pickers ultimately call assignShipToCaptain(state, captainId, parkedShipId)
  // (see doAssignShip), but they open from DIFFERENT row actions and list
  // DIFFERENT things, so they're two independent bits of modal state:
  //
  //   assignPickerShipId (Assign ▾ on a PARKED ship): holds THAT parked ship's
  //   id while the player picks which IDLE CAPTAIN to assign it to. The picked
  //   captain's OWN old hull auto-parks (assignShipToCaptain's park branch).
  //
  //   swapPickerCaptainId (Swap ▾ on an ASSIGNED ship whose captain is IDLE):
  //   holds THAT ship's assigned captainId while the player picks a PARKED SHIP
  //   to give that captain instead. The current hull parks; the picked parked
  //   ship becomes assigned. We track the CAPTAIN id (not the ship id) because
  //   that's assignShipToCaptain's first arg, and the current hull auto-parks
  //   purely as a side effect of assigning the captain a different hull, we
  //   never need the current ship's id for the call itself.
  //
  // Both are plain component-local UI state (never persisted), the same
  // treatment as missionPopupKey.
  let assignPickerShipId: string | null = null;
  let swapPickerCaptainId: number | null = null;

  // ---- Currency HUD (2026-07-09) ------------------------------------------
  // Drives the .top-bar-currencies strip in the template. Every currency shown
  // in the top bar is described ONCE here, so adding a future currency (admin
  // points, etc.) means adding one CURRENCY_META entry, glyph + name + its
  // info-tooltip text all in the same object, not editing markup. This is the
  // "each currency needs a tooltip with what it is + flavor text" requirement
  // baked into the data model rather than bolted on per chip.
  type CurrencyDescriptor = {
    key: string; // stable id; also the tooltip open/close token
    glyph: string; // short accent-colored mark shown in the chip
    label: string; // human name, shown as the info-tooltip header
    description: string; // what it is + flavor; shown in the tooltip body
  };
  const CURRENCY_META: CurrencyDescriptor[] = [
    {
      key: "credits",
      glyph: "◈",
      label: "Credits",
      // FLAVOR DRAFT (2026-07-09): credits are the game's BASE currency, the
      // intended sink for most transactions (buying/selling commodities, etc.),
      // per the user. Wired in code TODAY: earned from captain mission cycles
      // (creditsPerCycle, tick.ts), spent on talent respecs (RESPEC_COST_
      // CREDITS); commodity trading is planned, not yet implemented. The lore
      // half is a placeholder for the user to wordsmith to taste.
      description:
        "The Admiralty's base currency, earned from captain mission payouts and spent on nearly everything: trading commodities, retraining talents, and the day-to-day business of running a fleet. Every credit is a favor called in, a cargo sold, a risk that paid off.",
    },
  ];
  // Live formatted values, keyed by currency id. Kept separate from the static
  // CURRENCY_META so this reactive block only recomputes the numbers each tick.
  // Adding a currency: add its key here alongside its CURRENCY_META entry.
  $: currencyValues = { credits: formatNumber(state.credits) } as Record<string, string>;
  // Key of the currency whose info tooltip is showing, or null. This behaves
  // like a standard tooltip, NOT a click-to-toggle: it SHOWS on mouse hover
  // (desktop), tap (touch), or keyboard focus, and HIDES when the mouse leaves,
  // focus leaves, the user taps elsewhere, or Escape is pressed. Open and close
  // are driven by SEPARATE activate/deactivate events (not one toggle) so that
  // hover, tap, and focus never fight each other, important on touch, where a
  // single tap also fires synthetic pointerenter + focus events.
  let openCurrencyKey: string | null = null;
  function showCurrency(key: string) {
    openCurrencyKey = key;
  }
  // Guarded so leaving/blurring chip A can't clear a tooltip that (once there
  // are multiple currencies) has already switched to chip B.
  function hideCurrency(key: string) {
    if (openCurrencyKey === key) openCurrencyKey = null;
  }
  // Hover is MOUSE-ONLY. pointerenter/leave also fire for touch (pointerType
  // "touch") during a tap, which would instantly re-hide what the tap just
  // showed; gating to "mouse" leaves touch driven solely by tap (on:click) +
  // tap-outside (handleCurrencyOutsidePointer).
  function hoverEnterCurrency(e: PointerEvent, key: string) {
    if (e.pointerType === "mouse") showCurrency(key);
  }
  function hoverLeaveCurrency(e: PointerEvent, key: string) {
    if (e.pointerType === "mouse") hideCurrency(key);
  }
  // Touch/click dismissal: hide on any pointer-down that isn't on a currency
  // chip or its tooltip. pointerdown fires for mouse AND touch per the RadialWeb
  // mobile lesson; .closest(".currency-chip-wrap") keeps a tap on the chip
  // itself from self-dismissing (that tap's on:click does the showing).
  function handleCurrencyOutsidePointer(e: PointerEvent) {
    if (openCurrencyKey === null) return;
    const target = e.target as Element | null;
    if (target && target.closest(".currency-chip-wrap")) return;
    openCurrencyKey = null;
  }
  function handleCurrencyKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && openCurrencyKey !== null) openCurrencyKey = null;
  }
  // -------------------------------------------------------------------------

  // ---- Facility-upgrade disabled-reason tooltip (SHARED) -------------------
  // Flicker fix (2026-07-24, generalized). EVERY facility-upgrade Build button is
  // DISABLED whenever it has a reason to show, and previously that reason was fed
  // to the button's NATIVE `title` attribute. The browser hides and re-shows a
  // native tooltip every time the `title` string changes, and the reason string
  // from canBuildFacilityUpgrade (and the sibling canUpgrade* gates) embeds the
  // LIVE free stock ("Need 750000 Titanium Ore (have Y)"). freeItemForState(Y)
  // changes on every tick while a producer fills or a craft line reserves the
  // gating material, so the title mutated once per tick and the native tooltip
  // flickered on and off under the hovering pointer, exactly the "resetting with
  // the tick" the owner reported.
  //
  // Root fix: show the reason in a CUSTOM popover whose OPEN state (this key) is
  // held in a variable the tick never touches, the same open-state-independent-of-
  // tick idiom the currency-chip tooltip uses. A tick re-render now only rewrites
  // the reason TEXT in place; it never tears the popover down or re-opens it, so
  // there is nothing left to flicker.
  //
  // This is the SINGLE SOURCE of that behavior. The markup half lives in ONE place
  // too: the {#snippet facilityUpgradeButton(...)} at the top of the template, which
  // renders the hover WRAPPER + the button + the popover and carries the one
  // justified a11y-ignore. Every facility Build button renders through that snippet,
  // so adding a future upgrade button is a one-line {@render ...} include.
  //
  // Keyed by a caller-supplied string (unique per button, e.g. "refinery", or the
  // Warehouse tier's wt.key) so only the hovered card's popover opens. The hover
  // handlers live on a WRAPPER around the button, NOT the button itself: a disabled
  // <button> does not dispatch pointer events, so listening on the button would
  // never fire. Mouse-hover only (mouseenter/mouseleave), matching the old native
  // title, which never surfaced on touch anyway; touch/keyboard users still read the
  // same shortfall in the always-visible readiness rows above.
  //
  // NOTE: the Docks "Expand Docks" and Systems-Bay "Upgrade Bay" buttons are NOT
  // routed through the snippet. They already render their reason in a PERSISTENT
  // note directly below the button (their readiness display, since they have no
  // per-material ✅/❌ rows), and a persistent text node updates in place without
  // flicker. For those two the fix is simply DROPPING the native title; adding a
  // hover popover on top of an always-visible note would only duplicate it.
  let openUpgradeReasonKey: string | null = null;
  function showUpgradeReason(key: string) {
    openUpgradeReasonKey = key;
  }
  function hideUpgradeReason(key: string) {
    if (openUpgradeReasonKey === key) openUpgradeReasonKey = null;
  }
  // -------------------------------------------------------------------------

  // ---- Homeworld program rail state ----------------------------------------
  // RETIRED (0.12.0 "Console" nav, Phase 1 / CN2b). The Homeworld tab is gone:
  // its ADMINISTRATION prestige tree (the Fleet Admiral prestige RadialWeb) moved
  // VERBATIM into the Personnel > Admiral page's Prestige modal (the FA is a
  // PERSON, so it belongs in the person perspective), and its empty HOME PLANET
  // overview placeholder was dropped (material inventory already lives in the
  // Warehouse). The old rail-selection state (activeHomeworldPlace /
  // activeHomeworldSubTab, and the HomeworldPlaceKey / HomeworldSubTab types)
  // was removed with the tab; the two locked "place" stubs (Alliance Sector /
  // Colony Registry) were content-less "coming soon" items that do not fit the
  // person perspective and were PARKED (removed), pending re-homing to a future
  // perspective. The prestige tree's own wiring (HOMEWORLD_TALENTS, adminPoints,
  // doBuyHomeworldTalent, selectedCategory/categoryCards/viewCategory, the
  // respec flow) is UNCHANGED and still lives in the script; only its host moved.

  // System tab sub-tabs (UI Redesign, Task 10; gained About in the layout-
  // width/panel-style fix, see SESSION_LOG.md). Options holds the relocated
  // theme picker + Export/Delete Save content; Log holds the relocated LOG
  // panel; Debug holds the relocated dev debug panel (only reachable when
  // DEV_MODE is true, see the <SubTabs> usage under the System tab below,
  // which omits the "debug" entry from its tabs array entirely when DEV_MODE
  // is false, so ordinary players never see a Debug button at all. DEV_MODE is
  // DEV_MODE_ENV OR a `?dev` URL param, see the DEV_MODE declaration near the
  // top of this script for the deployed-preview test-affordance note); About
  // holds the app title/branding that used to be its own
  // always-visible header panel above the top bar, retired in favor of
  // this out-of-the-way spot, per the user's own request, since the level/
  // XP/tick bar and the bottom nav ARE the header/footer now. Defaults to
  // Options since theme/save actions are the most commonly checked view.
  type SystemSubTab = "profile" | "options" | "log" | "debug" | "about" | "patchNotes" | "community";
  let activeSystemSubTab: SystemSubTab = "options";

  // System settings modal (0.11.2 Shell Correction, Task 3). The System program
  // left the bottom nav; its settings content now opens as a MODAL from the
  // header portrait instead of a top-level tab. systemModalOpen gates the modal;
  // activeSystemSubTab still selects which settings view is shown, but is now
  // driven by a top <SubTabs> bar inside the modal instead of the old left rail.
  let systemModalOpen = false;

  // The modal's top-tab list, in display order. "profile" is the new first view
  // (Task 3); the remaining keys map to the byte-for-byte-moved settings content
  // blocks. "community" (Task 4) is the last player-visible tab. The Debug tab is
  // DEV-only and sits genuinely LAST via the spread, which injects its entry ONLY
  // when DEV_MODE is true (the exact `...(DEV_MODE ? [...] : [])` idiom the retired
  // rail/SubTabs arrays used), so ordinary players never see a Debug tab at all,
  // matching the debug content block's own {#if DEV_MODE && ...} guard. Placing the
  // dev-only tool after the user-facing tabs keeps the player tab strip clean.
  // DEV_MODE is a constant for the session, so this is a plain const, not a $: reactive.
  const systemModalTabs = [
    { key: "profile", label: "Profile" },
    { key: "options", label: "Options" },
    { key: "log", label: "Log" },
    { key: "about", label: "About" },
    { key: "patchNotes", label: "Patch Notes" },
    { key: "community", label: "Community" },
    ...(DEV_MODE ? [{ key: "debug", label: "Debug" }] : []),
  ];

  // openSystemModal / closeSystemModal / selectSystemSubTab / onSystemBackdropClick
  // Task 3 (0.11.2 Shell Correction). The header portrait is the entry point: a
  // click opens the settings modal on the Profile view. It can be closed by the
  // header ✕ button, by Escape (handled by the shared focusTrap action, same as
  // every other modal), or by clicking the backdrop outside the dialog surface.
  function openSystemModal(): void {
    activeSystemSubTab = "profile";
    systemModalOpen = true;
  }
  function closeSystemModal(): void {
    systemModalOpen = false;
  }
  // SubTabs' onSelect hands back the raw string key (its API is string-keyed);
  // narrow it back to SystemSubTab here so activeSystemSubTab stays typed.
  function selectSystemSubTab(key: string): void {
    activeSystemSubTab = key as SystemSubTab;
  }
  // Backdrop-click-close: only when the click landed on the backdrop element
  // itself, not on a click that bubbled up from the dialog surface inside it.
  function onSystemBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      closeSystemModal();
    }
  }

  // The 2026-07-07 mission-CATEGORY rail (resourceGathering + locked Patrol /
  // Surveying / Long-Term Exploration) was RETIRED in the 0.12.0 "Console" nav
  // (CN5): mission types are now the Operations ConsoleTabs top rail
  // (activeOperationsTab), so the single live category (resourceGathering) is the
  // "gathering" tab and the locked ones fold into the reserved Combat / Exploration
  // locked tabs. No activeMissionCategory state is needed anymore.

  // Difficulty tiers within Resource-Gathering, reusing the SubTabs component's
  // existing locked-tab support. Tier I is real and contains BOTH launch
  // missions (see model.ts's MissionDef.tier field), confirmed with the
  // user neither shortOreRun nor longOreRun is meant to be a separate tier.
  // Tiers II-V are locked placeholders for future mission content.
  type MissionTierKey = "tierI" | "tierII" | "tierIII" | "tierIV" | "tierV";
  let activeMissionTier: MissionTierKey = "tierI";

  // 0.12.0 "Console" nav (CN5b): the available-mission card whose "View Info"
  // detail is expanded IN PLACE (rich drop table + requirements + rewards), or
  // null when every card shows its compact summary. Only ONE card is expanded at
  // a time: the "View Info" button sets this to its own MissionKey and "Summary"
  // clears it back to null. Purely presentational (no economy/save impact); it is
  // reset when the player leaves the Gathering view (see the reactive below).
  let expandedMissionKey: MissionKey | null = null;

  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;
  let lastPollTime = Date.now();

  // Fleet-wide tick cycle (collapsed from a per-captain-id-keyed map during
  // the UI Redesign, Task 4, see docs/plans/2026-07-07-ui-redesign-plan.md
  // and docs/plans/2026-07-07-ui-redesign-design.md). tickDurationSeconds is
  // now a single field on GameState (Task 1 of this same plan), so every
  // captain advances in lockstep on ONE shared cycle instead of each
  // captain owning its own independent barCycleStart/nowTick pair.
  let cycle: { barCycleStart: number; nowTick: number } = { barCycleStart: Date.now(), nowTick: Date.now() };

  // Fuel-runway measurement (Wave 2, 2026-07-16), MEASURED, not modelled. Mission
  // ice output is a stochastic loot roll, so instead of modelling it we sample the
  // ACTUAL per-tick net fuel & ice deltas out of the live economy loop and smooth
  // them with an EMA. fuelRunwayProjection(...) (tick.ts) then projects a runway
  // from these rates. These are UI-local bookkeeping ONLY, they never feed back
  // into the economy (the loop's read of them is strictly read-only); assigning
  // them inside the poll callback is what re-triggers the `$: fuelRunway` reactive.
  // EMA_ALPHA 0.1 -> ~10-sample smoothing horizon: responsive enough to track a
  // player starting/stopping missions within seconds, damped enough that a single
  // lucky/unlucky loot tick doesn't whipsaw the readout. WARMUP_SAMPLES 15 hides
  // the readout ("measuring…") until the EMA has settled, so the very first noisy
  // samples never render a wildly wrong countdown.
  const RUNWAY_EMA_ALPHA = 0.1;
  const RUNWAY_WARMUP_SAMPLES = 15;
  let emaDFuelPerTick = 0,
    emaDIcePerTick = 0,
    runwaySamples = 0;

  function pushLog(msg: string) {
    logEntries = [msg, ...logEntries].slice(0, 8);
  }

  // Set true right before an import-triggered window.location.reload() so the
  // beforeunload/onDestroy teardown autosaves (which call doSave with the CURRENT
  // in-memory state) do NOT overwrite the freshly-imported save in localStorage.
  // That clobber was the Import Save bug: the imported save was written, then the
  // old state re-saved over it during the reload, so the original loaded back.
  // Resets to false naturally on the reload (fresh module instance).
  let suppressSave = false;

  function doSave() {
    if (suppressSave) return;
    saveToLocalStorage(state, createdAt);
  }

  onMount(() => {
    // Browsers restore scroll position across reloads by default (an
    // absolute pixel offset from the LAST time this page was open). This
    // page's height changes as content is added (more captain tabs, new
    // panels like Skill Tree), so an old offset can land well below the top
    // on a reload, confirmed live in production after the Skill Tree
    // panel shipped. This is a single-page app with no in-page anchors to
    // preserve, so we take control of scroll position ourselves instead of
    // trusting the browser's restoration.
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);

    currentTheme = loadTheme();
    document.documentElement.dataset.theme = currentTheme;
    tickBarEnabled = loadTickBarEnabled();
    showTickCounts = loadShowTickCounts();
    refineConfirmEnabled = loadRefineConfirmEnabled();
    // salvageConfirmQualities is already loaded at its declaration (it drives only
    // the checkbox display, and the actual gating reads the persisted set directly
    // via salvageNeedsConfirm), so it does not need a second load here.

    const loadedSave = loadFromLocalStorage();
    if (loadedSave) {
      createdAt = loadedSave.createdAt;
      const offlineSeconds = Math.max(0, (Date.now() - loadedSave.lastSavedAt) / 1000);
      // ⚠️ INVARIANT: the offline advance is this ONE deterministic call. offline == live
      // hinges on it being byte-identical to the live loop, so we ONLY read state around it
      // (the pre-tick snapshot is loadedSave.state, the post-tick snapshot is `state`) and
      // never thread anything through tick() itself. The summary below is a pure diff of
      // those two snapshots (summarizeOfflineProgress), rolling no RNG and adding no draws.
      const beforeSnapshot = loadedSave.state;
      state = offlineSeconds > 5 ? tick(offlineSeconds, beforeSnapshot) : beforeSnapshot;
      if (offlineSeconds > 5) {
        pushLog(`Welcome back. Advanced ${formatNumber(offlineSeconds)}s offline.`);
        // Only surface the full "While you were away" modal for a MEANINGFUL absence, and
        // only when the advance actually produced something to report (hasContent). A brief
        // drift, or an absence in which nothing happened, leaves the log line alone with no
        // modal. This runs on the SUCCESSFUL-load path only; the corrupt-recovery branch
        // below (which suppresses save) is never reached from here, so the summary can never
        // pop over a corrupt save or a fresh game.
        if (offlineSeconds >= OFFLINE_SUMMARY_MIN_SECONDS) {
          const summary = summarizeOfflineProgress(beforeSnapshot, state, offlineSeconds);
          if (summary.hasContent) offlineSummary = summary;
        }
      }
    } else if (hasRawSave()) {
      // A save EXISTS but failed to load (corrupt). Do NOT let the game overwrite it:
      // suppress autosave and show the recovery modal so the player can grab the raw
      // text before choosing to start fresh. suppressSave stays true until they choose.
      // ⚠️ LOAD-BEARING coupling: the recovery modal (saveCorruptModalOpen) MUST have NO
      // dismiss path (no Escape, backdrop, or Cancel), because the ONLY code that clears
      // suppressSave is startFreshFromCorrupt. If a future edit adds a dismiss to that
      // modal, suppressSave would stay true for the rest of the session and the running
      // game would silently NEVER persist. Keep the two coupled.
      suppressSave = true;
      corruptRawSave = exportRawSave() ?? "";
      saveCorruptModalOpen = true;
      pushLog("Your save could not be loaded. Recovery options are shown.");
    } else {
      pushLog("New save initialized.");
    }
    lastPollTime = Date.now();
    cycle = { barCycleStart: lastPollTime, nowTick: lastPollTime };

    // Tick-bar loop, checks the ONE shared fleet-wide cycle's progress every
    // 100ms, firing tickCaptainMission (Phase 3a) for EVERY mission captain
    // in lockstep whenever that shared cycle completes on this poll (Task 4
    // of the UI Redesign plan collapsed this from a per-captain-cycle loop --
    // see docs/plans/2026-07-07-ui-redesign-plan.md, since
    // tickDurationSeconds is fleet-wide now, per Task 1 of that same plan).
    // Idle captains (mission === null) have no passive economy anymore, see
    // the Phase 4 comment on tick()'s loop body below, so only mission
    // captains ever have anything to fire here. Fleet-wide gameTimeSeconds
    // advances continuously off real elapsed time every poll, decoupled from
    // the shared cycle's cadence (gameTimeSeconds is fleet bookkeeping; it
    // is never read by tickCaptainMission's production math, so this
    // decoupling cannot desync production from time).
    // barSeconds is floored at 1 real second so dev-speed presets never make
    // the shared bar flicker unreadably, multiple game-ticks just batch
    // into one visual cycle, which is still correct because
    // tickCaptainMission is closed-form.
    //
    // ⚠️ LOAD-BEARING ASYNC INVARIANT (do NOT break, especially when the online /
    // cloud-save / chat work lands): this tick callback, and every do* state handler,
    // MUST stay SYNCHRONOUS between reading and writing `state` (compute a new state,
    // then assign it, with NO await/then in between). JS never preempts a running
    // callback, so this one property is what guarantees ticks cannot overlap
    // (re-entrancy), autosave cannot serialize a half-updated state, and no captured-state
    // callback can drop an intervening update (lost update). Introduce an `await` inside
    // this callback, or between a handler's `const { next } = ...` and its `state = next`,
    // and all three of those bug classes reopen at once. Verified sound 2026-07-29.
    tickHandle = setInterval(() => {
      const now = Date.now();

      if (speed === 0) {
        paused = true;
        lastPollTime = now; // freeze the fleet clock too while paused
        return;
      }

      if (paused) {
        // Resuming: discard the paused wall-clock gap entirely for the fleet
        // clock AND the shared cycle, rather than letting it read as elapsed
        // time (which would fire unearned progress on resume).
        lastPollTime = now;
        cycle.barCycleStart = now;
        paused = false;
        return;
      }

      const realElapsedSeconds = (now - lastPollTime) / 1000;
      lastPollTime = now;
      state = { ...state, gameTimeSeconds: state.gameTimeSeconds + realElapsedSeconds * speed };

      // barSeconds/progress computed ONCE per poll now, from the fleet-wide
      // state.tickDurationSeconds, not per-captain (there's only one cycle
      // to check now, not a map keyed by captain id).
      const barSeconds = Math.max(1, state.tickDurationSeconds / speed);
      cycle.nowTick = now;
      const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;

      // Phase 2 (Task A3, docs/plans/phase2-tick-map.md): the live poll's economy
      // is now a SINGLE call to the shared economyTick, the EXACT same per-span
      // body offline catch-up (tick()) runs. This REPLACES the hand-mirrored
      // economy that used to live inline right here: the per-captain mission loop
      // (its 8-field `bonuses` build + ship-stat resolution + tickCaptainMission +
      // accumulate), the passiveTrickle loop, the loot -> addToInventory fold, the
      // mission/lifetimeStats fold, resolveProcesses, the credits award, and the
      // final applyFleetAdminXp pass. Centralizing ALL of it in economyTick is what
      // makes live play and offline catch-up drift-proof BY CONSTRUCTION, those
      // were two hand-mirrored copies of the same math and historically drifted
      // (ship stats, bonus-roll, credits, every incident logged). economyTick
      // internally does loot-THEN-process where this loop used to do
      // process-then-loot, but per the A1 map those are commutative (pure Decimal
      // addition), so the economy RESULT is identical, we are NOT preserving the
      // old internal order, we are replacing it with economyTick's.
      if (progress >= 1) {
        const gameSecondsThisCycle = barSeconds * speed;
        // Same deltaSeconds -> ticksElapsed conversion tick() uses (divide by the
        // fleet's shared tickDurationSeconds), so the live loop's mission cadence
        // stays identical to the offline catch-up path's, the whole point of
        // routing both through economyTick.
        const ticksElapsed = gameSecondsThisCycle / state.tickDurationSeconds;

        // ⚠️ ticksElapsed > 0 GUARD (REQUIRED): economyTick has NO internal
        // non-positive guard, that guard lived in tick() (`if (deltaSeconds <= 0)
        // return state;`), the function economyTick was extracted out of. Inside
        // this `progress >= 1` block ticksElapsed is always strictly positive today
        // (barSeconds is floored at 1, speed is non-zero here, speed === 0 returns
        // early at the top of this callback, and tickDurationSeconds > 0), so this
        // guard is belt-and-suspenders. It is kept as hard insurance regardless:
        // economyTick would otherwise happily advance a zero/negative span, and any
        // future change to the cycle gating must not be able to silently feed it one.
        if (ticksElapsed > 0) {
          // ⚠️ gameTimeSeconds PRESERVATION (load-bearing, NON-economy concern):
          // this live loop advances gameTimeSeconds CONTINUOUSLY off real elapsed
          // time on EVERY poll (the `gameTimeSeconds: state.gameTimeSeconds +
          // realElapsedSeconds * speed` reassignment near the top of this callback),
          // deliberately decoupled from the cycle cadence for a smooth fleet clock.
          // economyTick, HOWEVER, ALSO advances gameTimeSeconds, by this cycle's
          // deltaSeconds, because it owns that increment on the offline path. The
          // OLD inline economy here never touched gameTimeSeconds, so letting
          // economyTick's bump through would DOUBLE-count the fleet clock (once at
          // the top of this poll, once inside economyTick), a regression. So we
          // capture the live value BEFORE the call and restore it AFTER: economyTick's
          // full economy result is kept, its gameTimeSeconds bump alone is discarded.
          // This is a pure no-op for the economy, gameTimeSeconds is display-only
          // bookkeeping that NOTHING in economyTick's math reads (see economyTick's
          // own header in tick.ts).
          const liveGameTimeSeconds = state.gameTimeSeconds;

          // Fuel-runway measurement (Wave 2), READ-ONLY snapshot of the PRE-step
          // fuel & ice, captured here while `state` is still the pre-economy value.
          // These reads do NOT touch `state`/`stepped` or the economy; they only
          // feed the UI-local EMA updated after the stepping completes below.
          const preFuel = state.fuel.toNumber();
          // Quality-bucketed (Task 9a): ice total across buckets via itemTotal (absent -> 0).
          const preIce = itemTotal(state.inventory, "deuteriumIce").toNumber();

          // ⚠️ STEP per whole tick, exactly like the offline tick() path, do NOT hand
          // economyTick one big multi-tick span. economyTick's auto-stop cap-check and
          // refine-order refill each run ONCE per call, so a single economyTick(state, N)
          // for N>1 would evaluate the storage cap only once across the whole span --
          // under-enforcing caps and under-producing refine throughput versus offline
          // catch-up (which steps, see tick()). At production speed (1x, tickDuration 1s)
          // ticksElapsed is always exactly 1, so this is a single-iteration no-op that
          // matches the old one-shot call identically; it only diverges (correctly) at
          // DEV_MODE fast-forward speeds where ticksElapsed > 1. Mirror of tick(): whole
          // steps first, then a trailing fractional remainder. rng is omitted (defaults
          // to Math.random), same as the old single call.
          let stepped = state;
          const wholeSteps = Math.floor(ticksElapsed);
          for (let i = 0; i < wholeSteps; i++) {
            stepped = economyTick(stepped, 1);
          }
          const frac = ticksElapsed - wholeSteps;
          if (frac > 0) {
            stepped = economyTick(stepped, frac);
          }
          // Restore the live fleet clock: economyTick bumped gameTimeSeconds on every
          // step above, but this loop owns that clock continuously off real elapsed time
          // (top of the poll). Discard economyTick's bumps, keep its full economy result.
          state = { ...stepped, gameTimeSeconds: liveGameTimeSeconds };

          // Fuel-runway EMA update (Wave 2), runs AFTER the economy is fully
          // stepped, comparing the post-step fuel & ice (read off `stepped`) to the
          // pre-step snapshot captured above. Per-tick instantaneous rate = total
          // delta over this poll / ticksElapsed (so DEV fast-forward polls that
          // batch multiple ticks still contribute a per-TICK rate, not a per-poll
          // one). The first sample seeds the EMA directly; thereafter it blends.
          // This is pure UI bookkeeping, it writes only these three locals and
          // never mutates `state`/`stepped` or the economy.
          const postIce = itemTotal(stepped.inventory, "deuteriumIce").toNumber();
          const instDFuel = (stepped.fuel.toNumber() - preFuel) / ticksElapsed;
          const instDIce = (postIce - preIce) / ticksElapsed;
          emaDFuelPerTick =
            runwaySamples === 0 ? instDFuel : RUNWAY_EMA_ALPHA * instDFuel + (1 - RUNWAY_EMA_ALPHA) * emaDFuelPerTick;
          emaDIcePerTick =
            runwaySamples === 0 ? instDIce : RUNWAY_EMA_ALPHA * instDIce + (1 - RUNWAY_EMA_ALPHA) * emaDIcePerTick;
          runwaySamples++;
        }

        // Reset once for the whole fleet, not per-captain, there's only one
        // shared cycle now. (Poll-lag overshoot past the boundary is discarded --
        // same as always.)
        cycle.barCycleStart = now;
      }
    }, 100);

    // Autosave every 30s, tech spec §6.
    saveHandle = setInterval(doSave, 30000);

    const onUnload = () => doSave();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  });

  onDestroy(() => {
    clearInterval(tickHandle);
    clearInterval(saveHandle);
  });

  function doDispatchCaptainOnMission(captainId: number, missionKey: MissionKey) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    const { next, success } = dispatchCaptainOnMission(state, captainId, missionKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Dispatched on mission: ${MISSIONS[missionKey].label}.`);
    doSave();
  }

  function doRecallCaptain(captainId: number) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    // Combat 0.13.0: resolve a human label for the recalled run, per mission arm. An
    // extraction run reads MISSIONS[missionKey].label; a PATROL (reachable since the
    // 9b.5d dispatch UI) reads PATROLS[patrolKey].label. recallCaptain itself works on
    // BOTH arms; this only picks the log text. Captured before the state swap below,
    // same pre-swap-capture idiom as doDispatchCaptainOnMission's `captain.label` above.
    let missionLabel = "current mission";
    if (captain.mission !== null) {
      if (captain.mission.kind === "extraction") {
        missionLabel = MISSIONS[captain.mission.missionKey].label;
      } else if (captain.mission.kind === "patrol") {
        missionLabel = PATROLS[captain.mission.patrolKey].label;
      }
    }
    const { next, success } = recallCaptain(state, captainId);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Recall ordered, returning to base from: ${missionLabel}.`);
    doSave();
  }

  // Fleet Operations captain-selection popup handlers (2026-07-07 Fleet
  // Operations Mission UI), open/close just manage missionPopupKey/
  // missionPopupCaptainId (declared above near deleteModalOpen); the actual
  // dispatch is delegated to the existing doDispatchCaptainOnMission so this
  // popup can't drift from the flow the non-popup dispatch path already uses.
  function openMissionPopup(missionKey: MissionKey) {
    missionPopupKey = missionKey;
    missionPopupCaptainId = null;
  }

  function closeMissionPopup() {
    missionPopupKey = null;
    missionPopupCaptainId = null;
  }

  function doDispatchFromPopup() {
    if (missionPopupKey === null || missionPopupCaptainId === null) return;
    doDispatchCaptainOnMission(missionPopupCaptainId, missionPopupKey); // existing function, unchanged
    closeMissionPopup();
  }

  // --- Combat Patrols dispatch handlers (Combat 0.13.0, Phase 9b.5d) --------------
  // Accessor helpers reading the by-key patrol selection state with an absent-is-
  // default fallback (no entry -> no captain / "balanced" / dispatch-once). These are
  // for the SCRIPT path only (doDispatchCaptainOnPatrol). ⚠️ Do NOT call them from a
  // template {@const}/expression: a function call hides the patrolCaptainByKey (etc.)
  // read from Svelte's static dependency analysis, so the {@const} never recomputes when
  // the record changes (that caused the "captain never selects" reactivity bug). In the
  // {#each PATROLS} card, read patrolCaptainByKey/StanceByKey/RepeatByKey[patrolKey]
  // DIRECTLY so the dependency is tracked.
  function patrolSelectedCaptainId(patrolKey: PatrolKey): number | null {
    return patrolCaptainByKey[patrolKey] ?? null;
  }
  function patrolStanceFor(patrolKey: PatrolKey): CombatStance {
    return patrolStanceByKey[patrolKey] ?? "balanced";
  }
  function patrolRepeatFor(patrolKey: PatrolKey): boolean {
    return patrolRepeatByKey[patrolKey] ?? false;
  }

  // Setters. Each reassigns the whole record (Svelte 5 legacy reactivity needs a new
  // reference to re-render, spreading an object mutation would not trigger it).
  function setPatrolStance(patrolKey: PatrolKey, stance: CombatStance) {
    patrolStanceByKey = { ...patrolStanceByKey, [patrolKey]: stance };
  }
  function setPatrolRepeat(patrolKey: PatrolKey, repeat: boolean) {
    patrolRepeatByKey = { ...patrolRepeatByKey, [patrolKey]: repeat };
  }

  // --- Combat Patrols ADVISORY readouts (Combat 1.0, Unit 2.4) --------------------
  // The dispatch card shows two advisory numbers for the selected captain's ship:
  //   1. BATTLE RATING (battleRating): an opponent-agnostic "how geared am I" scalar.
  //   2. THREAT ASSESSMENT (threatAssessment): a named, colored BAND derived from a
  //      seeded FULL-PATROL sim of that ship vs THIS patrol's whole wave cycle.
  // Both are ADVISORY only; the player can dispatch regardless (the card says so).
  //
  // MULTI-WAVE HONESTY (Unit 2.4 review): a real patrol fights MULTIPLE scheduled waves and
  // carries hull / shield / drone / durability ATTRITION between them, so a single-wave read
  // (fresh full health each time) is systematically OPTIMISTIC on a multi-wave patrol, and
  // the "Guaranteed Victory" crown is the sharpest overclaim (it would assert zero losses a
  // single wave never actually tested across the full route). So the forecast runs the REAL
  // FULL cycle: resolvePatrolWaves (patrolReplay.ts) resolves every scheduled wave with the
  // SAME carry-state the live loop uses, and a sample counts as a WIN only if the ship
  // survives ALL waves (result.defeated === false). This is the same pure, parity-proven
  // resolver the combat-view replay calls (it composes buildPatrolPlayerCombatant +
  // generateEnemyWaveDetailed + resolveBattle); it does NOT touch the live tick loop.
  //
  // DISPLAY-ONLY + PARITY-SAFE (the hard Unit 2.4 constraint): this is a SEPARATE seeded
  // sim run purely for the UI. Every sample derives its masterSeed from the FIXED forecast
  // seed (FORECAST_SEED + sampleIndex), NEVER the live patrol's master seed, so it can
  // neither consume nor perturb the real dispatch RNG stream or the actual patrol outcome.
  // It mutates no game state: shipToCombatant / installedDronesForPatrol mint fresh objects,
  // resolvePatrolWaves clones its carry-state on entry, and resolveBattle deep-clones its
  // participants internally. resolveBattle and the live loop are untouched.
  //
  // CACHING (the Svelte legacy-$: freeze footgun guard): the forecast is DEFAULT_SAMPLES
  // full-patrol sims (each a handful of seeded battles), and the {@const} that calls it in
  // the {#each PATROLS} card re-evaluates on EVERY reactive flush (every tick reassigns
  // `state`). Running the sim on every flush would burn the CPU for a number that only
  // changes on a loadout / ship / patrol / stance change. So this MEMOIZES on a TIGHT
  // signature: patrolKey + shipId + stance + the installed-gear ids + a per-gear DURABILITY
  // digest. The heavy sim runs ONLY when that signature changes; every other flush is a
  // cheap signature build + a Map hit that returns the cached readout. The cache is a plain
  // Map mutated IN PLACE (never reassigned), so it is invisible to Svelte's reactivity and
  // cannot itself trigger a re-render (no loop).
  //
  // ⚠️ CACHE-VALIDITY CONTRACT (Unit 2.4 review): this memo is correct ONLY while (a) the
  // PATROLS defs are static consts (a def retune mid-session would not bust the key) AND (b)
  // an EquipmentInstance id fully determines its combat stats. Today (b) holds AND gear
  // durability is constant (never drops this patch), so the durability digest is a no-op.
  // But resolveBattle reads piece.durability and this epic is heading toward PERSISTENT
  // on-gear durability (see model.ts "never drops this patch" / weapons-as-gear notes): once
  // a worn/repaired weapon keeps its id but changes stats, an id-only key would go STALE.
  // Folding the durability digest into the signature NOW is cheap forward insurance so that
  // day cannot silently show a wrong band.
  //
  // The `state` arg is passed so the calling {@const} statically depends on `state` and
  // thus re-runs when a gear install/uninstall reassigns it (that is what lets the readout
  // refresh after a loadout change); the memo keeps that per-flush re-run cheap.
  const FORECAST_SEED = 0x5a4d; // fixed, display-only; deliberately NOT any live seed

  interface PatrolForecastReadout {
    rating: number;
    assessment: ThreatAssessment;
  }

  // One cache slot per patrol key: { signature, value }. A matching signature returns the
  // cached readout with no sim run; a changed signature recomputes and replaces the slot.
  // A `const` Map mutated via .set (never reassigned) so Svelte legacy reactivity never
  // tracks it (an in-place Map mutation is not an assignment), keeping it a pure memo.
  const patrolForecastCache = new Map<PatrolKey, { signature: string; value: PatrolForecastReadout }>();

  function patrolForecastFor(
    _state: typeof state, // referenced by the caller {@const} so a state change re-runs it
    patrolKey: PatrolKey,
    def: PatrolDef,
    ship: ShipInstance | null,
    hullType: CombatHullType | null,
    stance: CombatStance,
  ): PatrolForecastReadout | null {
    // Only a combat hull gets a readout (a patrol requires a combat hull anyway). No ship
    // or a non-combat hull -> no readout (the card simply omits the strip).
    if (ship === null || hullType === null) return null;

    // The ship's INSTALLED combat gear, read the SAME way the live dispatch reads it
    // (equippedFor off the current state), so the forecast's player combatant is geared
    // exactly like the real patrol's would be.
    const installedGear = equippedFor(state, ship.id);

    // TIGHT memo signature: everything that changes the forecast, and nothing that does
    // not. Gear ids capture install/uninstall (crafted pieces are immutable once minted,
    // so an id list identifies the loadout TODAY); stance + ship + patrol complete it. The
    // trailing per-gear DURABILITY digest is forward insurance (see the header's cache-
    // validity contract): durability is constant this patch so it never changes the key
    // now, but once on-gear durability persists (0.12.0 weapons-as-gear), a worn/repaired
    // piece keeps its id while its combat stats change, and only this digest would bust the
    // stale cache. Cheap to include now, no behavior change today.
    const gearIds = installedGear.map((g) => g.id).join(",");
    const durabilityDigest = installedGear.map((g) => g.durability).join(",");
    const signature = `${patrolKey}::${ship.id}::${stance}::${gearIds}::${durabilityDigest}`;
    const cached = patrolForecastCache.get(patrolKey);
    if (cached && cached.signature === signature) return cached.value;

    // MISS: run the display-only seeded forecast. The ship's static combat stats are shared
    // by both readouts below.
    const shipDef = SHIP_TYPES[ship.typeKey];

    // BATTLE RATING: the opponent-agnostic "how geared" scalar. Built via shipToCombatant
    // at FULL health (a loadout score, not a live-health score), which is exactly what the
    // rating wants. ⚠️ LOCKSTEP NOTE (Unit 2.4 review): this is the ONLY place the forecast
    // builds a player combatant directly from shipToCombatant; the WIN-RATE sim below builds
    // its per-wave player through the SHARED buildPatrolPlayerCombatant leaf (inside
    // resolvePatrolWaves). If a future unit adds a term to that shared player-build leaf
    // (e.g. a captain-skill modifier), THIS rating build must be updated in lockstep, or the
    // Battle Rating number silently drifts away from what the sim actually fights.
    const player = shipToCombatant({
      id: ship.id,
      team: "player",
      stats: shipDef,
      hullType,
      stance,
      installedGear,
    });
    const rating = battleRating(player);

    // THREAT ASSESSMENT: run DEFAULT_SAMPLES FULL-PATROL sims and count how many survive the
    // WHOLE wave cycle (not just one wave). The starting carry-state mirrors freshPatrolMission
    // exactly (full hull, full shield, the ship's installed-pod drones, no system wear), and
    // resolvePatrolWaves carries attrition between waves the SAME way the live loop does. A
    // sample is a WIN only if it never got defeated across all waves, so the "Guaranteed
    // Victory" crown now means "zero losses across the FULL patrol", not "zero losses in one
    // representative wave" (the multi-wave honesty fix).
    //
    // The drone id prefix and factionId are FIXED, display-only strings (never the live
    // master seed): factionId is def.factionId (the same pinned faction the live cycle
    // fights, so the enemy id -> turn-order is representative), and the drone prefix is a
    // forecast-scoped constant. Each sample's masterSeed is FORECAST_SEED + i, a deterministic
    // sweep off the fixed forecast seed, so the band is stable and never draws from live state.
    const startDrones = installedDronesForPatrol(installedGear, `forecast-${patrolKey}-p`);
    // Combat-defense BLOCKER fix (2026-08-27): THREAD installedGear into the durability seed. The live
    // seed (tick.ts freshPatrolMission) and the replay (patrolReplay.ts) both pass gear here; omitting
    // it clamped a crafted quality-4/5 weapon (durabilityMax up to 200) to the hull-default 100 on the
    // forecast's wave 1, opening it Degraded (<=60%) so the forecast fired at reduced damage while the
    // real patrol fired at full, biasing the band pessimistic. For a Standard-Issue set this is byte-
    // identical to the absent path (bridge.ts documents that equality on the live seed).
    const startSystemDurability = defaultSystemDurabilityForHull(hullType, shipDef, installedGear);
    // The FOLDED full hull/shield start pools (the SAME installed-gear fold the sim fights with, and the
    // SAME seed freshPatrolMission uses live), NOT the raw authored SHIP_TYPES stats. Byte-identical for
    // a Standard-Issue set; a crafted-plated/emitter ship now forecasts from its real folded pools.
    const startDefense = foldedPlayerDefense(shipDef, installedGear);
    let wins = 0;
    for (let i = 0; i < DEFAULT_SAMPLES; i++) {
      const result = resolvePatrolWaves({
        playerId: ship.id,
        stats: shipDef,
        hullType,
        stance,
        installedGear,
        masterSeed: FORECAST_SEED + i,
        factionId: def.factionId,
        def,
        startHull: startDefense.hullMax,
        startShield: startDefense.shieldMax,
        startDrones,
        startSystemDurability,
      });
      // A full-patrol WIN = survived every scheduled wave (never limped home defeated).
      if (!result.defeated) wins += 1;
    }
    const value: PatrolForecastReadout = { rating, assessment: threatAssessment(wins, DEFAULT_SAMPLES) };
    // In-place Map mutation (not a reassignment) so this write is invisible to Svelte's
    // reactivity and cannot re-trigger the render that is evaluating this {@const}.
    patrolForecastCache.set(patrolKey, { signature, value });
    return value;
  }

  // Captain-picker modal (mirrors openMissionPopup/closeMissionPopup): patrolPickerKey
  // holds which patrol card's picker is open. Selecting a captain records it under that
  // patrol's key and closes the modal (it does NOT dispatch, only the card's Dispatch
  // button does, exactly like the mission popup's two-step flow).
  function openPatrolPicker(patrolKey: PatrolKey) {
    patrolPickerKey = patrolKey;
  }
  function closePatrolPicker() {
    patrolPickerKey = null;
  }
  function selectPatrolCaptain(patrolKey: PatrolKey, captainId: number) {
    patrolCaptainByKey = { ...patrolCaptainByKey, [patrolKey]: captainId };
    patrolPickerKey = null;
  }

  // The actual dispatch, delegating to the pure dispatchCaptainOnPatrol (the single
  // source of truth for every gate). Mirrors doDispatchCaptainOnMission: capture the
  // captain label BEFORE the state swap, bail on failure (same-ref no-op), then log +
  // save on success. Clears this patrol's captain selection so the card resets to
  // "select a captain" (the captain is now busy and would fail the popup's idle filter
  // anyway); stance + repeat choices persist for the next dispatch.
  function doDispatchCaptainOnPatrol(patrolKey: PatrolKey) {
    const captainId = patrolSelectedCaptainId(patrolKey);
    if (captainId === null) return;
    const captain = state.captains.find((c) => c.id === captainId);
    if (!captain) return;
    const { next, success } = dispatchCaptainOnPatrol(
      state,
      captainId,
      patrolKey,
      patrolStanceFor(patrolKey),
      patrolRepeatFor(patrolKey),
    );
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Dispatched on patrol: ${PATROLS[patrolKey].label}.`);
    const { [patrolKey]: _cleared, ...rest } = patrolCaptainByKey;
    patrolCaptainByKey = rest;
    doSave();
  }

  // Maps a canDispatchPatrol PatrolDispatchBlockReason to a short player-facing string,
  // the patrol counterpart to dispatchBlockMessage. Wording matches the mockup where it
  // specifies one ("assign a combat hull first" for notCombatHull); the rest mirror the
  // extraction reason phrasings so the two dispatch surfaces read consistently.
  function patrolDispatchBlockMessage(reason: PatrolDispatchBlockReason): string {
    switch (reason) {
      case "noCaptain":
        return "No captain selected";
      case "busy":
        return "Captain is already on a mission";
      case "noShip":
        return "Captain has no ship assigned";
      case "notCombatHull":
        // Every hull is combat-capable now, so canDispatchPatrol only returns this for an
        // UNRECOGNIZED hull (a corrupt / hand-edited typeKey), never for a normal freighter.
        // The case stays for exhaustiveness (the reason union still carries the token); the
        // wording is neutral so a freighter never reads as "not a combat hull".
        return "Ship hull is not recognized";
      case "needsRepair":
        return "Ship is damaged, repair it first";
      case "noReactor":
        // Combat-defense rework (Unit 3): the ONLY hard combat-gear block. No reactor installed =
        // no power = the ship physically cannot set a course. Missing weapon/plating/shields are
        // NOT blocks now (weapon = a persistent advisory below; plating/shields = silent choices).
        return "Install a reactor first (no power)";
      case "fuelCapacity":
        return "Ship's tank too small for this trip";
      case "fuelEmpty":
        return "Not enough fuel or credits to refuel";
    }
    // Compile-time exhaustiveness guard (same discipline as PATROL_PHASE_LABEL and the
    // rest of this epic): every case above returns, so `reason` narrows to `never` here.
    // A future 8th PatrolDispatchBlockReason left unhandled would make `reason` non-never
    // and BREAK THE BUILD on this line, rather than silently hitting a text fallback.
    const _exhaustive: never = reason;
    return _exhaustive;
  }

  // Round-trip fuel cost for a patrol flown by a given ship, priced from the patrol's
  // two transit legs + the ship's EQUIPMENT-FOLDED engine efficiency, the SAME figure
  // canDispatchPatrol / dispatchCaptainOnPatrol spend (so the card's "fuel per run" can
  // never mislead). Mirrors how those functions overlay shipDerivedStats' engineEfficiency
  // onto the static ShipTypeDef before calling fuelForRoundTrip.
  function patrolFuelCost(patrolKey: PatrolKey, ship: GameState["ships"][number]): number {
    const def = PATROLS[patrolKey];
    const shipDef = SHIP_TYPES[ship.typeKey];
    const stats = shipDerivedStats(ship, equippedFor(state, ship.id));
    return fuelForRoundTrip(def.transitOutTicks, def.transitBackTicks, {
      ...shipDef,
      engineEfficiency: stats.engineEfficiency,
    });
  }

  function simulateOffline(hours: number) {
    const before = state;
    const secondsAway = hours * 3600;
    state = tick(secondsAway, before); // fleet-wide: advances every captain, matches real offline catch-up
    // Surface the SAME While-You-Were-Away recap the real reload path builds, using the SAME
    // pure diff helper, so this dev button exercises the offline summary end-to-end for a KNOWN
    // duration (verifiable numbers, screenshot-able). Unlike the real onMount path it does NOT
    // gate on hasContent, so pressing the button always shows what that duration produced (an
    // empty recap = nothing was running), giving clear QA feedback that the trigger fired.
    offlineSummary = summarizeOfflineProgress(before, state, secondsAway);
    pushLog(`[DEV] Simulated ${hours}h offline for the whole fleet.`);
  }

  // --- [DEV] Progression testing grants (Progression Pacing Rework) -------
  // These three buttons let the user device-test the new progression walls
  // (talents / captain-slot unlocks now require Fleet Admiral levels + admin
  // points; Captain Talents cost per-captain statPoints) WITHOUT grinding.
  // They mirror simulateOffline's shape exactly: mutate `state` immutably via
  // { ...state, ... } and pushLog a "[DEV] ..." line. They are RAW test grants,
  // NOT a model of real leveling, they intentionally bypass applyFleetAdminXp
  // / xp curves and just hand out the resources the walls check.

  // +5 Fleet Admiral Levels AND +5 admin points. Raising fleetAdminLevel by 5
  // clears the L5/L25 captain-slot-3/4 walls; granting adminPoints alongside it
  // mirrors natural leveling (which yields admin points) so the user can also
  // AFFORD the slot-unlock / homeworld talents, not just satisfy the level gate.
  // fleetAdminXp is reset to 0, a raw test grant, so we don't bother computing
  // the xp-toward-next-level for the new level; it simply starts the new level's
  // bar empty. Harmless: leveling only ever ADDS from here.
  function devGrantFleetAdminLevels() {
    state = {
      ...state,
      fleetAdminLevel: state.fleetAdminLevel + 5,
      adminPoints: state.adminPoints + 5,
      fleetAdminXp: new Decimal(0),
    };
    pushLog(`[DEV] +5 Fleet Admiral levels (now L${state.fleetAdminLevel}) and +5 admin points.`);
  }

  // +100 admin points only, lets the user afford homeworld talents / slot
  // unlocks in bulk without touching fleetAdminLevel (i.e. test the talent
  // PURCHASE flow independently of the level walls).
  function devGrantAdminPoints() {
    state = {
      ...state,
      adminPoints: state.adminPoints + 100,
    };
    pushLog(`[DEV] +100 admin points (now ${state.adminPoints}).`);
  }

  // +10 statPoints to the CURRENTLY-ACTIVE captain (state.captains[activeCaptainIndex],
  // the same reference the Captain Talents panel spends from), for testing
  // Captain Talents. Rebuilds the captains array immutably: only the active
  // captain object is replaced, every other captain reference is preserved.
  function devGrantStatPoints() {
    const idx = activeCaptainIndex;
    const captain = state.captains[idx];
    if (!captain) return; // defensive: no active captain (should never happen)
    const nextCaptains = state.captains.map((c, i) =>
      i === idx ? { ...c, statPoints: c.statPoints + 10 } : c
    );
    state = { ...state, captains: nextCaptains };
    pushLog(`[DEV] +10 stat points to ${captain.label} (now ${captain.statPoints + 10}).`);
  }

  // +`amount` credits, the base currency (a Decimal), so Refinery/Research/
  // Fabricator upgrades + fuel top-ups can be tested without grinding mission
  // payouts first. Raw test grant, same immutable { ...state } shape as the
  // grants above; credits only ever ADD here.
  function devGrantCredits(amount: number) {
    state = { ...state, credits: state.credits.plus(new Decimal(amount)) };
    pushLog(`[DEV] +${formatNumber(new Decimal(amount))} credits (now ${formatNumber(state.credits)}).`);
  }

  // Grant a stack of the craft-chain materials so the mine -> refine -> fabricate flow
  // can be tested without grinding the (scarce) upstream drops, especially the UNCOMMON
  // Polysilicate Ore. Adds raw ores + the refined mats + marks them discovered so they
  // render in the Warehouse. Same immutable { ...state } shape as the other dev grants.
  function devGrantMaterials() {
    const grants: Record<string, number> = {
      commonOre: 10000, // Titanium Ore (refines -> Titanium Ingot; also the facility-upgrade ore)
      uncommonMaterial: 10000, // Polysilicate Ore (refines -> Polysilicate Wafer)
      rareMaterial: 2000, // Iridium Ore
      deuteriumIce: 5000, // fuel feedstock
      titaniumIngot: 1000, // refined -> Fabricator input (frameSegment / structuralAssembly) + refinery upgrades
      polysilicateWafer: 1000, // refined -> Fabricator input (powerCoupling)
    };
    // Quality-bucketed (Task 9a): grant each material into its QUALITY-0 bucket via
    // addItemQuality (threaded immutably, each call returns a fresh inventory), the
    // bucketed twin of the old scalar clone + per-key `.plus()`. Dev grants land at
    // quality 0 like every deposit in this refactor.
    let inventory = state.inventory;
    for (const [itemId, amount] of Object.entries(grants)) {
      inventory = addItemQuality(inventory, itemId, new Decimal(amount), 0);
    }
    const discovered = [...new Set([...state.discovered, ...Object.keys(grants)])];
    state = { ...state, inventory, discovered };
    pushLog(`[DEV] Granted testing materials (raw ores + refined) for the craft chain.`);
  }

  // --- [DEV] Equipment 0.11.0 test controls (Equipment debug panel) ---------
  // A minimal, DEV_MODE-gated harness so the new ship-equipment system can be
  // exercised on a real device BEFORE the mockup-gated fitting UI is built. It
  // does NOT touch game logic: it only calls the real, already-tested helpers
  // (generateEquipment / canFitEquipment / fitEquipment / unfitEquipment) and
  // shows the real derived-stat projection. Three parts: a GRANT selector (mint
  // a spare piece into the pool), per-ship FIT / UNFIT controls, and a per-ship
  // BASE-vs-FITTED stats readout. All handlers mutate `state` immutably and then
  // doSave(), matching the do* handler idiom (the older devGrant* handlers lean
  // on the 30s autosave; we save eagerly so a device reload never loses a grant
  // or fit mid-test).

  // GRANT selector state: which live slot + variety the next [DEV] grant mints.
  // Seeded to the first live slot and its first variety so the selector is never
  // in an invalid state on first render.
  let devEqSlot: EquipmentSlotType = "cargoBay";
  let devEqVariety: string = EQUIPMENT_SLOTS.cargoBay.varieties[0].key;

  // Slot picker click: switch the selected slot AND reset the variety to that
  // slot's first variety, so devEqVariety can never dangle on a variety key that
  // does not belong to the newly-selected slot (which would make generateEquipment
  // throw). Explicit reset here instead of a reactive guard, to keep the data flow
  // one-directional and obvious (Alpha: readable over clever).
  function devSelectEqSlot(slot: EquipmentSlotType) {
    devEqSlot = slot;
    devEqVariety = EQUIPMENT_SLOTS[slot].varieties[0].key;
  }

  // Mint one spare EquipmentInstance for the selected slot/variety and add it to
  // the pool as a spare (fittedToShipId null, which generateEquipment already
  // sets). Defaults to a HIGH-VISIBILITY roll (rarity radiant, quality 5, iLevel
  // 400) so the base-vs-fitted stat delta is unmistakable on device. allocateId
  // mints "equip-N" from the GameState counter; we bump nextEquipmentId by one in
  // the same immutable transition, mirroring how nextShipId is spent on a build.
  // blueprintKey null = the craft-less baseline path; rng is Math.random (a live
  // roll, not a seeded test stream). Persists eagerly via doSave().
  function devGrantEquipment(slot: EquipmentSlotType, varietyKey: string) {
    // Task 20 retired the interim `?? 1` / `?? []` guards: the migration guarantees
    // nextEquipmentId + equipment on every loaded save, so they are read directly.
    const mintedId = "equip-" + state.nextEquipmentId;
    const piece = generateEquipment({
      slotType: slot,
      varietyKey,
      blueprintKey: null,
      iLevel: 400,
      quality: 5,
      rarity: "radiant",
      ascension: "none",
      rng: Math.random,
      allocateId: () => mintedId,
    });
    state = {
      ...state,
      equipment: [...state.equipment, piece],
      nextEquipmentId: state.nextEquipmentId + 1,
    };
    doSave();
    pushLog(`[DEV] Granted spare ${piece.id}: ${EQUIPMENT_SLOTS[slot].label} / ${varietyKey} (${piece.rarity} q${piece.quality}).`);
  }

  // --- [DEV] Combat 0.13.0 test battle (Debug tab only) --------------------
  // Runs the REAL combat engine on the player's current ship vs a hardcoded pirate
  // and renders the log into a dev readout block. This exercises the sim end-to-end
  // on-device BEFORE the mockup-gated combat UI (Phase 12) is built. It is STRICTLY
  // READ-ONLY on game state: it bridges a COPY of the ship's stats into a throwaway
  // Combatant and never writes back the battle's hull/shield damage. Nothing is
  // persisted (no doSave) and the player's real ship is untouched.

  // The rendered battle log lines (one string per line, incl. round dividers and
  // the outcome). Empty until the first run; shown in the [DEV BATTLE] readout.
  let devBattleLines: string[] = [];

  // How many of the log's lines the readout shows before collapsing the middle
  // (a long fight can produce hundreds of lines; we cap so the dev panel does not
  // grow unbounded). Head + tail are shown with a "... N more lines" marker.
  const DEV_BATTLE_HEAD = 40;
  const DEV_BATTLE_TAIL = 20;

  function devRunTestBattle() {
    // Pick the player's ship: the first in the fleet. No ship => nothing to test.
    const ship = state.ships[0];
    if (ship === undefined) {
      devBattleLines = ["[DEV BATTLE] No ship in the fleet to test with."];
      return;
    }
    const shipDef = SHIP_TYPES[ship.typeKey];
    const shipLabel = shipDef?.label ?? ship.typeKey;

    // Bridge the player's ship into a Combatant (a COPY of its stats; read-only).
    // Weapons are the illustrative sampleLoadout (the game has no fitted weapons
    // yet, see bridge.ts). team "player".
    const player = shipToCombatant({
      id: ship.id,
      team: "player",
      stats: shipDef,
      weaponLoadout: sampleLoadout("player"),
    });

    // A hardcoded pirate hull, team "enemy", with its own fresh sampleLoadout.
    // FIRST-PASS placeholder stats (this is a dev harness, not balance).
    const enemy = shipToCombatant({
      id: "pirate-raider",
      team: "enemy",
      stats: { hullIntegrity: 260, shieldCapacity: 120, shieldRecharge: 5 },
      weaponLoadout: sampleLoadout("pirate"),
    });

    // Seed: a fresh per-run seed off the clock, masked to 32 bits so it is a plain
    // integer the RNG accepts. Each click is a NEW battle; swap this for a fixed
    // literal (e.g. 12345) to replay the exact same fight while debugging.
    const seed = Date.now() & 0xffffffff;

    // Run the REAL sim with log generation on (LIVE watching path).
    const { outcome, log } = resolveBattle(
      { combatants: [player, enemy] },
      seed,
      { generateLog: true },
    );

    // Friendly names for the two combatants in the rendered lines.
    const nameFor = (id: string): string =>
      id === ship.id ? `${shipLabel} (you)` : id === "pirate-raider" ? "Pirate Raider" : id;

    // Render + label. Cap huge logs: show the head + tail with a collapsed marker
    // so a long fight never spams the readout unboundedly.
    const rendered = formatCombatLog(log, nameFor, outcome);
    let body = rendered;
    if (rendered.length > DEV_BATTLE_HEAD + DEV_BATTLE_TAIL) {
      const hidden = rendered.length - DEV_BATTLE_HEAD - DEV_BATTLE_TAIL;
      body = [
        ...rendered.slice(0, DEV_BATTLE_HEAD),
        `... ${hidden} more lines ...`,
        ...rendered.slice(rendered.length - DEV_BATTLE_TAIL),
      ];
    }
    devBattleLines = [
      `[DEV BATTLE] ${shipLabel} vs Pirate Raider (seed ${seed})`,
      ...body,
    ];
  }

  // Human-readable text for a blocked-fit reason token, so the dev panel can SHOW
  // why a fit is disabled instead of throwing or printing a bare enum. Total over
  // EquipFitBlockReason (a switch, no default) so a new reason token surfaces as a
  // compile error here rather than a silent "" (Omega 8 / 14).
  function devFitReasonText(reason: EquipFitBlockReason): string {
    switch (reason) {
      case "noInstance":
        return "piece no longer exists";
      case "noShip":
        return "ship no longer exists";
      case "onMission":
        return "captain is on a mission (install locked)";
      case "hullSpec":
        return "wrong hull type for this piece";
      case "captainSpec":
        return "captain spec does not match this piece";
      case "captainSpecParked":
        return "assign a matching captain first (hull is parked)";
      case "slotNotInstallable":
        return "this slot is not installable";
      case "hardpointsFull":
        return "all weapon hardpoints are full (uninstall a weapon first)";
      case "baysFull":
        return "all drone bays are full (uninstall a drone pod first)";
    }
  }

  // Compact one-line descriptor for a piece in the pool / a slot. The instance
  // does NOT persist its variety key, so we surface what it DOES carry (id, rarity,
  // quality, mass, power draw) plus the slot's signature implicit stat magnitude,
  // enough to tell two spares apart in the dev list.
  function devPieceDesc(p: EquipmentInstance): string {
    const implicitKeys = Object.keys(p.implicitStats);
    const sig = implicitKeys.length > 0 ? ` ${implicitKeys[0]}+${p.implicitStats[implicitKeys[0]].toFixed(1)}` : "";
    return `${p.id} ${p.rarity} q${p.quality}${sig} (mass ${p.mass.toFixed(0)}, draw ${p.powerDraw.toFixed(0)})`;
  }

  // Safe hull label for a ship id (falls back to the raw id if the ship or its
  // type def cannot be resolved), used only in the dev log messages below.
  function devShipLabel(shipId: string): string {
    const ship = state.ships.find((s) => s.id === shipId);
    return ship ? (SHIP_TYPES[ship.typeKey]?.label ?? shipId) : shipId;
  }

  // FIT a spare piece to a ship. Checks canFitEquipment FIRST (fitEquipment THROWS
  // on a blocked fit) and surfaces the reason to the log instead of throwing, then
  // fits + persists. Mirrors the do* idiom: reassign state, doSave, pushLog.
  function devFitEquipment(shipId: string, instanceId: string) {
    const gate = canFitEquipment(state, shipId, instanceId);
    if (!gate.ok) {
      pushLog(`[DEV] Cannot install ${instanceId}: ${devFitReasonText(gate.reason)}.`);
      return;
    }
    state = fitEquipment(state, shipId, instanceId);
    doSave();
    pushLog(`[DEV] Installed ${instanceId} on ${devShipLabel(shipId)}.`);
  }

  // UNFIT a ship's slot back to the pool. unfitEquipment THROWS on the on-mission
  // lock (caught here to surface the reason); otherwise it evicts the current
  // occupant to the pool AND auto-refits a fresh Standard-Issue baseline (the
  // never-empty invariant, Task 20), so it ALWAYS returns a new state, there is no
  // empty-slot no-op to special-case. Persists the swap.
  function devUnfitEquipment(shipId: string, slotType: EquipmentSlotType) {
    try {
      state = unfitEquipment(state, shipId, slotType);
      doSave();
      pushLog(`[DEV] Reset ${slotType} on ${devShipLabel(shipId)} to Standard-Issue.`);
    } catch (e) {
      pushLog(`[DEV] Cannot uninstall ${slotType}: ${(e as Error).message}`);
    }
  }

  // Readout formatting helpers (dev-only). shipDerivedStats returns PLAIN numbers
  // (not Decimals), so we format locally rather than via formatNumber. devEqPct
  // renders a multiplier / 0-based bonus as a percentage; devEqFlat renders a raw
  // capacity / mass / power figure.
  function devEqFlat(v: number): string {
    return v.toFixed(1);
  }
  function devEqPct(v: number): string {
    return (v * 100).toFixed(1) + "%";
  }

  // ── REAL Ship Systems screen (0.11.0 equipment fitting UI) ────────────────
  // The player-facing install/uninstall panel (ShipSystemsPanel.svelte), opened
  // as a modal over the current tab. Two entry points (the Docks ship list and
  // the Fleet Captain's Overview) open the SAME panel for a target shipId; this
  // one piece of state tracks which ship is open (null = closed). Unlike the
  // DEV_MODE harness above, this is NOT dev-gated, it is the shipped screen.
  let shipSystemsShipId: string | null = null;

  function openShipSystems(shipId: string) {
    shipSystemsShipId = shipId;
  }
  function closeShipSystems() {
    shipSystemsShipId = null;
  }

  // ── Combat View (Combat 0.13.0, Phase 12b Unit C) ─────────────────────────
  // The DISPLAY-ONLY "watch the combat" screen (CombatView.svelte), opened as a
  // modal from the View Combat Log button on an in-flight patrol. One piece of
  // state tracks which captain's patrol is open (null = closed). The view reads a
  // pure replay of that captain's current patrol and never mutates game state, so
  // opening / closing it is side-effect free. `combatViewCaptain` derives the live
  // captain from the id each render, so the streaming arena keeps advancing as the
  // patrol progresses under it.
  let combatViewCaptainId: number | null = null;
  function openCombatView(captainId: number) {
    combatViewCaptainId = captainId;
  }
  function closeCombatView() {
    combatViewCaptainId = null;
  }

  // Dismiss the While-You-Were-Away modal (Combat 0.13.0, Phase 13). Display-only:
  // it mutates no game state, so closing is side-effect free (the offline advance
  // already ran + persisted at load). Clearing the field to null closes the modal.
  function dismissOfflineSummary() {
    offlineSummary = null;
  }
  // The current CaptainState for the open combat view, re-resolved from state each
  // render, or null when the view should auto-close via the {#if combatViewCaptain
  // !== null} guard below. It resolves to null in two cases: the captain id no longer
  // matches a captain (defensive; captains are never removed today), OR the watched
  // captain is no longer on a patrol. A Dispatch-Once patrol sets mission -> null when
  // its single cycle completes (model.ts), which previously left the view open on the
  // patrol's now-dead wave pointers; nulling here closes it gracefully. A repeating
  // patrol relaunches into a fresh patrol mission atomically, so mission stays a patrol
  // across cycles and the view keeps streaming rather than flickering closed.
  $: combatViewCaptain = (() => {
    if (combatViewCaptainId === null) return null;
    const c = state.captains.find((cap) => cap.id === combatViewCaptainId) ?? null;
    if (c === null || c.mission === null || c.mission.kind !== "patrol") return null;
    return c;
  })();

  // INSTALL a spare system into a ship's slot. Same wiring idiom as the dev
  // harness's devFitEquipment (and every other do* handler): check the gate
  // FIRST (fitEquipment THROWS on a blocked fit), surface the reason to the log
  // instead of throwing, then reassign state immutably + persist eagerly via
  // doSave so a device reload never loses an install mid-session. The atomic
  // swap (evicting any current occupant back to the pool) is handled inside
  // fitEquipment. `installSystem`/`uninstallSystem` are the USER-FACING names;
  // they wrap the unchanged fitEquipment/unfitEquipment code helpers.
  function installSystem(shipId: string, instanceId: string) {
    const gate = canFitEquipment(state, shipId, instanceId);
    if (!gate.ok) {
      pushLog(`Cannot install system: ${devFitReasonText(gate.reason)}.`);
      return;
    }
    state = fitEquipment(state, shipId, instanceId);
    doSave();
    pushLog(`Installed system ${instanceId} on ${devShipLabel(shipId)}.`);
  }

  // UNINSTALL one specific installed system BY INSTANCE ID (Combat 1.0, Unit 1.8b).
  // The panel targets the exact piece the player tapped (required for weapons, a MULTI
  // slot). unfitEquipmentInstance THROWS on the on-mission lock (caught here); otherwise
  // every slot is now ALLOW-EMPTY and UNIFORM (user calls 2026-08-26): whatever you
  // uninstall, economy or combat, baseline or crafted, returns to storage as a
  // RE-INSTALLABLE spare and the slot is left empty. Nothing is destroyed or minted, so a
  // uninstalled system is never lost (the install picker re-offers it). Persists the change.
  function uninstallSystem(shipId: string, instanceId: string) {
    try {
      state = unfitEquipmentInstance(state, shipId, instanceId);
      doSave();
      pushLog(`Uninstalled system ${instanceId} on ${devShipLabel(shipId)}.`);
    } catch (e) {
      pushLog(`Cannot uninstall system: ${(e as Error).message}`);
    }
  }

  // MANUAL REPAIR trigger (Combat 1.0, QA #3). The Ship Systems panel's "Repair now"
  // button routes here. A damaged hull is already auto-repaired by processShipRepairs
  // every economyTick whenever a Shipyard bay is free; this runs the SAME pass NOW so
  // the player can kick a repair off immediately (up to a tick sooner) and, when every
  // bay is busy, get an explicit reason instead of silence. It adds VISIBILITY + a
  // manual trigger without replacing the auto-repair: it starts no more than the auto
  // pass would, respects the same free-bay accounting + deterministic queue order, and
  // needs NO new tick action (reuses the existing exported pass). A no-op (same state
  // reference) when nothing can start, in which case the ship stays queued.
  function repairShipNow(shipId: string) {
    state = processShipRepairs(state);
    doSave();
    const running = state.activeProcesses.some(
      (p) => p.kind === "shipRepair" && p.effect.type === "clearShipDamage" && p.effect.shipId === shipId,
    );
    pushLog(
      running
        ? `Repairing ${devShipLabel(shipId)} at the Shipyard.`
        : `No free Shipyard bay to repair ${devShipLabel(shipId)} yet; it will start when a bay frees.`,
    );
  }

  // RENAME (or clear) a ship's custom name (Renamable Ships). The Ship Systems panel's
  // click-to-edit title routes the RAW draft here. renameShip (the pure seam) trims it,
  // validates it against the SAME captain-name gate, and treats an empty/whitespace draft
  // as CLEARING the custom name back to the hull default. It returns the SAME state
  // reference when nothing changed (unknown id, a rejected charset/profanity name, or a
  // clear on an already-unnamed ship), so we save + log ONLY on a real change. We diff the
  // ship's DISPLAY name (custom name ?? hull label) so the log states what happened.
  function handleRenameShip(shipId: string, name: string) {
    const before = state.ships.find((s) => s.id === shipId);
    if (!before) return;
    const previousDisplay = before.name ?? SHIP_TYPES[before.typeKey]?.label ?? shipId;
    const next = renameShip(state, shipId, name);
    if (next === state) return; // no change (rejected / no-op / unknown id): skip save + log
    state = next;
    const after = next.ships.find((s) => s.id === shipId);
    const hullLabel = after ? SHIP_TYPES[after.typeKey]?.label ?? shipId : shipId;
    const cleared = after?.name === undefined; // empty draft dropped the custom name
    pushLog(
      cleared
        ? `[${previousDisplay}] Custom name cleared; now shown as ${hullLabel}.`
        : `[${previousDisplay}] Renamed to: ${after?.name}.`,
    );
    doSave();
  }

  // ── Ship Systems bay (Equipment 0.11.0 Phase D, Warehouse "Ship Systems" tab) ──
  // The bay shows the SPARE pool (fittedToShipId === null): spare crafted systems
  // plus any Standard-Issue baselines (dimmed). Fitted systems live on their ships
  // (managed in ShipSystemsPanel), so they are deliberately NOT listed here. The
  // four LIVE slots are shown in a fixed order so the grouped grid is stable.
  const BAY_SLOT_ORDER: EquipmentSlotType[] = [
    "cargoBay", "ftlDrive", "reactorCore", "specUtility",
    // Combat 1.0 (BUG-U1): crafted combat gear IS ship equipment and must show in this bay too, it
    // was invisible while this list was economy-only. shieldEmitters/hullPlating carry EQUIPMENT_SLOTS
    // labels; weapon + droneBay live in separate tables (WEAPON_DEFS / drone roles) so they take a
    // display label from BAY_SLOT_LABEL_FALLBACK below.
    "weapon", "shieldEmitters", "hullPlating", "droneBay",
  ];
  // Display-label fallback for the combat slots not present in EQUIPMENT_SLOTS.
  const BAY_SLOT_LABEL_FALLBACK: Partial<Record<EquipmentSlotType, string>> = {
    weapon: "Weapons",
    droneBay: "Drone Bays",
  };

  // The tile the player has selected -> its EquipmentTooltip is surfaced inline
  // below the grid. null = nothing selected (grid only). Cleared whenever the
  // selected piece leaves the pool (salvaged) or the tab changes.
  let selectedSystemId: string | null = null;

  // The spare pool, guarded like ShipSystemsPanel's render-boundary `?? []` (a
  // partially-migrated state should degrade to an empty bay, not white-screen).
  $: baySpareSystems = (state.equipment ?? []).filter((e) => e.fittedToShipId === null);

  // The spare pool grouped by slot type, in BAY_SLOT_ORDER; empty groups dropped
  // so a slot with no spare systems shows no header. Each group carries the slot's
  // display label (single source: EQUIPMENT_SLOTS) for its section heading.
  $: baySystemGroups = BAY_SLOT_ORDER.map((slot) => ({
    slot,
    label: EQUIPMENT_SLOTS[slot]?.label ?? BAY_SLOT_LABEL_FALLBACK[slot] ?? slot,
    pieces: baySpareSystems.filter((p) => p.slotType === slot),
  })).filter((g) => g.pieces.length > 0);

  // The resolved selected piece (or null). Reactive on the pool, so if the
  // selected piece is salvaged the tooltip auto-hides even without an explicit
  // clear. Fitted pieces are absent from this list entirely (spares only), so EVERY
  // spare in this bay has an active removal action: a CRAFTED spare (blueprintKey set)
  // SALVAGES for a fraction of its materials, and a Standard-Issue baseline (blueprintKey
  // null, combat OR economy) is DESTROYED as a zero-reward declutter (the always-available
  // storage escape valve). The two only differ in the action LABEL / helper text below,
  // decided by selectedIsBaseline, not by whether removal is allowed.
  $: selectedSystem =
    selectedSystemId !== null ? baySpareSystems.find((p) => p.id === selectedSystemId) ?? null : null;
  // A Standard-Issue baseline (no blueprint) is DESTROYED (zero reward); a crafted piece
  // is SALVAGED (returns components). Drives the button label + helper text below.
  $: selectedIsBaseline = selectedSystem !== null && selectedSystem.blueprintKey === null;

  // Toggle a tile's selection (clicking the open tile closes it), matching the
  // slot-select toggle idiom ShipSystemsPanel uses.
  function selectSystemTile(instanceId: string) {
    selectedSystemId = selectedSystemId === instanceId ? null : instanceId;
  }

  // Human sentence for a salvage REJECT reason. Exhaustive over SalvageRejectReason
  // (a switch, no default) so a new reason is a compile error here. From the bay's
  // system salvage only notFound / fitted are reachable (a spare baseline, combat or
  // economy, is DESTROYED as a declutter rather than rejected); the salvaged-material and
  // ship reasons are covered for totality.
  function salvageRejectText(reason: SalvageRejectReason): string {
    switch (reason) {
      case "notFound":
        return "that system no longer exists";
      case "fitted":
        return "the system is installed on a ship (uninstall it first)";
      case "noRecipe":
        return "that system has no recipe to break down (nothing to recover)";
      case "notSalvagedMaterial":
        return "that item is not a salvaged material";
      case "noneHeld":
        return "none of that material is held";
      case "shipNotFound":
        return "that ship no longer exists";
      case "shipOnMission":
        return "the ship's captain is on a mission (recall first)";
      case "lastShip":
        return "your fleet would be left with no hull (this is your last ship)";
    }
  }

  // ── Salvage RESULT readout (0.11.2 Task 12) ───────────────────────────────
  // The MOST RECENT Salvage Bay outcome, captured off the existing handler results
  // so the Salvage Bay can render a "here is what you got" panel in ADDITION to the
  // event-log line (which still fires). `kind` distinguishes the two surfaces:
  // "system" is a spare-system recycle (materials only), "material" is a
  // salvaged-material loot roll (materials + a rolled tier). `recovered` is the
  // positive-amount entries only (the same filter the log summary uses). null when
  // nothing has been salvaged this visit; cleared on leaving the Salvage Bay.
  // "baseline" is a Standard-Issue declutter (removed, zero reward); it renders a
  // "discarded" readout distinct from a crafted recycle's "recovered nothing (rounded)".
  type LastSalvageResult = {
    kind: "system" | "material" | "baseline";
    sourceName: string;
    recovered: { itemId: string; amount: number }[];
    rolledTier?: string;
  };
  let lastSalvageResult: LastSalvageResult | null = null;

  // SALVAGE a spare crafted system. salvageEquipment returns a SalvageResult
  // (same-ref no-op + reason on reject; new state + recovered map on success).
  // On success: reassign state, clear the selection if it was this piece, log the
  // recovered materials ([Item] convention), and persist, the standard do* idiom.
  function doSalvageEquipment(instanceId: string) {
    // Resolve a readable source name BEFORE the salvage consumes the spare: after
    // state = result.next the piece is gone, so systemSalvageName (the slot + variety
    // label the confirm modal shows) must be read now. Fall back to the raw id if the
    // piece is somehow absent (e.g. a hand-edited save).
    const salvagedPiece = state.equipment.find((e) => e.id === instanceId);
    // A Standard-Issue baseline (blueprintKey null) salvages as a zero-reward declutter,
    // so its readout/log say "discarded", not "recovered nothing". Read the flag BEFORE
    // the salvage consumes the piece.
    const wasBaseline = salvagedPiece?.blueprintKey === null;
    const salvagedName = salvagedPiece ? systemSalvageName(salvagedPiece) : instanceId;
    const result = salvageEquipment(state, instanceId);
    if (!result.ok) {
      pushLog(`Cannot salvage system: ${salvageRejectText(result.reason)}.`);
      return;
    }
    state = result.next;
    if (selectedSystemId === instanceId) selectedSystemId = null;
    if (wasBaseline) {
      // Declutter: nothing recovered, so log + readout report a discard.
      pushLog(`Discarded Standard-Issue ${salvagedName} (no materials recovered).`);
      lastSalvageResult = { kind: "baseline", sourceName: salvagedName, recovered: [] };
      doSave();
      return;
    }
    // The positive recoveries (0-amount inputs omitted) as structured entries, the
    // SINGLE source both the log summary and the Task 12 result panel read from.
    const positive = Object.entries(result.recovered)
      .filter(([, amount]) => amount > 0)
      .map(([itemId, amount]) => ({ itemId, amount }));
    // Build a "N [Item], M [Item]" summary of the positive recoveries for the log.
    const parts = positive.map(({ itemId, amount }) => `${amount} [${ITEMS[itemId]?.label ?? itemId}]`);
    const summary = parts.length > 0 ? parts.join(", ") : "no materials (recovery rounded to zero)";
    pushLog(`Salvaged system ${instanceId} → recovered ${summary}.`);
    // Capture the outcome for the Salvage Bay result panel (in addition to the log).
    lastSalvageResult = {
      kind: "system",
      sourceName: salvagedName,
      recovered: positive,
    };
    doSave();
  }

  // SALVAGE a whole hull from the Docks. salvageShip returns a SalvageShipResult (same-ref
  // no-op + reason on reject: shipNotFound / shipOnMission; new state + recovered map +
  // creditsRecovered on success). On success: reassign state, log the recovered materials +
  // credits + how many CRAFTED systems returned to the spare pool (baselines are discarded,
  // so they are not counted), and persist, the standard do* idiom. This is INSTANT this patch
  // (a future task makes hull teardown a timed process, see salvage.ts).
  function doSalvageShip(shipId: string) {
    // Snapshot the crafted systems fitted to this hull BEFORE the salvage so the log can
    // report how many survive as spares (the result does not carry that count, and after the
    // salvage they are no longer fitted to this ship). Baselines (blueprintKey null) are
    // discarded, so they are excluded from the tally.
    const returnedSystems = state.equipment.filter(
      (e) => e.fittedToShipId === shipId && e.blueprintKey !== null
    ).length;
    const shipLabel = devShipLabel(shipId);

    const result = salvageShip(state, shipId);
    if (!result.ok) {
      pushLog(`Cannot salvage ship: ${salvageRejectText(result.reason)}.`);
      return;
    }
    state = result.next;
    // Build the same "N [Item]" material summary the system salvage uses (0-amount
    // components omitted so the log names only what was actually returned).
    const parts = Object.entries(result.recovered)
      .filter(([, amount]) => amount > 0)
      .map(([itemId, amount]) => `${amount} [${ITEMS[itemId]?.label ?? itemId}]`);
    if (result.creditsRecovered > 0) parts.push(`${formatNumber(new Decimal(result.creditsRecovered))} credits`);
    const summary = parts.length > 0 ? parts.join(", ") : "no materials (recovery rounded to zero)";
    const systemsNote = returnedSystems > 0 ? ` ${returnedSystems} crafted system(s) returned to spares.` : "";
    pushLog(`Salvaged ${shipLabel} → recovered ${summary}.${systemsNote}`);
    doSave();
  }

  // ── Salvage confirmation guard (device-test feedback) ─────────────────────
  // A salvage PERMANENTLY destroys the item, so BOTH salvage entry points (the Ship
  // Systems tab's Salvage button and the Salvaged Materials tab's Salvage button) route
  // through a plain Cancel/Confirm modal FIRST, reusing the exact DELETE-SAVE /
  // homeworld-respec modal idiom (.modal-backdrop / Panel.modal-dialog / .modal-warning
  // / .modal-row + focusTrap). The modal itself stays a plain Cancel/Confirm dialog (no
  // in-modal checkbox); WHETHER it opens is now gated per quality tier by the Salvage Bay
  // Options control (0.11.2 Task 13b, requestSalvage above): a tier the player has
  // unchecked salvages instantly, skipping this modal. Ship teardown always confirms.
  //
  // The pending target is a small DISCRIMINATED record ({ kind, id, name }), NOT a stored
  // closure: confirmSalvage switches on `kind` and calls the matching handler, which reads
  // clearly and keeps the two id types (a system instanceId vs a salvaged-material itemId)
  // from ever being confused. `name` is captured at request time purely to name the item
  // in the warning line.
  // `kind` now also covers "ship" (0.11.0 ship-salvage): the Docks Salvage button breaks
  // down a whole hull. The three kinds keep their three id vocabularies from being confused
  // (a system instanceId vs a salvaged-material itemId vs a ship id) and route confirmSalvage
  // to the matching handler.
  let salvageConfirm: { kind: "system" | "material" | "ship"; id: string; name: string } | null = null;

  // The display name a spare system shows in the salvage-confirm dialog and result
  // readout. A CRAFTED spare uses its slot + variety label (equipmentOutputLabel, the
  // SAME label the fabricate readout uses). A Standard-Issue baseline has no blueprint,
  // so it reads as "Standard-Issue <slot label>" (e.g. "Standard-Issue Cargo Bay"). The
  // final fallback keeps a hand-edited save from throwing.
  function systemSalvageName(piece: EquipmentInstance): string {
    if (piece.blueprintKey === null) {
      return `Standard-Issue ${EQUIPMENT_SLOTS[piece.slotType]?.label ?? piece.slotType}`;
    }
    const bp = BLUEPRINTS[piece.blueprintKey];
    // Combat 1.0 (Unit 1.2b + 2.1b): a crafted WEAPON or DRONE-POD spare reads as its stripped
    // blueprint name (no slot/variety); an economy system reads as its slot + variety label; the
    // final fallback keeps a hand-edited save from throwing.
    if (bp?.weaponOutput || bp?.droneOutput) return craftedInstanceBlueprintLabel(bp);
    const eqOut = bp?.equipmentOutput;
    return eqOut ? equipmentOutputLabel(eqOut) : "this system";
  }

  // ── Per-quality confirm preference (0.11.2 Task 13b) ──────────────────────
  // The set of quality tiers that REQUIRE a confirm before salvaging, loaded from
  // localStorage (loadSalvageConfirmQualities), NOT on GameState, exactly like
  // refineConfirmEnabled above. The default is ALL tiers (confirm everything). The
  // Salvage Bay Options control below toggles individual tiers on/off; toggling
  // persists immediately via saveSalvageConfirmQualities. Loaded on mount.
  let salvageConfirmQualities: number[] = loadSalvageConfirmQualities();

  // Map a salvaged material's ItemRarity (model.ts: "common" | "uncommon" | "rare" |
  // "epic" | "legendary") to a quality-tier index so the per-quality confirm preference
  // (which is keyed on the 0..QUALITY_TIERS-1 tiers spare SYSTEMS use) can gate material
  // salvage too. Salvaged materials carry a `rarity` string, NOT a numeric quality, so
  // this documented, order-preserving map bridges the two vocabularies:
  //   common -> 0, uncommon -> 1, rare -> 2, epic -> 3, legendary -> 4
  // (Materials top out at legendary -> tier 4; tier 5 is reachable only by systems, so a
  // material never maps to it. An unrecognized rarity falls back to 0, the safest tier to
  // treat as "confirm by default" under the all-tiers default.)
  const RARITY_TO_QUALITY_TIER: Record<string, number> = {
    common: 0,
    uncommon: 1,
    rare: 2,
    epic: 3,
    legendary: 4,
  };

  // Does salvaging THIS target need a confirm, given the player's per-quality preference?
  //   - "system": look up the spare EquipmentInstance by its instanceId and read its
  //     numeric `quality` (0..5); a missing piece (hand-edited save) is treated as needing
  //     a confirm, the safe default.
  //   - "material": map the salvaged material's rarity to a tier via RARITY_TO_QUALITY_TIER
  //     (unknown rarity -> tier 0), then check that tier.
  //   - "ship": ALWAYS true. Hull teardown is a large, captain-aboard-warned action; the
  //     per-quality skip deliberately does NOT apply to it (unchanged behavior).
  function salvageTargetNeedsConfirm(kind: "system" | "material" | "ship", id: string): boolean {
    if (kind === "ship") return true;
    if (kind === "system") {
      const piece = state.equipment.find((e) => e.id === id);
      if (!piece) return true; // safe default: confirm a target we cannot inspect
      return salvageNeedsConfirm(piece.quality);
    }
    // material
    const rarity = ITEMS[id]?.rarity;
    const tier = rarity !== undefined ? (RARITY_TO_QUALITY_TIER[rarity] ?? 0) : 0;
    return salvageNeedsConfirm(tier);
  }

  // Request a salvage. If the target's quality tier is in the player's confirm set, open
  // the confirm modal (Nothing is destroyed until Confirm; Cancel clears the pending
  // target). Otherwise EXECUTE IMMEDIATELY through the SAME do* handler the modal would
  // dispatch to (so the result readout + event-log line still fire), skipping the modal.
  // Ship teardown always confirms (salvageTargetNeedsConfirm returns true for "ship").
  function requestSalvage(kind: "system" | "material" | "ship", id: string, name: string) {
    if (!salvageTargetNeedsConfirm(kind, id)) {
      // Direct-execute path: route through the same handler confirmSalvage would call.
      if (kind === "system") doSalvageEquipment(id);
      else if (kind === "ship") doSalvageShip(id);
      else doSalvageSalvagedMaterial(id);
      return;
    }
    salvageConfirm = { kind, id, name };
  }

  // Toggle one quality tier in the confirm set (checked = confirm required), then persist.
  // Rebuilds the array (rather than mutating in place) so the `salvageConfirmQualities`
  // reassignment triggers Svelte reactivity for the Options checkboxes.
  function toggleSalvageConfirmTier(tier: number, needsConfirm: boolean) {
    salvageConfirmQualities = needsConfirm
      ? [...salvageConfirmQualities.filter((t) => t !== tier), tier]
      : salvageConfirmQualities.filter((t) => t !== tier);
    saveSalvageConfirmQualities(salvageConfirmQualities);
  }
  function cancelSalvageConfirm() {
    salvageConfirm = null;
  }
  // Confirm: dispatch to the matching existing handler by `kind`, then clear. Snapshot the
  // pending target FIRST so clearing it can't race the dispatch.
  function confirmSalvage() {
    const pending = salvageConfirm;
    salvageConfirm = null;
    if (pending === null) return;
    if (pending.kind === "system") doSalvageEquipment(pending.id);
    else if (pending.kind === "ship") doSalvageShip(pending.id);
    else doSalvageSalvagedMaterial(pending.id);
  }

  // Ship salvage that would orphan a captain: only an on-mission ship is BLOCKED (onMissionLock),
  // but salvaging a hull an IDLE captain is assigned to silently leaves that captain ship-less
  // (device-test feedback). So the confirm modal names them, the destroy stays the player's
  // informed choice, not a surprise. null for a non-ship target or a captain-less hull.
  $: salvageShipCaptainWarning = (() => {
    const sc = salvageConfirm;
    if (sc === null || sc.kind !== "ship") return null;
    const ship = state.ships.find((s) => s.id === sc.id);
    if (!ship || ship.assignedCaptainId === null) return null;
    return state.captains.find((c) => c.id === ship.assignedCaptainId)?.label ?? "its captain";
  })();

  // Start the next Systems Bay storage rung. startEquipmentStorageUpgrade returns
  // { next, started } (like startFacilityUpgrade); on any failed gate it is a
  // same-ref no-op, so we destructure `started` and bail without a spurious log.
  function doUpgradeEquipmentBay() {
    const { next, started } = startEquipmentStorageUpgrade(state);
    if (!started) return;
    state = next;
    pushLog("Systems Bay expansion started.");
    doSave();
  }

  // Start the next Docks expansion rung. startDocksExpansion returns { next, started }
  // (like startEquipmentStorageUpgrade); on any failed gate it is a same-ref no-op, so
  // we destructure `started` and bail without a spurious log.
  function doExpandDocks() {
    const { next, started } = startDocksExpansion(state);
    if (!started) return;
    state = next;
    pushLog("Docks expansion started.");
    doSave();
  }

  // ── Salvaged Materials tab (0.11.0 Task C2 UI) ────────────────────────────
  // The currently-selected salvaged-material item id (the tile whose Salvage action
  // is shown), or null. Distinct from selectedSystemId (that selects a non-stacking
  // EquipmentInstance; this selects a stackable ITEM id from the quality-bucketed
  // inventory), so the two tabs never fight over one selection variable.
  let selectedSalvagedId: string | null = null;

  // Toggle a salvaged-material tile's selection (click the open tile to close it),
  // the SAME toggle idiom selectSystemTile uses.
  function selectSalvagedTile(itemId: string) {
    selectedSalvagedId = selectedSalvagedId === itemId ? null : itemId;
  }

  // The salvaged-material Salvage action lives ONLY in the Salvage Bay facility
  // (Foundry rail, activeFoundryFacility === "salvageBay"; salvaging is a FACILITY
  // action per the user decision 2026-07-21). The Materials tab shows salvaged
  // tiles browse-only. So the clear is keyed to the Foundry salvage surface:
  // switching the Foundry rail away from the Salvage Bay, or leaving the Foundry
  // tab entirely, clears any pending salvaged selection, avoiding a stale inline
  // Salvage action panel. Referencing activeFoundryFacility + activeTab makes this
  // reactive; the initial run is a harmless null -> null. Placed AFTER the
  // selectedSalvagedId declaration so it is never used before it is declared.
  // (0.12.0 Console, CN4a: also depend on facilitiesView so leaving the Salvage
  //  Bay console back to the Facilities dashboard clears the selection too.)
  $: activeFoundryFacility, activeTab, facilitiesView, (selectedSalvagedId = null);

  // Task 12: the salvage result readout is a per-visit status, so switching the
  // Foundry rail away from the Salvage Bay (or leaving the Foundry tab) clears it,
  // no stale "Last salvage" panel lingers elsewhere (or on a fresh return to the
  // facility). Same reactive idiom as the selection clear above; the initial run
  // is a harmless null -> null.
  $: activeFoundryFacility, activeTab, facilitiesView, (lastSalvageResult = null);

  // SALVAGE one unit of a salvaged material for a tiered loot roll. salvageSalvagedMaterial
  // returns a SalvageResult: on reject a same-ref no-op + reason (noneHeld / notSalvagedMaterial),
  // on success a new state + `recovered` (the deposited amount) + `rolled` (the drop's
  // item/tier/quality). On success: reassign state, log the roll ("Salvaged <source>:
  // <drop> xN (<Tier>)"), and persist, the standard do* idiom. Reuses salvageRejectText for
  // the reject sentence (it already covers both salvaged-material reasons).
  function doSalvageSalvagedMaterial(itemId: string) {
    const result = salvageSalvagedMaterial(state, itemId);
    if (!result.ok) {
      pushLog(`Cannot salvage material: ${salvageRejectText(result.reason)}.`);
      return;
    }
    state = result.next;
    // `rolled` is present on this (salvaged-material) path; guard for totality since the
    // SalvageResult type marks it optional (the equipment-recycle path omits it).
    const roll = result.rolled;
    if (roll) {
      const srcLabel = ITEMS[itemId]?.label ?? itemId;
      const dropLabel = ITEMS[roll.itemId]?.label ?? roll.itemId;
      // Amount deposited (always 1 today) read from `recovered` so the log can't drift
      // from what actually entered inventory.
      const amount = result.recovered[roll.itemId] ?? 1;
      // Title-case the raw rarity token ("stellar" -> "Stellar") for the readout.
      const tierLabel = roll.tier.charAt(0).toUpperCase() + roll.tier.slice(1);
      pushLog(`Salvaged ${srcLabel}: ${dropLabel} x${amount} (${tierLabel}).`);
      // Capture the outcome for the Salvage Bay result panel (in addition to the log).
      // `recovered` here is the single deposited drop; reuse the same positive-amount
      // filter as the system path so the panel shows exactly what entered inventory.
      lastSalvageResult = {
        kind: "material",
        sourceName: srcLabel,
        recovered: Object.entries(result.recovered)
          .filter(([, amt]) => amt > 0)
          .map(([rid, amt]) => ({ itemId: rid, amount: amt })),
        rolledTier: tierLabel,
      };
    }
    doSave();
  }

  // (doCraftRecipe, the legacy instant Homeworld craft-button handler, was
  //  RETIRED in Phase 4, Task F5 along with the RECIPES panel it drove. Crafting
  //  is now the Fabricator facility panel's timed order controls.)

  // Facility Framework + Refinery (Phase 1, Task 12 UI), the Facilities-tab
  // action wrapper. Follows the SAME reassign-`state` + pushLog + doSave idiom
  // every other do* handler uses, with ONE difference: startFacilityUpgrade
  // returns { next, started } (not { next, success }), so we destructure
  // `started` and bail on a same-reference no-op exactly as the backend's reject
  // convention intends, no duplicate gate logic in the UI layer (the button's
  // `disabled` already mirrors the backend gate for the common case; this bail
  // covers the race/edge where state changed since render).
  // (doStartRefineJob, the one-shot manual refine start, was RETIRED in S4;
  //  the per-slot Production configurator drives refining now, via startLine /
  //  doStartLine below.)

  // ── Production LINES (Crafting Allocation Redesign, Task C4) ───────────────
  // The per-slot configurator handlers shared by BOTH facilities (Refinery + Fabricator).
  // A line is created ONLY here, on Start; the configurator form (openConfig/cfgTier/
  // cfgRecipeKey/cfgQty) holds the selection until then.

  // Open the idle-slot configurator for `kind`'s `slotIndex`, seeding sensible defaults so
  // the form is immediately usable. Only ONE configurator is open at a time (opening one
  // replaces any other). Refine has no tiers -> tier 1; fabricate seeds the first AVAILABLE
  // tier (researched + tier-reached). The recipe defaults to the first item in that tier, and
  // qty resets to 1 (the safe floor; the field clamps up to the affordable cap).
  function openConfigurator(kind: CraftLineKind, slotIndex: number) {
    openConfig = { kind, slotIndex };
    cfgQty = 1;
    if (kind === "refine") {
      cfgTier = 1; // REFINE_RECIPES carry no tier -> a single synthetic "Tier 1"
      cfgRecipeKey = Object.keys(REFINE_RECIPES)[0] ?? "";
    } else {
      const tiers = availableFabricateTiers;
      cfgTier = tiers[0] ?? 1;
      cfgRecipeKey = fabricateKeysForTier(cfgTier)[0] ?? "";
    }
  }

  // Collapse whatever configurator is open (idle-slot "cancel"/after a start). Leaves the
  // form values as-is; the next openConfigurator reseeds them.
  function closeConfigurator() {
    openConfig = null;
  }

  // Fabricate tier changed in the dropdown: point the item dropdown at the first blueprint of
  // the newly-selected tier so cfgRecipeKey never dangles on a tier that no longer lists it.
  function onFabricateTierChange(tier: number) {
    cfgTier = tier;
    cfgRecipeKey = fabricateKeysForTier(tier)[0] ?? "";
  }

  // doStartLine is the SINGLE entry point every configurator Start button calls. Mirrors the
  // sibling do* commit idiom but routes through the optional confirm first: if
  // refineConfirmEnabled is on, stash the pending line + open the modal (Confirm commits);
  // otherwise commit straight away. `mode` is the batch/continuous run-mode (the configurator
  // only builds batch; continuous is engine-supported but not surfaced by this UI).
  function doStartLine(kind: CraftLineKind, recipeKey: string, mode: CraftLineMode) {
    if (refineConfirmEnabled) {
      pendingLineStart = { kind, recipeKey, mode };
      refineConfirmDontShowAgain = false; // fresh checkbox each time the modal opens
      refineConfirmModalOpen = true;
    } else {
      commitStartLine(kind, recipeKey, mode);
    }
  }

  // Actually appends the line via the pure backend fn, logs it, saves, the EXACT sibling
  // commit idiom (const { next, started } = fn(...); if (!started) return; state = next; log;
  // save). startLine gates on canStartLine and returns { next, started, reason? }; on any block
  // it returns the SAME state ref + started:false, so the bail is a clean no-op (the Start
  // button's own disabled state already mirrors canStartLine, so a block here only covers a
  // race). On success we collapse the configurator (its work is done). The log names the
  // recipe's OUTPUT item (bracketed, per the [Item] convention).
  // Equipment 0.11.0 (Task 19): the SYSTEM name a fabricate craft-line shows for an EQUIPMENT
  // blueprint's output, its slot + variety label (e.g. "Cargo Bay · Prospector Hold"). An
  // equipment blueprint carries no recipe.outputItem (optional, omitted). Reads the SAME EQUIPMENT_SLOTS table the
  // dev-grant readout uses; falls back to the raw keys if a variety key is ever unrecognized.
  function equipmentOutputLabel(eq: { slotType: EquipmentSlotType; varietyKey: string }): string {
    const slot = EQUIPMENT_SLOTS[eq.slotType];
    const variety = slot?.varieties.find((v) => v.key === eq.varietyKey);
    return `${slot?.label ?? eq.slotType} · ${variety?.label ?? eq.varietyKey}`;
  }

  // Combat 1.0 (Unit 1.2b + 2.1b): the player-facing NAME a WEAPON or DRONE-POD blueprint crafts,
  // the parallel to equipmentOutputLabel for the two separate-table instance shapes. Neither a
  // weapon nor a drone blueprint carries a slot/variety, so the readable name is its blueprint label
  // with the trailing " Blueprint" stripped (labels are authored as "<Name> Blueprint", so this
  // yields "Autocannon", "Point-Defense Array", "Attack Drone Pod", etc.). One helper for both
  // because the derivation is identical; the call sites select it via `weaponOutput || droneOutput`.
  // Shared by every fabricate/research/warehouse readout that labels a crafted weapon or pod.
  function craftedInstanceBlueprintLabel(bp: { label: string }): string {
    return bp.label.replace(/ Blueprint$/, "");
  }

  function commitStartLine(kind: CraftLineKind, recipeKey: string, mode: CraftLineMode) {
    const { next, started } = startLine(state, kind, recipeKey, mode);
    if (!started) return;
    state = next;
    // Task 19: an EQUIPMENT blueprint logs its minted piece's SYSTEM name (slot + variety); it
    // carries no output item. Combat 1.0 (Unit 1.2b + 2.1b): a WEAPON or DRONE-POD blueprint logs
    // its stripped blueprint name. Refine + material lines log the output item as before.
    const fabBp = kind === "fabricate" ? BLUEPRINTS[recipeKey] : undefined;
    const eqOut = fabBp?.equipmentOutput;
    const outputId =
      kind === "refine"
        ? REFINE_RECIPES[recipeKey]?.output.itemId ?? recipeKey
        : BLUEPRINTS[recipeKey]?.recipe.outputItem ?? recipeKey;
    const outputLabel = fabBp?.weaponOutput || fabBp?.droneOutput
      ? craftedInstanceBlueprintLabel(fabBp)
      : eqOut
        ? equipmentOutputLabel(eqOut)
        : ITEMS[outputId]?.label ?? outputId;
    const verb = kind === "refine" ? "Refine" : "Fabricate";
    const desc = mode.kind === "batch" ? `×${mode.remaining}` : "continuous";
    pushLog(`${verb} line started (${desc}) → [${outputLabel}].`);
    closeConfigurator();
    doSave();
  }

  // Modal Confirm: if the don't-show-again box was ticked, disable the pref FIRST (persist it
  // exactly like tickBarEnabled), then commit the held line and close. Guards on pendingLineStart
  // being set (it always is when the modal is open, but the null-check keeps TS happy).
  function confirmLineStart() {
    if (pendingLineStart === null) return;
    if (refineConfirmDontShowAgain) {
      refineConfirmEnabled = false;
      saveRefineConfirmEnabled(false);
    }
    commitStartLine(pendingLineStart.kind, pendingLineStart.recipeKey, pendingLineStart.mode);
    refineConfirmModalOpen = false;
    pendingLineStart = null;
  }

  // Modal Cancel: drop the held line, close, reset the checkbox. Starts nothing.
  function cancelLineStart() {
    refineConfirmModalOpen = false;
    pendingLineStart = null;
    refineConfirmDontShowAgain = false;
  }

  // Cancel (remove) an active line. cancelLine drops the line + releases its UNSTARTED
  // reservation (allocation is derived, so fewer lines = less allocated, no ledger to unwind);
  // any in-flight timed job it already started commits + completes normally (design §2). PURE
  // backend fn, same-ref no-op when the id doesn't match, so we always reassign + log + save.
  function doCancelLine(lineId: string) {
    state = cancelLine(state, lineId);
    pushLog("Production line canceled; remaining reservation released.");
    doSave();
  }

  // Maps a canStartLine BLOCK reason to the human sentence a disabled Start button shows. Named
  // parallel to fabricateBlockText; covers every StartLineBlockReason so a new reason is a
  // compile error here (exhaustive). `bp` is the selected blueprint (for the tierLocked level
  // hint), undefined for refine (which never surfaces notResearched/tierLocked).
  function startLineBlockText(reason: StartLineBlockReason, bp?: BlueprintDef): string {
    switch (reason) {
      case "notFound":
        return "That recipe no longer exists.";
      case "unlockOnly":
        // Combat 0.13.0 warship research gate: unlock-only blueprints craft nothing, they are
        // filtered OUT of the Fabricator's blueprint dropdowns (availableFabricateBlueprints), so
        // this text should never actually render here. Handled explicitly so the switch stays
        // genuinely exhaustive (not reliant on the default) if that filter ever changes.
        return "This blueprint is researched at the Research Lab; it is not fabricated.";
      case "notResearched":
        return "Research this blueprint at the Research Lab first.";
      case "tierLocked":
        return `Requires Fabricator level ${bp?.tier ?? "?"} (upgrade the Fabricator).`;
      case "noSlot":
        return "Every slot on this facility is busy.";
      case "invalidCount":
        return "Enter a whole quantity of 1 or more.";
      case "materials":
        return "Not enough free materials to reserve that quantity.";
      case "storageFull":
        return "Output storage is full (expand the Warehouse).";
      case "equipmentStorageFull":
        // The spare-system pool (equipmentAtCap) is full, the equipment twin of storageFull.
        // (Previously this valid reason fell through to the generic default; the exhaustiveness
        // assertion below surfaced the gap.) Relieved by salvaging a system or expanding storage.
        return "Ship-system storage is full (salvage a system or expand storage).";
      default: {
        // Exhaustiveness assertion: every StartLineBlockReason above is handled, so `reason` is
        // `never` here. A future union member that is NOT added above becomes a real compile error
        // at this line (svelte-check), making the "new reason is a compile error" claim true.
        const _exhaustive: never = reason;
        return "Cannot start this line right now.";
      }
    }
  }

  // Start the NEXT upgrade rung for `facilityKey`. Backend gates on
  // canBuildFacilityUpgrade (materials + FA level + talents + no in-flight
  // upgrade for this facility); on any miss it is a no-op.
  function doStartFacilityUpgrade(facilityKey: string) {
    const { next, started } = startFacilityUpgrade(state, facilityKey);
    if (!started) return;
    state = next;
    const facilityLabel = FACILITIES[facilityKey]?.label ?? facilityKey;
    pushLog(`${facilityLabel} upgrade started.`);
    doSave();
  }

  // Research (Task R5 UI): start a research PROJECT for `blueprintKey`. Backend
  // (startResearch -> canResearch) gates on notFound/alreadyResearched/inProgress/
  // tierLocked/noSlot/credits AND deducts the credit cost at start; on ANY block it
  // returns the SAME state reference + started:false, so the identity bail below is
  // a no-op (no spurious log/save), the SAME reassign-`state` + pushLog + doSave
  // idiom (destructuring `started`) doStartFacilityUpgrade/doStartRefineJob use.
  // The button's `disabled` already mirrors canResearch, so this bail only covers a
  // race where state changed between render and click. The log names the blueprint's
  // OUTPUT item (bracketed, per the [Item] convention) since a blueprint is
  // identified by what it will let the Fabricator craft.
  function doStartResearch(blueprintKey: string) {
    const { next, started } = startResearch(state, blueprintKey);
    if (!started) return;
    state = next;
    const bp = BLUEPRINTS[blueprintKey];
    pushLog(`Research started → [${bp?.label ?? blueprintKey}].`);
    doSave();
  }

  // Shipyard (Task S5 UI): start ONE ship build for `typeKey`. Backend (startShipBuild ->
  // canBuildShip) gates on notFound/notFounded/noSlot/storageFull/materials/credits AND
  // deducts the whole component BOM + credits at start (deduct-at-start, atomic); on ANY
  // block it returns the SAME state reference + started:false, so the identity bail below is
  // a no-op (no spurious log/save), the SAME reassign-`state` + pushLog + doSave idiom
  // (destructuring `started`) doStartFacilityUpgrade/doStartResearch use. The hull card's
  // Build button is ALREADY disabled per canBuildShip, so this bail only covers a race where
  // state changed between render and click. NO confirm modal (design/mockup: a build is
  // committed once started, so the direct Build press is the commitment). The log names the
  // hull being built (SHIP_TYPES label).
  function doStartShipBuild(typeKey: ShipTypeKey) {
    const { next, started } = startShipBuild(state, typeKey);
    if (!started) return;
    state = next;
    const hullLabel = SHIP_TYPES[typeKey]?.label ?? typeKey;
    pushLog(`Ship build started → ${hullLabel}.`);
    doSave();
  }

  // Maps a canBuildShip BLOCK reason to the human sentence a disabled hull Build button
  // shows. Named + shaped parallel to startLineBlockText / the retired fabricateBlockText;
  // the switch covers EVERY ShipBuildBlockReason so a new reason is a compile error here
  // (exhaustive). `typeKey` is the hull the button is for, reserved for a future
  // per-component "Need N [Item]" message; unused today (the generic materials text reads
  // fine against the card's own red per-component free/need rows), but threaded so the
  // signature is ready without touching call sites.
  function shipBuildBlockText(reason: ShipBuildBlockReason, typeKey?: ShipTypeKey): string {
    switch (reason) {
      case "notFounded":
        return "Found the Shipyard first (Upgrades).";
      case "notResearched": {
        // Combat 0.13.0 warship research gate: name the specific blueprint the player must
        // research (the hull's requiresBlueprint), so a disabled Build button says exactly what
        // to go unlock. Falls back to a generic phrase if the typeKey/blueprint can't be resolved.
        const bpKey = typeKey ? SHIP_TYPES[typeKey]?.requiresBlueprint : undefined;
        const bpLabel = bpKey ? (BLUEPRINTS[bpKey]?.label ?? bpKey) : undefined;
        return bpLabel
          ? `Research required: ${bpLabel} (Research Lab).`
          : "Research required (Research Lab).";
      }
      case "noSlot":
        return "Shipyard busy, a build is in progress.";
      case "storageFull":
        return "Ship storage full.";
      case "materials":
        return "Not enough free materials.";
      case "credits":
        return "Not enough credits.";
      case "notFound":
        return "Unavailable.";
      default: {
        // Exhaustiveness assertion: every ShipBuildBlockReason above is handled, so `reason` is
        // `never` here. A future union member that is NOT added above becomes a real compile error
        // at this line (svelte-check), making the "new reason is a compile error" claim true.
        const _exhaustive: never = reason;
        return "Cannot build this hull right now.";
      }
    }
  }

  // Mission Rework (Task 8 UI): buy `units` of fuel into the shared tank via the
  // backend buyFuel (which clamps the amount to the MIN of requested / tank room /
  // affordable credits, so it can never overfill or overspend). buyFuel returns the
  // SAME state reference on a zero/failed buy (broke or tank full), so an identity
  // check bails without a spurious log/save, same "same-ref no-op" convention the
  // other do* handlers use. `units` is a plain number (fuel is human-scale, not
  // Decimal); the +10/+100 buttons pass a literal, Fill passes the live tank room.
  function doBuyFuel(units: number) {
    const next = buyFuel(state, units);
    if (next === state) return; // no-op: broke, tank full, or nothing requested
    // Capture the actual amount bought BEFORE reassigning state (buyFuel clamps, so
    // the real delta can be < units); after `state = next` the two refs are equal.
    const bought = next.fuel.minus(state.fuel);
    state = next;
    pushLog(`Purchased ${formatNumber(bought)} fuel.`);
    doSave();
  }

  // Mission Rework (Task 8 UI): maps a canDispatch DispatchBlockReason to a short,
  // player-facing message for the dispatch button's disabled title + the popup's
  // blocked-reason line. Reads the mission's OWN requirement values (requiresCaptain
  // Level / requiresCargoCapacity) so the level/cargo messages name the actual number
  // the gate checks, never a hardcoded guess. Exhaustive over the union (every
  // DispatchBlockReason has a case); the default is belt-and-suspenders only.
  function dispatchBlockMessage(reason: DispatchBlockReason, missionKey: MissionKey): string {
    const mission = MISSIONS[missionKey];
    switch (reason) {
      case "locked":
        return "Unlock via Mission Control";
      case "captainLevel":
        return `Captain level ${mission.requiresCaptainLevel} required`;
      case "cargo":
        return `Needs cargo ${mission.requiresCargoCapacity}`;
      case "materialAtCap":
        // Warehouse for this mission's primary material is full, so the haul would be lost
        // and the captain would auto-idle after one wasted round trip. Block before that.
        return "Warehouse full for this material";
      case "fuelCapacity":
        return "Ship's tank too small for this trip";
      case "fuelEmpty":
        // Fuel Economy v2 (F3): a short tank now auto-buys the shortfall from credits; this
        // reason fires only when the shortfall is ALSO unaffordable (truly broke).
        return "Not enough fuel or credits to refuel";
      case "busy":
        return "Captain is already on a mission";
      case "noShip":
        return "Captain has no ship assigned";
      case "noCaptain":
        return "No captain selected";
      default:
        return "Cannot dispatch";
    }
  }

  // Captain Talents (Task 6), per-captain-scoped, like doDispatchCaptainOnMission
  // above (reads activeCaptain.id, spends THIS captain's own statPoints).
  // Same "same state reference on failure" convention as buyCaptainTalent
  // itself, success is just checked and bailed on here, no extra validation
  // duplicated in the UI layer.
  function doBuyCaptainTalent(talentKey: CaptainTalentKey) {
    const captain = activeCaptain;
    const { next, success } = buyCaptainTalent(state, captain.id, talentKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Talent learned: ${CAPTAIN_TALENTS[talentKey].label}.`);
    doSave();
  }

  // The three real CaptainTalentBranch literals, listed explicitly so
  // chooseSpec below can defensively validate the incoming key. specCards'
  // keys ARE these same branch strings (model.ts guarantees this), so this is
  // a belt-and-suspenders guard against an unexpected value reaching
  // chooseCaptainSpec, NOT a translation layer, a matched key passes
  // straight through unchanged. If CaptainTalentBranch ever grows a 4th
  // literal, this list (and specCards) must grow with it; there is no compiler
  // in this environment to catch a stale entry, so it's kept as a small,
  // obvious, hand-maintained list rather than derived indirectly.
  const CAPTAIN_SPEC_BRANCHES: CaptainTalentBranch[] = ["resourcefulness", "tactical", "science"];

  // Maps a chosen spec branch to its player-facing display name
  // (Prospector/Tactician/Explorer), derived straight from specCards' own
  // titles by key so the panel readout can never drift from the card titles
  // the player picked from. Built once (specCards is a static import), not per
  // render. A branch with no matching card falls back to the raw key at the
  // call site below (defensive, every real branch has a card today).
  const SPEC_DISPLAY_NAME: Record<string, string> = Object.fromEntries(
    specCards.map((card) => [card.key, card.title])
  );

  // Radial Skill Web (Task 14), the FREE first-pick spec commit, fired by
  // the TreeSelector's "Choose this spec" button in the Captain Talents panel
  // when activeCaptain.spec is still null. Same { next, success } -> reassign
  // `state` + pushLog + doSave idiom as doBuyCaptainTalent above. `key` comes
  // from a specCards card key (typed `string`), so it is defensively narrowed
  // to a real CaptainTalentBranch before use, an unexpected value simply
  // does nothing (no throw, no state change) rather than being forced through.
  // chooseCaptainSpec itself only succeeds from spec === null (the free pick);
  // CHANGING an established spec goes through the Reset flow (respec to null),
  // never here.
  function chooseSpec(key: string) {
    if (!(CAPTAIN_SPEC_BRANCHES as string[]).includes(key)) return;
    const branch = key as CaptainTalentBranch;
    const captain = activeCaptain;
    const { next, success } = chooseCaptainSpec(state, captain.id, branch);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Specialization chosen: ${branch}.`);
    doSave();
  }

  // Homeworld Talents (Task 6), fleet-wide, spends the shared adminPoints
  // pool. Unlike doBuyCaptainTalent above, this never touches state.captains
  // directly here (buyHomeworldTalent itself appends a new captain internally
  // for unlockCaptainSlot-effect nodes, see tick.ts), App.svelte just
  // swaps in whatever `next` comes back, same as every other do* handler.
  function doBuyHomeworldTalent(talentKey: HomeworldTalentKey) {
    const { next, success } = buyHomeworldTalent(state, talentKey);
    if (!success) return;
    state = next;
    pushLog(`Homeworld talent unlocked: ${HOMEWORLD_TALENTS[talentKey].label}.`);
    doSave();
  }

  // ---- Ship actions (Ships, Stats Foundation, Task 11 UI) ----------------
  // The remaining ship handler (doAssignShip) wraps a pure { next, success }
  // action and applies the SAME reassign-state + pushLog + doSave pattern every
  // other do* handler in this file uses (see doBuyHomeworldTalent above, or the
  // mission handlers near the top). No validation is duplicated here, the pure
  // function owns every fail-guard; the UI just checks `success` and bails.
  // (doBuyShip, the instant Requisition credit-buy, was RETIRED in S4;
  //  hulls now come from the Shipyard build panel, not an instant credit spend.)

  // Both Docks pickers funnel through this ONE handler, because the pure
  // assignShipToCaptain(state, captainId, shipId) is the only valid path and
  // its in-use guard rejects moving a hull directly between two captains
  // (ship.assignedCaptainId !== null && !== captainId -> fail). So EVERY valid
  // assignment is "give a captain a PARKED ship," and both row actions reduce
  // to that:
  //   - Assign ▾ (parked ship): captainId = the chosen IDLE captain, shipId =
  //     this parked ship. The chosen captain's own old hull auto-parks.
  //   - Swap ▾ (assigned ship, idle captain): captainId = this ship's OWN
  //     assigned captain, shipId = the chosen PARKED ship. This ship parks;
  //     the captain flies the chosen parked hull instead.
  // captured labels are read BEFORE the state swap (same pre-swap-capture idiom
  // as doDispatchCaptainOnMission/doRecallCaptain), since `next` replaces the
  // arrays the labels come from.
  function doAssignShip(captainId: number, shipId: string) {
    const captain = state.captains.find((c) => c.id === captainId);
    const ship = state.ships.find((s) => s.id === shipId);
    const { next, success } = assignShipToCaptain(state, captainId, shipId);
    if (!success) return;
    state = next;
    if (captain && ship) {
      pushLog(`[${captain.label}] Now flying: ${SHIP_TYPES[ship.typeKey].label}.`);
    }
    // Close BOTH pickers unconditionally, whichever one drove this call is
    // now done, and the other is already null. Cheap and keeps this handler
    // from needing to know which picker opened it.
    assignPickerShipId = null;
    swapPickerCaptainId = null;
    doSave();
  }

  // Picker open/close helpers, pure UI state toggles, mirroring
  // openMissionPopup/closeMissionPopup above. The Assign picker keys off the
  // parked ship's id; the Swap picker keys off the assigned ship's captain id
  // (see the swapPickerCaptainId declaration above for why captain, not
  // ship). closeShipPickers clears both so no stale modal can linger.
  function openAssignPicker(shipId: string) {
    assignPickerShipId = shipId;
    swapPickerCaptainId = null;
  }
  function openSwapPicker(captainId: number) {
    swapPickerCaptainId = captainId;
    assignPickerShipId = null;
  }
  function closeShipPickers() {
    assignPickerShipId = null;
    swapPickerCaptainId = null;
  }

  // Radial Skill Web (Task 15), the currently-viewed Homeworld talent
  // category, or null when the category card-picker (TreeSelector) is showing.
  // This is COMPONENT-LOCAL, VIEW-ONLY navigation state, it is deliberately
  // NOT part of GameState and is NEVER persisted (no doSave on change). Unlike
  // the captain spec (a committed, costed lock-in stored on CaptainState.spec),
  // choosing a homeworld category is free and freely reversible: picking a card
  // just points the RadialWeb at that branch, and the "Categories" back button
  // returns to the picker. Defaults to null so the panel opens on the picker.
  let selectedCategory: HomeworldTalentBranch | null = null;

  // The five real HomeworldTalentBranch literals, listed explicitly so
  // viewCategory below can defensively validate the incoming card key --
  // exact mirror of CAPTAIN_SPEC_BRANCHES above. categoryCards' keys ARE these
  // same branch strings (model.ts guarantees this), so this is a
  // belt-and-suspenders guard against an unexpected value, NOT a translation
  // layer, a matched key passes straight through unchanged. If
  // HomeworldTalentBranch ever grows/shrinks, this list (and categoryCards)
  // must change with it; there is no compiler in this environment to catch a
  // stale entry, so it is kept as a small, obvious, hand-maintained list.
  const HOMEWORLD_CATEGORY_BRANCHES: HomeworldTalentBranch[] = [
    "fleetLogistics",
    "homelandDefense",
    "citizenry",
    "economy",
    "industry",
  ];

  // Radial Skill Web (Task 15), navigate INTO a homeworld category's web,
  // fired by the TreeSelector's "View Tree" button. Purely view-only: it
  // validates the key is a real branch then points selectedCategory at it.
  // There is NO cost and NO save write, this is navigation, not a commit
  // (contrast chooseSpec above, which commits a captain spec and calls doSave).
  // `key` comes from a categoryCards card key (typed `string`), so it is
  // defensively narrowed to a real HomeworldTalentBranch before use, an
  // unexpected value simply does nothing rather than being forced through.
  function viewCategory(key: string) {
    if (!(HOMEWORLD_CATEGORY_BRANCHES as string[]).includes(key)) return;
    selectedCategory = key as HomeworldTalentBranch;
  }

  // Homeworld Talents Reset (Task 13), opens the confirmation modal. No
  // captured pre-swap state needed (unlike doDispatchCaptainOnMission's
  // captain.label capture) since the confirmation happens in the modal
  // itself, not in this open handler.
  function openHomeworldRespecModal() {
    homeworldRespecModalOpen = true;
  }

  function cancelHomeworldRespec() {
    homeworldRespecModalOpen = false;
  }

  // Wraps respecHomeworldTalents(state), same { next, success } -> reassign
  // `state` pattern every other do* handler in this file uses (see
  // doBuyHomeworldTalent immediately above for the closest analog). Closes
  // the modal only on success, mirroring confirmDelete/confirmImport's own
  // "stay open on failure" convention, though in practice the Confirm
  // button is already disabled below RESPEC_COST_CREDITS, so failure here
  // should only happen if credits changed out from under the open modal.
  function doRespecHomeworldTalents() {
    const { next, success } = respecHomeworldTalents(state);
    if (!success) return;
    state = next;
    pushLog("Homeworld talents reset.");
    homeworldRespecModalOpen = false;
    doSave();
  }

  // Captain Talents Reset (Task 13), opens the confirmation modal. Task 14
  // removed the selectedSpecInModal seeding that used to live here: Reset now
  // unconditionally clears the spec to null (Confirm passes `null` directly),
  // so there is no per-open pending-spec state left to seed.
  function openCaptainRespecModal() {
    captainRespecModalOpen = true;
  }

  function cancelCaptainRespec() {
    captainRespecModalOpen = false;
  }

  // Wraps respecCaptainTalents(state, activeCaptain.id, newSpec), same
  // { next, success } -> reassign `state` pattern as doBuyCaptainTalent
  // above. Takes newSpec as an explicit parameter, kept as a parameter (rather
  // than hardcoding null inside) so the signature stays honest about what
  // respecCaptainTalents can do; Task 14's only caller (the Reset modal's
  // Confirm) passes `null` to CLEAR the captain's spec, which makes the
  // TreeSelector reappear for a free re-pick.
  function doRespecCaptainTalents(newSpec: CaptainTalentBranch | null) {
    const captain = activeCaptain;
    const { next, success } = respecCaptainTalents(state, captain.id, newSpec);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Talents reset.`);
    captainRespecModalOpen = false;
    doSave();
  }

  function doExportSave() {
    // Delegates to the shared helper in save.ts so this button and the
    // update-detector banner's "Export save" stay identical (see downloadRawSave).
    downloadRawSave();
  }

  function resetSave() {
    clearSave();
    // Seed the fresh starter's weak Standard-Issue combat set (see newGame rationale at
    // the initial `state` declaration): a reset game's hull is dispatchable like a new one.
    state = installMissingCombatBaselines(freshState());
    createdAt = Date.now();
    // A fresh state ships a SINGLE captain (index 0). If the player had captain #2+
    // selected, activeCaptainIndex/personnelRosterView still point past the new roster,
    // so `activeCaptain = state.captains[activeCaptainIndex]` goes undefined and the
    // Personnel captain view white-screens on activeCaptain.label/.level/.xp. Return
    // Personnel to its grid root, re-seat the active captain on the only one that exists,
    // and close every captain-scoped modal so none can re-open against a stale target.
    activeCaptainIndex = 0;
    personnelRosterView = "grid";
    captainTalentsModalOpen = false;
    captainRespecModalOpen = false;
    captainRenameModalOpen = false;
    pushLog("Save reset.");
  }

  function confirmDelete() {
    if (deleteConfirmText !== "DELETE") return;
    resetSave();
    deleteModalOpen = false;
    deleteConfirmText = "";
  }

  function cancelDelete() {
    deleteModalOpen = false;
    deleteConfirmText = "";
  }

  // Import Save handlers (Task 7, Loot Tier Rework), mirror the
  // cancelDelete/confirmDelete pair above in shape, but there's no
  // typed-confirmation-word gate here: picking a file from the OS file
  // picker is already a deliberate action, so Cancel/Import buttons alone
  // are enough friction (confirmed against the plan doc, Import
  // deliberately does NOT need a "type DELETE"-style gate).
  function onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // `file` is captured into this local const BEFORE input.value is reset
    // below, so the reset (which only clears the <input> element's OWN
    // value) cannot affect the File object or the .text() promise already
    // in flight against it, they're independent references.
    file.text().then((text) => {
      pendingImportRaw = text;
      importError = null;
      importModalOpen = true;
    }).catch(() => {
      // File.text() can reject (e.g. the file was deleted/became unreadable
      // between selection and read), surface this the same way a rejected
      // save would be, rather than silently doing nothing and leaving the
      // user with no feedback at all.
      pendingImportRaw = null;
      importError = "Couldn't read that file. Please try again.";
      importModalOpen = true;
    });
    input.value = ""; // allow re-selecting the same file later, browsers don't fire `change` on an unchanged value otherwise
  }

  function cancelImport() {
    importModalOpen = false;
    pendingImportRaw = null;
    importError = null;
  }

  function confirmImport() {
    if (pendingImportRaw === null) return;
    const success = importRawSave(pendingImportRaw);
    if (!success) {
      importError = "That file isn't a valid Fleet Admiral save.";
      return; // modal stays open, importError renders inline, user can pick a different file
    }
    // Simplest way to get every derived/init-time value (in-memory state,
    // createdAt, tick-loop timers) to reset cleanly from the just-imported
    // save, matches the existing "load happens once, at mount" pattern
    // (see onMount above) rather than adding a second "hot-swap state
    // mid-session" code path.
    // MUST suppress teardown autosaves first: window.location.reload() fires
    // beforeunload + onDestroy, both of which doSave() the OLD in-memory state
    //, without this, that write clobbers the just-imported save (the import bug).
    suppressSave = true;
    window.location.reload();
  }

  // Corrupt-save recovery (P4). The ONLY resolving action for the recovery
  // modal: the player has been shown the unloadable raw (and offered a download)
  // and has explicitly chosen to abandon it. clearSave() removes the corrupt raw,
  // freshState() gives a clean game, and clearing suppressSave (set true on the
  // corrupt load branch) re-enables autosave, which the immediate doSave() then
  // uses to write the fresh save OVER the corrupt raw. This overwrite is
  // deliberate and player-initiated: it happens only here, after the backup was
  // offered, never automatically.
  function startFreshFromCorrupt() {
    clearSave();
    // Seed the fresh starter's weak Standard-Issue combat set (see newGame rationale at
    // the initial `state` declaration) so the recovered game's hull is dispatchable.
    state = installMissingCombatBaselines(freshState());
    createdAt = Date.now();
    // Mirror resetSave()'s index reset for hygiene: the recovered state also has a single
    // captain, so re-seat the selection at index 0 rather than trust whatever it was.
    activeCaptainIndex = 0;
    suppressSave = false;
    saveCorruptModalOpen = false;
    doSave();
  }

  function setTheme(name: ThemeName) {
    currentTheme = name;
    document.documentElement.dataset.theme = name;
    saveTheme(name);
  }

  $: activeCaptain = state.captains[activeCaptainIndex];

  // Home > Statistics derivation (0.11.2 Shell Correction, Task 2). Pure read of
  // existing GameState fields, reshaped into grouped { label, value } rows by
  // deriveStatistics (statistics.ts). Reactive on `state` so the readout refreshes
  // each tick as lifetime totals, play time, and roster counts change.
  $: stats = deriveStatistics(state);
  // Fleet-wide tick readout (collapsed from per-captain activeCycle/
  // activeBarSeconds/activeTickProgress/activeTickRemaining during the UI
  // Redesign, Task 4, see docs/plans/2026-07-07-ui-redesign-plan.md).
  // There's only ONE cycle to read now (the shared `cycle` object above), so
  // these are no longer scoped to activeCaptain at all, consumed by the new
  // global header bar landing in Task 6 of that same plan.
  $: globalBarSeconds = Math.max(1, state.tickDurationSeconds / (speed || 1));
  $: globalTickProgress = Math.min(1, Math.max(0, (cycle.nowTick - cycle.barCycleStart) / 1000 / globalBarSeconds));
  $: globalTickRemaining = Math.max(0, globalBarSeconds * (1 - globalTickProgress));
  // Header redesign (2026-07-07), single source for the Fleet Admiral XP
  // ratio, consumed by both the bar-fill width (clamped to 100) and the
  // readout percentage below (unclamped, .toFixed(1)), avoids the same
  // division appearing twice and drifting if the formula ever changes,
  // matching the globalTickProgress/globalTickRemaining pattern above.
  $: fleetAdminXpRatio = state.fleetAdminXp.dividedBy(xpForNextFleetAdminLevel(state.fleetAdminLevel)).toNumber();

  // ---- Foundry program reactive derivations (Phase 1, Task 12 UI) ------------
  // All recompute whenever `state` changes (inventory gathered, refinery levelled,
  // a process started/completed), so the panel's slot counts, affordability, and
  // upgrade readiness update LIVE as the game ticks, the "$: derivations for
  // readiness so the UI updates as inventory/level change" the task calls for.
  // These read the SAME backend fns/tables the actions call, so the displayed
  // gates can never drift from what startRefineJob/startFacilityUpgrade enforce.

  // Refinery level (0 = not built) and its parallel-job slot count (derived from
  // the levels reached). refineSlotCount reads state directly, so it's reactive here.
  $: refineryLevel = state.facilities.refinery?.level ?? 0;
  $: refinerySlots = refineSlotCount(state);
  // The refine jobs currently in flight for the refinery (kind "refineJob").
  // Their count vs refinerySlots is the free-slot gate; each also renders a
  // progress row in the Overview sub-tab.
  $: activeRefineJobs = state.activeProcesses.filter((p) => p.kind === "refineJob");
  // (The one-shot Start-Refine-Job derivations, refineRecipe / refineHasFreeSlot
  //  / refineAffordable / refineCanStart, were RETIRED in S4 with the manual
  //  Overview start button they exclusively drove. Refining is now configured
  //  per-slot in the Production sub-tab; its gates read canStartLine, not these.)

  // ── Production LINES status (Crafting Allocation Redesign, Task C4) ────────
  // Whether the refinery is built at all (>= 1 slot). Below 1 slot there are no line
  // slots to render, so the Production sub-tab shows a "build it first" empty state.
  $: refineryBuilt = refinerySlots > 0;
  // ALL active lines across BOTH facilities, the allocation basis every configurator's
  // REQUIRES preview reads (allocatedItem/freeItem take this array). Derived off state so
  // the free/allocated numbers update LIVE as lines start, drain, and cancel. `?? []`
  // guards a pre-C2 save shape defensively (C6's migration seeds the arrays).
  $: allLines = [...(state.refineLines ?? []), ...(state.fabricateLines ?? [])];

  // Next Refinery UPGRADE rung. upgrades[level] is the rung that takes the
  // facility from `level` to `level+1` (so a level-0 refinery's next rung is
  // upgrades[0], the build). `refineryMaxed` is an EXPLICIT length check rather
  // than a `nextRefineryUpgrade === undefined` template comparison: without
  // noUncheckedIndexedAccess, `upgrades[level]` is typed as a non-undefined
  // FacilityUpgradeDef, so an `=== undefined` check would trip svelte-check's
  // TS2367 ("no overlap"). Gating the template on refineryMaxed instead keeps
  // nextRefineryUpgrade's non-undefined type in the {:else} branch (real at
  // runtime there, level < upgrades.length guarantees a defined rung).
  $: refineryMaxed = refineryLevel >= FACILITIES.refinery.upgrades.length;
  $: nextRefineryUpgrade = FACILITIES.refinery.upgrades[refineryLevel];
  // The PURE build-readiness predicate ({ ok, reason? }), drives both the Build
  // button's disabled state AND (via .reason) its "why not" title. Same fn
  // startFacilityUpgrade calls internally, so the button and the action agree.
  $: refineryUpgradeCheck = canBuildFacilityUpgrade(state, "refinery");
  // The in-flight refinery upgrade process, if any (at most ONE, upgrades are
  // sequential-per-facility). Narrowed on effect.type + effect.facility so a
  // future OTHER-facility upgrade wouldn't be mistaken for the refinery's.
  // Drives the Upgrades sub-tab's "Currently upgrading" progress row.
  $: refineryUpgradeInFlight = state.activeProcesses.find(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === "refinery"
  );

  // ---- Warehouse reactive derivations (Phase 2, Group C) ----------------------
  // NOTE (0.11.2 Task 9): the old flat-catalog tier-group builder
  // (warehouseTierGroups / warehouseGroups / WAREHOUSE_CAT_CATEGORIES) was
  // removed with the flat Raw/Refined/Components/Salvaged tabs. The Materials tab
  // now derives its themed sections through materialsSectionItems (above), which
  // filters by tier + section membership directly.

  // Overview summary derivations (design §3.1: at-a-glance warehouse state).
  // T1 level + its live per-item cap (the primary, always-available tier).
  $: warehouseT1Level = state.facilities.warehouseT1?.level ?? 0;
  $: warehouseT1Cap = tierCap(state, 1);
  // Every DISCOVERED catalog item currently AT its cap, the auto-stop "full,
  // expand storage" set. Drives the Overview's "items at cap" count + the
  // Attention card's per-item FULL list. materialAtCap is the same fn the
  // backend auto-stop uses, so this can't disagree with what actually idles.
  $: warehouseItemsAtCap = Object.keys(ITEMS).filter(
    (id) => state.discovered.includes(id) && materialAtCap(state, id)
  );
  // Discovered / total across the whole catalog (the 100%-completion checklist,
  // design §3.2). A simple count pair for the Overview readout.
  $: warehouseDiscoveredCount = Object.keys(ITEMS).filter((id) => state.discovered.includes(id)).length;
  $: warehouseTotalCount = Object.keys(ITEMS).length;

  // ---- Mission Rework (Task 8 UI) reactive derivations ------------------------
  // All read live `state`, so every readout below (dispatch gate, fuel gauge,
  // completion progress, unlock lists, upgrade readiness) updates automatically as
  // fuel is spent/bought, missions complete, and upgrades finish, no manual
  // refresh, same reactive contract the Warehouse/Refinery derivations above use.

  // --- Operations dispatch surface ---
  // The fleet's representative captain (state.captains[0], always seeded) + its
  // assigned hull. Used ONLY for the AVAILABLE-MISSIONS list card's fuel-cost
  // readout, mirroring the exp/tick readout's SAME representative-captain choice.
  // Fuel cost is hull-dependent (varies by engineEfficiency), so this list figure
  // is indicative; the dispatch POPUP recomputes it for the actually-selected
  // captain's hull (the authoritative cost). `?? null` guards the belt-and-
  // suspenders case of a captain with no assigned hull (never true in production).
  $: representativeCaptain = state.captains[0];
  $: representativeShip = representativeCaptain
    ? state.ships.find((s) => s.assignedCaptainId === representativeCaptain.id) ?? null
    : null;
  // The dispatch gate for the OPEN mission popup (null when no popup / no captain
  // picked yet). canDispatch is the ONE source of truth, the popup's Dispatch
  // button reads .ok for its disabled state and .reason (via dispatchBlockMessage)
  // for its title + the blocked-reason line. Reactive so it re-evaluates the moment
  // fuel/level/etc. change while the popup is open.
  $: missionPopupGate =
    missionPopupKey !== null && missionPopupCaptainId !== null
      ? canDispatch(state, missionPopupCaptainId, missionPopupKey)
      : null;

  // --- Mission Control facility ---
  // Level + the next upgrade rung (upgrades[level]; caps at length 2). missionControl
  // Maxed is an EXPLICIT length check (same noUncheckedIndexedAccess reasoning as
  // refineryMaxed above) so nextMissionControlUpgrade stays non-undefined-typed in
  // the {:else} branch. The upgrade check + in-flight process mirror the Refinery's.
  $: missionControlLevel = state.facilities.missionControl?.level ?? 0;
  $: missionControlMaxed = missionControlLevel >= FACILITIES.missionControl.upgrades.length;
  $: nextMissionControlUpgrade = FACILITIES.missionControl.upgrades[missionControlLevel];
  $: missionControlUpgradeCheck = canBuildFacilityUpgrade(state, "missionControl");
  $: missionControlUpgradeInFlight = state.activeProcesses.find(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === "missionControl"
  );
  // Which missions are currently dispatchable vs still locked (derived from the
  // facility level via missionUnlocked, the SAME gate canDispatch uses). Drives
  // Mission Control's Overview "unlocked / locked" lists.
  $: unlockedMissionKeys = (Object.keys(MISSIONS) as MissionKey[]).filter((k) => missionUnlocked(state, k));
  $: lockedMissionKeys = (Object.keys(MISSIONS) as MissionKey[]).filter((k) => !missionUnlocked(state, k));

  // --- Fuel Storage facility ---
  // The live tank cap (fuelCap derives it from the fuelStorage level) + the tank's
  // headroom + fill % (reusing warehouseFillPct, the shared clamp helper). The buy
  // gate opens only when the player can afford at least one unit AND the tank has
  // room, buyFuel clamps partials, but this keeps the buttons honestly disabled
  // when NOTHING can be bought (broke or full).
  $: fuelStorageLevel = state.facilities.fuelStorage?.level ?? 0;
  $: fuelStorageMaxed = fuelStorageLevel >= FACILITIES.fuelStorage.upgrades.length;
  $: nextFuelStorageUpgrade = FACILITIES.fuelStorage.upgrades[fuelStorageLevel];
  $: fuelStorageUpgradeCheck = canBuildFacilityUpgrade(state, "fuelStorage");
  $: fuelStorageUpgradeInFlight = state.activeProcesses.find(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === "fuelStorage"
  );
  $: fuelCapValue = fuelCap(state);
  $: fuelRoom = Decimal.max(0, fuelCapValue.minus(state.fuel));
  $: fuelFillPct = warehouseFillPct(state.fuel, fuelCapValue);
  $: canBuyFuel = state.credits.gte(FUEL_CREDITS_PER_UNIT) && fuelRoom.gt(0);

  // ---- Research (Task R5 UI) reactive derivations ----------------------------
  // All read live `state` + the SAME backend fns/tables the Research actions call
  // (researchSlotCount / canResearch / startResearch / FACILITIES.research /
  // BLUEPRINTS), so every readout below (slots-in-use, in-flight projects, the
  // per-blueprint gate, researched counts, upgrade readiness) updates automatically
  // as projects complete + the lab is upgraded, the SAME reactive-off-state
  // contract the Refinery/Mission-Control/Fuel-Depot derivations above use.

  // Lab level (0 = not built; freshState seeds 1) + its parallel-project slot count
  // (derived from levels reached; parallels refinerySlots). researchSlotCount reads
  // state directly, so it's reactive here.
  $: researchLevel = state.facilities[RESEARCH_FACILITY_KEY]?.level ?? 0;
  $: researchSlots = researchSlotCount(state);
  // The research projects currently in flight (kind "researchProject"). Their count
  // vs researchSlots is the free-slot gate (enforced in canResearch); each also
  // renders a progress row in the Overview sub-tab.
  $: activeResearchProjects = state.activeProcesses.filter((p) => p.kind === "researchProject");

  // Next Research Lab UPGRADE rung (upgrades[level]; caps at length 2 today).
  // researchMaxed is an EXPLICIT length check (same noUncheckedIndexedAccess
  // reasoning as refineryMaxed) so nextResearchUpgrade stays non-undefined-typed in
  // the {:else} branch. The upgrade check + in-flight process mirror the Refinery's.
  $: researchMaxed = researchLevel >= FACILITIES[RESEARCH_FACILITY_KEY].upgrades.length;
  $: nextResearchUpgrade = FACILITIES[RESEARCH_FACILITY_KEY].upgrades[researchLevel];
  $: researchUpgradeCheck = canBuildFacilityUpgrade(state, RESEARCH_FACILITY_KEY);
  $: researchUpgradeInFlight = state.activeProcesses.find(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === RESEARCH_FACILITY_KEY
  );

  // Researched / total blueprint counts (the Overview's progress-at-a-glance pair,
  // same shape as the Warehouse's discovered/total). researchedBlueprints is the
  // unlocked-key set; total is every blueprint in the static registry.
  $: totalBlueprintCount = Object.keys(BLUEPRINTS).length;
  $: researchedBlueprintCount = state.researchedBlueprints.length;

  // ── Fabricator status (Fabricator Task F4 UI) ─────────────────────────────
  // All derive off state (facilities / activeProcesses / fabricateOrder), so the
  // Fabricator panel's counts, slot gauge, in-flight bars, order status, and button
  // gates update LIVE as jobs start/finish + the order drains/pauses/clears, the SAME
  // reactive-off-state contract the Research/Refinery derivations above use.

  // Fabricator level (0 = not built; freshState seeds 1) + its parallel-craft slot count
  // (derived from levels reached; parallels researchSlots). fabricateSlotCount reads state
  // directly, so it's reactive here.
  $: fabricatorLevel = state.facilities[FABRICATOR_FACILITY_KEY]?.level ?? 0;
  $: fabricateSlots = fabricateSlotCount(state);
  // The fabricate jobs currently in flight (kind "fabricateJob"). Their count vs
  // fabricateSlots is the free-slot gate (enforced in canFabricate); each also renders a
  // progress row in the Overview sub-tab.
  $: activeFabricateJobs = state.activeProcesses.filter((p) => p.kind === "fabricateJob");

  // Next Fabricator UPGRADE rung (upgrades[level]; caps at length 2 today). fabricatorMaxed
  // is an EXPLICIT length check (same noUncheckedIndexedAccess reasoning as researchMaxed)
  // so nextFabricatorUpgrade stays non-undefined-typed in the {:else} branch. The upgrade
  // check + in-flight process mirror the Research Lab's.
  $: fabricatorMaxed = fabricatorLevel >= FACILITIES[FABRICATOR_FACILITY_KEY].upgrades.length;
  $: nextFabricatorUpgrade = FACILITIES[FABRICATOR_FACILITY_KEY].upgrades[fabricatorLevel];
  $: fabricatorUpgradeCheck = canBuildFacilityUpgrade(state, FABRICATOR_FACILITY_KEY);
  $: fabricatorUpgradeInFlight = state.activeProcesses.find(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === FABRICATOR_FACILITY_KEY
  );

  // Fabricable count: researched blueprints whose tier the fabricator's LEVEL has reached
  // (the STABLE "you have the capability to craft this" count, NOT the transient
  // canFabricate.ok which flickers with live materials/slots). Paired with
  // researchedBlueprintCount as the Overview's researched-vs-fabricable at-a-glance line.
  // Combat 0.13.0 (warship research gate): UNLOCK-ONLY blueprints (unlockOnly: true, e.g. the
  // battleship / carrier hull unlocks) craft NOTHING, so they are NOT "fabricable" no matter
  // their research/tier state, filter them out here (and from availableFabricateBlueprints below)
  // so the Fabricator never counts or offers them. They live in the Research list instead.
  $: fabricableBlueprintCount = Object.keys(BLUEPRINTS).filter(
    (k) => blueprintKind(BLUEPRINTS[k]) !== "unlockOnly" && blueprintUnlocked(state, k) && BLUEPRINTS[k].tier <= fabricatorLevel
  ).length;

  // Whether the fabricator is built at all (>= 1 slot). Below 1 slot there are no line
  // slots to render, so the Craft sub-tab shows the Research-Lab empty-state signpost.
  $: fabricatorBuilt = fabricateSlots > 0;

  // The blueprints a Fabricator line can currently configure: RESEARCHED (blueprintUnlocked)
  // AND tier-available (tier <= fabricator level), the SAME two stable gates the fabricable
  // count uses. These populate the configurator's tier + item dropdowns. Derived off state so
  // researching/upgrading updates the dropdowns LIVE. An empty list -> the Research-Lab signpost.
  // (Combat 0.13.0) `!bp.unlockOnly` excludes the unlock-only hull blueprints: they craft
  // nothing, so a fabricate LINE must never be configurable for one (canFabricate/canStartLine
  // also reject them, this keeps them out of the configurator's dropdowns in the first place).
  $: availableFabricateBlueprints = Object.keys(BLUEPRINTS)
    .map((k) => BLUEPRINTS[k])
    .filter((bp) => blueprintKind(bp) !== "unlockOnly" && blueprintUnlocked(state, bp.key) && bp.tier <= fabricatorLevel);
  // The DISTINCT tiers among those blueprints, ascending, the tier dropdown's options.
  $: availableFabricateTiers = [...new Set(availableFabricateBlueprints.map((bp) => bp.tier))].sort(
    (a, b) => a - b
  );

  // ============================================================================
  // Shipyard (Phase 5, Task S5 UI), the reactive reads the Build/Upgrades panel below
  // consumes. Structurally the DIRECT clone of the Fabricator's upgrade-derivation block
  // above (level / maxed / next-rung / upgrade-check / in-flight-upgrade), plus the
  // Shipyard-specific founded flag and the single in-flight ship BUILD (distinct from an
  // in-flight facility upgrade). All derive off `state`, so founding/upgrading/starting a
  // build updates the panel LIVE. No engine logic here, these only READ the S1-S3 seams.
  // ============================================================================
  // The Shipyard's LEVEL, read DEFENSIVELY (absent facility -> 0), the SAME idiom
  // fabricatorLevel uses. Level 0 = LOCKED/unfounded (freshState seeds it at 0); the
  // founding rung (upgrades[0], level 0->1) establishes it. shipyardFounded is the
  // founded-vs-unfounded split the Build tab branches on (mirrors canBuildShip's own
  // facilityLevel(...) < 1 -> "notFounded" gate, so UI + engine agree on "is it built").
  $: shipyardLevel = state.facilities[SHIPYARD_FACILITY_KEY]?.level ?? 0;
  $: shipyardFounded = shipyardLevel >= 1;

  // Next Shipyard UPGRADE rung (upgrades[level]; the founding rung IS upgrades[0], so the
  // SAME next-rung read drives BOTH the unfounded "Found" button and the Upgrades tab's
  // build-speed rungs). shipyardMaxed is an EXPLICIT length check (same
  // noUncheckedIndexedAccess reasoning as fabricatorMaxed) so nextShipyardUpgrade stays
  // non-undefined-typed in the {:else} branch. The upgrade check + in-flight facility-
  // upgrade process mirror the Fabricator's exactly (shared canBuildFacilityUpgrade seam).
  $: shipyardMaxed = shipyardLevel >= FACILITIES[SHIPYARD_FACILITY_KEY].upgrades.length;
  $: nextShipyardUpgrade = FACILITIES[SHIPYARD_FACILITY_KEY].upgrades[shipyardLevel];
  $: shipyardUpgradeCheck = canBuildFacilityUpgrade(state, SHIPYARD_FACILITY_KEY);
  $: shipyardUpgradeInFlight = state.activeProcesses.find(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === SHIPYARD_FACILITY_KEY
  );

  // The SINGLE in-flight ship BUILD, if any (the Shipyard has one build slot this pass, so
  // find, not filter, suffices). This is the "shipBuild" TimedProcess, DISTINCT from the
  // facilityUpgrade above: it renders the "BUILDING · {hull}" progress card at the TOP of a
  // founded Build tab. Its completion effect { type: "addShip", typeKey } carries the hull
  // being built, read below for the card's label (narrowed on effect.type === "addShip").
  $: activeShipBuild = state.activeProcesses.find((p) => p.kind === "shipBuild");

  // The available blueprint KEYS in a given tier, the item dropdown's options for that tier,
  // and the seed the tier-change/open handlers use to reset cfgRecipeKey. Reads the reactive
  // availableFabricateBlueprints at call time, so it always reflects the current research/level.
  function fabricateKeysForTier(tier: number): string[] {
    return availableFabricateBlueprints.filter((bp) => bp.tier === tier).map((bp) => bp.key);
  }

  // Blueprints grouped by TIER for the Research list (tiers ascending). PURE over
  // the STATIC BLUEPRINTS table (independent of live state, the per-blueprint
  // researched/gate reads happen in the markup), so this is a plain const computed
  // once at script init, mirroring the by-tier bucketing pattern used elsewhere.
  // Each group renders as a tier heading + its blueprint cards in the Research sub-tab.
  const blueprintTierGroups: { tier: number; blueprints: BlueprintDef[] }[] = (() => {
    const byTier = new Map<number, BlueprintDef[]>();
    for (const key of Object.keys(BLUEPRINTS)) {
      const bp = BLUEPRINTS[key];
      const bucket = byTier.get(bp.tier) ?? [];
      bucket.push(bp);
      byTier.set(bp.tier, bucket);
    }
    return [...byTier.keys()]
      .sort((a, b) => a - b)
      .map((tier) => ({ tier, blueprints: byTier.get(tier) ?? [] }));
  })();

  // Combat 0.13.0 (warship research gate): the hull (if any) an UNLOCK-ONLY blueprint grants
  // build access to, the REVERSE of ShipTypeDef.requiresBlueprint. The Research card uses this
  // to describe an unlock-only blueprint by WHAT it unlocks ("Unlocks: Battleship") instead of
  // the "Crafts: inputs -> output" line, which is meaningless for a blueprint that crafts nothing.
  // Pure scan over the static SHIP_TYPES table; returns the hull label or undefined (no match).
  function hullUnlockedByBlueprint(blueprintKey: string): string | undefined {
    for (const k of Object.keys(SHIP_TYPES)) {
      const def = SHIP_TYPES[k as ShipTypeKey];
      if (def.requiresBlueprint === blueprintKey) return def.label;
    }
    return undefined;
  }

  // Map a canResearch BLOCK reason to the human sentence shown on a disabled
  // Tick-readout formatters (2026-07-16). Both wrap formatClock (the PRECISE
  // clock in format.ts) and conditionally prepend the raw tick counts, gated on
  // the "Show tick counts" Options toggle. They are PURE and take showTicks +
  // secPerTick as EXPLICIT params (not closed-over state) so Svelte's legacy
  // `$:`/template reactivity re-invokes them whenever showTickCounts or
  // state.tickDurationSeconds changes, a helper that read those off the
  // enclosing scope would not re-run when the toggle flips.
  //
  // remainingReadout: live countdown. off -> "01:39 remaining";
  //                   on  -> "373646 / 400000 ticks · 01:39 remaining".
  // The tick figure is Math.max(0, Math.ceil(remainingTicks)) so a fractional
  // remaining tick shows the whole tick still pending (never a rounded-down
  // "0 ticks" while time is visibly left on the clock), clamped non-negative.
  function remainingReadout(remainingTicks: number, totalTicks: number, showTicks: boolean, secPerTick: number): string {
    const clock = formatClock(remainingTicks, secPerTick);
    const ticks = Math.max(0, Math.ceil(remainingTicks));
    return showTicks ? `${ticks} / ${totalTicks} ticks · ${clock} remaining` : `${clock} remaining`;
  }

  // durationReadout: static duration (a fixed cost/length, not a countdown).
  // off -> "01:39";  on -> "120 ticks (01:39)".
  function durationReadout(ticks: number, showTicks: boolean, secPerTick: number): string {
    const clock = formatClock(ticks, secPerTick);
    return showTicks ? `${ticks} ticks (${clock})` : clock;
  }

  // lineRemainingReadout: the WHOLE-BATCH countdown for a production line (refine or
  // fabricate), fixing the bug where the readout showed only the item CURRENTLY
  // minting instead of the time to finish the whole batch. A batch of 100 with 40
  // done must read the time for all 60 remaining, not the ~one-item time.
  //
  // A batch line's total remaining time = the in-flight job's own remainingTicks
  // (the item minting right now) PLUS one FULL durationTicks for every not-yet-
  // started iteration. That queued count is exactly `line.remaining`: stepCraftLine
  // (tick.ts) decrements it the instant each job starts, so while a job is in flight
  // `line.remaining` already excludes the in-flight item and counts only what is
  // still queued behind it. The paired "total" is (queued + 1) full durations (every
  // pending iteration at full length), so at each item's start remaining == total
  // and the showTicks "X / Y ticks" figure reads sensibly.
  //
  // A CONTINUOUS line is endless (line.remaining is pinned at 1 and never counts
  // down), so there is no finite batch to total, it keeps the plain per-item
  // countdown. Callers guard `job` non-null and render "Queued" when it is null.
  function lineRemainingReadout(
    job: { remainingTicks: number; durationTicks: number },
    line: CraftLine,
    showTicks: boolean,
    secPerTick: number,
  ): string {
    if (line.mode.kind === "batch") {
      const queued = line.remaining; // not-yet-started iterations (in-flight already excluded)
      const totalTicks = (queued + 1) * job.durationTicks; // in-flight + queued, all at full duration
      const remainingTicks = job.remainingTicks + queued * job.durationTicks;
      return remainingReadout(remainingTicks, totalTicks, showTicks, secPerTick);
    }
    return remainingReadout(job.remainingTicks, job.durationTicks, showTicks, secPerTick);
  }

  // Research button's title (and its inline "why not" text). tierLocked reads the
  // blueprint's tier to name the required lab level (canResearch blocks when
  // bp.tier > lab level, so reaching level == tier unlocks it). alreadyResearched
  // is never routed here by the markup (the researched ✓ branch handles it first),
  // but is mapped for exhaustiveness; notFound is a defensive fallback (a real
  // blueprint can't hit it). Mirrors dispatchBlockMessage's reason→text idiom.
  function researchBlockText(reason: ResearchBlockReason, bp: BlueprintDef): string {
    switch (reason) {
      case "inProgress":
        return "Researching…";
      case "tierLocked":
        return `Requires Research Lab level ${bp.tier}`;
      case "noSlot":
        return "All research slots busy";
      case "credits":
        return "Not enough credits";
      case "alreadyResearched":
        return "Already researched";
      case "notFound":
        return "Unavailable";
    }
  }

  // (Task C4) fabricateBlockText was RETIRED here with the Craft-tab order controls, the
  // per-line configurator's disabled Start now reads startLineBlockText (above), which maps the
  // shared StartLineBlockReason. canFabricate is no longer called from the UI either (the
  // Overview's fabricable count derives from blueprintUnlocked + tier directly).

  // ---- Fuel economy: production vs expenditure (Fuel Economy v2 F4, design §5;
  // net-display fix 2026-07-16) ----
  // Drives BOTH the top-bar fuel chip's tooltip AND the Fuel Depot Overview's refining-
  // status readout, so the two can never disagree (single derivation, shown twice).
  //
  // The player's core question is "is my fuel self-sustaining?", answered by netting
  // the Fuel Depot's refining PRODUCTION against the active missions' EXPENDITURE, both
  // expressed as fuel/tick (a tick is state.tickDurationSeconds seconds; default 1).
  //
  // NET-DISPLAY FIX (2026-07-16): all of this now derives from fuelFlowSummary(state)
  // (tick.ts), a PURE helper that mirrors processFuelPipelines' ice/tank/pipeline
  // gates. It replaced an inline block that subtracted burn from the refinery's MAX
  // (ceiling) throughput UNCONDITIONALLY, which showed a false NET POSITIVE while the
  // player was OUT of Deuterium Ice (the refinery really makes 0 then). The burn sum
  // that used to live inline here moved INTO the helper, ONE source of truth in the
  // engine. Var names are preserved so the rest of the template is untouched.
  $: fuelFlow = fuelFlowSummary(state);

  // MAX refining throughput (the CEILING), concurrent pipelines * fuel-per-batch /
  // batch-length-ticks. Still shown verbatim as the informational "Production (max)" /
  // "Refining (max)" line: it is the cap, NOT the guaranteed inflow (the pipelines
  // auto-throttle to nothing when the tank is full or Deuterium Ice runs out).
  $: fuelProductionPerTick = fuelFlow.maxProductionPerTick;
  // Deuterium Ice consumed at that full throughput (ice/tick), the input cost line.
  $: fuelIceInputPerTick = fuelFlow.iceInputPerTick;
  // EXPENDITURE (fuel/tick): steady-state mission burn, summed across active missions
  // (the sum now lives inside fuelFlowSummary; this just surfaces it under its old name).
  $: fuelExpenditurePerTick = fuelFlow.burnPerTick;

  // FUEL RUNWAY (Wave 2), "how long until the tank runs dry?" under a full-
  // sustainability model that credits mission-mined Deuterium Ice. The rates are
  // MEASURED, not modelled: emaDFuelPerTick/emaDIcePerTick are smoothed samples of
  // the live economy loop's actual per-tick deltas (updated in the poll callback,
  // which is why touching them there re-runs this reactive). We hold the readout at
  // null ("measuring…") until RUNWAY_WARMUP_SAMPLES have accrued so the first noisy
  // samples never render a wildly wrong countdown. fuelRunwayProjection is pure and
  // takes plain numbers, so we convert the Decimal fuel/cap/ice to numbers here.
  $: fuelRunway =
    runwaySamples < RUNWAY_WARMUP_SAMPLES
      ? null
      : fuelRunwayProjection({
          fuel: state.fuel.toNumber(),
          fuelCap: fuelCap(state).toNumber(),
          ice: itemTotal(state.inventory, "deuteriumIce").toNumber(),
          dFuelPerTick: emaDFuelPerTick,
          dIcePerTick: emaDIcePerTick,
          burnPerTick: fuelFlow.burnPerTick,
        });

  // NET (fuel/tick) now derives from EFFECTIVE production (0 when out of ice / no depot),
  // so it reads NEGATIVE when the refinery is idle for lack of ice, THE FIX. hasIce /
  // tankFull feed the chip's + panel's status lines; sufficient = net >= 0 || tankFull
  // (a topped-off tank is fine even while throttled to 0).
  $: fuelNetPerTick = fuelFlow.netPerTick;
  $: fuelHasIce = fuelFlow.hasIce;
  $: fuelTankFull = fuelFlow.tankFull;
  $: fuelSufficient = fuelFlow.sufficient;

  // Friendlier per-minute magnitudes. Ticks/minute = 60 / tickDurationSeconds (default
  // cadence 1s -> 60). NOTE: the dev speed multiplier scales production and expenditure
  // EQUALLY, so it never flips the sufficiency SIGN, only the displayed magnitude.
  $: fuelTicksPerMinute = 60 / Math.max(1, state.tickDurationSeconds);
  $: fuelProductionPerMinute = fuelProductionPerTick * fuelTicksPerMinute;
  $: fuelExpenditurePerMinute = fuelExpenditurePerTick * fuelTicksPerMinute;
  $: fuelIceInputPerMinute = fuelIceInputPerTick * fuelTicksPerMinute;
  $: fuelNetPerMinute = fuelNetPerTick * fuelTicksPerMinute;
  // Active-mission count for the tooltip's expenditure context ("across N missions").
  $: fuelActiveMissionCount = state.captains.filter((c) => c.mission !== null).length;
  // In-flight fuel refine batches (the Fuel Depot's pipelines), same kind-filter idiom
  // as activeRefineJobs. Drives the Fuel Depot Overview's per-batch progress bars; when
  // empty the depot is idle (tank full or Deuterium Ice out).
  $: activeFuelRefineJobs = state.activeProcesses.filter((p) => p.kind === "fuelRefineJob");
</script>

<!-- Window-level tooltip dismissal. Currency info-tooltip (2026-07-09): close an
     open chip tooltip on Escape or on any pointer-down outside a currency chip.
     Warehouse fill-tile tooltip (Phase 2): same tap-outside dismissal, outside a
     .warehouse-tile. Svelte fires BOTH on:pointerdown handlers for one event.
     See handleCurrencyOutsidePointer / handleWarehouseOutsidePointer /
     handleCurrencyKeydown in the script block. -->
<svelte:window
  on:pointerdown={handleCurrencyOutsidePointer}
  on:pointerdown={handleWarehouseOutsidePointer}
  on:keydown={handleCurrencyKeydown}
/>

<!-- SHARED facility-upgrade Build button (2026-07-24 flicker fix, DRY). This is the
     ONE place the tick-stable disabled-reason popover lives; every facility Build
     button renders through it, so the mechanism (hover wrapper, popover, positioning,
     and the single justified a11y-ignore) is defined exactly once. See the
     openUpgradeReasonKey block in the script for the full "why" of the fix.

     Params:
       key       unique string per button (e.g. "refinery", or a Warehouse tier's
                 wt.key). Keys the open-state so only the hovered button's popover shows.
       check     the button's real gate result { ok, reason? } from canBuildFacilityUpgrade
                 (or a sibling canUpgrade* fn). Drives BOTH the disabled state and the
                 popover text, so the popover can never drift from the live reason.
       label     the button caption (a plain string; callers pass any per-facility text).
       onBuild   the click handler (e.g. () => doStartFacilityUpgrade("refinery")).
       wrapStyle optional inline style for the wrapper (e.g. "margin-top: 8px;" to keep
                 the spacing a button previously carried). -->
{#snippet facilityUpgradeButton(
  key: string,
  check: { ok: boolean; reason?: string },
  label: string,
  onBuild: () => void,
  wrapStyle: string = ""
)}
  <!-- The hover region sits on this WRAPPER, NOT the button: a disabled <button>
       does not fire pointer events, so the wrapper is what catches the hover. The
       native `title` was removed on purpose, it was the flicker source. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- Intentional: this is a MOUSE-CONVENIENCE popover that only duplicates the
       shortfall already shown in the always-visible readiness rows above each
       button, so keyboard/screen-reader users lose nothing by it being hover-only.
       There is no accessible role for a bare hover-reveal container, and the button
       it wraps is (correctly) disabled, hence not a valid handler host. -->
  <div
    class="upgrade-reason-wrap"
    style={wrapStyle}
    on:mouseenter={() => showUpgradeReason(key)}
    on:mouseleave={() => hideUpgradeReason(key)}
  >
    <button class="buy-btn" disabled={!check.ok} on:click={onBuild}>
      {label}
    </button>
    <!-- Custom disabled-reason popover. Its open-state (openUpgradeReasonKey) is
         tick-independent, so the per-tick reason text updates in place without the
         popover resetting. Reuses the currency-tooltip look (opaque, bordered, shadow). -->
    {#if !check.ok && check.reason && openUpgradeReasonKey === key}
      <div class="currency-tooltip upgrade-reason-tooltip" role="tooltip">
        <div class="currency-tooltip-body">{check.reason}</div>
      </div>
    {/if}
  </div>
{/snippet}

<div class="root">
  <Starfield />
  <div class="frame">
    <div class="top-bar">
      <div class="top-bar-header">
        <!-- Header portrait, now the System settings entry point (0.11.2 Shell
             Correction, Task 3). A real <button> so Enter/Space activation and
             focus come for free (no manual keydown handler needed); it keeps the
             SAME .mission-portrait-frame/.top-bar-portrait classes (only its
             border switches dashed->solid, scoped to the header instance below),
             so the header's look is unchanged apart from a small ⚙ gear badge
             marking it as interactive. -->
        <button
          type="button"
          class="mission-portrait-frame top-bar-portrait"
          aria-label="Open admiral menu and settings"
          on:click={openSystemModal}
        >
          🖼️
          <span class="portrait-gear-badge" aria-hidden="true">⚙</span>
        </button>
        <div class="top-bar-info">
          <div class="top-bar-name">Fleet Admiral · Level {state.fleetAdminLevel}</div>
          <div class="top-bar-xp-row">
            <span class="top-bar-xp-label">Exp:</span>
            <div class="research-bar-track top-bar-xp-track">
              <div class="research-bar-fill" style="width:{Math.min(100, fleetAdminXpRatio * 100)}%"></div>
            </div>
            <span class="top-bar-xp-readout">{formatNumber(state.fleetAdminXp)}/{formatNumber(xpForNextFleetAdminLevel(state.fleetAdminLevel))} [{(fleetAdminXpRatio * 100).toFixed(1)}%]</span>
          </div>
        </div>
      </div>

      <!-- Currency strip (2026-07-09), fleet-wide resource readout in the top
           bar, sitting between the Fleet Admiral identity block above and the
           tick timer below. Data-driven: it renders one tappable chip per
           CURRENCY_META entry (see the script block), so adding a future
           currency (admin points, etc.) is a data edit, not markup surgery.
           Each chip shows an info tooltip (that currency's name + flavor text)
           on hover/focus/tap. Values come from currencyValues (reactive, Decimal-aware
           formatNumber) so the readout tracks state every tick. -->
      <div class="top-bar-currencies">
        {#each CURRENCY_META as c (c.key)}
          <div class="currency-chip-wrap">
            <button
              type="button"
              class="currency-chip"
              class:open={openCurrencyKey === c.key}
              aria-label={`${c.label}: ${currencyValues[c.key] ?? ""}`}
              aria-describedby={openCurrencyKey === c.key ? `currency-tooltip-${c.key}` : undefined}
              on:pointerenter={(e) => hoverEnterCurrency(e, c.key)}
              on:pointerleave={(e) => hoverLeaveCurrency(e, c.key)}
              on:focus={() => showCurrency(c.key)}
              on:blur={() => hideCurrency(c.key)}
              on:click={() => showCurrency(c.key)}
            >
              <span class="currency-chip-glyph" aria-hidden="true">{c.glyph}</span>
              <span class="currency-chip-value">{currencyValues[c.key] ?? ""}</span>
            </button>
            {#if openCurrencyKey === c.key}
              <!--
                Info tooltip: absolutely positioned below its own chip. No portal
                needed (unlike RadialWeb's node tooltip) because the top bar is
                not inside a backdrop-filter/transform containing block, so a
                normal absolute popover isn't clipped or mis-anchored. role=
                "tooltip" + a matching id (the chip's aria-describedby points
                here while open) tie chip + tooltip together for a11y.
              -->
              <div class="currency-tooltip" id={`currency-tooltip-${c.key}`} role="tooltip">
                <div class="currency-tooltip-title">{c.label}</div>
                <div class="currency-tooltip-body">{c.description}</div>
              </div>
            {/if}
          </div>
        {/each}

        <!-- Fuel chip (Fuel Economy v2 F4, design §5), a fuel indicator sitting
             beside the credits chip so tank level is visible AT A GLANCE. It is NOT a
             spendable currency (so it is deliberately NOT a CURRENCY_META entry, whose
             tooltip is a static flavor string); instead it MIRRORS the currency chip's
             markup + CSS + the full mouse-hover/tap/outside-tap mobile idiom, sharing
             the SAME openCurrencyKey token (key "fuel") so handleCurrencyOutsidePointer /
             handleCurrencyKeydown / hoverEnter/LeaveCurrency drive it verbatim, the
             ONLY difference is a richer, reactive tooltip body (production vs
             expenditure vs net) computed in the script block above. -->
        <div class="currency-chip-wrap">
          <button
            type="button"
            class="currency-chip"
            class:open={openCurrencyKey === "fuel"}
            aria-label={`Fuel: ${formatNumber(state.fuel)} of ${formatNumber(fuelCapValue)}`}
            aria-describedby={openCurrencyKey === "fuel" ? "currency-tooltip-fuel" : undefined}
            on:pointerenter={(e) => hoverEnterCurrency(e, "fuel")}
            on:pointerleave={(e) => hoverLeaveCurrency(e, "fuel")}
            on:focus={() => showCurrency("fuel")}
            on:blur={() => hideCurrency("fuel")}
            on:click={() => showCurrency("fuel")}
          >
            <span class="currency-chip-glyph" aria-hidden="true">⛽</span>
            <span class="currency-chip-value">{formatNumber(state.fuel)} / {formatNumber(fuelCapValue)}</span>
          </button>
          {#if openCurrencyKey === "fuel"}
            <!-- Fuel tooltip: same absolute-below-chip popover as the currency tooltip
                 (reuses .currency-tooltip / -title / -body). Body shows the fuel-
                 sufficiency breakdown: refining PRODUCTION (+ its ice cost), mission
                 EXPENDITURE, and the NET with a clear green/red sufficient/deficit line. -->
            <div class="currency-tooltip" id="currency-tooltip-fuel" role="tooltip">
              <div class="currency-tooltip-title">Fuel</div>
              <div class="currency-tooltip-body">
                <div class="fuel-tt-row">
                  <span>In tank</span>
                  <span>{formatNumber(state.fuel)} / {formatNumber(fuelCapValue)} ({Math.round(fuelFillPct)}%)</span>
                </div>
                <div class="fuel-tt-sep"></div>
                <div class="fuel-tt-row" style="color: var(--color-success);">
                  <span>Refining (max)</span>
                  <span>+{formatNumber(fuelProductionPerMinute)}/min</span>
                </div>
                <div class="fuel-tt-note">uses {formatNumber(fuelIceInputPerMinute)} Deuterium Ice/min · {fuelPipelineCount(state)} pipeline{fuelPipelineCount(state) === 1 ? "" : "s"}</div>
                <div class="fuel-tt-row" style="color: var(--color-danger);">
                  <span>Missions ({fuelActiveMissionCount})</span>
                  <span>−{formatNumber(fuelExpenditurePerMinute)}/min</span>
                </div>
                <div class="fuel-tt-sep"></div>
                <div class="fuel-tt-row" style="color: {fuelSufficient ? 'var(--color-success)' : 'var(--color-danger)'}; font-weight: 600;">
                  <span>Net</span>
                  <span>{fuelNetPerMinute >= 0 ? "+" : "−"}{formatNumber(Math.abs(fuelNetPerMinute))}/min</span>
                </div>
                <!-- Net status "why" line. Ordered so the ROOT reason wins: a
                     topped-off tank first (refining is throttled, but that's fine),
                     then out-of-ice (the net-display fix: refinery makes 0, so Net
                     is a pure drain), then the normal fuel-positive / draining split. -->
                <div class="fuel-tt-note">
                  {#if fuelTankFull}
                    Idle, tank full (topped off).
                  {:else if !fuelHasIce}
                    Refinery idle, out of Deuterium Ice (mine more via Operations).
                  {:else if fuelSufficient}
                    Fuel-positive, refining outpaces your missions.
                  {:else}
                    Draining, shortfalls auto-buy fuel with credits (+2-tick delay).
                  {/if}
                </div>
                <!-- FUEL RUNWAY (Wave 2): measured full-sustainability countdown to
                     fuel-empty. null=warming up ("measuring…"); sustainable=never
                     drains (∞, success green); finite=time left (warning, or danger
                     when under a minute); guarded-null=unknown ("--"). -->
                <div class="fuel-tt-sep"></div>
                {#if fuelRunway === null}
                  <div class="fuel-tt-row">
                    <span>Fuel runway</span>
                    <span>measuring…</span>
                  </div>
                {:else if fuelRunway.sustainable}
                  <div class="fuel-tt-row" style="color: var(--color-success); font-weight: 600;">
                    <span>Fuel runway</span>
                    <span>∞ self-sustaining</span>
                  </div>
                {:else if fuelRunway.runwayTicks !== null}
                  <div
                    class="fuel-tt-row"
                    style="color: {fuelRunway.runwayTicks * state.tickDurationSeconds < 60 ? 'var(--color-danger)' : 'var(--color-warning)'}; font-weight: 600;"
                  >
                    <span>Fuel runway</span>
                    <span>{formatDuration(fuelRunway.runwayTicks, state.tickDurationSeconds)} left</span>
                  </div>
                {:else}
                  <div class="fuel-tt-row">
                    <span>Fuel runway</span>
                    <span>--</span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>

      {#if tickBarEnabled}
      <div class="top-bar-tick-row">
        <span class="top-bar-tick-label">TICK:</span>
        <div class="tick-bar-track top-bar-tick-track">
          <div class="tick-bar-fill" style="width:{globalTickProgress * 100}%"></div>
        </div>
        <span class="top-bar-tick-readout">{globalTickRemaining.toFixed(1)}s</span>
      </div>
      {/if}
    </div>

    <main class="tab-body">
      {#if activeTab === "facilities"}
      <!-- FACILITIES program (0.12.0 "Console" nav, CN4a). The BUILDING
           perspective: every building the player manages. Converted from the
           transitional Foundry tab's LEFT RAIL to the console model, the SAME
           grid-then-detail pattern the Personnel Captain Roster and the Logistics
           Ships console use (no left rail anywhere, design doc section 4). The
           landing is a DASHBOARD: a responsive .roster-grid of building cards (one
           per facility), each showing the building name + its level (where it has
           one) + a LIVE status line read from the SAME $: derivations the
           building's own Overview shows, so a card can never drift from the panel.
           Tapping a card opens that building's CONSOLE (facilitiesView =
           "console", activeFoundryFacility = the card's key): a back-to-dashboard
           control + the building's EXISTING content rendered VERBATIM (its own
           SubTabs strip and panes UNCHANGED, only the surrounding nav changed from
           rail to dashboard/back-row). This is a mechanical re-home, not a
           redesign. The Drydock tab's two facilities (Shipyard + Docks) folded in
           here in CN4b, so the Drydock tab is now retired; they are the last two
           cards on the dashboard + the last two branches of the console chain. -->
      <div class="tab-scroll-area">
        {#if facilitiesView === "dashboard"}
          <!-- FACILITIES DASHBOARD. The SAME responsive card grid the Captain
               Roster + Ships console use (.roster-grid: auto-fill, fills the
               desktop width with more cards per row, collapses to one column on
               mobile, NO media query). Each card is a button that opens the
               building's console. Level + status come from EXISTING $: derivations
               only (NO new state invented); each card names its source inline. -->
          <div class="roster-grid">
            <!-- Refinery card. Level = refineryLevel; status = live refine slots in
                 use vs total (activeRefineJobs / refinerySlots), the SAME figures
                 the Refinery Overview shows. Slots 0 = not built yet. -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "refinery";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">⚗️</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.refinery}</div>
                  <div class="roster-card-sub">Level {refineryLevel}</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  {#if refinerySlots === 0}
                    Status: Not built
                  {:else if activeRefineJobs.length === 0}
                    Status: Idle, {refinerySlots} slot{refinerySlots === 1 ? "" : "s"} free
                  {:else}
                    Status: {activeRefineJobs.length} / {refinerySlots} slots refining
                  {/if}
                </div>
              </div>
            </button>

            <!-- Fabricator card. Level = fabricatorLevel; status = live craft slots
                 in use vs total (activeFabricateJobs / fabricateSlots). -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "fabricator";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">🔧</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.fabricator}</div>
                  <div class="roster-card-sub">Level {fabricatorLevel}</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  {#if fabricateSlots === 0}
                    Status: Not built
                  {:else if activeFabricateJobs.length === 0}
                    Status: Idle, {fabricateSlots} slot{fabricateSlots === 1 ? "" : "s"} free
                  {:else}
                    Status: {activeFabricateJobs.length} / {fabricateSlots} slots crafting
                  {/if}
                </div>
              </div>
            </button>

            <!-- Research Lab card. Level = researchLevel; status = live research
                 slots in use vs total (activeResearchProjects / researchSlots). -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "research";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">🔬</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.research}</div>
                  <div class="roster-card-sub">Level {researchLevel}</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  {#if researchSlots === 0}
                    Status: Not built
                  {:else if activeResearchProjects.length === 0}
                    Status: Idle, {researchSlots} slot{researchSlots === 1 ? "" : "s"} free
                  {:else}
                    Status: {activeResearchProjects.length} / {researchSlots} projects running
                  {/if}
                </div>
              </div>
            </button>

            <!-- Fuel Depot card. Level = fuelStorageLevel; status = live refine
                 batches (activeFuelRefineJobs = topping up) + tank fill %
                 (fuelFillPct), the SAME figures the Fuel Depot Overview shows. -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "fuelStorage";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">⛽</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.fuelStorage}</div>
                  <div class="roster-card-sub">Level {fuelStorageLevel}</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  {#if activeFuelRefineJobs.length > 0}
                    Status: Topping up
                  {:else if fuelFillPct >= 100}
                    Status: Tank full
                  {:else}
                    Status: Idle
                  {/if}
                </div>
                <div class="roster-card-line">Fuel: {Math.round(fuelFillPct)}%</div>
              </div>
            </button>

            <!-- Warehouse card. Level = warehouseT1Level; status = how many
                 discovered items are AT cap (warehouseItemsAtCap), the auto-stop
                 "expand storage" set the Warehouse Overview surfaces. -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "warehouse";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">📦</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.warehouse}</div>
                  <div class="roster-card-sub">Level {warehouseT1Level}</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  {#if warehouseItemsAtCap.length === 0}
                    Status: No items at cap
                  {:else}
                    Status: {warehouseItemsAtCap.length} item{warehouseItemsAtCap.length === 1 ? "" : "s"} at cap
                  {/if}
                </div>
              </div>
            </button>

            <!-- Salvage Bay card. No facility level (no build/upgrade track); the
                 LIVE status reuses spareEquipmentCount(state), the SAME spare
                 crafted-systems count the Ship Equipment bay header shows, which is
                 exactly the pool salvageable here (every spare in the bay). -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "salvageBay";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">♻️</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.salvageBay}</div>
                  <div class="roster-card-sub">Recycling bay</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  Status: {spareEquipmentCount(state)} spare system{spareEquipmentCount(state) === 1 ? "" : "s"} to salvage
                </div>
              </div>
            </button>

            <!-- Shipyard card (folded in from the retired Drydock tab, CN4b).
                 Level = shipyardLevel (0 = not founded); live status = whether a
                 hull is building (activeShipBuild, the SAME in-flight process the
                 Shipyard Build pane shows) vs idle. -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "shipyard";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">🛠️</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.shipyard}</div>
                  <div class="roster-card-sub">Level {shipyardLevel}</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  {#if !shipyardFounded}
                    Status: Not founded
                  {:else if activeShipBuild}
                    Status: Building a hull
                  {:else}
                    Status: Idle
                  {/if}
                </div>
              </div>
            </button>

            <!-- Docks card (folded in from the retired Drydock tab, CN4b). No
                 build/upgrade LEVEL; live status = ship-storage berths used vs cap
                 (state.ships.length / state.shipStorageCapacity), the SAME figures
                 the Docks capacity readout shows. -->
            <button
              class="roster-card"
              on:click={() => {
                activeFoundryFacility = "docks";
                facilitiesView = "console";
              }}
            >
              <div class="roster-card-head">
                <div class="roster-card-glyph" aria-hidden="true">🚉</div>
                <div class="roster-card-heading">
                  <div class="research-name">{FACILITY_LABELS.docks}</div>
                  <div class="roster-card-sub">Ship storage</div>
                </div>
              </div>
              <div class="roster-card-lines">
                <div class="roster-card-line">
                  Status: {state.ships.length} / {state.shipStorageCapacity} berths used
                </div>
              </div>
            </button>
          </div>
        {:else}
          <!-- BUILDING CONSOLE. A back-to-dashboard control + the selected
               building's EXISTING content rendered VERBATIM below. The building is
               activeFoundryFacility (set when the card was tapped); every content
               branch below is UNCHANGED from the old rail, only its surrounding nav
               moved from a left rail to this dashboard/back-row model, the SAME
               back-row idiom the captain + ship consoles use. -->
          <div class="roster-back-row">
            <button
              class="dev-btn"
              on:click={() => (facilitiesView = "dashboard")}
            >
              ← Facilities
            </button>
            <div class="research-name roster-detail-name">{FACILITY_LABELS[activeFoundryFacility]}</div>
          </div>
          {#if activeFoundryFacility === "refinery"}
            <SubTabs
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "orders", label: "Production" },
                { key: "upgrades", label: "Upgrades" },
                { key: "refineryLocked1", label: "Coming Soon!", locked: true },
              ]}
              active={activeRefinerySubTab}
              onSelect={(key) => (activeRefinerySubTab = key as RefinerySubTab)}
            />

            {#if activeRefinerySubTab === "overview"}
              <!-- OVERVIEW, refinery level, slot usage, and any in-flight refine
                   jobs (progress bar + ticks remaining). The one-shot recipe
                   readout + Start Refine Job button were RETIRED in S4, refining
                   is now configured per-slot in the Production sub-tab. This tab is
                   now a pure status readout (no start action). -->
              <Panel>
                <div class="panel-title">REFINERY</div>
                <div class="research-cost">Level: {refineryLevel}</div>
                <div class="research-cost">Refine slots: {activeRefineJobs.length} / {refinerySlots} in use</div>

                <!-- Active refine jobs, one progress card each. remainingTicks /
                     durationTicks are read straight off the TimedProcess; progress
                     is how much of the duration has elapsed. Reuses the same
                     research-bar-track/fill/readout the mission + captain-XP bars
                     use (NOT a new bar style). -->
                {#if activeRefineJobs.length > 0}
                  <div class="research-cost" style="margin-top: 10px;">Active jobs:</div>
                  {#each activeRefineJobs as job (job.id)}
                    {@const progress = job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 1}
                    <div class="mission-card">
                      <div class="research-name">
                        {#if job.effect.type === "addItem"}Refining → [{ITEMS[job.effect.itemId]?.label ?? job.effect.itemId}]{:else}Refine job{/if}
                      </div>
                      <div class="research-bar-track">
                        <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                      </div>
                      <div class="research-readout">{remainingReadout(job.remainingTicks, job.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                    </div>
                  {/each}
                {/if}
              </Panel>
            {/if}

            {#if activeRefinerySubTab === "orders"}
              <!-- PRODUCTION LINES (Crafting Allocation Redesign, Task C4), one panel
                   per refinery slot. ACTIVE lines (state.refineLines) render first, each
                   as a card with a Cancel button (top-right, danger), its recipe, a
                   progress bar, and the tick readout (via remainingReadout, off the line's
                   in-flight job matched by lineId). Remaining IDLE slots render a compact
                   "configure a craft" prompt that expands into the tier→item→qty→REQUIRES
                   →Start configurator (only one open at a time). All gates read the shared
                   canStartLine / maxAffordableIterations; the REQUIRES preview reads the
                   derived allocation helpers (free/allocated/total). Reuses .mission-card /
                   .buy-btn / .dev-btn.danger + the .research-* classes. -->
              <Panel>
                <div class="panel-title">PRODUCTION LINES</div>
                <div class="research-cost">Refine slots: {(state.refineLines ?? []).length} / {refinerySlots} in use</div>

                {#if !refineryBuilt}
                  <p class="research-status" style="margin-top: 10px;">
                    Build the <strong>Refinery</strong> first (see Upgrades) to run production lines.
                  </p>
                {:else}
                  {@const refineLines = state.refineLines ?? []}
                  {@const idleSlots = Math.max(0, refinerySlots - refineLines.length)}

                  <!-- Active refine lines (one card each). -->
                  {#each refineLines as line, li (line.id)}
                    {@const recipe = REFINE_RECIPES[line.recipeKey]}
                    {@const job = state.activeProcesses.find((p) => p.lineId === line.id)}
                    {@const progress = job && job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 0}
                    <div class="mission-card" style="margin-top: 10px;">
                      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <div class="research-name">LINE {li + 1} · REFINING</div>
                        <!-- Cancel is only offered while iterations remain to STOP. When
                             remaining is 0 the line is finishing its last/in-flight iteration
                             (either naturally, or drained by a prior Cancel), nothing left to
                             cancel, so it just shows "finishing" until it clears itself. -->
                        {#if line.remaining > 0}
                          <button class="dev-btn danger" on:click={() => doCancelLine(line.id)}>Cancel</button>
                        {/if}
                      </div>
                      <div class="research-cost">
                        {#if recipe}
                          {#each Object.keys(recipe.input) as inId, i}{formatNumber(recipe.input[inId])}× [{ITEMS[inId]?.label ?? inId}]{i < Object.keys(recipe.input).length - 1 ? " + " : ""}{/each}
                          → [{ITEMS[recipe.output.itemId]?.label ?? recipe.output.itemId}]
                        {:else}[{line.recipeKey}]{/if}
                        · {line.remaining > 0 ? (line.mode.kind === "batch" ? `batch ${line.remaining}` : "continuous") : "finishing current run"}
                      </div>
                      <div class="research-bar-track">
                        <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                      </div>
                      <div class="research-readout">
                        {#if job}{lineRemainingReadout(job, line, showTickCounts, state.tickDurationSeconds)}{:else}Queued, starts next tick{/if}
                      </div>
                    </div>
                  {/each}

                  <!-- Idle slots: a compact prompt that expands into the configurator. -->
                  {#each Array(idleSlots) as _, idx}
                    {@const slotIndex = refineLines.length + idx}
                    {@const isOpen = openConfig?.kind === "refine" && openConfig.slotIndex === slotIndex}
                    {#if isOpen}
                      {@const maxQty = maxAffordableIterations(state, "refine", cfgRecipeKey)}
                      {@const gate = canStartLine(state, "refine", cfgRecipeKey, Math.floor(cfgQty))}
                      {@const perIteration = lineInputsPerIteration({ id: "", kind: "refine", recipeKey: cfgRecipeKey, remaining: 0, mode: { kind: "continuous" } })}
                      <div class="mission-card" style="margin-top: 10px;">
                        <div class="research-name">Line {slotIndex + 1} · configure a craft</div>

                        <!-- Tier dropdown (refine recipes carry no tier -> a single Tier 1). -->
                        <div class="dev-row" style="margin-top: 8px; align-items: center;">
                          <label style="display: inline-flex; align-items: center; gap: 6px;">
                            Tier
                            <select class="modal-input" bind:value={cfgTier} aria-label="Tier">
                              <option value={1}>Tier 1</option>
                            </select>
                          </label>
                          <!-- Item dropdown: every refine recipe, labelled by its output item. -->
                          <label style="display: inline-flex; align-items: center; gap: 6px;">
                            Item
                            <select class="modal-input" bind:value={cfgRecipeKey} aria-label="Item">
                              {#each Object.keys(REFINE_RECIPES) as rk}
                                <option value={rk}>{ITEMS[REFINE_RECIPES[rk].output.itemId]?.label ?? rk}</option>
                              {/each}
                            </select>
                          </label>
                          <!-- Qty field, bounded 1..maxAffordableIterations. -->
                          <label style="display: inline-flex; align-items: center; gap: 6px;">
                            Qty
                            <input class="modal-input" type="number" min="1" max={maxQty} step="1" style="width: 80px;" bind:value={cfgQty} aria-label="Quantity" />
                            <span class="research-cost">(max {maxQty})</span>
                          </label>
                        </div>

                        <!-- REQUIRES (×qty) preview: per input, its per/ea → total, plus free / allocated / total. -->
                        <div class="research-cost" style="margin-top: 8px;">REQUIRES (×{Math.max(1, Math.floor(cfgQty))})</div>
                        {#each Object.keys(perIteration) as itemId}
                          {@const per = perIteration[itemId]}
                          {@const total = per.times(Math.max(1, Math.floor(cfgQty)))}
                          {@const free = freeItem(state.inventory, allLines, itemId)}
                          {@const allocated = allocatedItem(allLines, itemId)}
                          {@const stock = itemTotal(state.inventory, itemId)}
                          <div class="mission-card" style="margin-top: 4px;">
                            <div class="research-cost">[{ITEMS[itemId]?.label ?? itemId}] · {formatNumber(per)}/ea → {formatNumber(total)}</div>
                            <div class="research-cost" style="color: var(--color-success);">Free {formatNumber(free)}</div>
                            <div class="research-cost">Allocated {formatNumber(allocated)} · Total {formatNumber(stock)}</div>
                          </div>
                        {/each}

                        <div class="dev-row" style="margin-top: 8px;">
                          <button
                            class="buy-btn"
                            disabled={!gate.ok}
                            title={gate.ok ? undefined : startLineBlockText(gate.reason)}
                            on:click={() => doStartLine("refine", cfgRecipeKey, { kind: "batch", remaining: Math.floor(cfgQty) })}
                          >
                            Refine · ×{Math.max(1, Math.floor(cfgQty))}
                          </button>
                          <button class="dev-btn" on:click={closeConfigurator}>Close</button>
                        </div>
                      </div>
                    {:else}
                      <button class="buy-btn" style="margin-top: 10px; width: 100%; text-align: left;" on:click={() => openConfigurator("refine", slotIndex)}>
                        Line {slotIndex + 1} · idle, configure a craft
                      </button>
                    {/if}
                  {/each}
                {/if}
              </Panel>
            {/if}

            {#if activeRefinerySubTab === "upgrades"}
              <!-- UPGRADES, the NEXT rung of the Refinery's finite upgrade track
                   (FACILITIES.refinery.upgrades[level]; undefined = maxed). Shows
                   each required material as [Item]: have / need with a ✅/❌
                   readiness mark, the FA-level + Homeworld-talent prereqs (❌ when
                   unmet), and a Build button gated on canBuildFacilityUpgrade. If
                   an upgrade is already in flight, a "Currently upgrading" progress
                   row shows (and the backend's own gate makes Build unavailable,
                   surfaced via the button title). Readiness colors use the
                   existing --color-success / --color-danger tokens inline (no new
                   class), per the task's "reuse the readiness-color tokens" note. -->
              <Panel>
                <div class="panel-title">REFINERY UPGRADES</div>
                <div class="research-cost">Level: {refineryLevel}</div>

                {#if refineryMaxed}
                  <!-- Finite track maxed, no rung past the current level. -->
                  <p class="research-status">Fully upgraded.</p>
                {:else}
                  {@const eff = nextRefineryUpgrade.effect}
                  <div class="research-name">Next: Level {refineryLevel} → {refineryLevel + 1}</div>
                  <div class="research-cost">
                    Grants: {#if "addRefineSlots" in eff}+{eff.addRefineSlots} refine slot{eff.addRefineSlots === 1 ? "" : "s"}{:else if "refineSpeedMult" in eff}{eff.refineSpeedMult}× refine speed{/if}
                    · Duration: {durationReadout(nextRefineryUpgrade.durationTicks, showTickCounts, state.tickDurationSeconds)}
                  </div>

                  <!-- Material readiness: [Item]: have / need, ✅ (have≥need) or ❌. -->
                  {#each Object.keys(nextRefineryUpgrade.materials) as itemId}
                    {@const need = nextRefineryUpgrade.materials[itemId]}
                    <!-- have = the reservation-aware FREE amount (inventory MINUS what active
                         craft lines reserve), the SAME value canBuildFacilityUpgrade spends
                         against, so this readiness row can never contradict the Build button
                         (the "shows 1.52M but says not enough" bug). reserved = stock - free
                         is surfaced so the number reading below the Warehouse's raw total is
                         self-explanatory. -->
                    {@const stock = itemTotal(state.inventory, itemId)}
                    {@const have = freeItemForState(state, itemId)}
                    {@const reserved = stock.minus(have)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}{#if reserved.gt(0)} ({formatNumber(reserved)} reserved){/if}
                    </div>
                  {/each}

                  <!-- Fleet Admiral level prereq (absent field => no wall). -->
                  {#if nextRefineryUpgrade.requiresFleetAdminLevel !== undefined}
                    {@const met = state.fleetAdminLevel >= nextRefineryUpgrade.requiresFleetAdminLevel}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Requires Fleet Admiral level {nextRefineryUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                    </div>
                  {/if}

                  <!-- Homeworld-talent prereqs, each listed talent must be
                       unlocked fleet-wide. Named by HOMEWORLD_TALENTS[key].label
                       (the same label the talent tree shows), not the raw key. -->
                  {#if nextRefineryUpgrade.requiresHomeworldTalents}
                    {#each nextRefineryUpgrade.requiresHomeworldTalents as talentKey}
                      {@const met = state.unlockedHomeworldTalents.includes(talentKey)}
                      <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                        {met ? "✅" : "❌"} Requires Homeworld Talent: {HOMEWORLD_TALENTS[talentKey].label}
                      </div>
                    {/each}
                  {/if}

                  <!-- Build, gated on the backend predicate; its .reason is the
                       "why not" shown in the shared tick-stable popover when the
                       button is disabled (covers the "Upgrade already in progress"
                       case below, plus any unmet material/prereq the readiness rows
                       above already show). -->
                  {@render facilityUpgradeButton(
                    "refinery",
                    refineryUpgradeCheck,
                    `Build · Level ${refineryLevel} → ${refineryLevel + 1}`,
                    () => doStartFacilityUpgrade("refinery")
                  )}
                {/if}

                <!-- In-flight upgrade progress (independent of the maxed check --
                     while a rung builds, level hasn't bumped yet, so
                     nextRefineryUpgrade still points at the in-flight rung). -->
                {#if refineryUpgradeInFlight}
                  {@const progress = refineryUpgradeInFlight.durationTicks > 0
                    ? (refineryUpgradeInFlight.durationTicks - refineryUpgradeInFlight.remainingTicks) / refineryUpgradeInFlight.durationTicks
                    : 1}
                  <div class="research-name" style="margin-top: 10px;">Currently upgrading…</div>
                  <div class="research-bar-track">
                    <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                  </div>
                  <div class="research-readout">{remainingReadout(refineryUpgradeInFlight.remainingTicks, refineryUpgradeInFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                {/if}
              </Panel>
            {/if}
          {:else if activeFoundryFacility === "fabricator"}
            <!-- FABRICATOR (Fabricator Task F4; Craft tab reworked in Task C4), the
                 component-crafting facility. It CONSUMES the researched blueprints from the
                 Research Lab: three sub-tabs mirroring the Research Lab's STRUCTURE (Overview /
                 Craft / Upgrades). Overview = slots in use + in-flight craft jobs (progress bar
                 + real time remaining) + researched-vs-fabricable counts + the Shipyard
                 signpost. Craft = the per-slot PRODUCTION LINES view (active fabricate lines +
                 the tier→item→qty→REQUIRES→Start configurator on idle slots), the direct mirror
                 of the Refinery's Production tab, driven by the shared startLine / cancelLine /
                 canStartLine / maxAffordableIterations seams. Upgrades = the fabricator's tier/
                 slot track wired to the SHARED canBuildFacilityUpgrade / doStartFacilityUpgrade.
                 Readiness/actions read the SAME tick.ts fns + model.ts tables (FACILITIES.
                 fabricator / BLUEPRINTS / ITEMS), so the UI can't drift from what the backend
                 enforces. Reuses the research/refine progress-bar idiom + the .mission-card /
                 .buy-btn / .dev-btn / .research-* classes (no new markup style). -->
            <SubTabs
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "craft", label: "Craft" },
                { key: "upgrades", label: "Upgrades" },
              ]}
              active={activeFabricatorSubTab}
              onSelect={(key) => (activeFabricatorSubTab = key as FabricatorSubTab)}
            />

            {#if activeFabricatorSubTab === "overview"}
              <!-- OVERVIEW, fabricator level, craft-slot usage, any in-flight craft
                   jobs (progress bar + real time remaining, the SAME idiom the refine/
                   research jobs use), the fabricable-vs-researched count, and the forward
                   SIGNPOST that components become usable with the Shipyard. -->
              <Panel>
                <div class="panel-title">FABRICATOR</div>
                <div class="research-cost">Level: {fabricatorLevel}</div>
                <div class="research-cost">Craft slots: {activeFabricateJobs.length} / {fabricateSlots} in use</div>
                <div class="research-cost">Blueprints fabricable: {fabricableBlueprintCount} / {researchedBlueprintCount} researched</div>

                <!-- In-flight fabricate jobs, one progress card each. progress is how
                     much of the duration has elapsed (durationTicks - remainingTicks over
                     durationTicks), read straight off the fabricateJob TimedProcess, the
                     SAME derivation the refine/research bars use. The job names the
                     component it is crafting (effect.itemId -> label). -->
                {#if activeFabricateJobs.length > 0}
                  <div class="research-cost" style="margin-top: 10px;">In progress:</div>
                  {#each activeFabricateJobs as job (job.id)}
                    {@const progress = job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 1}
                    <div class="mission-card">
                      <div class="research-name">
                        {#if job.effect.type === "addItem"}Fabricating → [{ITEMS[job.effect.itemId]?.label ?? job.effect.itemId}]{:else if job.effect.type === "addEquipment" && (BLUEPRINTS[job.effect.blueprintKey]?.weaponOutput || BLUEPRINTS[job.effect.blueprintKey]?.droneOutput)}Fabricating → [{craftedInstanceBlueprintLabel(BLUEPRINTS[job.effect.blueprintKey])}]{:else if job.effect.type === "addEquipment" && BLUEPRINTS[job.effect.blueprintKey]?.equipmentOutput}Fabricating → [{equipmentOutputLabel(BLUEPRINTS[job.effect.blueprintKey].equipmentOutput!)}]{:else}Fabricate job{/if}
                      </div>
                      <div class="research-bar-track">
                        <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                      </div>
                      <div class="research-readout">{remainingReadout(job.remainingTicks, job.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                    </div>
                  {/each}
                {:else}
                  <p class="research-status" style="margin-top: 10px;">No active fabricate jobs.</p>
                {/if}

                <!-- Forward signpost (design F4): fabricated components aren't usable until
                     the Shipyard, the next feature. -->
                <p class="research-status" style="margin-top: 10px; color: var(--color-text-secondary);">
                  Fabricated components become usable when the <strong>Shipyard</strong> comes online (next feature).
                </p>
              </Panel>
            {/if}

            {#if activeFabricatorSubTab === "craft"}
              <!-- CRAFT (Crafting Allocation Redesign, Task C4), the Fabricator's per-slot
                   PRODUCTION LINES view, the DIRECT mirror of the Refinery's Production tab:
                   active fabricate lines (state.fabricateLines) render first (card + Cancel +
                   recipe + progress + tick readout), then idle slots render the tier→item→
                   qty→REQUIRES→Start configurator. The tier/item dropdowns list only RESEARCHED
                   + tier-available blueprints (availableFabricateBlueprints); with none available
                   the idle slots collapse to the Research-Lab signpost. All gates read the shared
                   canStartLine / maxAffordableIterations; the REQUIRES preview reads the derived
                   allocation helpers. Reuses .mission-card / .buy-btn / .dev-btn.danger. -->
              <Panel>
                <div class="panel-title">CRAFT</div>
                <div class="research-cost">Craft slots: {(state.fabricateLines ?? []).length} / {fabricateSlots} in use</div>

                {#if !fabricatorBuilt}
                  <p class="research-status" style="margin-top: 10px;">
                    Build the <strong>Fabricator</strong> first (see Upgrades) to run production lines.
                  </p>
                {:else}
                  {@const fabricateLines = state.fabricateLines ?? []}
                  {@const idleSlots = Math.max(0, fabricateSlots - fabricateLines.length)}

                  <!-- Active fabricate lines (one card each). -->
                  {#each fabricateLines as line, li (line.id)}
                    {@const bp = BLUEPRINTS[line.recipeKey]}
                    {@const job = state.activeProcesses.find((p) => p.lineId === line.id)}
                    {@const progress = job && job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 0}
                    <div class="mission-card" style="margin-top: 10px;">
                      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <div class="research-name">LINE {li + 1} · FABRICATING</div>
                        <!-- Cancel only while iterations remain to stop (see the refine card above). -->
                        {#if line.remaining > 0}
                          <button class="dev-btn danger" on:click={() => doCancelLine(line.id)}>Cancel</button>
                        {/if}
                      </div>
                      <div class="research-cost">
                        {#if bp}
                          {#each Object.keys(bp.recipe.inputs) as inId, i}{bp.recipe.inputs[inId]}× [{ITEMS[inId]?.label ?? inId}]{i < Object.keys(bp.recipe.inputs).length - 1 ? " + " : ""}{/each}
                          <!-- Task 19: an EQUIPMENT blueprint shows its minted piece's SYSTEM name
                               (slot + variety); it carries no recipe.outputItem (optional, omitted).
                               Combat 1.0 (Unit 1.2b + 2.1b): a WEAPON or DRONE-POD blueprint shows its
                               stripped name. Only a MATERIAL blueprint has a stackable output to render. -->
                          {#if bp.weaponOutput || bp.droneOutput}
                            → [{craftedInstanceBlueprintLabel(bp)}]
                          {:else if bp.equipmentOutput}
                            → [{equipmentOutputLabel(bp.equipmentOutput)}]
                          {:else}
                            → {bp.recipe.outputQty}× [{ITEMS[bp.recipe.outputItem ?? ""]?.label ?? bp.recipe.outputItem}]
                          {/if}
                        {:else}[{line.recipeKey}]{/if}
                        · {line.remaining > 0 ? (line.mode.kind === "batch" ? `batch ${line.remaining}` : "continuous") : "finishing current run"}
                      </div>
                      <div class="research-bar-track">
                        <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                      </div>
                      <div class="research-readout">
                        {#if job}{lineRemainingReadout(job, line, showTickCounts, state.tickDurationSeconds)}{:else}Queued, starts next tick{/if}
                      </div>
                    </div>
                  {/each}

                  <!-- Idle slots: the configurator, OR the Research-Lab signpost when nothing
                       is researched + tier-available to configure. -->
                  {#if idleSlots > 0 && availableFabricateBlueprints.length === 0}
                    <p class="research-status" style="margin-top: 12px;">
                      Research blueprints at the <strong>Research Lab</strong> to unlock things to fabricate.
                    </p>
                  {:else}
                    {#each Array(idleSlots) as _, idx}
                      {@const slotIndex = fabricateLines.length + idx}
                      {@const isOpen = openConfig?.kind === "fabricate" && openConfig.slotIndex === slotIndex}
                      {#if isOpen}
                        {@const maxQty = maxAffordableIterations(state, "fabricate", cfgRecipeKey)}
                        {@const gate = canStartLine(state, "fabricate", cfgRecipeKey, Math.floor(cfgQty))}
                        {@const perIteration = lineInputsPerIteration({ id: "", kind: "fabricate", recipeKey: cfgRecipeKey, remaining: 0, mode: { kind: "continuous" } })}
                        <div class="mission-card" style="margin-top: 10px;">
                          <div class="research-name">Line {slotIndex + 1} · configure a craft</div>

                          <div class="dev-row" style="margin-top: 8px; align-items: center;">
                            <!-- Tier dropdown: the researched + tier-available tiers. -->
                            <label style="display: inline-flex; align-items: center; gap: 6px;">
                              Tier
                              <select class="modal-input" value={cfgTier} on:change={(e) => onFabricateTierChange(Number((e.target as HTMLSelectElement).value))} aria-label="Tier">
                                {#each availableFabricateTiers as t}
                                  <option value={t}>Tier {t}</option>
                                {/each}
                              </select>
                            </label>
                            <!-- Item dropdown: the blueprints in the selected tier. -->
                            <label style="display: inline-flex; align-items: center; gap: 6px;">
                              Item
                              <select class="modal-input" bind:value={cfgRecipeKey} aria-label="Item">
                                {#each fabricateKeysForTier(cfgTier) as bk}
                                  <option value={bk}>{BLUEPRINTS[bk]?.label ?? bk}</option>
                                {/each}
                              </select>
                            </label>
                            <!-- Qty field, bounded 1..maxAffordableIterations. -->
                            <label style="display: inline-flex; align-items: center; gap: 6px;">
                              Qty
                              <input class="modal-input" type="number" min="1" max={maxQty} step="1" style="width: 80px;" bind:value={cfgQty} aria-label="Quantity" />
                              <span class="research-cost">(max {maxQty})</span>
                            </label>
                          </div>

                          <!-- REQUIRES (×qty) preview: per input, per/ea → total, plus free / allocated / total. -->
                          <div class="research-cost" style="margin-top: 8px;">REQUIRES (×{Math.max(1, Math.floor(cfgQty))})</div>
                          {#each Object.keys(perIteration) as itemId}
                            {@const per = perIteration[itemId]}
                            {@const total = per.times(Math.max(1, Math.floor(cfgQty)))}
                            {@const free = freeItem(state.inventory, allLines, itemId)}
                            {@const allocated = allocatedItem(allLines, itemId)}
                            {@const stock = itemTotal(state.inventory, itemId)}
                            <div class="mission-card" style="margin-top: 4px;">
                              <div class="research-cost">[{ITEMS[itemId]?.label ?? itemId}] · {formatNumber(per)}/ea → {formatNumber(total)}</div>
                              <div class="research-cost" style="color: var(--color-success);">Free {formatNumber(free)}</div>
                              <div class="research-cost">Allocated {formatNumber(allocated)} · Total {formatNumber(stock)}</div>
                            </div>
                          {/each}

                          <div class="dev-row" style="margin-top: 8px;">
                            <button
                              class="buy-btn"
                              disabled={!gate.ok}
                              title={gate.ok ? undefined : startLineBlockText(gate.reason, BLUEPRINTS[cfgRecipeKey])}
                              on:click={() => doStartLine("fabricate", cfgRecipeKey, { kind: "batch", remaining: Math.floor(cfgQty) })}
                            >
                              Fabricate · ×{Math.max(1, Math.floor(cfgQty))}
                            </button>
                            <button class="dev-btn" on:click={closeConfigurator}>Close</button>
                          </div>
                        </div>
                      {:else}
                        <button class="buy-btn" style="margin-top: 10px; width: 100%; text-align: left;" on:click={() => openConfigurator("fabricate", slotIndex)}>
                          Line {slotIndex + 1} · idle, configure a craft
                        </button>
                      {/if}
                    {/each}
                  {/if}
                {/if}
              </Panel>
            {/if}

            {#if activeFabricatorSubTab === "upgrades"}
              <!-- UPGRADES, the Fabricator's finite tier/slot track
                   (FACILITIES.fabricator.upgrades[level]; caps at length 2 today). Each
                   next rung grants a craft slot AND unlocks the next blueprint tier for
                   fabrication. Cost is CREDITS (materials are the per-craft cost, not the
                   upgrade cost), so the credits gate leads; the materials loop is kept
                   (empty today) to mirror the sibling upgrade tabs. Build is wired to the
                   SHARED canBuildFacilityUpgrade / doStartFacilityUpgrade, NOT
                   re-implemented. A LINE-FOR-LINE clone of the Research Lab's Upgrades
                   tab, swapping research→fabricator vars + addResearchSlots→
                   addFabricateSlots. In-flight progress reuses the refine/research bar
                   idiom. -->
              <Panel>
                <div class="panel-title">FABRICATOR, Upgrades</div>
                <div class="research-cost">Level: {fabricatorLevel}</div>

                {#if fabricatorMaxed}
                  <p class="research-status">Fully upgraded.</p>
                {:else}
                  {@const eff = nextFabricatorUpgrade.effect}
                  <div class="research-name">Next: Level {fabricatorLevel} → {fabricatorLevel + 1}</div>
                  <!-- Grant line: each fabricator rung grants a craft slot AND unlocks the
                       next tier. The slot text lives inside the narrow so eff.
                       addFabricateSlots is typed; the whole phrase is kept contiguous
                       WITHIN each branch (no whitespace-only text at a block boundary,
                       which Svelte would trim) so the " · " separator renders. -->
                  <div class="research-cost">
                    {#if "addFabricateSlots" in eff}Grants: +{eff.addFabricateSlots} craft slot{eff.addFabricateSlots === 1 ? "" : "s"} · unlocks Tier {fabricatorLevel + 1} blueprints{:else}Grants: unlocks Tier {fabricatorLevel + 1} blueprints{/if}
                  </div>
                  <div class="research-cost">Duration: {durationReadout(nextFabricatorUpgrade.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                  <!-- Credits cost readiness (fabricator rungs cost credits, not materials). -->
                  {#if nextFabricatorUpgrade.credits !== undefined}
                    {@const met = state.credits.gte(nextFabricatorUpgrade.credits)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Cost: ◈ {formatNumber(nextFabricatorUpgrade.credits)} (have {formatNumber(state.credits)})
                    </div>
                  {/if}

                  <!-- Material readiness ([Item]: have / need, ✅/❌), empty for the
                       fabricator track today, kept for parity with the sibling tabs. -->
                  {#each Object.keys(nextFabricatorUpgrade.materials) as itemId}
                    {@const need = nextFabricatorUpgrade.materials[itemId]}
                    <!-- FREE (reservation-aware) have, consistent with the Build gate; see
                         the Refinery upgrade row for the full rationale. -->
                    {@const stock = itemTotal(state.inventory, itemId)}
                    {@const have = freeItemForState(state, itemId)}
                    {@const reserved = stock.minus(have)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}{#if reserved.gt(0)} ({formatNumber(reserved)} reserved){/if}
                    </div>
                  {/each}

                  <!-- Fleet Admiral level prereq (absent field => no wall). -->
                  {#if nextFabricatorUpgrade.requiresFleetAdminLevel !== undefined}
                    {@const met = state.fleetAdminLevel >= nextFabricatorUpgrade.requiresFleetAdminLevel}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Requires Fleet Admiral level {nextFabricatorUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                    </div>
                  {/if}

                  {@render facilityUpgradeButton(
                    FABRICATOR_FACILITY_KEY,
                    fabricatorUpgradeCheck,
                    `Build · Level ${fabricatorLevel} → ${fabricatorLevel + 1}`,
                    () => doStartFacilityUpgrade(FABRICATOR_FACILITY_KEY)
                  )}
                {/if}

                {#if fabricatorUpgradeInFlight}
                  {@const progress = fabricatorUpgradeInFlight.durationTicks > 0
                    ? (fabricatorUpgradeInFlight.durationTicks - fabricatorUpgradeInFlight.remainingTicks) / fabricatorUpgradeInFlight.durationTicks
                    : 1}
                  <div class="research-name" style="margin-top: 10px;">Currently upgrading…</div>
                  <div class="research-bar-track">
                    <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                  </div>
                  <div class="research-readout">{remainingReadout(fabricatorUpgradeInFlight.remainingTicks, fabricatorUpgradeInFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                {/if}
              </Panel>
            {/if}
          {:else if activeFoundryFacility === "research"}
            <!-- RESEARCH LAB (Research Task R5), the blueprint-research facility.
                 Three sub-tabs mirroring the other Homeworld facilities: Overview
                 (slots in use + in-flight projects with progress bars + researched/
                 available counts + the Fabricator signpost), Research (the tier-
                 grouped blueprint list, each with its future-Fabricator recipe +
                 cost/time and a Research button gated by canResearch), and Upgrades
                 (the lab's tier/slot track, wired to the SHARED canBuildFacilityUpgrade
                 / doStartFacilityUpgrade). All readiness/actions read the SAME tick.ts
                 research fns (researchSlotCount / canResearch / startResearch) + the
                 model.ts tables (FACILITIES.research / BLUEPRINTS / ITEMS), so the UI
                 can't drift from what the backend enforces. Reuses the refine/upgrade
                 progress-bar idiom + the .mission-card / .buy-btn / .research-* classes
                 (no new markup style). -->
            <SubTabs
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "research", label: "Research" },
                { key: "upgrades", label: "Upgrades" },
              ]}
              active={activeResearchSubTab}
              onSelect={(key) => (activeResearchSubTab = key as ResearchSubTab)}
            />

            {#if activeResearchSubTab === "overview"}
              <!-- OVERVIEW, lab level, slot usage, any in-flight research projects
                   (progress bar + ticks remaining, the SAME idiom the refine jobs +
                   facility upgrades use), the researched/available count, and the
                   forward SIGNPOST that crafting arrives with the Fabricator. -->
              <Panel>
                <div class="panel-title">RESEARCH LAB</div>
                <div class="research-cost">Level: {researchLevel}</div>
                <div class="research-cost">Research slots: {activeResearchProjects.length} / {researchSlots} in use</div>
                <div class="research-cost">Blueprints researched: {researchedBlueprintCount} / {totalBlueprintCount}</div>

                <!-- In-flight research projects, one progress card each. progress is
                     how much of the duration has elapsed (durationTicks - remainingTicks
                     over durationTicks), read straight off the researchProject
                     TimedProcess, the SAME derivation the refine/upgrade bars use. The
                     project names the blueprint it is unlocking (effect.key -> label). -->
                {#if activeResearchProjects.length > 0}
                  <div class="research-cost" style="margin-top: 10px;">In progress:</div>
                  {#each activeResearchProjects as job (job.id)}
                    {@const progress = job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 1}
                    <div class="mission-card">
                      <div class="research-name">
                        {#if job.effect.type === "unlockBlueprint"}Researching → [{BLUEPRINTS[job.effect.key]?.label ?? job.effect.key}]{:else}Research project{/if}
                      </div>
                      <div class="research-bar-track">
                        <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                      </div>
                      <div class="research-readout">{remainingReadout(job.remainingTicks, job.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                    </div>
                  {/each}
                {:else}
                  <p class="research-status" style="margin-top: 10px;">No active research projects.</p>
                {/if}

                <!-- Forward signpost (design R5): researched blueprints aren't craftable
                     until the Fabricator, the next feature. -->
                <p class="research-status" style="margin-top: 10px; color: var(--color-text-secondary);">
                  Researched blueprints become craftable when the <strong>Fabricator</strong> comes online (next feature).
                </p>
              </Panel>
            {/if}

            {#if activeResearchSubTab === "research"}
              <!-- RESEARCH LIST, blueprints grouped by TIER (ascending). Each card
                   shows the blueprint's future-Fabricator RECIPE (inputs → outputQty×
                   output, ITEM labels) + its cost/time, then ONE of three states:
                     - Researched (blueprintUnlocked): ✓ + "craftable once the Fabricator
                       is online".
                     - Researchable (canResearch ok): an enabled Research button →
                       doStartResearch(key).
                     - Blocked (canResearch !ok): a DISABLED button whose text/title is
                       the human reason (researchBlockText), tierLocked names the
                       required lab level, so higher-tier blueprints read "Requires
                       Research Lab level N". -->
              <Panel>
                <div class="panel-title">RESEARCH</div>
                <div class="research-cost">Research slots: {activeResearchProjects.length} / {researchSlots} in use</div>

                {#each blueprintTierGroups as group (group.tier)}
                  <div class="research-name" style="margin-top: 12px;">Tier {group.tier}</div>
                  {#each group.blueprints as bp (bp.key)}
                    {@const unlocked = blueprintUnlocked(state, bp.key)}
                    {@const gate = canResearch(state, bp.key)}
                    <!-- In-flight lookup: the researchProject TimedProcess unlocking THIS
                         blueprint (effect.key === bp.key). When present, canResearch
                         returned `inProgress`, so the card renders a live progress bar +
                         human time-remaining in place of the disabled "Researching…"
                         button (same track/fill/readout idiom as the Overview card). Other
                         blocked reasons (noSlot / tierLocked / credits) still fall through
                         to their disabled buttons. Declared here (immediate {#each} child)
                         because {@const} cannot be a child of a plain element. -->
                    {@const job = activeResearchProjects.find((p) => p.effect.type === "unlockBlueprint" && p.effect.key === bp.key)}
                    <div class="mission-card">
                      <div class="research-name">{bp.label}</div>
                      <!-- Recipe line. FIVE blueprint shapes (see BlueprintDef): an UNLOCK-ONLY
                           blueprint (Combat 0.13.0 warship gate) crafts nothing, so it shows what
                           it UNLOCKS (a hull at the Shipyard) instead of "Crafts: inputs -> output".
                           A MATERIAL blueprint shows its stackable output; an EQUIPMENT blueprint
                           previews its minted piece's SYSTEM name (slot + variety); a WEAPON blueprint
                           (Combat 1.0, Unit 1.2b) and a DRONE-POD blueprint (Unit 2.1b) preview their
                           stripped crafted name. -->
                      {#if blueprintKind(bp) === "unlockOnly"}
                        <div class="research-cost">Unlocks: {hullUnlockedByBlueprint(bp.key) ?? "new build content"} (build at the Shipyard)</div>
                      {:else}
                        <div class="research-cost">
                          Crafts: {#each Object.keys(bp.recipe.inputs) as inId, i}{bp.recipe.inputs[inId]}× [{ITEMS[inId]?.label ?? inId}]{i < Object.keys(bp.recipe.inputs).length - 1 ? " + " : ""}{/each} → {#if bp.weaponOutput || bp.droneOutput}[{craftedInstanceBlueprintLabel(bp)}]{:else if bp.equipmentOutput}[{equipmentOutputLabel(bp.equipmentOutput)}]{:else}{bp.recipe.outputQty}× [{ITEMS[bp.recipe.outputItem ?? ""]?.label ?? bp.recipe.outputItem}]{/if}
                        </div>
                      {/if}
                      <div class="research-cost">Cost: ◈ {formatNumber(bp.researchCreditCost)} · {durationReadout(bp.researchDurationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                      {#if unlocked}
                        <div class="research-cost" style="color: var(--color-success)">{blueprintKind(bp) === "unlockOnly" ? "✓ Researched, build it at the Shipyard" : "✓ Researched, craftable once the Fabricator is online"}</div>
                      {:else if job}
                        {@const progress = job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 1}
                        <div class="research-bar-track">
                          <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                        </div>
                        <div class="research-readout">{remainingReadout(job.remainingTicks, job.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                      {:else if gate.ok}
                        <button class="buy-btn" on:click={() => doStartResearch(bp.key)}>
                          Research · ◈ {formatNumber(bp.researchCreditCost)}
                        </button>
                      {:else}
                        <button class="buy-btn" disabled title={researchBlockText(gate.reason, bp)}>
                          {researchBlockText(gate.reason, bp)}
                        </button>
                      {/if}
                    </div>
                  {/each}
                {/each}
              </Panel>
            {/if}

            {#if activeResearchSubTab === "upgrades"}
              <!-- UPGRADES, the Research Lab's finite tier/slot track
                   (FACILITIES.research.upgrades[level]; caps at length 2 today). Each
                   next rung grants a research slot AND unlocks the next blueprint tier.
                   Cost is CREDITS (the design's long-term sink), not materials, so the
                   credits gate leads the readiness rows; materials loop is kept (empty
                   today) to mirror the sibling upgrade tabs for future rungs. Build is
                   wired to the SHARED canBuildFacilityUpgrade / doStartFacilityUpgrade
                  , NOT re-implemented. In-flight progress reuses the refine/upgrade
                   bar idiom. -->
              <Panel>
                <div class="panel-title">RESEARCH LAB, Upgrades</div>
                <div class="research-cost">Level: {researchLevel}</div>

                {#if researchMaxed}
                  <p class="research-status">Fully upgraded.</p>
                {:else}
                  {@const eff = nextResearchUpgrade.effect}
                  <div class="research-name">Next: Level {researchLevel} → {researchLevel + 1}</div>
                  <!-- Grant line: each research rung grants a slot AND unlocks the next
                       tier. The slot text lives inside the narrow so eff.addResearchSlots
                       is typed; the whole phrase is kept contiguous WITHIN each branch (no
                       whitespace-only text at a block boundary, which Svelte would trim) so
                       the " · " separator renders. -->
                  <div class="research-cost">
                    {#if "addResearchSlots" in eff}Grants: +{eff.addResearchSlots} research slot{eff.addResearchSlots === 1 ? "" : "s"} · unlocks Tier {researchLevel + 1} blueprints{:else}Grants: unlocks Tier {researchLevel + 1} blueprints{/if}
                  </div>
                  <div class="research-cost">Duration: {durationReadout(nextResearchUpgrade.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                  <!-- Credits cost readiness (research rungs cost credits, not materials). -->
                  {#if nextResearchUpgrade.credits !== undefined}
                    {@const met = state.credits.gte(nextResearchUpgrade.credits)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Cost: ◈ {formatNumber(nextResearchUpgrade.credits)} (have {formatNumber(state.credits)})
                    </div>
                  {/if}

                  <!-- Material readiness ([Item]: have / need, ✅/❌), empty for the
                       research track today, kept for parity with the sibling tabs. -->
                  {#each Object.keys(nextResearchUpgrade.materials) as itemId}
                    {@const need = nextResearchUpgrade.materials[itemId]}
                    <!-- FREE (reservation-aware) have, consistent with the Build gate; see
                         the Refinery upgrade row for the full rationale. -->
                    {@const stock = itemTotal(state.inventory, itemId)}
                    {@const have = freeItemForState(state, itemId)}
                    {@const reserved = stock.minus(have)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}{#if reserved.gt(0)} ({formatNumber(reserved)} reserved){/if}
                    </div>
                  {/each}

                  <!-- Fleet Admiral level prereq (absent field => no wall). -->
                  {#if nextResearchUpgrade.requiresFleetAdminLevel !== undefined}
                    {@const met = state.fleetAdminLevel >= nextResearchUpgrade.requiresFleetAdminLevel}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Requires Fleet Admiral level {nextResearchUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                    </div>
                  {/if}

                  {@render facilityUpgradeButton(
                    RESEARCH_FACILITY_KEY,
                    researchUpgradeCheck,
                    `Build · Level ${researchLevel} → ${researchLevel + 1}`,
                    () => doStartFacilityUpgrade(RESEARCH_FACILITY_KEY)
                  )}
                {/if}

                {#if researchUpgradeInFlight}
                  {@const progress = researchUpgradeInFlight.durationTicks > 0
                    ? (researchUpgradeInFlight.durationTicks - researchUpgradeInFlight.remainingTicks) / researchUpgradeInFlight.durationTicks
                    : 1}
                  <div class="research-name" style="margin-top: 10px;">Currently upgrading…</div>
                  <div class="research-bar-track">
                    <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                  </div>
                  <div class="research-readout">{remainingReadout(researchUpgradeInFlight.remainingTicks, researchUpgradeInFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                {/if}
              </Panel>
            {/if}
          {:else if activeFoundryFacility === "fuelStorage"}
            <!-- FUEL DEPOT (Mission Rework Task 8; reworked Fuel Economy v2 F4), the
                 fuel tank + auto-refinery. Two sub-tabs: Overview (fuel/cap GAUGE +
                 auto-REFINING status + a DEMOTED optional manual top-up) and Upgrades
                 (the mixed storage/processing track). Since F2/F3 made refining +
                 auto-buy automatic, the Overview now LEADS with the sufficiency readout
                 and the manual buy is a secondary override, not the primary action. -->
            <SubTabs
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "upgrades", label: "Upgrades" },
              ]}
              active={activeFuelStorageSubTab}
              onSelect={(key) => (activeFuelStorageSubTab = key as FuelStorageSubTab)}
            />

            {#if activeFuelStorageSubTab === "overview"}
              <Panel>
                <div class="panel-title">FUEL DEPOT</div>
                <div class="research-cost">Depot level: {fuelStorageLevel}</div>

                <!-- Fuel gauge, current / cap with a horizontal fill bar (the shared
                     research-bar fill idiom; fill % via warehouseFillPct, the same
                     clamp helper the Warehouse tiles use). -->
                <div class="research-cost" style="margin-top: 8px;">Fuel: {formatNumber(state.fuel)} / {formatNumber(fuelCapValue)} ({Math.round(fuelFillPct)}%)</div>
                <div class="research-bar-track">
                  <div class="research-bar-fill" style="width:{fuelFillPct}%"></div>
                </div>
              </Panel>

              <!-- REFINING STATUS (Fuel Economy v2 F4), the auto-refinery readout. Same
                   production/expenditure/net derivation the top-bar fuel chip uses (one
                   source, shown twice), plus the live per-batch pipeline progress. This
                   is now the PRIMARY Fuel Depot readout: it answers "is my fuel self-
                   sustaining?" without the player touching anything. -->
              <Panel>
                <div class="panel-title">REFINING</div>
                <div class="research-cost">Pipelines: {fuelPipelineCount(state)} · refining [Deuterium Ice] → fuel</div>
                <div class="research-cost" style="color: var(--color-success);">Production (max): +{formatNumber(fuelProductionPerMinute)} fuel/min</div>
                <div class="research-cost">Ice cost: {formatNumber(fuelIceInputPerMinute)} [Deuterium Ice]/min</div>
                <div class="research-cost" style="color: var(--color-danger);">Missions ({fuelActiveMissionCount}): −{formatNumber(fuelExpenditurePerMinute)} fuel/min</div>
                <div
                  class="research-cost"
                  style="margin-top: 4px; font-weight: 600; color: {fuelSufficient ? 'var(--color-success)' : 'var(--color-danger)'};"
                >
                  Net: {fuelNetPerMinute >= 0 ? "+" : "−"}{formatNumber(Math.abs(fuelNetPerMinute))} fuel/min --
                  <!-- Root-reason order matches the top-bar chip's note: tank full ->
                       out of ice (net-display fix) -> fuel-positive -> draining. -->
                  {#if fuelTankFull}tank full (topped off){:else if !fuelHasIce}refinery idle: out of Deuterium Ice{:else if fuelSufficient}fuel-positive{:else}draining, auto-buying with credits{/if}
                </div>

                <!-- FUEL RUNWAY (Wave 2): measured full-sustainability countdown to
                     fuel-empty (credits mission-mined Deuterium Ice). Mirrors the
                     top-bar chip's runway line. null=warming up; sustainable=∞ (never
                     drains); finite=time left (warning/danger); guarded-null="--". -->
                {#if fuelRunway === null}
                  <div class="research-cost" style="margin-top: 4px;">Fuel runway: measuring…</div>
                {:else if fuelRunway.sustainable}
                  <div class="research-cost" style="margin-top: 4px; font-weight: 600; color: var(--color-success);">
                    Fuel runway: ∞ self-sustaining
                  </div>
                {:else if fuelRunway.runwayTicks !== null}
                  <div
                    class="research-cost"
                    style="margin-top: 4px; font-weight: 600; color: {fuelRunway.runwayTicks * state.tickDurationSeconds < 60 ? 'var(--color-danger)' : 'var(--color-warning)'};"
                  >
                    Fuel runway: {formatDuration(fuelRunway.runwayTicks, state.tickDurationSeconds)} left
                  </div>
                {:else}
                  <div class="research-cost" style="margin-top: 4px;">Fuel runway: --</div>
                {/if}

                <!-- Live batch progress. Empty = depot idle: tank full, or Deuterium Ice
                     ran out (mine more via Local Asteroid). Reuses the refinery job-card
                     progress idiom (progress bar + ticks remaining). -->
                {#if activeFuelRefineJobs.length > 0}
                  <div class="research-cost" style="margin-top: 10px;">Refining now:</div>
                  {#each activeFuelRefineJobs as job (job.id)}
                    {@const progress = job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 1}
                    <div class="research-bar-track" style="margin-top: 4px;">
                      <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                    </div>
                    <div class="research-readout">{remainingReadout(job.remainingTicks, job.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                  {/each}
                {:else}
                  <p class="research-status" style="margin-top: 8px;">
                    Idle, {fuelRoom.lte(0) ? "tank full" : "no Deuterium Ice (mine more via Operations)"}.
                  </p>
                {/if}
              </Panel>

              <!-- MANUAL TOP-UP (Fuel Economy v2 F4), DEMOTED from the old primary
                   "Buy Fuel". Auto-buy (F3) now covers mission shortfalls automatically,
                   so this is an OPTIONAL override for topping the tank early; the note
                   says so. Same canBuyFuel gate + buyFuel-clamped +10/+100/Fill controls
                   as before (unchanged behavior), just reframed as secondary. -->
              <Panel>
                <div class="panel-title">MANUAL TOP-UP <span style="opacity: 0.6; font-weight: 400;">(optional)</span></div>
                <p class="research-status" style="margin-bottom: 6px;">
                  Missions auto-buy any fuel shortfall from credits, this is just an optional early top-up.
                </p>
                <div class="research-cost">Price: ◈ {FUEL_CREDITS_PER_UNIT} / unit · Credits: {formatNumber(state.credits)}</div>
                {#if fuelRoom.lte(0)}
                  <p class="research-status" style="color: var(--color-danger); margin-top: 6px;">
                    Tank full, expand the tank (Upgrades) to buy more.
                  </p>
                {/if}

                <!-- +10 / +100 / Fill. All share the canBuyFuel gate (affordable AND
                     room); buyFuel clamps any partial, so a click never overspends or
                     overfills. Fill passes the exact tank room -> buyFuel takes the min
                     of room and affordable, topping the tank as far as credits allow. -->
                <div class="dev-row" style="margin-top: 8px;">
                  <button
                    class="buy-btn"
                    disabled={!canBuyFuel}
                    title={!canBuyFuel ? (fuelRoom.lte(0) ? "Tank full" : "Not enough credits") : undefined}
                    on:click={() => doBuyFuel(10)}
                  >
                    +10 · ◈ {formatNumber(10 * FUEL_CREDITS_PER_UNIT)}
                  </button>
                  <button
                    class="buy-btn"
                    disabled={!canBuyFuel}
                    title={!canBuyFuel ? (fuelRoom.lte(0) ? "Tank full" : "Not enough credits") : undefined}
                    on:click={() => doBuyFuel(100)}
                  >
                    +100 · ◈ {formatNumber(100 * FUEL_CREDITS_PER_UNIT)}
                  </button>
                  <button
                    class="buy-btn"
                    disabled={!canBuyFuel}
                    title={!canBuyFuel ? (fuelRoom.lte(0) ? "Tank full" : "Not enough credits") : undefined}
                    on:click={() => doBuyFuel(fuelRoom.toNumber())}
                  >
                    Fill
                  </button>
                </div>
              </Panel>
            {/if}

            {#if activeFuelStorageSubTab === "upgrades"}
              <!-- UPGRADES, the MIXED storage/processing track
                   (FACILITIES.fuelStorage.upgrades): storage rungs expand the tank,
                   processing rungs scale the refinery (pipelines/yield/input). Each
                   next-rung type gets its own labeled current→next readout (below),
                   material readiness, Build gated on the shared canBuildFacilityUpgrade,
                   + in-flight progress. -->
              <Panel>
                <div class="panel-title">FUEL DEPOT, Upgrades</div>
                <div class="research-cost">Level: {fuelStorageLevel}</div>

                {#if fuelStorageMaxed}
                  <p class="research-status">Fully upgraded.</p>
                {:else}
                  <!-- The Fuel Depot track is MIXED (Fuel Economy v2 F2): storage rungs
                       ({ storageCapMult }, expand the tank) interleaved with three
                       processing rungs ({ addFuelPipelines } / { fuelYieldMult } /
                       { fuelInputMult }, scale the refinery). Each rung type gets its OWN
                       label + current→next readout so the player knows what they're buying
                      , unlike the old storage-only panel that mislabeled every rung
                       "doubles capacity". The effect is a presence-tagged union, narrowed
                       with `"key" in nextEff` (the SAME idiom fuelCap/fuelPipelineCount
                       use). Build stays wired to the shared canBuildFacilityUpgrade /
                       doStartFacilityUpgrade, only the DESCRIPTION branches. -->
                  {@const nextEff = nextFuelStorageUpgrade.effect}
                  {#if "storageCapMult" in nextEff}
                    <div class="research-name" style="margin-top: 6px;">Expand Tank, storage ×{nextEff.storageCapMult}</div>
                    <div class="research-cost">Current cap: {formatNumber(fuelCapValue)}</div>
                    <div class="research-cost" style="color: var(--color-accent)">Next cap: {formatNumber(fuelCapValue.times(nextEff.storageCapMult))}</div>
                  {:else if "addFuelPipelines" in nextEff}
                    <div class="research-name" style="margin-top: 6px;">Add Pipeline, +{nextEff.addFuelPipelines} concurrent refining line{nextEff.addFuelPipelines === 1 ? "" : "s"}</div>
                    <div class="research-cost">Current pipelines: {fuelPipelineCount(state)}</div>
                    <div class="research-cost" style="color: var(--color-accent)">Next pipelines: {fuelPipelineCount(state) + nextEff.addFuelPipelines}</div>
                  {:else if "fuelYieldMult" in nextEff}
                    <div class="research-name" style="margin-top: 6px;">Boost Yield, fuel per batch ×{nextEff.fuelYieldMult}</div>
                    <div class="research-cost">Current: {formatNumber(fuelBatchOutput(state))} fuel/batch</div>
                    <div class="research-cost" style="color: var(--color-accent)">Next: {formatNumber(fuelBatchOutput(state).times(nextEff.fuelYieldMult))} fuel/batch</div>
                  {:else if "fuelInputMult" in nextEff}
                    <div class="research-name" style="margin-top: 6px;">Efficient Intake, Deuterium Ice per batch ×{nextEff.fuelInputMult} (less ice)</div>
                    <div class="research-cost">Current: {formatNumber(fuelBatchInput(state))} ice/batch</div>
                    <div class="research-cost" style="color: var(--color-accent)">Next: {formatNumber(fuelBatchInput(state).times(nextEff.fuelInputMult))} ice/batch</div>
                  {/if}
                  <div class="research-cost">Duration: {durationReadout(nextFuelStorageUpgrade.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                  {#each Object.keys(nextFuelStorageUpgrade.materials) as itemId}
                    {@const need = nextFuelStorageUpgrade.materials[itemId]}
                    <!-- FREE (reservation-aware) have, consistent with the Build gate; see
                         the Refinery upgrade row for the full rationale. -->
                    {@const stock = itemTotal(state.inventory, itemId)}
                    {@const have = freeItemForState(state, itemId)}
                    {@const reserved = stock.minus(have)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}{#if reserved.gt(0)} ({formatNumber(reserved)} reserved){/if}
                    </div>
                  {/each}

                  {@render facilityUpgradeButton(
                    "fuelStorage",
                    fuelStorageUpgradeCheck,
                    "storageCapMult" in nextEff
                      ? "Expand Tank"
                      : "addFuelPipelines" in nextEff
                        ? "Add Pipeline"
                        : "fuelYieldMult" in nextEff
                          ? "Boost Yield"
                          : "fuelInputMult" in nextEff
                            ? "Improve Intake"
                            : "Build",
                    () => doStartFacilityUpgrade("fuelStorage")
                  )}
                {/if}

                {#if fuelStorageUpgradeInFlight}
                  {@const progress = fuelStorageUpgradeInFlight.durationTicks > 0
                    ? (fuelStorageUpgradeInFlight.durationTicks - fuelStorageUpgradeInFlight.remainingTicks) / fuelStorageUpgradeInFlight.durationTicks
                    : 1}
                  <div class="research-name" style="margin-top: 10px;">Currently upgrading…</div>
                  <div class="research-bar-track">
                    <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                  </div>
                  <div class="research-readout">{remainingReadout(fuelStorageUpgradeInFlight.remainingTicks, fuelStorageUpgradeInFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                {/if}
              </Panel>
            {/if}

          {:else if activeFoundryFacility === "warehouse"}
            <!-- WAREHOUSE, warehouse-as-a-BUILDING management (0.12.0 "Console"
                 nav, Logistics CN3a). The two facility-management views, Overview
                 and Upgrade, MOVED VERBATIM here from the retired Stores program.
                 The material CATALOG (the fill-tile tiers) and the Ship Systems bay
                 left for Logistics; what remains is the building the player manages
                 (its storage state + the ONLY UI to expand material storage). Same
                 SubTabs + content structure the sibling Foundry facilities use. All
                 upgrade actions/gates read the SAME tick.ts backend fns the Refinery
                 uses (tierCap / materialAtCap / canBuildFacilityUpgrade /
                 startFacilityUpgrade). -->
            <SubTabs
              tabs={WAREHOUSE_CAT_TABS}
              active={activeWarehouseCat}
              onSelect={(key) => (activeWarehouseCat = key as WarehouseCat)}
            />

            {#if activeWarehouseCat === "overview"}
              <!-- OVERVIEW, at-a-glance warehouse state (design §3.1): T1 level +
                   cap, how many items are AT cap (the ⚠ auto-stop signal),
                   discovered/total catalog progress, and an Attention card listing
                   each FULL material when any producer is idled. -->
              <Panel>
                <div class="panel-title">WAREHOUSE, TIER 1</div>
                <div class="research-cost">Storage level: {warehouseT1Level}</div>
                <div class="research-cost">Cap per item: {formatNumber(warehouseT1Cap)}</div>
                <div
                  class="research-cost"
                  style="color: {warehouseItemsAtCap.length > 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)'}"
                >
                  Items at cap: {warehouseItemsAtCap.length}{warehouseItemsAtCap.length > 0 ? " ⚠" : ""}
                </div>
                <div class="research-cost">Discovered: {warehouseDiscoveredCount} / {warehouseTotalCount} items</div>
              </Panel>

              {#if warehouseItemsAtCap.length > 0}
                <Panel>
                  <div class="panel-title">⚠ ATTENTION</div>
                  {#each warehouseItemsAtCap as id (id)}
                    <div class="research-cost" style="color: var(--color-danger)">
                      [{ITEMS[id]?.label ?? id}], FULL, producers auto-stopped
                    </div>
                  {/each}
                  <p class="research-status" style="margin-top: 8px;">
                    A full material auto-stops the tasks feeding it. Expand storage (Upgrade tab) or consume it to resume.
                  </p>
                </Panel>
              {/if}
            {/if}

            {#if activeWarehouseCat === "upgrade"}
              <!-- UPGRADE, one card per warehouse tier (design §3.3): current
                   cap, next cap (doubles), the next rung's material cost +
                   duration, and a Build/Expand button gated on the SAME
                   canBuildFacilityUpgrade the backend enforces (so button and
                   action agree). T2 at level 0 reads as an UNLOCK; its later
                   denseOre-gated rungs naturally show ❌ (unobtainable input =
                   honest "future content" wall). In-flight progress mirrors the
                   Refinery's. -->
              {#each WAREHOUSE_TIERS as wt (wt.key)}
                {@const level = state.facilities[wt.key]?.level ?? 0}
                {@const upgrades = FACILITIES[wt.key].upgrades}
                {@const maxed = level >= upgrades.length}
                {@const currentCap = tierCap(state, wt.tier)}
                {@const check = canBuildFacilityUpgrade(state, wt.key)}
                {@const isUnlockRung = wt.tier > 1 && level === 0}
                {@const inFlight = state.activeProcesses.find(
                  (p) =>
                    p.kind === "facilityUpgrade" &&
                    p.effect.type === "facilityLevelUp" &&
                    p.effect.facility === wt.key
                )}
                <Panel>
                  <div class="panel-title">{wt.label}, {isUnlockRung ? "Unlock Storage" : "Expand Storage"}</div>
                  <div class="research-cost">Level: {level}</div>

                  {#if maxed}
                    <p class="research-status">Fully upgraded.</p>
                  {:else}
                    {@const nextRung = upgrades[level]}
                    {@const nextEff = nextRung.effect}
                    {@const nextCap = "storageCapMult" in nextEff ? currentCap.times(nextEff.storageCapMult) : currentCap}
                    <div class="research-cost">Current cap: {formatNumber(currentCap)} / item</div>
                    {#if !isUnlockRung}
                      <div class="research-cost" style="color: var(--color-accent)">Next cap: {formatNumber(nextCap)} / item</div>
                    {/if}
                    <div class="research-cost">Duration: {durationReadout(nextRung.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                    <!-- Material readiness: [Item]: have / need, ✅/❌. -->
                    {#each Object.keys(nextRung.materials) as itemId}
                      {@const need = nextRung.materials[itemId]}
                      <!-- FREE (reservation-aware) have, consistent with the Build gate; see
                           the Refinery upgrade row for the full rationale. -->
                      {@const stock = itemTotal(state.inventory, itemId)}
                      {@const have = freeItemForState(state, itemId)}
                      {@const reserved = stock.minus(have)}
                      {@const met = have.gte(need)}
                      <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                        {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}{#if reserved.gt(0)} ({formatNumber(reserved)} reserved){/if}
                      </div>
                    {/each}

                    {#if isUnlockRung}
                      <p class="research-status" style="margin-top: 6px;">
                        Unlocks {wt.label} storage. Its first expansion needs a Tier-{wt.tier} material you can't reach yet.
                      </p>
                    {/if}

                    <!-- Warehouse storage rung, now routed through the SHARED
                         facilityUpgradeButton snippet (was the bespoke original of
                         this flicker fix; refactored so there is a single source of
                         the popover mechanism). Keyed by the tier's facility key. -->
                    {@render facilityUpgradeButton(
                      wt.key,
                      check,
                      isUnlockRung ? `Unlock ${wt.label}` : "Expand · doubles capacity",
                      () => doStartFacilityUpgrade(wt.key)
                    )}
                  {/if}

                  {#if inFlight}
                    {@const progress = inFlight.durationTicks > 0
                      ? (inFlight.durationTicks - inFlight.remainingTicks) / inFlight.durationTicks
                      : 1}
                    <div class="research-name" style="margin-top: 10px;">Currently upgrading…</div>
                    <div class="research-bar-track">
                      <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                    </div>
                    <div class="research-readout">{remainingReadout(inFlight.remainingTicks, inFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                  {/if}
                </Panel>
              {/each}
            {/if}

          {:else if activeFoundryFacility === "salvageBay"}
            <!-- SALVAGE BAY, RELOCATED here from the Logistics > Salvage tab
                 (user decision 2026-07-21: salvaging is a FACILITY action, not an
                 item view). The whole Salvage Bay surface moved VERBATIM, the same
                 way the warehouse building-management moved to this Foundry rail:
                 per-quality confirm, Last Salvage readout, Ship Systems salvage
                 tiles + the inline EquipmentTooltip Salvage action, and the
                 Salvaged Materials select-to-salvage tiles + action. All reads/
                 actions still route through the SAME requestSalvage/confirmSalvage
                 flow and shared select state; EquipmentTooltip is reused unchanged. -->
            <!-- SALVAGE (moved VERBATIM from the old Stores Salvage Bay, 0.11.2
                 Task 11): the dedicated home for the two Salvage actions. NOTHING
                 here is new machinery or new styling; it reuses the SAME tiles,
                 EquipmentTooltip, select state, and requestSalvage/confirmSalvage
                 flow the Salvage Bay hosted before. Two labeled sections:
                   1. Ship Systems, the spare-systems bay tiles + the inline
                      EquipmentTooltip whose action slot carries the Salvage button
                      (requestSalvage("system", ...)). The Systems Bay CAPACITY
                      readout + Upgrade Bay action stay in the Ship Equipment tab
                      (the storage-management home); here it is salvage only.
                   2. Salvaged Materials, the select-to-salvage tiles + the inline
                      Salvage action panel (requestSalvage("material", ...)) over
                      the whole salvaged catalog (salvageBaySalvagedItems, no tier
                      selector). Ship teardown (requestSalvage("ship", ...)) is a
                      Logistics Ships action and deliberately NOT relocated here. -->
            <Panel>
              <div class="panel-title">SALVAGE BAY</div>
              <p class="research-status">
                Break spare ship systems and salvaged materials down for recovered parts and loot. Salvage permanently destroys the item; checked quality tiers ask for confirmation first.
              </p>
              <!-- CONFIRM-BY-QUALITY options (0.11.2 Task 13b): one checkbox per
                   quality tier (0..QUALITY_TIERS-1). A CHECKED tier requires a
                   confirm before salvaging an item of that quality; unchecking a
                   tier salvages it instantly. Persists to localStorage via
                   toggleSalvageConfirmTier -> saveSalvageConfirmQualities. Reuses the
                   .dev-row + inline-flex label + checkbox idiom from the System
                   Options panel; no new styling or colors. Ship (hull) teardown
                   always confirms regardless of these toggles. Tier labels use the
                   Q0..Q5 convention the systems tiles already show. -->
              <div class="dev-row" style="flex-wrap: wrap; gap: 12px;">
                {#each Array.from({ length: QUALITY_TIERS }, (_, i) => i) as tier (tier)}
                  <label style="display: inline-flex; align-items: center; gap: 6px;">
                    <input
                      type="checkbox"
                      checked={salvageConfirmQualities.includes(tier)}
                      on:change={(e) => toggleSalvageConfirmTier(tier, (e.target as HTMLInputElement).checked)}
                    />
                    Q{tier}
                  </label>
                {/each}
              </div>
              <p class="research-status">
                Salvaging an item of a checked quality asks for confirmation first. Uncheck a tier to salvage it instantly.
              </p>
            </Panel>

            <!-- LAST SALVAGE readout (0.11.2 Task 12): a "here is what you got"
                 status shown after a break-down, in ADDITION to the event-log
                 line. Fed by lastSalvageResult, which the two do* handlers set on
                 success and the clear reactive resets when leaving the tab. Reuses
                 the SAME Panel + warehouse-tier-head + research-status tokens as the
                 surrounding sections; no new styling or colors. -->
            {#if lastSalvageResult !== null}
              <Panel>
                <div class="warehouse-tier-head">
                  <span class="warehouse-tier-label">Last salvage</span>
                  <span class="warehouse-tier-line"></span>
                  <span class="warehouse-tier-cap">{lastSalvageResult.kind === "system" ? "recycled" : lastSalvageResult.kind === "baseline" ? "discarded" : "loot roll"}</span>
                </div>
                <p class="research-status">
                  {lastSalvageResult.kind === "system" ? "Recycled" : lastSalvageResult.kind === "baseline" ? "Discarded" : "Broke down"} [{lastSalvageResult.sourceName}].
                  {#if lastSalvageResult.kind === "baseline"}
                    Standard-Issue systems carry no materials to recover.
                  {:else if lastSalvageResult.recovered.length > 0}
                    Recovered: {lastSalvageResult.recovered
                      .map((r) => `${formatNumber(new Decimal(r.amount))} [${ITEMS[r.itemId]?.label ?? r.itemId}]`)
                      .join(", ")}.
                  {:else}
                    No materials recovered (recovery rounded to zero).
                  {/if}
                  {#if lastSalvageResult.rolledTier}
                    Rolled tier: {lastSalvageResult.rolledTier}.
                  {/if}
                </p>
              </Panel>
            {/if}

            <!-- SHIP SYSTEMS salvage: the spare-systems bay tiles (SAME markup as
                 the Ship Equipment bay). Selecting a tile surfaces the
                 EquipmentTooltip below with a Salvage action for crafted spares.
                 Reads baySystemGroups / selectedSystemId / selectSystemTile, the
                 same shared state the Ship Equipment tab uses. -->
            <Panel>
              <div class="warehouse-tier-head">
                <span class="warehouse-tier-label">Ship Systems</span>
                <span class="warehouse-tier-line"></span>
                <span class="warehouse-tier-cap">recycle spares</span>
              </div>
              {#if baySystemGroups.length === 0}
                <div class="warehouse-stub">
                  <div class="warehouse-stub-glyph">🛰️</div>
                  <p>No spare systems to salvage. Fabricate ship systems at the Fabricator, or uninstall an installed system to store it here first.</p>
                </div>
              {:else}
                {#each baySystemGroups as group (group.slot)}
                  <div class="warehouse-tier">
                    <div class="warehouse-tier-head">
                      <span class="warehouse-tier-label">{group.label}</span>
                      <span class="warehouse-tier-line"></span>
                      <span class="warehouse-tier-cap">{group.pieces.length} system{group.pieces.length === 1 ? "" : "s"}</span>
                    </div>
                    <div class="warehouse-grid">
                      {#each group.pieces as piece (piece.id)}
                        {@const isBaseline = piece.blueprintKey === null}
                        <button
                          type="button"
                          class="systems-tile"
                          class:baseline={isBaseline}
                          class:selected={selectedSystemId === piece.id}
                          style="--sys-rc: {equipmentRarityColor(piece.rarity)};"
                          title={isBaseline ? "Standard-Issue baseline" : `${piece.rarity} · Q${piece.quality}`}
                          on:click={() => selectSystemTile(piece.id)}
                        >
                          <span class="systems-tile-dot"></span>
                          <span class="systems-tile-ic">{equipmentIcon(piece)}</span>
                          <span class="systems-tile-il">iL {piece.iLevel}</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              {/if}
            </Panel>

            <!-- SELECTED SYSTEM: the reusable rarity-bordered tooltip, rendered
                 inline. EVERY spare has an active removal action in the tooltip's action
                 slot (both route through requestSalvage("system", ...) -> the shared confirm
                 modal, which narrates discard-vs-parts on its own). The LABEL differs by
                 piece kind (selectedIsBaseline): a CRAFTED spare shows "Salvage" (returns a
                 fraction of its components); a Standard-Issue baseline shows "Destroy" plus
                 helper text making clear it clears space but yields nothing. Destroy is the
                 always-available storage escape valve, so no spare can ever become un-removable. -->
            {#if selectedSystem}
              {@const sys = selectedSystem}
              <Panel>
                <EquipmentTooltip piece={sys}>
                  <button
                    class="buy-btn systems-salvage-btn"
                    on:click={() => requestSalvage("system", sys.id, systemSalvageName(sys))}
                  >
                    {selectedIsBaseline ? "Destroy" : "Salvage"}
                  </button>
                  {#if selectedIsBaseline}
                    <span class="systems-salvage-none">Standard-Issue gear can be destroyed to clear space, but yields no components.</span>
                  {/if}
                </EquipmentTooltip>
              </Panel>
            {/if}

            <!-- SALVAGED MATERIALS salvage: the select-to-salvage tiles over the
                 whole salvaged catalog (salvageBaySalvagedItems, all tiers, no
                 tier selector). SAME systems-tile visual + select idiom the
                 Materials tab shows browse-only. -->
            <Panel>
              <div class="warehouse-tier-head">
                <span class="warehouse-tier-label">Salvaged Materials</span>
                <span class="warehouse-tier-line"></span>
                <span class="warehouse-tier-cap">{salvageBayHeldSalvaged.length} material{salvageBayHeldSalvaged.length === 1 ? "" : "s"}</span>
              </div>
              {#if salvageBayHeldSalvaged.length === 0}
                <div class="warehouse-stub">
                  <div class="warehouse-stub-glyph">♻️</div>
                  <p>No salvaged materials yet. Recover them from salvage missions, then break them down here for a loot roll.</p>
                </div>
              {:else}
                <div class="warehouse-grid">
                  {#each salvageBayHeldSalvaged as item (item.id)}
                    {@const count = itemTotal(state.inventory, item.id)}
                    <!-- Reuse the systems-tile visual (rarity dot + code + corner
                         value), painting the count where a system's quality sits.
                         Rarity color via warehouseRarityColor (item rarity). -->
                    <button
                      type="button"
                      class="systems-tile"
                      class:selected={selectedSalvagedId === item.id}
                      style="--sys-rc: {warehouseRarityColor(item.rarity)};"
                      title={`${item.label} · ${item.rarity}`}
                      on:click={() => selectSalvagedTile(item.id)}
                    >
                      <span class="systems-tile-dot"></span>
                      <span class="systems-tile-code">{item.label.split(" ").slice(-1)[0]}</span>
                      <span class="systems-tile-q">{formatNumber(count)}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </Panel>

            <!-- SELECTED MATERIAL: the Salvage action + a short readout. The
                 Salvage button disables when none is held (the engine also
                 rejects noneHeld for safety); the roll result is narrated to the
                 event log. -->
            {#if selectedSalvagedId !== null && ITEMS[selectedSalvagedId] && itemTotal(state.inventory, selectedSalvagedId).gt(0)}
              <!-- Capture the narrowed id into a const so the click closure below
                   receives a plain `string` (Svelte narrows the template guard, but
                   an arrow-function callback would otherwise see `string | null`).
                   Gated on a held count > 0 so that after salvaging the last unit,
                   the tile leaves the held-only grid AND this action panel closes
                   together (no lingering panel for an item you no longer hold). -->
              {@const salvageTargetId = selectedSalvagedId}
              {@const selItem = ITEMS[selectedSalvagedId]}
              {@const selCount = itemTotal(state.inventory, selectedSalvagedId)}
              {@const selHeld = selCount.gt(0)}
              <Panel>
                <div class="salvaged-action">
                  <div class="salvaged-action-info">
                    <div class="salvaged-action-name" style="color: {warehouseRarityColor(selItem.rarity)};">{selItem.label}</div>
                    <div class="salvaged-action-hint">
                      Break it down for a chance at rare salvage. Held: {formatNumber(selCount)}. Reachable tiers rise with Fleet Admiral level and the salvage talent.
                    </div>
                  </div>
                  <button
                    class="buy-btn systems-salvage-btn"
                    disabled={!selHeld}
                    title={selHeld ? undefined : "None of this material is held"}
                    on:click={() => requestSalvage("material", salvageTargetId, selItem.label)}
                  >
                    Salvage
                  </button>
                </div>
              </Panel>
            {/if}
          {:else if activeFoundryFacility === "shipyard"}
            <!-- SHIPYARD folded into Facilities (0.12.0 Console, CN4b), moved
                 VERBATIM out of the retired Drydock tab. Content pane UNCHANGED;
                 only its guard flipped from activeDrydockSection === "shipyard" to
                 the Facilities console's activeFoundryFacility === "shipyard". -->
            <!-- SHIPYARD (Phase 5, Task S5 UI), the hull-BUILD facility. It CONSUMES the
                 components the Fabricator crafts + credits to build a ship over time, then
                 parks the finished hull in the fleet. Two sub-tabs mirroring the sibling
                 facilities' STRUCTURE: Build (the founded-vs-unfounded build surface) and
                 Upgrades (the founding + build-speed track). All actions/readiness read the
                 tick.ts backend fns (canBuildShip / startShipBuild / shipBuildDurationTicks /
                 canBuildFacilityUpgrade / doStartFacilityUpgrade) + the model.ts tables
                 (SHIP_TYPES / ITEMS / FACILITIES.shipyard), so the UI can't drift from what
                 the backend enforces. Reuses the research/fabricate progress-bar idiom + the
                 .mission-card / .buy-btn / .research-* classes (no new markup style). NOTE:
                 the Shipyard only BUILDS, assigning a hull to a captain stays at the Docks
                 (Sector Space > Starbase), which is SEPARATE and unchanged. -->
            <SubTabs
              tabs={[
                { key: "build", label: "Build" },
                { key: "upgrades", label: "Upgrades" },
              ]}
              active={activeShipyardSubTab}
              onSelect={(key) => (activeShipyardSubTab = key as ShipyardSubTab)}
            />

            {#if activeShipyardSubTab === "build"}
              <Panel>
                <div class="panel-title">SHIPYARD, Build</div>

                {#if !shipyardFounded}
                  <!-- UNFOUNDED (level 0): the "establish the Shipyard" prompt. The founding
                       rung IS upgrades[0] (level 0->1), so the Found button wires to the
                       SHARED canBuildFacilityUpgrade / doStartFacilityUpgrade seams exactly
                       like every other facility's founding rung, NOT a bespoke path. Shows
                       the credit cost + FA-level wall + (when a founding is already running)
                       the in-flight progress bar. nextShipyardUpgrade is the founding rung
                       here (shipyardMaxed can't be true at level 0 given the 3-rung track). -->
                  <p class="research-status">Shipyard not yet established. Found it to begin building hulls.</p>
                  {#if !shipyardMaxed}
                    <div class="research-cost" style="margin-top: 8px;">
                      Founding cost: ◈ {formatNumber(nextShipyardUpgrade.credits ?? new Decimal(0))} (have {formatNumber(state.credits)})
                    </div>
                    {#if nextShipyardUpgrade.requiresFleetAdminLevel !== undefined}
                      {@const met = state.fleetAdminLevel >= nextShipyardUpgrade.requiresFleetAdminLevel}
                      <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                        {met ? "✅" : "❌"} Requires Fleet Admiral level {nextShipyardUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                      </div>
                    {/if}
                    <div class="research-cost">Founding time: {durationReadout(nextShipyardUpgrade.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                    {@render facilityUpgradeButton(
                      "shipyardFound",
                      shipyardUpgradeCheck,
                      `Found · ◈ ${formatNumber(nextShipyardUpgrade.credits ?? new Decimal(0))}`,
                      () => doStartFacilityUpgrade(SHIPYARD_FACILITY_KEY),
                      "margin-top: 8px;"
                    )}
                  {/if}

                  <!-- In-flight founding progress (a founding is a facilityUpgrade process). -->
                  {#if shipyardUpgradeInFlight}
                    {@const progress = shipyardUpgradeInFlight.durationTicks > 0
                      ? (shipyardUpgradeInFlight.durationTicks - shipyardUpgradeInFlight.remainingTicks) / shipyardUpgradeInFlight.durationTicks
                      : 1}
                    <div class="research-name" style="margin-top: 10px;">Establishing the Shipyard…</div>
                    <div class="research-bar-track">
                      <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                    </div>
                    <div class="research-readout">{remainingReadout(shipyardUpgradeInFlight.remainingTicks, shipyardUpgradeInFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                  {/if}
                {:else}
                  <!-- FOUNDED (level >= 1): the build surface. An in-flight ship BUILD (if any)
                       renders as a committed progress card at the TOP, NO cancel (a build is
                       committed once started; its BOM + credits are already spent). Then one
                       card per SHIP_TYPES hull: label + stat line + a REQUIRES box (each BOM
                       component as "{need}× [Item]" with its reservation-aware FREE stock, red
                       when short) + the credits/time line + a Build button gated by canBuildShip. -->
                  <div class="research-cost">Shipyard level: {shipyardLevel}</div>

                  {#if activeShipBuild}
                    {@const progress = activeShipBuild.durationTicks > 0
                      ? (activeShipBuild.durationTicks - activeShipBuild.remainingTicks) / activeShipBuild.durationTicks
                      : 1}
                    {@const buildingKey = activeShipBuild.effect.type === "addShip" ? activeShipBuild.effect.typeKey : undefined}
                    <div class="mission-card" style="margin-top: 10px;">
                      <div class="research-name">BUILDING · {buildingKey ? (SHIP_TYPES[buildingKey]?.label ?? buildingKey) : "hull"}</div>
                      <div class="research-bar-track">
                        <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                      </div>
                      <div class="research-readout">{remainingReadout(activeShipBuild.remainingTicks, activeShipBuild.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                    </div>
                  {/if}

                  <!-- One card per hull. SHIP_TYPES is the SAME table the engine reads, so a
                       hull can never appear here that canBuildShip would reject on identity. -->
                  {#each Object.keys(SHIP_TYPES) as typeKey (typeKey)}
                    {@const def = SHIP_TYPES[typeKey as ShipTypeKey]}
                    {@const recipe = def.buildRecipe}
                    {@const gate = canBuildShip(state, typeKey)}
                    <div class="mission-card" style="margin-top: 10px;">
                      <div class="research-name">{def.label}</div>
                      <div class="research-cost">{def.cargoCapacity} cargo · {def.spec}</div>

                      <!-- REQUIRES box: each BOM component + its reservation-aware FREE stock
                           (freeItemForState, inventory minus what craft lines reserve, the
                           SAME pool canBuildShip's materials gate reads). Red when free < need. -->
                      <div class="research-cost" style="margin-top: 6px;">REQUIRES</div>
                      {#each Object.keys(recipe.components) as itemId}
                        {@const need = recipe.components[itemId]}
                        {@const free = freeItemForState(state, itemId)}
                        {@const short = free.lt(need)}
                        <div class="research-cost" style="color: {short ? 'var(--color-danger)' : 'var(--color-success)'}">
                          {need}× [{ITEMS[itemId]?.label ?? itemId}] · free {formatNumber(free)}
                        </div>
                      {/each}

                      <!-- Credits + effective (build-speed-adjusted) build time. -->
                      <div class="research-cost" style="margin-top: 6px;">
                        ◈ {formatNumber(recipe.credits)} · ⏱ {formatClock(shipBuildDurationTicks(state, typeKey as ShipTypeKey), state.tickDurationSeconds)}
                      </div>

                      <button
                        class="buy-btn"
                        style="margin-top: 6px;"
                        disabled={!gate.ok}
                        title={gate.ok ? undefined : shipBuildBlockText(gate.reason, typeKey as ShipTypeKey)}
                        on:click={() => doStartShipBuild(typeKey as ShipTypeKey)}
                      >
                        Build
                      </button>
                      <!-- Block reason shown inline (the mockup surfaces the cause under a
                           disabled Build button). Suppressed when buildable. -->
                      {#if !gate.ok}
                        <div class="research-cost" style="color: var(--color-danger); margin-top: 4px;">{shipBuildBlockText(gate.reason, typeKey as ShipTypeKey)}</div>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </Panel>
            {/if}

            {#if activeShipyardSubTab === "upgrades"}
              <!-- UPGRADES, the Shipyard's finite founding + build-SPEED track
                   (FACILITIES.shipyard.upgrades; founding rung [0] + two buildSpeedMult
                   rungs). A LINE-FOR-LINE clone of the Fabricator's Upgrades tab, swapping
                   fabricator→shipyard vars + the grant line (addFabricateSlots →
                   buildSpeedMult). Build is wired to the SHARED canBuildFacilityUpgrade /
                   doStartFacilityUpgrade(SHIPYARD_FACILITY_KEY), NOT re-implemented. This
                   is the SAME founding rung the Build tab's Found button drives, so founding
                   from either place is one code path. -->
              <Panel>
                <div class="panel-title">SHIPYARD, Upgrades</div>
                <div class="research-cost">Level: {shipyardLevel}</div>

                {#if shipyardMaxed}
                  <p class="research-status">Fully upgraded.</p>
                {:else}
                  {@const eff = nextShipyardUpgrade.effect}
                  <div class="research-name">Next: Level {shipyardLevel} → {shipyardLevel + 1}</div>
                  <!-- Grant line: the founding rung ([0], unlocksContent) ESTABLISHES the
                       Shipyard; the later rungs carry { buildSpeedMult } (the S3 engine
                       divides a hull's build time by the product of reached mults). Kept
                       contiguous within each branch so Svelte doesn't trim the phrase. -->
                  <div class="research-cost">
                    {#if "buildSpeedMult" in eff}Grants: {eff.buildSpeedMult}× build speed{:else}Grants: establishes the Shipyard (build hulls){/if}
                  </div>
                  <div class="research-cost">Duration: {durationReadout(nextShipyardUpgrade.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                  <!-- Credits cost readiness (shipyard rungs cost credits, not materials). -->
                  {#if nextShipyardUpgrade.credits !== undefined}
                    {@const met = state.credits.gte(nextShipyardUpgrade.credits)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Cost: ◈ {formatNumber(nextShipyardUpgrade.credits)} (have {formatNumber(state.credits)})
                    </div>
                  {/if}

                  <!-- Material readiness, empty for the shipyard track today, kept for
                       parity with the sibling upgrade tabs. -->
                  {#each Object.keys(nextShipyardUpgrade.materials) as itemId}
                    {@const need = nextShipyardUpgrade.materials[itemId]}
                    <!-- FREE (reservation-aware) have, consistent with the Build gate; see
                         the Refinery upgrade row for the full rationale. -->
                    {@const stock = itemTotal(state.inventory, itemId)}
                    {@const have = freeItemForState(state, itemId)}
                    {@const reserved = stock.minus(have)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}{#if reserved.gt(0)} ({formatNumber(reserved)} reserved){/if}
                    </div>
                  {/each}

                  <!-- Fleet Admiral level prereq (absent field => no wall). -->
                  {#if nextShipyardUpgrade.requiresFleetAdminLevel !== undefined}
                    {@const met = state.fleetAdminLevel >= nextShipyardUpgrade.requiresFleetAdminLevel}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Requires Fleet Admiral level {nextShipyardUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                    </div>
                  {/if}

                  {@render facilityUpgradeButton(
                    "shipyard",
                    shipyardUpgradeCheck,
                    `${shipyardLevel === 0 ? "Found" : "Build"} · Level ${shipyardLevel} → ${shipyardLevel + 1}`,
                    () => doStartFacilityUpgrade(SHIPYARD_FACILITY_KEY)
                  )}
                {/if}

                {#if shipyardUpgradeInFlight}
                  {@const progress = shipyardUpgradeInFlight.durationTicks > 0
                    ? (shipyardUpgradeInFlight.durationTicks - shipyardUpgradeInFlight.remainingTicks) / shipyardUpgradeInFlight.durationTicks
                    : 1}
                  <div class="research-name" style="margin-top: 10px;">Currently upgrading…</div>
                  <div class="research-bar-track">
                    <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                  </div>
                  <div class="research-readout">{remainingReadout(shipyardUpgradeInFlight.remainingTicks, shipyardUpgradeInFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                {/if}
              </Panel>
            {/if}
          {:else if activeFoundryFacility === "docks"}
              <!-- DOCKS storage management (0.12.0 Console, CN4b). The Docks is a
                   BUILDING the player manages, so under the perspective model it
                   folds into Facilities. ONLY the ship-STORAGE surface remains: the
                   berth-capacity readout + the "Expand Docks" upgrade (the ONLY UI
                   that raises shipStorageCapacity, so it MUST stay reachable). The
                   per-hull LIST, captain ASSIGNMENT (openAssignPicker/openSwapPicker),
                   and hull SALVAGE (requestSalvage("ship", ...)) that used to share
                   this panel were DROPPED: they are the SAME flows now homed in the
                   Logistics > Ships console (CN3b), reached from the ITEM
                   perspective, so keeping them here would duplicate one action in
                   two places. The degenerate single-tab Docks SubTabs was dropped
                   with them (nothing left to switch between). All remaining reads/
                   gates are UNCHANGED (canUpgradeDocks / doExpandDocks /
                   state.shipStorageCapacity). -->
              <Panel>
                <div class="panel-title">DOCKS</div>
                <!-- Berth capacity + the "Expand Docks" action (Fleet Management,
                     Docks Expansion). The button is disabled + reasoned exactly like
                     the Systems-Bay "Upgrade Bay" button / the facility Build buttons,
                     reading the SAME canUpgradeDocks gate startDocksExpansion enforces,
                     so the UI can't drift from the backend. shipStorageCapacity is the
                     single source: the readout and the +1 both use it directly. -->
                {@const docksCheck = canUpgradeDocks(state)}
                <div class="docks-cap-head">
                  <div class="research-cost">Berths: {state.ships.length} / {state.shipStorageCapacity}</div>
                  <!-- Native `title` removed (2026-07-24 flicker fix): the reason
                       already renders in the persistent docks-expand-note below, a
                       plain text node that updates in place without flicker, so this
                       button needs no hover popover (unlike the facility Build buttons,
                       which have no persistent note and use facilityUpgradeButton). -->
                  <button
                    class="buy-btn docks-expand-btn"
                    disabled={!docksCheck.ok}
                    on:click={doExpandDocks}
                  >
                    Expand Docks
                  </button>
                </div>
                {#if !docksCheck.ok}
                  <div class="docks-expand-note">{docksCheck.reason}</div>
                {/if}
                <!-- Where per-hull management went. The list/assign/salvage that
                     used to render here now live in Logistics > Ships (the ITEM
                     perspective); this pointer keeps the player oriented after the
                     fold. A plain caption, no new state or behavior. -->
                <p class="research-status">
                  Individual hull management, captain assignment, system installs, and salvage now live in Logistics, Ships.
                </p>
              </Panel>
          {/if}
        {/if}
      </div>
      {/if}

      {#if activeTab === "logistics"}
      <!-- LOGISTICS program (0.12.0 "Console" nav, Phase 3 / CN3a). The ITEM
           perspective: everything at the item scope. Replaces the retired Stores
           program (its activeStoresFacility Warehouse | Salvage Bay LEFT RAIL is
           gone). Structure mirrors Home's and Personnel's console idiom exactly:
           the shared <ConsoleTabs> primitive is the slim TOP rail, and the
           selected tab's page renders IN PLACE directly below it; NO left rail
           anywhere. Tabs: Ships | Ship Equipment | Crew Equipment (locked) |
           Materials, driven by activeLogisticsTab (default Materials). Salvaging
           is a FACILITY action (user decision 2026-07-21), so the Salvage Bay is
           NOT a tab here; it lives in the Foundry rail (activeFoundryFacility ===
           "salvageBay") beside the warehouse building-management.
             - Ships          , the ship console (paper-doll + installs, CN3b) plus
                                per-hull assign/swap/salvage. Ship-STORAGE capacity +
                                expansion is the Docks facility under Facilities (CN4b).
             - Ship Equipment , the spare Ship Systems bay, moved VERBATIM from the
                                old Warehouse Finished Goods > Ship Systems (its
                                inner product-family SubTabs strip FLATTENED away per
                                the console principle; the reserved Weapons/Modules/
                                Consumables families are compact locked markers now).
             - Crew Equipment , a locked reserved rail slot (crew equipment does not
                                exist yet); ConsoleTabs blocks its selection, so the
                                locked tab IS the placeholder (no content branch).
             - Materials      , the material CATALOG, moved VERBATIM from the old
                                Warehouse Materials tab (themed sub-categories, tier
                                splits, masked undiscovered items). Its salvaged-
                                material tiles are BROWSE-ONLY here (the salvage
                                action lives in the Foundry Salvage Bay). The
                                warehouse-as-a-building management (Overview +
                                Upgrade) moved to the Foundry tab, NOT here.
           See docs/plans/2026-07-21-console-nav-0.12.0-design.md + -plan.md. -->
      <!-- ConsoleTabs is a NON-SCROLLING header ABOVE .tab-scroll-area (a direct
           flex-shrink:0 child of .tab-body, the same header pattern Operations
           uses), so the content below scrolls and is CLIPPED in its own region
           and never bleeds up under the tabs. See ConsoleTabs.svelte's .ctabs-wrap. -->
      <ConsoleTabs
        tabs={LOGISTICS_TABS}
        active={activeLogisticsTab}
        onSelect={(key) => (activeLogisticsTab = key as "ships" | "shipEquipment" | "crewEquipment" | "materials")}
      />
      <div class="tab-scroll-area">

        {#if activeLogisticsTab === "ships"}
          <!-- SHIPS console (0.12.0 Console, Phase 2 / CN3b). The ITEM perspective's
               flagship screen: view the fleet, open a hull, and outfit it. It mirrors
               the Personnel Captain Roster's grid-then-detail model EXACTLY (a single
               console page that swaps IN PLACE between a card grid and a flat detail
               page via logisticsShipsView, NO nested tab row), so the two consoles
               read identically. The three cross-perspective actions on the ship page
               (Ship Installs / Assign Captain / Salvage) are the EXISTING flows reused
               verbatim from the Drydock Docks list and the captain page, only their
               ENTRY POINT is the ship (design doc 3: buckets are for finding, actions
               bridge across perspectives). The installed-systems paper-doll + full
               stat breakdown live in the ShipSystemsPanel MODAL (opened by Ship
               Installs via the existing openShipSystems invocation, verbatim), the
               SAME modal the Docks and the captain Leveling panel already open; the
               ship page does NOT duplicate that content inline. (CN4b update: the
               Drydock Docks list that these flows first came from has since been
               DROPPED, its per-hull management is now ONLY here; the Docks facility
               under Facilities keeps only ship-storage capacity + expansion.) -->
          {#if logisticsShipsView === "grid"}
          <!-- FLEET grid. The SAME responsive card grid the Captain Roster uses
               (.roster-grid: auto-fill, fills the desktop width with more cards per
               row and collapses to one column on mobile, no media query). Each card
               shows glyph + hull type + the captain aboard (resolved by
               assignedCaptainId, the single source of truth) + idle/on-mission/parked
               status; tapping a card selects that ship (selectedShipId) and swaps this
               page to that ship's console (logisticsShipsView = "ship"). -->
          {#if state.ships.length === 0}
            <Panel>
              <div class="panel-title">SHIPS</div>
              <p class="research-status">
                No ships in the fleet yet. Build a hull at the Shipyard (Facilities) to add one.
              </p>
            </Panel>
          {:else}
          <div class="roster-grid">
            {#each state.ships as ship (ship.id)}
              {@const def = SHIP_TYPES[ship.typeKey]}
              <!-- The captain flying THIS hull, resolved by assignedCaptainId, or
                   null when the hull is parked with no captain. onMission gates the
                   status line the same way the Docks does. -->
              {@const shipCaptain = ship.assignedCaptainId === null
                ? null
                : state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null}
              <button
                class="roster-card"
                on:click={() => {
                  selectedShipId = ship.id;
                  logisticsShipsView = "ship";
                }}
              >
                <div class="roster-card-head">
                  <div class="roster-card-glyph" aria-hidden="true">🚀</div>
                  <div class="roster-card-heading">
                    <div class="research-name">{def.label}</div>
                    <div class="roster-card-sub">Captain: {shipCaptain === null ? "Parked" : shipCaptain.label}</div>
                  </div>
                </div>
                <div class="roster-card-lines">
                  <div class="roster-card-line">
                    {#if shipCaptain === null}
                      Status: Parked
                    {:else if shipCaptain.mission === null}
                      Status: Idle
                    {:else if shipCaptain.mission.kind === "extraction"}
                      Status: On mission, {MISSIONS[shipCaptain.mission.missionKey].label}
                    {:else if shipCaptain.mission.kind === "patrol"}
                      Status: On patrol, {PATROLS[shipCaptain.mission.patrolKey].label}
                    {/if}
                  </div>
                </div>
              </button>
            {/each}
          </div>
          {/if}
          {:else}
          <!-- SHIP page (selected hull, FLAT). Design doc 4a: "pull up a ship; SEE
               its captain ... installed systems, and the full stat breakdown. Outfit
               it in place." Kept FLAT (identity + actions shown directly, the full
               installed-systems paper-doll + stat breakdown in the summoned modal),
               NOT a nested inner tab row, honoring the same FLATTEN principle the
               captain page uses. The hull is looked up INLINE from selectedShipId
               (so a reassign/salvage reflects live); if it has vanished the
               vanished-hull guard above has already flipped back to the grid, so the
               {#if ship !== null} guard here is belt-and-suspenders. A "Ships" back
               control returns to the grid. -->
          {@const ship = state.ships.find((s) => s.id === selectedShipId) ?? null}
          {#if ship !== null}
          {@const def = SHIP_TYPES[ship.typeKey]}
          <!-- assignedCaptain: the captain flying THIS hull (or null if parked);
               onMission gates the Assign/Salvage controls exactly as the Docks does.
               parkedShips / idleCaptains gate the Assign Captain control's three
               cases (see below), recomputed reactively as ships/captains change. -->
          {@const assignedCaptain = ship.assignedCaptainId === null
            ? null
            : state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null}
          {@const onMission = assignedCaptain !== null && assignedCaptain.mission !== null}
          {@const parkedShips = state.ships.filter((s) => s.assignedCaptainId === null)}
          {@const idleCaptains = state.captains.filter((c) => c.mission === null)}
          <div class="roster-back-row">
            <button
              class="dev-btn"
              on:click={() => {
                logisticsShipsView = "grid";
                selectedShipId = null;
              }}
            >
              ← Ships
            </button>
            <div class="research-name roster-detail-name">{def.label}</div>
          </div>

          <!-- SHIP IDENTITY (composed read, cheap fields only). Hull type, the
               captain aboard (a READ; assigning is an action below), and status.
               The full installed-systems + stat breakdown deliberately live in the
               Ship Installs modal (the paper-doll), NOT duplicated here. -->
          <Panel>
            <div class="panel-title">SHIP</div>
            <div class="research-name">{def.label}</div>
            <div class="research-cost">Captain: {assignedCaptain === null ? "None, parked" : assignedCaptain.label}</div>
            <div class="research-cost">
              {#if assignedCaptain === null}
                Status: Parked
              {:else if assignedCaptain.mission === null}
                Status: Idle
              {:else if assignedCaptain.mission.kind === "extraction"}
                Status: On mission, {MISSIONS[assignedCaptain.mission.missionKey].label}
              {:else if assignedCaptain.mission.kind === "patrol"}
                Status: On patrol, {PATROLS[assignedCaptain.mission.patrolKey].label}
              {/if}
            </div>
          </Panel>

          <!-- SHIP ACTIONS (0.12.0 Console Phase 2). Cross-perspective affordances
               reached from the ITEM (the ship); each is an EXISTING flow reused
               verbatim, only the entry point differs:
                 - Ship Installs: opens the ShipSystemsPanel paper-doll modal via the
                   SAME openShipSystems(ship.id) invocation the Docks + captain page
                   use. Always enabled (it works for a parked hull too; the on-mission
                   install lock is enforced INSIDE the panel, not here).
                 - Assign Captain: the Docks' exact three-case ship-side logic:
                   PARKED -> openAssignPicker (pick an idle captain), disabled when no
                   idle captain exists; ASSIGNED + captain IDLE -> openSwapPicker (pick
                   a parked ship), disabled when no parked ship exists; ASSIGNED +
                   captain ON-MISSION -> disabled with the recall-first reason (you
                   cannot pull a hull out from under an active mission).
                 - Salvage: requestSalvage("ship", ...), the SAME shared confirm flow
                   the Docks Salvage button uses (on-mission lock + captain-aboard
                   warning + doSalvageShip). Disabled on-mission (salvageShip enforces
                   the same lock). On success the selectedShip reactive resolves to
                   null and the page falls back to the grid automatically. -->
          <Panel>
            <div class="panel-title">SHIP ACTIONS</div>
            <div class="dev-row">
              <button
                class="dev-btn"
                on:click={() => openShipSystems(ship.id)}
              >
                Ship Installs
              </button>

              {#if assignedCaptain === null}
                <button
                  class="dev-btn"
                  disabled={idleCaptains.length === 0}
                  title={idleCaptains.length === 0 ? "No idle captain, recall one first" : undefined}
                  on:click={() => openAssignPicker(ship.id)}
                >
                  Assign Captain
                </button>
              {:else if onMission}
                <button class="dev-btn" disabled title="On a mission, recall first">
                  Assign Captain
                </button>
              {:else}
                <button
                  class="dev-btn"
                  disabled={parkedShips.length === 0}
                  title={parkedShips.length === 0 ? "No spare ship, buy or free one" : undefined}
                  on:click={() => openSwapPicker(assignedCaptain.id)}
                >
                  Assign Captain
                </button>
              {/if}

              <!-- Salvage is BLOCKED for the fleet's only hull (state.ships.length === 1): tearing
                   it down would strand the player with no ship and no mission income, a practical
                   softlock (salvageShip enforces the same lastShip guard server-side). Disabled +
                   reason here mirrors the on-mission block so the player sees WHY before clicking. -->
              <button
                class="dev-btn danger"
                disabled={onMission || state.ships.length === 1}
                title={onMission
                  ? "On a mission, recall first"
                  : state.ships.length === 1
                    ? "Cannot salvage your last ship: your fleet would be left with no hull"
                    : "Break down this hull for parts"}
                on:click={() => requestSalvage("ship", ship.id, def.label)}
              >
                Salvage
              </button>
            </div>
          </Panel>
          {/if}
          {/if}
        {/if}

        {#if activeLogisticsTab === "shipEquipment"}
          <!-- SHIP EQUIPMENT (0.12.0 Console, CN3a). The spare Ship Systems bay,
               moved VERBATIM from the old Warehouse Finished Goods > Ship Systems
               tab. The old inner product-family SubTabs strip is FLATTENED away
               (the console principle: an inner tab layer under ConsoleTabs
               collapses); the bay renders DIRECTLY here. The reserved Weapons /
               Modules / Consumables families become compact locked "coming soon"
               markers below, preserving the combat-roadmap signal without a nested
               tab layer. All reads/actions go through the SAME engine helpers the
               fabricate gate + storage engine use (spareEquipmentCount /
               equipmentStorageCap / canUpgradeEquipmentStorage /
               startEquipmentStorageUpgrade / salvageEquipment), and the
               EquipmentTooltip is reused unchanged. -->
          {@const bayCap = equipmentStorageCap(state)}
          {@const baySpare = spareEquipmentCount(state)}
          {@const upgradeCheck = canUpgradeEquipmentStorage(state)}
          <Panel>
            <!-- CAPACITY HEADER: spare / cap + the Upgrade Bay button
                 (disabled + reasoned exactly like the warehouse-tier Build
                 buttons, mirroring canUpgradeEquipmentStorage). -->
            <div class="systems-bay-head">
              <div class="systems-bay-cap">
                <span class="systems-bay-cap-label">Systems Bay</span>
                <span class="systems-bay-cap-val">{baySpare} <small>/ {bayCap} spare</small></span>
              </div>
              <!-- Native `title` removed (2026-07-24 flicker fix): the reason already
                   renders in the persistent systems-bay-upgrade-note below, a plain
                   text node that updates in place without flicker, so this button needs
                   no hover popover (unlike the facility Build buttons, which have no
                   persistent note and use facilityUpgradeButton). -->
              <button
                class="buy-btn systems-bay-upgrade"
                disabled={!upgradeCheck.ok}
                on:click={doUpgradeEquipmentBay}
              >
                Upgrade Bay
              </button>
            </div>
            {#if !upgradeCheck.ok}
              <div class="systems-bay-upgrade-note">{upgradeCheck.reason}</div>
            {/if}

            {#if baySystemGroups.length === 0}
              <div class="warehouse-stub">
                <div class="warehouse-stub-glyph">🛰️</div>
                <p>No spare systems in the bay. Fabricate ship systems at the Fabricator, or uninstall an installed system to store it here.</p>
              </div>
            {:else}
              {#each baySystemGroups as group (group.slot)}
                <div class="warehouse-tier">
                  <div class="warehouse-tier-head">
                    <span class="warehouse-tier-label">{group.label}</span>
                    <span class="warehouse-tier-line"></span>
                    <span class="warehouse-tier-cap">{group.pieces.length} system{group.pieces.length === 1 ? "" : "s"}</span>
                  </div>
                  <div class="warehouse-grid">
                    {#each group.pieces as piece (piece.id)}
                      {@const isBaseline = piece.blueprintKey === null}
                      <button
                        type="button"
                        class="systems-tile"
                        class:baseline={isBaseline}
                        class:selected={selectedSystemId === piece.id}
                        style="--sys-rc: {equipmentRarityColor(piece.rarity)};"
                        title={isBaseline ? "Standard-Issue baseline" : `${piece.rarity} · Q${piece.quality}`}
                        on:click={() => selectSystemTile(piece.id)}
                      >
                        <span class="systems-tile-dot"></span>
                        <span class="systems-tile-ic">{equipmentIcon(piece)}</span>
                        <span class="systems-tile-il">iL {piece.iLevel}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          </Panel>

          <!-- SELECTED SYSTEM: the reusable rarity-bordered tooltip, rendered
               inline (not a floating layer) so it is scroll-safe on device.
               BROWSE-ONLY here: this tab shows a spare system's stats but hosts
               NO Salvage action. Breaking a spare system down lives in the
               Salvage tab, so no action children are passed to EquipmentTooltip
               here. -->
          {#if selectedSystem}
            {@const sys = selectedSystem}
            <Panel>
              <EquipmentTooltip piece={sys} />
            </Panel>
          {/if}

          <!-- RESERVED product families (0.12.0 Console, CN3a). The old locked
               Finished Goods SubTabs (Weapons / Modules / Consumables) flatten to
               a compact chip row of honest "coming soon" markers, no engine behind
               them yet. Same locked visual language as the ConsoleTabs locked tab
               (accent border + faint fill + opacity), expressed inline with the
               existing accent/text tokens so no new class or color is introduced.
               A family becomes real when combat lands (0.13.0), at which point it
               graduates to its own top-level Logistics ConsoleTab. -->
          <Panel>
            <div class="warehouse-tier-head">
              <span class="warehouse-tier-label">Reserved</span>
              <span class="warehouse-tier-line"></span>
              <span class="warehouse-tier-cap">coming soon</span>
            </div>
            <div class="dev-row" style="flex-wrap: wrap; gap: 8px;">
              {#each LOGISTICS_RESERVED_GOODS as label (label)}
                <span
                  style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(var(--color-accent-rgb), 0.2); background: rgba(var(--color-accent-rgb), 0.06); color: var(--color-text-secondary); font-size: 13px; opacity: 0.5;"
                  title="Reserved for a future update (combat)"
                >🔒 {label}</span>
              {/each}
            </div>
          </Panel>
        {/if}

        {#if activeLogisticsTab === "materials"}
          <!-- MATERIALS (moved VERBATIM from the old Warehouse Materials tab,
               0.11.2 Task 9). ONE scrollable pane: a Tier selector, then a fixed
               series of themed labeled sections. Each section reuses the SAME
               fill-tile grid the old flat catalog tabs used (fill / rarity color /
               ❓-mask / count / showWarehouseTooltip), rendering its items AT the
               selected tier. Raw items partition across the first four sections by
               their subCategory. Sections with no items at the selected tier are
               hidden. Salvaged Materials is the final section and stays browse-only
               (select-to-salvage lives in the Salvage tab). -->
          {@const tierUnlocked = warehouseTierUnlocked(activeMaterialsTier)}
          {@const cap = tierCap(state, activeMaterialsTier)}

          <!-- TIER SELECTOR: pick which storage tier's stock to view. Reuses
               WAREHOUSE_TIERS + warehouseTierUnlocked. A locked tier is still
               selectable (its sections show, dimmed, with a locked note),
               matching the old per-tier locked banner. -->
          <div class="materials-tier-select" role="group" aria-label="Storage tier">
            {#each WAREHOUSE_TIERS as wt (wt.key)}
              <button
                type="button"
                class="materials-tier-btn"
                class:active={activeMaterialsTier === wt.tier}
                aria-pressed={activeMaterialsTier === wt.tier}
                on:click={() => (activeMaterialsTier = wt.tier)}
              >{wt.label}</button>
            {/each}
          </div>

          <Panel>
            <div class="materials-cap-line">
              {tierUnlocked ? `Cap ${formatNumber(cap)} / item` : "This tier's storage is locked."}
            </div>

            {#if !tierUnlocked}
              {@const unlockRung = FACILITIES[`warehouseT${activeMaterialsTier}`]?.upgrades[0]}
              {@const unlockIds = unlockRung ? Object.keys(unlockRung.materials) : []}
              <p class="warehouse-locked-note">
                Tier {activeMaterialsTier} storage locked, <b>unlock in the Warehouse (Facilities)</b>{#if unlockRung && unlockIds.length > 0} ({formatNumber(unlockRung.materials[unlockIds[0]])} [{ITEMS[unlockIds[0]]?.label ?? unlockIds[0]}]){/if}.
              </p>
            {/if}

            {#if materialsTierEmpty && tierUnlocked}
              <!-- Only shown for an UNLOCKED but still-empty tier: a locked tier
                   already explains itself via the locked note above, and telling
                   the player to "gather and refine to fill these shelves" would be
                   misleading when the shelves are not unlocked yet. -->
              <div class="warehouse-stub">
                <div class="warehouse-stub-glyph">🗄️</div>
                <p>No materials at this tier yet. Gather from missions and refine to fill these shelves.</p>
              </div>
            {/if}

            <!-- STANDARD SECTIONS: the four raw sub-categories, then Refined,
                 then Components. Each renders the shared fill-tile grid; an
                 empty section is hidden. -->
            {#each materialsStandardSections as section (section.key)}
              {#if section.items.length > 0}
                <div class="warehouse-tier materials-section" class:locked={!tierUnlocked}>
                  <div class="warehouse-tier-head">
                    <span class="warehouse-tier-label">{section.label}</span>
                    <span class="warehouse-tier-line"></span>
                    <span class="warehouse-tier-cap">{section.items.length} item{section.items.length === 1 ? "" : "s"}</span>
                  </div>
                  <div class="warehouse-grid">
                    {#each section.items as item (item.id)}
                      {@const discovered = state.discovered.includes(item.id)}
                      {@const count = itemTotal(state.inventory, item.id)}
                      {@const atCap = discovered && materialAtCap(state, item.id)}
                      {@const pct = warehouseFillPct(count, cap)}
                      {@const rarityRing = item.rarity === "rare" || item.rarity === "epic" || item.rarity === "legendary"}
                      <button
                        type="button"
                        class="warehouse-tile"
                        class:unknown={!discovered}
                        class:full={atCap}
                        class:rare-ring={discovered && rarityRing}
                        style="--wh-rc: {warehouseRarityColor(item.rarity)};"
                        on:pointerenter={(e) => hoverEnterWarehouseTooltip(e, item.id)}
                        on:pointerleave={(e) => hoverLeaveWarehouseTooltip(e, item.id)}
                        on:focus={(e) => focusShowWarehouseTooltip(e, item.id)}
                        on:blur={hideWarehouseTooltip}
                        on:click={(e) => toggleWarehouseTooltip(e, item.id)}
                      >
                        {#if discovered}
                          <span
                            class="warehouse-fill"
                            style="height: {atCap ? 100 : pct}%; --wh-fillc: {atCap ? 'var(--color-danger)' : 'var(--wh-rc)'};"
                          ></span>
                          <span class="warehouse-pct">{Math.round(atCap ? 100 : pct)}%</span>
                          <span class="warehouse-glyph">{warehouseCategoryGlyph(item.category)}</span>
                          <span class="warehouse-ct">{formatNumber(count)}</span>
                        {:else}
                          <span class="warehouse-glyph warehouse-glyph-unknown">❓</span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}

            <!-- Salvaged Materials no longer has a special block: it is the final
                 entry in MATERIALS_SECTIONS, so it renders above in the standard
                 fill-tile loop like every other material section (user 2026-07-21).
                 The salvage ACTION lives in the Foundry Salvage Bay facility. -->
          </Panel>
        {/if}
      </div>
      {/if}

      {#if activeTab === "personnel"}
      <!-- PERSONNEL program (0.12.0 "Console" nav, Phase 1). The person
           perspective: the Fleet Admiral and the Captains. Replaces the old
           "Crew" tab (fleetCaptains + its Overview/Talents SubTabs + left-rail
           captain list). Structure mirrors Home's console idiom exactly:
             - the shared <ConsoleTabs> primitive is the slim TOP rail (Admiral |
               Captain Roster), sticky + glowing-active + edge-scroll, driven by
               activePersonnelTab; NO left rail anywhere.
             - the selected tab's page renders IN PLACE below the rail.
           Admiral is a STUB this task (built out in a follow-up, CN2b); Captain
           Roster is built out here. See
           docs/plans/2026-07-21-console-nav-0.12.0-design.md + -plan.md. -->
      <!-- ConsoleTabs is a NON-SCROLLING header ABOVE .tab-scroll-area (see the
           Logistics/Operations header pattern), so captain-roster content scrolls
           and is CLIPPED below and never bleeds up under the tabs. -->
      <ConsoleTabs
        tabs={[
          { key: "admiral", label: "Admiral" },
          { key: "roster", label: "Captain Roster" },
        ]}
        active={activePersonnelTab}
        onSelect={(key) => (activePersonnelTab = key as "admiral" | "roster")}
      />
      <div class="tab-scroll-area">

        {#if activePersonnelTab === "admiral"}
        <!-- ADMIRAL page (0.12.0 Console, Phase 1 / CN2b). The Fleet Admiral is a
             PERSON, so it lives in the person perspective: a lean FA OVERVIEW
             (identity + level/XP + the admin-point + credit readouts, all from
             EXISTING state, mirroring the captain leveling panel) plus an ACTIONS
             area whose live "Prestige" button opens the FA prestige tree in a
             modal. This replaced the old Admiral stub and re-homed the retired
             Homeworld tab's ADMINISTRATION tree (see the Prestige modal below). -->
        <!-- FA OVERVIEW. fleetAdminXpRatio is the SAME reactive the header XP bar
             uses (declared once via $:), so this bar and the header stay in lock
             step. Admin Points is the prestige currency the tree spends; Credits
             is shown because the prestige Reset is priced in credits. No new
             tracked state is introduced. -->
        <Panel>
          <div class="panel-title">FLEET ADMIRAL</div>
          <div class="research-name">Level {state.fleetAdminLevel}</div>
          <div class="research-bar-track">
            <div class="research-bar-fill" style="width:{Math.min(100, fleetAdminXpRatio * 100)}%"></div>
          </div>
          <div class="research-readout">{formatNumber(state.fleetAdminXp)} / {formatNumber(xpForNextFleetAdminLevel(state.fleetAdminLevel))} XP</div>
          <div class="research-cost">Admiralty Points: {formatNumber(state.adminPoints)}</div>
          <div class="research-cost">Credits: {formatNumber(state.credits)}</div>
        </Panel>

        <!-- ADMIRAL ACTIONS. The Prestige button opens the FA prestige tree in its
             own modal (same idiom as the captain Talents button/modal); always
             enabled, the tree's own affordability/gating lives inside the modal. -->
        <Panel>
          <div class="panel-title">ADMIRAL ACTIONS</div>
          <div class="dev-row">
            <button class="dev-btn" on:click={() => (admiralPrestigeModalOpen = true)}>Talents</button>
          </div>
        </Panel>

        <!-- Admiral Prestige MODAL (0.12.0 Console, Phase 1 / CN2b). Built on the
             SAME shared idiom as the captain Talents modal and the System modal:
             the fixed .modal-backdrop + the shared focusTrap action (Escape
             closes, focus trapped + restored), the .system-modal-dialog surface
             (OPAQUE, since Brave disables backdrop-filter), its header (title +
             ✕) and its internally-scrolling .system-modal-body. The ENTIRE
             ADMINISTRATION panel below (the category TreeSelector-or-RadialWeb +
             the ← Categories / Reset button row and ALL its wiring) is the old
             Homeworld tab's Administration panel moved VERBATIM. -->
        {#if admiralPrestigeModalOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus, INTENTIONAL: same reasoning as the System / captain-talents modal backdrops, the backdrop click-to-close is a convenience; Escape (focusTrap) and the header ✕ both close, and the dialog's controls (TreeSelector / RadialWeb / Reset) are focusable and trapped inside. -->
        <div
          class="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Fleet Admiral Talents"
          use:focusTrap={() => (admiralPrestigeModalOpen = false)}
          on:click={onAdmiralPrestigeBackdropClick}
        >
          <div class="system-modal-dialog">
            <header class="system-modal-header">
              <div class="system-modal-title">Fleet Admiral, Talents</div>
              <button class="system-modal-close" on:click={() => (admiralPrestigeModalOpen = false)} aria-label="Close Fleet Admiral Talents">✕</button>
            </header>
            <div class="system-modal-body">
              <!-- Homeworld Talents (Task 6, Captain & Homeworld Talent Trees) --
                   fleet-wide (not per-captain, reads state.adminPoints /
                   state.unlockedHomeworldTalents directly, never activeCaptain).
                   Same fixed-5-branch iteration pattern as the Captain Talents
                   panel, so Homeland Defense/Citizenry (zero entries today, see
                   model.ts) render as labeled, empty columns.

                   Homeworld Talents are Fleet Admiral prestige, gated ENTIRELY on
                   adminPoints, deliberately independent of any individual
                   captain's own level/statPoints (those only ever gate that
                   captain's OWN Captain Talents). Confirmed with the user rather
                   than inventing a captain-scoped gate for a fleet-wide purchase.

                   Moved VERBATIM out of the retired Homeworld tab's ADMINISTRATION
                   panel into this Admiral Prestige modal (0.12.0 Console / CN2b);
                   the tree, its category selector, the Reset control, and all
                   wiring are UNCHANGED, only the host chrome moved. -->
              <Panel>
                <div class="panel-title">ADMINISTRATION</div>
                <div class="research-cost">Admiralty Points: {formatNumber(state.adminPoints)}</div>
                <div class="research-cost">Credits: {formatNumber(state.credits)}</div>
                <!-- Shared button row: the "← Categories" back button (left, shown ONLY
                     while viewing a category) and the fleet-wide Reset (right, always
                     available) sit on ONE row, so it reads clean and parallels the captain
                     panel's single button row. Reset wraps respecHomeworldTalents via the
                     confirmation modal near DELETE SAVE; disabled up-front so affordability
                     shows before opening the flow. margin-left:auto pins Reset to the right
                     whether or not the back button is present. -->
                <div class="dev-row">
                  {#if selectedCategory !== null}
                    <button
                      type="button"
                      class="dev-btn"
                      on:click={() => (selectedCategory = null)}
                    >
                      ← Categories
                    </button>
                  {/if}
                  <button
                    class="dev-btn danger"
                    style="margin-left: auto;"
                    disabled={state.credits.lt(RESPEC_COST_CREDITS)}
                    on:click={openHomeworldRespecModal}
                  >
                    Reset
                  </button>
                </div>
                <!-- Radial Skill Web (Task 15), the 5-category selector sits in
                     FRONT of the RadialWeb. selectedCategory is component-local,
                     view-only NAVIGATION state (never persisted): null shows the
                     TreeSelector category card-picker; a chosen category shows THAT
                     category's RadialWeb plus a back button to the picker. This is
                     deliberately UNLIKE the captain spec flow: there is no lock-in,
                     no cost, and no save write, committing a card just navigates
                     (viewCategory), and the back button just returns to the picker,
                     both freely reversible. The Reset button above
                     (respecHomeworldTalents) is orthogonal and unchanged. `owned` is
                     the fleet-wide state.unlockedHomeworldTalents, `points` the shared
                     adminPoints pool; onLearn routes the tooltip's Learn button into
                     the EXISTING doBuyHomeworldTalent wrapper (buyHomeworldTalent +
                     pushLog + save), so learning still works exactly as before.
                     describeEffect passes the homeworld effect describer through so
                     RadialWeb's internal tooltip renders the right effect line without
                     importing it. NOTE: keep Svelte block tokens (hash-if / colon-else
                     / slash-if) OUT of this comment, they can trip the parser even
                     inside an HTML comment. -->
                {#if selectedCategory === null}
                  <TreeSelector
                    cards={categoryCards}
                    commitLabel={"View Tree"}
                    onCommit={(key) => viewCategory(key)}
                  />
                {:else}
                  <!-- Category selected: THAT category's RadialWeb. The "← Categories" back
                       button (pure navigation, clears selectedCategory, no save write) now
                       lives in the shared button row above. selectedCategory is a plain local
                       that TS narrows to non-null across the conditional, but the trailing !
                       is kept for consistency with the captain mount's activeCaptain.spec!
                       (and it is genuinely non-null here). -->
                  <RadialWeb
                    table={HOMEWORLD_TALENTS}
                    branch={selectedCategory!}
                    owned={state.unlockedHomeworldTalents}
                    points={state.adminPoints}
                    pointsLabel={"Admiralty Points"}
                    fleetAdminLevel={state.fleetAdminLevel}
                    describeEffect={describeHomeworldTalentEffect}
                    onLearn={(key) => doBuyHomeworldTalent(key as HomeworldTalentKey)}
                  />
                {/if}
              </Panel>
            </div>
          </div>
        </div>
        {/if}
        {/if}

        {#if activePersonnelTab === "roster"}
          {#if personnelRosterView === "grid"}
          <!-- CAPTAIN ROSTER grid. A responsive card grid (auto-fill, so it
               fills the desktop width with more cards per row and collapses to a
               single column on mobile, NO media query, same reflow the mission
               grid uses). Each card shows glyph + name + level + assigned ship +
               idle/on-mission status; tapping a card selects that captain
               (activeCaptainIndex) and swaps this page to that captain's console
               (personnelRosterView = "captain"). The empty locked/coming-soon
               slots below carry the SAME split logic verbatim from the old
               left-rail list. -->
          <div class="roster-grid">
            {#each state.captains as captain, i}
              <!-- The captain's current hull, resolved by assignedCaptainId (the
                   single source of truth), or null when parked with no ship. -->
              {@const rosterShip = state.ships.find((s) => s.assignedCaptainId === captain.id) ?? null}
              <button
                class="roster-card"
                on:click={() => {
                  activeCaptainIndex = i;
                  personnelRosterView = "captain";
                }}
              >
                <div class="roster-card-head">
                  <div class="roster-card-glyph" aria-hidden="true">🎖️</div>
                  <div class="roster-card-heading">
                    <div class="research-name">{captain.label}</div>
                    <div class="roster-card-sub">Level {captain.level}</div>
                  </div>
                </div>
                <div class="roster-card-lines">
                  <!-- Renamable Ships: show the custom name (with the hull class in
                       parens so the hull stays visible), else just the hull label. -->
                  <div class="roster-card-line">Ship: {rosterShip === null ? "None" : rosterShip.name ? `${rosterShip.name} (${SHIP_TYPES[rosterShip.typeKey].label})` : SHIP_TYPES[rosterShip.typeKey].label}</div>
                  <div class="roster-card-line">
                    {#if captain.mission === null}
                      Status: Idle
                    {:else if captain.mission.kind === "extraction"}
                      Status: On mission, {MISSIONS[captain.mission.missionKey].label}
                    {:else if captain.mission.kind === "patrol"}
                      Status: On patrol, {PATROLS[captain.mission.patrolKey].label}
                    {/if}
                  </div>
                </div>
              </button>
            {/each}
            <!-- Empty slots up to a roadmap max of 10 captains, split two ways
                 (Progression Pacing Rework, Task 11 relabel), logic UNCHANGED
                 from the old captain-list, only the presentation moved from
                 list rows to grid cards:
                   - "Locked"      = a captain the CURRENT content can unlock once
                                     its Fleet Logistics talent + FA-level wall are
                                     met. These EXIST today: captains 2/3/4, backed
                                     by HOMEWORLD_TALENTS fleetLogisticsSlot1/2/3.
                   - "Coming Soon" = a roadmap slot past captain 4 (slots 5-10) with
                                     NO unlock path built yet, only 3 slot-unlock
                                     nodes exist; see KNOWN_ISSUES.md (Task 6).
                 The captain number a slot represents is (owned count + j + 1); it's
                 unlockable when that number is within MAX_UNLOCKABLE_CAPTAINS (the
                 live 1+3=4 ceiling derived in model.ts, so this split shifts
                 automatically the day a fleetLogisticsSlot4 node lands, no edit
                 here needed). Array.from({length: N}) is used (not a bare
                 {length: N} object) since Svelte's {#each} needs a real iterable,
                 not just an array-like object. -->
            {#each Array.from({ length: Math.max(0, 10 - state.captains.length) }) as _, j}
              {@const captainNumber = state.captains.length + j + 1}
              {@const isUnlockable = captainNumber <= MAX_UNLOCKABLE_CAPTAINS}
              <div
                class="roster-card locked"
                title={isUnlockable
                  ? "Locked, recruit via Homeworld Talents → Fleet Logistics"
                  : "Coming soon, not yet unlockable"}
              >
                <div class="roster-card-head">
                  <div class="roster-card-glyph" aria-hidden="true">🔒</div>
                  <div class="roster-card-heading">
                    <div class="research-name">{#if isUnlockable}Locked{:else}Coming Soon!{/if}</div>
                    <div class="roster-card-sub">{#if isUnlockable}Recruit via Homeworld Talents{:else}Not yet unlockable{/if}</div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
          {:else}
          <!-- CAPTAIN CONSOLE (selected captain, FLAT). Design doc 4a: "ONE page
               to assign their ship, set their name, spend talent points (the
               radial tree renders here), equip them. Everything about that
               captain on a single page." So this is a flat stack (identity +
               leveling, then actions, then talents shown directly), NOT a nested
               inner tab row, honoring the FLATTEN principle that keeps the
               console from re-growing tab depth. The captain is the existing
               activeCaptain (activeCaptainIndex, set when the card was tapped);
               every per-captain read/write below is UNCHANGED from the old
               Overview/Talents sub-tabs. A back control returns to the grid. -->
          <div class="roster-back-row">
            <!-- Back to the roster grid. Also closes the Talents modal so it can
                 never linger open into the next captain the player selects (the
                 modal is gated on this same captain view, so a stale-true flag
                 would otherwise pop it straight open on the next card tap). -->
            <button
              class="dev-btn"
              on:click={() => {
                captainTalentsModalOpen = false;
                personnelRosterView = "grid";
              }}
            >
              ← Captains
            </button>
            <div class="research-name roster-detail-name">{activeCaptain.label}</div>
          </div>

          <!-- Captain Leveling (Task 8, Phase 4; originally relocated into the
               old Fleet Captain's tab's Overview sub-tab during the UI Redesign,
               Task 8, see docs/plans/2026-07-07-ui-redesign-plan.md; re-homed
               VERBATIM into the Personnel captain console, 0.12.0 Console Phase
               1) -- per-captain-scoped (reads activeCaptain, not the whole
               fleet). The "Currently: Idle" / "Currently on: ..." line and the
               Ship Systems shortcut are preserved unchanged; the MISSIONS panel
               (dispatch/recall UI) still lives on the Operations tab, not here. -->
          <Panel>
            <div class="panel-title">CAPTAIN LEVELING</div>
            <div class="research-name">Level {activeCaptain.level}</div>
            {@const activeCaptainXpRatio = activeCaptain.xp.dividedBy(xpForNextLevel(activeCaptain.level)).toNumber()}
            <div class="research-bar-track">
              <div class="research-bar-fill" style="width:{Math.min(100, activeCaptainXpRatio * 100)}%"></div>
            </div>
            <div class="research-readout">{formatNumber(activeCaptain.xp)} / {formatNumber(xpForNextLevel(activeCaptain.level))} XP</div>
            <div class="research-cost">Stat Points: {formatNumber(activeCaptain.statPoints)}</div>
            <div class="research-cost">
              {#if activeCaptain.mission === null}
                Currently: Idle
              {:else if activeCaptain.mission.kind === "extraction"}
                Currently on: {MISSIONS[activeCaptain.mission.missionKey].label}
              {:else if activeCaptain.mission.kind === "patrol"}
                Currently on: {PATROLS[activeCaptain.mission.patrolKey].label}
              {/if}
            </div>
            <!-- Ship Systems shortcut (0.11.0): opens the SAME install screen
                 the Docks ship list opens, targeting THIS captain's assigned
                 hull. assignedCaptainId is the single source of truth, so we
                 resolve the ship by it; disabled with a reason when the captain
                 is flying no hull (parked with no ship assigned). -->
            {@const activeCaptainShip = state.ships.find((s) => s.assignedCaptainId === activeCaptain.id) ?? null}
            <div class="dev-row" style="margin-top: 10px;">
              <button
                class="dev-btn"
                disabled={activeCaptainShip === null}
                title={activeCaptainShip === null ? "This captain has no assigned ship" : undefined}
                on:click={() => activeCaptainShip && openShipSystems(activeCaptainShip.id)}
              >
                Ship Systems
              </button>
            </div>
          </Panel>

          <!-- Captain actions (0.12.0 Console Phase 1). Cross-perspective
               affordances that live ON the person (design doc 3: buckets are for
               finding, actions bridge across perspectives):
                 - Assign Ship: the EXISTING captain-centric picker,
                   openSwapPicker(activeCaptain.id), routing through doAssignShip
                   -> assignShipToCaptain (lists parked ships; the captain's
                   current hull, if any, auto-parks). Honors the on-mission lock:
                   disabled with the recall-first reason while the captain is out,
                   exactly as the Docks Swap control does.
                 - Rename: LIVE (Combat 0.13.0, Phase 1, Task 1.6). Opens the
                   captain-rename modal, which routes the new name through the pure
                   renameCaptain seam (validation lives there). Ungated: naming has
                   no mission lock, a captain can be renamed anytime.
                 - Equip: RESERVED. No crew-equipment system exists yet, so it stays
                   an honest disabled "coming soon" affordance, NOT invented
                   behavior. -->
          <Panel>
            <div class="panel-title">CAPTAIN ACTIONS</div>
            <div class="dev-row">
              <button
                class="dev-btn"
                disabled={activeCaptain.mission !== null}
                title={activeCaptain.mission !== null ? "On a mission, recall first" : undefined}
                on:click={() => openSwapPicker(activeCaptain.id)}
              >
                Assign Ship
              </button>
              <!-- Talents: opens THIS captain's talent tree in its own modal (the
                   same gear-portrait/System modal idiom), keeping the captain page
                   focused on leveling + actions. Always enabled; the tree's own
                   spec-gating / affordability lives inside the modal, unchanged. -->
              <button class="dev-btn" on:click={() => (captainTalentsModalOpen = true)}>Talents</button>
              <!-- Rename: opens the captain-rename modal (see openCaptainRenameModal
                   and the modal markup below). Ungated, a captain can be renamed at
                   any time. -->
              <button class="dev-btn" on:click={openCaptainRenameModal}>Rename</button>
              <button class="dev-btn" disabled title="Coming soon, not yet available">Equip</button>
            </div>
          </Panel>

          <!-- Captain Talents MODAL (0.12.0 Console Phase 1 follow-up). The tree
               no longer renders inline on the captain page; it opens HERE, in its
               own modal, built on the SAME shared idiom as the System
               (gear-portrait) modal so the two look and behave identically:
               the fixed .modal-backdrop + the shared focusTrap action (Escape
               closes, focus trapped + restored), the .system-modal-dialog
               surface (OPAQUE, since Brave disables backdrop-filter), its header
               (title + ✕) and its internally-scrolling .system-modal-body. Only
               rendered on the captain view, so activeCaptain is always defined
               here; captainTalentsModalOpen gates it. The ENTIRE talents Panel
               below (the spec-gated TreeSelector-or-RadialWeb + Reset control and
               ALL its wiring) is the previous inline panel moved VERBATIM. -->
          {#if captainTalentsModalOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus, INTENTIONAL: same reasoning as the System modal backdrop, the backdrop click-to-close is a convenience; Escape (focusTrap) and the header ✕ both close, and the dialog's controls (TreeSelector / RadialWeb / Reset) are focusable and trapped inside. -->
          <div
            class="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Captain Talents"
            use:focusTrap={() => (captainTalentsModalOpen = false)}
            on:click={onCaptainTalentsBackdropClick}
          >
            <div class="system-modal-dialog">
              <header class="system-modal-header">
                <div class="system-modal-title">Captain {activeCaptain.label}, Talents</div>
                <button class="system-modal-close" on:click={() => (captainTalentsModalOpen = false)} aria-label="Close Captain Talents">✕</button>
              </header>
              <div class="system-modal-body">
                <!-- Captain Talents (Task 6, Captain & Homeworld Talent Trees;
                     originally relocated into the old Fleet Captain's Talents sub-tab
                     during the UI Redesign, Task 8; re-homed into the Personnel
                     captain console, 0.12.0 Console Phase 1; moved VERBATIM again
                     into this modal, Phase 1 follow-up), per-captain-scoped, like
                     Captain Leveling above (reads activeCaptain, not the whole
                     fleet), spends THIS captain's own statPoints, records the unlock
                     on THIS captain only (activeCaptain.unlockedCaptainTalents),
                     never touches any other captain's state. Iterates the FIXED
                     5-branch list, not Object.keys(CAPTAIN_TALENTS), so
                     Tactical/Science/Diplomacy (currently zero entries, see model.ts)
                     still render as labeled, empty columns rather than not appearing
                     at all. -->
                <Panel>
                  <div class="panel-title">CAPTAIN TALENTS, {activeCaptain.label}</div>
                  <div class="research-cost">
                    Spec: {activeCaptain.spec === null
                      ? "None chosen"
                      : (SPEC_DISPLAY_NAME[activeCaptain.spec] ?? activeCaptain.spec)}
                  </div>
                  <!-- Radial Skill Web (Task 14), spec-gated captain Talents view.
                       FIRST PICK IS FREE, CHANGING IT COSTS A RESPEC (confirmed
                       design decision):
                       - spec === null: the captain has not chosen a specialization
                         yet. Show the TreeSelector card-picker; committing a card
                         calls chooseSpec(key), which sets the spec for FREE (no
                         cost, no point change, chooseCaptainSpec only succeeds
                         from null). There is no Reset here: there's nothing to
                         reset until a spec exists.
                       - spec !== null: show THAT spec's RadialWeb (branch =
                         activeCaptain.spec, no longer hardcoded to
                         "resourcefulness"). To CHANGE the spec, the player uses
                         Reset, which respecs to null (refund points, charge 50
                         credits), clearing the spec so the TreeSelector reappears
                         and a new spec can be picked free. So "changing spec" costs
                         exactly one respec, never chooseCaptainSpec.
                       `owned`/`points` are THIS captain's own unlockedCaptainTalents
                       and statPoints (per-captain scoping preserved). onLearn routes
                       the tooltip's Learn button into the EXISTING doBuyCaptainTalent
                       wrapper (buyCaptainTalent for activeCaptain.id + pushLog +
                       save), so learning still works exactly as before. describeEffect
                       passes the captain effect describer through for the internal
                       tooltip. -->
                  {#if activeCaptain.spec === null}
                    <TreeSelector
                      cards={specCards}
                      commitLabel={"Choose this spec"}
                      onCommit={(key) => chooseSpec(key)}
                    />
                  {:else}
                    <!-- Reset (Task 13, Talent Tree Visual Redesign; Task 14 repurposed
                         it to CLEAR the spec), per-captain, scoped to activeCaptain,
                         wraps respecCaptainTalents(..., null) via
                         doRespecCaptainTalents/the confirmation modal near DELETE
                         SAVE further down this file. Only shown once a spec is
                         chosen (there's nothing to reset before that). Disabled
                         up-front below the credit cost, same
                         affordability-visible-before-opening-the-modal reasoning as
                         the Homeworld Talents panel's own Reset button above. -->
                    <div class="dev-row">
                      <button
                        class="dev-btn danger"
                        disabled={state.credits.lt(RESPEC_COST_CREDITS)}
                        on:click={openCaptainRespecModal}
                      >
                        Reset
                      </button>
                    </div>
                    <!-- spec is non-null in this else-branch (the spec-is-null case is handled by the
                         selector above); the non-null assertion satisfies svelte-check/tsc, which does
                         not narrow a member expression across the conditional. RadialWeb's branch prop
                         is a string, so a nullable spec would otherwise be rejected. NOTE: keep Svelte
                         block tokens (hash-if / colon-else / slash-if) OUT of this comment, they break
                         the parser even inside an HTML comment. -->
                    <RadialWeb
                      table={CAPTAIN_TALENTS}
                      branch={activeCaptain.spec!}
                      owned={activeCaptain.unlockedCaptainTalents}
                      points={activeCaptain.statPoints}
                      pointsLabel={"Stat Points"}
                      describeEffect={describeCaptainTalentEffect}
                      onLearn={(key) => doBuyCaptainTalent(key as CaptainTalentKey)}
                    />
                  {/if}
                </Panel>
              </div>
            </div>
          </div>
          {/if}

          <!-- Captain Rename MODAL (Combat 0.13.0, Phase 1, Task 1.6). Built on the
               SAME Panel.modal-dialog + .modal-input + .modal-row + focusTrap idiom
               as the DELETE SAVE modal near the bottom of this file (Escape and
               Cancel close, one shared modal visual language). Only rendered on the
               captain view, so activeCaptain is always defined here;
               captainRenameModalOpen gates it. The input is two-way bound to
               captainRenameInput (seeded with the current label by
               openCaptainRenameModal) and capped at MAX_CAPTAIN_NAME. Save routes
               through doRenameCaptain -> renameCaptain (the pure seam owns all
               validation); a failed Save shows the mapped reason in
               captainRenameError and keeps the modal open. Enter in the field
               submits (same as clicking Save). -->
          {#if captainRenameModalOpen}
          <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rename captain" use:focusTrap={cancelCaptainRename}>
            <Panel class="modal-dialog">
              <div class="panel-title">RENAME CAPTAIN</div>
              <p class="modal-instruction">Enter a new name for {activeCaptain.label}.</p>
              <!-- svelte-ignore a11y_autofocus, INTENTIONAL: the rename field is the sole focus target of a purpose-built modal the player just opened, so autofocusing it is the expected, keyboard-friendly behavior (mirrors the field-first intent of the DELETE SAVE confirm). -->
              <input
                class="modal-input"
                type="text"
                bind:value={captainRenameInput}
                maxlength={MAX_CAPTAIN_NAME}
                aria-label="New captain name"
                autofocus
                on:keydown={(e) => {
                  if (e.key === "Enter") doRenameCaptain();
                }}
              />
              {#if captainRenameError !== ""}
              <p class="modal-warning">{captainRenameError}</p>
              {/if}
              <div class="modal-row">
                <button class="dev-btn" on:click={cancelCaptainRename}>Cancel</button>
                <button class="dev-btn" on:click={doRenameCaptain}>Save</button>
              </div>
            </Panel>
          </div>
          {/if}
          {/if}
        {/if}
      </div>
      {/if}

      {#if activeTab === "fleetOperations"}
      <!-- Operations program (0.12.0 "Console" nav, CN5, the MISSION perspective):
           the shared <ConsoleTabs> primitive is the slim TOP rail, one tab per
           mission TYPE (same scrolling-glowing-tab idiom Home / Personnel /
           Logistics use). THREE tabs are live and selectable, Gathering (the
           existing resource-gathering dispatch), Combat Patrols (Combat 0.13.0,
           Phase 9b.5d, the first combat mission type: dispatch a warship + captain
           to sweep a pirate faction), and Mission Control (the mission-unlock
           track), tracked by activeOperationsTab (default Gathering). Exploration
           and Battlespace (PvE) / (PvP) stay LOCKED reserved "coming soon" tabs
           with no page (those missions and the combat-era Battlespace do not exist
           yet); ConsoleTabs grays them and blocks selection, the same honest locked
           affordance the System / Battlespace slots use. This replaces the old
           Dispatch / Mission Control <SubTabs> axis AND the mission-CATEGORY rail
           below it, both collapsed into this single top rail per the console FLATTEN
           principle. -->
      <ConsoleTabs
        tabs={[
          { key: "gathering", label: "Gathering" },
          { key: "combat", label: "Combat Patrols" },
          { key: "exploration", label: "Exploration", locked: true },
          { key: "missionControl", label: "Mission Control" },
          { key: "battlespacePve", label: "Battlespace (PvE)", locked: true },
          { key: "battlespacePvp", label: "Battlespace (PvP)", locked: true },
        ]}
        active={activeOperationsTab}
        onSelect={(key) => (activeOperationsTab = key as OperationsTab)}
      />

      {#if activeOperationsTab === "gathering"}
      <div class="tab-scroll-area">
      <!-- Fleet Operations Mission UI (2026-07-07 --
           docs/plans/2026-07-07-fleet-operations-mission-ui-plan.md, Task 4),
           the resource-gathering dispatch. Originally a category-list + tier-tabs
           + mission-card flow; in the 0.12.0 "Console" nav (CN5) the mission-
           CATEGORY rail was retired (mission types are the Operations ConsoleTabs
           top rail now), so resource-gathering, the rail's only live category, is
           promoted directly under this Gathering tab. The tier selector + mission
           cards below are UNCHANGED. Only Tier I is real (both shortOreRun and
           longOreRun, see model.ts's MissionDef.tier field); Tiers II-V are
           locked SubTabs entries. Dispatch does not happen inline here --
           clicking an available mission card calls openMissionPopup, which
           sets missionPopupKey/missionPopupCaptainId (declared near
           deleteModalOpen). The popup markup that consumes that state and
           performs the dispatch through the existing
           doDispatchCaptainOnMission lives near the DELETE SAVE modal,
           further down this same template. -->
            <SubTabs
              tabs={[
                { key: "tierI", label: "Tier I" },
                { key: "tierII", label: "Tier II", locked: true },
                { key: "tierIII", label: "Tier III", locked: true },
                { key: "tierIV", label: "Tier IV", locked: true },
                { key: "tierV", label: "Tier V", locked: true },
              ]}
              active={activeMissionTier}
              onSelect={(key) => (activeMissionTier = key as MissionTierKey)}
            />

            {#if activeMissionTier === "tierI"}
              <!-- tierIMissions/embarked mirror the OLD block's per-mission
                   embarked filter above, just scoped to Tier I's mission set
                   instead of iterating ALL of MISSIONS, the embarked-
                   captains display below (progress bar, phase label,
                   cargo-so-far, Recall button) is otherwise byte-identical to
                   what this replaced, only its position in the markup moved. -->
              {@const tierIMissions = (Object.entries(MISSIONS) as [MissionKey, typeof MISSIONS[MissionKey]][]).filter(([, def]) => def.tier === "I")}
              <!-- Combat 0.13.0 (9b.5a): extractionMissionOf narrows the mission union to
                   the extraction arm; this IN PROGRESS list is extraction-only, so a
                   patrolling captain is excluded from `embarked` (its mission is not an
                   extraction run). The `!` inside the each is safe because the filter
                   guaranteed an extraction mission for every listed captain. -->
              {@const embarked = state.captains.filter((c) => { const em = extractionMissionOf(c); return em !== null && tierIMissions.some(([key]) => key === em.missionKey); })}

              {#if embarked.length > 0}
                <div class="panel-title">IN PROGRESS</div>
                {#each embarked as captain}
                  {@const mission = extractionMissionOf(captain)!}
                  {@const missionDef = MISSIONS[mission.missionKey]}
                  {@const requiredTicks = requiredTicksForPhase(mission.phase, missionDef)}
                  {@const progress = Math.min(1, mission.phaseProgressTicks / requiredTicks)}
                  {@const remainingTicks = Math.max(0, Math.ceil(requiredTicks - mission.phaseProgressTicks))}
                  <div class="mission-card">
                    <div class="research-name">{captain.label}, {missionDef.label}</div>
                    <div class="research-cost">Phase: {MISSION_PHASE_LABEL[mission.phase]}</div>
                    <div class="research-bar-track">
                      <div class="research-bar-fill" style="width:{progress * 100}%"></div>
                    </div>
                    <div class="research-readout">{remainingReadout(remainingTicks, Math.ceil(requiredTicks), showTickCounts, state.tickDurationSeconds)} in phase</div>
                    <div class="research-cost">
                      Cargo so far: {formatNumber(mission.cargo.commonOre)} ore, {formatNumber(mission.cargo.uncommonMaterial)} uncommon,
                      {formatNumber(mission.cargo.rareMaterial)} rare
                    </div>
                    {#if mission.recalled}
                      <p class="prestige-text mission-recalled-text">Recall ordered, returning to base once the current cycle's unloading completes.</p>
                    {:else}
                      <button class="recall-btn" on:click={() => doRecallCaptain(captain.id)}>Recall Captain</button>
                    {/if}
                  </div>
                {/each}
              {/if}

              <div class="panel-title">AVAILABLE MISSIONS</div>
              <div class="mission-list">
                {#each tierIMissions as [missionKey, missionDef]}
                  <!-- Mission Rework (Task 8 UI): each mission card now shows its
                       dispatch REQUIREMENTS (captain level / cargo, where the mission
                       declares them) + its round-trip FUEL cost, and LOCKED missions
                       (unlockLevel above the Mission Control level) render dimmed with
                       an unlock hint instead of an openable button, matching the
                       game's consistent "show locked content" idiom (locked captain
                       slots, locked facilities, Battlespace). The player sees what's
                       coming AND what it will require. missionUnlocked is the SAME gate
                       canDispatch uses, so this can't disagree with the dispatch path.
                       Fuel cost uses the representative captain's hull (same idiom as
                       the exp/tick line); the popup shows the selected captain's exact
                       cost. -->
                  {@const unlocked = missionUnlocked(state, missionKey)}
                  {@const fuelCost = representativeShip
                    ? fuelNeeded(missionDef, SHIP_TYPES[representativeShip.typeKey])
                    : null}
                  <!-- This mission's ACTUAL loot triad (Task 1 rewired each mission's
                       lootTable, so a hardcoded ore label would misreport Salvage/
                       Forage/Lunar Mine). Read the real common/uncommon/rare item keys
                       here and label them via ITEMS, Local Asteroid still shows
                       Titanium/Polysilicate/Iridium, but the others show their own
                       triads. Same `?.label ?? key` fallback the rest of the file uses. -->
                  {@const loot = missionDef.lootTable}
                  {#if unlocked}
                    {@const expanded = expandedMissionKey === missionKey}
                    <!-- Available mission card. 0.12.0 "Console" nav (CN5b): now a
                         DIV, not a <button>, so it can host real child buttons (the
                         "View Info"/"Summary" toggle + "Assign") without nesting a
                         button in a button. Dispatch is an explicit "Assign" .dev-btn
                         calling openMissionPopup (the SAME dispatch flow, unchanged),
                         no longer a whole-card click. "View Info" swaps the compact
                         two-column summary for a rich in-place detail block (same
                         card, content swapped, not a modal), tracked by
                         expandedMissionKey (one card expanded at a time). -->
                    <div class="mission-card mission-card-selectable" class:expanded>
                      <!-- Card redesign (2026-07-15): HEADER = portrait placeholder +
                           name, with the captain-XP/tick readout tucked under the name so
                           the dispatch value survives the body's restructure into
                           Requirements / Rewards columns below. No mission-art asset
                           exists yet, so the portrait stays a dashed placeholder (🚀). -->
                      <div class="mission-card-header">
                        <div class="mission-portrait-frame" aria-hidden="true">🚀</div>
                        <div class="mission-card-heading">
                          <div class="research-name">{missionDef.label}</div>
                          <!-- Mission Rework (Task 2): each mission's captain-XP rate, via the
                               shared xpPerTick helper (NOT raw BASE_XP_PER_TICK) so this readout
                               tracks the exact rate the tick engine accrues. Passed the fleet's
                               representative captain (state.captains[0], always seeded) since the
                               rate is captain-independent today; when the XP-mult seam activates
                               this card should switch to the popup's selected captain.
                               Value/formula UNCHANGED by the redesign, only its position moved
                               from a body text row to this header sub-line. -->
                          <div class="mission-xp-line">{xpPerTick(missionKey, state.captains[0])}/tick XP</div>
                        </div>
                      </div>
                      {#if expanded}
                        <!-- RICH DETAIL (CN5b in-place swap), ONLY MissionDef data.
                             MissionDef has NO flavor/description field, so no flavor
                             line is shown (reported to the coordinator as unavailable).
                             Drop chances are the mission's BASE per-tick odds via
                             missionDropTiers, the SAME helper the summary drop icons
                             use, so the two cannot disagree; common is the guaranteed
                             per-tick floor (1 - uncommon - rare). -->
                        <div class="mission-detail">
                          <div class="mission-detail-section">
                            <div class="mission-col-label">Drop Table</div>
                            {#each missionDropTiers(loot, missionDef.uncommonChance, missionDef.rareChance) as drop (drop.key)}
                              {@const dItem = ITEMS[drop.key]}
                              {#if dItem}
                                <div class="mission-req-line">
                                  <span style="color: {warehouseRarityColor(dItem.rarity)}">{dItem.label}</span> ({dItem.rarity}): {drop.chancePct.toFixed(1)}% per tick
                                </div>
                              {/if}
                            {/each}
                          </div>
                          <div class="mission-detail-section">
                            <div class="mission-col-label">Requirements</div>
                            <div class="mission-req-line">Captain Level: {missionDef.requiresCaptainLevel ?? 1}</div>
                            <div class="mission-req-line">Cargo Capacity: {missionDef.requiresCargoCapacity !== undefined ? formatNumber(missionDef.requiresCargoCapacity) : "None"}</div>
                            <div class="mission-req-line">Fuel / dispatch: {fuelCost !== null ? formatNumber(fuelCost) : "None"}</div>
                          </div>
                          <div class="mission-detail-section">
                            <div class="mission-col-label">Rewards</div>
                            <div class="mission-req-line">Credits / cycle: {formatNumber(missionDef.creditsPerCycle)}</div>
                            <div class="mission-req-line">Captain XP / tick: {xpPerTick(missionKey, state.captains[0])}</div>
                            <div class="mission-req-line">Fleet Admiral XP / tick: {missionDef.fleetAdminXpPerTick}</div>
                          </div>
                        </div>
                      {:else}
                      <!-- BODY = two columns. LEFT lists this mission's dispatch GATE
                           requirements; RIGHT is the rarity-colored Rewards drops row. -->
                      <div class="mission-card-columns">
                        <div class="mission-card-col">
                          <div class="mission-col-label">Mission Requirements:</div>
                          <!-- Level gate (Task 7 requiresCaptainLevel), defaults to 1,
                               the baseline captain level, when the mission declares none. -->
                          <div class="mission-req-line">Level: {missionDef.requiresCaptainLevel ?? 1}</div>
                          <!-- Cargo gate (Task 7 requiresCargoCapacity), "--" = the mission
                               has no cargo-capacity requirement (ore runs omit it). -->
                          <div class="mission-req-line">Cargo Capacity: {missionDef.requiresCargoCapacity !== undefined ? formatNumber(missionDef.requiresCargoCapacity) : "--"}</div>
                          <!-- Round-trip FUEL cost (Task 8), 0 for the free local run;
                               "--" only if the representative captain somehow has no hull
                               (never in production). Same figure/formula as before, just
                               relabeled "Fuel Capacity" and moved into this column. -->
                          <div class="mission-req-line">Fuel Capacity: {fuelCost !== null ? formatNumber(fuelCost) : "--"}</div>
                        </div>
                        <div class="mission-card-col">
                          <div class="mission-col-label">Rewards</div>
                          <!-- Drops icon row (2026-07-15), REPLACES the old three per-tier
                               text lines. One rarity-colored icon per tier that actually
                               drops (missionDropTiers filters out uncommon/rare when their
                               chance is 0, so Local Deuterium Skim shows a single icon).
                               Hover/tap an icon for its Warehouse-style tooltip (name /
                               held / cap / this mission's drop chance / flavor). These icons
                               are SPANS, not buttons (CN5b kept them spans even though the
                               card became a div): the compact summary stays icons-only, and
                               the same drops are reachable as focusable buttons in the
                               dispatch popup, so no keyboard interaction is lost. Chances
                               passed are the mission's BASE chances (this card is captain-
                               agnostic; the popup applies the selected captain's modifiers). -->
                          <div class="drops-row">
                            {#each missionDropTiers(loot, missionDef.uncommonChance, missionDef.rareChance) as drop (drop.key)}
                              {@const dropItem = ITEMS[drop.key]}
                              {#if dropItem}
                                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions, INTENTIONAL: this icon is a span (not a focusable button) carrying a tap-to-pin tooltip; stopPropagation is a harmless leftover from when the card was a button. Keyboard/AT users get the SAME drops as real, focusable buttons in the dispatch popup, so no interaction is lost. -->
                                <span
                                  class="drop-icon"
                                  role="img"
                                  style="--drop-rc: {warehouseRarityColor(dropItem.rarity)};"
                                  aria-label="{dropItem.label}, {drop.chancePct.toFixed(1)}% drop chance"
                                  on:pointerenter={(e) => hoverEnterWarehouseTooltip(e, drop.key, drop.chancePct)}
                                  on:pointerleave={(e) => hoverLeaveWarehouseTooltip(e, drop.key)}
                                  on:click|stopPropagation={(e) => toggleWarehouseTooltip(e, drop.key, drop.chancePct)}
                                >{warehouseCategoryGlyph(dropItem.category)}</span>
                              {/if}
                            {/each}
                          </div>
                        </div>
                      </div>
                      {/if}

                      <!-- Action row (CN5b): "View Info" / "Summary" toggles the
                           in-place detail swap; "Assign" opens the captain-selection
                           dispatch popup (openMissionPopup, the unchanged dispatch
                           flow). Both are .dev-btn and stay available whether the card
                           shows its summary or its detail. -->
                      <div class="mission-card-actions">
                        <button class="dev-btn" on:click={() => (expandedMissionKey = expanded ? null : missionKey)}>{expanded ? "Summary" : "View Info"}</button>
                        <button class="dev-btn" on:click={() => openMissionPopup(missionKey)}>Assign</button>
                      </div>
                    </div>
                  {:else}
                    <!-- LOCKED mission, non-openable, dimmed, with the unlock hint +
                         a requirements preview so the player can plan toward it. -->
                    <div class="mission-card mission-card-locked" title="Unlock via Mission Control (Operations)">
                      <div class="mission-portrait-frame" aria-hidden="true">🔒</div>
                      <div class="mission-card-body">
                        <div class="research-name">🔒 {missionDef.label}</div>
                        <div class="research-cost">Locked, unlock via Mission Control (Operations tab)</div>
                        {#if missionDef.requiresCaptainLevel !== undefined}
                          <div class="research-cost">Will require captain level {missionDef.requiresCaptainLevel}</div>
                        {/if}
                        {#if missionDef.requiresCargoCapacity !== undefined}
                          <div class="research-cost">Will require cargo capacity {missionDef.requiresCargoCapacity}</div>
                        {/if}
                        <div class="research-cost">Fuel / trip: {fuelCost !== null ? formatNumber(fuelCost) : "--"}</div>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
      </div>
      {/if}

      {#if activeOperationsTab === "combat"}
      <!-- Combat Patrols (Combat 0.13.0, Phase 9b.5d, the first combat mission type).
           Built to the owner-approved mockup (patrol-dispatch-mockup.html): a single
           surface with an IN PROGRESS list of patrolling captains (live carry-state
           readout) above an AVAILABLE PATROLS list of per-patrol dispatch cards. It
           reuses the SAME idioms the Gathering dispatch surface uses (.mission-card box,
           .research-* text/bars, .dev-btn/.recall-btn actions, the captain-picker MODAL,
           and the disabled-button + reason-text block idiom), so it introduces no new
           visual language. Two mockup elements are DELIBERATELY OMITTED here: the Threat
           Assessment band (a separate later unit owns the win-% / tier work) and any
           wiring on the View Combat Log button (that opens the Phase-12 combat view,
           which does not exist yet, so it renders disabled / "coming soon"). Ship
           assignment is NOT done here: you pick the CAPTAIN and their assigned hull comes
           with them read-only (reassign at the Drydock), matching the no-ship-picker
           decision baked into the mockup. -->
      <!-- IN PROGRESS source (declared as an immediate child of this {#if}, the only
           placement Svelte allows {@const}): every captain currently flying a patrol.
           Pre-filtered only to gate the heading; each row re-narrows the mission union
           to its patrol arm inline (there is no patrolMissionOf helper, and the
           `kind === "patrol"` discriminant narrows cleanly), mirroring how the Gathering
           IN PROGRESS list narrows its extraction arm. -->
      {@const patrolling = state.captains.filter((c) => c.mission !== null && c.mission.kind === "patrol")}
      <div class="tab-scroll-area">

            {#if patrolling.length > 0}
              <div class="panel-title">IN PROGRESS</div>
              {#each patrolling as captain (captain.id)}
                <!-- Inline narrow to the patrol arm (guaranteed non-null by the filter
                     above, but TS/svelte-check won't carry that through the {#each}). -->
                {@const patrol = captain.mission !== null && captain.mission.kind === "patrol" ? captain.mission : null}
                {#if patrol !== null}
                  {@const patrolShip = state.ships.find((s) => s.assignedCaptainId === captain.id) ?? null}
                  {@const patrolShipDef = patrolShip ? SHIP_TYPES[patrolShip.typeKey] : null}
                  {@const faction = FACTIONS[patrol.factionId]}
                  {@const totalWaves = patrol.waveTicks.length}
                  {@const wavesResolved = patrol.wavesWon + patrol.wavesLost}
                  {@const defeated = patrol.phase === "limpingHome"}
                  <!-- Hull/shield carry-state as fractions of the ship's MAX (the same
                       pools bridge.ts seeds a wave's combatant from). Clamped 0..1 and
                       guarded against a 0 max (never in shipped content, but keeps the
                       bar honest if a hull ever had a 0 pool). -->
                  {@const hullMax = patrolShipDef ? patrolShipDef.hullIntegrity : 0}
                  {@const shieldMax = patrolShipDef ? patrolShipDef.shieldCapacity : 0}
                  {@const hullRatio = hullMax > 0 ? Math.max(0, Math.min(1, patrol.playerHull / hullMax)) : 0}
                  {@const shieldRatio = shieldMax > 0 ? Math.max(0, Math.min(1, patrol.playerShield / shieldMax)) : 0}
                  <div class="mission-card">
                    <div class="research-name">
                      {captain.label}
                      {#if patrolShipDef}, {patrolShipDef.label}{/if}
                      {#if faction} vs {faction.name}{/if}
                    </div>
                    <!-- Phase line, patrol counterpart to the extraction card's "Phase:"
                         row. On defeat it reads in danger color to flag the loss state. -->
                    <div class="research-cost" style={defeated ? "color: var(--color-danger)" : undefined}>
                      Phase: {PATROL_PHASE_LABEL[patrol.phase]}
                      {#if defeated} (defeated, returning to repair){/if}
                    </div>
                    <div class="research-cost">
                      Waves: {wavesResolved} / {totalWaves} resolved
                      &middot; <span style="color: var(--color-success)">{patrol.wavesWon}W</span>
                      &middot; <span style="color: var(--color-danger)">{patrol.wavesLost}L</span>
                    </div>

                    <!-- Player carry-state bars (playerHull / playerShield over the hull's
                         max), reusing the existing research-bar-track/fill pair the whole
                         app uses for progress readouts (no bespoke bar styling). The hull
                         PERSISTS across waves; the shield REGENERATES between them. -->
                    <div class="mission-col-label">Hull, {formatNumber(Math.round(patrol.playerHull))} / {formatNumber(hullMax)}</div>
                    <div class="research-bar-track">
                      <div class="research-bar-fill" style="width:{hullRatio * 100}%"></div>
                    </div>
                    <div class="mission-col-label">Shield, {formatNumber(Math.round(patrol.playerShield))} / {formatNumber(shieldMax)}</div>
                    <div class="research-bar-track">
                      <div class="research-bar-fill" style="width:{shieldRatio * 100}%"></div>
                    </div>

                    <!-- Repeat-mode indicator: a patrol dispatched "repeatedly" relaunches
                         a fresh cycle on completion; recall ends it after the current run
                         (recallCaptain flags intent, honored at cycle end, so the recalled
                         text below matches the extraction card's wording). -->
                    <div class="research-cost">
                      {#if patrol.repeatDispatch}Mode: Repeating (relaunches after each run){:else}Mode: Single run{/if}
                    </div>

                    <div class="patrol-card-actions">
                      <!-- View Combat Log (Combat 0.13.0, Phase 12b Unit C): opens the
                           DISPLAY-ONLY CombatView modal for this captain's patrol. Shown
                           only when the assigned hull is a combat hull (a patrol always
                           flies one, but the guard keeps the button honest if a non-combat
                           hull ever appears here). The view reads a pure replay and never
                           mutates game state. -->
                      {#if patrolShip !== null && combatHullTypeOf(patrolShip.typeKey) !== null}
                        <button class="dev-btn" on:click={() => openCombatView(captain.id)}>View Combat Log</button>
                      {/if}
                      {#if patrol.recalled}
                        <p class="prestige-text mission-recalled-text">Recall ordered, returning to base once the current run completes.</p>
                      {:else}
                        <button class="recall-btn" on:click={() => doRecallCaptain(captain.id)}>Recall Captain</button>
                      {/if}
                    </div>
                  </div>
                {/if}
              {/each}
            {/if}

            <div class="panel-title">AVAILABLE PATROLS</div>
            <div class="mission-list">
              <!-- One dispatch card per PATROLS entry (one starter patrol today; the loop
                   grows automatically as patrols are authored). The cast mirrors the
                   Gathering tab's Object.entries(MISSIONS) idiom so the loop vars are
                   typed (PatrolKey + PatrolDef) rather than string/any. -->
              {#each (Object.entries(PATROLS) as [PatrolKey, typeof PATROLS[PatrolKey]][]) as [patrolKey, def]}
                {@const faction = FACTIONS[def.factionId]}
                {@const hostiles = [...new Set(def.hullPool)].map((id) => PIRATE_HULLS[id].name).join(", ")}
                {@const wavesLabel = def.minWaves === def.maxWaves ? `${def.minWaves}` : `${def.minWaves} - ${def.maxWaves}`}
                <!-- Read the reactive records DIRECTLY here (not via the patrolSelectedCaptainId/
                     patrolStanceFor/patrolRepeatFor helpers): a helper call hides the
                     patrolCaptainByKey/StanceByKey/RepeatByKey read inside a function body, so
                     Svelte's static dependency analysis of this {@const} never sees it and never
                     recomputes when the record changes, leaving the selector stuck (the "captain
                     never selects" bug). Referencing the record inline makes it a tracked dep.
                     The helpers remain for the SCRIPT dispatch path (doDispatchCaptainOnPatrol). -->
                {@const selectedCaptainId = patrolCaptainByKey[patrolKey] ?? null}
                {@const selectedCaptain = selectedCaptainId !== null ? state.captains.find((c) => c.id === selectedCaptainId) ?? null : null}
                {@const selectedShip = selectedCaptain !== null ? state.ships.find((s) => s.assignedCaptainId === selectedCaptain.id) ?? null : null}
                {@const selectedShipDef = selectedShip ? SHIP_TYPES[selectedShip.typeKey] : null}
                {@const isCombatHull = selectedShip ? combatHullTypeOf(selectedShip.typeKey) !== null : false}
                <!-- Combat-defense BLOCKER fix (2026-08-27): the ship's FOLDED hull/shield readout, from
                     the SAME installed-gear fold the sim actually fights with (foldedPlayerDefense off
                     equippedFor), so the card shows the real pools a crafted-plated hull / crafted emitter
                     brings to the patrol, not the raw authored SHIP_TYPES stats. Byte-identical for a
                     Standard-Issue set. null when no ship / hull is assigned. -->
                {@const selectedShipDefense = selectedShip !== null && selectedShipDef !== null ? foldedPlayerDefense(selectedShipDef, equippedFor(state, selectedShip.id)) : null}
                <!-- The dispatch GATE for the selected captain, canDispatchPatrol (the ONE
                     source of truth dispatchCaptainOnPatrol also consults). null until a
                     captain is picked; the Dispatch button + reason text below read it, so
                     the card can never disagree with what the backend would allow. -->
                {@const gate = selectedCaptainId !== null ? canDispatchPatrol(state, selectedCaptainId, patrolKey) : null}
                {@const fuelCost = selectedShip ? patrolFuelCost(patrolKey, selectedShip) : null}
                {@const stance = patrolStanceByKey[patrolKey] ?? "balanced"}
                {@const repeat = patrolRepeatByKey[patrolKey] ?? false}
                <!-- Combat 1.0 (Unit 2.4): the combat hull class (null for a non-combat
                     hull / no ship) and the ADVISORY forecast readout. `state` is passed
                     to patrolForecastFor so this {@const} statically depends on it and
                     re-runs on a loadout change (a gear install reassigns state); the
                     helper MEMOIZES so that per-flush re-run is cheap (see its header).
                     forecast is null unless a combat hull is assigned. -->
                {@const hullType = selectedShip ? combatHullTypeOf(selectedShip.typeKey) : null}
                {@const forecast = patrolForecastFor(state, patrolKey, def, selectedShip, hullType, stance)}
                <div class="mission-card">
                  <div class="research-name">{def.label}</div>
                  {#if faction}
                    <div class="research-cost" style="font-style: italic">{faction.flavor}</div>
                  {/if}

                  <!-- Static patrol facts (all from the PatrolDef): the wave-count band,
                       the hostile hull pool summary, and the round-trip route length. -->
                  <div class="mission-card-columns">
                    <div class="mission-card-col">
                      <div class="mission-col-label">Combat Waves</div>
                      <div class="mission-req-line">{wavesLabel}</div>
                    </div>
                    <div class="mission-card-col">
                      <div class="mission-col-label">Hostiles</div>
                      <div class="mission-req-line">{hostiles}</div>
                    </div>
                    <div class="mission-card-col">
                      <div class="mission-col-label">Route</div>
                      <!-- FULL route length = transit out + the wave-eligible window +
                           transit back (the engine's routeLength, tick.ts), NOT just the
                           two transit legs: the ship is out for the whole window while
                           waves roll, so the transit-only figure understated the real
                           duration by more than half. Fixed at 14 for the starter patrol. -->
                      <div class="mission-req-line">{def.transitOutTicks + def.rollWindowTicks + def.transitBackTicks} ticks</div>
                    </div>
                  </div>

                  <!-- CAPTAIN selector. Reuses the captain-picker MODAL (openPatrolPicker
                       sets patrolPickerKey; the modal near the mission popup lists idle
                       captains and calls selectPatrolCaptain). The button shows the chosen
                       captain, or a prompt when none is picked, exactly like the mission
                       popup's first step, just surfaced on the card instead of inside it. -->
                  <div class="mission-col-label">Captain</div>
                  <button class="dev-btn" on:click={() => openPatrolPicker(patrolKey)}>
                    {#if selectedCaptain !== null}{selectedCaptain.label} (Level {selectedCaptain.level}){:else}Select a captain{/if}
                  </button>

                  <!-- Assigned ship, READ-ONLY. You pick the captain; their assigned hull
                       comes with them (reassign at the Drydock). Shows the hull's combat
                       stats. Every hull is combat-capable now (an economy hull carries a
                       weak Standard-Issue set), so this reads "Dispatchable" plainly rather
                       than labelling a freighter a "Combat hull"; a true combat hull is
                       still far stronger, but the dispatch gate below is what actually
                       blocks (missing gear / fuel / repair), not the hull class. -->
                  {#if selectedCaptain !== null}
                    <div class="mission-col-label" style="margin-top: 8px">Ship (from the captain)</div>
                    {#if selectedShipDef !== null}
                      <div class="mission-req-line">
                        {selectedShipDef.label}: hull {formatNumber(selectedShipDefense ? selectedShipDefense.hullMax : selectedShipDef.hullIntegrity)}
                        &middot; shield {formatNumber(selectedShipDefense ? selectedShipDefense.shieldMax : selectedShipDef.shieldCapacity)}
                        &middot; {selectedShipDef.weaponHardpoints} guns
                      </div>
                      <div class="mission-req-line" style="color: {isCombatHull ? 'var(--color-success)' : 'var(--color-danger)'}">
                        {#if isCombatHull}Dispatchable{:else}Unknown hull class{/if}
                      </div>
                    {:else}
                      <div class="mission-req-line" style="color: var(--color-danger)">No ship assigned</div>
                    {/if}
                  {/if}

                  <!-- ADVISORY readouts (Combat 1.0, Unit 2.4): the ship's Battle Rating
                       (a "how geared am I" scalar) and the Threat Assessment band for THIS
                       patrol (a seeded forecast vs the patrol's enemies, shown as a named
                       colored chip, never a raw win %). Both advisory: the note + the always-
                       enabled Dispatch button below make clear you can dispatch regardless.
                       Only shown for a combat hull (forecast is null otherwise). -->
                  {#if forecast !== null}
                    <div class="patrol-readouts">
                      <div class="patrol-readout-row">
                        <span class="mission-col-label" style="margin: 0">Battle Rating</span>
                        <span class="battle-rating-value">{formatNumber(forecast.rating)}</span>
                      </div>
                      <div class="patrol-readout-row">
                        <span class="mission-col-label" style="margin: 0">Threat Assessment</span>
                        <span class="threat-chip-wrap">
                          <!-- A real <button> (natively focusable, no tabindex) so the
                               tooltip opens on hover AND on tap/focus without the a11y
                               noninteractive-tabindex warning. type="button" => never
                               submits; it takes no click action, it only discloses the
                               tooltip. aria-label folds the whole advisory for readers. -->
                          <button
                            type="button"
                            class="threat-chip"
                            style="--threat-color: {forecast.assessment.colorHex}"
                            aria-label={`Threat Assessment: ${forecast.assessment.name}. ${forecast.assessment.fuzzyRange}. ${forecast.assessment.voice}`}
                          >
                            <span class="threat-chip-icon" aria-hidden="true">{forecast.assessment.icon}</span>
                            <span class="threat-chip-name">{forecast.assessment.name}</span>
                          </button>
                          <span class="threat-tooltip" role="tooltip">
                            <span class="threat-tooltip-range">{forecast.assessment.fuzzyRange}</span>
                            <span class="threat-tooltip-voice">{forecast.assessment.voice}</span>
                          </span>
                        </span>
                      </div>
                      <div class="patrol-readout-note">Advisory only. You can dispatch regardless.</div>
                    </div>
                  {/if}

                  <!-- STANCE selector (segmented, default Balanced). Three .dev-btn options
                       with aria-pressed marking the active one (the same accent-border
                       selection signal .mission-card-selectable.expanded / .theme-swatch.active
                       use), fed to dispatchCaptainOnPatrol at dispatch time. -->
                  <div class="mission-col-label" style="margin-top: 8px">Stance</div>
                  <div class="patrol-segmented" role="group" aria-label="Combat stance">
                    <button class="dev-btn" aria-pressed={stance === "aggressive"} on:click={() => setPatrolStance(patrolKey, "aggressive")}>Aggressive</button>
                    <button class="dev-btn" aria-pressed={stance === "balanced"} on:click={() => setPatrolStance(patrolKey, "balanced")}>Balanced</button>
                    <button class="dev-btn" aria-pressed={stance === "standoff"} on:click={() => setPatrolStance(patrolKey, "standoff")}>Standoff</button>
                  </div>

                  <!-- DISPATCH MODE (segmented): once vs auto-relaunch. -->
                  <div class="mission-col-label" style="margin-top: 8px">Dispatch mode</div>
                  <div class="patrol-segmented" role="group" aria-label="Dispatch mode">
                    <button class="dev-btn" aria-pressed={!repeat} on:click={() => setPatrolRepeat(patrolKey, false)}>Dispatch Once</button>
                    <button class="dev-btn" aria-pressed={repeat} on:click={() => setPatrolRepeat(patrolKey, true)}>Dispatch Repeatedly</button>
                  </div>

                  <!-- Fuel per run: the authoritative round-trip cost for the selected
                       captain's hull (the same figure dispatch spends), plus the shared
                       tank level. The cost needs a hull, so it is priced only once a
                       captain is chosen; before that only the tank level is shown. -->
                  <div class="research-cost" style="margin-top: 10px">
                    {#if fuelCost !== null}
                      Fuel per run: {formatNumber(Math.ceil(fuelCost))} &middot; In tank: {formatNumber(state.fuel)}
                    {:else}
                      In tank: {formatNumber(state.fuel)} (select a captain to price the run)
                    {/if}
                  </div>

                  <!-- Block reason (danger color), the same disabled-button + reason-text
                       idiom the mission popup uses. Shows the specific canDispatchPatrol
                       reason (notCombatHull / needsRepair / fuel gates / busy / no captain). -->
                  {#if gate !== null && !gate.ok}
                    <div class="research-cost" style="color: var(--color-danger)">⚠ {patrolDispatchBlockMessage(gate.reason)}</div>
                  {/if}

                  <!-- Weapon ADVISORY (Combat-defense rework, Unit 3, design S5 "inform, don't
                       forbid"): a PERSISTENT, non-blocking note (not a confirm dialog, user call)
                       shown when the dispatchable ship carries NO weapon. canDispatchPatrol flags
                       gate.noWeaponAdvisory on its ok result; dispatch stays ENABLED (the button
                       reads gate.ok, which is true here). Warning color, distinct from the danger
                       block-reason above: this is a bad-but-allowed choice, not a refusal. -->
                  {#if gate !== null && gate.ok && gate.noWeaponAdvisory}
                    <div class="research-cost" style="color: var(--color-warning)">⚠ No weapon installed. You won't be able to return fire.</div>
                  {/if}

                  <button
                    class="buy-btn patrol-dispatch-btn"
                    disabled={gate === null || !gate.ok}
                    title={gate !== null && !gate.ok ? patrolDispatchBlockMessage(gate.reason) : undefined}
                    on:click={() => doDispatchCaptainOnPatrol(patrolKey)}
                  >
                    Dispatch Patrol
                  </button>
                </div>
              {/each}
            </div>
      </div>
      {/if}

      <!-- Battlespace (PvE) / Battlespace (PvP): the combat-era fleet-operations
           system. In the 0.12.0 "Console" nav (CN5) these are reserved LOCKED
           ConsoleTabs in the Operations top rail above (no page); they absorb the
           former standalone Battlespace stub panel (its 4 named modes, Fleet
           Skirmishes / Campaign / Fleet Exercises / Invasion, were placeholder
           internal structure and are deferred to the combat build, 0.13.0, per the
           design doc). Nothing renders here until that content exists. -->

      {#if activeOperationsTab === "missionControl"}
      <!-- Mission Control (mission-unlock facility). Moved VERBATIM here from the
           Facilities tab (0.11.2 nav restructure, Task 5); in the 0.12.0 "Console"
           nav (CN5) it is its own tab in the Operations ConsoleTabs top rail. Its
           inner Overview / Upgrades <SubTabs> and both Panel bodies are unchanged;
           the pane's outer guard is activeOperationsTab === "missionControl", and
           it sits in its own .tab-scroll-area (every tab/sub-view wraps its panel
           content in exactly one). -->
      <div class="tab-scroll-area">
            <!-- MISSION CONTROL (Mission Rework Task 8), the mission-unlock
                 facility. Two sub-tabs mirroring the Refinery: Overview (unlocked /
                 locked missions + completion progress toward the next unlock) and
                 Upgrades (the next rung's material + completion-count readiness +
                 Build). All readiness/actions read the SAME tick.ts backend fns
                 (missionUnlocked / canBuildFacilityUpgrade / startFacilityUpgrade) +
                 FACILITIES data, so the UI can't drift from what the backend enforces.
                 The Upgrades tab adds the completion-count requirement rows that are
                 unique to this facility (the "earn it by playing" gate, Task 6). -->
            <SubTabs
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "upgrades", label: "Upgrades" },
              ]}
              active={activeMissionControlSubTab}
              onSelect={(key) => (activeMissionControlSubTab = key as MissionControlSubTab)}
            />

            {#if activeMissionControlSubTab === "overview"}
              <!-- USER REVISION 2026-07-14: all four current missions are default
                   (unlockLevel 1), so this Overview is a MISSION LOG of the available
                   missions + each one's lifetime completion count, NOT a "next
                   unlock" progress panel (that unlock upgrade is deferred until future
                   missions exist; see model.ts FACILITIES.missionControl). The locked-
                   mission list below is retained (guarded on lockedMissionKeys.length,
                   empty today) so it lights up automatically when a future mission
                   ships at a higher unlockLevel. -->
              <Panel>
                <div class="panel-title">MISSION CONTROL</div>
                <div class="research-cost">Level: {missionControlLevel}</div>

                <div class="research-name" style="margin-top: 10px;">Available missions</div>
                {#each unlockedMissionKeys as mKey (mKey)}
                  {@const completed = state.lifetimeStats.missionsCompleted[mKey] ?? new Decimal(0)}
                  <div class="research-cost" style="color: var(--color-success)">
                    ✅ {MISSIONS[mKey].label}, {formatNumber(completed)} completed
                  </div>
                {/each}

                {#if lockedMissionKeys.length > 0}
                  <div class="research-name" style="margin-top: 10px;">Locked missions</div>
                  {#each lockedMissionKeys as mKey (mKey)}
                    <div class="research-cost" style="color: var(--color-text-secondary)">🔒 {MISSIONS[mKey].label}, unlocks at level {MISSIONS[mKey].unlockLevel}</div>
                  {/each}
                {/if}

                <p class="research-status" style="margin-top: 10px; color: var(--color-text-secondary);">
                  All current missions are available. Future missions will unlock here
                  as new content is added.
                </p>
              </Panel>
            {/if}

            {#if activeMissionControlSubTab === "upgrades"}
              <Panel>
                <div class="panel-title">MISSION CONTROL UPGRADES</div>
                <div class="research-cost">Level: {missionControlLevel}</div>

                {#if missionControlMaxed}
                  <!-- USER REVISION 2026-07-14: Mission Control caps at its current
                       content (the unlock UPGRADE is deferred until future missions
                       exist, see model.ts FACILITIES.missionControl). This is the
                       standard maxed state the Refinery/Warehouse tracks show; the note
                       flags that a future unlock rung re-appears here with new content. -->
                  <p class="research-status">Fully upgraded.</p>
                  <p class="research-status" style="margin-top: 6px; color: var(--color-text-secondary);">
                    Future missions will unlock here as new content is added.
                  </p>
                {:else}
                  <div class="research-name">Next: Level {missionControlLevel} → {missionControlLevel + 1}</div>
                  <div class="research-cost">
                    Unlocks the missions gated at level {missionControlLevel + 1} · Duration: {durationReadout(nextMissionControlUpgrade.durationTicks, showTickCounts, state.tickDurationSeconds)}
                  </div>

                  <!-- Material readiness ([Item]: have / need, ✅/❌), same idiom as
                       the Refinery/Warehouse upgrade tabs. -->
                  {#each Object.keys(nextMissionControlUpgrade.materials) as itemId}
                    {@const need = nextMissionControlUpgrade.materials[itemId]}
                    <!-- FREE (reservation-aware) have, consistent with the Build gate; see
                         the Refinery upgrade row for the full rationale. -->
                    {@const stock = itemTotal(state.inventory, itemId)}
                    {@const have = freeItemForState(state, itemId)}
                    {@const reserved = stock.minus(have)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}{#if reserved.gt(0)} ({formatNumber(reserved)} reserved){/if}
                    </div>
                  {/each}

                  <!-- Completion-count prereqs, THE mission-control-specific gate
                       (Task 6): each listed mission's lifetime completions must reach
                       its threshold before this rung is buildable. -->
                  {#if nextMissionControlUpgrade.requiresMissionCompletions}
                    {@const reqCompletions = nextMissionControlUpgrade.requiresMissionCompletions}
                    {#each Object.keys(reqCompletions) as mKey (mKey)}
                      {@const need = reqCompletions[mKey as MissionKey]!}
                      {@const have = state.lifetimeStats.missionsCompleted[mKey] ?? new Decimal(0)}
                      {@const met = have.gte(need)}
                      <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                        {met ? "✅" : "❌"} {MISSIONS[mKey as MissionKey].label} completions: {formatNumber(have)} / {need}
                      </div>
                    {/each}
                  {/if}

                  <!-- Build, gated on canBuildFacilityUpgrade (materials + the
                       completion gate + no in-flight upgrade); its .reason is the
                       "why not" shown in the shared tick-stable popover when disabled. -->
                  {@render facilityUpgradeButton(
                    "missionControl",
                    missionControlUpgradeCheck,
                    `Build · Level ${missionControlLevel} → ${missionControlLevel + 1}`,
                    () => doStartFacilityUpgrade("missionControl")
                  )}
                {/if}

                {#if missionControlUpgradeInFlight}
                  {@const progress = missionControlUpgradeInFlight.durationTicks > 0
                    ? (missionControlUpgradeInFlight.durationTicks - missionControlUpgradeInFlight.remainingTicks) / missionControlUpgradeInFlight.durationTicks
                    : 1}
                  <div class="research-name" style="margin-top: 10px;">Currently upgrading…</div>
                  <div class="research-bar-track">
                    <div class="research-bar-fill" style="width:{Math.min(100, progress * 100)}%"></div>
                  </div>
                  <div class="research-readout">{remainingReadout(missionControlUpgradeInFlight.remainingTicks, missionControlUpgradeInFlight.durationTicks, showTickCounts, state.tickDurationSeconds)}</div>
                {/if}
              </Panel>
            {/if}

      </div>
      {/if}
      {/if}

      {#if activeTab === "home"}
      <!-- Home (0.12.0 "Console" nav, CN1, PATTERN-SETTER, revised per user
           2026-07-21). No left rail. A horizontally-SCROLLING top-tab row
           (.console-tabs) sits at the top; the selected tab shows its page IN
           PLACE below and GLOWS to mark position. No Back control, you switch by
           tapping another tab. This scrolling-tabs + glow + page-below structure
           is the copyable template every perspective reuses (see the
           .console-tabs / .console-tab CSS). The Help and Statistics bodies are
           the 0.11.2 content moved VERBATIM, only the surrounding chrome changed. -->
      <!-- Scrolling top-tab row via the shared ConsoleTabs primitive (hidden
           scrollbar, glow on active, edge scroll slices). A NON-SCROLLING header
           ABOVE .tab-scroll-area (the Logistics/Operations header pattern), so the
           Help / Statistics bodies scroll and are CLIPPED below and never bleed up
           under the tabs. Live tabs flip activeHomeTab; reserved meta tabs are
           inert locked affordances. -->
      <ConsoleTabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "help", label: "Help" },
          { key: "statistics", label: "Statistics" },
          { key: "achievements", label: "Achievements", locked: true },
          { key: "completion", label: "Completion", locked: true },
          { key: "leaderboards", label: "Leaderboards", locked: true },
        ]}
        active={activeHomeTab}
        onSelect={(key) => (activeHomeTab = key as "overview" | "help" | "statistics")}
      />
      <div class="tab-scroll-area">

        {#if activeHomeTab === "overview"}
        <!-- Overview: the console landing, kept lean (the design warns against
             overloading an overview); at-a-glance readouts can be added later. -->
        <Panel>
          <div class="panel-title">COMMAND HOME</div>
          <p class="prestige-text">Welcome, Admiral. This is your command home, the whole game at a glance. Pick a tab above.</p>
        </Panel>
        {/if}

        {#if activeHomeTab === "help"}
        <!-- HELP page. The 0.11.2 Home Help content, its own nested topic rail
             (.fleet-captains-layout / .captain-list, part of Help's OWN content,
             not the removed perspective rail) driving HELP_TOPICS bodies as PLAIN
             text, selection tracked by activeHelpTopic. Moved VERBATIM; only the
             summoning chrome changed. -->
          <div class="fleet-captains-layout">
            <div class="captain-list">
              {#each HELP_TOPICS as topic}
                <button
                  class="captain-list-item"
                  class:active={activeHelpTopic === topic.id}
                  on:click={() => (activeHelpTopic = topic.id)}
                >
                  {topic.title}
                </button>
              {/each}
            </div>

            <div class="fleet-captains-content">
              {#each HELP_TOPICS as topic}
                {#if activeHelpTopic === topic.id}
                <Panel>
                  <div class="panel-title">{topic.title.toUpperCase()}</div>
                  <p class="prestige-text">{topic.body}</p>
                </Panel>
                {/if}
              {/each}
            </div>
          </div>
        {/if}

        {#if activeHomeTab === "statistics"}
        <!-- STATISTICS page. FLATTENED per user 2026-07-21: no inner sub-tabs
             (they would be a third tab layer under the console tabs and blur which
             level you are on). The three groups render as stacked, always-visible
             sections you scroll, compact enough to see together. Section headers
             (.panel-title) are visually distinct from the glowing console tabs, so
             the levels never blur. Rows come from deriveStatistics(state), a pure
             read over EXISTING save fields (no new counters, no economy/tick). -->
          <Panel>
            <div class="panel-title">LIFETIME</div>
            {#each stats.lifetime as row}
              <div class="stat-row">
                <span class="stat-row-label">{row.label}</span>
                <span class="stat-row-value">{row.value}</span>
              </div>
            {/each}
          </Panel>
          <Panel>
            <div class="panel-title">CAREER</div>
            {#each stats.career as row}
              <div class="stat-row">
                <span class="stat-row-label">{row.label}</span>
                <span class="stat-row-value">{row.value}</span>
              </div>
            {/each}
          </Panel>
          <Panel>
            <div class="panel-title">FLEET</div>
            {#each stats.fleet as row}
              <div class="stat-row">
                <span class="stat-row-label">{row.label}</span>
                <span class="stat-row-value">{row.value}</span>
              </div>
            {/each}
          </Panel>
        {/if}

      </div>
      {/if}

      {#if systemModalOpen}
      <!-- System settings MODAL (0.11.2 Shell Correction, Task 3). The System
           program left the bottom nav; its settings now open HERE as a modal
           triggered by the header portrait. Reuses the shared modal idiom the
           DELETE SAVE / Ship Systems modals establish: a fixed .modal-backdrop +
           the shared focusTrap action (Escape closes via closeSystemModal, focus
           is trapped while open and restored to the portrait on close), plus a
           backdrop click-close. The dialog SURFACE mirrors Ship Systems'
           .ss-dialog approach (opaque background via existing tokens, NOT blur,
           since Brave disables backdrop-filter; a bounded max-height with an
           internally scrolling body, so NO new hard 100vh/100dvh is introduced,
           per the scroll-containment invariant). This block sits inside <main>
           only because position:fixed makes its DOM location irrelevant to
           rendering (no transformed/filtered ancestor creates a containing block
           here); keeping it in place left the five moved settings content blocks
           below BYTE-FOR-BYTE identical to where they lived before, so only their
           surrounding navigation chrome changed. The old left rail is replaced by
           the top <SubTabs> bar below; selection is STILL tracked by
           activeSystemSubTab. The Debug tab is DEV-only via systemModalTabs'
           conditional spread, matching the debug content block's own
           {#if DEV_MODE && ...} guard, so no Debug surface exists when DEV_MODE
           is false. -->
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus, INTENTIONAL: the backdrop's click-to-close is a convenience shortcut, not the only close path. Escape (focusTrap) and the header ✕ button both close from the keyboard, and the dialog's real controls (SubTabs + body) are focusable and trapped inside, so keyboard/AT users lose no functionality by the backdrop element itself not being keyboard-operable. -->
      <div
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="System"
        use:focusTrap={closeSystemModal}
        on:click={onSystemBackdropClick}
      >
        <div class="system-modal-dialog">
          <header class="system-modal-header">
            <div class="system-modal-title">SYSTEM</div>
            <button class="system-modal-close" on:click={closeSystemModal} aria-label="Close System">✕</button>
          </header>
          <div class="system-modal-tabs">
            <SubTabs tabs={systemModalTabs} active={activeSystemSubTab} onSelect={selectSystemSubTab} />
          </div>
          <div class="system-modal-body">
      {#if activeSystemSubTab === "profile"}
      <!-- Profile view (0.11.2 Shell Correction, Task 3, NEW). Shows the same
           portrait glyph + "Fleet Admiral · Level N" identity the header already
           carries, then two PLACEHOLDER rows (Name / Portrait). Their "Change"
           controls are deliberately inert this patch: a disabled button with a
           "Coming soon" title, no handler and no new state (real profile editing
           is a later feature). Reuses the Task 2 .stat-row idiom for the rows and
           the existing .dev-btn for the controls, adding no new layout vocabulary. -->
      <Panel>
        <div class="panel-title">PROFILE</div>
        <div class="profile-identity">
          <div class="mission-portrait-frame profile-portrait" aria-hidden="true">🖼️</div>
          <div class="profile-identity-name">Fleet Admiral · Level {state.fleetAdminLevel}</div>
        </div>
        <div class="stat-row">
          <span class="stat-row-label">Name</span>
          <button class="dev-btn" disabled title="Coming soon">Change</button>
        </div>
        <div class="stat-row">
          <span class="stat-row-label">Portrait</span>
          <button class="dev-btn" disabled title="Coming soon">Change</button>
        </div>
      </Panel>
      {/if}

      {#if activeSystemSubTab === "options"}
      <Panel>
        <div class="panel-title">OPTIONS</div>
        <div class="dev-row">
          <label style="display: inline-flex; align-items: center; gap: 6px;">
            <input
              type="checkbox"
              checked={tickBarEnabled}
              on:change={(e) => {
                tickBarEnabled = (e.target as HTMLInputElement).checked;
                saveTickBarEnabled(tickBarEnabled);
              }}
            />
            Enable Tick Bar
          </label>
        </div>
        <p class="prestige-text">When enabled, the tick bar in the header fills once per tick. When disabled, it's removed from the header entirely.</p>
        <!-- Show raw tick counts alongside the human-readable clock timers on every
             "N remaining" / "Duration" readout. Mirrors the Enable Tick Bar row above
             (localStorage-persisted pref, not on GameState). Default OFF. -->
        <div class="dev-row">
          <label style="display: inline-flex; align-items: center; gap: 6px;">
            <input
              type="checkbox"
              checked={showTickCounts}
              on:change={(e) => {
                showTickCounts = (e.target as HTMLInputElement).checked;
                saveShowTickCounts(showTickCounts);
              }}
            />
            Show tick counts
          </label>
        </div>
        <p class="prestige-text">When enabled, the raw tick numbers are shown next to the clock timers on job and upgrade readouts. When disabled, only the clock is shown.</p>
        <!-- Phase 2 (Task D3): re-enable the refine-order confirmation popup. Mirrors
             the Enable Tick Bar row directly above (localStorage-persisted pref, not
             on GameState). The modal's own "Don't show this again" checkbox turns
             this OFF; this toggle turns it back ON. -->
        <div class="dev-row">
          <label style="display: inline-flex; align-items: center; gap: 6px;">
            <input
              type="checkbox"
              checked={refineConfirmEnabled}
              on:change={(e) => {
                refineConfirmEnabled = (e.target as HTMLInputElement).checked;
                saveRefineConfirmEnabled(refineConfirmEnabled);
              }}
            />
            Confirm before refining
          </label>
        </div>
        <p class="prestige-text">When enabled, a confirmation popup appears before starting a refine order. Ticking "Don't show this again" in that popup turns this off.</p>

        <!-- ============================================================
             COMBAT LOG settings (Combat 0.13.0). The FIRST section of a growing
             accessibility/theming options hub: future sections (high-contrast,
             colorblind-safe palettes, pride themes) drop in as SIBLING blocks below
             with this same "section title + segmented rows + one-line explanation"
             pattern, no refactor needed. Each control writes its localStorage pref
             immediately (mirrors the toggles above); the combat view reads the saved
             value when it next opens. Segmented .dev-btn toggles match the existing
             options styling (the theme swatches + debug segments use the same class).
             ============================================================ -->
        <div class="opt-section-title">Combat Log</div>

        <!-- Log style: flavor narration vs plain damage reporting. -->
        <div class="dev-row">
          <span class="dev-label">Log style</span>
          <button
            class="dev-btn"
            class:active={combatLogStyle === "default"}
            on:click={() => { combatLogStyle = "default"; saveCombatLogStyle("default"); }}
          >Default</button>
          <button
            class="dev-btn"
            class:active={combatLogStyle === "simplified"}
            on:click={() => { combatLogStyle = "simplified"; saveCombatLogStyle("simplified"); }}
          >Simplified</button>
        </div>
        <p class="prestige-text">Simplified distills the log to plain damage reporting (shield and hull numbers), dropping the flavor narration. Default keeps the descriptive combat prose.</p>

        <!-- Damage colors: tint shield vs hull damage numbers (accessibility). -->
        <div class="dev-row">
          <span class="dev-label">Damage colors</span>
          <button
            class="dev-btn"
            class:active={combatDamageColors}
            on:click={() => { combatDamageColors = true; saveCombatDamageColors(true); }}
          >On</button>
          <button
            class="dev-btn"
            class:active={!combatDamageColors}
            on:click={() => { combatDamageColors = false; saveCombatDamageColors(false); }}
          >Off</button>
        </div>
        <p class="prestige-text">When on, shield damage is shown in blue and hull damage in orange in the Simplified log, so the two read apart at a glance.</p>

        <!-- Log speed: how fast rounds stream into the log. -->
        <div class="dev-row">
          <span class="dev-label">Log speed</span>
          <button
            class="dev-btn"
            class:active={combatLogSpeed === "fast"}
            on:click={() => { combatLogSpeed = "fast"; saveCombatLogSpeed("fast"); }}
          >Fast (1s)</button>
          <button
            class="dev-btn"
            class:active={combatLogSpeed === "slow"}
            on:click={() => { combatLogSpeed = "slow"; saveCombatLogSpeed("slow"); }}
          >Slow (5s)</button>
        </div>
        <p class="prestige-text">How long each round of the combat log lingers before the next appears: Fast reveals about one round per second, Slow one every five seconds.</p>

        <!-- Auto-scroll: pin the log to the newest line as it streams. -->
        <div class="dev-row">
          <span class="dev-label">Auto-scroll</span>
          <button
            class="dev-btn"
            class:active={combatAutoScroll}
            on:click={() => { combatAutoScroll = true; saveCombatAutoScroll(true); }}
          >On</button>
          <button
            class="dev-btn"
            class:active={!combatAutoScroll}
            on:click={() => { combatAutoScroll = false; saveCombatAutoScroll(false); }}
          >Off</button>
        </div>
        <p class="prestige-text">When on, the combat log keeps the newest round in view as it streams. When off, the log holds position so you can read back without being pulled to the bottom.</p>

        <div class="theme-row">
          {#each THEME_NAMES as name}
            <button
              class="theme-swatch"
              class:active={currentTheme === name}
              style="background:{THEME_PREVIEW_COLORS[name]}"
              title={name}
              aria-label={name}
              on:click={() => setTheme(name)}
            ></button>
          {/each}
        </div>
        <div class="dev-row">
          <button class="dev-btn" on:click={doExportSave}>Export Save</button>
          <!-- Label-wrapping-hidden-input is the standard way to skin a file
               input as a regular button (native file inputs can't be styled
               directly), clicking the visible "Import Save" text triggers
               the hidden input beneath it. Reuses .dev-btn as-is (no new CSS
               needed, a <label> displays/cursors sensibly here the same as
               the <button> siblings either side of it). -->
          <label class="dev-btn">
            Import Save
            <input type="file" accept="application/json,.json" style="display:none" on:change={onImportFileSelected} />
          </label>
          <button class="dev-btn danger" on:click={() => (deleteModalOpen = true)}>Delete Save</button>
        </div>
      </Panel>
      {/if}

      {#if DEV_MODE && activeSystemSubTab === "debug"}
        <Panel class="dev-panel">
          <div class="panel-title dev-title">DEBUG PANEL (dev-only)</div>
          <div class="dev-row">
            <span class="dev-label">Speed</span>
            {#each [1, 10, 100, 1000, 0] as s}
              <button class="dev-btn" class:active={speed === s} on:click={() => (speed = s)}>
                {s === 0 ? "Pause" : `${s}x`}
              </button>
            {/each}
          </div>
          <div class="dev-row">
            <span class="dev-label">Offline sim</span>
            <button class="dev-btn" on:click={() => simulateOffline(1)}>+1h</button>
            <button class="dev-btn" on:click={() => simulateOffline(8)}>+8h</button>
            <button class="dev-btn" on:click={() => simulateOffline(24)}>+24h</button>
          </div>
          <!-- [DEV] Progression testing grants (Progression Pacing Rework) --
               raw grants to clear/afford the new FA-level + admin-point walls
               and per-captain statPoint costs without grinding. See the
               devGrant* handlers in the script block. -->
          <div class="dev-row">
            <span class="dev-label">[DEV] Progression</span>
            <button class="dev-btn" on:click={devGrantFleetAdminLevels}>+5 FA Levels</button>
            <button class="dev-btn" on:click={devGrantAdminPoints}>+100 Admin Pts</button>
            <button class="dev-btn" on:click={devGrantStatPoints}>+10 Stat Pts (active captain)</button>
          </div>
          <div class="dev-row">
            <span class="dev-label">[DEV] Credits</span>
            <button class="dev-btn" on:click={() => devGrantCredits(10000)}>+10K</button>
            <button class="dev-btn" on:click={() => devGrantCredits(100000)}>+100K</button>
            <button class="dev-btn" on:click={() => devGrantCredits(1000000)}>+1M</button>
          </div>
          <div class="dev-row">
            <span class="dev-label">[DEV] Materials</span>
            <button class="dev-btn" on:click={devGrantMaterials}>+ Craft materials (ores + refined)</button>
          </div>
          <!-- [DEV] Combat 0.13.0 test battle. Runs the REAL sim (bridge ->
               resolveBattle -> formatCombatLog) on the player's first ship vs a
               hardcoded pirate and prints the log below. READ-ONLY on state: it
               bridges a COPY of the ship's stats, persists nothing, and never
               touches the real ship's hull. Each click is a fresh seeded fight.
               See devRunTestBattle in the script block. -->
          <div class="dev-row">
            <span class="dev-label">[DEV] Combat</span>
            <button class="dev-btn" on:click={devRunTestBattle}>Run Test Battle</button>
          </div>
          {#each devBattleLines as line}
            <div class="dev-row">
              <span class="dev-label"></span>
              <span class="dev-readout-text">{line}</span>
            </div>
          {/each}
          <div class="dev-row">
            <button class="dev-btn" on:click={doSave}>Save now</button>
            <button class="dev-btn danger" on:click={resetSave}>Reset save</button>
          </div>
        </Panel>

        <!-- [DEV] Equipment 0.11.0 test harness (device-check checkpoint). NOT the
             shipped, mockup-gated fitting UI (that lands later with the user's
             sketches). Functional over pretty: it wires the REAL equipment helpers
             (generateEquipment / canFitEquipment / fitEquipment / unfitEquipment /
             equippedFor / fittedInSlot) and the REAL derived-stat projection so the
             equipment system can be exercised on-device. Sits inside the SAME
             {#if DEV_MODE && activeSystemSubTab === "debug"} block as the DEBUG PANEL
             above, so it is gated identically and flows inside the existing tab
             scroll area (no new height / overflow container, per the scroll-
             containment invariant). See the devEquip* / devGrantEquipment /
             devFit* handlers in the script block. -->
        <Panel class="dev-panel">
          <div class="panel-title dev-title">EQUIPMENT (dev-only)</div>

          <!-- GRANT: pick a live slot + one of its varieties, then mint a spare.
               The roll is fixed at a high-visibility radiant / q5 / iLevel-400 so
               the base-vs-fitted delta below is obvious. -->
          <div class="dev-row">
            <span class="dev-label">Grant slot</span>
            {#each Object.keys(EQUIPMENT_SLOTS) as slotKey}
              <button
                class="dev-btn"
                class:active={devEqSlot === slotKey}
                on:click={() => devSelectEqSlot(slotKey as EquipmentSlotType)}
              >{EQUIPMENT_SLOTS[slotKey].label}</button>
            {/each}
          </div>
          <div class="dev-row">
            <span class="dev-label">Variety</span>
            <select class="dev-btn" bind:value={devEqVariety}>
              {#each EQUIPMENT_SLOTS[devEqSlot].varieties as v}
                <option value={v.key}>{v.label}</option>
              {/each}
            </select>
            <button class="dev-btn" on:click={() => devGrantEquipment(devEqSlot, devEqVariety)}>
              + Grant radiant q5 spare
            </button>
          </div>

          <!-- Spare pool: every unfitted piece, grouped implicitly by the FIT rows
               below (each ship-slot lists its own matching spares). Here we just
               show the count + a flat list so the user can see what has been minted. -->
          {@const sparePool = state.equipment.filter((e) => e.fittedToShipId === null)}
          <div class="dev-row">
            <span class="dev-label">Spares</span>
            <span class="dev-readout-text">{sparePool.length} in pool</span>
          </div>
          {#each sparePool as spare (spare.id)}
            <div class="dev-row">
              <span class="dev-label"></span>
              <span class="dev-readout-text">{devPieceDesc(spare)}</span>
            </div>
          {/each}

          <!-- FIT / UNFIT + STATS, one block per ship in the fleet. -->
          {#if state.ships.length === 0}
            <div class="dev-row"><span class="dev-readout-text">No ships in the fleet yet.</span></div>
          {/if}
          {#each state.ships as ship (ship.id)}
            {@const shipDef = SHIP_TYPES[ship.typeKey]}
            {@const assignedCaptain = ship.assignedCaptainId !== null ? state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null : null}
            {@const onMission = assignedCaptain !== null && assignedCaptain.mission !== null}
            {@const baseStats = shipDerivedStats(ship, [])}
            {@const fitStats = shipDerivedStats(ship, equippedFor(state, ship.id))}
            {@const statRows = [
              { label: "cargoCapacity", base: devEqFlat(baseStats.cargoCapacity), fit: devEqFlat(fitStats.cargoCapacity) },
              { label: "transitSpeed", base: devEqPct(baseStats.transitSpeedMult), fit: devEqPct(fitStats.transitSpeedMult) },
              { label: "engineEff", base: devEqPct(baseStats.engineEfficiency), fit: devEqPct(fitStats.engineEfficiency) },
              { label: "fuelCapacity", base: devEqFlat(baseStats.fuelCapacity), fit: devEqFlat(fitStats.fuelCapacity) },
              { label: "extractYield", base: devEqPct(baseStats.extractionYieldMult), fit: devEqPct(fitStats.extractionYieldMult) },
              { label: "powerOutput", base: devEqFlat(baseStats.powerOutput), fit: devEqFlat(fitStats.powerOutput) },
              { label: "powerDraw", base: devEqFlat(baseStats.powerDraw), fit: devEqFlat(fitStats.powerDraw) },
              { label: "mass", base: devEqFlat(baseStats.mass), fit: devEqFlat(fitStats.mass) },
            ]}
            <div class="dev-ship-block">
              <div class="dev-row">
                <span class="dev-label">Ship</span>
                <span class="dev-readout-text">
                  {shipDef?.label ?? ship.typeKey} ({ship.id}) ·
                  {assignedCaptain ? assignedCaptain.label : "parked"}
                  {#if onMission}· ON MISSION (install locked){/if}
                </span>
              </div>

              <!-- Per live slot: what is fitted (with Unfit), plus each matching
                   spare as a Fit button (disabled + reasoned when canFit blocks). -->
              {#each Object.keys(EQUIPMENT_SLOTS) as slotKey}
                {@const slot = slotKey as EquipmentSlotType}
                {@const fitted = fittedInSlot(state, ship.id, slot)}
                {@const matchingSpares = state.equipment.filter((e) => e.fittedToShipId === null && e.slotType === slot)}
                <div class="dev-row">
                  <span class="dev-label">{EQUIPMENT_SLOTS[slot].label}</span>
                  {#if fitted}
                    <span class="dev-readout-text">{devPieceDesc(fitted)}</span>
                    <button class="dev-btn danger" on:click={() => devUnfitEquipment(ship.id, slot)}>Uninstall</button>
                  {:else}
                    <span class="dev-readout-text">(empty)</span>
                  {/if}
                  {#each matchingSpares as spare (spare.id)}
                    {@const gate = canFitEquipment(state, ship.id, spare.id)}
                    <button
                      class="dev-btn"
                      disabled={!gate.ok}
                      title={gate.ok ? `Install ${spare.id}` : devFitReasonText(gate.reason)}
                      on:click={() => devFitEquipment(ship.id, spare.id)}
                    >Install {spare.id}{gate.ok ? "" : " (blocked)"}</button>
                  {/each}
                </div>
              {/each}

              <!-- STATS: BASE (bare hull) vs FITTED (equippedFor pieces folded in).
                   Multipliers / 0-based bonuses shown as percents; capacities, mass,
                   and power shown flat. (statRows is computed above, as a direct
                   child of the {#each ship} block, since {@const} may not sit inside
                   a plain <div>.) -->
              {#each statRows as row}
                <div class="dev-row">
                  <span class="dev-label">{row.label}</span>
                  <span class="dev-readout-text">{row.base} &rarr; {row.fit}</span>
                </div>
              {/each}
            </div>
          {/each}
        </Panel>
      {/if}

      {#if activeSystemSubTab === "log"}
      <Panel>
        <div class="panel-title">LOG</div>
        <div class="log-list">
          {#if logEntries.length === 0}
            <div class="log-empty">No events yet.</div>
          {/if}
          {#each logEntries as entry}
            <div class="log-entry">{entry}</div>
          {/each}
        </div>
      </Panel>
      {/if}

      {#if activeSystemSubTab === "about"}
      <Panel>
        <div class="panel-title">ABOUT THE APP</div>
        <div class="header-left">
          <span class="title">FLEET ADMIRAL</span>
          <span class="subtitle">prototype build · multi-captain · single sector</span>
        </div>
        <div class="research-cost">Version {APP_VERSION}</div>
        <p class="prestige-text">Contact info coming soon.</p>
      </Panel>
      {/if}

      {#if activeSystemSubTab === "patchNotes"}
      <Panel>
        <div class="panel-title">PATCH NOTES</div>
        <div class="log-list">
          {#each PATCH_NOTES as note}
            <div class="log-entry">
              <strong>{note.version}</strong>: {note.summary}
            </div>
          {/each}
        </div>
      </Panel>
      {/if}

      <!-- Community sub-tab (Task 4, 0.11.2 Shell Correction). A single call to
           action: join the player Discord. The invite opens in a new tab via the
           anchor's target/rel (rel="noopener noreferrer" so the opened page can't
           reach back through window.opener). No iframe or embedded widget, just a
           link styled as a button. The anchor reuses .buy-btn for the crimson-theme
           shape/padding and layers the scoped .discord-btn on top ONLY to apply
           Discord's brand blue (#5865f2) + white text + the icon/label gap. This
           brand-blue one-off is the single sanctioned exception to the crimson UI
           lock, justified because it is a recognizable brand mark. -->
      {#if activeSystemSubTab === "community"}
      <Panel>
        <div class="panel-title">COMMUNITY</div>
        <p class="prestige-text">Join the Fleet Admiral community on Discord to share strategies, report bugs, and hear about new updates first.</p>
        <a
          class="buy-btn discord-btn"
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.24.5a18.3 18.3 0 0 1 4.34 1.36 16.5 16.5 0 0 0-13-.02A18 18 0 0 1 10.87 3.5L10.6 3A19.8 19.8 0 0 0 5.7 4.4C2.6 9 1.75 13.5 2.17 17.9A20 20 0 0 0 8.3 21l.66-1.1c-.5-.19-.98-.42-1.44-.7l.36-.28a14.3 14.3 0 0 0 12.24 0l.36.28c-.46.28-.94.51-1.44.7L19.7 21a20 20 0 0 0 6.14-3.1c.5-5.1-.86-9.56-3.54-13.5zM9.5 15.3c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2 1.8.9 1.79 2c0 1.1-.8 2-1.79 2zm5 0c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2 1.8.9 1.79 2c0 1.1-.79 2-1.79 2z"/></svg>
          Join the Discord
        </a>
      </Panel>
      {/if}
          </div>
        </div>
      </div>
      {/if}
    </main>

    <div class="nav-tabs">
      <button class="nav-tab" class:active={activeTab === "home"} on:click={() => (activeTab = "home")}>Home</button>
      <button class="nav-tab" class:active={activeTab === "personnel"} on:click={() => (activeTab = "personnel")}>Personnel</button>
      <button class="nav-tab" class:active={activeTab === "facilities"} on:click={() => (activeTab = "facilities")}>Facilities</button>
      <button class="nav-tab" class:active={activeTab === "logistics"} on:click={() => (activeTab = "logistics")}>Logistics</button>
      <button class="nav-tab" class:active={activeTab === "fleetOperations"} on:click={() => (activeTab = "fleetOperations")}>Operations</button>
    </div>
  </div>

  {#if missionPopupKey !== null}
    <!-- Captain-selection popup (2026-07-07 Fleet Operations Mission UI,
         Task 5), consumes missionPopupKey/missionPopupCaptainId (state) and
         openMissionPopup/closeMissionPopup/doDispatchFromPopup (handlers),
         all declared/implemented earlier in this file (Task 3). Reuses the
         exact .modal-backdrop/Panel.modal-dialog pattern the DELETE SAVE
         modal below already establishes, so both modals share one visual
         language. Two-step flow: no captain selected yet shows an idle-
         captain picker list; once missionPopupCaptainId is set, the SAME
         popup re-renders with the live drop-rate/timing preview and swaps in
         a Dispatch button. This preview's bonus math (2026-07-07 Loot Tier
         Rework: uncommonChanceMult/rareChanceMult/effectiveUncommonChance/
         effectiveRareChance/commonYieldMult/uncommonYieldMult/rareYieldMult,
         replacing the old single-mult/weighted-lootTable shape) is
         hand-traced against tick.ts's own rollExtractionTick to use the
         IDENTICAL formula shape (same Math.min(1, missionDef.X * (1 + mult))
         clamp, same which-mult-affects-which-tier mapping), so the numbers
         shown here are never misleading about what the real dispatched
         mission will actually do. -->
    {@const missionDef = MISSIONS[missionPopupKey]}
    {@const selectedCaptain = missionPopupCaptainId !== null ? state.captains.find((c) => c.id === missionPopupCaptainId) ?? null : null}
    {@const idleCaptains = state.captains.filter((c) => c.mission === null)}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Select a captain for this mission" use:focusTrap={closeMissionPopup}>
      <Panel class="modal-dialog">
        <div class="panel-title">{missionDef.label.toUpperCase()}</div>

        {#if selectedCaptain === null}
          <p class="modal-instruction">Select a captain to preview mission stats.</p>
          {#if idleCaptains.length === 0}
            <p class="prestige-text">No eligible captains available.</p>
          {:else}
            <div class="modal-captain-list">
              {#each idleCaptains as captain}
                <button class="dev-btn" on:click={() => (missionPopupCaptainId = captain.id)}>{captain.label}</button>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Per-tier occurrence CHANCE math (2026-07-07 Loot Tier Rework) --
               mirrors tick.ts's rollExtractionTick EXACTLY: same Math.min(1, ...)
               clamp on each tier's occurrence chance, so the drops icon row's
               tooltip shows the captain-EFFECTIVE chance the dispatched mission
               will really roll. (The old per-tier YIELD-mult consts --
               commonYieldMult/uncommonYieldMult/rareYieldMult, were dropped with
               the per-tick text rows the drops icon row replaced, 2026-07-15: the
               icon tooltip reports drop CHANCE + stored qty, not a per-tick yield,
               so those mults are no longer displayed anywhere here.) -->
          {@const uncommonChanceMult = captainUncommonChanceMult(selectedCaptain)}
          {@const rareChanceMult = captainRareChanceMult(selectedCaptain)}
          {@const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + uncommonChanceMult))}
          {@const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + rareChanceMult))}
          {@const transitOutTicks = missionDef.transitOutTicks}
          {@const extractingTicks = requiredTicksForPhase("extracting", missionDef)}
          {@const transitBackTicks = missionDef.transitBackTicks}
          {@const unloadTicks = missionDef.unloadTicks}
          {@const totalTicks = 1 + transitOutTicks + extractingTicks + transitBackTicks + unloadTicks}
          {@const bonusRollChance = captainBonusRollChance(selectedCaptain)}
          {@const bonusRollChanceMult = captainBonusRollChanceMult(selectedCaptain)}
          {@const effectiveBonusRollChance = Math.min(1, bonusRollChance * (1 + bonusRollChanceMult))}
          <!-- This mission's ACTUAL loot triad (Task 1 rewired each mission's
               lootTable), read the real item keys so the popup reports each
               mission's own drops (Titanium/Cobalt/Osmium for Lunar Mine, Scrap
               Alloy/Salvaged Circuitry/Intact Reactor Core for Salvage, etc.), not
               the hardcoded ore labels. -->
          {@const loot = missionDef.lootTable}

          <div class="research-name">Captain: {selectedCaptain.label}</div>

          <div class="panel-title">DROP RATES</div>
          <!-- Drops icon row (2026-07-15), REPLACES the three per-tier text lines.
               Same shared builder + tooltip as the AVAILABLE-MISSIONS card, but fed
               this captain's EFFECTIVE chances (effectiveUncommonChance /
               effectiveRareChance, the captain-modified, clamped values the popup
               already computed), so each icon's tooltip drop-chance matches what the
               dispatched mission will really roll. These are real <button>s (the
               popup is a Panel, not a button, so nesting is fine), fully
               keyboard-focusable, driving the SAME Warehouse-style tooltip. -->
          <div class="drops-row">
            <span class="drops-label">Drops:</span>
            {#each missionDropTiers(loot, effectiveUncommonChance, effectiveRareChance) as drop (drop.key)}
              {@const dropItem = ITEMS[drop.key]}
              {#if dropItem}
                <button
                  type="button"
                  class="drop-icon"
                  style="--drop-rc: {warehouseRarityColor(dropItem.rarity)};"
                  aria-label="{dropItem.label}, {drop.chancePct.toFixed(1)}% drop chance"
                  on:pointerenter={(e) => hoverEnterWarehouseTooltip(e, drop.key, drop.chancePct)}
                  on:pointerleave={(e) => hoverLeaveWarehouseTooltip(e, drop.key)}
                  on:focus={(e) => focusShowWarehouseTooltip(e, drop.key, drop.chancePct)}
                  on:blur={hideWarehouseTooltip}
                  on:click={(e) => toggleWarehouseTooltip(e, drop.key, drop.chancePct)}
                >{warehouseCategoryGlyph(dropItem.category)}</button>
              {/if}
            {/each}
          </div>
          {#if effectiveBonusRollChance > 0}
            <div class="research-cost">Bonus Roll: {(effectiveBonusRollChance * 100).toFixed(1)}% chance/tick for a second independent roll (Lucky Strike)</div>
          {/if}

          <div class="panel-title">TIMING</div>
          <div class="research-cost">Transit out: {transitOutTicks} ticks ({(transitOutTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost">Extracting: {extractingTicks} ticks ({(extractingTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost">Transit back: {transitBackTicks} ticks ({(transitBackTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost">Unloading: {unloadTicks} ticks ({(unloadTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost"><strong>Total: {totalTicks} ticks ({(totalTicks * state.tickDurationSeconds).toFixed(1)}s)</strong></div>

          <!-- Mission Rework (Task 8 UI): the AUTHORITATIVE round-trip fuel cost for
               THIS selected captain's hull (the list card's figure uses the fleet's
               representative hull; this one drives the actual dispatch), plus the
               shared tank's current level. If the dispatch is blocked, canDispatch's
               reason is surfaced here in danger color AND on the Dispatch button's
               title (the button is disabled below). -->
          {@const selectedShip = state.ships.find((s) => s.assignedCaptainId === selectedCaptain.id) ?? null}
          {@const fuelCost = selectedShip ? fuelNeeded(missionDef, SHIP_TYPES[selectedShip.typeKey]) : null}
          <div class="panel-title">FUEL</div>
          <div class="research-cost">Round-trip fuel: {fuelCost !== null ? formatNumber(fuelCost) : "--"}</div>
          <div class="research-cost">In tank: {formatNumber(state.fuel)} / {formatNumber(fuelCap(state))}</div>
          {#if missionPopupGate !== null && !missionPopupGate.ok}
            <div class="research-cost" style="color: var(--color-danger)">⚠ {dispatchBlockMessage(missionPopupGate.reason, missionPopupKey)}</div>
          {/if}
        {/if}

        <div class="modal-row">
          <button class="dev-btn" on:click={closeMissionPopup}>Cancel</button>
          {#if selectedCaptain !== null}
            <!-- Dispatch gated on canDispatch (Task 7). Disabled + reason-titled when
                 blocked; the same reason shows in the FUEL section above. -->
            <button
              class="dev-btn"
              disabled={missionPopupGate !== null && !missionPopupGate.ok}
              title={missionPopupGate !== null && !missionPopupGate.ok
                ? dispatchBlockMessage(missionPopupGate.reason, missionPopupKey)
                : undefined}
              on:click={doDispatchFromPopup}
            >
              Dispatch
            </button>
          {/if}
        </div>
      </Panel>
    </div>
  {/if}

  {#if patrolPickerKey !== null}
    <!-- Combat Patrols captain picker (Combat 0.13.0, Phase 9b.5d). The patrol
         counterpart to the mission popup's first step, REUSING the exact
         .modal-backdrop / Panel.modal-dialog / .modal-captain-list idiom (and the
         focusTrap) so all three modals share one visual language. It lists IDLE
         captains (mission === null); picking one records it under this patrol's key
         via selectPatrolCaptain and closes, it does NOT dispatch (the card's Dispatch
         button does that, mirroring the two-step mission-popup flow). Unlike the
         mission popup, the ship/fuel/gate preview lives on the CARD (read-only
         assigned hull, no ship picker), so this modal is captain-selection only. -->
    {@const pickerPatrol = PATROLS[patrolPickerKey]}
    {@const idleCaptains = state.captains.filter((c) => c.mission === null)}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Select a captain for this patrol" use:focusTrap={closePatrolPicker}>
      <Panel class="modal-dialog">
        <div class="panel-title">{pickerPatrol.label.toUpperCase()}</div>
        <p class="modal-instruction">Select a captain to fly this patrol. Their assigned ship comes with them.</p>
        {#if idleCaptains.length === 0}
          <p class="prestige-text">No idle captains available, recall one first.</p>
        {:else}
          <div class="modal-captain-list">
            {#each idleCaptains as captain (captain.id)}
              <!-- patrolPickerKey is non-null in this whole block, but svelte-check
                   won't narrow a module-scoped `let` inside this nested {#each}
                   closure, so the trailing ! matches the same idiom the ASSIGN picker
                   below uses (assignPickerShipId!). -->
              <button class="dev-btn" on:click={() => selectPatrolCaptain(patrolPickerKey!, captain.id)}>{captain.label} (Level {captain.level})</button>
            {/each}
          </div>
        {/if}
        <div class="modal-row">
          <button class="dev-btn" on:click={closePatrolPicker}>Cancel</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if assignPickerShipId !== null}
    <!-- ASSIGN picker (Ships, Stats Foundation, Task 11 UI), opened by a
         PARKED ship's "Assign ▾". Lists IDLE captains (mission === null);
         picking one calls doAssignShip(captainId, thisParkedShipId), which
         assigns this hull to that captain (their old hull auto-parks). Reuses
         the mission popup's .modal-backdrop / Panel.modal-dialog /
         .modal-captain-list idiom verbatim so both share one visual language.
         The row's Assign button is already disabled when idleCaptains is empty,
         so the empty-list branch here is belt-and-suspenders (the ship could
         only reach this modal with at least one idle captain), but it's kept in
         case a captain got dispatched between opening and rendering. -->
    {@const pickerShip = state.ships.find((s) => s.id === assignPickerShipId) ?? null}
    {@const idleCaptains = state.captains.filter((c) => c.mission === null)}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Assign hull to captain" use:focusTrap={closeShipPickers}>
      <Panel class="modal-dialog">
        <div class="panel-title">ASSIGN HULL{pickerShip ? `, ${SHIP_TYPES[pickerShip.typeKey].label.toUpperCase()}` : ""}</div>
        <p class="modal-instruction">Assign this hull to a captain. Their current ship parks.</p>
        {#if idleCaptains.length === 0}
          <p class="prestige-text">No idle captains available, recall one first.</p>
        {:else}
          <div class="modal-captain-list">
            {#each idleCaptains as captain (captain.id)}
              <!-- assignPickerShipId is non-null in this whole block (the outer
                   {#if assignPickerShipId !== null} guard), but svelte-check/tsc
                   won't narrow a module-scoped `let` inside this nested {#each}
                   closure, so the trailing ! matches the same idiom the rest of
                   this file uses (activeCaptain.spec!, captain.mission!). -->
              <button class="dev-btn" on:click={() => doAssignShip(captain.id, assignPickerShipId!)}>{captain.label}</button>
            {/each}
          </div>
        {/if}
        <div class="modal-row">
          <button class="dev-btn" on:click={closeShipPickers}>Cancel</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if swapPickerCaptainId !== null}
    <!-- SWAP picker (Ships, Stats Foundation, Task 11 UI), opened by an
         ASSIGNED ship's "Swap ▾" when that ship's captain is IDLE. Because
         assignShipToCaptain can NEVER move a hull directly between two captains
         (its in-use guard rejects a target ship that's already assigned
         elsewhere), the only valid "change this captain's hull" is to give them
         a PARKED ship, so this picker lists PARKED SHIPS, not captains.
         Picking parked ship P calls doAssignShip(thisCaptainId, P.id): the
         captain's current hull parks and P becomes assigned. Same modal idiom as
         the Assign picker above, just listing ships. -->
    {@const swapCaptain = state.captains.find((c) => c.id === swapPickerCaptainId) ?? null}
    {@const parkedShips = state.ships.filter((s) => s.assignedCaptainId === null)}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Swap hull for captain" use:focusTrap={closeShipPickers}>
      <Panel class="modal-dialog">
        <div class="panel-title">SWAP HULL{swapCaptain ? `, ${swapCaptain.label.toUpperCase()}` : ""}</div>
        <p class="modal-instruction">Choose a parked ship for this captain. Their current hull parks.</p>
        {#if parkedShips.length === 0}
          <p class="prestige-text">No parked ships available, buy or free one first.</p>
        {:else}
          <div class="modal-captain-list">
            {#each parkedShips as ship (ship.id)}
              <!-- swapPickerCaptainId is non-null in this whole block (the outer
                   {#if swapPickerCaptainId !== null} guard); trailing ! for the
                   same non-narrowing-in-nested-closure reason as the Assign
                   picker above. -->
              <!-- Renamable Ships: label the pick by custom name when set (with the
                   hull class in parens), so two same-type parked hulls are distinct. -->
              <button class="dev-btn" on:click={() => doAssignShip(swapPickerCaptainId!, ship.id)}>{ship.name ? `${ship.name} (${SHIP_TYPES[ship.typeKey].label})` : SHIP_TYPES[ship.typeKey].label}</button>
            {/each}
          </div>
        {/if}
        <div class="modal-row">
          <button class="dev-btn" on:click={closeShipPickers}>Cancel</button>
        </div>
      </Panel>
    </div>
  {/if}

  <!-- Radial Skill Web (Task 11b), the shared talent-tooltip overlay that
       lived here (the old activeTooltipInfo / .tooltip-backdrop / .talent-tooltip
       block, driven by the now-removed openTooltipKey/talentTooltipInfo) was
       deleted. RadialWeb.svelte renders its OWN tooltip + Learn button internally
       on node tap, so App.svelte no longer needs a top-level talent tooltip. Its
       orphaned .tooltip-backdrop / .talent-tooltip CSS was removed in Task 17; the
       DELETE SAVE / respec / Import modals below are untouched. -->

  {#if shipSystemsShipId !== null}
    <!-- Ship Systems modal (0.11.0). Reuses the shared .modal-backdrop + focusTrap
         pattern every other modal uses (Escape closes via closeShipSystems, focus
         trapped + restored). The panel (ShipSystemsPanel.svelte) is NOT wrapped in
         Panel.svelte: it renders its OWN opaque dialog surface so it stays legible
         on Brave (which lacks backdrop-filter blur) and owns its internal scroll
         (the right-hand stats column) WITHOUT a new hard 100vh/100dvh (scroll-
         containment invariant, docs/plans/2026-07-07-scroll-containment-locked-
         placeholders-design.md). `state` is passed in read-only; Install/Uninstall
         route back to installSystem/uninstallSystem, where persistence lives. -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Ship Systems" use:focusTrap={closeShipSystems}>
      <ShipSystemsPanel
        {state}
        shipId={shipSystemsShipId}
        onInstall={installSystem}
        onUninstall={uninstallSystem}
        onRepair={repairShipNow}
        onRename={handleRenameShip}
        onClose={closeShipSystems}
      />
    </div>
  {/if}

  {#if combatViewCaptain !== null}
    <!-- Combat View modal (Combat 0.13.0, Phase 12b Unit C). Same shared
         .modal-backdrop + focusTrap idiom as the Ship Systems modal (Escape closes
         via closeCombatView, focus trapped + restored). CombatView renders its OWN
         bounded, internally-scrolling dialog surface. It is DISPLAY ONLY: it reads
         a pure replay of the captain's patrol and mutates no game state, so opening
         / closing is side-effect free. The #if guard also auto-closes the view if
         the captain disappears (e.g. the patrol ends). -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Combat View" use:focusTrap={closeCombatView}>
      <CombatView {state} captain={combatViewCaptain} onClose={closeCombatView} />
    </div>
  {/if}

  {#if deleteModalOpen}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete save confirmation" use:focusTrap={cancelDelete}>
      <Panel class="modal-dialog">
        <div class="panel-title">DELETE SAVE</div>
        <p class="modal-warning">This will permanently erase your progress. This can't be undone.</p>
        <p class="modal-instruction">Type <strong>DELETE</strong> to confirm.</p>
        <input class="modal-input" type="text" bind:value={deleteConfirmText} aria-label="Type DELETE to confirm" />
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelDelete}>Cancel</button>
          <button class="dev-btn danger" disabled={deleteConfirmText !== "DELETE"} on:click={confirmDelete}>Delete</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if refineConfirmModalOpen}
    <!-- Start-a-craft confirmation modal (Crafting Allocation Redesign, Task C4, reuses the
         Phase-2 refine-confirm pref + modal). Same .modal-backdrop/Panel.modal-dialog/
         .modal-warning/.modal-row structure as the DELETE SAVE modal, so all modals share one
         visual language. The "Don't show this again" checkbox disables the refineConfirm pref on
         Confirm (persisted like tickBarEnabled); the System -> Options toggle re-enables it.
         Confirm commits the held pendingLineStart (via startLine); Cancel starts nothing. -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm craft" use:focusTrap={cancelLineStart}>
      <Panel class="modal-dialog">
        <div class="panel-title">CONFIRM CRAFT</div>
        <p class="modal-warning">Start this production line? Its materials will be reserved, you can cancel the line to refund the remainder.</p>
        <label class="modal-row" style="justify-content: flex-start; gap: 6px; margin-bottom: 4px;">
          <input type="checkbox" bind:checked={refineConfirmDontShowAgain} />
          Don't show this again
        </label>
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelLineStart}>Cancel</button>
          <button class="dev-btn" on:click={confirmLineStart}>Confirm</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if salvageConfirm !== null}
    <!-- Salvage confirmation modal (device-test feedback): a salvage PERMANENTLY breaks
         down the item, so both the Ship Systems tab and the Salvaged Materials tab route
         their Salvage button through this guard first. Reuses the SAME .modal-backdrop /
         Panel.modal-dialog / .modal-warning / .modal-row structure as the DELETE SAVE and
         homeworld-respec modals, so every confirm shares one visual language. Plain
         Cancel/Confirm (no typed word, no "don't ask again"): the tiered variant + the
         post-salvage result readout are DEFERRED to 0.11.1. Confirm dispatches to the
         matching handler by kind; Cancel destroys nothing. -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm salvage" use:focusTrap={cancelSalvageConfirm}>
      <Panel class="modal-dialog">
        <div class="panel-title">CONFIRM SALVAGE</div>
        <!-- A Standard-Issue baseline has no recipe, so it is a zero-reward DISCARD, not a
             "break down for parts". Detect it (a system whose piece has no blueprintKey) so
             the warning tells the truth rather than promising parts it will not yield. -->
        {@const scId = salvageConfirm.id}
        {@const scIsBaseline = salvageConfirm.kind === "system" && state.equipment.find((e) => e.id === scId)?.blueprintKey === null}
        <p class="modal-warning">
          {#if scIsBaseline}
            Permanently discard <strong>{salvageConfirm.name}</strong>? This removes the Standard-Issue system for nothing (it has no materials to recover) and can't be undone.
          {:else}
            Permanently break down <strong>{salvageConfirm.name}</strong> for parts? This destroys the
            {salvageConfirm.kind === "system" ? "system" : salvageConfirm.kind === "ship" ? "ship" : "material"} and can't be undone.
          {/if}
        </p>
        {#if salvageShipCaptainWarning !== null}
          <p class="modal-warning">This will leave <strong>{salvageShipCaptainWarning}</strong> without a ship until you assign them another. Any crafted systems return to your spares.</p>
        {/if}
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelSalvageConfirm}>Cancel</button>
          <button class="dev-btn danger" on:click={confirmSalvage}>Salvage</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if homeworldRespecModalOpen}
    <!-- Homeworld Talents Reset confirmation modal (Task 13, Talent Tree
         Visual Redesign), reuses the SAME .modal-backdrop/Panel.modal-
         dialog/.modal-warning/.modal-row structure as the DELETE SAVE modal
         above (and the Import Save modal below), so all of this app's
         modals keep one visual language. No typed-confirmation-word input,
         same reasoning as Import Save's modal: the Reset button itself
         (disabled below RESPEC_COST_CREDITS) is already a deliberate,
         gated action, so a plain Cancel/Confirm pair is enough friction
         here, on top of the cost + irreversibility warning text below. -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Reset homeworld talents" use:focusTrap={cancelHomeworldRespec}>
      <Panel class="modal-dialog">
        <div class="panel-title">RESET HOMEWORLD TALENTS</div>
        <p class="modal-warning">
          This will refund every talent's Admiralty Points (except unlocked captain slots, which stay
          permanently unlocked) and cost {RESPEC_COST_CREDITS} Credits. This can't be undone.
        </p>
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelHomeworldRespec}>Cancel</button>
          <button
            class="dev-btn danger"
            disabled={state.credits.lt(RESPEC_COST_CREDITS)}
            on:click={doRespecHomeworldTalents}
          >
            Confirm
          </button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if captainRespecModalOpen}
    <!-- Captain Talents Reset confirmation modal, same .modal-backdrop/
         Panel.modal-dialog/.modal-warning/.modal-row structure as the modals
         above. Refunds this captain's spent Stat Points and charges
         RESPEC_COST_CREDITS.

         Task 14 (Radial Skill Web) wired the spec model into this flow. This
         modal is now only reachable when the captain HAS a spec (its Reset
         button only renders in the spec-chosen branch of the Captain Talents
         panel above). Confirm passes an explicit `null` as newSpec, so
         respecCaptainTalents CLEARS the spec back to null (not "keep current"
        , the Task 11b stub kept it; changing that to clear is exactly what
         makes the TreeSelector reappear afterward, letting the player pick a
         new spec for free). So one Reset = one 50-credit respec that both
         refunds talent points AND frees up a new free spec pick, the
         confirmed "changing an established spec costs exactly one respec"
         design. -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Reset captain talents" use:focusTrap={cancelCaptainRespec}>
      <Panel class="modal-dialog">
        <div class="panel-title">RESET CAPTAIN TALENTS, {activeCaptain.label}</div>
        <p class="modal-warning">
          This will clear this captain's specialization and refund every Captain Talent's Stat Points they spent,
          and cost {RESPEC_COST_CREDITS} Credits. You'll choose a new specialization afterward. This can't be undone.
        </p>
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelCaptainRespec}>Cancel</button>
          <button
            class="dev-btn danger"
            disabled={state.credits.lt(RESPEC_COST_CREDITS)}
            on:click={() => doRespecCaptainTalents(null)}
          >
            Confirm
          </button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if importModalOpen}
    <!-- Import Save confirmation modal (Task 7, Loot Tier Rework), reuses
         the SAME .modal-backdrop/Panel.modal-dialog/.modal-warning/.modal-row
         structure as the DELETE SAVE modal directly above (and the
         mission-selection popup further up this file), so all 3 of this
         app's modals share one visual language. Deliberately has NO typed-
         confirmation-word input like Delete Save's .modal-input above --
         confirmed against the plan doc: selecting a file via the OS picker is
         already a deliberate action, so a plain Cancel/Import button pair is
         enough friction here. importError (set by confirmImport on a
         rejected file) renders as a second .modal-warning line WITHOUT
         closing the modal, so the user can immediately pick a different
         file from the same still-open dialog. -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import save confirmation" use:focusTrap={cancelImport}>
      <Panel class="modal-dialog">
        <div class="panel-title">IMPORT SAVE</div>
        <p class="modal-warning">This will REPLACE your current save. This can't be undone.</p>
        {#if importError}
          <p class="modal-warning">{importError}</p>
        {/if}
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelImport}>Cancel</button>
          <button class="dev-btn danger" on:click={confirmImport}>Import</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if saveCorruptModalOpen}
    <!-- Corrupt-save recovery modal (P4), reuses the SAME .modal-backdrop/
         Panel.modal-dialog/.modal-warning/.modal-row structure as the Import/
         Delete modals above. Escape is a DELIBERATE no-op here: the focusTrap
         action normally closes a modal on Escape, but there is nothing safe to
         return to (the game cannot run on a corrupt save and autosave is
         suppressed), so dismissing would strand the player on a blank no-save
         screen. The ONLY exit is "Start fresh game" (optionally after grabbing
         a backup first), so we pass a no-op close handler. -->
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Save could not be loaded" use:focusTrap={() => {}}>
      <Panel class="modal-dialog">
        <div class="panel-title">SAVE COULD NOT BE LOADED</div>
        <p class="modal-warning">Your save exists but could not be loaded. It has NOT been deleted. Copy the text below as a backup before you continue.</p>
        <textarea class="modal-textarea" readonly aria-label="Corrupt save backup text" rows="4">{corruptRawSave}</textarea>
        <div class="modal-row">
          <button class="dev-btn" on:click={downloadRawSave}>Download backup</button>
          <button class="dev-btn danger" on:click={startFreshFromCorrupt}>Start fresh game</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if offlineSummary !== null}
    <!-- While-You-Were-Away offline summary modal (Combat 0.13.0, Phase 13, design
         Section 17). Reuses the SAME shared .modal-backdrop + focusTrap idiom every
         other modal uses (Escape closes via dismissOfflineSummary, focus trapped +
         restored, aria-modal dialog). DISPLAY ONLY: it reads the pure before/after
         diff (offlineSummary, set once in onMount) and mutates no game state, so
         opening/closing is side-effect free. Each section renders ONLY when its part
         of the diff is non-empty, so the modal is never padded with empty rows.
         Copy is sentence case throughout (no ALL CAPS, no exclamation marks). -->
    {@const sum = offlineSummary}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="While you were away" use:focusTrap={dismissOfflineSummary}>
      <Panel class="modal-dialog offline-summary-dialog">
        <div class="panel-title">While you were away</div>

        <!-- Time away: formatDuration renders a real-seconds span by passing a
             seconds-per-tick of 1 (ticks * 1 = the seconds we already hold), reusing
             the ONE span helper rather than hand-formatting. -->
        <p class="offline-summary-lead">You were away for {formatDuration(sum.secondsAway, 1)}. Here is what your fleet got done.</p>

        <div class="offline-summary-scroll">
          <!-- Missions completed, broken down by type (Combat / Gathering / Other). One row per
               type that saw a completion; the pure diff already summed the per-mission tallies
               into their type and emitted them in a fixed order. -->
          {#if sum.missionsByType.length > 0}
            <div class="offline-summary-section">
              <div class="offline-summary-section-title">Missions completed</div>
              {#each sum.missionsByType as row (row.type)}
                <div class="offline-summary-row">
                  <span class="offline-summary-row-label">{row.type}</span>
                  <span class="offline-summary-row-value">{formatNumber(row.count)}</span>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Headline stat rows. Each shows only when its value is meaningful. -->
          {#if sum.creditsEarned.gt(0)}
            <div class="offline-summary-row">
              <span class="offline-summary-row-label">Credits earned</span>
              <span class="offline-summary-row-value">◈ {formatNumber(sum.creditsEarned)}</span>
            </div>
          {/if}

          <!-- Fleet Admiral progression: gross XP earned + whole levels gained. Shown when
               either is non-zero (a level cannot be gained without XP, but both are checked so
               the section never renders empty). -->
          {#if sum.fleetXpGained.gt(0) || sum.fleetLevelsGained > 0}
            <div class="offline-summary-row">
              <span class="offline-summary-row-label">Fleet Admiral experience</span>
              <span class="offline-summary-row-value"
                >+{formatNumber(sum.fleetXpGained)} xp{#if sum.fleetLevelsGained > 0}, +{formatNumber(sum.fleetLevelsGained)} {sum.fleetLevelsGained === 1 ? "level" : "levels"}{/if}</span
              >
            </div>
          {/if}

          <!-- Captains that earned XP, one COMPACT single-line row each (name left, xp + levels
               right) so all captains fit inside the modal's internal scroll (.offline-summary-scroll).
               levelsGained may be 0 (xp gained without a level-up), in which case only the xp shows. -->
          {#if sum.captainsProgressed.length > 0}
            <div class="offline-summary-section">
              <div class="offline-summary-section-title">Captains</div>
              {#each sum.captainsProgressed as cap (cap.id)}
                <div class="offline-summary-cap">
                  <!-- Head line: name left, xp + optional levels right. flex-wrap lets the value drop
                       to its own line rather than crushing a long name to one character per line. -->
                  <div class="offline-summary-cap-head">
                    <span class="offline-summary-row-label">{cap.name}</span>
                    <span class="offline-summary-row-value"
                      >+{formatNumber(cap.xpGained)} xp{#if cap.levelsGained > 0}, +{formatNumber(cap.levelsGained)} {cap.levelsGained === 1 ? "level" : "levels"}{/if}</span
                    >
                  </div>
                  <!-- When the captain stopped early during the window, a muted note on its OWN line
                       explaining WHY, so a reduced haul does not read as a bug and never competes with
                       the name for horizontal space (the char-per-line bug). -->
                  {#if cap.stopReason}
                    <div class="offline-summary-stop-note">{offlineStopReasonNote(cap.stopReason)}</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          <!-- Materials gained. Item ICON via the SAME per-category glyph the Warehouse tiles use
               (warehouseCategoryGlyph on the item's category), followed by the formatted qty. If an
               item id is not in the ITEMS registry (unknown / legacy), fall back to its label so the
               row still reads. -->
          {#if sum.materialsGained.length > 0}
            <div class="offline-summary-section">
              <div class="offline-summary-section-title">Materials banked</div>
              {#each sum.materialsGained as mat (mat.itemId)}
                <div class="offline-summary-row">
                  <span class="offline-summary-row-label">
                    {#if ITEMS[mat.itemId]}
                      <span class="offline-summary-item-icon" aria-hidden="true">{warehouseCategoryGlyph(ITEMS[mat.itemId].category)}</span>
                      {ITEMS[mat.itemId].label}
                    {:else}
                      {mat.itemId}
                    {/if}
                  </span>
                  <span class="offline-summary-row-value">+{formatNumber(mat.qty)}</span>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Ships that limped home into the repair queue while away. -->
          {#if sum.shipsInRepair.length > 0}
            <div class="offline-summary-section">
              <div class="offline-summary-section-title">Ships in repair</div>
              {#each sum.shipsInRepair as ship (ship.id)}
                <div class="offline-summary-row">
                  <span class="offline-summary-row-label">{ship.name}</span>
                  <span class="offline-summary-row-value offline-summary-repair">limped home, repairing</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="modal-row">
          <button class="dev-btn" on:click={dismissOfflineSummary}>Continue</button>
        </div>
      </Panel>
    </div>
  {/if}

  <!-- Warehouse tile tooltip (Phase 2, Group C), a SINGLE fleet-positioned
       element (position:fixed, so it escapes the scroll container's clipping),
       the same one-tooltip pattern the currency chips use. Its content re-derives
       from live `state` each render, so the readout stays live while hovering.
       pointer-events:none so it never blocks the tile beneath it. -->
  {#if warehouseTooltip}
    {@const tip = ITEMS[warehouseTooltip.itemId]}
    {#if tip}
      {@const tipId = warehouseTooltip.itemId}
      {@const tipCount = itemTotal(state.inventory, tipId)}
      {#if warehouseTooltip.dropChancePct !== null}
        <!-- Mission DROP ICON tooltip (2026-07-15), the SAME positioned element,
             styling, and one-open model as the warehouse tile tooltip, but with the
             drop-icon content: a rarity-colored item NAME, the live STORED quantity
             (re-derived from `state.inventory` each render, so it tracks fills), the
             per-mission DROP CHANCE this icon was opened with, and the item flavor.
             Unlike the tile tooltip it never gates on discovery, the mission cards
             already name their loot openly, so revealing the item here spoils
             nothing. -->
        {@const tipDropCap = tierCap(state, tip.tier)}
        <!-- An un-warehoused tier fails open to tierCap's uncapped sentinel
             (1e1000); the >= 1e99 test detects that so the row never reads
             "/ 1e1000". Live mission drops are all warehoused materials with a
             real cap, so in practice the held / cap form always renders. -->
        {@const tipDropUncapped = tipDropCap.gte(new Decimal("1e99"))}
        <div class="warehouse-tooltip" style="left: {warehouseTooltip.x}px; top: {warehouseTooltip.y}px;" role="tooltip">
          <div class="warehouse-tt-name" style="color: {warehouseRarityColor(tip.rarity)}">{tip.label}</div>
          <div class="warehouse-tt-rarity" style="color: {warehouseRarityColor(tip.rarity)}">{tip.rarity}</div>
          <!-- Held / cap (0.12.0 "Console" nav, CN5b): the player's current stock
               AND its storage cap for THIS item, so a run's value is judgeable at a
               glance (e.g. "Titanium Ore: 1,240 / 5,000"). itemTotal (held, tipCount
               above) + tierCap (cap) are the SAME derivations the Warehouse tile
               tooltip reads, so this cannot drift from the Materials view. -->
          <div class="warehouse-tt-row">
            <span>Held / Cap</span>
            <span class="warehouse-tt-v">{#if tipDropUncapped}{formatNumber(tipCount)}{:else}{formatNumber(tipCount)} / {formatNumber(tipDropCap)}{/if}</span>
          </div>
          <div class="warehouse-tt-row">
            <span>Drop chance</span>
            <span class="warehouse-tt-v" style="color: {warehouseRarityColor(tip.rarity)}">{warehouseTooltip.dropChancePct.toFixed(1)}%</span>
          </div>
          <div class="warehouse-tt-stat">{tip.flavor}</div>
        </div>
      {:else}
        {@const tipDiscovered = state.discovered.includes(tipId)}
        {@const tipCap = tierCap(state, tip.tier)}
        {@const tipAtCap = tipDiscovered && materialAtCap(state, tipId)}
        {@const tipPct = warehouseFillPct(tipCount, tipCap)}
        <div class="warehouse-tooltip" style="left: {warehouseTooltip.x}px; top: {warehouseTooltip.y}px;" role="tooltip">
          {#if !tipDiscovered}
            <div class="warehouse-tt-name" style="color: var(--color-text-secondary)">❓ Undiscovered</div>
            <div class="warehouse-tt-hint">Hint: {tip.unlockHint}</div>
          {:else}
            <div class="warehouse-tt-name">{tip.label}</div>
            <div class="warehouse-tt-rarity" style="color: {warehouseRarityColor(tip.rarity)}">{tip.rarity}</div>
            <div class="warehouse-tt-row">
              <span>Stored</span>
              <span class="warehouse-tt-v">{formatNumber(tipCount)} / {formatNumber(tipCap)}</span>
            </div>
            <div class="warehouse-tt-bar">
              <span style="width: {tipAtCap ? 100 : tipPct}%; background: {tipAtCap ? 'var(--color-danger)' : warehouseRarityColor(tip.rarity)};"></span>
            </div>
            <div class="warehouse-tt-row">
              <span>Filled</span>
              <span class="warehouse-tt-v" style="color: {tipAtCap ? 'var(--color-danger)' : 'var(--color-text-primary)'}">{Math.round(tipAtCap ? 100 : tipPct)}%</span>
            </div>
            <!-- Allocated / Free readout (Crafting Allocation Redesign C5, 2026-07-16).
                 Total is the "Stored" row above (physical stock). Allocated = units
                 reserved by active craft lines (state.refineLines + fabricateLines via
                 the `allLines` reactive); Free = usable stock. `allocatedItem` is
                 DISPLAY-CLAMPED to <= Total here (Decimal.min) so a reserve-ahead
                 continuous line can never render "Allocated > Total", the freeItem
                 helper already clamps Free >= 0, this keeps the tooltip coherent. -->
            {@const tipAllocated = Decimal.min(allocatedItem(allLines, tipId), tipCount)}
            <div class="warehouse-tt-row">
              <span>Allocated</span>
              <span class="warehouse-tt-v" style="color: var(--color-warning)">{formatNumber(tipAllocated)}</span>
            </div>
            <div class="warehouse-tt-row">
              <span>Free</span>
              <span class="warehouse-tt-v" style="color: var(--color-success)">{formatNumber(freeItem(state.inventory, allLines, tipId))}</span>
            </div>
            <div class="warehouse-tt-stat">{tip.flavor}</div>
            {#if tipAtCap}
              <div class="warehouse-tt-warn">⚠ FULL, producers auto-stopped. Expand storage.</div>
            {/if}
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .root {
    /* The hard viewport height (100vh/100dvh, with its dvh-fallback idiom) now
       lives ONE level up on Root.svelte's .app-shell, so the update banner can
       share the viewport and push the app DOWN instead of overlaying it. .root
       fills whatever height .app-shell leaves after the banner, via flex.
       This PRESERVES the scroll-containment invariant (see
       docs/plans/2026-07-07-scroll-containment-locked-placeholders-design.md):
       .root still has a definite (flex-derived) height and overflow: hidden, so
       the page never grows past the viewport and the ONE scrollable region
       (.tab-scroll-area, per active tab) still absorbs all overflow. When no
       banner is showing it renders nothing, so .app-shell hands .root the full
       viewport height exactly as before, behavior is unchanged in that case.
       flex:1 + min-height:0 is the same idiom .tab-body/.tab-scroll-area already
       use, so .frame's height:100% still resolves against a definite height. */
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .frame {
    position: relative;
    z-index: 1;
    height: 100%; /* fills .root's fixed viewport height exactly */
    /* Was 720px (a mobile-first cap dating back to Phase 1, long logged in
       SUGGESTIONS.md as "full-width panels", a deferred idea until now),
       then 98%, then 100% with a max-width: 2400px pixel ceiling for
       ultrawide monitors. That pixel ceiling turned out to have the exact
       same problem TWICE now, a fixed px value can never scale with an
       arbitrarily large screen, so on a real ultrawide monitor wider than
       2400px the app sat in a bounded box with black space on either side,
       the very thing the ceiling was trying to prevent at a smaller scale
       (this already happened once before with an even tighter 1400px
       value). No max-width at all now, width: 100% already IS a
       percentage, so it scales correctly on any monitor by definition; a
       pixel-based ceiling on top of it can only ever fight that scaling,
       never help it. No separate mobile handling needed. margin:auto
       dropped, it only centers when there's leftover space outside the
       element, and at width:100% there is none. */
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* only .tab-scroll-area (nested inside) actually scrolls */
    /* No horizontal padding here anymore (2026-07-07: moved to .tab-body,
       below), .top-bar and .nav-tabs are direct flex children of .frame
       with no horizontal padding of their own, so with .frame's own
       horizontal inset removed they now span the full 100% width edge to
       edge (their OWN internal padding still keeps their text/buttons off
       the true edge). Only the middle content area (.tab-body, containing
       the sub-tabs row and every tab's panels) keeps a small inset, so
       header and footer read as full-bleed while the panels still render
       fully inset from the edge. Top padding is still the ONLY place
       safe-area-inset-top is handled, .top-bar is the very first element
       inside .frame now (the old standalone "FLEET ADMIRAL" title Panel
       above it was retired in favor of an About sub-tab under System, per
       the user's own request), so .frame's own top edge should sit flush
       against the real viewport edge on desktop, same as .nav-tabs already
       does at the bottom (bottom padding is 0 for the same reason). No
       extra flat px on top of the safe-area inset, env() alone resolves
       to 0px on any device without a notch/status-bar, so this is flush on
       desktop and still clears real notches on devices that have one. */
    padding: env(safe-area-inset-top, 0px) 0 0;
  }
  .header-left { display: flex; flex-direction: column; }
  .title {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 2px;
    color: var(--color-accent-bright);
  }
  .subtitle { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; }
  .tab-body {
    /* Replaces the old .main rule (same class removed from the <main> tag in
       the template, <main> becomes <main class="tab-body">). This is the
       ONE flexible region between the fixed top-bar and the fixed bottom nav
      , flex:1 + min-height:0 is the standard flexbox idiom that lets a flex
       child actually SHRINK below its content's natural height (without
       min-height:0, a flex child defaults to min-height:auto, which would let
       its content push .frame taller than the viewport instead of triggering
       the inner scrollbar, this is the single most common way this exact
       kind of layout silently breaks, so don't drop it). */
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 10px 11px 0; /* was 14px/16px, cut ~30% per the user's request for a slightly tighter inset. top: gap below .top-bar, whether the tab's first child is a <SubTabs> row or .tab-scroll-area directly. left/right: the horizontal inset moved here from .frame (2026-07-07), .top-bar/.nav-tabs are flush edge-to-edge now, only the middle content column (sub-tabs + panels) stays inset, so header/footer read as full-bleed while the panels still render fully inside their own margin. */
  }
  .tab-scroll-area {
    /* THE scrollable region, every tab wraps its actual panel content in
       exactly one of these. Same flex:1 + min-height:0 idiom as .tab-body
       above, but this time paired with overflow-y:auto so IT (not the page)
       is what actually scrolls. Scrollbar hidden across engines (2026-07-07
       mobile pass), still fully scrollable via touch/wheel/drag, just no
       visible track/thumb cluttering the view, matching the app's general
       "no chrome you didn't ask for" feel. */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* old Edge/IE */
    display: flex;
    flex-direction: column;
    gap: 14px; /* preserves the old .main's gap:14px spacing between stacked panels, now scoped to just the scrollable region */
    padding-bottom: 10px; /* was 14px, cut ~30% to match .tab-body's tightened inset, breathing room at the very bottom of scrolled content, above .nav-tabs */
  }
  .tab-scroll-area::-webkit-scrollbar { display: none; } /* Chrome/Safari/most mobile browsers */
  /* The very first element inside .frame now, the old standalone "FLEET
     ADMIRAL" title Panel that used to sit above it was retired in favor of
     an About sub-tab under System (see the SystemSubTab comment above).
     Also a normal flex child now, not position:fixed (see .frame above). */
  .top-bar {
    background: var(--color-panel-bg-strong);
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    padding: 10px 16px;
    flex-shrink: 0; /* never compresses, even if .tab-scroll-area's content is tall */
    /* Own stacking layer (2026-07-09) so a currency info-tooltip, which drops
       below the bar and overlaps the tab body, always paints above that
       content. z-index:20 sits inside .frame's own z-index:1 context and stays
       well under .modal-backdrop (z-index:100), so modals still cover the
       header. */
    position: relative;
    z-index: 20;
  }
  /* Header redesign (2026-07-07, mid-plan addition unrelated to the loot/
     talent rework, portrait placeholder + inline XP bar + one-line tick
     bar, per the user's own ASCII mockup). Replaces the old stacked
     .top-bar-row/.research-bar-track/.tick-bar-track/.tick-bar-readout
     layout (each on its own full-width line) with: a left-hand portrait next
     to the name+XP-bar row, then a single full-width tick-bar row below.
     .top-bar-header lays out the portrait + info column side by side. */
  .top-bar-header { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
  /* Descendant selector (specificity 0,2,0) rather than a bare .top-bar-portrait
     class (0,1,0), this reliably overrides .mission-portrait-frame's own
     flex/height/font-size regardless of where either rule sits in this
     stylesheet, so there's no source-order dependency to accidentally break
     by moving/reordering rules later. Only overrides what needs shrinking for
     the header's smaller footprint; .mission-portrait-frame's border,
     background, and flex-centering apply untouched since this rule doesn't
     redeclare them. */
  /* The header portrait became a <button> (0.11.2 Shell Correction, Task 3): it
     opens the System settings modal. This same descendant-selector rule (which
     already sizes the header instance) also carries the button-chrome reset, the
     dashed->solid border switch, and position:relative for the gear badge, ALL
     scoped to the header instance ONLY, so the shared .mission-portrait-frame
     class (used by the mission cards) is never restyled. border-style:solid keeps
     .mission-portrait-frame's own 1px width + accent-tinted color, only trading
     the decorative dash for a solid edge that reads as an interactive control. */
  .top-bar-header .top-bar-portrait {
    flex: 0 0 40px;
    height: 40px;
    font-size: 16px;
    border-style: solid;
    position: relative;
    padding: 0;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }
  /* Gear badge on the header portrait: a small ⚙ tucked into the bottom-right
     corner, marking the portrait as the settings entry point. Absolute
     positioning only; color reuses the existing --color-accent token (no new
     palette). pointer-events:none so the whole portrait button stays one target. */
  .portrait-gear-badge {
    position: absolute;
    right: -3px;
    bottom: -3px;
    font-size: 11px;
    line-height: 1;
    color: var(--color-accent);
    pointer-events: none;
  }
  .top-bar-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .top-bar-name { font-size: 11px; letter-spacing: 0.5px; color: var(--color-accent); text-transform: uppercase; }
  .top-bar-xp-row { display: flex; align-items: center; gap: 8px; }
  .top-bar-xp-label { font-size: 10px; color: var(--color-text-secondary); flex-shrink: 0; }
  .top-bar-xp-track { flex: 1; margin-bottom: 0; } /* overrides .research-bar-track's own margin-bottom:6px, this copy sits inline, not stacked above other content */
  .top-bar-xp-readout { font-family: var(--font-mono); font-size: 10px; color: var(--color-text-secondary); white-space: nowrap; flex-shrink: 0; }
  .top-bar-tick-row { display: flex; align-items: center; gap: 8px; }
  .top-bar-tick-label { font-size: 10px; letter-spacing: 0.5px; color: var(--color-accent); text-transform: uppercase; flex-shrink: 0; }
  .top-bar-tick-track { flex: 1; }
  .top-bar-tick-readout { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-secondary); white-space: nowrap; flex-shrink: 0; }
  /* Currency strip (2026-07-09). A flex row of resource chips; wraps on narrow
     screens so additional currencies never overflow the top bar. margin-bottom
     matches the header block's own 8px so the tick row stays evenly spaced
     whether or not this strip is present. */
  .top-bar-currencies { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
  /* Positioning context for the absolutely-placed info tooltip below. */
  .currency-chip-wrap { position: relative; display: inline-flex; }
  /* One resource readout: accent glyph + mono value, boxed in a faint accent-
     tinted pill so it reads as a distinct HUD element, not body text. It's a
     real <button> (tap opens its info tooltip), so the rule also resets the UA
     button look back to the pill styling. */
  .currency-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 8px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: 4px;
    background: rgba(var(--color-accent-rgb), 0.08);
    font: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent; /* suppress the grey Android tap flash */
  }
  /* Hover (desktop) and open (any input) share the brighter accent treatment so
     the chip visibly responds whether or not its tooltip is currently showing. */
  .currency-chip:hover,
  .currency-chip.open {
    border-color: rgba(var(--color-accent-rgb), 0.6);
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .currency-chip-glyph { font-size: 11px; color: var(--color-accent); line-height: 1; }
  .currency-chip-value { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-primary); white-space: nowrap; }
  /* Info tooltip: drops just below its chip, left-aligned to it. width:max-content
     keeps short labels tight while max-width wraps the flavor line. z-index sits
     above the tab body; the .top-bar itself is lifted into its own stacking layer
     (see .top-bar's position/z-index) so this popover always overlays content. */
  .currency-tooltip {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 5;
    width: max-content;
    max-width: 240px;
    padding: 8px 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: 6px;
    /* OPAQUE background (2026-07-09 fix). The panels' --color-panel-bg-strong is
       only 6% alpha, it reads as solid ONLY because panels add
       backdrop-filter: blur(). This tooltip has no blur, so that variable let
       the busy tab content behind bleed straight through and made the text
       unreadable. Layer a faint themed accent wash over an OPAQUE dark base so
       it fully occludes content yet still matches the console tint. */
    background: linear-gradient(rgba(var(--color-accent-rgb), 0.08), rgba(var(--color-accent-rgb), 0.08)), var(--color-bg-mid);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  }
  .currency-tooltip-title {
    font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase;
    color: var(--color-accent); margin-bottom: 4px;
  }
  .currency-tooltip-body { font-size: 11px; line-height: 1.4; color: var(--color-text-secondary); }
  /* Warehouse storage-upgrade disabled-reason popover (2026-07-24 flicker fix).
     The wrapper is the hover region + the positioning context for the popover
     (a disabled button cannot be it, see openUpgradeReasonKey in the script).
     inline-block so it hugs the button and the absolute popover (top: 100%,
     left: 0 from .currency-tooltip) drops directly beneath it. */
  .upgrade-reason-wrap { position: relative; display: inline-block; }
  /* The reason is a single short sentence; widen a touch past the currency
     default so "Need 750000 Titanium Ore (have 90)" stays on one or two lines. */
  .upgrade-reason-tooltip { max-width: 260px; }
  /* Fuel chip tooltip rows (Fuel Economy v2 F4): a label/value two-column line, a thin
     divider, and a dimmer sub-note line. Scoped to the fuel tooltip; the currency
     tooltips render a plain flavor string and don't use these. min-width keeps the
     production/expenditure/net columns from collapsing on the short values. */
  .fuel-tt-row { display: flex; justify-content: space-between; gap: 16px; min-width: 190px; }
  .fuel-tt-note { font-size: 10px; color: var(--color-text-tertiary, var(--color-text-secondary)); margin: 1px 0 3px; opacity: 0.85; }
  .fuel-tt-sep { height: 1px; background: rgba(var(--color-accent-rgb), 0.25); margin: 5px 0; }
  /* Outer nav (Task 1, Phase 4), now the LAST flex child inside .frame
     (Task 1 of this plan moved it here from being the first child of the old
     <main>), so it's the bottom-most thing in the flex column, visually
     identical to today's "pinned to the bottom of the screen" look, just via
     document flow instead of position:fixed. Deliberately distinct from
     .captain-tab below (solid panel-strength background, no rounded corners,
     uppercase+letter-spaced labels) so it reads as the OUTER shell nav rather
     than a second row of the same widget as the INNER captain switcher. */
  .nav-tabs {
    display: flex;
    gap: 2px; /* thin seam between tabs, most visible on the active tab's tinted background, part of the app-wide "flat panel, thin gap" button pass */
    background: var(--color-panel-bg-strong);
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
    /* Devices with a gesture-nav home indicator reserve a safe area at the
       bottom of the screen, still the flush-bottom element (now via
       document flow as .frame's last flex child, not position:fixed), still
       needs this. */
    padding-bottom: env(safe-area-inset-bottom, 0px);
    flex-shrink: 0;
  }
  .nav-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-top: 2px solid transparent;
    padding: 12px 4px 10px;
    color: var(--color-text-secondary);
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .nav-tab.active {
    color: var(--color-accent-bright);
    border-top-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.08);
  }
  /* Fleet Captain's tab layout (UI Redesign, Task 8): left-hand vertical
     captain list + right-hand content pane. .captain-list-item uses the flat,
     square-cornered "panel" look (2026-07-07 button-style pass) instead of a
     rounded pill; a thin 2px gap between items reveals the background behind,
     reading as a segmented banner rather than one solid strip, matching
     .nav-tabs/.sub-tab/etc. (The old horizontal .captain-tabs rules were
     removed in the 0.10.2 orphaned-CSS cleanup.) */
  .fleet-captains-layout { display: flex; gap: 12px; align-items: flex-start; }
  .captain-list { display: flex; flex-direction: column; gap: 2px; flex: 0 0 96px; }
  .captain-list-item {
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 10px 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .captain-list-item.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  /* .captain-list-item.locked / .locked:hover were RETIRED in the 0.12.0 "Console"
     nav (CN5): their last consumer was the Battlespace stub panel, now replaced by
     reserved locked ConsoleTabs. .captain-list-item (+ .active) still backs the
     Home Help topic rail. */
  /* .battlespace-locked-list + .fleet-ops-layout / .mission-category-* were
     RETIRED in the 0.12.0 "Console" nav (CN5): the Operations mission-category
     rail became the ConsoleTabs top rail, and the Battlespace stub panel became
     two reserved locked ConsoleTabs, so none of those classes render anymore. */
  .fleet-captains-content { flex: 1; min-width: 0; }
  /* Console model (0.12.0 "Console" nav). The scrolling top-tab row itself now
     lives in the shared ConsoleTabs component (src/lib/ConsoleTabs.svelte):
     sticky so page content never covers it, hidden scrollbar, glow on the active
     tab, and edge scroll slices. Every perspective reuses <ConsoleTabs>, so no
     tab-row CSS lives here anymore. The selected tab's page renders in place
     below the row as plain block flow (full-width on desktop). */
  .panel-title {
    font-size: 11px;
    letter-spacing: 1.5px;
    color: var(--color-accent);
    margin-bottom: 12px;
    font-weight: 600;
  }
  /* While-You-Were-Away offline summary modal (Combat 0.13.0, Phase 13). Layers on top
     of the shared .modal-dialog surface. The dialog is width-capped and the section
     list scrolls INTERNALLY (offline-summary-scroll) so a long materials haul stays
     inside the modal instead of pushing the Continue button off-screen. All sizing is
     relative + max-width bound so it reads on mobile (narrow) and desktop alike. */
  :global(.offline-summary-dialog) {
    width: min(440px, 92vw);
    max-width: 92vw;
  }
  .offline-summary-lead {
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-text);
    margin: 0 0 12px;
  }
  /* Internal scroll: cap the section stack's height so the modal never grows past the
     viewport; overflow scrolls the rows, not the page (scroll-containment invariant). */
  .offline-summary-scroll {
    max-height: min(52vh, 420px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    /* Reserve a right gutter so the right-aligned row VALUES do not run under the scroll bar
       and clip (mobile). A single padding gutter covers both a classic desktop scrollbar
       (which sits outside the padding) and a mobile OVERLAY scrollbar (which draws over the
       edge, now clear of the padded-in content). */
    padding-right: 12px;
  }
  .offline-summary-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
  }
  .offline-summary-section-title {
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent);
    margin-bottom: 2px;
  }
  /* One label/value row. Wraps gracefully on a narrow screen: the label can grow and
     the value stays pinned right, so a long material name never clips the count. */
  .offline-summary-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    font-size: 13px;
    padding: 3px 0;
    border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  }
  .offline-summary-row-label {
    color: var(--color-text);
    min-width: 0;
    overflow-wrap: break-word;
  }
  /* Material row icon: the SAME per-category glyph the Warehouse tiles render
     (warehouseCategoryGlyph), sat just before the item label so the summary reads like the
     Warehouse. A hair of trailing space and line-height:1 keep it aligned with the label text. */
  .offline-summary-item-icon {
    font-size: 14px;
    line-height: 1;
    margin-right: 4px;
  }
  .offline-summary-row-value {
    color: var(--color-accent);
    white-space: nowrap;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  /* Captain recap block: the name+xp head line plus an optional stop-reason note beneath it. The
     border sits on the block so a stopped captain's note stays visually grouped with its captain. */
  .offline-summary-cap {
    padding: 3px 0;
    border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  }
  /* Name left, xp/levels right. flex-wrap is the fix for the char-per-line name bug: when the name
     and value cannot share one line, the value drops to its own line instead of crushing the name
     column to a sliver (which forced overflow-wrap to break the name one character at a time). */
  .offline-summary-cap-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 2px 10px;
    font-size: 13px;
  }
  /* Combat 0.13.0 (offline recap): the muted "stopped early ..." note on its OWN line below the
     captain's XP. Dimmer + smaller than the accent value so it reads as a secondary aside, and it
     never competes with the name for horizontal space. */
  .offline-summary-stop-note {
    display: block;
    margin-top: 1px;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.55));
    font-size: 12px;
    white-space: normal;
    font-variant-numeric: normal;
  }
  .offline-summary-repair {
    color: var(--color-warning, #d9a441);
    white-space: normal;
    text-align: right;
  }
  /* The .resource-grid / .resource-grid-3 / .resource-card / .resource-label /
     .resource-value(.locked) family was REMOVED in Phase 4, Task F5, its only
     user was the retired "HOME PLANET" 3-material Overview panel. */
  .tick-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    clip-path: polygon(
      4px 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% calc(100% - 4px),
      calc(100% - 4px) 100%,
      4px 100%,
      0 calc(100% - 4px),
      0 4px
    );
  }
  .tick-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.1s linear;
  }
  .research-name { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .research-cost { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 10px; }
  .research-status { font-size: 13px; color: var(--color-success); margin: 0; }
  .research-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    margin-bottom: 6px;
    clip-path: polygon(
      4px 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% calc(100% - 4px),
      calc(100% - 4px) 100%,
      4px 100%,
      0 calc(100% - 4px),
      0 4px
    );
  }
  .research-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.2s linear;
  }
  .research-readout { font-size: 11px; color: var(--color-text-secondary); text-align: right; }
  /* AVAILABLE MISSIONS grid (2026-07-15 card redesign), was a single-column
     flex stack; now a responsive grid that fits ~3 cards across on a wide
     Operations panel and collapses to 2 then 1 column as the panel narrows.
     auto-fill + minmax(260px, 1fr) does the responsive reflow with NO media
     queries: each track is >= 260px, so the browser packs as many equal
     columns as fit and stretches them to fill the row. The IN PROGRESS cards
     above are NOT inside .mission-list, so they keep their full-width stack. */
  .mission-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
    align-items: start; /* cards size to their own content, not the tallest sibling */
  }
  .mission-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .mission-recalled-text { margin-top: 10px; margin-bottom: 0; }
  /* Selectable mission card (2026-07-07 Fleet Operations Mission UI, Task 6)
    , an actual <button>, unlike the plain .mission-card div above (that one
     is a static in-progress readout, this one opens the captain-selection
     popup on click), so it resets button-default text-align/font/color via
     `text-align:left; color:inherit; font:inherit;` before laying out its own
     flat/thin-border look. Theme-aware via --color-accent-rgb/--color-accent
     only (no hardcoded hex), confirmed against app.css's 6
     [data-theme="..."] blocks, which all redefine these same custom
     properties, so this card (and its portrait-frame placeholder below)
     repaint correctly on every theme switch, same as every other themed
     element in this file. */
  /* Card redesign (2026-07-15): the selectable card is now a VERTICAL stack
     (header row on top, then the two-column body) instead of the old
     portrait-left / body-right single row. Its own inner .mission-card-header
     re-creates the portrait+name row, so the portrait still sits beside the
     name, only the exp/requirements/rewards moved into the columns below. */
  .mission-card-selectable {
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: left;
    width: 100%;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 12px;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .mission-card-selectable:hover {
    border-color: var(--color-accent);
  }
  /* Expanded "View Info" card (0.12.0 "Console" nav, CN5b): a persistent accent
     border marks which card is showing its detail, reusing the same accent token
     the :hover state uses (no new color). */
  .mission-card-selectable.expanded {
    border-color: var(--color-accent);
  }
  /* View Info detail block (CN5b): a stacked column of labelled sections (Drop
     Table / Requirements / Rewards) that replaces the compact two-column summary
     in place. Single-column stack reads cleanly at any card width, so it needs no
     media query (the .mission-list grid already reflows the cards). */
  .mission-detail { display: flex; flex-direction: column; gap: 10px; }
  .mission-detail-section { display: flex; flex-direction: column; gap: 4px; }
  /* Action row (CN5b): the View Info / Summary toggle + Assign, side by side,
     wrapping to a second line on a very narrow card. SHARED by the extraction mission
     cards; left UNTOUCHED (the patrol action row's vertical centering lives on its own
     .patrol-card-actions class below, so the extraction row is provably unchanged). */
  .mission-card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  /* Patrol in-progress action row (Combat 0.13.0, Phase 9b.5d): same base layout as
     .mission-card-actions but vertically centers its items, because the row mixes a
     button with the recalled-text paragraph (which would otherwise top-align against the
     taller button). Patrol-only, so the shared extraction rule stays untouched. */
  .patrol-card-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  /* Combat Patrols (Combat 0.13.0, Phase 9b.5d) segmented controls (Stance /
     Dispatch mode): a tight row of .dev-btn options where the SELECTED one is
     signalled with aria-pressed. The pressed style reuses the SAME accent-border +
     accent-bright-text selection signal .mission-card-selectable.expanded and
     .theme-swatch.active already use (no new color, theme-linked via the accent
     tokens), so it reads as this app's existing "this option is chosen" affordance
     rather than a new visual language. Each button flexes to share the row width. */
  .patrol-segmented { display: flex; gap: 4px; margin-top: 4px; }
  .patrol-segmented .dev-btn { flex: 1; }
  .patrol-segmented .dev-btn[aria-pressed="true"] {
    border-color: var(--color-accent);
    color: var(--color-accent-bright);
    background: rgba(var(--color-accent-rgb), 0.16);
  }
  /* Patrol Dispatch button: full-width primary action, reusing .buy-btn's themed
     accent look (same object the shop/dispatch primary actions use); only the
     full-width block layout + top spacing are added here. */
  .patrol-dispatch-btn { width: 100%; margin-top: 10px; }

  /* Combat 1.0 (Unit 2.4) ADVISORY readouts: Battle Rating scalar + Threat Assessment
     band chip. The surrounding chrome uses THEME tokens; only the chip's accent (the
     --threat-color inline var) comes from the fixed band ramp (green good, red bad),
     which is a semantic scale that must read the same in every theme. */
  .patrol-readouts {
    margin-top: 8px;
    padding: 8px 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    background: var(--color-panel-bg-strong);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .patrol-readout-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    /* Allow the value/chip to DROP to its own line when the label + a long chip name
       (the widest being "Guaranteed Victory") would overflow the card's right padding
       edge at narrow widths. Without this the nowrap threat-chip spilled ~10px past the
       card. The 10px gap doubles as the row-gap for the wrapped line. */
    flex-wrap: wrap;
  }
  .battle-rating-value {
    font-size: 15px;
    font-weight: 700;
    color: var(--color-accent-bright);
    font-variant-numeric: tabular-nums;
  }
  .patrol-readout-note {
    font-size: 11px;
    font-style: italic;
    color: var(--color-text-secondary);
  }
  /* Chip + tooltip. The wrap is the positioning context + the hover/focus target; the
     tooltip is shown on wrap :hover AND :focus-within (tap focuses the chip on mobile,
     which has no hover), so the fuzzy range + tactical-officer voice reach both inputs. */
  .threat-chip-wrap { position: relative; display: inline-flex; }
  .threat-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    /* Reset the native <button> chrome so the chip renders from our tokens only. */
    font-family: inherit;
    appearance: none;
    -webkit-appearance: none;
    border: 1px solid var(--threat-color);
    /* A faint wash of the band color behind the solid-color border + text. */
    background: color-mix(in srgb, var(--threat-color) 16%, transparent);
    color: var(--threat-color);
    font-size: 12px;
    font-weight: 600;
    cursor: help;
    white-space: nowrap;
    border-radius: 2px;
  }
  .threat-chip:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .threat-chip-icon { font-size: 13px; line-height: 1; }
  .threat-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    /* High z-index resolved INSIDE the wrap's own stacking context (elevated on hover/
       focus-within below). Was z-index:20 against the ROOT, where later-painted sibling
       cards (Stance row and everything below) painted over it; scoping it to the elevated
       wrap makes it paint above them. */
    z-index: 60;
    width: max-content;
    max-width: 240px;
    padding: 8px 10px;
    display: none;
    flex-direction: column;
    gap: 4px;
    /* OPAQUE background: the SAME 2026-07-09 fix already applied to .currency-tooltip.
       The shared --color-panel-bg is only 32% opaque (right for a large panel over the
       starfield, wrong for a tooltip): a see-through tooltip lets the card content behind
       it bleed through and scramble the text, which is the REAL cause of the "tooltip
       overlap" reports on mobile, not z-index or position (both were already correct).
       Layer a faint themed accent wash over an OPAQUE dark base so it fully occludes
       content yet still matches the console tint. Matches .currency-tooltip exactly. */
    background: linear-gradient(rgba(var(--color-accent-rgb), 0.08), rgba(var(--color-accent-rgb), 0.08)), var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    text-align: left;
    white-space: normal;
  }
  /* Elevate the wrap into its OWN stacking context (z-index != auto) ONLY while the
     tooltip is open, so the tooltip's z-index:60 resolves against the wrap and paints
     ABOVE later-painted sibling cards. Off-hover the wrap stays z-index:auto (no stacking
     context, so nothing about the normal paint order changes). No transformed/overflow-
     hidden ancestor clips it (.patrol-readouts/.mission-card/.tab-scroll-area/.tab-body/
     .frame set no transform or z-index), so this elevation is sufficient. */
  .threat-chip-wrap:hover,
  .threat-chip-wrap:focus-within { z-index: 40; }
  .threat-chip-wrap:hover .threat-tooltip,
  .threat-chip-wrap:focus-within .threat-tooltip { display: flex; }
  .threat-tooltip-range { font-size: 12px; font-weight: 600; color: var(--color-text-primary); }
  .threat-tooltip-voice { font-size: 12px; font-style: italic; color: var(--color-text-secondary); }
  /* Header row: portrait placeholder beside the name + exp sub-line. */
  .mission-card-header { display: flex; gap: 12px; align-items: center; }
  /* Descendant selector (specificity 0,2,0) shrinks the shared portrait for
     the card header WITHOUT touching .mission-portrait-frame's border/bg/
     centering, the SAME idiom .top-bar-header .top-bar-portrait uses above,
     so there's no source-order dependency. ~48px reads as two text lines tall
     (name + exp), matching the sketch's two-line picture box. The LOCKED card
     keeps the full 64px frame (it isn't inside .mission-card-header). */
  .mission-card-header .mission-portrait-frame { flex: 0 0 48px; height: 48px; font-size: 22px; }
  .mission-card-heading { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  /* research-name carries a 6px bottom margin of its own; zero it here so the
     exp sub-line sits tight under the name inside the flex-gap heading column. */
  .mission-card-heading .research-name { margin-bottom: 0; }
  .mission-xp-line { font-size: 11px; color: var(--color-text-secondary); }
  /* Body: two equal columns (Requirements | Rewards), matching the sketch. */
  .mission-card-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .mission-card-col { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  /* Column heading ("Mission Requirements:" / "Rewards"), a touch stronger
     than the body rows so each column reads as a labelled group. */
  .mission-col-label { font-size: 11px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 2px; }
  .mission-req-line { font-size: 12px; color: var(--color-text-secondary); }
  /* Portrait-frame placeholder, no ship/captain art asset exists yet (see
     the 🖼️ emoji placeholder in the template), so this is a dashed
     theme-tinted box rather than an <img>, sized to read clearly as "art
     goes here" without implying a real image failed to load. */
  .mission-portrait-frame {
    flex: 0 0 64px;
    height: 64px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.03);
  }
  .mission-card-body { flex: 1; min-width: 0; }
  /* Locked mission card (Mission Rework Task 8), reuses .mission-card's box +
     borrows the .mission-card-selectable portrait+body flex ROW layout, but is a
     static (non-button) dimmed div: the game's consistent "show locked content"
     signal (cf. .module-card.locked's opacity dim, the ConsoleTabs .ctab.locked).
     No hover/cursor affordance since it isn't clickable. */
  .mission-card-locked {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    text-align: left;
    opacity: 0.6;
  }
  /* No existing non-dev-panel "danger" button style to reuse, .dev-btn.danger
     is scoped to the amber dev-panel look, and .prestige-btn's warning color
     is for a different semantic (fleet prestige), not "cancel an in-progress
     action." Shaped like .spec-btn (same padding/font-size, both flat-cornered
     since the 2026-07-07 button-style pass) but colored with --color-danger
     to read as a distinct, cautionary action. */
  .recall-btn {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.4);
    padding: 8px 12px;
    color: var(--color-danger);
    font-size: 11px;
    cursor: pointer;
    margin-top: 10px;
  }
  .buy-btn {
    background: rgba(var(--color-accent-rgb), 0.15);
    border: 1px solid var(--color-border-strong);
    padding: 8px 10px;
    color: var(--color-accent-bright);
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .buy-btn:disabled { cursor: not-allowed; }
  /* Community sub-tab Discord button (Task 4, 0.11.2). Reuses .buy-btn for
     shape/padding; this scoped rule ONLY applies Discord's brand blue + white
     text and aligns the inline SVG icon with the label. This brand-blue one-off
     is the single sanctioned exception to the crimson UI lock (recognizable
     brand mark), deliberately kept self-contained to one class. */
  .discord-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #5865f2;
    border: 1px solid #5865f2;
    color: #fff;
    text-decoration: none;
  }
  .discord-btn:hover { background: #4752c4; border-color: #4752c4; }
  .prestige-text { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; margin: 0 0 12px; }
  .theme-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .theme-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .theme-swatch.active {
    border-color: var(--color-text-primary);
  }
  .dev-title { color: var(--color-warning) !important; }
  .dev-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .dev-label { font-size: 11px; color: var(--color-text-secondary); width: 78px; }
  /* A labeled sub-heading inside the Options panel, separating a settings section
     (e.g. Combat Log) from the rows above it. Kept small + accent-tinted so a future
     accessibility/theming section reads as a sibling group, not a new panel. */
  .opt-section-title {
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    margin: 18px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--color-border);
  }
  /* .dev-btn: the flat action-button object used across the app (the dev panel AND
     player-facing actions like Ship Systems / Assign Ship / Talents / back
     controls). THEME-LINKED (user 2026-07-21): every color derives from the accent
     token via --color-accent-rgb / --color-accent / --color-accent-bright, so the
     button tracks the active theme instead of a hardcoded gold. Hover brightens;
     disabled is a DARKENED version of the same themed button (dim accent border +
     dimmed accent text), not just a faded one, so it still reads as this object. */
  .dev-btn {
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-accent-bright);
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
  }
  .dev-btn:hover:not(:disabled):not(.active) {
    background: rgba(var(--color-accent-rgb), 0.16);
    border-color: var(--color-accent);
  }
  .dev-btn.active { background: rgba(var(--color-accent-rgb), 0.3); border-color: var(--color-accent); color: #fff; }
  .dev-btn.danger { color: var(--color-danger); }
  .dev-btn:disabled {
    background: rgba(var(--color-accent-rgb), 0.03);
    border-color: rgba(var(--color-accent-rgb), 0.15);
    color: rgba(var(--color-accent-rgb), 0.4);
    cursor: not-allowed;
  }
  /* A disabled DANGER button keeps its red hue (dimmed) rather than falling back
     to the accent tint, so a disabled destructive control still reads as danger. */
  .dev-btn.danger:disabled { color: var(--color-danger); opacity: 0.5; }
  /* [DEV] Equipment panel only (dev-gated). Monospace readout text so the
     base -> fitted stat columns line up, and a subtle divider between per-ship
     blocks. New classes, no existing panel restyled. */
  .dev-readout-text { font-size: 11px; color: var(--color-text-secondary); font-family: monospace; }
  .dev-ship-block { border-top: 1px solid rgba(var(--color-accent-rgb), 0.2); padding-top: 8px; margin-top: 8px; }
  .log-list { display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; }
  .log-empty { font-size: 12px; color: var(--color-text-dim); }
  .log-entry { font-size: 12px; color: var(--color-text-secondary); font-family: var(--font-mono); }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }
  /* System settings modal surface (0.11.2 Shell Correction, Task 3). Unlike the
     short confirm dialogs (which use Panel.modal-dialog and fit on screen), the
     System modal carries the full settings content (Options / Log / Debug / About
     / Patch Notes), so it needs its OWN bounded, internally scrolling surface, the
     exact approach Ship Systems' .ss-dialog takes. It is a column flex box: an
     OPAQUE background (an accent wash over --color-bg-mid, so it stays legible on
     Brave where backdrop-filter blur is disabled, never relying on blur), a
     max-height:100% bound (fits inside .modal-backdrop's 20px inset WITHOUT a new
     hard 100vh/100dvh, per the scroll-containment invariant), and a fixed header +
     SubTabs row with the scroll handed to .system-modal-body below. Colors and
     borders reuse existing tokens only, no new palette or visual language. */
  .system-modal-dialog {
    display: flex;
    flex-direction: column;
    width: min(900px, 100%);
    max-height: 100%;
    background: linear-gradient(rgba(var(--color-accent-rgb), 0.06), rgba(var(--color-accent-rgb), 0.06)), var(--color-bg-mid);
    border: 1px solid var(--color-border-strong);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    color: var(--color-text-primary);
  }
  /* Header row: title on the left, ✕ close on the right. Mirrors .ss-header /
     .ss-title / .ss-close so the System modal reads identically to Ship Systems. */
  .system-modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.25);
    flex-shrink: 0;
  }
  /* The tab row keeps its natural height (flex-shrink:0), so a tall settings view
     scrolls in the body below instead of squishing the tabs (which pushed their
     text toward the bottom when a big view like Debug grew the modal). */
  .system-modal-tabs { flex-shrink: 0; }
  .system-modal-title {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 1px;
    color: var(--color-accent-bright);
    text-transform: uppercase;
    flex: 1;
  }
  .system-modal-close {
    flex: 0 0 auto;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
    width: 30px;
    height: 30px;
    font-size: 14px;
    cursor: pointer;
    line-height: 1;
  }
  /* Scrolling content area: takes the remaining height and scrolls internally, so
     tall settings views (Patch Notes, Log, the dev Debug harness) never push the
     dialog past the viewport. min-height:0 lets a flex child actually shrink and
     hand scrolling to its own overflow (the standard flex-scroll idiom). The 14px
     padding matches the confirm dialogs' Panel inset so the moved content keeps
     the same breathing room it had in the old rail layout. */
  .system-modal-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
  }
  /* Profile view identity block (Task 3): portrait glyph beside the "Fleet Admiral
     · Level N" line. Reuses .mission-portrait-frame for the glyph box (a modifier
     class sizes just this instance, like the header/mission-card instances do) and
     existing text tokens; no new palette. */
  .profile-identity { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .profile-portrait { flex: 0 0 48px; height: 48px; font-size: 22px; }
  .profile-identity-name { font-size: 13px; color: var(--color-accent); text-transform: uppercase; letter-spacing: 0.5px; }
  .modal-warning { font-size: 13px; color: var(--color-danger); line-height: 1.5; margin: 0 0 10px; }
  .modal-instruction { font-size: 12px; color: var(--color-text-secondary); margin: 0 0 8px; }
  .modal-input {
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 14px;
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  /* A native <select> otherwise renders its closed control, and especially its
     OPENED option list, with the browser's default WHITE background, which the
     6%-opacity --color-panel-bg-strong above can't override; light theme text on
     white is unreadable (the crafting configurator's Tier/Item dropdowns). Force a
     SOLID dark background + themed text on the select and each <option> so the list
     is readable in every theme. */
  select.modal-input,
  select.modal-input option {
    background: var(--color-bg-mid);
    color: var(--color-text-primary);
  }
  /* Readonly backup textarea for the corrupt-save recovery modal (P4). Mirrors
     .modal-input's themed surface, but as a multi-row, monospace, wrapping box
     the player can select/copy from. overflow-wrap:anywhere keeps the long
     unbroken base64 raw inside the box; vertical scroll handles overflow past
     the fixed rows. resize:vertical lets the player enlarge it if they prefer. */
  .modal-textarea {
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 14px;
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.4;
    resize: vertical;
    overflow-wrap: anywhere;
    overflow-y: auto;
  }
  .modal-row { display: flex; justify-content: flex-end; gap: 2px; }
  /* Popup captain-picker list (2026-07-07 Fleet Operations Mission UI, Task 6)
    , stacks the idle-captain buttons inside the captain-selection popup
     (Task 5) with the same thin 2px gap as .captain-list above. Reuses .dev-btn
     as-is for each individual captain button (already
     flat-cornered from the 2026-07-07 button-style pass), this class only
     supplies the container's flex/gap, no new button style needed. */
  .modal-captain-list { display: flex; flex-direction: column; gap: 2px; margin: 10px 0; }
  /* (0.12.0 Console, CN4b: the .ship-list / .ship-card / .ship-badge / .ship-stats
     / .ship-modules / .ship-assign-btn rules were REMOVED with the Docks per-hull
     list. That list folded into the Logistics > Ships console (CN3b), which uses
     the .roster-card grid, so these classes had no remaining markup users.) */

  /* PERSONNEL Captain Roster (0.12.0 "Console" nav, Phase 1). The roster grid
     reuses the mission grid's responsive reflow in spirit: auto-fill + minmax
     so the browser packs as many equal cards as fit and stretches them to fill
     the DESKTOP width, collapsing to a single column on mobile with NO media
     query (the console's full-width-desktop / single-column-mobile rule). Cards
     mirror .mission-card-selectable's flat, thin-border, accent-tinted look
     (same theme tokens, no new colors), so the roster reads as the same visual
     family rather than a new language, and repaints on every theme switch. */
  .roster-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
    align-items: start; /* cards size to their own content, not the tallest sibling */
  }
  .roster-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: left;
    width: 100%;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 10px;
    padding: 12px;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .roster-card:hover:not(.locked) { border-color: var(--color-accent); }
  /* Reserved empty slots, inert, same dim "coming soon" convention the locked
     tabs and the old locked captain-list rows use. */
  .roster-card.locked { opacity: 0.5; cursor: not-allowed; }
  .roster-card-head { display: flex; gap: 12px; align-items: center; }
  /* Framed glyph placeholder (no per-captain art asset exists yet), sized to
     read as two text lines tall beside the name + level, same idiom as the
     mission card portrait frame. */
  .roster-card-glyph {
    flex: 0 0 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    background: rgba(var(--color-accent-rgb), 0.08);
    border-radius: 8px;
  }
  .roster-card-heading { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .roster-card-heading .research-name { margin-bottom: 0; }
  .roster-card-sub { font-size: 11px; color: var(--color-text-secondary); }
  .roster-card-lines { display: flex; flex-direction: column; gap: 4px; }
  .roster-card-line { font-size: 12px; color: var(--color-text-secondary); font-family: var(--font-mono); }
  /* Captain console back-to-grid row: the back button beside the captain name
     as the detail heading (identity). Keeping the name here lets the leveling /
     talents panels stay VERBATIM while the page still names who you are on. */
  .roster-back-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .roster-detail-name { margin-bottom: 0; }

  /* ============================================================
     Warehouse fill-tile catalog (Phase 2, Group C)
     Adapted from the user-approved warehouse-mockup.html: tiles
     fill from the bottom to show % of cap, ❓ for undiscovered, a
     danger pulse at cap (the auto-stop "expand me" signal). Uses
     the app's own theme tokens; each tile's rarity accent comes in
     via the inline --wh-rc custom property (and the fill color via
     --wh-fillc, which flips to danger at cap).
     ============================================================ */

  /* Materials tab tier selector (0.11.2 Task 9): a small segmented pill row
     that picks which storage tier's stock the sections below display. Opaque
     backgrounds only (Brave disables backdrop-filter), reusing theme tokens. */
  .materials-tier-select {
    display: flex; gap: 6px; margin: 0 0 10px;
  }
  .materials-tier-btn {
    flex: 0 0 auto;
    padding: 5px 14px;
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    background: var(--color-panel-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
  }
  .materials-tier-btn:hover { border-color: var(--color-border-strong); color: var(--color-text-primary); }
  /* Selected tier mirrors the SubTabs active idiom (translucent accent wash +
     bright accent text + accent border), so the selector reads as "selected"
     the same way every other tab does. */
  .materials-tier-btn.active {
    color: var(--color-accent-bright);
    background: rgba(var(--color-accent-rgb), 0.14);
    border-color: var(--color-accent);
    font-weight: 700;
  }
  /* Cap readout line above the Materials sections. */
  .materials-cap-line {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--color-text-secondary);
    margin: 0 2px 12px;
  }
  /* Each themed section reuses the .warehouse-tier shelf visual; give adjacent
     sections a touch more separation than the old tier panels had. */
  .materials-section { margin-bottom: 20px; }
  .materials-section:last-child { margin-bottom: 0; }

  /* tier panel */
  .warehouse-tier { margin-bottom: 16px; }
  .warehouse-tier:last-child { margin-bottom: 0; }
  .warehouse-tier-head { display: flex; align-items: center; gap: 8px; margin: 0 2px 8px; }
  .warehouse-tier-label {
    font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
    font-weight: 700; color: var(--color-text-primary);
  }
  .warehouse-tier.locked .warehouse-tier-label { color: var(--color-text-dim); }
  .warehouse-tier-line { flex: 1; height: 1px; background: linear-gradient(90deg, var(--color-border), transparent); }
  .warehouse-tier-cap { font-family: var(--font-mono); font-size: 9px; color: var(--color-text-secondary); }

  /* the fill-tile grid. MOBILE (default) stays 4-across, the size confirmed
     perfect on-device, so mobile is deliberately left untouched. DESKTOP was
     the problem: the old fixed-5-across stretched each tile to ~1/4 of a wide
     panel (excessively chunky). On desktop we instead PACK small tiles via
     auto-fill at a ~60px floor, dropping desktop tiles to roughly a quarter of
     their old area WITHOUT shrinking the text. The 60px floor is the size knob. */
  .warehouse-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
  @media (min-width: 481px) {
    .warehouse-grid { grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); }
  }

  .warehouse-tile {
    position: relative;
    aspect-ratio: 1;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
    overflow: hidden;
    cursor: pointer;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 0;
    font-family: var(--font-body);
    transition: border-color 0.15s;
  }
  .warehouse-tile:hover, .warehouse-tile:focus-visible { border-color: var(--color-border-strong); outline: none; }
  .warehouse-tile.rare-ring { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--wh-rc) 55%, transparent); }
  .warehouse-tile.unknown { border-style: dashed; opacity: 0.7; }

  .warehouse-fill {
    position: absolute; left: 0; right: 0; bottom: 0;
    background: linear-gradient(var(--wh-fillc, var(--color-accent)), color-mix(in srgb, var(--wh-fillc, var(--color-accent)) 35%, transparent));
    opacity: 0.28; z-index: 0; transition: height 0.3s;
  }
  .warehouse-glyph { position: relative; z-index: 1; font-size: 15px; line-height: 1; }
  .warehouse-glyph-unknown { color: var(--color-text-dim); }
  .warehouse-ct {
    position: relative; z-index: 1; font-family: var(--font-mono);
    font-size: 9px; font-weight: 700; margin-top: 3px; color: var(--color-text-primary);
  }
  .warehouse-pct {
    position: absolute; top: 3px; right: 4px; z-index: 1;
    font-family: var(--font-mono); font-size: 8px; color: var(--color-text-secondary);
  }

  /* at-cap: the danger pulse, the visible auto-stop "expand storage" signal */
  .warehouse-tile.full {
    border-color: var(--color-danger);
    box-shadow: 0 0 10px -1px color-mix(in srgb, var(--color-danger) 60%, transparent);
    animation: warehouse-pulse 1.6s ease-in-out infinite;
  }
  .warehouse-tile.full .warehouse-fill { opacity: 0.42; }
  .warehouse-tile.full .warehouse-ct { color: var(--color-danger); }
  @keyframes warehouse-pulse {
    0%, 100% { box-shadow: 0 0 8px -2px color-mix(in srgb, var(--color-danger) 50%, transparent); }
    50% { box-shadow: 0 0 15px 0 color-mix(in srgb, var(--color-danger) 75%, transparent); }
  }

  .warehouse-locked-note {
    text-align: center; padding: 12px; font-size: 11px;
    color: var(--color-text-secondary); font-style: italic; margin: 8px 0 0;
  }
  .warehouse-locked-note b { color: var(--color-accent); font-style: normal; }

  /* future-content stub (empty categories + troop/consumable tabs) */
  .warehouse-stub { padding: 30px 16px; text-align: center; color: var(--color-text-secondary); }
  .warehouse-stub-glyph { font-size: 28px; opacity: 0.55; }
  .warehouse-stub p { font-size: 12px; line-height: 1.55; margin: 10px 0 0; }

  /* ── Ship Systems bay (Equipment 0.11.0 Phase D) ─────────────────────────
     The capacity header mirrors the mockup's caphdr: label + big value on the
     left, the Upgrade Bay button on the right. Opaque panel-inset background
     (no blur) so it reads solid on Brave. */
  .systems-bay-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    padding: 9px 12px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
  }
  .systems-bay-cap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .systems-bay-cap-label {
    font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .systems-bay-cap-val { font-size: 18px; font-weight: 600; color: var(--color-text-primary); }
  .systems-bay-cap-val small { color: var(--color-text-secondary); font-weight: 400; font-size: 12px; }
  .systems-bay-upgrade { flex: 0 0 auto; }
  .systems-bay-upgrade-note {
    font-size: 11px; color: var(--color-text-dim); font-style: italic;
    margin: -4px 0 10px;
  }

  /* Docks "Expand Docks" header (Fleet Management): the Berths readout on the left,
     the Expand Docks button on the right. Mirrors the systems-bay-head layout so the
     Docks cap control reads like the Systems-Bay one. */
  .docks-cap-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .docks-expand-btn { flex: 0 0 auto; }
  .docks-expand-note {
    font-size: 11px; color: var(--color-text-dim); font-style: italic;
    margin: -4px 0 10px;
  }

  /* One system TILE, reusing the warehouse-grid layout but painted per rarity via
     --sys-rc (the module-exported equipmentRarityColor): a thick top border + a
     corner dot carry the rarity, the Q badge the quality. Baselines are dimmed
     (they are the free floor). Selected tile gets an accent ring. */
  .systems-tile {
    position: relative;
    aspect-ratio: 1;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
    border-top: 3px solid var(--sys-rc, var(--color-border));
    overflow: hidden;
    cursor: pointer;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; padding: 4px;
    font-family: var(--font-body);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .systems-tile:hover, .systems-tile:focus-visible { border-color: var(--color-border-strong); outline: none; }
  /* A browse-only (non-interactive) tile: no clickable affordance. Used by the
     Warehouse salvaged-materials browse grid, where salvage moved to the Salvage
     Bay, so these tiles only display and must not imply a click does something. */
  .systems-tile.baseline { opacity: 0.5; }
  .systems-tile.selected {
    box-shadow: 0 0 0 2px var(--color-accent);
    border-color: var(--color-accent);
  }
  .systems-tile-dot {
    position: absolute; top: 5px; right: 6px;
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--sys-rc, var(--color-text-dim));
  }
  .systems-tile.baseline .systems-tile-dot { display: none; }
  /* The per-variety GLYPH (prominent) + the item level (small). Quality no longer
     sits on the tile face, it lives in the tooltip (matches the Phase D mockup). */
  .systems-tile-ic { font-size: 24px; line-height: 1; }
  .systems-tile-il {
    font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }

  /* Salvage button in the tooltip action slot: the danger variant (a recycle is
     destructive), matching the app's danger control convention. */
  .systems-salvage-btn {
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.1);
    color: var(--color-danger);
  }
  .systems-salvage-none { font-size: 11px; color: var(--color-text-dim); font-style: italic; }

  /* Salvaged Materials selected-item action row (0.11.0 Task C2 UI): the item name +
     hint on the left, the Salvage button (danger, a recycle is destructive) on the
     right. Mirrors the systems-bay-head layout so the two equipment tabs read alike. */
  .salvaged-action {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .salvaged-action-info { min-width: 0; }
  .salvaged-action-name { font-size: 14px; font-weight: 700; }
  .salvaged-action-hint {
    font-size: 11px; color: var(--color-text-secondary); line-height: 1.45; margin-top: 3px;
  }

  /* tile tooltip, position:fixed so it escapes the scroll container's
     clipping, the same approach the currency-chip tooltip uses */
  /* Mission drops icon row (2026-07-15), a "Drops:" label + a compact,
     rarity-RINGED icon per dropping tier. The icons are the same size in both
     the AVAILABLE-MISSIONS card and the dispatch popup; --drop-rc is the item's
     rarity color (warehouseRarityColor), set inline per icon. Reset button/span
     defaults so both element kinds (card uses a <span>, popup a <button>) render
     identically. */
  .drops-row {
    display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
    margin-bottom: 10px; /* match .research-cost's vertical rhythm */
  }
  .drops-label { font-size: 12px; color: var(--color-text-secondary); }
  .drop-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; padding: 0; margin: 0;
    font-size: 14px; line-height: 1;
    border-radius: 6px;
    border: 1.5px solid var(--drop-rc);
    background: var(--color-bg-mid);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25) inset;
    cursor: pointer; -webkit-appearance: none; appearance: none;
    color: inherit; font-family: inherit;
  }
  .drop-icon:hover { background: var(--color-bg-high, var(--color-bg-mid)); }
  .drop-icon:focus-visible { outline: 2px solid var(--drop-rc); outline-offset: 1px; }

  .warehouse-tooltip {
    /* z-index 110 clears the .modal-backdrop (z-index 100) so a drop-icon tooltip
       raised from INSIDE the dispatch popup renders above the modal. The warehouse
       tile tooltip is never shown while a modal is open, so this is safe for it. */
    position: fixed; z-index: 110; width: 210px;
    background: var(--color-bg-mid);
    border: 1px solid var(--color-border-strong);
    border-radius: 8px; padding: 11px;
    box-shadow: 0 12px 30px -8px rgba(0, 0, 0, 0.7);
    pointer-events: none;
  }
  .warehouse-tt-name { font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
  .warehouse-tt-rarity { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; margin-top: 1px; }
  .warehouse-tt-row { display: flex; justify-content: space-between; font-size: 11px; margin-top: 8px; color: var(--color-text-secondary); }

  /* Home > Statistics label/value row (0.11.2 Shell Correction, Task 2). A minimal
     two-column readout: dim label on the left, primary-color value on the right.
     Reuses the existing token vocabulary only (text-secondary / text-primary /
     border), adds NO new colors and NO new visual language, it is just a flex
     justify-between line, the same layout .warehouse-tt-row above already uses.
     The thin bottom rule reuses --color-border for row separation and is dropped
     on the last row so the panel does not end on a stray divider. */
  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    padding: 7px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--color-border);
  }
  .stat-row:last-child { border-bottom: none; }
  .stat-row-label { color: var(--color-text-secondary); }
  .stat-row-value { color: var(--color-text-primary); font-family: var(--font-mono); font-weight: 600; }
  .warehouse-tt-v { font-family: var(--font-mono); font-weight: 700; color: var(--color-text-primary); }
  .warehouse-tt-bar {
    height: 6px; border-radius: 3px; overflow: hidden; margin-top: 7px;
    background: rgba(var(--color-accent-rgb), 0.08); border: 1px solid var(--color-border);
  }
  .warehouse-tt-bar span { display: block; height: 100%; }
  .warehouse-tt-stat { font-size: 11px; color: var(--color-text-secondary); margin-top: 8px; line-height: 1.5; }
  .warehouse-tt-hint { font-size: 11px; color: var(--color-warning); margin-top: 8px; line-height: 1.5; font-style: italic; }
  .warehouse-tt-warn { font-size: 11px; color: var(--color-danger); font-weight: 700; margin-top: 8px; }

  @media (prefers-reduced-motion: reduce) {
    .warehouse-tile.full { animation: none; }
  }
</style>
