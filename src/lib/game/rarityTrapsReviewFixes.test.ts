// RARITY READINESS review fixes for RR-7 (docs/plans/2026-10-23-rarity-readiness-plan.md carry notes).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { EQUIPMENT_SLOTS, SALVAGE_LOOT_POOLS, freshState, salvageDurationTicks, type EquipmentInstance, type EquipmentRarity, type GameState } from "./model";
import { addItemQuality } from "./inventory";
import { salvageSalvagedMaterial } from "./salvage";
import { gearShoutoutScanCount, setCompletionShoutouts } from "./setShoutouts";
import { WIRING_REGISTRY } from "./wiring/registry";
import appSource from "../../App.svelte?raw";

function piece(over: Partial<EquipmentInstance>): EquipmentInstance {
  return {
    id: "p",
    slotType: "cargoBay",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    ...over,
  } as EquipmentInstance;
}

describe("fix 1: the shoutout scans gear only when a set piece exists, and never twice for one state pair", () => {
  it("modules without a set, or no change at all, do no wearer scan", () => {
    const s = freshState();
    const modules = { ...s, equipment: [...s.equipment, piece({ id: "m1", slotType: "module", moduleVariant: "noSuchModule", fittedToShipId: s.ships[0].id })] };
    const before = gearShoutoutScanCount();
    expect(setCompletionShoutouts(s, modules)).toEqual([]);
    expect(setCompletionShoutouts(modules, modules)).toEqual([]);
    expect(gearShoutoutScanCount()).toBe(before);
  });

  it("the same equipment, ships and members (any other field changed) skip the scan even with set pieces", () => {
    const s = freshState();
    const ship = s.ships[0].id;
    const withSet = { ...s, equipment: [...s.equipment, piece({ id: "sp", rarity: "constellar", setId: "testSetSurvey", fittedToShipId: ship })] };
    const tickLater = { ...withSet, gameTimeSeconds: withSet.gameTimeSeconds + 1 };
    const before = gearShoutoutScanCount();
    expect(setCompletionShoutouts(withSet, tickLater)).toEqual([]);
    expect(gearShoutoutScanCount()).toBe(before);
    // a real change with a set piece does scan
    const moved = { ...tickLater, equipment: tickLater.equipment.map((e) => (e.id === "sp" ? { ...e, fittedToShipId: null } : e)) };
    setCompletionShoutouts(tickLater, moved);
    expect(gearShoutoutScanCount()).toBe(before + 1);
  });
});

describe("fix 2: only the Derelict row reads as notApplicable for matching the row below", () => {
  it("the legendary rows stay probed", () => {
    for (const r of ["luminous", "constellar"]) {
      const e = WIRING_REGISTRY.find((x) => x.id === `ship:RARITY_PROFILES:${r}`)!;
      expect(e.notApplicable, r).toBeUndefined();
      expect(e.contexts.length, r).toBeGreaterThan(0);
    }
    const src = readFileSync("src/lib/game/wiring/registry.ts", "utf8");
    expect(src).toMatch(/if \(rarity === "derelict" && row\.budgetMult === RARITY_PROFILES\[against\]\.budgetMult\)/);
  });
});

describe("fix 3: the salvage time reads the Derelict floor through itemValueRarity", () => {
  it("salvageDurationTicks looks its multiplier up by itemValueRarity", () => {
    const src = readFileSync("src/lib/game/model.ts", "utf8");
    expect(src).toMatch(/SALVAGE_EQUIPMENT_RARITY_MULTIPLIER\[itemValueRarity\(spec\.rarity\)\]/);
    for (const r of ["derelict", "standard"] as EquipmentRarity[]) {
      expect(salvageDurationTicks({ kind: "equipment", iLevel: 30, quality: 4, rarity: r, tier: 2 })).toBe(salvageDurationTicks({ kind: "equipment", iLevel: 30, quality: 4, rarity: "standard", tier: 2 }));
    }
  });
});

describe("fix 4: the deferred crew rows quote the user", () => {
  it("their userRef quotes answer 7's words", () => {
    for (const r of ["radiant", "luminous", "constellar"]) {
      const e = WIRING_REGISTRY.find((x) => x.id === `crew:CREW_RARITY_MULTIPLIER:${r}`)!;
      expect(e.status.kind).toBe("deferred");
      expect(e.status.kind === "deferred" ? e.status.userRef : "").toContain('"Yes, same for both (Recommended)"');
    }
  });
});

describe("fix 5: a fifth salvage tier is reached end to end at Fleet Admiral 20 only", () => {
  it("FA 19 never rolls the pushed tier, FA 20 does", () => {
    const pool = SALVAGE_LOOT_POOLS.intactReactorCore as unknown as { tier: EquipmentRarity; weight: number; quality: number; drops: { itemId: string; weight: number }[] }[];
    pool.push({ tier: "luminous", weight: 1_000_000, quality: 5, drops: [{ itemId: "scrapAlloy", weight: 1 }] });
    try {
      const at = (level: number): GameState => {
        const s = freshState();
        return { ...s, fleetAdminLevel: level, inventory: addItemQuality(s.inventory, "intactReactorCore", new Decimal(5), 0) };
      };
      const tiersAt = (level: number) => {
        const out = new Set<string>();
        for (let i = 1; i <= 40; i++) {
          const r = salvageSalvagedMaterial(at(level), "intactReactorCore", () => (i * 0.6180339887) % 1);
          if (r.ok && r.rolled) out.add(r.rolled.tier);
        }
        return out;
      };
      expect(tiersAt(19).has("luminous")).toBe(false);
      expect(tiersAt(20).has("luminous")).toBe(true);
    } finally {
      pool.pop();
    }
    expect(SALVAGE_LOOT_POOLS.intactReactorCore.length).toBe(4);
  });
});

describe("fix 7: the catch-up shoutouts read above \"Welcome back\" in the newest-first log", () => {
  it("they are pushed after the welcome line", () => {
    const welcome = appSource.indexOf("pushLog(`Welcome back.");
    const shout = appSource.indexOf("setCompletionShoutouts(beforeSnapshot, state)");
    expect(welcome).toBeGreaterThan(0);
    expect(shout).toBeGreaterThan(welcome);
  });
});

void EQUIPMENT_SLOTS;
