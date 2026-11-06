// Complement CP-16 (the Hall of Command, OC-22): the Archive subsection's view model. Pure presentation over
// GameState.hallOfCommand (captainNotables.ts writes it); every number comes from the stored entry.

import type { GameState, HallOfCommandEntry } from "./game/model";
import { MAX_CAPTAIN_RETIREMENTS } from "./game/captainRetirement";
import { hallOfCommandOf } from "./game/captainNotables";
import { formatNumber } from "./game/format";

const SECONDS_PER_GAME_DAY = 86_400;

// The in-game day a game second falls on: Day 1 is the first 24 hours of the fleet clock (state.gameTimeSeconds). Pure.
export function gameDayOf(gameSeconds: number): number {
  return Math.floor(Math.max(0, gameSeconds) / SECONDS_PER_GAME_DAY) + 1;
}
export function gameDayText(gameSeconds: number): string {
  return `Day ${formatNumber(gameDayOf(gameSeconds))}`;
}

export interface HallOfCommandRow {
  key: string;
  name: string;
  level: string; // "Level 31"
  retirement: string; // "Retirement 2 of 5"
  missions: string; // "148 missions"
  retiredOn: string; // "Day 12"
  final: boolean; // the slot's last retirement
  notables: { key: string; label: string; day: string }[];
}

export function hallOfCommandRow(entry: HallOfCommandEntry, index: number): HallOfCommandRow {
  return {
    key: `${index}-${entry.retiredAtGameSeconds}`,
    name: entry.captainName,
    level: `Level ${formatNumber(entry.levelReached)}`,
    retirement: `Retirement ${entry.retirementNumber} of ${MAX_CAPTAIN_RETIREMENTS}`,
    missions: `${formatNumber(entry.missionsFlown)} ${entry.missionsFlown === 1 ? "mission" : "missions"}`,
    retiredOn: gameDayText(entry.retiredAtGameSeconds),
    final: entry.retirementNumber >= MAX_CAPTAIN_RETIREMENTS,
    notables: entry.notables.map((n, i) => ({ key: `${i}-${n.kind}-${n.atGameSeconds}`, label: n.label, day: gameDayText(n.atGameSeconds) })),
  };
}

// The rows, newest retirement first. Empty until the first retirement (the subsection stays hidden). Pure.
export function hallOfCommandRows(state: Pick<GameState, "hallOfCommand">): HallOfCommandRow[] {
  return hallOfCommandOf(state)
    .map((e, i) => hallOfCommandRow(e, i))
    .reverse();
}

// The subsection's help line (the `?` on its title).
export const HALL_OF_COMMAND_HELP =
  "Every captain who retires is entered here: the name they served under, the level they retired at, which of the slot's " +
  `${MAX_CAPTAIN_RETIREMENTS} retirements it was, the missions they flew, and the in-game day. Their notable moments are listed with the day each happened: ` +
  "every tenth level, and their ship's first expedition, first relic found, first Tier II or deeper run and first refugee rescued. " +
  "Missions and notables count from this update on, so retirements before it have no entry.";
