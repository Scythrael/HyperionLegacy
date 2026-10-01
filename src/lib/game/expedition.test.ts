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
  DEFAULT_GAMBIT_PROGRAMS,
  type GameState,
  type Expedition,
  type EquipmentInstance,
} from "./model";
import {
  startExpedition,
  advanceExpedition,
  resolveExpeditions,
  claimExpedition,
  expeditionCandidates,
  makeExpeditionSeed,
  advanceExpeditionSeed,
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
  EXPEDITION_CANDIDATE_COUNT,
  SENSOR_REVEAL_IN_RANGE,
  SENSOR_REVEAL_PLANET_TYPES,
  SENSOR_REVEAL_HAZARD,
  SENSOR_REVEAL_RELIC,
} from "./expedition";
import { tick } from "./tick";
import { migrate, type SaveFile } from "./save";
import {
  PLANET_TYPES,
  POI_CATALOG,
  poisForPlanetType,
  getPlanetTypeById,
  getPoiById,
  planetTypeHazard,
} from "./expeditionContent";

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
      { id: "body-1", planetType: "terrestrial", scanTotal: 100, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] },
    ],
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn: true,
    findings: [],
    seed: 12345,
    // E3a away-team snapshot: a neutral team + the default program pair, so a hand-built expedition still
    // resolves its activities (a bare team can still win the easy placeholder-heir fights, or evacuate).
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 2,
    gambitPrograms: {
      security: DEFAULT_GAMBIT_PROGRAMS.security.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined })),
      science: DEFAULT_GAMBIT_PROGRAMS.science.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined })),
    },
    // E4b museum snapshot: neutral (an empty museum), so every pre-E4b assertion is unchanged.
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
    ...over,
  };
}

// Dispatch helper: resolve a candidate id off the state's console list and commit it. Defaults to the
// first candidate ("cand-0"), which on a fresh save uses seed makeExpeditionSeed(EXPEDITION_DEFAULT_SEED,
// 0). Mirrors how the E2c UI dispatches (pick a candidate -> startExpedition).
function dispatch(s: GameState, shipId = "ship-1", captainId = 1, idx = 0, anomalyOptIn = true) {
  const cands = expeditionCandidates(s, shipId);
  return startExpedition(s, shipId, captainId, cands[idx]?.id ?? `cand-${idx}`, anomalyOptIn);
}

// ============================================================================
describe("startExpedition — dispatch shapes a valid expedition", () => {
  it("creates a transit-phase expedition with a banked system + 1..3 generic bodies", () => {
    const s = freshState(); // ship-1 assigned to captain 1, gameTimeSeconds 0
    const res = dispatch(s);
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
      // E2b: a valid planet type is assigned, and the body's hazard tracks that type's scalar.
      expect(PLANET_TYPES.some((p) => p.id === body.planetType)).toBe(true);
      expect(body.hazard).toBe(planetTypeHazard(body.planetType));
    }
    // State was advanced: the expedition is stored + the id counter bumped.
    expect(res.next.expeditions).toHaveLength(1);
    expect(res.next.nextExpeditionId).toBe(2);
  });

  it("rejects a second expedition for the same ship, and a wrong captain", () => {
    const s = freshState();
    const first = dispatch(s);
    expect(first.success).toBe(true);
    const dup = dispatch(first.next);
    expect(dup.success).toBe(false);
    expect(dup.reason).toBe("shipAlreadyOnExpedition");
    expect(dup.next).toBe(first.next); // same reference on failure

    const wrongCaptain = dispatch(s, "ship-1", 999);
    expect(wrongCaptain.success).toBe(false);
    expect(wrongCaptain.reason).toBe("captainNotAssigned");

    const noShip = dispatch(s, "ship-nope");
    expect(noShip.success).toBe(false);
    expect(noShip.reason).toBe("noSuchShip");
  });

  it("is reload-deterministic: the same save seed + expedition number yields the same expedition", () => {
    const a = dispatch(freshState()).expedition!;
    const b = dispatch(freshState()).expedition!;
    expect(a).toEqual(b);
    expect(a.seed).toBe(makeExpeditionSeed(EXPEDITION_DEFAULT_SEED, 0));
  });
});

// ============================================================================
describe("startExpedition — snapshots the installed sensor array + params", () => {
  it("snapshots the array variant + its resolved scan params (wide-beam)", () => {
    let s = freshState();
    s = { ...s, equipment: [...s.equipment, sensorInstance("equip-sensor-1", "sensorWideBeam", "ship-1")] };
    const exp = dispatch(s).expedition!;
    expect(exp.sensorArrayId).toBe("sensorWideBeam");
    // Wide-beam character (sensorArrays.ts): slower cadence, wider coverage.
    expect(exp.scanParams.scanRateMult).toBe(0.8);
    expect(exp.scanParams.coverageWidth).toBe(1.5);
    // A standard/q0 array's discovery biases scale by 1.0 (moduleEffectScale), so they equal the def.
    expect(exp.scanParams.landmarkOddsBias).toBeCloseTo(0.15, 6);
  });

  it("a bare ship snapshots null + neutral scan params + sensors 0", () => {
    const exp = dispatch(freshState()).expedition!;
    expect(exp.sensorArrayId).toBeNull();
    expect(exp.scanParams).toEqual({ scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 });
    expect(exp.sensorPower).toBe(0); // no sensor gear + no crew mapping onto sensors yet
  });
});

// ============================================================================
describe("phase advancement — deterministic transit -> scanning -> activities -> return -> complete", () => {
  it("stays in transit before the leg elapses, then walks the full machine to complete", () => {
    const exp = dispatch(freshState()).expedition!; // shakedown transit

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
      // E2b: every discovery names a real PoI from the body's planet-type pool, and its activity carries
      // the same PoI id (the kind matches the PoI's pool).
      const pools = poisForPlanetType(body.planetType);
      const eligible = new Map<string, (typeof pools.surface)[number]["poi"]>(
        [...pools.surface, ...pools.underground].map((w) => [w.poi.id as string, w.poi]),
      );
      body.discoveries.forEach((d, k) => {
        const poi = eligible.get(d.poiId);
        expect(poi).toBeDefined();
        expect(d.kind).toBe(poi!.pool === "surface" ? "landmark" : "underground");
        expect(body.activities[k].poiId).toBe(d.poiId);
      });
    }
    // Findings = one per completed activity + (charted ? 1 : 0) for the anomaly.
    const activityFindings = done.findings.filter((f) => f.source === "activity").length;
    const anomalyFindings = done.findings.filter((f) => f.source === "anomaly").length;
    expect(activityFindings).toBe(expeditionActivitiesDone(done));
    expect(anomalyFindings).toBe(done.anomalyCharted ? 1 : 0);
    expect(expeditionScanFraction(done)).toBe(1);
  });

  it("resolveExpeditions is a same-reference no-op once an expedition is complete", () => {
    const exp = dispatch(freshState()).expedition!;
    const complete = advanceExpedition(exp, 1_000_000);
    expect(complete.phase).toBe("complete");
    // advanceExpedition on a complete expedition returns the SAME reference.
    expect(advanceExpedition(complete, 2_000_000)).toBe(complete);
  });

  it("claimExpedition removes a complete expedition and returns its findings", () => {
    let s = dispatch(freshState()).next;
    // Advance the stored expedition to complete via the engine.
    s = { ...s, gameTimeSeconds: 1_000_000 };
    s = resolveExpeditions(s);
    const exp = s.expeditions[0];
    expect(exp.phase).toBe("complete");

    const notYet = claimExpedition(dispatch(freshState()).next, "expedition-1");
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
    const exp = dispatch(freshState()).expedition!;
    const a = advanceExpedition(exp, 1_000_000);
    const b = advanceExpedition(exp, 1_000_000);
    expect(a.anomalyCharted).toBe(b.anomalyCharted);
    expect(a.anomalyResolved).toBe(true);
    // The outcome is stable for a fixed seed (regression guard on determinism, not on the value itself).
    const rerun = advanceExpedition(dispatch(freshState()).expedition!, 1_000_000);
    expect(rerun.anomalyCharted).toBe(a.anomalyCharted);
  });

  it("does not resolve before the midpoint", () => {
    const exp = dispatch(freshState()).expedition!;
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
    { id: "body-1", planetType: "terrestrial" as const, scanTotal: 200, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] },
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
    const calm = makeExpedition({ phase: "scanning", bodies: [{ id: "body-1", planetType: "terrestrial", scanTotal: 200, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] }] });
    const dangerous = makeExpedition({ phase: "scanning", bodies: [{ id: "body-1", planetType: "terrestrial", scanTotal: 200, scanProgress: 0, hazard: 0.8, scanned: false, discoveries: [], activities: [] }] });
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
    const base = dispatch(freshState()).next;

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

// ============================================================================
// E2b: the CONTENT LAYER -- planet types + PoI catalog gate + skew discoveries.
// ============================================================================

// Advance a hand-built single-body expedition (fixed planet type + scan params) to complete over many
// seeds, tallying how many surface vs underground discoveries it yielded. Isolates the discovery roll.
function tallyPoolsOverSeeds(
  planetType: GameState["expeditions"][number]["bodies"][number]["planetType"],
  scanParams: Expedition["scanParams"],
  seeds: number,
): { surface: number; underground: number } {
  let surface = 0;
  let underground = 0;
  for (let n = 0; n < seeds; n++) {
    const exp = makeExpedition({
      phase: "scanning",
      scanParams,
      seed: (0x51ed270b + Math.imul(n + 1, 0x9e3779b9)) >>> 0,
      bodies: [
        { id: "body-1", planetType, scanTotal: 100, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] },
      ],
    });
    const done = advanceExpedition(exp, 10_000_000);
    for (const d of done.bodies[0].discoveries) {
      if (d.kind === "landmark") surface++;
      else underground++;
    }
  }
  return { surface, underground };
}

describe("E2b content catalog — planet types + PoI catalog are well-formed", () => {
  it("has the 8 locked planet types with resolved hazard scalars and a single orbital-only type", () => {
    expect(PLANET_TYPES).toHaveLength(8);
    const ids = PLANET_TYPES.map((p) => p.id).sort();
    expect(ids).toEqual(["arid", "barren", "frozen", "gasGiant", "ocean", "terrestrial", "toxic", "volcanic"]);
    // Exactly Gas Giant is orbital-only.
    expect(PLANET_TYPES.filter((p) => p.orbitalOnly).map((p) => p.id)).toEqual(["gasGiant"]);
    // Each type's hazard scalar matches its tier reader, and Toxic is the most hazardous, Terrestrial low.
    for (const p of PLANET_TYPES) expect(p.hazard).toBe(planetTypeHazard(p.id));
    expect(getPlanetTypeById("toxic")!.hazard).toBeGreaterThan(getPlanetTypeById("terrestrial")!.hazard);
  });

  it("has the 9 locked PoIs split 5 surface / 4 underground, and every type has both pools populated", () => {
    expect(POI_CATALOG).toHaveLength(9);
    expect(POI_CATALOG.filter((p) => p.pool === "surface")).toHaveLength(5);
    expect(POI_CATALOG.filter((p) => p.pool === "underground")).toHaveLength(4);
    for (const pt of PLANET_TYPES) {
      const pools = poisForPlanetType(pt.id);
      expect(pools.surface.length).toBeGreaterThan(0);
      expect(pools.underground.length).toBeGreaterThan(0);
      // Every weighted candidate resolves to a real PoI in the matching pool with a positive weight.
      for (const w of pools.surface) {
        expect(getPoiById(w.poi.id)!.pool).toBe("surface");
        expect(w.weight).toBeGreaterThan(0);
      }
      for (const w of pools.underground) expect(getPoiById(w.poi.id)!.pool).toBe("underground");
    }
  });
});

describe("E2b discovery roll — drawn from the planet-type pool, skewed by array bias", () => {
  const SEEDS = 300;
  const wide = { scanRateMult: 0.8, coverageWidth: 1.5, landmarkOddsBias: 0.15, undergroundPoiOddsBias: 0 };
  const focused = { scanRateMult: 1.3, coverageWidth: 0.6, landmarkOddsBias: 0, undergroundPoiOddsBias: 0.2 };

  it("every discovery is a PoI eligible for the body's planet type (all 8 types)", () => {
    const neutral = { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 };
    for (const pt of PLANET_TYPES) {
      const eligible = new Set<string>([...poisForPlanetType(pt.id).surface, ...poisForPlanetType(pt.id).underground].map((w) => w.poi.id));
      for (let n = 0; n < 60; n++) {
        const exp = makeExpedition({
          phase: "scanning",
          scanParams: neutral,
          seed: (0x1234abcd + Math.imul(n + 1, 0x85ebca6b)) >>> 0,
          bodies: [{ id: "body-1", planetType: pt.id, scanTotal: 100, scanProgress: 0, hazard: 0, scanned: false, discoveries: [], activities: [] }],
        });
        const done = advanceExpedition(exp, 10_000_000);
        for (const d of done.bodies[0].discoveries) expect(eligible.has(d.poiId)).toBe(true);
      }
    }
  });

  it("Wide-Beam yields relatively more surface finds; Focused-Beam relatively more underground (same type)", () => {
    // Fix the planet type (terrestrial, balanced biases) so the sensor ARRAY is the only differentiator.
    const w = tallyPoolsOverSeeds("terrestrial", wide, SEEDS);
    const f = tallyPoolsOverSeeds("terrestrial", focused, SEEDS);
    // Wide's surface share exceeds Focused's; Focused's underground share exceeds Wide's.
    const wideSurfaceShare = w.surface / (w.surface + w.underground);
    const focusedSurfaceShare = f.surface / (f.surface + f.underground);
    expect(wideSurfaceShare).toBeGreaterThan(focusedSurfaceShare);
    expect(f.underground).toBeGreaterThan(w.underground);
    expect(w.surface).toBeGreaterThan(f.surface);
  });

  it("planet type skews the mix too: Arid yields more underground than Terrestrial under the same array", () => {
    const neutral = { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 };
    const arid = tallyPoolsOverSeeds("arid", neutral, SEEDS);
    const terr = tallyPoolsOverSeeds("terrestrial", neutral, SEEDS);
    const aridUnderShare = arid.underground / (arid.surface + arid.underground);
    const terrUnderShare = terr.underground / (terr.surface + terr.underground);
    expect(aridUnderShare).toBeGreaterThan(terrUnderShare);
  });
});

describe("E2b Gas Giant — orbital-only, yet still yields activities (satellite ops)", () => {
  it("gasGiant is the orbital-only type and still generates a full activity list at 100% scan", () => {
    expect(getPlanetTypeById("gasGiant")!.orbitalOnly).toBe(true);
    let anyActivities = false;
    for (let n = 0; n < 40; n++) {
      const exp = makeExpedition({
        phase: "scanning",
        seed: (0x0a11ce ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0,
        bodies: [{ id: "body-1", planetType: "gasGiant", scanTotal: 100, scanProgress: 0, hazard: 0.1, scanned: false, discoveries: [], activities: [] }],
      });
      const done = advanceExpedition(exp, 10_000_000);
      const body = done.bodies[0];
      expect(body.scanned).toBe(true);
      expect(body.discoveries.length).toBeGreaterThan(0); // still yields finds (flavored satellite ops)
      expect(body.activities.length).toBe(body.discoveries.length);
      expect(body.activities.every((a) => a.done)).toBe(true);
      // Every gas-giant find is from the gas-giant eligible pool.
      const eligible = new Set<string>([...poisForPlanetType("gasGiant").surface, ...poisForPlanetType("gasGiant").underground].map((w) => w.poi.id));
      for (const d of body.discoveries) expect(eligible.has(d.poiId)).toBe(true);
      if (body.activities.length > 0) anyActivities = true;
    }
    expect(anyActivities).toBe(true);
  });
});

describe("E2b PARITY — a TYPED multi-body system is byte-identical big-jump vs stepped", () => {
  // A hand-built system spanning several planet types (incl. the orbital-only Gas Giant + high-hazard
  // types), advanced from transit. The closed-form invariant (E2a) must still hold with the E2b content:
  // one big advance == many small stepped advances, byte-for-byte.
  const make = () =>
    makeExpedition({
      phase: "transit",
      shakedown: true,
      seed: makeExpeditionSeed(EXPEDITION_DEFAULT_SEED, 7),
      bodies: [
        { id: "body-1", planetType: "toxic", scanTotal: 120, scanProgress: 0, hazard: planetTypeHazard("toxic"), scanned: false, discoveries: [], activities: [] },
        { id: "body-2", planetType: "volcanic", scanTotal: 90, scanProgress: 0, hazard: planetTypeHazard("volcanic"), scanned: false, discoveries: [], activities: [] },
        { id: "body-3", planetType: "gasGiant", scanTotal: 150, scanProgress: 0, hazard: planetTypeHazard("gasGiant"), scanned: false, discoveries: [], activities: [] },
      ],
    });

  it("one 200k-second jump equals 100-second stepping", () => {
    const big = advanceExpedition(make(), 200_000);
    let stepped = make();
    for (let t = 100; t <= 200_000; t += 100) stepped = advanceExpedition(stepped, t);
    expect(stepped).toEqual(big);
    expect(big.phase).toBe("complete");
    // Non-trivial: every typed body scanned + yielded discoveries + activities.
    for (const body of big.bodies) {
      expect(body.scanned).toBe(true);
      expect(body.discoveries.length).toBeGreaterThan(0);
      expect(body.activities.every((a) => a.done)).toBe(true);
    }
  });
});

// ============================================================================
describe("SAVE migration v59 -> v60 backfills a body planetType", () => {
  it("backfills terrestrial onto an in-flight expedition body that predates planetType", () => {
    // A v59-shaped save holding an in-flight expedition whose body lacks the new planetType field.
    const s: any = freshState();
    const body: any = { id: "body-1", scanTotal: 100, scanProgress: 40, hazard: 0.4, scanned: false, discoveries: [], activities: [] };
    delete body.planetType; // simulate the pre-E2b shape
    s.expeditions = [
      {
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
        shakedown: true,
        bodies: [body],
        anomalyResolved: true,
        anomalyCharted: false,
        findings: [],
        seed: 12345,
      },
    ];
    s.nextExpeditionId = 2;
    const save: SaveFile = { version: 59, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as any;
    const migrated: any = migrate(save);
    expect(migrated.expeditions[0].bodies[0].planetType).toBe("terrestrial");
  });

  it("is a no-op for a save with no active expeditions", () => {
    const s: any = freshState();
    const save: SaveFile = { version: 59, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as any;
    const migrated: any = migrate(save);
    expect(migrated.expeditions).toEqual([]);
  });
});

// ============================================================================
// E2c: sensor-gated candidate targets + foreknowledge, the candidate-commit dispatch, anomaly opt-in.
// ============================================================================

// A ship fitted with a sensor array rolled to a given `sensors` power, so a test can dial foreknowledge
// reveal tiers. The sensor `sensors` implicit is what effectiveShipStats folds to sensorPower; a bare
// hull reads 0. We set the implicit directly (bypassing the generator) to hit an exact power.
function shipWithSensors(sensors: number): GameState {
  let s = freshState();
  const piece: EquipmentInstance = sensorInstance("equip-sensor-pow", "sensorBalanced", "ship-1", {
    implicitStats: { sensors },
  });
  s = { ...s, equipment: [...s.equipment, piece] };
  return s;
}

describe("E2c expeditionCandidates — a stable, deterministic candidate list", () => {
  it("offers EXPEDITION_CANDIDATE_COUNT candidates with stable ids + reload-deterministic seeds", () => {
    const s = freshState();
    const cands = expeditionCandidates(s, "ship-1");
    expect(cands).toHaveLength(EXPEDITION_CANDIDATE_COUNT);
    cands.forEach((c, i) => {
      expect(c.id).toBe(`cand-${i}`);
      expect(c.index).toBe(i);
      expect(c.seed).toBe(makeExpeditionSeed(s.expeditionSeed, i));
      expect(BANKED_SYSTEMS.some((sys) => sys.id === c.systemId)).toBe(true);
      expect(c.systemName).toBe(BANKED_SYSTEMS.find((sys) => sys.id === c.systemId)!.name);
    });
  });

  it("is stable across repeated reads on an unchanged state (a preview never advances the seed)", () => {
    const s = freshState();
    expect(expeditionCandidates(s, "ship-1")).toEqual(expeditionCandidates(s, "ship-1"));
    // Reading candidates does not mutate the save seed.
    expect(s.expeditionSeed).toBe(freshState().expeditionSeed);
  });

  it("all ships see the SAME candidate systems (seeds are ship-independent; only foreknowledge differs)", () => {
    // Two ships with different sensors: same seeds/systems, different reveal.
    const weak = expeditionCandidates(shipWithSensors(0), "ship-1");
    const strong = expeditionCandidates(shipWithSensors(100), "ship-1");
    weak.forEach((c, i) => {
      expect(strong[i].seed).toBe(c.seed);
      expect(strong[i].systemId).toBe(c.systemId);
    });
  });
});

describe("E2c foreknowledge — progressive reveal scales with the ship's sensors", () => {
  it("a bare hull (0 sensors) is BEYOND SENSOR RANGE: contents hidden", () => {
    const cands = expeditionCandidates(freshState(), "ship-1"); // ship-1 bare => sensors 0
    for (const c of cands) {
      expect(c.foreknowledge.inRange).toBe(false);
      expect(c.foreknowledge.bodyCount).toBeNull();
      expect(c.foreknowledge.bodies).toBeNull();
      expect(c.foreknowledge.relicSignature).toBeNull();
      // The system NAME is still known (a destination reads by name even beyond range).
      expect(c.systemName.length).toBeGreaterThan(0);
    }
  });

  it("in-range but low sensors reveal only the body COUNT, not types/hazard/relic", () => {
    const cands = expeditionCandidates(shipWithSensors(SENSOR_REVEAL_IN_RANGE), "ship-1");
    for (const c of cands) {
      expect(c.foreknowledge.inRange).toBe(true);
      expect(c.foreknowledge.bodyCount).toBeGreaterThanOrEqual(BODY_COUNT_MIN);
      expect(c.foreknowledge.bodies).not.toBeNull();
      for (const b of c.foreknowledge.bodies!) {
        expect(b.planetType).toBeNull(); // below the planet-type threshold
        expect(b.hazard).toBeNull();
      }
      expect(c.foreknowledge.relicSignature).toBeNull();
    }
  });

  it("full sensors reveal every layer: count + planet types + hazard + relic signature", () => {
    const cands = expeditionCandidates(shipWithSensors(SENSOR_REVEAL_RELIC), "ship-1");
    for (const c of cands) {
      expect(c.foreknowledge.inRange).toBe(true);
      expect(c.foreknowledge.bodyCount).toBe(c.foreknowledge.bodies!.length);
      for (const b of c.foreknowledge.bodies!) {
        expect(b.planetType).not.toBeNull();
        expect(PLANET_TYPES.some((p) => p.id === b.planetType)).toBe(true);
        expect(b.hazard).toBe(planetTypeHazard(b.planetType!));
      }
      expect(typeof c.foreknowledge.relicSignature).toBe("boolean");
    }
  });

  it("reveal is monotonic: each threshold unlocks one more layer, none regress", () => {
    const at = (p: number) => expeditionCandidates(shipWithSensors(p), "ship-1")[0].foreknowledge;
    const belowRange = at(SENSOR_REVEAL_IN_RANGE - 1);
    const count = at(SENSOR_REVEAL_IN_RANGE);
    const types = at(SENSOR_REVEAL_PLANET_TYPES);
    const hazard = at(SENSOR_REVEAL_HAZARD);
    const relic = at(SENSOR_REVEAL_RELIC);
    expect(belowRange.inRange).toBe(false);
    expect(count.inRange).toBe(true);
    expect(count.bodies![0].planetType).toBeNull();
    expect(types.bodies![0].planetType).not.toBeNull();
    expect(types.bodies![0].hazard).toBeNull();
    expect(hazard.bodies![0].hazard).not.toBeNull();
    expect(hazard.relicSignature).toBeNull();
    expect(typeof relic.relicSignature).toBe("boolean");
  });
});

describe("E2c dispatch — commit a chosen candidate; the launch MATCHES its preview", () => {
  it("the committed expedition's system + bodies match the previewed candidate exactly", () => {
    const s = shipWithSensors(SENSOR_REVEAL_RELIC); // full reveal so we can compare bodies
    const cand = expeditionCandidates(s, "ship-1")[1]; // choose the SECOND candidate
    const res = startExpedition(s, "ship-1", 1, cand.id);
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    // The launched expedition uses the candidate's own seed, so its identity + bodies match the preview.
    expect(exp.seed).toBe(cand.seed);
    expect(exp.targetSystemId).toBe(cand.systemId);
    expect(exp.systemName).toBe(cand.systemName);
    expect(exp.bodies.length).toBe(cand.foreknowledge.bodyCount);
    exp.bodies.forEach((b, i) => {
      expect(b.planetType).toBe(cand.foreknowledge.bodies![i].planetType);
      expect(b.hazard).toBe(cand.foreknowledge.bodies![i].hazard);
    });
  });

  it("dispatch ADVANCES expeditionSeed so the next candidate list is a fresh set", () => {
    const s = freshState();
    const before = expeditionCandidates(s, "ship-1").map((c) => c.seed);
    const res = startExpedition(s, "ship-1", 1, "cand-0");
    expect(res.success).toBe(true);
    expect(res.next.expeditionSeed).toBe(advanceExpeditionSeed(s.expeditionSeed));
    const after = expeditionCandidates(res.next, "ship-1").map((c) => c.seed);
    expect(after).not.toEqual(before); // the list refreshed
  });

  it("rejects an unknown candidate id (same-ref state), and still enforces the ship/captain guards", () => {
    const s = freshState();
    const bad = startExpedition(s, "ship-1", 1, "cand-nope");
    expect(bad.success).toBe(false);
    expect(bad.reason).toBe("noSuchCandidate");
    expect(bad.next).toBe(s);
    // The pre-existing guards fire BEFORE the candidate lookup.
    expect(startExpedition(s, "ship-1", 999, "cand-0").reason).toBe("captainNotAssigned");
    expect(startExpedition(s, "ship-nope", 1, "cand-0").reason).toBe("noSuchShip");
    const first = startExpedition(s, "ship-1", 1, "cand-0");
    expect(startExpedition(first.next, "ship-1", 1, "cand-0").reason).toBe("shipAlreadyOnExpedition");
  });
});

describe("E2c anomaly opt-in — the toggle gates whether the mid-transit chart is attempted", () => {
  it("opting OUT never charts (resolved at the midpoint, but no chart + no anomaly finding)", () => {
    // A hand-built transit expedition seeded so the OPT-IN run WOULD chart, to prove the opt-out gate.
    let seed = 0;
    for (let n = 1; n <= 60; n++) {
      const s = makeExpeditionSeed(EXPEDITION_DEFAULT_SEED, n);
      const optedIn = advanceExpedition(makeExpedition({ phase: "transit", shakedown: true, seed: s, anomalyOptIn: true }), 1_000_000);
      if (optedIn.anomalyCharted) { seed = s; break; }
    }
    expect(seed).not.toBe(0); // found a charting seed

    const optIn = advanceExpedition(makeExpedition({ phase: "transit", shakedown: true, seed, anomalyOptIn: true }), 1_000_000);
    const optOut = advanceExpedition(makeExpedition({ phase: "transit", shakedown: true, seed, anomalyOptIn: false }), 1_000_000);

    // Opted IN with a charting seed: charted + an anomaly finding.
    expect(optIn.anomalyCharted).toBe(true);
    expect(optIn.findings.some((f) => f.source === "anomaly")).toBe(true);
    // Opted OUT on the SAME seed: the roll fired (resolved) but never charted + granted no anomaly finding.
    expect(optOut.anomalyResolved).toBe(true);
    expect(optOut.anomalyCharted).toBe(false);
    expect(optOut.findings.some((f) => f.source === "anomaly")).toBe(false);
  });

  it("startExpedition stores the opt-in flag from dispatch", () => {
    const optIn = startExpedition(freshState(), "ship-1", 1, "cand-0", true).expedition!;
    const optOut = startExpedition(freshState(), "ship-1", 1, "cand-0", false).expedition!;
    expect(optIn.anomalyOptIn).toBe(true);
    expect(optOut.anomalyOptIn).toBe(false);
  });
});

// ============================================================================
describe("SAVE migration v60 -> v61 backfills anomalyOptIn", () => {
  it("backfills anomalyOptIn true onto an in-flight expedition that predates the field", () => {
    const s: any = freshState();
    const exp: any = {
      id: "expedition-1",
      shipId: "ship-1",
      captainId: 1,
      targetSystemId: "keplersReach",
      systemName: "Kepler's Reach",
      sensorArrayId: null,
      scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
      sensorPower: 0,
      phase: "transit",
      phaseAnchorSeconds: 0,
      shakedown: true,
      bodies: [{ id: "body-1", planetType: "terrestrial", scanTotal: 100, scanProgress: 0, hazard: 0.1, scanned: false, discoveries: [], activities: [] }],
      anomalyResolved: false,
      anomalyCharted: false,
      findings: [],
      seed: 12345,
    };
    delete exp.anomalyOptIn; // simulate the pre-E2c shape
    s.expeditions = [exp];
    s.nextExpeditionId = 2;
    const save: SaveFile = { version: 60, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as any;
    const migrated: any = migrate(save);
    expect(migrated.expeditions[0].anomalyOptIn).toBe(true);
  });

  it("is a no-op for a save with no active expeditions", () => {
    const s: any = freshState();
    const save: SaveFile = { version: 60, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as any;
    const migrated: any = migrate(save);
    expect(migrated.expeditions).toEqual([]);
  });
});
