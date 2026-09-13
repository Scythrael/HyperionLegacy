import { describe, it, expect, vi } from "vitest";
import { loadHeaderExpanded, saveHeaderExpanded, resolveHeaderExpanded } from "./headerPreference";

function installStorage(seed: Record<string, string> = {}): Record<string, string> {
  const store: Record<string, string> = { ...seed };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  });
  return store;
}

describe("the header's remembered expansion state", () => {
  it("⚠️ reports NULL when the player has never chosen, which is not the same as 'collapsed'", () => {
    // THE CASE THE WHOLE FILE EXISTS FOR. If an absent key read as `false`, a desktop player who
    // deliberately collapsed the header would be indistinguishable from one who never touched it,
    // and their choice would be overwritten by the platform default on every load.
    installStorage();
    expect(loadHeaderExpanded()).toBeNull();
  });

  it("round-trips both real choices", () => {
    installStorage();
    saveHeaderExpanded(true);
    expect(loadHeaderExpanded()).toBe(true);
    saveHeaderExpanded(false);
    expect(loadHeaderExpanded()).toBe(false);
  });

  it("treats a malformed stored value as 'never chosen' rather than trusting it", () => {
    installStorage({ fleet_admiral_header_expanded: "yes" });
    expect(loadHeaderExpanded()).toBeNull();
  });
});

describe("resolveHeaderExpanded: the platform default, and when it applies", () => {
  it("defaults a PHONE to compact and a DESKTOP to expanded", () => {
    // The platform split at its smallest: one component, one dataset, one different default.
    expect(resolveHeaderExpanded(null, 390)).toBe(false);
    expect(resolveHeaderExpanded(null, 1440)).toBe(true);
  });

  it("⚠️ a REMEMBERED choice beats the platform default, in both directions", () => {
    // Including the awkward direction: a phone player who wants the detail, and a desktop player
    // who wants their screen back. A default that cannot be overridden is not a default.
    expect(resolveHeaderExpanded(true, 390)).toBe(true);
    expect(resolveHeaderExpanded(false, 1440)).toBe(false);
  });

  it("switches at the same 768px the rest of the app calls narrow", () => {
    // Pinned so the header cannot drift into having its own private idea of "phone".
    expect(resolveHeaderExpanded(null, 768)).toBe(false);
    expect(resolveHeaderExpanded(null, 769)).toBe(true);
  });
});
