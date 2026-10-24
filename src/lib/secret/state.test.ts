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

describe("0.13.11.1 fields", () => {
  const NEW_KEYS = ["upgrades", "found", "foundAt", "peakOwned", "peakOverclock", "upgradesNoteSeen"];
  // A save exactly as 0.13.11 wrote it: none of the new keys.
  function oldShape(s: ReturnType<typeof freshSecretState>): string {
    const raw = JSON.parse(serializeSecret(s));
    for (const k of NEW_KEYS) delete raw[k];
    return JSON.stringify(raw);
  }

  it("a fresh state starts unfound, with no upgrades and peaks at zero", () => {
    const s = freshSecretState(0);
    expect(s.found).toBe(false);
    expect(s.foundAt).toBeNull();
    expect(s.upgrades).toEqual({ ocOverclocker: 0, tenfoldTuner: 0, captainsCompound: 0, lucidDreaming: 0, turboEncabulator: 0, overdriveOverdrive: 0, singularitySharpener: 0 });
    expect(s.peakOwned.every((d) => d.eq(0))).toBe(true);
    expect(s.peakOverclock).toBe(0);
    expect(s.upgradesNoteSeen).toBe(false);
  });

  it("a 0.13.11 save loads with every new field defaulted, and a played one counts as found", () => {
    const s = freshSecretState(0);
    s.ore = new Decimal("1e500");
    s.bought[0] = 40;
    s.owned[0] = new Decimal("3e400");
    s.overclock = 77;
    s.captainCount = 3;
    s.milestones = { googol: 5000, firstCaptain: 2000 };
    const back = deserializeSecret(oldShape(s), 0)!;
    expect(back).not.toBeNull();
    expect(back.ore.eq(new Decimal("1e500"))).toBe(true);
    expect(back.milestones).toEqual({ googol: 5000, firstCaptain: 2000 });
    expect(back.upgrades.ocOverclocker).toBe(0);
    expect(back.found).toBe(true);
    expect(back.foundAt).toBe(2000); // the earliest recorded milestone
    expect(back.peakOwned[0].eq(new Decimal("3e400"))).toBe(true);
    expect(back.peakOverclock).toBe(77);
  });

  it("an untouched 0.13.11 save (the runtime saves one for everyone) is not found", () => {
    const back = deserializeSecret(oldShape(freshSecretState(5)), 0)!;
    expect(back.found).toBe(false);
    expect(back.foundAt).toBeNull();
  });

  it("round-trips every new field", () => {
    const s = freshSecretState(0);
    s.found = true;
    s.foundAt = 1234;
    s.upgrades = { ocOverclocker: 3, tenfoldTuner: 1, captainsCompound: 0, lucidDreaming: 2, turboEncabulator: 0, overdriveOverdrive: 0, singularitySharpener: 0 };
    s.peakOwned[4] = new Decimal("5e77");
    s.peakOverclock = 999;
    s.upgradesNoteSeen = true;
    const raw = serializeSecret(s);
    const back = deserializeSecret(raw, 0)!;
    expect(serializeSecret(back)).toBe(raw);
  });

  it("bad values in the new fields fall back to defaults instead of rejecting the save", () => {
    const raw = JSON.parse(serializeSecret(freshSecretState(0)));
    raw.upgrades = { ocOverclocker: -3, tenfoldTuner: "x", captainsCompound: 2.7, lucidDreaming: 999 };
    raw.found = "yes";
    raw.foundAt = "soon";
    raw.peakOwned = [1, 2];
    raw.peakOverclock = -1;
    const back = deserializeSecret(JSON.stringify(raw), 0)!;
    expect(back).not.toBeNull();
    expect(back.upgrades).toEqual({ ocOverclocker: 0, tenfoldTuner: 0, captainsCompound: 2, lucidDreaming: 10, turboEncabulator: 0, overdriveOverdrive: 0, singularitySharpener: 0 });
    expect(back.found).toBe(false);
    expect(back.foundAt).toBeNull();
    expect(back.peakOwned.every((d) => d.eq(0))).toBe(true);
    expect(back.peakOverclock).toBe(0);
  });

  it("clones the new containers deeply", () => {
    const a = freshSecretState(0);
    const b = cloneSecret(a);
    b.upgrades.ocOverclocker = 4;
    b.peakOwned[0] = new Decimal(9);
    expect(a.upgrades.ocOverclocker).toBe(0);
    expect(a.peakOwned[0].eq(0)).toBe(true);
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

describe("0.13.11.1 curve round: Captain Points saved on the old scale", () => {
  it("a save without captainScale has its points converted once, so the Captain bonus is unchanged", async () => {
    const { captainMultiplier } = await import("./engine");
    const { CP_POW_BEFORE_CURVE_ROUND } = await import("./config");
    const old = freshSecretState(0);
    old.captainPoints = new Decimal(1.58e8);
    const raw = JSON.parse(serializeSecret(old));
    delete raw.captainScale;
    const loaded = deserializeSecret(JSON.stringify(raw), 0)!;
    const before = Math.pow(1 + 1.58e8, CP_POW_BEFORE_CURVE_ROUND);
    expect(captainMultiplier(loaded).toNumber() / before).toBeCloseTo(1, 9);
    expect(loaded.captainPoints.lt(1.58e8)).toBe(true);
    expect(loaded.captainScale).toBe(2);
    // and only once: saved again and loaded again, nothing moves
    const again = deserializeSecret(serializeSecret(loaded), 0)!;
    expect(again.captainPoints.eq(loaded.captainPoints)).toBe(true);
  });

  it("no Captain Points, nothing to convert; every other field is untouched", () => {
    const old = freshSecretState(0);
    old.augmentPoints = new Decimal(77);
    const raw = JSON.parse(serializeSecret(old));
    delete raw.captainScale;
    const loaded = deserializeSecret(JSON.stringify(raw), 0)!;
    expect(loaded.captainPoints.eq(0)).toBe(true);
    expect(loaded.augmentPoints.eq(77)).toBe(true);
  });
});
