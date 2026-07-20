// ============================================================================
// Equipment storage cap (spare systems only), 0.11.0 Storage/Salvage Task B1.
// (docs/plans/2026-07-18-storage-salvage-0.11.0-design.md §1;
//  docs/plans/2026-07-18-0.11.0-completion-plan.md Task B1.)
//
// state.equipment is otherwise UNBOUNDED. This suite covers the CAP on SPARE
// (unfitted, crafted) systems, modeled on the material-warehouse storage cap:
//   (1) equipmentStorageCap is the base (25) at level 0 (STUB rung table empty);
//   (2) spareEquipmentCount counts ONLY unfitted CRAFTED systems (a fitted
//       crafted system, a spare Standard-Issue baseline, and a fitted baseline
//       are all excluded);
//   (3) starting an EQUIPMENT fabricate at cap is blocked with a clear reason
//       (equipmentStorageFull), below cap it proceeds, and a NON-equipment job is
//       never blocked by this seam, checked on BOTH fabricate gates
//       (canFabricate and canStartLine).
//
// SOFTLOCK-RELIEF NOTE: the design guarantees a full store is never a dead end,
// because SALVAGE (Task C1) always frees a spare slot and the storage UPGRADE
// (Task B2) raises the cap. Neither exists yet, so the "salvage always works at
// cap" softlock-guard test belongs to Task C1 (salvage) / Task B2 (upgrade), not
// here. This suite only proves the cap BLOCKS and the exclusions are exact.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  canFabricate,
  canStartLine,
  canUpgradeEquipmentStorage,
  startEquipmentStorageUpgrade,
  resolveProcesses,
} from "./tick";
import {
  freshState,
  generateStandardIssue,
  equipmentStorageCap,
  spareEquipmentCount,
  equipmentAtCap,
  EQUIPMENT_STORAGE_CAP_BASE,
  EQUIPMENT_STORAGE_RUNGS,
  type GameState,
  type EquipmentInstance,
  type EquipmentSlotType,
} from "./model";
import { serialize, deserialize, migrate } from "./save";
import Decimal from "break_infinity.js";

// A tier-1 EQUIPMENT blueprint whose output is a system (equipmentOutput present),
// so starting it mints a SPARE crafted system into the capped pool. Its recipe
// inputs are supplied amply in the fixtures so only the cap gate can fail.
const EQUIP_BP = "balancedDriveBp";
const EQUIP_BP_INPUTS: Record<string, number> = { powerCoupling: 10, polysilicateWafer: 10, titaniumIngot: 10 };

// Build ONE EquipmentInstance with a chosen fitment + crafted/baseline nature, by
// starting from a real Standard-Issue baseline (so every other field is valid) and
// overriding ONLY the two fields the spare-count predicate reads: fittedToShipId
// (null = spare) and blueprintKey (non-null = crafted; null = Standard-Issue baseline).
function makePiece(opts: {
  slotType: EquipmentSlotType;
  fitted: boolean;
  crafted: boolean;
  id: string;
}): EquipmentInstance {
  const base = generateStandardIssue({
    slotType: opts.slotType,
    fittedToShipId: opts.fitted ? "ship-1" : null,
    allocateId: () => opts.id,
  });
  return {
    ...base,
    fittedToShipId: opts.fitted ? "ship-1" : null,
    blueprintKey: opts.crafted ? EQUIP_BP : null,
  };
}

// N SPARE CRAFTED systems (the only thing that counts toward the cap), so a fixture
// can push the pool to/over the cap. Ids are unique so instances are distinct.
function spareCraftedPieces(n: number): EquipmentInstance[] {
  const out: EquipmentInstance[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makePiece({ slotType: "cargoBay", fitted: false, crafted: true, id: `spare-${i}` }));
  }
  return out;
}

// A fresh state with the equipment blueprint researched, inputs stocked amply, and a
// caller-supplied equipment pool, so the fabricate gates reach the equipment-cap check
// (research/tier/slot/materials all pass first). Mirrors fabricator.test.ts's fabState.
function equipState(opts: { equipment?: EquipmentInstance[] } = {}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  for (const itemId of Object.keys(EQUIP_BP_INPUTS)) {
    inventory[itemId] = [new Decimal(EQUIP_BP_INPUTS[itemId])];
  }
  return {
    ...s,
    inventory,
    // The equipment blueprint must be researched so the fabricate gates pass ownership.
    researchedBlueprints: [EQUIP_BP],
    // Replace the pool if the test supplies one (freshState seeds ship-1's four fitted
    // baselines, which count as 0 spare-crafted, so the default is a clean 0).
    equipment: opts.equipment ?? s.equipment,
  };
}

describe("equipmentStorageCap: derived cap, base at level 0 (Task B1)", () => {
  it("returns EQUIPMENT_STORAGE_CAP_BASE at level 0 (STUB rung table empty, so the base IS the cap)", () => {
    const s = freshState();
    expect(s.equipmentStorageLevel).toBe(0); // freshState seeds level 0
    expect(equipmentStorageCap(s)).toBe(EQUIPMENT_STORAGE_CAP_BASE);
    expect(EQUIPMENT_STORAGE_CAP_BASE).toBe(25); // the tunable first-pass value
  });
});

describe("spareEquipmentCount: counts ONLY unfitted crafted systems (Task B1)", () => {
  it("excludes a fitted crafted system, a spare baseline, and a fitted baseline; counts only the spare crafted", () => {
    const pool: EquipmentInstance[] = [
      makePiece({ slotType: "cargoBay", fitted: false, crafted: true, id: "a" }), // COUNTS: spare + crafted
      makePiece({ slotType: "ftlDrive", fitted: true, crafted: true, id: "b" }), // excluded: fitted
      makePiece({ slotType: "reactorCore", fitted: false, crafted: false, id: "c" }), // excluded: baseline (blueprintKey null)
      makePiece({ slotType: "specUtility", fitted: true, crafted: false, id: "d" }), // excluded: fitted baseline
    ];
    const s: GameState = { ...freshState(), equipment: pool };
    expect(spareEquipmentCount(s)).toBe(1);
  });

  it("equipmentAtCap is true at/over the cap and false below it", () => {
    const cap = EQUIPMENT_STORAGE_CAP_BASE;
    const below: GameState = { ...freshState(), equipment: spareCraftedPieces(cap - 1) };
    const at: GameState = { ...freshState(), equipment: spareCraftedPieces(cap) };
    const over: GameState = { ...freshState(), equipment: spareCraftedPieces(cap + 3) };
    expect(equipmentAtCap(below)).toBe(false);
    expect(equipmentAtCap(at)).toBe(true); // AT the cap counts as full (>=), mirrors materialAtCap
    expect(equipmentAtCap(over)).toBe(true);
  });
});

describe("fabricate gates enforce the equipment storage cap (Task B1)", () => {
  it("canFabricate: blocks an equipment craft at cap with equipmentStorageFull; below cap it proceeds", () => {
    const atCap = equipState({ equipment: spareCraftedPieces(EQUIPMENT_STORAGE_CAP_BASE) });
    expect(canFabricate(atCap, EQUIP_BP)).toEqual({ ok: false, reason: "equipmentStorageFull" });

    const belowCap = equipState({ equipment: spareCraftedPieces(EQUIPMENT_STORAGE_CAP_BASE - 1) });
    expect(canFabricate(belowCap, EQUIP_BP)).toEqual({ ok: true });
  });

  it("canStartLine: blocks an equipment fabricate line at cap with equipmentStorageFull; below cap it proceeds", () => {
    const atCap = equipState({ equipment: spareCraftedPieces(EQUIPMENT_STORAGE_CAP_BASE) });
    expect(canStartLine(atCap, "fabricate", EQUIP_BP, 1)).toEqual({ ok: false, reason: "equipmentStorageFull" });

    const belowCap = equipState({ equipment: spareCraftedPieces(EQUIPMENT_STORAGE_CAP_BASE - 1) });
    expect(canStartLine(belowCap, "fabricate", EQUIP_BP, 1)).toEqual({ ok: true });
  });

  it("a NON-equipment fabricate is NEVER blocked by the equipment cap (even with the pool full)", () => {
    // frameSegmentBp is a MATERIAL blueprint (no equipmentOutput). With the equipment pool
    // FULL of spare crafted systems, its own gates (research + material cap) still decide it;
    // the equipment-cap seam must not touch it. Stock its input, keep its output low.
    const s0 = equipState({ equipment: spareCraftedPieces(EQUIPMENT_STORAGE_CAP_BASE + 5) });
    const s: GameState = {
      ...s0,
      inventory: { ...s0.inventory, titaniumIngot: [new Decimal(100)], frameSegment: [new Decimal(0)] },
      researchedBlueprints: [EQUIP_BP, "frameSegmentBp"],
    };
    expect(canFabricate(s, "frameSegmentBp")).toEqual({ ok: true });
    expect(canStartLine(s, "fabricate", "frameSegmentBp", 1)).toEqual({ ok: true });
  });
});

// ============================================================================
// Task B2: the storage cap is UPGRADABLE (rungs + the timed purchase mechanism).
// (docs/plans/2026-07-18-0.11.0-completion-plan.md Task B2.)
//
// B1 shipped an EMPTY rung table (base 25 at every level). B2 filled it with a rung
// table and the upgrade action: a TIMED process (mirroring the material-warehouse cap
// upgrade) that spends the rung's materials at start and bumps equipmentStorageLevel by
// one at completion, so equipmentStorageCap derives a higher cap on read. The device-test
// rework then switched the cap from DOUBLING to a flat +25 slots per rung (a linear
// 25 -> 50 -> 75 ... ladder). These tests cover: (1) each REACHED rung ADDS its flat
// increment to the base cap; (2) the action spends + queues when affordable, resolves to a level bump + a
// higher cap, is a no-op when unaffordable, is sequential (one in flight), and cannot
// exceed the max rung; (3) a save at an upgraded level round-trips to the raised cap.
// ============================================================================

// The FULL cost of the NEXT rung for a state at `level`, as a plain-number map, so a
// fixture can stock EXACTLY (or one short of) what the upgrade needs. Reads the real
// rung table so the test tracks any retune of the first-pass costs automatically.
function rungCostAt(level: number): Record<string, number> {
  const rung = EQUIPMENT_STORAGE_RUNGS[level];
  const out: Record<string, number> = {};
  for (const itemId of Object.keys(rung.materials)) {
    out[itemId] = rung.materials[itemId].toNumber();
  }
  return out;
}

// A fresh state stocked with the given per-item amounts (quality-0 buckets), everything
// else default. Used to make the NEXT storage upgrade exactly affordable / unaffordable.
function stockedState(stock: Record<string, number>): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  for (const itemId of Object.keys(stock)) {
    inventory[itemId] = [new Decimal(stock[itemId])];
  }
  return { ...s, inventory };
}

describe("equipmentStorageCap: each reached rung adds its flat increment to the base cap (Task B2)", () => {
  it("climbs base -> base+inc0 -> base+inc0+inc1 ... as the level rises, and never past the max rung", () => {
    // Expected cap at a level = base plus one slotIncrement per REACHED rung (index < level),
    // the SAME reached-rungs SUM equipmentStorageCap itself runs. Built independently here
    // from the rung table so it verifies the helper, not just restates it.
    const expectedCapAt = (level: number): number => {
      let cap = EQUIPMENT_STORAGE_CAP_BASE;
      for (let i = 0; i < level && i < EQUIPMENT_STORAGE_RUNGS.length; i++) {
        cap += EQUIPMENT_STORAGE_RUNGS[i].slotIncrement;
      }
      return cap;
    };

    // Level 0 is the base (mirrors the material-cap "base at level 0" test).
    expect(equipmentStorageCap({ ...freshState(), equipmentStorageLevel: 0 })).toBe(EQUIPMENT_STORAGE_CAP_BASE);

    // Every reachable level climbs by exactly its rung's flat increment.
    for (let level = 1; level <= EQUIPMENT_STORAGE_RUNGS.length; level++) {
      const s: GameState = { ...freshState(), equipmentStorageLevel: level };
      expect(equipmentStorageCap(s)).toBe(expectedCapAt(level));
      // Sanity: the cap strictly rose from the previous level (every rung adds a positive increment).
      expect(equipmentStorageCap(s)).toBeGreaterThan(equipmentStorageCap({ ...freshState(), equipmentStorageLevel: level - 1 }));
    }

    // First-pass shape guard: the shipped track adds +25 per rung, 25 -> 50 -> 75 ... -> 200
    // (base + 7 rungs of +25).
    expect(EQUIPMENT_STORAGE_RUNGS.length).toBe(7);
    expect(EQUIPMENT_STORAGE_RUNGS.every((rung) => rung.slotIncrement === 25)).toBe(true);
    expect(equipmentStorageCap({ ...freshState(), equipmentStorageLevel: 7 })).toBe(200);

    // Over-max level cannot read past the finite track (guarded loop): cap stays at the max.
    expect(equipmentStorageCap({ ...freshState(), equipmentStorageLevel: 99 })).toBe(200);
  });
});

describe("startEquipmentStorageUpgrade: timed purchase raises the level + cap (Task B2)", () => {
  it("when affordable, spends the rung materials at start, queues the timed process, and resolves to level+1 with a higher cap", () => {
    const cost = rungCostAt(0); // { titaniumIngot, commonOre } for rung 0
    const s = stockedState(cost);
    expect(canUpgradeEquipmentStorage(s)).toEqual({ ok: true });
    expect(equipmentStorageCap(s)).toBe(EQUIPMENT_STORAGE_CAP_BASE); // level 0 before

    const started = startEquipmentStorageUpgrade(s);
    expect(started.started).toBe(true);
    // Materials deducted ATOMICALLY at start (spent from the stocked buckets to 0).
    for (const itemId of Object.keys(cost)) {
      expect(started.next.inventory[itemId]?.[0]?.toNumber() ?? 0).toBe(0);
    }
    // One equipmentStorageUpgrade process queued; the level has NOT bumped yet (bumps at completion).
    const proc = started.next.activeProcesses.find((p) => p.kind === "equipmentStorageUpgrade");
    expect(proc).toBeTruthy();
    expect(proc!.effect.type).toBe("equipmentStorageLevelUp");
    expect(proc!.durationTicks).toBe(EQUIPMENT_STORAGE_RUNGS[0].durationTicks);
    expect(started.next.equipmentStorageLevel).toBe(0);
    expect(equipmentStorageCap(started.next)).toBe(EQUIPMENT_STORAGE_CAP_BASE);

    // Resolve to completion: the level bumps 0 -> 1 and the cap climbs by the rung-0 increment.
    const resolved = resolveProcesses(started.next, EQUIPMENT_STORAGE_RUNGS[0].durationTicks);
    expect(resolved.next.equipmentStorageLevel).toBe(1);
    expect(equipmentStorageCap(resolved.next)).toBe(EQUIPMENT_STORAGE_CAP_BASE + EQUIPMENT_STORAGE_RUNGS[0].slotIncrement);
    // No storage-upgrade process left in flight after completion.
    expect(resolved.next.activeProcesses.some((p) => p.kind === "equipmentStorageUpgrade")).toBe(false);
  });

  it("blocks (same-ref no-op) when the materials are unaffordable, with a clear reason", () => {
    const cost = rungCostAt(0);
    // Stock ONE short on the first material so the affordability gate fails.
    const firstItem = Object.keys(cost)[0];
    const shortStock = { ...cost, [firstItem]: cost[firstItem] - 1 };
    const s = stockedState(shortStock);

    const check = canUpgradeEquipmentStorage(s);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("Need");

    const started = startEquipmentStorageUpgrade(s);
    expect(started.started).toBe(false);
    expect(started.next).toBe(s); // same reference (no-op), matching startProcess's reject convention
  });

  it("is SEQUENTIAL: with an upgrade already in flight, a second is refused (guards the rung-skip exploit)", () => {
    // Stock DOUBLE rung-0's cost so affordability alone would allow a second start; the
    // in-flight gate (not affordability) must be what refuses it.
    const cost = rungCostAt(0);
    const doubled: Record<string, number> = {};
    for (const itemId of Object.keys(cost)) doubled[itemId] = cost[itemId] * 2;
    const s = stockedState(doubled);

    const first = startEquipmentStorageUpgrade(s);
    expect(first.started).toBe(true);

    expect(canUpgradeEquipmentStorage(first.next)).toEqual({ ok: false, reason: "Upgrade already in progress" });
    const second = startEquipmentStorageUpgrade(first.next);
    expect(second.started).toBe(false);
    expect(second.next).toBe(first.next);
  });

  it("cannot exceed the max rung: at the top level the action is a no-op with a fully-upgraded reason", () => {
    const maxLevel = EQUIPMENT_STORAGE_RUNGS.length;
    // Stock plenty of everything the rungs ever cost, so ONLY the maxed gate can refuse.
    const s: GameState = { ...stockedState({ titaniumIngot: 100000, commonOre: 1000000 }), equipmentStorageLevel: maxLevel };
    expect(canUpgradeEquipmentStorage(s)).toEqual({ ok: false, reason: "Equipment storage is fully upgraded" });
    const started = startEquipmentStorageUpgrade(s);
    expect(started.started).toBe(false);
    expect(started.next).toBe(s);
  });
});

describe("equipment storage level round-trips through serialize/migrate (Task B2)", () => {
  it("a save at an upgraded level loads back to the SAME level and the raised cap", () => {
    const upgraded: GameState = { ...freshState(), equipmentStorageLevel: 2 };
    const expectedCap = equipmentStorageCap(upgraded); // 25 + 25 + 25 = 75

    const raw = serialize(upgraded, Date.now());
    const save = deserialize(raw);
    expect(save).not.toBeNull();
    const loaded = migrate(save!);

    expect(loaded.equipmentStorageLevel).toBe(2);
    expect(equipmentStorageCap(loaded)).toBe(expectedCap);
    expect(expectedCap).toBe(75); // first-pass shape guard (linear +25 track)
  });
});
