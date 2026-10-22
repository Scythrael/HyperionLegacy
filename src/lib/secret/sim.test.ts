import { describe, it, expect } from "vitest";
import { simulatePlayer, bestExponentAt, type SimResult } from "./sim";

// console.log is swallowed by this repo's vitest setup; stdout is not.
const report = (line: string) => process.stdout.write(`${line}\n`);
const H = 3600;
const D = 24 * H;
const fmt = (t: number | undefined) => (t === undefined ? "never" : t < 2 * D ? `${(t / H).toFixed(2)} h` : `${(t / D).toFixed(2)} d`);

function timeline(label: string, r: SimResult): void {
  const rows = Object.entries(r.events).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${k} ${fmt(v)}`);
  report(`[sim:${label}] ${rows.join(" | ")} (wall ${r.wallMs.toFixed(0)} ms)`);
}

describe("steady player pacing", () => {
  it("lands in the planned bands: first Captain in 30 to 60 min, finale in 3 to 5 days, e1,000,000 in about a month, still climbing after", () => {
    const r = simulatePlayer({ profile: "steady", days: 40 });
    timeline("steady", r);
    const e = r.events;
    expect(e.captain1).toBeGreaterThanOrEqual(30 * 60);
    expect(e.captain1).toBeLessThanOrEqual(60 * 60);
    expect(e.finale).toBeGreaterThanOrEqual(3 * D);
    expect(e.finale).toBeLessThanOrEqual(5 * D);
    expect(e.long).toBeGreaterThanOrEqual(26 * D);
    expect(e.long).toBeLessThanOrEqual(34 * D);
    // growth never stops: a week after e1,000,000 the best Ore is still higher
    const atLong = bestExponentAt(r, e.long);
    const weekLater = bestExponentAt(r, e.long + 7 * D);
    expect(weekLater).toBeGreaterThan(atLong);
    // and every layer happens on the way
    expect(e.fleet1).toBeLessThan(e.pc1);
    expect(e.pc1).toBeLessThan(e.finale);
  }, 120000);
});

describe("other players (robustness, reported)", () => {
  it("a light and a keen player both reach the finale in a sensible range", () => {
    const light = simulatePlayer({ profile: "light", days: 12, stopAfterLongDays: 0 });
    const keen = simulatePlayer({ profile: "keen", days: 12, stopAfterLongDays: 0 });
    timeline("light", light);
    timeline("keen", keen);
    expect(light.events.finale).toBeLessThanOrEqual(8 * D);
    expect(keen.events.finale).toBeGreaterThanOrEqual(2.5 * D);
    expect(keen.events.finale).toBeLessThanOrEqual(light.events.finale);
  }, 120000);
});
