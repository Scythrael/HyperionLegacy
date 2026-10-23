// RARITY READINESS RR-5 (docs/plans/2026-10-23-rarity-readiness-plan.md; user answer 1): the Luminous legendary affix
// catalog. One affix per Luminous piece, drawn last on the private extras stream, its value added to an EXISTING fold
// key the slot already rolls. No live band and no Constellar piece carries one. No per-ship limit (a [PROPOSAL] the user
// has not approved).

import { describe, expect, it } from "vitest";
import { EQUIPMENT_RARITY_LADDER, EQUIPMENT_SLOTS, type EquipmentAscension, type EquipmentInstance, type EquipmentRarity, type EquipmentSlotType } from "./model";
import { LEGENDARY_AFFIX_BUDGET_SHARE, LEGENDARY_AFFIX_EXCLUDED, LUMINOUS_AFFIXES, legendaryAffixDef, legendaryAffixesFor } from "./legendaryAffixes";
import { RARITY_PROFILES } from "./rarityProfiles";
import { ascendedProfile } from "./ascension";
import { WEAPON_DEFS, type WeaponId } from "./combat/weapons";
import { ROLE_TEMPLATE, type DroneRole } from "./combat/drones";
import {
  DRONE_POD_AFFIX_POOL,
  DRONE_POD_IMPLICIT_STAT,
  WEAPON_AFFIX_POOL,
  WEAPON_IMPLICIT_STAT,
  generateDronePod,
  generateEquipment,
  generateWeapon,
  legendaryAffixLineValue,
  rollRarityExtras,
} from "./itemgen";

function lcg(seed: number): { rng: () => number; draws: () => number } {
  let s = seed >>> 0;
  let n = 0;
  return {
    rng: () => {
      n++;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    },
    draws: () => n,
  };
}

// Every line a slot can already roll (its implicit and affix pools, slot and variety level; weapon and pod pools).
function rollableOn(slotType: string): Set<string> {
  if (slotType === "weapon") return new Set([WEAPON_IMPLICIT_STAT, ...WEAPON_AFFIX_POOL.map((a) => a.stat)]);
  if (slotType === "droneBay") return new Set([DRONE_POD_IMPLICIT_STAT, ...DRONE_POD_AFFIX_POOL.map((a) => a.stat)]);
  const d = EQUIPMENT_SLOTS[slotType];
  const out = new Set<string>([...d.implicitStats, ...d.affixPool.map((a) => a.stat)]);
  for (const v of d.varieties) {
    for (const s of v.implicitStats ?? []) out.add(s);
    for (const a of v.affixPool ?? []) out.add(a.stat);
  }
  return out;
}

// Mint one piece of a slot at a band (the first variety; weapons and pods by their first type).
function mint(slotType: string, rarity: EquipmentRarity, ascension: EquipmentAscension, seed: number): { piece: EquipmentInstance; draws: number } {
  const c = lcg(seed);
  const common = { blueprintKey: null, iLevel: 40, quality: 5, rarity, ascension, rng: c.rng, allocateId: () => "e" };
  const piece =
    slotType === "weapon"
      ? generateWeapon({ ...common, weaponType: Object.keys(WEAPON_DEFS)[0] as WeaponId })
      : slotType === "droneBay"
        ? generateDronePod({ ...common, droneRole: Object.keys(ROLE_TEMPLATE)[0] as DroneRole })
        : generateEquipment({ ...common, slotType: slotType as EquipmentSlotType, varietyKey: EQUIPMENT_SLOTS[slotType].varieties[0].key });
  return { piece, draws: c.draws() };
}

const FAMILIES = [...Object.keys(EQUIPMENT_SLOTS).filter((k) => EQUIPMENT_SLOTS[k].varieties.length > 0), "weapon", "droneBay"];

describe("RR-5: the catalog", () => {
  it("every row is well formed: a unique id, a [PROPOSAL] label, a live slot family, a line that slot already rolls", () => {
    const ids = new Set<string>();
    for (const d of LUMINOUS_AFFIXES) {
      expect(ids.has(d.id), d.id).toBe(false);
      ids.add(d.id);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.slotTypes.length).toBeGreaterThan(0);
      expect(d.budgetShare).toBe(LEGENDARY_AFFIX_BUDGET_SHARE);
      for (const st of d.slotTypes) {
        expect(FAMILIES, `${d.id} ${st}`).toContain(st);
        expect(rollableOn(st).has(d.stat), `${d.id}: ${st} does not roll ${d.stat}`).toBe(true);
      }
      // never a line the mint consumes (mass / draw reductions) or a charge count
      expect(["massReduction", "powerDrawReduction", "groundCarryCapacity"]).not.toContain(d.stat);
      expect(legendaryAffixDef(d.id)).toBe(d);
    }
    expect(legendaryAffixDef("noSuchAffix")).toBeUndefined();
    expect(legendaryAffixDef(undefined)).toBeUndefined();
  });

  it("every live slot family has an affix, or is excluded with a reason (never both)", () => {
    for (const st of FAMILIES) {
      const rows = legendaryAffixesFor(st as EquipmentSlotType);
      const excluded = LEGENDARY_AFFIX_EXCLUDED[st as EquipmentSlotType];
      expect(rows.length > 0 || excluded !== undefined, st).toBe(true);
      expect(rows.length > 0 && excluded !== undefined, st).toBe(false);
    }
    // review of RR-5: the sensors line IS live (survey yield, the expedition sensor gate, region charting, scan events,
    // short-range), so the sensor family carries Far Watcher; only bridge and module stay excluded.
    expect(Object.keys(LEGENDARY_AFFIX_EXCLUDED).sort()).toEqual(["bridge", "module"]);
  });

  it("only Luminous rolls a legendary affix", () => {
    expect(EQUIPMENT_RARITY_LADDER.filter((r) => RARITY_PROFILES[r].legendaryAffix)).toEqual(["luminous"]);
    expect(ascendedProfile("luminous", "nova").legendaryAffix).toBe(true);
    expect(ascendedProfile("constellar", "celestial").legendaryAffix).toBe(false);
  });
});

describe("RR-5: the mint", () => {
  it("a Luminous piece of every family with a row carries exactly one affix of its slot, its line at least the row's value", () => {
    for (const st of FAMILIES) {
      const rows = legendaryAffixesFor(st as EquipmentSlotType);
      for (const asc of ["none", "nova", "celestial"] as EquipmentAscension[]) {
        const { piece } = mint(st, "luminous", asc, 11);
        if (rows.length === 0) {
          expect(piece.legendaryAffixId, st).toBeUndefined();
          continue;
        }
        const def = legendaryAffixDef(piece.legendaryAffixId);
        expect(def, `${st} ${asc}`).toBeDefined();
        expect(def!.slotTypes).toContain(st);
        const lines = { ...piece.implicitStats, ...piece.rolledStats };
        expect(piece.rolledStats[def!.stat] ?? 0, `${st} ${asc}`).toBeGreaterThan(0);
        expect(lines[def!.stat]).toBeGreaterThan(0);
      }
    }
  });

  it("no live band, no Constellar and no stray ascension carries one", () => {
    for (const st of FAMILIES) {
      for (const r of ["derelict", "standard", "augmented", "stellar", "radiant", "constellar"] as EquipmentRarity[]) {
        for (const asc of ["none", "nova", "celestial"] as EquipmentAscension[]) {
          expect(mint(st, r, asc, 5).piece.legendaryAffixId, `${st} ${r} ${asc}`).toBeUndefined();
        }
      }
    }
  });

  it("the affix is drawn LAST on the private stream: a Luminous mint still takes exactly one shared draw more than Radiant", () => {
    for (const st of FAMILIES) {
      for (let seed = 1; seed < 6; seed++) expect(mint(st, "luminous", "none", seed).draws, st).toBe(mint(st, "radiant", "none", seed).draws + 1);
    }
  });

  it("adds exactly legendaryAffixLineValue onto its line, and nothing else changes", () => {
    const pool = [{ stat: "cargoCapacity" }];
    for (let seed = 1; seed < 50; seed++) {
      const withAffix: Record<string, number> = { cargoCapacity: 10 };
      const id = rollRarityExtras({ ...RARITY_PROFILES.luminous, secondaries: 0, artisanPermille: 0 }, 400, pool, ["cargoCapacity"], withAffix, lcg(seed).rng, { slotType: "cargoBay" });
      const def = legendaryAffixDef(id)!;
      expect(def.id).toBe("bottomlessHold");
      expect(withAffix).toEqual({ cargoCapacity: 10 + legendaryAffixLineValue(def, 400) });
      expect(legendaryAffixLineValue(def, 400)).toBe(Math.round(400 * LEGENDARY_AFFIX_BUDGET_SHARE));
    }
    // a guest line is stored in berths, like every guest line
    const guest = legendaryAffixDef("grandConcourse")!;
    expect(legendaryAffixLineValue(guest, 400)).toBe(Math.round(400 * LEGENDARY_AFFIX_BUDGET_SHARE) * 4);
  });

  it("several pieces with the same affix on one ship are allowed (no limit is built: a [PROPOSAL] awaiting the user)", () => {
    const a = mint("cargoBay", "luminous", "none", 3).piece;
    const b = mint("cargoBay", "luminous", "nova", 4).piece;
    expect(a.legendaryAffixId).toBe(b.legendaryAffixId); // one row per family today, so they share it, and nothing refuses that
  });
});

describe("review of RR-5: the Fold Engine alternative is a one-line catalog swap", () => {
  it("a transitSpeedMult FTL row would be rollable and measured exactly by the registry's own entry builder", async () => {
    const { legendaryAffixEntryFor, CATALOGS, curveExpected } = await import("./wiring/registry");
    const { readProbe } = await import("./wiring/probes");
    const fold = { id: "foldEngine", label: "Fold Engine", slotTypes: ["ftlDrive"] as EquipmentSlotType[], stat: "transitSpeedMult", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE };
    expect(rollableOn("ftlDrive").has(fold.stat)).toBe(true);
    const e = legendaryAffixEntryFor(fold);
    expect(e.status.kind).toBe("live");
    const s0 = e.base();
    const off = readProbe(e.probe!, e.off(s0), e.contexts[0]);
    const on = readProbe(e.probe!, e.on(s0), e.contexts[0]);
    expect(on).toBeGreaterThan(off);
    expect(on).toBeCloseTo(curveExpected(e.curve, off, e.magnitude(CATALOGS))!, 9);
  });
});

describe("RR-5: the wiring registry carries one live, probed row per affix", () => {
  it("one LUMINOUS_AFFIXES entry per row, live with a probe and a context", async () => {
    const { WIRING_REGISTRY } = await import("./wiring/registry");
    const { RR_ADDED_ENTRY_IDS } = await import("./rarityRegistry.fixture");
    const rows = WIRING_REGISTRY.filter((e) => RR_ADDED_ENTRY_IDS.has(e.id) && e.source.catalog === "LUMINOUS_AFFIXES");
    expect(rows.map((e) => e.source.key)).toEqual(LUMINOUS_AFFIXES.map((d) => d.id));
    for (const e of rows) {
      expect(e.status.kind, e.id).toBe("live");
      expect(e.probe, e.id).toBeDefined();
      expect(e.contexts.length, e.id).toBeGreaterThan(0);
    }
  });
});
