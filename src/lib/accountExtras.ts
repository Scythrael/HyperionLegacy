// accountExtras.ts: the 0.13.11.1 account-level fields of the main save, as PURE functions.
//
// The four optional GameState fields (model.ts: redeemedGifts, seenCodeLines, endlessGreedAt,
// unlockedThemeStyles) are written ONLY here. Every function returns the SAME state reference when
// nothing changes, so App's do* handlers can skip the save and the log (the same-ref guard).
// Nothing here touches the tick, the economy or any other field, except the one credit grant a
// gift pays.

import type { GameState } from "./game/model";
import { GIFTS, JOKE_LINES, lookupCode, pickJokeLine } from "./secret/codes";
import type { Achievement } from "./achievements";

// The run of consecutive "already redeemed" answers in this session, and the last line shown.
export interface RedeemStreak {
  count: number;
  lastLine: number | null;
}

export const NO_STREAK: RedeemStreak = { count: 0, lastLine: null };

// From this many re-entries in a row, a humor line is added (user: "if you do so 3 times in a row").
export const JOKE_FROM_STREAK = 3;

export type RedeemOutcome =
  | { kind: "empty" }
  | { kind: "unknown" }
  | { kind: "redeemed"; credits: number }
  | { kind: "already"; line?: { id: number; text: string }; endlessGreed: boolean };

// The achievement for seeing every line. Name: the default of the three in the joke file (the user
// may pick another).
export const ENDLESS_GREED: Achievement = {
  id: "endlessGreed",
  title: "Endless Greed",
  requirement: "Saw every reason you can't have more credits.",
  reward: "Reward: recorded for a future update",
};

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function lineList(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= JOKE_LINES.length) : [];
}

export function redeemedGifts(state: GameState): string[] {
  return stringList(state.redeemedGifts);
}

export function seenCodeLines(state: GameState): number[] {
  return lineList(state.seenCodeLines);
}

// Redeems a typed code against the main save. Pays a gift once per account; a repeat answers
// "already", and from the third repeat in a row adds a humor line, unseen ones first (tracked;
// all 40 seen earns Endless Greed once).
export function redeemGift(
  state: GameState,
  raw: string,
  streak: RedeemStreak,
  rng: () => number,
  nowMs: number = Date.now(),
): { next: GameState; outcome: RedeemOutcome; streak: RedeemStreak } {
  const found = lookupCode(raw);
  if (found.kind !== "gift") return { next: state, outcome: found, streak: NO_STREAK };
  const paid = redeemedGifts(state);
  if (!paid.includes(found.giftId)) {
    const credits = GIFTS[found.giftId].credits;
    return {
      next: { ...state, credits: state.credits.add(credits), redeemedGifts: [...paid, found.giftId] },
      outcome: { kind: "redeemed", credits },
      streak: NO_STREAK,
    };
  }
  const count = streak.count + 1;
  if (count < JOKE_FROM_STREAK) {
    return { next: state, outcome: { kind: "already", endlessGreed: false }, streak: { count, lastLine: streak.lastLine } };
  }
  const seen = seenCodeLines(state);
  const id = pickJokeLine(streak.lastLine, rng, seen);
  let next = state;
  let endlessGreed = false;
  if (!seen.includes(id)) {
    const all = [...seen, id].sort((a, b) => a - b);
    next = { ...state, seenCodeLines: all };
    if (all.length >= JOKE_LINES.length && state.endlessGreedAt === undefined) {
      next = { ...next, endlessGreedAt: nowMs };
      endlessGreed = true;
    }
  }
  return {
    next,
    outcome: { kind: "already", line: { id, text: JOKE_LINES[id - 1] }, endlessGreed },
    streak: { count, lastLine: id },
  };
}

// Theme styles earned on this account (the Starfall unlock mirror, design section 7).
export function hasThemeStyle(state: GameState, id: string): boolean {
  return stringList(state.unlockedThemeStyles).includes(id);
}

export function unlockThemeStyle(state: GameState, id: string): GameState {
  if (hasThemeStyle(state, id)) return state;
  return { ...state, unlockedThemeStyles: [...stringList(state.unlockedThemeStyles), id] };
}
