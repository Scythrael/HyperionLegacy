// S1 / S2 crew locks (0.14.0, docs/plans/2026-10-17-small-calls-answers.md: "Lock it (Recommended)" for both): the
// shared fixture for the ship gear lock and the captain lock tests and their goldens. A two-ship fleet on a fresh save:
//   ship-1  the starting General Freighter, flown by captain 1 (idle)
//   ship-2  a parked General Freighter
//   captain 2, idle, with no ship
// plus a spare Cargo Bay ("gl-spare-cargo") and an available Armory loadout ("loadout-gl", General Freighter) holding a
// committed Cargo Bay ("gl-loadout-cargo"). The lock appliers put ship-1 (or any ship) "out" in each of the ways the
// one crew lock (crewLock.ts shipCrewLocked) knows: a captain mission, a patrol, a short-range run, an expedition in
// flight and an expedition complete but not claimed. The locks read only the mission kind and the expedition's ship,
// so the appliers write just those fields. Test-only.

import type { CaptainMissionState, CaptainState, EquipmentInstance, Expedition, GameState, PatrolMissionState, ShortRangeMissionState } from "./model";
import { emptyGroundTeams } from "./groundTeams";
import { wiringBase } from "./wiring/probes";

export const GL_SPARE = "gl-spare-cargo";
export const GL_LOADOUT = "loadout-gl";
export const GL_LOADOUT_PIECE = "gl-loadout-cargo";

export function gearLockFleet(): GameState {
  const base = wiringBase();
  const cargo = base.equipment.find((e) => e.fittedToShipId === "ship-1" && e.slotType === "cargoBay");
  if (!cargo) throw new Error("gearLockFleet: ship-1 has no Cargo Bay");
  const spare: EquipmentInstance = { ...cargo, id: GL_SPARE, fittedToShipId: null, rarity: "augmented", iLevel: 12 };
  const committed: EquipmentInstance = { ...cargo, id: GL_LOADOUT_PIECE, fittedToShipId: null, rarity: "stellar", iLevel: 14, committedToLoadoutId: GL_LOADOUT };
  const captain2: CaptainState = { ...base.captains[0], id: 2, label: "Captain 2", mission: null };
  return {
    ...base,
    captains: [...base.captains, captain2],
    ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null, groundTeams: emptyGroundTeams("generalFreighter") }],
    equipment: [...base.equipment, spare, committed],
    loadouts: [{ id: GL_LOADOUT, name: "Gear Lock", shipTypeKey: "generalFreighter", slots: { cargoBay: GL_LOADOUT_PIECE }, checkedOutToShipId: null }],
    nextLoadoutId: base.nextLoadoutId + 1,
  };
}

export type GearLockKind = "mission" | "patrol" | "shortRange" | "expedition" | "expeditionUnclaimed";
export const GEAR_LOCK_KINDS: readonly GearLockKind[] = ["mission", "patrol", "shortRange", "expedition", "expeditionUnclaimed"];

function withCaptainMission(s: GameState, captainId: number, mission: NonNullable<CaptainState["mission"]>): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === captainId ? { ...c, mission } : c)) };
}

// `shipId` "out" in the way `kind` names. A captain lock goes on the ship's assigned captain (captain 1 for ship-1);
// an expedition lock goes on the ship itself (a parked hull too: a save from before S1 can hold one).
export function lockShip(s: GameState, kind: GearLockKind, shipId = "ship-1"): GameState {
  const captainId = s.ships.find((x) => x.id === shipId)?.assignedCaptainId ?? null;
  switch (kind) {
    case "mission": {
      const m: CaptainMissionState = {
        kind: "extraction",
        missionKey: "shortOreRun",
        phase: "transitOut",
        phaseProgressTicks: 0,
        cargo: {} as CaptainMissionState["cargo"],
        recalled: false,
      };
      return withCaptainMission(s, captainId!, m);
    }
    case "patrol":
      return withCaptainMission(s, captainId!, { kind: "patrol", patrolKey: "crimsonReaverSweep" } as unknown as PatrolMissionState);
    case "shortRange":
      return withCaptainMission(s, captainId!, { kind: "shortRange", slotId: 0, phase: "transitOut" } as unknown as ShortRangeMissionState);
    case "expedition":
    case "expeditionUnclaimed":
      return {
        ...s,
        expeditions: [
          ...s.expeditions,
          { id: `expedition-${shipId}`, shipId, captainId, phase: kind === "expedition" ? "transit" : "complete" } as unknown as Expedition,
        ],
      };
  }
}

// The fleet with the loadout checked out to ship-1 (while home), for the check-in paths.
export function withLoadoutWorn(s: GameState, checkOut: (s: GameState, loadoutId: string, shipId: string) => GameState): GameState {
  const worn = checkOut(s, GL_LOADOUT, "ship-1");
  if (worn === s) throw new Error("withLoadoutWorn: the home check-out was refused");
  return worn;
}
