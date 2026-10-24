// simReport.ts: prints a simulated timeline into the gate output. Test-only.
import { expect } from "vitest";
import { report } from "./testReport";
import { bestExponentAt, type SimResult } from "./sim";

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
// e10,000,000 in about seven months (about 220 days since the curve round) and every upgrade gets
// bought on the way. Growth after the final stop: before the curve round the 20 days after it added
// less than the 20 days before. With the curve round's rarer, bigger Captain resets the late runs
// climb longer, and the 20 days after now add about twice the 20 days before (measured 3.78M against
// 1.91M; Lucid Dreaming maxes six days before e10,000,000). [OPEN, for the user] Pinned: growth goes
// on and stays within three times the 20 days before.
export function expectSixMonthBand(r: SimResult): void {
  const e = r.events;
  // 0.13.11.1 curve round (Q3 + PC 0.5, user: "a little while longer overall"): measured 220.3 d
  expect(e.starfall).toBeGreaterThanOrEqual(190 * D);
  expect(e.starfall).toBeLessThanOrEqual(245 * D);
  for (const id of ["ocOverclocker", "tenfoldTuner", "captainsCompound", "lucidDreaming"]) {
    expect(e[`up1:${id}`], id).toBeGreaterThanOrEqual(e.long);
    expect(e[`upMax:${id}`], id).toBeLessThanOrEqual(e.starfall + 2 * D);
  }
  const before = bestExponentAt(r, e.starfall) - bestExponentAt(r, e.starfall - 20 * D);
  const after = bestExponentAt(r, e.starfall + 20 * D) - bestExponentAt(r, e.starfall);
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(3 * before);
}


// 0.13.11.1 (user: "Retune so default is best"): the steady player at the DEFAULT 100% targets,
// measured by sim.test.ts (which checks it still lands here). The target sweeps compare against it.
export const DEFAULT_STEADY = { finale: 422012, long: 2794738 }; // 4.88 d and 32.35 d (curve round)
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
