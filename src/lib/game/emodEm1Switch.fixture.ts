// E-MOD EM-1 (docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-1): the "turn it off" switch the
// golden tests use to prove what the power budget engine moved. TEST-ONLY (imported by *.test.ts files only).
//
// EM-1 moves exactly two ship sheet fields: powerOutput gains the hull's own basePowerOutput (P1), and powerDraw is
// cut by the crew's power efficiency (P4: Reactor Overdrive, Power Discipline, the Martian racial). With the switch
// ON (for the duration of one call, restored after, nothing else touched) every hull's basePowerOutput is 0 and those
// three sources' catalog magnitudes are 0, so a sheet computed inside it is the pre-EM-1 sheet exactly. A fixture
// that wants its officer's Overdrive switched too must read the magnitude from the catalog at call time.
//
// The golden files that pinned a ship sheet before EM-1 hash it inside this switch, so their pins keep proving that
// nothing else on the sheet moved; emodGoldens.test.ts pins the new power numbers and proves the switch reproduces
// its own EM-0 capture.

import { SHIP_TYPES, type ShipTypeKey } from "./model";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import { SENIOR_STAFF_BONUSES } from "./seniorStaffBonuses";

export const EM1_SWITCHED_BUFFS: readonly string[] = ["eng.power"];
export const EM1_SWITCHED_BONUSES: readonly string[] = ["eng.overdrive"];

export function withEm1Off<T>(run: () => T): T {
  const hulls = Object.keys(SHIP_TYPES) as ShipTypeKey[];
  const buffs = Object.values(CREW_PROFESSION_BUFFS).flat().filter((d) => EM1_SWITCHED_BUFFS.includes(d.id));
  const bonuses = SENIOR_STAFF_BONUSES.filter((d) => EM1_SWITCHED_BONUSES.includes(d.id));
  if (buffs.length !== EM1_SWITCHED_BUFFS.length || bonuses.length !== EM1_SWITCHED_BONUSES.length) throw new Error("withEm1Off: a switched id is missing from the catalog");
  const martian = CREW_RACES.martian.racialBonus;
  const saved = {
    hulls: hulls.map((h) => SHIP_TYPES[h].basePowerOutput),
    buffs: buffs.map((d) => d.magnitude),
    bonuses: bonuses.map((d) => d.magnitude),
    martian: { ...martian },
  };
  try {
    for (const h of hulls) SHIP_TYPES[h].basePowerOutput = 0;
    for (const d of buffs) d.magnitude = 0;
    for (const d of bonuses) (d as { magnitude: number }).magnitude = 0;
    martian.seniorStaff = 0;
    martian.complement = 0;
    return run();
  } finally {
    hulls.forEach((h, i) => (SHIP_TYPES[h].basePowerOutput = saved.hulls[i]));
    buffs.forEach((d, i) => (d.magnitude = saved.buffs[i]));
    bonuses.forEach((d, i) => ((d as { magnitude: number }).magnitude = saved.bonuses[i]));
    Object.assign(martian, saved.martian);
  }
}
