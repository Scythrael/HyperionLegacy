// E-CREW 0.14.0 (Task 21): OFFICER STAT FACETS (design D13 + section 7, mockup 7b).
//
// Every Senior Staff officer HEADS a department, and its four stats (seniorStaff.ts OFFICER_STAT_KEYS) are
// FACETS of how that department performs aboard the ship. Officer stats act on the ship and its on-ship crew
// only, never on a ground team's own numbers (D13). This module is the ONE place the facet math lives; every
// consumer reads through it.
//
// DEPARTMENTS (DEPARTMENT_OF_SEAT): Tactical heads Security, Science heads Science, Medical heads Medical,
// Engineering heads Engineering, Operations heads Operations, the Pilot heads the Flight Deck, and the XO
// touches EVERY department at XO_DEPARTMENT_SHARE (40%) of its own facet. The XO's own two bonuses count as
// its own department, so they get the XO's facet in full.
//
// NEUTRAL POINT (FIRST-PASS, TUNABLE): a facet is (stat - 10) * OFFICER_FACET_PER_POINT (1% per point), and
// only points ABOVE 10 count: a stat of 10 or less is exactly 0, so an all-10 bridge is byte-identical to a
// bridge without stats, and seating an officer can never make a department worse than an empty seat (the
// design calls Integrity "a bonus, never a new penalty"; the same rule is applied to all four facets, an
// open question for the user). Per facet:
//
//   STRENGTH      x (1 + facet) on every COMPLEMENT buff of the department (crewOverlay.ts, the per-bucket
//                 contribution). Every crew.* consumer reads that one map, so the Task 23 division pools
//                 inherit it automatically.
//   INTEGRITY     "Steady under fire": while the ship is BELOW HALF HULL in a ship battle (a patrol wave), the
//                 department's battle buffs are x (1 + facet) (crewOverlay.ts officerCombatProfile ->
//                 OfficerCombatMods.underFire -> Combatant.underFire, read live by resolveBattle). The battle
//                 buffs today are the officers' own Weapons / Shield / Evasive Command and Inspiring Leader
//                 (D12: the Complement never feeds weapons or shields). PER-SEAT ROWS (user-approved table,
//                 design section 7, 2026-10-09; INTEGRITY_DETAIL_BY_DEPARTMENT):
//                   Security / Flight Deck  the battle bonuses above (built first)
//                   Engineering  below half hull: faster shield RECHARGE (a "recharge" profile entry)
//                   Science      scanning a hazardous world: Expedition.hazardSteady joins the scan resist
//                   Medical      a member who comes home INJURED: Expedition.injurySteady joins the care
//                   Operations   a hold at least FULL_HOLD_FRACTION full: faster unload (MissionDef
//                                fullHoldUnloadTicks via ShipDerivedStats.fullHoldUnloadIntegrity)
//   CUNNING       a per-MISSION chance (= the facet) that the department OVER-DELIVERS, rolled from a PRIVATE
//                 keyed stream (cunningRollSeed: mission seed ^ CUNNING_SALT ^ seat index), never a shared one:
//                   Operations  bonus cargo: a delivered extraction / survey haul or transport margin gains
//                               CUNNING_BONUS_CARGO_SHARE (tick.ts tickCaptainMission, per delivered cycle)
//                   Science     a bonus rare-find roll on a delivered extraction / survey haul (same seam)
//                   Engineering a free repair tick: a patrol cycle that ends in defeat repairs
//                               CUNNING_FREE_REPAIR_TICKS faster (rolled per cycle, frozen on the mission)
//                   Security    softens an enemy ambush: the expedition's random scan encounters field
//                               enemies at (1 - CUNNING_AMBUSH_SOFTEN) health and power (rolled at dispatch)
//                   Medical     a quicker recovery: the expedition's injured come home with
//                               CUNNING_QUICK_RECOVERY added to their care (rolled at dispatch)
//                   Flight Deck + XO: NO decided effect yet (see CUNNING_PENDING_SEATS).
//   CONSTITUTION  the long-haul RAMP: the department's in-run buffs grow by facet * diminishing(hours out,
//                 CONSTITUTION_RAMP_KNEE_HOURS). The plan's first pass said "capped 5 hours"; D23 (user,
//                 2026-10-08: diminishing returns, never hard caps) supersedes the cap, so 5 hours is the
//                 curve's KNEE: the ramp keeps growing past it, each hour worth less. In-run buffs:
//                   patrols     the battle buffs above, frozen per patrol CYCLE from the hours this run has
//                               already flown (tick.ts relaunch; a dispatch starts at 0 hours)
//                   expeditions the Science crew's rare find (the relic roll) and Evasive Command (the
//                               scan encounter chance), from the hours since dispatch at each roll
//                 Plus a shorter post-mission TURNAROUND: Operations unloads faster (unloadSpeedMult),
//                 Engineering repairs faster (the Shipyard repair divisor), Medical heals injuries sooner
//                 (the injury recovery divisor). Each is x (1 + facet) or + facet on a D23 divisor.
//                 PER-SEAT RAMPS added by the user-approved table (CONSTITUTION_DETAIL_BY_DEPARTMENT):
//                   Flight Deck  a faster RETURN leg the longer the voyage ran: missions (effectiveMissionDef,
//                                hours before the leg), patrol cycles (PatrolMissionState.returnCutTicks),
//                                expeditions (Expedition.rampReturn, hours since dispatch)
//                   Engineering  fuel efficiency (range) on a long voyage: the reach gate divides the trip's
//                                need by (1 + the ramp on its round-trip hours) (tick.ts shipReachesRoundTrip)
//                   Science      also the yield of a SURVEY, ramped on the survey cycle's planned hours
//
// PARITY: every value here is a pure function of state (the seated officers + their stats) or of the stored
// run; expedition and patrol values are FROZEN at dispatch / relaunch, and every random draw is a private
// keyed stream. Nothing reads Date.now() or Math.random.

import type { CrewProfession, GameState, OfficerStats, SeniorStaffOfficer, SeniorStaffSeat, ShipInstance } from "./model";
import { FULL_HOLD_FRACTION } from "./model";
import { officerStats, OFFICER_STAT_INFO, SENIOR_STAFF_SEATS } from "./seniorStaff";
import { CONSTITUTION_RAMP_KNEE_HOURS, constitutionRamp } from "./constitutionRamp";
import { makeRng, type Rng } from "./combat/rng";

// ============================================================================
// Departments
// ============================================================================

// The department each seat heads. "all" = the XO (every department at XO_DEPARTMENT_SHARE).
export const DEPARTMENT_OF_SEAT: Readonly<Record<SeniorStaffSeat, CrewProfession | "all">> = {
  tactical: "security",
  science: "science",
  medical: "medical",
  engineering: "engineering",
  operations: "operations",
  pilot: "flightDeck",
  executive: "all",
};

// The share of the XO's own facet every department gains (FIRST-PASS, TUNABLE).
export const XO_DEPARTMENT_SHARE = 0.4;

// The six departments in a fixed order (the CrewProfession union).
export const OFFICER_DEPARTMENTS: readonly CrewProfession[] = ["security", "science", "medical", "engineering", "operations", "flightDeck"];

// Display names for the departments (US English).
export const DEPARTMENT_LABEL: Readonly<Record<CrewProfession, string>> = {
  security: "Security",
  science: "Science",
  medical: "Medical",
  engineering: "Engineering",
  operations: "Operations",
  flightDeck: "Flight Deck",
};

// The seat that heads a department (the inverse of DEPARTMENT_OF_SEAT, the XO excluded).
export function seatOfDepartment(dept: CrewProfession): SeniorStaffSeat {
  for (const seat of SENIOR_STAFF_SEATS) if (DEPARTMENT_OF_SEAT[seat] === dept) return seat;
  throw new Error(`no seat heads the ${dept} department`);
}

// ============================================================================
// The facet value
// ============================================================================

export const OFFICER_STAT_NEUTRAL = 10;
export const OFFICER_FACET_PER_POINT = 0.01;

// One stat's facet: 1% per point ABOVE the neutral 10, exactly 0 at or below it (see the header). Pure.
export function officerStatFacet(value: number): number {
  return value > OFFICER_STAT_NEUTRAL ? (value - OFFICER_STAT_NEUTRAL) * OFFICER_FACET_PER_POINT : 0;
}

// The officer sitting `seat` on `ship`, or undefined. Pure.
function seated(state: GameState, ship: ShipInstance, seat: SeniorStaffSeat): SeniorStaffOfficer | undefined {
  return state.officers.find((o) => o.assignedShipId === ship.id && o.seat === seat);
}

// One seated officer's facet for `stat` (0 for an empty seat). Pure.
function seatOwnFacet(state: GameState, ship: ShipInstance, seat: SeniorStaffSeat, stat: keyof OfficerStats): number {
  const officer = seated(state, ship, seat);
  return officer ? officerStatFacet(officerStats(officer)[stat]) : 0;
}

// A department's facet for `stat` on `ship`: its head's facet plus XO_DEPARTMENT_SHARE of the XO's. 0 with
// neither seated (or both at 10 or below). Pure.
export function departmentFacet(state: GameState, ship: ShipInstance, dept: CrewProfession, stat: keyof OfficerStats): number {
  const head = seatOwnFacet(state, ship, seatOfDepartment(dept), stat);
  const xo = seatOwnFacet(state, ship, "executive", stat);
  return xo === 0 ? head : head + XO_DEPARTMENT_SHARE * xo;
}

// The facet that applies to the bonuses an officer in `seat` carries: its department's facet, or for the XO
// (whose own bonuses are its own department) the XO's facet in full. Pure.
export function seatFacet(state: GameState, ship: ShipInstance, seat: SeniorStaffSeat, stat: keyof OfficerStats): number {
  const dept = DEPARTMENT_OF_SEAT[seat];
  return dept === "all" ? seatOwnFacet(state, ship, "executive", stat) : departmentFacet(state, ship, dept, stat);
}

// ============================================================================
// Strength
// ============================================================================

// The per-department multiplier on the ship's COMPLEMENT buffs, 1 + the department's Strength facet, or null
// when every department's facet is 0 (the neutral fast path: the caller keeps its unscaled fold untouched,
// so an all-10 bridge is byte-identical). Pure.
export function departmentStrengthMultipliers(state: GameState, ship: ShipInstance): Readonly<Record<CrewProfession, number>> | null {
  let any = false;
  const out = {} as Record<CrewProfession, number>;
  for (const dept of OFFICER_DEPARTMENTS) {
    const f = departmentFacet(state, ship, dept, "strength");
    if (f !== 0) any = true;
    out[dept] = 1 + f;
  }
  return any ? out : null;
}

// ============================================================================
// Cunning
// ============================================================================

// The salt of every Cunning over-delivery roll (unique in the repo; odd). FIRST-PASS constants below.
export const CUNNING_SALT = 0x4f1bbcdd;
export const CUNNING_BONUS_CARGO_SHARE = 0.25; // Operations: +25% of that cycle's delivered haul / margin
export const CUNNING_FREE_REPAIR_TICKS = 1; // Engineering: one repair tick off the cycle's defeat repair
export const CUNNING_AMBUSH_SOFTEN = 0.25; // Security: scan-encounter enemies at 75% health and power
export const CUNNING_QUICK_RECOVERY = 0.5; // Medical: +0.5 on the run's injury care divisor

// TODO(user decision pending, asked 2026-10-09): the Flight Deck officer (Pilot) and the XO have NO decided
// Cunning over-delivery yet. Until the user names one, a Pilot's Cunning does nothing on its own and the XO's
// Cunning only reaches the other departments through its XO_DEPARTMENT_SHARE. Listed so the Task 22 "no dead
// stats" pass and the Help topic can name the gap honestly.
export const CUNNING_PENDING_SEATS: readonly SeniorStaffSeat[] = ["pilot", "executive"];

// A seat's index in SENIOR_STAFF_SEATS (the "seat index" of the roll key). Pure.
export function seatIndex(seat: SeniorStaffSeat): number {
  return SENIOR_STAFF_SEATS.indexOf(seat);
}

// The private stream seed of one department's Cunning roll for one mission: mission seed ^ CUNNING_SALT ^ seat
// index. Never a shared stream, so a roll can neither shift nor be shifted by any other draw. Pure.
export function cunningRollSeed(missionSeed: number, seat: SeniorStaffSeat): number {
  return ((missionSeed >>> 0) ^ CUNNING_SALT ^ seatIndex(seat)) >>> 0;
}

// Did the department in `seat` over-deliver on this mission? The FIRST draw of its private stream against
// `chance` (the department's Cunning facet). A chance of 0 or less draws nothing and is false. Pure.
export function cunningProc(missionSeed: number, seat: SeniorStaffSeat, chance: number): boolean {
  return cunningStream(missionSeed, seat, chance) !== null;
}

// The same roll, returning the department's private stream positioned AFTER the proc draw when it succeeds
// (null otherwise), for an over-delivery that needs further draws of its own (Science's bonus rare-find
// roll, the whole-unit rounding of Operations' bonus cargo). Same first draw as cunningProc. Pure.
export function cunningStream(missionSeed: number, seat: SeniorStaffSeat, chance: number): Rng | null {
  if (!(chance > 0)) return null;
  const rng = makeRng(cunningRollSeed(missionSeed, seat));
  return rng.next() < chance ? rng : null;
}

// A captain mission has no stored seed, so its per-cycle "mission seed" is an FNV-1a mix of the captain id and
// the captain's LIFETIME Cunning cycle count (CaptainState.cunningCycles, one step per rolled delivered cycle,
// never reset by a dispatch), so no two cycles of a captain's career share a key, across runs too. Pure.
export function captainCycleMissionSeed(captainId: number, lifetimeCycle: number): number {
  const key = `${captainId}|cunning|${lifetimeCycle}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ============================================================================
// Constitution
// ============================================================================

// The ramp itself lives in the constitutionRamp.ts leaf (model.ts reads it for the return leg); re-exported.
export { CONSTITUTION_RAMP_KNEE_HOURS, constitutionRamp };

// ============================================================================
// Player-facing text (the Senior Staff tooltips and the Task 34 Help topic)
// ============================================================================

// What each department's Cunning over-delivery is, by heading seat (the panel's "For X, that means ...").
// The pending seats (CUNNING_PENDING_SEATS) are absent and read the generic line.
export const CUNNING_EDGE_BY_DEPARTMENT: Readonly<Partial<Record<CrewProfession, string>>> = {
  science: "a bonus rare-find roll on a delivered mining or survey haul",
  operations: `${Math.round(CUNNING_BONUS_CARGO_SHARE * 100)}% bonus cargo on a delivered haul or transport`,
  engineering: "a free repair tick when a patrol ends in defeat",
  security: `a softened ambush: an expedition's random battles field enemies at ${Math.round((1 - CUNNING_AMBUSH_SOFTEN) * 100)}% strength`,
  medical: "a quicker recovery for the expedition's injured",
};

// What each department's Constitution touches: the ramp's in-run buffs, and for the three departments that
// have one, the shorter post-mission TURNAROUND (Task 21 review: only those three promise it). Every
// department also ramps any Inspiring Leader its officer carries on a patrol.
export const CONSTITUTION_DETAIL_BY_DEPARTMENT: Readonly<Record<CrewProfession, string>> = {
  security: "Ramps: Weapons Command and Shield Command on a long patrol",
  flightDeck: "Ramps: a faster return trip the longer the voyage, and Evasive Command on a long patrol or expedition",
  science: "Ramps: the Science crew's relic chance on a long expedition and the yield of a long survey",
  operations: "Turnaround: unloading at home is faster",
  engineering: "Ramps: better fuel efficiency on a long voyage, so the ship reaches further on it. Turnaround: Shipyard repairs are faster",
  medical: "Turnaround: injured away-team members recover sooner",
};

// What each department's Integrity does, trigger first (design section 7, the per-seat table approved by the
// user 2026-10-09). The XO reads its own line.
export const INTEGRITY_DETAIL_BY_DEPARTMENT: Readonly<Record<CrewProfession, string>> = {
  security: "Below half hull in a patrol battle: weapon damage (Weapons Command, Inspiring Leader) and shield recharge (Shield Command)",
  flightDeck: "Below half hull in a patrol battle: Evasive Command dodges more",
  engineering: "Below half hull in a patrol battle: the shields recharge faster",
  science: "While scanning a hazardous world: the hazard slows the scan less",
  medical: "When away-team members come home injured: they recover sooner",
  operations: `With the hold at least ${Math.round(FULL_HOLD_FRACTION * 100)}% full: unloading at home is faster`,
};

// The stats whose facet also reaches the XO's OWN bonuses in full (seatFacet's "all" branch): Integrity and
// Constitution act on the officers' own battle bonuses. Strength acts on the Complement and Cunning on the
// department rolls, so neither touches an officer's own bonus.
const XO_OWN_BONUS_STATS: ReadonlySet<keyof OfficerStats> = new Set<keyof OfficerStats>(["integrity", "constitution"]);

// One stat's tooltip for an officer in `seat`, worded for the department it heads (the Senior Staff panel and
// the coming Help topic). Pure.
export function officerStatTooltip(key: keyof OfficerStats, seat: SeniorStaffSeat): string {
  const info = OFFICER_STAT_INFO[key];
  const dept = DEPARTMENT_OF_SEAT[seat];
  const xoShare = `${Math.round(XO_DEPARTMENT_SHARE * 100)}%`;
  const who =
    dept === "all"
      ? `every department at ${xoShare} of its value${XO_OWN_BONUS_STATS.has(key) ? " (and the XO's own bonuses in full)" : ""}`
      : `the ${DEPARTMENT_LABEL[dept]} department`;
  const facet = info.facet.charAt(0).toLowerCase() + info.facet.slice(1);
  return `${info.label}: ${facet}. Applies to ${who}. ${info.effect}${statDetail(key, dept)} ${OFFICER_STAT_NEUTRAL} or below adds nothing.`;
}

// The department-specific half of a tooltip: what a Cunning over-delivery is, and what Constitution's ramp or
// turnaround touches. "" when nothing extra applies.
function statDetail(key: keyof OfficerStats, dept: CrewProfession | "all"): string {
  if (key === "cunning") {
    if (dept === "all") return " Its share raises every department's chance; the XO has no over-delivery of its own yet.";
    const edge = CUNNING_EDGE_BY_DEPARTMENT[dept];
    return edge ? ` For ${DEPARTMENT_LABEL[dept]}, that means ${edge}.` : ` The ${DEPARTMENT_LABEL[dept]} has no over-delivery of its own yet.`;
  }
  if (key === "integrity") {
    return dept === "all"
      ? " Its share reaches every department's trigger, and its own battle bonuses gain it in full below half hull."
      : ` ${INTEGRITY_DETAIL_BY_DEPARTMENT[dept]}.`;
  }
  if (key === "constitution") {
    return dept === "all"
      ? " Its share reaches every department's ramp and the Operations, Engineering and Medical turnarounds."
      : ` ${CONSTITUTION_DETAIL_BY_DEPARTMENT[dept]}.`;
  }
  return "";
}
