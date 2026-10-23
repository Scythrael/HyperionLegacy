// E-MOD EM-1 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md sections 3.2 and 4 EM-1): a ship's
// POWER BUDGET, the one pure reader the power consumers go through (the install gate EM-2, the combat over-budget
// penalty EM-3 and the reactor surplus drive lift EM-4 build on it; the Ship Systems readout shows the same two
// numbers off the ship sheet, which this reader matches exactly: shipPower.test.ts).
//
//   output         = the hull's basePowerOutput (P1) + every installed powerOutput line (the Reactor Core implicit) +
//                    every installed Passive module's output (E-MOD EM-5, moduleOutput)
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
import { MULTI_SLOT_TYPES, equippedFor } from "./equipmentQueries";
import { netPowerDraw, shipCrewContribution, shipNetPowerTotals } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { POWER_SUPPLY_FLOOR_PERCENT, powerBudget, powerSupplyPercent, type PowerBudget } from "./combat/power";

export interface ShipPowerBudget extends PowerBudget {
  baseOutput: number; // the hull's own generation (basePowerOutput)
  reactorOutput: number; // the installed powerOutput lines (the Reactor Core implicit)
  moduleOutput: number; // E-MOD EM-5: the installed Passive modules' power output (shipModules.ts), never reactor surplus
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

// The state as the ship would be with `pieces` installed (every other piece untouched). The crew fold reads the ship's
// installed bridge and quarters modules, so a candidate that swaps one reads the efficiency it would really have. Pure.
function withShipPieces(state: GameState, shipId: string, pieces: EquipmentInstance[]): GameState {
  const ids = new Set(pieces.map((p) => p.id));
  return { ...state, equipment: [...state.equipment.filter((e) => e.fittedToShipId !== shipId && !ids.has(e.id)), ...pieces] };
}

// The ship's summed crew.powerEfficiency (Museum-amplified like every crew key), never below 0.
function shipPowerEfficiency(state: GameState, shipId: string): number {
  const ship = state.ships.find((s) => s.id === shipId)!;
  return Math.max(0, shipCrewContribution(state, ship)[CREW_STAT_KEYS.powerEfficiency] ?? 0);
}

// ============================================================================
// EM-2: the install gate's reading (plan section 4 EM-2; user answers P1, P2, 2026-10-17)
// ============================================================================
// The whole ship's output and NET draw (after power efficiency), PRISTINE gear only (wear is never read: gear wear
// design 4.3 keeps every gate on pristine values). No reactor tech lookup, so the gate never throws on a stray piece.
// FAST PATH: power efficiency only ever LOWERS the draw, so a ship whose gross draw is within its output is within
// budget whatever its crew, and the crew fold is not run at all (every live ship under P1).
export interface ShipPowerTotals {
  output: number;
  draw: number; // net of power efficiency; the gross draw when the fast path proves the ship fits
}
// E-MOD EM-3: the fold itself lives in crewOverlay.ts shipNetPowerTotals (the combat stamp reads the same one).
export function shipPowerTotals(state: GameState, shipId: string): ShipPowerTotals {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) throw new Error(`shipPowerTotals: no ship ${shipId}`);
  return shipNetPowerTotals(state, ship);
}

// How far over budget the ship is (0 when in budget). Over budget is a STRICT overrun (power.ts: exact-equal fits).
export function powerShortfall(t: ShipPowerTotals): number {
  return Math.max(0, t.draw - t.output);
}

// The non-worsening rule (user ruling 2026-10-21, "Allow non-worsening (Recommended)"). On a ship that is ALREADY over
// budget (P2: an officer left, a Reactor Core was removed; nothing is ever evicted), an install that does not make the
// shortfall WORSE is allowed (a bridge, an equal swap, a stronger but not yet sufficient Reactor Core), so the player
// is never forced to strip systems before installing anything at all. False = every install that leaves the ship over
// budget is refused. Read by installPowerShortfall below.
export const POWER_GATE_ALLOWS_NON_WORSENING_INSTALL = true;

// The gate's verdict as a number: 0 = the install passes; otherwise the WHOLE shortfall the ship would have after the
// install (net draw minus output), the honest "needs N more power" (user ruling 2026-10-21: never only the increment;
// a ship 10 over taking a 3-draw install needs 13). A ship that ends in budget always passes; with the non-worsening
// rule on, so does one whose shortfall does not grow. `after` is the ship as the install would leave it. Pure.
export function installPowerShortfall(
  before: ShipPowerTotals,
  after: ShipPowerTotals,
  allowNonWorsening: boolean = POWER_GATE_ALLOWS_NON_WORSENING_INSTALL,
): number {
  const afterShort = powerShortfall(after);
  if (afterShort === 0) return 0;
  if (allowNonWorsening && afterShort <= powerShortfall(before)) return 0;
  return afterShort;
}

// The gate over two states: the ship now (`before`) and as the install would leave it (`after`). The before state
// is read only when the after state is over budget. Pure.
export function installPowerShortfallBetween(before: GameState, after: GameState, shipId: string): number {
  const a = shipPowerTotals(after, shipId);
  if (powerShortfall(a) === 0) return 0;
  return installPowerShortfall(shipPowerTotals(before, shipId), a);
}

// The refusal text the gate's reason renders everywhere (Ship Systems, Install on..., the Armory, the log): the
// signed-off mockup's wording. Lower case first word, no final period, like every other install reason text.
export function overPowerReasonText(shortfall: number): string {
  return `needs ${shortfall} more power. Install a stronger Reactor Core or remove a powered system`;
}

// The over-budget warning (user answer P2, 2026-10-17: "Never evict; a warning chip"): null while the ship is in
// budget. A ship can only get here by losing power it had (an Engineering officer or Martian crew leaving, a Reactor
// Core uninstalled), since every install that would put it here is refused. `chip` is the short flag, `cause` names
// where the shortfall comes from, from the ship as it is now. Nothing is ever switched off or removed. `strength` is
// the combat line (E-MOD EM-3, user answer P6): the power supply percent its next fight runs at. Pure.
export interface OverBudgetNotice {
  shortfall: number;
  chip: string;
  supplyPercent: number;
  strength: string;
  gentleNote: string;
  cause: string;
}
export function overBudgetNotice(state: GameState, shipId: string): OverBudgetNotice | null {
  const t = shipPowerTotals(state, shipId);
  const shortfall = powerShortfall(t);
  if (shortfall === 0) return null;
  const ship = state.ships.find((s) => s.id === shipId)!;
  const mods = equipmentStatMods(equippedFor(state, shipId));
  const base = SHIP_TYPES[ship.typeKey].basePowerOutput;
  const gross = mods.totalPowerDraw;
  // The cause, named like the signed-off mockup ("No power efficiency (the Engineering officer was reassigned)"): the
  // efficiency side first (an Engineering officer gone, or no efficiency source aboard), then the supply side.
  const engineer = state.officers.some((o) => o.assignedShipId === shipId && o.seat === "engineering");
  const efficiency =
    gross > t.draw
      ? `Power efficiency cuts the draw from ${gross} to ${t.draw}, not enough`
      : shipPowerEfficiency(state, shipId) > 0
        ? "The power efficiency aboard is too small to cut a whole point of draw"
        : engineer
          ? "No power efficiency (no Reactor Overdrive, Power Discipline or Martian crew aboard)"
          : "No power efficiency (no Engineering officer aboard, and no Power Discipline or Martian crew)";
  // E-MOD EM-5: a Passive module's output is named beside the reactor's.
  const modules = mods.modulePowerOutput > 0 ? ` plus modules ${mods.modulePowerOutput}` : "";
  const supply =
    mods.powerOutput > 0
      ? `Hull ${base} plus Reactor Core ${mods.powerOutput}${modules} supply ${t.output}`
      : modules
        ? `No Reactor Core power: the hull's own ${base}${modules} supply ${t.output}`
        : `No Reactor Core power: the hull's own ${base} only`;
  const supplyPercent = powerSupplyPercent(t.output, t.draw);
  return {
    shortfall,
    chip: `Over budget by ${shortfall}`,
    supplyPercent,
    // The signed-off mockup's strength line; the stamp freezes it when a patrol cycle or an expedition starts.
    strength: `Weapons and shield recharge at ${supplyPercent}%.`,
    // The mockup's next sentence (the user's "Gentle penalty curve" and P6 floor), from the same constant the sim reads.
    gentleNote: `The cut is gentle and grows with the shortfall, never below ${POWER_SUPPLY_FLOOR_PERCENT}%.`,
    cause: `${efficiency}. ${supply}, against a draw of ${t.draw}. Nothing was switched off or removed. Install a stronger Reactor Core or remove a powered system to clear it.`,
  };
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
  const output = baseOutput + mods.powerOutput + mods.modulePowerOutput;
  // EM-2: a candidate's efficiency is read on the ship as the candidate leaves it (a quarters or bridge swap moves it).
  const efficiency = shipPowerEfficiency(candidate ? withShipPieces(state, shipId, pieces) : state, shipId);
  const draw = netPowerDraw(mods.totalPowerDraw, efficiency);
  const core = pieces.find((p) => p.slotType === "reactorCore");
  const reactorTech = core === undefined ? null : reactorPieceTech(core);
  const requiredTech = requiredReactorTech(SHIP_TYPES[ship.typeKey].tier, requirements);
  return {
    // The net draw is one figure (efficiency cuts the whole ship's draw, not each piece's).
    ...powerBudget(output, [{ powerDraw: draw }]),
    baseOutput,
    reactorOutput: mods.powerOutput,
    moduleOutput: mods.modulePowerOutput,
    grossDraw: mods.totalPowerDraw,
    efficiency,
    reactorSurplus: Math.min(mods.powerOutput, Math.max(0, output - draw)),
    reactorTech,
    requiredReactorTech: requiredTech,
    reactorTechMet: meetsReactorRequirement(reactorTech, requiredTech),
  };
}
