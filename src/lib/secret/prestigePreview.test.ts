// prestigePreview.test.ts: the Prestige tab's "now" previews (0.13.11.2) show exactly the engine's
// state before and after a real prestige call, on every layer and edge case.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, cloneSecret, serializeSecret, type SecretState, type AutoLayer } from "./state";
import {
  prestigePreview,
  prestigeWeights,
  doCaptain,
  doFleet,
  doPrestigeception,
  captainMultiplier,
  augmentMultiplier,
  prestigeMultiplier,
  gainMultiplier,
  dreamSpeedMultiplier,
  captainGain,
  fleetGain,
  prestigeceptionGain,
  allSkillsLearned,
  pow10,
} from "./engine";
import { SKILLS, UPGRADES, STARFALL_EXPONENT, LONG_EXPONENT, type UpgradeId } from "./config";
import { devJumpTo } from "./devTools";

const AT = 5_000_000;

const fire: Record<AutoLayer, (s: SecretState, t: number) => SecretState> = {
  captain: doCaptain,
  fleet: doFleet,
  pc: doPrestigeception,
};

function eq(a: Decimal, b: Decimal, what: string): void {
  expect(a.eq(b), `${what}: ${a.toString()} vs ${b.toString()}`).toBe(true);
}

// The preview's before and after equal the multipliers read off the state before and after the
// real prestige call, and the preview leaves its input untouched.
function expectMatchesReal(s: SecretState, layer: AutoLayer): { before: SecretState; after: SecretState } {
  const snapshot = serializeSecret(s);
  const p = prestigePreview(s, layer);
  expect(serializeSecret(s)).toBe(snapshot);
  expect(p, `${layer} preview`).not.toBeNull();
  const after = fire[layer](s, AT);
  expect(after).not.toBe(s);
  const real = { before: prestigeWeights(s), after: prestigeWeights(after) };
  for (const side of ["before", "after"] as const) {
    const x = side === "before" ? s : after;
    eq(p![side].captain, captainMultiplier(x), `${layer} ${side} captain`);
    eq(p![side].augment, augmentMultiplier(x), `${layer} ${side} augment`);
    eq(p![side].stack, prestigeMultiplier(x), `${layer} ${side} stack`);
    eq(p![side].gains, gainMultiplier(x), `${layer} ${side} gains`);
    eq(p![side].dreamSpeed, dreamSpeedMultiplier(x), `${layer} ${side} dream speed`);
    eq(p![side].stack, real[side].stack, `${layer} ${side} weights`);
  }
  return { before: s, after };
}

// A state with every layer ready: the run, Fleet and Prestigeception peaks all past their thresholds.
function ready(points: { cp?: number; ap?: number; dp?: number } = {}): SecretState {
  const s = freshSecretState(0);
  s.found = true;
  s.lastTickAt = AT;
  s.ore = pow10(12000);
  s.runPeak = s.ore;
  s.fleetPeak = s.ore;
  s.pcPeak = s.ore;
  s.bestOre = s.ore;
  s.captainPoints = new Decimal(points.cp ?? 0);
  s.augmentPoints = new Decimal(points.ap ?? 0);
  s.dreamPoints = new Decimal(points.dp ?? 0);
  return s;
}

function withUpgrade(s: SecretState, id: UpgradeId, level: number): SecretState {
  const x = cloneSecret(s);
  x.upgrades[id] = level;
  return x;
}

const cap = (id: UpgradeId) => UPGRADES.find((u) => u.id === id)!.cap;

describe("prestige previews", () => {
  it("are hidden (null) while a layer pays nothing, and the button would do nothing", () => {
    const s = freshSecretState(0);
    for (const layer of ["captain", "fleet", "pc"] as const) {
      expect(prestigePreview(s, layer)).toBeNull();
      expect(fire[layer](s, AT)).toBe(s);
    }
    expect(captainGain(s).eq(0) && fleetGain(s).eq(0) && prestigeceptionGain(s).eq(0)).toBe(true);
  });

  it("Captain from zero points: x1 to the multiplier the paid points give", () => {
    const s = ready();
    const { after } = expectMatchesReal(s, "captain");
    const p = prestigePreview(s, "captain")!;
    eq(p.before.captain, new Decimal(1), "zero points is x1");
    expect(p.after.captain.gt(p.before.captain)).toBe(true);
    eq(after.captainPoints, captainGain(s), "the points the reset pays");
  });

  it("Captain with points held and every Captain's Compound level", () => {
    for (let level = 0; level <= cap("captainsCompound"); level++) {
      const s = withUpgrade(ready({ cp: 5000, ap: 40, dp: 3 }), "captainsCompound", level);
      expectMatchesReal(s, "captain");
      const p = prestigePreview(s, "captain")!;
      expect(p.after.captain.gt(p.before.captain), `Compound ${level}`).toBe(true);
      // A Captain Prestige leaves Augment and Dream Points alone.
      eq(p.after.augment, p.before.augment, `Compound ${level} augment`);
      eq(p.after.gains, p.before.gains, `Compound ${level} gains`);
    }
  });

  it("Fleet: Augment rises, Captain goes back to x1, and the whole stack can fall", () => {
    const big = ready({ cp: 1e12, ap: 0 });
    expectMatchesReal(big, "fleet");
    const p = prestigePreview(big, "fleet")!;
    expect(p.after.augment.gt(p.before.augment)).toBe(true);
    eq(p.after.captain, new Decimal(1), "Captain Points reset");
    expect(p.after.stack.lt(p.before.stack)).toBe(true);

    const small = ready({ cp: 0, ap: 10 });
    expectMatchesReal(small, "fleet");
    const q = prestigePreview(small, "fleet")!;
    expect(q.after.stack.gt(q.before.stack)).toBe(true);
  });

  it("Fleet with Compound and Lucid Dreaming levels", () => {
    for (const [cc, ld] of [[1, 0], [0, 3], [cap("captainsCompound"), cap("lucidDreaming")]]) {
      const s = withUpgrade(withUpgrade(ready({ cp: 300, ap: 700, dp: 90 }), "captainsCompound", cc), "lucidDreaming", ld);
      expectMatchesReal(s, "fleet");
    }
  });

  it("Fleet after the Skill Point cutoff (every skill learned)", () => {
    const s = ready({ cp: 50, ap: 20 });
    for (const d of SKILLS) s.skills[d.id] = true;
    s.skillPoints = 2;
    expect(allSkillsLearned(s)).toBe(true);
    const { after } = expectMatchesReal(s, "fleet");
    expect(after.skillPoints).toBe(2);
  });

  it("Prestigeception from zero Dream Points: gains x1 to their new boost", () => {
    const s = ready({ cp: 900, ap: 80, dp: 0 });
    expectMatchesReal(s, "pc");
    const p = prestigePreview(s, "pc")!;
    eq(p.before.gains, new Decimal(1), "zero Dream Points is x1");
    expect(p.after.gains.gt(1)).toBe(true);
    // Without Lucid Dreaming the Dream Points do not speed the stack.
    eq(p.after.dreamSpeed, new Decimal(1), "no Lucid Dreaming");
  });

  it("Prestigeception: Captain and Augment Points go back to 0, so the whole stack falls to the Dream speed", () => {
    for (const ld of [0, 1, cap("lucidDreaming")]) {
      const s = withUpgrade(ready({ cp: 900, ap: 80, dp: 50 }), "lucidDreaming", ld);
      const { after } = expectMatchesReal(s, "pc");
      const p = prestigePreview(s, "pc")!;
      expect(after.captainPoints.eq(0) && after.augmentPoints.eq(0)).toBe(true);
      eq(p.after.captain, new Decimal(1), `Lucid ${ld} captain`);
      eq(p.after.augment, new Decimal(1), `Lucid ${ld} augment`);
      eq(p.after.stack, p.after.dreamSpeed, `Lucid ${ld} stack is the Dream speed alone`);
      eq(p.before.stack, captainMultiplier(s).mul(augmentMultiplier(s)).mul(dreamSpeedMultiplier(s)), `Lucid ${ld} stack before`);
      expect(p.after.stack.lt(p.before.stack), `Lucid ${ld} stack falls`).toBe(true);
    }
  });

  it("Prestigeception at every Lucid Dreaming level", () => {
    for (let level = 0; level <= cap("lucidDreaming"); level++) {
      const s = withUpgrade(ready({ cp: 900, ap: 80, dp: 1234 }), "lucidDreaming", level);
      expectMatchesReal(s, "pc");
      const p = prestigePreview(s, "pc")!;
      expect(p.after.gains.gt(p.before.gains)).toBe(true);
      if (level > 0) expect(p.after.dreamSpeed.gt(p.before.dreamSpeed), `Lucid ${level}`).toBe(true);
      else eq(p.after.dreamSpeed, new Decimal(1), "Lucid 0");
    }
  });

  it("match real prestiges on engine-built late states (past e1,000,000 and past Starfall)", () => {
    for (const target of [LONG_EXPONENT + 100, STARFALL_EXPONENT + 100]) {
      const s = devJumpTo(freshSecretState(0), target, AT);
      expect(allSkillsLearned(s)).toBe(true);
      let shown = 0;
      for (const layer of ["captain", "fleet", "pc"] as const) {
        if (prestigePreview(s, layer) === null) expect(fire[layer](s, AT)).toBe(s);
        else {
          expectMatchesReal(s, layer);
          shown += 1;
        }
      }
      expect(shown, `layers ready at ${target}`).toBe(3);
    }
  });
});
