// E-MOD EM-1 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md sections 3.2 and 4 EM-1): a ship's
// POWER BUDGET, the one pure reader the power consumers go through (the install gate EM-2, the combat over-budget
// penalty EM-3 and the reactor surplus drive lift EM-4 build on it; the Ship Systems readout shows the same two
// numbers off the ship sheet, which this reader matches exactly: shipPower.test.ts).
//
//   output         = the hull's basePowerOutput (P1) + every installed powerOutput line (the Reactor Core implicit)
//   grossDraw      = every installed piece's draw (an FTL drive at its class, P5)
//   draw           = grossDraw cut by the ship's power efficiency (P4: Reactor Overdrive, Power Discipline, Martian)
//   remaining      = output - draw (negative when over budget); overBudget only on a STRICT overrun (power.ts)
//   reactorSurplus = the unused power the installed reactor supplies, min(reactorOutput, max(0, output - draw)):
//                    what EM-4 turns into drive speed (P3). The hull's own base power is never surplus, so a ship
//                    without a crafted Reactor Core has none.
//
// `candidate` reads the budget as if one more piece were installed: a singleton slot's occupant moves out, a multi
// slot (weapon, drone pod) keeps its pieces unless `replacingInstanceId` names the one that moves out. Every value
// reads PRISTINE gear (wear never moves the budget, gear wear design 4.3). PURE: reads state and the static tables.

import type { EquipmentInstance, GameState } from "./model";
import { SHIP_TYPES, equipmentStatMods } from "./model";
import { equippedFor } from "./equipment";
import { netPowerDraw, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { powerBudget, type PowerBudget } from "./combat/power";

export interface ShipPowerBudget extends PowerBudget {
  baseOutput: number; // the hull's own generation (basePowerOutput)
  reactorOutput: number; // the installed powerOutput lines (the Reactor Core implicit)
  grossDraw: number; // before power efficiency
  efficiency: number; // the ship's summed crew.powerEfficiency (Museum-amplified like every crew key)
  reactorSurplus: number; // unused reactor power (EM-4's drive lift)
}

export interface PowerCandidate {
  piece: EquipmentInstance;
  replacingInstanceId?: string;
}

// The slots that hold more than one piece (equipment.ts MULTI_SLOT_TYPES); every other slot swaps its occupant.
const MULTI_SLOTS: ReadonlySet<string> = new Set(["weapon", "droneBay"]);

function piecesWith(state: GameState, shipId: string, candidate: PowerCandidate | undefined): EquipmentInstance[] {
  const pieces = equippedFor(state, shipId);
  if (!candidate) return pieces;
  const { piece, replacingInstanceId } = candidate;
  const kept = pieces.filter((p) => {
    if (p.id === piece.id) return false;
    if (replacingInstanceId !== undefined) return p.id !== replacingInstanceId;
    return MULTI_SLOTS.has(piece.slotType) || p.slotType !== piece.slotType;
  });
  return [...kept, { ...piece, fittedToShipId: shipId }];
}

export function shipPowerBudget(state: GameState, shipId: string, candidate?: PowerCandidate): ShipPowerBudget {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) throw new Error(`shipPowerBudget: no ship ${shipId}`);
  const mods = equipmentStatMods(piecesWith(state, shipId, candidate));
  const baseOutput = SHIP_TYPES[ship.typeKey].basePowerOutput;
  const output = baseOutput + mods.powerOutput;
  const efficiency = Math.max(0, shipCrewContribution(state, ship)[CREW_STAT_KEYS.powerEfficiency] ?? 0);
  const draw = netPowerDraw(mods.totalPowerDraw, efficiency);
  return {
    // The net draw is one figure (efficiency cuts the whole ship's draw, not each piece's).
    ...powerBudget(output, [{ powerDraw: draw }]),
    baseOutput,
    reactorOutput: mods.powerOutput,
    grossDraw: mods.totalPowerDraw,
    efficiency,
    reactorSurplus: Math.min(mods.powerOutput, Math.max(0, output - draw)),
  };
}
