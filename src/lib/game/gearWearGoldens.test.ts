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
//
// Steps 1 and 2 (this slice: the catalogs, the pure helpers, the condition field that replaces the retired
// `durability`, the v70 migration step) must move NONE of these: every piece is pristine and no wear source is wired.
// Hashes go through goldenJson (firstRunsGoldens.fixture.ts), which puts the retired field back on a pristine piece,
// so the field swap itself is invisible here and only a real behavior change can move a pin.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import {
  EQUIPMENT_SLOTS,
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
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, shipRepairDurationTicks } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { generateDronePod, generateEquipment, generateWeapon } from "./itemgen";
import { equippedFor } from "./equipment";
import { officerRepairSpeedBonus } from "./crewOverlay";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { asPreRanksDispatch, asPreSafeFirstRunsDispatch, plainAwayMember, withSlottedAwayTeams, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { withSiMemberGearOff } from "./siMemberGearSwitch.fixture";

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
  "patrol:destroyer": ["df281090", "2ad61e28", "67264ecd", "77d4b235", "5e7e8bd2", "f99c2b34", "35f5a476", "4f7f026a", "9901051b", "relaunches:171", "a89174c6"],
  "patrol:carrier": ["f2dbd51e", "7ff99f8c", "c1929171", "58b10189", "138a5918", "143f8846", "ed7acf50", "d4ad7090", "ab2b97d9", "relaunches:109", "86e16f3d"],
  "expedition": ["4eaa82ad", "8f7e452f", "659f1289", "43e5954"],
  "repair": ["176", "965b8aa9", "a10053e8"],
};

const MISSION_FIXTURES: readonly MissionKey[] = ["shortOreRun", "longOreRun", "forageFlora", "salvageWreckage", "surveyStellarPhenomena"];
const PATROL_FIXTURES: readonly [ShipTypeKey, PatrolKey][] = [
  ["destroyer", "crimsonReaverSweep"],
  ["carrier", "crimsonReaverWarband"],
];

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

  for (const key of MISSION_FIXTURES) {
    it(`mission:${key}: a crafted freighter's repeating cycles over 3,600 s`, () => {
      const r = dispatchCaptainOnMission(craftedLoadout(levelled(freshState(), 10)), 1, key);
      expect(r.success, `${key}: ${r.reason}`).toBe(true);
      const out = [hash(r.next.captains[0].mission)];
      let s = r.next;
      const rng = lcg(0x6ea2);
      for (const mark of [1200, 2400, 3600]) {
        s = runTicks(s, 1200, rng);
        out.push(`${mark}:${stateHash(s)}`);
      }
      pin(`mission:${key}`, out);
    });
  }

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
  // so the pin keeps proving gear wear moved nothing (siMemberGearGoldens.test.ts pins the swap's own moves).
  it("expedition: a crafted Orion and members in crafted member gear, Ground Ops through claim", () => withSiMemberGearOff(() => {
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
    expect(s0.equipment.filter((e) => e.fittedToMemberId).length).toBeGreaterThan(5);
    const res = asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id)));
    if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
    let s = res.next;
    for (let i = 0; i < 40; i++) s = economyTick(s, 1, lcg(0x4e));
    const done = advanceExpedition(s.expeditions[0], 2_000_000);
    expect(done.phase).toBe("complete");
    const claim = claimExpedition({ ...s, expeditions: [done], gameTimeSeconds: 2_000_000 }, done.id);
    expect(claim.success).toBe(true);
    pin("expedition", [hash(res.expedition), stateHash(s), hash(done), stateHash(claim.next)]);
  }));

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

describe.runIf(CAPTURE)("gear wear capture (GW_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.GW_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
