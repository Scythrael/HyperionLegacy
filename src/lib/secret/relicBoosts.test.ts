// relicBoosts.test.ts: R2-10, the main game's relics read as the minigame's relic boosts.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import Decimal from "break_infinity.js";
import { RELIC_BOOSTS, RELIC_PAST_CAP_WEIGHT, RELIC_TIER_LEVERS, TIER_COUNT, AP_POW, OC_FACTOR, type RelicLever } from "./config";
import { relicWeightedCopies, relicBoostsFromMuseum, relicBoostFor, sameRelicBoosts } from "./relicBoosts";
import { typicalMuseum, heavyMuseum, typicalBoosts, heavyBoosts, typicalTierOneBlanks } from "./relicCollections";
import { freshState, emptyMuseumV2 } from "../game/model";
import { RELIC_TYPES, RELIC_SOFT_CAP, museumBonuses, museumDepositGeneral } from "../game/relics";
import { diminishing } from "../game/diminishing";
import { wiringEntry } from "../game/wiring/registry";
import { R2_10_ADDED_ENTRY_IDS } from "../game/relicMinigame.fixture";
import { serializeSecret, freshSecretState, cloneSecret, type SecretState } from "./state";
import { advanceTo } from "./catchUp";
import {
  tierMultiplier,
  overclockMultiplier,
  overclockLevelFactor,
  tenBonusFactor,
  gamePace,
  captainGain,
  fleetGain,
  prestigeceptionGain,
  augmentMultiplier,
  prestigePreview,
  relicBoost,
} from "./engine";
import { midAutoState, postPrestigeceptionState, live } from "./testStates";

// The user's table (plan USER ANSWERS 2026-10-26, "Approve as drafted"), one lever per relic type.
const USER_TABLE: Readonly<Record<string, RelicLever>> = {
  geodeCore: "tier1",
  magmaPearl: "tier2",
  deepVeinCompass: "tier3",
  tectonicKeystone: "tier4",
  sporeCapsule: "tier5",
  bioluminescentSeed: "tier6",
  leviathanScale: "tier7",
  livingCrystal: "tier8",
  flightRecorder: "overclock",
  ancientDriveCoil: "stack",
  hullRivet: "tenBonus",
  captainsSigil: "captain",
  glyphTablet: "augment",
  resonanceShard: "fleet",
  starChartFragment: "dream",
  precursorLens: "allSmall",
  heartOfTheArchive: "allBig",
};

function withBoosts(s: SecretState, boosts: Partial<Record<RelicLever, number>>): SecretState {
  return { ...cloneSecret(s), relicBoosts: boosts };
}

describe("the relic table", () => {
  it("is the user's table: every one of the 17 general types once, one lever each", () => {
    expect(RELIC_BOOSTS.length).toBe(17);
    expect(new Set(RELIC_BOOSTS.map((d) => d.relicId))).toEqual(new Set(RELIC_TYPES.map((t) => t.id)));
    expect(new Set(RELIC_BOOSTS.map((d) => d.lever)).size).toBe(17);
    for (const d of RELIC_BOOSTS) expect(d.lever, d.relicId).toBe(USER_TABLE[d.relicId]);
    expect(RELIC_TIER_LEVERS.length).toBe(TIER_COUNT);
    expect(RELIC_PAST_CAP_WEIGHT).toBe(5);
    for (const d of RELIC_BOOSTS) {
      expect(d.perCopy, d.relicId).toBeGreaterThan(0);
      expect(d.knee, d.relicId).toBeGreaterThan(0);
    }
  });

  it("each boost is 1 + A x diminishing(weighted, knee): exactly 1 at none, concave, never capped", () => {
    for (const d of RELIC_BOOSTS) {
      expect(relicBoostFor(d.lever, 0)).toBe(1);
      expect(relicBoostFor(d.lever, 40)).toBeCloseTo(1 + d.perCopy * diminishing(40, d.knee), 12);
      const a = relicBoostFor(d.lever, 10) - relicBoostFor(d.lever, 0);
      const b = relicBoostFor(d.lever, 20) - relicBoostFor(d.lever, 10);
      expect(b).toBeLessThan(a); // each copy helps a little less
      expect(relicBoostFor(d.lever, 1e9)).toBeGreaterThan(relicBoostFor(d.lever, 1e8)); // and more always helps
    }
  });
});

describe("reading the Museum", () => {
  it("no relics: no snapshot at all", () => {
    expect(relicBoostsFromMuseum(undefined)).toBeUndefined();
    expect(relicBoostsFromMuseum(emptyMuseumV2())).toBeUndefined();
  });

  it("counts every tier's live copies, and a copy past its tier's soft cap 5x", () => {
    let m = emptyMuseumV2();
    m = museumDepositGeneral(m, 1, "hullRivet", RELIC_SOFT_CAP + 200); // the snapshot holds the first 1,000
    m = museumDepositGeneral(m, 2, "hullRivet", 30);
    m = museumDepositGeneral(m, 1, "geodeCore", 7); // all past Tier I's cap
    const w = relicWeightedCopies(m);
    expect(w.hullRivet).toBe(RELIC_SOFT_CAP + RELIC_PAST_CAP_WEIGHT * 200 + 30);
    expect(w.geodeCore).toBe(RELIC_PAST_CAP_WEIGHT * 7);
    const b = relicBoostsFromMuseum(m)!;
    expect(b.tenBonus).toBe(relicBoostFor("tenBonus", w.hullRivet));
    expect(b.tier1).toBe(relicBoostFor("tier1", w.geodeCore));
    // (0.14.0 Slice 5a: plus the combined relic ceiling fraction)
    expect(Object.keys(b).sort()).toEqual(["ceiling", "tenBonus", "tier1"]);
  });

  it("typical and heavy collections (relicCollections.ts) are what the pacing pins use, on the tier stagger", () => {
    expect(typicalTierOneBlanks()).toEqual({ expedition: 168, shortRange: 40 });
    const w = relicWeightedCopies(typicalMuseum());
    // 0.14.0 Slice 5a: Tier I reveals only its four types (relics.ts RELIC_TYPE_FIRST_TIER); the augmented share
    // lands on Resonance Shard, the one augmented type open there, and the stellar and radiant reveals drop to it
    expect(w).toEqual({ glyphTablet: 38, sporeCapsule: 38, geodeCore: 38, resonanceShard: 93 });
    const t = typicalBoosts();
    for (const d of RELIC_BOOSTS) {
      if (w[d.relicId] === undefined) expect(t[d.lever], d.lever).toBeUndefined();
      else expect(t[d.lever]!, d.lever).toBeGreaterThan(1);
    }
    const h = heavyBoosts();
    for (const d of RELIC_BOOSTS) if (t[d.lever] !== undefined) expect(h[d.lever]!, d.lever).toBeGreaterThan(t[d.lever]!);
    expect(h.ceiling!).toBeGreaterThan(t.ceiling!);
    expect(relicWeightedCopies(heavyMuseum()).geodeCore).toBeGreaterThan(5 * w.geodeCore);
  });

  it("two snapshots compare by value", () => {
    expect(sameRelicBoosts(undefined, undefined)).toBe(true);
    expect(sameRelicBoosts(typicalBoosts(), typicalBoosts())).toBe(true);
    expect(sameRelicBoosts(typicalBoosts(), heavyBoosts())).toBe(false);
    expect(sameRelicBoosts(typicalBoosts(), undefined)).toBe(false);
  });
});

describe("two-way stays Only via milestones: the main game never moves", () => {
  it("reading the boosts leaves the Museum and its bonuses exactly as they were", () => {
    const state = { ...freshState(1), museumV2: heavyMuseum() };
    const before = JSON.stringify(state.museumV2);
    const bonuses = JSON.stringify(museumBonuses(state));
    deepFreeze(state.museumV2);
    relicBoostsFromMuseum(state.museumV2);
    expect(JSON.stringify(state.museumV2)).toBe(before);
    expect(JSON.stringify(museumBonuses(state))).toBe(bonuses);
  });

  it("no gameplay file of the main game imports the minigame (the Debug wiring audit reads it, one way)", () => {
    // The Debug wiring audit's two files are the only readers allowed (its probes and its rows).
    const ALLOWED = new Set(["src/lib/game/wiring/probes.ts", "src/lib/game/wiring/registry.ts"]);
    const offenders: string[] = [];
    for (const file of walk("src/lib/game")) {
      if (ALLOWED.has(file) || /\.(test|fixture)\.ts$/.test(file)) continue;
      if (/from "[^"]*\/secret\//.test(readFileSync(file, "utf-8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the wiring registry carries the 17 minigame rows, live with a probe (held apart in every older pin)", () => {
    expect(R2_10_ADDED_ENTRY_IDS.size).toBe(17);
    for (const id of R2_10_ADDED_ENTRY_IDS) {
      const e = wiringEntry(id);
      expect(e?.status.kind, id).toBe("live");
      expect(e?.probe, id).toMatch(/^content:minigame:/);
    }
  });

  it("the engine never reads the main game: the boosts reach it only as the state's snapshot", () => {
    const engine = readFileSync("src/lib/secret/engine.ts", "utf-8");
    expect(engine).not.toMatch(/from "\.\.\/game/);
    expect(engine).not.toMatch(/from "\.\/relicBoosts"/);
  });
});

describe("every lever moves its consumer", () => {
  const base = postPrestigeceptionState();
  const big = 1.25;

  it("a generator row multiplies that generator only; the two every-generator rows multiply all", () => {
    RELIC_TIER_LEVERS.forEach((lever, k) => {
      const on = withBoosts(base, { [lever]: big });
      for (let j = 0; j < TIER_COUNT; j++) {
        const ratio = tierMultiplier(on, j).div(tierMultiplier(base, j)).toNumber();
        expect(ratio, `${lever} on tier ${j}`).toBeCloseTo(j === k ? big : 1, 9);
      }
    });
    for (const lever of ["allSmall", "allBig"] as const) {
      const on = withBoosts(base, { [lever]: big });
      for (let j = 0; j < TIER_COUNT; j++) expect(tierMultiplier(on, j).div(tierMultiplier(base, j)).toNumber()).toBeCloseTo(big, 9);
    }
  });

  it("Flight Recorder: each Overclock level counts as `boost` levels", () => {
    const on = withBoosts(base, { overclock: big });
    expect(overclockMultiplier(on).log10() / overclockMultiplier(base).log10()).toBeCloseTo(big, 9);
    expect(overclockLevelFactor(on)).toBeCloseTo(Math.pow(OC_FACTOR, big), 12);
    expect(overclockLevelFactor(base)).toBe(OC_FACTOR);
  });

  it("Ancient Drive Coil: the game clock runs `boost` times faster", () => {
    const on = withBoosts(base, { stack: big });
    expect(gamePace(on) / gamePace(base)).toBeCloseTo(big, 12);
  });

  it("Hull Rivet: the ten bonus factor x boost", () => {
    expect(tenBonusFactor(withBoosts(base, { tenBonus: big })) / tenBonusFactor(base)).toBeCloseTo(big, 12);
  });

  it("Captain's Sigil, Glyph Tablet and Star Chart Fragment: the points earned x boost (before the floor)", () => {
    const s = cloneSecret(base);
    s.runPeak = new Decimal("1e5000");
    s.fleetPeak = new Decimal("1e5000");
    s.pcPeak = new Decimal("1e50000");
    const near = (a: Decimal, b: Decimal) => expect(a.div(b).toNumber()).toBeCloseTo(big, 3);
    // (0.14.0 retune: Captain and Augment gains on this state are small, so those two checks hold Dream Points
    // for a payout big enough that the floor cannot hide the boost)
    const c = cloneSecret(s);
    c.dreamPoints = new Decimal("1e60");
    near(captainGain(withBoosts(c, { captain: big })), captainGain(c));
    near(fleetGain(withBoosts(c, { augment: big })), fleetGain(c));
    // Pay at the bar (Slice 5a, user 2026-10-29): with Dream Points held the bar moves with the boost and the payout
    // is PC_BAR_RATIO x what you hold, so the boost shows on a payout from nothing held (the first Prestigeception),
    // and every later one scales with it.
    const d = cloneSecret(s);
    d.dreamPoints = new Decimal(0);
    near(prestigeceptionGain(withBoosts(d, { dream: big })), prestigeceptionGain(d));
  });

  it("Resonance Shard: Augment Points count as `boost` times as many on the stack", () => {
    const s = midAutoState();
    const on = withBoosts(s, { fleet: big });
    expect(augmentMultiplier(on).toNumber()).toBeCloseTo(Math.pow(s.augmentPoints.toNumber() * big + 1, AP_POW), 9);
  });

  it("a relic snapshot with every lever at 1 runs the same arithmetic as none", () => {
    const ones = Object.fromEntries(RELIC_BOOSTS.map((d) => [d.lever, 1]));
    const s = midAutoState();
    expect(serializeSecret(live(withBoosts(s, ones), 600))).toBe(serializeSecret(live(s, 600)));
  });
});

describe("relic boosts keep the minigame deterministic", () => {
  it("offline == live inside the exact window, with a typical and a heavy snapshot", () => {
    for (const boosts of [typicalBoosts(), heavyBoosts()]) {
      const s = withBoosts(midAutoState(), boosts);
      const caught = advanceTo(s, s.lastTickAt + 3600 * 1000).state;
      expect(serializeSecret(caught)).toBe(serializeSecret(live(s, 3600)));
      expect(caught.relicBoosts).toBe(boosts); // the snapshot rides along, untouched
    }
  });

  it("the snapshot is never saved", () => {
    const s = freshSecretState(0);
    expect(serializeSecret(withBoosts(s, typicalBoosts()))).toBe(serializeSecret(s));
    expect(serializeSecret(s)).not.toContain("relicBoosts");
  });

  it("the prestige previews read the same boosted engine", () => {
    const s = withBoosts(postPrestigeceptionState(), typicalBoosts());
    const p = prestigePreview(s, "captain");
    if (p) expect(p.after.captain.toString()).not.toBe("");
    expect(relicBoost(s, "fleet")).toBe(typicalBoosts().fleet);
  });
});

function deepFreeze(o: unknown): void {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
