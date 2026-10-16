// WR-2 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-2): THE SIMULATED
// PLAYER'S HANDS. Every action a sim policy can take, each a thin wrapper over the SAME pure engine function the
// matching `do*` handler in App.svelte calls (dispatch, recall, launch, claim, hire, requisition and install, buy a
// talent, start a facility rung). Each returns one uniform result so the driver can log what the player tried and
// why the game refused it.
//
// Rules: pure (no state writes outside the returned state), deterministic (no Math.random, no Date.now), and NO
// engine change: when a policy needs something the engine does not expose, the sim reports it instead.
// Test-side only: imported by the sim and its tests, never by app code.

import {
  CAPTAIN_TALENTS,
  FACILITIES,
  HOMEWORLD_TALENTS,
  freshState,
  SECONDARY_CAPTAIN_TALENTS,
  type AwayTeamType,
  type CaptainTalentKey,
  type GameState,
  type HomeworldTalentKey,
  type MissionKey,
  type PatrolKey,
  type SecondaryTalentKey,
  type ShipTypeKey,
} from "../model";
import {
  buyCaptainTalent,
  buyHomeworldTalent,
  canBuildFacilityUpgrade,
  canDispatch,
  canDispatchPatrol,
  dispatchCaptainOnMission,
  dispatchCaptainOnPatrol,
  installMissingCombatBaselines,
  recallCaptain,
  startFacilityUpgrade,
} from "../tick";
import { claimExpedition, expeditionCandidates, startExpedition } from "../expedition";
import { awayRecruitCandidates, canHireAwayMember, hireAwayMember } from "../awayTeam";
import { requisitionStandardIssue } from "../quartermaster";
import { canFitToMember, fitToMember, memberSlotPieces } from "../memberEquipment";
import { buySecondaryTalent, canBuySecondaryTalent } from "../captainSecondaryTree";
import { withAwayTeam } from "../wiring/probes";
import type { CombatStance } from "../combat/positioning";

// The sim plays the fresh save's own pair: ship-1 commanded by captain 1 (every registry transform targets them).
export const SIM_SHIP_ID = "ship-1";
export const SIM_CAPTAIN_ID = 1;

export interface ActionResult {
  readonly next: GameState;
  readonly ok: boolean;
  readonly reason?: string;
}

const refused = (state: GameState, reason: string): ActionResult => ({ next: state, ok: false, reason });
const done = (next: GameState): ActionResult => ({ next, ok: true });

// == start-of-game setup ==

// A new game exactly as the App starts one (App.svelte: `installMissingCombatBaselines(freshState())`), optionally
// with ship-1 retyped to `hull` FIRST and its combat Standard Issue installed after (the Safe First Runs section 2.5
// method, firstRunsGoldens.fixture.ts onHull), so the hull gets ITS OWN baselines (an Orion has one hardpoint;
// installing the freighter's baselines first would leave it two autocannons). The retype STANDS IN for owning the
// hull: it skips the hull blueprint and the whole build chain (Shipyard founding, salvaged components), so a run from
// it proves "unlosable once you own an explorer", not that a player can reach one (the balance pass's speedrun
// policy owns that; WR-2 carry note).
export function newGameState(hull: ShipTypeKey | null = null): GameState {
  const base = freshState();
  if (hull === null) return installMissingCombatBaselines(base);
  return installMissingCombatBaselines({ ...base, ships: base.ships.map((s) => (s.id === SIM_SHIP_ID ? { ...s, typeKey: hull } : s)) });
}

// The weakest crew that can launch (the D18 minimum: 1 Security + 1 Science, rank 1, no traits, no gear) slotted
// into ship-1's first ground team. The recruit board never offers a traitless rank 1 pair, so this is the wiring
// fixture's pair (probes.ts withAwayTeam, ids member-901 / member-902), which is also what lets every member-scoped
// registry transform land on the sim's crew. Safe First Runs OC-2: the first expedition is guaranteed for THIS crew.
export function fieldWeakestCrew(state: GameState): ActionResult {
  return done(withAwayTeam(state));
}

// Hire the board's first candidate of `teamType` (lowest rank first when `lowestRank`) into ship-1, through the
// real hire (free, auto-slotted, GO-2).
export function hireFromBoard(state: GameState, teamType: AwayTeamType, lowestRank: boolean): ActionResult {
  const board = awayRecruitCandidates(state).filter((c) => c.teamType === teamType);
  const pick = lowestRank ? [...board].sort((a, b) => a.rank - b.rank)[0] : board[0];
  if (!pick) return refused(state, "noCandidate");
  const gate = canHireAwayMember(state, pick.id, SIM_SHIP_ID);
  if (!gate.ok) return refused(state, gate.reason);
  return done(hireAwayMember(state, pick.id, SIM_SHIP_ID));
}

const KIT_SLOTS = ["memberArmor", "memberWeapon", "memberTool"] as const;

// Draw a free Standard-Issue Armor, Weapon and Tool from the Quartermaster for every member aboard ship-1 that
// wears nothing in that slot, and install each on its member (the user's 2026-10-16 tutorial step). ok when
// every empty slot was filled; the reason names the first refusal.
export function kitCrewFromQuartermaster(state: GameState): ActionResult {
  let s = state;
  let firstRefusal: string | undefined;
  const members = s.awayMembers.filter((m) => m.assignedShipId === SIM_SHIP_ID);
  for (const member of members) {
    for (const slot of KIT_SLOTS) {
      if (memberSlotPieces(s, member.id, slot).length > 0) continue;
      const req = requisitionStandardIssue(s, slot, member.teamType);
      if (!req.minted) {
        firstRefusal ??= `${slot}:${req.reason}`;
        continue;
      }
      const gate = canFitToMember(req.next, member.id, req.minted.id);
      if (!gate.ok) {
        firstRefusal ??= `${slot}:${gate.reason}`;
        continue;
      }
      s = fitToMember(req.next, member.id, req.minted.id);
    }
  }
  return firstRefusal === undefined ? done(s) : { next: s, ok: false, reason: firstRefusal };
}

// == captain missions and patrols ==

export function dispatchMission(state: GameState, key: MissionKey): ActionResult {
  const gate = canDispatch(state, SIM_CAPTAIN_ID, key);
  if (!gate.ok) return refused(state, gate.reason ?? "refused");
  const r = dispatchCaptainOnMission(state, SIM_CAPTAIN_ID, key);
  return r.success ? done(r.next) : refused(state, "refused");
}

export function dispatchPatrol(state: GameState, key: PatrolKey, stance: CombatStance, repeat: boolean): ActionResult {
  const gate = canDispatchPatrol(state, SIM_CAPTAIN_ID, key);
  if (!gate.ok) return refused(state, gate.reason ?? "refused");
  const r = dispatchCaptainOnPatrol(state, SIM_CAPTAIN_ID, key, stance, repeat);
  return r.success ? done(r.next) : refused(state, r.reason ?? "refused");
}

export function recall(state: GameState): ActionResult {
  const r = recallCaptain(state, SIM_CAPTAIN_ID);
  return r.success ? done(r.next) : refused(state, "notOnMission");
}

// == expeditions ==

// Launch ship-1 on the candidate at `index` (wrapped to the board), anomalies opted in (the dispatch default).
export function launchExpedition(state: GameState, index: number): ActionResult & { expeditionId?: string } {
  const cands = expeditionCandidates(state, SIM_SHIP_ID);
  if (cands.length === 0) return refused(state, "noCandidate");
  const cand = cands[((index % cands.length) + cands.length) % cands.length];
  const r = startExpedition(state, SIM_SHIP_ID, SIM_CAPTAIN_ID, cand.id);
  if (!r.success || !r.expedition) return refused(state, r.reason ?? "refused");
  return { next: r.next, ok: true, expeditionId: r.expedition.id };
}

export function claim(state: GameState, expeditionId: string): ActionResult & { findings?: number; injuries?: number } {
  const r = claimExpedition(state, expeditionId);
  if (!r.success) return refused(state, r.reason ?? "refused");
  return { next: r.next, ok: true, findings: r.findings?.length ?? 0, injuries: r.injuries?.length ?? 0 };
}

// == spending (the "cheapest first" archetype rule, SUGGESTIONS balance harness: "upgrades whatever is cheapest") ==

// Every learnable, affordable captain talent bought, cheapest first (key order breaks ties), until the points run
// out. Returns the keys bought.
export function buyCheapestCaptainTalents(state: GameState): { next: GameState; bought: string[] } {
  let s = state;
  const bought: string[] = [];
  const keys = (Object.keys(CAPTAIN_TALENTS) as CaptainTalentKey[]).sort((a, b) => CAPTAIN_TALENTS[a].cost - CAPTAIN_TALENTS[b].cost || a.localeCompare(b));
  for (let guard = 0; guard < keys.length; guard++) {
    let any = false;
    for (const key of keys) {
      const r = buyCaptainTalent(s, SIM_CAPTAIN_ID, key);
      if (r.success) {
        s = r.next;
        bought.push(`captain:${key}`);
        any = true;
        break;
      }
    }
    if (!any) break;
  }
  // The secondary tree (points come from a retirement): the first legal node in catalog order.
  for (let guard = 0; guard < 64; guard++) {
    const cap = s.captains.find((c) => c.id === SIM_CAPTAIN_ID);
    if (!cap) break;
    const key = (Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[]).find((k) => canBuySecondaryTalent(cap, k));
    if (key === undefined) break;
    s = { ...s, captains: s.captains.map((c) => (c.id === SIM_CAPTAIN_ID ? buySecondaryTalent(c, key) : c)) };
    bought.push(`secondary:${key}`);
  }
  return { next: s, bought };
}

export function buyCheapestHomeworldTalents(state: GameState): { next: GameState; bought: string[] } {
  let s = state;
  const bought: string[] = [];
  const keys = (Object.keys(HOMEWORLD_TALENTS) as HomeworldTalentKey[]).sort((a, b) => HOMEWORLD_TALENTS[a].cost - HOMEWORLD_TALENTS[b].cost || a.localeCompare(b));
  for (let guard = 0; guard < keys.length; guard++) {
    let any = false;
    for (const key of keys) {
      const r = buyHomeworldTalent(s, key);
      if (r.success) {
        s = r.next;
        bought.push(`homeworld:${key}`);
        any = true;
        break;
      }
    }
    if (!any) break;
  }
  return { next: s, bought };
}

// The cheapest affordable facility rung (by credits; key order breaks ties) started, if any.
export function startCheapestFacilityRung(state: GameState): { next: GameState; started: string | null } {
  const options = Object.keys(FACILITIES)
    .filter((key) => canBuildFacilityUpgrade(state, key).ok)
    .map((key) => {
      const level = state.facilities[key]?.level ?? 0;
      const rung = FACILITIES[key].upgrades[level];
      return { key, credits: Number(rung?.credits ?? 0) };
    })
    .sort((a, b) => a.credits - b.credits || a.key.localeCompare(b.key));
  for (const o of options) {
    const r = startFacilityUpgrade(state, o.key);
    if (r.started) return { next: r.next, started: o.key };
  }
  return { next: state, started: null };
}
