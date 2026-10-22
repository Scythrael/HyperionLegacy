import { describe, it, expect, beforeAll } from "vitest";
import Decimal from "break_infinity.js";
import { advanceTo, createCatchUp, EXACT_BOUND_SECONDS, MAX_CATCHUP_STEPS } from "./catchUp";
import { serializeSecret, freshSecretState, type SecretState } from "./state";
import { effectiveExponent } from "./engine";
import { earlyManualState, midAutoState, postPrestigeceptionState, pastFinaleState, live } from "./testStates";

const H = 3600;
// console.log is swallowed by this repo's vitest setup; stdout is not, so measurements still show.
const report = (line: string) => process.stdout.write(`${line}\n`);

let states: Record<string, SecretState>;
beforeAll(() => {
  states = {
    early: earlyManualState(),
    mid: midAutoState(),
    postPc: postPrestigeceptionState(),
    pastFinale: pastFinaleState(),
  };
}, 60000);

describe("short gaps match live exactly", () => {
  for (const gap of [1, 59, 3600, EXACT_BOUND_SECONDS]) {
    it(`a ${gap} s gap equals ${gap} live seconds`, () => {
      const s = states.mid;
      const caught = advanceTo(s, s.lastTickAt + gap * 1000 + 400);
      expect(caught.mode).toBe("exact");
      let liveState = s;
      for (let i = 1; i <= gap; i++) liveState = advanceTo(liveState, s.lastTickAt + i * 1000).state;
      expect(serializeSecret(caught.state)).toBe(serializeSecret(liveState));
    }, 60000);
  }
});

// Lexicographic progress from the top layer down: more Dream Points beats anything below, then
// Augment Points, then Captain Points. A prestige resets the currencies under it, so comparing a
// lower currency alone would punish a catch-up for having prestiged further.
function progressAtLeast(a: SecretState, b: SecretState): boolean {
  if (!a.dreamPoints.eq(b.dreamPoints)) return a.dreamPoints.gt(b.dreamPoints);
  if (a.fleetTotal !== b.fleetTotal || !a.augmentPoints.eq(b.augmentPoints)) {
    return a.augmentPoints.gt(b.augmentPoints) || (a.augmentPoints.eq(b.augmentPoints) && a.fleetTotal >= b.fleetTotal);
  }
  return a.captainPoints.gte(b.captainPoints);
}

describe("long gaps never pay less than live", () => {
  const cases: [string, number][] = [];
  for (const name of ["early", "mid", "postPc", "pastFinale"]) for (const gap of [EXACT_BOUND_SECONDS + 1, 10 * H, 2 * 24 * H]) cases.push([name, gap]);
  cases.push(["mid", 7 * 24 * H]);
  for (const [name, gap] of cases) {
    it(`${name} state, ${(gap / H).toFixed(1)} h away`, () => {
      const s = states[name];
      const coarse = advanceTo(s, s.lastTickAt + gap * 1000);
      expect(coarse.mode).toBe("coarse");
      const l = live(s, gap);
      const c = coarse.state;
      expect(c.lastTickAt).toBe(l.lastTickAt);
      // best Ore ever, on the scale the player sees and is paid by
      const eL = effectiveExponent(l.bestOre);
      const eC = effectiveExponent(c.bestOre);
      const e0 = effectiveExponent(s.bestOre);
      expect(eC).toBeGreaterThanOrEqual(eL - 1e-9 * Math.max(1, eL));
      // The sane bound above: never more than live play would have reached by staying open twice as
      // long. (Auto prestiges fire at slightly different moments at different step sizes, and in a
      // loop of automatic resets that compounds, so the bound is stated in time rather than in Ore.)
      // Checked on the gaps up to 10 hours, where a doubled live run stays quick to compute.
      if (gap <= 10 * H) {
        const generous = effectiveExponent(live(s, gap * 2).bestOre);
        expect(eC).toBeLessThanOrEqual(generous + 1e-9 * Math.max(1, generous));
      }
      expect(progressAtLeast(c, l)).toBe(true);
      expect(c.dreamPoints.gte(l.dreamPoints)).toBe(true);
      // with no resets in the window, the run itself (Ore, Overclock, owned) is comparable too
      const noReset = c.captainCount === s.captainCount && l.captainCount === s.captainCount && c.fleetTotal === s.fleetTotal && l.fleetTotal === s.fleetTotal && c.pcCount === s.pcCount && l.pcCount === s.pcCount;
      if (noReset) {
        expect(effectiveExponent(c.ore)).toBeGreaterThanOrEqual(effectiveExponent(l.ore) - 1e-9 * Math.max(1, effectiveExponent(l.ore)));
        expect(c.overclock).toBeGreaterThanOrEqual(l.overclock);
        for (let k = 0; k < 8; k++) expect(c.owned[k].gte(l.owned[k].mul(1 - 1e-9))).toBe(true);
      }
      report(`[parity] ${name} ${(gap / H).toFixed(1)}h: live e${eL.toFixed(1)} coarse e${eC.toFixed(1)} (start e${e0.toFixed(1)}) steps ${coarse.steps} noReset ${noReset}`);
    }, 60000);
  }
});

describe("catch-up stays fast", () => {
  it("a 30-day gap stays fast", () => {
    const s = states.mid;
    const t0 = performance.now();
    const r = advanceTo(s, s.lastTickAt + 30 * 24 * H * 1000);
    const ms = performance.now() - t0;
    report(`[perf] 30-day catch-up: ${r.steps} steps in ${ms.toFixed(0)} ms`);
    expect(r.steps).toBeLessThanOrEqual(MAX_CATCHUP_STEPS);
    expect(ms).toBeLessThan(1500);
  });

  it("a full exact window stays fast too", () => {
    const s = states.pastFinale;
    const t0 = performance.now();
    const r = advanceTo(s, s.lastTickAt + EXACT_BOUND_SECONDS * 1000);
    const ms = performance.now() - t0;
    report(`[perf] 6-hour exact catch-up: ${r.steps} steps in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});

describe("sliced catch-up", () => {
  for (const gap of [2 * H, 2 * 24 * H]) {
    it(`running a ${gap / H} h job in slices gives the same state as one call`, () => {
      const s = states.mid;
      const whole = advanceTo(s, s.lastTickAt + gap * 1000);
      const job = createCatchUp(s, s.lastTickAt + gap * 1000);
      let slices = 0;
      while (!job.run(997)) slices += 1;
      expect(slices).toBeGreaterThan(1);
      expect(serializeSecret(job.result().state)).toBe(serializeSecret(whole.state));
      expect(job.result().steps).toBe(whole.steps);
    }, 60000);
  }
});

describe("clock edges", () => {
  it("fractions of a second carry over", () => {
    const s = freshSecretState(1000);
    const a = advanceTo(s, 2500);
    expect(a.seconds).toBe(1);
    expect(a.state.lastTickAt).toBe(2000);
    const b = advanceTo(a.state, 3000);
    expect(b.seconds).toBe(1);
    expect(b.state.lastTickAt).toBe(3000);
    expect(advanceTo(b.state, 3999).steps).toBe(0);
  });

  it("a clock that runs backwards pays nothing and re-anchors", () => {
    const s = freshSecretState(100000);
    s.ore = new Decimal(1234);
    const r = advanceTo(s, 50000);
    expect(r.steps).toBe(0);
    expect(r.state.lastTickAt).toBe(50000);
    expect(r.state.ore.eq(1234)).toBe(true);
  });

  it("a non-finite clock does nothing", () => {
    const s = freshSecretState(0);
    expect(advanceTo(s, NaN).state).toBe(s);
  });
});
