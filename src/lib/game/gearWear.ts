// GEAR WEAR (0.14.0), build order steps 1 and 2 of docs/plans/2026-10-16-gear-wear-design.md section 11: the
// catalogs and the PURE helpers, plus (step 3) the WORN-GEAR VIEW the run readers fold their gear through. The tick
// side of step 3 (the use wear sources, the repair contexts and the settling) lives in gearWearEngine.ts; the combat
// half is step 4, the UI (and the optional paid repair) is step 5. Every catalog row is registered in the wiring
// registry with its owning step.
//
// The user (OC-D14, 2026-10-16, verbatim): "Everything wears in different ways. Similar to reality. Use. Battle
// damage. Etc. But can easily be repaired over time."
//
// USER ANSWERS this module binds (design doc, 2026-10-16):
//   - W1 "0-1000 condition": a piece's condition is an integer PER-MILLE, 0..1000 (1000 = pristine), stored as
//     EquipmentInstance.condition (ABSENT = 1000) with its settle anchor conditionAt. It replaces the old
//     `durability` field, which never dropped (MIGRATIONS[69] deletes it). `durabilityMax` stays: it is the piece's
//     TOUGHNESS (every wear amount scales by TOUGHNESS_REFERENCE / durabilityMax) and the size of its combat pool.
//   - W2 + W7 "Gentle": ordinary use wears a piece to USE_WEAR_FLOOR (60%) at most; only battle goes lower; a fully
//     worn piece still works at 75% (WEAR_EFFICIENCY_DEPTH). Nothing breaks, uninstalls or blocks a run.
//   - W3 "True condition": a system opens a fight at its REAL condition (pieceStartDurability), never a raised
//     start floor. Combat's own four-state model stays the authority there (no second efficiency penalty).
//   - W9 + W10 "No wear on training; implants slow": a training run (safe first run) applies no wear at all (step 3
//     skips it on the run's stamp); the implant wears by the slowest raw rate in WEAR_SOURCES.
//   - W4 + W5 and the repair model "Free auto + paid rush": repair is automatic and FREE over time (REPAIR_RATES);
//     an optional paid repair is added later for credits (credit sinks pass: "Quick gear repair" and the user's
//     Overtime, both built in step 5), and nothing ever forces paying.
//   - W6 "Separate, shown together": hull damage stays its own Shipyard system; nothing here touches it. A hull in a
//     Shipyard repair bay only lends its gear the faster bay rate.
//
// Determinism: no draws anywhere (plain integer arithmetic on outcomes the game already computes). Repair is closed
// form from an anchor (settleCondition), so one long offline chunk and many live ticks give the same piece once step
// 3 settles only at game events.

import type { EquipmentInstance, EquipmentSlotType } from "./model";

// ============================================================================
// Units (user W1) and depth (user W2 + W7)
// ============================================================================

// A pristine piece. Condition is an integer per-mille (user W1 "0-1000 condition").
export const CONDITION_FULL = 1000;

// The use floor (user W2 "Gentle": "use wears gear to 60% at most; only battle goes lower").
export const USE_WEAR_FLOOR = 600;

// The penalty depth of the efficiency curve (user W7 "Gentle": "a fully worn piece works at 75%"). A penalty depth,
// not a bonus cap, so D23 (diminishing, never capped) does not apply to it.
export const WEAR_EFFICIENCY_DEPTH = 0.25;

// The durabilityMax every raw rate below is quoted for. A tougher piece wears slower: plating (base 160) wears at
// 62% of the reference, a member tool (base 80) at 125%, and a quality-5 piece (x2 ceiling) at half its quality-0
// twin. This is what makes SLOT_BASE_PHYSICALS durability, QUALITY_DURABILITY_BONUS and DRONE_POD_BASE_DURABILITY act.
export const TOUGHNESS_REFERENCE = 100;

// ============================================================================
// The catalogs (design sections 3 and 5; one wiring registry entry per row)
// ============================================================================

// The slots wear acts on: every ship and member slot that has pieces today. Thrusters and propellant tanks are
// reserved slots with no pieces (design 3.1: "when a consumer exists").
export type WearSlot = Extract<
  EquipmentSlotType,
  | "cargoBay"
  | "ftlDrive"
  | "reactorCore"
  | "specUtility"
  | "sensor"
  | "bridge"
  | "quarters"
  | "weapon"
  | "shieldEmitters"
  | "hullPlating"
  | "droneBay"
  | "memberArmor"
  | "memberWeapon"
  | "memberTool"
  | "implant"
>;

// "use" stops at USE_WEAR_FLOOR and shrinks as the piece nears it; "battle" can go to 0 (never below) and never
// destroys, salvages or uninstalls anything.
export type WearMode = "use" | "battle";

export interface WearSourceDef {
  readonly id: string; // "<slot>:<source>"
  readonly slot: WearSlot;
  readonly mode: WearMode;
  readonly by: string; // what the piece wears by (player text)
  readonly event: string; // the discrete game event that applies it (never a tick-chunk boundary)
  // Per-mille at full condition on a TOUGHNESS_REFERENCE piece. A use source is quoted per `per` units of its event
  // (the FTL drive: 1 per 10 ly). A battle source is proportional: raw x lost / max of what the battle took (a pool
  // source converts the existing combat pool loss, raw 1000 = the whole pool, design 3.2).
  readonly raw: number;
  readonly per: number;
}

// [PROVISIONAL] every raw value: the design's first pass (sections 3.1 and 3.2, marked [PROPOSAL] there). The use
// rows were tuned in step 3 (2026-10-21, measured on the real engine, gearWearEngine.test.ts "the section 3.4
// targets") so a Standard-Issue freighter on Repeat on a starter mission (Short Ore Run) settles near 90% on use
// alone and an ordinary expedition comes home with its gear 80% or better: the cargo bay 12 -> 8 a haul (12 settled
// it at 77%, Worn), the FTL drive 1 -> 2 per 10 ly, the reactor 3 -> 4 and the crew modules 2 -> 4 a minute, a
// utility piece's fire 6 -> 8 and the survey cycle 6 -> 12 (each lower value never outran the underway upkeep once the
// whole-per-mille rounding of a short cycle is counted). The sources, the use floor and the slow implant are the
// user's; the numbers are not yet.
export const WEAR_SOURCES: readonly WearSourceDef[] = [
  // Use wear (stops at the use floor).
  { id: "cargoBay:haul", slot: "cargoBay", mode: "use", by: "hauls", event: "per completed haul cycle", raw: 8, per: 1 },
  { id: "ftlDrive:distance", slot: "ftlDrive", mode: "use", by: "distance", event: "per 10 ly traveled on any run, applied per leg", raw: 2, per: 10 },
  { id: "reactorCore:minutesRunning", slot: "reactorCore", mode: "use", by: "hours running", event: "per minute underway, applied per leg or cycle", raw: 4, per: 1 },
  { id: "specUtility:effectFires", slot: "specUtility", mode: "use", by: "its own job", event: "per cycle its effect fires", raw: 8, per: 1 },
  { id: "sensor:bodyScanned", slot: "sensor", mode: "use", by: "scans", event: "per body scanned on an expedition", raw: 15, per: 1 },
  { id: "sensor:surveyCycle", slot: "sensor", mode: "use", by: "scans", event: "per survey mission cycle", raw: 12, per: 1 },
  { id: "bridge:minutesCrewed", slot: "bridge", mode: "use", by: "time aboard", event: "per minute underway with crew aboard", raw: 4, per: 1 },
  { id: "quarters:minutesCrewed", slot: "quarters", mode: "use", by: "time aboard", event: "per minute underway with crew aboard", raw: 4, per: 1 },
  { id: "memberWeapon:groundFight", slot: "memberWeapon", mode: "use", by: "fights", event: "per ground fight its wearer fights", raw: 10, per: 1 },
  { id: "memberTool:fieldworkStep", slot: "memberTool", mode: "use", by: "fieldwork", event: "per fieldwork step its wearer completes", raw: 6, per: 1 },
  // User W10 "implants slow" ("Wear very slowly by time on the ground"): the slowest time rate in the catalog, set
  // just above the underway upkeep (2 a minute) so it wears at all (step 3 tune: 1 a minute never outran the upkeep,
  // which made it the "Never wear" option the user did not pick). On a long run it settles near 95% while on the
  // ground and recovers on the trip home.
  { id: "implant:minutesOnGround", slot: "implant", mode: "use", by: "time deployed", event: "per minute on the ground", raw: 2.5, per: 1 },
  // Battle wear (can go below the floor, down to 0). Pool sources convert the EXISTING combat-stream pool loss.
  { id: "weapon:hitsTaken", slot: "weapon", mode: "battle", by: "hits taken", event: "per patrol cycle: the weapon's pool loss", raw: 1000, per: 1 },
  { id: "reactorCore:hitsTaken", slot: "reactorCore", mode: "battle", by: "hits taken", event: "per patrol cycle: the reactor's pool loss", raw: 1000, per: 1 },
  { id: "ftlDrive:hitsTaken", slot: "ftlDrive", mode: "battle", by: "hits taken", event: "per patrol cycle: the drive's pool loss", raw: 1000, per: 1 },
  { id: "shieldEmitters:damageAbsorbed", slot: "shieldEmitters", mode: "battle", by: "damage absorbed", event: "per wave: shield damage absorbed / shield max", raw: 150, per: 1 },
  { id: "hullPlating:hullLost", slot: "hullPlating", mode: "battle", by: "hull lost", event: "per wave: hull lost / hull max (and expedition hull wear)", raw: 250, per: 1 },
  { id: "droneBay:dronesLost", slot: "droneBay", mode: "battle", by: "drones lost", event: "per wave: drones lost / squadron size", raw: 300, per: 1 },
  { id: "memberArmor:hpLost", slot: "memberArmor", mode: "battle", by: "hits on the wearer", event: "per ground fight: hp lost / hp max", raw: 250, per: 1 },
];

const WEAR_SOURCE_BY_ID: ReadonlyMap<string, WearSourceDef> = new Map(WEAR_SOURCES.map((s) => [s.id, s] as const));

// Where a piece is, for its repair rate (design 5.1). Member gear follows its member's ship.
export type RepairContext = "home" | "shipyardBay" | "fieldRepair" | "underway";

// [PROVISIONAL] per-mille per minute, all automatic and FREE (user "Free auto + paid rush"). The rates are the
// design's first pass (5.1, [PROPOSAL]); the slow-underway-plus-fast-at-home shape is OC-W4's recommended option,
// which the user's W4 answer kept ("keep the free automatic repair over time").
//   home        : its ship is docked and on no run; any spare in storage; any Armory loadout piece not checked out
//   shipyardBay : its ship sits in a Shipyard repair bay (the hull repair, which stays its own system, user W6)
//   fieldRepair : its ship is set down on a GO-8b field repair leg
//   underway    : any run (crew upkeep; balances use wear, design 3.4)
export const REPAIR_RATES: Readonly<Record<RepairContext, number>> = {
  home: 40,
  shipyardBay: 80,
  fieldRepair: 40,
  underway: 2,
};

// The two existing bonuses that already shorten a hull repair act on every gear repair rate too (design 5.1, no new
// sources): rate x (1 + officer repair speed) / (1 - Damage Control Suite repair time reduction), the same algebra
// shipRepairDurationTicks uses for the hull.
export const REPAIR_RATE_BONUSES = ["officerRepairSpeed", "damageControlRepairTime"] as const;
export type RepairRateBonus = (typeof REPAIR_RATE_BONUSES)[number];

// Every stat line wear scales (design 4.2), by slot: the efficiency multiplier applies to the piece's OWN lines
// before the existing fold and curves. `combat` marks the consumers read when a patrol cycle's player combatant is
// built (step 4); the rest are economy, crew, sensor and ground readers (step 3). Never touched (design 4.3): reach,
// the power-budget install gate, crew station COUNTS, hangar bay counts and every equip requirement read the
// PRISTINE value. Weapons, the reactor and the FTL drive in battle are absent on purpose: combat's four-state model
// is the authority there (user W3), so there is no second penalty.
export interface WearEfficiencyConsumer {
  readonly id: string; // "<slot>:<consumer>"
  readonly slot: WearSlot;
  readonly reads: string; // what the multiplier scales (player text)
  readonly combat: boolean;
}

export const WEAR_EFFICIENCY: readonly WearEfficiencyConsumer[] = [
  { id: "cargoBay:cargoCapacity", slot: "cargoBay", reads: "cargo capacity", combat: false },
  { id: "ftlDrive:transitSpeed", slot: "ftlDrive", reads: "transit speed", combat: false },
  { id: "ftlDrive:engineEfficiency", slot: "ftlDrive", reads: "engine efficiency", combat: false },
  { id: "reactorCore:powerOutput", slot: "reactorCore", reads: "power output where something consumes it (never the install gate)", combat: false },
  { id: "specUtility:lines", slot: "specUtility", reads: "its lines (prospecting yields, repair speed, wave hull regen, scan speed, hazard resist)", combat: false },
  { id: "sensor:lines", slot: "sensor", reads: "scan rate, coverage and foreknowledge", combat: false },
  { id: "bridge:crewEfficiency", slot: "bridge", reads: "crew efficiency (never the station count)", combat: false },
  { id: "quarters:crewEfficiency", slot: "quarters", reads: "crew efficiency (never the station count)", combat: false },
  { id: "shieldEmitters:shields", slot: "shieldEmitters", reads: "shield capacity and recharge", combat: true },
  { id: "hullPlating:hullPoints", slot: "hullPlating", reads: "hull points", combat: true },
  { id: "droneBay:drones", slot: "droneBay", reads: "drone hp and yield (never the bay count)", combat: true },
  { id: "memberArmor:groundLines", slot: "memberArmor", reads: "its ground lines", combat: false },
  { id: "memberWeapon:groundLines", slot: "memberWeapon", reads: "its ground lines", combat: false },
  { id: "memberTool:fieldworkLines", slot: "memberTool", reads: "its fieldwork lines", combat: false },
  { id: "implant:groundLines", slot: "implant", reads: "its ground lines", combat: false },
];

// ============================================================================
// Pure helpers
// ============================================================================

// A stored per-mille read safely: a whole number in 0..CONDITION_FULL (anything else reads pristine, so a junk
// value can never wear a piece). Pure.
function clampCondition(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CONDITION_FULL;
  return Math.max(0, Math.min(CONDITION_FULL, Math.floor(value)));
}

// A piece's condition, per-mille. ABSENT = pristine (every piece minted or migrated before wear first happens).
export function pieceCondition(piece: Pick<EquipmentInstance, "condition">): number {
  return piece.condition === undefined ? CONDITION_FULL : clampCondition(piece.condition);
}

// A copy of the piece at `condition`, anchored at `atSeconds` (game time). Back at full, BOTH fields are removed, so
// a recovered piece serializes exactly as a pristine one (design 6.1). Pure.
export function withPieceCondition<T extends EquipmentInstance>(piece: T, condition: number, atSeconds: number): T {
  const c = clampCondition(condition);
  if (c >= CONDITION_FULL) {
    if (piece.condition === undefined && piece.conditionAt === undefined) return piece;
    const { condition: _c, conditionAt: _a, ...rest } = piece;
    return rest as T;
  }
  return { ...piece, condition: c, conditionAt: atSeconds };
}

// The efficiency multiplier at a condition (design 4.1, user W7): 1 - depth x (1 - c / 1000)^2. Smooth and concave
// in wear: 99.75% at 90%, 99% at 80%, 96% at the use floor, 75% at 0. Pure.
export function wearEfficiency(condition: number): number {
  const missing = 1 - clampCondition(condition) / CONDITION_FULL;
  return 1 - WEAR_EFFICIENCY_DEPTH * missing * missing;
}

// The efficiency of one piece (pristine = exactly 1). Pure.
export function pieceWearEfficiency(piece: Pick<EquipmentInstance, "condition">): number {
  return wearEfficiency(pieceCondition(piece));
}

// The consumers a slot's wear scales (WEAR_EFFICIENCY). Pure.
export function wearEfficiencyConsumers(slot: WearSlot): WearEfficiencyConsumer[] {
  return WEAR_EFFICIENCY.filter((c) => c.slot === slot);
}

// TOUGHNESS (design 2.1): a raw per-mille amount scaled by TOUGHNESS_REFERENCE / durabilityMax, floored, and at least
// 1 whenever the raw amount is at least 1 (so a small amount never vanishes on a tough piece). Pure.
export function toughnessScale(raw: number, durabilityMax: number): number {
  if (!(raw > 0)) return 0;
  const max = durabilityMax > 0 ? durabilityMax : TOUGHNESS_REFERENCE;
  const scaled = Math.floor((raw * TOUGHNESS_REFERENCE) / max);
  return raw >= 1 ? Math.max(1, scaled) : scaled;
}

// A use source's raw per-mille for `units` of its event (the FTL drive: per 10 ly, so 25 ly is 2). Pure.
export function useWearRaw(sourceId: string, units: number): number {
  const s = WEAR_SOURCE_BY_ID.get(sourceId);
  if (!s || s.mode !== "use" || !(units > 0)) return 0;
  return Math.floor((s.raw * units) / s.per);
}

// A battle source's raw per-mille: raw x lost / max (a pool source: the pool points lost over the pool size). Pure.
export function battleWearRaw(sourceId: string, lost: number, max: number): number {
  const s = WEAR_SOURCE_BY_ID.get(sourceId);
  if (!s || s.mode !== "battle" || !(lost > 0) || !(max > 0)) return 0;
  return Math.floor((s.raw * Math.min(lost, max)) / max);
}

// USE WEAR (design 3.1, user W2): how much a use event takes off a piece at `condition`. The toughness-scaled amount
// shrinks with the headroom above the floor, x (c - floor) / (1000 - floor), so a piece in continuous use settles where
// wear and upkeep balance instead of grinding down; at least 1 while there is headroom and the raw amount is at least
// 1; never more than the headroom, so use alone can never take a piece below USE_WEAR_FLOOR. Pure.
export function useWear(raw: number, durabilityMax: number, condition: number): number {
  const c = clampCondition(condition);
  const headroom = c - USE_WEAR_FLOOR;
  if (headroom <= 0) return 0;
  const scaled = toughnessScale(raw, durabilityMax);
  if (scaled <= 0) return 0;
  const amount = Math.max(1, Math.floor((scaled * headroom) / (CONDITION_FULL - USE_WEAR_FLOOR)));
  return Math.min(amount, headroom);
}

// BATTLE WEAR (design 3.2): a battle amount off a piece at `condition`, which may go below the use floor down to 0 and
// never below. Returns the new condition. Pure.
export function applyBattleWear(condition: number, amount: number): number {
  const c = clampCondition(condition);
  return amount > 0 ? Math.max(0, c - Math.floor(amount)) : c;
}

// A repair context's rate in per-mille per minute, lifted by the two hull repair bonuses (REPAIR_RATE_BONUSES). A
// reduction at or above 1 is ignored (no division by zero, no negative rate). Pure.
export function repairRatePerMinute(context: RepairContext, bonuses: Partial<Record<RepairRateBonus, number>> = {}): number {
  const officer = bonuses.officerRepairSpeed ?? 0;
  const dc = bonuses.damageControlRepairTime ?? 0;
  const lift = officer > 0 ? 1 + officer : 1;
  const divisor = dc > 0 && dc < 1 ? 1 - dc : 1;
  return (REPAIR_RATES[context] * lift) / divisor;
}

// SETTLE (design 7): the condition at `nowSeconds` from an anchor, closed form: min(1000, c + floor(rate x elapsed /
// 60)), the rate constant since the anchor. An anchor in the future (or no rate) changes nothing. Pure.
export function settleCondition(condition: number, anchorSeconds: number, nowSeconds: number, ratePerMinute: number): number {
  const c = clampCondition(condition);
  const elapsed = nowSeconds - anchorSeconds;
  if (!(elapsed > 0) || !(ratePerMinute > 0) || c >= CONDITION_FULL) return c;
  return Math.min(CONDITION_FULL, c + Math.floor((ratePerMinute * elapsed) / 60));
}

// A piece settled to `nowSeconds` at `ratePerMinute` (repair folded in, the anchor moved). The anchor advances only by
// the time the whole per-mille gained actually used (gained x 60 / rate), so the leftover fraction carries to the next
// settle: many short settles give exactly what one long settle gives (offline == live), and a settle cadence shorter
// than one per-mille's worth of time still repairs. With no gain the piece is returned as it is (the same reference);
// back at full both fields are removed. A pristine piece is returned as it is. Pure.
export function settlePiece<T extends EquipmentInstance>(piece: T, nowSeconds: number, ratePerMinute: number): T {
  if (piece.condition === undefined) return piece;
  const before = pieceCondition(piece);
  // A worn piece with no anchor (a hand-edited save) starts recovering from now.
  if (piece.conditionAt === undefined) return withPieceCondition(piece, before, nowSeconds);
  const anchor = piece.conditionAt;
  const after = settleCondition(before, anchor, nowSeconds, ratePerMinute);
  if (after === before) return piece;
  const gained = after - before;
  return withPieceCondition(piece, after, anchor + (gained * 60) / ratePerMinute);
}

// The durability a piece's combat pool OPENS at (user W3 "True condition": its real condition, no raised start floor):
// round(durabilityMax x condition / 1000). A pristine piece opens at exactly durabilityMax, which is what the retired
// `durability` field always held, so every pristine fight is byte-identical. Pure.
export function pieceStartDurability(piece: Pick<EquipmentInstance, "condition" | "durabilityMax">): number {
  const c = pieceCondition(piece);
  if (c >= CONDITION_FULL) return piece.durabilityMax;
  return Math.round((piece.durabilityMax * c) / CONDITION_FULL);
}

// ============================================================================
// Step 3: the WORN-GEAR VIEW (design 4.2, user W2 + W7 "Gentle")
// ============================================================================
//
// What wear DOES: a worn piece's OWN stat lines (implicit and rolled) scale by its efficiency before the existing
// fold and curves, so every downstream curve still sees one input. It acts ONLY where a run reads its gear (the use
// contexts gear wear step 3 covers; gearWearEngine.ts runShipStats and the expedition dispatch snapshot):
//   - a captain mission (extraction, survey, transport): the mission sheet economyTick folds each tick,
//   - a short-range cycle: the plan frozen at each cycle start and the cycle engine's sheet,
//   - an expedition dispatch: the sensor snapshot, the gear bonuses, the away team and its roster, the voyage.
// Never in a gate (reach, the short-range sheet, the power-budget install gate, crew station counts, equip
// requirements: they read the real state, design 4.3) and never in combat (patrols and every ship battle read the
// real state: combat's four-state model is the authority, user W3, and the combat half is step 4).
//
// The view is a COPY of the state's equipment list (the stored pieces are never touched): a pristine piece is the
// same object, a worn piece of a VIEW slot is a fresh object with its lines scaled. A piece whose effect is not a
// line (a crew module's boost, a sensor array's variety effect) reads its efficiency through viewPieceEfficiency,
// which is 1 for every stored piece and the piece's efficiency for a view copy, so those readers act in the run
// contexts only, exactly like the lines.

// The slots the view scales: every non-combat efficiency consumer (WEAR_EFFICIENCY). The reactor is left out: its
// only reader outside the install gate (pristine, design 4.3) is the combat power budget, where combat's own model is
// the authority (W3), so its catalog row is owned by step 4.
export const WEAR_VIEW_SLOTS: ReadonlySet<string> = new Set(WEAR_EFFICIENCY.filter((c) => !c.combat && c.slot !== "reactorCore").map((c) => c.slot));

// Lines that are COUNTS, never scaled by wear (design 4.3: no station, berth or charge count moves with condition):
// crew stations, guest berths and a member's grenade carry.
export const WEAR_EXEMPT_LINES: ReadonlySet<string> = new Set(["crewStations", "colonistCapacity", "groundCarryCapacity"]);

// The efficiency each view copy was built at (a WeakMap, so it never reaches a save).
const VIEW_EFFICIENCY = new WeakMap<object, number>();
const VIEW_CACHE = new WeakMap<readonly EquipmentInstance[], EquipmentInstance[]>();

function scaledLines(lines: Readonly<Record<string, number>>, efficiency: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(lines)) out[k] = WEAR_EXEMPT_LINES.has(k) ? v : v * efficiency;
  return out;
}

// One piece as the run readers see it: the same object when pristine or outside the view slots, else a copy with
// its lines scaled by its efficiency (recorded for viewPieceEfficiency). Pure.
export function wornPieceView(piece: EquipmentInstance): EquipmentInstance {
  if (!WEAR_VIEW_SLOTS.has(piece.slotType)) return piece;
  const efficiency = pieceWearEfficiency(piece);
  if (efficiency >= 1) return piece;
  const copy: EquipmentInstance = { ...piece, implicitStats: scaledLines(piece.implicitStats, efficiency), rolledStats: scaledLines(piece.rolledStats, efficiency) };
  VIEW_EFFICIENCY.set(copy, efficiency);
  return copy;
}

// The efficiency a reader applies to a piece's NON-LINE effect: a view copy's efficiency, exactly 1 for a stored
// piece, so the crew module and sensor array readers act on wear in the run contexts only. Pure.
export function viewPieceEfficiency(piece: object): number {
  return VIEW_EFFICIENCY.get(piece) ?? 1;
}

// The state as a run reads its gear: its equipment list through wornPieceView. The SAME state reference when no
// view-slot piece is worn (every pristine save, so byte-identical), cached per equipment list. Pure.
export function wornGearView<T extends { equipment: EquipmentInstance[] }>(state: T): T {
  let view = VIEW_CACHE.get(state.equipment);
  if (view === undefined) {
    const worn = state.equipment.some((p) => p.condition !== undefined && WEAR_VIEW_SLOTS.has(p.slotType) && pieceCondition(p) < CONDITION_FULL);
    view = worn ? state.equipment.map(wornPieceView) : state.equipment;
    VIEW_CACHE.set(state.equipment, view);
  }
  return view === state.equipment ? state : { ...state, equipment: view };
}
