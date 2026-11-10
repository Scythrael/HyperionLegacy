// WR-1 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.3): THE SENSITIVITY LEVEL.
//
// For every registry entry and every context it claims LIVE: build the fixture, read the entry's seam probe without
// the source and with it, and assert
//   1. DIRECTION: the value moved the declared way (a buff that hurts fails), and
//   2. MAGNITUDE THROUGH THE CURVE: the move equals curve(magnitude), where the magnitude is read from the catalog,
//      exactly at a pure seam and within the entry's tolerance (one rounding step) where the outcome is an integer.
//      "The 8% will change, but the effect of that 8% will not" (user, capture 2026-10-15 section 5): a retune stays
//      green, a broken wire fails. An event entry asserts the direction and a minimum effect size.
//
// For every claimed context that does NOT move yet (a PARTIAL source's missing context, or every claimed context of
// a wholly inert source), assert the value stays FLAT there, read through that context's own consumer (WR-1 review):
// a pending entry that starts working fails here until its status is flipped to live, so the list cannot rot. Each
// flat check carries a CONTROL: a live effect of the same shape that must move the same probe on the same fixture,
// so a fixture that lacks the system (no away team, no drones, no power drawn, a hull that cannot patrol) can never
// pass as "flat". The few consumers no live effect reaches yet name why (FLAT_UNCONTROLLED).
//
// An equals entry configured 0 has a WITNESS: a live entry on the same reader configured nonzero, measured here, so
// a reader that ignores the field (a constant 0) fails.

import { describe, it, expect } from "vitest";
import { CATALOGS, FLAT_UNCONTROLLED, WIRING_REGISTRY, WIRING_SYSTEMS, curveExpected, flatControl, wiringEntry, type WiringEntry } from "./wiring/registry";
import { readProbe, type ContextId } from "./wiring/probes";

function measure(e: WiringEntry, ctx: ContextId): { off: number; on: number; unit?: number } {
  const s0 = e.base();
  const unit = e.curve.kind === "perPoint" ? readProbe(e.probe!, e.curve.unitOn(s0), ctx) : undefined;
  return { off: readProbe(e.probe!, e.off(s0), ctx), on: readProbe(e.probe!, e.on(s0), ctx), unit };
}

function checkLive(e: WiringEntry, ctx: ContextId): void {
  const { off, on, unit } = measure(e, ctx);
  const m = e.magnitude(CATALOGS);
  expect(Number.isFinite(m), `${e.id}: magnitude is not finite`).toBe(true);
  if (e.direction === "up") expect(on, `${e.id} @ ${ctx}: should move UP (off ${off}, on ${on})`).toBeGreaterThan(off);
  if (e.direction === "down") expect(on, `${e.id} @ ${ctx}: should move DOWN (off ${off}, on ${on})`).toBeLessThan(off);
  if (e.curve.kind === "perPoint") {
    expect(e.curve.points, `${e.id}: the perPoint magnitude is the piece's points`).toBe(m);
    expect(unit! - off, `${e.id} @ ${ctx}: one point moved nothing`).not.toBe(0);
  }
  const expected = curveExpected(e.curve, off, m, unit);
  if (expected === null) {
    expect(Math.abs(on - off), `${e.id} @ ${ctx}: the event moved less than its minimum effect ${m}`).toBeGreaterThanOrEqual(m);
    return;
  }
  const tol = e.tolerance ?? 1e-9 * Math.max(1, Math.abs(expected));
  expect(Math.abs(on - expected), `${e.id} @ ${ctx}: ${e.curve.kind} of ${m} from ${off} should give ${expected}, got ${on}`).toBeLessThanOrEqual(tol);
}

const liveChecks = WIRING_REGISTRY.filter((e) => e.contexts.length > 0);

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

// Every (entry, context) the registry claims but does not move yet.
const flatChecks = WIRING_REGISTRY.flatMap((e) =>
  (e.status.kind === "pending" || e.status.kind === "deferred" ? e.status.contexts ?? [] : []).map((ctx) => ({ e, ctx })),
);

describe("wiring sensitivity: every claimed context that does not move yet stays flat, on a fixture that would show it", () => {
  it("covers the PARTIAL contexts and the inert sources (vacuity guard)", () => {
    // Lowered from 80 at Expedition Tiers G2-3: the voyage took the ship speed sources live at Ground Ops (the
    // gear line, the ten hulls, the museum), leaving 80 partial contexts. Lowered from 70 at Expedition Tiers G2-6: the
    // region picker took the eight telescope reach entries live at Ground Ops, leaving 63. Lowered from 60 at WR-7: the
    // ship systems took their partial contexts live or out of scope (OC-D8: the tank and engine on the expedition reach
    // gate, the hold missions-only; OC-D10: the Damage Control Suite on the field repair), leaving the transit speed's
    // patrol legs (the WR-7 follow-up), the deferred patrol sensors and the crew rows other slices own. Lowered from 15
    // at the WR-7 follow-up OC-D8: the patrol legs went live (the speed line, the ten hulls and the museum lost their
    // pending patrol context, measured by ship:audit:patrolLegs), leaving 7. Lowered from 7 at CP-3: the Security and
    // Medical quarters wings went live (their division keys act on Ground Ops), leaving 5. Lowered from 5 at WR-11: the
    // salvage talent's top-tier reach went live (OC-J1, the overflow tilts the loot odds), leaving 4. Lowered from 3 at
    // E-MOD EM-8: the Precursor Lens's first find went live (its craft context, measured by
    // relic:em8:precursorLensFirstFind), leaving 3. Lowered from 2 at WR-10: Saboteur's ground:noInflict context went
    // live (OC-F4, measured by away:audit:saboteurLinger), leaving 2 (the CP-15 patrol sensors and OC-G1 stoneskin).
    expect(flatChecks.filter(({ e }) => e.contexts.length > 0).length).toBeGreaterThan(1);
    // Lowered from 30 at the CP-2 + WR-5a integration (0.14.0): both slices moved inert sources live, leaving 28;
    // WR-5b's Tactician tree left 24, WR-5c's Explorer tree 20 (no pending secondary captain entry is left). The
    // guard only asserts the sweep is not vacuous; lower it again as more sources go live. Lowered from 15 when the
    // four inert racials went live (0.14.0: Belter, Vael, Outer-Colony, Spacer with Deck Handling and Survey Aptitude),
    // leaving 13. Lowered from 10 at the D26 line swap (0.14.0: the seven Science combat lines retired, their Science
    // lines live), leaving 6. Lowered from 5 at Material Lines ML-3 (0.14.0: materialQualityChance went live on
    // mission deliveries, OC-D2), leaving 5. Lowered from 4 at WR-7 (OC-D3: the crew module lines went live), leaving 3.
    // CP-3 took the last three live (Away-Team Protection, Triage, Prevent a Crew Loss: the complement's Ground Ops
    // consumers), so no wholly inert source with a claimed context is left; the count is pinned at 0 so a new one
    // must be named here.
    expect(flatChecks.filter(({ e }) => e.contexts.length === 0).length).toBe(0);
  });
  for (const { e, ctx } of flatChecks) {
    const owner = e.status.kind === "pending" || e.status.kind === "deferred" ? e.status.owner : "";
    it(`${e.id} @ ${ctx} [${owner}]`, () => {
      const check = e.flatChecks?.[ctx] ?? {};
      const probe = check.probe ?? e.probe;
      expect(probe, `${e.id} @ ${ctx}: a claimed context needs a probe on its consumer`).toBeDefined();
      const s0 = (check.base ?? e.base)();
      const offState = (check.off ?? e.off)(s0);
      const off = readProbe(probe!, offState, ctx);
      const on = readProbe(probe!, (check.on ?? e.on)(s0), ctx);
      expect(on, `${e.id} now MOVES its claimed value at ${ctx} (${off} -> ${on}): wire its entry live there (status, contexts, curve)`).toBe(off);
      const control = flatControl(probe!, ctx);
      if (control === null) {
        expect(FLAT_UNCONTROLLED[`${probe}@${ctx}`], `${e.id} @ ${ctx}: no control for ${probe}; add one (flatControl) or say why (FLAT_UNCONTROLLED)`).toBeDefined();
        return;
      }
      const controlled = readProbe(probe!, control(offState), ctx);
      expect(controlled, `${e.id} @ ${ctx}: the control does not move ${probe} on this fixture (${off}), so the flat check is vacuous`).not.toBe(off);
    });
  }
});

// The live equals entries configured 0, each with its witness (named, or the sibling on the same catalog field).
function lastSegment(key: string): string {
  return key.split(":").at(-1)!;
}
function witnessOf(e: WiringEntry): WiringEntry | undefined {
  if (e.witness) return wiringEntry(e.witness);
  return WIRING_REGISTRY.find(
    (w) =>
      w.id !== e.id &&
      w.status.kind === "live" &&
      w.curve.kind === "equals" &&
      w.contexts.length > 0 &&
      w.source.catalog === e.source.catalog &&
      lastSegment(w.source.key) === lastSegment(e.source.key) &&
      w.magnitude(CATALOGS) !== 0,
  );
}
const zeroEquals = WIRING_REGISTRY.filter((e) => e.status.kind === "live" && e.curve.kind === "equals" && e.contexts.length > 0 && e.magnitude(CATALOGS) === 0);

describe("wiring sensitivity: an equals entry configured 0 has a witness that reads nonzero through the same reader", () => {
  it("there are zero-configured entries to witness (vacuity guard)", () => {
    expect(zeroEquals.length).toBeGreaterThan(10);
  });
  for (const e of zeroEquals) {
    it(`${e.id}`, () => {
      const w = witnessOf(e);
      expect(w, `${e.id}: configured 0, and no live entry on the same reader is configured nonzero (name a witness)`).toBeDefined();
      const ctx = w!.contexts[0];
      const { off, on } = measure(w!, ctx);
      if (w!.curve.kind === "equals") {
        // The same reader returns the sibling's configured nonzero value: it reads the field, it is not a constant 0.
        const m = w!.magnitude(CATALOGS);
        expect(m, `${w!.id}: a witness is configured nonzero`).not.toBe(0);
        expect(Math.abs(on - m), `${e.id}: its witness ${w!.id} should read ${m}, got ${on}`).toBeLessThanOrEqual(w!.tolerance ?? 1e-9 * Math.max(1, Math.abs(m)));
      } else {
        expect(on, `${e.id}: its witness ${w!.id} reads no change (${off}), so a constant reader would pass`).not.toBe(off);
      }
    });
  }
});
