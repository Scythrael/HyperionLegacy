// ============================================================================
// patrol-loot.test.ts : Combat 0.13.0, Phase 10, design S12 "Rewards and loot".
//
// Locks the PURE loot ROLLER (combat/patrolLoot.ts) + the data-driven loot TABLES
// (tick.ts's PATROL_LOOT_TABLES). The integration side (loot actually landing in
// home inventory / credits / captain XP / FA XP through economyTick, plus the
// closed-form parity gate and win-only guard) lives in patrol-rewards.test.ts;
// THIS file locks the roller's own contract:
//   - DETERMINISM: same (table, seed) => byte-identical loot; seed sensitivity.
//   - BOUNDS: every rolled qty / credit / XP stays within the table's declared bands.
//   - NO FUNCTIONAL GEAR (design S12): every id a table can emit resolves to a
//     MATERIAL ITEMS category, never a shipModule/shipSystem/equipment, AND the
//     roller never emits an id outside its table (so a wreck can never drop gear).
// ============================================================================

import { describe, it, expect } from "vitest";
import { rollWaveLoot, type PatrolLootTable, type LootMaterialEntry } from "./combat/patrolLoot";
import { PATROL_LOOT_TABLES, DEFAULT_PATROL_LOOT_TABLE } from "./tick";
import { ITEMS, SALVAGE_LOOT_POOLS, type ItemCategory, type SalvagedMaterialItemId } from "./model";

// The MATERIAL categories a wreck may drop. Deliberately EXCLUDES shipModule / shipSystem
// (installable gear) so a table listing one of those, or the roller ever emitting one, fails
// here. This is the machine-checked form of design S12's "NO functional gear from wrecks."
const MATERIAL_CATEGORIES: ItemCategory[] = [
  "raw",
  "refined",
  "minorComponent",
  "majorComponent",
  "salvagedMaterial",
];

// Every id a table can produce (the guaranteed salvage id + every cargo-pool id + the
// optional chance-gated Damaged [System] drop, Unit 1.7). Including damagedSystem keeps the
// "roller never emits an id outside its table" guard honest now that a wreck can drop it.
function allTableItemIds(table: PatrolLootTable): string[] {
  const ids = [table.salvage.itemId, ...table.cargoPool.map((e) => e.itemId)];
  if (table.damagedSystem) ids.push(table.damagedSystem.itemId);
  return ids;
}

// A tiny hand-built table with DISTINCT, easily-checked bands, so the bounds assertions do
// not depend on the (tunable) launch numbers in tick.ts.
const PROBE_TABLE: PatrolLootTable = {
  salvage: { itemId: "intactReactorCore", minQty: 1, maxQty: 2 },
  cargoPool: [
    { itemId: "scrapAlloy", minQty: 2, maxQty: 5 },
    { itemId: "titaniumIngot", minQty: 1, maxQty: 3 },
  ],
  cargoPicksMin: 1,
  cargoPicksMax: 2,
  creditsMin: 10,
  creditsMax: 30,
  captainXpPerWave: 20,
  fleetAdminXpPerWave: 10,
};

describe("rollWaveLoot: determinism (offline == live)", () => {
  it("same (table, seed) => byte-identical loot", () => {
    for (const seed of [1, 7, 42, 1000, 0xdeadbeef]) {
      expect(rollWaveLoot(PROBE_TABLE, seed)).toEqual(rollWaveLoot(PROBE_TABLE, seed));
    }
  });

  it("different seeds can produce different loot (the roll is seed-sensitive, not constant)", () => {
    // Not EVERY pair must differ (small bands collide), but across a spread at least one does,
    // proving the output actually varies with the seed.
    const results = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => JSON.stringify(rollWaveLoot(PROBE_TABLE, s)));
    expect(new Set(results).size).toBeGreaterThan(1);
  });
});

describe("rollWaveLoot: bounds + flat XP", () => {
  it("every rolled qty / credit / XP stays within the table's declared bands across many seeds", () => {
    const entryById = new Map<string, LootMaterialEntry>();
    entryById.set(PROBE_TABLE.salvage.itemId, PROBE_TABLE.salvage);
    for (const e of PROBE_TABLE.cargoPool) entryById.set(e.itemId, e);

    for (let seed = 0; seed < 500; seed++) {
      const loot = rollWaveLoot(PROBE_TABLE, seed);
      // Salvage is GUARANTEED every wave (>= its floor).
      expect(loot.materials[PROBE_TABLE.salvage.itemId] ?? 0).toBeGreaterThanOrEqual(PROBE_TABLE.salvage.minQty);
      // Credits within band.
      expect(loot.credits).toBeGreaterThanOrEqual(PROBE_TABLE.creditsMin);
      expect(loot.credits).toBeLessThanOrEqual(PROBE_TABLE.creditsMax);
      // XP is FLAT (copied from the table, no roll).
      expect(loot.captainXp).toBe(PROBE_TABLE.captainXpPerWave);
      expect(loot.fleetAdminXp).toBe(PROBE_TABLE.fleetAdminXpPerWave);
      // Every produced material id is a table id, and its qty never exceeds the max it could
      // reach with the max number of cargo picks all landing on it (picks * entryMax, plus
      // the salvage floor overlap is impossible since ids differ here).
      for (const id of Object.keys(loot.materials)) {
        expect(entryById.has(id)).toBe(true);
        const entry = entryById.get(id)!;
        const maxPossible =
          id === PROBE_TABLE.salvage.itemId ? entry.maxQty : PROBE_TABLE.cargoPicksMax * entry.maxQty;
        expect(loot.materials[id]).toBeGreaterThan(0);
        expect(loot.materials[id]).toBeLessThanOrEqual(maxPossible);
        expect(Number.isInteger(loot.materials[id])).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Weapon-crafting loot: the chance-gated "Damaged [System]" drop (Combat 1.0, Unit 1.7).
// ---------------------------------------------------------------------------
describe("Damaged [System] weapon-crafting loot (Unit 1.7)", () => {
  // A probe table with a GUARANTEED (1/1) damaged-system drop, so the deterministic +
  // qty-band assertions do not depend on the (tunable) shipping chance.
  const CERTAIN_DROP: PatrolLootTable = {
    ...PROBE_TABLE,
    damagedSystem: { itemId: "damagedWeaponSystem", chanceNum: 1, chanceDen: 1, minQty: 1, maxQty: 3 },
  };

  it("the shipping table's Damaged [System] id is a real salvagedMaterial WITH a loot pool (salvages into materials, is not gear)", () => {
    const ds = DEFAULT_PATROL_LOOT_TABLE.damagedSystem;
    expect(ds, "the starter patrol table must carry a Damaged [System] drop").toBeDefined();
    if (!ds) return;
    // It is a MATERIAL you strip for parts, never installable gear (design S12).
    expect(ITEMS[ds.itemId]?.category).toBe("salvagedMaterial");
    // ...and it carries a loot pool, so salvageSalvagedMaterial can strip it (not dead inventory).
    expect(SALVAGE_LOOT_POOLS[ds.itemId as SalvagedMaterialItemId]?.length).toBeGreaterThan(0);
  });

  it("a guaranteed-chance drop is deterministic and its qty stays within the declared band", () => {
    const id = CERTAIN_DROP.damagedSystem!.itemId;
    for (let seed = 0; seed < 300; seed++) {
      const loot = rollWaveLoot(CERTAIN_DROP, seed);
      // Same (table, seed) => byte-identical (offline == live), including the new draw.
      expect(loot).toEqual(rollWaveLoot(CERTAIN_DROP, seed));
      // At 1/1 it ALWAYS drops, within [minQty, maxQty] and an integer.
      const qty = loot.materials[id] ?? 0;
      expect(qty).toBeGreaterThanOrEqual(CERTAIN_DROP.damagedSystem!.minQty);
      expect(qty).toBeLessThanOrEqual(CERTAIN_DROP.damagedSystem!.maxQty);
      expect(Number.isInteger(qty)).toBe(true);
    }
  });

  it("on the shipping table the drop is CHANCE-gated: it happens on some seeds, not all, at roughly the configured rate (bounded)", () => {
    const ds = DEFAULT_PATROL_LOOT_TABLE.damagedSystem!;
    const N = 2000;
    let drops = 0;
    for (let seed = 0; seed < N; seed++) {
      if ((rollWaveLoot(DEFAULT_PATROL_LOOT_TABLE, seed).materials[ds.itemId] ?? 0) > 0) drops++;
    }
    // Neither always nor never (it is a genuine chance), and the observed rate sits near the
    // configured chanceNum/chanceDen. A generous band absorbs sampling noise while still
    // proving the rate is the intended MODEST one, not a certainty or a rarity.
    const rate = drops / N;
    const expected = ds.chanceNum / ds.chanceDen;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(1);
    expect(Math.abs(rate - expected)).toBeLessThan(0.05);
  });

  it("adding the Damaged [System] draw does NOT perturb the salvage / cargo / credit loot (parity for existing loot)", () => {
    // The draw is LAST, so a table WITH the field must produce IDENTICAL salvage/cargo/credit
    // loot to the same table WITHOUT it: only a new damaged-system materials entry may appear.
    const withField = DEFAULT_PATROL_LOOT_TABLE;
    const withoutField: PatrolLootTable = { ...withField, damagedSystem: undefined };
    const dsId = withField.damagedSystem!.itemId;
    for (let seed = 0; seed < 500; seed++) {
      const a = rollWaveLoot(withField, seed);
      const b = rollWaveLoot(withoutField, seed);
      // Strip the (only) new key from a's materials; everything else must be byte-identical.
      const aOther = { ...a.materials };
      delete aOther[dsId];
      expect(aOther).toEqual(b.materials);
      expect(a.credits).toBe(b.credits);
      expect(a.captainXp).toBe(b.captainXp);
      expect(a.fleetAdminXp).toBe(b.fleetAdminXp);
    }
  });
});

describe("NO FUNCTIONAL GEAR invariant (design S12)", () => {
  it("every id in every shipping loot table resolves to a real, MATERIAL ITEMS category", () => {
    const tables = [DEFAULT_PATROL_LOOT_TABLE, ...Object.values(PATROL_LOOT_TABLES)];
    for (const table of tables) {
      for (const id of allTableItemIds(table)) {
        const def = ITEMS[id];
        expect(def, `loot id "${id}" must be a real ITEMS key`).toBeDefined();
        expect(
          MATERIAL_CATEGORIES.includes(def.category),
          `loot id "${id}" is category "${def.category}"; loot must NEVER be installable gear`,
        ).toBe(true);
      }
    }
  });

  it("the guaranteed salvage id is specifically a salvagedMaterial (a wreck stripped for parts)", () => {
    expect(ITEMS[DEFAULT_PATROL_LOOT_TABLE.salvage.itemId].category).toBe("salvagedMaterial");
  });

  it("the roller can NEVER emit an id outside its table (so a wreck cannot drop gear)", () => {
    // Roll the ACTUAL shipping table across many seeds; every emitted id must be a declared
    // table id (which the test above already proved is a non-gear material).
    const table = DEFAULT_PATROL_LOOT_TABLE;
    const allowed = new Set(allTableItemIds(table));
    for (let seed = 0; seed < 500; seed++) {
      for (const id of Object.keys(rollWaveLoot(table, seed).materials)) {
        expect(allowed.has(id)).toBe(true);
      }
    }
  });
});
