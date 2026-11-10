// Wiring WR-10 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-10): the shared fixtures of
// wr10Goldens.test.ts and wr10.test.ts. TEST-ONLY (imported by *.test.ts files only).
//
// Expedition fixtures: real Ground Ops runs (dispatch, 2,000,000 s, claim) on an ordinary save whose squad carries every
// WR-10 lever: a Security member wearing Neural Backup (OC-F2), a Security medic whose program falls back when hurt
// (OC-F6), and a rank 8 Science member with fieldwork gear (OC-F7). Fight fixtures: that squad's task fights at sites
// whose guard fields casters (OC-F9: Xeno-Flora Bloom, an enemy fortification) and at one without, over a spread of
// stream seeds, each with its display log. Hire fixtures: one recruit hired with the fresh account pair and one with an
// account pair the player changed (OC-F12).

import { freshState, type AwayMember, type Expedition, type GameState, type GambitProgram } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { goldenJson, withoutRunCounts } from "./firstRunsGoldens.fixture";
import { resolveTaskFightOnSeed } from "./groundFight";
import type { GambitLogEvent } from "./gambit";
import { gambitPresetPrograms } from "./gambit";
import { awayRecruitCandidates, hireAwayMember } from "./awayTeam";
import { wearPiece } from "./wiring/probes";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
export const wr10Hash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));

// The medic falls back when below 60% HP, else runs the usual targeting.
export const FALL_BACK_PROGRAM: GambitProgram = [
  { target: "allyHasStatus", action: "cure" },
  { target: "selfHpBelow", params: { hpThreshold: 0.6 }, action: "fallBack" },
  { target: "foeIsCaster", action: "attack" },
  { target: "foeNearest", action: "attack" },
];

export const WR10_WEARER = "member-1";
export const WR10_MEDIC = "member-2";
export const WR10_SCIENCE = "member-11";

const SQUAD: AwayMember[] = [
  { ...plainAwayMember(WR10_WEARER, "security", "ship-1"), rank: 3 },
  { ...plainAwayMember(WR10_MEDIC, "security", "ship-1"), rank: 2, traits: ["fieldMedic"], gambit: FALL_BACK_PROGRAM.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined })) },
  { ...plainAwayMember(WR10_SCIENCE, "science", "ship-1"), rank: 8 },
];

export function wr10State(seed: number): GameState {
  let s = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  s = wearPiece(s, WR10_WEARER, "implant", "neuralBackup", { groundHp: 4 });
  s = wearPiece(s, WR10_SCIENCE, "memberWeapon", "sidearm", { groundFieldwork: 20 });
  return s;
}

export const WR10_SEEDS = [0x1234, 0x3c3c, 0x5e5e, 0xbebe, 0xcfcf] as const;

export function wr10Dispatch(seed: number): { next: GameState; exp: Expedition } {
  const s = wr10State(seed);
  const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

export function wr10Run(seed: number): { exp: Expedition; done: Expedition; claimed: GameState; out: string[] } {
  const { next, exp } = wr10Dispatch(seed);
  const done = advanceExpedition(exp, 2_000_000);
  if (done.phase !== "complete") throw new Error(`run did not complete: ${done.phase}`);
  const claim = claimExpedition({ ...next, expeditions: [done] }, done.id);
  if (!claim.success) throw new Error("claim refused");
  return { exp, done, claimed: claim.next, out: [wr10Hash(exp), wr10Hash(done), wr10Hash(claim.next)] };
}

// ===== Task fights =====

export const WR10_FIGHT_POIS = ["xenoFloraBloom", "enemyFortification", "ancientRuins"] as const;
export const WR10_FIGHT_SEEDS = 24;

// The squad's fights at `poiId` on stream seeds 1 .. WR10_FIGHT_SEEDS, each record with its display log. `exp` is a real
// dispatch (its roster carries the Neural Backup wearer and the falling-back medic).
export function wr10Fights(exp: Expedition, poiId: string): { record: unknown; log: GambitLogEvent[] }[] {
  const out: { record: unknown; log: GambitLogEvent[] }[] = [];
  for (let i = 1; i <= WR10_FIGHT_SEEDS; i += 1) {
    const log: GambitLogEvent[] = [];
    const record = resolveTaskFightOnSeed(
      exp,
      [{ securityIds: [WR10_WEARER, WR10_MEDIC], securityShare: 1 }],
      { hazard: 0.6 },
      { id: "wr10-task", poiId, fightCount: 0, pointsCleared: 0 },
      (0x9e3779b9 * i) >>> 0,
      undefined,
      log,
    );
    out.push({ record, log });
  }
  return out;
}

export function wr10FightHash(exp: Expedition, poiId: string): string {
  return wr10Hash(wr10Fights(exp, poiId));
}

// ===== Hires (OC-F12) =====

// A save with one Security and one Science squad slot free, the recruit board's first Security and first Science
// candidate hired onto ship-1. `custom` sets the account pair's Security program to the Decapitate preset first.
export function wr10Hires(custom: boolean): GameState {
  let s = freshState();
  if (custom) s = { ...s, gambitPrograms: { security: gambitPresetPrograms("decapitate")!.security, science: [] } };
  const board = awayRecruitCandidates(s);
  const sec = board.find((c) => c.teamType === "security");
  const sci = board.find((c) => c.teamType === "science");
  if (!sec || !sci) throw new Error("no candidates");
  s = hireAwayMember(s, sec.id, "ship-1");
  s = hireAwayMember(s, sci.id, "ship-1");
  return s;
}
