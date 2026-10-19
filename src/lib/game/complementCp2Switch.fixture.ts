// Complement and Acquisition CP-2 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-2): the
// "turn it off" switch the golden tests use to prove what CP-2 moved. TEST-ONLY (imported by *.test.ts files only).
//
// CP-2 makes six complement keys act (Damage Control, Mission Turnaround, Crew Output Multiplier, Crew Effectiveness,
// and the Earth-born and Stheni racials), splits Fast Departure / Fast Return onto their own legs (OC-E5), lets the
// Museum's crewBonuses amplify the officer bonuses read directly (OC-E8) and ramps a patrol's first cycle by
// Constitution (OC-E13). A fixture that carries none of those is untouched. One that does moves, and a golden that
// pins it is re-pinned with this proof beside it: with the switch OFF (each switched buff's and racial's catalog
// magnitude set to 0 for the duration of one call, restored after, nothing else touched), the fixture reproduces
// its pre-CP-2 capture exactly, so the switched effects are the only thing CP-2 moved there.
//
// `transit: false` leaves Fast Departure / Fast Return switched ON, for a fixture whose pre-CP-2 capture had them
// acting (their old merged fold and the new per-leg fold give the same whole ticks there).

import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import type { CrewRace } from "./model";

export const CP2_SWITCHED_BUFFS: readonly string[] = ["med.effectiveness", "eng.hullRepair", "excl.crewOutputMult", "excl.missionTurnaround"];
export const CP2_TRANSIT_BUFFS: readonly string[] = ["flight.transitOut", "flight.transitBack"];
export const CP2_SWITCHED_RACES: readonly CrewRace[] = ["earthBorn", "stheni"];

export function withCp2Off<T>(run: () => T, opts: { transit?: boolean } = {}): T {
  const ids = opts.transit === false ? CP2_SWITCHED_BUFFS : [...CP2_SWITCHED_BUFFS, ...CP2_TRANSIT_BUFFS];
  const defs = [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE].filter((d) => ids.includes(d.id));
  if (defs.length !== ids.length) throw new Error("withCp2Off: a switched buff id is missing from the catalog");
  const races = CP2_SWITCHED_RACES.map((r) => CREW_RACES[r].racialBonus);
  const saved = { defs: defs.map((d) => d.magnitude), races: races.map((rb) => ({ ...rb })) };
  try {
    for (const d of defs) d.magnitude = 0;
    for (const rb of races) {
      rb.seniorStaff = 0;
      rb.complement = 0;
    }
    return run();
  } finally {
    defs.forEach((d, i) => (d.magnitude = saved.defs[i]));
    races.forEach((rb, i) => Object.assign(rb, saved.races[i]));
  }
}
