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
import { plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { WIRING_REGISTRY } from "./wiring/registry";

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const hash = (v: unknown): string => fnv(JSON.stringify(v));

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
      { id: "eng.overdrive", magnitude: 0.1 },
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
  const res = startExpedition(s, SHIP, 1, expeditionCandidates(s, SHIP)[0].id);
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

// Captured on a9caa06 (feat/crew-0.14.0), before any EM-1 engine edit. The power crew moves no sheet yet (its key,
// crew.powerEfficiency, has no consumer), so each sheetFull pair reads the same hash twice.
const GOLDEN: Record<string, unknown> = {
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
  registry: [
    "eb2a0c07",
    "crew:crew.powerEfficiency",
    "officer:officer.powerEfficiencyMult",
    "racial:martian",
    "relic:RELICS:precursorLens",
    "ship:QUARTERS_MODULES:quartersFlightDeckWing",
    "ship:QUARTERS_MODULES:quartersMedicalWing",
    "ship:QUARTERS_MODULES:quartersScienceWing",
    "ship:QUARTERS_MODULES:quartersSecurityWing",
    "ship:audit:reactorCoreNet",
    "ship:audit:slotPowerDraw",
    "ship:audit:weaponPowerDraw",
    "ship:gearLine:powerDrawReduction",
    "ship:gearLine:powerOutput",
  ],
};

function pinned(name: string, value: unknown): void {
  expect(value, name).toEqual(GOLDEN[name]);
}

describe("EM-0 pre-power-budget goldens", () => {
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
  });
});
