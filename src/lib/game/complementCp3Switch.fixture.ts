// Complement and Acquisition CP-3 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-3): the
// "turn it off" switch the golden tests use to prove what CP-3 moved. TEST-ONLY (imported by *.test.ts files only).
//
// CP-3 makes four complement keys act on Ground Ops runs (Away-Team Protection, Counter-Infiltration, Triage, Prevent
// a Crew Loss), each frozen at dispatch and written only when non-zero. With the switch OFF (each of the four buffs'
// catalog magnitude set to 0 for the duration of one call, restored after, nothing else touched) a run dispatched
// inside it freezes none of them, so a fixture computed there reproduces its pre-CP-3 capture exactly: the four keys
// are the only thing CP-3 moved there. No racial targets any of the four keys, so only the buffs switch.

import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";

export const CP3_SWITCHED_BUFFS: readonly string[] = ["sec.counterInfiltration", "sec.awayTeam", "med.triage", "excl.preventCrewLoss"];

export function withCp3Off<T>(run: () => T): T {
  const defs = [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE].filter((d) => CP3_SWITCHED_BUFFS.includes(d.id));
  if (defs.length !== CP3_SWITCHED_BUFFS.length) throw new Error("withCp3Off: a switched buff id is missing from the catalog");
  const saved = defs.map((d) => d.magnitude);
  try {
    for (const d of defs) d.magnitude = 0;
    return run();
  } finally {
    defs.forEach((d, i) => (d.magnitude = saved[i]));
  }
}
