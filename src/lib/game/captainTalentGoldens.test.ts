// WR-5a (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5a): golden hashes of
// states whose captain OWNS secondary talents, captured on the code BEFORE the prospector tree was wired (the CP-0 /
// FK-3 / G2-0 / SF-0 / WR-4 pattern). A slice that wires a node re-pins ONLY the entries its commit names, with why.
//
//   none      : the same runs with no secondary node owned (must never move: a save without a node is unchanged).
//   extraction: Extraction 1 to 5 owned: an ore run and a survey, run 1,500 economyTick seconds each.
//   logistics : Logistics 1 to 5 owned: a long ore run 1,500 s, every mission's dispatch reason, the range readout and
//               a Ground Ops dispatch record.
//   trade     : Trade 1 to 5 owned: 200 s docked, then a supply run 1,500 s.
//   otherTrees: one node of each other tree (Gunnery, Survey and Sensors, Command and Crew) on an ore run (WR-5b /
//               WR-5c own them; WR-5a must not move this).
//
// Whole-state hashes leave out `fuel` and `runCounts`, exactly like wiringGoldens.test.ts.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { MISSIONS, freshState, type AwayMember, type GameState, type MissionKey, type SecondaryTalentKey } from "./model";
import { canDispatch, dispatchCaptainOnMission, economyTick, shipRangeLightYears } from "./tick";
import { expeditionCandidates, startExpedition } from "./expedition";
import { asPreRanksDispatch, plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(JSON.stringify(v));
const hashState = (s: GameState): string => hash({ ...s, fuel: undefined, runCounts: undefined });

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function runTicks(s: GameState, n: number, rng: () => number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}

const branch = (b: string): SecondaryTalentKey[] => [1, 2, 3, 4, 5].map((r) => `${b}${r}` as SecondaryTalentKey);

// A rich, level-10 save whose captain owns `nodes`.
function owning(nodes: readonly SecondaryTalentKey[]): GameState {
  const s = freshState();
  return {
    ...s,
    credits: new Decimal(1_000_000),
    captains: s.captains.map((c) => (c.id === 1 ? { ...c, level: 10, unlockedSecondaryTalents: [...nodes] } : c)),
  };
}

function run(s: GameState, key: MissionKey, seconds: number, seed: number): string {
  const r = dispatchCaptainOnMission(s, 1, key);
  if (!r.success) throw new Error(`${key} refused`);
  return hashState(runTicks(r.next, seconds, lcg(seed)));
}

function groundOpsRecord(s: GameState): string {
  const squad: AwayMember[] = [plainAwayMember("member-1", "security", "ship-1"), plainAwayMember("member-11", "science", "ship-1")];
  const s0 = withSlottedAwayTeams({ ...s, awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0x1234 });
  const res = asPreRanksDispatch(startExpedition(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return hash(res.expedition);
}

function extractionCase(nodes: readonly SecondaryTalentKey[]): string[] {
  const s = owning(nodes);
  return [run(s, "shortOreRun", 1500, 0xe1), run(s, "surveyMineralAnomaly", 1500, 0xe2)];
}

function logisticsCase(nodes: readonly SecondaryTalentKey[]): string[] {
  const s = owning(nodes);
  const gates = (Object.keys(MISSIONS) as MissionKey[]).map((k) => {
    const r = canDispatch(s, 1, k);
    return `${k}:${r.ok ? "ok" : r.reason}`;
  });
  return [run(s, "longOreRun", 1500, 0x10), hash(gates), String(shipRangeLightYears(s, s.ships[0])), groundOpsRecord(s)];
}

function tradeCase(nodes: readonly SecondaryTalentKey[]): string[] {
  const docked = runTicks(owning(nodes), 200, lcg(0x7d));
  return [hashState(docked), run(docked, "frontierSupplyRun", 1500, 0x7e)];
}

const GOLDEN: Record<string, string[]> = {
  none: ["4d51e00b", "3ba6d9e4", "2da86dea", "89a0f577", "100", "cef4520b", "a84e5872", "44e370c8"],
  extraction: ["5f14ef03", "d5fcd8ba"],
  logistics: ["2a2b871c", "89a0f577", "100", "7ab424bd"],
  trade: ["3fcfeb21", "b9ca771d"],
  otherTrees: ["8e3d5835", "a7807fd6"],
};

describe("WR-5a pre-wiring goldens: states whose captain owns secondary talents", () => {
  it("none: the same runs with no node owned", () => {
    expect([...extractionCase([]), ...logisticsCase([]), ...tradeCase([])]).toEqual(GOLDEN.none);
  });
  it("extraction: Extraction 1 to 5 on an ore run and a survey", () => {
    expect(extractionCase(branch("extraction"))).toEqual(GOLDEN.extraction);
  });
  it("logistics: Logistics 1 to 5 on a long ore run, the gates, the range and a Ground Ops dispatch", () => {
    expect(logisticsCase(branch("logistics"))).toEqual(GOLDEN.logistics);
  });
  it("trade: Trade 1 to 5, docked, then a supply run", () => {
    expect(tradeCase(branch("trade"))).toEqual(GOLDEN.trade);
  });
  it("otherTrees: Gunnery, Survey and Sensors, Command and Crew nodes on an ore run (not WR-5a)", () => {
    expect(extractionCase(["gunnery1", "surveySensors1", "commandCrew1"])).toEqual(GOLDEN.otherTrees);
  });
});
