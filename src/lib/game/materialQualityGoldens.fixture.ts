// ML-3 + ML-4 (0.14.0): the shared helpers of materialQualityGoldens.test.ts (the pre-change capture) and the slices'
// own tests. TEST-ONLY (imported by *.test.ts files only). The shapes follow ML-0 (materialLinesGoldens.test.ts).

import { expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type CaptainTalentBranch, type GameState, type MissionKey, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, economyTick, installMissingCombatBaselines, startLine, tick } from "./tick";
import { generateEquipment } from "./itemgen";
import { addItemQuality } from "./inventory";
import type { CraftLineMode } from "./allocation";
import { stateHash } from "./firstRunsGoldens.fixture";
import { MATERIAL_QUALITY_CURVE } from "./materialQuality";

// A seeded stream that also counts its draws (the shared-stream draw count neither slice may change).
export function countedLcg(seed: number): { rng: () => number; draws: () => number } {
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

export function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

// Stock by quality: { item: [q0, q1, ...] }.
export function withBuckets(s: GameState, stock: Record<string, number[]>): GameState {
  let inventory = s.inventory;
  for (const [id, buckets] of Object.entries(stock)) {
    buckets.forEach((n, q) => {
      if (n > 0) inventory = addItemQuality(inventory, id, new Decimal(n), q);
    });
  }
  return { ...s, inventory };
}

export function craftStateQ(stock: Record<string, number[]>, researched: string[]): GameState {
  const base = withBuckets(freshState(), stock);
  return {
    ...base,
    facilities: { ...base.facilities, refinery: { level: 1 }, fabricator: { level: 1 } },
    researchedBlueprints: researched,
  };
}

export function lineQ(s: GameState, kind: "refine" | "fabricate", key: string, mode: CraftLineMode): GameState {
  const r = startLine(s, kind, key, mode);
  if (!r.started) throw new Error(`${kind} ${key} refused: ${r.reason}`);
  return r.next;
}

// Steps economyTick(_, 1) n times off one counted stream; `each` may rewrite the state after every tick.
export function steppedQ(s0: GameState, n: number, seed: number, each?: (s: GameState) => GameState): { state: GameState; draws: number } {
  const r = countedLcg(seed);
  let s = s0;
  for (let i = 0; i < n; i++) {
    s = economyTick(s, 1, r.rng);
    if (each) s = each(s);
  }
  return { state: s, draws: r.draws() };
}

export const RUN_TICKS = 600;

// One run both ways off the same seed: stepped live (economyTick(_, 1) per tick) and one offline tick() span.
export function bothWays(s0: GameState, seed: number): { hash: string; draws: number; offlineHash: string; offlineDraws: number; live: GameState } {
  const live = countedLcg(seed);
  let s = s0;
  for (let i = 0; i < RUN_TICKS; i++) s = economyTick(s, 1, live.rng);
  const off = countedLcg(seed);
  const o = tick(RUN_TICKS * s0.tickDurationSeconds, s0, off.rng);
  return { hash: stateHash(s), draws: live.draws(), offlineHash: stateHash(o), offlineDraws: off.draws(), live: s };
}

export function levelled(s: GameState, level: number, spec: CaptainTalentBranch | null = null): GameState {
  return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level, spec })) };
}

export function onHull(s: GameState, typeKey: ShipTypeKey): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)) };
}

// A Prospector Miner on ship-1 with a crafted Refinery-Feed Rig (rolled materialQualityChance > 0) installed, captain 1
// owning the given secondary nodes.
export function rigFleet(secondary: string[] = []): GameState {
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
  return {
    ...base,
    captains: base.captains.map((c) =>
      c.id === 1 ? { ...c, unlockedSecondaryTalents: [...c.unlockedSecondaryTalents, ...secondary] as typeof c.unlockedSecondaryTalents } : c,
    ),
    equipment: base.equipment.map((e) => (e.slotType === "specUtility" && e.fittedToShipId === "ship-1" ? { ...rig, fittedToShipId: "ship-1" } : e)),
  };
}

// A rig fleet's run on `mission`, both ways (offline must equal live, draw for draw): "<hash>:<draws>".
export function rigRun(s: GameState, mission: MissionKey, seed: number): string {
  const r = dispatchCaptainOnMission(s, 1, mission);
  expect(r.success, mission).toBe(true);
  const run = bothWays(r.next, seed);
  expect(run.offlineHash, mission).toBe(run.hash);
  expect(run.offlineDraws, mission).toBe(run.draws);
  return `${run.hash}:${run.draws}`;
}

// Removes any carried quality a job was stamped with (the pre-ML-4 job shape).
export function stripCarry(s: GameState): GameState {
  if (!s.activeProcesses.some((p) => "inputQuality" in p.effect)) return s;
  return {
    ...s,
    activeProcesses: s.activeProcesses.map((p) => {
      if (!("inputQuality" in p.effect)) return p;
      const { inputQuality: _drop, ...effect } = p.effect as typeof p.effect & { inputQuality?: number };
      return { ...p, effect: effect as typeof p.effect };
    }),
  };
}

// ML-3's "turn it off" switch: the climb chance curve at 0 points per point for one call (restored after), so a run
// inside it is the pre-ML-3 run exactly (no climb, no private roll, no counter written).
export function withMaterialQualityOff<T>(run: () => T): T {
  const saved = MATERIAL_QUALITY_CURVE.perPoint;
  try {
    MATERIAL_QUALITY_CURVE.perPoint = 0;
    return run();
  } finally {
    MATERIAL_QUALITY_CURVE.perPoint = saved;
  }
}

// ===== the wiring registry (the golden files that pin it: shortRangeGoldens, emodGoldens) =====

// ML-3's whole registry move: the rig line's entry flips pending -> live with the mission:extraction context (its
// probe, missionOreQuality, it already named). Nothing else moved.
export const ML3_FLIPPED_LIVE: ReadonlySet<string> = new Set(["ship:gearLine:materialQualityChance"]);
const ML3_BEFORE = {
  status: { kind: "pending", owner: "WR-7, OC-D2 (rolls on every Prospecting Rig, read by nothing)", contexts: ["mission:extraction"] },
  contexts: [] as string[],
};

// Registry snapshot rows ([id, status, contexts, probe], registry order) with ML-3 read back. Every pin taken before
// ML-3 reads through it.
export function ml3RowsBack(rows: readonly (readonly unknown[])[]): unknown[][] {
  return rows.map((r) => (ML3_FLIPPED_LIVE.has(r[0] as string) ? [r[0], ML3_BEFORE.status, ML3_BEFORE.contexts, r[3]] : [...r]));
}

export const MIXED_ORE = { commonOre: [30, 30, 40] };
export const MIXED_INGOT = { titaniumIngot: [4, 0, 0, 16] };
