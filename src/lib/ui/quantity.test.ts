import { describe, it, expect } from "vitest";
import { wholeUnitsFree, clampWholeQty } from "./quantity";

// Pins the two guarantees the Salvage Bay's batch control now depends on:
//   1. a fractional max can never produce a fractional quantity, and
//   2. the quantity never exceeds the whole units actually free.
//
// The reproduction values are the ones from the reported defect: 1.21K held with
// 1000 queued leaves 213.71000000000004 free, which the old inline clamp handed
// back verbatim onto a button reading "Salvage · ×213.71000000000004" while the
// max readout beside it said "(max 213)" and the engine queued 213.

describe("wholeUnitsFree", () => {
  it("floors a fractional free stock to whole queueable units", () => {
    expect(wholeUnitsFree(213.71000000000004)).toBe(213);
    expect(wholeUnitsFree(226.71000000000004)).toBe(226);
    expect(wholeUnitsFree(1225.71)).toBe(1225);
  });

  it("passes a whole stock through unchanged", () => {
    expect(wholeUnitsFree(0)).toBe(0);
    expect(wholeUnitsFree(1)).toBe(1);
    expect(wholeUnitsFree(5000)).toBe(5000);
  });

  it("reports 0 for a sub-unit stock, which is what the control disables on", () => {
    // Half a unit cannot be salvaged, so the honest answer is "none", not "one".
    expect(wholeUnitsFree(0.5)).toBe(0);
    expect(wholeUnitsFree(0.999999)).toBe(0);
  });

  it("clamps a negative allowance to 0 rather than returning a negative", () => {
    // An out-of-band inventory drop (an over-cap clamp, a mission spending stock)
    // can make held-minus-reserved go negative; that means nothing free.
    expect(wholeUnitsFree(-3)).toBe(0);
  });

  it("treats a non-finite stock as nothing free", () => {
    expect(wholeUnitsFree(NaN)).toBe(0);
    expect(wholeUnitsFree(Infinity)).toBe(0);
  });
});

describe("clampWholeQty", () => {
  it("returns a WHOLE number when the max is fractional (the reported defect)", () => {
    const qty = clampWholeQty(1000, 213.71000000000004);
    expect(qty).toBe(213);
    expect(Number.isInteger(qty)).toBe(true);
  });

  it("never exceeds the whole units actually free, for any raw input", () => {
    const free = 213.71000000000004;
    for (const raw of [1, 200, 213, 214, 1000, 999999, 213.9]) {
      const qty = clampWholeQty(raw, free);
      expect(Number.isInteger(qty)).toBe(true);
      expect(qty).toBeLessThanOrEqual(Math.floor(free));
    }
  });

  it("floors a fractional raw form value", () => {
    expect(clampWholeQty(7.9, 100)).toBe(7);
  });

  it("floors at 1 for a zero, negative or blank field while units are free", () => {
    // An empty number input binds to NaN; the smallest real order is 1.
    expect(clampWholeQty(NaN, 100)).toBe(1);
    expect(clampWholeQty(0, 100)).toBe(1);
    expect(clampWholeQty(-5, 100)).toBe(1);
  });

  it("returns 0 when fewer than one whole unit is free, instead of offering an order the engine would refuse", () => {
    // The old clamp's Math.max(1, max) offered 1 here, producing an ENABLED button
    // whose click exceedsFreeSalvageUnits rejected (1 > 0.5) with only a log line.
    expect(clampWholeQty(1, 0.5)).toBe(0);
    expect(clampWholeQty(1, 0)).toBe(0);
    expect(clampWholeQty(50, -2)).toBe(0);
  });

  it("accepts exactly the free amount when the stock is a whole number", () => {
    // The boundary the enqueue gate uses: units > free is refused, units === free is not.
    expect(clampWholeQty(213, 213)).toBe(213);
    expect(clampWholeQty(214, 213)).toBe(213);
  });
});
