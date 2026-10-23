// TEST-ONLY: the rarity readiness goldens (docs/plans/2026-10-23-rarity-readiness-plan.md slice RR-0), captured on the
// engine BEFORE any rarity engine edit (the CP-0 / G2-0 / SF-0 / gear wear step 1 pattern). Never imported by app code.
//
// Two groups:
//   LIVE     : everything a player can hold today (Standard, Augmented, Stellar, Radiant with ascension "none"), plus
//              the real mint path (inspectBlank) and the craft preview, which only ever see live bands. No rarity
//              readiness slice may move a LIVE pin: the user's answers 5 and 6 keep live tiers exactly as they are.
//   RESERVED : Derelict, Luminous, Constellar and every non-"none" ascension. A slice may move a RESERVED pin only on
//              purpose, naming the move in its commit and carry note (RR-3 the legendary budget and secondaries, RR-4
//              ascension, RR-7 the Derelict floor and the crew rows).
//
// Every generator cell records the rng draws it consumed (a counting lcg), so a slice that slides a draw in front of
// the affix picks moves a pin even when the stat lines happen to match.

import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_RARITY_LADDER,
  EQUIPMENT_SLOTS,
  blueprintMintsEquipmentInstance,
  equipmentRarityLabel,
  freshState,
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
import { SALVAGE_CEILING_THRESHOLDS } from "./salvage";
import { deserialize, migrate, serialize } from "./save";
import { hash } from "./firstRunsGoldens.fixture";


export const LIVE_BANDS: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];
export const RESERVED_BANDS: readonly EquipmentRarity[] = ["derelict", "luminous", "constellar"];
const LEGENDARY: readonly EquipmentRarity[] = ["luminous", "constellar"];
const ASCENDED: readonly EquipmentAscension[] = ["nova", "celestial"];
const QUALITIES = [0, 3, 5];
const ILEVELS = [1, 20, 40];

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

type Cell = { piece: EquipmentInstance; draws: number };

function equipmentCells(slot: string, rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[]): Cell[] {
  const out: Cell[] = [];
  for (const v of EQUIPMENT_SLOTS[slot].varieties) {
    for (const quality of qualities) {
      for (const iLevel of iLevels) {
        const c = countingRng(cellSeed(slot, v.key, rarity, ascension, quality, iLevel));
        const piece = generateEquipment({
          slotType: slot as EquipmentInstance["slotType"],
          varietyKey: v.key,
          blueprintKey: null,
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

function weaponCells(rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[]): Cell[] {
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

function droneCells(rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[]): Cell[] {
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
function generatorPins(rarity: EquipmentRarity, ascension: EquipmentAscension, qualities: number[], iLevels: number[], tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of liveSlots()) out[`gen:${slot}:${tag}`] = hash(equipmentCells(slot, rarity, ascension, qualities, iLevels));
  out[`gen:weapon:${tag}`] = hash(weaponCells(rarity, ascension, qualities, iLevels));
  out[`gen:drone:${tag}`] = hash(droneCells(rarity, ascension, qualities, iLevels));
  return out;
}

// The pure primitives, split by band.
function primitivePins(bands: readonly EquipmentRarity[], indices: number[], tag: string): Record<string, string> {
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
    [`prim:affixCount:${tag}`]: hash(affix),
    [`prim:computeBudget:${tag}`]: hash(budget),
    [`prim:defensive:${tag}`]: hash(defensive),
    [`prim:moduleScale:${tag}`]: hash(moduleScale),
  };
}

// The readers downstream of rarity, one pin per band.
function readerPins(bands: readonly EquipmentRarity[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of bands) {
    const score = [1, 20, 40].flatMap((iLevel) => [0, 5].map((quality) => itemScore({ rarity: r, quality, iLevel })));
    const salvage = [1, 40].flatMap((iLevel) => [0, 5].flatMap((quality) => [1, 3].map((tier) => salvageDurationTicks({ kind: "equipment", iLevel, quality, rarity: r, tier }))));
    out[`reader:${r}`] = hash({
      index: rarityIndex(r),
      label: equipmentRarityLabel(r),
      score,
      salvage,
      salvageMult: SALVAGE_EQUIPMENT_RARITY_MULTIPLIER[r],
      crewMult: crewRarityMultiplier(r),
      crewClamp: clampCrewRarity(r),
      relicBand: relicBandOf(r),
      relicStudy: relicStudyDurationTicks(r),
    });
  }
  return out;
}

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

// The Debug minter at every band, for every gear blueprint (quality 5, iLevel 40, the picker's defaults).
function devMintPins(bands: readonly EquipmentRarity[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rarity of bands) {
    const rows = gearBlueprintKeys().map((key) => {
      const c = countingRng(cellSeed("devMint", key, rarity));
      const piece = devMintFromBlueprint({ blueprint: BLUEPRINTS[key], iLevel: 40, quality: 5, rarity, rng: c.rng, allocateId: () => "equip-1" });
      return { piece, draws: c.draws() };
    });
    out[`devMint:${rarity}`] = hash(rows);
  }
  return out;
}

// One cargo bay per (band, ascension) pair, through serialize, deserialize and migrate.
function loadPin(pairs: [EquipmentRarity, EquipmentAscension][], tag: string): Record<string, string> {
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
  return { [`load:${tag}`]: hash(loaded ? loaded.equipment : null) };
}

// A mixed reveal list through the shared sort (it contains legendary pieces, so it is RESERVED: RR-4 adds the
// ascension tie-break).
function sortPin(): Record<string, string> {
  const pieces: EquipmentInstance[] = [];
  let n = 0;
  for (const r of EQUIPMENT_RARITY_LADDER) {
    for (const quality of [0, 5]) {
      for (const iLevel of [1, 40]) {
        const piece = generateEquipment({
          slotType: "cargoBay",
          varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key,
          blueprintKey: null,
          iLevel,
          quality,
          rarity: r,
          ascension: "none",
          rng: countingRng(cellSeed("sort", r, quality, iLevel)).rng,
          allocateId: () => `equip-${++n}`,
        });
        pieces.push(piece);
      }
    }
  }
  // A fixed shuffle so the input is not already ordered.
  const shuffled = pieces.map((p, i) => ({ p, k: cellSeed("shuffle", i) })).sort((a, b) => a.k - b.k).map((x) => x.p);
  return { "reader:sort": hash(sortRolledPieces(shuffled).map((p) => p.id)) };
}

// Every pin, LIVE and RESERVED, computed on the current engine.
export function computeLivePins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of LIVE_BANDS) Object.assign(out, generatorPins(r, "none", QUALITIES, ILEVELS, r));
  Object.assign(out, primitivePins(LIVE_BANDS, [1, 2, 3, 4], "live"));
  Object.assign(out, readerPins(LIVE_BANDS));
  Object.assign(out, inspectPins());
  Object.assign(out, previewPins());
  Object.assign(out, devMintPins(LIVE_BANDS));
  Object.assign(out, loadPin(LIVE_BANDS.map((r) => [r, "none"]), "live"));
  out["relic:blankWeights"] = hash(RELIC_BLANK_WEIGHTS);
  out["salvage:ceiling"] = hash(SALVAGE_CEILING_THRESHOLDS);
  return out;
}

export function computeReservedPins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RESERVED_BANDS) Object.assign(out, generatorPins(r, "none", QUALITIES, ILEVELS, r));
  for (const r of LEGENDARY) for (const a of ASCENDED) Object.assign(out, generatorPins(r, a, [5], [40], `${r}:${a}`));
  Object.assign(out, primitivePins(RESERVED_BANDS, [0, 5], "reserved"));
  Object.assign(out, readerPins(RESERVED_BANDS));
  Object.assign(out, devMintPins(RESERVED_BANDS));
  const allPairs: [EquipmentRarity, EquipmentAscension][] = [];
  for (const r of EQUIPMENT_RARITY_LADDER) for (const a of ["none", "nova", "celestial"] as EquipmentAscension[]) allPairs.push([r, a]);
  Object.assign(out, loadPin(allPairs, "all"));
  Object.assign(out, sortPin());
  return out;
}

// ===== The pins, captured on feat/crew-0.14.0 @ b579a1f (the engine before RR-1) =====
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
  "gen:memberWeapon:standard": "81e1e882",
  "gen:memberArmor:standard": "3f8d0c49",
  "gen:memberTool:standard": "61e4a312",
  "gen:implant:standard": "75635ad8",
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
  "gen:memberWeapon:augmented": "18ebe4b0",
  "gen:memberArmor:augmented": "568f47df",
  "gen:memberTool:augmented": "78a19138",
  "gen:implant:augmented": "befbcc10",
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
  "gen:memberWeapon:stellar": "721aefec",
  "gen:memberArmor:stellar": "798422d0",
  "gen:memberTool:stellar": "730dacc9",
  "gen:implant:stellar": "6883aecc",
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
  "gen:memberWeapon:radiant": "542c022b",
  "gen:memberArmor:radiant": "b2d79711",
  "gen:memberTool:radiant": "de46ce1b",
  "gen:implant:radiant": "1e9a0d86",
  "gen:weapon:radiant": "bac4e5b7",
  "gen:drone:radiant": "8b1d5274",
  "prim:affixCount:live": "7edbff18",
  "prim:computeBudget:live": "719d2d0d",
  "prim:defensive:live": "a7a5d287",
  "prim:moduleScale:live": "2f983e90",
  "reader:standard": "53489ffb",
  "reader:augmented": "f4e07b3c",
  "reader:stellar": "529fd64f",
  "reader:radiant": "2f41a43a",
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
  "relic:blankWeights": "42928ab7",
  "salvage:ceiling": "b3979148",
};

export const RARITY_GOLDENS_RESERVED: Record<string, string> = {
  "gen:cargoBay:derelict": "8cff6e75",
  "gen:ftlDrive:derelict": "f3a9dbc9",
  "gen:reactorCore:derelict": "c7b5e2d9",
  "gen:specUtility:derelict": "df4bf0c",
  "gen:shieldEmitters:derelict": "d48cfc32",
  "gen:hullPlating:derelict": "676b4364",
  "gen:bridge:derelict": "6418fb85",
  "gen:quarters:derelict": "730b71ae",
  "gen:sensor:derelict": "a275b87d",
  "gen:memberWeapon:derelict": "c232aed9",
  "gen:memberArmor:derelict": "94c992b4",
  "gen:memberTool:derelict": "7215cbb0",
  "gen:implant:derelict": "a94000bf",
  "gen:weapon:derelict": "51617ab",
  "gen:drone:derelict": "39d49605",
  "gen:cargoBay:luminous": "b9b1b067",
  "gen:ftlDrive:luminous": "d3895285",
  "gen:reactorCore:luminous": "40bf7f5d",
  "gen:specUtility:luminous": "574f0f6c",
  "gen:shieldEmitters:luminous": "d7799778",
  "gen:hullPlating:luminous": "71994030",
  "gen:bridge:luminous": "ec031c8d",
  "gen:quarters:luminous": "3d29b09d",
  "gen:sensor:luminous": "11afd69b",
  "gen:memberWeapon:luminous": "301902da",
  "gen:memberArmor:luminous": "f1903968",
  "gen:memberTool:luminous": "a808a618",
  "gen:implant:luminous": "c0fd6b4d",
  "gen:weapon:luminous": "f98fca46",
  "gen:drone:luminous": "b499bcbd",
  "gen:cargoBay:constellar": "4d09f900",
  "gen:ftlDrive:constellar": "654ae261",
  "gen:reactorCore:constellar": "3ad3fe8d",
  "gen:specUtility:constellar": "1fea17da",
  "gen:shieldEmitters:constellar": "a10c2e61",
  "gen:hullPlating:constellar": "2d16cb66",
  "gen:bridge:constellar": "5b08f08",
  "gen:quarters:constellar": "33dcc086",
  "gen:sensor:constellar": "48216733",
  "gen:memberWeapon:constellar": "95f1fc97",
  "gen:memberArmor:constellar": "4eb5d163",
  "gen:memberTool:constellar": "16328da5",
  "gen:implant:constellar": "769f7db8",
  "gen:weapon:constellar": "d9836eb7",
  "gen:drone:constellar": "92672bbe",
  "gen:cargoBay:luminous:nova": "5eb4bf37",
  "gen:ftlDrive:luminous:nova": "956374d3",
  "gen:reactorCore:luminous:nova": "b869508b",
  "gen:specUtility:luminous:nova": "7bb8bb08",
  "gen:shieldEmitters:luminous:nova": "bfefb184",
  "gen:hullPlating:luminous:nova": "7c23dd91",
  "gen:bridge:luminous:nova": "822dc424",
  "gen:quarters:luminous:nova": "86cf09cb",
  "gen:sensor:luminous:nova": "6f47634b",
  "gen:memberWeapon:luminous:nova": "56c3216d",
  "gen:memberArmor:luminous:nova": "47305851",
  "gen:memberTool:luminous:nova": "fbbdcca0",
  "gen:implant:luminous:nova": "2922edaf",
  "gen:weapon:luminous:nova": "47ce95bb",
  "gen:drone:luminous:nova": "38f1db3e",
  "gen:cargoBay:luminous:celestial": "e2dbf8fc",
  "gen:ftlDrive:luminous:celestial": "3511671a",
  "gen:reactorCore:luminous:celestial": "92923f30",
  "gen:specUtility:luminous:celestial": "4ff4b8b8",
  "gen:shieldEmitters:luminous:celestial": "428d6170",
  "gen:hullPlating:luminous:celestial": "53bbe5e2",
  "gen:bridge:luminous:celestial": "b2f3e50e",
  "gen:quarters:luminous:celestial": "a74292ae",
  "gen:sensor:luminous:celestial": "2b6aec37",
  "gen:memberWeapon:luminous:celestial": "bcec1e99",
  "gen:memberArmor:luminous:celestial": "7328533",
  "gen:memberTool:luminous:celestial": "f5b4e66c",
  "gen:implant:luminous:celestial": "87d5b879",
  "gen:weapon:luminous:celestial": "adeff0dd",
  "gen:drone:luminous:celestial": "68f791c2",
  "gen:cargoBay:constellar:nova": "1626cf8",
  "gen:ftlDrive:constellar:nova": "2dacbe39",
  "gen:reactorCore:constellar:nova": "89b7bea2",
  "gen:specUtility:constellar:nova": "59e0f242",
  "gen:shieldEmitters:constellar:nova": "5b1f467d",
  "gen:hullPlating:constellar:nova": "3f96a0f2",
  "gen:bridge:constellar:nova": "4c1c49ad",
  "gen:quarters:constellar:nova": "13644197",
  "gen:sensor:constellar:nova": "6cb16033",
  "gen:memberWeapon:constellar:nova": "d34969f8",
  "gen:memberArmor:constellar:nova": "f0f6cba",
  "gen:memberTool:constellar:nova": "30454a71",
  "gen:implant:constellar:nova": "bf966a0a",
  "gen:weapon:constellar:nova": "dfa8c674",
  "gen:drone:constellar:nova": "e1b403ab",
  "gen:cargoBay:constellar:celestial": "eddc6d31",
  "gen:ftlDrive:constellar:celestial": "55bb8c2",
  "gen:reactorCore:constellar:celestial": "a3559a33",
  "gen:specUtility:constellar:celestial": "d56ccac3",
  "gen:shieldEmitters:constellar:celestial": "9370ce9",
  "gen:hullPlating:constellar:celestial": "fe52aae9",
  "gen:bridge:constellar:celestial": "c05306a7",
  "gen:quarters:constellar:celestial": "42c0751f",
  "gen:sensor:constellar:celestial": "f1aa39a3",
  "gen:memberWeapon:constellar:celestial": "87a9e408",
  "gen:memberArmor:constellar:celestial": "9827d7a",
  "gen:memberTool:constellar:celestial": "a829fcff",
  "gen:implant:constellar:celestial": "f1f2a1a0",
  "gen:weapon:constellar:celestial": "2c55b618",
  "gen:drone:constellar:celestial": "90f32979",
  "prim:affixCount:reserved": "4bc08aa",
  "prim:computeBudget:reserved": "c9f5a838",
  "prim:defensive:reserved": "4cb44216",
  "prim:moduleScale:reserved": "8895fa66",
  "reader:derelict": "46c8d14d",
  "reader:luminous": "b9a0c58a",
  "reader:constellar": "b53ddfbd",
  "devMint:derelict": "3a67153a",
  "devMint:luminous": "cb933944",
  "devMint:constellar": "2386ff8",
  "load:all": "1a5e615a",
  "reader:sort": "e942cfb",
};
