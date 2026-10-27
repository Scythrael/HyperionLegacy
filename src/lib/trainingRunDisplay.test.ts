// Safe first runs SF-6: the approved first-run text (user 2026-10-27, call 12) and the heavy cruiser descriptions
// (call 13), verbatim, and each description's claims checked against the built hull so a retune cannot turn one false.
import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { SHIP_TYPES, freshState, type CaptainState, type MissionPhase } from "./game/model";
import { FIRST_GATHERING_LINE, TRAINING_EXPEDITION_LINE, TRAINING_PATROL_LINE, TRAINING_RUN_CHIP, firstGatheringCardCaptainId } from "./trainingRunDisplay";

const HULLS = Object.values(SHIP_TYPES);
const EXPLORERS = HULLS.filter((d) => d.spec === "explorer");
const maxOf = (pool: typeof HULLS, f: (d: (typeof HULLS)[number]) => number): number => Math.max(...pool.map(f));

describe("SF-6 first-run text", () => {
  it("is the approved text, verbatim", () => {
    expect(TRAINING_RUN_CHIP).toBe("Training run");
    expect(TRAINING_EXPEDITION_LINE).toBe("This training run cannot fail. From the next one on, the risk rises slowly.");
    expect(TRAINING_PATROL_LINE).toBe("This training run cannot fail. From the next one on, the risk rises slowly.");
    expect(FIRST_GATHERING_LINE).toBe("First run: see how a mission works.");
  });
});

describe("SF-6 heavy cruiser descriptions", () => {
  it("the three explorers carry the approved descriptions", () => {
    expect(SHIP_TYPES.orion.description).toBe("Heavy cruiser. A long-range explorer: enormous shields and reach, a frail hull, and almost no guns.");
    // The approved line keeps OC-D13's "of the explorer hulls": "the fastest cruise" alone is false (see below).
    expect(SHIP_TYPES.aurora.description).toBe("Heavy cruiser. A survey scout: the most module slots and the fastest cruise of the explorer hulls, at the cost of frame and hold.");
    expect(SHIP_TYPES.eir.description).toBe("Heavy cruiser. A medical transport: the largest hold and away teams the fleet fields, for supplies and evacuations.");
    for (const d of EXPLORERS) expect(d.description, d.label).toMatch(/^Heavy cruiser\. /);
  });

  it("every claim is true of the built hull", () => {
    const o = SHIP_TYPES.orion;
    expect(o.shieldCapacity).toBe(maxOf(HULLS, (d) => d.shieldCapacity)); // enormous shields
    expect(o.fuelCapacity).toBe(maxOf(HULLS, (d) => d.fuelCapacity)); // and reach
    expect(o.hullIntegrity).toBeLessThan(Math.min(...HULLS.filter((d) => d.spec === "tactician").map((d) => d.hullIntegrity))); // a frail hull
    expect(o.weaponHardpoints).toBe(1); // almost no guns
    const a = SHIP_TYPES.aurora;
    expect(a.moduleSlots).toBe(maxOf(HULLS, (d) => d.moduleSlots)); // the most module slots (the fleet's)
    expect(a.transitSpeedMult).toBe(maxOf(EXPLORERS, (d) => d.transitSpeedMult)); // the fastest cruise of the explorers
    expect(a.transitSpeedMult).toBeLessThan(maxOf(HULLS, (d) => d.transitSpeedMult)); // not of the fleet (why the qualifier stays)
    expect(a.hullIntegrity).toBe(Math.min(...EXPLORERS.map((d) => d.hullIntegrity))); // at the cost of frame
    expect(a.cargoCapacity).toBe(Math.min(...EXPLORERS.map((d) => d.cargoCapacity))); // and hold
    const e = SHIP_TYPES.eir;
    expect(e.cargoCapacity).toBe(maxOf(HULLS, (d) => d.cargoCapacity)); // the largest hold
    const awayCrew = (d: (typeof HULLS)[number]): number => (d.awayTeams ?? []).filter((t) => t.teamType !== "prospecting").reduce((n, t) => n + t.size, 0);
    expect(awayCrew(e)).toBe(maxOf(HULLS, awayCrew)); // and away teams (8; the explorer complement ties, hence not "crew")
  });

  it("the battleship's description (review answer, 2026-10-27) is true of the built hull", () => {
    const b = SHIP_TYPES.battleship;
    expect(b.description).toBe("A slow capital hull. The most armor and guns the fleet fields, with heavy shields.");
    expect(b.transitSpeedMult).toBe(Math.min(...HULLS.map((d) => d.transitSpeedMult))); // slow
    expect(b.hullIntegrity).toBe(maxOf(HULLS, (d) => d.hullIntegrity)); // the most armor
    expect(b.weaponHardpoints).toBe(maxOf(HULLS, (d) => d.weaponHardpoints)); // and guns
    expect(b.shieldCapacity).toBe(maxOf(HULLS.filter((d) => d.spec !== "explorer"), (d) => d.shieldCapacity)); // heavy shields
    expect(b.shieldCapacity).toBeLessThan(maxOf(HULLS, (d) => d.shieldCapacity)); // not the most (why it changed)
  });
});

describe("SF-6 the gathering line shows on one in-progress card", () => {
  const gathering = (id: number, phase: MissionPhase, progress: number): CaptainState =>
    ({ ...freshState().captains[0], id, mission: { kind: "extraction", missionKey: "shortOreRun", phase, phaseProgressTicks: progress, cargo: {}, recalled: false } }) as CaptainState;
  const withCaptains = (captains: CaptainState[], done: Record<string, Decimal> = {}) => ({ captains, lifetimeStats: { ...freshState().lifetimeStats, missionsCompleted: done } });

  it("the run closest to its first delivery, ties to the lowest id; none once a cycle is delivered or nobody gathers", () => {
    expect(firstGatheringCardCaptainId(withCaptains([gathering(1, "transitOut", 5), gathering(2, "extracting", 1), gathering(3, "extracting", 0)]))).toBe(2);
    expect(firstGatheringCardCaptainId(withCaptains([gathering(4, "unloading", 2), gathering(2, "unloading", 2)]))).toBe(2);
    expect(firstGatheringCardCaptainId(withCaptains([{ ...freshState().captains[0], mission: null }]))).toBeNull();
    expect(firstGatheringCardCaptainId(withCaptains([gathering(1, "extracting", 3)], { shortOreRun: new Decimal(1) }))).toBeNull();
  });
});
