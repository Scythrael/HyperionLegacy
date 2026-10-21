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
// Reactor tech foundation (0.14.0, reactorTech.ts): the budget also names the installed core's TECH TIER
// (reactorTech: the Reactor Core's variety, a crafted core through its blueprint, the Standard-Issue core through the
// slot's default variety; null with no Reactor Core installed), the tier the hull's tier requires
// (requiredReactorTech, reactorTech.ts requiredReactorTech: none in 0.14.0) and whether the two agree
// (reactorTechMet). The balancing patch's power generation requirement (Tier VII hulls on antimatter, the user's
// "Probably a requirement of power generation on T7 ships") consumes reactorTechMet; until then no requirement is
// active, so it reads true on every ship and no gate exists.
//
// `candidate` reads the budget as if one more piece were installed: a singleton slot's occupant moves out, a multi
// slot (weapon, drone pod) keeps its pieces unless `replacingInstanceId` names the one that moves out. Every value
// reads PRISTINE gear (wear never moves the budget, gear wear design 4.3). PURE: reads state and the static tables.

import type { EquipmentInstance, GameState } from "./model";
import { BLUEPRINTS, DEFAULT_EQUIPMENT_VARIETY, SHIP_TYPES, equipmentStatMods } from "./model";
import { HULL_TIER_REACTOR_REQUIREMENT, REACTOR_VARIETY_TECH, meetsReactorRequirement, requiredReactorTech, type ReactorTechId } from "./reactorTech";
import { MULTI_SLOT_TYPES, equippedFor } from "./equipment";
import { netPowerDraw, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { powerBudget, type PowerBudget } from "./combat/power";

export interface ShipPowerBudget extends PowerBudget {
  baseOutput: number; // the hull's own generation (basePowerOutput)
  reactorOutput: number; // the installed powerOutput lines (the Reactor Core implicit)
  grossDraw: number; // before power efficiency
  efficiency: number; // the ship's summed crew.powerEfficiency (Museum-amplified like every crew key)
  reactorSurplus: number; // unused reactor power (EM-4's drive lift)
  reactorTech: ReactorTechId | null; // the installed Reactor Core's tech tier; null with no core installed
  requiredReactorTech: ReactorTechId | null; // the hull tier's power generation requirement (none in 0.14.0)
  reactorTechMet: boolean; // the installed tech meets the requirement (always true while none is active)
}

export interface PowerCandidate {
  piece: EquipmentInstance;
  replacingInstanceId?: string;
}

function piecesWith(state: GameState, shipId: string, candidate: PowerCandidate | undefined): EquipmentInstance[] {
  const pieces = equippedFor(state, shipId);
  if (!candidate) return pieces;
  const { piece, replacingInstanceId } = candidate;
  const kept = pieces.filter((p) => {
    if (p.id === piece.id) return false;
    if (replacingInstanceId !== undefined) return p.id !== replacingInstanceId;
    // A multi slot (equipment.ts MULTI_SLOT_TYPES) keeps its pieces; every other slot swaps its occupant.
    return MULTI_SLOT_TYPES.has(piece.slotType) || p.slotType !== piece.slotType;
  });
  return [...kept, { ...piece, fittedToShipId: shipId }];
}

// A Reactor Core piece's tech tier: its variety's (a crafted core's variety is its blueprint's output; the
// Standard-Issue core, blueprintKey null, is the slot's default variety; so is a piece whose blueprint this build does
// not know, so a stray save never breaks the reader). Every variety is tagged (reactorTech.test.ts). Pure.
export function reactorPieceTech(piece: EquipmentInstance): ReactorTechId {
  const bp = piece.blueprintKey === null ? undefined : BLUEPRINTS[piece.blueprintKey];
  const variety = bp?.equipmentOutput?.varietyKey ?? DEFAULT_EQUIPMENT_VARIETY.reactorCore;
  const tech = REACTOR_VARIETY_TECH[variety];
  if (tech === undefined) throw new Error(`reactorPieceTech: variety ${variety} has no reactor tech`);
  return tech;
}

// `requirements`: the hull tier power generation table (the seam's test hook; the game reads the real, empty one).
export function shipPowerBudget(
  state: GameState,
  shipId: string,
  candidate?: PowerCandidate,
  requirements: Readonly<Partial<Record<number, ReactorTechId>>> = HULL_TIER_REACTOR_REQUIREMENT,
): ShipPowerBudget {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) throw new Error(`shipPowerBudget: no ship ${shipId}`);
  const pieces = piecesWith(state, shipId, candidate);
  const mods = equipmentStatMods(pieces);
  const baseOutput = SHIP_TYPES[ship.typeKey].basePowerOutput;
  const output = baseOutput + mods.powerOutput;
  const efficiency = Math.max(0, shipCrewContribution(state, ship)[CREW_STAT_KEYS.powerEfficiency] ?? 0);
  const draw = netPowerDraw(mods.totalPowerDraw, efficiency);
  const core = pieces.find((p) => p.slotType === "reactorCore");
  const reactorTech = core === undefined ? null : reactorPieceTech(core);
  const requiredTech = requiredReactorTech(SHIP_TYPES[ship.typeKey].tier, requirements);
  return {
    // The net draw is one figure (efficiency cuts the whole ship's draw, not each piece's).
    ...powerBudget(output, [{ powerDraw: draw }]),
    baseOutput,
    reactorOutput: mods.powerOutput,
    grossDraw: mods.totalPowerDraw,
    efficiency,
    reactorSurplus: Math.min(mods.powerOutput, Math.max(0, output - draw)),
    reactorTech,
    requiredReactorTech: requiredTech,
    reactorTechMet: meetsReactorRequirement(reactorTech, requiredTech),
  };
}
