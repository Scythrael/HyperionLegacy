// sim.ts: the steady-player pacing simulation for the secret game (0.13.11). TESTS ONLY: the app
// never imports this file. sim.test.ts pins the planned playtime with it (design section 7).
//
// The player: starts at 18:00 with a 90-minute session and checks back at 22:00 for 20 minutes,
// then every day at 08:00, 12:30, 18:00 and 22:00 for 20 minutes ("steady"). "light" checks in
// twice a day for 15 minutes; "keen" plays longer at first and checks in six times a day. Offline
// gaps run through the real catch-up (advanceTo) with the shipping exact window, exactly as the
// game pays them.
//
// Every 3 minutes in a session (and once more on leaving) the player: buys skills in the listed
// order when affordable; takes Fleet Prestige if it at least doubles Augment Points (or is the
// first); else Prestigeception if it at least doubles Dream Points (or is the first); else, until
// Auto Captain is owned, Captain Prestige if it at least doubles Captain Points (holding off when
// the first Fleet is within reach); then, until auto-buyers cover it, Overclock Max with half the
// Ore and Max on every tier, highest first. Auto targets stay at their 100% default.
// 0.13.11.1: from e1,000,000 on, the player also buys the four upgrades at every look, cheapest next
// level first, as long as one is affordable.

import { freshSecretState, cloneSecret, type SecretState } from "./state";
import { stepMut, buyOverclockMut, buyTierMut, buySkill, canBuySkill, captainGain, fleetGain, prestigeceptionGain, doCaptain, doFleet, doPrestigeception, effectiveExponent, hasSkill, upgradesUnlocked, upgradePriceExponent, canBuyUpgrade, buyUpgrade } from "./engine";
import { advanceTo, EXACT_BOUND_SECONDS, type CatchUpOptions } from "./catchUp";
import { SKILLS, UPGRADES, type MilestoneId, type UpgradeId } from "./config";

export type SimProfile = "steady" | "light" | "keen";

// The six-month stretch: coarse offline steps of this many seconds once e1,000,000 is reached.
// Measured against the shipping catch-up from the same e1,000,000 state: e10,000,000 at 178.0 days
// here against 178.8 with the shipping catch-up (plan, pacing results). Sessions stay live play.
export const LONG_STRETCH_DT = 10;

const H = 3600;
export const SIM_START_MS = Date.UTC(2026, 9, 22, 18, 0, 0);
const START_MS = SIM_START_MS;

// shiftHours moves every daily check-in later (the first evening stays put): a robustness check.
export function sessions(profile: SimProfile, days: number, shiftHours = 0): [number, number][] {
  const out: [number, number][] = [];
  if (profile === "steady") {
    out.push([0, 90 * 60], [4 * H, 20 * 60]);
    for (let d = 1; d <= days; d++) {
      const midnight = d * 24 * H - 18 * H + shiftHours * H;
      for (const h of [8, 12.5, 18, 22]) out.push([midnight + h * H, 20 * 60]);
    }
  } else if (profile === "light") {
    out.push([0, 90 * 60]);
    for (let d = 1; d <= days; d++) {
      const midnight = d * 24 * H - 18 * H + shiftHours * H;
      for (const h of [8, 20]) out.push([midnight + h * H, 15 * 60]);
    }
  } else {
    out.push([0, 150 * 60], [4 * H, 30 * 60]);
    for (let d = 1; d <= days; d++) {
      const midnight = d * 24 * H - 18 * H + shiftHours * H;
      for (const h of [7, 10, 13, 16, 19, 22]) out.push([midnight + h * H, 20 * 60]);
    }
  }
  return out;
}

export interface SimResult {
  events: Record<string, number>; // seconds from the start
  final: SecretState;
  wallMs: number;
  samples: [number, number][]; // [seconds, best effective exponent] every 6 hours
}

// How the simulated player prestiges by hand. Targets follow the state's own auto targets (the same
// "gain at least X% of what you have" rule), so a target sweep moves the hand and the autos alike.
// manual: the automatic prestiges stay switched off (prestiging only at check-ins). spam: Fleet
// Prestige whenever it pays anything at all.
export interface PlayStyle {
  manual?: boolean;
  spam?: boolean;
}

function decide(s: SecretState, atMs: number, style: PlayStyle = {}): SecretState {
  // 0.13.11.1: the e1,000,000 upgrades, cheapest next level first, as often as affordable.
  if (upgradesUnlocked(s)) {
    for (;;) {
      let best: UpgradeId | null = null;
      let bestE = Infinity;
      for (const u of UPGRADES) {
        const e = upgradePriceExponent(s, u.id);
        if (e !== null && e < bestE && canBuyUpgrade(s, u.id)) {
          best = u.id;
          bestE = e;
        }
      }
      if (best === null) break;
      s = buyUpgrade(s, best, "one");
    }
  }
  for (const def of SKILLS) {
    if (hasSkill(s, def.id)) continue;
    if (!canBuySkill(s, def.id)) {
      if (def.requires && !hasSkill(s, def.requires)) continue;
      break;
    }
    s = buySkill(s, def.id, atMs);
  }
  const fg = fleetGain(s);
  const pg = prestigeceptionGain(s);
  const cg = captainGain(s);
  if (style.manual) {
    const off = { ...s.autoOn, autoCaptain: false, autoFleet: false, autoPc: false };
    s = { ...s, autoOn: off };
  }
  const t = s.autoTarget;
  const pays = (gain: typeof fg, have: typeof fg, pct: number) => gain.gt(0) && (have.eq(0) || gain.gte(have.mul(pct / 100)));
  if (fg.gt(0) && (style.spam || pays(fg, s.augmentPoints, t.fleet))) s = doFleet(s, atMs);
  else if (pays(pg, s.dreamPoints, t.pc)) s = doPrestigeception(s, atMs);
  else if ((style.manual || !hasSkill(s, "autoCaptain")) && pays(cg, s.captainPoints, t.captain) && !(s.fleetTotal === 0 && effectiveExponent(s.fleetPeak) >= 250)) {
    s = doCaptain(s, atMs);
  }
  if (!(hasSkill(s, "autoBuyLow") && hasSkill(s, "autoOverclock"))) {
    buyOverclockMut(s, s.ore.mul(0.5));
    for (let k = s.tiersUnlocked - 1; k >= 0; k--) buyTierMut(s, k, s.ore);
  }
  return s;
}

export interface SimOptions {
  profile?: SimProfile;
  days: number;
  exactBoundSeconds?: number;
  stopAfterLongDays?: number;
  shiftHours?: number;
  stopAfterFinale?: boolean;
  // The six-month stretch (0.13.11.1): once e1,000,000 is reached, offline gaps run as coarse
  // steps of this many seconds (no exact window) so half a year simulates in seconds. Sessions stay
  // live 1-second play. Measured against the shipping catch-up in the plan's results.
  longStretchDt?: number;
  // Stop this many days after the given effective exponent is first reached.
  stopAfterExponent?: { exponent: number; days: number };
  // Start from a saved state instead of a fresh game (exploration and reports).
  from?: SecretState;
  // Target sweeps (0.13.11.1 retune): the auto targets every layer starts with, and the hand style.
  targets?: { captain: number; fleet: number; pc: number };
  style?: PlayStyle;
}

export function simulatePlayer(opts: SimOptions): SimResult {
  const t0 = performance.now();
  const profile = opts.profile ?? "steady";
  let s = opts.from ? cloneSecret(opts.from) : freshSecretState(START_MS);
  if (opts.targets) s.autoTarget = { ...opts.targets };
  const events: Record<string, number> = {};
  const samples: [number, number][] = [];
  const sec = () => (s.lastTickAt - START_MS) / 1000;
  const mark = (name: string) => {
    if (!(name in events)) events[name] = sec();
  };
  // Milestone-backed events use the exact moment the engine recorded (also inside offline gaps);
  // the rest are noticed by the player the next time the simulation looks.
  const FROM_MILESTONES: [string, MilestoneId][] = [
    ["captain1", "firstCaptain"], ["googol", "googol"], ["fleet1", "firstFleet"], ["e1000", "e1000"],
    ["singularity", "singularity"], ["pc1", "firstPc"], ["e100000", "e100k"], ["finale", "finale"], ["long", "long"], ["starfall", "starfall"],
  ];
  const watch = () => {
    for (const [name, id] of FROM_MILESTONES) {
      const at = s.milestones[id];
      if (at !== undefined && !(name in events)) events[name] = (at - START_MS) / 1000;
    }
    const e = effectiveExponent(s.bestOre);
    if (s.fleetTotal >= 6) mark("fleet6");
    if (e >= 10000) mark("e10000");
    if (e >= 900000) mark("e900000");
    for (const m of [2e6, 3e6, 5e6, 7e6, 1e7]) if (e >= m) mark(`e${m}`);
    for (const def of SKILLS) if (hasSkill(s, def.id)) mark(`skill:${def.id}`);
    for (const u of UPGRADES) {
      const def = u;
      if ((s.upgrades[u.id] ?? 0) >= 1) mark(`up1:${u.id}`);
      if ((s.upgrades[u.id] ?? 0) >= def.cap) mark(`upMax:${u.id}`);
    }
  };
  watch();
  let nextSample = 0;
  const gapOptions = (): CatchUpOptions =>
    opts.longStretchDt !== undefined && events.long !== undefined
      ? { exactBoundSeconds: 0, minCoarseDt: opts.longStretchDt }
      : { exactBoundSeconds: opts.exactBoundSeconds ?? EXACT_BOUND_SECONDS };
  for (const [start, length] of sessions(profile, opts.days, opts.shiftHours ?? 0)) {
    const end = start + length;
    if (sec() >= end) continue; // before the starting state
    if (sec() < start) {
      s = advanceTo(s, START_MS + start * 1000, gapOptions()).state;
      watch();
    }
    let nextDecision = sec();
    while (sec() < end) {
      if (sec() >= nextDecision) {
        s = decide(s, s.lastTickAt, opts.style);
        nextDecision += 180;
      }
      stepMut(s, 1, s.lastTickAt + 1000);
      s.lastTickAt += 1000;
      watch();
    }
    s = decide(s, s.lastTickAt, opts.style);
    while (sec() >= nextSample) {
      samples.push([nextSample, effectiveExponent(s.bestOre)]);
      nextSample += 6 * H;
    }
    if (opts.stopAfterFinale && events.finale !== undefined) break;
    if (opts.stopAfterExponent) {
      const key = `e${opts.stopAfterExponent.exponent}`;
      if (events[key] !== undefined && sec() > events[key] + opts.stopAfterExponent.days * 24 * H) break;
    } else if (events.long !== undefined && sec() > events.long + (opts.stopAfterLongDays ?? 8) * 24 * H) break;
  }
  return { events, final: s, wallMs: performance.now() - t0, samples };
}

export function bestExponentAt(r: SimResult, seconds: number): number {
  let best = 0;
  for (const [t, e] of r.samples) if (t <= seconds) best = e;
  return best;
}

