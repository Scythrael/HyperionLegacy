// devTools.test.ts: the [DEV] minigame shortcuts land states the engine accepts (0.13.11.1).
import { describe, it, expect } from "vitest";
import { freshSecretState, serializeSecret, deserializeSecret, cloneSecret, type SecretState } from "./state";
import { devMarkFound, devMaxSkills, devJumpTo } from "./devTools";
import { effectiveExponent, upgradesUnlocked, upgradeLevel, hasSkill, autoActive, isTierUnlocked, stepMut, captainGain, fleetGain, prestigeceptionGain } from "./engine";
import { SKILLS, UPGRADES, MILESTONES, LONG_EXPONENT, STARFALL_EXPONENT, TIER_COUNT } from "./config";
import { newlyReached } from "./runtime";

const NOW = Date.UTC(2026, 9, 23, 12);

function accepted(s: SecretState): SecretState {
  const back = deserializeSecret(serializeSecret(s), 0);
  expect(back).not.toBeNull();
  expect(serializeSecret(back!)).toBe(serializeSecret(s));
  return back!;
}

function liveFor(s: SecretState, seconds: number): SecretState {
  const x = cloneSecret(s);
  for (let i = 1; i <= seconds; i++) stepMut(x, 1, s.lastTickAt + i * 1000);
  x.lastTickAt = s.lastTickAt + seconds * 1000;
  return x;
}

describe("Mark found", () => {
  it("unlocks as a first combo success would", () => {
    const s = devMarkFound(freshSecretState(NOW), NOW);
    expect(s.found).toBe(true);
    expect(s.foundAt).toBe(NOW);
    expect(devMarkFound(s, NOW + 5).foundAt).toBe(NOW);
    accepted(s);
  });
});

describe("Max skills", () => {
  it("owns every skill with every switch on, and records the milestone", () => {
    const s = devMaxSkills(freshSecretState(NOW), NOW);
    for (const d of SKILLS) {
      expect(hasSkill(s, d.id)).toBe(true);
      if (d.auto) expect(autoActive(s, d.id)).toBe(true);
    }
    expect(s.milestones.allSkills).toBe(NOW);
    accepted(s);
  });
});

for (const [label, target] of [["e1,000,000", LONG_EXPONENT], ["e10,000,000", STARFALL_EXPONENT]] as const) {
  describe(`Jump to ${label}`, () => {
    const before = devMarkFound(freshSecretState(NOW), NOW);
    const s = devJumpTo(before, target, NOW);

    it("lands a consistent state the engine accepts", () => {
      accepted(s);
      expect(effectiveExponent(s.bestOre)).toBeGreaterThanOrEqual(target);
      expect(effectiveExponent(s.bestOre)).toBeLessThan(target * 1.001);
      expect(s.runPeak.eq(s.ore) && s.fleetPeak.eq(s.ore) && s.pcPeak.eq(s.ore)).toBe(true);
      expect(s.tiersUnlocked).toBe(TIER_COUNT);
      for (let k = 0; k < TIER_COUNT; k++) {
        expect(isTierUnlocked(s, k)).toBe(true);
        expect(s.bought[k]).toBeGreaterThan(0);
        expect(s.owned[k].gte(s.bought[k])).toBe(true);
        expect(s.peakOwned[k].gte(s.owned[k])).toBe(true);
      }
      expect(s.peakOverclock).toBeGreaterThanOrEqual(s.overclock);
      expect(s.captainCount).toBeGreaterThan(0);
      expect(s.fleetTotal).toBeGreaterThanOrEqual(6);
      expect(s.fleetCount).toBeLessThanOrEqual(s.fleetTotal);
      expect(s.pcCount).toBeGreaterThan(0);
      expect(upgradesUnlocked(s)).toBe(true);
      expect(s.found).toBe(true);
      for (const d of SKILLS) expect(hasSkill(s, d.id)).toBe(true);
    });

    it("no automatic prestige is due on arrival (the jump does not reset itself)", () => {
      expect(captainGain(s).lt(s.captainPoints)).toBe(true);
      expect(fleetGain(s).lt(s.augmentPoints)).toBe(true);
      expect(prestigeceptionGain(s).lt(s.dreamPoints)).toBe(true);
    });

    it("keeps running sanely: an hour of live play climbs a little, no reset, no blow-up", () => {
      const later = liveFor(s, 3600);
      const e0 = effectiveExponent(s.bestOre);
      const e1 = effectiveExponent(later.bestOre);
      expect(Number.isFinite(e1)).toBe(true);
      expect(e1).toBeGreaterThanOrEqual(e0);
      expect(e1).toBeLessThan(e0 * 1.01);
      expect(later.captainCount + later.fleetTotal + later.pcCount).toBe(s.captainCount + s.fleetTotal + s.pcCount);
    });

    it("every milestone up to the target is recorded, and pops up exactly once", () => {
      const fresh = newlyReached(before, s);
      expect(fresh).toContain("long");
      if (target === STARFALL_EXPONENT) expect(fresh).toContain("starfall");
      else expect(fresh).not.toContain("starfall");
      expect(newlyReached(s, liveFor(s, 60))).toEqual([]);
      const ids = MILESTONES.map((m) => m.id).filter((id) => s.milestones[id] !== undefined);
      expect(ids.length).toBe(target === STARFALL_EXPONENT ? MILESTONES.length : MILESTONES.length - 1);
    });

    it("upgrades: none at e1,000,000 (the horse joke still to come), all at their cap at e10,000,000", () => {
      for (const u of UPGRADES) expect(upgradeLevel(s, u.id)).toBe(target === STARFALL_EXPONENT ? u.cap : 0);
      expect(s.upgradesNoteSeen).toBe(false);
    });
  });
}

describe("jumps never move dates already earned", () => {
  it("an earlier milestone date stays", () => {
    const s = devMarkFound(freshSecretState(NOW), NOW);
    s.milestones.googol = 123;
    expect(devJumpTo(s, LONG_EXPONENT, NOW).milestones.googol).toBe(123);
  });
});
