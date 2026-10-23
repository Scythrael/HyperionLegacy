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
import { withReactorLiftOff } from "./emodEm4Switch.fixture";
import { advanceExpedition } from "./expedition";
// The pins are about speed, not gear wear: use wear stays off so a later wear tune never moves them.
gearWearOffInThisFile();

const RNG = (): number => 0.5;
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
export type Em4Loadout = "si" | Em4CoreName;
export const EM4_LOADOUTS: readonly Em4Loadout[] = ["si", ...EM4_CORES];
const equip = (s: GameState, f: Em4Loadout): GameState => (f === "si" ? s : withCore(s, em4Core(f)));
const sheetOf = (s: GameState) => effectiveShipStats(s, s.ships.find((sh) => sh.id === EM4_SHIP)!);

// ===== 1. sheet =====
export function sheetRow(hull: ShipTypeKey, f: Em4Loadout | "refOver" | "refOverCrew"): string {
  const base = onHull(hull);
  let s: GameState;
  if (f === "refOver" || f === "refOverCrew") {
    // A powered bay drawing the hull's own output plus 10: the reactor covers it, and 10 of its output is spoken for.
    s = withDraw(withCore(base, em4Core("ref")), SHIP_TYPES[hull].basePowerOutput + 10);
    if (f === "refOverCrew") s = seatOfficer(s, "engineering", ["eng.overdrive"]);
  } else s = equip(base, f);
  const st = sheetOf(s);
  return `${st.transitSpeedMult}:${hash(st)}`;
}

// ===== 2. mission =====
type DispatchWith = <T>(f: () => T) => T;
const asIs: DispatchWith = (f) => f();
export function missionRow(hull: ShipTypeKey, f: Em4Loadout, key: MissionKey = "shortOreRun", dispatchWith: DispatchWith = asIs): string {
  const base = equip(onHull(hull), f);
  const st: GameState = { ...base, credits: new Decimal(1_000_000), captains: base.captains.map((c) => ({ ...c, level: 10 })) };
  const r = dispatchWith(() => dispatchCaptainOnMission(st, 1, key));
  expect(r.success, `${hull} ${key}: ${r.reason}`).toBe(true);
  let s = r.next;
  for (let i = 0; i < 700; i++) s = economyTick(s, 1, RNG);
  return stateHash(s);
}

// ===== 3. shortRange =====
export function shortRangeBase(f: Em4Loadout): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  return equip(installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }), f);
}
export function shortRangeRow(f: Em4Loadout, dispatchWith: DispatchWith = asIs): string[] {
  const r = dispatchWith(() => dispatchCaptainOnShortRange(shortRangeBase(f), 1, 0));
  expect(r.success, String(r.reason)).toBe(true);
  const m = r.next.captains[0].mission;
  let s = r.next;
  for (let i = 0; i < 900; i++) s = economyTick(s, 1, RNG);
  return [hash(m), stateHash(s)];
}

// ===== 4. voyage =====
export function voyageRow(f: Em4Loadout): string[] {
  const res = dispatchPastPropulsion(equip(asExpeditionVeteran(withCrew(onHull("orion"), "d18")), f), EM4_SHIP, 1, "cand-0");
  expect(res.success, `orion: ${res.reason}`).toBe(true);
  const exp = res.expedition!;
  return [hash(exp.voyage), hash(exp)];
}

// ===== 5. stamp =====
export const EM4_COMBAT_HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier", "orion"];
export function stampRow(hull: ShipTypeKey, f: Em4Loadout): string {
  const s = equip(onHull(hull), f);
  return hash(shipCombatRulesStamp(s, s.ships[0]));
}

// ===== 6. patrol (Dispatch Once) =====
export const EM4_PATROL_HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier"];
export const EM4_ROUTES = Object.keys(PATROLS) as PatrolKey[];
export function patrolBase(hull: ShipTypeKey, f: Em4Loadout): GameState {
  return equip(asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) }), f);
}
const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;
export function patrolRow(hull: ShipTypeKey, key: PatrolKey, f: Em4Loadout, dispatch: (s: GameState) => ReturnType<typeof dispatchCaptainOnPatrol> = (s) => dispatchCaptainOnPatrol(s, 1, key, "balanced", false)): string[] {
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
export function forecastRow(hull: ShipTypeKey, key: PatrolKey, f: Em4Loadout, samples = DEFAULT_SAMPLES): string {
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
  for (const hull of HULLS) for (const f of [...EM4_LOADOUTS, "refOver", "refOverCrew"] as const) got[`sheet:${hull}:${f}`] = sheetRow(hull, f);
  for (const hull of ["generalFreighter", "prospectorRunner"] as ShipTypeKey[]) for (const f of EM4_LOADOUTS) got[`mission:${hull}:${f}`] = missionRow(hull, f);
  for (const f of EM4_LOADOUTS) got[`shortRange:${f}`] = shortRangeRow(f);
  for (const f of EM4_LOADOUTS) got[`voyage:${f}`] = voyageRow(f);
  for (const hull of EM4_COMBAT_HULLS) for (const f of EM4_LOADOUTS) got[`stamp:${hull}:${f}`] = stampRow(hull, f);
  for (const hull of EM4_PATROL_HULLS) {
    for (const key of EM4_ROUTES) {
      for (const f of EM4_LOADOUTS) {
        got[`patrol:${hull}:${key}:${f}`] = patrolRow(hull, key, f);
        got[`forecast:${hull}:${key}:${f}`] = forecastRow(hull, key, f);
      }
    }
  }
  return got;
}

// Captured on feat e1ee724 before any EM-4 engine edit (65e9cf3).
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

// EM-4 (the engine commit): the live game. Every Standard-Issue row held; every crafted-core row moved by design (the
// reactor's unused power lifts the transit speed): the sheets, the Short Ore Runs and the short-range run (shorter
// legs), the voyage (faster legs), the combat stamp's speed and with it every patrol record and fight, and the
// forecasts. Sheet speed (pre / live, x the hull's base): ref 0.81 / 1.05, mid 0.89 / 1.06, top (mass 0) 1.00 / 2.01;
// refOver 0.81 / 0.97 (10 of the reactor's 23 spoken for), refOverCrew up to 1.05 (Reactor Overdrive frees them).
// Patrols: the Carrier Warband with the ref and mid cores is now won (was lost at tick 20). Forecast wins of 64 (pre /
// live): Carrier Warband ref 3 / 28, mid 2 / 26, top 25 / 33 (Standard Issue 23); Battleship Warband ref 49 / 53, mid
// 48 / 54, top 52 / 53 (52); Destroyer Warband ref 3 / 6, mid 4 / 8 (9: a combat speed of 31 against the pirates' 30
// does not beat 30 there); Freighter Sweep ref 56 / 57, mid 57 / 59, top 57 / 60 (57). Every other forecast held.
export const EM4_GOLDEN: Record<string, unknown> = {
  "sheet:generalFreighter:si": "1:cd763a7",
  "sheet:generalFreighter:ref": "1.0488830813812633:234df75d",
  "sheet:generalFreighter:mid": "1.0586249608222205:a4f014b",
  "sheet:generalFreighter:top": "2.008853123851667:638d3221",
  "sheet:generalFreighter:refOver": "0.9656618154372791:b3e83882",
  "sheet:generalFreighter:refOverCrew": "1.0257539960080273:5557b9c7",
  "sheet:prospectorHauler:si": "0.8:af0011b2",
  "sheet:prospectorHauler:ref": "0.8391064651050106:c9743f44",
  "sheet:prospectorHauler:mid": "0.8468999686577764:eecd9fd7",
  "sheet:prospectorHauler:top": "1.6070824990813337:4817d8ca",
  "sheet:prospectorHauler:refOver": "0.7725294523498234:da332747",
  "sheet:prospectorHauler:refOverCrew": "0.8206031968064218:313db3e9",
  "sheet:prospectorRunner:si": "1.5:3339682c",
  "sheet:prospectorRunner:ref": "1.5733246220718948:ef9318c6",
  "sheet:prospectorRunner:mid": "1.5879374412333307:f2c75957",
  "sheet:prospectorRunner:top": "3.0132796857775004:aaa67dd9",
  "sheet:prospectorRunner:refOver": "1.4484927231559186:57f42049",
  "sheet:prospectorRunner:refOverCrew": "1.5017853546712097:76280d4",
  "sheet:prospectorMiner:si": "1:7ef59c4e",
  "sheet:prospectorMiner:ref": "1.0488830813812633:13212ad3",
  "sheet:prospectorMiner:mid": "1.0586249608222205:63bdea8d",
  "sheet:prospectorMiner:top": "2.008853123851667:4ba94e9a",
  "sheet:prospectorMiner:refOver": "0.9656618154372791:3cbd5794",
  "sheet:prospectorMiner:refOverCrew": "1.0011902364474732:f3971cb5",
  "sheet:destroyer:si": "1.3:475c0565",
  "sheet:destroyer:ref": "1.3635480057956424:c89b16b9",
  "sheet:destroyer:mid": "1.3762124490688865:45629be8",
  "sheet:destroyer:top": "2.611509061007167:cf81b49d",
  "sheet:destroyer:refOver": "1.255360360068463:a163a1f5",
  "sheet:destroyer:refOverCrew": "1.3635480057956424:e9f11c70",
  "sheet:battleship:si": "0.7:3293481",
  "sheet:battleship:ref": "0.7342181569668843:ec53f235",
  "sheet:battleship:mid": "0.7410374725755542:d368dbe4",
  "sheet:battleship:top": "1.4061971866961667:1e8d5554",
  "sheet:battleship:refOver": "0.6759632708060954:7d472a19",
  "sheet:battleship:refOverCrew": "0.7342181569668843:5053511f",
  "sheet:carrier:si": "0.8:848d561f",
  "sheet:carrier:ref": "0.8391064651050106:8bec4e26",
  "sheet:carrier:mid": "0.8468999686577764:58762493",
  "sheet:carrier:top": "1.6070824990813337:42811eb0",
  "sheet:carrier:refOver": "0.7725294523498234:9ba547e8",
  "sheet:carrier:refOverCrew": "0.8330540656125027:84be80fd",
  "sheet:orion:si": "1.1:8870cb16",
  "sheet:orion:ref": "1.1537713895193895:dc247319",
  "sheet:orion:mid": "1.1644874569044426:a2bdcebd",
  "sheet:orion:top": "2.209738436236834:619ed495",
  "sheet:orion:refOver": "1.0622279969810071:48b9f07",
  "sheet:orion:refOverCrew": "1.1537713895193895:4b29632b",
  "sheet:aurora:si": "1.3:4e326d65",
  "sheet:aurora:ref": "1.3635480057956424:53146030",
  "sheet:aurora:mid": "1.3762124490688865:1328b56c",
  "sheet:aurora:top": "2.611509061007167:f1ffb4a1",
  "sheet:aurora:refOver": "1.255360360068463:b98820ab",
  "sheet:aurora:refOverCrew": "1.3635480057956424:7f7ffda1",
  "sheet:eir:si": "0.9:ade58abc",
  "sheet:eir:ref": "0.9439947732431369:609d00bf",
  "sheet:eir:mid": "0.9527624647399984:fb2e50a",
  "sheet:eir:top": "1.8079678114665003:66b3e057",
  "sheet:eir:refOver": "0.8690956338935512:e94dbf4",
  "sheet:eir:refOverCrew": "0.9439947732431369:af5d3b0",
  "mission:generalFreighter:si": "1014cf2d",
  "mission:generalFreighter:ref": "7b5510d4",
  "mission:generalFreighter:mid": "4ae4f0b8",
  "mission:generalFreighter:top": "168a14e0",
  "mission:prospectorRunner:si": "b170600c",
  "mission:prospectorRunner:ref": "4398764f",
  "mission:prospectorRunner:mid": "23c11173",
  "mission:prospectorRunner:top": "7a05f9d0",
  "shortRange:si": ["ece9d2a1", "8a69ef05"],
  "shortRange:ref": ["3408ff0b", "9daef481"],
  "shortRange:mid": ["3408ff0b", "91c9e112"],
  "shortRange:top": ["f26e0cd6", "fef5d3e6"],
  "voyage:si": ["9b7820ac", "e32d11be"],
  "voyage:ref": ["616d3378", "77368147"],
  "voyage:mid": ["b6a94d35", "5361e40f"],
  "voyage:top": ["c27145da", "1b6c2ca5"],
  "stamp:generalFreighter:si": "f61e5bbf",
  "stamp:generalFreighter:ref": "fa20a0a2",
  "stamp:generalFreighter:mid": "fa22df39",
  "stamp:generalFreighter:top": "39c52f0a",
  "stamp:destroyer:si": "f61e5bbf",
  "stamp:destroyer:ref": "fa20a0a2",
  "stamp:destroyer:mid": "fa22df39",
  "stamp:destroyer:top": "39c52f0a",
  "stamp:battleship:si": "f61e5bbf",
  "stamp:battleship:ref": "fa20a0a2",
  "stamp:battleship:mid": "fa22df39",
  "stamp:battleship:top": "39c52f0a",
  "stamp:carrier:si": "f61e5bbf",
  "stamp:carrier:ref": "fa20a0a2",
  "stamp:carrier:mid": "fa22df39",
  "stamp:carrier:top": "39c52f0a",
  "stamp:orion:si": "f61e5bbf",
  "stamp:orion:ref": "fa20a0a2",
  "stamp:orion:mid": "fa22df39",
  "stamp:orion:top": "39c52f0a",
  "patrol:generalFreighter:crimsonReaverSweep:si": ["e38d27d1", "won:14", "619f0aa1"],
  "forecast:generalFreighter:crimsonReaverSweep:si": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:ref": ["794b7bc", "won:14", "cbd4f3c"],
  "forecast:generalFreighter:crimsonReaverSweep:ref": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:mid": ["ee6866af", "won:14", "d85398bc"],
  "forecast:generalFreighter:crimsonReaverSweep:mid": "59:likely",
  "patrol:generalFreighter:crimsonReaverSweep:top": ["60f968fd", "won:14", "f7ee8c92"],
  "forecast:generalFreighter:crimsonReaverSweep:top": "60:likely",
  "patrol:generalFreighter:crimsonReaverWarband:si": ["8170ae77", "lost:20", "beaf4ad4"],
  "forecast:generalFreighter:crimsonReaverWarband:si": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:ref": ["b68f2fba", "lost:20", "6c193791"],
  "forecast:generalFreighter:crimsonReaverWarband:ref": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:mid": ["b4b73655", "lost:20", "95c71651"],
  "forecast:generalFreighter:crimsonReaverWarband:mid": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:top": ["a5d8659f", "lost:20", "a747f26b"],
  "forecast:generalFreighter:crimsonReaverWarband:top": "0:impossible",
  "patrol:destroyer:crimsonReaverSweep:si": ["31e77619", "won:14", "d4055219"],
  "forecast:destroyer:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:ref": ["1cfe9fd8", "won:14", "fce015ca"],
  "forecast:destroyer:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:mid": ["2c0d7b8b", "won:14", "f78c1106"],
  "forecast:destroyer:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:top": ["1aa9289", "won:14", "a349d44c"],
  "forecast:destroyer:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband:si": ["d309e353", "won:22", "94a165d6"],
  "forecast:destroyer:crimsonReaverWarband:si": "9:extreme",
  "patrol:destroyer:crimsonReaverWarband:ref": ["99e890fa", "won:22", "6808cc91"],
  "forecast:destroyer:crimsonReaverWarband:ref": "6:extreme",
  "patrol:destroyer:crimsonReaverWarband:mid": ["101fc17d", "won:22", "766d5185"],
  "forecast:destroyer:crimsonReaverWarband:mid": "8:extreme",
  "patrol:destroyer:crimsonReaverWarband:top": ["57bf495f", "won:22", "362be6c3"],
  "forecast:destroyer:crimsonReaverWarband:top": "9:extreme",
  "patrol:battleship:crimsonReaverSweep:si": ["8117c7c7", "won:14", "6a6e81a4"],
  "forecast:battleship:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:ref": ["377d0428", "won:14", "dc5d2eab"],
  "forecast:battleship:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:mid": ["403e4559", "won:14", "da3ea30b"],
  "forecast:battleship:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:top": ["c4d6c49", "won:14", "3b342d81"],
  "forecast:battleship:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband:si": ["5ef43211", "won:22", "394499f3"],
  "forecast:battleship:crimsonReaverWarband:si": "52:likely",
  "patrol:battleship:crimsonReaverWarband:ref": ["53b971b2", "won:22", "b1bd54a8"],
  "forecast:battleship:crimsonReaverWarband:ref": "53:likely",
  "patrol:battleship:crimsonReaverWarband:mid": ["51f78bcb", "won:22", "dca35a28"],
  "forecast:battleship:crimsonReaverWarband:mid": "54:likely",
  "patrol:battleship:crimsonReaverWarband:top": ["381bfe47", "won:22", "e2a4f0a6"],
  "forecast:battleship:crimsonReaverWarband:top": "53:likely",
  "patrol:carrier:crimsonReaverSweep:si": ["10bbdaa4", "won:14", "9554bb6e"],
  "forecast:carrier:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:ref": ["b4eea84d", "won:14", "d79e4b99"],
  "forecast:carrier:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:mid": ["c8eb7112", "won:14", "929cbb6d"],
  "forecast:carrier:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:top": ["600f67c", "won:14", "3e24f63b"],
  "forecast:carrier:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband:si": ["cf2ed6fa", "won:22", "15006abb"],
  "forecast:carrier:crimsonReaverWarband:si": "23:notAdvised",
  "patrol:carrier:crimsonReaverWarband:ref": ["e3f07043", "won:22", "9f5b7c28"],
  "forecast:carrier:crimsonReaverWarband:ref": "28:dice",
  "patrol:carrier:crimsonReaverWarband:mid": ["b4361520", "won:22", "144be9b4"],
  "forecast:carrier:crimsonReaverWarband:mid": "26:dice",
  "patrol:carrier:crimsonReaverWarband:top": ["b7d5099e", "won:22", "62408c4a"],
  "forecast:carrier:crimsonReaverWarband:top": "33:dice",
};

describe("E-MOD EM-4 goldens", () => {
  it("the switch (no lift, no flag) reproduces every pre-EM-4 row", () => {
    expect(withReactorLiftOff(() => em4Rows())).toEqual(EM4_GOLDEN_PRE);
  });

  it("the live game: every Standard-Issue row holds; the crafted-core rows pin the lift", () => {
    const got = em4Rows();
    for (const [k, v] of Object.entries(got)) if (k.endsWith(":si")) expect(v, k).toEqual(EM4_GOLDEN_PRE[k]);
    expect(got).toEqual(EM4_GOLDEN);
  });

  it("in flight: a run dispatched inside the switch (before EM-4) and flown by the live engine is byte-identical", () => {
    for (const hull of ["generalFreighter", "prospectorRunner"] as ShipTypeKey[]) {
      for (const f of EM4_CORES) expect(missionRow(hull, f, "shortOreRun", withReactorLiftOff), `mission ${hull} ${f}`).toBe(EM4_GOLDEN_PRE[`mission:${hull}:${f}`]);
    }
    for (const f of EM4_CORES) expect(shortRangeRow(f, withReactorLiftOff), `shortRange ${f}`).toEqual(EM4_GOLDEN_PRE[`shortRange:${f}`]);
    // A patrol cycle in flight keeps the stamp it started with (Dispatch Once flies one cycle).
    for (const hull of EM4_PATROL_HULLS) {
      for (const key of EM4_ROUTES) {
        for (const f of EM4_CORES) {
          expect(patrolRow(hull, key, f, (s) => withReactorLiftOff(() => dispatchCaptainOnPatrol(s, 1, key, "balanced", false))), `patrol ${hull} ${key} ${f}`).toEqual(EM4_GOLDEN_PRE[`patrol:${hull}:${key}:${f}`]);
        }
      }
    }
    // An expedition flies the voyage and the ship-event stamp it froze at dispatch.
    for (const f of EM4_CORES) {
      const off = withReactorLiftOff(() => dispatchPastPropulsion(equip(asExpeditionVeteran(withCrew(onHull("orion"), "d18")), f), EM4_SHIP, 1, "cand-0"));
      expect(off.success).toBe(true);
      const live = advanceExpedition(off.expedition!, 2_000_000);
      expect(hash(live), `voyage ${f}`).toBe(hash(withReactorLiftOff(() => advanceExpedition(off.expedition!, 2_000_000))));
    }
  });
});
