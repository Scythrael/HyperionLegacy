// E-MOD EM-5 goldens (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-5): captured on
// the code BEFORE the module slot and catalog engine, so the EM-5 commit proves a module-free fleet is byte-identical
// (the module slot, the moduleSlots cap, the moduleSlotsFull / duplicateModule refusals and the module effect folds all
// read nothing on a ship with no module installed).
//
//   verdicts : canFitEquipment for every crafted single-slot spare, an extra Standard-Issue Spec Utility and the
//              crafted weapons / pods, on every hull, with the Spec Utility installed and again with it removed (the
//              moduleSlots cap also counts the Spec Utility, user M1 2026-10-17 "Separate counts").
//   combat   : the player combatant (shipToCombatant, the fold every patrol, ship event and replay builds through) for
//              every hull with its Standard-Issue set and with the full crafted set installed.
//   mint     : generateEquipment for every slot and variety at a fixed roll (the mint path gains the module branch).
//   loadout  : the Armory slot set for every hull (loadoutSlotDefsForShipType: module slots stay hidden while the
//              modules switch is off).
// The EM-0 sheet / patrol / mission pins (emodGoldens.test.ts) and the EM-2 install path pins (emodEm2Goldens.test.ts)
// cover the power budget and every install path; this file adds only what EM-5 edits.

import { describe, expect, it } from "vitest";
import { withoutGg7Content } from "./gasGiantSpecials.fixture";
import Decimal from "break_infinity.js";
import {
  EQUIPMENT_SLOTS,
  SHIP_TYPES,
  freshState,
  generateStandardIssue,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { installMissingCombatBaselines } from "./tick";
import { WEAPON_DEFS } from "./combat/weapons";
import { generateDronePod, generateEquipment, generateWeapon } from "./itemgen";
import { canFitEquipment, equippedFor, fitEquipment, unfitEquipmentInstance } from "./equipment";
import { loadoutSlotDefsForShipType } from "./armory";
import { shipToCombatant } from "./combat/bridge";
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

// The crafted set for `hull` in storage, ids "em5-<n>", plus one extra Standard-Issue Spec Utility spare.
function craftedSet(hull: ShipTypeKey): EquipmentInstance[] {
  const common = { blueprintKey: null, iLevel: 20, quality: 2, rarity: "augmented" as const, ascension: "none" as const };
  const out: EquipmentInstance[] = [];
  let n = 0;
  const id = () => `em5-${n++}`;
  SINGLE_SLOTS.forEach((slot, i) => {
    const variety = varietyFor(slot, hull);
    if (variety === null) return;
    out.push(generateEquipment({ ...common, slotType: slot as EquipmentSlotType, varietyKey: variety, rng: seededRng(0x5e5 + i * 7919), allocateId: id }));
  });
  for (let i = 0; i < SHIP_TYPES[hull].weaponHardpoints; i++) {
    out.push(generateWeapon({ ...common, weaponType: HEAVY_WEAPON, rng: seededRng(0xe51 + i), allocateId: id }));
  }
  for (let i = 0; i < (SHIP_TYPES[hull].droneBays ?? 0); i++) {
    out.push(generateDronePod({ ...common, droneRole: i % 2 === 0 ? "attack" : "support", rng: seededRng(0xe52 + i), allocateId: id }));
  }
  out.push(generateStandardIssue({ slotType: "specUtility", fittedToShipId: null, allocateId: id }));
  return out.map((p) => ({ ...p, fittedToShipId: null }));
}

function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  const s = installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
  return { ...s, equipment: [...s.equipment, ...craftedSet(hull)] };
}

const spares = (s: GameState) => s.equipment.filter((e) => e.id.startsWith("em5-"));
const verdictText = (s: GameState, id: string): string => {
  const v = canFitEquipment(s, SHIP, id);
  return v.ok ? "ok" : v.reason;
};

function verdictRow(hull: ShipTypeKey): string {
  const s = hullState(hull);
  const withUtility = spares(s).map((p) => verdictText(s, p.id)).join(",");
  const utility = equippedFor(s, SHIP).find((e) => e.slotType === "specUtility");
  const bare = utility ? unfitEquipmentInstance(s, SHIP, utility.id) : s;
  const withoutUtility = spares(bare).map((p) => verdictText(bare, p.id)).join(",");
  return `${withUtility} | ${withoutUtility}`;
}

// Every crafted piece installed (a multi slot fills its cells, swapping out the Standard Issue).
function fullyInstalled(hull: ShipTypeKey): GameState {
  let s = hullState(hull);
  for (const piece of spares(s)) {
    if (piece.blueprintKey === null && piece.rarity === "standard") continue; // the extra Standard-Issue spare stays in storage
    let replacing: string | undefined;
    if (piece.slotType === "weapon" || piece.slotType === "droneBay") {
      const cap = piece.slotType === "weapon" ? SHIP_TYPES[hull].weaponHardpoints : SHIP_TYPES[hull].droneBays ?? 0;
      const mounted = s.equipment.filter((e) => e.fittedToShipId === SHIP && e.slotType === piece.slotType);
      if (mounted.length >= cap) replacing = mounted.find((e) => !e.id.startsWith("em5-"))?.id;
    }
    if (canFitEquipment(s, SHIP, piece.id, replacing).ok) s = fitEquipment(s, SHIP, piece.id, replacing);
  }
  return s;
}

function combatRow(hull: ShipTypeKey): string {
  const si = hullState(hull);
  const full = fullyInstalled(hull);
  const fold = (s: GameState) => shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES[hull], installedGear: equippedFor(s, SHIP) });
  return `${hash(fold(si))} ${hash(fold(full))}`;
}

function mintRow(): string[] {
  const out: string[] = [];
  for (const [slotType, slot] of Object.entries(EQUIPMENT_SLOTS)) {
    // E-MOD EM-7 came after this capture: the module slot's varieties (the v1 roster) are held apart
    // (shipModuleRoster.test.ts pins their mints).
    if (slotType === "module") continue;
    slot.varieties.forEach((v, i) => {
      for (const rarity of ["standard", "radiant"] as const) {
        const piece = generateEquipment({
          slotType: slotType as EquipmentSlotType,
          varietyKey: v.key,
          blueprintKey: null,
          iLevel: 30,
          quality: 3,
          rarity,
          ascension: "none",
          rng: seededRng(0x5e50 + i * 31 + (rarity === "radiant" ? 7 : 0)),
          allocateId: () => "em5-mint",
        });
        out.push(`${slotType}:${v.key}:${rarity}:${hash(piece)}`);
      }
    });
  }
  return out;
}

// E-MOD EM-7 flipped UNIVERSAL_MODULES_LIVE after this capture: the slot set is read with the switch off (the
// function's own test hook), so the pin keeps proving EM-5 moved nothing; emodEm7Goldens.test.ts pins the flip.
function loadoutRow(hull: ShipTypeKey): string {
  return loadoutSlotDefsForShipType(hull, false).map((d) => `${d.key}/${d.slotType}/${d.group}`).join(",");
}

// Captured on f85ef73 (feat/crew-0.14.0) before EM-5.
const GOLDEN: Record<string, string> = {
  "combat:aurora": "d5761347 a83f4c94",
  "combat:battleship": "51f78d5 e521fc70",
  "combat:carrier": "e7476ba8 cd7ca02b",
  "combat:destroyer": "9c575b32 e5d8078c",
  "combat:eir": "7458f0cb 5ec927d0",
  "combat:generalFreighter": "89fea74d 9469bb5a",
  "combat:orion": "66e7c3fd f049f454",
  "combat:prospectorHauler": "6aa71210 e76cef2c",
  "combat:prospectorMiner": "83d03bea b3540a17",
  "combat:prospectorRunner": "a0643b18 c355c7b3",
  "loadout:aurora": "weapon0/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:battleship": "weapon0/weapon/offense,weapon1/weapon/offense,weapon2/weapon/offense,weapon3/weapon/offense,weapon4/weapon/offense,weapon5/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:carrier": "weapon0/weapon/offense,weapon1/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,droneBay0/droneBay/defense,droneBay1/droneBay/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:destroyer": "weapon0/weapon/offense,weapon1/weapon/offense,weapon2/weapon/offense,weapon3/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:eir": "weapon0/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:generalFreighter": "weapon0/weapon/offense,weapon1/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems",
  "loadout:orion": "weapon0/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:prospectorHauler": "weapon0/weapon/offense,weapon1/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:prospectorMiner": "weapon0/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "loadout:prospectorRunner": "weapon0/weapon/offense,shieldEmitters/shieldEmitters/defense,hullPlating/hullPlating/defense,cargoBay/cargoBay/systems,ftlDrive/ftlDrive/systems,reactorCore/reactorCore/systems,specUtility/specUtility/systems",
  "verdicts:aurora": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hullSpec | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hullSpec",
  "verdicts:battleship": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hullSpec | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hullSpec",
  "verdicts:carrier": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,ok,ok,hullSpec | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,ok,ok,hullSpec",
  "verdicts:destroyer": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hullSpec | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,hardpointsFull,hardpointsFull,hullSpec",
  "verdicts:eir": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hullSpec | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hullSpec",
  "verdicts:generalFreighter": "ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,hullSpec | ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,hullSpec",
  "verdicts:orion": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hullSpec | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hullSpec",
  "verdicts:prospectorHauler": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,ok | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,hardpointsFull,ok",
  "verdicts:prospectorMiner": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,ok | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,ok",
  "verdicts:prospectorRunner": "ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,ok | ok,ok,ok,ok,ok,ok,ok,ok,ok,hardpointsFull,ok",
};
const MINT_GOLDEN = "3a0e794a";

describe("EM-5 goldens: a module-free fleet is byte-identical", () => {
  for (const hull of HULLS) {
    it(`${hull}: install verdicts with and without the Spec Utility`, () => {
      expect(verdictRow(hull)).toBe(GOLDEN[`verdicts:${hull}`]);
    });
    it(`${hull}: the player combatant, Standard Issue and fully crafted`, () => {
      expect(combatRow(hull)).toBe(GOLDEN[`combat:${hull}`]);
    });
    it(`${hull}: the Armory slot set`, () => {
      expect(loadoutRow(hull)).toBe(GOLDEN[`loadout:${hull}`]);
    });
  }
  it("mint: every slot and variety at a fixed roll", () => {
    // GG-7 (after this capture): its three slot varieties held apart (gasGiantSpecials.fixture.ts).
    expect(fnv(withoutGg7Content(() => mintRow()).join("|"))).toBe(MINT_GOLDEN);
  });
});
