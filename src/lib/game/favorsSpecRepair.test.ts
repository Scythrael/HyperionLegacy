// WR-7 follow-up OC-D5 favorsSpec, review fix (2026-10-30): the Damage Control Suite's gear repair term (gearWearEngine.ts
// shipRepairBonuses) reads its favored-spec lines only on a run stamped with favoredSpec. A Repeat patrol freezes its
// repair rates at dispatch and at every relaunch (tick.ts), and the tail pass settles the pieces at the same rates, so
// a Repeat patrol already in flight at the update (no stamp) must keep repairing exactly as before, past its relaunches,
// while a run dispatched now (stamped) repairs faster on a Tactician hull. Gear wear is ON in this file (the default).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type EquipmentInstance, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { pieceCondition, withPieceCondition } from "./gearWear";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { DAMAGE_CONTROL_SUITE_KEY } from "./utilityGear";
import { withFavoredSpecOff } from "./favoredSpecSwitch.fixture";
import { asPreFavored } from "./favorsSpecGoldens.fixture";

const RNG = (): number => 0.5;
const TICKS = 3000;
const step = (s: GameState, n: number): GameState => {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
};
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
const json = (s: GameState) => JSON.stringify(canonical(JSON.parse(JSON.stringify({ ...s, discovered: [...s.discovered].sort() }))));
const patrolOf = (s: GameState): PatrolMissionState => s.captains[0].mission as PatrolMissionState;

// A Destroyer (Tactician) with a Damage Control Suite carrying ONLY its repair line (no patch-up, no mass), so the
// favored bonus can move nothing but the gear repair rates; every installed piece starts worn, so they repair underway.
function base(): GameState {
  const s = asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(1_000_000) });
  const suite = {
    id: "fav-dc",
    slotType: "specUtility",
    moduleVariant: DAMAGE_CONTROL_SUITE_KEY,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 20,
    blueprintKey: null,
    implicitStats: { repairSpeed: 40 },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: "ship-1",
  } as unknown as EquipmentInstance;
  const kept = s.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === "specUtility"));
  const equipment = [...kept, suite].map((e) => (e.fittedToShipId === "ship-1" ? withPieceCondition(e, 700, s.gameTimeSeconds) : e));
  return { ...s, equipment };
}
const dispatchRepeat = (s: GameState): GameState => {
  const r = dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", true);
  expect(r.success, r.reason).toBe(true);
  return r.next;
};
const conditions = (s: GameState): number[] => s.equipment.filter((e) => e.fittedToShipId === "ship-1").map((e) => pieceCondition(e));

describe("OC-D5 review: a Repeat patrol's gear repair with a Damage Control Suite", () => {
  it("a run in flight from before the bonus (no stamp) repairs byte-identically to the pre-bonus engine, past its relaunches", () => {
    // Dispatched by the pre-bonus engine: no stamp, and its first cycle's rates frozen without the bonus.
    const inFlight = withFavoredSpecOff(() => dispatchRepeat(base()));
    expect(patrolOf(inFlight).favoredSpec).toBeUndefined();
    const now = step(inFlight, TICKS);
    const pre = withFavoredSpecOff(() => step(inFlight, TICKS));
    // Past at least one relaunch (the rates a relaunch freezes are in play), still the same run.
    expect(patrolOf(now)?.kind).toBe("patrol");
    expect(patrolOf(now).masterSeed).not.toBe(patrolOf(inFlight).masterSeed);
    expect(conditions(now)).not.toEqual(conditions(inFlight)); // the pieces did settle (repair and wear acted)
    expect(json(now)).toBe(json(pre));
    // One call == 1 s steps on the unstamped run too.
    expect(json(economyTick(inFlight, TICKS, RNG))).toBe(json(now));
  });

  it("a run dispatched now is stamped and its pieces repair faster than the same run unstamped", () => {
    const fresh = dispatchRepeat(base());
    expect(patrolOf(fresh).favoredSpec).toBe(1);
    const stamped = step(fresh, TICKS);
    const legacy = step(asPreFavored(fresh), TICKS);
    expect(patrolOf(stamped).favoredSpec).toBe(1); // the stamp rides every relaunch
    expect(patrolOf(stamped).masterSeed).not.toBe(patrolOf(fresh).masterSeed);
    // Repair settles in whole per-mille, carrying the leftover time in the piece's anchor (conditionAt): at the same
    // condition an EARLIER anchor at a faster rate is further toward the next per-mille. Every worn piece of the stamped
    // run is at least as far along as the unstamped one, and some strictly further.
    const pieces = (s: GameState) => s.equipment.filter((e) => e.fittedToShipId === "ship-1");
    const a = pieces(stamped);
    const b = pieces(legacy);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    let ahead = 0;
    for (let i = 0; i < a.length; i++) {
      expect(pieceCondition(a[i]), a[i].id).toBeGreaterThanOrEqual(pieceCondition(b[i]));
      if (pieceCondition(a[i]) > pieceCondition(b[i])) ahead += 1;
      else if (a[i].conditionAt !== undefined && b[i].conditionAt !== undefined) {
        expect(a[i].conditionAt!, a[i].id).toBeLessThanOrEqual(b[i].conditionAt!);
        if (a[i].conditionAt! < b[i].conditionAt!) ahead += 1;
      }
    }
    expect(ahead).toBeGreaterThan(0);
    // One call == 1 s steps on the stamped run.
    expect(json(economyTick(fresh, TICKS, RNG))).toBe(json(stamped));
  });
});
