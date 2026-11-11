// E-MOD EM-4 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-4; user answer P3
// 2026-10-17 "Speeds the drive (Recommended)"; B10): the reactor surplus drive lift (reactorSurplus.ts).
//
//   - Never slower (user 2026-10-23, the B10 guarantee): every Reactor Core variety at every item level 1 to 40 (worst,
//     seeded and Radiant rolls) leaves every hull at least as fast as its Standard-Issue core, light or heavily loaded,
//     on the sheet, the mission legs, the combat stamp and the voyage; a core whose lift is below its own drag flies
//     exactly at the Standard-Issue speed. Soften the top (user 2026-10-23): the best core is +30 to +40%.
//   - The Standard-Issue core is byte-identical (the same sheet object; no flag on a run).
//   - The curve is D23: exactly 1 at no surplus, strictly rising, concave, never capped.
//   - The surplus is shipPower.ts shipPowerBudget's reactorSurplus exactly (in budget, a draw eating part of the
//     reactor, the whole reactor spoken for, power efficiency freeing it back).
//   - The run flag: stamped at dispatch on a ship with a powered core, carried by every later cycle, kept by the save,
//     refused when malformed; a run without it reads no lift, and the Home dashboard reads the run the way the engine
//     does.
//   - Offline == live: one call, chunks and 1 s steps agree for a flagged mission and short-range run.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { MISSIONS, SHIP_TYPES, effectiveMissionDef, type CaptainMissionState, type EquipmentInstance, type GameState, type ShipTypeKey, type ShortRangeMissionState } from "./model";
import { dispatchCaptainOnMission, economyTick } from "./tick";
import { effectiveShipStats, shipCombatRulesStamp, shipReactorSurplus } from "./crewOverlay";
import { shipPowerBudget } from "./shipPower";
import { REACTOR_LIFT_VERSION, REACTOR_SURPLUS_LIFT, reactorSurplusSpeedLift } from "./reactorSurplus";
import { diminishing } from "./diminishing";
import { dispatchCaptainOnShortRange, isWellFormedShortRangeMission } from "./shortRangeBoard";
import { buildHomeDashboard } from "./homeDashboard";
import { deserialize, migrate, serialize } from "./save";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { seatOfficer } from "./wiring/probes";
import { EM4_SHIP, em4Core, mintCore, shortRangeBase, withCore, withDraw, worstCore } from "./emodEm4.fixture";
import { withReactorLiftOff } from "./emodEm4Switch.fixture";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();

const RNG = (): number => 0.5;
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const ship1 = (s: GameState) => s.ships.find((sh) => sh.id === EM4_SHIP)!;
const sheet = (s: GameState) => effectiveShipStats(s, ship1(s));

// The cores the never-slower sweep mints: every Reactor Core variety at every item level 1 to 40, the worst
// Standard-quality roll (lowest output, heaviest) and four seeded Standard rolls, plus a quality 5 Radiant roll.
const VARIETIES = ["efficientCore", "balancedCore", "highOutputCore"] as const;
function sweepCores(variety: string, iLevel: number): EquipmentInstance[] {
  return [worstCore(variety, iLevel), ...[1, 2, 3, 4].map((k) => mintCore(variety, iLevel, 0, "standard", 0x77 * k + iLevel)), mintCore(variety, iLevel, 5, "radiant", 0x5e + iLevel)];
}
// ship-1 with an extra 60-mass piece aboard (a heavily loaded ship: the core's own drag is a smaller share).
function loaded(s: GameState): GameState {
  const w = withDraw(s, 0);
  return { ...w, equipment: w.equipment.map((e) => (e.id === "em4-bay" ? { ...e, mass: 60 } : e)) };
}
const legs = (s: GameState) => {
  const d = effectiveMissionDef(MISSIONS.longOreRun, sheet(s));
  return d.transitOutTicks + d.transitBackTicks;
};

describe("EM-4 never slower (user 2026-10-23): a crafted Reactor Core never makes a ship slower than its Standard-Issue core", () => {
  it("every hull, every variety, item levels 1 to 40, light and loaded: the sheet speed and the mission legs", () => {
    for (const hull of HULLS) {
      for (const base of [onHull(hull), loaded(onHull(hull))]) {
        const siSpeed = sheet(base).transitSpeedMult;
        const siLegs = legs(base);
        for (const variety of VARIETIES) {
          for (let iLevel = 1; iLevel <= 40; iLevel++) {
            for (const core of sweepCores(variety, iLevel)) {
              const s = withCore(base, core);
              expect(sheet(s).transitSpeedMult, `${hull} ${variety} iL${iLevel}`).toBeGreaterThanOrEqual(siSpeed);
              expect(legs(s), `${hull} ${variety} iL${iLevel} legs`).toBeLessThanOrEqual(siLegs);
            }
          }
        }
      }
    }
  });

  it("the combat stamp speed (every combat hull) and the Orion's voyage, item levels 1 to 40", () => {
    for (const hull of ["generalFreighter", "destroyer", "battleship", "carrier", "orion"] as ShipTypeKey[]) {
      const si = onHull(hull);
      const siSpeed = shipCombatRulesStamp(si, ship1(si))!.speed;
      for (const variety of VARIETIES) {
        for (let iLevel = 1; iLevel <= 40; iLevel++) {
          const s = withCore(si, worstCore(variety, iLevel));
          expect(shipCombatRulesStamp(s, ship1(s))!.speed, `${hull} ${variety} iL${iLevel}`).toBeGreaterThanOrEqual(siSpeed);
        }
      }
    }
    const orion = asExpeditionVeteran(withCrew(onHull("orion"), "d18"));
    const voyage = (s: GameState) => dispatchPastPropulsion(s, EM4_SHIP, 1, "cand-0").expedition!.voyage!;
    const siVoyage = voyage(orion);
    for (const variety of VARIETIES) {
      for (let iLevel = 1; iLevel <= 40; iLevel += 3) {
        const v = voyage(withCore(orion, worstCore(variety, iLevel)));
        expect(v.outboundSeconds, `${variety} iL${iLevel}`).toBeLessThanOrEqual(siVoyage.outboundSeconds);
        expect(v.returnSeconds, `${variety} iL${iLevel}`).toBeLessThanOrEqual(siVoyage.returnSeconds);
      }
    }
  });

  it("a core whose lift is below its own drag flies exactly at the Standard-Issue speed; one past it flies faster", () => {
    for (const hull of HULLS) {
      const si = onHull(hull);
      const ref = withCore(si, em4Core("ref"));
      expect(sheet(ref).transitSpeedMult, hull).toBe(sheet(si).transitSpeedMult);
      // The same core with no surplus left (a draw eats it all) also holds the floor.
      const spent = withDraw(ref, SHIP_TYPES[hull].basePowerOutput + 40);
      expect(shipReactorSurplus(spent, ship1(spent))).toBe(0);
      expect(sheet(spent).transitSpeedMult, `${hull} spent`).toBe(sheet(withDraw(si, SHIP_TYPES[hull].basePowerOutput + 40)).transitSpeedMult);
      // The top core (mass 0) flies its whole lift faster.
      const top = withCore(si, em4Core("top"));
      expect(sheet(top).transitSpeedMult, `${hull} top`).toBeGreaterThan(sheet(si).transitSpeedMult);
    }
  });

  it("soften the top (user 2026-10-23): the best core 0.14.0 can mint flies about +30 to +40% over Standard Issue", () => {
    for (const hull of HULLS) {
      const si = onHull(hull);
      const top = withCore(si, em4Core("top"));
      const gain = sheet(top).transitSpeedMult / sheet(si).transitSpeedMult - 1;
      expect(gain, hull).toBeGreaterThanOrEqual(0.3);
      expect(gain, hull).toBeLessThanOrEqual(0.4);
    }
  });

  it("the Standard-Issue core reads exactly as before EM-4: no surplus, the same sheet object, no run flag", () => {
    for (const hull of HULLS) {
      const s = onHull(hull);
      expect(shipReactorSurplus(s, ship1(s))).toBe(0);
      expect(sheet(s)).toEqual(withReactorLiftOff(() => sheet(s)));
    }
    const s = { ...onHull("generalFreighter"), captains: onHull("generalFreighter").captains.map((c) => ({ ...c, level: 10 })) };
    const m = dispatchCaptainOnMission(s, 1, "shortOreRun").next.captains[0].mission as CaptainMissionState;
    expect(m.reactorLift).toBeUndefined();
  });

  it("the combat stamp speed rises with the lift (the WR-8 hand-off): faster than Standard Issue with the ref core", () => {
    for (const hull of ["destroyer", "battleship", "carrier", "orion"] as ShipTypeKey[]) {
      const si = onHull(hull);
      const ref = withCore(si, em4Core("ref"));
      expect(shipCombatRulesStamp(ref, ship1(ref))!.speed, hull).toBeGreaterThan(withReactorLiftOff(() => shipCombatRulesStamp(ref, ship1(ref))!.speed));
      expect(shipCombatRulesStamp(ref, ship1(ref))!.speed, hull).toBeGreaterThanOrEqual(shipCombatRulesStamp(si, ship1(si))!.speed);
    }
  });
});

describe("EM-4 the curve (D23: concave, never capped)", () => {
  it("is 1 at no surplus and 1 + perPoint x diminishing(surplus, knee) above it", () => {
    expect(reactorSurplusSpeedLift(0)).toBe(1);
    expect(reactorSurplusSpeedLift(-5)).toBe(1);
    expect(reactorSurplusSpeedLift(23)).toBeCloseTo(1 + REACTOR_SURPLUS_LIFT.perPoint * diminishing(23, REACTOR_SURPLUS_LIFT.knee), 12);
    expect(withReactorLiftOff(() => reactorSurplusSpeedLift(100))).toBe(1);
  });

  it("strictly rises with shrinking steps, and keeps rising far past the knee", () => {
    let prev = reactorSurplusSpeedLift(0);
    let prevStep = Infinity;
    for (let s = 1; s <= 400; s++) {
      const v = reactorSurplusSpeedLift(s);
      expect(v).toBeGreaterThan(prev);
      expect(v - prev).toBeLessThan(prevStep);
      prevStep = v - prev;
      prev = v;
    }
    expect(reactorSurplusSpeedLift(1e6)).toBeGreaterThan(reactorSurplusSpeedLift(1e5) + 1);
  });
});

describe("EM-4 the surplus is the power budget's reactorSurplus", () => {
  it("in budget, partly spoken for, wholly spoken for, and freed back by Reactor Overdrive", () => {
    for (const hull of HULLS) {
      const base = withCore(onHull(hull), em4Core("ref"));
      const out = SHIP_TYPES[hull].basePowerOutput;
      const cases: GameState[] = [
        base,
        withDraw(base, out + 10),
        withDraw(base, out + 40),
        seatOfficer(withDraw(base, out + 10), "engineering", ["eng.overdrive"]),
        seatOfficer(withDraw(base, out + 40), "engineering", ["eng.overdrive"]),
      ];
      for (const [i, s] of cases.entries()) {
        expect(shipReactorSurplus(s, ship1(s)), `${hull} case ${i}`).toBe(shipPowerBudget(s, EM4_SHIP).reactorSurplus);
      }
      const reactor = shipPowerBudget(base, EM4_SHIP).reactorOutput;
      expect(shipReactorSurplus(base, ship1(base))).toBe(reactor);
      expect(shipReactorSurplus(cases[1], ship1(cases[1]))).toBe(reactor - 10);
      expect(shipReactorSurplus(cases[2], ship1(cases[2]))).toBe(0);
      expect(shipReactorSurplus(cases[3], ship1(cases[3]))).toBeGreaterThan(reactor - 10);
      // No surplus, no lift: the never-slower floor holds the ship at its Standard-Issue speed.
      expect(sheet(cases[2]).transitSpeedMult).toBe(sheet(withDraw(onHull(hull), out + 40)).transitSpeedMult);
    }
  });
});

// ===== the run flag =====

function missionBase(core = true): GameState {
  const b = core ? withCore(onHull("generalFreighter"), em4Core("ref")) : onHull("generalFreighter");
  return { ...b, credits: new Decimal(1_000_000), captains: b.captains.map((c) => ({ ...c, level: 10 })) };
}
const extraction = (s: GameState) => s.captains[0].mission as CaptainMissionState;
const shortRun = (s: GameState) => s.captains[0].mission as ShortRangeMissionState;

describe("EM-4 the run flag", () => {
  it("a mission dispatched on a ship with a powered core carries it into every repeated cycle and through the save", () => {
    const r = dispatchCaptainOnMission(missionBase(), 1, "shortOreRun");
    expect(extraction(r.next).reactorLift).toEqual({ version: REACTOR_LIFT_VERSION });
    let s = r.next;
    const completed = () => Number(s.lifetimeStats.missionsCompleted.shortOreRun ?? 0);
    for (let i = 0; i < 4000 && completed() < 2; i++) s = economyTick(s, 1, RNG);
    expect(completed()).toBeGreaterThanOrEqual(2);
    expect(extraction(s).reactorLift).toEqual({ version: REACTOR_LIFT_VERSION });
    const back = migrate(deserialize(serialize(s, 0, 0))!);
    expect(extraction(back).reactorLift).toEqual({ version: REACTOR_LIFT_VERSION });
  });

  it("a mission's legs read the lift only with the flag; the Home dashboard reads the run the way the engine does", () => {
    const r = dispatchCaptainOnMission(missionBase(), 1, "shortOreRun");
    const flagged = r.next;
    const unflagged: GameState = { ...flagged, captains: flagged.captains.map((c, i) => (i === 0 ? { ...c, mission: { ...extraction(flagged), reactorLift: undefined } } : c)) };
    const def = (lift: boolean, s: GameState) => effectiveMissionDef(MISSIONS.shortOreRun, effectiveShipStats(s, ship1(s), { reactorLift: lift }));
    expect(def(true, flagged).transitOutTicks).toBeLessThan(def(false, flagged).transitOutTicks);
    // Step both into the outbound leg: the flagged run's leg is the lifted one, on the engine and on the dashboard.
    let a = flagged;
    let b = unflagged;
    while (extraction(a).phase !== "transitOut") a = economyTick(a, 1, RNG);
    while (extraction(b).phase !== "transitOut") b = economyTick(b, 1, RNG);
    const row = (s: GameState) => buildHomeDashboard(s).inProgress.find((x) => x.id === "extraction-1")!;
    expect(row(a).durationTicks).toBe(Math.ceil(def(true, a).transitOutTicks));
    expect(row(b).durationTicks).toBe(Math.ceil(def(false, b).transitOutTicks));
    let ta = 0;
    while (extraction(a).phase === "transitOut") {
      a = economyTick(a, 1, RNG);
      ta += 1;
    }
    let tb = 0;
    while (extraction(b).phase === "transitOut") {
      b = economyTick(b, 1, RNG);
      tb += 1;
    }
    expect(ta).toBe(def(true, flagged).transitOutTicks);
    expect(tb).toBe(def(false, flagged).transitOutTicks);
  });

  it("a short-range run carries it into its later cycles; a malformed flag is refused", () => {
    const r = dispatchCaptainOnShortRange(shortRangeBase(em4Core("ref")), 1, 0);
    expect(r.success).toBe(true);
    expect(shortRun(r.next).reactorLift).toEqual({ version: REACTOR_LIFT_VERSION });
    let s = r.next;
    const first = shortRun(s).roll.cycleIndex;
    for (let i = 0; i < 4000 && shortRun(s).roll.cycleIndex === first; i++) s = economyTick(s, 1, RNG);
    expect(shortRun(s).roll.cycleIndex).not.toBe(first);
    expect(shortRun(s).reactorLift).toEqual({ version: REACTOR_LIFT_VERSION });
    expect(isWellFormedShortRangeMission(shortRun(s))).toBe(true);
    expect(isWellFormedShortRangeMission({ ...shortRun(s), reactorLift: { version: 2 } as unknown as { version: 1 } })).toBe(false);
    // Without a powered core no flag is written (the run is exactly the pre-EM-4 one).
    const plain = dispatchCaptainOnShortRange(shortRangeBase(), 1, 0);
    expect(shortRun(plain.next).reactorLift).toBeUndefined();
  });
});

// ===== offline == live =====

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
// Object keys sorted (the inventory key order wrinkle, its own follow-up); `discovered` compared as it stands (the
// ordering determinism slice, canonicalOrder.ts, keeps it in one order however the time is cut).
const json = (s: GameState) => JSON.stringify(canonical(JSON.parse(JSON.stringify(s))));
function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}
function chunked(s: GameState, n: number, size = 997): GameState {
  let out = s;
  for (let left = n; left > 0; left -= size) out = economyTick(out, Math.min(size, left), RNG);
  return out;
}

describe("EM-4 offline == live with the lift", () => {
  // An extraction claims its transit berths from a PER-CALL budget (tick.ts, 0.13.4), so a call spanning more than one
  // of its homecomings holds it at a berth (Standard Issue included; production and the offline catch-up both step
  // economyTick(state, 1)). The chunks and the one call here stay within one homecoming each.
  it("a flagged Short Ore Run on Repeat: one call, 97 s chunks and 1 s steps agree", () => {
    const s0 = dispatchCaptainOnMission(missionBase(), 1, "shortOreRun").next;
    expect(extraction(s0).reactorLift).toBeDefined();
    const steps = stepped(s0, 2400);
    expect(Number(steps.lifetimeStats.missionsCompleted.shortOreRun ?? 0)).toBeGreaterThan(5);
    expect(json(chunked(s0, 2400, 97))).toBe(json(steps));
    expect(json(economyTick(s0, 120, RNG))).toBe(json(stepped(s0, 120)));
  });

  it("a flagged short-range run: one call, 997 s chunks and 1 s steps agree", () => {
    const s0 = dispatchCaptainOnShortRange(shortRangeBase(em4Core("ref")), 1, 0).next;
    expect(shortRun(s0).reactorLift).toBeDefined();
    const steps = stepped(s0, 2400);
    expect(json(chunked(s0, 2400))).toBe(json(steps));
    expect(json(economyTick(s0, 2400, RNG))).toBe(json(steps));
  });
});
