// simReport.ts: prints a simulated timeline into the gate output. Test-only.
import { expect } from "vitest";
import { report } from "./testReport";
import { bestExponentAt, type SimResult } from "./sim";
import { UPGRADES } from "./config";

export const H = 3600;
export const D = 24 * H;

const fmt = (t: number | undefined) => (t === undefined ? "never" : t < 2 * D ? `${(t / H).toFixed(2)} h` : `${(t / D).toFixed(2)} d`);

export function timeline(label: string, r: SimResult): void {
  const rows = Object.entries(r.events)
    .sort((a, b) => a[1] - b[1])
    .map(([k, v]) => `${k} ${fmt(v)}`);
  report(`[sim:${label}] ${rows.join(" | ")} (wall ${r.wallMs.toFixed(0)} ms)`);
}

// The planned bands (design section 7, answer 20), shared by the pacing tests.
export function expectPlannedBands(r: SimResult): void {
  const e = r.events;
  expect(e.captain1).toBeGreaterThanOrEqual(30 * 60);
  expect(e.captain1).toBeLessThanOrEqual(60 * 60);
  expect(e.finale).toBeGreaterThanOrEqual(3 * D);
  expect(e.finale).toBeLessThanOrEqual(5 * D);
  // 0.13.11.1 curve round (Q3 + PC 0.5): e1,000,000 a little past a month (measured 32.3 d)
  expect(e.long).toBeGreaterThanOrEqual(28 * D);
  expect(e.long).toBeLessThanOrEqual(37 * D);
  // growth never stops: a week after e1,000,000 the best Ore is still higher
  expect(bestExponentAt(r, e.long + 7 * D)).toBeGreaterThan(bestExponentAt(r, e.long));
  // and every layer happens on the way
  expect(e.fleet1).toBeLessThan(e.pc1);
  expect(e.pc1).toBeLessThan(e.finale);
}

// 0.13.11.1 (design section 6): the four e1,000,000 upgrades carry the steady player to
// e10,000,000 in about four months (about 120 days, user: "About 4 months") and every upgrade gets
// bought on the way, and growth after the final stop slows (the 20 days after it add less than the
// 20 days before it; since the curve round a second bend past e10,000,000 does that, user: "Slow it
// after e10M").
export function expectSixMonthBand(r: SimResult): void {
  const e = r.events;
  // 0.13.11.1 content pacing (user: "About 4 months"): about 120 days for the average player
  expect(e.starfall).toBeGreaterThanOrEqual(110 * D);
  expect(e.starfall).toBeLessThanOrEqual(130 * D);
  for (const id of UPGRADES.map((u) => u.id)) {
    expect(e[`up1:${id}`], id).toBeGreaterThanOrEqual(e.long);
    expect(e[`upMax:${id}`], id).toBeLessThanOrEqual(e.starfall + 2 * D);
  }
  expectSlowsAfterStarfall(r);
}

// The 20 days after e10,000,000 add less than the 20 days before it, and growth never stops.
export function expectSlowsAfterStarfall(r: SimResult): void {
  const e = r.events;
  const before = bestExponentAt(r, e.starfall) - bestExponentAt(r, e.starfall - 20 * D);
  const after = bestExponentAt(r, e.starfall + 20 * D) - bestExponentAt(r, e.starfall);
  report(`[after e10M] 20 d before +${Math.round(before)}, 20 d after +${Math.round(after)}`);
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
}


// 0.13.11.1 (user: "Retune so default is best"): the steady player at the DEFAULT 100% targets,
// measured by sim.test.ts (which checks it still lands here). The target sweeps compare against it.
// 0.14.0 combined pacing retune (prestige redesign Slices 2 to 4): re-measured, 4.88 / 32.35 / 119.15 days before.
// (review round: re-measured with the player's own first Prestigeception and PC_BAR_RATIO 3: 3.62 / 32.95 / 122.98)
// (Slice 5a retune, user 2026-10-29 "Pay at the bar" and "All 49 points before e10M": PC_BAR_RATIO 2, CP_K 0.53 x
// CAPTAIN_BEND, SOFT_SCALE 63, re-measured)
export const DEFAULT_STEADY = { finale: 3.764 * D, long: 32.1007 * D, starfall: 118.0556 * D }; // 3.76 d, 32.10 d, 118.06 d
// R2-10 (relic boosts): the relic-free goals the relic pins compare against, measured on the shipped
// engine (relic-free runs are byte-identical, so these are fixed): the optimal and casual players
// (simOptimal / simCasual) and the average player (DEFAULT_STEADY). In days.
export const RELIC_FREE = {
  // 0.14.0 combined pacing retune: re-measured (optimal 4.46 / 34.47 / 130.06 before, casual 6.86 / 47.84 / 140.65)
  // (Slice 5a retune: re-measured, 3.51 / 31.62 / 116.34 and casual 5.62 / 32.71 / 123.28 before)
  optimal: { finale: 3.6035, long: 32.0313, starfall: 120.2188 },
  average: { finale: DEFAULT_STEADY.finale / D, long: DEFAULT_STEADY.long / D, starfall: DEFAULT_STEADY.starfall / D },
  casual: { finale: 4.8051, long: 32.5024, starfall: 120.6095 },
} as const;
// 0.14.0 Slice 5a: the relic pins are measured on the SHIPPING catch-up all the way (the LONG_STRETCH_DT shortcut
// runs fast past e1,000,000 and not by the same amount with relics), against these relic-free goals on the same
// shipping catch-up (each relic pin file checks its own row), in days.
// (Slice 5a retune: re-measured; 3.62 / 32.95 / 124.93, 3.51 / 31.62 / 122.39 and 5.62 / 32.71 / 123.36 before)
export const RELIC_FREE_SHIPPING = {
  average: { finale: 3.764, long: 32.1007, starfall: 120.322 },
  optimal: { finale: 3.6035, long: 32.0313, starfall: 123.13 },
  casual: { finale: 4.8051, long: 32.5024, starfall: 120.0299 },
} as const;
// The average player with the TYPICAL collection (simRelicsAverage.test.ts measures it), in days.
// (0.14.0 combined pacing retune: re-measured, 4.17 / 27.87 / 101.29 before; the relic bands are Slice 5's)
// Slice 5a: the typical collection re-based on the tier stagger (Tier I, four types), on the shipping catch-up.
// Slice 5a retune (pay at the bar, the four Tier I levers x6.5, user 2026-10-29): 3.65 / 30.56 / 117.86 before, x1.01 /
// 0.93 / 0.94 of relic-free; now x0.890 / 0.851 / 0.876, inside Gentle.
export const TYPICAL_RELIC_AVERAGE = { finale: 3.35, long: 27.31, starfall: 105.44 };
export const RELIC_GOALS = ["finale", "long", "starfall"] as const;

// Each goal's time with relics over the time without (0.85 = 15% faster), reported and returned.
export function relicRatios(label: string, r: SimResult, base: Readonly<Record<(typeof RELIC_GOALS)[number], number>>): Record<(typeof RELIC_GOALS)[number], number> {
  const out = {} as Record<(typeof RELIC_GOALS)[number], number>;
  for (const g of RELIC_GOALS) {
    expect(r.events[g], `${label} ${g}`).toBeDefined();
    out[g] = r.events[g] / D / base[g];
  }
  report(`[relics:${label}] ${RELIC_GOALS.map((g) => `${g} ${(r.events[g] / D).toFixed(2)} d (x${out[g].toFixed(3)}, ${((1 - out[g]) * 100).toFixed(1)}% faster)`).join(" | ")}`);
  return out;
}

// How much sooner another target choice may reach a milestone and still count as "no better".
export const TARGET_MARGIN = 0.03;

// Another way to play reaches the finale and e1,000,000 no sooner than the default, within the margin
// (never reaching e1,000,000 inside the simulated days counts as later).
export function expectNoBetterThanDefault(label: string, r: SimResult): void {
  expect(r.events.finale, `${label} finale`).toBeDefined();
  for (const key of ["finale", "long"] as const) {
    const t = r.events[key];
    if (t === undefined) continue;
    expect(t, `${label} ${key}`).toBeGreaterThanOrEqual(DEFAULT_STEADY[key] * (1 - TARGET_MARGIN));
  }
}
