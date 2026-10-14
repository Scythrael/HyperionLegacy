// Objective affixes AF-2 (docs/plans/2026-10-14-objective-affixes-capture.md): the ground weapon RANGE attribute
// and the ROCKY OUTCROPPINGS affix on the engine. An affix-aware run dispatched before AF-2 (no affix catalog
// version on its profile) stamps, plans and resolves exactly as before (goldens captured BEFORE the change).

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, claimExpedition, startExpedition } from "./expedition";
import { generateRiskProfile, type ExpeditionRegion } from "./riskFactors";
import { plainAwayMember, withoutAffixCatalog } from "./awayTeamTestFixtures";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1: Ground + Ground (or Strike + Survey) fully slotted at `rank`.
function crewed(expeditionSeed: number, kinds: "gg" | "ss" = "gg", rank = 6): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: rank as AwayMember["rank"] });
  const teams: ShipGroundTeam[] =
    kinds === "gg"
      ? [
          { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
          { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
        ]
      : [
          { kind: "strike", security: SEC.slice(), science: [], helpOthers: false },
          { kind: "survey", security: [], science: SCI.slice(), helpOthers: false },
        ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// Dispatch candidate 0, optionally on a forced region (the risk replaced before any body scans).
function dispatch(state: GameState, region?: ExpeditionRegion): { next: GameState; exp: Expedition } {
  const res = startExpedition(state, "ship-1", 1, "cand-0");
  expect(res.success, String(res.reason)).toBe(true);
  let exp = res.expedition!;
  if (region) {
    const forced = generateRiskProfile(exp.seed, region, exp.bodies);
    exp = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
  }
  return { next: res.next, exp };
}

// ===== the gate: an affix-aware run dispatched before AF-2 resolves exactly as before =====

describe("AF-2 the gate: an affix-aware run without the catalog version resolves byte-identically (goldens captured before AF-2)", () => {
  const CASES: Record<string, () => { state: GameState; region?: ExpeditionRegion }> = {
    tierOne: () => ({ state: crewed(0x0a13bd4) }),
    tierThree: () => ({ state: crewed(0x1259124), region: { tier: 3, enemyTerritory: false } }),
    tierFourEnemy: () => ({ state: crewed(0x0a13bd4), region: { tier: 4, enemyTerritory: true } }),
    strikeSurveyTierFour: () => ({ state: crewed(0x3c0ffee, "ss"), region: { tier: 4, enemyTerritory: true } }),
    tierSixWeak: () => ({ state: crewed(0x2b0b5e7, "gg", 3), region: { tier: 6, enemyTerritory: true } }),
    tierSevenEnemy: () => ({ state: crewed(0x5eed777), region: { tier: 7, enemyTerritory: true } }),
  };
  // Captured from the code BEFORE AF-2 (commit 0ffe397): five checkpoints, the phase at 2,000,000 s, the claim
  // (when the run completes).
  const GOLDEN: Record<string, string[]> = {
    tierOne: ["afde41dd", "3751a80", "7b9e7128", "16a1acb8", "97cb2db9", "activities", "unclaimed"],
    tierThree: ["36daf01f", "8ad55aca", "8ad55aca", "8ad55aca", "8ad55aca", "complete", "7ba2c3e"],
    tierFourEnemy: ["b797f1a2", "378beb64", "a7a5f021", "a7a5f021", "a7a5f021", "complete", "6e3e8c25"],
    strikeSurveyTierFour: ["8e6ef7a8", "ddcc62be", "ddcc62be", "ddcc62be", "ddcc62be", "complete", "b86b42a4"],
    tierSixWeak: ["32afb8e0", "2d3420dc", "ff437ba6", "ff437ba6", "ff437ba6", "complete", "a29aec1b"],
    tierSevenEnemy: ["afed66d0", "5b3467c7", "561746ad", "561746ad", "561746ad", "complete", "254d0d67"],
  };
  for (const [name, build] of Object.entries(CASES)) {
    it(`${name}: checkpoints and the claim match the pre-AF-2 capture`, { timeout: 120_000 }, () => {
      const { state, region } = build();
      const d = dispatch(state, region);
      const exp = withoutAffixCatalog(d.exp);
      expect(exp.risk?.difficultyTier).toBe(1); // affix-aware
      const hashes = [T0 + 5000, T0 + 20000, T0 + 60000, T0 + 150000, T0 + 400000].map((t) => fnv(JSON.stringify(advanceExpedition(exp, t))));
      const done = advanceExpedition(exp, T0 + 2_000_000);
      hashes.push(done.phase);
      const claimed = done.phase === "complete" ? claimExpedition({ ...d.next, expeditions: [done] }, done.id) : null;
      hashes.push(claimed ? fnv(JSON.stringify(claimed.next)) : "unclaimed");
      expect(hashes).toEqual(GOLDEN[name]);
    });
  }
});
