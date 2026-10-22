import { describe, it, expect, afterEach } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshSecretState,
  cloneSecret,
  serializeSecret,
  deserializeSecret,
  loadSecret,
  saveSecret,
  clearSecretSave,
  SECRET_SAVE_KEY,
} from "./state";
import { SAVE_KEY } from "../game/save";
import { installMemoryStorage, installBlockedStorage, restoreStorage } from "./testStorage";

afterEach(() => restoreStorage());

describe("fresh state", () => {
  it("starts with 10 Ore, four open tiers, nothing owned", () => {
    const s = freshSecretState(1000);
    expect(s.ore.eq(10)).toBe(true);
    expect(s.tiersUnlocked).toBe(4);
    expect(s.bought).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.owned.every((d) => d.eq(0))).toBe(true);
    expect(s.lastTickAt).toBe(1000);
    expect(s.autoTarget).toEqual({ captain: 100, fleet: 100, pc: 100 });
  });

  it("clones deeply", () => {
    const a = freshSecretState(0);
    const b = cloneSecret(a);
    b.bought[0] = 5;
    b.skills.headStart = true;
    b.milestones.googol = 1;
    expect(a.bought[0]).toBe(0);
    expect(a.skills.headStart).toBeUndefined();
    expect(a.milestones.googol).toBeUndefined();
  });
});

describe("serialization", () => {
  it("round-trips every Decimal and counter exactly", () => {
    const s = freshSecretState(12345);
    s.ore = new Decimal("4.21e1284");
    s.owned[2] = new Decimal("8.8e1277");
    s.bought[7] = 3;
    s.overclock = 123456;
    s.captainPoints = new Decimal("1.5e9");
    s.dreamPoints = new Decimal(42);
    s.fleetTotal = 7;
    s.skills.autoCaptain = true;
    s.autoOn.autoCaptain = false;
    s.autoTarget.fleet = 250;
    s.milestones.firstCaptain = 99;
    s.finaleSeen = true;
    const raw = serializeSecret(s);
    const back = deserializeSecret(raw, 0);
    expect(back).not.toBeNull();
    expect(serializeSecret(back!)).toBe(raw);
    expect(back!.ore.eq(new Decimal("4.21e1284"))).toBe(true);
  });

  it("garbage or foreign JSON loads a fresh game", () => {
    for (const raw of ["{", "null", "[]", JSON.stringify({ v: 9 }), JSON.stringify({ ...JSON.parse(serializeSecret(freshSecretState(0))), ore: "NaN" })]) {
      expect(deserializeSecret(raw, 0)).toBeNull();
    }
    expect(deserializeSecret(null, 0)).toBeNull();
  });
});

describe("storage", () => {
  it("uses its own key, never the main save's", () => {
    expect(SECRET_SAVE_KEY).toBe("hl_secret_v0");
    expect(SECRET_SAVE_KEY).not.toBe(SAVE_KEY);
  });

  it("saves, loads and clears under its own key only", () => {
    const data = installMemoryStorage();
    data.set(SAVE_KEY, "main-save-untouched");
    const s = freshSecretState(500);
    s.bought[0] = 4;
    expect(saveSecret(s)).toBe(true);
    expect(loadSecret(900).bought[0]).toBe(4);
    clearSecretSave();
    expect(data.has(SECRET_SAVE_KEY)).toBe(false);
    expect(data.get(SAVE_KEY)).toBe("main-save-untouched");
    expect(loadSecret(900).bought[0]).toBe(0);
  });

  it("blocked storage still runs", () => {
    installBlockedStorage();
    const s = loadSecret(77);
    expect(s.lastTickAt).toBe(77);
    expect(saveSecret(s)).toBe(false);
    expect(() => clearSecretSave()).not.toThrow();
  });
});
