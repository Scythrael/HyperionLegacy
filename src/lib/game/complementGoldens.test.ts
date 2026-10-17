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
//   legacy     : two legacy (pre-Ground Ops) expeditions: dispatch record, the run at 2,000,000 s, the claimed state.
//   groundOps  : two Ground Ops runs through claim: one with a field repair leg and med bay stays, one with med bay stays
//                and the hull damage carried home.
//   transport  : the transport generator's next 20 deliveries (windows 1 to 20) for a fixed seed, one hash per window.
//   structure  : commandStructureForHull for every hull.
// Each fixture also checks that it really holds what it is pinned for (the keys, the transport, the relaunch, ...).

import { describe, expect, it } from "vitest";
// SF-1: whole states hash without the run counters (withoutRunCounts).
import { withoutRunCounts } from "./firstRunsGoldens.fixture";
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
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, shipRepairDurationTicks } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { effectiveShipStats, officerRepairSpeedBonus, shipCrewContribution } from "./crewOverlay";
import { equippedFor } from "./equipment";
import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { CREW_RACE_IDS, CREW_RACES } from "./crewRaces";
import { CREW_PROFESSIONS, commandStructureForHull, complementTotalCap, divisionCap } from "./commandStructure";
import { totalCrew } from "./crew";
import { TRANSPORT_BATCH_SIZE, TRANSPORT_WINDOW_SECONDS, transportBatch } from "./transports";
import { FIELD_REPAIR_DAMAGE_SHARE } from "./groundOps";
import { asLegacyDispatch, asPreRanksDispatch, plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";

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
const hash = (v: unknown): string => fnv(JSON.stringify(withoutRunCounts(v)));

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
  return `${hash(effectiveShipStats(s, ship))}/${hash(shipCrewContribution(s, ship))}`;
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

function expeditionRun(roster: AwayMember[], seed: number, legacy: boolean, preDamage: boolean): { exp: Expedition; done: Expedition; claimed: GameState } {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: roster.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  const started = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  // Field Kits FKR-1: the Ground Ops runs as dispatched before enemy ranks (the flag off), so they keep their capture.
  const res = legacy ? asLegacyDispatch(started) : asPreRanksDispatch(started);
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
  "sheet:full": [
    "generalFreighter:2699e91/a812089b",
    "prospectorHauler:e8644def/98e08719",
    "prospectorRunner:5fee99c0/98e08719",
    "prospectorMiner:3bb0d88f/98e08719",
    "destroyer:569cd943/ef34c0dd",
    "battleship:8f7da410/d00e8aba",
    "carrier:5b35b9cf/d00e8aba",
    "orion:b3d12aa7/db5bc5eb",
    "aurora:cc46b42b/db5bc5eb",
    "eir:734e27d3/db5bc5eb",
  ],
  // Re-pinned by CP-1 (D14): one transport crewmember's exclusive buff changed name (see the mission test and
  // CP0_MISSION, which keeps the CP-0 capture and proves that is the only difference).
  "mission:shortOreRun": "eb39cb91",
  "mission:surveyMineralAnomaly": "e84193a6",
  "mission:frontierSupplyRun": "f4b5648c",
  // Re-pinned by WR-4 (B14): a battle's turn order is by side, then input order (the player side first), no longer
  // by id ("crimsonReavers-w..." used to sort ahead of "ship-1"); the dispatch record (16e07798) is unchanged.
  patrol: ["16e07798", "9e9d9838", "95126c89", "6f82e593", "349cbd04", "8c13b3c8", "c1af6ef3", "d7ae934c", "3ee0a8b7", "4c87428e"],
  repair: ["239", "b439b3e9", "b3cea9b6"],
  legacyA: ["5a2822aa", "fa468bf1", "18e2b328"],
  legacyB: ["e3b4593f", "b0220f60", "3e73c380"],
  groundOpsRepair: ["6138c3bd", "d8d37478", "69943b5"],
  groundOpsBay: ["527c9b42", "35454953", "2ac60b53"],
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

describe("CP-0 pre-complement goldens", () => {
  it("sheet: every hull, no complement and a full complement holding every buff id and every race", () => {
    const empty = HULLS.map((hull) => `${hull}:${sheetHashes(hull, [])}`);
    const full = HULLS.map((hull) => `${hull}:${sheetHashes(hull, fullComplement(hull))}`);
    expect(empty).toEqual(GOLDEN["sheet:none"]);
    expect(full).toEqual(GOLDEN["sheet:full"]);
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
    it(`mission ${key}: 700 economyTick seconds across a transport window, the passive mission ship crewed mid-run`, () => {
      const s = missionRun(key);
      expect(s.lastTransportWindow).toBe(1);
      expect(s.captains[0].mission).not.toBeNull();
      expect(totalCrew(s.ships[0].complement!.buckets)).toBeGreaterThan(0);
      expect(hash(s)).toBe(GOLDEN[`mission:${key}`]);
      // CP-1 (D14) moved these three on purpose, and only by ONE crewmember: window 1's crew 9 (medical, rank 7, ossir,
      // Triage) draws the exclusive pool; its one exclusive draw named Mission Turnaround from the four-entry pool and
      // names Prevent a Crew Loss from the three rollable ones (same draw, craft duplicate gone). Both keys have no
      // consumer yet, so naming the old buff back on that crewmember reproduces the CP-0 capture exactly.
      expect(s.ships[0].complement!.buckets.filter(isMovedCrew).length + s.crewPool.filter(isMovedCrew).length).toBe(1);
      expect(hash(asBeforeCp1(s))).toBe(CP0_MISSION[key]);
    });
  }

  it("patrol: a Repeat patrol on a carrier, relaunched, with the display replay", () => {
    const base = freshState();
    const st = installMissingCombatBaselines({ ...base, credits: new Decimal(100000), ships: base.ships.map((sh) => ({ ...sh, typeKey: "carrier" as ShipTypeKey })) });
    const r = dispatchCaptainOnPatrol(st, 1, "crimsonReaverSweep", "balanced", true);
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
    it(`${name}: a legacy expedition, dispatch record, the run at 2,000,000 s and the claimed state`, () => {
      const { exp, done, claimed } = expeditionRun(LEGACY_ROSTER, seed, true, false);
      expect("groundOps" in exp).toBe(false);
      const out = [hash(exp), hash(done), hash(claimed)];
      expect(out).toEqual(GOLDEN[name]);
    });
  }

  it("groundOpsRepair: a Ground Ops run with a field repair leg and med bay stays, through claim", () => {
    const { exp, done, claimed } = expeditionRun(MEDIC_SQUAD, 0x1244, false, true);
    expect(done.groundOps!.repairLegs).toHaveLength(1);
    expect(done.groundOps!.history.some((r) => r.step === "bay" && r.endedAt > r.startedAt)).toBe(true);
    const out = [hash(exp), hash(done), hash(claimed)];
    expect(out).toEqual(GOLDEN.groundOpsRepair);
  });

  it("groundOpsBay: a Ground Ops run with med bay stays and hull damage carried home, through claim", () => {
    const { exp, done, claimed } = expeditionRun(MEDIC_SQUAD, 0x1234, false, false);
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
const CP2_SWITCHED_BUFFS = ["med.effectiveness", "eng.hullRepair", "excl.crewOutputMult", "excl.missionTurnaround", "flight.transitOut", "flight.transitBack"];
const CP2_SWITCHED_RACES = ["earthBorn", "stheni"] as const;

function withCp2Off<T>(run: () => T): T {
  const defs = [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE].filter((d) => CP2_SWITCHED_BUFFS.includes(d.id));
  const races = CP2_SWITCHED_RACES.map((r) => CREW_RACES[r].racialBonus);
  const saved = { defs: defs.map((d) => d.magnitude), races: races.map((rb) => ({ ...rb })) };
  expect(defs.length).toBe(CP2_SWITCHED_BUFFS.length);
  try {
    for (const d of defs) d.magnitude = 0;
    for (const rb of races) {
      rb.seniorStaff = 0;
      rb.complement = 0;
    }
    return run();
  } finally {
    defs.forEach((d, i) => (d.magnitude = saved.defs[i]));
    races.forEach((rb, i) => Object.assign(rb, saved.races[i]));
  }
}

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
    const full = withCp2Off(() => HULLS.map((hull) => `${hull}:${sheetHashes(hull, fullComplement(hull))}`));
    expect(full).toEqual(CP2_OFF["sheet:full"]);
  });

  for (const key of ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]) {
    it(`mission ${key}`, () => {
      expect(withCp2Off(() => hash(missionRun(key)))).toBe(CP2_OFF[`mission:${key}`]);
    });
  }

  it("the switch restores every magnitude it touched", () => {
    const before = JSON.stringify([CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE, CREW_RACES]);
    withCp2Off(() => 0);
    expect(JSON.stringify([CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE, CREW_RACES])).toBe(before);
  });
});
