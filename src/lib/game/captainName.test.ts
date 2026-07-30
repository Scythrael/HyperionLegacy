// ============================================================================
// validateCaptainName seam tests (Combat 0.13.0, Phase 1, Task 1.4).
//
// This suite pins the CLIENT-SIDE COURTESY validation chokepoint for captain
// custom names. It exercises each rejection reason in ISOLATION (empty ->
// tooLong -> charset -> profanity, matching the check order) plus the trim
// behavior, and it locks the anti-Scunthorpe guarantee: a benign name that
// merely CONTAINS an innocent substring of a profane token must PASS.
// ============================================================================
import { describe, it, expect } from "vitest";
import { validateCaptainName, MAX_CAPTAIN_NAME } from "./captainName";

describe("validateCaptainName", () => {
  it("accepts a plain name and returns it unchanged", () => {
    expect(validateCaptainName("Ravenscar")).toEqual({ ok: true, value: "Ravenscar" });
  });

  it("trims surrounding whitespace and collapses internal whitespace runs to one space", () => {
    // "  Ravenscar  " -> "Ravenscar"; an internal double space now collapses to one.
    expect(validateCaptainName("  Ravenscar  ")).toEqual({ ok: true, value: "Ravenscar" });
    expect(validateCaptainName("Van  Halen")).toEqual({ ok: true, value: "Van Halen" });
    expect(validateCaptainName("A     B")).toEqual({ ok: true, value: "A B" });
  });

  it("accepts the small safe punctuation set (. ' - _), letters, digits, spaces", () => {
    expect(validateCaptainName("Jean-Luc")).toEqual({ ok: true, value: "Jean-Luc" });
    expect(validateCaptainName("O'Neil")).toEqual({ ok: true, value: "O'Neil" });
    expect(validateCaptainName("Capt. Vex")).toEqual({ ok: true, value: "Capt. Vex" });
    expect(validateCaptainName("Unit_7")).toEqual({ ok: true, value: "Unit_7" });
    expect(validateCaptainName("Ada 2049")).toEqual({ ok: true, value: "Ada 2049" });
  });

  it("rejects an empty string as empty", () => {
    expect(validateCaptainName("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects an all-whitespace string as empty (checked post-trim)", () => {
    expect(validateCaptainName("    ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a name longer than MAX_CAPTAIN_NAME (measured post-trim)", () => {
    const tooLong = "a".repeat(MAX_CAPTAIN_NAME + 1);
    expect(validateCaptainName(tooLong)).toEqual({ ok: false, reason: "tooLong" });
  });

  it("accepts a name exactly MAX_CAPTAIN_NAME long (boundary is inclusive)", () => {
    const exact = "a".repeat(MAX_CAPTAIN_NAME);
    expect(validateCaptainName(exact)).toEqual({ ok: true, value: exact });
  });

  it("counts length AFTER trimming, so surrounding spaces do not push over", () => {
    // MAX chars of content wrapped in spaces must still pass (trim happens first).
    const padded = "  " + "a".repeat(MAX_CAPTAIN_NAME) + "  ";
    expect(validateCaptainName(padded)).toEqual({ ok: true, value: "a".repeat(MAX_CAPTAIN_NAME) });
  });

  it("rejects characters outside the allowed set as charset", () => {
    expect(validateCaptainName("Ravenscar!")).toEqual({ ok: false, reason: "charset" });
    expect(validateCaptainName("na@me")).toEqual({ ok: false, reason: "charset" });
    expect(validateCaptainName("emoji \u{1F600}")).toEqual({ ok: false, reason: "charset" });
  });

  it("rejects a punctuation/space-only name (no letter or digit) as noAlphanumeric", () => {
    expect(validateCaptainName("....")).toEqual({ ok: false, reason: "noAlphanumeric" });
    expect(validateCaptainName("----")).toEqual({ ok: false, reason: "noAlphanumeric" });
    expect(validateCaptainName("_-_")).toEqual({ ok: false, reason: "noAlphanumeric" });
    // A single letter or digit is enough to pass this check.
    expect(validateCaptainName("x.")).toEqual({ ok: true, value: "x." });
  });

  it("rejects a profane token as profanity (case-insensitive, whole-token match)", () => {
    expect(validateCaptainName("shit")).toEqual({ ok: false, reason: "profanity" });
    expect(validateCaptainName("ShIt")).toEqual({ ok: false, reason: "profanity" });
    // A profane token as one word among several is still caught (token boundary).
    expect(validateCaptainName("Captain Shit")).toEqual({ ok: false, reason: "profanity" });
  });

  it("does NOT false-positive on innocent names containing a profane substring (anti-Scunthorpe)", () => {
    // "Scunthorpe" contains the substring the eponymous problem is named for;
    // a conservative token-boundary match must let it through untouched.
    expect(validateCaptainName("Scunthorpe")).toEqual({ ok: true, value: "Scunthorpe" });
    // "Assumption" and "Shitake"-adjacent innocents also pass under token matching.
    expect(validateCaptainName("Assumption")).toEqual({ ok: true, value: "Assumption" });
  });
});
