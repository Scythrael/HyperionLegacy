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

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";
// Complement plan CP-5 (per-hull crew caps): every pin here predates CP-5 and is about another slice, so the file runs
// with the per-hull caps off (hullCrewCapsSwitch.fixture.ts); cp5Goldens.test.ts pins what CP-5 moved.
hullCrewCapsOffForThisFile();
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
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion, withoutRelicStagger } from "./awayTeamTestFixtures";
import { asPreStaggerShortRange } from "./shortRangeRelics.fixture";
import { editShip, installPiece, seatOfficer, wiringBase } from "./wiring/probes";
import { EM4_CORES, EM4_SHIP, em4Core, withCore, withDraw, type Em4CoreName } from "./emodEm4.fixture";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { withReactorLiftOff } from "./emodEm4Switch.fixture";
import { advanceExpedition } from "./expedition";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { wr9OffForThisFile } from "./wr9Switch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";

// Fix round answers Q3 (2026-11-17, "Yes, same every visit": a catalog-named system's bodies are drawn from its
// catalog id, the same every visit) moves this file's pins (the catalog-named systems its runs fly have other bodies).
// They predate it and are about another slice, so the file runs with it off (fixRoundAnswersSwitch.fixture.ts). Q3's
// own pins: expeditionFixRoundE.test.ts.
fixRoundAnswersOffForThisFile("catalogBodies");

homeworldReserveOffForThisFile();

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about E-MOD EM-4;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
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
  // Relics v2 tier stagger (after these pins): the run is read as dispatched before it (its relic flag without
  // `stagger`, asPreStaggerShortRange), which moves no draw; relicStagger.test.ts pins the stamp.
  const pre = asPreStaggerShortRange(r.next);
  const m = pre.captains[0].mission;
  let s = pre;
  for (let i = 0; i < 900; i++) s = economyTick(s, 1, RNG);
  return [hash(m), stateHash(s)];
}

// ===== 4. voyage =====
export function voyageRow(f: Em4Loadout): string[] {
  const res = dispatchPastPropulsion(equip(asExpeditionVeteran(withCrew(onHull("orion"), "d18")), f), EM4_SHIP, 1, "cand-0");
  expect(res.success, `orion: ${res.reason}`).toBe(true);
  // Relics v2 tier stagger: read as dispatched before it (withoutRelicStagger).
  const exp = withoutRelicStagger(res.expedition!);
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
  "sheet:generalFreighter:ref": "0.8064516129032259:38b3a6cb",
  "sheet:generalFreighter:mid": "0.8064516129032259:d0239d76",
  "sheet:generalFreighter:top": "1:75363d7b",
  "sheet:generalFreighter:refOver": "0.8064516129032259:c0c45eb5",
  "sheet:generalFreighter:refOverCrew": "0.8064516129032259:ad6cbd7f",
  "sheet:prospectorHauler:si": "0.8:af0011b2",
  "sheet:prospectorHauler:ref": "0.6451612903225807:9728579b",
  "sheet:prospectorHauler:mid": "0.6451612903225807:2ea1752e",
  "sheet:prospectorHauler:top": "0.8:213378de",
  "sheet:prospectorHauler:refOver": "0.6451612903225807:c4637f1f",
  "sheet:prospectorHauler:refOverCrew": "0.6451612903225807:63a36a81",
  "sheet:prospectorRunner:si": "1.5:3339682c",
  "sheet:prospectorRunner:ref": "1.2096774193548387:90736aa8",
  "sheet:prospectorRunner:mid": "1.2096774193548387:6020248f",
  "sheet:prospectorRunner:top": "1.5:2dd161c8",
  "sheet:prospectorRunner:refOver": "1.2096774193548387:cc5e5eae",
  "sheet:prospectorRunner:refOverCrew": "1.2096774193548387:acce4e0d",
  "sheet:prospectorMiner:si": "1:7ef59c4e",
  "sheet:prospectorMiner:ref": "0.8064516129032259:a8267476",
  "sheet:prospectorMiner:mid": "0.8064516129032259:cc397031",
  "sheet:prospectorMiner:top": "1:cbd96462",
  "sheet:prospectorMiner:refOver": "0.8064516129032259:1a6b1084",
  "sheet:prospectorMiner:refOverCrew": "0.8064516129032259:da246073",
  "sheet:destroyer:si": "1.3:475c0565",
  "sheet:destroyer:ref": "1.0483870967741937:a230b341",
  "sheet:destroyer:mid": "1.0483870967741937:cd78324a",
  "sheet:destroyer:top": "1.3:4c20e43b",
  "sheet:destroyer:refOver": "1.0483870967741937:4b237c71",
  "sheet:destroyer:refOverCrew": "1.0483870967741937:25d2e1f8",
  "sheet:battleship:si": "0.7:3293481",
  "sheet:battleship:ref": "0.5645161290322581:b2eb2e53",
  "sheet:battleship:mid": "0.5645161290322581:ab46da3c",
  "sheet:battleship:top": "0.7:e9cd5184",
  "sheet:battleship:refOver": "0.5645161290322581:89555355",
  "sheet:battleship:refOverCrew": "0.5645161290322581:1e14e419",
  "sheet:carrier:si": "0.8:848d561f",
  "sheet:carrier:ref": "0.6451612903225807:52bd1289",
  "sheet:carrier:mid": "0.6451612903225807:90d6867a",
  "sheet:carrier:top": "0.8:4da2515c",
  "sheet:carrier:refOver": "0.6451612903225807:b7890d12",
  "sheet:carrier:refOverCrew": "0.6451612903225807:bf78225a",
  "sheet:orion:si": "1.1:8870cb16",
  "sheet:orion:ref": "0.8870967741935485:2643d0d1",
  "sheet:orion:mid": "0.8870967741935485:2703aa2",
  "sheet:orion:top": "1.1:c1ffb4c5",
  "sheet:orion:refOver": "0.8870967741935485:53ae9d88",
  "sheet:orion:refOverCrew": "0.8870967741935485:d26086f3",
  "sheet:aurora:si": "1.3:4e326d65",
  "sheet:aurora:ref": "1.0483870967741937:5235ff5d",
  "sheet:aurora:mid": "1.0483870967741937:118a265a",
  "sheet:aurora:top": "1.3:3dc8d1b1",
  "sheet:aurora:refOver": "1.0483870967741937:cb7da6ee",
  "sheet:aurora:refOverCrew": "1.0483870967741937:e390a6f4",
  "sheet:eir:si": "0.9:ade58abc",
  "sheet:eir:ref": "0.7258064516129032:1486b578",
  "sheet:eir:mid": "0.7258064516129032:fdf8017b",
  "sheet:eir:top": "0.9:af02aa01",
  "sheet:eir:refOver": "0.7258064516129032:56527a44",
  "sheet:eir:refOverCrew": "0.7258064516129032:2bb25bf3",
  "mission:generalFreighter:si": "1014cf2d",
  "mission:generalFreighter:ref": "d98232ab",
  "mission:generalFreighter:mid": "2035033b",
  "mission:generalFreighter:top": "59eb5aa9",
  "mission:prospectorRunner:si": "b170600c",
  "mission:prospectorRunner:ref": "c652442",
  "mission:prospectorRunner:mid": "5ef53a62",
  "mission:prospectorRunner:top": "4c06cb7c",
  "shortRange:si": ["ece9d2a1", "8a69ef05"],
  "shortRange:ref": ["2ffab3be", "61c60e6c"],
  "shortRange:mid": ["2ffab3be", "dcbc7532"],
  "shortRange:top": ["ece9d2a1", "860d82cf"],
  "voyage:si": ["9b7820ac", "e32d11be"],
  "voyage:ref": ["850996d2", "303aaca3"],
  "voyage:mid": ["850996d2", "303aaca3"],
  "voyage:top": ["9b7820ac", "8e357548"],
  "stamp:generalFreighter:si": "f61e5bbf",
  "stamp:generalFreighter:ref": "63fd6770",
  "stamp:generalFreighter:mid": "63fd6770",
  "stamp:generalFreighter:top": "43c9cf1f",
  "stamp:destroyer:si": "f61e5bbf",
  "stamp:destroyer:ref": "63fd6770",
  "stamp:destroyer:mid": "63fd6770",
  "stamp:destroyer:top": "43c9cf1f",
  "stamp:battleship:si": "f61e5bbf",
  "stamp:battleship:ref": "63fd6770",
  "stamp:battleship:mid": "63fd6770",
  "stamp:battleship:top": "43c9cf1f",
  "stamp:carrier:si": "f61e5bbf",
  "stamp:carrier:ref": "63fd6770",
  "stamp:carrier:mid": "63fd6770",
  "stamp:carrier:top": "43c9cf1f",
  "stamp:orion:si": "f61e5bbf",
  "stamp:orion:ref": "63fd6770",
  "stamp:orion:mid": "63fd6770",
  "stamp:orion:top": "43c9cf1f",
  "patrol:generalFreighter:crimsonReaverSweep:si": ["e38d27d1", "won:14", "619f0aa1"],
  "forecast:generalFreighter:crimsonReaverSweep:si": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:ref": ["e2f69262", "won:14", "790e2dcd"],
  "forecast:generalFreighter:crimsonReaverSweep:ref": "56:likely",
  "patrol:generalFreighter:crimsonReaverSweep:mid": ["e2f69262", "won:14", "9ee4e17"],
  "forecast:generalFreighter:crimsonReaverSweep:mid": "56:likely",
  "patrol:generalFreighter:crimsonReaverSweep:top": ["3191c7a8", "won:14", "50db0297"],
  "forecast:generalFreighter:crimsonReaverSweep:top": "57:likely",
  "patrol:generalFreighter:crimsonReaverWarband:si": ["8170ae77", "lost:20", "beaf4ad4"],
  "forecast:generalFreighter:crimsonReaverWarband:si": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:ref": ["c4ebdc0", "lost:20", "83731328"],
  "forecast:generalFreighter:crimsonReaverWarband:ref": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:mid": ["c4ebdc0", "lost:20", "414bfa2a"],
  "forecast:generalFreighter:crimsonReaverWarband:mid": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:top": ["7864a98a", "lost:20", "57e04082"],
  "forecast:generalFreighter:crimsonReaverWarband:top": "0:impossible",
  "patrol:destroyer:crimsonReaverSweep:si": ["31e77619", "won:14", "d4055219"],
  "forecast:destroyer:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:ref": ["58b8cea2", "won:14", "1c6e495f"],
  "forecast:destroyer:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:mid": ["58b8cea2", "won:14", "c03d0283"],
  "forecast:destroyer:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:top": ["210698f0", "won:14", "d244c6ef"],
  "forecast:destroyer:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband:si": ["d309e353", "won:22", "94a165d6"],
  "forecast:destroyer:crimsonReaverWarband:si": "9:extreme",
  "patrol:destroyer:crimsonReaverWarband:ref": ["512f686c", "won:22", "102e4844"],
  "forecast:destroyer:crimsonReaverWarband:ref": "3:extreme",
  "patrol:destroyer:crimsonReaverWarband:mid": ["512f686c", "won:22", "f48e8fb4"],
  "forecast:destroyer:crimsonReaverWarband:mid": "3:extreme",
  "patrol:destroyer:crimsonReaverWarband:top": ["2dc14c76", "won:22", "1e082160"],
  "forecast:destroyer:crimsonReaverWarband:top": "9:extreme",
  "patrol:battleship:crimsonReaverSweep:si": ["8117c7c7", "won:14", "6a6e81a4"],
  "forecast:battleship:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:ref": ["285b5c6a", "won:14", "21edc0fc"],
  "forecast:battleship:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:mid": ["285b5c6a", "won:14", "c787333e"],
  "forecast:battleship:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:top": ["dc57965a", "won:14", "967b9d3e"],
  "forecast:battleship:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband:si": ["5ef43211", "won:22", "394499f3"],
  "forecast:battleship:crimsonReaverWarband:si": "52:likely",
  "patrol:battleship:crimsonReaverWarband:ref": ["deb8f24c", "won:22", "99cca3a3"],
  "forecast:battleship:crimsonReaverWarband:ref": "49:worthy",
  "patrol:battleship:crimsonReaverWarband:mid": ["deb8f24c", "won:22", "e47a2f51"],
  "forecast:battleship:crimsonReaverWarband:mid": "49:worthy",
  "patrol:battleship:crimsonReaverWarband:top": ["3eff4e28", "won:22", "84039ae9"],
  "forecast:battleship:crimsonReaverWarband:top": "52:likely",
  "patrol:carrier:crimsonReaverSweep:si": ["10bbdaa4", "won:14", "9554bb6e"],
  "forecast:carrier:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:ref": ["57bfeeab", "won:14", "bb2af598"],
  "forecast:carrier:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:mid": ["57bfeeab", "won:14", "5d8786e8"],
  "forecast:carrier:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:top": ["672890fd", "won:14", "c95d52c4"],
  "forecast:carrier:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband:si": ["cf2ed6fa", "won:22", "15006abb"],
  "forecast:carrier:crimsonReaverWarband:si": "23:notAdvised",
  "patrol:carrier:crimsonReaverWarband:ref": ["57c94b89", "lost:20", "857b24d2"],
  "forecast:carrier:crimsonReaverWarband:ref": "3:extreme",
  "patrol:carrier:crimsonReaverWarband:mid": ["57c94b89", "lost:20", "4fb7bcc8"],
  "forecast:carrier:crimsonReaverWarband:mid": "3:extreme",
  "patrol:carrier:crimsonReaverWarband:top": ["d50539e7", "won:22", "488e8c89"],
  "forecast:carrier:crimsonReaverWarband:top": "25:notAdvised",
};

// EM-4 (the engine commit, re-pinned by the user answers of 2026-10-23 "Never slower" and "Soften the top"): the live
// game. Every Standard-Issue row held; every crafted-core row moved by design: the sheets, the Short Ore Runs and the
// short-range run, the voyage, the combat stamp's speed and with it every patrol record, and the forecasts. Sheet speed
// (pre / live, x the hull's base): ref 0.81 / 1.00 and mid 0.89 / 1.00 (their lift is below their own mass drag, so
// they fly exactly at the Standard-Issue speed), top (mass 0) 1.00 / 1.35; refOver and refOverCrew 0.81 / 1.00.
// Patrols: the Carrier Warband with the ref and mid cores is now won as with Standard Issue (was lost at tick 20).
// Forecast wins of 64 (pre / live, Standard Issue in brackets): Carrier Warband ref 3 / 23, mid 2 / 23, top 25 / 29
// (23); Battleship Warband ref 49 / 52, mid 48 / 52, top 52 / 55 (52); Destroyer Warband ref 3 / 9, mid 4 / 9, top
// 9 / 7 (9: above the pirates' speed 30 the wins plateau, 64-sample noise); Freighter Sweep ref 56 / 57, top 57 / 60
// (57). Every other forecast held.
export const EM4_GOLDEN: Record<string, unknown> = {
  "sheet:generalFreighter:si": "1:cd763a7",
  "sheet:generalFreighter:ref": "1:1f2c52bf",
  "sheet:generalFreighter:mid": "1:6c3a524a",
  "sheet:generalFreighter:top": "1.3530985933480835:754f986f",
  "sheet:generalFreighter:refOver": "1:415f339",
  "sheet:generalFreighter:refOverCrew": "1:cf5bc0fb",
  "sheet:prospectorHauler:si": "0.8:af0011b2",
  "sheet:prospectorHauler:ref": "0.8:2f644a18",
  "sheet:prospectorHauler:mid": "0.8:a4db7251",
  "sheet:prospectorHauler:top": "1.0824788746784668:d8859844",
  "sheet:prospectorHauler:refOver": "0.8:4c8946c6",
  "sheet:prospectorHauler:refOverCrew": "0.8:c3389e9c",
  "sheet:prospectorRunner:si": "1.5:3339682c",
  "sheet:prospectorRunner:ref": "1.5:a27f4ae4",
  "sheet:prospectorRunner:mid": "1.5:6f80fa7b",
  "sheet:prospectorRunner:top": "2.029647890022125:994357f1",
  "sheet:prospectorRunner:refOver": "1.5:7cd37f4a",
  "sheet:prospectorRunner:refOverCrew": "1.5:f3f5dfe1",
  "sheet:prospectorMiner:si": "1:7ef59c4e",
  "sheet:prospectorMiner:ref": "1:15a3d0a",
  "sheet:prospectorMiner:mid": "1:4b1127f5",
  "sheet:prospectorMiner:top": "1.3530985933480835:cb33b04e",
  "sheet:prospectorMiner:refOver": "1:eeba14b8",
  "sheet:prospectorMiner:refOverCrew": "1:e0b5aa3f",
  "sheet:destroyer:si": "1.3:475c0565",
  "sheet:destroyer:ref": "1.3:84aa93bf",
  "sheet:destroyer:mid": "1.3:63dd7eec",
  "sheet:destroyer:top": "1.7590281713525087:a3fb8ac6",
  "sheet:destroyer:refOver": "1.3:fbd4dfa3",
  "sheet:destroyer:refOverCrew": "1.3:403b2562",
  "sheet:battleship:si": "0.7:3293481",
  "sheet:battleship:ref": "0.7:dc1c75fa",
  "sheet:battleship:mid": "0.7:7e680dc1",
  "sheet:battleship:top": "0.9471690153436584:5249e25e",
  "sheet:battleship:refOver": "0.7:6e3073ac",
  "sheet:battleship:refOverCrew": "0.7:9a91363c",
  "sheet:carrier:si": "0.8:848d561f",
  "sheet:carrier:ref": "0.8:69ac678c",
  "sheet:carrier:mid": "0.8:fe20004b",
  "sheet:carrier:top": "1.0824788746784668:953b3ee2",
  "sheet:carrier:refOver": "0.8:ab04e283",
  "sheet:carrier:refOverCrew": "0.8:7975a69b",
  "sheet:orion:si": "1.1:8870cb16",
  "sheet:orion:ref": "1.1:6596eb54",
  "sheet:orion:mid": "1.1:14a9d873",
  "sheet:orion:top": "1.488408452682892:872b5348",
  "sheet:orion:refOver": "1.1:ab6fecd5",
  "sheet:orion:refOverCrew": "1.1:666cca8a",
  "sheet:aurora:si": "1.3:4e326d65",
  "sheet:aurora:ref": "1.3:c84ba217",
  "sheet:aurora:mid": "1.3:14e02600",
  "sheet:aurora:top": "1.7590281713525087:c8f9c3e0",
  "sheet:aurora:refOver": "1.3:81e29dd4",
  "sheet:aurora:refOverCrew": "1.3:4a49d3fe",
  "sheet:eir:si": "0.9:ade58abc",
  "sheet:eir:ref": "0.9:8ac216c2",
  "sheet:eir:mid": "0.9:cb1ec009",
  "sheet:eir:top": "1.2177887340132751:3e42da57",
  "sheet:eir:refOver": "0.9:61639bea",
  "sheet:eir:refOverCrew": "0.9:f2a0bc79",
  "mission:generalFreighter:si": "1014cf2d",
  "mission:generalFreighter:ref": "256d1e23",
  "mission:generalFreighter:mid": "25c60383",
  "mission:generalFreighter:top": "fb585400",
  "mission:prospectorRunner:si": "b170600c",
  "mission:prospectorRunner:ref": "d0813642",
  "mission:prospectorRunner:mid": "88bc2062",
  "mission:prospectorRunner:top": "eac31b50",
  "shortRange:si": ["ece9d2a1", "8a69ef05"],
  "shortRange:ref": ["4c33546f", "e17b2337"],
  "shortRange:mid": ["4c33546f", "c5a7266d"],
  "shortRange:top": ["58175eed", "ea01b180"],
  "voyage:si": ["9b7820ac", "e32d11be"],
  "voyage:ref": ["9b7820ac", "e32d11be"],
  "voyage:mid": ["9b7820ac", "e32d11be"],
  "voyage:top": ["e6e5a985", "fb1ce9af"],
  "stamp:generalFreighter:si": "f61e5bbf",
  "stamp:generalFreighter:ref": "f61e5bbf",
  "stamp:generalFreighter:mid": "f61e5bbf",
  "stamp:generalFreighter:top": "a49950c3",
  "stamp:destroyer:si": "f61e5bbf",
  "stamp:destroyer:ref": "f61e5bbf",
  "stamp:destroyer:mid": "f61e5bbf",
  "stamp:destroyer:top": "a49950c3",
  "stamp:battleship:si": "f61e5bbf",
  "stamp:battleship:ref": "f61e5bbf",
  "stamp:battleship:mid": "f61e5bbf",
  "stamp:battleship:top": "a49950c3",
  "stamp:carrier:si": "f61e5bbf",
  "stamp:carrier:ref": "f61e5bbf",
  "stamp:carrier:mid": "f61e5bbf",
  "stamp:carrier:top": "a49950c3",
  "stamp:orion:si": "f61e5bbf",
  "stamp:orion:ref": "f61e5bbf",
  "stamp:orion:mid": "f61e5bbf",
  "stamp:orion:top": "a49950c3",
  "patrol:generalFreighter:crimsonReaverSweep:si": ["e38d27d1", "won:14", "619f0aa1"],
  "forecast:generalFreighter:crimsonReaverSweep:si": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:ref": ["e38d27d1", "won:14", "790e2dcd"],
  "forecast:generalFreighter:crimsonReaverSweep:ref": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:mid": ["e38d27d1", "won:14", "9ee4e17"],
  "forecast:generalFreighter:crimsonReaverSweep:mid": "57:likely",
  "patrol:generalFreighter:crimsonReaverSweep:top": ["efdc6830", "won:14", "50db0297"],
  "forecast:generalFreighter:crimsonReaverSweep:top": "60:likely",
  "patrol:generalFreighter:crimsonReaverWarband:si": ["8170ae77", "lost:20", "beaf4ad4"],
  "forecast:generalFreighter:crimsonReaverWarband:si": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:ref": ["8170ae77", "lost:20", "83731328"],
  "forecast:generalFreighter:crimsonReaverWarband:ref": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:mid": ["8170ae77", "lost:20", "414bfa2a"],
  "forecast:generalFreighter:crimsonReaverWarband:mid": "0:impossible",
  "patrol:generalFreighter:crimsonReaverWarband:top": ["f42c4222", "lost:20", "57e04082"],
  "forecast:generalFreighter:crimsonReaverWarband:top": "0:impossible",
  "patrol:destroyer:crimsonReaverSweep:si": ["31e77619", "won:14", "d4055219"],
  "forecast:destroyer:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:ref": ["31e77619", "won:14", "1c6e495f"],
  "forecast:destroyer:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:mid": ["31e77619", "won:14", "c03d0283"],
  "forecast:destroyer:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:destroyer:crimsonReaverSweep:top": ["3478b6b8", "won:14", "d244c6ef"],
  "forecast:destroyer:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband:si": ["d309e353", "won:22", "94a165d6"],
  "forecast:destroyer:crimsonReaverWarband:si": "9:extreme",
  "patrol:destroyer:crimsonReaverWarband:ref": ["d309e353", "won:22", "102e4844"],
  "forecast:destroyer:crimsonReaverWarband:ref": "9:extreme",
  "patrol:destroyer:crimsonReaverWarband:mid": ["d309e353", "won:22", "f48e8fb4"],
  "forecast:destroyer:crimsonReaverWarband:mid": "9:extreme",
  "patrol:destroyer:crimsonReaverWarband:top": ["297535ae", "won:22", "1e082160"],
  "forecast:destroyer:crimsonReaverWarband:top": "7:extreme",
  "patrol:battleship:crimsonReaverSweep:si": ["8117c7c7", "won:14", "6a6e81a4"],
  "forecast:battleship:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:ref": ["8117c7c7", "won:14", "21edc0fc"],
  "forecast:battleship:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:mid": ["8117c7c7", "won:14", "c787333e"],
  "forecast:battleship:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:battleship:crimsonReaverSweep:top": ["d72d3d2", "won:14", "967b9d3e"],
  "forecast:battleship:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband:si": ["5ef43211", "won:22", "394499f3"],
  "forecast:battleship:crimsonReaverWarband:si": "52:likely",
  "patrol:battleship:crimsonReaverWarband:ref": ["5ef43211", "won:22", "99cca3a3"],
  "forecast:battleship:crimsonReaverWarband:ref": "52:likely",
  "patrol:battleship:crimsonReaverWarband:mid": ["5ef43211", "won:22", "e47a2f51"],
  "forecast:battleship:crimsonReaverWarband:mid": "52:likely",
  "patrol:battleship:crimsonReaverWarband:top": ["23b49270", "won:22", "84039ae9"],
  "forecast:battleship:crimsonReaverWarband:top": "55:likely",
  "patrol:carrier:crimsonReaverSweep:si": ["10bbdaa4", "won:14", "9554bb6e"],
  "forecast:carrier:crimsonReaverSweep:si": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:ref": ["10bbdaa4", "won:14", "bb2af598"],
  "forecast:carrier:crimsonReaverSweep:ref": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:mid": ["10bbdaa4", "won:14", "5d8786e8"],
  "forecast:carrier:crimsonReaverSweep:mid": "64:guaranteed",
  "patrol:carrier:crimsonReaverSweep:top": ["1e555785", "won:14", "c95d52c4"],
  "forecast:carrier:crimsonReaverSweep:top": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband:si": ["cf2ed6fa", "won:22", "15006abb"],
  "forecast:carrier:crimsonReaverWarband:si": "23:notAdvised",
  "patrol:carrier:crimsonReaverWarband:ref": ["cf2ed6fa", "won:22", "4b7aaf6d"],
  "forecast:carrier:crimsonReaverWarband:ref": "23:notAdvised",
  "patrol:carrier:crimsonReaverWarband:mid": ["cf2ed6fa", "won:22", "8ddad7fd"],
  "forecast:carrier:crimsonReaverWarband:mid": "23:notAdvised",
  "patrol:carrier:crimsonReaverWarband:top": ["67882df", "won:22", "488e8c89"],
  "forecast:carrier:crimsonReaverWarband:top": "29:dice",
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
