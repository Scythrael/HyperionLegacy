<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Decimal from "break_infinity.js";
  import Starfield from "./lib/Starfield.svelte";
  import Panel from "./lib/Panel.svelte";
  import SubTabs from "./lib/SubTabs.svelte";
  // Ship Systems (0.11.0 equipment 0.11.0 fitting UI), the REAL, player-facing
  // install/uninstall screen for one ship. A reusable modal-hosted panel opened
  // from BOTH the Docks ship list and the Fleet Captain's Overview. It reads the
  // equipment helpers + derived stats; its Install/Uninstall bubble back up to
  // the installSystem/uninstallSystem handlers below (which own persistence), so
  // the fit logic + doSave live in exactly one place. Distinct from the retained
  // DEV_MODE equipment harness (System > Debug), which stays for testing.
  import ShipSystemsPanel from "./lib/ShipSystemsPanel.svelte";
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
    type EquipFitBlockReason,
  } from "./lib/game/equipment";
  import { generateEquipment } from "./lib/game/itemgen";
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
    LOOT_MATERIAL_KEYS,
    describeCaptainTalentEffect,
    describeHomeworldTalentEffect,
  } from "./lib/game/tick";
  // Mission Rework (Task 8 UI): the PURE fuel-cost math. fuelNeeded(mission, shipDef)
  // returns the round-trip fuel a hull burns for a mission, shown per mission on the
  // Operations dispatch surface (list card = representative captain's hull; popup =
  // the SELECTED captain's hull, the authoritative dispatching cost). Imported from
  // fuel.ts directly (its own module; tick.ts does not re-export it).
  import { fuelNeeded } from "./lib/game/fuel";
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

  // Radial Skill Web (Task 11b) removed the depth-row talent rendering that
  // lived here: the CAPTAIN_TALENT_BRANCH_LABEL map (keyed on the removed
  // command/diplomacy branches), the talentDepth helper (walked the removed
  // `.requires` chains), and the TALENT_ROW_HEIGHT layout constant are all
  // gone. RadialWeb.svelte now owns talent layout/labels/positioning; nothing
  // in App.svelte needs branch-depth math anymore.

  let state: GameState = freshState();
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

  // Fleet Operations captain-selection popup (2026-07-07 Fleet Operations
  // Mission UI), null missionPopupKey means the popup is closed. Selecting a
  // mission card opens it with no captain chosen yet (missionPopupCaptainId
  // null); picking a captain inside the popup recalculates the preview stats
  // but does NOT dispatch, only the Dispatch button does that.
  let missionPopupKey: MissionKey | null = null;
  let missionPopupCaptainId: number | null = null;

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
  type TabKey = "home" | "fleetCaptains" | "fleetOperations" | "foundry" | "drydock" | "stores" | "homeworld";
  let activeTab: TabKey = "home";

  // Home program (0.11.2 Shell Correction, Task 1): the landing program, first
  // on the bottom nav. 0.12.0 "Console" nav (Home is the PATTERN-SETTER for the
  // whole redesign): the old left rail is GONE. Home now lands on a console
  // OVERVIEW (a welcome heading plus a grid of buttons); tapping a button
  // SUMMONS its panel IN PLACE (the overview content is replaced by the panel),
  // and a Back control returns to the overview. activeHomePanel drives that
  // swap: null shows the overview, "help" / "statistics" show the summoned
  // panel. This overview + summoned-panel idiom is the copyable template every
  // other perspective (Personnel / Facilities / Logistics / Operations) reuses,
  // so keep it clean: one nullable "active panel" state per perspective, an
  // overview branch when it is null, one branch per panel otherwise, each panel
  // opening with a .console-back control. The reserved meta buttons
  // (Achievements / Completion / Leaderboards) stay honest "coming soon" locked
  // affordances, same crimson locked idiom the System / Battlespace slots use.
  let activeHomePanel: "help" | "statistics" | null = null;

  // Help program (0.11.2 UI Restructure, Task 14): a left rail of topic titles
  // (.captain-list, reused verbatim) + a content pane showing the selected
  // topic. activeHelpTopic is a topic id from HELP_TOPICS (helpTopics.ts),
  // defaulting to the first (missions), same rail-selection idiom as the System
  // program's activeSystemSubTab.
  let activeHelpTopic: string = "missions";

  // Home > Statistics sub-tabs (0.11.2 Shell Correction, Task 2): the Statistics
  // section splits into three top sub-tabs, rendered by the shared <SubTabs>
  // component (same idiom as every other program's sub-tab axis). Lifetime holds
  // the cumulative lifetimeStats totals, Career holds play time + the two levels,
  // Fleet holds live roster counts. Defaults to Lifetime, the headline totals.
  type StatsSubTab = "lifetime" | "career" | "fleet";
  let activeStatsSubTab: StatsSubTab = "lifetime";

  // Fleet Captain's tab sub-tabs (UI Redesign, Task 8, see
  // docs/plans/2026-07-07-ui-redesign-plan.md). Overview holds the relocated
  // CAPTAIN LEVELING content; Talents holds the relocated CAPTAIN TALENTS
  // content. Defaults to Overview since level/XP is the more commonly
  // checked view.
  type FleetCaptainSubTab = "overview" | "talents";
  let activeFleetCaptainSubTab: FleetCaptainSubTab = "overview";

  // Starbase's sub-tab: Docks (ship management, capacity + per-ship rows +
  // assign/swap). The old Requisition (instant credit-buy) sub-tab was RETIRED
  // in S4, hulls now come from the Shipyard build panel, so only Docks
  // remains. Kept as a (single-member) union so re-adding a sub-tab later is a
  // one-line change and the SubTabs `key as StarbaseSubTab` cast stays typed.
  type StarbaseSubTab = "docks";
  let activeStarbaseSubTab: StarbaseSubTab = "docks";

  // Foundry program rail state (0.11.2 nav restructure, Task 1).
  // The FOUNDRY program (Refinery/Fabricator/Research Lab/Fuel Depot) uses
  // its OWN dedicated rail-selection state. A dedicated key union
  // (the four moved facilities only) keeps invalid selections unrepresentable.
  type FoundryFacilityKey = "refinery" | "fabricator" | "research" | "fuelStorage";
  let activeFoundryFacility: FoundryFacilityKey = "refinery";

  // Drydock program rail state (0.11.2 nav restructure, Task 2).
  // The DRYDOCK program unites ship BUILDING (the Shipyard, moved from the
  // Facilities tab) with ship ASSIGNMENT (the Docks, moved from the Locations
  // tab's Fleet Sector place). Like the Foundry's activeFoundryFacility above,
  // it uses its OWN dedicated rail-selection state. (The Locations tab it also
  // drew from has since been removed in Task 4.) A dedicated two-key union keeps
  // invalid selections unrepresentable. Named (not an inline literal union) to match the sibling
  // rail-state types (FoundryFacilityKey, StoresFacilityKey, StarbaseSubTab,
  // ShipyardSubTab).
  type DrydockSection = "shipyard" | "docks";
  let activeDrydockSection: DrydockSection = "shipyard";

  // Stores program rail state (0.11.2 nav restructure, Tasks 3 + 11).
  // The STORES program holds the storage/inventory facilities. It now contains
  // TWO facilities: the Warehouse (the fill-tile inventory catalog, moved
  // VERBATIM out of the Facilities tab in Task 3) and the Salvage Bay (Task 11),
  // the dedicated home for breaking spare ship systems and salvaged materials
  // down for parts/loot. Like the Foundry's activeFoundryFacility and the
  // Drydock's activeDrydockSection above, it uses its OWN dedicated rail-
  // selection state. Named (not an inline literal union) to match the sibling
  // rail-state types (FoundryFacilityKey, DrydockSection).
  type StoresFacilityKey = "warehouse" | "salvageBay";
  let activeStoresFacility: StoresFacilityKey = "warehouse";

  // Operations program sub-tab state (0.11.2 nav restructure, Task 5).
  // The OPERATIONS program now hosts two axes via a top-level <SubTabs>:
  // "dispatch" (the existing mission dispatch UI: category rail + tier tabs +
  // mission cards) and "missionControl" (the mission-UNLOCK facility moved
  // VERBATIM out of the Facilities tab, since it is mission-related). Like the
  // sibling program states above (activeFoundryFacility / activeDrydockSection /
  // activeStoresFacility), it uses its OWN dedicated selection state. It
  // defaults to "dispatch" so the tab still opens on dispatch exactly as before
  // the Mission Control pane joined it. Named (not an inline literal union) to
  // match the sibling rail-state types.
  type OperationsSubTab = "dispatch" | "missionControl";
  let activeOperationsSubTab: OperationsSubTab = "dispatch";

  // ---- Warehouse facility view (Phase 2, Group C; 0.11.2 Task 9 restructure) --
  // A tiered fill-tile inventory catalog. The top SubTabs axis is now just FOUR
  // tabs: Overview + Upgrade (the facility-management views, mirroring the
  // Refinery's Overview/Upgrades), then two content tabs, Materials and Finished
  // Goods. The old flat per-category tabs (Raw/Refined/Components/Ship Systems/
  // Salvaged/Ship Equipment/Troop Equipment/Consumables) collapse into these two:
  //   - Materials: ONE scrollable pane with a Tier selector then themed labeled
  //     sections (raw split by subCategory into Ores & Metals / Volatiles /
  //     Organic Compounds / Recovered Tech, then Refined, Components, Salvaged
  //     Materials), each rendering the SAME fill-tile grid.
  //   - Finished Goods: the non-stacking Ship Systems bay (state.equipment),
  //     relocated verbatim here as interim content until Task 10 builds out the
  //     reserved Weapons/Modules/Consumables structure.
  //
  // Kept a typed literal union (not a free string) so a future tab is added
  // deliberately, the same discipline RefinerySubTab/FoundryFacilityKey use.
  type WarehouseCat =
    | "overview"
    | "upgrade"
    | "materials"
    | "finishedGoods";
  let activeWarehouseCat: WarehouseCat = "overview";

  // The 4 top-level SubTabs, in display order. Two management tabs then two
  // content tabs, matching the 0.11.2 Warehouse restructure mockup.
  const WAREHOUSE_CAT_TABS: { key: WarehouseCat; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "upgrade", label: "Upgrade" },
    { key: "materials", label: "Materials" },
    { key: "finishedGoods", label: "Finished Goods" },
  ];

  // FINISHED GOODS secondary tabs (0.11.2 Task 10). The Finished Goods tab is
  // itself split into product families: Ship Systems is the ONE real, populated
  // family today (the state.equipment spare-systems bay). Weapons / Modules /
  // Consumables are RESERVED roadmap slots with no engine behind them yet, so
  // they are marked locked (rendered grayed + non-clickable by SubTabs) and,
  // when defaulted-into can't happen, they only ever show an honest reserved
  // note. Named literal union (not a free string), same discipline as
  // WarehouseCat above, so a family is only ever added deliberately.
  type FinishedGoodsTab =
    | "shipSystems"
    | "weapons"
    | "modules"
    | "consumables";
  let activeFinishedGoodsTab: FinishedGoodsTab = "shipSystems";

  // The 4 Finished Goods families, in display order. Only Ship Systems is
  // unlocked; the other three carry locked:true so SubTabs disables them and
  // paints them with the same 🔒 + opacity:0.5 "coming soon" treatment the
  // Fleet Captains and module locked slots already use. Keeping the reserved
  // families visible (rather than hidden) advertises the combat roadmap.
  const FINISHED_GOODS_TABS: { key: FinishedGoodsTab; label: string; locked?: boolean }[] = [
    { key: "shipSystems", label: "Ship Systems" },
    { key: "weapons", label: "Weapons", locked: true },
    { key: "modules", label: "Modules", locked: true },
    { key: "consumables", label: "Consumables", locked: true },
  ];

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

  // The standard (non-salvaged) sections for the selected tier, each with its
  // resolved item list. Salvaged is kept OUT of this list because its tiles use
  // the select-to-salvage variant, not the standard fill-tile; it is derived
  // separately just below. Re-derives when the selected tier changes.
  $: materialsStandardSections = MATERIALS_SECTIONS.filter((s) => s.key !== "salvaged").map((s) => ({
    key: s.key,
    label: s.label,
    items: materialsSectionItems(s.key, activeMaterialsTier),
  }));
  // Salvaged Materials items for the selected tier, shown in the Warehouse
  // Materials tab as BROWSE-ONLY tiles (0.11.2 Task 11 moved the Salvage action
  // itself into the Salvage Bay facility; these tiles no longer select-to-salvage).
  $: materialsSalvagedItems = materialsSectionItems("salvaged", activeMaterialsTier);

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
  $: materialsTierEmpty =
    materialsStandardSections.every((s) => s.items.length === 0) && materialsSalvagedItems.length === 0;

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

  // Clear the warehouse tooltip whenever the category tab or the surrounding
  // navigation changes (review Minor): the tooltip is anchored to a specific
  // tile's rect, so leaving that view would otherwise leave it hovering over
  // unrelated content. The Warehouse now lives in the STORES program (0.11.2
  // Task 3), so nav within/away is tracked via activeStoresFacility (the Stores
  // rail) and activeTab (leaving the Stores program entirely), replacing the
  // old activeFacility tracker. Referencing all three vars makes this reactive
  // statement re-run on any of those changes (the initial null -> null run is
  // harmless).
  $: activeWarehouseCat, activeStoresFacility, activeTab, hideWarehouseTooltip();

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

  // ---- Homeworld program rail state (0.11.2 nav restructure, Task 4) ----------
  // The HOMEWORLD program holds the Fleet Homeworld place (Overview /
  // Administration), moved VERBATIM out of the now-removed Locations tab. It uses
  // a LEFT rail of "places" (.captain-list / .captain-list-item, reused verbatim)
  // + a right content pane; the selected place then drives its OWN SubTabs
  // (tracked by activeHomeworldSubTab; the old Fabrication sub-tab was retired in
  // Phase 4 Task F5, crafting moved to the Fabricator). Like the Foundry's
  // activeFoundryFacility, the Drydock's activeDrydockSection, and the Stores'
  // activeStoresFacility, it uses its OWN dedicated rail-selection state (NOT the
  // retired activeLocationPlace). A single-member union is fine for now (Alliance
  // Sector / Colony Registry are locked, inert rail items with no content behind
  // them yet); it is Named (not an inline literal union) to match the sibling
  // rail-state types (StoresFacilityKey, DrydockSection, FoundryFacilityKey), so
  // invalid selections stay unrepresentable.
  type HomeworldPlaceKey = "homeworld";
  let activeHomeworldPlace: HomeworldPlaceKey = "homeworld";

  // Homeworld tab sub-tabs (UI Redesign, Task 10, see
  // docs/plans/2026-07-07-ui-redesign-plan.md). Resources is the Overview
  // (a minimal placeholder this pass, fleshed out later); Talents holds the
  // relocated HOMEWORLD TALENTS content. Defaults to Resources as the most
  // commonly checked view.
  //
  // The former "refinery" sub-tab (the legacy RECIPES instant-craft/"Fabrication"
  // panel) was RETIRED in Phase 4, Task F5, crafting now lives in the dedicated
  // Fabricator facility panel (under Facilities), not a Homeworld sub-tab.
  type HomeworldSubTab = "resources" | "talents";
  let activeHomeworldSubTab: HomeworldSubTab = "resources";

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

  // Fleet Operations mission-category buttons (2026-07-07 Fleet Operations
  // Mission UI). Only "resourceGathering" has real content today, the other
  // 3 render locked/"Coming Soon", same pattern as locked captain-list slots
  // and locked sub-tabs. Confirmed with the user: Patrol needs combat
  // (Battlespace is still a stub), Surveying/Long-Term Exploration have no
  // backing mechanics yet.
  type MissionCategoryKey = "resourceGathering" | "patrol" | "surveying" | "longTermExploration";
  let activeMissionCategory: MissionCategoryKey = "resourceGathering";

  // Difficulty tiers within Resource-Gathering, reusing the SubTabs component's
  // existing locked-tab support. Tier I is real and contains BOTH launch
  // missions (see model.ts's MissionDef.tier field), confirmed with the
  // user neither shortOreRun nor longOreRun is meant to be a separate tier.
  // Tiers II-V are locked placeholders for future mission content.
  type MissionTierKey = "tierI" | "tierII" | "tierIII" | "tierIV" | "tierV";
  let activeMissionTier: MissionTierKey = "tierI";

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
      state = offlineSeconds > 5 ? tick(offlineSeconds, loadedSave.state) : loadedSave.state;
      if (offlineSeconds > 5) pushLog(`Welcome back. Advanced ${formatNumber(offlineSeconds)}s offline.`);
    } else if (hasRawSave()) {
      // A save EXISTS but failed to load (corrupt). Do NOT let the game overwrite it:
      // suppress autosave and show the recovery modal so the player can grab the raw
      // text before choosing to start fresh. suppressSave stays true until they choose.
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
    const missionLabel = MISSIONS[captain.mission!.missionKey].label; // captured before the state swap below, same pre-swap-capture idiom as doDispatchCaptainOnMission's `captain.label` above
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

  function simulateOffline(hours: number) {
    state = tick(hours * 3600, state); // fleet-wide: advances every captain, matches real offline catch-up
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

  // UNINSTALL the system in a ship's slot back to storage. unfitEquipment THROWS
  // on the on-mission lock (caught here); otherwise it returns the current system
  // to the pool AND auto-refits a fresh Standard-Issue baseline (the never-empty
  // invariant, Task 20), so it ALWAYS returns a new state, there is no empty-slot
  // no-op to special-case. Persists the swap.
  function uninstallSystem(shipId: string, slotType: EquipmentSlotType) {
    try {
      state = unfitEquipment(state, shipId, slotType);
      doSave();
      pushLog(`Uninstalled ${slotType} system on ${devShipLabel(shipId)}.`);
    } catch (e) {
      pushLog(`Cannot uninstall system: ${(e as Error).message}`);
    }
  }

  // ── Ship Systems bay (Equipment 0.11.0 Phase D, Warehouse "Ship Systems" tab) ──
  // The bay shows the SPARE pool (fittedToShipId === null): spare crafted systems
  // plus any Standard-Issue baselines (dimmed). Fitted systems live on their ships
  // (managed in ShipSystemsPanel), so they are deliberately NOT listed here. The
  // four LIVE slots are shown in a fixed order so the grouped grid is stable.
  const BAY_SLOT_ORDER: EquipmentSlotType[] = ["cargoBay", "ftlDrive", "reactorCore", "specUtility"];

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
    label: EQUIPMENT_SLOTS[slot]?.label ?? slot,
    pieces: baySpareSystems.filter((p) => p.slotType === slot),
  })).filter((g) => g.pieces.length > 0);

  // The resolved selected piece (or null). Reactive on the pool, so if the
  // selected piece is salvaged the tooltip auto-hides even without an explicit
  // clear. EVERY spare in this bay is salvageable now: a crafted spare recycles for
  // materials, and a Standard-Issue baseline salvages as a zero-reward declutter
  // (2026-07-21). Fitted pieces are absent from this list entirely, so any selected
  // piece here is a valid target. This predicate gates the Salvage button.
  $: selectedSystem =
    selectedSystemId !== null ? baySpareSystems.find((p) => p.id === selectedSystemId) ?? null : null;
  $: selectedIsSalvageable = selectedSystem !== null;

  // Toggle a tile's selection (clicking the open tile closes it), matching the
  // slot-select toggle idiom ShipSystemsPanel uses.
  function selectSystemTile(instanceId: string) {
    selectedSystemId = selectedSystemId === instanceId ? null : instanceId;
  }

  // Human sentence for a salvage REJECT reason. Exhaustive over SalvageRejectReason
  // (a switch, no default) so a new reason is a compile error here. Only notFound /
  // fitted are reachable from the bay's system salvage (a spare baseline no longer
  // rejects, it declutters), but the salvaged-material reasons are covered for totality.
  function salvageRejectText(reason: SalvageRejectReason): string {
    switch (reason) {
      case "notFound":
        return "that system no longer exists";
      case "fitted":
        return "the system is installed on a ship (uninstall it first)";
      case "notSalvagedMaterial":
        return "that item is not a salvaged material";
      case "noneHeld":
        return "none of that material is held";
      case "shipNotFound":
        return "that ship no longer exists";
      case "shipOnMission":
        return "the ship's captain is on a mission (recall first)";
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
    const eqOut = BLUEPRINTS[piece.blueprintKey]?.equipmentOutput;
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

  // The salvaged-material Salvage action now lives ONLY in the Salvage Bay
  // facility (0.11.2 Task 11); the Warehouse Materials tab shows salvaged tiles
  // for browsing but no longer selects them. So the clear is re-keyed from the
  // Materials tier to the Stores rail: leaving (or switching away from) the
  // Salvage Bay clears any pending salvaged selection, avoiding a stale inline
  // Salvage action panel. Referencing activeStoresFacility makes this reactive;
  // the initial run is a harmless null -> null. Placed AFTER the selectedSalvagedId
  // declaration so it is never used before it is declared.
  $: activeStoresFacility, (selectedSalvagedId = null);

  // Task 12: the salvage result readout is a per-visit status, so leaving (or
  // switching away from) the Salvage Bay clears it, no stale "Last salvage" panel
  // lingers on another facility (or on a fresh return to the bay). Same reactive
  // idiom as the selection clear above; the initial run is a harmless null -> null.
  $: activeStoresFacility, (lastSalvageResult = null);

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

  function commitStartLine(kind: CraftLineKind, recipeKey: string, mode: CraftLineMode) {
    const { next, started } = startLine(state, kind, recipeKey, mode);
    if (!started) return;
    state = next;
    // Task 19: an EQUIPMENT blueprint logs its minted piece's SYSTEM name (slot + variety); it
    // carries no output item. Refine + material lines log the output item as before.
    const eqOut = kind === "fabricate" ? BLUEPRINTS[recipeKey]?.equipmentOutput : undefined;
    const outputId =
      kind === "refine"
        ? REFINE_RECIPES[recipeKey]?.output.itemId ?? recipeKey
        : BLUEPRINTS[recipeKey]?.recipe.outputItem ?? recipeKey;
    const outputLabel = eqOut ? equipmentOutputLabel(eqOut) : ITEMS[outputId]?.label ?? outputId;
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
      default:
        return "Cannot start this line right now.";
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
  function shipBuildBlockText(reason: ShipBuildBlockReason, _typeKey?: ShipTypeKey): string {
    switch (reason) {
      case "notFounded":
        return "Found the Shipyard first (Upgrades).";
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
      default:
        return "Cannot build this hull right now.";
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
    state = freshState();
    createdAt = Date.now();
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
    state = freshState();
    createdAt = Date.now();
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
  $: fabricableBlueprintCount = Object.keys(BLUEPRINTS).filter(
    (k) => blueprintUnlocked(state, k) && BLUEPRINTS[k].tier <= fabricatorLevel
  ).length;

  // Whether the fabricator is built at all (>= 1 slot). Below 1 slot there are no line
  // slots to render, so the Craft sub-tab shows the Research-Lab empty-state signpost.
  $: fabricatorBuilt = fabricateSlots > 0;

  // The blueprints a Fabricator line can currently configure: RESEARCHED (blueprintUnlocked)
  // AND tier-available (tier <= fabricator level), the SAME two stable gates the fabricable
  // count uses. These populate the configurator's tier + item dropdowns. Derived off state so
  // researching/upgrading updates the dropdowns LIVE. An empty list -> the Research-Lab signpost.
  $: availableFabricateBlueprints = Object.keys(BLUEPRINTS)
    .map((k) => BLUEPRINTS[k])
    .filter((bp) => blueprintUnlocked(state, bp.key) && bp.tier <= fabricatorLevel);
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
      {#if activeTab === "homeworld"}
      <!-- HOMEWORLD program (0.11.2 nav restructure, Task 4): the Fleet
           Homeworld place (Overview / Administration), moved VERBATIM out of the
           now-removed Locations tab. Same shell as the Foundry / Drydock / Stores
           programs (tab-scroll-area > fleet-captains-layout > captain-list rail +
           fleet-captains-content). The selected place (activeHomeworldPlace:
           homeworld) drives its OWN <SubTabs>:
             - Fleet Homeworld -> Overview / Administration, tracked by
               activeHomeworldSubTab (resources / talents).
           Uses a DEDICATED activeHomeworldPlace state (a named single-member
           union, matching the sibling StoresFacilityKey), NOT the retired
           activeLocationPlace, so invalid selections stay unrepresentable. This
           is an information-architecture move, not a redesign: the Fleet
           Homeworld content PANEL below is byte-identical, only the guard
           variable and surrounding nav chrome changed. Alliance Sector / Colony
           Registry are locked "Coming soon" rail items (re-homed here from the
           Locations tab) using the exact .captain-list-item.locked idiom
           Facilities' locked facilities use. -->
      <div class="tab-scroll-area">
      <div class="fleet-captains-layout">
        <div class="captain-list">
          <button
            class="captain-list-item"
            class:active={activeHomeworldPlace === "homeworld"}
            on:click={() => (activeHomeworldPlace = "homeworld")}
          >
            Fleet Homeworld
          </button>
          <!-- Locked places, no content behind them yet (same honest
               "future signal" role as Facilities' locked facilities). Plain
               non-button divs, so they're inert; the title attr is the "Coming
               soon" affordance. -->
          <div class="captain-list-item locked" title="Coming soon, not yet available">🔒 Alliance Sector</div>
          <div class="captain-list-item locked" title="Coming soon, not yet available">🔒 Colony Registry</div>
        </div>

        <div class="fleet-captains-content">
          {#if activeHomeworldPlace === "homeworld"}
            <SubTabs
              tabs={[
                { key: "resources", label: "Overview" },
                { key: "talents", label: "Administration" },
              ]}
              active={activeHomeworldSubTab}
              onSelect={(key) => (activeHomeworldSubTab = key as HomeworldSubTab)}
            />

      {#if activeHomeworldSubTab === "resources"}
      <!-- Homeworld Overview (Phase 4, Task F5): minimal placeholder. The old
           hardcoded "HOME PLANET" 3-material panel was retired here, full
           material inventory now lives in the Warehouse, and this Overview is
           to be fleshed out later (per the design's "fleshed out later" note).
           The sub-tab shell is kept so navigation still renders. -->
      <Panel>
        <div class="panel-title">HOME PLANET</div>
        <p class="research-status">Homeworld overview coming soon, check the Warehouse for your full material inventory.</p>
      </Panel>
      {/if}

      {#if activeHomeworldSubTab === "talents"}
      <!-- Homeworld Talents (Task 6, Captain & Homeworld Talent Trees) --
           fleet-wide (not per-captain, reads state.adminPoints /
           state.unlockedHomeworldTalents directly, never activeCaptain),
           placed after the Overview above. Same fixed-5-branch
           iteration pattern as the Captain Talents panel under Fleet Ops, so
           Homeland Defense/Citizenry (zero entries today, see model.ts)
           render as labeled, empty columns.

           Homeworld Talents are Fleet Admiral prestige, gated ENTIRELY on
           adminPoints, deliberately independent of any individual
           captain's own level/statPoints (those only ever gate that
           captain's OWN Captain Talents, above under Fleet Ops). Confirmed
           with the user rather than inventing a captain-scoped gate for a
           fleet-wide purchase.

           Talent Tree Visual Redesign (Task 11), reuses Task 10's
           talentDepth/TALENT_ROW_HEIGHT/depthRows/.talent-branch-tree/
           .talent-branch-connectors/.talent-node treatment verbatim (see the
           Captain Talents panel under Fleet Ops for the pattern this mirrors
          , not reinvented here). The one wrinkle Captain Talents never
           exercised: the fleetLogistics branch has TWO independent depth-0
           roots in the SAME row, fleetLogisticsSlot1 (root of the
           Slot1->Slot2->Slot3 chain) AND fleetLogisticsYield (its own
           unrelated root, requires: null), both land in depthRows[0].
           Task 10's row rendering assumed one node per row (.talent-node was
           `left:0; right:0`, i.e. full-width) and would have silently
           overlapped two same-row siblings; this HOMEWORLD_TALENTS-side
           template guards against exactly that by computing a per-node
           column index within its own row (columnIndex) and columnCount
           (row.length), then splitting the row's width evenly across
           columns via an inline left/width/right override on each node (see
           the `style=` binding below), .talent-node's own CSS rule (App.svelte
           CSS block, near .talent-branch-tree) is left completely untouched;
           inline style always wins over it, and columnCount === 1 (every row
           except fleetLogistics' depth-0 row, see below) computes out to the
           exact same left:0%/width:100% that rule already provides, so no
           other branch's rendering changes. -->
      <Panel>
        <div class="panel-title">ADMINISTRATION</div>
        <div class="research-cost">Admin Points: {formatNumber(state.adminPoints)}</div>
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
        <!-- Radial Skill Web (Task 15), the 5-category selector now sits in
             FRONT of the RadialWeb (Task 11b previously hardcoded branch to
             "fleetLogistics"). selectedCategory is component-local, view-only
             NAVIGATION state (never persisted, see its declaration above):
             null shows the TreeSelector category card-picker; a chosen category
             shows THAT category's RadialWeb plus a back button to the picker.
             This is deliberately UNLIKE the captain spec flow: there is no
             lock-in, no cost, and no save write, committing a card just
             navigates (viewCategory), and the back button just returns to the
             picker, both freely reversible. The Reset button above
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
            pointsLabel={"Admin Points"}
            fleetAdminLevel={state.fleetAdminLevel}
            describeEffect={describeHomeworldTalentEffect}
            onLearn={(key) => doBuyHomeworldTalent(key as HomeworldTalentKey)}
          />
        {/if}
      </Panel>
      {/if}
          {/if}

        </div>
      </div>
      </div>
      {/if}

      {#if activeTab === "foundry"}
      <!-- FOUNDRY program (0.11.2 nav restructure, Task 1): the four
           "make-stuff" facilities (Refinery, Fabricator, Research Lab, Fuel
           Depot), moved VERBATIM out of the (now removed) Facilities tab. Same
           shell as the Crew tab (tab-scroll-area > fleet-captains-layout >
           captain-list rail + fleet-captains-content). Uses a DEDICATED
           activeFoundryFacility rail state. This is an information-architecture
           move, not a redesign: the moved rail buttons and content panes are
           unchanged except that their guard variable was retargeted to
           activeFoundryFacility. -->
      <div class="tab-scroll-area">
      <div class="fleet-captains-layout">
        <div class="captain-list">
          <!-- Foundry rail: the four make-stuff facilities. Rail buttons moved
               verbatim from the old Facilities rail; only class:active / on:click
               were retargeted to activeFoundryFacility. -->
          <div class="facility-owner-header">Foundry</div>
          <button
            class="captain-list-item"
            class:active={activeFoundryFacility === "refinery"}
            on:click={() => (activeFoundryFacility = "refinery")}
          >
            Refinery
          </button>
          <!-- Fabricator, REAL, selectable facility (Fabricator Task F4): CRAFTS the
               components the Research Lab unlocked. Same reused .captain-list-item /
               active idiom as the Refinery/Warehouse/Research buttons; replaced the
               locked placeholder that stood here through Phases 1-3. -->
          <button
            class="captain-list-item"
            class:active={activeFoundryFacility === "fabricator"}
            on:click={() => (activeFoundryFacility = "fabricator")}
          >
            Fabricator
          </button>
          <!-- Research Lab, REAL, selectable facility (Research Task R5): the
               blueprint-research facility. Same reused .captain-list-item / active
               idiom as the Refinery/Warehouse/Mission Control/Fuel Depot buttons. -->
          <button
            class="captain-list-item"
            class:active={activeFoundryFacility === "research"}
            on:click={() => (activeFoundryFacility = "research")}
          >
            Research Lab
          </button>
          <!-- Fuel Depot, REAL, selectable facility (Mission Rework Task 8; relabeled
               "Fuel Depot" in Fuel Economy v2 F2, KEY still `fuelStorage`): the fuel tank
               (gauge + auto-refining status + optional manual top-up) + its mixed
               storage/processing upgrade track. -->
          <button
            class="captain-list-item"
            class:active={activeFoundryFacility === "fuelStorage"}
            on:click={() => (activeFoundryFacility = "fuelStorage")}
          >
            Fuel Depot
          </button>
        </div>

        <div class="fleet-captains-content">
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
                        {#if job}{remainingReadout(job.remainingTicks, job.durationTicks, showTickCounts, state.tickDurationSeconds)}{:else}Queued, starts next tick{/if}
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
                    {@const have = itemTotal(state.inventory, itemId)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}
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
                       "why not" title when the button is disabled (covers the
                       "Upgrade already in progress" case below, plus any unmet
                       material/prereq the readiness rows above already show). -->
                  <button
                    class="buy-btn"
                    disabled={!refineryUpgradeCheck.ok}
                    title={refineryUpgradeCheck.ok ? undefined : refineryUpgradeCheck.reason}
                    on:click={() => doStartFacilityUpgrade("refinery")}
                  >
                    Build · Level {refineryLevel} → {refineryLevel + 1}
                  </button>
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
                        {#if job.effect.type === "addItem"}Fabricating → [{ITEMS[job.effect.itemId]?.label ?? job.effect.itemId}]{:else if job.effect.type === "addEquipment" && BLUEPRINTS[job.effect.blueprintKey]?.equipmentOutput}Fabricating → [{equipmentOutputLabel(BLUEPRINTS[job.effect.blueprintKey].equipmentOutput!)}]{:else}Fabricate job{/if}
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
                               Only a MATERIAL blueprint has a stackable output to render. -->
                          {#if bp.equipmentOutput}
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
                        {#if job}{remainingReadout(job.remainingTicks, job.durationTicks, showTickCounts, state.tickDurationSeconds)}{:else}Queued, starts next tick{/if}
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
                    {@const have = itemTotal(state.inventory, itemId)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}
                    </div>
                  {/each}

                  <!-- Fleet Admiral level prereq (absent field => no wall). -->
                  {#if nextFabricatorUpgrade.requiresFleetAdminLevel !== undefined}
                    {@const met = state.fleetAdminLevel >= nextFabricatorUpgrade.requiresFleetAdminLevel}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Requires Fleet Admiral level {nextFabricatorUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                    </div>
                  {/if}

                  <button
                    class="buy-btn"
                    disabled={!fabricatorUpgradeCheck.ok}
                    title={fabricatorUpgradeCheck.ok ? undefined : fabricatorUpgradeCheck.reason}
                    on:click={() => doStartFacilityUpgrade(FABRICATOR_FACILITY_KEY)}
                  >
                    Build · Level {fabricatorLevel} → {fabricatorLevel + 1}
                  </button>
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
                      <!-- Recipe (what the Fabricator will craft): inputs → output.
                           Plain-text [Item] labels (no icon tooltip needed). Task 19: an
                           EQUIPMENT blueprint previews its minted piece's SYSTEM name (slot +
                           variety); it carries no recipe.outputItem (optional, omitted). -->
                      <div class="research-cost">
                        Crafts: {#each Object.keys(bp.recipe.inputs) as inId, i}{bp.recipe.inputs[inId]}× [{ITEMS[inId]?.label ?? inId}]{i < Object.keys(bp.recipe.inputs).length - 1 ? " + " : ""}{/each} → {#if bp.equipmentOutput}[{equipmentOutputLabel(bp.equipmentOutput)}]{:else}{bp.recipe.outputQty}× [{ITEMS[bp.recipe.outputItem ?? ""]?.label ?? bp.recipe.outputItem}]{/if}
                      </div>
                      <div class="research-cost">Cost: ◈ {formatNumber(bp.researchCreditCost)} · {durationReadout(bp.researchDurationTicks, showTickCounts, state.tickDurationSeconds)}</div>

                      {#if unlocked}
                        <div class="research-cost" style="color: var(--color-success)">✓ Researched, craftable once the Fabricator is online</div>
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
                    {@const have = itemTotal(state.inventory, itemId)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}
                    </div>
                  {/each}

                  <!-- Fleet Admiral level prereq (absent field => no wall). -->
                  {#if nextResearchUpgrade.requiresFleetAdminLevel !== undefined}
                    {@const met = state.fleetAdminLevel >= nextResearchUpgrade.requiresFleetAdminLevel}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Requires Fleet Admiral level {nextResearchUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                    </div>
                  {/if}

                  <button
                    class="buy-btn"
                    disabled={!researchUpgradeCheck.ok}
                    title={researchUpgradeCheck.ok ? undefined : researchUpgradeCheck.reason}
                    on:click={() => doStartFacilityUpgrade(RESEARCH_FACILITY_KEY)}
                  >
                    Build · Level {researchLevel} → {researchLevel + 1}
                  </button>
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
                    {@const have = itemTotal(state.inventory, itemId)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}
                    </div>
                  {/each}

                  <button
                    class="buy-btn"
                    disabled={!fuelStorageUpgradeCheck.ok}
                    title={fuelStorageUpgradeCheck.ok ? undefined : fuelStorageUpgradeCheck.reason}
                    on:click={() => doStartFacilityUpgrade("fuelStorage")}
                  >
                    {#if "storageCapMult" in nextEff}Expand Tank
                    {:else if "addFuelPipelines" in nextEff}Add Pipeline
                    {:else if "fuelYieldMult" in nextEff}Boost Yield
                    {:else if "fuelInputMult" in nextEff}Improve Intake
                    {:else}Build{/if}
                  </button>
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

          {/if}
        </div>
      </div>
      </div>
      {/if}
      {#if activeTab === "drydock"}
      <!-- DRYDOCK program (0.11.2 nav restructure, Task 2): unites ship
           BUILDING (the Shipyard, moved VERBATIM out of the now removed
           Facilities tab) with ship ASSIGNMENT (the Docks, moved VERBATIM out of
           the Locations tab's Fleet Sector place). Same shell as the Foundry /
           Crew tabs (tab-scroll-area > fleet-captains-layout > captain-list rail +
           fleet-captains-content). Uses a DEDICATED activeDrydockSection rail
           state. (The Locations tab it also drew from was removed in Task 4.)
           This is an information-architecture move, not a redesign: the moved
           rail entries and content panes are unchanged except that their guard
           variable was retargeted to activeDrydockSection. -->
      <div class="tab-scroll-area">
      <div class="fleet-captains-layout">
        <div class="captain-list">
          <!-- Drydock rail: Shipyard (build the hull) then Docks (assign it to
               a captain). Both moved from their former tabs; only class:active /
               on:click retarget to activeDrydockSection. -->
          <button
            class="captain-list-item"
            class:active={activeDrydockSection === "shipyard"}
            on:click={() => (activeDrydockSection = "shipyard")}
          >
            Shipyard
          </button>
          <button
            class="captain-list-item"
            class:active={activeDrydockSection === "docks"}
            on:click={() => (activeDrydockSection = "docks")}
          >
            Docks
          </button>
        </div>

        <div class="fleet-captains-content">
          {#if activeDrydockSection === "shipyard"}
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

                    <button
                      class="buy-btn"
                      style="margin-top: 8px;"
                      disabled={!shipyardUpgradeCheck.ok}
                      title={shipyardUpgradeCheck.ok ? undefined : shipyardUpgradeCheck.reason}
                      on:click={() => doStartFacilityUpgrade(SHIPYARD_FACILITY_KEY)}
                    >
                      Found · ◈ {formatNumber(nextShipyardUpgrade.credits ?? new Decimal(0))}
                    </button>
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
                    {@const have = itemTotal(state.inventory, itemId)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}
                    </div>
                  {/each}

                  <!-- Fleet Admiral level prereq (absent field => no wall). -->
                  {#if nextShipyardUpgrade.requiresFleetAdminLevel !== undefined}
                    {@const met = state.fleetAdminLevel >= nextShipyardUpgrade.requiresFleetAdminLevel}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} Requires Fleet Admiral level {nextShipyardUpgrade.requiresFleetAdminLevel} (current: {state.fleetAdminLevel})
                    </div>
                  {/if}

                  <button
                    class="buy-btn"
                    disabled={!shipyardUpgradeCheck.ok}
                    title={shipyardUpgradeCheck.ok ? undefined : shipyardUpgradeCheck.reason}
                    on:click={() => doStartFacilityUpgrade(SHIPYARD_FACILITY_KEY)}
                  >
                    {shipyardLevel === 0 ? "Found" : "Build"} · Level {shipyardLevel} → {shipyardLevel + 1}
                  </button>
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
          {/if}

          {#if activeDrydockSection === "docks"}
            <SubTabs
              tabs={[
                { key: "docks", label: "Docks" },
              ]}
              active={activeStarbaseSubTab}
              onSelect={(key) => (activeStarbaseSubTab = key as StarbaseSubTab)}
            />

            {#if activeStarbaseSubTab === "docks"}
              <!-- DOCKS, one row per hull in state.ships. Capacity readout
                   uses the same "label: value" line style as the Homeworld
                   panels' "Admin Points: X" / "Credits: X" lines. Each ship row
                   shows: type label, the 3 mission stats (via shipDerivedStats),
                   inert module-slot pips (count = SHIP_TYPES[typeKey].moduleSlots
                  , display-only, no module system exists yet), an assignment
                   badge (the flying captain's label, or "Parked"), and ONE
                   assign/swap control whose kind + disabled-state depends on the
                   ship's assignment + that captain's mission status (see the
                   per-row @const block). -->
              <Panel>
                <!-- Panel-wide derived sets, declared first (before any markup)
                     so they're valid {@const} children of <Panel> and available
                     to every row below. parkedShips gates each ASSIGNED ship's
                     Swap button (nothing to swap in if empty); idleCaptains gates
                     each PARKED ship's Assign button (no valid target if empty).
                     Both recompute reactively as ships/captains change. -->
                {@const parkedShips = state.ships.filter((s) => s.assignedCaptainId === null)}
                {@const idleCaptains = state.captains.filter((c) => c.mission === null)}
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
                  <button
                    class="buy-btn docks-expand-btn"
                    disabled={!docksCheck.ok}
                    title={docksCheck.ok ? undefined : docksCheck.reason}
                    on:click={doExpandDocks}
                  >
                    Expand Docks
                  </button>
                </div>
                {#if !docksCheck.ok}
                  <div class="docks-expand-note">{docksCheck.reason}</div>
                {/if}
                <div class="ship-list">
                  {#each state.ships as ship (ship.id)}
                    {@const def = SHIP_TYPES[ship.typeKey]}
                    {@const stats = shipDerivedStats(ship)}
                    <!-- assignedCaptain: the captain flying THIS hull, or null if
                         parked. assignedCaptainId is the SINGLE SOURCE OF TRUTH
                         (model.ts), we look the captain up by it rather than
                         trusting any duplicate field. onMission gates the Swap
                         control: you can't pull a hull out from under an active
                         mission, matching assignShipToCaptain's own block on the
                         target captain's mission. -->
                    {@const assignedCaptain = ship.assignedCaptainId === null
                      ? null
                      : state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null}
                    {@const onMission = assignedCaptain !== null && assignedCaptain.mission !== null}
                    <div class="ship-card">
                      <div class="ship-card-head">
                        <div class="research-name">{def.label}</div>
                        <!-- Assignment badge: the flying captain's label, or
                             "Parked". .ship-badge.parked dims it to read as the
                             quieter, available state. -->
                        <span class="ship-badge" class:parked={assignedCaptain === null}>
                          {assignedCaptain === null ? "Parked" : assignedCaptain.label}
                        </span>
                      </div>

                      <div class="ship-stats">
                        <span class="ship-stat">Cargo: {formatNumber(stats.cargoCapacity)}</span>
                        <span class="ship-stat">Speed: {stats.transitSpeedMult.toFixed(1)}×</span>
                        <span class="ship-stat">Yield: {stats.extractionYieldMult.toFixed(2)}×</span>
                      </div>

                      <!-- Module slots: inert pips, one per moduleSlots. Purely
                           decorative this pass (no module system), the quiet
                           "unlock with Research" note sets the expectation
                           without implying they do anything yet. Array.from is
                           used (not a bare {length} object) since {#each} needs a
                           real iterable, same as the locked-captain-slots loop. -->
                      <div class="ship-modules">
                        <span class="ship-modules-label">Modules:</span>
                        {#each Array.from({ length: def.moduleSlots }) as _, mi}
                          <span class="ship-module-pip" title="Module slot, unlocks with Research"></span>
                        {/each}
                        <span class="ship-modules-note">unlock with Research</span>
                      </div>

                      <!-- ONE control per row, three cases (see the coordinator's
                           corrected design):
                           1. PARKED -> "Assign ▾": pick an IDLE captain. Disabled
                              (no picker) when there are no idle captains, since
                              assignShipToCaptain would fail on an on-mission
                              target anyway.
                           2. ASSIGNED + captain IDLE -> "Swap ▾": pick a PARKED
                              ship to give that captain. Disabled when there are
                              no parked ships to swap in.
                           3. ASSIGNED + captain ON-MISSION -> disabled "Swap ▾"
                              with the recall-first reason. -->
                      {#if assignedCaptain === null}
                        <button
                          class="dev-btn ship-assign-btn"
                          disabled={idleCaptains.length === 0}
                          title={idleCaptains.length === 0 ? "No idle captain, recall one first" : undefined}
                          on:click={() => openAssignPicker(ship.id)}
                        >
                          Assign ▾
                        </button>
                      {:else if onMission}
                        <button class="dev-btn ship-assign-btn" disabled title="On a mission, recall first">
                          Swap ▾
                        </button>
                      {:else}
                        <button
                          class="dev-btn ship-assign-btn"
                          disabled={parkedShips.length === 0}
                          title={parkedShips.length === 0 ? "No spare ship, buy or free one" : undefined}
                          on:click={() => openSwapPicker(assignedCaptain.id)}
                        >
                          Swap ▾
                        </button>
                      {/if}

                      <!-- Ship Systems (0.11.0): opens the real install/uninstall
                           screen for THIS hull. Always enabled, it works for a
                           PARKED ship (no captain) too, since fitment only locks
                           mid-mission (the on-mission gate is enforced inside the
                           panel, not here). Same .ship-assign-btn look as the
                           assign/swap control above so the row reads as one set. -->
                      <button
                        class="dev-btn ship-assign-btn"
                        on:click={() => openShipSystems(ship.id)}
                      >
                        Ship Systems
                      </button>

                      <!-- SALVAGE (0.11.0 ship-salvage): break this hull down for a fraction
                           of its build cost (materials + credits back, crafted systems return
                           to the spare pool). Routes through the SAME salvage confirmation
                           modal as the system/material salvages (requestSalvage("ship", ...)).
                           DISABLED for an on-mission ship (its captain is out flying, so the
                           hull can't be torn down, salvageShip enforces the SAME lock), with
                           the reason surfaced in the title. INSTANT this patch; a future task
                           makes hull teardown a timed process (see salvage.ts). -->
                      <button
                        class="dev-btn ship-assign-btn danger"
                        disabled={onMission}
                        title={onMission ? "On a mission, recall first" : "Break down this hull for parts"}
                        on:click={() => requestSalvage("ship", ship.id, def.label)}
                      >
                        Salvage
                      </button>
                    </div>
                  {/each}
                </div>
              </Panel>
            {/if}
          {/if}
        </div>
      </div>
      </div>
      {/if}

      {#if activeTab === "stores"}
      <!-- STORES program (0.11.2 nav restructure, Task 3): holds the
           storage/inventory facilities. This pass it contains only the
           Warehouse (moved VERBATIM out of the now removed Facilities tab); a
           Salvage Bay facility joins it in a later task. Same shell as the
           Foundry / Drydock tabs (tab-scroll-area > fleet-captains-layout >
           captain-list rail + fleet-captains-content). Uses a DEDICATED
           activeStoresFacility rail state. This is an information-architecture
           move, not a redesign: the moved rail entry and content pane are
           unchanged except that their guard variable was retargeted to
           activeStoresFacility. -->
      <div class="tab-scroll-area">
      <div class="fleet-captains-layout">
        <div class="captain-list">
          <!-- Stores rail: Warehouse (the fill-tile inventory catalog, moved
               from the Facilities tab) + Salvage Bay (0.11.2 Task 11, the
               dedicated home for the ship-system + salvaged-material Salvage
               actions relocated out of the Warehouse). Same .captain-list-item
               idiom; only class:active / on:click drive activeStoresFacility. -->
          <button
            class="captain-list-item"
            class:active={activeStoresFacility === "warehouse"}
            on:click={() => (activeStoresFacility = "warehouse")}
          >
            Warehouse
          </button>
          <button
            class="captain-list-item"
            class:active={activeStoresFacility === "salvageBay"}
            on:click={() => (activeStoresFacility = "salvageBay")}
          >
            Salvage Bay
          </button>
        </div>

        <div class="fleet-captains-content">
          {#if activeStoresFacility === "warehouse"}
            <!-- WAREHOUSE (Phase 2, Group C), the fill-tile inventory catalog.
                 Mirrors the Refinery's SubTabs + content structure above, but the
                 SubTabs axis is CATEGORY: Overview + Upgrade (management views)
                 then one tab per item-category group. Each catalog tab groups its
                 ITEMS by tier into tier-panels of fill-tiles that read LIVE
                 inventory/discovered/cap state (so fills move as you gather). All
                 upgrade actions/gates read the SAME tick.ts backend fns the
                 Refinery uses (tierCap / materialAtCap / canBuildFacilityUpgrade /
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
                      {@const have = itemTotal(state.inventory, itemId)}
                      {@const met = have.gte(need)}
                      <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                        {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}
                      </div>
                    {/each}

                    {#if isUnlockRung}
                      <p class="research-status" style="margin-top: 6px;">
                        Unlocks {wt.label} storage. Its first expansion needs a Tier-{wt.tier} material you can't reach yet.
                      </p>
                    {/if}

                    <button
                      class="buy-btn"
                      disabled={!check.ok}
                      title={check.ok ? undefined : check.reason}
                      on:click={() => doStartFacilityUpgrade(wt.key)}
                    >
                      {isUnlockRung ? `Unlock ${wt.label}` : "Expand · doubles capacity"}
                    </button>
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

            {#if activeWarehouseCat === "materials"}
              <!-- MATERIALS (0.11.2 Task 9). ONE scrollable pane: a Tier
                   selector, then a fixed series of themed labeled sections. Each
                   section reuses the SAME fill-tile grid the old flat catalog tabs
                   used (fill / rarity color / ❓-mask / count / showWarehouseTooltip),
                   rendering its items AT the selected tier. Raw items partition
                   across the first four sections by their subCategory. Sections
                   with no items at the selected tier are hidden. Salvaged Materials
                   is the final section and keeps its select-to-salvage tiles. -->
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
                    Tier {activeMaterialsTier} storage locked, <b>unlock in the Upgrade tab</b>{#if unlockRung && unlockIds.length > 0} ({formatNumber(unlockRung.materials[unlockIds[0]])} [{ITEMS[unlockIds[0]]?.label ?? unlockIds[0]}]){/if}.
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

                <!-- SALVAGED MATERIALS section (final). BROWSE-ONLY (0.11.2
                     Task 11): the tiles still SHOW held salvaged materials for
                     reference, but the select-to-salvage interaction and its
                     Salvage action panel were relocated to the Salvage Bay
                     facility (Stores rail). So each tile is a non-interactive
                     <div> now (no on:click / no class:selected), keeping the
                     exact systems-tile visual (rarity dot + code + corner count). -->
                {#if materialsSalvagedItems.length > 0}
                  <div class="warehouse-tier materials-section">
                    <div class="warehouse-tier-head">
                      <span class="warehouse-tier-label">Salvaged Materials</span>
                      <span class="warehouse-tier-line"></span>
                      <span class="warehouse-tier-cap">{materialsSalvagedItems.length} material{materialsSalvagedItems.length === 1 ? "" : "s"}</span>
                    </div>
                    <div class="warehouse-grid">
                      {#each materialsSalvagedItems as item (item.id)}
                        {@const count = itemTotal(state.inventory, item.id)}
                        <!-- Reuse the systems-tile visual (rarity dot + code + corner
                             value), painting the count in the corner where a system's
                             quality would sit. Rarity color via warehouseRarityColor
                             (item rarity, not equipment rarity). Browse-only div,
                             not a button: salvage lives in the Salvage Bay now. -->
                        <div
                          class="systems-tile readonly"
                          style="--sys-rc: {warehouseRarityColor(item.rarity)};"
                          title={`${item.label} · ${item.rarity}`}
                        >
                          <span class="systems-tile-dot"></span>
                          <span class="systems-tile-code">{item.label.split(" ").slice(-1)[0]}</span>
                          <span class="systems-tile-q">{formatNumber(count)}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </Panel>
            {/if}

            {#if activeWarehouseCat === "finishedGoods"}
              <!-- FINISHED GOODS (0.11.2 Task 10). Split into product families by
                   a secondary SubTabs strip: Ship Systems is the ONE real,
                   populated family (the state.equipment spare-systems bay, moved
                   here in Task 9); Weapons / Modules / Consumables are RESERVED
                   roadmap slots (locked in FINISHED_GOODS_TABS, so SubTabs grays
                   them and blocks selection). Because they cannot be selected while
                   locked, their reserved-note branches below are LATENT: not shown
                   today, they surface automatically the day a family is unlocked
                   (flip its locked flag to false) so combat can drop weapons/modules
                   into a ready home without new markup. This deliberately differs
                   from the mission-tier locked SubTabs (which render nothing when a
                   locked tier is active); here the reserved note is worth pre-wiring.
                   Salvaged Materials is intentionally NOT here, Task 9 moved it into
                   the Materials tab; no duplication. -->
              <SubTabs
                tabs={FINISHED_GOODS_TABS}
                active={activeFinishedGoodsTab}
                onSelect={(key) => (activeFinishedGoodsTab = key as FinishedGoodsTab)}
              />

              {#if activeFinishedGoodsTab === "shipSystems"}
              <!-- SHIP SYSTEMS BAY (Equipment 0.11.0 Phase D). The tiled,
                   non-stacking equipment inventory: one tile per spare
                   EquipmentInstance, grouped by slot type, plus the Systems Bay
                   capacity header (spare / cap readout) + "Upgrade Bay" action.
                   Selecting a tile surfaces the reusable EquipmentTooltip inline
                   below the grid; a spare CRAFTED system's tooltip carries a
                   Salvage action. All reads/actions go through the SAME engine
                   helpers the fabricate gate + storage engine use
                   (spareEquipmentCount / equipmentStorageCap /
                   canUpgradeEquipmentStorage / startEquipmentStorageUpgrade /
                   salvageEquipment), so the UI can't drift from the backend. The
                   bay markup below is UNCHANGED from the Task 9 interim placement,
                   only wrapped in the Ship Systems family conditional. -->
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
                  <button
                    class="buy-btn systems-bay-upgrade"
                    disabled={!upgradeCheck.ok}
                    title={upgradeCheck.ok ? undefined : upgradeCheck.reason}
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
                   BROWSE-ONLY here (0.11.2 Task 11): the Warehouse shows a spare
                   system's stats but hosts NO Salvage action. Breaking a spare
                   system down now lives in the Salvage Bay facility (Stores rail),
                   so no action children are passed to EquipmentTooltip here. -->
              {#if selectedSystem}
                {@const sys = selectedSystem}
                <Panel>
                  <EquipmentTooltip piece={sys} />
                </Panel>
              {/if}
              {:else if activeFinishedGoodsTab === "weapons"}
                <!-- RESERVED: Ship Weapons. No engine, no inventory yet; combat
                     lands in a future update (0.12.0). Honest note only, styled
                     with the same warehouse-stub glyph card the empty bay uses. -->
                <Panel>
                  <div class="warehouse-stub">
                    <div class="warehouse-stub-glyph">🔒</div>
                    <p>Ship Weapons: reserved for a future update (combat). Nothing to store here yet.</p>
                  </div>
                </Panel>
              {:else if activeFinishedGoodsTab === "modules"}
                <!-- RESERVED: Modules. Roadmap slot, no engine yet. -->
                <Panel>
                  <div class="warehouse-stub">
                    <div class="warehouse-stub-glyph">🔒</div>
                    <p>Modules: reserved for a future update. Nothing to store here yet.</p>
                  </div>
                </Panel>
              {:else if activeFinishedGoodsTab === "consumables"}
                <!-- RESERVED: Consumables. Roadmap slot, no engine yet. -->
                <Panel>
                  <div class="warehouse-stub">
                    <div class="warehouse-stub-glyph">🔒</div>
                    <p>Consumables: reserved for a future update. Nothing to store here yet.</p>
                  </div>
                </Panel>
              {/if}
            {/if}

          {:else if activeStoresFacility === "salvageBay"}
            <!-- SALVAGE BAY (0.11.2 Task 11): the dedicated home for the two
                 Salvage actions relocated out of the Warehouse. NOTHING here is
                 new machinery or new styling; it reuses the SAME tiles,
                 EquipmentTooltip, select state, and requestSalvage/confirmSalvage
                 flow the Warehouse hosted before. Two labeled sections:
                   1. Ship Systems, the spare-systems bay tiles + the inline
                      EquipmentTooltip whose action slot carries the Salvage
                      button (requestSalvage("system", ...)). The Systems Bay
                      CAPACITY readout + Upgrade Bay action stay in the Warehouse
                      (Finished Goods), which remains the storage-management home;
                      here it is salvage only.
                   2. Salvaged Materials, the select-to-salvage tiles + the inline
                      Salvage action panel (requestSalvage("material", ...)) over
                      the whole salvaged catalog (salvageBaySalvagedItems, no tier
                      selector). Ship teardown (requestSalvage("ship", ...)) is a
                      Drydock action and deliberately NOT relocated here. -->
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
                 success and the clear reactive resets when leaving the bay. Reuses
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
                 the Warehouse Ship Systems bay). Selecting a tile surfaces the
                 EquipmentTooltip below with a Salvage action for crafted spares.
                 Reads baySystemGroups / selectedSystemId / selectSystemTile, the
                 same shared state the Warehouse uses. -->
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
                 inline. A spare crafted system gets a Salvage button in the
                 tooltip's action slot (routes through requestSalvage("system", ...)
                 -> the shared confirm modal); baselines get NONE (nothing to
                 refund). SAME block the Warehouse Ship Systems tab hosted before
                 Task 11 relocated it here. -->
            {#if selectedSystem}
              {@const sys = selectedSystem}
              <Panel>
                <EquipmentTooltip piece={sys}>
                  {#if selectedIsSalvageable}
                    <button
                      class="buy-btn systems-salvage-btn"
                      on:click={() => requestSalvage("system", sys.id, systemSalvageName(sys))}
                    >
                      Salvage
                    </button>
                  {:else}
                    <span class="systems-salvage-none">Standard-Issue baseline, nothing to salvage.</span>
                  {/if}
                </EquipmentTooltip>
              </Panel>
            {/if}

            <!-- SALVAGED MATERIALS salvage: the select-to-salvage tiles over the
                 whole salvaged catalog (salvageBaySalvagedItems, all tiers, no
                 tier selector). SAME systems-tile visual + select idiom the
                 Warehouse Materials tab used before Task 11 made those tiles
                 browse-only. -->
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
                 event log. SAME block the Warehouse Materials tab hosted before
                 Task 11 relocated it here. -->
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

          {/if}
        </div>
      </div>
      </div>
      {/if}

      {#if activeTab === "fleetCaptains"}
      <SubTabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "talents", label: "Talents" },
          { key: "fleetCaptainLocked1", label: "Coming Soon!", locked: true },
          { key: "fleetCaptainLocked2", label: "Coming Soon!", locked: true },
        ]}
        active={activeFleetCaptainSubTab}
        onSelect={(key) => (activeFleetCaptainSubTab = key as FleetCaptainSubTab)}
      />

      <div class="tab-scroll-area">
      <div class="fleet-captains-layout">
        <div class="captain-list">
          {#each state.captains as captain, i}
            <button class="captain-list-item" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
              {captain.label}
            </button>
          {/each}
          <!-- Empty slots up to a roadmap max of 10 captains, split two ways
               (Progression Pacing Rework, Task 11 relabel):
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
              class="captain-list-item locked"
              title={isUnlockable
                ? "Locked, recruit via Homeworld Talents → Fleet Logistics"
                : "Coming soon, not yet unlockable"}
            >
              {#if isUnlockable}🔒 Locked{:else}🔒 Coming Soon!{/if}
            </div>
          {/each}
        </div>

        <div class="fleet-captains-content">
          {#if activeFleetCaptainSubTab === "overview"}
            <!-- Captain Leveling (Task 8, Phase 4; relocated into the Fleet
                 Captain's tab's Overview sub-tab during the UI Redesign,
                 Task 8, see docs/plans/2026-07-07-ui-redesign-plan.md) --
                 per-captain-scoped (reads activeCaptain, not the whole
                 fleet), replacing the spot Captain Prestige used to occupy.
                 The old Unlock section here (spending a captain's own
                 level/statPoints/Components to add a new captain slot) was
                 removed in Task 4 of
                 docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md
                , captain slot growth is now purchased fleet-wide through
                 the Homeworld Talents panel's Fleet Logistics branch
                 instead. The "Currently: Idle" / "Currently on: ..." line
                 below is new in the UI Redesign, the MISSIONS panel itself
                 (dispatch/recall UI) does NOT live here; it moved to the
                 Fleet Operations tab (Task 9) instead. -->
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
                {:else}
                  Currently on: {MISSIONS[activeCaptain.mission.missionKey].label}
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
          {:else if activeFleetCaptainSubTab === "talents"}
            <!-- Captain Talents (Task 6, Captain & Homeworld Talent Trees;
                 relocated into the Fleet Captain's tab's Talents sub-tab
                 during the UI Redesign, Task 8), per-captain-scoped, like
                 Captain Leveling above (reads activeCaptain, not the whole
                 fleet), spends THIS captain's own statPoints, records the
                 unlock on THIS captain only
                 (activeCaptain.unlockedCaptainTalents), never touches any
                 other captain's state. Iterates the FIXED 5-branch list, not
                 Object.keys(CAPTAIN_TALENTS), so Tactical/Science/Diplomacy
                 (currently zero entries, see model.ts) still render as
                 labeled, empty columns rather than not appearing at all. -->
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
          {/if}
        </div>
      </div>
      </div>
      {/if}

      {#if activeTab === "fleetOperations"}
      <!-- Operations program (0.11.2 nav restructure, Task 5): a top-level
           <SubTabs> axis splits this tab into Dispatch (the existing mission
           dispatch UI below) and Mission Control (the mission-unlock facility
           moved VERBATIM out of the Facilities tab). Defaults to Dispatch via
           activeOperationsSubTab so the tab opens on dispatch exactly as it did
           before Mission Control joined it. Same <SubTabs> idiom as the Fleet
           Captain's / Refinery axes. -->
      <SubTabs
        tabs={[
          { key: "dispatch", label: "Dispatch" },
          { key: "missionControl", label: "Mission Control" },
        ]}
        active={activeOperationsSubTab}
        onSelect={(key) => (activeOperationsSubTab = key as OperationsSubTab)}
      />

      {#if activeOperationsSubTab === "dispatch"}
      <div class="tab-scroll-area">
      <!-- Fleet Operations Mission UI (2026-07-07 --
           docs/plans/2026-07-07-fleet-operations-mission-ui-plan.md, Task 4) --
           replaces the old flat one-Panel-per-mission loop (UI Redesign, Task
           9) with a category-list + tier-tabs + mission-card flow, mirroring
           .fleet-captains-layout/.captain-list/.captain-list-item's visual
           language directly above under the "fleetCaptains" tab. Only
           "resourceGathering" has real content today (Patrol/Surveying/
           Long-Term Exploration are locked placeholders, see
           activeMissionCategory's declaration comment above). Within
           Resource-Gathering, only Tier I is real (both shortOreRun and
           longOreRun, see model.ts's MissionDef.tier field); Tiers II-V are
           locked SubTabs entries. Dispatch no longer happens inline here --
           clicking an available mission card calls openMissionPopup, which
           sets missionPopupKey/missionPopupCaptainId (declared near
           deleteModalOpen). The popup markup that consumes that state and
           performs the dispatch through the existing
           doDispatchCaptainOnMission lives near the DELETE SAVE modal,
           further down this same template (Task 5). -->
      <div class="fleet-ops-layout">
        <div class="mission-category-list">
          <button
            class="mission-category-item"
            class:active={activeMissionCategory === "resourceGathering"}
            on:click={() => (activeMissionCategory = "resourceGathering")}
          >
            Resource-Gathering
          </button>
          <div class="mission-category-item locked" title="Coming soon, combat isn't built yet">
            🔒 Patrol Missions
          </div>
          <div class="mission-category-item locked" title="Coming soon, not yet available">
            🔒 Surveying
          </div>
          <div class="mission-category-item locked" title="Coming soon, not yet available">
            🔒 Long-Term Exploration
          </div>
        </div>

        <div class="mission-category-content">
          {#if activeMissionCategory === "resourceGathering"}
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
              {@const embarked = state.captains.filter((c) => c.mission !== null && tierIMissions.some(([key]) => key === c.mission!.missionKey))}

              {#if embarked.length > 0}
                <div class="panel-title">IN PROGRESS</div>
                {#each embarked as captain}
                  {@const mission = captain.mission!}
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
                    <button class="mission-card mission-card-selectable" on:click={() => openMissionPopup(missionKey)}>
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
                               stored qty / flavor / this mission's drop chance).
                               These icons are SPANS, not buttons: this card is ITSELF a
                               button element (opens the dispatch popup), and a button may not
                               nest a button. on:click|stopPropagation shows the tooltip
                               WITHOUT also opening the popup; keyboard users reach the same
                               drops as focusable buttons inside that popup. Chances passed
                               are the mission's BASE chances (this card is captain-agnostic;
                               the popup applies the selected captain's modifiers). -->
                          <div class="drops-row">
                            {#each missionDropTiers(loot, missionDef.uncommonChance, missionDef.rareChance) as drop (drop.key)}
                              {@const dropItem = ITEMS[drop.key]}
                              {#if dropItem}
                                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions, INTENTIONAL: this icon is a span, not a button, because it lives inside the card's own button (a button may not nest a button) and stopPropagation keeps a tap from opening the popup. Keyboard/AT users get the SAME drops as real, focusable buttons in the dispatch popup, so no interaction is lost. -->
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
                    </button>
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
          {/if}
        </div>
      </div>
      <!-- Battlespace section (0.11.2 Shell Correction, Task 5): the former
           standalone Battlespace tab, MOVED VERBATIM to sit BELOW the mission
           dispatch UI inside this same .tab-scroll-area, so it reads as a
           separate section under the missions and scrolls with the Dispatch
           view. No divider element is added: .tab-scroll-area's own flex-
           column gap:14px already spaces this Panel off the .fleet-ops-layout
           block above (the same idiom that spaces every stacked panel), and
           the Panel's own "BATTLESPACE" panel-title labels the section. The
           Battlespace nav-tab and its standalone {#if activeTab ===
           "battlespace"} region are removed; Battlespace lives only here now. -->
      <Panel>
        <div class="panel-title">BATTLESPACE</div>
        <p class="prestige-text">PvP and PvE fleet operations will live here.</p>
        <!-- Expanded from a single generic "Coming Soon" line to 4 named
             locked options (mid-plan extra task, 2026-07-07), reuses
             .captain-list-item.locked as-is (same class/markup as the locked
             captain slots under Fleet Captain's, above) rather than
             introducing .mission-category-item, since that class belongs to
             the separate, still-in-flight Fleet Operations mission-category
             rebuild and doesn't exist in this file yet. .captain-list-item
             has no standalone stacking/gap behavior of its own, it normally
             relies on its usual parent .captain-list (display:flex;
             flex-direction:column; gap:2px) for that, so .battlespace-
             locked-list below reproduces just that same flex/gap pairing
             as a tiny scoped class, without duplicating any of
             .captain-list-item's own visual rules. -->
        <div class="battlespace-locked-list">
          <div class="captain-list-item locked" title="Coming soon, not yet available">🔒 Fleet Skirmishes</div>
          <div class="captain-list-item locked" title="Coming soon, not yet available">🔒 Campaign</div>
          <div class="captain-list-item locked" title="Coming soon, not yet available">🔒 Fleet Exercises</div>
          <div class="captain-list-item locked" title="Coming soon, not yet available">🔒 Invasion</div>
        </div>
      </Panel>
      </div>
      {/if}

      {#if activeOperationsSubTab === "missionControl"}
      <!-- Mission Control (mission-unlock facility) moved VERBATIM here from the
           Facilities tab (0.11.2 nav restructure, Task 5). Its inner Overview /
           Upgrades <SubTabs> and both Panel bodies are unchanged; only the pane's
           outer guard changed from activeFacility to activeOperationsSubTab, and
           it now sits in its own .tab-scroll-area (every tab/sub-view wraps its
           panel content in exactly one). The rail button it had in Facilities is
           gone; the top-level Operations <SubTabs> entry selects it now. -->
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
                    {@const have = itemTotal(state.inventory, itemId)}
                    {@const met = have.gte(need)}
                    <div class="research-cost" style="color: {met ? 'var(--color-success)' : 'var(--color-danger)'}">
                      {met ? "✅" : "❌"} [{ITEMS[itemId]?.label ?? itemId}]: {formatNumber(have)} / {formatNumber(need)}
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
                       "why not" title when disabled. -->
                  <button
                    class="buy-btn"
                    disabled={!missionControlUpgradeCheck.ok}
                    title={missionControlUpgradeCheck.ok ? undefined : missionControlUpgradeCheck.reason}
                    on:click={() => doStartFacilityUpgrade("missionControl")}
                  >
                    Build · Level {missionControlLevel} → {missionControlLevel + 1}
                  </button>
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
      <!-- Home (0.12.0 "Console" nav, Task CN1, the PATTERN-SETTER). The old
           left rail is removed. Home lands on a console OVERVIEW: a welcome
           heading plus a grid of buttons. Tapping a button SUMMONS its panel IN
           PLACE, activeHomePanel swaps the overview content for the panel and a
           .console-back control returns to the overview (sets it back to null).
           This overview + summoned-panel structure is the copyable template for
           every other perspective; see the .console-* CSS block for the shared
           layout (full-width on desktop, tight grid on mobile). The Help and
           Statistics panel bodies below are the 0.11.2 content moved VERBATIM,
           only their surrounding nav chrome changed. -->
      <div class="tab-scroll-area">

        {#if activeHomePanel === null}
        <!-- OVERVIEW: the console landing. A welcome Panel plus the button grid.
             Kept intentionally lean (the design warns against overloading an
             overview into a new kind of clutter); at-a-glance readouts can be
             added here later without touching the summon mechanism. -->
        <div class="console-overview">
          <Panel>
            <div class="panel-title">COMMAND HOME</div>
            <p class="prestige-text">Welcome, Admiral. This is your command home, the whole game at a glance. Open a console below.</p>
          </Panel>

          <!-- Button grid summons a panel in place. Live buttons flip
               activeHomePanel; the reserved meta buttons stay inert locked
               affordances (same honest "coming soon" crimson locked idiom the
               System / Battlespace slots use), title attr is the affordance. -->
          <div class="console-nav-grid">
            <button class="console-nav-button" on:click={() => (activeHomePanel = "help")}>Help</button>
            <button class="console-nav-button" on:click={() => (activeHomePanel = "statistics")}>Statistics</button>
            <div class="console-nav-button locked" title="Coming soon, not yet available">🔒 Achievements</div>
            <div class="console-nav-button locked" title="Coming soon, not yet available">🔒 Completion</div>
            <div class="console-nav-button locked" title="Coming soon, not yet available">🔒 Leaderboards</div>
          </div>
        </div>
        {/if}

        {#if activeHomePanel === "help"}
        <!-- HELP panel, summoned. Content moved VERBATIM from the 0.11.2 Home
             Help section: its own nested topic rail (.fleet-captains-layout /
             .captain-list, part of Help's OWN content, not the removed
             perspective rail) drives the topic body from HELP_TOPICS
             (helpTopics.ts), rendered as PLAIN text. Selection still tracked by
             activeHelpTopic. Only the .console-back chrome around it is new. -->
        <div class="console-panel">
          <button class="console-back" on:click={() => (activeHomePanel = null)}>Back to Overview</button>
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
        </div>
        {/if}

        {#if activeHomePanel === "statistics"}
        <!-- STATISTICS panel, summoned. Content moved VERBATIM from the 0.11.2
             Home Statistics section: a top <SubTabs> axis (Lifetime / Career /
             Fleet) selects which group of deriveStatistics(state) rows to show,
             a pure read over EXISTING save fields (no new counters, no economy
             or tick changes). Selection still tracked by activeStatsSubTab.
             Only the .console-back chrome around it is new. -->
        <div class="console-panel">
          <button class="console-back" on:click={() => (activeHomePanel = null)}>Back to Overview</button>
          <SubTabs
            tabs={[
              { key: "lifetime", label: "Lifetime" },
              { key: "career", label: "Career" },
              { key: "fleet", label: "Fleet" },
            ]}
            active={activeStatsSubTab}
            onSelect={(key) => (activeStatsSubTab = key as StatsSubTab)}
          />

          {#if activeStatsSubTab === "lifetime"}
          <Panel>
            <div class="panel-title">LIFETIME</div>
            {#each stats.lifetime as row}
              <div class="stat-row">
                <span class="stat-row-label">{row.label}</span>
                <span class="stat-row-value">{row.value}</span>
              </div>
            {/each}
          </Panel>
          {/if}

          {#if activeStatsSubTab === "career"}
          <Panel>
            <div class="panel-title">CAREER</div>
            {#each stats.career as row}
              <div class="stat-row">
                <span class="stat-row-label">{row.label}</span>
                <span class="stat-row-value">{row.value}</span>
              </div>
            {/each}
          </Panel>
          {/if}

          {#if activeStatsSubTab === "fleet"}
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
          <SubTabs tabs={systemModalTabs} active={activeSystemSubTab} onSelect={selectSystemSubTab} />
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
      <button class="nav-tab" class:active={activeTab === "fleetCaptains"} on:click={() => (activeTab = "fleetCaptains")}>Crew</button>
      <button class="nav-tab" class:active={activeTab === "fleetOperations"} on:click={() => (activeTab = "fleetOperations")}>Operations</button>
      <button class="nav-tab" class:active={activeTab === "foundry"} on:click={() => (activeTab = "foundry")}>Foundry</button>
      <button class="nav-tab" class:active={activeTab === "drydock"} on:click={() => (activeTab = "drydock")}>Drydock</button>
      <button class="nav-tab" class:active={activeTab === "stores"} on:click={() => (activeTab = "stores")}>Stores</button>
      <button class="nav-tab" class:active={activeTab === "homeworld"} on:click={() => (activeTab = "homeworld")}>Homeworld</button>
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
              <button class="dev-btn" on:click={() => doAssignShip(swapPickerCaptainId!, ship.id)}>{SHIP_TYPES[ship.typeKey].label}</button>
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
        onClose={closeShipSystems}
      />
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
          This will refund every Homeworld Talent's Admin Points (except unlocked captain slots, which stay
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
        <div class="warehouse-tooltip" style="left: {warehouseTooltip.x}px; top: {warehouseTooltip.y}px;" role="tooltip">
          <div class="warehouse-tt-name" style="color: {warehouseRarityColor(tip.rarity)}">{tip.label}</div>
          <div class="warehouse-tt-rarity" style="color: {warehouseRarityColor(tip.rarity)}">{tip.rarity}</div>
          <div class="warehouse-tt-row">
            <span>Stored</span>
            <span class="warehouse-tt-v">{formatNumber(tipCount)}</span>
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
  /* Quiet owner-group label in the Facilities rail (2026-07 Locations-merge
     follow-up), a small uppercase muted caption, NOT a button. Extra top
     margin on any header after the first opens a little air between groups
     without needing a wrapper element. */
  .facility-owner-header {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-dim);
    padding: 2px;
  }
  .facility-owner-header:not(:first-child) { margin-top: 8px; }
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
  .captain-list-item.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .captain-list-item.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
  /* Battlespace's 4 locked placeholders (mid-plan extra task, 2026-07-07)
     reuse .captain-list-item.locked verbatim but sit inside a Panel, not
     .captain-list, this reproduces just that parent's flex/gap pairing so
     the reused items stack with the same thin 2px seam they'd get under
     .captain-list, without giving them .captain-list's fixed 96px width. */
  .battlespace-locked-list { display: flex; flex-direction: column; gap: 2px; }
  .fleet-captains-content { flex: 1; min-width: 0; }
  /* Console model (0.12.0 "Console" nav, established on Home as the
     PATTERN-SETTER). Each perspective lands on a .console-overview; buttons in
     .console-nav-grid SUMMON a panel in place; that panel opens with a
     .console-back control returning to the overview. No left rail. These rules
     are the copyable template the other four perspectives reuse verbatim, so
     they carry no Home-specific assumptions. Colors are the existing accent
     tokens only (no new colors), matching the crimson .captain-list-item look.
     Full-width by default: the overview and every panel are plain block flow
     inside .tab-body's own inset, so on desktop they fill the available width
     (never a narrow centered mobile column), while the button grid's
     auto-fill/minmax collapses to a tight 1-to-2-column layout on mobile to
     minimize scrolling. */
  .console-overview { display: flex; flex-direction: column; gap: 12px; }
  .console-nav-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 8px;
  }
  .console-nav-button {
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 16px 12px;
    color: var(--color-text-secondary);
    font-size: 13px;
    letter-spacing: 0.05em;
    cursor: pointer;
    text-align: left;
  }
  .console-nav-button:hover:not(.locked) {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  /* Reserved meta buttons, inert (same honest "coming soon" role as the
     System / Battlespace locked slots). */
  .console-nav-button.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .console-nav-button.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
  /* Back affordance opening every summoned panel, a slim left-aligned button
     in the same accent idiom, returning the perspective to its overview. */
  .console-back {
    align-self: flex-start;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 8px 14px;
    margin-bottom: 12px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
  }
  .console-back:hover {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .console-panel { display: flex; flex-direction: column; }
  /* Fleet Operations tab layout (2026-07-07 Fleet Operations Mission UI,
     Task 6), mirrors .fleet-captains-layout/.captain-list/
     .captain-list-item directly above verbatim in spirit: flat,
     square-cornered panel look with a thin 2px gap between stacked items
     (2026-07-07 button-style pass), not a new visual language. Left-hand
     .mission-category-list is a bit wider (140px vs .captain-list's 96px)
     since "Long-Term Exploration" is a longer label than any captain name. */
  .fleet-ops-layout { display: flex; gap: 12px; align-items: flex-start; }
  .mission-category-list { display: flex; flex-direction: column; gap: 2px; flex: 0 0 140px; }
  .mission-category-item {
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 10px 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .mission-category-item.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .mission-category-item.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mission-category-item.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
  .mission-category-content { flex: 1; min-width: 0; }
  .panel-title {
    font-size: 11px;
    letter-spacing: 1.5px;
    color: var(--color-accent);
    margin-bottom: 12px;
    font-weight: 600;
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
     signal (cf. .module-card.locked's opacity dim, .captain-list-item.locked).
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
  .dev-btn {
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: #fcd34d;
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
  }
  .dev-btn.active { background: rgba(251, 191, 36, 0.3); color: #fff; }
  .dev-btn.danger { color: var(--color-danger); }
  .dev-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  /* [DEV] Equipment panel only (dev-gated). Monospace readout text so the
     base -> fitted stat columns line up, and a subtle divider between per-ship
     blocks. New classes, no existing panel restyled. */
  .dev-readout-text { font-size: 11px; color: var(--color-text-secondary); font-family: monospace; }
  .dev-ship-block { border-top: 1px solid rgba(251, 191, 36, 0.2); padding-top: 8px; margin-top: 8px; }
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
    width: min(560px, 100%);
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
     (Task 5) with the same thin 2px gap as .captain-list/.mission-category-list
     above. Reuses .dev-btn as-is for each individual captain button (already
     flat-cornered from the 2026-07-07 button-style pass), this class only
     supplies the container's flex/gap, no new button style needed. */
  .modal-captain-list { display: flex; flex-direction: column; gap: 2px; margin: 10px 0; }
  /* Ships, Stats Foundation (Task 11 UI), Docks/Requisition ship rows.
     .ship-list/.ship-card mirror .module-list/.mission-card's flat, thin-
     border, panel-strong look verbatim in spirit (NOT a new visual language) --
     same padding/radius/background/border tokens, just a distinct class so ship
     rows can carry their own head/stats/modules sub-layout. All colors come
     from theme tokens (--color-accent-rgb / --color-accent / --color-text-*),
     so these repaint on every theme switch like every other element here. */
  .ship-list { display: flex; flex-direction: column; gap: 10px; }
  .ship-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .ship-card-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  /* Assignment badge, the flying captain's label (or "Parked"), and reused in
     Requisition for the price chip. .parked dims it to read as the quieter,
     available state, same opacity convention as other .locked/dim elements. */
  .ship-badge {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--color-accent-bright);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    padding: 2px 8px;
    white-space: nowrap;
  }
  .ship-badge.parked { color: var(--color-text-secondary); opacity: 0.7; }
  .ship-stats { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 8px; }
  .ship-stat { font-size: 12px; color: var(--color-text-secondary); font-family: var(--font-mono); }
  /* Inert module-slot pips, display-only (no module system this pass). Small
     accent-tinted squares, one per moduleSlots; the quiet note sets the
     "unlocks later" expectation without implying they're interactive. */
  .ship-modules { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .ship-modules-label { font-size: 11px; color: var(--color-text-secondary); }
  .ship-module-pip {
    width: 10px;
    height: 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    background: rgba(var(--color-accent-rgb), 0.1);
  }
  .ship-modules-note { font-size: 10px; color: var(--color-text-dim); font-style: italic; margin-left: 4px; }
  /* Assign/Swap control, reuses .dev-btn's flat look as-is (same as the
     mission popup's captain picker buttons); this modifier only nudges the top
     margin so it sits clear of the modules row above. */
  .ship-assign-btn { margin-top: 2px; }
  /* (.ship-desc, the Requisition hull blurb's margin tweak, was removed in S4
     with the Requisition buy panel that was its only user.) */

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
  .systems-tile.readonly { cursor: default; }
  .systems-tile.readonly:hover { border-color: var(--color-border); }
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
