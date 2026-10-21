// groundTaskQueueDisplay.ts: the display decisions of the per-planet TASK QUEUE screen (0.14.0, Ground Operations
// GO-13, mockup GO-M2) and its task cards (Squads design section 7.3, mockup section 4).
//
// WHY a .ts beside GroundTaskQueue.svelte: this repo has no Svelte component test harness, so every choice worth
// gating (which status a task reads, which crews a row offers, what a requirement chip says, when the odds are
// read) lives here as pure functions over the tested engine, and the component only draws them. No game rule
// lives here: needs, crews, the stuck predicates, the threat read and every edit are the engine's (groundOps.ts,
// expedition.ts editGroundOps).
//
// THE ODDS (GO-6 threat, design 3.6). One column per deployed team: the tier of that team ALONE on the task, fresh
// (full HP, nobody sitting out), or "Needs a partner" when its squads cannot cover the task alone. A row whose
// crew is a JOINT crew also shows that crew's tier on its card. Every read goes through a display memo keyed by
// (expedition, task, crew, pointsCleared, fightCount): the fresh read depends on nothing else that changes during
// a run (the roster, the crew layers and the body are frozen at dispatch), so a tick never re-reads a cell.

import type { Expedition, ExpeditionActivity, ExpeditionBody, GroundTaskNeeds, GroundTeamKind, GroundTeamRun, ShipInstance } from "./game/model";
import {
  GROUND_OPS_STUCK_TEXT,
  crewSquadsOf,
  groundCrewThreat,
  groundOpsStuck,
  groundTaskCrewOptions,
  groundTaskCrews,
  groundTaskProgressAt,
  groundTaskStuck,
  groundTeamStuck,
  squadsCover,
  taskNeedsOf,
  teamSquadsOf,
  type GroundOpsEdit,
} from "./game/groundOps";
import { DEFAULT_GROUND_TEAM_KIND, isGroundTeamKind, teamKindName } from "./game/groundComposition";
import { groundTeamDefaultName, groundTeamName, groundTeamShortLabel } from "./game/groundTeams";
import { getPlanetTypeById, groundSiteLabel } from "./game/expeditionContent";
import { DIFFICULTY_NAMES, difficultyName, difficultyWeight, storedDifficulty } from "./game/riskFactors";
import type { ThreatAssessment } from "./game/combat/threatAssessment";
import { bodyLetter } from "./game/starCatalog";
import { objectiveAffixesView, type ObjectiveAffixesView } from "./objectiveAffixDisplay";

// ===== Fixed words (the user's, where quoted in the plan) =====

export const GROUND_QUEUE_NOTE = "Nothing ever waits for you; reorder, reassign or skip at any time.";
export const DEFAULT_PLAN_LABEL = "Default plan";
export const AUTO_ASSIGN_LABEL = "Auto-assign randomly"; // the user's words
export const NEEDS_PARTNER_TEXT = "Needs a partner";
export const NO_FIGHTS_TEXT = "No fights expected";
export const STUCK_HINT = "Skip a stuck objective and the rest of the run carries on.";
export const QUEUE_EMPTY_TEXT = "Objectives appear here as each body's scan finishes.";
// The LARGER crew's trade-off in the crew select (user 2026-10-14: "They'd sacrifice speed from only having one team
// that can do it"): the crew pools its squads but works one objective at a time.
export const LARGER_CREW_COST = "one objective at a time";

// ===== Small words =====

const ROMAN: readonly string[] = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

// A body's numeral by position (1 = I), the astronomer's way of naming a system's bodies. Pure.
export function bodyNumeral(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

// A body's designation within its run: Expedition Tiers G2-2 names a run's bodies from the star catalog's way, b, c,
// d (starCatalog.ts bodyLetter; the run carries its region stamp); a run dispatched before G2-2 keeps its Roman
// numerals. Pure.
export function bodyDesignation(exp: Pick<Expedition, "region">, index: number): string {
  return exp.region ? bodyLetter(index) : bodyNumeral(index);
}

// "1st", "2nd", "3rd", "4th", "11th", "22nd". Pure.
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ===== Teams =====

export interface QueueTeamColumn {
  index: number; // ship team index (0 = Alpha)
  letter: string; // A / B / C by position
  name: string; // the ship's name for the team (groundTeamName), else the default
  kind: GroundTeamKind;
  kindName: string; // "Strike"
  oddsContext: string; // the odds chip's accessible-name prefix: "Alpha odds"
}

function runKind(team: Pick<GroundTeamRun, "kind">): GroundTeamKind {
  return isGroundTeamKind(team.kind) ? team.kind : DEFAULT_GROUND_TEAM_KIND;
}

// The name a deployed team reads by: the ship's current name for that slot (renaming works while out), else the
// default by index. Pure.
export function runTeamName(ship: ShipInstance | null | undefined, index: number): string {
  return ship ? groundTeamName(ship, index) : groundTeamDefaultName(index);
}

// The deployed teams as table columns, ascending team index. Pure.
export function queueTeamColumns(exp: Pick<Expedition, "groundOps">, ship: ShipInstance | null | undefined): QueueTeamColumn[] {
  return (exp.groundOps?.teams ?? []).map((team) => {
    const name = runTeamName(ship, team.index);
    const kind = runKind(team);
    return { index: team.index, letter: groundTeamShortLabel(team.index), name, kind, kindName: teamKindName(kind), oddsContext: `${name} odds` };
  });
}

// A crew as words: "Alpha", "Alpha + Bravo". Pure.
export function crewText(ship: ShipInstance | null | undefined, crew: readonly number[]): string {
  return crew.map((i) => runTeamName(ship, i)).join(" + ");
}

// A crew's select value: "0", "0+1". Pure.
export function crewKey(crew: readonly number[]): string {
  return crew.join("+");
}

// The crew a select value names (whole team indices), or null for a corrupt value. Pure.
export function crewFromKey(key: string): number[] | null {
  if (key === "") return null;
  const parts = key.split("+").map((p) => Number(p));
  return parts.every((n) => Number.isInteger(n) && n >= 0) ? parts : null;
}

// ===== Needs (design 3.2, the team-type phrasing) =====

export interface NeedChip {
  type: "security" | "science";
  count: number;
  text: string; // "2 Security squads"
  met: boolean; // the deployed squads, summed, bring at least this many of the type
}

export interface TaskNeedsView {
  chips: NeedChip[];
  phrase: string; // "Strike team", "1 Science squad (Survey or Ground)"
  covered: boolean; // some crew of the deployed teams covers it
  coverText: string; // "Bravo (Strike) + Alpha (Ground)", or why nobody can
}

// The needs in the team-type phrasing of design 3.2 (and the squads mockup, section 4) [PROPOSAL wording], else a
// plain count. Pure.
export function needsPhrase(needs: GroundTaskNeeds): string {
  const { security: s, science: c } = needs;
  if (s === 0 && c === 0) return "No squads";
  if (s === 1 && c === 1) return "Ground team (or Strike + Survey together)";
  if (s === 2 && c === 0) return "Strike team";
  if (s === 0 && c === 2) return "Survey team";
  if (s === 0 && c === 1) return "1 Science squad (Survey or Ground)";
  if (s === 1 && c === 0) return "1 Security squad (Strike or Ground)";
  if (s === 1 && c === 2) return "Ground + a Science squad (Survey + Ground, or 2 Ground)";
  if (s === 2 && c === 1) return "Strike + Ground, or 2 Ground teams";
  if (s === 4 && c === 0) return "2 Strike teams";
  const parts: string[] = [];
  if (s > 0) parts.push(plural(s, "Security squad", "Security squads"));
  if (c > 0) parts.push(plural(c, "Science squad", "Science squads"));
  return parts.join(" + ");
}

// The requirement chips, the phrase and who covers it. `crew` is the row's crew (assignedTeamIds) when it covers
// the needs; else the first of the smallest covering crews; else the shortfall is said plainly. Pure.
export function taskNeedsView(
  exp: Pick<Expedition, "groundOps" | "bodies">,
  ship: ShipInstance | null | undefined,
  task: ExpeditionActivity,
): TaskNeedsView {
  const needs = taskNeedsOf(task);
  const teams = exp.groundOps?.teams ?? [];
  const deployed = crewSquadsOf(teams);
  const chips: NeedChip[] = [];
  if (needs.security > 0)
    chips.push({ type: "security", count: needs.security, text: plural(needs.security, "Security squad", "Security squads"), met: deployed.security >= needs.security });
  if (needs.science > 0)
    chips.push({ type: "science", count: needs.science, text: plural(needs.science, "Science squad", "Science squads"), met: deployed.science >= needs.science });
  const own = task.assignedTeamIds ?? [];
  const ownTeams = teams.filter((t) => own.includes(t.index));
  const crew =
    ownTeams.length > 0 && squadsCover(crewSquadsOf(ownTeams), needs) ? ownTeams.map((t) => t.index) : (groundTaskCrews(exp, task.id)[0] ?? null);
  if (crew === null) {
    const short: string[] = [];
    if (deployed.security < needs.security) short.push(`${plural(needs.security, "Security squad", "Security squads")}, ${deployed.security} deployed`);
    if (deployed.science < needs.science) short.push(`${plural(needs.science, "Science squad", "Science squads")}, ${deployed.science} deployed`);
    return { chips, phrase: needsPhrase(needs), covered: false, coverText: `No deployed crew covers it: needs ${short.join("; ")}` };
  }
  const coverText = crew
    .map((i) => {
      const team = teams.find((t) => t.index === i);
      return `${runTeamName(ship, i)} (${teamKindName(team ? runKind(team) : DEFAULT_GROUND_TEAM_KIND)})`;
    })
    .join(" + ");
  return { chips, phrase: needsPhrase(needs), covered: true, coverText };
}

// ===== Difficulty (design section 4) =====

export interface DifficultyView {
  grade: number; // 1..5
  name: string; // "Challenging"
  pips: boolean[]; // five, lit up to the grade
  weightText: string; // "counts x3 toward completion"
  ariaLabel: string; // "Difficulty 3 of 5, Challenging, counts x3 toward completion"
}

// The task's stored grade as pips + name + completion weight, or null for an unrated task (a run before SQ-4). Pure.
export function difficultyView(task: Pick<ExpeditionActivity, "difficulty">): DifficultyView | null {
  const grade = storedDifficulty(task.difficulty);
  const name = difficultyName(task.difficulty);
  if (grade === null || name === null) return null;
  const weightText = `counts x${difficultyWeight(task.difficulty)} toward completion`;
  return {
    grade,
    name,
    pips: DIFFICULTY_NAMES.map((_, i) => i < grade),
    weightText,
    ariaLabel: `Difficulty ${grade} of ${DIFFICULTY_NAMES.length}, ${name}, ${weightText}`,
  };
}

// ===== The fight-point bar (GO-M2 / GO-M4) =====

export interface FightBarView {
  total: number;
  cleared: number;
  pips: { at: number; won: boolean }[]; // at = percent along the bar
  progressPct: number; // 0..100, interpolated along a work step in progress
  label: string; // "1 of 3 fights won" | "No fights expected"
  fightsText: string; // the Fights column: "1 / 3" | "None"
  ariaLabel: string;
}

// A whole percent. Pure.
function pct(frac: number): number {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * 100);
}

// The bar: one pip per fight point (won ones marked), the progress so far. Pure.
export function fightBarView(exp: Pick<Expedition, "groundOps">, task: ExpeditionActivity, now: number): FightBarView {
  const points = task.fightPoints ?? [];
  const total = points.length;
  const cleared = Math.max(0, Math.min(total, task.pointsCleared ?? 0));
  const progressPct = task.done || task.status === "done" ? 100 : pct(groundTaskProgressAt(exp, task, now));
  const label = total === 0 ? NO_FIGHTS_TEXT : `${cleared} of ${plural(total, "fight", "fights")} won`;
  return {
    total,
    cleared,
    pips: points.map((at, i) => ({ at: pct(at), won: i < cleared })),
    progressPct,
    label,
    fightsText: total === 0 ? "None" : `${cleared} / ${total}`,
    ariaLabel: `${progressPct}% done, ${label}`,
  };
}

// ===== Status =====

export type QueueTaskStatus = "queued" | "active" | "done" | "skipped" | "sentBack" | "stuck";

export const QUEUE_STATUS_TEXT: Record<QueueTaskStatus, string> = {
  queued: "Queued",
  active: "Active",
  done: "Done",
  skipped: "Skipped",
  sentBack: "Sent back",
  stuck: "Stuck",
};

// What the crew on an active task is doing (its lead's step), or null. Pure.
function stepWords(step: GroundTeamRun["step"]): string | null {
  switch (step) {
    case "staging":
      return "gathering the crew";
    case "deploy":
      return "dropping to the surface";
    case "work":
      return "working";
    case "fight":
      return "fighting";
    default:
      return null;
  }
}

// The teams whose queue holds the task (its crew, in team order). Pure.
function queueHolders(exp: Pick<Expedition, "groundOps">, taskId: string): GroundTeamRun[] {
  return (exp.groundOps?.teams ?? []).filter((t) => t.queue.includes(taskId));
}

// A task's status on the queue screen: done and skipped as stored; ACTIVE while a crew is on it; STUCK when it hit
// the loss streak (groundTaskStuck) and every team holding it has nothing else left (groundTeamStuck: the run is
// waiting on it); SENT BACK when it hit the streak but easier work remains (back of the line, user GO-7b answers);
// else QUEUED. Pure.
export function queueTaskStatus(exp: Pick<Expedition, "groundOps" | "bodies">, task: ExpeditionActivity): QueueTaskStatus {
  if (task.done || task.status === "done") return "done";
  if (task.status === "skipped") return "skipped";
  if (task.status === "active") return "active";
  if (groundTaskStuck(task)) {
    const holders = queueHolders(exp, task.id);
    return holders.length > 0 && holders.every((t) => groundTeamStuck(exp, t)) ? "stuck" : "sentBack";
  }
  return "queued";
}

// The status's second line: what the crew is doing, why it was sent back, an ambush. Pure.
export function queueStatusDetail(
  exp: Pick<Expedition, "groundOps">,
  ship: ShipInstance | null | undefined,
  task: ExpeditionActivity,
  status: QueueTaskStatus,
): string | null {
  const parts: string[] = [];
  if (status === "active") {
    const lead = (exp.groundOps?.teams ?? []).find((t) => t.taskId === task.id && stepWords(t.step) !== null);
    if (lead) parts.push(`${runTeamName(ship, lead.index)} ${stepWords(lead.step)}`);
  }
  if (status === "sentBack") parts.push("3 losses in a row: back of the line");
  if (status === "stuck") parts.push(GROUND_OPS_STUCK_TEXT);
  const ambushes = task.ambushes ?? 0;
  if (ambushes > 0 && status !== "done") parts.push(ambushes === 1 ? "Ambushed once" : `Ambushed ${ambushes} times`);
  return parts.length > 0 ? parts.join(". ") : null;
}

// ===== The odds cells (memoized) =====

export type CrewThreatReader = (exp: Expedition, crew: readonly number[], taskId: string) => ThreatAssessment | null;

export interface OddsMemo {
  get(exp: Expedition, crew: readonly number[], task: ExpeditionActivity): ThreatAssessment | null;
  reads(): number; // how many times the reader ran (the tests and the preview check)
}

export const ODDS_MEMO_SIZE = 512;

// A bounded display memo over the crew threat read, keyed by (expedition, task, crew, pointsCleared, fightCount).
// Least recently used goes first. Pure apart from its own map.
export function createOddsMemo(reader: CrewThreatReader = groundCrewThreat, size = ODDS_MEMO_SIZE): OddsMemo {
  const memo = new Map<string, ThreatAssessment | null>();
  let reads = 0;
  return {
    get(exp, crew, task) {
      const key = JSON.stringify([exp.id, task.id, crew, task.pointsCleared ?? 0, task.fightCount ?? 0]);
      if (memo.has(key)) {
        const hit = memo.get(key) ?? null;
        memo.delete(key);
        memo.set(key, hit);
        return hit;
      }
      reads += 1;
      const value = reader(exp, crew, task.id);
      if (memo.size >= size) {
        const oldest = memo.keys().next().value;
        if (oldest !== undefined) memo.delete(oldest);
      }
      memo.set(key, value);
      return value;
    },
    reads: () => reads,
  };
}

export type OddsCell =
  | { kind: "chip"; assessment: ThreatAssessment; context: string }
  | { kind: "partner"; text: string }
  | { kind: "none"; text: string };

// One team's odds on a task: its tier alone, "Needs a partner" when its squads cannot cover the task alone, or a
// plain dash for a task that is done or skipped (nothing left to fight). Reads through the memo. Pure in effect.
export function oddsCell(exp: Expedition, column: QueueTeamColumn, task: ExpeditionActivity, status: QueueTaskStatus, memo: OddsMemo): OddsCell {
  if (status === "done" || status === "skipped") return { kind: "none", text: "-" };
  const team = exp.groundOps?.teams.find((t) => t.index === column.index);
  if (!team || !squadsCover(teamSquadsOf(team), taskNeedsOf(task))) return { kind: "partner", text: NEEDS_PARTNER_TEXT };
  const assessment = memo.get(exp, [column.index], task);
  return assessment ? { kind: "chip", assessment, context: column.oddsContext } : { kind: "none", text: "-" };
}

// ===== Assigned (crew select) and the queue position =====

export interface CrewOption {
  key: string; // crewKey
  label: string; // the select's words: "Alpha", "Alpha + Bravo (joint)", "Alpha + Bravo (doubled)"
  crew: string; // the crew alone: "Alpha + Bravo" (the result line)
  teamIndex: number; // the crew's lead (the edit's teamIndex)
  partners: number[]; // the rest (the edit's partners)
  larger: boolean; // a LARGER crew than the smallest covering one (the player's choice; the plan never picks it)
  note: string | null; // a larger crew's trade-off, shown under the select: "Doubled crew: more punch, one objective at a time."
}

// The word of a LARGER crew: "doubled" when it is twice the smallest covering crew's size (both Ground teams on a
// Ground team's objective), else "larger crew". Pure.
export function largerCrewWord(size: number, smallest: number): string {
  return size === smallest * 2 ? "doubled" : "larger crew";
}

// What a LARGER crew trades (user 2026-10-14): what the extra squads bring (Security past the needs: "more
// punch", every Security squad on one fight side; Science past the needs: "more fieldwork", every Science squad's
// fieldwork summed), then the cost. "more punch and more fieldwork, one objective at a time". Pure.
export function largerCrewNote(squads: GroundTaskNeeds, needs: GroundTaskNeeds): string {
  const gains: string[] = [];
  if (squads.security > needs.security) gains.push("more punch");
  if (squads.science > needs.science) gains.push("more fieldwork");
  return `${gains.length > 0 ? `${gains.join(" and ")}, ` : ""}${LARGER_CREW_COST}`;
}

// The crews a row offers (AF-1, user 2026-10-14: larger joint crews): the smallest covering crews first
// (groundTaskCrewOptions `larger: false`, GO-13's choices: joint ones read "(joint)"), then every LARGER covering
// crew ("Alpha + Bravo (doubled)", its trade-off in `note`: "Doubled crew: more punch, one objective at a time.";
// the crew pools its squads but works one objective at a time), plus the row's current crew when it is not among
// them, so the select always shows what is set. The select's words stay short (the table keeps its width); the
// screen shows the note under the select while a larger crew is picked or set. Pure.
export function crewOptions(exp: Pick<Expedition, "groundOps" | "bodies">, ship: ShipInstance | null | undefined, task: ExpeditionActivity): CrewOption[] {
  const crews = groundTaskCrewOptions(exp, task.id).map((c) => ({ teams: [...c.teams], larger: c.larger }));
  const own = (task.assignedTeamIds ?? []).filter((i) => (exp.groundOps?.teams ?? []).some((t) => t.index === i));
  if (own.length > 0 && !crews.some((c) => crewKey(c.teams) === crewKey([...own].sort((a, b) => a - b)))) {
    const ownTeams = (exp.groundOps?.teams ?? []).filter((t) => own.includes(t.index));
    if (squadsCover(crewSquadsOf(ownTeams), taskNeedsOf(task))) crews.push({ teams: [...own].sort((a, b) => a - b), larger: true });
  }
  const smallest = crews.find((c) => !c.larger)?.teams.length ?? 1;
  const needs = taskNeedsOf(task);
  const teams = exp.groundOps?.teams ?? [];
  return crews.map(({ teams: crew, larger }) => {
    const words = crewText(ship, crew);
    const squads = crewSquadsOf(teams.filter((t) => crew.includes(t.index)));
    const word = largerCrewWord(crew.length, smallest);
    const label = larger ? `${words} (${word})` : crew.length > 1 ? `${words} (joint)` : words;
    const note = larger ? `${word.charAt(0).toUpperCase()}${word.slice(1)}${word === "doubled" ? " crew" : ""}: ${largerCrewNote(squads, needs)}.` : null;
    return { key: crewKey(crew), label, crew: words, teamIndex: crew[0], partners: crew.slice(1), larger, note };
  });
}

export interface QueuePosView {
  teamIndex: number;
  position: number; // 1-based among the team's remaining tasks
  of: number;
  canUp: boolean;
  canDown: boolean;
  text: string; // "2nd of 4 in Alpha's queue"
  upLabel: string; // "Move Crashed Ship earlier in Alpha's queue"
  downLabel: string;
}

// The task's place in its LEAD's queue (the first crew team holding it), among the REMAINING tasks the way the
// engine's reorder counts (done tasks keep their places and never count). Null for a task in no queue. Pure.
export function queuePosition(
  exp: Pick<Expedition, "groundOps" | "bodies">,
  ship: ShipInstance | null | undefined,
  task: ExpeditionActivity,
  name: string,
): QueuePosView | null {
  const holders = queueHolders(exp, task.id);
  if (holders.length === 0) return null;
  const own = task.assignedTeamIds ?? [];
  const lead = holders.find((t) => t.index === own[0]) ?? holders[0];
  const remaining = lead.queue.filter((id) => {
    for (const body of exp.bodies) {
      const t = body.activities.find((a) => a.id === id);
      if (t) return t.status === "queued" || t.status === "active";
    }
    return false;
  });
  const at = remaining.indexOf(task.id);
  if (at < 0) return null;
  const team = runTeamName(ship, lead.index);
  return {
    teamIndex: lead.index,
    position: at + 1,
    of: remaining.length,
    canUp: at > 0,
    canDown: at < remaining.length - 1,
    text: `${ordinal(at + 1)} of ${remaining.length} in ${team}'s queue`,
    upLabel: `Move ${name} earlier in ${team}'s queue`,
    downLabel: `Move ${name} later in ${team}'s queue`,
  };
}

// ===== Rows, bodies, the screen =====

export interface TaskRowView {
  id: string;
  name: string;
  status: QueueTaskStatus;
  statusText: string;
  statusDetail: string | null;
  difficulty: DifficultyView | null;
  affixes: ObjectiveAffixesView | null; // the affix pills and the alert (Reinforcing), or null
  needs: TaskNeedsView;
  bar: FightBarView;
  odds: OddsCell[]; // one per QueueTeamColumn, same order
  crewKey: string; // the row's current crew ("" for none)
  crewText: string; // "Alpha + Bravo" | "Unassigned"
  jointOdds: ThreatAssessment | null; // the joint crew's tier (crew of 2+), else null (the columns show solo odds)
  options: CrewOption[];
  canAssign: boolean; // queued or active: pick a crew + Apply
  canSkip: boolean; // queued or active
  canRequeue: boolean; // skipped, with a crew that covers it
  queue: QueuePosView | null;
}

export interface BodyQueueView {
  bodyIndex: number;
  title: string; // "Kepler-186 II · Volcanic"
  countText: string; // "6 objectives discovered"
  rows: TaskRowView[];
  canReplan: boolean; // the body has a queued task (Default plan / Auto-assign have something to plan)
  replanBlockedText: string | null;
}

export interface StuckFlagView {
  text: string; // the user's wording
  hint: string;
  tasks: { id: string; name: string }[];
}

export interface GroundQueueView {
  teams: QueueTeamColumn[];
  bodies: BodyQueueView[];
  stuck: StuckFlagView | null;
  locked: string | null; // why nothing can be edited (the run is over), else null
  emptyText: string | null; // nothing scanned yet
}

// A task's label (discovery PoIs, hostile sites, clearing tasks). Pure.
export function taskName(task: Pick<ExpeditionActivity, "poiId">): string {
  return groundSiteLabel(task.poiId) ?? task.poiId;
}

// The body's title: the system's name, the body's designation (bodyDesignation) and its planet type. Pure.
export function bodyTitle(exp: Pick<Expedition, "systemName" | "region">, body: Pick<ExpeditionBody, "planetType">, bodyIndex: number): string {
  const type = getPlanetTypeById(body.planetType)?.label ?? body.planetType;
  return `${exp.systemName} ${bodyDesignation(exp, bodyIndex)} · ${type}`;
}

// A finished objective keeps its pills but no alert (nothing is left to retry). Pure.
function pillsOnly(task: ExpeditionActivity, now: number): ObjectiveAffixesView | null {
  const v = objectiveAffixesView(task, now);
  return v && v.pills.length > 0 ? { pills: v.pills, alert: null } : null;
}

// One row. Pure in effect (odds through the memo).
export function taskRowView(
  exp: Expedition,
  ship: ShipInstance | null | undefined,
  columns: readonly QueueTeamColumn[],
  task: ExpeditionActivity,
  now: number,
  memo: OddsMemo,
): TaskRowView {
  const name = taskName(task);
  const status = queueTaskStatus(exp, task);
  const remaining = status !== "done" && status !== "skipped";
  const own = (task.assignedTeamIds ?? []).filter((i) => columns.some((c) => c.index === i));
  const options = status === "done" ? [] : crewOptions(exp, ship, task);
  const assignedKey = remaining && own.length > 0 && queueHolders(exp, task.id).length > 0 ? crewKey([...own].sort((a, b) => a - b)) : "";
  return {
    id: task.id,
    name,
    status,
    statusText: QUEUE_STATUS_TEXT[status],
    statusDetail: queueStatusDetail(exp, ship, task, status),
    difficulty: difficultyView(task),
    affixes: remaining ? objectiveAffixesView(task, now) : pillsOnly(task, now),
    needs: taskNeedsView(exp, ship, task),
    bar: fightBarView(exp, task, now),
    odds: columns.map((c) => oddsCell(exp, c, task, status, memo)),
    crewKey: assignedKey,
    crewText: own.length > 0 ? crewText(ship, own) : "Unassigned",
    jointOdds: remaining && own.length >= 2 ? memo.get(exp, [...own].sort((a, b) => a - b), task) : null,
    options,
    canAssign: remaining && options.length > 0,
    canSkip: remaining,
    canRequeue: status === "skipped" && options.length > 0,
    queue: remaining ? queuePosition(exp, ship, task, name) : null,
  };
}

// The whole screen for one run: a block per SCANNED body holding Ground Ops tasks, the run-level stuck flag with
// its escape hatch (the stuck tasks, each skippable right there), and the lock once the window has closed. Pure in
// effect (odds through the memo).
export function groundQueueView(exp: Expedition, ship: ShipInstance | null | undefined, now: number, memo: OddsMemo): GroundQueueView {
  const ops = exp.groundOps;
  const teams = queueTeamColumns(exp, ship);
  if (!ops) return { teams, bodies: [], stuck: null, locked: null, emptyText: null };
  const over = ops.endedAt !== undefined || exp.phase === "return" || exp.phase === "complete";
  const bodies: BodyQueueView[] = [];
  exp.bodies.forEach((body, bodyIndex) => {
    if (!body.scanned) return;
    const tasks = body.activities.filter((a) => a.status !== undefined);
    if (tasks.length === 0) return;
    const canReplan = !over && tasks.some((a) => a.status === "queued");
    bodies.push({
      bodyIndex,
      title: bodyTitle(exp, body, bodyIndex),
      countText: `${plural(tasks.length, "objective", "objectives")} discovered`,
      rows: tasks.map((task) => taskRowView(exp, ship, teams, task, now, memo)),
      canReplan,
      replanBlockedText: canReplan ? null : over ? "The ground operations are over" : "No queued objectives on this body to plan",
    });
  });
  const stuck = !over && groundOpsStuck(exp)
    ? {
        text: GROUND_OPS_STUCK_TEXT,
        hint: STUCK_HINT,
        tasks: exp.bodies.flatMap((b) => b.activities.filter((a) => a.status !== undefined && groundTaskStuck(a)).map((a) => ({ id: a.id, name: taskName(a) }))),
      }
    : null;
  return {
    teams,
    bodies,
    stuck,
    locked: over ? "The ground operations are over: the ship is heading home." : null,
    emptyText: bodies.length === 0 && !over ? QUEUE_EMPTY_TEXT : null,
  };
}

// ===== The edits as the screen sends them =====

// The assign (or, for a skipped task, requeue) edit a picked crew makes. Null for an unknown option. Pure.
export function crewEdit(row: Pick<TaskRowView, "id" | "status" | "options">, key: string): GroundOpsEdit | null {
  const option = row.options.find((o) => o.key === key);
  if (!option) return null;
  const partners = option.partners.length > 0 ? { partners: [...option.partners] } : {};
  return row.status === "skipped"
    ? { kind: "requeue", taskId: row.id, teamIndex: option.teamIndex, ...partners }
    : { kind: "assign", taskId: row.id, teamIndex: option.teamIndex, ...partners };
}

// The select's starting pick: the row's crew, else (a skipped task) its last crew when still offered, else the
// first option. Pure.
export function defaultCrewPick(row: Pick<TaskRowView, "crewKey" | "options">, task?: Pick<ExpeditionActivity, "assignedTeamIds">): string {
  if (row.crewKey !== "" && row.options.some((o) => o.key === row.crewKey)) return row.crewKey;
  const last = task?.assignedTeamIds ? crewKey([...task.assignedTeamIds].sort((a, b) => a - b)) : "";
  if (last !== "" && row.options.some((o) => o.key === last)) return last;
  return row.options[0]?.key ?? "";
}

// The log line for an applied edit (App.svelte doEditGroundOps), read on the run BEFORE the edit. Pure.
export function groundOpsEditLogText(exp: Pick<Expedition, "bodies" | "systemName">, ship: ShipInstance | null | undefined, edit: GroundOpsEdit): string {
  const nameOf = (taskId: string): string => {
    for (const body of exp.bodies) {
      const task = body.activities.find((a) => a.id === taskId);
      if (task) return taskName(task);
    }
    return "the objective";
  };
  const crewOf = (lead: number, partners?: number[]): string => crewText(ship, [lead, ...(partners ?? []).filter((p) => p !== lead)]);
  switch (edit.kind) {
    case "assign":
      return `${nameOf(edit.taskId)} assigned to ${crewOf(edit.teamIndex, edit.partners)}.`;
    case "requeue":
      return `${nameOf(edit.taskId)} re-queued for ${crewOf(edit.teamIndex, edit.partners)}.`;
    case "skip":
      return `Skipped ${nameOf(edit.taskId)}.`;
    case "reorder":
      return `${nameOf(edit.taskId)} moved ${edit.delta < 0 ? "earlier" : "later"} in ${runTeamName(ship, edit.teamIndex)}'s queue.`;
    case "defaultPlan": {
      const body = exp.bodies[edit.bodyIndex];
      return `Default plan applied on ${body ? bodyTitle(exp, body, edit.bodyIndex) : "that body"}.`;
    }
    case "autoAssign": {
      const body = exp.bodies[edit.bodyIndex];
      return `Queued objectives on ${body ? bodyTitle(exp, body, edit.bodyIndex) : "that body"} auto-assigned at random.`;
    }
    case "setHelp":
      return edit.on ? `${runTeamName(ship, edit.teamIndex)} will help other teams when done.` : `${runTeamName(ship, edit.teamIndex)} will stay on its own objectives.`;
  }
}
