// ============================================================================
// shipSystemTiles.ts (Complement CP-12, 0.14.0)
//
// The Ships tab's "Systems" install tiles: the singleton slots a player installs into from a ship's Ship Systems
// board (ShipSystemsPanel.svelte draws exactly this list, in this order). CP-12 (plan docs/plans/2026-10-14-complement-
// and-acquisition-plan.md, mockup CMR-9 "Crew Modules You Can Actually Get") adds the Bridge Module and Crew Quarters
// tiles beside the Sensor Suite, so a crafted bridge or quarters piece (CP-11's blueprints) can finally be installed.
//
// The tiles add no rule: an install from one runs the existing engine (equipment.ts canFitEquipment / fitEquipment),
// and an uninstall unfitEquipmentInstance. Every slot here but the economy three is ALLOW-EMPTY (an uninstall leaves
// it empty); a crew module's effects reach a run by the existing stamp rules (crewModules.ts), and a quarters module's
// berths only ever add seats (CP-5 "Never evict": taking one off removes nobody).
//
// The wiring registry's ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable row measures an install through this list, so
// a tile dropped from it shows as a pending stat, never a silent dead end. Pure.
// ============================================================================

import { EQUIPMENT_SLOTS, type EquipmentSlotType, type GameState } from "./model";
import { canFitEquipment, fitEquipment } from "./equipment";

export interface ShipSystemTile {
  readonly slotType: EquipmentSlotType;
  // The tile's name. The economy three and the Spec Utility keep the board's own names; the Sensor Suite reads the
  // slot's catalog label (OC-25); the crew module tiles are named as the mockup names them.
  readonly label: string;
}

export const SHIP_SYSTEM_TILES: readonly ShipSystemTile[] = [
  { slotType: "cargoBay", label: "Cargo Bay" },
  { slotType: "ftlDrive", label: "FTL Drive" },
  { slotType: "reactorCore", label: "Reactor Core" },
  // E-MOD EM-10: listed for the per-slot map and the compare, but drawn as the first tile of the Modules row.
  { slotType: "specUtility", label: "Spec Utility" },
  { slotType: "sensor", label: EQUIPMENT_SLOTS.sensor.label },
  { slotType: "bridge", label: "Bridge Module" },
  { slotType: "quarters", label: EQUIPMENT_SLOTS.quarters.label },
];

// The crew module tiles CP-12 added (the mockup's two "new" tiles).
export const CREW_MODULE_TILE_SLOTS: readonly EquipmentSlotType[] = ["bridge", "quarters"];

export function hasShipSystemTile(slotType: string): boolean {
  return SHIP_SYSTEM_TILES.some((t) => t.slotType === slotType);
}

// Install the spare `instanceId` on `shipId` from the Ships tab tile of `slotType`: the same fitEquipment call the
// tile's Install / Swap makes (App.svelte doFitEquipment). The SAME state when the board has no tile for that slot,
// when the piece is not of that slot, or when the install gate refuses it. Pure.
export function installFromShipSystemTile(state: GameState, shipId: string, slotType: EquipmentSlotType, instanceId: string): GameState {
  if (!hasShipSystemTile(slotType)) return state;
  const piece = state.equipment.find((e) => e.id === instanceId);
  if (piece === undefined || piece.slotType !== slotType) return state;
  if (!canFitEquipment(state, shipId, instanceId).ok) return state;
  return fitEquipment(state, shipId, instanceId);
}
