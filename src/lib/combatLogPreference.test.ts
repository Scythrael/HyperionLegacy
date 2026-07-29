import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  loadCombatLogStyle,
  saveCombatLogStyle,
  loadCombatDamageColors,
  saveCombatDamageColors,
  loadCombatLogSpeed,
  saveCombatLogSpeed,
  loadCombatAutoScroll,
  saveCombatAutoScroll,
} from "./combatLogPreference";

describe("combatLogPreference", () => {
  // This project runs vitest under the default `node` environment (no jsdom/happy-dom
  // configured), so the global `localStorage` these functions use is not defined.
  // Install a minimal in-memory shim on globalThis for THIS block only, then remove
  // it afterward so no global leaks into a later test file. Mirrors the identical shim
  // in salvageConfirmPreference.test.ts / save.test.ts.
  let restoreLocalStorage: (() => void) | null = null;
  beforeAll(() => {
    const store = new Map<string, string>();
    const hadLocalStorage = "localStorage" in globalThis;
    const previous = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string): void => {
        store.set(key, String(value));
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
      clear: (): void => {
        store.clear();
      },
    };
    restoreLocalStorage = () => {
      if (hadLocalStorage) (globalThis as any).localStorage = previous;
      else delete (globalThis as any).localStorage;
    };
  });
  afterAll(() => {
    restoreLocalStorage?.();
    restoreLocalStorage = null;
  });

  beforeEach(() => localStorage.clear());

  // --- combatLogStyle -------------------------------------------------------
  describe("combatLogStyle", () => {
    it("defaults to 'default' when unset", () => {
      expect(loadCombatLogStyle()).toBe("default");
    });
    it("persists and reloads 'simplified'", () => {
      saveCombatLogStyle("simplified");
      expect(loadCombatLogStyle()).toBe("simplified");
    });
    it("round-trips back to 'default'", () => {
      saveCombatLogStyle("simplified");
      saveCombatLogStyle("default");
      expect(loadCombatLogStyle()).toBe("default");
    });
    it("falls back to 'default' on a corrupt/foreign value", () => {
      localStorage.setItem("fleet_admiral_combat_log_style", "gibberish");
      expect(loadCombatLogStyle()).toBe("default");
    });
  });

  // --- combatDamageColors ---------------------------------------------------
  describe("combatDamageColors", () => {
    it("defaults to false when unset", () => {
      expect(loadCombatDamageColors()).toBe(false);
    });
    it("persists and reloads true, then false", () => {
      saveCombatDamageColors(true);
      expect(loadCombatDamageColors()).toBe(true);
      saveCombatDamageColors(false);
      expect(loadCombatDamageColors()).toBe(false);
    });
    it("treats any non-'true' stored value as false", () => {
      localStorage.setItem("fleet_admiral_combat_damage_colors", "yes");
      expect(loadCombatDamageColors()).toBe(false);
    });
  });

  // --- combatLogSpeed -------------------------------------------------------
  describe("combatLogSpeed", () => {
    it("defaults to 'fast' when unset", () => {
      expect(loadCombatLogSpeed()).toBe("fast");
    });
    it("persists and reloads 'slow', then 'fast'", () => {
      saveCombatLogSpeed("slow");
      expect(loadCombatLogSpeed()).toBe("slow");
      saveCombatLogSpeed("fast");
      expect(loadCombatLogSpeed()).toBe("fast");
    });
    it("falls back to 'fast' on a corrupt value", () => {
      localStorage.setItem("fleet_admiral_combat_log_speed", "turbo");
      expect(loadCombatLogSpeed()).toBe("fast");
    });
  });

  // --- combatAutoScroll -----------------------------------------------------
  describe("combatAutoScroll", () => {
    it("defaults to true when unset", () => {
      expect(loadCombatAutoScroll()).toBe(true);
    });
    it("persists and reloads false, then true", () => {
      saveCombatAutoScroll(false);
      expect(loadCombatAutoScroll()).toBe(false);
      saveCombatAutoScroll(true);
      expect(loadCombatAutoScroll()).toBe(true);
    });
    it("treats a corrupt value as the safe default (true)", () => {
      // Only the exact "false" token disables it; anything else reads as on.
      localStorage.setItem("fleet_admiral_combat_auto_scroll", "nope");
      expect(loadCombatAutoScroll()).toBe(true);
    });
  });
});
