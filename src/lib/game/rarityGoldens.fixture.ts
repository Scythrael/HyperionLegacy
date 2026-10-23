// TEST-ONLY: the rarity readiness goldens (docs/plans/2026-10-23-rarity-readiness-plan.md slice RR-0), captured on the
// engine BEFORE any rarity engine edit (the CP-0 / G2-0 / SF-0 / gear wear step 1 pattern). Never imported by app code.
//
// Two groups:
//   LIVE     : everything a player can hold today (Standard, Augmented, Stellar, Radiant with ascension "none"), plus
//              the real mint path (inspectBlank), the craft preview, the live CREW Derelict band (crewGeneration.ts
//              GEN_RARITIES mints it), and the two live order readers (the reveal sort and auto-salvage keep-best) over
//              live pieces only. No rarity readiness slice may move a LIVE pin (answers 5 and 6).
//   RESERVED : Derelict items, Luminous, Constellar and every non-"none" ascension. EVERY key starts with the slice(s)
//              expected to move it ("rr3:", "rr4:", "rr7:", or a joined list such as "rr3+rr4+rr5:"), and the test checks that every RESERVED key
//              names an owner and that no pin mixes live and reserved values. A slice may move only pins it owns,
//              naming each move in its commit and carry note.
//
// Every generator cell records the rng draws it consumed (a counting lcg), so a slice that slides a draw in front of
// the affix picks moves a pin even when the stat lines happen to match. Member slots mint with a REAL blueprint key
// (the crafted member floor applies), every other slot with null (the generator's own path).

import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_RARITY_LADDER,
  EQUIPMENT_SLOTS,
  blueprintMintsEquipmentInstance,
  equipmentRarityLabel,
  freshState,
  isMemberSlotType,
  moduleEffectScale,
  rarityIndex,
  salvageDurationTicks,
  SALVAGE_EQUIPMENT_RARITY_MULTIPLIER,
  type EquipmentAscension,
  type EquipmentInstance,
  type EquipmentRarity,
} from "./model";
import {
  affixCount,
  computeBudget,
  craftedDefensiveImplicit,
  CRAFTED_DEFENSE_CAP_BASE,
  CRAFTED_DEFENSE_CAP_PER_LEVEL,
  CRAFTED_DEFENSE_HULL_BASE,
  CRAFTED_DEFENSE_HULL_PER_LEVEL,
  CRAFTED_DEFENSE_RECHARGE_BASE,
  CRAFTED_DEFENSE_RECHARGE_PER_LEVEL,
  generateDronePod,
  generateEquipment,
  generateWeapon,
  previewCraftOutcome,
} from "./itemgen";
import { WEAPON_DEFS, type WeaponId } from "./combat/weapons";
import { ROLE_TEMPLATE, type DroneRole } from "./combat/drones";
import { inspectBlank } from "./tick";
import { devMintFromBlueprint } from "./devMint";
import { itemScore } from "./archive";
import { sortRolledPieces } from "./inspectSort";
import { clampCrewRarity, crewRarityMultiplier } from "./crewRarity";
import { relicBandOf, relicStudyDurationTicks } from "./relics";
import { RELIC_BLANK_WEIGHTS } from "./relicBlanks";
import { SALVAGE_CEILING_THRESHOLDS, autoSalvageIsBetter } from "./salvage";
import { deserialize, migrate, serialize } from "./save";
import { hash } from "./firstRunsGoldens.fixture";

export const LIVE_BANDS: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];
export const RESERVED_BANDS: readonly EquipmentRarity[] = ["derelict", "luminous", "constellar"];
const LEGENDARY: readonly EquipmentRarity[] = ["luminous", "constellar"];
const ASCENDED: readonly EquipmentAscension[] = ["nova", "celestial"];
const ALL_ASCENSIONS: readonly EquipmentAscension[] = ["none", "nova", "celestial"];
const QUALITIES = [0, 3, 5];
const ILEVELS = [1, 20, 40];

// The owner prefix every RESERVED key carries: the slice(s) expected to move it.
export const RESERVED_OWNER = /^(rr[3-7])(\+(rr[3-7]))*:/;
// Which slice owns a reserved band's generator, dev mint and primitive pins: Derelict items move with RR-7's floor
// rule, the legendaries with RR-3's profile rows; any ascended pin also moves with RR-4.
// RR-5 relabel: a Luminous piece also moves with RR-5 (its legendary affix), a Constellar one with RR-6 (its set).
const BAND_OWNER: Readonly<Partial<Record<EquipmentRarity, string>>> = { derelict: "rr7", luminous: "rr3+rr5", constellar: "rr3+rr6" };
const ASCENDED_OWNER: Readonly<Partial<Record<EquipmentRarity, string>>> = { luminous: "rr3+rr4+rr5", constellar: "rr3+rr4+rr6" };

// A counting lcg: the same stream every run, plus how many draws were taken.
function countingRng(seed: number): { rng: () => number; draws: () => number } {
  let s = seed >>> 0;
  let n = 0;
  return {
    rng: () => {
      n++;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    },
    draws: () => n,
  };
}

// The seed of one sweep cell, stable and distinct per cell.
function cellSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h | 1;
}

// The live equipment slots (every EQUIPMENT_SLOTS entry with at least one variety).
export function liveSlots(): string[] {
  return Object.entries(EQUIPMENT_SLOTS)
    .filter(([, d]) => d.varieties.length > 0)
    .map(([k]) => k);
}

export function gearBlueprintKeys(): string[] {
  return Object.entries(BLUEPRINTS)
    .filter(([, bp]) => blueprintMintsEquipmentInstance(bp))
    .map(([k]) => k);
}

// The real blueprint that crafts a member slot's variety (so the crafted member floor applies), else null.
export function memberBlueprintFor(slot: string, varietyKey: string): string | null {
  if (!isMemberSlotType(slot as EquipmentInstance["slotType"])) return null;
  const hit = Object.entries(BLUEPRINTS).find(([, bp]) => bp.equipmentOutput?.slotType === slot && bp.equipmentOutput?.varietyKey === varietyKey);
  return hit ? hit[0] : null;
}

export type Cell = { piece: EquipmentInstance; draws: number };

export function equipmentCells(slot: string, rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[]): Cell[] {
  const out: Cell[] = [];
  for (const v of EQUIPMENT_SLOTS[slot].varieties) {
    for (const quality of qualities) {
      for (const iLevel of iLevels) {
        const c = countingRng(cellSeed(slot, v.key, rarity, ascension, quality, iLevel));
        const piece = generateEquipment({
          slotType: slot as EquipmentInstance["slotType"],
          varietyKey: v.key,
          blueprintKey: memberBlueprintFor(slot, v.key),
          iLevel,
          quality,
          rarity,
          ascension,
          rng: c.rng,
          allocateId: () => "equip-1",
        });
        out.push({ piece, draws: c.draws() });
      }
    }
  }
  return out;
}

export function weaponCells(rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[]): Cell[] {
  const out: Cell[] = [];
  for (const weaponType of Object.keys(WEAPON_DEFS) as WeaponId[]) {
    for (const quality of qualities) {
      for (const iLevel of iLevels) {
        const c = countingRng(cellSeed("weapon", weaponType, rarity, ascension, quality, iLevel));
        const piece = generateWeapon({ weaponType, blueprintKey: null, iLevel, quality, rarity, ascension, rng: c.rng, allocateId: () => "equip-1" });
        out.push({ piece, draws: c.draws() });
      }
    }
  }
  return out;
}

export function droneCells(rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[]): Cell[] {
  const out: Cell[] = [];
  for (const droneRole of Object.keys(ROLE_TEMPLATE) as DroneRole[]) {
    for (const quality of qualities) {
      for (const iLevel of iLevels) {
        const c = countingRng(cellSeed("drone", droneRole, rarity, ascension, quality, iLevel));
        const piece = generateDronePod({ droneRole, blueprintKey: null, iLevel, quality, rarity, ascension, rng: c.rng, allocateId: () => "equip-1" });
        out.push({ piece, draws: c.draws() });
      }
    }
  }
  return out;
}

// The generator sweep for one band and ascension: one pin per equipment slot, one for weapons, one for drone pods.
function generatorPins(rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[], prefix: string, tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of liveSlots()) out[`${prefix}gen:${slot}:${tag}`] = hash(equipmentCells(slot, rarity, ascension, qualities, iLevels));
  out[`${prefix}gen:weapon:${tag}`] = hash(weaponCells(rarity, ascension, qualities, iLevels));
  out[`${prefix}gen:drone:${tag}`] = hash(droneCells(rarity, ascension, qualities, iLevels));
  return out;
}

// The pure primitives for a set of bands and the rarity indices they read.
function primitivePins(bands: readonly EquipmentRarity[], indices: number[], prefix: string, tag: string): Record<string, string> {
  const affix = bands.map((r) => {
    const c = countingRng(cellSeed("affix", r));
    const lo = affixCount(r, () => 0);
    const hi = affixCount(r, () => 0.99);
    const value = affixCount(r, c.rng);
    return [r, rarityIndex(r), lo, hi, value, c.draws()];
  });
  const budget: number[] = [];
  const defensive: number[] = [];
  for (const iLevel of [1, 10, 20, 40]) {
    for (let q = 0; q <= 5; q++) {
      for (const idx of indices) {
        budget.push(computeBudget(iLevel, q, idx));
        defensive.push(
          craftedDefensiveImplicit(CRAFTED_DEFENSE_HULL_BASE, CRAFTED_DEFENSE_HULL_PER_LEVEL, iLevel, q, idx),
          craftedDefensiveImplicit(CRAFTED_DEFENSE_CAP_BASE, CRAFTED_DEFENSE_CAP_PER_LEVEL, iLevel, q, idx),
          craftedDefensiveImplicit(CRAFTED_DEFENSE_RECHARGE_BASE, CRAFTED_DEFENSE_RECHARGE_PER_LEVEL, iLevel, q, idx),
        );
      }
    }
  }
  const moduleScale = bands.map((r) => [0, 1, 2, 3, 4, 5].map((q) => moduleEffectScale(r, q)));
  return {
    [`${prefix}prim:affixCount:${tag}`]: hash(affix),
    [`${prefix}prim:computeBudget:${tag}`]: hash(budget),
    [`${prefix}prim:defensive:${tag}`]: hash(defensive),
    [`${prefix}prim:moduleScale:${tag}`]: hash(moduleScale),
  };
}

// The ITEM readers downstream of rarity, one pin per band (the crew readers are pinned separately: crew bands and item
// bands are owned by different rules).
function itemReader(r: EquipmentRarity): unknown {
  const score = [1, 20, 40].flatMap((iLevel) => [0, 5].map((quality) => itemScore({ rarity: r, quality, iLevel })));
  const salvage = [1, 40].flatMap((iLevel) => [0, 5].flatMap((quality) => [1, 3].map((tier) => salvageDurationTicks({ kind: "equipment", iLevel, quality, rarity: r, tier }))));
  return {
    index: rarityIndex(r),
    label: equipmentRarityLabel(r),
    score,
    salvage,
    salvageMult: SALVAGE_EQUIPMENT_RARITY_MULTIPLIER[r],
    relicBand: relicBandOf(r),
    relicStudy: relicStudyDurationTicks(r),
  };
}
const crewReader = (r: EquipmentRarity): unknown => ({ crewMult: crewRarityMultiplier(r), crewClamp: clampCrewRarity(r) });

// The real Fabricator / inspect mint for every gear blueprint at eight seeds and two crafting levels (live bands only:
// rollCraftedRarity produces Standard to Radiant).
function inspectPins(): Record<string, string> {
  const out: Record<string, string> = {};
  const base = freshState();
  for (const key of gearBlueprintKeys()) {
    const rows: unknown[] = [];
    for (const craftingLevel of [1, 40]) {
      for (let seed = 0; seed < 8; seed++) {
        const s = { ...base, craftingLevel, inspectSeed: seed, blanks: { [key]: new Decimal(1) } };
        const t = inspectBlank(s, key);
        rows.push(t === s ? null : t.equipment[t.equipment.length - 1]);
      }
    }
    out[`inspect:${key}`] = hash(rows);
  }
  return out;
}

function previewPins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of gearBlueprintKeys()) {
    out[`preview:${key}`] = hash([1, 40].map((craftingLevel) => previewCraftOutcome(BLUEPRINTS[key], { craftingLevel })));
  }
  return out;
}

// The Debug minter at one band, for every gear blueprint (quality 5, iLevel 40, the picker's defaults).
function devMintPin(rarity: EquipmentRarity): string {
  const rows = gearBlueprintKeys().map((key) => {
    const c = countingRng(cellSeed("devMint", key, rarity));
    const piece = devMintFromBlueprint({ blueprint: BLUEPRINTS[key], iLevel: 40, quality: 5, rarity, rng: c.rng, allocateId: () => "equip-1" });
    return { piece, draws: c.draws() };
  });
  return hash(rows);
}

// One cargo bay per (band, ascension) pair, through serialize, deserialize and migrate.
function loadPin(pairs: [EquipmentRarity, EquipmentAscension][]): string {
  const base = freshState();
  const pieces = pairs.map(([rarity, ascension], i) =>
    generateEquipment({
      slotType: "cargoBay",
      varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key,
      blueprintKey: null,
      iLevel: 20,
      quality: 3,
      rarity,
      ascension,
      rng: countingRng(cellSeed("load", rarity, ascension)).rng,
      allocateId: () => `equip-${100 + i}`,
    }),
  );
  const state = { ...base, equipment: [...base.equipment, ...pieces] };
  const save = deserialize(serialize(state, 1_700_000_000_000, 1_700_000_000_000));
  const loaded = save ? migrate(save, 12345) : null;
  return hash(loaded ? loaded.equipment : null);
}

// A fixed list of cargo bays over `bands` x quality {0, 5} x iLevel {1, 40} (x every ascension when asked), shuffled.
function orderPieces(bands: readonly EquipmentRarity[], ascensions: readonly EquipmentAscension[]): EquipmentInstance[] {
  const pieces: EquipmentInstance[] = [];
  let n = 0;
  for (const r of bands) {
    for (const ascension of ascensions) {
      for (const quality of [0, 5]) {
        for (const iLevel of [1, 40]) {
          pieces.push(
            generateEquipment({
              slotType: "cargoBay",
              varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key,
              blueprintKey: null,
              iLevel,
              quality,
              rarity: r,
              ascension,
              rng: countingRng(cellSeed("sort", r, ascension, quality, iLevel)).rng,
              allocateId: () => `equip-${++n}`,
            }),
          );
        }
      }
    }
  }
  return pieces.map((p, i) => ({ p, k: cellSeed("shuffle", i) })).sort((a, b) => a.k - b.k).map((x) => x.p);
}
// The reveal sort's order and the auto-salvage keep-best verdict over every ordered pair.
function sortPin(pieces: EquipmentInstance[]): string {
  return hash(sortRolledPieces(pieces).map((p) => p.id));
}
function keepBestPin(pieces: EquipmentInstance[]): string {
  return hash(pieces.map((a) => pieces.map((b) => (a === b ? "-" : autoSalvageIsBetter(a, b) ? "1" : "0")).join("")));
}

// Every LIVE pin, computed on the current engine.
export function computeLivePins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of LIVE_BANDS) Object.assign(out, generatorPins(r, "none", QUALITIES, ILEVELS, "", r));
  Object.assign(out, primitivePins(LIVE_BANDS, [1, 2, 3, 4], "", "live"));
  for (const r of LIVE_BANDS) out[`reader:${r}`] = hash({ ...(itemReader(r) as object), ...(crewReader(r) as object) });
  out["reader:crew:derelict"] = hash(crewReader("derelict")); // crew Derelict is a LIVE crew band (crewGeneration.ts)
  Object.assign(out, inspectPins());
  Object.assign(out, previewPins());
  for (const r of LIVE_BANDS) out[`devMint:${r}`] = devMintPin(r);
  out["load:live"] = loadPin(LIVE_BANDS.map((r) => [r, "none"]));
  const live = orderPieces(LIVE_BANDS, ["none"]);
  out["reader:sort:live"] = sortPin(live);
  out["reader:keepBest:live"] = keepBestPin(live);
  out["relic:blankWeights"] = hash(RELIC_BLANK_WEIGHTS);
  out["salvage:ceiling"] = hash(SALVAGE_CEILING_THRESHOLDS);
  return out;
}

// Every RESERVED pin, each key prefixed by its owner slice(s).
export function computeReservedPins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RESERVED_BANDS) Object.assign(out, generatorPins(r, "none", QUALITIES, ILEVELS, `${BAND_OWNER[r]}:`, r));
  for (const r of LEGENDARY) for (const a of ASCENDED) Object.assign(out, generatorPins(r, a, [5], [40], `${ASCENDED_OWNER[r]}:`, `${r}:${a}`));
  Object.assign(out, primitivePins(["derelict"], [0], "rr7:", "derelict"));
  Object.assign(out, primitivePins(LEGENDARY, [5], "rr3:", "legendary"));
  out["rr7:reader:derelict"] = hash(itemReader("derelict"));
  // A legendary crew is reserved (the crew cap is Stellar); RR-7 adds its multiplier rows.
  for (const r of LEGENDARY) out[`rr7:reader:${r}`] = hash({ ...(itemReader(r) as object), ...(crewReader(r) as object) });
  for (const r of RESERVED_BANDS) out[`${BAND_OWNER[r]}:devMint:${r}`] = devMintPin(r);
  out["rr7:load:derelict"] = loadPin(ALL_ASCENSIONS.map((a) => ["derelict", a]));
  out["rr3+rr4+rr5+rr6:load:legendary"] = loadPin(LEGENDARY.flatMap((r) => ALL_ASCENSIONS.map((a): [EquipmentRarity, EquipmentAscension] => [r, a])));
  out["rr4:load:liveAscended"] = loadPin(LIVE_BANDS.flatMap((r) => ASCENDED.map((a): [EquipmentRarity, EquipmentAscension] => [r, a])));
  const all = orderPieces(EQUIPMENT_RARITY_LADDER, ALL_ASCENSIONS);
  out["rr4+rr7:reader:sort:all"] = sortPin(all);
  out["rr4+rr7:reader:keepBest:all"] = keepBestPin(all);
  return out;
}

// The vacuity facts the test asserts (computed here so the test and the sweep share one definition): for every band,
// how many generator pieces carry more than one rolled line, and how many member pieces minted with a real blueprint.
export function sweepFacts(): { multiLine: Record<string, number>; memberWithBlueprint: number } {
  const multiLine: Record<string, number> = {};
  for (const r of EQUIPMENT_RARITY_LADDER) {
    const cells = [...liveSlots().flatMap((s) => equipmentCells(s, r, "none", [5], [40])), ...weaponCells(r, "none", [5], [40]), ...droneCells(r, "none", [5], [40])];
    multiLine[r] = cells.filter((c) => Object.keys(c.piece.rolledStats).length > 1).length;
  }
  let memberWithBlueprint = 0;
  for (const s of liveSlots()) for (const c of equipmentCells(s, "standard", "none", [0], [1])) if (c.piece.blueprintKey !== null) memberWithBlueprint++;
  return { multiLine, memberWithBlueprint };
}

// ===== The pins, captured on the RR-2 engine (069d19a) with the RR-0 review fixes, before any RR-3 edit =====
// RR_CAPTURE=<path> npx vitest run src/lib/game/rarityGoldens.test.ts writes a fresh record to <path>.

export const RARITY_GOLDENS_LIVE: Record<string, string> = {
  "gen:cargoBay:standard": "f7a75e4a",
  "gen:ftlDrive:standard": "93d12126",
  "gen:reactorCore:standard": "2181f0ae",
  "gen:specUtility:standard": "e4d7564",
  "gen:shieldEmitters:standard": "a7f5c66b",
  "gen:hullPlating:standard": "3a5670ee",
  "gen:bridge:standard": "6d47d065",
  "gen:quarters:standard": "958c7749",
  "gen:sensor:standard": "8682ce57",
  "gen:memberWeapon:standard": "a959c652",
  "gen:memberArmor:standard": "1d8aab7a",
  "gen:memberTool:standard": "b4161794",
  "gen:implant:standard": "32b26358",
  "gen:weapon:standard": "79730b58",
  "gen:drone:standard": "b7426995",
  "gen:cargoBay:augmented": "adfc2316",
  "gen:ftlDrive:augmented": "c1af925e",
  "gen:reactorCore:augmented": "2666a4ea",
  "gen:specUtility:augmented": "a439af20",
  "gen:shieldEmitters:augmented": "2822e2b8",
  "gen:hullPlating:augmented": "d6880499",
  "gen:bridge:augmented": "c88898ce",
  "gen:quarters:augmented": "8aae96ae",
  "gen:sensor:augmented": "a41a6d",
  "gen:memberWeapon:augmented": "d4ad5378",
  "gen:memberArmor:augmented": "a884404d",
  "gen:memberTool:augmented": "55dafc13",
  "gen:implant:augmented": "a5a3fd12",
  "gen:weapon:augmented": "dabecc23",
  "gen:drone:augmented": "7a3d5766",
  "gen:cargoBay:stellar": "cbac11a6",
  "gen:ftlDrive:stellar": "ce086914",
  "gen:reactorCore:stellar": "bf8964f6",
  "gen:specUtility:stellar": "ffc63091",
  "gen:shieldEmitters:stellar": "943aa5c6",
  "gen:hullPlating:stellar": "a86f7ddd",
  "gen:bridge:stellar": "3f82ed2c",
  "gen:quarters:stellar": "f66dfcac",
  "gen:sensor:stellar": "f248d0e1",
  "gen:memberWeapon:stellar": "5e6c563f",
  "gen:memberArmor:stellar": "43b8931d",
  "gen:memberTool:stellar": "b6054259",
  "gen:implant:stellar": "6aafb120",
  "gen:weapon:stellar": "5af0878e",
  "gen:drone:stellar": "61a2da39",
  "gen:cargoBay:radiant": "fc0b0597",
  "gen:ftlDrive:radiant": "29fe699f",
  "gen:reactorCore:radiant": "65d4ad4d",
  "gen:specUtility:radiant": "bc594de8",
  "gen:shieldEmitters:radiant": "aee3ff13",
  "gen:hullPlating:radiant": "9f4ba049",
  "gen:bridge:radiant": "5ced7277",
  "gen:quarters:radiant": "c450311",
  "gen:sensor:radiant": "c68d9797",
  "gen:memberWeapon:radiant": "b1fb4b4d",
  "gen:memberArmor:radiant": "89fc7702",
  "gen:memberTool:radiant": "fd51e9b",
  "gen:implant:radiant": "ca30410a",
  "gen:weapon:radiant": "bac4e5b7",
  "gen:drone:radiant": "8b1d5274",
  "prim:affixCount:live": "7edbff18",
  "prim:computeBudget:live": "719d2d0d",
  "prim:defensive:live": "a7a5d287",
  "prim:moduleScale:live": "2f983e90",
  "reader:standard": "5a8512fb",
  "reader:augmented": "be77453c",
  "reader:stellar": "9347d5af",
  "reader:radiant": "1f276efa",
  "reader:crew:derelict": "a28e02d7",
  "inspect:prospectorHoldBp": "b75d1a44",
  "inspect:balancedHoldBp": "e95e8b92",
  "inspect:haulerHoldBp": "e5d1cdd9",
  "inspect:sprintDriveBp": "6154431b",
  "inspect:economyDriveBp": "9dcc34cd",
  "inspect:balancedDriveBp": "e45bae94",
  "inspect:classIIDriveBp": "e989e66",
  "inspect:classIIIDriveBp": "d6647f2d",
  "inspect:classIVDriveBp": "81f7cea2",
  "inspect:classVDriveBp": "436d07d4",
  "inspect:classVIDriveBp": "b6e7b75",
  "inspect:classVIIDriveBp": "cb3bb415",
  "inspect:highOutputCoreBp": "265892d",
  "inspect:efficientCoreBp": "3cbeef47",
  "inspect:balancedCoreBp": "cdce0854",
  "inspect:yieldRigBp": "3931faf5",
  "inspect:surveyRigBp": "1d1ece5c",
  "inspect:refineryFeedRigBp": "15ae1b28",
  "inspect:plasmaBp": "7e0ec7bc",
  "inspect:gravitonBp": "6460172c",
  "inspect:voltaicBp": "8a7f8c45",
  "inspect:autocannonBp": "128d4802",
  "inspect:railgunBp": "217fecda",
  "inspect:concussionTorpedoBp": "a0d47e6c",
  "inspect:pointDefenseArrayBp": "498baaa7",
  "inspect:empCannonBp": "a7066380",
  "inspect:tachyonBurstEmitterBp": "193bc6e3",
  "inspect:attackDronePodBp": "dc533a14",
  "inspect:defenseDronePodBp": "f4b25f03",
  "inspect:supportDronePodBp": "ae6c771e",
  "inspect:balancedEmitterBp": "fd93516c",
  "inspect:rechargeArrayBp": "aab79776",
  "inspect:capacitorBankBp": "9b5fd7d2",
  "inspect:reinforcedPlatingBp": "afe2006b",
  "inspect:ablativePlatingBp": "e22d4856",
  "inspect:compositePlatingBp": "e80ace8b",
  "inspect:damageControlSuiteBp": "71b63513",
  "inspect:pathfinderSuiteBp": "f043010",
  "inspect:bioResonanceArrayBp": "4fbe6d8c",
  "inspect:pulseRifleBp": "9d4167bf",
  "inspect:scattergunBp": "27aab93e",
  "inspect:shockBatonBp": "44f94343",
  "inspect:sidearmBp": "43fd8231",
  "inspect:ballisticWeaveBp": "e231eee7",
  "inspect:assaultHardsuitBp": "52b37d6e",
  "inspect:fieldSuitBp": "a4853827",
  "inspect:hazardSuitBp": "4786a749",
  "inspect:stunGrenadeBp": "fb62b911",
  "inspect:toxinGrenadeBp": "b7c2fbcf",
  "inspect:impactGrenadeBp": "119fc593",
  "inspect:medKitBp": "2725e461",
  "inspect:shroudEmitterBp": "da005e8",
  "inspect:lureBeaconBp": "dbfb084f",
  "inspect:floraScannerBp": "4a6c341a",
  "inspect:thermalRigBp": "28c54acf",
  "inspect:coreDrillBp": "67b03e84",
  "inspect:decryptorBp": "5d0a8182",
  "inspect:atmoProbeBp": "51ce54d3",
  "inspect:dermalWeaveBp": "9bc633d7",
  "inspect:reflexBoosterBp": "455f0eb7",
  "inspect:targetingOpticBp": "23d110e5",
  "inspect:adrenalSurgeBp": "c4d9ad59",
  "inspect:medNaniteSwarmBp": "ab9bf697",
  "inspect:toxinFiltersBp": "a52013c3",
  "inspect:cortexShieldBp": "b78276ca",
  "inspect:synapticAcceleratorBp": "42e1041a",
  "inspect:archaeoScannerBp": "404994b6",
  "inspect:environmentalAdaptationBp": "17048e53",
  "inspect:cipherWetwareBp": "3671837c",
  "inspect:bioAnalyzerBp": "78ed625",
  "inspect:neuralBackupBp": "2938d2e3",
  "preview:prospectorHoldBp": "55c9731f",
  "preview:balancedHoldBp": "8115553d",
  "preview:haulerHoldBp": "f06d2e7f",
  "preview:sprintDriveBp": "162bef0c",
  "preview:economyDriveBp": "60803030",
  "preview:balancedDriveBp": "808e6d2c",
  "preview:classIIDriveBp": "9eb9545a",
  "preview:classIIIDriveBp": "9eb9545a",
  "preview:classIVDriveBp": "9eb9545a",
  "preview:classVDriveBp": "9eb9545a",
  "preview:classVIDriveBp": "9eb9545a",
  "preview:classVIIDriveBp": "9eb9545a",
  "preview:highOutputCoreBp": "a676ed3d",
  "preview:efficientCoreBp": "3752ff71",
  "preview:balancedCoreBp": "7f3e41b",
  "preview:yieldRigBp": "cca996eb",
  "preview:surveyRigBp": "f5e25e3d",
  "preview:refineryFeedRigBp": "c84f9179",
  "preview:plasmaBp": "872e08cb",
  "preview:gravitonBp": "8c08bdc7",
  "preview:voltaicBp": "8c08bdc7",
  "preview:autocannonBp": "872e08cb",
  "preview:railgunBp": "8c08bdc7",
  "preview:concussionTorpedoBp": "8c08bdc7",
  "preview:pointDefenseArrayBp": "872e08cb",
  "preview:empCannonBp": "8c08bdc7",
  "preview:tachyonBurstEmitterBp": "8c08bdc7",
  "preview:attackDronePodBp": "d92e136b",
  "preview:defenseDronePodBp": "92e9eda1",
  "preview:supportDronePodBp": "92e9eda1",
  "preview:balancedEmitterBp": "21e89deb",
  "preview:rechargeArrayBp": "5e767f2f",
  "preview:capacitorBankBp": "6f329b8",
  "preview:reinforcedPlatingBp": "37e12a89",
  "preview:ablativePlatingBp": "24d077df",
  "preview:compositePlatingBp": "20a3bd73",
  "preview:damageControlSuiteBp": "ce238072",
  "preview:pathfinderSuiteBp": "2ede4dfa",
  "preview:bioResonanceArrayBp": "f756f73",
  "preview:pulseRifleBp": "f3963d0c",
  "preview:scattergunBp": "a6fb5a17",
  "preview:shockBatonBp": "cc4b2621",
  "preview:sidearmBp": "1b7e9c2a",
  "preview:ballisticWeaveBp": "459f5f",
  "preview:assaultHardsuitBp": "5f04687b",
  "preview:fieldSuitBp": "3b19c0ca",
  "preview:hazardSuitBp": "14aa5b02",
  "preview:stunGrenadeBp": "40e748e4",
  "preview:toxinGrenadeBp": "413a9d32",
  "preview:impactGrenadeBp": "e3286966",
  "preview:medKitBp": "8fbc09fb",
  "preview:shroudEmitterBp": "43af2d48",
  "preview:lureBeaconBp": "2363f480",
  "preview:floraScannerBp": "22c4d16b",
  "preview:thermalRigBp": "c1f400a7",
  "preview:coreDrillBp": "bf60c82d",
  "preview:decryptorBp": "c4ba5416",
  "preview:atmoProbeBp": "c7e6f027",
  "preview:dermalWeaveBp": "5a49faa4",
  "preview:reflexBoosterBp": "2dbff5d8",
  "preview:targetingOpticBp": "3e9dc23c",
  "preview:adrenalSurgeBp": "a584e9aa",
  "preview:medNaniteSwarmBp": "2c3a47c0",
  "preview:toxinFiltersBp": "dd781ce2",
  "preview:cortexShieldBp": "162d45a8",
  "preview:synapticAcceleratorBp": "b8bf538e",
  "preview:archaeoScannerBp": "a72ce000",
  "preview:environmentalAdaptationBp": "a3a4b444",
  "preview:cipherWetwareBp": "2c7130b2",
  "preview:bioAnalyzerBp": "53496a2",
  "preview:neuralBackupBp": "b796b970",
  "devMint:standard": "96cf7767",
  "devMint:augmented": "bfa85856",
  "devMint:stellar": "288ab90b",
  "devMint:radiant": "b5319e5c",
  "load:live": "65df3b5",
  "reader:sort:live": "41f00022",
  "reader:keepBest:live": "2f53247d",
  "relic:blankWeights": "42928ab7",
  // RR-7 moved this pin ON PURPOSE: a fifth SALVAGE_CEILING_THRESHOLDS row (FA 20, index 4). Data only: every pool has
  // four tiers and the ceiling is clamped to the pool, so no live roll changed (every other LIVE pin is unchanged).
  "salvage:ceiling": "f1dbfa0b",
};

export const RARITY_GOLDENS_RESERVED: Record<string, string> = {
  "rr7:gen:cargoBay:derelict": "c7e1df93",
  "rr7:gen:ftlDrive:derelict": "a73307c9",
  "rr7:gen:reactorCore:derelict": "e31456d1",
  "rr7:gen:specUtility:derelict": "b9a8e502",
  "rr7:gen:shieldEmitters:derelict": "8003534e",
  "rr7:gen:hullPlating:derelict": "e6e86e5c",
  "rr7:gen:bridge:derelict": "1f769c59",
  "rr7:gen:quarters:derelict": "101f8d3d",
  "rr7:gen:sensor:derelict": "8829f143",
  "rr7:gen:memberWeapon:derelict": "3701ddfb",
  "rr7:gen:memberArmor:derelict": "e4e83ac6",
  "rr7:gen:memberTool:derelict": "7147ba2",
  "rr7:gen:implant:derelict": "408d4747",
  "rr7:gen:weapon:derelict": "5a11ab79",
  "rr7:gen:drone:derelict": "3cf1b36f",
  "rr3+rr5:gen:cargoBay:luminous": "a8d92fbe",
  "rr3+rr5:gen:ftlDrive:luminous": "66db7d7f",
  "rr3+rr5:gen:reactorCore:luminous": "293545c8",
  "rr3+rr5:gen:specUtility:luminous": "df58689c",
  "rr3+rr5:gen:shieldEmitters:luminous": "fcf748e3",
  "rr3+rr5:gen:hullPlating:luminous": "c7481392",
  "rr3+rr5:gen:bridge:luminous": "28dd30c7",
  "rr3+rr5:gen:quarters:luminous": "9a137d24",
  "rr3+rr5:gen:sensor:luminous": "9bd06898",
  "rr3+rr5:gen:memberWeapon:luminous": "5c535688",
  "rr3+rr5:gen:memberArmor:luminous": "e462989f",
  "rr3+rr5:gen:memberTool:luminous": "abedaba9",
  "rr3+rr5:gen:implant:luminous": "e1342d5",
  "rr3+rr5:gen:weapon:luminous": "5f134cba",
  "rr3+rr5:gen:drone:luminous": "ebed0d55",
  "rr3+rr6:gen:cargoBay:constellar": "e04f4179",
  "rr3+rr6:gen:ftlDrive:constellar": "60bd67b3",
  "rr3+rr6:gen:reactorCore:constellar": "54ada60a",
  "rr3+rr6:gen:specUtility:constellar": "eecf342e",
  "rr3+rr6:gen:shieldEmitters:constellar": "4cc80068",
  "rr3+rr6:gen:hullPlating:constellar": "d1c52612",
  "rr3+rr6:gen:bridge:constellar": "d0bcb7b6",
  "rr3+rr6:gen:quarters:constellar": "a6850aab",
  "rr3+rr6:gen:sensor:constellar": "685d26ce",
  "rr3+rr6:gen:memberWeapon:constellar": "2a993db7",
  "rr3+rr6:gen:memberArmor:constellar": "4862f76c",
  "rr3+rr6:gen:memberTool:constellar": "40998bd5",
  "rr3+rr6:gen:implant:constellar": "99dc28af",
  "rr3+rr6:gen:weapon:constellar": "9817dbec",
  "rr3+rr6:gen:drone:constellar": "c536703a",
  "rr3+rr4+rr5:gen:cargoBay:luminous:nova": "15ea49d3",
  "rr3+rr4+rr5:gen:ftlDrive:luminous:nova": "fd457e4b",
  "rr3+rr4+rr5:gen:reactorCore:luminous:nova": "edaadd4d",
  "rr3+rr4+rr5:gen:specUtility:luminous:nova": "8cfdf36b",
  "rr3+rr4+rr5:gen:shieldEmitters:luminous:nova": "6028d515",
  "rr3+rr4+rr5:gen:hullPlating:luminous:nova": "7870056a",
  "rr3+rr4+rr5:gen:bridge:luminous:nova": "967e02ea",
  "rr3+rr4+rr5:gen:quarters:luminous:nova": "3b878af5",
  "rr3+rr4+rr5:gen:sensor:luminous:nova": "1b8d3a25",
  "rr3+rr4+rr5:gen:memberWeapon:luminous:nova": "eefbd88b",
  "rr3+rr4+rr5:gen:memberArmor:luminous:nova": "3d3040fb",
  "rr3+rr4+rr5:gen:memberTool:luminous:nova": "a84da39c",
  "rr3+rr4+rr5:gen:implant:luminous:nova": "c4003168",
  "rr3+rr4+rr5:gen:weapon:luminous:nova": "b10f4101",
  "rr3+rr4+rr5:gen:drone:luminous:nova": "8aaa3996",
  "rr3+rr4+rr5:gen:cargoBay:luminous:celestial": "fe2683ca",
  "rr3+rr4+rr5:gen:ftlDrive:luminous:celestial": "6bc34aaf",
  "rr3+rr4+rr5:gen:reactorCore:luminous:celestial": "45ebac44",
  "rr3+rr4+rr5:gen:specUtility:luminous:celestial": "a205cbe3",
  "rr3+rr4+rr5:gen:shieldEmitters:luminous:celestial": "4c2d3c29",
  "rr3+rr4+rr5:gen:hullPlating:luminous:celestial": "6db4186a",
  "rr3+rr4+rr5:gen:bridge:luminous:celestial": "426a671b",
  "rr3+rr4+rr5:gen:quarters:luminous:celestial": "fe9d55cd",
  "rr3+rr4+rr5:gen:sensor:luminous:celestial": "68cf8049",
  "rr3+rr4+rr5:gen:memberWeapon:luminous:celestial": "7704e474",
  "rr3+rr4+rr5:gen:memberArmor:luminous:celestial": "bc908f6f",
  "rr3+rr4+rr5:gen:memberTool:luminous:celestial": "4363f751",
  "rr3+rr4+rr5:gen:implant:luminous:celestial": "84a67023",
  "rr3+rr4+rr5:gen:weapon:luminous:celestial": "dd098c5",
  "rr3+rr4+rr5:gen:drone:luminous:celestial": "13032fbf",
  "rr3+rr4+rr6:gen:cargoBay:constellar:nova": "17f8a182",
  "rr3+rr4+rr6:gen:ftlDrive:constellar:nova": "d57802ff",
  "rr3+rr4+rr6:gen:reactorCore:constellar:nova": "b75c8f8a",
  "rr3+rr4+rr6:gen:specUtility:constellar:nova": "f4c6966f",
  "rr3+rr4+rr6:gen:shieldEmitters:constellar:nova": "7455dd",
  "rr3+rr4+rr6:gen:hullPlating:constellar:nova": "19254032",
  "rr3+rr4+rr6:gen:bridge:constellar:nova": "73f8ff7a",
  "rr3+rr4+rr6:gen:quarters:constellar:nova": "a7758635",
  "rr3+rr4+rr6:gen:sensor:constellar:nova": "a84271e9",
  "rr3+rr4+rr6:gen:memberWeapon:constellar:nova": "2daee133",
  "rr3+rr4+rr6:gen:memberArmor:constellar:nova": "3a0d4d2c",
  "rr3+rr4+rr6:gen:memberTool:constellar:nova": "49a03050",
  "rr3+rr4+rr6:gen:implant:constellar:nova": "c6c7b299",
  "rr3+rr4+rr6:gen:weapon:constellar:nova": "51da89d1",
  "rr3+rr4+rr6:gen:drone:constellar:nova": "b27cc182",
  "rr3+rr4+rr6:gen:cargoBay:constellar:celestial": "cf791988",
  "rr3+rr4+rr6:gen:ftlDrive:constellar:celestial": "78c4f7d6",
  "rr3+rr4+rr6:gen:reactorCore:constellar:celestial": "34cfad8c",
  "rr3+rr4+rr6:gen:specUtility:constellar:celestial": "c065579a",
  "rr3+rr4+rr6:gen:shieldEmitters:constellar:celestial": "649e2d16",
  "rr3+rr4+rr6:gen:hullPlating:constellar:celestial": "4ece97e2",
  "rr3+rr4+rr6:gen:bridge:constellar:celestial": "6f3076cf",
  "rr3+rr4+rr6:gen:quarters:constellar:celestial": "9649818e",
  "rr3+rr4+rr6:gen:sensor:constellar:celestial": "f1fe5be9",
  "rr3+rr4+rr6:gen:memberWeapon:constellar:celestial": "71d4b931",
  "rr3+rr4+rr6:gen:memberArmor:constellar:celestial": "4045c4d1",
  "rr3+rr4+rr6:gen:memberTool:constellar:celestial": "f2655564",
  "rr3+rr4+rr6:gen:implant:constellar:celestial": "30b49cd5",
  "rr3+rr4+rr6:gen:weapon:constellar:celestial": "c3f9ee71",
  "rr3+rr4+rr6:gen:drone:constellar:celestial": "26afb66",
  "rr7:prim:affixCount:derelict": "839a4eab",
  "rr7:prim:computeBudget:derelict": "3c03ed4f",
  "rr7:prim:defensive:derelict": "799ebe44",
  "rr7:prim:moduleScale:derelict": "f7a36064",
  "rr3:prim:affixCount:legendary": "950c7d2c",
  "rr3:prim:computeBudget:legendary": "91677598",
  "rr3:prim:defensive:legendary": "435a5bc9",
  "rr3:prim:moduleScale:legendary": "69dd98d",
  "rr7:reader:derelict": "7bc5eb34",
  "rr7:reader:luminous": "b6ca9bca",
  "rr7:reader:constellar": "d4ca1b1d",
  "rr7:devMint:derelict": "8c8a304d",
  "rr3+rr5:devMint:luminous": "88c12560",
  "rr3+rr6:devMint:constellar": "6386b563",
  "rr7:load:derelict": "8fc1e0c",
  "rr3+rr4+rr5+rr6:load:legendary": "5df90d5b",
  "rr4:load:liveAscended": "7edccefb",
  "rr4+rr7:reader:sort:all": "4c7835e3",
  "rr4+rr7:reader:keepBest:all": "850d5189",
};
