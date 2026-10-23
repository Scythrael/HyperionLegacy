import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CODE_TABLE, GIFTS, JOKE_LINES, lookupCode, normalizeCode, pickJokeLine } from "./codes";
import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  it("matches the published test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
});

describe("gift codes", () => {
  it("normalizes case, spaces and dashes", () => {
    expect(normalizeCode(" super-duper leet ")).toBe("SUPERDUPERLEET");
    expect(normalizeCode("Super-Duper-Leet")).toBe("SUPERDUPERLEET");
  });

  it("an empty field asks for a code", () => {
    expect(lookupCode("")).toEqual({ kind: "empty" });
    expect(lookupCode("  - ")).toEqual({ kind: "empty" });
  });

  it("SUPERDUPERLEET is the first real code, worth 1,337 credits", () => {
    expect(lookupCode("SUPERDUPERLEET")).toEqual({ kind: "gift", giftId: "leetCredits" });
    expect(lookupCode("super duper-leet")).toEqual({ kind: "gift", giftId: "leetCredits" });
    expect(GIFTS.leetCredits.credits).toBe(1337);
    expect(lookupCode("SUPERDUPERLEE")).toEqual({ kind: "unknown" });
  });

  it("keeps no code in plain text: the table is keyed by SHA-256", () => {
    for (const key of CODE_TABLE.keys()) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(CODE_TABLE.get(sha256Hex("SUPERDUPERLEET"))).toBe("leetCredits");
    const src = readFileSync("src/lib/secret/codes.ts", "utf-8");
    expect(src.toUpperCase()).not.toContain("SUPERDUPERLEET");
  });

  it("a custom table still works as a seam", () => {
    const table = new Map([[sha256Hex("GIFT1"), "leetCredits" as const]]);
    expect(lookupCode("gift-1", table)).toEqual({ kind: "gift", giftId: "leetCredits" });
  });
});

describe("the joke lines", () => {
  it("are the 40 approved lines, the user's own first", () => {
    expect(JOKE_LINES.length).toBe(40);
    expect(JOKE_LINES[0]).toBe("Why won't you leave any for us, Fleet Admiral? Space orphans are out there starving.");
    expect(JOKE_LINES[39]).toBe("Congratulations! You've unlocked... nothing. Again. Impressive consistency, though.");
    expect(new Set(JOKE_LINES).size).toBe(40);
  });

  it("match the approved file word for word", () => {
    const md = readFileSync("docs/plans/2026-10-23-code-redeemed-joke-lines.md", "utf-8").replace(/\r\n/g, "\n");
    const approved = [...md.matchAll(/^\d+\. "(.*)"$/gm)].map((m) => m[1]);
    expect(approved).toEqual([...JOKE_LINES]);
  });

  it("unseen lines first (user, 2026-10-23): forty picks in a row show forty different lines", () => {
    let seed = 3;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const seen: number[] = [];
    let last: number | null = null;
    for (let i = 0; i < 40; i++) {
      const id = pickJokeLine(last, rng, seen);
      expect(seen).not.toContain(id);
      seen.push(id);
      last = id;
    }
    expect(new Set(seen).size).toBe(40);
    // with one line left unseen, that is the one, whatever the dice say
    const all = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(pickJokeLine(5, () => 0.999, all.filter((x) => x !== 17))).toBe(17);
  });

  it("once every line is seen: uniform random, never the line shown last", () => {
    const all = Array.from({ length: 40 }, (_, i) => i + 1);
    // mulberry32: a test rng good enough for a frequency check
    let a = 9;
    const rng = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const counts = new Map<number, number>();
    let last: number | null = null;
    for (let i = 0; i < 4000; i++) {
      const id = pickJokeLine(last, rng, all);
      expect(id).not.toBe(last);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      last = id;
    }
    expect(counts.size).toBe(40);
    for (const n of counts.values()) expect(n).toBeGreaterThan(50); // about 100 each
  });

  it("never picks the line shown last, and reaches every line", () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const seen = new Set<number>();
    let last: number | null = null;
    for (let i = 0; i < 2000; i++) {
      const id = pickJokeLine(last, rng);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(40);
      expect(id).not.toBe(last);
      seen.add(id);
      last = id;
    }
    expect(seen.size).toBe(40);
    // an rng at its edge still stays in range and off the last line
    expect(pickJokeLine(40, () => 0.999999)).toBe(39);
    expect(pickJokeLine(1, () => 0)).toBe(2);
  });
});
