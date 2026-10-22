// ============================================================================
// processSpeed.ts : 0.14.0 THE PROCESS SPEED SEAM (Overtime + the tutorial time skip) and THE GRANT HOOK.
//
// Design: docs/plans/2026-10-16-credit-sinks-pass.md "SPEED SEAM DESIGN". User decisions (verbatim records):
//   - docs/plans/2026-10-15-safe-first-runs-plan.md "USER ANSWERS, group 2: tutorial hooks": a time skip on EVERY
//     timed process (missions, patrols, expeditions, ship builds and repairs, research, crafting, refining, salvage,
//     facility upgrades), "Hook only" (nothing calls it in 0.14.0); a grant hook (items, credits, gear, a hull) with a
//     log line, unused until the tutorial / quests patch.
//   - the credit sinks doc's USER ANSWERS: OVERTIME pays credits to speed a RUNNING job by +25% of its normal rate
//     per step, a few steps max, each step costlier, priced by job size and tier, never doubling, never instant; it
//     shares this seam. Offered on Shipyard builds and repairs, research and facility upgrades (gear repair waits
//     for gear wear).
//
// ONE RECORD (model.ts ProcessSpeed, optional `speed` on TimedProcess, CaptainMissionState, PatrolMissionState and
// Expedition) and ONE ENGINE READ PER PROCESS FAMILY:
//   - TimedProcess (refine, craft, research, relic study, facility and track upgrades, ship builds and repairs,
//     salvage): resolveProcesses is UNTOUCHED. Overtime rescales remainingTicks at the purchase (the work left, in
//     normal ticks, is remainingTicks x the current rate; at the new rate it takes that / the new rate), so the
//     countdown engine needs no rate and offline == live holds by the countdown's own construction (one N-tick
//     resolve subtracts what N one-tick resolves subtract). The time skip sets remainingTicks to 0, so the job
//     completes on the next resolve through its normal completion branch (the same effect, XP lump and log entry).
//   - an extraction mission or a patrol: tickCaptainMission / tickCaptainPatrol read speed.instantComplete and run
//     the CURRENT cycle or route through to its end inside the next tick without spending that tick's own time (the
//     same rolls, cargo, waves and XP the time would have produced). A new cycle or route is built without it.
//   - a short-range cycle (G1-4, the same "run" ref): tickCaptainShortRange (shortRangeCycle.ts) reads the flag the
//     same way and runs the current cycle through to its delivery (the same pay and XP); the next cycle is a fresh
//     roll without it. A cycle that is waiting at home (its load unpaid, its Warehouse full) or for a transit berth
//     keeps the flag and runs through the moment it moves again, so the skip never invents an outcome.
//   - an expedition: advanced to its own completion at once (advanceExpedition is a pure function of elapsed time
//     and the run's seed, so the findings are the ones the run would have produced) and stamped.
// Without a speed record every process, mission, patrol and expedition is byte-identical to before this seam.
//
// PURE + DETERMINISTIC: no draws, no clock reads, no state mutation; each action returns a fresh state or the SAME
// reference on a refusal. No UI in this slice (an Overtime button needs a sketch first).
// ============================================================================

import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  ITEMS,
  SHIP_DOCKS_BASE,
  SHIP_TYPES,
  blueprintKind,
  emptyMuseumV2,
  generalMuseumRecord,
  museumV2WithGeneral,
  type GameState,
  type RegionTier,
  type ShipTypeKey,
  type TimedProcess,
  type TimedProcessKind,
} from "./model";
import { addToInventory, itemCap, mintBuiltShip } from "./tick";
import { advanceExpedition } from "./expedition";
import { itemTotal } from "./inventory";
import { exceptionalSetsOfTier, getRelicTypeById } from "./relics";
import { regionTierNumeral } from "./galaxy";

// What a speed action points at: an in-flight timed process (by its "proc-N" id), a captain's current extraction
// cycle or patrol route, or an expedition (by its "expedition-N" id).
export type ProcessRef =
  | { kind: "process"; id: string }
  | { kind: "run"; captainId: number }
  | { kind: "expedition"; id: string };

// ============================================================================
// Overtime
// ============================================================================

// (user) Each step adds 25% of the job's normal rate.
export const OVERTIME_STEP_RATE = 0.25;
// [PROPOSAL] Three steps: the fastest a job runs is 1.75x its normal rate (never double, never instant). The time
// left shrinks to 80%, then 67%, then 57% of what it was at the normal rate, so each step saves less than the last.
export const OVERTIME_MAX_STEPS = 3;
// [PROPOSAL] The price of step k: ceil(credits per minute x the job's minutes x its tier x k). The job's minutes are
// its own full length (durationTicks, which already carries any facility speed bonus), so the price is fixed for the
// job whenever it is bought.
export const OVERTIME_CREDITS_PER_MINUTE = 10;
// (user) The jobs Overtime is offered on: Shipyard builds and repairs, research, and facility upgrades (the Docks,
// the transit berths and the equipment storage are facility upgrade tracks).
export const OVERTIME_PROCESS_KINDS: readonly TimedProcessKind[] = [
  "shipBuild",
  "shipRepair",
  "researchProject",
  "facilityUpgrade",
  "equipmentStorageUpgrade",
  "docksExpansion",
  "transitBerthExpansion",
];
// [PROPOSAL] Overtime is not sold for the last tick of a job (it would buy nothing worth its price).
const OVERTIME_FINISHING_TICKS = 1;

// A job's rate after `steps` Overtime steps, as a multiple of its normal rate.
export function overtimeRate(steps: number): number {
  return 1 + OVERTIME_STEP_RATE * steps;
}

// The rate a timed process runs at now (1 without Overtime).
export function processRate(p: TimedProcess): number {
  return overtimeRate(p.speed?.overtimeSteps ?? 0);
}

// How much of the job's WORK is done, 0 to 1 (the honest progress bar under Overtime: remainingTicks x rate is the
// work left in normal ticks). Without Overtime this is the familiar (durationTicks - remainingTicks) / durationTicks.
export function processWorkFraction(p: TimedProcess): number {
  if (p.durationTicks <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - (p.remainingTicks * processRate(p)) / p.durationTicks));
}

// The tier a job is priced at: the hull being built or repaired, the blueprint being researched, the rung being
// built. Never below 1.
export function overtimeTier(state: GameState, p: TimedProcess): number {
  const e = p.effect;
  let tier = 1;
  if (e.type === "addShip") tier = SHIP_TYPES[e.typeKey]?.tier ?? 1;
  else if (e.type === "clearShipDamage") {
    const ship = state.ships.find((s) => s.id === e.shipId);
    tier = ship ? SHIP_TYPES[ship.typeKey]?.tier ?? 1 : 1;
  } else if (e.type === "unlockBlueprint") tier = BLUEPRINTS[e.key]?.tier ?? 1;
  else if (e.type === "facilityLevelUp") tier = (state.facilities[e.facility]?.level ?? 0) + 1;
  else if (e.type === "equipmentStorageLevelUp") tier = state.equipmentStorageLevel + 1;
  else if (e.type === "docksCapacityUp") tier = Math.max(0, state.shipStorageCapacity - SHIP_DOCKS_BASE) + 1;
  else if (e.type === "transitBerthLevelUp") tier = (state.transitBerthCapacity ?? 0) + 1;
  return Math.max(1, tier);
}

// The credits Overtime step `step` (1-based) costs on this job.
export function overtimeStepCost(state: GameState, p: TimedProcess, step: number): number {
  const minutes = (p.durationTicks * state.tickDurationSeconds) / 60;
  return Math.ceil(OVERTIME_CREDITS_PER_MINUTE * minutes * overtimeTier(state, p) * step);
}

export type OvertimeBlockReason = "notFound" | "notEligible" | "skipped" | "maxSteps" | "finishing" | "credits";

export type OvertimeQuote =
  | { ok: true; step: number; cost: number; ticksSaved: number }
  | { ok: false; reason: OvertimeBlockReason; cost?: number };

function processOf(state: GameState, ref: ProcessRef): TimedProcess | undefined {
  return ref.kind === "process" ? state.activeProcesses.find((p) => p.id === ref.id) : undefined;
}

// Can the next Overtime step be bought on this job, and at what price? Pure.
export function canBuyOvertime(state: GameState, ref: ProcessRef): OvertimeQuote {
  if (ref.kind !== "process") return { ok: false, reason: "notEligible" };
  const p = processOf(state, ref);
  if (!p) return { ok: false, reason: "notFound" };
  if (!OVERTIME_PROCESS_KINDS.includes(p.kind)) return { ok: false, reason: "notEligible" };
  if (p.speed?.instantComplete) return { ok: false, reason: "skipped" };
  const steps = p.speed?.overtimeSteps ?? 0;
  if (steps >= OVERTIME_MAX_STEPS) return { ok: false, reason: "maxSteps" };
  if (p.remainingTicks <= OVERTIME_FINISHING_TICKS) return { ok: false, reason: "finishing" };
  const step = steps + 1;
  const cost = overtimeStepCost(state, p, step);
  if (state.credits.lt(cost)) return { ok: false, reason: "credits", cost };
  const ticksSaved = p.remainingTicks - rescaledRemaining(p.remainingTicks, steps, step);
  return { ok: true, step, cost, ticksSaved };
}

function rescaledRemaining(remainingTicks: number, fromSteps: number, toSteps: number): number {
  return (remainingTicks * overtimeRate(fromSteps)) / overtimeRate(toSteps);
}

// Buy the next Overtime step: charge the quoted price, record the step, and rescale the time left so the work left
// runs at the new rate. A refusal returns the SAME state with the reason.
export function buyOvertime(
  state: GameState,
  ref: ProcessRef,
): { next: GameState; bought: boolean; reason?: OvertimeBlockReason; cost?: number } {
  const quote = canBuyOvertime(state, ref);
  if (!quote.ok) return { next: state, bought: false, reason: quote.reason, ...(quote.cost !== undefined ? { cost: quote.cost } : {}) };
  if (ref.kind !== "process") return { next: state, bought: false, reason: "notEligible" }; // unreachable: the quote refuses it
  const activeProcesses = state.activeProcesses.map((p) =>
    p.id === ref.id
      ? {
          ...p,
          remainingTicks: rescaledRemaining(p.remainingTicks, quote.step - 1, quote.step),
          speed: { ...p.speed, overtimeSteps: quote.step },
        }
      : p,
  );
  return { next: { ...state, credits: state.credits.minus(quote.cost), activeProcesses }, bought: true, cost: quote.cost };
}

// ============================================================================
// The time skip (tutorial only: instant, free, no UI; nothing calls it in 0.14.0)
// ============================================================================

// [PROPOSAL] How far ahead an expedition's own clock is run to find its end. A run that has not finished by then (a
// team that keeps failing and resetting its task) cannot be skipped: the skip never invents an outcome.
export const TIME_SKIP_HORIZON_SECONDS = 30 * 24 * 3600;

export type TimeSkipBlockReason = "notFound" | "alreadySkipped" | "complete" | "cannotFinish";

// Can this process be finished now? Pure (for an expedition it runs the run's own clock ahead, which is pure).
// ⚠️ EXPENSIVE FOR AN EXPEDITION: answering means running the whole run ahead (up to TIME_SKIP_HORIZON_SECONDS of its
// clock; a few hundred milliseconds for a run that never finishes). Call it on a player action, never per render.
export function canApplyTimeSkip(state: GameState, ref: ProcessRef): { ok: true } | { ok: false; reason: TimeSkipBlockReason } {
  const r = timeSkipResult(state, ref);
  return r.ok ? { ok: true } : r;
}

function timeSkipResult(state: GameState, ref: ProcessRef): { ok: true; next: GameState } | { ok: false; reason: TimeSkipBlockReason } {
  if (ref.kind === "process") {
    const p = processOf(state, ref);
    if (!p) return { ok: false, reason: "notFound" };
    if (p.speed?.instantComplete) return { ok: false, reason: "alreadySkipped" };
    const activeProcesses = state.activeProcesses.map((q) => (q.id === p.id ? { ...q, remainingTicks: 0, speed: { ...q.speed, instantComplete: true as const } } : q));
    return { ok: true, next: { ...state, activeProcesses } };
  }
  if (ref.kind === "run") {
    const captain = state.captains.find((c) => c.id === ref.captainId);
    const mission = captain?.mission ?? null;
    if (!captain || mission === null) return { ok: false, reason: "notFound" };
    if (mission.speed?.instantComplete) return { ok: false, reason: "alreadySkipped" };
    const flagged = { ...mission, speed: { ...mission.speed, instantComplete: true as const } };
    return { ok: true, next: { ...state, captains: state.captains.map((c) => (c.id === captain.id ? { ...c, mission: flagged } : c)) } };
  }
  const exp = state.expeditions.find((e) => e.id === ref.id);
  if (!exp) return { ok: false, reason: "notFound" };
  if (exp.phase === "complete") return { ok: false, reason: "complete" };
  const done = advanceExpedition(exp, state.gameTimeSeconds + TIME_SKIP_HORIZON_SECONDS);
  if (done.phase !== "complete") return { ok: false, reason: "cannotFinish" };
  // The run's clock now sits at its natural end E while the game clock stays at now: record E - now so the claim
  // reads the run's own stored times (its medical bay ends) as at E (injuries.ts applyGroundOpsInjuries).
  const offset = done.phaseAnchorSeconds - state.gameTimeSeconds;
  const stamped = { ...done, speed: { ...done.speed, instantComplete: true as const, ...(offset > 0 ? { clockOffsetSeconds: offset } : {}) } };
  return { ok: true, next: { ...state, expeditions: state.expeditions.map((e) => (e.id === exp.id ? stamped : e)) } };
}

// Finish a process for free: a timed process on the next tick, a mission cycle or patrol route through to its end on
// the next tick, an expedition at once. A refusal returns the SAME state with the reason.
export function applyTimeSkip(state: GameState, ref: ProcessRef): { next: GameState; applied: boolean; reason?: TimeSkipBlockReason } {
  const r = timeSkipResult(state, ref);
  return r.ok ? { next: r.next, applied: true } : { next: state, applied: false, reason: r.reason };
}

// ============================================================================
// The grant hook (unused until the tutorial / quests patch)
// ============================================================================

// What a grant gives. Every amount is a positive whole number. `gear` is counted in UNINSPECTED pieces of a gear
// blueprint (the same blank a Fabricator craft deposits; inspecting one rolls it), so a grant makes no draws.
// Relics v2 R2-2 (plan R2-2; safe first runs USER ANSWERS group 3: the tutorial "will reward ... at least one or two
// general relics, and the very first exceptional relic"): `relics` grants IDENTIFIED relics straight to the Museum v2
// record, with their first finds: a general relic of a given type and region tier (`count` copies), or the first Tier I
// exceptional piece the save does not hold yet. No draws either.
export type GrantRelic = { kind: "general"; typeId: string; tier: RegionTier; count: number } | { kind: "firstExceptional" };

export interface GrantBundle {
  credits?: number;
  items?: Readonly<Record<string, number>>;
  gear?: Readonly<Record<string, number>>;
  hullType?: ShipTypeKey;
  relics?: readonly GrantRelic[];
}

export type GrantBlockReason = "empty" | "badAmount" | "unknownItem" | "unknownGear" | "unknownHull" | "docksFull" | "storageFull" | "unknownRelic" | "relicHeld";

const GRANT_REGION_TIERS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6, 7]);

// The first Tier I exceptional piece `state` holds no copy of, in catalog order, or null when it holds them all. Pure.
function firstMissingExceptional(state: Pick<GameState, "museumV2">, taken: ReadonlySet<string> = new Set()): string | null {
  for (const set of exceptionalSetsOfTier(1)) {
    for (const piece of set.pieces) if (!((state.museumV2?.exceptional?.[piece.id] ?? 0) > 0) && !taken.has(piece.id)) return piece.id;
  }
  return null;
}

const GEAR_BLUEPRINT_KINDS = new Set(["equipment", "weapon", "drone"]);
const validAmount = (n: number): boolean => Number.isInteger(n) && n > 0;

// Can this bundle be granted in full? Pure. The grant is all or nothing.
export function canGrant(state: GameState, bundle: GrantBundle): { ok: true } | { ok: false; reason: GrantBlockReason } {
  const items = Object.entries(bundle.items ?? {});
  const gear = Object.entries(bundle.gear ?? {});
  const relics = bundle.relics ?? [];
  if (bundle.credits === undefined && items.length === 0 && gear.length === 0 && bundle.hullType === undefined && relics.length === 0) return { ok: false, reason: "empty" };
  if (bundle.credits !== undefined && !validAmount(bundle.credits)) return { ok: false, reason: "badAmount" };
  if ([...items, ...gear].some(([, n]) => !validAmount(n))) return { ok: false, reason: "badAmount" };
  if (relics.some((r) => r.kind === "general" && !validAmount(r.count))) return { ok: false, reason: "badAmount" };
  if (items.some(([id]) => !(id in ITEMS))) return { ok: false, reason: "unknownItem" };
  if (gear.some(([key]) => !(key in BLUEPRINTS) || !GEAR_BLUEPRINT_KINDS.has(blueprintKind(BLUEPRINTS[key])))) return { ok: false, reason: "unknownGear" };
  if (relics.some((r) => (r.kind === "general" ? !getRelicTypeById(r.typeId) || !GRANT_REGION_TIERS.has(r.tier) : r.kind !== "firstExceptional"))) return { ok: false, reason: "unknownRelic" };
  // Every first exceptional asked for must find a Tier I piece the save does not hold (two in one bundle take two).
  const taken = new Set<string>();
  for (const r of relics) {
    if (r.kind !== "firstExceptional") continue;
    const piece = firstMissingExceptional(state, taken);
    if (piece === null) return { ok: false, reason: "relicHeld" };
    taken.add(piece);
  }
  if (bundle.hullType !== undefined) {
    if (!(bundle.hullType in SHIP_TYPES)) return { ok: false, reason: "unknownHull" };
    if (state.ships.length >= state.shipStorageCapacity) return { ok: false, reason: "docksFull" };
  }
  // Items only, and every one already at its storage cap: nothing would arrive, so refuse rather than log an empty gift.
  const onlyItems = bundle.credits === undefined && gear.length === 0 && bundle.hullType === undefined && relics.length === 0;
  if (onlyItems && items.every(([id]) => itemTotal(state.inventory, id).gte(itemCap(state, id)))) return { ok: false, reason: "storageFull" };
  return { ok: true };
}

// Grant a bundle and return the System Log line naming what arrived ("<reason>. Received 500 credits, 4 Frame
// Segments, 1 uninspected Plasma Cannon and a General Freighter."). Items fill up to their storage cap (the line names
// what arrived; a bundle of items that are all at their cap is refused as storageFull); the hull is minted the way a Shipyard build mints one (mintBuiltShip, Standard Issue installed).
// A grant is not income: lifetime credits earned are unchanged [PROPOSAL]. A refusal returns the SAME state, the
// reason and an empty line.
export function grant(
  state: GameState,
  bundle: GrantBundle,
  reason: string,
): { next: GameState; granted: boolean; logLine: string; reason?: GrantBlockReason } {
  const gate = canGrant(state, bundle);
  if (!gate.ok) return { next: state, granted: false, logLine: "", reason: gate.reason };
  const parts: string[] = [];
  let next: GameState = state;

  if (bundle.credits !== undefined) {
    next = { ...next, credits: next.credits.plus(bundle.credits) };
    parts.push(counted(bundle.credits, "credit"));
  }

  let inventory = next.inventory;
  let discovered = next.discovered;
  for (const [id, n] of Object.entries(bundle.items ?? {})) {
    const before = itemTotal(inventory, id);
    ({ inventory, discovered } = addToInventory(inventory, discovered, id, new Decimal(n), itemCap(state, id)));
    const arrived = itemTotal(inventory, id).minus(before).toNumber();
    if (arrived > 0) parts.push(counted(arrived, ITEMS[id].label));
  }
  if (inventory !== next.inventory || discovered !== next.discovered) next = { ...next, inventory, discovered };

  const gear = Object.entries(bundle.gear ?? {});
  if (gear.length > 0) {
    const blanks = { ...next.blanks };
    for (const [key, n] of gear) {
      blanks[key] = (blanks[key] ?? new Decimal(0)).plus(n);
      parts.push(counted(n, `uninspected ${BLUEPRINTS[key].label.replace(/ Blueprint$/, "")}`));
    }
    next = { ...next, blanks };
  }

  if (bundle.hullType !== undefined) {
    const minted = mintBuiltShip(next, bundle.hullType);
    next = { ...next, ships: minted.ships, nextShipId: minted.nextShipId, equipment: minted.equipment, nextEquipmentId: minted.nextEquipmentId };
    const label = SHIP_TYPES[bundle.hullType].label;
    parts.push(`${/^[AEIOU]/i.test(label) ? "an" : "a"} ${label}`);
  }

  // Relics v2 R2-2: identified relics land in the Museum v2 record (a general relic at its region tier, an exceptional
  // piece as one copy) and append their first find. The exceptional piece's name awaits the user's sign-off sheet, so
  // the line says "an exceptional relic".
  const relics = bundle.relics ?? [];
  if (relics.length > 0) {
    let museum = next.museumV2 ?? emptyMuseumV2();
    let relicDiscovered = next.relicDiscovered ?? [];
    const find = (id: string) => {
      if (!relicDiscovered.includes(id)) relicDiscovered = [...relicDiscovered, id];
    };
    for (const r of relics) {
      if (r.kind === "general") {
        const record = generalMuseumRecord({ museumV2: museum }, r.tier);
        museum = museumV2WithGeneral(museum, { ...record, [r.typeId]: (record[r.typeId] ?? 0) + r.count }, r.tier);
        find(r.typeId);
        // "1 Tier I Glyph Tablet relic", "2 Tier II Heart of the Archive relics" (the plural on "relic", never the name).
        parts.push(counted(r.count, `Tier ${regionTierNumeral(r.tier)} ${getRelicTypeById(r.typeId)!.label} relic`));
      } else {
        const piece = firstMissingExceptional({ museumV2: museum })!;
        museum = { ...museum, exceptional: { ...museum.exceptional, [piece]: 1 } };
        find(piece);
        parts.push("an exceptional relic");
      }
    }
    next = { ...next, museumV2: museum, relicDiscovered };
  }

  const head = reason.trim().replace(/[.!?]+$/, "");
  const body = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const logLine = head.length > 0 ? `${head}. Received ${body}.` : `Received ${body}.`;
  return { next, granted: true, logLine };
}

// "1 credit", "500 credits", "4 Frame Segments", "2 uninspected Plasma Cannons" (simple English plurals on the last word).
function counted(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? noun : plural(noun)}`;
}

function plural(noun: string): string {
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}
