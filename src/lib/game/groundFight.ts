// Ground Operations 0.14.0 (GO-5; D25, user Q5; plan docs/plans/2026-10-09-ground-operations-plan.md): ONE
// TASK FIGHT, pure. When a ground team's work reaches a task's next fight point, its Security squad fights the
// site's guard; the timeline engine (GO-7b) resolves the fight at its START, stores the record, and applies it
// at its END (merge the conditions into the trip's bay list, add the downed to the task's sit-out list, a win
// passes the point, a loss sends the team home with the progress held).
//
//   - WHO FIGHTS: the Security members of the team set working the task (team order, then slot order, each
//     member once), minus the members downed earlier in THIS task (GroundTeamRun.downedThisTask). The crew
//     layer is the run's frozen Security strength times the team set's summed share (1 with one team, so a
//     one-team fight reads exactly the run's numbers). Science never fights (design D2).
//   - THE GUARD: generateEncounter on the body's hazard after the museum resist (the legacy battle guard),
//     with NO ambush soften: the Security Cunning soften moves to the ship-side hostile probe (GO-8; D13 keeps
//     officer stats off ground-team fights). Squads SQ-4: a body's FLORA adds Poison to the guard's attacks
//     (withFloraToxins; risk-aware runs only).
//   - CARRY DAMAGE (user Q5, 2026-10-12): "survivors carry HP and statuses from fight to fight within a
//     task; full recovery only in the ship's medical bay on the return trip." A fight takes an optional carried
//     state per member (the previous fight's memberEnd) and fields those members at their carried HP with
//     their PERSISTING statuses (the ones the bay cures: medicalBay.ts GROUND_CONDITIONS, today Poison and
//     Bleed). Combat-only statuses (stun, weakened, suppressed, corroded, fear, every buff) end with the battle
//     [PROVISIONAL, Q6]. A carried status resumes with the rounds it had left: the battle clock stops between
//     fights [PROVISIONAL]. With no carried state every member starts at full HP. The team kit refills each
//     fight (exp.teamKit per battle, the legacy rule) [PROVISIONAL].
//
// DETERMINISM: ONE private stream per fight, keyed by (task flat index, fight number):
//   seed = (exp.seed ^ GROUND_FIGHT_SALT ^ imul(flatIndex + 1, 0x9e3779b9) ^ imul(fightNumber + 1, 0x85ebca6b)) >>> 0
// where fightNumber = the task's fightCount when the fight starts, so every attempt meets a fresh encounter
// ("a fresh encounter per attempt") and a retry never replays a loss. Like the legacy battle, the guard's
// generation and the fight both read makeRng(seed), and Neural Backup rolls on its own stream off the same
// seed (gambit.ts NEURAL_BACKUP_SALT), never a draw on the fight's. Never the legacy COMBAT_SALT stream (retired by OC-G1) and
// never a shared one. The result reads only the stored run and the arguments, so offline == live.
//
// SAFE FIRST RUNS (SF-2): on a training run (enemyRanks.ts isTrainingRun) the guard reads hazard 0 and the training
// profile (gambit.ts generateEncounter's EncounterProfile: runDifficulty.ts FIRST_RUN_ENEMY_SCALE and
// FIRST_RUN_MAX_ENEMIES). Same seed, same draws.
// SF-3: every OTHER run dispatched since SF-3 carries an ordinary stamp (runDifficulty.ts rampedStampOf): its guard
// reads the body's hazard at most the tier's ceiling (encounterHazard: Tier I 0.1, Tier II 0.5, the vault fix) and the
// curve's enemy strength (rampEnemyScale; full strength reads no profile), and its unled enemies take the faded Weak
// factor (enemyRanks.ts curveBaseFactor, named by curveBaseRank). Same seed, same draws. A run without the stamp is exactly as before.
//
// Module graph: model (types), combat/rng, gambit, medicalBay, relics, groundTasks, riskFactors, affixes, enemyRanks,
// runDifficulty; never expedition.ts.

import type {
  Expedition,
  ExpeditionActivity,
  ExpeditionBody,
  GambitStatusId,
  GroundFightRecord,
  GroundMemberCarry,
  GroundMemberEnd,
  SnapshotMember,
} from "./model";
import { makeRng } from "./combat/rng";
import {
  GAMBIT_STATUSES,
  ENEMY_ROLE_RANGE,
  MAX_ROUNDS,
  buildRosterCombatants,
  memberWeaponRange,
  generateEncounter,
  resolveGroundBattle,
  type EncounterProfile,
  type GambitLogEvent,
  type GroundCombatant,
  type GroundStatus,
} from "./gambit";
import { GROUND_CONDITIONS } from "./medicalBay";
import { resistedHazard } from "./relics";
import { teamSnapshotMembers } from "./groundTasks";
import { FLORA_POISON_PERMILLE_PER_GRADE, bodyFloraGrade } from "./riskFactors";
import { escalationAt, hasCover, type GroundCover } from "./affixes";
import {
  curveBaseFactor,
  curveBaseRank,
  fightLeadRank,
  fightRankContext,
  isTrainingRun,
  rankedEnemies,
  ranksLive,
  withEnemyRanks,
  type RankedFightKind,
} from "./enemyRanks";
import { FIRST_RUN_ENEMY_SCALE, FIRST_RUN_MAX_ENEMIES, encounterHazard, rampEnemyScale, rampedChance, rampedStampOf, runOddsRampOf } from "./runDifficulty";
// Field Kits FKR-4: the flag and the inflictors (a Field Kits run only).
import { SPLINT_HEAL_ROUNDS, fieldKitsLive, timedFusesLive, type FieldKitId } from "./fieldKits";
import { withFieldKitsGuard, withFieldKitsTeam } from "./fieldKitsConditions";
// Field Kits FKR-5: the squad's thrown grenades and their charges (a Field Kits run only).
import { withThrownGrenades } from "./fieldKitsGrenades";
// Field Kits FKR-6: kits in battle, the Field Kits default program (a Field Kits run only).
import { FIELD_KITS_BATTLE, withFieldKitPacks, withFieldKitsDefaultProgram, type MemberKitCounts } from "./fieldKitsBattle";
// GEAR WEAR step 4: the member armor battle source (a pure leaf over model types).
import { battleWearRaw } from "./gearWear";

// ===== Constants =====

// The task fight's stream salt: odd, distinct from every engine salt (salts.test.ts checks it).
export const GROUND_FIGHT_SALT = 0x4d2a7e1b;
// A fight step lasts its rounds fought times this [PROVISIONAL, Q9].
export const GROUND_ROUND_SECONDS = 6;

// ===== Types =====

// What a fight needs from ONE ground team: its Security member ids (members of exp.roster, slot order), the
// members out for the rest of the current task, and its share of the ship's Security crew layer (GO-7a
// freezes it as GroundOpsFactors.securityShare; 1 with one team). GO-7b passes each GroundTeamRun as
// { ...teamRun, securityShare: factors.securityShare[pos] } (the GO-4 GroundTaskTeam precedent).
export interface GroundFightTeam {
  securityIds: readonly string[];
  downedThisTask?: readonly string[];
  securityShare: number;
  // Field Kits FKR-5: memberId -> the grenade charges that member has left this objective (FKR-7 keeps the count on
  // the team's run and passes it here). A member without an entry starts the fight with full charges
  // (fieldKitsGrenades.ts chargesLeftFor). Read only on a Field Kits run.
  charges?: Readonly<Record<string, number>>;
  // Field Kits FKR-6: memberId -> the kits that member carries into the fight: `basics` = the objective's free basic
  // set left, `kits` = the extras they packed, left (FKR-7 keeps both on the team's run, GroundTeamRun.basics / .kits,
  // and passes them here). A member without an entry carries none. Read only on a Field Kits run.
  basics?: Readonly<Record<string, Readonly<Partial<Record<FieldKitId, number>>>>>;
  kits?: Readonly<Record<string, Readonly<Partial<Record<FieldKitId, number>>>>>;
}

// The fight record types (GroundMemberCarry, GroundMemberEnd, GroundFightRecord) live in model.ts since GO-7b
// (GroundTeamRun stores them; model.ts must not import this module, GO-7a review) and are re-exported here.
export type { GroundFightRecord, GroundMemberCarry, GroundMemberEnd } from "./model";

// ===== Pure helpers =====

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// Is `id` a battle status that PERSISTS past the battle: a battle status the medical bay cures (Poison,
// Bleed; Field Kits FKR-4 adds the bone line, Hemorrhage, Neurotoxin, Concussion and Blindness, which only a Field Kits
// run's fights inflict)? Own keys only, so "toString" is never one. Pure.
export function isCarriedStatus(id: string): boolean {
  return hasOwn(GROUND_CONDITIONS, id) && hasOwn(GAMBIT_STATUSES, id);
}

// The bay conditions on a team combatant at a battle's end: "health" when below max HP (a downed member
// always is), each remaining persisting status (isCarriedStatus) once, in status order, and "downed" when
// downed. Every id is a GROUND_CONDITIONS key. Pure.
// Field Kits FKR-6 (call 18, user 2026-10-17 "No Fracture bay time"): a Fracture healing from a Splint (SPLINT_HEAL_ROUNDS
// rounds left or fewer; an unsplinted one rides gambit.ts BONE_CONDITION_ROUNDS) is no bay condition: it still carries
// into the objective's next fight and heals there. Only a Field Kits run's fights inflict a Fracture.
export function memberEndConditions(c: Pick<GroundCombatant, "hp" | "hpMax" | "statuses" | "downed">): string[] {
  const out: string[] = [];
  if (c.downed || c.hp < c.hpMax) out.push("health");
  for (const s of c.statuses) {
    if (s.id === "fracture" && s.remaining <= SPLINT_HEAL_ROUNDS) continue;
    if (isCarriedStatus(s.id) && !out.includes(s.id)) out.push(s.id);
  }
  if (c.downed) out.push("downed");
  return out;
}

// The fight's private stream seed (see the module header). Pure.
export function taskFightSeed(exp: Pick<Expedition, "seed">, flatIndex: number, fightNumber: number): number {
  return (exp.seed ^ GROUND_FIGHT_SALT ^ Math.imul(flatIndex + 1, 0x9e3779b9) ^ Math.imul(fightNumber + 1, 0x85ebca6b)) >>> 0;
}

// How long a fight step lasts: its rounds fought times GROUND_ROUND_SECONDS, at least 1 second. Pure.
export function taskFightSeconds(record: Pick<GroundFightRecord, "rounds">): number {
  return Math.max(1, record.rounds * GROUND_ROUND_SECONDS);
}

// The carried statuses a member is fielded with: persisting ids only, a live duration and a finite
// magnitude, the first of each id kept, as fresh objects. Pure.
function carriedStatuses(statuses: readonly GroundStatus[] | undefined): GroundStatus[] {
  const out: GroundStatus[] = [];
  for (const s of statuses ?? []) {
    if (!isCarriedStatus(s.id) || !(s.remaining > 0) || !Number.isFinite(s.remaining) || !Number.isFinite(s.magnitude)) continue;
    if (out.some((o) => o.id === s.id)) continue;
    out.push({ id: s.id as GambitStatusId, magnitude: s.magnitude, remaining: s.remaining });
  }
  return out;
}

// The Security squad a task fight fields, as fresh combatants (buildRosterCombatants: the deploy-index ids
// and the crew-layer share stay as at dispatch, so a squadmate being out changes nobody's numbers). The
// teams' Security members, minus every team's downedThisTask; the crew layer = exp.securityStrength x the
// summed securityShare (a share that is not a positive number counts 0); the run's frozen officer care
// (Fleet Triage, Morale Anchor). Then the carry (user Q5): a member named in `carried` starts at its HP,
// clamped to [1, hpMax] (a standing member is never fielded at 0; a non-finite HP is ignored), with its
// persisting statuses only. GO-6's threat samples build their squads here too. Pure.
export function taskFightTeam(
  exp: Pick<Expedition, "id" | "roster" | "securityStrength" | "squadTriage" | "squadFearResist" | "squadHpBonus" | "squadDebuffResist" | "explorerCaptain" | "fieldKits">,
  teams: readonly GroundFightTeam[],
  task: Pick<ExpeditionActivity, "id" | "fightCount">,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
): GroundCombatant[] {
  const members = teamSnapshotMembers(exp.roster?.security, teams, (t) => t.securityIds);
  let share = 0;
  const out = new Set<string>();
  for (const t of teams) {
    if (t.securityShare > 0) share += t.securityShare;
    for (const id of t.downedThisTask ?? []) out.add(id);
  }
  const fightNumber = task.fightCount ?? 0;
  const team = buildRosterCombatants(members, (exp.securityStrength ?? 0) * share, `${exp.id}-${task.id}-f${fightNumber}`, out, {
    triage: exp.squadTriage,
    fearResist: exp.squadFearResist,
    // WR-5c: the captain's Away-Team Doctrine, frozen at dispatch (absent = unchanged).
    powerMult: exp.explorerCaptain?.squadPowerMult,
    // Complement plan CP-3: Away-Team Protection and Counter-Infiltration, frozen at dispatch (absent = unchanged).
    hpBonus: exp.squadHpBonus,
    debuffResist: exp.squadDebuffResist,
  });
  // Field Kits FKR-4: Stoneskin's battle half (a Field Kits run only; fieldKitsConditions.ts). FKR-5: the thrown
  // grenades with each member's charges left this objective (fieldKitsGrenades.ts), in place of their passive on-hit;
  // on a catalog 2 run (timed grenades, user 2026-10-21) the Stun and Toxin Grenades keep their fuse.
  // FKR-6: the Field Kits default program (N15) and each member's own kits (their free basics and extras left).
  if (fieldKitsLive(exp)) {
    withFieldKitsTeam(team, members);
    withThrownGrenades(team, members, teamCharges(teams), timedFusesLive(exp));
    withFieldKitsDefaultProgram(team);
    withFieldKitPacks(team, teamKitCounts(teams, (t) => t.basics), teamKitCounts(teams, (t) => t.kits));
  }
  if (!carried) return team;
  for (const c of team) {
    const id = c.memberId;
    if (id === undefined || !hasOwn(carried, id)) continue;
    const carry = carried[id];
    if (Number.isFinite(carry.hp)) c.hp = Math.min(c.hpMax, Math.max(1, carry.hp));
    c.statuses = carriedStatuses(carry.statuses);
  }
  return team;
}

// Field Kits FKR-5: the fight's charges left, merged over its teams (each member sits on one team). Undefined when no
// team carries a count, so every member starts with full charges. Pure.
function teamCharges(teams: readonly GroundFightTeam[]): Record<string, number> | undefined {
  let out: Record<string, number> | undefined;
  for (const t of teams) {
    if (!t.charges) continue;
    out = { ...(out ?? {}), ...t.charges };
  }
  return out;
}

// Field Kits FKR-6: one kind of the fight's kit counts (basics or extras), merged over its teams (each member sits on
// one team). Undefined when no team carries any. Pure.
function teamKitCounts(teams: readonly GroundFightTeam[], of: (t: GroundFightTeam) => MemberKitCounts | undefined): MemberKitCounts | undefined {
  let out: Record<string, Readonly<Partial<Record<FieldKitId, number>>>> | undefined;
  for (const t of teams) {
    const counts = of(t);
    if (!counts) continue;
    out = { ...(out ?? {}), ...counts };
  }
  return out;
}

// Squads SQ-4 (design 5.3): FLORA raises the Poison chance in a body's fights. Every guard's attack gains
// FLORA_POISON_PERMILLE_PER_GRADE x the flora grade: added to a poisoning guard's own chance (capped at certain), a
// guard with no on-hit affliction gains a Poison one, any other affliction is left as it is. No draw here; the
// battle's existing on-hit roll reads the chance. Flora 0 (every body of a run before SQ-4) returns the list
// untouched. Mutates the fresh guard list it is handed and returns it.
export function withFloraToxins(enemies: GroundCombatant[], flora: number): GroundCombatant[] {
  const add = flora > 0 ? FLORA_POISON_PERMILLE_PER_GRADE * flora : 0;
  if (!(add > 0)) return enemies;
  for (const e of enemies) {
    if (!e.statusOnHit) e.statusOnHit = { id: "poison", permille: Math.min(1000, add) };
    else if (e.statusOnHit.id === "poison") e.statusOnHit = { id: "poison", permille: Math.min(1000, e.statusOnHit.permille + add) };
  }
  return enemies;
}

// Wiring WR-10 (OC-F9, user 2026-10-15 "Some enemies cause it": certain enemy casters inflict Corroded): on a run stamped
// with the away rules (Expedition.awayRules) every CASTER in a guard carries a Corroded on its hits, CASTER_CORRODE_PERMILLE
// a landed hit, rolled after its own affliction (the onHitStatuses roll; Corroded cuts the target's armor, gambit.ts
// GAMBIT_STATUSES). A post-generation stamp (the withFloraToxins pattern): no draw here, and a guard without a caster is
// untouched. Mutates the fresh guard list it is handed and returns it. `permille` is the run's chance (casterCorrodePermille);
// at 0 nothing is stamped, so no roll is drawn and the guard is exactly the pre-WR-10 one.
// CASTER_CORRODE_PERMILLE is the chance at the top of the ramp (full strength, and every Tier II and higher run).
export const CASTER_CORRODE_PERMILLE = 300; // [PROVISIONAL]
export function withCorrodingCasters(enemies: GroundCombatant[], permille: number = CASTER_CORRODE_PERMILLE): GroundCombatant[] {
  if (!(permille > 0)) return enemies;
  for (const e of enemies) {
    if (e.role !== "caster") continue;
    e.onHitStatuses = [...(e.onHitStatuses ?? []), { id: "corroded", permille }];
  }
  return enemies;
}

// Wiring WR-10 fix round (OC-F9, user 2026-11-10 "Scale with the ramp (Recommended)": all casters can cause it, but the
// chance starts low on early runs and grows with difficulty, the way affixes and ambushes already do): the casters'
// Corroded chance a landed hit, in whole permille, at the odds ramp `oddsRamp` (runDifficulty.ts rampedChance, the same
// mechanism and the same lagged position as the affix roll and the ambush chance, groundOps.ts initGroundTasks).
// Exactly CASTER_CORRODE_PERMILLE at full strength; 0 on the first ramped runs (the odds ramp is 0 there). Pure.
export function casterCorrodePermille(oddsRamp: number): number {
  return Math.round(rampedChance(CASTER_CORRODE_PERMILLE, oddsRamp));
}

// The casters' Corroded chance on run `exp` (permille): its odds ramp through casterCorrodePermille (a run without a ramp
// stamp, and every Tier II and higher run, reads full strength). Pure.
export function runCasterCorrodePermille(exp: Pick<Expedition, "difficulty">): number {
  return casterCorrodePermille(runOddsRampOf(exp));
}

// Objective affixes (AF-1, Reinforcing; user 2026-10-14): an objective on ALERT escalates its fights. Per alert
// level the guard fields ESCALATION_ENEMIES_PER_LEVEL more enemies (copies of the generated guards in order, so the
// extra bodies fit the encounter's flavor, each with its own id in its group), and every enemy's damage takes the
// HEIGHTENED SENSES multiplier (affixes.ts escalationAt: the D23 curve, never capped). No draw here, so the fight's
// stream reads exactly as it would; level 0 (every fight of a run before AF-1, and any objective without an alert)
// returns the list untouched. Mutates the fresh guard list it is handed and returns it.
export function withEscalation(enemies: GroundCombatant[], alertLevel: number): GroundCombatant[] {
  const { extraEnemies, damageMult } = escalationAt(alertLevel);
  if (extraEnemies <= 0 || enemies.length === 0) return enemies;
  const base = enemies.length;
  const counts = new Map<string, number>();
  for (const e of enemies) counts.set(e.role, (counts.get(e.role) ?? 0) + 1);
  for (let k = 0; k < extraEnemies; k += 1) {
    const copy = structuredClone(enemies[k % base]);
    const n = (counts.get(copy.role) ?? 0) + 1;
    counts.set(copy.role, n);
    copy.id = `enemy-${copy.role}-${n}`;
    enemies.push(copy);
  }
  for (const e of enemies) {
    e.power *= damageMult;
    e.threat *= damageMult;
  }
  return enemies;
}

// Objective affixes (AF-2, Rocky Outcroppings; user 2026-10-14): COVER against long-range attacks. When either side
// has some, every combatant is stamped with its attack RANGE (a member from its worn weapon, gambit.ts
// memberWeaponRange, by its snapshot in `roster`; a guard by its role, ENEMY_ROLE_RANGE) and each covered side's
// combatants with their evasion (`cover.team` on the squad, `cover.enemy` on the guard; gambit.ts strikeHitChance
// reads it on the same single hit-check draw). No draw here. No cover (every fight of a run before AF-2, every
// objective without the affix) returns both lists untouched. Mutates the fresh lists it is handed.
export function withCover(
  team: GroundCombatant[],
  enemies: GroundCombatant[],
  cover: GroundCover | undefined,
  roster: readonly SnapshotMember[] | undefined,
): void {
  if (!hasCover(cover)) return;
  for (const c of team) {
    const member = c.memberId === undefined ? undefined : roster?.find((m) => m.memberId === c.memberId);
    c.range = member ? memberWeaponRange(member) : (c.range ?? "short");
    if (cover.team > 0) c.longRangeEvasion = cover.team;
  }
  for (const e of enemies) {
    if (Object.prototype.hasOwnProperty.call(ENEMY_ROLE_RANGE, e.role)) e.range = ENEMY_ROLE_RANGE[e.role as keyof typeof ENEMY_ROLE_RANGE];
    if (cover.enemy > 0) e.longRangeEvasion = cover.enemy;
  }
}

// ===== The fight =====

// Resolve ONE task fight for `teams` at the task's next fight point (see the module header). `flatIndex` is
// the task's flat index across the run's bodies (the reward seed's key too). `carried` = the previous fight's
// memberEnd within this task (absent: everyone starts at full HP). `logSink`, when passed, gets the battle's
// display-only events appended; it never changes the record. With nobody left to field there is no battle and
// no draw: a loss of 0 rounds with nothing recorded (GO-7b sends the team home). `alertLevel` = the objective's
// alert when the fight starts (objective affixes, AF-1: withEscalation; 0 = none). `cover` = the objective's cover
// against long-range attacks (AF-2, Rocky Outcroppings: affixes.ts longRangeCover; absent = none). `kind` = where the
// fight sits in the objective (Field Kits FKR-1, enemy ranks: a fight point, a surprise fight or a reinforcement
// fight; only a ranked run reads it). Pure; mints fresh combatants and never mutates its inputs.
export function resolveTaskFight(
  exp: Expedition,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: RankedFightTask,
  flatIndex: number,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  logSink?: GambitLogEvent[],
  alertLevel = 0,
  cover?: GroundCover,
  kind: RankedFightKind = "point",
): GroundFightRecord {
  // GEAR WEAR step 4: a battle-stamped run records each member's armor wear on the fight (GroundFightRecord.armorWear).
  const armorWear = exp.gearWear?.battle === 1;
  return resolveTaskFightOnSeed(exp, teams, body, task, taskFightSeed(exp, flatIndex, task.fightCount ?? 0), carried, logSink, alertLevel, cover, kind, armorWear);
}

// The task fields a fight reads: its stream keys and site, plus (Field Kits FKR-1, ranked runs only) its stamped grade
// and fight points, which place its ranks.
export type RankedFightTask = Pick<ExpeditionActivity, "id" | "poiId" | "fightCount" | "pointsCleared" | "difficulty" | "fightPoints">;

// Every Expedition field a task fight reads once its seed is chosen: the squad (taskFightTeam), the guard's
// hazard (the museum resist), the team kit and (Field Kits FKR-1) the enemy ranks flag with the training run stamp
// (enemyRanks.ts isTrainingRun reads `difficulty`). groundThreat.ts keys its memo on exactly these, so a new read here
// must widen this type first (TypeScript then flags the memo's key list until it is listed too).
export type TaskFightExp = Pick<
  Expedition,
  | "id"
  | "roster"
  | "securityStrength"
  | "squadTriage"
  | "squadFearResist"
  | "squadHpBonus"
  | "squadDebuffResist"
  | "hazardResist"
  | "teamKit"
  | "enemyRanks"
  | "difficulty"
  | "explorerCaptain"
  | "fieldKits"
  | "awayRules"
>;

// THE GUARD a task fight fields on a given stream seed, as fresh combatants: generateEncounter on the body's hazard
// after the museum resist, the flora toxins, the alert's escalation and (Field Kits FKR-1, a ranked run only) the
// enemy ranks. resolveTaskFightOnSeed fields exactly this list; the wiring probe reads it (the ranks' HP and power on a
// real fight). Safe first runs SF-2: a TRAINING RUN's guard reads hazard 0 and the training profile (runDifficulty.ts:
// one enemy at FIRST_RUN_ENEMY_SCALE of its strength; same seed, same draws); every other run's guard is exactly as
// before. Pure.
export function taskFightGuard(
  exp: Pick<TaskFightExp, "hazardResist" | "enemyRanks" | "difficulty" | "fieldKits"> & Partial<Pick<TaskFightExp, "awayRules">>,
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: RankedFightTask,
  seed: number,
  alertLevel = 0,
  kind: RankedFightKind = "point",
): GroundCombatant[] {
  const training = isTrainingRun(exp);
  const ramped = rampedStampOf(exp);
  const resisted = resistedHazard(body.hazard, exp.hazardResist ?? 0);
  const hazard = training ? 0 : ramped ? encounterHazard(resisted, ramped.tier) : resisted;
  const base = curveBaseRank(exp);
  const profile = training ? { scale: FIRST_RUN_ENEMY_SCALE, maxEnemies: FIRST_RUN_MAX_ENEMIES } : ramped ? rampedProfile(ramped.ramp) : undefined;
  const enemies = withEscalation(withFloraToxins(generateEncounter(seed, hazard, task.poiId, profile), bodyFloraGrade(body)), alertLevel);
  if (ranksLive(exp)) withEnemyRanks(enemies, fightLeadRank(fightRankContext(exp, task, task.fightPoints?.length ?? 0, kind)), base, curveBaseFactor(exp));
  // Field Kits FKR-4: the enemy inflictors, last (a Field Kits run only; fieldKitsConditions.ts; no draw).
  // Safe first runs (OC-1 "no lost fights"): a training run's guards carry no Field Kits inflictors (with kits switched
  // on, FKR-9 / FKR-10, the inflicted conditions cost the D18 minimum crew a fight on 2 of 500 seeds per explorer).
  if (fieldKitsLive(exp) && !training) withFieldKitsGuard(enemies, { grade: task.difficulty, poiId: task.poiId });
  // Wiring WR-10 (OC-F9): the casters' Corroded, last (no draw). Like the Field Kits inflictors, never on a training run.
  // The fix round (user 2026-11-10 "Scale with the ramp"): its chance climbs the odds ramp (runCasterCorrodePermille).
  if (exp.awayRules === 1 && !training) withCorrodingCasters(enemies, runCasterCorrodePermille(exp));
  return enemies;
}

// Safe first runs SF-3: an ordinary run's guard profile on the curve: the curve's enemy strength (runDifficulty.ts
// rampEnemyScale), no enemy cap. The ranks multiply after it (enemyRanks.ts: the faded Weak factor on unled enemies).
// Full strength reads no profile at all (the guard exactly as before). Pure.
function rampedProfile(ramp: number): EncounterProfile | undefined {
  const scale = rampEnemyScale(ramp);
  return scale < 1 ? { scale, maxEnemies: null } : undefined;
}

// THE fight body on a given stream seed. resolveTaskFight passes the real fight's keyed seed (above); the
// threat indicator (groundThreat.ts, GO-6) passes its OWN salted sample seeds, so its samples field the same
// squad and the same guard rules as a real fight while never touching a real fight's stream. Engine code
// resolves a real fight through resolveTaskFight only. Field Kits FKR-1: on a RANKED run (enemyRanks.ts ranksLive)
// the guard's ranks are placed AFTER the generation, the flora toxins and the escalation (enemyRanks.ts
// withEnemyRanks; no draw), and the record lists every enemy not Normal; an unranked run never calls it. Pure; never
// mutates its inputs.
export function resolveTaskFightOnSeed(
  exp: TaskFightExp,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: RankedFightTask,
  seed: number,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  logSink?: GambitLogEvent[],
  alertLevel = 0,
  cover?: GroundCover,
  kind: RankedFightKind = "point",
  // GEAR WEAR step 4: record each member's armor wear (a battle-stamped run's real fight; never a threat sample).
  armorWear = false,
): GroundFightRecord {
  const fightNumber = task.fightCount ?? 0;
  const pointIndex = task.pointsCleared ?? 0;
  const team = taskFightTeam(exp, teams, task, carried);
  if (team.length === 0) {
    return { pointIndex, fightNumber, outcome: "loss", rounds: 0, downedMemberIds: [], memberConditions: {}, memberEnd: {} };
  }
  const enemies = taskFightGuard(exp, body, task, seed, alertLevel, kind);
  withCover(team, enemies, cover, exp.roster?.security);
  // GEAR WEAR step 4 (design 3.2 "member armor: hits on the wearer"): each member's hp as the fight opens.
  const startHp = armorWear ? new Map(team.map((c) => [c.memberId, c.hp] as const)) : null;
  // Field Kits FKR-6: a Field Kits run's battle spends each member's own kits (the team kit is never read there).
  // Wiring WR-10: a run stamped with the away rules fights under them (Neural Backup's wearer, Fall Back's shield).
  const result = resolveGroundBattle(team, enemies, exp.teamKit, makeRng(seed), logSink, seed, fieldKitsLive(exp) ? FIELD_KITS_BATTLE : undefined, exp.awayRules === 1);

  // resolveGroundBattle reports the 0-based round a fight ENDED in (or MAX_ROUNDS at the cap, after
  // MAX_ROUNDS full rounds); the record counts rounds fought.
  const rounds = result.rounds >= MAX_ROUNDS ? MAX_ROUNDS : result.rounds + 1;
  const memberConditions: Record<string, string[]> = {};
  const memberEnd: Record<string, GroundMemberEnd> = {};
  for (const c of team) {
    if (c.memberId === undefined) continue;
    const conds = memberEndConditions(c);
    if (conds.length > 0) memberConditions[c.memberId] = conds;
    if (!c.downed) memberEnd[c.memberId] = { hp: c.hp, hpMax: c.hpMax, statuses: carriedStatuses(c.statuses) };
  }
  const record: GroundFightRecord = {
    pointIndex,
    fightNumber,
    outcome: result.result,
    rounds,
    downedMemberIds: [...result.downedMemberIds],
    memberConditions,
    memberEnd,
  };
  if (result.neuralBackup) record.neuralBackup = { ...result.neuralBackup };
  // Field Kits FKR-5: the charges each member threw (a Field Kits run's fight in which someone threw, only).
  if (result.chargesUsed) record.chargesUsed = { ...result.chargesUsed };
  // Field Kits FKR-6: the kits each member spent and the Injury Kit shares (a Field Kits run's fight where it happened).
  if (result.basicsUsed) record.basicsUsed = structuredClone(result.basicsUsed);
  if (result.kitsUsed) record.kitsUsed = structuredClone(result.kitsUsed);
  if (result.treated) record.treated = { ...result.treated };
  const ranks = rankedEnemies(enemies);
  if (ranks) record.ranks = ranks;
  // GEAR WEAR step 4: the raw armor wear (gearWear.ts battleWearRaw memberArmor:hpLost) of each member who lost hp:
  // the hp they lost (all of it when downed) over their hp max. Written only when some member lost hp.
  if (startHp) {
    const armor: Record<string, number> = {};
    for (const c of team) {
      if (c.memberId === undefined) continue;
      const lost = (startHp.get(c.memberId) ?? c.hpMax) - (c.downed ? 0 : Math.max(0, c.hp));
      const raw = battleWearRaw("memberArmor:hpLost", lost, c.hpMax);
      if (raw > 0) armor[c.memberId] = raw;
    }
    if (Object.keys(armor).length > 0) record.armorWear = armor;
  }
  return record;
}
