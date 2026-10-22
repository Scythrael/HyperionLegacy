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
  expect(e.long).toBeGreaterThanOrEqual(26 * D);
  expect(e.long).toBeLessThanOrEqual(34 * D);
  // growth never stops: a week after e1,000,000 the best Ore is still higher
  expect(bestExponentAt(r, e.long + 7 * D)).toBeGreaterThan(bestExponentAt(r, e.long));
  // and every layer happens on the way
  expect(e.fleet1).toBeLessThan(e.pc1);
  expect(e.pc1).toBeLessThan(e.finale);
}

