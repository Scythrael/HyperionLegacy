// risingBars.test.ts: the 0.14.0 prestige redesign's rising bars (plan
// docs/plans/2026-10-27-minigame-prestige-redesign-plan.md, Slice 2; design 3.1; Slice 2 review "Make
// them bite").
//
// Each bar sits where the climb pays FLEET_BAR_RATIO (PC_BAR_RATIO) times the points that layer has
// already paid and you still hold: the Augment Points since the last Prestigeception for a Fleet, every
// Dream Point for a Prestigeception. So the Fleet bar rises with every Fleet and drops back to 1.8e308 at
// a Prestigeception; the Prestigeception bar rises with every Prestigeception and never resets. Payouts
// still measure from the base bars (user: "Harder pays more"). The automatic prestiges read the same bar
// as the buttons, live and through catch-up (Review Focus 2), and a converted save holding many Augment
// Points is told to Prestigeception first and never deadlocks (Review Focus 1).
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
import { postPrestigeceptionState } from "./testStates";
import { report } from "./testReport";

const T0 = 1_000_000;

// Moves every peak (run, Fleet, Prestigeception, best) to effective exponent e.
function setPeak(s: SecretState, e: number): SecretState {
  const ore = pow10(unsoftenExponent(e));
  s.ore = ore;
  s.runPeak = ore;
  s.fleetPeak = ore;
  s.pcPeak = ore;
  s.bestOre = ore;
  return s;
}

// A fresh state at effective exponent e holding ap Augment Points and dp Dream Points, with no
// generators (so nothing grows while it steps).
function atPeak(e: number, ap = 0, dp = 0): SecretState {
  const s = setPeak(freshSecretState(T0), e);
  s.augmentPoints = new Decimal(ap);
  s.dreamPoints = new Decimal(dp);
  return s;
}

// Just below and just past a bar (the bar compares effective exponents).
const below = (bar: number) => bar - 1e-6;
const at = (bar: number) => bar + 1e-6;

describe("the Fleet bar", () => {
  it("is exactly the base 1.8e308 with no Augment Points held (the first Fleet of a Prestigeception)", () => {
    expect(fleetBarExponent(freshSecretState(T0))).toBe(FLEET_AT);
    expect(fleetGain(atPeak(below(FLEET_AT))).eq(0)).toBe(true);
    expect(fleetGain(atPeak(at(FLEET_AT))).gt(0)).toBe(true);
  });

  it("rises with every Fleet: each one must pay FLEET_BAR_RATIO times what the Fleets before it paid", () => {
    let s = atPeak(at(FLEET_AT));
    let prev = fleetBarExponent(s);
    let n = 0;
    // Up to the finale (past it the Fleet gain curve changes, and so does the bar).
    while (prev < 500000) {
      s = doFleet(s, T0);
      n++;
      expect(s.fleetCount).toBe(n);
      const bar = fleetBarExponent(s);
      // At RATIO 1 the second Fleet, taken right at the base bar, only has to match the first; from
      // the third on each one must pay more than every Fleet before it together, so the bar rises.
      if (n === 1 && FLEET_BAR_RATIO === 1) expect(bar, `n=${n}`).toBeGreaterThanOrEqual(prev);
      else expect(bar, `n=${n}`).toBeGreaterThan(prev);
      // Below the bar nothing; at it, a payout of at least RATIO x the points held.
      expect(fleetGain(setPeak(cloneSecret(s), below(bar))).eq(0), `n=${n} below`).toBe(true);
      const g = fleetGain(setPeak(cloneSecret(s), at(bar)));
      expect(g.gte(s.augmentPoints.mul(FLEET_BAR_RATIO).floor()), `n=${n}: ${g.toString()}`).toBe(true);
      prev = bar;
      s = setPeak(s, at(bar));
    }
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("goes back to 1.8e308 after a Prestigeception (the Augment Points are emptied)", () => {
    const s = atPeak(at(PRESTIGECEPTION_AT), 1e6);
    expect(fleetBarExponent(s)).toBeGreaterThan(FLEET_AT);
    const after = doPrestigeception(s, T0);
    expect(after.fleetCount).toBe(0);
    expect(fleetBarExponent(after)).toBe(FLEET_AT);
  });

  it("pays from the base bar: clearing a risen bar pays more Augment Points, and the same climb pays the same", () => {
    const base = fleetGain(atPeak(at(FLEET_AT)));
    for (const ap of [50, 500, 5000]) {
      const s = atPeak(400, ap);
      const risen = fleetGain(setPeak(s, at(fleetBarExponent(s))));
      expect(risen.gt(base), `ap=${ap}: ${risen.toString()} > ${base.toString()}`).toBe(true);
    }
    // A climb above the bar pays exactly what it paid with nothing held.
    expect(fleetGain(atPeak(10000, 40)).eq(fleetGain(atPeak(10000)))).toBe(true);
  });
});

describe("the Prestigeception bar", () => {
  it("rises with every Prestigeception and never resets", () => {
    expect(pcBarExponent(freshSecretState(T0))).toBe(PRESTIGECEPTION_AT);
    let s = atPeak(at(PRESTIGECEPTION_AT));
    let prev = pcBarExponent(s);
    for (let m = 1; m <= 6; m++) {
      s = doPrestigeception(s, T0);
      const bar = pcBarExponent(s);
      if (m === 1 && PC_BAR_RATIO === 1) expect(bar, `m=${m}`).toBeGreaterThanOrEqual(prev);
      else expect(bar, `m=${m}`).toBeGreaterThan(prev);
      expect(prestigeceptionGain(setPeak(cloneSecret(s), below(bar))).eq(0), `m=${m} below`).toBe(true);
      const g = prestigeceptionGain(setPeak(cloneSecret(s), at(bar)));
      expect(g.gte(s.dreamPoints.mul(PC_BAR_RATIO).floor()), `m=${m}`).toBe(true);
      prev = bar;
      s = setPeak(s, at(bar));
    }
    // A Fleet leaves it alone.
    const f = setPeak(cloneSecret(s), 1000);
    expect(pcBarExponent(doFleet(f, T0))).toBe(pcBarExponent(f));
  });

  it("pays from the base bar: clearing a risen bar pays more Dream Points", () => {
    const base = prestigeceptionGain(atPeak(at(PRESTIGECEPTION_AT)));
    const s = atPeak(400, 0, 50000);
    expect(prestigeceptionGain(setPeak(s, at(pcBarExponent(s)))).gt(base)).toBe(true);
    expect(prestigeceptionGain(atPeak(400000, 0, 50000)).eq(prestigeceptionGain(atPeak(400000)))).toBe(true);
  });

  it("previews nothing below a risen bar (the button and the preview read the same bar)", () => {
    const pc = atPeak(400, 0, 50000);
    const bar = pcBarExponent(pc);
    expect(prestigePreview(setPeak(cloneSecret(pc), below(bar)), "pc")).toBeNull();
    expect(prestigePreview(setPeak(cloneSecret(pc), at(bar)), "pc")).not.toBeNull();
    const fl = atPeak(400, 500);
    const fbar = fleetBarExponent(fl);
    expect(prestigePreview(setPeak(cloneSecret(fl), below(fbar)), "fleet")).toBeNull();
    expect(prestigePreview(setPeak(cloneSecret(fl), at(fbar)), "fleet")).not.toBeNull();
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
    const fleet = cloneSecret(s);
    fleet.fleetPeak = pow10(400);
    const afterFleet = doFleet(fleet, T0);
    expect(afterFleet.fleetCount).toBe(1);
    expect(afterFleet.captainSinceFleet).toBe(0);
    const pc = cloneSecret(s);
    pc.pcPeak = pow10(at(PRESTIGECEPTION_AT));
    const afterPc = doPrestigeception(pc, T0);
    expect(afterPc.pcCount).toBe(1);
    expect(afterPc.captainSinceFleet).toBe(0);
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
// no generators keeps its peaks and only the bar decides. Auto targets at their lowest, so the target
// alone would fire at once.
function topAutos(s: SecretState): SecretState {
  s.skills.autoFleet = true;
  s.skills.autoPc = true;
  // 0.14.0 Slice 3: the milestones these peaks record grant the other automations; a switch that is
  // already off stays off through the grant, so they stay out of the way.
  for (const id of ["autoOverclock", "autoBuyLow", "autoBuyHigh", "autoCaptain", "autoSkills", "autoUpgrades"] as const) s.autoOn[id] = false;
  s.autoTarget = { captain: 10, fleet: 10, pc: 10 };
  return s;
}

describe("automatic Fleet and Prestigeception read the risen bar (Review Focus 2)", () => {
  it("never fire below the bar, live or through catch-up (exact and coarse), and fire once it is reached", () => {
    const fleetBar = fleetBarExponent(atPeak(400, 500));
    const pcBar = pcBarExponent(atPeak(400, 0, 50000));
    // The Fleet cases keep their Prestigeception climb short (that layer is tested on its own).
    const fleetCase = (e: number) => {
      const x = topAutos(atPeak(e, 500));
      x.ore = pow10(1000);
      x.runPeak = x.ore;
      x.pcPeak = x.ore;
      return x;
    };
    const fleetBelow = fleetCase(below(fleetBar));
    // Below the Prestigeception bar but past the (empty) Fleet bar: the Fleet fires, the
    // Prestigeception never does.
    const pcBelow = topAutos(atPeak(below(pcBar), 0, 50000));
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
    const fleetAt = fleetCase(at(fleetBar));
    stepMut(fleetAt, 1, T0 + 1000);
    expect(fleetAt.fleetCount).toBe(1);
    const pcAt = topAutos(atPeak(at(pcBar), 0, 50000));
    stepMut(pcAt, 1, T0 + 1000);
    expect(pcAt.pcCount).toBe(1);
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
    expect(fleets).toBeGreaterThanOrEqual(2);
    expect(pcs).toBeGreaterThanOrEqual(1);
  }, 240000);
});

describe("the Prestige cards (Review Focus 1)", () => {
  it("show Needs and Next one from the engine's bars", () => {
    expect(formatBar(FLEET_AT)).toBe("1.8e308");
    expect(formatBar(PRESTIGECEPTION_AT)).toBe("e10,000");
    expect(formatBar(15000)).toBe("e15,000");
    expect(formatBar(385.31909)).toBe("2.08e385");
    expect(formatBar(2.9999999)).toBe("e3");
    expect(formatBar(Infinity)).toBe("e∞");
    const fresh = freshSecretState(T0);
    const c = prestigeCardBars(fresh);
    expect(c.fleetNeeds).toBe("1.8e308 Ore");
    expect(c.fleetNext).toBe(`${formatBar(nextFleetBarExponent(fresh))} Ore`);
    expect(nextFleetBarExponent(fresh)).toBeGreaterThanOrEqual(FLEET_AT);
    expect(c.fleetButton).toBe("Fleet Prestige (needs 1.8e308 Ore)");
    expect(c.pcNeeds).toBe("e10,000 Ore in one climb");
    expect(c.pcNext).toBe(`${formatBar(nextPcBarExponent(fresh))} Ore`);
    expect(c.pcButton).toBe("Prestigeception (needs e10,000 Ore)");
    // Held points: the bars and the next ones rise.
    const held = atPeak(400, 500, 50000);
    const r = prestigeCardBars(held);
    expect(r.fleetNeeds).toBe(`${formatBar(fleetBarExponent(held))} Ore`);
    expect(r.pcNeeds).toBe(`${formatBar(pcBarExponent(held))} Ore in one climb`);
    expect(nextFleetBarExponent(held)).toBeGreaterThan(fleetBarExponent(held));
    expect(nextPcBarExponent(held)).toBeGreaterThan(pcBarExponent(held));
    // Next one assumes the prestige is taken now when the climb is already past the bar.
    const past = setPeak(cloneSecret(held), 5000);
    expect(nextFleetBarExponent(past)).toBeGreaterThan(nextFleetBarExponent(held));
  });

  it("a converted save holding many Augment Points is told to Prestigeception first, and that clears it", () => {
    // A 0.13.11.2 save (flat bar, small Fleets) that piled up Augment Points over 30 Fleets.
    const old = atPeak(400, 1e9, 20000);
    setPeak(old, at(pcBarExponent(old)));
    old.fleetCount = 30;
    old.fleetTotal = 33;
    old.pcCount = 1;
    const s = deserializeSecret(serializeSecret(old), T0)!;
    expect(fleetBarExponent(s)).toBeGreaterThan(pcBarExponent(s));
    const cards = prestigeCardBars(s);
    expect(cards.fleetPcFirst).toBe(true);
    expect(cards.fleetNeeds).toBe(COPY.pcFirst);
    expect(cards.fleetNext).toBe(COPY.pcFirst);
    expect(cards.fleetButton).toBe(`Fleet Prestige (${COPY.pcFirst})`);
    expect(fleetGain(s).eq(0)).toBe(true);
    expect(prestigeceptionGain(s).gt(0)).toBe(true);
    const after = doPrestigeception(s, T0);
    expect(fleetBarExponent(after)).toBe(FLEET_AT);
    expect(prestigeCardBars(after).fleetNeeds).toBe("1.8e308 Ore");
    const auto = topAutos(cloneSecret(s));
    auto.autoTarget = { captain: 100, fleet: 100, pc: 100 };
    stepMut(auto, 1, T0 + 1000);
    expect(auto.pcCount).toBe(2);
    expect(auto.fleetCount).toBe(0);
  });

  it("a converted save HOLDING Dream Points with its Fleet blocked does not deadlock: the climb keeps growing until the Prestigeception pays", () => {
    // A real post-Prestigeception state, everything automated at the 100% targets, converted with 30
    // Fleets' worth of Augment Points: the Fleet bar sits far above every climb, and the Prestigeception
    // needs a climb that pays at least what the save holds (PC_BAR_RATIO x its Dream Points).
    const s = automated(postPrestigeceptionState());
    s.fleetCount = 30;
    s.augmentPoints = new Decimal(1e12);
    expect(s.dreamPoints.gt(0)).toBe(true);
    expect(fleetBarExponent(s)).toBeGreaterThan(pcBarExponent(s));
    expect(prestigeCardBars(s).fleetNeeds).toBe(COPY.pcFirst);
    // Captain Prestiges keep firing (Captain Points stack up, every climb goes further) until a climb
    // reaches the Prestigeception bar; that empties the Augment Points and the Fleets start again.
    let x = s;
    let hours = 0;
    while (x.pcCount === s.pcCount && hours < 72) {
      x = advanceTo(x, x.lastTickAt + 3600 * 1000).state;
      hours++;
    }
    report(`[review focus 1] converted save holding ${s.dreamPoints.toString()} Dream Points, Fleet blocked: Prestigeception after ${hours} h (${x.captainCount - s.captainCount} Captain Prestiges on the way)`);
    expect(x.pcCount).toBe(s.pcCount + 1);
    expect(x.captainCount).toBeGreaterThan(s.captainCount);
    expect(fleetBarExponent(x)).toBeLessThan(fleetBarExponent(s));
    const later = advanceTo(x, x.lastTickAt + 12 * 3600 * 1000).state;
    expect(later.fleetTotal).toBeGreaterThan(x.fleetTotal);
  }, 240000);

  it("says Prestigeception first on Next one only once the next Fleet bar passes the Prestigeception bar", () => {
    let flipped = -1;
    for (let ap = 1; ap < 1e9; ap *= 3) {
      const c = prestigeCardBars(atPeak(400, ap));
      expect(c.fleetNext === COPY.pcFirst).toBe(c.fleetNextPcFirst);
      expect(c.fleetNeeds === COPY.pcFirst).toBe(c.fleetPcFirst);
      if (c.fleetNextPcFirst && flipped < 0) flipped = ap;
    }
    expect(flipped).toBeGreaterThan(1);
    expect(nextFleetBarExponent(atPeak(400, flipped))).toBeGreaterThan(PRESTIGECEPTION_AT);
  });
});
