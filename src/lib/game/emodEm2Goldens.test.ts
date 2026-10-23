// E-MOD EM-2 goldens (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-2): captured on
// the code BEFORE the power install gate, so the gate's commit proves it refuses no install a live save can make today
// (P1, user 2026-10-17: "No ship goes over"; every hull's base output is at or above its heaviest crafted loadout).
//
// For every hull, the heaviest crafted loadout the census can build (every single slot crafted, every hardpoint at the
// heaviest weapon, every bay at a drone pod), with and without the power-efficiency crew aboard, through EVERY install
// path the gate covers:
//   hand     : each piece installed one by one from storage (canFitEquipment, then fitEquipment), the verdicts and the
//              final state.
//   reactor  : the crafted Reactor Core swapped back out for a Standard-Issue core (the reactor swap path).
//   itemSide : the item-side "Install on..." targets (installTargetsFor) for every piece, from a bare Standard-Issue hull.
//   armory   : the whole set committed to an Armory loadout and checked out to the ship (checkOutLoadout).
//   roster   : the same loadout brought by a gear-only roster (applyRoster's linked loadout).
// Every verdict is "ok" today; a gate that refused any of them would move a pin.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  EQUIPMENT_SLOTS,
  SHIP_TYPES,
  freshState,
  generateStandardIssue,
  type CrewBucket,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { installMissingCombatBaselines } from "./tick";
import { WEAPON_DEFS } from "./combat/weapons";
import { generateDronePod, generateEquipment, generateWeapon } from "./itemgen";
import { canFitEquipment, fitEquipment } from "./equipment";
import { installTargetsFor } from "./memberEquipment";
import { checkOutLoadout, createLoadout, installIntoLoadout, loadoutSlotDefsForShipType } from "./armory";
import { applyRoster, createRoster } from "./personnelRosters";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { goldenJson, withV1Museum } from "./firstRunsGoldens.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(withV1Museum(v)));

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const SHIP = "ship-1";
const SINGLE_SLOTS = ["cargoBay", "ftlDrive", "reactorCore", "specUtility", "shieldEmitters", "hullPlating", "bridge", "quarters", "sensor"] as const;
type SingleSlot = (typeof SINGLE_SLOTS)[number];

function varietyFor(slot: SingleSlot, hull: ShipTypeKey): string | null {
  const def = EQUIPMENT_SLOTS[slot];
  const spec = SHIP_TYPES[hull].spec;
  const ok = def.varieties.find((v) => {
    const req = v.equipRequirement ?? def.equipRequirement;
    return req?.hullSpec === undefined || req.hullSpec === spec;
  });
  return ok ? ok.key : null;
}

const HEAVY_WEAPON = (Object.keys(WEAPON_DEFS) as (keyof typeof WEAPON_DEFS)[]).reduce((a, b) => (WEAPON_DEFS[b].powerDraw > WEAPON_DEFS[a].powerDraw ? b : a));

// The heaviest crafted set for `hull`, every piece in storage (installed on nothing), ids "em2-<n>".
function craftedSet(hull: ShipTypeKey): EquipmentInstance[] {
  const common = { blueprintKey: null, iLevel: 20, quality: 2, rarity: "augmented" as const, ascension: "none" as const };
  const out: EquipmentInstance[] = [];
  let n = 0;
  const id = () => `em2-${n++}`;
  SINGLE_SLOTS.forEach((slot, i) => {
    const variety = varietyFor(slot, hull);
    if (variety === null) return;
    out.push(generateEquipment({ ...common, slotType: slot as EquipmentSlotType, varietyKey: variety, rng: seededRng(0x51a7 + i * 7919), allocateId: id }));
  });
  for (let i = 0; i < SHIP_TYPES[hull].weaponHardpoints; i++) {
    out.push(generateWeapon({ ...common, weaponType: HEAVY_WEAPON, rng: seededRng(0xa11 + i), allocateId: id }));
  }
  for (let i = 0; i < (SHIP_TYPES[hull].droneBays ?? 0); i++) {
    out.push(generateDronePod({ ...common, droneRole: i % 2 === 0 ? "attack" : "defense", rng: seededRng(0xb22 + i), allocateId: id }));
  }
  return out.map((p) => ({ ...p, fittedToShipId: null }));
}

// ship-1 re-hulled to `hull` with its Standard Issue gear, the crafted set in storage.
function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  const s = installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
  return { ...s, equipment: [...s.equipment, ...craftedSet(hull)] };
}

const POWER_BUCKET: CrewBucket = { profession: "engineering", rarity: "standard", rank: 1, race: "martian", buff1Id: "eng.power", buff2Id: null, count: 20 };
function withPowerCrew(s: GameState): GameState {
  const officer = {
    id: "em2-officer",
    seat: "engineering" as const,
    name: "EM Engineer",
    race: "martian" as const,
    gender: "nonbinary" as const,
    rank: "ensign" as const,
    bonuses: [
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

const crafted = (s: GameState) => s.equipment.filter((e) => e.id.startsWith("em2-"));

// Hand install, piece by piece. A multi slot (weapon, drone pod) whose cells are full of Standard Issue swaps one out.
function handInstall(s0: GameState): { verdicts: string[]; state: GameState } {
  let s = s0;
  const verdicts: string[] = [];
  for (const piece of crafted(s0)) {
    let replacing: string | undefined;
    if (piece.slotType === "weapon" || piece.slotType === "droneBay") {
      const cap = piece.slotType === "weapon" ? SHIP_TYPES[s.ships[0].typeKey].weaponHardpoints : SHIP_TYPES[s.ships[0].typeKey].droneBays ?? 0;
      const mounted = s.equipment.filter((e) => e.fittedToShipId === SHIP && e.slotType === piece.slotType);
      if (mounted.length >= cap) replacing = mounted.find((e) => !e.id.startsWith("em2-"))?.id;
    }
    const gate = canFitEquipment(s, SHIP, piece.id, replacing);
    verdicts.push(gate.ok ? "ok" : gate.reason);
    if (gate.ok) s = fitEquipment(s, SHIP, piece.id, replacing);
  }
  return { verdicts, state: s };
}

function reactorSwapBack(s0: GameState): { verdict: string; state: GameState } {
  const core = generateStandardIssue({ slotType: "reactorCore", fittedToShipId: null, allocateId: () => "em2-si-core" });
  const s = { ...s0, equipment: [...s0.equipment, core] };
  const gate = canFitEquipment(s, SHIP, core.id);
  return { verdict: gate.ok ? "ok" : gate.reason, state: gate.ok ? fitEquipment(s, SHIP, core.id) : s };
}

function itemSide(s: GameState): string[] {
  return crafted(s).map((p) => installTargetsFor(s, p.id).map((t) => `${t.kind === "ship" ? t.shipId : "member"}:${t.ok ? "ok" : t.kind === "ship" ? t.refusal?.reason : t.reason}`).join(","));
}

function armoryLoadout(s0: GameState): { state: GameState; loadoutId: string } {
  const hull = s0.ships[0].typeKey;
  const made = createLoadout(s0, hull, "EM-2");
  let s = made.next;
  const loadoutId = made.loadoutId!;
  const used = new Set<string>();
  for (const def of loadoutSlotDefsForShipType(hull)) {
    const piece = crafted(s).find((p) => p.slotType === def.slotType && !used.has(p.id));
    if (piece === undefined) continue;
    used.add(piece.id);
    s = installIntoLoadout(s, loadoutId, def.key, piece.id);
  }
  return { state: s, loadoutId };
}

function armoryCheckOut(s0: GameState): string {
  const { state, loadoutId } = armoryLoadout(s0);
  const out = checkOutLoadout(state, loadoutId, SHIP);
  return `${out === state ? "refused" : "ok"}:${hash(out)}`;
}

function rosterApply(s0: GameState): string {
  const { state, loadoutId } = armoryLoadout(s0);
  const made = createRoster(state, { name: "EM-2", linkedLoadoutId: loadoutId, includePeople: false });
  const out = applyRoster(made.next, made.rosterId!, SHIP);
  return `${out.loadouts.find((l) => l.id === loadoutId)?.checkedOutToShipId === SHIP ? "ok" : "refused"}:${hash(out)}`;
}

function hullRow(hull: ShipTypeKey, crew: boolean): string {
  const s0 = crew ? withPowerCrew(hullState(hull)) : hullState(hull);
  const hand = handInstall(s0);
  const back = reactorSwapBack(hand.state);
  return [
    hand.verdicts.join(","),
    hash(hand.state),
    `${back.verdict}:${hash(back.state)}`,
    fnv(itemSide(s0).join("|")),
    armoryCheckOut(s0),
    rosterApply(s0),
  ].join(" ");
}

// Captured on 624b0c5 (feat/crew-0.14.0) before the EM-2 gate.
const GOLDEN: Record<string, string> = {
  "aurora:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok d529242b ok:82a90da9 72e71b72 ok:19d11d30 ok:67ce8578",
  "aurora:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 96e3a6c4 ok:ad607a0e 72e71b72 ok:a3f8c16b ok:38878e39",
  "battleship:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 45f1d1d0 ok:fecf3364 2ce44c8f ok:6f09f66c ok:8d3d4d0c",
  "battleship:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 763569f3 ok:3d2fd23f 2ce44c8f ok:ef4adc67 ok:c52ba75d",
  "carrier:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 9126d483 ok:eda418b7 efcd66f ok:402bbb6d ok:74ed6557",
  "carrier:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok b6e364c ok:5b708aa8 efcd66f ok:803e8da ok:638ebb5e",
  "destroyer:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 3c18cd66 ok:2a9a6bba 2e721647 ok:32912923 ok:b8a0681",
  "destroyer:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 339ff34f ok:4acf4547 2e721647 ok:9abdabe2 ok:9da93216",
  "eir:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok bafbd67f ok:e55c824d 72e71b72 ok:726e4dc8 ok:d42c1560",
  "eir:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 3f5e14f8 ok:c2e304c2 72e71b72 ok:f8a4b19b ok:95ffd29",
  "generalFreighter:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 3d194469 ok:b770bbe1 273e1933 ok:305aeb35 ok:e31c268f",
  "generalFreighter:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 9a4dfe66 ok:30f0459e 273e1933 ok:d1c983ca ok:293f4e",
  "orion:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok d0ef6684 ok:450c1ec 72e71b72 ok:ebc59fb8 ok:fc8062d0",
  "orion:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 1e83207d ok:c392edc1 72e71b72 ok:2dbb7345 ok:470f795f",
  "prospectorHauler:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 50267164 ok:942edd36 82f1d41f ok:10bbaea8 ok:f207f40",
  "prospectorHauler:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 4a7ec6cf ok:d6ddf175 82f1d41f ok:e25a502b ok:975cfe79",
  "prospectorMiner:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok fd45cc07 ok:b8848cd5 72e71b72 ok:6326054c ok:92e95d6c",
  "prospectorMiner:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok cfb2f2b8 ok:faba94e2 72e71b72 ok:3a2f10cf ok:19df46f5",
  "prospectorRunner:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok b376d478 ok:cab91360 72e71b72 ok:e9007b78 ok:32b31a10",
  "prospectorRunner:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 84daf245 ok:79e48989 72e71b72 ok:fdf51a65 ok:2fed57f",
};

describe("EM-2 goldens: every install path for the heaviest crafted loadout on every hull (P1: nothing refused)", () => {
  for (const hull of HULLS) {
    for (const crew of [false, true]) {
      it(`${hull}${crew ? " with the power-efficiency crew" : ""}`, () => {
        const row = hullRow(hull, crew);
        expect(row.split(" ")[0].split(",").every((v) => v === "ok"), row).toBe(true);
        expect(row).not.toMatch(/refused/);
        expect(row, `${hull}:${crew}`).toBe(GOLDEN[`${hull}:${crew ? "crew" : "bare"}`]);
      });
    }
  }
});
