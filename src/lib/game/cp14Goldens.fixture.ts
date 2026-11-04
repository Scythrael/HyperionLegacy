// Complement CP-14 GOLDENS (hull base sensors and Science amplification; plan
// docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-14, OC-16 "Explorers lead", OC-20 "Proposed numbers",
// OC-21 "Multiply"): every reading a hull's base sensors or the Science lift can reach, through the live engine (1 s
// economyTick steps), captured on the code BEFORE the slice (CP14_PINS_PRE). Each survey mission and short-range run is
// read twice: as dispatched (`fresh`), and DISPATCHED with the slice switched off, then run with it on (`inFlight`: a run
// dispatched before CP-14, which carries no stamp; cp14Rows takes that dispatch wrapper, cp14Switch.fixture.ts
// withoutCp14). The CP-14 stamp is left out of every hash (asPreCp14), so a pin moves only when the run plays
// differently. TEST-ONLY (imported by *.test.ts files only).
//
//   sheet        : the crew-inclusive sheet on one hull of every sensor class (Aurora 35, Orion 25, Eir 15, a warship
//                  10, the freighter and a prospector 0), bare, with a sensor array, and with the array plus a Science
//                  division and a Science officer (Lieutenant); the Aurora also with no array but the Science people,
//                  with Focused Command, and with Focused Command on a Prospector. Each row is the sensors value and a
//                  hash of the whole sheet.
//   mission      : a mineral survey (2000 s) on an Orion and a Prospector with the array and the Science people; an
//                  ore run on the Orion (no sensor reader) and a survey on the freighter with the Science people only.
//   shortRange   : an Eir's first short-range run (900 s) with the array and the Science people.
//   patrol       : Dispatch Once to its end on a Destroyer with the Science people (no patrol reads sensors).
//   expedition   : an Orion's Ground Operations dispatch with the array and the Science people (frozen run and the run
//                  30 days on; `inFlight` dispatches before the slice); a bare Aurora's.
//   save         : a fleet holding the Science people serialized, and the same save through deserialize + migrate.

import Decimal from "break_infinity.js";
import { PATROLS, type CrewBucket, type GameState, type OfficerRank, type PatrolKey, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick } from "./tick";
import { effectiveShipStats, resolveCrew } from "./crewOverlay";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { advanceExpedition } from "./expedition";
import { deserialize, migrate, serialize } from "./save";
import { hash, onHull, stateHash, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion, withoutRelicStagger } from "./awayTeamTestFixtures";
import { asPreStaggerShortRange } from "./shortRangeRelics.fixture";
import { editShip, installPiece, seatOfficer, shipOf, wiringBase } from "./wiring/probes";

const RNG = (): number => 0.5;
const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`cp14 goldens: ${what}`);
};

// A Science division of 50 (two buckets: a survey and an extraction buff) and a Belter Operations bucket.
export const CP14_SCIENCE: readonly CrewBucket[] = [
  { profession: "science", rarity: "standard", rank: 1, race: "belter", buff1Id: "sci.survey", buff2Id: null, count: 30 },
  { profession: "science", rarity: "standard", rank: 1, race: "belter", buff1Id: "sci.extraction", buff2Id: null, count: 20 },
  { profession: "operations", rarity: "standard", rank: 1, race: "belter", buff1Id: "ops.unloadSpeed", buff2Id: null, count: 10 },
] as CrewBucket[];

// The Science people: the division above added to the ship's complement (active: never auto-filled) and a Science
// officer of `rank` with no bonus.
export function withCp14Science(s: GameState, rank: OfficerRank = "lieutenant"): GameState {
  const held = shipOf(s).complement?.buckets ?? [];
  const crewed = editShip(s, { complement: { mode: "active", buckets: [...held.map((b) => ({ ...b })), ...CP14_SCIENCE.map((b) => ({ ...b }))] } });
  const seated = seatOfficer(crewed, "science", []);
  return { ...seated, officers: seated.officers.map((o) => (o.seat === "science" ? { ...o, rank } : o)) };
}
export function withCp14Array(s: GameState): GameState {
  return installPiece(s, { id: "cp14-sensor", slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
}
export function withFocusedCommand(s: GameState): GameState {
  return installPiece(s, { id: "cp14-bridge", slotType: "bridge", moduleVariant: "bridgeFocusedCommand" });
}

// A run as dispatched before the slice: captain 1's mission without its CP-14 stamp (no-op on a record without one).
export function asPreCp14(s: GameState): GameState {
  return {
    ...s,
    captains: s.captains.map((c, i) => {
      if (i !== 0 || c.mission === null) return c;
      const { hullSensors: _h, ...rest } = c.mission as typeof c.mission & { hullSensors?: 1 };
      return { ...c, mission: rest as typeof c.mission };
    }),
  };
}
export type Cp14Variant = "fresh" | "inFlight";
export type Cp14Dispatch = <T>(run: () => T) => T;
const asIs: Cp14Dispatch = (run) => run();
let inFlightDispatch: Cp14Dispatch = asIs;
const dispatchFor = (v: Cp14Variant): Cp14Dispatch => (v === "fresh" ? asIs : inFlightDispatch);

// ===== sheet =====
export const CP14_SHEET_HULLS: readonly ShipTypeKey[] = ["aurora", "orion", "eir", "destroyer", "battleship", "carrier", "generalFreighter", "prospectorMiner"];
export function cp14SheetRow(s: GameState): [number, string] {
  const sheet = effectiveShipStats(s, shipOf(s));
  return [Math.round(sheet.sensors * 1e6) / 1e6, hash(sheet)];
}

// ===== mission =====
function missionBase(hull: ShipTypeKey, array: boolean): GameState {
  const base = withCp14Science(onHull(hull));
  const s = array ? withCp14Array(base) : base;
  return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}
export function cp14MissionRow(hull: ShipTypeKey, missionKey: "shortOreRun" | "surveyMineralAnomaly", v: Cp14Variant, array = true): string[] {
  const r = dispatchFor(v)(() => dispatchCaptainOnMission(missionBase(hull, array), 1, missionKey));
  must(r.success, `${hull} ${missionKey}: ${r.reason}`);
  let s = r.next;
  for (let i = 0; i < 2000; i++) s = economyTick(s, 1, RNG);
  return [hash(asPreCp14(r.next).captains[0].mission), stateHash(asPreCp14(s))];
}

// ===== shortRange =====
function shortRangeBase(hull: ShipTypeKey, array: boolean): GameState {
  const ship = resolveCrew({ ...editShip(wiringBase(), { typeKey: hull }), gameTimeSeconds: 6 * 3600 });
  return withCp14Science(array ? withCp14Array(ship) : ship);
}
export function cp14ShortRangeRow(hull: ShipTypeKey, v: Cp14Variant, array = true): string[] {
  const r = dispatchFor(v)(() => dispatchCaptainOnShortRange(shortRangeBase(hull, array), 1, 0));
  must(r.success, String(r.reason));
  const pre = asPreStaggerShortRange(r.next);
  let s = pre;
  for (let i = 0; i < 900; i++) s = economyTick(s, 1, RNG);
  return [hash(asPreCp14(pre).captains[0].mission), stateHash(asPreCp14(s))];
}

// ===== patrol =====
export const CP14_PATROL_KEY = Object.keys(PATROLS)[0] as PatrolKey;
export function cp14PatrolRow(): string[] {
  const base = withCp14Science(asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(100_000) }));
  const r = dispatchCaptainOnPatrol(base, 1, CP14_PATROL_KEY, "balanced", false);
  must(r.success, `destroyer: ${r.reason}`);
  const row = [hash(structuredClone(asPreCp14(r.next).captains[0].mission))];
  let s = r.next;
  let ticks = 0;
  while (s.captains[0].mission !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, stateHash(asPreCp14(s)));
  return row;
}

// ===== expedition =====
function expeditionBase(hull: ShipTypeKey, kit: boolean): GameState {
  const base = asExpeditionVeteran(withCrew(onHull(hull), "d18"));
  return kit ? withCp14Science(withCp14Array(base)) : base;
}
export function cp14ExpeditionRow(hull: ShipTypeKey, kit: boolean, dispatch: Cp14Dispatch = asIs): string[] {
  const res = dispatch(() => dispatchPastPropulsion(expeditionBase(hull, kit), "ship-1", 1, "cand-0"));
  must(res.success, `${hull}: ${res.reason}`);
  const exp = withoutRelicStagger(res.expedition!);
  const done = advanceExpedition(structuredClone(exp), exp.phaseAnchorSeconds + 30 * 86400);
  return [hash(exp.voyage), hash(exp), hash(done)];
}

// ===== save =====
export function cp14SaveRows(): string[] {
  const s = withCp14Science(withCp14Array(wiringBase("aurora")));
  const raw = serialize(s, 0, 0);
  const loaded = deserialize(raw);
  return [hash(raw), hash(loaded === null ? null : serialize(migrate(loaded), 0, 0))];
}

export function cp14Rows(dispatchOff: Cp14Dispatch): Record<string, unknown> {
  inFlightDispatch = dispatchOff;
  const got: Record<string, unknown> = {};
  for (const hull of CP14_SHEET_HULLS) {
    got[`sheet:${hull}:bare`] = cp14SheetRow(wiringBase(hull));
    got[`sheet:${hull}:array`] = cp14SheetRow(withCp14Array(wiringBase(hull)));
    got[`sheet:${hull}:science`] = cp14SheetRow(withCp14Science(withCp14Array(wiringBase(hull))));
  }
  got["sheet:aurora:scienceNoArray"] = cp14SheetRow(withCp14Science(wiringBase("aurora")));
  got["sheet:aurora:cadet"] = cp14SheetRow(withCp14Science(withCp14Array(wiringBase("aurora")), "cadet"));
  got["sheet:aurora:commander"] = cp14SheetRow(withCp14Science(withCp14Array(wiringBase("aurora")), "commander"));
  got["sheet:aurora:focused"] = cp14SheetRow(withFocusedCommand(withCp14Science(withCp14Array(wiringBase("aurora")))));
  got["sheet:prospectorMiner:focused"] = cp14SheetRow(withFocusedCommand(withCp14Science(withCp14Array(wiringBase("prospectorMiner")))));
  got["sheet:destroyer:focused"] = cp14SheetRow(withFocusedCommand(withCp14Science(withCp14Array(wiringBase("destroyer")))));
  for (const v of ["fresh", "inFlight"] as Cp14Variant[]) {
    got[`mission:orion:survey:${v}`] = cp14MissionRow("orion", "surveyMineralAnomaly", v);
    got[`mission:prospectorMiner:survey:${v}`] = cp14MissionRow("prospectorMiner", "surveyMineralAnomaly", v);
    got[`shortRange:eir:${v}`] = cp14ShortRangeRow("eir", v);
  }
  got["mission:orion:ore:fresh"] = cp14MissionRow("orion", "shortOreRun", "fresh");
  got["mission:generalFreighter:survey:fresh"] = cp14MissionRow("generalFreighter", "surveyMineralAnomaly", "fresh", false);
  got["patrol:destroyer:fresh"] = cp14PatrolRow();
  got["expedition:orion:fresh"] = cp14ExpeditionRow("orion", true);
  got["expedition:orion:inFlight"] = cp14ExpeditionRow("orion", true, dispatchOff);
  got["expedition:aurora:bare"] = cp14ExpeditionRow("aurora", false);
  got["save"] = cp14SaveRows();
  return got;
}

// Captured on feat 658014c, before the slice.
export const CP14_PINS_PRE: Record<string, unknown> = {
  "sheet:aurora:bare": [0,"4e326d65"],
  "sheet:aurora:array": [20,"1ad67e45"],
  "sheet:aurora:science": [20,"eaf6a845"],
  "sheet:orion:bare": [0,"8870cb16"],
  "sheet:orion:array": [20,"454d0ffc"],
  "sheet:orion:science": [20,"cbd90d99"],
  "sheet:eir:bare": [0,"ade58abc"],
  "sheet:eir:array": [20,"8f63ed2"],
  "sheet:eir:science": [20,"52998e57"],
  "sheet:destroyer:bare": [0,"475c0565"],
  "sheet:destroyer:array": [20,"94165c23"],
  "sheet:destroyer:science": [20,"9bd9e134"],
  "sheet:battleship:bare": [0,"3293481"],
  "sheet:battleship:array": [20,"1d40d9d7"],
  "sheet:battleship:science": [20,"d4b81138"],
  "sheet:carrier:bare": [0,"848d561f"],
  "sheet:carrier:array": [20,"e653af75"],
  "sheet:carrier:science": [20,"4fafe772"],
  "sheet:generalFreighter:bare": [0,"cd763a7"],
  "sheet:generalFreighter:array": [20,"3f9df3cf"],
  "sheet:generalFreighter:science": [20,"ac9a445e"],
  "sheet:prospectorMiner:bare": [0,"7ef59c4e"],
  "sheet:prospectorMiner:array": [20,"e96a8cee"],
  "sheet:prospectorMiner:science": [20,"ccb768ee"],
  "sheet:aurora:scienceNoArray": [0,"f3eed22b"],
  "sheet:aurora:cadet": [20,"eaf6a845"],
  "sheet:aurora:commander": [20,"eaf6a845"],
  "sheet:aurora:focused": [22,"3fa8fb23"],
  "sheet:prospectorMiner:focused": [20,"3e075735"],
  "sheet:destroyer:focused": [20,"9bd9e134"],
  "mission:orion:survey:fresh": ["eb52323","bad98e97"],
  "mission:prospectorMiner:survey:fresh": ["eb52323","7280129b"],
  "shortRange:eir:fresh": ["1b5ee8ce","ad64d124"],
  "mission:orion:survey:inFlight": ["eb52323","bad98e97"],
  "mission:prospectorMiner:survey:inFlight": ["eb52323","7280129b"],
  "shortRange:eir:inFlight": ["1b5ee8ce","ad64d124"],
  "mission:orion:ore:fresh": ["a56128bd","c9dc55d5"],
  "mission:generalFreighter:survey:fresh": ["eb52323","21c5dbbb"],
  "patrol:destroyer:fresh": ["c478f282","won:14","12c59fe5"],
  "expedition:orion:fresh": ["9b7820ac","aeca5094","98749c24"],
  "expedition:orion:inFlight": ["9b7820ac","aeca5094","98749c24"],
  "expedition:aurora:bare": ["739f92bf","bfa46905","a068cbe6"],
  "save": ["7b47e31b","5f2b7057"],
};
