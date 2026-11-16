// GEAR WEAR step 1 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md sections 10 and 11): golden hashes captured on
// the code BEFORE any gear wear engine edit (the CP-0 / FK-3 / G2-0 / SF-0 / WR-4 pattern). They cover what the
// later wear steps are EXPECTED to move, on CRAFTED gear (quality above 0, so toughness, the quality-scaled pools and
// every rolled line are in play), so each later move is explained in its own commit:
//
//   mission:<key> : a crafted-loadout freighter on a mission's repeating cycles, 3,600 economyTick seconds (the
//                   state at 1,200, 2,400 and 3,600 s). Step 3 moves these (cargo, FTL, reactor, crew module and
//                   sensor use wear, and their efficiency from the second cycle).
//   patrol:<hull> : a crafted-loadout destroyer (Sweep) and carrier (Warband) on a Repeat patrol, 2,400 s: the
//                   dispatch record, the display replay every 300 s and the final state. Step 4 moves these (true
//                   condition pools, battle wear, the reactor and FTL from the installed piece).
//   expedition    : a Ground Ops run of a crafted-loadout Orion whose members wear crafted member gear (armor,
//                   weapon, tool, implant), through claim. Steps 3 and 4 move it (member gear, sensor, plating).
//   repair        : a damaged crafted destroyer's Shipyard repair with a crafted spare in storage, run to completion.
//                   Step 3 moves it only through the gear (the hull repair itself stays its own system, user W6).
//   Step 3 added (captured on the pre-wear engine BEFORE the step 3 engine, 2026-10-21):
//   mission:frontierSupplyRun : a transport mission's repeating cycles (the haul wear on a run that loads supplies).
//   shortRange    : a crafted freighter's short-range Repeat run (the G1-4 cycle engine's wear seam), 3,600 s.
//
// Steps 1 and 2 (this slice: the catalogs, the pure helpers, the condition field that replaces the retired
// `durability`, the v70 migration step) must move NONE of these: every piece is pristine and no wear source is wired.
// Hashes go through goldenJson (firstRunsGoldens.fixture.ts), which puts the retired field back on a pristine piece,
// so the field swap itself is invisible here and only a real behavior change can move a pin.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// FR-C lane 1 M5 / M6 (Never discard: deliveries land in full, a load trims nothing) came after every pin here: the file
// runs with it off (neverDiscardSwitch.fixture.ts), so its pins keep proving their own slice; neverDiscard.test.ts pins
// the move.
import { neverDiscardOffForThisFile } from "./neverDiscardSwitch.fixture";
neverDiscardOffForThisFile();
// Gear wear close-out (2026-11-11: "Make it exact", "Keep the bay rate") came after every pin here: the file runs with it
// off (gearWearCloseoutSwitch.fixture.ts), so its pins keep proving their own slice (gearWearCloseoutGoldens.test.ts and
// gearWearCloseout.test.ts pin and prove what the close-out moved: leftover underway seconds at a run's end, a repair
// pause's or a field repair leg's edges credited at the rate that applied; gear keeping the bay rate until full).
import { gearWearCloseoutOffForThisFile, withCloseoutOn } from "./gearWearCloseoutSwitch.fixture";
gearWearCloseoutOffForThisFile();
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
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import {
  EQUIPMENT_SLOTS,
  MISSIONS,
  freshState,
  isMemberSlotType,
  type AwayMember,
  type AwayTeamType,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type MissionKey,
  type PatrolKey,
  type PatrolMissionState,
  type ShortRangeMissionState,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, recallCaptain, shipRepairDurationTicks } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { generateDronePod, generateEquipment, generateWeapon } from "./itemgen";
import { equippedFor } from "./equipment";
import { officerRepairSpeedBonus } from "./crewOverlay";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { asPreRanksDispatch, asPreSafeFirstRunsDispatch, plainAwayMember, withSlottedAwayTeams, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { withSiMemberGearOff } from "./siMemberGearSwitch.fixture";
import { shortRangeBoardSlots, shortRangeNextCycle, startShortRangeCycle } from "./shortRangeBoard";
import { pieceCondition } from "./gearWear";
import { emptyWearEvents, recordExpeditionWear, resolveGearWear, runWearStamp } from "./gearWearEngine";
import { withGearWearOff } from "./gearWearSwitch.fixture";
import { afterExpeditionTraining } from "./wiring/wearProbes";
// Gear wear step 4 (0.14.0): the combat half moves the patrol pins and the ordinary expedition's (its battle stamp, its
// battles and armor wear); with the battle sources off (battleWearSwitch.fixture.ts) each reproduces its capture, and
// the step 4 table below pins them with battle wear on.
import { withBattleWearOff } from "./battleWearSwitch.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";
import { wr9OffForThisFile } from "./wr9Switch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about gear wear;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
combatRulesOffForThisFile();
// E-MOD EM-4 (0.14.0): every pin here was taken before the reactor surplus drive lift, and the crafted freighter flies
// a crafted Reactor Core, so its legs move with the lift by design (emodEm4Goldens.test.ts pins the lift). The file
// runs with the lift off, so its pins keep proving the wear engine and nothing else.
import { reactorLiftOffForThisFile } from "./emodEm4Switch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { gatheringTrainingOffForThisFile } from "./gatheringTrainingSwitch.fixture";
reactorLiftOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
// Safe first runs SF-7 came after every pin here and spares a fresh save's first gathering delivery its wear: the file
// dispatches as before SF-7 (gatheringTrainingSwitch.fixture.ts), so its pins keep proving the wear engine alone
// (SF-7's own moves are pinned in gatheringTrainingWearGoldens.test.ts).
gatheringTrainingOffForThisFile();
// E5-2 (Refugee Posts) came after every pin here: its short-range runs fly a fresh board, which now draws the
// Evacuation overlay. The file draws the seven-template board (evacuationDrawSwitch.fixture.ts), so its pins keep proving
// their own slice (E5-2's moves: refugeeGoldens.test.ts and refugeeArrival.test.ts).
import { evacuationDrawOffForThisFile } from "./evacuationDrawSwitch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): Resume when safe (lane 4 I1, PATROL_RESUME_WHEN_SAFE_SWITCH: a Repeat repair pause ends once
// the next route is safe, not at full) moves the wear4 carrier Repeat Warband row's pause; and the pause's docked
// pricing (lane 4 M6, PAUSE_JOB_LIKE_DOCKED_SWITCH: a repair pause records the docked job's length for its Overtime)
// moves the same pause's record. The pins here predate the round and are about another slice, so the file runs with
// those fixes off (fixRoundESwitch.fixture.ts); every other fix of the round runs here. The round's own pins:
// patrolFixRoundE.test.ts.
fixRoundESwitchesOffForThisFile("resumeWhenSafe", "pauseJobLikeDocked");
homeworldReserveOffForThisFile();
evacuationDrawOffForThisFile();

// ===== shared helpers =====

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

// A captain senior enough for every mission the fixtures fly.
function levelled(s: GameState, level: number): GameState {
  return { ...s, captains: s.captains.map((c) => ({ ...c, level })) };
}

function onHull(s: GameState, typeKey: ShipTypeKey): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)) };
}

const CRAFTED_QUALITY = 3;
const CRAFTED_ILEVEL = 30;

// One crafted piece standing in for `like` (same slot, same weapon type / drone role / variety), minted through the
// real generators at quality CRAFTED_QUALITY with a seeded stream. Null for a slot nothing generates.
function craftedLike(like: EquipmentInstance, id: string, seed: number): EquipmentInstance | null {
  const common = {
    blueprintKey: null,
    iLevel: CRAFTED_ILEVEL,
    quality: CRAFTED_QUALITY,
    rarity: "augmented" as const,
    ascension: "none" as const,
    rng: lcg(seed),
    allocateId: () => id,
  };
  if (like.slotType === "weapon" && like.weaponType) return generateWeapon({ weaponType: like.weaponType, ...common });
  if (like.slotType === "droneBay" && like.droneRole) return generateDronePod({ droneRole: like.droneRole, ...common });
  const slot = EQUIPMENT_SLOTS[like.slotType];
  if (!slot) return null;
  return generateEquipment({ slotType: like.slotType, varietyKey: like.moduleVariant ?? slot.varieties[0].key, ...common });
}

// ship-1 with every Standard-Issue piece swapped for a crafted twin, in place (array order kept).
function craftedLoadout(s: GameState): GameState {
  const base = installMissingCombatBaselines(s);
  let n = 0;
  const equipment = base.equipment.map((e) => {
    if (e.fittedToShipId !== "ship-1") return e;
    n += 1;
    const p = craftedLike(e, `gw-${e.slotType}-${n}`, 0x9e37 + n * 7919);
    return p ? { ...p, fittedToShipId: "ship-1" } : e;
  });
  return { ...base, equipment };
}

// One crafted member piece of `slotType` worn by `memberId` (the first variety the member's squad may wear).
function memberPiece(slotType: EquipmentSlotType, team: AwayTeamType, memberId: string, seed: number): EquipmentInstance {
  const v = EQUIPMENT_SLOTS[slotType].varieties.find((x) => x.member?.teamTypes.includes(team));
  if (!v) throw new Error(`no ${team} variety for ${slotType}`);
  const p = generateEquipment({
    slotType,
    varietyKey: v.key,
    blueprintKey: null,
    iLevel: CRAFTED_ILEVEL,
    quality: CRAFTED_QUALITY,
    rarity: "augmented",
    ascension: "none",
    rng: lcg(seed),
    allocateId: () => `gw-${memberId}-${slotType}`,
  });
  return { ...p, fittedToShipId: null, fittedToMemberId: memberId };
}

const MEMBER_SLOTS = (Object.keys(EQUIPMENT_SLOTS) as EquipmentSlotType[]).filter((k) => isMemberSlotType(k));

function wearAll(s: GameState, member: AwayMember, seed: number): GameState {
  const pieces = MEMBER_SLOTS.flatMap((slot, i) => {
    const has = EQUIPMENT_SLOTS[slot].varieties.some((x) => x.member?.teamTypes.includes(member.teamType));
    return has ? [memberPiece(slot, member.teamType, member.id, seed + i * 131)] : [];
  });
  return { ...s, equipment: [...s.equipment, ...pieces] };
}

// ===== the goldens =====

// Re-pinned at the merge of feat/crew-0.14.0 (adb41c6): re-captured with GW_CAPTURE on adb41c6's engine, BEFORE any
// wear edit, and the merged tree (steps 1 and 2 in) reproduces that capture byte for byte, so the wear code moved
// nothing. What moved since the a678241 capture is feat's own slices between the two (the mission states from 2,400 s,
// the two patrols' final states, the expedition's dispatch, mid-run and done records); the repair pin did not move.
const GOLDEN: Record<string, string[]> = {
  "mission:shortOreRun": ["21b85cb7", "1200:64fc45f5", "2400:3f500d35", "3600:15e2b4a3"],
  "mission:longOreRun": ["38dbe313", "1200:b536cb7a", "2400:8bdcf7f3", "3600:fad87931"],
  "mission:forageFlora": ["f95fa7c8", "1200:edc9a409", "2400:6f443d6d", "3600:9a972c26"],
  "mission:salvageWreckage": ["9bcbc254", "1200:19ed1260", "2400:e9e7f8ca", "3600:f8a61a79"],
  "mission:surveyStellarPhenomena": ["9207f56", "1200:b8487de0", "2400:6c3783af", "3600:a33bd117"],
  // Step 3 extension, captured on f85ef73's pre-wear engine (2026-10-21).
  "mission:frontierSupplyRun": ["94e8217", "1200:897bc9fe", "2400:9e01bb31", "3600:cc96ceed"],
  shortRange: ["535cfb8c", "1200:25d2f6f0", "2400:5d5e8fc7", "3600:2aa60ffa"],
  "patrol:destroyer": ["df281090", "41b55c24", "731fc751", "3a1135fd", "92180bc6", "9abcca38", "547853f2", "6aa52fe6", "2d46ee23", "relaunches:171", "ce0659d4"],
  "patrol:carrier": ["f2dbd51e", "b7be39fe", "c99eeca3", "eaf74e1d", "217b95ce", "ef5b9b1a", "4ee7feac", "d70905a2", "492504ed", "relaunches:109", "b1299dba"],
  "expedition": ["6cce6560", "4e64f0fc", "7e1768ae", "91990378"],
  "repair": ["176", "965b8aa9", "16ec551b"],
};

const MISSION_FIXTURES: readonly MissionKey[] = ["shortOreRun", "longOreRun", "forageFlora", "salvageWreckage", "surveyStellarPhenomena"];
// Step 3 extension (captured on the pre-wear engine, 2026-10-21): a TRANSPORT mission's repeating cycles (the
// cargo bay's haul wear on a run that loads supplies) and a short-range Repeat run (the G1-4 cycle engine's wear
// seam, shortRangeCycleWear), both on the crafted loadout.
const STEP3_MISSION_FIXTURES: readonly MissionKey[] = ["frontierSupplyRun"];
const MAX_UNLOCK = Math.max(...Object.values(MISSIONS).map((m) => m.unlockLevel));
const PATROL_FIXTURES: readonly [ShipTypeKey, PatrolKey][] = [
  ["destroyer", "crimsonReaverSweep"],
  ["carrier", "crimsonReaverWarband"],
];

// A crafted `hull` on a Repeat `route` (its first cycle the training cycle, read without its curve stamp), 2,400 s:
// the dispatch record, the display replay every 300 s, the relaunch count and the final state.
function patrolRun(hull: ShipTypeKey, route: PatrolKey): { out: string[]; s: GameState } {
  const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(craftedLoadout(onHull(freshState(), hull)), 1, route, "balanced", true));
  expect(r.success).toBe(true);
  let s = r.next;
  const out = [hash(s.captains[0].mission)];
  let relaunches = 0;
  let prev = (s.captains[0].mission as PatrolMissionState).phase;
  for (let i = 1; i <= 2400; i++) {
    s = economyTick(s, 1, () => 0.5);
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m === null) break;
    if (prev === "transitBack" && m.phase === "transitOut") relaunches += 1;
    prev = m.phase;
    if (i % 300 === 0) out.push(hash(replayPatrol(s, s.captains[0])));
  }
  out.push(`relaunches:${relaunches}`, stateHash(s));
  return { out, s };
}

// A crafted freighter dispatched on `key` (Repeat), 3,600 s in 1,200 s marks: the dispatch record and the states.
function missionRun(key: MissionKey): { out: string[]; s: GameState } {
  const r = dispatchCaptainOnMission(craftedLoadout(levelled(freshState(), 10)), 1, key);
  expect(r.success, `${key}: ${r.reason}`).toBe(true);
  const out = [hash(r.next.captains[0].mission)];
  let s = r.next;
  const rng = lcg(0x6ea2);
  for (const mark of [1200, 2400, 3600]) {
    s = runTicks(s, 1200, rng);
    out.push(`${mark}:${stateHash(s)}`);
  }
  return { out, s };
}

// A crafted freighter on the board's first short-range slot (Mission Control at its highest unlock, so the slot
// exists), Repeat, 3,600 s: the first cycle record and the state at 1,200, 2,400 and 3,600 s. The run is started
// through the board's one cycle-start seam (startShortRangeCycle, what the dispatch calls) with the sheet gate skipped
// (the shortRangeGoldens precedent): the crafted freighter has no guest quarters or crew ratings, and the sheet is not
// what this golden is about. `stamped`: with the wear flag a dispatch gives it (gearWearEngine.ts runWearStamp).
function shortRangeRun(stamped: boolean): { out: string[]; s: GameState } {
  const base = craftedLoadout(levelled(freshState(), 10));
  const s0: GameState = {
    ...base,
    credits: new Decimal(1_000_000),
    facilities: { ...base.facilities, missionControl: { ...base.facilities.missionControl, level: MAX_UNLOCK } },
  };
  const slot = shortRangeBoardSlots(s0)[0];
  const wear = stamped ? runWearStamp(s0, "ship-1") : undefined;
  const start = startShortRangeCycle(s0, s0.ships[0], slot, shortRangeNextCycle(s0, slot.id), wear, true);
  const mission: ShortRangeMissionState = {
    kind: "shortRange",
    slotId: slot.id,
    roll: start.roll,
    plan: start.plan,
    phase: "transitOut",
    phaseProgressTicks: 0,
    recalled: false,
    ...(wear ? { gearWear: wear } : {}),
  };
  const next: GameState = { ...s0, captains: s0.captains.map((c, i) => (i === 0 ? { ...c, mission } : c)), runCounts: start.runCounts };
  const out = [hash(next.captains[0].mission)];
  let s = next;
  const rng = lcg(0x5e3a);
  for (const mark of [1200, 2400, 3600]) {
    s = runTicks(s, 1200, rng);
    out.push(`${mark}:${stateHash(s)}`);
  }
  return { out, s };
}

// A crafted Orion whose three members wear crafted member gear on a Ground Ops run, through claim: the dispatch
// record, the state after 40 s, the finished run and the claimed state. `ordinary`: the ship's training run is behind
// it (so this run is wear-stamped); otherwise it is its first expedition, the training run.
function expeditionRun(ordinary: boolean): { out: string[]; claimed: GameState } {
  const squad: AwayMember[] = [
    { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
    { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2 },
    plainAwayMember("member-11", "science", "ship-1"),
  ];
  let s0 = craftedLoadout(onHull({ ...freshState(), awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0x4ea2 }, "orion"));
  squad.forEach((m, i) => {
    s0 = wearAll(s0, m, 0x51 + i * 977);
  });
  s0 = withSlottedAwayTeams(s0);
  if (ordinary) s0 = afterExpeditionTraining(s0);
  expect(s0.equipment.filter((e) => e.fittedToMemberId).length).toBeGreaterThan(5);
  const res = asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  expect(res.expedition.gearWear !== undefined, "the stamp follows the training run").toBe(ordinary);
  let s = res.next;
  for (let i = 0; i < 40; i++) s = economyTick(s, 1, lcg(0x4e));
  const done = advanceExpedition(s.expeditions[0], 2_000_000);
  expect(done.phase).toBe("complete");
  // The run comes home through the engine's own tail (the wear it took applies as it lands, gearWearEngine.ts). The
  // ordinary run is claimed the instant it lands (its gear still worn); the training run at 2,000,000 s, as captured.
  const home: GameState = { ...s, expeditions: [done], gameTimeSeconds: ordinary ? done.phaseAnchorSeconds : 2_000_000 };
  const events = emptyWearEvents();
  recordExpeditionWear(s, home, events);
  const landed = resolveGearWear(s, home, events);
  const claim = claimExpedition(landed, done.id);
  expect(claim.success).toBe(true);
  return { out: [hash(res.expedition), stateHash(s), hash(done), stateHash(claim.next)], claimed: claim.next };
}

// Ship-1's pieces as `slot=condition` (the wear pins name what wore, not only a hash).
function conditions(s: GameState): string {
  return s.equipment
    .filter((e) => e.fittedToShipId === "ship-1" || e.fittedToMemberId)
    .map((e) => `${e.slotType}=${pieceCondition(e)}`)
    .join(" ");
}

// GW_CAPTURE = an output path: record every pin instead of asserting, and write them there (the G1_CAPTURE pattern),
// so a slice that moves a pin on purpose can re-capture on the engine before it and diff the record.
const CAPTURE = Boolean(import.meta.env.GW_CAPTURE);
const captured: Record<string, string[]> = {};
function pin(key: string, value: string[]): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(GOLDEN[key]);
}

describe("gear wear step 1 goldens (captured before any wear engine edit)", () => {
  it("the crafted loadout really is crafted (vacuity guard)", () => {
    const s = craftedLoadout(freshState());
    const gear = equippedFor(s, "ship-1");
    expect(gear.length).toBeGreaterThan(3);
    for (const g of gear) expect(g.quality, g.slotType).toBe(CRAFTED_QUALITY);
  });

  // Step 3 MOVES these (a dispatched mission is stamped, and each delivered cycle wears its gear by use): with the use
  // sources switched off (gearWearSwitch.fixture.ts) each reproduces its step 1 capture byte for byte, which proves
  // the move is the wear alone; the wear-on runs are pinned below (step 3 goldens).
  for (const key of [...MISSION_FIXTURES, ...STEP3_MISSION_FIXTURES]) {
    it(`mission:${key}: a crafted freighter's repeating cycles over 3,600 s (use sources off)`, () => {
      pin(`mission:${key}`, withGearWearOff(() => missionRun(key).out));
    });
  }

  // Step 3 extension: a crafted freighter on the board's first short-range slot (shortRangeRun, below), UNSTAMPED: a run
  // dispatched before step 3 reads its gear as before and wears nothing, so this pin holds with the use sources ON.
  it("shortRange: a crafted freighter's short-range Repeat run over 3,600 s (unstamped: as before step 3)", () => {
    pin("shortRange", shortRangeRun(false).out);
  });

  // Step 4 MOVES these (from the first relaunch every cycle is stamped and fights its carried wear): with the battle
  // sources off each reproduces its capture; the step 4 table pins the wear-on runs.
  for (const [hull, route] of PATROL_FIXTURES) {
    it(`patrol:${hull}: a crafted ${hull} on a Repeat ${route} over 2,400 s, with the display replay (battle sources off)`, () => {
      pin(`patrol:${hull}`, withBattleWearOff(() => patrolRun(hull, route).out));
    });
  }

  // The D26 line swap (0.14.0, Standard-Issue member gear review) changed the Science Sidearm's and Field Suit's lines,
  // which this fixture's Science member wears: it is built with the pre-swap catalog (siMemberGearSwitch.fixture.ts),
  // so the pin keeps proving gear wear moved nothing (siMemberGearGoldens.test.ts pins the swap's own moves). It is the
  // ship's first expedition, its TRAINING run: no wear on training (user W9), so it holds with the use sources ON.
  it("expedition: a crafted Orion and members in crafted member gear, Ground Ops through claim (the training run)", () =>
    withSiMemberGearOff(() => pin("expedition", expeditionRun(false).out)));

  it("repair: a damaged crafted destroyer's Shipyard repair, a crafted spare in storage, run to completion", () => {
    const base = craftedLoadout(onHull(freshState(), "destroyer"));
    const spareLike = base.equipment.find((e) => e.fittedToShipId === "ship-1" && e.slotType === "cargoBay")!;
    const spare = { ...craftedLike(spareLike, "gw-spare-cargo", 0x5ba2)!, fittedToShipId: null };
    const s0: GameState = {
      ...base,
      ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 311 } : sh)),
      equipment: [...base.equipment, spare],
    };
    const ship = s0.ships[0];
    const ticks = shipRepairDurationTicks(ship, equippedFor(s0, ship.id), officerRepairSpeedBonus(s0, ship));
    const started = processShipRepairs(s0);
    expect(started.activeProcesses.some((p) => p.kind === "shipRepair")).toBe(true);
    const done = runTicks(started, ticks + 2, lcg(0x2e9a));
    expect(done.ships[0].damaged).toBeUndefined();
    pin("repair", [String(ticks), hash(started.activeProcesses), stateHash(done)]);
  });
});

// ===== step 3: the use wear engine ON (captured 2026-10-21 on the step 3 engine; each pin names the pieces' conditions) =====
//
// What moved, and why (every move is the wear alone: the step 1 pins above reproduce with the use sources off):
//   wear:mission:<key> : the dispatch record carries the run's wear stamp (gearWear), and each delivered cycle wears
//                        the hold (a haul), the drive (light-years), the reactor (minutes underway) and, on a survey,
//                        the sensor array; each cycle start re-reads the gear (user 2026-10-21, "Re-read each
//                        cycle"), so from cycle 2 the run folds its own wear (re-pinned for that rule: the states from
//                        1,200 s moved, the dispatch records and the final conditions did not).
//   wear:shortRange    : the same on a stamped short-range run (its training cycles wear nothing, W9; re-pinned for
//                        the re-read rule like the missions).
//   wear:expedition    : an ordinary (not training) run: the stamp, the ground tally (fights, fieldwork steps), and
//                        the ship's and the members' gear worn as the run comes home.
//   wear:recovery      : the worn freighter recalled and home: its gear recovers on its own, free, back to pristine.
//   wear:redispatch    : dispatched again while still worn: the new run freezes the worn gear and folds it (a smaller
//                        effective hold, a slower drive), so ITS cycles move. Both re-pinned for the re-read rule (the
//                        run they follow moved).
const STEP3: Record<string, string[]> = {
  "wear:mission:shortOreRun": ["a0f89ec2", "1200:70ec333b", "2400:efa6237d", "3600:303bc515", "cargoBay=995 ftlDrive=997 reactorCore=992 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:longOreRun": ["bd383776", "1200:15cb498b", "2400:6dc15ba7", "3600:ecb16b18", "cargoBay=995 ftlDrive=992 reactorCore=987 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:forageFlora": ["28b8807b", "1200:cf9d1652", "2400:4e0e7a36", "3600:1a82ecf5", "cargoBay=995 ftlDrive=994 reactorCore=989 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:salvageWreckage": ["fa78484f", "1200:2ba5d6c1", "2400:10d313f5", "3600:744aa9b", "cargoBay=995 ftlDrive=995 reactorCore=990 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:surveyStellarPhenomena": ["7f9da665", "1200:526b50d2", "2400:6b4bc818", "3600:41948f27", "cargoBay=995 ftlDrive=989 reactorCore=985 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  // The transport's working capital never clears on this fixture's credits, so no cycle delivers: only the stamp moves.
  "wear:mission:frontierSupplyRun": ["58c67fe2", "1200:da9b815f", "2400:8de2ab4a", "3600:1bdedd34", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:shortRange": ["734a5077", "1200:9084f5b1", "2400:41a58fd0", "3600:4d44e491", "cargoBay=995 ftlDrive=995 reactorCore=994 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:expedition": ["595d66cd", "aeafb99f", "c9b0db4b", "f7a4e36", "cargoBay=1000 ftlDrive=1000 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=963 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=963 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=907 implant=1000"],
  "wear:redispatch": ["75bc53bf", "833bc007", "cargoBay=995 ftlDrive=997 reactorCore=992 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:recovery": ["cargoBay=1000 ftlDrive=997 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000", "a3490fab"],
};

function pin3(key: string, value: string[]): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(STEP3[key]);
}

describe("gear wear step 3 goldens (the use wear engine on)", () => {
  for (const key of [...MISSION_FIXTURES, ...STEP3_MISSION_FIXTURES]) {
    it(`wear:mission:${key}: the same run with the use sources on`, () => {
      const run = missionRun(key);
      pin3(`wear:mission:${key}`, [...run.out, conditions(run.s)]);
    });
  }

  it("wear:shortRange: the same short-range run, stamped as a dispatch stamps it", () => {
    const run = shortRangeRun(true);
    pin3("wear:shortRange", [...run.out, conditions(run.s)]);
  });

  it("wear:expedition: the crafted Orion's ordinary run (its training run behind it), through claim (battle sources off)", () =>
    withSiMemberGearOff(() =>
      withBattleWearOff(() => {
        const run = expeditionRun(true);
        pin3("wear:expedition", [...run.out, conditions(run.claimed)]);
      }),
    ));

  it("wear:recovery and wear:redispatch: the worn freighter recalled and home, then dispatched again while still worn", () => {
    const rows = recoveryRows();
    pin3("wear:redispatch", rows["wear:redispatch"]);
    pin3("wear:recovery", rows["wear:recovery"]);
  });

  // Gear wear close-out (2026-11-11), the same run with the close-out ON (this file runs with it off: the test above is
  // the switch-off reproduction). Both rows move, by "Make it exact": the recalled run's end credits its leftover
  // underway seconds at the underway rate (the old pass credited up to 30 of them at the home rate), so the landed hold
  // and reactor read lower (994 and 988, were 1000), the redispatched run freezes it lower, and the six docked seconds start from there.
  // GWCLOSE_ON_CAPTURE = an output path: write the rows there instead of asserting.
  it("close-out ON: wear:recovery and wear:redispatch move as named", () => {
    const rows = withCloseoutOn(recoveryRows);
    if (import.meta.env.GWCLOSE_ON_CAPTURE) {
      writeFileSync(String(import.meta.env.GWCLOSE_ON_CAPTURE), JSON.stringify(rows, null, 1));
      return;
    }
    expect(rows).toEqual(CLOSEOUT_ON_RECOVERY);
  });
});

const CLOSEOUT_ON_RECOVERY: Record<string, string[]> = {
  "wear:redispatch": ["b8bfa2b9", "6a37a27b", "cargoBay=995 ftlDrive=997 reactorCore=992 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:recovery": ["cargoBay=994 ftlDrive=997 reactorCore=988 specUtility=994 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000", "cargoBay=998 ftlDrive=1000 reactorCore=992 specUtility=998 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000", "a3490fab"],
};

// The worn freighter recalled and home, then dispatched again while still worn (wear:redispatch), and left at home
// instead (wear:recovery).
function recoveryRows(): Record<string, string[]> {
  {
    let s = missionRun("shortOreRun").s;
    s = recallCaptain(s, 1).next;
    const rng = lcg(0x7ec0);
    for (let i = 0; i < 2000 && s.captains[0].mission !== null; i++) s = economyTick(s, 1, rng);
    expect(s.captains[0].mission).toBeNull();
    const landed = conditions(s);
    // Dispatched again the moment it lands: the run freezes its worn gear (the stamp's `frozen`) and folds it.
    const redispatch = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(redispatch.success).toBe(true);
    let r = redispatch.next;
    const m = r.captains[0].mission;
    expect(m !== null && m.kind === "extraction" && Object.keys(m.gearWear?.frozen ?? {}).length > 0).toBe(true);
    const record = hash(m);
    r = runTicks(r, 1200, rng);
    const redispatchRow = [record, stateHash(r), conditions(r)];
    // Left at home instead: a few seconds recover part of it, a minute all of it (40 per-mille a minute, free).
    s = runTicks(s, 6, rng);
    const afterSixSeconds = conditions(s);
    s = runTicks(s, 54, rng);
    expect(s.equipment.filter((e) => e.fittedToShipId === "ship-1").every((e) => e.condition === undefined)).toBe(true);
    return { "wear:redispatch": redispatchRow, "wear:recovery": [landed, afterSixSeconds, stateHash(s)] };
  }
}

// ===== step 4: the battle sources ON (captured 2026-10-27 on the step 4 engine; each pin names the pieces' conditions) =====
//
// What moved, and why (every move is the combat half alone: the pins above reproduce with the battle sources off):
//   wear4:patrol:<hull> : the first cycle is the training cycle (no wear, user W9); from the first relaunch every cycle
//                         is stamped (cycleStartCondition), fights its carried wear (its pools at their true condition,
//                         its shields, plating and pods at their efficiency) and wears its pieces in battle, so the
//                         replays from 300 s, the relaunch count where the carried wear tips a cycle, and the final state
//                         move. The crafted quality 3 pieces' toughness takes less per battle than Standard Issue.
//                         Pause to repair (user 2026-10-27): the carrier's Repeat pauses at home to repair its worn
//                         gear, so it relaunches fewer times in the span and ends with sound gear.
//                         Review 2026-10-27: re-checked after each resume (a pause that fell short pauses again).
//                         The trigger, user 2026-10-28 "from realism": it pauses only when the cycle about to fly
//                         would break a worn system (projectedCycleBreak), so the carrier flies its worn gear far
//                         longer (91 relaunches in the span, was 66) and ends worn (its drive at 54, shields at 49).
//   wear4:expedition    : the run's battle stamp, its ship battle snapshot (the reactor and drive copies, the flag), each
//                         ground fight's armor wear on the record and the tally, and the members' armor worn as it lands.
const STEP4: Record<string, string[]> = {
  "wear4:patrol:destroyer": ["df281090", "41b55c24", "731fc751", "3a1135fd", "92180bc6", "9abcca38", "547853f2", "6aa52fe6", "2d46ee23", "relaunches:171", "49504051", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear4:patrol:carrier": ["f2dbd51e", "ad0bb62e", "729473a3", "440d2809", "ca790797", "75ae48f9", "a88c075a", "f7e3405a", "f7e3405a", "relaunches:91", "92d112c5", "cargoBay=1000 ftlDrive=54 reactorCore=176 specUtility=1000 weapon=663 weapon=659 shieldEmitters=49 hullPlating=999 droneBay=985"],
  "wear4:expedition": ["82de7fe8", "e65a6c28", "5304ebc1", "142413e2", "cargoBay=1000 ftlDrive=1000 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=963 memberArmor=957 memberTool=1000 implant=1000 memberWeapon=963 memberArmor=995 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=907 implant=1000"],
};

function pin4(key: string, value: string[]): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(STEP4[key]);
}

describe("gear wear step 4 goldens (the battle sources on)", () => {
  for (const [hull, route] of PATROL_FIXTURES) {
    it(`wear4:patrol:${hull}: the same Repeat ${route} with battle wear on`, () => {
      const run = patrolRun(hull, route);
      pin4(`wear4:patrol:${hull}`, [...run.out, conditions(run.s)]);
    });
  }
  it("wear4:expedition: the crafted Orion's ordinary run with battle wear on, through claim", () =>
    withSiMemberGearOff(() => {
      const run = expeditionRun(true);
      pin4("wear4:expedition", [...run.out, conditions(run.claimed)]);
    }));
});

describe.runIf(CAPTURE)("gear wear capture (GW_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.GW_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
