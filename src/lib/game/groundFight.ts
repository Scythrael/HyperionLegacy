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
//     officer stats off ground-team fights).
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
// seed (gambit.ts NEURAL_BACKUP_SALT), never a draw on the fight's. Never the legacy COMBAT_SALT stream and
// never a shared one. The result reads only the stored run and the arguments, so offline == live.
//
// Module graph: model (types), combat/rng, gambit, medicalBay, relics, groundTasks; never expedition.ts.

import type { Expedition, ExpeditionActivity, ExpeditionBody, GambitStatusId } from "./model";
import { makeRng } from "./combat/rng";
import {
  GAMBIT_STATUSES,
  MAX_ROUNDS,
  buildRosterCombatants,
  generateEncounter,
  resolveGroundBattle,
  type GambitLogEvent,
  type GroundCombatant,
  type GroundStatus,
} from "./gambit";
import { GROUND_CONDITIONS } from "./medicalBay";
import { resistedHazard } from "./relics";
import { teamSnapshotMembers } from "./groundTasks";

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
}

// One member's state carried into a fight (user Q5): HP and the persisting statuses.
export interface GroundMemberCarry {
  hp: number;
  statuses: readonly GroundStatus[];
}

// One standing member's state at the end of a fight: the carry for the task's next fight, plus the max HP
// for display ("72 / 90"). A GroundFightRecord's memberEnd passes straight in as the next fight's carry.
export interface GroundMemberEnd extends GroundMemberCarry {
  hpMax: number;
  statuses: GroundStatus[];
}

export interface GroundFightRecord {
  pointIndex: number; // the fight point fought for (the task's pointsCleared at the start)
  fightNumber: number; // the task's fightCount at the start: the stream key
  outcome: "win" | "loss";
  rounds: number; // rounds FOUGHT (0 only when nobody could be fielded)
  downedMemberIds: string[]; // the named members down at the end, combatant order
  // memberId -> the bay conditions at the battle's end (GROUND_CONDITIONS ids only, see memberEndConditions).
  // A member with none is left out.
  memberConditions: Record<string, string[]>;
  // memberId -> end state of every member still STANDING (user Q5 carry damage; GO-7b threads it into the
  // task's next fight). A downed member is left out: they sit out the rest of the task.
  memberEnd: Record<string, GroundMemberEnd>;
  neuralBackup?: { memberId?: string; revived: boolean };
}

// ===== Pure helpers =====

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// Is `id` a battle status that PERSISTS past the battle: a battle status the medical bay cures (Poison,
// Bleed today; Field Kits 16b adds more)? Own keys only, so "toString" is never one. Pure.
export function isCarriedStatus(id: string): boolean {
  return hasOwn(GROUND_CONDITIONS, id) && hasOwn(GAMBIT_STATUSES, id);
}

// The bay conditions on a team combatant at a battle's end: "health" when below max HP (a downed member
// always is), each remaining persisting status (isCarriedStatus) once, in status order, and "downed" when
// downed. Every id is a GROUND_CONDITIONS key. Pure.
export function memberEndConditions(c: Pick<GroundCombatant, "hp" | "hpMax" | "statuses" | "downed">): string[] {
  const out: string[] = [];
  if (c.downed || c.hp < c.hpMax) out.push("health");
  for (const s of c.statuses) if (isCarriedStatus(s.id) && !out.includes(s.id)) out.push(s.id);
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
  exp: Pick<Expedition, "id" | "roster" | "securityStrength" | "squadTriage" | "squadFearResist">,
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
  });
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

// ===== The fight =====

// Resolve ONE task fight for `teams` at the task's next fight point (see the module header). `flatIndex` is
// the task's flat index across the run's bodies (the reward seed's key too). `carried` = the previous fight's
// memberEnd within this task (absent: everyone starts at full HP). `logSink`, when passed, gets the battle's
// display-only events appended; it never changes the record. With nobody left to field there is no battle and
// no draw: a loss of 0 rounds with nothing recorded (GO-7b sends the team home). Pure; mints fresh combatants
// and never mutates its inputs.
export function resolveTaskFight(
  exp: Expedition,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard">,
  task: Pick<ExpeditionActivity, "id" | "poiId" | "fightCount" | "pointsCleared">,
  flatIndex: number,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  logSink?: GambitLogEvent[],
): GroundFightRecord {
  return resolveTaskFightOnSeed(exp, teams, body, task, taskFightSeed(exp, flatIndex, task.fightCount ?? 0), carried, logSink);
}

// Every Expedition field a task fight reads once its seed is chosen: the squad (taskFightTeam), the guard's
// hazard (the museum resist) and the team kit. groundThreat.ts keys its memo on exactly these, so a new read
// here must widen this type first (TypeScript then flags the memo's key list until it is listed too).
export type TaskFightExp = Pick<
  Expedition,
  "id" | "roster" | "securityStrength" | "squadTriage" | "squadFearResist" | "hazardResist" | "teamKit"
>;

// THE fight body on a given stream seed. resolveTaskFight passes the real fight's keyed seed (above); the
// threat indicator (groundThreat.ts, GO-6) passes its OWN salted sample seeds, so its samples field the same
// squad and the same guard rules as a real fight while never touching a real fight's stream. Engine code
// resolves a real fight through resolveTaskFight only. Pure; never mutates its inputs.
export function resolveTaskFightOnSeed(
  exp: TaskFightExp,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard">,
  task: Pick<ExpeditionActivity, "id" | "poiId" | "fightCount" | "pointsCleared">,
  seed: number,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  logSink?: GambitLogEvent[],
): GroundFightRecord {
  const fightNumber = task.fightCount ?? 0;
  const pointIndex = task.pointsCleared ?? 0;
  const team = taskFightTeam(exp, teams, task, carried);
  if (team.length === 0) {
    return { pointIndex, fightNumber, outcome: "loss", rounds: 0, downedMemberIds: [], memberConditions: {}, memberEnd: {} };
  }
  const enemies = generateEncounter(seed, resistedHazard(body.hazard, exp.hazardResist ?? 0), task.poiId);
  const result = resolveGroundBattle(team, enemies, exp.teamKit, makeRng(seed), logSink, seed);

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
  return record;
}
