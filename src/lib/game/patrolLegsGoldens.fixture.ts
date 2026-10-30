// WR-7 follow-up OC-D8 PATROL LEGS GOLDENS (plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, the WR-7
// "Not built" note; USER ANSWERS 2026-10-15 "OC-D8 speed / cargo beyond missions: Speed counts everywhere": "patrol
// legs scale with transitSpeedMult"). Every patrol on every combat hull, through the live engine (1 s economyTick
// steps), captured on feat 0fcee45 BEFORE the legs scaled (LEGS_PINS_PRE). Two loadouts per hull: `bare` (the hull's
// Standard Issue set as onHull gives it) and `fast` (a drive with a +30 transit speed line).
//
//   once     : Dispatch Once to its end: the mission as dispatched, the phase timeline (the route tick each phase began
//              at), the ending ("won" / "lost" and the seconds it took) and the whole state at the end.
//   inFlight : the same run with the cycle's frozen legs removed right after dispatch (a cycle dispatched before the
//              legs scaled). Its route is the def's, so it must keep the pre-change pins.
//   repeat   : a Repeat run for REPEAT_SECONDS (relaunches included): the whole state at the end.
//   replay   : the display replay of the first cycle, read right after dispatch.
//
// The determinism checks (one call == chunked == 1 s steps) live beside the pins in patrolLegsGoldens.test.ts.

import Decimal from "break_infinity.js";
import { PATROLS, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { COMBAT_DEFAULT_LOADOUT } from "./combat/bridge";
import { replayPatrol } from "./combat/patrolReplay";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { hash, onHull, stateHash } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { installPiece } from "./wiring/probes";

const RNG = (): number => 0.5;
const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`patrol legs goldens: ${what}`);
};

export const LEGS_HULLS = Object.keys(COMBAT_DEFAULT_LOADOUT) as ShipTypeKey[];
export const LEGS_ROUTES = Object.keys(PATROLS) as PatrolKey[];
export type LegsLoadout = "bare" | "fast";
export const LEGS_LOADOUTS: readonly LegsLoadout[] = ["bare", "fast"];
export const REPEAT_SECONDS = 200;

export function legsBase(hull: ShipTypeKey, loadout: LegsLoadout): GameState {
  const s = asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) });
  return loadout === "bare" ? s : installPiece(s, { slotType: "ftlDrive", implicitStats: { transitSpeedMult: 30 } });
}

// A cycle as dispatched before the legs scaled: captain 1's patrol without its frozen legs (a no-op on a record that
// carries none). The wave schedule is the def's own (a cycle without legs flies the def's route).
export function asPreLegs(s: GameState, waveTicks?: number[]): GameState {
  return {
    ...s,
    captains: s.captains.map((c, i) => {
      if (i !== 0 || c.mission === null || c.mission.kind !== "patrol") return c;
      const { legTicks: _drop, ...rest } = c.mission as PatrolMissionState & { legTicks?: unknown };
      return { ...c, mission: { ...(rest as PatrolMissionState), ...(waveTicks ? { waveTicks } : {}) } };
    }),
  };
}

export function legsDispatch(hull: ShipTypeKey, route: PatrolKey, loadout: LegsLoadout, repeat: boolean): GameState {
  const r = dispatchCaptainOnPatrol(legsBase(hull, loadout), 1, route, "balanced", repeat);
  must(r.success, `${hull} ${route} ${loadout}: ${r.reason}`);
  return r.next;
}

// Dispatch Once to its end in 1 s steps: [mission, phase timeline, ending, end state].
export function legsOnceRow(start: GameState): string[] {
  const row = [hash(structuredClone(start.captains[0].mission))];
  let s = start;
  let ticks = 0;
  let phase = (s.captains[0].mission as PatrolMissionState).phase;
  const timeline = [`${phase}@0`];
  while (s.captains[0].mission !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m !== null && m.phase !== phase) {
      phase = m.phase;
      timeline.push(`${phase}@${ticks}`);
    }
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  row.push(timeline.join(","), `${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, stateHash(s));
  return row;
}

export function legsRepeatState(start: GameState, seconds = REPEAT_SECONDS): GameState {
  let s = start;
  for (let i = 0; i < seconds; i++) s = economyTick(s, 1, RNG);
  return s;
}

export function legsRows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const hull of LEGS_HULLS) {
    for (const route of LEGS_ROUTES) {
      for (const loadout of LEGS_LOADOUTS) {
        const key = `${hull}:${route}:${loadout}`;
        const once = legsDispatch(hull, route, loadout, false);
        got[`once:${key}`] = legsOnceRow(once);
        got[`inFlight:${key}`] = legsOnceRow(asPreLegs(once, inFlightWaves(once)));
        got[`repeat:${key}`] = stateHash(legsRepeatState(legsDispatch(hull, route, loadout, true)));
        got[`replay:${key}`] = hash(replayPatrol(once, once.captains[0]));
      }
    }
  }
  return got;
}

// The wave schedule a cycle dispatched before the legs scaled stored (the def's own route): the dispatched schedule
// shifted back by the outbound legs it froze (every wave sits at the same offset into the window).
export function inFlightWaves(s: GameState): number[] {
  const m = s.captains[0].mission as PatrolMissionState & { legTicks?: { out: number } };
  const shift = m.legTicks === undefined ? 0 : m.legTicks.out - PATROLS[m.patrolKey].transitOutTicks;
  return m.waveTicks.map((t) => t - shift);
}

// Captured on feat 0fcee45, before the legs scaled.
export const LEGS_PINS_PRE: Record<string, unknown> = {
  "once:generalFreighter:crimsonReaverSweep:bare": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","ccde4fa"],
  "inFlight:generalFreighter:crimsonReaverSweep:bare": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","ccde4fa"],
  "repeat:generalFreighter:crimsonReaverSweep:bare": "52100a56",
  "replay:generalFreighter:crimsonReaverSweep:bare": "597c09a2",
  "once:generalFreighter:crimsonReaverSweep:fast": ["3851a78c","transitOut@0,engaging@3,transitBack@11","won:14","c7e456ca"],
  "inFlight:generalFreighter:crimsonReaverSweep:fast": ["3851a78c","transitOut@0,engaging@3,transitBack@11","won:14","c7e456ca"],
  "repeat:generalFreighter:crimsonReaverSweep:fast": "652abe11",
  "replay:generalFreighter:crimsonReaverSweep:fast": "58f1c028",
  "once:generalFreighter:crimsonReaverWarband:bare": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","319720d8"],
  "inFlight:generalFreighter:crimsonReaverWarband:bare": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","319720d8"],
  "repeat:generalFreighter:crimsonReaverWarband:bare": "5e8c898",
  "replay:generalFreighter:crimsonReaverWarband:bare": "3bc66d4f",
  "once:generalFreighter:crimsonReaverWarband:fast": ["448e50a","transitOut@0,engaging@5,limpingHome@13","lost:23","3ef351f8"],
  "inFlight:generalFreighter:crimsonReaverWarband:fast": ["448e50a","transitOut@0,engaging@5,limpingHome@13","lost:23","3ef351f8"],
  "repeat:generalFreighter:crimsonReaverWarband:fast": "99a772c0",
  "replay:generalFreighter:crimsonReaverWarband:fast": "14edb748",
  "once:prospectorHauler:crimsonReaverSweep:bare": ["46a5f0e5","transitOut@0,engaging@3,transitBack@11","won:14","de886ced"],
  "inFlight:prospectorHauler:crimsonReaverSweep:bare": ["46a5f0e5","transitOut@0,engaging@3,transitBack@11","won:14","de886ced"],
  "repeat:prospectorHauler:crimsonReaverSweep:bare": "b570d04b",
  "replay:prospectorHauler:crimsonReaverSweep:bare": "41ce7378",
  "once:prospectorHauler:crimsonReaverSweep:fast": ["351c7e43","transitOut@0,engaging@3,transitBack@11","won:14","16a21e87"],
  "inFlight:prospectorHauler:crimsonReaverSweep:fast": ["351c7e43","transitOut@0,engaging@3,transitBack@11","won:14","16a21e87"],
  "repeat:prospectorHauler:crimsonReaverSweep:fast": "cc042d57",
  "replay:prospectorHauler:crimsonReaverSweep:fast": "b4f2ecde",
  "once:prospectorHauler:crimsonReaverWarband:bare": ["a6c00abf","transitOut@0,engaging@5,limpingHome@13","lost:23","7ad94873"],
  "inFlight:prospectorHauler:crimsonReaverWarband:bare": ["a6c00abf","transitOut@0,engaging@5,limpingHome@13","lost:23","7ad94873"],
  "repeat:prospectorHauler:crimsonReaverWarband:bare": "b9c0b000",
  "replay:prospectorHauler:crimsonReaverWarband:bare": "45b124f1",
  "once:prospectorHauler:crimsonReaverWarband:fast": ["4cb3650d","transitOut@0,engaging@5,transitBack@17","won:22","3ec2da62"],
  "inFlight:prospectorHauler:crimsonReaverWarband:fast": ["4cb3650d","transitOut@0,engaging@5,transitBack@17","won:22","3ec2da62"],
  "repeat:prospectorHauler:crimsonReaverWarband:fast": "40d8bd44",
  "replay:prospectorHauler:crimsonReaverWarband:fast": "1e3ee29c",
  "once:prospectorRunner:crimsonReaverSweep:bare": ["f8e496d5","transitOut@0,engaging@3,limpingHome@4","lost:10","9e48066c"],
  "inFlight:prospectorRunner:crimsonReaverSweep:bare": ["f8e496d5","transitOut@0,engaging@3,limpingHome@4","lost:10","9e48066c"],
  "repeat:prospectorRunner:crimsonReaverSweep:bare": "16430600",
  "replay:prospectorRunner:crimsonReaverSweep:bare": "b0c9ae30",
  "once:prospectorRunner:crimsonReaverSweep:fast": ["f7859ce7","transitOut@0,engaging@3,limpingHome@4","lost:10","be352b33"],
  "inFlight:prospectorRunner:crimsonReaverSweep:fast": ["f7859ce7","transitOut@0,engaging@3,limpingHome@4","lost:10","be352b33"],
  "repeat:prospectorRunner:crimsonReaverSweep:fast": "5dd235f5",
  "replay:prospectorRunner:crimsonReaverSweep:fast": "b0bbddf5",
  "once:prospectorRunner:crimsonReaverWarband:bare": ["ac62e5b3","transitOut@0,engaging@5,limpingHome@10","lost:20","1c19b46f"],
  "inFlight:prospectorRunner:crimsonReaverWarband:bare": ["ac62e5b3","transitOut@0,engaging@5,limpingHome@10","lost:20","1c19b46f"],
  "repeat:prospectorRunner:crimsonReaverWarband:bare": "c9fd448d",
  "replay:prospectorRunner:crimsonReaverWarband:bare": "88141285",
  "once:prospectorRunner:crimsonReaverWarband:fast": ["8ecece0d","transitOut@0,engaging@5,limpingHome@6","lost:16","765a3bb0"],
  "inFlight:prospectorRunner:crimsonReaverWarband:fast": ["8ecece0d","transitOut@0,engaging@5,limpingHome@6","lost:16","765a3bb0"],
  "repeat:prospectorRunner:crimsonReaverWarband:fast": "45cfcc70",
  "replay:prospectorRunner:crimsonReaverWarband:fast": "c6d6e8fa",
  "once:prospectorMiner:crimsonReaverSweep:bare": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","83fc843b"],
  "inFlight:prospectorMiner:crimsonReaverSweep:bare": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","83fc843b"],
  "repeat:prospectorMiner:crimsonReaverSweep:bare": "56df9463",
  "replay:prospectorMiner:crimsonReaverSweep:bare": "1b2af2bc",
  "once:prospectorMiner:crimsonReaverSweep:fast": ["b31a428e","transitOut@0,engaging@3,limpingHome@4","lost:10","74df017f"],
  "inFlight:prospectorMiner:crimsonReaverSweep:fast": ["b31a428e","transitOut@0,engaging@3,limpingHome@4","lost:10","74df017f"],
  "repeat:prospectorMiner:crimsonReaverSweep:fast": "cb69fc5a",
  "replay:prospectorMiner:crimsonReaverSweep:fast": "e78a98fc",
  "once:prospectorMiner:crimsonReaverWarband:bare": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","8bc20fd9"],
  "inFlight:prospectorMiner:crimsonReaverWarband:bare": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","8bc20fd9"],
  "repeat:prospectorMiner:crimsonReaverWarband:bare": "d5bac33f",
  "replay:prospectorMiner:crimsonReaverWarband:bare": "8774e398",
  "once:prospectorMiner:crimsonReaverWarband:fast": ["7415abf0","transitOut@0,engaging@5,limpingHome@10","lost:20","400628b7"],
  "inFlight:prospectorMiner:crimsonReaverWarband:fast": ["7415abf0","transitOut@0,engaging@5,limpingHome@10","lost:20","400628b7"],
  "repeat:prospectorMiner:crimsonReaverWarband:fast": "308eab23",
  "replay:prospectorMiner:crimsonReaverWarband:fast": "616945b9",
  "once:destroyer:crimsonReaverSweep:bare": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","c6c2c36"],
  "inFlight:destroyer:crimsonReaverSweep:bare": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","c6c2c36"],
  "repeat:destroyer:crimsonReaverSweep:bare": "cfe94d97",
  "replay:destroyer:crimsonReaverSweep:bare": "ba2ee129",
  "once:destroyer:crimsonReaverSweep:fast": ["edbec0e8","transitOut@0,engaging@3,transitBack@11","won:14","84b274c0"],
  "inFlight:destroyer:crimsonReaverSweep:fast": ["edbec0e8","transitOut@0,engaging@3,transitBack@11","won:14","84b274c0"],
  "repeat:destroyer:crimsonReaverSweep:fast": "a0eba8a6",
  "replay:destroyer:crimsonReaverSweep:fast": "14166c44",
  "once:destroyer:crimsonReaverWarband:bare": ["73630c4c","transitOut@0,engaging@5,transitBack@17","won:22","47c7e85b"],
  "inFlight:destroyer:crimsonReaverWarband:bare": ["73630c4c","transitOut@0,engaging@5,transitBack@17","won:22","47c7e85b"],
  "repeat:destroyer:crimsonReaverWarband:bare": "8fed1971",
  "replay:destroyer:crimsonReaverWarband:bare": "5469ccef",
  "once:destroyer:crimsonReaverWarband:fast": ["95f738ca","transitOut@0,engaging@5,transitBack@17","won:22","2d5a7f74"],
  "inFlight:destroyer:crimsonReaverWarband:fast": ["95f738ca","transitOut@0,engaging@5,transitBack@17","won:22","2d5a7f74"],
  "repeat:destroyer:crimsonReaverWarband:fast": "6138858b",
  "replay:destroyer:crimsonReaverWarband:fast": "ada5f4de",
  "once:battleship:crimsonReaverSweep:bare": ["2dfb18ca","transitOut@0,engaging@3,transitBack@11","won:14","8a77afc0"],
  "inFlight:battleship:crimsonReaverSweep:bare": ["2dfb18ca","transitOut@0,engaging@3,transitBack@11","won:14","8a77afc0"],
  "repeat:battleship:crimsonReaverSweep:bare": "a4fe6014",
  "replay:battleship:crimsonReaverSweep:bare": "2436a90a",
  "once:battleship:crimsonReaverSweep:fast": ["61bfcaf8","transitOut@0,engaging@3,transitBack@11","won:14","78d96dda"],
  "inFlight:battleship:crimsonReaverSweep:fast": ["61bfcaf8","transitOut@0,engaging@3,transitBack@11","won:14","78d96dda"],
  "repeat:battleship:crimsonReaverSweep:fast": "2a8b4727",
  "replay:battleship:crimsonReaverSweep:fast": "a30e84c8",
  "once:battleship:crimsonReaverWarband:bare": ["6163082c","transitOut@0,engaging@5,transitBack@17","won:22","b2613955"],
  "inFlight:battleship:crimsonReaverWarband:bare": ["6163082c","transitOut@0,engaging@5,transitBack@17","won:22","b2613955"],
  "repeat:battleship:crimsonReaverWarband:bare": "9c68635e",
  "replay:battleship:crimsonReaverWarband:bare": "a4925972",
  "once:battleship:crimsonReaverWarband:fast": ["ea5af582","transitOut@0,engaging@5,transitBack@17","won:22","2a5bd219"],
  "inFlight:battleship:crimsonReaverWarband:fast": ["ea5af582","transitOut@0,engaging@5,transitBack@17","won:22","2a5bd219"],
  "repeat:battleship:crimsonReaverWarband:fast": "f9d60364",
  "replay:battleship:crimsonReaverWarband:fast": "d10de010",
  "once:carrier:crimsonReaverSweep:bare": ["fd75b80b","transitOut@0,engaging@3,transitBack@11","won:14","80b45ed5"],
  "inFlight:carrier:crimsonReaverSweep:bare": ["fd75b80b","transitOut@0,engaging@3,transitBack@11","won:14","80b45ed5"],
  "repeat:carrier:crimsonReaverSweep:bare": "2d99655e",
  "replay:carrier:crimsonReaverSweep:bare": "8f2f9130",
  "once:carrier:crimsonReaverSweep:fast": ["88dcbb7d","transitOut@0,engaging@3,transitBack@11","won:14","a371e8b4"],
  "inFlight:carrier:crimsonReaverSweep:fast": ["88dcbb7d","transitOut@0,engaging@3,transitBack@11","won:14","a371e8b4"],
  "repeat:carrier:crimsonReaverSweep:fast": "714094e8",
  "replay:carrier:crimsonReaverSweep:fast": "3342cff4",
  "once:carrier:crimsonReaverWarband:bare": ["44ef2269","transitOut@0,engaging@5,transitBack@17","won:22","cb9e5438"],
  "inFlight:carrier:crimsonReaverWarband:bare": ["44ef2269","transitOut@0,engaging@5,transitBack@17","won:22","cb9e5438"],
  "repeat:carrier:crimsonReaverWarband:bare": "b68e8925",
  "replay:carrier:crimsonReaverWarband:bare": "c28deffe",
  "once:carrier:crimsonReaverWarband:fast": ["f2af55b3","transitOut@0,engaging@5,transitBack@17","won:22","342d6702"],
  "inFlight:carrier:crimsonReaverWarband:fast": ["f2af55b3","transitOut@0,engaging@5,transitBack@17","won:22","342d6702"],
  "repeat:carrier:crimsonReaverWarband:fast": "f60bba6d",
  "replay:carrier:crimsonReaverWarband:fast": "4a6425ac",
  "once:orion:crimsonReaverSweep:bare": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","16bef1a9"],
  "inFlight:orion:crimsonReaverSweep:bare": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","16bef1a9"],
  "repeat:orion:crimsonReaverSweep:bare": "9555a6a5",
  "replay:orion:crimsonReaverSweep:bare": "f6d6af33",
  "once:orion:crimsonReaverSweep:fast": ["22b855d","transitOut@0,engaging@3,transitBack@11","won:14","8f41e0b5"],
  "inFlight:orion:crimsonReaverSweep:fast": ["22b855d","transitOut@0,engaging@3,transitBack@11","won:14","8f41e0b5"],
  "repeat:orion:crimsonReaverSweep:fast": "a1b88934",
  "replay:orion:crimsonReaverSweep:fast": "50273ea7",
  "once:orion:crimsonReaverWarband:bare": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","c41d314a"],
  "inFlight:orion:crimsonReaverWarband:bare": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","c41d314a"],
  "repeat:orion:crimsonReaverWarband:bare": "177af14e",
  "replay:orion:crimsonReaverWarband:bare": "acbf2a27",
  "once:orion:crimsonReaverWarband:fast": ["40d2cd3b","transitOut@0,engaging@5,limpingHome@10","lost:20","28c8c8f6"],
  "inFlight:orion:crimsonReaverWarband:fast": ["40d2cd3b","transitOut@0,engaging@5,limpingHome@10","lost:20","28c8c8f6"],
  "repeat:orion:crimsonReaverWarband:fast": "143fd882",
  "replay:orion:crimsonReaverWarband:fast": "41c98011",
  "once:aurora:crimsonReaverSweep:bare": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","71c6fd52"],
  "inFlight:aurora:crimsonReaverSweep:bare": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","71c6fd52"],
  "repeat:aurora:crimsonReaverSweep:bare": "8efb3d34",
  "replay:aurora:crimsonReaverSweep:bare": "6eeaff13",
  "once:aurora:crimsonReaverSweep:fast": ["d8b6fade","transitOut@0,engaging@3,transitBack@11","won:14","849f1a97"],
  "inFlight:aurora:crimsonReaverSweep:fast": ["d8b6fade","transitOut@0,engaging@3,transitBack@11","won:14","849f1a97"],
  "repeat:aurora:crimsonReaverSweep:fast": "2beffb61",
  "replay:aurora:crimsonReaverSweep:fast": "902e1446",
  "once:aurora:crimsonReaverWarband:bare": ["791cbd5a","transitOut@0,engaging@5,limpingHome@10","lost:20","bd9106a0"],
  "inFlight:aurora:crimsonReaverWarband:bare": ["791cbd5a","transitOut@0,engaging@5,limpingHome@10","lost:20","bd9106a0"],
  "repeat:aurora:crimsonReaverWarband:bare": "7880cf8c",
  "replay:aurora:crimsonReaverWarband:bare": "a5c4a4bd",
  "once:aurora:crimsonReaverWarband:fast": ["27159514","transitOut@0,engaging@5,limpingHome@10","lost:20","1ec7a7b8"],
  "inFlight:aurora:crimsonReaverWarband:fast": ["27159514","transitOut@0,engaging@5,limpingHome@10","lost:20","1ec7a7b8"],
  "repeat:aurora:crimsonReaverWarband:fast": "3b3145f1",
  "replay:aurora:crimsonReaverWarband:fast": "dbf45e46",
  "once:eir:crimsonReaverSweep:bare": ["29832d98","transitOut@0,engaging@3,transitBack@11","won:14","72e556b7"],
  "inFlight:eir:crimsonReaverSweep:bare": ["29832d98","transitOut@0,engaging@3,transitBack@11","won:14","72e556b7"],
  "repeat:eir:crimsonReaverSweep:bare": "4f19e44d",
  "replay:eir:crimsonReaverSweep:bare": "28bafcf2",
  "once:eir:crimsonReaverSweep:fast": ["4152a0aa","transitOut@0,engaging@3,transitBack@11","won:14","c3568aca"],
  "inFlight:eir:crimsonReaverSweep:fast": ["4152a0aa","transitOut@0,engaging@3,transitBack@11","won:14","c3568aca"],
  "repeat:eir:crimsonReaverSweep:fast": "f554661f",
  "replay:eir:crimsonReaverSweep:fast": "a102fabc",
  "once:eir:crimsonReaverWarband:bare": ["e71e100e","transitOut@0,engaging@5,limpingHome@10","lost:20","3270e736"],
  "inFlight:eir:crimsonReaverWarband:bare": ["e71e100e","transitOut@0,engaging@5,limpingHome@10","lost:20","3270e736"],
  "repeat:eir:crimsonReaverWarband:bare": "b14a15d8",
  "replay:eir:crimsonReaverWarband:bare": "5f90e37a",
  "once:eir:crimsonReaverWarband:fast": ["76bd56b0","transitOut@0,engaging@5,limpingHome@10","lost:20","e8a0c4c"],
  "inFlight:eir:crimsonReaverWarband:fast": ["76bd56b0","transitOut@0,engaging@5,limpingHome@10","lost:20","e8a0c4c"],
  "repeat:eir:crimsonReaverWarband:fast": "745d50e0",
  "replay:eir:crimsonReaverWarband:fast": "d401814c",
};

// MOVED by the legs (re-pinned on the wiring commit), every one returning to LEGS_PINS_PRE with PATROL_LEGS_SWITCH off
// and traced in patrolLegsGoldens.test.ts ("each moved pin is the legs"):
//   once   : 27 runs whose ship's speed rounds to other legs than the route's (the Battleship's Sweep legs 3 -> 5, its
//            Warband legs 5 -> 8; a +30 drive on a Destroyer, 3 -> 2). The phases shift by the outbound leg's change,
//            the ending by both legs' (a lost run's limp home is twice its frozen return leg); the waves are the same
//            fights at the same offsets into the window.
//   replay : the same 27 cycles: the display replay's wave route ticks shift with the outbound leg.
//   repeat : 24 Repeat runs of those: the same 200 s fly more or fewer cycles (and relaunches freeze their own legs).
//   Held   : every inFlight row (a cycle in flight from before keeps the route's legs) and every run whose legs round
//            back to the route's (no legTicks written: a speed-1 cycle stores exactly what it did).
export const LEGS_PINS_MOVED: Record<string, unknown> = {
  "once:generalFreighter:crimsonReaverSweep:fast": ["59fa1afd","transitOut@0,engaging@2,transitBack@10","won:12","1103b08"],
  "repeat:generalFreighter:crimsonReaverSweep:fast": "d384d340",
  "replay:generalFreighter:crimsonReaverSweep:fast": "6324c1d2",
  "once:generalFreighter:crimsonReaverWarband:fast": ["f0da4d73","transitOut@0,engaging@4,limpingHome@12","lost:20","b939f615"],
  "repeat:generalFreighter:crimsonReaverWarband:fast": "c68005e9",
  "replay:generalFreighter:crimsonReaverWarband:fast": "7ced908c",
  "once:prospectorHauler:crimsonReaverSweep:bare": ["a52be404","transitOut@0,engaging@4,transitBack@12","won:16","e7bf9fef"],
  "repeat:prospectorHauler:crimsonReaverSweep:bare": "2b907082",
  "replay:prospectorHauler:crimsonReaverSweep:bare": "60ff4d64",
  "once:prospectorHauler:crimsonReaverWarband:bare": ["76ec3286","transitOut@0,engaging@7,limpingHome@15","lost:29","4c6acfbf"],
  "repeat:prospectorHauler:crimsonReaverWarband:bare": "7f5f28b8",
  "replay:prospectorHauler:crimsonReaverWarband:bare": "77e1fcff",
  "once:prospectorHauler:crimsonReaverWarband:fast": ["48993ec8","transitOut@0,engaging@4,transitBack@16","won:20","c218a69e"],
  "repeat:prospectorHauler:crimsonReaverWarband:fast": "17ba047",
  "replay:prospectorHauler:crimsonReaverWarband:fast": "8b59c45a",
  "once:prospectorRunner:crimsonReaverSweep:bare": ["901a9754","transitOut@0,engaging@2,limpingHome@3","lost:7","923c6699"],
  "replay:prospectorRunner:crimsonReaverSweep:bare": "c35698d3",
  "once:prospectorRunner:crimsonReaverSweep:fast": ["5ef37a56","transitOut@0,engaging@2,limpingHome@3","lost:7","ecc50ba"],
  "replay:prospectorRunner:crimsonReaverSweep:fast": "f91e7214",
  "once:prospectorRunner:crimsonReaverWarband:bare": ["9bbff306","transitOut@0,engaging@4,limpingHome@9","lost:17","ca2893de"],
  "repeat:prospectorRunner:crimsonReaverWarband:bare": "2bb31409",
  "replay:prospectorRunner:crimsonReaverWarband:bare": "ff4b0126",
  "once:prospectorRunner:crimsonReaverWarband:fast": ["e5fa4c55","transitOut@0,engaging@3,limpingHome@4","lost:10","1f020394"],
  "replay:prospectorRunner:crimsonReaverWarband:fast": "23c99924",
  "once:prospectorMiner:crimsonReaverSweep:fast": ["2b2ad867","transitOut@0,engaging@2,limpingHome@3","lost:7","44efbb08"],
  "repeat:prospectorMiner:crimsonReaverSweep:fast": "d253e821",
  "replay:prospectorMiner:crimsonReaverSweep:fast": "677aeb33",
  "once:prospectorMiner:crimsonReaverWarband:fast": ["ffe9a151","transitOut@0,engaging@4,limpingHome@9","lost:17","1f0ffde0"],
  "repeat:prospectorMiner:crimsonReaverWarband:fast": "e75345c4",
  "replay:prospectorMiner:crimsonReaverWarband:fast": "f62f3a52",
  "once:destroyer:crimsonReaverSweep:fast": ["a7962d99","transitOut@0,engaging@2,transitBack@10","won:12","110b19af"],
  "repeat:destroyer:crimsonReaverSweep:fast": "7253a55c",
  "replay:destroyer:crimsonReaverSweep:fast": "f51b6ea4",
  "once:destroyer:crimsonReaverWarband:bare": ["4912f49d","transitOut@0,engaging@4,transitBack@16","won:20","e692a9"],
  "repeat:destroyer:crimsonReaverWarband:bare": "6dff9cbc",
  "replay:destroyer:crimsonReaverWarband:bare": "8ce2a37d",
  "once:destroyer:crimsonReaverWarband:fast": ["4201434e","transitOut@0,engaging@3,transitBack@15","won:18","7eadfd2d"],
  "repeat:destroyer:crimsonReaverWarband:fast": "6a6bf8d",
  "replay:destroyer:crimsonReaverWarband:fast": "ade35c43",
  "once:battleship:crimsonReaverSweep:bare": ["d148adf6","transitOut@0,engaging@5,transitBack@13","won:18","970447a5"],
  "repeat:battleship:crimsonReaverSweep:bare": "75160ffd",
  "replay:battleship:crimsonReaverSweep:bare": "1ce1681f",
  "once:battleship:crimsonReaverWarband:bare": ["e60947f4","transitOut@0,engaging@8,transitBack@20","won:28","b4a088b7"],
  "repeat:battleship:crimsonReaverWarband:bare": "e17d0334",
  "replay:battleship:crimsonReaverWarband:bare": "ed71e279",
  "once:carrier:crimsonReaverSweep:bare": ["4e649c52","transitOut@0,engaging@4,transitBack@12","won:16","7795a049"],
  "repeat:carrier:crimsonReaverSweep:bare": "5a97060",
  "replay:carrier:crimsonReaverSweep:bare": "9cc52b1a",
  "once:carrier:crimsonReaverWarband:bare": ["f131f134","transitOut@0,engaging@7,transitBack@19","won:26","cb4723c9"],
  "repeat:carrier:crimsonReaverWarband:bare": "a622ac1b",
  "replay:carrier:crimsonReaverWarband:bare": "613e0ea8",
  "once:carrier:crimsonReaverWarband:fast": ["5af6d856","transitOut@0,engaging@4,transitBack@16","won:20","9eaa180a"],
  "repeat:carrier:crimsonReaverWarband:fast": "24e397fc",
  "replay:carrier:crimsonReaverWarband:fast": "67f95f6c",
  "once:orion:crimsonReaverSweep:fast": ["8193d34","transitOut@0,engaging@2,transitBack@10","won:12","7d2f9efd"],
  "repeat:orion:crimsonReaverSweep:fast": "2b88cd11",
  "replay:orion:crimsonReaverSweep:fast": "204ba741",
  "once:orion:crimsonReaverWarband:fast": ["9defffb7","transitOut@0,engaging@3,limpingHome@8","lost:14","cd2ee600"],
  "repeat:orion:crimsonReaverWarband:fast": "a7f71aa7",
  "replay:orion:crimsonReaverWarband:fast": "bda54184",
  "once:aurora:crimsonReaverSweep:fast": ["1e1f12d7","transitOut@0,engaging@2,transitBack@10","won:12","7682aafd"],
  "repeat:aurora:crimsonReaverSweep:fast": "eca54aeb",
  "replay:aurora:crimsonReaverSweep:fast": "67b60df8",
  "once:aurora:crimsonReaverWarband:bare": ["b311cb5b","transitOut@0,engaging@4,limpingHome@9","lost:17","583207a5"],
  "repeat:aurora:crimsonReaverWarband:bare": "e0c77d63",
  "replay:aurora:crimsonReaverWarband:bare": "9bf414a8",
  "once:aurora:crimsonReaverWarband:fast": ["eec40b74","transitOut@0,engaging@3,limpingHome@8","lost:14","a3eaef88"],
  "repeat:aurora:crimsonReaverWarband:fast": "74ac3e6a",
  "replay:aurora:crimsonReaverWarband:fast": "f9ca6a1d",
  "once:eir:crimsonReaverSweep:bare": ["4296d6b5","transitOut@0,engaging@4,transitBack@12","won:16","b223c1d7"],
  "repeat:eir:crimsonReaverSweep:bare": "c951bb59",
  "replay:eir:crimsonReaverSweep:bare": "d6f1f07e",
  "once:eir:crimsonReaverWarband:bare": ["507ffe96","transitOut@0,engaging@6,limpingHome@11","lost:23","fdd0a59a"],
  "repeat:eir:crimsonReaverWarband:bare": "fd4a41fe",
  "replay:eir:crimsonReaverWarband:bare": "9f6fc320",
  "once:eir:crimsonReaverWarband:fast": ["1f8bf1d1","transitOut@0,engaging@4,limpingHome@9","lost:17","9399d169"],
  "repeat:eir:crimsonReaverWarband:fast": "d6bb3c41",
  "replay:eir:crimsonReaverWarband:fast": "fbcb5645",
};
