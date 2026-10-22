// OC-15 (complement plan, user 2026-10-16 "Add tiers 3-7 now"; 2026-10-21 "Build them in 0.14.0"): the Research Lab
// and Fabricator tier III to VII rungs. Proven here: the one table drives both tracks; every rung is real the moment
// it is built (a slot, through the same reached-rungs sums the consoles read); the gates are the ones the Upgrades
// panels show (credits and FA level); a tier N blueprint needs Lab N to research and Fabricator N to craft; the
// public tier readers; offline == live across a rung build.
import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  FABRICATOR_FACILITY_KEY,
  FACILITIES,
  LAB_FABRICATOR_TIER_RUNGS,
  LAB_FABRICATOR_TOP_TIER,
  RESEARCH_FACILITY_KEY,
  blueprintResearchable,
  fabricatorTier,
  freshState,
  labTier,
  type GameState,
} from "./model";
import { canBuildFacilityUpgrade, canFabricate, economyTick, fabricateSlotCount, researchSlotCount, startFabricateJob, startFacilityUpgrade, startResearch, tick } from "./tick";
import { addItemQuality } from "./inventory";
import { stateHash } from "./firstRunsGoldens.fixture";
import { OC15_ADDED_ENTRY_IDS } from "./labFabricatorTiers.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";

function atLevels(research: number, fabricator: number, fleetAdminLevel = 1, credits = 0): GameState {
  const s = freshState();
  s.facilities = { ...s.facilities, [RESEARCH_FACILITY_KEY]: { level: research }, [FABRICATOR_FACILITY_KEY]: { level: fabricator } };
  return { ...s, fleetAdminLevel, credits: new Decimal(credits) };
}

describe("OC-15: LAB_FABRICATOR_TIER_RUNGS, the one table", () => {
  it("one row per tier, III to VII, in order", () => {
    expect(LAB_FABRICATOR_TIER_RUNGS.map((r) => r.tier)).toEqual([3, 4, 5, 6, 7]);
    expect(LAB_FABRICATOR_TOP_TIER).toBe(7);
  });

  it("each row costs more, takes longer and asks a higher FA level than the one before", () => {
    for (let i = 1; i < LAB_FABRICATOR_TIER_RUNGS.length; i++) {
      const [prev, row] = [LAB_FABRICATOR_TIER_RUNGS[i - 1], LAB_FABRICATOR_TIER_RUNGS[i]];
      expect(row.credits, `tier ${row.tier}`).toBeGreaterThan(prev.credits);
      expect(row.durationTicks, `tier ${row.tier}`).toBeGreaterThan(prev.durationTicks);
      expect(row.fleetAdminLevel, `tier ${row.tier}`).toBeGreaterThan(prev.fleetAdminLevel);
    }
  });

  it("the tier III row is the Fabricator's FIX B third craft line, unchanged (20,000 / 240 / FA 6)", () => {
    const fab3 = FACILITIES[FABRICATOR_FACILITY_KEY].upgrades[2];
    expect(fab3.credits?.toNumber()).toBe(20000);
    expect(fab3.durationTicks).toBe(240);
    expect(fab3.requiresFleetAdminLevel).toBe(6);
    expect(fab3.effect).toEqual({ addFabricateSlots: 1 });
    expect(LAB_FABRICATOR_TIER_RUNGS[0]).toMatchObject({ tier: 3, credits: 20000, durationTicks: 240, fleetAdminLevel: 6 });
  });
});

describe("OC-15: both tracks end at tier VII and every rung is real", () => {
  it("each track has one rung per level up to LAB_FABRICATOR_TOP_TIER", () => {
    expect(FACILITIES[RESEARCH_FACILITY_KEY].upgrades).toHaveLength(LAB_FABRICATOR_TOP_TIER);
    expect(FACILITIES[FABRICATOR_FACILITY_KEY].upgrades).toHaveLength(LAB_FABRICATOR_TOP_TIER);
  });

  it("rung N (levels 3 to 7) is the table's tier N row on both tracks: credits and FA only, no materials or talents", () => {
    for (const row of LAB_FABRICATOR_TIER_RUNGS) {
      for (const key of [RESEARCH_FACILITY_KEY, FABRICATOR_FACILITY_KEY]) {
        const rung = FACILITIES[key].upgrades[row.tier - 1];
        expect(rung.materials, `${key} ${row.tier}`).toEqual({});
        expect(rung.credits?.toNumber(), `${key} ${row.tier}`).toBe(row.credits);
        expect(rung.durationTicks, `${key} ${row.tier}`).toBe(row.durationTicks);
        expect(rung.requiresFleetAdminLevel, `${key} ${row.tier}`).toBe(row.fleetAdminLevel);
        expect(rung.requiresHomeworldTalents, `${key} ${row.tier}`).toBeUndefined();
        expect(rung.requiresMissionCompletions, `${key} ${row.tier}`).toBeUndefined();
      }
      expect(FACILITIES[RESEARCH_FACILITY_KEY].upgrades[row.tier - 1].effect).toEqual({ addResearchSlots: row.researchSlots });
      expect(FACILITIES[FABRICATOR_FACILITY_KEY].upgrades[row.tier - 1].effect).toEqual({ addFabricateSlots: row.fabricateSlots });
    }
  });

  it("no inert rung: every level adds a slot the engine counts", () => {
    for (let level = 1; level <= LAB_FABRICATOR_TOP_TIER; level++) {
      const below = atLevels(level - 1, level - 1);
      const at = atLevels(level, level);
      expect(researchSlotCount(at), `Lab ${level}`).toBeGreaterThan(researchSlotCount(below));
      expect(fabricateSlotCount(at), `Fabricator ${level}`).toBeGreaterThan(fabricateSlotCount(below));
    }
    expect(researchSlotCount(atLevels(7, 7))).toBe(7);
    expect(fabricateSlotCount(atLevels(7, 7))).toBe(7);
  });

  it("level VII is the top: the next rung is refused as fully upgraded", () => {
    const s = atLevels(7, 7, 99, 1e15);
    expect(canBuildFacilityUpgrade(s, RESEARCH_FACILITY_KEY)).toEqual({ ok: false, reason: "Research Lab is fully upgraded" });
    expect(canBuildFacilityUpgrade(s, FABRICATOR_FACILITY_KEY)).toEqual({ ok: false, reason: "Fabricator is fully upgraded" });
  });
});

describe("OC-15: building a tier rung", () => {
  it("Lab 2 -> 3: refused below FA 6, refused short of 20,000 credits, then builds and adds the third slot", () => {
    expect(canBuildFacilityUpgrade(atLevels(2, 3, 5, 1e9), RESEARCH_FACILITY_KEY)).toEqual({ ok: false, reason: "Requires Fleet Admiral level 6" });
    expect(canBuildFacilityUpgrade(atLevels(2, 3, 6, 19_999), RESEARCH_FACILITY_KEY).ok).toBe(false);
    let s = atLevels(2, 3, 6, 25_000);
    const r = startFacilityUpgrade(s, RESEARCH_FACILITY_KEY);
    expect(r.started).toBe(true);
    s = r.next;
    expect(s.credits.toNumber()).toBe(5_000);
    for (let t = 0; t < 240; t++) s = economyTick(s, 1, () => 0.5);
    expect(labTier(s)).toBe(3);
    expect(researchSlotCount(s)).toBe(3);
  });

  it("Fabricator 3 -> 4: the tier IV row (50,000 credits, FA 9), then the fourth craft slot", () => {
    expect(canBuildFacilityUpgrade(atLevels(2, 3, 8, 1e9), FABRICATOR_FACILITY_KEY)).toEqual({ ok: false, reason: "Requires Fleet Admiral level 9" });
    let s = startFacilityUpgrade(atLevels(2, 3, 9, 50_000), FABRICATOR_FACILITY_KEY).next;
    expect(s.credits.toNumber()).toBe(0);
    for (let t = 0; t < 420; t++) s = economyTick(s, 1, () => 0.5);
    expect(fabricatorTier(s)).toBe(4);
    expect(fabricateSlotCount(s)).toBe(4);
  });

  it("offline == live: one 420-tick call equals 420 one-tick calls across the rung build", () => {
    const start = startFacilityUpgrade(atLevels(2, 3, 9, 60_000), FABRICATOR_FACILITY_KEY).next;
    let live = start;
    for (let t = 0; t < 420; t++) live = economyTick(live, 1, () => 0.5);
    const offline = economyTick(start, 420, () => 0.5);
    expect(stateHash(offline)).toBe(stateHash(live));
  });
});

describe("OC-15: a tier N blueprint needs Lab N to research and Fabricator N to craft", () => {
  it("for every tier III to VII (a probe blueprint at that tier)", () => {
    const key = "oc15TierProbeBp";
    try {
      for (let tier = 3; tier <= LAB_FABRICATOR_TOP_TIER; tier++) {
        BLUEPRINTS[key] = { ...BLUEPRINTS.frameSegmentBp, key, tier };
        expect(blueprintResearchable(atLevels(tier - 1, tier), key), `research T${tier} at Lab ${tier - 1}`).toBe(false);
        expect(blueprintResearchable(atLevels(tier, tier), key), `research T${tier} at Lab ${tier}`).toBe(true);
        const below = { ...atLevels(tier, tier - 1), researchedBlueprints: [key] };
        const at = { ...atLevels(tier, tier), researchedBlueprints: [key] };
        expect(canFabricate(below, key), `craft T${tier} at Fabricator ${tier - 1}`).toEqual({ ok: false, reason: "tierLocked" });
        const r = canFabricate(at, key);
        expect(r.ok ? "ok" : r.reason, `craft T${tier} at Fabricator ${tier}`).not.toBe("tierLocked");
      }
    } finally {
      delete BLUEPRINTS[key];
    }
  });
});

describe("OC-15: the public tier readers", () => {
  it("labTier and fabricatorTier read the facility levels (1 on a fresh save, 0 when absent)", () => {
    expect(labTier(freshState())).toBe(1);
    expect(fabricatorTier(freshState())).toBe(1);
    const s = atLevels(5, 6);
    expect([labTier(s), fabricatorTier(s)]).toEqual([5, 6]);
    const bare = { ...freshState(), facilities: {} };
    expect([labTier(bare), fabricatorTier(bare)]).toEqual([0, 0]);
  });
});

describe("OC-15: the wiring registry", () => {
  it("each added rung is one LIVE entry on its slot probe (nine: Lab III to VII, Fabricator IV to VII)", () => {
    const rows = WIRING_REGISTRY.filter((e) => OC15_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}|${e.probe}`);
    expect(rows).toEqual([
      "facility:FACILITIES:research:2|live|researchSlots",
      "facility:FACILITIES:research:3|live|researchSlots",
      "facility:FACILITIES:research:4|live|researchSlots",
      "facility:FACILITIES:research:5|live|researchSlots",
      "facility:FACILITIES:research:6|live|researchSlots",
      "facility:FACILITIES:fabricator:3|live|fabricateSlots",
      "facility:FACILITIES:fabricator:4|live|fabricateSlots",
      "facility:FACILITIES:fabricator:5|live|fabricateSlots",
      "facility:FACILITIES:fabricator:6|live|fabricateSlots",
    ]);
  });
});

describe("OC-15: a level VII Lab and Fabricator run seven jobs each at once", () => {
  // Level VII on both tracks, rich, with every craft input for seven Frame Segments, seven research projects started
  // and seven crafts started (each through the real start seams); the eighth of each is refused for want of a slot.
  function sevenAndSeven(): GameState {
    let s = { ...atLevels(7, 7, 99, 1e9), researchedBlueprints: ["frameSegmentBp"] };
    s = { ...s, inventory: addItemQuality(s.inventory, "titaniumIngot", new Decimal(1_000), 0) };
    const projects = Object.keys(BLUEPRINTS).filter((k) => blueprintResearchable(s, k));
    expect(projects.length).toBeGreaterThan(7);
    for (const key of projects.slice(0, 7)) {
      const r = startResearch(s, key);
      expect(r.started, key).toBe(true);
      s = r.next;
    }
    expect(startResearch(s, projects[7]).reason).toBe("noSlot");
    for (let i = 0; i < 7; i++) {
      const r = startFabricateJob(s, "frameSegmentBp");
      expect(r.started, `craft ${i + 1}`).toBe(true);
      s = r.next;
    }
    expect(startFabricateJob(s, "frameSegmentBp").reason).toBe("noSlot");
    return s;
  }
  const inFlight = (s: GameState, kind: string) => s.activeProcesses.filter((p) => p.kind === kind).length;

  it("seven research projects and seven crafts are in flight together", () => {
    const s = sevenAndSeven();
    expect(inFlight(s, "researchProject")).toBe(7);
    expect(inFlight(s, "fabricateJob")).toBe(7);
  });

  // The game's offline entry is tick(): it steps economyTick(state, 1) per whole tick, so completions land in time
  // order whatever the span (a bare economyTick(state, 600) would resolve same-span completions in array order).
  it("offline == live with more than three of each in flight (one tick() call, 60 s chunks, one-second ticks)", () => {
    const start = sevenAndSeven();
    let live = start;
    for (let t = 1; t <= 600; t++) {
      live = tick(1, live, () => 0.5);
      if (t === 60) {
        expect(inFlight(live, "researchProject")).toBeGreaterThan(3);
        expect(inFlight(live, "fabricateJob")).toBeGreaterThan(3);
      }
    }
    const offline = tick(600, start, () => 0.5);
    let chunked = start;
    for (let c = 0; c < 10; c++) chunked = tick(60, chunked, () => 0.5);
    expect(stateHash(offline)).toBe(stateHash(live));
    expect(stateHash(chunked)).toBe(stateHash(live));
    // All seven crafts delivered (Frame Segment crafts in 120 ticks), so the run really went through completions.
    expect(inFlight(live, "fabricateJob")).toBe(0);
    expect(live.researchedBlueprints.length).toBeGreaterThan(start.researchedBlueprints.length);
  });
});
