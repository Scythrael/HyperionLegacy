import { describe, it, expect } from "vitest";
import { freshState } from "./game/model";
import { serialize, deserialize, migrate } from "./game/save";
import { redeemGift, hasThemeStyle, unlockThemeStyle, NO_STREAK, ENDLESS_GREED, type RedeemStreak } from "./accountExtras";
import { JOKE_LINES } from "./secret/codes";

const rng = (() => {
  let seed = 11;
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
})();

describe("redeemGift", () => {
  it("pays 1,337 credits once per account", () => {
    const s0 = freshState();
    const first = redeemGift(s0, "SUPERDUPERLEET", NO_STREAK, rng);
    expect(first.outcome).toEqual({ kind: "redeemed", credits: 1337 });
    expect(first.next.credits.sub(s0.credits).toNumber()).toBe(1337);
    expect(first.next.redeemedGifts).toEqual(["leetCredits"]);
    const again = redeemGift(first.next, "superduperleet", first.streak, rng);
    expect(again.outcome.kind).toBe("already");
    expect(again.next.credits.eq(first.next.credits)).toBe(true);
    expect(again.next.redeemedGifts).toEqual(["leetCredits"]);
  });

  it("empty and unknown codes change nothing (same state reference)", () => {
    const s0 = freshState();
    const e = redeemGift(s0, "  ", NO_STREAK, rng);
    expect(e.outcome).toEqual({ kind: "empty" });
    expect(e.next).toBe(s0);
    const u = redeemGift(s0, "NOPE", NO_STREAK, rng);
    expect(u.outcome).toEqual({ kind: "unknown" });
    expect(u.next).toBe(s0);
    expect(u.streak).toEqual(NO_STREAK);
  });

  it("adds a joke line from the third re-entry in a row, never the same twice running, and records it", () => {
    let s = redeemGift(freshState(), "SUPERDUPERLEET", NO_STREAK, rng).next;
    let streak: RedeemStreak = NO_STREAK;
    const one = redeemGift(s, "SUPERDUPERLEET", streak, rng);
    expect(one.outcome).toEqual({ kind: "already", endlessGreed: false });
    expect(one.next).toBe(s);
    streak = one.streak;
    const two = redeemGift(s, "SUPERDUPERLEET", streak, rng);
    expect(two.outcome).toEqual({ kind: "already", endlessGreed: false });
    streak = two.streak;
    let last: number | null = null;
    for (let i = 0; i < 5; i++) {
      const r = redeemGift(s, "SUPERDUPERLEET", streak, rng);
      if (r.outcome.kind !== "already" || !r.outcome.line) throw new Error("expected a line");
      expect(r.outcome.line.id).not.toBe(last);
      expect(r.outcome.line.text).toBe(JOKE_LINES[r.outcome.line.id - 1]);
      expect(r.next.seenCodeLines).toContain(r.outcome.line.id);
      last = r.outcome.line.id;
      s = r.next;
      streak = r.streak;
    }
  });

  it("any other result breaks the streak", () => {
    let s = redeemGift(freshState(), "SUPERDUPERLEET", NO_STREAK, rng).next;
    let streak = redeemGift(s, "SUPERDUPERLEET", NO_STREAK, rng).streak;
    streak = redeemGift(s, "SUPERDUPERLEET", streak, rng).streak;
    streak = redeemGift(s, "WRONG", streak, rng).streak;
    const r = redeemGift(s, "SUPERDUPERLEET", streak, rng);
    expect(r.outcome).toEqual({ kind: "already", endlessGreed: false });
  });

  it("unseen lines come first: 40 lines in the first 40 re-entries that carry one", () => {
    let s = redeemGift(freshState(), "SUPERDUPERLEET", NO_STREAK, rng).next;
    let streak: RedeemStreak = NO_STREAK;
    let withLine = 0;
    while ((s.seenCodeLines?.length ?? 0) < 40 && withLine < 100) {
      const r = redeemGift(s, "SUPERDUPERLEET", streak, rng);
      if (r.outcome.kind === "already" && r.outcome.line) withLine += 1;
      s = r.next;
      streak = r.streak;
    }
    expect(withLine).toBe(40);
    expect(s.endlessGreedAt).toBeDefined();
  });

  it("seeing all 40 lines earns Endless Greed exactly once", () => {
    let s = redeemGift(freshState(), "SUPERDUPERLEET", NO_STREAK, rng).next;
    let streak: RedeemStreak = NO_STREAK;
    let earned = 0;
    for (let i = 0; i < 3000 && (s.seenCodeLines?.length ?? 0) < 40; i++) {
      const r = redeemGift(s, "SUPERDUPERLEET", streak, rng, 1000 + i);
      if (r.outcome.kind === "already" && r.outcome.endlessGreed) earned += 1;
      s = r.next;
      streak = r.streak;
    }
    expect(s.seenCodeLines?.length).toBe(40);
    expect(earned).toBe(1);
    expect(s.endlessGreedAt).toBeGreaterThan(0);
    const more = redeemGift(s, "SUPERDUPERLEET", streak, rng, 999999);
    expect(more.outcome.kind === "already" && more.outcome.endlessGreed).toBe(false);
    expect(ENDLESS_GREED.title).toBe("Endless Greed");
  });
});

describe("theme style unlocks", () => {
  it("unlock is idempotent and same-ref when already present", () => {
    const s0 = freshState();
    expect(hasThemeStyle(s0, "washShine")).toBe(false);
    const s1 = unlockThemeStyle(s0, "washShine");
    expect(hasThemeStyle(s1, "washShine")).toBe(true);
    expect(unlockThemeStyle(s1, "washShine")).toBe(s1);
  });
});

describe("the account-level fields in the main save", () => {
  it("a fresh save has none of them (Delete Save and Debug Reset start from freshState)", () => {
    const s = freshState() as unknown as Record<string, unknown>;
    for (const k of ["redeemedGifts", "seenCodeLines", "endlessGreedAt", "unlockedThemeStyles"]) expect(k in s).toBe(false);
  });

  it("round-trip through serialize, deserialize and migrate", () => {
    let s = redeemGift(freshState(), "SUPERDUPERLEET", NO_STREAK, rng).next;
    s = unlockThemeStyle({ ...s, seenCodeLines: [3, 17], endlessGreedAt: 123456 }, "washShine");
    const file = deserialize(serialize(s, 1, 2));
    expect(file).not.toBeNull();
    const back = migrate(file!);
    expect(back.redeemedGifts).toEqual(["leetCredits"]);
    expect(back.seenCodeLines).toEqual([3, 17]);
    expect(back.endlessGreedAt).toBe(123456);
    expect(back.unlockedThemeStyles).toEqual(["washShine"]);
    expect(back.credits.toNumber()).toBe(s.credits.toNumber());
  });

  it("a save without them (every save before 0.13.11.1) behaves as nothing redeemed", () => {
    const back = migrate(deserialize(serialize(freshState(), 1, 2))!);
    expect(redeemGift(back, "SUPERDUPERLEET", NO_STREAK, rng).outcome).toEqual({ kind: "redeemed", credits: 1337 });
    expect(hasThemeStyle(back, "washShine")).toBe(false);
  });

  it("garbage in the fields is ignored rather than trusted", () => {
    const s = { ...freshState(), redeemedGifts: "leetCredits" as unknown as string[], seenCodeLines: [1, "x", 99] as unknown as number[] };
    const r = redeemGift(s, "SUPERDUPERLEET", NO_STREAK, rng);
    expect(r.outcome).toEqual({ kind: "redeemed", credits: 1337 });
    expect(r.next.redeemedGifts).toEqual(["leetCredits"]);
  });
});
