// Complement CP-13 GOLDENS (hull-family module bonuses; plan docs/plans/2026-10-14-complement-and-acquisition-plan.md
// CP-13, OC-13 "One catalog, by hull (Recommended)"): every reading a bridge or quarters module's hull bonus can reach,
// through the live engine (1 s economyTick steps), captured on the code BEFORE the bonus (CP13_PINS_PRE). Each mission,
// short-range and patrol run is read twice: as dispatched (`fresh`), and with the run's CP-13 stamp removed right after
// dispatch (`inFlight`: a run dispatched before the bonus). The stamp and the frozen weapon line are left out of every
// hash (asPreCp13), so a pin moves only when the run plays differently. TEST-ONLY (imported by *.test.ts files only).
//
//   sheet        : the crew-inclusive sheet and the crew map on one hull of each family, a bridge and a quarters module
//                  installed, a crew in every division and an Operations officer seated; the same ship with no module.
//   mission      : a Short Ore Run (2000 s) on a Prospector and a General Freighter, a mineral survey (2000 s) on a
//                  Prospector, each with both modules and the crew; the Prospector's ore run with no module.
//   shortRange   : an Eir's first short-range run (900 s) with both modules and a sensor array.
//   patrol       : Dispatch Once to its end, and Repeat for 2500 s, on a Destroyer with both modules; the Destroyer with
//                  no module.
//   expedition   : an Orion's Ground Operations dispatch with both modules and a sensor array: the frozen run and the
//                  whole run 30 days on; `inFlight` dispatches before the bonus and runs after it.
//   save         : a fleet holding both modules serialized, and the same save through deserialize + migrate + serialize.

import Decimal from "break_infinity.js";
import { PATROLS, type CrewBucket, type GameState, type PatrolKey, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick } from "./tick";
import { effectiveShipStats, resolveCrew, shipCrewContribution } from "./crewOverlay";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { advanceExpedition } from "./expedition";
import { deserialize, migrate, serialize } from "./save";
import { hash, onHull, stateHash, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion, withoutRelicStagger } from "./awayTeamTestFixtures";
import { asPreStaggerShortRange } from "./shortRangeRelics.fixture";
import { editShip, installPiece, seatOfficer, shipOf, wiringBase } from "./wiring/probes";

const RNG = (): number => 0.5;
const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`cp13 goldens: ${what}`);
};

// A crew in every division, each carrying a live buff (the Operations bucket a second one: the mission output share).
export const CP13_CREW: readonly CrewBucket[] = [
  { profession: "operations", rarity: "standard", rank: 1, race: "belter", buff1Id: "ops.unloadSpeed", buff2Id: "excl.crewOutputMult", count: 12 },
  { profession: "flightDeck", rarity: "standard", rank: 1, race: "belter", buff1Id: "flight.transitOut", buff2Id: null, count: 8 },
  { profession: "engineering", rarity: "standard", rank: 1, race: "belter", buff1Id: "eng.range", buff2Id: "eng.hullRepair", count: 10 },
  { profession: "security", rarity: "standard", rank: 1, race: "belter", buff1Id: "sec.awayTeam", buff2Id: null, count: 8 },
  { profession: "science", rarity: "standard", rank: 1, race: "belter", buff1Id: "sci.extraction", buff2Id: "sci.rareFind", count: 10 },
  { profession: "medical", rarity: "standard", rank: 1, race: "belter", buff1Id: "med.reducedLosses", buff2Id: "med.triage", count: 6 },
] as CrewBucket[];

// Both crew modules (Standard, quality 0), the crew above (active: never auto-filled) and an Operations officer.
export function withCp13Kit(s: GameState, bridge = "bridgeBalancedCommand", quarters = "quartersUtilitarian"): GameState {
  let out = installPiece(s, { id: "cp13-bridge", slotType: "bridge", moduleVariant: bridge });
  out = installPiece(out, { id: "cp13-quarters", slotType: "quarters", moduleVariant: quarters });
  return withCp13Crew(out);
}
export function withCp13Crew(s: GameState): GameState {
  const crewed = editShip(s, { complement: { mode: "active", buckets: CP13_CREW.map((b) => ({ ...b })) } });
  return seatOfficer(crewed, "operations", ["ops.cargoExpand"]);
}

// A run as dispatched before the bonus: captain 1's mission without its CP-13 stamp and frozen weapon line (no-op on a
// record that carries neither).
export function asPreCp13(s: GameState): GameState {
  return {
    ...s,
    captains: s.captains.map((c, i) => {
      if (i !== 0 || c.mission === null) return c;
      const { hullBonus: _b, hullWeapon: _w, ...rest } = c.mission as typeof c.mission & { hullBonus?: 1; hullWeapon?: number };
      return { ...c, mission: rest as typeof c.mission };
    }),
  };
}
export type Cp13Variant = "fresh" | "inFlight";
const asVariant = (s: GameState, v: Cp13Variant): GameState => (v === "fresh" ? s : asPreCp13(s));

// ===== sheet =====
const SHEET_HULLS: readonly ShipTypeKey[] = ["generalFreighter", "prospectorMiner", "destroyer", "aurora"];
function sheetBase(hull: ShipTypeKey): GameState {
  return installPiece(wiringBase(hull), { id: "cp13-sensor", slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
}
export function cp13SheetRow(s: GameState): string {
  return hash({ sheet: effectiveShipStats(s, shipOf(s)), crew: shipCrewContribution(s, shipOf(s)) });
}

// ===== mission =====
function missionBase(hull: ShipTypeKey, kit: boolean): GameState {
  const base = onHull(hull);
  const s = kit ? withCp13Kit(base) : withCp13Crew(base);
  return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}
export function cp13MissionRow(hull: ShipTypeKey, missionKey: "shortOreRun" | "surveyMineralAnomaly", v: Cp13Variant, kit = true): string[] {
  const r = dispatchCaptainOnMission(missionBase(hull, kit), 1, missionKey);
  must(r.success, `${hull} ${missionKey}: ${r.reason}`);
  let s = asVariant(r.next, v);
  for (let i = 0; i < 2000; i++) s = economyTick(s, 1, RNG);
  return [hash(asPreCp13(r.next).captains[0].mission), stateHash(asPreCp13(s))];
}

// ===== shortRange =====
function shortRangeBase(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  return withCp13Kit(installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }));
}
export function cp13ShortRangeRow(v: Cp13Variant): string[] {
  const r = dispatchCaptainOnShortRange(shortRangeBase(), 1, 0);
  must(r.success, String(r.reason));
  const pre = asVariant(asPreStaggerShortRange(r.next), v);
  let s = pre;
  for (let i = 0; i < 900; i++) s = economyTick(s, 1, RNG);
  return [hash(asPreCp13(pre).captains[0].mission), stateHash(asPreCp13(s))];
}

// ===== patrol =====
export const CP13_PATROL_KEY = Object.keys(PATROLS)[0] as PatrolKey;
function patrolBase(kit: boolean): GameState {
  const base = asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(100_000) });
  return kit ? withCp13Kit(base) : withCp13Crew(base);
}
// Dispatch Once runs to its end; a Repeat run (`repeatTicks` set) runs that many seconds.
export function cp13PatrolRow(v: Cp13Variant, repeatTicks?: number, kit = true): string[] {
  const repeat = repeatTicks !== undefined;
  const r = dispatchCaptainOnPatrol(patrolBase(kit), 1, CP13_PATROL_KEY, "balanced", repeat);
  must(r.success, `destroyer: ${r.reason}`);
  const row = [hash(structuredClone(asPreCp13(r.next).captains[0].mission))];
  let s = asVariant(r.next, v);
  let ticks = 0;
  while (s.captains[0].mission !== null && (!repeat || ticks < repeatTicks)) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, stateHash(asPreCp13(s)));
  return row;
}

// ===== expedition =====
function expeditionBase(): GameState {
  const base = asExpeditionVeteran(withCrew(onHull("orion"), "d18"));
  return withCp13Kit(installPiece(base, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }));
}
// `dispatch` wraps the dispatch (the inFlight row dispatches with the bonus held apart, then runs with it on).
export function cp13ExpeditionRow(dispatch: <T>(run: () => T) => T = (run) => run()): string[] {
  const res = dispatch(() => dispatchPastPropulsion(expeditionBase(), "ship-1", 1, "cand-0"));
  must(res.success, `orion: ${res.reason}`);
  const exp = withoutRelicStagger(res.expedition!);
  const done = advanceExpedition(structuredClone(exp), exp.phaseAnchorSeconds + 30 * 86400);
  return [hash(exp.voyage), hash(exp), hash(done)];
}

// ===== save =====
export function cp13SaveRows(): string[] {
  const s = withCp13Kit(wiringBase("aurora"));
  const raw = serialize(s, 0, 0);
  const loaded = deserialize(raw);
  return [hash(raw), hash(loaded === null ? null : serialize(migrate(loaded), 0, 0))];
}

export function cp13Rows(dispatchOff: <T>(run: () => T) => T): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const hull of SHEET_HULLS) {
    got[`sheet:${hull}:kit`] = cp13SheetRow(withCp13Kit(sheetBase(hull)));
    got[`sheet:${hull}:none`] = cp13SheetRow(withCp13Crew(sheetBase(hull)));
  }
  for (const v of ["fresh", "inFlight"] as Cp13Variant[]) {
    got[`mission:prospectorMiner:ore:${v}`] = cp13MissionRow("prospectorMiner", "shortOreRun", v);
    got[`mission:generalFreighter:ore:${v}`] = cp13MissionRow("generalFreighter", "shortOreRun", v);
    got[`mission:prospectorMiner:survey:${v}`] = cp13MissionRow("prospectorMiner", "surveyMineralAnomaly", v);
    got[`shortRange:eir:${v}`] = cp13ShortRangeRow(v);
    got[`patrol:destroyer:${v}`] = cp13PatrolRow(v);
    got[`patrolRepeat:destroyer:${v}`] = cp13PatrolRow(v, 2500);
  }
  got["mission:prospectorMiner:ore:none"] = cp13MissionRow("prospectorMiner", "shortOreRun", "fresh", false);
  got["patrol:destroyer:none"] = cp13PatrolRow("fresh", undefined, false);
  got["expedition:orion:fresh"] = cp13ExpeditionRow();
  got["expedition:orion:inFlight"] = cp13ExpeditionRow(dispatchOff);
  got["save"] = cp13SaveRows();
  return got;
}

// Captured on feat e46d1d3, before the hull bonus.
export const CP13_PINS_PRE: Record<string, unknown> = {
  "sheet:generalFreighter:kit": "a646aa20",
  "sheet:generalFreighter:none": "7ef0c44a",
  "sheet:prospectorMiner:kit": "55f6cb8a",
  "sheet:prospectorMiner:none": "cce5111e",
  "sheet:destroyer:kit": "4ea2582a",
  "sheet:destroyer:none": "4b6206d1",
  "sheet:aurora:kit": "b71b9eaf",
  "sheet:aurora:none": "ba91493b",
  "mission:prospectorMiner:ore:fresh": ["a56128bd","574d5f23"],
  "mission:generalFreighter:ore:fresh": ["a56128bd","ac394a0f"],
  "mission:prospectorMiner:survey:fresh": ["eb52323","39e81480"],
  "shortRange:eir:fresh": ["1b5ee8ce","1a463aaa"],
  "patrol:destroyer:fresh": ["c478f282","won:14","c7fd54c0"],
  "patrolRepeat:destroyer:fresh": ["8f383097","won:2500","88bf7cb9"],
  "mission:prospectorMiner:ore:inFlight": ["a56128bd","574d5f23"],
  "mission:generalFreighter:ore:inFlight": ["a56128bd","ac394a0f"],
  "mission:prospectorMiner:survey:inFlight": ["eb52323","39e81480"],
  "shortRange:eir:inFlight": ["1b5ee8ce","1a463aaa"],
  "patrol:destroyer:inFlight": ["c478f282","won:14","c7fd54c0"],
  "patrolRepeat:destroyer:inFlight": ["8f383097","won:2500","88bf7cb9"],
  "mission:prospectorMiner:ore:none": ["a56128bd","8b63ef4f"],
  "patrol:destroyer:none": ["c478f282","won:14","77e06aed"],
  "expedition:orion:fresh": ["5d1b68ef","3882e65f","84bd099d"],
  "expedition:orion:inFlight": ["5d1b68ef","3882e65f","84bd099d"],
  "save": ["eaef9ad7","e1469b1a"],
};
