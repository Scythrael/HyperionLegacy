// Complement and Acquisition CP-0 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-0): golden
// hashes captured on the code BEFORE any complement engine edit (on top of e304b94). Every later slice (CP-1 to CP-20)
// keeps these green in the same commit, or re-pins one ONLY where the slice names the move and why (section 0
// "Flag-neutral" and "Determinism"). Whole serialized state or whole derived records, never a narrow subset:
//
//   sheet      : effectiveShipStats + shipCrewContribution for one ship of EVERY hull, with no complement and with a
//                full complement whose buckets hold EVERY buff id (the four exclusive-pool buffs incl. craft duplicate)
//                and EVERY race (the self-check below proves it).
//   mission    : three captain missions dispatched for real and run 700 economyTick seconds, starting 200 s before a
//                transport window, so the PASSIVE mission ship receives the window's transport crew mid-run.
//   patrol     : a Repeat patrol on a carrier: the dispatch record, the state after 1,200 s (several relaunches) and the
//                display replay every 150 s.
//   repair     : a Shipyard repair of a damaged destroyer: the started process, its duration, and the state when the
//                repair completes.
//   legacy     : two pre-Ground Ops expedition DISPATCH RECORDS (Wiring OC-G1 retired the legacy run at 2,000,000 s and
//                its claimed state with the legacy path; the record hash is held).
//   groundOps  : two Ground Ops runs through claim: one with a field repair leg and med bay stays, one with med bay stays
//                and the hull damage carried home. Wiring OC-G1 fix round: plus the legacy roster's run as a Ground Ops
//                run through claim (groundOpsLegacyRoster), byte-identical with a neutral officer seated and without.
//   transport  : the transport generator's next 20 deliveries (windows 1 to 20) for a fixed seed, one hash per window.
//   structure  : commandStructureForHull for every hull.
// Each fixture also checks that it really holds what it is pinned for (the keys, the transport, the relaunch, ...).

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, expect, it, vi } from "vitest";
// FR-C lane 1 M5 / M6 (Never discard: deliveries land in full, a load trims nothing) came after every pin here: the file
// runs with it off (neverDiscardSwitch.fixture.ts), so its pins keep proving their own slice; neverDiscard.test.ts pins
// the move.
import { neverDiscardOffForThisFile } from "./neverDiscardSwitch.fixture";
neverDiscardOffForThisFile();
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
import { wr9OffForThisFile } from "./wr9Switch.fixture";
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();
// Complement plan CP-5 (per-hull crew caps): every pin here was captured on the spec templates and fills complements to
// the caps (the structure and full-complement sheets of the Battleship, Carrier, Aurora and Eir move with CP-5), so the
// file runs with the per-hull caps off; cp5Goldens.test.ts pins what CP-5 moved and proves the switch returns it.
hullCrewCapsOffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about the complement slices;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
gearWearOffInThisFile();
// E-MOD EM-1: sheets pinned before the power budget engine are hashed with it switched off (emodGoldens.test.ts pins
// the power numbers and proves the switch reproduces its own capture), so these pins keep proving nothing else moved.
import { withEm1Off } from "./emodEm1Switch.fixture";

// OC-11 (CP-8): the switch that proves the auto-crew pause is the ONLY thing OC-11 moved (complementOc11Switch.fixture.ts;
// the "OC-11 goldens" block and the mission tests reproduce their pre-OC-11 captures with it).
vi.mock("./crewLock", async (io) => (await import("./complementOc11Switch.fixture")).oc11CrewLockMock(io));
import { withOc11Off } from "./complementOc11Switch.fixture";
// SF-1: whole states hash without the run counters (withoutRunCounts).
import { goldenJson, withoutGuests, withoutRunCounts } from "./firstRunsGoldens.fixture";
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  type AwayMember,
  type CrewBucket,
  type CrewProfession,
  type CrewRank,
  type CrewRarity,
  type Expedition,
  type GameState,
  type MissionKey,
  type PatrolMissionState,
  type SeniorStaffOfficer,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, shipRepairDurationTicks, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { effectiveShipStats, officerRepairSpeedBonus, shipCrewContribution } from "./crewOverlay";
import { equippedFor } from "./equipment";
import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { CREW_RACE_IDS, CREW_RACES } from "./crewRaces";
import { withCp2Off } from "./complementCp2Switch.fixture";
// The inert racials (0.14.0): the switch that restores the Spacer racial's old key and zeroes the drone / survey
// sources (racialsSwitch.fixture.ts; racialsGoldens.test.ts pins what the wiring moved).
import { withRacialsOff } from "./racialsSwitch.fixture";
import { CREW_PROFESSIONS, commandStructureForHull, complementTotalCap, divisionCap } from "./commandStructure";
import { totalCrew } from "./crew";
import { TRANSPORT_BATCH_SIZE, TRANSPORT_WINDOW_SECONDS, transportBatch } from "./transports";
import { FIELD_REPAIR_DAMAGE_SHARE } from "./groundOps";
import { asLegacyDispatch, asPreG2NamesDispatch, asPreRanksDispatch, asPreSafeFirstRunsDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";

// Fix round answers Q3 (2026-11-17, "Yes, same every visit": a catalog-named system's bodies are drawn from its
// catalog id, the same every visit) moves this file's pins (the catalog-named systems its runs fly have other bodies).
// They predate it and are about another slice, so the file runs with it off (fixRoundAnswersSwitch.fixture.ts). Q3's
// own pins: expeditionFixRoundE.test.ts.
fixRoundAnswersOffForThisFile("catalogBodies");

// Fix round FR-E (0.14.0): the star rule (lane 3 I2, STAR_BODIES_SWITCH: a real star's bodies are drawn from the star,
// not from its candidate slot) moves the legacyB dispatch record (its candidate is a real star). The pins here predate
// the round and are about another slice, so the file runs with that fix off (fixRoundESwitch.fixture.ts); every other
// fix of the round runs here. The round's own pins: expeditionFixRoundE.test.ts and expeditionFixRoundEGoldens.test.ts.
fixRoundESwitchesOffForThisFile("starBodies");
homeworldReserveOffForThisFile();
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// SF-1: whole states hash without the run counters (withoutRunCounts), so the pre-SF-1 captures stay byte-identical.
const hash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const ALL_BUFF_IDS = [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE].map((b) => b.id);
const RARITIES: CrewRarity[] = ["derelict", "standard", "augmented", "stellar"];

// A FULL complement for `hull`: every division filled to its cap (then trimmed to the hull's total cap), split over three buckets whose buff1 is each of the
// division's three profession buffs. The first bucket of division k (k < 4) is a Lt Commander carrying exclusive-pool
// buff k as buff2 (so all four exclusive buffs, craft duplicate included, are aboard); the others carry the next
// profession buff as buff2 at a mid rank, or none at rank 1. Races cycle over EVERY race, rarities over the four the
// generator mints. (Rank caps are not modeled: the ship sheet reads buckets, never the caps.) Pure.
function fullComplement(hull: ShipTypeKey): CrewBucket[] {
  const buckets: CrewBucket[] = [];
  let n = 0;
  CREW_PROFESSIONS.forEach((profession: CrewProfession, k) => {
    const pool = CREW_PROFESSION_BUFFS[profession];
    const cap = divisionCap(hull, profession);
    pool.forEach((buff, j) => {
      const count = Math.floor(cap / pool.length) + (j < cap % pool.length ? 1 : 0);
      const exclusive = j === 0 && k < SECOND_LEVEL_EXCLUSIVE.length ? SECOND_LEVEL_EXCLUSIVE[k].id : null;
      const rank: CrewRank = exclusive !== null ? 8 : j === 1 ? 5 : 1;
      buckets.push({
        profession,
        rarity: RARITIES[n % RARITIES.length],
        rank,
        race: CREW_RACE_IDS[n % CREW_RACE_IDS.length],
        buff1Id: buff.id,
        buff2Id: exclusive ?? (rank === 1 ? null : pool[(j + 1) % pool.length].id),
        count,
      });
      n += 1;
    });
  });
  // The division caps can sum past the hull's total cap (rounding): take the excess off the largest buckets, first
  // in order, never below one head, so the complement is exactly full.
  let excess = totalCrew(buckets) - complementTotalCap(hull);
  while (excess > 0) {
    const largest = buckets.reduce((a, b) => (b.count > a.count ? b : a));
    largest.count -= 1;
    excess -= 1;
  }
  return buckets;
}

// ship-1 re-hulled to `hull` with the starting economy gear (plus the hull's combat Standard Issue), passive.
function sheetState(hull: ShipTypeKey, buckets: CrewBucket[]): GameState {
  const base = freshState();
  return installMissingCombatBaselines({
    ...base,
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: hull, complement: { buckets, mode: "passive" } } : sh)),
  });
}

function sheetHashes(hull: ShipTypeKey, buckets: CrewBucket[]): string {
  const s = sheetState(hull, buckets);
  const ship = s.ships[0];
  // G1-1: the sheet hash strips guest quarters (withoutGuests), so these pins keep proving no other stat moved.
  return `${hash(withoutGuests(withEm1Off(() => effectiveShipStats(s, ship))))}/${hash(shipCrewContribution(s, ship))}`;
}

// A captain mission dispatched for real, 200 s before the first transport window (captain level 10 so every mission
// unlocks), run 700 economyTick seconds on a fixed rng.
function missionRun(key: MissionKey): GameState {
  const base: GameState = { ...freshState(), credits: new Decimal(1_000_000), gameTimeSeconds: TRANSPORT_WINDOW_SECONDS - 200 };
  base.captains = base.captains.map((c) => ({ ...c, level: 10 }));
  const r = dispatchCaptainOnMission(base, 1, key);
  expect(r.success, key).toBe(true);
  let s = r.next;
  const rng = lcg(0xbeef);
  for (let i = 0; i < 700; i++) s = economyTick(s, 1, rng);
  return s;
}

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
// The GO-7b parity squad (a medic aboard): its runs fight, wipe, recover in the med bay and come home.
const MEDIC_SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];
const LEGACY_ROSTER: AwayMember[] = [
  member("member-1", "security", { spec: "offense", rank: 3, traits: ["quickDraw"] }),
  member("member-2", "security", { spec: "defense", rank: 2, traits: ["bulwark"] }),
  member("member-3", "security", { spec: "debuff", rank: 4, traits: ["fieldMedic"] }),
  member("member-11", "science"),
];
const FINAL = 2_000_000;

// Wiring OC-G1: the pre-Ground Ops DISPATCH RECORD (asLegacyDispatch strips the later flags; it is hashed, never resolved:
// the legacy resolver is gone).
function legacyRecord(roster: AwayMember[], seed: number): Expedition {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: roster.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  const res = asLegacyDispatch(asPreG2NamesDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return res.expedition;
}

// Wiring OC-G1 fix round: the legacy roster's run as a LIVE Ground Ops run (the current dispatch, no switch), resolved and
// claimed: "dispatch record / resolved run / claimed state without the officers". The officers are stripped from the
// claimed state (one fixture seats one, the other none).
function groundOpsLiveRun(seed: number, officers: SeniorStaffOfficer[]): string {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: LEGACY_ROSTER.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed, officers });
  const res = asPreG2NamesDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  expect(res.expedition.groundOps).toBeDefined();
  const done = advanceExpedition(res.expedition, FINAL);
  expect(done.phase).toBe("complete");
  // The fixture really fights (the run's battles are what an officer could reach).
  expect(done.groundOps!.history.some((r) => r.step === "fight")).toBe(true);
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  return [hash(res.expedition), hash(done), hash({ ...claim.next, officers: [] })].join("/");
}

// A seated officer at the neutral stat line (all 10) carrying no live bonus (an unknown id contributes nothing).
const NEUTRAL_OFFICER: SeniorStaffOfficer = {
  id: "officer-1",
  seat: "executive",
  name: "Officer neutral",
  race: "earthBorn",
  gender: "nonbinary",
  rank: "ensign",
  bonuses: [
    { id: "test.none", magnitude: 0 },
    { id: "test.none", magnitude: 0 },
  ],
  missionsCompleted: 0,
  assignedShipId: "ship-1",
  stats: { strength: 10, integrity: 10, cunning: 10, constitution: 10 },
};

function expeditionRun(roster: AwayMember[], seed: number, preDamage: boolean): { exp: Expedition; done: Expedition; claimed: GameState } {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: roster.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  const started = asPreG2NamesDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  // Field Kits FKR-1: the Ground Ops runs as dispatched before enemy ranks (the flag off), so they keep their capture.
  // Safe first runs SF-2: and before SF-2 (the retired 30 minute shakedown on expedition 1).
  const res = asPreSafeFirstRunsDispatch(asPreRanksDispatch(started));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  let exp = res.expedition;
  // The field repair fixture: the ship leaves carrying hull damage one point under the field repair threshold, so the
  // first light damage sends it down for repairs (the fieldRepair.test.ts pattern).
  if (preDamage) exp = { ...exp, groundOps: { ...exp.groundOps!, hullDamage: FIELD_REPAIR_DAMAGE_SHARE * exp.groundOps!.shipEventProfile.battle!.hullMax - 1 } };
  const done = advanceExpedition(exp, FINAL);
  expect(done.phase).toBe("complete");
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  return { exp, done, claimed: claim.next };
}

// CP-1 (D14): the one transport crewmember whose exclusive pick changed name (see the mission goldens), and the state
// with its CP-0 buff named back.
const isMovedCrew = (b: CrewBucket): boolean =>
  b.profession === "medical" && b.rank === 7 && b.race === "ossir" && b.buff1Id === "med.triage" && b.buff2Id === "excl.preventCrewLoss";
const asBeforeCp1 = (s: GameState): GameState => {
  const back = (list: CrewBucket[]): CrewBucket[] => list.map((b) => (isMovedCrew(b) ? { ...b, buff2Id: "excl.missionTurnaround" } : b));
  return { ...s, crewPool: back(s.crewPool), ships: s.ships.map((sh) => (sh.complement ? { ...sh, complement: { ...sh.complement, buckets: back(sh.complement.buckets) } } : sh)) };
};
const CP0_MISSION: Record<string, string> = {
  shortOreRun: "6c80bffd",
  surveyMineralAnomaly: "988bc42",
  frontierSupplyRun: "717a3120",
};
// The mission pins from before OC-11 (the CP-2 pins), reproduced with the OC-11 pause switched off.
const OC11_OFF_MISSION: Record<string, string> = {
  shortOreRun: "33ff8a16",
  surveyMineralAnomaly: "bb43f634",
  frontierSupplyRun: "f4b5648c",
};

// ===== the goldens =====

// Captured on the code BEFORE any complement engine edit (CP-0, on top of e304b94). Cross-checks: the patrol's dispatch
// record and its eight replays equal officerBonuses.test.ts "patrol:carrier" (the same patrol), and the repair's
// started process equals its "repair" capture.
const GOLDEN: Record<string, string | string[]> = {
  "sheet:none": [
    "generalFreighter:4ac62731/5465b825",
    "prospectorHauler:651f1387/5465b825",
    "prospectorRunner:df35e1db/5465b825",
    "prospectorMiner:310e6ed9/5465b825",
    "destroyer:d9a483c6/5465b825",
    "battleship:fc650856/5465b825",
    "carrier:897ac655/5465b825",
    "orion:817862c7/5465b825",
    "aurora:6e23df72/5465b825",
    "eir:a2143996/5465b825",
  ],
  // Re-pinned by CP-2: the full complement holds every CP-2 key (Damage Control, Mission Turnaround, Crew Output,
  // Crew Effectiveness, the Earth-born and Stheni racials, Fast Departure / Fast Return), so its sheet and crew map
  // move (CP-0 2699e91/a812089b ... eir 734e27d3/db5bc5eb). With the CP-2 effects switched off each hull reproduces
  // its pre-CP-2 capture (the "CP-2 turn it off" block below).
  // Re-pinned by the inert racials (0.14.0): the full complement carries Spacers, whose racial is the sweeping transit
  // speed now (transitSpeedMult on the sheet, and its key in the crew map instead of crew.endurance). With the Spacer
  // key restored (withRacialsOff, droneAndSurvey false) each hull reproduces its CP-2 pin (SHEET_FULL_BEFORE_RACIALS).
  "sheet:full": [
    "generalFreighter:127732e/a0186ddf",
    "prospectorHauler:c8627a0b/26dd17de",
    "prospectorRunner:3f72ff3c/26dd17de",
    "prospectorMiner:d9451016/26dd17de",
    "destroyer:d2a4a857/60bd8be8",
    "battleship:3dbdf177/601d98d6",
    "carrier:c161b2e9/601d98d6",
    "orion:77f6cbb8/72d00d12",
    "aurora:fcf0627a/72d00d12",
    "eir:f07eef76/72d00d12",
  ],
  // Re-pinned by CP-1 (D14): one transport crewmember's exclusive buff changed name (see the mission test and
  // CP0_MISSION, which keeps the CP-0 capture and proves that is the only difference). Re-pinned by CP-2 (CP-1
  // eb39cb91, e84193a6): the window's transport crew carry Earth-born racials and Crew Effectiveness, which now lift
  // the mission ship's other complement buffs (its hold and unload) once it is crewed; switched off, both reproduce
  // their CP-1 pins. The transport run's whole ticks and deliveries do not move (f4b5648c holds).
  // Re-pinned by OC-11 (CP-8, "Pause while out"): the mission ship is out when window 1's transport lands, so its crew
  // now wait in the pool instead of boarding mid-run. With the pause switched off (withOc11Off) each reproduces its
  // CP-2 pin (OC11_OFF_MISSION), and the CP-1 / CP-2 proofs below hold unchanged.
  "mission:shortOreRun": "11d824d",
  "mission:surveyMineralAnomaly": "1cb822f9",
  "mission:frontierSupplyRun": "f04ae86a",
  // Re-pinned by WR-4 (B14): a battle's turn order is by side, then input order (the player side first), no longer
  // by id ("crimsonReavers-w..." used to sort ahead of "ship-1"); the dispatch record (16e07798) is unchanged.
  patrol: ["16e07798", "9e9d9838", "95126c89", "6f82e593", "349cbd04", "8c13b3c8", "c1af6ef3", "d7ae934c", "3ee0a8b7", "4c87428e"],
  repair: ["239", "b439b3e9", "b3cea9b6"],
  // Wiring OC-G1: each was [record, legacy run, legacy claim]; the last two pinned only the deleted legacy path.
  legacyA: ["5a2822aa"],
  legacyB: ["e3b4593f"],
  groundOpsRepair: ["6138c3bd", "d8d37478", "69943b5"],
  groundOpsBay: ["527c9b42", "35454953", "2ac60b53"],
  // Wiring OC-G1 fix round: captured on the engine of the OC-G1 fix round (the end-to-end half the retired legacy pins
  // carried). The real assertion is its test's equality: a neutral officer seated changes nothing.
  groundOpsLegacyRoster: "bbb0526d/b462be98/7c2fb144",
  transport: [
    "a6c5a724", "8c62d32c", "18b4e861", "f2a93087", "438ceec5", "74c0cbc3", "c527137b", "16e1a68f", "2caf4feb", "b0eeec3",
    "9ec2a1c8", "d9f4bf44", "e54d2eae", "9dc57f26", "907b3f30", "270d1a6c", "459e9eff", "6afc6903", "7389e97c", "c6d1c90c",
  ],
  structure: [
    "generalFreighter:ac349d1e",
    "prospectorHauler:a9a20003",
    "prospectorRunner:b82077fa",
    "prospectorMiner:f285bac1",
    "destroyer:8b4ebedb",
    "battleship:3c0554b6",
    "carrier:78e25e1c",
    "orion:25054271",
    "aurora:96401abe",
    "eir:d1e1aaac",
  ],
};

// The CP-2 pins of the full sheets, before the inert racials (0.14.0) moved the Spacer racial onto the transit speed.
const SHEET_FULL_BEFORE_RACIALS: readonly string[] = [
  "generalFreighter:169b8653/2360e09b",
  "prospectorHauler:d0f28f95/ea984e46",
  "prospectorRunner:deb1c7d6/ea984e46",
  "prospectorMiner:666c9728/ea984e46",
  "destroyer:1b06b16a/8aafe454",
  "battleship:e72f1e71/6ea4d3e6",
  "carrier:a825a669/6ea4d3e6",
  "orion:3eb9ca64/8aa1df62",
  "aurora:c30fe7f2/8aa1df62",
  "eir:f0adf82/8aa1df62",
];

describe("CP-0 pre-complement goldens", () => {
  it("sheet: every hull, no complement and a full complement holding every buff id and every race", () => {
    const empty = HULLS.map((hull) => `${hull}:${sheetHashes(hull, [])}`);
    const full = HULLS.map((hull) => `${hull}:${sheetHashes(hull, fullComplement(hull))}`);
    expect(empty).toEqual(GOLDEN["sheet:none"]);
    expect(full).toEqual(GOLDEN["sheet:full"]);
    // The inert racials: the Spacer key restored, every hull is its CP-2 pin again (the Spacer was the only move).
    const restored = withRacialsOff(() => HULLS.map((hull) => `${hull}:${sheetHashes(hull, fullComplement(hull))}`), { droneAndSurvey: false });
    expect(restored).toEqual(SHEET_FULL_BEFORE_RACIALS);
  });

  it("sheet self-check: each full complement fills every division and holds every buff id and race", () => {
    for (const hull of HULLS) {
      const buckets = fullComplement(hull);
      expect(buckets.every((b) => b.count > 0), hull).toBe(true);
      expect(new Set(buckets.flatMap((b) => [b.buff1Id, b.buff2Id]).filter((id) => id !== null))).toEqual(new Set(ALL_BUFF_IDS));
      expect(new Set(buckets.map((b) => b.race))).toEqual(new Set(CREW_RACE_IDS));
      expect(buckets.some((b) => b.buff2Id === "excl.craftDuplicate")).toBe(true);
      for (const p of CREW_PROFESSIONS) expect(buckets.filter((b) => b.profession === p).reduce((n, b) => n + b.count, 0)).toBeLessThanOrEqual(divisionCap(hull, p));
      expect(totalCrew(buckets)).toBe(Math.min(complementTotalCap(hull), CREW_PROFESSIONS.reduce((n, p) => n + divisionCap(hull, p), 0)));
    }
  });

  for (const key of ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]) {
    it(`mission ${key}: 700 economyTick seconds across a transport window, the passive mission ship out (OC-11: not crewed mid-run)`, () => {
      const s = missionRun(key);
      expect(s.lastTransportWindow).toBe(1);
      expect(s.captains[0].mission).not.toBeNull();
      // OC-11: the ship is out, so window 1's transport waits in the pool.
      expect(totalCrew(s.ships[0].complement?.buckets ?? [])).toBe(0);
      expect(totalCrew(s.crewPool)).toBe(TRANSPORT_BATCH_SIZE);
      expect(hash(s)).toBe(GOLDEN[`mission:${key}`]);
      expect(s.crewPool.filter(isMovedCrew).length).toBe(1);
      withOc11Off(() => {
        // Before OC-11 the passive mission ship was crewed mid-run.
        const before = missionRun(key);
        expect(totalCrew(before.ships[0].complement!.buckets)).toBeGreaterThan(0);
        expect(hash(before)).toBe(OC11_OFF_MISSION[key]);
        // CP-1 (D14) moved these three on purpose, and only by ONE crewmember: window 1's crew 9 (medical, rank 7,
        // ossir, Triage) draws the exclusive pool; its one exclusive draw named Mission Turnaround from the four-entry
        // pool and names Prevent a Crew Loss from the three rollable ones (same draw, craft duplicate gone). Both keys
        // have no consumer yet, so naming the old buff back on that crewmember reproduces the CP-0 capture exactly.
        expect(before.ships[0].complement!.buckets.filter(isMovedCrew).length + before.crewPool.filter(isMovedCrew).length).toBe(1);
        // CP-2 then moved two of them (see GOLDEN); with its effects switched off the CP-1 proof holds unchanged.
        expect(withCp2Off(() => hash(asBeforeCp1(missionRun(key))))).toBe(CP0_MISSION[key]);
      });
    });
  }

  it("patrol: a Repeat patrol on a carrier, relaunched, with the display replay", () => {
    const base = freshState();
    const st = installMissingCombatBaselines({ ...base, credits: new Decimal(100000), ships: base.ships.map((sh) => ({ ...sh, typeKey: "carrier" as ShipTypeKey })) });
    const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(st, 1, "crimsonReaverSweep", "balanced", true));
    expect(r.success).toBe(true);
    let s = r.next;
    const out = [hash(s.captains[0].mission)];
    let relaunches = 0;
    let prevPhase = (s.captains[0].mission as PatrolMissionState).phase;
    for (let i = 0; i < 1200; i++) {
      s = economyTick(s, 1, () => 0.5);
      const phase = (s.captains[0].mission as PatrolMissionState).phase;
      if (prevPhase === "transitBack" && phase === "transitOut") relaunches += 1;
      prevPhase = phase;
      if (i % 150 === 0) out.push(hash(replayPatrol(s, s.captains[0])));
    }
    out.push(hash(s));
    expect((s.captains[0].mission as PatrolMissionState).repeatDispatch).toBe(true);
    expect(relaunches).toBeGreaterThan(2);
    expect(out).toEqual(GOLDEN.patrol);
  });

  it("repair: a damaged destroyer's Shipyard repair, started and run to completion", () => {
    const base = installMissingCombatBaselines({ ...freshState() });
    const s0 = installMissingCombatBaselines({
      ...base,
      ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "destroyer" as ShipTypeKey, damaged: true, repairDamage: 437 } : sh)),
    });
    const ship = s0.ships[0];
    const ticks = shipRepairDurationTicks(ship, equippedFor(s0, ship.id), officerRepairSpeedBonus(s0, ship));
    const started = processShipRepairs(s0);
    expect(started.activeProcesses.some((p) => p.kind === "shipRepair")).toBe(true);
    let s = started;
    const rng = lcg(0x5eed);
    for (let i = 0; i < ticks + 2; i++) s = economyTick(s, 1, rng);
    expect(s.ships[0].damaged).toBeUndefined();
    const out = [String(ticks), hash(started.activeProcesses), hash(s)];
    expect(out).toEqual(GOLDEN.repair);
  });

  for (const [name, seed] of [["legacyA", 0x2468ace], ["legacyB", 0x2468ace + 7919]] as const) {
    it(`${name}: a pre-Ground Ops expedition's dispatch record (OC-G1 retired its legacy run and claim)`, () => {
      const exp = legacyRecord(LEGACY_ROSTER, seed);
      expect("groundOps" in exp).toBe(false);
      expect([hash(exp)]).toEqual(GOLDEN[name]);
    });
  }

  it("groundOpsLegacyRoster: the legacy roster's live Ground Ops run through claim, a neutral officer seated = none", () => {
    const plain = groundOpsLiveRun(0x2468ace, []);
    expect(groundOpsLiveRun(0x2468ace, [NEUTRAL_OFFICER])).toBe(plain);
    expect(plain).toBe(GOLDEN.groundOpsLegacyRoster);
  });

  it("groundOpsRepair: a Ground Ops run with a field repair leg and med bay stays, through claim", () => {
    const { exp, done, claimed } = expeditionRun(MEDIC_SQUAD, 0x1244, true);
    expect(done.groundOps!.repairLegs).toHaveLength(1);
    expect(done.groundOps!.history.some((r) => r.step === "bay" && r.endedAt > r.startedAt)).toBe(true);
    const out = [hash(exp), hash(done), hash(claimed)];
    expect(out).toEqual(GOLDEN.groundOpsRepair);
  });

  it("groundOpsBay: a Ground Ops run with med bay stays and hull damage carried home, through claim", () => {
    const { exp, done, claimed } = expeditionRun(MEDIC_SQUAD, 0x1234, false);
    expect(done.groundOps!.repairLegs).toBeUndefined();
    expect(done.groundOps!.history.some((r) => r.step === "bay" && r.endedAt > r.startedAt)).toBe(true);
    expect(claimed.ships[0].damaged).toBe(true);
    const out = [hash(exp), hash(done), hash(claimed)];
    expect(out).toEqual(GOLDEN.groundOpsBay);
  });

  // CP-1 (D14) left this capture unchanged: none of these 240 crew draws the exclusive pool, so no pick changed name.
  // The exclusive picks are pinned over 10,000 crew in crewGenerationDraws.test.ts.
  it("transport: the next 20 deliveries for a fixed seed", () => {
    const out: string[] = [];
    for (let w = 1; w <= 20; w += 1) {
      const batch = transportBatch(0x7ea5e, w, TRANSPORT_BATCH_SIZE);
      expect(totalCrew(batch)).toBe(TRANSPORT_BATCH_SIZE);
      expect(batch.some((b) => b.buff2Id !== null && b.buff2Id.startsWith("excl."))).toBe(false);
      out.push(hash(batch));
    }
    expect(out).toEqual(GOLDEN.transport);
  });

  it("structure: commandStructureForHull for every hull", () => {
    const out = HULLS.map((hull) => `${hull}:${hash(commandStructureForHull(hull))}`);
    expect(out).toEqual(GOLDEN.structure);
  });
});

// ===== CP-2: the "turn it off" proof =====
//
// CP-2 (ship-side complement buffs) makes six keys act (Damage Control, Mission Turnaround, Crew Output Multiplier,
// Crew Effectiveness, and the Earth-born and Stheni racials) and splits Fast Departure / Fast Return onto their own
// legs (OC-E5). The fixtures that carry those keys (the full sheets; the three mission ships, which take transport
// crew mid-run) therefore move. This block switches exactly those effects OFF (each buff's and racial's catalog
// magnitude set to 0 for the duration of one call; nothing else touched) and pins the hashes the fixtures give with
// the switch off. These were captured on the code BEFORE the CP-2 engine edit, so equality afterwards proves that
// the switched-off effects are the ONLY thing CP-2 moved.
// Captured before the CP-2 engine edit. The three mission captures equal GOLDEN's CP-1 pins: switching the transit
// buffs off moves nothing there (the window's transit crew never change a whole transit tick).
const CP2_OFF: Record<string, string | string[]> = {
  "sheet:full": [
    "generalFreighter:275f6a0f/c6260247",
    "prospectorHauler:c9f46e2c/8e4dc8f5",
    "prospectorRunner:b4331e48/8e4dc8f5",
    "prospectorMiner:44d9b113/8e4dc8f5",
    "destroyer:59911649/c5405a4f",
    "battleship:89c0863c/d6bbc514",
    "carrier:be4b06cd/d6bbc514",
    "orion:160a1e2c/8cad2218",
    "aurora:a3e518d3/8cad2218",
    "eir:a1ab019a/8cad2218",
  ],
  "mission:shortOreRun": "eb39cb91",
  "mission:surveyMineralAnomaly": "e84193a6",
  "mission:frontierSupplyRun": "f4b5648c",
};

describe("CP-2 turn it off: with the CP-2 effects switched off, every moved fixture is the pre-CP-2 capture", () => {
  it("sheet: every hull with a full complement", () => {
    // Captured before the inert racials too, so the Spacer racial's old key is restored (withRacialsOff).
    const full = withRacialsOff(() => withCp2Off(() => HULLS.map((hull) => `${hull}:${sheetHashes(hull, fullComplement(hull))}`)), { droneAndSurvey: false });
    expect(full).toEqual(CP2_OFF["sheet:full"]);
  });

  for (const key of ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]) {
    it(`mission ${key}`, () => {
      // OC-11 (CP-8): these were captured with the mission ship crewed mid-run, so the OC-11 pause is switched off.
      expect(withOc11Off(() => withCp2Off(() => hash(missionRun(key))))).toBe(CP2_OFF[`mission:${key}`]);
    });
  }

  it("the switch restores every magnitude it touched", () => {
    const before = JSON.stringify([CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE, CREW_RACES]);
    withCp2Off(() => 0);
    expect(JSON.stringify([CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE, CREW_RACES])).toBe(before);
  });
});

// ===== OC-11 "Pause while out": offline runs with a passive ship that is out =====
//
// Captured on the code BEFORE the OC-11 engine edit (user 2026-10-16, "Pause while out (Recommended)": auto-crew does
// not fill a passive ship while it is crew-locked, crewLock.ts shipCrewLocked). Each fixture runs OFFLINE through
// tick() (one economyTick(_, 1) per second) across two transport windows and checks that the same span stepped live
// gives the same state:
//   expedition : a passive ship on an unclaimed Ground Ops expedition, then the claimed state one tick later.
//   patrol     : a passive carrier on a Repeat patrol (out the whole span).
//   home       : the control, a passive ship idle at home (it fills; OC-11 must not move it).
const OC11_SPAN = 2 * TRANSPORT_WINDOW_SECONDS;
const OC11_START = TRANSPORT_WINDOW_SECONDS - 100;

function offlineAndLive(s0: GameState, rngOf: () => () => number): GameState {
  const offline = tick(OC11_SPAN, s0, rngOf());
  let live = s0;
  const rng = rngOf();
  for (let i = 0; i < OC11_SPAN; i++) live = economyTick(live, 1, rng);
  expect(hash(offline), "offline == live").toBe(hash(live));
  return offline;
}

function oc11Expedition(): { out: GameState; claimedNext: GameState } {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: MEDIC_SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: 0x1234, gameTimeSeconds: OC11_START });
  // The CP-0 Ground Ops dispatch shape (before enemy ranks and the safe first run), so the run reaches claim. G2-2 (merged
  // alongside CP-8): the console names and region fields stripped too, so the pins captured before G2-2 hold.
  const res = asPreG2NamesDispatch(asPreSafeFirstRunsDispatch(asPreRanksDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id))));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const out = offlineAndLive(res.next, () => lcg(0x0c11));
  expect(out.expeditions).toHaveLength(1);
  const done = advanceExpedition(out.expeditions[0], FINAL);
  const claim = claimExpedition({ ...out, expeditions: [done] }, done.id);
  expect(claim.success, `${done.phase} ${JSON.stringify((claim as { reason?: unknown }).reason)}`).toBe(true);
  return { out, claimedNext: economyTick(claim.next, 1, lcg(0x0c12)) };
}

function oc11Patrol(): GameState {
  const base = freshState();
  const st = installMissingCombatBaselines({ ...base, credits: new Decimal(100000), gameTimeSeconds: OC11_START, ships: base.ships.map((sh) => ({ ...sh, typeKey: "carrier" as ShipTypeKey })) });
  const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(st, 1, "crimsonReaverSweep", "balanced", true));
  expect(r.success).toBe(true);
  const out = offlineAndLive(r.next, () => () => 0.5);
  expect(out.captains[0].mission).not.toBeNull();
  return out;
}

function oc11Home(): GameState {
  const out = offlineAndLive({ ...freshState(), gameTimeSeconds: OC11_START }, () => lcg(0x0c13));
  // The freighter takes what its division caps allow from the two windows' crew; the rest waits in the pool.
  expect(totalCrew(out.ships[0].complement!.buckets) + totalCrew(out.crewPool)).toBe(2 * TRANSPORT_BATCH_SIZE);
  expect(totalCrew(out.ships[0].complement!.buckets)).toBeGreaterThan(0);
  return out;
}

// Captured before the OC-11 engine edit (commit "test(0.14.0): OC-11 goldens ..."); reproduced with the pause off.
const OC11_BEFORE: Record<string, string | string[]> = {
  expedition: ["899d6dce", "a1ddd4d6"],
  patrol: "ac3dfb63",
  home: "c0ba84ba",
};
// Re-pinned by OC-11: the ship that is out takes no crew; the expedition ship fills on the first tick after its claim.
// The home control does not move.
const OC11_GOLDEN: Record<string, string | string[]> = {
  expedition: ["e0286113", "a96b26cf"],
  patrol: "9864e5f5",
  home: "c0ba84ba",
};

const aboard = (s: GameState): number => totalCrew(s.ships[0].complement?.buckets ?? []);

describe("OC-11 goldens: offline runs with a passive ship that is out", () => {
  it("expedition: a passive ship on an unclaimed expedition across two transport windows, then claimed", () => {
    const { out, claimedNext } = oc11Expedition();
    expect(out.lastTransportWindow).toBe(2);
    // Paused while out: both windows' crew wait in the pool; the first tick after the claim crews the ship.
    expect(aboard(out)).toBe(0);
    expect(totalCrew(out.crewPool)).toBe(2 * TRANSPORT_BATCH_SIZE);
    expect(aboard(claimedNext)).toBeGreaterThan(0);
    expect([hash(out), hash(claimedNext)]).toEqual(OC11_GOLDEN.expedition);
    const before = withOc11Off(() => oc11Expedition());
    expect(aboard(before.out)).toBeGreaterThan(0);
    expect([hash(before.out), hash(before.claimedNext)]).toEqual(OC11_BEFORE.expedition);
  });

  it("patrol: a passive carrier on a Repeat patrol across two transport windows", () => {
    const out = oc11Patrol();
    expect(out.lastTransportWindow).toBe(2);
    expect(aboard(out)).toBe(0);
    expect(totalCrew(out.crewPool)).toBe(2 * TRANSPORT_BATCH_SIZE);
    expect(hash(out)).toBe(OC11_GOLDEN.patrol);
    // Captured before the inert racials too: without the pause the transport crew board the carrier mid-run, and its
    // next relaunch freezes their Deck Handling and Belter racials (0.14.0), so those are switched off here.
    const before = withRacialsOff(() => withOc11Off(() => oc11Patrol()));
    expect(aboard(before)).toBeGreaterThan(0);
    expect(hash(before)).toBe(OC11_BEFORE.patrol);
  });

  it("home: the control, a passive ship idle at home (fills either way)", () => {
    expect(hash(oc11Home())).toBe(OC11_GOLDEN.home);
    expect(hash(withOc11Off(() => oc11Home()))).toBe(OC11_BEFORE.home);
  });
});
