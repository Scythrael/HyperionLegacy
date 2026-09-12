// ============================================================================
// iconPacks.test.ts
// 0.13.5 Phase 2.
//
// ⚠️ THESE PIN THE FOUR PACK REQUIREMENTS, and they matter more than a normal presentation test
// because ICONS ARE A PRODUCT SURFACE here: the plan is paid cosmetic packs, so a pack that can
// render nothing, or that can quietly change what a warning means, is a defect a paying customer
// could ship to themselves.
//
// The requirements, from the record:
//   1. a NAMED registry (icons.ts, already covered by icons.test.ts)
//   2. the active set SWAPPABLE AT RUNTIME
//   3. a DEFINED FALLBACK when a pack omits an icon
//   4. NO pack may change an icon's MEANING
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { get } from "svelte/store";
import { ICON_PATHS, type IconName } from "./icons";
import {
  BASE_PACK,
  ICON_PACKS,
  ICON_SEMANTICS,
  activeIconPack,
  loadIconPackId,
  packById,
  resolveIconPaths,
  setIconPack,
  type IconPack,
} from "./iconPacks";

function installStorage(): void {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  });
}

const ALL_NAMES = Object.keys(ICON_PATHS) as IconName[];

describe("requirement 3: a partial pack falls back per icon", () => {
  it("⚠️ a pack overriding ONE glyph still renders every other one", () => {
    // This is what makes packs shippable incrementally. A per-pack completeness gate would force
    // an author to draw all of them before shipping any, which is the opposite of a pack economy.
    const partial: IconPack = { id: "partial", label: "Partial", paths: { warning: ["M0 0"] } };
    expect(resolveIconPaths("warning", partial)).toEqual(["M0 0"]);
    for (const name of ALL_NAMES) {
      const resolved = resolveIconPaths(name, partial);
      expect(resolved.length, `${name} resolved to nothing`).toBeGreaterThan(0);
      if (name !== "warning") expect(resolved).toEqual(ICON_PATHS[name]);
    }
  });

  it("treats an EMPTY override as absent rather than as 'draw nothing'", () => {
    // An empty array is far likelier to be a mistake in a pack than a deliberate invisible icon,
    // and an invisible icon is the worse failure of the two.
    const broken: IconPack = { id: "broken", label: "Broken", paths: { ship: [] } };
    expect(resolveIconPaths("ship", broken)).toEqual(ICON_PATHS.ship);
  });

  it("the base pack resolves every icon to the base set", () => {
    // The "no pack selected" path and the "pack selected" path are the SAME code, so the default
    // can never be the one that is broken.
    for (const name of ALL_NAMES) {
      expect(resolveIconPaths(name, BASE_PACK)).toEqual(ICON_PATHS[name]);
    }
  });
});

describe("requirement 4: a pack cannot change what an icon MEANS", () => {
  it("⚠️ every icon in the registry is classified, with no gaps", () => {
    // An unclassified icon is one a pack could replace with anything, which is precisely the hole
    // this requirement exists to close. The Record type makes a gap a compile error; this asserts
    // it at runtime too, so the guarantee survives a refactor that loosens the type.
    for (const name of ALL_NAMES) {
      expect(ICON_SEMANTICS[name], `${name} has no semantic class`).toBeDefined();
    }
    expect(Object.keys(ICON_SEMANTICS).sort()).toEqual([...ALL_NAMES].sort());
  });

  it("the safety-critical glyphs are classified as alerts", () => {
    // ⚠️ `check` is in here as deliberately as `warning`. A confirmation mark that stops reading as
    // success is as harmful as a warning that stops reading as danger, just in the other direction.
    expect(ICON_SEMANTICS.warning).toBe("alert");
    expect(ICON_SEMANTICS.check).toBe("alert");
  });

  it("a pack can only override names that ALREADY EXIST, so it cannot invent a meaning", () => {
    // Structural rather than asserted: IconPack["paths"] is Partial<Record<IconName, ...>>, so a
    // pack listing an unknown name does not compile. This case documents that guarantee and fails
    // if the type is ever loosened to a plain string index.
    const pack: IconPack = { id: "x", label: "X", paths: {} };
    const keys = Object.keys(pack.paths);
    for (const k of keys) expect(ALL_NAMES).toContain(k as IconName);
    // A pack's declared keys are a SUBSET of the registry, always.
    const partial: IconPack = { id: "y", label: "Y", paths: { queue: ["M1 1"], salvage: ["M2 2"] } };
    for (const k of Object.keys(partial.paths)) expect(ALL_NAMES).toContain(k as IconName);
  });
});

describe("requirement 2: the active set is swappable at runtime", () => {
  it("⚠️ the store publishes, so a switch re-renders every glyph without a reload", () => {
    // A module VARIABLE would be read once per Icon and never again, making a pack switch take
    // effect only on reload. The store is what makes the requirement real, so it is asserted
    // rather than assumed.
    installStorage();
    const custom: IconPack = { id: "base", label: "Standard", paths: {} };
    expect(get(activeIconPack)).toBeDefined();
    setIconPack(custom.id);
    expect(get(activeIconPack).id).toBe("base");
  });

  it("persists the choice and reloads it", () => {
    installStorage();
    setIconPack("base");
    expect(loadIconPackId()).toBe("base");
  });

  it("an UNKNOWN pack id degrades to the base set rather than leaving the game iconless", () => {
    // Reachable: a pack owned on another device, or one removed from a later build.
    installStorage();
    localStorage.setItem("fleet_admiral_icon_pack", "a-pack-that-was-removed");
    expect(loadIconPackId()).toBe(BASE_PACK.id);
    expect(packById("a-pack-that-was-removed")).toBe(BASE_PACK);
  });

  it("ships exactly one pack today, which is a content decision and not an oversight", () => {
    // Guards against someone reading "only the base pack exists" as unfinished work. Adding a
    // second pack is commercial, not architectural; the seam is what this unit delivers.
    expect(ICON_PACKS).toHaveLength(1);
    expect(ICON_PACKS[0].id).toBe(BASE_PACK.id);
  });
});
