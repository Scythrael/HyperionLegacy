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
import { canFabricate, canStartLine } from "./tick";
import {
  freshState,
  generateStandardIssue,
  equipmentStorageCap,
  spareEquipmentCount,
  equipmentAtCap,
  EQUIPMENT_STORAGE_CAP_BASE,
  type GameState,
  type EquipmentInstance,
  type EquipmentSlotType,
} from "./model";
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
