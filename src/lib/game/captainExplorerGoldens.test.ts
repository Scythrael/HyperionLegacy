// WR-5c (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5c): golden hashes captured
// on the code BEFORE any WR-5c engine edit (the CP-0 / FK-3 / G2-0 / SF-0 / WR-4 pattern). The fixture is one rich
// explorer-ready save: the starting hull with its Standard Issue gear, a Balanced Array (20 sensors), a Security,
// Science and Operations complement, a seated Science officer (Discovery Instinct) and Executive officer (Command
// Presence), and the D18 away team. Each variant gives captain 1 ONE explorer secondary node (or none) and reads:
//
//   sheet     : the crew-boosted ship stat sheet (effectiveShipStats).
//   cands     : the expedition console's candidate list (telescope reading, foreknowledge, task demand).
//   dispatch  : the Ground Ops run record a dispatch of the first candidate freezes.
//   done      : that run advanced to its end (advanceExpedition), the record.
//   claim     : the state after the claim (vault, inventory, officers' promotion counters).
//   study     : the first vault token's relic study duration (or "none").
//   mission   : a Short Ore Run flown 900 economyTick seconds (officer and crew output on missions).
//   patrol    : a destroyer with a seated Tactical officer (Weapons Command) on a Repeat patrol, 900 seconds.
//   boards    : the officer board and the away-team recruit board sizes.
//
// Every state hash normalizes the captains' secondary nodes away, so before WR-5c wires anything every variant
// reads EXACTLY the baseline (the nodes are inert): that is the capture. The WR-5c commit re-pins ONLY the parts
// a node moves, each with its reason beside it, and the baseline ("none") never moves.

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
import { wr9OffForThisFile } from "./wr9Switch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();
gearWearOffInThisFile();
import { goldenJson } from "./firstRunsGoldens.fixture"; // gear wear: hashes with the retired durability put back
// E-MOD EM-1: sheets pinned before the power budget engine are hashed with it switched off (emodGoldens.test.ts pins
// the power numbers and proves the switch reproduces its own capture), so these pins keep proving nothing else moved.
import { withEm1Off } from "./emodEm1Switch.fixture";
import { PATROLS, type GameState, type SecondaryTalentKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, startRelicStudy } from "./tick";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { effectiveShipStats } from "./crewOverlay";
import { withV1Museum, withoutGuests } from "./firstRunsGoldens.fixture";
import { seniorStaffCandidates } from "./seniorStaff";
import { awayRecruitCandidates } from "./awayTeam";
import { WIRING_BUCKET_COUNT, bucketOf, editCaptain, installPiece, seatOfficer, withAwayTeam, withBuckets, withFacilityLevel, wiringBase } from "./wiring/probes";
// Integration (0.14.0, WR-5c meeting SF-2 and CP-2 on feat/crew-0.14.0): the capture predates both, so the fixture
// keeps its pre-merge inputs through the repo's own switches (the FK-3 / CP-0 / WR-4 pattern) and every pin stays as
// captured. SF-2 retired the 30 minute shakedown on expedition 1 (asPreSafeFirstRunsDispatch puts it back). CP-2
// moved the fixture default race from Earth-born to Spacer and made the Earth-born racial act, so the fixture names
// Earth-born and reads under withCp2Off (that racial at 0). Nothing else differs from the WR-5c tip's capture.
import { asPreG2Candidate, asPreG2NamesDispatch, asPreSafeFirstRunsDispatch, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
import { withCp2Off } from "./complementCp2Switch.fixture";
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
const hash = (v: unknown): string => fnv(goldenJson(v));
// A state without the captains' secondary nodes (the variant's own input), so an inert node reads the baseline.
// Relics v2 R2-1: the Museum v2 record in its v1 form (withV1Museum), as these were captured.
const hashState = (s: GameState): string => hash({ ...withV1Museum(s), captains: s.captains.map((c) => ({ ...c, unlockedSecondaryTalents: [] })) });

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

// The rich explorer-ready save (see the header).
function fixture(): GameState {
  let s = installMissingCombatBaselines(wiringBase());
  s = installPiece(s, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  s = withBuckets(s, [
    bucketOf("security", "sec.boarding", WIRING_BUCKET_COUNT, "earthBorn"),
    bucketOf("science", "sci.rareFind", WIRING_BUCKET_COUNT, "earthBorn"),
    bucketOf("operations", "ops.effectiveCargo", WIRING_BUCKET_COUNT, "earthBorn"),
  ]);
  s = seatOfficer(s, "science", ["sci.discovery", "sci.yieldSurge"], { race: "earthBorn" });
  s = seatOfficer(s, "executive", ["xo.commandOutput", "ops.cargoExpand"], { race: "earthBorn" });
  s = withAwayTeam(s);
  s = withFacilityLevel(s, "research", 1);
  return { ...s, expeditionSeed: 0x5c0de, gameTimeSeconds: 100_000 };
}

function patrolFixture(): GameState {
  const s = seatOfficer(installMissingCombatBaselines(wiringBase("destroyer")), "tactical", ["tac.weaponCommand", "tac.shieldCommand"], { race: "earthBorn" });
  return { ...s, captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

const own = (s: GameState, key: SecondaryTalentKey | null): GameState => (key ? editCaptain(s, { unlockedSecondaryTalents: [key] }) : s);

export const EXPLORER_NODES: readonly SecondaryTalentKey[] = [
  "surveySensors1", "surveySensors2", "surveySensors3", "surveySensors4", "surveySensors5",
  "expeditionRelics1", "expeditionRelics2", "expeditionRelics3", "expeditionRelics4", "expeditionRelics5",
  "commandCrew1", "commandCrew2", "commandCrew3", "commandCrew4", "commandCrew5",
];

export function readVariant(key: SecondaryTalentKey | null): Record<string, string> {
  return withCp2Off(() => readVariantLive(key));
}

function readVariantLive(key: SecondaryTalentKey | null): Record<string, string> {
  const s0 = own(fixture(), key);
  const ship = s0.ships.find((sh) => sh.id === "ship-1")!;
  // G1-1: the sheet hash strips guest quarters (withoutGuests), so this pin keeps proving no other stat moved.
  const sheet = hash(withoutGuests(withEm1Off(() => effectiveShipStats(s0, ship))));
  const candidates = expeditionCandidates(s0, "ship-1");
  const cands = hash(candidates.map((c) => asPreG2Candidate(c))); // G2-2: as offered before G2-2 (ids, names)
  const res = asPreG2NamesDispatch(asPreSafeFirstRunsDispatch(dispatchPastPropulsion(s0, "ship-1", 1, candidates[0].id)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const dispatch = hash(res.expedition);
  const end = 3_000_000;
  const done = advanceExpedition(res.next.expeditions[0], end);
  if (done.phase !== "complete") throw new Error("the golden run did not finish");
  const claim = claimExpedition({ ...res.next, expeditions: [done], gameTimeSeconds: end }, done.id);
  if (!claim.success) throw new Error("the golden claim was refused");
  const token = (claim.next.relicVault ?? [])[0];
  const studied = token ? startRelicStudy(claim.next, token.id) : null;
  const study = studied && studied.started ? String(studied.next.activeProcesses.find((p) => p.kind === "relicStudy")?.durationTicks) : "none";

  const m = dispatchCaptainOnMission(own(fixture(), key), 1, "shortOreRun");
  if (!m.success) throw new Error("the golden mission was refused");
  const mission = hashState(runTicks(m.next, 900, lcg(0x5c1)));

  const p = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(own(patrolFixture(), key), 1, Object.keys(PATROLS)[0], "balanced", true));
  if (!p.success) throw new Error("the golden patrol was refused");
  const patrol = hashState(runTicks(p.next, 900, lcg(0x5c2)));

  const boards = `${seniorStaffCandidates(s0).length}/${awayRecruitCandidates(s0).length}`;
  return { sheet, cands, dispatch, done: hash(done), claim: hashState(claim.next), study, mission, patrol, boards };
}

// ===== the goldens (captured before WR-5c) =====
// SF-4 merge (user 2026-10-21 "One step per patrol run"): the `patrol` hash of the baseline and of commandCrew2 / 3 / 5
// re-pinned. The only move is runCounts.patrol.completed in the hashed state (a run counts once, not once per won route;
// with the per-route count line restored every old value reproduces); the patrol flown is byte-identical.

const BASELINE: Record<string, string> = {
  sheet: "7cabdac1",
  cands: "68c028f8",
  dispatch: "3527221b",
  done: "4aca4b1a",
  claim: "8cf7de8a",
  study: "600",
  mission: "c3e1866b",
  patrol: "6e711db",
  boards: "10/10",
};

// Per node: the parts it moves since WR-5c wired it (anything not listed equals BASELINE, byte for byte), and why.
const MOVES: Partial<Record<SecondaryTalentKey, Record<string, string>>> = {
  // Keen Sensors: sensors 20 -> 21 on the sheet, so the run freezes sensorPower 21 (a faster scan). The candidates
  // keep their reading (21 crosses no reveal threshold and stays under the telescope lift at 40).
  surveySensors1: { sheet: "f5a46f18", dispatch: "ffa208a1", done: "9c494328" },
  // Cartographer: captainScanRateMult 1.08 in the frozen scan params; the scan runs faster, the same finds come home.
  surveySensors2: { dispatch: "8dd19ed3", done: "30ea7946" },
  // Anomaly Sense: captainDiscoveryMult 1.05 in the frozen scan params; every attempt's odds rise, the claim is unchanged.
  surveySensors3: { dispatch: "313d4b5", done: "639b9be8" },
  // Foreknowledge: each candidate reads one telescope detail level higher (display only; the run is untouched).
  // Gas Giant Study GG-2 (was cb1aeb4e): the lifted detail shows the task demand, and the gas giant system (candidate
  // 2) previews no ground objective on its giant and one ship study there; nothing else in the list moved.
  surveySensors4: { cands: "c4de8bec" },
  // Deep Scan: the candidates read in full (top detail, every foreknowledge field), and captainSureFinds 1 rides the
  // frozen scan params (each body's first attempt finds something).
  // Gas Giant Study GG-2 (was e58c409c): the full reading shows the task demand and the relic sets, and the gas giant
  // system (candidate 2) previews no ground objective (so no relic set) on its giant and one ship study there.
  surveySensors5: { cands: "a3d66e04", dispatch: "791e6e4b", done: "fc8f8b2a" },
  // Expedition Lead: the frozen Security and Science strengths x1.05; the squads fight and work harder, the haul moves.
  expeditionRelics1: { dispatch: "c215cfaa", done: "9ecdc4fc", claim: "69e6fd30" },
  // Field Science: explorerCaptain.relicFindMult 1.05 on the run; this seed's relic rolls land the same.
  expeditionRelics2: { dispatch: "c7ac4326", done: "424414ed" },
  // Away-Team Doctrine: explorerCaptain.squadPowerMult 1.05; the fights play out differently, the claim is unchanged.
  expeditionRelics3: { dispatch: "a1789cbd", done: "6b8ef730" },
  // Preservationist: the recovered relic carries studySpeed 0.08, so its study takes ceil(600 / 1.08) = 556 ticks.
  expeditionRelics4: { dispatch: "8df1c515", done: "c9e72b7e", claim: "56679ba6", study: "556" },
  // Relic Hunter: the tier ceiling + 1; the relic rolls Augmented (the study x1.5: 900 ticks).
  expeditionRelics5: { dispatch: "cd665e05", done: "f92598ee", claim: "1a27f406", study: "900" },
  // Inspiring Leader: the complement's buffs x1.05 (the cargo buff on the sheet, so the mission hauls more; the frozen
  // crew rare find on the run). The destroyer patrol has no complement, so it does not move.
  commandCrew1: { sheet: "fedf8bdf", dispatch: "8d3b7c34", done: "e499ab1d", mission: "95bf1cc" },
  // Mentor: every officer bonus x1.05 (the sheet's yield and cargo, the run's Discovery Instinct, the mission's
  // Command Presence, the patrol's Weapons and Shield Command).
  commandCrew2: { sheet: "869097d4", dispatch: "1cc6be51", done: "61085ea4", mission: "9423023e", patrol: "d5ceb989" },
  // Drillmaster: every promotion counter increment x1.08 (the mission's and patrol's hours and cycles, the claim's
  // objectives), and explorerCaptain.promotionMult 1.08 frozen on the run.
  commandCrew3: { dispatch: "9b88a3dc", done: "d1053e03", claim: "85cdad0e", mission: "365aba7b", patrol: "528fd482" },
  // Recruiter: both boards 10 x 1.08 = 10.8, rounded up to 11. Held at CP-19's flat +1 (user 2026-11-09): 10 + 1 = 11.
  commandCrew4: { boards: "11/11" },
  // Legendary Captain: the complement AND the officers x1.10 (everything Inspiring Leader and Mentor move).
  commandCrew5: { sheet: "32c2c065", dispatch: "ba74462f", done: "877c44c6", mission: "716140ba", patrol: "3219b4ae" },
};

describe("WR-5c goldens: the explorer secondary nodes (captured before wiring; each move explained above)", () => {
  it("the baseline (no node) is pinned", () => {
    expect(readVariant(null)).toEqual(BASELINE);
  });
  for (const key of EXPLORER_NODES) {
    it(`${key}: only its own parts move`, () => {
      expect(readVariant(key)).toEqual({ ...BASELINE, ...(MOVES[key] ?? {}) });
    });
  }
});
