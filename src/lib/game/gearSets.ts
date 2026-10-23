// ============================================================================
// gearSets.ts: RARITY READINESS RR-6 (docs/plans/2026-10-23-rarity-readiness-plan.md; user answers 1 and 2: "Constellar
// carries set bonuses 2/3/5-piece", "Engine + test sets").
//
// THE ONE SET ENGINE for gear and E-MOD modules (EM-7 adds its module sets to the same catalog):
//   - A piece's set: a CONSTELLAR gear piece's stamped `setId` (only when the set covers the piece's slot), or a
//     set-category universal module's catalog `UniversalModuleDef.setId` (shipModules.ts). Anything else has none.
//   - Pieces count per WEARER: the pieces installed on one ship (equipmentStatMods, model.ts) or worn by one away-team
//     member (snapshotMember, awayTeam.ts), never summed across a ship and its members or across two members. Each
//     set's `scope` says which fold reads it, so a stray member piece in a ship list adds nothing.
//   - Thresholds 2 / 3 / 5: a set's tier is active when that many of its pieces are counted. THE CELESTIAL HOOK: when
//     at least one counted piece of a set is a Celestial Constellar, every tier of THAT set needs one fewer piece
//     (CELESTIAL_SET_REDUCTION), once, however many Celestial pieces there are (epic design :153).
//   - An active tier adds `magnitude` points of `stat`, an EXISTING fold key, as if a piece carried the line, so the
//     bonus acts through today's folds.
// Derived from the install authorities every time (never stored), so install, uninstall, loadout check-out / check-in
// and member wear / remove all recount for free, and a frozen copy of the gear (an in-flight run's installed gear, a
// member snapshot) keeps the set state it launched with.
//
// No player path stamps a setId (the Fabricator mint never does): the Debug minter is the only source (answer 4).
// Every NAME is a [PROPOSAL]; every number a [PROVISIONAL] first pass.
//
// Leaf: imports model.ts TYPES only and shipModules.ts (itself types-only over model.ts), so model.ts can import it.
// ============================================================================

import type { EquipmentInstance, EquipmentSlotType } from "./model";
import { universalModuleDef, type UniversalModuleDef } from "./shipModules";

export type GearSetScope = "ship" | "member";

// The design's piece thresholds (epic :146 "2/3/5-piece"); a tier names one of them.
export const GEAR_SET_TIER_PIECES = [2, 3, 5] as const;
export type GearSetTierPieces = (typeof GEAR_SET_TIER_PIECES)[number];

export interface GearSetTier {
  readonly pieces: GearSetTierPieces;
  readonly stat: string; // an existing fold key (ship: equipmentStatMods; member: a ground stat line)
  readonly magnitude: number; // points of `stat`, as a line of that many points would carry
}

export interface GearSetDef {
  readonly id: string;
  readonly label: string; // [PROPOSAL]
  readonly scope: GearSetScope;
  readonly slotTypes: readonly EquipmentSlotType[]; // the gear slots whose Constellar pieces may carry it
  readonly tiers: readonly GearSetTier[];
}



// [PROVISIONAL]: a tier's bonus in points per piece it needs (2-piece 20, 3-piece 30, 5-piece 50 points of its line).
export const GEAR_SET_POINTS_PER_PIECE = 10;

// The design's Celestial Constellar rule (epic :153 "reduce set piece requirement by 1 while keeping all bonuses").
export const CELESTIAL_SET_REDUCTION = 1;

const tier = (pieces: GearSetTierPieces, stat: string): GearSetTier => ({ pieces, stat, magnitude: pieces * GEAR_SET_POINTS_PER_PIECE });

// The catalog: the two TEST sets of answer 2 ("proven with 1 or 2 test sets"), names [PROPOSAL]. Real set content (the
// design's ~18 sets) is the user's call.
export const GEAR_SETS: readonly GearSetDef[] = [
  {
    id: "testSetSurvey",
    label: "Survey Cadre",
    scope: "ship",
    slotTypes: ["cargoBay", "ftlDrive", "sensor", "reactorCore", "specUtility"],
    tiers: [tier(2, "cargoCapacity"), tier(3, "sensors"), tier(5, "fuelCapacity")],
  },
  {
    // The 5-piece tier needs two implants (an augment-affinity race has 2 implant slots) or a Celestial piece's
    // minus-1 (four pieces); the user is being asked whether to keep it so.
    id: "testSetField",
    label: "Field Cadre",
    scope: "member",
    slotTypes: ["memberArmor", "memberWeapon", "memberTool", "implant"],
    tiers: [tier(2, "groundArmor"), tier(3, "groundPower"), tier(5, "groundHp")],
  },
];

// A set by id, or undefined. Pure.
export function gearSetDef(id: string | undefined): GearSetDef | undefined {
  return id === undefined ? undefined : GEAR_SETS.find((s) => s.id === id);
}

// The sets a Constellar piece of this slot may carry (catalog order; the Debug minter stamps the first). Pure.
export function gearSetsFor(slotType: EquipmentSlotType): readonly GearSetDef[] {
  return GEAR_SETS.filter((s) => s.slotTypes.includes(slotType));
}

// Resolves a module piece's catalog def (injectable so a test can run the engine over fixture modules).
export type ModuleDefResolver = (id: string | undefined) => UniversalModuleDef | undefined;
const catalogModule: ModuleDefResolver = (id) => universalModuleDef(id);

// The set a piece counts toward, or undefined. Pure.
export function pieceSetId(piece: EquipmentInstance, moduleDef: ModuleDefResolver = catalogModule): string | undefined {
  if (piece.slotType === "module") {
    const def = moduleDef(piece.moduleVariant);
    return def?.category === "set" && gearSetDef(def.setId) !== undefined ? def.setId : undefined;
  }
  if (piece.rarity !== "constellar") return undefined;
  const set = gearSetDef(piece.setId);
  return set !== undefined && set.slotTypes.includes(piece.slotType) ? set.id : undefined;
}

// Is this a Celestial Constellar piece (the set-warping ultimate)? Checked here directly (gearSets.ts must not import
// ascension.ts: model.ts imports this file). Pure.
function isCelestialConstellar(piece: EquipmentInstance): boolean {
  return piece.rarity === "constellar" && piece.ascension === "celestial";
}

export interface GearSetCount {
  readonly count: number; // distinct counted pieces
  readonly celestial: boolean; // at least one is a Celestial Constellar
}

// Count each set's pieces in ONE wearer's list (distinct piece ids). Pure.
export function gearSetCounts(pieces: readonly EquipmentInstance[], moduleDef: ModuleDefResolver = catalogModule): Map<string, GearSetCount> {
  const seen = new Set<string>();
  const out = new Map<string, { count: number; celestial: boolean }>();
  for (const p of pieces) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const id = pieceSetId(p, moduleDef);
    if (id === undefined) continue;
    const c = out.get(id) ?? { count: 0, celestial: false };
    c.count++;
    if (isCelestialConstellar(p)) c.celestial = true;
    out.set(id, c);
  }
  return out;
}

// The pieces a tier needs, after the Celestial hook. Pure.
export function gearSetTierRequirement(pieces: GearSetTierPieces, celestial: boolean): number {
  return Math.max(1, pieces - (celestial ? CELESTIAL_SET_REDUCTION : 0));
}

export interface ActiveGearSetTier {
  readonly setId: string;
  readonly pieces: GearSetTierPieces;
  readonly stat: string;
  readonly magnitude: number;
}

// Every active tier of every `scope` set in ONE wearer's pieces, in catalog order. Pure.
export function activeGearSetTiers(pieces: readonly EquipmentInstance[], scope: GearSetScope, moduleDef: ModuleDefResolver = catalogModule): ActiveGearSetTier[] {
  const counts = gearSetCounts(pieces, moduleDef);
  const out: ActiveGearSetTier[] = [];
  for (const set of GEAR_SETS) {
    if (set.scope !== scope) continue;
    const c = counts.get(set.id);
    if (c === undefined) continue;
    for (const t of set.tiers) {
      if (c.count >= gearSetTierRequirement(t.pieces, c.celestial)) out.push({ setId: set.id, pieces: t.pieces, stat: t.stat, magnitude: t.magnitude });
    }
  }
  return out;
}

// The active set bonuses of ONE wearer as stat lines (points per fold key), for the folds to read like a piece's lines.
// Empty (no keys) when no tier is active, so a fold over set-free gear reads exactly what it read before. Pure.
export function gearSetBonusLines(pieces: readonly EquipmentInstance[], scope: GearSetScope, moduleDef: ModuleDefResolver = catalogModule): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of activeGearSetTiers(pieces, scope, moduleDef)) out[t.stat] = (out[t.stat] ?? 0) + t.magnitude;
  return out;
}
