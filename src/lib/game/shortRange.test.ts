// G1-2 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-2): the pure engine.
// The catalog and its sheets, the fixed draw layout, the roll contract (never above the sheet, 10,000 seeds per tier),
// the training run and the slow-start curve, the cycle plan's mission folds, the sheet check and the reward band.

import { describe, expect, it } from "vitest";
import { makeRng, type Rng } from "./combat/rng";
import {
  FULL_HOLD_FRACTION,
  effectiveMissionDef,
  freshRunCounts,
  shipDerivedStats,
  type GameState,
  type RunMissionDef,
  type RunDifficultyStamp,
  type ShipDerivedStats,
  type ShipTypeKey,
} from "./model";
import { resolveCrew } from "./crewOverlay";
import { deriveAwayTeam, shipDivisionStrength } from "./gambit";
import { N_FULL, RAMP_FLOOR, runDifficultyAt } from "./runDifficulty";
import { editShip, installPiece, shipOf, wiringBase } from "./wiring/probes";
import {
  SHORT_RANGE_BOARD_SALT,
  SHORT_RANGE_CATEGORIES,
  SHORT_RANGE_DEFAULT_SEED,
  SHORT_RANGE_DESTINATIONS,
  SHORT_RANGE_SHEETS,
  SHORT_RANGE_TEMPLATES,
  SHORT_RANGE_TEMPLATE_KEYS,
  SHORT_RANGE_DRAW_V1_KEYS,
  drawShortRangeJob,
  drawShortRangeTemplateJob,
  isTrainingRoll,
  meetsSheet,
  rollShortRangeJob,
  shortRangeBoardSeed,
  shortRangeCrewRating,
  shortRangeCyclePlan,
  shortRangeCycleReward,
  shortRangeDestinationLabel,
  shortRangePhenomenonLabel,
  shortRangeRollSeed,
  shortRangeRollUses,
  shortRangeShipRatings,
  shortRangeSpanShare,
  shortRangeTemplateUses,
  spanTop,
  type ShortRangeCategory,
  type ShortRangeRoll,
  type ShortRangeSpans,
  type ShortRangeTemplateKey,
  type ShortRangeTier,
} from "./shortRange";

const TIERS: readonly ShortRangeTier[] = [1, 2];
const SEEDS = 10_000;
const FULL = (tier: ShortRangeTier): RunDifficultyStamp => ({ version: 1, firstRun: false, ramp: 1, tier });
const TRAINING = (tier: ShortRangeTier): RunDifficultyStamp => ({ version: 1, firstRun: true, ramp: 0, tier });

// A stream that counts every call and can force the first draw (the template).
function countingRng(seed: number, forceTemplate?: number): Rng & { calls: number } {
  const inner = makeRng(seed);
  let first = true;
  const rng = {
    calls: 0,
    next(): number {
      rng.calls += 1;
      return inner.next();
    },
    nextInt(n: number): number {
      rng.calls += 1;
      const v = inner.nextInt(n);
      if (first) {
        first = false;
        if (forceTemplate !== undefined) return forceTemplate;
      }
      return v;
    },
    nextRange(lo: number, hi: number): number {
      rng.calls += 1;
      return inner.nextRange(lo, hi);
    },
    chance(a: number, b: number): boolean {
      rng.calls += 1;
      return inner.chance(a, b);
    },
  };
  return rng;
}

const SIZE_CATEGORY: Readonly<Record<keyof Omit<ShortRangeSpans, "distanceLy">, ShortRangeCategory>> = {
  guests: "guests",
  units: "cargo",
  scan: "sensors",
  engineering: "engineering",
  security: "security",
};

// A bare reference ship that just meets `tier`'s sheet (speed 1, no crew folds).
function referenceStats(tier: ShortRangeTier): ShipDerivedStats {
  const sheet = SHORT_RANGE_SHEETS[tier];
  return { ...shipDerivedStats({ id: "ref", typeKey: "generalFreighter", assignedCaptainId: null }), cargoCapacity: sheet.cargo, sensors: sheet.sensors, colonistCapacity: sheet.guests };
}

// E5-2: an Evacuation is drawn the overlay's way (one draw, then the job with the template fixed), so it reads the same
// stream positions as the seven.
function rollOf(template: ShortRangeTemplateKey, tier: ShortRangeTier, seed: number, stamp: RunDifficultyStamp = FULL(tier)): ShortRangeRoll {
  if (template === "evacuation") {
    const rng = countingRng(seed);
    rng.nextInt(8);
    return drawShortRangeTemplateJob(rng, "evacuation", seed, { id: 1, tier }, 0, () => stamp);
  }
  return drawShortRangeJob(countingRng(seed, SHORT_RANGE_DRAW_V1_KEYS.indexOf(template)), seed, { id: 1, tier }, 0, () => stamp);
}

// A ship-1 of `hull` with its passive complement delivered for `hours` (a normally crewed ship).
function crewed(hull: ShipTypeKey, hours = 6): GameState {
  const s = editShip(wiringBase(), { typeKey: hull });
  return resolveCrew({ ...s, gameTimeSeconds: hours * 3600 });
}

describe("G1-2 catalog and sheets", () => {
  it("seven templates in the frozen draw order, the plan's labels plus Prisoner Transport, then E5-2's Evacuation", () => {
    expect(SHORT_RANGE_DRAW_V1_KEYS).toEqual(["refugeeRelocation", "supplyDropOff", "supplyPickup", "phenomenonSurvey", "telescopeRepair", "commBoosterBuild", "prisonerTransport"]);
    expect(SHORT_RANGE_TEMPLATE_KEYS).toEqual([...SHORT_RANGE_DRAW_V1_KEYS, "evacuation"]);
    expect(SHORT_RANGE_TEMPLATE_KEYS.map((k) => SHORT_RANGE_TEMPLATES[k].label)).toEqual([
      "Refugee Relocation",
      "Supply Drop-off",
      "Supply Pickup",
      "Phenomenon Survey",
      "Telescope Repair",
      "Comm Booster Build",
      "Prisoner Transport",
      "Evacuation",
    ]);
    for (const k of SHORT_RANGE_TEMPLATE_KEYS) expect(SHORT_RANGE_TEMPLATES[k].key).toBe(k);
  });

  it("each template uses the categories the plan gives it; Prisoner Transport reads guest quarters and Security", () => {
    expect(Object.fromEntries(SHORT_RANGE_TEMPLATE_KEYS.map((k) => [k, shortRangeTemplateUses(k)]))).toEqual({
      refugeeRelocation: ["range", "guests"],
      supplyDropOff: ["range", "cargo"],
      supplyPickup: ["range", "cargo"],
      phenomenonSurvey: ["range", "sensors"],
      telescopeRepair: ["range", "cargo", "engineering"],
      commBoosterBuild: ["range", "cargo", "engineering"],
      evacuation: ["range", "guests"],
      prisonerTransport: ["range", "guests", "security"],
    });
  });

  it("one sheet per tier covering all six categories, at or above every span its templates can roll", () => {
    expect(SHORT_RANGE_CATEGORIES).toEqual(["range", "cargo", "guests", "sensors", "engineering", "security"]);
    for (const tier of TIERS) {
      const sheet = SHORT_RANGE_SHEETS[tier];
      expect(Object.keys(sheet).sort()).toEqual([...SHORT_RANGE_CATEGORIES].sort());
      const most: Record<ShortRangeCategory, number> = { range: 0, cargo: 0, guests: 0, sensors: 0, engineering: 0, security: 0 };
      for (const k of SHORT_RANGE_TEMPLATE_KEYS) {
        const spans = SHORT_RANGE_TEMPLATES[k].rolls[tier];
        most.range = Math.max(most.range, spans.distanceLy[1] * 2);
        for (const [size, cat] of Object.entries(SIZE_CATEGORY) as [keyof typeof SIZE_CATEGORY, ShortRangeCategory][]) {
          const span = spans[size];
          if (span) most[cat] = Math.max(most[cat], span[1]);
        }
        for (const span of Object.values(spans)) expect(span[0]).toBeLessThanOrEqual(span[1]);
      }
      // Exactly the largest roll: no category asks more than some job can use.
      expect(most).toEqual(sheet);
    }
  });

  it("Tier II asks at least as much as Tier I in every category, and Security stays small at Tier I", () => {
    for (const c of SHORT_RANGE_CATEGORIES) expect(SHORT_RANGE_SHEETS[2][c]).toBeGreaterThanOrEqual(SHORT_RANGE_SHEETS[1][c]);
    expect(SHORT_RANGE_SHEETS[1].security).toBeLessThanOrEqual(1);
  });
});

describe("G1-2 the roll: fixed draw layout and determinism", () => {
  it("every roll makes exactly six draws, whatever the template and tier", () => {
    for (const tier of TIERS) {
      SHORT_RANGE_DRAW_V1_KEYS.forEach((k, i) => {
        for (const stamp of [FULL(tier), TRAINING(tier)]) {
          const rng = countingRng(1234 + i, i);
          const roll = drawShortRangeJob(rng, 0, { id: 1, tier }, 0, () => stamp);
          expect(roll.template).toBe(k);
          expect(rng.calls, `${k} tier ${tier}`).toBe(6);
        }
      });
      // E5-2: the Evacuation overlay's stream: its one draw, then the job's five.
      for (const stamp of [FULL(tier), TRAINING(tier)]) {
        const rng = countingRng(99);
        rng.nextInt(8);
        expect(drawShortRangeTemplateJob(rng, "evacuation", 0, { id: 1, tier }, 0, () => stamp).template).toBe("evacuation");
        expect(rng.calls, `evacuation tier ${tier}`).toBe(6);
      }
    }
  });

  it("a template change never shifts a later draw: the distance and flavor read the same stream position", () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 200; seed++) {
        const rolls = SHORT_RANGE_TEMPLATE_KEYS.map((k) => rollOf(k, tier, seed));
        expect(new Set(rolls.map((r) => r.distanceLy)).size, `seed ${seed}`).toBe(1);
        expect(new Set(rolls.map((r) => r.flavorIndex)).size, `seed ${seed}`).toBe(1);
      }
    }
  });

  it("same seed, same roll; the board seed, slot and cycle each change the stream", () => {
    const state = wiringBase();
    const a = rollShortRangeJob(state, { id: 2, tier: 1 }, 5);
    expect(rollShortRangeJob(state, { id: 2, tier: 1 }, 5)).toEqual(a);
    expect(a.seed).toBe(shortRangeRollSeed(shortRangeBoardSeed(state), 2, 5));
    expect(a).toMatchObject({ version: 1, slotId: 2, cycleIndex: 5, tier: 1 });
    const seeds = new Set<number>();
    for (let slot = 0; slot < 8; slot++) for (let cycle = 0; cycle < 64; cycle++) seeds.add(shortRangeRollSeed(SHORT_RANGE_DEFAULT_SEED, slot, cycle));
    expect(seeds.size).toBe(8 * 64);
    const templates = new Set(Array.from({ length: 200 }, (_, c) => rollShortRangeJob(state, { id: 1, tier: 1 }, c).template));
    expect(templates.size).toBe(SHORT_RANGE_TEMPLATE_KEYS.length); // the whole job re-rolls (call 1)
  });

  it("the board seed is derived: the default without a stored homeworld, else the homeworld seed salted", () => {
    expect(shortRangeBoardSeed({})).toBe(SHORT_RANGE_DEFAULT_SEED);
    expect(shortRangeBoardSeed({ homeworld: { version: 1, seed: 12345 } })).toBe((12345 ^ SHORT_RANGE_BOARD_SALT) >>> 0);
    const base = wiringBase();
    const other = { ...base, homeworld: { version: 1 as const, seed: 777 } };
    expect(rollShortRangeJob(other, { id: 1, tier: 1 }, 0).seed).not.toBe(rollShortRangeJob(base, { id: 1, tier: 1 }, 0).seed);
  });

  it("destinations and phenomena are placeholder designations from the template's list", () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const k of SHORT_RANGE_TEMPLATE_KEYS) {
        const roll = rollOf(k, 1, seed);
        expect(SHORT_RANGE_DESTINATIONS[SHORT_RANGE_TEMPLATES[k].destinations]).toContain(shortRangeDestinationLabel(roll));
        const phenomenon = shortRangePhenomenonLabel(roll);
        if (k === "phenomenonSurvey") expect(typeof phenomenon).toBe("string");
        else expect(phenomenon).toBeNull();
      }
    }
  });
});

describe("G1-2 the contract: a roll never exceeds its slot's sheet (10,000 seeds per tier)", () => {
  for (const tier of TIERS) {
    it(`tier ${tier}, at full strength and at every curve position`, () => {
      const sheet = SHORT_RANGE_SHEETS[tier];
      for (let seed = 0; seed < SEEDS; seed++) {
        const ramp = (seed % 11) / 10; // 0 .. 1, plus full strength
        const stamp: RunDifficultyStamp = { version: 1, firstRun: seed % 97 === 0, ramp: Math.min(1, ramp), tier };
        const roll = drawShortRangeJob(makeRng(seed), seed, { id: 1, tier }, 0, () => stamp);
        const uses = shortRangeRollUses(roll);
        for (const [c, v] of Object.entries(uses) as [ShortRangeCategory, number][]) {
          expect(v, `${roll.template} ${c} seed ${seed}`).toBeLessThanOrEqual(sheet[c]);
          expect(Number.isInteger(v)).toBe(true);
        }
        // and every size inside its span
        const spans = SHORT_RANGE_TEMPLATES[roll.template].rolls[tier];
        expect(roll.distanceLy).toBeGreaterThanOrEqual(spans.distanceLy[0]);
        expect(roll.distanceLy).toBeLessThanOrEqual(spans.distanceLy[1]);
        for (const size of Object.keys(SIZE_CATEGORY) as (keyof typeof SIZE_CATEGORY)[]) {
          const span = spans[size];
          if (!span) expect(roll[size]).toBeUndefined();
          else {
            expect(roll[size]).toBeGreaterThanOrEqual(span[0]);
            expect(roll[size]).toBeLessThanOrEqual(span[1]);
          }
        }
      }
    });
  }

  it("the same holds through rollShortRangeJob on a save (any template, many slots and cycles)", () => {
    const state = wiringBase();
    for (const tier of TIERS) {
      for (let slot = 0; slot < 4; slot++) {
        for (let cycle = 0; cycle < 250; cycle++) {
          const roll = rollShortRangeJob(state, { id: slot, tier }, cycle);
          for (const [c, v] of Object.entries(shortRangeRollUses(roll)) as [ShortRangeCategory, number][]) expect(v).toBeLessThanOrEqual(SHORT_RANGE_SHEETS[tier][c]);
        }
      }
    }
  });
});

describe("G1-2 the training run and the slow-start curve", () => {
  it("a fresh save's first roll of every template is its training run: the smallest roll, flagged for the chip", () => {
    const state = wiringBase();
    for (const tier of TIERS) {
      const seen = new Set<string>();
      for (let cycle = 0; cycle < 200 && seen.size < SHORT_RANGE_TEMPLATE_KEYS.length; cycle++) {
        const roll = rollShortRangeJob(state, { id: 1, tier }, cycle);
        seen.add(roll.template);
        expect(isTrainingRoll(roll)).toBe(true);
        expect(roll.difficulty).toEqual({ version: 1, firstRun: true, ramp: 0, tier });
        const spans = SHORT_RANGE_TEMPLATES[roll.template].rolls[tier];
        expect(roll.distanceLy).toBe(spans.distanceLy[0]);
        for (const size of Object.keys(SIZE_CATEGORY) as (keyof typeof SIZE_CATEGORY)[]) {
          const span = spans[size];
          if (span) expect(roll[size]).toBe(span[0]);
        }
      }
      expect(seen.size).toBe(SHORT_RANGE_TEMPLATE_KEYS.length);
    }
  });

  it("once a template has been dispatched it is no longer a training run; its curve reads the completed runs", () => {
    const base = wiringBase();
    const counts = freshRunCounts();
    const state: GameState = { ...base, runCounts: { ...counts, shortRange: Object.fromEntries(SHORT_RANGE_TEMPLATE_KEYS.map((k) => [k, { dispatched: 1, completed: 0 }])) } };
    for (let cycle = 0; cycle < 50; cycle++) {
      const roll = rollShortRangeJob(state, { id: 1, tier: 1 }, cycle);
      expect(isTrainingRoll(roll)).toBe(false);
      expect(roll.difficulty.ramp).toBe(0); // run 2: the curve's floor
      const spans = SHORT_RANGE_TEMPLATES[roll.template].rolls[1];
      expect(roll.distanceLy).toBeLessThanOrEqual(spanTop(spans.distanceLy, RAMP_FLOOR));
    }
  });

  it("the share follows SF4: run 2 at 35%, run 6 about 54%, run 9 about 80%, full from run 12 (the SF-3 review's smoothed top, one shared curve); flat at Tier II", () => {
    const share = (completed: number, tier: ShortRangeTier): number => {
      const state: GameState = { ...wiringBase(), runCounts: { ...freshRunCounts(), shortRange: { refugeeRelocation: { dispatched: completed + 1, completed } } } };
      return shortRangeSpanShare(runDifficultyAt(state, "shortRange", tier, "refugeeRelocation"));
    };
    expect(share(0, 1)).toBeCloseTo(0.35, 6);
    expect(share(4, 1)).toBeCloseTo(0.54, 2);
    expect(share(7, 1)).toBeCloseTo(0.8, 1);
    expect(share(N_FULL - 1, 1)).toBe(1);
    let prev = -1;
    for (let c = 0; c <= 14; c++) {
      const s = share(c, 1);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
      expect(share(c, 2)).toBe(1);
    }
  });

  it("the highest roll a span can make grows monotonically with the share and never leaves the span", () => {
    for (const k of SHORT_RANGE_TEMPLATE_KEYS) {
      for (const tier of TIERS) {
        for (const span of Object.values(SHORT_RANGE_TEMPLATES[k].rolls[tier])) {
          let prev = span[0];
          for (let i = 0; i <= 20; i++) {
            const top = spanTop(span, i / 20);
            expect(top).toBeGreaterThanOrEqual(prev);
            expect(top).toBeLessThanOrEqual(span[1]);
            prev = top;
          }
          expect(spanTop(span, 0)).toBe(span[0]);
          expect(spanTop(span, 1)).toBe(span[1]);
        }
      }
    }
  });

  it("over many seeds the ramped rolls average smaller than full-strength ones (the curve acts)", () => {
    for (const tier of [1] as const) {
      let ramped = 0;
      let full = 0;
      for (let seed = 0; seed < 2000; seed++) {
        ramped += rollOf("supplyDropOff", tier, seed, { version: 1, firstRun: false, ramp: 0, tier }).units!;
        full += rollOf("supplyDropOff", tier, seed).units!;
      }
      expect(ramped).toBeLessThan(full);
    }
  });
});

describe("G1-2 the cycle plan applies the captain-mission folds", () => {
  const folded: ShipDerivedStats = {
    ...referenceStats(2),
    cargoCapacity: 120,
    transitSpeedMult: 1.3,
    transitOutLegMult: 1.15,
    transitBackLegMult: 1.25,
    unloadSpeedMult: 1.4,
    fullHoldUnloadIntegrity: 0.5,
  };
  const matchingDef = (leg: number, extracting: number): RunMissionDef => ({
    label: "matching",
    transitOutTicks: leg,
    transitBackTicks: leg,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: extracting,
    uncommonChance: 0,
    rareChance: 0,
    lootTable: { common: "commonOre", uncommon: "uncommonMaterial", rare: "rareMaterial" },
    primaryMaterial: "commonOre",
    tier: "I",
    fleetAdminXpPerTick: 1,
    creditsPerCycle: 0,
    unlockLevel: 1,
  });

  it("transit out and back (Fast Departure, Fast Return) and the home unload match effectiveMissionDef", () => {
    for (let seed = 0; seed < 300; seed++) {
      const roll = rollOf("supplyPickup", 2, seed);
      const plan = shortRangeCyclePlan(roll, folded, 0);
      const leg = roll.distanceLy * 2; // distance / LY_PER_TICK
      // A mission def whose orders + outbound + extracting equal the short-range ticks before the return.
      const def = effectiveMissionDef(matchingDef(leg, 1), { ...folded, cargoCapacity: plan.onSiteTicks - 1, unloadCargoCapacity: roll.units });
      expect(plan.transitOutTicks).toBe(def.transitOutTicks);
      expect(plan.transitBackTicks).toBe(def.transitBackTicks);
      const full = roll.units! / folded.cargoCapacity >= FULL_HOLD_FRACTION;
      expect(plan.unloadTicks).toBe(full ? def.fullHoldUnloadTicks : def.unloadTicks);
    }
  });

  it("the Flight Deck Constitution ramp on the return leg matches effectiveMissionDef", () => {
    const ramped: ShipDerivedStats = { ...folded, returnLegConstitution: 40 };
    let moved = 0;
    for (let seed = 0; seed < 300; seed++) {
      const roll = rollOf("telescopeRepair", 2, seed);
      const plan = shortRangeCyclePlan(roll, ramped, 5);
      const leg = roll.distanceLy * 2;
      const def = effectiveMissionDef(matchingDef(leg, 1), { ...ramped, cargoCapacity: plan.onSiteTicks - 1 });
      expect(plan.transitBackTicks).toBe(def.transitBackTicks);
      if (plan.transitBackTicks !== shortRangeCyclePlan(roll, folded, 5).transitBackTicks) moved += 1;
    }
    expect(moved).toBeGreaterThan(0); // the facet acts here
  });

  it("the crew unload bonus shortens on-site passengers and goods; Sensors shorten a scan; Engineering shortens a repair", () => {
    const base = referenceStats(1);
    const crew = { ...base, unloadSpeedMult: 2 };
    const refugee = rollOf("refugeeRelocation", 1, 3);
    const dropOff = rollOf("supplyDropOff", 1, 3);
    expect(shortRangeCyclePlan(refugee, crew, 0).onSiteTicks).toBeLessThan(shortRangeCyclePlan(refugee, base, 0).onSiteTicks);
    expect(shortRangeCyclePlan(dropOff, crew, 0).onSiteTicks).toBeLessThan(shortRangeCyclePlan(dropOff, base, 0).onSiteTicks);
    const survey = rollOf("phenomenonSurvey", 1, 3);
    let prev = Infinity;
    for (const sensors of [0, 10, 20, 40, 80, 160]) {
      const t = shortRangeCyclePlan(survey, { ...base, sensors }, 0).onSiteTicks;
      expect(t).toBeLessThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(1);
      prev = t;
    }
    expect(shortRangeCyclePlan(survey, { ...base, sensors: 40 }, 0).onSiteTicks).toBeLessThan(shortRangeCyclePlan(survey, { ...base, sensors: 0 }, 0).onSiteTicks);
    const repair = rollOf("commBoosterBuild", 1, 3);
    expect(shortRangeCyclePlan(repair, base, 6).onSiteTicks).toBeLessThan(shortRangeCyclePlan(repair, base, 2).onSiteTicks);
    expect(shortRangeCyclePlan(repair, base, 1e6).onSiteTicks).toBeGreaterThanOrEqual(1);
  });

  it("the phases sum to the total; distance sets the transit", () => {
    const stats = referenceStats(1);
    for (let seed = 0; seed < 200; seed++) {
      for (const k of SHORT_RANGE_TEMPLATE_KEYS) {
        const roll = rollOf(k, 1, seed);
        const p = shortRangeCyclePlan(roll, stats, 3);
        expect(p.totalTicks).toBe(p.transitOutTicks + p.onSiteTicks + p.transitBackTicks + p.unloadTicks);
        expect(p.transitOutTicks).toBe(roll.distanceLy * 2);
        for (const v of [p.transitOutTicks, p.onSiteTicks, p.transitBackTicks, p.unloadTicks]) expect(Number.isInteger(v) && v >= 1).toBe(true);
      }
    }
  });

  it("the training run reads the tutorial hook: normal length at scale 1, the hook acts when set", () => {
    const stats = referenceStats(1);
    const training = rollOf("refugeeRelocation", 1, 9, TRAINING(1));
    const plain = { ...training, difficulty: FULL(1) };
    expect(shortRangeCyclePlan(training, stats, 0)).toEqual(shortRangeCyclePlan(plain, stats, 0));
    expect(shortRangeCyclePlan(training, stats, 0, 2).transitOutTicks).toBe(2 * shortRangeCyclePlan(plain, stats, 0).transitOutTicks);
    expect(shortRangeCyclePlan(plain, stats, 0, 2)).toEqual(shortRangeCyclePlan(plain, stats, 0)); // only the training run reads it
  });
});

describe("G1-2 the sheet check", () => {
  it("the crew rating is concave and unbounded (D23), 0 with no crew", () => {
    expect(shortRangeCrewRating(0)).toBe(0);
    expect(shortRangeCrewRating(-3)).toBe(0);
    // Each equal step of strength adds less than the one before (concave), yet always adds something.
    let prevGain = Infinity;
    for (let s = 4; s <= 400; s += 4) {
      const gain = shortRangeCrewRating(s) - shortRangeCrewRating(s - 4);
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThan(prevGain);
      prevGain = gain;
    }
    expect(shortRangeCrewRating(1e9)).toBeGreaterThan(40);
  });

  it("Security and Engineering read the ship's division strength; Security matches the away team's own strength", () => {
    const state = crewed("eir");
    const ship = shipOf(state);
    expect(shipDivisionStrength(state, ship, "security")).toBe(deriveAwayTeam(state, ship).securityStrength);
    expect(shipDivisionStrength(state, ship, "engineering")).toBeGreaterThan(0);
    const r = shortRangeShipRatings(state, ship, 1);
    expect(r.security).toBe(shortRangeCrewRating(shipDivisionStrength(state, ship, "security")));
    expect(r.engineering).toBe(shortRangeCrewRating(shipDivisionStrength(state, ship, "engineering")));
  });

  it("a normally crewed General Freighter meets Tier I's Engineering and Security (small at Tier I)", () => {
    const state = crewed("generalFreighter");
    const r = shortRangeShipRatings(state, shipOf(state), 1);
    expect(r.engineering).toBeGreaterThanOrEqual(SHORT_RANGE_SHEETS[1].engineering);
    expect(r.security).toBeGreaterThanOrEqual(SHORT_RANGE_SHEETS[1].security);
    expect(r.range).toBeGreaterThanOrEqual(SHORT_RANGE_SHEETS[1].range);
  });

  it("names every short category, in order; a crewed Eir with a sensor array meets Tier I", () => {
    const bare = wiringBase();
    expect(meetsSheet(bare, shipOf(bare), 1)).toEqual({ ok: false, short: ["guests", "sensors", "engineering", "security"] });
    const eir = crewed("eir");
    expect(meetsSheet(eir, shipOf(eir), 1)).toEqual({ ok: false, short: ["sensors"] });
    const sensed = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
    expect(meetsSheet(sensed, shipOf(sensed), 1)).toEqual({ ok: true, short: [] });
    expect(meetsSheet(sensed, shipOf(sensed), 2).short).toContain("guests");
  });

  it("Range goes through the captain-mission reach gate: a freighter reaches Tier I, not Tier II", () => {
    const state = crewed("generalFreighter");
    expect(meetsSheet(state, shipOf(state), 1).short).not.toContain("range");
    expect(meetsSheet(state, shipOf(state), 2).short).toContain("range");
  });
});

describe("G1-2 rewards: the mockup table at about 1,000 to 1,300 credits per hour at base", () => {
  // Expected credits per hour of each template at full strength, on the reference ship that just meets the sheet.
  function perHour(tier: ShortRangeTier): Record<ShortRangeTemplateKey, number> {
    const stats = referenceStats(tier);
    const out = {} as Record<ShortRangeTemplateKey, number>;
    for (const k of SHORT_RANGE_TEMPLATE_KEYS) {
      let credits = 0;
      let ticks = 0;
      for (let seed = 0; seed < 4000; seed++) {
        const roll = rollOf(k, tier, seed);
        credits += shortRangeCycleReward(roll, stats).credits;
        ticks += shortRangeCyclePlan(roll, stats, SHORT_RANGE_SHEETS[tier].engineering).totalTicks;
      }
      out[k] = (credits / ticks) * 3600;
    }
    return out;
  }

  for (const tier of TIERS) {
    it(`tier ${tier}: every template pays inside the band; Prisoner Transport about 20% above Refugee Relocation`, () => {
      const rates = perHour(tier);
      for (const k of SHORT_RANGE_TEMPLATE_KEYS) {
        expect(rates[k], k).toBeGreaterThanOrEqual(1000);
        expect(rates[k], k).toBeLessThanOrEqual(1300);
      }
      const premium = rates.prisonerTransport / rates.refugeeRelocation;
      expect(premium).toBeGreaterThan(1.17);
      expect(premium).toBeLessThan(1.23);
    });
  }

  it("each kind pays what the mockup table says", () => {
    const stats = referenceStats(1);
    const refugee = rollOf("refugeeRelocation", 1, 5);
    const r = shortRangeCycleReward(refugee, stats);
    expect(r.credits).toBe(Math.round(0.0285 * refugee.guests! * refugee.distanceLy));
    expect(r.materials).toEqual({});
    const drop = rollOf("supplyDropOff", 1, 5);
    const d = shortRangeCycleReward(drop, stats);
    expect(d.loadCost).toBe(drop.units! * 3);
    expect(d.credits).toBe(Math.round(d.loadCost * 0.2));
    const pickup = rollOf("supplyPickup", 1, 5);
    expect(shortRangeCycleReward(pickup, stats).materials).toEqual({ commonOre: pickup.units });
    const telescope = shortRangeCycleReward(rollOf("telescopeRepair", 2, 5), stats);
    expect(telescope.credits).toBe(80);
    for (const k of SHORT_RANGE_TEMPLATE_KEYS) {
      for (const tier of TIERS) {
        const x = shortRangeCycleReward(rollOf(k, tier, 5), referenceStats(tier));
        expect(Number.isInteger(x.credits)).toBe(true);
        expect(Number.isInteger(x.captainXpPerTick) && x.captainXpPerTick > 0).toBe(true);
        expect(Number.isInteger(x.fleetAdminXpPerTick) && x.fleetAdminXpPerTick > 0).toBe(true);
        for (const v of Object.values(x.materials)) expect(Number.isInteger(v) && v > 0).toBe(true);
      }
    }
  });

  it("a survey's rare materials grow with Sensors (today's survey yield rule), deterministically", () => {
    let low = 0;
    let high = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const roll = rollOf("phenomenonSurvey", 1, seed);
      const a = shortRangeCycleReward(roll, { ...referenceStats(1), sensors: 10 });
      expect(shortRangeCycleReward(roll, { ...referenceStats(1), sensors: 10 })).toEqual(a);
      low += a.materials.rareMaterial ?? 0;
      high += shortRangeCycleReward(roll, { ...referenceStats(1), sensors: 60 }).materials.rareMaterial ?? 0;
    }
    expect(high).toBeGreaterThan(low);
  });
});
