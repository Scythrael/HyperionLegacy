// E-MOD EM-4 GOLDENS FIRST (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-4; user answer P3
// 2026-10-17 "Speeds the drive (Recommended)"): everything a crafted Reactor Core's speed reaches, captured on the code
// BEFORE any EM-4 engine edit (on feat e1ee724), so the engine commit has to name every move it makes. Real mints
// (emodEm4.fixture.ts: ref, the worst Standard-quality tier 1 roll at item level 20; mid; top) and real dispatches
// through the live engine (1 s economyTick steps), nothing edited after dispatch:
//
//   1. sheet    : effectiveShipStats for every hull with the Standard-Issue core (si) and each crafted core, plus the
//                 ref core on a ship whose draw already eats part of it (refOver) and the same with an Engineering
//                 officer carrying Reactor Overdrive (refOverCrew).
//   2. mission  : a Short Ore Run on a General Freighter and a Prospector Runner, 700 s.
//   3. shortRange: a qualified Eir's first short-range run, 900 s.
//   4. voyage   : an Orion's Ground Operations dispatch: the voyage it freezes and the whole expedition (its ship-event
//                 combat stamp included).
//   5. stamp    : the combat rules stamp a run starting now writes (crewOverlay.ts shipCombatRulesStamp: its speed).
//   6. patrol   : Dispatch Once on four hulls x both routes under the WR-8 rules: the record, the outcome, the state.
//   7. forecast : the dispatch card's Threat Assessment wins of 64.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, type GameState, type MissionKey, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick } from "./tick";
import { equippedFor } from "./equipment";
import { effectiveShipStats, resolveCrew, shipCombatRulesStamp } from "./crewOverlay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol } from "./combat/bridge";
import { resolvePatrolWaves } from "./combat/patrolReplay";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { patrolDifficultyAt } from "./runDifficulty";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { hash, onHull, stateHash, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { editShip, installPiece, seatOfficer, wiringBase } from "./wiring/probes";
import { EM4_CORES, EM4_SHIP, em4Core, withCore, withDraw, type Em4CoreName } from "./emodEm4.fixture";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
// The pins are about speed, not gear wear: use wear stays off so a later wear tune never moves them.
gearWearOffInThisFile();

const RNG = (): number => 0.5;
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
export type Em4Fit = "si" | Em4CoreName;
export const EM4_FITS: readonly Em4Fit[] = ["si", ...EM4_CORES];
const fit = (s: GameState, f: Em4Fit): GameState => (f === "si" ? s : withCore(s, em4Core(f)));
const sheetOf = (s: GameState) => effectiveShipStats(s, s.ships.find((sh) => sh.id === EM4_SHIP)!);

// ===== 1. sheet =====
export function sheetRow(hull: ShipTypeKey, f: Em4Fit | "refOver" | "refOverCrew"): string {
  const base = onHull(hull);
  let s: GameState;
  if (f === "refOver" || f === "refOverCrew") {
    // A powered bay drawing the hull's own output plus 10: the reactor covers it, and 10 of its output is spoken for.
    s = withDraw(withCore(base, em4Core("ref")), SHIP_TYPES[hull].basePowerOutput + 10);
    if (f === "refOverCrew") s = seatOfficer(s, "engineering", ["eng.overdrive"]);
  } else s = fit(base, f);
  const st = sheetOf(s);
  return `${st.transitSpeedMult}:${hash(st)}`;
}

// ===== 2. mission =====
export function missionRow(hull: ShipTypeKey, f: Em4Fit, key: MissionKey = "shortOreRun"): string {
  const base = fit(onHull(hull), f);
  const st: GameState = { ...base, credits: new Decimal(1_000_000), captains: base.captains.map((c) => ({ ...c, level: 10 })) };
  const r = dispatchCaptainOnMission(st, 1, key);
  expect(r.success, `${hull} ${key}: ${r.reason}`).toBe(true);
  let s = r.next;
  for (let i = 0; i < 700; i++) s = economyTick(s, 1, RNG);
  return stateHash(s);
}

// ===== 3. shortRange =====
export function shortRangeBase(f: Em4Fit): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  return fit(installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }), f);
}
export function shortRangeRow(f: Em4Fit): string[] {
  const r = dispatchCaptainOnShortRange(shortRangeBase(f), 1, 0);
  expect(r.success, String(r.reason)).toBe(true);
  const m = r.next.captains[0].mission;
  let s = r.next;
  for (let i = 0; i < 900; i++) s = economyTick(s, 1, RNG);
  return [hash(m), stateHash(s)];
}

// ===== 4. voyage =====
export function voyageRow(f: Em4Fit): string[] {
  const res = dispatchPastPropulsion(fit(asExpeditionVeteran(withCrew(onHull("orion"), "d18")), f), EM4_SHIP, 1, "cand-0");
  expect(res.success, `orion: ${res.reason}`).toBe(true);
  const exp = res.expedition!;
  return [hash(exp.voyage), hash(exp)];
}

// ===== 5. stamp =====
export const EM4_COMBAT_HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier", "orion"];
export function stampRow(hull: ShipTypeKey, f: Em4Fit): string {
  const s = fit(onHull(hull), f);
  return hash(shipCombatRulesStamp(s, s.ships[0]));
}

// ===== 6. patrol (Dispatch Once) =====
export const EM4_PATROL_HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier"];
export const EM4_ROUTES = Object.keys(PATROLS) as PatrolKey[];
export function patrolBase(hull: ShipTypeKey, f: Em4Fit): GameState {
  return fit(asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) }), f);
}
const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;
export function patrolRow(hull: ShipTypeKey, key: PatrolKey, f: Em4Fit, dispatch: (s: GameState) => ReturnType<typeof dispatchCaptainOnPatrol> = (s) => dispatchCaptainOnPatrol(s, 1, key, "balanced", false)): string[] {
  const r = dispatch(patrolBase(hull, f));
  expect(r.success, `${hull} ${key}: ${r.reason}`).toBe(true);
  const row = [hash(structuredClone(r.next.captains[0].mission))];
  let s = r.next;
  let ticks = 0;
  while (patrolOf(s) !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, stateHash(s));
  return row;
}

// ===== 7. forecast (App.svelte patrolForecastFor's sweep, mirrored as emodEm3Goldens does) =====
export function forecastRow(hull: ShipTypeKey, key: PatrolKey, f: Em4Fit, samples = DEFAULT_SAMPLES): string {
  const state = patrolBase(hull, f);
  const ship = state.ships[0];
  const hullType = combatHullTypeOf(ship.typeKey)!;
  const def = PATROLS[key];
  const shipDef = SHIP_TYPES[ship.typeKey];
  const installedGear = equippedFor(state, ship.id);
  const startDrones = installedDronesForPatrol(installedGear, `forecast-${key}-p`);
  const combatRules = shipCombatRulesStamp(state, ship);
  const startSystemDurability = defaultSystemDurabilityForHull(hullType, shipDef, installedGear, combatRules);
  const startDefense = foldedPlayerDefense(shipDef, installedGear);
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const result = resolvePatrolWaves({
      playerId: ship.id, stats: shipDef, hullType, stance: "balanced", installedGear, masterSeed: 0x5a4d + i, factionId: def.factionId, def,
      startHull: startDefense.hullMax, startShield: startDefense.shieldMax, startDrones, startSystemDurability,
      difficulty: patrolDifficultyAt(state), combatRules,
    });
    if (!result.defeated) wins += 1;
  }
  return `${wins}:${threatAssessment(wins, samples).tier}`;
}

export function em4Rows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const hull of HULLS) for (const f of [...EM4_FITS, "refOver", "refOverCrew"] as const) got[`sheet:${hull}:${f}`] = sheetRow(hull, f);
  for (const hull of ["generalFreighter", "prospectorRunner"] as ShipTypeKey[]) for (const f of EM4_FITS) got[`mission:${hull}:${f}`] = missionRow(hull, f);
  for (const f of EM4_FITS) got[`shortRange:${f}`] = shortRangeRow(f);
  for (const f of EM4_FITS) got[`voyage:${f}`] = voyageRow(f);
  for (const hull of EM4_COMBAT_HULLS) for (const f of EM4_FITS) got[`stamp:${hull}:${f}`] = stampRow(hull, f);
  for (const hull of EM4_PATROL_HULLS) {
    for (const key of EM4_ROUTES) {
      for (const f of EM4_FITS) {
        got[`patrol:${hull}:${key}:${f}`] = patrolRow(hull, key, f);
        got[`forecast:${hull}:${key}:${f}`] = forecastRow(hull, key, f);
      }
    }
  }
  return got;
}

// Captured on feat e1ee724 before any EM-4 engine edit.
export const EM4_GOLDEN_PRE: Record<string, unknown> = {
  "sheet:generalFreighter:si": "1:cd763a7",
  "sheet:generalFreighter:ref": "0.8064516129032259:35891fc3",
  "sheet:generalFreighter:mid": "0.8928571428571428:4ae38b7e",
  "sheet:generalFreighter:top": "1:3c7ca385",
  "sheet:generalFreighter:refOver": "0.8064516129032259:6c964a0d",
  "sheet:generalFreighter:refOverCrew": "0.8064516129032259:49579287",
  "sheet:prospectorHauler:si": "0.8:af0011b2",
  "sheet:prospectorHauler:ref": "0.6451612903225807:f654e722",
  "sheet:prospectorHauler:mid": "0.7142857142857143:38b3c53",
  "sheet:prospectorHauler:top": "0.8:11de8c6d",
  "sheet:prospectorHauler:refOver": "0.6451612903225807:caf573d4",
  "sheet:prospectorHauler:refOverCrew": "0.6451612903225807:2635b6fa",
  "sheet:prospectorRunner:si": "1.5:3339682c",
  "sheet:prospectorRunner:ref": "1.2096774193548387:a4702c36",
  "sheet:prospectorRunner:mid": "1.3392857142857142:d2596d7b",
  "sheet:prospectorRunner:top": "1.5:78a4b631",
  "sheet:prospectorRunner:refOver": "1.2096774193548387:1c246cc4",
  "sheet:prospectorRunner:refOverCrew": "1.2096774193548387:341779b3",
  "sheet:prospectorMiner:si": "1:7ef59c4e",
  "sheet:prospectorMiner:ref": "0.8064516129032259:cd77f139",
  "sheet:prospectorMiner:mid": "0.8928571428571428:603924d4",
  "sheet:prospectorMiner:top": "1:d249095e",
  "sheet:prospectorMiner:refOver": "0.8064516129032259:6d1cb2cd",
  "sheet:prospectorMiner:refOverCrew": "0.8064516129032259:b33869ca",
  "sheet:destroyer:si": "1.3:475c0565",
  "sheet:destroyer:ref": "1.0483870967741937:5b9dacf1",
  "sheet:destroyer:mid": "1.1607142857142856:7f459392",
  "sheet:destroyer:top": "1.3:562e345f",
  "sheet:destroyer:refOver": "1.0483870967741937:77e15b21",
  "sheet:destroyer:refOverCrew": "1.0483870967741937:9e5a01e8",
  "sheet:battleship:si": "0.7:3293481",
  "sheet:battleship:ref": "0.5645161290322581:8cfa2d18",
  "sheet:battleship:mid": "0.6249999999999999:d8f68769",
  "sheet:battleship:top": "0.7:a495a909",
  "sheet:battleship:refOver": "0.5645161290322581:96de0716",
  "sheet:battleship:refOverCrew": "0.5645161290322581:270f3a06",
  "sheet:carrier:si": "0.8:848d561f",
  "sheet:carrier:ref": "0.6451612903225807:a4f0c904",
  "sheet:carrier:mid": "0.7142857142857143:5568abd3",
  "sheet:carrier:top": "0.8:7d5e2dc7",
  "sheet:carrier:refOver": "0.6451612903225807:60cfb03b",
  "sheet:carrier:refOverCrew": "0.6451612903225807:4b0e5273",
  "sheet:orion:si": "1.1:8870cb16",
  "sheet:orion:ref": "0.8870967741935485:ceae2b65",
  "sheet:orion:mid": "0.9821428571428572:4dc4b4b9",
  "sheet:orion:top": "1.1:9118ffc3",
  "sheet:orion:refOver": "0.8870967741935485:eb0b6664",
  "sheet:orion:refOverCrew": "0.8870967741935485:9389f1b7",
  "sheet:aurora:si": "1.3:4e326d65",
  "sheet:aurora:ref": "1.0483870967741937:fe8844c8",
  "sheet:aurora:mid": "1.1607142857142856:51d06b1a",
  "sheet:aurora:top": "1.3:6a77ccf",
  "sheet:aurora:refOver": "1.0483870967741937:a708751f",
  "sheet:aurora:refOverCrew": "1.0483870967741937:ac0a32a9",
  "sheet:eir:si": "0.9:ade58abc",
  "sheet:eir:ref": "0.7258064516129032:6423422d",
  "sheet:eir:mid": "0.8035714285714285:e07f1426",
  "sheet:eir:top": "0.9:321e70b2",
  "sheet:eir:refOver": "0.7258064516129032:b94c26c9",
  "sheet:eir:refOverCrew": "0.7258064516129032:fb10ff7a",
  "mission:generalFreighter:si": "1014cf2d",
  "mission:generalFreighter:ref": "a36139c0",
  "mission:generalFreighter:mid": "9c1c2e34",
  "mission:generalFreighter:top": "ae4d1fc0",
  "mission:prospectorRunner:si": "b170600c",
  "mission:prospectorRunner:ref": "aae848c1",
  "mission:prospectorRunner:mid": "5eec48db",
  "mission:prospectorRunner:top": "37d47abd",
  "shortRange:si": ["ece9d2a1", "8a69ef05"],
  "shortRange:ref": ["2ffab3be", "2f299115"],
  "shortRange:mid": ["776fe310", "4005a772"],
  "shortRange:top": ["ece9d2a1", "4d23fff4"],
  "voyage:si": ["9b7820ac", "e32d11be"],
  "voyage:ref": ["850996d2", "303aaca3"],
  "voyage:mid": ["5e4c59d5", "7a111711"],
  "voyage:top": ["9b7820ac", "8e357548"],
  "stamp:generalFreighter:si": "f61e5bbf",
  "stamp:generalFreighter:ref": "63fd6770",
  "stamp:generalFreighter:mid": "63f518ab",
  "stamp:generalFreighter:top": "43c9cf1f",
  "stamp:destroyer:si": "f61e5bbf",
  "stamp:destroyer:ref": "63fd6770",
  "stamp:destroyer:mid": "63f518ab",
  "stamp:destroyer:top": "43c9cf1f",
  "stamp:battleship:si": "f61e5bbf",
  "stamp:battleship:ref": "63fd6770",
  "stamp:battleship:mid": "63f518ab",
  "stamp:battleship:top": "43c9cf1f",
  "stamp:carrier:si": "f61e5bbf",
  "stamp:carrier:ref": "63fd6770",
  "stamp:carrier:mid": "63f518ab",
  "stamp:carrier:top": "43c9cf1f",
  "stamp:orion:si": "f61e5bbf",
  "stamp:orion:ref": "63fd6770",
  "stamp:orion:mid": "63f518ab",
  "stamp:orion:top": "43c9cf1f",
  "patrol:generalFreighter:crimsonReaverSweep:si": ["e38d27d1", "won:14", "619f0aa1"],
  "forecast:generalFreighter:crimsonReaverSweep:si": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:ref": ["e2f69262", "won:14", "cbd4f3c"],
  "forecast:generalFreighter:crimsonReaverSweep:ref": "56:likely",
  "patrol:generalFreighter:crimsonReaverSweep:mid": ["76b0e949", "won:14", "d85398bc"],
  "forecast:generalFreighter:crimsonReaverSweep:mid": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:top": ["3191c7a8", "won:14", "f7ee8c92"],
  "forecast:generalFreighter:crimsonReaverSweep:top": "57:likely",
  "patrol:generalFreighter:crimsonReaverWarband:si": ["8170ae77", "lost:20", "beaf4ad4"],
  "forecast:generalFreighter:crimsonReaverWarband:si": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:ref": ["c4ebdc0", "lost:20", "6c193791"],
  "forecast:generalFreighter:crimsonReaverWarband:ref": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:mid": ["e602841f", "lost:20", "95c71651"],
  "forecast:generalFreighter:crimsonReaverWarband:mid": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:top": ["7864a98a", "lost:20", "a747f26b"],
  "forecast:generalFreighter:crimsonReaverWarband:top": "0:impossible",
  "patrol:destroyer:crimsonReaverSweep:si": ["31e77619", "won:14", "d4055219"],
  "forecast:destroyer:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:ref": ["58b8cea2", "won:14", "fce015ca"],
  "forecast:destroyer:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:mid": ["ae180091", "won:14", "f78c1106"],
  "forecast:destroyer:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:top": ["210698f0", "won:14", "a349d44c"],
  "forecast:destroyer:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband:si": ["d309e353", "won:22", "94a165d6"],
  "forecast:destroyer:crimsonReaverWarband:si": "9:extreme",
  "patrol:destroyer:crimsonReaverWarband:ref": ["512f686c", "won:22", "6808cc91"],
  "forecast:destroyer:crimsonReaverWarband:ref": "3:extreme",
  "patrol:destroyer:crimsonReaverWarband:mid": ["ec2c697b", "won:22", "766d5185"],
  "forecast:destroyer:crimsonReaverWarband:mid": "4:extreme",
  "patrol:destroyer:crimsonReaverWarband:top": ["2dc14c76", "won:22", "362be6c3"],
  "forecast:destroyer:crimsonReaverWarband:top": "9:extreme",
  "patrol:battleship:crimsonReaverSweep:si": ["8117c7c7", "won:14", "6a6e81a4"],
  "forecast:battleship:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:ref": ["285b5c6a", "won:14", "dc5d2eab"],
  "forecast:battleship:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:mid": ["5ab6ec0f", "won:14", "da3ea30b"],
  "forecast:battleship:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:top": ["dc57965a", "won:14", "3b342d81"],
  "forecast:battleship:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband:si": ["5ef43211", "won:22", "394499f3"],
  "forecast:battleship:crimsonReaverWarband:si": "52:likely",
  "patrol:battleship:crimsonReaverWarband:ref": ["deb8f24c", "won:22", "b1bd54a8"],
  "forecast:battleship:crimsonReaverWarband:ref": "49:worthy",
  "patrol:battleship:crimsonReaverWarband:mid": ["23f59b89", "won:22", "dca35a28"],
  "forecast:battleship:crimsonReaverWarband:mid": "48:worthy",
  "patrol:battleship:crimsonReaverWarband:top": ["3eff4e28", "won:22", "e2a4f0a6"],
  "forecast:battleship:crimsonReaverWarband:top": "52:likely",
  "patrol:carrier:crimsonReaverSweep:si": ["10bbdaa4", "won:14", "9554bb6e"],
  "forecast:carrier:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:ref": ["57bfeeab", "won:14", "d79e4b99"],
  "forecast:carrier:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:mid": ["7562f7bc", "won:14", "929cbb6d"],
  "forecast:carrier:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:top": ["672890fd", "won:14", "3e24f63b"],
  "forecast:carrier:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband:si": ["cf2ed6fa", "won:22", "15006abb"],
  "forecast:carrier:crimsonReaverWarband:si": "23:notAdvised",
  "patrol:carrier:crimsonReaverWarband:ref": ["57c94b89", "lost:20", "2e17fc99"],
  "forecast:carrier:crimsonReaverWarband:ref": "3:extreme",
  "patrol:carrier:crimsonReaverWarband:mid": ["e3ffbb22", "lost:20", "e9f04959"],
  "forecast:carrier:crimsonReaverWarband:mid": "2:extreme",
  "patrol:carrier:crimsonReaverWarband:top": ["d50539e7", "won:22", "62408c4a"],
  "forecast:carrier:crimsonReaverWarband:top": "25:notAdvised",
};

describe("E-MOD EM-4 goldens (captured before the engine)", () => {
  it("every row reproduces its pre-EM-4 capture", () => {
    const got = em4Rows();
    expect(got).toEqual(EM4_GOLDEN_PRE);
  });
});
