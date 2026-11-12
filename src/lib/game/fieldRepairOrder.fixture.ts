// OC-F14 (the player-ordered field repair, user answers 2026-11-12): the shared fixtures of fieldRepairOrderGoldens.test.ts
// and fieldRepairOrder.test.ts. TEST-ONLY (imported by *.test.ts files only).
//
// Real Ground Ops runs of the GO-8b squad (fieldRepair.test.ts) on five systems: three that mix repair worlds with other
// bodies (where "the faster of orbit and world" can choose differently from the old nearest-world rule), one of repair
// worlds only and one with none. Each run is read four ways: the dispatched record; the threshold (automatic) repair, the
// ship already carrying one point under the threshold; the player's order 200 s into the window with 48 damage (the
// mockup's example); and that ordered run advanced to the end.

import { freshState, type AwayMember, type Expedition, type GameState } from "./model";
import { advanceExpedition, expeditionCandidates, orderFieldRepair } from "./expedition";
import { FIELD_REPAIR_DAMAGE_SHARE } from "./groundOps";
import { asPreCurveDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { goldenJson, withoutRunCounts } from "./firstRunsGoldens.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
export const ocf14Hash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2 }), member("member-11", "science")];

// toxic + frozen, barren + arid, volcanic + gas giant + frozen (mixed); arid x3 (worlds only); volcanic + barren (none).
export const OCF14_SEEDS = [0xa6fe4, 0xa6fee, 0xa6ff2, 0xa6fe5, 0xa6fe0] as const;
export const OCF14_MIXED_SEEDS = [0xa6fe4, 0xa6fee, 0xa6ff2] as const;
export const OCF14_FAR = 2_000_000;
// The mockup's example damage.
export const OCF14_ORDER_DAMAGE = 48;

export function ocf14Dispatch(seed: number): { next: GameState; exp: Expedition } {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  const res = asPreCurveDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

// The run with the ship already carrying `damage` hull points (a fixture: the first light damage then crosses the
// threshold when `damage` is one under it).
export function ocf14Damaged(exp: Expedition, damage: number): Expedition {
  return { ...exp, groundOps: { ...exp.groundOps!, hullDamage: damage } };
}

export const ocf14Threshold = (exp: Expedition): number => FIELD_REPAIR_DAMAGE_SHARE * exp.groundOps!.shipEventProfile.battle!.hullMax;

// When the run's operations window opens (the first 600 s step at which it has). Pure.
export function ocf14WindowOpen(exp: Expedition): number {
  let t = 0;
  let e = exp;
  while (e.groundOps!.startedAt === undefined) {
    t += 600;
    e = advanceExpedition(exp, t);
  }
  return e.groundOps!.startedAt!;
}

// The player's order 200 s into the window with the mockup's 48 damage: the state after the order (the run settled at
// the order's instant).
export function ocf14Ordered(seed: number): { state: GameState; exp: Expedition; at: number } {
  const { next, exp } = ocf14Dispatch(seed);
  const at = ocf14WindowOpen(exp) + 200;
  const before = advanceExpedition(exp, at);
  const state = orderFieldRepair({ ...next, gameTimeSeconds: at, expeditions: [ocf14Damaged(before, OCF14_ORDER_DAMAGE)] }, exp.id);
  return { state, exp: state.expeditions[0], at };
}

// The four readings of one seed: [dispatch, threshold run to the end, the ordered repair leg, the ordered run to the end].
export function ocf14Run(seed: number): string[] {
  const { exp } = ocf14Dispatch(seed);
  const auto = advanceExpedition(ocf14Damaged(exp, ocf14Threshold(exp) - 1), OCF14_FAR);
  const ordered = ocf14Ordered(seed).exp;
  return [ocf14Hash(exp), ocf14Hash(auto), ocf14Hash(ordered.groundOps!.repairLegs ?? null), ocf14Hash(advanceExpedition(ordered, OCF14_FAR))];
}
