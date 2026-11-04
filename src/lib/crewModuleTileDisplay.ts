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
  HULL_ROLE_SEATS,
  bridgeOfficerMultiplier,
  getBridgeModuleById,
  getQuartersModuleById,
  hullSpecOf,
  quartersCapacityBonus,
  quartersProfessionMultiplier,
} from "./game/crewModules";
import { pieceVarietyDef, shipDerivedStats, type EquipmentInstance, type GameState, type SeniorStaffOfficer, type SeniorStaffSeat, type ShipInstance } from "./game/model";
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

// "+10%", "-5%", "+10.4%": a multiplier's change, at most one decimal.
export function liftPercentText(mult: number): string {
  const p = Math.round((mult - 1) * 1000) / 10;
  return `${p > 0 ? "+" : ""}${p}%`;
}

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// A stand-in officer for the bridge reader: only the seat and the rank are read (an ensign's rank factor is 1).
function probeOfficer(seat: SeniorStaffSeat): SeniorStaffOfficer {
  return { seat, rank: "ensign" } as SeniorStaffOfficer;
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
      return `officers ${liftPercentText(bridgeOfficerMultiplier(mod, probeOfficer("executive"), spec))} at Ensign, more at higher ranks`;
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
