// WR-1 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.3): THE SENSITIVITY LEVEL.
//
// For every registry entry and every context it claims LIVE: build the fixture, read the entry's seam probe without
// the source and with it, and assert
//   1. DIRECTION: the value moved the declared way (a buff that hurts fails), and
//   2. MAGNITUDE THROUGH THE CURVE: the move equals curve(magnitude), where the magnitude is read from the catalog,
//      exactly at a pure seam and within the entry's tolerance (one rounding step) where the outcome is an integer.
//      "The 8% will change, but the effect of that 8% will not" (user, capture 2026-10-15 section 5): a retune stays
//      green, a broken wire fails. An event entry asserts the direction and a minimum effect size.
// For every entry that is NOT live but already has a probe on its claimed value, assert the value does NOT move,
// so a pending entry that starts working fails here until its status is flipped to live (the list cannot rot).

import { describe, it, expect } from "vitest";
import { CATALOGS, WIRING_REGISTRY, WIRING_SYSTEMS, curveExpected, type WiringEntry } from "./wiring/registry";
import { readProbe, type ContextId } from "./wiring/probes";

function measure(e: WiringEntry, ctx: ContextId): { off: number; on: number } {
  const s0 = e.base();
  return { off: readProbe(e.probe!, e.off(s0), ctx), on: readProbe(e.probe!, e.on(s0), ctx) };
}

function checkLive(e: WiringEntry, ctx: ContextId): void {
  const { off, on } = measure(e, ctx);
  const m = e.magnitude(CATALOGS);
  expect(Number.isFinite(m), `${e.id}: magnitude is not finite`).toBe(true);
  if (e.direction === "up") expect(on, `${e.id} @ ${ctx}: should move UP (off ${off}, on ${on})`).toBeGreaterThan(off);
  if (e.direction === "down") expect(on, `${e.id} @ ${ctx}: should move DOWN (off ${off}, on ${on})`).toBeLessThan(off);
  const expected = curveExpected(e.curve, off, m);
  if (expected === null) {
    expect(Math.abs(on - off), `${e.id} @ ${ctx}: the event moved less than its minimum effect ${m}`).toBeGreaterThanOrEqual(m);
    return;
  }
  const tol = e.tolerance ?? 1e-9 * Math.max(1, Math.abs(expected));
  expect(Math.abs(on - expected), `${e.id} @ ${ctx}: ${e.curve.kind} of ${m} from ${off} should give ${expected}, got ${on}`).toBeLessThanOrEqual(tol);
}

const liveChecks = WIRING_REGISTRY.filter((e) => e.contexts.length > 0);
const inertChecks = WIRING_REGISTRY.filter((e) => e.status.kind !== "live" && e.contexts.length === 0 && e.probe !== undefined);

describe("wiring sensitivity: every live effect moves its value by its configured amount", () => {
  for (const system of WIRING_SYSTEMS) {
    const entries = liveChecks.filter((e) => e.system === system);
    if (entries.length === 0) continue;
    describe(system, () => {
      for (const e of entries) {
        for (const ctx of e.contexts) it(`${e.id} @ ${ctx}`, () => checkLive(e, ctx));
      }
    });
  }
});

describe("wiring sensitivity: every pending effect with a probe still does nothing (flip it to live when it does)", () => {
  for (const e of inertChecks) {
    it(`${e.id} [${e.status.kind === "pending" || e.status.kind === "deferred" ? e.status.owner : e.status.kind}]`, () => {
      const { off, on } = measure(e, "fleet");
      expect(on, `${e.id} now MOVES its claimed value (${off} -> ${on}): wire its entry live (status, contexts, curve)`).toBe(off);
    });
  }
});
