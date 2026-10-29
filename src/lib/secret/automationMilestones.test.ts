// automationMilestones.test.ts: 0.14.0 prestige redesign Slice 3 (plan docs/plans/2026-10-27-minigame-
// prestige-redesign-plan.md, with the plan update of 2026-10-28). Every automation unlocks at its
// milestone (config AUTOMATION_UNLOCKS), never for Skill Points; the popup names it; offline catch-up
// grants and fires exactly as live; a save that owns an automation as a 0.13.11.2 skill keeps it, switched
// as it was; every automation that buys honors its buy amount; Auto-buy Upgrades and Auto Skill
// Allocation buy the cheapest level first (QoL only, never optimal play).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { freshSecretState, cloneSecret, serializeSecret, deserializeSecret, type SecretState } from "./state";
import {
  checkMilestonesMut,
  automationUnlocked,
  autoActive,
  hasSkill,
  canBuySkillLevel,
  skillLevel,
  skillLevelCost,
  skillAvailable,
  automationBuyAmount,
  setAutomationBuy,
  stepMut,
  step,
  milestoneVisible,
  automationRevealed,
  pickSkillOffer,
  skillOffers,
  upgradePriceExponent,
  canBuyUpgrade,
  buyUpgrade,
  pow10,
  unsoftenExponent,
  fleetBarExponent,
  effectiveExponent,
} from "./engine";
import { advanceTo } from "./catchUp";
import { live } from "./testStates";
import {
  AUTOMATION_IDS,
  AUTOMATION_NAMES,
  AUTOMATION_UNLOCKS,
  AUTOMATION_BUY_DEFAULT,
  AUTO_TARGET_DEFAULT,
  AUTO_SKILLS_PC_COUNT,
  MILESTONES,
  SKILLS,
  UPGRADES,
  LEVELED_SKILLS,
  milestoneAchievement,
  milestoneRewardLine,
  automationUnlockedBy,
  automationListLine,
  MYSTERY_REWARD_LINE,
  isAutomationId,
  type AutomationId,
  type UpgradeId,
} from "./config";

const T0 = 1_000_000;

describe("each automation unlocks at its milestone", () => {
  it("recording the mapped milestone grants exactly that automation: on, target 100%, default buy amount", () => {
    for (const id of AUTOMATION_IDS) {
      const s = freshSecretState(T0);
      expect(automationUnlocked(s, id), id).toBe(false);
      s.milestones[AUTOMATION_UNLOCKS[id]] = T0;
      checkMilestonesMut(s, T0);
      expect(s.automations, id).toEqual({ [id]: true });
      expect(autoActive(s, id), id).toBe(true);
      expect(s.autoTarget).toEqual({ captain: AUTO_TARGET_DEFAULT, fleet: AUTO_TARGET_DEFAULT, pc: AUTO_TARGET_DEFAULT });
      expect(AUTO_TARGET_DEFAULT).toBe(100);
      expect(automationBuyAmount(s, id), id).toBe(AUTOMATION_BUY_DEFAULT[id] ?? "max");
      // no switch, target or buy amount is written: the save stays as small as it was
      expect(s.autoOn, id).toEqual({});
      expect(s.automationBuy, id).toEqual({});
    }
  });

  it("the three new beats record at a second Fleet, e10,000 Ore and the AUTO_SKILLS_PC_COUNT-th Prestigeception", () => {
    const s = freshSecretState(T0);
    s.fleetTotal = 1;
    checkMilestonesMut(s, 1);
    expect(s.milestones.secondFleet).toBeUndefined();
    expect(automationUnlocked(s, "autoCaptain")).toBe(false);
    s.fleetTotal = 2;
    checkMilestonesMut(s, 2);
    expect(s.milestones.secondFleet).toBe(2);
    expect(automationUnlocked(s, "autoCaptain")).toBe(true);

    s.bestOre = pow10(9999.9);
    checkMilestonesMut(s, 3);
    expect(s.milestones.e10k).toBeUndefined();
    s.bestOre = pow10(10000);
    checkMilestonesMut(s, 4);
    expect(s.milestones.e10k).toBe(4);
    expect(automationUnlocked(s, "autoFleet")).toBe(true);

    s.pcCount = AUTO_SKILLS_PC_COUNT - 1;
    checkMilestonesMut(s, 5);
    expect(s.milestones.pcRegular).toBeUndefined();
    s.pcCount = AUTO_SKILLS_PC_COUNT;
    checkMilestonesMut(s, 6);
    expect(s.milestones.pcRegular).toBe(6);
    expect(automationUnlocked(s, "autoSkills")).toBe(true);
  });

  it("the new beats show once their system is in view; e10,000 sits in the Ore chain between e1,000 and e100,000", () => {
    const s = freshSecretState(T0);
    for (const id of ["secondFleet", "e10k", "pcRegular", "e100k"] as const) expect(milestoneVisible(s, id), id).toBe(false);
    s.fleetTotal = 1;
    expect(milestoneVisible(s, "secondFleet")).toBe(true);
    s.milestones.e1000 = 1;
    expect(milestoneVisible(s, "e10k")).toBe(true);
    expect(milestoneVisible(s, "e100k")).toBe(false);
    s.milestones.e10k = 2;
    expect(milestoneVisible(s, "e100k")).toBe(true);
    expect(milestoneVisible(s, "pcRegular")).toBe(false);
    s.pcCount = 1;
    expect(milestoneVisible(s, "pcRegular")).toBe(true);
  });

  it("the popup's reward line names the automation (one per milestone); other rewards are unchanged", () => {
    for (const id of AUTOMATION_IDS) {
      const m = AUTOMATION_UNLOCKS[id];
      expect(automationUnlockedBy(m)).toBe(id);
      // (the secret one, Auto Prestigeception, gives the Mystery popup's line: tested below)
      expect(milestoneAchievement(m).reward, id).toBe(id === "autoPc" ? MYSTERY_REWARD_LINE : `Reward: ${AUTOMATION_NAMES[id]} unlocked. Find it on the Automation tab.`);
      expect(milestoneRewardLine(m)).toBe(milestoneAchievement(m).reward);
    }
    expect(milestoneAchievement("firstFleet").reward).toBe("Reward: Auto Overclock unlocked. Find it on the Automation tab.");
    expect(milestoneAchievement("e100k").reward).toBe("Reward: recorded for a future update");
    expect(milestoneAchievement("starfall").reward).toBe(MILESTONES.find((m) => m.id === "starfall")!.reward);
  });

  it("a real Fleet Prestige grants Auto Overclock in the same step (the prestige records the milestone)", () => {
    const s = freshSecretState(T0);
    s.fleetPeak = pow10(400);
    s.pcPeak = s.fleetPeak;
    s.bestOre = s.fleetPeak;
    s.automations.autoFleet = true;
    const t = step(s, 1, T0 + 1000);
    expect(t.fleetTotal).toBe(1);
    expect(t.milestones.firstFleet).toBe(T0 + 1000);
    expect(automationUnlocked(t, "autoOverclock")).toBe(true);
  });
});

describe("no Skill Point is ever spent on an automation", () => {
  it("Skill Points buy only leveled skills: none is an automation, and no offer ever is, however many points", () => {
    const s = freshSecretState(T0);
    s.skillPoints = 99;
    for (const id of AUTOMATION_IDS) s.milestones[AUTOMATION_UNLOCKS[id]] = T0;
    for (const d of LEVELED_SKILLS) expect(isAutomationId(d.id), d.id).toBe(false);
    for (const o of skillOffers(s)) expect(isAutomationId(o.id), o.id).toBe(false);
    for (const d of SKILLS) if (isAutomationId(d.id)) expect(automationUnlocked(s, d.id), d.id).toBe(false);
    expect(s.skillPoints).toBe(99);
  });
});

describe("offline catch-up grants and fires exactly as live", () => {
  // Auto Fleet already unlocked, Auto Captain not: the second Fleet Prestige grants Auto Captain, which
  // then starts firing (measured: granted at 4,386 s, first Captain Prestige at 4,677 s).
  const start = (): SecretState => {
    const s = freshSecretState(T0);
    for (const id of ["autoOverclock", "autoBuyLow", "autoFleet"] as const) s.automations[id] = true;
    return s;
  };

  it("inside the exact window: the same state, byte for byte, granted and fired at the same step", () => {
    const s0 = start();
    const gap = 2 * 3600;
    const l = live(s0, gap);
    const c = advanceTo(s0, T0 + gap * 1000);
    expect(c.mode).toBe("exact");
    expect(serializeSecret(c.state)).toBe(serializeSecret(l));
    expect(automationUnlocked(l, "autoCaptain")).toBe(true);
    expect(l.milestones.secondFleet).toBeDefined();
    // it fired after it was granted, and never before
    expect(l.milestones.firstCaptain!).toBeGreaterThan(l.milestones.secondFleet!);
    expect(l.captainCount).toBeGreaterThan(0);
  }, 120000);

  it("through a coarse catch-up: granted at its milestone's step and firing from then on", () => {
    const s0 = start();
    const c = advanceTo(s0, T0 + 2 * 86400 * 1000).state;
    expect(automationUnlocked(c, "autoCaptain")).toBe(true);
    expect(c.milestones.firstCaptain!).toBeGreaterThan(c.milestones.secondFleet!);
    expect(c.captainCount).toBeGreaterThan(0);
    for (const id of AUTOMATION_IDS) {
      if (c.milestones[AUTOMATION_UNLOCKS[id]] !== undefined) expect(automationUnlocked(c, id), id).toBe(true);
    }
  }, 120000);
});

describe("a granted automation fires as the 0.13.11.2 skill did", () => {
  it("an hour with the automations granted equals an hour with them owned as skills", () => {
    const ids = ["autoOverclock", "autoBuyLow", "autoCaptain", "autoFleet"] as const;
    const granted = freshSecretState(T0);
    const owned = freshSecretState(T0);
    for (const id of ids) {
      granted.automations[id] = true;
      owned.skills[id] = true;
    }
    const strip = (x: SecretState) => {
      const o = JSON.parse(serializeSecret(x)) as Record<string, unknown>;
      delete o.skills;
      delete o.automations;
      return JSON.stringify(o);
    };
    expect(strip(live(granted, 3600))).toBe(strip(live(owned, 3600)));
  }, 120000);
});

describe("existing saves keep what they own (the full conversion is Slice 6)", () => {
  it("an automation owned as a skill stays owned and switched off through its milestone and a save round trip", () => {
    const s = freshSecretState(T0);
    s.skills.autoCaptain = true;
    s.autoOn.autoCaptain = false;
    expect(hasSkill(s, "autoCaptain")).toBe(true);
    expect(autoActive(s, "autoCaptain")).toBe(false);
    s.fleetTotal = 2;
    checkMilestonesMut(s, T0);
    expect(s.automations.autoCaptain).toBe(true);
    expect(autoActive(s, "autoCaptain")).toBe(false);
    const back = deserializeSecret(serializeSecret(s), T0)!;
    expect(back.skills.autoCaptain).toBe(true);
    expect(back.autoOn.autoCaptain).toBe(false);
    expect(autoActive(back, "autoCaptain")).toBe(false);
  });

  it("an automation owned as a skill before its milestone stays usable", () => {
    const s = freshSecretState(T0);
    s.skills.autoFleet = true;
    expect(s.milestones.e10k).toBeUndefined();
    expect(automationUnlocked(s, "autoFleet")).toBe(true);
    expect(autoActive(s, "autoFleet")).toBe(true);
  });

  it("a save that recorded a milestone before 0.14.0 gets its automation at its next step", () => {
    const s = freshSecretState(T0);
    s.milestones.firstFleet = 5;
    s.fleetTotal = 1;
    const t = step(s, 1, T0 + 1000);
    expect(automationUnlocked(t, "autoOverclock")).toBe(true);
    expect(t.milestones.firstFleet).toBe(5);
  });
});

// A state with best and current Ore at effective exponent e (the e1,000,000 upgrades awake up to it).
function atEffective(e: number): SecretState {
  const s = freshSecretState(T0);
  s.ore = pow10(unsoftenExponent(e));
  s.bestOre = s.ore;
  s.runPeak = s.ore;
  s.fleetPeak = s.ore;
  s.pcPeak = s.ore;
  s.overclock = 5000;
  s.skills.overdrive = true;
  // keep every other automation out of the way (their milestones record on the first step)
  for (const id of AUTOMATION_IDS) s.autoOn[id] = false;
  return s;
}

// The reference: one level at a time, the cheapest next level first (the sim player's rule).
function cheapestFirst(s: SecretState, n: number): SecretState {
  let x = s;
  for (let i = 0; i < n; i++) {
    let best: UpgradeId | null = null;
    let bestE = Infinity;
    for (const u of UPGRADES) {
      const e = upgradePriceExponent(x, u.id);
      if (e !== null && e < bestE && canBuyUpgrade(x, u.id)) {
        best = u.id;
        bestE = e;
      }
    }
    if (best === null) break;
    x = buyUpgrade(x, best, "one");
  }
  return x;
}

const levels = (s: SecretState) => UPGRADES.reduce((n, u) => n + s.upgrades[u.id], 0);

describe("Auto-buy Upgrades: cheapest level first, its buy amount per step", () => {
  it("buys 1 (default), 10 or every affordable level per step, cheapest first; off or locked buys nothing", () => {
    const base = atEffective(2.5e6);
    base.automations.autoUpgrades = true;
    base.autoOn.autoUpgrades = true;
    expect(automationBuyAmount(base, "autoUpgrades")).toBe("1");
    const one = step(base, 1, T0 + 1000);
    expect(levels(one)).toBe(1);
    expect(one.upgrades).toEqual(cheapestFirst(base, 1).upgrades);
    const ten = step(setAutomationBuy(base, "autoUpgrades", "10"), 1, T0 + 1000);
    expect(levels(ten)).toBe(10);
    expect(ten.upgrades).toEqual(cheapestFirst(base, 10).upgrades);
    const max = step(setAutomationBuy(base, "autoUpgrades", "max"), 1, T0 + 1000);
    expect(levels(max)).toBeGreaterThan(10);
    expect(max.upgrades).toEqual(cheapestFirst(base, 10000).upgrades);
    const off = cloneSecret(base);
    off.autoOn.autoUpgrades = false;
    expect(levels(step(off, 1, T0 + 1000))).toBe(0);
    const locked = atEffective(2.5e6);
    expect(levels(step(locked, 1, T0 + 1000))).toBe(0);
  });

  it("a catch-up step of n seconds buys at the live rate: n levels at Buy 1, 10 n at Buy 10", () => {
    const base = atEffective(2.5e6);
    base.automations.autoUpgrades = true;
    base.autoOn.autoUpgrades = true;
    const one = cloneSecret(base);
    stepMut(one, 7, T0 + 7000);
    expect(levels(one)).toBe(7);
    expect(one.upgrades).toEqual(cheapestFirst(base, 7).upgrades);
    const ten = setAutomationBuy(base, "autoUpgrades", "10");
    stepMut(ten, 2, T0 + 2000);
    expect(levels(ten)).toBe(20);
    expect(ten.upgrades).toEqual(cheapestFirst(base, 20).upgrades);
  });
});

describe("Auto Skill Allocation: cheapest level first, round-robin on ties", () => {
  it("spends Skill Points on the cheapest open skill level each step (1 by default), round-robin, never a gated one", () => {
    const s = freshSecretState(T0);
    s.skillPoints = 12;
    s.automations.autoSkills = true;
    // Head Start and Tenfold Training open; the rest stay gated
    s.milestones.firstFleet = T0;
    s.milestones.e1000 = T0;
    for (const id of AUTOMATION_IDS) if (id !== "autoSkills") s.autoOn[id] = false;
    const open = LEVELED_SKILLS.filter((d) => skillAvailable(s, d.id)).map((d) => d.id);
    expect(open).toEqual(["headStart", "tenfoldTraining"]);
    // the reference rule: the cheapest next level, ties to fewer levels, then list order
    const expected = (x: SecretState) => {
      let best: (typeof LEVELED_SKILLS)[number] | null = null;
      for (const d of LEVELED_SKILLS) {
        const cost = skillLevelCost(x, d.id);
        if (cost === null || !canBuySkillLevel(x, d.id)) continue;
        if (best === null || cost < skillLevelCost(x, best.id)! || (cost === skillLevelCost(x, best.id)! && skillLevel(x, d.id) < skillLevel(x, best.id))) best = d;
      }
      return best;
    };
    let x = s;
    let steps = 0;
    for (let want = expected(x); want !== null; want = expected(x)) {
      const before = skillLevel(x, want.id);
      const cost = skillLevelCost(x, want.id)!;
      const points = x.skillPoints;
      x = step(x, 1, T0 + 1000 * ++steps);
      expect(skillLevel(x, want.id), want.id).toBe(before + 1);
      expect(x.skillPoints).toBe(points - cost);
    }
    expect(steps).toBeGreaterThanOrEqual(3);
    expect(skillOffers(x)).toEqual([]);
    for (const d of LEVELED_SKILLS) if (!open.includes(d.id)) expect(skillLevel(x, d.id), d.id).toBe(0);
    expect(skillLevel(x, "headStart")).toBeGreaterThan(0);
    expect(skillLevel(x, "tenfoldTraining")).toBeGreaterThan(0);
    const all = step(setAutomationBuy(s, "autoSkills", "max"), 1, T0 + 1000);
    expect(all.skillLevels).toEqual(x.skillLevels);
    expect(all.skillPoints).toBe(x.skillPoints);
    const off = cloneSecret(s);
    off.autoOn.autoSkills = false;
    expect(step(off, 1, T0 + 1000).skillPoints).toBe(12);
  });

  it("a tie in cost goes to the skill with fewer levels, then list order", () => {
    const offers = [
      { id: "overdrive", level: 1, cost: 2 },
      { id: "headStart", level: 0, cost: 2 },
      { id: "tenfoldTraining", level: 0, cost: 2 },
      { id: "captainsAcademy", level: 0, cost: 3 },
    ] as const;
    expect(pickSkillOffer(offers)).toEqual(offers[1]);
    expect(pickSkillOffer([])).toBeNull();
  });
});

describe("every automation that buys honors its buy amount", () => {
  const run = (): SecretState => {
    const s = freshSecretState(T0);
    s.ore = pow10(50);
    s.runPeak = s.ore;
    s.fleetPeak = s.ore;
    s.pcPeak = s.ore;
    s.bestOre = s.ore;
    s.bought[0] = 25;
    s.owned[0] = new Decimal(25);
    s.overclock = 40;
    s.lastIncome = pow10(45);
    return s;
  };

  it("Auto Overclock buys 1, 10 or as many levels as it can afford per step (max, the default)", () => {
    const s = run();
    s.automations.autoOverclock = true;
    expect(automationBuyAmount(s, "autoOverclock")).toBe("max");
    expect(step(setAutomationBuy(s, "autoOverclock", "1"), 1, T0).overclock).toBe(41);
    expect(step(setAutomationBuy(s, "autoOverclock", "10"), 1, T0).overclock).toBe(50);
    expect(step(s, 1, T0).overclock).toBeGreaterThan(50);
  });

  it("Auto-buy I to IV buys 1 unit, to the next ten, or Max per tier per step", () => {
    const s = run();
    s.automations.autoBuyLow = true;
    const one = step(setAutomationBuy(s, "autoBuyLow", "1"), 1, T0);
    expect(one.bought.slice(0, 4)).toEqual([26, 1, 1, 1]);
    const ten = step(setAutomationBuy(s, "autoBuyLow", "10"), 1, T0);
    expect(ten.bought.slice(0, 4)).toEqual([30, 10, 10, 10]);
    const max = step(s, 1, T0);
    for (let k = 0; k < 4; k++) expect(max.bought[k]).toBeGreaterThan(ten.bought[k]);
  });

  it("only the automations that buy have the setting; a bad amount changes nothing", () => {
    const s = freshSecretState(T0);
    expect(setAutomationBuy(s, "autoCaptain", "1")).toBe(s);
    expect(setAutomationBuy(s, "autoUpgrades", "7" as never)).toBe(s);
    const t = setAutomationBuy(s, "autoBuyHigh", "10");
    expect(automationBuyAmount(t, "autoBuyHigh")).toBe("10");
    expect(deserializeSecret(serializeSecret(t), T0)!.automationBuy).toEqual({ autoBuyHigh: "10" });
  });
});

describe("Review Focus 2 with a granted automation: Auto Fleet never fires below the risen bar", () => {
  it("live and through a coarse catch-up", () => {
    const s = freshSecretState(T0);
    s.augmentPoints = new Decimal(500); // a risen bar
    const bar = fleetBarExponent(s);
    expect(bar).toBeGreaterThan(400);
    s.fleetPeak = pow10(bar - 1);
    s.runPeak = s.fleetPeak;
    s.bestOre = s.fleetPeak;
    s.automations.autoFleet = true;
    s.autoTarget.fleet = 10;
    for (const id of AUTOMATION_IDS) if (id !== "autoFleet") s.autoOn[id as AutomationId] = false;
    expect(effectiveExponent(s.fleetPeak)).toBeLessThan(bar);
    expect(live(s, 600).fleetTotal).toBe(0);
    expect(advanceTo(s, T0 + 86400 * 1000).state.fleetTotal).toBe(0);
  }, 120000);
});

describe("the Mystery popup (user 2026-10-28): Auto Prestigeception at A Respectable Googol stays a secret", () => {
  it("the popup reads the user's line and names no automation", () => {
    expect(AUTOMATION_UNLOCKS.autoPc).toBe("googol");
    expect(MYSTERY_REWARD_LINE).toBe("Reward: a new automation, for later. You'll know it when you see it.");
    expect(milestoneAchievement("googol").reward).toBe(MYSTERY_REWARD_LINE);
    expect(milestoneRewardLine("googol")).toBe(MYSTERY_REWARD_LINE);
  });

  it("every view shows it as ??? until the first Prestigeception, and it works all the while", () => {
    const s = freshSecretState(T0);
    s.milestones.googol = T0;
    checkMilestonesMut(s, T0);
    expect(automationUnlocked(s, "autoPc")).toBe(true);
    expect(autoActive(s, "autoPc")).toBe(true);
    expect(automationRevealed(s, "autoPc")).toBe(false);
    for (const reached of [true, false]) {
      const line = automationListLine("autoPc", reached, automationRevealed(s, "autoPc"));
      expect(line).not.toContain("Prestigeception");
      expect(line).not.toContain(AUTOMATION_NAMES.autoPc);
    }
    for (const id of AUTOMATION_IDS) if (id !== "autoPc") expect(automationRevealed(s, id), id).toBe(true);
    s.milestones.firstPc = T0 + 1;
    expect(automationRevealed(s, "autoPc")).toBe(true);
    expect(automationListLine("autoPc", true, automationRevealed(s, "autoPc"))).toBe("Auto Prestigeception unlocked");
  });

  it("the overlay asks the engine before naming it (Skills rows, the Prestige tab, the Milestones list)", () => {
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).toContain("{#if !automationRevealed(s, id)}");
    expect(ov).toContain("automationRevealed(x, l.skill)");
    expect(ov).toContain("automationListLine(auto, reached, automationRevealed(x, auto))");
  });
});
