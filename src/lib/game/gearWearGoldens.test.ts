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

import { describe, expect, it } from "vitest";
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
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();
// E-MOD EM-4 (0.14.0): every pin here was taken before the reactor surplus drive lift, and the crafted freighter flies
// a crafted Reactor Core, so its legs move with the lift by design (emodEm4Goldens.test.ts pins the lift). The file
// runs with the lift off, so its pins keep proving the wear engine and nothing else.
import { reactorLiftOffForThisFile } from "./emodEm4Switch.fixture";
reactorLiftOffForThisFile();

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
  "mission:shortOreRun": ["21b85cb7", "1200:fb90fbb2", "2400:1db8ec6f", "3600:4887c289"],
  "mission:longOreRun": ["38dbe313", "1200:5978da09", "2400:d997959c", "3600:5b482d7d"],
  "mission:forageFlora": ["f95fa7c8", "1200:fbe20294", "2400:e3c516bb", "3600:e2c76d7d"],
  "mission:salvageWreckage": ["9bcbc254", "1200:4a39fc85", "2400:5c45765f", "3600:d9a1be9f"],
  "mission:surveyStellarPhenomena": ["9207f56", "1200:df63ecd7", "2400:5988ea16", "3600:6e640802"],
  // Step 3 extension, captured on f85ef73's pre-wear engine (2026-10-21).
  "mission:frontierSupplyRun": ["94e8217", "1200:fbc123cc", "2400:e0198985", "3600:b6d17d08"],
  shortRange: ["9132088f", "1200:9a5d5c69", "2400:ea95ba49", "3600:c613b2c8"],
  "patrol:destroyer": ["df281090", "2ad61e28", "67264ecd", "77d4b235", "5e7e8bd2", "f99c2b34", "35f5a476", "4f7f026a", "9901051b", "relaunches:171", "a89174c6"],
  "patrol:carrier": ["f2dbd51e", "7ff99f8c", "c1929171", "58b10189", "138a5918", "143f8846", "ed7acf50", "d4ad7090", "ab2b97d9", "relaunches:109", "86e16f3d"],
  "expedition": ["4eaa82ad", "8f7e452f", "659f1289", "43e5954"],
  "repair": ["176", "965b8aa9", "a10053e8"],
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

  for (const [hull, route] of PATROL_FIXTURES) {
    it(`patrol:${hull}: a crafted ${hull} on a Repeat ${route} over 2,400 s, with the display replay`, () => {
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
      pin(`patrol:${hull}`, out);
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
  "wear:mission:shortOreRun": ["a0f89ec2", "1200:9f3ccf58", "2400:7dc89fcd", "3600:b61edcd", "cargoBay=995 ftlDrive=997 reactorCore=993 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:longOreRun": ["bd383776", "1200:26067ed4", "2400:e343d951", "3600:c3842d53", "cargoBay=995 ftlDrive=992 reactorCore=989 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:forageFlora": ["28b8807b", "1200:75763396", "2400:51b6ff9c", "3600:d982acd5", "cargoBay=995 ftlDrive=994 reactorCore=990 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:salvageWreckage": ["fa78484f", "1200:90dc19c9", "2400:63fa079a", "3600:4d802f75", "cargoBay=995 ftlDrive=995 reactorCore=991 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:mission:surveyStellarPhenomena": ["7f9da665", "1200:b645da89", "2400:20f8ee85", "3600:605804c2", "cargoBay=995 ftlDrive=989 reactorCore=987 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  // The transport's working capital never clears on this fixture's credits, so no cycle delivers: only the stamp moves.
  "wear:mission:frontierSupplyRun": ["58c67fe2", "1200:fcc14e23", "2400:729aee74", "3600:c7f83395", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:shortRange": ["1b7e956a", "1200:4fb9e078", "2400:d12ef6e1", "3600:cf574c29", "cargoBay=1000 ftlDrive=993 reactorCore=996 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:expedition": ["6f308f00", "a0543f8c", "f70dc432", "ad5c3fca", "cargoBay=1000 ftlDrive=1000 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=963 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=963 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=907 implant=1000"],
  "wear:redispatch": ["b8bfa2b9", "e6c0e4d4", "cargoBay=995 ftlDrive=997 reactorCore=993 specUtility=995 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "wear:recovery": ["cargoBay=994 ftlDrive=997 reactorCore=990 specUtility=994 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000", "cargoBay=998 ftlDrive=1000 reactorCore=994 specUtility=998 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000", "81565289"],
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

  it("wear:expedition: the crafted Orion's ordinary run (its training run behind it), through claim", () =>
    withSiMemberGearOff(() => {
      const run = expeditionRun(true);
      pin3("wear:expedition", [...run.out, conditions(run.claimed)]);
    }));

  it("wear:recovery and wear:redispatch: the worn freighter recalled and home, then dispatched again while still worn", () => {
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
    pin3("wear:redispatch", [record, stateHash(r), conditions(r)]);
    // Left at home instead: a few seconds recover part of it, a minute all of it (40 per-mille a minute, free).
    s = runTicks(s, 6, rng);
    const afterSixSeconds = conditions(s);
    s = runTicks(s, 54, rng);
    expect(s.equipment.filter((e) => e.fittedToShipId === "ship-1").every((e) => e.condition === undefined)).toBe(true);
    pin3("wear:recovery", [landed, afterSixSeconds, stateHash(s)]);
  });
});

describe.runIf(CAPTURE)("gear wear capture (GW_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.GW_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
