// HOTFIX 0.13.11.4 (catch-up speed): the fleets patrolPerfParity.test.ts and catchUpRunner.test.ts run.
// TEST-ONLY (imported by *.test.ts files only).
//
//   patrolFleet : a production-shaped save (v54) with 11 ships: five combat hulls (two Destroyers, two Carriers,
//                 a Battleship) each on a Repeat Crimson-Reaver Sweep in mixed stances, six idle hulls, 400 spare
//                 pieces. The fleet that made a 4-day catch-up freeze the page. Options add: a Dispatch Once
//                 defeat (a General Freighter on the Crimson-Reaver Warband: it loses, limps home, and lands in
//                 the repair queue), and an extraction mission (a Prospector Hauler on a Short Ore Run).
//   steps / oneCall / chunks : a span in production tick() 1 s steps, in one economyTick call, in 997 s chunks.

import { freshCaptains, freshState, seedStandardIssueForShip, type CaptainState, type EquipmentInstance, type GameState } from "./model";
import { migrate, type SaveFile } from "./save";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, tick } from "./tick";

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
const DAY = 86400;

const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`patrol perf fixture: ${what}`);
};

export interface PatrolFleetOptions {
  patrols?: number;
  spares?: number;
  // Captain 6 on ship-6 (a General Freighter): Dispatch Once on the Crimson-Reaver Warband, lost and limping home.
  defeat?: boolean;
  // Captain 7 on ship-8 (a Prospector Hauler): a Short Ore Run.
  extraction?: boolean;
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
  const save = {
    version: 54,
    created_at: 0,
    last_saved_at: 0,
    game_time_seconds: 30 * DAY,
    state: {
      ...base,
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
  s = installMissingCombatBaselines(s);
  s = tick(60, s, lcg(0x14));
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

export const mixedFleet = (): GameState => patrolFleet({ defeat: true, extraction: true });

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

const HOUR = 3600;

// The runs patrolPerfParity.test.ts pins to the base build (eaf1fb80, PROD 0.13.11.3, before the speedup), each a
// pure function of a fresh fixture state.
export const PATROL_PERF_CASES: Record<string, () => GameState> = {
  "fleet 1 h steps": () => steps(patrolFleet(), HOUR),
  "fleet 6 h one call": () => oneCall(patrolFleet(), 6 * HOUR),
  "fleet 6 h chunks": () => chunks(patrolFleet(), 6 * HOUR),
  "mixed 6 h steps": () => steps(mixedFleet(), 6 * HOUR),
  "mixed 6 h one call": () => oneCall(mixedFleet(), 6 * HOUR),
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
