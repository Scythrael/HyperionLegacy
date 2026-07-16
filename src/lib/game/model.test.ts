import { describe, it, expect } from "vitest";
import {
  freshState,
  freshCaptains,
  freshCaptainStack,
  requiredTicksForPhase,
  MISSIONS,
  REFINE_RECIPES,
  FACILITIES,
  xpForNextLevel,
  xpForNextFleetAdminLevel,
  CAPTAIN_TALENTS,
  HOMEWORLD_TALENTS,
  MAX_UNLOCKABLE_CAPTAINS,
  CAPTAIN_SPEC_BONUS,
  specCards,
  categoryCards,
  SHIP_TYPES,
  shipDerivedStats,
  effectiveMissionDef,
  ITEMS,
  BASE_XP_PER_TICK,
  FUEL_CREDITS_PER_UNIT,
} from "./model";
import type { CaptainTalentKey, HomeworldTalentKey } from "./model";
import { fuelNeeded } from "./fuel";

describe("freshState — captain roster shape", () => {
  it("starts with exactly 1 captain (Command branch is how the roster grows now)", () => {
    const state = freshState();
    expect(state.captains).toHaveLength(1);
  });

  it("Captain 1 has id 1, label 'Captain 1'", () => {
    const state = freshState();
    const c1 = state.captains[0];
    expect(c1.id).toBe(1);
    expect(c1.label).toBe("Captain 1");
  });

  it("starts with xp:0, level:1, statPoints:0 per captain, and fleet-wide tickDurationSeconds 1", () => {
    const state = freshState();
    for (const c of state.captains) {
      // Decimal isn't a primitive -- .toBe()/.toEqual() won't match a plain-number
      // literal even when equal in value, so every Decimal-field assertion in this
      // file compares via .equals() instead (this pattern repeats below without
      // re-explaining it each time; see the inventory zero-init test further down
      // for the related per-key .equals() case specifically).
      expect(c.xp.equals(0)).toBe(true);
      expect(c.level).toBe(1);
      expect(c.statPoints).toBe(0);
    }
    expect(state.tickDurationSeconds).toBe(1);
  });

  it("fleet-wide fields default to 0", () => {
    const state = freshState();
    expect(state.gameTimeSeconds).toBe(0);
  });
});

describe("freshState ships seeding", () => {
  it("seeds one General Freighter assigned to the starting captain, capacity 8", () => {
    const s = freshState();
    expect(s.shipStorageCapacity).toBe(8);
    expect(s.nextShipId).toBe(2); // "ship-1" is taken by the seeded freighter, so the next id is 2
    expect(s.ships).toHaveLength(1);
    expect(s.ships[0].typeKey).toBe("generalFreighter");
    expect(s.ships[0].assignedCaptainId).toBe(s.captains[0].id);
    for (const c of s.captains) {
      expect(s.ships.filter((sh) => sh.assignedCaptainId === c.id)).toHaveLength(1);
    }
  });
});

describe("freshCaptains(count) — parameterized roster generation", () => {
  it("generates exactly `count` captains with sequential ids/labels, all sharing the fresh baseline", () => {
    const captains = freshCaptains(3);
    expect(captains).toHaveLength(3);
    expect(captains.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(captains.map((c) => c.label)).toEqual(["Captain 1", "Captain 2", "Captain 3"]);
    for (const c of captains) {
      expect(c.xp.equals(0)).toBe(true);
      expect(c.level).toBe(1);
      expect(c.statPoints).toBe(0);
    }
  });

  it("generates a single captain when count is 1", () => {
    const captains = freshCaptains(1);
    expect(captains).toHaveLength(1);
    expect(captains[0].id).toBe(1);
    expect(captains[0].label).toBe("Captain 1");
  });
});

describe("freshCaptainStack — shared reset baseline", () => {
  it("returns the baseline a brand-new captain slot starts with (no tickDurationSeconds -- that's fleet-wide now)", () => {
    const stack = freshCaptainStack();
    expect(stack.mission).toBe(null);
    expect(stack.xp.equals(0)).toBe(true);
    expect(stack.level).toBe(1);
    expect(stack.statPoints).toBe(0);
    expect((stack as any).tickDurationSeconds).toBeUndefined();
  });
});

describe("freshState / freshCaptainStack — mission and Home Planet fields", () => {
  it("a fresh captain starts with no active mission", () => {
    const captain = freshCaptains(1)[0];
    expect(captain.mission).toBe(null);
  });

  it("freshState's inventory starts at 0 for every material, including the crafted-good tiers", () => {
    const state = freshState();
    // Per-key .equals() checks, not .toEqual() against a plain-number literal --
    // .toEqual does a deep structural comparison, and a Decimal instance's
    // internal shape (mantissa/exponent) will NOT structurally match a plain
    // number literal even when the represented value is equal.
    // (Converted from homePlanet.storage to the keyed inventory -- Task 6; this is
    // CURRENT freshState, and Task 7 removes the storage field, so it must read
    // inventory, now the canonical material balance.)
    expect(state.inventory.commonOre.equals(0)).toBe(true);
    expect(state.inventory.uncommonMaterial.equals(0)).toBe(true);
    expect(state.inventory.rareMaterial.equals(0)).toBe(true);
    expect(state.inventory.refinedMaterial.equals(0)).toBe(true);
    expect(state.inventory.components.equals(0)).toBe(true);
  });

  it("freshCaptainStack's mission field is null (a brand-new/unlocked captain slot starts idle)", () => {
    expect(freshCaptainStack().mission).toBe(null);
  });
});

// Ship Production Economy (Phase 1): the keyed `inventory` + `discovered`
// fields. Introduced ALONGSIDE homePlanet.storage in Task 2, they are now the
// LIVE material model (Tasks 4-5 wired tick.ts/App.svelte onto inventory; Task 6
// -- this pass -- converted the remaining test fixtures; Task 7 removes
// homePlanet.storage entirely). freshState must seed `inventory` with the 5
// launch material keys at Decimal(0), and `discovered` as an empty array (no
// itemId has been seen on a brand-new save). This test guards ONLY that
// freshState seed.
describe("Phase 1 — keyed inventory + discovered (additive)", () => {
  it("freshState().inventory seeds exactly the 5 launch material keys, all Decimal(0)", () => {
    const state = freshState();
    const inventoryKeys = Object.keys(state.inventory);
    // Exact seed key SET -- freshState seeds inventory with precisely the 5 launch
    // materials (no missing, no extra). Hardcoded against the same canonical launch
    // set save.ts's v17->v18 migration test pins; this REPLACES the old "mirror
    // homePlanet.storage's keys" comparison (Task 6), which becomes a tautology
    // once storage is removed in Task 7. Sorted so order can't cause a false fail.
    expect(inventoryKeys.sort()).toEqual(
      ["commonOre", "components", "rareMaterial", "refinedMaterial", "uncommonMaterial"],
    );
    // Every seeded inventory entry starts at Decimal(0) -- compared via .equals()
    // (not .toEqual against a plain number), same Decimal convention as every
    // other Decimal-field assertion in this file (see the inventory zero-init
    // test above for the full rationale).
    for (const key of inventoryKeys) {
      expect(state.inventory[key].equals(0)).toBe(true);
    }
  });

  it("freshState().discovered starts as an empty array (nothing seen yet)", () => {
    expect(freshState().discovered).toEqual([]);
  });
});

// Ship Production Economy (Phase 1, Task 3): the facility/timed-process
// reservation fields are ADDED to GameState this pass (DEFINITIONS + state only;
// the engine that reads/writes them is Task 8). freshState must seed the one
// facility Phase 1 ships (refinery) at level 0 = not built, no active processes,
// and the next process id at 1 -- the SAME clean-slate baseline the v17->v18 save
// migration (save.ts, MIGRATIONS[17]) backfills onto old saves. This test guards
// only that additive freshState seed.
describe("Phase 1 — facility/process reservation fields (additive)", () => {
  // Phase 2, Task B2: the two tiered Warehouses join the refinery in freshState.
  // warehouseT1 level 0 = the base tier's live starting state (cap 1M, no unlock);
  // warehouseT2 level 0 = locked (its rung 0 is the unlock). A NEW game must seed
  // all three so tierCap + the facility framework read a consistent baseline.
  // (Existing-save migration to this baseline is Task B4, not tested here.)
  it("freshState().facilities seeds the refinery + both tiered warehouses + fuel storage + mission control", () => {
    const state = freshState();
    // Mission Rework Task 4 (additive): fuelStorage joins the seed at level 0 = the
    // base tank's live starting state (cap FUEL_TANK_BASE_CAP, no unlock, usable from
    // game start so missions can be fueled -- no soft-lock). Same posture as
    // warehouseT1's live level-0 base.
    // Mission Rework Task 6 (additive): missionControl joins the seed at level 1 (NOT
    // level 0) -- level 0 is "not built", so seeding at 1 keeps the facility
    // ESTABLISHED from game start and the 2 ore runs (unlockLevel 1) dispatchable
    // immediately (no soft-lock / no regression). Its level-1 -> 2 completion-gated
    // upgrade unlocks Salvage + Forage.
    // Research Task R2 (additive): the Research Lab joins the seed at level 1 (NOT
    // level 0) -- same seeded-founding posture as missionControl, so tier-1 blueprints
    // are researchable from game start (no soft-lock) and researchSlotCount reads 1.
    // Fabricator Task F1 (additive): the Fabricator joins the seed at level 1 (NOT
    // level 0) -- same seeded-founding posture as the Research Lab, so tier-1 blueprints
    // are FABRICABLE from game start once researched (no soft-lock) and fabricateSlotCount
    // reads 1.
    expect(state.facilities).toEqual({
      refinery: { level: 0 },
      warehouseT1: { level: 0 },
      warehouseT2: { level: 0 },
      fuelStorage: { level: 0 },
      missionControl: { level: 1 },
      research: { level: 1 },
      fabricator: { level: 1 },
    });
  });

  it("freshState().activeProcesses starts empty and nextProcessId starts at 1", () => {
    const state = freshState();
    expect(state.activeProcesses).toEqual([]);
    expect(state.nextProcessId).toBe(1);
  });
});

describe("MISSIONS — launch set", () => {
  // Mission Rework (Task 1): the launch set grew from 2 ore runs to 4 missions
  // (the 2 ore runs, keys unchanged, + salvageWreckage + forageFlora). This test's
  // per-field assertions on the 2 ore runs are unchanged (anti-regression); the
  // count assertion was updated 2 -> 4 and the title made honest.
  it("has exactly 5 missions with the specified tick counts and cargo/extraction values", () => {
    // Fuel-sourcing RESTRUCTURE (2026-07-15): grew 4 -> 5 with the free localFuelRun
    // bootstrap (asserted in its own describe block above). The ore-run per-field
    // assertions below are unchanged (anti-regression).
    expect(Object.keys(MISSIONS)).toHaveLength(5);

    expect(MISSIONS.shortOreRun.transitOutTicks).toBe(25);
    expect(MISSIONS.shortOreRun.transitBackTicks).toBe(25);
    expect(MISSIONS.shortOreRun.unloadTicks).toBe(8);
    expect(MISSIONS.shortOreRun.extractionRatePerTick).toBe(1);
    expect(MISSIONS.shortOreRun.cargoCapacity).toBe(90);

    expect(MISSIONS.longOreRun.transitOutTicks).toBe(70);
    expect(MISSIONS.longOreRun.transitBackTicks).toBe(70);
    expect(MISSIONS.longOreRun.cargoCapacity).toBe(90);

    // Progression Pacing Rework (Task 5): fleetAdminXpPerCycle was renamed to the
    // per-tick field fleetAdminXpPerTick and both missions reset to 1 (the old
    // per-cycle Short=1/Long=2 split did not carry over to a per-tick rate).
    expect(MISSIONS.shortOreRun.fleetAdminXpPerTick).toBe(1);
    expect(MISSIONS.longOreRun.fleetAdminXpPerTick).toBe(1);

    // Fuel Economy v2 (F3): friendlier credit rewards so income comfortably exceeds any
    // auto-buy fuel cost (bumped 10 -> 30 / 20 -> 75). Tunable, device-retuned.
    expect(MISSIONS.shortOreRun.creditsPerCycle).toBe(30);
    expect(MISSIONS.longOreRun.creditsPerCycle).toBe(75);
  });

  it("every mission's occurrence chances are valid probabilities (0-1)", () => {
    for (const key of Object.keys(MISSIONS) as (keyof typeof MISSIONS)[]) {
      // localFuelRun is the exception: it yields Deuterium Ice ONLY, so its uncommon/rare
      // chances are deliberately EXACTLY 0 (never roll). Its 0-only contract is enforced in
      // the dedicated restructure describe block above; here it must just be a valid [0,1].
      const minChance = key === "localFuelRun" ? 0 : Number.MIN_VALUE;
      expect(MISSIONS[key].uncommonChance).toBeGreaterThanOrEqual(minChance);
      expect(MISSIONS[key].uncommonChance).toBeLessThanOrEqual(1);
      expect(MISSIONS[key].rareChance).toBeGreaterThanOrEqual(minChance);
      expect(MISSIONS[key].rareChance).toBeLessThanOrEqual(1);
    }
  });

  it("longOreRun has better rare-material odds than shortOreRun", () => {
    expect(MISSIONS.longOreRun.rareChance).toBeGreaterThan(MISSIONS.shortOreRun.rareChance);
    expect(MISSIONS.longOreRun.uncommonChance).toBeGreaterThan(MISSIONS.shortOreRun.uncommonChance);
  });
});

// Mission Rework (Task 1, docs/plans/2026-07-14-mission-rework-plan.md): every
// mission now carries a per-mission loot triad (lootTable = the common/uncommon/
// rare ITEM keys it deposits), replacing the old hard-coded commonOre/uncommon
// Material/rareMaterial the extraction roll used for EVERY mission. The abstract
// rarity roll is unchanged; only WHICH item key each tier deposits is now
// per-mission (remapped at delivery -- see tick.ts). primaryMaterial (the auto-stop
// gate material) is each mission's COMMON item.
describe("MISSIONS — per-mission loot triads (Mission Rework Task 1)", () => {
  // The authoritative triad per mission (design §1). Common / uncommon / rare
  // ITEM keys, all of which already exist as scaffolded ITEMS placeholders.
  const EXPECTED_TRIADS: Record<
    "localFuelRun" | "shortOreRun" | "longOreRun" | "salvageWreckage" | "forageFlora",
    { common: string; uncommon: string; rare: string }
  > = {
    // Fuel-sourcing RESTRUCTURE: the fuel bootstrap yields Deuterium Ice ONLY. Its
    // uncommon/rare slots point at the generic tiers to satisfy the rarity contract
    // below, but with uncommonChance/rareChance 0 they NEVER roll (see the dedicated
    // localFuelRun tests further down).
    localFuelRun: { common: "deuteriumIce", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    shortOreRun: { common: "commonOre", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    longOreRun: { common: "ferriteOre", uncommon: "cobaltOre", rare: "osmiumOre" },
    salvageWreckage: { common: "scrapAlloy", uncommon: "salvagedCircuitry", rare: "intactReactorCore" },
    forageFlora: { common: "fibrousBiomass", uncommon: "volatileResin", rare: "exoticSporeCluster" },
  };

  it("all 5 mission keys exist (fuel bootstrap + 2 ore runs + salvage + forage)", () => {
    expect(Object.keys(MISSIONS).sort()).toEqual(
      ["forageFlora", "localFuelRun", "longOreRun", "salvageWreckage", "shortOreRun"].sort()
    );
  });

  it("labels are the design's in-fiction names", () => {
    expect(MISSIONS.localFuelRun.label).toBe("Local Deuterium Skim");
    expect(MISSIONS.shortOreRun.label).toBe("Local Asteroid");
    expect(MISSIONS.longOreRun.label).toBe("Lunar Mine Contract");
    expect(MISSIONS.salvageWreckage.label).toBe("Salvage Skirmish Wreckage");
    expect(MISSIONS.forageFlora.label).toBe("Forage Minerals & Flora on Nearby Moon");
  });

  it("every mission's lootTable resolves to real, correctly-rarity-tagged ITEMS", () => {
    for (const key of Object.keys(EXPECTED_TRIADS) as (keyof typeof EXPECTED_TRIADS)[]) {
      const triad = MISSIONS[key].lootTable;
      // Each tier's key must exist in ITEMS and carry the matching rarity tag.
      expect(ITEMS[triad.common], `${key}.common (${triad.common}) exists`).toBeDefined();
      expect(ITEMS[triad.uncommon], `${key}.uncommon (${triad.uncommon}) exists`).toBeDefined();
      expect(ITEMS[triad.rare], `${key}.rare (${triad.rare}) exists`).toBeDefined();
      expect(ITEMS[triad.common].rarity).toBe("common");
      expect(ITEMS[triad.uncommon].rarity).toBe("uncommon");
      expect(ITEMS[triad.rare].rarity).toBe("rare");
    }
  });

  it("every mission's lootTable matches the authoritative per-mission triad", () => {
    for (const key of Object.keys(EXPECTED_TRIADS) as (keyof typeof EXPECTED_TRIADS)[]) {
      expect(MISSIONS[key].lootTable).toEqual(EXPECTED_TRIADS[key]);
    }
  });

  it("every mission's primaryMaterial is its COMMON item (the auto-stop gate material)", () => {
    for (const key of Object.keys(EXPECTED_TRIADS) as (keyof typeof EXPECTED_TRIADS)[]) {
      expect(MISSIONS[key].primaryMaterial).toBe(EXPECTED_TRIADS[key].common);
      expect(MISSIONS[key].primaryMaterial).toBe(MISSIONS[key].lootTable.common);
    }
  });

  // ANTI-REGRESSION: the Local Asteroid run (shortOreRun) must still deposit the
  // ORIGINAL Titanium/Polysilicate/Iridium triad under the ORIGINAL storage keys,
  // and keep its original occurrence chances -- its lootTable is the identity map
  // (tier key == item key), so its delivery is byte-identical to pre-rework.
  it("shortOreRun (Local Asteroid) is unchanged: identity triad + original chances", () => {
    expect(MISSIONS.shortOreRun.lootTable).toEqual({
      common: "commonOre",
      uncommon: "uncommonMaterial",
      rare: "rareMaterial",
    });
    expect(MISSIONS.shortOreRun.primaryMaterial).toBe("commonOre");
    expect(MISSIONS.shortOreRun.uncommonChance).toBe(0.019);
    expect(MISSIONS.shortOreRun.rareChance).toBe(0.001);
  });

  it("the 2 new missions have valid phase durations and probabilities", () => {
    for (const key of ["salvageWreckage", "forageFlora"] as const) {
      const m = MISSIONS[key];
      expect(m.transitOutTicks).toBeGreaterThan(0);
      expect(m.transitBackTicks).toBeGreaterThan(0);
      expect(m.unloadTicks).toBeGreaterThan(0);
      expect(m.extractionRatePerTick).toBeGreaterThan(0);
      // cargoCapacity must divide evenly by extractionRatePerTick (requiredTicksForPhase
      // has no partial-final-tick path -- see model.ts).
      expect(m.cargoCapacity % m.extractionRatePerTick).toBe(0);
      expect(m.uncommonChance).toBeGreaterThan(0);
      expect(m.uncommonChance).toBeLessThanOrEqual(1);
      expect(m.rareChance).toBeGreaterThan(0);
      expect(m.rareChance).toBeLessThanOrEqual(1);
      // Closed-form parity trap: fleetAdminXpPerTick MUST stay an integer (see the
      // ⚠️ block in model.ts MissionDef); Task 2 owns any fractional XP retune.
      expect(Number.isInteger(m.fleetAdminXpPerTick)).toBe(true);
    }
  });
});

// Fuel-sourcing RESTRUCTURE (2026-07-15): Deuterium Ice becomes its OWN dedicated
// fuel-ore item; the F1 label relabels are reverted; a free local fuel-only mission
// is the bootstrap; credit auto-buy gets expensive. See project_fleet_admiral memory.
describe("Fuel-sourcing restructure — label reverts + dedicated Deuterium Ice item", () => {
  it("reverts commonOre back to 'Titanium Ore' (Local Asteroid common; F1's 'Deuterium Ice' undone)", () => {
    expect(ITEMS.commonOre.label).toBe("Titanium Ore");
    expect(ITEMS.commonOre.rarity).toBe("common");
    // The refinery-output flavor/hint were also reverted off the ice wording.
    expect(ITEMS.refinedMaterial.unlockHint).toContain("Titanium Ore");
    expect(ITEMS.refinedMaterial.flavor.toLowerCase()).not.toContain("deuterium");
  });

  it("reverts ferriteOre back to 'Ferrite' (Lunar Mine common; F1's 'Titanium' undone)", () => {
    expect(ITEMS.ferriteOre.label).toBe("Ferrite");
    expect(ITEMS.ferriteOre.rarity).toBe("common");
  });

  it("adds a dedicated `deuteriumIce` item: raw, tier 1, common, labelled 'Deuterium Ice'", () => {
    const ice = ITEMS.deuteriumIce;
    expect(ice).toBeDefined();
    expect(ice.label).toBe("Deuterium Ice");
    expect(ice.category).toBe("raw");
    expect(ice.tier).toBe(1);
    expect(ice.rarity).toBe("common");
    expect(ice.unlockHint.length).toBeGreaterThan(0);
    expect(ice.flavor.length).toBeGreaterThan(0);
  });

  it("makes credit fuel auto-buy EXPENSIVE (FUEL_CREDITS_PER_UNIT 5 -> 20)", () => {
    expect(FUEL_CREDITS_PER_UNIT).toBe(20);
  });
});

describe("Fuel-sourcing restructure — the free localFuelRun bootstrap mission", () => {
  it("is FIRST in mission display order (the starter)", () => {
    expect(Object.keys(MISSIONS)[0]).toBe("localFuelRun");
  });

  it("yields Deuterium Ice ONLY: common = deuteriumIce, uncommonChance/rareChance both 0", () => {
    const m = MISSIONS.localFuelRun;
    expect(m.lootTable.common).toBe("deuteriumIce");
    expect(m.primaryMaterial).toBe("deuteriumIce");
    expect(m.uncommonChance).toBe(0);
    expect(m.rareChance).toBe(0);
  });

  it("costs NO fuel: 0 transit both ways -> fuelNeeded 0 for every hull", () => {
    expect(MISSIONS.localFuelRun.transitOutTicks).toBe(0);
    expect(MISSIONS.localFuelRun.transitBackTicks).toBe(0);
    for (const hullKey of Object.keys(SHIP_TYPES) as (keyof typeof SHIP_TYPES)[]) {
      expect(fuelNeeded(MISSIONS.localFuelRun, SHIP_TYPES[hullKey])).toBe(0);
    }
  });

  it("is available from a fresh save (unlockLevel 1) with NO capability gates", () => {
    const m = MISSIONS.localFuelRun;
    expect(m.unlockLevel).toBe(1);
    // The bootstrap must be flyable by a fresh level-1 captain in the starter Freighter.
    expect(m.requiresCaptainLevel).toBeUndefined();
    expect(m.requiresCargoCapacity).toBeUndefined();
    expect(m.tier).toBe("I"); // renders under the Operations tier-I list
  });

  it("has an INTEGER per-tick XP rate (closed-form parity trap)", () => {
    expect(Number.isInteger(BASE_XP_PER_TICK.localFuelRun)).toBe(true);
    expect(Number.isInteger(MISSIONS.localFuelRun.fleetAdminXpPerTick)).toBe(true);
  });
});

describe("requiredTicksForPhase", () => {
  it("ordersReceived is always exactly 1 tick", () => {
    expect(requiredTicksForPhase("ordersReceived", MISSIONS.shortOreRun)).toBe(1);
  });

  it("transitOut/transitBack/unloading match the mission definition directly", () => {
    expect(requiredTicksForPhase("transitOut", MISSIONS.shortOreRun)).toBe(25);
    expect(requiredTicksForPhase("transitBack", MISSIONS.shortOreRun)).toBe(25);
    expect(requiredTicksForPhase("unloading", MISSIONS.shortOreRun)).toBe(8);
  });

  it("extracting is cargoCapacity / extractionRatePerTick, rounded up", () => {
    // 90 / 1 = exactly 90 -- both cargoCapacity and extractionRatePerTick were
    // rescaled 10x down together (Extraction Rework regression fix), keeping the
    // resulting phase length unchanged at 90 ticks.
    expect(requiredTicksForPhase("extracting", MISSIONS.shortOreRun)).toBe(90);
  });
});

// (The "RECIPES — launch set" block was REMOVED in Phase 4, Task F5 with the
//  legacy instant-craft table it covered. Timed-craft coverage: fabricator.test.ts.)

describe("xpForNextLevel", () => {
  // Task 4 (Progression Pacing Rework) steepened the captain curve from
  // 100*level to 300*level to slow early-game leveling now that XP accrues
  // per active tick rather than as a lump per completed mission cycle.
  it("grows linearly at 300 per level (300 at level 1, 600 at level 2, 900 at level 3)", () => {
    expect(xpForNextLevel(1)).toBe(300);
    expect(xpForNextLevel(2)).toBe(600);
    expect(xpForNextLevel(3)).toBe(900);
  });
});

describe("xpForNextFleetAdminLevel", () => {
  // Progression Pacing Rework: the curve was rescaled from 2500*level^2 to
  // 375000*level^2. The factor (150) is the PARITY factor -- same method the
  // captain curve used (cycle ticks / old XP-per-cycle): old FA income was 1 per
  // cycle over the 149-tick short cycle, so 149/1 = 149 -> 2500*149 = 372,500,
  // rounded to a clean 375000. The curve is scaled to PRESERVE the old FA pace,
  // NOT to absorb the new income as a boost (that boost is deferred to other
  // planned FA XP sources). These are DEVICE-TUNED STARTING VALUES -- the
  // assertions below pin the chosen scale/shape, not a final balance.

  // Concrete sanity values at the chosen parity scale (quadratic: 375000*level^2).
  it("scales quadratically at 375000*level^2 (375k at L1, 1.5M at L2, 3.375M at L3)", () => {
    expect(xpForNextFleetAdminLevel(1)).toBe(375_000);
    expect(xpForNextFleetAdminLevel(2)).toBe(1_500_000);
    expect(xpForNextFleetAdminLevel(3)).toBe(3_375_000);
  });

  // Strictly monotonic increasing: every level costs more than the one before.
  it("is strictly monotonic increasing across levels 1..20", () => {
    for (let level = 1; level < 20; level++) {
      expect(xpForNextFleetAdminLevel(level + 1)).toBeGreaterThan(
        xpForNextFleetAdminLevel(level),
      );
    }
  });

  // Fast-early-slow-later SHAPE: the per-level INCREMENT grows with level, so
  // higher levels cost disproportionately more than lower ones (a flat/linear
  // curve would have a constant increment; this one accelerates).
  it("has a growing per-level increment (later levels cost disproportionately more)", () => {
    // increment(N) = cost(N+1) - cost(N) = 375000*((N+1)^2 - N^2) = 375000*(2N+1)
    for (let level = 1; level < 20; level++) {
      const incrementHere =
        xpForNextFleetAdminLevel(level + 1) - xpForNextFleetAdminLevel(level);
      const incrementNext =
        xpForNextFleetAdminLevel(level + 2) - xpForNextFleetAdminLevel(level + 1);
      expect(incrementNext).toBeGreaterThan(incrementHere);
    }
    // Pin a couple of concrete increments at the chosen scale.
    expect(
      xpForNextFleetAdminLevel(2) - xpForNextFleetAdminLevel(1),
    ).toBe(1_125_000); // 375000*(2*1+1)
    expect(
      xpForNextFleetAdminLevel(3) - xpForNextFleetAdminLevel(2),
    ).toBe(1_875_000); // 375000*(2*2+1)
  });

  // Rough pacing sanity (ballpark, NOT exact -- kept loose to avoid brittleness):
  // FA XP now accrues at ~1/tick per ACTIVE captain (Task 5). At a single active
  // captain (~1 FA XP/tick) reaching level 2 must cost the L1 threshold in ticks,
  // which should land "on the order of" hundreds of thousands of ticks -- slower
  // than a trivial grind but reachable in a session with a few active captains
  // (N captains ≈ divide the tick count by N). This encodes the parity scale
  // intent (375k at L1) without pinning a fragile exact wall-clock number.
  it("takes on the order of hundreds of thousands of ticks to reach level 2 at ~1 FA XP/tick", () => {
    const ticksToLevel2AtOnePerTick = xpForNextFleetAdminLevel(1); // 1 FA XP/tick => cost == ticks
    expect(ticksToLevel2AtOnePerTick).toBeGreaterThan(100_000);
    expect(ticksToLevel2AtOnePerTick).toBeLessThan(1_000_000);
  });
});

describe("CAPTAIN_TALENTS — launch set", () => {
  // Radial Skill Web (Task 2) rewrote this table: the old five-column
  // (command/tactical/science/resourcefulness/diplomacy) linear model is gone.
  // Only the three radial branches remain -- resourcefulness ("Prospector") is
  // the rich tree; tactical ("Tactician") and science ("Explorer") ship as a
  // single gateway hub each until their combat/science systems exist. The old
  // ex-command extraction talents were re-homed under resourcefulness.
  it("Resourcefulness is the rich branch; Tactical/Science are hub-only stubs", () => {
    const branches = Object.values(CAPTAIN_TALENTS).map((t) => t.branch);
    // resourcefulness carries the hub + 6 content nodes = 7 total.
    expect(branches.filter((b) => b === "resourcefulness").length).toBe(7);
    // tactical/science are just their hub (1 each) -- lean stub, not empty.
    expect(branches.filter((b) => b === "tactical").length).toBe(1);
    expect(branches.filter((b) => b === "science").length).toBe(1);
  });

  it("re-homed ex-command extraction talents now live under resourcefulness", () => {
    // Bulk Extraction -> Refined Extraction moved off the deleted `command`
    // branch onto resourcefulness (extraction yield fits the Prospector theme).
    expect(CAPTAIN_TALENTS.prospectorBulkExtraction.branch).toBe("resourcefulness");
    expect(CAPTAIN_TALENTS.prospectorBulkExtraction.effect).toEqual({ type: "commonYieldMult", mult: 0.1 });
    expect(CAPTAIN_TALENTS.prospectorRefinedExtraction.branch).toBe("resourcefulness");
    expect(CAPTAIN_TALENTS.prospectorRefinedExtraction.effect).toEqual({ type: "uncommonYieldMult", mult: 0.15 });
  });

  it("Resourcefulness has exactly 1 bonusRollChance node and 1 bonusRollChanceMult node", () => {
    const bonusRollChanceNodes = Object.values(CAPTAIN_TALENTS).filter((t) => t.effect.type === "bonusRollChance");
    const bonusRollChanceMultNodes = Object.values(CAPTAIN_TALENTS).filter((t) => t.effect.type === "bonusRollChanceMult");
    expect(bonusRollChanceNodes).toHaveLength(1);
    expect(bonusRollChanceMultNodes).toHaveLength(1);
  });

  it("Lucky Strike I/II have the expected cost, adjacency chain, and effect values", () => {
    // Prerequisite chains are gone -- ordering is now expressed via `neighbors`
    // adjacency (the fog-of-war/buy-gate walks this instead of a `requires` link).
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeI.cost).toBe(6);
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeI.neighbors).toContain("prospectorKeenEyeII");
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeI.effect).toEqual({ type: "bonusRollChance", chance: 0.02 });

    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeII.cost).toBe(8);
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeII.neighbors).toContain("prospectorLuckyStrikeI");
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeII.effect).toEqual({ type: "bonusRollChanceMult", mult: 1.0 });
  });

  it("every CAPTAIN_TALENTS entry has non-empty flavor text", () => {
    for (const talent of Object.values(CAPTAIN_TALENTS)) {
      expect(talent.flavor.length).toBeGreaterThan(0);
    }
  });
});

describe("HOMEWORLD_TALENTS — launch set", () => {
  // Radial Skill Web (Task 3) rewrote this table into a radial graph: every
  // category now has at least its hub, so no category is literally empty
  // anymore. Homeland Defense / Citizenry are HUB-ONLY (a "learn me first"
  // gateway, not zero entries) until their defense/population systems exist;
  // Fleet Logistics is the rich category (hub + slot chain + yield); Economy
  // and Industry carry hub + one content node each.
  it("Fleet Logistics is the rich category; Homeland Defense/Citizenry are hub-only stubs", () => {
    const branches = Object.values(HOMEWORLD_TALENTS).map((t) => t.branch);
    // fleetLogistics: hub + Slot1/2/3 + Yield = 5 total.
    expect(branches.filter((b) => b === "fleetLogistics").length).toBe(5);
    // economy/industry: hub + 1 content node each = 2 total.
    expect(branches.filter((b) => b === "economy").length).toBe(2);
    expect(branches.filter((b) => b === "industry").length).toBe(2);
    // homelandDefense/citizenry: just their hub (1 each) -- lean stub, not empty.
    expect(branches.filter((b) => b === "homelandDefense").length).toBe(1);
    expect(branches.filter((b) => b === "citizenry").length).toBe(1);
  });

  it("Fleet Logistics has exactly 3 unlockCaptainSlot nodes, matching the original 3-tier slot-unlock design", () => {
    const slotNodes = Object.values(HOMEWORLD_TALENTS).filter((t) => t.effect.type === "unlockCaptainSlot");
    expect(slotNodes).toHaveLength(3);
  });

  // Progression Pacing Rework (Task 11): MAX_UNLOCKABLE_CAPTAINS is the derived
  // ceiling the captain-list UI uses to split empty slots into "Locked" (exists,
  // gated) vs "Coming Soon" (no unlock path). It must equal 1 base captain plus
  // the number of unlockCaptainSlot nodes -- i.e. 4 today. This pins the
  // derivation so a stray hardcode or an accidental extra slot node is caught.
  it("MAX_UNLOCKABLE_CAPTAINS = 1 base captain + the unlockCaptainSlot node count (4 today)", () => {
    const slotNodeCount = Object.values(HOMEWORLD_TALENTS).filter(
      (t) => t.effect.type === "unlockCaptainSlot",
    ).length;
    expect(MAX_UNLOCKABLE_CAPTAINS).toBe(1 + slotNodeCount);
    expect(MAX_UNLOCKABLE_CAPTAINS).toBe(4);
  });

  it("every HOMEWORLD_TALENTS entry has non-empty flavor text", () => {
    for (const talent of Object.values(HOMEWORLD_TALENTS)) {
      expect(talent.flavor.length).toBeGreaterThan(0);
    }
  });
});

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 1):
// the talent def shape moves from a linear `requires` chain to a graph -- each
// def now carries web-space coordinates (x/y) and an adjacency list
// (neighbors), and the old `requires` field is gone. This structural test is
// the durable spec for that shape change; the data tables that satisfy it are
// rewritten in Tasks 2-3, so this test is intentionally red until then.
describe("Radial Skill Web — talent def graph shape", () => {
  it("every talent def carries graph fields (x, y, neighbors) and no requires", () => {
    for (const def of Object.values(CAPTAIN_TALENTS)) {
      expect(typeof def.x).toBe("number");
      expect(typeof def.y).toBe("number");
      expect(Array.isArray(def.neighbors)).toBe(true);
      expect("requires" in def).toBe(false);
    }
    for (const def of Object.values(HOMEWORLD_TALENTS)) {
      expect(typeof def.x).toBe("number");
      expect(typeof def.y).toBe("number");
      expect(Array.isArray(def.neighbors)).toBe(true);
      expect("requires" in def).toBe(false);
    }
  });
});

// Radial Skill Web (Task 2): graph-integrity invariants for the CAPTAIN_TALENTS
// table specifically. These are the four structural rules the fog-of-war
// reveal (Task 4) and adjacency buy-gating (Task 5) depend on being true:
//   1. Exactly ONE hub per branch -- the always-visible seed each branch's
//      reveal starts from (a branch with zero hubs would render blank; two
//      would give an ambiguous seed).
//   2. Every `neighbors` entry RESOLVES to a real key (no dangling adjacency).
//   3. Adjacency is SAME-BRANCH (the web never draws a connector across
//      branches -- each spec is its own isolated graph).
//   4. Adjacency is SYMMETRIC (if A lists B, B lists A) -- connectors are
//      undirected and the reveal walks both directions, so a one-way link
//      would render/behave inconsistently.
// This is the durable spec for the Task 2 data rewrite.
describe("Radial Skill Web — CAPTAIN_TALENTS graph integrity", () => {
  it("exactly one hub per branch, symmetric adjacency, all neighbors resolve same-branch", () => {
    const keys = Object.keys(CAPTAIN_TALENTS) as CaptainTalentKey[];
    const branches = new Set(Object.values(CAPTAIN_TALENTS).map((d) => d.branch));
    for (const branch of branches) {
      const hubs = keys.filter((k) => CAPTAIN_TALENTS[k].branch === branch && CAPTAIN_TALENTS[k].isHub);
      expect(hubs.length).toBe(1); // one seed per branch
    }
    for (const k of keys) {
      for (const n of CAPTAIN_TALENTS[k].neighbors) {
        expect(CAPTAIN_TALENTS[n]).toBeDefined(); // resolves
        expect(CAPTAIN_TALENTS[n].branch).toBe(CAPTAIN_TALENTS[k].branch); // same branch
        expect(CAPTAIN_TALENTS[n].neighbors).toContain(k); // symmetric
      }
    }
  });
});

// Radial Skill Web (Task 3): the same graph-integrity invariants as the captain
// test above, now for HOMEWORLD_TALENTS -- PLUS the Task 3 preservation rule.
// The four structural rules (one hub per category, neighbors resolve, same
// category, symmetric) are what the fog-of-war reveal (Task 4) and adjacency
// buy-gating (Task 5) depend on. The extra assertion here guards the CRITICAL
// constraint that every pre-existing (v14) homeworld key string survives the
// rewrite UNCHANGED -- existing saves' unlockedHomeworldTalents reference these
// strings and Task 6's migration deliberately does NOT refund homeworld talents
// because they survive by key, so a rename here would silently break real saves.
describe("Radial Skill Web — HOMEWORLD_TALENTS graph integrity", () => {
  it("all v14 keys preserved + one hub per category, symmetric adjacency, all neighbors resolve same-category", () => {
    // 1. Every pre-existing key string still defined (the preservation rule).
    for (const k of [
      "fleetLogisticsSlot1",
      "fleetLogisticsSlot2",
      "fleetLogisticsSlot3",
      "fleetLogisticsYield",
      "industryBonusOutput",
      "economyTrickle",
    ]) {
      expect((HOMEWORLD_TALENTS as any)[k]).toBeDefined();
    }

    const keys = Object.keys(HOMEWORLD_TALENTS) as HomeworldTalentKey[];

    // 2. Exactly one hub per category (5 categories -> 5 hubs total).
    const cats = ["fleetLogistics", "homelandDefense", "citizenry", "economy", "industry"];
    for (const cat of cats) {
      const hubs = keys.filter((k) => HOMEWORLD_TALENTS[k].branch === cat && HOMEWORLD_TALENTS[k].isHub);
      expect(hubs.length).toBe(1); // one seed per category
    }
    const totalHubs = keys.filter((k) => HOMEWORLD_TALENTS[k].isHub).length;
    expect(totalHubs).toBe(5);

    // 3-4. Every neighbor resolves, is same-category, and adjacency is symmetric.
    for (const k of keys) {
      for (const n of HOMEWORLD_TALENTS[k].neighbors) {
        expect(HOMEWORLD_TALENTS[n]).toBeDefined(); // resolves
        expect(HOMEWORLD_TALENTS[n].branch).toBe(HOMEWORLD_TALENTS[k].branch); // same category
        expect(HOMEWORLD_TALENTS[n].neighbors).toContain(k); // symmetric
      }
    }
  });
});

describe("freshState / freshCaptainStack — talent and Fleet Admiral fields", () => {
  it("a fresh captain has no unlocked talents", () => {
    expect(freshCaptains(1)[0].unlockedCaptainTalents).toEqual([]);
  });

  it("freshState starts Fleet Admiral at level 1, 0 xp, 0 adminPoints, no unlocked Homeworld talents", () => {
    const state = freshState();
    expect(state.fleetAdminXp.equals(0)).toBe(true);
    expect(state.fleetAdminLevel).toBe(1);
    expect(state.adminPoints).toBe(0);
    expect(state.unlockedHomeworldTalents).toEqual([]);
  });

  it("freshState starts credits at 0", () => {
    expect(freshState().credits.equals(0)).toBe(true);
  });
});

// Progression Pacing Rework (Task 1, docs/plans/2026-07-11-progression-pacing-rework-*):
// lifetimeStats is a forward-compat schema reserved NOW so future systems
// (Completions/Achievements) have monotonic lifetime totals to read -- these
// totals CANNOT be back-derived from spent inventory (a player who mined 1000
// ore and crafted it all away still shows 0 in storage), so the counters must
// accrue from a clean-slate zero on a brand-new save. This task ONLY guards the
// freshState zero-init of the schema; nothing increments these counters yet
// (that wiring, and the save migration that backfills old saves, are later
// tasks). The maps start EMPTY ({}) -- a material/mission key only appears once
// it's first recorded -- while the scalar totals start at Decimal(0).
describe("Progression Pacing — freshState.lifetimeStats zero-init", () => {
  it("freshState seeds lifetimeStats with empty maps and Decimal(0) scalar totals", () => {
    const state = freshState();
    // The four per-key tally maps start EMPTY -- no material or mission key is
    // present until the first time it's recorded (a later task's increment).
    expect(state.lifetimeStats.itemsGathered).toEqual({});
    expect(state.lifetimeStats.itemsRefined).toEqual({});
    expect(state.lifetimeStats.itemsCrafted).toEqual({});
    expect(state.lifetimeStats.missionsCompleted).toEqual({});
    // The three scalar lifetime totals start at Decimal(0) -- compared via
    // .equals() (not .toEqual against a plain number), same Decimal convention
    // as every other Decimal-field assertion in this file (see the inventory
    // zero-init test above for the full rationale).
    expect(state.lifetimeStats.creditsEarned.equals(0)).toBe(true);
    expect(state.lifetimeStats.captainXpAwarded.equals(0)).toBe(true);
    expect(state.lifetimeStats.fleetAdminXpAwarded.equals(0)).toBe(true);
  });
});

describe("Captain Specialization — CaptainState.spec and CAPTAIN_SPEC_BONUS", () => {
  it("a fresh captain has no spec chosen", () => {
    expect(freshCaptains(1)[0].spec).toBeNull();
  });

  it("CAPTAIN_SPEC_BONUS has an entry for resourcefulness only", () => {
    // Radial Skill Web (Task 2) dropped the `command` spec bonus along with the
    // command branch itself. resourcefulness ("Prospector") is the only branch
    // with a real spec bonus at launch; tactical/science remain absent until
    // their systems exist (same "not yet a real spec" convention as before).
    expect(CAPTAIN_SPEC_BONUS.resourcefulness).toEqual({ type: "bonusRollChance", chance: 0.01 });
    expect(CAPTAIN_SPEC_BONUS.tactical).toBeUndefined();
    expect(CAPTAIN_SPEC_BONUS.science).toBeUndefined();
  });
});

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 13):
// the selector card tables feeding TreeSelector.svelte. The CRITICAL invariant
// is that each card's `key` EXACTLY matches a real branch/category key, because
// Tasks 14/15 map a focused card straight onto a CaptainTalentBranch /
// HomeworldTalentBranch. A drifted/typo'd key would silently break that
// card->branch mapping, so these tests derive the expected key SETS from the
// real talent tables (not hard-coded literals) -- if a branch/category is ever
// added or renamed, this test forces the card tables to keep pace.
describe("Selector cards — specCards / categoryCards (Task 13)", () => {
  it("specCards has exactly 3 entries keyed to the 3 captain branches", () => {
    expect(specCards).toHaveLength(3);
    // The real captain branches, derived from the talent table itself.
    const captainBranches = new Set(Object.values(CAPTAIN_TALENTS).map((t) => t.branch));
    expect(captainBranches).toEqual(new Set(["resourcefulness", "tactical", "science"]));
    // Every card key is one of those branches, and the set of card keys matches
    // the set of branches exactly (no missing, no extra, no duplicates).
    const cardKeys = specCards.map((c) => c.key);
    expect(new Set(cardKeys)).toEqual(captainBranches);
    expect(cardKeys).toHaveLength(new Set(cardKeys).size); // keys are unique
  });

  it("categoryCards has exactly 5 entries keyed to the 5 homeworld categories", () => {
    expect(categoryCards).toHaveLength(5);
    // The real homeworld categories, derived from the talent table itself.
    const homeworldCategories = new Set(Object.values(HOMEWORLD_TALENTS).map((t) => t.branch));
    expect(homeworldCategories).toEqual(
      new Set(["fleetLogistics", "homelandDefense", "citizenry", "economy", "industry"]),
    );
    const cardKeys = categoryCards.map((c) => c.key);
    expect(new Set(cardKeys)).toEqual(homeworldCategories);
    expect(cardKeys).toHaveLength(new Set(cardKeys).size); // keys are unique
  });

  it("every selector card carries a non-empty title, flavor, and at least one bullet", () => {
    for (const card of [...specCards, ...categoryCards]) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.flavor.length).toBeGreaterThan(0);
      expect(card.bullets.length).toBeGreaterThan(0);
      for (const bullet of card.bullets) {
        expect(bullet.length).toBeGreaterThan(0);
      }
    }
  });
});

// Ships — Stats Foundation (Task 1): the SHIP_TYPES table is the durable spec
// for the 4 real hulls this feature introduces. It only ADDS declarations this
// pass -- nothing consumes SHIP_TYPES yet (GameState wiring, mission math, and
// UI land in later tasks), so this test guards the stat profiles in isolation.
// The three forward buckets (tactician/explorer hull families) are deliberately
// NOT built yet and therefore intentionally NOT asserted here.
describe("SHIP_TYPES", () => {
  it("has the 4 real hulls with the designed stat profiles", () => {
    expect(SHIP_TYPES.generalFreighter.cargoCapacity).toBe(90);
    expect(SHIP_TYPES.generalFreighter.transitSpeedMult).toBe(1.0);
    expect(SHIP_TYPES.generalFreighter.extractionYieldMult).toBe(1.0);
    expect(SHIP_TYPES.generalFreighter.moduleSlots).toBe(1);
    expect(SHIP_TYPES.prospectorHauler.cargoCapacity).toBe(180);
    expect(SHIP_TYPES.prospectorRunner.transitSpeedMult).toBe(1.5);
    expect(SHIP_TYPES.prospectorMiner.extractionYieldMult).toBe(1.35);
    for (const key of Object.keys(SHIP_TYPES) as (keyof typeof SHIP_TYPES)[]) {
      expect(SHIP_TYPES[key].tier).toBe(1);
      expect(SHIP_TYPES[key].cost?.credits).toBeGreaterThan(0);
    }
  });
});

describe("effectiveMissionDef", () => {
  const short = MISSIONS.shortOreRun; // transitOut/Back 25, cargo 90, rate 1

  it("freighter (baseline) leaves the mission unchanged", () => {
    const eff = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "generalFreighter", assignedCaptainId: null }));
    expect(eff.transitOutTicks).toBe(25);
    expect(eff.transitBackTicks).toBe(25);
    expect(eff.cargoCapacity).toBe(90);
  });

  it("runner (1.5x) shortens transit via ceil, hauler (0.8x) lengthens it", () => {
    const runner = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorRunner", assignedCaptainId: null }));
    expect(runner.transitOutTicks).toBe(Math.ceil(25 / 1.5)); // 17
    expect(runner.cargoCapacity).toBe(60);
    const hauler = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorHauler", assignedCaptainId: null }));
    expect(hauler.transitOutTicks).toBe(Math.ceil(25 / 0.8)); // 32
    expect(hauler.cargoCapacity).toBe(180);
  });

  it("does not mutate the base mission", () => {
    effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorHauler", assignedCaptainId: null }));
    expect(MISSIONS.shortOreRun.cargoCapacity).toBe(90);
  });
});

// Ship Production Economy (Phase 1, Task 1): ITEMS is the forward-compat item
// registry the whole epic reads. Phase 1 seeds ONLY the 5 items that exist today
// (the HomePlanetMaterialKey storage keys) -- 3 raw loot tiers + 2 crafted goods.
// Nothing consumes ITEMS yet (inventory migration and discovery land in later
// tasks), so this test guards the seed table in isolation. Later phases grow the
// table with the minor/major-component/module/system tiers -- do NOT add those
// forward entries here until their phase (no placeholders).
describe("ITEMS — Phase 1 seed registry", () => {
  it("has the full scaffolded catalog: 14 raw, 6 refined, 2 minor + 1 major component", () => {
    // Phase 2 Warehouse catalog scaffold grew the registry to 22. The Fuel-sourcing
    // RESTRUCTURE (2026-07-15) adds ONE more raw item -- the dedicated `deuteriumIce`
    // fuel ore (a real, obtainable item via localFuelRun) -- bringing the total to 23.
    // Breakdown of the 23:
    //   raw (14): commonOre, uncommonMaterial, rareMaterial (the 3 live ore tiers),
    //     deuteriumIce (the live fuel ore), denseOre (T2 stub), + 9 future ore/salvage/
    //     forage loot placeholders.
    //   refined (6): the 2 live crafted goods + 4 future Refinery-output placeholders.
    //   minorComponent (2) + majorComponent (1): future Fabricator-output placeholders.
    const keys = Object.keys(ITEMS);
    expect(keys).toHaveLength(23);
    const raw = Object.values(ITEMS).filter((i) => i.category === "raw");
    const refined = Object.values(ITEMS).filter((i) => i.category === "refined");
    const minor = Object.values(ITEMS).filter((i) => i.category === "minorComponent");
    const major = Object.values(ITEMS).filter((i) => i.category === "majorComponent");
    expect(raw).toHaveLength(14);
    expect(refined).toHaveLength(6);
    expect(minor).toHaveLength(2);
    expect(major).toHaveLength(1);

    // Pin the original seed categories directly so a mis-categorized entry is caught.
    expect(ITEMS.commonOre.category).toBe("raw");
    expect(ITEMS.uncommonMaterial.category).toBe("raw");
    expect(ITEMS.rareMaterial.category).toBe("raw");
    expect(ITEMS.denseOre.category).toBe("raw");
    expect(ITEMS.refinedMaterial.category).toBe("refined");
    expect(ITEMS.components.category).toBe("refined");
  });

  // Fuel-sourcing RESTRUCTURE (2026-07-15): F1's LABEL-ONLY renames of commonOre ->
  // "Deuterium Ice" and ferriteOre -> "Titanium" are REVERTED (commonOre is "Titanium
  // Ore" again, ferriteOre is "Ferrite"), because Deuterium Ice is now its OWN dedicated
  // `deuteriumIce` item. Still display-only + no migration: the KEYS never changed across
  // the F1 relabel OR this revert. (The label values are pinned in the restructure describe
  // block above; here we just prove the original keys still resolve.)
  it("ore keys are stable across the F1 relabel + the restructure revert (no re-key, no migration)", () => {
    expect(ITEMS.commonOre).toBeDefined();
    expect(ITEMS.ferriteOre).toBeDefined();
    expect(ITEMS.commonOre.label).toBe("Titanium Ore"); // reverted off F1's "Deuterium Ice"
    expect(ITEMS.ferriteOre.label).toBe("Ferrite"); // reverted off F1's "Titanium"
  });

  // Phase 2, Task B2: the T2 stub ore is the FIRST tier-2 item in the registry. It
  // must be a real, fully-described catalog entry (so it shows as ❓ + hint in the
  // Warehouse) but produced by NOTHING this phase -- the honest "future content"
  // wall gating warehouseT2's first real upgrade. The generic standing-rule test
  // below already checks its metadata is complete; this pins its tier + stub role.
  it("denseOre is a tier-2 raw ore stub with a 'no source yet' unlockHint", () => {
    expect(ITEMS.denseOre).toBeDefined();
    expect(ITEMS.denseOre.tier).toBe(2);
    expect(ITEMS.denseOre.category).toBe("raw");
    expect(ITEMS.denseOre.unlockHint.length).toBeGreaterThan(0);
    // It is unobtainable this phase -- the "naturally gated" stub. The timed refine
    // path (REFINE_RECIPES) keys its output by a forward-loose plain string, so a
    // future recipe COULD target denseOre; guard that none does today, which would
    // break the T2 wall. (The instant RECIPES path can't -- its output.key is the
    // narrow HomePlanetMaterialKey union, which structurally excludes denseOre.)
    for (const recipe of Object.values(REFINE_RECIPES)) {
      expect(recipe.output.itemId).not.toBe("denseOre");
    }
  });

  // DRIFT GUARD: every live inventory material key MUST have a matching ITEMS
  // entry, so the registry can't silently fall out of sync with the balances it's
  // meant to describe. We derive the key list from the REAL inventory object
  // (freshState().inventory) rather than hard-coding it -- so if a later task adds
  // an inventory material key without a corresponding ITEMS entry, this test fails.
  // (Converted from freshState().homePlanet.storage -- Task 6; storage is removed
  // in Task 7. ITEMS is a forward-compat SUPERSET of inventory's seed keys, so this
  // stays a one-directional subset guard: every inventory key must be registered,
  // NOT that every ITEMS key appears in inventory.)
  it("every current inventory material key has an ITEMS entry", () => {
    const inventoryKeys = Object.keys(freshState().inventory);
    for (const key of inventoryKeys) {
      expect(ITEMS[key]).toBeDefined();
    }
  });

  it("every ITEMS entry has a non-empty label and flavor, and a tier >= 1", () => {
    // Phase 2, Task B2 introduced the first tier-2 item (denseOre), so items are no
    // longer all tier 1 -- the invariant is now "a real tier at or above 1" (tier 1
    // is the lowest warehouse tier). The exact tier split is pinned per-item in the
    // registry tests above / the denseOre test.
    for (const item of Object.values(ITEMS)) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.flavor.length).toBeGreaterThan(0);
      expect(item.tier).toBeGreaterThanOrEqual(1);
    }
  });

  // STANDING RULE (Phase 2, Task B1 -- design §3.2 "master catalog"): the
  // Warehouse renders EVERY item as a slot -- ❓ + an unlockHint until discovered,
  // then name/count/rarity-color once seen -- so every item MUST carry the full
  // catalog metadata (tier, category, rarity, unlockHint). This test guards that
  // constraint registry-wide: a future item added WITHOUT complete metadata (e.g.
  // a missing/blank unlockHint, so its ❓ slot would have no how-to-get clue) fails
  // here. Derived by iterating the live ITEMS registry -- no hard-coded key list --
  // so it automatically covers any item added later.
  it("every ITEMS entry carries complete Warehouse catalog metadata (tier/category/rarity/unlockHint)", () => {
    const validCategories = ["raw", "refined", "minorComponent", "majorComponent", "shipModule", "shipSystem"];
    const validRarities = ["common", "uncommon", "rare", "epic", "legendary"];
    for (const [key, item] of Object.entries(ITEMS)) {
      // tier: a real number, at least tier 1 (T1 is the lowest warehouse tier).
      expect(typeof item.tier, `${key}.tier is a number`).toBe("number");
      expect(item.tier, `${key}.tier >= 1`).toBeGreaterThanOrEqual(1);
      // category + rarity: present and a valid member of their respective unions.
      expect(validCategories, `${key}.category is a valid ItemCategory`).toContain(item.category);
      expect(validRarities, `${key}.rarity is a valid ItemRarity`).toContain(item.rarity);
      // unlockHint: a non-empty string -- the ❓-state "how to get this" clue.
      expect(typeof item.unlockHint, `${key}.unlockHint is a string`).toBe("string");
      expect(item.unlockHint.length, `${key}.unlockHint is non-empty`).toBeGreaterThan(0);
    }
  });
});

// Phase 2, Task B2 (design §3.1-§3.3): the tiered Warehouse facilities join the
// FACILITIES table on the SAME Phase 1 framework the Refinery uses. These guard the
// DATA table shape -- the generated rung counts, the derived material costs (75% of
// the cap at each level), the storageCapMult effect on every rung, and the T2 stub's
// unlock cost + denseOre-gated first upgrade. The cap-VALUE derivation (tierCap) and
// the T2 buildability GATE (canBuildFacilityUpgrade) are exercised in tick.test.ts,
// where those functions live.
describe("FACILITIES — tiered Warehouses (Task B2)", () => {
  it("warehouseT1 exists with ~25 generated doubling rungs, all { storageCapMult: 2 } and ungated", () => {
    const wh = FACILITIES.warehouseT1;
    expect(wh).toBeDefined();
    // ~25 rungs (the "effectively infinite / repeatable" doubling track, design §3.3).
    expect(wh.upgrades.length).toBe(25);
    for (const rung of wh.upgrades) {
      // Every rung doubles the tier cap -- the effect tierCap multiplies on read.
      expect(rung.effect).toEqual({ storageCapMult: 2 });
      // T1 is the base tier: every rung is pure cost + time, NO prereq gates.
      expect(rung.requiresFleetAdminLevel).toBeUndefined();
      expect(rung.requiresHomeworldTalents).toBeUndefined();
      expect(rung.durationTicks).toBeGreaterThan(0);
    }
  });

  it("warehouseT1 rung i costs 75% of the cap at level i, in commonOre (spot-check rungs 0,1,2)", () => {
    const up = FACILITIES.warehouseT1.upgrades;
    // cap at level i = 1,000,000 * 2^i; cost = 75% of that.
    // i=0: 0.75 * 1,000,000  = 750,000
    // i=1: 0.75 * 2,000,000  = 1,500,000
    // i=2: 0.75 * 4,000,000  = 3,000,000
    expect(up[0].materials.commonOre.equals(750_000)).toBe(true);
    expect(up[1].materials.commonOre.equals(1_500_000)).toBe(true);
    expect(up[2].materials.commonOre.equals(3_000_000)).toBe(true);
    // The cost is commonOre only (T1's common material), no other input.
    expect(Object.keys(up[0].materials)).toEqual(["commonOre"]);
  });

  it("warehouseT2 is a stub: rung 0 unlocks for 1,000,000 commonOre; rung 1 is gated on denseOre", () => {
    const wh = FACILITIES.warehouseT2;
    expect(wh).toBeDefined();
    // Rung 0 = the tier UNLOCK, priced at 100% of T1's default 1M cap, in commonOre
    // (T1's own ore -> reachable today).
    expect(Object.keys(wh.upgrades[0].materials)).toEqual(["commonOre"]);
    expect(wh.upgrades[0].materials.commonOre.equals(1_000_000)).toBe(true);
    // Rung 1 = the first REAL upgrade, priced in the unobtainable T2 ore -> a natural
    // wall (no explicit requires* gate; the missing input IS the gate).
    expect(Object.keys(wh.upgrades[1].materials)).toEqual(["denseOre"]);
    expect(wh.upgrades[1].materials.denseOre.gt(0)).toBe(true);
  });
});
