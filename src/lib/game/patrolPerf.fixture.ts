// PATROL CATCH-UP PERFORMANCE (0.14.0 release blocker): the fleets patrolPerfParity.test.ts and
// patrolCatchUp.perf.test.ts run. TEST-ONLY (imported by *.test.ts files only).
//
//   patrolFleet : a production-shaped save (v54, before the crew layer, migrated by this build) with 11 ships: five
//                 combat hulls (two Destroyers, two Carriers, a Battleship) each on a Repeat Crimson Reaver Sweep in
//                 mixed stances, six idle hulls, 400 spare pieces, the welcome crew seated. The fleet that made a 4-day
//                 catch-up take minutes. Options add: a Dispatch Once defeat (a bare General Freighter on the Warband),
//                 an extraction mission (a Prospector Hauler on a Short Ore Run), and the first patrol's combat gear
//                 worn to `wornShip1` per mille before it leaves (Repeat: "Repair first, then go", a repair pause).
//   steps / oneCall / chunks : a span in production tick() 1 s steps, in one economyTick call, in 997 s chunks.
//   withOvertimeMidPause : the mixed fleet's span with an Overtime step bought 300 s into ship-1's repair pause.
//   PATROL_PERF_CASES / wholeStateHash : the runs whose whole states patrolPerfParity.test.ts pins to the base build
//                 (c4c1d89c, before the optimizations), and the hash it pins them by.
//   withRepeatPatrol : any state plus a second captain on a Destroyer flying a Repeat Sweep (beside a short-range run or
//                 an expedition).

import Decimal from "break_infinity.js";
import { freshCaptains, freshState, seedStandardIssueForShip, type CaptainState, type EquipmentInstance, type GameState, type ShipInstance } from "./model";
import { migrate, type SaveFile } from "./save";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, tick } from "./tick";
import { withPieceCondition } from "./gearWear";
import { pausedPatrolOf } from "./gearWearEngine";
import { buyGearRepairOvertime } from "./processSpeed";
import { asPatrolVeteran } from "./awayTeamTestFixtures";

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const COMBAT = ["destroyer", "carrier", "battleship", "destroyer", "carrier"] as const;
const IDLE = ["generalFreighter", "generalFreighter", "prospectorHauler", "prospectorRunner", "prospectorMiner", "battleship"] as const;
const STANCES = ["balanced", "balanced", "aggressive", "standoff", "balanced"] as const;
export const COMBAT_SLOTS: readonly string[] = ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"];
const DAY = 86400;

const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`patrol perf fixture: ${what}`);
};

export interface PatrolFleetOptions {
  patrols?: number;
  spares?: number;
  // Captain 6 on ship-6 (a bare General Freighter): Dispatch Once on the Crimson Reaver Warband, lost and limping home.
  defeat?: boolean;
  // Captain 7 on ship-8 (a Prospector Hauler): a Short Ore Run.
  extraction?: boolean;
  // Ship-1's combat pieces worn to this condition (per mille) before its Repeat patrol leaves.
  wornShip1?: number;
}

export function patrolFleet(opts: PatrolFleetOptions = {}): GameState {
  const patrols = opts.patrols ?? 5;
  const spares = opts.spares ?? 400;
  const captains = COMBAT.length + (opts.defeat || opts.extraction ? 2 : 0);
  const base = freshState() as unknown as Record<string, unknown>;
  const types = [...COMBAT, ...IDLE];
  const assigned = (i: number): number | null => {
    if (i < COMBAT.length) return i + 1;
    if (i === 5 && opts.defeat) return 6;
    if (i === 7 && opts.extraction) return 7;
    return null;
  };
  const ships = types.map((t, i) => ({ id: `ship-${i + 1}`, typeKey: t, assignedCaptainId: assigned(i) }));
  let nextId = 1;
  const equipment: EquipmentInstance[] = [];
  for (const s of ships) {
    const r = seedStandardIssueForShip(s.id, nextId);
    equipment.push(...r.pieces);
    nextId = r.nextId;
  }
  const kit = equipment.filter((e) => e.fittedToShipId === "ship-1");
  for (let i = 0; i < spares; i++) equipment.push({ ...kit[i % kit.length], id: `equip-${nextId++}`, fittedToShipId: null });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { officers, nextOfficerId, crewPool, notableCrew, nextNotableId, lastTransportWindow, ...pre } = base;
  const save = {
    version: 54,
    created_at: 0,
    last_saved_at: 0,
    game_time_seconds: 30 * DAY,
    state: {
      ...pre,
      captains: freshCaptains(captains).map((c: CaptainState) => ({ ...c, level: 20 })),
      nextCaptainId: captains + 1,
      ships,
      nextShipId: ships.length + 1,
      equipment,
      nextEquipmentId: nextId,
      credits: "10000000",
      gameTimeSeconds: 30 * DAY,
    },
  } as unknown as SaveFile;
  let s = migrate(JSON.parse(JSON.stringify(save)) as SaveFile) as GameState;
  s = asPatrolVeteran(installMissingCombatBaselines(s));
  // One minute so the 0.14.0 save seats its welcome crew before anything launches.
  s = tick(60, s, lcg(0x14));
  if (opts.wornShip1 !== undefined) {
    const c = opts.wornShip1;
    s = {
      ...s,
      equipment: s.equipment.map((e) => (e.fittedToShipId === "ship-1" && COMBAT_SLOTS.includes(e.slotType) ? withPieceCondition(e, c, s.gameTimeSeconds) : e)),
    };
  }
  for (let i = 0; i < patrols; i++) {
    const r = dispatchCaptainOnPatrol(s, i + 1, "crimsonReaverSweep", STANCES[i], true);
    must(r.success, `patrol ${i + 1}: ${r.reason}`);
    s = r.next;
  }
  if (opts.defeat) {
    const r = dispatchCaptainOnPatrol(s, 6, "crimsonReaverWarband", "balanced", false);
    must(r.success, `defeat patrol: ${r.reason}`);
    s = r.next;
  }
  if (opts.extraction) {
    const r = dispatchCaptainOnMission({ ...s, transitBerthCapacity: 8 }, 7, "shortOreRun");
    must(r.success, `extraction: ${r.reason}`);
    s = r.next;
  }
  return s;
}

// `s` plus captain `captainId` (a copy of the first captain) on a new Destroyer `shipId` with its Standard Issue
// combat gear, flying a Repeat Crimson Reaver Sweep.
export function withRepeatPatrol(s: GameState, captainId = 2, shipId = "ship-patrol"): GameState {
  const c1 = s.captains[0];
  const captain: CaptainState = { ...c1, id: captainId, label: `Captain ${captainId}`, mission: null };
  const ship: ShipInstance = { ...s.ships[0], id: shipId, typeKey: "destroyer", assignedCaptainId: captainId };
  // Its Standard Issue economy set (reactor, drive, ...), then its combat set.
  const kit = seedStandardIssueForShip(shipId, s.nextEquipmentId);
  const out = asPatrolVeteran(
    installMissingCombatBaselines({
      ...s,
      captains: [...s.captains, captain],
      ships: [...s.ships, ship],
      equipment: [...s.equipment, ...kit.pieces],
      nextEquipmentId: kit.nextId,
      credits: new Decimal(10_000_000),
    }),
  );
  const r = dispatchCaptainOnPatrol(out, captainId, "crimsonReaverSweep", "balanced", true);
  must(r.success, `repeat patrol: ${r.reason}`);
  return r.next;
}

const HOUR = 3600;

export function steps(s0: GameState, seconds: number, seed = 0x15): GameState {
  return tick(seconds, s0, lcg(seed));
}
export function oneCall(s0: GameState, seconds: number, seed = 0x15): GameState {
  return economyTick(s0, seconds, lcg(seed));
}
export function chunks(s0: GameState, seconds: number, chunk = 997, seed = 0x15): GameState {
  const rng = lcg(seed);
  let s = s0;
  for (let left = seconds; left > 0; left -= chunk) s = economyTick(s, Math.min(chunk, left), rng);
  return s;
}

// The mixed fleet (ship-1 leaves worn, so its Repeat run starts with a repair pause): 300 s into the pause an Overtime
// step is bought, then the span runs on to `seconds` in all.
export function withOvertimeMidPause(mixed: GameState, seconds: number, advance: (s: GameState, n: number) => GameState): GameState {
  const mid = advance(mixed, 300);
  must(pausedPatrolOf(mid, "ship-1") !== null, "ship-1 is not paused 300 s in");
  const r = buyGearRepairOvertime(mid, "ship-1");
  must(r.bought, `Overtime: ${r.reason}`);
  return advance(r.next, seconds - 300);
}

export const mixedFleet = (): GameState => patrolFleet({ defeat: true, extraction: true, wornShip1: 100 });

// The runs pinned to the base build, each a pure function of a fresh fixture state.
export const PATROL_PERF_CASES: Record<string, () => GameState> = {
  "fleet 1 h steps": () => steps(patrolFleet(), HOUR),
  "fleet 6 h one call": () => oneCall(patrolFleet(), 6 * HOUR),
  "fleet 6 h chunks": () => chunks(patrolFleet(), 6 * HOUR),
  "mixed 1 h steps": () => withOvertimeMidPause(mixedFleet(), HOUR, (x, n) => steps(x, n)),
  "mixed 1 h one call": () => withOvertimeMidPause(mixedFleet(), HOUR, (x, n) => oneCall(x, n)),
  "mixed 6 h one call": () => withOvertimeMidPause(mixedFleet(), 6 * HOUR, (x, n) => oneCall(x, n)),
  "mixed 6 h chunks": () => chunks(mixedFleet(), 6 * HOUR),
};

// The whole state's JSON, hashed: 32-bit FNV-1a over its UTF-16 units read forward, then read backward (64 bits in all,
// 16 hex digits). Nothing in the state reads the wall clock.
export function wholeStateHash(s: GameState): string {
  const json = JSON.stringify(s);
  let f = 0x811c9dc5;
  let b = 0x811c9dc5;
  for (let i = 0, j = json.length - 1; i < json.length; i++, j--) {
    f = Math.imul(f ^ json.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ json.charCodeAt(j), 0x01000193);
  }
  return (f >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
