// WR-6 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-6): golden hashes captured
// on the code BEFORE any WR-6 engine edit (the CP-0 / FK-3 / G2-0 / SF-0 / WR-4 / WR-5 pattern). Each variant owns
// ONE WR-6 source on otherwise identical saves (or none), and reads every column:
//
//   sheet    : the crew-boosted ship stat sheet (effectiveShipStats) of an explorer-ready save.
//   dispatch : the Ground Ops run record a dispatch of that save's first candidate freezes.
//   done     : that run advanced to its end (advanceExpedition), the record.
//   claim    : the state after the claim.
//   mission  : a Short Ore Run flown 900 economyTick seconds.
//   patrol   : a destroyer's Repeat patrol: the dispatch record, then the state after 900 seconds.
//   event    : the Ground Ops ship-event profile frozen at dispatch, and one battle of it against the Cloaked Vessel.
//   teardown : a second General Freighter torn down at the Salvage Bay (salvageShip, band draw 0.5).
//   craft    : 40 Fabricator jobs started through startProcess (20 blanks, 20 Frame Segments), then resolved.
//   crew     : three crew transport windows delivered (resolveCrew).
//
// Every state hash normalizes the variant's own input away (the captain's talents, spec and race, the Homeworld
// talents), so before WR-6 wires anything every variant reads EXACTLY the baseline (the sources are inert): that is
// the capture. The WR-6 commit re-pins ONLY the parts a source moves, each with its reason beside it (MOVES), and the
// baseline ("none") never moves.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
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
import { wr9OffForThisFile } from "./wr9Switch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about the placeholder talents;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
gearWearOffInThisFile();
// E-MOD EM-1: sheets pinned before the power budget engine are hashed with it switched off (emodGoldens.test.ts pins
// the power numbers and proves the switch reproduces its own capture), so these pins keep proving nothing else moved.
import { withEm1Off } from "./emodEm1Switch.fixture";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, blueprintMintsEquipmentInstance, type GameState, type HomeworldTalentKey, type PatrolMissionState } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, resolveProcesses, startProcess } from "./tick";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { effectiveShipStats, resolveCrew } from "./crewOverlay";
import { salvageShip } from "./salvage";
import { resolveBattle } from "./combat/resolveBattle";
import { shipToCombatant } from "./combat/bridge";
import { makeWeaponInstance } from "./combat/weapons";
import { CLOAKED_VESSEL_HULL, buildShipCombatant, snapshotShipEventProfile } from "./shipScanEvents";
import { TRANSPORT_WINDOW_SECONDS } from "./transports";
import { FIXTURE_RACE, WIRING_BUCKET_COUNT, bucketOf, editCaptain, installPiece, seatOfficer, withAwayTeam, withBuckets, withFacilityLevel, withHomeworld, wiringBase } from "./wiring/probes";
import { goldenJson, withV1Museum, withoutGuests } from "./firstRunsGoldens.fixture"; // gear wear: goldenJson puts the retired durability back
import { asPreCurveDispatch, asPreG2NamesDispatch, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
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
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
homeworldReserveOffForThisFile();
crewHoursFloatForThisFile();

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(v));
// A state without the variant's own input, so an inert source reads the baseline.
// Relics v2 R2-1: the Museum v2 record in its v1 form (withV1Museum), as these were captured.
// The inert racials (0.14.0): the probes' fixture race (probes.ts FIXTURE_RACE) moved from the Spacer to the Belter
// once the Spacer racial went live on the transit speed. Neither acts on anything these fixtures read (the Belter only
// on a carrier's drone screen; the patrol here is a destroyer's), and the sheet, run and event hashes, which carry no
// race, are unchanged; the state hashes carry the fixture's officer and crew race NAME, so it is named back here.
const AT_CAPTURE_RACE = "spacer";
const asCaptured = <T extends { race: string }>(x: T): T => (x.race === FIXTURE_RACE ? { ...x, race: AT_CAPTURE_RACE } : x);
const hashState = (s: GameState): string =>
  hash({
    ...withV1Museum(s),
    unlockedHomeworldTalents: [],
    captains: s.captains.map((c) => ({ ...c, unlockedCaptainTalents: [], spec: null, race: undefined })),
    officers: s.officers.map(asCaptured),
    ships: s.ships.map((sh) => (sh.complement ? { ...sh, complement: { ...sh.complement, buckets: sh.complement.buckets.map(asCaptured) } } : sh)),
  });

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function runTicks(s: GameState, n: number, rng: () => number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}

export type Wr6Variant =
  | "none"
  | "tacticianHub"
  | "explorerHub"
  | "tacticalSpec"
  | "scienceSpec"
  | "captainRace"
  | "fleetLogisticsSalvage"
  | "industryHub"
  | "homelandDefenseHub"
  | "citizenryHub";

export const WR6_VARIANTS: readonly Wr6Variant[] = [
  "tacticianHub",
  "explorerHub",
  "tacticalSpec",
  "scienceSpec",
  "captainRace",
  "fleetLogisticsSalvage",
  "industryHub",
  "homelandDefenseHub",
  "citizenryHub",
];

// The variant's one source on `s` (captain 1, or the fleet's Homeworld talents).
function own(s: GameState, v: Wr6Variant): GameState {
  switch (v) {
    case "none":
      return s;
    case "tacticianHub":
    case "explorerHub":
      return editCaptain(s, { unlockedCaptainTalents: [v] });
    case "tacticalSpec":
      return editCaptain(s, { spec: "tactical" });
    case "scienceSpec":
      return editCaptain(s, { spec: "science" });
    case "captainRace":
      // Station-born: crew.unloadSpeed, a live racial key (the sheet and the mission unload read it).
      return editCaptain(s, { race: "stationBorn" });
    default:
      return withHomeworld(s, [v as HomeworldTalentKey]);
  }
}

// The explorer-ready save (the WR-5c golden's shape, on the current branch defaults).
function explorerFixture(): GameState {
  let s = installMissingCombatBaselines(wiringBase());
  s = installPiece(s, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  s = withBuckets(s, [
    bucketOf("security", "sec.boarding", WIRING_BUCKET_COUNT),
    bucketOf("science", "sci.rareFind", WIRING_BUCKET_COUNT),
    bucketOf("operations", "ops.unloadSpeed", WIRING_BUCKET_COUNT),
  ]);
  s = seatOfficer(s, "science", ["sci.discovery", "sci.yieldSurge"]);
  s = withAwayTeam(s);
  s = withFacilityLevel(s, "research", 1);
  return { ...s, expeditionSeed: 0x6c0e1, gameTimeSeconds: 100_000 };
}

function patrolFixture(): GameState {
  const s = seatOfficer(installMissingCombatBaselines(wiringBase("destroyer")), "tactical", ["tac.weaponCommand"]);
  return { ...s, captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

// Two General Freighters (the Salvage Bay refuses the fleet's last hull).
function teardownFixture(): GameState {
  const s = wiringBase();
  const spare = { ...s.ships[0], id: "ship-2", assignedCaptainId: null };
  return { ...s, ships: [...s.ships, spare] };
}

const BLANK_KEY = Object.keys(BLUEPRINTS).find((k) => blueprintMintsEquipmentInstance(BLUEPRINTS[k]))!;

function craftColumn(s0: GameState): string {
  let s: GameState = { ...s0, inventory: {} };
  for (let i = 0; i < 40; i++) {
    const effect = i % 2 === 0
      ? { type: "addBlank" as const, blueprintKey: BLANK_KEY }
      : { type: "addItem" as const, itemId: "frameSegment", amount: new Decimal(1) };
    const r = startProcess(s, "fabricateJob", {}, 10 + i, effect);
    if (!r.started) throw new Error("the golden craft did not start");
    s = r.next;
  }
  const done = resolveProcesses(s, 1_000, lcg(0x6c3)).next;
  return hash({ blanks: done.blanks, inventory: done.inventory, active: done.activeProcesses.length });
}

function eventColumn(s0: GameState): string {
  const profile = snapshotShipEventProfile(s0, s0.ships[0]);
  const ship = buildShipCombatant("ship-1", profile.battle!, 0, 0);
  const hull = CLOAKED_VESSEL_HULL;
  const enemy = shipToCombatant({
    id: "enemy-1",
    team: "enemy",
    stats: hull.stats,
    weaponLoadout: hull.weapons.map((w, i) => makeWeaponInstance(w, `enemy-1-w${i}-${w}`)),
    stance: hull.stance,
  });
  const fight = resolveBattle({ combatants: [ship, enemy] }, 0x6b6b);
  return hash({ profile, outcome: fight.outcome, final: fight.finalCombatants });
}

export function readWr6Variant(v: Wr6Variant): Record<string, string> {
  const s0 = own(explorerFixture(), v);
  // Merged after G1-1 and G2-2 (both captured before them): the sheet hashes without guest quarters (the General
  // Freighter's base berths), and the dispatch is the one before G2-2 (the console names and region fields stripped).
  const sheet = hash(withoutGuests(withEm1Off(() => effectiveShipStats(s0, s0.ships.find((sh) => sh.id === "ship-1")!))));
  const candidates = expeditionCandidates(s0, "ship-1");
  // Safe first runs SF-3: pinned on the run as dispatched before the curve (asPreCurveDispatch: a new save's ordinary run
  // now sits on the curve's floor).
  const res = asPreCurveDispatch(asPreG2NamesDispatch(dispatchPastPropulsion(s0, "ship-1", 1, candidates[0].id)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const end = 3_000_000;
  const done = advanceExpedition(res.next.expeditions[0], end);
  if (done.phase !== "complete") throw new Error(`the golden run did not finish (phase ${done.phase})`);
  const claimed = claimExpedition({ ...res.next, expeditions: [done], gameTimeSeconds: end }, done.id);
  if (!claimed.success) throw new Error("the golden claim was refused");

  const m = dispatchCaptainOnMission(own(explorerFixture(), v), 1, "shortOreRun");
  if (!m.success) throw new Error("the golden mission was refused");
  const mission = hashState(runTicks(m.next, 900, lcg(0x6c1)));

  const p = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(own(patrolFixture(), v), 1, "crimsonReaverWarband", "balanced", true));
  if (!p.success) throw new Error(`the golden patrol was refused: ${p.reason}`);
  const patrolDispatch = hash(p.next.captains[0].mission as PatrolMissionState);
  const patrol = hashState(runTicks(p.next, 900, lcg(0x6c2)));

  const event = eventColumn(own(patrolFixture(), v));

  const t = salvageShip(own(teardownFixture(), v), "ship-2", () => 0.5);
  if (!t.ok) throw new Error("the golden teardown was refused");
  const teardown = hash({ recovered: t.recovered, credits: t.creditsRecovered });

  const craft = craftColumn(own(wiringBase(), v));

  const crewSave = own({ ...wiringBase(), lastTransportWindow: 0, gameTimeSeconds: 3 * TRANSPORT_WINDOW_SECONDS + 1 }, v);
  const crewDone = resolveCrew(crewSave);
  const crew = hash({ pool: crewDone.crewPool, ships: crewDone.ships.map((sh) => sh.complement ?? null) });

  return {
    sheet,
    dispatch: hash(res.expedition),
    done: hash(done),
    claim: hashState(claimed.next),
    mission,
    patrolDispatch,
    patrol,
    event,
    teardown,
    craft,
    crew,
  };
}

// ===== the goldens (captured before WR-6) =====

const BASELINE: Record<string, string> = {
  sheet: "5911e6ad",
  dispatch: "1dca7911",
  done: "fb09df71",
  claim: "d1798da9",
  mission: "20bc9fbc",
  patrolDispatch: "3c9583a",
  patrol: "f743f565",
  event: "b32ff238",
  teardown: "a3cdf544",
  craft: "90e4d0d8",
  crew: "a2844c72",
};

// Per source: the parts it moves since WR-6 wired it (anything not listed equals BASELINE, byte for byte), and why.
const MOVES: Partial<Record<Wr6Variant, Record<string, string>>> = {
  // Combat Readiness: weaponDamage 0.05 joins the frozen captain combat record, so the run's frozen ship-event battle
  // profile (dispatch) and the event fights it plays (done) change, as do the patrol cycle's record and the event
  // battle. The claim holds (this run's event fights end the same way), and so does the 900 s patrol (the destroyer's
  // Warband waves resolve to the same result).
  tacticianHub: { dispatch: "93ab3127", done: "468f02a3", patrolDispatch: "cb60fa74", event: "a56b391f" },
  // Survey Doctrine: captainScanRateMult 1.05 in the frozen scan params; the scan runs faster, the same finds come home.
  explorerHub: { dispatch: "4276d790", done: "65b36ec7" },
  // The tactical spec: weaponDamage 0.01 in the same record, so exactly the columns Combat Readiness moves.
  tacticalSpec: { dispatch: "57a64d4c", done: "54765ae4", patrolDispatch: "d7d15c1b", event: "97bbb1ca" },
  // The science spec: explorerCaptain.relicFindMult 1.01 on the run; this seed's relic rolls land the same.
  scienceSpec: { dispatch: "f381e50", done: "fb954bf0" },
  // A Station-born captain: its racial (crew.unloadSpeed, the officer magnitude) on the sheet, so the run freezes a
  // faster offload. The Short Ore Run does not reach its unload inside 900 s, and a patrol has no unload.
  captainRace: { sheet: "551eac54", dispatch: "3afa589e", done: "48483427" },
  // Salvage Operations on a hull teardown: +10 percentage points on the teardown fraction, so more components and
  // credits come back.
  fleetLogisticsSalvage: { teardown: "6d506c38" },
  // Works Directorate: the jobs whose keyed roll lands deliver a second blank or a second Frame Segment. Re-pinned
  // (88f1495f -> 8b902b9d) when the roll gained the save's seed in its key (worksDirectorateSeed), so job N no longer
  // rolls identically in every save: a different set of the 40 jobs lands. No production save carries a stamped job yet.
  industryHub: { craft: "8b902b9d" },
  // Home Guard: the patrol cycle's frozen record carries shield 0.05 and the folded shield pool is 5% larger. The
  // ship-event battle does not move (patrols only), and the 900 s patrol ends the same way.
  homelandDefenseHub: { patrolDispatch: "e1e0a4f2" },
  // Civic Charter: 13 crew per transport. The mission column moves too: its first tick delivers the fixture's whole
  // transport backlog (game time 100,000 s, no transport since 0), so the pool and the auto-crewed complement differ.
  citizenryHub: { mission: "fe60f344", crew: "ae5bd1f" },
};

describe("WR-6 goldens: the captain primary hubs, specs and race, and the Homeworld placeholders (captured before wiring)", () => {
  it("the baseline (no source) is pinned", () => {
    expect(readWr6Variant("none")).toEqual(BASELINE);
  });
  for (const v of WR6_VARIANTS) {
    it(`${v}: only its own parts move`, () => {
      expect(readWr6Variant(v)).toEqual({ ...BASELINE, ...(MOVES[v] ?? {}) });
    });
  }
});
