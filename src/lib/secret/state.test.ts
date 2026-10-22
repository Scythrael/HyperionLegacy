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
  SECRET_BACKUP_KEY,
  inspectSecretSave,
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

describe("range checks", () => {
  const base = () => JSON.parse(serializeSecret(freshSecretState(0)));
  it("drops unknown skills, bad switches and non-numeric milestone dates", () => {
    const raw = base();
    raw.skills = { headStart: true, wings: true, overdrive: "yes" };
    raw.autoOn = { autoCaptain: false, bogus: true, autoFleet: 3 };
    raw.milestones = { googol: 5, finale: "soon", e1000: null, nope: 1 };
    const s = deserializeSecret(JSON.stringify(raw), 0)!;
    expect(s.skills).toEqual({ headStart: true });
    expect(s.autoOn).toEqual({ autoCaptain: false });
    expect(s.milestones).toEqual({ googol: 5 });
  });
  it("resets a non-positive auto target to the default", () => {
    const raw = base();
    raw.autoTarget = { captain: 0, fleet: -5, pc: 250 };
    expect(deserializeSecret(JSON.stringify(raw), 0)!.autoTarget).toEqual({ captain: 100, fleet: 100, pc: 250 });
  });
  it("rejects negative levels and counts, and non-finite Ore", () => {
    for (const patch of [{ overclock: -1 }, { fleetTotal: -2 }, { ore: "Infinity" }, { bought: [1, 2, 3, 4, 5, 6, 7, -8] }]) {
      expect(deserializeSecret(JSON.stringify({ ...base(), ...patch }), 0)).toBeNull();
    }
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

  it("keeps a corrupt or future-version save under the backup key", () => {
    const data = installMemoryStorage();
    data.set(SECRET_SAVE_KEY, "{broken");
    expect(inspectSecretSave(0).status).toBe("corrupt");
    expect(data.get(SECRET_BACKUP_KEY)).toBe("{broken");
    const future = JSON.stringify({ v: 3, anything: 1 });
    data.set(SECRET_SAVE_KEY, future);
    expect(inspectSecretSave(0).status).toBe("future");
    expect(data.get(SECRET_BACKUP_KEY)).toBe(future);
    expect(data.get(SECRET_SAVE_KEY)).toBe(future);
    data.delete(SECRET_SAVE_KEY);
    expect(inspectSecretSave(0).status).toBe("empty");
  });

  it("blocked storage still runs", () => {
    installBlockedStorage();
    const s = loadSecret(77);
    expect(s.lastTickAt).toBe(77);
    expect(saveSecret(s)).toBe(false);
    expect(() => clearSecretSave()).not.toThrow();
  });
});
