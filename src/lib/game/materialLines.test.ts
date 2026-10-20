// ML-1 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 "Material Lines (ML)"): the seven
// July-approved refined goods and their seven Refinery recipes (user 2026-10-19, L1 "Build as named"), the typed
// reserve marker, and the standing rules the plan asks of them:
//   - each new recipe consumes exactly its inputs and grants exactly its output through the real line engine
//   - a compound deducts EVERY input at job start and refuses when ANY one is short
//   - the allocation model reserves every input of a running line
//   - every raw, salvaged, refined and component item has a consumer, or a typed reserve naming the slice that wires
//     one (never both), and every reserved item is really produced today
//   - every refined input of a refine recipe or blueprint is producible; every raw input has a live mission source

import { describe, expect, it } from "vitest";
import {
  BLUEPRINTS,
  FACILITIES,
  EQUIPMENT_STORAGE_RUNGS,
  ITEMS,
  MISSIONS,
  REFINE_RECIPES,
  SALVAGE_LOOT_POOLS,
  SHIP_DOCKS_RUNGS,
  SHIP_TYPES,
  TRANSIT_BERTH_RUNGS,
  freshState,
  type GameState,
  type ItemCategory,
} from "./model";
import { canStartLine, economyTick, processRefineLines, startLine } from "./tick";
import { addItemQuality, itemTotal } from "./inventory";
import { allocatedItem } from "./allocation";
import { WIRING_REGISTRY } from "./wiring/registry";

// The seven recipes as the user approved them (July section 12 / E-MAT 3b): key -> inputs and output.
const ML1_RECIPES: Record<string, { inputs: string[]; output: string }> = {
  refineFerriteIngot: { inputs: ["ferriteOre"], output: "ferriteIngot" },
  refineReclaimedCircuit: { inputs: ["salvagedCircuitry"], output: "reclaimedCircuit" },
  refineIridiumCatalyst: { inputs: ["rareMaterial"], output: "iridiumCatalyst" },
  synthCobaltCoil: { inputs: ["cobaltOre", "titaniumIngot"], output: "cobaltCoil" },
  synthOsmiumPlate: { inputs: ["osmiumOre", "ferriteIngot"], output: "osmiumPlate" },
  synthPhotonicGel: { inputs: ["polysilicateWafer", "volatileResin"], output: "photonicGel" },
  synthBiocatalyst: { inputs: ["purifiedBiomass", "exoticSporeCluster"], output: "biocatalyst" },
};

const ML1_ITEMS: Record<string, string> = {
  ferriteIngot: "Ferrite Ingot",
  reclaimedCircuit: "Reclaimed Circuit",
  iridiumCatalyst: "Iridium Catalyst",
  cobaltCoil: "Cobalt Coil",
  osmiumPlate: "Osmium Plate",
  photonicGel: "Photonic Gel",
  biocatalyst: "Biocatalyst",
};

const COMPOUNDS = Object.keys(ML1_RECIPES).filter((k) => ML1_RECIPES[k].inputs.length > 1);

// A Refinery at level 1 (one slot) holding exactly `iterations` of a recipe's inputs (one unit fewer of `short`).
function stocked(recipeKey: string, iterations: number, short?: string): GameState {
  const s = freshState();
  let inventory = s.inventory;
  for (const [id, amount] of Object.entries(REFINE_RECIPES[recipeKey].input)) {
    const n = amount.times(iterations).minus(id === short ? 1 : 0);
    if (n.gt(0)) inventory = addItemQuality(inventory, id, n, 0);
  }
  return { ...s, inventory, facilities: { ...s.facilities, refinery: { level: 1 } } };
}

describe("ML-1 items: the seven July-approved refined goods, as named", () => {
  it("each exists as a tier 1 refined item with its approved label, an honest Refinery hint and flavor", () => {
    for (const [id, label] of Object.entries(ML1_ITEMS)) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.label, id).toBe(label);
      expect(def.category, id).toBe("refined");
      expect(def.tier, id).toBe(1);
      expect(def.unlockHint, id).toContain("at the Refinery");
      expect(def.flavor.length, id).toBeGreaterThan(0);
      expect(def.sellValue, id).toBeUndefined();
    }
  });

  it("is not seeded into a fresh save (each reveals on its first refine)", () => {
    const fresh = freshState();
    for (const id of Object.keys(ML1_ITEMS)) {
      expect(Object.keys(fresh.inventory), id).not.toContain(id);
      expect(fresh.discovered, id).not.toContain(id);
    }
  });

  it("L11: Reclaimed Alloy is retagged uncommon", () => {
    expect(ITEMS.reclaimedAlloy.rarity).toBe("uncommon");
  });

  it("the stale hints are gone: no Fuel Depot cooking, no 'coming mechanic'", () => {
    expect(ITEMS.deuteriumIce.unlockHint + ITEMS.deuteriumIce.flavor).not.toMatch(/Fuel Depot/);
    expect(ITEMS.intactReactorCore.unlockHint).not.toMatch(/coming mechanic/);
    expect(Object.keys(SALVAGE_LOOT_POOLS)).toContain("intactReactorCore"); // the hint's "salvage it" is real
  });
});

describe("ML-1 recipes: the seven Refinery recipes, as named", () => {
  it("each recipe takes exactly its approved inputs (positive, whole) and makes one of its item", () => {
    for (const [key, want] of Object.entries(ML1_RECIPES)) {
      const r = REFINE_RECIPES[key];
      expect(r, key).toBeDefined();
      expect(Object.keys(r.input).sort(), key).toEqual([...want.inputs].sort());
      for (const amount of Object.values(r.input)) {
        expect(amount.gt(0), key).toBe(true);
        expect(amount.floor().eq(amount), key).toBe(true);
      }
      expect(r.output.itemId, key).toBe(want.output);
      expect(r.output.amount.toString(), key).toBe("1");
      expect(Number.isInteger(r.durationTicks) && r.durationTicks > 0, key).toBe(true);
    }
  });

  it("every Refinery output is unique (the XP index and the dropdown label by output)", () => {
    const outputs = Object.values(REFINE_RECIPES).map((r) => r.output.itemId);
    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it("each runs through the real line engine: inputs to zero, exactly one output", () => {
    for (const [key, want] of Object.entries(ML1_RECIPES)) {
      const r = startLine(stocked(key, 1), "refine", key, { kind: "batch", remaining: 1 });
      expect(r.started, key).toBe(true);
      let s = r.next;
      for (let i = 0; i < REFINE_RECIPES[key].durationTicks + 2; i++) s = economyTick(s, 1, () => 0.99);
      expect(s.refineLines, key).toHaveLength(0);
      expect(s.activeProcesses.filter((p) => p.kind === "refineJob"), key).toHaveLength(0);
      for (const id of want.inputs) expect(itemTotal(s.inventory, id).toString(), `${key} ${id}`).toBe("0");
      expect(itemTotal(s.inventory, want.output).toString(), key).toBe("1");
      expect(s.discovered, key).toContain(want.output);
    }
  });

  it("a compound deducts EVERY input at job start, atomically", () => {
    for (const key of COMPOUNDS) {
      const started = processRefineLines(startLine(stocked(key, 2), "refine", key, { kind: "batch", remaining: 2 }).next);
      expect(started.activeProcesses.filter((p) => p.kind === "refineJob"), key).toHaveLength(1);
      for (const [id, amount] of Object.entries(REFINE_RECIPES[key].input)) {
        // two iterations stocked, one job started: exactly one iteration's worth left
        expect(itemTotal(started.inventory, id).toString(), `${key} ${id}`).toBe(amount.toString());
      }
    }
  });

  it("a compound refuses when ANY one input is short, and takes nothing", () => {
    for (const key of COMPOUNDS) {
      for (const id of Object.keys(REFINE_RECIPES[key].input)) {
        const s = stocked(key, 1, id);
        expect(canStartLine(s, "refine", key, 1), `${key} short ${id}`).toEqual({ ok: false, reason: "materials" });
        const r = startLine(s, "refine", key, { kind: "batch", remaining: 1 });
        expect(r.started, `${key} short ${id}`).toBe(false);
        expect(r.next, `${key} short ${id}`).toBe(s);
      }
    }
  });

  it("the allocation model reserves every input of a running line", () => {
    for (const key of Object.keys(ML1_RECIPES)) {
      const s = startLine(stocked(key, 3), "refine", key, { kind: "batch", remaining: 3 }).next;
      for (const [id, amount] of Object.entries(REFINE_RECIPES[key].input)) {
        expect(allocatedItem(s.refineLines, [], id).toString(), `${key} ${id}`).toBe(amount.times(3).toString());
      }
    }
  });
});

// ===== the standing sink rule (E-MAT test strategy 4, extended to every producible refined item) =====

const SINK_CATEGORIES: readonly ItemCategory[] = ["raw", "salvagedMaterial", "refined", "minorComponent", "majorComponent"];
// Field kits are consumed by squads in the field (fieldKits.ts, their own FKR registry entries), not by a recipe.

function consumers(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, by: string) => out.set(id, [...(out.get(id) ?? []), by]);
  for (const [k, r] of Object.entries(REFINE_RECIPES)) for (const id of Object.keys(r.input)) add(id, `refine:${k}`);
  for (const [k, bp] of Object.entries(BLUEPRINTS)) for (const id of Object.keys(bp.recipe.inputs)) add(id, `blueprint:${k}`);
  for (const [k, hull] of Object.entries(SHIP_TYPES)) for (const id of Object.keys(hull.buildRecipe.components)) add(id, `hull:${k}`);
  for (const [k, f] of Object.entries(FACILITIES)) f.upgrades.forEach((u, i) => Object.keys(u.materials).forEach((id) => add(id, `facility:${k}:${i}`)));
  EQUIPMENT_STORAGE_RUNGS.forEach((r, i) => Object.keys(r.materials).forEach((id) => add(id, `equipmentStorage:${i}`)));
  SHIP_DOCKS_RUNGS.forEach((r, i) => Object.keys(r.materials).forEach((id) => add(id, `docks:${i}`)));
  TRANSIT_BERTH_RUNGS.forEach((r, i) => Object.keys(r.materials).forEach((id) => add(id, `berth:${i}`)));
  for (const id of Object.keys(SALVAGE_LOOT_POOLS)) add(id, "salvage");
  for (const [id, def] of Object.entries(ITEMS)) if (def.sellValue !== undefined) add(id, "sell");
  return out;
}

// Produced today: a mission loot slot with a live chance, a Refinery output, a blueprint output, a salvage drop.
function producers(): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(MISSIONS)) {
    out.add(m.lootTable.common);
    if ((m.uncommonChance ?? 0) > 0) out.add(m.lootTable.uncommon);
    if ((m.rareChance ?? 0) > 0) out.add(m.lootTable.rare);
  }
  for (const r of Object.values(REFINE_RECIPES)) out.add(r.output.itemId);
  for (const bp of Object.values(BLUEPRINTS)) if (typeof bp.recipe.outputItem === "string") out.add(bp.recipe.outputItem);
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.itemId === "string") out.add(o.itemId);
      Object.values(o).forEach(walk);
    }
  };
  walk(SALVAGE_LOOT_POOLS);
  return out;
}

describe("ML-1 sink rule: every material has a consumer or a typed reserve", () => {
  const used = consumers();
  const made = producers();
  const materials = Object.entries(ITEMS).filter(([, d]) => SINK_CATEGORIES.includes(d.category));

  it("covers a real catalog (vacuity guard)", () => {
    expect(materials.length).toBeGreaterThan(25);
    expect(used.size).toBeGreaterThan(20);
  });

  it("every raw, salvaged, refined and component item has a consumer XOR a reserve", () => {
    const bad = materials
      .filter(([id, d]) => used.has(id) === (d.reserved !== undefined))
      .map(([id, d]) => `${id}: ${d.reserved !== undefined ? `reserved but consumed by ${used.get(id)?.join(", ")}` : "no consumer and no reserve"}`);
    expect(bad).toEqual([]);
  });

  it("a reserve names the slice that wires it, and its item is really produced today", () => {
    for (const [id, d] of Object.entries(ITEMS)) {
      if (d.reserved === undefined) continue;
      expect(d.reserved, id).toMatch(/^(ML|EM|GG|WR|CP|G\d)-\d/);
      expect(made.has(id), `${id} is produced`).toBe(true);
    }
  });

  it("each reserve is a pending wiring registry entry owned by that slice", () => {
    for (const [id, d] of Object.entries(ITEMS)) {
      if (d.reserved === undefined) continue;
      const e = WIRING_REGISTRY.find((w) => w.source.catalog === "ITEMS" && w.source.key === `${id}:reserved`);
      expect(e, id).toBeDefined();
      expect(e?.status, id).toEqual({ kind: "pending", owner: d.reserved });
    }
  });

  it("the six ML-2 goods are reserved for ML-2; Ferrite Ingot already feeds the Osmium Plate", () => {
    for (const id of ["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst"]) {
      expect(ITEMS[id].reserved, id).toMatch(/^ML-2 /);
    }
    expect(ITEMS.ferriteIngot.reserved).toBeUndefined();
    expect(used.get("ferriteIngot")).toContain("refine:synthOsmiumPlate");
  });

  it("the six orphan raws of the E-MAT census now have a sink", () => {
    for (const id of ["rareMaterial", "ferriteOre", "cobaltOre", "osmiumOre", "scrapAlloy", "salvagedCircuitry"]) {
      expect(used.has(id), id).toBe(true);
    }
  });
});

describe("ML-1 chain rules: inputs are producible", () => {
  const made = producers();

  it("every refined input of a refine recipe or a blueprint is producible", () => {
    const inputs = [
      ...Object.values(REFINE_RECIPES).flatMap((r) => Object.keys(r.input)),
      ...Object.values(BLUEPRINTS).flatMap((bp) => Object.keys(bp.recipe.inputs)),
    ];
    for (const id of inputs) {
      if (ITEMS[id]?.category !== "refined") continue;
      expect(made.has(id), id).toBe(true);
    }
  });

  it("every raw input of the seven recipes drops on a mission with a live chance", () => {
    for (const [key, want] of Object.entries(ML1_RECIPES)) {
      for (const id of want.inputs) {
        if (ITEMS[id].category !== "raw") continue;
        expect(made.has(id), `${key} ${id}`).toBe(true);
      }
    }
  });

  it("no new recipe reaches the tier 2 Dense Ore wall", () => {
    for (const key of Object.keys(ML1_RECIPES)) {
      expect(Object.keys(REFINE_RECIPES[key].input), key).not.toContain("denseOre");
      expect(REFINE_RECIPES[key].output.itemId, key).not.toBe("denseOre");
    }
  });
});
