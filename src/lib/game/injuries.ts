// E-CREW "Crew Made Real" Task 16: AWAY-TEAM INJURIES (design D9, section 5.6).
//
// A member DOWNED in any battle of an expedition sits out the rest of that run (gambit.ts
// scanDownedBefore / activityDownedBefore) and, when the player claims the run, comes home INJURED: they
// cannot deploy until AwayMember.injuredUntilSeconds (awayTeam.ts isMemberReady keeps them out of the
// dispatch snapshot and the D18 minimum-team check). Gear and implants stay on them (D9).
//
// RECOVERY (FIRST-PASS TUNABLE): a 2 hour base, shortened by the ship's MEDICAL care:
//   recovery = max(INJURY_MIN_RECOVERY_SECONDS, round(INJURY_BASE_RECOVERY_SECONDS / (1 + care)))
//   care     = medicalShare + rapidRecoveryShare + treatmentShare   (each clamped at 0 or more)
// where medicalShare is the Medical division's injury buff (crew.reducedCrewLosses, "Reduced Crew Losses",
// from the complement, amplified by the museum like every crew number), rapidRecoveryShare is the Rapid
// Recovery officer bonus (officer.repairRateMult, "Speeds hull and crew recovery"), and treatmentShare is a
// per-member HOOK for the Injury Kit (Task 16b Field Kits: treating a downed ally shortens their recovery;
// 0 until kits exist). The plan's first pass read "2h * (1 - shares), floor 15m"; this divides instead so the
// care follows D23 (diminishing returns, never a cap): every share point still shortens the injury, each a
// little less than the last, and the timer can never reach 0. The 15 minute floor is the plan's.
// Fleet Triage (officer.crewLossPrevention) is the IN-BATTLE healing bonus (design 6.1), never read here.
//
// PURE: every function reads its inputs and returns new values; nothing here draws a random number.

import type { AwayMember, Expedition, GameState, ShipInstance } from "./model";
import { officerBonusTotal, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { expeditionDownedMemberIds } from "./gambit";

export const INJURY_BASE_RECOVERY_SECONDS = 2 * 3600;
export const INJURY_MIN_RECOVERY_SECONDS = 15 * 60;

// ===== What happens to a member who falls =====

// Who fell, where. The future Safety Interlock reads more (the run's difficulty setting, a keyed seed).
export interface MemberFallContext {
  memberId: string;
  expeditionId: string;
}

export type MemberFallOutcome = "injured";

// The ONE place a fall's consequence is decided. Today every fall is an injury (D9: "A downed member is
// INJURED and recovers"). SAFETY INTERLOCK (future, user direction; shares the ship-combat interlock design):
// with the player's opt-in interlock DISENGAGED on a harder difficulty, this is where a fall may instead be
// permanent ("killed"), rolled from its own keyed stream so offline == live holds. Until that design lands
// there is no other branch.
export function memberFallOutcome(_ctx: MemberFallContext): MemberFallOutcome {
  return "injured";
}

// ===== Recovery =====

export interface InjuryRecoveryFactors {
  medicalShare: number; // the Medical division's injury buff (crew.reducedCrewLosses)
  rapidRecoveryShare: number; // the Rapid Recovery officer bonus (officer.repairRateMult)
  // E-CREW Task 21: the Medical department's officer stat facets, FROZEN on the run at dispatch
  // (Expedition.recoveryTurnaround, Constitution's shorter turnaround, + Expedition.quickRecovery, Cunning's
  // quicker recovery). Optional: absent = 0, so a run without them recovers exactly as before.
  officerFacetShare?: number;
}

// The ship's care for its injured away team, read live (at claim). Zero for a missing ship. Pure.
export function shipInjuryFactors(state: GameState, ship: ShipInstance | undefined): InjuryRecoveryFactors {
  if (!ship) return { medicalShare: 0, rapidRecoveryShare: 0 };
  return {
    medicalShare: shipCrewContribution(state, ship)[CREW_STAT_KEYS.reducedCrewLosses] ?? 0,
    rapidRecoveryShare: officerBonusTotal(state, ship, "officer.repairRateMult"),
  };
}

// How long one injury lasts, in whole seconds (see the header). `treatmentShare` is the per-member hook
// (the Injury Kit, Task 16b); 0 today. Pure.
export function injuryRecoverySeconds(factors: InjuryRecoveryFactors, treatmentShare: number = 0): number {
  const facets = Math.max(0, factors.officerFacetShare ?? 0);
  const base = Math.max(0, factors.medicalShare) + Math.max(0, factors.rapidRecoveryShare) + Math.max(0, treatmentShare);
  const care = facets === 0 ? base : base + facets;
  return Math.max(INJURY_MIN_RECOVERY_SECONDS, Math.round(INJURY_BASE_RECOVERY_SECONDS / (1 + care)));
}

// ===== Claim =====

export interface MemberInjury {
  memberId: string;
  recoverySeconds: number;
  untilSeconds: number; // gameTimeSeconds the member is ready again
}

// Bring a claimed run's away team home: every member downed during the run (gambit.ts
// expeditionDownedMemberIds, in order of first going down) whose fall outcome is "injured" gets
// injuredUntilSeconds = now + recovery and injuredAtSeconds = now. A member no longer on the roster (fired
// mid-run) is skipped. A member somehow already injured keeps the LATER of the two timers. Returns the SAME
// state when nobody was hurt. Pure.
export function applyExpeditionInjuries(state: GameState, exp: Expedition): { next: GameState; injuries: MemberInjury[] } {
  const downed = expeditionDownedMemberIds(exp);
  if (downed.length === 0) return { next: state, injuries: [] };
  const shipFactors = shipInjuryFactors(state, state.ships.find((s) => s.id === exp.shipId));
  // E-CREW (Task 21): the run's frozen Medical facets join the care (see InjuryRecoveryFactors).
  const officerFacetShare = (exp.recoveryTurnaround ?? 0) + (exp.quickRecovery ?? 0);
  const factors = officerFacetShare > 0 ? { ...shipFactors, officerFacetShare } : shipFactors;
  const now = state.gameTimeSeconds;
  const injuries: MemberInjury[] = [];
  const byId = new Map<string, MemberInjury>();
  for (const memberId of downed) {
    if (!state.awayMembers.some((m) => m.id === memberId)) continue;
    if (memberFallOutcome({ memberId, expeditionId: exp.id }) !== "injured") continue;
    // Task 16b hook: a treated member (the Injury Kit) passes their own treatmentShare here.
    const recoverySeconds = injuryRecoverySeconds(factors, 0);
    const injury = { memberId, recoverySeconds, untilSeconds: now + recoverySeconds };
    injuries.push(injury);
    byId.set(memberId, injury);
  }
  if (injuries.length === 0) return { next: state, injuries };
  const awayMembers = state.awayMembers.map((m): AwayMember => {
    const injury = byId.get(m.id);
    if (!injury) return m;
    if (m.injuredUntilSeconds !== undefined && m.injuredUntilSeconds >= injury.untilSeconds) return m;
    return { ...m, injuredUntilSeconds: injury.untilSeconds, injuredAtSeconds: now };
  });
  return { next: { ...state, awayMembers }, injuries };
}

// ===== Display =====

// The share of the current injury already recovered, 0..1, for the recovery bar. Reads the injury's own
// span (injuredAtSeconds to injuredUntilSeconds); an injury stored without a start measures against the 2h
// base. 1 when the member is ready. Pure.
export function injuryRecoveredFraction(
  member: Pick<AwayMember, "injuredAtSeconds" | "injuredUntilSeconds">,
  nowSeconds: number,
): number {
  const until = member.injuredUntilSeconds;
  if (until === undefined || until <= nowSeconds) return 1;
  const span = member.injuredAtSeconds !== undefined ? until - member.injuredAtSeconds : INJURY_BASE_RECOVERY_SECONDS;
  if (!(span > 0)) return 1;
  const left = Math.min(until - nowSeconds, span);
  return Math.max(0, Math.min(1, 1 - left / span));
}
