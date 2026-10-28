// redesignGoldens.test.ts: the prestige redesign's "before" picture (plan
// docs/plans/2026-10-27-minigame-prestige-redesign-plan.md, Slice 0).
//
// Captured on the UNCHANGED engine (feat/crew-0.14.0 before any redesign edit), so every later slice
// can name each number it moves and why. Five captures:
//   fleetBarLadder   the Fleet bar (lowest effective peak exponent that pays) for the 1st to 6th Fleet
//                    since the last Prestigeception, and fleetGain at effective peaks 308, 400, 1,000
//                    and 10,000 on each rung. Today the bar is a flat 1.8e308 on every rung.
//   pcBarLadder      the same for the 1st to 4th lifetime Prestigeception and prestigeceptionGain.
//                    Today the bar is a flat e10,000.
//   skillState       per player (average, optimal, casual): the skills in purchase order with the
//                    second each was bought, and the Skill Points held at the stop.
//   milestoneUnlocks per player: the second each milestone was recorded.
//   pacingRelicFree  per player: the whole relic-free timeline (every sim event, in seconds) to
//                    e10,000,000.
// The redesign is EXPECTED to move these; a slice that moves one says which and why in its carry
// note, then regenerates ON PURPOSE: GOLDEN_WRITE=1 npx vitest run src/lib/secret/redesignGoldens.test.ts
// Slice 2 (rising bars, with the review's "Make them bite") moved fleetBarLadder and pcBarLadder: each
// rung now holds the points the rungs before it paid when each was taken right at its bar, and its bar
// sits where the climb pays FLEET_BAR_RATIO (PC_BAR_RATIO) times those; the gains at a peak above the
// bar are unchanged, as payouts still measure from the base bars. It also moved the pacing rows (see
// the plan's Slice 2 carry note).
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { freshSecretState, type SecretState } from "./state";
import { fleetGain, prestigeceptionGain, pow10, unsoftenExponent, fleetBarExponent, pcBarExponent } from "./engine";
import { simulatePlayer, LONG_STRETCH_DT, SIM_START_MS, type SimProfile } from "./sim";
import { SKILLS, FLEET_AT, PRESTIGECEPTION_AT } from "./config";

const PATH = "src/lib/secret/redesignGoldens.json";
const PEAKS = [308, 400, 1000, 10000] as const;

type Gain = (s: SecretState) => { gt(n: number): boolean; toString(): string };

// A fresh state whose every peak (run, Fleet, Prestigeception, best) sits at effective exponent e.
function atPeak(e: number, fleets: number, pcs: number, ap = new Decimal(0), dp = new Decimal(0)): SecretState {
  const s = freshSecretState(SIM_START_MS);
  const ore = pow10(unsoftenExponent(e));
  s.ore = ore;
  s.runPeak = ore;
  s.fleetPeak = ore;
  s.pcPeak = ore;
  s.bestOre = ore;
  s.fleetCount = fleets;
  s.fleetTotal = fleets + 3 * pcs;
  s.pcCount = pcs;
  s.augmentPoints = ap;
  s.dreamPoints = dp;
  return s;
}

type Rung = [number, number, Decimal, Decimal]; // Fleets, Prestigeceptions, Augment and Dream Points held

// The lowest effective peak exponent at which the gain pays anything (bisection, to 1e-7), searched
// up to e1,000,000 (Infinity, stored as null, when even that pays nothing).
function barOf(gain: Gain, [fleets, pcs, ap, dp]: Rung): number {
  let lo = 1;
  let hi = 1e6;
  if (!gain(atPeak(hi, fleets, pcs, ap, dp)).gt(0)) return Infinity;
  while (hi - lo > 1e-7) {
    const mid = (lo + hi) / 2;
    if (gain(atPeak(mid, fleets, pcs, ap, dp)).gt(0)) hi = mid;
    else lo = mid;
  }
  return Number(hi.toFixed(6));
}

function ladder(gain: Gain, layer: "fleet" | "pc", rungs: number) {
  const out: { fleetCount: number; pcCount: number; bar: number; gains: Record<string, string> }[] = [];
  let r: Rung = [0, 0, new Decimal(0), new Decimal(0)];
  for (let i = 0; i < rungs; i++) {
    const gains: Record<string, string> = {};
    for (const e of PEAKS) gains[`e${e}`] = gain(atPeak(e, ...r)).toString();
    out.push({ fleetCount: r[0], pcCount: r[1], bar: barOf(gain, r), gains });
    // The next rung: this one taken right at its bar.
    const probe = atPeak(1, ...r);
    const bar = (layer === "fleet" ? fleetBarExponent(probe) : pcBarExponent(probe)) + 1e-6;
    const paid = new Decimal(gain(atPeak(bar, ...r)).toString());
    r = layer === "fleet" ? [r[0] + 1, r[1], r[2].add(paid), r[3]] : [r[0], r[1] + 1, r[2], r[3].add(paid)];
  }
  return out;
}

function bars() {
  return {
    // n Fleets already done since the last Prestigeception (none done yet)
    fleetBarLadder: ladder(fleetGain, "fleet", 6),
    // m lifetime Prestigeceptions already done
    pcBarLadder: ladder(prestigeceptionGain, "pc", 4),
  };
}

const PLAYERS: Record<string, { profile: SimProfile; days: number }> = {
  average: { profile: "average", days: 280 },
  optimal: { profile: "optimal", days: 320 },
  casual: { profile: "casual", days: 340 },
};

// One player from a fresh game to e10,000,000 (the same run as sim / simOptimal / simCasual, stopped
// at e10,000,000 instead of 20 days later; every event before the stop is the same).
function player(name: string) {
  const p = PLAYERS[name];
  const r = simulatePlayer({ profile: p.profile, days: p.days, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 0 } });
  const order = SKILLS.map((d) => d.id)
    .filter((id) => r.events[`skill:${id}`] !== undefined)
    .map((id) => [id, r.events[`skill:${id}`]] as [string, number])
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const milestones: Record<string, number> = {};
  for (const [id, at] of Object.entries(r.final.milestones).sort((a, b) => (a[1] as number) - (b[1] as number))) milestones[id] = ((at as number) - SIM_START_MS) / 1000;
  const events: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.events).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))) events[k] = v;
  return {
    skillState: { order, skillPointsAtStop: r.final.skillPoints },
    milestoneUnlocks: milestones,
    pacingRelicFree: events,
  };
}

type Goldens = {
  fleetBarLadder: unknown;
  pcBarLadder: unknown;
  skillState: Record<string, unknown>;
  milestoneUnlocks: Record<string, unknown>;
  pacingRelicFree: Record<string, unknown>;
};

const writing = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GOLDEN_WRITE === "1";

function prior(): Partial<Goldens> {
  try {
    return JSON.parse(readFileSync(PATH, "utf-8")) as Partial<Goldens>;
  } catch {
    return {};
  }
}

function golden(): Goldens {
  return JSON.parse(readFileSync(PATH, "utf-8")) as Goldens;
}

describe("redesignGoldens", () => {
  it("capture matches today: the Fleet and Prestigeception bar ladders", () => {
    const now = bars();
    if (writing) writeFileSync(PATH, JSON.stringify({ ...prior(), ...now }, null, 1) + "\n");
    const g = golden();
    // Slice 2: the first rung is the base bar and the bars never fall; from the third rung on each is
    // higher than the last (at RATIO 1 the second, taken right at the base bar, only matches the first).
    // Both were flat at 1.8e308 and e10,000 before.
    for (const [list, base] of [[now.fleetBarLadder, FLEET_AT], [now.pcBarLadder, PRESTIGECEPTION_AT]] as const) {
      expect(list[0].bar).toBeCloseTo(base, 5);
      for (let i = 1; i < list.length; i++) {
        if (i >= 2) expect(list[i].bar).toBeGreaterThan(list[i - 1].bar);
        else expect(list[i].bar).toBeGreaterThanOrEqual(list[i - 1].bar);
      }
    }
    expect(now.fleetBarLadder).toEqual(g.fleetBarLadder);
    expect(now.pcBarLadder).toEqual(g.pcBarLadder);
  });

  for (const name of Object.keys(PLAYERS)) {
    it(`capture matches today: the ${name} player's skills, milestones and relic-free pacing`, () => {
      const now = player(name);
      if (writing) {
        const p = prior();
        writeFileSync(
          PATH,
          JSON.stringify(
            {
              ...p,
              skillState: { ...(p.skillState ?? {}), [name]: now.skillState },
              milestoneUnlocks: { ...(p.milestoneUnlocks ?? {}), [name]: now.milestoneUnlocks },
              pacingRelicFree: { ...(p.pacingRelicFree ?? {}), [name]: now.pacingRelicFree },
            },
            null,
            1,
          ) + "\n",
        );
      }
      const g = golden();
      expect(now.skillState).toEqual(g.skillState[name]);
      expect(now.milestoneUnlocks).toEqual(g.milestoneUnlocks[name]);
      expect(now.pacingRelicFree).toEqual(g.pacingRelicFree[name]);
    }, 900000);
  }
});
