// ML-0 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 "Material Lines (ML)"): golden
// hashes captured on the code BEFORE any Material Lines change (the CP-0 / WR-4 / GG-0 pattern). Every later ML slice
// keeps these green in the same commit, or re-pins one ONLY where its commit names the move, why, and the proof that
// zeroing the new effect reproduces the old hash.
//
//   missions : the Local Asteroid, Lunar Mine, Salvage, Forage and both Survey runs, each stepped economyTick(_, 1)
//              600 times AND as one offline tick() span, off the same seeded stream: the whole state, plus the number
//              of draws the run took from the SHARED injected rng (ML-3's rule: never a new draw on that stream).
//              Stepped and offline must agree (offline == live), so each run pins one hash and one count.
//   refine   : a batch refine line (Titanium Ore into Titanium Ingot) through completion.
//   fabricate: a batch material fabricate line (Frame Segment) through completion.
//   inspect  : an equipment fabricate line (Yield Rig) through completion, then the blank inspected.
//   rig      : a Prospector Miner with a crafted Refinery-Feed Rig installed (rolled materialQualityChance > 0) on the
//              Local Asteroid run: its deliveries (the seam ML-3 turns on).
//   census   : the item catalog by category, the Refinery recipe count and the blueprint count (ML-1 moves this one,
//              by design: it adds items and recipes).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  ITEMS,
  REFINE_RECIPES,
  freshState,
  type CaptainTalentBranch,
  type GameState,
  type MissionKey,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, economyTick, inspectBlank, installMissingCombatBaselines, startLine, tick } from "./tick";
import { generateEquipment } from "./itemgen";
import { addItemQuality } from "./inventory";
import type { CraftLineMode } from "./allocation";

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const hash = (v: unknown): string => fnv(JSON.stringify(v));

// A seeded stream that also counts its draws (the shared-stream draw count ML-3 must keep identical).
function countedLcg(seed: number): { rng: () => number; draws: () => number } {
  let s = seed >>> 0;
  let n = 0;
  return {
    rng: () => {
      n += 1;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    },
    draws: () => n,
  };
}

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

function levelled(s: GameState, level: number, spec: CaptainTalentBranch | null = null): GameState {
  return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level, spec })) };
}

function onHull(s: GameState, typeKey: ShipTypeKey): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)) };
}

function withStock(s: GameState, stock: Record<string, number>): GameState {
  let inventory = s.inventory;
  for (const [id, n] of Object.entries(stock)) inventory = addItemQuality(inventory, id, new Decimal(n), 0);
  return { ...s, inventory };
}

const RUN_TICKS = 600;

// One run both ways off the same seed: stepped live (economyTick(_, 1) per tick) and one offline tick() span.
function bothWays(s0: GameState, seed: number): { hash: string; draws: number; offlineHash: string; offlineDraws: number } {
  const live = countedLcg(seed);
  let s = s0;
  for (let i = 0; i < RUN_TICKS; i++) s = economyTick(s, 1, live.rng);
  const off = countedLcg(seed);
  const o = tick(RUN_TICKS * s0.tickDurationSeconds, s0, off.rng);
  return { hash: hash(s), draws: live.draws(), offlineHash: hash(o), offlineDraws: off.draws() };
}

function stepped(s0: GameState, n: number, seed: number): { state: GameState; draws: number } {
  const r = countedLcg(seed);
  let s = s0;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, r.rng);
  return { state: s, draws: r.draws() };
}

function craftState(stock: Record<string, number>, researched: string[]): GameState {
  const base = withStock(freshState(), stock);
  return {
    ...base,
    facilities: { ...base.facilities, refinery: { level: 1 }, fabricator: { level: 1 } },
    researchedBlueprints: researched,
  };
}

function line(s: GameState, kind: "refine" | "fabricate", key: string, mode: CraftLineMode): GameState {
  const r = startLine(s, kind, key, mode);
  if (!r.started) throw new Error(`${kind} ${key} refused: ${r.reason}`);
  return r.next;
}

// ===== the goldens =====

const MISSION_RUNS: MissionKey[] = ["shortOreRun", "longOreRun", "salvageWreckage", "forageFlora", "surveyMineralAnomaly", "surveyStellarPhenomena"];

const GOLDEN = {
  missions: [
    "shortOreRun:b175c031:1088",
    "longOreRun:66f5902e:696",
    "salvageWreckage:45be2a46:815",
    "forageFlora:5dfca341:814",
    "surveyMineralAnomaly:1b6f9221:542",
    "surveyStellarPhenomena:bb65b1f4:539",
  ],
  refine: "fd293beb:3",
  fabricate: "42704bb2:2",
  inspect: ["9c3d1516:0", "3dea091e", "d3741ac8"],
  rig: "39a58762:1097",
  census: {
    "items.raw": 14,
    "items.salvagedMaterial": 2,
    "items.refined": 5,
    "items.minorComponent": 3,
    "items.majorComponent": 1,
    "items.fieldKit": 6,
    refineRecipes: 4,
    blueprints: 78,
  } as Record<string, number>,
};

describe("ML-0 Material Lines pre-change goldens", () => {
  it("missions: every gathering run, stepped and offline, with its shared-stream draw count", () => {
    const out = MISSION_RUNS.map((k, i) => {
      const r = dispatchCaptainOnMission(levelled(freshState(), 10), 1, k);
      expect(r.success, k).toBe(true);
      const run = bothWays(r.next, 0x3a1 + i * 2);
      // offline == live, bucket for bucket and draw for draw
      expect(run.offlineHash, k).toBe(run.hash);
      expect(run.offlineDraws, k).toBe(run.draws);
      expect(run.draws, k).toBeGreaterThan(0);
      return `${k}:${run.hash}:${run.draws}`;
    });
    expect(out).toEqual(GOLDEN.missions);
  });

  it("refine: a batch Titanium Ingot line through completion", () => {
    const s0 = line(craftState({ commonOre: 100 }, []), "refine", "refineCommonOre", { kind: "batch", remaining: 3 });
    const { state, draws } = stepped(s0, 60, 0x2e1);
    expect(state.refineLines).toHaveLength(0);
    expect(state.inventory.titaniumIngot).toBeDefined();
    expect(`${hash(state)}:${draws}`).toEqual(GOLDEN.refine);
  });

  it("fabricate: a batch Frame Segment line through completion", () => {
    const s0 = line(craftState({ titaniumIngot: 20 }, ["frameSegmentBp"]), "fabricate", "frameSegmentBp", { kind: "batch", remaining: 2 });
    const { state, draws } = stepped(s0, 300, 0xfab);
    expect(state.fabricateLines).toHaveLength(0);
    expect(state.inventory.frameSegment).toBeDefined();
    expect(`${hash(state)}:${draws}`).toEqual(GOLDEN.fabricate);
  });

  it("inspect: a Yield Rig crafted to a blank, then inspected", () => {
    const s0 = line(craftState({ frameSegment: 4, polysilicateWafer: 4 }, ["yieldRigBp"]), "fabricate", "yieldRigBp", { kind: "batch", remaining: 1 });
    const { state, draws } = stepped(s0, 200, 0x1a5);
    expect(state.blanks.yieldRigBp?.toString()).toBe("1");
    const inspected = inspectBlank(state, "yieldRigBp");
    expect(inspected).not.toBe(state);
    expect([`${hash(state)}:${draws}`, hash(inspected.equipment), hash(inspected)]).toEqual(GOLDEN.inspect);
  });

  it("rig: a Prospector Miner with a Refinery-Feed Rig on the Local Asteroid run", () => {
    const base = installMissingCombatBaselines(onHull(levelled(freshState(), 10, "resourcefulness"), "prospectorMiner"));
    const rig = generateEquipment({
      slotType: "specUtility",
      varietyKey: "refineryFeedRig",
      blueprintKey: "refineryFeedRigBp",
      iLevel: 30,
      quality: 2,
      rarity: "augmented",
      ascension: "none",
      rng: seededRng(0x919),
      allocateId: () => "rig-1",
    });
    expect(rig.rolledStats.materialQualityChance ?? rig.implicitStats.materialQualityChance ?? 0).toBeGreaterThan(0);
    const s1: GameState = {
      ...base,
      equipment: base.equipment.map((e) => (e.slotType === "specUtility" && e.fittedToShipId === "ship-1" ? { ...rig, fittedToShipId: "ship-1" } : e)),
    };
    const r = dispatchCaptainOnMission(s1, 1, "shortOreRun");
    expect(r.success).toBe(true);
    const run = bothWays(r.next, 0x7e9);
    expect(run.offlineHash).toBe(run.hash);
    expect(run.offlineDraws).toBe(run.draws);
    expect(`${run.hash}:${run.draws}`).toEqual(GOLDEN.rig);
  });

  it("census: the item catalog by category, the Refinery recipes and the blueprints", () => {
    const census: Record<string, number> = {};
    for (const d of Object.values(ITEMS)) census[`items.${d.category}`] = (census[`items.${d.category}`] ?? 0) + 1;
    census.refineRecipes = Object.keys(REFINE_RECIPES).length;
    census.blueprints = Object.keys(BLUEPRINTS).length;
    expect(census).toEqual(GOLDEN.census);
  });
});
