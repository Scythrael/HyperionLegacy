import Decimal from "break_infinity.js";
// Crafting Allocation Redesign (Task C2): the production-LINE shape lives in
// allocation.ts (C1's pure derived-allocation core). Imported here TYPE-ONLY so
// GameState.refineLines/fabricateLines can be typed as CraftLine[] with NO runtime
// dependency -- allocation.ts imports the recipe registries FROM this file at
// runtime, and a value import back would create a cycle; `import type` is erased at
// compile time, so there is no runtime import cycle.
import type { CraftLine } from "./allocation";

// Data model -- tech spec §1 (Data Model).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (and everything built on top of it -- Research,
// Specializations, the Skill Tree, both Prestige tiers) has been retired in
// favor of the mission-based economy (below), a Homeworld crafting system
// (RECIPES/craftRecipe), and a captain XP/leveling system (xp/level/statPoints
// on CaptainState, xpForNextLevel below; the XP-awarding and level-up logic
// itself lives in tick.ts's tickCaptainMission). Captain slot growth is now
// handled by the Homeworld Talent Tree's Fleet Logistics branch (below) via
// buyHomeworldTalent's unlockCaptainSlot effect -- the old level-gated
// CAPTAIN_SLOT_UNLOCKS table/unlockCaptainSlot() function it superseded were
// removed in docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md's
// Task 4.

// Only "resourcer" is real today. Modeled as a union (not a bare string) so
// Phase 3+'s combat-type ships slot in as a new literal without touching
// every existing call site that pattern-matches on this field.
export type ShipType = "resourcer";

// --- Ships -- Stats Foundation (docs/plans/2026-07-09-ships-stats-foundation-*) ---
// A ship is a HULL with a stat profile, distinct from the captain flying it. The
// type vocabulary + SHIP_TYPES table are below; the fleet's live hulls live on
// GameState.ships, and a captain no longer carries a shipType -- a ShipInstance
// knows its captain via assignedCaptainId (the single source of truth). The old
// `ShipType = "resourcer"` alias above is now unused by the live type model;
// it's left in place as harmless legacy (removing it is optional cleanup, out of
// this feature's scope).

// The design's "spec" families -- a ship's role identity, mirroring the captain
// spec vocabulary (Prospector/Tactician/Explorer) so a hull and its intended
// pilot spec read the same. Modeled as a named union (not a bare string), same
// convention as ShipType/MissionTier above: a future family slots in as a new
// literal without touching every call site that pattern-matches on this field.
// "general" is its own family (the universal starter hull, spec-agnostic).
export type ShipSpec = "general" | "prospector" | "tactician" | "explorer";

// The keys of the SHIP_TYPES table -- one per REAL hull built this pass. Kept as
// an explicit union (rather than `keyof typeof SHIP_TYPES`) so it can be
// referenced by ShipInstance below BEFORE the table literal is declared, and so
// the forward buckets are documented in the type itself.
export type ShipTypeKey =
  | "generalFreighter"
  | "prospectorHauler"
  | "prospectorRunner"
  | "prospectorMiner";
// FORWARD BUCKETS (documented in the design doc, NOT built this pass): tactician --
// destroyer/battleship/carrier; explorer -- cruiser/surveyor/medical (explorer hulls
// get MORE module slots). Add keys here only when actually built.

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
  //   fuelCapacity   -- the RANGE gate: the max fuel a hull can carry for ONE round
  //                     trip. A mission is reachable iff fuelCapacity >= fuelNeeded
  //                     (checked at dispatch by Task 5/7; NOTHING reads it yet this pass).
  //   engineEfficiency -- a 0-BASED bonus that REDUCES fuel burn: fuelNeeded divides
  //                     the round-trip ticks by (1 + engineEfficiency), so 0 == the
  //                     baseline 1:1 cost and a higher value costs LESS fuel. Hulls carry
  //                     distinct base values now; engine-module bonuses that raise it are a
  //                     FORWARD system (design §3, explicitly deferred). See fuel.ts's
  //                     fuelNeeded for the formula this feeds.
  fuelCapacity: number;
  engineEfficiency: number;
  moduleSlots: number;              // POPULATED but INERT this pass (no module system yet)
  equipmentSlots: number;           // forward bucket; counts finalized with equipment/reactor design
  cost: { credits: number } | null; // null = not purchasable
  // Shipyard (Phase 5, Task S1 -- design §6): the BILL OF MATERIALS + credits + build
  // TIME to CONSTRUCT this hull at the Shipyard. Acquisition now runs through timed
  // construction (the instant credit-buy `cost`/`buyShip` is retired in S4), so every
  // real hull carries one. Shape:
  //   components   -- fabricated-component ITEM ids -> integer counts, RESERVED at build
  //                   start (the derived-allocation model, S2) and consumed on completion.
  //                   Keyed on `string` (the ITEMS registry key), same forward-loose
  //                   posture as inventory / RECIPES inputs. Real component ids only
  //                   (frameSegment / powerCoupling / structuralAssembly).
  //   credits      -- a flat credit cost, deducted ATOMICALLY at build start (S3).
  //   durationTicks-- base build length; the Shipyard's build-speed upgrades scale it (S3).
  // ⚠️ FIRST-PASS TUNABLE -- these values are launch placeholders scaling roughly with the
  // hull (bigger cargo / faster = more components + credits + time), the SAME device-check
  // placeholder spirit as `cost` and every other economy constant in this file. Retune at
  // the device checkpoint, NOT piecemeal.
  buildRecipe: { components: Record<string, number>; credits: number; durationTicks: number };
  description: string;
  // FORWARD (not populated this pass): reactorTier?: number  // reactorTier <= tier; gates equip/module tiers
}

export type LootMaterialKey = "commonOre" | "uncommonMaterial" | "rareMaterial";

// Mission Rework (Task 1, docs/plans/2026-07-14-mission-rework-plan.md): the
// per-mission loot triad. Each mission's extraction roll is UNCHANGED in mechanic
// -- it still rolls exactly one of three abstract rarity tiers (rare -> uncommon ->
// common fallback, see tick.ts's rollExtractionTick) -- but WHICH concrete ITEM
// each tier deposits is now per-mission, read off this table at delivery time
// instead of being hard-coded to commonOre/uncommonMaterial/rareMaterial. The three
// fields are ITEM registry keys (kept as `string` -- the ITEMS registry is keyed on
// `string`, and a mission can point at any raw-material tier). Every mission MUST
// point its `common` at an ITEM whose rarity is "common", `uncommon` at "uncommon",
// and `rare` at "rare" -- the model.test.ts loot-triad test enforces this so a
// mistyped key cannot silently deposit a rarity-mismatched material.
export interface MissionLootTable {
  common: string;   // ITEM key deposited when the common (guaranteed-floor) tier wins
  uncommon: string; // ITEM key deposited when the uncommon tier wins
  rare: string;     // ITEM key deposited when the rare tier wins
}

// Superset of LootMaterialKey: the 3 mission-loot tiers plus the 2 new
// crafted-good tiers the Homeworld crafting system (RECIPES, below) produces.
// homePlanet.storage is keyed on this wider type -- both raw loot delivery
// (tick.ts's tick()) and crafting (tick.ts's craftRecipe()) read/write the
// SAME storage object, just different subsets of its keys.
export type HomePlanetMaterialKey = LootMaterialKey | "refinedMaterial" | "components";

export type MissionPhase = "ordersReceived" | "transitOut" | "extracting" | "transitBack" | "unloading";

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
  // edge case -- see that function's comment below if this is ever violated.
  // Per-tick occurrence chances (0-1) checked in sequential, mutually
  // exclusive priority order -- rare first, then uncommon, then a guaranteed
  // common fallback (2026-07-08 Extraction Rework -- see the design doc).
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
  // running the mission idles (no run, no loot/XP/credits) -- see economyTick's
  // materialAtCap check in tick.ts.
  //
  // Mission Rework (Task 1): this is ALWAYS the mission's COMMON item -- i.e.
  // `lootTable.common` -- because the common tier is the GUARANTEED per-tick floor
  // drop (rollExtractionTick's final return when rare + uncommon both miss), so it
  // is the material the run reliably produces and thus the right auto-stop gate.
  // Widened from LootMaterialKey to `string` because a mission's common is now an
  // arbitrary ITEM key (e.g. "scrapAlloy"/"ferriteOre"), not just the 3 original
  // ore-tier keys. materialAtCap (tick.ts) already accepts any `string` itemId, so
  // no auto-stop code changed. The model.test.ts loot-triad test asserts
  // primaryMaterial === lootTable.common for every mission, so the two cannot drift.
  primaryMaterial: string;
  // Display-only grouping -- drives which SubTabs tier a mission renders under
  // in the Fleet Operations tab (a follow-up UI feature). Has NO effect on
  // tick math whatsoever; purely a presentational label read by the UI layer.
  tier: MissionTier;
  // Flat Fleet Admiral XP awarded per WHOLE tick the mission is active (NOT per
  // completed cycle). Progression Pacing Rework (Task 5) moved Fleet Admiral XP
  // onto the SAME per-active-tick accrual captain XP already uses (Task 4): it is
  // now summed as fleetAdminXpPerTick * wholeTicksElapsed once per call, right
  // beside the captain-XP award in tickCaptainMission -- NOT a per-cycle lump
  // anymore. Both launch missions are 1; the old per-CYCLE Short=1/Long=2 split
  // did NOT carry over (a per-cycle value is not a per-tick value, so it was
  // reset to 1, not copied). Each mission still keeps its OWN field rather than
  // one shared constant, so a future mission can be tuned to a richer per-tick FA
  // rate. This is only the FIRST of several planned Fleet Admiral XP sources
  // (2026-07-08 user note: crafting, talent purchases, and a future talent-tree
  // effect boosting this value are all planned later) -- the values here and
  // xpForNextFleetAdminLevel's curve below are deliberately NOT calibrated as if
  // missions alone must carry the full weight of Fleet Admiral progression.
  // Don't "fix" this later assuming it's undertuned for mission-only play -- it's
  // intentionally left room for other income streams to stack on top.
  //
  // ⚠️ CLOSED-FORM PARITY TRAP -- keep this an INTEGER ⚠️
  // Like captain XP's xpPerTick rate, this per-tick FA rate is awarded as
  // fleetAdminXpPerTick * wholeTicksElapsed in ONE product per call, and the
  // "one big offline-catchup call == many small live calls" parity guarantee
  // (guarded by the closed-form parity test in tick.test.ts) holds ONLY while
  // the rate is an integer -- it is today (1). A FRACTIONAL rate would let a
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
  // for the unlock gate -- tick.ts's missionUnlocked(state, key) is simply
  // `facilityLevel(state, "missionControl") >= MISSIONS[key].unlockLevel`, so there
  // is NO separate per-mission "unlocked" flag to keep in sync (the level derives it).
  //
  // USER REVISION 2026-07-14: ALL FOUR current missions are `1` -- every mission is
  // available from a fresh save (whose missionControl seeds at level 1), so NO mission
  // is locked by default. The user's directive: "the 2 new missions shouldn't be locked
  // behind an upgrade ... 4 missions should be the default." Salvage + Forage were `2`
  // (behind a completion-gated level-1 -> 2 mission-control UPGRADE) before this revision.
  //
  // The unlock MECHANISM is intact and reserved (not deleted): a FUTURE mission batch
  // will declare its own higher unlockLevel AND re-add a matching completion-gated rung
  // to the mission-control track (see FACILITIES.missionControl below -- the level-1 -> 2
  // rung was DEFERRED, not removed in spirit, precisely so there is no live rung that
  // unlocks nothing = a placeholder). missionUnlocked (tick.ts) + the locked-mission UI
  // still work the moment such a mission exists.
  unlockLevel: number;
  // Mission Rework (Task 7, design §4): per-mission CAPABILITY requirements checked at
  // dispatch by canDispatch (tick.ts), SEPARATE from the unlockLevel gate above. Both
  // are OPTIONAL -- a mission that omits them gates on neither (the ore runs do exactly
  // that), so `undefined` means "no requirement", NOT "requirement of 0". They are
  // FIRST-PASS TUNABLE values in the same launch-placeholder spirit as this file's other
  // numbers; real balancing happens at the device-check stage.
  //
  // requiresCaptainLevel: the flying captain's CaptainState.level must be >= this. Ore
  // runs leave it undefined (always accessible); Salvage/Forage set a SMALL bump.
  // USER REVISION 2026-07-14: these CAPABILITY gates are KEPT even though Salvage/Forage
  // are now default-unlocked (the unlock UPGRADE was deferred). The user removed the
  // mission-control UNLOCK, not the per-mission requirements -- so a fresh level-1 captain
  // still cannot fly Salvage (level 2) or Forage (level 3). The bumps stay MODEST (design
  // §4) so these serve as an early progression nudge, not a hard wall.
  requiresCaptainLevel?: number;
  // requiresCargoCapacity: the flying captain's SHIP cargoCapacity (SHIP_TYPES[typeKey]
  // .cargoCapacity, NOT this mission's own cargoCapacity field above) must be >= this.
  // Set to 90 for Salvage/Forage == the default General Freighter's hold, so it only
  // excludes the small-hold Runner (60), nudging the player toward a real hauler for the
  // bigger runs WITHOUT hard-blocking a standard loadout. Ore runs leave it undefined.
  requiresCargoCapacity?: number;
}

// Mission Rework (Task 1, docs/plans/2026-07-14-mission-rework-plan.md): 4 missions.
// The 2 original ore runs (KEYS kept `shortOreRun`/`longOreRun` -- label-only rename,
// so no save migration) plus 2 new missions (`salvageWreckage`, `forageFlora`). Each
// mission yields its OWN common/uncommon/rare material triad via its `lootTable`
// (see MissionLootTable) -- the extraction roll mechanic is identical across all 4;
// only which ITEM each tier deposits differs. Add a new entry here (and nowhere else
// -- App.svelte's Operations panel iterates this object) if a 5th mission is wanted;
// growing this object automatically widens MissionKey, and the exhaustive
// Record<MissionKey,...> maps below (BASE_XP_PER_TICK) will force the new key to be
// given a value.
//
// ⚠️ FIRST-PASS TUNABLE VALUES ⚠️ The 2 NEW missions' phase durations, occurrence
// chances (design's 98.5/1.4/0.1 common/uncommon/rare split -> uncommonChance 0.014,
// rareChance 0.001), creditsPerCycle, and fleetAdminXpPerTick are launch placeholders
// balanced at the device-check stage, same spirit as this file's other constants. The
// 2 ore runs' numeric fields are UNCHANGED from pre-rework (anti-regression) -- only
// their `label` and new `lootTable` fields were added/renamed.
//
// Every entry's cargoCapacity divides evenly by extractionRatePerTick (90/1 = 90) --
// keep this true for any future entry too, or update requiredTicksForPhase's
// extracting case to handle a smaller final tick.
export const MISSIONS: Record<
  "localFuelRun" | "shortOreRun" | "longOreRun" | "salvageWreckage" | "forageFlora",
  MissionDef
> = {
  // Fuel-sourcing RESTRUCTURE (2026-07-15): the fuel BOOTSTRAP mission -- FIRST in the
  // object so it renders FIRST in the Operations tier-I list (the starter). A LOCAL,
  // in-system run (no FTL): transitOut/back are BOTH 0 -> roundTripTransitTicks 0 ->
  // fuelNeeded 0 (fuel.ts), so it costs NO fuel and dispatches on an empty tank / zero
  // credits -- the escape hatch that seeds the whole fuel economy. Its loot is Deuterium
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
  // NOT mark them discovered -- addToInventory gates discovery on amount.gt(0)). So the
  // run genuinely yields deuteriumIce and nothing else. FIRST-PASS TUNABLE values.
  localFuelRun: {
    // PROVISIONAL name (flagged for user rename, same as the ore-tier item names).
    label: "Local Deuterium Skim",
    transitOutTicks: 0, // LOCAL run -> 0 transit -> fuelNeeded 0 (no fuel cost)
    transitBackTicks: 0,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90, // 90 Deuterium Ice per cycle (divides evenly by rate 1)
    uncommonChance: 0, // Deuterium Ice ONLY -- no uncommon tier
    rareChance: 0, //     -- and no rare tier
    lootTable: { common: "deuteriumIce", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    primaryMaterial: "deuteriumIce", // == lootTable.common (§3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1, // INTEGER -- see MissionDef's closed-form parity trap
    creditsPerCycle: 10, // modest -- the payoff is the fuel ore, not credits; TUNABLE
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
    // ANTI-REGRESSION: the IDENTITY triad -- tier key == item key -- so this run's
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
    // REWIRED (design §1): the Lunar Mine now yields the Titanium/Cobalt/Osmium
    // triad (fuel-v2 F1 renamed the `ferriteOre` label to "Titanium") instead of the
    // ore keys. Its auto-stop still gates on the `ferriteOre` key (unchanged).
    lootTable: { common: "ferriteOre", uncommon: "cobaltOre", rare: "osmiumOre" },
    primaryMaterial: "ferriteOre", // == lootTable.common (§3.4 auto-stop)
    tier: "I",
    fleetAdminXpPerTick: 1,
    // FUEL v2 (F3) friendlier bump 20 -> 75, KEPT through the 2026-07-15 FUEL_PER_TICK retune.
    // At FUEL_PER_TICK 1 this no longer exceeds the worst-case auto-buy cost (Freighter
    // need 140 * 5 = 700cr) -- and need not, for the same reason as shortOreRun (refining, not
    // credit auto-buy, is the non-bricking mechanism). A generous reward; FIRST-PASS TUNABLE.
    creditsPerCycle: 75,
    unlockLevel: 1, // available from a fresh save (missionControl seeds at level 1)
  },
  salvageWreckage: {
    // NEW mission (design §1). Phase durations are FIRST-PASS placeholders, sized
    // between the two ore runs (short 25/25, long 70/70) -- retuned at device check.
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
    fleetAdminXpPerTick: 1, // INTEGER -- see MissionDef's closed-form parity trap; Task 2 owns XP retune
    creditsPerCycle: 50, // FUEL v2 (F3) bump 30 -> 50, KEPT through the 2026-07-15 retune (at FUEL_PER_TICK 1 the worst-case auto-buy is now need 90 * 5 = 450cr; refining, not this reward, is the non-bricking mechanism); tunable
    unlockLevel: 1, // USER REVISION 2026-07-14: default-available (all 4 missions unlock at the
    // level-1 seed). Was 2 (behind the deferred mission-control unlock upgrade). See the
    // MissionDef.unlockLevel comment + FACILITIES.missionControl for why that rung is deferred.
    requiresCaptainLevel: 2, // modest bump -- a CAPABILITY gate (design §4), SEPARATE from the
    // unlock above and DELIBERATELY KEPT: the user removed the mission-control UNLOCK upgrade,
    // not the per-mission capability requirements. A fresh level-1 captain still can't fly this.
    requiresCargoCapacity: 90, // == default Freighter hold; excludes only the small Runner (60)
  },
  forageFlora: {
    // NEW mission (design §1). Phase durations are FIRST-PASS placeholders, the
    // longest of the four -- retuned at device check.
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
    fleetAdminXpPerTick: 1, // INTEGER -- see MissionDef's closed-form parity trap; Task 2 owns XP retune
    creditsPerCycle: 60, // FUEL v2 (F3) bump 35 -> 60, KEPT through the 2026-07-15 retune (at FUEL_PER_TICK 1 the worst-case auto-buy is now need 110 * 5 = 550cr; refining, not this reward, is the non-bricking mechanism); tunable
    unlockLevel: 1, // USER REVISION 2026-07-14: default-available (see salvageWreckage's note +
    // the MissionDef.unlockLevel comment). Was 2 (behind the now-deferred unlock upgrade).
    requiresCaptainLevel: 3, // slightly above Salvage's 2 -- CAPABILITY gate, KEPT (see salvageWreckage)
    requiresCargoCapacity: 90, // == default Freighter hold; excludes only the small Runner (60)
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
// missions start at 1 -- a launch placeholder, same spirit as MISSIONS'/RECIPES'
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
  // launch placeholders, same tunable spirit as MISSIONS'/RECIPES' constants -- real
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
  // multiple level-ups) PROVES this holds -- do NOT raise any rate to a fraction
  // without a matching parity assertion at that rate.
  longOreRun: 1.1,
  salvageWreckage: 1.2,
  forageFlora: 1.25,
};

// The 4 real hulls this feature ships (design doc, Task 1). TUNABLE -- first-pass
// balance; real tuning happens at the device-check stage, same launch-placeholder
// spirit as MISSIONS'/RECIPES' constants above. `moduleSlots`/`equipmentSlots`
// are POPULATED but INERT this pass (no module/equipment system exists yet) --
// carried now so the table shape is stable when those systems land, rather than
// bolted on later. Add an entry here (and grow ShipTypeKey above) only when a
// hull is actually built -- the tactician/explorer families are forward buckets,
// deliberately absent until their systems exist.
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
    moduleSlots: 1, equipmentSlots: 0, cost: { credits: 25 },
    // CHEAPEST hull to build (the starter/fallback): a small frame + coupling BOM, no
    // major assembly. ⚠️ FIRST-PASS TUNABLE (see ShipTypeDef.buildRecipe).
    buildRecipe: { components: { frameSegment: 4, powerCoupling: 2 }, credits: 500, durationTicks: 300 },
    description: "A no-frills hauler. Every captain's starter and emergency fallback.",
  },
  prospectorHauler: {
    label: "Hauler", spec: "prospector", tier: 1,
    cargoCapacity: 180, transitSpeedMult: 0.8, extractionYieldMult: 1.0,
    fuelCapacity: 160, engineEfficiency: 0.15, // between: mid tank, mild efficiency
    moduleSlots: 2, equipmentSlots: 0, cost: { credits: 150 },
    // MOST EXPENSIVE to build (double cargo): the biggest frame BOM + 2 major
    // assemblies + the longest build. ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 8, powerCoupling: 5, structuralAssembly: 2 }, credits: 1400, durationTicks: 700 },
    description: "Doubles cargo at the cost of speed -- big hauls, longer runs.",
  },
  prospectorRunner: {
    label: "Runner", spec: "prospector", tier: 1,
    cargoCapacity: 60, transitSpeedMult: 1.5, extractionYieldMult: 1.0,
    fuelCapacity: 100, engineEfficiency: 0.5, // efficiency hull: small tank, least burn
    moduleSlots: 2, equipmentSlots: 0, cost: { credits: 150 },
    // MID build (fast but small hold): a lighter frame BOM than the extraction hulls +
    // 1 major assembly. ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 4, powerCoupling: 4, structuralAssembly: 1 }, credits: 900, durationTicks: 450 },
    description: "Fast transit, small hold -- rapid short cycles.",
  },
  prospectorMiner: {
    label: "Prospector", spec: "prospector", tier: 1,
    cargoCapacity: 90, transitSpeedMult: 1.0, extractionYieldMult: 1.35,
    fuelCapacity: 140, engineEfficiency: 0.25, // between: mid tank, moderate efficiency
    moduleSlots: 2, equipmentSlots: 0, cost: { credits: 150 },
    // ABOVE-MID build (specialized extraction rig): a heavier BOM than the Runner +
    // 1 major assembly, below the Hauler. ⚠️ FIRST-PASS TUNABLE.
    buildRecipe: { components: { frameSegment: 6, powerCoupling: 4, structuralAssembly: 1 }, credits: 1100, durationTicks: 550 },
    description: "Specialized extraction rig -- more materials per tick.",
  },
};

// --- Fuel economy constants (Mission Rework Task 3, design §3) -------------------
// Both FIRST-PASS TUNABLE, same launch-placeholder spirit as MISSIONS'/SHIP_TYPES'
// numbers -- real balancing at the device-check stage.
//   FUEL_PER_TICK         -- fuel burned per round-trip transit tick.
//                            the numerator scale in fuel.ts's fuelNeeded.
//   FUEL_CREDITS_PER_UNIT -- buy price of one fuel unit in credits (buyFuel + the F3
//                            auto-buy-shortfall path both charge this).
// Kept as plain numbers (not Decimal): fuel amounts are small, non-idle-scale values --
// only the GameState.fuel STOCKPILE is Decimal (matches the other currency fields).
//
// ⚠️ FUEL ECONOMY v2 RETUNE (device feedback 2026-07-15) ⚠️ FUEL_PER_TICK was REVERTED
// 0.1 -> 1 (back to the original v1 value). HISTORY: F3 first DROPPED it 1 -> 0.1 fearing a
// dry-tank bankruptcy, but on-device play showed 0.1 was TOO GENEROUS -- the Fuel Depot's
// refining trivially dwarfed the tiny 0.1 consumption (three captains ran ~+1.19k fuel/min
// net-positive with NO upgrades), so fuel was a non-factor, not a managed resource. At 1 a
// round trip costs 1 fuel per transit tick (the meaningful value): Freighter
// (engineEfficiency 0) shortOreRun = 50 transit ticks * 1 = 50 fuel/cycle. This stays
// SUSTAINABLE, NOT bankrupting: a fresh full 500 tank plus the F2 Fuel Depot's refining
// (100 fuel / 10-tick batch = 10 fuel/tick) still FAR outpaces a mission's consumption
// (50 fuel / 149-tick cycle ~= 0.34 fuel/tick) -- refining alone keeps a fresh game afloat
// with no credit spend. It just makes fuel a real resource again, so credit auto-buy (F3)
// is a genuine short-tank backstop rather than a never-triggered branch. FIRST-PASS TUNABLE.
// The Freighter's integer needs (short 50 / long 140 / salvage 90 / forage 110) keep the
// Decimal fuel-tank deductions EXACT -- load-bearing for the F3 offline==live parity proof.
export const FUEL_PER_TICK = 1;
// Fuel-sourcing RESTRUCTURE (2026-07-15): 5 -> 20. Credit auto-buy is now an EXPENSIVE
// convenience / soft-lock escape hatch, NOT a cheap crutch: the intended fuel path is
// refining Deuterium Ice (mined free on localFuelRun) at the Fuel Depot. At 20cr/unit a
// Freighter shortOreRun empty-tank top-up costs 50*20 = 1000cr (vs its 30cr reward), so
// leaning on auto-buy bleeds credits fast -- deliberately steering the player to refine.
// FIRST-PASS TUNABLE, same launch-placeholder spirit as the constants above.
export const FUEL_CREDITS_PER_UNIT = 20;

// ⚠️ FUEL ECONOMY v2 (F3, design §3): the "+2 ticks" refuel-at-a-non-allied-station delay
// added to a mission cycle whenever that cycle had to AUTO-BUY its fuel shortfall from
// credits (tank was short at the cycle boundary but the shortfall was affordable). Modelled
// CLOSED-FORM as a per-cycle addition to the ordersReceived phase's required ticks (stored
// on CaptainMissionState.refuelDelayTicks, set when the auto-buy fires) so it advances
// identically whether the span is one big tick() call or many stepped economyTick(_,1)
// calls -- the offline==live parity guarantee. FIRST-PASS TUNABLE (device-retuned).
export const REFUEL_PENALTY_TICKS = 2;

// FUEL_TANK_BASE_CAP -- the global Fuel Tank's capacity at fuel-storage facility
// level 0 (Mission Rework Task 4, design §3). PARALLELS WAREHOUSE_T1_BASE_CAP: it
// is the base that fuelCap (tick.ts) doubles once per reached fuel-storage rung
// (base * 2^level). ⚠️ CRITICAL no-soft-lock invariant: this base is a REAL,
// usable capacity available from level 0 (a fresh save), NOT a locked/sentinel
// stub -- missions are dispatchable from game start and need fuel, so the tank
// must hold fuel before any facility upgrade. tick.ts imports THIS constant
// directly (single source of truth -- no duplicated base number, unlike the
// warehouse which mirrors its base in tick.ts's BASE_CAP for a separate formula).
// FIRST-PASS TUNABLE, same launch-placeholder spirit as the constants above.
export const FUEL_TANK_BASE_CAP = 500;

// --- Fuel Depot refining constants (Fuel Economy v2 F2, design §2) ---------------
// The Fuel Depot's pipelines continuously refine Deuterium Ice (`deuteriumIce`, its own
// dedicated item as of the 2026-07-15 restructure) into fuel: each pipeline runs one BATCH
// at a time -- consume FUEL_REFINE_INPUT ice ->
// produce FUEL_REFINE_OUTPUT fuel over FUEL_REFINE_DURATION_TICKS ticks -- then
// repeats automatically (processFuelPipelines, tick.ts). These are the LEVEL-0 base
// values; Fuel Depot upgrades scale them (yield up, input down -- see the fuelYield/
// fuelInput helpers). ⚠️ ALL FIRST-PASS TUNABLE, same launch-placeholder spirit as
// the constants above -- real balancing at the device-check stage.
//   FUEL_REFINE_INPUT   -- Deuterium Ice consumed per batch (50 -> 100 to start).
//   FUEL_REFINE_OUTPUT  -- fuel produced per batch.
//   FUEL_REFINE_DURATION_TICKS -- batch length; MIRRORS the material Refinery recipe's
//                          10-tick common-tier duration (a deliberate parallel, tunable).
//   FUEL_DEPOT_BASE_PIPELINES -- concurrent pipelines at facility level 0 (design: "start 1").
// Kept as plain numbers (INPUT is wrapped in a Decimal at the deduct site, since the
// process engine's input map is Record<string, Decimal>); OUTPUT feeds the Decimal
// fuel tank. Small human-scale values, same rationale as fuel.ts's plain-number math.
export const FUEL_REFINE_INPUT = 50;
export const FUEL_REFINE_OUTPUT = 100;
export const FUEL_REFINE_DURATION_TICKS = 10;
export const FUEL_DEPOT_BASE_PIPELINES = 1;

// A concrete ship in the fleet -- an instance of one SHIP_TYPES hull. Distinct
// from ShipTypeDef (the shared, immutable stat template): a ShipInstance is the
// mutable, per-ship record. Its `assignedCaptainId` is the SINGLE SOURCE OF
// TRUTH for who flies this hull (null = parked/available) -- deliberately not
// duplicated onto CaptainState, so the two never disagree. Consumed by later
// tasks (fleet state, assignment UI); nothing reads it yet.
export interface ShipInstance {
  id: string;                       // stable unique id, allocated from GameState.nextShipId ("ship-N")
  typeKey: ShipTypeKey;
  assignedCaptainId: number | null; // SINGLE SOURCE OF TRUTH for assignment; null = parked/available
  name?: string;                    // player naming deferred
  // FORWARD (not this pass): modules?, equipment?, reactorCore?, tierOverride?
}

export interface CaptainMissionState {
  missionKey: MissionKey;
  phase: MissionPhase;
  phaseProgressTicks: number; // continuous (can be fractional mid-tick) so multi-tick deltas land on exact phase boundaries
  cargo: Record<LootMaterialKey, Decimal>;
  recalled: boolean; // if true, ends the loop (mission -> null) after THIS cycle's unloading completes,
  // instead of auto-restarting at ordersReceived. Does not interrupt the current cycle mid-flight.
  // FUEL ECONOMY v2 (F3, design §3): the "+2 ticks" refuel-at-a-non-allied-station delay for
  // THIS cycle -- REFUEL_PENALTY_TICKS when this cycle had to auto-buy its fuel shortfall from
  // credits (tank short but affordable at the cycle boundary), otherwise 0. Added to the
  // ordersReceived phase's required ticks in tickCaptainMission, so a penalized cycle runs 2
  // ticks longer. CLOSED-FORM: it is a per-cycle constant stamped at the cycle boundary, so it
  // advances identically one-big-call vs many-stepped-calls (the offline==live parity proof).
  // OPTIONAL so pre-F3 saves (whose in-flight missions predate the field) rehydrate as absent
  // and are read as 0 (`?? 0`) -- no migration needed; a fresh cycle always sets it explicitly.
  refuelDelayTicks?: number;
}

// How many ticks a phase requires before advancing to the next one.
// "extracting" is the one phase whose length isn't a literal field on
// MissionDef -- it's however many ticks it takes to extract cargoCapacity
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
      return Math.ceil(missionDef.cargoCapacity / missionDef.extractionRatePerTick);
    case "transitBack":
      return missionDef.transitBackTicks;
    case "unloading":
      return missionDef.unloadTicks;
  }
}

// The three mission-relevant stats a hull contributes, lifted out of the shared
// SHIP_TYPES template for a specific ShipInstance. A thin projection -- it exists
// so callers (effectiveMissionDef below, plus later assignment/UI tasks) depend
// on a small, explicit shape rather than reaching into the full ShipTypeDef and
// its inert forward fields (moduleSlots/equipmentSlots/cost/etc.). PURE: reads
// the immutable table, returns a fresh object, mutates nothing.
export interface ShipDerivedStats {
  cargoCapacity: number;
  transitSpeedMult: number;
  extractionYieldMult: number;
}

export function shipDerivedStats(ship: ShipInstance): ShipDerivedStats {
  const def = SHIP_TYPES[ship.typeKey];
  return {
    cargoCapacity: def.cargoCapacity,
    transitSpeedMult: def.transitSpeedMult,
    extractionYieldMult: def.extractionYieldMult,
  };
}

// Returns a MODIFIED COPY of the base mission with the ship's stats applied.
// transit rescaled by ceil (stays integer + closed-form); cargo drives the
// extraction-phase length (requiredTicksForPhase reads cargoCapacity). Because
// extractionRatePerTick is 1 for today's missions, any integer ship cargo still
// divides evenly -- no partial-final-tick path is introduced.
export function effectiveMissionDef(base: MissionDef, ship: ShipDerivedStats): MissionDef {
  return {
    ...base,
    transitOutTicks: Math.ceil(base.transitOutTicks / ship.transitSpeedMult),
    transitBackTicks: Math.ceil(base.transitBackTicks / ship.transitSpeedMult),
    cargoCapacity: ship.cargoCapacity,
  };
}

export interface CaptainState {
  id: number;
  label: string; // placeholder, e.g. "Captain 1" -- naming UI deferred per master doc §10.7
  mission: CaptainMissionState | null; // null when idle (idle captains have no passive economy -- see tick.ts)
  xp: Decimal; // accumulated toward the NEXT level -- see xpForNextLevel() below; accrued per active tick in tick.ts's tickCaptainMission (Task 4)
  level: number; // starts at 1
  statPoints: number; // unspent, earned on level-up -- spent via buyHomeworldTalent's unlockCaptainSlot effect (tick.ts)
  unlockedCaptainTalents: CaptainTalentKey[]; // this captain's own purchased Captain Talent keys -- see buyCaptainTalent (tick.ts)
  spec: CaptainTalentBranch | null; // this captain's chosen Captain Specialization, if any -- null means no CAPTAIN_SPEC_BONUS entry applies yet (see that table below)
}

// --- Ship Production Economy (Phase 1, Task 3 -- docs/plans/2026-07-11-facility-
// framework-refinery-design.md §3/§5) --------------------------------------------
// DEFINITIONS ONLY this task. The ENGINE that creates/advances/resolves these
// (startProcess/resolveCompletedProcesses, the deduct-at-start + closed-form
// completion logic) lands in Task 8 -- nothing reads or writes any of the state
// fields below yet. Kept deliberately MINIMAL (Omega YAGNI): Task 8/10/11 extend
// them for batch/continuous refine orders + slot counts as those mechanics land;
// this forward shape is only what the save schema needs to reserve NOW so old
// saves don't have to re-migrate later.

// The timed shapes this engine ships. All are the same deterministic,
// fixed-duration process (design §3); the union keeps them distinguishable at the
// resolver. Extensible -- missions could fold onto this engine later (design §2),
// so a new literal slots in without touching existing call sites (same convention
// as ShipType/MissionTier above).
//
// Fuel Economy v2 (F2): "fuelRefineJob" is the Fuel Depot's pipeline batch -- a
// Deuterium-Ice -> fuel refine that deposits into the GameState.fuel TANK (not
// inventory), distinct from a "refineJob" (which outputs an inventory item). It
// reuses the SAME countdown/completion machinery; only its completion EFFECT differs
// (addFuel, below). It is deliberately EXCLUDED from the resolver's Fleet-Admiral-XP
// lump award (see resolveProcesses) so the new fuel economy does not perturb the
// tuned FA-XP curve.
// Research (Task R3, design §3): "researchProject" is a timed research project run by
// the Research Lab -- a countdown whose COMPLETION unlocks a blueprint (the unlockBlueprint
// effect below) rather than adding an item / bumping a level. It reuses the SAME
// countdown/completion machinery; only its completion effect differs. Like "fuelRefineJob"
// it is EXCLUDED from the resolver's Fleet-Admiral-XP lump award (see resolveProcesses) --
// research is automated infra that must not perturb the tuned FA-XP curve.
// Fabricator (Phase 4, Task F2): a "fabricateJob" crafts a researched blueprint's
// component from materials -- the Fabricator's analog of the Refinery's "refineJob".
// It reuses the SAME countdown/completion machinery and the SAME "addItem" completion
// effect (resolveProcesses needs no new branch); only its INPUTS (a blueprint recipe)
// and its lifetime tally (itemsCrafted, not itemsRefined) differ. UNLIKE refineJob it
// is EXCLUDED from the resolver's Fleet-Admiral-XP lump award (see resolveProcesses) --
// like researchProject/fuelRefineJob, it is a blueprint-gated, long-duration automated
// economy that must not perturb the tuned FA-XP curve (a 120-300-tick craft would dump
// a large lump; the tiny-duration Phase-1 refineJob keeps its award). ⚠️ DESIGN DECISION
// flagged to the controller -- flip the exclusion + this comment together if fabrication
// should feed FA XP.
// Shipyard (Phase 5, Task S3): "shipBuild" is a timed ship-construction job. Like
// fabricateJob/researchProject it is EXCLUDED from the completion FA-XP lump award
// (resolveProcesses) -- a hull build is a big blueprint-gated automated job, not a
// tuned FA-XP source. Its completion effect is the NEW `addShip` ProcessEffect (a
// ship is NOT an inventory item, so it cannot reuse addItem). One build slot this
// pass (shipBuildSlotCount, tick.ts).
export type TimedProcessKind = "refineJob" | "facilityUpgrade" | "fuelRefineJob" | "researchProject" | "fabricateJob" | "shipBuild";

// What a process's COMPLETION applies (inputs were already deducted at START --
// design §4's atomic-consume fix). `addItem` grants a refine job's output;
// `facilityLevelUp` bumps a facility's level. `facility` is a plain string (not a
// FacilityKey union) so a later facility needs no type change here -- forward-loose
// on purpose, same reasoning as inventory's `Record<string, Decimal>` key type.
export type ProcessEffect =
  | { type: "addItem"; itemId: string; amount: Decimal }
  | { type: "facilityLevelUp"; facility: string }
  // Fuel Economy v2 (F2): a Fuel Depot pipeline batch's completion deposits `amount`
  // fuel into the GameState.fuel TANK (a Decimal currency), NOT into inventory. This
  // is the ONE difference between a "fuelRefineJob" and an inventory "refineJob":
  // both consume an atomic input at start (deduct-at-start, startProcess) and run a
  // fixed countdown, but this effect targets the capped fuel tank instead of an item
  // key. resolveProcesses adds it to state.fuel on completion (may overshoot fuelCap
  // by up to one batch, the SAME soft-cap behavior addItem has vs. a warehouse cap).
  | { type: "addFuel"; amount: Decimal }
  // Research (Task R3, design §3): a completed research project unlocks its blueprint by
  // adding `key` to state.researchedBlueprints (resolveProcesses, idempotent -- no dup).
  // The discriminant "unlockBlueprint" and the `key: string` field are FIXED by design §3
  // and are the EXACT shape R1's blueprintResearchable already scans activeProcesses for
  // (its "not in progress" check reads `effect.type === "unlockBlueprint" && effect.key`
  // via a forward cast) -- keep them in lockstep or that scan silently goes stale.
  // Carries NO Decimal (unlike addItem/addFuel's `amount`), so hydrateDecimals (save.ts)
  // needs NO change: its `"amount" in effect` guard skips this effect, and it round-trips
  // through JSON as plain {type,key} strings.
  | { type: "unlockBlueprint"; key: string }
  // Shipyard (Task S3, design §5): a completed shipBuild MINTS a parked ShipInstance of
  // `typeKey` (resolveProcesses appends it to state.ships + bumps nextShipId). This is a
  // NEW effect (NOT a reuse of addItem) because a ship is a first-class fleet object, not
  // an inventory item -- it has an id, a typeKey, and an assignment, none of which the
  // itemId/amount inventory shape can carry. Like unlockBlueprint it carries NO Decimal
  // (typeKey is a plain string union), so hydrateDecimals (save.ts) skips it via its
  // `"amount" in effect` guard and it round-trips through JSON as {type,typeKey} strings.
  | { type: "addShip"; typeKey: ShipTypeKey };

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
  remainingTicks: number; // ticks left until completion; decremented by resolveProcesses -- closed-form countdown
  durationTicks: number;  // FIXED at creation -- initial remainingTicks AND the lump FA XP awarded on completion
  effect: ProcessEffect;  // what completion does (add item / level up a facility)
  // Crafting Allocation Redesign (Task C2): the production LINE that owns this job,
  // when it was started by the per-slot line engine (processRefineLines /
  // processFabricateLines, tick.ts) -- the CraftLine.id ("craft-N"). It ties an
  // in-flight job back to its line so the engine can enforce "at most ONE in-flight
  // job per line" (a line with a matching `lineId` in activeProcesses is busy) and
  // know when a finished batch line may be removed. ABSENT (undefined) on every OTHER
  // process kind -- manual refine/fabricate jobs (startRefineJob/startFabricateJob),
  // facility upgrades, fuel batches, research projects -- so those ride through
  // untouched. A plain string (no Decimal), so save hydration needs no change: it
  // rides the activeProcesses `...state` spread verbatim.
  lineId?: string;
}

// A built facility's live state. `level` 0 = not built; unlock is the level 0->1
// upgrade (design §5, "no separate unlock system"). Minimal for Phase 1 -- Task
// 10/11 may extend this (e.g. per-facility refine-order/slot bookkeeping) as the
// refinery UI + batch orders land.
export interface FacilityState {
  level: number; // 0 = not built
}

// --- Facility framework (Phase 1, Task 10 -- docs/plans/2026-07-11-facility-
// framework-refinery-design.md §5/§6) ----------------------------------------
// The reusable meta-system every later facility (Warehouse, Fabricator, Research,
// Shipyard...) hangs on, plus its first real node (the Refinery). A facility's
// upgrade TRACK is a FINITE, ordered list: upgrades[i] holds the requirements to
// reach level i+1 (so upgrades[0] is the level 0->1 build/unlock -- there is NO
// separate unlock system, design §5). Buildability + the startFacilityUpgrade
// action live in tick.ts (they use the Task 8 startProcess engine); THIS file
// only declares the shapes + the launch data table.

// What a completed facility upgrade GRANTS. Distinct from ProcessEffect (which is
// what the timed-PROCESS applies on completion -- a facilityUpgrade process just
// bumps the level via { type: "facilityLevelUp" }). This effect is DESCRIPTIVE
// metadata on the upgrade DEF: the refine-slot / refine-speed system (Task 11+)
// derives a facility's total slots / speed by summing these across every level
// reached, exactly the way SHIP_TYPES' moduleSlots are POPULATED-but-INERT until
// their system lands. Extensible union (same convention as ProcessEffect /
// TimedProcessKind): a future effect kind slots in without touching call sites.
export type FacilityUpgradeEffect =
  | { addRefineSlots: number }   // +N parallel refine jobs this facility can run (Task 11 derives slot totals)
  | { refineSpeedMult: number }  // multiplies this facility's refine-job speed (Task 11 consumes it)
  // Phase 2, Task B2 (design §3.3): a Warehouse-tier cap MULTIPLIER. Each reached
  // warehouse rung multiplies its tier's per-item storage cap by this factor;
  // tierCap (tick.ts) DERIVES the live cap by multiplying BASE_CAP[tier] across
  // every reached rung's storageCapMult -- the SAME derive-on-read/reached-rungs
  // pattern refineSlotCount uses to SUM addRefineSlots. Every T1/T2 rung is x2, so
  // the product is 2^level (the design's "cap doubles per level"); the value lives
  // on the rung (not hard-coded in tierCap) so the upgrade track stays the single
  // source of truth and a future tier could tune a different factor with no
  // formula change. This is a NON-discriminated union (distinguished by property
  // presence, no `type` tag) -- consumers narrow with `"storageCapMult" in effect`
  // (tierCap) exactly as refineSlotCount narrows with `"addRefineSlots" in effect`,
  // so this new member is safely IGNORED by every existing consumer that checks for
  // a different property.
  | { storageCapMult: number }
  // Mission Rework (Task 6): a marker for a rung whose ENTIRE benefit is the LEVEL
  // BUMP ITSELF -- it grants no summed slot/speed/cap stat. The mission-control
  // facility's rungs carry this: what a level unlocks is derived on read from the
  // facility LEVEL (see tick.ts's missionUnlocked + MissionDef.unlockLevel), NOT by
  // summing an effect off the track. Every existing consumer (refineSlotCount /
  // tierCap / fuelCap) narrows by ITS OWN property AND scopes to its own facility, so
  // this member is inert to all of them -- it exists only to satisfy the required
  // `effect` field honestly (a misleading `addRefineSlots: 0` / `storageCapMult: 1`
  // would imply a stat this facility does not have). Extensible union, same
  // property-presence narrowing convention as the members above.
  | { unlocksContent: true }
  // --- Fuel Economy v2 (F2): Fuel Depot PROCESSING upgrades --------------------
  // Three effects that improve the Fuel Depot's Deuterium-Ice -> fuel pipelines,
  // SEPARATE from its { storageCapMult } tank-cap rungs (which stay). Each is derived
  // on read by ITS OWN helper (tick.ts) summing/multiplying only its property across
  // the reached fuelStorage rungs -- the SAME derive-on-read/reached-rungs idiom
  // refineSlotCount / fuelCap use, and the SAME "one track, heterogeneous rungs"
  // pattern the Refinery already uses (addRefineSlots + refineSpeedMult on one track).
  // Because narrowing is by PROPERTY PRESENCE, a rung carrying one of these is inert
  // to fuelCap (no storageCapMult) and vice-versa, so cap rungs and processing rungs
  // coexist on the one fuelStorage track without interfering. ⚠️ First-pass TUNABLE.
  | { addFuelPipelines: number } // +N concurrent auto-refine pipelines (fuelPipelineCount sums)
  | { fuelYieldMult: number }    // xM fuel produced per batch (fuelBatchOutput multiplies)
  | { fuelInputMult: number }    // xM Deuterium Ice consumed per batch; M<1 = less ice (fuelBatchInput multiplies)
  // --- Research (Task R2, design §1): the Research Lab's SLOT grant ---------------
  // +N concurrent research projects this facility can run. researchSlotCount (tick.ts)
  // SUMS this across the reached rungs -- the EXACT same derive-on-read/reached-rungs
  // idiom refineSlotCount uses for `addRefineSlots` (research slots are literally the
  // Research Lab's analog of the Refinery's refine slots). The Research Lab's blueprint
  // TIER unlock is NOT summed off an effect: it derives from the facility LEVEL
  // (blueprintResearchable reads level >= tier), the same way missionUnlocked derives
  // missions from the mission-control level -- so a research rung's effect is ONLY the
  // slot grant, never a content-unlock marker. Property-presence narrowing (same as the
  // members above), so a rung carrying this is inert to refineSlotCount / tierCap /
  // fuelCap / the fuel helpers, and vice-versa.
  | { addResearchSlots: number }
  // --- Fabricator (Phase 4, F1 -- design §1): the Fabricator's SLOT grant ----------
  // +N concurrent craft jobs this facility can run. fabricateSlotCount (tick.ts) SUMS
  // this across the reached rungs -- the EXACT same derive-on-read/reached-rungs idiom
  // refineSlotCount uses for `addRefineSlots` and researchSlotCount uses for
  // `addResearchSlots` (fabricate slots are the Fabricator's analog of refine/research
  // slots). The blueprint TIER unlock is NOT summed off an effect: it derives from the
  // facility LEVEL (a blueprint is fabricable when fabricator level >= blueprint.tier),
  // the same way researchSlotCount's Research Lab derives tiers from level -- so a
  // fabricate rung's effect is ONLY the slot grant, never a content-unlock marker.
  // ADDED ADDITIVELY + INERT: property-presence narrowing (same convention as every
  // member above), so a rung carrying this is inert to refineSlotCount / researchSlotCount
  // / tierCap / fuelCap, and -- critically -- NO existing facility rung sets it, so this
  // member changes NO existing behavior (anti-regression: Omega 15).
  | { addFabricateSlots: number }
  // --- Shipyard (Phase 5, Task S1 -- design §2): the build-SPEED multiplier ----------
  // Multiplies the Shipyard's ship-build SPEED (>1 = FASTER, i.e. the build engine S3
  // will DIVIDE a hull's buildRecipe.durationTicks by the PRODUCT of this across the
  // reached rungs -- the SAME derive-on-read/reached-rungs idiom refineSpeedMult uses,
  // a MULTIPLIED effect rather than a SUMMED slot grant). The Shipyard's founding rung
  // establishes the facility (an inert `unlocksContent` level-bump, like Mission
  // Control's founding); its LATER rungs carry this to cut build time. Refit + repairs
  // are FUTURE rungs on this same track (design §2, hooked-not-built).
  // ADDED ADDITIVELY + INERT (anti-regression, Omega 15): property-presence narrowing
  // (same convention as every member above), so a rung carrying this is inert to
  // refineSlotCount / researchSlotCount / fabricateSlotCount / tierCap / fuelCap, and --
  // critically -- NO existing facility rung sets it (only FACILITIES.shipyard's later
  // rungs do), so this member changes NO existing behavior. No consumer READS it yet
  // either (the S3 build engine will); it is inert data this pass.
  | { buildSpeedMult: number };

// One rung of a facility's upgrade track = the requirements to reach the NEXT
// level. `materials` are deducted ATOMICALLY at start by startProcess (design §4).
// Every `requires*` field is an OPTIONAL gate (absent = that gate does not apply):
//   - requiresHomeworldTalents: all must be in state.unlockedHomeworldTalents.
//   - requiresResearch: research-topic ids -- reserved, EMPTY today (no research
//     topics exist yet). "No placeholders": no upgrade sets it, but the gate is
//     honored if a future topic ever does.
//   - requiresFacilityLevels: other facilities that must be at >= the given level
//     (a cross-facility dependency chain). EMPTY today -- refinery is the only
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
  // before -- every PRE-R2 facility (refinery/warehouses/fuel depot/mission control)
  // OMITS this field, so the credits gate in canBuildFacilityUpgrade + the deduct in
  // startFacilityUpgrade are INERT for all of them (no behavior change, no regression).
  // The Research Lab is the FIRST rung-cost-in-credits facility (its upgrade credit
  // sink is the design's "credits get a real long-term sink"). A Decimal (not a plain
  // number) to match state.credits' type at the compare/deduct sites; it lives in the
  // STATIC FACILITIES table (constructed at module load, like `materials`' Decimals),
  // so it never round-trips through the JSON save -- no hydration concern.
  credits?: Decimal;
  durationTicks: number;
  effect: FacilityUpgradeEffect;
  requiresHomeworldTalents?: HomeworldTalentKey[];
  requiresResearch?: string[];                    // EMPTY today (no research topics) -- reserved, no placeholder
  requiresFacilityLevels?: Record<string, number>;
  requiresFleetAdminLevel?: number;
  // Mission Rework (Task 6): a PLAY-COMPLETION gate. Each listed mission must have a
  // lifetime completion count (state.lifetimeStats.missionsCompleted[key]) >= the
  // given threshold before this rung is buildable. A NEW prereq kind alongside the
  // FA-level / talent / research / facility-level gates above -- same OPTIONAL posture
  // (absent = gate does not apply) and the SAME "first failing gate names the reason"
  // treatment in canBuildFacilityUpgrade (tick.ts). Partial over MissionKey because a
  // rung gates on only SOME missions (a future mission-control unlock rung would gate on
  // whichever missions are available at that point). This is the mechanism that makes a
  // mission-control unlock track "earn it by playing" rather than "buy it".
  //
  // USER REVISION 2026-07-14: no PRODUCTION rung uses this field today -- the mission-
  // control unlock UPGRADE was deferred (see FACILITIES.missionControl). The type + its
  // canBuildFacilityUpgrade enforcement are RESERVED and TESTED (mission-control.test.ts's
  // fixture-facility coverage) so a future unlock rung is a pure data re-add.
  requiresMissionCompletions?: Partial<Record<MissionKey, number>>;
}

export interface FacilityDef {
  label: string;
  upgrades: FacilityUpgradeDef[]; // upgrades[i] = requirements to reach level i+1; FINITE track, extended additively
}

// Launch facility table -- REAL levels only, same "no placeholders" discipline as
// MISSIONS/RECIPES/SHIP_TYPES. Phase 1 seeds ONLY the Refinery, with a FINITE
// 4-level upgrade track (extend additively as higher tiers / research gates land).
// ⚠️ ALL numeric values below (materials, durations, FA-level + talent gates) are
// TUNABLE LAUNCH PLACEHOLDERS -- first-pass content, real balance happens at the
// device-check stage, exactly like every other launch table's constants here.
//
// Track shape rationale:
//   - Level 0->1 (Build) is INTENTIONALLY UNGATED beyond its material cost -- the
//     first facility must be buildable from a fresh save (a fresh fleet is at FA
//     level 1 with no talents), so gating the initial build behind FA level /
//     talents would soft-lock the whole system. Gates appear on LATER rungs only.
//   - Escalating commonOre (and refinedMaterial on the higher rungs, closing a
//     loop: you must refine to upgrade the refinery) + escalating durations.
//   - Levels 1->2, 2->3 each grant +1 refine slot (more parallel jobs); the final
//     3->4 rung grants a refineSpeedMult instead, to exercise BOTH effect kinds.
//   - requiresFleetAdminLevel gates (2, 5, 8) + a requiresHomeworldTalents gate
//     ("industryHub", the Industry category hub -- thematically apt for a refinery)
//     are REAL gates against content that exists today. requiresResearch /
//     requiresFacilityLevels stay unused (no research topics; refinery is the only
//     facility) -- their gate logic is implemented + reserved, not faked into data.
// --- Tiered Warehouse facilities (Phase 2, Task B2 -- design §3.1-§3.3) -------
// Each warehouse TIER is its OWN facility (own key, own level, own upgrade track)
// hung on the SAME Phase 1 facility framework the Refinery uses -- so the existing
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
// placeholders -- they are DERIVED from the design's cap economy (75% of the cap at
// the level being upgraded); retune the cap economy, not the costs directly.

// T1 default (level-0) per-item cap. Mirrors tick.ts's BASE_CAP[1] -- they encode
// the SAME design number (design §3.3: 1,000,000), kept in both places because
// this one feeds the cost formula (75% of the cap) while tick.ts's feeds tierCap.
// Change BOTH together if the T1 base ever moves.
export const WAREHOUSE_T1_BASE_CAP = 1_000_000;

// ~25 rungs = "effectively infinite" for a doubling track (2^25 * 1M ≈ 3.4e13 cap),
// satisfying design §3.3's "repeatable" cap upgrades. GENERATED by a loop (below),
// never hand-written -- every rung is pure formula.
const WAREHOUSE_T1_RUNG_COUNT = 25;

// The cap at the START of level `level` (BEFORE that level's own doubling) =
// base * 2^level. Rung `level`'s material cost is 75% of this (design §3.3). Pure
// exact Decimal math: base * 2^level is an exact integer, and *3/4 is exact because
// base is divisible by 4.
function warehouseT1CapAtLevel(level: number): Decimal {
  return new Decimal(WAREHOUSE_T1_BASE_CAP).times(2 ** level);
}

// Builds T1's finite (~25-rung) doubling track. Rung i (level i -> i+1):
//   - materials: { commonOre: 75% of the cap at level i } -- steep, scales with cap.
//   - durationTicks: escalating placeholder in the Refinery's ballpark, grows
//     linearly with level (20, 40, ... 500) -- TUNABLE, real balance at the device
//     checkpoint.
//   - effect: { storageCapMult: 2 } -- doubles the tier cap (tierCap reads this).
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

// T2 is a STUB this phase (design §3.3): the warehouse UNLOCKS honestly, but its
// first real upgrade is gated on a T2 material (denseOre) that NOTHING produces yet
// -- a real "future content" wall, not a fake tier. tierCap uses BASE_CAP[2] (a 1M
// STUB placeholder; the real T2 base is TBD when T2 content lands).
export const WAREHOUSE_T2_BASE_CAP = 1_000_000; // STUB -- real T2 base TBD

// T2 ships a MINIMAL track (stub, not real content): rung 0 = unlock, then a few
// generated denseOre-gated rungs.
const WAREHOUSE_T2_RUNG_COUNT = 5;

function warehouseT2CapAtLevel(level: number): Decimal {
  return new Decimal(WAREHOUSE_T2_BASE_CAP).times(2 ** level);
}

// Builds T2's stub track:
//   - Rung 0 (level 0 -> 1) = the tier UNLOCK. Cost { commonOre: 1,000,000 } = 100%
//     of T1's default cap (design §3.3: "unlock = 100% of the previous tier's
//     default cap"). TIMED like every rung; payable with T1's own ore, so the
//     unlock itself is reachable today.
//   - Rungs 1+ = the first REAL upgrades, priced in denseOre (the T2 ore) at 75% of
//     the T2 cap at that level. Because denseOre is UNOBTAINABLE (produced by
//     nothing this phase), these rungs are NATURALLY gated -- canBuildFacilityUpgrade
//     rejects them on the material check with no explicit requires* gate needed;
//     the unobtainable input IS the wall.
function buildWarehouseT2Upgrades(): FacilityUpgradeDef[] {
  const upgrades: FacilityUpgradeDef[] = [];
  // Rung 0: unlock, paid in commonOre (100% of T1's default 1M cap).
  upgrades.push({
    materials: { commonOre: new Decimal(WAREHOUSE_T1_BASE_CAP) },
    durationTicks: 60, // TUNABLE placeholder (a T1-unlock-ballpark timed cost)
    effect: { storageCapMult: 2 },
  });
  // Rungs 1..N-1: denseOre-gated real upgrades (unobtainable -> naturally walled).
  for (let i = 1; i < WAREHOUSE_T2_RUNG_COUNT; i++) {
    upgrades.push({
      materials: { denseOre: warehouseT2CapAtLevel(i).times(3).div(4) }, // 75% of T2 cap at level i
      durationTicks: 60 * (i + 1), // TUNABLE placeholder, escalating
      effect: { storageCapMult: 2 },
    });
  }
  return upgrades;
}

// --- Fuel Depot facility (Fuel Economy v2 F2 -- design §2; was "Fuel Storage",
//     Mission Rework Task 4) ------------------------------------------------------
// The facility KEY stays `fuelStorage` (label-only rename to "Fuel Depot" -- NO save
// migration for the key; F5 owns any migration). It now has TWO roles on ONE upgrade
// track:
//   1. STORAGE (unchanged mechanic): a base tank capacity (FUEL_TANK_BASE_CAP) doubled
//      once per reached { storageCapMult: 2 } rung, DERIVED on read by fuelCap (tick.ts)
//      exactly as tierCap derives a warehouse tier's cap. Available + USABLE from level 0
//      (design §3 no-soft-lock: missions need fuel from game start).
//   2. PROCESSING (new, F2): continuously refines Deuterium Ice -> fuel via `pipelineCount`
//      concurrent auto-batches (processFuelPipelines, tick.ts). Upgrades add pipelines
//      (+concurrency), raise yield (+fuel/batch), and cut input (-ice/batch).
// It hangs on the SAME facility framework (startFacilityUpgrade / canBuildFacilityUpgrade /
// resolveProcesses) with NO new upgrade machinery -- each rung is a facilityUpgrade
// TimedProcess that bumps facilities.fuelStorage.level; the derive-on-read helpers
// (fuelCap / fuelPipelineCount / fuelBatchOutput / fuelBatchInput) each read ONLY their
// own effect property across the reached rungs, so storage rungs and processing rungs
// coexist on the one track (same pattern the Refinery's addRefineSlots+refineSpeedMult
// track uses).
//
// ⚠️ TRACK SHAPE -- REAL CONTENT ONLY (F2 "don't over-build; cap at real content"):
// a SHORT explicit finite track, NOT the old ~20-rung generated cap tower. The FIRST
// THREE rungs are pure { storageCapMult: 2 } cap doublings so fuelCap stays
// base*2^level for levels 1-3 (fuel.test.ts PINS fuelCap at levels 1 and 3 -- keep them
// pure storage). Then three PROCESSING rungs (+pipeline / +yield / -input), then a few
// more storage rungs so the tank can keep growing. Cap tops out at base*2^6 = 32,000
// fuel -- ample at fuel's human scale. ⚠️ ALL numbers (costs, durations, effect
// magnitudes) FIRST-PASS TUNABLE -- real balance at the device-check stage.
//
// Cost SHAPE mirrors warehouseT1's: a storage rung costs 75% of the tank cap it is
// about to double (tracked via a running `cap`); processing rungs get hand-authored
// commonOre (Deuterium Ice) costs -- thematically apt (mine ice to expand the ice plant).
function buildFuelDepotUpgrades(): FacilityUpgradeDef[] {
  const upgrades: FacilityUpgradeDef[] = [];
  let cap = new Decimal(FUEL_TANK_BASE_CAP); // running tank cap as storage rungs are added
  let dur = 20; // escalating duration placeholder (20, 40, 60, ...), TUNABLE

  // A storage rung: doubles the cap; cost = 75% of the cap BEFORE doubling. Exact
  // Decimal math (base 500 is divisible by 4, and every double stays divisible by 4).
  const storageRung = () => {
    upgrades.push({
      materials: { commonOre: cap.times(3).div(4) }, // 75% of current cap
      durationTicks: dur,
      effect: { storageCapMult: 2 },
    });
    cap = cap.times(2);
    dur += 20;
  };
  // A processing rung: hand-authored commonOre cost; effect is one of the F2 pipeline
  // effects. Does NOT touch `cap` (processing rungs do not double the tank).
  const processingRung = (cost: number, effect: FacilityUpgradeEffect) => {
    upgrades.push({ materials: { commonOre: new Decimal(cost) }, durationTicks: dur, effect });
    dur += 20;
  };

  // Levels 1-3: pure storage doublings (cap 500 -> 1000 -> 2000 -> 4000). fuel.test.ts
  // pins fuelCap at levels 1 (2x) and 3 (8x), so these THREE stay pure { storageCapMult }.
  storageRung();
  storageRung();
  storageRung();

  // Levels 4-6: the three PROCESSING upgrades (one of each F2 effect). Cap stays 4000
  // across these (no storageCapMult). Costs/magnitudes TUNABLE first-pass.
  processingRung(2000, { addFuelPipelines: 1 }); // level 4: 2 concurrent pipelines
  processingRung(3000, { fuelYieldMult: 1.5 }); // level 5: fuel/batch 100 -> 150
  processingRung(3000, { fuelInputMult: 0.7 }); // level 6: ice/batch 50 -> 35

  // Levels 7-9: more storage headroom (cap 4000 -> 8000 -> 16000 -> 32000). Finite.
  storageRung();
  storageRung();
  storageRung();

  return upgrades;
}

// --- Mission-control facility (Mission Rework Task 6 -- design §2) ------------
// The facility whose LEVEL unlocks missions. Unlike the Refinery (built from level
// 0) or the Warehouse/Fuel tanks (usable base at level 0), mission control is
// SEEDED at level 1 on a fresh save (freshState below) + on migrated saves (Task 9)
// so EVERY current mission is available from game start. That is the no-soft-lock /
// no-regression guarantee: a fresh fleet can dispatch all four missions immediately.
//
// USER REVISION 2026-07-14 -- UNLOCK UPGRADE DEFERRED. The directive was "4 missions
// should be the default" (all four current missions unlockLevel 1). The old level-1 ->
// 2 upgrade unlocked Salvage + Forage -- but those are now default, and there are NO
// additional (5th+) missions built yet, so a LIVE level-1 -> 2 rung would unlock
// NOTHING = a placeholder. Per the no-placeholder discipline this file follows, that
// rung is DEFERRED (removed for now) and the facility CAPS at its current content
// (level 1, all four missions unlocked). The unlock MECHANISM is fully retained and
// ready (see below) -- it re-activates the moment additional missions exist.
//
// The track is FINITE (length 1) and caps at level 1 -- REAL content only:
//   - upgrades[0] (level 0 -> 1): the FOUNDING rung. It is PRE-GRANTED via the
//     level-1 seed, so a player never builds it in normal play. It is genuine
//     (ungated, zero-cost: a level-0 mission control would establish instantly), NOT
//     a placeholder -- the same spirit as freshState pre-granting the starting captain
//     + hull instead of making the player build them. Its effect is the inert
//     `unlocksContent` marker (the missions it "grants" are derived from level via
//     MissionDef.unlockLevel, not from this effect). It is kept as the lone founding
//     rung so a level-1 facility reads as "fully upgraded" (upgrades[level] undefined).
//   - upgrades[1] (level 1 -> 2): DEFERRED. When a FUTURE mission batch lands, re-add
//     the completion-gated rung here (unlocking those new missions at unlockLevel 2),
//     wired to MISSION_CONTROL_UNLOCK_COMPLETIONS via requiresMissionCompletions -- the
//     "earn it by playing" gate. The prereq TYPE (FacilityUpgradeDef.
//     requiresMissionCompletions) and its enforcement in canBuildFacilityUpgrade
//     (tick.ts) are RESERVED AND TESTED for exactly this, so re-adding the rung is a
//     pure data change -- no engine work. See mission-control.test.ts's reserved-
//     mechanism coverage.
//
// UNLOCK THRESHOLD -- RESERVED (not live today). The count of completions of EACH
// currently-available mission a FUTURE unlock rung will require. Retained ready for
// that deferred rung; first-pass tunable, same launch-placeholder discipline as every
// other numeric constant here. Real balance at the device checkpoint.
export const MISSION_CONTROL_UNLOCK_COMPLETIONS = 50;

export const FACILITIES: Record<string, FacilityDef> = {
  refinery: {
    label: "Refinery",
    upgrades: [
      // [0] Level 0 -> 1: BUILD / unlock. Ungated (material cost only). Grants the
      // first refine slot -- building the refinery is what lets it run one job.
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
      // [2] Level 2 -> 3: a third line. Costs refinedMaterial (the refinery's own
      // output) + a higher FA gate + the Industry hub talent.
      {
        materials: { commonOre: new Decimal(3000), refinedMaterial: new Decimal(25) },
        durationTicks: 90,
        effect: { addRefineSlots: 1 },
        requiresFleetAdminLevel: 5,
        requiresHomeworldTalents: ["industryHub"],
      },
      // [3] Level 3 -> 4: automation. Grants a refine SPEED multiplier (not a slot),
      // exercising the other FacilityUpgradeEffect kind. Track ENDS here (finite).
      {
        materials: { commonOre: new Decimal(8000), refinedMaterial: new Decimal(75) },
        durationTicks: 180,
        effect: { refineSpeedMult: 1.5 },
        requiresFleetAdminLevel: 8,
        requiresHomeworldTalents: ["industryHub"],
      },
    ],
  },
  // Phase 2, Task B2: Tier I Warehouse -- available from the START at level 0 (cap
  // 1,000,000; no unlock needed, T1 is the base tier). ~25 GENERATED doubling rungs
  // (see buildWarehouseT1Upgrades above). tierCap(state, 1) derives the live cap.
  warehouseT1: {
    label: "Warehouse (Tier I)",
    upgrades: buildWarehouseT1Upgrades(),
  },
  // Phase 2, Task B2: Tier II Warehouse -- a STUB. Level 0 = locked; rung 0 unlocks
  // it for 1,000,000 commonOre, and the first real upgrade (rung 1) is walled behind
  // the unobtainable T2 ore (denseOre). See buildWarehouseT2Upgrades above.
  warehouseT2: {
    label: "Warehouse (Tier II)",
    upgrades: buildWarehouseT2Upgrades(),
  },
  // Fuel Economy v2 F2: Fuel Depot (KEY still `fuelStorage` -- label-only rename, NO
  // key migration; was "Fuel Storage", Mission Rework Task 4). TWO roles on one track:
  // fuel STORAGE (the cap, available + usable from level 0, no soft-lock) + fuel
  // PROCESSING (continuous Deuterium-Ice -> fuel pipelines). See buildFuelDepotUpgrades
  // above. fuelCap / fuelPipelineCount / fuelBatchOutput / fuelBatchInput (tick.ts) each
  // derive their live value from this facility's level.
  fuelStorage: {
    label: "Fuel Depot",
    upgrades: buildFuelDepotUpgrades(),
  },
  // Mission Rework Task 6: Mission Control -- SEEDED at level 1 (freshState +
  // migration) so ALL FOUR current missions are available from game start (no
  // soft-lock). missionUnlocked (tick.ts) derives which missions are dispatchable
  // from this facility's level via MissionDef.unlockLevel (all four are unlockLevel 1).
  //
  // USER REVISION 2026-07-14: the level-1 -> 2 unlock UPGRADE is DEFERRED (see the
  // block above). The track caps at its current content (level 1) -- a lone founding
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
      // upgraded" -- the maxed-at-current-content state the UI renders.
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
    ],
  },
  // --- Research Lab (Task R2 -- design §1) --------------------------------------
  // The facility whose LEVEL gates which blueprint TIERS are researchable + how many
  // research SLOTS run in parallel. It combines TWO established patterns:
  //   - SEEDED AT LEVEL 1 like Mission Control (freshState below): tier-1 blueprints
  //     are researchable from game start (blueprintResearchable reads level >= tier),
  //     so there is no soft-lock -- a fresh fleet can research immediately.
  //   - RUNGS CARRY A REAL SLOT GRANT like the Refinery: each rung's { addResearchSlots }
  //     effect is SUMMED across reached rungs by researchSlotCount (tick.ts), exactly as
  //     refineSlotCount sums { addRefineSlots }. The blueprint-TIER unlock is level-
  //     derived (not summed), the same way missionUnlocked derives missions from level.
  //
  // FINITE track that CAPS at real content: only blueprint tiers 1 and 2 exist today
  // (BLUEPRINTS), so the track has exactly TWO rungs (level 1 and level 2). NO rung
  // beyond tier 2 -- adding one would be a placeholder that unlocks nothing, against
  // this file's no-placeholder discipline. A future blueprint tier re-extends the track
  // additively (one more rung), mirroring how the Refinery/Warehouse tracks grow.
  //
  // COST MODEL -- CREDITS, NOT MATERIALS (locked brainstorm decision #3 + design §6:
  // "Cost = time + CREDITS. No materials. ... credits get a real long-term sink"). The
  // level 1->2 rung is gated on `credits` (the OPTIONAL FacilityUpgradeDef field R2
  // added) + an FA-level prereq (mirroring the Refinery's requiresFleetAdminLevel idiom).
  // ⚠️ FIRST-PASS TUNABLE values (credits/duration/FA-level), same launch-placeholder
  // spirit as every other table here -- real balance at the device checkpoint.
  //
  // NAME "Research Lab" is PROVISIONAL (design §1 open question -- user may rename to
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
      // sink -- NO materials) + a modest FA-level prereq. Track ENDS here (finite; only
      // tiers 1-2 exist). ⚠️ FIRST-PASS TUNABLE credits/duration/FA-level.
      {
        materials: {}, // locked design #3: NO materials on research costs
        credits: new Decimal(5000), // the tier-2 unlock's credit sink (tunable)
        durationTicks: 120, // matches the tier-2 blueprint's research duration (tunable)
        effect: { addResearchSlots: 1 },
        requiresFleetAdminLevel: 3, // modest gate, mirrors the Refinery's FA-level idiom (tunable)
      },
    ],
  },
  // --- Fabricator (Phase 4, F1 -- design §1) -----------------------------------
  // The facility whose LEVEL gates which blueprint TIERS are fabricable + how many
  // craft SLOTS run in parallel. A DIRECT CLONE of the Research Lab's shape (a level-
  // derived tier gate + a summed slot grant), differing only in the effect field it
  // carries (addFabricateSlots) and the fact that the CRAFT cost is materials + time,
  // never credits -- but the UPGRADE rungs, like every other facility's, cost credits.
  //   - SEEDED AT LEVEL 1 like the Research Lab / Mission Control (freshState below):
  //     tier-1 blueprints are fabricable from game start once researched (fabricable
  //     when level >= tier), so there is no soft-lock.
  //   - RUNGS CARRY A REAL SLOT GRANT like the Refinery / Research Lab: each rung's
  //     { addFabricateSlots } effect is SUMMED across reached rungs by fabricateSlotCount
  //     (tick.ts), exactly as researchSlotCount sums { addResearchSlots }. The blueprint-
  //     TIER unlock is level-derived (not summed), the same way the Research Lab derives
  //     researchable tiers from its level.
  //
  // FINITE track that CAPS at real content: only blueprint tiers 1 and 2 exist today
  // (BLUEPRINTS), so the track has exactly TWO rungs (level 1 and level 2). NO rung
  // beyond tier 2 -- adding one would be a placeholder that unlocks nothing, against
  // this file's no-placeholder discipline. A future blueprint tier re-extends the track
  // additively (one more rung), mirroring the Research Lab / Refinery / Warehouse tracks.
  //
  // COST MODEL -- upgrade rungs cost CREDITS (the OPTIONAL `credits` FacilityUpgradeDef
  // field, the SAME gate the Research rungs use), NOT materials (materials are the CRAFT
  // cost, spent by the fabricate engine in F2). ⚠️ FIRST-PASS TUNABLE values
  // (credits/duration/FA-level), same launch-placeholder spirit as the Research Lab.
  fabricator: {
    label: "Fabricator",
    upgrades: [
      // [0] Level 0 -> 1: the FOUNDING rung. PRE-GRANTED via the level-1 freshState seed
      // (never built in normal play), so it is ungated + zero-cost + zero-duration -- the
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
      // per-craft cost, not the upgrade cost). Track ENDS here (finite; only tiers 1-2
      // exist). ⚠️ FIRST-PASS TUNABLE credits/duration/FA-level.
      {
        materials: {},
        credits: new Decimal(5000), // the tier-2 unlock's credit sink (tunable)
        durationTicks: 120, // tunable
        effect: { addFabricateSlots: 1 },
        requiresFleetAdminLevel: 3, // modest gate, mirrors the Research Lab's idiom (tunable)
      },
    ],
  },
  // --- Shipyard (Phase 5, Task S1 -- design §2) --------------------------------
  // The Fleet-Sector facility that BUILDS hulls from a component BOM + credits over a
  // timed construction (the build ENGINE lands in S3). Owner is FLEET-SECTOR, expressed
  // the SAME way research/fabricator express it: there is NO `owner` field on FacilityDef
  // (see the interface above -- only `label` + `upgrades`); the House/Sector grouping is
  // a UI-SIDE concern (App.svelte's rails), so nothing is set here for it.
  //
  // ⚠️ DIFFERS from research/fabricator on ONE axis: those seed at level 1 (established
  // from game start), but the Shipyard seeds at level 0 -- LOCKED / unfounded (freshState
  // below). So its FOUNDING rung (level 0->1) is a REAL, BUILDABLE unlock, gated on
  // credits + Fleet-Admiral level (NO materials) -- the SAME credits+FA-level gate shape
  // research/fabricator put on their level 1->2 rung, just moved to the founding rung
  // because establishing the Shipyard is the deliberate unlock (locked brainstorm #3).
  //
  // FINITE track: a founding rung + a first-pass build-SPEED track (two { buildSpeedMult }
  // rungs). Refit + repairs are FUTURE rungs on this same track (hooked, not built --
  // design §2/§7). ⚠️ FIRST-PASS TUNABLE values (credits/duration/FA-level/mult), same
  // launch-placeholder spirit as the Research Lab / Fabricator tracks -- real balance at
  // the device checkpoint.
  shipyard: {
    label: "Shipyard",
    upgrades: [
      // [0] Level 0 -> 1: the FOUNDING rung -- a REAL buildable unlock (NOT pre-granted;
      // freshState seeds level 0). Gated on credits + an FA-level prereq, NO materials
      // (mirrors the research/fabricator credit-rung shape). Its effect is the inert
      // `unlocksContent` level-bump marker (like Mission Control's founding rung): what
      // establishing the Shipyard enables (building hulls) derives from the LEVEL being
      // >= 1, NOT from a summed/multiplied stat -- so the founding rung carries no
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
      // [2] Level 2 -> 3: second build-SPEED upgrade. Track ENDS here (finite; refit/
      // repairs are future rungs). Stacks multiplicatively on rung [1] (1.5 * 2.0 = 3.0x
      // at level 3, per the S3 product derivation).
      {
        materials: {},
        credits: new Decimal(20000), // tunable
        durationTicks: 300, // tunable
        effect: { buildSpeedMult: 2.0 }, // tunable
        requiresFleetAdminLevel: 8, // tunable
      },
    ],
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

export interface GameState {
  captains: CaptainState[];
  tickDurationSeconds: number; // fleet-wide tick cadence -- every captain advances in lockstep on this single cadence (collapsed from a per-captain field during the UI Redesign; see docs/plans/2026-07-07-ui-redesign-design.md)
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  // --- Ship Production Economy (Phase 1, Task 2 -- docs/plans/2026-07-11-facility-framework-refinery-design.md §7) ---
  // The keyed material balance: a plain itemId -> quantity map that can hold ANY
  // ITEMS-registry key (raw loot, refined goods, and the later component/module/
  // system tiers) WITHOUT a type change. This is the SOLE fleet-wide material
  // store as of Phase 1, Task 7 -- it fully REPLACED the old fixed-union
  // `homePlanet.storage` field, which has been removed (its keys migrate into
  // this map via MIGRATIONS[17]; freshState seeds the same 5 zero entries).
  inventory: Record<string, Decimal>;
  // itemIds the player has held at least once -- the persistent "seen" set that
  // drives the future ❓ -> reveal UI (an undiscovered item renders masked until
  // its id lands here). Starts empty on a fresh save; NOTHING appends to it yet
  // (the discovery-on-first-acquire wiring is a later task). A string[] (not a
  // Set) so it serializes cleanly through the JSON save format.
  discovered: string[];
  unlockedHomeworldTalents: HomeworldTalentKey[]; // fleet-wide purchased Homeworld Talent keys -- see buyHomeworldTalent (tick.ts)
  fleetAdminXp: Decimal; // Fleet Admiral leveling -- see applyFleetAdminXp (tick.ts)
  fleetAdminLevel: number; // starts at 1
  adminPoints: number; // unspent, spent via buyHomeworldTalent (tick.ts)
  credits: Decimal;
  // --- Fuel economy (Mission Rework Task 3, design §3) ---
  // The fleet-wide fuel STOCKPILE (the RESOURCE spent per dispatch), Decimal-typed
  // to match the other currency fields (credits/fleetAdminXp) -- it round-trips
  // through JSON as a string and MUST be re-hydrated on load (save.ts's
  // hydrateDecimals). Its CAP derives from the fuel-storage facility level (Task 4);
  // Task 5 spends it at dispatch. This pass only DEFINES + seeds it (freshState = 0):
  // nothing consumes it yet. The v20->v21 save migration that seeds it onto existing
  // saves is Task 9's job -- hydrateDecimals defaults an absent field to 0 defensively
  // until then, so a pre-migration save can't NaN/throw.
  fuel: Decimal;
  // --- Ships -- Stats Foundation ---
  // The fleet's hulls, distinct from the captains flying them. A ShipInstance's
  // assignedCaptainId is the SINGLE SOURCE OF TRUTH for who flies it -- the
  // invariant "every captain always has exactly one assigned ship" is enforced
  // at new-game here (freshState), by migration (save.ts), and at slot unlock
  // (tick.ts) in their own later tasks.
  ships: ShipInstance[];
  shipStorageCapacity: number; // max hulls the fleet can hold (parked + assigned); starter cap
  nextShipId: number; // monotonic id source for new ShipInstance.id ("ship-N"); never reused
  // --- Progression Pacing Rework (docs/plans/2026-07-11-progression-pacing-rework-*) ---
  // Monotonic LIFETIME totals, reserved now for future Completions/Achievements
  // systems to read. These are FORWARD-COMPAT schema only: freshState zero-inits
  // them and the save migration backfills old saves (a later task), but NOTHING
  // increments them yet -- the increment wiring lands in its own later task.
  // WHY reserve rather than derive on demand: lifetime totals CANNOT be
  // reconstructed from live state -- spent inventory, refined ore, and completed
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
  // --- Ship Production Economy (Phase 1, Task 3 -- facility/process state) ---
  // Reserved schema for the facility framework + timed-process engine (types
  // above). NOTHING reads/writes these yet -- the engine that does is Task 8; the
  // Refinery panel is later. freshState seeds `{ refinery: { level: 0 } }` (the one
  // facility Phase 1 ships, not yet built) / `[]` / `1`, and the v17->v18 migration
  // (save.ts, MIGRATIONS[17]) backfills the same baseline onto old saves.
  facilities: Record<string, FacilityState>; // facilityKey -> { level }; level 0 = not built
  activeProcesses: TimedProcess[];            // in-flight refine jobs + facility upgrades (empty until Task 8 starts one)
  nextProcessId: number;                      // monotonic id source for new TimedProcess.id ("proc-N"); never reused
  // --- Crafting Allocation Redesign (Task C2 -- docs/plans/2026-07-16-crafting-
  // allocation-redesign-design.md §2) --------------------------------------------
  // The per-slot production LINES that REPLACE the single refineOrder/fabricateOrder
  // (both RETIRED in Task C4 -- the single-order fields are gone). Each
  // facility owns an array of independent lines -- one per occupied slot -- so a
  // 3-slot Refinery can refine 3 DIFFERENT recipes at once (the single-order model
  // could only run one recipe across all slots). The array LENGTH is capped at the
  // facility's derived slot count (refineSlotCount/fabricateSlotCount) by startLine
  // (tick.ts). Material ALLOCATION is DERIVED from these arrays, never stored
  // (allocation.ts, C1): allocated(item) = Σ line.remaining × inputsPerIteration.
  // freshState seeds both `[]`; the v23->v24 migration (save.ts, Task C6) backfills
  // the same empty seed onto existing saves + drops any legacy order. NO Decimal on
  // CraftLine (id/recipeKey strings, remaining a plain number, mode a string-literal
  // union), so hydrateDecimals needs no change -- the arrays ride the `...state`
  // spread verbatim.
  refineLines: CraftLine[];
  fabricateLines: CraftLine[];
  // Monotonic id source for new CraftLine.id ("craft-N"); never reused -- mirrors
  // nextShipId ("ship-N") / nextProcessId ("proc-N"). A started line's timed job
  // stamps this id on TimedProcess.lineId so the engine can match a job back to its
  // line (one in-flight job per line). freshState seeds 1; the C6 migration backfills 1.
  nextCraftLineId: number;
  // --- Research (Phase 3, Task R1 -- docs/plans/2026-07-15-research-*.md §2) ---
  // The set of UNLOCKED blueprint keys (BLUEPRINTS ids the player has researched).
  // Modeled as a string[] rather than a Set so it serializes cleanly through the JSON
  // save format -- the SAME choice `discovered` (above) and unlockedHomeworldTalents
  // make. String keys carry NO Decimal, so hydrateDecimals (save.ts) needs NO change:
  // the field rides through its `...state` spread untouched, exactly like `discovered`.
  // freshState seeds [] (nothing researched on a new save). The v21->v22 seed migration
  // that backfills [] onto existing saves is Task R6's job -- NOT freshState's. The
  // research-project ENGINE that appends to this (startResearch + the resolver's
  // unlockBlueprint effect) is Task R3; R1 only DEFINES + seeds the field and the two
  // pure read helpers below (blueprintUnlocked / blueprintResearchable).
  researchedBlueprints: string[];
}

// RecipeKey / RecipeDef / RECIPES (the legacy INSTANT Homeworld craft path) were
// RETIRED in the Fabricator feature (Phase 4, Task F5). The timed Fabricator
// facility (BLUEPRINTS + craftDurationTicks + the per-slot production-line engine in
// tick.ts) fully subsumes that mechanic -- researched blueprints crafted over time via
// the line/slot engine, feeding the SAME lifetimeStats.itemsCrafted tally. The old
// `recipeBonusOutput` Homeworld Talent effect that only modified this instant path
// was retired with it (see HomeworldTalentEffect below).

// --- Timed refine recipes (Ship Production Economy, Phase 1, Task 11 --
// docs/plans/2026-07-11-facility-framework-refinery-design.md §6) ----------------
// The going-forward, TIMED refinery mechanic. (The old instant
// RECIPES/craftRecipe() path this once stood beside was RETIRED in Phase 4,
// Task F5, once the Fabricator subsumed it -- see the retirement note above.)
// A refine recipe is inputs -> ONE output over a fixed
// duration; startRefineJob (tick.ts) hands it to the Task 8 startProcess engine
// (atomic deduct-at-start), and resolveProcesses grants the output + increments
// lifetimeStats.itemsRefined on completion.
//
// The `output` shape mirrors ProcessEffect's addItem member ({ itemId, amount })
// rather than RECIPES' { key, amount }, because that is exactly what startRefineJob
// forwards to startProcess as the completion effect -- one shape, no re-mapping.
// `input`/`output.itemId` are plain-string keyed (Record<string, Decimal> / string),
// forward-loose like inventory + ProcessEffect, so a later recipe targeting a
// not-yet-unioned item needs no type change here.
export interface RefineRecipeDef {
  input: Record<string, Decimal>;      // deducted ATOMICALLY at job start (design §4)
  output: { itemId: string; amount: Decimal }; // granted on completion (marks discovered)
  durationTicks: number;               // FIXED job length; also the lump Fleet Admiral XP awarded
}

// Phase 1 seeds ONE real recipe -- same "no placeholders" discipline as
// MISSIONS/RECIPES/FACILITIES. Keyed as Record<string, ...> (not a narrow union)
// to match FACILITIES' forward-loose keying + let startRefineJob look up an
// arbitrary recipeKey string with a runtime guard.
//
// ⚠️ TUNABLE LAUNCH PLACEHOLDERS ⚠️ commonOre 100 : refinedMaterial 1 is the
// design §6 starting ratio (rebalanced up from the instant path's 10:1 toward the
// 100-1000:1 scarcity target -- NOT final, tuned at the device-check stage), and
// durationTicks 10 is design §6's common-tier starting duration. Add entries here
// (and nowhere else -- the future Refinery panel iterates this object) as more
// refine recipes land.
export const REFINE_RECIPES: Record<string, RefineRecipeDef> = {
  refineCommonOre: {
    input: { commonOre: new Decimal(100) },
    output: { itemId: "refinedMaterial", amount: new Decimal(1) },
    durationTicks: 10,
  },
  // ⚠️ TUNABLE first-pass (2026-07-16) -- these two CONNECT the Refinery to the Fabricator:
  // they produce the exact refined materials the tier-1 blueprints consume, so the production
  // chain (mine -> refine -> fabricate) is playable end-to-end for the first time. Before this,
  // the only recipe made the generic `refinedMaterial` (a facility-upgrade input), which NO
  // blueprint uses -- the chain dead-ended.
  //   - Titanium Ore (`commonOre`) is the common staple -> a higher input ratio (20:1).
  //   - Polysilicate Ore (`uncommonMaterial`) is the UNCOMMON strike (scarcer drop) -> a cheaper
  //     ratio (5:1) so the rarer feedstock isn't punishing.
  // Ratios + durations are device-check tunables exactly like refineCommonOre above; the target
  // item ids (`titaniumIngot`/`polysilicateWafer`) already exist in ITEMS with "Refined from ...
  // at the Refinery" unlockHints written forward for this.
  refineTitaniumIngot: {
    input: { commonOre: new Decimal(20) },
    output: { itemId: "titaniumIngot", amount: new Decimal(1) },
    durationTicks: 12,
  },
  refinePolysilicateWafer: {
    input: { uncommonMaterial: new Decimal(5) },
    output: { itemId: "polysilicateWafer", amount: new Decimal(1) },
    durationTicks: 20,
  },
};

// Item taxonomy (Ship Production Economy epic -- 2026-07-11 facility-framework
// design §7). The category ladder is the forward-compat spine the whole epic
// climbs: raw loot -> refined -> minor/major components -> ship modules/systems.
// Only "raw" and "refined" are populated at Phase 1 launch; the later buckets
// exist in the union so the item table can grow WITHOUT a type change later.
export type ItemCategory =
  | "raw" | "refined" | "minorComponent" | "majorComponent" | "shipModule" | "shipSystem";

// Rarity is forward room for the UI's rarity-color reveal (design §7). Every
// tier of the union is valid today; Phase 1's seeds only reach "rare".
export type ItemRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface ItemDef {
  label: string;        // display name (UI wraps it as [Bracketed Name] per convention)
  category: ItemCategory;
  tier: number;         // which warehouse TIER this item belongs to; all current items are T1 (§3.3)
  rarity: ItemRarity;
  // Player-facing "how to get this" clue shown in the Warehouse's ❓ (undiscovered)
  // slot state (Phase 2 design §3.2). DISTINCT from `flavor` (narrative color): the
  // hint is functional -- a concrete, honest pointer to the item's real source
  // (a mission, a refine/fabricate recipe), never an invented one. Populated for
  // EVERY item; the model.test.ts standing-rule test enforces it is non-empty so a
  // future item added without a Warehouse hint fails the suite.
  unlockHint: string;
  flavor: string;
  // FORWARD (not populated this pass): only shipModule/shipSystem items ever
  // carry equip stats; every Phase 1 seed leaves this undefined.
  equipStats?: Record<string, number>;
}

// Launch item registry -- REAL entries only, same "no placeholders" discipline as
// MISSIONS/RECIPES above. Phase 1 seeds ONLY the items that exist today: the 5
// HomePlanetMaterialKey storage keys (the 3 mission-loot tiers + the 2 crafted
// goods RECIPES produces). Later phases of the Ship Production Economy epic add
// the minor/major-component, ship-module, and ship-system tiers HERE (and grow
// the storage/inventory keys alongside) -- do NOT seed those forward items until
// their phase. The model.test.ts drift guard asserts every live storage key has
// an entry here, so this table cannot silently fall out of sync with storage.
export const ITEMS: Record<string, ItemDef> = {
  // --- Raw loot (mission extraction output; keyed as LootMaterialKey) ---
  commonOre: {
    // Fuel-sourcing RESTRUCTURE (2026-07-15): F1 had relabeled `commonOre` to
    // "Deuterium Ice" and pointed the Fuel Depot's refine at it (dual-demand: the
    // material Refinery ALSO consumes commonOre). That is REVERTED here -- commonOre
    // is once again the Local Asteroid run's common structural ore, "Titanium Ore",
    // and the Fuel Depot now refines the NEW dedicated `deuteriumIce` item (below)
    // instead. The item id stays `commonOre`, so this revert is display-only with NO
    // save migration; its only consumer is now the material Refinery again.
    label: "Titanium Ore",
    category: "raw",
    tier: 1,
    rarity: "common",
    // The guaranteed common-tier fallback drop on every extraction tick (see
    // tick.ts's rollExtractionTick) of the Local Asteroid run.
    unlockHint: "Chipped from the Local Asteroid run -- the fleet's staple structural ore.",
    flavor: "Common titanium-bearing rock, hauled from the local asteroid by the ton -- the workhorse feedstock for the Refinery.",
  },
  uncommonMaterial: {
    // Provisional in-fiction name for the uncommon ore tier (id kept
    // `uncommonMaterial` -- label is display-only, no save migration).
    label: "Polysilicate Ore",
    category: "raw",
    tier: 1,
    rarity: "uncommon",
    // Won on the per-tick uncommonChance roll; the Long Ore Run's uncommonChance
    // (0.08) is far higher than the Short Ore Run's (0.019).
    unlockHint: "An uncommon strike on the Local Asteroid run.",
    flavor: "A richer seam worth flagging on the survey map. Turns up often enough to plan around.",
  },
  rareMaterial: {
    // PROVISIONAL in-fiction name for the rare ore tier (id kept `rareMaterial`
    // -- label is display-only, no save migration). "Iridium Ore" is a working
    // name, NOT final -- flagged provisional at scaffold time.
    label: "Iridium Ore",
    category: "raw",
    tier: 1,
    rarity: "rare",
    // Won on the per-tick rareChance roll; the Long Ore Run's rareChance (0.02)
    // dwarfs the Short Ore Run's (0.001), so it's the run to farm for rares.
    unlockHint: "A rare strike on the Local Asteroid run.",
    flavor: "Scarce, dense, and prized -- the payoff that makes the long ore runs worth the fuel.",
  },
  // --- Dedicated fuel ore (Fuel-sourcing RESTRUCTURE 2026-07-15) ---------------
  // The fleet's FTL fuel SOURCE, now its OWN item (id `deuteriumIce`) rather than a
  // relabeled `commonOre`. This is the ONLY thing the Fuel Depot refines into fuel
  // (processFuelPipelines, tick.ts): mine it on the free `localFuelRun` mission ->
  // refine it into fuel at the Depot. Decoupling it from `commonOre` kills the old
  // dual-demand (commonOre now feeds ONLY the material Refinery again). Raw, tier 1,
  // common -- it renders as a Warehouse Raw tile off the ITEMS registry like every
  // other raw. ADDITIVE: a brand-new key, so no save migration (empty inventory is
  // fine; it appears the moment the fuel run first delivers it).
  deuteriumIce: {
    label: "Deuterium Ice",
    category: "raw",
    tier: 1,
    rarity: "common",
    // The guaranteed (and ONLY) drop of the localFuelRun mission -- a common-tier ore.
    unlockHint: "Skimmed from the Local Deuterium Skim run -- refine it into fuel at the Fuel Depot.",
    flavor: "Deuterium-laced water ice cracked from a local field. Cook it down at the Fuel Depot and it runs the FTL drives.",
  },
  // --- Refined / crafted goods (Refinery / Fabricator output) ---
  refinedMaterial: {
    label: "Refined Material",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    // Output of the timed REFINE_RECIPES.refineCommonOre job, consuming `commonOre`
    // (Titanium Ore) at the Refinery. (The legacy instant RECIPES.refineUnobtainium
    // craft that once also produced it was retired in Phase 4, Task F5.) (Fuel-sourcing
    // RESTRUCTURE 2026-07-15: reverted F1's "Deuterium Ice" wording back to Titanium --
    // the material Refinery consumes titanium ore, the Fuel Depot now refines the
    // separate `deuteriumIce` item instead.)
    unlockHint: "Refined from Titanium Ore at the Refinery.",
    flavor: "Titanium ore cooked down to a workable ingot. The first rung of the production ladder.",
  },
  components: {
    label: "Components",
    category: "refined",
    tier: 1,
    rarity: "rare",
    // Output of the Fabricator (a researched blueprint crafted from Refined
    // Material via the timed fabricate-order engine). Replaced the legacy instant
    // RECIPES.fabricateComponents craft, retired in Phase 4, Task F5.
    unlockHint: "Fabricated from Refined Material at the Homeworld.",
    flavor: "Fabricated parts stamped from refined stock -- the building blocks fleet production runs on.",
  },
  // --- Tier 2 raw ore (Phase 2, Task B2) -- UNOBTAINABLE STUB -----------------
  // The first Tier-2 material, added ONLY to gate the T2 Warehouse's first real
  // upgrade (FACILITIES.warehouseT2, rung 1) behind honest "future content": NOTHING
  // produces denseOre this phase (no mission, no refine/fabricate recipe references
  // it), so it is genuinely unobtainable and renders as ❓ in the Warehouse catalog
  // -- exactly the point (design §3.3). It carries the FULL catalog metadata the
  // standing-rule test (model.test.ts) requires; its unlockHint is deliberately a
  // "no source yet" pointer, NOT an invented one. When T2 content lands, a real
  // producer (a T2 mission / refine) is wired to it and the hint updated then.
  denseOre: {
    label: "Dense Ore",
    category: "raw",
    tier: 2,
    rarity: "uncommon",
    unlockHint: "Extracted from deep deposits -- no mission reaches them yet.",
    flavor: "Impossibly compacted rock from the deep seams. The fleet can't reach it -- yet.",
  },
  // --- Catalog scaffold (Phase 2 Warehouse) -- UNOBTAINABLE PLACEHOLDERS -------
  // The full material catalog the Warehouse renders as ❓ slots. Every entry below
  // is produced by NOTHING this pass (no mission, refine, or fabricate recipe
  // references it), so each is genuinely unobtainable and shows masked with its
  // unlockHint as the how-to-get clue -- the SAME honest "future content" pattern
  // as denseOre above. All tier 1. Each carries the FULL catalog metadata the
  // standing-rule test (model.test.ts) requires; unlockHints point at the FUTURE
  // missions/facilities that will produce them, not invented sources. When that
  // content lands, a real producer is wired in and (if needed) the hint updated.

  // RAW -- future ore/salvage/forage mission loot (3 tiers per mission).
  ferriteOre: {
    // Fuel-sourcing RESTRUCTURE (2026-07-15): reverted F1's "Titanium" relabel back to
    // "Ferrite" -- the Lunar Mine Contract's common structural metal. (F1 had moved the
    // Titanium name here when it repurposed `commonOre` as Deuterium Ice; that whole
    // relabel chain is undone now that Deuterium Ice is its own dedicated item.) The item
    // id stays `ferriteOre`, so this is display-only with NO save migration. Genuinely
    // obtainable via the longOreRun triad (Task 1) despite the older scaffold header above.
    label: "Ferrite",
    category: "raw",
    tier: 1,
    rarity: "common",
    unlockHint: "Mined on the Lunar Mine Contract.",
    flavor: "A tough, iron-rich structural alloy drawn from the lunar seams -- plentiful once the mining contract opens up.",
  },
  cobaltOre: {
    label: "Cobalt Ore",
    category: "raw",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "An uncommon strike on the Lunar Mine Contract.",
    flavor: "A deep-blue seam prized by alloy smiths -- an uncommon find on the moon.",
  },
  osmiumOre: {
    label: "Osmium Ore",
    category: "raw",
    tier: 1,
    rarity: "rare",
    unlockHint: "A rare strike on the Lunar Mine Contract.",
    flavor: "The densest metal the fleet has ever logged -- a rare payoff from the lunar seams.",
  },
  scrapAlloy: {
    label: "Scrap Alloy",
    category: "raw",
    tier: 1,
    rarity: "common",
    unlockHint: "Recovered on the Salvage Nearby Skirmish Wreckage run.",
    flavor: "Twisted hull plating pulled from the wrecks -- rough, but it melts down fine.",
  },
  salvagedCircuitry: {
    label: "Salvaged Circuitry",
    category: "raw",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "An uncommon find on the Salvage Nearby Skirmish Wreckage run.",
    flavor: "Scorched boards with intact traces -- worth pulling before the reclaimers arrive.",
  },
  intactReactorCore: {
    label: "Intact Reactor Core",
    category: "raw",
    tier: 1,
    rarity: "rare",
    unlockHint: "A rare find on the Salvage Nearby Skirmish Wreckage run.",
    flavor: "A miraculously whole core still humming with charge -- the salvage jackpot.",
  },
  fibrousBiomass: {
    label: "Fibrous Biomass",
    category: "raw",
    tier: 1,
    rarity: "common",
    unlockHint: "Foraged on the Forage Minerals and Flora on Nearby Moon run.",
    flavor: "Tough, stringy plant matter scraped off the regolith -- common but useful stock.",
  },
  volatileResin: {
    label: "Volatile Resin",
    category: "raw",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "An uncommon forage on the Forage Minerals and Flora on Nearby Moon run.",
    flavor: "A sticky, faintly luminous sap -- handle with care, it does not like heat.",
  },
  exoticSporeCluster: {
    label: "Exotic Spore Cluster",
    category: "raw",
    tier: 1,
    rarity: "rare",
    unlockHint: "A rare forage on the Forage Minerals and Flora on Nearby Moon run.",
    flavor: "A pulsing knot of alien spores -- rare, valuable, and best kept sealed.",
  },

  // REFINED -- future Refinery outputs (raw ore/salvage/biomass cooked down).
  titaniumIngot: {
    label: "Titanium Ingot",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Titanium Ore at the Refinery.",
    flavor: "Titanium ore cooked down to a bright, workable bar -- light and unyielding.",
  },
  polysilicateWafer: {
    label: "Polysilicate Wafer",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from Polysilicate Ore at the Refinery.",
    flavor: "A thin, mirror-smooth wafer sliced from purified ore -- the substrate of electronics.",
  },
  reclaimedAlloy: {
    label: "Reclaimed Alloy",
    category: "refined",
    tier: 1,
    rarity: "rare",
    unlockHint: "Refined from salvage at the Refinery.",
    flavor: "Battlefield scrap re-smelted into something stronger than it ever was whole.",
  },
  purifiedBiomass: {
    label: "Purified Biomass",
    category: "refined",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Refined from foraged biomass at the Refinery.",
    flavor: "Raw flora rendered down to a clean, stable feedstock -- no volatility left.",
  },

  // COMPONENTS -- future Fabricator outputs (refined stock assembled into parts).
  frameSegment: {
    label: "Frame Segment",
    category: "minorComponent",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Fabricated from refined materials at the Fabricator.",
    flavor: "A single load-bearing strut -- one of many that skeleton a hull together.",
  },
  powerCoupling: {
    label: "Power Coupling",
    category: "minorComponent",
    tier: 1,
    rarity: "uncommon",
    unlockHint: "Fabricated from refined materials at the Fabricator.",
    flavor: "A shielded junction that ties a reactor line into the systems it feeds.",
  },
  structuralAssembly: {
    label: "Structural Assembly",
    category: "majorComponent",
    tier: 1,
    rarity: "rare",
    unlockHint: "Assembled from components at the Fabricator.",
    flavor: "Frame segments and couplings married into one rigid sub-structure -- a hull's spine.",
  },
};

// --- Research: blueprints (Phase 3, Task R1 -- docs/plans/2026-07-15-research-
// {design,plan}.md §2/§5) --------------------------------------------------------
// A BLUEPRINT is a RECIPE the (next-feature) Fabricator will craft into a ship
// component. Research is the GATE on WHICH recipes exist; the Fabricator is the forge
// that runs them. The two features deliberately SHARE this one definition -- the
// blueprint carries the Fabricator recipe RIGHT HERE (`recipe`) so Research and the
// Fabricator never drift over what a researched blueprint actually builds.
//
// SCOPE NOTE (R1 is DATA ONLY): this task ships the BlueprintDef shape, the BLUEPRINTS
// content, the GameState.researchedBlueprints field, and the two pure read helpers
// below. The Research FACILITY that gates tiers/slots is R2; the timed research-project
// ENGINE that actually unlocks a blueprint (startResearch + the resolver) is R3; the UI
// is R5. NOTHING crafts a researched blueprint yet -- that arrives with the Fabricator.
//
// ⚠️ FIRST-PASS TUNABLE VALUES ⚠️ Every number below (tier, researchDurationTicks,
// researchCreditCost, and the recipe input/output amounts) is a launch placeholder in
// the SAME spirit as MISSIONS'/SHIP_TYPES'/REFINE_RECIPES' constants -- the exact recipes
// get finalized WITH the Fabricator (it consumes them), and real balancing happens at the
// device-check stage. They are defined now purely to keep Research + Fabricator one
// coherent, testable data set.
export interface BlueprintDef {
  key: string;   // mirrors the BLUEPRINTS map key (asserted in research.test.ts -- no drift)
  label: string; // in-world display name, e.g. "Frame Segment Blueprint"
  tier: number;  // gated by the Research facility LEVEL (R2): researchable once level >= tier
  researchDurationTicks: number; // time to research (R3 runs it as a timed process)
  researchCreditCost: number;    // credits, deduct-at-start (R3); the long-term credit sink
  // Fabricator (Phase 4, F1 -- design §3): time to CRAFT this blueprint's component
  // once researched (the Fabricator runs it as a timed process, `durationTicks =
  // craftDurationTicks`, EXACTLY as R3 runs research off researchDurationTicks). The
  // Fabricator's cost is materials (recipe.inputs) + this TIME -- NO credits (locked
  // brainstorm decision #3: credits stay Research's sink, materials are the
  // Fabricator's). ⚠️ FIRST-PASS TUNABLE (same launch-placeholder spirit as
  // researchDurationTicks): tier-1 components ~120 ticks, tier-2 ~300 -- real balance
  // at the device checkpoint. Must be a positive finite number.
  craftDurationTicks: number;
  // The recipe the FABRICATOR will use (defined now, crafted later). `inputs` +
  // `outputItem` are plain-string ITEMS keys (forward-loose like inventory/ProcessEffect),
  // so a recipe can target any registry item. Amounts are plain numbers (recipe QUANTITIES,
  // not idle-scale currency) -- the Fabricator wraps them in Decimal at its deduct site,
  // exactly as the fuel constants are plain numbers wrapped at their deduct site.
  recipe: { inputs: Record<string, number>; outputItem: string; outputQty: number };
  flavor?: string;      // narrative color (optional)
  unlockHint?: string;  // functional "how to unlock" clue for the UI (optional)
}

// First-pass blueprint set (design §5) -- tied to the already-scaffolded component
// ITEMS (frameSegment/powerCoupling [minorComponent], structuralAssembly [majorComponent]).
// Keyed Record<string, BlueprintDef> (not a narrow union), matching FACILITIES'/
// REFINE_RECIPES' forward-loose keying so a later blueprint slots in with no type change.
// Add entries HERE (and nowhere else -- the R5 Research panel iterates this object).
//
//   Tier 1 (basic minor components): frameSegmentBp -> frameSegment, powerCouplingBp ->
//     powerCoupling. Recipes consume REFINED materials (titaniumIngot / polysilicateWafer).
//   Tier 2 (a major component): structuralAssemblyBp -> structuralAssembly, built from the
//     tier-1 minor components + a refined material -- exercising the component ladder
//     (raw -> refined -> minor -> major) the item taxonomy is built around.
// Higher tiers (equipment / modules / ship systems) are DEFERRED until the Fabricator +
// ship-systems phases define them (design §5) -- no placeholder tiers here.
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
    flavor: "The schematics for a hull's load-bearing struts -- the first thing any shipwright learns to stamp.",
    unlockHint: "Researched at the Research Lab; crafted at the Fabricator once it comes online.",
  },
  powerCouplingBp: {
    key: "powerCouplingBp",
    label: "Power Coupling Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 600,
    craftDurationTicks: 120, // tier-1 first-pass (tunable)
    // Electronics junction <- electronics substrate. Polysilicate Wafer is the refined substrate.
    recipe: { inputs: { polysilicateWafer: 4 }, outputItem: "powerCoupling", outputQty: 1 },
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
};

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
// level 0 (LOCKED / unfounded) in freshState -- the founding rung establishes it.
export const SHIPYARD_FACILITY_KEY = "shipyard";

// The Research facility's LEVEL, read DEFENSIVELY (absent facility -> 0). R1 has no
// research facility, so this returns 0 until R2 seeds it at level 1 -- meaning tier-1
// blueprints are NOT researchable in R1 alone and become researchable the moment R2's
// seed lands, with NO change to blueprintResearchable. This duplicates tick.ts's private
// facilityLevel() logic ON PURPOSE: model.ts must NOT import tick.ts (tick.ts imports
// model.ts; the reverse is a circular dependency). CONSOLIDATION CANDIDATE (Omega 4):
// once R2 formalizes the research facility, a single exported facilityLevel() could live
// in model.ts and tick.ts import it -- flagged, not done now (out of R1's additive scope).
function researchFacilityLevel(state: GameState): number {
  return state.facilities[RESEARCH_FACILITY_KEY]?.level ?? 0;
}

// Is a research PROJECT for `key` currently in flight? R3 adds the research-project
// engine: startResearch pushes a TimedProcess whose completion effect is
// { type: "unlockBlueprint"; key } (design §3 / plan R3). That effect member does NOT
// exist on ProcessEffect YET (R3 adds it), so we read the effect STRUCTURALLY here.
// TODAY activeProcesses can never hold such an entry, so this returns false for every
// blueprint -- but the SAME scan reports a live project the moment R3 lands, with no
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
  if (!bp) return false; // unknown key -- not a real blueprint
  if (blueprintUnlocked(state, key)) return false; // already researched
  if (researchInProgress(state, key)) return false; // a project is already unlocking it
  return bp.tier <= researchFacilityLevel(state); // tier gated by the research-facility level
}

// Open-ended (levels can climb indefinitely) -- a formula, not a finite table
// like HOMEWORLD_TALENTS' Fleet Logistics branch below (hand-tuned per entry).
// Progression Pacing Rework (Task 4): steepened from 100*level to 300*level.
// Captain XP now accrues PER ACTIVE TICK (see tickCaptainMission's per-whole-tick
// award) instead of as a lump per completed cycle, so the per-level cost was
// raised to keep early leveling from racing ahead under the faster drip.
export function xpForNextLevel(level: number): number {
  return 300 * level;
}

// Deliberately much steeper than a captain's own xpForNextLevel -- the
// intent (per design doc) is that Fleet Admiral levels lag well behind
// individual captain levels. A simple quadratic-ish curve achieves that
// without needing per-level hand-tuning (unlike a Fleet-Logistics-style
// finite talent table).
//
// 2026-07-08 (docs/plans/2026-07-08-fleet-admiral-xp-rework-plan.md):
// multiplier bumped from 500 to 2500 as part of switching Fleet Admiral XP
// from "recomputed as the sum of captain levels" (effectively frozen under
// realistic play -- confirmed live, see this plan's design doc) to
// "earned per completed mission cycle," mirroring captain XP. This value is
// a launch placeholder, same convention as MISSIONS/RECIPES/talent costs
// elsewhere in this codebase -- and per the user's own explicit note,
// deliberately NOT calibrated assuming mission XP is the only income source
// Fleet Admiral leveling will ever have (more sources are planned later).
//
// ⚠️⚠️ DEVICE-TUNED STARTING VALUES -- MOST PLAYTEST-SENSITIVE NUMBER IN THE REWORK ⚠️⚠️
// Progression Pacing Rework: multiplier rescaled from 2500 to 375000, quadratic
// shape KEPT. This value is scaled for PARITY with the OLD Fleet Admiral pace,
// using the SAME method the captain curve used -- it is deliberately NOT made
// faster. Still a STARTING point to be tuned against real on-device play at the
// checkpoint -- do NOT treat 375000 as final.
//
// WHY 375000 -- the parity math (same method as the captain curve):
//   * The captain curve was rescaled by (cycle ticks / old XP per cycle) so its
//     OLD leveling pace survived the switch to per-tick accrual. FA uses the
//     identical method: old FA income was 1 per cycle (fleetAdminXpPerTick's
//     predecessor, fleetAdminXpPerCycle, was 1) over the 149-tick short cycle,
//     so the scale factor is 149 / 1 = 149. 2500 * 149 = 372,500 -- exact parity
//     -- rounded to a clean 375000. (For reference, captain's own factor was
//     149/50 ≈ 3 -> 300*level.)
//   * The 'boost' to FA leveling is DELIBERATELY DEFERRED to the OTHER planned FA
//     XP sources (crafting, talent purchases, talent-tree effects), NOT baked
//     into an under-scaled curve. The earlier Task 8 value (250000, ×100) tried
//     to make the curve itself the boost -- too FAST; that intent is reversed
//     here. Parity keeps the curve honest so those future sources, not an
//     undertuned curve, provide the growth.
//   * Income context (still accurate): Task 5 moved Fleet Admiral XP from a
//     per-CYCLE lump to PER-TICK accrual -- it now earns ~1 FA XP per tick PER
//     ACTIVE captain, and STACKS fleet-wide (N active captains => ~N FA XP/tick,
//     see tickCaptainMission's fleetAdminXpAwardedThisCall). tickDurationSeconds
//     = 1s.
//   * Quadratic (super-linear) shape is KEPT so the curve stays fast-early /
//     slow-later: the per-level increment is 375000*(2*level+1), which GROWS
//     with level, so high FA levels cost disproportionately more (FA is
//     powerful -- high levels should take real time). Not steepened past
//     quadratic on purpose (YAGNI): the scale, not the exponent, is the lever
//     the device playtest will move first.
export function xpForNextFleetAdminLevel(level: number): number {
  return 375000 * level * level;
}

// --- Captain & Homeworld Talent Trees (docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md) ---
// Two new data-driven tables, mirroring the exact conventions the (now-deleted)
// Skill Tree established -- branch/label/cost/requires (same-branch
// prerequisite) plus a typed effect. The old level-gated CAPTAIN_SLOT_UNLOCKS
// table and its unlockCaptainSlot() function (tick.ts) have been removed --
// Fleet Logistics below (via buyHomeworldTalent's unlockCaptainSlot effect)
// fully absorbed that mechanism's job as of Task 4.
// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 1)
// shrank this union from the old five-column linear model
// ("command"/"tactical"/"science"/"resourcefulness"/"diplomacy") to the three
// captain branches the radial web ships with. "command"/"diplomacy" are gone
// -- their old content is either dropped or re-homed onto the surviving
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
  // Radial Skill Web (Task 2): a genuinely-null gateway effect. Used by the
  // Tactician/Explorer hubs, which are "learn me first" seeds for branches
  // whose real mechanics (combat / a redefined science system) don't exist
  // yet. Chosen over a `commonYieldMult`/`mult: 0.0` placeholder because that
  // would render through describeCaptainTalentEffect as a misleading
  // "+0.0% Common Ore yield" line on a combat/science node -- a `none` member
  // renders honestly as "no bonus yet" instead. Carries no payload; the tick
  // economy (tick.ts) simply has nothing to apply for it. When those systems
  // land, the hub's effect changes to a real member and this stays available
  // for any future pure-gateway node.
  | { type: "none" };

// unlockCaptainSlot carries no gate beyond the node's own `cost` (adminPoints)
// -- Homeworld Talents are fleet-wide Fleet Admiral prestige, spent purely
// from the fleet's adminPoints pool, entirely independent of any individual
// captain's own level/statPoints (those only ever gate that captain's OWN
// Captain Talents, a completely separate tree/pool). The old CAPTAIN_SLOT_UNLOCKS
// mechanism this replaced WAS captain-scoped (atLevel/statPointCost/componentsCost),
// but that scoping was deliberately dropped, not carried forward, when Fleet
// Logistics absorbed the job in Task 4 -- confirmed with the user rather than
// left as unenforced vestigial fields.
export type HomeworldTalentEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "rareYieldMult"; mult: number }
  // (The `recipeBonusOutput` member was RETIRED in Phase 4, Task F5 with the
  //  legacy RECIPES/craftRecipe instant-craft it exclusively modified. The two
  //  industry-branch nodes that granted it now carry the honest `none`
  //  placeholder, below -- their real mechanic is the Fabricator facility, a
  //  future re-wire.)
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number }
  // Radial Skill Web (Task 3): a genuinely-null gateway effect, added to mirror
  // CaptainTalentEffect's own `none` member (Task 2) exactly. Used by the
  // Homeland Defense and Citizenry hubs, which are "learn me first" seeds for
  // categories whose real mechanics (a Battlespace/defense system, a population
  // system) don't exist yet. Chosen over a `rareYieldMult`/`mult: 0.0`
  // placeholder because that would render through describeHomeworldTalentEffect
  // as a misleading "+0.0% Rare Material yield" line on a defense/citizenry
  // hub -- a `none` member renders honestly as "no bonus yet" instead. Carries
  // no payload; the tick economy (tick.ts) simply has nothing to apply for it.
  // When those systems land, the hub's effect changes to a real member and this
  // stays available for any future pure-gateway node.
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
  flavor: string;                // short narrative blurb -- surfaced in the talent-tree tooltips
}

export interface HomeworldTalentDef {
  branch: HomeworldTalentBranch;
  label: string;
  cost: number; // adminPoints
  x: number;
  y: number;
  neighbors: HomeworldTalentKey[];
  isHub?: boolean;
  flavor: string; // short narrative blurb -- surfaced in the talent-tree tooltips
  // Progression Pacing Rework (Task 9): an OPTIONAL additional Fleet-Admiral-level
  // wall LAYERED on top of this node's adminPoint `cost` + graph adjacency -- both
  // still apply. Only the captain-slot unlock nodes set it today: a captain is a
  // "wall breaker" you may only recruit once your Fleet Admiral has reached the
  // required level AND you can pay the adminPoint cost AND the node is adjacency-
  // reachable (confirmed with the user 2026-07-11). Absent (undefined) => no level
  // wall, so every other Homeworld Talent is unaffected (the gate is opt-in).
  // Enforced in buyHomeworldTalent (tick.ts); the UI surfacing lands in Task 10.
  requiresFleetAdminLevel?: number;
}

// NOTE: effect lives on the *Def directly below via a second field, not nested
// inside CaptainTalentDef/HomeworldTalentDef above -- TypeScript can't express
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
// Content this build ships (design §6.1-6.2 -- lean and honest):
//   - resourcefulness ("Prospector") is the ONE rich tree. Its hub plus the
//     re-homed ex-`command` extraction talents (Bulk -> Refined Extraction,
//     commonYieldMult/uncommonYieldMult -- extraction yield fits the salvage
//     theme) and the existing Keen Eye I/II + Lucky Strike I/II.
//   - tactical ("Tactician") and science ("Explorer") are a single gateway
//     hub each -- "learn me first" seeds for branches whose real mechanics
//     (combat / a redefined science system) don't exist yet. Their hubs carry
//     a `{ type: "none" }` effect (an honest "no bonus yet", NOT a misleading
//     0.0 yield placeholder) so they render correctly but grant nothing until
//     their systems land. No inert filler nodes are authored for them.
//
// `command`/`diplomacy` are GONE (removed with the old five-column model in
// Task 1); their content is either dropped (diplomacy) or re-homed onto
// resourcefulness (command's extraction talents). Coordinates below are the
// hand-authored placement -- tunable at the Task 12 device checkpoint, same
// launch-placeholder spirit as MISSIONS'/RECIPES' constants. Add entries here
// (and nowhere else -- App.svelte's Captain Talents panel iterates this object)
// when a branch's system is ready.
export type CaptainTalentKey =
  // resourcefulness ("Prospector") -- the rich tree
  | "prospectorHub"
  | "prospectorBulkExtraction" // ex-commandExtractionI
  | "prospectorRefinedExtraction" // ex-commandExtractionII
  | "prospectorKeenEyeI"
  | "prospectorKeenEyeII"
  | "prospectorLuckyStrikeI"
  | "prospectorLuckyStrikeII"
  // tactical ("Tactician") -- lean gateway stub until combat exists
  | "tacticianHub"
  // science ("Explorer") -- lean gateway stub until a science mechanic exists
  | "explorerHub";

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
      "Standard doctrine trades finesse for throughput -- pull more common ore per cycle, no questions asked.",
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
      "A trained eye catches what the sensors miss -- subtle mineral banding invisible to standard scans.",
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
  // --- tactical ("Tactician") -- gateway hub only -----------------------
  tacticianHub: {
    branch: "tactical",
    label: "Combat Readiness",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // no content nodes yet -- grows when combat lands (design §6.2)
    effect: { type: "none" }, // pure gateway; no combat system to hang a real effect on yet
    flavor: "Discipline first. The rest of the doctrine comes when there's a war to fight.",
  },
  // --- science ("Explorer") -- gateway hub only -------------------------
  explorerHub: {
    branch: "science",
    label: "Survey Doctrine",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // no content nodes yet -- grows when a science mechanic lands
    effect: { type: "none" }, // pure gateway; no science system to hang a real effect on yet
    flavor: "Every uncharted system is a question. Answering it starts here.",
  },
};

// Innate bonus granted once a captain has this branch chosen as their spec
// (CaptainState.spec) -- separate from, and additive with, whatever they've
// bought in the talent tree itself. Deliberately Partial<...>: a branch with
// NO entry here is not yet selectable as a spec at all (tactical/science
// today -- their underlying systems, Combat/a redefined Science mechanic,
// don't exist yet, so there's nothing meaningful to grant a bonus FOR).
// Revives the Phase 1 "Captain Prestige panel + specialization picker"
// mechanic (retired during the Phase 4 Navigation/Progression Overhaul along
// with the old Generator Stack economy it was built on), now expressed
// against this newer Captain Talent tree instead.
//
// Radial Skill Web (Task 2): the `command` entry was dropped along with the
// command branch itself. resourcefulness ("Prospector") is the only branch
// with a real spec bonus at launch -- the sole selectable spec until tactical
// or science earns its own system (and thus its own spec bonus).
export const CAPTAIN_SPEC_BONUS: Partial<Record<CaptainTalentBranch, CaptainTalentEffect>> = {
  resourcefulness: { type: "bonusRollChance", chance: 0.01 },
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
// Content this build ships (design §6.3 -- lean and honest):
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
//     filler nodes are authored for them -- same reasoning as the captain
//     Tactician/Explorer hubs.
// Costs/coordinates below are launch placeholders, same as CAPTAIN_TALENTS' own
// -- not balance-tested; coordinates tunable at the Task 12 device checkpoint.
export type HomeworldTalentKey =
  // fleetLogistics -- the rich category
  | "fleetLogisticsHub"
  | "fleetLogisticsSlot1"
  | "fleetLogisticsSlot2"
  | "fleetLogisticsSlot3"
  | "fleetLogisticsYield"
  // homelandDefense -- hub-only gateway stub until a defense system exists
  | "homelandDefenseHub"
  // citizenry -- hub-only gateway stub until a population system exists
  | "citizenryHub"
  // economy -- hub + one existing content node
  | "economyHub"
  | "economyTrickle"
  // industry -- hub + one existing content node
  | "industryHub"
  | "industryBonusOutput";

export const HOMEWORLD_TALENTS: Record<HomeworldTalentKey, HomeworldTalentDef & { effect: HomeworldTalentEffect }> = {
  // --- fleetLogistics -- the rich category ------------------------------
  // hub -> Slot1 -> Slot2 -> Slot3 (the slot-unlock chain), plus Yield off hub.
  fleetLogisticsHub: {
    branch: "fleetLogistics",
    label: "Fleet Command",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: ["fleetLogisticsSlot1", "fleetLogisticsYield"],
    // A modest real starter effect (mirrors the captain prospectorHub, which
    // carries a real commonYieldMult on the one rich tree) -- rareYieldMult is
    // thematically apt for a logistics/requisitions category.
    effect: { type: "rareYieldMult", mult: 0.02 },
    flavor: "The standing authority that turns a scattering of ships into a fleet.",
  },
  // Progression Pacing Rework (Task 9): the LATER slot-unlock nodes carry an
  // additional requiresFleetAdminLevel wall (enforced in buyHomeworldTalent),
  // LAYERED on top of each node's adminPoint `cost` + adjacency -- both the cost
  // AND the level must be satisfied to recruit. The intended ladder is a ~x5
  // climb per captain, but the FIRST unlock (Slot1 = 2nd captain) is UNGATED:
  //   2nd slot (Slot1) -> UNGATED,  3rd slot (Slot2) -> FA L5,  4th slot (Slot3) -> FA L25,
  //   5th slot (Slot4) -> FA L125.
  // Slot1's old L1 wall was a FUNCTIONAL NO-OP (players start at FA level 1, so
  // "requires L1" was always already satisfied) and was REMOVED per user request
  // -- the first unlock rung is intentionally free of any FA-level gate now, so
  // fleetLogisticsSlot1 simply carries no requiresFleetAdminLevel field at all.
  // Only Slot1/2/3 exist today, so only the L5/L25 walls ship -- the L125 rung
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
    flavor: "Fleet Command approves a second commission -- the roster grows.",
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
    flavor: "Four commands under one banner -- logistics finally caught up with ambition.",
  },
  fleetLogisticsYield: {
    branch: "fleetLogistics",
    label: "Fleet Requisitions",
    cost: 4,
    x: 180,
    y: -120,
    neighbors: ["fleetLogisticsHub"],
    effect: { type: "rareYieldMult", mult: 0.05 }, // was fleetExtractionYieldMult
    flavor:
      "Standing orders redirect a share of every rare find straight back to the fleet's reserves.",
  },
  // --- homelandDefense -- hub-only gateway stub -------------------------
  homelandDefenseHub: {
    branch: "homelandDefense",
    label: "Home Guard",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // no content nodes yet -- grows when a defense system lands (design §6.3)
    effect: { type: "none" }, // pure gateway; no defense system to hang a real effect on yet
    flavor: "The homeworld's first and last line -- for now, a promise more than a wall.",
  },
  // --- citizenry -- hub-only gateway stub -------------------------------
  citizenryHub: {
    branch: "citizenry",
    label: "Civic Charter",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // no content nodes yet -- grows when a population system lands (design §6.3)
    effect: { type: "none" }, // pure gateway; no population system to hang a real effect on yet
    flavor: "Every world needs a people worth defending. Their story starts here.",
  },
  // --- economy -- hub + one existing content node -----------------------
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
  // --- industry -- hub + one existing content node ----------------------
  industryHub: {
    branch: "industry",
    label: "Works Directorate",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: ["industryBonusOutput"],
    // `none` placeholder (Phase 4, Task F5): this hub once granted
    // recipeBonusOutput on the legacy instant-craft, retired with RECIPES. The
    // industry branch's real mechanic is now the Fabricator facility; a future
    // task re-wires this node to a Fabricator bonus. Rendered honestly as "no
    // bonus yet" -- the same `none` idiom the Homeland Defense/Citizenry hubs use.
    effect: { type: "none" },
    flavor: "Nationalize the foundries and the whole homeworld starts to hum.",
  },
  industryBonusOutput: {
    branch: "industry",
    label: "Tooling Upgrade",
    cost: 4,
    x: -180,
    y: -120,
    neighbors: ["industryHub"],
    // `none` placeholder (Phase 4, Task F5) -- see industryHub above: retired with
    // the legacy recipeBonusOutput/RECIPES instant-craft; a future task re-wires
    // this to a Fabricator bonus.
    effect: { type: "none" },
    flavor: "New jigs and fixtures on the fabrication line mean every batch stretches a little further.",
  },
};

// Progression Pacing Rework (Task 11, "Coming Soon" -> "Locked" relabel):
// how many captain slots the game's CURRENT content can actually unlock. Every
// captain past the 1st is recruited by an `unlockCaptainSlot` Homeworld Talent
// (the fleetLogisticsSlot1/2/3 chain above), so the live ceiling is:
//     1 base captain + (number of unlockCaptainSlot nodes that exist today)
//   = 1 + 3 = 4 right now.
// Derived, NOT hardcoded to 4, so it grows automatically the day a
// fleetLogisticsSlot4 node is added -- mirroring the "no placeholder, it lands
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
// (src/lib/TreeSelector.svelte -- the "mockup A" card-selector screen). Each
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
// (same convention as MISSIONS/RECIPES/talent flavor -- frontier/belter
// sci-fi tone, editable as text, not balance- or lore-locked). The tactical
// ("Tactician") and science ("Explorer") specs, and the hub-only homeworld
// categories, honestly note that their real systems are still coming.
export interface SelectorCard {
  key: string; // MUST match a real branch/category key (see note above)
  title: string;
  flavor: string;
  bullets: string[];
}

// specCards -- the 3 captain-specialization cards. Keys are exactly the three
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
      "The one fully-built spec at launch -- a real web of talents.",
    ],
  },
  {
    key: "tactical", // -> CaptainTalentBranch "tactical"; title per plan
    title: "Tactician",
    flavor:
      "Out past the shipping lanes, someone eventually shoots first. The Tactician plans for that day.",
    bullets: [
      "Combat-focused discipline for when the shooting starts.",
      "Full talent web arrives when the combat system lands.",
      "For now: a single gateway node -- a promise, not yet a fight.",
    ],
  },
  {
    key: "science", // -> CaptainTalentBranch "science"; title per plan
    title: "Explorer",
    flavor:
      "Every uncharted system is a question with a paycheck attached. Explorers go find the answer.",
    bullets: [
      "Survey- and science-focused deep-space doctrine.",
      "Full talent web arrives when the science system lands.",
      "For now: a single gateway node -- charted course, empty map.",
    ],
  },
];

// categoryCards -- the 5 homeworld-category cards. Keys are exactly the five
// HomeworldTalentBranch literals, so the Fleet Admiral (Homeworld) Talents
// panel (Task 15) maps a focused card straight onto a category's web. Unlike
// the captain flow these do NOT lock in -- they're pure navigation into a
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
      "Its real defenses arrive with the battlespace system.",
      "For now: a single gateway node -- a promise more than a wall.",
    ],
  },
  {
    key: "citizenry", // -> HomeworldTalentBranch "citizenry"
    title: "Citizenry",
    flavor:
      "A frontier world is only as strong as the people who choose to stay and build on it.",
    bullets: [
      "The homeworld's population and the civic life it supports.",
      "Real effects arrive with the population system.",
      "For now: a single gateway node -- a people finding their footing.",
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
      "Stretches every crafting batch a little further.",
      "One content node beyond the hub at launch, grown later.",
    ],
  },
];

// What a brand-new (or newly-unlocked) captain slot starts with. There is no
// more prestige to reset a captain THROUGH -- this is purely the baseline for
// a slot that has never been played.
export function freshCaptainStack(): Pick<
  CaptainState,
  "mission" | "xp" | "level" | "statPoints" | "unlockedCaptainTalents" | "spec"
> {
  return {
    mission: null,
    xp: new Decimal(0),
    level: 1,
    statPoints: 0,
    unlockedCaptainTalents: [],
    spec: null,
  };
}

// Generates `count` captains (ids 1..count) sharing the same freshCaptainStack()
// baseline. Used for: a brand-new save (freshState calls freshCaptains(1))
// and save migration (backfilling a never-played slot). NOTE: a slot unlock
// (tick.ts's buyHomeworldTalent, unlockCaptainSlot effect) does NOT call this
// function -- it inlines its own captain object using freshCaptainStack()
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
// two call sites MUST produce the identical shape -- a fresh game and a migrated
// old save have to land on the same clean-slate totals -- so they are defined
// ONCE here rather than duplicated, where they could silently drift apart.
// Empty per-key tally maps (a material/mission key is absent until its first
// recorded event) and live Decimal(0) scalar sums. Reserved schema only:
// nothing increments these yet (the increment wiring is a later task) -- see
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

export function freshState(): GameState {
  return {
    captains: freshCaptains(1),
    tickDurationSeconds: 1,
    gameTimeSeconds: 0,
    // Phase 1: seed `inventory` with the 5 baseline material keys at zero. This is
    // the canonical, sole fleet-wide material balance -- tick.ts and App.svelte
    // read/write it via the shared addToInventory helper. It replaced the old
    // homePlanet.storage field entirely as of Task 7 (storage removed; its keys now
    // live here). The 5 keys below are the historical storage set -- new itemIds
    // (refined/component tiers) are added dynamically on first acquire, no reseed.
    inventory: {
      commonOre: new Decimal(0),
      uncommonMaterial: new Decimal(0),
      rareMaterial: new Decimal(0),
      refinedMaterial: new Decimal(0),
      components: new Decimal(0),
    },
    // No itemId has been seen on a brand-new save -- the ❓ -> reveal set starts
    // empty (discovery wiring lands in a later task).
    discovered: [],
    unlockedHomeworldTalents: [],
    fleetAdminXp: new Decimal(0),
    fleetAdminLevel: 1,
    adminPoints: 0,
    credits: new Decimal(0),
    // Fuel economy (Task 3 / soft-lock fix 2026-07-14): a brand-new fleet starts with a
    // FULL tank -- exactly FUEL_TANK_BASE_CAP, the level-0 fuelCap. WHY the change from the
    // original empty seed: a pristine save has 0 credits and 0 Deuterium Ice, so an empty
    // tank meant canDispatch returned fuelEmpty for EVERY mission and the player was
    // soft-locked at the very first dispatch -- unable to run the first mission that would
    // bootstrap the whole fuel economy (missions earn the credits/ice that buy/refine more
    // fuel). A full starting tank is a one-time, non-exploitable bootstrap grant: it only
    // ever seeds a NEW game (and, via the ?? in MIGRATIONS[20], a pre-fuel save that has no
    // fuel field at all). Existing saves that ALREADY carry a fuel balance keep it.
    fuel: new Decimal(FUEL_TANK_BASE_CAP),
    // Seed the invariant: the one starting captain (freshCaptains(1) -> id 1) gets
    // exactly one hull, the universal General Freighter. nextShipId starts at 2
    // because "ship-1" is already taken by this seeded hull.
    ships: [{ id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 }],
    shipStorageCapacity: 8,
    nextShipId: 2,
    // Clean-slate lifetime totals -- see freshLifetimeStats() above. Extracted
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
    // (cap 1,000,000; NOT "unbuilt" -- T1 is available from the start, its level-0
    // cap is live). warehouseT2 starts at level 0 = LOCKED (its rung 0 is the
    // unlock). A NEW game is thus consistent with tierCap's expectations. Existing
    // saves get these same seeds via the v18->v19 migration (Task B4, save.ts) --
    // NOT this function's job.
    // Mission Rework Task 4 (additive seed): fuelStorage starts at level 0 = the
    // base tank's starting state (cap FUEL_TANK_BASE_CAP; NOT "unbuilt" -- the tank
    // is USABLE from the start, its level-0 cap is live so missions can be fueled
    // immediately, no soft-lock). Existing saves get this seed via the v20->v21
    // migration (Task 9, save.ts) -- NOT this function's job. fuelCap tolerates an
    // absent key (?? 0) regardless, but seeding keeps the facility present for the UI.
    // Mission Rework Task 6 (additive seed): missionControl starts at level 1 -- NOT
    // level 0. Level 0 is "not built"; seeding at level 1 means the facility is
    // ESTABLISHED from game start, so ALL FOUR missions (every one is unlockLevel 1 per
    // the USER REVISION 2026-07-14) are dispatchable immediately -- the no-soft-lock /
    // no-regression guarantee. The mission-control unlock UPGRADE is deferred (the track
    // caps at level 1); a future mission batch re-adds it. See FACILITIES.missionControl.
    // Existing saves get this same level-1 seed via the v20->v21 migration (Task 9).
    // Research Task R2 (additive seed): research starts at level 1 -- NOT level 0.
    // Level 0 is "not built"; seeding at level 1 makes the Research Lab ESTABLISHED
    // from game start, so tier-1 blueprints are researchable immediately (no soft-lock,
    // mirrors missionControl). researchSlotCount reads level 1 -> 1 research slot.
    // Existing saves get this same level-1 seed via the v21->v22 migration (Task R6,
    // save.ts) -- NOT this function's job. researchSlotCount tolerates an absent key
    // (?? 0) regardless, but seeding keeps the facility present for the R5 UI.
    // Shipyard (Task S1): seeded at level 0 -- LOCKED / UNFOUNDED. ⚠️ This DIFFERS from
    // research/fabricator (level 1, established from start): the Shipyard's founding rung
    // (level 0->1) is a REAL unlock the player buys with credits + FA level, so it MUST
    // start at level 0 for founding to be meaningful. shipBuildSlotCount is a const 1
    // regardless of level, but building a hull is gated on level >= 1 (S3's canBuildShip).
    // Existing saves get this same level-0 seed via the v24->v25 migration (S6, save.ts).
    facilities: { refinery: { level: 0 }, warehouseT1: { level: 0 }, warehouseT2: { level: 0 }, fuelStorage: { level: 0 }, missionControl: { level: 1 }, research: { level: 1 }, fabricator: { level: 1 }, shipyard: { level: 0 } },
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
    // same [] seed via the v21->v22 migration (Task R6, save.ts) -- NOT this function's
    // job. A string[] (no Decimal), so hydrateDecimals needs no change (see the field's
    // comment on GameState above).
    researchedBlueprints: [],
  };
}
