import Decimal from "break_infinity.js";
// Crafting Allocation Redesign (Task C2): the production-LINE shape lives in
// allocation.ts (C1's pure derived-allocation core). Imported here TYPE-ONLY so
// GameState.refineLines/fabricateLines can be typed as CraftLine[] with NO runtime
// dependency, allocation.ts imports the recipe registries FROM this file at
// runtime, and a value import back would create a cycle; `import type` is erased at
// compile time, so there is no runtime import cycle.
// Crafting 0.13.3 (Phase 1 Unit 1.1) widens this same type-only import: a QUEUED craft
// order carries the recipe kind + run mode a LINE would be configured with, so the queue
// reuses allocation.ts's CraftLineKind / CraftLineMode rather than minting parallel unions
// that could drift from what startLine actually accepts. Still type-only (erased), so the
// no-runtime-cycle property above is unchanged.
import type { CraftLine, CraftOrder, CraftLineKind, CraftLineMode } from "./allocation";
// Quality rolls (Equipment 0.11.0, Phase 4, Task 9b): rollQuality's tier ceiling is the
// SAME quality-bucket range inventory.ts already owns (tiers 0..5, QUALITY_TIERS === 6).
// Imported so the roll and the storage share ONE source of truth for the ceiling rather
// than each hard-coding 5/6. inventory.ts imports nothing from this file, so this value
// import creates NO cycle (unlike the CraftLine type-only import above).
import { QUALITY_TIERS } from "./inventory";
// Material Lines ML-3: the rig line's per-unit climb chance (a leaf module: it imports nothing from model.ts).
import { materialQualityClimbChance, type MaterialPreference } from "./materialQuality";
// E-CREW 0.14.0 (Task 21): the Constitution ramp leaf (imports only diminishing.ts; no cycle).
import { constitutionRamp, RAMP_SECONDS_PER_TICK } from "./constitutionRamp";
// Reactor fuel ladder (0.14.0, capture 2026-10-21): the fuel every Reactor Core blueprint takes (a leaf with no
// imports, so no cycle).
import { reactorCoreFuel } from "./reactorTech";
// E-MOD EM-5 (0.14.0): the universal module catalog leaf (imports only types; no cycle), read by equipmentStatMods for
// a Passive module's power output.
import { modulePowerOutput } from "./shipModules";
// Combat 0.13.0 (Phase 9b.5a): the persisted Patrol mission shape (PatrolMissionState,
// below) carries a player-chosen combat STANCE and the carry-state DRONE squadrons.
// Both types live in the combat/ layer. Imported TYPE-ONLY (erased at compile time)
// so model.ts gains NO runtime dependency on combat/ and no runtime import cycle is
// created (combat/ imports model at runtime; a value import back would cycle). This is
// a deliberate, type-only exception to the "model.ts never imports combat internals"
// note in combat/enemyHulls.ts: the discriminated mission union must NAME these shapes,
// but naming a type costs nothing at runtime. Same erased-import discipline as CraftLine.
import type { CombatStance } from "./combat/positioning";
// Combat 1.0 (Unit 2.1a): DroneRole joins the existing DroneSquadron type-only import so
// EquipmentInstance.droneRole (below) can name which squadron role a crafted drone pod deploys.
// Still a TYPE-ONLY (compile-erased) import, so model.ts gains NO runtime dependency on combat/
// drones and no import cycle appears (combat/drones imports only combat/positioning + combat/types
// at runtime, never model or itemgen). Same erased-import discipline as CombatStance/WeaponId.
import type { DroneSquadron, DroneRole } from "./combat/drones";
// Combat 0.13.0 (Phase 9b.5a): PatrolDef.hullPool references the pirate ENEMY hull
// roster by id. Type-only (erased) import, same discipline as CombatStance/DroneSquadron
// above: model.ts names the id union but takes no runtime dependency on combat/.
import type { PirateHullId } from "./combat/enemyHulls";
// Combat 1.0 (Unit 1.2): the weapon-roster id union, for EquipmentInstance.weaponType on a
// crafted weapon. TYPE-ONLY import (compile-erased), so no runtime cycle, same posture as the
// combat type imports above (combat/weapons imports only combat/types + statusEffects).
import type { WeaponId } from "./combat/weapons";
// Ground Operations (GO-8): the officers' combat PROFILE a ship-event run freezes at dispatch (crewOverlay.ts
// officerCombatProfile, folded at each event's wall hours). TYPE-ONLY import (compile-erased): no runtime cycle.
import type { OfficerCombatEntry } from "./crewOverlay";
// Field Kits FKR-6: the kit ids a gambit rule and a fight record name (type only; fieldKits.ts imports this module).
import type { FieldKitId } from "./fieldKits";
// G1-3: the short-range mission arm stores a roll and its cycle plan (types only; shortRange.ts imports this file).
import type { ShortRangeCyclePlan, ShortRangeRoll, ShortRangeTier } from "./shortRange";

// Data model, tech spec §1 (Data Model).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (and everything built on top of it, Research,
// Specializations, the Skill Tree, both Prestige tiers) has been retired in
// favor of the mission-based economy (below), a Homeworld crafting system
// (RECIPES/craftRecipe), and a captain XP/leveling system (xp/level/statPoints
// on CaptainState, xpForNextLevel below; the XP-awarding and level-up logic
// itself lives in tick.ts's tickCaptainMission). Captain slot growth is now
// handled by the Homeworld Talent Tree's Fleet Logistics branch (below) via
// buyHomeworldTalent's unlockCaptainSlot effect, the old level-gated
// CAPTAIN_SLOT_UNLOCKS table/unlockCaptainSlot() function it superseded were
// removed in docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md's
// Task 4.

// Only "resourcer" is real today. Modeled as a union (not a bare string) so
// Phase 3+'s combat-type ships slot in as a new literal without touching
// every existing call site that pattern-matches on this field.
export type ShipType = "resourcer";

// --- Ships, Stats Foundation (docs/plans/2026-07-09-ships-stats-foundation-*) ---
// A ship is a HULL with a stat profile, distinct from the captain flying it. The
// type vocabulary + SHIP_TYPES table are below; the fleet's live hulls live on
// GameState.ships, and a captain no longer carries a shipType, a ShipInstance
// knows its captain via assignedCaptainId (the single source of truth). The old
// `ShipType = "resourcer"` alias above is now unused by the live type model;
// it's left in place as harmless legacy (removing it is optional cleanup, out of
// this feature's scope).

// The design's "spec" families, a ship's role identity, mirroring the captain
// spec vocabulary (Prospector/Tactician/Explorer) so a hull and its intended
// pilot spec read the same. Modeled as a named union (not a bare string), same
// convention as ShipType/MissionTier above: a future family slots in as a new
// literal without touching every call site that pattern-matches on this field.
// "general" is its own family (the universal starter hull, spec-agnostic).
export type ShipSpec = "general" | "prospector" | "tactician" | "explorer";

// The keys of the SHIP_TYPES table, one per REAL hull built this pass. Kept as
// an explicit union (rather than `keyof typeof SHIP_TYPES`) so it can be
// referenced by ShipInstance below BEFORE the table literal is declared, and so
// the forward buckets are documented in the type itself.
export type ShipTypeKey =
  | "generalFreighter"
  | "prospectorHauler"
  | "prospectorRunner"
  | "prospectorMiner"
  // --- COMBAT HULLS (Combat 0.13.0, Phase 9a, design S3 / S8 / S19) --------------
  // The three v1 combat hull classes (tactician spec). Added this pass so the
  // combat sim can build REAL combatants from real hulls (see combat/bridge.ts's
  // COMBAT_DEFAULT_LOADOUT + shipToCombatant). Their combat stats (hullIntegrity /
  // shieldCapacity / shieldRecharge / weaponHardpoints) are now LIVE inputs to the
  // sim, no longer display-only like the economy hulls' reserved fields.
  // ⚠️ 9b SEAM: Shipyard build-gating + research for these hulls is NOT built here;
  // canBuildShip has no tier/research gate yet, so they currently appear as buildable
  // Shipyard cards (Phase 9b/progression adds the gate). Non-combat fields (cargo /
  // extraction / fuel) are deliberately MINIMAL for a warship (a warship hauls little).
  | "destroyer"
  | "battleship"
  | "carrier"
  // --- EXPLORER HULLS (0.14.0 Exploration Phase E0, design Part B: B.1 fantasy / B.2
  // stat mapping / B.4 power-grid archetype) ---------------------------------------
  // The three v1 EXPLORER-spec hulls (spec "explorer"), the fleet's long-range survey
  // family. They activate the (very large) explorer complement band that already sits
  // in commandStructure.ts (SPEC_BASE_TOTAL.explorer / SPEC_DIVISION_WEIGHTS.explorer)
  // with no hull using it. ALL THREE share the LOCKED glass-tank archetype (design B.4):
  // power-RICH, by far the longest RANGE (highest fuelCapacity in the fleet) + strongest
  // SHIELDS, better-than-normal CARGO, MORE module slots than any combat hull (the
  // explorer/science identity), TERRIBLE weapons (1 hardpoint, no drones), and a LOW /
  // frail hull (papier-mache once the shields drop). Their stats are FIRST-PASS TUNABLE.
  // ⚠️ DEFERRED (design I.6 / A.6 / B.3, NOT built here): a base-hull SENSORS stat (no
  // sensors field exists on ShipTypeDef; the explorer sensor advantage lands with the
  // sensor-consumer phase) and the B.3 power-allocation preset (fixed stats chosen for
  // E0). The REAL discovery-gated acquisition is a later phase (E4 research); for E0
  // these are ordinary blueprint-gated capital builds (see the SHIP_TYPES entries).
  | "orion"
  | "aurora"
  | "eir";

export interface ShipTypeDef {
  label: string;
  spec: ShipSpec;
  tier: number;                     // all real hulls = 1 this pass; Research raises later
  cargoCapacity: number;            // drives extraction-phase length (a later task)
  transitSpeedMult: number;         // divides transit ticks; >1 faster, <1 slower
  extractionYieldMult: number;      // scales per-extraction-tick loot
  // --- Fuel economy (Mission Rework Task 3, design §3) ---------------------------
  // TWO non-redundant fuel stats, both TUNABLE first-pass (real balancing at the
  // device-check stage, same launch-placeholder spirit as this table's other numbers):
  //   fuelCapacity  , the RANGE gate: the max fuel a hull can carry for ONE round
  //                     trip. A mission is reachable iff fuelCapacity >= fuelNeeded
  //                     (checked at dispatch by Task 5/7; NOTHING reads it yet this pass).
  //   engineEfficiency, a 0-BASED bonus that REDUCES fuel burn: fuelNeeded divides
  //                     the round-trip ticks by (1 + engineEfficiency), so 0 == the
  //                     baseline 1:1 cost and a higher value costs LESS fuel. Hulls carry
  //                     distinct base values now; engine-module bonuses that raise it are a
  //                     FORWARD system (design §3, explicitly deferred). See fuel.ts's
  //                     fuelNeeded for the formula this feeds.
  fuelCapacity: number;
  engineEfficiency: number;
  // E-MOD EM-5: the hull's SHARED module slots, read by the install gate (equipment.ts moduleSlotsFull) and the Armory:
  // it caps the universal modules AND the specUtility piece together (user M1 "Separate counts"); the bridge, quarters
  // and sensor keep their own slots. The module slot itself stays hidden until EM-7 (shipModules.ts UNIVERSAL_MODULES_LIVE).
  moduleSlots: number;
  equipmentSlots: number;           // forward bucket; counts finalized with equipment/reactor design
  // --- Combat / defense base stats (Ship Systems UI, 0.11.0) ---------------------
  // ⚠️ FIRST-PASS TUNABLE launch placeholders, and INERT this pass: combat behavior
  // is deferred to 0.12.0. Carried NOW so the Ship Systems screen's Defensive section
  // has real per-hull numbers to display from day one (base == fitted until defensive
  // gear + a combat loop exist). Same POPULATED-but-INERT spirit as moduleSlots and
  // the reserved EquipmentSlotType members: declared here so the table shape is stable
  // when 0.12.0's combat system lands, rather than bolted on later. NOTHING reads these
  // yet; the UI only prints them.
  //   hullIntegrity   , the hull's structural HP pool.
  //   shieldCapacity  , the deflector shield's absorb pool.
  //   shieldRecharge  , shield points regenerated per combat tick.
  //   weaponHardpoints, the number of weapon mounts this hull carries. Surfaced this
  //                     pass ONLY as display-only empty slots in the Ship Systems
  //                     weapons row (no weapon gear exists until 0.12.0).
  hullIntegrity: number;
  shieldCapacity: number;
  shieldRecharge: number;
  weaponHardpoints: number;
  // Combat 1.0 (Unit 2.2): drone-bay count, the MULTI-slot cap for installing drone pods. OPTIONAL:
  // non-zero only on a carrier (its built-in hangar bays, design S8); absent/0 on every other hull
  // (a destroyer/battleship carries no bays). Read by canFitEquipment (equipment.ts) as the pod cap.
  droneBays?: number;
  // (WR-4: the retired instant credit-buy `cost` field is gone; the user, 2026-10-16 credit sinks pass: "delete
  // the unused ShipTypeDef.cost". Acquisition runs only through the Shipyard build below.)
  // Shipyard (Phase 5, Task S1, design §6): the BILL OF MATERIALS + credits + build
  // TIME to CONSTRUCT this hull at the Shipyard. Acquisition now runs through timed
  // construction (the instant credit-buy `buyShip` was retired in S4), so every
  // real hull carries one. Shape:
  //   components  , fabricated-component ITEM ids -> integer counts, RESERVED at build
  //                   start (the derived-allocation model, S2) and consumed on completion.
  //                   Keyed on `string` (the ITEMS registry key), same forward-loose
  //                   posture as inventory / RECIPES inputs. Real component ids only
  //                   (frameSegment / powerCoupling / structuralAssembly).
  //   credits     , a flat credit cost, deducted ATOMICALLY at build start (S3).
  //   durationTicks-- base build length; the Shipyard's build-speed upgrades scale it (S3).
  // ⚠️ FIRST-PASS TUNABLE, these values are launch placeholders scaling roughly with the
  // hull (bigger cargo / faster = more components + credits + time), the SAME device-check
  // placeholder spirit as every other economy constant in this file. Retune at
  // the device checkpoint, NOT piecemeal.
  buildRecipe: { components: Record<string, number>; credits: number; durationTicks: number };
  description: string;
  // --- Research gate (Combat 0.13.0, Phase 9b: warship research gate) ------------
  // OPTIONAL build-gate: the BLUEPRINTS key that must be in state.researchedBlueprints
  // before this hull may be built. ABSENT (the default) = NO research gate, the hull is
  // free to build once the Shipyard is founded (every economy hull + the entry warship,
  // the destroyer). PRESENT = the hull is locked until its blueprint is researched at the
  // Research Lab, which is how the heavier warships (battleship / carrier) gate behind an
  // earned unlock. canBuildShip reads this as its `notResearched` content-availability gate
  // (placed right after `notFounded`), so an absent field simply skips that gate entirely.
  // Deliberately mirrors the "first tier free, later tiers gated" shape the freighter /
  // prospector economy lines already use (the destroyer is the combat line's free first tier).
  // The referenced blueprint is UNLOCK-ONLY (produces no craftable item, see BlueprintDef):
  // researching it grants build access, nothing is fabricated.
  requiresBlueprint?: string;
  // E-CREW (D7, design section 5.2): the away squads this hull fields, one entry per squad type with
  // its `teamType` and the member count per squad (`size`, 3 or 4: model.ts groundSquadSize reads it).
  // Every SHIP_TYPES entry lists a Security and a Science squad plus a Prospecting entry (fielded only by the hidden
  // Claim and Dig team kinds, prospecting squads design 2026-10-16).
  // How many squads a ship fields comes from ONE authority, `groundSquads` below (the team count) plus each
  // ship's team KINDS (groundComposition.ts); the v66 -> v67 migration reads its own frozen constants. (WR-4: the
  // per-type `count` field, unread since Squads SQ-2, is gone.) OPTIONAL so a hull without the data simply fields
  // no squads.
  awayTeams?: { teamType: AwayTeamType; size: number }[];
  // Squads SQ-1 (0.14.0, design docs/plans/2026-10-12-squads-and-subspace-telescope-design.md section 2.2; user
  // 2026-10-12 "DOUBLE EVERY HULL"): how many ground SQUADS this hull fields, grouped into TEAMS of 2 squads
  // (groundTeamCount = groundSquads / 2). 4 on every hull today (2 teams); bigger hulls get more later. Must be
  // EVEN (an odd value is a data error a test catches). The squad SIZE per type stays awayTeams[].size; the
  // team KINDS (Ground / Strike / Survey) decide how many squads of each type (groundComposition.ts).
  groundSquads: number;
  // G1-1 (Short-Range Missions, 0.14.0, plan docs/plans/2026-10-17-short-range-missions-plan.md section 3.4; user
  // 2026-10-19 call 6 "Affix, variety, hull, perk"): the hull's BASE guest quarters, the berths passengers ride in
  // (refugees, prisoners). Guests are NOT crew: they add nothing to the complement, take no crew stations and never
  // substitute for the cargo hold. Folded into ShipDerivedStats.colonistCapacity (shipDerivedStats). OPTIONAL: set
  // only on the transport-minded hulls (HULL_GUEST_QUARTERS); absent reads as 0.
  colonistCapacity?: number;
  // E-MOD EM-1 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 3.2; user P1 2026-10-17 "No
  // ship goes over"): the hull's OWN power generation, the base of the B.4 power grid. Each value sits at or above the
  // heaviest crafted loadout the hull can install today (the EM-0 census: emodGoldens.test.ts), so no live ship goes
  // over budget; the budget binds on modules and higher drive classes. Explorers run well above their census, the
  // power-rich identity (B.4). shipDerivedStats folds it into ShipDerivedStats.powerOutput.
  basePowerOutput: number;
  // FORWARD (not populated this pass): reactorTier?: number  // reactorTier <= tier; gates equip/module tiers
}

export type LootMaterialKey = "commonOre" | "uncommonMaterial" | "rareMaterial";

// Mission Rework (Task 1, docs/plans/2026-07-14-mission-rework-plan.md): the
// per-mission loot triad. Each mission's extraction roll is UNCHANGED in mechanic
//, it still rolls exactly one of three abstract rarity tiers (rare -> uncommon ->
// common fallback, see tick.ts's rollExtractionTick), but WHICH concrete ITEM
// each tier deposits is now per-mission, read off this table at delivery time
// instead of being hard-coded to commonOre/uncommonMaterial/rareMaterial. The three
// fields are ITEM registry keys (kept as `string`, the ITEMS registry is keyed on
// `string`, and a mission can point at any raw-material tier). Every mission MUST
// point its `common` at an ITEM whose rarity is "common", `uncommon` at "uncommon",
// and `rare` at "rare", the model.test.ts loot-triad test enforces this so a
// mistyped key cannot silently deposit a rarity-mismatched material.
export interface MissionLootTable {
  common: string;   // ITEM key deposited when the common (guaranteed-floor) tier wins
  uncommon: string; // ITEM key deposited when the uncommon tier wins
  rare: string;     // ITEM key deposited when the rare tier wins
}

// Superset of LootMaterialKey: the 3 mission-loot tiers plus the crafted-good
// tier the Homeworld crafting system (RECIPES, below) produces.
// homePlanet.storage is keyed on this wider type, both raw loot delivery
// (tick.ts's tick()) and crafting (tick.ts's craftRecipe()) read/write the
// SAME storage object, just different subsets of its keys.
// ITEM-MERGE (0.11.0 Task A1): `refinedMaterial` was retired from this union
// (folded into the forward-loose `titaniumIngot` inventory key). 0.11.0 cleanup
// (2026-07-20): the dead `components` ITEM was removed too (nothing produced or
// consumed it), so this union is now exactly LootMaterialKey. It stays a distinct
// alias because passiveTrickle's `material` field is typed on it and it documents
// the historical Homeworld storage set.
export type HomePlanetMaterialKey = LootMaterialKey;

export type MissionPhase = "ordersReceived" | "transitOut" | "extracting" | "transitBack" | "unloading";

// Display-only phase labels for a gathering mission's phase readout (0.13.1 DRY
// consolidation). PREVIOUSLY duplicated: a file-local const in App.svelte
// (MISSION_PHASE_LABEL) AND a verbatim mirror in homeDashboard.ts. Both drew the
// SAME labels, so a drift between them could only ever be a bug; hoisting the map
// here makes model.ts the SINGLE SOURCE both import. Must stay in sync with the
// MissionPhase union above: a phase added there without an entry here is a compile
// error (Record<MissionPhase, string> is exhaustive), which is the whole point of
// moving it next to the type it keys on.
export const MISSION_PHASE_LABEL: Record<MissionPhase, string> = {
  ordersReceived: "Orders Received",
  transitOut: "Transiting Out",
  extracting: "Extracting",
  transitBack: "Transiting Back",
  unloading: "Unloading",
};

// Named (not an inline union), matching this file's convention for every
// other small enum (ShipType, CaptainTalentBranch, HomeworldTalentBranch) --
// gives future consumers (e.g. a tier-badge component) something to import
// instead of re-typing the literal union.
export type MissionTier = "I" | "II" | "III" | "IV" | "V";

export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // total units/tick, regardless of which tier they land as
  cargoCapacity: number; // total units across all tiers; MUST divide evenly by extractionRatePerTick
  // for this launch's requiredTicksForPhase() to have no partial-final-tick
  // edge case, see that function's comment below if this is ever violated.
  // Per-tick occurrence chances (0-1) checked in sequential, mutually
  // exclusive priority order, rare first, then uncommon, then a guaranteed
  // common fallback (2026-07-08 Extraction Rework, see the design doc).
  // Exactly one tier wins per tick; see tick.ts's rollExtractionTick for the
  // exact algorithm and rng() call order.
  uncommonChance: number;
  rareChance: number;
  // Mission Rework (Task 1): the concrete ITEM keys this mission deposits per
  // rarity tier. The extraction roll picks an abstract tier; this table maps that
  // tier -> the mission's own material at delivery (tick.ts's tickCaptainMission).
  // See MissionLootTable above for the rarity-consistency contract.
  lootTable: MissionLootTable;
  // Phase 2 (Task B3, docs/plans/2026-07-13-phase-2-warehouse-refine-economy-
  // design.md §3.4): the ONE material that DEFINES this run for the warehouse
  // auto-stop mechanic. When this material is at its tier cap, the captain
  // running the mission idles (no run, no loot/XP/credits), see economyTick's
  // materialAtCap check in tick.ts.
  //
  // Mission Rework (Task 1): this is ALWAYS the mission's COMMON item, i.e.
  // `lootTable.common`, because the common tier is the GUARANTEED per-tick floor
  // drop (rollExtractionTick's final return when rare + uncommon both miss), so it
  // is the material the run reliably produces and thus the right auto-stop gate.
  // Widened from LootMaterialKey to `string` because a mission's common is now an
  // arbitrary ITEM key (e.g. "scrapAlloy"/"ferriteOre"), not just the 3 original
  // ore-tier keys. materialAtCap (tick.ts) already accepts any `string` itemId, so
  // no auto-stop code changed. The model.test.ts loot-triad test asserts
  // primaryMaterial === lootTable.common for every mission, so the two cannot drift.
  primaryMaterial: string;
  // Display-only grouping, drives which SubTabs tier a mission renders under
  // in the Fleet Operations tab (a follow-up UI feature). Has NO effect on
  // tick math whatsoever; purely a presentational label read by the UI layer.
  tier: MissionTier;
  // Exploration 0.14.0 (Phase E1a): flags a mission as a SENSOR-DRIVEN SURVEY. OPTIONAL, so
  // an ABSENT field reads as the default "extraction" (every pre-E1a mission omits it and is
  // byte-identical). A "survey" mission reuses the ENTIRE extraction transit/scan/return/deliver
  // machinery (it is still the extraction arm of the CaptainMissionState union, kind "extraction",
  // dispatched + resolved by the same path); the flag ONLY tells tickCaptainMission to scale the
  // survey's material yield by the ship's `sensors` derived stat (a bare / un-sensored ship reads
  // sensors 0 -> no bonus, so a survey at sensors 0 equals a plain extraction run). It is NOT a
  // MissionKind (that discriminates the mission-state UNION, extraction vs patrol); this is a
  // per-def BEHAVIOR tag within the extraction kind. First-pass: only survey missions set it.
  //
  // Exploration 0.14.0 (Phase E1b): "transport" is the second exploration behavior tag. A transport
  // is the COST-IN / REWARD-OUT supply run (design I.1 + the "E1 design decisions" note): it reuses
  // the ENTIRE extraction transit/scan/return/deliver machinery (still kind "extraction", dispatched
  // + resolved by the same path), but at each delivered cycle tickCaptainMission (a) SPENDS a
  // cargo-scaled CREDIT load cost and CREDITS it back plus a margin (net = a cargo-scaled credit
  // PROFIT per cycle, so a bigger hold + faster crew turnaround earn more), and (b) SUPPRESSES the
  // extraction loot deposit (a transport is a pure credit loop, NOT a mining run). A WORKING-CAPITAL
  // gate mirrors the material-at-cap idle: if the fleet cannot afford the load cost, the cycle idles
  // (no spend, no reward) and resumes automatically once credits recover. See supplyCostPerCargo +
  // rewardMargin below and tickCaptainMission's transport branch. ⚠️ DEFERRED (design I.1, do NOT
  // build here): the richer crafted-SUPPLIES-in loop (spend crafted materials instead of credits)
  // and the refugee / prisoner variants (refugees tie E5). E1b ships only the credit supply-run.
  missionType?: "extraction" | "survey" | "transport";
  // Exploration 0.14.0 (Phase E1b): the TRANSPORT economy, both OPTIONAL so every non-transport
  // mission omits them and is byte-identical (additive-neutral). Read ONLY when missionType is
  // "transport"; a survey/extraction mission never touches them. FIRST-PASS TUNABLE, same launch-
  // placeholder spirit as this file's other numbers (device-retuned later).
  //
  // supplyCostPerCargo: the CREDIT cost of the supplies loaded per unit of the ship's EFFECTIVE
  // cargoCapacity. tickCaptainMission computes loadCost = effectiveCargoCapacity * supplyCostPerCargo,
  // so a bigger hold (the Eir) loads more supplies -> a bigger run. The load cost is spent then
  // returned on delivery (net zero on the cost itself); only the margin below is new credits.
  supplyCostPerCargo?: number;
  // rewardMargin: the FRACTIONAL profit on the load (0.25 = a 25% margin). Net credits per delivered
  // cycle = loadCost * rewardMargin. This is the transport's whole reward (creditsPerCycle stays 0
  // for a transport, so there is no double-count with the flat per-cycle award extraction/survey use).
  rewardMargin?: number;
  // Flat Fleet Admiral XP awarded per WHOLE tick the mission is active (NOT per
  // completed cycle). Progression Pacing Rework (Task 5) moved Fleet Admiral XP
  // onto the SAME per-active-tick accrual captain XP already uses (Task 4): it is
  // now summed as fleetAdminXpPerTick * wholeTicksElapsed once per call, right
  // beside the captain-XP award in tickCaptainMission, NOT a per-cycle lump
  // anymore. Both launch missions are 1; the old per-CYCLE Short=1/Long=2 split
  // did NOT carry over (a per-cycle value is not a per-tick value, so it was
  // reset to 1, not copied). Each mission still keeps its OWN field rather than
  // one shared constant, so a future mission can be tuned to a richer per-tick FA
  // rate. This is only the FIRST of several planned Fleet Admiral XP sources
  // (2026-07-08 user note: crafting, talent purchases, and a future talent-tree
  // effect boosting this value are all planned later), the values here and
  // xpForNextFleetAdminLevel's curve below are deliberately NOT calibrated as if
  // missions alone must carry the full weight of Fleet Admiral progression.
  // Don't "fix" this later assuming it's undertuned for mission-only play, it's
  // intentionally left room for other income streams to stack on top.
  //
  // ⚠️ CLOSED-FORM PARITY TRAP, keep this an INTEGER ⚠️
  // Like captain XP's xpPerTick rate, this per-tick FA rate is awarded as
  // fleetAdminXpPerTick * wholeTicksElapsed in ONE product per call, and the
  // "one big offline-catchup call == many small live calls" parity guarantee
  // (guarded by the closed-form parity test in tick.test.ts) holds ONLY while
  // the rate is an integer, it is today (1). A FRACTIONAL rate would let a
  // single big-call product diverge from the summed per-call products in floating
  // point (0.1*3 !== 0.1+0.1+0.1), and the current rate-1 parity test would NOT
  // catch it. fleetAdminXpDelta is kept a plain `number` (integer-exact at rate
  // 1); before shipping any fractional FA rate you MUST add a closed-form parity
  // test AT that fractional rate. See the matching ⚠️ block at the FA-XP award
  // line in tickCaptainMission.
  fleetAdminXpPerTick: number;
  // Flat credits awarded once per completed mission CYCLE (not per tick) --
  // unlike fleetAdminXpPerTick above, credits stayed PER-CYCLE in the Progression
  // Pacing Rework (Task 5 relocated only Fleet Admiral XP, not credits). Each
  // mission has its OWN value rather than one shared constant. This is a launch
  // placeholder, not balance-tested, same spirit as this file's other tunable
  // constants.
  creditsPerCycle: number;
  // Mission Rework (Task 6): the mission-control facility LEVEL a fleet must have
  // reached before this mission is dispatchable. This is the SINGLE SOURCE OF TRUTH
  // for the unlock gate, tick.ts's missionUnlocked(state, key) is simply
  // `facilityLevel(state, "missionControl") >= MISSIONS[key].unlockLevel`, so there
  // is NO separate per-mission "unlocked" flag to keep in sync (the level derives it).
  //
  // USER REVISION 2026-07-14: ALL FOUR current missions are `1`, every mission is
  // available from a fresh save (whose missionControl seeds at level 1), so NO mission
  // is locked by default. The user's directive: "the 2 new missions shouldn't be locked
  // behind an upgrade ... 4 missions should be the default." Salvage + Forage were `2`
  // (behind a completion-gated level-1 -> 2 mission-control UPGRADE) before this revision.
  //
  // The unlock MECHANISM is intact and reserved (not deleted): a FUTURE mission batch
  // will declare its own higher unlockLevel AND re-add a matching completion-gated rung
  // to the mission-control track (see FACILITIES.missionControl below, the level-1 -> 2
  // rung was DEFERRED, not removed in spirit, precisely so there is no live rung that
  // unlocks nothing = a placeholder). missionUnlocked (tick.ts) + the locked-mission UI
  // still work the moment such a mission exists.
  unlockLevel: number;
  // Mission Rework (Task 7, design §4): per-mission CAPABILITY requirements checked at
  // dispatch by canDispatch (tick.ts), SEPARATE from the unlockLevel gate above. Both
  // are OPTIONAL, a mission that omits them gates on neither (the ore runs do exactly
  // that), so `undefined` means "no requirement", NOT "requirement of 0". They are
  // FIRST-PASS TUNABLE values in the same launch-placeholder spirit as this file's other
  // numbers; real balancing happens at the device-check stage.
  //
  // requiresCaptainLevel: the flying captain's CaptainState.level must be >= this. Ore
  // runs leave it undefined (always accessible); Salvage/Forage set a SMALL bump.
  // USER REVISION 2026-07-14: these CAPABILITY gates are KEPT even though Salvage/Forage
  // are now default-unlocked (the unlock UPGRADE was deferred). The user removed the
  // mission-control UNLOCK, not the per-mission requirements, so a fresh level-1 captain
  // still cannot fly Salvage (level 2) or Forage (level 3). The bumps stay MODEST (design
  // §4) so these serve as an early progression nudge, not a hard wall.
  requiresCaptainLevel?: number;
  // requiresCargoCapacity: the flying captain's SHIP cargoCapacity (SHIP_TYPES[typeKey]
  // .cargoCapacity, NOT this mission's own cargoCapacity field above) must be >= this.
  // Set to 90 for Salvage/Forage == the default General Freighter's hold, so it only
  // excludes the small-hold Runner (60), nudging the player toward a real hauler for the
  // bigger runs WITHOUT hard-blocking a standard loadout. Ore runs leave it undefined.
  requiresCargoCapacity?: number;
  // Exploration 0.14.0 (Phase E4b): an EXPLICIT extracting-phase length, set ONLY by effectiveMissionDef
  // when a ship carries a museum extractionSpeedMult > 1 (never on a static MISSIONS entry).
  // requiredTicksForPhase reads it in place of ceil(cargoCapacity / extractionRatePerTick); absent means
  // "derive it the usual way", so every existing def is byte-identical.
  extractionTicksOverride?: number;
  // E-CREW 0.14.0 (Task 21, Operations INTEGRITY): the unload length when the hold arrives at least
  // FULL_HOLD_FRACTION full ("steady under pressure": a packed hold unloads faster). Set by effectiveMissionDef
  // only when the ship's Operations Integrity facet is non-zero; missionPhaseTicks reads it against the
  // cargo. Absent = the plain unloadTicks (byte-identical).
  fullHoldUnloadTicks?: number;
}

// Mission Rework (Task 1, docs/plans/2026-07-14-mission-rework-plan.md): 4 missions.
// The 2 original ore runs (KEYS kept `shortOreRun`/`longOreRun`, label-only rename,
// so no save migration) plus 2 new missions (`salvageWreckage`, `forageFlora`). Each
// mission yields its OWN common/uncommon/rare material triad via its `lootTable`
// (see MissionLootTable), the extraction roll mechanic is identical across all 4;
// only which ITEM each tier deposits differs. Add a new entry here (and nowhere else
//, App.svelte's Operations panel iterates this object) if a 5th mission is wanted;
// growing this object automatically widens MissionKey, and the exhaustive
// Record<MissionKey,...> maps below (BASE_XP_PER_TICK) will force the new key to be
// given a value.
//
// ⚠️ FIRST-PASS TUNABLE VALUES ⚠️ The 2 NEW missions' phase durations, occurrence
// chances (design's 98.5/1.4/0.1 common/uncommon/rare split -> uncommonChance 0.014,
// rareChance 0.001), creditsPerCycle, and fleetAdminXpPerTick are launch placeholders
// balanced at the device-check stage, same spirit as this file's other constants. The
// 2 ore runs' numeric fields are UNCHANGED from pre-rework (anti-regression), only
// their `label` and new `lootTable` fields were added/renamed.
//
// Every entry's cargoCapacity divides evenly by extractionRatePerTick (90/1 = 90) --
// keep this true for any future entry too, or update requiredTicksForPhase's
// extracting case to handle a smaller final tick.
// [PROVISIONAL] The Cometary Ice Harvest's numbers (reactor fuel ladder, 0.14.0), the user's to tune: a 40-tick hop out
// and back (between the Local Asteroid's 25 and the Salvage run's 45), a 25% Titanium Ore strike and a 1% Iridium
// strike per extraction tick, and 40 credits a cycle. The haul is the ship's own hold, like every mission's (on a
// General Freighter's 90: about 67 Deuterium Ice, so six or seven Deuterium Canisters, 22 Titanium Ore and one Iridium
// Ore a cycle).
export const COMETARY_ICE_HARVEST_NUMBERS = {
  transitTicks: 40,
  titaniumChance: 0.25,
  iridiumChance: 0.01,
  creditsPerCycle: 40,
} as const;

export const MISSIONS: Record<
  | "localFuelRun"
  | "shortOreRun"
  | "longOreRun"
  | "salvageWreckage"
  | "forageFlora"
  // Exploration 0.14.0 (Phase E1a): the two SENSOR-DRIVEN SURVEY missions, tier II. They reuse
  // the whole extraction machinery (see MissionDef.missionType), just flagged "survey" so their
  // material yield scales with the ship's sensors. Adding these keys automatically widens
  // MissionKey + forces a BASE_XP_PER_TICK entry for each (the exhaustive Record below).
  | "surveyMineralAnomaly"
  | "surveyStellarPhenomena"
  // Exploration 0.14.0 (Phase E1b): the two TRANSPORT / supply-run missions (missionType
  // "transport"). Same widen-the-union + force-a-BASE_XP_PER_TICK-entry contract as the surveys
  // above. They are the credit COST-IN / REWARD-OUT loop, NOT a loot run (see MissionDef.missionType).
  | "frontierSupplyRun"
  | "colonySupplyLift"
  // Reactor fuel ladder (0.14.0, capture docs/plans/2026-10-21-reactor-fuel-and-recipe-realism-capture.md section 5):
  // the Tier I Cometary Ice Harvest, the Deuterium Ice source every Reactor Core blueprint's fuel comes from.
  | "cometIceHarvest",
  MissionDef
> = {
  // Fuel-sourcing RESTRUCTURE (2026-07-15): the fuel BOOTSTRAP mission, FIRST in the
  // object so it renders FIRST in the Operations tier-I list (the starter). A LOCAL,
  // in-system run (no FTL): transitOut/back are BOTH 0 -> roundTripTransitTicks 0 ->
  // fuelNeeded 0 (fuel.ts), so it costs NO fuel and dispatches on an empty tank / zero
  // credits, the escape hatch that seeds the whole fuel economy. Its loot is Deuterium
  // Ice ONLY: uncommonChance/rareChance are BOTH 0, so rollExtractionTick's rare/uncommon
  // branches never win and every extraction tick deposits the common tier -> deuteriumIce.
  //
  // ⚠️ 0-TICK TRANSIT PHASES verified safe: tickCaptainMission's phase loop advances a
  // phase whenever phaseProgressTicks >= requiredTicks, and 0 >= 0 holds, so a 0-length
  // transitOut/transitBack is traversed within the same call as long as budget remains --
  // no infinite loop (each cycle still spends 1+90+8 = 99 ticks on its non-zero phases)
  // and no parity break (a phase boundary landing at a call boundary is the SAME case the
  // engine already handles for every other phase; the next call resolves the pending
  // 0-tick phase at 0 cost). Confirmed by the localFuelRun cycle/parity tests.
  //
  // The uncommon/rare lootTable slots point at the generic uncommonMaterial/rareMaterial
  // tiers ONLY to satisfy the loot-triad rarity contract (model.test.ts asserts common/
  // uncommon/rare rarity tags); with both chances 0 they NEVER roll, so cargo.uncommon
  // Material/rareMaterial stay 0 and homePlanetDelta deposits 0 to them (a 0 delta does
  // NOT mark them discovered, addToInventory gates discovery on amount.gt(0)). So the
  // run genuinely yields deuteriumIce and nothing else. FIRST-PASS TUNABLE values.
  localFuelRun: {
    // PROVISIONAL name (flagged for user rename, same as the ore-tier item names).
    label: "Local Deuterium Skim",
    transitOutTicks: 0, // LOCAL run -> 0 transit -> fuelNeeded 0 (no fuel cost)
    transitBackTicks: 0,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90, // 90 Deuterium Ice per cycle (divides evenly by rate 1)
    uncommonChance: 0, // Deuterium Ice ONLY, no uncommon tier
    rareChance: 0, //    , and no rare tier
    lootTable: { common: "deuteriumIce", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    primaryMaterial: "deuteriumIce", // == lootTable.common (§3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1, // INTEGER, see MissionDef's closed-form parity trap
    creditsPerCycle: 10, // modest, the payoff is the fuel ore, not credits; TUNABLE
    unlockLevel: 1, // available from a fresh save (the bootstrap; missionControl seeds at level 1)
  },
  shortOreRun: {
    // Renamed "Short Ore Run" -> "Local Asteroid" (label only; key unchanged).
    label: "Local Asteroid",
    transitOutTicks: 25,
    transitBackTicks: 25,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90,
    uncommonChance: 0.019, // was lootTable weight 19/1000 (1.9%)
    rareChance: 0.001, // was lootTable weight 1/1000 (0.1%)
    // ANTI-REGRESSION: the IDENTITY triad, tier key == item key, so this run's
    // delivery is byte-identical to pre-rework (Titanium/Polysilicate/Iridium).
    lootTable: { common: "commonOre", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    primaryMaterial: "commonOre", // == lootTable.common (§3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1,
    // FUEL v2 (F3) friendlier bump 10 -> 30, KEPT through the 2026-07-15 FUEL_PER_TICK
    // 0.1 -> 1 retune. NOTE: at FUEL_PER_TICK 1 this reward NO LONGER exceeds the worst-case
    // auto-buy cost (Freighter need 50 * FUEL_CREDITS_PER_UNIT 5 = 250cr for an empty tank) --
    // and it does not NEED to: the non-bricking guarantee is now the Fuel Depot's refining
    // outpacing consumption from a full starting tank, not credit-funded auto-buy (see the
    // reframed sustainability test in fuel-consumption-v2.test.ts). This is just a generous
    // reward. FIRST-PASS TUNABLE, same spirit as this file's other placeholders.
    creditsPerCycle: 30,
    unlockLevel: 1, // available from a fresh save (missionControl seeds at level 1)
  },
  longOreRun: {
    // Renamed "Long Ore Run" -> "Lunar Mine Contract" (label only; key unchanged).
    label: "Lunar Mine Contract",
    transitOutTicks: 70,
    transitBackTicks: 70,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90,
    uncommonChance: 0.08, // was lootTable weight 80/1000 (8%)
    rareChance: 0.02, // was lootTable weight 20/1000 (2%)
    // REWIRED (design §1): the Lunar Mine yields its own Ferrite / Dense Ore / Osmium triad, not the ore keys.
    // Its auto-stop still gates on the `ferriteOre` key (unchanged).
    // WR-4 (OC-C2, user 2026-10-16 "Add a Dense Ore source": "Dense Ore drops from a mining mission"): the mine's
    // UNCOMMON strike is Dense Ore, the deep-seam tier-2 ore, so Warehouse T2 and its Dense Ore rungs are
    // reachable. Cobalt Ore keeps its source on the Survey Mineral Anomaly (its uncommon tier). [PROPOSAL] the
    // mission (the Lunar Mine, not the survey) and keeping the 8% uncommon chance: the user tunes both.
    lootTable: { common: "ferriteOre", uncommon: "denseOre", rare: "osmiumOre" },
    primaryMaterial: "ferriteOre", // == lootTable.common (§3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1,
    // FUEL v2 (F3) friendlier bump 20 -> 75, KEPT through the 2026-07-15 FUEL_PER_TICK retune.
    // At FUEL_PER_TICK 1 this no longer exceeds the worst-case auto-buy cost (Freighter
    // need 140 * 5 = 700cr), and need not, for the same reason as shortOreRun (refining, not
    // credit auto-buy, is the non-bricking mechanism). A generous reward; FIRST-PASS TUNABLE.
    creditsPerCycle: 75,
    unlockLevel: 1, // available from a fresh save (missionControl seeds at level 1)
  },
  salvageWreckage: {
    // NEW mission (design §1). Phase durations are FIRST-PASS placeholders, sized
    // between the two ore runs (short 25/25, long 70/70), retuned at device check.
    label: "Salvage Skirmish Wreckage",
    transitOutTicks: 45,
    transitBackTicks: 45,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90,
    uncommonChance: 0.014, // first-pass: design's 1.4% uncommon split (tunable)
    rareChance: 0.001, // first-pass: design's 0.1% rare split (tunable)
    lootTable: { common: "scrapAlloy", uncommon: "salvagedCircuitry", rare: "intactReactorCore" },
    primaryMaterial: "scrapAlloy", // == lootTable.common (§3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1, // INTEGER, see MissionDef's closed-form parity trap; Task 2 owns XP retune
    creditsPerCycle: 50, // FUEL v2 (F3) bump 30 -> 50, KEPT through the 2026-07-15 retune (at FUEL_PER_TICK 1 the worst-case auto-buy is now need 90 * 5 = 450cr; refining, not this reward, is the non-bricking mechanism); tunable
    unlockLevel: 1, // USER REVISION 2026-07-14: default-available (all 4 missions unlock at the
    // level-1 seed). Was 2 (behind the deferred mission-control unlock upgrade). See the
    // MissionDef.unlockLevel comment + FACILITIES.missionControl for why that rung is deferred.
    requiresCaptainLevel: 2, // modest bump, a CAPABILITY gate (design §4), SEPARATE from the
    // unlock above and DELIBERATELY KEPT: the user removed the mission-control UNLOCK upgrade,
    // not the per-mission capability requirements. A fresh level-1 captain still can't fly this.
    requiresCargoCapacity: 90, // == default Freighter hold; excludes only the small Runner (60)
  },
  forageFlora: {
    // NEW mission (design §1). Phase durations are FIRST-PASS placeholders, the
    // longest of the four, retuned at device check.
    label: "Forage Minerals & Flora on Nearby Moon",
    transitOutTicks: 55,
    transitBackTicks: 55,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90,
    uncommonChance: 0.014, // first-pass: design's 1.4% uncommon split (tunable)
    rareChance: 0.001, // first-pass: design's 0.1% rare split (tunable)
    lootTable: { common: "fibrousBiomass", uncommon: "volatileResin", rare: "exoticSporeCluster" },
    primaryMaterial: "fibrousBiomass", // == lootTable.common (§3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1, // INTEGER, see MissionDef's closed-form parity trap; Task 2 owns XP retune
    creditsPerCycle: 60, // FUEL v2 (F3) bump 35 -> 60, KEPT through the 2026-07-15 retune (at FUEL_PER_TICK 1 the worst-case auto-buy is now need 110 * 5 = 550cr; refining, not this reward, is the non-bricking mechanism); tunable
    unlockLevel: 1, // USER REVISION 2026-07-14: default-available (see salvageWreckage's note +
    // the MissionDef.unlockLevel comment). Was 2 (behind the now-deferred unlock upgrade).
    requiresCaptainLevel: 3, // slightly above Salvage's 2, CAPABILITY gate, KEPT (see salvageWreckage)
    requiresCargoCapacity: 90, // == default Freighter hold; excludes only the small Runner (60)
  },
  // --- SURVEY missions (Exploration 0.14.0, Phase E1a, design "E1 design decisions" 2026-09-25) ---
  // The FIRST live consumer of the `sensors` stat. A survey = transit to a KNOWN system -> a
  // sensor-driven scan -> yield, reusing the extraction transit/scan/return/deliver machinery
  // (missionType "survey" is the ONLY difference from an ore run). They reward RARE materials +
  // credits + XP, and tickCaptainMission scales their material yield by the ship's sensors
  // (SURVEY_SENSOR_YIELD_COEFF, tick.ts). No new currency/entity: the loot triads reuse existing
  // ITEMS, mixed into new combinations so a survey is not a carbon copy of one ore run. Their
  // uncommon/rare CHANCES sit ABOVE the ore runs (a survey hunts the good stuff), and the sensor
  // yield bonus stacks on top of that. TIER II (unlike the tier-I economy runs) + mid-range transit
  // (longer than the longOreRun's 70/70) but still within a base General Freighter's reach (round
  // trip <= its fuelCapacity 200 at FUEL_PER_TICK 1), so an explorer OR a sensor-equipped freighter
  // can run them. unlockLevel is 1 (the deferred mission-control unlock rung would strand a >1 gate,
  // see the unlockLevel comment above); the captain-level + cargo capability gates provide the
  // progression nudge instead. ⚠️ ALL numeric fields FIRST-PASS TUNABLE, device-retuned like the
  // rest of this file. cargoCapacity divides evenly by extractionRatePerTick (contract above).
  surveyMineralAnomaly: {
    label: "Survey Mineral Anomaly",
    missionType: "survey",
    transitOutTicks: 85, // mid-range: 170-tick round trip (> longOreRun's 140), reachable by the Freighter (reach 200)
    transitBackTicks: 85,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 120, // a longer scan than the ore runs; divides evenly by rate 1
    uncommonChance: 0.1, // ABOVE longOreRun's 0.08: a survey is rarity-focused (tunable)
    rareChance: 0.03, //    ABOVE longOreRun's 0.02 (tunable)
    // NEW combination of EXISTING items (not an existing mission's triad): Titanium common
    // floor, Cobalt uncommon, Osmium rare. Rarity tags match the loot-triad contract.
    lootTable: { common: "commonOre", uncommon: "cobaltOre", rare: "osmiumOre" },
    primaryMaterial: "commonOre", // == lootTable.common (§3.4 auto-stop)
    tier: "II",
    fleetAdminXpPerTick: 1, // INTEGER, see MissionDef's closed-form parity trap
    creditsPerCycle: 100, // richer than the tier-I runs; tunable
    unlockLevel: 1, // available from the level-1 seed (the deferred unlock rung would strand a >1 gate)
    requiresCaptainLevel: 4, // a step above forageFlora's 3 (CAPABILITY gate, the progression nudge)
    requiresCargoCapacity: 90, // == default Freighter hold; excludes only the small Runner (60)
  },
  surveyStellarPhenomena: {
    label: "Survey Stellar Phenomena",
    missionType: "survey",
    transitOutTicks: 95, // 190-tick round trip, still within the Freighter's reach (200)
    transitBackTicks: 95,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 120,
    uncommonChance: 0.12, // the richer of the two surveys (tunable)
    rareChance: 0.04, //    the richer of the two surveys (tunable)
    // NEW combination of EXISTING items: Ferrite common floor, Volatile Resin uncommon, Exotic
    // Spore Cluster rare (the "exotic" payoff). Rarity tags match the loot-triad contract.
    lootTable: { common: "ferriteOre", uncommon: "volatileResin", rare: "exoticSporeCluster" },
    primaryMaterial: "ferriteOre", // == lootTable.common (§3.4 auto-stop)
    tier: "II",
    fleetAdminXpPerTick: 1, // INTEGER, see MissionDef's closed-form parity trap
    creditsPerCycle: 120, // the richest first-pass survey reward; tunable
    unlockLevel: 1,
    requiresCaptainLevel: 5, // above surveyMineralAnomaly's 4 (progression nudge)
    requiresCargoCapacity: 90,
  },
  // --- TRANSPORT / supply missions (Exploration 0.14.0, Phase E1b, design I.1 + "E1 design
  // decisions" 2026-09-25) ---
  // The COST-IN / REWARD-OUT credit loop. Each delivered cycle spends a cargo-scaled CREDIT load
  // cost ("load supplies") and returns it PLUS rewardMargin, so the NET is a cargo-scaled credit
  // PROFIT per cycle (tickCaptainMission's transport branch). A bigger hold (the Eir, cargo 220) and
  // faster crew turnaround (Operations/unloadSpeed shrinks the unload phase via effectiveMissionDef)
  // both earn more, WITHOUT any transport-specific code for either (both fold through
  // effectiveMissionDef). They deliver NO extraction loot (the deposit is suppressed for transports),
  // so their lootTable is inert SCAFFOLDING kept only to satisfy MissionDef's loot-triad contract
  // (the generic common/uncommon/rare tiers, guaranteed real + correctly-rarity-tagged); it is never
  // deposited. creditsPerCycle is 0 (the reward IS the margin; the transport branch skips the flat
  // per-cycle award to avoid a double-count). uncommon/rareChance are 0 (like localFuelRun: nothing
  // to roll, since loot is suppressed anyway). TIER II like the surveys (mid-range exploration ops);
  // unlockLevel 1 (the deferred mission-control rung would strand a >1 gate, see the unlockLevel
  // comment); captain-level + cargo capability gates provide the progression nudge. ⚠️ ALL numeric
  // fields FIRST-PASS TUNABLE, device-retuned like the rest of this file.
  frontierSupplyRun: {
    label: "Frontier Supply Run",
    missionType: "transport",
    transitOutTicks: 60, // mid-range: shorter than the surveys, a bread-and-butter haul
    transitBackTicks: 60,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 120, // divides evenly by rate 1 (the extracting-phase contract)
    uncommonChance: 0, // no loot rolled/delivered: a transport is a pure credit loop
    rareChance: 0,
    // Inert scaffolding (never deposited): the generic tiers, guaranteed real + correctly tagged.
    lootTable: { common: "commonOre", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    primaryMaterial: "commonOre", // == lootTable.common (the loot-triad contract); inert for transport
    tier: "II",
    fleetAdminXpPerTick: 1, // INTEGER, see MissionDef's closed-form parity trap
    creditsPerCycle: 0, // the reward is the margin below, NOT a flat per-cycle award
    supplyCostPerCargo: 4, // credits of supplies loaded per unit of effective cargo (TUNABLE)
    rewardMargin: 0.25, // 25% profit on the load -> net = loadCost * 0.25 per cycle (TUNABLE)
    unlockLevel: 1, // available from the level-1 seed (the deferred unlock rung would strand a >1 gate)
    requiresCaptainLevel: 3, // a modest capability gate (the progression nudge)
    requiresCargoCapacity: 90, // == default Freighter hold; excludes only the small Runner (60)
  },
  colonySupplyLift: {
    label: "Colony Supply Lift",
    missionType: "transport",
    transitOutTicks: 90, // the longer, richer supply run
    transitBackTicks: 90,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 150, // divides evenly by rate 1
    uncommonChance: 0,
    rareChance: 0,
    lootTable: { common: "commonOre", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    primaryMaterial: "commonOre", // == lootTable.common (inert for transport)
    tier: "II",
    fleetAdminXpPerTick: 1, // INTEGER, closed-form parity trap
    creditsPerCycle: 0, // reward is the margin
    supplyCostPerCargo: 6, // richer supplies per unit (TUNABLE)
    rewardMargin: 0.35, // the richer margin: net = loadCost * 0.35 per cycle (TUNABLE)
    unlockLevel: 1,
    requiresCaptainLevel: 5, // above the Frontier run's 3 (progression nudge)
    requiresCargoCapacity: 90,
  },
  // --- Cometary Ice Harvest (0.14.0, reactor fuel ladder; capture 2026-10-21 sections 1 and 5) ---
  // The user: "don't make it the same mission as before. Make it a mission that can provide additional resources as
  // well, with deuterium as one of the more common items", and the approved concept "Cometary Ice Harvest
  // (Recommended)": mine a passing comet's ice, Deuterium Ice common, plus Titanium Ore and a rare chance of Iridium,
  // Tier I. NOT the retired Local Deuterium Skim (localFuelRun stays hidden): an ordinary mining run with a real
  // transit, no fuel role. Its ice refines 10:1 into the Deuterium Canister every Reactor Core blueprint takes
  // (reactorTech.ts), so no core ever waits on an expedition. Gathering cannot be lost, so its first run (like every
  // gathering run's) is safe by construction (safe first runs SF-5).
  //
  // The triad: Deuterium Ice is the guaranteed common floor (the auto-stop gate); the UNCOMMON tier strikes the comet's
  // dust crust for Titanium Ore, a common-rarity ore riding the uncommon slot by design (the one listed exception to
  // the loot-triad rarity rule, model.test.ts); the rare tier is Iridium. Every number is
  // COMETARY_ICE_HARVEST_NUMBERS [PROVISIONAL].
  cometIceHarvest: {
    label: "Cometary Ice Harvest",
    transitOutTicks: COMETARY_ICE_HARVEST_NUMBERS.transitTicks,
    transitBackTicks: COMETARY_ICE_HARVEST_NUMBERS.transitTicks,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90, // divides evenly by rate 1 (overwritten by the hull hold, like every mission: WR-11)
    uncommonChance: COMETARY_ICE_HARVEST_NUMBERS.titaniumChance,
    rareChance: COMETARY_ICE_HARVEST_NUMBERS.iridiumChance,
    lootTable: { common: "deuteriumIce", uncommon: "commonOre", rare: "rareMaterial" },
    primaryMaterial: "deuteriumIce", // == lootTable.common (section 3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1, // INTEGER, see MissionDef's closed-form parity trap
    creditsPerCycle: COMETARY_ICE_HARVEST_NUMBERS.creditsPerCycle,
    unlockLevel: 1, // available from a fresh save, like every Tier I mining run (no capability gate either)
  },
};

export type MissionKey = keyof typeof MISSIONS;

// Per-mission per-tick XP RATE (Progression Pacing Rework, Task 3 --
// docs/plans/2026-07-11-progression-pacing-rework-*). The base amount of XP a
// mission is worth per WHOLE extraction tick, BEFORE any future captain-talent
// or global-buff XP multipliers are applied. Kept as its own tunable table
// (NOT a field on MissionDef) so a designer can retune XP pacing independently
// of a mission's other stats, and so the mapping is exhaustive over MissionKey
// (a new mission cannot be added without also giving it an XP rate). Both
// missions start at 1, a launch placeholder, same spirit as MISSIONS'/RECIPES'
// own hand-tuned constants, and deliberately balanced around the SHORT run per
// the design's "balance around the short run" note (the long run's extra value
// comes from its higher rare odds + per-cycle credits/Fleet-Admiral XP, not a
// higher per-tick XP rate). Consumed ONLY via tick.ts's xpPerTick helper, by
// Task 4 (captain XP accrual) and Task 5 (Fleet Admiral XP); NOT wired into
// tickCaptainMission yet.
export const BASE_XP_PER_TICK: Record<MissionKey, number> = {
  // Mission Rework (Task 2, docs/plans/2026-07-14-mission-rework-plan.md §Part A,
  // design §5): each mission's real first-pass per-tick XP rate. shortOreRun is the
  // balance anchor at 1; the other three carry a small progressive premium
  // (1.1/1.2/1.25) reflecting their longer/riskier/farther profiles. These are
  // launch placeholders, same tunable spirit as MISSIONS'/RECIPES' constants, real
  // balancing happens at the device-check stage.
  // Fuel-sourcing RESTRUCTURE (2026-07-15): the free fuel bootstrap. INTEGER rate
  // (parity-safe, see the trap note below); a modest 1/tick, same anchor as shortOreRun.
  localFuelRun: 1,
  shortOreRun: 1,
  // ⚠️ FRACTIONAL RATES ⚠️ longOreRun/salvageWreckage/forageFlora are NON-INTEGER --
  // exactly the condition the CLOSED-FORM PARITY TRAP in tick.ts (xpPerTick +
  // tickCaptainMission accrual) warns about. This is SAFE ONLY because, post-Phase-2,
  // both the offline path (tick() -> economyTick(state,1) per whole tick) and the live
  // loop (App.svelte -> economyTick(state,1) per bar) accrue STRICTLY per whole tick:
  // each step adds new Decimal(rate).times(1), never Decimal(rate).times(N>1). The
  // fractional-rate closed-form parity test in tick.test.ts (longOreRun @ 1.1, across
  // multiple level-ups) PROVES this holds, do NOT raise any rate to a fraction
  // without a matching parity assertion at that rate.
  longOreRun: 1.1,
  salvageWreckage: 1.2,
  forageFlora: 1.25,
  // Exploration 0.14.0 (E1a): the tier-II surveys carry the richest per-tick XP premium (their
  // longer transit + rarity focus). FRACTIONAL, exactly like longOreRun/salvage/forage above, and
  // SAFE for the SAME reason: both the offline (tick -> economyTick(_,1)) and live loops accrue
  // strictly per whole tick (each step adds new Decimal(rate).times(1), never .times(N>1)), and
  // 1.5 / 1.6 are terminating decimals. The survey closed-form parity test in tick.test.ts proves
  // it holds at these rates (mirrors the longOreRun @ 1.1 proof). Do NOT raise any rate to a
  // fraction without a matching parity assertion at that rate (see the trap note above).
  surveyMineralAnomaly: 1.5,
  surveyStellarPhenomena: 1.6,
  // Exploration 0.14.0 (E1b): the transports carry an INTEGER per-tick XP rate (1), the parity-safe
  // choice (see the closed-form trap note above) and a modest anchor: a supply run's payoff is the
  // credit margin, not XP. Kept integer deliberately so they add no new fractional-rate parity surface.
  frontierSupplyRun: 1,
  colonySupplyLift: 1,
  // Reactor fuel ladder (0.14.0): the Cometary Ice Harvest at the shortOreRun anchor, an INTEGER rate (no new
  // fractional-rate parity surface).
  cometIceHarvest: 1,
};

// --- Combat factions (Combat 0.13.0, design §S14) ----------------------------
// The lightweight named-pirate-faction record. Combat 0.13.0 adds Patrol missions
// where the player fights a NAMED pirate faction; each starting Patrol is tied to
// one of these. This is the DATA SEAM ONLY: a later sub-phase (enemy generation)
// reads a Faction to build seeded enemy combatants, and patrol defs will reference
// a faction by `id`, so `id` is the STABLE identifier those consumers key on (do
// not rename an id once a patrol/enemy references it, same discipline as a mission
// key or blueprint key).
//
// ⚠️ REPUTATION DEFERRED (design §S14): a per-faction reputation SCALAR and its
// consequences (reprisal, standing-gated rewards, faction-vs-faction dynamics) are
// a PLANNED extension, intentionally NOT shipped this patch. 0.13.0 lands only the
// id/name/flavor triad so the seam is live and future work is additive. The ABSENCE
// of a reputation field here is deliberate, NOT an oversight: a future reader adding
// reputation should extend this interface (and add a save-migration then, since a
// persisted reputation value is the FIRST thing about factions that will need to
// persist, nothing here does yet).
export interface Faction {
  id: string;    // stable identifier, keyed by future enemy-gen + patrol defs
  name: string;  // player-facing display name
  flavor: string; // one-sentence PG flavor blurb
}

// The named pirate factions the starting Patrols draw from. FIRST-PASS PLACEHOLDER
// content: the ids are stable, but the names/flavor are launch placeholders meant to
// be art-directed later (same tunable spirit as MISSIONS'/SHIP_TYPES' first-pass
// constants above). Keyed by `id` so a lookup is a direct FACTIONS[id] read (mirrors
// how BLUEPRINTS/MISSIONS/SHIP_TYPES key their records, and why no factionById helper
// is warranted: the record read already returns the entry or undefined). Four entries
// give enemy generation a small roster to seed from; add one here (do not repurpose an
// existing id) when a new faction is authored. The map-key-equals-id invariant is
// asserted in model.test.ts, the same drift guard BLUEPRINTS carries.
export const FACTIONS: Record<string, Faction> = {
  crimsonReavers: {
    id: "crimsonReavers",
    name: "The Crimson Reavers",
    flavor: "A blood-bannered raider clan that strips freighters to the frame and leaves the crews adrift as a warning.",
  },
  voidJackals: {
    id: "voidJackals",
    name: "The Void Jackals",
    flavor: "Opportunist scavengers who shadow the trade lanes and pounce on any hull that drifts from its escort.",
  },
  ironVultures: {
    id: "ironVultures",
    name: "The Iron Vultures",
    flavor: "Salvage-pirates in patchwork gunships who circle wounded convoys and pick the wreckage clean.",
  },
  ashenCorsairs: {
    id: "ashenCorsairs",
    name: "The Ashen Corsairs",
    flavor: "A disciplined corsair fleet out of the burned-out colonies, feared for coordinated ambushes at the jump gates.",
  },
};

// --- Combat Patrols (Combat 0.13.0, Phase 9b.5a, design §S14) ------------------
// A PatrolDef is to a patrol what a MissionDef is to an extraction run: the immutable
// CONTENT template a dispatched patrol reads. It describes a route (transit OUT, a
// combat WAVE WINDOW, transit BACK) fought against one named pirate faction drawing
// enemies from a hull pool. Analogous to MissionDef but patrol-shaped: instead of an
// extract/unload window it has a wave-roll window (the fields planWaveSchedule consumes)
// and an enemy-count band; instead of a MissionLootTable it names a faction + hull pool
// (enemy generation, 9b.5b, reads these). Fuel is DERIVED from the two transit legs
// exactly as an extraction mission's is (only transit burns fuel, see fuel.ts), so a
// patrol needs no explicit fuelCost field, just transitOutTicks / transitBackTicks.
//
// ⚠️ EVERY NUMBER IN PATROLS BELOW IS FIRST-PASS + TUNABLE (design S20 owns the balance
// pass), same launch-placeholder spirit as MISSIONS'/SHIP_TYPES'/PIRATE_HULLS' constants.
// The per-patrol INTENT COMMENT is the durable contract; the exact integers will move.
export interface PatrolDef {
  // Player-facing display name (shown in the patrol readout / dispatch UI, 9b.5c).
  label: string;
  // The FACTIONS id this patrol fights. Must be a real FACTIONS key (model.test guard).
  factionId: string;
  // The pirate hulls enemy generation (9b.5b) may draw a wave's enemies from. Every id
  // must be a real PIRATE_HULLS key (model.test guard). Non-empty by contract.
  hullPool: PirateHullId[];
  // Wave-count band. minWaves is the guaranteed floor, maxWaves the ceiling; the resolved
  // schedule (planWaveSchedule) always lands in [minWaves, maxWaves]. minWaves <= maxWaves
  // (model.test guard). These map directly onto WaveScheduleParams.min/maxWaves.
  minWaves: number;
  maxWaves: number;
  // Per-wave enemy-count band (how many enemy hulls a single wave fields). enemyCountMin
  // <= enemyCountMax (model.test guard). Consumed by enemy generation (9b.5b), NOT by the
  // wave schedule.
  enemyCountMin: number;
  enemyCountMax: number;
  // Route geometry. transitOutTicks is the initial no-waves transit (shields regen); it
  // also fixes the wave window's start (rollStartTick == transitOutTicks, the first tick a
  // wave can occur). rollWindowTicks is the LENGTH of the wave-eligible window (so
  // rollEndTick == transitOutTicks + rollWindowTicks - 1). transitBackTicks is the return
  // leg. Total route length = transitOutTicks + rollWindowTicks + transitBackTicks. The
  // window must physically hold maxWaves (rollWindowTicks >= maxWaves), which planWaveSchedule
  // enforces for minWaves and the model.test guard enforces for maxWaves.
  transitOutTicks: number;
  rollWindowTicks: number;
  transitBackTicks: number;
  // Per-eligible-tick NATURAL wave-roll chance as an integer fraction (numerator /
  // denominator), fed straight to planWaveSchedule (which draws on the combat PRNG). E.g.
  // 30 / 100 == a 30% chance per eligible tick, on top of the catch-up floor that
  // guarantees minWaves.
  waveChanceNumerator: number;
  waveChanceDenominator: number;
}

// The starting patrol roster, keyed by id (map-key IS the identity, like MISSIONS; no
// separate `id` field). Add an entry here (growing PatrolKey) when a new patrol is
// authored; never repurpose an existing key (a persisted PatrolMissionState.patrolKey
// references it). TWO patrols this unit: the gentle entry SWEEP (mostly lone raiders,
// 2 waves of 1) AND a tougher SHOWCASE warband (corsair/carrier-heavy, up to 2 enemies a
// wave) added in Combat 1.0 Unit 2.5b. There is NO unlock/gating field on PatrolDef (the
// UI enumerates Object.entries(PATROLS) with no lock, and dispatch is gated only by hull /
// fuel), so BOTH patrols are always visible; the per-patrol Threat Assessment band is what
// steers a new player away from the harder one (it reads a mid / cautionary tier for a
// Standard-Issue hull instead of "Guaranteed"), which is exactly the mechanic 2.5b exists to
// surface. Sized so each patrol's wave window comfortably holds its maxWaves.
export const PATROLS: Record<string, PatrolDef> = {
  // CRIMSON-REAVER SWEEP: the entry patrol. A short local sweep (3-tick legs) through an
  // 8-tick contested window, fighting 2 light waves of a SINGLE ship each (mostly raiders,
  // the odd marauder). ⚠️ FIRST-PASS BALANCE (Phase 9b): these fields were tuned so ALL
  // THREE tactician hulls (destroyer / battleship / carrier), each flying its DEFAULT
  // loadout, RELIABLY WIN this starter (measured ~100% across a 200-seed sample, guarded by
  // patrol-balance.test.ts). The entry patrol must never be an "unwinnable first fight"
  // wall; a real global balance pass (design S20) revisits the wider difficulty curve later.
  // The tuning is DELIBERATELY GENTLE (single-enemy waves + a raider-heavy pool + only 2
  // waves) because it is the very first combat a new player sees; tougher patrols get their
  // own richer pools/counts. See PIRATE_HULLS (the pirate hulls stay usable for those).
  crimsonReaverSweep: {
    label: "Crimson-Reaver Sweep",
    factionId: "crimsonReavers",
    // 4:1 raider:marauder (uniform pick over this list). Raider-heavy so most waves are
    // trivial for an entry warship; the lone marauder is a rare step-up, not a wall.
    // FIRST-PASS + TUNABLE (S20).
    hullPool: ["raider", "raider", "raider", "raider", "marauder"],
    // 2-3 waves, each exactly 1 enemy (enemyCountMin == enemyCountMax). Single-enemy waves keep
    // hull attrition low enough that the destroyer (the thinnest-hulled tactician) clears it
    // reliably, which is this patrol's job as the entry encounter.
    //
    // RETUNED 0.13.5 (F5: every hardpoint now ships with a Standard-Issue weapon). Was exactly 2
    // waves. THE SMALLEST CHANGE THAT RESTORES THE CONTRACT, and deliberately so: this is the
    // ENTRY patrol and a heavy-handed increase would punish a new player for a change made to help
    // them. Measured at 64 forecast samples per hull:
    //
    //                      pre-F5    F5 + 2 waves    F5 + 2-3 waves (shipped)
    //   generalFreighter     62.5          98.4                98.4
    //   prospectorHauler     76.6         100.0                98.4
    //   prospectorRunner     62.5          62.5                57.8
    //   prospectorMiner      62.5          62.5                57.8
    //   destroyer            98.4         100.0               100.0
    //
    // ⚠️ THE ECONOMY HULLS DID NOT MOVE TOGETHER, AND THEY CANNOT BE RESTORED TOGETHER. F5's buff
    // is UNEVEN by construction: the freighter and hauler have 2 hardpoints and carried 1 gun, so
    // they DOUBLED their offense; the runner and miner have exactly 1 hardpoint and were already
    // full, so they gained NOTHING. No uniform difficulty increase can put both pairs back where
    // they were: anything that drags the freighter down to 62.5 would push the runner far below it.
    // The contract this patrol actually owes (every economy hull strictly below the destroyer) is
    // met, and the two hulls that gained nothing are held within ~5 points of their old numbers,
    // which is the side worth protecting.
    minWaves: 2,
    maxWaves: 3,
    enemyCountMin: 1,
    enemyCountMax: 1,
    transitOutTicks: 3,
    rollWindowTicks: 8,
    transitBackTicks: 3,
    waveChanceNumerator: 30,
    waveChanceDenominator: 100,
  },

  // CRIMSON-REAVER WARBAND: the tougher SHOWCASE patrol (Combat 1.0 Unit 2.5b). WHY IT EXISTS:
  // the entry Sweep above is deliberately trivial (every tactician hull wins at ~100% on offense
  // alone), so drones, the Threat Assessment bands, and crafted gear never actually MATTER in it.
  // This warband is the first patrol where they do. It is a DEEPER, corsair-tender-heavy raid:
  // longer transit legs (5 ticks each vs the Sweep's 3, so it costs meaningfully more fuel) into a
  // longer contested window fighting 2-3 waves of 1-2 ships each, drawn from a pool led by the
  // CORSAIR CARRIER (the drone tender) so a fight actually fields enemy drones.
  //
  // ⚠️ BALANCE, MEASURED (Unit 2.5b, tuned against the post-2.5a gear math via the SAME seeded
  // forecast App.svelte shows, resolvePatrolWaves over 64 fixed seeds, and re-confirmed on the live
  // economyTick loop over 200 seeds): with FREE Standard-Issue gear the appropriate anti-corsair
  // hulls land in a MID band, a real fight, not a guaranteed win: the battleship reads "It's Time to
  // Toss the Dice" (~55%) and the carrier "A Worthy Adversary" (~75%). The thin destroyer striker
  // reads "Extreme Challenge" (~15%) ON PURPOSE: it is a glass cannon, not an anti-swarm hull, and
  // the whole point of this patrol is that hull choice + gear + drones now MATTER (see the
  // showcasePatrol block in patrol-balance.test.ts, which locks the carrier mid-band + the crafted
  // and drone lifts). A carrier fielding its drone screen reads a full band better than one with its
  // bays empty (~75% vs ~56%), and installing good crafted gear pushes every hull up toward
  // Guaranteed. FIRST-PASS + TUNABLE: the global difficulty curve (design S20) revisits these later.
  crimsonReaverWarband: {
    label: "Crimson-Reaver Warband",
    factionId: "crimsonReavers",
    // CORSAIR-CARRIER-LED pool (uniform pick over this list): 1 corsair carrier : 1 marauder : 2
    // raiders. The corsair carrier is the tough drone-tender that makes enemy drones (and therefore
    // the player's anti-drone weapons) matter; the marauder is the medium gun-line threat; the two
    // raiders keep some waves lighter so the patrol is a real fight rather than an unwinnable wall.
    // FIRST-PASS + TUNABLE (S20): shift the ratio / add a hull to move the curve.
    // RETUNED 0.13.5 (F5). Was ["corsairCarrier", "marauder", "raider", "raider"]. Dropping the
    // second raider raises the corsair-carrier and marauder share from 1:1:2 to an even 1:1:1, so
    // the average wave is heavier without adding a hull the fiction did not already have.
    hullPool: ["corsairCarrier", "marauder", "raider"],
    // RETUNED 0.13.5 (F5: every hardpoint now ships with a Standard-Issue weapon). Was 2-3 waves of
    // 1-2 enemies. Now a fixed 3 waves of 1-3, against the evened-out pool above. Measured at 64
    // forecast samples per hull, against the bands patrol-balance.test.ts asserts:
    //
    //                      pre-F5    F5 (untuned)    F5 retuned (shipped)    band
    //   destroyer            15.6          67.2                   14.1       > 2, below battleship
    //   battleship          ~55           100.0                   78.1       30 to 85
    //   carrier             ~75           100.0                   60.9       40 to 85
    //   generalFreighter      1.6          12.5                    1.6       below destroyer
    //   prospectorHauler      4.7          23.4                    3.1       below destroyer
    //
    // ⚠️ WHY A FIXED 3 WAVES RATHER THAN A 3-4 BAND, which would have kept more variety: measured,
    // 3-4 waves pushes the CARRIER to 28.1%, straight through the 40% floor the showcase band
    // requires. The carrier is the hull this patrol exists to make interesting (it is the drone
    // tender's natural counter), so a variant that makes it "Not Advised" defeats the encounter's
    // purpose. Wave-count variety was the cheaper thing to spend.
    //
    // ⚠️ The battleship lands HIGH of its old ~55 and the carrier LOW of its old ~75, and that is
    // the same unevenness the Sweep block above describes: the battleship gained 3 guns (3 -> 6)
    // while the carrier gained 1 (1 -> 2), so one difficulty dial cannot return both to where they
    // were. Both sit comfortably inside their asserted bands, which is the contract; the exact old
    // values are not recoverable without per-hull scaling, which does not exist.
    //
    // The 1..3 count band keeps some waves
    // step-up the Sweep never has (it is 2 waves of exactly 1); the 1..2 count band keeps some waves
    // single-enemy so hull attrition stays survivable for the appropriate hulls. FIRST-PASS + TUNABLE.
    minWaves: 3,
    maxWaves: 3,
    enemyCountMin: 1,
    enemyCountMax: 3,
    // Longer route than the Sweep (5-tick legs vs 3): a deeper raid that costs more fuel (fuel is
    // DERIVED from the transit legs, fuel.ts). rollWindowTicks 12 comfortably holds maxWaves (3).
    transitOutTicks: 5,
    rollWindowTicks: 12,
    transitBackTicks: 5,
    // A denser contested window than the Sweep (45% vs 30% per eligible tick) so the up-to-3 waves
    // actually materialise across the window rather than leaning on the catch-up floor. TUNABLE.
    waveChanceNumerator: 45,
    waveChanceDenominator: 100,
  },
};

// The KEY union over PATROLS (mirrors MissionKey = keyof typeof MISSIONS). A persisted
// PatrolMissionState.patrolKey is typed on this, so a typo or a retired key is a compile
// error rather than a runtime miss.
export type PatrolKey = keyof typeof PATROLS;

// The 4 real hulls this feature ships (design doc, Task 1). TUNABLE, first-pass
// balance; real tuning happens at the device-check stage, same launch-placeholder
// spirit as MISSIONS'/RECIPES' constants above. `moduleSlots`/`equipmentSlots`
// are POPULATED but INERT this pass (no module/equipment system exists yet) --
// carried now so the table shape is stable when those systems land, rather than
// bolted on later. Add an entry here (and grow ShipTypeKey above) only when a
// hull is actually built. The tactician combat trio (destroyer/battleship/carrier)
// and the explorer family (orion/aurora/eir, 0.14.0 Phase E0) are now BUILT below;
// no forward bucket remains absent.
// G1-1 (Short-Range Missions, 0.14.0): each transport-minded hull's BASE guest quarters (ShipTypeDef.colonistCapacity),
// the berths its passengers ride in. [PROVISIONAL] first-pass numbers the user approved as provisional (2026-10-19,
// call 6: "Eir 80, Orion 40, Aurora 40, General Freighter 20, others 0"); every other hull omits the field (0). The ONE
// place these numbers live: each SHIP_TYPES entry below reads its value from here.
export const HULL_GUEST_QUARTERS = { generalFreighter: 20, orion: 40, aurora: 40, eir: 80 } as const;
// G1-1 review (user 2026-10-19, "Hide until Short-Range"): the Ship Systems "Guest Quarters" rows (the stat readout,
// its (i) definition, the install compare) and the hull card's line stay hidden until Short-Range Missions are in, so
// no player meets a stat nothing they can do uses yet. The stat itself is live (shipDerivedStats folds it). The
// G1-4 / G1-6 slice that puts passenger runs in front of the player flips this to true: G1-6 did (2026-10-21).
export const GUEST_QUARTERS_DISPLAY_LIVE = true;
// Does a Ship Systems row or hull card line show `berths` guest quarters: only once the display is live (above), and
// only when there are some. `live` is for the tests. Pure.
export function guestQuartersShown(berths: number, live: boolean = GUEST_QUARTERS_DISPLAY_LIVE): boolean {
  return live && berths > 0;
}

export const SHIP_TYPES: Record<ShipTypeKey, ShipTypeDef> = {
  // ⚠️ FUEL STATS ARE FIRST-PASS TUNABLE ⚠️ The fuelCapacity / engineEfficiency
  // values below establish the four hulls' fuel PROFILES (design §3): the Freighter
  // is the RANGE hull (largest tank, zero efficiency = baseline 1:1 burn), the Runner
  // is the EFFICIENCY hull (smallest tank, highest efficiency = least burn), and the
  // Hauler / Prospector sit between on both axes. Ordering invariants (asserted in
  // fuel.test.ts) matter more than the exact numbers here: Freighter tank > Hauler/
  // Prospector > Runner, and Runner efficiency > the rest > Freighter (0). Retuned at
  // the device-check stage alongside FUEL_PER_TICK / fuel-storage caps.
  generalFreighter: {
    label: "General Freighter", spec: "general", tier: 1,
    cargoCapacity: 90, transitSpeedMult: 1.0, extractionYieldMult: 1.0,
    fuelCapacity: 200, engineEfficiency: 0, // range hull: big tank, baseline burn
    moduleSlots: 1, equipmentSlots: 0,
    basePowerOutput: 85, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / INERT (0.12.0 combat): range hull, tough frame, modest shields, one hardpoint.
    hullIntegrity: 500, shieldCapacity: 200, shieldRecharge: 5, weaponHardpoints: 2,
    // CHEAPEST hull to build (the starter/fallback): a small frame + coupling BOM, no
    // major assembly. ⚠️ FIRST-PASS TUNABLE (see ShipTypeDef.buildRecipe).
    buildRecipe: { components: { frameSegment: 4, powerCoupling: 2 }, credits: 500, durationTicks: 300 },
    // G1-1: a few guest berths (HULL_GUEST_QUARTERS, [PROVISIONAL]).
    colonistCapacity: HULL_GUEST_QUARTERS.generalFreighter,
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 3 Security, 3 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 3 },
      { teamType: "science", size: 3 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "A no-frills hauler. Every captain's starter and emergency fallback.",
  },
  prospectorHauler: {
    label: "Hauler", spec: "prospector", tier: 1,
    cargoCapacity: 180, transitSpeedMult: 0.8, extractionYieldMult: 1.0,
    fuelCapacity: 160, engineEfficiency: 0.15, // between: mid tank, mild efficiency
    moduleSlots: 2, equipmentSlots: 0,
    basePowerOutput: 85, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / INERT (0.12.0 combat): biggest hull, most integrity + shields, slow regen.
    hullIntegrity: 700, shieldCapacity: 250, shieldRecharge: 4, weaponHardpoints: 2,
    // MOST EXPENSIVE to build (double cargo): the biggest frame BOM + 2 major
    // assemblies + the longest build. ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 8, powerCoupling: 5, structuralAssembly: 2 }, credits: 1400, durationTicks: 700 },
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 3 Security, 3 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 3 },
      { teamType: "science", size: 3 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "Doubles cargo at the cost of speed, big hauls, longer runs.",
  },
  prospectorRunner: {
    label: "Runner", spec: "prospector", tier: 1,
    cargoCapacity: 60, transitSpeedMult: 1.5, extractionYieldMult: 1.0,
    fuelCapacity: 100, engineEfficiency: 0.5, // efficiency hull: small tank, least burn
    moduleSlots: 2, equipmentSlots: 0,
    basePowerOutput: 50, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / INERT (0.12.0 combat): fast + fragile, least integrity, quickest shield regen.
    hullIntegrity: 300, shieldCapacity: 150, shieldRecharge: 8, weaponHardpoints: 1,
    // MID build (fast but small hold): a lighter frame BOM than the extraction hulls +
    // 1 major assembly. ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 4, powerCoupling: 4, structuralAssembly: 1 }, credits: 900, durationTicks: 450 },
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 3 Security, 3 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 3 },
      { teamType: "science", size: 3 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "Fast transit, small hold, rapid short cycles.",
  },
  prospectorMiner: {
    label: "Prospector", spec: "prospector", tier: 1,
    cargoCapacity: 90, transitSpeedMult: 1.0, extractionYieldMult: 1.35,
    fuelCapacity: 140, engineEfficiency: 0.25, // between: mid tank, moderate efficiency
    moduleSlots: 2, equipmentSlots: 0,
    basePowerOutput: 50, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / INERT (0.12.0 combat): mid extraction rig, balanced defensive profile.
    hullIntegrity: 450, shieldCapacity: 180, shieldRecharge: 6, weaponHardpoints: 1,
    // ABOVE-MID build (specialized extraction rig): a heavier BOM than the Runner +
    // 1 major assembly, below the Hauler. ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 6, powerCoupling: 4, structuralAssembly: 1 }, credits: 1100, durationTicks: 550 },
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 3 Security, 3 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 3 },
      { teamType: "science", size: 3 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "Specialized extraction rig, more materials per tick.",
  },

  // --- COMBAT HULLS (Combat 0.13.0, Phase 9a, design S3 / S8 / S19) ----------------
  // ⚠️ COMBAT STATS ARE NOW LIVE (not display-only): hullIntegrity / shieldCapacity /
  // shieldRecharge / weaponHardpoints feed combat/bridge.ts -> resolveBattle. Each of
  // the three classes gets a DISTINCT, FIRST-PASS-TUNABLE profile that expresses its
  // identity (destroyer = fast striker, battleship = slow tank, carrier = drone
  // platform). ⚠️ EVERY NUMBER HERE IS FIRST-PASS + TUNABLE (design S20 owns balance).
  //
  // NON-COMBAT fields are deliberately MINIMAL for a warship: a warship carries little
  // cargo, has neutral extraction (it is not a miner), and modest fuel. They are still
  // POSITIVE + valid (the fuel loop asserts fuelCapacity > 0 / engineEfficiency >= 0)
  // so a warship remains a structurally-valid hull the economy code can reason about,
  // it just is not the tool for a mining run. tier > 1 encodes combat-progression
  // intent; the actual build-gate that reads it is Phase 9b (canBuildShip has none yet).
  destroyer: {
    label: "Destroyer", spec: "tactician", tier: 2,
    // Fast strike hull: quick transit, tiny hold (it is not a hauler), neutral extraction.
    cargoCapacity: 30, transitSpeedMult: 1.3, extractionYieldMult: 1.0,
    fuelCapacity: 130, engineEfficiency: 0.2, // nimble: mid-small tank, decent efficiency
    moduleSlots: 2, equipmentSlots: 0,
    basePowerOutput: 160, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / LIVE (combat): FAST + fragile-ish striker. Solid hull, strong fast-
    // regen shields, but FEWER weapon hardpoints than the battleship (a raider, not a
    // gun platform). Default loadout = 2 fast weapons (see COMBAT_DEFAULT_LOADOUT).
    hullIntegrity: 600, shieldCapacity: 300, shieldRecharge: 10, weaponHardpoints: 4,
    // Combat hull BOM: heavier than the economy hulls (more assemblies), a mid-length
    // build. ⚠️ FIRST-PASS TUNABLE. (9b re-tunes alongside the research gate.)
    buildRecipe: { components: { frameSegment: 6, powerCoupling: 5, structuralAssembly: 2 }, credits: 2000, durationTicks: 600 },
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 4 Security, 3 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 4 },
      { teamType: "science", size: 3 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "A fast strike hull. Quick shields, fewer guns, closes and hits hard.",
  },
  battleship: {
    label: "Battleship", spec: "tactician", tier: 3,
    // Warship research gate (Phase 9b): the battleship is a tier-3 capital hull, gated behind
    // its OWN unlock-only blueprint so a player earns capital-ship access by researching it
    // (separate from the carrier's, so the two are independent unlock choices). The destroyer
    // (the combat line's free entry tier) carries NO requiresBlueprint by contrast.
    requiresBlueprint: "battleshipHullBp",
    // Slow line hull: sluggish transit, small hold, neutral extraction.
    cargoCapacity: 40, transitSpeedMult: 0.7, extractionYieldMult: 1.0,
    fuelCapacity: 180, engineEfficiency: 0.05, // heavy: big tank, near-baseline burn
    moduleSlots: 3, equipmentSlots: 0,
    basePowerOutput: 230, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / LIVE (combat): the TANK. MOST hull + shields of any hull and the MOST
    // weapon hardpoints (a wall of guns), at the cost of SLOW movement + slow shield
    // regen. Default loadout = 3 heavy weapons (see COMBAT_DEFAULT_LOADOUT).
    hullIntegrity: 1400, shieldCapacity: 600, shieldRecharge: 6, weaponHardpoints: 6,
    // Heaviest BOM + longest build of any hull (a capital ship). ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 14, powerCoupling: 10, structuralAssembly: 5 }, credits: 5000, durationTicks: 1200 },
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 4 Security, 3 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 4 },
      { teamType: "science", size: 3 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "A slow capital hull. The most armor, shields, and guns the fleet fields.",
  },
  carrier: {
    label: "Carrier", spec: "tactician", tier: 3,
    // Warship research gate (Phase 9b): the carrier gates behind its OWN unlock-only blueprint,
    // distinct from the battleship's, so researching one does NOT grant the other, the player
    // picks which capital line to unlock first.
    requiresBlueprint: "carrierHullBp",
    // Drone platform: slow-ish transit, smallest hold (space given to the bays),
    // neutral extraction.
    cargoCapacity: 25, transitSpeedMult: 0.8, extractionYieldMult: 1.0,
    fuelCapacity: 170, engineEfficiency: 0.1, // large hull: mid-large tank, mild efficiency
    moduleSlots: 2, equipmentSlots: 0,
    basePowerOutput: 110, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / LIVE (combat): the DRONE platform. Tough (second only to the
    // battleship) but with REDUCED weapon hardpoints (design S8: carriers trade
    // hardpoints for built-in hangar bays). Its offense is its drone screen, NOT its
    // guns. Default loadout = 1 weapon + an Attack squadron (see COMBAT_DEFAULT_LOADOUT;
    // the carrier's built-in bay count lives there too until the hangar-gear system).
    hullIntegrity: 1100, shieldCapacity: 500, shieldRecharge: 7, weaponHardpoints: 2, droneBays: 2,
    // Heavy BOM (a big hull), just under the battleship. ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 12, powerCoupling: 10, structuralAssembly: 4 }, credits: 4800, durationTicks: 1150 },
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 4 Security, 3 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 4 },
      { teamType: "science", size: 3 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "A drone platform. Few guns, but launches squadrons that fight for it.",
  },

  // --- EXPLORER HULLS (0.14.0 Exploration Phase E0, design Part B) ------------------
  // ⚠️ EVERY NUMBER HERE IS FIRST-PASS + TUNABLE (a later tuning pass owns balance),
  // the SAME launch-placeholder spirit as the combat + economy hulls above.
  //
  // The LOCKED glass-tank archetype (design B.1 / B.2 / B.4), shared by all three:
  //   RANGE    : fuelCapacity is the HIGHEST in the fleet (all > the freighter's 200, the
  //              old fleet max) + a good engineEfficiency. These are the reach hulls: an
  //              unexplored world sits so far out that an ordinary ship runs dry before
  //              arriving, so the explorer spends huge power to balance velocity vs stamina.
  //   SHIELDS  : shieldCapacity is the STRONGEST in the fleet (all > the battleship's 600)
  //              with a strong recharge. ⚠️ This intentionally raises the roster's shield-cap
  //              EFFECTIVENESS ceiling above the old battleship 2.0x (Orion is 800/300 =
  //              ~2.67x, see REF_SHIELD_CAPACITY): the explorer IS the strongest-shield hull
  //              by design. Still far under the retired x5 amplifier, so no runaway shields.
  //   HULL     : hullIntegrity is LOW / frail (around the runner's 300, well below any combat
  //              hull): a "pre-beaten pinata" the instant the shields drop.
  //   WEAPONS  : minimal, weaponHardpoints 1 and NO drone bays. Terrible offense: fine against
  //              underpowered foes, overmatched by anything organized (weapons are utility/
  //              survey, not guns). Default loadout = 1 autocannon (see COMBAT_DEFAULT_LOADOUT).
  //   CARGO    : better-than-normal (long trips need supplies), Eir the largest in the fleet.
  //   MODULES  : MORE module slots than any combat hull (battleship 3 is the combat max), the
  //              explorer/science identity, Aurora the most. Still INERT (no module system yet).
  //
  // tier 2: entry explorers, a mid-game capital-class hull (a step above the tier-1 economy
  // line, alongside the tier-2 destroyer). ACQUISITION: blueprint-gated capital builds, exactly
  // like the battleship / carrier (one unlock-only blueprint each, so the three are independent
  // unlock choices). The blueprints are tier 2, RESEARCHABLE at the Research Lab's current
  // level-2 ceiling (NOT a dead gate: the warship hull blueprints prove tier-2 research works
  // today). ⚠️ This is E0's placeholder gate ONLY: the REAL discovery-gated acquisition (finding
  // an explorer hull in the field) is a later phase (E4 research); the blueprint keeps them
  // well-formed + earnable now without stranding them.
  //
  // ⚠️ DEFERRED (design I.6 / A.6 / B.3): NO base-hull sensors stat (ShipTypeDef has no sensors
  // field; the explorer sensor advantage arrives with the sensor-consumer phase) and NO B.3
  // power-allocation preset (fixed stats chosen for E0). E0's explorer identity == the range /
  // shield / cargo / module / frail-hull profile only.
  orion: {
    label: "Orion", spec: "explorer", tier: 2, // FIRST-PASS TUNABLE
    // Blueprint-gated capital build (E0 placeholder; real E4 discovery gate deferred). Its OWN
    // unlock-only blueprint, distinct from Aurora's / Eir's, so each explorer is an independent unlock.
    requiresBlueprint: "orionHullBp",
    // The CORE long-range explorer: a BALANCED glass tank (the Enterprise-D generalist). Good at
    // everything an explorer does, best at nothing. FIRST-PASS TUNABLE.
    cargoCapacity: 120, transitSpeedMult: 1.1, extractionYieldMult: 1.0, // FIRST-PASS TUNABLE
    fuelCapacity: 340, engineEfficiency: 0.35, // FIRST-PASS TUNABLE: highest-tier range + good reach efficiency
    moduleSlots: 4, equipmentSlots: 0, // FIRST-PASS TUNABLE: 4 > any combat hull (battleship 3), the explorer identity
    basePowerOutput: 130, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / LIVE (combat): the glass tank. Huge shields, frail hull, one token gun.
    hullIntegrity: 340, shieldCapacity: 800, shieldRecharge: 12, weaponHardpoints: 1, // FIRST-PASS TUNABLE
    // Capital-class BOM (between the destroyer and the battleship). ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 10, powerCoupling: 8, structuralAssembly: 3 }, credits: 4200, durationTicks: 1000 },
    // G1-1: an explorer's guest berths (HULL_GUEST_QUARTERS, [PROVISIONAL]).
    colonistCapacity: HULL_GUEST_QUARTERS.orion,
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 3 Security, 4 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 3 },
      { teamType: "science", size: 4 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "A long-range explorer. Enormous shields and reach, a frail hull, and almost no guns.",
  },
  aurora: {
    label: "Aurora", spec: "explorer", tier: 2, // FIRST-PASS TUNABLE
    requiresBlueprint: "auroraHullBp",
    // The SENSOR / scout specialist: leaner combat, the MOST module slots in the fleet, the best
    // straight-line transit, neutral-to-high extraction. Still a glass tank. FIRST-PASS TUNABLE.
    cargoCapacity: 100, transitSpeedMult: 1.3, extractionYieldMult: 1.1, // FIRST-PASS TUNABLE: fastest explorer
    fuelCapacity: 320, engineEfficiency: 0.4, // FIRST-PASS TUNABLE: highest-tier range + best reach efficiency
    moduleSlots: 5, equipmentSlots: 0, // FIRST-PASS TUNABLE: 5, the MOST in the fleet (survey/science identity)
    basePowerOutput: 150, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / LIVE (combat): the frailest explorer (leanest combat), quick shields.
    hullIntegrity: 300, shieldCapacity: 720, shieldRecharge: 14, weaponHardpoints: 1, // FIRST-PASS TUNABLE
    // Capital-class BOM, a touch lighter than Orion (leaner combat frame). ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 9, powerCoupling: 8, structuralAssembly: 3 }, credits: 3900, durationTicks: 950 },
    // G1-1: an explorer's guest berths (HULL_GUEST_QUARTERS, [PROVISIONAL]).
    colonistCapacity: HULL_GUEST_QUARTERS.aurora,
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 3 Security, 4 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 3 },
      { teamType: "science", size: 4 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "A survey scout. The most module slots and the fastest cruise, at the cost of frame and hold.",
  },
  eir: {
    label: "Eir", spec: "explorer", tier: 2, // FIRST-PASS TUNABLE
    requiresBlueprint: "eirHullBp",
    // The crew-landing / evac TRANSPORT: the BIGGEST cargo (supplies + refugees) and, via the
    // explorer complement band, the biggest CREW capacity, with modest everything else. Still a
    // glass tank. FIRST-PASS TUNABLE.
    cargoCapacity: 220, transitSpeedMult: 0.9, extractionYieldMult: 1.0, // FIRST-PASS TUNABLE: biggest hold, slower heavy transport
    fuelCapacity: 300, engineEfficiency: 0.3, // FIRST-PASS TUNABLE: still highest-tier range, modest among explorers
    moduleSlots: 4, equipmentSlots: 0, // FIRST-PASS TUNABLE: 4 > any combat hull (battleship 3)
    basePowerOutput: 120, // E-MOD EM-1 (P1): the hull's own power, at or above its heaviest crafted loadout
    // ⚠️ TUNABLE / LIVE (combat): a touch tougher frame than the other explorers (a big transport)
    // but still frail vs its shields, modest recharge.
    hullIntegrity: 360, shieldCapacity: 700, shieldRecharge: 10, weaponHardpoints: 1, // FIRST-PASS TUNABLE
    // Heaviest explorer BOM (the biggest frame). ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 12, powerCoupling: 8, structuralAssembly: 4 }, credits: 4600, durationTicks: 1100 },
    // G1-1: the evac transport's big guest wing (HULL_GUEST_QUARTERS, [PROVISIONAL]).
    colonistCapacity: HULL_GUEST_QUARTERS.eir,
    // E-CREW away squads (design section 5.2, FIRST-PASS TUNABLE): 4 Security, 4 Science; Prospecting 3 (hidden until unlocked).
    groundSquads: 4, // Squads SQ-1 (user 2026-10-12: DOUBLE EVERY HULL): 4 squads = 2 teams; bigger hulls get more later
    awayTeams: [
      { teamType: "security", size: 4 },
      { teamType: "science", size: 4 },
      { teamType: "prospecting", size: 3 },
    ],
    description: "A medical transport. The largest hold and crew the fleet fields, for supplies and evacuations.",
  },
};

// Ship display labels (0.13.9 hotfix).
// The ONE player-facing label for a ship, shared by every list, picker, queue row and
// log line. The BASE label is the player's custom name, else the hull-type label (else
// the raw id when the type is unknown, so nothing ever renders "undefined"). When another
// ship in the fleet would render the SAME base label, every ship in that clash gets a
// stable " #N" ordinal: its position among the clashing ships ordered by the numeric id
// from "ship-N". Ids are allocated monotonically and never reused, so the numbering is
// stable across sessions. A lone hull stays unsuffixed, and renaming a ship moves it out
// of its old clash (a clash of one drops the suffix). PURE.
export function shipBaseLabel(ship: ShipInstance): string {
  return ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.id;
}

// "ship-N" -> N; any other id sorts after every well-formed one (ties break on the raw id).
function shipIdOrdinal(id: string): number {
  const m = /^ship-(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function compareShipIds(a: string, b: string): number {
  const na = shipIdOrdinal(a);
  const nb = shipIdOrdinal(b);
  if (na !== nb) return na < nb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// The display label for ONE ship against its fleet. O(fleet); for a whole list at once
// use shipDisplayLabels. Fails open on a missing ships array (the ship reads unsuffixed).
export function shipDisplayLabel(
  state: { readonly ships?: readonly ShipInstance[] } | null | undefined,
  ship: ShipInstance,
): string {
  const base = shipBaseLabel(ship);
  const ships = Array.isArray(state?.ships) ? state.ships : [];
  let clash = false;
  let rank = 1;
  for (const other of ships) {
    if (other.id === ship.id) continue;
    if (shipBaseLabel(other) !== base) continue;
    clash = true;
    if (compareShipIds(other.id, ship.id) < 0) rank++;
  }
  return clash ? `${base} #${rank}` : base;
}

// Every ship's display label at once (id -> label), the batched form for lists that
// label the whole fleet (the Ships roster). Same rule as shipDisplayLabel. PURE.
export function shipDisplayLabels(ships: readonly ShipInstance[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const ship of ships) {
    const base = shipBaseLabel(ship);
    const ids = groups.get(base);
    if (ids) ids.push(ship.id);
    else groups.set(base, [ship.id]);
  }
  const out = new Map<string, string>();
  for (const [base, ids] of groups) {
    if (ids.length === 1) {
      out.set(ids[0], base);
      continue;
    }
    ids.sort(compareShipIds);
    ids.forEach((id, i) => out.set(id, `${base} #${i + 1}`));
  }
  return out;
}

// --- Fuel economy constants (Mission Rework Task 3, design §3) -------------------
// Both FIRST-PASS TUNABLE, same launch-placeholder spirit as MISSIONS'/SHIP_TYPES'
// numbers, real balancing at the device-check stage.
//   FUEL_PER_TICK        , fuel burned per round-trip transit tick.
//                            the numerator scale in fuel.ts's fuelNeeded.
//   FUEL_CREDITS_PER_UNIT, the price the F3 auto-buy-shortfall path charges per fuel unit. (WR-4: Buy Fuel,
//                            the other spender, is retired, user 2026-10-16 credit sinks pass; the mission
//                            auto-buy plumbing itself is unreachable since 0.13.6, its fuel budget is
//                            infinite, and its removal waits on the fuel-economy cleanup call, S4-A02.)
// Kept as plain numbers (not Decimal): fuel amounts are small, non-idle-scale values.
//
// ⚠️ FUEL ECONOMY v2 RETUNE (device feedback 2026-07-15) ⚠️ FUEL_PER_TICK was REVERTED
// 0.1 -> 1 (back to the original v1 value). HISTORY: F3 first DROPPED it 1 -> 0.1 fearing a
// dry-tank bankruptcy, but on-device play showed 0.1 was TOO GENEROUS, the Fuel Depot's
// refining trivially dwarfed the tiny 0.1 consumption (three captains ran ~+1.19k fuel/min
// net-positive with NO upgrades), so fuel was a non-factor, not a managed resource. At 1 a
// round trip costs 1 fuel per transit tick (the meaningful value): Freighter
// (engineEfficiency 0) shortOreRun = 50 transit ticks * 1 = 50 fuel/cycle. This stays
// SUSTAINABLE, NOT bankrupting: a fresh full 500 tank plus the F2 Fuel Depot's refining
// (100 fuel / 10-tick batch = 10 fuel/tick) still FAR outpaces a mission's consumption
// (50 fuel / 149-tick cycle ~= 0.34 fuel/tick), refining alone keeps a fresh game afloat
// with no credit spend. It just makes fuel a real resource again, so credit auto-buy (F3)
// is a genuine short-tank backstop rather than a never-triggered branch. FIRST-PASS TUNABLE.
// The Freighter's integer needs (short 50 / long 140 / salvage 90 / forage 110) keep the
// Decimal fuel-tank deductions EXACT, load-bearing for the F3 offline==live parity proof.
export const FUEL_PER_TICK = 1;
// Fuel-sourcing RESTRUCTURE (2026-07-15): 5 -> 20. Credit auto-buy is now an EXPENSIVE
// convenience / soft-lock escape hatch, NOT a cheap crutch: the intended fuel path is
// refining Deuterium Ice (mined free on localFuelRun) at the Fuel Depot. At 20cr/unit a
// Freighter shortOreRun empty-tank top-up costs 50*20 = 1000cr (vs its 30cr reward), so
// leaning on auto-buy bleeds credits fast, deliberately steering the player to refine.
// FIRST-PASS TUNABLE, same launch-placeholder spirit as the constants above.
export const FUEL_CREDITS_PER_UNIT = 20;

// ⚠️ FUEL ECONOMY v2 (F3, design §3): the "+2 ticks" refuel-at-a-non-allied-station delay
// added to a mission cycle whenever that cycle had to AUTO-BUY its fuel shortfall from
// credits (tank was short at the cycle boundary but the shortfall was affordable). Modelled
// CLOSED-FORM as a per-cycle addition to the ordersReceived phase's required ticks (stored
// on CaptainMissionState.refuelDelayTicks, set when the auto-buy fires) so it advances
// identically whether the span is one big tick() call or many stepped economyTick(_,1)
// calls, the offline==live parity guarantee. FIRST-PASS TUNABLE (device-retuned).
export const REFUEL_PENALTY_TICKS = 2;

// WR-4 (OC-C1, user 2026-10-16 "Turn into range": the Fuel Depot's storage levels become a fleet reach bonus).
// The share of every ship's reach one built Fuel Depot rung adds; tick.ts fleetReachBonus sums it over the reached
// rungs and shipReachDef applies it to every ship (the mission and patrol dispatch gates and every range readout
// read that one seam). Linear per rung on a finite 9-rung track. [PROPOSAL] 5% per rung (45% at the top), the
// user tunes it. The retired tank (FUEL_TANK_BASE_CAP) and refinery (FUEL_REFINE_*, FUEL_DEPOT_BASE_PIPELINES)
// constants went with the fuel stockpile (save v70).
export const FUEL_DEPOT_REACH_PER_RUNG = 0.05;

// A concrete ship in the fleet, an instance of one SHIP_TYPES hull. Distinct
// from ShipTypeDef (the shared, immutable stat template): a ShipInstance is the
// mutable, per-ship record. Its `assignedCaptainId` is the SINGLE SOURCE OF
// TRUTH for who flies this hull (null = parked/available), deliberately not
// duplicated onto CaptainState, so the two never disagree. Consumed by later
// tasks (fleet state, assignment UI); nothing reads it yet.
export interface ShipInstance {
  id: string;                       // stable unique id, allocated from GameState.nextShipId ("ship-N")
  typeKey: ShipTypeKey;
  assignedCaptainId: number | null; // SINGLE SOURCE OF TRUTH for assignment; null = parked/available
  // Optional player-chosen ship name (Renamable Ships). ADDITIVE + OPTIONAL: absent
  // means the ship shows its hull-type label (SHIP_TYPES[typeKey].label) as its display
  // name, so a pre-feature save (and every never-renamed ship) reads as undefined and
  // needs NO save migration (a plain optional string serializes cleanly; JSON drops an
  // undefined key). Written ONLY through renameShip (tick.ts) behind the same
  // validateCaptainName courtesy gate captain names use; an empty/whitespace rename
  // CLEARS it back to undefined (the hull-label default). The player-facing display name
  // is `name ?? SHIP_TYPES[typeKey].label`, and the hull class stays visible as a subtitle.
  name?: string;
  // Combat 0.13.0 (Phase 9b.5c): set true when a PATROL this ship flew ended in DEFEAT
  // (the wave loop in tick.ts flags it). OPTIONAL so absent === not damaged: a pre-9b.5c
  // save (and every ship that never lost a patrol) reads as undefined, so NO save
  // migration is needed (the same absent-is-default pattern refuelDelayTicks uses).
  // Combat 0.13.0 (Phase 11, design S13): TRUE once a patrol this ship flew ended in DEFEAT
  // AND the ship has limped home (the limp-home phase completes in tickCaptainPatrol, then
  // economyTick raises this + repairDamage together). While true the ship CANNOT be
  // re-dispatched (canDispatch / canDispatchPatrol both gate on it with the `needsRepair`
  // reason); a completing shipRepair process (resolveProcesses' clearShipDamage branch)
  // lowers it back to undefined. Still OPTIONAL so absent === not damaged: a pre-P11 save
  // (and every ship that never lost a patrol) reads as undefined, so NO save migration is
  // needed (the same absent-is-default posture refuelDelayTicks + this field's own 9b.5c
  // introduction used).
  damaged?: boolean;
  // Combat 0.13.0 (Phase 11, design S13): the HULL POINTS this ship must have repaired,
  // captured at the DEFEAT instant as (hullIntegrity - carry-state hull) and stamped onto
  // the ship when it finishes limping home (economyTick). It is the SOLE input to the
  // repair-duration formula (shipRepairDurationTicks), so a heavier hull that took more
  // damage repairs longer. OPTIONAL / absent-is-default like `damaged`: absent on every
  // healthy ship and on a pre-P11 save, so NO migration is needed. Defensive floor: if a
  // ship is somehow `damaged` with repairDamage absent (a hand-edited save), the repair
  // formula falls back to the hull's full integrity so the ship can still be repaired.
  // Cleared (back to undefined) together with `damaged` when the repair completes.
  repairDamage?: number;
  // E-CREW 0.14.0 (Task 21): repair ticks the Engineering department's CUNNING over-delivery took off the
  // NEXT Shipyard repair (stamped with repairDamage when a patrol limps home from a cycle whose roll
  // succeeded, PatrolMissionState.freeRepairTicks). The repair duration subtracts it (never below 1 tick);
  // cleared with the damage. OPTIONAL, absent = none (no SAVE_VERSION bump).
  freeRepairTicks?: number;
  // Crew 0.14.0 (Phase 0, DORMANT): this ship's crew population (signature buckets + the
  // per-ship passive/active toggle). OPTIONAL + absent-is-default like `damaged`/`repairDamage`:
  // a pre-0.14.0 save (and any ship created off a path that does not seed it) reads as undefined,
  // and every reader defaults an absent complement to { buckets: [], mode: "passive" }. freshState
  // seeds it on the starting hull; the v54->v55 migration backfills the same default onto existing
  // ships. NOTHING reads or writes it yet (auto-crew + rollup are later phases).
  complement?: ShipComplement;
  // Ground Operations 0.14.0 (GO-1, D25): this ship's GROUND TEAMS (see ShipGroundTeam). Length =
  // groundTeamCount(typeKey) (2 on every hull since Squads SQ-1 / SAVE v68; 1 before). freshState seeds the
  // starting hull; the v66 -> v67 migration backfilled every ship by hire order and the v67 -> v68 step
  // stamps each existing team Ground and appends an empty Ground pair marked kindPending.
  // OPTIONAL + absent-safe: a ship minted without it (shipBuild, the captain-unlock grant) reads as the
  // hull's empty teams (Ground + Ground, no pending flag) through groundTeams.ts shipGroundTeams. GO-2's slot
  // actions and the hire / fire / reassign sync write it; dispatch reads it since Ground Ops GO-7b.
  groundTeams?: ShipGroundTeam[];
  // FORWARD (not this pass): modules?, equipment?, reactorCore?, tierOverride?
}

// Ground Operations 0.14.0 (GO-1, D25, plan 2026-10-09 section 2): one ground team's slot state on a ship.
// Members are outfitted first, then SLOTTED into a squad of a chosen ground team (user, D25 clarified).
// Each slot holds an AwayMember id (a member aboard THIS ship with the matching teamType) or null for an
// empty slot; slot order is deploy order. A member sits in at most one slot fleet-wide (GO-2 enforces it).
// Members aboard but in no slot are the ship's reserve: they do not deploy.
// Squads SQ-1 (SAVE v68, design section 2.3, user-approved "flat slots + team kind"): a team is a PAIR of
// typed squads and its KIND names the pair: Ground = 1 Security + 1 Science (GO-1's exact shape), Strike = 2
// Security, Survey = 2 Science (user names). The slot lists stay FLAT and squad-major, sized by the kind:
//   security.length = securitySquadsOf(kind) * groundSquadSize(hull, "security")
//   science.length  = scienceSquadsOf(kind)  * groundSquadSize(hull, "science")
// Squad k of a type holds slots [k * size, (k + 1) * size); a Strike team's science list is empty, a Survey
// team's security list is empty. groundComposition.ts holds the kind math.
// Prospecting squads (0.14.0, built HIDDEN; design 2026-10-16 section 6, user "Type + two team kinds"): two
// more kinds field the third squad type, Claim = 1 Security + 1 Prospecting (Security guards the dig) and Dig =
// 2 Prospecting (names [PROPOSAL], kept by the user). No real save can hold either while Prospecting is locked
// (groundTeams.ts setGroundTeamKind refuses them with "kindLocked").
export type GroundTeamKind = "ground" | "strike" | "survey" | "claim" | "dig";

export interface ShipGroundTeam {
  // Player-chosen name. ABSENT (or blank) = the default by index (groundTeams.ts GROUND_TEAM_DEFAULT_NAMES:
  // Alpha / Bravo / Charlie, user 9b.7). The short label (A / B / C) always goes by index.
  name?: string;
  kind: GroundTeamKind; // the team type (SQ-1, v68); a missing or unknown stored kind reads as "ground"
  security: (string | null)[]; // length = securitySquadsOf(kind) * groundSquadSize(typeKey, "security")
  science: (string | null)[]; // length = scienceSquadsOf(kind) * groundSquadSize(typeKey, "science")
  // Prospecting squads (hidden, design section 6): the Prospecting slots, squad-major like the other two. PRESENT
  // only on a kind that fields a Prospecting squad (Claim, Dig), length = prospectingSquadsOf(kind) *
  // groundSquadSize(typeKey, "prospecting"); ABSENT reads as [] (every Ground / Strike / Survey team, so every
  // existing save and golden keeps its exact shape). Optional + absent-safe: no SAVE_VERSION bump.
  prospecting?: (string | null)[];
  // "When done, help other teams" (D25): the ship's default for the NEXT dispatch (GO-7c reads it).
  helpOthers: boolean;
  // SQ-1 (v68): set ONLY on the pair the v67 -> v68 migration adds, so the Away Team tab can prompt "Pick a
  // type"; cleared the first time the player confirms or changes this team's kind (SQ-2 / SQ-7). It still
  // reads and deploys as Ground (user: the migrated second pair defaults to Ground). Absent = no prompt.
  kindPending?: true;
  // Field Kits FKR-7 (FK4 "One per member"): memberId -> the kits that Security member packs for the NEXT dispatch (their
  // pack preference; a member without an entry packs the default, N16 "1 of each usable kit"). Absent = every member on
  // the default. Optional + absent-safe: no SAVE_VERSION bump.
  packs?: Record<string, Partial<Record<FieldKitId, number>>>;
  // Field Kits FKR-7 (credit sinks pass "Quartermaster sells + top-up"): "Top up from the Quartermaster at launch". On, a
  // dispatch BUYS each member's shortfall against their pack at the Quartermaster's price, as credits allow; it never
  // blocks a launch. Stored only when on (absent = off, the default).
  topUp?: true;
}

// The first away-team entry of `teamType` on a hull (every squad of a type shares that entry's `size`).
// Undefined for an unknown hull or a missing entry.
function firstAwayTeamEntry(typeKey: ShipTypeKey, teamType: AwayTeamType) {
  return (SHIP_TYPES[typeKey]?.awayTeams ?? []).find((t) => t.teamType === teamType);
}

// How many GROUND TEAMS a hull fields: its groundSquads / 2 (Squads SQ-1: a team is a pair of squads; 2 on
// every hull today). Before SQ-1 this read the Security entry's `count` (1 everywhere); the frozen v67 shape
// guard in groundTeams.ts still reads that count for the v66 -> v67 step. 0 for an unknown hull. Pure.
// Lives here (not in groundTeams.ts, which re-exports it) because freshState seeds the starting hull's teams
// and model.ts must not import groundTeams.ts (that module imports this one).
export function groundTeamCount(typeKey: ShipTypeKey): number {
  const squads = SHIP_TYPES[typeKey]?.groundSquads ?? 0;
  return Number.isFinite(squads) ? Math.max(0, Math.floor(squads / 2)) : 0;
}

// The member slots in ONE ground team's `teamType` squad on a hull: the matching entry's `size`; 0 when the
// hull lists no such squad. Prospecting reads the hull's existing prospecting entry (3 on every hull). Pure.
export function groundSquadSize(typeKey: ShipTypeKey, teamType: AwayTeamType): number {
  return Math.max(0, firstAwayTeamEntry(typeKey, teamType)?.size ?? 0);
}

// A hull's ground teams with every slot empty: every team GROUND (1 + 1, the default composition, SQ-1), no
// custom names, help toggles off, no pending flag. Fresh arrays per call. Pure.
export function emptyGroundTeams(typeKey: ShipTypeKey): ShipGroundTeam[] {
  const sec = groundSquadSize(typeKey, "security");
  const sci = groundSquadSize(typeKey, "science");
  return Array.from({ length: groundTeamCount(typeKey) }, () => ({
    kind: "ground" as const,
    security: Array.from({ length: sec }, () => null),
    science: Array.from({ length: sci }, () => null),
    helpOthers: false,
  }));
}

// --- Ship repair tunables (Combat 0.13.0, Phase 11, design S13) ------------------
// The DETERMINISTIC repair-duration formula the Shipyard uses to fix a limped-home hull:
//   durationTicks = REPAIR_BASE_TICKS + ceil(repairDamage * REPAIR_TICKS_PER_HULL)
// Integer math, no RNG, FIXED at process creation (shipRepairDurationTicks, tick.ts), so a
// repair job is closed-form / offline==live exactly like a shipBuild. `repairDamage` is the
// hull points lost (see ShipInstance.repairDamage), so a bigger hull that took more damage
// repairs longer, tying the cost to the damage taken (design S13). ⚠️ ALL FIRST-PASS TUNABLE
// (real balancing at the S20 pass), same launch-placeholder spirit as the constants above.
//   REPAIR_BASE_TICKS       , a flat floor so even a lightly-damaged hull spends real time.
//   REPAIR_TICKS_PER_HULL   , ticks added per hull point lost (0.5 -> ~half the lost-hull
//                             count in ticks, e.g. a destroyer losing its full 600 hull =
//                             REPAIR_BASE_TICKS + 300 ticks).
export const REPAIR_BASE_TICKS = 20;
export const REPAIR_TICKS_PER_HULL = 0.5;
// The Shipyard repair formula's base, ONE definition (Ground Ops GO-8b): REPAIR_BASE_TICKS + ceil(damage x
// REPAIR_TICKS_PER_HULL), DIVIDED by (1 + speedBonus) when the bonus is above 0 (ceil, at least 1 tick: the D23
// divisor, crewOverlay.ts officerRepairSpeedBonus). tick.ts shipRepairDurationTicks builds on it (then the Damage
// Control Suite and the Cunning free tick); groundOps.ts's expedition FIELD REPAIR reuses it. Pure.
export function repairTicksForDamage(damage: number, speedBonus: number = 0): number {
  const rawTicks = REPAIR_BASE_TICKS + Math.ceil(damage * REPAIR_TICKS_PER_HULL);
  return speedBonus > 0 ? Math.max(1, Math.ceil(rawTicks / (1 + speedBonus))) : rawTicks;
}
// Shipyard BAYS (Combat 0.13.0, Phase 11b, design S13 item 4): the SHARED build/repair bay
// model that GENERALIZES P11's dedicated single repair slot. Bays serve BOTH ship builds and
// ship repairs out of one pool; idle build capacity flexes into repair; a damaged hull with
// no open bay waits in a deterministic (monotonic ship-id) queue and claims a bay as one
// frees. The live count is DERIVED on read (shipyardBayCount, tick.ts) from these two knobs +
// the shipyard's existing upgrade level, so nothing new is persisted (bays are static-data +
// facility-level derived, repairs remain activeProcesses; NO SAVE_VERSION bump).
//
// ⚠️ ALL FIRST-PASS TUNABLE (real balancing at the S20 pass), launch-placeholder spirit.
//
//   SHIPYARD_BAY_BASE (2): bays a Shipyard has BEFORE any upgrade, including at level 0
//     (unfounded). A floor of 2, not 1, is the CONCURRENCY floor: it lets a build AND a repair
//     run at the same time (with a build using one bay, >= 1 remains for repair). It is NOT
//     what prevents the soft-lock, that is clauses (b)+(c) below, which hold even at a
//     hypothetical base of 1 (a build would just be capped to 0 bays, leaving the sole bay
//     claimable by repair). shipyardBayCount then adds TWO grants on top of this floor: +1 per
//     reached build-speed rung (level 2 -> 3 bays, level 3 -> 4), reusing the SAME
//     FACILITIES.shipyard rungs shipBuildSpeedMult reads, PLUS the sum of every reached
//     { addShipyardBays } BERTH rung (level 4 -> 5 bays, level 5 -> 6). Berths are the bays a
//     player deliberately BUYS; the speed-rung grant is kept because removing it would take
//     bays away from saves that already have them (see shipyardBayCount's data-loss note).
//
//   BUILD_CONCURRENCY_CAP (1): how many ship BUILDS may run at once, the multi-build cap.
//     DELIBERATELY HELD AT 1 this pass (owner directive, anti-regression): the bay system now
//     structurally SUPPORTS multi-build (raise this and shipBuildSlotCount flexes up to
//     bayCount - 1), but enabling it is a SEPARATE future toggle the owner will decide. With
//     cap 1 + base 2, shipBuildSlotCount = min(1, bayCount - 1) = 1, byte-identical to today.
//
// ⚠️ SOFT-LOCK INVARIANT (P11's loud comment, now ENFORCED not just warned): repair-bay
// capacity MUST stay >= 1 whenever any hull can be damaged, or a `damaged` hull PERMANENTLY
// soft-locks (needsRepair blocks dispatch, no free bay blocks processShipRepairs from ever
// starting its repair, and the hull-swap escape valve only PARKS the wreck, never heals it).
// Design S13's ">= 1 bay always reserved for repair" is the mitigation, and it is now
// STRUCTURALLY GUARANTEED, not left to a hard-coded 1. The ANTI-STRAND guarantee rests on
// clauses (b)+(c) alone; clause (a) is a background fact about how many bays exist, NOT
// load-bearing for it (see the SHIPYARD_BAY_BASE note: even a base of 1 would not strand
// repairs, it would only forbid concurrent building):
//   (a) shipyardBayCount >= SHIPYARD_BAY_BASE (2) at EVERY shipyard level, including 0, so
//       there are always >= 2 bays total. (This is the concurrency floor, not the anti-strand
//       guarantee; (b)+(c) below are what actually prevent the soft-lock.)
//   (b) shipBuildSlotCount caps builds at bayCount - 1 ("builds use all-but-one bay"), so
//       active builds can NEVER occupy the last bay -> >= 1 bay is always repair-reachable.
//   (c) repairs use ANY free bay (free = bayCount - active builds - active repairs), so with
//       no repair in flight there is always >= 1 free bay a damaged hull can claim.
// Together (b)+(c) mean no reachable state strands a damaged hull (see the soft-lock invariant
// test in ship-repair.test.ts). The reservation holds even if EITHER number changes: the cap
// is expressed as min(BUILD_CONCURRENCY_CAP, bayCount - 1), not a literal.
export const SHIPYARD_BAY_BASE = 2;
export const BUILD_CONCURRENCY_CAP = 1;

// ============================================================================
// Equipment 0.11.0 (Task 1): rarity / ascension / slot vocabulary + the
// per-instance equipment record. DATA/TYPES ONLY this task, no generation,
// fitting, GameState wiring, or stat fold-in yet (those are later tasks).
// ============================================================================

// The slot an equipment piece occupies. The first four are the LIVE slots this
// patch actually fits and reads. The rest are DEFINED but have no consumer in
// 0.11.0: they are forward hooks for 0.12.0's fuller fitment grid, populated
// here so the union and any exhaustive switches over it are stable before their
// system lands. Same POPULATED-but-INERT spirit as SHIP_TYPES.moduleSlots.
export type EquipmentSlotType =
  // LIVE economy slots:
  | "cargoBay"
  | "ftlDrive"
  | "reactorCore"
  | "specUtility"
  // LIVE combat slots (Combat 1.0): shieldEmitters + hullPlating (Unit 1.1) are singletons
  // that roll through the EQUIPMENT_SLOTS / generateEquipment economy path. weapon (Unit 1.2)
  // is a MULTI slot (fills a hull's hardpoints) minted through a SEPARATE table (WEAPON_DEFS +
  // generateWeapon), so it deliberately has NO EQUIPMENT_SLOTS entry.
  // droneBay (Unit 2.1a) is likewise a MULTI slot (a hull has several hangar bays, one pod each,
  // design S9 / DECISION 9a) minted through its OWN separate table (the drone ROLE_TEMPLATE +
  // generateDronePod), the DRONE analogue of weapon: so it too has NO EQUIPMENT_SLOTS entry.
  | "shieldEmitters"
  | "hullPlating"
  | "weapon"
  | "droneBay"
  // E-MOD EM-5 (0.14.0): the UNIVERSAL MODULE slot (H.1 accessories), a MULTI slot like weapon / droneBay, capped by
  // SHIP_TYPES[hull].moduleSlots TOGETHER with the specUtility piece (user M1 "Separate counts"; shipModules.ts).
  // Mints through EQUIPMENT_SLOTS.module (varieties = UNIVERSAL_MODULES ids) with its catalog id as moduleVariant.
  | "module"
  // RESERVED (defined, no consumer yet, forward hooks):
  | "bridge"
  | "quarters"
  | "thrusters"
  | "sensor"
  | "propellantTanks"
  // E-CREW 0.14.0 (Task 7): the four AWAY-TEAM MEMBER slots (design D3/D4). These are NOT ship slots:
  // a piece in one installs on a named away-team MEMBER (EquipmentInstance.fittedToMemberId), never on a
  // hull, and its ground stat lines (MEMBER_GROUND_STAT_KEYS) are never folded into ShipDerivedStats.
  // They ride the ship-system gear engine (EQUIPMENT_SLOTS varieties, BLUEPRINTS, generateEquipment), so
  // every ship-only list filters them out with isMemberSlotType.
  | "memberArmor"
  | "memberWeapon"
  | "memberTool"
  | "implant";

// E-CREW 0.14.0 (Task 7): the four away-team MEMBER slot types as data, and THE named predicate every
// ship-only list filters with. A member piece rides the shared gear engine (catalog, blueprints, rolls,
// salvage, storage), so any code that walks EQUIPMENT_SLOTS or the equipment pool in a SHIP context
// (ship install pickers, loadout boards, requisition, stat folds) must ask isMemberSlotType rather than
// hand-listing the four strings, so a fifth member slot later is a one-line add here.
export const MEMBER_SLOT_TYPES = ["memberArmor", "memberWeapon", "memberTool", "implant"] as const satisfies readonly EquipmentSlotType[];
export type MemberSlotType = (typeof MEMBER_SLOT_TYPES)[number];
const MEMBER_SLOT_TYPE_SET: ReadonlySet<string> = new Set<string>(MEMBER_SLOT_TYPES);

// Is this slot type an away-team MEMBER slot (worn by a member, never installed on a hull)? Takes a plain
// string too, since several UI lists key slots by string. A type guard, so a caller that filters member
// slots OUT is left holding only ship slot types. Pure.
export function isMemberSlotType(slotType: string): slotType is MemberSlotType {
  return MEMBER_SLOT_TYPE_SET.has(slotType);
}

// Rarity band of an equipment instance, ascending in power. 0.11.0 only ever
// PRODUCES standard..radiant; derelict (a below-baseline salvage band) and the
// luminous/constellar legendary flavors are defined now for the forward model
// so the budget/loot pipeline can reference the full ladder without a later
// type change. See rarityIndex below for the ordinal the budget math reads.
export type EquipmentRarity =
  | "derelict"
  | "standard"
  | "augmented"
  | "stellar"
  | "radiant"
  | "luminous"
  | "constellar";

// An additional post-rarity power tier ("ascension"). 0.11.0 only ever produces
// "none"; nova/celestial are defined now for the forward model (crafting-talent
// procs mint them in a later task) but nothing raises an instance past "none"
// this patch.
export type EquipmentAscension = "none" | "nova" | "celestial";

// A concrete piece of equipment. Mirrors ShipInstance's lightweight per-instance
// posture: non-stacking (each piece is its own record with a stable id), and its
// `fittedToShipId` is the authority for which SHIP holds the piece (null = on no ship),
// deliberately not duplicated onto the ship so the two never disagree, exactly like
// ShipInstance.assignedCaptainId. Whether a piece is free to take is NOT that field alone:
// it is isSparePiece (model.ts), which also checks member gear and loadout commitment. Nothing generates, fits,
// or reads these yet; this task only declares the shape.
export interface EquipmentInstance {
  id: string;                             // stable unique id, allocated from a GameState counter ("equip-N"), like nextShipId
  slotType: EquipmentSlotType;
  // Combat 1.0 (Unit 1.2): for a crafted WEAPON (slotType "weapon"), which base weapon type it
  // is. Its family / triangle / effect slots / range / cooldown come from WEAPON_DEFS[weaponType];
  // the rolled implicitStats/rolledStats below modify that base, and the bridge (Unit 1.4)
  // reconstructs the CombatWeapon from the two. Absent on every non-weapon piece. Optional +
  // additive, so no save migration.
  weaponType?: WeaponId;
  // Combat 1.0 (Unit 2.1a): for a crafted DRONE POD (slotType "droneBay"), which squadron ROLE it
  // deploys (attack / defense / support). Its per-drone base behavior (hp/family/accuracy/yield/
  // range/evasion/cooldown + the defensive fields) comes from the drone ROLE_TEMPLATE[droneRole];
  // the rolled implicitStats/rolledStats below modify that base, and a later bridge fold
  // reconstructs the DroneSquadron from the two. This is the DRONE analogue of weaponType. Absent
  // on every non-pod piece. Optional + additive, so no save migration.
  droneRole?: DroneRole;
  // The piece's STAMPED VARIETY KEY: which EQUIPMENT_SLOTS variety it rolled, persisted for every piece
  // whose behavior is resolved from its variety rather than read off its budgeted stat lines. The slot's
  // generic variety machinery does NOT otherwise persist the variety (the analogue of weaponType /
  // droneRole). Resolve it with pieceVarietyDef(piece). Stamped by generateEquipment for:
  //   - Crew 0.14.0 (Phase 1b): CREW MODULES (slotType "bridge" / "quarters"); the key is a
  //     QUARTERS_MODULES / BRIDGE_MODULES id and the crew overlay resolves the effect (crewModules.ts).
  //   - 0.14.0 sensors: SENSOR ARRAYS (slotType "sensor"); the key is a SENSOR_ARRAYS id (sensorArrays.ts).
  //   - Exploration 0.14.0 (E4d): an OWN-IDENTITY variety (per-variety implicit / affix / equip-gate
  //     overrides, varietyHasOwnIdentity), e.g. the Damage Control Suite / Pathfinder Suite in specUtility.
  //   - E-CREW 0.14.0 (Task 7): EVERY away-team MEMBER piece (isMemberSlotType), whose member traits
  //     (team allow-list, tool tuning, unique-equipped, ground effect) live on the variety.
  // Absent on every other piece. Optional + additive (like weaponType / droneRole / favorite), so no
  // save migration.
  moduleVariant?: string;
  rarity: EquipmentRarity;
  ascension: EquipmentAscension;          // "none" this patch (see EquipmentAscension)
  quality: number;                        // 0..5 quality rung within the rarity band
  // The item level the piece was generated at. WHY stored: iLevel is computed at generation
  // (computeItemLevel, feeds computeBudget) and used to be DISCARDED once the budget was spent.
  // It is now persisted verbatim so the UI can show item power at a glance ("iL N" on the Ship
  // Systems tile + in the tooltip header) without recomputing it from a lost input.
  iLevel: number;
  blueprintKey: string | null;            // which blueprint crafted it; null for the Standard-Issue baseline (craft-less)
  implicitStats: Record<string, number>;  // the slot-signature stat lines, always present for the slot
  rolledStats: Record<string, number>;    // the varying affixes rolled on top of the implicits
  mass: number;                           // intrinsic; drags speed stats, fought by propulsion (later fold-in task)
  powerDraw: number;                      // intrinsic; must fit within the reactor's Power Output (later fitting task)
  // The piece's TOUGHNESS (gear wear 0.14.0, gearWear.ts): every wear amount scales by 100 / durabilityMax, and it is
  // the size of the piece's combat pool. Quality-scaled at mint (itemgen.ts QUALITY_DURABILITY_BONUS).
  durabilityMax: number;
  // GEAR WEAR (0.14.0, design docs/plans/2026-10-16-gear-wear-design.md section 6; user W1 "0-1000 condition"): the
  // piece's condition, an integer PER-MILLE 0..1000. ABSENT = 1000, pristine: every minted and migrated piece, and a
  // piece repaired back to full (gearWear.ts withPieceCondition removes both fields), so a pristine piece serializes
  // exactly as before wear existed. Read it through gearWear.ts pieceCondition. It replaces the retired `durability`
  // field (always equal to durabilityMax; MIGRATIONS[69] deletes it); combat opens a pool at pieceStartDurability.
  // Optional + additive.
  condition?: number;
  // The game time (state.gameTimeSeconds) the condition was last settled at (gearWear.ts settlePiece): repair is
  // closed form from this anchor. Absent with `condition`.
  conditionAt?: number;
  fittedToShipId: string | null;         // null = on no ship. THE ship-install authority (mirrors ShipInstance.assignedCaptainId); "spare?" is isSparePiece
  // ITEM LIFECYCLE 0.13.6 (Armory, Phase 3; DORMANT until the Armory build wires it). The THIRD
  // fitment state: a system COMMITTED into a loadout carries the loadout's id here, which excludes it
  // from the free spare pool AND the manual-install picker (isSparePiece below requires no
  // committedToLoadoutId). When its loadout is checked out to a ship, checkout ALSO sets
  // fittedToShipId to that ship, so equippedFor() keeps reading a ship's gear unchanged. Absent on
  // every existing instance (optional, so no migration needed on the instances themselves).
  committedToLoadoutId?: string;
  // E-CREW (0.14.0): the MEMBER-gear authority. An away-team member wearing this piece carries the
  // member's id here, and that is the single source of truth for member gear, exactly as
  // fittedToShipId is for ship gear. A worn piece keeps fittedToShipId null, which is precisely why
  // every "is it spare?" check must go through isSparePiece (below) and never read fittedToShipId
  // alone. Set by a later E-CREW task; nothing writes it yet. Absent or null = not worn. Optional +
  // additive (like weaponType / committedToLoadoutId), so no save migration.
  fittedToMemberId?: string | null;
  integrity?: string;                     // RESERVED: server-minted anti-tamper token for the multiplayer era; unset this patch
  // --- 0.13.3.1 auto-salvage additions (Features 2 + 3) ------------------------------
  // FAVORITED: the player has pinned this exact piece, which makes it permanently exempt
  // from the auto-salvage rules (never from a hand-clicked salvage, see the protection
  // seam in salvage.ts). Absent or false = not favorited.
  //
  // ⚠️ IT LIVES ON THE SAVE, AND THAT IS THE WHOLE POINT. src/lib/shipFavoritesPreference.ts
  // keeps SHIP favorites in localStorage and documents why that is right for a per-device
  // VIEW preference. This is NOT that: the auto-salvage rules run inside the tick, including
  // the OFFLINE CATCH-UP seam, and the offline resolver can read the SAVE and nothing else. A
  // localStorage favorite would therefore be INVISIBLE offline, so the rules would destroy
  // favorited gear while the player was away and spare it while they watched. That is the
  // identical argument already recorded for AutoSalvageRules and salvageConfirmQualities
  // themselves (both were moved into the save for exactly this reason).
  //
  // WHY ON THE INSTANCE rather than as a GameState id set: a favorite is a property OF the
  // piece, and the codebase's standing posture is that such a property lives on the one
  // record that owns it and is never duplicated elsewhere (see fittedToShipId above, kept off
  // the ship "so the two never disagree"). On the instance it is also SELF-CLEANING: salvage
  // the piece and the flag goes with it, leaving no stale id behind to prune.
  //
  // OPTIONAL + ADDITIVE (like weaponType / droneRole / integrity above): absent means NOT
  // favorited, which is the truth for every piece that existed before this release, so the
  // v42 -> v43 migration deliberately does not backfill it.
  favorite?: boolean;
  // LOCKED (0.13.6 favorite/lock split): the player's "hands off this exact piece". Distinct from
  // `favorite` (which now affects DISPLAY ORDER only, pinning a spare to the top of its group so it
  // can be found in a pool of thousands). `locked` is the PROTECTION flag: a locked spare is never
  // auto-salvaged, cannot be manually salvaged, and cannot be installed or committed to a loadout
  // until it is unlocked. Splitting the two means you can pin an item AND keep it protected without
  // one forcing the other. OPTIONAL + ADDITIVE: absent means NOT locked; the v52 -> v53 migration
  // backfills locked = the OLD favorite (which used to be the auto-salvage protection), so existing
  // favorited spares keep their protection rather than silently becoming salvageable.
  locked?: boolean;
  // WHEN THIS PIECE'S AUTO-SALVAGE GRACE WINDOW LAST STARTED, on the fleet's own GAME CLOCK
  // (state.gameTimeSeconds), which is what the grace period (salvage.ts, AUTO_SALVAGE_GRACE_*)
  // measures against.
  //
  // ⚠️ TWO MOMENTS RESTART IT, NOT ONE, AND THE SECOND ONE IS THE WHOLE REASON THIS FIELD IS
  // NOT CALLED mintedAt ANY MORE (0.13.3.1 follow-up, user-reported gap):
  //   MINT      a freshly crafted piece must not be swept away before the player has looked at it.
  //   UNINSTALL a piece the player has just taken OFF a ship must not be swept away while they
  //             are mid-swap. Auto-salvage never touches INSTALLED gear, so before this the
  //             instant a piece was uninstalled it went from "permanently protected" to "fully
  //             eligible" with no window at all: uninstall a good reactor to try another one,
  //             and the rules could queue the old one before the player could put it back.
  //             Favoriting would have prevented it, but a destructive default must not depend
  //             on the player having opted in.
  // So the stamp records "this piece was recently crafted OR recently uninstalled", and
  // startAutoSalvageGrace (below) is the ONE writer for both. See its comment for why there is
  // one field and one reason rather than two of each.
  //
  // ⚠️ GAME TIME, NEVER Date.now(). gameTimeSeconds advances inside economyTick, so it
  // advances identically for a live tick and for an offline catch-up tick. A wall-clock stamp
  // compared inside the tick would make a piece's protection depend on WHEN the tick ran
  // rather than on how much game has elapsed, which breaks the offline==live parity invariant
  // this whole engine is built on.
  //
  // ⚠️ ABSENT IS NOT A GAP, IT IS THE RECORD: it means "this piece predates the stamp", which
  // the grace predicate reads as PAST GRACE (unprotected). That is the decision recorded on
  // MIGRATIONS[42] in save.ts: every item that existed before this release is treated as OLD,
  // so the automation behaves for it exactly as it did before the upgrade. This is why the
  // migration deliberately does NOT backfill the field (and why a Standard-Issue baseline,
  // minted by the two clock-free generators, never carries one).
  graceStartedAtGameSeconds?: number;
}

// ----------------------------------------------------------------------------
// startAutoSalvageGrace
// ----------------------------------------------------------------------------
// (RE)START a piece's auto-salvage grace window at `gameTimeSeconds`, returning a NEW instance.
//
// ⚠️ THIS EXISTS SO A GEAR SWAP CAN NEVER DESTROY THE PIECE YOU JUST TOOK OFF. Every site that
// MINTS a piece and every site that UNINSTALLS one calls this, which is the entire mechanism
// behind the grace period. If a new uninstall route is ever added and does NOT call this, the
// piece it pools becomes eligible for the automation the same instant, which is exactly the
// destructive gap this function was introduced to close.
//
// ONE FIELD, ONE REASON, DELIBERATELY. A mint and an uninstall could each have carried their own
// stamp and their own protection reason, and that was considered and rejected: the rules ask a
// single question ("is this piece still inside its window?"), so two fields would mean two places
// to read, two places to forget, and a "which one wins" rule for a piece that was crafted and
// then installed and then taken off. The player-facing sentence covers both causes instead (see
// AUTO_SALVAGE_PROTECTION_TEXT in App.svelte), which is the only place the difference would have
// been visible.
//
// ⚠️ THE CALLER PASSES GAME TIME, NEVER Date.now(): the uninstall routes and the tick's mint
// routes all have a GameState in hand, so they pass state.gameTimeSeconds. That keeps the stamp
// a pure function of saved state, which is what the offline==live parity invariant needs.
//
// PURE: allocates a fresh instance, mutates nothing.
export function startAutoSalvageGrace(
  piece: EquipmentInstance,
  gameTimeSeconds: number
): EquipmentInstance {
  return { ...piece, graceStartedAtGameSeconds: gameTimeSeconds };
}

// The 0-based rarity ordinal the budget pipeline (later task) reads. Ascends
// derelict 0 .. radiant 4, then BOTH luminous and constellar return 5: they are
// parallel legendary-class FLAVORS at the same power tier, not two more rungs, so
// they deliberately share the ordinal. PURE: a total mapping over the union,
// mutates nothing.
export function rarityIndex(rarity: EquipmentRarity): number {
  switch (rarity) {
    case "derelict":
      return 0;
    case "standard":
      return 1;
    case "augmented":
      return 2;
    case "stellar":
      return 3;
    case "radiant":
      return 4;
    // luminous and constellar are parallel legendary flavors at the SAME tier:
    case "luminous":
    case "constellar":
      return 5;
  }
}

// The catalog-driven module EFFECT scale (Crew 0.14.0 Phase 1b), shared by the crew modules, the sensor arrays and the
// universal modules (E-MOD EM-5). MOVED here from crewModules.ts (which re-exports all three, so every importer keeps
// working) so the equipment fold (equipmentStatMods, below) can scale a universal module's power output without a
// model -> crewModules import cycle.
//
// Per-rarity-step and per-quality-rung growth of a module's EFFECT (NOT its capacity, except the Efficient quarters
// module). Referenced to "standard" == the neutral base: a standard, quality-0 module reads scale 1.0 (so its catalog
// magnitude is used as-is), and a rarer / higher-quality module amplifies it. FIRST-PASS TUNABLE.
export const MODULE_RARITY_STEP = 0.12; // +12% effect per rarity band above standard
export const MODULE_QUALITY_STEP = 0.06; // +6% effect per quality rung

// The multiplicative effect scale for a module of the given rarity/quality. Monotonic non-decreasing in both (steps
// are >= 0). standard/q0 == 1.0. derelict clamps to the standard base (no negative step). Pure arithmetic.
export function moduleEffectScale(rarity: EquipmentRarity, quality: number): number {
  const rarityStep = Math.max(0, rarityIndex(rarity) - rarityIndex("standard"));
  const q = Math.max(0, quality);
  return (1 + rarityStep * MODULE_RARITY_STEP) * (1 + q * MODULE_QUALITY_STEP);
}

// ============================================================================
// Equipment 0.11.0 (Task 2): the LIVE equipment-slot DEFINITIONS. DATA/TABLE
// ONLY, mirroring the SHIP_TYPES/MISSIONS/ITEMS posture: these describe what a
// slot IS (its signature stats, the affix vocabulary it can roll, its variety
// families, and any equip gate) so later tasks (generation, fitting, the stat
// registry, UI) read a stable table instead of hard-coding slot facts. Nothing
// consumes this yet. Six slots are in the table: the four economy slots plus the two
// Combat 1.0 (Unit 1.1) defensive slots (shieldEmitters / hullPlating). The remaining
// reserved EquipmentSlotType members (bridge/quarters/etc.) have no definition yet.
// (Later additions: the crew-module + sensor slots, and E-CREW 0.14.0's four away-team MEMBER slots,
// which are worn by members, never installed on a hull; see the member-gear block in the table.)
// ============================================================================

// One "variety" family within a slot: a flavor a rolled piece can belong to
// (e.g. a Cargo Bay is a Prospector Hold / Balanced Hold / Hauler Hold). The
// variety biases how a piece's stat BUDGET is spread across its stat lines, so
// two same-rarity pieces in the same slot can feel distinct. Data only.
export interface EquipmentVarietyDef {
  key: string;                          // stable id within the slot (e.g. "prospectorHold")
  label: string;                        // player-facing name (e.g. "Prospector Hold")
  favorsSpec?: ShipSpec;                // the ship spec this variety leans toward; optional (a neutral/balanced variety omits it)
  // Budget-distribution WEIGHTS across this variety's stat lines, summing ~1.0:
  // a later generation task splits a rolled piece's stat budget by these ratios,
  // so a cargo-leaning variety pushes most of its budget into cargoCapacity. Keys
  // are stat-vocabulary strings (same set the affixPool draws from). FIRST-PASS
  // TUNABLE launch placeholders, same device-check spirit as SHIP_TYPES' numbers.
  statRatios: Record<string, number>;
  // --- Exploration 0.14.0 (E4d): per-VARIETY overrides (all OPTIONAL) ----------------------------
  // A slot used to be ONE family (every variety shared the slot's signature stats, affix pool and
  // equip gate). The relic-unlocked utility items (Damage Control Suite, Pathfinder Suite) are
  // DIFFERENT families living in the SAME specUtility slot, so a variety may now carry its own:
  //   implicitStats   , replaces the slot's signature lines for pieces of THIS variety.
  //   affixPool       , replaces the slot's affix pool for pieces of THIS variety.
  //   equipRequirement, replaces the slot's equip gate for pieces of THIS variety (canFitEquipment).
  // ⚠️ ADDITIVE-NEUTRAL: every pre-E4d variety omits all three, so generateEquipment /
  // previewCraftOutcome / canFitEquipment read the SLOT's tables exactly as before (byte-identical).
  // A variety that sets ANY of them has its own identity, so generateEquipment STAMPS its key onto the
  // instance as `moduleVariant` (see varietyHasOwnIdentity), which is how the gate + the effect readers
  // recognize the piece later (the generic machinery does not otherwise persist a piece's variety).
  implicitStats?: string[];
  affixPool?: { stat: string; weight: number }[];
  equipRequirement?: EquipRequirement;
  // E-CREW 0.14.0 (Task 7): the AWAY-TEAM MEMBER traits, nested so the member-only fields cannot sprawl
  // across the shared variety shape. PRESENT on every variety of the four member slots (isMemberSlotType,
  // asserted in tests) and ABSENT on every ship variety, so nothing ship-side changes. Read a member
  // variety through memberVariety(slotType, key) (or pieceVarietyDef(piece)), which hands back the traits
  // as non-optional.
  member?: MemberVarietyTraits;
}

// E-CREW 0.14.0 (Task 7): what a member gear variety IS beyond its stat lines. FIXED catalog facts (never
// rolled, so they live on the variety, never on the instance). DORMANT DATA in this task: the install
// gate (Task 8), the roster snapshot + battle + fieldwork (Tasks 12-16) are the consumers. See the
// member-gear block of EQUIPMENT_SLOTS for the per-field meaning.
export interface MemberVarietyTraits {
  readonly teamTypes: readonly AwayTeamType[];          // squads allowed to wear it (Prospecting pieces stay hidden until unlocked)
  readonly weaponRange?: "long" | "short";              // member weapons: back line vs front line
  readonly planetTypes?: readonly ExpeditionPlanetType[]; // Science tools: tuned bodies; absent = any body
  readonly encounterBias?: number;                      // Security tools: signed scale on the encounter chance
  readonly uniqueEquipped?: true;                       // ONE worn in the entire fleet (D11, Neural Backup)
  readonly groundEffect?: GroundGearEffect;             // a fixed special behavior (see GroundGearEffect)
  readonly grenade?: GrenadeTraits;                     // Field Kits FKR-5: a THROWN grenade (see GrenadeTraits)
}

// Field Kits FKR-5 (docs/plans/2026-10-14-field-kits-plan.md R3 FKR-5; user FK11 verbatim, N4, N6, N7): a grenade
// tool's THROW, a fixed catalog fact of the variety. On a Field Kits run (flag 2) a grenade is thrown by a gambit rule
// ("throwGrenade"), spending one CHARGE; it no longer applies its status passively on every strike (N7 "Thrown, spend
// charges"). A run without the flag keeps the variety's passive groundEffect exactly as before.
//   charges:      uses per OBJECTIVE (refilled free at every objective start, group 7 "Free, every objective") and
//                 throws per BATTLE (FK11 "perhaps it's limited to 1 per battle as they deal AoE damage"). Each
//                 rolled +1 carry capacity line (groundCarryCapacity) adds one more per objective (FK11, N4).
//   powerMult:    the blast hits the TARGET'S GROUP (N6 "Group blast"), each body for the thrower's power x this.
//   status:       the debuff a blast may inflict on each body it hits (FK11 "a chance to inflict a debuff, as do
//                 other grenade types").
//   statusChance: that debuff's fixed chance; absent = the thrower's statusChance (THE STATUS-CHANCE RULE, so the
//                 grenade's groundStatusChance line keeps its meaning).
//   fuse:         TIMED GRENADES (user 2026-10-21, recipe realism audit call 11: "Impact grenade could be the default
//                 grenade type as it basically explodes on contact with a surface, versus a timed detonation which
//                 other units could have?"; fuse ruling "1 round later (Recommended)"). Present = a TIMED fuse: thrown on
//                 the thrower's action, it detonates at the start of the thrower's NEXT turn, on whoever of the target's
//                 group is still there (gambit.ts; each foe may move clear first at `movedClearChance`). Absent = it
//                 detonates on contact, the turn it is thrown (the Impact Grenade, the default grenade). Only a run
//                 stamped with Field Kits catalog 2 or later reads it (fieldKits.ts timedFusesLive); a catalog 1 run (in
//                 flight before the fuse) detonates every grenade on contact, exactly as before.
export interface GrenadeTraits {
  readonly charges: { readonly perObjective: number; readonly perBattle: number };
  readonly powerMult: number;
  readonly status: GambitStatusId;
  readonly statusChance?: number;
  readonly fuse?: { readonly movedClearChance: number };
}

// Field Kits FKR-5 (user N4 "Grenades only": Impact 4, Stun 2, Toxin 2, 1 throw per battle; FK11 "a plain grenade
// might have 4 to start, while specialized ones might have 2 to start").
export const GRENADE_CHARGES_PLAIN = 4;
export const GRENADE_CHARGES_SPECIALIZED = 2;
export const GRENADE_THROWS_PER_BATTLE = 1;
// User N6 "Group blast + Concussion": the Impact Grenade hits the target's group at 1.5x the thrower's power, 30%
// Concussion.
export const IMPACT_GRENADE_POWER_MULT = 1.5;
export const IMPACT_GRENADE_CONCUSSION_CHANCE = 0.3;
// The SPECIALIZED grenades' blast (Stun, Toxin): their debuff is the point, so the blast is lighter than the Impact
// Grenade's (user 2026-10-20 "Half damage": Stun and Toxin hit for 0.5x, a third of the Impact Grenade's 1.5x).
export const SPECIALIZED_GRENADE_POWER_MULT = 0.5;
// Each rolled carry capacity line adds this many charges per objective (FK11 "+1 carry capacity").
export const GRENADE_CARRY_PER_LINE = 1;
// The Impact Grenade's Fabricator recipe (user 2026-10-20 "Approve"; the Stun Grenade's tier 1 band, a titanium casing
// in place of one wafer): 1 Titanium Ingot + 1 Polysilicate Wafer + 1 Power Coupling, researched for 700 credits.
export const IMPACT_GRENADE_RECIPE: Readonly<Record<string, number>> = { titaniumIngot: 1, polysilicateWafer: 1, powerCoupling: 1 };
// Timed grenades (GrenadeTraits.fuse): the chance that each foe of the target's group MOVES CLEAR of a primed Stun or
// Toxin Grenade before it detonates (the user: "enemies may move out of a cluster first"). Ground fights have no
// positions, so a cluster is the target's group (its group tag): a foe downed before the detonation is not hit, and each
// foe still standing rolls this once (its own keyed stream, gambit.ts GRENADE_FUSE_SALT) and is not hit when it moved
// clear. User 2026-10-21 "20%, lone targets can't dodge": one in five, for GROUPS; a lone target (the only foe of its
// group still standing at the detonation) never rolls and always takes the blast.
export const GRENADE_FUSE_MOVED_CLEAR_CHANCE = 0.2;
// The timed fuse the Stun and Toxin Grenades carry (GrenadeTraits.fuse).
export const TIMED_GRENADE_FUSE: NonNullable<GrenadeTraits["fuse"]> = { movedClearChance: GRENADE_FUSE_MOVED_CLEAR_CHANCE };

// THE ONE SWITCH for the Field Kits pieces a player could reach before FKR-7 wires kits into runs (user 2026-10-20
// "Hide until kits are live"). While false: the Impact Grenade blueprint stays out of BLUEPRINTS (so out of Research,
// the Fabricator and the Archive; it waits in FIELD_KITS_HIDDEN_BLUEPRINTS), and a NEW Stun or Toxin Grenade craft rolls
// from its pre-FKR-5 pool (no +1 Carry Capacity line), exactly as before FKR-5. Pieces already minted keep their
// lines. FKR-9 / FKR-10 flipped it to true with fieldKits.ts FIELD_KITS_RUNS_LIVE (user 2026-10-20 "Yes, with the pack
// screen"): the blueprint merges in and the two pools gain the carry line (GRENADE_CRAFT_POOLS).
export const FIELD_KITS_PLAYER_LIVE = true;

// The Stun and Toxin Grenades' craft pools: `base` as before FKR-5, `carry` with FKR-5's +1 Carry Capacity line (FK11;
// pool weight 1, variety share 0.15 [PROPOSAL: a "possibly" line, about one Standard craft in four], the other two
// shares lowered so each variety's shares still sum to 1). FIELD_KITS_PLAYER_LIVE picks one (grenadeCraftPool).
type GrenadeCraftPool = { readonly affixPool: readonly { readonly stat: string; readonly weight: number }[]; readonly statRatios: Readonly<Record<string, number>> };
export const GRENADE_CRAFT_POOLS: Readonly<Record<"stunGrenade" | "toxinGrenade", Readonly<Record<"base" | "carry", GrenadeCraftPool>>>> = {
  stunGrenade: {
    base: { affixPool: [{ stat: "groundStatusChance", weight: 4 }, { stat: "groundAccuracy", weight: 2 }], statRatios: { groundStatusChance: 0.7, groundAccuracy: 0.3 } },
    carry: {
      affixPool: [{ stat: "groundStatusChance", weight: 4 }, { stat: "groundAccuracy", weight: 2 }, { stat: "groundCarryCapacity", weight: 1 }],
      statRatios: { groundStatusChance: 0.6, groundAccuracy: 0.25, groundCarryCapacity: 0.15 },
    },
  },
  toxinGrenade: {
    base: { affixPool: [{ stat: "groundStatusChance", weight: 3 }, { stat: "groundPower", weight: 3 }], statRatios: { groundStatusChance: 0.6, groundPower: 0.4 } },
    carry: {
      affixPool: [{ stat: "groundStatusChance", weight: 3 }, { stat: "groundPower", weight: 3 }, { stat: "groundCarryCapacity", weight: 1 }],
      statRatios: { groundStatusChance: 0.5, groundPower: 0.35, groundCarryCapacity: 0.15 },
    },
  },
};

// A fresh copy of the pool `key` crafts from under FIELD_KITS_PLAYER_LIVE (`live` overrides it for a test). Pure.
export function grenadeCraftPool(
  key: "stunGrenade" | "toxinGrenade",
  live: boolean = FIELD_KITS_PLAYER_LIVE,
): { affixPool: { stat: string; weight: number }[]; statRatios: Record<string, number> } {
  const p = GRENADE_CRAFT_POOLS[key][live ? "carry" : "base"];
  return { affixPool: p.affixPool.map((a) => ({ ...a })), statRatios: { ...p.statRatios } };
}

// A member variety with its traits guaranteed present (what memberVariety returns).
export type MemberVarietyDef = EquipmentVarietyDef & { member: MemberVarietyTraits };

// The member variety `key` of member slot `slotType`, with its member traits non-optional, or undefined
// for a ship slot, an unknown key, or a variety missing its traits. Pure.
export function memberVariety(slotType: string, key: string): MemberVarietyDef | undefined {
  if (!isMemberSlotType(slotType)) return undefined;
  const v = EQUIPMENT_SLOTS[slotType]?.varieties.find((x) => x.key === key);
  return v?.member !== undefined ? (v as MemberVarietyDef) : undefined;
}

// E-CREW 0.14.0 (Task 7): a member gear variety's FIXED special behavior (not a rolled magnitude, so it
// lives on the catalog variety, never on the instance). Same readonly shape as the trait catalog's
// AwayTraitEffect (awayTraits.ts), and statuses reuse the Security battle's own ids (GambitStatusId,
// gambit.ts GAMBIT_STATUSES). DORMANT: the Security battle (Task 13) and the Neural Backup revive
// (Task 16) read these. The battle snapshot (Tasks 12/13) normalizes trait AND gear effects into ONE
// per-member resist map and ONE ability list, so the battle never reads the two catalogs separately.
//   groupHit     , the attack strikes a GROUP of foes (Scattergun).
//   inflict      , applies `status` on hit / throw (Shock Baton, grenades). THE STATUS-CHANCE RULE: a
//                  piece's groundStatusChance line ALWAYS folds into the member-wide statusChance (like
//                  every ground line), and an inflict piece applies its status with chance = that
//                  member's statusChance. There is no separate per-piece chance read.
//   resistStatus , resists the listed statuses with chance = the member's summed groundStatusResist
//                  (Toxin Filters, Cortex Shield).
//   heal         , an in-fight heal item (Med Kit).
//   revive       , once per battle, `chance` to revive the first downed ally at `hpFraction` HP (Neural Backup).
export type GroundGearEffect =
  | { readonly kind: "groupHit" }
  | { readonly kind: "inflict"; readonly status: GambitStatusId }
  | { readonly kind: "resistStatus"; readonly statuses: readonly GambitStatusId[] }
  | { readonly kind: "heal" }
  | { readonly kind: "revive"; readonly chance: number; readonly hpFraction: number };

// The optional equip gate a slot (or, since E4d, a single variety) imposes. All fields optional and
// ANDed by canFitEquipment; only the fields present are checked. (Extracted from EquipmentSlotDef as a
// named type in E4d so a variety can carry the same shape; the fields are unchanged.)
export interface EquipRequirement {
  captainSpec?: ShipSpec;
  hullSpec?: ShipSpec;
  minCaptainLevel?: number;
  requiresResearch?: string;
  requiresTalent?: string;
}

// Does this variety carry its OWN identity (any per-variety override), so its key must be stamped onto a
// minted instance as moduleVariant? FALSE for every pre-E4d variety (they set none of the overrides), so
// no existing mint gains a field. Pure.
export function varietyHasOwnIdentity(variety: EquipmentVarietyDef): boolean {
  return variety.implicitStats !== undefined || variety.affixPool !== undefined || variety.equipRequirement !== undefined;
}

// The catalog variety a piece rolled, resolved from its stamped moduleVariant (see EquipmentInstance), or
// undefined when the piece carries no stamp (every economy / combat piece without its own identity) or the
// key no longer names a variety of its slot (a retired variety on an old save). The ONE resolver for
// "which variety is this piece", so the install gate, the member readers and the tooltip never hand-roll
// the lookup. Pure.
export function pieceVarietyDef(piece: Pick<EquipmentInstance, "slotType" | "moduleVariant">): EquipmentVarietyDef | undefined {
  if (piece.moduleVariant === undefined) return undefined;
  return EQUIPMENT_SLOTS[piece.slotType]?.varieties.find((v) => v.key === piece.moduleVariant);
}

// E4d: the player-facing SLOT label for a (slot, variety) pair. A slot's catalog label names its ORIGINAL
// single family (specUtility reads "Prospecting Rig"), which would mislabel a relic-unlocked family living in
// the same slot ("Prospecting Rig · Damage Control Suite"). So a variety with its OWN identity reads the slot's
// neutral name instead ("Spec Utility", the name the Ships board + Armory already give that slot). Every
// pre-E4d variety (and an absent / unknown variety) returns the catalog label UNCHANGED, so all existing
// text is byte-identical. Pure.
const OWN_IDENTITY_SLOT_LABEL: Partial<Record<string, string>> = { specUtility: "Spec Utility" };
export function equipmentSlotLabel(slotType: string, varietyKey?: string | null): string {
  const slot = EQUIPMENT_SLOTS[slotType];
  if (slot === undefined) return slotType;
  const variety = varietyKey ? slot.varieties.find((v) => v.key === varietyKey) : undefined;
  if (variety !== undefined && varietyHasOwnIdentity(variety)) return OWN_IDENTITY_SLOT_LABEL[slotType] ?? slot.label;
  return slot.label;
}

// The SLOT-LEVEL label for a heading that names a whole slot rather than one piece (e.g. the Warehouse
// Ship Systems bay groups). Once a slot holds more than its original family (specUtility now carries
// combat + explorer suites beside the prospector rigs), its catalog label ("Prospecting Rig") misnames
// the group, so it reads the slot's neutral name ("Spec Utility") instead. Per-piece labels keep using
// equipmentSlotLabel, so a mining rig still reads "Prospecting Rig". Pure.
export function equipmentSlotGroupLabel(slotType: string): string | undefined {
  const slot = EQUIPMENT_SLOTS[slotType];
  if (slot === undefined) return undefined;
  return OWN_IDENTITY_SLOT_LABEL[slotType] ?? slot.label;
}

// One equipment SLOT: the signature stats every piece in it carries, the affix
// pool a piece can roll ON TOP of those, its three variety families, and an
// optional equip gate. Comments on the shape explain intent; the table below is
// the blessed content.
export interface EquipmentSlotDef {
  slotType: EquipmentSlotType;          // MUST equal this entry's key in EQUIPMENT_SLOTS (asserted in tests)
  label: string;                        // player-facing slot name
  implicitStats: string[];              // slot-signature stat keys, ALWAYS present on every piece in the slot
  // The affixes a piece MAY roll on top of the implicits. `weight` biases which
  // affixes are picked by the later weighted-roll step (higher = more likely); it
  // is NOT the stat magnitude. Live-this-patch stat keys only. TUNABLE.
  affixPool: { stat: string; weight: number }[];
  varieties: EquipmentVarietyDef[];     // exactly 3 per slot (asserted in tests)
  // Optional gate a captain/hull must satisfy to equip pieces of this slot. All
  // fields optional and ANDed by the later fitting task; only the fields present
  // are checked. specUtility is the one gated slot this patch.
  equipRequirement?: EquipRequirement;
}

// G1-1 (Short-Range Missions): the guest quarters affix's weight in the Crew Quarters pool (beside crewStations 5,
// crewEfficiency 2, massReduction 1). [PROVISIONAL] first pass (the plan's recommended source; no weight was asked).
export const GUEST_QUARTERS_AFFIX_WEIGHT = 2;

// The six live slots (four economy + two Combat 1.0 defensive). ⚠️ statRatios and affix
// WEIGHTS are FIRST-PASS TUNABLE launch placeholders (retuned at the device-check stage,
// not piecemeal), same spirit as every other economy constant in this file. Each variety's
// ratios lean toward that variety's quirk; each slot's affix weights bias its signature
// stat highest. Stat keys are constrained to the 16 live keys (the test fences this against
// an explicit allow-set).
export const EQUIPMENT_SLOTS: Record<string, EquipmentSlotDef> = {
  // CARGO BAY: the hold. Signature stat is raw cargoCapacity; affixes lean cargo
  // with efficiency / yield / mass-shaving as secondary rolls. Universal (no gate).
  cargoBay: {
    slotType: "cargoBay",
    label: "Cargo Bay",
    implicitStats: ["cargoCapacity"],
    affixPool: [
      { stat: "cargoCapacity", weight: 5 },     // signature affix: most likely to roll
      { stat: "massReduction", weight: 2 },
      { stat: "engineEfficiency", weight: 2 },
      { stat: "extractionYieldMult", weight: 1 },
    ],
    varieties: [
      // Prospector-leaning hold: heavy into cargo, a little mass relief.
      { key: "prospectorHold", label: "Prospector Hold", favorsSpec: "prospector", statRatios: { cargoCapacity: 0.75, massReduction: 0.15, engineEfficiency: 0.1 } },
      // The neutral middle option (no favored spec): a rounded spread.
      { key: "balancedHold", label: "Balanced Hold", statRatios: { cargoCapacity: 0.55, massReduction: 0.2, engineEfficiency: 0.15, extractionYieldMult: 0.1 } },
      // Max cargo, and it shows: almost all budget into capacity, none into mass.
      { key: "haulerHold", label: "Hauler Hold", statRatios: { cargoCapacity: 0.9, engineEfficiency: 0.1 } },
    ],
  },
  // FTL DRIVE: propulsion. TWO signature stats (transit speed + fuel efficiency);
  // affixes trade between speed, efficiency, tank size, and mass. Universal.
  ftlDrive: {
    slotType: "ftlDrive",
    label: "FTL Drive",
    implicitStats: ["transitSpeedMult", "engineEfficiency"],
    affixPool: [
      { stat: "transitSpeedMult", weight: 4 },
      { stat: "engineEfficiency", weight: 4 },
      { stat: "fuelCapacity", weight: 2 },
      { stat: "massReduction", weight: 1 },
    ],
    varieties: [
      // Sprint: budget into raw FTL speed.
      { key: "sprintDrive", label: "Sprint Drive", statRatios: { transitSpeedMult: 0.7, massReduction: 0.15, engineEfficiency: 0.15 } },
      // Economy: budget into fuel efficiency + tank, the long-haul drive.
      { key: "economyDrive", label: "Economy Drive", statRatios: { engineEfficiency: 0.65, fuelCapacity: 0.25, transitSpeedMult: 0.1 } },
      // Balanced: an even split across speed and efficiency.
      { key: "balancedDrive", label: "Balanced Drive", statRatios: { transitSpeedMult: 0.4, engineEfficiency: 0.4, fuelCapacity: 0.2 } },
    ],
  },
  // REACTOR CORE: powers the fit. Signature stat is powerOutput (the budget every
  // powered piece draws against, later task); affixes trade output vs mass vs the
  // fit's power draw. Universal.
  reactorCore: {
    slotType: "reactorCore",
    label: "Reactor Core",
    implicitStats: ["powerOutput"],
    affixPool: [
      { stat: "powerOutput", weight: 5 },
      { stat: "massReduction", weight: 2 },
      { stat: "engineEfficiency", weight: 1 },
      { stat: "powerDrawReduction", weight: 2 },
    ],
    varieties: [
      // High-output: maximum powerOutput, and heavy (little mass relief) to match.
      { key: "highOutputCore", label: "High-Output Core", statRatios: { powerOutput: 0.85, powerDrawReduction: 0.15 } },
      // Efficient: light core, budget shifted into shaving mass + fit power draw.
      { key: "efficientCore", label: "Efficient Core", statRatios: { powerOutput: 0.45, massReduction: 0.35, powerDrawReduction: 0.2 } },
      // Balanced: a middle reactor.
      { key: "balancedCore", label: "Balanced Core", statRatios: { powerOutput: 0.6, massReduction: 0.2, powerDrawReduction: 0.2 } },
    ],
  },
  // SPEC UTILITY: the universal Spec Utility Slot. This patch it ships ONE family,
  // the Prospecting Rig, gated to a prospecting captain flying a Prospector hull.
  // Signature stat is extractionYieldMult; affixes add survey sensors + material
  // quality on top.
  specUtility: {
    slotType: "specUtility",
    label: "Prospecting Rig",
    implicitStats: ["extractionYieldMult"],
    affixPool: [
      { stat: "extractionYieldMult", weight: 5 },
      { stat: "sensors", weight: 2 },
      { stat: "materialQualityChance", weight: 2 },
      { stat: "massReduction", weight: 1 },
    ],
    varieties: [
      // Yield: budget into raw extractor efficiency.
      { key: "yieldRig", label: "Yield Rig", favorsSpec: "prospector", statRatios: { extractionYieldMult: 0.75, sensors: 0.15, materialQualityChance: 0.1 } },
      // Survey: budget into sensors (find speed + rarity chance).
      { key: "surveyRig", label: "Survey Rig", favorsSpec: "prospector", statRatios: { sensors: 0.65, extractionYieldMult: 0.25, materialQualityChance: 0.1 } },
      // Refinery-Feed: budget into material quality, feeding the refining chain.
      { key: "refineryFeedRig", label: "Refinery-Feed Rig", favorsSpec: "prospector", statRatios: { materialQualityChance: 0.65, extractionYieldMult: 0.25, sensors: 0.1 } },
      // --- Exploration 0.14.0 (E4d): the two RELIC-UNLOCKED utility families --------------------
      // Each is its OWN family in this slot (per-variety implicitStats / affixPool / equipRequirement
      // overrides, see EquipmentVarietyDef), so it neither rolls extraction stats nor obeys the slot's
      // prospector gate. Their effects are NOT folded by equipmentStatMods (except `sensors`, which is
      // a real fold); they are read by utilityGear.ts's dedicated readers. Craftable only after the
      // discovery-gated blueprint is researched (BLUEPRINTS damageControlSuiteBp / pathfinderSuiteBp).
      // statRatios / weights FIRST-PASS TUNABLE.
      //
      // DAMAGE CONTROL SUITE (combat hulls only, the RECOVERY role): faster post-loss repair
      // (repairSpeed -> shipRepairDurationTicks) + a light hull patch-up before each later patrol wave
      // (waveHullRegen -> the shared wave sequence, tick.ts + patrolReplay.ts).
      {
        key: "damageControlSuite",
        label: "Damage Control Suite",
        favorsSpec: "tactician",
        statRatios: { repairSpeed: 0.5, waveHullRegen: 0.4, massReduction: 0.1 },
        implicitStats: ["repairSpeed", "waveHullRegen"],
        affixPool: [
          { stat: "repairSpeed", weight: 4 },
          { stat: "waveHullRegen", weight: 4 },
          { stat: "massReduction", weight: 1 },
        ],
        equipRequirement: { hullSpec: "tactician" },
      },
      // PATHFINDER SUITE (explorer hulls only): sensors (a real fold into ShipDerivedStats.sensors) +
      // expedition scan speed + hazard resist (both fed into the dispatch-time expedition snapshot).
      {
        key: "pathfinderSuite",
        label: "Pathfinder Suite",
        favorsSpec: "explorer",
        statRatios: { sensors: 0.4, expeditionScanSpeed: 0.3, hazardResist: 0.3 },
        implicitStats: ["sensors", "expeditionScanSpeed", "hazardResist"],
        affixPool: [
          { stat: "sensors", weight: 3 },
          { stat: "expeditionScanSpeed", weight: 3 },
          { stat: "hazardResist", weight: 3 },
          { stat: "massReduction", weight: 1 },
        ],
        equipRequirement: { hullSpec: "explorer" },
      },
    ],
    // Gated by HULL CLASS only: the Prospecting Rig fits any captain flying a Prospector-class
    // hull. ⚠️ The captainSpec gate was DROPPED (2026-09-14, user): specialty gear installs on the
    // SHIP, so a tactical/science captain flying a prospector hauler can still fit a mining rig.
    // The hullSpec gate stays (the rig's extraction stats only make sense on a mining hull). The
    // captainSpec / captainSpecParked fit-reasons remain defined for a future spec-gated slot.
    equipRequirement: { hullSpec: "prospector" },
  },
  // COMBAT 1.0 (Unit 1.1): the two DEFENSIVE combat slots, activated from the reserved
  // EquipmentSlotType members (shieldEmitters / hullPlating). Singleton slots (one each
  // per combat hull). This unit ONLY defines the slots + their stat vocabulary so itemgen
  // and the UI read a stable table, exactly as the four economy slots do. They are
  // deliberately NOT auto-seeded (absent from DEFAULT_EQUIPMENT_VARIETY) and NOT yet
  // craftable (no blueprint), so nothing generates, installs, or reads one this unit and combat
  // parity is untouched. Auto-install of Standard-Issue baselines onto combat hulls + the
  // empty-slot dispatch blocker land in Unit 1.3; the shipToCombatant fold that makes these
  // stats drive real combat outcomes lands in Unit 1.4. Per-family resist affixes are
  // deferred to the fold-in (they need the combatant's resist-map modeling); this unit ships
  // the core defensive vocabulary only. statRatios / affix WEIGHTS are FIRST-PASS TUNABLE,
  // same spirit as the economy slots.
  //
  // SHIELD EMITTER: the deflector. Signature stats are shieldCapacity (the absorb pool) +
  // shieldRecharge (regen/sec); affixes add shield coherence (attenuation resist) and a
  // little mass relief. Pure-gear shields (design 5a): the emitter is the SOLE source of a
  // ship's shield pool, so a stripped slot means no shields (enforced by the Unit 1.3 blocker).
  shieldEmitters: {
    slotType: "shieldEmitters",
    label: "Shield Emitter",
    implicitStats: ["shieldCapacity", "shieldRecharge"],
    affixPool: [
      { stat: "shieldCapacity", weight: 5 },     // signature affix: most likely to roll
      { stat: "shieldRecharge", weight: 4 },
      { stat: "shieldCoherence", weight: 2 },
      { stat: "massReduction", weight: 1 },
    ],
    varieties: [
      // Capacitor Bank: budget into raw absorb pool, the tank emitter.
      { key: "capacitorBank", label: "Capacitor Bank", statRatios: { shieldCapacity: 0.7, shieldRecharge: 0.2, shieldCoherence: 0.1 } },
      // Recharge Array: budget into regen, rewards burst/attrition fights.
      { key: "rechargeArray", label: "Recharge Array", statRatios: { shieldRecharge: 0.65, shieldCapacity: 0.25, shieldCoherence: 0.1 } },
      // Balanced Emitter: the neutral middle option.
      { key: "balancedEmitter", label: "Balanced Emitter", statRatios: { shieldCapacity: 0.45, shieldRecharge: 0.4, shieldCoherence: 0.15 } },
    ],
  },
  // HULL PLATING: the armor. Signature stat is hullStrength (adds to the structural HP pool);
  // affixes add ablative armor (a depleting flat-energy buffer) and kinetic dampening (flat
  // kinetic % reduction), plus mass relief. Design 6a middle path: the hull keeps a small
  // intrinsic frame HP and plating provides the bulk of effective HP + all mitigation.
  hullPlating: {
    slotType: "hullPlating",
    label: "Hull Plating",
    implicitStats: ["hullStrength"],
    affixPool: [
      { stat: "hullStrength", weight: 5 },       // signature affix: most likely to roll
      { stat: "ablativeArmor", weight: 3 },
      { stat: "kineticDampening", weight: 2 },
      { stat: "massReduction", weight: 1 },
    ],
    varieties: [
      // Reinforced: budget into raw structural HP, the straight tank plate.
      { key: "reinforcedPlating", label: "Reinforced Plating", statRatios: { hullStrength: 0.75, ablativeArmor: 0.15, kineticDampening: 0.1 } },
      // Ablative: budget into the depleting energy-soak buffer.
      { key: "ablativePlating", label: "Ablative Plating", statRatios: { ablativeArmor: 0.55, hullStrength: 0.3, kineticDampening: 0.15 } },
      // Composite: an even spread across HP + both mitigations.
      { key: "compositePlating", label: "Composite Plating", statRatios: { hullStrength: 0.4, ablativeArmor: 0.3, kineticDampening: 0.3 } },
    ],
  },
  // CREW 0.14.0 (Phase 1b): the two CREW-MODULE slots, activated from the reserved bridge/quarters
  // EquipmentSlotType members. These are craftable/rollable, ALLOW-EMPTY singletons (one bridge +
  // one quarters per hull; NO Standard-Issue baseline, so they are deliberately absent from
  // DEFAULT_EQUIPMENT_VARIETY and never auto-seeded, exactly like the two defensive combat slots).
  //
  // ⚠️ THE MODULE'S CREW EFFECT DOES NOT LIVE IN THESE STAT LINES. A module amplifies the crew stack
  // (quarters -> complement capacity + division/per-head effectiveness; bridge -> Senior Staff officer
  // output), and that effect is resolved from the QUARTERS_MODULES / BRIDGE_MODULES catalogs
  // (crewModules.ts) keyed by the piece's persisted `moduleVariant`, SCALED by rarity/quality per the
  // CAPACITY PRINCIPLE (only the Efficient quarters module scales its CAPACITY; every other module's
  // capacity is fixed). The crew overlay reads the catalog, NEVER these budget-derived lines, because a
  // budget line scales with rarity/quality for ALL modules, which would both double-count and violate
  // the capacity principle. The implicitStats / affixPool below exist only so a module is a well-formed,
  // budgeted piece of gear (physicals, durability, iLevel) that mints through the shared generation
  // path; crewStations / crewEfficiency are the honest signature keys for these slots (both are in
  // LIVE_STAT_KEYS but are NOT folded by equipmentStatMods, so installing a module leaves
  // shipDerivedStats byte-identical and only the crew overlay reacts; `sensors` (Exploration 0.14.0 E1a)
  // and `materialQualityChance` (Material Lines ML-3) are the keys that graduated to a real fold). Each
  // variety's `key` IS a module-catalog id (the generation path stamps it onto the instance as
  // moduleVariant); statRatios are empty because a module's power is catalog-driven, not budget-biased.
  //
  // BRIDGE = the Senior Staff amplifier. 3 first-pass variants (Balanced / Focused / Flag Command).
  bridge: {
    slotType: "bridge",
    label: "Bridge Module",
    implicitStats: ["crewEfficiency"],
    affixPool: [
      { stat: "crewEfficiency", weight: 5 },
      { stat: "massReduction", weight: 1 },
    ],
    varieties: [
      { key: "bridgeBalancedCommand", label: "Balanced Command", statRatios: {} },
      { key: "bridgeFocusedCommand", label: "Focused Command", statRatios: {} },
      { key: "bridgeFlagCommand", label: "Flag Command", statRatios: {} },
    ],
  },
  // QUARTERS = the Complement amplifier + capacity. 10 variants: 6 DIVISION-focused (one per
  // complement profession) + 3 GENERAL (Utilitarian / Efficient / Elite) + the GUEST WING (G1-1).
  // crewStations (crew capacity) is the signature; crewEfficiency (per-head comfort) is a secondary affix.
  //
  // G1-1 (Short-Range Missions, user 2026-10-19 call 6): GUEST QUARTERS (`colonistCapacity`, the berths passengers
  // ride in) is the one quarters line that is NOT catalog-driven: it FOLDS as a flat berth count into
  // ShipDerivedStats.colonistCapacity (equipmentStatMods), like `sensors`. It rolls two ways: as an AFFIX on any
  // quarters module (APPENDED to the pool below, append-only: stored items never re-roll, so every quarters piece
  // already in a save keeps its lines byte-identical; only NEW quarters rolls move, pinned in shortRangeGoldens), and
  // as the GUEST WING's signature line (its own implicitStats, so it carries no crewStations line: fewer crew
  // stations in trade). A guest line's value is in BERTHS (itemgen.ts GUEST_QUARTERS_PER_POINT converts its budget).
  quarters: {
    slotType: "quarters",
    label: "Crew Quarters Module",
    implicitStats: ["crewStations"],
    affixPool: [
      { stat: "crewStations", weight: 5 },
      { stat: "crewEfficiency", weight: 2 },
      { stat: "massReduction", weight: 1 },
      { stat: "colonistCapacity", weight: GUEST_QUARTERS_AFFIX_WEIGHT },
    ],
    varieties: [
      // 6 DIVISION-focused (variety key == QUARTERS_MODULES id).
      { key: "quartersSecurityWing", label: "Security Quarters", statRatios: {} },
      { key: "quartersEngineeringWing", label: "Engineering Quarters", statRatios: {} },
      { key: "quartersScienceWing", label: "Science Quarters", statRatios: {} },
      { key: "quartersMedicalWing", label: "Medical Quarters", statRatios: {} },
      { key: "quartersOperationsWing", label: "Operations Quarters", statRatios: {} },
      { key: "quartersFlightDeckWing", label: "Flight-Deck Quarters", statRatios: {} },
      // 3 GENERAL.
      { key: "quartersUtilitarian", label: "Utilitarian Quarters", statRatios: {} },
      { key: "quartersEfficient", label: "Efficient Quarters", statRatios: {} },
      { key: "quartersElite", label: "Elite Quarters", statRatios: {} },
      // G1-1 GUEST WING (user 2026-10-19: "Guest Wing (Recommended)"): berths for passengers instead of crew. Its
      // signature line is guest quarters (its OWN implicitStats, so no crewStations line); its crew effect is the
      // QUARTERS_MODULES catalog's (a small fixed crew capacity, no effectiveness boost).
      { key: "quartersGuestWing", label: "Guest Wing", statRatios: {}, implicitStats: ["colonistCapacity"] },
    ],
  },
  // 0.14.0 SENSORS (DORMANT): the SENSOR slot, activated from the reserved `sensor` EquipmentSlotType
  // member. A craftable/rollable, ALLOW-EMPTY singleton (one per hull; NO Standard-Issue baseline, so
  // deliberately absent from DEFAULT_EQUIPMENT_VARIETY and never auto-seeded, exactly like the crew-module
  // and defensive-combat slots). It mints through the shared generation path so a sensor is a well-formed,
  // budgeted piece of gear (physicals, durability, iLevel).
  //
  // ⚠️ LIVE AS OF EXPLORATION 0.14.0 E1a. The signature stat is `sensors`, now the FIRST live consumer
  // of the sensor slot: equipmentStatMods FOLDS `sensors` as a flat point-sum into ShipDerivedStats.sensors,
  // and survey missions (MISSIONS' missionType "survey") scale their material yield by it (tick.ts's
  // tickCaptainMission). ⚠️ ADDITIVE-NEUTRAL for the ECONOMY fold: `sensors` moves only that one new field;
  // every other derived stat is byte-identical, and a ship with no sensor fitted folds sensors 0 (no survey
  // bonus). Explorer-hull BASE sensors + Science-crew amplification stay DEFERRED (design I.6): a fitted
  // sensor item is the only source of sensors this patch. massReduction is the one secondary affix, and because the slot's base
  // mass is 0 (SLOT_BASE_PHYSICALS) a rolled massReduction is consumed into the piece's own (0-floored)
  // mass by generateEquipment and removed from rolledStats, so it too folds to nothing.
  //
  // The three varieties are the SCANNING ARRAYS (design I.2): WIDE-beam / FOCUSED-beam / BALANCED. Each
  // variety `key` IS a SENSOR_ARRAYS catalog id (sensorArrays.ts); the generation path stamps it onto the
  // instance as moduleVariant, exactly like a crew module, and exploration will later resolve the array's
  // scan-behavior params from the catalog. statRatios are empty because an array's per-variety behavior is
  // catalog-driven, not budget-biased (the scalar sensor ROLES ride the `sensors` power stat instead).
  sensor: {
    slotType: "sensor",
    label: "Sensor Array",
    implicitStats: ["sensors"],
    affixPool: [
      { stat: "sensors", weight: 5 },     // signature affix: most likely to roll
      { stat: "massReduction", weight: 1 },
    ],
    varieties: [
      { key: "sensorWideBeam", label: "Wide-Beam Array", statRatios: {} },
      { key: "sensorFocusedBeam", label: "Focused-Beam Array", statRatios: {} },
      { key: "sensorBalanced", label: "Balanced Array", statRatios: {} },
      // Exploration 0.14.0 (E4d): the RELIC-HUNTER array, the only array that raises relic find chance
      // (at the cost of slower scan cadence). Catalog-driven like its siblings (sensorArrays.ts). The FIRST
      // CRAFTABLE array: its blueprint (bioResonanceArrayBp) is discovery-gated by the Leviathan Scale.
      { key: "sensorBioResonance", label: "Bio-Resonance Array", statRatios: {} },
    ],
  },
  // E-MOD EM-5 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 3.3): the UNIVERSAL MODULE
  // slot, the accessory layer (H.1). Each variety `key` IS a UNIVERSAL_MODULES catalog id (shipModules.ts; the test
  // holds the two lists equal); the generation path stamps it onto the instance as moduleVariant, and the module's
  // effect is catalog-driven (its def, scaled by moduleEffectScale), so the slot carries NO signature line and NO affix
  // pool: rarity and quality act through the effect scale, and M5 ("unique effects only") keeps generic gear lines off
  // modules. The piece's power draw is its def's (itemgen.ts). The varieties arrive with the v1 roster (EM-7) and the
  // Precursor Lens (EM-8); until then the slot is hidden (shipModules.ts UNIVERSAL_MODULES_LIVE).
  module: {
    slotType: "module",
    label: "Module",
    implicitStats: [],
    affixPool: [],
    varieties: [],
  },
  // ==========================================================================================
  // E-CREW 0.14.0 (Task 7): AWAY-TEAM MEMBER GEAR (design D3/D4, section 5.4; names exactly as the
  // user-approved mockup). Four slots worn by named away-team MEMBERS (EquipmentInstance.fittedToMemberId),
  // NEVER by a hull: each member wears one Armor + one Weapon + one Tool + implants (1 slot, 2 with race
  // affinity, awayTeam.ts implantSlotsFor). They ride the ship-system gear engine (blueprints, Fabricator
  // blanks + inspect, quality / rarity / iLevel rolls, salvage, Lock / Favorite, Warehouse), so they are
  // ordinary EQUIPMENT_SLOTS entries; every ship-only list filters them with isMemberSlotType.
  //
  // STAT LINES are the GROUND vocabulary only (MEMBER_GROUND_STAT_KEYS), never a ship key, so nothing
  // here can move a ship's derived stats (equipmentStatMods ignores them explicitly). Many varieties carry
  // their own implicitStats / affixPool (the E4d per-variety override), since a Med Kit and a Stun Grenade
  // share a slot but not a job. Every member piece is stamped with its variety as `moduleVariant`
  // (generateEquipment), which is how the install gate (teamTypes), the tool readers (planetTypes /
  // encounterBias), the unique-equipped rule and the effect descriptors find the variety later.
  //
  // MEMBER TRAITS (each variety's `member: MemberVarietyTraits`, DORMANT DATA here; consumers are E-CREW
  // Tasks 8-16):
  //   teamTypes      , which squad types may wear it (REQUIRED; Prospecting pieces are built but HIDDEN
  //                    until the per-save unlock, prospecting.ts).
  //   weaponRange    , long (back line) vs short (front line) for the Security battle.
  //   planetTypes    , Science tools tuned to body types; ABSENT = works on any body (Decryptor).
  //   encounterBias  , the Security encounter dial (Shroud lowers the random-encounter chance, Lure raises
  //                    it and raises drops), a signed fraction of the base chance.
  //   uniqueEquipped , ONE worn in the entire fleet (D11, Neural Backup only).
  //   groundEffect   , a fixed special behavior (group hit, inflict / resist statuses, heal, revive).
  // SLOT LABELS read "Away-Team Armor / Weapon / Tool" so shared surfaces (Fabricator, Research, Archive,
  // salvage rows) never confuse a member Weapon with a ship weapon; the member card keeps its own short
  // cell headings. The implant slot needs no prefix (nothing ship-side is an implant).
  // ⚠️ FIRST-PASS TUNABLE ⚠️ every statRatio, weight and descriptor value.

  // MEMBER WEAPON: the sidearm a member carries. Signature groundPower; accuracy + affliction affixes.
  memberWeapon: {
    slotType: "memberWeapon",
    label: "Away-Team Weapon",
    implicitStats: ["groundPower"],
    affixPool: [
      { stat: "groundPower", weight: 4 },
      { stat: "groundAccuracy", weight: 3 },
      { stat: "groundStatusChance", weight: 1 },
    ],
    varieties: [
      // Pulse Rifle: the long-range Security standard, an even power / accuracy split.
      {
        key: "pulseRifle",
        label: "Pulse Rifle",
        member: { teamTypes: ["security"], weaponRange: "long" },
        implicitStats: ["groundPower", "groundAccuracy"],
        statRatios: { groundPower: 0.45, groundAccuracy: 0.45, groundStatusChance: 0.1 },
      },
      // Scattergun: short range, hits a GROUP of foes; raw power over aim.
      {
        key: "scattergun",
        label: "Scattergun",
        member: { teamTypes: ["security"], weaponRange: "short", groundEffect: { kind: "groupHit" } },
        statRatios: { groundPower: 0.7, groundAccuracy: 0.25, groundStatusChance: 0.05 },
      },
      // Shock Baton: short range, a chance to STUN on hit.
      {
        key: "shockBaton",
        label: "Shock Baton",
        member: { teamTypes: ["security"], weaponRange: "short", groundEffect: { kind: "inflict", status: "stun" } },
        implicitStats: ["groundPower", "groundStatusChance"],
        statRatios: { groundStatusChance: 0.5, groundPower: 0.4, groundAccuracy: 0.1 },
      },
      // Sidearm: the Science party's self-defense piece. Science never fights (D2), so its lines are SCIENCE lines (D26
      // "SWAP THE LINES"; user 2026-10-21 "Give them Science lines": relic find + fieldwork), the Prospecting tools'
      // pattern: its own signature lines and pool, never the slot's combat lines. Pieces crafted before the swap have
      // their combat lines remapped on load (save.ts withScienceLineSwapV70, SCIENCE_LINE_REMAP below).
      {
        key: "sidearm",
        label: "Sidearm",
        member: { teamTypes: ["science"], weaponRange: "short" },
        implicitStats: ["groundRelicFind", "groundFieldwork"],
        affixPool: [
          { stat: "groundRelicFind", weight: 3 },
          { stat: "groundFieldwork", weight: 3 },
        ],
        statRatios: { groundRelicFind: 0.5, groundFieldwork: 0.5 },
      },
      // Prospecting weapons (HIDDEN with the squad; design 2026-10-16 section 5, user "A cutting tool"): a WORK
      // implement whose "offense" is offense against rock (YIELD). No damage, no weaponRange: Prospecting never
      // fights. Each carries its own pools so none falls back to the slot's combat lines (D26).
      // Plasma Cutter: the Standard-Issue cutter, YIELD first, FIELD second.
      {
        key: "plasmaCutter",
        label: "Plasma Cutter",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundOreYield", "groundFieldwork"],
        affixPool: [
          { stat: "groundOreYield", weight: 4 },
          { stat: "groundFieldwork", weight: 3 },
          { stat: "groundOreGrade", weight: 1 },
        ],
        statRatios: { groundOreYield: 0.5, groundFieldwork: 0.4, groundOreGrade: 0.1 },
      },
      // Rock Breaker: the heavy hauler, almost all YIELD.
      {
        key: "rockBreaker",
        label: "Rock Breaker",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundOreYield"],
        affixPool: [
          { stat: "groundOreYield", weight: 4 },
          { stat: "groundFieldwork", weight: 2 },
        ],
        statRatios: { groundOreYield: 0.75, groundFieldwork: 0.25 },
      },
      // Sampling Lance: cuts clean cores, a GRADE lean.
      {
        key: "samplingLance",
        label: "Sampling Lance",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundOreGrade"],
        affixPool: [
          { stat: "groundOreGrade", weight: 3 },
          { stat: "groundOreYield", weight: 3 },
          { stat: "groundFieldwork", weight: 1 },
        ],
        statRatios: { groundOreGrade: 0.5, groundOreYield: 0.4, groundFieldwork: 0.1 },
      },
    ],
  },
  // MEMBER ARMOR: the suit. Signature groundArmor; HP + hazard affixes.
  memberArmor: {
    slotType: "memberArmor",
    label: "Away-Team Armor",
    implicitStats: ["groundArmor"],
    affixPool: [
      { stat: "groundArmor", weight: 4 },
      { stat: "groundHp", weight: 3 },
      { stat: "groundHazardResist", weight: 1 },
    ],
    varieties: [
      // Ballistic Weave: LIGHT Security armor, trades plating for aim.
      {
        key: "ballisticWeave",
        label: "Ballistic Weave",
        member: { teamTypes: ["security"] },
        affixPool: [
          { stat: "groundArmor", weight: 3 },
          { stat: "groundAccuracy", weight: 3 },
          { stat: "groundHp", weight: 2 },
        ],
        statRatios: { groundArmor: 0.4, groundAccuracy: 0.35, groundHp: 0.25 },
      },
      // Assault Hardsuit: HEAVY Security armor, armor AND hit points as its signature.
      {
        key: "assaultHardsuit",
        label: "Assault Hardsuit",
        member: { teamTypes: ["security"] },
        implicitStats: ["groundArmor", "groundHp"],
        statRatios: { groundArmor: 0.5, groundHp: 0.4, groundHazardResist: 0.1 },
      },
      // Field Suit: the Science party's working suit, protection that helps the work. D26 (user 2026-10-21 "Give them
      // Science lines"): fieldwork + hazard resist, its own signature lines and pool (armor and HP never acted for
      // Science); pieces crafted before have their armor / HP remapped on load (SCIENCE_LINE_REMAP below).
      {
        key: "fieldSuit",
        label: "Field Suit",
        member: { teamTypes: ["science"] },
        implicitStats: ["groundFieldwork", "groundHazardResist"],
        affixPool: [
          { stat: "groundFieldwork", weight: 3 },
          { stat: "groundHazardResist", weight: 2 },
        ],
        statRatios: { groundFieldwork: 0.6, groundHazardResist: 0.4 },
      },
      // Hazard Suit: Science, cuts the hazard slowdown on a hostile body. Prospecting shares it (user 2026-10-16:
      // "Hazard gear + Steady"); adding a squad to teamTypes changes no roll, and the worn-by line names only
      // unlocked squads (awayGearDisplay.ts memberWearersText).
      {
        key: "hazardSuit",
        label: "Hazard Suit",
        member: { teamTypes: ["science", "prospecting"] },
        // D26 review (user 2026-10-21): armor and HP dropped from its extra rolls (they never acted for Science). A piece
        // crafted before keeps them: on a Prospecting wearer they still feed prospecting.ts digSafety.
        implicitStats: ["groundHazardResist"],
        affixPool: [{ stat: "groundHazardResist", weight: 4 }],
        statRatios: { groundHazardResist: 1 },
      },
      // Excavator Suit (Prospecting, HIDDEN): the Standard-Issue work suit, hazard defense first, FIELD second.
      {
        key: "excavatorSuit",
        label: "Excavator Suit",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundHazardResist", "groundFieldwork"],
        affixPool: [
          { stat: "groundHazardResist", weight: 3 },
          { stat: "groundFieldwork", weight: 3 },
        ],
        statRatios: { groundHazardResist: 0.6, groundFieldwork: 0.4 },
      },
    ],
  },
  // MEMBER TOOL: the kit item. Signature groundFieldwork (the Science default); every Security tool
  // carries its own lines. Science tools are PLANET-TUNED (planetTypes); the fieldwork task applies a
  // tuned tool only on a matching body.
  memberTool: {
    slotType: "memberTool",
    label: "Away-Team Tool",
    implicitStats: ["groundFieldwork"],
    affixPool: [
      { stat: "groundFieldwork", weight: 4 },
      { stat: "groundRelicFind", weight: 2 },
      { stat: "groundHazardResist", weight: 2 },
    ],
    varieties: [
      // Security tools:
      // Stun Grenade: a thrown stun. Field Kits FKR-5: a SPECIALIZED grenade (2 charges, a light blast, Stun at the
      // thrower's status chance). Its pool gains the +1 carry capacity line (FK11) once FIELD_KITS_PLAYER_LIVE is
      // true (FKR-7); until then a new craft rolls exactly as before FKR-5. Pieces already minted keep their lines.
      {
        key: "stunGrenade",
        label: "Stun Grenade",
        member: {
          teamTypes: ["security"],
          groundEffect: { kind: "inflict", status: "stun" },
          grenade: {
            charges: { perObjective: GRENADE_CHARGES_SPECIALIZED, perBattle: GRENADE_THROWS_PER_BATTLE },
            powerMult: SPECIALIZED_GRENADE_POWER_MULT,
            status: "stun",
            // Timed grenades (user 2026-10-21): detonates at the start of the thrower's next turn.
            fuse: TIMED_GRENADE_FUSE,
          },
        },
        implicitStats: ["groundStatusChance"],
        ...grenadeCraftPool("stunGrenade"),
      },
      // Toxin Grenade: a thrown poison cloud. Field Kits FKR-5: a SPECIALIZED grenade (2 charges, a light blast,
      // Poison at the thrower's status chance), its pool with the carry capacity line once FIELD_KITS_PLAYER_LIVE.
      {
        key: "toxinGrenade",
        label: "Toxin Grenade",
        member: {
          teamTypes: ["security"],
          groundEffect: { kind: "inflict", status: "poison" },
          grenade: {
            charges: { perObjective: GRENADE_CHARGES_SPECIALIZED, perBattle: GRENADE_THROWS_PER_BATTLE },
            powerMult: SPECIALIZED_GRENADE_POWER_MULT,
            status: "poison",
            // Timed grenades (user 2026-10-21): detonates at the start of the thrower's next turn.
            fuse: TIMED_GRENADE_FUSE,
          },
        },
        implicitStats: ["groundStatusChance"],
        ...grenadeCraftPool("toxinGrenade"),
      },
      // Impact Grenade (the user's name, FK11: "an impact grenade explodes on contact, deals AoE damage and has a chance
      // to inflict a debuff"): the PLAIN grenade, Field Kits FKR-5. 4 charges, the target's group at 1.5x the thrower's
      // power, 30% Concussion (N6). It has NO passive groundEffect: its blast fires only when thrown, on a Field Kits
      // run; on any other run a worn one acts only through its stat lines, like any worn piece. Its blueprint is its
      // only source and stays hidden until FIELD_KITS_PLAYER_LIVE (FKR-7), so no player holds one before then. Its
      // lines raise the wearer's power and aim, which the blast reads; the carry capacity line adds a charge. Timed
      // grenades (user 2026-10-21): it is the DEFAULT grenade and carries no fuse, so it detonates on contact.
      {
        key: "impactGrenade",
        label: "Impact Grenade",
        member: {
          teamTypes: ["security"],
          grenade: {
            charges: { perObjective: GRENADE_CHARGES_PLAIN, perBattle: GRENADE_THROWS_PER_BATTLE },
            powerMult: IMPACT_GRENADE_POWER_MULT,
            status: "concussion",
            statusChance: IMPACT_GRENADE_CONCUSSION_CHANCE,
          },
        },
        implicitStats: ["groundPower"],
        affixPool: [
          { stat: "groundPower", weight: 3 },
          { stat: "groundAccuracy", weight: 3 },
          { stat: "groundCarryCapacity", weight: 1 },
        ],
        statRatios: { groundPower: 0.6, groundAccuracy: 0.25, groundCarryCapacity: 0.15 },
      },
      // Med Kit: the in-fight heal (the medic-style item the user asked Security to carry). D20: its HEAL
      // (and the medic abilities) need Medical Training (the fieldMedic trait). Its groundHp / groundArmor
      // stat lines apply to ANY wearer like every other piece; only the healing is gated.
      {
        key: "medKit",
        label: "Med Kit",
        member: { teamTypes: ["security"], groundEffect: { kind: "heal" } },
        implicitStats: ["groundHp"],
        affixPool: [
          { stat: "groundHp", weight: 4 },
          { stat: "groundArmor", weight: 1 },
        ],
        statRatios: { groundHp: 0.8, groundArmor: 0.2 },
      },
      // Shroud Emitter: the encounter dial turned DOWN (fewer random encounters).
      {
        key: "shroudEmitter",
        label: "Shroud Emitter",
        member: { teamTypes: ["security"], encounterBias: -0.4 },
        implicitStats: ["groundArmor"],
        affixPool: [
          { stat: "groundArmor", weight: 3 },
          { stat: "groundHp", weight: 2 },
        ],
        statRatios: { groundArmor: 0.6, groundHp: 0.4 },
      },
      // Lure Beacon: the encounter dial turned UP (more encounters, more drops).
      {
        key: "lureBeacon",
        label: "Lure Beacon",
        member: { teamTypes: ["security"], encounterBias: 0.4 },
        implicitStats: ["groundAccuracy"],
        affixPool: [
          { stat: "groundAccuracy", weight: 3 },
          { stat: "groundPower", weight: 2 },
        ],
        statRatios: { groundAccuracy: 0.6, groundPower: 0.4 },
      },
      // Science tools (planet-tuned):
      // Flora Scanner: organics finds on living worlds.
      {
        key: "floraScanner",
        label: "Flora Scanner",
        member: { teamTypes: ["science"], planetTypes: ["terrestrial", "ocean", "toxic"] },
        implicitStats: ["groundOrganicsYield"],
        affixPool: [
          { stat: "groundOrganicsYield", weight: 4 },
          { stat: "groundFieldwork", weight: 3 },
          { stat: "groundHazardResist", weight: 1 },
        ],
        statRatios: { groundOrganicsYield: 0.6, groundFieldwork: 0.3, groundHazardResist: 0.1 },
      },
      // Thermal Rig: fieldwork on volcanic and frozen bodies, with a hazard lean.
      {
        key: "thermalRig",
        label: "Thermal Rig",
        member: { teamTypes: ["science"], planetTypes: ["volcanic", "frozen"] },
        statRatios: { groundFieldwork: 0.55, groundHazardResist: 0.35, groundRelicFind: 0.1 },
      },
      // Core Drill: fieldwork on arid and barren bodies, with a relic lean (it digs).
      {
        key: "coreDrill",
        label: "Core Drill",
        member: { teamTypes: ["science"], planetTypes: ["arid", "barren"] },
        statRatios: { groundFieldwork: 0.55, groundRelicFind: 0.35, groundHazardResist: 0.1 },
      },
      // Decryptor: vaults and civilization sites on ANY body (no planetTypes).
      {
        key: "decryptor",
        label: "Decryptor",
        member: { teamTypes: ["science"] },
        implicitStats: ["groundVaultYield"],
        affixPool: [
          { stat: "groundVaultYield", weight: 4 },
          { stat: "groundRelicFind", weight: 3 },
        ],
        statRatios: { groundVaultYield: 0.6, groundRelicFind: 0.4 },
      },
      // Galileo-Class Probe (Gas Giant Study GG-1; the user's name, 2026-10-08): orbital fieldwork on a gas giant (no
      // surface to land on). The id stays `atmoProbe` and the ratios hold (call 6 "Reuse lines"), so saves and crafted
      // rolls do not move; GG-3 reads its three lines on a giant (fieldwork = study speed, hazard resist = crush
      // rating, relic find = ancient data odds).
      {
        key: "atmoProbe",
        label: "Galileo-Class Probe",
        member: { teamTypes: ["science"], planetTypes: ["gasGiant"] },
        statRatios: { groundFieldwork: 0.6, groundHazardResist: 0.3, groundRelicFind: 0.1 },
      },
      // Prospecting tools (HIDDEN with the squad), each with its own pools (no relic line):
      // Assay Scanner: the Standard-Issue role kit, GRADE first, FIELD second.
      {
        key: "assayScanner",
        label: "Assay Scanner",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundOreGrade", "groundFieldwork"],
        affixPool: [
          { stat: "groundOreGrade", weight: 4 },
          { stat: "groundFieldwork", weight: 2 },
          { stat: "groundHazardResist", weight: 1 },
        ],
        statRatios: { groundOreGrade: 0.6, groundFieldwork: 0.3, groundHazardResist: 0.1 },
      },
      // Seismic Mapper: reads the seam ahead, YIELD and pace.
      {
        key: "seismicMapper",
        label: "Seismic Mapper",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundOreYield"],
        affixPool: [
          { stat: "groundOreYield", weight: 3 },
          { stat: "groundFieldwork", weight: 3 },
          { stat: "groundHazardResist", weight: 1 },
        ],
        statRatios: { groundOreYield: 0.5, groundFieldwork: 0.4, groundHazardResist: 0.1 },
      },
    ],
  },
  // IMPLANT: the Cybernetics Bay catalog. Security implants are COMBAT (incl. sustain + status resists +
  // Neural Backup); Science implants are OVERWORLD (fieldwork). Every implant carries its own lines.
  implant: {
    slotType: "implant",
    label: "Implant",
    implicitStats: ["groundHp"],
    affixPool: [
      { stat: "groundHp", weight: 3 },
      { stat: "groundArmor", weight: 2 },
    ],
    varieties: [
      // Security (combat) implants:
      // Dermal Weave: subdermal plating.
      {
        key: "dermalWeave",
        label: "Dermal Weave",
        member: { teamTypes: ["security"] },
        implicitStats: ["groundArmor"],
        affixPool: [
          { stat: "groundArmor", weight: 3 },
          { stat: "groundHp", weight: 2 },
        ],
        statRatios: { groundArmor: 0.7, groundHp: 0.3 },
      },
      // Reflex Booster: faster reactions, harder to hit and quicker on target.
      {
        key: "reflexBooster",
        label: "Reflex Booster",
        member: { teamTypes: ["security"] },
        implicitStats: ["groundAccuracy", "groundArmor"],
        affixPool: [
          { stat: "groundAccuracy", weight: 3 },
          { stat: "groundArmor", weight: 2 },
        ],
        statRatios: { groundAccuracy: 0.5, groundArmor: 0.5 },
      },
      // Targeting Optic: an ocular aim assist, with a lean toward landing afflictions.
      {
        key: "targetingOptic",
        label: "Targeting Optic",
        member: { teamTypes: ["security"] },
        implicitStats: ["groundAccuracy"],
        affixPool: [
          { stat: "groundAccuracy", weight: 4 },
          { stat: "groundStatusChance", weight: 1 },
        ],
        statRatios: { groundAccuracy: 0.8, groundStatusChance: 0.2 },
      },
      // Adrenal Surge: raw striking power.
      {
        key: "adrenalSurge",
        label: "Adrenal Surge",
        member: { teamTypes: ["security"] },
        implicitStats: ["groundPower"],
        affixPool: [
          { stat: "groundPower", weight: 4 },
          { stat: "groundHp", weight: 1 },
        ],
        statRatios: { groundPower: 0.8, groundHp: 0.2 },
      },
      // Med-Nanite Swarm: sustain, a deeper hit-point pool.
      {
        key: "medNaniteSwarm",
        label: "Med-Nanite Swarm",
        member: { teamTypes: ["security"] },
        implicitStats: ["groundHp"],
        affixPool: [
          { stat: "groundHp", weight: 4 },
          { stat: "groundArmor", weight: 1 },
        ],
        statRatios: { groundHp: 0.8, groundArmor: 0.2 },
      },
      // Toxin Filters: resists poison.
      {
        key: "toxinFilters",
        label: "Toxin Filters",
        member: { teamTypes: ["security"], groundEffect: { kind: "resistStatus", statuses: ["poison"] } },
        implicitStats: ["groundStatusResist"],
        affixPool: [
          { stat: "groundStatusResist", weight: 3 },
          { stat: "groundHp", weight: 2 },
        ],
        statRatios: { groundStatusResist: 0.7, groundHp: 0.3 },
      },
      // Cortex Shield: resists stun and fear.
      {
        key: "cortexShield",
        label: "Cortex Shield",
        member: { teamTypes: ["security"], groundEffect: { kind: "resistStatus", statuses: ["stun", "fear"] } },
        implicitStats: ["groundStatusResist"],
        affixPool: [
          { stat: "groundStatusResist", weight: 3 },
          { stat: "groundArmor", weight: 2 },
        ],
        statRatios: { groundStatusResist: 0.7, groundArmor: 0.3 },
      },
      // Neural Backup (Heart of the Archive's first-find unlock): UNIQUE-EQUIPPED, one in the entire
      // fleet (D11). Once per battle, a ~50% chance to revive the first downed member at 30% HP (E-CREW
      // Task 16 reads the descriptor). Its rolled lines are modest sustain; the revive is the point.
      {
        key: "neuralBackup",
        label: "Neural Backup",
        member: {
          teamTypes: ["security"],
          uniqueEquipped: true,
          groundEffect: { kind: "revive", chance: 0.5, hpFraction: 0.3 },
        },
        implicitStats: ["groundHp"],
        affixPool: [
          { stat: "groundHp", weight: 2 },
          { stat: "groundArmor", weight: 1 },
        ],
        statRatios: { groundHp: 0.7, groundArmor: 0.3 },
      },
      // Science (overworld) implants:
      // Synaptic Accelerator: faster fieldwork.
      {
        key: "synapticAccelerator",
        label: "Synaptic Accelerator",
        member: { teamTypes: ["science"] },
        implicitStats: ["groundFieldwork"],
        affixPool: [
          { stat: "groundFieldwork", weight: 3 },
          { stat: "groundRelicFind", weight: 1 },
        ],
        statRatios: { groundFieldwork: 0.8, groundRelicFind: 0.2 },
      },
      // Archaeo-Scanner: relic odds.
      {
        key: "archaeoScanner",
        label: "Archaeo-Scanner",
        member: { teamTypes: ["science"] },
        implicitStats: ["groundRelicFind"],
        affixPool: [
          { stat: "groundRelicFind", weight: 3 },
          { stat: "groundFieldwork", weight: 2 },
        ],
        statRatios: { groundRelicFind: 0.7, groundFieldwork: 0.3 },
      },
      // Environmental Adaptation: shrugs off a hostile body's hazards. Shared with Prospecting (user 2026-10-16:
      // "Hazard gear + Steady"), the Hazard Suit's rule.
      {
        key: "environmentalAdaptation",
        label: "Environmental Adaptation",
        member: { teamTypes: ["science", "prospecting"] },
        implicitStats: ["groundHazardResist"],
        affixPool: [
          { stat: "groundHazardResist", weight: 3 },
          { stat: "groundFieldwork", weight: 1 },
        ],
        statRatios: { groundHazardResist: 0.8, groundFieldwork: 0.2 },
      },
      // Cipher Wetware: reads vaults and civilization sites.
      {
        key: "cipherWetware",
        label: "Cipher Wetware",
        member: { teamTypes: ["science"] },
        implicitStats: ["groundVaultYield"],
        affixPool: [
          { stat: "groundVaultYield", weight: 3 },
          { stat: "groundRelicFind", weight: 1 },
        ],
        statRatios: { groundVaultYield: 0.8, groundRelicFind: 0.2 },
      },
      // Bio-Analyzer: organics finds.
      {
        key: "bioAnalyzer",
        label: "Bio-Analyzer",
        member: { teamTypes: ["science"] },
        implicitStats: ["groundOrganicsYield"],
        affixPool: [
          { stat: "groundOrganicsYield", weight: 3 },
          { stat: "groundFieldwork", weight: 1 },
        ],
        statRatios: { groundOrganicsYield: 0.8, groundFieldwork: 0.2 },
      },
      // Prospecting implants (HIDDEN with the squad; Cybernetics Bay):
      // Ore-Sense Optic: sees the grade in the rock.
      {
        key: "oreSenseOptic",
        label: "Ore-Sense Optic",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundOreGrade"],
        affixPool: [
          { stat: "groundOreGrade", weight: 4 },
          { stat: "groundFieldwork", weight: 1 },
        ],
        statRatios: { groundOreGrade: 0.8, groundFieldwork: 0.2 },
      },
      // Myo-Lift Frame: a powered lift assist, more hauled out of every seam.
      {
        key: "myoLiftFrame",
        label: "Myo-Lift Frame",
        member: { teamTypes: ["prospecting"] },
        implicitStats: ["groundOreYield"],
        affixPool: [
          { stat: "groundOreYield", weight: 3 },
          { stat: "groundFieldwork", weight: 2 },
        ],
        statRatios: { groundOreYield: 0.6, groundFieldwork: 0.4 },
      },
    ],
  },
};

// ============================================================================
// Equipment 0.11.0 (Task 3): the STAT-KEY REGISTRY. The single source of truth
// for the stat VOCABULARY equipment stat lines draw from. DATA/VOCABULARY ONLY:
// these are just the string keys, no magnitudes and no fold-in logic (a later
// task maps the LIVE keys onto ship-derived stats). Split into two clearly
// separated groups, LIVE and RESERVED, so the boundary between "consumed this
// patch" and "forward vocabulary" is explicit rather than implied.
// ============================================================================

// LIVE today: the 16 stat keys the six live slots (EQUIPMENT_SLOTS above)
// actually reference across their implicitStats, affixPool, and variety
// statRatios. The model.test.ts drift guard asserts EVERY stat key in the slot
// table is a member here, so a stray or typo'd key in the slot data fails the
// suite instead of silently shipping an un-consumed stat. `as const` freezes the
// tuple so the literals become the type (see LiveStatKey below), mirroring this
// file's named-union convention.
export const LIVE_STAT_KEYS = [
  // Five that align with existing ship-derived fields (the later fold-in task
  // maps equipment contributions onto these same ship stats):
  "cargoCapacity",
  "transitSpeedMult",
  "engineEfficiency",
  "fuelCapacity",
  "extractionYieldMult",
  // Five NEW equipment-only stat lines the slot table introduces (no ship field
  // yet; the fold-in task defines how each resolves):
  "powerOutput",
  "powerDrawReduction",
  "massReduction",
  "sensors",
  "materialQualityChance",
  // Combat 1.0 (Unit 1.1): the six DEFENSIVE combat-gear stat lines, activated from the
  // reserved vocabulary when the shield emitter + hull plating slots were defined. shipToCombatant
  // reads these off installed gear in Unit 1.4; registering them live here lets the slot table's
  // allow-set accept the two new combat slots' implicit + affix stats.
  "shieldCapacity",
  "shieldRecharge",
  "shieldCoherence",
  "hullStrength",
  "ablativeArmor",
  "kineticDampening",
  // Crew 0.14.0 (Phase 1b): the two CREW-MODULE signature keys, activated from the reserved
  // vocabulary when the bridge + quarters slots were defined. crewStations (quarters signature =
  // crew capacity) + crewEfficiency (quarters affix + bridge signature = crew comfort / officer
  // output). LIVE means "a slot references them" (the drift guard fences that); they are NOT
  // folded by equipmentStatMods, because a crew
  // module's real effect is catalog-driven (crewModules.ts), scaled per the capacity principle,
  // not read off these budget lines. Installing a module therefore leaves shipDerivedStats
  // byte-identical; only the crew overlay reacts. (`sensors`, as of Exploration 0.14.0 E1a, and
  // `materialQualityChance`, as of Material Lines ML-3, are LIVE keys that DO fold; see equipmentStatMods.)
  "crewStations",
  "crewEfficiency",
  // Exploration 0.14.0 (E4d): the relic-unlocked utility items' stat lines. LIVE (a slot variety
  // references them) but, like crewStations / crewEfficiency, NOT folded by equipmentStatMods: each is
  // read by a dedicated reader in utilityGear.ts, so installing one leaves shipDerivedStats
  // byte-identical (only the Pathfinder Suite's `sensors` line folds, through the existing case).
  //   repairSpeed / waveHullRegen         , Damage Control Suite (repair time + between-wave hull regen)
  //   expeditionScanSpeed / hazardResist  , Pathfinder Suite (expedition dispatch snapshot)
  "repairSpeed",
  "waveHullRegen",
  "expeditionScanSpeed",
  "hazardResist",
  // G1-1 (Short-Range Missions, 0.14.0): GUEST QUARTERS, the berths passengers ride in, MOVED from RESERVED_STAT_KEYS
  // when the Crew Quarters affix line and the Guest Wing's signature line went live. FOLDED by equipmentStatMods as a
  // flat berth count into ShipDerivedStats.colonistCapacity (shown as "Guest quarters"); the short-range passenger
  // runs (G1-4) read it. Never crew: it moves no complement capacity and never stands in for the cargo hold.
  "colonistCapacity",
] as const;

// RESERVED forward vocabulary for 0.12.0 (combat / crew / sensor / defense).
// Defined NOW so those systems plug in without a model change, but there is NO
// CONSUMER this patch: no slot references any of these, and no fold-in reads
// them. Same POPULATED-but-INERT posture as the reserved EquipmentSlotType
// members and SHIP_TYPES.moduleSlots. Grouped by domain in comments for
// readability; the array is flat because consumers only need membership /
// enumeration, not the grouping.
export const RESERVED_STAT_KEYS = [
  // Logistics / crew / sensor:
  // (crewStations + crewEfficiency MOVED to LIVE_STAT_KEYS in Crew 0.14.0 Phase 1b when the bridge +
  // quarters crew-module slots were activated, exactly as the six defensive gear stats moved to LIVE
  // in Combat 1.0 Unit 1.1. colonistCapacity MOVED to LIVE_STAT_KEYS in G1-1, Short-Range Missions 0.14.0.)
  "droneCapacity",
  "shortRangeSensors",
  "longRangeSensors",
  "sensorEfficiency",
  // Propulsion / base attributes:
  "movementSpeed",
  "maneuverability",
  "massBase",
  "powerDrawBase",
  // Weapons (the 9 first-pass weapons share this one stat shape):
  "weaponYield",
  "weaponAttackRate",
  "weaponAccuracy",
  "weaponProjectileCount",
  // Defense: the particle Shield Attenuation signature stays RESERVED until weapons land in
  // Unit 1.2 (it is a weapon OFFENSIVE stat, not a defensive gear stat). Renamed from
  // bleedthrough (Combat 0.13.0 design S5); a pure identifier rename, INERT, no migration. The
  // six DEFENSIVE gear stats (shieldCapacity, shieldRecharge, shieldCoherence, hullStrength,
  // ablativeArmor, kineticDampening) MOVED to LIVE_STAT_KEYS in Combat 1.0 Unit 1.1 when the
  // shield emitter + hull plating slots were activated.
  "shieldAttenuation",
] as const;

// E-CREW 0.14.0 (Task 7): the GROUND stat vocabulary, a THIRD group beside LIVE and RESERVED. These are
// the stat lines away-team MEMBER gear (the four member slot types) rolls, and ONLY member gear: no ship
// slot references them and equipmentStatMods NEVER folds them into ShipDerivedStats (they hit its
// explicit ignore case), so a member piece anywhere in state.equipment leaves every ship's derived stats
// byte-identical. Every key carries a `ground` prefix so a ground line can never collide with a ship line
// of the same idea (the Pathfinder Suite's ship-side `hazardResist` vs a Hazard Suit's groundHazardResist).
//
// Like every gear line they are raw budget POINTS (generateEquipment's budget split), not fractions; the
// member-power task converts them onto the member's stats (awayTeam.ts GROUND_STAT_MEMBER_STAT maps each
// key to the AwayMemberStat it raises, or null for the lines with no member stat yet; its CONVERSION
// CONTRACT says which task converts which line). Consumers land in E-CREW Tasks 12-16; this task ships
// the vocabulary + catalog only.
//   groundHp / groundPower / groundArmor / groundAccuracy , Security combat lines (the member card's
//                                                            HP / PWR / ARM / ACC)
//   groundStatusChance                                    , folds into the member-wide statusChance, the
//                                                            chance an `inflict` piece applies its status
//   groundStatusResist                                    , the member's chance to resist the statuses its
//                                                            `resistStatus` pieces list (Toxin Filters, Cortex Shield)
//   groundFieldwork / groundRelicFind / groundHazardResist , Science fieldwork lines (FIELD / RELIC / HAZ)
//   groundOrganicsYield / groundVaultYield                 , fieldwork YIELD toward one find family
//                                                            (organics: Flora Scanner, Bio-Analyzer;
//                                                            vaults: Decryptor, Cipher Wetware)
//   groundOreYield / groundOreGrade                        , Prospecting lines (YIELD / GRADE, user 2026-10-16:
//                                                            "Add YIELD + GRADE"): units per deposit and the lift
//                                                            on the better-tier roll. HIDDEN with the squad; only
//                                                            Prospecting pieces roll them (prospecting.ts)
//   groundCarryCapacity                                   , Field Kits FKR-5 (FK11 "+1 carry capacity"): a grenade's
//                                                            extra charge per objective. Stored as GRENADE_CARRY_PER_LINE
//                                                            (a count, not budget points); no member stat (awayTeam.ts
//                                                            toolCharges reads it)
// The tools' encounter dial (Shroud / Lure) is NOT a stat line: it is the variety's `encounterBias`
// descriptor (EquipmentVarietyDef), a fixed property of the tool rather than a rolled magnitude.
export const MEMBER_GROUND_STAT_KEYS = [
  "groundHp",
  "groundPower",
  "groundArmor",
  "groundAccuracy",
  "groundStatusChance",
  "groundStatusResist",
  "groundFieldwork",
  "groundRelicFind",
  "groundHazardResist",
  "groundOrganicsYield",
  "groundVaultYield",
  "groundOreYield",
  "groundOreGrade",
  "groundCarryCapacity",
] as const;
export type MemberGroundStatKey = (typeof MEMBER_GROUND_STAT_KEYS)[number];

// Grouped view of the SAME arrays for a caller that wants the whole
// vocabulary in one object (the design doc's "stat registry"). No new data, just
// a convenience handle: import LIVE_STAT_KEYS / RESERVED_STAT_KEYS directly for a
// Set-membership check, or STAT_KEYS.live / STAT_KEYS.reserved to enumerate.
// (E-CREW 0.14.0: STAT_KEYS.ground is the member-only vocabulary above.)
export const STAT_KEYS = { live: LIVE_STAT_KEYS, reserved: RESERVED_STAT_KEYS, ground: MEMBER_GROUND_STAT_KEYS } as const;

// Union types over the two vocabularies, for a future field/param that must hold
// a KNOWN stat key. Forward convenience (no consumer this patch); derived from
// the `as const` arrays so they can never drift from the runtime lists.
export type LiveStatKey = (typeof LIVE_STAT_KEYS)[number];
export type ReservedStatKey = (typeof RESERVED_STAT_KEYS)[number];
export type StatKey = LiveStatKey | ReservedStatKey | MemberGroundStatKey;

// Combat 0.13.0 (Phase 9b.5a): the mission-KIND discriminant. A captain can now run
// one of several KINDS of mission, so CaptainState.mission is a discriminated union
// (CaptainMissionState | PatrolMissionState | null) keyed on this literal. EXTENSIBLE
// on purpose: adding a member here (e.g. a future "science" survey) forces every
// exhaustive switch over the kind (economyTick's routing, the tickers) to handle it
// or fail to compile. "extraction" is today's resource-extraction mission; "patrol" is
// the 0.13.0 combat patrol (PatrolMissionState below).
// G1-3 (Short-Range Missions): "shortRange" is a board slot's run (ShortRangeMissionState below).
export type MissionKind = "extraction" | "patrol" | "shortRange";

// Short-Range Missions (G1-3, docs/plans/2026-10-17-short-range-missions-plan.md 3.1 and 3.6).
// One cycle of a short-range run: transit out, the job on site, transit back, the home turnaround (unloading, which
// occupies a transit berth on the captain-mission rules, call 18: berths.ts).
export type ShortRangePhase = "transitOut" | "onSite" | "transitBack" | "unloading";

// Display labels for a short-range phase (the PATROL_PHASE_LABEL counterpart). Exhaustive over ShortRangePhase.
export const SHORT_RANGE_PHASE_LABEL: Record<ShortRangePhase, string> = {
  transitOut: "Transiting Out",
  onSite: "On Site",
  transitBack: "Transiting Back",
  unloading: "Unloading",
};

// The "shortRange" arm of the CaptainState.mission union: a captain and their hull flying one board slot, cycle after
// cycle until recalled (call 1: every cycle re-rolls the whole job). The cycle's roll AND its phase lengths are FROZEN
// at the cycle start (shortRangeBoard.ts startShortRangeCycle), so offline == live by construction and every reader
// (the cycle engine G1-4, the berth queue, the readouts) agrees without re-deriving. The hull, its gear and its crew
// cannot change while it is out (the crew lock), so the frozen plan always equals a fresh one. Only new code writes
// this arm (no save carries it before G1-3), so the union widening needs no migration; save.ts drops a malformed one
// at load (the captain idles, no reward).
export interface ShortRangeMissionState {
  kind: "shortRange"; // discriminant
  slotId: number; // the board slot (shortRangeBoardSlots); one captain per slot
  roll: ShortRangeRoll; // this cycle's job (shortRange.ts rollShortRangeJob), frozen at the cycle start
  plan: ShortRangeCyclePlan; // this cycle's phase lengths (shortRange.ts shortRangeCyclePlan), frozen with the roll
  phase: ShortRangePhase;
  phaseProgressTicks: number; // ticks banked in the current phase
  // Recall intent: the run ends (mission -> null) when THIS cycle's home turnaround completes, instead of starting
  // the next cycle. Unlike an extraction recall it never breaks off mid-cycle (plan 4 G1-3, QA 4: "the ship finishes
  // the cycle and stops"). Set by recallCaptain, or at dispatch for a single run.
  recalled: boolean;
  // 0.14.0 SPEED SEAM (ProcessSpeed, the extraction arm's field): the time skip flags THIS cycle; the cycle engine
  // (G1-4, shortRangeCycle.ts) runs it through to its delivery. The next cycle is a fresh object without it.
  speed?: ProcessSpeed;
  // G1-4 (user 2026-10-20 "At cycle start"): the working capital a Supply Drop-off paid as THIS cycle left home (its
  // supplies, after the captain's Trade discount). Written only on a paid cycle; the delivery returns the full load
  // value plus the margin. Absent on every other job and before departure.
  loadPaid?: number;
  // G1-4: the cycles this run has delivered (the run's completion log entry counts them). Absent until the first.
  cyclesThisRun?: number;
}

// The board's per-slot cycle cursor (GameState.shortRangeBoard): slot id -> the cycle index its NEXT roll reads
// (rollShortRangeJob). Advanced only by a delivered cycle (G1-4), so a skipped or idled roll is never re-drawn and no
// stream shifts (plan 3.1). Slot count and tiers are DERIVED from Mission Control (shortRangeBoardSlots), never here.
export interface ShortRangeBoardState {
  version: 1;
  nextCycle: Record<number, number>;
}

// The EXTRACTION arm of the CaptainState.mission discriminated union (Combat 0.13.0,
// Phase 9b.5a). Behavior is UNCHANGED from before the union: every field and every
// consumer path is byte-identical; the only addition is the required `kind` tag that
// distinguishes this arm from PatrolMissionState at every union-consuming site (which
// now narrows on `mission.kind === "extraction"` before reading the extraction-only
// fields below). Constructed by dispatchCaptainOnMission (tick.ts) and backfilled onto
// pre-v32 saves by the v31->v32 migration (save.ts, which stamps kind:"extraction").
export interface CaptainMissionState {
  kind: "extraction"; // discriminant: tags this as the extraction arm of the mission union
  missionKey: MissionKey;
  phase: MissionPhase;
  phaseProgressTicks: number; // continuous (can be fractional mid-tick) so multi-tick deltas land on exact phase boundaries
  cargo: Record<LootMaterialKey, Decimal>;
  recalled: boolean; // if true, ends the loop (mission -> null) after THIS cycle's unloading completes,
  // instead of auto-restarting at ordersReceived. Does not interrupt the current cycle mid-flight.
  // FUEL ECONOMY v2 (F3, design §3): the "+2 ticks" refuel-at-a-non-allied-station delay for
  // THIS cycle, REFUEL_PENALTY_TICKS when this cycle had to auto-buy its fuel shortfall from
  // credits (tank short but affordable at the cycle boundary), otherwise 0. Added to the
  // ordersReceived phase's required ticks in tickCaptainMission, so a penalized cycle runs 2
  // ticks longer. CLOSED-FORM: it is a per-cycle constant stamped at the cycle boundary, so it
  // advances identically one-big-call vs many-stepped-calls (the offline==live parity proof).
  // OPTIONAL so pre-F3 saves (whose in-flight missions predate the field) rehydrate as absent
  // and are read as 0 (`?? 0`), no migration needed; a fresh cycle always sets it explicitly.
  refuelDelayTicks?: number;
  // E-CREW 0.14.0 (Task 20 review): how many cycles of THIS run delivered under Command Presence. It keys
  // the PRIVATE rounding stream that keeps a whole delivery whole (tick.ts tickCaptainMission), so no two
  // cycles of a run share a rounding roll and no shared stream is touched. Stamped and carried forward
  // ONLY while the bonus is non-zero, so a run without the officer never writes it (byte-identical; no
  // SAVE_VERSION bump, absent reads as 0).
  outputRoundCursor?: number;
  // 0.14.0 SPEED SEAM (ProcessSpeed): instantComplete runs THIS cycle through to its delivery on the next tick. The
  // next cycle is a freshly built object without it. Absent = byte-identical.
  speed?: ProcessSpeed;
}

// --- Combat Patrol mission (Combat 0.13.0, Phase 9b.5a, design §S14) -----------
// The coarse ROUTE PHASE of a patrol, analogous to MissionPhase for extraction but
// patrol-shaped: a patrol flies OUT (no waves, shields regen), fights through the
// wave window ("engaging"), then flies BACK. The boundaries are derived from the
// PatrolDef (transitOutTicks / rollWindowTicks / transitBackTicks) against the global
// progressTicks counter; the 9b.5b patrol tick loop ADVANCES this phase as progressTicks
// crosses those boundaries. Kept explicit (not purely derived) to mirror the extraction
// model's explicit `phase` and to give the 9b.5b loop + any readout a stable label.
// Combat 0.13.0 (Phase 11, design S13): "limpingHome" is the DEFEAT phase. transitOut ->
// engaging -> transitBack are the normal route phases (derived from progress by
// patrolPhaseFor); "limpingHome" is set EXPLICITLY by tickCaptainPatrol when a wave is lost
// and is NEVER produced by patrolPhaseFor. While in it the patrol fights no waves and does
// no recovery, it just counts down limpTicksRemaining (2x the return leg), keeping the
// captain busy until the wrecked hull reaches base, at which point the mission ends and the
// ship is flagged damaged. A pre-P11 save never carries this phase (it is only ever written
// by new code), so widening the union needs no migration.
export type PatrolPhase = "transitOut" | "engaging" | "transitBack" | "limpingHome";

// Display-only phase labels for a combat patrol's phase readout (0.13.1 DRY
// consolidation, the patrol counterpart to MISSION_PHASE_LABEL above). PREVIOUSLY
// duplicated in App.svelte AND homeDashboard.ts; hoisted here as the single source
// both import. "limpingHome" is the DEFEAT state (the ship lost and is limping its
// wreck home to repair), phrased as a plain player-facing label. Must stay in sync
// with the PatrolPhase union: a new phase without an entry here is a compile error.
export const PATROL_PHASE_LABEL: Record<PatrolPhase, string> = {
  transitOut: "Transiting Out",
  engaging: "Engaging",
  transitBack: "Returning",
  limpingHome: "Limping Home",
};

// The player ship's per-SYSTEM DURABILITY carry-state (Combat 0.13.0, Phase 12b Unit B2,
// design S9), persisted on PatrolMissionState.playerSystemDurability so wear ACCUMULATES
// across the waves of one patrol cycle. It records only the CURRENT durability of each
// durable system (durabilityMax + quality are re-derived identically each wave from the
// fresh loadout build, so they are not carried). JSON-safe by construction: plain numbers
// only, no Decimal / class instances (mirrors DroneSquadron), so it round-trips with no
// hydrateDecimals step. The two combat/ helpers that produce + consume it are
// defaultSystemDurabilityForHull (bridge.ts, the FULL seed) and capturePlayerSystemDurability
// / buildPatrolPlayerCombatant (patrolWave.ts, the post-wave capture + next-wave apply).
export interface PatrolSystemDurability {
  // Current durability of each weapon, aligned BY INDEX to the hull's default loadout
  // (COMBAT_DEFAULT_LOADOUT, rebuilt in the same fixed order every wave). Length == the
  // hull's default weapon count.
  weapons: number[];
  // Current durability of the reactor (0 if a bare fixture has none; a real ship always has it).
  reactor: number;
  // Current durability of the ftl/drive (0 if a bare fixture has none; a real ship always has it).
  ftl: number;
}

// The PERSISTED patrol-mission shape: the "patrol" arm of the CaptainState.mission
// discriminated union. Carries EVERYTHING needed to DISPATCH a patrol, RESUME it after
// a save/load, and (in 9b.5b) RUN it wave-by-wave, so 9b.5b adds NO new persisted field
// (avoiding a second SAVE_VERSION bump). WHO WRITES each field is noted: `dispatch` =
// dispatchCaptainOnPatrol (tick.ts, this unit); `9b.5b` = the not-yet-written patrol
// tick loop. All fields are plain numbers / strings / arrays of plain-number records
// (DroneSquadron holds no Decimal), so the shape round-trips through JSON with NO
// hydrateDecimals change (unlike the extraction arm's Decimal cargo).
export interface PatrolMissionState {
  kind: "patrol"; // discriminant: tags this as the patrol arm of the mission union
  // WHICH patrol (a PATROLS key). dispatch sets it; 9b.5b reads PATROLS[patrolKey] for
  // the static def (wave params, hull pool, transit legs), exactly as extraction reads
  // MISSIONS[missionKey]. Set by: dispatch.
  patrolKey: PatrolKey;
  // The FACTIONS id this patrol fights (copied from the def at dispatch so the fought
  // faction is pinned even if the def is ever retuned mid-flight). Set by: dispatch.
  factionId: string;
  // The player-chosen combat STANCE for every wave this patrol fights (design S6). Set
  // by: dispatch (from the dispatch arg).
  stance: CombatStance;
  // The persisted MASTER SEED (a plain int, never reused, drawn from GameState
  // .nextPatrolSeed at dispatch). 9b.5b derives every encounter's battle seed from this
  // (e.g. masterSeed + waveIndex) so an offline catch-up resolves BYTE-IDENTICALLY to a
  // live run (design S0). It also seeded the wave schedule below. Set by: dispatch.
  masterSeed: number;
  // Coarse route phase (see PatrolPhase). dispatch seeds "transitOut" (progressTicks 0);
  // 9b.5b advances it. Set by: dispatch (initial), then 9b.5b.
  phase: PatrolPhase;
  // GLOBAL route ticks elapsed since dispatch (0 at dispatch). This is the ABSOLUTE
  // route position the wave schedule is indexed against (waveTicks holds absolute route
  // ticks), so 9b.5b compares progressTicks directly to waveTicks[nextWaveIndex]. `phase`
  // above is consistent with this by construction (the loop crosses phase boundaries at
  // the def's transit/window tick counts). Set by: dispatch (0), then 9b.5b.
  progressTicks: number;
  // The RESOLVED wave schedule: the absolute route ticks at which waves occur, computed
  // ONCE at dispatch via planWaveSchedule(masterSeed, def-derived params). WAVE-PLAN-NOW
  // (not deferred to the first tick): the seed is fixed at dispatch, so the schedule is
  // fully determined then; persisting the resolved array makes save/load trivially
  // stable (no recompute-on-load ambiguity) and lets 9b.5b's loop read waveTicks
  // [nextWaveIndex] with zero setup. Determinism/offline-parity is preserved because it
  // is a pure function of the persisted masterSeed. Set by: dispatch.
  waveTicks: number[];
  // Pointer into waveTicks: the index of the NEXT unfought wave (0 at dispatch, advanced
  // to waveTicks.length when all waves are done). Persisting the resolved waveTicks +
  // this pointer is the simplest save/load-stable representation (chosen over persisting
  // only the params + recomputing, which would risk a param/def drift on reload). Set
  // by: dispatch (0), then 9b.5b.
  nextWaveIndex: number;
  // Running tally of waves CLEARED. Set by: dispatch (0), then 9b.5b.
  wavesWon: number;
  // Running tally of waves LOST. A loss is normally terminal (the ship is destroyed ->
  // the patrol ends), so this is 0 or 1 in practice; kept as a count for a uniform
  // wins/losses readout and forward flexibility. Set by: dispatch (0), then 9b.5b.
  wavesLost: number;
  // PLAYER CARRY-STATE between waves (design S14): the hull PERSISTS and accumulates
  // damage across waves. Seeded at dispatch to the ship's FULL hull (SHIP_TYPES
  // [typeKey].hullIntegrity, the same pool bridge.ts's shipToCombatant reads). Set by:
  // dispatch (full), then 9b.5b (carries damage forward).
  playerHull: number;
  // PLAYER CARRY-STATE: the shield pool, which REGENERATES per tick toward full between
  // waves (design S14). Seeded at dispatch to the ship's full shieldCapacity. Set by:
  // dispatch (full), then 9b.5b.
  playerShield: number;
  // PLAYER CARRY-STATE: the drone squadrons, which REPLENISH per tick between waves
  // (design S14). Seeded at dispatch from the hull's default loadout (a carrier's Attack
  // screen via COMBAT_DEFAULT_LOADOUT; EMPTY for a non-carrier combat hull). DroneSquadron
  // holds only plain numbers/strings, so this array is JSON-safe with no hydration. Set
  // by: dispatch (fresh squadrons), then 9b.5b (carries losses/replenish forward).
  playerDrones: DroneSquadron[];
  // PLAYER CARRY-STATE (Combat 0.13.0, Phase 12b Unit B2, design S9): the player ship's
  // per-SYSTEM DURABILITY, which now ACCUMULATES wear across the waves of one patrol cycle
  // (Unit B1 wore systems live but rebuilt them full each wave; B2 persists that wear). It
  // holds the CURRENT durability of each weapon (aligned by index to the hull's default
  // loadout, which is rebuilt in the SAME fixed order every wave), the reactor, and the ftl.
  // Only CURRENT durability is carried, NOT durabilityMax / quality: those are re-derived
  // identically each wave from the fresh loadout build, so carrying them would be redundant
  // (and a drift risk). Seeded at dispatch to FULL (defaultSystemDurabilityForHull, bridge.ts
  // == no wear); captured post-battle each wave (capturePlayerSystemDurability, patrolWave.ts)
  // and applied on the NEXT wave's player build (buildPatrolPlayerCombatant). Plain numbers
  // only, so it is JSON-safe with NO Decimal / hydration, exactly like playerDrones. Set by:
  // dispatch (full), then tickCaptainPatrol (carries accumulating wear forward). This wear does
  // NOT outlive the patrol: on a defeat the mission (and this field) end when the wreck limps
  // home, so a repaired ship starts fresh; permanent on-gear durability arrives with weapons-
  // as-gear (see the durability.ts header). Backfilled to full by the v32->v33 migration.
  playerSystemDurability: PatrolSystemDurability;
  // Recall intent, mirroring CaptainMissionState.recalled: when true, the patrol ends
  // (mission -> null) after the CURRENT cycle completes instead of auto-relaunching. Set
  // by: dispatch (false), recallCaptain (true), then honored by 9b.5b at cycle end.
  recalled: boolean;
  // The "Dispatch Once vs Repeatedly" toggle: true = auto-relaunch a fresh patrol after
  // this one completes (mirrors extraction's implicit auto-repeat); false = end after one
  // cycle. Read by 9b.5b at cycle completion. Set by: dispatch (from the dispatch arg).
  repeatDispatch: boolean;
  // Combat 0.13.0 (Phase 11, design S13): LIMP-HOME COUNTDOWN. PRESENT only while
  // phase === "limpingHome" (a defeated patrol flying its wreck home); ticks left until the
  // hull reaches base, seeded to 2x the return leg (2 * def.transitBackTicks) at the DEFEAT
  // instant and decremented one per whole route tick by tickCaptainPatrol. When it reaches 0
  // the mission ends (captain idles) and the ship is flagged damaged. ABSENT (undefined) on
  // every non-defeated patrol and on a pre-P11 save (never written by old code), so it is
  // optional / absent-is-default and needs no migration. Set by: 9b.5b defeat branch, then
  // decremented by the limp loop. A plain number, JSON-safe like every other field here.
  limpTicksRemaining?: number;
  // Combat 0.13.0 (Phase 11, design S13): the HULL POINTS lost this patrol, captured at the
  // DEFEAT instant as (hullIntegrity - playerHull) and carried through the limp so it can be
  // stamped onto ShipInstance.repairDamage when the hull reaches base (the repair-duration
  // input). PRESENT only alongside limpTicksRemaining (the limp phase); ABSENT otherwise, so
  // optional / absent-is-default, no migration. A plain number, JSON-safe.
  limpDamage?: number;
  // Infrastructure 0.13.4 (Phase 0 Unit 0.1, design section 6.3): ROUTES COMPLETED ON THIS
  // RUN, accumulated ACROSS calls and across saves. NOTHING READS THIS FIELD YET; Phase 2
  // (patrol end reasons) is what reads it out at the ending. It is landed here, dormant, so
  // the save shape moves once at the start of the release instead of mid-feature.
  //
  // WHY A PERSISTED FIELD AND NOT THE EXISTING LOCAL: tick.ts already counts routes in a
  // local `routesCompleted`, but that is PER CALL. A repeat-dispatch patrol relaunches
  // WITHOUT ending, so the user's readout ("Completed X combat patrol missions before
  // returning") has to survive both a call boundary and a save/load boundary. A local cannot.
  //
  // ⚠️ THIS FIELD IS ALSO A RING-BUFFER GUARD, which is the real reason it exists rather
  // than being a convenience. COMPLETION_LOG_CAP is 50 with oldest-first eviction, and
  // CompletionLogEntry's header states the LOCKED rule "PER ORDER, NOT PER ITERATION"
  // precisely because a big batch logging per iteration would evict every other entry and
  // blow the 50-cap instantly. A repeat-dispatch patrol completing dozens of routes across
  // an offline span would do exactly that if each route wrote an entry. So Phase 2 must write
  // ONE entry per patrol ENDING carrying `iterations = routesCompletedThisRun`, which is
  // OpenJobBatch's accumulator pattern applied to patrols. Do not log per route.
  //
  // Set by: dispatch (0), then incremented at each route completion (Phase 2). Plain number,
  // JSON-safe like every other field here, so it rides hydrateDecimals's `...state` spread
  // with no new branch.
  //
  // ⚠️ REQUIRED, NOT OPTIONAL, AND THIS IS A DELIBERATE DEPARTURE from the two limp fields
  // above (which are optional / absent-is-default / no migration). Those are absent on
  // purpose: they are meaningful ONLY during a limp, so "absent" carries real information.
  // A route count is meaningful on EVERY patrol, so an absent value would mean nothing but
  // "an old save", and an optional field would push a `?? 0` onto every future read site and
  // make a missed dispatch site invisible. Required makes a new dispatch path a COMPILE
  // ERROR instead. The cost is that the v44 -> v45 migration must reach into IN-FLIGHT
  // mission state to seed it (see save.ts), which it does; the v43 step already walks
  // state.equipment, so walking captains is the same shape and not a new kind of risk.
  routesCompletedThisRun: number;
  // E-CREW 0.14.0 (Task 20): the ship's Senior Staff COMBAT bonuses (Weapons Command, Shield Command,
  // Evasive Command, Inspiring Leader), FROZEN when this patrol CYCLE starts (dispatch, and again at each
  // repeat-dispatch relaunch, crewOverlay.ts officerCombatMods). Every wave of the cycle, the live loop and
  // the display replay (patrolReplay.ts) all read THIS value, so the cycle stays a pure function of the
  // stored mission (offline == live, replay == fight) even if an officer is reseated mid-patrol (Task 27
  // locks that later). OPTIONAL and ABSENT MEANS NO OFFICER BONUS (no SAVE_VERSION bump): a cycle with no
  // such officer never writes it, so a no-officer patrol is byte-identical to before; an in-flight patrol
  // from an older save fights without it until its next relaunch freezes the current officers.
  officerCombat?: OfficerCombatMods;
  // WR-5b (0.14.0): the commanding captain's Tactician talents (captainTacticianEffects.ts captainCombatMods), FROZEN
  // when this cycle starts (dispatch, and again at each relaunch), beside officerCombat and read the same way by every
  // wave, the live loop and the display replay. OPTIONAL: absent when the captain owns no Tactician node (no
  // SAVE_VERSION bump; the secondary tree exists on this branch only).
  captainCombat?: CaptainCombatMods;
  // 0.14.0 (complement plan CP-4, OC-1 "Faster drone replenish"; user "everything wired" 2026-10-20): the ship's Deck
  // Handling (crew.droneHandling: the Flight Deck buff and the Belter racial, crewOverlay.ts shipDeckHandling), FROZEN
  // when this cycle starts (dispatch, and again at each relaunch) beside captainCombat: the cycle's drone squadrons
  // are seeded with it in parts per million (combat/bridge.ts applyDeckHandling) and bank the extra replenish in whole
  // units (droneDefense.ts replenishUnits: droneReplenishRate x (1 + it) over time), read the same way by the live
  // loop and the display replay. OPTIONAL, written only when > 0 AND the cycle fields a drone screen (no SAVE_VERSION
  // bump; a destroyer or battleship cycle stores nothing): an in-flight patrol from an
  // older save keeps its seeded screen until its next relaunch freezes the crew aboard then.
  deckHandling?: number;
  // 0.14.0 (CP-4): the Deck Handling bank (DroneSquadron.replenishCarryPpm, squadron by squadron) this cycle STARTED
  // with, carried over from the cycle before at a relaunch, so the display replay seeds the same bank. OPTIONAL,
  // written only when one is > 0.
  replenishCarryStart?: number[];
  // E-CREW 0.14.0 (Task 21): the Engineering department's CUNNING over-delivery for THIS cycle ("a free
  // repair tick"), rolled when the cycle starts (dispatch / relaunch) from the cycle's masterSeed on its own
  // keyed stream (officerStats.ts cunningProc) and frozen here. If the cycle ends in defeat, the limp-home
  // reports it and the Shipyard repair runs this many ticks shorter (ShipInstance.freeRepairTicks). OPTIONAL,
  // written only when the roll succeeds (absent = none, no SAVE_VERSION bump).
  freeRepairTicks?: number;
  // E-CREW 0.14.0 (Task 21, Flight Deck CONSTITUTION): ticks this cycle's RETURN leg is shortened by (the
  // ramp on the hours the run has flown when the leg starts), frozen when the cycle starts. The route ends
  // this many ticks early (tick.ts patrolRouteTicks). OPTIONAL, written only when > 0.
  returnCutTicks?: number;
  // 0.14.0 SPEED SEAM (ProcessSpeed): instantComplete flies THIS route through to its end on the next tick (a
  // limping hull crawls the rest of the way home in the same tick). A relaunched route is built without it.
  speed?: ProcessSpeed;
  // Safe first runs SF-4 (docs/plans/2026-10-15-safe-first-runs-plan.md; runDifficulty.ts patrolDifficultyAt): THIS
  // cycle's difficulty, frozen when the cycle starts (dispatch, and again at each relaunch, nextPatrolCycleDifficulty).
  // The save's one safe patrol (firstRun: the training cycle) or a cycle on the gentle curve (ramp below 1), read by
  // the live loop and the display replay alike (combat/patrolProfile.ts). OPTIONAL and written only when it acts:
  // absent = full strength, so a veteran's patrol, a cycle at the top of the curve and every patrol in flight from
  // before SF-4 store and fight exactly what they did (no SAVE_VERSION bump).
  difficulty?: PatrolDifficultyStamp;
}

// Safe first runs SF-4: a patrol cycle's difficulty stamp: the run stamp (RunDifficultyStamp, tier I: patrols are
// Tier I content) plus `completed`, the won routes on the curve this cycle's ramp was read at, so a relaunch reads the
// next position from the stored mission alone (offline == live; another captain's wins count at the next dispatch).
export interface PatrolDifficultyStamp extends RunDifficultyStamp {
  completed: number;
}

// E-CREW 0.14.0 (Task 20): the Senior Staff officer bonuses that act on a ship's COMBATANT in a ship battle
// (design 6.1 + D12: officers are EXEMPT from the "crew never double-dips weapons/shields" rule, which stays
// Complement-only, so ONLY officers feed these). All FRACTIONS (0.1 = +10%), summed over the ship's seated
// officers with the bridge-module amp (crewOverlay.ts officerCombatMods):
//   weaponDamage : multiplies every installed weapon's damage band (Weapons Command, Inspiring Leader)
//   shield       : multiplies the shield pool AND its recharge (Shield Command, Inspiring Leader)
//   hull         : multiplies the hull pool (Inspiring Leader's "every ship stat")
//   evasion      : the ship's combat evasion, as a share (0.1 = 10 evasion points; Evasive Command)
// combat/bridge.ts shipToCombatant applies them; all 0 is never stored (absent instead).
export interface OfficerCombatMods {
  weaponDamage: number;
  shield: number;
  hull: number;
  evasion: number;
  // E-CREW 0.14.0 (Task 21): the INTEGRITY facet ("steady under fire", officerStats.ts). The EXTRA the
  // bonuses above gain while the ship is BELOW HALF HULL in the battle, folded per officer from each
  // department's Integrity facet: weaponDamage / shield are extra MULTIPLIERS on top of the already scaled
  // damage band and shield recharge (0.01 = +1%), evasion is an extra share (0.01 = 1 more evasion point).
  // bridge.ts copies it onto Combatant.underFire and resolveBattle reads it live against the hull. OPTIONAL:
  // absent (every all-10 bridge) leaves the battle byte-identical.
  underFire?: { weaponDamage: number; shield: number; evasion: number };
}

// WR-5b (0.14.0): the commanding captain's Tactician (secondary tree) talents a ship battle, a patrol cycle and a
// repair read, frozen at dispatch (captainTacticianEffects.ts captainCombatMods). SPARSE: a key is present only when
// the captain owns its node, and the record is absent when none is owned, so a save without them is byte-identical.
// Every value is the node's catalog magnitude (SECONDARY_CAPTAIN_TALENTS), each its own x (1 + it) factor (the
// user's "Always multiply", 2026-10-17) unless named a count:
//   weaponDamage (gunnery1), accuracy (gunnery2), highHealthDamage (gunnery3), cooldown (gunnery4: the fire rate),
//   openingVolley (gunnery5), shield (aegis1), hull (aegis2), repair (aegis3: Shipyard, field and between-wave
//   repairs), evasion (aegis4: incoming hit chance / (1 + it)), bulwark (aegis5: lethal hits survived per battle, a
//   count), droneDamage (fleetOps1), droneHp (fleetOps2), patrolLoot (fleetOps3), droneReplenish (fleetOps4),
//   wolfpack (fleetOps5: extra drone squadrons, a count).
export interface CaptainCombatMods {
  weaponDamage?: number;
  accuracy?: number;
  highHealthDamage?: number;
  cooldown?: number;
  openingVolley?: number;
  shield?: number;
  hull?: number;
  repair?: number;
  evasion?: number;
  bulwark?: number;
  droneDamage?: number;
  droneHp?: number;
  patrolLoot?: number;
  droneReplenish?: number;
  wolfpack?: number;
}

// How many ticks a phase requires before advancing to the next one.
// "extracting" is the one phase whose length isn't a literal field on
// MissionDef, it's however many ticks it takes to extract cargoCapacity
// units at extractionRatePerTick units/tick. Rounds up, which only matters
// if cargoCapacity doesn't divide evenly by extractionRatePerTick (today's
// launch content avoids this; see the MISSIONS comment above).
export function requiredTicksForPhase(phase: MissionPhase, missionDef: MissionDef): number {
  switch (phase) {
    case "ordersReceived":
      return 1;
    case "transitOut":
      return missionDef.transitOutTicks;
    case "extracting":
      // E4b: a museum-shortened extracting phase (effectiveMissionDef) carries its length explicitly.
      return missionDef.extractionTicksOverride ?? Math.ceil(missionDef.cargoCapacity / missionDef.extractionRatePerTick);
    case "transitBack":
      return missionDef.transitBackTicks;
    case "unloading":
      return missionDef.unloadTicks;
  }
}

// One mission cycle's length, phase by phase, plus the total (0.13.9 hotfix). Every row is read
// from requiredTicksForPhase, the engine's own phase lengths, and the total is their sum, so a
// readout built on this can never list rows that do not add up. That was the bug: the dispatch
// popup's TIMING list showed four rows but quietly added the 1-tick Orders Received phase to its
// total. Pass the EFFECTIVE def (effectiveMissionDef) for a ship-scaled readout, as the popup does.
export type MissionCycleTiming = Record<MissionPhase, number> & { total: number };
export function missionCycleTiming(missionDef: MissionDef): MissionCycleTiming {
  const ordersReceived = requiredTicksForPhase("ordersReceived", missionDef);
  const transitOut = requiredTicksForPhase("transitOut", missionDef);
  const extracting = requiredTicksForPhase("extracting", missionDef);
  const transitBack = requiredTicksForPhase("transitBack", missionDef);
  // E-CREW (Task 21): a planned cycle fills its hold, so it unloads at the full-hold length when one is set.
  const unloading = missionDef.fullHoldUnloadTicks ?? requiredTicksForPhase("unloading", missionDef);
  return {
    ordersReceived,
    transitOut,
    extracting,
    transitBack,
    unloading,
    total: ordersReceived + transitOut + extracting + transitBack + unloading,
  };
}

// The mission-relevant stats a hull contributes, lifted out of the shared
// SHIP_TYPES template for a specific ShipInstance AND folded together with the
// stats of any equipment fitted to that ship (Equipment 0.11.0, Task 13). A thin
// projection, it exists so callers (effectiveMissionDef below, the fuel math,
// plus assignment/UI tasks) depend on a small, explicit shape rather than
// reaching into the full ShipTypeDef and its inert forward fields
// (moduleSlots/equipmentSlots/cost/etc.). PURE: reads the immutable table + the
// (already-resolved) fitted-piece list, returns a fresh object, mutates nothing.
//
// FIELD SET, and which are BINDING this patch:
//   cargoCapacity / transitSpeedMult / extractionYieldMult , the original three,
//       consumed by effectiveMissionDef (cargo + transit) and the extraction-yield
//       seam in tick.ts. BINDING.
//   engineEfficiency / fuelCapacity , lifted from the hull's fuel stats so the fuel
//       math can read the EQUIPMENT-FOLDED value from one place. engineEfficiency
//       BINDS (economyTick prices fuelPerCycle from it, canDispatch prices `need`
//       from it); fuelCapacity BINDS the canDispatch RANGE gate.
//   powerOutput / powerDraw / mass , the POWER BUDGET (E-MOD EM-1) and the mass the fold's
//       Mass penalty consumes INTERNALLY (surfaced too, for display). powerOutput = the hull's
//       basePowerOutput + every installed powerOutput line (the reactor implicit); powerDraw =
//       the installed pieces' draw (an FTL drive at its class, P5), cut by the crew's power
//       efficiency in the crew overlay (crewOverlay.ts applyCrewOverlay, P4). The install gate
//       (EM-2) and the combat over-budget penalty (EM-3) read them; EM-1 displays them.
export interface ShipDerivedStats {
  cargoCapacity: number;
  transitSpeedMult: number;
  extractionYieldMult: number;
  engineEfficiency: number; // 0-based fuel-burn bonus (0 = baseline 1:1), see fuel.ts
  fuelCapacity: number;     // max fuel for one round trip (the canDispatch RANGE gate)
  mass: number;             // total equipped mass (0 for a bare hull); drives the Mass penalty below
  powerOutput: number;      // hull basePowerOutput + installed powerOutput lines (the reactor implicit)
  powerDraw: number;        // installed pieces' draw (net of power efficiency once crew fold in); 0 with no powered gear
  // Exploration 0.14.0 (Phase E1a): the ship's SENSORS stat, folded ADDITIVELY from a fitted SENSOR
  // ARRAY (the `sensor` slot's `sensors` implicit + affix lines). This is the FIRST live consumer of
  // the `sensors` stat: survey missions scale their material yield by it (tick.ts's tickCaptainMission).
  // ⚠️ ADDITIVE-NEUTRAL: a bare hull, and any ship with NO sensor item fitted, folds to sensors 0 (the
  // sensor slot has no Standard-Issue baseline, so an un-sensored ship contributes nothing here), so
  // every non-survey stat + fixture is byte-identical to before this field existed. Explorer-hull BASE
  // sensors + Science-crew sensor amplification stay DEFERRED (design I.6): for E1a the ONLY source of
  // sensors is a fitted sensor item, and the crew overlay does NOT map crew.sensors onto this field.
  sensors: number;
  // Crew 0.14.0 (crew goes live): a >1 multiplier that SPEEDS homeworld unload, folded on TOP of
  // shipDerivedStats by the crew overlay (crewOverlay.ts applyCrewOverlay / effectiveShipStats)
  // from a ship's crew "unloadSpeed" contribution. shipDerivedStats itself NEVER sets it (it stays
  // pure + crew-free), so a bare shipDerivedStats() call leaves it undefined, which effectiveMissionDef
  // reads as the neutral 1 (byte-identical unload timing). ⚠️ OPTIONAL on purpose: adding it must not
  // force every existing ShipDerivedStats literal/toEqual fixture to carry it.
  unloadSpeedMult?: number;
  // Exploration 0.14.0 (Phase E4b): a >1 multiplier that SHORTENS the extracting phase, folded on TOP
  // of the crew result by the MUSEUM overlay (crewOverlay.ts applyMuseumOverlay) from the museum's
  // `extractionSpeed` bonus. Same OPTIONAL posture as unloadSpeedMult: shipDerivedStats never sets it,
  // the overlay sets it only when the bonus is non-zero, and effectiveMissionDef reads absent as the
  // neutral 1 (byte-identical extraction timing).
  extractionSpeedMult?: number;
  // E-CREW 0.14.0 (Task 21, officer stat facets read by effectiveMissionDef; set by crewOverlay.ts
  // effectiveShipStats only when non-zero, so every existing stats object is unchanged):
  //   returnLegConstitution  : the Flight Deck's CONSTITUTION facet: the return leg is faster the longer the
  //                            voyage has run (constitutionRamp of the hours before the return starts).
  //   fullHoldUnloadIntegrity: the Operations INTEGRITY facet: a hold at least FULL_HOLD_FRACTION full
  //                            unloads x (1 + this) faster (MissionDef.fullHoldUnloadTicks).
  returnLegConstitution?: number;
  fullHoldUnloadIntegrity?: number;
  // WR-5a (Overloaded Holds, captain secondary logistics5): the hold the UNLOAD phase scales with when the
  // cargo above it is overflow that unloads at no extra time. Set by crewOverlay.ts (the captain overlay) only
  // with the capstone; absent = cargoCapacity (effectiveMissionDef), so every other stats object is unchanged.
  unloadCargoCapacity?: number;
  // Complement and Acquisition CP-2 (OC-E5, user 2026-10-15 "Each its own leg"): the complement's per-leg speed
  // lifts, folded by crewOverlay.ts applyCrewOverlay from Fast Departure (crew.transitOutSpeed, the outbound leg)
  // and Fast Return (crew.transitBackSpeed, the return leg). Each multiplies transitSpeedMult on ITS leg only
  // (effectiveMissionDef). Set only when non-zero, read absent as the neutral 1, so a ship without either buff is
  // the same object it was. transitSpeedMult itself stays the sweeping speed (hull, gear, officers, museum).
  transitOutLegMult?: number;
  transitBackLegMult?: number;
  // G1-1 (Short-Range Missions, 0.14.0; shown as "Guest quarters", user 2026-10-19 call 5): the berths passengers
  // ride in, folded by shipDerivedStats from the hull's base (ShipTypeDef.colonistCapacity), every installed guest
  // line (the Crew Quarters affix, the Guest Wing's signature) and the General hull's quarters perk. A whole number.
  // OPTIONAL and written only when non-zero, so every stats object of a ship with no guest berths is unchanged.
  // Guests are not crew (no complement, no crew stations) and never substitute for the hold: only the passenger
  // jobs read it (the short-range cycle, G1-4).
  colonistCapacity?: number;
  // Material Lines ML-3 (OC-D2, user 2026-10-15 "Chance to upgrade a unit"): the chance each unit this ship delivers
  // climbs one quality step (materialQuality.ts materialQualityClimbChance of the installed materialQualityChance
  // points; the Prospecting Rig family). economyTick's deposit fold reads it. OPTIONAL and written only when above 0,
  // so every ship without a rig line keeps the same stats object.
  materialQuality?: number;
}

// CP-2 (OC-E5): a ship's speed on each mission leg: the sweeping transitSpeedMult times that leg's own complement
// lift (absent = 1, and x * 1 is exact, so a ship without the lift divides by transitSpeedMult as before). Pure.
export function outboundLegSpeed(ship: ShipDerivedStats): number {
  return ship.transitOutLegMult === undefined ? ship.transitSpeedMult : ship.transitSpeedMult * ship.transitOutLegMult;
}
export function returnLegSpeed(ship: ShipDerivedStats): number {
  return ship.transitBackLegMult === undefined ? ship.transitSpeedMult : ship.transitSpeedMult * ship.transitBackLegMult;
}

// ----------------------------------------------------------------------------
// Equipment stat-fold TUNABLES (Task 13). Every constant here is a FIRST-PASS
// launch placeholder, retuned at the device-check stage (same spirit as
// SHIP_TYPES' numbers). They are chosen so a single fitted piece produces a
// VISIBLE, piece-DEPENDENT change in the derived stats (different pieces/varieties
// give visibly different stats), which the upcoming device checkpoint needs.
// ----------------------------------------------------------------------------

// Per-percent-stat curve parameters for plusToPercent (below). Each percent stat
// converts its summed raw "plus" magnitude into a fractional boost via the curve
// boost = B * (1 - r^plus) / (1 - r). B is the FIRST plus-point's contribution, r
// is the per-point diminishing factor (0<r<1), and the boost ASYMPTOTES to
// B/(1-r). plusDivisor scales the raw magnitude BEFORE the curve, the explicit
// knob to pull if raw budget magnitudes ever grow large enough to saturate the
// curve (all pieces would otherwise asymptote to the same boost, killing the
// per-piece difference). r=0.92 keeps the curve visibly rising across plus ~1..30
// at the current small launch magnitudes, so plusDivisor stays 1 for now.
export interface PercentCurveParams {
  B: number; // TUNABLE: first-point boost
  r: number; // TUNABLE: 0<r<1 diminishing factor
  plusDivisor: number; // TUNABLE: scales raw plus before the curve (1 = no scaling)
}
export const PERCENT_STAT_CURVES: Record<string, PercentCurveParams> = {
  // +transit speed: asymptote 0.05/(1-0.92) = +62.5% at extreme plus; +5% at plus 1.
  transitSpeedMult: { B: 0.05, r: 0.92, plusDivisor: 1 },
  // +fuel efficiency (engineEfficiency is a 0-based bonus): asymptote +50%.
  engineEfficiency: { B: 0.04, r: 0.92, plusDivisor: 1 },
  // +extraction yield: asymptote +62.5%.
  extractionYieldMult: { B: 0.05, r: 0.92, plusDivisor: 1 },
};

// Mass penalty (mass-vs-thrust). Heavier fitments drag the speed group:
//   MASS_SPEED_DRAG  , multiplicative speed factor 1/(1 + drag*mass), always in
//                      (0,1], so transitSpeedMult can never go non-positive (keeps
//                      effectiveMissionDef's ceil-divide safe).
//   MASS_EFF_DRAG    , SUBTRACTIVE penalty on engineEfficiency (drag*mass), so mass
//                      bites even when base+boost efficiency is 0 (a bare Freighter),
//                      and CAN push net efficiency below baseline (a real fuel penalty
//                      for a heavy loadout). Clamped at ENGINE_EFF_FLOOR so the fuel
//                      denominator (1+eff) never collapses toward 0.
export const MASS_SPEED_DRAG = 0.02;   // TUNABLE
export const MASS_EFF_DRAG = 0.005;    // TUNABLE
export const ENGINE_EFF_FLOOR = -0.9;  // TUNABLE floor: 1+eff >= 0.1, fuel at most 10x

// ----------------------------------------------------------------------------
// plusToPercent
// ----------------------------------------------------------------------------
// The plus-to-percent curve (design §3/§8): converts a summed raw "plus" magnitude
// into a fractional boost with DIMINISHING returns per point:
//   plusToPercent(plus, B, r) = B * (1 - r^plus) / (1 - r)
// For integer plus this is the geometric series B*(1 + r + r^2 + ... + r^(plus-1)),
// i.e. each additional point adds B*r^(k), a shrinking increment. Monotonic
// increasing in plus and asymptotic to B/(1-r). PURE.
//   plus = 0 -> 0 (no equipment contributes nothing, the byte-identical guarantee).
//   r in (0,1) required; r=1 would divide by zero (never configured, guarded here).
export function plusToPercent(plus: number, B: number, r: number): number {
  if (plus <= 0) return 0;
  // Defensive: r must be in (0,1). r>=1 has no diminishing-returns meaning and
  // r=1 divides by zero; fall back to the linear B*plus so a mis-tune is loud-ish
  // (visibly wrong magnitude) rather than NaN-poisoning the whole derived stat.
  if (r <= 0 || r >= 1) return B * plus;
  return (B * (1 - Math.pow(r, plus))) / (1 - r);
}

// ----------------------------------------------------------------------------
// equipmentStatMods
// ----------------------------------------------------------------------------
// Sum a ship's FITTED pieces into the raw contributions the derived-stat fold
// (shipDerivedStats below) consumes. PURE: reads the passed piece list (already
// resolved by the caller via equipment.ts's equippedFor), returns a fresh object,
// mutates nothing. The caller passes ONLY the pieces fitted to one ship.
//
// SHAPE:
//   flat        , FLAT capacity stats summed DIRECTLY (cargoCapacity, fuelCapacity).
//   percentPlus , PERCENT stats summed as raw "plus" magnitudes to be curve-converted
//                 later (transitSpeedMult, engineEfficiency, extractionYieldMult).
//   totalMass   , sum of each piece's intrinsic mass, NET of any massReduction affix
//                 (a "-Mass" roll), clamped at 0.
//   totalPowerDraw, sum of each piece's intrinsic powerDraw, NET of any
//                 powerDrawReduction affix, clamped at 0.
//   powerOutput , sum of the powerOutput stat across pieces (the reactor implicit).
//
// Each piece contributes implicitStats + rolledStats (both raw "plus" magnitudes).
// `sensors` is FOLDED as a FLAT additive total (Exploration 0.14.0 E1a): it is a raw
// point sum (NOT a percent-curve stat), consumed by survey-mission yield in tick.ts, so
// a fitted Sensor Array now moves ShipDerivedStats.sensors. `materialQualityChance`
// (Material Lines ML-3, OC-D2) sums raw into percentPlus.materialQualityChance, written only
// when a piece carries it; shipDerivedStats turns it into ShipDerivedStats.materialQuality,
// the per-unit chance a delivered unit climbs one quality step. massReduction /
// powerDrawReduction are folded into the mass / power NET totals rather than surfaced as
// their own lines.
export interface EquipmentStatMods {
  flat: Record<string, number>;
  percentPlus: Record<string, number>;
  totalMass: number;
  totalPowerDraw: number;
  powerOutput: number;
  // E-MOD EM-5: the installed Passive modules' power output (shipModules.ts modulePowerOutput), whole points. Kept apart
  // from `powerOutput` (the Reactor Core lines) so the budget can name the reactor's own share (shipPower.ts
  // reactorOutput / reactorSurplus); every output total adds both. 0 with no such module.
  modulePowerOutput: number;
}
// E-MOD EM-1 (S4-A03; user P5 2026-10-19 "x1.6 per class (Recommended)"): an FTL drive's power draw grows x1.6 for
// each drive class above I, so deep reach competes with weapons and modules for the hull's power.
export const DRIVE_CLASS_POWER_DRAW_MULT = 1.6;

// An installed FTL drive's class: its blueprint's driveClass (G2-4's DRIVE_CLASS_BLUEPRINTS), Class I when the piece has
// no blueprint (Standard Issue, a legacy piece) or the blueprint names none. THE drive class source: the power fold
// below and the voyage (propulsion.ts shipDriveClass, which adds the hull's base class) both read it. Pure.
export function ftlDriveClass(piece: Pick<EquipmentInstance, "blueprintKey">): number {
  const cls = piece.blueprintKey ? BLUEPRINTS[piece.blueprintKey]?.driveClass : undefined;
  return cls !== undefined && cls > 1 ? Math.floor(cls) : 1;
}

// A drive's draw at its class: x DRIVE_CLASS_POWER_DRAW_MULT per class above I, rounded UP to a whole point (the
// budget is integer, power.ts). Class I returns `draw` itself, so every drive today folds byte-identically. Pure.
export function driveClassPowerDraw(draw: number, driveClass: number): number {
  if (driveClass <= 1 || draw <= 0) return draw;
  return Math.ceil(draw * Math.pow(DRIVE_CLASS_POWER_DRAW_MULT, driveClass - 1) - 1e-9);
}

export function equipmentStatMods(pieces: EquipmentInstance[]): EquipmentStatMods {
  const flat: Record<string, number> = { cargoCapacity: 0, fuelCapacity: 0, sensors: 0 };
  const percentPlus: Record<string, number> = {
    transitSpeedMult: 0,
    engineEfficiency: 0,
    extractionYieldMult: 0,
  };
  let grossMass = 0;
  let massReduction = 0;
  let grossPowerDraw = 0;
  let powerDrawReduction = 0;
  let powerOutput = 0;

  for (const piece of pieces) {
    // Intrinsic per-piece fields (NOT stat lines): mass + powerDraw are summed gross,
    // then netted by the reduction affixes below.
    grossMass += piece.mass;
    // E-MOD EM-1 (P5): an FTL drive draws more per class above I (Class I, every drive today, is the piece's own draw).
    grossPowerDraw += piece.slotType === "ftlDrive" ? driveClassPowerDraw(piece.powerDraw, ftlDriveClass(piece)) : piece.powerDraw;

    // Every stat line the piece carries: implicit (slot-signature) + rolled (affixes).
    // One loop over both records so a stat that appears in both accumulates.
    for (const stats of [piece.implicitStats, piece.rolledStats]) {
      for (const [key, value] of Object.entries(stats)) {
        switch (key) {
          // FLAT capacities + the sensors point-sum: summed directly.
          // Exploration 0.14.0 (E1a): `sensors` folds here as a flat raw-point total (its
          // survey-yield consumer went live), UNLIKE the percent stats above; it is NOT run
          // through PERCENT_STAT_CURVES.
          case "cargoCapacity":
          case "fuelCapacity":
          case "sensors":
            flat[key] += value;
            break;
          // G1-1: guest quarters, a flat berth count (the line is already in berths, itemgen.ts). Written into
          // `flat` only when a piece carries the line, so a guest-free fold returns the same `flat` shape as before.
          case "colonistCapacity":
            flat.colonistCapacity = (flat.colonistCapacity ?? 0) + value;
            break;
          // PERCENT stats: summed as raw plus magnitudes (curve-converted later).
          case "transitSpeedMult":
          case "engineEfficiency":
          case "extractionYieldMult":
            percentPlus[key] += value;
            break;
          // Mass / power NET-reduction affixes: fold into the totals, not their own line.
          case "massReduction":
            massReduction += value;
            break;
          case "powerDrawReduction":
            powerDrawReduction += value;
            break;
          case "powerOutput":
            powerOutput += value;
            break;
          // E-CREW 0.14.0 (Task 7): the GROUND stat lines (MEMBER_GROUND_STAT_KEYS) worn by away-team
          // members. NEVER folded into a ship: they belong to the member-power layer (awayTeam.ts), so
          // they are listed here EXPLICITLY (not left to the default) to make the "member gear never
          // moves ship stats" rule visible at the fold. A member piece also carries mass 0 / powerDraw
          // 0 (SLOT_BASE_PHYSICALS), so even a stray one in a ship's piece list folds to nothing.
          case "groundHp":
          case "groundPower":
          case "groundArmor":
          case "groundAccuracy":
          case "groundStatusChance":
          case "groundStatusResist":
          case "groundFieldwork":
          case "groundRelicFind":
          case "groundHazardResist":
          case "groundOrganicsYield":
          case "groundVaultYield":
          case "groundCarryCapacity":
            break;
          // Material Lines ML-3 (OC-D2): the rig's material quality points, summed raw (shipDerivedStats turns them
          // into the per-unit climb chance). Written only when a piece carries the line, so every other fold
          // returns the same percentPlus shape as before.
          case "materialQualityChance":
            percentPlus.materialQualityChance = (percentPlus.materialQualityChance ?? 0) + value;
            break;
          // Any unknown key: intentionally ignored. No silent surprise: the fold simply does not read it.
          // (`sensors` and `materialQualityChance` USED to fall here; each graduated to its own case when its
          // consumer went live: sensors in Exploration 0.14.0 E1a, material quality in Material Lines ML-3.)
          default:
            break;
        }
      }
    }
  }

  return {
    flat,
    percentPlus,
    totalMass: Math.max(0, grossMass - massReduction),
    totalPowerDraw: Math.max(0, grossPowerDraw - powerDrawReduction),
    powerOutput,
    // E-MOD EM-5: a module carries no stat lines (EQUIPMENT_SLOTS.module); its output is its catalog def's, scaled.
    modulePowerOutput: modulePowerOutput(pieces, (p) => moduleEffectScale(p.rarity, p.quality)),
  };
}

// The hull-only mission stats, with NO equipment folded. shipDerivedStats(ship)
// (the 1-arg call every pre-Task-13 site uses) resolves to exactly this, so those
// sites are byte-identical to before this task. Kept as its own helper so the
// "bare hull" projection has one name.
function hullDerivedStats(ship: ShipInstance): ShipDerivedStats {
  const def = SHIP_TYPES[ship.typeKey];
  return {
    cargoCapacity: def.cargoCapacity,
    transitSpeedMult: def.transitSpeedMult,
    extractionYieldMult: def.extractionYieldMult,
    engineEfficiency: def.engineEfficiency,
    fuelCapacity: def.fuelCapacity,
    // A bare hull carries no equipment mass or draw: those are equipment concepts, so they are 0 until gear is
    // fitted (below). E-MOD EM-1: its power OUTPUT is the hull's own generation (basePowerOutput, P1).
    mass: 0,
    powerOutput: def.basePowerOutput,
    powerDraw: 0,
    // Exploration 0.14.0 (E1a): a bare hull has NO sensors, its only source is a fitted
    // sensor item (explorer-hull base sensors are deferred, design I.6). Folded in below.
    sensors: 0,
    // G1-1: the hull's base guest quarters, written only when it has some (HULL_GUEST_QUARTERS).
    ...((def.colonistCapacity ?? 0) > 0 ? { colonistCapacity: def.colonistCapacity } : {}),
  };
}

// G1-1 (Short-Range Missions, 0.14.0): the General hull family's Crew Quarters perk, "guest quarters +10% for
// passenger runs" (the SMS-1 General Quarters line, approved with OC-13 "One catalog, by hull"; CP-13 builds the
// family's other quarters and bridge lines and may absorb this constant into its catalog). A quarters module of any
// variety installed on a hull of spec "general" multiplies the ship's whole guest quarters by (1 + this), rounded
// to whole berths. Guest quarters are read only by the passenger jobs, so "for passenger runs" is where it acts.
export const GENERAL_QUARTERS_GUEST_PERK = 0.1;

// A ship's guest quarters: the hull base plus every installed guest line, times the General quarters perk when it
// applies, as whole berths. 0 when the ship has none. Pure.
function foldGuestQuarters(ship: ShipInstance, pieces: EquipmentInstance[], base: number, gearLines: number): number {
  const raw = base + gearLines;
  if (raw <= 0) return 0;
  const perk = SHIP_TYPES[ship.typeKey].spec === "general" && pieces.some((p) => p.slotType === "quarters");
  return perk ? Math.round(raw * (1 + GENERAL_QUARTERS_GUEST_PERK)) : raw;
}

// Project a ShipInstance to its mission-relevant derived stats, FOLDING IN the
// stats of any equipment fitted to it (Task 13). PURE.
//
// FOLD ORDER (applied ONCE, here, BEFORE any closed-form machinery reads the
// result, so the fold is a per-cycle CONSTANT and the one-big-call == many-small-
// calls guarantee is preserved by construction, exactly as effectiveMissionDef's
// per-cycle constancy is; fitment cannot change mid-mission, the on-mission lock
// in equipment.ts guarantees it):
//   1. Start from the bare hull stats.
//   2. FLAT capacities add directly: cargoCapacity += flat cargo, fuelCapacity += flat fuel.
//   3. PERCENT stats convert their summed plus through plusToPercent and apply as a
//      (1 + boost) multiplier (transit, yield) or an ADDITIVE bonus (engineEfficiency,
//      which is itself a 0-based additive bonus, so equipment efficiency ADDS to the
//      hull's, rather than multiplying a possibly-0 base into nothing).
//   4. MASS penalty (mass-vs-thrust): heavier fitments drag transitSpeedMult
//      (multiplicative, stays positive) and engineEfficiency (subtractive, can go
//      below baseline), clamped at ENGINE_EFF_FLOOR.
//   5. POWER: output = the hull's base + every powerOutput line + every Passive module's output (E-MOD EM-5); draw =
//      the pieces' draw (an FTL drive at its class, a module at its def's draw). The crew's power efficiency cuts the draw later, in the crew overlay (E-MOD EM-1).
//
// The optional `pieces` param DEFAULTS to [] so shipDerivedStats(ship) reproduces
// the bare-hull projection EXACTLY (equipmentStatMods([]) is all-zero -> every
// fold is an identity), keeping every existing 1-arg call site byte-identical.
export function shipDerivedStats(
  ship: ShipInstance,
  pieces: EquipmentInstance[] = []
): ShipDerivedStats {
  const base = hullDerivedStats(ship);
  if (pieces.length === 0) return base; // fast path + explicit byte-identical guarantee

  const mods = equipmentStatMods(pieces);

  // (2) FLAT capacities (+ the sensors point-sum, Exploration 0.14.0 E1a). Each ADDS the
  // fitted-gear total onto the bare-hull value; with no sensor item mods.flat.sensors is 0,
  // so sensors stays at the hull's 0 and the fold is byte-identical for an un-sensored ship.
  const cargoCapacity = base.cargoCapacity + mods.flat.cargoCapacity;
  const fuelCapacity = base.fuelCapacity + mods.flat.fuelCapacity;
  const sensors = base.sensors + mods.flat.sensors;
  // G1-1: guest quarters (hull base + guest lines, then the General quarters perk). Never touches the hold.
  const colonistCapacity = foldGuestQuarters(ship, pieces, base.colonistCapacity ?? 0, mods.flat.colonistCapacity ?? 0);

  // (3) PERCENT boosts through the curve.
  const transitCurve = PERCENT_STAT_CURVES.transitSpeedMult;
  const engineCurve = PERCENT_STAT_CURVES.engineEfficiency;
  const yieldCurve = PERCENT_STAT_CURVES.extractionYieldMult;
  const transitBoost = plusToPercent(
    mods.percentPlus.transitSpeedMult / transitCurve.plusDivisor,
    transitCurve.B,
    transitCurve.r
  );
  const engineBoost = plusToPercent(
    mods.percentPlus.engineEfficiency / engineCurve.plusDivisor,
    engineCurve.B,
    engineCurve.r
  );
  const yieldBoost = plusToPercent(
    mods.percentPlus.extractionYieldMult / yieldCurve.plusDivisor,
    yieldCurve.B,
    yieldCurve.r
  );

  let transitSpeedMult = base.transitSpeedMult * (1 + transitBoost);
  const extractionYieldMult = base.extractionYieldMult * (1 + yieldBoost);
  let engineEfficiency = base.engineEfficiency + engineBoost; // additive: 0-based bonus

  // (4) MASS penalty.
  const massSpeedFactor = 1 / (1 + MASS_SPEED_DRAG * mods.totalMass);
  transitSpeedMult *= massSpeedFactor;
  engineEfficiency -= MASS_EFF_DRAG * mods.totalMass;
  if (engineEfficiency < ENGINE_EFF_FLOOR) engineEfficiency = ENGINE_EFF_FLOOR;

  // (6) Material Lines ML-3: the per-unit climb chance of the installed material quality lines (absent without any).
  const materialQuality = materialQualityClimbChance(mods.percentPlus.materialQualityChance ?? 0);

  // (5) Power: the hull's own output plus the installed lines (E-MOD EM-1).
  return {
    cargoCapacity,
    transitSpeedMult,
    extractionYieldMult,
    engineEfficiency,
    fuelCapacity,
    mass: mods.totalMass,
    powerOutput: base.powerOutput + mods.powerOutput + mods.modulePowerOutput, // E-MOD EM-5: + Passive module output
    powerDraw: mods.totalPowerDraw,
    sensors,
    ...(colonistCapacity > 0 ? { colonistCapacity } : {}),
    ...(materialQuality > 0 ? { materialQuality } : {}),
  };
}

// Crew 0.14.0 (Phase 5, "cargo scales unload"): a mission's UNLOAD phase now scales with the
// HULL's cargo hold, so a big hauler spends longer unloading than a small runner, which is what
// makes Operations crew (unloadSpeed) meaningful on the biggest holds (a bigger hold -> longer
// unload -> more for the crew divide to shorten). ⚠️ FIRST-PASS TUNABLE: balance owns the final
// numbers. UNLOAD_REFERENCE_CARGO is calibrated to the baseline General Freighter's cargoCapacity
// (SHIP_TYPES.generalFreighter, 90) so that starter hull's unload stays at its base unloadTicks by
// construction (minimal disruption): only bigger / smaller holds diverge from base.unloadTicks.
// UNLOAD_MIN_TICKS floors the result so even the smallest hold still takes a few ticks to unload.
const UNLOAD_REFERENCE_CARGO = 90; // = SHIP_TYPES.generalFreighter.cargoCapacity; the reference hull's unload is unchanged
const UNLOAD_MIN_TICKS = 3;        // floor: the smallest holds still take at least this many ticks to unload

// Returns a MODIFIED COPY of the base mission with the ship's stats applied.
// transit rescaled by ceil (stays integer + closed-form); cargo drives the
// extraction-phase length (requiredTicksForPhase reads cargoCapacity). Because
// extractionRatePerTick is 1 for today's missions, any integer ship cargo still
// divides evenly, no partial-final-tick path is introduced. The unload phase is
// now cargo-scaled too (Crew 0.14.0 Phase 5): unloadTicks grows with the hull's
// cargo hold and is then shortened by the crew unloadSpeed multiplier (see below).
export function effectiveMissionDef(base: MissionDef, ship: ShipDerivedStats): MissionDef {
  // Crew 0.14.0 Phase 5: unloadTicks is derived in TWO ordered steps, both integer + closed-form so
  // requiredTicksForPhase reads a whole number and the offline==live parity of this pure function holds.
  //   (1) CARGO-SCALE FIRST: scale base.unloadTicks by the hull's cargoCapacity relative to
  //       UNLOAD_REFERENCE_CARGO (ceil), floored at UNLOAD_MIN_TICKS. A bigger hold -> a longer unload.
  //   (2) CREW DIVIDE ON TOP: the ship's crew OPERATIONS/"unloadSpeed" contribution (folded onto
  //       ShipDerivedStats.unloadSpeedMult by the crew overlay; undefined for a bare shipDerivedStats()
  //       call) SPEEDS unload by dividing the cargo-scaled figure by the multiplier (ceil), clamped to a
  //       1-tick floor. With NO crew, unloadSpeedMult is undefined -> exactly 1, so step (2) is a no-op.
  // For the reference General Freighter (cargo 90, no crew) this is max(3, ceil(8*90/90)) = 8, then
  // ceil(8/1) = 8, BYTE-IDENTICAL to base.unloadTicks (which is what keeps every reference-hull fixture
  // unchanged). ⚠️ A hull whose cargo != UNLOAD_REFERENCE_CARGO now gets a DIFFERENT crew-free unload
  // length than base.unloadTicks: that is the intended balance change, NOT a regression.
  // WR-5a: Overloaded Holds' overflow unloads at no extra time, so the unload scales with the hold below it.
  const unloadTicks = scaledUnloadTicks(base.unloadTicks, ship.unloadCargoCapacity ?? ship.cargoCapacity, ship);
  // CP-2 (OC-E5): each leg divides by its own speed (Fast Departure out, Fast Return back).
  const transitOutTicks = outboundLegTicks(base.transitOutTicks, ship);
  const museumFold = museumExtractionSpeedFold(base.extractionRatePerTick, ship.cargoCapacity, ship.extractionSpeedMult);
  // E-CREW (Task 21): the Flight Deck's Constitution ramp on the return leg (absent facet = the plain divide)
  // and the Operations Integrity full-hold unload (written only when the facet is non-zero).
  const outbound =
    1 +
    transitOutTicks +
    (museumFold.extractionTicksOverride ?? Math.ceil(ship.cargoCapacity / (museumFold.extractionRatePerTick ?? base.extractionRatePerTick)));
  const transitBackTicks = returnLegTicks(base.transitBackTicks, ship, outbound);
  const fullHoldTicks = fullHoldUnloadTicksFor(unloadTicks, ship);
  return {
    ...base,
    transitOutTicks,
    transitBackTicks,
    cargoCapacity: ship.cargoCapacity,
    unloadTicks,
    ...museumFold,
    ...(fullHoldTicks !== undefined ? { fullHoldUnloadTicks: fullHoldTicks } : {}),
  };
}

// The mission folds, one helper each, shared by effectiveMissionDef and the short-range cycle plan (G1-2,
// shortRange.ts shortRangeCyclePlan) so a crew or gear bonus that claims "missions" acts on both the same way.
// Each is effectiveMissionDef's own arithmetic, unchanged. Pure.

// The unload length for `basis` units: (1) cargo-scaled against UNLOAD_REFERENCE_CARGO (ceil), floored at
// UNLOAD_MIN_TICKS; (2) divided by the crew unloadSpeedMult (ceil), at least 1 tick.
export function scaledUnloadTicks(baseUnloadTicks: number, basis: number, ship: ShipDerivedStats): number {
  const cargoScaledUnload = Math.max(UNLOAD_MIN_TICKS, Math.ceil((baseUnloadTicks * basis) / UNLOAD_REFERENCE_CARGO));
  const unloadMult = ship.unloadSpeedMult ?? 1;
  return Math.max(1, Math.ceil(cargoScaledUnload / unloadMult));
}

// The outbound leg: the base ticks divided by the outbound leg's speed (Fast Departure), ceil.
export function outboundLegTicks(baseTicks: number, ship: ShipDerivedStats): number {
  return Math.ceil(baseTicks / outboundLegSpeed(ship));
}

// The return leg: the Flight Deck Constitution ramp over the `ticksBeforeReturn` already flown when the facet is set,
// else the base ticks divided by the return leg's speed (Fast Return), ceil.
export function returnLegTicks(baseTicks: number, ship: ShipDerivedStats, ticksBeforeReturn: number): number {
  return ship.returnLegConstitution ? rampedReturnTicks(baseTicks, ship, ticksBeforeReturn) : Math.ceil(baseTicks / returnLegSpeed(ship));
}

// The Operations Integrity full-hold unload ("a packed hold unloads faster"): undefined without the facet.
export function fullHoldUnloadTicksFor(unloadTicks: number, ship: ShipDerivedStats): number | undefined {
  const fullHold = ship.fullHoldUnloadIntegrity ?? 0;
  return fullHold > 0 ? Math.max(1, Math.ceil(unloadTicks / (1 + fullHold))) : undefined;
}

// E-CREW 0.14.0 (Task 21, Operations INTEGRITY): the hold share at which a hold counts as packed. FIRST-PASS.
export const FULL_HOLD_FRACTION = 0.9;

// How full a mission's hold is, 0..: the summed cargo over the (effective) capacity. 0 for no capacity. Pure.
export function holdFillFraction(cargo: Record<LootMaterialKey, Decimal>, cargoCapacity: number): number {
  if (!(cargoCapacity > 0)) return 0;
  return cargo.commonOre.plus(cargo.uncommonMaterial).plus(cargo.rareMaterial).toNumber() / cargoCapacity;
}

// A phase's length for a mission IN FLIGHT: requiredTicksForPhase, except that the unloading phase of a hold at
// least FULL_HOLD_FRACTION full takes the def's fullHoldUnloadTicks (E-CREW Task 21, Operations Integrity). The
// cargo is fixed once the ship is unloading, so the length is constant across the phase (closed-form). The
// engine (tickCaptainMission) and every in-flight readout read THIS, so they agree. Pure.
export function missionPhaseTicks(
  phase: MissionPhase,
  missionDef: MissionDef,
  cargo?: Record<LootMaterialKey, Decimal>,
): number {
  if (
    phase === "unloading" &&
    missionDef.fullHoldUnloadTicks !== undefined &&
    cargo !== undefined &&
    holdFillFraction(cargo, missionDef.cargoCapacity) >= FULL_HOLD_FRACTION
  ) {
    return missionDef.fullHoldUnloadTicks;
  }
  return requiredTicksForPhase(phase, missionDef);
}

// E-CREW 0.14.0 (Task 21, Flight Deck CONSTITUTION): the return leg's ticks after the ramp. The voyage's hours
// before the return starts are its orders + outbound + extracting phases (RAMP_SECONDS_PER_TICK each); the leg
// is divided by (the return leg's speed * (1 + ramp)), ceil, at least 1 tick. Pure.
function rampedReturnTicks(baseTicks: number, ship: ShipDerivedStats, outboundTicks: number): number {
  const ramp = constitutionRamp(ship.returnLegConstitution ?? 0, (outboundTicks * RAMP_SECONDS_PER_TICK) / 3600);
  if (ramp === 0) return Math.ceil(baseTicks / returnLegSpeed(ship));
  return Math.max(1, Math.ceil(baseTicks / (returnLegSpeed(ship) * (1 + ramp))));
}

// Exploration 0.14.0 (Phase E4b): the floor on a museum-shortened extracting phase (whole ticks).
// FIRST-PASS TUNABLE; 1 means "never a 0-tick phase", which ceil already guarantees for any positive
// length, so this is belt-and-suspenders exactly like effectiveMissionDef's unload floor.
export const EXTRACTION_MIN_TICKS = 1;

// Exploration 0.14.0 (Phase E4b): the museum EXTRACTION SPEED seam. The extracting phase has no literal
// duration field: its length is ceil(cargoCapacity / extractionRatePerTick) (requiredTicksForPhase). To
// make it FASTER without changing what one cycle hauls (that is miningYield's job, via
// extractionYieldMult, so this must not double-count it), the fold:
//   1. takes the un-sped length baseTicks = ceil(cargo / rate),
//   2. shortens it: ticks = max(EXTRACTION_MIN_TICKS, ceil(baseTicks / speedMult)) (ceil, the same
//      conservative rounding the transit/unload divides use, so a tiny bonus never over-delivers),
//   3. raises the per-tick rate to rate * baseTicks / ticks, so ticks * rate' == baseTicks * rate: the
//      hold fills to EXACTLY the amount the un-sped phase would have extracted, just in fewer ticks.
// Each extracting tick still makes the SAME rng draws (rollExtractionTick reads only the def's
// chances), so the draw count per tick is unchanged; only the number of ticks drops, which is what
// "faster" means. Expected rare/uncommon/common amounts per CYCLE are preserved (each tick's whole
// amount lands in one tier). Returns {} (nothing spread) when the multiplier is absent / <= 1 /
// non-finite, or when the ceil leaves the length unchanged, so the def stays byte-identical.
function museumExtractionSpeedFold(
  rate: number,
  cargoCapacity: number,
  speedMult: number | undefined,
): { extractionTicksOverride?: number; extractionRatePerTick?: number } {
  if (speedMult === undefined || !Number.isFinite(speedMult) || speedMult <= 1 || !(rate > 0)) return {};
  const baseTicks = Math.ceil(cargoCapacity / rate);
  const ticks = Math.max(EXTRACTION_MIN_TICKS, Math.ceil(baseTicks / speedMult));
  if (ticks >= baseTicks) return {};
  return { extractionTicksOverride: ticks, extractionRatePerTick: (rate * baseTicks) / ticks };
}

// Combat 0.13.0 (offline recap "why did it stop early"): a TRANSIENT display hint recording
// the reason a captain's mission ended at a genuine wall-stop during catch-up. "fuel" = ran
// dry and could not relaunch; "cargo" = a warehouse/material cap idled an extraction run;
// "defeat" = a patrol was beaten and limped home damaged. Set by the mission-resolution
// functions in tick.ts at the SAME deterministic stop condition live and offline (so offline
// stays byte-identical to live), cleared to undefined on any fresh dispatch, and read by the
// offline summary + recap modal. It is NOT set on a clean completion or a user recall.
export type CaptainStopReason = "fuel" | "cargo" | "defeat";

// Infrastructure 0.13.4 (Phase 2 Unit 2.1, design §6.2): WHY A PATROL ENDED, enumerated
// EXHAUSTIVELY over every code path that sets a patrol's `mission` to null.
//
// ⚠️ THIS IS NOT A WIDENING OF CaptainStopReason ABOVE, AND MUST NOT BECOME ONE (design
// §6.5 / §17.3 Q13). That type is a three-member TRANSIENT hint for the offline recap, and
// "cargo" is extraction-only. This one is a COMPLETE record of patrol endings, including the
// two clean ones (`ordersComplete`, `recalled`) that are deliberately NOT wall-stops and must
// never raise a recap note. Keeping them separate gives the game ONE vocabulary per question
// instead of two overlapping unions; the recap's hint is DERIVED from this through an
// exhaustive Record, so there is exactly one place the mapping lives.
//
// The five members, each tied to the real branch that produces it:
export type PatrolEndReason =
  // The limp-home countdown reached 0. The hull arrives damaged and this is the one ending
  // that flags the ship. (tickCaptainPatrol, the limpingHome branch.)
  | "defeat"
  // A repeat-dispatch relaunch was unaffordable even after the credits auto-buy: the
  // anti-infinite-fuel floor. (tickCaptainPatrol, the canRelaunch false branch.)
  | "outOfFuel"
  // Dispatch Once finished its route cleanly. NOT a wall-stop.
  | "ordersComplete"
  // The player recalled it and it finished the route it was on. NOT a wall-stop.
  //
  // ⚠️ `ordersComplete` AND `recalled` LEAVE THROUGH THE SAME `else` IN THE ENGINE and were
  // indistinguishable before this release. Splitting them is a one-line read of
  // `mission.recalled` at that branch, and it matters: conflating them prints "orders
  // complete" to a player who pressed Recall, which is a small lie the log does not need.
  | "recalled"
  // The unknown-key inert guard dropped the captain to idle because the patrol key no longer
  // exists in the registry. Rare and self-healing, but it IS an ending, and leaving it out
  // would be exactly the blank reason this enumeration exists to make impossible.
  | "missionKeyRetired";

// ⚠️ ONE PATH LOOKS LIKE AN ENDING AND IS NOT, named here so nobody adds a sixth member for
// it: tickCaptainPatrol's defensive no-op, taken when the assigned ship or its
// combatHullTypeOf is absent, returns the captain and its mission UNCHANGED. The patrol does
// not end, it simply fails to advance this call. It must never carry a reason.

export interface CaptainState {
  id: number;
  label: string; // live, user-editable display name (defaults to "Captain N"), edited via renameCaptain (tick.ts) behind validateCaptainName (captainName.ts)
  // Combat 0.13.0 (Phase 9b.5a): a DISCRIMINATED UNION over mission KIND. null = idle
  // (idle captains have no passive economy, see tick.ts); an extraction mission
  // (CaptainMissionState, kind:"extraction") = the resource-extraction run; a patrol
  // (PatrolMissionState, kind:"patrol") = the 0.13.0 combat patrol. Every consumer that
  // reads extraction-only fields (missionKey/phase/cargo/...) MUST narrow on
  // `mission.kind === "extraction"` first; the compiler flags any that don't.
  // G1-3: a short-range board mission (ShortRangeMissionState, kind:"shortRange") is the third arm.
  mission: CaptainMissionState | PatrolMissionState | ShortRangeMissionState | null;
  xp: Decimal; // accumulated toward the NEXT level, see xpForNextLevel() below; accrued per active tick in tick.ts's tickCaptainMission (Task 4)
  level: number; // starts at 1
  statPoints: number; // unspent, earned on level-up, spent via buyHomeworldTalent's unlockCaptainSlot effect (tick.ts)
  unlockedCaptainTalents: CaptainTalentKey[]; // this captain's own purchased Captain Talent keys, see buyCaptainTalent (tick.ts)
  spec: CaptainTalentBranch | null; // this captain's chosen Captain Specialization, if any, null means no CAPTAIN_SPEC_BONUS entry applies yet (see that table below)
  // Crew 0.14.0 (Phase C-3a): the DORMANT captain PRESTIGE secondary talent tree state. These three
  // fields are ADDITIVE + inert until later phases wire them up; nothing on the tick reads them yet.
  //   secondaryPoints: unspent points to spend in the secondary tree (SECONDARY_CAPTAIN_TALENTS). One
  //     point is earned per captain retirement (a LATER phase, C-3b); allocation is spent via
  //     buySecondaryTalent (captainSecondaryTree.ts). Default 0. A brand-new captain has none.
  //   unlockedSecondaryTalents: this captain's own purchased secondary-tree node keys. Single-branch-
  //     committed by the allocation rules (canBuySecondaryTalent), so at most one of the 9 branches is
  //     ever populated. Default [].
  //   retirements: how many times this captaincy/lineage has retired (0..5), dormant until C-3b builds
  //     the retirement + XO-succession loop. Capped at 5 (a locked-in captain); 5 points fill exactly
  //     ONE branch = one of 9 ultimate specs. Default 0.
  secondaryPoints: number;
  unlockedSecondaryTalents: SecondaryTalentKey[];
  retirements: number;
  // Crew 0.14.0 (Phase C-3b): the INHERITED IDENTITY race of this captaincy, set when a retiring
  // captain's seated Executive officer (the XO) succeeds them (retireCaptain, captainRetirement.ts).
  // OPTIONAL + ADDITIVE: an absent value means "no inherited identity yet" (a brand-new captain has
  // never taken a successor), so an old save needs NO field-level migration and NO SAVE_VERSION bump:
  // it rides the `...captain` spread through serialize/hydrateDecimals untouched (a plain string, not
  // a Decimal), exactly like lastStopReason below and the established optional-additive convention.
  // WR-6 (0.14.0, OC-A43): the captain carries this race's racial on the ship it commands, at the officer
  // (Senior Staff) magnitude x CAPTAIN_RACIAL_SCALE, through the same crew map an officer's racial rides
  // (seniorStaff.ts captainRacialBonus, crewOverlay.ts rawShipCrewContribution). Absent = no racial.
  race?: CrewRace;
  // OPTIONAL transient display hint (offline recap): the reason this captain's mission last
  // ended at a genuine wall-stop, see CaptainStopReason above. undefined by default (a clean
  // completion, a recall, or a captain that never stopped leaves it unset). A plain string, so
  // it rides the `...captain` spread through serialize/hydrateDecimals untouched (NOT a
  // Decimal) and needs NO SAVE_VERSION bump / migration: an old save simply has it undefined.
  lastStopReason?: CaptainStopReason;
  // E-CREW 0.14.0 (Task 21 review): this captain's LIFETIME count of delivered mission cycles that rolled the
  // ship's Operations / Science CUNNING over-delivery (tick.ts tickCaptainMission). It keys each cycle's
  // private roll (officerStats.ts captainCycleMissionSeed), and it lives on the CAPTAIN, never the run, so a
  // recall + redispatch can never replay the same rolls. Never reset by dispatch; survives retirement (the
  // successor is a spread of the captain). OPTIONAL, written only once a cycle has rolled (absent = 0, no
  // SAVE_VERSION bump).
  cunningCycles?: number;
  // WR-5a (Motherlode, captain secondary extraction5): this captain's LIFETIME count of delivered cycles that
  // rolled the Motherlode double haul. It keys each cycle's private roll exactly as cunningCycles keys Cunning
  // (a recall + redispatch never replays a roll). OPTIONAL, written only once a cycle has rolled (absent = 0,
  // no SAVE_VERSION bump).
  motherlodeCycles?: number;
  // Material Lines ML-3 (OC-D2): this captain's LIFETIME count of deliveries that rolled a material quality climb
  // (a ship with a rig line). It keys each delivery's private rounding roll (materialQuality.ts materialQualitySeed),
  // the Motherlode rule. OPTIONAL, written only once a delivery has rolled (absent = 0, no SAVE_VERSION bump).
  materialQualityCycles?: number;
}

// WR-5a / WR-5b / WR-5c (0.14.0, OC-A2 "own ship"): the captain who commands `ship` (ship.assignedCaptainId), or
// undefined for an unassigned hull. The ONE copy every captain secondary tree reader uses (captainSecondaryEffects.ts
// re-exports it); it lives here so those modules share it without importing each other. Pure.
export function commandingCaptain(state: Pick<GameState, "captains">, ship: { assignedCaptainId: number | null }): CaptainState | undefined {
  return ship.assignedCaptainId === null ? undefined : state.captains.find((c) => c.id === ship.assignedCaptainId);
}

// Combat 0.13.0 (Phase 9b.5a): narrow a captain's mission union to its EXTRACTION arm, or
// null. A convenience for the existing extraction consumers (the App.svelte status
// readouts + the in-progress mission list) that must read extraction-only fields off the
// now-unioned CaptainState.mission WITHOUT each site hand-narrowing the discriminant.
// Returns the extraction mission when the captain is on one, else null for EVERY other
// case: idle (mission null) AND any non-extraction kind (today's patrol, and any future
// kind), all of which these extraction-only consumers treat as "not an extraction run".
// This is NOT a compile-time exhaustiveness checkpoint (only economyTick's switch(kind) +
// assertNeverMission is): a future kind is absorbed as null here silently, so any consumer
// that must actually DISPLAY/handle a new kind has to add that path EXPLICITLY rather than
// rely on this helper. PURE.
export function extractionMissionOf(captain: CaptainState): CaptainMissionState | null {
  return captain.mission !== null && captain.mission.kind === "extraction" ? captain.mission : null;
}

// --- Ship Production Economy (Phase 1, Task 3, docs/plans/2026-07-11-facility-
// framework-refinery-design.md §3/§5) --------------------------------------------
// DEFINITIONS ONLY this task. The ENGINE that creates/advances/resolves these
// (startProcess/resolveCompletedProcesses, the deduct-at-start + closed-form
// completion logic) lands in Task 8, nothing reads or writes any of the state
// fields below yet. Kept deliberately MINIMAL (Omega YAGNI): Task 8/10/11 extend
// them for batch/continuous refine orders + slot counts as those mechanics land;
// this forward shape is only what the save schema needs to reserve NOW so old
// saves don't have to re-migrate later.

// The timed shapes this engine ships. All are the same deterministic,
// fixed-duration process (design §3); the union keeps them distinguishable at the
// resolver. Extensible, missions could fold onto this engine later (design §2),
// so a new literal slots in without touching existing call sites (same convention
// as ShipType/MissionTier above).
//
// Fuel Economy v2 (F2): "fuelRefineJob" WAS the Fuel Depot's pipeline batch (Deuterium Ice -> fuel). The
// pipelines were retired in 0.13.9 and the fuel stockpile with its addFuel effect in WR-4 (save v70 drops any
// such process still in a save), so nothing starts one. The kind stays in the union ONLY so an old completed-
// events log entry ("Refined ... Fuel Depot") still renders (IDENTITY, not an effect).
// Research (Task R3, design §3): "researchProject" is a timed research project run by
// the Research Lab, a countdown whose COMPLETION unlocks a blueprint (the unlockBlueprint
// effect below) rather than adding an item / bumping a level. It reuses the SAME
// countdown/completion machinery; only its completion effect differs. Like the retired "fuelRefineJob"
// it is EXCLUDED from the resolver's Fleet-Admiral-XP lump award (see resolveProcesses) --
// research is automated infra that must not perturb the tuned FA-XP curve.
// Fabricator (Phase 4, Task F2): a "fabricateJob" crafts a researched blueprint's
// component from materials, the Fabricator's analog of the Refinery's "refineJob".
// It reuses the SAME countdown/completion machinery and the SAME "addItem" completion
// effect (resolveProcesses needs no new branch); only its INPUTS (a blueprint recipe)
// and its lifetime tally (itemsCrafted, not itemsRefined) differ. UNLIKE refineJob it
// is EXCLUDED from the resolver's Fleet-Admiral-XP lump award (see resolveProcesses) --
// like researchProject/fuelRefineJob, it is a blueprint-gated, long-duration automated
// economy that must not perturb the tuned FA-XP curve (a 120-300-tick craft would dump
// a large lump; the tiny-duration Phase-1 refineJob keeps its award). ⚠️ DESIGN DECISION
// flagged to the controller, flip the exclusion + this comment together if fabrication
// should feed FA XP.
// Shipyard (Phase 5, Task S3): "shipBuild" is a timed ship-construction job. Like
// fabricateJob/researchProject it is EXCLUDED from the completion FA-XP lump award
// (resolveProcesses), a hull build is a big blueprint-gated automated job, not a
// tuned FA-XP source. Its completion effect is the NEW `addShip` ProcessEffect (a
// ship is NOT an inventory item, so it cannot reuse addItem). One build slot this
// pass (shipBuildSlotCount, tick.ts).
// Crafting 0.13.3 (Phase 2, Unit 2.2, design §7.1): "salvageJob" is a TIMED recycle run
// by the Salvage Bay. Salvage used to be an instant, live-only action; making it a timed
// process is what lets it be QUEUED like every other production job. It reuses the SAME
// countdown/completion machinery; only its completion effect differs (salvageResolve,
// below) and only its consume TIMING differs (salvage is the one kind that consumes its
// input at COMPLETION rather than at start, which is why its target is protected by a
// derived reservation instead of by an up-front deduction, design §7.3).
// It grants NEITHER XP axis. See PROCESS_XP_AWARDS (tick.ts) for the reasoning, which is
// load-bearing: salvage returns only a fraction of what went in, so paying XP for it would
// turn craft, recycle, craft into an XP faucet.
// ⚠️ 0.13.4 Phase 3 adds "transitBerthExpansion", and that addition is a COMPILE ERROR in
// three exhaustive Records until each is given a row, which is the point: PROCESS_XP_AWARDS,
// PROCESS_COMPLETION_LOG (both tick.ts) and COMPLETION_KIND_VIEW (homeDashboard.ts). A new
// timed process cannot ship without deciding whether it grants XP, whether it is logged, and
// how it renders.
// Exploration 0.14.0 (Phase E4a): "relicStudy" is the Research facility's RELIC STUDY, run on its
// OWN lane (relicStudySlotCount, tick.ts) so it never blocks blueprint research. It consumes one
// unidentified vault token at START (the token rides the identifyRelic effect) and, on completion,
// IDENTIFIES it with a keyed deterministic roll and deposits one museum copy (resolveProcesses). XP
// policy, log policy and render row are declared in the same exhaustive Records as every other kind.
export type TimedProcessKind = "refineJob" | "facilityUpgrade" | "fuelRefineJob" | "researchProject" | "fabricateJob" | "shipBuild" | "equipmentStorageUpgrade" | "docksExpansion" | "transitBerthExpansion" | "shipRepair" | "salvageJob" | "relicStudy";

// What a process's COMPLETION applies (inputs were already deducted at START --
// design §4's atomic-consume fix). `addItem` grants a refine job's output;
// `facilityLevelUp` bumps a facility's level. `facility` is a plain string (not a
// FacilityKey union) so a later facility needs no type change here, forward-loose
// on purpose, same reasoning as inventory's `Record<string, Decimal>` key type.
export type ProcessEffect =
  // Material Lines ML-4 (L6, user 2026-10-19 "Weighted average + climb"): `inputQuality` is the unit-weighted
  // average quality of everything the job consumed, rounded down (materialQuality.ts carriedQuality), stamped by
  // startProcess on a refine or fabricate job only when above 0. The output lands at min(5, inputQuality + the
  // usual roll). ABSENT = 0, so every job in flight before ML-4 (and every job on Q0 stock) resolves exactly as
  // before. A plain number: it rides hydrateDecimals's effect spread, no migration.
  | { type: "addItem"; itemId: string; amount: Decimal; inputQuality?: number }
  | { type: "facilityLevelUp"; facility: string }
  // Research (Task R3, design §3): a completed research project unlocks its blueprint by
  // adding `key` to state.researchedBlueprints (resolveProcesses, idempotent, no dup).
  // The discriminant "unlockBlueprint" and the `key: string` field are FIXED by design §3
  // and are the EXACT shape R1's blueprintResearchable already scans activeProcesses for
  // (its "not in progress" check reads `effect.type === "unlockBlueprint" && effect.key`
  // via a forward cast), keep them in lockstep or that scan silently goes stale.
  // Carries NO Decimal (unlike addItem's `amount`), so hydrateDecimals (save.ts)
  // needs NO change: its `"amount" in effect` guard skips this effect, and it round-trips
  // through JSON as plain {type,key} strings.
  | { type: "unlockBlueprint"; key: string }
  // Shipyard (Task S3, design §5): a completed shipBuild MINTS a parked ShipInstance of
  // `typeKey` (resolveProcesses appends it to state.ships + bumps nextShipId). This is a
  // NEW effect (NOT a reuse of addItem) because a ship is a first-class fleet object, not
  // an inventory item, it has an id, a typeKey, and an assignment, none of which the
  // itemId/amount inventory shape can carry. Like unlockBlueprint it carries NO Decimal
  // (typeKey is a plain string union), so hydrateDecimals (save.ts) skips it via its
  // `"amount" in effect` guard and it round-trips through JSON as {type,typeKey} strings.
  | { type: "addShip"; typeKey: ShipTypeKey }
  // Equipment 0.11.0 (Task 19): a completed EQUIPMENT fabricate job MINTS a non-stacking
  // EquipmentInstance (resolveProcesses rolls its stats via generateEquipment, pushes it
  // into state.equipment as a spare, and bumps nextEquipmentId). This is a NEW effect (NOT
  // a reuse of addItem) for the EXACT reason addShip is: an EquipmentInstance is a first-
  // class fleet object with its own id / stat rolls / fitment, none of which the
  // itemId/amount inventory shape can carry. It carries the `blueprintKey` (not the rolled
  // instance) so the ROLL happens at COMPLETION on the threaded seeded rng (offline==live
  // parity, mirroring the quality roll addItem does), NOT at start; resolveProcesses reads
  // BLUEPRINTS[blueprintKey].equipmentOutput for the slot/variety to mint. An equipment
  // blueprint carries NO `recipe.outputItem` (the field is optional and omitted), so there
  // is no stackable output to grant. Like unlockBlueprint/addShip it carries NO Decimal (blueprintKey is a
  // plain string), so hydrateDecimals (save.ts) skips it via its `"amount" in effect` guard
  // and it round-trips through JSON as {type,blueprintKey} strings.
  | { type: "addEquipment"; blueprintKey: string }
  // ITEM LIFECYCLE 0.13.6: a completed fabricate of an equipment/weapon/drone blueprint now
  // deposits a stackable BLANK (an uninspected craft) keyed by blueprintKey, +1 per completion,
  // instead of rolling an EquipmentInstance. The ROLL is deferred to the INSPECT player action
  // (inspectBlank, tick.ts), which is what moves crafting off the tick's threaded rng and onto the
  // per-inspect inspectSeed. `addEquipment` ABOVE IS KEPT DELIBERATELY so a craft already IN FLIGHT
  // across the 48->49 migration still completes into an instance the old way; only NEW fabricate
  // jobs carry `addBlank`. Carries NO Decimal (a plain blueprintKey; the +1 is applied at
  // completion), so hydrateDecimals skips it via its `"amount" in effect` guard, exactly like
  // addEquipment/addShip/unlockBlueprint.
  | { type: "addBlank"; blueprintKey: string }
  // Equipment 0.11.0 (Task B2, Storage/Salvage): a completed EQUIPMENT-STORAGE upgrade
  // process bumps state.equipmentStorageLevel by ONE, so equipmentStorageCap derives the
  // NEXT rung's higher cap on read. This is the equipment-storage twin of facilityLevelUp:
  // that effect bumps a FACILITY's level; this one bumps the STANDALONE equipmentStorageLevel
  // field B1 deliberately chose over a facility (see EQUIPMENT_STORAGE_RUNGS). It carries NO
  // payload (the single target field is fixed), so like facilityLevelUp it holds NO Decimal
  // and round-trips through JSON as {type} only (hydrateDecimals skips it, no "amount" key).
  | { type: "equipmentStorageLevelUp" }
  // Fleet Management (Docks Expansion): a completed DOCKS-EXPANSION process bumps
  // state.shipStorageCapacity by ONE, raising the max hulls the docks can hold (the
  // cap canStartShipBuild enforces at ship build). This is the docks twin of
  // equipmentStorageLevelUp, but with ONE deliberate difference: equipment stores a
  // LEVEL and DERIVES its cap, whereas the docks cap is the SINGLE SOURCE stored field
  // shipStorageCapacity itself, so this effect mutates that field directly (+1) rather
  // than a level. It carries NO payload (the single target field is fixed), so like
  // facilityLevelUp / equipmentStorageLevelUp it holds NO Decimal and round-trips
  // through JSON as {type} only (hydrateDecimals skips it, no "amount" key).
  | { type: "docksCapacityUp" }
  // 0.13.4 Phase 3: raises the TRANSIT BERTH rung level by 1. No payload, like
  // docksCapacityUp above and for the same reason: the target field is fixed.
  //
  // ⚠️ IT RAISES A LEVEL, NOT A CAPACITY, which is the one way it differs from its docks
  // sibling. transitBerthCapacity stores the rung level and berths.ts derives the count from
  // it; see transitBerthCount for why that direction was chosen.
  | { type: "transitBerthLevelUp" }
  // Combat 0.13.0 (Phase 11, design S13): a completed shipRepair job CLEARS the target
  // ship's damage. resolveProcesses finds the ship by `shipId` and lowers its `damaged` +
  // `repairDamage` back to undefined, so the hull becomes dispatchable again. This is a NEW
  // effect (NOT a reuse of any above) because it targets a first-class fleet object (a ship)
  // by id, exactly like addShip mints one. Like addShip / unlockBlueprint it carries NO
  // Decimal (shipId is a plain string), so hydrateDecimals (save.ts) skips it via its
  // `"amount" in effect` guard and it round-trips through JSON as {type,shipId} strings. A
  // stale shipId (the ship was salvaged mid-repair) is a harmless no-op in the resolver.
  | { type: "clearShipDamage"; shipId: string }
  // Crafting 0.13.3 (Phase 2, Unit 2.2, design §7.1 + §7.3): a completed "salvageJob"
  // RESOLVES its target, meaning it consumes the target AND grants the recovery in one
  // atomic step at completion. `target` is the SAME SalvageTargetRef a queued salvage
  // order carries (declared below with the queue schema), so an order promotes into a
  // process without reshaping its payload and one target type serves both halves of the
  // pipeline: there is exactly one definition of "what a salvage points at", which is
  // what lets the derived reservation (reservation.ts) bin a QUEUED and an IN-FLIGHT
  // salvage through the identical code path.
  //
  // WHY THE TARGET AND NOT A PRE-COMPUTED PAYLOAD: consuming at completion means the
  // process must still be able to find the thing it is recycling when it lands, so it
  // carries the id, not a snapshot of the reward. That is also what makes a STALE target
  // (a hull lost or already recycled while the job ran) a fail-safe no-op instead of a
  // phantom payout, the same posture clearShipDamage documents just above.
  //
  // NO DECIMAL ON THIS EFFECT, VERIFIED: SalvageTargetRef's three arms are plain id
  // strings only (see its own declaration), so hydrateDecimals (save.ts) skips this
  // effect via its `"amount" in effect` guard, exactly like unlockBlueprint / addShip /
  // clearShipDamage, and it round-trips through JSON as {type,target:{kind,id}} strings.
  // Keep it that way: a Decimal added here without a matching revive in save.ts would
  // load back as a bare string and throw on the first arithmetic.
  // ⚠️ `auto` MARKS A JOB THE AUTO-SALVAGE TERMINAL STARTED (2026-09-11), and it is the
  // ONLY thing that distinguishes an automation teardown from a player's own once both are
  // running. It is stored rather than derived because there is nothing left to derive it
  // from: the queue entry is gone by then, so the in-flight job has to carry its own origin
  // or the lane split could not be read back after a save/load or an offline resolve.
  // ABSENT MEANS MANUAL, which is the correct reading for every job that predates the
  // Terminal and for every job a manual promotion starts, so no migration touches
  // activeProcesses. It is `true | undefined` rather than `boolean` so "false" cannot be
  // written as a third, meaningless state. A plain boolean, so hydrateDecimals is unchanged.
  | { type: "salvageResolve"; target: SalvageTargetRef; auto?: true }
  // Exploration 0.14.0 (Phase E4a): a completed "relicStudy" IDENTIFIES the carried vault token. The
  // token was REMOVED from state.relicVault at start (startRelicStudy), so it lives only here while the
  // study runs (a cancel-free one-shot, like research). `studyIndex` is the monotonic index minted at
  // start (state.nextRelicStudyIndex); the completion roll is keyed off (state.relicSeed, a fixed salt,
  // studyIndex, token.id), so it is a pure function of stored values and offline == live by
  // construction. NO Decimal (the token is plain strings/numbers), so hydrateDecimals skips this effect
  // via its `"amount" in effect` guard and it round-trips through JSON verbatim.
  // Relics v2 R2-1 (DORMANT): `v: 2` marks a v2 study (its PRESENCE is the flag, plan 2026-10-17 section 3.2); R2-3
  // stamps it. A study without it resolves through the v1 roll exactly as dispatched, so every in-flight study keeps
  // its result.
  | { type: "identifyRelic"; token: RelicVaultToken; studyIndex: number; v?: 2 };

// One in-flight timed process. `id` is monotonic ("proc-N"), allocated from
// GameState.nextProcessId (mirrors the ShipInstance/nextShipId pattern).
//
// COUNTDOWN, not start-timestamp (Task 8): the engine tracks `remainingTicks`
// (ticks left until completion), which resolveProcesses DECREMENTS by the ticks
// elapsed each call, rather than an absolute `startTick` compared against a
// global tick counter. This is what makes offline catch-up closed-form WITHOUT
// needing a fleet-wide "current tick" clock: completion is simply "has
// remainingTicks reached 0?", and one resolve of N ticks decrements identically
// to N resolves of 1 tick (see resolveProcesses in tick.ts). `durationTicks` is
// FIXED at creation and is BOTH the initial remainingTicks AND the Fleet Admiral
// XP awarded on completion (the "1 FA XP per tick, lumped on completion" model).
export interface TimedProcess {
  id: string;
  kind: TimedProcessKind;
  remainingTicks: number; // ticks left until completion; decremented by resolveProcesses, closed-form countdown
  durationTicks: number;  // FIXED at creation, initial remainingTicks AND the lump FA XP awarded on completion
  effect: ProcessEffect;  // what completion does (add item / level up a facility)
  // Crafting Allocation Redesign (Task C2): the production LINE that owns this job,
  // when it was started by the per-slot line engine (processRefineLines /
  // processFabricateLines, tick.ts), the CraftLine.id ("craft-N"). It ties an
  // in-flight job back to its line so the engine can enforce "at most ONE in-flight
  // job per line" (a line with a matching `lineId` in activeProcesses is busy) and
  // know when a finished batch line may be removed. ABSENT (undefined) on every OTHER
  // process kind, manual refine/fabricate jobs (startRefineJob/startFabricateJob),
  // facility upgrades, fuel batches, research projects, so those ride through
  // untouched. A plain string (no Decimal), so save hydration needs no change: it
  // rides the activeProcesses `...state` spread verbatim.
  lineId?: string;
  // 0.14.0 SPEED SEAM (processSpeed.ts; design: docs/plans/2026-10-16-credit-sinks-pass.md "SPEED SEAM DESIGN"):
  // the Overtime steps bought and the tutorial time skip. ABSENT on every process nothing sped up, which is every
  // process in a 0.14.0 save without a purchase, so resolveProcesses and every reader are byte-identical. Plain
  // numbers and a flag: rides hydrateDecimals's spread, no migration.
  speed?: ProcessSpeed;
  // WR-6 (0.14.0, OC-B2): Works Directorate's extra output, decided when a Fabricator job STARTS (tick.ts
  // startProcess, its own keyed roll) and stamped here, so the job delivers one more of its output at completion.
  // Written only when the roll lands (absent = the normal output), so a job started before WR-6, or without the
  // talent, completes byte-identically. A plain flag: no migration.
  bonusOutput?: true;
}

// 0.14.0 SPEED SEAM: the one speed record every timed thing can carry (a TimedProcess, an extraction mission, a
// patrol, an expedition). Pure bookkeeping plus one engine read each (processSpeed.ts header):
//   overtimeSteps    Overtime steps bought (a TimedProcess only). The purchase itself rescales remainingTicks (the
//                    work left now runs at 1 + 0.25 x steps of the normal rate), so the countdown engine never reads
//                    it: this is the record of what was bought (rate, price of the next step, the max-step gate).
//   instantComplete  a tutorial time skip was applied. A TimedProcess is set to 0 ticks left (it completes on the next
//                    resolve); a mission or patrol runs through to the end of its CURRENT cycle or route on its next
//                    tick (tickCaptainMission / tickCaptainPatrol read it; a new cycle or route is built without it);
//                    an expedition is advanced to completion at once and keeps this as a stamp.
//   clockOffsetSeconds  an expedition only: how far its own clock ran ahead of the game clock at the skip (its natural
//                    end minus the game time then). Its stored times (bay ends) are on its own clock, so the claim
//                    reads them shifted back by this (injuries.ts applyGroundOpsInjuries), exactly as if it had
//                    been claimed at its natural end. Absent = 0 = the game clock.
export interface ProcessSpeed {
  overtimeSteps?: number;
  instantComplete?: true;
  clockOffsetSeconds?: number;
}

// A built facility's live state. `level` 0 = not built; unlock is the level 0->1
// upgrade (design §5, "no separate unlock system"). Minimal for Phase 1, Task
// 10/11 may extend this (e.g. per-facility refine-order/slot bookkeeping) as the
// refinery UI + batch orders land.
export interface FacilityState {
  level: number; // 0 = not built
}

// --- Facility framework (Phase 1, Task 10, docs/plans/2026-07-11-facility-
// framework-refinery-design.md §5/§6) ----------------------------------------
// The reusable meta-system every later facility (Warehouse, Fabricator, Research,
// Shipyard...) hangs on, plus its first real node (the Refinery). A facility's
// upgrade TRACK is a FINITE, ordered list: upgrades[i] holds the requirements to
// reach level i+1 (so upgrades[0] is the level 0->1 build/unlock, there is NO
// separate unlock system, design §5). Buildability + the startFacilityUpgrade
// action live in tick.ts (they use the Task 8 startProcess engine); THIS file
// only declares the shapes + the launch data table.

// What a completed facility upgrade GRANTS. Distinct from ProcessEffect (which is
// what the timed-PROCESS applies on completion, a facilityUpgrade process just
// bumps the level via { type: "facilityLevelUp" }). This effect is DESCRIPTIVE
// metadata on the upgrade DEF: the refine-slot / refine-speed system (Task 11+)
// derives a facility's total slots / speed by summing these across every level
// reached, exactly the way SHIP_TYPES' moduleSlots are POPULATED-but-INERT until
// their system lands. Extensible union (same convention as ProcessEffect /
// TimedProcessKind): a future effect kind slots in without touching call sites.
export type FacilityUpgradeEffect =
  | { addRefineSlots: number }   // +N parallel refine jobs this facility can run (Task 11 derives slot totals)
  // 0.13.3 Unit 3.1b (FIX A): this was declared in Task 11 but read by NOTHING for the
  // whole of 0.11.x/0.12.x, so the refinery's advertised "1.5x refine speed" rung was
  // inert and a player could buy an upgrade that did nothing. refineSpeedMult (tick.ts)
  // now PRODUCTS it across reached rungs and refineJobDurationTicks DIVIDES a refine
  // job's duration by it at job start.
  | { refineSpeedMult: number }  // multiplies this facility's refine-job speed (faster = fewer ticks)
  // Phase 2, Task B2 (design §3.3): a Warehouse-tier cap MULTIPLIER. Each reached
  // warehouse rung multiplies its tier's per-item storage cap by this factor;
  // tierCap (tick.ts) DERIVES the live cap by multiplying BASE_CAP[tier] across
  // every reached rung's storageCapMult, the SAME derive-on-read/reached-rungs
  // pattern refineSlotCount uses to SUM addRefineSlots. Every T1/T2 rung is x2, so
  // the product is 2^level (the design's "cap doubles per level"); the value lives
  // on the rung (not hard-coded in tierCap) so the upgrade track stays the single
  // source of truth and a future tier could tune a different factor with no
  // formula change. This is a NON-discriminated union (distinguished by property
  // presence, no `type` tag), consumers narrow with `"storageCapMult" in effect`
  // (tierCap) exactly as refineSlotCount narrows with `"addRefineSlots" in effect`,
  // so this new member is safely IGNORED by every existing consumer that checks for
  // a different property.
  | { storageCapMult: number }
  // Mission Rework (Task 6): a marker for a rung whose ENTIRE benefit is the LEVEL
  // BUMP ITSELF, it grants no summed slot/speed/cap stat. The mission-control
  // facility's rungs carry this: what a level unlocks is derived on read from the
  // facility LEVEL (see tick.ts's missionUnlocked + MissionDef.unlockLevel), NOT by
  // summing an effect off the track. Every existing consumer (refineSlotCount /
  // tierCap / fleetReachBonus) narrows by ITS OWN property AND scopes to its own facility, so
  // this member is inert to all of them, it exists only to satisfy the required
  // `effect` field honestly (a misleading `addRefineSlots: 0` / `storageCapMult: 1`
  // would imply a stat this facility does not have). Extensible union, same
  // property-presence narrowing convention as the members above.
  | { unlocksContent: true }
  // G1-3 (Short-Range Missions, call 8 "Mission Control upgrades"): one more board SLOT at this tier. Read by
  // shortRangeBoardSlots (shortRangeBoard.ts), which appends one slot per reached Mission Control board rung
  // (MISSION_CONTROL_BOARD_RUNGS) after the two Tier I slots every save starts with.
  | { addShortRangeSlot: ShortRangeTier }
  // --- WR-4 (OC-C1): the Fuel Depot's FLEET REACH rung -------------------------
  // The share of every ship's reach the rung adds (FUEL_DEPOT_REACH_PER_RUNG). tick.ts fleetReachBonus SUMS it
  // across the reached fuelStorage rungs (the same derive-on-read/reached-rungs idiom refineSlotCount uses) and
  // shipReachDef applies it. It replaced the tank-cap ({ storageCapMult } on this track) and the three refinery
  // effects (addFuelPipelines / fuelYieldMult / fuelInputMult) when the fuel stockpile was retired.
  | { fleetReachBonus: number }
  // --- Research (Task R2, design §1): the Research Lab's SLOT grant ---------------
  // +N concurrent research projects this facility can run. researchSlotCount (tick.ts)
  // SUMS this across the reached rungs, the EXACT same derive-on-read/reached-rungs
  // idiom refineSlotCount uses for `addRefineSlots` (research slots are literally the
  // Research Lab's analog of the Refinery's refine slots). The Research Lab's blueprint
  // TIER unlock is NOT summed off an effect: it derives from the facility LEVEL
  // (blueprintResearchable reads level >= tier), the same way missionUnlocked derives
  // missions from the mission-control level, so a research rung's effect is ONLY the
  // slot grant, never a content-unlock marker. Property-presence narrowing (same as the
  // members above), so a rung carrying this is inert to refineSlotCount / tierCap /
  // fleetReachBonus, and vice-versa.
  | { addResearchSlots: number }
  // --- Fabricator (Phase 4, F1, design §1): the Fabricator's SLOT grant ----------
  // +N concurrent craft jobs this facility can run. fabricateSlotCount (tick.ts) SUMS
  // this across the reached rungs, the EXACT same derive-on-read/reached-rungs idiom
  // refineSlotCount uses for `addRefineSlots` and researchSlotCount uses for
  // `addResearchSlots` (fabricate slots are the Fabricator's analog of refine/research
  // slots). The blueprint TIER unlock is NOT summed off an effect: it derives from the
  // facility LEVEL (a blueprint is fabricable when fabricator level >= blueprint.tier),
  // the same way researchSlotCount's Research Lab derives tiers from level, so a
  // fabricate rung's effect is ONLY the slot grant, never a content-unlock marker.
  // ADDED ADDITIVELY + INERT: property-presence narrowing (same convention as every
  // member above), so a rung carrying this is inert to refineSlotCount / researchSlotCount
  // / tierCap / fleetReachBonus, and, critically, NO existing facility rung sets it, so this
  // member changes NO existing behavior (anti-regression: Omega 15).
  | { addFabricateSlots: number }
  // --- Shipyard (Phase 5, Task S1, design §2): the build-SPEED multiplier ----------
  // Multiplies the Shipyard's ship-build SPEED (>1 = FASTER, i.e. the build engine S3
  // will DIVIDE a hull's buildRecipe.durationTicks by the PRODUCT of this across the
  // reached rungs, the SAME derive-on-read/reached-rungs idiom refineSpeedMult uses,
  // a MULTIPLIED effect rather than a SUMMED slot grant). The Shipyard's founding rung
  // establishes the facility (an inert `unlocksContent` level-bump, like Mission
  // Control's founding); its LATER rungs carry this to cut build time. Refit + repairs
  // are FUTURE rungs on this same track (design §2, hooked-not-built).
  // ADDED ADDITIVELY + INERT (anti-regression, Omega 15): property-presence narrowing
  // (same convention as every member above), so a rung carrying this is inert to
  // refineSlotCount / researchSlotCount / fabricateSlotCount / tierCap / fleetReachBonus, and --
  // critically, NO existing facility rung sets it (only FACILITIES.shipyard's later
  // rungs do), so this member changes NO existing behavior. No consumer READS it yet
  // either (the S3 build engine will); it is inert data this pass.
  | { buildSpeedMult: number }
  // --- Salvage Bay (Salvage Lanes, 2026-09-04, design section 15d "Adding LANES") --------
  // +N concurrent salvage jobs this facility can run. salvageSlotCount (tick.ts) SUMS this
  // across the reached rungs, the EXACT same derive-on-read/reached-rungs idiom
  // refineSlotCount uses for `addRefineSlots`, and it adds the sum to a BASE of one rather
  // than starting from zero (see SALVAGE_BAY_BASE_SLOTS): the bay works at level 0.
  //
  // ⚠️ THIS PAYLOAD MEANS "PLUS N CONCURRENT JOBS AT THIS FACILITY", AND MAY NEVER MEAN,
  // IMPLY OR BE REUSED TO MEAN QUEUE DEPTH (design section 15a rule 2, LOCKED: "There are
  // no upgrades that give +1 queue slot X lane"). Depth is bought with Homeworld talents,
  // is per FACILITY, and is never multiplied by anything inside a facility. Lanes are how
  // fast the bay chews; depth is how far ahead the player may plan.
  //
  // NAMING: `addSalvageSlots`, not `addSalvageLanes`, so it matches the effect family it
  // joins (addRefineSlots / addResearchSlots / addFabricateSlots) and the helper that reads
  // it (salvageSlotCount, the signature the queue adapter already calls). "Lane" is the
  // DESIGN's name for the axis and "bay" is the CONSOLE's name for one unit of it; all
  // three words denote the same thing, and the console keeps saying "bay" because that is
  // what every shipped string on this facility already says.
  //
  // ADDED ADDITIVELY + INERT: property-presence narrowing (same convention as every member
  // above), so a rung carrying this is inert to refineSlotCount / researchSlotCount /
  // fabricateSlotCount / tierCap / fleetReachBonus, and no PRE-EXISTING facility rung sets it, so
  // this member changes NO existing behavior (anti-regression: Omega 15).
  | { addSalvageSlots: number }
  // --- Shipyard BERTHS (Shipyard Berths, 2026-09-06, design section 15d "Adding LANES") ---
  // +N shared build/repair BAYS at the Shipyard. shipyardBayCount (tick.ts) SUMS this across
  // the reached rungs and ADDS the sum on top of the count it already derived, which is the
  // whole design of this member: it is a PURE ADDITION to an existing formula, never a
  // replacement for it.
  //
  // ⚠️ WHY THIS EXISTS AT ALL: bays ARE the Shipyard's lanes (design section 15a), and until
  // now they were the only lane count in the game a player could not CHOOSE to buy. They
  // arrived as a side effect of buying build SPEED, because shipyardBayCount granted +1 bay
  // per reached { buildSpeedMult } rung. A player who wanted another bay had no rung to point
  // at, and a player who bought speed was never told a bay came with it. This member is the
  // rung they can point at.
  //
  // ⚠️⚠️ THE SPEED RUNGS STILL GRANT THEIR BAYS, AND THAT IS NOT A LEFTOVER. Existing saves
  // have bays TODAY that came from those rungs. MOVING the grant instead of ADDING to it would
  // mean a shipyard at level 3 loading with fewer bays than it had, which can strand an
  // in-flight build and destroy purchased progress. So the old grant stays exactly as it was
  // and these rungs sit ON TOP of it. The console now NAMES the bay on the speed rungs
  // (App.svelte) so the side effect is a stated grant rather than an invisible one. See the
  // never-fewer-bays proof in ship-repair.test.ts.
  //
  // NAMING: `addShipyardBays`, not `addShipyardBerths`, because "bay" is what every shipped
  // string, helper and comment on this facility already says (shipyardBayCount,
  // SHIPYARD_BAY_BASE, "A damaged hull can always find a bay"). "Berth" is the word for the
  // PURCHASE in the design conversation; the console keeps saying "bay" so one thing has one
  // name on screen.
  //
  // ⚠️ THIS PAYLOAD MEANS "PLUS N CONCURRENT JOBS AT THIS FACILITY", AND MAY NEVER MEAN,
  // IMPLY OR BE REUSED TO MEAN QUEUE DEPTH (design section 15a rule 2, LOCKED). Depth is
  // bought with Homeworld talents and is never multiplied by a lane count.
  //
  // ADDED ADDITIVELY + INERT: property-presence narrowing (same convention as every member
  // above), so a rung carrying this is inert to refineSlotCount / researchSlotCount /
  // fabricateSlotCount / salvageSlotCount / tierCap / fleetReachBonus / shipBuildSpeedMult, and no
  // PRE-EXISTING facility rung sets it, so this member changes NO existing behavior
  // (anti-regression: Omega 15).
  | { addShipyardBays: number }
  // --- Subspace Telescope (Squads SQ-5, design section 6.1) ---------------------------
  // The telescope's READING at this rung, as ABSOLUTE values (not summed, not multiplied):
  // `reachTier` = the highest expedition region tier (I to VII) the telescope pre-surveys,
  // `detail` = how much it reads there (0 Blind .. 5 Forecast, design 6.3). telescope.ts
  // telescopeReading takes them from the HIGHEST reached rung that carries this member.
  // Property-presence narrowing like every member above, so it is inert to every existing
  // consumer, and only FACILITIES.subspaceTelescope sets it.
  | { telescope: { reachTier: number; detail: number } };

// One rung of a facility's upgrade track = the requirements to reach the NEXT
// level. `materials` are deducted ATOMICALLY at start by startProcess (design §4).
// Every `requires*` field is an OPTIONAL gate (absent = that gate does not apply):
//   - requiresHomeworldTalents: all must be in state.unlockedHomeworldTalents.
//   - requiresResearch: research-topic ids, reserved, EMPTY today (no research
//     topics exist yet). "No placeholders": no upgrade sets it, but the gate is
//     honored if a future topic ever does.
//   - requiresFacilityLevels: other facilities that must be at >= the given level
//     (a cross-facility dependency chain). EMPTY today, refinery is the only
//     Phase 1 facility, so there is no other facility to depend on. Plain-string
//     keys (not a FacilityKey union), forward-loose like inventory/ProcessEffect.
//   - requiresFleetAdminLevel: state.fleetAdminLevel must be >= this (design §5,
//     user 2026-07-11). Assumes the recalibrated FA curve (Progression Pacing
//     Rework shipped first), so these are real numbers, not stand-ins.
export interface FacilityUpgradeDef {
  materials: Record<string, Decimal>;
  // Research (Task R2, design §1/§6 + locked brainstorm decision #3 "Cost = time +
  // CREDITS. No materials"): an OPTIONAL flat CREDITS cost for this rung, deducted
  // ATOMICALLY at start alongside `materials` (startFacilityUpgrade). Absent = no
  // credit gate (grow-on-demand posture, exactly like every `requires*` gate above).
  // ⚠️ Introduced by R2 because the facility-upgrade framework had NO credits gate
  // before, every PRE-R2 facility (refinery/warehouses/fuel depot/mission control)
  // OMITS this field, so the credits gate in canBuildFacilityUpgrade + the deduct in
  // startFacilityUpgrade are INERT for all of them (no behavior change, no regression).
  // The Research Lab is the FIRST rung-cost-in-credits facility (its upgrade credit
  // sink is the design's "credits get a real long-term sink"). A Decimal (not a plain
  // number) to match state.credits' type at the compare/deduct sites; it lives in the
  // STATIC FACILITIES table (constructed at module load, like `materials`' Decimals),
  // so it never round-trips through the JSON save, no hydration concern.
  credits?: Decimal;
  durationTicks: number;
  effect: FacilityUpgradeEffect;
  requiresHomeworldTalents?: HomeworldTalentKey[];
  requiresResearch?: string[];                    // EMPTY today (no research topics), reserved, no placeholder
  requiresFacilityLevels?: Record<string, number>;
  requiresFleetAdminLevel?: number;
  // Mission Rework (Task 6): a PLAY-COMPLETION gate. Each listed mission must have a
  // lifetime completion count (state.lifetimeStats.missionsCompleted[key]) >= the
  // given threshold before this rung is buildable. A NEW prereq kind alongside the
  // FA-level / talent / research / facility-level gates above, same OPTIONAL posture
  // (absent = gate does not apply) and the SAME "first failing gate names the reason"
  // treatment in canBuildFacilityUpgrade (tick.ts). Partial over MissionKey because a
  // rung gates on only SOME missions (a future mission-control unlock rung would gate on
  // whichever missions are available at that point). This is the mechanism that makes a
  // mission-control unlock track "earn it by playing" rather than "buy it".
  //
  // USER REVISION 2026-07-14: no PRODUCTION rung uses this field today, the mission-
  // control unlock UPGRADE was deferred (see FACILITIES.missionControl). The type + its
  // canBuildFacilityUpgrade enforcement are RESERVED and TESTED (mission-control.test.ts's
  // fixture-facility coverage) so a future unlock rung is a pure data re-add.
  requiresMissionCompletions?: Partial<Record<MissionKey, number>>;
}

export interface FacilityDef {
  label: string;
  upgrades: FacilityUpgradeDef[]; // upgrades[i] = requirements to reach level i+1; FINITE track, extended additively
}

// Launch facility table, REAL levels only, same "no placeholders" discipline as
// MISSIONS/RECIPES/SHIP_TYPES. Phase 1 seeds ONLY the Refinery, with a FINITE
// 4-level upgrade track (extend additively as higher tiers / research gates land).
// ⚠️ ALL numeric values below (materials, durations, FA-level + talent gates) are
// TUNABLE LAUNCH PLACEHOLDERS, first-pass content, real balance happens at the
// device-check stage, exactly like every other launch table's constants here.
//
// Track shape rationale:
//   - Level 0->1 (Build) is INTENTIONALLY UNGATED beyond its material cost, the
//     first facility must be buildable from a fresh save (a fresh fleet is at FA
//     level 1 with no talents), so gating the initial build behind FA level /
//     talents would soft-lock the whole system. Gates appear on LATER rungs only.
//   - Escalating commonOre (and titaniumIngot on the higher rungs, closing a
//     loop: you must refine to upgrade the refinery) + escalating durations.
//   - Levels 1->2, 2->3 each grant +1 refine slot (more parallel jobs); the final
//     3->4 rung grants a refineSpeedMult instead, to exercise BOTH effect kinds.
//   - requiresFleetAdminLevel gates (2, 5, 8) + a requiresHomeworldTalents gate
//     ("industryHub", the Industry category hub, thematically apt for a refinery)
//     are REAL gates against content that exists today. requiresResearch /
//     requiresFacilityLevels stay unused (no research topics; refinery is the only
//     facility), their gate logic is implemented + reserved, not faked into data.
// --- Tiered Warehouse facilities (Phase 2, Task B2, design §3.1-§3.3) -------
// Each warehouse TIER is its OWN facility (own key, own level, own upgrade track)
// hung on the SAME Phase 1 facility framework the Refinery uses, so the existing
// timed-process machinery (startFacilityUpgrade / canBuildFacilityUpgrade /
// resolveProcesses) drives warehouse upgrades with NO new mechanism: a warehouse
// upgrade is just a facilityUpgrade TimedProcess that bumps facilities[key].level.
//
// The per-item STORAGE CAP for a tier is DERIVED from its warehouse level by
// tierCap (tick.ts): BASE_CAP[tier] doubled per reached rung (each rung carries a
// { storageCapMult: 2 } effect). This file only DECLARES the tracks; ENFORCEMENT
// (auto-stop a producer when an item hits its cap) is Task B3.
//
// ⚠️ TUNABLE LAUNCH PLACEHOLDERS: the rung COUNT and durationTicks below are
// first-pass, same discipline as the Refinery's track. Material COSTS are NOT free
// placeholders, they are DERIVED from the design's cap economy (75% of the cap at
// the level being upgraded); retune the cap economy, not the costs directly.

// T1 default (level-0) per-item cap. Mirrors tick.ts's BASE_CAP[1], they encode
// the SAME design number (design §3.3: 1,000,000), kept in both places because
// this one feeds the cost formula (75% of the cap) while tick.ts's feeds tierCap.
// Change BOTH together if the T1 base ever moves.
export const WAREHOUSE_T1_BASE_CAP = 1_000_000;

// ~25 rungs = "effectively infinite" for a doubling track (2^25 * 1M ≈ 3.4e13 cap),
// satisfying design §3.3's "repeatable" cap upgrades. GENERATED by a loop (below),
// never hand-written, every rung is pure formula.
const WAREHOUSE_T1_RUNG_COUNT = 25;

// The cap at the START of level `level` (BEFORE that level's own doubling) =
// base * 2^level. Rung `level`'s material cost is 75% of this (design §3.3). Pure
// exact Decimal math: base * 2^level is an exact integer, and *3/4 is exact because
// base is divisible by 4.
function warehouseT1CapAtLevel(level: number): Decimal {
  return new Decimal(WAREHOUSE_T1_BASE_CAP).times(2 ** level);
}

// Builds T1's finite (~25-rung) doubling track. Rung i (level i -> i+1):
//   - materials: { commonOre: 75% of the cap at level i }, steep, scales with cap.
//   - durationTicks: escalating placeholder in the Refinery's ballpark, grows
//     linearly with level (20, 40, ... 500), TUNABLE, real balance at the device
//     checkpoint.
//   - effect: { storageCapMult: 2 }, doubles the tier cap (tierCap reads this).
//   - NO FA-level / talent / research / facility gate: T1 is the BASE tier,
//     available from level 0, so every rung is pure cost + time.
function buildWarehouseT1Upgrades(): FacilityUpgradeDef[] {
  const upgrades: FacilityUpgradeDef[] = [];
  for (let i = 0; i < WAREHOUSE_T1_RUNG_COUNT; i++) {
    upgrades.push({
      materials: { commonOre: warehouseT1CapAtLevel(i).times(3).div(4) }, // 75% of cap at level i
      durationTicks: 20 * (i + 1), // TUNABLE placeholder: 20, 40, ... 500 (Refinery ballpark)
      effect: { storageCapMult: 2 },
    });
  }
  return upgrades;
}

// T2 (design §3.3): the warehouse UNLOCKS for Titanium Ore, and its later rungs are priced in the T2 material
// (denseOre), which the Lunar Mine Contract's uncommon strike produces since WR-4 (OC-C2). tierCap uses
// BASE_CAP[2] (a 1M first-pass base, TBD with the balance pass).
export const WAREHOUSE_T2_BASE_CAP = 1_000_000; // STUB, real T2 base TBD

// T2 ships a MINIMAL track: rung 0 = unlock, then a few generated denseOre-priced rungs.
const WAREHOUSE_T2_RUNG_COUNT = 5;

function warehouseT2CapAtLevel(level: number): Decimal {
  return new Decimal(WAREHOUSE_T2_BASE_CAP).times(2 ** level);
}

// Builds T2's stub track:
//   - Rung 0 (level 0 -> 1) = the tier UNLOCK. Cost { commonOre: 1,000,000 } = 100%
//     of T1's default cap (design §3.3: "unlock = 100% of the previous tier's
//     default cap"). TIMED like every rung; payable with T1's own ore, so the
//     unlock itself is reachable today.
//   - Rungs 1+ = the cap upgrades, priced in denseOre (the T2 ore) at 75% of the T2 cap at
//     that level, the same "pay most of the cap you are about to double" shape as T1. Dense
//     Ore comes from the Lunar Mine Contract (WR-4, OC-C2).
function buildWarehouseT2Upgrades(): FacilityUpgradeDef[] {
  const upgrades: FacilityUpgradeDef[] = [];
  // Rung 0: unlock, paid in commonOre (100% of T1's default 1M cap).
  upgrades.push({
    materials: { commonOre: new Decimal(WAREHOUSE_T1_BASE_CAP) },
    durationTicks: 60, // TUNABLE placeholder (a T1-unlock-ballpark timed cost)
    effect: { storageCapMult: 2 },
  });
  // Rungs 1..N-1: the denseOre-priced cap upgrades.
  for (let i = 1; i < WAREHOUSE_T2_RUNG_COUNT; i++) {
    upgrades.push({
      materials: { denseOre: warehouseT2CapAtLevel(i).times(3).div(4) }, // 75% of T2 cap at level i
      durationTicks: 60 * (i + 1), // TUNABLE placeholder, escalating
      effect: { storageCapMult: 2 },
    });
  }
  return upgrades;
}

// --- Fuel Depot facility (WR-4, OC-C1: the FLEET REACH track; was the fuel tank + refinery) ----------------
// The facility KEY stays `fuelStorage` (the label is "Fuel Depot"). Since fuel-to-reach (0.13.6) fuel is a RANGE
// stat, not a stockpile; the user's OC-C1 answer (2026-10-16, "Turn into range") repurposes the Depot's levels
// into a FLEET REACH bonus: every built rung adds FUEL_DEPOT_REACH_PER_RUNG to every ship's reach (tick.ts
// fleetReachBonus + shipReachDef). The nine rungs keep the costs and durations the tank / refinery track had (so
// a save keeps the levels it built and each still counts), each now the same reach rung. ⚠️ FIRST-PASS TUNABLE.
const FUEL_DEPOT_RUNG_COSTS: readonly number[] = [375, 750, 1500, 2000, 3000, 3000, 3000, 6000, 12000]; // Titanium Ore
function buildFuelDepotUpgrades(): FacilityUpgradeDef[] {
  return FUEL_DEPOT_RUNG_COSTS.map((cost, i) => ({
    materials: { commonOre: new Decimal(cost) },
    durationTicks: 20 * (i + 1), // 20, 40, ... 180 (TUNABLE)
    effect: { fleetReachBonus: FUEL_DEPOT_REACH_PER_RUNG },
  }));
}

// --- Mission-control facility (Mission Rework Task 6, design §2) ------------
// The facility whose LEVEL unlocks missions. Unlike the Refinery (built from level
// 0) or the Warehouse/Fuel tanks (usable base at level 0), mission control is
// SEEDED at level 1 on a fresh save (freshState below) + on migrated saves (Task 9)
// so EVERY current mission is available from game start. That is the no-soft-lock /
// no-regression guarantee: a fresh fleet can dispatch all four missions immediately.
//
// USER REVISION 2026-07-14, UNLOCK UPGRADE DEFERRED. The directive was "4 missions
// should be the default" (all four current missions unlockLevel 1). The old level-1 ->
// 2 upgrade unlocked Salvage + Forage, but those are now default, and there are NO
// additional (5th+) missions built yet, so a LIVE level-1 -> 2 rung would unlock
// NOTHING = a placeholder. Per the no-placeholder discipline this file follows, that
// rung is DEFERRED (removed for now) and the facility CAPS at its current content
// (level 1, all four missions unlocked). The unlock MECHANISM is fully retained and
// ready (see below), it re-activates the moment additional missions exist.
//
// The track is FINITE (length 1) and caps at level 1, REAL content only:
//   - upgrades[0] (level 0 -> 1): the FOUNDING rung. It is PRE-GRANTED via the
//     level-1 seed, so a player never builds it in normal play. It is genuine
//     (ungated, zero-cost: a level-0 mission control would establish instantly), NOT
//     a placeholder, the same spirit as freshState pre-granting the starting captain
//     + hull instead of making the player build them. Its effect is the inert
//     `unlocksContent` marker (the missions it "grants" are derived from level via
//     MissionDef.unlockLevel, not from this effect). It is kept as the lone founding
//     rung so a level-1 facility reads as "fully upgraded" (upgrades[level] undefined).
//   - upgrades[1] (level 1 -> 2): DEFERRED. When a FUTURE mission batch lands, re-add
//     the completion-gated rung here (unlocking those new missions at unlockLevel 2),
//     wired to MISSION_CONTROL_UNLOCK_COMPLETIONS via requiresMissionCompletions, the
//     "earn it by playing" gate. The prereq TYPE (FacilityUpgradeDef.
//     requiresMissionCompletions) and its enforcement in canBuildFacilityUpgrade
//     (tick.ts) are RESERVED AND TESTED for exactly this, so re-adding the rung is a
//     pure data change, no engine work. See mission-control.test.ts's reserved-
//     mechanism coverage.
//
// UNLOCK THRESHOLD, RESERVED (not live today). The count of completions of EACH
// currently-available mission a FUTURE unlock rung will require. Retained ready for
// that deferred rung; first-pass tunable, same launch-placeholder discipline as every
// other numeric constant here. Real balance at the device checkpoint.
export const MISSION_CONTROL_UNLOCK_COMPLETIONS = 50;

// G1-3 (Short-Range Missions): the Mission Control BOARD rungs (call 8, user 2026-10-17 "Mission Control
// upgrades (Recommended)": two Tier I slots from the start, a Tier II slot at Mission Control level 2 through the kept
// 50-completion hook, a fourth at level 3). Each rung grants one board slot (addShortRangeSlot, its tier).
// HIDDEN UNTIL THE BOARD IS LIVE (the FIELD_KITS_PLAYER_LIVE precedent, user 2026-10-19 "Hide until Short-Range"):
// they join FACILITIES.missionControl only once SHORT_RANGE_BOARD_LIVE is true, so no player can build an upgrade
// whose slot no screen shows yet, and every facility reader, the sim and the registry are unchanged until then.
// shortRangeBoardSlots reads this table directly, so the slot ladder is live (and tested) at every level now.
// G1-6 flipped the flag with the board UI (2026-10-21); the Mission Control card names the slot each rung opens.
export const SHORT_RANGE_BOARD_LIVE = true;
// Every cost, duration and the fourth slot's tier (Tier II) approved 2026-10-20 (user "Approve (Recommended)":
// docs/plans/2026-10-19-merge-batch-answers.md). The level 1 -> 2 rung is the reserved completion-gated template kept
// for exactly this (MISSION_CONTROL_UNLOCK_COMPLETIONS of each ore run).
export const MISSION_CONTROL_BOARD_RUNGS: readonly FacilityUpgradeDef[] = [
  {
    materials: {},
    credits: new Decimal(2500),
    durationTicks: 120,
    effect: { addShortRangeSlot: 2 },
    requiresMissionCompletions: {
      shortOreRun: MISSION_CONTROL_UNLOCK_COMPLETIONS,
      longOreRun: MISSION_CONTROL_UNLOCK_COMPLETIONS,
    },
  },
  {
    materials: {},
    credits: new Decimal(6000),
    durationTicks: 240,
    effect: { addShortRangeSlot: 2 },
  },
];

// --- Subspace Telescope (Squads SQ-5, design section 6) -------------------------------
// The homeworld facility that pre-surveys candidate systems before launch (user-named, 3c):
// its RANGE is which regions it reads (nearer regions first; beyond range a system launches
// blind) and its DETAIL is how much it reads there (risk factors, then per body, then the
// squad recommendation and the forecast, SQ-6). Lore (user, 2026-10-12): each upgrade is a
// funded DEVELOPMENT CYCLE, paid for in the hope of finding a jump gate that was not destroyed.
//
// THE LADDER, ONE TABLE. Level 1 is the FOUNDING rung, pre-granted (freshState and the v68
// migration seed level 1, like the Research Lab and Mission Control), so Tier I is read from
// day one at Graded detail and the practice zone is never a blind launch. Each later row is
// the development cycle that REACHES that level.
// ⚠️ PROVISIONAL: every credits / ticks / FA-gate number (user #9: "we should ultimately
// revisit the credits", credit sinks need their own planning). The reach and detail columns
// follow the design's 6.2 table; detail is FLAT across the whole range (user #8 PROVISIONAL).
// Costs are CREDITS + an FA gate only (no materials, no talent gates: the Shipyard / Salvage
// Bay console rule, a gate the card cannot show is a trap). Credits step x2.5 and the FA gate
// +3, the Shipyard's own strides.
export interface SubspaceTelescopeLevelDef {
  level: number;            // the level this row REACHES
  credits: number;          // the development cycle's cost [PROVISIONAL]
  durationTicks: number;    // the cycle's length [PROVISIONAL]
  fleetAdminLevel: number;  // FA gate, 0 = none [PROVISIONAL]
  reachTier: number;        // the highest region tier read (1 Local Bubble .. 7 Galactic Core)
  detail: number;           // 0 Blind .. 5 Forecast (design 6.3)
}
export const SUBSPACE_TELESCOPE_LEVELS: readonly SubspaceTelescopeLevelDef[] = [
  { level: 1, credits: 0, durationTicks: 0, fleetAdminLevel: 0, reachTier: 1, detail: 2 },
  { level: 2, credits: 4_000, durationTicks: 120, fleetAdminLevel: 3, reachTier: 2, detail: 2 },
  { level: 3, credits: 10_000, durationTicks: 240, fleetAdminLevel: 5, reachTier: 2, detail: 3 },
  { level: 4, credits: 25_000, durationTicks: 420, fleetAdminLevel: 8, reachTier: 4, detail: 3 },
  { level: 5, credits: 60_000, durationTicks: 720, fleetAdminLevel: 11, reachTier: 4, detail: 4 },
  { level: 6, credits: 150_000, durationTicks: 1_200, fleetAdminLevel: 14, reachTier: 5, detail: 4 },
  { level: 7, credits: 375_000, durationTicks: 1_800, fleetAdminLevel: 17, reachTier: 6, detail: 5 },
  { level: 8, credits: 900_000, durationTicks: 2_700, fleetAdminLevel: 20, reachTier: 7, detail: 5 },
];

// The table as facility rungs (upgrades[i] reaches level i + 1). The founding row has no
// credits field and no FA gate, so the founding rung is ungated and free like Mission
// Control's; it is never built in normal play (pre-granted).
function buildSubspaceTelescopeUpgrades(): FacilityUpgradeDef[] {
  return SUBSPACE_TELESCOPE_LEVELS.map((row) => ({
    materials: {},
    ...(row.credits > 0 ? { credits: new Decimal(row.credits) } : {}),
    durationTicks: row.durationTicks,
    effect: { telescope: { reachTier: row.reachTier, detail: row.detail } },
    ...(row.fleetAdminLevel > 0 ? { requiresFleetAdminLevel: row.fleetAdminLevel } : {}),
  }));
}

// Research Lab and Fabricator tiers III to VII (complement plan OC-15).
// User 2026-10-16 (OC-15): "Add tiers 3-7 now (Recommended)": the Research Lab gains levels 3 to 7 in 0.14.0 (drive
// classes II to VII, top modules); user 2026-10-21: "Build them in 0.14.0 (Recommended)". The Fabricator is the Lab's
// direct clone (a level-derived tier gate plus a summed slot grant), so it climbs the same ladder: a tier N blueprint
// needs Lab level N to research and Fabricator level N to craft.
//
// ONE TABLE, one row per tier: the rung that REACHES that level, on both tracks. Every rung is real the moment it is
// built: it grants one more slot (research or craft, the pattern every rung of both tracks has always carried), and
// it opens that tier's blueprints. Tier III to VII content rides this ladder by its blueprint `tier` alone: the
// classed drives (G2-4, Class N on tier N, joining BLUEPRINTS once both tracks reach the tier), the gas giant special
// blueprints (GG-7), the top crew modules (CP-11 Flag Command / Elite Quarters, EM-7), and the identification lanes
// Relics v2 reads off the Lab level (R2-3: I 1, III 2, V 3, VII 4) through labTier.
//
// The Fabricator's tier III row is the rung it already had (Crafting 0.13.3 FIX B, its third craft line), unchanged:
// 20,000 credits / 240 ticks / FA 6. Each later row steps credits x2.5 and the FA gate +3 (the Shipyard's and the
// Subspace Telescope's strides) and lengthens on the telescope's duration ladder.
// APPROVED (user 2026-10-21, "Costs OK, +1 slot each (Recommended)"): every credits / ticks / FA number and the
// one-slot grant per rung, as built (the balancing patch may retune). Costs are credits plus an FA gate only, the gates both Upgrades panels show (no
// materials, no talent gates: a gate the card cannot show is a trap).
export interface LabFabricatorTierRungDef {
  tier: number;            // the level this row REACHES on both tracks (3 .. 7)
  credits: number;
  durationTicks: number;
  fleetAdminLevel: number; // FA gate
  researchSlots: number;   // the Lab rung's slot grant
  fabricateSlots: number;  // the Fabricator rung's slot grant
}
export const LAB_FABRICATOR_TIER_RUNGS: readonly LabFabricatorTierRungDef[] = [
  { tier: 3, credits: 20_000, durationTicks: 240, fleetAdminLevel: 6, researchSlots: 1, fabricateSlots: 1 },
  { tier: 4, credits: 50_000, durationTicks: 420, fleetAdminLevel: 9, researchSlots: 1, fabricateSlots: 1 },
  { tier: 5, credits: 125_000, durationTicks: 720, fleetAdminLevel: 12, researchSlots: 1, fabricateSlots: 1 },
  { tier: 6, credits: 300_000, durationTicks: 1_200, fleetAdminLevel: 15, researchSlots: 1, fabricateSlots: 1 },
  { tier: 7, credits: 750_000, durationTicks: 1_800, fleetAdminLevel: 18, researchSlots: 1, fabricateSlots: 1 },
];
// The highest blueprint tier either track serves (both tracks end on the table's last row).
export const LAB_FABRICATOR_TOP_TIER = LAB_FABRICATOR_TIER_RUNGS[LAB_FABRICATOR_TIER_RUNGS.length - 1].tier;
function labTierRung(row: LabFabricatorTierRungDef): FacilityUpgradeDef {
  return { materials: {}, credits: new Decimal(row.credits), durationTicks: row.durationTicks, effect: { addResearchSlots: row.researchSlots }, requiresFleetAdminLevel: row.fleetAdminLevel };
}
function fabricatorTierRung(row: LabFabricatorTierRungDef): FacilityUpgradeDef {
  return { materials: {}, credits: new Decimal(row.credits), durationTicks: row.durationTicks, effect: { addFabricateSlots: row.fabricateSlots }, requiresFleetAdminLevel: row.fleetAdminLevel };
}

export const FACILITIES: Record<string, FacilityDef> = {
  refinery: {
    label: "Refinery",
    upgrades: [
      // [0] Level 0 -> 1: BUILD / unlock. Ungated (material cost only). Grants the
      // first refine slot, building the refinery is what lets it run one job.
      {
        materials: { commonOre: new Decimal(100) },
        durationTicks: 20,
        effect: { addRefineSlots: 1 },
      },
      // [1] Level 1 -> 2: a second refine line. First FA-level gate.
      {
        materials: { commonOre: new Decimal(750) },
        durationTicks: 45,
        effect: { addRefineSlots: 1 },
        requiresFleetAdminLevel: 2,
      },
      // [2] Level 2 -> 3: a third line. Costs titaniumIngot (the refinery's own
      // output) + a higher FA gate + the Industry hub talent. (ITEM-MERGE 0.11.0
      // Task A1: was refinedMaterial, repointed 1:1 to titaniumIngot when the two
      // refined-titanium items were merged; effective cost drops because
      // titaniumIngot refines cheaper per unit, an accepted first-pass balance shift.)
      {
        materials: { commonOre: new Decimal(3000), titaniumIngot: new Decimal(25) },
        durationTicks: 90,
        effect: { addRefineSlots: 1 },
        requiresFleetAdminLevel: 5,
        requiresHomeworldTalents: ["industryHub"],
      },
      // [3] Level 3 -> 4: automation. Grants a refine SPEED multiplier (not a slot),
      // exercising the other FacilityUpgradeEffect kind. Track ENDS here (finite).
      // (ITEM-MERGE 0.11.0 Task A1: refinedMaterial repointed 1:1 to titaniumIngot.)
      {
        materials: { commonOre: new Decimal(8000), titaniumIngot: new Decimal(75) },
        durationTicks: 180,
        effect: { refineSpeedMult: 1.5 },
        requiresFleetAdminLevel: 8,
        requiresHomeworldTalents: ["industryHub"],
      },
    ],
  },
  // Phase 2, Task B2: Tier I Warehouse, available from the START at level 0 (cap
  // 1,000,000; no unlock needed, T1 is the base tier). ~25 GENERATED doubling rungs
  // (see buildWarehouseT1Upgrades above). tierCap(state, 1) derives the live cap.
  warehouseT1: {
    label: "Warehouse (Tier I)",
    upgrades: buildWarehouseT1Upgrades(),
  },
  // Phase 2, Task B2: Tier II Warehouse. Level 0 = locked; rung 0 unlocks it for 1,000,000
  // commonOre, and the later rungs cost the T2 ore (denseOre, from the Lunar Mine Contract
  // since WR-4). See buildWarehouseT2Upgrades above.
  warehouseT2: {
    label: "Warehouse (Tier II)",
    upgrades: buildWarehouseT2Upgrades(),
  },
  // The Fuel Depot (KEY `fuelStorage`): the FLEET REACH track since WR-4 (OC-C1). See buildFuelDepotUpgrades above;
  // tick.ts fleetReachBonus derives the live bonus from this facility's level.
  fuelStorage: {
    label: "Fuel Depot",
    upgrades: buildFuelDepotUpgrades(),
  },
  // Mission Rework Task 6: Mission Control, SEEDED at level 1 (freshState +
  // migration) so ALL FOUR current missions are available from game start (no
  // soft-lock). missionUnlocked (tick.ts) derives which missions are dispatchable
  // from this facility's level via MissionDef.unlockLevel (all four are unlockLevel 1).
  //
  // USER REVISION 2026-07-14: the level-1 -> 2 unlock UPGRADE is DEFERRED (see the
  // block above). The track caps at its current content (level 1), a lone founding
  // rung, NO live unlock rung, because there are no additional missions for it to
  // unlock yet (a live rung unlocking nothing would be a placeholder). Re-add the
  // completion-gated upgrades[1] rung (template preserved in the block above) when a
  // future mission batch lands.
  missionControl: {
    label: "Mission Control",
    upgrades: [
      // [0] Level 0 -> 1: FOUNDING rung (pre-granted at the level-1 seed; never built
      // in normal play). Ungated, zero-cost. Inert `unlocksContent` effect: the four
      // missions it conceptually establishes are level-derived (unlockLevel 1), not
      // summed here. As the LONE rung, a level-1 facility has no next rung
      // (upgrades[1] === undefined) so canBuildFacilityUpgrade reports "fully
      // upgraded", the maxed-at-current-content state the UI renders.
      {
        materials: {},
        durationTicks: 0,
        effect: { unlocksContent: true },
      },
      // [1] Level 1 -> 2: DEFERRED (USER REVISION 2026-07-14). The former completion-
      // gated rung unlocked Salvage + Forage, which are now default (unlockLevel 1),
      // so a live rung here would unlock nothing. When future missions are added,
      // re-add the rung here, e.g.:
      //   {
      //     materials: { commonOre: new Decimal(250) },   // first-pass placeholder
      //     durationTicks: 60,                            // first-pass placeholder
      //     effect: { unlocksContent: true },
      //     requiresMissionCompletions: {                 // reserved mechanism (tick.ts)
      //       shortOreRun: MISSION_CONTROL_UNLOCK_COMPLETIONS,
      //       longOreRun: MISSION_CONTROL_UNLOCK_COMPLETIONS,
      //     },
      //   },
      // The requiresMissionCompletions prereq TYPE + its canBuildFacilityUpgrade
      // enforcement stay in place and tested (mission-control.test.ts), so this is a
      // pure data re-add with no engine work.
      // G1-3: that rung is now MISSION_CONTROL_BOARD_RUNGS[0] (a Tier II short-range board slot), followed by the
      // level 2 -> 3 rung (a fourth slot); both join here once SHORT_RANGE_BOARD_LIVE (G1-6).
      ...(SHORT_RANGE_BOARD_LIVE ? MISSION_CONTROL_BOARD_RUNGS : []),
    ],
  },
  // --- Research Lab (Task R2, design §1) --------------------------------------
  // The facility whose LEVEL gates which blueprint TIERS are researchable + how many
  // research SLOTS run in parallel. It combines TWO established patterns:
  //   - SEEDED AT LEVEL 1 like Mission Control (freshState below): tier-1 blueprints
  //     are researchable from game start (blueprintResearchable reads level >= tier),
  //     so there is no soft-lock, a fresh fleet can research immediately.
  //   - RUNGS CARRY A REAL SLOT GRANT like the Refinery: each rung's { addResearchSlots }
  //     effect is SUMMED across reached rungs by researchSlotCount (tick.ts), exactly as
  //     refineSlotCount sums { addRefineSlots }. The blueprint-TIER unlock is level-
  //     derived (not summed), the same way missionUnlocked derives missions from level.
  //
  // FINITE track that CAPS at real content: only blueprint tiers 1 and 2 exist today
  // (BLUEPRINTS), so the track has exactly TWO rungs (level 1 and level 2). NO rung
  // beyond tier 2, adding one would be a placeholder that unlocks nothing, against
  // this file's no-placeholder discipline. A future blueprint tier re-extends the track
  // additively (one more rung), mirroring how the Refinery/Warehouse tracks grow.
  //
  // COST MODEL, CREDITS, NOT MATERIALS (locked brainstorm decision #3 + design §6:
  // "Cost = time + CREDITS. No materials. ... credits get a real long-term sink"). The
  // level 1->2 rung is gated on `credits` (the OPTIONAL FacilityUpgradeDef field R2
  // added) + an FA-level prereq (mirroring the Refinery's requiresFleetAdminLevel idiom).
  // ⚠️ FIRST-PASS TUNABLE values (credits/duration/FA-level), same launch-placeholder
  // spirit as every other table here, real balance at the device checkpoint.
  //
  // NAME "Research Lab" is PROVISIONAL (design §1 open question, user may rename to
  // "Research Division" etc.; the KEY `research`/RESEARCH_FACILITY_KEY is stable and a
  // rename touches only this label).
  research: {
    label: "Research Lab",
    upgrades: [
      // [0] Level 0 -> 1: the FOUNDING rung. PRE-GRANTED via the level-1 freshState seed
      // (never built in normal play), so it is ungated + zero-cost + zero-duration --
      // the SAME founding-rung posture as Mission Control's. Its effect grants the FIRST
      // research slot (researchSlotCount sums it -> 1 at level 1), exactly as the
      // Refinery's level 0->1 build grants its first refine slot. Establishing the lab
      // (reaching level 1) is ALSO what makes tier-1 blueprints researchable (level >= 1),
      // but that is derived from the LEVEL, not from this effect.
      {
        materials: {},
        durationTicks: 0,
        effect: { addResearchSlots: 1 },
      },
      // [1] Level 1 -> 2: the REAL upgrade rung. Reaching level 2 unlocks TIER-2
      // blueprints (blueprintResearchable: tier 2 <= level 2) AND grants a 2nd research
      // slot (researchSlotCount sums to 2). Gated on CREDITS (the design's long-term
      // sink, NO materials) + a modest FA-level prereq. ⚠️ FIRST-PASS TUNABLE
      // credits/duration/FA-level.
      {
        materials: {}, // locked design #3: NO materials on research costs
        credits: new Decimal(5000), // the tier-2 unlock's credit sink (tunable)
        durationTicks: 120, // matches the tier-2 blueprint's research duration (tunable)
        effect: { addResearchSlots: 1 },
        requiresFleetAdminLevel: 3, // modest gate, mirrors the Refinery's FA-level idiom (tunable)
      },
      // [2..6] Levels 3 to 7 (OC-15): one rung per row of LAB_FABRICATOR_TIER_RUNGS, each a research slot plus
      // that tier's blueprints. The track ENDS at LAB_FABRICATOR_TOP_TIER.
      ...LAB_FABRICATOR_TIER_RUNGS.map(labTierRung),
    ],
  },
  // --- Fabricator (Phase 4, F1, design §1) -----------------------------------
  // The facility whose LEVEL gates which blueprint TIERS are fabricable + how many
  // craft SLOTS run in parallel. A DIRECT CLONE of the Research Lab's shape (a level-
  // derived tier gate + a summed slot grant), differing only in the effect field it
  // carries (addFabricateSlots) and the fact that the CRAFT cost is materials + time,
  // never credits, but the UPGRADE rungs, like every other facility's, cost credits.
  //   - SEEDED AT LEVEL 1 like the Research Lab / Mission Control (freshState below):
  //     tier-1 blueprints are fabricable from game start once researched (fabricable
  //     when level >= tier), so there is no soft-lock.
  //   - RUNGS CARRY A REAL SLOT GRANT like the Refinery / Research Lab: each rung's
  //     { addFabricateSlots } effect is SUMMED across reached rungs by fabricateSlotCount
  //     (tick.ts), exactly as researchSlotCount sums { addResearchSlots }. The blueprint-
  //     TIER unlock is level-derived (not summed), the same way the Research Lab derives
  //     researchable tiers from its level.
  //
  // TRACK LENGTH: SEVEN rungs (levels 1 to 7). Levels 1 to 3 matched the Refinery's three
  // parallel production lines (FIX B below); levels 4 to 7 are the OC-15 tier rungs
  // (LAB_FABRICATOR_TIER_RUNGS, user 2026-10-16 / 2026-10-21), each a craft slot plus
  // that tier's blueprints.
  //
  // ⚠️ REVISED IN CRAFTING 0.13.3 (Unit 3.1b, FIX B), OWNER BALANCE CALL. This block
  // used to read "NO rung beyond tier 2, adding one would be a placeholder that unlocks
  // nothing". That reasoning tied the track's LENGTH to the blueprint TIER ladder, which
  // was the wrong axis: the rungs carry a slot grant as well as a tier unlock, and a
  // SLOT is real content whether or not a new tier exists. The consequence of the old
  // reading was a lopsided economy, the Refinery ran three refine lines while the
  // Fabricator ran two, and Unit 3.1's worked proof (craftingProgress.test.ts, design
  // 6.4) tripped over exactly that: the design had priced the fabricate route at three
  // slots. The owner's call was to make the Fabricator consistent with the Refinery, so
  // rung [2] below grants a THIRD craft slot and unlocks no tier at all (harmless: the
  // tier gate is `tier <= level`, so a level-3 Fabricator simply clears both existing
  // tiers with room to spare, exactly as a level-4 Refinery clears its recipes).
  //
  // Still FINITE and still additive: OC-15 extended it to tier VII, one rung per tier, on
  // the same table as the Research Lab's tier rungs.
  //
  // COST MODEL, upgrade rungs cost CREDITS (the OPTIONAL `credits` FacilityUpgradeDef
  // field, the SAME gate the Research rungs use), NOT materials (materials are the CRAFT
  // cost, spent by the fabricate engine in F2). ⚠️ FIRST-PASS TUNABLE values
  // (credits/duration/FA-level), same launch-placeholder spirit as the Research Lab.
  fabricator: {
    label: "Fabricator",
    upgrades: [
      // [0] Level 0 -> 1: the FOUNDING rung. PRE-GRANTED via the level-1 freshState seed
      // (never built in normal play), so it is ungated + zero-cost + zero-duration, the
      // SAME founding-rung posture as the Research Lab's. Its effect grants the FIRST
      // craft slot (fabricateSlotCount sums it -> 1 at level 1). Reaching level 1 is ALSO
      // what makes TIER-1 blueprints fabricable (level >= 1), but that is derived from the
      // LEVEL, not from this effect.
      {
        materials: {},
        durationTicks: 0,
        effect: { addFabricateSlots: 1 },
      },
      // [1] Level 1 -> 2: the REAL upgrade rung. Reaching level 2 unlocks TIER-2
      // blueprints (fabricable: tier 2 <= level 2) AND grants a 2nd craft slot
      // (fabricateSlotCount sums to 2). Gated on CREDITS (the SAME optional gate the
      // Research rungs use) + a modest FA-level prereq. NO materials (materials are the
      // per-craft cost, not the upgrade cost). ⚠️ FIRST-PASS TUNABLE credits/duration/
      // FA-level.
      {
        materials: {},
        credits: new Decimal(5000), // the tier-2 unlock's credit sink (tunable)
        durationTicks: 120, // tunable
        effect: { addFabricateSlots: 1 },
        requiresFleetAdminLevel: 3, // modest gate, mirrors the Research Lab's idiom (tunable)
      },
      // [2] Level 2 -> 3: the THIRD craft line (Crafting 0.13.3 Unit 3.1b, FIX B, owner
      // balance call). Grants a 3rd { addFabricateSlots }, the SAME count the Refinery's
      // three addRefineSlots rungs reach, and (since OC-15) opens tier III blueprints.
      // Since OC-15 it is LAB_FABRICATOR_TIER_RUNGS' tier III row, generated with the
      // rows after it (the values below are that row's, unchanged; labFabricatorTiersGoldens
      // golden 1 proves the rung byte-identical).
      //
      // SCALING, taken from the SHAPE of how the REFINERY's third slot rung steps over
      // its second, so the two production facilities read as one system rather than two:
      //   Refinery [1] -> [2] : materials 750 -> 3000 (4x), duration 45 -> 90 (2x),
      //                         FA level 2 -> 5 (+3).
      //   Fabricator [1] -> [2]: credits  5000 -> 20000 (4x), duration 120 -> 240 (2x),
      //                         FA level 3 -> 6 (+3).
      // The COST CURRENCY stays CREDITS, not materials, because that is this facility's
      // own cost model (materials are the per-craft cost, spent by the fabricate engine);
      // only the shape of the step is borrowed.
      //
      // ⚠️ NO requiresHomeworldTalents, DELIBERATELY, even though the Refinery's third
      // slot rung carries `industryHub`. Two reasons, the second decisive:
      //   1. This track's gates are credits + FA level and nothing else, matching its two
      //      existing rungs and the Research Lab's. The FA-6 wall plus 4x credits already
      //      carries the "this is the late investment" weight on its own.
      //   2. The Fabricator's Upgrades panel (App.svelte) renders material rows and the
      //      Fleet-Admiral-level row, but has NO requiresHomeworldTalents row (only the
      //      Refinery's panel has one). canBuildFacilityUpgrade WOULD enforce the talent,
      //      so the rung would be gated by something the panel never states: the reason
      //      appears only in the MOUSE-HOVER popover on the disabled button, which is
      //      invisible on touch. That is a "why can't I build this" trap, and shipping a
      //      data gate whose UI does not exist yet is worse than shipping no gate.
      // If the owner wants the talent gate, it is one field here PLUS the six-line talent
      // row copied from the Refinery's panel, and those belong together in one change.
      //
      // ⚠️ FIRST-PASS TUNABLE, like every number on this track. The owner has said a
      // dedicated balance pass (post-exploration, around 0.16.0) will retune everything,
      // time inflation included, so these are a coherent starting point and not a verdict.
      //   credits 20000 (4x rung [1], the Refinery's third-rung cost step), duration 240
      //   (2x rung [1]), FA 6 (+3 over rung [1]).
      // [3..6] Levels 4 to 7 (OC-15): the table's later rows. The track ENDS at
      // LAB_FABRICATOR_TOP_TIER.
      ...LAB_FABRICATOR_TIER_RUNGS.map(fabricatorTierRung),
    ],
  },
  // --- Shipyard (Phase 5, Task S1, design §2) --------------------------------
  // The Fleet-Sector facility that BUILDS hulls from a component BOM + credits over a
  // timed construction (the build ENGINE lands in S3). Owner is FLEET-SECTOR, expressed
  // the SAME way research/fabricator express it: there is NO `owner` field on FacilityDef
  // (see the interface above, only `label` + `upgrades`); the House/Sector grouping is
  // a UI-SIDE concern (App.svelte's rails), so nothing is set here for it.
  //
  // ⚠️ DIFFERS from research/fabricator on ONE axis: those seed at level 1 (established
  // from game start), but the Shipyard seeds at level 0, LOCKED / unfounded (freshState
  // below). So its FOUNDING rung (level 0->1) is a REAL, BUILDABLE unlock, gated on
  // credits + Fleet-Admiral level (NO materials), the SAME credits+FA-level gate shape
  // research/fabricator put on their level 1->2 rung, just moved to the founding rung
  // because establishing the Shipyard is the deliberate unlock (locked brainstorm #3).
  //
  // FINITE track: a founding rung + a first-pass build-SPEED track (two { buildSpeedMult }
  // rungs) + two BERTH rungs (Shipyard Berths, 2026-09-06). Refit is a FUTURE rung on this
  // same track (hooked, not built, design §2/§7). ⚠️ FIRST-PASS TUNABLE values
  // (credits/duration/FA-level/mult), same launch-placeholder spirit as the Research Lab /
  // Fabricator tracks, real balance at the device checkpoint.
  //
  // ⚠️⚠️ THE BERTH RUNGS ARE AN EXTENSION, NOT A REWRITE, AND THE REASON IS A HAZARD.
  // Bays ARE this facility's LANES (design section 15a), and they were the one lane count in
  // the game a player could not deliberately buy: shipyardBayCount grants +1 bay per reached
  // { buildSpeedMult } rung, so a bay arrived as an unannounced side effect of buying SPEED.
  // Rungs [3] and [4] are the bays a player CHOOSES. The speed rungs KEEP granting theirs.
  //
  // Restructuring the track so bays came only from the new rungs was the cleaner shape and was
  // REJECTED: every existing save's bay count is derived from the rungs it has already bought,
  // so re-homing the grant would hand a level-3 shipyard fewer bays than it had on the previous
  // load. Fewer bays can strand a running build, shrink repair capacity and destroy purchased
  // progress, and the only way to avoid it would be a migration that pays the difference back,
  // i.e. new persisted state and a SAVE_VERSION bump, to reach a state the additive shape
  // reaches with neither. See shipyardBayCount (tick.ts) and the never-fewer-bays proof in
  // ship-repair.test.ts, which asserts the new count >= the old count at EVERY level.
  //
  // ⚠️ NOT A REPAIR/CONSTRUCTION BERTH SPLIT (owner scope, 2026-09-06, verbatim: "Not the
  // repair/construction options, but multiple lanes, and queuing"). Bays stay ONE SHARED POOL
  // serving both builds and repairs, exactly as they do today. A dedicated repair-only track
  // is logged in SUGGESTIONS.md as a separate future decision; no rung here may split the pool.
  //
  // ⚠️ LANES ARE NOT QUEUE DEPTH (design section 15a rule 2, LOCKED). The Shipyard's queue
  // depth comes from the Homeworld fleetLogisticsQueue talents and is never multiplied by the
  // bay count. No rung here may ever grant depth.
  shipyard: {
    label: "Shipyard",
    upgrades: [
      // [0] Level 0 -> 1: the FOUNDING rung, a REAL buildable unlock (NOT pre-granted;
      // freshState seeds level 0). Gated on credits + an FA-level prereq, NO materials
      // (mirrors the research/fabricator credit-rung shape). Its effect is the inert
      // `unlocksContent` level-bump marker (like Mission Control's founding rung): what
      // establishing the Shipyard enables (building hulls) derives from the LEVEL being
      // >= 1, NOT from a summed/multiplied stat, so the founding rung carries no
      // buildSpeedMult (build-speed bonuses start on the LATER rungs). Reaching level 1
      // gives the baseline 1.0x build speed (the S3 engine's product over zero mult rungs).
      {
        materials: {}, // NO materials on the founding rung this pass (mirrors research)
        credits: new Decimal(2000), // founding credit sink (tunable)
        durationTicks: 60, // founding build time (tunable)
        effect: { unlocksContent: true },
        requiresFleetAdminLevel: 3, // FA-level founding gate, mirrors research/fabricator (tunable)
      },
      // [1] Level 1 -> 2: first build-SPEED upgrade. Carries { buildSpeedMult } (the S3
      // engine divides a hull's durationTicks by the product of reached rungs' mults ->
      // faster builds). Gated on credits (the SAME long-term credit sink research/
      // fabricator use) + a modest FA-level prereq. NO materials.
      {
        materials: {},
        credits: new Decimal(8000), // tunable
        durationTicks: 180, // tunable
        effect: { buildSpeedMult: 1.5 }, // 1.5x build speed (tunable)
        requiresFleetAdminLevel: 5, // tunable
      },
      // [2] Level 2 -> 3: second build-SPEED upgrade, and the LAST rung that carries a bay
      // as a side effect. Stacks multiplicatively on rung [1] (1.5 * 2.0 = 3.0x at level 3,
      // per the S3 product derivation).
      {
        materials: {},
        credits: new Decimal(20000), // tunable
        durationTicks: 300, // tunable
        effect: { buildSpeedMult: 2.0 }, // tunable
        requiresFleetAdminLevel: 8, // tunable
      },
      // [3] Level 3 -> 4: the FIRST BERTH the player buys ON PURPOSE (Shipyard Berths,
      // 2026-09-06). A fifth bay: one more hull building or repairing at the same time.
      //
      // COST SHAPE, and why these numbers: the STEP is this track's own, continued rather
      // than a new one. Credits step by 2.5x, which is the step rung [1] -> rung [2] takes
      // (8,000 -> 20,000). Duration steps by +120 ticks, which is the step rung [1] -> rung
      // [2] takes (180 -> 300). The FA gate steps by +3, which is the step rung [1] -> rung
      // [2] takes (5 -> 8) and the same step the Salvage Bay's two lane rungs take (3 -> 6),
      // so a lane costs an admiral-level stride at both facilities. CREDITS, NO MATERIALS,
      // matching every other rung on this track and the Salvage Bay's lane rungs: the
      // Shipyard's whole cost column is credits, and charging hull materials to widen the yard
      // would tax the same stock the yard is about to spend on a hull.
      //
      // ⚠️ NO requiresHomeworldTalents, the same reason FACILITIES.salvageBay and
      // FACILITIES.fabricator record: this console renders material rows, a credits row and
      // an FA-level row, and no talent row, so a talent gate would be ENFORCED while being
      // stated nowhere the player can see. That is a "why can't I build this" trap.
      {
        materials: {},
        credits: new Decimal(50000), // 2.5x rung [2], this track's own credit step (tunable)
        durationTicks: 420, // +120 over rung [2], this track's own duration step (tunable)
        effect: { addShipyardBays: 1 },
        requiresFleetAdminLevel: 11, // +3 over rung [2] (tunable)
      },
      // [4] Level 4 -> 5: the SECOND bought berth, a sixth bay, and the END of the track
      // (finite; refit is a future rung). TWO berth rungs, not one and not five, matching the
      // Salvage Bay's two lane rungs: two is enough for the axis to read as a real choice
      // without the yard quietly becoming the cheapest place to park unlimited concurrency.
      // Same steps again (2.5x credits, +120 ticks, +3 FA).
      //
      // ⚠️ EXTRA BAYS RAISE REPAIR CONCURRENCY, NOT BUILD CONCURRENCY, and that is correct
      // rather than a shortfall. shipBuildSlotCount is min(BUILD_CONCURRENCY_CAP,
      // bayCount - 1), and BUILD_CONCURRENCY_CAP is deliberately held at 1 (owner directive),
      // so a sixth bay means six hulls can be under repair at once while builds stay at one.
      // Raising the build cap is the SEPARATE owner decision the cap comment describes; when
      // it is raised, these rungs are what the extra builds run in.
      {
        materials: {},
        credits: new Decimal(125000), // 2.5x rung [3] (tunable)
        durationTicks: 540, // +120 over rung [3] (tunable)
        effect: { addShipyardBays: 1 },
        requiresFleetAdminLevel: 14, // +3 over rung [3] (tunable)
      },
    ],
  },
  // --- Salvage Bay (Salvage Lanes, 2026-09-04, design section 15d "Adding LANES") ------
  // The bay that breaks spare ship systems, salvaged materials and whole hulls down. It ran
  // exactly ONE job at a time from the day it shipped, because it was the one production
  // facility with no level track at all and therefore no rungs to sum. This entry is that
  // level track, and it sells ONE thing: LANES.
  //
  // ⚠️⚠️ THE RULE THAT GOVERNS THIS WHOLE TRACK: LEVEL 0 IS A FULLY WORKING, ONE-LANE
  // SALVAGE BAY. There is NO founding rung here and there must never be one. Every existing
  // player already has this bay, uses it, and may have salvage jobs queued and in flight in
  // it right now; a rung [0] that "founds" the facility would mean every save in existence
  // loading with its Salvage Bay taken away, its queued orders unreachable and its in-flight
  // teardowns stranded. Rungs on this track may ONLY ADD lanes on top of the base one.
  //   - level 0 -> 1 lane   (SALVAGE_BAY_BASE_SLOTS, granted by nothing, owed to everyone)
  //   - level 1 -> 2 lanes  (rung [0])
  //   - level 2 -> 3 lanes  (rung [1], track ENDS here)
  // The precedent is the Fuel Depot, whose tank is usable at level 0 and whose rungs only
  // expand it, and the Shipyard's SHIPYARD_BAY_BASE floor. It is the deliberate OPPOSITE of
  // the Refinery's and the Shipyard's founding rungs. See salvageSlotCount (tick.ts).
  //
  // ⚠️ LANES ONLY, NO SPEED RUNGS, DELIBERATELY DEFERRED. A speed rung was floated at the
  // same time as lanes and is NOT built here: salvage durations were just retuned (the base
  // job moved to 60 ticks on 2026-09-04), and a second throughput lever landing on the same
  // track in the same pass would make it impossible to tell which knob produced a bad feel.
  // Speed needs its own design pass against the retuned durations. The track is finite and
  // extends additively, exactly as the Refinery's mixed slot+speed track does, so adding a
  // { salvageSpeedMult } rung later is a data change plus one derive-on-read helper.
  //
  // ⚠️ LANES ARE NOT QUEUE DEPTH (design section 15a, LOCKED). Depth is bought with the
  // Homeworld fleetLogisticsQueue talents, applies PER FACILITY, and is never multiplied by
  // the lane count. A player with 3 lanes and one depth talent runs 3 salvages at once with
  // 2 orders parked behind them. No rung here may ever grant depth.
  //
  // COST MODEL: CREDITS + an FA-level gate, NO materials. Three reasons, in order:
  //   1. The bay exists to RELIEVE a full pool (it is the shipped equipment-cap escape
  //      valve). Charging materials to widen it would tax the very stock a player is trying
  //      to clear, which is the softlock instinct coming back in through the cost column.
  //   2. Credits are this game's designed long-term sink (the Research Lab's locked cost
  //      decision), and the bay's own hull-teardown arm PAYS credits, so the facility funds
  //      its own expansion. That is a legible loop rather than an arbitrary price.
  //   3. It matches the three most recent facility tracks (Research, Fabricator, Shipyard),
  //      so the Foundry reads as one economy.
  //
  // ⚠️ NO requiresHomeworldTalents, for the SAME reason FACILITIES.fabricator's third-slot
  // rung records: the Upgrades panels render material rows, a credits row and the
  // Fleet-Admiral-level row, but only the Refinery's panel renders a talent row. A talent
  // gate here WOULD be enforced by canBuildFacilityUpgrade while being stated nowhere the
  // player can see on touch, which is a "why can't I build this" trap.
  //
  // ⚠️ THE NUMBERS ARE THE FABRICATOR'S TWO PAID RUNGS, VERBATIM, and that is the point of
  // the choice rather than laziness: lanes cost the same at the Salvage Bay as they do at
  // the Fabricator, so neither facility is the obviously-correct first purchase and the
  // ceiling matches (3 concurrent jobs, the same ceiling the Refinery's three
  // addRefineSlots rungs and the Fabricator's three addFabricateSlots rungs reach). The
  // Salvage Bay reaches it from a FREE base rather than from a bought founding rung, which
  // is why it needs two rungs where the Fabricator needs two on top of a seeded level 1.
  // ⚠️ FIRST-PASS TUNABLE, like every number in this table; the owner's dedicated balance
  // pass (post-exploration, around 0.16.0) retunes all of it.
  salvageBay: {
    label: "Salvage Bay",
    upgrades: [
      // [0] Level 0 -> 1: the SECOND lane. The bay chews two teardowns at once.
      // Matches FACILITIES.fabricator rung [1] (5,000 credits / 120 ticks / FA 3).
      {
        materials: {}, // credits are this track's whole cost, see the cost-model note above
        credits: new Decimal(5000),
        durationTicks: 120,
        effect: { addSalvageSlots: 1 },
        requiresFleetAdminLevel: 3,
      },
      // [1] Level 1 -> 2: the THIRD lane, and the end of the track. Matches
      // FACILITIES.fabricator rung [2] (20,000 credits / 240 ticks / FA 6), i.e. 4x the
      // credits, 2x the duration and +3 FA levels over the rung before it, which is the
      // step SHAPE the Refinery's third-slot rung established.
      {
        materials: {},
        credits: new Decimal(20000),
        durationTicks: 240,
        effect: { addSalvageSlots: 1 },
        requiresFleetAdminLevel: 6,
      },
    ],
  },
  // --- Subspace Telescope (Squads SQ-5): see SUBSPACE_TELESCOPE_LEVELS above. Pre-granted at
  // level 1; each later rung is one funded development cycle (a timed facilityUpgrade process,
  // no new mechanism). telescope.ts reads the reached rungs. The Facilities card is SQ-7.
  subspaceTelescope: {
    label: "Subspace Telescope",
    upgrades: buildSubspaceTelescopeUpgrades(),
  },
};

// --- Refine / Fabricate orders (RETIRED, Crafting Allocation Redesign Task C4) -----
// The single standing-order model (RefineOrder / FabricateOrder + their RefineOrderMode
// / FabricateOrderMode unions, and the GameState.refineOrder / fabricateOrder fields)
// was REMOVED here. The per-slot production LINES (refineLines / fabricateLines below,
// typed CraftLine[] from allocation.ts) fully replace it: independent lines, one per
// occupied facility slot, with material allocation DERIVED from the lines. See
// allocation.ts (CraftLineMode is the batch|continuous run-mode union the lines carry)
// and tick.ts (startLine / cancelLine / processRefineLines / processFabricateLines).
// C6's save migration drops any legacy refineOrder / fabricateOrder key off old saves.

// --- Crafting 0.13.3 (Phase 1 Unit 1.1): the queued-order SCHEMA ---------------
// docs/plans/2026-09-01-crafting-0.13.3-design.md §5.1 (data model) + §10 (save).
//
// SCHEMA ONLY IN THIS UNIT. These types and the four GameState fields below are
// DEFINED and SEEDED here and nothing reads them yet: the mutation API and the
// adapter table land in Unit 1.3, and the promotion pass that runs them inside
// economyTick lands in Unit 1.4. Landing the schema first is deliberate (the
// SAVE_VERSION bump is the one step every later unit depends on, and an additive
// migration is far safer to review on its own than bundled with engine behavior).

// The facilities that can hold a queue. A named union, not a bare string, so a
// future queue-capable facility slots in as ONE new literal and every exhaustive
// consumer (the Unit 1.3 QUEUE_ADAPTERS Record) turns into a COMPILE ERROR until it
// is handled, rather than silently missing a row. That property is exactly what drove
// the widening below: the compiler enumerated every site instead of a reader having to.
//
// ⚠️ WIDENED TO EVERY PRODUCTION FACILITY (0.13.3 queue-engine extension, 2026-09-04).
// The user's scope was always "all production facilities"; the first pass shipped three
// because those were the three the crafting release touched. The other three:
//   researchLab , a queued RESEARCH PROJECT. Costs time + credits, no materials.
//   shipyard    , a queued HULL BUILD. Costs a full bill of materials + credits.
//   fuelDepot   , DELIBERATELY A STUB THAT ACCEPTS NOTHING. See QUEUE_ADAPTERS' fuelDepot
//                 row for the full finding: the depot's pipelines are ALWAYS-ON and
//                 automatic (processFuelPipelines fills every free pipeline every tick
//                 from the one and only fuel recipe), so there is no player intent for a
//                 queue to carry and a queued fuel batch could not do anything the depot
//                 would not already have done on the same tick. The key exists so the
//                 decision is recorded, exhaustively type-checked and reversible in one
//                 place, NOT because a fuel queue does anything today.
//
// ⚠️ WAREHOUSE AND DOCKS ARE PERMANENTLY EXCLUDED and must not be added. They are
// LOGISTICAL: they hold things, they do not RUN anything, so there is no job to promote
// and no slot to wait for. A queue there would be a control with nothing behind it.
export type QueueFacilityKey =
  | "refinery"
  | "fabricator"
  | "salvageBay"
  | "researchLab"
  | "shipyard"
  | "fuelDepot";

// What a queued SALVAGE order points at. The design never defined this shape; the
// build plan's assumption 3 fixes it as the three things the Salvage Bay can already
// act on. Every arm is PLAIN STRINGS on purpose (an id, never an object graph and
// never a Decimal), so a queued salvage order round-trips through JSON untouched.
export type SalvageTargetRef =
  | { kind: "equipment"; instanceId: string }
  | { kind: "material"; itemId: string }
  | { kind: "ship"; shipId: string };

// The run-mode a queued SALVAGE order carries.
//
// ⚠️ THIS IS CraftLineMode's `batch` ARM ITSELF, NOT A COPY OF IT (0.13.3 batch-salvage
// follow-up, 2026-09-04). Written as an `Extract` rather than as a freshly declared
// `{ kind: "batch"; remaining: number }` for two reasons that are both load-bearing:
//   1. There is then exactly ONE definition of "a batch of N" in the game. A craft order
//      and a salvage order carry the same `kind` literal and the same `remaining` field
//      with the same meaning (units NOT YET STARTED, counted down as each one begins), so
//      the queue row, the console and every maintainer read one vocabulary, not two.
//   2. If CraftLineMode's batch arm ever gains a field, this follows it automatically
//      instead of silently drifting into a parallel shape.
//
// ⚠️ AND IT DELIBERATELY EXCLUDES `continuous`. A continuous craft line runs until it is
// cancelled, which is harmless: it MAKES things. A continuous salvage would stand at the
// Salvage Bay destroying every unit of a material as it arrived, forever, which is a
// permanent-destruction automation. That automation already exists, opt in, rule bounded
// and confirm-tier aware (AutoSalvageRules below), and it is the right home for it. The
// Extract makes "continuous" a COMPILE ERROR here rather than a runtime branch someone
// has to remember to handle.
export type SalvageOrderMode = Extract<CraftLineMode, { kind: "batch" }>;

// The player's unit of QUEUED INTENT.
//
// WHY an ORDER and not a job: for the Refinery and the Fabricator the thing a player
// configures is a LINE (recipe + batch count or continuous), not a single iteration.
// Carrying the line's own config here means promotion can hand this straight to the
// proven canStartLine / startLine pair (tick.ts) instead of duplicating the per
// iteration engine, so a queued order can never disagree with what the configurator's
// Start button would have done.
//
// ⚠️ A SALVAGE ORDER CARRIES A BATCH COUNT TOO as of the 0.13.3 batch-salvage follow-up
// (2026-09-04). It used to be one target, full stop, on the reasoning in design §5.1 that
// "for salvage the unit is genuinely one target". That reading is right for the two UNIQUE
// arms and wrong for the fungible one: design §8.7's own New list asked for a "batch select
// to queue", and a player holding five thousand Damaged Reactor Housings could otherwise
// only enqueue them one order at a time against a queue three deep. So the order carries a
// `mode` exactly as a craft order does.
//
// ⚠️ ONLY THE `material` ARM MAY CARRY A COUNT ABOVE 1, and that is enforced in ONE place,
// reservation.ts's salvageOrderUnits, which every reader goes through. An equipment
// instance and a hull are each a single distinct object named by a single id, so "salvage
// 5 of instance eq-7" is not a quantity, it is a nonsense: the first unit consumes the
// object and the rest could only resolve as stale no-ops. Those two arms therefore always
// read as 1 however the field is set, which also makes a hand-edited save harmless.
//
// ⚠️ THE TWO ARMS ADDED BY THE 0.13.3 QUEUE-ENGINE EXTENSION (2026-09-04), and why
// neither carries a mode:
//
//   research  , ONE project, named by its blueprint key. A batch count would be a nonsense
//               here in the same way it is for a unique salvage target: a blueprint is
//               researched exactly once and stays researched, so "research this twice" has
//               no second unit of work to do. canEnqueueOrder refuses the duplicate rather
//               than letting a dead entry sit on a depth slot forever.
//   shipBuild , ONE hull of a type, named by its SHIP_TYPES key. Hulls are NOT unique the
//               way a blueprint is (a player legitimately wants three freighters), so there
//               is no duplicate gate on this arm. A count is still deliberately absent: the
//               Shipyard's unit of work is one hull and one build slot, so "build 3" would
//               have to be modelled as a residual the way a salvage batch is, which is a
//               separate, designed change rather than something to smuggle in here. Three
//               hulls today means three orders, which is exactly what queue depth buys.
//
// Both arms are PLAIN STRINGS, keeping the no-Decimal guarantee below intact: they ride
// hydrateDecimals's spread verbatim and need no revive branch and no migration.
export type QueuedOrder =
  // Material Lines ML-4 (L5): `materialPreference` "best" = the order's "Use best materials" toggle (highest quality
  // stock first), carried onto the line at promotion. Written only when on; absent = lowest-first. A plain string.
  | { type: "craftLine"; kind: CraftLineKind; recipeKey: string; mode: CraftLineMode; materialPreference?: MaterialPreference }
  | { type: "salvage"; target: SalvageTargetRef; mode: SalvageOrderMode }
  | { type: "research"; blueprintKey: string }
  | { type: "shipBuild"; typeKey: string };

// One entry in GameState.processQueue.
//
// ⚠️ NO DECIMAL ON THIS SHAPE, AND IT MUST STAY THAT WAY. Every field here is an id
// string, a string-literal key, or a plain number (CraftLineMode's batch `remaining`),
// so the whole array rides hydrateDecimals's `...state` spread verbatim and needs NO
// hydration branch, exactly like `ships` / `equipment` / `refineLines`. Adding a
// Decimal-typed field to QueuedJob (or to QueuedOrder / SalvageTargetRef) WITHOUT
// adding a matching revive in save.ts's hydrateDecimals would produce a plain STRING
// on load and throw on the first .plus() / .gte(). That is the difference between a
// one-line migration and a serialization bug (design §10), so: keep the shape plain.
export interface QueuedJob {
  id: string;              // "q-N", minted from state.nextQueueId (mirrors nextProcessId's "proc-N")
  facility: QueueFacilityKey;
  order: QueuedOrder;
}

// ----------------------------------------------------------------------------
// SalvageIdleWatch (Auto-Salvage Terminal, 2026-09-11)
// ----------------------------------------------------------------------------
// The bookkeeping behind the BORROW WINDOW: the free general-lane count the window last
// restarted at, and the GAME time it restarted. tick.ts's refreshSalvageIdleWatch maintains
// it (one call site, inside the promotion pass) and autoSalvageBorrowUnlocked reads it.
//
// ⚠️ WHY THIS ONE LANE FACT IS STORED WHEN EVERY OTHER ONE IS DERIVED. Lane counts, lane
// occupancy and every reservation in this engine are functions of the CURRENT state, so they
// are recomputed on read and cannot go stale. "How long has a lane been idle" is not a fact
// about the current state at all, it is a fact about HISTORY, and nothing in the save records
// when a job finished. Two plain numbers is the smallest honest record of it.
//
// ⚠️ GAME SECONDS, NEVER Date.now(), for the same reason EquipmentInstance.graceStartedAtGameSeconds
// is: the comparison happens inside the tick and therefore inside the offline catch-up, where
// a wall-clock read would make an offline span resolve differently from the identical span
// played live. Both fields are plain numbers, so this rides hydrateDecimals's `...state`
// spread with no revive branch (see the ⚠️ warning on QueuedJob above).
export interface SalvageIdleWatch {
  generalFree: number;      // the free general-lane count this window belongs to
  sinceGameSeconds: number; // the game time (state.gameTimeSeconds) the window started
}

// The opt-in auto-salvage rules (design §7.6).
//
// WHY THESE LIVE IN THE SAVE AND NOT IN localStorage: they change what the TICK does,
// and the offline catch-up path can only read the save. A localStorage-only rule would
// be invisible offline, so a player's offline run would behave differently from their
// live run (a parity break) and could destroy items the live path would have spared.
//
// No Decimal here either (two booleans, a nullable plain number, a plain number), so
// this field needs no hydration branch for the same reason QueuedJob does not.
// ⚠️ 0.13.5: THE RULES ARE FILTERS THAT NARROW, NOT SELECTORS THAT UNION. Read this before
// changing anything here, because the two models destroy different sets of items.
//
// Until 0.13.5 each rule SELECTED independently and the results were merged, so "quality <= 2"
// and "radiant" together took everything at Q0-Q2 PLUS every radiant piece at any quality. The
// user found the model confusing for a reason that turned out to be exactly right: with quality
// expressed as a SET rather than a threshold, an independent quality rule means ticking Q5 alone
// would queue every Q5 item in the fleet regardless of rarity, which is the shape of mistake that
// eats somebody's best gear.
//
// The model now: start from every spare, then apply each axis that HAS a selection.
//   qualities empty -> quality does not narrow   (rarity alone still works, as before)
//   rarities empty  -> rarity does not narrow    (quality alone still works, as before)
//   both selected   -> only pieces matching BOTH
//   nothing selected anywhere -> ⚠️ NOTHING is taken. See selectAutoSalvageTargets: "no filters"
//   must never mean "everything", and that guard is the single most important line in the file.
export interface AutoSalvageRules {
  enabled: boolean;          // master switch, default false (opt in, never on by surprise)
  // 0.13.5: the QUALITY tiers this rule may take, as a SET. Replaces `maxQuality: number | null`.
  // ⚠️ An empty array means "quality does not narrow", NOT "take everything": the all-empty guard
  // in selectAutoSalvageTargets is what stops that. A set rather than a threshold because the
  // player asked to pick tiers individually, and because "off" as a third state on a threshold was
  // genuinely confusing next to a rarity row that expresses off as "nothing ticked".
  qualities: number[];
  duplicates: boolean;       // narrow further to duplicates beyond keepPerVariety
  keepPerVariety: number;    // how many of a variety to KEEP; fixed at 1 this release, not yet player-editable
  // 0.13.3.1 Feature 1: the PER-RARITY selection. Unchanged in shape; what changed in 0.13.5 is
  // that it now NARROWS alongside `qualities` instead of selecting independently of it. See
  // AutoSalvageRaritySelection below for why this is a per-band record and not a threshold.
  rarities: AutoSalvageRaritySelection;
  // 0.13.3.1 Feature 3: how long a piece that was just CRAFTED or just UNINSTALLED is exempt
  // from the rules, in GAME seconds. Player-chosen from AUTO_SALVAGE_GRACE_OPTIONS, defaulting to
  // AUTO_SALVAGE_GRACE_SECONDS_DEFAULT (60 minutes). In the SAVE for the same reason as
  // every other field on this shape: the tick reads it and the offline path can see nothing
  // else. Read through resolveAutoSalvageGraceSeconds, never raw, so an absent or malformed
  // value lands on the default instead of on 0 (a 0 would silently switch the protection off).
  graceSeconds: number;
}

// ----------------------------------------------------------------------------
// AutoSalvageRaritySelection (0.13.3.1 Feature 1)
// ----------------------------------------------------------------------------
// WHICH EquipmentRarity bands the auto-salvage rules may take: one boolean per band, and
// the rule is off when every band is false.
//
// ⚠️ PER-BAND SELECTION, NEVER A THRESHOLD, AND THE REASON IS CONCRETE. rarityIndex (above)
// is NOT a straight ladder: luminous and constellar BOTH return 5, because they are parallel
// legendary-class FLAVORS at one power tier rather than two more rungs. So an "at or below
// this rarity" rule would sweep BOTH of them the instant a player selected EITHER, destroying
// a band they never chose. A per-band record cannot express that mistake, and it matches the
// per-quality-tier confirm control the Salvage Bay already shows.
//
// ⚠️ A TOTAL Record, SO GROWING THE LADDER IS A COMPILE ERROR (user requirement: "leave this
// system modular to include additional item rarity types as they are added in"). Adding a
// member to EquipmentRarity breaks every object LITERAL of this type until the new band is
// answered for, which is the same discipline SALVAGE_EQUIPMENT_RARITY_MULTIPLIER above,
// QUEUE_ADAPTERS (tick.ts) and equipmentRarityColor (EquipmentTooltip.svelte) already use.
// There is deliberately no index comparison and no hardcoded list of seven strings anywhere.
export type AutoSalvageRaritySelection = Record<EquipmentRarity, boolean>;

// The "no band selected" default: the rarity rule OFF. THE compile-error anchor for the whole
// feature (a new EquipmentRarity member fails to type-check here first), and the seed both
// freshState and the v42 -> v43 migration write.
export const AUTO_SALVAGE_RARITIES_NONE: AutoSalvageRaritySelection = {
  derelict: false,
  standard: false,
  augmented: false,
  stellar: false,
  radiant: false,
  luminous: false,
  constellar: false,
};

// Every EquipmentRarity band in ladder order, for the console's checkbox row and for the
// "is any band selected" scan.
//
// DERIVED FROM THE TOTAL RECORD ABOVE, never written out a second time: object key order is
// insertion order in ES2015+ (the same guarantee seedStandardIssueForShip already relies on
// for its mint order), so this list grows automatically the moment a band is added to
// AUTO_SALVAGE_RARITIES_NONE. That is the point: a new rarity is a compile error in ONE
// place, and every consumer, engine and UI alike, then picks it up with no further edit.
export const EQUIPMENT_RARITY_LADDER = Object.keys(AUTO_SALVAGE_RARITIES_NONE) as EquipmentRarity[];

// The DISPLAY spelling of a rarity band ("radiant" -> "Radiant").
//
// ⚠️ DISPLAY ONLY, AND THAT IS THE WHOLE POINT. The union member, the record key and every
// saved value stay lowercase; nothing here is ever written back to state, compared against a
// key, or used to look anything up. It exists so a console can show a band the way the rest
// of the game's chrome shows proper nouns (the user asked for the auto-salvage rarity options
// to be capitalized) WITHOUT anyone being tempted to capitalize the data to get there, which
// would break every Record<EquipmentRarity, ...> in the file at once.
//
// Derived from the band itself rather than a second label table, because a label table is one
// more thing to forget when a band is added: a new EquipmentRarity member is already a compile
// error at AUTO_SALVAGE_RARITIES_NONE above, and it needs no edit here to render correctly.
// (EquipmentTooltip.svelte computes the same spelling privately for its "{Rarity} Grade" line.
// Consolidating the two is a worthwhile follow-up but is NOT done here: that component's
// presentation is under a standing do-not-touch constraint.)
export function equipmentRarityLabel(rarity: EquipmentRarity): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

// Read a rarity selection off a SAVED value, defensively.
//
// ⚠️ FAIL SAFE TOWARD KEEPING ITEMS. Only an exact `true` selects a band. An absent field (a
// save from before this release, a hand-built fixture), a malformed value, or a band the
// object simply does not carry (a save written before that band existed) all read as NOT
// selected. Salvage is irreversible, so the direction of every unreadable value has to be
// "do not destroy this", which is the same posture autoSalvageProtectedQualities takes for a
// missing confirm preference.
export function normalizeAutoSalvageRarities(raw: unknown): AutoSalvageRaritySelection {
  const source = (raw ?? {}) as Partial<Record<string, unknown>>;
  const out = { ...AUTO_SALVAGE_RARITIES_NONE };
  for (const band of EQUIPMENT_RARITY_LADDER) {
    out[band] = source[band] === true;
  }
  return out;
}

// Is the rarity rule actually ON (at least one band selected)? One reading, shared by the
// engine and the console so they can never disagree about what "off" means.
export function autoSalvageRarityRuleOn(selection: AutoSalvageRaritySelection): boolean {
  return EQUIPMENT_RARITY_LADDER.some((band) => selection[band]);
}

// ----------------------------------------------------------------------------
// The QUALITY selection (0.13.5)
// ----------------------------------------------------------------------------

// Every quality tier, derived from the canonical QUALITY_TIERS ceiling rather than a [0..5]
// literal, for the same reason salvageConfirmPreference derives it: a seventh tier must not
// silently arrive missing from the picker.
export const ALL_AUTO_SALVAGE_QUALITIES: number[] = Array.from({ length: QUALITY_TIERS }, (_, i) => i);

// Read a saved quality selection defensively.
//
// ⚠️ UNREADABLE ALWAYS MEANS EMPTY, and empty means "this axis does not narrow", never "take
// everything": a save written before 0.13.5, a hand-edited one, or one carrying a tier outside the
// ladder must not be able to widen what gets destroyed. Same posture as normalizeAutoSalvageRarities.
export function normalizeAutoSalvageQualities(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    if (value < 0 || value >= QUALITY_TIERS) continue;
    seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

// Does the quality axis narrow anything? Mirrors autoSalvageRarityRuleOn exactly, so the two
// axes are reasoned about the same way at every call site.
export function autoSalvageQualityRuleOn(qualities: number[]): boolean {
  return qualities.length > 0;
}

// ⚠️ THE GUARD THAT STOPS "NO FILTERS" MEANING "EVERYTHING". True when the player has ticked
// nothing on any axis, in which case the automation must take NOTHING even though it is switched
// on. Under the old union model this fell out for free (no rule selected, so nothing was added);
// under a filter model it has to be stated, because an unfiltered set is the whole pool.
export function autoSalvageHasAnyRule(rules: AutoSalvageRules): boolean {
  return (
    autoSalvageQualityRuleOn(normalizeAutoSalvageQualities(rules.qualities)) ||
    autoSalvageRarityRuleOn(normalizeAutoSalvageRarities(rules.rarities)) ||
    rules.duplicates === true
  );
}

// ----------------------------------------------------------------------------
// The GRACE PERIOD options (0.13.3.1 Feature 3)
// ----------------------------------------------------------------------------
// A spare that was just CRAFTED, or that the player just UNINSTALLED from a ship, is exempt
// from the auto-salvage rules for this long, so neither a fresh craft nor a gear swap can be
// swept away before the player has looked at it. Measured in GAME seconds against
// state.gameTimeSeconds (see EquipmentInstance.graceStartedAtGameSeconds for why it is never
// wall time, and for why one stamp covers both moments).
//
// AN ENUMERABLE, TYPED LIST rather than a free-text field: the console renders exactly these
// options, so adding "12 hours" is a one-line DATA change here and needs no UI work and no
// engine work. Labels live beside their values for the same reason (one source of truth for
// what a value is called).
//
// ⚠️ THE DROPDOWN'S FINAL HOME IS Options > Gameplay (0.13.5), not the Salvage Bay. That tab
// does not exist yet (SUGGESTIONS.md, "AUTOMATION RULES ALSO BELONG UNDER OPTIONS"), so this
// release puts the control on the Salvage Bay Rules tab beside the rules it governs. When the
// Gameplay tab lands, that control must be a SECOND VIEW OF THIS SAME SAVED VALUE
// (state.autoSalvage.graceSeconds), never a copy: two stores for one setting is exactly the
// drift the confirm-by-quality preference had to be migrated out of localStorage to escape.
export const AUTO_SALVAGE_GRACE_OPTIONS: readonly { seconds: number; label: string }[] = [
  { seconds: 5 * 60, label: "5 minutes" },
  { seconds: 10 * 60, label: "10 minutes" },
  { seconds: 30 * 60, label: "30 minutes" },
  { seconds: 60 * 60, label: "60 minutes" },
  { seconds: 24 * 60 * 60, label: "24 hours" },
  { seconds: 7 * 24 * 60 * 60, label: "7 days" },
  // ⚠️ THE OPT-IN "OFF" ENTRY, AND IT IS DELIBERATELY LAST RATHER THAN IN LADDER POSITION.
  //
  // It needs no engine work: resolveAutoSalvageGraceSeconds below already honors a deliberate
  // 0 (it tests the value's SHAPE, not its truthiness), and the console's own setter refuses
  // any value this list does not carry. So offering it here is the entire mechanism, which is
  // why this is a data change and not a behavior change.
  //
  // WHY LAST, breaking the otherwise-ascending order: the risk of a mis-tap is ASYMMETRIC. The
  // durations run shortest to longest, so 0 belongs at the HEAD by sorting. But the head puts
  // "no protection at all" directly against "5 minutes", and a player reaching for the shortest
  // grace who overshoots by one row would silently switch a data-loss protection off. At the
  // tail its only neighbor is "7 days": overshooting there over-protects, which is recoverable
  // by definition. A player scanning DURATIONS never travels in this direction, and one who
  // wants the option is choosing it on purpose. It is never in the middle for the same reason.
  //
  // The label says what it DOES ("no grace period") rather than naming a length, so it cannot be
  // read as just another, shorter duration while scanning the list.
  //
  // ⚠️ SELECTING IT MUST KEEP A PERSISTENT WARNING ON SCREEN (App.svelte, the Rules tab). It is
  // a setting rather than an act, so the risk is ongoing rather than momentary and a one-off
  // confirm the player dismisses and forgets would not cover it.
  { seconds: 0, label: "No grace period" },
];

// THE FIRST-PASS DEFAULT, and the value every save that has not chosen one resolves to.
// RAISING IT protects a newly crafted piece for longer, which makes the automation slower to
// tidy a busy crafting session and makes a "why has this not been queued yet" question more
// likely; LOWERING it narrows the window in which the player can rescue something the rules
// would otherwise take. 60 minutes is the user's chosen starting point, not a tuned value.
export const AUTO_SALVAGE_GRACE_SECONDS_DEFAULT = 60 * 60;

// Resolve the live grace length off the rules, defensively.
//
// ⚠️ THE FALLBACK IS THE DEFAULT, NEVER 0. A save from before this release carries no
// graceSeconds, and a hand-edited one can carry anything. Reading either as 0 would silently
// switch a player-protection feature OFF, so anything that is not a finite, non-negative
// number resolves to AUTO_SALVAGE_GRACE_SECONDS_DEFAULT. A deliberate 0 IS honored (it is a
// legitimate "I do not want a grace period" choice), which is why the guard tests the VALUE's
// shape and not its truthiness.
export function resolveAutoSalvageGraceSeconds(rules: AutoSalvageRules | undefined): number {
  const raw = rules?.graceSeconds;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return AUTO_SALVAGE_GRACE_SECONDS_DEFAULT;
  }
  return raw;
}

// The "confirm everything" default for salvageConfirmQualities: every quality tier
// requires a confirm until the player opts a tier out. DERIVED from the canonical
// QUALITY_TIERS ceiling (inventory.ts) rather than a hardcoded [0..5], so a new top
// tier is automatically guarded instead of silently shipping UNconfirmed.
//
// ⚠️ DELIBERATE (temporary) DUPLICATE of ALL_QUALITIES in src/lib/salvageConfirmPreference.ts
// (Omega 4 flag). Both derive from the SAME QUALITY_TIERS constant so they cannot
// disagree on a value, and the duplication is short-lived by design: that module is
// reduced to a one-time migration reader in this release and retired once the seed has
// run everywhere. It is NOT imported here because game/ owning its own fresh-state
// default keeps the engine free of a dependency on a UI-preference module.
export function freshSalvageConfirmQualities(): number[] {
  return Array.from({ length: QUALITY_TIERS }, (_, i) => i);
}

// ===========================================================================
// Crafting 0.13.3 (Unit 4.4b): THE COMPLETED-EVENTS LOG
// SUGGESTIONS.md, "COMPLETED-EVENTS LOG" (user, 2026-09-02).
//
// WHY THIS EXISTS. Every timed job in the game used to complete SILENTLY: the result
// simply appeared in inventory with no record that anything had happened. That is an
// Omega 14 violation repeated across every facility ("silent code is indistinguishable
// from broken code"), and it is what let 0.13.3 Unit 4.4 lose the Salvage Bay's
// "Recovered: 3 Titanium Ingot" manifest without anything else noticing: the recovery is
// computed inside resolveProcesses, where the UI cannot see it. It also closes a hole
// nothing else could: a job that both STARTS and FINISHES inside one offline catch-up was
// previously never observed at all.
//
// ⚠️ IDS AND AMOUNTS, NEVER PRE-RENDERED STRINGS. An entry stores what was granted as
// item IDS plus amounts, so the UI applies warehouseRarityColor and the player's own
// number formatting at render time, and so a later, richer completions interface can
// re-render the SAME records without a migration.
//
// ⚠️ NO DECIMAL ON THESE SHAPES, AND IT MUST STAY THAT WAY (the same rule QueuedJob
// carries, for the same reason). Amounts are stored as plain DECIMAL STRINGS, which is
// what a Decimal serializes to anyway (Decimal.toJSON), so the whole log rides
// hydrateDecimals's `...state` spread verbatim and needs NO hydration branch. A consumer
// that wants arithmetic does `new Decimal(entry.items[i].amount)` at read time. Adding a
// live Decimal here without a matching revive in save.ts would load back as a bare string
// and throw on the first .plus().
// ===========================================================================

// The honest SUMMARY SHAPE of what a completed order granted. A job does not always
// grant items: an upgrade grants a LEVEL, research grants an UNLOCK, a build grants a
// HULL. Keeping the shape explicit means the readout never has to pretend an upgrade
// produced a pile of materials.
//   materials  stackable items landed in the Warehouse (refine, material fabrication,
//              a salvage recovery). The amounts are in `items`.
//   systems    non-stacking EquipmentInstances were minted (equipment / weapon / drone
//              fabrication). The count is in `pieces`, the blueprint in `subjectKey`.
//   blanks     a completed fabricate deposited a stackable, uninspected BLANK (subjectKey is
//              the blueprint key); the roll is deferred to the Crafted Blanks inspect action.
//   fuel       fuel was deposited in the tank. The amount is in `fuelAmount`.
//   blueprint  a research project unlocked a blueprint (`subjectKey`).
//   hull       a ship was built (`subjectKey` is the hull type key).
//   level      a facility / storage / docks rung was reached (`level`, `subjectKey`).
//   repair     a damaged hull was repaired (`subjectKey` is the ship id).
//   nothing    the completion granted nothing at all: a stale salvage target that
//              resolved as a fail-safe no-op, or a Standard-Issue baseline destroyed
//              for zero reward. Recorded ON PURPOSE, because "nothing happened" reads
//              as a bug until the player is told nothing was lost either.
//   relic      (Exploration 0.14.0, E4a) a relic study identified a vault token; `subjectKey`
//              is the IDENTIFIED relic id (relics.ts RELICS) and one museum copy landed.
export type CompletionRewardKind =
  | "materials"
  | "systems"
  | "blanks"
  | "fuel"
  | "blueprint"
  | "hull"
  | "level"
  | "repair"
  | "relic"
  | "nothing";

// One stackable reward line: WHICH item, and HOW MUCH of it, accumulated across every
// iteration of the order. `amount` is a Decimal STRING (see the no-Decimal rule above).
export interface CompletionRewardItem {
  itemId: string;
  amount: string;
}

// What a completed SALVAGE broke down, kept as the STATIC IDS that name it (0.13.3 QA
// finding D5, user 2026-09-10: "What was salvaged. What was gained.").
//
// ⚠️ WHY THIS FIELD IS GENUINELY UNAVOIDABLE, rather than a convenience. Every other
// completed kind can be named after the fact from `subjectKey` alone, because its subject
// still exists: a refined item, an unlocked blueprint, an upgraded facility, a repaired
// hull. A SALVAGE is the one kind whose subject is DESTROYED by the completion itself. For
// the fungible arm that is harmless (the subject key is an item id and ITEMS still has the
// entry), but a crafted piece is an EquipmentInstance whose name is resolved through its
// slotType + blueprintKey, and both of those die with the instance. So the record either
// captures them at write time (the resolver holds the pre-completion state, where the piece
// is still present) or the row can never say more than "Salvaged". There is no third
// option, and "Salvaged" with no subject is exactly the defect this closes.
//
// ⚠️ STILL IDS, NEVER PRE-RENDERED STRINGS, so the rule at the top of this section holds:
// the reader runs these through the SAME naming helper the Salvage Bay's own queue rows use
// (craftQueue.ts equipmentInstanceLabel), rather than reading back a sentence this file
// froze at write time.
//
// ⚠️ ADDITIVE AND OPTIONAL, so NO SAVE_VERSION BUMP. An entry written before this field
// existed simply lacks it and degrades to the previous wording; nothing reads it without a
// presence check. The material arm is deliberately absent from the union: its subjectKey is
// already an item id, so storing a second copy would cost save bytes for no new fact.
export type CompletionSalvageSubject =
  // A spare Ship System. blueprintKey null is the Standard-Issue baseline (craft-less), the
  // distinction the Salvage Bay's DESTROY-versus-SALVAGE wording turns on.
  | { kind: "equipment"; slotType: string; blueprintKey: string | null }
  // A hull teardown, named by its CLASS. The player's own ship name is not captured: it is
  // free text rather than an id, and the class is what survives as a stable fact.
  | { kind: "ship"; typeKey: string };

// One finished ORDER, as the player can read it back.
//
// ⚠️ PER ORDER, NOT PER ITERATION (design catch 1, user 2026-09-02). The user's own
// example is "your run of 10,000 salvage completed", so a 10,000-iteration refine batch
// must leave ONE entry carrying the accumulated yield, never 10,000 entries. Logging per
// iteration would let a single big batch evict every other entry and blow the 50-cap
// instantly, which would make the log actively worse than no log. See OpenJobBatch below
// for the accumulator that makes this work across ticks and across saves.
// Infrastructure 0.13.4 (Phase 2 Unit 2.2, design §6.4): what can APPEAR in the completion
// log. Every TimedProcessKind, plus patrol runs, which are NOT timed processes and are the
// reason this alias exists.
//
// ⚠️ THE BOUNDARY THAT KEEPS THIS FROM SPREADING. Only this alias and COMPLETION_KIND_VIEW
// widen. `PROCESS_XP_AWARDS` and `PROCESS_COMPLETION_LOG` stay keyed by `TimedProcessKind`,
// because they are about PROCESSES and are consulted per process inside resolveProcesses;
// widening them would add rows that nothing ever reads. COMPLETION_KIND_VIEW widens because
// it is the VIEW table and by definition must cover every RENDERABLE entry. That split is
// deliberate and is not a contradiction: one table is about rendering, the others are about
// processes.
// G1-4: "shortRangeRun", one entry per short-range RUN when it ends (the patrol precedent: one entry per run, its
// `iterations` the cycles delivered), never one per cycle, so a board on Repeat cannot evict the rest of the log.
export type CompletionLogKind = TimedProcessKind | "patrolRun" | "shortRangeRun";

export interface CompletionLogEntry {
  id: string;               // "done-N", minted from state.nextCompletionLogId (mirrors "proc-N" / "q-N")
  kind: CompletionLogKind;  // which engine produced it, so the UI can pick a verb + icon
  // Infrastructure 0.13.4 (Phase 2 Unit 2.2): WHY a patrol ended. Non-null ONLY on a
  // `patrolRun` entry; null on every process entry, which have no such concept.
  //
  // ⚠️ `iterations` CARRIES THE ROUTE COUNT for a patrolRun entry, and that reuse is
  // deliberate rather than lazy: its documented meaning is "how many job iterations folded
  // into this entry", and routes-flown-in-a-run is the same fact. Inventing a parallel
  // `routes` field would give the log two counters meaning one thing.
  patrolEndReason?: PatrolEndReason | null;
  reward: CompletionRewardKind; // the honest summary shape (see above)
  // ⚠️ INJECTED WALL CLOCK, NEVER READ INSIDE THE TICK (design catch 2). resolveProcesses
  // is handed this value as an ARGUMENT exactly as the seeded rng is threaded, because a
  // Date.now() call inside the resolver would be non-deterministic and an offline catch-up
  // would then stamp different times than live stepping, breaking the offline==live
  // invariant this whole release is built on. 0 means "no clock was supplied" (a unit-test
  // call), which the UI renders as an unknown time rather than as 1970.
  atMs: number;
  // When the order's FIRST folded iteration STARTED, reconstructed as its completion stamp
  // minus its own duration. Carried so a readout can answer the user's "Time elapsed: X"
  // without a second bookkeeping field. 0 when the clock was unknown.
  startedAtMs: number;
  iterations: number;       // how many job iterations folded into this entry (1 for a one-shot)
  items: CompletionRewardItem[]; // accumulated stackable yield (empty for a non-material reward)
  pieces: number;           // non-stacking EquipmentInstances minted (0 for every other reward)
  subjectKey: string | null; // the ONE named subject: blueprint key / hull type / facility key / item id / ship id
  level: number | null;     // the level or capacity REACHED, for a "level" reward; null otherwise
  fuelAmount: string | null;   // Decimal string, for a "fuel" reward; null otherwise
  creditsAmount: string | null; // Decimal string, credits refunded by a hull teardown; null otherwise
  // The salvage FAIL-SAFE NO-OP: the target was gone by the time its turn came, so the
  // process dropped and applied nothing. Recorded rather than swallowed so the Salvage Bay
  // can say "nothing was consumed, you can queue it again" instead of going quiet.
  stale: boolean;
  // The consumed salvage target's naming ids (see CompletionSalvageSubject). Present only
  // on a "salvageJob" entry whose target was an EquipmentInstance or a hull, and only when
  // the resolver could still see it. Absent everywhere else, and absent on every entry
  // written before this field existed, so every read is presence-checked.
  salvageSubject?: CompletionSalvageSubject;
}

// The RUNNING accumulation for one line-backed order that has not finished yet.
//
// WHY A SEPARATE ARRAY AND NOT AN "OPEN" ENTRY INSIDE THE LOG: the log is the list of
// things that are DONE. An in-flight order already appears in the dashboard's IN PROGRESS
// section, so putting it in "Recently completed" too would say the same thing twice and
// would let a long-running batch occupy (and eventually be evicted from) a ring slot it
// has not earned. Keeping the accumulator separate also means the ring buffer's eviction
// rule can never silently drop a batch that is still accruing.
//
// BOUNDED BY CONSTRUCTION: there is at most one open batch per live CraftLine, and the
// number of lines is capped by each facility's slot count, so this array stays tiny (single
// digits) no matter how long the player is away.
export interface OpenJobBatch {
  lineId: string;           // the CraftLine.id whose iterations fold in here
  kind: TimedProcessKind;
  reward: CompletionRewardKind;
  startedAtMs: number;      // when the first folded iteration started (see CompletionLogEntry)
  lastAtMs: number;         // clock stamp of the most recent folded iteration
  iterations: number;
  items: CompletionRewardItem[];
  pieces: number;
  subjectKey: string | null;
}

// How many completed-order entries the ring buffer keeps. The user's number: enough to
// answer "what did I miss?" after an absence, small enough that the save cannot balloon.
// Oldest is evicted first (the array is chronological, so eviction is a slice off the
// front).
export const COMPLETION_LOG_CAP = 50;

// --- Crafting 0.13.3 (Phase 2 Unit 2.2): salvage DURATION -------------------
// docs/plans/2026-09-01-crafting-0.13.3-design.md §7.2.
//
// How long a queued salvage takes once it is promoted into a "salvageJob".
//
// WHY THESE LIVE IN model.ts AND NOT IN THE RECYCLE MODULE: duration is pure ARITHMETIC
// over numbers the caller already holds (an iLevel, a quality tier, a build recipe's own
// duration). It touches none of the recycle internals, draws no rng, and reads no state,
// so it can sit next to the rest of the queue schema where both the engine and the later
// consoles can reach it without either importing the other. Keeping it here also keeps it
// unit-testable on its own, before anything can create a job (Unit 2.4).
//
// ⚠️ EVERY CONSTANT BELOW IS A FIRST-PASS TUNABLE, not a balance-tested number, the same
// status CRAFTING_XP_PER_DURATION_TICK carries. The shape (a floor plus a linear term in
// iLevel plus a linear term in quality) is the deliberate part; the coefficients are
// expected to move once the Salvage Bay is playable.
//
// SHAPE INVARIANT, load-bearing for the countdown: every function here returns a WHOLE
// number of ticks, at least 1. TimedProcess.remainingTicks is decremented by whole ticks
// and a duration of 0 would complete on the very tick it started (and a fractional one
// would never land exactly on 0), so the ceil and the floor of 1 are correctness, not
// polish.

// The floor: what the cheapest possible recycle costs in ticks. Design §7.2's "the lowest
// tier salvage takes about 5 seconds", and one tick is one second at the default cadence.
export const SALVAGE_BASE_TICKS = 60;

// Ticks added per point of the target's iLevel. Fractional on purpose: iLevel climbs in
// large steps, so a whole tick per point would dominate the formula. The sum is ceil'd.
export const SALVAGE_TICKS_PER_ILEVEL = 0.5;

// Ticks added per quality tier (0..QUALITY_TIERS-1). Weighted heavier than iLevel because
// quality is the axis the player feels: a Q5 piece should visibly take longer to break
// down than a Q0 one of the same iLevel.
export const SALVAGE_TICKS_PER_QUALITY = 2;

// ============================================================================
// The equipment arm's OWN CATEGORICAL FACTORS (Crafting 0.13.3 salvage-duration SEAM)
// ============================================================================
// ⚠️ EVERY CONSTANT IN THIS BLOCK IS NEUTRAL TODAY, ON PURPOSE, exactly like the material
// block below it. Each is set to its IDENTITY value (1.0 for a multiplier, 0 for a
// per-tier step), so the equipment arm still returns exactly
// `SALVAGE_BASE_TICKS + iLevel * PER_ILEVEL + quality * PER_QUALITY` for every piece the
// game can mint. Nothing about the game's timings moves until one of these is retuned.
//
// WHY THE EQUIPMENT ARM IS WIDENED TOO, and why it is widened NOW rather than during the
// balance pass: the whole point of the seam is that the balance pass is a NUMBERS edit
// that never has to reopen parity-critical duration code. Leaving one arm half-widened
// defeats that, because the first tuning pass that wanted rarity to matter on a salvaged
// system would have to come back here, change a type, change a call site, and re-argue
// the parity case under balance pressure. So both arms get their room in the same
// behavior-neutral motion, and the follow-up is purely numbers.
//
// SAME SHAPE AS THE MATERIAL ARM: the NUMERIC axes (iLevel, quality) stay ADDITIVE, where
// a coefficient means literally "this many ticks per point", and only the CATEGORICAL
// axes (rarity, blueprint tier) are allowed to MULTIPLY, because they have few, named,
// hand-picked values whose product a designer can hold in their head. The fully
// multiplicative alternative compounds: four axes at a modest 2x each is already 16x.
// SALVAGE_MAX_TICKS then bounds the product no matter how the two are later tuned.

// MULTIPLIER on the equipment duration for the piece's own EquipmentRarity band. RAISING
// an entry makes that whole band slower to break down; the ladder is meant to ascend
// (derelict cheapest, the legendary flavors dearest) once tuned. All 1.0 = rarity is
// free, today's behavior.
//
// ⚠️ ITS OWN TABLE OVER ITS OWN UNION, DELIBERATELY NOT SHARED WITH THE MATERIAL ARM'S.
// EquipmentRarity (derelict / standard / augmented / stellar / radiant / luminous /
// constellar) and ItemRarity (common / uncommon / rare / epic / legendary) are DIFFERENT
// unions with ZERO members in common and different lengths: gear bands and warehouse item
// bands are separate content ladders that happen to share the word "rarity". Merging them
// or casting between them would silently mistune one ladder the moment the other grew a
// band. Two total maps means adding a band to EITHER union is a COMPILE ERROR in ITS OWN
// table, which is the only arrangement that keeps both honest.
//
// A TOTAL MAP, so a new rarity cannot become an item that silently multiplies by
// undefined (which is NaN, and a NaN duration is a bay occupied forever). The lookup is
// STILL guarded at the use site, because a hand-edited save can present a rarity string
// the union does not contain.
export const SALVAGE_EQUIPMENT_RARITY_MULTIPLIER: Record<EquipmentRarity, number> = {
  derelict: 1,
  standard: 1,
  augmented: 1,
  stellar: 1,
  radiant: 1,
  luminous: 1,
  constellar: 1,
};

// MULTIPLIER added per BLUEPRINT tier above T1 (BlueprintDef.tier, the Research-level
// gate the piece was unlocked behind). The multiplier is 1 + (tier - 1) * this, so T1 is
// ALWAYS exactly 1.0 by construction and the tunable only ever describes the STEP between
// tiers. RAISING THIS makes deeper-researched systems take proportionally longer to break
// down. 0 = tier is free, today's behavior.
//
// ⚠️ TIER IS NOT STORED ON THE INSTANCE. An EquipmentInstance carries no tier field at
// all; tier is a property of the BLUEPRINT that minted it, resolved at the call site
// through the piece's `blueprintKey` (see salvageJobDurationTicks in tick.ts). A
// Standard-Issue baseline has NO blueprint by construction (blueprintKey null), and a
// retired blueprint on an old save resolves to nothing, so BOTH land on the neutral T1
// rather than NaN, the same defensive posture the material arm takes for an item with no
// ITEMS entry.
//
// ⚠️ THE BLUEPRINT TABLE IS NOT ALL T1, so this tunable REALLY WOULD bite the moment it
// moved. Neutrality here is the 0, not an accident of the data, which is why the pin test
// sweeps every BLUEPRINTS entry rather than a sample.
//
// Multiplicative rather than additive because tier is CATEGORICAL: T1/T2/T3 are named
// research bands, not a continuous axis, and a band is the right thing to scale by.
export const SALVAGE_EQUIPMENT_TIER_MULTIPLIER_PER_TIER = 0;

// The FLOOR for a salvaged-material loot roll: what the cheapest possible material
// salvage costs before any of the item's own factors are applied. Held as its own
// constant rather than reusing SALVAGE_BASE_TICKS even though the two are equal today,
// because they answer different questions and will be tuned apart.
//
// ⚠️ THIS IS THE "SMALL BASE" THE 0.13.3 DURATION DIRECTION IS BUILT AROUND, and it is
// deliberately still 60 (the 2026-09-04 user decision). Under the factor model below it
// is expected to come DOWN, with the difference moved into the factors. Lowering it is a
// pure balance edit; nothing about the shape has to change to allow it.
export const SALVAGE_MATERIAL_TICKS = 60;

// ============================================================================
// The material arm's OWN FACTORS (Crafting 0.13.3 salvage-duration SEAM)
// ============================================================================
// ⚠️ EVERY CONSTANT IN THIS BLOCK IS NEUTRAL TODAY, ON PURPOSE. Each one is set to its
// IDENTITY value (0 for an additive weight, 1.0 for a multiplier), so the material arm
// still returns exactly SALVAGE_MATERIAL_TICKS for every item in the registry and every
// quality bucket. Nothing about the game's timings moves until one of these is retuned.
//
// WHY BUILD THE SEAM EMPTY: durations feed process creation, so this code is on the
// live/offline parity path. Widening it and tuning it in one motion would mean the
// parity gate can never tell "the shape changed" apart from "the numbers changed". The
// shape lands here with proof of no behavior change; the balance pass that follows is
// then a pure numbers edit that never has to open this function again.
//
// WHY THIS SHAPE: small base, ADDITIVE contributions from the NUMERIC axes, multipliers
// only from the CATEGORICAL axes, plus a hard ceiling.
//
// The rejected alternative is the obvious one: base * iLevel * tier * rarity * quality.
// It compounds. Four axes at a modest 2x each is already 16x, five is 32x, and that is a
// number you DISCOVER in play rather than one you choose, which is exactly how a common
// ore roll ends up taking an afternoon. So the numeric axes (quality here, iLevel on the
// equipment arm) contribute ADDITIVELY, where a coefficient means literally "this many
// ticks per point". Only the two CATEGORICAL axes are allowed to multiply, because they
// have few, named, hand-picked values whose product a designer can hold in their head.
// SALVAGE_MAX_TICKS then bounds the product no matter how those two are later tuned.

// Ticks ADDED per quality tier (0..QUALITY_TIERS-1) of the bucket a material salvage
// will draw from. RAISING THIS makes salvaging high-quality stock take longer than
// salvaging low-quality stock of the SAME item. 0 = quality is free, today's behavior.
// Additive because quality is a numeric rung, not a category.
export const SALVAGE_MATERIAL_TICKS_PER_QUALITY = 0;

// MULTIPLIER on the material duration for the item's own ItemDef.rarity. RAISING an
// entry makes that whole rarity band slower to break down; the ladder is meant to
// ascend (common cheapest, legendary dearest) once tuned. All 1.0 = rarity is free,
// today's behavior.
//
// A TOTAL MAP over ItemRarity, so adding a rarity to the union is a COMPILE ERROR here
// rather than an item that silently multiplies by undefined (which would be NaN, and a
// NaN duration is a bay occupied forever). The lookup is STILL guarded at the use site,
// because a hand-edited save can present a rarity string the union does not contain.
export const SALVAGE_MATERIAL_RARITY_MULTIPLIER: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 1,
  rare: 1,
  epic: 1,
  legendary: 1,
};

// MULTIPLIER added per warehouse TIER above T1 (ItemDef.tier). The multiplier is
// 1 + (tier - 1) * this, so T1 is ALWAYS exactly 1.0 by construction and the tunable
// only ever describes the STEP between tiers. RAISING THIS makes higher-tier materials
// take proportionally longer. 0 = tier is free, today's behavior.
//
// ⚠️ THE REGISTRY IS NOT ALL T1 (24 items at T1, 1 at T2 as of this patch), so this
// tunable REALLY WOULD bite the moment it moved. Neutrality here is the 0, not an
// accident of the data, which is why the pin test sweeps every ITEMS entry rather than a
// sample.
//
// Multiplicative rather than additive because tier is CATEGORICAL: T1/T2/T3 are named
// content bands, not a continuous axis, and a band is the right thing to scale by.
export const SALVAGE_MATERIAL_TIER_MULTIPLIER_PER_TIER = 0;

// THE CEILING: the largest duration ANY salvage arm may ever return, in ticks.
// 21600 ticks = 6 hours at the default one-second cadence.
//
// ⚠️ THIS IS A SAFETY RAIL, NOT A BALANCE NUMBER. It exists so that a future tuning pass
// on the multipliers above cannot accidentally mint a multi-day single salvage, which is
// the specific failure mode a multiplicative model produces: the player would see a bay
// locked for longer than they will play, with no way to cancel out of the mistake.
// It is set FAR above every real duration the game can currently produce (the longest is
// a battleship teardown at 400 ticks, and the largest conceivable equipment salvage is
// well under 3000), so it does not bind on any value today and cannot change behavior.
// LOWERING it toward real durations would start clamping and IS a balance change.
export const SALVAGE_MAX_TICKS = 21600;

// A hull teardown takes this SHARE of the time the hull took to build. Expressed as a
// divisor (3 = one third) so the relationship to the build is readable at the call site.
// This is what finally delivers the timed teardown the instant recycle path has been
// waiting for since the 0.11.1 emergency escape valve shipped.
export const SALVAGE_SHIP_BUILD_DIVISOR = 3;

// What salvageDurationTicks needs to know about a target, per arm.
//
// This deliberately mirrors SalvageTargetRef's three `kind`s while carrying NUMBERS
// instead of IDS. The split is the point: a TargetRef says WHICH thing (an id, which is
// all a save should store), a DurationSpec says WHAT IT COSTS (the numbers already read
// off that thing). Keeping them separate is what makes the duration math pure, so it
// needs no GameState, no equipment lookup and no recipe table to be tested. The caller
// (Unit 2.3/2.4) does the one lookup and hands the numbers over.
//
// ⚠️ BOTH THE MATERIAL AND THE EQUIPMENT ARM CARRY THE TARGET'S OWN CATEGORICAL
// ATTRIBUTES (Crafting 0.13.3 seam). The material arm used to be a bare
// `{ kind: "material" }`, which is why a common ore roll and a rare Damaged Reactor
// Housing cost the identical flat 60 ticks; the equipment arm used to carry only its two
// NUMERIC axes, which is why a derelict and a radiant piece of the same iLevel and
// quality cost the same. Neither spec carried anything categorical to balance ON. Both
// now do, so a balance pass has somewhere to land.
//
// THE FIELDS ARE REQUIRED, NOT OPTIONAL, deliberately, on BOTH arms. Optional-with-a-
// neutral-default would let a future call site forget one and silently get the cheapest
// duration forever; required fields make forgetting a COMPILE ERROR, the same posture the
// exhaustive switch below takes. Defensiveness lives in the arithmetic (every field is
// clamped), not in the type.
//
// ⚠️ THE TWO ARMS' `rarity` FIELDS ARE DIFFERENT TYPES ON PURPOSE: EquipmentRarity for a
// piece of gear, ItemRarity for a warehouse item. They share zero members. See
// SALVAGE_EQUIPMENT_RARITY_MULTIPLIER for why they are kept apart rather than merged.
export type SalvageDurationSpec =
  | {
      kind: "equipment";
      iLevel: number;
      quality: number;
      // EquipmentInstance.rarity, the gear band. A string rather than an ordinal so the
      // call site hands over what it actually read off the piece, with no lossy
      // conversion in between. NOT interchangeable with the material arm's ItemRarity.
      rarity: EquipmentRarity;
      // The tier of the BLUEPRINT that minted this piece (BlueprintDef.tier), which is
      // where tier lives: an EquipmentInstance has no tier field of its own. 1-based;
      // anything below 1 (a Standard-Issue baseline, which has no blueprint at all, or a
      // retired blueprint key on an old save) is treated as T1 by the arithmetic and
      // contributes no multiplier.
      tier: number;
    }
  | {
      kind: "material";
      // ItemDef.tier, the warehouse content band. 1-based; anything below 1 (an unknown
      // or legacy item) is treated as T1 by the arithmetic.
      tier: number;
      // ItemDef.rarity. A string rather than an ordinal so the call site hands over what
      // it actually read off the item, with no lossy conversion in between.
      rarity: ItemRarity;
      // The quality RUNG (0..QUALITY_TIERS-1) of the bucket this salvage will consume.
      //
      // ⚠️ READ AT START, WHILE THE CONSUME HAPPENS AT COMPLETION. A material salvage
      // draws ONE unit LOWEST-QUALITY-FIRST (salvage.ts, removeItemLowestFirst), so the
      // bucket is genuinely a specific one and genuinely knowable, but the caller reads
      // it when the job is SIZED and the draw happens when the job RESOLVES. If the
      // player acquires a cheaper unit mid-countdown, the job was priced on the bucket
      // that WOULD have been drawn at start. That is a snapshot, exactly like the
      // equipment arm reading a piece's stored iLevel at start, and it is what keeps the
      // duration a pure function of state-at-start and therefore identical live and
      // offline. It is NOT a promise about which unit finally disappears.
      quality: number;
    }
  | { kind: "ship"; buildDurationTicks: number };

// The ONE place a raw tick figure becomes a legal duration. Applied by EVERY arm so no
// arm can grow its own rounding or its own bounds.
//
// Three jobs, in order:
//   1. NON-FINITE REJECTION. NaN or Infinity survives arithmetic silently and produces a
//      countdown that never reaches 0, meaning a Salvage Bay slot occupied forever with
//      no player action able to clear it. Anything unusable falls back to the base
//      duration, which is merely wrong-ish rather than a soft lock.
//   2. CEIL then FLOOR AT 1. remainingTicks is decremented in whole ticks, so a
//      fractional duration never lands exactly on 0 and a 0 duration completes on its own
//      start tick. Both are correctness, not polish.
//   3. THE CEILING. See SALVAGE_MAX_TICKS: a safety rail against a future retune of the
//      multipliers minting a bay locked for days.
function clampSalvageTicks(raw: number): number {
  if (!Number.isFinite(raw)) return SALVAGE_BASE_TICKS;
  return Math.min(SALVAGE_MAX_TICKS, Math.max(1, Math.ceil(raw)));
}

// The ONE duration function, exhaustive over the three arms with no default branch, so a
// fourth salvage target arm becomes a COMPILE ERROR here rather than a target that
// silently gets some other arm's duration. Same posture as reservation.ts's bin().
//
// Per arm (design §7.2):
//   equipment  (base + iLevel * per-iLevel + quality * per-quality) * rarity multiplier
//              * tier multiplier, rounded UP. NEUTRAL TODAY: both multipliers are 1.0, so
//              every piece still costs exactly what the two numeric terms give. Same
//              factor shape as the material arm, over that arm's OWN rarity union.
//   material   (base + quality * per-quality) * rarity multiplier * tier multiplier,
//              rounded UP. NEUTRAL TODAY: the weight is 0 and both multipliers are 1.0,
//              so every material still costs exactly SALVAGE_MATERIAL_TICKS. See the
//              factor block above for why the numeric axis adds and the categorical
//              axes multiply.
//   ship       a share of the hull's OWN build time, so a battleship teardown costs more
//              than a frigate teardown without a second table to keep in sync
//
// EVERY ARM ENDS IN clampSalvageTicks, so whole-tick rounding, the floor of 1 and the
// SALVAGE_MAX_TICKS ceiling are applied identically and cannot drift per arm.
//
// DEFENSIVE ON EVERY INPUT: a hand-edited save, a legacy piece minted before iLevel
// existed, or a hull type with no build recipe can all present undefined, a negative or a
// NaN. A NaN duration would produce a countdown that never reaches 0, meaning a Salvage
// Bay slot occupied forever with no player action that can clear it. Clamping each input
// (and flooring the result at 1) turns every one of those into the base duration, which
// is merely wrong-ish rather than a soft lock.
//
// PURE and DETERMINISTIC: no rng, no state, no clock. That is what lets the same duration
// be computed on the live path and the offline path and agree exactly.
export function salvageDurationTicks(spec: SalvageDurationSpec): number {
  switch (spec.kind) {
    case "equipment": {
      // --- Clamp every input FIRST ------------------------------------------------
      // A hand-edited save, a legacy piece minted before iLevel existed, or a piece whose
      // blueprint has since been retired can present a negative, a NaN or (for rarity) a
      // string outside the union. Each one lands on the CHEAPEST neutral value, so the
      // worst case is the plain base duration.
      const safeILevel = Number.isFinite(spec.iLevel) && spec.iLevel > 0 ? spec.iLevel : 0;
      const safeQuality = Number.isFinite(spec.quality) && spec.quality > 0 ? spec.quality : 0;
      // Tier is 1-BASED: T1 is the floor of the research ladder, so anything below 1
      // (including the 0 a Standard-Issue baseline's absent blueprint reads as) is
      // treated as T1 and contributes no multiplier.
      const safeTier = Number.isFinite(spec.tier) && spec.tier > 1 ? spec.tier : 1;
      // The rarity table is total over EquipmentRarity, but `spec.rarity` can still
      // arrive as a string the union does not contain via a hand-edited save, and
      // `undefined * n` is NaN. Guarded explicitly rather than trusted, because the cost
      // of being wrong here is a stuck bay.
      const rarityMult = SALVAGE_EQUIPMENT_RARITY_MULTIPLIER[spec.rarity];
      const safeRarityMult = Number.isFinite(rarityMult) && rarityMult > 0 ? rarityMult : 1;

      // --- Additive numeric axes, then the categorical multipliers -----------------
      // The base plus the iLevel and quality terms is the "span"; rarity and blueprint
      // tier scale that span. Written in the same order as the material arm below, so
      // the eventual balance pass reads the two identically. BOTH MULTIPLIERS ARE
      // NEUTRAL TODAY (see the factor block above), so this evaluates to exactly the old
      // `base + iLevel * PER_ILEVEL + quality * PER_QUALITY` for every real piece.
      const span =
        SALVAGE_BASE_TICKS +
        safeILevel * SALVAGE_TICKS_PER_ILEVEL +
        safeQuality * SALVAGE_TICKS_PER_QUALITY;
      const tierMult = 1 + (safeTier - 1) * SALVAGE_EQUIPMENT_TIER_MULTIPLIER_PER_TIER;
      // Guarded for the same reason the rarity multiplier is: a retune that ever made the
      // per-tier step negative could drive this to or below 0, and a 0 duration completes
      // on its own start tick.
      const safeTierMult = Number.isFinite(tierMult) && tierMult > 0 ? tierMult : 1;

      return clampSalvageTicks(span * safeRarityMult * safeTierMult);
    }
    case "material": {
      // --- Clamp every input FIRST ------------------------------------------------
      // A hand-edited save, a legacy item, or an id with no ITEMS entry can present a
      // negative, a NaN or (for rarity) a string outside the union. Each one lands on
      // the CHEAPEST neutral value, so the worst case is the flat base duration.
      const safeQuality =
        Number.isFinite(spec.quality) && spec.quality > 0 ? spec.quality : 0;
      // Tier is 1-BASED: T1 is the floor of the ladder, so anything below 1 (including a
      // missing ITEMS entry read as 0) is treated as T1 and contributes no multiplier.
      const safeTier = Number.isFinite(spec.tier) && spec.tier > 1 ? spec.tier : 1;
      // The rarity table is total over the union, but `spec.rarity` can still arrive as
      // a string the union does not contain via a hand-edited save, and `undefined * n`
      // is NaN. Guarded explicitly rather than trusted, because the cost of being wrong
      // here is a stuck bay.
      const rarityMult = SALVAGE_MATERIAL_RARITY_MULTIPLIER[spec.rarity];
      const safeRarityMult = Number.isFinite(rarityMult) && rarityMult > 0 ? rarityMult : 1;

      // --- Additive numeric axis, then the categorical multipliers ----------------
      // The base plus the quality term is the "small span"; rarity and tier scale that
      // span. Written in this order so the eventual balance pass reads the same way the
      // design describes it. ALL THREE FACTORS ARE NEUTRAL TODAY (see the factor block),
      // so this evaluates to exactly SALVAGE_MATERIAL_TICKS for every real item.
      const span = SALVAGE_MATERIAL_TICKS + safeQuality * SALVAGE_MATERIAL_TICKS_PER_QUALITY;
      const tierMult = 1 + (safeTier - 1) * SALVAGE_MATERIAL_TIER_MULTIPLIER_PER_TIER;
      // Guarded for the same reason the rarity multiplier is: a retune that ever made
      // the per-tier step negative could drive this to or below 0, and a 0 duration
      // completes on its own start tick.
      const safeTierMult = Number.isFinite(tierMult) && tierMult > 0 ? tierMult : 1;

      return clampSalvageTicks(span * safeRarityMult * safeTierMult);
    }
    case "ship": {
      const build = spec.buildDurationTicks;
      // No usable build time falls back to the FLOOR, not to 0: an unknown hull should
      // still take a moment to tear down, and 0 would complete on its own start tick.
      if (!Number.isFinite(build) || build <= 0) return SALVAGE_BASE_TICKS;
      return clampSalvageTicks(build / SALVAGE_SHIP_BUILD_DIVISOR);
    }
  }
}

// ITEM LIFECYCLE 0.13.6 (Armory, Phase 3). A LOADOUT is a saved ship-equipment set, pinned to a
// ship TYPE (which fixes its slots, so it can never be over-armed). `slots` maps a slot key to the
// committed EquipmentInstance id it holds, or null for an empty slot. `checkedOutToShipId` is the
// back-reference to the ship currently flying this set (at most one); a checked-out loadout locks
// that ship's own install screen (edit it here in the Armory instead). DORMANT until the Armory build.
export interface Loadout {
  id: string; // "loadout-N", allocated from GameState.nextLoadoutId
  name: string;
  shipTypeKey: ShipTypeKey;
  slots: Record<string, string | null>; // slot key -> committed EquipmentInstance id, or null (empty)
  checkedOutToShipId: string | null; // the ship flying this set, or null (available)
}

// ITEM LIFECYCLE 0.13.6: one Archive slot's stored best. `score` is the completion figure; `rarity`
// and `quality` (added v54) record WHAT the best enshrined roll was, so the console shows it back.
// They are optional because a pre-v54 entry (migrated from a bare number) carries only the score
// until the item is re-enshrined.
export type ArchiveEntry = { score: number; rarity?: EquipmentRarity; quality?: number };

// --- Crew 0.14.0 (Phase 0: content-free, DORMANT data model) -------------------------------
// The crew layer's persisted shapes land here first, additive + dormant, so the save shape
// moves ONCE at the start of the release (the same posture the 0.13.6 item-lifecycle fields
// used). NOTHING reads or writes any of this yet: the engine seams (rollup overlay, transports,
// auto-crew, roster refresh), the race/species + bonus CONTENT, and the seeded generator all
// arrive in later phases. Design source: docs/plans/2026-09-22-crew-0.14.0-plan.md ("Data model").
//
// WHY BUCKETS, NOT PEOPLE: a crewmember's mechanically relevant identity is a finite SIGNATURE
// (profession + rarity + rank + race + bonus); two crew with the same signature contribute
// identically to every rollup, differing only in name/gender (pure flavor). So a complement of
// 1,017 crew persists as a few dozen bucket rows keyed by signature, not 1,017 objects. Save
// weight and tick cost scale with distinct buckets, not headcount.

// The six complement PROFESSIONS (LOCKED with the user 2026-09-22). Each is one rollup-bucket
// dimension with its own per-type cap. "flightDeck" is the Flight/Deck branch.
export type CrewProfession =
  | "security"
  | "engineering"
  | "science"
  | "medical"
  | "operations"
  | "flightDeck";

// Crew reuse the existing equipment rarity ladder (derelict..constellar), NOT a parallel ladder,
// so a single rarity vocabulary threads the whole game.
export type CrewRarity = EquipmentRarity;

// The crew race roster (LOCKED with the user 2026-09-22): 6 human origins + 4 allied species.
// Each origin AND species is its own signature dimension. The finite CREW_RACES table (crewRaces.ts)
// keys off this union for the racial bonus and the inclusive name/gender generator; the four species
// are NEW canon (prior lore had aliens only as antagonists). Gender is cosmetic (see CREW_GENDERS),
// not on the signature.
export type CrewRace =
  | "earthBorn"
  | "martian"
  | "belter"
  | "outerColony"
  | "stationBorn"
  | "spacer"
  | "vael"
  | "ossir"
  | "stheni"
  | "draell";

// The 8-tier complement rank ladder (LOCKED). 1-4 = enlisted Crewman/Petty Officer/Chief/Master
// Chief; 5-8 = officer track Cadet/Ensign/Lieutenant/Lieutenant Commander. Rank gates BUFF COUNT
// (crewRank.ts buffCountForRank) and command tier, and scales magnitude modestly; it is locked at
// generation (complement crew never level individually). Commander is Senior-Staff-only (OfficerRank).
export type CrewRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// A rolled crew buff, identified by a stable string key into the Phase 0.5 buff pools
// (CREW_PROFESSION_BUFFS + SECOND_LEVEL_EXCLUSIVE in crewBuffs.ts). buff1 is always present; buff2
// only at higher ranks.
export type CrewBuffId = string;

// The mechanically distinct crew identity. NO name/gender: those are pure flavor, generated
// lazily and deterministically only when a manifest view is opened, never persisted. The GENERATOR
// caps rarity at "stellar" (crewRarity.ts CREW_RARITY_CAP); the type keeps the full ladder.
export interface CrewSignature {
  profession: CrewProfession;
  rarity: CrewRarity;
  rank: CrewRank;
  race: CrewRace;
  buff1Id: CrewBuffId; // the primary rolled buff (always present)
  buff2Id: CrewBuffId | null; // a 2nd buff at higher ranks only (profession pool OR the exclusive pool); null otherwise
}

// A histogram bucket: how many identical-signature crew sit together. The persisted unit of a
// complement (and of the unassigned pool) is a list of these, not a list of people.
export type CrewBucket = CrewSignature & { count: number };

// A ship's crew population. `mode` is the per-ship (== per assigned captain) passive/active
// toggle. `buckets` holds only populated buckets.
export interface ShipComplement {
  buckets: CrewBucket[];
  mode: "passive" | "active";
}

// A "standout" the player plucked out of a bucket into a bounded, named roster. This is the ONLY
// place a complement crewmember becomes a full object, and it is bounded by design (graduating
// one drops its origin bucket's count by one; crewGraduation.ts graduateStandout). Notables are
// IDENTITY ONLY (user 2026-10-16, "Let's keep it identity only"): a name and a record, no stat edge;
// aboard a ship one counts exactly like one crew of its signature.
//
// The bound (CP-8, OC-8, user 2026-10-16 "50 fleet-wide (Recommended)"): at most this many notables
// across the whole fleet, assigned or not. Graduating refuses at the cap.
export const NOTABLE_CREW_CAP = 50;

export interface NotableCrewMember {
  id: string;
  profession: CrewProfession;
  rarity: CrewRarity;
  rank: CrewRank;
  race: CrewRace;
  buff1Id: CrewBuffId; // mirrors the CrewSignature buff shape (see above)
  buff2Id: CrewBuffId | null;
  name: string;
  gender: string;
  favorite?: boolean;
  // Crew 0.14.0 (Phase C-2): a notable can be ASSIGNED to a ship (mirrors the officer's
  // assignedShipId authority). A pinned+applied notable occupies ONE complement slot of its
  // rank/division on top of the fungible bucket bulk. Optional + ADDITIVE: an absent value reads
  // as unassigned (null), so an old save needs no field-level migration for it (the personnelRosters
  // v56->v57 migration only adds the two fleet-wide roster fields). Graduation assigns the new notable
  // to its ship; applyRoster assigns pinned ones; "send back" (crewGraduation.ts sendBackNotable)
  // unassigns. An assigned notable feeds the crew overlay like one crew of its signature (GL-1,
  // crewOverlay.ts rawShipCrewContribution) and holds its slot in every cap check (auto-crew,
  // transfer, applyRoster).
  assignedShipId?: string | null;
}

// --- Senior Staff = few, named, full objects (fine to persist per-person) ---------------------
// The 7 bridge seats (LOCKED with the user 2026-09-22). "operations" is the Operations Officer
// (logistics/cargo/unload). There is deliberately no security OFFICER seat (internal security is
// a complement branch) and no communications seat yet (nothing to buff).
export type SeniorStaffSeat =
  | "executive"
  | "pilot"
  | "operations"
  | "science"
  | "tactical"
  | "medical"
  | "engineering";

// The promotion ladder for a Senior Staff officer (rank-up scales bonus magnitude), FIVE tiers
// starting at CADET (Phase 1 refinement, user 2026-09-23; Phase 0 had four starting at ensign).
// A freshly rolled officer starts at "cadet"; promotions climb toward "commander" (the top,
// Senior-Staff-only rank that crowns the shared crew/officer continuum). Ladder display names
// come from seniorStaff.ts (officerRankLabel); these are the stable keys.
export type OfficerRank = "cadet" | "ensign" | "lieutenant" | "lieutenantCommander" | "commander";

// The KIND of a Senior Staff promotion objective (Crew 0.14.0 C-1). A CLOSED union on purpose: adding
// a new objective kind is a deliberate compile-time decision. It lives here beside OfficerRank /
// SeniorStaffSeat so the persisted SeniorStaffOfficer.promotionCounters can key on it without a
// circular import back into seniorStaff.ts (which owns the objective SETS + gating logic). Every kind is
// fed since WR-4 (B4; seniorStaff.ts officerPromotionCounter lists what feeds each).
export type PromotionObjectiveKind =
  | "missionsCompleted"
  | "shipsDestroyed"
  | "crewHours"
  | "personnelAchievement";

// One of the two bonuses rolled onto an officer. `id` keys the (Phase 0.5) officer bonus
// catalog; `magnitude` scales with rank.
export interface OfficerBonus {
  id: string;
  magnitude: number;
}

// A named bridge officer. Flat on GameState.officers (keyed to a ship by assignedShipId + seat),
// mirroring the equipment[] / fittedToShipId precedent rather than a per-ship sub-record.
export interface SeniorStaffOfficer {
  id: string;
  seat: SeniorStaffSeat;
  name: string;
  race: CrewRace;
  gender: string;
  rank: OfficerRank;
  bonuses: [OfficerBonus, OfficerBonus]; // exactly two rolled bonuses
  missionsCompleted: number; // LIVE promotion counter (folded from mission cycles, crewOverlay.ts)
  // Optional, ADDITIVE per-officer counters for the OTHER promotion objective kinds (shipsDestroyed /
  // crewHours / personnelAchievement); missionsCompleted keeps its own dedicated field above. Fed since
  // WR-4 (B4: crewOverlay.ts foldOfficerPromotionCounters), starting at 0 (user: no backfill);
  // officerPromotionCounter reads a missing entry as 0, so this needs NO SAVE_VERSION bump (an old save
  // simply lacks it), the established optional-additive field convention (e.g. favorite / weaponType).
  // crewHours is fractional (hours, accrued per tick); the checklist shows it rounded down.
  promotionCounters?: Partial<Record<PromotionObjectiveKind, number>>;
  assignedShipId: string | null; // mirrors EquipmentInstance.fittedToShipId authority; null = unassigned
  // Crew 0.14.0 (Phase C-2): favoriting parity with NotableCrewMember (which already carries
  // `favorite?`), so the Personnel Rosters builder can favorite an officer the same way ships/items
  // are favorited. Optional + ADDITIVE (an absent value reads as not-favorited), so an old save needs
  // no field-level migration. Pure UI/curation flag; nothing mechanical reads it.
  favorite?: boolean;
  // E-CREW (D13, design section 7): the officer's four stats, each a FACET of the department the
  // officer heads (they act on the ship + on-ship crew only, never ground teams). Rolled 1..20 per stat
  // on the candidate board and copied on hire; each promotion adds points (E-CREW Task 19). OPTIONAL
  // only so old fixtures still compile: the v64->v65 + v65->v66 migrations (save.ts) fill it on load via
  // seniorStaff.ts rollOfficerStats, and readers go through seniorStaff.ts officerStats, which reads an
  // absent value as the neutral line. The facets that consume it land in Task 21.
  stats?: OfficerStats;
}

// ===== E-CREW "Crew Made Real": the AWAY TEAM roster + squad loadouts (DORMANT) =====
// docs/plans/2026-10-02-crew-made-real-e-crew-design.md sections 2 and 4. The away team is a
// DEDICATED roster of persistent NAMED members per ship (D1), stored like Senior Staff officers: a few
// full objects in a flat GameState.awayMembers array, keyed to a ship by assignedShipId. These shapes
// land DORMANT (Task 2): nothing reads or writes them yet; recruitment, gear, the expedition rework and
// the Armory squad loadouts wire them in later tasks.

// The away squad types, a DATA LIST and never a binary (D2): Security fights, Science does fieldwork.
// "prospecting" (user group 4, 2026-10-16: design docs/plans/2026-10-16-prospecting-squads-design.md) is
// BUILT but HIDDEN: specs, traits, recruits, gear, team slots and Standard-Issue rows all exist, and every one
// of them stays out of reach until the per-save unlock (GameState.prospectingSquadsUnlocked, prospecting.ts
// squadTypeUnlocked) that a quest step sets in the prospecting quests patch. Prospecting never fights.
export type AwayTeamType = "security" | "science" | "prospecting";
export const AWAY_TEAM_TYPES: readonly AwayTeamType[] = ["security", "science", "prospecting"];

// A member's specialty within its squad type. Security members specialize in offense / defense /
// debuff; Science members in one fieldwork discipline; Prospecting members in one ROLE (user 2026-10-16:
// Excavation lifts YIELD, Drilling lifts FIELD and HAZ, Assaying lifts GRADE; prospecting.ts
// PROSPECTING_SPEC_BASE).
export type SecuritySpec = "offense" | "defense" | "debuff";
export type ScienceSpec = "archaeology" | "xenobiology" | "geology" | "cryptography";
export type ProspectingSpec = "excavation" | "drilling" | "assaying";
export type AwayMemberSpec = SecuritySpec | ScienceSpec | ProspectingSpec;

// A rolled away-team trait id, a stable string key into the trait catalog (awayTraits.ts AWAY_TRAITS).
// Deliberately a plain string, not a closed union: it is persisted on members, so a save can carry an id
// a later catalog retires, and readers look it up through getAwayTrait (which tolerates unknown ids).
export type AwayTraitId = string;

// One named away-team member. Few, named, full objects (like SeniorStaffOfficer, unlike the bucketed
// complement), so persisting per person is fine. NOTE: `spec` is not yet tied to `teamType` at the
// type level (a Security member could carry a Science spec); a specsFor(teamType) validator lands with
// recruitment.
export interface AwayMember {
  id: string; // "member-N" from GameState.nextAwayMemberId; never reused
  teamType: AwayTeamType;
  spec: AwayMemberSpec; // must belong to teamType's spec set (validated at recruitment, not by the type)
  name: string;
  race: CrewRace;
  gender: string;
  // ROLLED at generation on the shared 8-tier CrewRank ladder and NEVER levels (D6); it gates trait
  // count and nudges magnitude, like the complement.
  rank: CrewRank;
  traits: AwayTraitId[]; // rolled trait ids; the count follows rank
  assignedShipId: string | null; // the ship whose squad holds the member (the authority, like officers); null = unassigned
  injuredUntilSeconds?: number; // gameTimeSeconds the member recovers at (D9); absent = ready
  // E-CREW 0.14.0 (Task 16): gameTimeSeconds the current injury began (the expedition claim), so the
  // recovery bar can show the share already recovered of THIS injury's own span (Medical shortens spans).
  // Written with injuredUntilSeconds; absent on a member injured before Task 16 (the bar then measures
  // against the 2h base, injuries.ts injuryRecoveredFraction). Optional and absent-safe: no SAVE_VERSION bump.
  injuredAtSeconds?: number;
  // The member's OWN gambit program (D16, Security only). ABSENT = the built-in DEFAULT_MEMBER_GAMBIT (D19,
  // user 2026-10-06: full targeting / attack / defense coverage, NO automatic kit use), frozen into the
  // roster snapshot at dispatch. NOT linked to the account-level state.gambitPrograms.
  gambit?: GambitProgram;
  favorite?: boolean; // curation flag only, parity with officers / notables
  // The recruit-board candidate id this member was hired from ("away-candidate-<window>-<slot>"). The
  // board is derived and never persisted, so this is the only record that a candidate was taken: the
  // board drops any candidate a current member was hired from, which makes a second hire of the same
  // candidate refuse. Optional + additive (absent on any member made some other way), so no migration.
  hiredFrom?: string;
}

// An officer's four stats (D13, design section 7). Each is a FACET of the department the officer
// heads and acts on the ship + on-ship crew only, never on ground teams. Rolled per officer (Task 19,
// seniorStaff.ts); 10 is the neutral point (NEUTRAL_OFFICER_STATS).
export interface OfficerStats {
  strength: number;
  integrity: number;
  cunning: number;
  constitution: number;
}

// One member's kit inside a squad loadout (D3: gear is per member, Armor + Weapon + Tool + implants).
// Each slot holds an EquipmentInstance id, or null for an empty slot.
export interface SquadLoadoutKit {
  armor: string | null;
  weapon: string | null;
  tool: string | null;
  implants: string[];
  // Ground Ops GO-17: the slot E-CREW Task 16b's Squad Kit fills (stackable Field Kit consumables, kit id -> count).
  // Field Kits FKR-7 (FK4 "One per member"): the member's PACK. createGroundTeamLoadout writes the slotted member's pack
  // preference (ShipGroundTeam.packs) here; applyGroundTeamLoadout writes it back as that slot's member's preference.
  // ABSENT = the loadout carries no pack (the member's preference is left as it is). Optional + absent-safe: no
  // SAVE_VERSION bump (the Task 12-14 precedent).
  consumables?: Record<string, number>;
}

// A saved SQUAD LOADOUT in the Armory, reshaped PER GROUND TEAM by Ground Operations GO-1 (D25: "Squad
// Loadouts (Task 18) save per ground team, not per team type"; it replaces the Task 2 per-team-TYPE
// SquadLoadout, which no build ever created). A named set of member kits for one whole ground team: one
// kit per Security slot and one per Science slot, in slot order. Gear only: who is slotted stays a
// Personnel choice. `checkedOutTo` marks the ground team currently wearing it (null = in the Armory). Ids
// are "squad-N", minted from GameState.nextSquadLoadoutId (GO-17); never reused. The engine (create / apply /
// check-in, the shared loadoutCap) lives in armory.ts.
export interface GroundTeamLoadout {
  id: string;
  name: string;
  // Squads SQ-1 (v68): the team KIND this loadout's kit lists are shaped for. ABSENT = "ground". A loadout
  // applies only to a team of the same kind (GO-17: armory.ts applyGroundTeamLoadout refuses "wrongKind").
  kind?: GroundTeamKind;
  security: SquadLoadoutKit[];
  science: SquadLoadoutKit[];
  checkedOutTo: { shipId: string; teamIndex: number } | null;
}

// The base size of the Senior Staff candidate roster (Phase 1; user 2026-09-23, "base 10,
// EXPANDABLE via an upgrade"). freshState seeds seniorStaffRosterSize to this; a later upgrade
// raises the stored value. FIRST-PASS + TUNABLE.
export const SENIOR_STAFF_ROSTER_BASE = 10;

// The default per-save roster seed a fresh save starts from, and the value the v55->v56 migration
// backfills onto existing saves (so a fresh save and a migrated save land on the IDENTICAL shape,
// the established crew-migration convention). A fixed nonzero constant keeps freshState fully
// deterministic (the whole suite relies on that); it is a good PRNG mixing start (the golden-ratio
// fractional-bits constant the combat RNG also uses). Per-save reseeding is a later option and is
// not observable while the engine is dormant. TUNABLE.
export const SENIOR_STAFF_DEFAULT_SEED = 0x9e3779b9;

// E-CREW: the per-save AWAY RECRUIT seed is DERIVED from the Senior Staff seed with a fixed XOR salt,
// so the two candidate boards are decorrelated yet both stay fully deterministic. freshState AND the
// v64->v65 migration (save.ts) both call this, so a fresh save and a migrated save land on the
// identical value. Do NOT reuse the salt for another purpose.
export const AWAY_RECRUIT_SEED_SALT = 0x5a17c0de;
export function awayRecruitSeedFrom(seniorStaffSeed: number): number {
  return ((seniorStaffSeed >>> 0) ^ AWAY_RECRUIT_SEED_SALT) >>> 0;
}

// --- Crew 0.14.0 (Phase C-2): PERSONNEL ROSTERS -----------------------------------------------
// A ROSTER is a NAMED, priority-ordered set of PINNED people (officers by seat + notable crew) plus
// a fill policy, applied to a ship and CAPPED by that ship's real caps. It is the personnel
// counterpart to a Loadout: where a Loadout saves a ship's GEAR, a roster saves its PEOPLE. Applying
// a partial roster auto-completes the complement with RANDOM bulk crew (top-rank-down), NOT persisted
// back to the roster (see personnelRosters.ts applyRoster). The optional Armory-loadout link is the
// per-roster toggle from the synthesis: linked = exact caps + gear travel as a "ship + gear + people"
// package; unlinked = portable, capped by whatever hull it is applied to. applyRoster applies the
// linked loadout's GEAR first (S4-CP39, Ground Ops GO-17, via armory.ts check-in / check-out), then PEOPLE.
//
// WHY ONLY INDIVIDUALS ARE PINNED (COMPLEMENT PRIORITY MODEL, user 2026-09-24): officers + notable
// crew are individual records with ids, so they pin by id in a reorderable PRIORITY order; the BULK
// complement is fungible histogram buckets (no per-head identity), so it is NOT individually pinnable
// and simply AUTO-FILLS to cap honoring the pins.
export interface PersonnelRoster {
  id: string; // "roster-N", allocated from GameState.nextRosterId (mirrors nextLoadoutId / nextShipId)
  name: string;
  linkedLoadoutId: string | null; // optional link to an Armory Loadout (the capacity/gear source of truth); null = unlinked/portable
  includePeople: boolean; // the checkbox: whether this roster carries Senior Staff + Complement people at all
  seatAssignments: Partial<Record<SeniorStaffSeat, string>>; // seat -> the pinned officer's id (absent seat = unpinned)
  pinnedNotableCrew: string[]; // pinned NotableCrewMember ids, in PRIORITY order (index 0 = highest priority)
  // Ground Ops GO-17 UI (user S14 "rosters link squad loadouts one per team"): the Armory GROUND TEAM
  // loadout (GroundTeamLoadout id, "squad-N") linked to each ground team by team INDEX (0 = Alpha), null =
  // no link for that team. applyRoster puts each one on its team (personnelRosters.ts). ABSENT = no links;
  // optional + absent-safe, so no SAVE_VERSION bump (the Task 12-14 precedent).
  linkedSquadLoadoutIds?: (string | null)[];
}

// ============================================================================
// Exploration 0.14.0 (Phase E2a): the long-distance EXPEDITION state machine
// ============================================================================
//
// An EXPEDITION is the big semi-idle exploration mode (design Part I.2). It is its OWN top-level
// GameState record (state.expeditions), NOT a CaptainMissionState: a mission is a captain-bound
// closed-form transit/scan/return cycle resolved inside the captain map, whereas an expedition is a
// system-level, multi-phase, multi-body state machine that outlives many mission cycles and carries
// its own bodies + findings. It still BINDS a ship + captain (shipId + captainId) the way a mission
// binds a captain, but as a separate structure so the two never entangle.
//
// ⚠️ E2a SCOPE: the ENGINE + a GENERIC body model ONLY. A body here is generic (a scan size, a hazard
// scalar, a discovered-token list, a placeholder activity list). PLANET TYPES + a named PoI/landmark
// catalog are E2b; the real away-team GAMBIT activity resolver is E3 (E2a resolves activities through
// a deterministic PLACEHOLDER resolver, see expedition.ts); relics/research/museum are E4. The seams
// below (ExpeditionActivity.done, ExpeditionFinding.source, the generic discovery kinds) are shaped so
// those later phases swap in without reshaping the record.
//
// ⚠️ DETERMINISM / PARITY: every seeded outcome (the anomaly chart, per-body discoveries, activities)
// is a PURE function of the expedition's own `seed` + a fixed salt + an index, NEVER a live PRNG
// stream position and NEVER Date.now()/Math.random(). Combined with resolving all intra-phase state
// from ELAPSED gameTimeSeconds (see expedition.ts advanceExpedition), this makes one big offline
// catch-up window byte-identical to many small live ticks BY CONSTRUCTION (the crown-jewel invariant).

// The phases an expedition passes through, in order. TRANSIT (fly out) -> SCANNING (survey each body
// to 100%) -> ACTIVITIES (ground-team tasks, placeholder-resolved in E2a) -> RETURN (fly home) ->
// COMPLETE (findings claimable). MISSION-like transit/do/return, but system-scoped + multi-body.
export type ExpeditionPhase = "transit" | "scanning" | "activities" | "return" | "complete";

// The 8 PLANET TYPES a body can be (Exploration 0.14.0, Phase E2b; LOCKED from the approved Expedition
// Console mockup 2026-09-30). The type gates which discoveries appear + their odds and carries a hazard
// scalar (expeditionContent.ts PLANET_TYPES). Persisted on ExpeditionBody, so it is a plain string union
// here (the catalog DATA + weights live in expeditionContent.ts, which imports this type; model.ts does
// NOT import expeditionContent.ts, so there is no import cycle -- the same one-way arrow sensorArrays.ts
// has with model.ts). "gasGiant" is orbital-only (no surface landing; its finds are satellite ops).
export type ExpeditionPlanetType =
  | "terrestrial"
  | "ocean"
  | "arid"
  | "volcanic"
  | "frozen"
  | "gasGiant"
  | "barren"
  | "toxic";

// A discovery deposited when a body finishes scanning. E2a kept it GENERIC (a kind + an id); E2b makes
// it REAL + type-gated: `poiId` names a concrete Point of Interest from the POI_CATALOG
// (expeditionContent.ts), drawn from the body's planetType eligible pool. `kind` stays as the cheap
// pool tag (surface landmark vs underground PoI, mirroring the sensor array's two discovery-odds
// biases); the pool is also derivable from the PoI's `pool`, so `kind` is a denormalized convenience.
export interface ExpeditionDiscovery {
  id: string; // stable, "<expeditionId>-<bodyId>-disc-<n>"
  kind: "landmark" | "underground";
  poiId: string; // the POI_CATALOG id this discovery resolved to (expeditionContent.ts)
}

// A ground-team task generated at a body's 100% scan. E2a resolves it through a PLACEHOLDER resolver
// (expedition.ts) that just flips `done` + grants one placeholder finding; E3 swaps in the real gambit
// away-team combat WITHOUT reshaping this record (it keeps `done` as the completion flag). E2b names the
// task by the PoI it came from (`poiId`); the E2c UI flavors it by that PoI + the body's planetType
// (e.g. a gasGiant task reads as "satellite ops").
export interface ExpeditionActivity {
  id: string; // stable, "<expeditionId>-<bodyId>-act-<n>"
  bodyId: string;
  poiId: string; // the PoI this task came from (expeditionContent.ts POI_CATALOG id)
  done: boolean; // set by the resolver when the task completes
  // E-CREW 0.14.0 (Task 16): the Security members DOWN at the end of this task's battles (every attempt,
  // in order of first going down), written when the task resolves and only when someone went down. With
  // ExpeditionScanEvent.downedMemberIds it is the run's record of who SITS OUT the rest of the run (user
  // rule, 2026-10-07) and who comes home injured at claim (injuries.ts). OPTIONAL and absent-safe (absent =
  // nobody went down), so no SAVE_VERSION bump: a task resolved before Task 16 simply records no one.
  downedMemberIds?: string[];
  // Ground Operations 0.14.0 (GO-4, D25): the TASK fields of a Ground Ops run (groundTasks.ts reads them;
  // GO-7b stamps them when a body's scan completes). ALL OPTIONAL and absent on a legacy run's activities, so
  // no SAVE_VERSION bump and every legacy record keeps its exact shape. `done` stays the completion flag and
  // mirrors status === "done".
  // GO-7c: ground teams the task needs together (content wiring; no content sets it). Squads SQ-3: READ ONLY,
  // as the carry-forward of `needs` (N teams = { security: N, science: N }); a task stamped since SQ-3 stores
  // `needs` instead, a task stamped before keeps its requiredTeams (groundOps.ts taskNeedsOf reads both).
  requiredTeams?: number;
  // Squads SQ-3 (design section 3.2): the minimum SQUADS of each type the task's crew must bring. Stamped when
  // the body's scan completes (groundOps.ts initGroundTasks); absent on tasks stamped before SQ-3 (read
  // through requiredTeams). A task with fight points always needs at least 1 Security squad.
  needs?: GroundTaskNeeds;
  // Squads SQ-3 (user #5): the chance an UNKNOWN-RISK ambush strikes a crew with no Security squad on this
  // task (a survey-only task: no fight points). Stamped only when above 0 (groundOps.ts
  // groundTaskAmbushChance; 0 for every task until the risk factors land, SQ-4), so absent = 0.
  // Squads SQ-4: a risk-aware task's chance is read off its body's risk (riskFactors.ts riskAmbushChance), and a
  // crew WITH a Security squad meets the ambush as a SURPRISE FIGHT where it stands (user, SQ-3 calls (c)).
  ambushChance?: number;
  ambushes?: number; // ambushes this task has suffered (keys the next roll; absent = 0)
  // Squads SQ-4 (design section 4): the task's DIFFICULTY grade, 1 Simple, 2 Standard, 3 Challenging,
  // 4 Dangerous, 5 Deadly, rated ONCE when a risk-aware task is stamped (never recomputed from live state). It
  // weights the run's completion and raises the haul and relic odds (user #6). Absent on every other task.
  difficulty?: number;
  fightPoints?: number[]; // ascending progress fractions in (0, 1) (groundTasks.ts fightPointFractions)
  progress?: number; // 0..1, PERSISTS across losses (user 9b.1)
  pointsCleared?: number; // fights won; the next fight is fightPoints[pointsCleared]
  segmentsBanked?: number; // segments finished (haul earned), 0..fightPoints.length + 1
  segmentsOffloaded?: number; // segments already offloaded into exp.findings
  fightCount?: number; // fights started on this task (keys "a fresh encounter per attempt", user 9b.2)
  status?: "queued" | "active" | "done" | "skipped";
  assignedTeamIds?: number[]; // owner ground team index(es) on the ship
  // Ground Operations (GO-7b), the timeline engine's bookkeeping, all optional and absent on legacy records:
  //   segmentBankers : per finished segment s, the ground team index(es) that banked it (the yield of THAT
  //                    team set scales the segment's haul at offload, GO-7a review); absent until a bank.
  //   completedAt    : gameTimeSeconds the task reached 100% (its relic roll's clock; display).
  //   lossStreak     : consecutive failed attempts that cleared no new fight point; absent = 0. At
  //                    GROUND_STUCK_LOSSES the task goes to the BACK of its team's queue (user 2026-10-12) and the
  //                    streak resets when the task is tried again.
  //   sentBack       : how many times the task went to the back of the line since it last cleared a new fight
  //                    point (groundOps.ts groundTaskStuck reads it); absent = 0, cleared by a point won.
  segmentBankers?: number[][];
  completedAt?: number;
  lossStreak?: number;
  sentBack?: number;
  // Objective affixes (AF-1, user 2026-10-14; affixes.ts). Stamped only on an AFFIX-AWARE run (its risk profile
  // carries `difficultyTier`, every run dispatched since AF-1), all optional and absent on every other task:
  //   affixes         : the affixes the objective rolled (or was required to carry) when it was stamped; absent
  //                     when it has none. Fixed for the run.
  //   difficultyScore : the difficulty SCORE its grade was rated from (riskFactors.ts taskDifficultyScore), so an
  //                     ALERT can raise the rating (affixes.ts objectiveDifficultyAt) without re-deriving it.
  //   alert           : the objective's current ALERT (Reinforcing: every retreat or wipe here raises it), stored
  //                     at the setback; it lapses on its own once the reset time passes (a pure function of these
  //                     values and the time) and the record is cleared at that instant. Absent = no alert.
  //   visits          : crews landed on it so far (keys the per-visit extra-battle roll); absent = 0.
  affixes?: ObjectiveAffix[];
  difficultyScore?: number;
  alert?: ObjectiveAlert;
  visits?: number;
}

// Objective affixes (AF-1, user 2026-10-14: "Affixes ... a new system that we should honestly make use of
// elsewhere in the project too"). The definitions live in affixes.ts; the stored shapes live here so model.ts
// never imports an engine module.
// AF-2 adds Rocky Outcroppings (terrain cover against long-range attacks; positive, neutral or negative).
export type AffixId = "reinforcing" | "rockyOutcroppings";
// An affix rolls exactly ONE alignment (user: "Some can roll into more than one, but only one at a time"):
// positive (good for the player, green), neutral (both sides, yellow) or negative (bad for the player, red).
export type AffixAlignment = "positive" | "neutral" | "negative";
export interface ObjectiveAffix {
  id: AffixId;
  rank: number; // 1.. the affix's ranks (Reinforcing I, II, III)
  alignment: AffixAlignment;
}
// An objective's ALERT (Reinforcing): `level` setbacks in a row, the last at `lastAt` (gameTimeSeconds). It holds
// until lastAt + the affix's reset time, then the objective returns to normal ("the threat appears to have
// retreated", user).
export interface ObjectiveAlert {
  level: number;
  lastAt: number;
}

// Squads SQ-3: a task's squad requirement, in SQUADS of each type (a Ground team brings { 1, 1 }, a Strike team
// { 2, 0 }, a Survey team { 0, 2 }; a crew of several teams sums them).
export interface GroundTaskNeeds {
  security: number;
  science: number;
}

// Squads SQ-4 (design section 5): RISK FACTORS. Every factor reads on one five-step scale, 0 None, 1 Low,
// 2 Moderate, 3 High, 4 Extreme (user-approved names and scale, #11). riskFactors.ts draws them; the types live
// here so ExpeditionBody / Expedition can carry them without model.ts importing an engine module.
export type RiskGrade = 0 | 1 | 2 | 3 | 4;
// The expedition REGION TIERS I to VII (2026-10-08 gas giant design 1c; Roman numerals in game).
export type RegionTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Safe first runs SF-1 (docs/plans/2026-10-15-safe-first-runs-plan.md section 3.3 and its USER ANSWERS; the rules live
// in runDifficulty.ts): the per-type RUN COUNTERS on GameState.runCounts. Plain numbers and booleans (no Decimals).
// - expedition.completed: claimed runs that were not recalled, the training run excluded (the curve's input).
// - expedition.trainingDone: the training run (the first expedition from an explorer) was claimed, not recalled.
// - patrol.dispatched: patrol dispatches (the first is the one safe patrol); patrol.completed: won patrol routes.
// - veteran: the save flew this type before 0.14.0 (save v70): no training run, the curve at full strength.
// - shortRange: per G1 template (G1 is not built; its contract, plan SF-5).
export interface RunCounts {
  version: 1;
  expedition: { completed: number; trainingDone: boolean; veteran: boolean };
  patrol: { dispatched: number; completed: number; veteran: boolean };
  shortRange: Record<string, { dispatched: number; completed: number }>;
}
// A new game's counters (freshState): nothing flown, not a veteran. Fresh objects.
export function freshRunCounts(): RunCounts {
  return {
    version: 1,
    expedition: { completed: 0, trainingDone: false, veteran: false },
    patrol: { dispatched: 0, completed: 0, veteran: false },
    shortRange: {},
  };
}
// A run's difficulty, frozen at dispatch (runDifficulty.ts runDifficultyAt): the training run, else the curve position
// `ramp` in [0, 1] (1 = nominal), at the run's tier. `oddsRamp` (safe first runs SF-3 review): an ordinary expedition's
// affix roll and ambush position when it lags `ramp` (absent = `ramp`).
export interface RunDifficultyStamp {
  version: 1;
  firstRun: boolean;
  ramp: number;
  tier: RegionTier;
  oddsRamp?: number;
}
// The hostile sites a risk-aware body may hold (user words "an enemy colony", "an enemy fortification", names
// approved for now, #12). Not discovery PoIs: they never appear in the planet-type pools.
export type HostileSiteId = "enemyColony" | "enemyFortification";
// Squads SQ-6 follow-up (user, 2026-10-13: Strike's role, "BOTH"): the CLEARING TASKS a dangerous body may hold,
// Security-only work (no Science squad needed), so a Strike team has work of its own [PROPOSAL names]. Not
// discovery PoIs: they never appear in the planet-type pools (the hostile-site pattern).
export type ClearingSiteId = "clearHostiles" | "secureLandingZone";
// A system's grades (drawn from its region tier's odds table; known enemy territory adds combat).
export interface SystemRiskGrades {
  combat: RiskGrade;
  fauna: RiskGrade;
  flora: RiskGrade;
}
// One body's grades (the system's, with a keyed per-body jitter; Fauna / Flora None on lifeless worlds) plus its
// banded hazard, and the hostile site its seeded roll placed there (absent = none). Whether that site becomes a
// TASK is decided when the body's scan completes, by the squads the ship deployed (no softlock, user #3).
export interface BodyRiskGrades extends SystemRiskGrades {
  hazard: RiskGrade;
  site?: HostileSiteId;
  // Squads SQ-6 follow-up: the clearing tasks the body's seeded roll placed (riskFactors.ts CLEARING_SITE_RULES),
  // in roll order; absent = none. A run dispatched before the follow-up never carries it, so its bodies stamp
  // exactly as before. Unlike a hostile site, a clearing task always joins at the scan (Tiers I and II cap its
  // needs at one Security squad; from Tier III one the deployed squads cannot cover is skipped with its log line).
  clearing?: ClearingSiteId[];
}
// A risk-aware run's profile (Expedition.risk): its PRESENCE is the SQ-4 flag, like encounterSteps and
// groundOps. Drawn at dispatch from the committed candidate's seed (riskFactors.ts RISK_SALT), so the pre-launch
// preview and the run are the same draw.
export interface ExpeditionRiskProfile {
  version: 1;
  tier: RegionTier;
  enemyTerritory: boolean;
  system: SystemRiskGrades;
  // Objective affixes (AF-1): the run's DIFFICULTY TIER (riskFactors.ts BASE_DIFFICULTY_TIER today; the hook for
  // the future difficulty tiers, user 2026-10-14). Its PRESENCE is the affix flag: a run dispatched before AF-1
  // has none and stamps no affix.
  difficultyTier?: number;
  // Objective affixes (AF-2): the AFFIX CATALOG version the run stamps from (riskFactors.ts AFFIX_CATALOG_VERSION,
  // written at dispatch since AF-2). Absent on an affix-aware run dispatched before AF-2: it stamps from AF-1's
  // catalog (Reinforcing only) on AF-1's draw layout, so its objectives roll exactly as before.
  affixCatalog?: number;
}

// One body (planet / satellite / other) in the target system. Its `planetType` (E2b) gates which
// discoveries appear + their odds and drives its `hazard` scalar (which slows scanning + is a placeholder
// combat lever for E3). Plus a scan SIZE (scanTotal), a scan cursor (scanProgress), and the discovered
// PoIs + generated activities. `scanned` is the internal once-only latch that a body's discoveries +
// activities are assigned exactly once when it first reaches 100%.
export interface ExpeditionBody {
  id: string;
  planetType: ExpeditionPlanetType; // E2b: gates discoveries + odds; drives `hazard`. Assigned at generation.
  scanTotal: number; // total scan work to reach 100% ("size"); bigger = longer to scan
  scanProgress: number; // 0..scanTotal
  hazard: number; // 0..1 hazard scalar (from planetType); higher = slower scan (and, later, harder ground combat)
  scanned: boolean; // latch: true once this body hit 100% and had its discoveries + activities assigned
  discoveries: ExpeditionDiscovery[];
  activities: ExpeditionActivity[];
  // Squads SQ-4: the body's risk grades, written at dispatch on a risk-aware run only (absent on every run
  // dispatched before SQ-4, whose tasks stamp exactly as they did). groundOps.ts / groundTasks.ts / groundFight.ts
  // read it: fight points, needs, difficulty, flora's slower work and poison, the ambush chance.
  risk?: BodyRiskGrades;
}

// A claimable EXPEDITIONARY FINDING. E2a shipped GENERIC placeholder tokens (a provenance tag only);
// E3 makes an ACTIVITY finding REAL by attaching the away-team task's reward payload (planet-flavored
// materials + credits + a CHANCE at an UNIDENTIFIED relic token). The payload fields are OPTIONAL so the
// anomaly finding (and any pre-E3 placeholder finding on a mid-branch save) stays valid unchanged; E4
// still owns the DEPOSIT + relic identification (claimExpedition only hands the findings back). `source`
// records where the finding came from so E4 can route each provenance differently.
//
// E-CREW 0.14.0 (Task 14): two scan-phase sources join. "encounter" is the enemy drops of a WON random
// encounter during scanning (materials + credits, never a relic); "supplyCache" is the scan-step random
// EVENT (a small material + credit find). Both deposit exactly like an activity finding (no relic).
export interface ExpeditionFinding {
  id: string; // stable, "<expeditionId>-find-<n>"
  source: "anomaly" | "activity" | "encounter" | "supplyCache";
  // E3 activity-finding payload (all optional; unset on an anomaly / pre-E3 finding):
  poiId?: string; // the PoI the away-team task resolved (expeditionContent.ts POI_CATALOG id)
  materials?: Record<string, number>; // itemId -> quantity gathered (E4 deposits these)
  credits?: number; // credits recovered
  relic?: ExpeditionRelicToken | null; // an UNIDENTIFIED relic token when the roll hit (E4 identifies it), else null/unset
  evacuated?: boolean; // true when the task was LOST after every attempt (evacuated: a reduced "always win something" payload)
}

// An UNIDENTIFIED relic the away-team recovered. Its rarity TIER + quality come from REUSING the salvage
// tiered-rarity roll machinery (SALVAGE_LOOT_POOLS, gambit.ts rollRelicToken); the concrete relic + its
// bonus are DELIBERATELY not resolved here -- E4 (Research -> Museum) owns identification, so this token
// stays generic (`unidentified: true`) until then, exactly like a crafting BLANK before inspection.
export interface ExpeditionRelicToken {
  id: string; // stable, "<expeditionId>-relic-<n>"
  tier: EquipmentRarity; // the salvage-tier rarity this relic rolled (reuses the rarity ladder)
  quality: number; // 0..5 quality bucket from the salvage tier (reuses the 0-5 quality system)
  unidentified: true; // always true this phase: E4 owns identification/research/museum
  studySpeed?: number; // WR-5c Preservationist: the study of this relic runs (1 + this) faster; absent = 0
  // Relics v2 (plan 2026-10-17 section 3.2): stamped at the roll by R2-2 on a run that carries the blanks flag
  // (Expedition.relicBlanks): the run's region tier and the culture of the body it came from (relicBlanks.ts
  // relicBlankStamp). Absent = Tier I and a culture derived at read time, so every token rolled before R2-2 (and every
  // token of a run in flight at the update) reads exactly as it did.
  regionTier?: RegionTier;
  cultureId?: string;
}

// ============================================================================
// RELICS (Exploration 0.14.0, Phase E4a): the relic STORE on GameState
// ============================================================================
// Relics + artifacts are ONE combined system (user, 2026-10-01). An expedition relic arrives
// UNIDENTIFIED (an ExpeditionRelicToken on a finding); claiming the expedition DEPOSITS it into the
// relic VAULT below (a RelicVaultToken, routed to a SET by the finding's PoI). The Research facility
// STUDIES a vault token (the "relicStudy" timed process) to reveal WHICH relic of its set it is; the
// identified copy lands in the MUSEUM (copy counts per relic id), and the FIRST copy of a relic type
// appends it to the DISCOVERED registry (the first-find unlock). The catalog (sets, relics, museum
// math) lives in relics.ts; only the persisted SHAPES live here (one-way import arrow, the same posture
// ExpeditionPlanetType has with expeditionContent.ts).

// The four relic SETS (LOCKED, approved "Relic Museum" mockup 2026-10-01). relics.ts owns each set's
// roster + bonuses; this union is declared here so the persisted vault token can name its set without
// model.ts importing the catalog.
export type RelicSetId = "precursor" | "shipwright" | "xenobiology" | "deepEarth";

// An UNIDENTIFIED relic waiting in the vault for Research to study it. Carries the token's rolled
// rarity TIER + quality (from the gambit reward roll), the SET it belongs to (routed off the source PoI
// at claim time via relics.ts RELIC_SET_BY_POI), and the source PoI itself (provenance for the E4c UI).
// Plain strings/numbers only (no Decimal), so hydrateDecimals is unchanged.
export interface RelicVaultToken {
  id: string; // the ExpeditionRelicToken id ("<expeditionId>-relic-<activityId>"), unique per token
  tier: EquipmentRarity; // the rolled rarity tier; skews WHICH relic the study reveals (relics.ts)
  quality: number; // 0..5 quality bucket carried from the reward roll (provenance; no effect yet)
  // The set this token identifies WITHIN (v1 identification), routed off its PoI at deposit. Relics v2 R2-2: OPTIONAL. A
  // blank with no site (a short-range blank, a planet completion blank, a grant) has neither a set nor a PoI; its study
  // identifies over the general pool by band (relicBlanks.ts identifyGeneralRelic). Every expedition deposit still
  // writes both, so a sited blank identifies exactly as before.
  setId?: RelicSetId;
  poiId?: string; // the PoI the finding came from (expeditionContent.ts POI_CATALOG id); absent = no site (see setId)
  studySpeed?: number; // WR-5c Preservationist (carried from the token): the study runs (1 + this) faster; absent = 0
  // Relics v2 (plan 2026-10-17 section 3.2): all optional, read with a default (relicBlanks.ts vaultTokenRegionTier /
  // vaultTokenCultureId / vaultTokenSource). R2-2 writes them on every blank a new run (or a hook) mints. regionTier
  // absent = Tier I; cultureId absent = derived at read time from the token id; source absent = "expedition".
  regionTier?: RegionTier;
  cultureId?: string;
  source?: RelicVaultTokenSource;
}

// Relics v2 R2-1: where a vault blank came from (plan 2026-10-17 section 3.2; OC-14 short-range, OC-15 the planet 100%
// bonus roll, the tutorial grant seam). Absent on a token = "expedition".
export type RelicVaultTokenSource = "expedition" | "shortRange" | "completion" | "grant";

// Relics v2 R2-1: a RegionTier as a record key (JSON object keys are strings). The Museum v2 record is keyed by it.
export type RegionTierKey = "1" | "2" | "3" | "4" | "5" | "6" | "7";

// Relics v2 R2-1 (plan 2026-10-17 section 3.2; USER ANSWERS 2026-10-19 calls 1 to 4, 7, 9 and 16): the MUSEUM v2
// record. It REPLACES the v1 `relicMuseum` (the v69 -> v70 step moves every v1 copy into general["1"]: every v1 copy is
// a Tier I copy, and the ids did not change). Plain numbers and strings only (no Decimals), so hydrateDecimals is
// unchanged.
//   general       copies per region tier per general relic TYPE id (relics.ts RELIC_TYPES). Sparse: a tier is absent
//                 until its first copy, a type until its first copy at that tier.
//   exceptional   copies per exceptional PIECE id (relics.ts EXCEPTIONAL_SETS); duplicates counted (OC-7, R2-5).
//   frozen        the snapshot of a tier's general counts taken when it first reached the soft cap (OC-3, R2-4).
//   cultures      per culture id: study points and finds per type (OC-9, R2-6).
//   culturesNamed culture ids in reveal order, each appended once (R2-6).
//   setsCompleted exceptional set ids in completion order, each appended once (the ledger hook reads it, R2-5).
// R2-1 is DORMANT: only general["1"] is written (by a v1 relic study, exactly where the v1 museum was written); every
// other part stays empty until its slice.
export interface MuseumCultureRecord {
  points: number;
  finds: Record<string, number>;
}
export interface MuseumV2 {
  general: Partial<Record<RegionTierKey, Record<string, number>>>;
  exceptional: Record<string, number>;
  frozen: Partial<Record<RegionTierKey, Record<string, number>>>;
  cultures: Record<string, MuseumCultureRecord>;
  culturesNamed: string[];
  setsCompleted: string[];
}

// The empty Museum v2 record freshState seeds. Pure: a new object every call.
export function emptyMuseumV2(): MuseumV2 {
  return { general: {}, exceptional: {}, frozen: {}, cultures: {}, culturesNamed: [], setsCompleted: [] };
}

// The general copy record of one region tier (Tier I by default: where every v1 copy lives). A save or fixture
// without the record reads empty. The ONE reader every v1 consumer goes through (museum bonuses, the Museum panel,
// the reveal card, the wiring probes). Pure.
export function generalMuseumRecord(state: { readonly museumV2?: MuseumV2 }, tier: RegionTier = 1): Readonly<Record<string, number>> {
  return state.museumV2?.general?.[String(tier) as RegionTierKey] ?? {};
}

// The Museum v2 record with one region tier's general copies REPLACED by `record` (copied). Every other part, and
// every other tier, is kept. The key positions of an existing record are kept too (a spread over an existing key
// keeps its place), so a write never reorders the saved JSON. Pure.
export function museumV2WithGeneral(museum: MuseumV2 | undefined, record: Readonly<Record<string, number>>, tier: RegionTier = 1): MuseumV2 {
  const base = museum ?? emptyMuseumV2();
  return { ...base, general: { ...base.general, [String(tier) as RegionTierKey]: { ...record } } };
}

// The state with one region tier's general copies replaced (museumV2WithGeneral). Pure.
export function withGeneralMuseumRecord<S extends { museumV2?: MuseumV2 }>(state: S, record: Readonly<Record<string, number>>, tier: RegionTier = 1): S {
  return { ...state, museumV2: museumV2WithGeneral(state.museumV2, record, tier) };
}

// The per-save relic PRNG seed. A study's identification roll is keyed off (relicSeed, a fixed salt, the
// study's monotonic index, the token id), never a live stream position, so the outcome is reload- and
// chunking-independent. A fixed default (like EXPEDITION_DEFAULT_SEED); freshState + the v62->v63
// migration seed the identical value.
export const RELIC_DEFAULT_SEED = 0x51ed270b;

// ============================================================================
// Away-team GAMBIT combat model (Exploration 0.14.0, Phase E3a; LOCKED FFXII structure, user 2026-09-30)
// ============================================================================
// The PERSISTED gambit rule model. A RULE is [TARGET selector] + [ACTION], evaluated TOP-DOWN with the
// FIRST MATCH firing (FFXII's exact structure); the TARGET carries the condition (an HP threshold, a
// status). A PROGRAM is an ordered list of rules; the player keeps ONE program per ROLE (Security +
// Science) as an ACCOUNT-LEVEL pair on GameState (all away teams use it, first-pass). The INTERPRETER +
// ground-combat resolver live in gambit.ts (built generalizable, so the pinned ship-combat gambit layer
// can reuse it later); this file owns only the persisted shapes + the default program pair.

// TARGET SELECTORS (the tactical heart). Foe selectors pick an enemy; Ally/Self selectors pick a friendly.
// A few are NON-TARGET CONDITIONS (openingRound/outnumbered) whose action fires against a contextual
// default target. Selectors that need a parameter read it from GambitRule.params (hpThreshold / statusId).
export type GambitTargetSelector =
  // --- Foe selectors ---
  | "foeNearest"
  | "foeFarthest"
  | "foeHighestHp" // "punch the biggest guy to establish dominance"
  | "foeLowestHp" // finish the wounded
  | "foeHighestThreat" // take down the biggest damage threat first
  | "foeIsHealer" // target the enemy healer/support
  | "foeIsCaster" // target the enemy caster/ranged
  | "foeHasStatus" // params.statusId: a foe already carrying status X
  | "foeLargestGroup" // the most-numerous enemy type (multi-group encounters)
  // --- Ally / Self selectors ---
  | "allyLowestHp"
  | "allyHpBelow" // params.hpThreshold (0..1 fraction): a granular, configurable trigger
  | "allyHasStatus" // params.statusId (absent => any debuff): the "designated member cures it" hook
  | "self"
  | "selfHpBelow" // params.hpThreshold
  | "selfHasStatus" // params.statusId
  // --- Non-target conditions (fire against a contextual default target) ---
  | "openingRound"
  | "outnumbered"
  // Field Kits FKR-6: a DOWNED ally (the lowest id), the Injury Kit's target (FK-M5). Every other selector sees standing
  // allies only. A rule with this selector fires only as a Field Kits run's Use Item with an Injury Kit (gambit.ts).
  | "allyDowned";

// ACTIONS, role-scoped. SECURITY fights; SCIENCE supports/cures/secures; BOTH share the neutral trio.
// Role-legality is enforced by gambit.ts (isActionLegalForRole): a Science rule with a Security action
// (or vice-versa) is skipped by the resolver + flagged by validateGambitProgram.
export type GambitActionId =
  // --- Security ---
  | "attack"
  | "suppress" // damage + apply Suppressed (accuracy down)
  | "taunt" // force enemy focus onto the taunter ("establish dominance" / tank)
  | "execute" // bonus damage vs a low-HP foe
  | "brace" // self Shielded (damage taken down)
  // --- Science ---
  | "cure" // clear a debuff (params.statusId, else all debuffs) from an ally
  | "aidHeal" // restore an ally's HP
  | "shieldAlly" // apply Shielded to an ally
  | "analyze" // reveal a foe's weakness (apply Corroded: armor down)
  | "secureObjective" // advance the objective track (can win the fight mid-combat)
  | "takeCover" // self damage-taken-down without acting offensively
  // --- Both ---
  | "useItem" // spend a team-kit consumable to cure an ally (works with no Science curer)
  | "fallBack" // disengage this round
  | "hold" // do nothing (explicit no-op)
  // Field Kits FKR-5: THROW the member's grenade at the target's group, spending one charge (a Field Kits run only:
  // gambit.ts; fieldKitsGrenades.ts arms the thrower). A rule whose actor has no charge left, or has spent its throws
  // this battle, does not fire (FK11: "IF a gambit line requires a grenade to be used, and you're out or you've used one
  // already in that battle, skip it").
  | "throwGrenade"
  // Enemy only (never in a squad's legal set):
  // Field Kits FKR-4: a Striker's FLASH GRENADE (Blindness on the target), one per Striker per battle, on a Field Kits
  // run only (gambit.ts; fieldKitsConditions.ts arms the Strikers).
  | "flashGrenade";

// The STATUS / AFFLICTION vocabulary (gambit.ts GAMBIT_STATUSES carries the effect semantics + first-pass
// magnitudes/durations). Debuffs: Poison/Bleed (DoT), Stun (skip), Weakened (dmg down), Suppressed (acc
// down), Corroded (armor down), Fear (may fall back). Buffs: Shielded (dmg taken down), Inspired (dmg up).
// Field Kits FKR-4 (user-named, D20 and the 2026-10-15 severity ranks): the bone line Fracture, Broken Bone, Shattered
// Bone (power and accuracy down, worsening), Hemorrhage (a heavy DoT), Neurotoxin (DoT plus lost turns), Concussion
// (lost turns) and Blindness (attacks mostly miss). Only a Field Kits run's fights inflict them.
export type GambitStatusId =
  | "poison"
  | "bleed"
  | "stun"
  | "weakened"
  | "suppressed"
  | "corroded"
  | "fear"
  | "shielded"
  | "inspired"
  | "fracture"
  | "brokenBone"
  | "shatteredBone"
  | "hemorrhage"
  | "neurotoxin"
  | "concussion"
  | "blindness";

// Optional parameters a selector reads (an HP threshold as a 0..1 fraction, a status id). Absent when the
// selector needs none.
export interface GambitRuleParams {
  hpThreshold?: number; // 0..1 fraction for allyHpBelow / selfHpBelow
  statusId?: GambitStatusId; // for foeHasStatus / allyHasStatus / selfHasStatus (and cure's target status)
  // Field Kits FKR-6 (all optional; a rule without them reads exactly as before):
  //   kitId          : the kit a Use Item rule spends from the actor's OWN carried kits on a Field Kits run (absent =
  //                    the First Aid Kit, call 15 "Means First Aid Kit"). A run without Field Kits keeps the team kit.
  //   minRank        : the rule fires only when its resolved target is at least this enemy rank (group 7 "Rank rules +
  //                    reserve": "target is Elite or stronger" = "elite", "target is a Boss" = "boss"). An ally, or an
  //                    enemy of an unranked run, reads Normal.
  //   reserveForBoss : "keep N for a Boss": on a target that is not a Boss the rule fires only while the actor holds
  //                    MORE than N of what it spends (grenade charges, or that kit); on a Boss it spends freely.
  kitId?: FieldKitId;
  minRank?: EnemyRank;
  reserveForBoss?: number;
}

// ONE gambit rule: a target selector (+ optional params) and the action to take on the match.
export interface GambitRule {
  target: GambitTargetSelector;
  params?: GambitRuleParams;
  action: GambitActionId;
}

// An ordered gambit program: rules evaluated top-down, first match fires (per member, per round).
export type GambitProgram = GambitRule[];

// The two away-team roles programs are stored for. E-CREW 0.14.0 (Task 13): only SECURITY programs ever
// run (Science never enters a battle, design D2). "science" stays in the union, and GambitPrograms keeps
// its two-key shape, so an old save carrying a Science program loads unchanged; nothing executes it.
export type GambitRole = "security" | "science";

// The player's ACCOUNT-LEVEL program pair (one per role), stored on GameState. D19 (user, 2026-10-06): NO
// battle reads it any more. Each Security member runs its own program, else DEFAULT_MEMBER_GAMBIT (below),
// never this pair. Ground Operations GO-16 (plan Q21, flagged to the user): KEPT STORED, HIDDEN. The
// per-member editor no longer edits it; it only shows a one-line notice when the stored pair differs from
// DEFAULT_GAMBIT_PROGRAMS (gambitEditorDisplay.ts accountPairNoticeShown). The shape stays so every save
// loads and keeps what the player stored; the other readers are freshState + the v61 -> v62 migration
// (which seed it) and Expedition.gambitPrograms (an inert field kept for save shape).
export interface GambitPrograms {
  security: GambitProgram;
  science: GambitProgram;
}

// The DEFAULT program pair a fresh save starts from and the v61->v62 migration seeds onto existing saves.
// This IS the "Balanced" preset (gambit.ts GAMBIT_PRESETS references this constant, single source of
// truth): Security kills the enemy healer, then the biggest threat, then finishes the wounded, then hits
// the nearest. E-CREW 0.14.0 (Task 13): the Science program is EMPTY, since Science never enters a battle
// (it used to heal, cleanse and secure an objective track that no longer exists). An existing save keeps
// whatever Science program it stored; nothing executes it. FIRST-PASS TUNABLE.
export const DEFAULT_GAMBIT_PROGRAMS: GambitPrograms = {
  security: [
    { target: "foeIsHealer", action: "attack" },
    { target: "foeHighestThreat", action: "attack" },
    { target: "foeLowestHp", action: "execute" },
    { target: "foeNearest", action: "attack" },
  ],
  science: [],
};

// D19 DEFAULT MEMBER GAMBITS (user, 2026-10-06, verbatim): "A default set of gambits that covers everything
// but automatic kit use should be assigned by default unless one is set up." The built-in program every
// Security member runs until the player sets that member's own (AwayMember.gambit). It is NOT linked to the
// account-level pair above: editing that changes no member. Coverage, top to bottom (first match fires):
//   - medic support: cure an afflicted ally, then patch an ally below half HP. Both fire only for a member
//     with Medical Training (gambit.ts canActorUse) and consume NO kit (team kit is spent only by Use Item);
//   - defense: brace when badly hurt;
//   - targeting: kill the enemy healer, then the caster, then finish the weakest foe, then the nearest.
// It contains NO "useItem" rule (no automatic kit use); a test pins that. FIRST-PASS TUNABLE thresholds.
export const DEFAULT_MEMBER_GAMBIT: GambitProgram = [
  { target: "allyHasStatus", action: "cure" },
  { target: "allyHpBelow", params: { hpThreshold: 0.5 }, action: "aidHeal" },
  { target: "selfHpBelow", params: { hpThreshold: 0.25 }, action: "brace" },
  { target: "foeIsHealer", action: "attack" },
  { target: "foeIsCaster", action: "attack" },
  { target: "foeLowestHp", action: "execute" },
  { target: "foeNearest", action: "attack" },
];

// Field Kits FKR-6 (N7 + N15, user 2026-10-16 "Thrown, spend charges": "the DEFAULT program throws them sensibly, saving
// one for a Boss"; a user-approved change to D19's "no automatic kit use" for GRENADES only, never a kit): the grenade
// rules a member on the built-in default runs on a Field Kits run: N15's "Throw grenade at the largest group, keep 1 for
// a Boss", plus a rule that spends the kept charge on an Elite OR a Boss, whichever shows up (user 2026-10-20 "Save for
// Elite or Boss": the fight's highest threat, which an Elite or Boss lead is at x1.7 or x2.5). A member without a
// grenade, out of charges, or past this battle's throw skips both (FK11), so the rest of the default acts exactly as
// D19's.
export const FIELD_KITS_DEFAULT_GRENADE_RULES: readonly GambitRule[] = [
  { target: "foeHighestThreat", params: { minRank: "elite" }, action: "throwGrenade" },
  { target: "foeLargestGroup", params: { reserveForBoss: 1 }, action: "throwGrenade" },
];

// The default program on a Field Kits run: D19's DEFAULT_MEMBER_GAMBIT with the grenade rules after its medic and
// defense rules (cure, patch, brace) and before its targeting. groundFight.ts swaps it in for a member whose
// snapshot program IS the default (a run without Field Kits never reads it, so no flag-less run moves). Still no
// Use Item rule: kits are never spent automatically (D19).
export const FIELD_KITS_DEFAULT_MEMBER_GAMBIT: GambitProgram = (() => {
  const at = DEFAULT_MEMBER_GAMBIT.findIndex((r) => r.action === "brace") + 1;
  return [...DEFAULT_MEMBER_GAMBIT.slice(0, at), ...FIELD_KITS_DEFAULT_GRENADE_RULES, ...DEFAULT_MEMBER_GAMBIT.slice(at)];
})();

// A snapshot of the installed sensor array's resolved (rarity/quality-scaled) scan-behavior params,
// captured at dispatch so resolution is a pure function of the stored expedition (no live fitment
// re-read). Structurally identical to sensorArrays.ts SensorArrayEffect; declared inline here (not
// imported) to avoid a model.ts <-> sensorArrays.ts import cycle. A NEUTRAL snapshot (all-1 mults, 0
// biases) is used when no sensor array is fitted.
export interface ExpeditionScanParams {
  scanRateMult: number;
  coverageWidth: number;
  landmarkOddsBias: number;
  undergroundPoiOddsBias: number;
  // WR-5c (captain secondary talents, explorer tree; captainExplorerEffects.ts): the commanding captain's survey
  // nodes, folded into the ship's sensor snapshot (expedition.ts shipSensorSnapshot) so a dispatch freezes them AND
  // the candidate previews read them (the preview stays truthful). Each is written only when the captain owns its
  // node, so every other snapshot is the four-field record above, byte for byte.
  captainScanRateMult?: number; // Cartographer: the scan rate x this
  captainDiscoveryMult?: number; // Anomaly Sense: each discovery attempt's odds x this
  captainSureFinds?: number; // Deep Scan: this many discovery attempts of each body succeed
}

// WR-5c: the commanding captain's explorer nodes a Ground Ops run reads, frozen at dispatch (expedition.ts
// buildExpedition; captainExplorerEffects.ts explorerCaptainRun). Absent when the captain owns none of them, and each
// field only when its node is owned, so a run without them is the pre-WR-5c record.
export interface ExplorerCaptainRun {
  relicFindMult?: number; // Field Science: the relic chance x this (gambit.ts relicChancePermille)
  squadPowerMult?: number; // Away-Team Doctrine: the Security squad's power and accuracy x this
  relicStudySpeed?: number; // Preservationist: stamped on the run's relic tokens (their study runs 1 + this faster)
  relicTierLift?: number; // Relic Hunter: the relic rarity tier ceiling + this
  promotionMult?: number; // Drillmaster: the run's promotion counter increments at the claim x this
}

// One active expedition. Its `seed` is the per-expedition PRNG seed (derived at dispatch from the
// per-save expeditionSeed + the expedition number, so it is stable across reloads and decorrelated
// between expeditions). `phaseAnchorSeconds` is the gameTimeSeconds at which the CURRENT phase began;
// elapsed-in-phase = gameTimeSeconds - phaseAnchorSeconds, and a phase boundary advances the anchor by
// the EXACT phase duration (never snaps to the live clock) so overflow carries and many phases can
// resolve in one big offline call, exactly like tickCaptainMission's phaseProgressTicks.
export interface Expedition {
  id: string; // "expedition-N", allocated from GameState.nextExpeditionId; never reused
  shipId: string;
  captainId: number;
  targetSystemId: string; // the system's id: a star catalog id since G2-2 (starCatalog.ts), a banked one before
  systemName: string; // display name ("LB-0472", "Wolf 359"; a banked sci-fi name on a run dispatched before G2-2)
  // The installed sensor array's variant id at dispatch (null = none installed). IDENTITY (WR-4): a record of what
  // flew; nothing reads it for an effect (the resolved scanParams below carry the array's numbers).
  sensorArrayId: string | null;
  scanParams: ExpeditionScanParams; // the array's resolved scan params, snapshotted at dispatch
  sensorPower: number; // effectiveShipStats(...).sensors snapshotted at dispatch (crew-inclusive)
  phase: ExpeditionPhase;
  phaseAnchorSeconds: number; // gameTimeSeconds when the current phase started
  // The inaugural per-account run's shorter (30 minute) transit. RETIRED by safe first runs SF-2 (user, group 3: the
  // first explorer run takes the regular length through expedition.ts TUTORIAL_TRANSIT_SECONDS): every run dispatched
  // since SF-2 stores false; a run in flight at the update keeps its stored value and its 30 minute legs.
  shakedown: boolean;
  // Safe first runs (plan 2026-10-15, SF-1 type; SF-2 writes it in buildExpedition through runDifficulty.ts
  // runDifficultyAt): the run's DIFFICULTY, frozen at dispatch. `firstRun` = the TRAINING RUN (the first expedition
  // from an explorer). SF-2 writes it ONLY on the training run (SF-3 stamps the ramped runs): enemyRanks.ts
  // isTrainingRun reads it, and the training profile (every enemy Normal and scaled down to one per fight, no
  // affixes, no ambushes, pass-only ship events, a lost fight still clears its point, the tutorial transit) keys on
  // it. Also read by the run counters (a claimed training run marks training done; a stamped training run out
  // blocks a second). Absent = today's path (every other run). Optional, no SAVE bump.
  difficulty?: RunDifficultyStamp;
  bodies: ExpeditionBody[];
  anomalyResolved: boolean; // the mid-transit anomaly-chart roll has fired
  anomalyCharted: boolean; // the roll succeeded (adds transit time + one placeholder finding)
  // E2c anomaly OPT-IN: the player's dispatch-time choice to CHART an anomaly if one is detected mid-
  // transit. The E2a roll fired unconditionally; E2c gates it on this stored flag (maybeResolveAnomaly
  // only rolls when true). Persisted because the roll fires at the transit MIDPOINT, long after dispatch,
  // so an offline catch-up must read the player's choice off the stored expedition. Kept deterministic:
  // the flag is a fixed input, not a live value, so one-big == many-small parity is preserved.
  anomalyOptIn: boolean;
  findings: ExpeditionFinding[];
  seed: number; // per-expedition PRNG seed (reload-deterministic, like inspectSeed)
  // --- E3a away-team SNAPSHOT (captured at dispatch, exactly like the sensor snapshot above) ------------
  // The away team's derived combat strength + team kit, snapshotted at dispatch (startExpedition, from the
  // ship's crew via deriveAwayTeam; D19: the program pair below is no longer snapshotted). Resolution
  // (the E3 gambit ground battles in resolveActivitiesPhase) reads ONLY these stored fields, so it is a
  // pure function of the stored expedition -- the tick chain (advanceExpedition) needs no GameState, and
  // one-big == many-small parity holds by construction (the snapshot is a fixed input, not a live read).
  // Nothing the player changes mid-flight alters an in-flight run, matching the sensor snapshot's "the
  // launch is what you saw at dispatch" contract.
  securityStrength: number; // Security division + tactical officers -> the squad-wide crew layer (power/HP)
  scienceStrength: number; // Science division + science/medical officers -> the Science party's fieldwork crew layer (fieldwork.ts, Task 15; unread without a Science member)
  teamKit: number; // per-battle team-kit consumables (cures/stims) available for useItem
  // D19: INERT. It used to snapshot the account program pair for the anonymous detail; no battle reads it
  // now (members carry their own program in `roster`). startExpedition writes an empty pair; the field
  // stays so every stored expedition keeps loading.
  gambitPrograms: GambitPrograms;
  // --- E4b MUSEUM SNAPSHOT (captured at dispatch, exactly like the sensor + away-team snapshots above) ---
  // The account-level museum's expedition bonuses (relics.ts museumBonuses fractions), frozen at dispatch
  // so resolution stays a PURE function of the stored run: a relic study completing mid-flight never
  // re-times an in-flight scan or re-rolls a battle (parity by construction). The museum's
  // scienceTeamPower needs no field of its own: it is folded into scienceStrength above before that is
  // snapshotted. All three are 0 for an empty museum (and the v63 -> v64 migration backfills 0 onto
  // in-flight expeditions), which makes every formula that reads them bit-identical to E4a.
  scanSpeedBonus: number; // museum scanSpeed + gear + the crew's Survey Aptitude (0.14.0): multiplies the scan rate by (1 + this)
  relicFindBonus: number; // museum relicFindChance: multiplies a won task's relic-token chance by (1 + this), capped at certain
  hazardResist: number; // museum hazardResist: shrinks the body hazard scanning + ground encounters see (bounded, never negative)
  // --- E-CREW 0.14.0 (Task 12): the named AWAY-TEAM ROSTER snapshot (design section 5.5) -------------
  // Every READY member of the ship's squads (members, converted gear stats, implants, traits, programs),
  // captured at dispatch by awayTeam.ts snapshotAwayRoster, exactly like the strength snapshot above, so
  // resolution stays a pure function of the stored expedition (offline == live by construction). D18
  // (user, 2026-10-06): startExpedition refuses a ship without at least 1 ready Security AND 1 ready Science
  // member, so every NEW expedition carries a roster. The field stays OPTIONAL for expeditions launched
  // before D18: readers treat absent as two empty squads, and with no Security member a ground task fields
  // NO team (there is no anonymous stand-in any more) and evacuates without a battle (gambit.ts
  // resolveExpeditionActivity). The strengths above stay the squad-wide crew layer on top of the members.
  roster?: AwayRosterSnapshot;
  // E-CREW 0.14.0 (Task 14): RANDOM ENCOUNTERS during scan progress (design D10).
  // All OPTIONAL and additive (no SAVE_VERSION bump). `encounterSteps` is the number of equal steps each
  // body's scan divides into, FROZEN at dispatch (expedition.ts ENCOUNTER_STEPS), and doubles as the
  // feature flag: an expedition WITHOUT it (launched before Task 14) scans exactly as before, with no
  // encounter rolls, so an old in-flight save loads and finishes unchanged. At every interior step
  // boundary the keyed step roll may fire an encounter (a Security battle) or a supply-cache event.
  encounterSteps?: number;
  // Evasive Command (the pilot-seat officer bonus `officer.evasion`), summed over the ship's assigned
  // officers at dispatch (crewOverlay.ts officerBonusTotal): the share it cuts off the encounter chance.
  // Absent / 0 = no cut.
  encounterEvasion?: number;
  // E-CREW 0.14.0 (Task 15): the ship's CREW RARE FIND at dispatch: crewOverlay.ts shipCrewContribution's
  // crew.rareFindChance, which already folds the Science officer's Discovery Instinct (officer.rareFindMult,
  // mapped through OFFICER_STATKEY_TO_CREW) with the Science division's Keen Analysis and any racial, scaled
  // by the museum's crewBonuses. The relic roll adds it to the find bonus (gambit.ts activityRelicFindBonus).
  // Absent / 0 = no lift (an expedition launched before Task 15).
  crewRareFind?: number;
  // E-CREW 0.14.0 (Task 20): two Senior Staff bonuses for the AWAY TEAM, frozen here at dispatch like
  // encounterEvasion (crewOverlay.ts officerBonusTotal), so every battle of the run stays a pure function of
  // the stored expedition. Small named fields on purpose: the Ground Operations redesign (D25) carries them
  // forward onto whatever record a team's task run becomes. OPTIONAL, written only when non-zero (absent =
  // no bonus), so a run without the officer is byte-identical to before (no SAVE_VERSION bump).
  //   squadTriage     : Fleet Triage (officer.crewLossPrevention), a share that strengthens the squad's
  //                     in-battle healing (a medic's Aid / Heal) and first-aid cures (gambit.ts).
  //   squadFearResist : Morale Anchor (officer.crewRetention), the squad's chance to shrug off Fear,
  //                     combined with each member's own Fear resist (gambit.ts buildRosterCombatants).
  squadTriage?: number;
  squadFearResist?: number;
  // E-CREW 0.14.0 (Task 21): the OFFICER STAT FACETS that reach this run, frozen at dispatch like the fields
  // above (officerStats.ts; small named fields for the Ground Operations redesign, D25, to carry forward).
  // OPTIONAL, written only when non-zero (absent = no effect, no SAVE_VERSION bump).
  //   ambushSoften        : Security's CUNNING over-delivery (rolled at dispatch): the run's random scan
  //                         encounters field enemies at (1 - this) health and power (gambit.ts).
  //   quickRecovery       : Medical's CUNNING over-delivery (rolled at dispatch): added to the care divisor
  //                         of every injury this run brings home (injuries.ts).
  //   recoveryTurnaround  : Medical's CONSTITUTION facet (shorter post-mission turnaround): also added to
  //                         that care divisor.
  //   rampScience         : Science's CONSTITUTION facet: the run's crew rare find (the relic roll) grows by
  //                         constitutionRamp(this, hours since dispatch) at each task.
  //   rampFlightDeck      : the Flight Deck's CONSTITUTION facet: encounterEvasion grows by
  //                         constitutionRamp(this, hours since dispatch) at each scan step.
  ambushSoften?: number;
  quickRecovery?: number;
  recoveryTurnaround?: number;
  rampScience?: number;
  rampFlightDeck?: number;
  // E-CREW 0.14.0 (Task 21 review calls, the per-seat rows):
  //   rampReturn   : the Flight Deck's CONSTITUTION facet: the return leg is divided by (1 + the ramp on the
  //                  hours since dispatch when it starts).
  //   hazardSteady : the Science department's INTEGRITY facet: added to the run's hazard resist while
  //                  SCANNING (a hazardous world slows the scan less; resistedHazard bounds the sum).
  //   injurySteady : the Medical department's INTEGRITY facet: added to the care divisor of every member who
  //                  comes home INJURED (injuries.ts).
  rampReturn?: number;
  hazardSteady?: number;
  injurySteady?: number;
  // How many step boundaries (flat across bodies, in scan order) have been rolled. The once-only latch
  // that keeps a boundary from rolling twice however the advance is chunked. Absent = 0.
  scanStepCursor?: number;
  // The boundaries where something HAPPENED (an encounter or an event), in scan order. A boundary that
  // rolled nothing is not listed. The UI (Task 17) draws its "random battle at step N" pips from this.
  scanEvents?: ExpeditionScanEvent[];
  // Ground Operations 0.14.0 (GO-7b, D25): the run's ground operations record. Its PRESENCE is the feature flag
  // (like encounterSteps): a run dispatched since GO-7b carries it and resolves on the Ground Ops timeline
  // (groundOps.ts); a run without it resolves on the legacy path, byte-identically. Optional, no SAVE bump.
  groundOps?: GroundOpsState;
  // Squads SQ-4: the run's RISK PROFILE (with each body's ExpeditionBody.risk). Its PRESENCE is the risk-aware
  // flag: written at dispatch alongside groundOps; a flagged run dispatched before SQ-4 lacks it and keeps
  // resolving exactly as stamped. Optional, no SAVE bump.
  risk?: ExpeditionRiskProfile;
  // Field Kits FKR-1 (enemy ranks; docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES): the ENEMY RANKS flag,
  // stamped at dispatch with the rank catalog's version (enemyRanks.ts ENEMY_RANKS_VERSION). Its PRESENCE ranks the
  // run's ground fights (the final fight of a Challenging objective is led by an Elite, of a Dangerous or Deadly one
  // by a Boss); a run without it fields every enemy at Normal, byte-identically. Optional, no SAVE bump.
  enemyRanks?: { version: number };
  // Field Kits FKR-4 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R2): the FIELD KITS flag (flag 2), stamped
  // at dispatch with the kit catalog's version (fieldKits.ts FIELD_KITS_CATALOG_VERSION) from FKR-7. Its PRESENCE turns
  // on the Field Kits conditions in the run's ground fights (fieldKits.ts fieldKitsLive: enemy inflictors, the bone
  // line, Stoneskin's battle half); a run without it fights byte-identically. Optional, no SAVE bump.
  // FKR-7: `freeBasics` = the free basic set every Security member starts each objective with (fieldKits.ts
  // freeBasicSet on the ship's Medical and Operations headcount), frozen at dispatch so the run reads only stored
  // values. Absent = none (a run stamped by hand). Stamped only behind fieldKits.ts FIELD_KITS_RUNS_LIVE.
  fieldKits?: { catalog: number; freeBasics?: Partial<Record<FieldKitId, number>> };
  // 0.14.0 SPEED SEAM (ProcessSpeed): a STAMP only. processSpeed.ts applyTimeSkip advances the run to its own
  // completion at once (its phase anchors land at its natural end) and marks it; nothing in the engine reads it.
  speed?: ProcessSpeed;
  // WR-5c: the commanding captain's explorer secondary nodes, frozen at dispatch (ExplorerCaptainRun). Absent when
  // the captain owns none of them. Optional, no SAVE bump (the tree is branch-only; no production save owns a node).
  explorerCaptain?: ExplorerCaptainRun;
  // Expedition Tiers G2-2: WHERE the run went, frozen at dispatch from the chosen candidate (ExpeditionRegionStamp),
  // so a run never re-reads the homeworld. Its PRESENCE marks a run named from the star catalog (bodies lettered
  // b, c, d; groundTaskQueueDisplay.ts bodyDesignation). Absent on every run dispatched before G2-2 (banked name,
  // Roman numeral bodies). Optional, no SAVE bump.
  region?: ExpeditionRegionStamp;
  // Expedition Tiers G2-3: the VOYAGE, frozen at dispatch (voyage.ts planVoyage). Its PRESENCE puts the run on the
  // tier-aware transit: the outbound leg, the return leg (before the Flight Deck ramp) and the anomaly detour are
  // read from it. Absent on every run dispatched before G2-3: the fixed pre-G2-3 legs (expedition.ts
  // TRANSIT_SECONDS, the retired shakedown's SHAKEDOWN_TRANSIT_SECONDS), byte-identically. Optional, no SAVE bump.
  voyage?: ExpeditionVoyage;
  // Relics v2 R2-2 (plan 2026-10-17 section 4 R2-2): the RELIC BLANKS flag, stamped at dispatch with
  // relicBlanks.ts RELIC_BLANKS_VERSION. Its PRESENCE makes the run's relic tokens carry their blank stamps (the run's
  // region tier and the body's culture) and roll their rarity on the tier's blank table (Tier I is today's table
  // exactly; user call 13 "Better rarity only"). A run without it (in flight at the update) rolls and stores its
  // tokens byte-identically. Optional, no SAVE bump.
  relicBlanks?: { version: number };
  // Expedition Tiers G2-5: the player's RECALL (expedition.ts recallExpedition), written only by it: the run turned for
  // home at `atSeconds` and flies the frozen `returnSeconds` (any pickup included). Absent = never recalled, and every
  // reader is exactly as before. Optional, no SAVE bump.
  recall?: ExpeditionRecall;
  // Expedition Tiers G2-5: a RESUMED system (user G12 "Resumable"): the run was dispatched to a held system
  // (GameState.heldSystems) and its first `scannedBodies` bodies were charted before (their scans stay done, their
  // objectives keep their progress). Absent on every other run. Optional, no SAVE bump.
  resume?: { version: 1; heldId: string; scannedBodies: number };
}

// Expedition Tiers G2-5 (user #7 "Based on distance traveled 1:1"; G13 one confirm with the return time; G14 detour
// time is not distance flown): a recalled run. `phaseAtRecall` is where it turned; `flownSeconds` the outbound time
// flown toward the system (in transit only, the detour not counted); `pickupSeconds` the shared in-system pickup of the
// teams on a surface (0 when none was down); `returnSeconds` the whole way home from `atSeconds` (the pickup, then the
// return leg at the Flight Deck ramp of the time out so far). `held` names the GameState.heldSystems record the recall
// left (absent when none: a legacy run, or a finished system). Plain data.
export interface ExpeditionRecall {
  version: 1;
  atSeconds: number;
  phaseAtRecall: "transit" | "scanning" | "activities";
  flownSeconds?: number;
  pickupSeconds: number;
  returnSeconds: number;
  held?: string;
}

// Expedition Tiers G2-5: a system a recall left behind (GameState.heldSystems). Signed-off dispatch mockup (2026-10-21,
// "as drawn"): a system recalled BEFORE anything was charted returns to being an ORDINARY CANDIDATE (`kind`
// "candidate": its identity only, offered again among its tier's candidates and launched fresh); a system with charted
// bodies is RESUMABLE (`kind` "resume", user G12: "Any explorer" resumes it, it stays open "Until finished" or abandoned,
// "Pick up where you left off": finished scans stay done, objectives keep their progress, the trip is flown again). A
// resume record carries the run's bodies (scans, discoveries, objectives with their progress; nothing assigned) and its
// risk profile. Plain data.
export interface HeldSystem {
  version: 1;
  id: string; // "held-<expeditionId>"
  kind: "candidate" | "resume";
  fromExpeditionId: string;
  heldAt: number;
  seed: number;
  systemId: string;
  systemName: string;
  famousId: string | null;
  region: ExpeditionRegionStamp;
  risk?: ExpeditionRiskProfile;
  bodies?: ExpeditionBody[];
}

// Expedition Tiers G2-3 (user G5 + G21, 2026-10-16): a run's voyage. `tier` sets the nominal hours (tiers are
// difficulty); `distanceLy` (whole light-years from the homeworld) places it inside the tier's band, which shifts
// the time only inside the tier; `driveClass` is the ship's drive class at dispatch (each class above the tier's
// minimum halves the time); `outboundSpeed` / `returnSpeed` are the ship's own speed on each leg at dispatch
// (outboundLegSpeed / returnLegSpeed: the sweeping transitSpeedMult times that leg's complement lift, CP-2 OC-E5).
// The three durations are whole seconds; `returnSeconds` is before the Flight Deck ramp. Plain data.
export interface ExpeditionVoyage {
  version: 1;
  tier: RegionTier;
  distanceLy: number;
  driveClass: number;
  outboundSpeed: number;
  returnSpeed: number;
  outboundSeconds: number;
  returnSeconds: number;
  anomalySeconds: number;
}

// Expedition Tiers G2-2: the region a run was dispatched to. `tier` and `enemyTerritory` are the region the risk
// profile drew from (the same values as Expedition.risk); `bearing` (whole tenths of a degree from the homeworld,
// galaxy.ts bearingDirection) placed it against the homeworld's fixed enemy sectors; `distanceLy` is its distance from
// the homeworld (whole light-years), what G2-3's voyage reads. Plain data.
export interface ExpeditionRegionStamp {
  version: 1;
  tier: RegionTier;
  enemyTerritory: boolean;
  bearing: number;
  distanceLy: number;
}

// Field Kits FKR-1: a ground enemy's RANK (user-named, 2026-10-16: Weak, Normal, Strong, Elite, Boss). One multiplier
// per rank scales its HP and power (enemyRanks.ts ENEMY_RANKS). Absent on a combatant = Normal.
export type EnemyRank = "weak" | "normal" | "strong" | "elite" | "boss";

// E-CREW 0.14.0 (Task 14): one thing that happened at a scan step boundary. `step` is the boundary
// number (1..encounterSteps - 1: boundary N sits at N / encounterSteps of the body's scan).
//   encounter   : a Security battle. `outcome` win adds the enemy drops (`findingId`); loss withdraws the
//                 team to orbit and pauses this body's scan for `pauseSeconds` (until the next activity
//                 window). `downedMemberIds` lists the Security members down at the battle's end, win or
//                 lose (Task 16: they sit out every later battle of the run, gambit.ts scanDownedBefore,
//                 and come home injured at claim, injuries.ts).
//   supplyCache : the step roll's random EVENT, a small find (`findingId`).
//   shipEvent   : Ground Operations GO-8 (user 9b.6): a SHIP-SIDE event on a flagged run with ship events
//                 (shipScanEvents.ts): `event` names it, `outcome` is pass / fail (a check) or win / loss (a
//                 ship battle). Every negative outcome is a `pauseSeconds` (the scan walk times it exactly);
//                 `hullWear` is the light hull damage it left (Q12, carried home to the Shipyard unless a field
//                 repair fixes it first, GO-8b); `bonusDiscovery` adds one discovery when the body completes;
//                 `boarding` (GO-9) records a boarding attempt and whether the crew repelled it.
export interface ExpeditionScanEvent {
  bodyIndex: number;
  step: number;
  kind: "encounter" | "supplyCache" | "shipEvent";
  event?: ShipScanEventKind; // shipEvent only
  outcome?: "win" | "loss" | "pass" | "fail"; // encounter: win / loss; shipEvent: pass / fail or win / loss
  downedMemberIds?: string[]; // encounter only
  pauseSeconds?: number; // encounter loss, or a shipEvent's negative outcome
  findingId?: string; // the finding this event added (an encounter win, a supply cache, a ship battle won)
  hullWear?: number; // shipEvent only: hull points of light damage (GO-8, user Q12)
  bonusDiscovery?: true; // shipEvent only: a sensor ghost read true (one more discovery on this body)
  boarding?: { repelled: boolean; creditsLost?: number }; // shipEvent only (GO-9)
}

// Ground Operations GO-8: the ship-side scan events (design 9b.6, the approved set; a rare ghost is a cloaked ship).
export type ShipScanEventKind = "debris" | "probe" | "ghost" | "cloaked" | "storm";

// E-CREW 0.14.0 (Task 12): ONE normalized ground effect on a snapshotted away-team member. The roster
// snapshot folds the member's TRAIT effects (awayTraits.ts AWAY_TRAITS) and the fixed GEAR effects of every
// worn piece (MemberVarietyTraits.groundEffect) into this ONE list, so the battle and fieldwork never read
// the two catalogs separately. Stat bumps are NOT here (SnapshotMember.groundStats holds them) and neither
// are status resists (SnapshotMember.resists folds trait AND gear resists into one map).
// `points` on a gear effect is the worn piece's summed ground line POINTS (raw budget, so it already scales
// with the piece's iLevel, quality and rarity). A gear effect's MAGNITUDE derives from it, so a Standard-
// Issue baseline (every line 0) carries the behavior at zero strength (its Med Kit heals nothing).
export type MemberGroundEffect =
  | { readonly kind: "medic" } // trait (Medical Training, id fieldMedic): may cure and heal allies in a battle
  | { readonly kind: "firstStrike" } // trait (Quick Draw): acts first on the opening round
  | { readonly kind: "guard"; readonly allyHpBelow: number } // trait (Bulwark): takes hits meant for a hurt ally
  | { readonly kind: "poiYield"; readonly pois: readonly string[]; readonly value: number } // trait: better finds at these PoIs (fieldwork)
  | { readonly kind: "heal"; readonly points: number } // gear (Med Kit): adds to the heal of a Medical Training member only (D20)
  | { readonly kind: "inflict"; readonly status: GambitStatusId; readonly points: number } // gear: applies `status` on a landed strike
  | { readonly kind: "groupHit"; readonly points: number } // gear (Scattergun): the strike splashes the target's group
  | { readonly kind: "revive"; readonly chance: number; readonly hpFraction: number; readonly points: number }; // gear (Neural Backup)

// One worn piece as the snapshot saw it: which slot, which catalog variety (so a later reader can look up
// the variety's fixed facts such as a tool's planetTypes or encounterBias), and its summed ground points.
export interface SnapshotGearPiece {
  pieceId: string;
  slotType: MemberSlotType;
  varietyKey: string; // the piece's stamped moduleVariant ("" when unstamped)
  points: number; // the piece's summed ground line points (implicit + rolled)
  // Field Kits FKR-5: the piece's +1 carry capacity lines (groundCarryCapacity, a grenade's extra charges), written
  // only when it has one, so every snapshot of a piece without one keeps its exact shape. Absent = 0.
  carry?: number;
}

// One deployed member, frozen at dispatch (awayTeam.ts snapshotAwayRoster). Plain data, no live refs.
//   groundStats : every member stat (awayTeam.ts AwayMemberStat) as the member's summed BUMP: worn gear
//                 converted by convertGroundPoints, plus trait stat bumps (the additive STACKING RULE). For
//                 hp / power / armor / accuracy / fieldwork / relicFind / hazardResist the bump is a FRACTION
//                 of the member's own base value (0.05 = +5%). statusChance has no base value worth scaling,
//                 so its bump IS the chance (0.05 = 5 percentage points).
//   rankFactor  : rankMagnitudeFactor(rank), the rank nudge the battle multiplies into hp / power / armor.
//   resists     : status id -> chance (0..1) to shrug that status off (traits + resistStatus gear), capped.
//   gambit      : the member's OWN program (member.gambit, else DEFAULT_MEMBER_GAMBIT for Security, D19).
//                 Science members carry theirs inertly: Science never enters a battle.
export interface SnapshotMember {
  memberId: string;
  teamType: AwayTeamType;
  spec: AwayMemberSpec;
  rank: CrewRank;
  rankFactor: number;
  traits: AwayTraitId[];
  groundStats: Record<string, number>;
  resists: Partial<Record<GambitStatusId, number>>;
  implants: string[]; // worn implant variety keys, in mint order
  gear: SnapshotGearPiece[]; // every worn piece, in mint order
  gambit: GambitProgram;
  effects: MemberGroundEffect[];
  // E-CREW 0.14.0 (Task 15): the member's FIELDWORK, frozen at dispatch as SOURCES so a planet-tuned tool
  // counts only on its bodies (fieldwork.ts memberFieldworkOnBody sums the sources that apply). Entry 0 is
  // always the untuned source (traits + every worn piece without planetTypes); then one entry per worn
  // planet-tuned tool. OPTIONAL: a snapshot taken before Task 15 lacks it and reads its groundStats,
  // untuned, with no yield lines.
  fieldwork?: SnapshotFieldworkSource[];
  // Ground Operations 0.14.0 (GO-3, D24): the member's PHYSICAL PERKS (racial), frozen at dispatch
  // (medicalBay.ts memberPerksFor). OPTIONAL and written only when non-empty (today: Stoneskin for an Ossir
  // member), so every other snapshot keeps its exact pre-GO-3 shape. Absent = none.
  perks?: MemberPerkId[];
}

// Ground Operations 0.14.0 (GO-3, D24): a member's racial physical perk.
//   stoneskin : the Ossir. Physical conditions (the "injury" class) take 25% longer to cure in the medical
//               bay (medicalBay.ts STONESKIN_INJURY_MULT). The IN-BATTLE half (land 25% less often) arrives
//               with Task 16b Field Kits. Other races' perks: the user's to name later.
export type MemberPerkId = "stoneskin";

// E-CREW 0.14.0 (Task 15): one source of a Science member's fieldwork, already CONVERTED at dispatch
// (awayTeam.ts snapshotMember). fieldwork / relicFind / hazardResist are bumps on the awayTeam.ts
// AwayMemberStat scale (convertGroundPoints); organicsYield / vaultYield are the two yield lines converted
// by FIELDWORK_YIELD_PER_POINT (a fraction of the haul at that find family). planetTypes: a tuned tool's
// bodies (absent = every body).
export interface SnapshotFieldworkSource {
  planetTypes?: ExpeditionPlanetType[];
  fieldwork: number;
  relicFind: number;
  hazardResist: number;
  organicsYield: number;
  vaultYield: number;
}

// The away-team roster snapshot: the deployed members of each squad, in deploy order. An empty squad is [].
export interface AwayRosterSnapshot {
  security: SnapshotMember[];
  science: SnapshotMember[];
}

// ===== Ground Operations 0.14.0 (GO-7a, D25): the run-side records of a Ground Ops run =====
// groundOps.ts snapshotGroundOps writes the dispatch values (GO-7a); the timeline engine (GO-7b) moves them,
// stored in the GroundOpsState wrapper below (Expedition.groundOps). Plain data only (no live refs, JSON-safe).

// One active status on a ground combatant (a copy of a catalog entry's magnitude / duration, decremented in
// place during the battle on the working clone). Moved here from gambit.ts at GO-7b (gambit.ts re-exports it):
// a ground team's in-task carry stores it.
export interface GroundStatus {
  id: GambitStatusId;
  magnitude: number;
  remaining: number; // rounds left (ticked down at end of round; pruned at 0)
}

// The task fight record types (groundFight.ts resolves them; moved here at GO-7b so GroundTeamRun can store
// them without model.ts importing groundFight.ts, GO-7a review; groundFight.ts re-exports them).

// One member's state carried into a fight (user Q5): HP and the persisting statuses.
export interface GroundMemberCarry {
  hp: number;
  statuses: readonly GroundStatus[];
}

// One standing member's state at the end of a fight: the carry for the task's next fight, plus the max HP
// for display ("72 / 90"). A GroundFightRecord's memberEnd passes straight in as the next fight's carry.
export interface GroundMemberEnd extends GroundMemberCarry {
  hpMax: number;
  statuses: GroundStatus[];
}

export interface GroundFightRecord {
  pointIndex: number; // the fight point fought for (the task's pointsCleared at the start)
  fightNumber: number; // the task's fightCount at the start: the stream key
  outcome: "win" | "loss";
  rounds: number; // rounds FOUGHT (0 only when nobody could be fielded)
  downedMemberIds: string[]; // the named members down at the end, combatant order
  // memberId -> the bay conditions at the battle's end (GROUND_CONDITIONS ids only, see memberEndConditions).
  // A member with none is left out.
  memberConditions: Record<string, string[]>;
  // memberId -> end state of every member still STANDING (user Q5 carry damage; GO-7b threads it into the
  // task's next fight). A downed member is left out: they sit out the rest of the task.
  memberEnd: Record<string, GroundMemberEnd>;
  neuralBackup?: { memberId?: string; revived: boolean };
  // Squads SQ-4 (user, SQ-3 calls (c)): an AMBUSH met as a surprise fight where the crew stood, not a fight
  // point. A win passes no point (the work goes on from where it stopped); a loss is an ordinary loss.
  surprise?: true;
  // Objective affixes (AF-1, Reinforcing): an EXTRA BATTLE the objective's reinforcements forced, striking mid-work
  // (user 2026-10-14), not a fight point. A win passes no point (the work goes on from that spot); a loss is an
  // ordinary loss.
  reinforcement?: true;
  // Field Kits FKR-1 (enemy ranks): enemy id -> its rank, for every enemy ranked above or below Normal (the log's
  // "Elite Bruiser"). Record only (nothing reads it back into a fight); written only on a ranked run's fight that
  // fielded one, so every other record keeps its exact shape.
  ranks?: Record<string, EnemyRank>;
  // Field Kits FKR-5 (tool charges): memberId -> the grenade charges that member threw in this fight. Written only on a
  // Field Kits run's fight in which someone threw, so every other record keeps its exact shape. FKR-7 subtracts it from
  // the member's charges left this objective.
  chargesUsed?: Record<string, number>;
  // Field Kits FKR-6 (kits in battle): memberId -> the kits that member SPENT in this fight, split by where they came
  // from: `basicsUsed` from the objective's free basic set, `kitsUsed` from the extras they carry (stock, which never
  // comes home once spent). `treated`: memberId -> the Injury Kit share a downed member received (the medical bay
  // divisor, medicalBay.ts treatmentShare). Each is written only on a Field Kits run's fight where it happened, so
  // every other record keeps its exact shape. FKR-7 subtracts the spends from the team's run and sums `treated`.
  basicsUsed?: Record<string, Partial<Record<FieldKitId, number>>>;
  kitsUsed?: Record<string, Partial<Record<FieldKitId, number>>>;
  treated?: Record<string, number>;
}

// A ground team's current step on the run timeline (GO-7b): idle / staging are open-ended (stepEndsAt null).
export type GroundStepKind = "idle" | "staging" | "deploy" | "work" | "fight" | "return" | "offload" | "bay" | "reload";

// One DEPLOYED ground team on a run (plan section 2). Members are ids into the run's union roster
// (Expedition.roster, groundOps.ts snapshotAwayRosterForTeams), slot order. The team's NAME is read live from
// the ship (groundTeams.ts groundTeamName), never stored here.
export interface GroundTeamRun {
  index: number; // ship ground-team index (0 = Alpha)
  // Squads SQ-3: the team's type at dispatch (its squads: groundComposition.ts securitySquadsOf /
  // scienceSquadsOf). Absent = Ground (every run dispatched before SQ-3: no kind could be set then).
  kind?: GroundTeamKind;
  securityIds: string[];
  scienceIds: string[];
  helpOthers: boolean; // "When done, help other teams" (the ship's default at dispatch)
  queue: string[]; // own ordered task (activity) ids
  step: GroundStepKind;
  stepStartedAt: number;
  stepEndsAt: number | null; // null = open-ended (idle, staging)
  taskId?: string; // the task the team is on
  borrowed?: boolean; // true when that task is another team's (a helper, GO-7c); cleared at idle
  workFrom?: number; // progress span of the current work step
  workTo?: number;
  pendingFight?: GroundFightRecord; // resolved at fight start, applied at fight end (groundFight.ts)
  // The in-task carry (user Q5, GO-5): the last won fight's memberEnd (standing members only, with hpMax for
  // display), passed as the next fight's `carried`. Absent = everyone at full HP. Dropped after a wipe and after
  // the bay (GO-7b).
  carry?: Record<string, GroundMemberEnd>;
  skippedBorrowed: string[]; // a helper's give-up list (never re-borrowed)
  downedThisTask: string[]; // Security members out for the rest of the current task
  conditions: Record<string, string[]>; // memberId -> condition ids gathered on the current trip (medicalBay.ts)
  bayEnds: Record<string, number>; // memberId -> absolute bay end of the latest bay (carried home at claim)
  bayStart?: number;
  // Ground Operations (GO-7b): the current attempt's starting pointsCleared (set at deploy), so a loss knows
  // whether the attempt cleared a new fight point (the stuck count, groundOps.ts groundTaskStuck).
  attemptPoints?: number;
  // Squads SQ-3: the current work step ends in an AMBUSH (rolled at its start, applied at its end: a crew with
  // no Security squad retreats, user #5; SQ-4: a crew with a standing Security member fights it). Cleared at idle.
  ambushed?: true;
  // Squads SQ-3: a joint crew's PARTNER on its way back: the lead offloads once for the whole crew, so this team
  // goes straight to its own bay (design 3.5). Cleared at idle.
  jointPartner?: true;
  // GO-7d (live queue edits): the player skipped or reassigned this team's task while it was FIGHTING. The fight
  // finishes (its result stands), then the crew heads back instead of working on (plan Q14). Set on the crew's
  // lead; cleared when the fight ends, at idle, or when an edit gives the task back to this crew.
  recalled?: true;
  // Objective affixes (AF-1, Reinforcing): this VISIT's extra battles still to come, as PROGRESS points (ascending,
  // rolled as the crew landed: affixes.ts rollReinforcements mapped onto the progress still ahead); each strikes
  // MID-WORK when the work reaches it (user 2026-10-14). Set on the crew's lead; cleared at a loss and at idle.
  reinforcementsAt?: number[];
  // Objective affixes (AF-1): the current work step ends where the next reinforcement STRIKES (set at its start, like
  // `ambushed`); at its end the crew fights the reinforcement fight there. Cleared at idle.
  reinforcing?: true;
  // Field Kits FKR-7 (a Field Kits run only, fieldKits.ts fieldKitsLive; every other run never writes them):
  //   kits      : memberId -> the EXTRAS that Security member still carries (their pack, taken from stock at dispatch;
  //               spent ones never come back, the rest come home at claim). Written at dispatch, members with a pack only.
  //   basics    : memberId -> this objective's FREE basic set left (Expedition.fieldKits.freeBasics), refreshed as the
  //               crew lands on an objective (every objective start and every trip, user N12).
  //   charges   : memberId -> the grenade charges left this objective; cleared as the crew lands (absent = full,
  //               fieldKitsGrenades.ts chargesLeftFor; group 7 "Free, every objective").
  //   treatment : memberId -> the Injury Kit share this trip (the fight records' `treated`, summed), read by the
  //               medical bay (medicalBay.ts treatmentShare) and cleared when the team is healed.
  kits?: Record<string, Partial<Record<FieldKitId, number>>>;
  basics?: Record<string, Partial<Record<FieldKitId, number>>>;
  charges?: Record<string, number>;
  treatment?: Record<string, number>;
  // Field Kits FKR-9 (the pack screen's run readout and claim line, DISPLAY ONLY: resolution never reads it): memberId ->
  // the extras that member PACKED at dispatch, written beside `kits` and never changed, so the readout can show "1 of 2"
  // and the claim can say what the run used (packed minus what comes home). Absent = nothing packed (every other run).
  packed?: Record<string, Partial<Record<FieldKitId, number>>>;
}

// GO-7b: one finished step on a team's timeline, DISPLAY ONLY (the timeline UI, GO-14): resolution never reads
// it. Capped per team (groundOps.ts GROUND_HISTORY_CAP, oldest dropped).
export interface GroundStepRecord {
  teamIndex: number;
  step: GroundStepKind;
  startedAt: number;
  endedAt: number;
  taskId?: string;
  outcome?: "win" | "loss"; // a fight step
  recovered?: true; // a return step where the ship broke off its scan to pick the team up (a recovery leg)
  ambushed?: true; // a work step an ambush cut short (Squads SQ-3: the crew retreated; SQ-4: or fought it)
  surprise?: true; // a fight step that was an ambush met as a surprise fight (Squads SQ-4)
  reinforcement?: true; // a fight step that was a Reinforcing extra battle (objective affixes, AF-1)
  stopped?: true; // GO-7d: the player's edit (skip, or a reassign away) ended this trip here; the crew headed back
  // Safe first runs SF-2: a fight step LOST on a training run whose guards FELL BACK (the backstop): its fight point
  // cleared anyway and nothing was set back (no alert, no loss streak, no send-back); the crew still came home.
  fellBack?: true;
}

// GO-7b (user Q1, 2026-10-12): a RECOVERY LEG. A WIPED team cannot leave on its own ("can't leave them to die"):
// the ship flies to the team's body, picks it up and flies back. During the scan it breaks off its scan, which
// makes no progress from startsAt to endsAt (groundOps.ts scanClockAt); after the scan (user, GO-7b answers) it
// flies out from holding station and nothing else is delayed (scanBodyIndex null). The team's return ends when
// the ship arrives (arrivesAt). Legs never overlap (a second one waits for the first). Stored at the wipe, so
// every later time is a pure function of stored values.
export interface GroundShipLeg {
  kind: "recovery";
  teamIndex: number; // the (first) team the leg picks up
  // Squads SQ-3 (user 2026-10-12, ONE SHARED PICKUP): every team the leg picks up, ascending index, written only
  // when several teams of one crew wiped together on one body (absent = teamIndex alone).
  teamIndices?: number[];
  bodyIndex: number; // the body the team was on
  scanBodyIndex: number | null; // the body the ship broke off scanning; null = the scan was already done
  startsAt: number;
  arrivesAt: number;
  endsAt: number;
}

// GO-8b (user WWVD, 2026-10-12: "They'd find a planet with atmosphere nearby and set a course. Then land and conduct
// repairs"): a FIELD REPAIR. The ship sets down on `siteBodyIndex` (the nearest rocky world with an atmosphere,
// never a gas giant, D22) or, with none in the system, repairs in orbit (null, slower). It flies there (startsAt
// to arrivesAt), repairs (to repairedAt), flies back (to endsAt) and resumes; while scanning the scan pauses for
// the whole leg (scanBodyIndex, the scan clock). It fixes `hullRepaired` points (the damage at its start) at
// endsAt, when the window latches `done`. Stored when it starts, so every later time is a pure function of stored
// values.
export interface GroundRepairLeg {
  kind: "repair";
  siteBodyIndex: number | null; // null = in orbit
  ordered?: true; // the player ordered it (else the damage threshold did)
  scanBodyIndex: number | null; // the body the ship broke off scanning; null = the scan was already done
  startsAt: number;
  arrivesAt: number;
  repairedAt: number;
  endsAt: number;
  hullRepaired: number;
  done?: true;
}

// GO-7b: the run's ground operations (Expedition.groundOps; plan section 2). One COMBINED operations window
// (user Q1): it opens when the scanning phase begins (startedAt), task work overlaps the scan of later bodies,
// and it closes (endedAt) once every body is scanned, no task is queued or active, and every team is idle, in
// the bay or reloading. The return phase starts then.
export interface GroundOpsState {
  version: 1;
  teams: GroundTeamRun[]; // deployed teams only, ascending ship team index
  factors: GroundOpsFactors; // frozen at dispatch
  shipEventProfile: ShipEventProfile; // frozen at dispatch (GO-8 reads it)
  startedAt?: number; // gameTimeSeconds the window opened (the scanning phase anchor)
  endedAt?: number; // gameTimeSeconds the window closed
  editCount: number; // player edits so far (GO-7d keys the auto-assign stream)
  history: GroundStepRecord[]; // DISPLAY ONLY, capped per team
  shipLegs: GroundShipLeg[]; // recovery legs, in time order
  // GO-8 (user Q12): the hull points of LIGHT DAMAGE the ship carries from its scan events (absent = none). It
  // comes home with the ship at claim (ShipInstance.repairDamage, the Shipyard repair) unless a field repair
  // (GO-8b) fixes it first.
  hullDamage?: number;
  // GO-8b (user WWVD): the ship's FIELD REPAIRS, in time order; absent until the first. Each pauses the scan like
  // a recovery leg and never overlaps another leg (groundOps.ts shipLegsInOrder merges the two lists).
  repairLegs?: GroundRepairLeg[];
  // GO-7c: the run's ground operations LOG, DISPLAY ONLY (resolution never reads it); absent until a line is
  // written, so a run without one keeps its exact shape.
  log?: GroundOpsLogEntry[];
  // Expedition Tiers G2-5: the instant the player RECALLED the ship and the window closed (groundOps.ts
  // closeGroundOps; endedAt is the same instant). Absent on every run nobody recalled.
  recalledAt?: number;
  // Expedition Tiers G2-5: a RESUMED run's scan clock starts past the bodies already charted (Expedition.resume): the
  // clock seconds those bodies take on this run, so the window's startedAt sits that far before it opened and the
  // next body is scanned from the moment it opens. Absent on every other run.
  scanClockSkip?: number;
}

// GO-7c: one line of the ground operations log (groundOps.ts groundOpsLogText words it): a task nobody deployed
// can cover is skipped when its body is planned [PROVISIONAL, Q20]. Squads SQ-3 writes `skippedNeedsSquads`
// (the needs in squads against the deployed squads); `skippedNeedsTeams` (GO-7c, in teams) stays readable for a
// run planned before SQ-3.
export type GroundOpsLogEntry =
  | {
      at: number; // gameTimeSeconds of the planning
      kind: "skippedNeedsTeams";
      taskId: string;
      requiredTeams: number;
      deployedTeams: number;
    }
  | {
      at: number;
      kind: "skippedNeedsSquads";
      taskId: string;
      needs: GroundTaskNeeds;
      deployed: GroundTaskNeeds; // the squads of every deployed team, summed
    }
  | {
      // Objective affixes (AF-1): an objective's alert lapsed at `at` ("the threat appears to have retreated").
      at: number;
      kind: "alertReset";
      taskId: string;
    }
  | {
      // Safe first runs SF-2: a training run's fight was lost at `at` and its guards fell back (the backstop): the
      // fight point cleared, no setback (groundOps.ts TRAINING_FELL_BACK_TEXT).
      at: number;
      kind: "trainingFellBack";
      taskId: string;
    };

// The run's factors, FROZEN at dispatch (D24: the medical factors too). Shares are per DEPLOYED team, in
// GroundOpsSnapshot.teams order (groundOps.ts snapshotGroundOps documents each source).
export interface GroundOpsFactors {
  medicalShare: number;
  rapidRecoveryShare: number;
  officerFacetShare: number;
  injurySteady: number;
  offloadMult: number; // >= 1 is faster; divides the offload step
  reloadMult: number; // >= 1 is faster; divides the reload step
  securityShare: number[];
  scienceShare: number[];
}

// The ship-side scan event inputs, frozen at dispatch (shipScanEvents.ts snapshotShipEventProfile, GO-8; GO-9
// boardingDefense). A flagged run dispatched before GO-8 carries groundOps.ts NEUTRAL_SHIP_EVENT_PROFILE (no
// `battle`) and rolls no ship event, so it keeps its exact shape.
//   evasion        : the ship's battle evasion share at dispatch (officer combat applied; display, the events read
//                    the combatant at each event's wall hours)
//   sensors        : effectiveShipStats(...).sensors at dispatch (the sensor ghost)
//   shieldCapacity : the ship's battle shield pool at dispatch (display, as evasion)
//   engineering    : the Engineering department's Integrity facet (the radiation storm)
//   boardingDefense: crew.boardingDefense (GO-9: the Security division + the Ossir racial)
//   battle         : GO-8, the frozen ship battle inputs. Its PRESENCE is the ship-event flag.
export interface ShipEventProfile {
  evasion: number;
  sensors: number;
  shieldCapacity: number;
  engineering: number;
  boardingDefense: number;
  battle?: ShipEventBattle;
}

// GO-8: the ship's battle inputs, frozen at dispatch (plain JSON data). The events rebuild the ship's combatant
// from them at each event's WALL hours (the officers' Constitution ramp), carrying the run's hull damage.
export interface ShipEventBattle {
  hullType: ShipTypeKey;
  // Deep copies of the ship's installed COMBAT pieces (weapons, shield emitter, hull plating, drone pods) at
  // dispatch; absent when it had none (the ship fights with its hull's default loadout) [PROVISIONAL].
  installedGear?: EquipmentInstance[];
  officerCombat: OfficerCombatEntry[]; // crewOverlay.ts officerCombatProfile at dispatch
  hullMax: number; // the folded hull pool at dispatch (light damage and the field repair threshold are shares of it)
  // GO-8b: the ship's repair speed-up at dispatch (crewOverlay.ts shipRepairSpeedBonus: Rapid Recovery + Veteran
  // Instincts + the Engineering department's Constitution, plus the complement's Damage Control and Mission
  // Turnaround since CP-2), the FIELD REPAIR's divisor. Its presence is the field repair flag (a run without it never
  // sets down for repairs). A run dispatched before CP-2 keeps the value it froze.
  repairSpeed?: number;
  // WR-5b (0.14.0): the commanding captain's Tactician talents frozen at dispatch (captainTacticianEffects.ts
  // captainCombatMods), read by buildShipCombatant. Its Damage Control (aegis3) factor is already folded into
  // repairSpeed above. OPTIONAL: absent when the captain owns no Tactician node.
  captainCombat?: CaptainCombatMods;
}

// The default per-save expedition seed a fresh save starts from, and the value the v58->v59 migration
// backfills onto existing saves (so a fresh save and a migrated save land on the IDENTICAL shape, the
// established convention). A fixed nonzero constant keeps freshState fully deterministic; it is a good
// PRNG mixing start (a decorrelated transform of the crew seed's golden-ratio constant). TUNABLE.
export const EXPEDITION_DEFAULT_SEED = 0x2545f491;

// Expedition Tiers G2-1: the per-save HOMEWORLD (galaxy.ts). Only the SEED is stored; the placement (the point 10 to
// 120 ly from Sol, the region bands measured from it and the enemy territory sectors) is derived from it, never
// stored twice. Drawn ONCE from real entropy: App.svelte's new-game path passes homeworldEntropy.ts's draw to
// freshState, and the SAVE v70 migration seeds an existing save from the entropy migrate is given (user G2: each
// existing save gets its own random homeworld). Plain data (no Decimals).
export interface HomeworldState {
  version: 1;
  seed: number; // a whole number in [0, 2^32)
}

export interface GameState {
  captains: CaptainState[];
  tickDurationSeconds: number; // fleet-wide tick cadence, every captain advances in lockstep on this single cadence (collapsed from a per-captain field during the UI Redesign; see docs/plans/2026-07-07-ui-redesign-design.md)
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  // --- Ship Production Economy (Phase 1, Task 2, docs/plans/2026-07-11-facility-framework-refinery-design.md §7) ---
  // The keyed material balance: a plain itemId -> quantity map that can hold ANY
  // ITEMS-registry key (raw loot, refined goods, and the later component/module/
  // system tiers) WITHOUT a type change. This is the SOLE fleet-wide material
  // store as of Phase 1, Task 7, it fully REPLACED the old fixed-union
  // `homePlanet.storage` field, which has been removed (its keys migrate into
  // this map via MIGRATIONS[17]; freshState seeds the same 5 zero entries).
  //
  // QUALITY-BUCKETED SHAPE (Equipment 0.11.0, Phase 4, Task 9a): each item now maps
  // to an ARRAY of quality-tier buckets (array index = quality tier 0..5), NOT a
  // single Decimal. An item's TOTAL on-hand is the SUM of its buckets. Every access
  // routes through src/lib/game/inventory.ts (itemTotal / getBucket / addItemQuality /
  // removeItemLowestFirst / ...) so the economy behaves identically. Buckets grow
  // LAZILY (commonly length 1, just bucket 0); a read past the array reads 0. Nothing
  // writes a tier above 0 yet, quality ROLLS are a later task; this is a pure shape
  // change so that later work needs no second storage migration. Persistence:
  // save.ts hydrateDecimals revives each bucket array element-wise, and MIGRATIONS[25]
  // (v25 -> v26) converts an old scalar `Record<string, Decimal>` save into buckets.
  inventory: Record<string, Decimal[]>;
  // itemIds the player has held at least once, the persistent "seen" set that
  // drives the future ❓ -> reveal UI (an undiscovered item renders masked until
  // its id lands here). Starts empty on a fresh save; NOTHING appends to it yet
  // (the discovery-on-first-acquire wiring is a later task). A string[] (not a
  // Set) so it serializes cleanly through the JSON save format.
  discovered: string[];
  // ITEM LIFECYCLE 0.13.6 (DORMANT this increment; landed early so the save shape moves ONCE at
  // the start of the release, the same posture as transitBerthLevel above). A BLANK is an
  // uninspected craft: crafting will deposit a stackable, fungible blank keyed by its BLUEPRINT
  // key (every blank of a blueprint is identical because it is not rolled yet), and INSPECT will
  // consume one to mint a rolled EquipmentInstance. Decimal counts, since the player will bank
  // millions, riding the same hydration machinery as `inventory`. NOTHING writes or reads this
  // yet; the craft->blank flip + inspect are the next increment. save.ts hydrates each count and
  // MIGRATIONS[48] backfills {} onto older saves.
  blanks: Record<string, Decimal>;
  // The rolling INSPECT seed (DORMANT this increment). It advances by one per inspect so a reload
  // re-rolls identically (closing the save-scum hole) while blanks stay fungible; the roll derives
  // from this seed AND the item type. A plain number and a pure function of the save, so a server
  // can later RECOMPUTE and verify the roll. freshState seeds 0; MIGRATIONS[48] backfills 0.
  inspectSeed: number;
  unlockedHomeworldTalents: HomeworldTalentKey[]; // fleet-wide purchased Homeworld Talent keys, see buyHomeworldTalent (tick.ts)
  fleetAdminXp: Decimal; // Fleet Admiral leveling, see applyFleetAdminXp (tick.ts)
  fleetAdminLevel: number; // starts at 1
  adminPoints: number; // unspent, spent via buyHomeworldTalent (tick.ts)
  credits: Decimal;
  // (WR-4, OC-C1: the fleet-wide fuel STOCKPILE `fuel` is gone. Fuel is a reach stat since 0.13.6, nothing spent
  // or filled it after Buy Fuel retired, and save v70 drops the field.)
  // WR-4 review (user: "Refund as credits"): the credits the v70 load refunded for that leftover fuel (and any Fuel
  // Depot batch in flight), at the old 20 cr/unit. A ONE-SHOT note: set only by save.ts dropRetiredFuelV70, read once
  // by App.svelte on load to tell the player, then removed. Absent on every other save.
  fuelRefundCredits?: number;
  // --- Ships, Stats Foundation ---
  // The fleet's hulls, distinct from the captains flying them. A ShipInstance's
  // assignedCaptainId is the SINGLE SOURCE OF TRUTH for who flies it, the
  // invariant "every captain always has exactly one assigned ship" is enforced
  // at new-game here (freshState), by migration (save.ts), and at slot unlock
  // (tick.ts) in their own later tasks.
  ships: ShipInstance[];
  shipStorageCapacity: number; // max hulls the fleet can hold (parked + assigned); starter cap
  // Infrastructure 0.13.4 (Phase 0 Unit 0.1, design section 5): the TRANSIT BERTH rung
  // LEVEL. NOTHING READS THIS FIELD YET; Phase 3 is what derives a capacity from it.
  // Landed here dormant so the save shape moves once at the start of the release.
  //
  // ⚠️ THIS IS THE STORED LEVEL, NOT THE DERIVED COUNT, and the distinction is the
  // feature's softlock guarantee rather than a style preference. Design section 3 locks the
  // berth safety argument as STRUCTURAL: occupancy is derived-never-stored and the count has
  // a floor that cannot be reduced. Storing a capacity NUMBER would let a save carry a value
  // the code can no longer justify (the exact drift equipmentStorageCap avoids by computing
  // on read from a level). So Phase 3 computes `TRANSIT_BERTH_BASE + reachedRungs`, base 2,
  // 8 rungs of +1 to a ceiling of 10, and this field only ever holds the rung level.
  //
  // ⚠️ IT IS A SECOND, INDEPENDENT CAPACITY FROM shipStorageCapacity DIRECTLY ABOVE, and
  // they must never be conflated: design section 3 locks that the two "never add, never
  // multiply, never share a pool". Player-facing they are DRYDOCK BERTHS (that field) and
  // TRANSIT BERTHS (this one). They are deliberately adjacent here so the next reader sees
  // both at once rather than discovering the second one later and assuming it replaced the
  // first.
  //
  // Plain number, so it rides hydrateDecimals's `...state` spread with no new branch.
  transitBerthCapacity: number;
  nextShipId: number; // monotonic id source for new ShipInstance.id ("ship-N"); never reused
  // Combat 0.13.0 (Task 1.1): monotonic id source for a new captain's numeric id;
  // never reused, mirrors nextShipId / nextEquipmentId. Captain ids USED to be
  // length-derived (captains.length + 1 at slot-unlock), which is safe ONLY while
  // captains are append-only. Once a captain can be REMOVED (future captain death),
  // a freed slot would let the next unlock reissue a live id and collide. A monotonic
  // counter is the fix: every new captain id is strictly greater than any ever issued.
  // freshState seeds 2 (the one starter "Captain 1" holds id 1); the v30->v31 save
  // migration backfills it as max(existing captain ids) + 1.
  nextCaptainId: number;
  // Combat 0.13.0 (Phase 9b.5a): monotonic id source for a new patrol's MASTER SEED;
  // never reused, mirrors nextShipId / nextCaptainId / nextEquipmentId. Each dispatched
  // patrol takes the CURRENT value as its PatrolMissionState.masterSeed and the counter
  // increments, so every patrol ever dispatched gets a distinct, stable seed. 9b.5b
  // derives every encounter's battle seed from that master seed, which is what makes an
  // offline catch-up resolve byte-identically to a live run (design S0). freshState seeds
  // 1; the v31->v32 save migration backfills 1 onto old saves.
  nextPatrolSeed: number;
  // --- Progression Pacing Rework (docs/plans/2026-07-11-progression-pacing-rework-*) ---
  // Monotonic LIFETIME totals, reserved now for future Completions/Achievements
  // systems to read. These are FORWARD-COMPAT schema only: freshState zero-inits
  // them and the save migration backfills old saves (a later task), but NOTHING
  // increments them yet, the increment wiring lands in its own later task.
  // WHY reserve rather than derive on demand: lifetime totals CANNOT be
  // reconstructed from live state, spent inventory, refined ore, and completed
  // missions all leave no trace once consumed, so the counters must accrue from
  // a clean-slate zero. The four maps are per-key tallies (material key /
  // mission key -> running count), sparse by design: a key is absent until its
  // first recorded event. The three scalars are running lifetime sums.
  lifetimeStats: {
    itemsGathered: Record<string, Decimal>;   // raw mission loot delivered, keyed by material
    itemsRefined: Record<string, Decimal>;     // refine-recipe outputs produced, keyed by material
    itemsCrafted: Record<string, Decimal>;     // fabricate-recipe outputs produced, keyed by material
    missionsCompleted: Record<string, Decimal>; // completed mission cycles, keyed by MissionKey
    creditsEarned: Decimal;                    // lifetime credits gained (gross, not net of spending)
    captainXpAwarded: Decimal;                 // lifetime captain XP granted across all captains
    fleetAdminXpAwarded: Decimal;              // lifetime Fleet Admiral XP granted
  };
  // --- Ship Production Economy (Phase 1, Task 3, facility/process state) ---
  // Reserved schema for the facility framework + timed-process engine (types
  // above). NOTHING reads/writes these yet, the engine that does is Task 8; the
  // Refinery panel is later. freshState seeds `{ refinery: { level: 0 } }` (the one
  // facility Phase 1 ships, not yet built) / `[]` / `1`, and the v17->v18 migration
  // (save.ts, MIGRATIONS[17]) backfills the same baseline onto old saves.
  facilities: Record<string, FacilityState>; // facilityKey -> { level }; level 0 = not built
  activeProcesses: TimedProcess[];            // in-flight refine jobs + facility upgrades (empty until Task 8 starts one)
  nextProcessId: number;                      // monotonic id source for new TimedProcess.id ("proc-N"); never reused
  // --- Crafting Allocation Redesign (Task C2, docs/plans/2026-07-16-crafting-
  // allocation-redesign-design.md §2) --------------------------------------------
  // The per-slot production LINES that REPLACE the single refineOrder/fabricateOrder
  // (both RETIRED in Task C4, the single-order fields are gone). Each
  // facility owns an array of independent lines, one per occupied slot, so a
  // 3-slot Refinery can refine 3 DIFFERENT recipes at once (the single-order model
  // could only run one recipe across all slots). The array LENGTH is capped at the
  // facility's derived slot count (refineSlotCount/fabricateSlotCount) by startLine
  // (tick.ts). Material ALLOCATION is DERIVED from these arrays, never stored
  // (allocation.ts, C1): allocated(item) = Σ line.remaining × inputsPerIteration.
  // freshState seeds both `[]`; the v23->v24 migration (save.ts, Task C6) backfills
  // the same empty seed onto existing saves + drops any legacy order. NO Decimal on
  // CraftLine (id/recipeKey strings, remaining a plain number, mode a string-literal
  // union), so hydrateDecimals needs no change, the arrays ride the `...state`
  // spread verbatim.
  refineLines: CraftLine[];
  fabricateLines: CraftLine[];
  // ⚠️ INFRASTRUCTURE 0.13.4 (Phase 5, design section 7.3.1): THE ORDERS the lanes above pull
  // from. One array for every facility (each order names its own `facility`), because the
  // allocation math and the join pass both want "every order in the fleet" far more often than
  // they want one facility's.
  //
  // ⚠️ OPTIONAL, AND EMPTY IS THE PRE-0.13.4 WORLD. A lane with no orderId reads its own
  // `remaining` exactly as it always has, so a save with no orders behaves byte-identically. That
  // is what keeps design section 3's locked item 6 (a single-lane facility must be byte-identical)
  // true, and with it the 101 parity baseline.
  //
  // ⚠️ NO DECIMALS IN HERE. Every field is a string, a string-literal key or a plain number, the
  // same discipline QueuedJob follows, so the array rides hydrateDecimals's `...state` spread with
  // no new branch. An iteration COUNT is a number; only the item amounts it implies are Decimals,
  // and those are computed on read from the recipe.
  craftOrders?: CraftOrder[];
  // The id source for craftOrders, mirroring nextCompletionLogId / nextCraftLineId. Monotonic and
  // never reused, so a cancelled order's id cannot collide with a later one.
  nextCraftOrderId?: number;
  // Monotonic id source for new CraftLine.id ("craft-N"); never reused, mirrors
  // nextShipId ("ship-N") / nextProcessId ("proc-N"). A started line's timed job
  // stamps this id on TimedProcess.lineId so the engine can match a job back to its
  // line (one in-flight job per line). freshState seeds 1; the C6 migration backfills 1.
  nextCraftLineId: number;
  // --- Research (Phase 3, Task R1, docs/plans/2026-07-15-research-*.md §2) ---
  // The set of UNLOCKED blueprint keys (BLUEPRINTS ids the player has researched).
  // Modeled as a string[] rather than a Set so it serializes cleanly through the JSON
  // save format, the SAME choice `discovered` (above) and unlockedHomeworldTalents
  // make. String keys carry NO Decimal, so hydrateDecimals (save.ts) needs NO change:
  // the field rides through its `...state` spread untouched, exactly like `discovered`.
  // freshState seeds [] (nothing researched on a new save). The v21->v22 seed migration
  // that backfills [] onto existing saves is Task R6's job, NOT freshState's. The
  // research-project ENGINE that appends to this (startResearch + the resolver's
  // unlockBlueprint effect) is Task R3; R1 only DEFINES + seeds the field and the two
  // pure read helpers below (blueprintUnlocked / blueprintResearchable).
  researchedBlueprints: string[];
  // --- Equipment 0.11.0 (Task 3, docs/plans/2026-07-17-equipment-*.md) ----------
  // The GLOBAL equipment POOL: every piece the fleet owns, fitted or spare. An
  // EquipmentInstance.fittedToShipId is the authority for which SHIP holds a
  // piece (null = on no ship; "free to take" is isSparePiece), mirroring how ShipInstance
  // .assignedCaptainId owns assignment rather than a duplicated flag, so the two
  // can never disagree. Starts EMPTY on a fresh save; nothing generates or fits
  // pieces yet (generation/fitting are later tasks). No Decimal on the instance,
  // so hydrateDecimals (save.ts) needs no change, the array rides the `...state`
  // spread verbatim, exactly like `ships`.
  equipment: EquipmentInstance[];
  // Monotonic id source for new EquipmentInstance.id ("equip-N"); never reused,
  // mirrors nextShipId ("ship-N") / nextProcessId ("proc-N") / nextCraftLineId
  // ("craft-N"). freshState seeds 1 so the first minted id is "equip-1".
  nextEquipmentId: number;
  // ITEM LIFECYCLE 0.13.6 (Armory, Phase 3; DORMANT until the Armory build). The loadout store + its
  // monotonic id source. A loadout is a saved, ship-type-pinned equipment set (see the Loadout
  // interface); checking one out to a ship equips + locks that ship. Empty on a fresh save;
  // MIGRATIONS backfills [] + 1 onto older saves. No Decimals inside, so hydrateDecimals is untouched.
  loadouts: Loadout[];
  nextLoadoutId: number;
  // ITEM LIFECYCLE 0.13.6 (the Archive, Phase 4). The completionist record: for each
  // CRAFTABLE-equipment blueprint key, the BEST enshrined result as an ArchiveEntry (the score plus,
  // since v54, the rarity + quality of that best roll so the console can show WHAT you enshrined).
  // Slotting CONSUMES the item and keeps only this entry, never a live instance. Empty on a fresh
  // save; MIGRATIONS backfills {} then wraps old numeric scores into { score }. Score =
  // (rarityIndex+1) x (quality+1) x iLevel x 10; completion %'s denominator is the item's absolute
  // tier ceiling (see archive.ts). No Decimals. `rarity`/`quality` are optional: an entry migrated
  // from the pre-v54 numeric form has only the score until the item is re-enshrined.
  archive: Record<string, ArchiveEntry>;
  // The crafting skill track that later tasks use to gate/boost equipment
  // crafting. craftingLevel is 1-based (starts at 1, parallels fleetAdminLevel;
  // level 0 is unused). craftingXp is the accumulator toward the next level,
  // Decimal-typed because it is an idle-scale total like fleetAdminXp/credits
  // (round-trips through JSON as a string, MUST be re-hydrated on load by
  // save.ts's hydrateDecimals once the Task 20 migration seeds it). This pass
  // only DEFINES + seeds them; the XP-award + level-up engine is a later task.
  craftingLevel: number;
  craftingXp: Decimal;
  // --- Equipment storage cap (0.11.0 Storage/Salvage Task B1) -------------------
  // The 0-based count of PURCHASED equipment-storage upgrade rungs, the STORED input
  // to equipmentStorageCap (which ADDS one EQUIPMENT_STORAGE_RUNGS[i].slotIncrement to
  // EQUIPMENT_STORAGE_CAP_BASE per reached rung). Mirrors how a material
  // warehouse stores its LEVEL (state.facilities[warehouseKey].level) and DERIVES the
  // cap on read, so the cap is never a stored value that could drift. freshState seeds
  // 0 (base cap, no rung bought); the v28->v29 migration seeds 0 on old saves. A plain
  // number (no Decimal), so hydrateDecimals needs no change, it rides the `...state`
  // spread. Task B2 fills the rung table; this field's engine (the purchase action) is
  // Task B2's job, B1 only DEFINES + seeds it and reads it in equipmentStorageCap.
  equipmentStorageLevel: number;
  // --- Crafting 0.13.3 (Phase 1 Unit 1.1) ---------------------------------------
  // The QUEUE: orders waiting for a free facility slot. ONE FLAT ARRAY across every
  // queue-capable facility, mirroring activeProcesses exactly (one field, one
  // migration, one pass, one save shape). Per-facility DEPTH is then DERIVED by
  // counting entries whose `facility` matches, never stored, so it cannot drift from
  // the talent that grants it. A per-facility array shape would instead FREEZE the
  // facility set into the schema, so adding the Research queue in 0.13.4 would need
  // another migration; a flat array plus a widened union needs none.
  //
  // ARRAY INDEX IS THE QUEUE ORDER (FIFO). Nothing sorts or reorders this array; the
  // Unit 1.4 promotion pass SKIPS a blocked entry in place rather than moving it.
  //
  // NOTHING READS THIS YET (Unit 1.1 is schema only). freshState seeds []; the
  // v39->v40 migration (save.ts, MIGRATIONS[39]) backfills [] onto existing saves.
  // Carries no Decimal (see QueuedJob's warning above), so hydrateDecimals is unchanged.
  processQueue: QueuedJob[];
  // ⚠️ THE AUTO-SALVAGE TERMINAL'S OWN WAITING LIST (2026-09-11), and a SEPARATE ARRAY from
  // processQueue above on purpose. The automation writes here and NOWHERE ELSE, which is what
  // makes "auto-salvage never touches the player's queue" a fact about the data model instead
  // of a filter that five call sites have to remember to apply. Three properties fall out of
  // that and all three are requirements, not side effects:
  //   - it is UNBOUNDED (queueDepth is a per-facility cap on processQueue and does not reach
  //     this array), which is the user's own call: "No queue size limitations are necessary";
  //   - it cannot consume, reorder or be counted in the player's depth readouts;
  //   - its entries run ONLY on Terminal lanes plus idle general lanes (see tick.ts's
  //     salvageLaneUsage), never on a general lane the player wanted this tick.
  // Same QueuedJob shape and the SAME nextQueueId counter as processQueue, so no id can ever
  // name an entry in both arrays. Carries no Decimal, for the same reason processQueue does
  // not, so hydrateDecimals is unchanged. freshState seeds []; the v43 -> v44 migration
  // backfills [] onto existing saves.
  autoSalvageQueue: QueuedJob[];
  // ⚠️ THE BORROW WINDOW'S BOOKKEEPING (2026-09-11). Auto-salvage may borrow an IDLE general
  // lane, but only after that lane has sat idle for AUTO_SALVAGE_BORROW_IDLE_SECONDS, so a
  // player whose job just finished is not racing the automation for their own bay. See
  // SalvageIdleWatch above for why this one lane fact is STORED when every other one is
  // derived. OPTIONAL because a save that predates it must load: an absent watch reads as
  // "the window has not elapsed", the fail-safe direction, and the next tick seeds it.
  salvageIdleWatch?: SalvageIdleWatch;
  // Monotonic id source for new QueuedJob.id ("q-N"); never reused, mirrors
  // nextShipId ("ship-N") / nextProcessId ("proc-N") / nextCraftLineId ("craft-N").
  // freshState seeds 1 so the first minted id is "q-1"; the v39->v40 migration
  // backfills 1. A counter (not queue.length) so a removed entry can never let a
  // later enqueue reissue a live id.
  nextQueueId: number;
  // The opt-in auto-salvage rules, in the SAVE because they run in the tick and the
  // offline path can only read the save (see AutoSalvageRules above for the full
  // rationale). freshState seeds the all-off default; the v39->v40 migration
  // backfills the identical default. Nothing evaluates these until Phase 5.
  autoSalvage: AutoSalvageRules;
  // The per-quality salvage-confirm preference: the quality tiers that REQUIRE a
  // confirmation before salvaging. Same semantics as the localStorage predecessor in
  // src/lib/salvageConfirmPreference.ts (a tier PRESENT in this array needs a confirm;
  // absent means salvage immediately), so nothing about the player-facing meaning
  // changes, only where it is stored.
  //
  // WHY IT MOVED OUT OF localStorage AND INTO THE SAVE (user decision, 2026-09-01):
  // the Phase 5 auto-salvage rules must never auto-salvage a tier the player asked to
  // be asked about, and those rules run in the tick INCLUDING the offline catch-up
  // path, which can only read the save. A localStorage-only preference is invisible
  // there, so offline would silently destroy an item live would have stopped to ask
  // about. ACCEPTED TRADEOFF: the preference stops being per-device and now follows
  // the save across devices (chosen deliberately over mirroring, which would leave two
  // sources of truth free to drift).
  //
  // ⚠️ UNIT 1.1 SEEDS THIS FIELD BUT NOTHING READS IT YET. The Salvage Bay UI still
  // reads and writes the localStorage value through salvageConfirmPreference.ts, and
  // that path is left working ON PURPOSE so the console keeps behaving correctly
  // mid-phase; a later unit repoints the checkboxes at this field and makes the save
  // the single source of truth. The v39->v40 migration SEEDS this from the existing
  // localStorage value so no player silently loses a setting they already chose.
  // freshState seeds the confirm-every-tier default (freshSalvageConfirmQualities).
  salvageConfirmQualities: number[];
  // --- Crafting 0.13.3 (Unit 4.4b): the COMPLETED-EVENTS LOG -----------------
  // The ring buffer of finished ORDERS, oldest first, capped at COMPLETION_LOG_CAP
  // (oldest evicted). Written ONLY from inside resolveProcesses (and by cancelLine, for
  // the one orphan case it owns), so offline catch-up and live stepping produce identical
  // logs by construction. See CompletionLogEntry above for the full rationale.
  completionLog: CompletionLogEntry[];
  // Monotonic id source for CompletionLogEntry.id ("done-N"); never reused, mirrors
  // nextQueueId ("q-N") / nextProcessId ("proc-N"). A counter rather than log.length so an
  // evicted entry can never let a later completion reissue a live id.
  nextCompletionLogId: number;
  // The in-flight accumulations for line-backed orders whose batch has not finished yet
  // (see OpenJobBatch). Never rendered; this is engine bookkeeping that exists purely so
  // ONE entry can be emitted per ORDER rather than one per iteration.
  openJobBatches: OpenJobBatch[];
  // --- Crew 0.14.0 (Phase 0, DORMANT) --------------------------------------------------------
  // The crew layer's fleet-wide state, landed dormant so the save shape moves once at the start
  // of the release. NOTHING reads or writes any of these yet (the Senior Staff engine, transports,
  // and auto-crew are later phases). freshState seeds the clean-slate defaults below; the
  // v54->v55 migration (save.ts) backfills the IDENTICAL defaults onto existing saves, so a fresh
  // save and a migrated save stay indistinguishable in shape. Crew counts are plain integers, not
  // Decimals, so hydrateDecimals needs no new branch. See CrewSignature above for why crew persist
  // as signature buckets rather than per-person objects.
  officers: SeniorStaffOfficer[]; // named bridge officers, keyed to a ship by assignedShipId + seat
  nextOfficerId: number; // monotonic id source for a new officer id; never reused, mirrors nextShipId
  crewPool: CrewBucket[]; // the UNASSIGNED complement (the transport influx target)
  notableCrew: NotableCrewMember[]; // the bounded roster of graduated standouts
  nextNotableId: number; // monotonic id source for a new NotableCrewMember id; never reused
  lastTransportWindow: number; // gameTimeSeconds transport-window accumulator (offline catch-up delivers the backlog)
  // Senior Staff candidate roster (Phase 1). The roster is regenerated DETERMINISTICALLY from a
  // gameTimeSeconds window index + this per-save seed (seniorStaff.ts seniorStaffCandidates), never
  // Date.now(), so it is identical live vs offline and needs no catch-up loop. The seed is stable
  // for the life of a save. `seniorStaffRosterSize` is the current roster size (base 10), read as a
  // value so a later upgrade can expand it. Nothing reads either field yet (dormant).
  seniorStaffSeed: number; // stable per-save PRNG seed for the deterministic candidate roster
  seniorStaffRosterSize: number; // how many candidates the roster shows (base SENIOR_STAFF_ROSTER_BASE, upgradeable later)
  // --- Crew 0.14.0 (Phase C-2): PERSONNEL ROSTERS ----------------------------------------------
  // The saved personnel loadouts (see PersonnelRoster above). freshState seeds the clean-slate
  // defaults (no rosters, id counter at 1 so the first minted id is "roster-1", mirroring
  // nextLoadoutId's "next allocatable" seeding). The v56->v57 migration backfills the IDENTICAL
  // defaults onto existing saves, so a fresh save and a migrated save stay indistinguishable in shape.
  // Rosters run ONLY on explicit user action (personnelRosters.ts), never on the tick, so this stays
  // additive-neutral: with no roster applied, all existing behavior + the crew parity tests are
  // byte-identical.
  personnelRosters: PersonnelRoster[];
  nextRosterId: number; // monotonic id source for a new PersonnelRoster id; never reused, mirrors nextLoadoutId / nextShipId
  // --- Exploration 0.14.0 (Phase E2a): the long-distance EXPEDITION state machine ----------------
  // The fleet's active expeditions (see Expedition above). ONE array, one migration, one save shape,
  // mirroring `ships` / `officers`. At most one expedition per ship is enforced at dispatch
  // (startExpedition, expedition.ts). Each expedition resolves INDEPENDENTLY + deterministically on
  // the tick (resolveExpeditions, run once per whole tick at the same tail seam as resolveCrew).
  //
  // ⚠️ ADDITIVE-NEUTRAL: with NO active expedition this array is EMPTY, and resolveExpeditions returns
  // the SAME state reference on an empty array, so the whole tick path + every derived state is
  // byte-identical to before this phase (the no-expedition byte-identical test proves it). No Decimals
  // inside an Expedition (ids/strings/numbers/booleans only), so hydrateDecimals is unchanged; the
  // array rides the `...state` spread verbatim like `ships`.
  expeditions: Expedition[];
  // Monotonic id source for a new Expedition.id ("expedition-N"); never reused, mirrors nextShipId.
  // freshState seeds 1 so the first minted id is "expedition-1"; the v58->v59 migration backfills 1.
  // It used to give the inaugural run (nextExpeditionId === 1) its shorter SHAKEDOWN transit; safe first runs SF-2
  // retired that (the training run, runDifficulty.ts isTrainingExpedition, is the first run from an explorer).
  nextExpeditionId: number;
  // The per-save expedition PRNG seed. Each dispatched expedition derives its OWN stable seed from
  // this seed + its expedition number (expedition.ts makeExpeditionSeed), so every expedition's
  // outcomes (system pick, bodies, anomaly, discoveries) are reload-deterministic yet decorrelated,
  // the SAME pattern seniorStaffSeed / inspectSeed use. freshState seeds EXPEDITION_DEFAULT_SEED; the
  // v58->v59 migration backfills the identical default. A plain number, so hydrateDecimals is unchanged.
  expeditionSeed: number;
  // Squads SQ-6 (user, SQ-5 call (b), 2026-10-13: start counting blind launches now): how many expeditions were
  // dispatched BLIND (beyond the Subspace Telescope's range), so the future "go in blind" achievement can award
  // retroactively. OPTIONAL: absent reads 0 (telescope.ts blindLaunchCount) and startExpedition writes it only on
  // a blind dispatch, so a save that never launched blind carries no key. A plain number: no SAVE bump, and
  // hydrateDecimals carries it through its `...state` spread. Nothing on the tick reads it.
  blindLaunches?: number;
  // Expedition Tiers G2-2 review (user 2026-10-19, "Next list for veterans"): the dispatch count whose Tier I list
  // holds Wolf 359 for a VETERAN save (runCounts.expedition.veteran: it flew expeditions before 0.14.0, so it passed
  // the list after its first run without meeting Wolf 359). Written ONCE by startExpedition on a veteran's first
  // dispatch under 0.14.0: the count of the list it dispatched from when that list already held Wolf 359 (seen), else
  // the next count (the next freshly generated list holds it on slot 0). OPTIONAL: absent on every new game (its list
  // after the first run holds Wolf 359 by WOLF_359_LIST_AFTER_DISPATCHES), so a save that is not a veteran never
  // carries the key. A plain number: no SAVE bump, hydrateDecimals carries it through its `...state` spread.
  wolf359List?: number;
  // Expedition Tiers G2-5: the systems recalls left behind (HeldSystem: ordinary candidates again, or resumable),
  // oldest first. OPTIONAL: absent until the first recall that leaves one, so every save keeps its exact shape. Plain
  // data: no SAVE bump, hydrateDecimals carries it through its `...state` spread.
  heldSystems?: HeldSystem[];
  // Safe first runs SF-1: the per-type run counters (RunCounts above; rules in runDifficulty.ts). freshState seeds
  // freshRunCounts(); save v70 derives them for an older save from its history (veterans). Written by claimExpedition,
  // dispatchCaptainOnPatrol and economyTick's patrol fold. OPTIONAL: absent (a dev save at v70 from before SF-1) reads
  // the derived counters (runDifficulty.ts runCountsOf). Plain data, so hydrateDecimals carries it through `...state`.
  runCounts?: RunCounts;
  // G1-3 (Short-Range Missions): the board's per-slot cycle cursor (ShortRangeBoardState below). OPTIONAL: absent
  // reads as every slot at cycle 0 (shortRangeNextCycle, shortRangeBoard.ts), so no save needs a step; written by
  // the cycle engine (G1-4) when a cycle delivers. A malformed value reads as absent (save.ts hydration). Plain data.
  shortRangeBoard?: ShortRangeBoardState;
  // Expedition Tiers G2-1: the per-save homeworld seed (HomeworldState above; placement in galaxy.ts). freshState
  // stores the seed it is given (every new game: App.svelte passes a fresh draw); SAVE v70 seeds it on an older save
  // (save.ts withHomeworldV70, which every load also runs, so a save already at v70 from before G2-1 gets one too).
  // OPTIONAL only for freshState with no seed (tests and the sim), which reads the provisional spot near Sol
  // (galaxy.ts stateHomeworld); no loaded save lacks it. Display only at G2-1: nothing on the tick reads it.
  homeworld?: HomeworldState;
  // --- Exploration 0.14.0 (Phase E3a): the away-team GAMBIT program pair --------------------------------
  // The player's ACCOUNT-LEVEL Security + Science gambit programs (the EDITABLE source; the E3b UI writes
  // these). D19 (user, 2026-10-06): NO battle reads this pair any more (members run their own program, else
  // DEFAULT_MEMBER_GAMBIT) and startExpedition no longer snapshots it; it is kept, as stored, for the
  // editor until the per-member editor (E-CREW Task 17) decides its future. freshState seeds
  // DEFAULT_GAMBIT_PROGRAMS (== the "Balanced" preset); the v61->v62 migration backfills the identical
  // default. Plain nested arrays/objects (no Decimals), so hydrateDecimals is unchanged, and NOTHING on the
  // tick path reads this field except a dispatch, so a save with no expedition stays additive-neutral.
  gambitPrograms: GambitPrograms;
  // --- Exploration 0.14.0 (Phase E4a): the RELIC STORE ---------------------------------------------
  // See the RELICS block above RelicVaultToken. All plain values (no Decimals), so hydrateDecimals is
  // unchanged; freshState seeds the empty store and the v62->v63 migration backfills the IDENTICAL shape.
  // ⚠️ ADDITIVE-NEUTRAL: an empty vault + empty museum reads all-zero museumBonuses (relics.ts), and the
  // tick only touches these when a "relicStudy" process completes, so a save with no relics is
  // byte-identical on the tick path.
  // The UNIDENTIFIED relics waiting for Research (claimExpedition appends; startRelicStudy removes one
  // into its process). Ordered by arrival.
  relicVault: RelicVaultToken[];
  // The MUSEUM (Relics v2 R2-1: the MuseumV2 record above, which replaced the v1 `relicMuseum` copy record; the
  // v69 -> v70 step moves the v1 copies into museumV2.general["1"]). Read and written through relics.ts
  // generalMuseumRecord / withGeneralMuseumRecord. Plain numbers (copy counts are small integers, never idle-scale).
  museumV2: MuseumV2;
  // The DISCOVERED registry: relic ids in FIRST-FIND order, each appended exactly once (the first
  // identified copy of its type). The unknown-relic discovery unlock reads this.
  relicDiscovered: string[];
  // The per-save relic PRNG seed (RELIC_DEFAULT_SEED by default). Fixed; never advanced.
  relicSeed: number;
  // Monotonic study index, stamped onto each relicStudy process at START (the "index" the keyed
  // identification roll mixes in). freshState seeds 1; never reused.
  nextRelicStudyIndex: number;
  // Relics v2 R2-1 (DORMANT; plan 2026-10-17 section 3.2, OC-12 "Free, queued, lanes by Lab"): vault token ids queued
  // for identification, in order. Absent = an empty queue; nothing writes it until R2-3.
  relicQueue?: string[];
  // ===== E-CREW "Crew Made Real" (Task 2, DORMANT) =====
  // The away-team roster and the Armory squad loadouts (see the AwayMember / GroundTeamLoadout block above).
  // freshState seeds the clean-slate defaults; the v64->v65 migration (save.ts) backfills the IDENTICAL
  // values, so a fresh save and a migrated save stay indistinguishable. All plain values (no Decimals),
  // so hydrateDecimals is unchanged. NOTHING reads or writes these yet.
  // The RECRUIT BOARD itself is NOT persisted: like seniorStaffCandidates it will be derived from
  // awayRecruitSeed + the roster window index (a later task), regenerated identically live and offline.
  awayMembers: AwayMember[]; // the named away-team members, keyed to a ship by assignedShipId
  nextAwayMemberId: number; // monotonic id source for "member-N"; never reused, mirrors nextOfficerId
  awayRecruitSeed: number; // stable per-save PRNG seed for the derived recruit board (awayRecruitSeedFrom)
  squadLoadouts: GroundTeamLoadout[]; // the Armory squad loadouts, one per ground team (GO-1 reshape; v67 coerces to [])
  nextSquadLoadoutId: number; // monotonic id source for a new GroundTeamLoadout id; never reused
  // Prospecting squads (0.14.0, built HIDDEN; design 2026-10-16 section 8): the PER-SAVE unlock. ABSENT = locked
  // (every save in 0.14.0: nothing sets it). A quest step in the prospecting quests patch sets it through
  // prospecting.ts unlockProspectingSquads (user 2026-10-16: "A quest step unlocks it"). While locked no recruit,
  // team kind, Quartermaster row or worn-by line names Prospecting. Optional + absent-safe: no SAVE_VERSION bump.
  prospectingSquadsUnlocked?: true;
}

// RecipeKey / RecipeDef / RECIPES (the legacy INSTANT Homeworld craft path) were
// RETIRED in the Fabricator feature (Phase 4, Task F5). The timed Fabricator
// facility (BLUEPRINTS + craftDurationTicks + the per-slot production-line engine in
// tick.ts) fully subsumes that mechanic, researched blueprints crafted over time via
// the line/slot engine, feeding the SAME lifetimeStats.itemsCrafted tally. The old
// `recipeBonusOutput` Homeworld Talent effect that only modified this instant path
// was retired with it (see HomeworldTalentEffect below).

// --- Timed refine recipes (Ship Production Economy, Phase 1, Task 11 --
// docs/plans/2026-07-11-facility-framework-refinery-design.md §6) ----------------
// The going-forward, TIMED refinery mechanic. (The old instant
// RECIPES/craftRecipe() path this once stood beside was RETIRED in Phase 4,
// Task F5, once the Fabricator subsumed it, see the retirement note above.)
// A refine recipe is inputs -> ONE output over a fixed
// duration; startRefineJob (tick.ts) hands it to the Task 8 startProcess engine
// (atomic deduct-at-start), and resolveProcesses grants the output + increments
// lifetimeStats.itemsRefined on completion.
//
// The `output` shape mirrors ProcessEffect's addItem member ({ itemId, amount })
// rather than RECIPES' { key, amount }, because that is exactly what startRefineJob
// forwards to startProcess as the completion effect, one shape, no re-mapping.
// `input`/`output.itemId` are plain-string keyed (Record<string, Decimal> / string),
// forward-loose like inventory + ProcessEffect, so a later recipe targeting a
// not-yet-unioned item needs no type change here.
export interface RefineRecipeDef {
  input: Record<string, Decimal>;      // deducted ATOMICALLY at job start (design §4)
  output: { itemId: string; amount: Decimal }; // granted on completion (marks discovered)
  durationTicks: number;               // FIXED job length; also the lump Fleet Admiral XP awarded
  // Crafting 0.13.3 (Phase 3 Unit 3.1, design §6.1): this recipe's CRAFTING-XP weight,
  // in quarters (the numerator over CRAFTING_XP_WEIGHT_DENOM). ABSENT on every recipe
  // shipped so far, which is the point: absent means REFINE_XP_WEIGHT_NUM (1, i.e. a
  // 0.25x multiplier on the base rate), and both current recipes sit on that default.
  //
  // WHY THE FIELD EXISTS AT ALL, given nothing overrides it yet. Crafting level drives
  // crafted-equipment iLevel, so every crafting activity has to feed it, but bulk
  // refining must NOT be a viable road to the iLevel ceiling: it is high volume, low
  // value, ungated by research, and endlessly repeatable off mission loot. The weight
  // model is what stops it leading (see craftingProgress.ts's header for the arithmetic
  // proof). This field is the per-recipe tuning knob for that model, so a future tier-2
  // refine recipe declares its own worth HERE, in the data table, instead of forcing a
  // branch into the award function.
  //
  // WHY NOT DERIVE THE WEIGHT FROM THE OUTPUT ITEM'S TIER: `ITEMS[].tier` is the
  // WAREHOUSE storage tier (what cap bucket the item lives in), not a recipe value tier,
  // and every current item is T1. Reading it would silently tie XP value to a storage
  // concern and would read the same for every recipe anyway.
  //
  // OPTIONAL, not defaulted in the table, so adding it needs no save migration and no
  // edit to the existing rows: it is static content data, never persisted.
  xpWeightNum?: number;
}

// Phase 1 seeds ONE real recipe, same "no placeholders" discipline as
// MISSIONS/RECIPES/FACILITIES. Keyed as Record<string, ...> (not a narrow union)
// to match FACILITIES' forward-loose keying + let startRefineJob look up an
// arbitrary recipeKey string with a runtime guard.
//
// ⚠️ TUNABLE first-pass ⚠️ these recipes CONNECT the Refinery to the Fabricator: they
// produce the exact refined materials the tier-1 blueprints consume, so the production
// chain (mine -> refine -> fabricate) is playable end-to-end. Ratios + durations are
// device-check tunables; the target item ids (`titaniumIngot`/`polysilicateWafer`) exist
// in ITEMS with "Refined from ... at the Refinery" unlockHints written forward for this.
//   - Titanium Ore (`commonOre`) is the common staple -> a 20:1 input ratio, 12-tick job.
//   - Polysilicate Ore (`uncommonMaterial`) is the UNCOMMON strike (scarcer drop) -> a
//     cheaper 5:1 ratio so the rarer feedstock isn't punishing.
// Add entries here (and nowhere else, the future Refinery panel iterates this object) as
// more refine recipes land.
//
// ITEM-MERGE (0.11.0 Task A1, 2026-07-18): the retired duplicate `refinedMaterial` item was
// folded into `titaniumIngot` (the sole refined-titanium item).
//
// RECIPE-COLLAPSE (0.11.0 cleanup, 2026-07-20): there used to be TWO recipes making
// titaniumIngot from commonOre, a wasteful `refineCommonOre` (100:1, 10 ticks) and a
// player-friendly `refineTitaniumIngot` (20:1, 12 ticks). Because the Refinery dropdown
// labels options by OUTPUT item, both rendered as "Titanium Ingot", a confusing duplicate.
// They are collapsed into ONE: the surviving key is `refineCommonOre` (dozens of tests use
// it as their canonical fixture key, so keeping it minimizes churn) but its NUMBERS are now
// the player-friendly 20:1 / 12-tick values (so players are not stuck with the 100:1 waste).
// `refineTitaniumIngot` was RETIRED; any reference to it repoints to `refineCommonOre`.

// ML-1 (0.14.0, Material Lines; plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 3.1): the seven
// July-approved recipes the user re-confirmed as named (L1, 2026-10-19 "Build as named"): three simple refines and
// four compounds (multi-input; the engine deducts and reserves every input). Keys and items are the user's; ONLY the
// numbers were mine, and the user approved them as built (2026-10-20, ML-1 review):
// a common ore refines like Titanium Ore (20:1, 12 ticks), an uncommon one like Polysilicate Ore (5:1, 20 ticks), a
// rare one at 3:1; a compound takes a few of its raw plus one or two refined goods and runs 20 ticks. Every duration is
// one the speed rungs keep at an exact crafting XP per tick (the WR-4 rule, refine.test.ts; 40 breaks it).
const MATERIAL_LINE_RECIPE_NUMBERS: Readonly<Record<string, { input: Record<string, number>; output: string; ticks: number }>> = {
  refineFerriteIngot: { input: { ferriteOre: 20 }, output: "ferriteIngot", ticks: 12 },
  refineReclaimedCircuit: { input: { salvagedCircuitry: 5 }, output: "reclaimedCircuit", ticks: 20 },
  refineIridiumCatalyst: { input: { rareMaterial: 3 }, output: "iridiumCatalyst", ticks: 20 },
  synthCobaltCoil: { input: { cobaltOre: 3, titaniumIngot: 1 }, output: "cobaltCoil", ticks: 20 },
  synthOsmiumPlate: { input: { osmiumOre: 2, ferriteIngot: 2 }, output: "osmiumPlate", ticks: 20 },
  synthPhotonicGel: { input: { polysilicateWafer: 1, volatileResin: 3 }, output: "photonicGel", ticks: 20 },
  synthBiocatalyst: { input: { purifiedBiomass: 2, exoticSporeCluster: 1 }, output: "biocatalyst", ticks: 20 },
};

// ML-2 with the recipe realism audit (Group B call 6, user 2026-10-21 "Biofiber + Resin Distillate"; follow-up ratios
// "5:1 and 3:1 (Recommended)", 20 ticks each): fiber for plating and armor, a distilled resin for seals and grenade
// agents. 20 ticks keeps the speed rung's crafting XP per tick exact (the WR-4 rule).
const RECIPE_REALISM_REFINE_NUMBERS: Readonly<Record<string, { input: Record<string, number>; output: string; ticks: number }>> = {
  refineBiofiber: { input: { fibrousBiomass: 5 }, output: "biofiber", ticks: 20 },
  refineResinDistillate: { input: { volatileResin: 3 }, output: "resinDistillate", ticks: 20 },
};

// Built once at module load; REFINE_RECIPES spreads it after its hand-written rows.
function materialLineRecipes(): Record<string, RefineRecipeDef> {
  const out: Record<string, RefineRecipeDef> = {};
  for (const [key, r] of [...Object.entries(MATERIAL_LINE_RECIPE_NUMBERS), ...Object.entries(RECIPE_REALISM_REFINE_NUMBERS)]) {
    out[key] = {
      input: Object.fromEntries(Object.entries(r.input).map(([id, n]) => [id, new Decimal(n)])),
      output: { itemId: r.output, amount: new Decimal(1) },
      durationTicks: r.ticks,
    };
  }
  return out;
}

export const REFINE_RECIPES: Record<string, RefineRecipeDef> = {
  refineCommonOre: {
    input: { commonOre: new Decimal(20) },
    output: { itemId: "titaniumIngot", amount: new Decimal(1) },
    durationTicks: 12,
  },
  refinePolysilicateWafer: {
    input: { uncommonMaterial: new Decimal(5) },
    output: { itemId: "polysilicateWafer", amount: new Decimal(1) },
    durationTicks: 20,
  },
  // WR-4 (OC-C3, user 2026-10-16 "Add Refinery recipes": "Scrap Alloy refines into Reclaimed Alloy and Fibrous
  // Biomass into Purified Biomass; each becomes an input to existing Fabricator recipes"). Both inputs are common
  // mission staples (the Salvage and Forage runs, plus expedition hauls). [PROPOSAL] every number here (the user
  // tunes them): Reclaimed Alloy was tagged RARE, so 10:1 (ML-1 retags it uncommon, display only; the ratio stays
  // until the user tunes it); Purified Biomass is uncommon, so 6:1. Both run 20
  // ticks, the Polysilicate Wafer's length (a duration must keep the speed rung's crafting XP per tick exact).
  refineReclaimedAlloy: {
    input: { scrapAlloy: new Decimal(10) },
    output: { itemId: "reclaimedAlloy", amount: new Decimal(1) },
    durationTicks: 20,
  },
  refinePurifiedBiomass: {
    input: { fibrousBiomass: new Decimal(6) },
    output: { itemId: "purifiedBiomass", amount: new Decimal(1) },
    durationTicks: 20,
  },
  ...materialLineRecipes(),
  // Gas Giant Study GG-1 (user 2026-10-08: "Deuterium Ice would fit this as well. Processed into a canister-stored
  // version"): the old ice stock refines into a Deuterium Canister. [PROPOSAL] 10:1 at 20 ticks (the uncommon refines'
  // length, one the speed rungs keep at an exact crafting XP per tick).
  refineDeuteriumCanister: {
    input: { deuteriumIce: new Decimal(10) },
    output: { itemId: "deuteriumCanister", amount: new Decimal(1) },
    durationTicks: 20,
  },
};

// ML-1 review (the user's "everything wired, nothing inert player-reachable" rule; the field kits precedent "Hide
// until kits are live"): THE ONE CHECK for whether the Refinery offers a recipe. canStartLine (the engine gate), the
// Refinery item dropdown and the Home dashboard's idle-refinery scan all read it, so a recipe whose output leads
// nowhere yet can neither be started nor suggested. A recipe is offered unless its output is a DEAD END: an item
// carrying the ItemDef.reserved marker, or one whose only consumers are Refinery recipes that are themselves not
// offered (Ferrite Ingot, whose one consumer makes the reserved Osmium Plate). Derived on every call from the static
// tables, so the gate lifts by itself the moment ML-2 / EM-8 drop a marker. Pure.
export function refineRecipeOffered(recipeKey: string): boolean {
  const recipe = REFINE_RECIPES[recipeKey];
  return recipe !== undefined && !isRefineDeadEnd(recipe.output.itemId, new Set());
}

function isRefineDeadEnd(itemId: string, visiting: Set<string>): boolean {
  if (ITEMS[itemId]?.reserved !== undefined) return true;
  if (consumedOutsideRefinery().has(itemId)) return false;
  if (visiting.has(itemId)) return true; // a cycle of refines with no outside consumer leads nowhere
  visiting.add(itemId);
  const refines = Object.values(REFINE_RECIPES).filter((r) => r.input[itemId] !== undefined);
  // No consumer at all is the sink rule's business (materialLines.test.ts), not a reason to hide the recipe.
  if (refines.length === 0) return false;
  return refines.every((r) => isRefineDeadEnd(r.output.itemId, visiting));
}

// Every item something other than the Refinery consumes: blueprints, hull builds, facility and storage / docks /
// berth rungs, material salvage, the Quartermaster's sell counter. Built on first use (those tables are declared
// further down this file), static afterwards.
let consumedOutsideRefineryCache: ReadonlySet<string> | null = null;
function consumedOutsideRefinery(): ReadonlySet<string> {
  if (consumedOutsideRefineryCache) return consumedOutsideRefineryCache;
  const out = new Set<string>();
  for (const bp of Object.values(BLUEPRINTS)) for (const id of Object.keys(bp.recipe.inputs)) out.add(id);
  for (const hull of Object.values(SHIP_TYPES)) for (const id of Object.keys(hull.buildRecipe.components)) out.add(id);
  for (const f of Object.values(FACILITIES)) for (const u of f.upgrades) for (const id of Object.keys(u.materials)) out.add(id);
  for (const rungs of [EQUIPMENT_STORAGE_RUNGS, SHIP_DOCKS_RUNGS, TRANSIT_BERTH_RUNGS]) for (const r of rungs) for (const id of Object.keys(r.materials)) out.add(id);
  for (const id of Object.keys(SALVAGE_LOOT_POOLS)) out.add(id);
  for (const [id, def] of Object.entries(ITEMS)) if (def.sellValue !== undefined) out.add(id);
  consumedOutsideRefineryCache = out;
  return out;
}

// TEST HOOK (ML-2): drop the cache so the next read rebuilds it. The tables are static in play; only a test that swaps
// blueprint recipes for its duration (ml2RecipeGoldens.fixture.ts withPreMl2Recipes) calls this, on entry and on restore.
export function resetRefineConsumerCacheForTest(): void {
  consumedOutsideRefineryCache = null;
}

// Item taxonomy (Ship Production Economy epic, 2026-07-11 facility-framework
// design §7). The category ladder is the forward-compat spine the whole epic
// climbs: raw loot -> refined -> minor/major components -> ship modules/systems.
// Only "raw" and "refined" are populated at Phase 1 launch; the later buckets
// exist in the union so the item table can grow WITHOUT a type change later.
//
// "salvagedMaterial" (0.11.0 Storage/Salvage, Task A3, design §3/§8): a broken-down
// item you SALVAGE FOR parts (a future roll), as opposed to something you install or
// refine directly. It is deliberately a CATEGORY (its own warehouse/taxonomy bucket),
// not a per-item flag, because "things salvage consumes" is a distinct kind of stock.
// Contrast with the exclusive salvage-PRODUCED exotics below (anomalousAlloy etc.):
// those are things salvage OUTPUTS, so they keep normal raw/refined/component
// categories, exclusivity there is a property of their source, not a category.
//
// "fieldKit" (Field Kits FKR-3, 0.14.0): a stackable consumable a squad member carries into a ground objective (the
// six medical and stim kits, fieldKits.ts FIELD_KITS; grenades and field devices stay installed tools, user FK1).
// Crafted at the Fabricator, stored by warehouse tier like any item, and quality-free (user call 16, "Ignore
// quality"): a kit works the same from any quality bucket.
//
// "gasCanister" and "researchData" (Gas Giant Study GG-1, 0.14.0; plan docs/plans/2026-10-17-gas-giant-study-plan.md
// section 3.1): the user's "Gas Storage Canisters" warehouse category (six canisters, each in its quality band,
// ItemDef.band) and the typed research data a ship's study returns (eight families plus the Ancient Data Fragment,
// studied in the Research Lab's lane, GG-5). The content tables live in gasGiantContent.ts.
export type ItemCategory =
  | "raw" | "refined" | "minorComponent" | "majorComponent" | "shipModule" | "shipSystem"
  | "salvagedMaterial" | "fieldKit" | "gasCanister" | "researchData";

// Gas Giant Study GG-1 (user 2026-10-09: "2 standard, 2 augmented, 1 stellar and 1 radiant"): the quality band a gas
// canister belongs to. A property of the ITEM (which gas it is), separate from the quality bucket every deposit rolls.
// The study's band draw files a canister by it (GG-3); static catalog data, never saved.
export type ItemBand = "standard" | "augmented" | "stellar" | "radiant";

// Rarity is forward room for the UI's rarity-color reveal (design §7). Every
// tier of the union is valid today; Phase 1's seeds only reach "rare".
export type ItemRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

// Warehouse sub-grouping for raw items (0.11.2 Phase 2). Raw materials all share
// one `category: "raw"`; this splits them into themed shelves so the Warehouse can
// render them grouped instead of one flat "raw" wall. Static catalog data, NOT part
// of saved GameState, so it is purely additive with no save migration.
export type RawSubCategory = "oresMetals" | "volatiles" | "organicCompounds" | "recoveredTech";

export interface ItemDef {
  label: string;        // display name (UI wraps it as [Bracketed Name] per convention)
  category: ItemCategory;
  tier: number;         // which warehouse TIER this item belongs to; all current items are T1 (§3.3)
  rarity: ItemRarity;
  // Player-facing "how to get this" clue shown in the Warehouse's ❓ (undiscovered)
  // slot state (Phase 2 design §3.2). DISTINCT from `flavor` (narrative color): the
  // hint is functional, a concrete, honest pointer to the item's real source
  // (a mission, a refine/fabricate recipe), never an invented one. Populated for
  // EVERY item; the model.test.ts standing-rule test enforces it is non-empty so a
  // future item added without a Warehouse hint fails the suite.
  unlockHint: string;
  flavor: string;
  // Warehouse sub-grouping for raw items (0.11.2). Present on EVERY `category: "raw"`
  // item (enforced by model.test.ts), absent on all non-raw items. Static catalog
  // data, not saved GameState, so it needs no migration.
  subCategory?: RawSubCategory;
  // ML-1 (0.14.0, Material Lines): the TYPED reserve marker. Present only on an item that is produced today but has
  // no consumer yet, and it names the slice that wires that consumer (for example "ML-2: ..."). The wiring registry
  // turns it into a pending entry (ITEMS:<id>:reserved, owner = this text), so the release gate holds until the
  // consumer lands, and the sink test (materialLines.test.ts) fails if a reserved item gains a consumer while still
  // marked, or if any item without one is unmarked. Static catalog data, never saved.
  reserved?: string;
  // Gas Giant Study GG-1: the quality band of a gas canister (ItemBand); absent on every other item.
  band?: ItemBand;
  // FORWARD (not populated this pass): only shipModule/shipSystem items ever
  // carry equip stats; every Phase 1 seed leaves this undefined.
  equipStats?: Record<string, number>;
  // SELLABLE (0.13.6): credits per unit at the Quartermaster's Sell counter. An item is
  // sellable IFF this is defined; canSell rejects everything else, so a locked / non-sellable
  // good can never be sold even as the catalogue grows. Only DEPRECATED stock carries it for now
  // (Deuterium Ice, orphaned by fuel-to-reach); widening it to live goods is a later, balance-
  // gated decision. The value is DERIVED from the item's prior worth (see deuteriumIce).
  sellValue?: number;
  // RETIRED STOCK (0.14.0): set only on an item the game no longer uses for anything but the Sell counter. The Sell
  // shelf tags exactly these rows "Retired" (quartermaster.ts isRetiredStock). No item carries it today: Deuterium Ice
  // and the canisters all have a crafting use. Static catalog data, never saved.
  retired?: true;
}

// Launch item registry, REAL entries only, same "no placeholders" discipline as
// MISSIONS/RECIPES above. Phase 1 seeds ONLY the items that exist today: the 5
// HomePlanetMaterialKey storage keys (the 3 mission-loot tiers + the 2 crafted
// goods RECIPES produces). Later phases of the Ship Production Economy epic add
// the minor/major-component, ship-module, and ship-system tiers HERE (and grow
// the storage/inventory keys alongside), do NOT seed those forward items until
// their phase. The model.test.ts drift guard asserts every live storage key has
// an entry here, so this table cannot silently fall out of sync with storage.
// ML-1: the owners named by ItemDef.reserved (each becomes a pending wiring registry entry with this text as owner). ML-2
// gave its six goods their blueprints and dropped their markers in the same commit.
const EM8_PRECURSOR_LENS = "EM-8 (the Precursor Lens special module is crafted with it)";
// Gas Giant Study GG-1: the owners of the research data reserves (the Research Lab's study lane, GG-5).
const GG5_DATA_STUDY = "GG-5 (the Research Lab study lane studies it into a +12% boost on the next project of its family)";
const GG5_ANCIENT_STUDY = "GG-5 (the Research Lab study lane decodes the next ancient entry from it)";
// Gas Giant Study GG-1 (values approved by the user 2026-10-21): credits per canister at the Quartermaster's Sell counter.
// Deuterium Ice at the Quartermaster's Sell counter, credits per unit. User 2026-10-21 (merge batch answers, "Comet
// economy bug": "Cut ice to ~4 credits (Recommended)"): a crafting input, not a money run. It was 40 (the retired Fuel
// Depot's 50 ice -> 100 fuel at 20 cr), which made the open-from-day-one Cometary Ice Harvest a 2,700-credit run.
export const DEUTERIUM_ICE_SELL_VALUE = 4;

// The Deuterium Canister anchors the scale (450 cr); the Standard band sells under it and each band up roughly doubles.
// It was set when ten Deuterium Ice sold for 400 cr; ice is now a cheap crafting input (DEUTERIUM_ICE_SELL_VALUE), so
// the refine adds most of the value.
export const GAS_CANISTER_SELL_VALUE = {
  hydrogenCanister: 200,
  methaneCanister: 200,
  ammoniaCanister: 450,
  deuteriumCanister: 450,
  helium3Canister: 1_000,
  antimatterCell: 2_500,
} as const;

export const ITEMS: Record<string, ItemDef> = {
  // --- Raw loot (mission extraction output; keyed as LootMaterialKey) ---
  commonOre: {
    // Fuel-sourcing RESTRUCTURE (2026-07-15): F1 had relabeled `commonOre` to
    // "Deuterium Ice" and pointed the Fuel Depot's refine at it (dual-demand: the
    // material Refinery ALSO consumes commonOre). That is REVERTED here, commonOre
    // is once again the Local Asteroid run's common structural ore, "Titanium Ore",
    // and the Fuel Depot now refines the NEW dedicated `deuteriumIce` item (below)
    // instead. The item id stays `commonOre`, so this revert is display-only with NO
    // save migration; its only consumer is now the material Refinery again.
    label: "Titanium Ore",
    category: "raw",
    subCategory: "oresMetals",
    tier: 1,
    rarity: "common",
    // The guaranteed common-tier fallback drop on every extraction tick (see
    // tick.ts's rollExtractionTick) of the Local Asteroid run.
    unlockHint: "Chipped from the Local Asteroid run, the fleet's staple structural ore.",
    flavor: "Common titanium-bearing rock, hauled from the local asteroid by the ton, the workhorse feedstock for the Refinery.",
  },
  uncommonMaterial: {
    // Provisional in-fiction name for the uncommon ore tier (id kept
    // `uncommonMaterial`, label is display-only, no save migration).
    label: "Polysilicate Ore",
    category: "raw",
    subCategory: "oresMetals",
    tier: 1,
    rarity: "uncommon",
    // Won on the per-tick uncommonChance roll; the Long Ore Run's uncommonChance
    // (0.08) is far higher than the Short Ore Run's (0.019).
    unlockHint: "An uncommon strike on the Local Asteroid run.",
    flavor: "A richer seam worth flagging on the survey map. Turns up often enough to plan around.",
  },
  rareMaterial: {
    // PROVISIONAL in-fiction name for the rare ore tier (id kept `rareMaterial`
    //, label is display-only, no save migration). "Iridium Ore" is a working
    // name, NOT final, flagged provisional at scaffold time.
    label: "Iridium Ore",
    category: "raw",
    subCategory: "oresMetals",
    tier: 1,
    rarity: "rare",
    // Won on the per-tick rareChance roll; the Long Ore Run's rareChance (0.02)
    // dwarfs the Short Ore Run's (0.001), so it's the run to farm for rares.
    unlockHint: "A rare strike on the Local Asteroid run.",
    flavor: "Scarce, dense, and prized, the payoff that makes the long ore runs worth the fuel.",
  },
  // --- Dedicated fuel ore (Fuel-sourcing RESTRUCTURE 2026-07-15) ---------------
  // (History below; since 0.14.0 it is the Cometary Ice Harvest's common drop and the Deuterium Canister's input.)
  // The fleet's FTL fuel SOURCE, now its OWN item (id `deuteriumIce`) rather than a
  // relabeled `commonOre`. This is the ONLY thing the Fuel Depot refines into fuel
  // (processFuelPipelines, tick.ts): mine it on the free `localFuelRun` mission ->
  // refine it into fuel at the Depot. Decoupling it from `commonOre` kills the old
  // dual-demand (commonOre now feeds ONLY the material Refinery again). Raw, tier 1,
  // common, it renders as a Warehouse Raw tile off the ITEMS registry like every
  // other raw. ADDITIVE: a brand-new key, so no save migration (empty inventory is
  // fine; it appears the moment the fuel run first delivers it).
  deuteriumIce: {
    label: "Deuterium Ice",
    category: "raw",
    subCategory: "volatiles",
    tier: 1,
    rarity: "common",
    // The common floor of the Cometary Ice Harvest (reactor fuel ladder, 0.14.0; the retired localFuelRun was its old
    // source). Gas Giant Study GG-1: it refines into a Deuterium Canister (REFINE_RECIPES.refineDeuteriumCanister), the
    // fuel every Reactor Core blueprint takes.
    unlockHint: "Harvested from a passing comet on the Cometary Ice Harvest run. Refine it into Deuterium Canisters for Reactor Core blueprints; raw ice fetches only a few credits at the Quartermaster.",
    // ML-1: the flavor no longer tells the player to cook it down at the Fuel Depot (that pipeline retired in 0.13.6).
    // Reactor fuel ladder (0.14.0): it comes off a comet now and ends up as reactor fuel, never FTL fuel.
    flavor: "Deuterium-laced water ice cut from a passing comet: common, bulky, and worth little until it is pressed into reactor fuel.",
    sellValue: DEUTERIUM_ICE_SELL_VALUE,
  },
  // --- Refined / crafted goods (Refinery / Fabricator output) ---
  // ITEM-MERGE (0.11.0 Task A1): the duplicate `refinedMaterial` ("Refined Material")
  // item was RETIRED here. It refined from the same Titanium Ore (`commonOre`) as
  // `titaniumIngot` (see the ITEMS.titaniumIngot entry below), so the two were folded
  // into one, `titaniumIngot` is now the sole refined-titanium item. Old saves' orphan
  // `refinedMaterial` inventory buckets are inert until a later save-migration task
  // converts them to `titaniumIngot`.
  // 0.11.0 cleanup (2026-07-20): the `components` ITEM ("Components") was removed here.
  // It was DEAD data left by the Phase 4 item-merge: NOTHING produced it (the legacy
  // instant RECIPES.fabricateComponents craft was retired in Phase 4, Task F5) and
  // NOTHING consumed it (the 12 equipment blueprints' vestigial `outputItem:
  // "components"` placeholder was already overridden by their EquipmentInstance mint).
  // --- Tier 2 raw ore (Phase 2, Task B2), UNOBTAINABLE STUB -----------------
  // The first Tier-2 material, added ONLY to gate the T2 Warehouse's first real
  // upgrade (FACILITIES.warehouseT2, rung 1) behind honest "future content": NOTHING
  // WR-4 (OC-C2): the Lunar Mine Contract's uncommon strike (MISSIONS.longOreRun), the producer the T2 warehouse
  // waited on; it is the only tier-2 item, and Warehouse T2's later rungs are priced in it.
  denseOre: {
    label: "Dense Ore",
    category: "raw",
    subCategory: "oresMetals",
    tier: 2,
    rarity: "uncommon",
    unlockHint: "An uncommon strike on the Lunar Mine Contract. A Tier 2 material: it is kept at the base cap until Warehouse (Tier II) is unlocked.",
    flavor: "Impossibly compacted rock from the deep lunar seams, heavy enough to need its own warehouse tier.",
  },
  // --- Catalog scaffold (Phase 2 Warehouse), UNOBTAINABLE PLACEHOLDERS -------
  // The full material catalog the Warehouse renders as ❓ slots. Every entry below
  // is produced by NOTHING this pass (no mission, refine, or fabricate recipe
  // references it), so each is genuinely unobtainable and shows masked with its
  // unlockHint as the how-to-get clue, the SAME honest "future content" pattern
  // as denseOre above. All tier 1. Each carries the FULL catalog metadata the
  // standing-rule test (model.test.ts) requires; unlockHints point at the FUTURE
  // missions/facilities that will produce them, not invented sources. When that
  // content lands, a real producer is wired in and (if needed) the hint updated.

  // RAW, future ore/salvage/forage mission loot (3 tiers per mission).
  ferriteOre: {
    // Fuel-sourcing RESTRUCTURE (2026-07-15): reverted F1's "Titanium" relabel back to
    // "Ferrite", the Lunar Mine Contract's common structural metal. (F1 had moved the
    // Titanium name here when it repurposed `commonOre` as Deuterium Ice; that whole
    // relabel chain is undone now that Deuterium Ice is its own dedicated item.) The item
    // id stays `ferriteOre`, so this is display-only with NO save migration. Genuinely
    // obtainable via the longOreRun triad (Task 1) despite the older scaffold header above.
    label: "Ferrite",
    category: "raw",
    subCategory: "oresMetals",
    tier: 1,
    rarity: "common",
    unlockHint: "Mined on the Lunar Mine Contract.",
    // Recipe realism text fix T5: an ore, not an alloy (lunar iron is real: ilmenite and native iron grains).
    flavor: "A tough, iron-rich ore drawn from the lunar seams, plentiful once the mining contract opens up.",
  },
  cobaltOre: {
    label: "Cobalt Ore",
    category: "raw",
    subCategory: "oresMetals",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "An uncommon find on the Survey Mineral Anomaly.",
    flavor: "A deep-blue seam prized by alloy smiths, an uncommon find in a mineral anomaly.",
  },
  osmiumOre: {
    label: "Osmium Ore",
    category: "raw",
    subCategory: "oresMetals",
    tier: 1,
    rarity: "rare",
    unlockHint: "A rare strike on the Lunar Mine Contract.",
    flavor: "The densest metal the fleet has ever logged, a rare payoff from the lunar seams.",
  },
  scrapAlloy: {
    label: "Scrap Alloy",
    category: "raw",
    subCategory: "recoveredTech",
    tier: 1,
    rarity: "common",
    unlockHint: "Recovered on the Salvage Nearby Skirmish Wreckage run.",
    flavor: "Twisted hull plating pulled from the wrecks, rough, but it melts down fine.",
  },
  salvagedCircuitry: {
    label: "Salvaged Circuitry",
    category: "raw",
    subCategory: "recoveredTech",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "An uncommon find on the Salvage Nearby Skirmish Wreckage run.",
    flavor: "Scorched boards with intact traces, worth pulling before the reclaimers arrive.",
  },
  // RECLASSIFY + RENAME (0.11.0 Storage/Salvage, Task A3, design §3/§8): this rare
  // Salvage-mission drop was "Intact Reactor Core", a raw item. It is re-cast as the
  // "Damaged Reactor Housing", a `salvagedMaterial`, the item you SALVAGE FOR parts
  // (a future roll wired in Task C2), NOT one you install. The id `intactReactorCore`
  // is KEPT UNCHANGED on purpose: the Salvage mission's lootTable references it by id
  // (rare slot, above) and existing inventory stacks are keyed by it, so this is a
  // display + category change only, with NO save migration. The unlockHint is honest:
  // it names the real drop source AND that salvaging-for-materials is a coming mechanic.
  intactReactorCore: {
    label: "Damaged Reactor Housing",
    category: "salvagedMaterial",
    tier: 1,
    rarity: "rare",
    // ML-1: the "(a coming mechanic)" tail was stale (material salvage is live; SALVAGE_LOOT_POOLS.intactReactorCore).
    unlockHint: "A rare drop from the Salvage Nearby Skirmish Wreckage run; salvage it for materials at the Salvage Bay.",
    flavor: "A cracked, burned-out reactor shell, dead weight to install, but a rich seam of parts to strip.",
  },
  // WEAPON-CRAFTING LOOT (Combat 1.0, Unit 1.7, design S12): the reserved "Damaged
  // [System]" wreck drop, wired now that weapon crafting exists (it would have been dead
  // inventory before). ONE GENERIC item on purpose, mirroring intactReactorCore's own
  // shape (which is itself a single generic "Damaged Reactor Housing", not one item per
  // reactor type): a won patrol wave has a modest, seeded CHANCE to drop this, and it
  // SALVAGES into weapon build materials via the existing salvageSalvagedMaterial path
  // (its SALVAGE_LOOT_POOLS entry below is themed to the weapon craft chain's feedstock).
  // Kept a single generic item (not per weapon/shield/plating) because all three would
  // break down into the SAME shared build-material economy, so three near-identical pools
  // would be redundant (Omega 4); shields/plating can add their own items if Phase 2/3
  // ever wants a distinct salvage yield. NO functional gear ever drops from a wreck
  // (design S12): this is a MATERIAL you strip for parts, never an installable weapon,
  // which is what protects the crafting loop (combat FEEDS crafting, never bypasses it).
  // rarity is "uncommon" (display only; the loot pool carries its own per-tier rarity): a
  // routine combat-wreck drop, more common than the rare Salvage-mission Reactor Housing.
  damagedWeaponSystem: {
    label: "Damaged Weapon System",
    category: "salvagedMaterial",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "A chance drop from won patrol waves; salvage it for weapon build materials.",
    flavor: "A weapon assembly torn from a wreck, too mangled to install, but its emitters and couplings strip out clean.",
  },
  fibrousBiomass: {
    label: "Fibrous Biomass",
    category: "raw",
    subCategory: "organicCompounds",
    tier: 1,
    rarity: "common",
    unlockHint: "Foraged on the Forage Minerals and Flora on Nearby Moon run.",
    flavor: "Tough, stringy plant matter scraped off the regolith, common but useful stock.",
  },
  volatileResin: {
    label: "Volatile Resin",
    category: "raw",
    subCategory: "organicCompounds",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "An uncommon forage on the Forage Minerals and Flora on Nearby Moon run.",
    flavor: "A sticky, faintly luminous sap, handle with care, it does not like heat.",
  },
  exoticSporeCluster: {
    label: "Exotic Spore Cluster",
    category: "raw",
    subCategory: "organicCompounds",
    tier: 1,
    rarity: "rare",
    unlockHint: "A rare forage on the Forage Minerals and Flora on Nearby Moon run.",
    flavor: "A pulsing knot of alien spores, rare, valuable, and best kept sealed.",
  },

  // REFINED, future Refinery outputs (raw ore/salvage/biomass cooked down).
  titaniumIngot: {
    label: "Titanium Ingot",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Titanium Ore at the Refinery.",
    flavor: "Titanium ore cooked down to a bright, workable bar, light and unyielding.",
  },
  polysilicateWafer: {
    label: "Polysilicate Wafer",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Polysilicate Ore at the Refinery.",
    flavor: "A thin, mirror-smooth wafer sliced from purified ore, the substrate of electronics.",
  },
  reclaimedAlloy: {
    label: "Reclaimed Alloy",
    category: "refined",
    tier: 1,
    // ML-1 (L11, user 2026-10-19 "Approve all three"): retagged uncommon; it refines from common Scrap Alloy.
    // Rarity is read by the Warehouse color, the reward chips AND the Salvage Bay's confirm prompt, which maps a
    // material's rarity to a quality tier (App.svelte salvageTargetNeedsConfirm, RARITY_TO_QUALITY_TIER: uncommon 1,
    // rare 2). Reclaimed Alloy is a refined good, and material salvage takes salvagedMaterial items only (salvage.ts),
    // so the prompt never reaches it today; if it ever does, it asks under the uncommon tier's setting.
    rarity: "uncommon",
    unlockHint: "Refined from Scrap Alloy at the Refinery.",
    flavor: "Battlefield scrap re-smelted into something stronger than it ever was whole.",
  },
  purifiedBiomass: {
    label: "Purified Biomass",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Fibrous Biomass at the Refinery.",
    // Recipe realism (Group B call 6): Purified Biomass stays the food and medical feedstock; fiber goes to Biofiber
    // and resin agents to Resin Distillate (text fix T4 in that form).
    flavor: "Raw flora rendered down to a clean, stable food and medical feedstock, no volatility left.",
  },
  // --- Material Lines (ML-1, 0.14.0): the seven July-approved refined goods (July section 12, re-confirmed by the
  // user 2026-10-19, L1 "Build as named"). Each is produced by its MATERIAL_LINE_RECIPE_NUMBERS row (above REFINE_RECIPES),
  // and the Refinery offers that recipe only once its output has a use (refineRecipeOffered).
  // ML-2 put them into the cargo, FTL, reactor, utility, shield and plating blueprints (L2; plan ML-2), so none is
  // reserved any more. Rarity is display only (E-MAT: ingots, circuit, compounds uncommon; plate, catalysts rare).
  ferriteIngot: {
    label: "Ferrite Ingot",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Ferrite at the Refinery.",
    flavor: "Lunar ferrite smelted into a dense, dark bar, the heavy twin of the titanium ingot.",
  },
  reclaimedCircuit: {
    label: "Reclaimed Circuit",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Salvaged Circuitry at the Refinery.",
    flavor: "Scorched wreck boards stripped, cleaned and re-traced into a circuit the fleet can trust.",
  },
  iridiumCatalyst: {
    label: "Iridium Catalyst",
    category: "refined",
    tier: 1,
    rarity: "rare",
    unlockHint: "Refined from Iridium Ore at the Refinery.",
    // Recipe realism text fix T2: both real uses, a catalyst and the heat-proof cladding that holds a reactor's fuel.
    flavor: "A few grams of iridium drawn into a fine mesh: a catalyst, and the heat-proof cladding that holds a high-output core's fuel.",
  },
  cobaltCoil: {
    label: "Cobalt Coil",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Compounded from Cobalt Ore and a Titanium Ingot at the Refinery.",
    // Recipe realism text fix T1 (titanium is not magnetic: the cobalt is the core).
    flavor: "A cobalt magnetic core in a titanium housing, the field coil drives and emitters run on.",
  },
  osmiumPlate: {
    label: "Osmium Plate",
    category: "refined",
    tier: 1,
    rarity: "rare",
    unlockHint: "Compounded from Osmium Ore and Ferrite Ingots at the Refinery.",
    flavor: "Osmium pressed into a ferrite backing, a plate so dense it seems to pull at the hand that lifts it.",
  },
  photonicGel: {
    label: "Photonic Gel",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Compounded from a Polysilicate Wafer and Volatile Resin at the Refinery.",
    flavor: "Luminous resin set into a wafer lattice, a gel that carries light the way wire carries current.",
  },
  biocatalyst: {
    label: "Biocatalyst",
    category: "refined",
    tier: 1,
    rarity: "rare",
    unlockHint: "Compounded from Purified Biomass and an Exotic Spore Cluster at the Refinery.",
    flavor: "A living culture grown from spores on a clean biomass bed, it quickens any process it touches.",
  },
  // Recipe realism audit (Group B call 6, user 2026-10-21 "Biofiber + Resin Distillate"; follow-up "Switch to them":
  // ratios "5:1 and 3:1", 20 ticks each, RECIPE_REALISM_REFINE_NUMBERS): two refined goods so fabrics and resin agents
  // have a real input. Biofiber: Ablative and Composite Plating, Ballistic Weave and the Field Suit. Resin Distillate: the
  // seals (Hazard Suit) and the Toxin Grenade (explosives later, 0.16.0). Rarity is display only.
  biofiber: {
    label: "Biofiber",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Fibrous Biomass at the Refinery. Woven into ablative plating and away-team armor.",
    flavor: "Plant fiber spun and carbonized into a tough, light weave, the same trick that made the first carbon fiber.",
  },
  resinDistillate: {
    label: "Resin Distillate",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Distilled from Volatile Resin at the Refinery. Used for seals and grenade agents.",
    flavor: "Volatile sap boiled down to a clear, stable distillate: it seals a suit, or fills a canister you throw.",
  },

  // COMPONENTS, future Fabricator outputs (refined stock assembled into parts).
  frameSegment: {
    label: "Frame Segment",
    category: "minorComponent",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Fabricated from refined materials at the Fabricator.",
    // Recipe realism text fix T3: tools and drones use it too.
    flavor: "A standard strut, cut to size for anything from a hull to a tool chassis.",
  },
  powerCoupling: {
    label: "Power Coupling",
    category: "minorComponent",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Fabricated from refined materials at the Fabricator.",
    // Recipe realism (audit call 8): silicon power electronics in a titanium housing.
    flavor: "Silicon power electronics in a titanium housing, the shielded junction that ties a reactor line into the systems it feeds.",
  },
  structuralAssembly: {
    label: "Structural Assembly",
    category: "majorComponent",
    tier: 1,
    rarity: "rare",
    unlockHint: "Assembled from components at the Fabricator.",
    flavor: "Frame segments and couplings married into one rigid sub-structure, a hull's spine.",
  },

  // --- EXCLUSIVE salvage-PRODUCED exotics (0.11.0 Storage/Salvage, Task A3, design
  // §3/§8), CATALOGUED + RESERVED, no producer or consumer yet ------------------
  // "A wreck with tech you have never seen before": rare tech that ONLY the salvage
  // loot pool will ever yield (Task C2 wires that pool; nothing produces these until
  // then). Exclusivity is a PROPERTY OF THEIR SOURCE, not a category, so each keeps a
  // NORMAL category matching its nature (a raw-ish exotic, a refined-ish exotic, a
  // component-ish exotic), the mix deliberately spans types. They are DISTINCT from
  // the `salvagedMaterial` Housing above: the Housing is a thing you salvage FROM;
  // these are things salvage PRODUCES. Nothing consumes them this patch either, their
  // recipes (combat / Material Lines / future gear) do not exist yet, so each carries
  // an HONEST "reserved for a future recipe" unlockHint in the SAME no-invented-source
  // spirit as denseOre. Because NOTHING produces them, they are NOT seeded into
  // freshState/inventory/storage, they render as undiscovered ❓ catalog entries
  // exactly like denseOre and the other unobtainable placeholders, and the storage
  // drift guard (which only requires the reverse: every live inventory key has an ITEMS
  // entry) is unaffected.
  anomalousAlloy: {
    label: "Anomalous Alloy",
    category: "raw",
    // Reserved salvage-PRODUCED exotic (not mined), grouped under recoveredTech by
    // salvage source, the same origin as Scrap Alloy / Salvaged Circuitry (0.11.2).
    subCategory: "recoveredTech",
    tier: 1,
    rarity: "epic",
    // E4d: no longer reserved. Its first recipe is the discovery-gated Damage Control Suite (BLUEPRINTS
    // damageControlSuiteBp); expedition ground battles also drop it (gambit.ts), alongside salvage.
    unlockHint: "Recovered from salvage and expedition finds; used to craft the Damage Control Suite.",
    flavor: "A slab of metal that shrugs off every assay, its lattice folded in ways the fleet's foundries can't read.",
  },
  precursorCircuit: {
    label: "Precursor Circuit",
    category: "refined",
    tier: 1,
    rarity: "epic",
    unlockHint: "Recovered only from salvage; reserved for a future recipe not yet built.",
    flavor: "An impossibly fine circuit lattice from a hull far older than the fleet, still faintly warm to the touch.",
    reserved: EM8_PRECURSOR_LENS,
  },
  intactDataCore: {
    label: "Intact Data Core",
    category: "minorComponent",
    tier: 1,
    rarity: "legendary",
    // ML-1: no longer reserved; the Neural Backup implant (neuralBackupBp, E-CREW Task 7) consumes one.
    unlockHint: "Recovered only from salvage; used to craft the Neural Backup implant.",
    // ⚠️ EASTER EGG, keep as-is: the closing quote is the game's FIRST MEME (user, 2026-10-01), a
    // nod to the 2026-09-29 player report that this salvage-only exotic had "no slot" and no use
    // (which led to the 0.13.8 discovery hotfix). Deliberately UNANNOUNCED: never list it in patch
    // notes or the Discord post, and do not "clean up" the line during flavor/copy passes.
    flavor: "A sealed memory core pulled whole from a dead ship, its archives locked behind a cipher no one alive can key. \"What is this thing even for?\"",
  },

  // FIELD KITS (Field Kits FKR-3, 0.14.0): the six consumable kits a squad member carries, keyed by their
  // fieldKits.ts kit id (FIELD_KIT_IDS), labeled as FIELD_KITS names them. Crafted from their BLUEPRINTS
  // (firstAidKitBp ..), so each hint says exactly that. Warehouse tier 1 for both research tiers (a tier 2 kit
  // still stores on the base shelf). Rarity is display only (common for the tier 1 kits, uncommon for tier 2).
  // NOT sellable: the Quartermaster SELLS kits (FKR-7, fieldKits.ts FIELD_KIT_PRICES) and never buys them back.
  // Nothing spends a kit yet: FKR-6 uses them in battle, FKR-7 packs them per member.
  firstAidKit: {
    label: "First Aid Kit",
    category: "fieldKit",
    tier: 1,
    rarity: "common",
    unlockHint: "Crafted at the Fabricator after research.",
    flavor: "Dressings, a sealant spray and a quick diagnostic strip. Clears the common battlefield ailments and closes a few wounds.",
  },
  antitoxin: {
    label: "Antitoxin",
    category: "fieldKit",
    tier: 1,
    rarity: "common",
    unlockHint: "Crafted at the Fabricator after research.",
    flavor: "A single-dose injector that flushes poison from the blood.",
  },
  splint: {
    label: "Splint",
    category: "fieldKit",
    tier: 1,
    rarity: "common",
    unlockHint: "Crafted at the Fabricator after research.",
    flavor: "A titanium brace with fiber wraps. Sets a fracture so it heals, and eases a broken bone. Needs a trained hand.",
  },
  combatStim: {
    label: "Combat Stim",
    category: "fieldKit",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Crafted at the Fabricator after research.",
    flavor: "An auto-injector that leaves its user inspired for a couple of rounds.",
  },
  traumaKit: {
    label: "Trauma Kit",
    category: "fieldKit",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Crafted at the Fabricator after research.",
    flavor: "For the serious cases: hemorrhage, neurotoxin, concussion and broken bones. Needs a trained hand.",
  },
  injuryKit: {
    label: "Injury Kit",
    category: "fieldKit",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Crafted at the Fabricator after research.",
    flavor: "A stabilizer cuff for a downed squadmate that shortens their stay in the medical bay. Needs a trained hand.",
  },

  // Gas Storage Canisters (Gas Giant Study GG-1, 0.14.0; user 2026-10-19 call 5 "Proposed mapping").
  // The six canisters by band: Standard Hydrogen and Methane, Augmented Ammonia and Deuterium, Stellar Helium-3,
  // Radiant the Antimatter Containment Cell ("Not a gas, but it will require its own specialized container"). Every
  // one sells at the Quartermaster (call 7: "also sellable"); their recipe uses are GG-7's (the G2 drive classes and
  // the Lab tier 3 to 7 blueprints). Until GG-3 wires the study reward, only the Deuterium Canister has a source (the
  // Refinery, from Deuterium Ice); the other five stay off the shelves (gasGiantContent.ts GAS_STUDY_SOURCE_PENDING).
  hydrogenCanister: {
    label: "Hydrogen Canister",
    category: "gasCanister",
    band: "standard",
    tier: 1,
    rarity: "common",
    unlockHint: "Collected when a ship studies a gas giant or sweeps a nebula on an expedition.",
    flavor: "The bulk of every giant, pumped down to a few hundred atmospheres. The cheapest thing in the canister rack.",
    sellValue: GAS_CANISTER_SELL_VALUE.hydrogenCanister,
  },
  methaneCanister: {
    label: "Methane Canister",
    category: "gasCanister",
    band: "standard",
    tier: 1,
    rarity: "common",
    unlockHint: "Collected when a ship studies a gas giant or sweeps a nebula on an expedition.",
    flavor: "The gas that paints Uranus and Neptune blue, skimmed from the upper haze.",
    sellValue: GAS_CANISTER_SELL_VALUE.methaneCanister,
  },
  ammoniaCanister: {
    label: "Ammonia Canister",
    category: "gasCanister",
    band: "augmented",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Collected when a ship studies a gas giant or sweeps a nebula on an expedition.",
    flavor: "Drawn from the top cloud deck, where ammonia ice hangs in pale bands.",
    sellValue: GAS_CANISTER_SELL_VALUE.ammoniaCanister,
  },
  deuteriumCanister: {
    label: "Deuterium Canister",
    category: "gasCanister",
    band: "augmented",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined at the Refinery from Deuterium Ice.",
    flavor: "Heavy hydrogen pressed out of comet ice and sealed under pressure: the fuel charge every fusion Reactor Core is built around.",
    sellValue: GAS_CANISTER_SELL_VALUE.deuteriumCanister,
  },
  helium3Canister: {
    label: "Helium-3 Canister",
    category: "gasCanister",
    band: "stellar",
    tier: 1,
    rarity: "rare",
    unlockHint: "Collected when a ship studies a gas giant or sweeps a nebula on an expedition.",
    flavor: "A trace isotope sifted from tons of helium, the classic dream fuel of fusion engineers.",
    sellValue: GAS_CANISTER_SELL_VALUE.helium3Canister,
  },
  antimatterCell: {
    label: "Antimatter Containment Cell",
    category: "gasCanister",
    band: "radiant",
    tier: 1,
    rarity: "epic",
    unlockHint: "Collected when a ship studies a gas giant on an expedition (trapped in its magnetic field).",
    flavor: "A few nanograms of antiprotons held off the walls by a magnetic bottle. Not a gas, so it needs its own container.",
    sellValue: GAS_CANISTER_SELL_VALUE.antimatterCell,
  },

  // Research Data (Gas Giant Study GG-1; user 2026-10-19 call 9 "Your six + 2, +12%").
  // One item per research family: the user's six (Propulsion, Defense, Weapons, Systems, Field, Hull Design) plus
  // Materials and Sensors. The Research Lab's study lane (GG-5, call 8 "Auto when idle") studies each held item into
  // a +12% boost on the next project of its family (D23 stacking) and rarely a recipe (5%). Until GG-5 lands nothing
  // studies them (the `reserved` marker) and until GG-3 nothing returns them, so they stay out of every list.
  propulsionData: {
    label: "Propulsion Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "Pressure, flow and burn readings from the deep atmosphere, the raw stuff of better drives.",
    reserved: GG5_DATA_STUDY,
  },
  defenseData: {
    label: "Defense Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "How the probe hull held up under the crush, logged strain by strain.",
    reserved: GG5_DATA_STUDY,
  },
  weaponsData: {
    label: "Weapons Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "Lightning, plasma and charged winds measured at close range. Somebody will find a use for it.",
    reserved: GG5_DATA_STUDY,
  },
  systemsData: {
    label: "Systems Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "Telemetry from every subsystem that kept the probe talking on its way down.",
    reserved: GG5_DATA_STUDY,
  },
  fieldData: {
    label: "Field Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "Corrosion, heat and gravity loads, the conditions away-team gear has to survive.",
    reserved: GG5_DATA_STUDY,
  },
  hullDesignData: {
    label: "Hull Design Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "Shear and buffeting profiles at every altitude, the numbers a hull architect loses sleep over.",
    reserved: GG5_DATA_STUDY,
  },
  materialsData: {
    label: "Materials Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "Spectra of metallic hydrogen, silicate rain and stranger things that only form under that much pressure.",
    reserved: GG5_DATA_STUDY,
  },
  sensorsData: {
    label: "Sensors Data",
    category: "researchData",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Returned by a ship's study of a gas giant or a nebula on an expedition.",
    flavor: "Calibration sweeps taken through storms that blind ordinary instruments.",
    reserved: GG5_DATA_STUDY,
  },
  // The ancient data (user 2026-10-19 call 10 "One lane"): a data type whose study decodes the next ancient entry
  // (GG-5); some entries unlock special blueprints. No culture name in 0.14.0 text: names come with G3 Relics v2.
  ancientDataFragment: {
    label: "Ancient Data Fragment",
    category: "researchData",
    tier: 1,
    rarity: "rare",
    unlockHint: "Sometimes recovered by a deep probe dive during a ship's study of a gas giant.",
    flavor: "A shard of a record far older than the fleet, pulled from something that sank into the clouds long ago.",
    reserved: GG5_ANCIENT_STUDY,
  },
};

// ============================================================================
// Salvaged-material LOOT POOLS (0.11.0 Storage/Salvage, Task C3, design
// 2026-07-18-storage-salvage-0.11.0-design.md §3 + the salvaging-design-notes).
//
// WHAT THIS IS: the TIERED, weighted loot table that salvaging a SALVAGED MATERIAL
// rolls against (the roll itself is salvageSalvagedMaterial in salvage.ts, Task C2).
// It is DATA ONLY here, structured as a per-salvaged-material record so future
// salvaged materials slot in without touching the roll code.
//
// TIER NAMES map onto the gear rarity ladder (EquipmentRarity: standard, augmented,
// stellar, radiant), with luminous/constellar deliberately RESERVED above and NOT
// populated this patch (room for a taller ladder later, no type change needed). The
// array is ORDERED low -> high; a tier's INDEX is what the progression-gated ceiling
// (salvage.ts) caps against, so index order is load-bearing, keep it ascending.
//
// BALANCE (hard rules, design §3 "the reliable common outcome is modest; steep odds
// on top tiers; super-rare odds on plain refined/components; exclusive exotics weight
// the high tiers"; the user's load-bearing constraint that salvage SUPPLEMENTS, never
// replaces, missions/refining/fabricating):
//   - Tier-selection WEIGHT falls off STEEPLY up the ladder (1000 -> 300 -> 40 -> 5),
//     so even a fully-unlocked ceiling still yields the low tier the vast majority of
//     the time. The common outcome stays modest.
//   - The EXCLUSIVE salvage-only exotics (anomalousAlloy / precursorCircuit /
//     intactDataCore, the A3 reserved items) live ONLY in the high tiers (stellar,
//     radiant) and DOMINATE those tiers' within-tier weight, they are the payoff for
//     reaching the ceiling.
//   - Plain REFINED materials + fabricated COMPONENTS (titaniumIngot, frameSegment,
//     powerCoupling) may appear as a within-tier drop but at SUPER-RARE weights (2-3
//     against a tier staple of ~1000), so salvage never becomes a sensible way to
//     source them. This is the guardrail, not a suggestion.
// Every number is a FIRST-PASS tunable, same spirit as MISSIONS/RECIPES constants.
// ============================================================================

// The set of salvaged-material item ids that HAVE a loot pool. A string-literal union
// so the pool record is exhaustive and a salvaged material added without a pool is a
// compile error, not a silent gap. Two members now: the Damaged Reactor Housing (rare
// Salvage-mission drop) and the Damaged Weapon System (Combat 1.0 Unit 1.7 patrol-wreck
// drop). Each MUST carry a SALVAGE_LOOT_POOLS entry below (the Record over this union
// enforces it) so salvageSalvagedMaterial can strip it for parts.
export type SalvagedMaterialItemId = "intactReactorCore" | "damagedWeaponSystem";

// One weighted DROP within a tier: which item, and its relative weight against the
// other drops in the SAME tier. The staple (common outcome) carries a large weight;
// super-rare refined/components carry tiny weights (see BALANCE above).
export interface SalvageLootDrop {
  itemId: string;
  weight: number;
}

// One TIER of a salvaged-material loot pool. `tier` is the gear-rarity NAME (display +
// forward mapping to the rarity ladder); `weight` is this tier's selection weight among
// the ceiling-eligible tiers; `quality` (0..5) is the quality bucket the rolled drop is
// deposited at (higher tier -> higher quality, reusing the existing 0-5 quality system);
// `drops` is the within-tier weighted item pool.
export interface SalvageLootTier {
  tier: EquipmentRarity;
  weight: number;
  quality: number;
  drops: SalvageLootDrop[];
}

// The per-salvaged-material loot pools. ORDERED low -> high; the ceiling gate indexes
// into this array. Reserved room above radiant (luminous/constellar) is intentionally
// left unpopulated this patch (see header).
export const SALVAGE_LOOT_POOLS: Record<SalvagedMaterialItemId, SalvageLootTier[]> = {
  // The Damaged Reactor Housing (rare Salvage-mission drop, reclassified in A3). Its
  // whole purpose is to be salvaged for parts.
  intactReactorCore: [
    // STANDARD (index 0, quality 0): the dominant, reliable, modest outcome. A fresh
    // player only ever reaches this tier. Staple = scrapAlloy (a common raw the player
    // can already farm), with a SUPER-RARE sprinkle of refined titanium.
    {
      tier: "standard",
      weight: 1000,
      quality: 0,
      drops: [
        { itemId: "scrapAlloy", weight: 1000 }, // modest, reliable common staple
        { itemId: "titaniumIngot", weight: 2 }, // super-rare refined (guardrail weight)
      ],
    },
    // AUGMENTED (index 1, quality 1): uncommon staple = salvagedCircuitry, plus
    // super-rare fabricated components.
    {
      tier: "augmented",
      weight: 300,
      quality: 1,
      drops: [
        { itemId: "salvagedCircuitry", weight: 1000 }, // uncommon staple
        { itemId: "frameSegment", weight: 2 },         // super-rare component
        { itemId: "powerCoupling", weight: 2 },        // super-rare component
      ],
    },
    // STELLAR (index 2, quality 3): the first EXCLUSIVE-exotic tier. anomalousAlloy
    // (salvage-only) dominates; refined/components remain super-rare.
    {
      tier: "stellar",
      weight: 40,
      quality: 3,
      drops: [
        { itemId: "anomalousAlloy", weight: 1000 }, // exclusive exotic, tier payoff
        { itemId: "titaniumIngot", weight: 3 },     // super-rare refined
        { itemId: "frameSegment", weight: 3 },      // super-rare component
      ],
    },
    // RADIANT (index 3, quality 4): the top of this patch's ladder, steep odds. The
    // rarest exclusive exotics dominate; one super-rare component keeps the guardrail
    // consistent across tiers.
    {
      tier: "radiant",
      weight: 5,
      quality: 4,
      drops: [
        { itemId: "precursorCircuit", weight: 600 }, // exclusive exotic (epic)
        { itemId: "intactDataCore", weight: 400 },   // exclusive exotic (legendary)
        { itemId: "powerCoupling", weight: 2 },      // super-rare component
      ],
    },
    // RESERVED above radiant: luminous / constellar tiers are intentionally NOT
    // populated this patch (the EquipmentRarity ladder already carries the names).
  ],
  // The Damaged Weapon System (Combat 1.0 Unit 1.7 patrol-wreck drop). SAME tiered
  // structure + guardrail philosophy as the Reactor Housing above, but themed to the
  // WEAPON CRAFT CHAIN's feedstock (polysilicateWafer / powerCoupling / frameSegment /
  // structuralAssembly, the refined + component inputs the weapon BLUEPRINTS consume),
  // so stripping a wreck's weapon feeds building a real one. High tiers share the same
  // exclusive salvage exotics as the Reactor Housing (they are generic salvage payoffs,
  // not reactor-specific). Every weight/quality is FIRST-PASS TUNABLE, same spirit as
  // the Reactor Housing pool.
  damagedWeaponSystem: [
    // STANDARD (index 0, quality 0): the reliable, modest outcome a fresh player always
    // reaches. Staple = polysilicateWafer (the core refined weapon feedstock), with a
    // super-rare sprinkle of a fabricated powerCoupling (guardrail weight).
    {
      tier: "standard",
      weight: 1000,
      quality: 0,
      drops: [
        { itemId: "polysilicateWafer", weight: 1000 }, // refined weapon feedstock staple
        { itemId: "powerCoupling", weight: 2 },        // super-rare component (guardrail weight)
      ],
    },
    // AUGMENTED (index 1, quality 1): staple = powerCoupling (the other common weapon
    // input), plus super-rare higher components.
    {
      tier: "augmented",
      weight: 300,
      quality: 1,
      drops: [
        { itemId: "powerCoupling", weight: 1000 },     // common weapon component staple
        { itemId: "frameSegment", weight: 2 },         // super-rare component
        { itemId: "structuralAssembly", weight: 2 },   // super-rare component
      ],
    },
    // STELLAR (index 2, quality 3): the first EXCLUSIVE-exotic tier. anomalousAlloy
    // (salvage-only) dominates; refined/components remain super-rare.
    {
      tier: "stellar",
      weight: 40,
      quality: 3,
      drops: [
        { itemId: "anomalousAlloy", weight: 1000 },    // exclusive exotic, tier payoff
        { itemId: "polysilicateWafer", weight: 3 },    // super-rare refined
        { itemId: "frameSegment", weight: 3 },         // super-rare component
      ],
    },
    // RADIANT (index 3, quality 4): the top of this patch's ladder, steep odds. The
    // rarest exclusive exotics dominate; one super-rare component keeps the guardrail
    // consistent across tiers.
    {
      tier: "radiant",
      weight: 5,
      quality: 4,
      drops: [
        { itemId: "precursorCircuit", weight: 600 },   // exclusive exotic (epic)
        { itemId: "intactDataCore", weight: 400 },     // exclusive exotic (legendary)
        { itemId: "powerCoupling", weight: 2 },        // super-rare component
      ],
    },
    // RESERVED above radiant: luminous / constellar tiers intentionally unpopulated,
    // same as the Reactor Housing pool.
  ],
};

// --- Research: blueprints (Phase 3, Task R1, docs/plans/2026-07-15-research-
// {design,plan}.md §2/§5) --------------------------------------------------------
// A BLUEPRINT is a RECIPE the (next-feature) Fabricator will craft into a ship
// component. Research is the GATE on WHICH recipes exist; the Fabricator is the forge
// that runs them. The two features deliberately SHARE this one definition, the
// blueprint carries the Fabricator recipe RIGHT HERE (`recipe`) so Research and the
// Fabricator never drift over what a researched blueprint actually builds.
//
// SCOPE NOTE (R1 is DATA ONLY): this task ships the BlueprintDef shape, the BLUEPRINTS
// content, the GameState.researchedBlueprints field, and the two pure read helpers
// below. The Research FACILITY that gates tiers/slots is R2; the timed research-project
// ENGINE that actually unlocks a blueprint (startResearch + the resolver) is R3; the UI
// is R5. NOTHING crafts a researched blueprint yet, that arrives with the Fabricator.
//
// ⚠️ FIRST-PASS TUNABLE VALUES ⚠️ Every number below (tier, researchDurationTicks,
// researchCreditCost, and the recipe input/output amounts) is a launch placeholder in
// the SAME spirit as MISSIONS'/SHIP_TYPES'/REFINE_RECIPES' constants, the exact recipes
// get finalized WITH the Fabricator (it consumes them), and real balancing happens at the
// device-check stage. They are defined now purely to keep Research + Fabricator one
// coherent, testable data set.
export interface BlueprintDef {
  key: string;   // mirrors the BLUEPRINTS map key (asserted in research.test.ts, no drift)
  label: string; // in-world display name, e.g. "Frame Segment Blueprint"
  tier: number;  // gated by the Research facility LEVEL (R2): researchable once level >= tier
  researchDurationTicks: number; // time to research (R3 runs it as a timed process)
  researchCreditCost: number;    // credits, deduct-at-start (R3); the long-term credit sink
  // Fabricator (Phase 4, F1, design §3): time to CRAFT this blueprint's component
  // once researched (the Fabricator runs it as a timed process, `durationTicks =
  // craftDurationTicks`, EXACTLY as R3 runs research off researchDurationTicks). The
  // Fabricator's cost is materials (recipe.inputs) + this TIME, NO credits (locked
  // brainstorm decision #3: credits stay Research's sink, materials are the
  // Fabricator's). ⚠️ FIRST-PASS TUNABLE (same launch-placeholder spirit as
  // researchDurationTicks): tier-1 components ~120 ticks, tier-2 ~300, real balance
  // at the device checkpoint. Must be a positive finite number.
  craftDurationTicks: number;
  // The recipe the FABRICATOR will use (defined now, crafted later). `inputs` +
  // `outputItem` are plain-string ITEMS keys (forward-loose like inventory/ProcessEffect),
  // so a recipe can target any registry item. Amounts are plain numbers (recipe QUANTITIES,
  // not idle-scale currency), the Fabricator wraps them in Decimal at its deduct site,
  // exactly as the fuel constants are plain numbers wrapped at their deduct site.
  recipe: { inputs: Record<string, number>; outputItem?: string; outputQty?: number };
  // --- Equipment-output extension (0.11.0 Task 18) ---------------------------
  // A blueprint produces ONE of two output SHAPES, and a BlueprintDef falls into
  // exactly one of these two families:
  //   (1) MATERIAL blueprint (the original R1 shape): `equipmentOutput` is ABSENT.
  //       The Fabricator crafts a STACKABLE item, `recipe.outputItem` x `outputQty`
  //       (frameSegment, powerCoupling, structuralAssembly). Behavior unchanged.
  //   (2) EQUIPMENT blueprint (this task): `equipmentOutput` is PRESENT. The
  //       Fabricator (a LATER task, Task 19) mints a non-stacking EquipmentInstance
  //       of `{ slotType, varietyKey }` instead of a stackable, rolling its stats at
  //       craft completion. It consumes `recipe.inputs` exactly like a material
  //       blueprint (that field is meaningful for BOTH shapes), but it produces NO
  //       stackable item, so it OMITS `recipe.outputItem`/`outputQty` entirely.
  //
  // WHY `outputItem`/`outputQty` are OPTIONAL (0.11.0 cleanup, 2026-07-20): they are
  // meaningful ONLY for MATERIAL blueprints. Equipment blueprints used to carry a
  // vestigial `outputItem: "components"` placeholder purely to satisfy a REQUIRED
  // field; that placeholder pointed at the now-removed `components` ITEM (dead data
  // from the Phase 4 item-merge) and was already IGNORED by the mint (which branches
  // on `equipmentOutput` and hands off `addEquipment`). Making the two fields optional
  // and dropping them from every equipment blueprint removes the dead reference. The
  // three tick.ts read sites (lineJobSpec's `outputItemId`, canFabricate's/
  // startFabricateJob's `materialAtCap` cap-gate) now guard for the absent field: an
  // equipment blueprint never reaches the stackable-output path (all three already
  // branch on `equipmentOutput`/`isEquipment` first), so the fallback value is inert.
  equipmentOutput?: { slotType: EquipmentSlotType; varietyKey: string };
  // --- Weapon-output extension (Combat 1.0, Unit 1.2b: the weapon craft chain) ----
  // A THIRD output SHAPE alongside `equipmentOutput`, and the second one that mints a
  // non-stacking EquipmentInstance rather than a stackable item. When `weaponOutput` is
  // PRESENT the Fabricator mints a CRAFTED WEAPON via generateWeapon(...) (itemgen.ts), the
  // weapon-slot parallel to how an equipment blueprint mints via generateEquipment: the
  // weapon's identity (family / triangle / effect slots / range / cooldown) is FIXED by its
  // base WEAPON_DEF, and only its power lines (weaponYield / weaponAccuracy / durability) roll
  // off the same budget engine. Like an equipment blueprint it consumes `recipe.inputs` and
  // produces NO stackable item, so it OMITS `recipe.outputItem`/`outputQty` entirely. `weaponType`
  // names the WEAPON_DEFS entry to mint (a WeaponId, so a typo is a compile error, not a runtime
  // miss). blueprintKind() classifies this shape as "weapon" (see below), so every Fabricator gate
  // routes it down the mint-an-instance path, never the stackable-output path.
  weaponOutput?: { weaponType: WeaponId };
  // --- Drone-output extension (Combat 1.0, Unit 2.1b: the drone-pod craft chain) ------
  // A FIFTH output SHAPE, the DRONE-POD analogue of `weaponOutput`, and the third one that mints a
  // non-stacking EquipmentInstance rather than a stackable item. When `droneOutput` is PRESENT the
  // Fabricator mints a CRAFTED DRONE POD via generateDronePod(...) (itemgen.ts), exactly as a weapon
  // blueprint mints via generateWeapon and an equipment blueprint via generateEquipment: the pod's
  // identity (the squadron ROLE it deploys, and that role's fixed per-drone base behavior, hp /
  // family / accuracy / yield / range / evasion / cooldown) is FIXED by the drone ROLE_TEMPLATE, and
  // only its power lines (droneHp / droneAccuracy / durability) roll off the same budget engine. Like
  // a weapon/equipment blueprint it consumes `recipe.inputs` and produces NO stackable item, so it
  // OMITS `recipe.outputItem`/`outputQty` entirely. `role` names the drone ROLE_TEMPLATE entry to
  // mint (a DroneRole, so a typo is a compile error, not a runtime miss). blueprintKind() classifies
  // this shape as "drone" (see below), so every Fabricator gate routes it down the mint-an-instance
  // path (via blueprintMintsEquipmentInstance), never the stackable-output path. Pods are NOT read in
  // combat yet (no hangar-bay install, no bridge fold); this unit only makes them research ->
  // fabricate craftable and visible in the UI, mirroring how weapons landed in Unit 1.2b.
  droneOutput?: { role: DroneRole };
  // E-MOD EM-1 (user P5 2026-10-19 "x1.6 per class"): an FTL drive blueprint's drive class, 1 (Class I) to 7. G2-4
  // authors the Class II to VII drive blueprints (DRIVE_CLASS_BLUEPRINTS) and their gates (propulsion.ts); absent reads
  // Class I.
  // The power fold (equipmentStatMods) multiplies an installed drive's draw by DRIVE_CLASS_POWER_DRAW_MULT per class
  // above I the moment a blueprint sets this (ftlDriveClass), so G2-4 must NOT bake the class into powerDraw at mint.
  driveClass?: number;
  // --- Unlock-only shape (Combat 0.13.0, Phase 9b: warship research gate) ---------
  // A THIRD blueprint family, on top of the two output families above. An UNLOCK-ONLY
  // blueprint outputs NOTHING craftable: it has no `recipe.outputItem` (no stackable) AND
  // no `equipmentOutput` (no minted system), and its `recipe.inputs` is EMPTY (there is
  // nothing to fabricate). Its "product" is BUILD CONTENT: researching it flips a hull's
  // ShipTypeDef.requiresBlueprint gate open (e.g. the battleship / carrier hulls), so the
  // payoff is delivered by the Research Lab + the Shipyard, never by the Fabricator.
  //
  // WHY a dedicated flag (matching the codebase's explicit-discriminant idiom): the two
  // existing families discriminate on `equipmentOutput` presence, but an unlock-only
  // blueprint has NEITHER output shape, so "material vs equipment" cannot classify it.
  // A self-documenting `unlockOnly: true` marker is the honest discriminant: Research OFFERS
  // it (canResearch / the R5 list gate on tier like any blueprint), the Fabricator SKIPS it
  // (canFabricate rejects it with `unlockOnly`, and the F4 craftable-list enumerations filter
  // it out) since it produces nothing to craft. Absent/undefined = a normal craftable blueprint.
  unlockOnly?: true;
  // --- DISCOVERY-GATED research (Exploration 0.14.0, Phase E4d) ------------------------------------
  // A relic id (relics.ts RELICS[].id). When PRESENT, the blueprint cannot be researched until that relic
  // has been IDENTIFIED at least once (state.relicDiscovered contains it, the FIRST FIND that a relic
  // study's completion records). canResearch refuses it with the `undiscovered` reason, and the Research
  // catalog shows the card MASKED (it names the relic's SET, never the relic) until then. ABSENT on every
  // pre-E4d blueprint, so their research gate is byte-identical. Adding a gated project later (the
  // deferred Precursor Lens module, Heart of the Archive's Neural Backup) is a pure DATA change: author the
  // blueprint with this field and the gate, the mask and the reveal's "Research unlocked" line all follow.
  // Typed as a plain string (not a relic-id union) because model.ts must not import relics.ts (relics.ts
  // imports model.ts); a test asserts every value names a real relic.
  requiresRelicDiscovery?: string;
  flavor?: string;      // narrative color (optional)
  unlockHint?: string;  // functional "how to unlock" clue for the UI (optional)
}

// The THREE mutually-exclusive blueprint shapes, as a single classified value. This encodes
// the discriminant PRECEDENCE in ONE place: unlock-only wins first (it crafts nothing, so it
// must never be read as a material even though it, too, lacks `equipmentOutput`), then equipment
// (mints a system), else material (a stackable output). Before this helper the precedence lived
// inline at several call sites, where a material-vs-equipment branch classifying on
// `equipmentOutput === undefined` ALONE would misread an unlock-only blueprint as material if it
// ever reached that branch unguarded. Routing shape reads through blueprintKind removes that risk.
export type BlueprintKind = "unlockOnly" | "weapon" | "drone" | "equipment" | "material";
export function blueprintKind(bp: BlueprintDef): BlueprintKind {
  if (bp.unlockOnly) return "unlockOnly";   // precedence encoded ONCE, here
  if (bp.weaponOutput) return "weapon";     // Combat 1.0: a crafted weapon (generateWeapon), before equipment
  if (bp.droneOutput) return "drone";       // Combat 1.0 (Unit 2.1b): a crafted drone pod (generateDronePod). Slotted
                                            // right after weapon because BOTH are separate-table instance minters (their
                                            // own def tables, no EQUIPMENT_SLOTS entry), so the precedence is:
                                            // unlockOnly -> weapon -> drone -> equipment -> material.
  if (bp.equipmentOutput) return "equipment";
  return "material";
}

// Does this blueprint's Fabricator output a non-stacking EquipmentInstance (rather than a
// stackable inventory item)? TRUE for an economy EQUIPMENT blueprint (minted via
// generateEquipment), a combat WEAPON blueprint (minted via generateWeapon), and a combat DRONE
// blueprint (minted via generateDronePod, Combat 1.0 Unit 2.1b): all three share the Fabricator's
// "mint an instance" completion path (the addEquipment effect), skip the warehouse MATERIAL cap,
// and answer to the equipment spare-storage cap instead. Centralizing this test keeps every
// fabricate gate (lineJobSpec / canStartLine / startFabricateJob) reading ONE predicate, so a
// future instance-minting shape is a one-line change here (Omega 4/9). FALSE for a material
// blueprint (stackable output) and an unlock-only blueprint (crafts nothing).
export function blueprintMintsEquipmentInstance(bp: BlueprintDef): boolean {
  const kind = blueprintKind(bp);
  return kind === "equipment" || kind === "weapon" || kind === "drone";
}

// First-pass blueprint set (design §5), tied to the already-scaffolded component
// ITEMS (frameSegment/powerCoupling [minorComponent], structuralAssembly [majorComponent]).
// Keyed Record<string, BlueprintDef> (not a narrow union), matching FACILITIES'/
// REFINE_RECIPES' forward-loose keying so a later blueprint slots in with no type change.
// Add entries HERE (and nowhere else, the R5 Research panel iterates this object).
//
//   Tier 1 (basic minor components): frameSegmentBp -> frameSegment, powerCouplingBp ->
//     powerCoupling. Recipes consume REFINED materials (titaniumIngot / polysilicateWafer).
//   Tier 2 (a major component): structuralAssemblyBp -> structuralAssembly, built from the
//     tier-1 minor components + a refined material, exercising the component ladder
//     (raw -> refined -> minor -> major) the item taxonomy is built around.
// Higher tiers (equipment / modules / ship systems) are DEFERRED until the Fabricator +
// ship-systems phases define them (design §5), no placeholder tiers here.
//
// The hidden blueprints the catalog shows under the switch (`live` overrides it: the wiring probe reads both states
// through this one reader, so its off side is the real off state). Hoisted: BLUEPRINTS below spreads it. Pure.
export function fieldKitsShownBlueprints(live: boolean = FIELD_KITS_PLAYER_LIVE): Readonly<Record<string, BlueprintDef>> {
  return live ? FIELD_KITS_HIDDEN_BLUEPRINTS : {};
}

// Field Kits FKR-5: the blueprints kept OUT of BLUEPRINTS until FIELD_KITS_PLAYER_LIVE (user 2026-10-20 "Hide until
// kits are live"): the Research list, Fabricator, Archive and their completion totals read BLUEPRINTS whole and have no
// hidden-entry rule (the PROSPECTING_BLUEPRINTS pattern). FKR-7 flips the switch and BLUEPRINTS spreads them in.
// The Impact Grenade, the PLAIN grenade (FK11), so tier 1 beside the Stun Grenade (IMPACT_GRENADE_RECIPE).
export const FIELD_KITS_HIDDEN_BLUEPRINTS: Readonly<Record<string, BlueprintDef>> = {
  impactGrenadeBp: {
    key: "impactGrenadeBp",
    label: "Impact Grenade Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberTool", varietyKey: "impactGrenade" },
    recipe: { inputs: { ...IMPACT_GRENADE_RECIPE } },
    // Recipe realism text fix T7 (call 11, recipe kept): the blast is the Coupling's stored charge, dumped at once on
    // contact (the default grenade: it goes off when it hits, where the Stun and Toxin grenades are timed).
    flavor: "It bursts on contact: the coupling dumps its whole stored charge at once, and the blast does the arguing.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
};

// Expedition Tiers G2-4 (user G3 2026-10-16: "A combination of higher tier ships and better drive blueprints/stats/
// etc."; G20 "Class IV drive", Roman numerals): the CLASSED FTL DRIVES, one Balanced-ratio blueprint per Class II to
// VII (plan G2-4: "one per class at first, Balanced ratios"). Class N sits on blueprint tier N; the minted piece reads
// its class back through ftlDriveClass (blueprintKey), which also draws x1.6 power per class above I (E-MOD EM-1),
// never baked into powerDraw here. [PROPOSAL recipes and costs] after the recipe realism audit section 4.2: a base of
// Coupling 3 + Wafer 3 + Titanium Ingot 2 (the audit's field coils, Cobalt Coil 2, wait for ML-2, which lifts the Cobalt
// Coil's reserve with the FTL recipe rework); Class III to V add 1 / 2 / 3 Deuterium Canisters (ML L9 / GG call 7
// "Drives + Lab blueprints"); Class VI and VII add 1 / 2 Antimatter Containment Cells. The balancing patch owns the
// amounts.
// A row joins BLUEPRINTS only once BOTH the Research Lab and the Fabricator tracks reach its tier
// (drivesWithinFacilityReach). Since complement OC-15 ("Add tiers 3-7 now") both tracks reach tier VII, so Class II to
// VII are all served (before it only Class II was, and the dispatch said "None can be built yet" for Tiers III to VII:
// propulsion.ts driveClassUnavailable, which still names a class no served blueprint gives).
const DRIVE_CLASS_BASE_RECIPE = { powerCoupling: 3, polysilicateWafer: 3, titaniumIngot: 2 } as const;
function classedDriveBlueprint(driveClass: 2 | 3 | 4 | 5 | 6 | 7, cost: { ticks: number; credits: number; craft: number }, extra: Record<string, number>): BlueprintDef {
  const numeral = ["", "I", "II", "III", "IV", "V", "VI", "VII"][driveClass];
  return {
    key: `class${numeral}DriveBp`,
    label: `Class ${numeral} Drive Blueprint`,
    tier: driveClass,
    researchDurationTicks: cost.ticks,
    researchCreditCost: cost.credits,
    craftDurationTicks: cost.craft,
    equipmentOutput: { slotType: "ftlDrive", varietyKey: "balancedDrive" },
    driveClass,
    recipe: { inputs: { ...DRIVE_CLASS_BASE_RECIPE, ...extra } },
    flavor: `A Class ${numeral} field generator: a deeper fold of space per jump, and the reactor feels every one of them.`,
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator; installed in a ship's FTL Drive slot.",
  };
}
export const DRIVE_CLASS_BLUEPRINTS: readonly BlueprintDef[] = [
  classedDriveBlueprint(2, { ticks: 140, credits: 2_400, craft: 360 }, {}),
  classedDriveBlueprint(3, { ticks: 200, credits: 6_000, craft: 480 }, { deuteriumCanister: 1 }),
  classedDriveBlueprint(4, { ticks: 260, credits: 12_000, craft: 600 }, { deuteriumCanister: 2 }),
  classedDriveBlueprint(5, { ticks: 320, credits: 24_000, craft: 720 }, { deuteriumCanister: 3 }),
  classedDriveBlueprint(6, { ticks: 400, credits: 48_000, craft: 900 }, { deuteriumCanister: 3, antimatterCell: 1 }),
  classedDriveBlueprint(7, { ticks: 480, credits: 96_000, craft: 1_080 }, { deuteriumCanister: 3, antimatterCell: 2 }),
];
// The classed drives whose tier BOTH facility tracks reach (a level-N facility serves tier N; a track's top level is
// its rung count), keyed for BLUEPRINTS' spread. Hoisted: BLUEPRINTS below spreads it. Pure over the static tables.
export function drivesWithinFacilityReach(): Readonly<Record<string, BlueprintDef>> {
  const top = Math.min(FACILITIES.research?.upgrades.length ?? 0, FACILITIES.fabricator?.upgrades.length ?? 0);
  const out: Record<string, BlueprintDef> = {};
  for (const bp of DRIVE_CLASS_BLUEPRINTS) if (bp.tier <= top) out[bp.key] = bp;
  return out;
}

export const BLUEPRINTS: Record<string, BlueprintDef> = {
  frameSegmentBp: {
    key: "frameSegmentBp",
    label: "Frame Segment Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 500,
    craftDurationTicks: 120, // tier-1 first-pass (tunable)
    // Structural strut <- structural metal. Titanium Ingot is the refined structural feedstock.
    recipe: { inputs: { titaniumIngot: 4 }, outputItem: "frameSegment", outputQty: 1 },
    flavor: "The schematics for a hull's load-bearing struts, the first thing any shipwright learns to stamp.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  powerCouplingBp: {
    key: "powerCouplingBp",
    label: "Power Coupling Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 600,
    craftDurationTicks: 120, // tier-1 first-pass (tunable)
    // Recipe realism (audit call 8, user 2026-10-21 "3 Wafers + 1 Ti Ingot"): silicon power electronics in a metal
    // housing. Same count; a common input replaces an uncommon one. Only the Coupling's own recipe moves: every hull,
    // blueprint and rung that takes Couplings is untouched.
    recipe: { inputs: { polysilicateWafer: 3, titaniumIngot: 1 }, outputItem: "powerCoupling", outputQty: 1 },
    flavor: "Wiring diagrams for the shielded junctions that tie a reactor line into the systems it feeds.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  structuralAssemblyBp: {
    key: "structuralAssemblyBp",
    label: "Structural Assembly Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1500,
    craftDurationTicks: 300, // tier-2 first-pass (tunable)
    // Major component <- tier-1 minor components + a refined metal. Demonstrates the ladder:
    // frame segments + a power coupling, reinforced with titanium, married into a hull spine.
    recipe: {
      inputs: { frameSegment: 2, powerCoupling: 1, titaniumIngot: 2 },
      outputItem: "structuralAssembly",
      outputQty: 1,
    },
    flavor: "The master plan for marrying frame segments and couplings into one rigid sub-structure.",
    unlockHint: "Researched at the Research Lab (requires a higher lab tier); crafted at the Fabricator later.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EQUIPMENT BLUEPRINTS (0.11.0 Task 18): the 12 CRAFTABLE equipment recipes,
  // one per (live slot × variety) across the four live EQUIPMENT_SLOTS. Each
  // carries `equipmentOutput: { slotType, varietyKey }` (the piece it mints) and
  // consumes REFINED materials + fabricated COMPONENTS via `recipe.inputs` (NEVER
  // raw ore directly, design's "raw -> refine -> fabricate -> equip" ladder). An
  // equipment blueprint produces NO stackable item, so it OMITS
  // `recipe.outputItem`/`outputQty` entirely (both are OPTIONAL on BlueprintDef): the
  // real output is the EquipmentInstance, minted by the Fabricator (Task 19), which
  // branches on `equipmentOutput`. (Before the 0.11.0 cleanup these carried a
  // vestigial `outputItem: "components"` placeholder pointing at the since-removed
  // `components` ITEM; see the BlueprintDef equipmentOutput note.)
  //
  // MATERIAL-SPREAD / "no dead-end material" design rule (plan Task 18): across
  // the 12, the inputs cover the FULL set of materials that are ACTUALLY
  // PRODUCIBLE today, the two refine-recipe outputs (titaniumIngot,
  // polysilicateWafer, after the 0.11.0 Task A1 refinedMaterial merge) and the three
  // fabricated components (frameSegment, powerCoupling, structuralAssembly).
  // ⚠️ JUDGMENT CALL: the plan's
  // "full spread across the 4 mission triads" cannot yet reach the OTHER 10 raw
  // ores (iridium/ferrite/cobalt/osmium/scrap/circuitry/reactorCore/biomass/resin/
  // spore) because NO REFINE_RECIPE turns them into a refined item yet (only
  // commonOre + uncommonMaterial have refine paths), and the refine-recipes.test
  // FORBIDS a blueprint from consuming a refined item that nothing refines (a real
  // dead end). Extending the sink to all four triads is a follow-up that must add
  // the missing REFINE_RECIPES first, OUT of this data-only task's scope. So the
  // spread here is "every PRODUCIBLE refined/component material feeds an equipment
  // blueprint", the honest, testable form of the rule today.
  //
  // ⚠️ FIRST-PASS TUNABLE ⚠️ every tier / cost / duration / input amount below is a
  // launch placeholder in the SAME spirit as the material blueprints above; real
  // balance happens at the device-check stage. Tier-1 for the ten cheap varieties;
  // the two that consume the tier-2 `structuralAssembly` component are tier-2 so
  // their research/fabricator gate matches the tier of their heaviest input.
  // Keys follow the `<varietyKey>Bp` convention (variety keys are unique across all
  // four slots), mirroring the material blueprints' `<item>Bp` keys.

  // --- CARGO BAY (structural holds: frame + titanium) ------------------------
  prospectorHoldBp: {
    key: "prospectorHoldBp",
    label: "Prospector Hold Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "cargoBay", varietyKey: "prospectorHold" },
    // Prospector-leaning hold: a light frame with recovered-alloy panels for volume. ML-2 as amended by the recipe
    // realism audit (call 5, user 2026-10-21 "All four"): E-MAT's biomass hold replaced by light Reclaimed Alloy panels.
    recipe: { inputs: { frameSegment: 2, titaniumIngot: 1, reclaimedAlloy: 2 } },
    flavor: "A cavernous prospector's hold, all volume and light bracing, built to swallow a survey haul.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  balancedHoldBp: {
    key: "balancedHoldBp",
    label: "Balanced Hold Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "cargoBay", varietyKey: "balancedHold" },
    // The neutral middle hold (the cargo slot's DEFAULT variety): frame + titanium.
    // (ITEM-MERGE 0.11.0 Task A1: the old `refinedMaterial: 2` filler was folded into
    // this recipe's existing `titaniumIngot: 2`, so 2 + 2 = 4, preserving total input
    // units; effective cost drops as titaniumIngot refines cheaper, an accepted shift.)
    recipe: { inputs: { frameSegment: 2, titaniumIngot: 4 } },
    flavor: "A no-nonsense general hold, the shape most shipwrights stamp first and rarely regret.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  haulerHoldBp: {
    key: "haulerHoldBp",
    label: "Hauler Hold Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "cargoBay", varietyKey: "haulerHold" },
    // Max-capacity hold: a full structural assembly (tier-2 spine) plated in heavy ferrite and recovered alloy. ML-2
    // (E-MAT 3c; L11 "Approve all three": the Structural Assembly stays on the Hauler Hold).
    recipe: { inputs: { structuralAssembly: 1, ferriteIngot: 2, reclaimedAlloy: 2 } },
    flavor: "A freighter-grade hold braced on a full sub-structure, heavy, and it hauls like it.",
    unlockHint: "Researched at the Research Lab (needs a higher tier); crafted at the Fabricator later.",
  },

  // --- FTL DRIVE (propulsion: couplings + wafers) ----------------------------
  sprintDriveBp: {
    key: "sprintDriveBp",
    label: "Sprint Drive Blueprint",
    tier: 1,
    researchDurationTicks: 70,
    researchCreditCost: 800,
    craftDurationTicks: 160,
    equipmentOutput: { slotType: "ftlDrive", varietyKey: "sprintDrive" },
    // Speed drive: power couplings feeding high-field cobalt coils. ML-2 (E-MAT 3c; L11: differentiated from the
    // Efficient Core, which no longer shares its recipe).
    recipe: { inputs: { powerCoupling: 2, cobaltCoil: 2 } },
    flavor: "A hair-trigger FTL drive tuned for the fastest transit the fleet can light off.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  economyDriveBp: {
    key: "economyDriveBp",
    label: "Economy Drive Blueprint",
    tier: 1,
    researchDurationTicks: 70,
    researchCreditCost: 800,
    craftDurationTicks: 160,
    equipmentOutput: { slotType: "ftlDrive", varietyKey: "economyDrive" },
    // Long-haul drive: couplings + reclaimed control circuitry for a fuel-sipping regulator (thrift comes from control,
    // not metal). ML-2 (E-MAT 3c).
    recipe: { inputs: { powerCoupling: 2, reclaimedCircuit: 3 } },
    flavor: "A patient long-haul drive that sips fuel, the runabout's choice for the deep runs.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  balancedDriveBp: {
    key: "balancedDriveBp",
    label: "Balanced Drive Blueprint",
    tier: 1,
    researchDurationTicks: 70,
    researchCreditCost: 800,
    craftDurationTicks: 160,
    equipmentOutput: { slotType: "ftlDrive", varietyKey: "balancedDrive" },
    // The even drive (the FTL slot's DEFAULT variety): couplings + wafers + a titanium brace.
    recipe: { inputs: { powerCoupling: 2, polysilicateWafer: 2, titaniumIngot: 1 } },
    flavor: "An even-tempered drive splitting the difference between speed and thrift, the safe default.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  // Expedition Tiers G2-4: the classed FTL drives the facility tracks reach (DRIVE_CLASS_BLUEPRINTS above; Class II
  // today), right after the Class I drives.
  ...drivesWithinFacilityReach(),

  // --- REACTOR CORE (power: couplings + wafers, top core on a structural spine) ---
  highOutputCoreBp: {
    key: "highOutputCoreBp",
    label: "High-Output Core Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1700,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "reactorCore", varietyKey: "highOutputCore" },
    // Max-output reactor: heavy couplings, an iridium-clad fuel assembly and dense osmium shielding (its fuel charge is
    // appended below the table, withReactorFuel). ML-2 (E-MAT 3c; L11: the Structural Assembly is dropped here). Kept
    // tier 2: its rare Iridium Catalyst and Osmium Plate gate it now, and its tier sets its two-canister fuel rung.
    recipe: { inputs: { powerCoupling: 3, iridiumCatalyst: 1, osmiumPlate: 1 } },
    flavor: "A brute of a reactor wound for raw output, its fuel clad in iridium and its core walled in osmium.",
    unlockHint: "Researched at the Research Lab (needs a higher tier); crafted at the Fabricator later.",
  },
  efficientCoreBp: {
    key: "efficientCoreBp",
    label: "Efficient Core Blueprint",
    tier: 1,
    researchDurationTicks: 70,
    researchCreditCost: 850,
    craftDurationTicks: 160,
    equipmentOutput: { slotType: "reactorCore", varietyKey: "efficientCore" },
    // Light, low-draw core: couplings, one confinement coil and reclaimed regulator circuitry (fuel appended below the
    // table, withReactorFuel). ML-2 (E-MAT 3c; L11: differentiated from the Sprint Drive).
    recipe: { inputs: { powerCoupling: 2, cobaltCoil: 1, reclaimedCircuit: 2 } },
    flavor: "A lean, quiet core that gives up peak output for a featherweight, low-draw fit.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  balancedCoreBp: {
    key: "balancedCoreBp",
    label: "Balanced Core Blueprint",
    tier: 1,
    researchDurationTicks: 70,
    researchCreditCost: 850,
    craftDurationTicks: 160,
    equipmentOutput: { slotType: "reactorCore", varietyKey: "balancedCore" },
    // The middle reactor (the reactor slot's DEFAULT variety): couplings + wafers + titanium brace (fuel appended below
    // the table, withReactorFuel).
    recipe: { inputs: { powerCoupling: 2, polysilicateWafer: 2, titaniumIngot: 1 } },
    flavor: "A dependable middle-of-the-road core, enough output, sensible mass, nothing to prove.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },

  // --- SPEC UTILITY (Prospecting Rig: sensors/electronics + framing) ----------
  yieldRigBp: {
    key: "yieldRigBp",
    label: "Yield Rig Blueprint",
    tier: 1,
    researchDurationTicks: 80,
    researchCreditCost: 900,
    craftDurationTicks: 170,
    equipmentOutput: { slotType: "specUtility", varietyKey: "yieldRig" },
    // Extractor-efficiency rig (the spec slot's DEFAULT variety): a framed wafer sensor pack.
    recipe: { inputs: { frameSegment: 2, polysilicateWafer: 2 } },
    flavor: "A prospecting rig tuned to squeeze every last gram out of a seam before moving on.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  surveyRigBp: {
    key: "surveyRigBp",
    label: "Survey Rig Blueprint",
    tier: 1,
    researchDurationTicks: 80,
    researchCreditCost: 900,
    craftDurationTicks: 170,
    equipmentOutput: { slotType: "specUtility", varietyKey: "surveyRig" },
    // Sensor-heavy rig: couplings powering photonic-gel optics. ML-2 (E-MAT 3c).
    recipe: { inputs: { powerCoupling: 2, photonicGel: 2 } },
    flavor: "A wide-eyed survey rig that finds the rich seams faster, if not always the fullest.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },
  refineryFeedRigBp: {
    key: "refineryFeedRigBp",
    label: "Refinery-Feed Rig Blueprint",
    tier: 1,
    researchDurationTicks: 80,
    researchCreditCost: 900,
    craftDurationTicks: 170,
    equipmentOutput: { slotType: "specUtility", varietyKey: "refineryFeedRig" },
    // Material-quality rig: a bioleaching pre-treatment (microbes upgrading ore is real mining) in a titanium housing.
    // ML-2 (E-MAT 3c: the Biocatalyst ties the rig to the quality stat it carries); flavor per audit text fix T6.
    recipe: { inputs: { titaniumIngot: 2, biocatalyst: 2 } },
    flavor: "A bioleaching rig that seeds fresh ore with a living culture, so the Refinery gets a cleaner, richer feed.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once equipment fabrication comes online.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WEAPON BLUEPRINTS (Combat 1.0, Unit 1.2b: the weapon craft chain) ─────────
  // The nine v1 combat weapons (three per family; see combat/weapons.ts) as the THIRD
  // craftable blueprint shape. Each carries `weaponOutput: { weaponType }` (the WEAPON_DEFS
  // entry the Fabricator mints via generateWeapon) and, exactly like an equipment blueprint,
  // consumes REFINED materials + fabricated COMPONENTS via `recipe.inputs` (NEVER raw ore, the
  // "raw -> refine -> fabricate -> equip" ladder) and OMITS `recipe.outputItem`/`outputQty` (the
  // real output is the minted weapon EquipmentInstance, not a stackable). Keyed `<weaponType>Bp`
  // like the material/equipment keys. Weapons are NOT read in combat yet (that is Unit 1.4); this
  // unit only makes them research -> fabricate craftable and visible in the UI.
  //
  // TIER = 1 or 2 ONLY. `tier` gates the RESEARCH LAB level required to research the blueprint
  // (canResearch: bp.tier > research level -> tierLocked), and the Research Lab capped at level 2
  // when these were tiered, so a tier-3 weapon blueprint would have been permanently un-
  // researchable, and thus permanently un-craftable. The three basic family staples are tier 1;
  // the heavier / higher-impact weapons are tier 2 (matching structuralAssemblyBp / the tier-2
  // equipment lines). OC-15 has since raised both tracks to tier VII, so re-tiering upward is
  // now a balancing call, not a reachability one.
  //
  // ⚠️ FIRST-PASS TUNABLE ⚠️ every tier / cost / duration / input amount below is a launch
  // placeholder in the SAME spirit as the material + equipment blueprints above (and the weapon
  // stat lines in combat/weapons.ts); real balance lands at the device-check stage. The flavor
  // one-liner on each states the weapon's locked identity (design S3), the durable contract.

  // --- PARTICLE family (shield-pressure: bleeds hull through shields) ---------
  plasmaBp: {
    key: "plasmaBp",
    label: "Plasma Cannon Blueprint",
    tier: 1,
    researchDurationTicks: 80,
    researchCreditCost: 800,
    craftDurationTicks: 150,
    weaponOutput: { weaponType: "plasma" },
    // The well-rounded particle staple: wafer-dense emitter driven by a pair of couplings.
    recipe: { inputs: { polysilicateWafer: 2, powerCoupling: 2 } },
    flavor: "A dependable particle bolt that bleeds hull through shields and leaves a plasma fire smoldering behind it.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  gravitonBp: {
    key: "gravitonBp",
    label: "Graviton Emitter Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1500,
    craftDurationTicks: 300,
    weaponOutput: { weaponType: "graviton" },
    // The long-reach particle emitter (engine-disruptor): a wide wafer array on two couplings.
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 2 } },
    flavor: "A long-reach graviton beam that warps a target's drive manifolds as it burns.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },
  voltaicBp: {
    key: "voltaicBp",
    label: "Voltaic Discharger Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    weaponOutput: { weaponType: "voltaic" },
    // The anti-shield specialist: heavy coupling draw feeding a dense wafer capacitor bank.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 3 } },
    flavor: "An arc weapon tuned to overload shield emitters and keep a screen collapsing faster than it can recharge.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },

  // --- KINETIC family (the finishers: hull damage, hard-walled by shields) ----
  autocannonBp: {
    key: "autocannonBp",
    label: "Autocannon Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 600,
    craftDurationTicks: 120,
    weaponOutput: { weaponType: "autocannon" },
    // The cheap sustained workhorse: a titanium receiver on a single frame segment.
    recipe: { inputs: { titaniumIngot: 3, frameSegment: 1 } },
    flavor: "A rapid-fire kinetic workhorse: low per-shot punch, but it never stops chewing hull once the shields are down.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  railgunBp: {
    key: "railgunBp",
    label: "Railgun Blueprint",
    tier: 2,
    researchDurationTicks: 150,
    researchCreditCost: 1800,
    craftDurationTicks: 300,
    weaponOutput: { weaponType: "railgun" },
    // The precision heavy hitter: a braced titanium rail spine driven by a coupling.
    recipe: { inputs: { titaniumIngot: 4, frameSegment: 2, powerCoupling: 1 } },
    flavor: "A precision kinetic slug that punches clean through ablative armor and rattles a target's aim on impact.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },
  concussionTorpedoBp: {
    key: "concussionTorpedoBp",
    label: "Concussion Torpedo Blueprint",
    tier: 2,
    researchDurationTicks: 150,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    weaponOutput: { weaponType: "concussionTorpedo" },
    // The heavy warhead: a full structural assembly wrapping a titanium-framed charge.
    recipe: { inputs: { titaniumIngot: 3, frameSegment: 2, structuralAssembly: 1 } },
    flavor: "A ship-killing warhead: slow to reload and swingy to land, but a single hit cripples drives and staggers a hull.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },

  // --- EW family (support/debuff: weak damage, disruptions are the point) -----
  pointDefenseArrayBp: {
    key: "pointDefenseArrayBp",
    label: "Point-Defense Array Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 120,
    weaponOutput: { weaponType: "pointDefenseArray" },
    // The light screen weapon: a fast-tracking wafer sensor grid on a single coupling.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 1 } },
    flavor: "A swarm of fast tracking rounds built to blanket the near sky and swat down incoming drones.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  empCannonBp: {
    key: "empCannonBp",
    label: "EMP Cannon Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    weaponOutput: { weaponType: "empCannon" },
    // The disruption platform: a wafer pulse stack drawing hard on a pair of couplings.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 2 } },
    flavor: "A low-yield pulse whose real payload is chaos: jammed weapons and dead capacitors across an enemy's systems.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },
  tachyonBurstEmitterBp: {
    key: "tachyonBurstEmitterBp",
    label: "Tachyon Burst Emitter Blueprint",
    tier: 2,
    researchDurationTicks: 130,
    researchCreditCost: 1700,
    craftDurationTicks: 300,
    weaponOutput: { weaponType: "tachyonBurstEmitter" },
    // The best-yield EW emitter (sensor disruptor): a wide wafer lattice on two couplings.
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 2 } },
    flavor: "A tachyon lance that scrambles targeting sensors and reaches through shields better than any other EW emitter.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DRONE-POD BLUEPRINTS (Combat 1.0, Unit 2.1b: the drone-pod craft chain) ───
  // The three drone-pod roles (attack / defense / support; see combat/drones.ts ROLE_TEMPLATE) as
  // the FIFTH craftable blueprint shape, the DRONE analogue of the nine weapon blueprints above.
  // Each carries `droneOutput: { role }` (the ROLE_TEMPLATE entry the Fabricator mints via
  // generateDronePod) and, exactly like a weapon/equipment blueprint, consumes REFINED materials +
  // fabricated COMPONENTS via `recipe.inputs` (NEVER raw ore, the "raw -> refine -> fabricate ->
  // equip" ladder) and OMITS `recipe.outputItem`/`outputQty` (the real output is the minted pod
  // EquipmentInstance, not a stackable). Keyed `<role>DronePodBp` (attackDronePodBp, etc.), matching
  // the `<weaponType>Bp` weapon convention. Pods are NOT read in combat yet (no hangar-bay install,
  // no bridge fold); this unit only makes them research -> fabricate craftable and visible in the UI.
  //
  // TIER = 1 or 2 ONLY, for the SAME reason as the weapon blueprints: `tier` gates the RESEARCH LAB
  // level required to research the blueprint, and the Research Lab capped at level 2 when these were
  // tiered (OC-15 has since raised it to VII), so a tier-3 pod would have been un-researchable. Attack (the entry role) is
  // tier 1; the more specialized defense + support roles are tier 2.
  //
  // RECIPES are electronics-heavy (design S8: a drone squadron is a swarm of small sensor-and-
  // thruster craft): lean polysilicateWafer (the avionics/sensor mass) + powerCoupling (squadron
  // power + launch energy) + frameSegment (the airframes/launch racks). No titanium slugs or heavy
  // warheads, this is a hangar unit, not a gun.
  //
  // ⚠️ FIRST-PASS TUNABLE ⚠️ every tier / cost / duration / input amount below is a launch
  // placeholder in the SAME spirit as the weapon + material + equipment blueprints (and the drone
  // ROLE_TEMPLATE stat lines in combat/drones.ts); real balance lands at the device-check stage. The
  // flavor one-liner on each states the role's locked identity (design S8), the durable contract.

  attackDronePodBp: {
    key: "attackDronePodBp",
    label: "Attack Drone Pod Blueprint",
    tier: 1,
    researchDurationTicks: 80,
    researchCreditCost: 800,
    craftDurationTicks: 160,
    droneOutput: { role: "attack" },
    // The strike swarm: sensor wafers for target-lock, couplings for punch, frames for the racks.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 2, frameSegment: 1 } },
    flavor: "A pod of strike drones that swarm a target and chew hull once its screen is down, the carrier's offensive fist.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  defenseDronePodBp: {
    key: "defenseDronePodBp",
    label: "Defense Drone Pod Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    droneOutput: { role: "defense" },
    // The interceptor screen: a denser sensor lattice (more wafers) to track and swat incoming fire.
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 2, frameSegment: 1 } },
    flavor: "A pod of interceptor drones that picket the near sky, deflecting incoming fire and shielding the carrier behind them.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },
  supportDronePodBp: {
    key: "supportDronePodBp",
    label: "Support Drone Pod Blueprint",
    tier: 2,
    researchDurationTicks: 130,
    researchCreditCost: 1700,
    craftDurationTicks: 300,
    droneOutput: { role: "support" },
    // The repair/utility swarm: extra frame segments for the manipulator arms that do the fieldwork.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 2, frameSegment: 2 } },
    flavor: "A pod of utility drones that patch hull and scrub disruptions mid-fight: no guns, all field repair and support.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // COMBAT DEFENSE BLUEPRINTS (shield emitters + hull plating) ────────────────
  // The DEFENSIVE half of craftable combat gear, the counterpart to the weapon
  // blueprints above. Unit 1.1 activated the shieldEmitters + hullPlating SLOTS
  // (EQUIPMENT_SLOTS, each with its 3 varieties) and Unit 2.5a even tuned CRAFTED
  // defense scaling, but the research/craft RECIPES were never written, so the gear
  // was un-obtainable in play (only the free Standard-Issue baseline existed). These
  // 6 blueprints close that gap. They are ORDINARY equipmentOutput blueprints, the
  // SAME shape + generateEquipment mint path as the economy systems, one per variety,
  // so they auto-appear in Research (the UIs enumerate Object.keys(BLUEPRINTS)) and
  // mint a named, variety-resolved crafted piece, NOT a separate weapon/drone table.
  //
  // TIER = 1 or 2 ONLY (the Research Lab capped at level 2 before OC-15, same constraint as the
  // weapon/drone blueprints): the two workhorse varieties per slot are T1, the premium
  // capacity/composite variety is T2.
  //
  // RECIPES (thematic): shields are ENERGY tech (powerCoupling + polysilicateWafer, like
  // the reactor cores); plating is ARMOR (titaniumIngot + frameSegment + structuralAssembly,
  // like the kinetic weapons). ⚠️ FIRST-PASS TUNABLE: every tier / cost / duration / input
  // below is a launch placeholder; real balance lands in the dedicated balance patch (0.16.0).

  // --- SHIELD EMITTERS (energy screen: couplings + sensor wafers) ---
  balancedEmitterBp: {
    key: "balancedEmitterBp",
    label: "Balanced Emitter Blueprint",
    tier: 1,
    researchDurationTicks: 70,
    researchCreditCost: 850,
    craftDurationTicks: 160,
    equipmentOutput: { slotType: "shieldEmitters", varietyKey: "balancedEmitter" },
    recipe: { inputs: { powerCoupling: 2, polysilicateWafer: 2, titaniumIngot: 1 } },
    flavor: "An even-handed emitter: a solid screen that recharges at a sensible clip, nothing specialized, nothing weak.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  rechargeArrayBp: {
    key: "rechargeArrayBp",
    label: "Recharge Array Blueprint",
    tier: 1,
    researchDurationTicks: 80,
    researchCreditCost: 900,
    craftDurationTicks: 170,
    equipmentOutput: { slotType: "shieldEmitters", varietyKey: "rechargeArray" },
    // ML-2 (E-MAT 3d): cobalt field coils for the fast cycle. (The Capacitor Bank keeps today's recipe: recipe realism
    // audit call 5, an armor plate does not belong in a capacitor.)
    recipe: { inputs: { powerCoupling: 2, polysilicateWafer: 1, cobaltCoil: 2 } },
    flavor: "A fast-cycling emitter tuned to bring the screen back up between volleys: less raw capacity, quicker recovery.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  capacitorBankBp: {
    key: "capacitorBankBp",
    label: "Capacitor Bank Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1700,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "shieldEmitters", varietyKey: "capacitorBank" },
    recipe: { inputs: { powerCoupling: 3, polysilicateWafer: 3, structuralAssembly: 1 } },
    flavor: "A deep reservoir of a shield: a heavy capacitor stack that soaks an enormous hit before the screen ever fails.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },

  // --- HULL PLATING (armor: titanium + framing + structure) ---
  reinforcedPlatingBp: {
    key: "reinforcedPlatingBp",
    label: "Reinforced Plating Blueprint",
    tier: 1,
    researchDurationTicks: 70,
    researchCreditCost: 850,
    craftDurationTicks: 160,
    equipmentOutput: { slotType: "hullPlating", varietyKey: "reinforcedPlating" },
    // ML-2 (E-MAT 3d): iron armor. Ferrite comes off the Lunar Mine, open from day one, so the anchor never walls.
    recipe: { inputs: { ferriteIngot: 2, titaniumIngot: 1, frameSegment: 1 } },
    flavor: "Straightforward structural armor: thick ferrite over a braced frame, more hull to grind through, plain and tough.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  ablativePlatingBp: {
    key: "ablativePlatingBp",
    label: "Ablative Plating Blueprint",
    tier: 1,
    researchDurationTicks: 80,
    researchCreditCost: 900,
    craftDurationTicks: 170,
    equipmentOutput: { slotType: "hullPlating", varietyKey: "ablativePlating" },
    // Recipe realism (audit call 5 + the Biofiber follow-up, user 2026-10-21): metal does not ablate. Real ablators are
    // carbon composites, so a Biofiber layer over a metal backing.
    recipe: { inputs: { frameSegment: 2, titaniumIngot: 1, biofiber: 2 } },
    flavor: "A sacrificial energy-shedding layer: it boils away under fire to spare the hull beneath, trading mass for a burn buffer.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  compositePlatingBp: {
    key: "compositePlatingBp",
    label: "Composite Plating Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1700,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "hullPlating", varietyKey: "compositePlating" },
    // ML-2 (E-MAT 3d) as amended by the recipe realism audit (call 5 + the Biofiber follow-up): an osmium kinetic layer
    // and a Biofiber ablative layer on the hull structure.
    recipe: { inputs: { titaniumIngot: 1, frameSegment: 2, structuralAssembly: 1, osmiumPlate: 1, biofiber: 1 } },
    flavor: "A layered composite: hull, ablative shedding, and kinetic dampening married into one plate that answers every damage type.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator once it comes online.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WARSHIP HULL BLUEPRINTS (Combat 0.13.0, Phase 9b: warship research gate) ──
  // UNLOCK-ONLY blueprints (unlockOnly: true, see BlueprintDef): they craft NOTHING.
  // Researching one flips a hull's ShipTypeDef.requiresBlueprint gate open, so the entry
  // warship (destroyer) stays free while the heavier capital hulls (battleship / carrier)
  // must be earned through research, one blueprint each so the two are independent choices.
  //
  // TIER = 2 (NOT the hulls' own tier-3 combat rank): this `tier` field gates the RESEARCH
  // LAB level required to research the blueprint (canResearch: bp.tier > research level ->
  // tierLocked). The Research Lab capped at level 2 when these were tiered (OC-15 has since raised
  // it to VII), so a tier-3 blueprint would have been permanently un-researchable, and thus its
  // hull permanently un-buildable. Tier 2 kept them reachable at the Lab's old ceiling and matches
  // structuralAssemblyBp / the tier-2 equipment lines. The Lab now reaches tier VII (OC-15), so
  // re-tiering these upward is a balancing call, not a reachability one.
  //
  // recipe.inputs is EMPTY (nothing is fabricated); the credit + duration cost is paid at the
  // Research Lab. ⚠️ FIRST-PASS TUNABLE ⚠️ tier / researchDurationTicks / researchCreditCost
  // are launch placeholders in the SAME spirit as every constant above (heavier than the
  // tier-2 component blueprints, since a capital hull is a bigger unlock); real balance lands
  // at the device-check stage. craftDurationTicks is required by the shape but INERT here (an
  // unlock-only blueprint is never fabricated); a positive placeholder satisfies the F1 "every
  // blueprint has a positive craftDurationTicks" invariant without implying it is ever crafted.
  battleshipHullBp: {
    key: "battleshipHullBp",
    label: "Battleship Hull Blueprint",
    tier: 2,
    researchDurationTicks: 300,
    researchCreditCost: 6000,
    craftDurationTicks: 1, // INERT: unlock-only blueprints are never fabricated (positive to satisfy the F1 invariant)
    unlockOnly: true,
    recipe: { inputs: {} }, // nothing to craft: the payoff is Shipyard build access, not an item
    flavor: "The full construction schematics for a battleship: the fleet's slow, gun-heavy capital wall.",
    unlockHint: "Research at the Research Lab to unlock the Battleship at the Shipyard.",
  },
  carrierHullBp: {
    key: "carrierHullBp",
    label: "Carrier Hull Blueprint",
    tier: 2,
    researchDurationTicks: 300,
    researchCreditCost: 6000,
    craftDurationTicks: 1, // INERT: unlock-only blueprints are never fabricated (positive to satisfy the F1 invariant)
    unlockOnly: true,
    recipe: { inputs: {} }, // nothing to craft: the payoff is Shipyard build access, not an item
    flavor: "The full construction schematics for a carrier: a drone platform that launches squadrons to fight for it.",
    unlockHint: "Research at the Research Lab to unlock the Carrier at the Shipyard.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EXPLORER HULL BLUEPRINTS (0.14.0 Exploration Phase E0) ────────────────────
  // The SAME unlock-only shape as the warship hull blueprints above: they craft NOTHING
  // (unlockOnly: true, empty recipe.inputs, INERT craftDurationTicks 1), their payoff is
  // Shipyard build access for the matching explorer hull (its ShipTypeDef.requiresBlueprint).
  // ONE blueprint per explorer so the three (Orion / Aurora / Eir) are independent unlock
  // choices, mirroring the battleship / carrier split.
  //
  // TIER = 2, for the SAME reason as the warship hull blueprints: `tier` gates the Research Lab
  // LEVEL required (canResearch: bp.tier > level -> tierLocked), and the Lab capped at level 2
  // when these were tiered (OC-15 has since raised it to VII), so a tier-3 blueprint would have
  // been un-researchable and its hull un-buildable. Tier 2 keeps them reachable early.
  //
  // ⚠️ E0 PLACEHOLDER GATE ONLY. The REAL discovery-gated acquisition (finding an explorer hull
  // out in the field) is a later phase (E4 research). This blueprint gate keeps the explorers
  // well-formed + earnable in current content rather than a dead, unobtainable gate; E4 replaces
  // or augments it. ⚠️ FIRST-PASS TUNABLE ⚠️ tier / researchDurationTicks / researchCreditCost
  // are launch placeholders (mid-game capital hulls; lighter than the warship 6000 since these
  // are a distinct, non-combat line), retuned at the device-check stage.
  orionHullBp: {
    key: "orionHullBp",
    label: "Orion Hull Blueprint",
    tier: 2,
    researchDurationTicks: 280,
    researchCreditCost: 5000,
    craftDurationTicks: 1, // INERT: unlock-only blueprints are never fabricated (positive to satisfy the F1 invariant)
    unlockOnly: true,
    recipe: { inputs: {} }, // nothing to craft: the payoff is Shipyard build access, not an item
    flavor: "The full construction schematics for the Orion: the fleet's balanced long-range explorer.",
    unlockHint: "Research at the Research Lab to unlock the Orion at the Shipyard.",
  },
  auroraHullBp: {
    key: "auroraHullBp",
    label: "Aurora Hull Blueprint",
    tier: 2,
    researchDurationTicks: 280,
    researchCreditCost: 5000,
    craftDurationTicks: 1, // INERT: unlock-only blueprints are never fabricated (positive to satisfy the F1 invariant)
    unlockOnly: true,
    recipe: { inputs: {} }, // nothing to craft: the payoff is Shipyard build access, not an item
    flavor: "The full construction schematics for the Aurora: a survey scout heavy with sensor and science modules.",
    unlockHint: "Research at the Research Lab to unlock the Aurora at the Shipyard.",
  },
  eirHullBp: {
    key: "eirHullBp",
    label: "Eir Hull Blueprint",
    tier: 2,
    researchDurationTicks: 280,
    researchCreditCost: 5000,
    craftDurationTicks: 1, // INERT: unlock-only blueprints are never fabricated (positive to satisfy the F1 invariant)
    unlockOnly: true,
    recipe: { inputs: {} }, // nothing to craft: the payoff is Shipyard build access, not an item
    flavor: "The full construction schematics for the Eir: a medical transport built to carry crews, supplies, and evacuees.",
    unlockHint: "Research at the Research Lab to unlock the Eir at the Shipyard.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DISCOVERY-GATED BLUEPRINTS (Exploration 0.14.0, Phase E4d) ──────────────────
  // The first-find unlocks (plan "E4d FIRST-FIND UNLOCKS", user 2026-10-01): identifying a RARE relic for
  // the first time opens a research project that could not be researched before
  // (requiresRelicDiscovery; canResearch's `undiscovered` gate). Each is an ORDINARY equipmentOutput
  // blueprint once unlocked (Research -> Fabricator -> a minted piece), so every craft/salvage/archive
  // path treats it like any other gear blueprint.
  //   Ancient Drive Coil  -> Damage Control Suite  (combat utility, tactician hulls)   [Anomalous Alloy]
  //   Deep-Vein Compass   -> Pathfinder Suite      (explorer utility, explorer hulls)  [refined metals]
  //   Leviathan Scale     -> Bio-Resonance Array   (relic-hunter scanning array)       [organics]
  // DEFERRED (not authored here, by decision): Precursor Lens's special module ships with the module phase
  // (E-MOD); its first find still gets the normal discovery moment, and adding its project later is a data
  // change (a blueprint carrying requiresRelicDiscovery). Heart of the Archive's Neural Backup is now authored
  // with the away-team member gear (E-CREW Task 7, neuralBackupBp below).
  //
  // RAW INPUTS, deliberately (judgment call, flagged): Anomalous Alloy is a `raw`-category salvage exotic and
  // two forage organics stay raw. (WR-4, OC-C3: Purified Biomass is refined now, so it replaced the raw Fibrous
  // Biomass in the Bio-Resonance Array.) The "no raw ore in an equipment recipe" rule is the mining ladder's; these are
  // exploration/salvage payoffs the user specified by name, so model.test.ts carves discovery-gated blueprints
  // out of that rule. TIER 2 (the Research Lab's ceiling) because each sits behind a rare relic.
  // ⚠️ FIRST-PASS TUNABLE ⚠️ every tier / cost / duration / input amount.
  damageControlSuiteBp: {
    key: "damageControlSuiteBp",
    label: "Damage Control Suite Blueprint",
    tier: 2,
    researchDurationTicks: 240,
    researchCreditCost: 2400,
    craftDurationTicks: 340,
    equipmentOutput: { slotType: "specUtility", varietyKey: "damageControlSuite" },
    requiresRelicDiscovery: "ancientDriveCoil",
    // Anomalous Alloy (its first real use) for the self-sealing hull patches, couplings for the pumps.
    // WR-4 (OC-C3): Reclaimed Alloy, re-smelted battle scrap, for the patch frames. [PROPOSAL] 2.
    recipe: { inputs: { anomalousAlloy: 2, titaniumIngot: 3, powerCoupling: 2, reclaimedAlloy: 2 } },
    flavor: "Self-sealing patch foam and a fast-response crew rig, built around an alloy that remembers its own shape.",
    unlockHint: "Identify an Ancient Drive Coil to unlock this research; crafted at the Fabricator.",
  },
  pathfinderSuiteBp: {
    key: "pathfinderSuiteBp",
    label: "Pathfinder Suite Blueprint",
    tier: 2,
    researchDurationTicks: 240,
    researchCreditCost: 2400,
    craftDurationTicks: 340,
    equipmentOutput: { slotType: "specUtility", varietyKey: "pathfinderSuite" },
    requiresRelicDiscovery: "deepVeinCompass",
    // Refined metals: a titanium survey frame with a wafer-dense sensor head.
    recipe: { inputs: { titaniumIngot: 4, polysilicateWafer: 3, frameSegment: 1 } },
    flavor: "A survey package that reads the ground the way the old compass did: where it is safe to tread, and where to look.",
    unlockHint: "Identify a Deep-Vein Compass to unlock this research; crafted at the Fabricator.",
  },
  bioResonanceArrayBp: {
    key: "bioResonanceArrayBp",
    label: "Bio-Resonance Array Blueprint",
    tier: 2,
    researchDurationTicks: 240,
    researchCreditCost: 2400,
    craftDurationTicks: 340,
    // The FIRST craftable sensor array. A sensor-slot equipmentOutput rides the same generic mint
    // (generateEquipment stamps the catalog id as moduleVariant for the sensor slot).
    equipmentOutput: { slotType: "sensor", varietyKey: "sensorBioResonance" },
    requiresRelicDiscovery: "leviathanScale",
    // Organics: a grown resonance membrane, the rare spore cluster as its tuning core. WR-4 (OC-C3): the membrane
    // is grown from Purified Biomass now (2, the refined form of the 12 raw Fibrous Biomass it used). [PROPOSAL] 2.
    recipe: { inputs: { purifiedBiomass: 2, volatileResin: 6, exoticSporeCluster: 2, polysilicateWafer: 2 } },
    flavor: "A living membrane tuned to the hum of very old things. It sweeps slowly, and it listens for relics.",
    unlockHint: "Identify a Leviathan Scale to unlock this research; crafted at the Fabricator.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // AWAY-TEAM MEMBER GEAR BLUEPRINTS (E-CREW 0.14.0, Task 7) ─────────────────
  // One ordinary equipmentOutput blueprint per member-gear variety (EQUIPMENT_SLOTS memberWeapon /
  // memberArmor / memberTool / implant), so member gear rides the SAME research -> Fabricator blank ->
  // inspect -> salvage / Archive path as ship gear (design D4). Inputs are EXISTING producible refined
  // materials + components only (titaniumIngot, polysilicateWafer, frameSegment, powerCoupling,
  // structuralAssembly): weapons + armor lean titanium, tools + implants lean wafers and couplings.
  // TIERS: the starter kit for each squad (one weapon, one armor, the basic tools) is tier 1; the
  // specialist pieces and every implant (cybernetics) are tier 2, the Research Lab's current ceiling.
  // The one exception is Neural Backup (below), discovery-gated by the Heart of the Archive.
  // ⚠️ FIRST-PASS TUNABLE ⚠️ every tier / cost / duration / input amount.

  // MEMBER WEAPONS
  pulseRifleBp: {
    key: "pulseRifleBp",
    label: "Pulse Rifle Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberWeapon", varietyKey: "pulseRifle" },
    // A titanium receiver around a pulse coupling.
    recipe: { inputs: { titaniumIngot: 3, powerCoupling: 1 } },
    flavor: "The away team's standard long gun: steady, accurate, and forgiving of a nervous hand.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  scattergunBp: {
    key: "scattergunBp",
    label: "Scattergun Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberWeapon", varietyKey: "scattergun" },
    // Heavy titanium barrels braced on a frame segment.
    recipe: { inputs: { titaniumIngot: 4, frameSegment: 1 } },
    flavor: "Short reach, wide spread. Whatever is in front of it has a bad day, usually several of them at once.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  shockBatonBp: {
    key: "shockBatonBp",
    label: "Shock Baton Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberWeapon", varietyKey: "shockBaton" },
    // A titanium haft with paired couplings and a wafer regulator.
    recipe: { inputs: { titaniumIngot: 2, powerCoupling: 2, polysilicateWafer: 1 } },
    flavor: "A close-quarters baton that dumps a charge into whatever it touches. Most things stop moving for a moment.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  sidearmBp: {
    key: "sidearmBp",
    label: "Sidearm Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberWeapon", varietyKey: "sidearm" },
    // A compact titanium frame and one coupling.
    recipe: { inputs: { titaniumIngot: 2, powerCoupling: 1 } },
    flavor: "A light pistol for people whose real work is on the ground in front of them.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },

  // MEMBER ARMOR
  ballisticWeaveBp: {
    key: "ballisticWeaveBp",
    label: "Ballistic Weave Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberArmor", varietyKey: "ballisticWeave" },
    // Recipe realism (audit call 9, user 2026-10-21 "Fix now", Biofiber where a fabric belongs): real body armor is
    // woven fiber with a hard insert, so a Biofiber weave, one titanium insert and a wafer-thin sensor lining.
    recipe: { inputs: { titaniumIngot: 1, polysilicateWafer: 1, biofiber: 2 } },
    flavor: "Light layered armor that turns a round without slowing the wearer's aim.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  assaultHardsuitBp: {
    key: "assaultHardsuitBp",
    label: "Assault Hardsuit Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberArmor", varietyKey: "assaultHardsuit" },
    // A full structural assembly as the suit's frame, plated in titanium.
    recipe: { inputs: { titaniumIngot: 4, structuralAssembly: 1 } },
    flavor: "A walking bulkhead. Slow to put on, slower to put down.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  fieldSuitBp: {
    key: "fieldSuitBp",
    label: "Field Suit Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberArmor", varietyKey: "fieldSuit" },
    // A titanium-ribbed Biofiber suit with wafer instrument panels (recipe realism audit call 9: the padding is fabric).
    recipe: { inputs: { titaniumIngot: 1, polysilicateWafer: 2, biofiber: 1 } },
    flavor: "A working suit with sample pouches, sensor cuffs, and just enough padding for a bad landing.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  hazardSuitBp: {
    key: "hazardSuitBp",
    label: "Hazard Suit Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberArmor", varietyKey: "hazardSuit" },
    // A sealed titanium shell with wafer environmental controls. Recipe realism (audit call 9): the seal layer replaces
    // the strut, and seals take Resin Distillate (the Group B follow-up, user 2026-10-21).
    recipe: { inputs: { titaniumIngot: 3, polysilicateWafer: 2, resinDistillate: 1 } },
    flavor: "Sealed against heat, cold, and air that would rather you did not breathe it.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },

  // MEMBER TOOLS (Security kit, then planet-tuned Science tools)
  stunGrenadeBp: {
    key: "stunGrenadeBp",
    label: "Stun Grenade Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberTool", varietyKey: "stunGrenade" },
    // A wafer charge core around a coupling.
    recipe: { inputs: { polysilicateWafer: 2, powerCoupling: 1 } },
    flavor: "A bright flash and a hard hum. The hostiles stand very still for a moment.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  toxinGrenadeBp: {
    key: "toxinGrenadeBp",
    label: "Toxin Grenade Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberTool", varietyKey: "toxinGrenade" },
    // Recipe realism (audit call 7, user 2026-10-21 "Fix now"): a grenade with no agent was wrong. A distilled resin
    // agent (the Group B follow-up: the Toxin Grenade takes Resin Distillate) in a titanium canister, on a coupling trigger.
    recipe: { inputs: { titaniumIngot: 1, powerCoupling: 1, resinDistillate: 1 } },
    flavor: "A canister of something that lingers. Throw it, then stand upwind.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  // Field Kits FKR-5: the Impact Grenade (FIELD_KITS_HIDDEN_BLUEPRINTS), merged in here, in this place, only once
  // FIELD_KITS_PLAYER_LIVE is true (FKR-9 / FKR-10 flipped it), through the one reader fieldKitsShownBlueprints.
  ...fieldKitsShownBlueprints(),
  medKitBp: {
    key: "medKitBp",
    label: "Med Kit Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberTool", varietyKey: "medKit" },
    // Recipe realism (audit call 7): wafer diagnostics in a titanium case, with Purified Biomass for the dressings and
    // stims (the First Aid Kit's own materials; Purified Biomass stays the food and medical feedstock).
    recipe: { inputs: { polysilicateWafer: 1, titaniumIngot: 1, purifiedBiomass: 2 } },
    flavor: "Field dressings, stims, and a diagnostic wand. Keeps a downed friend in the fight.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  shroudEmitterBp: {
    key: "shroudEmitterBp",
    label: "Shroud Emitter Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberTool", varietyKey: "shroudEmitter" },
    // A wafer projector array on paired couplings.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 2 } },
    flavor: "Bends light and sound around the team. The local wildlife walks right past.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  lureBeaconBp: {
    key: "lureBeaconBp",
    label: "Lure Beacon Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberTool", varietyKey: "lureBeacon" },
    // A frame-mounted wafer emitter on paired couplings.
    recipe: { inputs: { polysilicateWafer: 2, powerCoupling: 2, frameSegment: 1 } },
    flavor: "Broadcasts exactly what the hostiles want to hear. They come running, and they come carrying things.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  floraScannerBp: {
    key: "floraScannerBp",
    label: "Flora Scanner Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberTool", varietyKey: "floraScanner" },
    // A wafer sensor head on a coupling.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 1 } },
    flavor: "Tuned for living worlds. It finds the sample worth taking among a thousand that are not.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  thermalRigBp: {
    key: "thermalRigBp",
    label: "Thermal Rig Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberTool", varietyKey: "thermalRig" },
    // A titanium heat exchanger with wafer controls.
    recipe: { inputs: { polysilicateWafer: 2, titaniumIngot: 2 } },
    flavor: "Keeps instruments working where rock runs molten or air freezes solid.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  coreDrillBp: {
    key: "coreDrillBp",
    label: "Core Drill Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberTool", varietyKey: "coreDrill" },
    // A titanium bit driven by a coupling.
    recipe: { inputs: { titaniumIngot: 3, powerCoupling: 1 } },
    flavor: "Pulls cores out of dry and dead ground, and sometimes something older than the ground.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  decryptorBp: {
    key: "decryptorBp",
    label: "Decryptor Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberTool", varietyKey: "decryptor" },
    // A dense wafer stack on a coupling.
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 1 } },
    flavor: "Talks to locks that were built before anyone here had a word for lock.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  atmoProbeBp: {
    key: "atmoProbeBp",
    label: "Galileo-Class Probe Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberTool", varietyKey: "atmoProbe" },
    // A drop probe in a titanium pressure shell (it has a crush rating), with wafer sensors and a coupling. Recipe
    // realism (audit call 9): the shell replaces the strut; ids and stat ratios unchanged (GG call 6).
    recipe: { inputs: { polysilicateWafer: 2, powerCoupling: 1, titaniumIngot: 2 } },
    // Gas Giant Study GG-1 [PROPOSAL flavor] (design section 5).
    flavor: "Hardened against the crush and the acid. It keeps talking long after Galileo would have gone quiet.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },

  // IMPLANTS (Security combat set, then Science fieldwork set)
  dermalWeaveBp: {
    key: "dermalWeaveBp",
    label: "Dermal Weave Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "dermalWeave" },
    // Titanium mesh in a wafer-controlled graft.
    recipe: { inputs: { titaniumIngot: 2, polysilicateWafer: 2 } },
    flavor: "A subdermal mesh that hardens on impact. The surgeon says you will not notice it. You will.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  reflexBoosterBp: {
    key: "reflexBoosterBp",
    label: "Reflex Booster Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "reflexBooster" },
    // Wafer neural taps on a coupling.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 1 } },
    flavor: "Shaves the gap between seeing and moving down to almost nothing.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  targetingOpticBp: {
    key: "targetingOpticBp",
    label: "Targeting Optic Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "targetingOptic" },
    // A wafer lens assembly on a coupling.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 1 } },
    flavor: "An ocular overlay that leads the target for you.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  adrenalSurgeBp: {
    key: "adrenalSurgeBp",
    label: "Adrenal Surge Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "adrenalSurge" },
    // Paired couplings on a wafer regulator.
    recipe: { inputs: { polysilicateWafer: 2, powerCoupling: 2 } },
    flavor: "A gland regulator that opens the floodgates when the shooting starts.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  medNaniteSwarmBp: {
    key: "medNaniteSwarmBp",
    label: "Med-Nanite Swarm Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "medNaniteSwarm" },
    // A wafer hive on a coupling.
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 1 } },
    flavor: "A resident colony of repair nanites. They patch what they can, as fast as they can.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  toxinFiltersBp: {
    key: "toxinFiltersBp",
    label: "Toxin Filters Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "toxinFilters" },
    // Titanium filter beds with wafer sensors.
    recipe: { inputs: { polysilicateWafer: 2, titaniumIngot: 2 } },
    flavor: "Filters in the bloodstream that catch poisons before they catch you.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  cortexShieldBp: {
    key: "cortexShieldBp",
    label: "Cortex Shield Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "cortexShield" },
    // A titanium-shielded wafer damper.
    recipe: { inputs: { polysilicateWafer: 3, titaniumIngot: 1 } },
    flavor: "Dampens the shock of a stun and the pull of panic.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  synapticAcceleratorBp: {
    key: "synapticAcceleratorBp",
    label: "Synaptic Accelerator Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "synapticAccelerator" },
    // Wafer neural taps on a coupling.
    recipe: { inputs: { polysilicateWafer: 3, powerCoupling: 1 } },
    flavor: "Speeds the work of a trained eye. Surveys finish sooner, and fewer details slip past.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  archaeoScannerBp: {
    key: "archaeoScannerBp",
    label: "Archaeo-Scanner Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "archaeoScanner" },
    // A wafer sensor lattice on a coupling. Recipe realism (audit call 7): a load-bearing strut in an eye implant was
    // wrong; the coupling powers the overlay.
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 1 } },
    flavor: "A retinal overlay that flags the shapes ancient builders left behind.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  environmentalAdaptationBp: {
    key: "environmentalAdaptationBp",
    label: "Environmental Adaptation Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "environmentalAdaptation" },
    // Titanium-reinforced wafer regulators.
    recipe: { inputs: { polysilicateWafer: 2, titaniumIngot: 2 } },
    flavor: "Tunes the body to heat, cold, and thin air. Hostile ground feels a little less hostile.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  cipherWetwareBp: {
    key: "cipherWetwareBp",
    label: "Cipher Wetware Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "cipherWetware" },
    // A dense wafer stack on a coupling.
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 1 } },
    flavor: "Pattern-matching wetware for dead languages and old locks.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  bioAnalyzerBp: {
    key: "bioAnalyzerBp",
    label: "Bio-Analyzer Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "bioAnalyzer" },
    // A wafer assay chip in a titanium housing.
    recipe: { inputs: { polysilicateWafer: 3, titaniumIngot: 1 } },
    flavor: "An in-body assay lab. It knows what is worth sampling before the glove comes off.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.",
  },
  // NEURAL BACKUP: the Heart of the Archive's first-find unlock (exploration plan E4d "Neural Backup
  // (Reraise)", user 2026-10-01; deferred there until the implant system, which is this). Discovery-gated
  // (requiresRelicDiscovery), so the Research card stays MASKED until a Heart of the Archive is identified.
  // UNIQUE-EQUIPPED (one in the entire fleet, D11), so crafting a second only yields a spare. Really rare
  // by design: the capstone relic's first find plus one Intact Data Core (the core holds the backups).
  neuralBackupBp: {
    key: "neuralBackupBp",
    label: "Neural Backup Blueprint",
    tier: 2,
    researchDurationTicks: 240,
    researchCreditCost: 2400,
    craftDurationTicks: 340,
    equipmentOutput: { slotType: "implant", varietyKey: "neuralBackup" },
    requiresRelicDiscovery: "heartOfTheArchive",
    // One Intact Data Core as the backup store, a modest wafer + coupling interface around it.
    recipe: { inputs: { intactDataCore: 1, polysilicateWafer: 3, powerCoupling: 2 } },
    flavor: "A cortical implant that keeps a running copy of its wearer. Once, when it matters most, it can bring them back.",
    unlockHint: "Identify a Heart of the Archive to unlock this research; crafted at the Fabricator.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FIELD KIT BLUEPRINTS (Field Kits FKR-3, 0.14.0; docs/plans/2026-10-14-field-kits-plan.md, USER ANSWERS call 3
  // "Two research tiers (Recommended)"): six MATERIAL blueprints whose stackable output is a field kit (ITEMS
  // category "fieldKit", keyed by the fieldKits.ts kit id; fieldKits.ts FIELD_KIT_BLUEPRINT maps them). Tier 1
  // (cheap, 2 per craft): First Aid Kit, Antitoxin, Splint. Tier 2: Combat Stim, Trauma Kit, Injury Kit. Every
  // input is an existing material. The Fabricator lists them under its own "Field Kits" group (awayGearDisplay.ts
  // fabricatorGroupOf). Recipes and times [PROVISIONAL]: the answered proposal's numbers, balance-tunable. Nothing
  // spends a kit until FKR-6 (battle) and FKR-7 (packs).
  // ══════════════════════════════════════════════════════════════════════════
  firstAidKitBp: {
    key: "firstAidKitBp",
    label: "First Aid Kit Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 120,
    recipe: { inputs: { purifiedBiomass: 1, polysilicateWafer: 1 }, outputItem: "firstAidKit", outputQty: 2 },
    flavor: "Field dressings and a basic diagnostic strip, packed so anyone can patch up a squadmate mid-fight.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. A field kit a squad member carries.",
  },
  antitoxinBp: {
    key: "antitoxinBp",
    label: "Antitoxin Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 120,
    // User 2026-10-19 ("Biomass + Titanium, 60"): purified biomass in a titanium injector, priced like First Aid.
    recipe: { inputs: { purifiedBiomass: 1, titaniumIngot: 1 }, outputItem: "antitoxin", outputQty: 2 },
    flavor: "A broad antitoxin refined from purified biomass and sealed in a titanium injector, quick to load and quicker to work.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. A field kit a squad member carries.",
  },
  splintBp: {
    key: "splintBp",
    label: "Splint Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 120,
    // User 2026-10-19 ("Raise to Tier 2 band"): purified biomass padding added so the price lands near 100 (95),
    // between First Aid (60) and Combat Stim (150). Two units: one refined Tier 1 unit only reaches 65.
    recipe: { inputs: { titaniumIngot: 1, fibrousBiomass: 1, purifiedBiomass: 2 }, outputItem: "splint", outputQty: 2 },
    flavor: "A light titanium brace with fiber wraps, for setting a bone well enough to keep moving.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator. A field kit a squad member carries.",
  },
  combatStimBp: {
    key: "combatStimBp",
    label: "Combat Stim Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    recipe: { inputs: { volatileResin: 1, purifiedBiomass: 1 }, outputItem: "combatStim", outputQty: 2 },
    flavor: "An auto-injector that sharpens focus and steadies the hands for a short burst.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. A field kit a squad member carries.",
  },
  traumaKitBp: {
    key: "traumaKitBp",
    label: "Trauma Kit Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    recipe: { inputs: { purifiedBiomass: 2, exoticSporeCluster: 1, polysilicateWafer: 1 }, outputItem: "traumaKit", outputQty: 1 },
    flavor: "Clotting foam, neural blockers and a bone set, for the injuries first aid cannot touch.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. A field kit a squad member carries.",
  },
  injuryKitBp: {
    key: "injuryKitBp",
    label: "Injury Kit Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    recipe: { inputs: { purifiedBiomass: 2, polysilicateWafer: 1, powerCoupling: 1 }, outputItem: "injuryKit", outputQty: 1 },
    flavor: "A powered stabilizer cuff that starts the healing on the spot, so the medical bay has less to do.",
    unlockHint: "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. A field kit a squad member carries.",
  },
};

// Reactor fuel ladder (0.14.0; user 2026-10-21: "All reactor core crafting recipes should ultimately require something
// like this"): every Reactor Core blueprint's recipe carries its fuel, DERIVED from its variety's tech tier and its own
// blueprint tier (reactorTech.ts reactorCoreFuel: today Deuterium Canisters, 1 at tier I and 2 at tier II, the user's
// 1 / 1 / 2), appended AFTER its other inputs (salvage rounds per input in recipe order, so the older lines keep their
// draws). One place, so a new core can never ship unfueled and no count is written twice.
function withReactorFuel(bp: BlueprintDef): BlueprintDef {
  const out = bp.equipmentOutput;
  if (out?.slotType !== "reactorCore") return bp;
  return { ...bp, recipe: { ...bp.recipe, inputs: { ...bp.recipe.inputs, ...reactorCoreFuel(out.varietyKey, bp.tier) } } };
}
for (const key of Object.keys(BLUEPRINTS)) BLUEPRINTS[key] = withReactorFuel(BLUEPRINTS[key]);

// Exploration 0.14.0 (E4d): the blueprints a relic's FIRST FIND unlocks (requiresRelicDiscovery ===
// relicId), in BLUEPRINTS declaration order. Empty for a relic that gates nothing (most relics, and the
// deferred Precursor Lens / Heart of the Archive today). Pure over the static table; the identification
// reveal reads it for its "Research unlocked" line.
export function blueprintsUnlockedByRelic(relicId: string): BlueprintDef[] {
  return Object.values(BLUEPRINTS).filter((bp) => bp.requiresRelicDiscovery === relicId);
}

// Exploration 0.14.0 (E4d): is this blueprint still LOCKED behind an undiscovered relic? TRUE only for a
// discovery-gated blueprint whose relic is not yet in state.relicDiscovered. FALSE for every ungated
// blueprint (all pre-E4d content) and for an unknown key. canResearch reads it for the `undiscovered`
// reason and the Research catalog reads it to MASK the card. Pure.
export function blueprintRelicLocked(state: GameState, key: string): boolean {
  const relicId = BLUEPRINTS[key]?.requiresRelicDiscovery;
  if (relicId === undefined) return false;
  return !(state.relicDiscovered ?? []).includes(relicId);
}

// --- Default equipment variety per live slot (0.11.0 Task 18) ----------------
// The Standard-Issue FLOOR: the ONE variety per live slot whose Standard-rarity,
// quality-0 form is auto-seeded into every ship so a live slot is never empty
// (design's "a live slot is never empty" rule). Deliberately the NEUTRAL variety
// of each slot (no `favorsSpec`, or the yield rig for the single-family spec slot),
// so the baseline favours no spec. ⚠️ Standard-Issue is GENERATED, not a separate
// ITEMS def: a later task (Task 20 migration/seed) reads THIS map and mints the
// quality-0 EquipmentInstance for each slot's default variety at seed time. Keyed
// by the four ECONOMY EquipmentSlotType values only. The two Combat 1.0 defensive slots
// DO have varieties but are deliberately excluded here: they are auto-installed onto combat
// hulls via the Unit 1.3 path, not seeded onto every ship, which is what keeps combat parity
// and save shape untouched. Each value MUST name a real variety of its slot (asserted in
// model.test.ts).
export const DEFAULT_EQUIPMENT_VARIETY: Record<string, string> = {
  cargoBay: "balancedHold",     // neutral, no favoredSpec
  ftlDrive: "balancedDrive",    // even speed/efficiency split
  reactorCore: "balancedCore",  // middle reactor
  specUtility: "yieldRig",      // the spec slot's baseline prospecting rig
};

// --- Per-slot BASE physical characteristics (0.11.0) -------------------------
// Intrinsic mass, intrinsic power draw, and base durability BEFORE any roll or
// quality scaling. The four economy slots plus (Combat 1.0 Unit 1.1) the two defensive
// combat slots have entries; the still-reserved members (bridge/quarters/etc.) have no
// generation yet. These are the values a
// rolled massReduction / powerDrawReduction shaves DOWN from (generateEquipment,
// itemgen.ts), the base durability quality scales UP, and the mass the equipment
// fold-in (shipDerivedStats) drags speed/efficiency against. FIRST-PASS TUNABLE.
// (reactorCore's low powerDraw of 1 is intentional, not a typo: a reactor supplies
// power rather than consuming it.)
//
// MOVED here (0.11.0 Task 20) from itemgen.ts so it sits with the other slot DATA
// (EQUIPMENT_SLOTS / DEFAULT_EQUIPMENT_VARIETY) and can be read by generateStandardIssue
// below WITHOUT a model -> itemgen import cycle (itemgen already imports FROM model, so
// the reverse value import is forbidden, see the QUALITY_TIERS/CraftLine notes at the top
// of this file). itemgen.ts re-exports it, so generateEquipment and itemgen.test.ts are
// unaffected.
export const SLOT_BASE_PHYSICALS: Record<
  | "cargoBay" | "ftlDrive" | "reactorCore" | "specUtility" | "shieldEmitters" | "hullPlating" | "bridge" | "quarters" | "sensor"
  | "module" | "memberArmor" | "memberWeapon" | "memberTool" | "implant",
  { mass: number; powerDraw: number; durability: number }
> = {
  cargoBay: { mass: 10, powerDraw: 2, durability: 100 },
  ftlDrive: { mass: 8, powerDraw: 4, durability: 100 },
  reactorCore: { mass: 12, powerDraw: 1, durability: 120 },
  specUtility: { mass: 6, powerDraw: 2, durability: 90 },
  // Crew 0.14.0 (Phase 1b): base physicals for the two crew-module slots. mass 0 + powerDraw 0 by
  // deliberate design (ECONOMY-NEUTRAL, mirroring the Standard-Issue / combat-baseline posture):
  // a crew module amplifies the CREW stack, it must not stealth-drag transit speed / fuel through
  // the equipment mass fold or draw against the reactor budget. So even a crafted module folds to
  // ZERO in shipDerivedStats (its crewStations / crewEfficiency lines are unfolded, mass 0 drags
  // nothing), and ONLY the crew overlay reacts. durability is a sensible reserved base (never lost
  // this patch, does not feed shipDerivedStats). FIRST-PASS TUNABLE.
  bridge: { mass: 0, powerDraw: 0, durability: 110 },
  quarters: { mass: 0, powerDraw: 0, durability: 110 },
  // 0.14.0 SENSORS (DORMANT): base physicals for the sensor slot. mass 0 + powerDraw 0 by deliberate
  // design (ECONOMY-NEUTRAL, same rationale as the crew modules): in this dormant patch a sensor item
  // must not stealth-drag transit speed / fuel through the equipment mass fold, nor draw against the
  // reactor budget, so even a crafted sensor folds to ZERO in shipDerivedStats (its `sensors` line is
  // unfolded, mass 0 drags nothing). Real sensor power-draw / reactor-allocation is an EXPLORATION +
  // balance follow-on, tuned when the consumer lands, NOT here. durability is a sensible reserved base
  // (never lost this patch, does not feed shipDerivedStats). FIRST-PASS TUNABLE.
  sensor: { mass: 0, powerDraw: 0, durability: 100 },
  // E-MOD EM-5 (plan section 3.3: "mass 0, powerDraw per def, durability 100"): a module drags nothing through the mass
  // fold; its REAL draw is its catalog def's (UniversalModuleDef.powerDraw, applied at mint by itemgen.ts), so the slot
  // default here is 0 and never reaches a piece. durability is its wear toughness (gearWear.ts module rows).
  module: { mass: 0, powerDraw: 0, durability: 100 },
  // Combat 1.0 (Unit 1.1): base physicals for the two defensive combat slots. A shield emitter
  // draws real power (an active deflector); hull plating is heavy + passive (0 draw) with the
  // highest base durability (it is armor). FIRST-PASS TUNABLE. Read only when a combat piece is
  // generated (Unit 1.2 crafting); nothing generates one this unit, so these are inert today.
  shieldEmitters: { mass: 8, powerDraw: 6, durability: 100 },
  hullPlating: { mass: 20, powerDraw: 0, durability: 160 },
  // E-CREW 0.14.0 (Task 7): the four away-team MEMBER slots. mass 0 + powerDraw 0 by deliberate design:
  // a member piece is worn by a person, not bolted to a hull, so it has no ship mass or reactor draw
  // and can never drag a ship's speed / fuel through the equipment fold (the same economy-neutral
  // posture as the crew modules + sensors). durability is a sensible reserved base so the generic
  // generation path stays well-formed (armor wears hardest, tools least). FIRST-PASS TUNABLE.
  memberArmor: { mass: 0, powerDraw: 0, durability: 120 },
  memberWeapon: { mass: 0, powerDraw: 0, durability: 100 },
  memberTool: { mass: 0, powerDraw: 0, durability: 80 },
  implant: { mass: 0, powerDraw: 0, durability: 100 },
};

// --- Standard-Issue baseline generation (0.11.0 Task 20) ---------------------
// The stat magnitude of every Standard-Issue implicit (signature) line, AND the
// intent behind it. A Standard-Issue piece is the craft-less FLOOR that keeps a live
// slot from ever being empty so a migrated / newly-built ship stays dispatchable
// (design §2: "Standard-Issue = the quality-0 baseline version, auto-fitted, keeps a
// bare ship dispatchable").
//
// ⚠️ STAT-NEUTRAL THIS PATCH (0), a deliberate, load-bearing decision, flagged in the
// task report. The equipment-stat fold-in (shipDerivedStats) is ALREADY live on this
// 0.11.0 branch: a fitted piece's implicit lines add to cargo/speed/efficiency and
// its `mass` DRAGS speed/efficiency through the MASS_SPEED_DRAG / MASS_EFF_DRAG
// curves. Those curves are FIRST-PASS TUNABLE and were balanced against the BARE
// hull; folding a non-zero Standard-Issue (its slot base mass ~= 36 across the four
// slots) into the STARTING ship would have silently dropped its transit speed by
// ~40% and shifted every mission's timing/fuel/loot, an unrequested economy-wide
// balance REGRESSION on every existing save (and it fails the design's own "keeps a
// bare ship dispatchable" intent, a dragged ship is worse, not neutral). This task's
// job is the never-empty invariant + migration, NOT rebalancing the economy, so the
// floor contributes ZERO to derived stats this patch: shipDerivedStats(ship, [four
// stat-neutral pieces]) is bit-identical to the bare hull (implicit magnitude 0 ->
// plusToPercent(0)=0; mass 0 -> drag factor 1), so a migrated ship resolves missions
// IDENTICALLY pre/post migration. The magnitude is a single TUNABLE knob: the actual
// baseline power is a device-check-stage decision made WHEN the fold-in curves are
// tuned and the (mockup-gated) equipment UI ships, deliberately deferred to here.
// 0.14.0: the away-team MEMBER baselines are the exception. Their signature lines start here at 0 and then take
// the Quartermaster set's real stats (STANDARD_ISSUE_MEMBER_POINTS, below generateStandardIssue); ship baselines
// are untouched.
export const STANDARD_ISSUE_IMPLICIT_MAGNITUDE = 0;

// The fixed item level stamped on every Standard-Issue baseline. WHY a floor CONST (not a
// computed value): a baseline rolls nothing, so it has no craft-derived level; it is the
// quality-0, iLevel-floor version of a system. Persisting a stable floor lets the UI render
// "iL N" on baseline tiles AND pins a migrated baseline to the EXACT same iLevel a freshly
// seeded baseline gets, so the migrated and fresh shapes can never drift (the same single-source
// posture STANDARD_ISSUE_IMPLICIT_MAGNITUDE takes for the stat floor). 1, not 0: item levels are
// 1-based (the lowest real system level), so a baseline reads as a genuine level-1 floor.
export const STANDARD_ISSUE_ILEVEL = 1;

// Mint ONE Standard-Issue baseline EquipmentInstance for a live slot. blueprintKey
// null (craft-less), Standard rarity, quality 0, no ascension.
//
// DETERMINISM (load-bearing, because this runs inside a save migration where an rng
// is neither available nor reproducible): generateStandardIssue takes NO rng and
// rolls NO affixes. generateEquipment(rarity "standard") would roll TWO affix lines
// (affixCount("standard") === 2, off an injected stream), so it is deliberately NOT
// reused, even a constant rng would still ATTACH affixes, contradicting the design's
// "minimal neutral form (implicits / floor stats, no random affixes)". Instead this
// fills ONLY the slot's always-present implicit (signature) lines at the fixed floor
// magnitude above (0 this patch, see the note), rolledStats is empty, and mass /
// powerDraw contribute 0 (see the STAT-NEUTRAL note). The result is a pure function
// of (slotType, id): identical inputs always mint an identical piece, exactly what a
// re-runnable, reproducible migration requires.
//
// The slot's blessed default variety is resolved from DEFAULT_EQUIPMENT_VARIETY per
// the design ("a later task reads THIS map") and VALIDATED (a bad slot / missing
// variety throws loudly, mirroring generateEquipment's guards). Variety only biases
// AFFIX distribution, which Standard-Issue omits, so it does not change the numbers
// this patch; it is read to keep the baseline pinned to the neutral family and to
// future-proof the piece if variety ever gains an implicit role.
//
// E-CREW 0.14.0 (Task 9): an OPTIONAL explicit `varietyKey` overrides that default, for the
// away-team MEMBER slots. A member slot has no single blessed default (its varieties are split by
// squad type, so "the" Standard-Issue armor differs for Security and Science), so the caller (the
// Quartermaster's per-team requisition rows) names the variety. Two things follow the variety,
// mirroring generateEquipment exactly so a baseline is an ordinary piece of its slot:
//   - the implicit KEYS are the variety's own signature lines when it overrides them (E4d), else
//     the slot's; still every one at the floor magnitude, so the piece stays stat-neutral.
//   - the variety key is STAMPED as moduleVariant for a member slot (or a variety with its own
//     identity), since the member install gate (canFitToMember) resolves the piece's squad from it.
// Omitted (every pre-E-CREW caller), the default variety is read as before, and because no default
// economy variety carries its own identity, the minted piece is byte-identical to the old shape.
//
// durabilityMax / durability are the slot's base durability (a real, reserved value,
// durability is never lost in 0.11.0 and does NOT feed shipDerivedStats, so it is
// stat-neutral to keep). mass / powerDraw are 0 by design (see the note), NOT the
// slot base physicals, so the floor drags nothing.
//
// fittedToShipId is set by the caller (a seeded ship fits its baseline; a bare mint
// could pass null), mirroring how generateEquipment leaves fitment to the fit layer.
export function generateStandardIssue(a: {
  slotType: EquipmentSlotType;
  fittedToShipId: string | null;
  allocateId: () => string;
  // E-CREW 0.14.0 (Task 9): the variety to mint, overriding DEFAULT_EQUIPMENT_VARIETY (see the note
  // above). Required in practice for a member slot, which has no default variety.
  varietyKey?: string;
}): EquipmentInstance {
  const slotDef = EQUIPMENT_SLOTS[a.slotType];
  if (slotDef === undefined) {
    // Reserved slots have no definition this patch; a Standard-Issue cannot exist for one.
    throw new Error(`generateStandardIssue: no slot definition for "${a.slotType}" (not a live slot this patch)`);
  }
  const varietyKey = a.varietyKey ?? DEFAULT_EQUIPMENT_VARIETY[a.slotType];
  const variety = varietyKey === undefined ? undefined : slotDef.varieties.find((v) => v.key === varietyKey);
  if (variety === undefined) {
    throw new Error(`generateStandardIssue: slot "${a.slotType}" has no variety "${varietyKey}"`);
  }
  const basePhysicals = SLOT_BASE_PHYSICALS[a.slotType as keyof typeof SLOT_BASE_PHYSICALS];
  if (basePhysicals === undefined) {
    throw new Error(`generateStandardIssue: no base physicals for slot "${a.slotType}"`);
  }

  // Implicit (signature) lines ONLY, every one at the fixed floor magnitude (0 this
  // patch, stat-neutral). The KEYS are still present (a well-formed piece carries its
  // slot's signature lines), just at magnitude 0.
  // E4d / E-CREW: a variety with its own signature lines replaces the slot's (as generateEquipment does).
  const implicitStats: Record<string, number> = {};
  for (const stat of variety.implicitStats ?? slotDef.implicitStats) {
    implicitStats[stat] = STANDARD_ISSUE_IMPLICIT_MAGNITUDE;
  }

  const piece: EquipmentInstance = {
    id: a.allocateId(),
    slotType: a.slotType,
    rarity: "standard",
    ascension: "none",
    quality: 0, // Standard-Issue is always the quality-0 floor
    iLevel: STANDARD_ISSUE_ILEVEL, // the fixed item-level floor (see the const note above)
    blueprintKey: null, // craft-less baseline (see EquipmentInstance.blueprintKey)
    implicitStats,
    rolledStats: {}, // NO affixes: the deliberate "minimal neutral form" (see the note above)
    mass: 0, // stat-neutral floor (see STANDARD_ISSUE_IMPLICIT_MAGNITUDE note): drags nothing
    powerDraw: 0, // stat-neutral floor: draws nothing against the reactor budget
    durabilityMax: basePhysicals.durability, // toughness (gear wear): a fresh piece is pristine (no condition field)
    fittedToShipId: a.fittedToShipId,
  };
  // The same stamping rule generateEquipment applies (itemgen.ts): every member piece, and any variety with
  // its own identity, persists its variety key. False for every default economy variety, so the seeded
  // and migrated ship baselines gain no field.
  if (isMemberSlotType(a.slotType) || varietyHasOwnIdentity(variety)) {
    piece.moduleVariant = varietyKey;
  }
  // 0.14.0: an away-team MEMBER baseline carries its real Standard-Issue lines (STANDARD_ISSUE_MEMBER_POINTS below).
  // The SAME transform re-stats a held piece on every load (save.ts), so a minted and a migrated piece never differ.
  return withStandardIssueMemberLines(piece);
}

// ============================================================================
// QUARTERMASTER STANDARD-ISSUE MEMBER GEAR: real stats (0.14.0)
// ============================================================================
// User rulings (docs/plans/2026-10-15-safe-first-runs-plan.md, USER ANSWERS):
//   - 2026-10-16 "Tier I after the first run": comfortable Tier I = a FULL away team wearing the Quartermaster's
//     first Standard-Issue set ("Full team + upgrade").
//   - 2026-10-16 "Standard-Issue stats", verbatim: "Each piece of gear gets stats. Similar to ship systems. Except
//     with far fewer slots. [...] Weapon provides offensive stats. Armor provides defensive stats. Kit provides
//     utility and potentially stats associated with that based on the role the tool is designed for."
//   - 2026-10-16 "Member slots": "Implants X1/X2 depending on racial. Keep this as is." The free set covers Armor,
//     Weapon and Tool; implants have no Standard-Issue floor (REQUISITION_CATALOGUE.implant is null).
//   - 2026-10-21 "Fade Weak + build SI gear": about +15% squad power in the SF-3 sim meets both nominal Tier I
//     targets (a full rank 1 team completes 95% of runs and wins 90% of its Vault / Subterranean sites).
//   - 2026-10-21 review: "Floor the stat budget" (crafted member gear always rolls at least the free set's total and
//     each signature line at least the free piece's value; item level, Archive score and salvage stay as they are)
//     and "Give them Science lines" (D26: the Sidearm and Field Suit roll Science lines, so their free pieces carry
//     real stats too).
//
// HOW A PIECE'S LINES ARE SET. Every Standard-Issue member piece carries STANDARD_ISSUE_MEMBER_POINTS stat points
// (quality-less: no quality, rarity or item-level roll, the same on every piece), split over its SLOT ROLE's lines by
// the shares below. The lines are ordinary implicit lines on the instance, so every existing consumer reads them
// unchanged (the roster snapshot at dispatch: battle hp / power / armor / accuracy, fieldwork, finds, hazard; the
// tooltips). Points convert through awayTeam.ts GEAR_POINT_BUMP like any crafted line. A full Security kit (Pulse
// Rifle + Ballistic Weave + Med Kit) at 12 points: +6% power, +2.4% accuracy, +17.5% armor and +17% HP per member.
//
// ⚠️ [PROVISIONAL] the points (user 2026-10-21 asked for "about +15% squad power"; 12 is the smallest even split whose
// full set meets both targets with margin on the SF-3 ramp at full strength: 193 of 200 runs complete, 356 of 365
// Vault / Subterranean objectives won; 10 points reaches exactly 190 of 200).
export const STANDARD_ISSUE_MEMBER_POINTS = 12;

// The SLOT-ROLE shares per issued variety (the Quartermaster's per-squad rows, quartermaster.ts REQUISITION_CATALOGUE),
// each a subset of the lines its variety can roll, and each a line its squad's consumers READ (everything wired):
//   Weapon = offense, Armor = defense, Tool = the line of the role it is built for.
//   Security: Pulse Rifle     power + accuracy (its two signature lines)
//             Ballistic Weave armor + HP (the suit's defensive lines; its accuracy lean stays a crafted roll)
//             Med Kit         HP (its signature line; the heal itself still needs Medical Training, D20)
//   Science (D26, Science never fights, so its "offense" and "defense" are the work):
//             Sidearm         relic find + fieldwork (its two signature lines since the line swap)
//             Field Suit      fieldwork + hazard resist (its two signature lines since the line swap)
//             Flora Scanner   organics yield + fieldwork (its survey role, on its tuned bodies)
//   Prospecting (hidden with the squad): each piece's two signature lines, YIELD / hazard / GRADE plus FIELD.
// Shares sum to 1 per row. A variety absent here mints with its zero signature lines.
export const STANDARD_ISSUE_MEMBER_SHARES: Readonly<Record<string, Readonly<Partial<Record<MemberGroundStatKey, number>>>>> = {
  pulseRifle: { groundPower: 0.5, groundAccuracy: 0.5 },
  ballisticWeave: { groundArmor: 0.6, groundHp: 0.4 },
  medKit: { groundHp: 1 },
  sidearm: { groundRelicFind: 0.5, groundFieldwork: 0.5 },
  fieldSuit: { groundFieldwork: 0.5, groundHazardResist: 0.5 },
  floraScanner: { groundOrganicsYield: 0.5, groundFieldwork: 0.5 },
  plasmaCutter: { groundOreYield: 0.5, groundFieldwork: 0.5 },
  excavatorSuit: { groundHazardResist: 0.5, groundFieldwork: 0.5 },
  assayScanner: { groundOreGrade: 0.5, groundFieldwork: 0.5 },
};

// The Standard-Issue lines of member variety `varietyKey` (whole points, only the nonzero ones), {} for a variety with
// no row. Pure.
export function standardIssueMemberLines(varietyKey: string): Record<string, number> {
  const shares = STANDARD_ISSUE_MEMBER_SHARES[varietyKey];
  const out: Record<string, number> = {};
  if (shares === undefined) return out;
  for (const [stat, share] of Object.entries(shares)) {
    const v = Math.round(STANDARD_ISSUE_MEMBER_POINTS * (share ?? 0));
    if (v > 0) out[stat] = v;
  }
  return out;
}

// The free set's per-piece total: the most points any issued piece carries (12; 0 with no rows). The crafted budget
// floor's total (craftedMemberFloorImplicits). Derived from the table, never a second number. Pure.
export function standardIssueMemberTotal(): number {
  let best = 0;
  for (const key of Object.keys(STANDARD_ISSUE_MEMBER_SHARES)) {
    best = Math.max(best, Object.values(standardIssueMemberLines(key)).reduce((n, v) => n + v, 0));
  }
  return best;
}

// Is `piece` a Quartermaster-issued Standard-Issue MEMBER piece, exactly as the generator mints it? Stricter than
// isStandardIssueBaseline (blueprint-less + standard rarity): also the quality-0 floor, the fixed STANDARD_ISSUE_ILEVEL,
// no rolled lines and a stamped variety, so a dev-minted or test standard piece with no blueprint (any other item level,
// quality or rolled line) is never re-statted as if it were free gear. Pure.
export function isStandardIssueMemberPiece(piece: EquipmentInstance): boolean {
  return (
    isMemberSlotType(piece.slotType) &&
    isStandardIssueBaseline(piece) &&
    piece.quality === 0 &&
    piece.iLevel === STANDARD_ISSUE_ILEVEL &&
    piece.moduleVariant !== undefined &&
    Object.keys(piece.rolledStats ?? {}).length === 0
  );
}

// `piece` carrying its Standard-Issue member lines: a Quartermaster-issued member piece (isStandardIssueMemberPiece)
// has each catalog line RAISED to the catalog value (never lowered: a line already above it keeps its value); anything
// else, or a piece already at or above every line, is returned AS IS (the same reference). Used by the mint above and
// by save.ts on every load, so a piece held since before the stats gains them and a re-load is a no-op. Never touches
// rolledStats, mass, durability or any other field. Pure.
export function withStandardIssueMemberLines(piece: EquipmentInstance): EquipmentInstance {
  if (!isStandardIssueMemberPiece(piece)) return piece;
  const lines = standardIssueMemberLines(piece.moduleVariant!);
  const raise = Object.entries(lines).filter(([stat, v]) => (piece.implicitStats[stat] ?? 0) < v);
  if (raise.length === 0) return piece;
  return { ...piece, implicitStats: { ...piece.implicitStats, ...Object.fromEntries(raise) } };
}

// THE CRAFTED BUDGET FLOOR (user 2026-10-21 "Floor the stat budget"): a CRAFTED member piece of variety `varietyKey`
// (its signature lines `implicit`, its rolled affix points totalling `rolledPoints`) always carries at least the free
// set's total points and each signature line at least the free piece's value of that variety:
//   1. every signature line the variety's free piece also carries is raised to at least that value;
//   2. if the piece's total (signature + rolled) is still below standardIssueMemberTotal(), the shortfall is added to
//      the signature lines, evenly, the remainder to the first.
// Only magnitudes move: item level, quality, rarity, the affix picks and the rng draws are untouched, so the Archive
// score, salvage time and keep-best auto-salvage read the piece as before. Returns the (possibly) raised signature
// lines; the input is not mutated. Pure. Called by itemgen.ts generateEquipment (the mint) and previewCraftOutcome.
export function craftedMemberFloorImplicits(varietyKey: string, implicit: Readonly<Record<string, number>>, rolledPoints: number): Record<string, number> {
  const out: Record<string, number> = { ...implicit };
  const free = standardIssueMemberLines(varietyKey);
  for (const stat of Object.keys(out)) if (free[stat] !== undefined && out[stat] < free[stat]) out[stat] = free[stat];
  const keys = Object.keys(out);
  const total = keys.reduce((n, k) => n + out[k], 0) + rolledPoints;
  const short = standardIssueMemberTotal() - total;
  if (short > 0 && keys.length > 0) {
    const each = Math.floor(short / keys.length);
    keys.forEach((k, i) => (out[k] += each + (i === 0 ? short - each * keys.length : 0)));
  }
  return out;
}

// D26 LINE SWAP FOR HELD PIECES (user 2026-10-21 "old crafted pieces get dead lines remapped on load so nothing is
// useless"): the combat lines a Science Sidearm or Field Suit rolled before the swap, and the Science line each moves
// to, points for points (an implicit line stays implicit, a rolled one rolled; a target the piece already carries adds
// up). [PROVISIONAL] the pairing: the Sidearm's power to fieldwork and its accuracy and status chance to relic find; the
// Field Suit's armor and HP (its defense) to hazard resist. The Hazard Suit keeps any armor / HP it rolled before (on
// a Prospecting wearer they feed prospecting.ts digSafety); its new crafts no longer roll them.
export const SCIENCE_LINE_REMAP: Readonly<Record<string, Readonly<Record<string, MemberGroundStatKey>>>> = {
  sidearm: { groundPower: "groundFieldwork", groundAccuracy: "groundRelicFind", groundStatusChance: "groundRelicFind" },
  fieldSuit: { groundArmor: "groundHazardResist", groundHp: "groundHazardResist" },
};

// `piece` with its pre-swap combat lines moved (SCIENCE_LINE_REMAP), or the same reference when it has none (every
// other piece, and a swapped piece on a re-load). Any blueprint, rarity or quality. Pure.
export function withScienceLineSwap(piece: EquipmentInstance): EquipmentInstance {
  const remap = piece.moduleVariant === undefined || !isMemberSlotType(piece.slotType) ? undefined : SCIENCE_LINE_REMAP[piece.moduleVariant];
  if (remap === undefined) return piece;
  const move = (lines: Record<string, number>): Record<string, number> | null => {
    if (!Object.keys(lines).some((k) => k in remap)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(lines)) {
      const to = remap[k] ?? k;
      out[to] = (out[to] ?? 0) + v;
    }
    return out;
  };
  const implicitStats = move(piece.implicitStats);
  const rolledStats = move(piece.rolledStats ?? {});
  if (implicitStats === null && rolledStats === null) return piece;
  return { ...piece, implicitStats: implicitStats ?? piece.implicitStats, rolledStats: rolledStats ?? piece.rolledStats };
}

// The ONE shared "fit a ship out with its baseline floor" helper (Omega 4, DRY):
// mint a Standard-Issue piece for EVERY live slot, all fitted to the given ship, so
// the ship is born fully equipped and no live slot is ever empty. Used by BOTH the
// v27->v28 save migration (existing ships, save.ts) AND every live ship-creation
// path (freshState below, the shipBuild completion + captain-slot-unlock hull grant
// in tick.ts), so the migrated and live shapes can never drift apart, the same
// single-source posture freshLifetimeStats already establishes.
//
// The live slots are enumerated from DEFAULT_EQUIPMENT_VARIETY's keys (its members
// ARE the four live slots). Object key order is insertion order in ES2015+, so the
// mint order (and therefore the id assignment) is DETERMINISTIC, which the migration
// relies on for reproducibility. Ids are allocated from `startId` (normally the
// ship's state.nextEquipmentId), one per minted piece, and the advanced next id is
// returned so the caller threads the monotonic counter forward exactly like every
// other id-minting site (nextShipId / nextEquipmentId). PURE: builds fresh records +
// the advanced id, mutates nothing.
export function seedStandardIssueForShip(
  shipId: string,
  startId: number
): { pieces: EquipmentInstance[]; nextId: number } {
  const pieces: EquipmentInstance[] = [];
  let nextId = startId;
  for (const slotType of Object.keys(DEFAULT_EQUIPMENT_VARIETY) as EquipmentSlotType[]) {
    const mintedId = nextId; // capture before advancing so allocateId names THIS id
    pieces.push(
      generateStandardIssue({
        slotType,
        fittedToShipId: shipId,
        allocateId: () => `equip-${mintedId}`,
      })
    );
    nextId += 1;
  }
  return { pieces, nextId };
}

// --- Combat Standard-Issue baseline generation (Combat 1.0, Unit 1.3) --------
// The combat parallel to generateStandardIssue / seedStandardIssueForShip above. Every
// combat hull (destroyer/battleship/carrier) is born and migrates with a free Standard-Issue
// COMBAT set installed (one weapon + one shield emitter + one hull plating) so it is ALWAYS
// dispatchable, exactly as the economy Standard-Issue floor keeps the four economy slots
// filled. The empty-required-slot dispatch blocker (tick.ts canDispatchPatrol) therefore only
// fires when a player DELIBERATELY strips a required slot (reachable once the install UI lands
// in a later unit).
//
// ⚠️ BEHAVIOR-PRESERVING PER-HULL magnitudes (Combat 1.0 Unit 1.4, REVISED from the Unit 1.3
// first-pass placeholders). The Standard-Issue combat set is authored to reproduce each hull's
// CURRENT (pre-gear) combat profile EXACTLY, so a Standard-Issue-geared ship folds to a combatant
// byte-identical to the old hull-default combatant and combat outcomes do not move (the Unit 1.4
// parity re-baseline is a no-op; the deliberate power-curve retune is Unit 1.6). Because the target
// numbers are PER-HULL (a destroyer's shield != a battleship's), the magnitudes are no longer a
// module const here: the CALLER (tick.ts, which imports both SHIP_TYPES and COMBAT_DEFAULT_LOADOUT)
// resolves each hull's shieldCapacity / shieldRecharge / hullStrength + its full weapon loadout and
// passes them IN. This keeps model.ts from importing combat internals (combatHullTypeOf /
// COMBAT_DEFAULT_LOADOUT / the frame-HP split), preserving the repo-wide "model never imports combat
// at runtime" rule. See seedCombatStandardIssueForShip below for the caller contract.
//
// The Standard-Issue weapon adds NO yield bonus: the real per-shot combat stats come from the base
// WEAPON_DEFS[weaponType] def (yield/accuracy/range/effect slots), which the Unit 1.4 bridge
// reconstructs; the baseline weapon only OCCUPIES the hardpoint so the hull is armed + dispatchable.
export const COMBAT_STANDARD_ISSUE_WEAPON_YIELD = 0; // no bonus: base WEAPON_DEF carries the real stats

// The weapon baseline's durability ceiling. Mirrors combat/weapons.ts BASE_WEAPON_DURABILITY (100)
// at quality 0. A small DELIBERATE duplication (a literal, not a runtime import of the value) so
// model.ts keeps its "never import combat internals at runtime" discipline (see the type-only combat
// imports at the top of this file). It is behavior-neutral: the Unit 1.4 bridge reconstruction reads
// this durabilityMax and a Standard-Issue weapon (durability == durabilityMax == 100) reconstructs
// byte-identically to makeWeaponInstance (whose template durability is also 100).
export const COMBAT_STANDARD_ISSUE_WEAPON_DURABILITY = 100; // == combat/weapons.ts BASE_WEAPON_DURABILITY

// The Standard-Issue DRONE POD adds NO droneHp bonus (Combat 1.0 Unit 2.3a). The per-drone combat
// stats (hp/family/accuracy/yield/range/evasion/cooldown + the defensive fields) come from the drone
// ROLE_TEMPLATE[role], which the Unit 2.3a bridge (squadronFromPod) reconstructs; the baseline pod
// only OCCUPIES a bay so a carrier fields its default squadron. droneHp is the pod's SIGNATURE line
// (the drone analogue of weaponYield, see itemgen.generateDronePod), so a 0 signature is the
// behavior-preserving floor: squadronFromPod(a Standard-Issue attack pod) reconstructs
// BYTE-IDENTICALLY to makeSquadron("attack", undefined, 0), the carrier's current default squadron.
export const COMBAT_STANDARD_ISSUE_DRONE_HP = 0; // no bonus: base ROLE_TEMPLATE carries the real stats

// The drone-pod baseline's durability ceiling. Mirrors itemgen.ts DRONE_POD_BASE_DURABILITY (100) at
// quality 0, a small DELIBERATE literal duplication (not a runtime import) so model.ts keeps its
// "never import combat/itemgen internals at runtime" discipline. Behavior-neutral: a DroneSquadron
// carries NO durability field, so a pod's durability never enters squadronFromPod's reconstruction
// (unlike a weapon, whose durability the bridge DOES read); it exists only so the pod is a well-formed
// wearable item like every other combat baseline.
export const COMBAT_STANDARD_ISSUE_DRONE_DURABILITY = 100; // == itemgen.ts DRONE_POD_BASE_DURABILITY

// ---------------------------------------------------------------------------
// DEFENSE COMPOSITION: SHIELD REFERENCES + SI-GEAR FIXED DIALS
// (combat-defense rework, design addendum 2026-08-27; HYBRID model, user-locked 2026-08-27).
//
// THE MODEL is HYBRID by defensive stat, because a user-locked decision requires a bare hull to keep a
// nonzero bare frame (a ship without plating is armored, not an exposed space frame), while shields have
// no source without an emitter.
//
//   HULL is ADDITIVE. hull = innateHullArmor + installed plating.hullStrength, where the hull's own bare
//   frame innateHullArmor = authoredHullIntegrity - SI_PLATING_HP. With NO plating the hull is still the
//   nonzero innateHullArmor (never 0). SI_PLATING_HP is a small FIXED floor (100), the SAME on every hull.
//
//   SHIELD CAPACITY + RECHARGE are MULTIPLICATIVE via an EFFECTIVENESS ratio. Each has a fixed REFERENCE
//   REF_S (the authored value of the representative MID combat hull), and effectiveness_S = authoredValue_S
//   / REF_S (freely below or above 100%: a glass hull < 100%, a capital hull > 100%). SI gear provides
//   EXACTLY REF_S for its stat, and the fold multiplies the INSTALLED emitter's raw stat by the hull's
//   effectiveness: finalStat_S = installedGear_S * effectiveness_S(hull). With NO emitter the shield is 0
//   (an emitter is the shield SOURCE). This REPLACES the retired LARGE 1+mult shield multiplier (up to x5)
//   whose amplification compounded a crafted emitter + its affixes into runaway shields; the effectiveness
//   ratio is the intuitive, tame lever (roster ~0.5x to 2.0x, never x5).
//
// THE SHIELD REFERENCE CHOICE. The reference is the DESTROYER (the mid combat hull, roster median) for
// shield capacity, so it reads exactly 100%. For shield RECHARGE the destroyer is the deliberate fast-regen
// outlier (its "quick shields" identity, authored 10, the roster max), so the reference is the roster MEDIAN
// recharge (6, shared by the miner + battleship). Resulting per-hull shield effectiveness across the current
// 7-hull roster (SHIP_TYPES): shield cap 50% (runner) .. 200% (battleship), recharge 67% .. 167%. The mid
// combat hull reads ~100% on both.
//
// BYTE-IDENTITY (why parity + balance fixtures do not move). An SI ship's plating hullStrength == SI_PLATING_HP,
// so hull = (authored - SI_PLATING_HP) + SI_PLATING_HP == authored EXACTLY (additive, integer-exact). Its
// emitter's raw stat == REF_S, so shield = REF_S * (authored / REF_S) == authored EXACTLY (the REF*(authored/REF)
// round-trip is exact for every current roster value; verified in bridge.test.ts, no rounding applied). So an
// SI ship recomposes to today's authored numbers and combat is byte-identical for SI sets; only CRAFTED gear gains.
//
// ANTI-CHEAT SEAM (comment only, NOT built): for the MULTIPLICATIVE stats (shield cap + recharge), the roster's
// MAXIMUM effectiveness together with the crafted-defense curve caps (itemgen.ts CRAFTED_DEFENSE_CAP_* /
// CRAFTED_DEFENSE_RECHARGE_*) defines the MAXIMUM LEGITIMATE folded value (max legit = maxCraftedGear_S *
// maxEffectiveness_S). A future item-legitimacy pass (0.14.0 online / anti-cheat) can flag any shield item or
// folded shield stat exceeding that ceiling. Hull is additive (no effectiveness ceiling there). No validation today.
//
// ⚠️ FIRST-PASS + TUNABLE (design 11): the 0.16.0 balance pass may re-dial. These live in model.ts (not the
// combat leaf) because the SI-gear SEED reads the dials (tick.ts combatStandardIssueSpecFor mints the baselines
// at these magnitudes) and model.ts owns the item-mint constants; the bridge imports the shield references to
// keep the effectiveness derivation on ONE source of truth (change a value here and both the seed and the fold move).

// REF_S: the SHIELD reference (mid combat hull) authored value. The divisor in effectiveness_S =
// authoredValue_S / REF_S. Hull is additive and has NO reference (its identity is innateHullArmor).
export const REF_SHIELD_CAPACITY = 300; // destroyer's shieldCapacity (mid combat hull)
export const REF_SHIELD_RECHARGE = 6;   // roster-median shieldRecharge (destroyer's 10 is the fast-regen outlier)

// SI plating carries a small FIXED hull floor (additive: added to the bare frame). SI emitter provides EXACTLY
// each shield reference, so an SI shield fold reproduces the hull's authored value.
export const SI_PLATING_HP = 100;                      // fixed SI hull-plating hullStrength (additive floor), same on every hull
export const SI_EMITTER_CAP = REF_SHIELD_CAPACITY;     // fixed SI shield-emitter shieldCapacity, same on every hull
export const SI_EMITTER_RECHARGE = REF_SHIELD_RECHARGE; // fixed SI shield-emitter shieldRecharge, same on every hull

// Mint ONE combat Standard-Issue baseline EquipmentInstance for a combat slot (weapon /
// shieldEmitters / hullPlating). Same DETERMINISTIC, rng-free, affix-free posture as
// generateStandardIssue (it runs inside a save migration where no reproducible rng exists). The
// per-slot signature magnitudes are passed IN by the caller (Unit 1.4, see the note above): a weapon
// carries its weaponType + a 0 yield bonus; a shield emitter carries the fixed SI cap + recharge
// (REF_SHIELD_CAPACITY / REF_SHIELD_RECHARGE, MULTIPLIED by the hull's shield effectiveness in the fold);
// hull plating carries the fixed SI hullStrength (SI_PLATING_HP = 100, ADDED to the hull's bare frame).
//
// ECONOMY-NEUTRAL (load-bearing, proven by a test): mass 0 + powerDraw 0. shipDerivedStats folds
// ONLY the economy stat keys (cargoCapacity/fuelCapacity/transitSpeedMult/engineEfficiency/
// extractionYieldMult) and DRAGS speed by total fitted MASS; the combat stat keys are not in that
// fold. So at mass 0 a combat baseline contributes ZERO to every economy-derived stat, and
// installing it leaves shipDerivedStats byte-identical to the bare hull (the offline==live parity
// fuzz stays green). durabilityMax/durability come from a sensible base (the slot's base durability
// for shield/plating; COMBAT_STANDARD_ISSUE_WEAPON_DURABILITY for a weapon), a reserved value that
// also does not feed shipDerivedStats.
//
// PURE: a function of (slotType, weaponType, the passed magnitudes, id, fittedToShipId); identical
// inputs mint an identical piece, exactly what a re-runnable migration requires.
export function generateCombatStandardIssue(a: {
  slotType: "weapon" | "shieldEmitters" | "hullPlating" | "droneBay";
  weaponType?: WeaponId; // REQUIRED iff slotType === "weapon" (the hull's signature gun); absent otherwise
  // The squadron ROLE a drone-pod baseline deploys (Combat 1.0 Unit 2.3a). REQUIRED iff slotType ===
  // "droneBay" (the drone analogue of weaponType: the base ROLE_TEMPLATE[role] carries the real
  // per-drone stats, this only names WHICH role); absent for every other slot.
  droneRole?: DroneRole;
  // The per-hull signature magnitudes the caller resolves (Unit 1.4). REQUIRED for their slot:
  // shieldCapacity + shieldRecharge for a shield emitter; hullStrength for hull plating. Absent for
  // a weapon (its yield bonus is always 0; the base WEAPON_DEF carries the real stats) and for a
  // drone pod (its droneHp bonus is always 0; the base ROLE_TEMPLATE carries the real stats).
  shieldCapacity?: number;
  shieldRecharge?: number;
  hullStrength?: number;
  fittedToShipId: string | null;
  allocateId: () => string;
}): EquipmentInstance {
  if (a.slotType === "weapon" && a.weaponType === undefined) {
    // A weapon baseline must know WHICH gun it is (its combat stats come from that base def).
    throw new Error(`generateCombatStandardIssue: slotType "weapon" requires a weaponType`);
  }
  if (a.slotType === "droneBay" && a.droneRole === undefined) {
    // A drone-pod baseline must know WHICH role it fields (its combat stats come from that template).
    throw new Error(`generateCombatStandardIssue: slotType "droneBay" requires a droneRole`);
  }
  // Durability base: the weapon const for a weapon, the drone-pod const for a pod, else the slot's
  // reserved base (shield/plating). droneBay + weapon have NO SLOT_BASE_PHYSICALS entry (they are not
  // economy slots; their bases live as combat consts here), so both are special-cased first.
  const durabilityBase =
    a.slotType === "weapon"
      ? COMBAT_STANDARD_ISSUE_WEAPON_DURABILITY
      : a.slotType === "droneBay"
        ? COMBAT_STANDARD_ISSUE_DRONE_DURABILITY
        : SLOT_BASE_PHYSICALS[a.slotType].durability;

  // The slot's signature implicit lines at the passed per-hull magnitudes. A fresh object per call
  // (never a shared module map). The KEYS match each slot's signature stat (weaponYield / droneHp /
  // shieldCapacity+shieldRecharge / hullStrength), so a baseline is a well-formed piece of its slot;
  // the Unit 1.4/2.3a bridge reads these off the fitted piece.
  let implicitStats: Record<string, number>;
  if (a.slotType === "weapon") {
    implicitStats = { weaponYield: COMBAT_STANDARD_ISSUE_WEAPON_YIELD };
  } else if (a.slotType === "droneBay") {
    // Drone pod: droneHp is the signature line (see itemgen.generateDronePod); the Standard-Issue
    // bonus is 0 so squadronFromPod reconstructs the carrier's default squadron byte-identically.
    implicitStats = { droneHp: COMBAT_STANDARD_ISSUE_DRONE_HP };
  } else if (a.slotType === "shieldEmitters") {
    if (a.shieldCapacity === undefined || a.shieldRecharge === undefined) {
      throw new Error(`generateCombatStandardIssue: shieldEmitters requires shieldCapacity + shieldRecharge`);
    }
    implicitStats = { shieldCapacity: a.shieldCapacity, shieldRecharge: a.shieldRecharge };
  } else {
    // hullPlating
    if (a.hullStrength === undefined) {
      throw new Error(`generateCombatStandardIssue: hullPlating requires hullStrength`);
    }
    implicitStats = { hullStrength: a.hullStrength };
  }

  const piece: EquipmentInstance = {
    id: a.allocateId(),
    slotType: a.slotType,
    rarity: "standard",
    ascension: "none",
    quality: 0, // Standard-Issue is always the quality-0 floor
    iLevel: STANDARD_ISSUE_ILEVEL, // same fixed item-level floor the economy baseline uses
    blueprintKey: null, // craft-less baseline
    implicitStats,
    rolledStats: {}, // NO affixes: the minimal neutral floor
    mass: 0, // economy-neutral (see the note): drags nothing through MASS_SPEED_DRAG
    powerDraw: 0, // economy-neutral: draws nothing against the reactor budget
    durabilityMax: durabilityBase,
    fittedToShipId: a.fittedToShipId,
  };
  // weaponType lives ONLY on a weapon piece (the guard above proves it is defined here).
  if (a.weaponType !== undefined) piece.weaponType = a.weaponType;
  // droneRole lives ONLY on a drone-pod piece (the guard above proves it is defined for a droneBay).
  if (a.droneRole !== undefined) piece.droneRole = a.droneRole;
  return piece;
}

// The Standard-Issue combat magnitudes the caller resolves and passes in (Combat 1.0 Unit 1.4,
// REVISED by the combat-defense rework 2026-08-27). Grouped as one object so the seeder's signature
// stays readable as the loadout grows. The CALLER (tick.ts) derives every field:
//   signatureWeapons <- COMBAT_DEFAULT_LOADOUT[hull].weapons        (the FULL default loadout, in order)
//   droneRoles       <- COMBAT_DEFAULT_LOADOUT[hull].droneRoles     (Unit 2.3a; carrier ["attack"], else [])
//   shieldCapacity   <- SI_EMITTER_CAP        (FIXED dial == REF_SHIELD_CAPACITY, same on every hull; the
//                                              emitter is then MULTIPLIED by the hull's shield-cap effectiveness)
//   shieldRecharge   <- SI_EMITTER_RECHARGE   (FIXED dial == REF_SHIELD_RECHARGE; multiplied by recharge effectiveness)
//   hullStrength     <- SI_PLATING_HP         (FIXED dial == 100; ADDED to the hull's bare frame innateHullArmor)
// The magnitudes are no longer per-hull (that was the BUG-U6 floor): each hull's defense identity now
// lives in its bare frame (innateHullArmor, additive) + its shield EFFECTIVENESS ratios (bridge.ts
// hullDefenseComposition), calibrated so an SI set still recomposes to the hull's exact pre-gear totals
// (byte-identical; see the proof in combat/bridge.ts).
export interface CombatStandardIssueSpec {
  // The hull's FULL default weapon loadout, in order (one baseline weapon minted per entry). Empty
  // => NOT a combat hull => the seeder mints nothing (a clean no-op for an economy hull).
  signatureWeapons: WeaponId[];
  // The hull's default drone-pod roles, in order (Combat 1.0 Unit 2.3a; one Standard-Issue drone pod
  // minted per entry, in a bay). A CARRIER is ["attack"] (its one built-in attack squadron); a
  // destroyer/battleship is [] (no bays). Empty for a non-combat hull too (it mints nothing anyway).
  droneRoles: DroneRole[];
  shieldCapacity: number;
  shieldRecharge: number;
  hullStrength: number;
}

// The combat parallel to seedStandardIssueForShip: mint the required combat baselines for a hull
// (ONE weapon per loadout entry, then the shield emitter, then hull plating), all fitted to shipId,
// ids allocated from startId (capture-then-advance, exactly like the economy seeder), in a
// DETERMINISTIC mint order (all weapons in loadout order, then shieldEmitters, then hullPlating) the
// migration relies on for reproducibility.
//
// COMBAT-HULL GATE lives on the CALLER, encoded as `spec.signatureWeapons`: the caller resolves the
// hull's loadout + per-hull magnitudes via combatHullTypeOf + COMBAT_DEFAULT_LOADOUT + SHIP_TYPES +
// the combat frame-HP split (all combat/ values it already imports) and passes them in, OR passes an
// EMPTY signatureWeapons for a non-combat hull. WHY the caller and not this function: keeping the
// combatHullTypeOf / COMBAT_DEFAULT_LOADOUT / frameHp lookups out of model.ts preserves the repo-wide
// "model.ts never imports combat internals at runtime" rule (the combat leaf modules import model, so
// a value import back is a cycle risk; see the type-only combat imports at the top of this file). An
// empty signatureWeapons => NOT a combat hull => mint NOTHING (return {pieces:[], nextId:startId}), so
// an economy hull is a clean no-op and this can be called unconditionally. PURE: builds fresh records
// + the advanced id, mutates nothing.
export function seedCombatStandardIssueForShip(
  shipId: string,
  spec: CombatStandardIssueSpec,
  startId: number
): { pieces: EquipmentInstance[]; nextId: number } {
  // Non-combat hull (or an unresolvable one): mint nothing, thread the id straight through.
  if (spec.signatureWeapons.length === 0) return { pieces: [], nextId: startId };

  const pieces: EquipmentInstance[] = [];
  let nextId = startId;
  // Fixed mint order so the id assignment is deterministic across a fresh build and a migration:
  // every weapon in loadout order, THEN the shield emitter, THEN hull plating, THEN every drone pod
  // in role order (Combat 1.0 Unit 2.3a). The drone pods come LAST so the pre-2.3a id sequence
  // (weapon/shield/plating) is unchanged: a save that already carries those keeps their ids, and the
  // v34->v35 migration only appends the new drone pod (no id renumbering).
  const specs: {
    slotType: "weapon" | "shieldEmitters" | "hullPlating" | "droneBay";
    weaponType?: WeaponId;
    droneRole?: DroneRole;
    shieldCapacity?: number;
    shieldRecharge?: number;
    hullStrength?: number;
  }[] = [
    ...spec.signatureWeapons.map((weaponType) => ({ slotType: "weapon" as const, weaponType })),
    { slotType: "shieldEmitters", shieldCapacity: spec.shieldCapacity, shieldRecharge: spec.shieldRecharge },
    { slotType: "hullPlating", hullStrength: spec.hullStrength },
    ...spec.droneRoles.map((droneRole) => ({ slotType: "droneBay" as const, droneRole })),
  ];
  for (const s of specs) {
    const mintedId = nextId; // capture before advancing so allocateId names THIS id
    pieces.push(
      generateCombatStandardIssue({
        slotType: s.slotType,
        weaponType: s.weaponType,
        droneRole: s.droneRole,
        shieldCapacity: s.shieldCapacity,
        shieldRecharge: s.shieldRecharge,
        hullStrength: s.hullStrength,
        fittedToShipId: shipId,
        allocateId: () => `equip-${mintedId}`,
      })
    );
    nextId += 1;
  }
  return { pieces, nextId };
}

// ============================================================================
// Equipment storage cap (spare systems only), 0.11.0 Storage/Salvage Task B1.
// (docs/plans/2026-07-18-storage-salvage-0.11.0-design.md §1.)
//
// state.equipment is otherwise UNBOUNDED. This caps how many SPARE (unfitted,
// crafted) systems the fleet may hold. It is DERIVED on read from a stored LEVEL: a
// BASE cap PLUS a flat slotIncrement for every REACHED upgrade rung (a LINEAR +25
// track, not the doubling the material warehouse uses, chosen at the device-test
// stage because a predictable "+25 per upgrade" reads far more clearly to the player
// than an exponential cap). The cap is COMPUTED, never a stored number, so the
// surfaced "spare X / cap" can never drift from the real limit.
//
// WHY spares only (design §1): a FITTED system lives on its ship and is "in use";
// a Standard-Issue baseline (blueprintKey null) is auto-managed by the never-empty
// invariant. Neither consumes storage, so ONLY unfitted CRAFTED systems count.
//
// SOFTLOCK RELIEF (design §1): a full store is never a dead end. Task C1's SALVAGE
// (consume any spare system, no cap check) always frees a slot, and Task B2's
// storage UPGRADE raises the cap; both relieve this. Their softlock-guard tests
// belong to C1/B2 (salvage does not exist yet), not to this task.
// ============================================================================

// The level-0 spare-storage cap (design §1: "a first-pass number, e.g. 25,
// device-check tunable"). ADDED to by reached upgrade rungs; at level 0 it IS the
// effective cap.
export const EQUIPMENT_STORAGE_CAP_BASE = 25;

// One rung of the equipment-storage upgrade track = the requirements to reach the
// NEXT storage level. Shape MIRRORS the material warehouse's FacilityUpgradeDef
// (materials + durationTicks + a cap effect), so an equipment-storage upgrade reads
// like every other storage-cap upgrade in the game:
//   - slotIncrement : the FLAT number of extra spare slots this rung adds when it is
//     REACHED (equipmentStorageCap SUMS one per reached rung). WHY additive, not a
//     multiplier: the device-test feedback asked for a LINEAR "+25 slots per upgrade"
//     ladder (25 -> 50 -> 75 -> ...) instead of the warehouse's doubling, because a
//     flat, predictable step is far easier for the player to reason about than an
//     exponential cap. Flat field here (not nested in an `effect`) because this
//     standalone track carries ONLY a cap effect, so it stays top-level rather than
//     reproduce FacilityUpgradeEffect's union.
//   - materials    : spent ATOMICALLY at upgrade START (startEquipmentStorageUpgrade
//     delegates to startProcess, the SAME deduct-at-start the warehouse upgrade uses).
//   - durationTicks: the upgrade is TIMED (a TimedProcess), mirroring the warehouse /
//     fuel-depot cap upgrades, NOT an instant buy. See EQUIPMENT_STORAGE_RUNGS below.
export interface EquipmentStorageRung {
  slotIncrement: number;
  materials: Record<string, Decimal>;
  durationTicks: number;
}

// The equipment-storage upgrade RUNGS: each reached rung ADDS its slotIncrement to the
// base cap (a flat +25 per rung), so the cap climbs LINEARLY. This deliberately DIVERGES
// from a material warehouse track's { storageCapMult } doubling: the device-test feedback
// wanted a predictable "+25 slots per upgrade" ladder over an exponential one. B1 shipped
// this EMPTY (base 25 at every level); B2 filled it with a doubling first-pass; this pass
// (device-test rework) replaces that with the linear +25 track.
//
// MECHANISM MIRRORED (documented design choice, task B2 §2): the material warehouse
// raises its cap via a TIMED facility-upgrade process (startFacilityUpgrade pushes a
// facilityUpgrade TimedProcess whose completion bumps the facility LEVEL). B1
// deliberately stored equipment storage as a STANDALONE GameState.equipmentStorageLevel
// (NOT a facility, so the frozen v29 migration already seeds it), so this track cannot
// literally reuse startFacilityUpgrade (that bumps facilities[key].level). Instead it
// follows THIS codebase's established "add a process-driven action" convention (the
// SAME shape researchProject / fabricateJob / shipBuild each used): a dedicated
// TimedProcessKind ("equipmentStorageUpgrade") + a ProcessEffect ("equipmentStorageLevelUp")
// + a canX/startX pair (tick.ts) that delegate to the shared startProcess engine. The
// player experience is therefore IDENTICAL to a warehouse cap upgrade (spend materials,
// wait durationTicks, level rises, cap climbs), which is why the upgrade is TIMED, not an
// instant buy. A DIFFERENT choice (instant credits-purchase) was rejected because every
// existing storage-cap upgrade in the game is timed; matching them keeps the feel
// consistent (task B2 self-review: "matches the existing storage-upgrade pattern").
//
// FIRST-PASS TUNABLE (device-check stage does real balance): a finite 7-rung track that
// ADDS a flat +25 slots each rung, so the cap climbs LINEARLY 25 -> 50 -> 75 -> 100 ->
// 125 -> 150 -> 175 -> 200 (base + 7 rungs). Cost = titaniumIngot (the equipment-tier
// refined material equipment itself is built from, so the storage bay closes an
// equipment-economy loop the way the refinery track closes an ore loop) + a commonOre
// base, BOTH escalating with the level, and an escalating durationTicks in the
// warehouse/fuel-depot ballpark. GENERATED by a loop so every rung is pure formula (no
// hand-tuned magic numbers to drift), exactly like buildWarehouseT1Upgrades.
export const EQUIPMENT_STORAGE_RUNGS: EquipmentStorageRung[] = buildEquipmentStorageRungs();

// Builds the finite equipment-storage upgrade track. Rung i (level i -> i+1):
//   - slotIncrement 25 : adds a flat 25 slots (base 25 + 25*(i+1) after reaching rung i).
//   - materials        : titaniumIngot 20 * (i+1) + commonOre 500 * (i+1), a LINEAR cost
//     escalation to match the now-linear cap (a 2^i doubling would explode across 7 rungs
//     while the cap only steps +25), keeping the SAME "cost climbs with the level" posture
//     the doubling track had, just on a gentler curve suited to more rungs.
//   - durationTicks    : 60 + 30*i (60, 90, ... 240), escalating, TUNABLE placeholder.
// Kept as a named builder (not an inline literal) so the formula is the single source
// of truth and extending the track is a one-line COUNT bump, mirroring the warehouse.
function buildEquipmentStorageRungs(): EquipmentStorageRung[] {
  const RUNG_COUNT = 7; // base 25 + 7 rungs of +25 -> a 25..200 linear ladder
  const rungs: EquipmentStorageRung[] = [];
  for (let i = 0; i < RUNG_COUNT; i++) {
    const scale = i + 1; // 1, 2, 3, ...: cost grows LINEARLY with the level (matches the linear cap)
    rungs.push({
      slotIncrement: 25, // flat +25 spare slots per rung (device-test rework: linear, not doubling)
      materials: {
        titaniumIngot: new Decimal(20 * scale),
        commonOre: new Decimal(500 * scale),
      },
      durationTicks: 60 + 30 * i, // 60, 90, ... 240 (warehouse/fuel-depot ballpark)
    });
  }
  return rungs;
}

// ============================================================================
// Docks capacity upgrade (Fleet Management): raise the max ships the docks hold.
//
// GameState.shipStorageCapacity (base 8, a STORED field) caps the fleet at ship
// build (canStartShipBuild -> "storageFull"). This block adds a TIMED, costed
// "Expand Docks" upgrade that raises that cap by +1 per rung, MIRRORING the
// equipment Systems-Bay upgrade (a timed process that spends at start and bumps a
// stored value at completion).
//
// DELIBERATE DIVERGENCE from the equipment track (the reason there is no derived
// cap helper here): equipment stores a LEVEL and DERIVES its cap via
// equipmentStorageCap. The docks cap has no such indirection, shipStorageCapacity
// IS the cap and IS the single source of truth (canStartShipBuild reads it
// directly), so the completion effect mutates that field in place (+1). The
// current rung INDEX is therefore DERIVED from the field itself
// (shipStorageCapacity - SHIP_DOCKS_BASE), so no separate level field is stored
// and the two can never drift.
// ============================================================================

// The base docks capacity a brand-new fleet starts with. MUST match freshState's
// shipStorageCapacity seed (and the field's documented starter cap); named here so
// the rung-index math (shipStorageCapacity - SHIP_DOCKS_BASE) has a single source
// rather than a hand-copied 8.
export const SHIP_DOCKS_BASE = 8;

// One rung of the docks-expansion track = the requirements to raise the cap by ONE
// berth. Shape MIRRORS a ship buildRecipe (credits + component materials +
// durationTicks), so an expansion reads like the hull-building economy it feeds:
//   - credits      : a flat credit sink, deducted ATOMICALLY at start (like a
//     facility rung's optional credit cost).
//   - materials    : component cost, spent ATOMICALLY at start via startProcess
//     (the SAME deduct-at-start every timed upgrade uses).
//   - durationTicks: the upgrade is TIMED (a TimedProcess), mirroring the warehouse
//     / fuel-depot / equipment-bay cap upgrades, NOT an instant buy.
export interface ShipDocksRung {
  credits: Decimal;
  materials: Record<string, Decimal>;
  durationTicks: number;
}

// The docks-expansion RUNGS: each reached rung ADDS +1 to shipStorageCapacity, so the
// cap climbs LINEARLY 8 -> 9 -> ... -> 16 (base + 8 rungs). GENERATED by a loop so
// every rung is pure formula (no hand-tuned magic numbers to drift), exactly like
// buildEquipmentStorageRungs. FIRST-PASS TUNABLE (real balance is a later pass):
//   - credits        : 2000 * (i+1) -> 2000, 4000, ... 16000, a linear escalation so
//     each later berth is a bigger sink (the docks feed the hull economy, whose builds
//     cost ~500-1400 credits, so an expansion is deliberately pricier than one hull).
//   - structuralAssembly : 3 * (i+1) -> 3, 6, ... 24, the SAME rare component ship
//     buildRecipes cost, so expanding the docks closes the same structural-component
//     loop hull-building does (a thematic + economic tie to what the berths hold).
//   - durationTicks  : 300 + 60*i -> 300, 360, ... 720, escalating, in the ship-build
//     ballpark (a hull builds in 300-700 ticks).
export const SHIP_DOCKS_RUNGS: ShipDocksRung[] = buildShipDocksRungs();

// Builds the finite docks-expansion track. Rung i raises the cap from
// SHIP_DOCKS_BASE + i to SHIP_DOCKS_BASE + i + 1. Kept as a named builder (not an
// inline literal) so the formula is the single source of truth and extending the
// track is a one-line COUNT bump, mirroring buildEquipmentStorageRungs.
// ============================================================================
// TRANSIT BERTHS (Infrastructure 0.13.4, Phase 3, design section 5)
//
// A SECOND, INDEPENDENT docking capacity: a returning extraction ship needs a free
// transit berth before it can dock and unload.
//
// The shape mirrors the docks track directly above it, because that is the closest thing
// in the repo and the two will later be re-homed together under the Starbase.
//
// PLAYER-FACING NAMES (design section 17.1 Q1): this is a TRANSIT BERTH. The docks
// capacity above is a DRYDOCK BERTH. Two berth types, one shared noun.
//
// THEY NEVER ADD, NEVER MULTIPLY AND NEVER SHARE A POOL (design section 3, locked). A
// drydock berth holds a PARKED HULL indefinitely; a transit berth is occupied by a PHASE
// that always ends. Conflating them is the single most likely misreading of this feature.
// ============================================================================

// The level-0 berth count, and the FLOOR nothing can lower. See transitBerthCount in
// berths.ts for the softlock proof this constant anchors.
//
// ⚠️ WHY 2 AND NOT THE 4 IN THE USER'S EXAMPLE (design 5.3, answered 17.1 Q2). Their
// example assumed 10 reachable captains. MAX_UNLOCKABLE_CAPTAINS is 4 today (1 plus three
// unlockCaptainSlot nodes), so at base 4 NO ship would ever wait and the feature would ship
// inert with an upgrade track that sells nothing.
//
// ⚠️ IT IS ALSO A PARITY CONSTRAINT, NOT ONLY A BALANCE ONE. The base must be at least the
// largest number of simultaneously returning extraction ships in any existing parity
// fixture, or those fixtures change behavior and the 101 baseline moves. The mission
// fixtures use at most TWO mission captains at once, so 2 sits exactly on the boundary.
// That is safe but TIGHT. If a fixture ever moves, RAISE THE BASE TO 3; never re-baseline
// the parity count and never edit the fixture.
export const TRANSIT_BERTH_BASE = 2;

export interface TransitBerthRung {
  credits: Decimal;
  materials: Record<string, Decimal>;
  durationTicks: number;
}

// The transit-berth RUNGS: each reached rung ADDS +1, so the count climbs LINEARLY
// 2 -> 3 -> ... -> 10 (base + 8 rungs).
//
// ⚠️ EIGHT RUNGS OF +1, NOT FOUR OF +2 (user decision, design 17.1 Q2: "base 2, and up to
// 10"). The +1 step matches buildShipDocksRungs directly below, which is the only other
// capacity ladder in the game. A second step size for the same kind of purchase would be a
// needless pattern for a player to learn.
//
// ⚠️ THE TRACK OUTRUNS THE FLEET ON PURPOSE, and the copy must not pretend otherwise
// (design 17.2). At 4 reachable captains, berths past about 5 buy nothing a player can
// currently use: they are forward investment toward the 10-captain endstate the captain
// roster already advertises as "Coming soon". Do NOT write upgrade copy implying an
// immediate throughput gain from the upper rungs.
//
// FIRST-PASS TUNABLE, priced BELOW the docks ladder beside it: a transit berth is a
// throughput smoother, while a drydock berth is what lets you own another hull at all.
export const TRANSIT_BERTH_RUNGS: TransitBerthRung[] = buildTransitBerthRungs();

function buildTransitBerthRungs(): TransitBerthRung[] {
  const RUNG_COUNT = 8; // base 2 + 8 rungs of +1 -> a 2..10 linear ladder
  const rungs: TransitBerthRung[] = [];
  for (let i = 0; i < RUNG_COUNT; i++) {
    const scale = i + 1; // cost grows LINEARLY with the rung, as the docks track does
    rungs.push({
      credits: new Decimal(1200 * scale),
      materials: {
        structuralAssembly: new Decimal(2 * scale),
      },
      durationTicks: 180 + 40 * i, // 180, 220, ... 460: shorter than a docks expansion
    });
  }
  return rungs;
}

function buildShipDocksRungs(): ShipDocksRung[] {
  const RUNG_COUNT = 8; // base 8 + 8 rungs of +1 -> an 8..16 linear ladder
  const rungs: ShipDocksRung[] = [];
  for (let i = 0; i < RUNG_COUNT; i++) {
    const scale = i + 1; // 1, 2, 3, ...: cost grows LINEARLY with the rung
    rungs.push({
      credits: new Decimal(2000 * scale),
      materials: {
        structuralAssembly: new Decimal(3 * scale),
      },
      durationTicks: 300 + 60 * i, // 300, 360, ... 720 (ship-build ballpark)
    });
  }
  return rungs;
}

// equipmentStorageCap(state): the CURRENT spare-storage cap, DERIVED (never stored)
// from EQUIPMENT_STORAGE_CAP_BASE PLUS each REACHED rung's slotIncrement, a reached-rungs
// SUM (the linear +25 counterpart to the multiplicative loop tierCap runs for material
// warehouses). Reading the cap off the stored LEVEL (not a stored cap number) is the
// deliberate anti-drift choice: the displayed "X / cap" can never diverge from the real
// limit.
export function equipmentStorageCap(state: GameState): number {
  // Defensive `?? 0`: a pre-B1 / hand-edited save may lack the field. The v28->v29
  // migration seeds 0, but the guard keeps a partial shape from reading NaN, matching
  // the codebase's grow-on-demand `?? 0` convention (e.g. tierCap's facility level).
  const level = state.equipmentStorageLevel ?? 0;
  let cap = EQUIPMENT_STORAGE_CAP_BASE;
  // ADD one slotIncrement per REACHED rung (i < level), guarded against an over-level
  // read past the finite track, mirroring tierCap's `i < upgrades.length`.
  for (let i = 0; i < level && i < EQUIPMENT_STORAGE_RUNGS.length; i++) {
    cap += EQUIPMENT_STORAGE_RUNGS[i].slotIncrement;
  }
  return cap;
}

// isStandardIssueBaseline(piece): is this piece a genuine free Standard-Issue slot FLOOR?
//
// ⚠️ SAFETY-CRITICAL PREDICATE. Several paths DESTROY or DISCARD a "baseline" (install-over-baseline
// in equipment.ts, hull salvage in salvage.ts, and historically a load-time migration). Those paths
// used `blueprintKey === null` ALONE as the test, but that is NOT sufficient: dev-granted gear
// (devGrantEquipment, App.svelte) is also minted with blueprintKey null while being a RADIANT iL-400
// item the player expects to keep. Treating "no blueprint" as "worthless, safe to delete" silently
// destroyed those items (the reported data loss). A false positive here DELETES a valuable item, so
// this predicate is deliberately STRICT: a real baseline is ALWAYS rarity "standard" (generateStandardIssue
// hardcodes it), so requiring standard rarity excludes every dev / crafted / loot item, which are never
// standard-with-no-blueprint. A false NEGATIVE (a real baseline not matching) is SAFE: the baseline
// simply survives as a harmless spare, never lost. When in doubt, DO NOT classify as a baseline.
//
// (0.14.0 online: the truly robust fix is an explicit item `origin` field so provenance is stored, not
// inferred, which also gates dev/injected items for anti-cheat. Until then this predicate is the floor.)
export function isStandardIssueBaseline(piece: EquipmentInstance): boolean {
  return piece.blueprintKey === null && piece.rarity === "standard";
}

// isUninstalledPiece(piece): is this piece installed on NOTHING (no ship, no away-team member)?
//
// A piece can be installed in two places: on a ship (fittedToShipId) or, from E-CREW on, on a
// member (fittedToMemberId). Both leave the other field empty, so neither field alone answers
// "is it installed?". This is the ONE place that combines them. It deliberately says nothing
// about Armory commitment: a piece committed to a loadout that is NOT checked out rests in the
// Armory and is installed on nothing, so it counts as uninstalled here. For "is it free to take?"
// use isSparePiece, which adds the commitment clause.
//
// Call sites that read this rather than isSparePiece are the "fitted"/"installed" refusals
// (salvage, member install) that ask only "is it installed?" and then refuse commitment
// separately with their own, more specific reason, plus the dev panel's raw pool readouts. The storage count and the Quartermaster's "already holding one"
// bound used to read this too, but the 0.13.9 hotfix made committed-resting gear take no storage
// and not count as a holdable spare, so both now read isSparePiece. The spare-predicate test scans src for raw
// fittedToShipId null comparisons; lines tagged isSparePiece-ok are the sanctioned exceptions.
export function isUninstalledPiece(piece: EquipmentInstance): boolean {
  return piece.fittedToShipId === null && !piece.fittedToMemberId; // isSparePiece-ok: the helper itself
}

// isSparePiece(piece): is this piece a free SPARE, free to take (install, commit, salvage, enshrine)?
//
// The ONE answer, mirroring how isStandardIssueBaseline became the single baseline predicate.
// Spare = installed on nothing (isUninstalledPiece: no ship AND no member) AND not committed to an
// Armory loadout (committedToLoadoutId). Member gear and loadout-committed gear both have
// fittedToShipId null but are NOT spare, so reading fittedToShipId alone is always wrong for this
// question. Every spare check routes through here; spare-predicate.test.ts guards against raw
// comparisons creeping back in.
export function isSparePiece(piece: EquipmentInstance): boolean {
  return isUninstalledPiece(piece) && piece.committedToLoadoutId === undefined;
}

// spareEquipmentCount(state): how many systems currently OCCUPY spare storage, the
// numerator of the "spare X / cap" display and the denominator of the cap enforcement.
// The cap counts ONLY spare CRAFTED systems: isSparePiece (on no ship and no member, and not
// committed to an Armory loadout) AND blueprintKey !== null (crafted, NOT a Standard-Issue
// baseline). A fitted crafted system (lives on its ship), member gear, a spare baseline, and a
// fitted baseline are ALL excluded (see the section header's WHY). This exact predicate is the
// storage-cap set.
// 0.13.9 hotfix: a piece COMMITTED to an Armory loadout is excluded too, hence isSparePiece
// rather than isUninstalledPiece. A checked-out loadout's pieces are fitted (already excluded),
// but a RESTING loadout's pieces are installed on nothing, and the 0.13.6 Armory design is
// explicit that they rest in the Armory and take NO storage space. Counting them filled the bay
// with gear the player had deliberately put away.
export function spareEquipmentCount(state: GameState): number {
  return state.equipment.filter(
    (piece) => isSparePiece(piece) && piece.blueprintKey !== null
  ).length;
}

// equipmentAtCap(state): whether spare storage is FULL, the single seam the fabricate
// gates (canFabricate / canStartLine, tick.ts) consult to refuse STARTING a new
// equipment craft, MIRRORING materialAtCap for material producers. `>=` (AT the cap
// counts as full) matches materialAtCap's `.gte`. Blocks ONLY equipment fabrication;
// fitting, salvaging, and non-equipment jobs never consult this (they cannot grow the
// spare-crafted pool, or in salvage's case they SHRINK it).
export function equipmentAtCap(state: GameState): boolean {
  return spareEquipmentCount(state) >= equipmentStorageCap(state);
}

// freeEquipmentSlots(state): how many MORE spare crafted systems fit before the bay is
// full, the count of open slots the inspect UI (Crafted Blanks) bounds a mass-roll by and
// the same gate inspectBlank / inspectBlanks enforce. The difference of the SAME two
// readers the fabricate gate consults (cap minus current), clamped at 0 so a save that is
// somehow over cap reports 0 free rather than a negative. equipmentAtCap(state) is exactly
// `freeEquipmentSlots(state) === 0`.
export function freeEquipmentSlots(state: GameState): number {
  return Math.max(0, equipmentStorageCap(state) - spareEquipmentCount(state));
}

// The Research facility's key in GameState.facilities. R2 adds FACILITIES.research and
// seeds it at level 1 in freshState; R1 has NO research facility yet. Named here as the
// SINGLE SOURCE OF TRUTH so R1's tier-gate helper (and R2/R3/R5) all reference ONE
// literal instead of scattering the raw "research" string.
export const RESEARCH_FACILITY_KEY = "research";

// The Fabricator facility's key in GameState.facilities. Mirrors RESEARCH_FACILITY_KEY:
// the SINGLE SOURCE OF TRUTH for the raw "fabricator" string so F1's slot helper (tick.ts)
// + F2/F3/F4/F6 all reference ONE literal instead of scattering it. F1 adds FACILITIES.
// fabricator and seeds it at level 1 in freshState.
export const FABRICATOR_FACILITY_KEY = "fabricator";

// The Shipyard facility's key in GameState.facilities. Mirrors RESEARCH_FACILITY_KEY /
// FABRICATOR_FACILITY_KEY: the SINGLE SOURCE OF TRUTH for the raw "shipyard" string so
// S1's shipBuildSlotCount (tick.ts) + the later S2-S6 tasks all reference ONE literal
// instead of scattering it. ⚠️ Unlike research/fabricator, S1 seeds the shipyard at
// level 0 (LOCKED / unfounded) in freshState, the founding rung establishes it.
export const SHIPYARD_FACILITY_KEY = "shipyard";

// The Salvage Bay's key in GameState.facilities (Salvage Lanes, 2026-09-04). Mirrors the
// three keys above: the SINGLE SOURCE OF TRUTH for the raw "salvageBay" string, which was
// already in use as a QueueFacilityKey and as the Foundry rail's card id long before the
// bay had a facility LEVEL. It now has one, so the literal has a name.
//
// ⚠️ LEVEL 0 IS A FULLY WORKING BAY, NOT AN UNFOUNDED ONE, and that is the single most
// important fact about this facility. The bay shipped with no level track at all and is
// available to every existing player, so a founding rung would have taken the Salvage Bay
// away from every save in existence (along with its queued and in-flight jobs). Its rungs
// therefore only ADD lanes on top of a base of one; there is no founding rung and no
// founding gate anywhere. Same posture as the Fuel Depot (usable tank at level 0) and the
// Shipyard's bay FLOOR, and the deliberate opposite of the Refinery / Shipyard founding
// rungs. See salvageSlotCount (tick.ts) and FACILITIES.salvageBay below.
export const SALVAGE_BAY_FACILITY_KEY = "salvageBay";

// The Subspace Telescope's key in GameState.facilities (Squads SQ-5). The SINGLE SOURCE OF TRUTH
// for the raw "subspaceTelescope" literal SQ-1 already seeds at level 1 (freshState + SAVE v68).
export const SUBSPACE_TELESCOPE_FACILITY_KEY = "subspaceTelescope";

// OC-15: the highest blueprint tier the Research Lab / the Fabricator serves right now (its level, 0 when absent;
// a level-N facility researches / crafts tier N and below, up to LAB_FABRICATOR_TOP_TIER). The ONE public reader for
// everything gated on the Lab or Fabricator tier outside the blueprint gates themselves (Relics v2 R2-3's
// identification lanes, the gas giant data study, propulsion's drive classes), so none of them reads the raw key.
// Read DEFENSIVELY (absent facility -> 0). Duplicates tick.ts's private facilityLevel() ON PURPOSE: model.ts must NOT
// import tick.ts (tick.ts imports model.ts; the reverse is a circular dependency).
export function labTier(state: GameState): number {
  return state.facilities[RESEARCH_FACILITY_KEY]?.level ?? 0;
}
export function fabricatorTier(state: GameState): number {
  return state.facilities[FABRICATOR_FACILITY_KEY]?.level ?? 0;
}

// Is a research PROJECT for `key` currently in flight? R3 adds the research-project
// engine: startResearch pushes a TimedProcess whose completion effect is
// { type: "unlockBlueprint"; key } (design §3 / plan R3). That effect member does NOT
// exist on ProcessEffect YET (R3 adds it), so we read the effect STRUCTURALLY here.
// TODAY activeProcesses can never hold such an entry, so this returns false for every
// blueprint, but the SAME scan reports a live project the moment R3 lands, with no
// change. The one `as` cast is the ONLY forward reference; ⚠️ R3 MUST keep the effect's
// discriminant "unlockBlueprint" and its `key` field (both fixed in design §3) for this
// to stay correct. Including this term now keeps blueprintResearchable's full contract
// (tier + not-unlocked + not-in-progress) honest and testable from R1.
function researchInProgress(state: GameState, key: string): boolean {
  return state.activeProcesses.some((p) => {
    const effect = p.effect as { type: string; key?: string };
    return effect.type === "unlockBlueprint" && effect.key === key;
  });
}

// Has the player researched this blueprint? Pure membership test over the unlocked set.
export function blueprintUnlocked(state: GameState, key: string): boolean {
  return state.researchedBlueprints.includes(key);
}

// Can this blueprint be researched RIGHT NOW? True iff: the key is a real blueprint AND
// it is not already unlocked AND no project for it is in flight AND the Research facility
// has reached its tier (level >= tier). This is the pure AVAILABILITY predicate the R4
// canResearch gate builds on (R4 adds the credits/free-slot reasons on top); R1 ships the
// tier + unlocked + in-progress core so it is testable the moment R2's facility level exists.
export function blueprintResearchable(state: GameState, key: string): boolean {
  const bp = BLUEPRINTS[key];
  if (!bp) return false; // unknown key, not a real blueprint
  if (blueprintUnlocked(state, key)) return false; // already researched
  if (researchInProgress(state, key)) return false; // a project is already unlocking it
  if (blueprintRelicLocked(state, key)) return false; // E4d: its relic has not been discovered yet
  return bp.tier <= labTier(state); // tier gated by the research-facility level
}

// Open-ended (levels can climb indefinitely), a formula, not a finite table
// like HOMEWORLD_TALENTS' Fleet Logistics branch below (hand-tuned per entry).
// Progression Pacing Rework (Task 4): steepened from 100*level to 300*level.
// Captain XP now accrues PER ACTIVE TICK (see tickCaptainMission's per-whole-tick
// award) instead of as a lump per completed cycle, so the per-level cost was
// raised to keep early leveling from racing ahead under the faster drip.
export function xpForNextLevel(level: number): number {
  return 300 * level;
}

// Deliberately much steeper than a captain's own xpForNextLevel, the
// intent (per design doc) is that Fleet Admiral levels lag well behind
// individual captain levels. A simple quadratic-ish curve achieves that
// without needing per-level hand-tuning (unlike a Fleet-Logistics-style
// finite talent table).
//
// 2026-07-08 (docs/plans/2026-07-08-fleet-admiral-xp-rework-plan.md):
// multiplier bumped from 500 to 2500 as part of switching Fleet Admiral XP
// from "recomputed as the sum of captain levels" (effectively frozen under
// realistic play, confirmed live, see this plan's design doc) to
// "earned per completed mission cycle," mirroring captain XP. This value is
// a launch placeholder, same convention as MISSIONS/RECIPES/talent costs
// elsewhere in this codebase, and per the user's own explicit note,
// deliberately NOT calibrated assuming mission XP is the only income source
// Fleet Admiral leveling will ever have (more sources are planned later).
//
// ⚠️⚠️ DEVICE-TUNED STARTING VALUES, MOST PLAYTEST-SENSITIVE NUMBER IN THE REWORK ⚠️⚠️
// Progression Pacing Rework: multiplier rescaled from 2500 to 375000, quadratic
// shape KEPT. This value is scaled for PARITY with the OLD Fleet Admiral pace,
// using the SAME method the captain curve used, it is deliberately NOT made
// faster. Still a STARTING point to be tuned against real on-device play at the
// checkpoint, do NOT treat 375000 as final.
//
// WHY 375000, the parity math (same method as the captain curve):
//   * The captain curve was rescaled by (cycle ticks / old XP per cycle) so its
//     OLD leveling pace survived the switch to per-tick accrual. FA uses the
//     identical method: old FA income was 1 per cycle (fleetAdminXpPerTick's
//     predecessor, fleetAdminXpPerCycle, was 1) over the 149-tick short cycle,
//     so the scale factor is 149 / 1 = 149. 2500 * 149 = 372,500, exact parity
//    , rounded to a clean 375000. (For reference, captain's own factor was
//     149/50 ≈ 3 -> 300*level.)
//   * The 'boost' to FA leveling is DELIBERATELY DEFERRED to the OTHER planned FA
//     XP sources (crafting, talent purchases, talent-tree effects), NOT baked
//     into an under-scaled curve. The earlier Task 8 value (250000, ×100) tried
//     to make the curve itself the boost, too FAST; that intent is reversed
//     here. Parity keeps the curve honest so those future sources, not an
//     undertuned curve, provide the growth.
//   * Income context (still accurate): Task 5 moved Fleet Admiral XP from a
//     per-CYCLE lump to PER-TICK accrual, it now earns ~1 FA XP per tick PER
//     ACTIVE captain, and STACKS fleet-wide (N active captains => ~N FA XP/tick,
//     see tickCaptainMission's fleetAdminXpAwardedThisCall). tickDurationSeconds
//     = 1s.
//   * Quadratic (super-linear) shape is KEPT so the curve stays fast-early /
//     slow-later: the per-level increment is BASE*(2*level+1), which GROWS
//     with level, so high FA levels cost disproportionately more (FA is
//     powerful, high levels should take real time). Not steepened past
//     quadratic on purpose (YAGNI): the scale, not the exponent, is the lever
//     the device playtest will move first.
//
// ⚠️ 0.12.1 TEMPORARY UNBLOCK (2026-07-21): the base scale was dropped from
// 375000 to 750 as a TEMPORARY tuning pass ahead of the full balance. The old
// 375000 parity scale (rationale preserved above) made early content
// unreachable: reaching FA level 3 to unlock the Shipyard cost 3,375,000 XP for
// that level alone (~1.875M just for L2->L3 at ~1 FA XP/tick per active captain,
// on the order of weeks of wall-clock). At 750 the curve keeps its EXACT
// quadratic shape (still fast-early / slow-later, still parity-honest integers),
// but early levels are reachable: L1->L2 = 750, L2->L3 = 3000, so reaching level
// 3 costs 3,750 XP total. This deliberately trades the old "missions alone must
// carry FA" parity intent for a playable early game; the finite FA XP sources
// (upgrades / crafting / research / ship-build, see PROCESS_XP_AWARDS +
// FLEET_ADMIN_XP_PER_DURATION_TICK in tick.ts) now contribute meaningful lumps
// on top of the mission trickle. Both the base here and those lumps are TUNABLE
// placeholders we will refine on staging, NOT a final balance.
export function xpForNextFleetAdminLevel(level: number): number {
  return 750 * level * level; // ⚠️ 0.12.1 TEMPORARY base (was 375000); tunable, see note above
}

// ⚠️ TUNABLE (0.12.1 launch placeholder). Fleet Admiral XP granted per durationTick
// by a COMPLETED timed process that feeds the FA axis (see PROCESS_XP_AWARDS in
// tick.ts for which kinds). Mirrors the CRAFTING_XP_PER_DURATION_TICK idiom below:
// a process's FA lump is FLEET_ADMIN_XP_PER_DURATION_TICK * process.durationTicks,
// lumped once on completion. Before 0.12.1 the FA lump was the bare durationTicks
// (an implicit multiplier of 1), a rounding-error against the old 375000 curve; this
// makes finite sources MEANINGFUL against the new 750 curve.
//
// SIZING (against the 0.12.1 curve: L1->L2 = 750, L2->L3 = 3000): early facility
// upgrades run ~20-90 durationTicks (Refinery rungs 20/40/60..., Fabricator
// 20/45/90/180, founding builds ~60, Fuel Depot 60/120...), and early research
// projects ~12-120 ticks. At 5, a representative ~60-tick early upgrade grants 300
// FA XP (40% of the first level), a cheap 20-tick refine rung grants 100 (13%), so
// roughly 2-4 early upgrades earn a level rather than one upgrade == a level or a
// rounding error. INTEGER on purpose: the FA award closed-form parity (offline
// catch-up == live) holds ONLY for integer awards (integer * integer durationTicks,
// no float drift), same trap CRAFTING_XP_PER_DURATION_TICK and the mission
// fleetAdminXpPerTick rate guard against. Tunable, we will refine on staging.
export const FLEET_ADMIN_XP_PER_DURATION_TICK = 5;

// --- Crafting Level XP (Equipment 0.11.0, Phase 3, Task 8) -------------------
// A SEPARATE progression axis from Fleet Admiral XP: the player's crafting skill,
// earned by COMPLETING production jobs (refine / fabricate / ship-build) rather than
// by running missions. The award engine lives in tick.ts (resolveProcesses grants the
// XP on completion, applyCraftingXp folds + rolls level-ups); THIS file owns only the
// two tunable knobs, the per-work XP rate and the level curve, so a playtest retune is
// a one-line edit here with no engine change.

// ⚠️ TUNABLE (launch placeholder). Crafting XP granted per durationTick of a COMPLETED
// production job: a job's award is CRAFTING_XP_PER_DURATION_TICK * job.durationTicks,
// lumped once on completion (the SAME "value scales with the job's time/cost" shape FA
// XP's lump uses). Because the award scales with DURATION, a long/costly fabricate or
// ship-build grants far more than a cheap 1-4 tick refine, so spamming trivial crafts
// does NOT level crafting fast, expensive production does. Kept an INTEGER so the
// closed-form parity stays exact (integer * integer durationTicks, no float drift):
// see resolveProcesses' craftingXpDelta accumulation + its parity test. 2 (not 1) so a
// dropped-multiplication bug is observable in tests (2*d != d) while leaving headroom.
//
// ⚠️ 0.13.3 (Phase 3 Unit 3.1): this is now the BASE rate, not the whole story. Every
// crafting-XP award is this rate scaled by a per-kind/per-tier WEIGHT so that cheap,
// endlessly-repeatable refining cannot outpace real production (design §6.1). The weight
// table and the award function live in craftingProgress.ts; the constants they read live
// just below. Unit 3.1 is the module only: the resolveProcesses call site still awards
// the flat `rate * durationTicks` form described above until Unit 3.2 swaps it over.
export const CRAFTING_XP_PER_DURATION_TICK = 2;

// --- Crafting XP weights (0.13.3 Phase 3 Unit 3.1, design §6.1) --------------
// The award is `floor(durationTicks * CRAFTING_XP_PER_DURATION_TICK * weightNum /
// CRAFTING_XP_WEIGHT_DENOM)`. Weights are expressed as a NUMERATOR over this shared
// denominator (quarters) rather than as a fractional multiplier, so every input to the
// award is an integer and the single division floors ONCE at the end. That keeps the
// award exactly integer, which is what the closed-form offline==live parity depends on
// (see CRAFTING_XP_PER_DURATION_TICK's note above: integer times integer, no float
// drift). A 0.25 multiplier written as a float would reintroduce exactly the drift that
// comment calls load bearing.
//
// The DENOMINATOR is 4 because the smallest weight the design needs is a quarter of the
// base rate (refining). Raising it later is safe: it only makes the grid finer.
export const CRAFTING_XP_WEIGHT_DENOM = 4;

// Refining: 1/4 of the base rate. The deliberate laggard. See RefineRecipeDef.xpWeightNum
// for why refining must contribute without being able to lead.
export const REFINE_XP_WEIGHT_NUM = 1;

// Fabricating a MATERIAL blueprint: 4/4 (1.0x) PER BLUEPRINT TIER. Tier 1 lands exactly on
// the pre-0.13.3 flat rate on purpose, so the pacing players already know is the anchor the
// rest of the table is measured against, and tier is the value axis on top of it.
export const MATERIAL_FABRICATE_XP_WEIGHT_NUM_PER_TIER = 4;

// Fabricating a blueprint that MINTS AN INSTANCE (equipment, weapon, drone pod): 6/4 (1.5x)
// per blueprint tier. Highest per-tick rate in the game because crafting level exists to
// drive crafted-equipment iLevel: the activity the stat feeds should be the best way to
// raise it. Discriminated by blueprintMintsEquipmentInstance, not by a second data field.
export const EQUIPMENT_FABRICATE_XP_WEIGHT_NUM_PER_TIER = 6;

// Building a hull: 12/4 (3.0x), flat, not per tier. The largest, rarest and most
// component-hungry build in the game, and it already scales its own reward through a much
// longer durationTicks, so a tier multiplier on top would double-count the size.
export const SHIP_BUILD_XP_WEIGHT_NUM = 12;

// --- Crafting level curve (0.13.3 Phase 3 Unit 3.1, design §6.3) -------------
// ⚠️ TUNABLE. XP required to go from `level` to `level+1`:
//
//     craftingXpForNext(L) = CRAFT_XP_BASE * L^2 * (1 + L / CRAFT_XP_KNEE)
//
// SUPERSEDES the pre-0.13.3 `500 * L^2`. Two things changed and both were deliberate:
//
//   SHAPE. A quadratic with a linear multiplier is a cubic in disguise: below the knee
//   the `L / KNEE` term is small and it behaves like the old quadratic (gentle early
//   levels), past the knee it turns hard. forNext(40) / forNext(10) is 32x here versus
//   16x on the old pure quadratic. Chosen over a raw exponential, whose late levels stop
//   being expensive and start being unreachable, and over a hand-authored per-level
//   table, which is 50 numbers to maintain and retune.
//
//   SCALE. The absolute numbers DROP (level 10 costs 18,000 here versus 50,000 before)
//   because the weight model above cut low-value income hard: refining now pays a quarter
//   of what it did. The curve is retuned to match the new income, not to make levels
//   cheaper in real terms.
//
// ⚠️ WRITTEN AS A GROUPED INTEGER EXPRESSION, NOT AS THE DESIGN'S PROSE FORM. The design
// writes the curve as `BASE * L^2 * (1 + L / KNEE)`. Coded literally, that evaluates
// `1 + L/20` as a binary float FIRST and multiplies an inexact factor through, which
// drifts: at level 7 it yields 7938.000000000001 and at level 21 it yields
// 108485.99999999999, and it misses the exact integer on 49 of the first 500 levels.
// The algebraically identical grouping used below does every multiplication in whole
// numbers and divides ONCE at the end:
//
//     BASE * L^2 * (KNEE + L) / KNEE
//
// The numerator is an exact integer, the quotient is always an integer (the curve is
// 120*L^2 + 6*L^3), and IEEE division of two exactly-representable integers whose exact
// quotient is representable is itself exact. This is the same "group the integers, divide
// once, no fractional intermediate" discipline the XP weight model uses, for the same
// reason. Do not "simplify" it back to the prose form.
//
// (Precision footnote, pre-existing and harmless: the return value is a break_infinity
// Decimal, which is a mantissa/exponent pair of doubles, not an arbitrary-precision
// decimal. Storing a large exact integer in it can cost the last bit or two above roughly
// level 46. That is a property of the Decimal accumulator this curve has always returned
// into, it is a relative error around 1e-16, and it is invisible to the only thing that
// consumes the value: a `gte` comparison and a subtraction inside foldXpLevelUps. Every
// level in the reachable band, including the level-40 tier-2 iLevel ceiling, is exact.)
//
// GRANDFATHERING (design §6.5). Changing this curve does NOT re-derive anybody's level.
// applyCraftingXp (tick.ts) folds a delta FORWARD from the stored (craftingXp,
// craftingLevel) pair and never recomputes a level from cumulative XP, so an existing save
// keeps the level it earned and simply meets the new threshold on its NEXT level-up.
// Silently demoting a player because the designer retuned a curve is exactly the surprise
// the project's "sell peace" rule forbids. Accepted consequence: saves from before this
// change hold a level that would now cost more to earn. That is a one-time generosity.
export const CRAFT_XP_BASE = 120;
export const CRAFT_XP_KNEE = 20;

// Decimal-typed to match craftingXp's idle-scale Decimal accumulator (GameState.craftingXp)
// and to compose with applyCraftingXp's Decimal fold; the caller compares/subtracts it
// against craftingXp directly.
export function craftingXpForNext(level: number): Decimal {
  return new Decimal((CRAFT_XP_BASE * level * level * (CRAFT_XP_KNEE + level)) / CRAFT_XP_KNEE);
}

// ============================================================================
// Quality roll at production (Equipment 0.11.0, Phase 4, Task 9b)
// ============================================================================
// When a producer (a mission delivery, a passive trickle, a completed refine /
// fabricate job) deposits material, it now rolls ONE quality tier for that deposit and
// the whole amount lands in that tier's bucket (inventory.ts addItemQuality), instead of
// always bucket 0. This module owns ONLY the tunable ODDS + the pure roll; the DEPOSIT
// wiring lives at the production seams in tick.ts (the loot fold in economyTick and the
// addItem completion in resolveProcesses).
//
// ⚠️ FIRST-PASS TUNABLE ODDS, NOT balance-tested. QUALITY_STEP_CHANCE[i] is the chance to
// advance FROM tier i TO tier i+1. The roll is COMPOUNDING: it starts at tier 0 and must
// succeed at each step to climb, stopping at the first FAILURE (so reaching tier k costs k
// consecutive successes). At ~0.1% per step the tiers are extremely rare and each higher
// tier is ~1000x rarer than the one below, a deliberately steep curve so quality is a
// long-tail reward. These odds MUST be re-balanced against real GATHER VOLUME later:
// a fleet producing millions of units per hour will surface high tiers far more often than
// these raw per-deposit odds suggest, so the final values depend on production throughput,
// not just this table. The array LENGTH is the tier ceiling: it MUST equal QUALITY_TIERS-1
// (5 steps -> max tier 5), so a deposit can never land above the highest bucket the storage
// layer supports. Retuning is a one-line edit here with no engine change.
export const QUALITY_STEP_CHANCE: readonly number[] = [
  0.001, // tier 0 -> 1
  0.001, // tier 1 -> 2
  0.001, // tier 2 -> 3
  0.001, // tier 3 -> 4
  0.001, // tier 4 -> 5 (final step; success here reaches the QUALITY_TIERS-1 ceiling)
];

// Belt-and-suspenders: keep the odds table's length locked to the storage ceiling. If a
// future edit adds/removes a bucket tier (QUALITY_TIERS) without updating this table, the
// roll could either never reach the top tier or (with a mismatched loop bound) index past
// the table; failing loudly at module-load surfaces that drift immediately rather than as a
// silent mis-distribution deep in the economy. QUALITY_TIERS-1 = number of climb STEPS.
if (QUALITY_STEP_CHANCE.length !== QUALITY_TIERS - 1) {
  throw new Error(
    `QUALITY_STEP_CHANCE length ${QUALITY_STEP_CHANCE.length} must equal QUALITY_TIERS-1 (${QUALITY_TIERS - 1})`
  );
}

// rollQuality(rng): the pure, deterministic-given-rng quality roll for ONE production
// deposit. Returns an integer tier 0..QUALITY_TIERS-1 (0..5). Compounding: climbs one tier
// per SUCCESSIVE success and stops at the first failure, so tier 0 is overwhelmingly common
// and each higher tier is progressively rarer (see QUALITY_STEP_CHANCE).
//
// RNG DRAW COUNT is VARIABLE: between 1 draw (immediate failure -> tier 0) and
// QUALITY_STEP_CHANCE.length draws (all steps succeed -> the max tier). This mirrors the
// early-return draw shape rollExtractionTick already uses, and is SAFE for offline==live
// parity: both paths call rollQuality at the SAME deposit points off the SAME stepped rng
// stream (tick() and App.svelte both drive economyTick one whole tick at a time), so the
// sequence of rollQuality calls, and thus of draws, is identical regardless of how the span
// was chunked. The variability only means a later draw's stream position depends on earlier
// outcomes, which is true identically on both paths.
//
// Exploration 0.14.0 (Phase E4b): the optional `bonus` is the museum's craftingQuality fraction. It
// shifts the roll toward higher quality WITHOUT ADDING OR REMOVING A SINGLE DRAW: the climb draws
// exactly as before (the base thresholds alone decide when the loop stops), and the bonus is applied to
// the FAILING draw only, as a one-step "near miss" promotion. The climb at step k fails when
// r >= QUALITY_STEP_CHANCE[k]; with a bonus, that same r is ALSO checked against the boosted threshold
// min(1, QUALITY_STEP_CHANCE[k] * (1 + bonus)), and if r falls in the window
// [chance, boosted chance) the roll ends ONE tier higher. No further draw is made after a promotion
// (the loop still breaks), so the draw COUNT and ORDER are bit-identical to the un-boosted roll for
// every rng sequence, and the shared seeded stream (mission loot, mints) never shifts. Net effect: the
// chance of reaching at least tier k+1 from tier k becomes chance * (1 + bonus) (capped at 1). A bonus
// of 0 (or any non-positive / non-finite value) skips the promotion check entirely, so the result is
// bit-identical to the pre-E4b roll.
export function rollQuality(rng: () => number, bonus: number = 0): number {
  let tier = 0;
  const boosted = bonus > 0 && Number.isFinite(bonus);
  // One climb attempt per step. `< chance` (not `<=`) matches every other rng gate in the
  // engine (rollExtractionTick's `rng() < effectiveRareChance`), so a rng returning exactly
  // the threshold does NOT advance, consistent across the codebase.
  for (let step = 0; step < QUALITY_STEP_CHANCE.length; step++) {
    const r = rng();
    if (r < QUALITY_STEP_CHANCE[step]) {
      tier += 1; // this step succeeded, climb and try the next (compounding)
    } else {
      // E4b near-miss promotion off the SAME draw (no extra draw; see the header above).
      if (boosted && r < Math.min(1, QUALITY_STEP_CHANCE[step] * (1 + bonus))) tier += 1;
      break; // first failure ends the climb; the tier reached so far is final
    }
  }
  return tier;
}

// rollCraftedRarity(rng): the BASE craftable-rarity roll for ONE freshly fabricated equipment
// piece (Equipment 0.11.0, Task 19). Returns an EquipmentRarity in the CRAFTABLE band
// Standard..Radiant, weighted heavily toward Standard, consuming EXACTLY ONE rng draw.
//
// DRAW-COUNT CONTRACT: exactly one draw, ALWAYS (a single `rng()` then a cumulative-threshold
// walk). This fixed, tiny draw shape is what lets the Fabricator's mint stay offline==live
// parity-identical, the mint draws quality (rollQuality) THEN this rarity THEN generateEquipment's
// affix rolls, all off the SAME threaded stream in that fixed order, so a completion advances the
// stream identically no matter how the elapsed span was chunked (see resolveProcesses / the
// parity test in tick.test.ts).
//
// ⚠️ FIRST-PASS TUNABLE + a DELIBERATE FIRST-PASS SUBSET (see the mint site in tick.ts):
//   - derelict is EXCLUDED: it is a decay state, not a craft output (a fresh piece is never a wreck).
//   - luminous / constellar (and the nova/celestial ascensions) are EXCLUDED here: those are the
//     talent-gated legendary procs a LATER refinement task mints; base crafting tops out at radiant.
// The weights below (Standard-heavy) are launch placeholders, retuned at the device-check stage,
// the SAME posture as QUALITY_STEP_CHANCE and every other economy constant in this file. Uses the
// same strict `<` gate every rng gate in the engine uses (rollExtractionTick / rollQuality).
export function rollCraftedRarity(rng: () => number): EquipmentRarity {
  const r = rng();
  if (r < 0.6) return "standard";   // 60% common craft
  if (r < 0.85) return "augmented"; // 25%
  if (r < 0.97) return "stellar";   // 12%
  return "radiant";                 //  3% top-end base craft
}

// ----------------------------------------------------------------------------
// WHICH RARITY BANDS THE GAME CAN ACTUALLY PRODUCE TODAY (0.13.3.1 QA)
// ----------------------------------------------------------------------------
// rollCraftedRarity above is the ONLY place a fresh piece's rarity is decided (the Fabricator
// mint, the weapon mint and the drone-pod mint in tick.ts all call it; the Standard-Issue
// baselines are minted at a fixed "standard"). So the set of bands it can return IS the set of
// bands a player can ever hold, and everything below is a restatement of that function.
//
// WHY THIS EXISTS AT ALL. A console that offers a player a rule for luminous or constellar is
// offering a rule that can never fire: those bands are the talent-gated legendary procs a later
// release mints, and derelict is a decay state rather than a craft output. Offering them is not
// harmless, it is a promise the engine cannot keep. The user asked for them to stop being
// offered "for now", which is the operative phrase: they come BACK the day they are producible.
//
// ⚠️ THIS NARROWS A DISPLAY LIST, NEVER THE MODEL. AutoSalvageRaritySelection stays a TOTAL
// Record over the whole EquipmentRarity union, saves keep round-tripping every band, and the
// engine keeps honoring a band that is selected however it got selected. If the displayed list
// were allowed to become the model, a save carrying an unproducible band would silently lose
// it, which is precisely the class of quiet data loss the rest of this feature is built to
// avoid. Consumers that reason about the RULE (normalizeAutoSalvageRarities, the selector, the
// summary sentence) must keep using EQUIPMENT_RARITY_LADDER; only a control that OFFERS a
// choice uses the list below.
//
// ⚠️ A TOTAL Record, SO GROWING THE LADDER IS STILL A COMPILE ERROR. Adding a member to
// EquipmentRarity fails to type-check here as well as at AUTO_SALVAGE_RARITIES_NONE, which
// forces the one question that matters ("can the pipeline mint this yet?") to be answered
// rather than defaulted. The alternative, a hardcoded exclusion list of the two bands we are
// hiding this patch, would have to be found and edited by hand later and is exactly the
// anti-modular shape this feature was told not to grow.
//
// KEEPING IT HONEST: this table is a hand-written mirror of rollCraftedRarity's branches
// because that function is a threshold ladder rather than a data table, so there is nothing to
// derive from. salvage.test.ts probes the REAL rollCraftedRarity across its whole input range
// and asserts the produced set equals this list, so retuning the roll (adding luminous, say)
// fails the suite here until this table is updated. The test is the tie between the two.
const CRAFTED_RARITY_PRODUCIBLE: Record<EquipmentRarity, boolean> = {
  derelict: false,   // a decay state, never minted: a fresh piece is not a wreck
  standard: true,    // rollCraftedRarity: 60%
  augmented: true,   // rollCraftedRarity: 25%
  stellar: true,     // rollCraftedRarity: 12%
  radiant: true,     // rollCraftedRarity:  3%, the top of the base craft band
  luminous: false,   // talent-gated legendary proc, not minted this patch
  constellar: false, // talent-gated legendary proc, not minted this patch
};

// The producible bands in LADDER ORDER, for any control that offers the player a rarity choice.
// Ordered by EQUIPMENT_RARITY_LADDER rather than by this table's own key order so there is one
// authority on what order rarity bands read in, and so a band becoming producible needs no
// second thought about where it lands on screen.
export const PRODUCIBLE_EQUIPMENT_RARITIES: readonly EquipmentRarity[] =
  EQUIPMENT_RARITY_LADDER.filter((band) => CRAFTED_RARITY_PRODUCIBLE[band]);

// --- Captain & Homeworld Talent Trees (docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md) ---
// Two new data-driven tables, mirroring the exact conventions the (now-deleted)
// Skill Tree established, branch/label/cost/requires (same-branch
// prerequisite) plus a typed effect. The old level-gated CAPTAIN_SLOT_UNLOCKS
// table and its unlockCaptainSlot() function (tick.ts) have been removed --
// Fleet Logistics below (via buyHomeworldTalent's unlockCaptainSlot effect)
// fully absorbed that mechanism's job as of Task 4.
// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 1)
// shrank this union from the old five-column linear model
// ("command"/"tactical"/"science"/"resourcefulness"/"diplomacy") to the three
// captain branches the radial web ships with. "command"/"diplomacy" are gone
//, their old content is either dropped or re-homed onto the surviving
// branches by the Task 2 data rewrite. Anything still referencing the removed
// members (CAPTAIN_SPEC_BONUS, CAPTAIN_TALENTS entries, tick.ts) is expected to
// dangle until Tasks 2/5/7 clean it up; that intermediate breakage is by design.
export type CaptainTalentBranch = "resourcefulness" | "tactical" | "science";
export type HomeworldTalentBranch = "fleetLogistics" | "homelandDefense" | "citizenry" | "economy" | "industry";

export type CaptainTalentEffect =
  | { type: "commonYieldMult"; mult: number }
  | { type: "uncommonYieldMult"; mult: number }
  | { type: "uncommonChanceMult"; mult: number }
  | { type: "rareChanceMult"; mult: number }
  | { type: "bonusRollChance"; chance: number }
  | { type: "bonusRollChanceMult"; mult: number }
  // WR-6 (0.14.0, wiring plan OC-A40 to OC-A42): the Tactician and Explorer hubs and the tactical / science spec
  // bonuses, live. Each is its own x (1 + mult) factor ("Always multiply", user 2026-10-17) on the ship the captain
  // commands (OC-A2), read by captainPrimaryEffects.ts and folded where the matching secondary node already acts:
  //   weaponDamageMult : every weapon projectile's damage in ship battles (the frozen captain combat record)
  //   scanRateMult     : the expedition scan rate (the frozen scan params)
  //   relicFindMult    : the relic find chance on expedition objectives (the frozen run record)
  | { type: "weaponDamageMult"; mult: number }
  | { type: "scanRateMult"; mult: number }
  | { type: "relicFindMult"; mult: number }
  // Radial Skill Web (Task 2): a genuinely-null gateway effect. No captain node carries it since WR-6 (both hubs
  // grant a real bonus now); it stays available for a future pure-gateway node and renders honestly as "no bonus
  // yet" rather than a misleading "+0.0%" line.
  | { type: "none" };

// unlockCaptainSlot carries no gate beyond the node's own `cost` (adminPoints)
//, Homeworld Talents are fleet-wide Fleet Admiral prestige, spent purely
// from the fleet's adminPoints pool, entirely independent of any individual
// captain's own level/statPoints (those only ever gate that captain's OWN
// Captain Talents, a completely separate tree/pool). The old CAPTAIN_SLOT_UNLOCKS
// mechanism this replaced WAS captain-scoped (atLevel/statPointCost/componentsCost),
// but that scoping was deliberately dropped, not carried forward, when Fleet
// Logistics absorbed the job in Task 4, confirmed with the user rather than
// left as unenforced vestigial fields.
export type HomeworldTalentEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "rareYieldMult"; mult: number }
  // (The `recipeBonusOutput` member was RETIRED in Phase 4, Task F5 with the
  //  legacy RECIPES/craftRecipe instant-craft it exclusively modified. Both
  //  industry-branch nodes that granted it then carried the honest `none`
  //  placeholder while their real mechanic, the Fabricator facility, was built.
  //  That promised re-wire has now HAPPENED for one of them: Crafting 0.13.3
  //  Unit 3.3 gave `industryBonusOutput` the `craftingItemLevel` effect below,
  //  so `industryHub` is the only industry node still carrying `none`.)
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number }
  // 0.11.0 Storage/Salvage (Task C4): the combined Fleet-Admiral salvage talent.
  // ONE learned node improves BOTH salvage models at once (salvage.ts):
  //   yieldBonus   is added FLAT onto salvageEquipment's recovery fraction, so a
  //                recycled spare crafted system returns more of its inputs.
  //   ceilingBonus is added onto salvageSalvagedMaterial's loot ceiling INDEX, so
  //                the tiered loot roll can reach a higher rarity tier than the
  //                player's Fleet Admiral level alone would allow.
  // Both live on this ONE effect payload (the design's "one combined talent" note),
  // and salvage.ts reads them straight off this payload via salvageTalentBonus(),
  // so the tunable values (SALVAGE_TALENT_* consts below) are the single source of
  // truth, no second copy of the numbers in the salvage engine.
  | { type: "salvageBoost"; yieldBonus: number; ceilingBonus: number }
  // Crafting 0.13.3 (Phase 1 Unit 1.2, design §5.2): the "RAM is expensive" queue
  // depth grant. Each learned node adds `depth` QUEUED order slots to EVERY
  // queue-capable facility (QueueFacilityKey above), stacked on QUEUE_DEPTH_BASE.
  //
  // WHY a number payload instead of a bare marker like unlockCaptainSlot: the depth
  // helper (queueDepth, tick.ts) SUMS this payload across the learned nodes rather
  // than counting matching nodes, so a later node granting +2 at once needs zero
  // engine change. The value is seeded from QUEUE_DEPTH_PER_NODE (below) so the
  // tunable lives in exactly one place, the same single-source discipline the
  // SALVAGE_TALENT_* consts give salvageBoost.
  | { type: "queueDepth"; depth: number }
  // Infrastructure 0.13.4 (Phase 1 Unit 1.1, design §8): the PER-FACILITY depth grant,
  // the BRANCH to `queueDepth`'s TRUNK. Adds `depth` queued slots to ONE named facility,
  // on top of whatever the global chain already grants everywhere.
  //
  // ⚠️ THE GLOBAL CHAIN IS DELIBERATELY NOT RE-SCOPED (design §17.3 Q11, user decision).
  // Re-pointing the existing rungs 2 and 3 at single facilities was the alternative, and it
  // would have REMOVED depth at five facilities from every player who already bought them.
  // That is the silent loss the user's own rules forbid, so the trunk stays global and this
  // is purely additive. Accepted consequence, recorded so it is not read later as a bug: a
  // fully invested player reaches depth 5 at one facility.
  //
  // ⚠️ `facility` EXCLUDES "fuelDepot", and that exclusion is a TYPE, not a comment. The
  // Fuel Depot has no queue and never will (user decision 2026-09-06, recorded in tick.ts:
  // selectable fuel TYPES are coming and do not change it, because picking a type is a
  // persistent SETTING rather than an order). Typing it out here means a node pointed at the
  // Fuel Depot fails to compile instead of shipping a talent that silently does nothing.
  //
  // Same SUMMING payload shape as the trunk above, for the same forward-compatibility
  // reason: a second node for one facility, or a node granting +2, needs no engine change.
  | { type: "facilityQueueDepth"; facility: Exclude<QueueFacilityKey, "fuelDepot">; depth: number }
  // Crafting 0.13.3 (Phase 3 Unit 3.3, design §6.5): the CRAFTING ITEM LEVEL grant.
  // This is the effect that finally feeds `faTalentBonus`, the third addend of
  // computeItemLevel (itemgen.ts), which shipped with a real parameter and a
  // hardcoded 0 at every call site. Each learned node adds `bonus` item levels to
  // every piece the Fabricator mints (equipment, weapon and drone alike).
  //
  // ⚠️ THE TIER CAP STAYS HARD, AND THIS EFFECT DOES NOT LIFT IT. Locked user
  // decision, design §14 item 1. computeItemLevel clamps to
  // `blueprint.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER` AFTER adding this bonus, so the
  // talent gets a player to a blueprint tier's ceiling SOONER and can never carry
  // them one level past it. Rationale: tier/research progression stays the real gate
  // on gear power, so crafted gear cannot outrun the content it was crafted for by
  // spending adminPoints. It is therefore an honest CATCH-UP talent that goes quiet
  // at the ceiling, and the node's flavor text says exactly that in plain language
  // rather than implying permanent power.
  //
  // Payload-carrying (a number, not a bare marker like unlockCaptainSlot) for the
  // SAME reason queueDepth is: craftingItemLevelBonus (tick.ts) SUMS this payload
  // across the learned nodes rather than counting matching nodes, so a second node,
  // or a node granting more at once, lands with zero engine change. The value is
  // seeded from CRAFTING_ILEVEL_PER_NODE (below), the single source of truth.
  | { type: "craftingItemLevel"; bonus: number }
  // WR-6 (0.14.0, wiring plan OC-B2 / OC-B3, user 2026-10-15 "Give them real effects"): the three placeholder hubs,
  // live. Each is fleet-wide (Fleet Admiral prestige), read where its system already runs:
  //   fabricatorBonusOutput : the chance a Fabricator job delivers one more of its output (its own keyed roll when
  //                           the job STARTS, stamped on the job, so a job in flight never changes; tick.ts startProcess)
  //   patrolShieldMult      : the ship's shield pool and recharge on patrols, its own x (1 + mult) factor frozen per
  //                           patrol cycle with the captain combat record (captainTacticianEffects.ts)
  //   transportCrewBonus    : more crew on every crew transport (transports.ts transportBatchSize)
  | { type: "fabricatorBonusOutput"; chance: number }
  | { type: "patrolShieldMult"; mult: number }
  | { type: "transportCrewBonus"; crew: number }
  // Radial Skill Web (Task 3): a genuinely-null gateway effect, mirroring CaptainTalentEffect's own `none`. No
  // Homeworld node carries it since WR-6; it stays available for a future pure-gateway node.
  | { type: "none" };

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 1):
// the def shape moved from a linear `requires` prerequisite to a graph. The
// former `requires: <key> | null` field is REMOVED; adjacency now lives in
// `neighbors[]`, which is bidirectional by convention and drives BOTH the
// rendered connectors and the fog-of-war learnable rule (a node is learnable
// when it neighbors an owned node, seeded from the branch's `isHub`). `x`/`y`
// are web-space coordinates (branch hub at 0,0). Buy-gating switches from the
// old prerequisite check to this adjacency in Task 5.
export interface CaptainTalentDef {
  branch: CaptainTalentBranch;
  label: string;
  cost: number; // statPoints
  x: number;    // web-space coordinate; hub at (0,0)
  y: number;
  neighbors: CaptainTalentKey[]; // bidirectional by convention; drives BOTH connectors and fog-of-war
  isHub?: boolean;               // exactly one per branch; the fog-of-war seed (always visible, learn first)
  flavor: string;                // short narrative blurb, surfaced in the talent-tree tooltips
}

export interface HomeworldTalentDef {
  branch: HomeworldTalentBranch;
  label: string;
  cost: number; // adminPoints
  x: number;
  y: number;
  neighbors: HomeworldTalentKey[];
  isHub?: boolean;
  flavor: string; // short narrative blurb, surfaced in the talent-tree tooltips
  // Progression Pacing Rework (Task 9): an OPTIONAL additional Fleet-Admiral-level
  // wall LAYERED on top of this node's adminPoint `cost` + graph adjacency, both
  // still apply. Only the captain-slot unlock nodes set it today: a captain is a
  // "wall breaker" you may only recruit once your Fleet Admiral has reached the
  // required level AND you can pay the adminPoint cost AND the node is adjacency-
  // reachable (confirmed with the user 2026-07-11). Absent (undefined) => no level
  // wall, so every other Homeworld Talent is unaffected (the gate is opt-in).
  // Enforced in buyHomeworldTalent (tick.ts); the UI surfacing lands in Task 10.
  requiresFleetAdminLevel?: number;
}

// NOTE: effect lives on the *Def directly below via a second field, not nested
// inside CaptainTalentDef/HomeworldTalentDef above, TypeScript can't express
// "this interface's shape depends on which union member `effect` is" cleanly
// without generics that would over-complicate a launch table this small, so
// each entry below is typed with an explicit inline `& { effect: ... }`.

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 2):
// this table is now a radial GRAPH, not a set of linear prerequisite chains.
// Each entry carries hand-authored web-space coordinates (x/y, hub at 0,0) and
// a bidirectional `neighbors[]` adjacency list that drives BOTH the rendered
// connectors and the fog-of-war/buy-gating rule (a node is learnable once it
// neighbors an owned node; each branch is seeded by its single `isHub` node).
//
// Content this build ships (design §6.1-6.2, lean and honest):
//   - resourcefulness ("Prospector") is the ONE rich tree. Its hub plus the
//     re-homed ex-`command` extraction talents (Bulk -> Refined Extraction,
//     commonYieldMult/uncommonYieldMult, extraction yield fits the salvage
//     theme) and the existing Keen Eye I/II + Lucky Strike I/II.
//   - tactical ("Tactician") and science ("Explorer") are a single hub each.
//     WR-6 (0.14.0): each hub grants a real bonus now (Combat Readiness: weapon
//     damage in ship battles; Survey Doctrine: expedition scan rate), and their
//     deeper doctrine lives in the secondary tree (WR-5b / WR-5c).
//
// `command`/`diplomacy` are GONE (removed with the old five-column model in
// Task 1); their content is either dropped (diplomacy) or re-homed onto
// resourcefulness (command's extraction talents). Coordinates below are the
// hand-authored placement, tunable at the Task 12 device checkpoint, same
// launch-placeholder spirit as MISSIONS'/RECIPES' constants. Add entries here
// (and nowhere else, App.svelte's Captain Talents panel iterates this object)
// when a branch's system is ready.
export type CaptainTalentKey =
  // resourcefulness ("Prospector"), the rich tree
  | "prospectorHub"
  | "prospectorBulkExtraction" // ex-commandExtractionI
  | "prospectorRefinedExtraction" // ex-commandExtractionII
  | "prospectorKeenEyeI"
  | "prospectorKeenEyeII"
  | "prospectorLuckyStrikeI"
  | "prospectorLuckyStrikeII"
  // tactical ("Tactician"), its hub (weapon damage, WR-6)
  | "tacticianHub"
  // science ("Explorer"), its hub (expedition scan rate, WR-6)
  | "explorerHub";

// WR-6 (0.14.0): the sizes of the captain primary bonuses, each the wiring plan's recommended option (section 5.A),
// confirmed by the user 2026-10-19 (docs/plans/2026-10-19-merge-batch-answers.md); a retune is this one edit.
// OC-A40: Combat Readiness (tacticianHub), +5% weapon damage on the captain's ship.
export const TACTICIAN_HUB_WEAPON_DAMAGE = 0.05;
// OC-A41: Survey Doctrine (explorerHub), +5% expedition scan rate.
export const EXPLORER_HUB_SCAN_RATE = 0.05;
// OC-A42: the tactical spec's bonus, +1% weapon damage, ship weapons only, not drones (mirrors the Prospector spec's +1%).
export const TACTICAL_SPEC_WEAPON_DAMAGE = 0.01;
// OC-A42: the science spec's bonus, +1% relic find chance.
export const SCIENCE_SPEC_RELIC_FIND = 0.01;
// OC-A43 ("Same as an officer"): a captain carries its race's racial at the officer (Senior Staff) magnitude times this.
export const CAPTAIN_RACIAL_SCALE = 1;

export const CAPTAIN_TALENTS: Record<CaptainTalentKey, CaptainTalentDef & { effect: CaptainTalentEffect }> = {
  // --- resourcefulness ("Prospector") -----------------------------------
  prospectorHub: {
    branch: "resourcefulness",
    label: "Prospector's Instinct",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: ["prospectorBulkExtraction", "prospectorKeenEyeI"],
    effect: { type: "commonYieldMult", mult: 0.05 },
    flavor: "The nose for value that separates a prospector from a tourist.",
  },
  prospectorBulkExtraction: {
    branch: "resourcefulness",
    label: "Bulk Extraction",
    cost: 2,
    x: -180,
    y: -120,
    neighbors: ["prospectorHub", "prospectorRefinedExtraction"],
    effect: { type: "commonYieldMult", mult: 0.1 }, // was extractionYieldMult, ex-command
    flavor:
      "Standard doctrine trades finesse for throughput, pull more common ore per cycle, no questions asked.",
  },
  prospectorRefinedExtraction: {
    branch: "resourcefulness",
    label: "Refined Extraction",
    cost: 4,
    x: -320,
    y: -200,
    neighbors: ["prospectorBulkExtraction"],
    effect: { type: "uncommonYieldMult", mult: 0.15 }, // was extractionYieldMult, ex-command
    flavor:
      "Field engineers recalibrate the intake manifolds to favor uncommon deposits over raw volume.",
  },
  prospectorKeenEyeI: {
    branch: "resourcefulness",
    label: "Keen Eye I",
    cost: 2,
    x: 180,
    y: -120,
    neighbors: ["prospectorHub", "prospectorKeenEyeII"],
    effect: { type: "uncommonChanceMult", mult: 0.25 }, // was rareLootChanceMult
    flavor:
      "A trained eye catches what the sensors miss, subtle mineral banding invisible to standard scans.",
  },
  prospectorKeenEyeII: {
    branch: "resourcefulness",
    label: "Keen Eye II",
    cost: 4,
    x: 320,
    y: -200,
    neighbors: ["prospectorKeenEyeI", "prospectorLuckyStrikeI"],
    effect: { type: "rareChanceMult", mult: 0.5 }, // was rareLootChanceMult
    flavor: "Years of fieldwork sharpen instinct into something the manuals can't teach.",
  },
  prospectorLuckyStrikeI: {
    branch: "resourcefulness",
    label: "Lucky Strike I",
    cost: 6,
    x: 300,
    y: 40,
    neighbors: ["prospectorKeenEyeII", "prospectorLuckyStrikeII"],
    effect: { type: "bonusRollChance", chance: 0.02 },
    flavor:
      "Some captains just have a feel for where the good ore sits. Call it luck; call it experience.",
  },
  prospectorLuckyStrikeII: {
    branch: "resourcefulness",
    label: "Lucky Strike II",
    cost: 8,
    x: 420,
    y: 120,
    neighbors: ["prospectorLuckyStrikeI"],
    effect: { type: "bonusRollChanceMult", mult: 1.0 },
    flavor: "When the feeling's right twice in a row, it stops being coincidence.",
  },
  // --- tactical ("Tactician"), gateway hub only -----------------------
  tacticianHub: {
    branch: "tactical",
    label: "Combat Readiness",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // the deeper doctrine lives in the secondary tree (Gunnery, Aegis, Fleet Ops)
    effect: { type: "weaponDamageMult", mult: TACTICIAN_HUB_WEAPON_DAMAGE },
    flavor: "Discipline first. Drilled gun crews put every shot where it counts.",
  },
  // --- science ("Explorer"), gateway hub only -------------------------
  explorerHub: {
    branch: "science",
    label: "Survey Doctrine",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // the deeper doctrine lives in the secondary tree (Survey, Relics, Command)
    effect: { type: "scanRateMult", mult: EXPLORER_HUB_SCAN_RATE },
    flavor: "Every uncharted system is a question. A disciplined survey answers it sooner.",
  },
};

// Innate bonus granted once a captain has this branch chosen as their spec
// (CaptainState.spec), separate from, and additive with, whatever they've
// bought in the talent tree itself. Revives the Phase 1 "Captain Prestige panel +
// specialization picker" mechanic, expressed against this Captain Talent tree.
//
// Radial Skill Web (Task 2): the `command` entry was dropped along with the
// command branch itself. WR-6 (0.14.0, OC-A42): every spec carries a real bonus
// now. Prospector: the bonus-roll chance (tick.ts captainSpecBonusRollChance).
// Tactician and Explorer: their own x (1 + mult) factor on the captain's ship,
// read by captainPrimaryEffects.ts beside the hubs (sizes above, confirmed 2026-10-19).
// Still typed Partial so a future branch can land before its bonus.
export const CAPTAIN_SPEC_BONUS: Partial<Record<CaptainTalentBranch, CaptainTalentEffect>> = {
  resourcefulness: { type: "bonusRollChance", chance: 0.01 },
  tactical: { type: "weaponDamageMult", mult: TACTICAL_SPEC_WEAPON_DAMAGE },
  science: { type: "relicFindMult", mult: SCIENCE_SPEC_RELIC_FIND },
};

// ===========================================================================
// Captain PRESTIGE secondary talent tree (Crew 0.14.0, Phase C-3a; wired by WR-5a / 5b / 5c)
// ===========================================================================
//
// A SECOND captain-tier talent tree that DEEPENS the base tree's three identities. Points are earned
// via captain RETIREMENT (C-3b) and spent through captainSecondaryTree.ts. This block is the tree
// STRUCTURE + the catalog DATA; the allocation ENGINE is captainSecondaryTree.ts and the effect READERS
// (plus each node's player text) are captainSecondaryEffects.ts.
//
// LIVE (WR-5a, 2026-10-17): the whole PROSPECTOR tree (Extraction, Logistics, Trade). Its nodes act on
// the ship the captain commands (OC-A2), each "+X%" as a relative multiplier on the named existing value
// (OC-A1), read where that value is read (missions live, Ground Ops frozen at dispatch). logistics4 has
// been live since D26 (Ground Ops reload). The TACTICIAN and EXPLORER trees are WR-5b / WR-5c: their
// effects below are still catalog data no engine reads, and a captain owning only those nodes ticks
// byte-identically to one owning none. The registry (wiring/registry.ts) lists every node's status.
//
// Shape (mirrors CAPTAIN_TALENTS): 3 TREES x 3 BRANCHES x 5 RUNGS = 45 nodes. A fully-retired captain
// has 5 secondary points and fills EXACTLY ONE branch (all 5 rungs) = one of 9 ultimate specs. Within
// a branch the 5 rungs chain linearly rung1 <-> rung2 <-> ... <-> rung5 via `neighbors`; there are NO
// cross-branch neighbors, so a branch is an isolated chain whose rung-1 node is its only entry. Rung 5
// of every branch is the defining CAPSTONE. Content is from docs/plans/2026-09-22-crew-0.14.0-plan.md
// ("Captain PRESTIGE secondary tree - content" + the REVISION to the Prospector tree, which supersedes
// the old Fabrication branch: the Prospector tree is Extraction / Logistics / Trade).
export type SecondaryTalentTree = "prospector" | "tactician" | "explorer";

// The 9 branch ids (3 per tree). Prospector deepens `resourcefulness`, Tactician `tactical`, Explorer
// `science`. camelCase keys, closed union.
export type SecondaryTalentBranch =
  // TREE 1 - PROSPECTOR (economy/industry)
  | "extraction"
  | "logistics"
  | "trade"
  // TREE 2 - TACTICIAN (combat)
  | "gunnery"
  | "aegis"
  | "fleetOps"
  // TREE 3 - EXPLORER (frontier/crew)
  | "surveySensors"
  | "expeditionRelics"
  | "commandCrew";

// The 45 node keys (`<branch><rung>`), closed union. rung 1 = entry, 5 = capstone.
export type SecondaryTalentKey =
  // Prospector / Extraction
  | "extraction1" | "extraction2" | "extraction3" | "extraction4" | "extraction5"
  // Prospector / Logistics
  | "logistics1" | "logistics2" | "logistics3" | "logistics4" | "logistics5"
  // Prospector / Trade (the supply runs and the docked trickle)
  | "trade1" | "trade2" | "trade3" | "trade4" | "trade5"
  // Tactician / Gunnery
  | "gunnery1" | "gunnery2" | "gunnery3" | "gunnery4" | "gunnery5"
  // Tactician / Aegis
  | "aegis1" | "aegis2" | "aegis3" | "aegis4" | "aegis5"
  // Tactician / Fleet Ops
  | "fleetOps1" | "fleetOps2" | "fleetOps3" | "fleetOps4" | "fleetOps5"
  // Explorer / Survey & Sensors
  | "surveySensors1" | "surveySensors2" | "surveySensors3" | "surveySensors4" | "surveySensors5"
  // Explorer / Expedition & Relics
  | "expeditionRelics1" | "expeditionRelics2" | "expeditionRelics3" | "expeditionRelics4" | "expeditionRelics5"
  // Explorer / Command & Crew
  | "commandCrew1" | "commandCrew2" | "commandCrew3" | "commandCrew4" | "commandCrew5";

// The stable iteration order for the 3 trees and the 9 branches (helpers/UI/tests read these instead
// of re-deriving the order from the catalog). Prospector -> Tactician -> Explorer; within each tree the
// 3 branches in the plan's order.
export const SECONDARY_TALENT_TREES: readonly SecondaryTalentTree[] = ["prospector", "tactician", "explorer"];
export const SECONDARY_TALENT_BRANCHES: readonly SecondaryTalentBranch[] = [
  "extraction", "logistics", "trade",
  "gunnery", "aegis", "fleetOps",
  "surveySensors", "expeditionRelics", "commandCrew",
];

// A typed union of the secondary-tree effects (all three trees are live: WR-5a, WR-5b, WR-5c). The live
// readers (captainSecondaryEffects.ts, captainTacticianEffects.ts, captainExplorerEffects.ts) read each node
// by its KEY, never by the `stat` label, so a label is descriptive only. ALL magnitudes are tunable (the
// plan's [PROPOSAL] sizes, OC-A3).
//   none          - a gateway rung with no magnitude of its own.
//   statMult      - a relative bonus of `mult` on the named existing value (OC-A1).
//   procChance    - a chance-based effect (a find/quality/detection roll).
//   capstone      - a rung-5 defining mechanic, identified by `id`; `magnitude` is its configured size
//                   (a chance, a share or a factor, per id; its tree's reader module reads it).
//   creditTrickle - credits per tick paid while the captain is docked (Trade Routes).
//   levelLift     - WR-5c: whole LEVELS added to a named display ladder (Foreknowledge: the telescope detail).
export type CaptainSecondaryTalentEffect =
  | { type: "none" }
  | { type: "statMult"; stat: string; mult: number }
  | { type: "procChance"; chance: number }
  | { type: "capstone"; id: string; magnitude?: number }
  | { type: "creditTrickle"; perTick: number }
  | { type: "levelLift"; stat: string; levels: number };

// Mirrors CaptainTalentDef's shape (branch/label/cost/neighbors/effect/flavor/x/y), plus `tree` +
// `rung`. `cost` is always 1 secondary point. `neighbors` is bidirectional by convention (like the
// base tree) and, within the secondary tree, is strictly the intra-branch linear chain.
export interface CaptainSecondaryTalentDef {
  tree: SecondaryTalentTree;
  branch: SecondaryTalentBranch;
  rung: 1 | 2 | 3 | 4 | 5;
  label: string;
  cost: number; // secondaryPoints; always 1
  neighbors: SecondaryTalentKey[]; // bidirectional; intra-branch linear chain only (no cross-branch links)
  isHub?: boolean; // exactly one per branch = its rung-1 entry; the fog-of-war seed (always visible, learn first), mirroring CaptainTalentDef. RadialWeb needs it to render an un-started branch.
  effect: CaptainSecondaryTalentEffect; // live for the Prospector tree (WR-5a); see the header above
  flavor: string; // short narrative blurb, for the later talent-tree tooltips
  x: number; // web-space coordinate; FIRST-PASS TUNABLE (the radial layout mockup comes at the UI phase)
  y: number; // FIRST-PASS TUNABLE
}

// The 45-node catalog. Coordinates lay the 3 trees out in 3 radial sectors (Prospector top, Tactician
// lower-left, Explorer lower-right), each tree's 3 branches fanning outward, each branch a 5-rung chain
// stepping away from the center. ALL x/y are FIRST-PASS TUNABLE placeholders (same launch-placeholder
// spirit as CAPTAIN_TALENTS' own coordinates); the real layout is authored from a mockup at the UI
// phase. Magnitudes/chances/capstone ids are likewise FIRST-PASS TUNABLE.
export const SECONDARY_CAPTAIN_TALENTS: Record<SecondaryTalentKey, CaptainSecondaryTalentDef> = {
  // ============ TREE 1 - PROSPECTOR ============
  // --- Extraction (-> Motherlode) ---
  extraction1: {
    tree: "prospector", branch: "extraction", rung: 1, isHub: true,
    label: "Prospector's Eye", cost: 1,
    x: 41, y: 113, neighbors: ["extraction2"],
    effect: { type: "statMult", stat: "extractionYield", mult: 0.05 }, // x (1 + mult) on the ship's extractionYieldMult (all tiers, extraction + survey)
    flavor: "You read a survey scan the way others read a map: value first, everything else second.",
  },
  extraction2: {
    tree: "prospector", branch: "extraction", rung: 2,
    label: "Deep Veins", cost: 1,
    x: 75, y: 207, neighbors: ["extraction1", "extraction3"],
    effect: { type: "statMult", stat: "findChance", mult: 0.05 }, // its own x (1 + mult) factor on the mission's rare AND uncommon chances (the existing rolls)
    flavor: "The richest seams hide below the obvious ones. You have learned where to look.",
  },
  extraction3: {
    tree: "prospector", branch: "extraction", rung: 3,
    label: "Efficient Haul", cost: 1,
    x: 109, y: 301, neighbors: ["extraction2", "extraction4"],
    effect: { type: "statMult", stat: "extractionSpeed", mult: 0.08 }, // x (1 + mult) on extractionSpeedMult: a shorter extracting phase
    flavor: "A tighter cut of the extraction cycle means more runs before the shift is done.",
  },
  extraction4: {
    tree: "prospector", branch: "extraction", rung: 4,
    label: "Assayer", cost: 1, // util
    x: 144, y: 395, neighbors: ["extraction3", "extraction5"],
    effect: { type: "statMult", stat: "deliveryQuality", mult: 0.05 }, // the rollQuality bonus of this captain's OWN deliveries (each climb x (1 + mult))
    flavor: "You grade ore by feel now, culling the dross before it ever reaches the hold.",
  },
  extraction5: {
    tree: "prospector", branch: "extraction", rung: 5,
    label: "Motherlode", cost: 1, // CAPSTONE
    x: 178, y: 489, neighbors: ["extraction4"],
    effect: { type: "capstone", id: "motherlode", magnitude: 0.05 }, // the chance per delivered non-transport cycle that its haul doubles (private salted stream)
    flavor: "Once in a career a prospector cracks a deposit that pays for the whole ship. You do it on schedule.",
  },
  // --- Logistics (-> Overloaded Holds) [revised: hauling, not trade] ---
  logistics1: {
    tree: "prospector", branch: "logistics", rung: 1, isHub: true,
    label: "Quartermaster", cost: 1,
    x: 0, y: 120, neighbors: ["logistics2"],
    effect: { type: "statMult", stat: "cargoCapacity", mult: 0.05 }, // x (1 + mult) on cargoCapacity (counts toward cargo gates)
    flavor: "Every centimeter of hold is inventoried, stacked, and accounted for.",
  },
  logistics2: {
    tree: "prospector", branch: "logistics", rung: 2,
    label: "Fuel Discipline", cost: 1,
    x: 0, y: 220, neighbors: ["logistics1", "logistics3"],
    effect: { type: "statMult", stat: "fuelEfficiency", mult: 0.05 }, // (1 + engineEfficiency) x (1 + mult): +mult reach (burn reads the same value)
    flavor: "You coax more reach out of every drop, plotting burns a lazier captain would waste.",
  },
  logistics3: {
    tree: "prospector", branch: "logistics", rung: 3,
    label: "Rapid Turnaround", cost: 1,
    x: 0, y: 320, neighbors: ["logistics2", "logistics4"],
    effect: { type: "statMult", stat: "unloadSpeed", mult: 0.08 }, // x (1 + mult) on unloadSpeedMult (missions and the Ground Ops offload)
    flavor: "A hold empties fastest when the crew already knows where every crate goes.",
  },
  logistics4: {
    tree: "prospector", branch: "logistics", rung: 4,
    label: "Efficient Stowage", cost: 1, // util
    x: 0, y: 420, neighbors: ["logistics3", "logistics5"],
    effect: { type: "statMult", stat: "loadSpeed", mult: 0.08 }, // + mult on the Ground Ops reload divisor (D26)
    flavor: "Loading is choreography. Yours is rehearsed to the second.",
  },
  logistics5: {
    tree: "prospector", branch: "logistics", rung: 5,
    label: "Overloaded Holds", cost: 1, // CAPSTONE
    x: 0, y: 520, neighbors: ["logistics4"],
    effect: { type: "capstone", id: "overloadedHolds", magnitude: 0.1 }, // the share of extra cargo above the hold; the unload still scales with the hold
    flavor: "The manifest says the hold is full. You have found the margin the manifest forgot.",
  },
  // Trade (-> Trade Baron): the supply runs (transport missions) and the docked trickle, WR-5a
  trade1: {
    tree: "prospector", branch: "trade", rung: 1, isHub: true,
    label: "Market Contacts", cost: 1,
    x: -41, y: 113, neighbors: ["trade2"],
    effect: { type: "statMult", stat: "transportMargin", mult: 0.05 }, // x (1 + mult) on a supply run's rewardMargin (a factor beside trade3's)
    flavor: "A name at every dock and a favor owed at most of them.",
  },
  trade2: {
    tree: "prospector", branch: "trade", rung: 2,
    label: "Shrewd Negotiator", cost: 1,
    x: -75, y: 207, neighbors: ["trade1", "trade3"],
    effect: { type: "statMult", stat: "supplyCost", mult: 0.05 }, // the supplies cost x (1 - mult); the sale value is unchanged
    flavor: "You never take the first price, and rarely the second.",
  },
  trade3: {
    tree: "prospector", branch: "trade", rung: 3,
    label: "Premium Goods", cost: 1,
    x: -109, y: 301, neighbors: ["trade2", "trade4"],
    effect: { type: "statMult", stat: "transportMargin", mult: 0.05 }, // x (1 + mult) on a supply run's rewardMargin (a factor beside trade1's)
    flavor: "Presentation is half the margin. Your holds sell before they open.",
  },
  trade4: {
    tree: "prospector", branch: "trade", rung: 4,
    label: "Trade Routes", cost: 1, // util
    x: -144, y: 395, neighbors: ["trade3", "trade5"],
    effect: { type: "creditTrickle", perTick: 1 }, // [PROVISIONAL] credits per tick while docked, once the fleet has delivered a supply run
    flavor: "A route run enough times runs itself, and pays whether you sail it or not.",
  },
  trade5: {
    tree: "prospector", branch: "trade", rung: 5,
    label: "Trade Baron", cost: 1, // CAPSTONE
    x: -178, y: 489, neighbors: ["trade4"],
    effect: { type: "capstone", id: "tradeBaron", magnitude: 2 }, // the factor on every Trade 1 to 4 value (margin, discount, trickle)
    flavor: "Fleets move when you say the price is right. The market bends to the baron.",
  },
  // ============ TREE 2 - TACTICIAN ============
  // --- Gunnery (-> Alpha Strike) ---
  gunnery1: {
    tree: "tactician", branch: "gunnery", rung: 1, isHub: true,
    label: "Weapons Drill", cost: 1,
    x: -118, y: -21, neighbors: ["gunnery2"],
    effect: { type: "statMult", stat: "weaponDamage", mult: 0.05 },
    flavor: "A gun crew drilled to reflex hits harder than one that has to think.",
  },
  gunnery2: {
    tree: "tactician", branch: "gunnery", rung: 2,
    label: "Marksman", cost: 1,
    x: -217, y: -38, neighbors: ["gunnery1", "gunnery3"],
    effect: { type: "statMult", stat: "weaponAccuracy", mult: 0.05 },
    flavor: "You place shots where the armor is thin and the crew is thinner.",
  },
  gunnery3: {
    tree: "tactician", branch: "gunnery", rung: 3,
    label: "Overcharge", cost: 1,
    x: -315, y: -56, neighbors: ["gunnery2", "gunnery4"],
    effect: { type: "statMult", stat: "damageVsHighHealth", mult: 0.08 }, // +damage vs high-health targets
    flavor: "The bigger the hull, the more it hurts when you pour it on.",
  },
  gunnery4: {
    tree: "tactician", branch: "gunnery", rung: 4,
    label: "Ammo Reserves", cost: 1, // util
    x: -414, y: -73, neighbors: ["gunnery3", "gunnery5"],
    effect: { type: "statMult", stat: "weaponCooldown", mult: 0.08 }, // faster weapon cooldown
    flavor: "Deep magazines and a loader who never rests keep the volleys coming.",
  },
  gunnery5: {
    tree: "tactician", branch: "gunnery", rung: 5,
    label: "Alpha Strike", cost: 1, // CAPSTONE
    x: -512, y: -90, neighbors: ["gunnery4"],
    effect: { type: "capstone", id: "alphaStrike", magnitude: 0.5 }, // WR-5b: +50% damage on each weapon's first shot of a battle
    flavor: "The first exchange is the whole fight. You make sure it is the last one they choose.",
  },
  // --- Aegis / defense (-> Bulwark) ---
  aegis1: {
    tree: "tactician", branch: "aegis", rung: 1, isHub: true,
    label: "Shield Discipline", cost: 1,
    x: -104, y: -60, neighbors: ["aegis2"],
    effect: { type: "statMult", stat: "shieldEffectiveness", mult: 0.05 },
    flavor: "A shield held at the right facing outlasts one twice its rating.",
  },
  aegis2: {
    tree: "tactician", branch: "aegis", rung: 2,
    label: "Reinforced Hull", cost: 1,
    x: -191, y: -110, neighbors: ["aegis1", "aegis3"],
    effect: { type: "statMult", stat: "hullArmor", mult: 0.05 }, // +hull / armor
    flavor: "Bracing, ablative plate, and a stubborn refusal to come apart.",
  },
  aegis3: {
    tree: "tactician", branch: "aegis", rung: 3,
    label: "Damage Control", cost: 1,
    x: -277, y: -160, neighbors: ["aegis2", "aegis4"],
    effect: { type: "statMult", stat: "hullRepairRate", mult: 0.08 }, // +hull repair rate
    flavor: "Your damage teams patch a breach before the alarm finishes sounding.",
  },
  aegis4: {
    tree: "tactician", branch: "aegis", rung: 4,
    label: "Point Defense", cost: 1, // util
    x: -364, y: -210, neighbors: ["aegis3", "aegis5"],
    effect: { type: "statMult", stat: "evasion", mult: 0.05 }, // +evasion / incoming-fire mitigation
    flavor: "Half the incoming fire never reaches the hull. You made sure of that.",
  },
  aegis5: {
    tree: "tactician", branch: "aegis", rung: 5,
    label: "Bulwark", cost: 1, // CAPSTONE
    x: -450, y: -260, neighbors: ["aegis4"],
    effect: { type: "capstone", id: "bulwark", magnitude: 1 }, // WR-5b: lethal hits survived per battle (each leaves 1 hull)
    flavor: "They threw everything at you and you were still there when the smoke cleared.",
  },
  // Fleet Ops / drones and patrols (WR-5b: rung 4 acts on the drone screen until a multi-ship fleet-ops system exists)
  fleetOps1: {
    tree: "tactician", branch: "fleetOps", rung: 1, isHub: true,
    label: "Drone Handler", cost: 1,
    x: -77, y: -92, neighbors: ["fleetOps2"],
    effect: { type: "statMult", stat: "droneEffectiveness", mult: 0.05 },
    flavor: "Your drones fly like they know what you want before you signal it.",
  },
  fleetOps2: {
    tree: "tactician", branch: "fleetOps", rung: 2,
    label: "Squadron Tactics", cost: 1,
    x: -141, y: -169, neighbors: ["fleetOps1", "fleetOps3"],
    effect: { type: "statMult", stat: "droneDurability", mult: 0.05 }, // +drone hp / accuracy
    flavor: "A squadron that covers each other loses far fewer of its own.",
  },
  fleetOps3: {
    tree: "tactician", branch: "fleetOps", rung: 3,
    label: "Patrol Efficiency", cost: 1,
    x: -206, y: -245, neighbors: ["fleetOps2", "fleetOps4"],
    effect: { type: "statMult", stat: "patrolReturns", mult: 0.08 }, // +patrol returns
    flavor: "You wring a full sweep's worth of results out of half a sweep's fuel.",
  },
  fleetOps4: {
    tree: "tactician", branch: "fleetOps", rung: 4,
    label: "Wing Commander", cost: 1, // util
    x: -270, y: -322, neighbors: ["fleetOps3", "fleetOps5"],
    effect: { type: "statMult", stat: "droneReplenish", mult: 0.05 }, // WR-5b [PROVISIONAL] (plan 5.A): the drone screen's replenish rate (no multi-ship system yet)
    flavor: "One captain, many hulls, a single mind moving them.",
  },
  fleetOps5: {
    tree: "tactician", branch: "fleetOps", rung: 5,
    label: "Wolfpack", cost: 1, // CAPSTONE
    x: -334, y: -398, neighbors: ["fleetOps4"],
    effect: { type: "capstone", id: "wolfpack", magnitude: 1 }, // WR-5b: extra drone squadrons (copies of the first installed pod's)
    flavor: "They do not fight a ship. They fight the pack, and the pack fights as one.",
  },
  // ============ TREE 3 - EXPLORER ============
  // --- Survey & Sensors (-> Deep Scan) ---
  surveySensors1: {
    tree: "explorer", branch: "surveySensors", rung: 1, isHub: true,
    label: "Keen Sensors", cost: 1,
    x: 77, y: -92, neighbors: ["surveySensors2"],
    effect: { type: "statMult", stat: "sensorsPower", mult: 0.05 },
    flavor: "You tune an array to hear the whisper under the noise.",
  },
  surveySensors2: {
    tree: "explorer", branch: "surveySensors", rung: 2,
    label: "Cartographer", cost: 1,
    x: 141, y: -169, neighbors: ["surveySensors1", "surveySensors3"],
    effect: { type: "statMult", stat: "scanRate", mult: 0.08 }, // +scan % / sec
    flavor: "An unknown system resolves into a chart under your patient sweep.",
  },
  surveySensors3: {
    tree: "explorer", branch: "surveySensors", rung: 3,
    label: "Anomaly Sense", cost: 1,
    x: 206, y: -245, neighbors: ["surveySensors2", "surveySensors4"],
    effect: { type: "procChance", chance: 0.05 }, // +rare / anomaly detection
    flavor: "The readings that make other captains shrug make you change heading.",
  },
  surveySensors4: {
    tree: "explorer", branch: "surveySensors", rung: 4,
    label: "Foreknowledge", cost: 1, // util (WR-5c: the candidate telescope reading)
    x: 270, y: -322, neighbors: ["surveySensors3", "surveySensors5"],
    effect: { type: "levelLift", stat: "telescopeDetail", levels: 1 }, // WR-5c: + this many telescope detail levels on the expedition candidates
    flavor: "You know what waits at the next star before you burn for it.",
  },
  surveySensors5: {
    tree: "explorer", branch: "surveySensors", rung: 5,
    label: "Deep Scan", cost: 1, // CAPSTONE
    x: 334, y: -398, neighbors: ["surveySensors4"],
    effect: { type: "capstone", id: "deepScan", magnitude: 1 }, // WR-5c: full foreknowledge at launch + this many sure discovery attempts per body
    flavor: "One pass and the whole system gives up its secrets, including the one it was hiding.",
  },
  // --- Expedition & Relics (-> Relic Hunter) ---
  expeditionRelics1: {
    tree: "explorer", branch: "expeditionRelics", rung: 1, isHub: true,
    label: "Expedition Lead", cost: 1,
    x: 104, y: -60, neighbors: ["expeditionRelics2"],
    effect: { type: "statMult", stat: "groundTeamEffectiveness", mult: 0.05 },
    flavor: "A team led well comes back whole, and comes back with more.",
  },
  expeditionRelics2: {
    tree: "explorer", branch: "expeditionRelics", rung: 2,
    label: "Field Science", cost: 1,
    x: 191, y: -110, neighbors: ["expeditionRelics1", "expeditionRelics3"],
    effect: { type: "procChance", chance: 0.05 }, // +relic / finding chance
    flavor: "You find meaning in the rubble that others walk right past.",
  },
  expeditionRelics3: {
    tree: "explorer", branch: "expeditionRelics", rung: 3,
    label: "Away-Team Doctrine", cost: 1,
    x: 277, y: -160, neighbors: ["expeditionRelics2", "expeditionRelics4"],
    effect: { type: "statMult", stat: "gambitWinOdds", mult: 0.05 }, // +gambit win odds
    flavor: "A drilled team wins the encounter before the first move is made.",
  },
  expeditionRelics4: {
    tree: "explorer", branch: "expeditionRelics", rung: 4,
    label: "Preservationist", cost: 1, // util
    x: 364, y: -210, neighbors: ["expeditionRelics3", "expeditionRelics5"],
    effect: { type: "statMult", stat: "relicQuality", mult: 0.08 }, // +relic quality / relic-research speed
    flavor: "A relic recovered with care is worth three hauled out with a crowbar.",
  },
  expeditionRelics5: {
    tree: "explorer", branch: "expeditionRelics", rung: 5,
    label: "Relic Hunter", cost: 1, // CAPSTONE
    x: 450, y: -260, neighbors: ["expeditionRelics4"],
    effect: { type: "capstone", id: "relicHunter", magnitude: 1 }, // WR-5c: the relic rarity tier ceiling + this many tiers
    flavor: "Where there is a legend, there is a relic, and you have never come home empty.",
  },
  // --- Command & Crew (-> Legendary Captain) ---
  commandCrew1: {
    tree: "explorer", branch: "commandCrew", rung: 1, isHub: true,
    label: "Inspiring Leader", cost: 1,
    x: 118, y: -21, neighbors: ["commandCrew2"],
    effect: { type: "statMult", stat: "crewEffectiveness", mult: 0.05 }, // +complement crew effectiveness
    flavor: "A crew that believes in the captain does the work of a crew twice its size.",
  },
  commandCrew2: {
    tree: "explorer", branch: "commandCrew", rung: 2,
    label: "Mentor", cost: 1,
    x: 217, y: -38, neighbors: ["commandCrew1", "commandCrew3"],
    effect: { type: "statMult", stat: "officerOutput", mult: 0.05 }, // +officer output / faster candidate refresh
    flavor: "The officers who served under you go on to captain their own.",
  },
  commandCrew3: {
    tree: "explorer", branch: "commandCrew", rung: 3,
    label: "Drillmaster", cost: 1,
    x: 315, y: -56, neighbors: ["commandCrew2", "commandCrew4"],
    effect: { type: "statMult", stat: "promotionProgress", mult: 0.08 }, // faster promotion-objective progress
    flavor: "Under your watch a green cadet earns the pips in half the usual time.",
  },
  commandCrew4: {
    tree: "explorer", branch: "commandCrew", rung: 4,
    label: "Recruiter", cost: 1, // util
    x: 414, y: -73, neighbors: ["commandCrew3", "commandCrew5"],
    effect: { type: "statMult", stat: "candidateRosterSize", mult: 0.08 }, // +candidate roster size / +crew capacity
    flavor: "The best hands in the sector hear you are hiring and come looking for you.",
  },
  commandCrew5: {
    tree: "explorer", branch: "commandCrew", rung: 5,
    label: "Legendary Captain", cost: 1, // CAPSTONE
    x: 512, y: -90, neighbors: ["commandCrew4"],
    effect: { type: "capstone", id: "legendaryCaptain", magnitude: 0.1 }, // WR-5c: x (1 + this) on the ship's complement buffs AND officer bonuses
    flavor: "They will tell stories about serving under you long after the ship is scrap.",
  },
};

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 3):
// this table is now a radial GRAPH, one hub per HomeworldTalentBranch (exactly
// 5 hubs, each `isHub: true` at x:0,y:0 within its category), not a set of
// linear `requires` chains. The former `requires` field is REMOVED; adjacency
// now lives in `neighbors[]` (bidirectional by convention), which drives BOTH
// the rendered connectors and the fog-of-war/buy-gating rule (a node is
// learnable once it neighbors an owned node; each category is seeded by its
// single hub). Buy-gating switches from `requires` to this adjacency in Task 5.
//
// CRITICAL: every pre-existing key string is preserved UNCHANGED
// (fleetLogisticsSlot1/2/3, fleetLogisticsYield, industryBonusOutput,
// economyTrickle) so existing saves' unlockedHomeworldTalents stay valid --
// Task 6's migration deliberately does NOT refund Homeworld talents because
// they survive by key. Only the 5 new hub keys + the graph fields are ADDED.
//
// Content this build ships (design §6.3, lean and honest):
//   - Fleet Logistics is the ONE rich category: hub -> Slot1 -> Slot2 -> Slot3
//     (the existing slot-unlock chain, now via neighbors) with fleetLogisticsYield
//     hanging directly off the hub. Fully replaces the old CAPTAIN_SLOT_UNLOCKS
//     table/unlockCaptainSlot() mechanism (removed in an earlier task).
//   - Economy hub -> economyTrickle; Industry hub -> industryBonusOutput (one
//     existing content node each).
//   - Homeland Defense and Citizenry are HUB-ONLY (neighbors: []). Their real
//     mechanics (a Battlespace/defense system, a population system) don't exist
//     yet, so their hubs carry a `{ type: "none" }` effect (an honest "no bonus
//     yet", NOT a misleading 0.0 yield placeholder) and grow later. No inert
//     filler nodes are authored for them, same reasoning as the captain
//     Tactician/Explorer hubs.
// Costs/coordinates below are launch placeholders, same as CAPTAIN_TALENTS' own
//, not balance-tested; coordinates tunable at the Task 12 device checkpoint.
export type HomeworldTalentKey =
  // fleetLogistics, the rich category
  | "fleetLogisticsHub"
  | "fleetLogisticsSlot1"
  | "fleetLogisticsSlot2"
  | "fleetLogisticsSlot3"
  | "fleetLogisticsYield"
  // homelandDefense, hub-only gateway stub until a defense system exists
  | "homelandDefenseHub"
  // citizenry, hub-only gateway stub until a population system exists
  | "citizenryHub"
  // economy, hub + one existing content node
  | "economyHub"
  | "economyTrickle"
  // fleetLogistics: the combined Fleet-Admiral salvage talent (0.11.0 Task C4)
  | "fleetLogisticsSalvage"
  // fleetLogistics: the queue-depth chain (Crafting 0.13.3, Phase 1 Unit 1.2).
  // Three NEW keys only, nothing renamed, so existing saves' unlockedHomeworldTalents
  // stay valid with no migration (talents persist BY KEY, the same reason the Task 3
  // web rewrite and the Task C4 salvage node needed none).
  | "fleetLogisticsQueue1"
  | "fleetLogisticsQueue2"
  | "fleetLogisticsQueue3"
  // fleetLogistics: the PER-FACILITY depth fan (Infrastructure 0.13.4, Phase 1 Unit 1.1).
  // Five NEW keys, nothing renamed and nothing re-scoped, so existing saves stay valid with
  // no migration for the same reason the trunk needed none: talents persist BY KEY.
  // ⚠️ There is deliberately NO fuelDepot key. See the effect type's note.
  | "fleetLogisticsQueueRefinery"
  | "fleetLogisticsQueueFabricator"
  | "fleetLogisticsQueueSalvageBay"
  | "fleetLogisticsQueueResearchLab"
  | "fleetLogisticsQueueShipyard"
  // industry, hub + one existing content node
  | "industryHub"
  | "industryBonusOutput";

// 0.11.0 Storage/Salvage (Task C4): the tunable knobs for the combined salvage
// talent (fleetLogisticsSalvage below). FIRST-PASS values, TUNABLE here, they are
// the SINGLE source of truth: the talent def embeds them in its `salvageBoost`
// effect payload, and salvage.ts reads that payload back (never re-declaring the
// numbers), so changing them here changes the live bonus with no second edit.
//   YIELD_BONUS   +0.10 flat onto salvageEquipment's recovery fraction (~10 pts
//                 more of every recycled system's crafting inputs come back).
//   CEILING_BONUS +1 loot-tier INDEX onto salvageSalvagedMaterial's roll ceiling
//                 (unlocks one rarity tier above what the player's Fleet Admiral
//                 level alone reaches, and clamps to the pool's real top in
//                 salvage.ts so it can never index past the defined tiers).
export const SALVAGE_TALENT_YIELD_BONUS = 0.1;
export const SALVAGE_TALENT_CEILING_BONUS = 1;

// WR-6 (0.14.0, OC-B2 / OC-B3, user 2026-10-15 "Give them real effects": Home Guard helps patrol combat, Civic Charter
// helps crew recruitment, Works Directorate gives a Fabricator bonus and keeps gating the Refinery). The user named
// what each does; the sizes are the wiring plan's proposals, approved by the user 2026-10-19 ("Approve all").
// OC-B2: Works Directorate, the chance a Fabricator job delivers one more of its output.
export const WORKS_DIRECTORATE_BONUS_CHANCE = 0.05;
// OC-B3: Home Guard, +5% shield capacity and recharge on patrols.
export const HOME_GUARD_PATROL_SHIELD = 0.05;
// OC-B3: Civic Charter, +1 crew on every crew transport.
export const CIVIC_CHARTER_TRANSPORT_CREW = 1;

// Crafting 0.13.3 (Phase 1 Unit 1.2, design §5.2): how much queue depth ONE node of
// the fleetLogisticsQueue1/2/3 chain grants. SINGLE SOURCE OF TRUTH: each node embeds
// this in its `queueDepth` effect payload and tick.ts's queueDepth() helper sums those
// payloads back, so retuning the grant is a one-line edit here (exactly how the
// SALVAGE_TALENT_* consts above feed salvageBoost). +1 per node is the design's
// proposal: depth is a scarce, deliberately-bought resource, not a free-flowing one.
export const QUEUE_DEPTH_PER_NODE = 1;

// Infrastructure 0.13.4 (Phase 1 Unit 1.1, design §8 + §17.1 Q12): the three tunables for
// the PER-FACILITY depth branch. Single source of truth, same discipline as the trunk's
// QUEUE_DEPTH_PER_NODE directly above.
//
// ⚠️ IDENTICAL ACROSS ALL FIVE NODES, ON PURPOSE. The user picked the cost (§17.1 Q12) and
// the structural half of that decision is the uniformity: differing costs would implicitly
// favour one facility, and there is no design reason to say a Refinery queue slot is worth
// more than a Shipyard one. If a future release ever wants to price them apart, that is a
// deliberate balance decision and these constants should be replaced by a per-facility
// table, not quietly edited into a spread.
export const FACILITY_QUEUE_DEPTH_PER_NODE = 1;
// The user chose 8 over the recommended 6 (§17.1 Q12): per-facility depth is deliberately a
// LATE purchase, so the shared trunk carries most players for longer.
export const FACILITY_QUEUE_DEPTH_NODE_COST = 8;
// ...and FA 12 over the recommended 10, for the same reason.
export const FACILITY_QUEUE_DEPTH_FA_WALL = 12;

// Crafting 0.13.3 (Phase 3 Unit 3.3, design §6.5): how many ITEM LEVELS one node of
// the `craftingItemLevel` effect grants a crafted piece. SINGLE SOURCE OF TRUTH, the
// same discipline as QUEUE_DEPTH_PER_NODE and the SALVAGE_TALENT_* consts above: the
// node embeds this in its effect payload and tick.ts's craftingItemLevelBonus() helper
// sums those payloads back, so retuning the grant is a one-line edit here.
//
// +2 is the design's proposal. WHY SO SMALL: the grant is measured against a per-tier
// ceiling of EQUIPMENT_ILEVEL_CAP_PER_TIER (20, itemgen.ts), so +2 is a tenth of one
// content tier's whole iLevel range, enough to feel like a head start on a fresh tier
// and far too little to matter once the player is at the ceiling. That asymmetry IS
// the intended shape (see the ⚠️ hard-cap note on the effect member above), not a
// tuning accident.
export const CRAFTING_ILEVEL_PER_NODE = 2;

export const HOMEWORLD_TALENTS: Record<HomeworldTalentKey, HomeworldTalentDef & { effect: HomeworldTalentEffect }> = {
  // --- fleetLogistics, the rich category ------------------------------
  // hub -> Slot1 -> Slot2 -> Slot3 (the slot-unlock chain), plus Yield off hub.
  fleetLogisticsHub: {
    branch: "fleetLogistics",
    label: "Fleet Command",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    // Three spokes off the one rich category's hub: the captain-slot chain runs
    // up-left, Requisitions/Salvage up-right, and the 0.13.3 queue-depth chain
    // down-left. Hanging the queue chain off the HUB (rather than deeper, past
    // Requisitions) is the "you upgrade the machine, the whole machine gets deeper
    // buffers" fiction from design §5.2: scheduling capacity is a Fleet Command
    // property, not a downstream consequence of salvage or requisitions.
    neighbors: ["fleetLogisticsSlot1", "fleetLogisticsYield", "fleetLogisticsQueue1"],
    // A modest real starter effect (mirrors the captain prospectorHub, which
    // carries a real commonYieldMult on the one rich tree), rareYieldMult is
    // thematically apt for a logistics/requisitions category.
    effect: { type: "rareYieldMult", mult: 0.02 },
    flavor: "The standing authority that turns a scattering of ships into a fleet.",
  },
  // Progression Pacing Rework (Task 9): the LATER slot-unlock nodes carry an
  // additional requiresFleetAdminLevel wall (enforced in buyHomeworldTalent),
  // LAYERED on top of each node's adminPoint `cost` + adjacency, both the cost
  // AND the level must be satisfied to recruit. The intended ladder is a ~x5
  // climb per captain, but the FIRST unlock (Slot1 = 2nd captain) is UNGATED:
  //   2nd slot (Slot1) -> UNGATED,  3rd slot (Slot2) -> FA L5,  4th slot (Slot3) -> FA L25,
  //   5th slot (Slot4) -> FA L125.
  // Slot1's old L1 wall was a FUNCTIONAL NO-OP (players start at FA level 1, so
  // "requires L1" was always already satisfied) and was REMOVED per user request
  //, the first unlock rung is intentionally free of any FA-level gate now, so
  // fleetLogisticsSlot1 simply carries no requiresFleetAdminLevel field at all.
  // Only Slot1/2/3 exist today, so only the L5/L25 walls ship, the L125 rung
  // lands automatically when a fleetLogisticsSlot4 node is created (no placeholder
  // node is added here: "no placeholders" / YAGNI). The L5/L25 numbers are
  // tunable starting values (device-playtest will move them first, same as the
  // XP curve).
  fleetLogisticsSlot1: {
    branch: "fleetLogistics",
    label: "Recruit Captain (2nd slot)",
    cost: 3,
    x: -180,
    y: -120,
    neighbors: ["fleetLogisticsHub", "fleetLogisticsSlot2"],
    effect: { type: "unlockCaptainSlot" },
    // No requiresFleetAdminLevel: the first captain unlock is intentionally
    // ungated (still costs adminPoints + needs graph adjacency to the hub).
    flavor: "Fleet Command approves a second commission, the roster grows.",
  },
  fleetLogisticsSlot2: {
    branch: "fleetLogistics",
    label: "Recruit Captain (3rd slot)",
    cost: 5,
    x: -320,
    y: -200,
    neighbors: ["fleetLogisticsSlot1", "fleetLogisticsSlot3"],
    effect: { type: "unlockCaptainSlot" },
    requiresFleetAdminLevel: 5,
    flavor: "A third captain's chair, funded and ready. The fleet expands.",
  },
  fleetLogisticsSlot3: {
    branch: "fleetLogistics",
    label: "Recruit Captain (4th slot)",
    cost: 8,
    x: -440,
    y: -280,
    neighbors: ["fleetLogisticsSlot2"],
    effect: { type: "unlockCaptainSlot" },
    requiresFleetAdminLevel: 25,
    flavor: "Four commands under one banner, logistics finally caught up with ambition.",
  },
  fleetLogisticsYield: {
    branch: "fleetLogistics",
    label: "Fleet Requisitions",
    cost: 4,
    x: 180,
    y: -120,
    // Now ALSO neighbors the salvage node (below): the requisitions node is the
    // thematic on-ramp to salvage (both turn recovered/redirected material into
    // fleet reserves), so Salvage Operations hangs one hop past it.
    neighbors: ["fleetLogisticsHub", "fleetLogisticsSalvage"],
    effect: { type: "rareYieldMult", mult: 0.05 }, // was fleetExtractionYieldMult
    flavor:
      "Standing orders redirect a share of every rare find straight back to the fleet's reserves.",
  },
  // 0.11.0 Storage/Salvage (Task C4): the ONE combined Fleet-Admiral salvage
  // talent. Placed in fleetLogistics (the fleet/requisitions category) one hop
  // past Fleet Requisitions, both are about routing recovered material back to
  // the fleet. Its `salvageBoost` effect carries BOTH bumps (recycle yield +
  // loot ceiling); salvage.ts (salvageTalentBonus) reads them off this payload,
  // so the SALVAGE_TALENT_* consts above are the only place the values live.
  fleetLogisticsSalvage: {
    branch: "fleetLogistics",
    label: "Salvage Operations",
    cost: 6,
    x: 320,
    y: -200,
    neighbors: ["fleetLogisticsYield"],
    effect: {
      type: "salvageBoost",
      yieldBonus: SALVAGE_TALENT_YIELD_BONUS,
      ceilingBonus: SALVAGE_TALENT_CEILING_BONUS,
    },
    flavor:
      "A dedicated salvage corps strips every wreck and spare hull to the bolt, and knows where the rare tech hides.",
  },
  // Crafting 0.13.3 (Phase 1 Unit 1.2, design §5.2): the QUEUE-DEPTH chain, the
  // "RAM is expensive" investment track. Authored to MIRROR the fleetLogisticsSlot1/2/3
  // chain above in every structural respect, because that chain is the established
  // precedent for a 3-rung escalating Fleet-Logistics ladder:
  //   - identical adminPoint costs (3 / 5 / 8),
  //   - identical Fleet-Admiral-level walls (rung 1 UNGATED so the first upgrade is
  //     reachable early, then L5, then L25; enforced in buyHomeworldTalent, tick.ts),
  //   - a straight-line adjacency chain hanging off the hub, one hop per rung,
  //   - the same 140/80 web-space step per rung, laid DOWN-left where the slot chain
  //     runs UP-left, so the two ladders read as a mirrored pair and neither crosses
  //     the Requisitions/Salvage spoke on the right.
  // A 4th rung later needs NO engine change: queueDepth() (tick.ts) sums payloads.
  //
  // EFFECT SCOPE, worth stating next to the data: each rung grants its depth to EVERY
  // queue-capable facility independently (design §5.2 chose per-facility over a shared
  // pool so one facility's queue can never silently starve another's).
  fleetLogisticsQueue1: {
    branch: "fleetLogistics",
    label: "Standing Orders (2nd queued slot)",
    cost: 3,
    x: -180,
    y: 120,
    neighbors: ["fleetLogisticsHub", "fleetLogisticsQueue2"],
    effect: { type: "queueDepth", depth: QUEUE_DEPTH_PER_NODE },
    // No requiresFleetAdminLevel: like the first captain-slot rung, the first queue
    // rung is intentionally ungated (it still costs adminPoints and needs adjacency).
    flavor:
      "A second order buffer, wired into the scheduler. Memory this fast is never cheap, and Fleet Command pays in full.",
  },
  fleetLogisticsQueue2: {
    branch: "fleetLogistics",
    label: "Standing Orders (3rd queued slot)",
    cost: 5,
    x: -320,
    y: 200,
    neighbors: ["fleetLogisticsQueue1", "fleetLogisticsQueue3"],
    effect: { type: "queueDepth", depth: QUEUE_DEPTH_PER_NODE },
    requiresFleetAdminLevel: 5,
    flavor:
      "Another bank of scheduling core, requisitioned at the usual outrageous price. Three orders can wait their turn now.",
  },
  fleetLogisticsQueue3: {
    branch: "fleetLogistics",
    label: "Standing Orders (4th queued slot)",
    cost: 8,
    x: -440,
    y: 280,
    neighbors: [
      "fleetLogisticsQueue2",
      // 0.13.4 Phase 1: the five per-facility branches all hang off the END of the trunk,
      // so the global chain is a PREREQUISITE for any per-facility depth. That is the
      // "shared trunk, then branches" shape the design specifies, and it means the cheap
      // global rungs stay the obvious first purchase.
      "fleetLogisticsQueueRefinery",
      "fleetLogisticsQueueFabricator",
      "fleetLogisticsQueueSalvageBay",
      "fleetLogisticsQueueResearchLab",
      "fleetLogisticsQueueShipyard",
    ],
    effect: { type: "queueDepth", depth: QUEUE_DEPTH_PER_NODE },
    requiresFleetAdminLevel: 25,
    flavor:
      "The deepest buffer the yard's schedulers will admit exists. Line up the whole shift and walk away.",
  },
  // --- fleetLogistics, the PER-FACILITY depth fan (0.13.4 Phase 1 Unit 1.1) -------------
  // Five independent leaves fanned around fleetLogisticsQueue3, the trunk's last rung.
  //
  // ⚠️ INDEPENDENT, NOT A CHAIN. Each names only Queue3 as its neighbor, so they have no
  // ordering between them: a player who only cares about the Refinery buys exactly that one
  // and no other. Chaining them would impose a purchase order the design does not want and
  // would make the last facility in the chain cost five nodes to reach.
  //
  // All five carry IDENTICAL cost and FA wall from the shared constants, so no facility is
  // implicitly favoured. See FACILITY_QUEUE_DEPTH_NODE_COST for why that uniformity matters.
  //
  // ⚠️ THERE IS NO FUEL DEPOT NODE, AND THERE MUST NEVER BE ONE. The effect's `facility` type
  // excludes it, so adding one is a compile error rather than a dead talent.
  //
  // ⚠️ COORDINATES ARE A FIRST PASS. They fan from Queue3 at (-440, 280) at roughly the web's
  // own 140/80 step scale, clear of the slot chain (up-left) and the yield/salvage spoke
  // (up-right). Positions are pure data: moving a node is two numbers and carries zero logic
  // risk, so treat these as adjustable on sight rather than settled.
  fleetLogisticsQueueRefinery: {
    branch: "fleetLogistics",
    label: "Refinery Standing Orders (+1 queued slot)",
    cost: FACILITY_QUEUE_DEPTH_NODE_COST,
    x: -560,
    y: 200,
    neighbors: ["fleetLogisticsQueue3"],
    effect: { type: "facilityQueueDepth", facility: "refinery", depth: FACILITY_QUEUE_DEPTH_PER_NODE },
    requiresFleetAdminLevel: FACILITY_QUEUE_DEPTH_FA_WALL,
    flavor:
      "Scheduling core wired directly into the smelters. The refinery crew stop asking what is next, because the answer is already queued.",
  },
  fleetLogisticsQueueFabricator: {
    branch: "fleetLogistics",
    label: "Fabricator Standing Orders (+1 queued slot)",
    cost: FACILITY_QUEUE_DEPTH_NODE_COST,
    x: -600,
    y: 300,
    neighbors: ["fleetLogisticsQueue3"],
    effect: { type: "facilityQueueDepth", facility: "fabricator", depth: FACILITY_QUEUE_DEPTH_PER_NODE },
    requiresFleetAdminLevel: FACILITY_QUEUE_DEPTH_FA_WALL,
    flavor:
      "One more order the fabricators can hold without a supervisor present. They insist this is the last one they can fit. They said that before.",
  },
  fleetLogisticsQueueSalvageBay: {
    branch: "fleetLogistics",
    label: "Salvage Bay Standing Orders (+1 queued slot)",
    cost: FACILITY_QUEUE_DEPTH_NODE_COST,
    x: -560,
    y: 400,
    neighbors: ["fleetLogisticsQueue3"],
    effect: { type: "facilityQueueDepth", facility: "salvageBay", depth: FACILITY_QUEUE_DEPTH_PER_NODE },
    requiresFleetAdminLevel: FACILITY_QUEUE_DEPTH_FA_WALL,
    flavor:
      "The breakers' list gets a line longer. Nothing in the bay has ever been in a hurry, but now it waits in a tidier order.",
  },
  fleetLogisticsQueueResearchLab: {
    branch: "fleetLogistics",
    label: "Research Lab Standing Orders (+1 queued slot)",
    cost: FACILITY_QUEUE_DEPTH_NODE_COST,
    x: -440,
    y: 440,
    neighbors: ["fleetLogisticsQueue3"],
    effect: { type: "facilityQueueDepth", facility: "researchLab", depth: FACILITY_QUEUE_DEPTH_PER_NODE },
    requiresFleetAdminLevel: FACILITY_QUEUE_DEPTH_FA_WALL,
    flavor:
      "The lab now accepts a second line of enquiry before anyone has finished the first. They call this progress. It is at least parallelism.",
  },
  fleetLogisticsQueueShipyard: {
    branch: "fleetLogistics",
    label: "Shipyard Standing Orders (+1 queued slot)",
    cost: FACILITY_QUEUE_DEPTH_NODE_COST,
    x: -300,
    y: 400,
    neighbors: ["fleetLogisticsQueue3"],
    effect: { type: "facilityQueueDepth", facility: "shipyard", depth: FACILITY_QUEUE_DEPTH_PER_NODE },
    requiresFleetAdminLevel: FACILITY_QUEUE_DEPTH_FA_WALL,
    flavor:
      "A standing berth order, filed and countersigned. The yard will start the next hull without being asked twice.",
  },
  // --- homelandDefense, hub-only gateway stub -------------------------
  homelandDefenseHub: {
    branch: "homelandDefense",
    label: "Home Guard",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // grows when a homeworld defense system lands (design §6.3)
    effect: { type: "patrolShieldMult", mult: HOME_GUARD_PATROL_SHIELD },
    flavor: "The homeworld's first and last line. Its shield crews train every patrol that flies the flag.",
  },
  // --- citizenry, hub-only gateway stub -------------------------------
  citizenryHub: {
    branch: "citizenry",
    label: "Civic Charter",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // grows when a population system lands (design §6.3)
    effect: { type: "transportCrewBonus", crew: CIVIC_CHARTER_TRANSPORT_CREW },
    flavor: "Every world needs a people worth defending. A charter worth signing draws more of them to the fleet.",
  },
  // --- economy, hub + one existing content node -----------------------
  economyHub: {
    branch: "economy",
    label: "Trade Authority",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: ["economyTrickle"],
    // Modest real starter effect (mirrors the fleetLogistics hub's rationale) --
    // a small passive trickle is thematically apt for an economy category.
    effect: { type: "passiveTrickle", material: "commonOre", perTick: 1 },
    flavor: "License the ledgers and the markets, and the wealth follows.",
  },
  economyTrickle: {
    branch: "economy",
    label: "Trade Contacts",
    cost: 3,
    x: -180,
    y: -120,
    neighbors: ["economyHub"],
    effect: { type: "passiveTrickle", material: "commonOre", perTick: 1 },
    flavor:
      "A quiet arrangement with independent traders keeps a slow, steady trickle of ore flowing home.",
  },
  // --- industry, hub + one existing content node ----------------------
  industryHub: {
    branch: "industry",
    label: "Works Directorate",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: ["industryBonusOutput"],
    // WR-6 (0.14.0, OC-B2): the promised Fabricator re-wire (SUGGESTIONS, the industry branch): a chance per
    // Fabricator job of one more of its output, rolled on its own keyed stream when the job starts (tick.ts
    // startProcess), so an offline batch resolves exactly as live play would. It also stays the gate on Refinery
    // rungs 3 and 4 (requiresHomeworldTalents), and its effect text names that gate.
    effect: { type: "fabricatorBonusOutput", chance: WORKS_DIRECTORATE_BONUS_CHANCE },
    flavor: "Nationalize the foundries and the whole homeworld starts to hum.",
  },
  industryBonusOutput: {
    branch: "industry",
    label: "Tooling Upgrade",
    cost: 4,
    x: -180,
    y: -120,
    neighbors: ["industryHub"],
    // Crafting 0.13.3 (Phase 3 Unit 3.3, design §6.5): the promised RE-WIRE, delivered.
    // This node carried the inert `none` placeholder from Phase 4 Task F5 (when the
    // legacy recipeBonusOutput/RECIPES instant-craft it modified was retired) until the
    // Fabricator's real mechanic existed to hang a bonus on. It now grants crafting
    // ITEM LEVELS, feeding computeItemLevel's `faTalentBonus` through
    // craftingItemLevelBonus() (tick.ts).
    //
    // WHY RE-WIRE THIS NODE RATHER THAN AUTHOR A NEW ONE (design §6.5):
    //   - it resolves a known dead node instead of leaving a talent players can waste
    //     points on, and it is thematically exact for an industry branch,
    //   - unlike the other logged re-wire candidate (a bonus-output CHANCE on fabricate)
    //     this effect needs NO rng anywhere in the tick path, so it carries zero
    //     offline-parity risk,
    //   - it needs NO SAVE MIGRATION: talents persist BY KEY, and the key is unchanged.
    //     A player who already bought this node keeps their spent points and silently
    //     gains a real bonus, which is the generous direction of that trade.
    //
    // ⚠️ The tier cap is HARD (locked user decision, design §14 item 1): this bonus is
    // added BEFORE computeItemLevel's clamp, never after, so it can never lift a piece
    // above `blueprint.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER`. The flavor text below is
    // written to say so, because a catch-up talent that quietly stops mattering at the
    // ceiling without admitting it is the dishonest version of this design.
    effect: { type: "craftingItemLevel", bonus: CRAFTING_ILEVEL_PER_NODE },
    flavor:
      "New jigs and fixtures on the fabrication line. Your crews reach the top of a blueprint's tolerances sooner, though never past them.",
  },
};

// Progression Pacing Rework (Task 11, "Coming Soon" -> "Locked" relabel):
// how many captain slots the game's CURRENT content can actually unlock. Every
// captain past the 1st is recruited by an `unlockCaptainSlot` Homeworld Talent
// (the fleetLogisticsSlot1/2/3 chain above), so the live ceiling is:
//     1 base captain + (number of unlockCaptainSlot nodes that exist today)
//   = 1 + 3 = 4 right now.
// Derived, NOT hardcoded to 4, so it grows automatically the day a
// fleetLogisticsSlot4 node is added, mirroring the "no placeholder, it lands
// when the node lands" note on the slot chain above (model.ts ~L787). The
// captain-list UI (App.svelte) reads this to decide, per empty slot, whether
// that slot is "Locked" (a captain this content CAN unlock once its Fleet
// Logistics talent + FA-level wall are met -> it EXISTS) or "Coming Soon" (a
// roadmap slot beyond slot 4 with no unlock path built yet).
export const MAX_UNLOCKABLE_CAPTAINS =
  1 +
  Object.values(HOMEWORLD_TALENTS).filter((t) => t.effect.type === "unlockCaptainSlot").length;

// --- Selector card data (Radial Skill Web, Task 13) -----------------------
// docs/plans/2026-07-08-radial-skill-web-plan.md, Task 13 + design §5.
//
// Two small static description tables feeding the TreeSelector card component
// (src/lib/TreeSelector.svelte, the "mockup A" card-selector screen). Each
// entry is one card: a title + flavor blurb + a few bullet points, shown in
// the selector's live description panel when that card is focused.
//
// The `key` field is LOAD-BEARING: it must EXACTLY match the real branch /
// category key so Tasks 14/15 can map a focused card straight onto a
// CaptainTalentBranch / HomeworldTalentBranch (e.g. focus the "Prospector"
// card -> commit key "resourcefulness" -> render that branch's web). A typo
// here would silently break that card->branch mapping, so the wiring tasks
// index these tables by the same literal keys the talent tables use.
//
// PLACEHOLDER COPY: the flavor/bullets below are launch-placeholder narrative
// (same convention as MISSIONS/RECIPES/talent flavor, frontier/belter
// sci-fi tone, editable as text, not balance- or lore-locked). WR-6 (0.14.0):
// every card names only effects the engine applies (the hubs and spec bonuses
// are live), and a category still waiting on its system says so plainly.
export interface SelectorCard {
  key: string; // MUST match a real branch/category key (see note above)
  title: string;
  flavor: string;
  bullets: string[];
}

// specCards, the 3 captain-specialization cards. Keys are exactly the three
// CaptainTalentBranch literals ("resourcefulness"/"tactical"/"science"), so the
// captain Talents panel (Task 14) maps a chosen card straight onto a spec.
export const specCards: SelectorCard[] = [
  {
    key: "resourcefulness", // -> CaptainTalentBranch "resourcefulness"; title per plan
    title: "Prospector",
    flavor:
      "The belt rewards the ones who can read it. Prospectors turn a rock field into a payday.",
    bullets: [
      "Focused on salvage, mining, and extraction yield.",
      "Boosts common and uncommon ore pulled per run.",
      "Sharper eyes for rare finds and lucky bonus strikes.",
      "The one fully-built spec at launch, a real web of talents.",
    ],
  },
  {
    key: "tactical", // -> CaptainTalentBranch "tactical"; title per plan
    title: "Tactician",
    flavor:
      "Out past the shipping lanes, someone eventually shoots first. The Tactician plans for that day.",
    bullets: [
      "Combat-focused discipline for when the shooting starts.",
      "The spec itself sharpens the guns of the ship you command.",
      "Its hub adds weapon damage; retirement opens Gunnery, Aegis and Fleet Ops.",
    ],
  },
  {
    key: "science", // -> CaptainTalentBranch "science"; title per plan
    title: "Explorer",
    flavor:
      "Every uncharted system is a question with a paycheck attached. Explorers go find the answer.",
    bullets: [
      "Survey- and science-focused deep-space doctrine.",
      "The spec itself improves the relic odds of your expeditions.",
      "Its hub speeds expedition scans; retirement opens Survey, Relics and Command.",
    ],
  },
];

// categoryCards, the 5 homeworld-category cards. Keys are exactly the five
// HomeworldTalentBranch literals, so the Fleet Admiral (Homeworld) Talents
// panel (Task 15) maps a focused card straight onto a category's web. Unlike
// the captain flow these do NOT lock in, they're pure navigation into a
// category tree, freely reversible (design §5.3).
export const categoryCards: SelectorCard[] = [
  {
    key: "fleetLogistics", // -> HomeworldTalentBranch "fleetLogistics"
    title: "Fleet Logistics",
    flavor:
      "Ships without supply lines are just expensive debris. Logistics is what turns hulls into a fleet.",
    bullets: [
      "Grows the fleet: unlocks additional captain slots.",
      "Redirects a share of every rare find into fleet reserves.",
      "The richest homeworld category at launch.",
    ],
  },
  {
    key: "homelandDefense", // -> HomeworldTalentBranch "homelandDefense"
    title: "Homeland Defense",
    flavor:
      "The homeworld is the one asset you can never re-mine. Someone has to stand watch over it.",
    bullets: [
      "The homeworld's standing guard against future threats.",
      "Its hub strengthens the shields of every ship on patrol.",
      "Homeworld defenses grow here when that system lands.",
    ],
  },
  {
    key: "citizenry", // -> HomeworldTalentBranch "citizenry"
    title: "Citizenry",
    flavor:
      "A frontier world is only as strong as the people who choose to stay and build on it.",
    bullets: [
      "The homeworld's population and the civic life it supports.",
      "Its hub brings more crew aboard every crew transport.",
      "Population effects grow here when that system lands.",
    ],
  },
  {
    key: "economy", // -> HomeworldTalentBranch "economy"
    title: "Economy",
    flavor:
      "License the ledgers, court the traders, and the wealth starts finding its own way home.",
    bullets: [
      "Trade authority and passive resource income.",
      "Keeps a steady trickle of ore flowing back to the homeworld.",
      "One content node beyond the hub at launch, grown later.",
    ],
  },
  {
    key: "industry", // -> HomeworldTalentBranch "industry"
    title: "Industry",
    flavor:
      "Nationalize the foundries and the whole homeworld starts to hum with output.",
    bullets: [
      "Fabrication and manufacturing throughput.",
      "Its hub gives Fabricator jobs a chance of extra output, and opens the Refinery's upper rungs.",
      "Tooling Upgrade raises crafted item levels.",
    ],
  },
];

// What a brand-new (or newly-unlocked) captain slot starts with. There is no
// more prestige to reset a captain THROUGH, this is purely the baseline for
// a slot that has never been played.
export function freshCaptainStack(): Pick<
  CaptainState,
  | "mission"
  | "xp"
  | "level"
  | "statPoints"
  | "unlockedCaptainTalents"
  | "spec"
  | "secondaryPoints"
  | "unlockedSecondaryTalents"
  | "retirements"
> {
  return {
    mission: null,
    xp: new Decimal(0),
    level: 1,
    statPoints: 0,
    unlockedCaptainTalents: [],
    spec: null,
    // Crew 0.14.0 (Phase C-3a): the DORMANT secondary-tree baseline. A brand-new (or newly-unlocked)
    // captain slot has spent no retirement points and never retired.
    secondaryPoints: 0,
    unlockedSecondaryTalents: [],
    retirements: 0,
  };
}

// Generates `count` captains (ids 1..count) sharing the same freshCaptainStack()
// baseline. Used for: a brand-new save (freshState calls freshCaptains(1))
// and save migration (backfilling a never-played slot). NOTE: a slot unlock
// (tick.ts's buyHomeworldTalent, unlockCaptainSlot effect) does NOT call this
// function, it inlines its own captain object using freshCaptainStack()
// directly, same as this function's loop body does below.
export function freshCaptains(count: number): CaptainState[] {
  const captains: CaptainState[] = [];
  for (let i = 1; i <= count; i++) {
    captains.push({
      id: i,
      label: `Captain ${i}`,
      ...freshCaptainStack(),
    });
  }
  return captains;
}

// The zeroed lifetimeStats shape, extracted as a single source of truth shared
// by BOTH freshState() (a brand-new game) and save.ts's MIGRATIONS[16]
// (backfilling an old v16 save that predates this field). Omega 4 (DRY): the
// two call sites MUST produce the identical shape, a fresh game and a migrated
// old save have to land on the same clean-slate totals, so they are defined
// ONCE here rather than duplicated, where they could silently drift apart.
// Empty per-key tally maps (a material/mission key is absent until its first
// recorded event) and live Decimal(0) scalar sums. Reserved schema only:
// nothing increments these yet (the increment wiring is a later task), see
// the GameState.lifetimeStats field comment above for why they must accrue from
// a clean-slate zero rather than being derived from live state on demand.
export function freshLifetimeStats(): GameState["lifetimeStats"] {
  return {
    itemsGathered: {},
    itemsRefined: {},
    itemsCrafted: {},
    missionsCompleted: {},
    creditsEarned: new Decimal(0),
    captainXpAwarded: new Decimal(0),
    fleetAdminXpAwarded: new Decimal(0),
  };
}

// `homeworldSeed` (Expedition Tiers G2-1): this save's homeworld seed, stored as GameState.homeworld. The game ALWAYS
// passes one (App.svelte's new-game paths, a fresh homeworldEntropy.ts draw). Omitted (tests, the sim, the wiring
// fixtures), the state stores no homeworld and reads the provisional spot near Sol (galaxy.ts stateHomeworld), the
// one every save shared before G2-1, so every golden captured on freshState stays byte-identical.
export function freshState(homeworldSeed?: number): GameState {
  // Equipment 0.11.0 Task 20: the one starting hull ("ship-1", seeded below) is born
  // fully fitted with Standard-Issue on every live slot, so no live slot is ever empty
  // (the design's "a live slot is never empty" rule). Uses the SAME shared seeder the
  // save migration and the tick.ts new-ship paths use, so a fresh game and a migrated
  // save land on the identical fully-fitted shape. nextEquipmentId advances past the
  // four minted ids (first minted is "equip-1", so the counter ends at 5).
  const seededShip1 = seedStandardIssueForShip("ship-1", 1);
  return {
    captains: freshCaptains(1),
    tickDurationSeconds: 1,
    gameTimeSeconds: 0,
    // Phase 1: seed `inventory` with the baseline material keys at zero. This is
    // the canonical, sole fleet-wide material balance, tick.ts and App.svelte
    // read/write it via the shared addToInventory helper. It replaced the old
    // homePlanet.storage field entirely as of Task 7 (storage removed; its keys now
    // live here). The keys below are the historical storage set, new itemIds
    // (refined/component tiers, e.g. titaniumIngot) are added dynamically on first
    // acquire, no reseed. (ITEM-MERGE 0.11.0 Task A1 dropped the retired
    // `refinedMaterial` seed; the 0.11.0 cleanup dropped the dead `components` seed
    // too, taking the seed set from 5 keys to 3. titaniumIngot is not seeded here, it
    // lands lazily on first refine like every other crafted good.)
    // Quality-bucketed shape (Task 9a): each key seeds a SINGLE zero bucket
    // (`[Decimal(0)]`, quality tier 0), the bucketed equivalent of the old scalar
    // `new Decimal(0)`. Buckets grow lazily, no eager length-6 allocation.
    inventory: {
      commonOre: [new Decimal(0)],
      uncommonMaterial: [new Decimal(0)],
      rareMaterial: [new Decimal(0)],
    },
    // No itemId has been seen on a brand-new save, the ❓ -> reveal set starts
    // empty (discovery wiring lands in a later task).
    discovered: [],
    // Item Lifecycle 0.13.6 (dormant): no blanks banked, seed at 0. See GameState.
    blanks: {},
    inspectSeed: 0,
    unlockedHomeworldTalents: [],
    fleetAdminXp: new Decimal(0),
    fleetAdminLevel: 1,
    adminPoints: 0,
    credits: new Decimal(0),
    // Seed the invariant: the one starting captain (freshCaptains(1) -> id 1) gets
    // exactly one hull, the universal General Freighter. nextShipId starts at 2
    // because "ship-1" is already taken by this seeded hull.
    // Ground Ops GO-1: the starting hull also gets its (empty) ground teams, the same shape the v66 -> v67
    // migration gives a ship with no members.
    ships: [{ id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, complement: { buckets: [], mode: "passive" }, groundTeams: emptyGroundTeams("generalFreighter") }],
    shipStorageCapacity: 8,
    // 0.13.4 Phase 0: rung LEVEL 0, so a fresh game starts on the BASE berth count that
    // Phase 3 derives (TRANSIT_BERTH_BASE = 2) and has bought nothing. Level, not count:
    // see the field's own note on GameState. Seeding 0 here keeps a fresh game and a
    // migrated v44 save byte-identical on this field, which is what the migration asserts.
    transitBerthCapacity: 0,
    // 0.13.4 Phase 5: no orders yet, and the id source starts at 1. A fresh game and a migrated
    // v45 save are identical on both fields, which is what the migration test asserts.
    craftOrders: [],
    nextCraftOrderId: 1,
    nextShipId: 2,
    // Combat 0.13.0 (Task 1.1): the one starting captain (freshCaptains(1) -> id 1)
    // holds id 1, so the next allocatable captain id is 2 (mirrors nextShipId's "ship-1
    // is taken, next is 2" reasoning). Existing saves get this backfilled by the
    // v30->v31 migration (save.ts), NOT this function's job.
    nextCaptainId: 2,
    // Combat 0.13.0 (Phase 9b.5a): the first patrol dispatched takes master seed 1, so
    // the counter starts at 1 (mirrors nextShipId/nextCaptainId's "next allocatable"
    // seeding). Existing saves get this backfilled by the v31->v32 migration (save.ts),
    // NOT this function's job.
    nextPatrolSeed: 1,
    // Clean-slate lifetime totals, see freshLifetimeStats() above. Extracted
    // to that shared factory (Omega 4, DRY) so this new-game init and the
    // v16->v17 save migration that backfills the same field (save.ts,
    // MIGRATIONS[16]) can never drift out of sync.
    lifetimeStats: freshLifetimeStats(),
    // Phase 1, Task 3 (additive facility/process state). The one facility Phase 1
    // ships (refinery) starts at level 0 = not built; no processes are running and
    // the next proc id is 1. The v17->v18 migration (save.ts, MIGRATIONS[17])
    // backfills this exact baseline onto old saves. Nothing reads these yet (Task 8).
    // Phase 2, Task B2 (additive facility seeds): the two tiered Warehouses join
    // the refinery. warehouseT1 starts at level 0 = the base tier's starting state
    // (cap 1,000,000; NOT "unbuilt", T1 is available from the start, its level-0
    // cap is live). warehouseT2 starts at level 0 = LOCKED (its rung 0 is the
    // unlock). A NEW game is thus consistent with tierCap's expectations. Existing
    // saves get these same seeds via the v18->v19 migration (Task B4, save.ts) --
    // NOT this function's job.
    // Mission Rework Task 4 (additive seed): fuelStorage starts at level 0 (the Fuel Depot, the fleet reach track
    // since WR-4: no rung built = no bonus). Existing saves get this seed via the v20->v21 migration (save.ts).
    // fleetReachBonus tolerates an absent key (?? 0) regardless; seeding keeps the facility present for the UI.
    // Mission Rework Task 6 (additive seed): missionControl starts at level 1, NOT
    // level 0. Level 0 is "not built"; seeding at level 1 means the facility is
    // ESTABLISHED from game start, so ALL FOUR missions (every one is unlockLevel 1 per
    // the USER REVISION 2026-07-14) are dispatchable immediately, the no-soft-lock /
    // no-regression guarantee. The mission-control unlock UPGRADE is deferred (the track
    // caps at level 1); a future mission batch re-adds it. See FACILITIES.missionControl.
    // Existing saves get this same level-1 seed via the v20->v21 migration (Task 9).
    // Research Task R2 (additive seed): research starts at level 1, NOT level 0.
    // Level 0 is "not built"; seeding at level 1 makes the Research Lab ESTABLISHED
    // from game start, so tier-1 blueprints are researchable immediately (no soft-lock,
    // mirrors missionControl). researchSlotCount reads level 1 -> 1 research slot.
    // Existing saves get this same level-1 seed via the v21->v22 migration (Task R6,
    // save.ts), NOT this function's job. researchSlotCount tolerates an absent key
    // (?? 0) regardless, but seeding keeps the facility present for the R5 UI.
    // Shipyard (Task S1): seeded at level 0, LOCKED / UNFOUNDED. ⚠️ This DIFFERS from
    // research/fabricator (level 1, established from start): the Shipyard's founding rung
    // (level 0->1) is a REAL unlock the player buys with credits + FA level, so it MUST
    // start at level 0 for founding to be meaningful. shipBuildSlotCount is a const 1
    // regardless of level, but building a hull is gated on level >= 1 (S3's canBuildShip).
    // Existing saves get this same level-0 seed via the v24->v25 migration (S6, save.ts).
    // ⚠️ salvageBay seeds at level 0, and level 0 IS A WORKING ONE-LANE BAY (Salvage Lanes,
    // 2026-09-04). It is level-0-and-operational like warehouseT1 / fuelStorage, NOT
    // level-0-and-locked like refinery / shipyard: salvageSlotCount adds its rungs to a base
    // of one, so a save at level 0 salvages exactly as it always did. Existing saves reach
    // this identical shape through the v41->v42 migration (save.ts, MIGRATIONS[41]), and
    // would behave identically even without it (facilityLevel reads an absent key as 0); the
    // migration exists so a fresh save and a migrated save stay indistinguishable in SHAPE.
    facilities: { refinery: { level: 0 }, warehouseT1: { level: 0 }, warehouseT2: { level: 0 }, fuelStorage: { level: 0 }, missionControl: { level: 1 }, research: { level: 1 }, fabricator: { level: 1 }, shipyard: { level: 0 }, salvageBay: { level: 0 }, subspaceTelescope: { level: 1 } },
    activeProcesses: [],
    nextProcessId: 1,
    // Crafting Allocation Redesign Task C2: no production lines on a fresh save; the
    // first line is added by startLine when the player configures a slot. nextCraftLineId
    // starts at 1 so the first minted id is "craft-1" (mirrors nextShipId/nextProcessId).
    // Existing saves get this same empty seed via the v23->v24 migration (save.ts, C6).
    refineLines: [],
    fabricateLines: [],
    nextCraftLineId: 1,
    // Research Task R1: nothing researched on a brand-new save. Existing saves get this
    // same [] seed via the v21->v22 migration (Task R6, save.ts), NOT this function's
    // job. A string[] (no Decimal), so hydrateDecimals needs no change (see the field's
    // comment on GameState above).
    researchedBlueprints: [],
    // Equipment 0.11.0 Task 3 + Task 20: the equipment pool is SEEDED with ship-1's
    // Standard-Issue baseline (four pieces, one per live slot, all fitted to "ship-1"),
    // and nextEquipmentId advances past them (ends at 5). Task 3 originally seeded an
    // EMPTY pool with nextEquipmentId 1; Task 20 makes the starting hull born-fitted so
    // no live slot is ever empty. Existing saves reach the identical shape via the
    // v27->v28 migration (save.ts). craftingLevel starts at 1 (mirrors fleetAdminLevel)
    // with 0 xp.
    equipment: seededShip1.pieces,
    nextEquipmentId: seededShip1.nextId,
    // Item Lifecycle 0.13.6 (Armory, dormant): no loadouts on a fresh save; id source at 1.
    loadouts: [],
    nextLoadoutId: 1,
    // Item Lifecycle 0.13.6 (Archive, dormant): nothing enshrined on a fresh save.
    archive: {},
    craftingLevel: 1,
    craftingXp: new Decimal(0),
    // Equipment 0.11.0 Task B1: a new save starts at the base equipment-storage cap,
    // no upgrade rung purchased (level 0). Old saves reach the same shape via the
    // v28->v29 migration (save.ts). See the field comment on GameState above.
    equipmentStorageLevel: 0,
    // Crafting 0.13.3 (Phase 1 Unit 1.1): a brand-new save starts with an EMPTY queue,
    // the id counter at 1 (first minted id "q-1"), auto-salvage fully OFF (opt in), and
    // the confirm-every-tier salvage default. Existing saves reach the IDENTICAL shape
    // via the v39->v40 migration (save.ts, MIGRATIONS[39]) so a fresh save and a
    // migrated save are indistinguishable in shape. Nothing reads any of these yet.
    //
    // The one intended difference from the migration: the migration SEEDS
    // salvageConfirmQualities from the player's existing localStorage preference, while
    // freshState uses the plain default. That is correct and deliberate: freshState must
    // stay a PURE function (dozens of tests build fixtures from it, and a new game is a
    // new game), so it never reaches for a browser store.
    processQueue: [],
    // The Auto-Salvage Terminal's own queue, empty on a new game exactly as processQueue is.
    // Existing saves reach the identical shape through the v43 -> v44 migration, so a fresh
    // save and a migrated save stay indistinguishable in shape (this file's standing rule).
    // salvageIdleWatch is deliberately NOT seeded here: it is optional, absent reads as "the
    // borrow window has not elapsed" (the fail-safe direction), and the first promotion pass
    // writes it. Seeding a watch on a bay that has never run anything would be inventing a
    // history that did not happen.
    autoSalvageQueue: [],
    nextQueueId: 1,
    // 0.13.3.1: `rarities` seeds the no-band-selected default (the rarity rule OFF, matching
    // the other two rules' opt-in posture) and `graceSeconds` the 60-minute first pass.
    // Existing saves reach the IDENTICAL shape via the v42 -> v43 migration, so a fresh save
    // and a migrated save stay indistinguishable in shape.
    autoSalvage: {
      enabled: false,
      qualities: [],
      duplicates: false,
      keepPerVariety: 1,
      // SPREAD, not the shared const reference: freshState hands out a state per call (dozens
      // of fixtures build from it), and handing every one of them the SAME object would let a
      // single stray write reach all of them. Same defensive posture as freshLifetimeStats.
      rarities: { ...AUTO_SALVAGE_RARITIES_NONE },
      graceSeconds: AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
    },
    salvageConfirmQualities: freshSalvageConfirmQualities(),
    // Crafting 0.13.3 (Unit 4.4b): a brand-new save has completed nothing yet, so the log
    // starts EMPTY with the id counter at 1 (first minted id "done-1") and no open batches.
    // Existing saves reach the IDENTICAL shape through the v39->v40 migration (save.ts,
    // MIGRATIONS[39]), so a fresh save and a migrated save stay indistinguishable in shape.
    completionLog: [],
    nextCompletionLogId: 1,
    openJobBatches: [],
    // Crew 0.14.0 (Phase 0, DORMANT): clean-slate crew state. No officers, no pooled or notable
    // crew, and the two id counters at 1 (first minted ids "officer-1"/"notable-1", mirroring
    // nextShipId's "next allocatable" seeding). lastTransportWindow 0 = no transport window has
    // elapsed yet. Existing saves reach the IDENTICAL shape via the v54->v55 migration (save.ts),
    // so a fresh save and a migrated save stay indistinguishable in shape. Nothing reads these yet.
    officers: [],
    nextOfficerId: 1,
    crewPool: [],
    notableCrew: [],
    nextNotableId: 1,
    lastTransportWindow: 0,
    // Senior Staff roster (Phase 1, DORMANT): a fixed default seed (deterministic freshState) and
    // the base roster size. The v55->v56 migration backfills these IDENTICAL defaults onto existing
    // saves. Nothing reads either yet.
    seniorStaffSeed: SENIOR_STAFF_DEFAULT_SEED,
    seniorStaffRosterSize: SENIOR_STAFF_ROSTER_BASE,
    // Crew 0.14.0 (Phase C-2): no saved rosters yet, the id counter at 1 (first minted id "roster-1",
    // mirroring nextLoadoutId's "next allocatable" seeding). Existing saves reach the IDENTICAL shape
    // via the v56->v57 migration (save.ts), so a fresh save and a migrated save stay indistinguishable.
    personnelRosters: [],
    nextRosterId: 1,
    // Exploration 0.14.0 (Phase E2a): no active expeditions on a fresh save, the id counter at 1 (first
    // minted id "expedition-1", and nextExpeditionId === 1 also flags the inaugural shakedown run), and
    // the per-save expedition seed at the fixed default. Existing saves reach the IDENTICAL shape via the
    // v58->v59 migration (save.ts), so a fresh save and a migrated save stay indistinguishable in shape.
    expeditions: [],
    nextExpeditionId: 1,
    expeditionSeed: EXPEDITION_DEFAULT_SEED,
    // Safe first runs SF-1: nothing flown yet (the first explorer run will be the training run).
    runCounts: freshRunCounts(),
    // Expedition Tiers G2-1: this save's homeworld seed when one is given (App.svelte always passes a fresh draw).
    ...(homeworldSeed === undefined ? {} : { homeworld: { version: 1 as const, seed: homeworldSeed >>> 0 } }),
    // Exploration 0.14.0 (Phase E3a): the account-level away-team gambit pair starts from the Balanced
    // default (DEFAULT_GAMBIT_PROGRAMS). Existing saves reach the IDENTICAL shape via the v61->v62
    // migration (save.ts), so a fresh save and a migrated save stay indistinguishable.
    gambitPrograms: {
      security: DEFAULT_GAMBIT_PROGRAMS.security.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined })),
      science: DEFAULT_GAMBIT_PROGRAMS.science.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined })),
    },
    // Exploration 0.14.0 (Phase E4a): an empty relic store (no vault tokens, no museum copies, nothing
    // discovered), the fixed relic seed, and the study index at 1. Existing saves reach the IDENTICAL
    // shape via the v62->v63 migration (save.ts).
    relicVault: [],
    // Relics v2 R2-1: the empty Museum v2 record, in the v1 museum's key position (the v69 -> v70 step puts it at the
    // same position, so a fresh save and a migrated save stay indistinguishable, key order included).
    museumV2: emptyMuseumV2(),
    relicDiscovered: [],
    relicSeed: RELIC_DEFAULT_SEED,
    nextRelicStudyIndex: 1,
    // E-CREW (Task 2, DORMANT): no away members or squad loadouts, both id counters at 1, and the
    // recruit seed derived from the Senior Staff seed (awayRecruitSeedFrom, so the two boards differ).
    // Existing saves reach the IDENTICAL shape via the v64->v65 migration (save.ts).
    awayMembers: [],
    nextAwayMemberId: 1,
    awayRecruitSeed: awayRecruitSeedFrom(SENIOR_STAFF_DEFAULT_SEED),
    squadLoadouts: [],
    nextSquadLoadoutId: 1,
  };
}
