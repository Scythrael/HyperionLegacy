// WR-5c (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5c, section 5.A and the
// USER ANSWERS OC-A1 / OC-A2 / OC-A3 and the 2026-10-17 WR-5a calls): the captain SECONDARY talent effect READERS of
// the EXPLORER tree (Survey & Sensors, Expedition & Relics, Command & Crew) and each node's player text.
//
// The user's rulings, as they apply here:
//   "Always multiply" (2026-10-17): every "+X%" node is its own x (1 + X) factor on the value it names, compounding
//     with that value's other bonuses (never added into another sum).
//   OC-A2 "own ship": a node acts on the ship its captain commands (ship.assignedCaptainId). A run reads it FROZEN at
//     dispatch (the scan params, the sensor power, the squad strengths and Expedition.explorerCaptain); missions and
//     the ship stat sheet read it live, exactly like the officer bonuses on the same ship; a patrol freezes it per
//     cycle with the officer combat record it scales. "Block buying while out": captainSecondaryTree.ts refuses a buy
//     while the captain's ship is out (WR-5a), so a node never changes under a run in flight.
//   OC-A3 "Proposed sizes": every capstone carries its configured magnitude; Foreknowledge is no placeholder (its
//     consumer is the expedition candidates' telescope reading).
//
// Every magnitude is read from the catalog (model.ts SECONDARY_CAPTAIN_TALENTS) by the node's KEY, so a retune is a
// data edit. Every reader is PURE and returns the exact neutral value (1, 0, false, undefined) without the node, so a
// captain without explorer nodes changes nothing, byte for byte.
//
// MERGE NOTE (WR-5a builds captainSecondaryEffects.ts in parallel): this module imports only model.ts, and
// captainSecondaryEffects.ts reads explorerTalentText below for the tooltip. Take WR-5a's captainSecondaryEffects.ts
// and route the explorer keys to explorerTalentText (and give its magnitude switch the `levelLift` case).

import {
  SECONDARY_CAPTAIN_TALENTS,
  SENIOR_STAFF_ROSTER_BASE,
  type CaptainState,
  type ExpeditionScanParams,
  type ExplorerCaptainRun,
  type GameState,
  type SecondaryTalentKey,
} from "./model";

type Captain = CaptainState | undefined | null;

// ============================================================================
// Catalog reads
// ============================================================================

// A node's configured size: a statMult's mult, a procChance's chance, a capstone's magnitude, a levelLift's levels;
// 0 for a gateway. Pure.
export function explorerNodeMagnitude(key: SecondaryTalentKey): number {
  const e = SECONDARY_CAPTAIN_TALENTS[key].effect;
  switch (e.type) {
    case "statMult":
      return e.mult;
    case "procChance":
      return e.chance;
    case "capstone":
      return e.magnitude ?? 0;
    case "levelLift":
      return e.levels;
    case "none":
      return 0;
  }
}

function owns(captain: Captain, key: SecondaryTalentKey): boolean {
  return captain?.unlockedSecondaryTalents.includes(key) === true;
}

// The node's size when the captain owns it, else 0.
function owned(captain: Captain, key: SecondaryTalentKey): number {
  return owns(captain, key) ? explorerNodeMagnitude(key) : 0;
}

// x (1 + the node's size) when owned, exactly 1 otherwise.
function factor(captain: Captain, key: SecondaryTalentKey): number {
  const m = owned(captain, key);
  return m === 0 ? 1 : 1 + m;
}

// The captain who commands `ship` (OC-A2), or undefined for an unassigned hull. Pure.
export function explorerCaptainOf(state: Pick<GameState, "captains">, ship: { assignedCaptainId: number | null }): CaptainState | undefined {
  return ship.assignedCaptainId === null ? undefined : state.captains.find((c) => c.id === ship.assignedCaptainId);
}

// ============================================================================
// Survey & Sensors
// ============================================================================

// surveySensors1 Keen Sensors: the ship's sensors x this (crewOverlay.ts effectiveShipStats, so surveys, the expedition
// sensor snapshot, the telescope lift and the ship events all read it). Nothing at 0 sensors (a multiplier).
export function captainSensorsMult(captain: Captain): number {
  return factor(captain, "surveySensors1");
}

// The captain's survey nodes as optional scan-param fields (expedition.ts shipSensorSnapshot folds them in, so the
// dispatch freezes them and every candidate preview reads them): Cartographer (scan rate), Anomaly Sense (discovery
// odds), Deep Scan (sure discovery attempts per body). {} without them. Pure.
export function captainSurveyScanParams(captain: Captain): Partial<ExpeditionScanParams> {
  const out: Partial<ExpeditionScanParams> = {};
  if (owns(captain, "surveySensors2")) out.captainScanRateMult = factor(captain, "surveySensors2");
  if (owns(captain, "surveySensors3")) out.captainDiscoveryMult = factor(captain, "surveySensors3");
  const sure = Math.max(0, Math.floor(owned(captain, "surveySensors5")));
  if (sure > 0) out.captainSureFinds = sure;
  return out;
}

// How the captain lifts a candidate's telescope reading (telescope.ts readSystem): Foreknowledge adds whole detail
// levels, Deep Scan reads the system in full (top detail and every foreknowledge field). Display only, like the
// telescope itself; never past the telescope's range.
export interface CaptainTelescopeSight {
  lift: number;
  full: boolean;
}
export const NO_CAPTAIN_SIGHT: Readonly<CaptainTelescopeSight> = Object.freeze({ lift: 0, full: false });
export function captainTelescopeSight(captain: Captain): Readonly<CaptainTelescopeSight> {
  const lift = Math.max(0, Math.floor(owned(captain, "surveySensors4")));
  const full = owns(captain, "surveySensors5");
  return lift === 0 && !full ? NO_CAPTAIN_SIGHT : { lift, full };
}

// ============================================================================
// Expedition & Relics
// ============================================================================

// expeditionRelics1 Expedition Lead: the away team's crew-derived Security and Science strengths x this (gambit.ts
// deriveAwayTeam, frozen at dispatch). Nothing at 0 strength (a multiplier).
export function captainSquadStrengthMult(captain: Captain): number {
  return factor(captain, "expeditionRelics1");
}

// The run-frozen nodes (Expedition.explorerCaptain), or undefined when the captain owns none. Pure.
export function explorerCaptainRun(captain: Captain): ExplorerCaptainRun | undefined {
  const run: ExplorerCaptainRun = {};
  if (owns(captain, "expeditionRelics2")) run.relicFindMult = factor(captain, "expeditionRelics2");
  if (owns(captain, "expeditionRelics3")) run.squadPowerMult = factor(captain, "expeditionRelics3");
  if (owns(captain, "expeditionRelics4")) run.relicStudySpeed = owned(captain, "expeditionRelics4");
  const tiers = Math.max(0, Math.floor(owned(captain, "expeditionRelics5")));
  if (tiers > 0) run.relicTierLift = tiers;
  if (owns(captain, "commandCrew3")) run.promotionMult = factor(captain, "commandCrew3");
  return Object.keys(run).length > 0 ? run : undefined;
}

// ============================================================================
// Command & Crew
// ============================================================================

// commandCrew1 Inspiring Leader x commandCrew5 Legendary Captain: the ship's COMPLEMENT buffs (the bucket rollup and
// its assigned notables) x this (crewOverlay.ts rawShipCrewContribution). Officers are scaled by the factor below.
export function captainComplementMult(captain: Captain): number {
  return factor(captain, "commandCrew1") * factor(captain, "commandCrew5");
}

// commandCrew2 Mentor x commandCrew5 Legendary Captain: every officer bonus (and racial) aboard x this, wherever the
// bridge module amplifies them (the crew map, officerBonusTotal, the officer combat profile).
export function captainOfficerOutputMult(captain: Captain): number {
  return factor(captain, "commandCrew2") * factor(captain, "commandCrew5");
}

// commandCrew3 Drillmaster: every promotion counter increment of the ship's officers x this (crewOverlay.ts
// foldOfficerMissionCompletions / foldOfficerPromotionCounters; an expedition's claim reads the frozen copy).
export function captainPromotionMult(captain: Captain): number {
  return factor(captain, "commandCrew3");
}

// The promotion multiplier of the ship `shipId` (its commanding captain's Drillmaster), 1 for an unknown ship. Pure.
export function shipPromotionMult(state: Pick<GameState, "captains" | "ships">, shipId: string): number {
  const ship = state.ships.find((s) => s.id === shipId);
  return ship ? captainPromotionMult(explorerCaptainOf(state, ship)) : 1;
}

// commandCrew4 Recruiter: both candidate boards (officers and away-team recruits) show the stored board size x
// (1 + X) for every captain of the fleet who owns it (each its own factor), ROUNDED UP to whole candidates: 8% of
// the base 10 is 0.8, so one Recruiter adds 1 candidate. The boards are fleet-wide, so there is no "own ship" here
// [PROVISIONAL]. Slots are keyed by index, so a larger board appends candidates and leaves the others as they were.
// Exactly the stored size without a Recruiter. Pure.
const BOARD_ROUNDING_GUARD = 1e-9; // a float product a hair above a whole number (10 x 1.0000000001) stays that number
export function candidateBoardSize(state: Pick<GameState, "captains" | "seniorStaffRosterSize">): number {
  const base = Math.max(0, state.seniorStaffRosterSize ?? SENIOR_STAFF_ROSTER_BASE);
  let mult = 1;
  for (const c of state.captains) mult *= factor(c, "commandCrew4");
  return mult === 1 ? base : Math.ceil(base * mult - BOARD_ROUNDING_GUARD);
}

// ============================================================================
// Player text (the talent tooltip and the registry claim read THIS, so they agree)
// ============================================================================

const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;

// The exact text of an explorer node, from the catalog magnitudes; null for a node of another tree. Pure.
export function explorerTalentText(key: SecondaryTalentKey): string | null {
  const m = explorerNodeMagnitude(key);
  switch (key) {
    case "surveySensors1":
      return `+${pct(m)} ship sensors (surveys, expedition scans and the telescope's ship lift)`;
    case "surveySensors2":
      return `+${pct(m)} expedition scan rate`;
    case "surveySensors3":
      return `+${pct(m)} odds on every expedition discovery attempt`;
    case "surveySensors4":
      return `+${m} telescope detail level${m === 1 ? "" : "s"} on expedition candidates (within the telescope's range)`;
    case "surveySensors5":
      return `Deep Scan: candidates read in full detail, and the first ${m === 1 ? "discovery attempt" : `${m} discovery attempts`} on each body always find something`;
    case "expeditionRelics1":
      return `+${pct(m)} away team crew strength (Security and Science)`;
    case "expeditionRelics2":
      return `+${pct(m)} relic find chance on expedition objectives`;
    case "expeditionRelics3":
      return `+${pct(m)} Security squad power and accuracy in ground fights`;
    case "expeditionRelics4":
      return `+${pct(m)} study speed for the relics this ship recovers`;
    case "expeditionRelics5":
      return `Relic Hunter: relics this ship recovers can roll ${m === 1 ? "one rarity tier" : `${m} rarity tiers`} higher`;
    case "commandCrew1":
      return `+${pct(m)} to every complement buff on this ship`;
    case "commandCrew2":
      return `+${pct(m)} to every officer bonus on this ship`;
    case "commandCrew3":
      return `+${pct(m)} promotion objective progress for this ship's officers`;
    case "commandCrew4": {
      const extra = Math.ceil(SENIOR_STAFF_ROSTER_BASE * (1 + m) - BOARD_ROUNDING_GUARD) - SENIOR_STAFF_ROSTER_BASE;
      return `+${pct(m)} candidate board size, rounded up (+${extra} on each board of ${SENIOR_STAFF_ROSTER_BASE})`;
    }
    case "commandCrew5":
      return `Legendary Captain: +${pct(m)} to every complement buff and officer bonus on this ship`;
    default:
      return null;
  }
}
