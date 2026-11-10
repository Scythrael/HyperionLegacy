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
// This module imports only model.ts (and captainPrimaryEffects.ts, which imports only model.ts: WR-6 folds the
// Explorer hub and the science spec into the same frozen records); captainSecondaryEffects.ts reads explorerTalentText below for the tooltip and
// the registry claim (its lookup chain: prospector, tactician, explorer).

import {
  SECONDARY_CAPTAIN_TALENTS,
  SENIOR_STAFF_ROSTER_BASE,
  commandingCaptain,
  personnelRostersBoardSlots,
  type CaptainState,
  type ExpeditionScanParams,
  type ExplorerCaptainRun,
  type GameState,
  type SecondaryTalentKey,
} from "./model";
// WR-6: the primary tree's Survey Doctrine and the science spec fold into the same frozen records (imports model.ts only).
import { captainPrimaryMult } from "./captainPrimaryEffects";

type Captain = CaptainState | undefined | null;

// ============================================================================
// Catalog reads
// ============================================================================

// A node's configured size: a statMult's mult, a procChance's chance, a capstone's magnitude, a levelLift's levels,
// a flatAdd's amount; 0 for a gateway. Pure.
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
    case "flatAdd":
      return e.amount;
    case "creditTrickle": // a Prospector shape (Trade Routes); no explorer node carries it
      return 0;
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

// The captain who commands `ship` (OC-A2) is model.ts commandingCaptain, the one copy every tree's readers share.

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
// WR-6: Survey Doctrine (the Explorer hub, a primary talent) is its own scan rate factor beside Cartographer.
export function captainSurveyScanParams(captain: Captain): Partial<ExpeditionScanParams> {
  const out: Partial<ExpeditionScanParams> = {};
  const scanRate = factor(captain, "surveySensors2") * captainPrimaryMult(captain, "scanRateMult");
  if (scanRate !== 1) out.captainScanRateMult = scanRate;
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

// The run-frozen nodes (Expedition.explorerCaptain), or undefined when the captain owns none. WR-6: the science
// spec's relic find bonus is its own factor beside Field Science. Pure.
export function explorerCaptainRun(captain: Captain): ExplorerCaptainRun | undefined {
  const run: ExplorerCaptainRun = {};
  const relicFind = factor(captain, "expeditionRelics2") * captainPrimaryMult(captain, "relicFindMult");
  if (relicFind !== 1) run.relicFindMult = relicFind;
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
  return ship ? captainPromotionMult(commandingCaptain(state, ship)) : 1;
}

// commandCrew4 Recruiter: both candidate boards (officers and away-team recruits) show exactly ONE more candidate
// slot (Complement CP-19, USER ANSWERS 2026-11-09 "Flat +1 always": replaces WR-5c's x1.08 rounded up, which was +1
// only on the base board of 10). The boards are fleet-wide, so there is no "own ship" here. User 2026-10-19 ("Best one
// counts"): the boards use the best Recruiter owned by any captain of the fleet; a second captain owning it adds
// nothing. The talent is owned or not (no ranks), so the best one is the catalog's amount. Slots are keyed by index,
// so a larger board appends candidates and leaves the others as they were. Exactly the stored size without a Recruiter.
// Complement CP-19: the board is the stored size PLUS the Personnel Rosters track's slots (model.ts
// personnelRostersBoardSlots: +2 per bought rung, 0 at the pre-granted Level 1) PLUS the Recruiter's flat slot.
// Pure.
export function candidateBoardSize(state: Pick<GameState, "captains" | "seniorStaffRosterSize" | "facilities">): number {
  const base = Math.max(0, state.seniorStaffRosterSize ?? SENIOR_STAFF_ROSTER_BASE) + personnelRostersBoardSlots(state);
  return base + recruiterBoardSlots(state);
}

// The Recruiter's slots on each board: the best owned by any captain of the fleet (best one counts), 0 without one.
// Pure.
export function recruiterBoardSlots(state: Pick<GameState, "captains">): number {
  let best = 0;
  for (const c of state.captains) best = Math.max(best, owned(c, "commandCrew4"));
  return Math.max(0, Math.floor(best));
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
    case "commandCrew4":
      return `+${m} candidate slot${m === 1 ? "" : "s"} on each candidate board (officers and away-team recruits), at any board size; fleet-wide, the best Recruiter counts and a second one adds nothing`;
    case "commandCrew5":
      return `Legendary Captain: +${pct(m)} to every complement buff and officer bonus on this ship`;
    default:
      return null;
  }
}
