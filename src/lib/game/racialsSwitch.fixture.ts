// The four inert racials go live (0.14.0, user "everything wired" 2026-10-20): the "turn it off" switch the golden
// tests use to prove what the wiring moved. TEST-ONLY (imported by *.test.ts files only).
//
// The wiring makes three keys act: crew.droneHandling (Deck Handling + the Belter racial: a patrol cycle's drone
// replenish rate), crew.surveyAptitude (Survey Aptitude + the Vael and Outer-Colony racials: an expedition's scan
// speed), and moves the Spacer racial from the sourceless crew.endurance onto the sweeping transit speed key. With
// the switch ON (for the duration of one call, restored after, nothing else touched) the Spacer racial targets
// crew.endurance again and the five drone / survey sources' catalog magnitudes are 0, so a fixture computed inside it
// is the pre-wiring fixture exactly.
//
// `droneAndSurvey: false` restores only the Spacer key, for a fixture that hashes the crew MAP itself (the drone and
// survey keys always sat in it, so zeroing them would move the map although nothing reads it differently there).

import { CREW_PROFESSION_BUFFS, CREW_STAT_KEYS } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import type { CrewRace } from "./model";

export const RACIALS_SWITCHED_BUFFS: readonly string[] = ["flight.droneHandling", "sci.survey"];
export const RACIALS_SWITCHED_RACES: readonly CrewRace[] = ["belter", "outerColony", "vael"];

export function withRacialsOff<T>(run: () => T, opts: { droneAndSurvey?: boolean } = {}): T {
  const zero = opts.droneAndSurvey !== false;
  const defs = Object.values(CREW_PROFESSION_BUFFS)
    .flat()
    .filter((d) => RACIALS_SWITCHED_BUFFS.includes(d.id));
  if (defs.length !== RACIALS_SWITCHED_BUFFS.length) throw new Error("withRacialsOff: a switched buff id is missing from the catalog");
  const races = RACIALS_SWITCHED_RACES.map((r) => CREW_RACES[r].racialBonus);
  const spacer = CREW_RACES.spacer.racialBonus;
  const saved = { defs: defs.map((d) => d.magnitude), races: races.map((rb) => ({ ...rb })), spacer: { ...spacer } };
  try {
    spacer.statKey = CREW_STAT_KEYS.endurance;
    if (zero) {
      for (const d of defs) d.magnitude = 0;
      for (const rb of races) {
        rb.seniorStaff = 0;
        rb.complement = 0;
      }
    }
    return run();
  } finally {
    defs.forEach((d, i) => (d.magnitude = saved.defs[i]));
    races.forEach((rb, i) => Object.assign(rb, saved.races[i]));
    Object.assign(spacer, saved.spacer);
  }
}
