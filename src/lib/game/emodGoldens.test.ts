// E-MOD EM-0 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-0): golden hashes
// captured on the code BEFORE any power budget engine edit (the CP-0 / WR-4 / G2-0 pattern). Every later E-MOD slice
// keeps these green in the same commit, or re-pins one ONLY where its commit names the move and why, with the proof
// that zeroing the new effect reproduces the old hash.
//
//   sheet    : effectiveShipStats for every hull with EVERY slot combination the census can build (each slot either its
//              Standard Issue / empty state or a crafted piece; weapons and drone pods as a whole hardpoint set), one
//              hash per hull over all of them, plus the full crafted loadout alone and with power-efficiency crew
//              aboard (a Martian Engineering officer carrying Reactor Overdrive, a Martian Power Discipline bucket).
//   census   : every hull's maximum crafted power draw (the P1 census), read from the data, pinned as numbers.
//   patrol   : a Repeat patrol for every combat hull on both routes, with a crafted Reactor Core and shield emitters
//              and the power-efficiency crew aboard: the dispatch record, the display replay every 150 s, the state.
//   groundOps: two Ground Ops runs (ship events live) on an Orion with the same power fixture, through claim.
//   mission  : two captain missions on a General Freighter with a crafted Reactor Core and the power crew, 700 s.
//   registry : the wiring registry snapshot (id, status, contexts, probe) and the E-MOD owned rows by name.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  EQUIPMENT_SLOTS,
  SHIP_TYPES,
  SLOT_BASE_PHYSICALS,
  freshState,
  type AwayMember,
  type CrewBucket,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type MissionKey,
  type PatrolKey,
  type PatrolMissionState,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { WEAPON_DEFS } from "./combat/weapons";
import { DRONE_POD_BASE_POWER_DRAW, generateDronePod, generateEquipment, generateWeapon } from "./itemgen";
import { effectiveShipStats } from "./crewOverlay";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { shipEventsLive } from "./shipScanEvents";
import { asPreVoyageDispatch, plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { WIRING_REGISTRY } from "./wiring/registry";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { withEm1Off } from "./emodEm1Switch.fixture";
import { withV1Museum } from "./firstRunsGoldens.fixture";

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// Relics v2 R2-1 (merged after EM-0's capture): whole states hash with the Museum v2 record in its v1 form
// (withV1Museum, the feat precedent), as EM-0 captured them.
const hash = (v: unknown): string => fnv(JSON.stringify(withV1Museum(v)));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const SHIP = "ship-1";

// The single slots a crafted piece can fill, in a fixed order (each one bit of the slot combination).
const SINGLE_SLOTS = ["cargoBay", "ftlDrive", "reactorCore", "specUtility", "shieldEmitters", "hullPlating", "bridge", "quarters", "sensor"] as const;
type SingleSlot = (typeof SINGLE_SLOTS)[number];

// The variety a crafted piece of `slot` takes on `hull`: the first one the hull may install (a specUtility variety
// carries its own hull gate, else the slot's). null when the hull can install none (a General Freighter's utility).
function varietyFor(slot: SingleSlot, hull: ShipTypeKey): string | null {
  const def = EQUIPMENT_SLOTS[slot];
  const spec = SHIP_TYPES[hull].spec;
  const ok = def.varieties.find((v) => {
    const req = v.equipRequirement ?? def.equipRequirement;
    return req?.hullSpec === undefined || req.hullSpec === spec;
  });
  return ok ? ok.key : null;
}

// The single slots `hull` can carry a crafted piece in.
function slotsFor(hull: ShipTypeKey): SingleSlot[] {
  return SINGLE_SLOTS.filter((slot) => varietyFor(slot, hull) !== null);
}

function craftedPiece(slot: SingleSlot, hull: ShipTypeKey, n: number): EquipmentInstance {
  const piece = generateEquipment({
    slotType: slot as EquipmentSlotType,
    varietyKey: varietyFor(slot, hull)!,
    blueprintKey: null,
    iLevel: 20,
    quality: 2,
    rarity: "augmented",
    ascension: "none",
    rng: seededRng(0x51a7 + n * 7919),
    allocateId: () => `emod-${slot}`,
  });
  return { ...piece, fittedToShipId: SHIP };
}

// The heaviest-draw weapon (the census reads the same def).
const HEAVY_WEAPON = (Object.keys(WEAPON_DEFS) as (keyof typeof WEAPON_DEFS)[]).reduce((a, b) => (WEAPON_DEFS[b].powerDraw > WEAPON_DEFS[a].powerDraw ? b : a));

function craftedWeapons(hull: ShipTypeKey): EquipmentInstance[] {
  return Array.from({ length: SHIP_TYPES[hull].weaponHardpoints }, (_, i) => ({
    ...generateWeapon({
      weaponType: HEAVY_WEAPON,
      blueprintKey: null,
      iLevel: 20,
      quality: 2,
      rarity: "augmented",
      ascension: "none",
      rng: seededRng(0xa11 + i),
      allocateId: () => `emod-weapon-${i}`,
    }),
    fittedToShipId: SHIP,
  }));
}

function craftedPods(hull: ShipTypeKey): EquipmentInstance[] {
  return Array.from({ length: SHIP_TYPES[hull].droneBays ?? 0 }, (_, i) => ({
    ...generateDronePod({
      droneRole: i % 2 === 0 ? "attack" : "defense",
      blueprintKey: null,
      iLevel: 20,
      quality: 2,
      rarity: "augmented",
      ascension: "none",
      rng: seededRng(0xb22 + i),
      allocateId: () => `emod-pod-${i}`,
    }),
    fittedToShipId: SHIP,
  }));
}

// ship-1 re-hulled to `hull` with its Standard Issue economy and combat gear.
function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
}

// Replace ship-1's pieces in `slots` with crafted ones; `weapons` / `pods` swap the whole hardpoint / bay set.
function withCrafted(s: GameState, hull: ShipTypeKey, slots: readonly SingleSlot[], weapons: boolean, pods: boolean): GameState {
  const drop = new Set<string>([...slots, ...(weapons ? ["weapon"] : []), ...(pods ? ["droneBay"] : [])]);
  const kept = s.equipment.filter((e) => !(e.fittedToShipId === SHIP && drop.has(e.slotType)));
  const added = [
    ...slots.map((slot) => craftedPiece(slot, hull, SINGLE_SLOTS.indexOf(slot))),
    ...(weapons ? craftedWeapons(hull) : []),
    ...(pods ? craftedPods(hull) : []),
  ];
  return { ...s, equipment: [...kept, ...added] };
}

// The power-efficiency crew: a Martian Engineering officer carrying Reactor Overdrive, and a Martian Engineering
// bucket carrying Power Discipline (both key crew.powerEfficiency).
const POWER_BUCKET: CrewBucket = { profession: "engineering", rarity: "standard", rank: 1, race: "martian", buff1Id: "eng.power", buff2Id: null, count: 20 };
function withPowerCrew(s: GameState): GameState {
  const officer = {
    id: "emod-officer",
    seat: "engineering" as const,
    name: "EM Engineer",
    race: "martian" as const,
    gender: "nonbinary" as const,
    rank: "ensign" as const,
    bonuses: [
      // Read off the catalog at call time, so the EM-1 switch (withEm1Off) can turn it off too.
      { id: "eng.overdrive", magnitude: getSeniorStaffBonusById("eng.overdrive")!.magnitude },
      { id: "test.none", magnitude: 0 },
    ] as [{ id: string; magnitude: number }, { id: string; magnitude: number }],
    missionsCompleted: 0,
    assignedShipId: SHIP,
  };
  return {
    ...s,
    officers: [...s.officers, officer],
    ships: s.ships.map((sh) => (sh.id === SHIP ? { ...sh, complement: { mode: "active" as const, buckets: [POWER_BUCKET] } } : sh)),
  };
}

const sheetOf = (s: GameState) => effectiveShipStats(s, s.ships.find((sh) => sh.id === SHIP)!);

// Every slot combination for `hull`: bit i of the mask crafts slot i; the two top bits craft the weapon set and the
// pod set (the pod bit only on a hull with bays). One hash over every combination's sheet, in mask order.
function combinationsHash(hull: ShipTypeKey): { hash: string; count: number } {
  const slots = slotsFor(hull);
  const bays = (SHIP_TYPES[hull].droneBays ?? 0) > 0;
  const bits = slots.length + 1 + (bays ? 1 : 0);
  const base = hullState(hull);
  const parts: string[] = [];
  for (let mask = 0; mask < 1 << bits; mask++) {
    const chosen = slots.filter((_, i) => (mask & (1 << i)) !== 0);
    const weapons = (mask & (1 << slots.length)) !== 0;
    const pods = bays && (mask & (1 << (slots.length + 1))) !== 0;
    parts.push(hash(sheetOf(withCrafted(base, hull, chosen, weapons, pods))));
  }
  return { hash: fnv(parts.join("|")), count: parts.length };
}

function fullLoadout(hull: ShipTypeKey): GameState {
  return withCrafted(hullState(hull), hull, slotsFor(hull), true, (SHIP_TYPES[hull].droneBays ?? 0) > 0);
}

// The P1 census: the most a crafted loadout can draw on `hull`, from the data (a rolled powerDrawReduction only ever
// lowers a piece's draw, itemgen.ts generateEquipment). Every single slot the hull can install, every hardpoint at the
// heaviest weapon, every bay at a drone pod.
function maxCraftedDraw(hull: ShipTypeKey): number {
  const singles = slotsFor(hull).reduce((sum, slot) => sum + SLOT_BASE_PHYSICALS[slot].powerDraw, 0);
  return singles + SHIP_TYPES[hull].weaponHardpoints * WEAPON_DEFS[HEAVY_WEAPON].powerDraw + (SHIP_TYPES[hull].droneBays ?? 0) * DRONE_POD_BASE_POWER_DRAW;
}

// The patrol / mission / Ground Ops power fixture: a crafted Reactor Core and shield emitters (a real draw) with the
// power-efficiency crew aboard, on top of the hull's Standard Issue.
function powerFixture(hull: ShipTypeKey): GameState {
  return withPowerCrew(withCrafted(hullState(hull), hull, ["reactorCore", "shieldEmitters"], false, false));
}

const ROUTES: PatrolKey[] = ["crimsonReaverSweep", "crimsonReaverWarband"];

function patrolRun(hull: ShipTypeKey, route: PatrolKey): string[] {
  const st = powerFixture(hull);
  const r = dispatchCaptainOnPatrol(st, 1, route, "balanced", true);
  if (!r.success) return [`refused:${r.reason}`];
  let s = r.next;
  const out = [hash(s.captains[0].mission)];
  for (let i = 0; i < 600; i++) {
    s = economyTick(s, 1, () => 0.5);
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m === null) break;
    if (i % 150 === 0) out.push(hash(replayPatrol(s, s.captains[0])));
  }
  out.push(hash(s));
  return out;
}

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, SHIP),
  ...over,
});
const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];

function groundOpsRun(seed: number): string[] {
  const s0 = powerFixture("orion");
  const s = withSlottedAwayTeams({ ...s0, awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  // G2-3 (merged after EM-0's capture): the run as dispatched before the voyage engine (asPreVoyageDispatch, the feat
  // precedent), so it flies the fixed legs EM-0 pinned.
  const res = asPreVoyageDispatch(startExpedition(s, SHIP, 1, expeditionCandidates(s, SHIP)[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  expect(shipEventsLive(exp)).toBe(true);
  const done = advanceExpedition(exp, 2_000_000);
  expect(done.phase).toBe("complete");
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  return [hash(exp), hash(done), hash(claim.next)];
}

function missionRun(key: MissionKey): string {
  const base = powerFixture("generalFreighter");
  const st: GameState = { ...base, captains: base.captains.map((c) => ({ ...c, level: 10 })) };
  const r = dispatchCaptainOnMission(st, 1, key);
  expect(r.success, key).toBe(true);
  let s = r.next;
  const rng = lcg(0xe40d);
  for (let i = 0; i < 700; i++) s = economyTick(s, 1, rng);
  return hash(s);
}

// ===== the goldens =====

// Captured on a9caa06 (feat/crew-0.14.0) by EM-0, before any engine edit; the moves since are named per pin. The
// patrol, Ground Ops and mission pins have never moved: EM-1 adds no install gate and no combat penalty (after the merge
// of feat 922025e they hash whole states through withV1Museum and dispatch the Ground Ops runs through
// asPreVoyageDispatch, the feat precedents for R2-1 and G2-3, and every one reproduces its EM-0 capture).
const GOLDEN: Record<string, unknown> = {
  // Re-pinned by EM-1: every sheet's powerOutput gains the hull's basePowerOutput (P1); with the EM-1 switch on
  // (withEm1Off) every hull reproduces its EM-0 capture (EM0 below).
  sheetCombinations: [
    "generalFreighter:512:e1c3f535",
    "prospectorHauler:1024:4cfab90f",
    "prospectorRunner:1024:d8a2c35f",
    "prospectorMiner:1024:29c15883",
    "destroyer:1024:de5e8dcb",
    "battleship:1024:c9c7ae3f",
    "carrier:2048:caef074f",
    "orion:1024:5eea007",
    "aurora:1024:2dbeb963",
    "eir:1024:a14f96fb",
  ],
  // Re-pinned by EM-1: the hull's base output (both halves) and, in the second half, the power crew's net-draw cut
  // (P4); with the switch on both halves reproduce EM0, so the two moves are the only ones.
  sheetFull: [
    "generalFreighter:78c613c7/7aec42e3",
    "prospectorHauler:c7305c3d/2797cc9",
    "prospectorRunner:7609e343/b6673266",
    "prospectorMiner:1d6fd670/bb4ee37d",
    "destroyer:e9783aec/c3f931dd",
    "battleship:181dfacd/e461fe24",
    "carrier:7b183e99/982351b1",
    "orion:7c5412f0/1c42aea1",
    "aurora:6d507f81/d458fdd0",
    "eir:7fdd10db/182593fa",
  ],
  census: {
    generalFreighter: 83,
    prospectorHauler: 85,
    prospectorRunner: 50,
    prospectorMiner: 50,
    destroyer: 155,
    battleship: 225,
    carrier: 105,
    orion: 50,
    aurora: 50,
    eir: 50,
  },
  "patrol:generalFreighter:crimsonReaverSweep": ["a22d953b", "f1303262", "af09e57d", "809c791a", "1ffcda88", "70660f1d"],
  "patrol:generalFreighter:crimsonReaverWarband": ["14716665", "58ebce7c", "919e12e7"],
  "patrol:prospectorHauler:crimsonReaverSweep": ["f395dca2", "ec1b3baa", "dcd441c5", "a6ff3d60", "423f1dbb", "ca698ddb"],
  "patrol:prospectorHauler:crimsonReaverWarband": ["f7018a80", "1b6a04f", "984eba0d"],
  "patrol:prospectorRunner:crimsonReaverSweep": ["35304b07", "2683c11c", "540ed873"],
  "patrol:prospectorRunner:crimsonReaverWarband": ["bb3f0839", "9706551a", "396a7d72"],
  "patrol:prospectorMiner:crimsonReaverSweep": ["2c976c41", "91a3b4b3", "4cfe9f19"],
  "patrol:prospectorMiner:crimsonReaverWarband": ["20145f43", "df5c4593", "6494466d"],
  "patrol:destroyer:crimsonReaverSweep": ["e212a0f4", "fecb657", "fd943642", "3225234d", "83b5d80", "93285f1c"],
  "patrol:destroyer:crimsonReaverWarband": ["29d6046", "9ca2efb", "56b823a3"],
  "patrol:battleship:crimsonReaverSweep": ["7db855f4", "deeaf137", "db94168b", "2a94260e", "c4051625", "51fc5daf"],
  "patrol:battleship:crimsonReaverWarband": ["3ec73e1a", "e7f6f494", "32566222"],
  "patrol:carrier:crimsonReaverSweep": ["50c62cd6", "45416125", "101ffd89", "3addcf00", "8259b08a", "5215f06f"],
  "patrol:carrier:crimsonReaverWarband": ["a0e384dc", "b90af1b3", "58bc8525"],
  "patrol:orion:crimsonReaverSweep": ["8e12b325", "c286e23", "6d758b62", "843374d", "c5a0241e", "c019397e"],
  "patrol:orion:crimsonReaverWarband": ["97101bc3", "e062c2f6", "af0fc738"],
  "patrol:aurora:crimsonReaverSweep": ["79bb80eb", "c977f577", "f1f71c85", "a82997dd", "f9405ee8", "23b8ff0b"],
  "patrol:aurora:crimsonReaverWarband": ["d2b521ad", "7b0b391e", "48dd8d1d"],
  "patrol:eir:crimsonReaverSweep": ["6d0d415d", "7c3e0da4", "9f779576", "71997d4c", "331458c0", "f0a51103"],
  "patrol:eir:crimsonReaverWarband": ["746ba2fb", "ccd52ab", "7a6f8887"],
  "groundOps:1234": ["e396d8dd", "42027928", "17b9a694"],
  "groundOps:5678": ["49bebe7a", "f370042b", "8deed810"],
  "mission:shortOreRun": "e6e74d3d",
  "mission:surveyMineralAnomaly": "3f929827",
  // EM-1: the full crafted loadout's power output / draw / draw with the power crew aboard (the crafted Reactor Core
  // supplies 32 on top of the hull's own; the crew's 0.2 efficiency cuts the draw by about 13%).
  power: [
    "generalFreighter:117/83/72",
    "prospectorHauler:117/85/74",
    "prospectorRunner:82/50/44",
    "prospectorMiner:82/50/44",
    "destroyer:192/155/134",
    "battleship:262/225/194",
    "carrier:142/105/91",
    "orion:162/50/44",
    "aurora:182/50/44",
    "eir:152/50/44",
  ],
  // Re-pinned by EM-1: Reactor Overdrive, Power Discipline, the Martian racial, the powerOutput and powerDrawReduction
  // lines and the slot and weapon draw rows went live, every hull's basePowerOutput joined, the drive class draw seam
  // joined, the reactor surplus row is owned by EM-4 and the division wings no longer name E-MOD (EM-0: eb2a0c07, with
  // 13 E-MOD rows). The two rows left naming E-MOD: the Precursor Lens module (EM-8) and the reactor surplus (EM-4).
  // Re-pinned again at the merge of feat 922025e (EM-1 aea24b6b): FKR-5, G2-3 and R2-1 added their entries (the
  // G1-0 golden 5 in shortRangeGoldens.test.ts proves each slice is its only cause); the E-MOD rows did not change.
  // Re-pinned at the merge into the ML-1 branch (452c9676): Material Lines ML-1 added 14 entries (its seven Refinery
  // recipes, pending while hidden, and its seven typed reserves); with them left out the snapshot reproduces
  // 452c9676 (asserted below, ML1_ENTRY_IDS), so they are the only cause; the E-MOD rows did not change.
  // Re-pinned at the merge into the FKR-6 branch (c1260fe0 -> 30489b98), two causes, each read back below: G1-3 (merged
  // after the ML-1 re-pin without moving it: feat a2a1b6a reads a488ee24) re-owned the facility:audit:missionControlUnlock
  // row, and Field Kits FKR-6 added 5 entries and flipped 8 pending -> live. With FKR-6 read back (FKR6_BEFORE) the
  // snapshot is a488ee24, and with the G1-3 row's old owner too it is c1260fe0; the E-MOD rows did not change.
  // Re-pinned by the inert racials (0.14.0, 30489b98 -> bb253425): eight entries went live with their probes and
  // contexts (Deck Handling, Survey Aptitude, the Belter, Vael, Outer-Colony and Spacer racials, the Science and Flight
  // Deck wings), the four still-pending Ground Ops crew keys and the Security and Medical wings name their owner CP-3
  // (was "E-CREW Task 23" / "CP-3, CP-4"), and one audit row joins (the Spacer long-haul ramp, deferred). Read back
  // (RACIALS_BEFORE, RACIALS_ADDED_IDS) the snapshot is 30489b98, and every earlier read-back holds; the E-MOD rows hold.
  registry: [
    "bb253425",
    "relic:RELICS:precursorLens",
    "ship:audit:reactorCoreNet",
  ],
};

// The EM-0 captures of the pins EM-1 moved (before it the power crew moved no sheet: crew.powerEfficiency had no
// consumer, so each sheetFull pair read the same hash twice). withEm1Off reproduces each exactly.
const EM0: Record<string, unknown> = {
  sheetCombinations: [
    "generalFreighter:512:f4c378a7",
    "prospectorHauler:1024:ba38163b",
    "prospectorRunner:1024:4951d2a7",
    "prospectorMiner:1024:20329e4b",
    "destroyer:1024:48b66def",
    "battleship:1024:df33d023",
    "carrier:2048:f6f8a49b",
    "orion:1024:52faec4b",
    "aurora:1024:dc56e30b",
    "eir:1024:52921f03",
  ],
  sheetFull: [
    "generalFreighter:3a274007/3a274007",
    "prospectorHauler:9c3047ab/9c3047ab",
    "prospectorRunner:b9690d52/b9690d52",
    "prospectorMiner:5bebcb6d/5bebcb6d",
    "destroyer:40665e55/40665e55",
    "battleship:67af3f40/67af3f40",
    "carrier:beb620d7/beb620d7",
    "orion:c8fb621c/c8fb621c",
    "aurora:efeb261/efeb261",
    "eir:79c9fffa/79c9fffa",
  ],
};

// The registry snapshot before Material Lines ML-1, and the 14 entries ML-1 added (its recipes and its reserves).
const REGISTRY_BEFORE_ML1 = "452c9676";
const ML1_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...["refineFerriteIngot", "refineReclaimedCircuit", "refineIridiumCatalyst", "synthCobaltCoil", "synthOsmiumPlate", "synthPhotonicGel", "synthBiocatalyst"].map((k) => `facility:REFINE_RECIPES:${k}`),
  ...["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst", "precursorCircuit"].map((id) => `facility:ITEMS:${id}:reserved`),
]);

// Field Kits FKR-6: the 5 entries it added, and the 8 it flipped pending -> live as they stood before it (status, no
// contexts, no probe).
const FKR6_ADDED_IDS: ReadonlySet<string> = new Set<string>([
  "away:GAMBIT_SELECTORS:allyDowned",
  "away:GAMBIT_PROGRAMS:minRank:elite",
  "away:GAMBIT_PROGRAMS:minRank:boss",
  "away:GAMBIT_PROGRAMS:reserveForBoss",
  "away:GAMBIT_PROGRAMS:fieldKitsDefault",
]);
const FKR6_BEFORE: Readonly<Record<string, string>> = {
  "away:FIELD_KITS:firstAidKit": "FKR-6 (kits in battle: a Use Item rule spends the member's own First Aid Kit)",
  "away:FIELD_KITS:antitoxin": "FKR-6 (kits in battle: Antitoxin clears Poison)",
  "away:FIELD_KITS:combatStim": "FKR-6 (kits in battle: Combat Stim grants Inspired)",
  "away:FIELD_KITS:splint": "FKR-6 (kits in battle: Splint on the bone line, N8)",
  "away:FIELD_KITS:traumaKit": "FKR-6 (kits in battle: Trauma Kit on serious conditions)",
  "away:FIELD_KITS:injuryKit": "FKR-6 + FKR-7 (the Injury Kit treatment share reaches the medical bay)",
  "away:KIT_CATEGORY_RULES:firstAid": "FKR-6 (First Aid kits at 0.5x untrained, 1.25x with Medical Training)",
  "away:KIT_CATEGORY_RULES:advancedMedical": "FKR-6 (the Medical Training gate on Splint, Trauma Kit and Injury Kit)",
};
const REGISTRY_BEFORE_FKR6 = "a488ee24";
// G1-3's one moved row, as it stood before it (the c1260fe0 snapshot).
const G13_ROW = "facility:audit:missionControlUnlock";
const G13_ROW_BEFORE = { kind: "pending", owner: "WR-4, OC-C4" };
const REGISTRY_BEFORE_G13 = "c1260fe0";

// The inert racials (0.14.0): the one audit row they added (the Spacer long-haul ramp, still deferred) and the 14 rows
// they changed as they stood before them ([status, contexts, probe]): 8 flipped live (Deck Handling, Survey Aptitude,
// the Belter, Outer-Colony, Vael and Spacer racials, the Science and Flight Deck wings) and 6 re-owned to CP-3 (the
// four Ground Ops crew keys, the Security and Medical wings). Read back, the snapshot is feat's 30489b98.
const REGISTRY_BEFORE_RACIALS = "30489b98";
const RACIALS_ADDED_IDS: ReadonlySet<string> = new Set<string>(["crew:audit:spacerLongHaulRamp"]);
const RACIALS_BEFORE: Readonly<Record<string, readonly unknown[]>> = {
  "crew:crew.droneHandling": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["patrol"]}, [], "combatDroneHp"],
  "crew:crew.counterInfiltration": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)" }, [], null],
  "crew:crew.awayTeamProtection": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["ground"]}, [], "runSecHp"],
  "crew:crew.surveyAptitude": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["expedition:groundOps"]}, [], "expScanRate"],
  "crew:crew.triage": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["ground"]}, [], "runSecHeal"],
  "crew:crew.preventCrewLoss": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["medbay"]}, [], "injuryCare"],
  "racial:belter": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["patrol"]}, [], "combatDroneHp"],
  "racial:outerColony": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["expedition:groundOps"]}, [], "expScanRate"],
  "racial:spacer": [{ "kind": "deferred", "owner": "Task 23: complement long-haul ramp (D26)", "userRef": "capture 2026-10-15 section 3 T3 (moved to 0.14.x): the Spacer long-haul ramp" }, [], null],
  "racial:vael": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["expedition:groundOps"]}, [], "expScanRate"],
  "ship:QUARTERS_MODULES:quartersSecurityWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the security division's dead keys; its live keys move)", "contexts": ["ground"]}, ["sheet"], "sheetUnload"],
  "ship:QUARTERS_MODULES:quartersScienceWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the science division's dead keys; its live keys move)", "contexts": ["expedition:groundOps"]}, ["sheet"], "sheetUnload"],
  "ship:QUARTERS_MODULES:quartersMedicalWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the medical division's dead keys; its live keys move)", "contexts": ["ground"]}, ["sheet"], "sheetUnload"],
  "ship:QUARTERS_MODULES:quartersFlightDeckWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the flightDeck division's dead keys; its live keys move)", "contexts": ["patrol"]}, ["sheet"], "sheetUnload"],
};

// The registry snapshot rows with the inert racials read back, then (unless `racialsOnly`) FKR-6 read back too (its
// added entries left out, its flips as they stood) and, when `g13Back`, G1-3's audit row with its old owner.
function registryRowsBack(g13Back: boolean, racialsOnly = false): unknown[][] {
  return WIRING_REGISTRY.filter((e) => !RACIALS_ADDED_IDS.has(e.id) && (racialsOnly || !FKR6_ADDED_IDS.has(e.id))).map((e) =>
    e.id in RACIALS_BEFORE
      ? [e.id, ...RACIALS_BEFORE[e.id]]
      : racialsOnly
        ? [e.id, e.status, e.contexts, e.probe ?? null]
        : e.id in FKR6_BEFORE
          ? [e.id, { kind: "pending", owner: FKR6_BEFORE[e.id] }, [], null]
          : g13Back && e.id === G13_ROW
            ? [e.id, G13_ROW_BEFORE, e.contexts, e.probe ?? null]
            : [e.id, e.status, e.contexts, e.probe ?? null],
  );
}

function pinned(name: string, value: unknown): void {
  expect(value, name).toEqual(GOLDEN[name]);
}

describe("EM-0 goldens (re-pinned by EM-1 where named)", () => {
  it("sheet: every hull, every slot combination the census can build", () => {
    const out = HULLS.map((hull) => {
      const { hash: h, count } = combinationsHash(hull);
      return `${hull}:${count}:${h}`;
    });
    pinned("sheetCombinations", out);
  });

  it("sheet: the full crafted loadout, alone and with the power-efficiency crew", () => {
    const out = HULLS.map((hull) => `${hull}:${hash(sheetOf(fullLoadout(hull)))}/${hash(sheetOf(withPowerCrew(fullLoadout(hull))))}`);
    pinned("sheetFull", out);
  });

  it("census: every hull's maximum crafted power draw (P1), and the full loadout draws no more", () => {
    const census = Object.fromEntries(HULLS.map((hull) => [hull, maxCraftedDraw(hull)]));
    pinned("census", census);
    for (const hull of HULLS) {
      const gross = fullLoadout(hull).equipment.filter((e) => e.fittedToShipId === SHIP).reduce((sum, e) => sum + e.powerDraw, 0);
      expect(gross, hull).toBeLessThanOrEqual(census[hull]);
      expect(gross, hull).toBeGreaterThan(0);
    }
  });

  for (const hull of HULLS) {
    for (const route of ROUTES) {
      it(`patrol: ${hull} on ${route}, Repeat, with the display replay`, () => {
        pinned(`patrol:${hull}:${route}`, patrolRun(hull, route));
      });
    }
  }

  for (const seed of [0x1234, 0x5678]) {
    it(`groundOps: an Orion run with ship events (seed ${seed.toString(16)}), through claim`, () => {
      pinned(`groundOps:${seed.toString(16)}`, groundOpsRun(seed));
    });
  }

  for (const key of ["shortOreRun", "surveyMineralAnomaly"] as MissionKey[]) {
    it(`mission ${key}: a crafted Reactor Core and the power crew, 700 economyTick seconds`, () => {
      pinned(`mission:${key}`, missionRun(key));
    });
  }

  it("registry: the wiring registry snapshot and the E-MOD owned rows", () => {
    const snapshot = hash(WIRING_REGISTRY.map((e) => [e.id, e.status, e.contexts, e.probe ?? null]));
    const emod = WIRING_REGISTRY.filter((e) => e.status.kind !== "live" && "owner" in e.status && /E-MOD/.test(e.status.owner)).map((e) => e.id).sort();
    pinned("registry", [snapshot, ...emod]);
    // With the later moves read back (FKR-6 and G1-3, the test below) and ML-1's entries left out: the snapshot before ML-1.
    const beforeMl1 = hash(registryRowsBack(true).filter((r) => !ML1_ENTRY_IDS.has(r[0] as string)));
    expect(beforeMl1).toBe(REGISTRY_BEFORE_ML1);
  });
  it("registry: the inert racials are the only cause of the latest snapshot move", () => {
    expect(hash(registryRowsBack(false, true))).toBe(REGISTRY_BEFORE_RACIALS);
  });
  it("registry: FKR-6 and G1-3's audit row are the only causes of its snapshot move", () => {
    expect(hash(registryRowsBack(false))).toBe(REGISTRY_BEFORE_FKR6);
    expect(hash(registryRowsBack(true))).toBe(REGISTRY_BEFORE_G13);
  });
});

describe("EM-1 turn it off: with the power budget engine switched off, every moved sheet is the EM-0 capture", () => {
  it("sheet: every hull, every slot combination", () => {
    expect(withEm1Off(() => HULLS.map((hull) => {
      const { hash: h, count } = combinationsHash(hull);
      return `${hull}:${count}:${h}`;
    }))).toEqual(EM0.sheetCombinations);
  });

  it("sheet: the full crafted loadout, alone and with the power-efficiency crew", () => {
    expect(withEm1Off(() => HULLS.map((hull) => `${hull}:${hash(sheetOf(fullLoadout(hull)))}/${hash(sheetOf(withPowerCrew(fullLoadout(hull))))}`))).toEqual(EM0.sheetFull);
  });

  it("the switch restores every value it touched", () => {
    const before = JSON.stringify([HULLS.map((h) => SHIP_TYPES[h].basePowerOutput), getSeniorStaffBonusById("eng.overdrive")]);
    withEm1Off(() => expect(SHIP_TYPES.destroyer.basePowerOutput).toBe(0));
    expect(JSON.stringify([HULLS.map((h) => SHIP_TYPES[h].basePowerOutput), getSeniorStaffBonusById("eng.overdrive")])).toBe(before);
  });
});

describe("EM-1 power numbers (P1: no live ship goes over budget)", () => {
  it("every hull's base output covers its maximum crafted draw (the EM-0 census)", () => {
    for (const hull of HULLS) expect(SHIP_TYPES[hull].basePowerOutput, hull).toBeGreaterThanOrEqual(maxCraftedDraw(hull));
  });

  it("the full crafted loadout's output and draw, alone and with the power crew, on every hull", () => {
    const out = HULLS.map((hull) => {
      const alone = sheetOf(fullLoadout(hull));
      const crewed = sheetOf(withPowerCrew(fullLoadout(hull)));
      expect(alone.powerDraw, hull).toBeLessThanOrEqual(alone.powerOutput);
      expect(crewed.powerDraw, hull).toBeLessThan(alone.powerDraw);
      expect(Number.isInteger(crewed.powerDraw), hull).toBe(true);
      return `${hull}:${alone.powerOutput}/${alone.powerDraw}/${crewed.powerDraw}`;
    });
    pinned("power", out);
  });
});
