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
  "aurora:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 43be2d52 ok:311d2c32 72e71b72 ok:81d925f1 ok:2549cb13",
  "aurora:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 80e991b1 ok:fde8d611 72e71b72 ok:c4bd9276 ok:adb241f2",
  "battleship:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 3c2e7b97 ok:38912d9 2ce44c8f ok:484bcd23 ok:93735281",
  "battleship:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 63fe4de0 ok:72f3ab86 2ce44c8f ok:5f1ba584 ok:1d292f94",
  "carrier:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok bbc74376 ok:4ea01758 efcd66f ok:b624594a ok:388f83ce",
  "carrier:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 821caa6d ok:1f8f7003 efcd66f ok:6682d219 ok:90a6c4cb",
  "destroyer:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 13f2791d ok:6dae165b 2e721647 ok:5ccf81aa ok:432c872e",
  "destroyer:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok cfbc681c ok:90975652 2e721647 ok:996beb2f ok:45cbc2d5",
  "eir:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 5f2fab6 ok:95d34d66 72e71b72 ok:2669aeb7 ok:65d5636d",
  "eir:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok f8b06535 ok:700e6c25 72e71b72 ok:ea648c70 ok:4ca438",
  "generalFreighter:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 9b213ea ok:4f4278a4 273e1933 ok:76546c58 ok:4529d70",
  "generalFreighter:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 1c85bbe1 ok:b550c0cf 273e1933 ok:2859bf0b ok:cf990459",
  "orion:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 51cbe1e1 ok:6e4567c7 72e71b72 ok:bbb117d7 ok:4d1c298d",
  "orion:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 32f073bc ok:bc3337aa 72e71b72 ok:84c16ac2 ok:f7162676",
  "prospectorHauler:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 974fe1fd ok:fa062605 82f1d41f ok:85883485 ok:92fc181f",
  "prospectorHauler:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 6ab272e2 ok:97f33c6a 82f1d41f ok:e8e5a01a ok:ee0dd1e",
  "prospectorMiner:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok e03eafa8 ok:90b53320 72e71b72 ok:dbdbff1 ok:bc770913",
  "prospectorMiner:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok adc57453 ok:2dd15a2b 72e71b72 ok:5955c9e6 ok:44e864e2",
  "prospectorRunner:bare": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 90e020bd ok:7a4b8617 72e71b72 ok:1b296095 ok:4261c6ef",
  "prospectorRunner:crew": "ok,ok,ok,ok,ok,ok,ok,ok,ok,ok 4834ded0 ok:e777ea02 72e71b72 ok:925df398 ok:c0b6c630",
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
