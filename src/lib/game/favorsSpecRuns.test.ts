// WR-7 follow-up OC-D5 favorsSpec (plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md; USER ANSWERS
// 2026-10-29 "OC-D5 favorsSpec: +10% on its ship type (Recommended)"): a piece whose variety favors a hull spec counts
// every line +FAVORED_SPEC_LINE_BONUS while installed on a hull of that spec. Each run type reads it when stamped at
// dispatch; an unfavored hull gets nothing; a run dispatched before the bonus (no stamp) plays exactly as before.

import { describe, expect, it } from "vitest";
import {
  FAVORED_SPEC_LINE_BONUS,
  favoredSpecStamp,
  pieceFavoredSpec,
  pieceFavorsHull,
  withFavoredLines,
  type CaptainMissionState,
  type EquipmentInstance,
  type GameState,
  type PatrolMissionState,
  type ShipTypeKey,
  type ShortRangeMissionState,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, shipRepairGear } from "./tick";
import { effectiveShipStats, shipCombatRulesStamp } from "./crewOverlay";
import { missionRunSheet } from "./gearWearEngine";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { damageControlEffect, pathfinderEffect } from "./utilityGear";
import { equippedFor } from "./equipmentQueries";
import { stateHash } from "./firstRunsGoldens.fixture";
import { dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { installPiece, wiringBase } from "./wiring/probes";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import {
  FAVORS_DC,
  FAVORS_HOLD,
  FAVORS_PATROL_KEY,
  FAVORS_PF,
  asPreFavored,
  favorsExpeditionBase,
  favorsMissionBase,
  favorsPatrolBase,
  favorsShortRangeBase,
  type FavorsPiece,
} from "./favorsSpecGoldens.fixture";
import { favoredSpecText } from "../ui/favoredSpecText";
import { withFavoredSpecOff } from "./favoredSpecSwitch.fixture";

gearWearOffInThisFile();

const RNG = (): number => 0.5;
const SHIP = "ship-1";
const shipOf = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;
const piece = (over: FavorsPiece): EquipmentInstance =>
  ({ id: "p", rarity: "standard", ascension: "none", quality: 0, iLevel: 10, blueprintKey: null, implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: 0, durabilityMax: 100, ...over }) as EquipmentInstance;
const withSwitchOff = withFavoredSpecOff;
const step = (s: GameState, ticks: number): GameState => {
  let out = s;
  for (let i = 0; i < ticks; i++) out = economyTick(out, 1, RNG);
  return out;
};
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
const json = (s: GameState) => JSON.stringify(canonical(JSON.parse(JSON.stringify({ ...s, discovered: [...s.discovered].sort() }))));
function chunked(s: GameState, n: number, size: number): GameState {
  let out = s;
  for (let left = n; left > 0; left -= size) out = economyTick(out, Math.min(size, left), RNG);
  return out;
}
// The Balanced Hold carries the same line and favors no spec: the control for every hold comparison.
const BALANCED_HOLD: FavorsPiece = { ...FAVORS_HOLD, blueprintKey: "balancedHoldBp" };

describe("OC-D5: which pieces are favored where", () => {
  it("a variety names its spec through its stamp or its blueprint; Standard Issue and neutral varieties favor none", () => {
    expect(pieceFavoredSpec(piece(FAVORS_HOLD))).toBe("prospector");
    expect(pieceFavoredSpec(piece(FAVORS_DC))).toBe("tactician");
    expect(pieceFavoredSpec(piece(FAVORS_PF))).toBe("explorer");
    expect(pieceFavoredSpec(piece(BALANCED_HOLD))).toBeUndefined();
    expect(pieceFavoredSpec(piece({ slotType: "specUtility" }))).toBeUndefined(); // Standard-Issue rig: no blueprint
    expect(pieceFavorsHull(piece(FAVORS_HOLD), "prospectorHauler")).toBe(true);
    expect(pieceFavorsHull(piece(FAVORS_HOLD), "generalFreighter")).toBe(false);
    expect(pieceFavorsHull(piece(FAVORS_DC), "destroyer")).toBe(true);
    expect(pieceFavorsHull(piece(FAVORS_PF), "orion")).toBe(true);
  });

  it("a favored piece's every line counts x (1 + bonus); other pieces and other hulls are the same array", () => {
    const p = piece(FAVORS_HOLD);
    const [v] = withFavoredLines([p], "prospectorMiner");
    expect(v.implicitStats.cargoCapacity).toBeCloseTo(20 * (1 + FAVORED_SPEC_LINE_BONUS), 12);
    expect(v.rolledStats.engineEfficiency).toBeCloseTo(4 * (1 + FAVORED_SPEC_LINE_BONUS), 12);
    expect(v.rolledStats.massReduction).toBeCloseTo(3 * (1 + FAVORED_SPEC_LINE_BONUS), 12);
    expect(p.implicitStats.cargoCapacity).toBe(20); // the stored piece is untouched
    const list = [p];
    expect(withFavoredLines(list, "generalFreighter")).toBe(list);
    const neutral = [piece(BALANCED_HOLD)];
    expect(withFavoredLines(neutral, "prospectorMiner")).toBe(neutral);
  });
});

describe("OC-D5: the sheet", () => {
  const cargo = (hull: ShipTypeKey, p: FavorsPiece) => {
    const s = installPiece(wiringBase(hull), { ...p, rolledStats: {} });
    return effectiveShipStats(s, shipOf(s)).cargoCapacity;
  };
  it("a Prospector Hold's cargo counts +10% on a prospector hull, the same on any other hull", () => {
    expect(cargo("prospectorHauler", FAVORS_HOLD) - cargo("prospectorHauler", BALANCED_HOLD)).toBeCloseTo(20 * FAVORED_SPEC_LINE_BONUS, 9);
    expect(cargo("generalFreighter", FAVORS_HOLD)).toBe(cargo("generalFreighter", BALANCED_HOLD));
    expect(cargo("destroyer", FAVORS_HOLD)).toBe(cargo("destroyer", BALANCED_HOLD));
  });
  it("the Pathfinder Suite's sensors count +10% on an explorer hull", () => {
    const s = installPiece(wiringBase("orion"), FAVORS_PF);
    const off = withSwitchOff(() => effectiveShipStats(s, shipOf(s)).sensors);
    expect(effectiveShipStats(s, shipOf(s)).sensors - off).toBeCloseTo(8 * FAVORED_SPEC_LINE_BONUS, 9);
  });
});

describe("OC-D5: captain missions", () => {
  it("a mission dispatched with a favored piece is stamped and reads the bonus; an unfavored hull is not stamped", () => {
    const r = dispatchCaptainOnMission(favorsMissionBase("prospectorMiner"), 1, "shortOreRun");
    const m = r.next.captains[0].mission as CaptainMissionState;
    expect(m.favoredSpec).toBe(1);
    const { favoredSpec: _drop, ...legacy } = m;
    const ship = shipOf(r.next);
    const lift = missionRunSheet(r.next, ship, m).cargoCapacity - missionRunSheet(r.next, ship, legacy).cargoCapacity;
    expect(lift).toBeCloseTo(20 * FAVORED_SPEC_LINE_BONUS, 9);
    expect(missionRunSheet(r.next, ship, m).extractionYieldMult).toBeGreaterThan(missionRunSheet(r.next, ship, legacy).extractionYieldMult);
    const plain = dispatchCaptainOnMission(favorsMissionBase("generalFreighter"), 1, "shortOreRun");
    expect((plain.next.captains[0].mission as CaptainMissionState).favoredSpec).toBeUndefined();
  });

  it("the bonus measurably acts on the run; a run in flight from before plays exactly as the pre-bonus engine", () => {
    const fresh = dispatchCaptainOnMission(favorsMissionBase("prospectorMiner"), 1, "shortOreRun").next;
    const old = withSwitchOff(() => step(dispatchCaptainOnMission(favorsMissionBase("prospectorMiner"), 1, "shortOreRun").next, 2000));
    expect(stateHash(asPreFavored(step(fresh, 2000)))).not.toBe(stateHash(old));
    expect(stateHash(asPreFavored(step(asPreFavored(fresh), 2000)))).toBe(stateHash(old));
  });

  // The EM-4 parity pattern (emodEm4.test.ts): a call spanning more than one homecoming holds the run at a transit berth
  // (a per-call budget, Standard Issue included), so the chunks and the one call stay within one homecoming each.
  it("the Repeat cycles carry the stamp, and one call == chunked == 1 s steps", () => {
    const fresh = dispatchCaptainOnMission(favorsMissionBase("prospectorMiner"), 1, "shortOreRun").next;
    const steps = step(fresh, 2400);
    expect(Number(steps.lifetimeStats.missionsCompleted.shortOreRun ?? 0)).toBeGreaterThan(2);
    expect((steps.captains[0].mission as CaptainMissionState).favoredSpec).toBe(1);
    expect(json(chunked(fresh, 2400, 97))).toBe(json(steps));
    expect(json(economyTick(fresh, 120, RNG))).toBe(json(step(fresh, 120)));
  });
});

describe("OC-D5: short-range runs", () => {
  it("a run dispatched with a favored piece is stamped and its cycles read the bonus; a run from before reads none", () => {
    const r = dispatchCaptainOnShortRange(favorsShortRangeBase(FAVORS_PF), 1, 0);
    expect(r.success).toBe(true);
    const m = r.next.captains[0].mission as ShortRangeMissionState;
    expect(m.favoredSpec).toBe(1);
    const { favoredSpec: _drop, ...legacy } = m;
    const ship = shipOf(r.next);
    expect(missionRunSheet(r.next, ship, m).sensors - missionRunSheet(r.next, ship, legacy).sensors).toBeCloseTo(8 * FAVORED_SPEC_LINE_BONUS, 9);
    // The stamp rides every later cycle of the run.
    const later = step(r.next, m.plan.totalTicks + 5);
    const next = later.captains[0].mission as ShortRangeMissionState | null;
    expect(next?.kind).toBe("shortRange");
    expect(next?.favoredSpec).toBe(1);
    // An unfavored piece on the Eir (a Prospector Hold) stamps nothing.
    const plain = dispatchCaptainOnShortRange(favorsShortRangeBase(FAVORS_HOLD), 1, 0);
    expect((plain.next.captains[0].mission as ShortRangeMissionState).favoredSpec).toBeUndefined();
  });

  it("a stamped run: one call == chunked == 1 s steps", () => {
    const s0 = dispatchCaptainOnShortRange(favorsShortRangeBase(FAVORS_PF), 1, 0).next;
    const steps = step(s0, 2400);
    expect(json(chunked(s0, 2400, 997))).toBe(json(steps));
    expect(json(economyTick(s0, 2400, RNG))).toBe(json(steps));
  });

  it("a run in flight from before plays exactly as the pre-bonus engine", () => {
    const fresh = dispatchCaptainOnShortRange(favorsShortRangeBase(FAVORS_PF), 1, 0).next;
    const old = withSwitchOff(() => step(dispatchCaptainOnShortRange(favorsShortRangeBase(FAVORS_PF), 1, 0).next, 900));
    expect(stateHash(asPreFavored(step(asPreFavored(fresh), 900)))).toBe(stateHash(old));
  });
});

describe("OC-D5: patrols", () => {
  const dispatch = (hull: ShipTypeKey, p: FavorsPiece, repeat: boolean) => dispatchCaptainOnPatrol(favorsPatrolBase(hull, p), 1, FAVORS_PATROL_KEY, "balanced", repeat);

  it("a patrol dispatched with a favored piece is stamped and every relaunch carries it; an unfavored hull is not", () => {
    const r = dispatch("destroyer", FAVORS_DC, true);
    const m = r.next.captains[0].mission as PatrolMissionState;
    expect(m.favoredSpec).toBe(1);
    const later = step(r.next, 200);
    const relaunched = later.captains[0].mission as PatrolMissionState;
    expect(relaunched.masterSeed).not.toBe(m.masterSeed);
    expect(relaunched.favoredSpec).toBe(1);
    expect((dispatch("generalFreighter", FAVORS_HOLD, false).next.captains[0].mission as PatrolMissionState).favoredSpec).toBeUndefined();
  });

  it("the Damage Control Suite's patch-up reads its favored lines on a stamped cycle, as stored on a cycle from before", () => {
    // A cycle that opens with the hull at a third: every later wave's patch-up acts.
    const hurt = (s: GameState): GameState => ({
      ...s,
      captains: s.captains.map((c, i) => (i === 0 && c.mission?.kind === "patrol" ? { ...c, mission: { ...c.mission, playerHull: Math.floor(c.mission.playerHull / 3) } } : c)),
    });
    const strong: FavorsPiece = { ...FAVORS_DC, implicitStats: { repairSpeed: 10, waveHullRegen: 60 } };
    const fresh = hurt(dispatch("destroyer", strong, false).next);
    const hullTrace = (s0: GameState): number[] => {
      const out: number[] = [];
      let s = s0;
      for (let i = 0; i < 20 && s.captains[0].mission !== null; i++) {
        s = economyTick(s, 1, RNG);
        const m = s.captains[0].mission as PatrolMissionState | null;
        if (m) out.push(m.playerHull);
      }
      return out;
    };
    const stamped = hullTrace(fresh);
    const legacy = hullTrace(asPreFavored(fresh));
    expect(stamped).not.toEqual(legacy);
    expect(stamped.reduce((a, b) => a + b, 0)).toBeGreaterThan(legacy.reduce((a, b) => a + b, 0));
    // The cycle from before plays exactly as the pre-bonus engine.
    const old = withSwitchOff(() => hullTrace(hurt(dispatch("destroyer", strong, false).next)));
    expect(legacy).toEqual(old);
    // The reader: favored on the Destroyer, as stored on an unfavored hull.
    const gear = equippedFor(fresh, SHIP);
    expect(damageControlEffect(withFavoredLines(gear, "destroyer")).waveHullRegenFraction).toBeGreaterThan(damageControlEffect(gear).waveHullRegenFraction);
  });

  it("a stamped Repeat patrol: one call == chunked == 1 s steps", () => {
    const s0 = dispatch("destroyer", FAVORS_DC, true).next;
    const steps = step(s0, 600);
    expect(json(chunked(s0, 600, 97))).toBe(json(steps));
    expect(json(economyTick(s0, 600, RNG))).toBe(json(steps));
  });

  it("a relaunched cycle's combat speed reads the favored mass relief only on a stamped run", () => {
    const heavy: FavorsPiece = { ...FAVORS_DC, mass: 40, rolledStats: { massReduction: 30 } };
    const s = favorsPatrolBase("destroyer", heavy);
    const ship = shipOf(s);
    expect(shipCombatRulesStamp(s, ship, true)?.speed).toBeGreaterThan(shipCombatRulesStamp(s, ship, false)?.speed ?? Infinity);
  });
});

describe("OC-D5: expeditions", () => {
  it("the Pathfinder Suite's favored lines freeze into the dispatch snapshot; an unfavored piece's do not", () => {
    const launch = (p: FavorsPiece) => dispatchPastPropulsion(favorsExpeditionBase(p), SHIP, 1, "cand-0").expedition!;
    const now = launch(FAVORS_PF);
    const before = withSwitchOff(() => launch(FAVORS_PF));
    expect(now.sensorPower - before.sensorPower).toBeCloseTo(8 * FAVORED_SPEC_LINE_BONUS, 9);
    expect(now.scanSpeedBonus).toBeGreaterThan(before.scanSpeedBonus);
    expect(now.hazardResist).toBeGreaterThan(before.hazardResist);
    const pf = (pts: number) => pathfinderEffect([piece({ ...FAVORS_PF, implicitStats: { expeditionScanSpeed: pts } })]).scanSpeed;
    expect(now.scanSpeedBonus - before.scanSpeedBonus).toBeCloseTo(pf(10 * (1 + FAVORED_SPEC_LINE_BONUS)) - pf(10), 12);
    // The Damage Control Suite favors tactician hulls: on an Orion its frozen field repair is as stored.
    const dc = launch(FAVORS_DC);
    expect(dc).toEqual(withSwitchOff(() => launch(FAVORS_DC)));
  });

  it("an expedition in flight keeps the record it launched with", () => {
    const old = withSwitchOff(() => dispatchPastPropulsion(favorsExpeditionBase(FAVORS_PF), SHIP, 1, "cand-0").next);
    const t = 6 * 3600;
    expect(stateHash(economyTick(old, t, RNG))).toBe(withSwitchOff(() => stateHash(economyTick(old, t, RNG))));
  });
});

describe("OC-D5: the Shipyard and the stamp", () => {
  it("a Shipyard repair reads the suite's favored lines on a Tactician hull", () => {
    const tact = installPiece(wiringBase("destroyer"), FAVORS_DC);
    const expl = installPiece(wiringBase("orion"), FAVORS_DC);
    expect(shipRepairGear(tact, SHIP).find((p) => p.slotType === "specUtility")!.implicitStats.repairSpeed).toBeCloseTo(10 * (1 + FAVORED_SPEC_LINE_BONUS), 12);
    expect(shipRepairGear(expl, SHIP).find((p) => p.slotType === "specUtility")!.implicitStats.repairSpeed).toBe(10);
  });
  it("favoredSpecStamp is 1 only with a favored piece installed", () => {
    expect(favoredSpecStamp(equippedFor(installPiece(wiringBase("orion"), FAVORS_PF), SHIP), "orion")).toBe(1);
    expect(favoredSpecStamp(equippedFor(installPiece(wiringBase("orion"), FAVORS_DC), SHIP), "orion")).toBeUndefined();
    expect(favoredSpecStamp(equippedFor(wiringBase("prospectorMiner"), SHIP), "prospectorMiner")).toBeUndefined(); // Standard Issue
  });
});

describe("OC-D5: the tooltip line (US English, no dashes, install)", () => {
  it("names the favored spec, and whether it applies on the host hull", () => {
    const hold = piece(FAVORS_HOLD);
    expect(favoredSpecText(hold)).toBe("Favors Prospector hulls: every line counts +10% while installed on one");
    expect(favoredSpecText(hold, "prospectorHauler")).toBe("Favored hull: every line counts +10% on this Hauler");
    expect(favoredSpecText(hold, "destroyer")).toBe("Favors Prospector hulls: every line counts +10% while installed on one");
    expect(favoredSpecText(piece(BALANCED_HOLD), "prospectorHauler")).toBeNull();
    for (const t of [favoredSpecText(hold), favoredSpecText(piece(FAVORS_DC), "destroyer"), favoredSpecText(piece(FAVORS_PF), "eir")]) {
      expect(t).not.toMatch(/—|--|\bfit/i);
    }
  });
});
