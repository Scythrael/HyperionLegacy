import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tabKeyTarget, overlayClosesOn } from "./overlayKeys";

describe("overlay keyboard rules", () => {
  it("arrow keys move between tabs and wrap; Home and End jump", () => {
    expect(tabKeyTarget(0, "ArrowRight", 4)).toBe(1);
    expect(tabKeyTarget(3, "ArrowRight", 4)).toBe(0);
    expect(tabKeyTarget(0, "ArrowLeft", 4)).toBe(3);
    expect(tabKeyTarget(2, "Home", 4)).toBe(0);
    expect(tabKeyTarget(1, "End", 4)).toBe(3);
    expect(tabKeyTarget(1, "KeyA", 4)).toBeNull();
  });

  it("Escape closes the overlay unless another handler already used it", () => {
    expect(overlayClosesOn({ key: "Escape", defaultPrevented: false })).toBe(true);
    expect(overlayClosesOn({ key: "Escape", defaultPrevented: true })).toBe(false);
    expect(overlayClosesOn({ key: "Enter", defaultPrevented: false })).toBe(false);
  });
});

describe("overlay focus wiring (source)", () => {
  const src = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
  it("moves focus into the overlay after it is portaled, and closes on Escape from anywhere", () => {
    expect(src).toMatch(/onMount\([\s\S]*focusInside\(\)/);
    expect(src).toContain("<svelte:window on:keydown={onWindowKeydown}");
    expect(src).toContain("overlayClosesOn(event)");
  });
  it("pulls focus back when something under it (a main-game modal) takes it", () => {
    expect(src).toMatch(/addEventListener\("focusin"/);
  });
  it("is a real tablist: ids, aria-controls, labeled panel, roving tabindex, arrow keys", () => {
    expect(src).toContain('aria-controls="sg-panel"');
    expect(src).toContain('aria-labelledby={`sg-tab-${tab}`}');
    expect(src).toMatch(/tabindex=\{tab === t\.key \? 0 : -1\}/);
    expect(src).toContain("tabKeyTarget(");
  });
  it("holds every control while catching up, and focuses Keep going when a celebration appears", () => {
    expect(src).toContain('disabled={busy} on:click={() => dismissCelebration("finale")}');
    expect(src).toContain('disabled={busy} on:click={() => dismissCelebration("long")}');
    expect(src).toContain("keepGoing?.focus()");
    expect(src).toMatch(/<select[^>]*disabled=\{busy\}/);
    expect(src).toMatch(/aria-pressed=\{autoActive\(s, d\.id\)\}\s*disabled=\{busy\}/);
  });
});
