// GEAR WEAR step 5 (0.14.0): the WEAR UI's pure view models, from the approved mockup (user 2026-11-02: "The mockup is
// approved as well. 10/10.", https://claude.ai/artifact/HRa9zUf1XRrPoh9tuinhEF, design doc section 8), with Quick
// Service dropped (user 2026-11-09: "None, always automatic"):
//   - the gear card's condition block (pieceWearCard): a bar with its band and percent, the effect line, the stat lines
//     as worn ("was" struck through) and the care footer (back to full on its own; repair is always free), plus the
//     Overtime strip (gearOvertimeStrip, the 2026-11-09 Overtime mockup, user "Gear card only"; every number from the
//     engine's quote, processSpeed.ts canBuyGearRepairOvertime);
//   - the Ship Systems board's meters (conditionMeter) and its header chips (shipGearSummary);
//   - the Command Home fleet care block (fleetCare, OC-W8 / W6): one quiet line that reports gear wear and hull
//     repairs together, never a badge, a toast or a pulse, and is hidden entirely when nothing is worn or damaged.
// Every number is read from the engine (gearWear.ts constants and curves, gearWearEngine.ts livePieceCondition and
// gearRepairOutlook), so the text can never drift from what the sim does. Pure: no DOM, no clock.

import { EQUIPMENT_SLOTS, SHIP_TYPES, type EquipmentInstance, type GameState, type ShipInstance } from "./game/model";
import { CONDITION_FULL, USE_WEAR_FLOOR, WEAR_SOURCES, WEAR_VIEW_SLOTS, wearEfficiency, wornPieceView, type RepairContext } from "./game/gearWear";
import { gearOvertimeMult, gearRepairOutlook, livePieceCondition, repairContextIndex } from "./game/gearWearEngine";
import { OVERTIME_MAX_STEPS, OVERTIME_STEP_RATE, buyGearRepairOvertime, canBuyGearRepairOvertime, shipGearMinutesToFull } from "./game/processSpeed";

// ============================================================================
// Bands (design 2.2, the approved mockup): calm names, no "Broken", no red
// ============================================================================

export type WearBandKey = "pristine" | "sound" | "worn" | "battered";

export interface WearBand {
  key: WearBandKey;
  name: string;
  min: number; // per-mille, inclusive
}

// Worn's lower edge IS the use floor (ordinary use stops there, user 2026-11-09), which equals combat's Degraded line.
export const WEAR_BANDS: readonly WearBand[] = [
  { key: "pristine", name: "Pristine", min: 950 },
  { key: "sound", name: "Sound", min: 800 },
  { key: "worn", name: "Worn", min: USE_WEAR_FLOOR },
  { key: "battered", name: "Battered", min: 0 },
];

// The band edges the bar draws ticks at (percent), from the bands themselves.
export const WEAR_BAND_TICKS: readonly number[] = WEAR_BANDS.filter((b) => b.min > 0).map((b) => b.min / 10);

export function wearBand(condition: number): WearBand {
  return WEAR_BANDS.find((b) => condition >= b.min) ?? WEAR_BANDS[WEAR_BANDS.length - 1];
}

// A condition as a whole percent, rounded DOWN so 100% only ever means back to full. Pure.
export function conditionPercent(condition: number): number {
  return Math.max(0, Math.min(100, Math.floor(condition / 10)));
}

// One decimal, without a trailing ".0". Pure.
function oneDecimal(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
}

// "about 6 min" (at least 1), "about 1 h 20 min" past an hour. Pure.
export function aboutMinutes(minutes: number): string {
  const m = Math.max(1, Math.ceil(minutes - 1e-9));
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `about ${h} h` : `about ${h} h ${rest} min`;
}

// A per-mille-a-minute rate as the player reads it ("4% a minute", "0.2% a minute"). Pure.
export function ratePercentText(ratePerMinute: number): string {
  return `${oneDecimal(ratePerMinute / 10)}% a minute`;
}

// ============================================================================
// What a piece wears by, and what its wear does (design 3 and 4, as built)
// ============================================================================

// What a slot wears by, from the catalog (WEAR_SOURCES `by`), joined: "hours running and hits taken". Pure.
export function wearsByText(slotType: string): string | null {
  const by = [...new Set(WEAR_SOURCES.filter((s) => s.slot === slotType && s.raw > 0).map((s) => s.by))];
  if (by.length === 0) return null;
  return by.length === 1 ? by[0] : `${by.slice(0, -1).join(", ")} and ${by[by.length - 1]}`;
}

const POOL_SLOTS = new Set(["weapon", "reactorCore", "ftlDrive"]);
const BATTLE_EFFICIENCY_SLOTS = new Set(["shieldEmitters", "hullPlating", "droneBay", "module"]);

// The effect sentence after the band ("Worn 78%."), true to where the engine reads the wear:
//   - a run's worn view (WEAR_VIEW_SLOTS) scales the piece's own stat lines (its counts never move);
//   - a weapon, the Reactor Core and the drive open each fight's durability pool at their TRUE condition (user W3);
//     the Reactor Core's power output reads pristine (the install gate and the drive lift);
//   - shields, plating, drone pods and modules work at their efficiency in battle.
// Pure.
export function wearEffectText(slotType: string, condition: number): string {
  const pct = conditionPercent(condition);
  const eff = `${oneDecimal(wearEfficiency(condition) * 100)}%`;
  const parts: string[] = [];
  if (slotType === "ftlDrive") {
    parts.push(`Its transit speed works at ${eff} of new, and each fight opens it at ${pct}%. Reach is never reduced.`);
  } else if (slotType === "reactorCore") {
    parts.push(`Each fight opens it at ${pct}%. Its power output stays full.`);
  } else if (slotType === "weapon") {
    parts.push(`Opens each fight at ${pct}%.`);
  } else if (slotType === "module") {
    parts.push(`In battle its effect works at ${eff} of new.`);
  } else if (BATTLE_EFFICIENCY_SLOTS.has(slotType)) {
    parts.push(`In battle it works at ${eff} of new.`);
  } else if (WEAR_VIEW_SLOTS.has(slotType)) {
    parts.push(`Its stat lines work at ${eff} of new.`);
  }
  return parts.join(" ");
}

// ============================================================================
// The gear card (the mockup's section 1)
// ============================================================================

export interface WearStatLine {
  key: string;
  was: number;
  now: number;
}

export interface PieceWearCard {
  percent: number;
  band: WearBand;
  wearsBy: string | null;
  // The bold lead ("Worn 78%." / "Pristine.") and the rest of the effect line.
  lead: string;
  effect: string;
  // The piece's own stat lines as a run reads them, where wear scales them (a WEAR_VIEW_SLOTS piece below full).
  lines: WearStatLine[];
  // The care footer: back to full on its own, where it is.
  care: string;
  // The Overtime strip (a docked or out ship's installed piece with something worn), or null (hidden).
  overtime: GearOvertimeStrip | null;
}

function contextPlace(context: RepairContext): string {
  switch (context) {
    case "home":
      return "at home";
    case "shipyardBay":
      return "in the Shipyard bay";
    case "fieldRepair":
      return "set down for field repairs";
    case "underway":
      return "underway";
  }
}

// Is this ship out on a patrol (its captain's mission)? A patrol wears its gear by battle alone (user 2026-11-09
// "Combat only on patrols"). Pure.
export function shipOnPatrol(state: GameState, shipId: string): boolean {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.assignedCaptainId === null) return false;
  return state.captains.some((c) => c.id === ship.assignedCaptainId && c.mission?.kind === "patrol");
}

// The footer's last words (the Overtime mockup: "Repair is always free.", true at every Overtime step: Overtime buys
// speed, never the repair).
export const REPAIR_FREE_TEXT = "Repair is always free.";

// The care footer for a piece (the Overtime mockup: "Back to full in about 8 min at home, on its own. Repair is always
// free."; "with Overtime" once a step is bought). Out on a run it says what is true there (step 5 fix C2): the piece
// recovers slowly, which wear can still outpace, and fully once home. On a patrol only battle wears it (user 2026-11-09
// "Combat only on patrols"); on any other run use and battle. Pure.
export function pieceCareText(state: GameState, piece: EquipmentInstance): string {
  const o = gearRepairOutlook(state, piece);
  if (o.condition >= CONDITION_FULL) return "Nothing to do.";
  if (o.context === "fieldRepair") return `Recovers ${ratePercentText(o.ratePerMinute)} while ${contextPlace(o.context)}, and fully once home. On its own; ${REPAIR_FREE_TEXT.toLowerCase()}`;
  if (o.minutesToFull === null) {
    const outpace = piece.fittedToShipId && shipOnPatrol(state, piece.fittedToShipId) ? "battle damage" : "use and battle";
    return `Recovers ${ratePercentText(o.ratePerMinute)} underway, which ${outpace} can outpace, and fully once home. On its own; ${REPAIR_FREE_TEXT.toLowerCase()}`;
  }
  const how = piece.fittedToShipId && gearOvertimeMult(state, piece.fittedToShipId) > 1 ? "with Overtime" : "on its own";
  return `Back to full in ${aboutMinutes(o.minutesToFull)} ${contextPlace(o.context)}, ${how}. ${REPAIR_FREE_TEXT}`;
}

// The whole condition block of a piece's card, read live (its condition settled to now without writing). Pure.
export function pieceWearCard(state: GameState, piece: EquipmentInstance): PieceWearCard {
  const condition = livePieceCondition(state, piece);
  const band = wearBand(condition);
  const percent = conditionPercent(condition);
  const pristine = condition >= CONDITION_FULL;
  const lines: WearStatLine[] = [];
  if (!pristine && WEAR_VIEW_SLOTS.has(piece.slotType)) {
    const view = wornPieceView({ ...piece, condition });
    for (const [key, was] of [...Object.entries(piece.implicitStats), ...Object.entries(piece.rolledStats)]) {
      const now = (view.implicitStats[key] ?? view.rolledStats[key]) as number | undefined;
      if (now !== undefined && now !== was) lines.push({ key, was, now });
    }
  }
  return {
    percent,
    band,
    wearsBy: wearsByText(piece.slotType),
    lead: pristine ? "Pristine." : `${band.name} ${percent}%.`,
    effect: pristine ? "Operating like new." : wearEffectText(piece.slotType, condition),
    lines,
    care: pieceCareText(state, piece),
    overtime: pristine ? null : gearOvertimeStrip(state, piece),
  };
}

// ============================================================================
// The Overtime strip on the gear card (the 2026-11-09 Overtime mockup, approved; user calls "Per ship", "One tap",
// "Gear card only")
// ============================================================================

export type GearOvertimeState = "buy" | "credits" | "out" | "max";

export interface GearOvertimeStrip {
  shipId: string;
  shipName: string;
  steps: number; // bought so far (the pips)
  maxSteps: number;
  rateText: string | null; // "1.25x" once a step is bought
  state: GearOvertimeState;
  // The next step's exact price (buy, credits) and the credits still missing (credits).
  cost: number | null;
  need: number | null;
  // The button's face: "+25% · 300 cr" (buy), "300 cr · need 120 more" (credits), "Docked only" (out); null at max.
  button: string | null;
  // The time line: the new time to full against the time now (buy, credits), the time to full (max).
  when: string | null;
  minutesLeft: number | null;
  minutesAfter: number | null;
  // The dim note (buy, credits, max) or the reason it is off (out).
  note: string;
}

function credits(n: number): string {
  return `${n.toLocaleString("en-US")} cr`;
}

// The Overtime strip for an installed ship piece, read from the engine's quote (cost, minutesLeft, minutesLeftAfter),
// or null where the engine hides it: not on a ship, nothing worn on the ship, or within a tick of full. Pure.
export function gearOvertimeStrip(state: GameState, piece: EquipmentInstance): GearOvertimeStrip | null {
  const shipId = piece.fittedToShipId;
  if (!shipId) return null;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return null;
  const name = shipName(ship);
  const steps = ship.gearRepairSpeed?.overtimeSteps ?? 0;
  const pct = `+${Math.round(OVERTIME_STEP_RATE * 100)}%`;
  const rateText = steps > 0 ? `${Math.round((1 + OVERTIME_STEP_RATE * steps) * 100) / 100}x` : null;
  const base = { shipId, shipName: name, steps, maxSteps: OVERTIME_MAX_STEPS, rateText };
  const q = canBuyGearRepairOvertime(state, shipId);
  if (q.ok) {
    return {
      ...base,
      state: "buy",
      cost: q.cost,
      need: null,
      button: `${pct} · ${credits(q.cost)}`,
      when: `${steps === 0 ? `Speeds up all of ${name}'s gear: full` : `Next step: all of ${name}'s gear full`} in ${aboutMinutes(q.minutesLeftAfter)} instead of ${aboutMinutes(q.minutesLeft)}.`,
      minutesLeft: q.minutesLeft,
      minutesAfter: q.minutesLeftAfter,
      note: steps === 0 ? `Optional. Docked ships only; clears when the gear is full or ${name} leaves.` : `Clears when the gear is full or ${name} leaves.`,
    };
  }
  switch (q.reason) {
    case "credits": {
      const cost = q.cost ?? 0;
      const need = Math.max(0, Math.ceil(cost - state.credits.toNumber()));
      const left = shipGearMinutesToFull(state, shipId);
      return {
        ...base,
        state: "credits",
        cost,
        need,
        button: `${credits(cost)} · need ${need.toLocaleString("en-US")} more`,
        when: left === null ? null : `All of ${name}'s gear full in ${aboutMinutes(left)}.`,
        minutesLeft: left,
        minutesAfter: null,
        note: `Repair carries on free either way; clears when the gear is full or ${name} leaves.`,
      };
    }
    case "notEligible":
      return {
        ...base,
        state: "out",
        cost: null,
        need: null,
        button: "Docked only",
        when: null,
        minutesLeft: null,
        minutesAfter: null,
        note: `Overtime works only while ${name} is docked. It is out on a run; once home, its gear recovers fast on its own.`,
      };
    case "maxSteps": {
      const left = shipGearMinutesToFull(state, shipId);
      return {
        ...base,
        state: "max",
        cost: null,
        need: null,
        button: null,
        when: left === null ? null : `All of ${name}'s gear full in ${aboutMinutes(left)}.`,
        minutesLeft: left,
        minutesAfter: null,
        note: `Clears when the gear is full or ${name} leaves.`,
      };
    }
    default:
      // notFound, nothingWorn, finishing: hidden (the card reads "Nothing to do." or is about to).
      return null;
  }
}

// One tap on the strip's button (user "One tap": no confirm): the engine's buy (processSpeed.ts buyGearRepairOvertime)
// and the log line the host pushes. A refusal changes nothing and logs nothing (the strip already shows why). Pure.
export function gearOvertimePurchase(state: GameState, shipId: string): { next: GameState; bought: boolean; log: string | null } {
  const q = canBuyGearRepairOvertime(state, shipId);
  const r = buyGearRepairOvertime(state, shipId);
  if (!r.bought || !q.ok) return { next: state, bought: false, log: null };
  const ship = r.next.ships.find((s) => s.id === shipId);
  const name = ship ? shipName(ship) : shipId;
  return {
    next: r.next,
    bought: true,
    log: `Overtime on ${name}'s gear repair: step ${q.step} of ${OVERTIME_MAX_STEPS} for ${credits(q.cost)}. All of its gear full in ${aboutMinutes(q.minutesLeftAfter)}.`,
  };
}

// ============================================================================
// The Ship Systems board (the mockup's section 2): a meter per row, one header chip
// ============================================================================

export interface ConditionMeter {
  percent: number;
  band: WearBandKey;
  label: string; // "Condition 78%, Worn"
}

export function conditionMeter(state: GameState, piece: EquipmentInstance): ConditionMeter {
  const c = livePieceCondition(state, piece);
  const band = wearBand(c);
  const percent = conditionPercent(c);
  return { percent, band: band.key, label: `Condition ${percent}%, ${band.name}` };
}

export interface ShipGearSummary {
  percent: number; // the mean condition of the ship's installed pieces
  band: WearBandKey;
  worn: boolean;
  // The recovery chip, null when nothing is worn: "Recovering, full in about 11 min", or while out on a run.
  recovery: string | null;
  context: RepairContext | null;
  minutesToFull: number | null;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? CONDITION_FULL : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function shipGearSummary(state: GameState, shipId: string): ShipGearSummary {
  const pieces = state.equipment.filter((p) => p.fittedToShipId === shipId);
  const conds = pieces.map((p) => livePieceCondition(state, p));
  const avg = Math.floor(mean(conds));
  const worn = conds.some((c) => c < CONDITION_FULL);
  if (!worn) return { percent: conditionPercent(avg), band: wearBand(avg).key, worn, recovery: null, context: null, minutesToFull: 0 };
  let most = 0;
  let out: RepairContext | null = null;
  let ctx: RepairContext | null = null;
  pieces.forEach((p, i) => {
    if (conds[i] >= CONDITION_FULL) return;
    const o = gearRepairOutlook(state, p);
    ctx = o.context;
    if (o.minutesToFull === null) out = o.context;
    else most = Math.max(most, o.minutesToFull);
  });
  const context = out ?? ctx;
  let recovery: string;
  if (out === "fieldRepair") recovery = "Field repair, recovering";
  // Step 5 fix C2: out on a run, wear (battle on a patrol; use and battle elsewhere) can outpace the slow underway upkeep,
  // so the chip never claims recovery.
  else if (out !== null) recovery = "Out on a run, full once home";
  else recovery = `Recovering, full in ${aboutMinutes(most)}`;
  return { percent: conditionPercent(avg), band: wearBand(avg).key, worn, recovery, context, minutesToFull: out !== null ? null : most };
}

// ============================================================================
// The fleet care block on Command Home (the mockup's section 4; W8 placement, W6 shown together)
// ============================================================================

export interface FleetCareRow {
  shipId: string;
  name: string;
  hull: string | null; // the hull class, beside a custom name only
  percent: number;
  band: WearBandKey;
  status: string; // "Docked, full in about 12 min" / "Hull in a Shipyard bay, about 4 min. Gear full in about 6 min"
}

export interface FleetCareModel {
  percent: number;
  band: WearBandKey;
  summary: string; // "2 ships recovering. Docked gear back to full in about 12 min."
  rows: FleetCareRow[];
}

function shipName(ship: ShipInstance): string {
  return ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.typeKey;
}

// The hull repair the Shipyard runs for a ship, in minutes left, or null (none running).
function hullRepairMinutes(state: GameState, shipId: string): number | null {
  const p = state.activeProcesses.find((q) => q.kind === "shipRepair" && q.effect.type === "clearShipDamage" && q.effect.shipId === shipId);
  return p ? (p.remainingTicks * state.tickDurationSeconds) / 60 : null;
}

// The fleet's care line, or null when every ship's gear is pristine and no hull is damaged (hidden entirely). Pure.
export function fleetCare(state: GameState): FleetCareModel | null {
  const rows: FleetCareRow[] = [];
  const all: number[] = [];
  let docked = 0;
  let dockedMinutes = 0;
  const index = repairContextIndex(state);
  for (const ship of state.ships) {
    const summary = shipGearSummary(state, ship.id);
    for (const p of state.equipment) if (p.fittedToShipId === ship.id) all.push(livePieceCondition(state, p));
    const hullMinutes = hullRepairMinutes(state, ship.id);
    const damaged = ship.damaged === true;
    if (!summary.worn && !damaged) continue;
    const parts: string[] = [];
    if (damaged) parts.push(hullMinutes !== null ? `Hull in a Shipyard bay, ${aboutMinutes(hullMinutes)}` : "Hull waiting for a free Shipyard bay");
    if (summary.worn) {
      if (summary.minutesToFull === null) {
        // A patrol wears its gear by battle alone (user 2026-11-09 "Combat only on patrols"); any other run by use too.
        const out = shipOnPatrol(state, ship.id) ? "On patrol, gear wears only in battle and recovers fully once home" : "Out on a run, gear wears with use and recovers fully once home";
        parts.push(index.field.has(ship.id) ? "Set down for field repairs, gear recovering" : out);
      }
      else {
        docked += 1;
        dockedMinutes = Math.max(dockedMinutes, summary.minutesToFull);
        parts.push(`${damaged ? "Gear" : "Docked, gear"} full in ${aboutMinutes(summary.minutesToFull)}`);
      }
    }
    // The hull class shows beside a custom name only (an unnamed ship's name IS its hull label).
    rows.push({ shipId: ship.id, name: shipName(ship), hull: ship.name ? SHIP_TYPES[ship.typeKey]?.label ?? ship.typeKey : null, percent: summary.percent, band: summary.band, status: parts.join(". ") });
  }
  if (rows.length === 0) return null;
  const avg = Math.floor(mean(all));
  const n = rows.length;
  let summary = `${n} ${n === 1 ? "ship" : "ships"} recovering.`;
  if (docked > 0) summary += ` Docked gear back to full in ${aboutMinutes(dockedMinutes)}.`;
  return { percent: conditionPercent(avg), band: wearBand(avg).key, summary, rows };
}

// The slot label a piece's card names (for the Help and QA references). Pure.
export function wearSlotLabel(slotType: string): string {
  return EQUIPMENT_SLOTS[slotType]?.label ?? slotType;
}
