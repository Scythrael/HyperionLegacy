// Ground Operations 0.14.0 (D25): the run-side engine of a Ground Ops expedition.
//
// GO-7a (this file today): the DISPATCH SNAPSHOT, written but not yet read. startExpedition does not call it
// until GO-7b switches the engine, so every run still resolves on the legacy path.
//
//   snapshotGroundOps(state, ship, run) -> { teams, factors, shipEventProfile }
//     teams   : the ship's DEPLOYING ground teams (groundTeams.ts deployableGroundTeams: every slotted member
//               ready AND the D18 minimum in each squad; no automatic stand-ins, user 2026-10-12), ascending
//               ship team index, member ids in slot order, `helpOthers` from the ship, an empty queue, idle.
//     factors : FROZEN at dispatch (D24), so a ship whose crew, officers or captain change mid-run never
//               reshapes it (the same contract as the run's other snapshots):
//       medicalShare / rapidRecoveryShare : injuries.ts shipInjuryFactors (crew.reducedCrewLosses; the Rapid
//                                           Recovery officer, officerBonusTotal(officer.repairRateMult)).
//       officerFacetShare / injurySteady  : the run's frozen Medical facets (recoveryTurnaround + quickRecovery;
//                                           injurySteady), mapped by medicalBay.ts bayCareFrom, the ONE place
//                                           the bay mapping is written. GO-7b reads the bay care back with
//                                           groundOpsBayCare(factors) (the four fields, as they were frozen).
//       offloadMult : crewOverlay.ts effectiveShipStats(...).unloadSpeedMult (the crew Efficient Unloading and
//                     Veteran Instincts multiplier missions use; absent = 1). Divides the offload step.
//       reloadMult  : 1 + crew.loadSpeed (Rapid Loadout, shipCrewContribution) + Efficient Stowage (captain
//                     secondary talent logistics4, D26). Divides the reload step.
//       securityShare[i] / scienceShare[i] : deployed team i's share of the ship's crew layer = its squad size /
//                     every deployed squad of that type [PROPOSAL, Q20]. With one team both are [1], so every
//                     crew-layer read (exp.securityStrength x share, exp.scienceStrength x share) equals today.
//     shipEventProfile : NEUTRAL_SHIP_EVENT_PROFILE until GO-8 snapshots the real one.
//   snapshotAwayRosterForTeams(state, ship, teams) : the run's UNION roster (Expedition.roster): Security then
//     Science members of the deployed teams, team order then slot order. Scan readers keep reading exp.roster.
//
// Module graph (plan section 2): groundOps.ts imports model, awayTeam, groundTeams, medicalBay, injuries,
// crewOverlay, crewBuffs. It NEVER imports expedition.ts (expedition.ts will import this). PURE throughout.

import {
  SECONDARY_CAPTAIN_TALENTS,
  type AwayMember,
  type AwayRosterSnapshot,
  type AwayTeamType,
  type Expedition,
  type GameState,
  type GroundOpsFactors,
  type GroundStepKind,
  type GroundTeamRun,
  type ShipEventProfile,
  type ShipInstance,
} from "./model";
import { snapshotMembers } from "./awayTeam";
import { deployableGroundTeams, shipGroundTeams } from "./groundTeams";
import { bayCareFrom, type BayCare } from "./medicalBay";
import { shipInjuryFactors } from "./injuries";
import { effectiveShipStats, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";

export type { GroundOpsFactors, GroundStepKind, GroundTeamRun, ShipEventProfile };

// What snapshotGroundOps returns; GO-7b wraps it into the stored GroundOpsState.
export interface GroundOpsSnapshot {
  teams: GroundTeamRun[];
  factors: GroundOpsFactors;
  shipEventProfile: ShipEventProfile;
}

// The run's frozen Medical facets snapshotGroundOps folds into the bay factors (startExpedition computes them
// at the same dispatch instant; quickRecovery is rolled on the run's seed, so it is passed in, never re-rolled).
export type GroundOpsRunFacets = Pick<Expedition, "recoveryTurnaround" | "quickRecovery" | "injurySteady">;

// The ship-event profile a run carries until GO-8 snapshots the real one. No reader exists yet; frozen so a
// snapshot can never mutate the shared value (snapshotGroundOps writes a fresh copy).
export const NEUTRAL_SHIP_EVENT_PROFILE: Readonly<ShipEventProfile> = Object.freeze({
  evasion: 0,
  sensors: 0,
  shieldCapacity: 0,
  engineering: 0,
  boardingDefense: 0,
});

// Efficient Stowage (captain secondary talent logistics4, "+pre-mission load speed"): D26 points it at the
// Ground Ops reload step. Read from the catalog entry (+0.08), so the data stays the one source. NOTE: the
// captain SECONDARY tree is otherwise DORMANT (captainSecondaryTree.ts: nothing else applies its nodes yet);
// this is its first and only live node. Rapid Turnaround (logistics3, unload) on the offload is Q22, unbuilt.
const STOWAGE_EFFECT = SECONDARY_CAPTAIN_TALENTS.logistics4.effect;
export const EFFICIENT_STOWAGE_RELOAD: number = STOWAGE_EFFECT.type === "statMult" ? STOWAGE_EFFECT.mult : 0;

// A multiplier that DIVIDES a step: a finite positive number, else 1 (a bad value never stalls or skips a step).
function stepMult(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
}

// A non-negative finite share (a missing or bad value reads 0).
function nonNegative(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

// Each entry's share of the total (0 for every entry when the total is 0). Pure.
function sharesOf(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((n) => (total > 0 ? n / total : 0));
}

// The reload divisor (see the header): 1 + Rapid Loadout + Efficient Stowage on the ship's ASSIGNED captain.
// Pure.
export function groundReloadMult(state: GameState, ship: ShipInstance): number {
  const loadSpeed = nonNegative(shipCrewContribution(state, ship)[CREW_STAT_KEYS.loadSpeed]);
  const captain = ship.assignedCaptainId === null ? undefined : state.captains.find((c) => c.id === ship.assignedCaptainId);
  const stowage = captain?.unlockedSecondaryTalents.includes("logistics4") ? EFFICIENT_STOWAGE_RELOAD : 0;
  return stepMult(1 + loadSpeed + stowage);
}

// The dispatch snapshot (see the header). `run` = the run's frozen Medical facets. Pure: fresh data, no live
// references, no randomness.
export function snapshotGroundOps(state: GameState, ship: ShipInstance, run: GroundOpsRunFacets): GroundOpsSnapshot {
  const now = state.gameTimeSeconds;
  const slots = shipGroundTeams(ship);
  const deploying = deployableGroundTeams(state, ship.id).teams.filter((t) => t.deploys);
  const teams: GroundTeamRun[] = deploying.map((t) => ({
    index: t.index,
    securityIds: t.security.map((m) => m.id),
    scienceIds: t.science.map((m) => m.id),
    helpOthers: slots[t.index]?.helpOthers === true,
    queue: [],
    step: "idle",
    stepStartedAt: now,
    stepEndsAt: null,
    skippedBorrowed: [],
    downedThisTask: [],
    conditions: {},
    bayEnds: {},
  }));
  const care = bayCareFrom(shipInjuryFactors(state, ship), run);
  const factors: GroundOpsFactors = {
    medicalShare: care.medicalShare,
    rapidRecoveryShare: care.rapidRecoveryShare,
    officerFacetShare: care.officerFacetShare,
    injurySteady: care.injurySteady,
    offloadMult: stepMult(effectiveShipStats(state, ship).unloadSpeedMult),
    reloadMult: groundReloadMult(state, ship),
    securityShare: sharesOf(teams.map((t) => t.securityIds.length)),
    scienceShare: sharesOf(teams.map((t) => t.scienceIds.length)),
  };
  return { teams, factors, shipEventProfile: { ...NEUTRAL_SHIP_EVENT_PROFILE } };
}

// The bay care a run's frozen factors carry (GO-7b passes it to medicalBay.ts memberBaySeconds). Pure.
export function groundOpsBayCare(factors: GroundOpsFactors): BayCare {
  return {
    medicalShare: factors.medicalShare,
    rapidRecoveryShare: factors.rapidRecoveryShare,
    officerFacetShare: factors.officerFacetShare,
    injurySteady: factors.injurySteady,
  };
}

// The run's UNION roster for the deployed `teams` (see the header): Security then Science, team order then
// slot order. An id that does not name a member aboard `ship` with that squad's type, or repeats, is skipped.
// Pure: fresh snapshot data (awayTeam.ts snapshotMembers, the same freeze as snapshotAwayRoster).
export function snapshotAwayRosterForTeams(
  state: GameState,
  ship: ShipInstance,
  teams: readonly Pick<GroundTeamRun, "securityIds" | "scienceIds">[],
): AwayRosterSnapshot {
  const byId = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const seen = new Set<string>();
  const pick = (teamType: AwayTeamType, ids: (t: Pick<GroundTeamRun, "securityIds" | "scienceIds">) => readonly string[]): AwayMember[] => {
    const out: AwayMember[] = [];
    for (const team of teams) {
      for (const id of ids(team)) {
        const m = byId.get(id);
        if (!m || seen.has(id) || m.assignedShipId !== ship.id || m.teamType !== teamType) continue;
        seen.add(id);
        out.push(m);
      }
    }
    return out;
  };
  const security = pick("security", (t) => t.securityIds);
  const science = pick("science", (t) => t.scienceIds);
  return { security: snapshotMembers(state, security), science: snapshotMembers(state, science) };
}
