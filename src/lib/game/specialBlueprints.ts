// specialBlueprints.ts: Gas Giant Study GG-7 (0.14.0), the crafting uses of the Gas Storage Canisters and the three
// SPECIAL BLUEPRINTS. Plan docs/plans/2026-10-17-gas-giant-study-plan.md section GG-7 and its USER ANSWERS:
//   call 7 "Drives + Lab blueprints": canisters feed the G2 drive classes (Deuterium Class III+, the Antimatter
//     Containment Cell Class VI and VII: model.ts DRIVE_CLASS_BLUEPRINTS, built by G2-4) and the Lab tier 3 to 7
//     blueprints (Hydrogen, Methane, Ammonia in sensor and quarters modules), and stay sellable;
//   call 10 "One lane": an Ancient Data Fragment's study decodes the next entry of its culture; some entries unlock
//     special blueprints (BlueprintDef.requiresDecode, read through model.ts blueprintDecodeLocked);
//   call 11 "Three now": Ramscoop Collector, Pressure-Forged Plating and Resonance Sensor Array in 0.14.0 (the
//     Annihilation Core moves to 0.14.x with the burn); the Ramscoop BOOSTS the nebula sweep, never gates it;
//   recipe realism audit call 3 "Resonance Sensor Array": Helium-3 goes in NO Reactor Core in 0.14.0; its consumer is
//     the Resonance Sensor Array (1 Helium-3 Canister); call 14 "Approve": Quarters take Ammonia and Hydrogen.
// The signed-off v3 mockup (2026-10-21, "approve all 4 mockups as is", section 4) draws the three cards on Lab tiers III,
// IV and V with "Boosts the nebula sweep: bigger, faster hauls. Never a gate." on the Ramscoop.
//
// A LEAF: no imports, so model.ts (the blueprints and the plating variety), shipModules.ts (the Ramscoop module) and
// sensorArrays.ts (the Resonance array) all read ONE table without a cycle.

// The three special blueprints, in the mockup's card order.
export const SPECIAL_BLUEPRINT_KEYS = ["pressureForgedPlatingBp", "ramscoopCollectorBp", "resonanceSensorArrayBp"] as const;
export type SpecialBlueprintKey = (typeof SPECIAL_BLUEPRINT_KEYS)[number];

// The ids their pieces mint as (a slot variety each, on an existing slot: Hull Plating, the universal module slot, the
// sensor slot).
export const PRESSURE_FORGED_PLATING_VARIETY = "pressureForgedPlating";
export const RAMSCOOP_COLLECTOR_MODULE = "ramscoopCollector";
export const RESONANCE_SENSOR_ARRAY = "sensorResonance";

// [PROVISIONAL] every GG-7 number no answer names, in ONE place (the plan's "FIRST-PASS TUNABLE"; the balancing patch
// owns them).
//   decodeEntry: the ancient entries ONE culture must have decoded before each special blueprint can be researched
//     (the GG-5 gate, model.ts blueprintDecodeLocked: the most entries of any one culture). The mockup's sample
//     cards read "Entry 3" and "Entry 5" with entries 1 and 2 drawn from identified relics; relics decode no entry in
//     the built engine (only an Ancient Data Fragment does), so the first pass opens them at 1, 2 and 3.
//   costs: research and craft costs by Lab tier, the Class III to V drives' (model.ts DRIVE_CLASS_BLUEPRINTS).
//   pressureForgedPlating: the variety's stat lean on the Hull Plating slot (its existing lines): structure first,
//     then kinetic dampening (diamond-hard layers shrug off impacts), a little ablative armor.
//   ramscoopCollector: the nebula sweep boost at Standard quality 0 (scaled by the piece's rarity and quality,
//     model.ts moduleEffectScale): the sweep's canisters x (1 + it) and its length / (1 + it) (the v2 mockup's x1.5
//     "bigger hauls, faster sweeps"), and the module's power draw.
//   resonanceSensorArray: the canister band lift at Standard quality 0 (user 2026-10-27, "Better canister odds"): a gas
//     giant study by a ship carrying it rolls its canisters' bands with the Augmented and Stellar odds x (1 + it), the
//     Standard odds giving way (gasGiantStudy.ts liftedBandOdds). It reads a giant's depths from orbit, the way Juno
//     reads Jupiter's interior, so it finds the richer layers.
//   eliteQuartersCanisters: the canisters the Lab tier III Elite Quarters recipe adds (audit call 14).
export const GG7_NUMBERS = {
  decodeEntry: { pressureForgedPlatingBp: 1, ramscoopCollectorBp: 2, resonanceSensorArrayBp: 3 } as Readonly<Record<SpecialBlueprintKey, number>>,
  costs: {
    3: { ticks: 200, credits: 6_000, craft: 480 },
    4: { ticks: 260, credits: 12_000, craft: 600 },
    5: { ticks: 320, credits: 24_000, craft: 720 },
  },
  pressureForgedPlating: { hullStrength: 0.55, kineticDampening: 0.35, ablativeArmor: 0.1 },
  ramscoopCollector: { nebulaSweep: 0.5, powerDraw: 6 },
  resonanceSensorArray: { canisterBandLift: 0.5 },
  eliteQuartersCanisters: { ammoniaCanister: 1, hydrogenCanister: 1 },
} as const;

// Each special blueprint's Lab tier (the signed-off mockup: III, IV, V).
export const SPECIAL_BLUEPRINT_TIER: Readonly<Record<SpecialBlueprintKey, 3 | 4 | 5>> = {
  pressureForgedPlatingBp: 3,
  ramscoopCollectorBp: 4,
  resonanceSensorArrayBp: 5,
};
