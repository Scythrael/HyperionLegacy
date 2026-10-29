// relicRuntime.test.ts: R2-10, the runtime takes the main game's relic boosts as a snapshot.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import { secretGame, startSecretRuntime, secretAct, setSecretRelicBoosts, wipeSecretGame } from "./runtime";
import { resetTrustedTimeForTests } from "../trustedTime";
import { SECRET_SAVE_KEY } from "./state";
import { buyTier, gamePace } from "./engine";
import { installMemoryStorage, restoreStorage } from "./testStorage";
import { typicalMuseum, typicalBoosts } from "./relicCollections";
import { emptyMuseumV2 } from "../game/model";

let stop: (() => void) | null = null;
beforeEach(() => {
  resetTrustedTimeForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T18:00:00Z"));
});
afterEach(() => {
  stop?.();
  stop = null;
  setSecretRelicBoosts(undefined);
  vi.useRealTimers();
  restoreStorage();
});

describe("relic boosts in the secret runtime", () => {
  it("read before the start: the first state already carries them, and the save never does", () => {
    const data = installMemoryStorage();
    setSecretRelicBoosts(typicalMuseum());
    stop = startSecretRuntime();
    expect(get(secretGame).relicBoosts).toEqual(typicalBoosts());
    secretAct((s) => buyTier(s, 0, "one"));
    expect(get(secretGame).relicBoosts).toEqual(typicalBoosts());
    // (0.14.0 Slice 5a: a typical collection is Tier I under the tier stagger, so no Ancient Drive Coil yet: the
    // game clock is untouched, and the ceiling fraction rides along)
    expect(gamePace(get(secretGame))).toBe(1);
    expect(get(secretGame).relicBoosts!.ceiling).toBeGreaterThan(0);
    expect(data.get(SECRET_SAVE_KEY)).not.toContain("relicBoosts");
  });

  it("a later main save updates them on the live state; a Museum with no relics removes the field", () => {
    installMemoryStorage();
    stop = startSecretRuntime();
    expect(get(secretGame).relicBoosts).toBeUndefined();
    setSecretRelicBoosts(typicalMuseum());
    expect(get(secretGame).relicBoosts).toEqual(typicalBoosts());
    const same = get(secretGame);
    setSecretRelicBoosts(typicalMuseum()); // the same values: nothing republishes
    expect(get(secretGame)).toBe(same);
    setSecretRelicBoosts(emptyMuseumV2());
    expect("relicBoosts" in get(secretGame)).toBe(false);
  });

  it("a wipe keeps reading the main game's relics", () => {
    installMemoryStorage();
    setSecretRelicBoosts(typicalMuseum());
    stop = startSecretRuntime();
    wipeSecretGame();
    expect(get(secretGame).relicBoosts).toEqual(typicalBoosts());
  });

  it("a broken Museum record never throws into the app", () => {
    installMemoryStorage();
    stop = startSecretRuntime();
    expect(() => setSecretRelicBoosts({ general: { "1": null } } as never)).not.toThrow();
  });
});
