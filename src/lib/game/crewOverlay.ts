// Crew 0.14.0 ("CREW GOES LIVE"): the SINGLE crew -> ship-stat overlay + the per-tick crew engine.
//
// This is the parity-critical wiring layer that finally makes the (previously dormant) crew stack
// affect the game. It has ONE job split three ways, and it is the ONE source of truth for every one:
//
//   1. effectiveShipStats(state, ship): the crew-boosted derived stats. It computes the PURE
//      shipDerivedStats(ship, equippedFor(state, ship)) fold and then layers the ship's crew
//      contribution on top as an OVERLAY (mirroring the engineEfficiency overlay economyTick already
//      does at the fuelPerCycle seam). shipDerivedStats itself stays crew-free + pure; the crew fold
//      lives here so LIVE, OFFLINE, PATROL, and the fuel/range gates all read ONE crew-boosted number.
//      Every consumer of a ship's derived stats routes through this, so crew is applied consistently
//      (inconsistent application across sites is the top bug risk this module exists to prevent).
//
//   2. shipCrewContribution(state, ship): a ship's combined crew modifier map, keyed by the crew.*
//      stat vocabulary (crewBuffs.ts CREW_STAT_KEYS). It sums the COMPLEMENT rollup (rollupBuckets over
//      ship.complement) and every assigned OFFICER's two bonuses + racial into one { crew.*: number }.
//
//   3. resolveCrew(state): the per-tick crew engine. It delivers due transport batches into the pool
//      and auto-crews PASSIVE ships within the command-structure caps. Called ONCE per whole tick from
//      economyTick (the one seam tick()'s offline loop and App.svelte's live loop both drive at
//      economyTick(_,1) cadence), so offline catch-up and live play stay identical BY CONSTRUCTION.
//
// ⚠️ PARITY IS PARAMOUNT. Every crew mutation and every crew-derived stat is deterministic: the
// underlying crew logic is seeded + gameTimeSeconds-window based, and NOTHING here reads Date.now() or
// Math.random. Transports key on a game-time window ACCUMULATOR (deliverDueTransports), so one big
// offline catch-up delivers the exact backlog the equivalent live ticks would; auto-crew is RNG-free
// and deterministic in (pool order, caps). See docs/plans/2026-09-22-crew-0.14.0-plan.md
// ("Engine seams" 1/4/5).

import type { GameState, ShipInstance, ShipDerivedStats, SeniorStaffOfficer, CrewSignature, CrewBucket } from "./model";
import { shipDerivedStats } from "./model";
import { equippedFor } from "./equipment";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { contributionForSignature, rollupBuckets, totalCrew } from "./crew";
import { officerRacialBonus } from "./seniorStaff";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { crewTransportsDue, deliverDueTransports } from "./transports";
import { autoCrewShip } from "./autoCrew";
import {
  installedQuartersModule,
  installedBridgeModule,
  quartersProfessionMultiplier,
  bridgeOfficerMultiplier,
  quartersCapacityBonus,
  hullSpecOf,
} from "./crewModules";
// Exploration 0.14.0 (Phase E4b): the account-level MUSEUM bonuses (relics.ts). relics.ts imports only
// TYPES from model.ts + the leaf PRNG, so this import adds no cycle.
import { museumBonuses, type MuseumStat } from "./relics";

// ============================================================================
// crew.* -> ship-stat mapping (FIRST-PASS, TUNABLE)
// ============================================================================
//
// The crew rollup + officer fold produce a { crew.*: number } modifier map (fractional bonuses, e.g.
// 0.02 == +2%). applyCrewOverlay reads ONLY the keys that have a REAL consumer today and folds them
// onto ShipDerivedStats; every other crew.* key (surveyAptitude, sensors, boardingDefense,
// awayTeamProtection, crewOutputMult, craftDuplicateChance, missionTurnaround, preventCrewLoss,
// counterInfiltration, droneHandling, rareFindChance, crewEffectiveness, reducedCrewLosses, triage,
// powerEfficiency, hullRepairRate, endurance, ...) is a NO-OP for now: its system has not landed, so it
// maps to NOTHING and lies dormant until it does. The mapping table:
//
//   crew.transitOutSpeed + crew.transitBackSpeed -> transitSpeedMult   (both legs share one speed mult)
//   crew.rangeEfficiency  + crew.fuelEfficiency  -> engineEfficiency   (0-based additive fuel-burn bonus)
//   crew.effectiveCargo                          -> cargoCapacity      (multiplicative)
//   crew.extractionYield                         -> extractionYieldMult (multiplicative)
//   crew.unloadSpeed                             -> unloadSpeedMult    (divides unloadTicks in effectiveMissionDef)
//
// hullRepairRate + the combat keys map to NOTHING here on purpose: hull repair is a Shipyard timed
// process (not a shipDerivedStats consumer) and combat power stays on installed combat gear so crew
// never DOUBLE-DIPS weapons/shields (locked design). They become live when/if a derived-stats consumer
// for them exists. All magnitudes above are first-pass; retuning happens in a later balance phase.

// Maps an OFFICER bonus's own broader `officer.*` stat vocabulary (seniorStaffBonuses.ts) onto the
// crew.* key it corresponds to, so officer bonuses and complement buffs accumulate into ONE map. A
// value of null means "no crew.* equivalent / no consumer yet" -> the officer bonus is dormant (its
// system, e.g. combat or morale, is not wired to a derived stat). Unknown officer statKeys are treated
// as null too (defensive).
const OFFICER_STATKEY_TO_CREW: Record<string, string | null> = {
  "officer.transitTimeCut": CREW_STAT_KEYS.transitOutSpeed, // a sweeping transit cut == a speed lift
  "officer.effectiveCargoMult": CREW_STAT_KEYS.effectiveCargo,
  "officer.extractionYieldMult": CREW_STAT_KEYS.extractionYield,
  "officer.unloadTimeCut": CREW_STAT_KEYS.unloadSpeed,
  "officer.rangeMult": CREW_STAT_KEYS.rangeEfficiency,
  "officer.powerEfficiencyMult": CREW_STAT_KEYS.powerEfficiency, // dormant (no power-budget consumer yet)
  "officer.repairRateMult": CREW_STAT_KEYS.hullRepairRate, // dormant (repair is a Shipyard process)
  "officer.rareFindMult": CREW_STAT_KEYS.rareFindChance, // dormant (no rare-find consumer yet)
  "officer.shipOutputMult": CREW_STAT_KEYS.crewOutputMult, // dormant (no ship-wide-output consumer yet)
  "officer.allStatsMult": CREW_STAT_KEYS.crewOutputMult, // dormant
  "officer.missionTurnaroundCut": CREW_STAT_KEYS.missionTurnaround, // dormant
  "officer.crewLossPrevention": CREW_STAT_KEYS.preventCrewLoss, // dormant
  "officer.crewRetention": null, // dormant (no attrition system yet)
  "officer.evasion": null, // no crew.* stat: the expedition encounter chance reads it directly (officerBonusTotal, Task 14); ship-battle evasion is Task 20
  "officer.weaponEffectivenessMult": null, // dormant (crew never double-dips weapons)
  "officer.shieldEffectivenessMult": null, // dormant (crew never double-dips shields)
};

// ============================================================================
// The overlay (pure)
// ============================================================================

// Fold a ship's combined crew modifier map onto its base (hull + equipment) derived stats. PURE. The
// crew map is what shipCrewContribution produces; base is what shipDerivedStats produces.
//
// ADDITIVE-NEUTRAL: with no MAPPED crew contribution (an empty complement + no assigned officers, or
// only contributions to dormant keys) every mapped sum is 0 and this returns the SAME base object
// unchanged, so a crew-free ship's stats are byte-identical to today. Only when a mapped key is
// non-zero does it return a fresh, overlaid object.
export function applyCrewOverlay(base: ShipDerivedStats, crew: Record<string, number>): ShipDerivedStats {
  const transit = (crew[CREW_STAT_KEYS.transitOutSpeed] ?? 0) + (crew[CREW_STAT_KEYS.transitBackSpeed] ?? 0);
  const range = (crew[CREW_STAT_KEYS.rangeEfficiency] ?? 0) + (crew[CREW_STAT_KEYS.fuelEfficiency] ?? 0);
  const cargo = crew[CREW_STAT_KEYS.effectiveCargo] ?? 0;
  const extraction = crew[CREW_STAT_KEYS.extractionYield] ?? 0;
  const unload = crew[CREW_STAT_KEYS.unloadSpeed] ?? 0;

  // Neutral fast path: nothing mapped -> identity (same reference), the byte-identical guarantee.
  if (transit === 0 && range === 0 && cargo === 0 && extraction === 0 && unload === 0) return base;

  return {
    ...base,
    cargoCapacity: base.cargoCapacity * (1 + cargo),
    transitSpeedMult: base.transitSpeedMult * (1 + transit),
    extractionYieldMult: base.extractionYieldMult * (1 + extraction),
    // engineEfficiency is a 0-based ADDITIVE bonus (fuel.ts), so crew range ADDS to it exactly the way
    // the equipment fold adds its engine boost, rather than multiplying a possibly-0 base into nothing.
    engineEfficiency: base.engineEfficiency + range,
    // unloadSpeedMult DIVIDES unloadTicks in effectiveMissionDef (>1 = faster). Compose multiplicatively
    // with whatever was already there (undefined -> 1).
    unloadSpeedMult: (base.unloadSpeedMult ?? 1) * (1 + unload),
  };
}

// ============================================================================
// A ship's combined crew contribution (pure)
// ============================================================================

// Sum a ship's COMPLEMENT rollup + every OFFICER assigned to it into one { crew.*: number } modifier
// map. PURE: reads state.officers + ship.complement + the static catalogs, mutates nothing.
//
// Exploration 0.14.0 (Phase E4b): the museum's `crewBonuses` stat AMPLIFIES every crew contribution
// fleet-wide: each per-stat delta in the finished map is multiplied by (1 + crewBonuses) before the
// overlay applies it (see scaleCrewContribution). `museum` is optional so a caller that already holds
// the bonuses (effectiveShipStats) does not recompute them; omitted, it is read off `state`. With an
// empty museum crewBonuses is 0 and the map is returned UNTOUCHED (no scaling pass at all), so every
// crew number stays byte-identical to E4a.
export function shipCrewContribution(
  state: GameState,
  ship: ShipInstance,
  museum: Readonly<Record<MuseumStat, number>> = museumBonuses(state),
): Record<string, number> {
  return scaleCrewContribution(rawShipCrewContribution(state, ship), museum.crewBonuses);
}

// Multiply every crew.* delta by (1 + crewBonus). crewBonus 0 returns the SAME map (no copy, no float
// op), the additive-neutral guarantee. Pure: never mutates the input map.
export function scaleCrewContribution(crew: Record<string, number>, crewBonus: number): Record<string, number> {
  if (crewBonus === 0) return crew;
  const scaled: Record<string, number> = {};
  for (const key of Object.keys(crew)) scaled[key] = crew[key] * (1 + crewBonus);
  return scaled;
}

// The UN-amplified crew contribution (the pre-E4b body of shipCrewContribution, unchanged).
function rawShipCrewContribution(state: GameState, ship: ShipInstance): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (key: string, value: number): void => {
    if (value === 0) return;
    out[key] = (out[key] ?? 0) + value;
  };

  // --- Crew MODULES (Phase 1b): the installed quarters/bridge modules AMPLIFY the crew stack. Both
  // are null for the universal no-module case, which is what keeps this function byte-identical to the
  // pre-module path: quartersMod null -> the rollup uses the SAME contributionForSignature reference
  // (identical iteration + accumulation order, so no float drift), and bridgeMod null -> the officer
  // multiplier is exactly 1 (x * 1 === x). A module's effect scales with its own rarity/quality
  // (crewModules.ts), per the capacity principle (capacity handled separately in resolveCrew).
  const quartersMod = installedQuartersModule(state, ship);
  const bridgeMod = installedBridgeModule(state, ship);

  // --- Complement + assigned NOTABLE crew: the bucket rollup is keyed by the crew.* vocabulary. A
  // quarters module scales each bucket's contribution by its division's effectiveness multiplier
  // (division-focused boosts its own division at the others' cost; general boosts every division
  // uniformly). With NO module we pass contributionForSignature UNCHANGED, so the rollup is
  // byte-identical to before.
  //
  // GL-1: a NOTABLE crew member assigned to THIS ship (assignedShipId === ship.id, the same authority
  // as officer seating) sits on top of the fungible bucket bulk and contributes exactly like a single
  // crew of its signature, folded through the SAME contrib (so a quarters module amplifies it by
  // division too). ADDITIVE-NEUTRAL: with no assigned notable the bucket list IS the complement's own
  // array (same reference, same iteration + accumulation order), so this stays byte-identical to the
  // pre-GL-1 path for every ship without a pinned notable, and the offline==live parity is preserved
  // (a pure function of state).
  const complement = ship.complement;
  const baseBuckets = complement?.buckets ?? [];
  const assignedNotables = state.notableCrew.filter((n) => (n.assignedShipId ?? null) === ship.id);
  const buckets: CrewBucket[] =
    assignedNotables.length > 0
      ? [
          ...baseBuckets,
          ...assignedNotables.map((n) => ({
            profession: n.profession,
            rarity: n.rarity,
            rank: n.rank,
            race: n.race,
            buff1Id: n.buff1Id,
            buff2Id: n.buff2Id,
            count: 1,
          })),
        ]
      : baseBuckets;
  if (buckets.length > 0) {
    const contrib = quartersMod
      ? (sig: CrewSignature): Record<string, number> => {
          const mult = quartersProfessionMultiplier(quartersMod, sig.profession);
          const base = contributionForSignature(sig);
          if (mult === 1) return base; // no change for this division: keep the base map
          const scaled: Record<string, number> = {};
          for (const k of Object.keys(base)) scaled[k] = base[k] * mult;
          return scaled;
        }
      : contributionForSignature;
    const rollup = rollupBuckets(buckets, contrib);
    for (const key of Object.keys(rollup)) add(key, rollup[key]);
  }

  // --- Senior Staff officers assigned to THIS ship (assignedShipId is the assignment authority).
  const hullSpec = hullSpecOf(ship);
  for (const officer of state.officers) {
    if (officer.assignedShipId !== ship.id) continue;
    // A BRIDGE module amplifies this officer's whole output (both bonuses + the racial). 1 with no
    // bridge module, so the multiply is a no-op and the pre-module numbers are preserved exactly.
    const officerMult = bridgeMod ? bridgeOfficerMultiplier(bridgeMod, officer, hullSpec) : 1;
    // Each of the two rolled bonuses. ⚠️ officer.bonuses[i].magnitude is ALREADY rank-scaled: the
    // generator/promotion bake officerRankMagnitudeFactor(rank) into the stored magnitude (seniorStaff.ts
    // rollCandidate/strengthenBonus), so it is used AS-IS here. Re-multiplying by the rank factor would
    // double-scale it. The bonus's ship-level effect is looked up from the catalog (its officer.* statKey)
    // and mapped onto its crew.* equivalent; a bonus whose system has no consumer yet maps to null (dormant).
    for (const bonus of officer.bonuses) {
      const def = getSeniorStaffBonusById(bonus.id);
      if (!def) continue; // unknown id contributes nothing (defensive; content is closed today)
      const crewKey = OFFICER_STATKEY_TO_CREW[def.statKey];
      if (!crewKey) continue; // no crew.* consumer yet -> dormant
      add(crewKey, bonus.magnitude * officerMult);
    }
    // The officer's strong racial (crew.* keyed already, seniorStaff magnitude).
    const racial = officerRacialBonus(officer);
    add(racial.statKey, racial.magnitude * officerMult);
  }

  return out;
}

// The summed magnitude of every rolled officer bonus whose catalog statKey is `statKey`, across the officers
// assigned to `ship`, amplified by the ship's bridge module exactly as rawShipCrewContribution amplifies
// them (the stored magnitude is already rank-scaled; never re-scaled here). For an officer bonus whose
// consumer reads it DIRECTLY rather than through the crew.* map: E-CREW Task 14 reads Evasive Command
// ("officer.evasion") here for the expedition encounter chance (D12; Task 20 adds the ship-battle half).
// 0 with no such officer. PURE.
export function officerBonusTotal(state: GameState, ship: ShipInstance, statKey: string): number {
  const bridgeMod = installedBridgeModule(state, ship);
  const hullSpec = hullSpecOf(ship);
  let total = 0;
  for (const officer of state.officers) {
    if (officer.assignedShipId !== ship.id) continue;
    for (const bonus of officer.bonuses) {
      if (getSeniorStaffBonusById(bonus.id)?.statKey !== statKey) continue;
      const officerMult = bridgeMod ? bridgeOfficerMultiplier(bridgeMod, officer, hullSpec) : 1;
      total += bonus.magnitude * officerMult;
    }
  }
  return total;
}

// ============================================================================
// The single crew-boosted derived-stats helper (the ONE consumers route through)
// ============================================================================

// A ship's derived stats WITH its crew folded in: the pure hull+equipment fold, overlaid with the
// ship's combined crew contribution. This is the ONE function every consumer of a ship's derived stats
// (economyTick, patrol, dispatch gates, fuel/range) routes through, so crew is applied identically
// everywhere. PURE (reads state + the static tables). With no crew it equals shipDerivedStats(ship,
// equippedFor(...)) exactly (applyCrewOverlay returns base unchanged).
//
// Exploration 0.14.0 (Phase E4b): the account-level MUSEUM overlay is layered LAST, on top of the crew
// result (applyMuseumOverlay). The museum is read ONCE here off `state` and shared with the crew
// amplification (crewBonuses) so both read the same snapshot. Because every engine consumer (economyTick
// missions + patrol, dispatch gates, berths, expedition sensor snapshot) and the UI readout route through
// this one function, the museum's ship-stat bonuses land everywhere at once. With an empty museum both
// overlays are identity (same reference), so the result is byte-identical to E4a.
export function effectiveShipStats(state: GameState, ship: ShipInstance): ShipDerivedStats {
  const base = shipDerivedStats(ship, equippedFor(state, ship.id));
  const museum = museumBonuses(state);
  const crewed = applyCrewOverlay(base, shipCrewContribution(state, ship, museum));
  return applyMuseumOverlay(crewed, museum);
}

// ============================================================================
// The MUSEUM overlay (pure), Exploration 0.14.0 Phase E4b
// ============================================================================
//
// Folds the account-level museum's SHIP-STAT bonuses (fractions, relics.ts museumBonuses) onto a ship's
// derived stats, multiplicatively, AFTER the crew overlay (the museum is fleet-wide, so it scales the
// crew-boosted number):
//
//   cargoCapacity   -> cargoCapacity        x (1 + b)
//   transitSpeed    -> transitSpeedMult     x (1 + b)
//   miningYield     -> extractionYieldMult  x (1 + b)
//   sensors         -> sensors              x (1 + b)   (0 stays 0: the museum amplifies fitted sensors)
//   extractionSpeed -> extractionSpeedMult  x (1 + b)   (read by effectiveMissionDef, which shortens the
//                                                        extracting PHASE; set only when b != 0, so a
//                                                        museum without it never adds the optional field)
//
// ADDITIVE-NEUTRAL: when every ship-relevant bonus is 0 this returns the SAME base reference (no clone),
// the byte-identical guarantee applyCrewOverlay also gives. The other museum stats (research, crafting,
// salvage, expedition, extraction odds, crew amplification) are wired at their own seams, not here.
export function applyMuseumOverlay(
  base: ShipDerivedStats,
  museum: Readonly<Record<MuseumStat, number>>,
): ShipDerivedStats {
  const cargo = museum.cargoCapacity;
  const transit = museum.transitSpeed;
  const mining = museum.miningYield;
  const sensors = museum.sensors;
  const extraction = museum.extractionSpeed;
  if (cargo === 0 && transit === 0 && mining === 0 && sensors === 0 && extraction === 0) return base;
  return {
    ...base,
    cargoCapacity: base.cargoCapacity * (1 + cargo),
    transitSpeedMult: base.transitSpeedMult * (1 + transit),
    extractionYieldMult: base.extractionYieldMult * (1 + mining),
    sensors: base.sensors * (1 + sensors),
    ...(extraction !== 0 ? { extractionSpeedMult: (base.extractionSpeedMult ?? 1) * (1 + extraction) } : {}),
  };
}

// ============================================================================
// The per-tick crew engine (deterministic, offline==live)
// ============================================================================

// A stable, per-save transport seed derived from the officer roster seed so the transport crew stream
// is deterministic per save yet decorrelated from the officer candidate stream. Pure.
function transportSeedFor(state: GameState): number {
  return (Math.imul((state.seniorStaffSeed >>> 0) ^ 0x27d4eb2f, 0x165667b1) ^ 0x9e3779b9) >>> 0;
}

// Increment missionsCompleted for every officer whose assigned ship completed one or more mission
// cycles this tick (the per-ship counts the economy tick collected). Feeds the promotion gates. PURE:
// returns a fresh officers array (or the SAME reference when no completion touched an assigned officer).
// The cycle counts are the closed-form cyclesCompleted/routesCompleted the mission loop already sums, so
// this counter is closed-form (one big call == many small) AND per-tick safe (it feeds nothing that
// changes a stat mid-span; promotion is a discrete player action, never auto-applied in the tick).
export function foldOfficerMissionCompletions(
  officers: SeniorStaffOfficer[],
  completionsByShip: Map<string, number>,
): SeniorStaffOfficer[] {
  if (completionsByShip.size === 0) return officers;
  let changed = false;
  const next = officers.map((o) => {
    if (o.assignedShipId === null) return o;
    const inc = completionsByShip.get(o.assignedShipId);
    if (!inc) return o;
    changed = true;
    return { ...o, missionsCompleted: o.missionsCompleted + inc };
  });
  return changed ? next : officers;
}

// Deliver due crew transports into the pool + auto-crew PASSIVE ships, ONCE per whole tick. Returns a
// NEW state (crewPool + lastTransportWindow + ships updated) or the SAME state reference when there is
// nothing to do. Deterministic + offline-safe:
//   - Transports: deliverDueTransports keys on a gameTimeSeconds window accumulator, so one big offline
//     span delivers the exact backlog the equivalent live ticks would (parity), advancing
//     lastTransportWindow. No RNG on the economy stream (its own seeded PRNG is separate).
//   - Auto-crew: RNG-FREE, top-rank-down within the command-structure caps, deterministic in
//     (pool order, hull, complement). ACTIVE-mode ships are left untouched (active assignment is a
//     later phase).
//
// SAME-REFERENCE NO-OP FAST PATH: when no transport window is due AND the pool is empty (the universal
// crew-free / early-game case), there is nothing to deliver or assign, so it returns `state` unchanged
// and a save with no crew activity is byte-identical to before this phase.
export function resolveCrew(state: GameState): GameState {
  const due = crewTransportsDue(state.lastTransportWindow, state.gameTimeSeconds);
  if (due === 0 && state.crewPool.length === 0) return state;

  // 1) Deliver the whole due backlog into the pool (advancing the window marker).
  const delivered = deliverDueTransports(
    transportSeedFor(state),
    state.crewPool,
    state.lastTransportWindow,
    state.gameTimeSeconds,
  );

  // 2) Auto-crew every PASSIVE ship from the (post-delivery) pool, in state.ships order (monotonic,
  //    stable across save/load/offline). Each ship pulls min(available, remaining-cap) top-rank-down.
  let pool = delivered.pool;
  let shipsChanged = false;
  const ships = state.ships.map((ship) => {
    const mode = ship.complement?.mode ?? "passive";
    if (mode !== "passive") return ship; // active mode: player-curated, untouched this phase
    const before = totalCrew(ship.complement?.buckets ?? []);
    // Phase 1b: a quarters module raises the hull's LOCKED base cap by its capacity bonus (fixed for
    // every module except Efficient, which scales with rarity/quality). autoCrewShip already threads
    // bonusCapacity through complementTotalCap / remainingCapacityForSignature, so passing it here is
    // all the auto-crew filler needs to fill the extra berths. 0 with no module (byte-identical fill).
    const staffed = autoCrewShip(pool, ship.typeKey, ship.complement, quartersCapacityBonus(state, ship));
    pool = staffed.pool;
    // autoCrewShip only ADDS crew, so a rise in headcount is the exact "crew moved in" signal. When
    // nothing moved, keep the original ship reference (avoids needless ref churn every tick).
    if (totalCrew(staffed.complement.buckets) > before) {
      shipsChanged = true;
      return { ...ship, complement: staffed.complement };
    }
    return ship;
  });

  return {
    ...state,
    crewPool: pool,
    lastTransportWindow: delivered.lastWindow,
    ships: shipsChanged ? ships : state.ships,
  };
}
