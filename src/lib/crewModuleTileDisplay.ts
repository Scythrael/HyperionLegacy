// ============================================================================
// crewModuleTileDisplay.ts (Complement CP-12, 0.14.0)
//
// The variant line under a Ship Systems tile (mockup CMR-9, "Crew Modules You Can Actually Get": "Focused Command ·
// officers amplify the stats this hull is built for", "Wide-Beam Array · IL 6"): the piece's own name, and for a crew
// module what it does on THIS hull, every number read from the engine's own readers (crewModules.ts
// bridgeOfficerMultiplier, quartersProfessionMultiplier, quartersCapacityBonus; model.ts shipDerivedStats for the Guest
// Wing's guest berths), never a second copy of a rule. Display only. Pure.
// ============================================================================

import { CREW_PROFESSIONS } from "./game/commandStructure";
import {
  HULL_FAMILY_MODULE_BONUS,
  HULL_ROLE_SEATS,
  bridgeOfficerMultiplier,
  getBridgeModuleById,
  getQuartersModuleById,
  hullFamilyBridgeLines,
  hullFamilyQuartersPerk,
  hullSpecOf,
  quartersCapacityBonus,
  quartersProfessionMultiplier,
  type HullFamilyBridgeStat,
  type HullFamilyQuartersPerk,
} from "./game/crewModules";
import { pieceVarietyDef, shipDerivedStats, type EquipmentInstance, type GameState, type SeniorStaffOfficer, type SeniorStaffSeat, type ShipInstance, type ShipSpec } from "./game/model";
import { DEPARTMENT_LABEL } from "./game/officerStats";

// The seat names the Senior Staff panel uses (US English), as adjectives before "officers" ("Executive", not
// "Executive Officer officers").
const SEAT_LABEL: Readonly<Record<SeniorStaffSeat, string>> = {
  executive: "Executive",
  pilot: "Pilot",
  operations: "Operations",
  science: "Science",
  tactical: "Tactical",
  medical: "Medical",
  engineering: "Engineering",
};

// "+10%", "-5%", "+10.4%": a multiplier's change, at most one decimal. The change is snapped to a millionth first, so a
// float like 1.1275 (stored as 1.12749999...) rounds half up to "+12.8%" as written, not down to "+12.7%".
export function liftPercentText(mult: number): string {
  const p = Math.round(Math.round((mult - 1) * 1e6) / 1000) / 10;
  return `${p > 0 ? "+" : ""}${p}%`;
}

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// A stand-in officer for the bridge reader: only the seat and the rank are read (an ensign's rank factor is 1).
function probeOfficer(seat: SeniorStaffSeat, rank: SeniorStaffOfficer["rank"] = "ensign"): SeniorStaffOfficer {
  return { seat, rank } as SeniorStaffOfficer;
}

// The state with `piece` installed in its slot on `ship` (any other piece of that slot on the ship set aside), for the
// readers that read the installed module. The real install is fitEquipment; this only names the piece for a reader.
function withPieceOn(state: GameState, ship: ShipInstance, piece: EquipmentInstance): GameState {
  const others = state.equipment.filter((e) => e.id !== piece.id && !(e.fittedToShipId === ship.id && e.slotType === piece.slotType));
  return { ...state, equipment: [...others, { ...piece, fittedToShipId: ship.id }] };
}

// What a bridge module does on `ship`'s hull, or null for a piece that is not a known bridge module.
function bridgeEffect(piece: EquipmentInstance, ship: ShipInstance): string | null {
  const def = piece.moduleVariant === undefined ? undefined : getBridgeModuleById(piece.moduleVariant);
  if (def === undefined) return null;
  const mod = { def, instance: piece };
  const spec = hullSpecOf(ship);
  switch (def.kind) {
    case "balanced":
      return `every officer ${liftPercentText(bridgeOfficerMultiplier(mod, probeOfficer("executive"), spec))}`;
    case "focused": {
      const seats = HULL_ROLE_SEATS[spec];
      // The mockup's "officers amplify the stats this hull is built for", named: the hull's specialist seats.
      return `this hull's ${listText(seats.map((s) => SEAT_LABEL[s]))} officers ${liftPercentText(bridgeOfficerMultiplier(mod, probeOfficer(seats[0]), spec))}`;
    }
    case "flag":
      // The Flag Command scales by the officer's rank factor (seniorStaff.ts): a Cadet gets less than an Ensign, every
      // rank above more. Both numbers are the engine's own.
      return `officers ${liftPercentText(bridgeOfficerMultiplier(mod, probeOfficer("executive"), spec))} at Ensign (${liftPercentText(bridgeOfficerMultiplier(mod, probeOfficer("executive", "cadet"), spec))} as a Cadet), more at higher ranks`;
  }
}

function berthsText(n: number): string {
  if (n === 0) return "no added berths";
  return `+${n} crew ${n === 1 ? "berth" : "berths"}`;
}

// What a quarters module does on `ship`, or null for a piece that is not a known quarters module.
function quartersEffect(state: GameState, ship: ShipInstance, piece: EquipmentInstance): string | null {
  const def = piece.moduleVariant === undefined ? undefined : getQuartersModuleById(piece.moduleVariant);
  if (def === undefined) return null;
  const mod = { def, instance: piece };
  const parts = [berthsText(quartersCapacityBonus(withPieceOn(state, ship, piece), ship))];
  if (def.kind === "division" && def.division !== undefined) {
    const own = quartersProfessionMultiplier(mod, def.division);
    const other = quartersProfessionMultiplier(mod, CREW_PROFESSIONS.find((p) => p !== def.division)!);
    parts.push(`${DEPARTMENT_LABEL[def.division]} ${liftPercentText(own)}, other divisions ${liftPercentText(other)}`);
  } else {
    const all = quartersProfessionMultiplier(mod, CREW_PROFESSIONS[0]);
    if (Math.abs(all - 1) > 1e-9) parts.push(`every division ${liftPercentText(all)}`);
  }
  const guests = (shipDerivedStats(ship, [piece]).colonistCapacity ?? 0) - (shipDerivedStats(ship, []).colonistCapacity ?? 0);
  if (guests > 0) parts.push(`+${Math.round(guests)} guest ${Math.round(guests) === 1 ? "berth" : "berths"}`);
  return parts.join(" · ");
}

// ============================================================================
// Complement CP-13 (OC-13, mockup SMS-1 "Hull bonus on <family>"): the HULL BONUS line
// ============================================================================

// The family names the mockup uses ("Hull bonus on Explorer").
export const HULL_FAMILY_LABEL: Readonly<Record<ShipSpec, string>> = { general: "General", prospector: "Prospector", tactician: "Tactician", explorer: "Explorer" };

const BRIDGE_STAT_TEXT: Readonly<Record<HullFamilyBridgeStat, string>> = {
  transitSpeed: "FTL transit speed",
  unloadSpeed: "unload speed",
  extractionYield: "extraction yield",
  weaponDamage: "weapon damage",
  sensors: "sensors",
};
const BRIDGE_STAT_ORDER: readonly HullFamilyBridgeStat[] = ["transitSpeed", "unloadSpeed", "extractionYield", "weaponDamage", "sensors"];

// "+3%", "+3.6%": a share as a percent, at most one decimal (liftPercentText on 1 + share).
function sharePercentText(share: number): string {
  return liftPercentText(1 + share);
}

// The quarters perk as the player reads it, its number read from the engine (`share` is hullFamilyQuartersPerk's).
function perkText(perk: HullFamilyQuartersPerk, share: number): string {
  switch (perk) {
    case "guestQuarters":
      return `guest quarters ${sharePercentText(share)}`;
    case "rareFind":
      return `${sharePercentText(share)} rare finds on mining and survey hauls`;
    case "injuryRecovery":
      return `injured crew recover ${sharePercentText(share).replace("+", "")} faster`;
    case "bayTime":
      // The bay divides its time by 1 + share, so the cut alone is share / (1 + share).
      return `ground-team medical bay time ${sharePercentText(share / (1 + share)).replace("+", "")} shorter`;
  }
}

// What a bridge or quarters `piece` gives as its HULL BONUS on `ship` (every number from the engine readers, at the
// piece's own rarity, quality and condition), or null for any other piece. Display only. Pure.
export function hullFamilyBonusText(state: GameState, ship: ShipInstance, piece: EquipmentInstance): string | null {
  const spec = hullSpecOf(ship);
  const on = withPieceOn(state, ship, piece);
  if (piece.slotType === "bridge") {
    if (piece.moduleVariant === undefined || getBridgeModuleById(piece.moduleVariant) === undefined) return null;
    const lines = hullFamilyBridgeLines(on, ship);
    if (lines === null) return null;
    const parts = BRIDGE_STAT_ORDER.filter((k) => lines[k] !== 0).map((k) => `${BRIDGE_STAT_TEXT[k]} ${sharePercentText(lines[k])}`);
    return parts.length === 0 ? null : listText(parts);
  }
  if (piece.slotType === "quarters") {
    const def = piece.moduleVariant === undefined ? undefined : getQuartersModuleById(piece.moduleVariant);
    if (def === undefined) return null;
    const q = HULL_FAMILY_MODULE_BONUS[spec]?.quarters;
    if (q === undefined) return null;
    const mod = { def, instance: piece };
    // The division lift is the change it makes inside the quarters multiplier (the same multiplier the crew reads).
    const lift = quartersProfessionMultiplier(mod, q.divisions[0], spec) - quartersProfessionMultiplier(mod, q.divisions[0]);
    if (Math.abs(lift) < 1e-9) return null;
    const parts = [`${listText(q.divisions.map((d) => DEPARTMENT_LABEL[d]))} crew ${sharePercentText(lift)}`];
    const share = hullFamilyQuartersPerk(on, ship, q.perk);
    if (share > 0) parts.push(perkText(q.perk, share));
    return parts.join(", ");
  }
  return null;
}

// The tile's "Hull bonus on <family>" line, or null when the piece gives none. Pure.
export function hullFamilyBonusLine(state: GameState, ship: ShipInstance, piece: EquipmentInstance): string | null {
  const text = hullFamilyBonusText(state, ship, piece);
  return text === null ? null : `Hull bonus on ${HULL_FAMILY_LABEL[hullSpecOf(ship)]}: ${text}`;
}

// The tile's variant line for an installed (or candidate) piece of a Sensor Suite, Bridge Module or Crew Quarters
// tile: "<variant>" for a sensor array, "<variant> · <what it does here>" for a crew module. Null for any other slot,
// or a piece with no known variety.
export function shipSystemTileLine(state: GameState, ship: ShipInstance, piece: EquipmentInstance): string | null {
  const variety = pieceVarietyDef(piece);
  if (variety === undefined) return null;
  switch (piece.slotType) {
    case "sensor":
      return variety.label;
    case "bridge": {
      const effect = bridgeEffect(piece, ship);
      return effect === null ? variety.label : `${variety.label} · ${effect}`;
    }
    case "quarters": {
      const effect = quartersEffect(state, ship, piece);
      return effect === null ? variety.label : `${variety.label} · ${effect}`;
    }
    default:
      return null;
  }
}
