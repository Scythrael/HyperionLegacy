// ML-1 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 "Material Lines (ML)"): the seven
// July-approved refined goods and their seven Refinery recipes (user 2026-10-19, L1 "Build as named"), the typed
// reserve marker, and the standing rules the plan asks of them:
//   - each new recipe consumes exactly its inputs and grants exactly its output through the real line engine
//   - a compound deducts EVERY input at job start and refuses when ANY one is short
//   - the allocation model reserves every input of a running line
//   - every raw, salvaged, refined and component item has a consumer, or a typed reserve naming the slice that wires
//     one (never both), and every reserved item is really produced today
//   - every refined input of a refine recipe or blueprint is producible; every raw input has a live mission source
//   - ML-1 review (the user's "everything wired, nothing inert player-reachable" rule): a recipe whose output leads
//     nowhere yet is not offered (refineRecipeOffered: canStartLine, the Refinery dropdown, the dashboard scan), and
//     the gate lifts by itself when ML-2 / EM-8 drop the reserve marker.
// ML-2 (0.14.0) gave the six reserved goods their blueprints and dropped their markers in the same commit, so every
// recipe here is offered now; the gate is still exercised by putting a marker back (withMarkersAdded). Only the
// Precursor Circuit (EM-8) stays reserved.

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
  refineRecipeOffered,
  type GameState,
  type ItemCategory,
} from "./model";
import { canStartLine, economyTick, processRefineLines, startLine } from "./tick";
import { buildHomeDashboard } from "./homeDashboard";
import { addItemQuality, itemTotal } from "./inventory";
import { allocatedItem } from "./allocation";
import { WIRING_REGISTRY } from "./wiring/registry";
import { GIANT_CLASSES, gasStudySourcePending } from "./gasGiantContent";
import { rollStudyReward } from "./gasGiantStudy";

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
// ML-2 lifted the six ML-1 reserves; only EM-8's Precursor Circuit is still reserved.
const RESERVED_TODAY = ["precursorCircuit"];
const ML2_LIFTED = ["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst"];

// Runs `fn` with the reserve marker lifted from `ids` (as ML-2 / EM-8 will when they add the consumer), then restores
// it. The marker is static data, so this is the honest way to show the gate lifts on its own.
function withMarkersLifted<T>(ids: readonly string[], fn: () => T): T {
  const saved = ids.map((id) => [id, ITEMS[id].reserved] as const);
  try {
    for (const id of ids) delete ITEMS[id].reserved;
    return fn();
  } finally {
    for (const [id, r] of saved) if (r !== undefined) ITEMS[id].reserved = r;
  }
}
const lifted = <T>(fn: () => T): T => withMarkersLifted(RESERVED_TODAY, fn);

// Runs `fn` with a reserve marker put BACK on `ids` (the state before ML-2 gave them a use), then removes it: the
// gate's mechanism, shown on today's data.
function withMarkersAdded<T>(ids: readonly string[], fn: () => T): T {
  try {
    for (const id of ids) ITEMS[id].reserved = "ML-2 (test: the marker put back)";
    return fn();
  } finally {
    for (const id of ids) delete ITEMS[id].reserved;
  }
}

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

  it("each runs through the real line engine: inputs to zero, exactly one output", () =>
    lifted(() => {
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
    }));

  it("a compound deducts EVERY input at job start, atomically", () =>
    lifted(() => {
      for (const key of COMPOUNDS) {
        const started = processRefineLines(startLine(stocked(key, 2), "refine", key, { kind: "batch", remaining: 2 }).next);
        expect(started.activeProcesses.filter((p) => p.kind === "refineJob"), key).toHaveLength(1);
        for (const [id, amount] of Object.entries(REFINE_RECIPES[key].input)) {
          // two iterations stocked, one job started: exactly one iteration's worth left
          expect(itemTotal(started.inventory, id).toString(), `${key} ${id}`).toBe(amount.toString());
        }
      }
    }));

  it("a compound refuses when ANY one input is short, and takes nothing", () =>
    lifted(() => {
      for (const key of COMPOUNDS) {
        for (const id of Object.keys(REFINE_RECIPES[key].input)) {
          const s = stocked(key, 1, id);
          expect(canStartLine(s, "refine", key, 1), `${key} short ${id}`).toEqual({ ok: false, reason: "materials" });
          const r = startLine(s, "refine", key, { kind: "batch", remaining: 1 });
          expect(r.started, `${key} short ${id}`).toBe(false);
          expect(r.next, `${key} short ${id}`).toBe(s);
        }
      }
    }));

  it("the allocation model reserves every input of a running line", () =>
    lifted(() => {
      for (const key of Object.keys(ML1_RECIPES)) {
        const s = startLine(stocked(key, 3), "refine", key, { kind: "batch", remaining: 3 }).next;
        for (const [id, amount] of Object.entries(REFINE_RECIPES[key].input)) {
          expect(allocatedItem(s.refineLines, [], id).toString(), `${key} ${id}`).toBe(amount.times(3).toString());
        }
      }
    }));
});

describe("ML-1 review, after ML-2: every Material Lines recipe is on offer, and the gate still hides a dead end", () => {
  const ALL = Object.keys(ML1_RECIPES);

  it("ML-2 gave every output a use, so all seven are offered (beside the original four)", () => {
    for (const key of ALL) expect(refineRecipeOffered(key), key).toBe(true);
    for (const key of ["refineCommonOre", "refinePolysilicateWafer", "refineReclaimedAlloy", "refinePurifiedBiomass"]) {
      expect(refineRecipeOffered(key), key).toBe(true);
    }
  });

  it("the engine starts each one fully stocked", () => {
    for (const key of ALL) expect(canStartLine(stocked(key, 1), "refine", key, 1), key).toEqual({ ok: true });
  });

  it("the gate still works: a marker put back hides its recipe, the engine refuses it and takes nothing", () => {
    withMarkersAdded(["cobaltCoil"], () => {
      expect(refineRecipeOffered("synthCobaltCoil")).toBe(false);
      const s = stocked("synthCobaltCoil", 1);
      expect(canStartLine(s, "refine", "synthCobaltCoil", 1)).toEqual({ ok: false, reason: "notFound" });
      const r = startLine(s, "refine", "synthCobaltCoil", { kind: "batch", remaining: 1 });
      expect(r.started).toBe(false);
      expect(r.next).toBe(s);
    });
    expect(refineRecipeOffered("synthCobaltCoil")).toBe(true);
  });

  it("the dashboard suggests an offered recipe, and never a hidden one", () => {
    // Only Cobalt Ore and a Titanium Ingot in stock: the Cobalt Coil compound is the one recipe that could start.
    const s = stocked("synthCobaltCoil", 1);
    expect(buildHomeDashboard(s).needsOrders.some((p) => p.id === "idle-refinery")).toBe(true);
    withMarkersAdded(["cobaltCoil"], () => {
      expect(buildHomeDashboard(s).needsOrders.some((p) => p.id === "idle-refinery")).toBe(false);
    });
  });

  it("each recipe is a live registry entry with its content probe (ML-2 lifted them by itself)", () => {
    for (const key of ALL) {
      const e = WIRING_REGISTRY.find((w) => w.id === `facility:REFINE_RECIPES:${key}`);
      expect(e?.status.kind, key).toBe("live");
      expect(e?.probe, key).toBe(`content:refine:${key}`);
    }
  });

  it("putting one marker back hides exactly the recipes it blocks", () => {
    withMarkersAdded(["cobaltCoil"], () => {
      expect(ALL.filter((k) => !refineRecipeOffered(k))).toEqual(["synthCobaltCoil"]);
    });
    // The Osmium Plate: only its compound. Ferrite Ingot now feeds the Hauler Hold and Reinforced Plating directly, so
    // its refine stays on offer.
    withMarkersAdded(["osmiumPlate"], () => {
      expect(ALL.filter((k) => !refineRecipeOffered(k))).toEqual(["synthOsmiumPlate"]);
    });
    for (const key of ALL) expect(refineRecipeOffered(key), key).toBe(true);
  });
});

// ===== the standing sink rule (E-MAT test strategy 4, extended to every producible refined item) =====

// Gas Giant Study GG-1: the Gas Storage Canisters (sold at the Quartermaster; GG-7 adds their recipes) and the research
// data (reserved for GG-5's lab lane) follow the same rule.
const SINK_CATEGORIES: readonly ItemCategory[] = ["raw", "salvagedMaterial", "refined", "minorComponent", "majorComponent", "gasCanister", "researchData"];
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
  // Gas Giant Study GG-3: what a ship study of a gas giant really returns (gasGiantStudy.ts rollStudyReward, the engine's
  // own roll over a batch of giants of every class at every tier).
  for (let seed = 1; seed <= 3000; seed += 1) {
    const classId = GIANT_CLASSES[seed % GIANT_CLASSES.length].id;
    const exp = {
      id: "ml-study",
      seed: seed * 0x9e3779b1,
      systemName: "LB-0001",
      region: { version: 1 as const, tier: ((seed % 7) + 1) as 1, enemyTerritory: false, bearing: 0, distanceLy: 10 },
      bodies: [{ id: "b", planetType: "gasGiant" as const, scanTotal: 1, scanProgress: 1, hazard: 0, scanned: true, discoveries: [], activities: [], giant: { classId, massMilliJ: GIANT_CLASSES[seed % GIANT_CLASSES.length].massMinMilliJ } }],
    };
    for (const id of Object.keys(rollStudyReward(exp, 0, 0).materials ?? {})) out.add(id);
  }
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

  // Gas Giant Study GG-1: a study item whose source is still pending (gasStudySourcePending: the research data, until
  // GG-3's study reward) is not produced yet; the warehouse keeps it off its shelves and its source is a pending
  // registry entry (GAS_STUDY_USES), so it counts as produced by that slice.
  it("a reserve names the slice that wires it, and its item is really produced today (or its gas study source is pending)", () => {
    for (const [id, d] of Object.entries(ITEMS)) {
      if (d.reserved === undefined) continue;
      expect(d.reserved, id).toMatch(/^(ML|EM|GG|WR|CP|G\d)-\d/);
      expect(made.has(id) || gasStudySourcePending(id), `${id} has a configured producer`).toBe(true);
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

  it("ML-2 lifted the six reserves: each good feeds at least one blueprint now; Ferrite Ingot feeds blueprints too", () => {
    for (const id of [...ML2_LIFTED, "ferriteIngot"]) {
      expect(ITEMS[id].reserved, id).toBeUndefined();
      expect((used.get(id) ?? []).some((by) => by.startsWith("blueprint:")), id).toBe(true);
    }
    expect(used.get("ferriteIngot")).toContain("refine:synthOsmiumPlate");
  });

  // A LIVE sink is a consumer outside the Refinery or an OFFERED refine recipe; a hidden recipe is a dead end, not a sink.
  const liveSink = (id: string): boolean => (used.get(id) ?? []).some((by) => !by.startsWith("refine:") || refineRecipeOffered(by.slice("refine:".length)));

  it("the six orphan raws of the E-MAT census all have a live sink now (ML-2 lifted the reserves)", () => {
    const ORPHANS = ["rareMaterial", "ferriteOre", "cobaltOre", "osmiumOre", "scrapAlloy", "salvagedCircuitry"];
    for (const id of ORPHANS) expect(liveSink(id), id).toBe(true);
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
