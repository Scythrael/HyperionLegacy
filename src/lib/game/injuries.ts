// E-CREW "Crew Made Real" Task 16: AWAY-TEAM INJURIES (design D9, section 5.6), since Ground Operations (GO-7b,
// D24 + D25) the claim side of the MEDICAL BAY.
//
// A member who falls in a ground fight goes to the ship's medical bay (groundOps.ts, medicalBay.ts: each condition on
// its own clock, the run's FROZEN medical factors). At the claim a member still in the bay comes home INJURED with the
// time left: they cannot deploy until AwayMember.injuredUntilSeconds (awayTeam.ts isMemberReady keeps them out of the
// dispatch snapshot and the D18 minimum-team check). Gear and implants stay on them (D9).
//
// Wiring OC-G1 (user 2026-10-16 "Delete it"): the legacy (pre-Ground-Ops) claim's FLAT injury (a 2 hour base over the
// ship's care, applyExpeditionInjuries / injuryRecoverySeconds) is deleted with the legacy path. A legacy run still in
// a save is finished at load (save.ts) and claimed with no bay, so its whole team comes home ready.
//
// PURE: every function reads its inputs and returns new values; nothing here draws a random number.

import type { AwayMember, Expedition, GameState, ShipInstance } from "./model";
import { officerBonusTotal, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";

// The span a stored injury WITHOUT a start (injuredAtSeconds) measures its recovery bar against (display only,
// injuryRecoveredFraction): the flat injury's 2 hour base, which every such injury was given.
export const INJURY_BASE_RECOVERY_SECONDS = 2 * 3600;

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

// ===== The ship's care =====

// The ship's two live care shares for its injured away team (GO-7a freezes them on the run at dispatch,
// groundOps.ts snapshotGroundOps; medicalBay.ts bayCareFrom maps them into the bay's care).
export interface InjuryRecoveryFactors {
  medicalShare: number; // the Medical division's injury buff (crew.reducedCrewLosses)
  rapidRecoveryShare: number; // the Rapid Recovery officer bonus (officer.repairRateMult)
}

// The ship's care for its injured away team, read live. Zero for a missing ship. Pure.
export function shipInjuryFactors(state: GameState, ship: ShipInstance | undefined): InjuryRecoveryFactors {
  if (!ship) return { medicalShare: 0, rapidRecoveryShare: 0 };
  return {
    medicalShare: shipCrewContribution(state, ship)[CREW_STAT_KEYS.reducedCrewLosses] ?? 0,
    rapidRecoveryShare: officerBonusTotal(state, ship, "officer.repairRateMult"),
  };
}

// ===== Claim =====

export interface MemberInjury {
  memberId: string;
  recoverySeconds: number;
  untilSeconds: number; // gameTimeSeconds the member is ready again
}

// Ground Operations (GO-7b, D24 + D25): bring a claimed run's teams home. There is no flat injury:
// the medical bay ran during the run (groundOps.ts: each member's own cure time on the run's FROZEN medical
// factors), and it keeps running through the return leg, so at the claim only a member whose latest bay end
// (GroundTeamRun.bayEnds) is still in the future comes home injured, with exactly the time left
// (injuredUntilSeconds = that bay end, injuredAtSeconds = that bay's start). Everyone else is ready ("anyone
// still in the bay comes home with the remaining time"). A member no longer on the roster is skipped; a member
// somehow already injured keeps the LATER timer. Returns the SAME state when nobody is still in the bay (always for a
// legacy run finished at load: it has no bay, OC-G1). Pure.
//
// 0.14.0 SPEED SEAM: a time-skipped run (processSpeed.ts applyTimeSkip) ran its own clock ahead of the game clock by
// exp.speed.clockOffsetSeconds, so its bay times are on that clock. `now` is read on the run's clock (the game time
// plus the offset) and every time written back is shifted onto the game clock (minus the offset): the member comes
// home exactly as from the run claimed at its natural end. Without a skip the offset is 0 (byte-identical).
export function applyGroundOpsInjuries(state: GameState, exp: Expedition): { next: GameState; injuries: MemberInjury[] } {
  const offset = exp.speed?.clockOffsetSeconds ?? 0;
  const now = state.gameTimeSeconds + offset;
  const injuries: MemberInjury[] = [];
  const startOf = new Map<string, number>();
  for (const team of exp.groundOps?.teams ?? []) {
    for (const [memberId, until] of Object.entries(team.bayEnds)) {
      if (!(until > now) || startOf.has(memberId)) continue;
      if (!state.awayMembers.some((m) => m.id === memberId)) continue;
      injuries.push({ memberId, recoverySeconds: until - now, untilSeconds: until - offset });
      startOf.set(memberId, (team.bayStart ?? now) - offset);
    }
  }
  if (injuries.length === 0) return { next: state, injuries };
  const byId = new Map(injuries.map((i) => [i.memberId, i] as const));
  const awayMembers = state.awayMembers.map((m): AwayMember => {
    const injury = byId.get(m.id);
    if (!injury) return m;
    if (m.injuredUntilSeconds !== undefined && m.injuredUntilSeconds >= injury.untilSeconds) return m;
    return { ...m, injuredUntilSeconds: injury.untilSeconds, injuredAtSeconds: startOf.get(m.id) ?? state.gameTimeSeconds };
  });
  return { next: { ...state, awayMembers }, injuries };
}

// ===== Display =====

// The share of the current injury already recovered, 0..1, for the recovery bar. Reads the injury's own
// span (injuredAtSeconds to injuredUntilSeconds); an injury stored without a start measures against
// INJURY_BASE_RECOVERY_SECONDS. 1 when the member is ready. Pure.
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
