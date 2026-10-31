// Complement and Acquisition CP-3: the shared Ground Ops fixtures of complementCp3Goldens.test.ts and
// complementCp3.test.ts. TEST-ONLY (imported by *.test.ts files only).
//
// Each fixture is a real Ground Ops run (dispatch, 2,000,000 s, claim) on an ordinary save whose ship carries
// complement buckets:
//   security : Counter-Infiltration and Away-Team Protection crew (the Security pool).
//   medical  : Triage crew and a Prevent a Crew Loss exclusive (the Medical pool and the exclusive pool).
//   all      : the four keys together, on a second seed.
//   control  : crew holding only keys CP-3 does not touch (Boarding Defense, Reduced Crew Losses).

import { freshState, type AwayMember, type CrewBucket, type Expedition, type GameState } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { goldenJson, withoutRunCounts } from "./firstRunsGoldens.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
export const cp3Hash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));

export const cp3Bucket = (profession: CrewBucket["profession"], buff1Id: string, count: number, buff2Id: string | null = null): CrewBucket => ({
  profession,
  rarity: "standard",
  rank: buff2Id ? 3 : 1,
  race: "martian",
  buff1Id,
  buff2Id,
  count,
});

export const CP3_SECURITY_CREW: readonly CrewBucket[] = [cp3Bucket("security", "sec.counterInfiltration", 60), cp3Bucket("security", "sec.awayTeam", 60)];
export const CP3_MEDICAL_CREW: readonly CrewBucket[] = [cp3Bucket("medical", "med.triage", 60), cp3Bucket("medical", "med.reducedLosses", 10, "excl.preventCrewLoss")];
export const CP3_ALL_CREW: readonly CrewBucket[] = [...CP3_SECURITY_CREW, ...CP3_MEDICAL_CREW];
export const CP3_CONTROL_CREW: readonly CrewBucket[] = [cp3Bucket("security", "sec.boarding", 60), cp3Bucket("medical", "med.reducedLosses", 60)];

export const CP3_SEEDS = { security: 0x1244, medical: 0x1244, all: 0x1234, control: 0x1244 } as const;
export type Cp3Fixture = keyof typeof CP3_SEEDS;
export const CP3_CREW: Record<Cp3Fixture, readonly CrewBucket[]> = {
  security: CP3_SECURITY_CREW,
  medical: CP3_MEDICAL_CREW,
  all: CP3_ALL_CREW,
  control: CP3_CONTROL_CREW,
};

const SQUAD: AwayMember[] = [
  { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
  { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2, traits: ["fieldMedic"] },
  plainAwayMember("member-11", "science", "ship-1"),
];

export function cp3State(buckets: readonly CrewBucket[], seed: number): GameState {
  const s0 = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  return { ...s0, ships: s0.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { mode: "active" as const, buckets: buckets.map((b) => ({ ...b })) } } : sh)) };
}

export function cp3Dispatch(buckets: readonly CrewBucket[], seed: number): { next: GameState; exp: Expedition } {
  const s = cp3State(buckets, seed);
  const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

export function cp3Run(buckets: readonly CrewBucket[], seed: number): { exp: Expedition; done: Expedition; claimed: GameState; out: string[] } {
  const { next, exp } = cp3Dispatch(buckets, seed);
  const done = advanceExpedition(exp, 2_000_000);
  if (done.phase !== "complete") throw new Error(`run did not complete: ${done.phase}`);
  const claim = claimExpedition({ ...next, expeditions: [done] }, done.id);
  if (!claim.success) throw new Error("claim refused");
  return { exp, done, claimed: claim.next, out: [cp3Hash(exp), cp3Hash(done), cp3Hash(claim.next)] };
}
