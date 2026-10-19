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

import type { GameState, ShipInstance, ShipDerivedStats, SeniorStaffOfficer, CrewSignature, CrewBucket, OfficerCombatMods, SeniorStaffSeat, PromotionObjectiveKind } from "./model";
import { shipDerivedStats } from "./model";
import { equippedFor } from "./equipment";
import { CREW_PROFESSION_BUFFS, CREW_STAT_KEYS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
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
// E-CREW 0.14.0 (Task 21): the officer stat facets (pure; imports no crew overlay code, so no cycle).
import { constitutionRamp, departmentFacet, departmentStrengthMultipliers, seatFacet } from "./officerStats";
// WR-5a (0.14.0): the commanding captain's secondary-tree ship-stat lifts (pure; imports only model.ts).
import { captainShipLifts, commandingCaptain, type CaptainShipLifts } from "./captainSecondaryEffects";
import { diminishing } from "./diminishing";
// WR-5c (0.14.0): the commanding captain's explorer secondary nodes (pure; imports only model.ts, so no cycle).
import { captainComplementMult, captainOfficerOutputMult, captainSensorsMult } from "./captainExplorerEffects";

// ============================================================================
// crew.* -> ship-stat mapping (FIRST-PASS, TUNABLE)
// ============================================================================
//
// The crew rollup + officer fold produce a { crew.*: number } modifier map (fractional bonuses, e.g.
// 0.02 == +2%). applyCrewOverlay reads ONLY the keys that have a REAL consumer today and folds them
// onto ShipDerivedStats; every other crew.* key (surveyAptitude, sensors, boardingDefense,
// awayTeamProtection, craftDuplicateChance, preventCrewLoss, counterInfiltration, droneHandling,
// rareFindChance, reducedCrewLosses, triage, powerEfficiency, endurance, ...) is a NO-OP here: its system
// has not landed (or it is read off the map by its own consumer, listed below), so it
// maps to NOTHING and lies dormant until it does. (rareFindChance is no ship stat but is not dormant: the
// expedition snapshots it at dispatch for the relic roll, E-CREW Task 15, and survey missions read it for
// their rare-drop odds, Task 20. reducedCrewLosses is read at claim for injury recovery, Task 16.) The
// mapping table:
//
//   crew.transitOutSpeed                         -> transitOutLegMult  (the outbound leg only; CP-2, OC-E5)
//   crew.transitBackSpeed                        -> transitBackLegMult (the return leg only; CP-2, OC-E5)
//   crew.rangeEfficiency  + crew.fuelEfficiency  -> engineEfficiency   (0-based additive fuel-burn bonus)
//   crew.effectiveCargo                          -> cargoCapacity      (multiplicative)
//   crew.extractionYield                         -> extractionYieldMult (multiplicative)
//   crew.unloadSpeed                             -> unloadSpeedMult    (divides unloadTicks in effectiveMissionDef)
//   crew.missionTurnaround                       -> unloadSpeedMult    (x (1 + t), its unload half; CP-2)
//
// CP-2 (Complement and Acquisition plan): the keys read OFF this map by a direct consumer, not folded here:
//   crew.hullRepairRate + crew.missionTurnaround -> the repair speed-up (crewRepairSpeedBonus: Shipyard + field repair)
//   crew.crewOutputMult                          -> the mission output share (crewMissionOutputBonus)
//   crew.crewEffectiveness                       -> every OTHER complement key x crewEffectivenessMultiplier (inside
//                                                   rawShipCrewContribution, so every consumer inherits it)
// The combat keys still map to NOTHING on purpose: combat power stays on installed combat gear so crew never
// DOUBLE-DIPS weapons/shields (locked design, D12). All magnitudes above are first-pass; retuning happens in a
// later balance phase.
//
// E-CREW 0.14.0 (Task 20, "officer bonuses go live", design 6.1 + D12): two OFFICER-ONLY keys ride this
// same map so the ship-stat readout's per-source split (ShipSystemsPanel) and the museum's crewBonuses
// amplification treat them like every other officer bonus:
//   officer.allStatsMult         (Inspiring Leader)  -> x (1 + b) on cargo, FTL speed, extraction yield,
//                                                       sensors, range (fuelCapacity) and unload speed
//   officer.missionTurnaroundCut (Veteran Instincts) -> unloadSpeedMult x (1 + b) (the unload half of
//                                                       turnaround; the repair half is officerRepairSpeedBonus)
// They are deliberately NOT the Complement's crew.crewOutputMult / crew.missionTurnaround keys: those
// exclusive-pool buffs have their own consumers (CP-2), and sharing a key would count the officer twice.
//
// E-CREW 0.14.0 (Task 21, officer stat facets, officerStats.ts): the Operations department's CONSTITUTION
// facet (its share of a shorter turnaround) also rides officer.missionTurnaroundCut, and the STRENGTH facet
// multiplies each complement bucket's contribution by its department's 1 + facet inside the rollup below.

// E-CREW 0.14.0 (Task 20): the officer-only pass-through keys (see the mapping-table note above).
export const OFFICER_ALL_STATS_KEY = "officer.allStatsMult";
export const OFFICER_TURNAROUND_KEY = "officer.missionTurnaroundCut";
// Complement and Acquisition CP-2 (OC-E5): the Pilot's sweeping transit cut, both legs (transitSpeedMult). It used to
// ride crew.transitOutSpeed, which now lifts the outbound leg only, so the officer keeps its own pass-through key.
export const OFFICER_TRANSIT_KEY = "officer.transitTimeCut";

// CP-2 (OC-3 answered 2026-10-16 "Boosts other buffs"): Crew Effectiveness (the Medical buff crew.crewEffectiveness
// plus the Earth-born racial) multiplies every OTHER complement buff on the ship by 1 + diminishing(e, knee) (D23: a
// concave curve, never a cap). [PROVISIONAL] the knee, one constant.
export const CREW_EFFECTIVENESS_KNEE = 0.2;

// The multiplier a summed Crew Effectiveness `e` gives the ship's other complement buffs. Exactly 1 at e <= 0. Pure.
export function crewEffectivenessMultiplier(e: number): number {
  return e > 0 ? 1 + diminishing(e, CREW_EFFECTIVENESS_KNEE) : 1;
}

// E-CREW 0.14.0 (Task 20): every officer bonus statKey has a live consumer EXCEPT these, whose system lands
// later in this same release. The Task 22 "no dead stats" standing test reads this as its allow-list and
// fails once the named phase lands and the entry is still here. Key -> the phase that brings it live.
export const OFFICER_BONUSES_PENDING_IN_RELEASE: Readonly<Record<string, string>> = {
  "officer.powerEfficiencyMult": "E-MOD power budget", // Reactor Overdrive
};

// Maps an OFFICER bonus's own broader `officer.*` stat vocabulary (seniorStaffBonuses.ts) onto the
// crew.* key it corresponds to, so officer bonuses and complement buffs accumulate into ONE map. A
// value of null means "not through this map": since Task 20 every such bonus is read DIRECTLY by its
// consumer (officerBonusTotal; listed below). Unknown officer statKeys are treated as null (defensive).
const OFFICER_STATKEY_TO_CREW: Record<string, string | null> = {
  "officer.transitTimeCut": OFFICER_TRANSIT_KEY, // a sweeping transit cut == a speed lift on both legs (CP-2, OC-E5)
  "officer.effectiveCargoMult": CREW_STAT_KEYS.effectiveCargo,
  "officer.extractionYieldMult": CREW_STAT_KEYS.extractionYield,
  "officer.unloadTimeCut": CREW_STAT_KEYS.unloadSpeed,
  "officer.rangeMult": CREW_STAT_KEYS.rangeEfficiency,
  // Reactor Overdrive: shares the Engineering division's crew.powerEfficiency key, which has no consumer yet.
  // LIVE WITH E-MOD power budget (listed in OFFICER_BONUSES_PENDING_IN_RELEASE for the Task 22 test).
  "officer.powerEfficiencyMult": CREW_STAT_KEYS.powerEfficiency,
  // Discovery Instinct: no ship stat; read off crew.rareFindChance by the expedition relic roll at dispatch
  // (E-CREW Task 15, Expedition.crewRareFind) and by survey missions' rare-drop odds (Task 20, economyTick).
  "officer.rareFindMult": CREW_STAT_KEYS.rareFindChance,
  // Inspiring Leader + Veteran Instincts: officer-only pass-through keys folded by applyCrewOverlay (Task 20).
  "officer.allStatsMult": OFFICER_ALL_STATS_KEY,
  "officer.missionTurnaroundCut": OFFICER_TURNAROUND_KEY,
  // The rest are read DIRECTLY by their consumers (officerBonusTotal), never through this map, so a
  // Complement key that shares the theme can go live on its own later (Task 23) without counting an
  // officer twice:
  //   Rapid Recovery   -> injury recovery (injuries.ts, Task 16) + Shipyard repair (officerRepairSpeedBonus)
  //   Command Presence -> mission output (economyTick: extraction / survey / transport deliveries + patrol loot)
  //   Fleet Triage     -> away-team in-battle healing + first-aid cures (Expedition.squadTriage)
  //   Morale Anchor    -> away-team Fear resist (Expedition.squadFearResist)
  //   Evasive Command  -> expedition encounter chance (Task 14) + ship-battle evasion (officerCombatMods)
  //   Weapons Command / Shield Command -> ship-battle weapon damage / shields (officerCombatMods). D12: an
  //     EXEMPTION for officers only; the Complement still never feeds weapons or shields.
  "officer.repairRateMult": null,
  "officer.shipOutputMult": null,
  "officer.crewLossPrevention": null,
  "officer.crewRetention": null,
  "officer.evasion": null,
  "officer.weaponEffectivenessMult": null,
  "officer.shieldEffectivenessMult": null,
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
  // CP-2 (OC-E5): the sweeping transit cut (the officer's, both legs) rides transitSpeedMult; the complement's
  // Fast Departure and Fast Return each lift their own leg (applyLegLifts).
  const transit = crew[OFFICER_TRANSIT_KEY] ?? 0;
  const outLeg = crew[CREW_STAT_KEYS.transitOutSpeed] ?? 0;
  const backLeg = crew[CREW_STAT_KEYS.transitBackSpeed] ?? 0;
  const range = (crew[CREW_STAT_KEYS.rangeEfficiency] ?? 0) + (crew[CREW_STAT_KEYS.fuelEfficiency] ?? 0);
  const cargo = crew[CREW_STAT_KEYS.effectiveCargo] ?? 0;
  const extraction = crew[CREW_STAT_KEYS.extractionYield] ?? 0;
  const unload = crew[CREW_STAT_KEYS.unloadSpeed] ?? 0;
  // CP-2: the complement's Mission Turnaround, the unload half (its repair half is crewRepairSpeedBonus).
  const crewTurnaround = crew[CREW_STAT_KEYS.missionTurnaround] ?? 0;
  // E-CREW Task 20: the officer-only lifts (Inspiring Leader, Veteran Instincts' unload half).
  const lift = crew[OFFICER_ALL_STATS_KEY] ?? 0;
  const turnaround = crew[OFFICER_TURNAROUND_KEY] ?? 0;

  // Neutral fast path: nothing mapped -> identity (same reference), the byte-identical guarantee.
  if (
    transit === 0 &&
    outLeg === 0 &&
    backLeg === 0 &&
    range === 0 &&
    cargo === 0 &&
    extraction === 0 &&
    unload === 0 &&
    crewTurnaround === 0 &&
    lift === 0 &&
    turnaround === 0
  ) {
    return base;
  }

  const mapped = applyCrewTurnaround(applyLegLifts(applyMappedCrewStats(base, transit, range, cargo, extraction, unload), outLeg, backLeg), crewTurnaround);
  return applyOfficerLifts(mapped, lift, turnaround);
}

// CP-2 (OC-E5, user 2026-10-15 "Each its own leg"): Fast Departure lifts the outbound leg and Fast Return the
// return leg, each x (1 + b) on its own optional field (model.ts outboundLegSpeed / returnLegSpeed). A 0 lift
// writes nothing, so `base` comes back unchanged without either buff.
function applyLegLifts(base: ShipDerivedStats, outLeg: number, backLeg: number): ShipDerivedStats {
  if (outLeg === 0 && backLeg === 0) return base;
  return {
    ...base,
    ...(outLeg !== 0 ? { transitOutLegMult: (base.transitOutLegMult ?? 1) * (1 + outLeg) } : {}),
    ...(backLeg !== 0 ? { transitBackLegMult: (base.transitBackLegMult ?? 1) * (1 + backLeg) } : {}),
  };
}

// CP-2 (Task 23, design 6.2 exclusive pool): the complement's Mission Turnaround, unloadSpeedMult x (1 + t), the
// unload half of a shorter turnaround (mirroring Veteran Instincts, on its OWN key so neither counts the other).
// A complement buff that stacks with headcount, so it is linear per head like every other complement buff (each
// head is bounded by the hull's crew cap); its repair half joins the D23 repair divisor. 0 returns `base`.
function applyCrewTurnaround(base: ShipDerivedStats, t: number): ShipDerivedStats {
  if (t === 0) return base;
  return { ...base, unloadSpeedMult: (base.unloadSpeedMult ?? 1) * (1 + t) };
}

// The pre-Task-20 body of applyCrewOverlay (the five mapped crew keys), unchanged. With all five 0 it
// returns `base` itself, so a lift-only map never rewrites a stat the lifts do not touch.
function applyMappedCrewStats(
  base: ShipDerivedStats,
  transit: number,
  range: number,
  cargo: number,
  extraction: number,
  unload: number,
): ShipDerivedStats {
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

// E-CREW 0.14.0 (Task 20): the officer-only ship-stat lifts, applied AFTER the mapped crew keys.
//   Inspiring Leader ("a small lift to every ship stat"): x (1 + lift) on cargoCapacity, transitSpeedMult,
//     extractionYieldMult, sensors (0 stays 0), fuelCapacity (so range rises by the same share, without also
//     touching the 0-based engineEfficiency, which would count it twice) and unloadSpeedMult. NOT lifted:
//     mass (a cost, lifting it would hurt) and powerOutput / powerDraw (the E-MOD power budget owns power).
//     Its combat half (weapons, shields, hull) is officerCombatMods.
//   Veteran Instincts ("shorter mission turnaround: unload + repair windows"): unloadSpeedMult x
//     (1 + turnaround); the repair half is officerRepairSpeedBonus.
// Each lift has a bounded source (at most one bonus per seated officer), so these stay linear (D23 is about
// bonuses that stack without bound). Zero lifts return `base` unchanged.
function applyOfficerLifts(base: ShipDerivedStats, lift: number, turnaround: number): ShipDerivedStats {
  if (lift === 0 && turnaround === 0) return base;
  const l = 1 + lift;
  const unloadSpeedMult = (base.unloadSpeedMult ?? 1) * l * (1 + turnaround);
  if (lift === 0) return { ...base, unloadSpeedMult };
  return {
    ...base,
    cargoCapacity: base.cargoCapacity * l,
    transitSpeedMult: base.transitSpeedMult * l,
    extractionYieldMult: base.extractionYieldMult * l,
    sensors: base.sensors * l,
    fuelCapacity: base.fuelCapacity * l,
    unloadSpeedMult,
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
  // E-CREW 0.14.0 (Task 21): the STRENGTH facet. Each department head's Strength (plus the XO's share)
  // multiplies that division's complement buffs, composed with the quarters module's division multiplier.
  // null when no department has a Strength facet (every all-10 bridge), so the fold below stays the exact
  // pre-Task-21 path. Every crew.* consumer reads this one map, so a division pool that goes live later
  // (Task 23) inherits the facet with no extra wiring.
  const strength = buckets.length > 0 ? departmentStrengthMultipliers(state, ship) : null;
  // WR-5c: the commanding captain's Inspiring Leader and Legendary Captain scale every complement buff (exactly 1
  // without them, so the fold below stays the pre-WR-5c path); its Mentor and Legendary Captain scale the officers.
  const captain = commandingCaptain(state, ship);
  const complementMult = captainComplementMult(captain);
  const officerOutput = captainOfficerOutputMult(captain);
  if (buckets.length > 0) {
    const contrib =
      quartersMod || strength || complementMult !== 1
        ? (sig: CrewSignature): Record<string, number> => {
            const quarters = quartersMod ? quartersProfessionMultiplier(quartersMod, sig.profession) : 1;
            const mult = (strength ? quarters * strength[sig.profession] : quarters) * complementMult;
            const base = contributionForSignature(sig);
            if (mult === 1) return base; // no change for this division: keep the base map
            const scaled: Record<string, number> = {};
            for (const k of Object.keys(base)) scaled[k] = base[k] * mult;
            return scaled;
          }
        : contributionForSignature;
    const rollup = rollupBuckets(buckets, contrib);
    // CP-2 (OC-3): Crew Effectiveness ("healthy crew work better", D26). The complement's own crew.crewEffectiveness
    // (the Medical buff and the Earth-born per-head racial, already through the quarters and Strength multipliers
    // above) plus every assigned officer's Earth-born racial lifts every OTHER complement key by
    // crewEffectivenessMultiplier (D23 curve). It never scales itself, and the officers' own bonuses (added below) are
    // not scaled. Exactly 1 without it, and then every value is added as before (no float op).
    const lift = crewEffectivenessMultiplier((rollup[EFFECTIVENESS_KEY] ?? 0) + officerEffectivenessRacials(state, ship, bridgeMod));
    for (const key of Object.keys(rollup)) add(key, lift === 1 || key === EFFECTIVENESS_KEY ? rollup[key] : rollup[key] * lift);
  }

  // --- Senior Staff officers assigned to THIS ship (assignedShipId is the assignment authority).
  const hullSpec = hullSpecOf(ship);
  for (const officer of state.officers) {
    if (officer.assignedShipId !== ship.id) continue;
    // A BRIDGE module amplifies this officer's whole output (both bonuses + the racial). 1 with no
    // bridge module, so the multiply is a no-op and the pre-module numbers are preserved exactly.
    // WR-5c: x the captain's officer output (Mentor, Legendary Captain), exactly 1 without them.
    const officerMult = (bridgeMod ? bridgeOfficerMultiplier(bridgeMod, officer, hullSpec) : 1) * officerOutput;
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

  // E-CREW 0.14.0 (Task 21): the Operations department's CONSTITUTION facet, its share of a shorter
  // post-mission turnaround: it rides the officer-only turnaround key (faster unloading, applyOfficerLifts)
  // beside Veteran Instincts' unload half. add() skips a 0, so an all-10 bridge writes nothing.
  add(OFFICER_TURNAROUND_KEY, departmentFacet(state, ship, "operations", "constitution"));

  return out;
}

const EFFECTIVENESS_KEY = CREW_STAT_KEYS.crewEffectiveness;

// CP-2 (OC-3): the Crew Effectiveness the officers assigned to `ship` add through their racial (Earth-born), at the
// officer magnitude, bridge-module amp included exactly as the officer fold below applies it. 0 without one. Pure.
function officerEffectivenessRacials(state: GameState, ship: ShipInstance, bridgeMod: ReturnType<typeof installedBridgeModule>): number {
  let total = 0;
  for (const officer of state.officers) {
    if (officer.assignedShipId !== ship.id) continue;
    const racial = officerRacialBonus(officer);
    if (racial.statKey !== EFFECTIVENESS_KEY || racial.magnitude === 0) continue;
    total += racial.magnitude * (bridgeMod ? bridgeOfficerMultiplier(bridgeMod, officer, hullSpecOf(ship)) : 1);
  }
  return total;
}

// The summed magnitude of every rolled officer bonus whose catalog statKey is `statKey`, across the officers
// assigned to `ship`, amplified by the ship's bridge module exactly as rawShipCrewContribution amplifies
// them (the stored magnitude is already rank-scaled; never re-scaled here). For an officer bonus whose
// consumer reads it DIRECTLY rather than through the crew.* map: E-CREW Task 14 reads Evasive Command
// ("officer.evasion") here for the expedition encounter chance, and Task 20 reads every direct bonus here
// (see the OFFICER_STATKEY_TO_CREW null rows and the helpers below). 0 with no such officer. PURE.
export function officerBonusTotal(state: GameState, ship: ShipInstance, statKey: string): number {
  const bridgeMod = installedBridgeModule(state, ship);
  const hullSpec = hullSpecOf(ship);
  // WR-5c: the commanding captain's officer output (Mentor, Legendary Captain), exactly 1 without them.
  const officerOutput = captainOfficerOutputMult(commandingCaptain(state, ship));
  let total = 0;
  for (const officer of state.officers) {
    if (officer.assignedShipId !== ship.id) continue;
    for (const bonus of officer.bonuses) {
      if (getSeniorStaffBonusById(bonus.id)?.statKey !== statKey) continue;
      const officerMult = (bridgeMod ? bridgeOfficerMultiplier(bridgeMod, officer, hullSpec) : 1) * officerOutput;
      total += bonus.magnitude * officerMult;
    }
  }
  return total === 0 ? 0 : museumOfficerAmp(state, total);
}

// CP-2 (OC-E8, user 2026-10-15 "Officers too"): the Museum's crewBonuses (Xeno 4-piece) amplifies the officer bonuses
// read DIRECTLY by their consumers exactly as it amplifies the crew map: x (1 + crewBonuses). An empty museum returns
// `value` itself (no float op), so a save without the set is unchanged. Pure.
function museumOfficerAmp(state: GameState, value: number): number {
  const amp = museumBonuses(state).crewBonuses;
  return amp === 0 ? value : value * (1 + amp);
}

// ============================================================================
// E-CREW 0.14.0 (Task 20): the officer bonuses read DIRECTLY by their consumers
// ============================================================================
//
// Direct reads (officerBonusTotal) carry the bridge-module amp and, since CP-2 (OC-E8, "Officers too"), the
// museum's crewBonuses amplification too, like the ship-stat lifts above that ride the crew map. The combat
// profile below applies the same museum factor to each combat bonus.

// One officer combat bonus on the ship, with the facets of the department it belongs to (E-CREW Task 21): the
// bonus `kind`, its magnitude (bridge-module amp included, exactly as officerBonusTotal sums it), and the
// Integrity + Constitution facets of the carrier's seat (officerStats.ts seatFacet). The PROFILE of a ship is
// these entries in officer order, then bonus order (the order officerBonusTotal sums in, so the folded totals
// are bit-identical to the Task 20 fold).
// "recharge" (Task 21 review calls) is the Engineering department's INTEGRITY facet itself: no bonus behind it,
// it only lifts the shield RECHARGE while the hull is below half (underFire.shield), so it never enters the
// folded base mods.
export type OfficerCombatKind = "weapons" | "shields" | "evasion" | "lift" | "recharge";
export interface OfficerCombatEntry {
  kind: OfficerCombatKind;
  magnitude: number;
  integrity: number;
  constitution: number;
}

const OFFICER_COMBAT_KIND_OF: Readonly<Record<string, OfficerCombatKind>> = {
  "officer.weaponEffectivenessMult": "weapons",
  "officer.shieldEffectivenessMult": "shields",
  "officer.evasion": "evasion",
  [OFFICER_ALL_STATS_KEY]: "lift",
};

// The ship's officer combat PROFILE (see OfficerCombatEntry). Empty with no combat bonus aboard. PURE.
export function officerCombatProfile(state: GameState, ship: ShipInstance): OfficerCombatEntry[] {
  const bridgeMod = installedBridgeModule(state, ship);
  const hullSpec = hullSpecOf(ship);
  // CP-2 (OC-E8): the museum's crewBonuses on the officer combat bonuses (0 with an empty museum: no float op), read
  // only once a combat bonus is found (most ships carry none).
  let museumAmp: number | undefined;
  const out: OfficerCombatEntry[] = [];
  const facets = new Map<SeniorStaffSeat, { integrity: number; constitution: number }>();
  // WR-5c: the commanding captain's officer output (Mentor, Legendary Captain), exactly 1 without them.
  const officerOutput = captainOfficerOutputMult(commandingCaptain(state, ship));
  for (const officer of state.officers) {
    if (officer.assignedShipId !== ship.id) continue;
    for (const bonus of officer.bonuses) {
      const statKey = getSeniorStaffBonusById(bonus.id)?.statKey;
      const kind = statKey ? OFFICER_COMBAT_KIND_OF[statKey] : undefined;
      if (!kind) continue;
      const officerMult = (bridgeMod ? bridgeOfficerMultiplier(bridgeMod, officer, hullSpec) : 1) * officerOutput;
      let f = facets.get(officer.seat);
      if (!f) {
        f = { integrity: seatFacet(state, ship, officer.seat, "integrity"), constitution: seatFacet(state, ship, officer.seat, "constitution") };
        facets.set(officer.seat, f);
      }
      if (museumAmp === undefined) museumAmp = museumBonuses(state).crewBonuses;
      const magnitude = museumAmp === 0 ? bonus.magnitude * officerMult : bonus.magnitude * officerMult * (1 + museumAmp);
      out.push({ kind, magnitude, integrity: f.integrity, constitution: f.constitution });
    }
  }
  // E-CREW (Task 21 review calls): Engineering's Integrity, faster shield recharge below half hull. Appended
  // only when non-zero, so an all-10 bridge's profile is the Task 20 one.
  const engineering = departmentFacet(state, ship, "engineering", "integrity");
  if (engineering > 0) out.push({ kind: "recharge", magnitude: engineering, integrity: 0, constitution: 0 });
  return out;
}

// Fold a combat profile into OfficerCombatMods `hoursOut` hours into a run (E-CREW Task 21). Each entry is
// first RAMPED by its department's Constitution (x (1 + constitutionRamp(facet, hoursOut)); 0 hours or no
// Constitution = the bare magnitude), then summed per kind exactly as Task 20 summed them. The INTEGRITY facet
// becomes `underFire`: the extra the folded mods gain when every entry is also x (1 + its Integrity facet),
// present only when it is non-zero. undefined when the profile has no non-zero combat bonus (so the caller
// never stores an all-zero record). With every facet 0 the result is bit-identical to Task 20's fold. PURE.
export function officerCombatModsFromProfile(profile: readonly OfficerCombatEntry[], hoursOut: number = 0): OfficerCombatMods | undefined {
  const base = { weapons: 0, shields: 0, evasion: 0, lift: 0 };
  const steady = { weapons: 0, shields: 0, evasion: 0, lift: 0 };
  let anySteady = false;
  let recharge = 0;
  for (const e of profile) {
    if (e.kind === "recharge") {
      recharge += e.magnitude;
      continue;
    }
    const ramp = constitutionRamp(e.constitution, hoursOut);
    const m = ramp === 0 ? e.magnitude : e.magnitude * (1 + ramp);
    base[e.kind] += m;
    if (e.integrity > 0 && m !== 0) {
      anySteady = true;
      steady[e.kind] += m * (1 + e.integrity);
    } else {
      steady[e.kind] += m;
    }
  }
  const folded = foldCombatTotals(base);
  if (!folded && !(recharge > 0)) return undefined;
  if (!anySteady && !(recharge > 0)) return folded;
  // Engineering's recharge alone (no combat bonus aboard) still needs a record to carry it: all-zero mods.
  const mods = folded ?? { weaponDamage: 0, shield: 0, hull: 0, evasion: 0 };
  const s = anySteady ? foldCombatTotals(steady)! : mods;
  const shieldSteady = (1 + s.shield) / (1 + mods.shield);
  const underFire = {
    weaponDamage: (1 + s.weaponDamage) / (1 + mods.weaponDamage) - 1,
    shield: recharge > 0 ? shieldSteady * (1 + recharge) - 1 : shieldSteady - 1,
    evasion: s.evasion - mods.evasion,
  };
  if (underFire.weaponDamage === 0 && underFire.shield === 0 && underFire.evasion === 0) return folded;
  return { ...mods, underFire };
}

// Task 20's fold of the four summed kinds into OfficerCombatMods (undefined when all four are 0). Inspiring
// Leader's "every ship stat" covers the combat pools too, compounding with the seat bonus ((1 + w)(1 + i) - 1).
function foldCombatTotals(t: { weapons: number; shields: number; evasion: number; lift: number }): OfficerCombatMods | undefined {
  const { weapons, shields, evasion, lift } = t;
  if (weapons === 0 && shields === 0 && evasion === 0 && lift === 0) return undefined;
  return {
    weaponDamage: lift === 0 ? weapons : (1 + weapons) * (1 + lift) - 1,
    shield: lift === 0 ? shields : (1 + shields) * (1 + lift) - 1,
    hull: lift,
    evasion,
  };
}

// The ship's Senior Staff combat bonuses (model.ts OfficerCombatMods), or undefined when the ship has none
// (so the caller never stores an all-zero record and a no-officer battle stays byte-identical). Weapons and
// Shield Command read ONLY officers (D12: officers are EXEMPT from the "crew never double-dips weapons /
// shields" rule; the Complement stays excluded). Inspiring Leader's "every ship stat" covers the combat
// pools too. E-CREW Task 21: folded through the officers' combat PROFILE at 0 hours (a dispatch: no
// Constitution ramp yet), carrying the Integrity extras as `underFire`. PURE.
export function officerCombatMods(state: GameState, ship: ShipInstance): OfficerCombatMods | undefined {
  return officerCombatModsFromProfile(officerCombatProfile(state, ship), 0);
}

// The Shipyard repair speed-up from the ship's officers: Rapid Recovery ("faster Shipyard hull repair") +
// Veteran Instincts (the repair half of "unload + repair windows"). tick.ts shipRepairDurationTicks divides
// the repair by (1 + this), a D23 divisor (never 0, each point worth a little less). 0 with neither. PURE.
// E-CREW 0.14.0 (Task 21): plus the Engineering department's CONSTITUTION facet (its share of a shorter
// post-mission turnaround), added to the same divisor only when non-zero (an all-10 bridge is unchanged).
export function officerRepairSpeedBonus(state: GameState, ship: ShipInstance): number {
  const bonus = officerBonusTotal(state, ship, "officer.repairRateMult") + officerBonusTotal(state, ship, OFFICER_TURNAROUND_KEY);
  const constitution = departmentFacet(state, ship, "engineering", "constitution");
  return constitution === 0 ? bonus : bonus + constitution;
}

// Command Presence ("the ship's mission output: materials and credits from its runs"): the share every
// delivered haul and credit award of this ship's runs grows by (economyTick). 0 without it. PURE.
export function officerMissionOutputBonus(state: GameState, ship: ShipInstance): number {
  return officerBonusTotal(state, ship, "officer.shipOutputMult");
}

// ============================================================================
// Complement and Acquisition CP-2: the complement's ship-side consumers read off the crew map
// ============================================================================
//
// Each reads the ship's finished crew map (shipCrewContribution: complement + racials, Crew Effectiveness, the
// quarters module, the Strength facet and the museum's crewBonuses all applied), so these keys inherit every
// amplifier the live complement keys already get. 0 without the key, and the ship* sums below then return the
// officer value itself, so a ship without these buffs reads exactly what it read before CP-2.

// Damage Control (crew.hullRepairRate, plus the Stheni racial) and the repair half of Mission Turnaround
// (crew.missionTurnaround): the complement's share of the repair speed-up. Pure.
export function crewRepairSpeedBonus(state: GameState, ship: ShipInstance): number {
  if (!carriesCrewKey(state, ship, CREW_STAT_KEYS.hullRepairRate) && !carriesCrewKey(state, ship, CREW_STAT_KEYS.missionTurnaround)) return 0;
  const crew = shipCrewContribution(state, ship);
  return (crew[CREW_STAT_KEYS.hullRepairRate] ?? 0) + (crew[CREW_STAT_KEYS.missionTurnaround] ?? 0);
}

// The crew-map sources of each crew.* key: the buffs that target it and the races whose racial does (catalog
// data, built once). A ship carries the key only if a bucket or an assigned notable holds one of those buffs or
// races, or an assigned officer is of one of those races (officer bonuses map through OFFICER_STATKEY_TO_CREW,
// none of whose targets are read by the CP-2 consumers). A fast, exact guard: economyTick reads the output share
// every tick, and most ships carry no such key, so the full map is built only when one could be non-zero.
// KEEP IN STEP: this source list is hand-copied from what contributionForSignature (crew.ts) folds, the buff pools
// getCrewBuffById reads (crewBuffs.ts BUFF_BY_ID: CREW_PROFESSION_BUFFS + SECOND_LEVEL_EXCLUSIVE) plus each race's
// racialBonus. A crew buff added outside those pools, or a new crew-map source on a guarded key, would read 0 here.
// complementShipBuffs.test.ts "the carriesCrewKey guard sees every catalog source" sweeps every source of every
// guarded key; a new guarded consumer (for example OC-E12) adds its key to that sweep.
const KEY_SOURCES: ReadonlyMap<string, { buffs: ReadonlySet<string>; races: ReadonlySet<string> }> = (() => {
  const out = new Map<string, { buffs: Set<string>; races: Set<string> }>();
  const of = (key: string) => {
    let e = out.get(key);
    if (!e) out.set(key, (e = { buffs: new Set(), races: new Set() }));
    return e;
  };
  for (const def of [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE]) of(def.statKey).buffs.add(def.id);
  for (const [race, def] of Object.entries(CREW_RACES)) of(def.racialBonus.statKey).races.add(race);
  return out;
})();

function carriesCrewKey(state: GameState, ship: ShipInstance, key: string): boolean {
  const src = KEY_SOURCES.get(key);
  if (!src) return false;
  const holds = (b: { buff1Id: string; buff2Id: string | null; race: string }): boolean =>
    src.buffs.has(b.buff1Id) || (b.buff2Id !== null && src.buffs.has(b.buff2Id)) || src.races.has(b.race);
  if (ship.complement?.buckets.some((b) => b.count > 0 && holds(b))) return true;
  if (state.notableCrew.some((n) => (n.assignedShipId ?? null) === ship.id && holds(n))) return true;
  return src.races.size > 0 && state.officers.some((o) => o.assignedShipId === ship.id && src.races.has(o.race));
}

// The whole repair speed-up every repair reads: the Shipyard divisor (tick.ts shipRepairDurationTicks divides the
// repair by 1 + this, a D23 divisor: never 0, each point worth a little less) and the Ground Ops field repair
// (frozen at dispatch, shipScanEvents.ts ShipEventBattle.repairSpeed). Officers + complement. Pure.
export function shipRepairSpeedBonus(state: GameState, ship: ShipInstance): number {
  const officers = officerRepairSpeedBonus(state, ship);
  const crew = crewRepairSpeedBonus(state, ship);
  return crew === 0 ? officers : officers + crew;
}

// Crew Output Multiplier (crew.crewOutputMult, OC-E3 "More mission + patrol haul"): the complement's share of the
// mission output every delivered haul and credit award grows by. Pure.
export function crewMissionOutputBonus(state: GameState, ship: ShipInstance): number {
  if (!carriesCrewKey(state, ship, CREW_STAT_KEYS.crewOutputMult)) return 0;
  return shipCrewContribution(state, ship)[CREW_STAT_KEYS.crewOutputMult] ?? 0;
}

// The whole mission output share economyTick applies (extraction / survey / transport deliveries and patrol wave
// loot, through the existing whole-unit chanceRound streams; no new stream): Command Presence + Crew Output
// Multiplier, one additive share. Loot is not battle power, so D12 holds. Pure.
export function shipMissionOutputBonus(state: GameState, ship: ShipInstance): number {
  const officers = officerMissionOutputBonus(state, ship);
  const crew = crewMissionOutputBonus(state, ship);
  return crew === 0 ? officers : officers + crew;
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
  // WR-5a: the commanding captain's Prospector nodes, LAST (Overloaded Holds' overflow is a share of the finished hold).
  // WR-5c: then the same captain's Keen Sensors (a multiplier on the finished sensors; the Prospector lifts never
  // touch sensors, so the order between the two is immaterial).
  const captain = commandingCaptain(state, ship);
  return applyCaptainSensors(applyCaptainOverlay(shipStatsBeforeCaptain(state, ship), captainShipLifts(captain)), captainSensorsMult(captain));
}

// effectiveShipStats WITHOUT the captain overlays: the gear fold, the crew, the museum and the officer facets. The
// ship readout's source split reads it (its Captain bucket is effective minus this, Keen Sensors included). PURE.
export function shipStatsBeforeCaptain(state: GameState, ship: ShipInstance): ShipDerivedStats {
  const base = shipDerivedStats(ship, equippedFor(state, ship.id));
  const museum = museumBonuses(state);
  const crewed = applyCrewOverlay(base, shipCrewContribution(state, ship, museum));
  return applyOfficerFacetStats(applyMuseumOverlay(crewed, museum), state, ship);
}

// WR-5c (captain secondary talent surveySensors1 Keen Sensors, OC-A1 "Always multiply"): sensors x `mult`. Exactly 1
// without the node, which returns `stats` itself (the byte-identical guarantee); 0 sensors stay 0. PURE.
export function applyCaptainSensors(stats: ShipDerivedStats, mult: number): ShipDerivedStats {
  return mult === 1 ? stats : { ...stats, sensors: stats.sensors * mult };
}

// WR-5a (0.14.0): the commanding captain's secondary-tree ship-stat lifts (captainSecondaryEffects.ts
// captainShipLifts; OC-A1 / OC-A2). Each "+X%" node compounds as its own (1 + x) factor on the value it names:
//   Prospector's Eye  -> extractionYieldMult x (1 + y)
//   Efficient Haul    -> extractionSpeedMult x (1 + s)  (effectiveMissionDef shortens the extracting phase)
//   Quartermaster     -> cargoCapacity x (1 + c)         (counts toward the mission cargo gates)
//   Fuel Discipline   -> (1 + engineEfficiency) x (1 + e) (the reach factor; burn reads the same value)
//   Rapid Turnaround  -> unloadSpeedMult x (1 + u)       (missions; frozen into the Ground Ops offload at dispatch)
//   Overloaded Holds  -> cargoCapacity x (1 + o) more, with unloadCargoCapacity = the hold before the overflow,
//                        so the overflow unloads at no extra time.
// A field is written only when its lift is non-zero, and no lift at all returns `base` itself (a captain with no
// Prospector node changes nothing, the byte-identical guarantee). PURE.
export function applyCaptainOverlay(base: ShipDerivedStats, lifts: CaptainShipLifts): ShipDerivedStats {
  const { extractionYield, extractionSpeed, cargo, engineEfficiency, unloadSpeed, overflow } = lifts;
  if (extractionYield === 0 && extractionSpeed === 0 && cargo === 0 && engineEfficiency === 0 && unloadSpeed === 0 && overflow === 0) return base;
  const hold = cargo === 0 ? base.cargoCapacity : base.cargoCapacity * (1 + cargo);
  return {
    ...base,
    cargoCapacity: overflow === 0 ? hold : hold * (1 + overflow),
    ...(overflow !== 0 ? { unloadCargoCapacity: hold } : {}),
    ...(extractionYield !== 0 ? { extractionYieldMult: base.extractionYieldMult * (1 + extractionYield) } : {}),
    ...(extractionSpeed !== 0 ? { extractionSpeedMult: (base.extractionSpeedMult ?? 1) * (1 + extractionSpeed) } : {}),
    ...(engineEfficiency !== 0 ? { engineEfficiency: (1 + base.engineEfficiency) * (1 + engineEfficiency) - 1 } : {}),
    ...(unloadSpeed !== 0 ? { unloadSpeedMult: (base.unloadSpeedMult ?? 1) * (1 + unloadSpeed) } : {}),
  };
}

// E-CREW 0.14.0 (Task 21 review calls): the two officer stat facets effectiveMissionDef reads off the stats,
// so the engine and every mission readout (which all route through effectiveShipStats) agree on the phase
// lengths: the Flight Deck's Constitution (the return leg ramp) and the Operations Integrity (the full-hold
// unload). Each is set only when non-zero, so the SAME object comes back for an all-10 bridge. PURE.
function applyOfficerFacetStats(stats: ShipDerivedStats, state: GameState, ship: ShipInstance): ShipDerivedStats {
  const returnLeg = departmentFacet(state, ship, "flightDeck", "constitution");
  const fullHold = departmentFacet(state, ship, "operations", "integrity");
  if (returnLeg === 0 && fullHold === 0) return stats;
  return {
    ...stats,
    ...(returnLeg > 0 ? { returnLegConstitution: returnLeg } : {}),
    ...(fullHold > 0 ? { fullHoldUnloadIntegrity: fullHold } : {}),
  };
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
// WR-5c: `multOf` is the ship's promotion multiplier (its commanding captain's Drillmaster,
// captainExplorerEffects.ts shipPromotionMult); every increment is x it. Absent or 1 = the plain count.
export function foldOfficerMissionCompletions(
  officers: SeniorStaffOfficer[],
  completionsByShip: Map<string, number>,
  multOf?: (shipId: string) => number,
): SeniorStaffOfficer[] {
  if (completionsByShip.size === 0) return officers;
  let changed = false;
  const next = officers.map((o) => {
    if (o.assignedShipId === null) return o;
    const inc = completionsByShip.get(o.assignedShipId);
    if (!inc) return o;
    changed = true;
    const mult = multOf ? multOf(o.assignedShipId) : 1;
    return { ...o, missionsCompleted: o.missionsCompleted + (mult === 1 ? inc : inc * mult) };
  });
  return changed ? next : officers;
}

// WR-4 (B4, OC-E10): add per-ship promotion counter increments (crewHours, shipsDestroyed, personnelAchievement)
// to the optional promotionCounters of every officer assigned to that ship. The counters start at 0 (an absent map
// or key reads 0) and nothing is backfilled (user: "Start at 0"). PURE: a fresh officers array, or the SAME
// reference when no increment touches an assigned officer, so a save with no officers aboard is byte-identical.
// WR-5c: `multOf` as in foldOfficerMissionCompletions (Drillmaster x every increment; absent or 1 = unchanged).
export function foldOfficerPromotionCounters(
  officers: SeniorStaffOfficer[],
  incByShip: ReadonlyMap<string, Partial<Record<PromotionObjectiveKind, number>>>,
  multOf?: (shipId: string) => number,
): SeniorStaffOfficer[] {
  if (incByShip.size === 0) return officers;
  let changed = false;
  const next = officers.map((o) => {
    if (o.assignedShipId === null) return o;
    const inc = incByShip.get(o.assignedShipId);
    if (!inc) return o;
    const counters: Partial<Record<PromotionObjectiveKind, number>> = { ...(o.promotionCounters ?? {}) };
    const mult = multOf ? multOf(o.assignedShipId) : 1;
    let touched = false;
    for (const [kind, amount] of Object.entries(inc) as [PromotionObjectiveKind, number][]) {
      if (!(amount > 0)) continue;
      counters[kind] = (counters[kind] ?? 0) + (mult === 1 ? amount : amount * mult);
      touched = true;
    }
    if (!touched) return o;
    changed = true;
    return { ...o, promotionCounters: counters };
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
