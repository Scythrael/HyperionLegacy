// risingBars.test.ts: the 0.14.0 prestige redesign's rising bars (plan
// docs/plans/2026-10-27-minigame-prestige-redesign-plan.md, Slice 2; design 3.1).
//
// The Fleet bar rises by FLEET_BAR_RATIO per Fleet since the last Prestigeception and drops back to
// 1.8e308 at a Prestigeception; the Prestigeception bar rises by PC_BAR_RATIO per lifetime
// Prestigeception and never resets. Payouts still measure from the base bars (user: "Harder pays
// more"). The automatic prestiges read the same bar as the buttons, live and through catch-up
// (Review Focus 2), and a save with many Fleets since its last Prestigeception is told to
// Prestigeception first (Review Focus 1).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, cloneSecret, serializeSecret, deserializeSecret, type SecretState } from "./state";
import {
  fleetBarExponent,
  pcBarExponent,
  nextFleetBarExponent,
  nextPcBarExponent,
  fleetGain,
  prestigeceptionGain,
  captainGain,
  doCaptain,
  doFleet,
  doPrestigeception,
  prestigePreview,
  effectiveExponent,
  stepMut,
  pow10,
  unsoftenExponent,
} from "./engine";
import { advanceTo } from "./catchUp";
import { FLEET_AT, PRESTIGECEPTION_AT, FLEET_BAR_RATIO, PC_BAR_RATIO, COPY, SKILLS } from "./config";
import { prestigeCardBars, formatBar } from "./prestigeCards";

const T0 = 1_000_000;

// A state whose every peak (run, Fleet, Prestigeception, best) sits at effective exponent e, with no
// generators (so nothing grows while it steps).
function atPeak(e: number, fleets = 0, pcs = 0): SecretState {
  const s = freshSecretState(T0);
  const ore = pow10(unsoftenExponent(e));
  s.ore = ore;
  s.runPeak = ore;
  s.fleetPeak = ore;
  s.pcPeak = ore;
  s.bestOre = ore;
  s.fleetCount = fleets;
  s.fleetTotal = fleets + 3 * pcs;
  s.pcCount = pcs;
  return s;
}

// Just below and just at a bar (the bar compares effective exponents).
const below = (bar: number) => bar - 1e-6;
const at = (bar: number) => bar + 1e-6;

describe("the Fleet bar", () => {
  it("is exactly the base 1.8e308 for the first Fleet since the last Prestigeception", () => {
    expect(fleetBarExponent(freshSecretState(T0))).toBe(FLEET_AT);
    expect(fleetGain(atPeak(below(FLEET_AT))).eq(0)).toBe(true);
    expect(fleetGain(atPeak(at(FLEET_AT))).gt(0)).toBe(true);
  });

  it("rises by FLEET_BAR_RATIO with every Fleet since the last Prestigeception, and only pays at the risen bar", () => {
    let prev = FLEET_AT;
    for (let n = 1; n <= 12; n++) {
      const bar = fleetBarExponent(atPeak(400, n));
      expect(bar).toBeCloseTo(FLEET_AT * Math.pow(FLEET_BAR_RATIO, n), 9);
      expect(bar).toBeGreaterThan(prev);
      expect(nextFleetBarExponent(atPeak(400, n - 1))).toBe(bar);
      expect(fleetGain(atPeak(below(bar), n)).eq(0), `n=${n} below`).toBe(true);
      expect(fleetGain(atPeak(at(bar), n)).gt(0), `n=${n} at`).toBe(true);
      prev = bar;
    }
  });

  it("goes back to 1.8e308 after a Prestigeception (and a Fleet raises it)", () => {
    const s = atPeak(at(PRESTIGECEPTION_AT), 4);
    expect(fleetBarExponent(s)).toBeGreaterThan(FLEET_AT);
    const after = doPrestigeception(s, T0);
    expect(after.fleetCount).toBe(0);
    expect(fleetBarExponent(after)).toBe(FLEET_AT);
    const fleet = doFleet(atPeak(1000, 2), T0);
    expect(fleet.fleetCount).toBe(3);
    expect(fleetBarExponent(fleet)).toBeCloseTo(FLEET_AT * Math.pow(FLEET_BAR_RATIO, 3), 9);
  });

  it("pays from the base bar: clearing a risen bar pays more Augment Points, and the same peak pays the same", () => {
    const base = fleetGain(atPeak(at(FLEET_AT), 0));
    for (let n = 1; n <= 6; n++) {
      const risen = fleetGain(atPeak(at(fleetBarExponent(atPeak(400, n))), n));
      expect(risen.gt(base), `n=${n}: ${risen.toString()} > ${base.toString()}`).toBe(true);
    }
    // The same climb above both bars pays exactly the same, whatever the count.
    expect(fleetGain(atPeak(1000, 2)).eq(fleetGain(atPeak(1000, 0)))).toBe(true);
    // A real Fleet at the risen bar banks that bigger gain.
    const s = atPeak(at(fleetBarExponent(atPeak(400, 3))), 3);
    const g = fleetGain(s);
    expect(doFleet(s, T0).augmentPoints.eq(s.augmentPoints.add(g))).toBe(true);
  });
});

describe("the Prestigeception bar", () => {
  it("rises by PC_BAR_RATIO with every lifetime Prestigeception and never resets", () => {
    expect(pcBarExponent(freshSecretState(T0))).toBe(PRESTIGECEPTION_AT);
    for (let m = 1; m <= 8; m++) {
      const bar = pcBarExponent(atPeak(400, 0, m));
      expect(bar).toBeCloseTo(PRESTIGECEPTION_AT * Math.pow(PC_BAR_RATIO, m), 6);
      expect(nextPcBarExponent(atPeak(400, 0, m - 1))).toBe(bar);
      expect(prestigeceptionGain(atPeak(below(bar), 0, m)).eq(0), `m=${m} below`).toBe(true);
      expect(prestigeceptionGain(atPeak(at(bar), 0, m)).gt(0), `m=${m} at`).toBe(true);
    }
    // A Prestigeception raises it; a Fleet leaves it alone.
    const pc = doPrestigeception(atPeak(at(PRESTIGECEPTION_AT)), T0);
    expect(pcBarExponent(pc)).toBe(PRESTIGECEPTION_AT * PC_BAR_RATIO);
    const fleet = doFleet(atPeak(1000, 0, 2), T0);
    expect(pcBarExponent(fleet)).toBe(pcBarExponent(atPeak(1000, 0, 2)));
  });

  it("pays from the base bar: clearing a risen bar pays more Dream Points", () => {
    const base = prestigeceptionGain(atPeak(at(PRESTIGECEPTION_AT)));
    for (let m = 1; m <= 4; m++) {
      const risen = prestigeceptionGain(atPeak(at(pcBarExponent(atPeak(400, 0, m))), 0, m));
      expect(risen.gt(base), `m=${m}`).toBe(true);
    }
    expect(prestigeceptionGain(atPeak(40000, 0, 3)).eq(prestigeceptionGain(atPeak(40000)))).toBe(true);
  });

  it("previews nothing below a risen bar (the button and the preview read the same bar)", () => {
    const bar = pcBarExponent(atPeak(400, 0, 2));
    expect(prestigePreview(atPeak(below(bar), 0, 2), "pc")).toBeNull();
    expect(prestigePreview(atPeak(at(bar), 0, 2), "pc")).not.toBeNull();
    const fbar = fleetBarExponent(atPeak(400, 3));
    expect(prestigePreview(atPeak(below(fbar), 3), "fleet")).toBeNull();
    expect(prestigePreview(atPeak(at(fbar), 3), "fleet")).not.toBeNull();
  });
});

describe("captainSinceFleet", () => {
  it("counts Captain Prestiges and resets at a Fleet Prestige and at a Prestigeception", () => {
    let s = atPeak(100);
    expect(captainGain(s).gt(0)).toBe(true);
    for (let i = 1; i <= 3; i++) {
      s = doCaptain(s, T0);
      expect(s.captainSinceFleet).toBe(i);
      s = cloneSecret(s);
      const ore = pow10(100);
      s.ore = ore;
      s.runPeak = ore;
    }
    // A Fleet resets it.
    const fleet = cloneSecret(s);
    fleet.fleetPeak = pow10(400);
    const afterFleet = doFleet(fleet, T0);
    expect(afterFleet.fleetCount).toBe(1);
    expect(afterFleet.captainSinceFleet).toBe(0);
    // A Prestigeception resets it.
    const pc = cloneSecret(s);
    pc.pcPeak = pow10(at(PRESTIGECEPTION_AT));
    const afterPc = doPrestigeception(pc, T0);
    expect(afterPc.pcCount).toBe(1);
    expect(afterPc.captainSinceFleet).toBe(0);
    // It is saved once it holds something and loads back.
    const back = deserializeSecret(serializeSecret(s), T0)!;
    expect(back.captainSinceFleet).toBe(3);
  });

  it("counts automatic Captain Prestiges in live play", () => {
    const s = freshSecretState(0);
    for (const id of ["autoOverclock", "autoBuyLow", "autoCaptain"] as const) s.skills[id] = true;
    let captains = 0;
    for (let i = 1; i <= 4 * 3600; i++) {
      const c0 = s.captainCount;
      const f0 = s.fleetTotal;
      stepMut(s, 1, i * 1000);
      if (s.fleetTotal > f0) captains = 0;
      captains += s.captainCount - c0;
    }
    expect(s.captainCount).toBeGreaterThan(0);
    expect(s.captainSinceFleet).toBe(captains);
  });
});

// Every skill, every automation switched on (the real automated climb).
function automated(s: SecretState): SecretState {
  for (const d of SKILLS) s.skills[d.id] = true;
  return s;
}

// Only the two automatic prestiges under test: no auto-buyer and no Captain Prestige, so a state with
// no generators keeps its peaks and only the bar decides.
function topAutos(s: SecretState): SecretState {
  s.skills.autoFleet = true;
  s.skills.autoPc = true;
  return s;
}

describe("automatic Fleet and Prestigeception read the risen bar (Review Focus 2)", () => {
  // No generators: the peaks never move, so only the bar decides.
  it("never fire below the bar, live or through catch-up (exact and coarse), and fire once it is reached", () => {
    const fleetBar = fleetBarExponent(atPeak(400, 3));
    const fleetBelow = topAutos(atPeak(below(fleetBar), 3));
    const pcBar = pcBarExponent(atPeak(400, 0, 2));
    const pcBelow = topAutos(atPeak(below(pcBar), 0, 2));
    // pcBelow is past the Fleet bar too: the Fleet fires (it is below the Prestigeception bar), the
    // Prestigeception never does.
    for (const [label, s0] of [["fleet", fleetBelow], ["pc", pcBelow]] as const) {
      const live = cloneSecret(s0);
      for (let i = 1; i <= 600; i++) stepMut(live, 1, T0 + i * 1000);
      const exact = advanceTo(s0, T0 + 3600 * 1000).state;
      const coarse = advanceTo(s0, T0 + 3 * 86400 * 1000).state;
      for (const [how, x] of [["live", live], ["exact", exact], ["coarse", coarse]] as const) {
        expect(x.pcCount, `${label} ${how}`).toBe(s0.pcCount);
        if (label === "fleet") expect(x.fleetCount, `${label} ${how}`).toBe(s0.fleetCount);
      }
    }
    // At the bar, each fires on the first step.
    const fleetAt = topAutos(atPeak(at(fleetBar), 3));
    stepMut(fleetAt, 1, T0 + 1000);
    expect(fleetAt.fleetCount).toBe(4);
    const pcAt = topAutos(atPeak(at(pcBar), 0, 2));
    stepMut(pcAt, 1, T0 + 1000);
    expect(pcAt.pcCount).toBe(3);
  });

  it("in a real automated climb, every automatic Fleet and Prestigeception fired at or above its bar", () => {
    const s = automated(freshSecretState(0));
    let fleets = 0;
    let pcs = 0;
    for (let i = 1; i <= 36 * 3600; i++) {
      const pre = cloneSecret(s);
      stepMut(s, 1, i * 1000);
      if (s.pcCount > pre.pcCount) {
        pcs++;
        expect(effectiveExponent(pre.pcPeak)).toBeGreaterThanOrEqual(pcBarExponent(pre));
      } else if (s.fleetTotal > pre.fleetTotal) {
        fleets++;
        expect(effectiveExponent(pre.fleetPeak)).toBeGreaterThanOrEqual(fleetBarExponent(pre));
      }
    }
    // The climb went far enough to raise the Fleet bar at least once.
    expect(fleets).toBeGreaterThanOrEqual(2);
    expect(pcs + fleets).toBeGreaterThan(0);
  }, 240000);
});

describe("the Prestige cards (Review Focus 1)", () => {
  it("show Needs and Next one needs from the engine's bars", () => {
    expect(formatBar(FLEET_AT)).toBe("1.8e308");
    expect(formatBar(PRESTIGECEPTION_AT)).toBe("e10,000");
    expect(formatBar(15000)).toBe("e15,000");
    expect(formatBar(385.31909)).toBe("2.08e385");
    expect(formatBar(2.9999999)).toBe("e3");
    const fresh = prestigeCardBars(freshSecretState(T0));
    expect(fresh.fleetNeeds).toBe("1.8e308 Ore");
    expect(fresh.fleetNext).toBe(`${formatBar(FLEET_AT * FLEET_BAR_RATIO)} Ore`);
    expect(fresh.fleetButton).toBe("Fleet Prestige (needs 1.8e308 Ore)");
    expect(fresh.pcNeeds).toBe("e10,000 Ore in one climb");
    expect(fresh.pcNext).toBe("e15,000 Ore");
    expect(fresh.pcButton).toBe("Prestigeception (needs e10,000 Ore)");
    const risen = prestigeCardBars(atPeak(400, 2, 1));
    expect(risen.fleetNeeds).toBe(`${formatBar(FLEET_AT * FLEET_BAR_RATIO ** 2)} Ore`);
    expect(risen.pcNeeds).toBe("e15,000 Ore in one climb");
    expect(risen.pcNext).toBe("e22,500 Ore");
  });

  it("a converted save with many Fleets since its last Prestigeception is told to Prestigeception first, and that clears it", () => {
    // A 0.13.11.2 save (flat bar) that did 30 Fleets without a Prestigeception.
    const old = atPeak(20000, 30);
    old.augmentPoints = new Decimal(1e6);
    const s = deserializeSecret(serializeSecret(old), T0)!;
    expect(s.fleetCount).toBe(30);
    expect(fleetBarExponent(s)).toBeGreaterThan(pcBarExponent(s));
    const cards = prestigeCardBars(s);
    expect(cards.fleetPcFirst).toBe(true);
    expect(cards.fleetNeeds).toBe(COPY.pcFirst);
    expect(cards.fleetNext).toBe(COPY.pcFirst);
    expect(cards.fleetButton).toBe(`Fleet Prestige (${COPY.pcFirst})`);
    // The Fleet pays nothing at this climb; the Prestigeception does, and resets the Fleet bar.
    expect(fleetGain(s).eq(0)).toBe(true);
    expect(prestigeceptionGain(s).gt(0)).toBe(true);
    const after = doPrestigeception(s, T0);
    expect(fleetBarExponent(after)).toBe(FLEET_AT);
    expect(prestigeCardBars(after).fleetNeeds).toBe("1.8e308 Ore");
    // The automatic prestiges get there too.
    const auto = topAutos(cloneSecret(s));
    stepMut(auto, 1, T0 + 1000);
    expect(auto.pcCount).toBe(1);
    expect(auto.fleetCount).toBe(0);
  });

  it("says Prestigeception first on Next one needs only once the next Fleet bar passes the Prestigeception bar", () => {
    let flipped = -1;
    for (let n = 0; n < 40; n++) {
      const c = prestigeCardBars(atPeak(400, n));
      if (c.fleetNextPcFirst && flipped < 0) flipped = n;
      expect(c.fleetNext === COPY.pcFirst).toBe(c.fleetNextPcFirst);
      expect(c.fleetNeeds === COPY.pcFirst).toBe(c.fleetPcFirst);
    }
    expect(flipped).toBeGreaterThan(0);
    expect(nextFleetBarExponent(atPeak(400, flipped))).toBeGreaterThan(PRESTIGECEPTION_AT);
    expect(fleetBarExponent(atPeak(400, flipped))).toBeLessThanOrEqual(PRESTIGECEPTION_AT);
  });
});
