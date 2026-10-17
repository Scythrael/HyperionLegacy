// WR-5c (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5c): golden hashes captured
// on the code BEFORE any WR-5c engine edit (the CP-0 / FK-3 / G2-0 / SF-0 / WR-4 pattern). The fixture is one rich
// explorer-ready save: the starting hull with its Standard Issue gear, a Balanced Array (20 sensors), a Security,
// Science and Operations complement, a seated Science officer (Discovery Instinct) and Executive officer (Command
// Presence), and the D18 away team. Each variant gives captain 1 ONE explorer secondary node (or none) and reads:
//
//   sheet     : the crew-boosted ship stat sheet (effectiveShipStats).
//   cands     : the expedition console's candidate list (telescope reading, foreknowledge, task demand).
//   dispatch  : the Ground Ops run record a dispatch of the first candidate freezes.
//   done      : that run advanced to its end (advanceExpedition), the record.
//   claim     : the state after the claim (vault, inventory, officers' promotion counters).
//   study     : the first vault token's relic study duration (or "none").
//   mission   : a Short Ore Run flown 900 economyTick seconds (officer and crew output on missions).
//   patrol    : a destroyer with a seated Tactical officer (Weapons Command) on a Repeat patrol, 900 seconds.
//   boards    : the officer board and the away-team recruit board sizes.
//
// Every state hash normalizes the captains' secondary nodes away, so before WR-5c wires anything every variant
// reads EXACTLY the baseline (the nodes are inert): that is the capture. The WR-5c commit re-pins ONLY the parts
// a node moves, each with its reason beside it, and the baseline ("none") never moves.

import { describe, expect, it } from "vitest";
import { PATROLS, type GameState, type SecondaryTalentKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, startRelicStudy } from "./tick";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { effectiveShipStats } from "./crewOverlay";
import { seniorStaffCandidates } from "./seniorStaff";
import { awayRecruitCandidates } from "./awayTeam";
import { bucketOf, editCaptain, installPiece, seatOfficer, withAwayTeam, withBuckets, withFacilityLevel, wiringBase } from "./wiring/probes";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(JSON.stringify(v));
// A state without the captains' secondary nodes (the variant's own input), so an inert node reads the baseline.
const hashState = (s: GameState): string => hash({ ...s, captains: s.captains.map((c) => ({ ...c, unlockedSecondaryTalents: [] })) });

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

// The rich explorer-ready save (see the header).
function fixture(): GameState {
  let s = installMissingCombatBaselines(wiringBase());
  s = installPiece(s, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  s = withBuckets(s, [bucketOf("security", "sec.boarding"), bucketOf("science", "sci.rareFind"), bucketOf("operations", "ops.effectiveCargo")]);
  s = seatOfficer(s, "science", ["sci.discovery", "sci.yieldSurge"]);
  s = seatOfficer(s, "executive", ["xo.commandOutput", "ops.cargoExpand"]);
  s = withAwayTeam(s);
  s = withFacilityLevel(s, "research", 1);
  return { ...s, expeditionSeed: 0x5c0de, gameTimeSeconds: 100_000 };
}

function patrolFixture(): GameState {
  const s = seatOfficer(installMissingCombatBaselines(wiringBase("destroyer")), "tactical", ["tac.weaponCommand", "tac.shieldCommand"]);
  return { ...s, captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

const own = (s: GameState, key: SecondaryTalentKey | null): GameState => (key ? editCaptain(s, { unlockedSecondaryTalents: [key] }) : s);

export const EXPLORER_NODES: readonly SecondaryTalentKey[] = [
  "surveySensors1", "surveySensors2", "surveySensors3", "surveySensors4", "surveySensors5",
  "expeditionRelics1", "expeditionRelics2", "expeditionRelics3", "expeditionRelics4", "expeditionRelics5",
  "commandCrew1", "commandCrew2", "commandCrew3", "commandCrew4", "commandCrew5",
];

export function readVariant(key: SecondaryTalentKey | null): Record<string, string> {
  const s0 = own(fixture(), key);
  const ship = s0.ships.find((sh) => sh.id === "ship-1")!;
  const sheet = hash(effectiveShipStats(s0, ship));
  const candidates = expeditionCandidates(s0, "ship-1");
  const cands = hash(candidates);
  const res = startExpedition(s0, "ship-1", 1, candidates[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const dispatch = hash(res.expedition);
  const end = 3_000_000;
  const done = advanceExpedition(res.next.expeditions[0], end);
  if (done.phase !== "complete") throw new Error("the golden run did not finish");
  const claim = claimExpedition({ ...res.next, expeditions: [done], gameTimeSeconds: end }, done.id);
  if (!claim.success) throw new Error("the golden claim was refused");
  const token = (claim.next.relicVault ?? [])[0];
  const studied = token ? startRelicStudy(claim.next, token.id) : null;
  const study = studied && studied.started ? String(studied.next.activeProcesses.find((p) => p.kind === "relicStudy")?.durationTicks) : "none";

  const m = dispatchCaptainOnMission(own(fixture(), key), 1, "shortOreRun");
  if (!m.success) throw new Error("the golden mission was refused");
  const mission = hashState(runTicks(m.next, 900, lcg(0x5c1)));

  const p = dispatchCaptainOnPatrol(own(patrolFixture(), key), 1, Object.keys(PATROLS)[0], "balanced", true);
  if (!p.success) throw new Error("the golden patrol was refused");
  const patrol = hashState(runTicks(p.next, 900, lcg(0x5c2)));

  const boards = `${seniorStaffCandidates(s0).length}/${awayRecruitCandidates(s0).length}`;
  return { sheet, cands, dispatch, done: hash(done), claim: hashState(claim.next), study, mission, patrol, boards };
}

// ===== the goldens (captured before WR-5c) =====

const BASELINE: Record<string, string> = {
  sheet: "7cabdac1",
  cands: "68c028f8",
  dispatch: "3527221b",
  done: "4aca4b1a",
  claim: "8cf7de8a",
  study: "600",
  mission: "c3e1866b",
  patrol: "b8afc1be",
  boards: "10/10",
};

// Per node: the parts it moves (anything not listed equals BASELINE).
const MOVES: Partial<Record<SecondaryTalentKey, Record<string, string>>> = {};

describe("WR-5c goldens: the explorer secondary nodes, captured before wiring", () => {
  it("the baseline (no node) is pinned", () => {
    expect(readVariant(null)).toEqual(BASELINE);
  });
  for (const key of EXPLORER_NODES) {
    it(`${key}: only its own parts move`, () => {
      expect(readVariant(key)).toEqual({ ...BASELINE, ...(MOVES[key] ?? {}) });
    });
  }
});
