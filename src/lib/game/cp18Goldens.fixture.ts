// Complement CP-18 GOLDENS (the soft captain level cap; plan docs/plans/2026-10-14-complement-and-acquisition-plan.md
// CP-18, OC-23): every path that spends captain XP on a level, through the live engine, captured on the code BEFORE the
// slice (CP18_PINS_PRE). TEST-ONLY (imported by *.test.ts files only).
//
// The captains start from stored XP spelled out in numbers (a save's own bytes), never from the curve, so the same
// start state runs on both sides of the slice. Each row is the whole state (stateHash) and the captains on their own
// (hash), so a pin that moves names what moved. Each mission row runs in 1 s steps, in one call and in 997 s chunks:
//   curve             : the cost of the next level at levels on both sides of the threshold, read directly.
//   mission:belowCap  : level 29, 50 XP short of level 30, for 1000 s.
//   mission:atCap     : level 30, 50 XP short of level 31 (the threshold level's own cost), for 1000 s.
//   mission:pastCap   : level 35 holding 10450 XP (an old save's 50 XP short of level 36), for 1000 s.
//   mission:milestone : level 39 holding 11650 XP (an old save's 50 XP short of level 40, a notable), for 1000 s.
//   mission:bigAward  : level 31 at 0 XP at a fractional 201.25 XP a second (see cp18BigAward), for 1500 s: one award
//                       that crosses many levels past the threshold, and level milestones on the way.
//   mission:realRate  : (fix round) level 39 holding 22338 XP with ONE retirement, so the award runs at the real,
//                       non-dyadic x1.05 (1.05 XP a second), for 1000 s: the whole 1050 XP lands exactly on the live
//                       level 39 price (23388), at the run's last second, in every cut (see cp18RealRate).
//   patrol:pastCap    : Dispatch Once on a Destroyer to its end, level 39 holding 11699 XP.
//   shortRange:pastCap: an Eir's first short-range run (900 s), level 39 holding 11699 XP.
//   offline:pastCap   : the While You Were Away captain row of mission:milestone and mission:bigAward.
//   save:pastCap      : the old-save captain (level 39 holding 11699 XP) serialized, and through deserialize + migrate.
//   retire:pastCap    : a retirement from level 40.

import Decimal from "break_infinity.js";
import { xpForNextLevel, type GameState } from "./model";
import { summarizeOfflineProgress } from "./offlineSummary";
import { retireCaptain } from "./captainRetirement";
import { deserialize, migrate, serialize } from "./save";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { cp16MissionStart, cp16PatrolStart, cp16RetireReady, cp16ShortRangeStart, patrolSecondsToEnd, steppedBy } from "./cp16Goldens.fixture";
import { WIRING_CAPTAIN_ID, editCaptain } from "./wiring/probes";

const row = (s: GameState): string[] => [stateHash(s), hash(s.captains)];

// The captain at `level` holding `xp` (stored bytes, no curve read). The state keeps whatever mission it carries.
export function storedCaptain(s: GameState, level: number, xp: number, retirements = 0): GameState {
  return editCaptain(s, { level, xp: new Decimal(xp), retirements });
}

// A Short Ore Run flying with the captain as stored (cp16MissionStart: eight transit berths, so the three cuts agree).
export function cp18Mission(level: number, xp: number, retirements = 0): GameState {
  return storedCaptain(cp16MissionStart(), level, xp, retirements);
}

// The same run in 1 s steps, in one call and in 997 s chunks.
export function threeCuts(start: GameState, seconds: number): { steps: GameState; oneCall: GameState; chunks: GameState } {
  return { steps: steppedBy(start, seconds, 1), oneCall: steppedBy(start, seconds, seconds), chunks: steppedBy(start, seconds, 997) };
}

// A short run (a single call's berth budget holds its cycles, the EM-4 precedent, so the three cuts agree) with an award
// big enough to cross many levels in that one call: a retirement count no player reaches, only to raise the rate, to the
// fractional 201.25 XP a second.
export const CP18_BIG_AWARD_SECONDS = 1500;
export const CP18_BIG_AWARD_RETIREMENTS = 4005;
export function cp18BigAward(level: number, xp: number): GameState {
  return cp18Mission(level, xp, CP18_BIG_AWARD_RETIREMENTS);
}
// Fix round: the past-cap parity row at a REAL multiplier. One retirement gives x1.05 (retirementExpMultiplier), which
// no power of two divides, so the 1 s steps add 1.05 a thousand times while the one call adds 1050 once: the row proves
// they still land on the same bytes. The stored XP is spelled out (23388 - 1050), so it is the same start on both sides
// of the slice; with the switch off the old 11700 price is crossed on the first second instead.
export const CP18_REAL_RATE_RETIREMENTS = 1;
export const CP18_REAL_RATE_SECONDS = 1000;
export function cp18RealRate(): GameState {
  return cp18Mission(39, 22338, CP18_REAL_RATE_RETIREMENTS);
}
export const CP18_CURVE_LEVELS: readonly number[] = [1, 2, 29, 30, 31, 35, 40, 50, 100, 200];

function offlineRow(before: GameState, after: GameState, seconds: number): string {
  return hash(summarizeOfflineProgress(before, after, seconds).captainsProgressed);
}

// Every row.
export function cp18Rows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  got["curve"] = CP18_CURVE_LEVELS.map(xpForNextLevel);
  const missions: Record<string, GameState> = {
    belowCap: cp18Mission(29, 8650),
    atCap: cp18Mission(30, 8950),
    pastCap: cp18Mission(35, 10450),
    milestone: cp18Mission(39, 11650),
  };
  for (const [name, start] of Object.entries(missions)) {
    const cuts = threeCuts(start, 1000);
    got[`mission:${name}:steps`] = row(cuts.steps);
    got[`mission:${name}:oneCall`] = row(cuts.oneCall);
    got[`mission:${name}:chunks`] = row(cuts.chunks);
  }
  const big = cp18BigAward(31, 0);
  const bigCuts = threeCuts(big, CP18_BIG_AWARD_SECONDS);
  got["mission:bigAward:steps"] = row(bigCuts.steps);
  got["mission:bigAward:oneCall"] = row(bigCuts.oneCall);
  got["mission:bigAward:chunks"] = row(bigCuts.chunks);
  const realCuts = threeCuts(cp18RealRate(), CP18_REAL_RATE_SECONDS);
  got["mission:realRate:steps"] = row(realCuts.steps);
  got["mission:realRate:oneCall"] = row(realCuts.oneCall);
  got["mission:realRate:chunks"] = row(realCuts.chunks);
  const patrol = storedCaptain(cp16PatrolStart(), 39, 11699);
  got["patrol:pastCap"] = row(steppedBy(patrol, patrolSecondsToEnd(patrol), 1));
  got["shortRange:pastCap"] = row(steppedBy(storedCaptain(cp16ShortRangeStart(0), 39, 11699), 900, 1));
  const away = missions.milestone;
  got["offline:pastCap"] = [offlineRow(away, steppedBy(away, 1000, 1000), 1000), offlineRow(big, bigCuts.oneCall, CP18_BIG_AWARD_SECONDS)];
  const old = storedCaptain(cp16MissionStart(), 39, 11699);
  const raw = serialize(old, 0, 0);
  const loaded = deserialize(raw);
  got["save:pastCap"] = [hash(raw), hash(loaded === null ? null : serialize(migrate(loaded), 0, 0))];
  got["retire:pastCap"] = row(retireCaptain(editCaptain(cp16RetireReady(0), { level: 40, xp: new Decimal(11699) }), WIRING_CAPTAIN_ID));
  return got;
}

// Captured on feat 8d3809b, before the slice.
export const CP18_PINS_PRE: Record<string, unknown> = {
  "curve": [300, 600, 8700, 9000, 9300, 10500, 12000, 15000, 30000, 60000],
  "mission:belowCap:steps": ["ce1f1a6e", "2427a867"],
  "mission:belowCap:oneCall": ["ce1f1a6e", "2427a867"],
  "mission:belowCap:chunks": ["ce1f1a6e", "2427a867"],
  "mission:atCap:steps": ["19c2ea34", "c7cd0431"],
  "mission:atCap:oneCall": ["19c2ea34", "c7cd0431"],
  "mission:atCap:chunks": ["19c2ea34", "c7cd0431"],
  "mission:pastCap:steps": ["1991b83d", "b1855e66"],
  "mission:pastCap:oneCall": ["1991b83d", "b1855e66"],
  "mission:pastCap:chunks": ["1991b83d", "b1855e66"],
  "mission:milestone:steps": ["95ea5338", "a47f62f5"],
  "mission:milestone:oneCall": ["95ea5338", "a47f62f5"],
  "mission:milestone:chunks": ["95ea5338", "a47f62f5"],
  "mission:bigAward:steps": ["65c38710", "aada9279"],
  "mission:bigAward:oneCall": ["65c38710", "aada9279"],
  "mission:bigAward:chunks": ["65c38710", "aada9279"],
  // Fix round: the real-rate row was added after the slice, so its pre-slice pin was captured on 9666c2e with the CP-18
  // switch OFF (cp18Switch.fixture.ts withoutCp18), the same switch every other pin here is proven to return to.
  "mission:realRate:steps": ["e587d9d2", "6f8c504c"],
  "mission:realRate:oneCall": ["e587d9d2", "6f8c504c"],
  "mission:realRate:chunks": ["e587d9d2", "6f8c504c"],
  "patrol:pastCap": ["842e8665", "d5c221bd"],
  "shortRange:pastCap": ["1928443e", "e60a6c68"],
  "offline:pastCap": ["c37603a", "91dba251"],
  "save:pastCap": ["54eeb17e", "5512cb46"],
  "retire:pastCap": ["ac440332", "c46eaf7c"],
};
