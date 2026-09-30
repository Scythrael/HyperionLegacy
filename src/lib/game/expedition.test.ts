// Exploration 0.14.0 (Phase E2a) tests: the deterministic, offline-safe EXPEDITION state machine.
//
// Covers, mirroring the crew + transport parity/additive-neutral styles:
//   - startExpedition shapes a VALID expedition (system + 1..3 generic bodies, snapshots, shakedown).
//   - the installed sensor array + its resolved scan params + the ship's sensors are SNAPSHOTTED.
//   - each phase advances deterministically (transit -> scanning -> activities -> return -> complete).
//   - the mid-transit anomaly roll is SEEDED / deterministic (and fires exactly once, at the midpoint).
//   - scanning CONSUMES the sensor array effect: a better array / higher sensors scans FASTER.
//   - one big offline window == many small live ticks (PARITY, via tick()).
//   - NO-expedition byte-identical additive-neutrality (resolveExpeditions is a same-ref no-op).
//   - the v58->v59 SAVE migration seeds the new fields.

import { describe, it, expect } from "vitest";
import {
  freshState,
  EXPEDITION_DEFAULT_SEED,
  type GameState,
  type Expedition,
  type EquipmentInstance,
} from "./model";
import {
  startExpedition,
  advanceExpedition,
  resolveExpeditions,
  claimExpedition,
  makeExpeditionSeed,
  expeditionScanFraction,
  expeditionActivitiesDone,
  BANKED_SYSTEMS,
  BODY_COUNT_MIN,
  BODY_COUNT_MAX,
  BODY_SCAN_MIN,
  BODY_SCAN_MAX,
  SHAKEDOWN_TRANSIT_SECONDS,
  ANOMALY_CHECK_FRACTION,
  ACTIVITY_SECONDS,
} from "./expedition";
import { tick } from "./tick";
import { migrate, type SaveFile } from "./save";

// --- fixtures ----------------------------------------------------------------

// A sensor EquipmentInstance fitted to a ship (mirrors sensorArrays.test.ts's builder).
function sensorInstance(
  id: string,
  moduleVariant: string,
  fittedToShipId: string,
  overrides: Partial<EquipmentInstance> = {},
): EquipmentInstance {
  return {
    id,
    slotType: "sensor",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId,
    moduleVariant,
    ...overrides,
  };
}

// A minimal hand-built expedition, for isolating a single phase in a test (bypasses startExpedition so
// the test controls the exact bodies / scan params / sensor power). phaseAnchorSeconds 0 so nowSeconds
// == elapsed-in-phase.
function makeExpedition(over: Partial<Expedition> = {}): Expedition {
  return {
    id: "expedition-1",
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "scanning",
    phaseAnchorSeconds: 0,
    shakedown: false,
    bodies: [
      { id: "body-1", scanTotal: 100, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] },
    ],
    anomalyResolved: false,
    anomalyCharted: false,
    findings: [],
    seed: 12345,
    ...over,
  };
}

// ============================================================================
describe("startExpedition — dispatch shapes a valid expedition", () => {
  it("creates a transit-phase expedition with a banked system + 1..3 generic bodies", () => {
    const s = freshState(); // ship-1 assigned to captain 1, gameTimeSeconds 0
    const res = startExpedition(s, "ship-1", 1);
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    expect(exp.id).toBe("expedition-1");
    expect(exp.phase).toBe("transit");
    expect(exp.phaseAnchorSeconds).toBe(0);
    expect(exp.shakedown).toBe(true); // the inaugural per-account run
    expect(exp.anomalyResolved).toBe(false);
    expect(exp.anomalyCharted).toBe(false);
    expect(exp.findings).toEqual([]);
    expect(BANKED_SYSTEMS.some((sys) => sys.id === exp.targetSystemId)).toBe(true);
    expect(exp.systemName).toBe(BANKED_SYSTEMS.find((sys) => sys.id === exp.targetSystemId)!.name);
    // 1..3 bodies, each a generic (size, hazard, empty discovery/activity) record.
    expect(exp.bodies.length).toBeGreaterThanOrEqual(BODY_COUNT_MIN);
    expect(exp.bodies.length).toBeLessThanOrEqual(BODY_COUNT_MAX);
    for (const body of exp.bodies) {
      expect(body.scanTotal).toBeGreaterThanOrEqual(BODY_SCAN_MIN);
      expect(body.scanTotal).toBeLessThanOrEqual(BODY_SCAN_MAX);
      expect(body.scanProgress).toBe(0);
      expect(body.hazard).toBeGreaterThanOrEqual(0);
      expect(body.scanned).toBe(false);
      expect(body.discoveries).toEqual([]);
      expect(body.activities).toEqual([]);
    }
    // State was advanced: the expedition is stored + the id counter bumped.
    expect(res.next.expeditions).toHaveLength(1);
    expect(res.next.nextExpeditionId).toBe(2);
  });

  it("rejects a second expedition for the same ship, and a wrong captain", () => {
    const s = freshState();
    const first = startExpedition(s, "ship-1", 1);
    expect(first.success).toBe(true);
    const dup = startExpedition(first.next, "ship-1", 1);
    expect(dup.success).toBe(false);
    expect(dup.reason).toBe("shipAlreadyOnExpedition");
    expect(dup.next).toBe(first.next); // same reference on failure

    const wrongCaptain = startExpedition(s, "ship-1", 999);
    expect(wrongCaptain.success).toBe(false);
    expect(wrongCaptain.reason).toBe("captainNotAssigned");

    const noShip = startExpedition(s, "ship-nope", 1);
    expect(noShip.success).toBe(false);
    expect(noShip.reason).toBe("noSuchShip");
  });

  it("is reload-deterministic: the same save seed + expedition number yields the same expedition", () => {
    const a = startExpedition(freshState(), "ship-1", 1).expedition!;
    const b = startExpedition(freshState(), "ship-1", 1).expedition!;
    expect(a).toEqual(b);
    expect(a.seed).toBe(makeExpeditionSeed(EXPEDITION_DEFAULT_SEED, 1));
  });
});

// ============================================================================
describe("startExpedition — snapshots the installed sensor array + params", () => {
  it("snapshots the array variant + its resolved scan params (wide-beam)", () => {
    let s = freshState();
    s = { ...s, equipment: [...s.equipment, sensorInstance("equip-sensor-1", "sensorWideBeam", "ship-1")] };
    const exp = startExpedition(s, "ship-1", 1).expedition!;
    expect(exp.sensorArrayId).toBe("sensorWideBeam");
    // Wide-beam character (sensorArrays.ts): slower cadence, wider coverage.
    expect(exp.scanParams.scanRateMult).toBe(0.8);
    expect(exp.scanParams.coverageWidth).toBe(1.5);
    // A standard/q0 array's discovery biases scale by 1.0 (moduleEffectScale), so they equal the def.
    expect(exp.scanParams.landmarkOddsBias).toBeCloseTo(0.15, 6);
  });

  it("a bare ship snapshots null + neutral scan params + sensors 0", () => {
    const exp = startExpedition(freshState(), "ship-1", 1).expedition!;
    expect(exp.sensorArrayId).toBeNull();
    expect(exp.scanParams).toEqual({ scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 });
    expect(exp.sensorPower).toBe(0); // no sensor gear + no crew mapping onto sensors yet
  });
});

// ============================================================================
describe("phase advancement — deterministic transit -> scanning -> activities -> return -> complete", () => {
  it("stays in transit before the leg elapses, then walks the full machine to complete", () => {
    const exp = startExpedition(freshState(), "ship-1", 1).expedition!; // shakedown transit

    // Early: still in transit.
    expect(advanceExpedition(exp, 10).phase).toBe("transit");
    // Partway (before the transit leg finishes): still transit, but the anomaly midpoint has passed.
    const mid = advanceExpedition(exp, SHAKEDOWN_TRANSIT_SECONDS * ANOMALY_CHECK_FRACTION + 5);
    expect(mid.phase).toBe("transit");
    expect(mid.anomalyResolved).toBe(true);

    // A big span clears every phase in ONE call -> complete, all bodies scanned, all activities done.
    const done = advanceExpedition(exp, 1_000_000);
    expect(done.phase).toBe("complete");
    for (const body of done.bodies) {
      expect(body.scanProgress).toBe(body.scanTotal);
      expect(body.scanned).toBe(true);
      expect(body.discoveries.length).toBeGreaterThan(0);
      expect(body.activities.length).toBe(body.discoveries.length);
      expect(body.activities.every((a) => a.done)).toBe(true);
    }
    // Findings = one per completed activity + (charted ? 1 : 0) for the anomaly.
    const activityFindings = done.findings.filter((f) => f.source === "activity").length;
    const anomalyFindings = done.findings.filter((f) => f.source === "anomaly").length;
    expect(activityFindings).toBe(expeditionActivitiesDone(done));
    expect(anomalyFindings).toBe(done.anomalyCharted ? 1 : 0);
    expect(expeditionScanFraction(done)).toBe(1);
  });

  it("resolveExpeditions is a same-reference no-op once an expedition is complete", () => {
    const exp = startExpedition(freshState(), "ship-1", 1).expedition!;
    const complete = advanceExpedition(exp, 1_000_000);
    expect(complete.phase).toBe("complete");
    // advanceExpedition on a complete expedition returns the SAME reference.
    expect(advanceExpedition(complete, 2_000_000)).toBe(complete);
  });

  it("claimExpedition removes a complete expedition and returns its findings", () => {
    let s = startExpedition(freshState(), "ship-1", 1).next;
    // Advance the stored expedition to complete via the engine.
    s = { ...s, gameTimeSeconds: 1_000_000 };
    s = resolveExpeditions(s);
    const exp = s.expeditions[0];
    expect(exp.phase).toBe("complete");

    const notYet = claimExpedition(startExpedition(freshState(), "ship-1", 1).next, "expedition-1");
    expect(notYet.success).toBe(false);
    expect(notYet.reason).toBe("notComplete");

    const claimed = claimExpedition(s, exp.id);
    expect(claimed.success).toBe(true);
    expect(claimed.findings).toEqual(exp.findings);
    expect(claimed.next.expeditions).toHaveLength(0);
  });
});

// ============================================================================
describe("anomaly roll — seeded + deterministic, fires exactly once at the midpoint", () => {
  it("is a pure function of the seed (two runs agree; re-advancing agrees)", () => {
    const exp = startExpedition(freshState(), "ship-1", 1).expedition!;
    const a = advanceExpedition(exp, 1_000_000);
    const b = advanceExpedition(exp, 1_000_000);
    expect(a.anomalyCharted).toBe(b.anomalyCharted);
    expect(a.anomalyResolved).toBe(true);
    // The outcome is stable for a fixed seed (regression guard on determinism, not on the value itself).
    const rerun = advanceExpedition(startExpedition(freshState(), "ship-1", 1).expedition!, 1_000_000);
    expect(rerun.anomalyCharted).toBe(a.anomalyCharted);
  });

  it("does not resolve before the midpoint", () => {
    const exp = startExpedition(freshState(), "ship-1", 1).expedition!;
    const before = advanceExpedition(exp, SHAKEDOWN_TRANSIT_SECONDS * ANOMALY_CHECK_FRACTION - 5);
    expect(before.anomalyResolved).toBe(false);
    expect(before.anomalyCharted).toBe(false);
  });

  it("charting adds transit time (a charted run is still in transit past the base leg)", () => {
    // Find a seed whose expedition charts, by scanning expedition numbers.
    let charted: Expedition | null = null;
    for (let n = 1; n <= 40 && !charted; n++) {
      const e = { ...makeExpedition({ phase: "transit", shakedown: true, seed: makeExpeditionSeed(EXPEDITION_DEFAULT_SEED, n) }) };
      const resolved = advanceExpedition(e, SHAKEDOWN_TRANSIT_SECONDS * ANOMALY_CHECK_FRACTION + 1);
      if (resolved.anomalyCharted) charted = e;
    }
    expect(charted).not.toBeNull();
    // Just past the BASE transit leg, a charted expedition is STILL in transit (the detour extended it).
    const stillGoing = advanceExpedition(charted!, SHAKEDOWN_TRANSIT_SECONDS + 10);
    expect(stillGoing.phase).toBe("transit");
    expect(stillGoing.anomalyCharted).toBe(true);
  });
});

// ============================================================================
describe("scanning — consumes the sensor array effect (better array / higher sensors scans faster)", () => {
  const bodies = () => [
    { id: "body-1", scanTotal: 200, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] },
  ];
  const T = 200; // seconds into the scanning phase to sample

  it("higher sensors -> more scanned in the same time", () => {
    const low = makeExpedition({ phase: "scanning", sensorPower: 0, bodies: bodies() });
    const high = makeExpedition({ phase: "scanning", sensorPower: 50, bodies: bodies() });
    const lowP = advanceExpedition(low, T).bodies[0].scanProgress;
    const highP = advanceExpedition(high, T).bodies[0].scanProgress;
    expect(highP).toBeGreaterThan(lowP);
  });

  it("a wider-coverage array -> more scanned in the same time", () => {
    const balanced = makeExpedition({
      phase: "scanning",
      scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
      bodies: bodies(),
    });
    const wide = makeExpedition({
      phase: "scanning",
      scanParams: { scanRateMult: 0.8, coverageWidth: 1.5, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
      bodies: bodies(),
    });
    // Wide-beam net rate 0.8*1.5 = 1.2 > balanced 1.0, so it scans more in the same window.
    const balP = advanceExpedition(balanced, T).bodies[0].scanProgress;
    const wideP = advanceExpedition(wide, T).bodies[0].scanProgress;
    expect(wideP).toBeGreaterThan(balP);
  });

  it("a more hazardous body scans slower", () => {
    const calm = makeExpedition({ phase: "scanning", bodies: [{ id: "body-1", scanTotal: 200, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] }] });
    const dangerous = makeExpedition({ phase: "scanning", bodies: [{ id: "body-1", scanTotal: 200, scanProgress: 0, hazard: 0.8, scanned: false, discoveries: [], activities: [] }] });
    expect(advanceExpedition(dangerous, T).bodies[0].scanProgress).toBeLessThan(advanceExpedition(calm, T).bodies[0].scanProgress);
  });
});

// ============================================================================
describe("PARITY: one big offline window == many small live ticks", () => {
  // A span long enough to clear the whole (shakedown) state machine, well under the 2-day offline cap.
  const SPAN_SECONDS = 40000;

  function seededRng(): () => number {
    let x = 0x12345678;
    return () => {
      x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
      return (x >>> 8) / (1 << 24);
    };
  }

  it("the expedition is byte-identical whether resolved in one jump or stepped per tick", () => {
    const base = startExpedition(freshState(), "ship-1", 1).next;

    // OFFLINE: one big catch-up.
    const big = tick(SPAN_SECONDS, base, seededRng());

    // LIVE: the same span stepped one whole tick at a time.
    let small = base;
    const rng = seededRng();
    for (let i = 0; i < SPAN_SECONDS; i += 1) small = tick(base.tickDurationSeconds, small, rng);

    expect(big.gameTimeSeconds).toBe(small.gameTimeSeconds);
    // The whole expedition record must match exactly (phase, anchors, bodies, discoveries, findings).
    expect(big.expeditions).toEqual(small.expeditions);
    // And the run was non-trivial: it reached complete with findings.
    expect(big.expeditions[0].phase).toBe("complete");
    expect(big.expeditions[0].findings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
describe("ADDITIVE-NEUTRAL: no active expedition is byte-identical to before this phase", () => {
  it("resolveExpeditions returns the SAME state reference when there is no expedition", () => {
    const s = freshState();
    expect(s.expeditions).toEqual([]);
    expect(resolveExpeditions(s)).toBe(s); // same reference, so the tick pass is a true no-op
  });

  it("a tick with no expedition leaves the expeditions array empty + untouched", () => {
    const s = freshState();
    const after = tick(1000, s, () => 0.5);
    expect(after.expeditions).toEqual([]);
    expect(after.nextExpeditionId).toBe(1);
    expect(after.expeditionSeed).toBe(EXPEDITION_DEFAULT_SEED);
  });
});

// ============================================================================
describe("SAVE migration v58 -> v59 seeds the expedition fields", () => {
  it("backfills expeditions [], nextExpeditionId 1, expeditionSeed default onto a v58 save", () => {
    // A v58-shaped save lacking the three expedition fields.
    const s: any = freshState();
    delete s.expeditions;
    delete s.nextExpeditionId;
    delete s.expeditionSeed;
    const save: SaveFile = {
      version: 58,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: s,
    } as any;
    const migrated: any = migrate(save);
    expect(migrated.expeditions).toEqual([]);
    expect(migrated.nextExpeditionId).toBe(1);
    expect(migrated.expeditionSeed).toBe(EXPEDITION_DEFAULT_SEED);
  });
});
