// personnelRostersTrackDisplay.ts: the display decisions of the PERSONNEL ROSTERS upgrade track card (0.14.0, Complement
// CP-19; plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-19 / OC-17; user 2026-11-02 "Personnel
// Rosters track (Recommended)"). The card is the Subspace Telescope card's pattern (Squads SQ-7.4): the level, the
// candidate board size now, the next rung's credits and time with the board it reaches, the shared Upgrade button
// (App.svelte facilityUpgradeButton on canBuildFacilityUpgrade), and the ladder of every level.
//
// WHY a .ts beside the card: this repo has no Svelte component test harness, so the words live here as pure functions
// of the state and the component only draws them. Every number is read from the engine (FACILITIES.personnelRosters,
// captainExplorerEffects.ts candidateBoardSize, the one board-size reader both boards use), never restated, so the
// card shows the board the player will actually see, the Recruiter's share included.
//
// DISPLAY ONLY. Nothing here changes a rule.

import { FACILITIES, PERSONNEL_ROSTERS_FACILITY_KEY, personnelRostersLevel, type GameState } from "./game/model";
import { candidateBoardSize } from "./game/captainExplorerEffects";

export type RostersLadderStatus = "reached" | "current" | "building" | "next" | "later";
const LADDER_STATUS_TEXT: Readonly<Record<RostersLadderStatus, string>> = {
  reached: "Reached",
  current: "Current",
  building: "In progress",
  next: "Next",
  later: "",
};

export const ROSTERS_TRACK_LORE =
  "Every rung widens the recruiting net: more officers and more away-team recruits answer each posting, on both candidate boards.";

export interface RostersLadderRow {
  level: number;
  boardText: string; // "12 candidates per board"
  costText: string; // "Pre-granted" / "3,000 credits · 2m"
  status: RostersLadderStatus;
  statusText: string;
}

export interface RostersNextRung {
  level: number;
  credits: number;
  durationTicks: number;
  boardNow: number;
  boardNext: number;
  gainLine: string; // "Level 2 adds 2 candidate slots to each board."
}

export interface RostersTrackView {
  level: number;
  maxLevel: number;
  maxed: boolean;
  building: boolean;
  subtitle: string; // "Level 1 of 6 · 10 candidates per board"
  board: number; // the board size now (both boards)
  boardText: string;
  recruiterLine: string | null; // the Recruiter's share of the board, when a captain owns it
  lore: string;
  next: RostersNextRung | null;
  ladder: RostersLadderRow[];
}

export interface RostersTrackOptions {
  // How a duration in ticks reads (App.svelte passes its durationReadout). Default: "120 ticks".
  duration?: (ticks: number) => string;
}

function upgrades() {
  return FACILITIES[PERSONNEL_ROSTERS_FACILITY_KEY]?.upgrades ?? [];
}

const candidates = (n: number): string => `${n} candidate${n === 1 ? "" : "s"}`;

// The board both candidate boards show at track `level`, everything else as in `state` (the Recruiter included).
export function boardAtLevel(state: GameState, level: number): number {
  return candidateBoardSize({ ...state, facilities: { ...state.facilities, [PERSONNEL_ROSTERS_FACILITY_KEY]: { level } } });
}

export function rostersUpgradeInProgress(state: Pick<GameState, "activeProcesses">): boolean {
  return state.activeProcesses.some(
    (p) => p.kind === "facilityUpgrade" && p.effect.type === "facilityLevelUp" && p.effect.facility === PERSONNEL_ROSTERS_FACILITY_KEY,
  );
}

export function rostersTrackView(state: GameState, options: RostersTrackOptions = {}): RostersTrackView {
  const duration = options.duration ?? ((t: number) => `${t.toLocaleString("en-US")} ticks`);
  const track = upgrades();
  const maxLevel = track.length;
  const level = personnelRostersLevel(state);
  const board = candidateBoardSize(state);
  const building = rostersUpgradeInProgress(state);
  const maxed = level >= maxLevel;

  // The Recruiter's share: the board with no Recruiter anywhere in the fleet, against the board now.
  const withoutRecruiter = candidateBoardSize({ ...state, captains: state.captains.map((c) => ({ ...c, unlockedSecondaryTalents: c.unlockedSecondaryTalents.filter((k) => k !== "commandCrew4") })) });
  const recruiterShare = board - withoutRecruiter;
  const recruiterLine = recruiterShare > 0 ? `Includes +${recruiterShare} from your Recruiter captain talent.` : null;

  let next: RostersNextRung | null = null;
  if (!maxed) {
    const rung = track[level];
    const boardNext = boardAtLevel(state, level + 1);
    const added = boardNext - board;
    next = {
      level: level + 1,
      credits: rung.credits?.toNumber() ?? 0,
      durationTicks: rung.durationTicks,
      boardNow: board,
      boardNext,
      gainLine: `Level ${level + 1} adds ${added} candidate slot${added === 1 ? "" : "s"} to each board.`,
    };
  }

  const ladder: RostersLadderRow[] = track.map((rung, i) => {
    const rowLevel = i + 1;
    const credits = rung.credits?.toNumber() ?? 0;
    const costText = credits <= 0 && rung.durationTicks <= 0 ? "Pre-granted" : [`${credits.toLocaleString("en-US")} credits`, duration(rung.durationTicks)].join(" · ");
    const status: RostersLadderStatus =
      rowLevel < level ? "reached" : rowLevel === level ? "current" : rowLevel === level + 1 ? (building ? "building" : "next") : "later";
    return {
      level: rowLevel,
      boardText: `${candidates(boardAtLevel(state, rowLevel))} per board`,
      costText,
      status,
      statusText: LADDER_STATUS_TEXT[status],
    };
  });

  return {
    level,
    maxLevel,
    maxed,
    building,
    subtitle: `Level ${level} of ${maxLevel} · ${candidates(board)} per board`,
    board,
    boardText: candidates(board),
    recruiterLine,
    lore: ROSTERS_TRACK_LORE,
    next,
    ladder,
  };
}
