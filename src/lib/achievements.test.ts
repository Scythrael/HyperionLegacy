import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { readFileSync } from "node:fs";
import { enqueueAchievement, pushAchievement, dismissAchievement, achievementQueue, clearAchievements, ACHIEVEMENT_SHOW_MS, type Achievement } from "./achievements";

const a = (id: string): Achievement => ({ id, title: id, requirement: "r", reward: "Reward: x" });

beforeEach(() => clearAchievements());

describe("the achievement queue", () => {
  it("appends in order and never queues the same achievement twice", () => {
    expect(enqueueAchievement([a("x")], a("y")).map((q) => q.id)).toEqual(["x", "y"]);
    expect(enqueueAchievement([a("x")], a("x")).map((q) => q.id)).toEqual(["x"]);
  });

  it("several at once queue up and leave one by one", () => {
    pushAchievement(a("one"));
    pushAchievement(a("two"));
    pushAchievement(a("three"));
    expect(get(achievementQueue).map((q) => q.id)).toEqual(["one", "two", "three"]);
    dismissAchievement("one");
    expect(get(achievementQueue).map((q) => q.id)).toEqual(["two", "three"]);
  });

  it("shows for about four seconds", () => {
    expect(ACHIEVEMENT_SHOW_MS).toBe(4000);
  });
});

describe("the popup component", () => {
  const src = readFileSync("src/lib/AchievementToasts.svelte", "utf-8");
  it("announces politely, dismisses on tap or key, and only moves when motion is welcome", () => {
    expect(src).toMatch(/aria-live="polite"/);
    expect(src).toMatch(/Achievement obtained:/);
    expect(src).toMatch(/on:click=/);
    const guard = src.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(guard).toBeGreaterThan(0);
    for (const m of src.matchAll(/animation:/g)) expect(m.index!).toBeGreaterThan(guard);
    expect(src).toMatch(/data-reduced-motion="on"/);
  });
  it("sits above the minigame overlay", () => {
    const overlay = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    const z = (s: string, cls: string) => Number(new RegExp(`\\.${cls} \\{[^}]*z-index: (\\d+)`).exec(s)![1]);
    expect(z(src, "ach-host")).toBeGreaterThan(z(overlay, "sg-backdrop"));
  });
});
