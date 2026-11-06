// Complement CP-16 (plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-16, OC-22; the CP-16 notables
// answer, user 2026-11-06 "Level milestones, Firsts under command, Promotions and titles"): the missions counter and the
// notable moments a captain's command records while they serve, and the Hall of Command entry a retirement writes from
// them. Pure helpers over plain data; the engine seams that call them are named at each one.
//
// WHAT IS RECORDED, AND WHERE:
//   - missionsFlown (CaptainState): +1 per delivered mission cycle, patrol route that ends (won or lost; user 2026-11-06
//     "Count it too": a record of service, not of wins) and delivered short-range cycle (economyTick: the won routes,
//     cycles and deliveries from the same per-call counts the officers' missionsCompleted reads, plus a lost route at
//     the call its wreck limps home on). A pure additive count of closed-form counts, so it is chunk-independent: one
//     call, 997 s chunks and 1 s steps add the same total.
//   - levelMilestone: the captain reaches level 10, 20, 30 and so on (every LEVEL_MILESTONE_EVERY levels). Stamped at the
//     game second the XP that crossed the level was credited, which each XP source knows (XpSpan below): one big call
//     stamps the same second 1 s steps do.
//   - firstExpedition / firstTierTwoRun: at the dispatch (a player action, state.gameTimeSeconds): the expedition
//     records its captain (Expedition.captainId); a short-range run is flown by the captain dispatched on it.
//   - firstRelic: when a relic the captain's ship found reaches the vault: an expedition's at its claim (a player action;
//     the run records its captain), a short-range run's at the delivery that found it (the delivery's whole tick).
//   - firstRefugeeRescued: an Evacuation's delivery that brings a refugee home (the arrival's whole tick), credited to the
//     captain flying that board slot.
//   - Promotions and titles: no captain rank or title exists in code (CaptainState has none; officer ranks belong to
//     Senior Staff), so nothing is recorded for that pick.
//
// THE STAMP RULE (one convention with the refugee arrival and the short-range relic find): an event at `offset` ticks
// into an economyTick call lands on the call's whole tick max(1, ceil(offset)), and its game second is the call's
// start + that tick x tickDurationSeconds. A 1 s step's events land on its tick 1 (its end), so a big call's stamps match
// 1 s steps exactly whenever the XP arithmetic is exact (integer XP per tick, the condition the captain XP parity itself
// holds under: tick.ts's CLOSED-FORM PARITY TRAP).

import type { CaptainNotable, CaptainNotableKind, CaptainState, GameState, HallOfCommandEntry, RegionTier } from "./model";

// TEST-ONLY switch (the HULL_SENSORS_SWITCH precedent): off, nothing CP-16 records is written (no missionsFlown, no
// notables, no Hall entry), so a golden computed inside it is the pre-CP-16 game exactly (cp16Switch.fixture.ts).
export const HALL_OF_COMMAND_SWITCH = { live: true };

// A level milestone every this many levels (10, 20, 30, ...). Unbounded: a milestone is recorded however high a captain
// climbs.
export const LEVEL_MILESTONE_EVERY = 10;

const ROMAN: Readonly<Record<RegionTier, string>> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII" };

// The player line of a notable (US English).
export function levelMilestoneLabel(level: number): string {
  return `Reached level ${level}`;
}
export function firstNotableLabel(kind: Exclude<CaptainNotableKind, "levelMilestone">, tier?: RegionTier): string {
  switch (kind) {
    case "firstExpedition":
      return "First expedition";
    case "firstRelic":
      return "First relic found";
    case "firstTierTwoRun":
      return `First Tier ${ROMAN[tier ?? 2]} run`;
    case "firstRefugeeRescued":
      return "First refugee rescued";
  }
}

// The game second an event `offsetTicks` into a call lands on (THE STAMP RULE above). Pure.
export function notableSecond(callStartSeconds: number, offsetTicks: number, secondsPerTick: number): number {
  return callStartSeconds + Math.max(1, Math.ceil(offsetTicks - 1e-9)) * secondsPerTick;
}

// ===== the captain record =====

export function captainMissionsFlown(captain: Pick<CaptainState, "missionsFlown">): number {
  return captain.missionsFlown ?? 0;
}
export function captainCommandNotables(captain: Pick<CaptainState, "commandNotables">): readonly CaptainNotable[] {
  return captain.commandNotables ?? [];
}

// `captain` with its two CP-16 fields LAST, missionsFlown then commandNotables (each only when present). The record is
// written at different calls under different chunkings (a big call may add both at once, 1 s steps one at a time), and
// other optional counters join the captain at their own first write, so the order is fixed here: every whole-state hash
// and save then reads the same bytes however the span was cut. The SAME captain when already in that order. Pure.
export function withCommandKeysLast(captain: CaptainState): CaptainState {
  const hasFlown = captain.missionsFlown !== undefined;
  const hasNotables = captain.commandNotables !== undefined;
  if (!hasFlown && !hasNotables) return captain;
  // The last two own keys, read in one walk without building the key array (this runs once per captain per tick; a
  // plain data object's for...in order is its Object.keys order).
  let last: string | undefined;
  let beforeLast: string | undefined;
  for (const k in captain) {
    beforeLast = last;
    last = k;
  }
  const inOrder = hasFlown && hasNotables ? beforeLast === "missionsFlown" && last === "commandNotables" : last === (hasFlown ? "missionsFlown" : "commandNotables");
  if (inOrder) return captain;
  const { missionsFlown, commandNotables, ...rest } = captain;
  return { ...rest, ...(hasFlown ? { missionsFlown } : {}), ...(hasNotables ? { commandNotables } : {}) };
}

// `captain` with `n` more missions flown (the SAME captain for n <= 0 or with the switch off). Pure.
export function addMissionsFlown(captain: CaptainState, n: number): CaptainState {
  if (!HALL_OF_COMMAND_SWITCH.live || !(n > 0)) return captain;
  return withCommandKeysLast({ ...captain, missionsFlown: captainMissionsFlown(captain) + n });
}

// Whether the captain's command already records a first of `kind`. Pure.
export function hasCommandFirst(captain: Pick<CaptainState, "commandNotables">, kind: CaptainNotableKind): boolean {
  return captainCommandNotables(captain).some((n) => n.kind === kind);
}

// `captain` with `notables` appended in order (the SAME captain for none or with the switch off). Pure.
export function withCommandNotables(captain: CaptainState, notables: readonly CaptainNotable[]): CaptainState {
  if (!HALL_OF_COMMAND_SWITCH.live || notables.length === 0) return captain;
  return withCommandKeysLast({ ...captain, commandNotables: [...captainCommandNotables(captain), ...notables] });
}

// `captain` with its first of `kind` recorded at `atGameSeconds`, unless one is already recorded. Pure.
export function withCommandFirst(captain: CaptainState, kind: Exclude<CaptainNotableKind, "levelMilestone">, atGameSeconds: number, tier?: RegionTier): CaptainState {
  if (hasCommandFirst(captain, kind)) return captain;
  return withCommandNotables(captain, [{ kind, label: firstNotableLabel(kind, tier), atGameSeconds }]);
}

// `captain` with one economyTick call's notables applied in time order (a stable sort, so notables of one second keep the
// order the call collected them in, which is the order a 1 s step collects them in): a level milestone is appended, a
// first only when the command has none of its kind yet. The SAME captain for none or with the switch off. Pure.
export function withCallNotables(captain: CaptainState, notables: readonly CaptainNotable[]): CaptainState {
  if (!HALL_OF_COMMAND_SWITCH.live || notables.length === 0) return captain;
  const ordered = [...notables].sort((a, b) => a.atGameSeconds - b.atGameSeconds);
  let out = captain;
  for (const n of ordered) if (n.kind === "levelMilestone" || !hasCommandFirst(out, n.kind)) out = withCommandNotables(out, [n]);
  return out;
}

// The state with captain `captainId`'s first of `kind` recorded (the SAME state when there is no such captain, it is
// already recorded, or the switch is off). Pure.
export function recordCommandFirst(state: GameState, captainId: number, kind: Exclude<CaptainNotableKind, "levelMilestone">, atGameSeconds: number, tier?: RegionTier): GameState {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx < 0) return state;
  const next = withCommandFirst(state.captains[idx], kind, atGameSeconds, tier);
  if (next === state.captains[idx]) return state;
  const captains = [...state.captains];
  captains[idx] = next;
  return { ...state, captains };
}

// ===== level milestones =====

// One stretch of a call's XP for a captain: `wholes` credits of `units` each, the first landing `at` ticks into the call
// and each later one `spacing` ticks after the one before (1 while time passes, 0 inside a time skip). Each XP source
// records its own (an extraction or short-range step's whole ticks, a patrol's won wave), in call order.
export interface XpSpan {
  at: number;
  wholes: number;
  units: number;
  spacing: number;
}

// The level milestones crossed this call and the call's whole tick each landed on, lowest first. `levelAt(u)` is the
// SOURCE's own closed form: the captain's level after `u` units of this call's award (so the stamps follow exactly the
// arithmetic the call's final level does). Empty when no milestone is crossed (the common case: one fold, no search).
// Pure.
export function levelMilestoneTicks(level0: number, spans: readonly XpSpan[], levelAt: (units: number) => number): { level: number; atTick: number }[] {
  const total = spans.reduce((n, s) => n + s.wholes * s.units, 0);
  if (!(total > 0)) return [];
  const finalLevel = levelAt(total);
  const first = (Math.floor(level0 / LEVEL_MILESTONE_EVERY) + 1) * LEVEL_MILESTONE_EVERY;
  const out: { level: number; atTick: number }[] = [];
  let before = 0;
  let si = 0;
  for (let milestone = first; milestone <= finalLevel; milestone += LEVEL_MILESTONE_EVERY) {
    // Walk to the span whose end reaches the milestone, then the first whole inside it that does (levelAt is monotone).
    while (si < spans.length && levelAt(before + spans[si].wholes * spans[si].units) < milestone) {
      before += spans[si].wholes * spans[si].units;
      si += 1;
    }
    if (si >= spans.length) break; // unreachable: the final level is past the milestone
    const span = spans[si];
    let lo = 1;
    let hi = span.wholes;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (levelAt(before + mid * span.units) >= milestone) hi = mid;
      else lo = mid + 1;
    }
    out.push({ level: milestone, atTick: Math.max(1, Math.ceil(span.at + (lo - 1) * span.spacing - 1e-9)) });
  }
  return out;
}

// Whether a climb from `fromLevel` to `toLevel` passes a milestone (the arms' cheap guard: the search runs only then).
export function crossesLevelMilestone(fromLevel: number, toLevel: number): boolean {
  return Math.floor(toLevel / LEVEL_MILESTONE_EVERY) > Math.floor(fromLevel / LEVEL_MILESTONE_EVERY);
}

// The level milestone notables of `crossed`, stamped from the call's start. Pure.
export function levelMilestoneNotables(crossed: readonly { level: number; atTick: number }[], callStartSeconds: number, secondsPerTick: number): CaptainNotable[] {
  return crossed.map((m) => ({ kind: "levelMilestone", label: levelMilestoneLabel(m.level), atGameSeconds: callStartSeconds + m.atTick * secondsPerTick }));
}

// ===== the Hall of Command =====

// The entry a retirement of `captain` at `retiredAtGameSeconds` appends (its retirement number counts this one). Pure.
export function hallOfCommandEntryFor(captain: CaptainState, retiredAtGameSeconds: number): HallOfCommandEntry {
  return {
    captainName: captain.label,
    levelReached: captain.level,
    retirementNumber: (captain.retirements ?? 0) + 1,
    missionsFlown: captainMissionsFlown(captain),
    retiredAtGameSeconds,
    notables: captainCommandNotables(captain).map((n) => ({ ...n })),
  };
}

export function hallOfCommandOf(state: Pick<GameState, "hallOfCommand">): readonly HallOfCommandEntry[] {
  return state.hallOfCommand ?? [];
}
