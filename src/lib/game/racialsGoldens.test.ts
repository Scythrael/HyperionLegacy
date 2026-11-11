// The four INERT racials go live (0.14.0, user ruling "everything wired"; docs/plans/2026-10-19-merge-batch-answers.md
// "Relics v2 constants and Spacer" and "Spacer bonus"; complement plan CP-3's racial piece and CP-4's replenish
// consumer, OC-1 "Faster drone replenish", OC-4 "Faster scans"): golden hashes captured on the code BEFORE the engine
// edit. Each fixture carries ONE racial family on otherwise ordinary saves:
//
//   sheet     : effectiveShipStats + shipCrewContribution of a ship whose officer and crew are of the race.
//   patrol    : a Repeat patrol on a carrier with a Belter XO and Belter Deck Handling crew: the dispatch record, the
//               display replay every 150 s and the state after 1,200 economyTick seconds.
//   survey    : a Ground Ops run with a Vael Science officer and Outer-Colony Survey Aptitude crew: the dispatch
//               record, the run at its end and the claimed state.
//   spacerRun : the same run with a Spacer Pilot and Spacer crew (the voyage legs).
//   mission   : a Short Ore Run flown 700 economyTick seconds, once with Spacers aboard and once with the other three
//               races (whose consumers are patrols and expeditions only, so that one is a control).
//
// The wiring commit re-pins ONLY what a racial moves (GOLDEN), each with its reason beside it, and proves the move
// with the racials switched off (racialsSwitch.fixture.ts): every fixture then reproduces its capture (BEFORE).

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
import { describe, expect, it } from "vitest";
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
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about the inert racials;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import { freshState, type AwayMember, type CrewBucket, type CrewRace, type Expedition, type GameState, type PatrolMissionState, type SeniorStaffSeat, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { effectiveShipStats, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { seatOfficer } from "./wiring/probes";
import { asPreCurveDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
import { goldenJson, withoutRunCounts } from "./firstRunsGoldens.fixture"; // gear wear: goldenJson puts the retired durability back
import { withRacialsOff } from "./racialsSwitch.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
// The crewHours determinism fix (2026-10-30): this file's pins predate it and are about another slice, so the whole
// file runs with the float crewHours counter (crewHoursSwitch.fixture.ts; crewHoursMs.test.ts traces the move).
import { crewHoursFloatForThisFile } from "./crewHoursSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
crewHoursFloatForThisFile();

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const bucket = (profession: CrewBucket["profession"], race: CrewRace, buff1Id: string, count: number): CrewBucket => ({
  profession,
  rarity: "standard",
  rank: 1,
  race,
  buff1Id,
  buff2Id: null,
  count,
});

// ship-1 crewed by `officers` (seat, race; no bonuses) and `buckets` (manual complement).
function crewed(s: GameState, officers: readonly [SeniorStaffSeat, CrewRace][], buckets: readonly CrewBucket[]): GameState {
  let out = s;
  for (const [seat, race] of officers) out = seatOfficer(out, seat, [], { race });
  return { ...out, ships: out.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { mode: "active", buckets: [...buckets] } } : sh)) };
}

const BELTER: readonly [SeniorStaffSeat, CrewRace][] = [["executive", "belter"]];
const BELTER_CREW: readonly CrewBucket[] = [bucket("flightDeck", "belter", "flight.droneHandling", 40), bucket("flightDeck", "belter", "flight.transitOut", 20)];
const SURVEY: readonly [SeniorStaffSeat, CrewRace][] = [["science", "vael"], ["executive", "outerColony"]];
const SURVEY_CREW: readonly CrewBucket[] = [bucket("science", "outerColony", "sci.survey", 40), bucket("science", "vael", "sci.extraction", 20)];
const SPACER: readonly [SeniorStaffSeat, CrewRace][] = [["pilot", "spacer"]];
const SPACER_CREW: readonly CrewBucket[] = [bucket("operations", "spacer", "ops.loadSpeed", 40)];
const OTHERS: readonly [SeniorStaffSeat, CrewRace][] = [...BELTER, ["science", "vael"]];
const OTHERS_CREW: readonly CrewBucket[] = [...BELTER_CREW, ...SURVEY_CREW];

function racialsSheet(hull: ShipTypeKey, officers: readonly [SeniorStaffSeat, CrewRace][], buckets: readonly CrewBucket[]): string {
  const s = crewed(installMissingCombatBaselines({ ...freshState(), ships: freshState().ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: hull } : sh)) }), officers, buckets);
  const ship = s.ships[0];
  return `${hash(effectiveShipStats(s, ship))}/${hash(shipCrewContribution(s, ship))}`;
}

function racialsPatrol(): { out: string[]; drones: number; relaunches: number; replenished: boolean } {
  const base = freshState();
  const st = crewed(
    installMissingCombatBaselines({ ...base, credits: new Decimal(100000), ships: base.ships.map((sh) => ({ ...sh, typeKey: "carrier" as ShipTypeKey })) }),
    BELTER,
    BELTER_CREW,
  );
  const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(st, 1, "crimsonReaverSweep", "balanced", true));
  if (!r.success) throw new Error(`patrol refused: ${r.reason}`);
  let s = r.next;
  const first = s.captains[0].mission as PatrolMissionState;
  const out = [hash(first)];
  let relaunches = 0;
  let replenished = false;
  let prevPhase = first.phase;
  for (let i = 0; i < 1200; i++) {
    const before = (s.captains[0].mission as PatrolMissionState).playerDrones.some((sq) => sq.drones.some((d) => !d.alive || d.status !== "online"));
    s = economyTick(s, 1, () => 0.5);
    const m = s.captains[0].mission as PatrolMissionState;
    if (before && m.playerDrones.some((sq) => sq.drones.some((d) => d.refabProgress > 0 || d.repairProgress > 0))) replenished = true;
    if (prevPhase === "transitBack" && m.phase === "transitOut") relaunches += 1;
    prevPhase = m.phase;
    if (i % 150 === 0) out.push(hash(replayPatrol(s, s.captains[0])));
  }
  out.push(hash(s));
  return { out, drones: first.playerDrones.length, relaunches, replenished };
}

const SQUAD: AwayMember[] = [
  { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
  { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2, traits: ["fieldMedic"] },
  plainAwayMember("member-11", "science", "ship-1"),
];

function racialsRun(officers: readonly [SeniorStaffSeat, CrewRace][], buckets: readonly CrewBucket[], seed: number): { exp: Expedition; out: string[] } {
  const s0 = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  const s = crewed(s0, officers, buckets);
  // Safe first runs SF-3: pinned on the run as dispatched before the curve (asPreCurveDispatch: a new save's ordinary run
  // now sits on the curve's floor).
  const res = asPreCurveDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  const done = advanceExpedition(exp, 2_000_000);
  expect(done.phase).toBe("complete");
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  return { exp, out: [hash(exp), hash(done), hash(claim.next)] };
}

function racialsMission(officers: readonly [SeniorStaffSeat, CrewRace][], buckets: readonly CrewBucket[]): string {
  const base: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
  base.captains = base.captains.map((c) => ({ ...c, level: 10 }));
  const r = dispatchCaptainOnMission(crewed(base, officers, buckets), 1, "shortOreRun");
  if (!r.success) throw new Error(`mission refused: ${r.reason}`);
  let s = r.next;
  const rng = lcg(0xbeef);
  for (let i = 0; i < 700; i++) s = economyTick(s, 1, rng);
  return hash(s);
}

// Captured on the code BEFORE the engine edit (on top of f56fb8f, in the goldens-first change of this slice). The
// switch proof below reproduces every one of these with the racials switched off.
const BEFORE: Record<string, string | string[]> = {
  "sheet:belter": "f58d21f7/75d0ca5b",
  "sheet:survey": "e980da23/803dff47",
  "sheet:spacer": "cd763a7/85076d98",
  // The dispatch record and the replays equal complementGoldens.test.ts "patrol" (the same carrier patrol): the
  // Belter crew acted on nothing then. Only the final state differs (it holds the crew).
  patrol: ["16e07798", "9e9d9838", "95126c89", "6f82e593", "349cbd04", "8c13b3c8", "c1af6ef3", "d7ae934c", "3ee0a8b7", "f2047c48"],
  survey: ["ffdce4b", "59f6a41a", "888f3b19"],
  spacerRun: ["cb74a940", "c48cc2f6", "e0c5fb05"],
  "mission:spacer": "26220505",
  "mission:others": "bf5a25cf",
};

// The pins today. Each move names its reason; an unchanged pin equals BEFORE.
const GOLDEN: Record<string, string | string[]> = {
  // Unchanged: Deck Handling and Survey Aptitude act at patrol and expedition dispatch, never on the sheet.
  "sheet:belter": BEFORE["sheet:belter"],
  "sheet:survey": BEFORE["sheet:survey"],
  // MOVES: the Spacer racial is the sweeping transit speed now (transitSpeedMult, and its key in the crew map).
  "sheet:spacer": "d3b2a51d/70b9f0b0",
  // MOVES: the cycle freezes the crew's Deck Handling (dispatch record) and its squadrons carry it (deckHandlingPpm) and
  // bank the faster replenish (replenishCarryPpm), so the replays and the state move.
  patrol: ["5f119ee3", "90133792", "475c2905", "5e744913", "3ed198fc", "36432380", "e15fcac5", "9bb32e8", "e4cd679d", "8a456d95"],
  // MOVES: the dispatch freezes the crew's Survey Aptitude into scanSpeedBonus, so every scan is faster.
  survey: ["594c5451", "e969f48", "9fe025be"],
  // MOVES: the Spacer Pilot and crew speed the voyage (both legs, frozen at dispatch).
  spacerRun: ["4ab89c29", "e238662c", "c4dc7d6"],
  // MOVES: the Spacers shorten the mission's transit legs.
  "mission:spacer": "1758c111",
  // Unchanged (the control): Belter, Vael and Outer-Colony crews act on patrols and expeditions only.
  "mission:others": BEFORE["mission:others"],
};

describe("inert racials: the goldens (captured before the wiring, re-pinned only where a racial moves)", () => {
  it("sheets: Belter, Survey (Vael + Outer-Colony) and Spacer crews", () => {
    expect(racialsSheet("carrier", BELTER, BELTER_CREW)).toBe(GOLDEN["sheet:belter"]);
    expect(racialsSheet("orion", SURVEY, SURVEY_CREW)).toBe(GOLDEN["sheet:survey"]);
    expect(racialsSheet("generalFreighter", SPACER, SPACER_CREW)).toBe(GOLDEN["sheet:spacer"]);
  });

  it("patrol: a Belter carrier's Repeat patrol (dispatch, replays, the state after 1,200 s)", () => {
    const r = racialsPatrol();
    // Self-check: the carrier fields drones, loses some and replenishes them, and relaunches more than once.
    expect(r.drones).toBeGreaterThan(0);
    expect(r.replenished).toBe(true);
    expect(r.relaunches).toBeGreaterThan(1);
    expect(r.out).toEqual(GOLDEN.patrol);
  });

  it("survey: a Ground Ops run with a Vael Science officer and Outer-Colony Survey Aptitude crew", () => {
    const { exp, out } = racialsRun(SURVEY, SURVEY_CREW, 0x1244);
    expect(exp.groundOps).toBeDefined();
    expect(out).toEqual(GOLDEN.survey);
  });

  it("spacerRun: the same run with a Spacer Pilot and Spacer crew", () => {
    expect(racialsRun(SPACER, SPACER_CREW, 0x1244).out).toEqual(GOLDEN.spacerRun);
  });

  it("missions: a Short Ore Run with Spacers aboard, and one with the other three races (the control)", () => {
    expect(racialsMission(SPACER, SPACER_CREW)).toBe(GOLDEN["mission:spacer"]);
    expect(racialsMission(OTHERS, OTHERS_CREW)).toBe(GOLDEN["mission:others"]);
  });

  it("self-check: each crew carries its racial's key on the ship", () => {
    const s = crewed(freshState(), OTHERS, OTHERS_CREW);
    const crew = shipCrewContribution(s, s.ships[0]);
    expect(crew[CREW_STAT_KEYS.droneHandling]).toBeGreaterThan(0);
    expect(crew[CREW_STAT_KEYS.surveyAptitude]).toBeGreaterThan(0);
  });
});

// ===== the "turn it off" proof =====
// With the racials switched off (racialsSwitch.fixture.ts) every fixture reproduces its capture from before the
// wiring, so the switched effects are the ONLY thing the wiring moved. The sheets restore only the Spacer key: they
// hash the crew map itself, where the drone and survey keys always sat (zeroing them would move the map, although
// nothing there reads it).
describe("inert racials: switched off, every fixture reproduces its pre-wiring capture", () => {
  it("sheets (the Spacer key restored)", () => {
    withRacialsOff(
      () => {
        expect(racialsSheet("carrier", BELTER, BELTER_CREW)).toBe(BEFORE["sheet:belter"]);
        expect(racialsSheet("orion", SURVEY, SURVEY_CREW)).toBe(BEFORE["sheet:survey"]);
        expect(racialsSheet("generalFreighter", SPACER, SPACER_CREW)).toBe(BEFORE["sheet:spacer"]);
      },
      { droneAndSurvey: false },
    );
  });

  it("patrol, runs and missions", () => {
    withRacialsOff(() => {
      expect(racialsPatrol().out).toEqual(BEFORE.patrol);
      expect(racialsRun(SURVEY, SURVEY_CREW, 0x1244).out).toEqual(BEFORE.survey);
      expect(racialsRun(SPACER, SPACER_CREW, 0x1244).out).toEqual(BEFORE.spacerRun);
      expect(racialsMission(SPACER, SPACER_CREW)).toBe(BEFORE["mission:spacer"]);
      expect(racialsMission(OTHERS, OTHERS_CREW)).toBe(BEFORE["mission:others"]);
    });
  });
});
