import { describe, it, expect } from "vitest";
import { CODE_TABLE, redeemCode, redeemMessage } from "./codes";

describe("redeemCode", () => {
  it("ships with no codes", () => {
    expect(CODE_TABLE.size).toBe(0);
  });

  it("an empty field asks for a code", () => {
    expect(redeemCode("")).toEqual({ kind: "empty" });
    expect(redeemCode("   ")).toEqual({ kind: "empty" });
    expect(redeemMessage({ kind: "empty" })).toBe("Type a code first.");
  });

  it("any code is not recognized in 0.13.11", () => {
    expect(redeemCode("abcd-1234")).toEqual({ kind: "unknown" });
    expect(redeemMessage({ kind: "unknown" })).toBe("That code isn't recognized.");
  });

  it("is a real seam: a table entry redeems, case and spaces ignored", () => {
    const table = new Map([["GIFT1", "g1"]]);
    expect(redeemCode("  gift1 ", table)).toEqual({ kind: "redeemed", giftId: "g1" });
    expect(redeemCode("GIFT2", table)).toEqual({ kind: "unknown" });
  });
});
