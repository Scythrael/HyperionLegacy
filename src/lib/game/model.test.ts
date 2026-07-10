import { describe, it, expect } from "vitest";
import {
  freshState,
  freshCaptains,
  freshCaptainStack,
  requiredTicksForPhase,
  MISSIONS,
  RECIPES,
  xpForNextLevel,
  CAPTAIN_TALENTS,
  HOMEWORLD_TALENTS,
  CAPTAIN_SPEC_BONUS,
  specCards,
  categoryCards,
  SHIP_TYPES,
  shipDerivedStats,
  effectiveMissionDef,
} from "./model";
import type { CaptainTalentKey, HomeworldTalentKey } from "./model";

describe("freshState — captain roster shape", () => {
  it("starts with exactly 1 captain (Command branch is how the roster grows now)", () => {
    const state = freshState();
    expect(state.captains).toHaveLength(1);
  });

  it("Captain 1 has id 1, label 'Captain 1'", () => {
    const state = freshState();
    const c1 = state.captains[0];
    expect(c1.id).toBe(1);
    expect(c1.label).toBe("Captain 1");
  });

  it("starts with xp:0, level:1, statPoints:0 per captain, and fleet-wide tickDurationSeconds 1", () => {
    const state = freshState();
    for (const c of state.captains) {
      // Decimal isn't a primitive -- .toBe()/.toEqual() won't match a plain-number
      // literal even when equal in value, so every Decimal-field assertion in this
      // file compares via .equals() instead (this pattern repeats below without
      // re-explaining it each time; see the homePlanet.storage test further down
      // for the related .toEqual-on-a-whole-object case specifically).
      expect(c.xp.equals(0)).toBe(true);
      expect(c.level).toBe(1);
      expect(c.statPoints).toBe(0);
    }
    expect(state.tickDurationSeconds).toBe(1);
  });

  it("fleet-wide fields default to 0", () => {
    const state = freshState();
    expect(state.gameTimeSeconds).toBe(0);
  });
});

describe("freshState ships seeding", () => {
  it("seeds one General Freighter assigned to the starting captain, capacity 8", () => {
    const s = freshState();
    expect(s.shipStorageCapacity).toBe(8);
    expect(s.nextShipId).toBe(2); // "ship-1" is taken by the seeded freighter, so the next id is 2
    expect(s.ships).toHaveLength(1);
    expect(s.ships[0].typeKey).toBe("generalFreighter");
    expect(s.ships[0].assignedCaptainId).toBe(s.captains[0].id);
    for (const c of s.captains) {
      expect(s.ships.filter((sh) => sh.assignedCaptainId === c.id)).toHaveLength(1);
    }
  });
});

describe("freshCaptains(count) — parameterized roster generation", () => {
  it("generates exactly `count` captains with sequential ids/labels, all sharing the fresh baseline", () => {
    const captains = freshCaptains(3);
    expect(captains).toHaveLength(3);
    expect(captains.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(captains.map((c) => c.label)).toEqual(["Captain 1", "Captain 2", "Captain 3"]);
    for (const c of captains) {
      expect(c.xp.equals(0)).toBe(true);
      expect(c.level).toBe(1);
      expect(c.statPoints).toBe(0);
    }
  });

  it("generates a single captain when count is 1", () => {
    const captains = freshCaptains(1);
    expect(captains).toHaveLength(1);
    expect(captains[0].id).toBe(1);
    expect(captains[0].label).toBe("Captain 1");
  });
});

describe("freshCaptainStack — shared reset baseline", () => {
  it("returns the baseline a brand-new captain slot starts with (no tickDurationSeconds -- that's fleet-wide now)", () => {
    const stack = freshCaptainStack();
    expect(stack.mission).toBe(null);
    expect(stack.xp.equals(0)).toBe(true);
    expect(stack.level).toBe(1);
    expect(stack.statPoints).toBe(0);
    expect((stack as any).tickDurationSeconds).toBeUndefined();
  });
});

describe("freshState / freshCaptainStack — mission and Home Planet fields", () => {
  it("a fresh captain starts with no active mission", () => {
    const captain = freshCaptains(1)[0];
    expect(captain.mission).toBe(null);
  });

  it("freshState's homePlanet storage starts at 0 for every material, including the crafted-good tiers", () => {
    const state = freshState();
    // Per-key .equals() checks, not .toEqual() against a plain-number literal --
    // .toEqual does a deep structural comparison, and a Decimal instance's
    // internal shape (mantissa/exponent) will NOT structurally match a plain
    // number literal even when the represented value is equal.
    expect(state.homePlanet.storage.commonOre.equals(0)).toBe(true);
    expect(state.homePlanet.storage.uncommonMaterial.equals(0)).toBe(true);
    expect(state.homePlanet.storage.rareMaterial.equals(0)).toBe(true);
    expect(state.homePlanet.storage.refinedMaterial.equals(0)).toBe(true);
    expect(state.homePlanet.storage.components.equals(0)).toBe(true);
  });

  it("freshCaptainStack's mission field is null (a brand-new/unlocked captain slot starts idle)", () => {
    expect(freshCaptainStack().mission).toBe(null);
  });
});

describe("MISSIONS — launch set", () => {
  it("has exactly 2 missions with the specified tick counts and cargo/extraction values", () => {
    expect(MISSIONS.shortOreRun.transitOutTicks).toBe(25);
    expect(MISSIONS.shortOreRun.transitBackTicks).toBe(25);
    expect(MISSIONS.shortOreRun.unloadTicks).toBe(8);
    expect(MISSIONS.shortOreRun.extractionRatePerTick).toBe(1);
    expect(MISSIONS.shortOreRun.cargoCapacity).toBe(90);

    expect(MISSIONS.longOreRun.transitOutTicks).toBe(70);
    expect(MISSIONS.longOreRun.transitBackTicks).toBe(70);
    expect(MISSIONS.longOreRun.cargoCapacity).toBe(90);

    expect(MISSIONS.shortOreRun.fleetAdminXpPerCycle).toBe(1);
    expect(MISSIONS.longOreRun.fleetAdminXpPerCycle).toBe(2);

    expect(MISSIONS.shortOreRun.creditsPerCycle).toBe(10);
    expect(MISSIONS.longOreRun.creditsPerCycle).toBe(20);
  });

  it("both missions' occurrence chances are valid probabilities (0-1)", () => {
    for (const key of Object.keys(MISSIONS) as (keyof typeof MISSIONS)[]) {
      expect(MISSIONS[key].uncommonChance).toBeGreaterThan(0);
      expect(MISSIONS[key].uncommonChance).toBeLessThanOrEqual(1);
      expect(MISSIONS[key].rareChance).toBeGreaterThan(0);
      expect(MISSIONS[key].rareChance).toBeLessThanOrEqual(1);
    }
  });

  it("longOreRun has better rare-material odds than shortOreRun", () => {
    expect(MISSIONS.longOreRun.rareChance).toBeGreaterThan(MISSIONS.shortOreRun.rareChance);
    expect(MISSIONS.longOreRun.uncommonChance).toBeGreaterThan(MISSIONS.shortOreRun.uncommonChance);
  });
});

describe("requiredTicksForPhase", () => {
  it("ordersReceived is always exactly 1 tick", () => {
    expect(requiredTicksForPhase("ordersReceived", MISSIONS.shortOreRun)).toBe(1);
  });

  it("transitOut/transitBack/unloading match the mission definition directly", () => {
    expect(requiredTicksForPhase("transitOut", MISSIONS.shortOreRun)).toBe(25);
    expect(requiredTicksForPhase("transitBack", MISSIONS.shortOreRun)).toBe(25);
    expect(requiredTicksForPhase("unloading", MISSIONS.shortOreRun)).toBe(8);
  });

  it("extracting is cargoCapacity / extractionRatePerTick, rounded up", () => {
    // 90 / 1 = exactly 90 -- both cargoCapacity and extractionRatePerTick were
    // rescaled 10x down together (Extraction Rework regression fix), keeping the
    // resulting phase length unchanged at 90 ticks.
    expect(requiredTicksForPhase("extracting", MISSIONS.shortOreRun)).toBe(90);
  });
});

describe("RECIPES — launch set", () => {
  it("has exactly 2 recipes with well-formed inputs/output", () => {
    expect(Object.keys(RECIPES)).toHaveLength(2);
    for (const recipe of Object.values(RECIPES)) {
      expect(Object.keys(recipe.inputs).length).toBeGreaterThan(0);
      // recipe.output.amount is now a Decimal -- .toBeGreaterThan() needs a
      // plain-number operand, so compare via .gt(0) instead (both express the
      // same "amount is a positive quantity" check).
      expect(recipe.output.amount.gt(0)).toBe(true);
    }
  });
});

describe("xpForNextLevel", () => {
  it("grows with level (100 at level 1, 200 at level 2)", () => {
    expect(xpForNextLevel(1)).toBe(100);
    expect(xpForNextLevel(2)).toBe(200);
  });
});

describe("CAPTAIN_TALENTS — launch set", () => {
  // Radial Skill Web (Task 2) rewrote this table: the old five-column
  // (command/tactical/science/resourcefulness/diplomacy) linear model is gone.
  // Only the three radial branches remain -- resourcefulness ("Prospector") is
  // the rich tree; tactical ("Tactician") and science ("Explorer") ship as a
  // single gateway hub each until their combat/science systems exist. The old
  // ex-command extraction talents were re-homed under resourcefulness.
  it("Resourcefulness is the rich branch; Tactical/Science are hub-only stubs", () => {
    const branches = Object.values(CAPTAIN_TALENTS).map((t) => t.branch);
    // resourcefulness carries the hub + 6 content nodes = 7 total.
    expect(branches.filter((b) => b === "resourcefulness").length).toBe(7);
    // tactical/science are just their hub (1 each) -- lean stub, not empty.
    expect(branches.filter((b) => b === "tactical").length).toBe(1);
    expect(branches.filter((b) => b === "science").length).toBe(1);
  });

  it("re-homed ex-command extraction talents now live under resourcefulness", () => {
    // Bulk Extraction -> Refined Extraction moved off the deleted `command`
    // branch onto resourcefulness (extraction yield fits the Prospector theme).
    expect(CAPTAIN_TALENTS.prospectorBulkExtraction.branch).toBe("resourcefulness");
    expect(CAPTAIN_TALENTS.prospectorBulkExtraction.effect).toEqual({ type: "commonYieldMult", mult: 0.1 });
    expect(CAPTAIN_TALENTS.prospectorRefinedExtraction.branch).toBe("resourcefulness");
    expect(CAPTAIN_TALENTS.prospectorRefinedExtraction.effect).toEqual({ type: "uncommonYieldMult", mult: 0.15 });
  });

  it("Resourcefulness has exactly 1 bonusRollChance node and 1 bonusRollChanceMult node", () => {
    const bonusRollChanceNodes = Object.values(CAPTAIN_TALENTS).filter((t) => t.effect.type === "bonusRollChance");
    const bonusRollChanceMultNodes = Object.values(CAPTAIN_TALENTS).filter((t) => t.effect.type === "bonusRollChanceMult");
    expect(bonusRollChanceNodes).toHaveLength(1);
    expect(bonusRollChanceMultNodes).toHaveLength(1);
  });

  it("Lucky Strike I/II have the expected cost, adjacency chain, and effect values", () => {
    // Prerequisite chains are gone -- ordering is now expressed via `neighbors`
    // adjacency (the fog-of-war/buy-gate walks this instead of a `requires` link).
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeI.cost).toBe(6);
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeI.neighbors).toContain("prospectorKeenEyeII");
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeI.effect).toEqual({ type: "bonusRollChance", chance: 0.02 });

    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeII.cost).toBe(8);
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeII.neighbors).toContain("prospectorLuckyStrikeI");
    expect(CAPTAIN_TALENTS.prospectorLuckyStrikeII.effect).toEqual({ type: "bonusRollChanceMult", mult: 1.0 });
  });

  it("every CAPTAIN_TALENTS entry has non-empty flavor text", () => {
    for (const talent of Object.values(CAPTAIN_TALENTS)) {
      expect(talent.flavor.length).toBeGreaterThan(0);
    }
  });
});

describe("HOMEWORLD_TALENTS — launch set", () => {
  // Radial Skill Web (Task 3) rewrote this table into a radial graph: every
  // category now has at least its hub, so no category is literally empty
  // anymore. Homeland Defense / Citizenry are HUB-ONLY (a "learn me first"
  // gateway, not zero entries) until their defense/population systems exist;
  // Fleet Logistics is the rich category (hub + slot chain + yield); Economy
  // and Industry carry hub + one content node each.
  it("Fleet Logistics is the rich category; Homeland Defense/Citizenry are hub-only stubs", () => {
    const branches = Object.values(HOMEWORLD_TALENTS).map((t) => t.branch);
    // fleetLogistics: hub + Slot1/2/3 + Yield = 5 total.
    expect(branches.filter((b) => b === "fleetLogistics").length).toBe(5);
    // economy/industry: hub + 1 content node each = 2 total.
    expect(branches.filter((b) => b === "economy").length).toBe(2);
    expect(branches.filter((b) => b === "industry").length).toBe(2);
    // homelandDefense/citizenry: just their hub (1 each) -- lean stub, not empty.
    expect(branches.filter((b) => b === "homelandDefense").length).toBe(1);
    expect(branches.filter((b) => b === "citizenry").length).toBe(1);
  });

  it("Fleet Logistics has exactly 3 unlockCaptainSlot nodes, matching the original 3-tier slot-unlock design", () => {
    const slotNodes = Object.values(HOMEWORLD_TALENTS).filter((t) => t.effect.type === "unlockCaptainSlot");
    expect(slotNodes).toHaveLength(3);
  });

  it("every HOMEWORLD_TALENTS entry has non-empty flavor text", () => {
    for (const talent of Object.values(HOMEWORLD_TALENTS)) {
      expect(talent.flavor.length).toBeGreaterThan(0);
    }
  });
});

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 1):
// the talent def shape moves from a linear `requires` chain to a graph -- each
// def now carries web-space coordinates (x/y) and an adjacency list
// (neighbors), and the old `requires` field is gone. This structural test is
// the durable spec for that shape change; the data tables that satisfy it are
// rewritten in Tasks 2-3, so this test is intentionally red until then.
describe("Radial Skill Web — talent def graph shape", () => {
  it("every talent def carries graph fields (x, y, neighbors) and no requires", () => {
    for (const def of Object.values(CAPTAIN_TALENTS)) {
      expect(typeof def.x).toBe("number");
      expect(typeof def.y).toBe("number");
      expect(Array.isArray(def.neighbors)).toBe(true);
      expect("requires" in def).toBe(false);
    }
    for (const def of Object.values(HOMEWORLD_TALENTS)) {
      expect(typeof def.x).toBe("number");
      expect(typeof def.y).toBe("number");
      expect(Array.isArray(def.neighbors)).toBe(true);
      expect("requires" in def).toBe(false);
    }
  });
});

// Radial Skill Web (Task 2): graph-integrity invariants for the CAPTAIN_TALENTS
// table specifically. These are the four structural rules the fog-of-war
// reveal (Task 4) and adjacency buy-gating (Task 5) depend on being true:
//   1. Exactly ONE hub per branch -- the always-visible seed each branch's
//      reveal starts from (a branch with zero hubs would render blank; two
//      would give an ambiguous seed).
//   2. Every `neighbors` entry RESOLVES to a real key (no dangling adjacency).
//   3. Adjacency is SAME-BRANCH (the web never draws a connector across
//      branches -- each spec is its own isolated graph).
//   4. Adjacency is SYMMETRIC (if A lists B, B lists A) -- connectors are
//      undirected and the reveal walks both directions, so a one-way link
//      would render/behave inconsistently.
// This is the durable spec for the Task 2 data rewrite.
describe("Radial Skill Web — CAPTAIN_TALENTS graph integrity", () => {
  it("exactly one hub per branch, symmetric adjacency, all neighbors resolve same-branch", () => {
    const keys = Object.keys(CAPTAIN_TALENTS) as CaptainTalentKey[];
    const branches = new Set(Object.values(CAPTAIN_TALENTS).map((d) => d.branch));
    for (const branch of branches) {
      const hubs = keys.filter((k) => CAPTAIN_TALENTS[k].branch === branch && CAPTAIN_TALENTS[k].isHub);
      expect(hubs.length).toBe(1); // one seed per branch
    }
    for (const k of keys) {
      for (const n of CAPTAIN_TALENTS[k].neighbors) {
        expect(CAPTAIN_TALENTS[n]).toBeDefined(); // resolves
        expect(CAPTAIN_TALENTS[n].branch).toBe(CAPTAIN_TALENTS[k].branch); // same branch
        expect(CAPTAIN_TALENTS[n].neighbors).toContain(k); // symmetric
      }
    }
  });
});

// Radial Skill Web (Task 3): the same graph-integrity invariants as the captain
// test above, now for HOMEWORLD_TALENTS -- PLUS the Task 3 preservation rule.
// The four structural rules (one hub per category, neighbors resolve, same
// category, symmetric) are what the fog-of-war reveal (Task 4) and adjacency
// buy-gating (Task 5) depend on. The extra assertion here guards the CRITICAL
// constraint that every pre-existing (v14) homeworld key string survives the
// rewrite UNCHANGED -- existing saves' unlockedHomeworldTalents reference these
// strings and Task 6's migration deliberately does NOT refund homeworld talents
// because they survive by key, so a rename here would silently break real saves.
describe("Radial Skill Web — HOMEWORLD_TALENTS graph integrity", () => {
  it("all v14 keys preserved + one hub per category, symmetric adjacency, all neighbors resolve same-category", () => {
    // 1. Every pre-existing key string still defined (the preservation rule).
    for (const k of [
      "fleetLogisticsSlot1",
      "fleetLogisticsSlot2",
      "fleetLogisticsSlot3",
      "fleetLogisticsYield",
      "industryBonusOutput",
      "economyTrickle",
    ]) {
      expect((HOMEWORLD_TALENTS as any)[k]).toBeDefined();
    }

    const keys = Object.keys(HOMEWORLD_TALENTS) as HomeworldTalentKey[];

    // 2. Exactly one hub per category (5 categories -> 5 hubs total).
    const cats = ["fleetLogistics", "homelandDefense", "citizenry", "economy", "industry"];
    for (const cat of cats) {
      const hubs = keys.filter((k) => HOMEWORLD_TALENTS[k].branch === cat && HOMEWORLD_TALENTS[k].isHub);
      expect(hubs.length).toBe(1); // one seed per category
    }
    const totalHubs = keys.filter((k) => HOMEWORLD_TALENTS[k].isHub).length;
    expect(totalHubs).toBe(5);

    // 3-4. Every neighbor resolves, is same-category, and adjacency is symmetric.
    for (const k of keys) {
      for (const n of HOMEWORLD_TALENTS[k].neighbors) {
        expect(HOMEWORLD_TALENTS[n]).toBeDefined(); // resolves
        expect(HOMEWORLD_TALENTS[n].branch).toBe(HOMEWORLD_TALENTS[k].branch); // same category
        expect(HOMEWORLD_TALENTS[n].neighbors).toContain(k); // symmetric
      }
    }
  });
});

describe("freshState / freshCaptainStack — talent and Fleet Admiral fields", () => {
  it("a fresh captain has no unlocked talents", () => {
    expect(freshCaptains(1)[0].unlockedCaptainTalents).toEqual([]);
  });

  it("freshState starts Fleet Admiral at level 1, 0 xp, 0 adminPoints, no unlocked Homeworld talents", () => {
    const state = freshState();
    expect(state.fleetAdminXp.equals(0)).toBe(true);
    expect(state.fleetAdminLevel).toBe(1);
    expect(state.adminPoints).toBe(0);
    expect(state.unlockedHomeworldTalents).toEqual([]);
  });

  it("freshState starts credits at 0", () => {
    expect(freshState().credits.equals(0)).toBe(true);
  });
});

// Progression Pacing Rework (Task 1, docs/plans/2026-07-11-progression-pacing-rework-*):
// lifetimeStats is a forward-compat schema reserved NOW so future systems
// (Completions/Achievements) have monotonic lifetime totals to read -- these
// totals CANNOT be back-derived from spent inventory (a player who mined 1000
// ore and crafted it all away still shows 0 in storage), so the counters must
// accrue from a clean-slate zero on a brand-new save. This task ONLY guards the
// freshState zero-init of the schema; nothing increments these counters yet
// (that wiring, and the save migration that backfills old saves, are later
// tasks). The maps start EMPTY ({}) -- a material/mission key only appears once
// it's first recorded -- while the scalar totals start at Decimal(0).
describe("Progression Pacing — freshState.lifetimeStats zero-init", () => {
  it("freshState seeds lifetimeStats with empty maps and Decimal(0) scalar totals", () => {
    const state = freshState();
    // The four per-key tally maps start EMPTY -- no material or mission key is
    // present until the first time it's recorded (a later task's increment).
    expect(state.lifetimeStats.itemsGathered).toEqual({});
    expect(state.lifetimeStats.itemsRefined).toEqual({});
    expect(state.lifetimeStats.itemsCrafted).toEqual({});
    expect(state.lifetimeStats.missionsCompleted).toEqual({});
    // The three scalar lifetime totals start at Decimal(0) -- compared via
    // .equals() (not .toEqual against a plain number), same Decimal convention
    // as every other Decimal-field assertion in this file (see the homePlanet
    // storage test above for the full rationale).
    expect(state.lifetimeStats.creditsEarned.equals(0)).toBe(true);
    expect(state.lifetimeStats.captainXpAwarded.equals(0)).toBe(true);
    expect(state.lifetimeStats.fleetAdminXpAwarded.equals(0)).toBe(true);
  });
});

describe("Captain Specialization — CaptainState.spec and CAPTAIN_SPEC_BONUS", () => {
  it("a fresh captain has no spec chosen", () => {
    expect(freshCaptains(1)[0].spec).toBeNull();
  });

  it("CAPTAIN_SPEC_BONUS has an entry for resourcefulness only", () => {
    // Radial Skill Web (Task 2) dropped the `command` spec bonus along with the
    // command branch itself. resourcefulness ("Prospector") is the only branch
    // with a real spec bonus at launch; tactical/science remain absent until
    // their systems exist (same "not yet a real spec" convention as before).
    expect(CAPTAIN_SPEC_BONUS.resourcefulness).toEqual({ type: "bonusRollChance", chance: 0.01 });
    expect(CAPTAIN_SPEC_BONUS.tactical).toBeUndefined();
    expect(CAPTAIN_SPEC_BONUS.science).toBeUndefined();
  });
});

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 13):
// the selector card tables feeding TreeSelector.svelte. The CRITICAL invariant
// is that each card's `key` EXACTLY matches a real branch/category key, because
// Tasks 14/15 map a focused card straight onto a CaptainTalentBranch /
// HomeworldTalentBranch. A drifted/typo'd key would silently break that
// card->branch mapping, so these tests derive the expected key SETS from the
// real talent tables (not hard-coded literals) -- if a branch/category is ever
// added or renamed, this test forces the card tables to keep pace.
describe("Selector cards — specCards / categoryCards (Task 13)", () => {
  it("specCards has exactly 3 entries keyed to the 3 captain branches", () => {
    expect(specCards).toHaveLength(3);
    // The real captain branches, derived from the talent table itself.
    const captainBranches = new Set(Object.values(CAPTAIN_TALENTS).map((t) => t.branch));
    expect(captainBranches).toEqual(new Set(["resourcefulness", "tactical", "science"]));
    // Every card key is one of those branches, and the set of card keys matches
    // the set of branches exactly (no missing, no extra, no duplicates).
    const cardKeys = specCards.map((c) => c.key);
    expect(new Set(cardKeys)).toEqual(captainBranches);
    expect(cardKeys).toHaveLength(new Set(cardKeys).size); // keys are unique
  });

  it("categoryCards has exactly 5 entries keyed to the 5 homeworld categories", () => {
    expect(categoryCards).toHaveLength(5);
    // The real homeworld categories, derived from the talent table itself.
    const homeworldCategories = new Set(Object.values(HOMEWORLD_TALENTS).map((t) => t.branch));
    expect(homeworldCategories).toEqual(
      new Set(["fleetLogistics", "homelandDefense", "citizenry", "economy", "industry"]),
    );
    const cardKeys = categoryCards.map((c) => c.key);
    expect(new Set(cardKeys)).toEqual(homeworldCategories);
    expect(cardKeys).toHaveLength(new Set(cardKeys).size); // keys are unique
  });

  it("every selector card carries a non-empty title, flavor, and at least one bullet", () => {
    for (const card of [...specCards, ...categoryCards]) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.flavor.length).toBeGreaterThan(0);
      expect(card.bullets.length).toBeGreaterThan(0);
      for (const bullet of card.bullets) {
        expect(bullet.length).toBeGreaterThan(0);
      }
    }
  });
});

// Ships — Stats Foundation (Task 1): the SHIP_TYPES table is the durable spec
// for the 4 real hulls this feature introduces. It only ADDS declarations this
// pass -- nothing consumes SHIP_TYPES yet (GameState wiring, mission math, and
// UI land in later tasks), so this test guards the stat profiles in isolation.
// The three forward buckets (tactician/explorer hull families) are deliberately
// NOT built yet and therefore intentionally NOT asserted here.
describe("SHIP_TYPES", () => {
  it("has the 4 real hulls with the designed stat profiles", () => {
    expect(SHIP_TYPES.generalFreighter.cargoCapacity).toBe(90);
    expect(SHIP_TYPES.generalFreighter.transitSpeedMult).toBe(1.0);
    expect(SHIP_TYPES.generalFreighter.extractionYieldMult).toBe(1.0);
    expect(SHIP_TYPES.generalFreighter.moduleSlots).toBe(1);
    expect(SHIP_TYPES.prospectorHauler.cargoCapacity).toBe(180);
    expect(SHIP_TYPES.prospectorRunner.transitSpeedMult).toBe(1.5);
    expect(SHIP_TYPES.prospectorMiner.extractionYieldMult).toBe(1.35);
    for (const key of Object.keys(SHIP_TYPES) as (keyof typeof SHIP_TYPES)[]) {
      expect(SHIP_TYPES[key].tier).toBe(1);
      expect(SHIP_TYPES[key].cost?.credits).toBeGreaterThan(0);
    }
  });
});

describe("effectiveMissionDef", () => {
  const short = MISSIONS.shortOreRun; // transitOut/Back 25, cargo 90, rate 1

  it("freighter (baseline) leaves the mission unchanged", () => {
    const eff = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "generalFreighter", assignedCaptainId: null }));
    expect(eff.transitOutTicks).toBe(25);
    expect(eff.transitBackTicks).toBe(25);
    expect(eff.cargoCapacity).toBe(90);
  });

  it("runner (1.5x) shortens transit via ceil, hauler (0.8x) lengthens it", () => {
    const runner = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorRunner", assignedCaptainId: null }));
    expect(runner.transitOutTicks).toBe(Math.ceil(25 / 1.5)); // 17
    expect(runner.cargoCapacity).toBe(60);
    const hauler = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorHauler", assignedCaptainId: null }));
    expect(hauler.transitOutTicks).toBe(Math.ceil(25 / 0.8)); // 32
    expect(hauler.cargoCapacity).toBe(180);
  });

  it("does not mutate the base mission", () => {
    effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorHauler", assignedCaptainId: null }));
    expect(MISSIONS.shortOreRun.cargoCapacity).toBe(90);
  });
});
