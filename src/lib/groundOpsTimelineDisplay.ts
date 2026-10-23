// groundOpsTimelineDisplay.ts: the display decisions of a running Ground Operations window (0.14.0, Ground
// Operations GO-14, mockups GO-M3 and GO-M4): one TIMELINE LANE per deployed team plus the SHIP's lane, the task
// PROGRESS cards, and the MEDICAL BAY card per team.
//
// WHY a .ts beside the components: this repo has no Svelte component test harness, so every choice worth gating
// (which step a segment is, when a lost fight was a wipe, where the axis starts, which pip reads "wiped here",
// what a bay row says) lives here as pure functions over the stored run, and the components only draw them.
//
// DISPLAY ONLY. The lanes read GroundOpsState.history (the engine's display record, capped per team; resolution
// never reads it), each team's live step, the ship's stored legs and the scan walk (expedition.ts
// flaggedScanTimeline). Nothing here changes a rule or writes to the run.
//
// READING THE HISTORY (groundOps.ts step machine):
//   - a fight's `outcome` is win / loss; a LOSS was a WIPE when the team's next step is a return the ship ended
//     (`recovered`), or, live, a return that waits for a recovery leg (every wipe gets a leg since the GO-7b
//     follow-up; a round-cap retreat with someone standing is an ordinary return);
//   - a work step marked `ambushed` ended in an ambush: the crew RETREATED when its next step is a return, else it
//     fought it where it stood (the next step is a fight marked `surprise`);
//   - `stopped` marks a step a player's edit ended (skip, or a reassign away; GO-7d);
//   - `reinforcement` marks a fight Reinforcing's reinforcements forced mid-work (objective affixes, AF-1): it holds
//     no fight point, so the lanes call it "Reinforcements" and the "wiped here" pip never reads it.

import type {
  AwayMember,
  Expedition,
  ExpeditionActivity,
  ExpeditionScanEvent,
  GroundRepairLeg,
  GroundShipLeg,
  GroundStepKind,
  GroundStepRecord,
  GroundStudyLeg,
  GroundTeamKind,
  GroundTeamRun,
  ShipInstance,
} from "./game/model";
import { ITEMS } from "./game/model";
import { nebulaKindById } from "./game/gasGiantContent";
import { RETURN_SECONDS, groundLegTeams, groundOpsBayCare, groundShipPosition, groundTaskProgressAt, groundTaskFindingPrefix, groundTaskStuck, groundTeamRemainingTasks } from "./game/groundOps";
import type { FlaggedScanPause, FlaggedScanSpan } from "./game/expedition";
import { GROUND_CONDITIONS, STONESKIN_INJURY_MULT, conditionCureSeconds, type ConditionClass } from "./game/medicalBay";
import { segmentCount } from "./game/groundTasks";
import { DEFAULT_GROUND_TEAM_KIND, isGroundTeamKind, teamKindName } from "./game/groundComposition";
import { groundTeamShortLabel } from "./game/groundTeams";
import { bodyDesignation, bodyTitle, crewText, queueTaskStatus, runTeamName, taskName } from "./groundTaskQueueDisplay";
import type { IconName } from "./ui/icons";
import { objectiveAffixesView, type ObjectiveAffixesView } from "./objectiveAffixDisplay";

// ===== Small words =====

// A span of seconds in plain words: "45s", "6m", "6m 12s", "1h 12m". Whole seconds; never negative. Pure.
export function spanText(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m}m` : `${m}m ${r}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Time left until `end`, rounded UP to the second ("4m 12s left"); "now" at or past it. Pure.
export function leftText(end: number, now: number): string {
  const left = Math.ceil(end - now);
  return left > 0 ? `${spanText(left)} left` : "ending now";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function pct(frac: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(frac) ? frac * 100 : 0));
}

function runKind(team: Pick<GroundTeamRun, "kind">): GroundTeamKind {
  return isGroundTeamKind(team.kind) ? team.kind : DEFAULT_GROUND_TEAM_KIND;
}

function taskById(exp: Pick<Expedition, "bodies">, taskId: string | undefined): ExpeditionActivity | null {
  if (taskId === undefined) return null;
  for (const body of exp.bodies) {
    const task = body.activities.find((a) => a.id === taskId);
    if (task) return task;
  }
  return null;
}

function taskLabel(exp: Pick<Expedition, "bodies">, taskId: string | undefined): string {
  const task = taskById(exp, taskId);
  return task ? taskName(task) : "the objective";
}

// ===== Lane segments =====

// The color family a segment draws in (the key row, GO-M3): team steps, then the ship's.
export type LaneCategory =
  | "work"
  | "fight"
  | "wipe"
  | "travel"
  | "load"
  | "bay"
  | "idle"
  | "staging"
  | "scan"
  | "hold"
  | "pause"
  | "leg"
  | "repair"
  // Gas Giant Study GG-6 (the signed-off v3 mockup, as drawn): the ship's study of an orbital body, its nebula sweep
  // (both on the ship lane after the bodies' scans), and a team's pickup waiting while the ship holds orbit.
  | "study"
  | "sweep"
  | "wait";

export const LANE_KEY: readonly { category: LaneCategory; text: string; glyph: IconName }[] = [
  { category: "work", text: "working", glyph: "tool" },
  { category: "fight", text: "fight", glyph: "fightPoint" },
  { category: "wipe", text: "wipe", glyph: "warning" },
  { category: "travel", text: "travel", glyph: "deploy" },
  { category: "load", text: "offload / reload", glyph: "offload" },
  { category: "bay", text: "medical bay", glyph: "medBay" },
  { category: "idle", text: "idle", glyph: "clock" },
];
export const SHIP_KEY: readonly { category: LaneCategory; text: string; glyph: IconName }[] = [
  { category: "scan", text: "scanning", glyph: "discovery" },
  { category: "pause", text: "scan pause", glyph: "shipDebris" },
  { category: "leg", text: "recovery leg", glyph: "ship" },
  { category: "repair", text: "field repair", glyph: "shipyard" },
  { category: "hold", text: "holding station", glyph: "clock" },
];
export const STOPPED_KEY_TEXT = "stopped by your edit";
// GG-6: the key entries a study run adds (shown only on a run with a study or a sweep: TimelineView.hasStudies).
export const STUDY_LANE_KEY: readonly { category: LaneCategory; text: string; glyph: IconName }[] = [{ category: "wait", text: "pickup waits", glyph: "clock" }];
export const STUDY_SHIP_KEY: readonly { category: LaneCategory; text: string; glyph: IconName }[] = [
  { category: "study", text: "ship study", glyph: "giant" },
  { category: "sweep", text: "nebula sweep", glyph: "nebula" },
];

export interface LaneSegment {
  key: string;
  category: LaneCategory;
  startsAt: number;
  endsAt: number;
  leftPct: number;
  widthPct: number;
  glyph: IconName;
  label: string; // short, drawn in the segment when it is wide enough
  detail: string; // a full sentence: the tooltip and the step list
  current: boolean;
  stopped: boolean;
  lost: boolean; // a fight lost without a wipe (a round-cap retreat)
  showLabel: boolean;
  showGlyph: boolean;
}

// Wide enough (percent of the track) to carry its words / its glyph.
export const LABEL_MIN_PCT = 12;
export const GLYPH_MIN_PCT = 3.5;

const STEP_GLYPH: Record<GroundStepKind, IconName> = {
  idle: "clock",
  staging: "groundTeam",
  deploy: "deploy",
  work: "tool",
  fight: "fightPoint",
  return: "ship",
  offload: "offload",
  bay: "medBay",
  reload: "reload",
};

// One raw step on a team's timeline (a history record, or the live step).
interface RawStep {
  step: GroundStepKind;
  startedAt: number;
  endedAt: number; // the live step: the axis end
  taskId?: string;
  outcome?: "win" | "loss";
  recovered?: boolean;
  ambushed?: boolean;
  surprise?: boolean;
  reinforcement?: boolean;
  stopped?: boolean;
  live: boolean;
  awaitingPickup?: boolean; // live return waiting for the ship
  plannedEnd?: number; // the live step's stored end (GG-6: a shuttle that waits for a study ends at the study's end)
}

// The team's live return waits for a recovery leg (the ship arrives at the step's end). Pure.
function awaitingPickup(ops: { shipLegs: readonly GroundShipLeg[] }, team: Pick<GroundTeamRun, "index" | "step" | "stepEndsAt">): GroundShipLeg | null {
  if (team.step !== "return" || team.stepEndsAt === null) return null;
  return ops.shipLegs.find((l) => groundLegTeams(l).includes(team.index) && l.arrivesAt === team.stepEndsAt) ?? null;
}

// The team's steps in time order: its history records, then its live step (ending at `axisEnd`). Pure.
function teamSteps(exp: Expedition, team: GroundTeamRun, axisEnd: number): RawStep[] {
  const ops = exp.groundOps;
  if (!ops) return [];
  const steps: RawStep[] = ops.history
    .filter((r) => r.teamIndex === team.index)
    .map((r: GroundStepRecord) => ({
      step: r.step,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      ...(r.taskId !== undefined ? { taskId: r.taskId } : {}),
      ...(r.outcome ? { outcome: r.outcome } : {}),
      ...(r.recovered ? { recovered: true } : {}),
      ...(r.ambushed ? { ambushed: true } : {}),
      ...(r.surprise ? { surprise: true } : {}),
      ...(r.reinforcement ? { reinforcement: true } : {}),
      ...(r.stopped ? { stopped: true } : {}),
      live: false,
    }));
  if (team.stepStartedAt <= axisEnd) {
    steps.push({
      step: team.step,
      startedAt: team.stepStartedAt,
      endedAt: Math.max(team.stepStartedAt, axisEnd),
      ...(team.taskId !== undefined && team.step !== "idle" ? { taskId: team.taskId } : {}),
      ...(team.step === "fight" && team.pendingFight?.surprise ? { surprise: true } : {}),
      ...(team.step === "fight" && team.pendingFight?.reinforcement ? { reinforcement: true } : {}),
      live: true,
      ...(awaitingPickup(ops, team) ? { awaitingPickup: true } : {}),
      ...(team.stepEndsAt !== null ? { plannedEnd: team.stepEndsAt } : {}),
    });
  }
  return steps;
}

// Was the lost fight at steps[i] a WIPE (see the header)? Pure.
function lossWasWipe(steps: readonly RawStep[], i: number): boolean {
  const next = steps[i + 1];
  if (!next) return false;
  return next.step === "return" && (next.recovered === true || next.awaitingPickup === true);
}

// Did the ambushed work step at steps[i] end in a RETREAT (the crew went straight back)? Pure.
function ambushRetreated(steps: readonly RawStep[], i: number): boolean {
  const next = steps[i + 1];
  return next !== undefined && next.step === "return";
}

interface StepWords {
  category: LaneCategory;
  label: string;
  detail: string;
  lost: boolean;
}

function stepWords(exp: Expedition, steps: readonly RawStep[], i: number): StepWords {
  const s = steps[i];
  const task = taskLabel(exp, s.taskId);
  const len = spanText(s.endedAt - s.startedAt);
  const stopNote = s.stopped ? ", stopped by your edit" : "";
  switch (s.step) {
    case "deploy":
      return { category: "travel", label: "drop", detail: `Drop to ${task} (${len})${stopNote}`, lost: false };
    case "work": {
      if (s.ambushed) {
        const retreat = ambushRetreated(steps, i);
        return {
          category: "work",
          label: retreat ? "ambushed" : task,
          detail: retreat ? `Work on ${task} (${len}): ambushed, the crew retreated` : `Work on ${task} (${len}): ambushed, the crew stood and fought`,
          lost: false,
        };
      }
      return { category: "work", label: s.stopped ? "stopped" : task, detail: `Work on ${task} (${len})${stopNote}`, lost: false };
    }
    case "fight": {
      // AF-1: a Reinforcing extra battle is labelled like a surprise fight (it holds no fight point).
      const kind = s.reinforcement ? "Reinforcements" : s.surprise ? "Surprise fight" : "Fight";
      const tag = s.reinforcement ? "reinforcements" : s.surprise ? "surprise" : null;
      if (s.live) return { category: "fight", label: tag ?? "fight", detail: `${kind} at ${task}, under way`, lost: false };
      if (s.outcome === "win") return { category: "fight", label: tag ? `${tag}, won` : "won", detail: `${kind} at ${task}: won (${len})${stopNote}`, lost: false };
      if (lossWasWipe(steps, i)) return { category: "wipe", label: s.reinforcement ? "reinforcements, wiped" : "wiped", detail: `${kind} at ${task}: lost, Security wiped (${len})${stopNote}`, lost: false };
      return { category: "fight", label: s.reinforcement ? "reinforcements, lost" : "lost", detail: `${kind} at ${task}: lost, the team fell back (${len})${stopNote}`, lost: true };
    }
    case "return":
      if (s.awaitingPickup) return { category: "travel", label: "awaiting pickup", detail: "Waiting for the ship to pick the team up", lost: false };
      if (s.recovered) return { category: "travel", label: "pickup", detail: `Picked up by the ship (${len})`, lost: false };
      return { category: "travel", label: "return", detail: `Shuttle back to the ship (${len})${stopNote}`, lost: false };
    case "offload":
      return { category: "load", label: "offload", detail: `Offload (${len})`, lost: false };
    case "bay":
      return { category: "bay", label: "med bay", detail: `Medical bay (${len})`, lost: false };
    case "reload":
      return { category: "load", label: "reload", detail: `Reload (${len})`, lost: false };
    case "staging":
      return { category: "staging", label: "staging", detail: `Staging for ${task} with the crew (${len})${stopNote}`, lost: false };
    case "idle":
      return { category: "idle", label: "idle", detail: `Idle (${len})${stopNote}`, lost: false };
  }
}

// ===== The axis =====

export type TimelineMode = "recent" | "whole";
// "Recent" shows at least this many of each lane's latest steps.
export const TIMELINE_RECENT_STEPS = 8;

export interface TimelineAxis {
  start: number;
  end: number;
  mode: TimelineMode;
  startText: string; // "1h 12m ago" | "window opened"
  endText: string; // "now" | "operations ended"
}

function axisPos(axis: Pick<TimelineAxis, "start" | "end">, from: number, to: number): { leftPct: number; widthPct: number } | null {
  // Off the axis: ended before it starts (one that ends exactly at its start too, unless it is a zero-length mark
  // there), or starts after it ends.
  if (to < axis.start || (to === axis.start && from < to) || from > axis.end) return null;
  const span = Math.max(1e-9, axis.end - axis.start);
  const a = Math.max(from, axis.start);
  const b = Math.min(to, axis.end);
  return { leftPct: pct((a - axis.start) / span), widthPct: pct((b - a) / span) };
}

// ===== Lanes =====

export interface TeamLaneView {
  index: number;
  letter: string;
  name: string;
  kind: GroundTeamKind;
  kindName: string;
  segments: LaneSegment[];
  nowText: string; // the current step, with time left
  ariaLabel: string;
  steps: { key: string; text: string; when: string; current: boolean }[]; // most recent first (the axis's steps)
}

export interface ShipLaneView {
  segments: LaneSegment[];
  nowText: string;
  ariaLabel: string;
  steps: { key: string; text: string; when: string; current: boolean }[];
}

export interface TimelineView {
  axis: TimelineAxis;
  lanes: TeamLaneView[];
  ship: ShipLaneView;
  closed: boolean;
  hasStopped: boolean; // some shown segment was stopped by an edit (the key shows the marker)
  hasStudies: boolean; // GG-6: the run studies an orbital body or sweeps a nebula (the key shows their entries)
}

export type ScanTimelineReader = (exp: Expedition) => { bodies: FlaggedScanSpan[]; pauses: FlaggedScanPause[] };

function segmentFrom(
  key: string,
  axis: TimelineAxis,
  from: number,
  to: number,
  glyph: IconName,
  words: StepWords,
  flags: { current?: boolean; stopped?: boolean } = {},
): LaneSegment | null {
  const pos = axisPos(axis, from, to);
  if (!pos) return null;
  return {
    key,
    category: words.category,
    startsAt: from,
    endsAt: to,
    ...pos,
    glyph,
    label: words.label,
    detail: words.detail,
    current: flags.current === true,
    stopped: flags.stopped === true,
    lost: words.lost,
    showLabel: pos.widthPct >= LABEL_MIN_PCT,
    showGlyph: pos.widthPct >= GLYPH_MIN_PCT,
  };
}

// What the team is doing now, with the time left. Pure.
export function teamNowText(exp: Expedition, ship: ShipInstance | null | undefined, team: GroundTeamRun, now: number): string {
  const ops = exp.groundOps;
  const closed = ops?.endedAt !== undefined;
  const task = taskLabel(exp, team.taskId);
  const left = team.stepEndsAt !== null ? ` · ${leftText(team.stepEndsAt, now)}` : "";
  switch (team.step) {
    case "idle": {
      if (closed) return "Back aboard";
      const remaining = groundTeamRemainingTasks(exp, team).length;
      if (remaining > 0) return "Idle: about to take its next objective";
      return team.helpOthers ? "Idle: queue done, ready to help other teams" : "Idle: queue done";
    }
    case "staging": {
      const lead = ops?.teams.find((t) => t !== team && t.taskId === team.taskId && t.step !== "staging" && t.step !== "idle");
      return lead ? `With ${runTeamName(ship, lead.index)} on ${task}` : `Gathering the crew for ${task}`;
    }
    case "deploy":
      return `Dropping to ${task}${left}`;
    case "work":
      return `Working on ${task}${left}`;
    case "fight":
      return `Fighting at ${task}${left}`;
    case "return": {
      const leg = ops ? awaitingPickup(ops, team) : null;
      if (leg) return `Waiting for the ship: pickup ${team.stepEndsAt !== null && team.stepEndsAt > now ? `in ${spanText(Math.ceil(team.stepEndsAt - now))}` : "now"}`;
      // GG-6: the shuttle is up but the ship holds orbit on a study; it docks when the study ends.
      const dock = ops && team.stepEndsAt !== null ? waitedOnStudy(ops, team.stepStartedAt, team.stepEndsAt) : null;
      if (dock !== null && now >= dock && team.stepEndsAt !== null) return `Pickup waits: the ship holds orbit on a study · docks in ${spanText(Math.max(0, Math.ceil(team.stepEndsAt - now)))}`;
      return `Shuttling back to the ship${left}`;
    }
    case "offload":
      return `Offloading${left}`;
    case "bay":
      if (closed && team.stepEndsAt !== null && team.stepEndsAt <= now) return "Back aboard";
      return `In the medical bay${left}`;
    case "reload":
      if (closed) return "Back aboard";
      return `Reloading${left}`;
  }
}

function whenText(end: number, now: number, current: boolean): string {
  if (current) return "now";
  const ago = now - end;
  return ago < 1 ? "just now" : `${spanText(ago)} ago`;
}

function shipLegWords(exp: Expedition, ship: ShipInstance | null | undefined, leg: GroundShipLeg): StepWords {
  const teams = groundLegTeams(leg);
  const body = exp.bodies[leg.bodyIndex];
  const where = body ? bodyTitle(exp, body, leg.bodyIndex) : "the team's body";
  const who = crewText(ship, teams);
  const shared = teams.length > 1 ? "shared pickup" : "pickup";
  const pause = leg.scanBodyIndex !== null ? "; the scan waited" : "";
  return {
    category: "leg",
    label: `${shared}: ${who}`,
    detail: `Recovery leg to ${where} for ${who} (${teams.length > 1 ? "one shared pickup, " : ""}${spanText(leg.endsAt - leg.startsAt)})${pause}`,
    lost: false,
  };
}

function repairLegWords(exp: Expedition, leg: GroundRepairLeg): StepWords {
  const site = leg.siteBodyIndex !== null ? exp.bodies[leg.siteBodyIndex] : null;
  const where = site && leg.siteBodyIndex !== null ? `at ${bodyTitle(exp, site, leg.siteBodyIndex)}` : "in orbit";
  const flying = leg.arrivesAt - leg.startsAt;
  const parts = [
    ...(flying > 0 ? [`flying ${spanText(flying)}`] : []),
    `repairing ${spanText(leg.repairedAt - leg.arrivesAt)}`,
    ...(leg.endsAt > leg.repairedAt ? [`flying back ${spanText(leg.endsAt - leg.repairedAt)}`] : []),
  ];
  const why = leg.ordered ? "ordered" : "after heavy damage";
  return {
    category: "repair",
    label: "field repair",
    detail: `Field repair ${where} (${why}): ${parts.join(", ")}; fixes ${Math.round(leg.hullRepaired)} hull`,
    lost: false,
  };
}

const SHIP_EVENT_NAMES: Record<string, string> = {
  debris: "Debris field",
  probe: "Hostile probe",
  ghost: "Sensor ghost",
  cloaked: "Cloaked vessel",
  storm: "Radiation storm",
};
const SHIP_EVENT_GLYPHS: Record<string, IconName> = {
  debris: "shipDebris",
  probe: "shipProbe",
  ghost: "sensorGhost",
  cloaked: "cloakedVessel",
  storm: "radiationStorm",
};

// A recorded scan pause in words: what struck and why the scan waited. Pure.
export function scanPauseWords(event: ExpeditionScanEvent, seconds: number): { label: string; detail: string; glyph: IconName } {
  const boarded = event.boarding !== undefined && !event.boarding.repelled;
  const name = event.kind === "shipEvent" && event.event ? SHIP_EVENT_NAMES[event.event] ?? "Scan event" : event.kind === "encounter" ? "Ground encounter" : "Scan event";
  const glyph: IconName = boarded ? "boarding" : event.kind === "shipEvent" && event.event ? SHIP_EVENT_GLYPHS[event.event] ?? "warning" : "warning";
  let why = "the scan waited";
  if (event.event === "debris") why = "a detour around the debris";
  else if (event.event === "probe" || event.event === "cloaked") why = event.outcome === "loss" ? "repairs after the fight" : "the scan waited";
  else if (event.event === "ghost") why = "re-scanning after a false reading";
  else if (event.event === "storm") why = "riding out the storm";
  const board = boarded ? "; boarders got aboard" : "";
  return { label: name.toLowerCase(), detail: `${name}: ${why}${board} (${spanText(seconds)})`, glyph };
}

// The ship's legs (recovery, repair and, GG-6, the studies and the sweep) as [start, end] spans, start order. Pure.
function shipLegsOf(ops: { shipLegs: readonly GroundShipLeg[]; repairLegs?: readonly GroundRepairLeg[]; studyLegs?: readonly GroundStudyLeg[] }): [number, number][] {
  return [...ops.shipLegs, ...(ops.repairLegs ?? []), ...(ops.studyLegs ?? [])].map((l): [number, number] => [l.startsAt, l.endsAt]).sort((a, b) => a[0] - b[0]);
}

// GG-6: a study leg in words (the ship holds orbit over a giant, or sweeps the nebula). Pure.
function studyLegWords(exp: Expedition, leg: GroundStudyLeg, now: number): StepWords {
  const len = spanText(leg.endsAt - leg.startsAt);
  const going = leg.startsAt <= now && now < leg.endsAt && !leg.done;
  if (leg.nebula === 1) {
    const kind = exp.nebula ? nebulaKindById(exp.nebula.kindId) : undefined;
    const name = kind ? kind.name.toLowerCase() : "nebula";
    return { category: "sweep", label: "nebula sweep", detail: going ? `Sweeping the ${name} (${len}), under way` : `Swept the ${name} (${len})`, lost: false };
  }
  const body = exp.bodies[leg.bodyIndex];
  const name = body ? bodyTitle(exp, body, leg.bodyIndex) : "the giant";
  const pause = leg.scanBodyIndex !== null ? "; the scan waited" : "";
  return {
    category: "study",
    label: `study ${bodyDesignation(exp, leg.bodyIndex)}`,
    detail: going ? `Holding orbit: studying ${name} (${len}), under way${pause}` : `Studied ${name} from orbit (${len})${pause}`,
    lost: false,
  };
}

// GG-6: when an ordinary shuttle that left at `startedAt` would have docked, if a study held the ship then (the
// shuttle waited for its end, groundOps.ts studyPickupAt), else null. Pure.
function waitedOnStudy(ops: { studyLegs?: readonly GroundStudyLeg[] }, startedAt: number, endedAt: number): number | null {
  const dock = startedAt + RETURN_SECONDS;
  if (!(endedAt > dock + 1e-9)) return null;
  return (ops.studyLegs ?? []).some((l) => l.startsAt < dock && dock < l.endsAt) ? dock : null;
}

// The parts of [from, to] no gap covers, in order. Pure.
export function outside(from: number, to: number, gaps: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  let at = from;
  for (const [a, b] of gaps) {
    if (b <= at || a >= to) continue;
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < to) out.push([at, to]);
  return out;
}

// The ship's lane: each body's scan (then holding station), the recorded scan pauses, the recovery legs and the
// field repairs, on the same axis as the teams. Pure.
function shipLane(exp: Expedition, ship: ShipInstance | null | undefined, axis: TimelineAxis, now: number, scan: ScanTimelineReader): ShipLaneView {
  const ops = exp.groundOps;
  const segments: LaneSegment[] = [];
  // The step list reads each span once (a scan or the hold is drawn in pieces around the legs).
  const listed: LaneSegment[] = [];
  const add = (seg: LaneSegment | null): void => {
    if (!seg) return;
    segments.push(seg);
    listed.push(seg);
  };
  if (ops) {
    const { bodies, pauses } = scan(exp);
    // Only what the ship is doing NOW is highlighted.
    const pos = ops.endedAt === undefined ? groundShipPosition(exp, now).kind : null;
    const legs = shipLegsOf(ops);
    // A scan span or the hold, drawn only where no leg covers it (the ship was away), listed once.
    const addBase = (key: string, from: number, to: number, glyph: IconName, words: StepWords, current: boolean): void => {
      const whole = segmentFrom(key, axis, from, to, glyph, words, { current });
      if (!whole) return;
      listed.push(whole);
      outside(from, to, legs).forEach(([a, b], k) => {
        const piece = segmentFrom(`${key}-${k}`, axis, a, b, glyph, words, { current: current && a <= now && now <= b });
        if (piece) segments.push(piece);
      });
    };
    let scanEnd: number | null = null;
    for (const span of bodies) {
      const body = exp.bodies[span.bodyIndex];
      const end = span.endsAt ?? axis.end;
      const name = body ? bodyTitle(exp, body, span.bodyIndex) : `body ${bodyDesignation(exp, span.bodyIndex)}`;
      addBase(
        `scan-${span.bodyIndex}`,
        span.startsAt,
        end,
        "discovery",
        {
          category: "scan",
          label: `scan ${bodyDesignation(exp, span.bodyIndex)}`,
          detail: span.endsAt === null ? `Scanning ${name}, under way` : `Scanned ${name} (${spanText(end - span.startsAt)})`,
          lost: false,
        },
        span.endsAt === null && pos === "scanning",
      );
      if (span.endsAt !== null) scanEnd = span.endsAt;
    }
    if (exp.bodies.length > 0 && exp.bodies.every((b) => b.scanned) && scanEnd !== null) {
      addBase("hold", scanEnd, axis.end, "clock", { category: "hold", label: "holding", detail: "Holding station: every body scanned", lost: false }, pos === "holding");
    }
    for (const p of pauses) {
      const w = scanPauseWords(p.event, p.endsAt - p.startsAt);
      add(segmentFrom(`pause-${p.bodyIndex}-${p.step}`, axis, p.startsAt, p.endsAt, w.glyph, { category: "pause", label: w.label, detail: w.detail, lost: false }));
    }
    ops.shipLegs.forEach((leg, k) => {
      add(segmentFrom(`leg-${k}`, axis, leg.startsAt, leg.endsAt, "ship", shipLegWords(exp, ship, leg), { current: leg.startsAt <= now && now < leg.endsAt }));
    });
    (ops.repairLegs ?? []).forEach((leg, k) => {
      add(segmentFrom(`repair-${k}`, axis, leg.startsAt, leg.endsAt, "shipyard", repairLegWords(exp, leg), { current: leg.startsAt <= now && now < leg.endsAt }));
    });
    // GG-6: the studies and the nebula sweep, on the ship lane after the scans (the v3 mockup, as drawn).
    (ops.studyLegs ?? []).forEach((leg, k) => {
      const live = leg.startsAt <= now && now < leg.endsAt && !leg.done;
      const to = live ? Math.min(leg.endsAt, axis.end) : leg.endsAt;
      add(segmentFrom(`study-${k}`, axis, leg.startsAt, to, leg.nebula === 1 ? "nebula" : "giant", studyLegWords(exp, leg, now), { current: live && ops.endedAt === undefined }));
    });
  }
  // The step list: what is happening now first, then the most recent first.
  const steps = [...listed]
    .sort((a, b) => (a.current !== b.current ? (a.current ? -1 : 1) : b.endsAt - a.endsAt))
    .map((seg) => ({ key: seg.key, text: seg.detail, when: whenText(seg.endsAt, axis.end, seg.current), current: seg.current }));
  const nowText = shipNowText(exp, ship, now);
  return { segments, nowText, ariaLabel: `Ship timeline: ${nowText}. ${plural(segments.length, "step", "steps")} shown.`, steps };
}

// Where the ship is now, in words. Pure.
export function shipNowText(exp: Expedition, ship: ShipInstance | null | undefined, now: number): string {
  const ops = exp.groundOps;
  if (!ops) return "";
  if (ops.endedAt !== undefined) return "Ground operations over: heading home";
  const pos = groundShipPosition(exp, now);
  switch (pos.kind) {
    case "scanning": {
      const body = exp.bodies[pos.bodyIndex];
      return `Scanning ${body ? bodyTitle(exp, body, pos.bodyIndex) : "the system"}`;
    }
    case "recovery": {
      const who = crewText(ship, groundLegTeams(pos.leg));
      return now < pos.leg.arrivesAt
        ? `Flying to pick up ${who} · arrives in ${spanText(Math.ceil(pos.leg.arrivesAt - now))}`
        : `${who} aboard · returning to ${pos.leg.scanBodyIndex === null ? "station" : "the scan"} · ${leftText(pos.leg.endsAt, now)}`;
    }
    case "repair": {
      const leg = pos.leg;
      if (now < leg.arrivesAt) return `Setting course for a field repair · arrives in ${spanText(Math.ceil(leg.arrivesAt - now))}`;
      if (now < leg.repairedAt) {
        const site = leg.siteBodyIndex !== null ? exp.bodies[leg.siteBodyIndex] : null;
        const where = site && leg.siteBodyIndex !== null ? `Setting down for repairs at ${bodyTitle(exp, site, leg.siteBodyIndex)}` : "Repairing in orbit";
        return `${where} · ${leftText(leg.repairedAt, now)}`;
      }
      return `Repaired, flying back · ${leftText(leg.endsAt, now)}`;
    }
    case "study": {
      // Gas Giant Study GG-3 (the engine's minimal line; GG-6 owns the study card and its timeline lane).
      // GG-4: the nebula sweep is a study leg too.
      if (pos.leg.nebula === 1) {
        const kind = exp.nebula ? nebulaKindById(exp.nebula.kindId) : undefined;
        return `Sweeping the ${kind ? kind.name.toLowerCase() : "nebula"} · ${leftText(pos.leg.endsAt, now)}`;
      }
      const body = exp.bodies[pos.leg.bodyIndex];
      return `Holding orbit: studying ${body ? bodyTitle(exp, body, pos.leg.bodyIndex) : "the giant"} · ${leftText(pos.leg.endsAt, now)}`;
    }
    case "holding":
      return "Holding station: every body scanned";
  }
}

// The whole timeline panel for a run: the axis, one lane per deployed team (ascending index), the ship's lane.
// Null when the run has no Ground Ops window open yet. `scan` is expedition.ts flaggedScanTimeline (passed in so
// this module never imports expedition.ts's engine). Pure.
export function timelineView(
  exp: Expedition,
  ship: ShipInstance | null | undefined,
  now: number,
  mode: TimelineMode,
  scan: ScanTimelineReader,
): TimelineView | null {
  const ops = exp.groundOps;
  if (!ops || ops.startedAt === undefined) return null;
  const windowStart = ops.startedAt;
  const closed = ops.endedAt !== undefined;
  const end = Math.max(windowStart + 1, closed ? (ops.endedAt as number) : now);
  const raw = ops.teams.map((team) => teamSteps(exp, team, end));
  let start = windowStart;
  if (mode === "recent") {
    // The busy lanes set the span: an idle lane (its queue done) would only stretch the axis over its own long wait
    // and crowd the others. With every lane idle, the earliest of them.
    const kth = (steps: RawStep[]) => steps[Math.max(0, steps.length - TIMELINE_RECENT_STEPS)].startedAt;
    const busy = raw.filter((steps, i) => steps.length > 0 && ops.teams[i].step !== "idle");
    const pool = busy.length > 0 ? busy : raw.filter((steps) => steps.length > 0);
    let from = busy.length > 0 ? -Infinity : Infinity;
    for (const steps of pool) from = busy.length > 0 ? Math.max(from, kth(steps)) : Math.min(from, kth(steps));
    if (Number.isFinite(from)) start = Math.max(windowStart, Math.min(from, end - 1));
  }
  const axis: TimelineAxis = {
    start,
    end,
    mode,
    startText: start <= windowStart ? "window opened" : `${spanText(end - start)} before ${closed ? "the end" : "now"}`,
    endText: closed ? "operations ended" : "now",
  };
  let hasStopped = false;
  const lanes: TeamLaneView[] = ops.teams.map((team, ti) => {
    const steps = raw[ti];
    const segments: LaneSegment[] = [];
    const list: TeamLaneView["steps"] = [];
    steps.forEach((s, i) => {
      const words = stepWords(exp, steps, i);
      // GG-6: an ordinary shuttle that waited for a study draws its flight, then a hatched "pickup waits".
      const waitFrom =
        s.step === "return" && !s.recovered && !s.awaitingPickup && !s.stopped ? waitedOnStudy(ops, s.startedAt, s.live ? (s.plannedEnd ?? s.endedAt) : s.endedAt) : null;
      if (waitFrom !== null && waitFrom < s.endedAt) {
        const fly = segmentFrom(`${team.index}-${i}-${s.startedAt}`, axis, s.startedAt, waitFrom, STEP_GLYPH.return, { ...words, label: "return", detail: `Shuttle back to the ship (${spanText(RETURN_SECONDS)})` }, {
          current: false,
        });
        const waitEnd = s.live ? (s.plannedEnd ?? s.endedAt) : s.endedAt;
        const waitWords: StepWords = {
          category: "wait",
          label: "pickup waits",
          detail: s.live && !closed ? `Pickup waits for the ship while it holds orbit on a study: docks in ${spanText(Math.max(0, Math.ceil(waitEnd - now)))}` : `Pickup waited for the ship while it held orbit on a study (${spanText(waitEnd - waitFrom)})`,
          lost: false,
        };
        const wait = segmentFrom(`${team.index}-${i}-${s.startedAt}-wait`, axis, waitFrom, s.endedAt, "clock", waitWords, { current: s.live && !closed });
        for (const seg of [fly, wait]) {
          if (!seg) continue;
          segments.push(seg);
          list.push({ key: seg.key, text: seg.detail, when: whenText(seg.endsAt, end, seg.current), current: seg.current });
        }
        return;
      }
      const seg = segmentFrom(`${team.index}-${i}-${s.startedAt}`, axis, s.startedAt, s.endedAt, STEP_GLYPH[s.step], words, {
        current: s.live && !closed,
        stopped: s.stopped === true,
      });
      if (!seg) return;
      if (seg.stopped) hasStopped = true;
      segments.push(seg);
      list.push({ key: seg.key, text: seg.detail, when: whenText(s.endedAt, end, seg.current), current: seg.current });
    });
    list.reverse();
    const kind = runKind(team);
    const name = runTeamName(ship, team.index);
    const nowText = teamNowText(exp, ship, team, now);
    return {
      index: team.index,
      letter: groundTeamShortLabel(team.index),
      name,
      kind,
      kindName: teamKindName(kind),
      segments,
      nowText,
      ariaLabel: `${name} timeline: ${nowText}. ${plural(segments.length, "step", "steps")} shown.`,
      steps: list,
    };
  });
  const hasStudies = exp.study === 1 || exp.nebula !== undefined;
  return { axis, lanes, ship: shipLane(exp, ship, axis, now, scan), closed, hasStopped, hasStudies };
}

// ===== Task progress cards (GO-M4 left) =====

export type TaskCardState = "queued" | "inProgress" | "paused" | "done" | "skipped";

export interface TaskPipView {
  at: number; // percent along the bar
  state: "won" | "pending" | "fighting" | "lost" | "wiped";
  label: string; // "fight 1 won", "fight 2: wiped here, resumes here", "fight 3"
}

export interface TaskCardView {
  id: string;
  name: string;
  where: string; // the body title
  state: TaskCardState;
  stateText: string; // "In progress", "Paused: Alpha in the med bay", "Done", "Skipped"
  crew: { index: number; kind: GroundTeamKind; name: string }[];
  progressPct: number;
  pips: TaskPipView[];
  affixes: ObjectiveAffixesView | null; // the affix pills and the alert (Reinforcing), or null
  barLabel: string; // the bar's accessible name
  pointText: string; // the cleared / held point
  haulText: string; // segments banked vs offloaded
  notes: string[]; // ambush retreats, surprise fights, an edit's stop, back of the line
  haul: { materials: { id: string; label: string; qty: number }[]; credits: number; relicTier: string | null } | null;
}

function wholePct(frac: number): number {
  return Math.round(pct(frac));
}

// Every history record of a task, any team, time order. Pure.
function taskRecords(exp: Expedition, taskId: string): { rec: GroundStepRecord; next: GroundStepRecord | null; live: GroundTeamRun | null }[] {
  const ops = exp.groundOps;
  if (!ops) return [];
  const out: { rec: GroundStepRecord; next: GroundStepRecord | null; live: GroundTeamRun | null }[] = [];
  const byTeam = new Map<number, GroundStepRecord[]>();
  for (const r of ops.history) {
    const list = byTeam.get(r.teamIndex) ?? [];
    list.push(r);
    byTeam.set(r.teamIndex, list);
  }
  for (const [teamIndex, list] of byTeam) {
    const team = ops.teams.find((t) => t.index === teamIndex) ?? null;
    list.forEach((rec, i) => {
      if (rec.taskId !== taskId) return;
      const next = list[i + 1] ?? null;
      out.push({ rec, next, live: next === null ? team : null });
    });
  }
  return out.sort((a, b) => a.rec.startedAt - b.rec.startedAt || a.rec.teamIndex - b.rec.teamIndex);
}

function recWasWipe(exp: Expedition, entry: { next: GroundStepRecord | null; live: GroundTeamRun | null }): boolean {
  if (entry.next) return entry.next.step === "return" && entry.next.recovered === true;
  const ops = exp.groundOps;
  return entry.live !== null && ops !== undefined && awaitingPickup(ops, entry.live) !== null;
}

// Has the run touched this task (a crew on it, progress, a fight, an ambush, a banked segment)? Untouched queued
// tasks live in the queue screen only. Pure.
export function taskTouched(exp: Pick<Expedition, "groundOps">, task: ExpeditionActivity): boolean {
  if (task.status === undefined) return false;
  if (task.done || task.status === "done" || task.status === "active") return true;
  if ((task.progress ?? 0) > 0 || (task.fightCount ?? 0) > 0 || (task.segmentsBanked ?? 0) > 0 || (task.ambushes ?? 0) > 0) return true;
  return (exp.groundOps?.teams ?? []).some((t) => t.taskId === task.id);
}

const PAUSED_STEP_WORDS: Partial<Record<GroundStepKind, string>> = {
  return: "heading back",
  offload: "offloading",
  bay: "in the med bay",
  reload: "reloading",
};

// One task's progress card. Pure.
export function taskCardView(exp: Expedition, ship: ShipInstance | null | undefined, task: ExpeditionActivity, now: number): TaskCardView {
  const ops = exp.groundOps;
  const teams = ops?.teams ?? [];
  const name = taskName(task);
  let bodyIndex = -1;
  exp.bodies.forEach((b, i) => {
    if (b.activities.some((a) => a.id === task.id)) bodyIndex = i;
  });
  const where = bodyIndex >= 0 ? bodyTitle(exp, exp.bodies[bodyIndex], bodyIndex) : "";
  const done = task.done || task.status === "done";
  const onIt = teams.filter((t) => t.taskId === task.id && t.step !== "idle");
  // The crew in the field (deploy / work / fight / staging), and a crew back from it (return to reload).
  const inField = onIt.filter((t) => t.step === "deploy" || t.step === "work" || t.step === "fight" || t.step === "staging");
  const backFrom = onIt.filter((t) => PAUSED_STEP_WORDS[t.step] !== undefined);
  const records = taskRecords(exp, task.id);
  const fights = records.filter((e) => e.rec.step === "fight");
  const lastFight = fights.length > 0 ? fights[fights.length - 1] : null;
  const queueStatus = queueTaskStatus(exp, task);

  let state: TaskCardState;
  let stateText: string;
  if (done) {
    state = "done";
    stateText = "Done";
  } else if (task.status === "skipped") {
    state = "skipped";
    stateText = "Skipped";
  } else if (task.status === "active" && inField.length > 0) {
    state = "inProgress";
    stateText = inField.every((t) => t.step === "staging") ? "In progress: gathering the crew" : "In progress";
  } else if (backFrom.length > 0 || (task.progress ?? 0) > 0 || (task.fightCount ?? 0) > 0 || (task.ambushes ?? 0) > 0) {
    state = "paused";
    const back = backFrom[0];
    if (back) {
      const pickup = back.step === "return" && ops !== undefined && awaitingPickup(ops, back) !== null;
      stateText = `Paused: ${runTeamName(ship, back.index)} ${pickup ? "waiting for the ship" : PAUSED_STEP_WORDS[back.step]}`;
    } else if (queueStatus === "stuck") stateText = "Paused: stuck";
    else if (queueStatus === "sentBack") stateText = "Paused: back of the line";
    else stateText = "Paused: queued to resume";
  } else {
    state = "queued";
    stateText = "Queued";
  }

  const crewIdx = onIt.length > 0 ? onIt.map((t) => t.index) : (task.assignedTeamIds ?? []).filter((i) => teams.some((t) => t.index === i));
  const crew = [...new Set(crewIdx)]
    .sort((a, b) => a - b)
    .map((i) => {
      const team = teams.find((t) => t.index === i);
      return { index: i, kind: team ? runKind(team) : DEFAULT_GROUND_TEAM_KIND, name: runTeamName(ship, i) };
    });

  // The bar and its pips.
  const points = task.fightPoints ?? [];
  const cleared = Math.max(0, Math.min(points.length, task.pointsCleared ?? 0));
  const progressPct = done ? 100 : wholePct(groundTaskProgressAt(exp, task, now));
  // A point fight under way now (a surprise fight and a reinforcement fight hold no point).
  const fightingNow = onIt.some((t) => t.step === "fight" && t.pendingFight?.surprise !== true && t.pendingFight?.reinforcement !== true);
  // The held point: the last fight on this objective was a lost POINT fight (not a surprise, not a reinforcement
  // fight: AF-1, it carries the objective's pointIndex but strikes between points) and the bar sits at it.
  const heldLoss =
    !done &&
    lastFight !== null &&
    lastFight.rec.outcome === "loss" &&
    lastFight.rec.surprise !== true &&
    lastFight.rec.reinforcement !== true &&
    cleared < points.length &&
    (task.progress ?? 0) >= points[cleared] - 1e-9;
  const heldWipe = heldLoss && lastFight !== null && recWasWipe(exp, lastFight);
  const pips: TaskPipView[] = points.map((at, i) => {
    const n = i + 1;
    if (i < cleared) return { at: wholePct(at), state: "won", label: `fight ${n} won` };
    if (i === cleared && !done) {
      if (fightingNow && (task.progress ?? 0) >= at - 1e-9) return { at: wholePct(at), state: "fighting", label: `fight ${n}: under way` };
      if (heldWipe) return { at: wholePct(at), state: "wiped", label: `fight ${n}: wiped here, resumes here` };
      if (heldLoss) return { at: wholePct(at), state: "lost", label: `fight ${n}: lost here, resumes here` };
    }
    return { at: wholePct(at), state: "pending", label: `fight ${n}` };
  });

  let pointText: string;
  if (points.length === 0) pointText = done ? "Done: no fights on this objective" : task.status === "skipped" ? "Skipped" : "No fights expected";
  else if (done) pointText = `Done: ${plural(points.length, "fight", "fights")} won`;
  else if (task.status === "skipped") pointText = `Skipped with ${cleared} of ${plural(points.length, "fight", "fights")} won`;
  else if (heldLoss) {
    pointText = `Progress held at ${wholePct(task.progress ?? 0)}%: ${heldWipe ? "Security wiped" : "lost"} at fight ${cleared + 1}; the retry resumes there`;
  } else if (cleared === 0) pointText = `${plural(points.length, "fight", "fights")} ahead; the first at ${wholePct(points[0])}%`;
  else if (cleared < points.length) pointText = `${cleared} of ${plural(points.length, "fight", "fights")} won; next at ${wholePct(points[cleared])}%`;
  else pointText = `All ${plural(points.length, "fight", "fights")} won; the last stretch of work remains`;

  const N = segmentCount(task);
  const banked = Math.max(0, Math.min(N, task.segmentsBanked ?? 0));
  const offloaded = Math.max(0, Math.min(banked, task.segmentsOffloaded ?? 0));
  let haulText: string;
  if (banked === 0) haulText = `Haul: none banked yet (${plural(N, "segment", "segments")} in all)`;
  else if (offloaded === banked) haulText = `Haul: ${banked} of ${plural(N, "segment", "segments")} banked, all offloaded`;
  else haulText = `Haul: ${banked} of ${plural(N, "segment", "segments")} banked, ${offloaded} offloaded; the rest on the next offload`;
  if (!done && task.status !== "skipped") haulText += ". The relic roll waits for 100%";

  // Notes from the history (capped, so an old note may have aged out; the stored ambush count backs it up).
  const notes: string[] = [];
  let retreats = 0;
  for (const e of records) {
    if (e.rec.step === "work" && e.rec.ambushed && (e.next?.step === "return" || (e.next === null && e.live?.step === "return"))) retreats += 1;
  }
  const surpriseWon = fights.filter((e) => e.rec.surprise && e.rec.outcome === "win").length;
  const surpriseLost = fights.filter((e) => e.rec.surprise && e.rec.outcome === "loss").length;
  const reinforcementWon = fights.filter((e) => e.rec.reinforcement && e.rec.outcome === "win").length;
  const reinforcementLost = fights.filter((e) => e.rec.reinforcement && e.rec.outcome === "loss").length;
  if (retreats > 0) notes.push(retreats === 1 ? "Retreated from an ambush" : `Retreated from ${retreats} ambushes`);
  if (surpriseWon > 0) notes.push(surpriseWon === 1 ? "Won a surprise fight" : `Won ${surpriseWon} surprise fights`);
  if (surpriseLost > 0) notes.push(surpriseLost === 1 ? "Lost a surprise fight" : `Lost ${surpriseLost} surprise fights`);
  if (reinforcementWon > 0) notes.push(reinforcementWon === 1 ? "Beat back reinforcements once" : `Beat back reinforcements ${reinforcementWon} times`);
  if (reinforcementLost > 0) notes.push(reinforcementLost === 1 ? "Lost a fight to reinforcements" : `Lost ${reinforcementLost} fights to reinforcements`);
  const told = retreats + surpriseWon + surpriseLost;
  if ((task.ambushes ?? 0) > told) notes.push((task.ambushes ?? 0) === 1 ? "Ambushed once" : `Ambushed ${task.ambushes} times`);
  if (records.some((e) => e.rec.stopped)) notes.push(task.status === "skipped" ? `Skipped partway: progress kept at ${wholePct(task.progress ?? 0)}%` : "Stopped once by your edit");
  if (!done && groundTaskStuck(task)) notes.push(queueStatus === "stuck" ? "Stuck: needs a stronger team or a skip" : "3 losses in a row: back of the line");

  // The haul offloaded so far (one finding per offloaded batch).
  const prefix = groundTaskFindingPrefix(exp, task.id);
  const parts = exp.findings.filter((f) => f.id.startsWith(prefix));
  let haul: TaskCardView["haul"] = null;
  if (parts.length > 0) {
    const mats: Record<string, number> = {};
    let credits = 0;
    let relicTier: string | null = null;
    for (const f of parts) {
      for (const [id, qty] of Object.entries(f.materials ?? {})) mats[id] = (mats[id] ?? 0) + qty;
      credits += f.credits ?? 0;
      if (f.relic) relicTier = f.relic.tier;
    }
    haul = {
      materials: Object.entries(mats)
        .filter(([, q]) => q > 0)
        .map(([id, qty]) => ({ id, label: ITEMS[id]?.label ?? id, qty })),
      credits,
      relicTier,
    };
  }

  return {
    id: task.id,
    name,
    where,
    state,
    stateText,
    crew,
    progressPct,
    pips,
    affixes: done || task.status === "skipped" ? pillsOnly(task, now) : objectiveAffixesView(task, now),
    barLabel: `${name}: ${progressPct}% done. ${pointText}.`,
    pointText,
    haulText,
    notes,
    haul,
  };
}

// A finished or skipped objective keeps its pills but shows no alert (nothing is left to retry). Pure.
function pillsOnly(task: ExpeditionActivity, now: number): ObjectiveAffixesView | null {
  const v = objectiveAffixesView(task, now);
  return v && v.pills.length > 0 ? { pills: v.pills, alert: null } : null;
}

const CARD_ORDER: Record<TaskCardState, number> = { inProgress: 0, paused: 1, queued: 2, done: 3, skipped: 4 };

// The task cards of a run: every task the run has touched (taskTouched), in progress first, then paused, done
// and skipped; discovery order within each. Pure.
export function taskCardsView(exp: Expedition, ship: ShipInstance | null | undefined, now: number): { cards: TaskCardView[]; done: number; total: number } {
  const all = exp.bodies.flatMap((b) => b.activities.filter((a) => a.status !== undefined));
  const cards = all
    .filter((t) => taskTouched(exp, t))
    .map((t, i) => ({ card: taskCardView(exp, ship, t, now), i }))
    .sort((a, b) => CARD_ORDER[a.card.state] - CARD_ORDER[b.card.state] || a.i - b.i)
    .map((x) => x.card);
  return { cards, done: all.filter((t) => t.done || t.status === "done").length, total: all.length };
}

// ===== The medical bay card (GO-M4 right) =====

export const BAY_CARD_NOTE = "Everything heals at once; the bay time is the longest bar.";
export const CLASS_TEXT: Record<ConditionClass, string> = { health: "health", ailment: "ailment", injury: "injury" };

export interface BayRowView {
  key: string;
  conditionId: string;
  label: string; // "Fracture"
  cls: ConditionClass;
  who: string; // "Grokk (injury, Stoneskin)", "everyone (health)"
  seconds: number;
  timeText: string; // "25m"; the longest row in the bay also reads the time left: "25m (12m 3s left)"
  widthPct: number;
  longest: boolean;
  stoneskin: boolean;
}

export interface BayCardView {
  teamIndex: number;
  letter: string;
  name: string;
  kind: GroundTeamKind;
  title: string; // "Medical bay · Alpha"
  inBay: boolean;
  rows: BayRowView[];
  baySeconds: number;
  bayText: string; // "Bay time: 37m 30s (the longest one)"
  statusText: string; // "12m left" | "Starts after the offload"
  stoneskinNote: string | null;
  careText: string | null; // the ship's medical care, when it shortens anything
}

type MemberLookup = readonly Pick<AwayMember, "id" | "name">[];

// The bay card of one team: shown while it carries conditions home (return, offload) and during its bay; null
// otherwise. Each condition's cure time is the engine's (medicalBay.ts conditionCureSeconds on the run's frozen
// care, the member's frozen perks); one row per condition, members with the same condition and the same time
// share a row. Pure.
export function bayCardView(
  exp: Expedition,
  ship: ShipInstance | null | undefined,
  team: GroundTeamRun,
  now: number,
  members: MemberLookup,
): BayCardView | null {
  const ops = exp.groundOps;
  if (!ops) return null;
  const inBay = team.step === "bay" && team.stepEndsAt !== null && team.stepEndsAt > now;
  const heading = team.step === "return" || team.step === "offload";
  if (!inBay && !heading) return null;
  const care = groundOpsBayCare(ops.factors);
  const snapshots = [...(exp.roster?.security ?? []), ...(exp.roster?.science ?? [])];
  const nameOf = (id: string): string => members.find((m) => m.id === id)?.name ?? id;
  const ids = [...new Set([...team.securityIds, ...team.scienceIds])];
  interface Cell {
    conditionId: string;
    seconds: number;
    memberIds: string[];
    stoneskin: boolean;
  }
  const cells: Cell[] = [];
  const stoneskinNames: string[] = [];
  for (const id of ids) {
    const perks = snapshots.find((m) => m.memberId === id)?.perks ?? [];
    const stone = perks.includes("stoneskin");
    let hasInjury = false;
    for (const cid of team.conditions[id] ?? []) {
      if (!Object.prototype.hasOwnProperty.call(GROUND_CONDITIONS, cid)) continue; // a battle-only status: no bay time
      const def = GROUND_CONDITIONS[cid];
      const seconds = conditionCureSeconds(def, perks, care);
      const marked = stone && def.cls === "injury";
      if (def.cls === "injury") hasInjury = true;
      const cell = cells.find((c) => c.conditionId === cid && c.seconds === seconds && c.stoneskin === marked);
      if (cell) cell.memberIds.push(id);
      else cells.push({ conditionId: cid, seconds, memberIds: [id], stoneskin: marked });
    }
    if (stone && hasInjury) stoneskinNames.push(nameOf(id));
  }
  if (cells.length === 0) return null;
  const longest = Math.max(...cells.map((c) => c.seconds));
  cells.sort((a, b) => b.seconds - a.seconds || ids.indexOf(a.memberIds[0]) - ids.indexOf(b.memberIds[0]));
  const rows: BayRowView[] = cells.map((c) => {
    const def = GROUND_CONDITIONS[c.conditionId];
    const everyone = ids.length > 1 && c.memberIds.length === ids.length;
    const names = everyone ? "everyone" : c.memberIds.map(nameOf).join(", ");
    const tags = [CLASS_TEXT[def.cls], ...(c.stoneskin ? ["Stoneskin"] : [])].join(", ");
    return {
      key: `${c.conditionId}-${c.seconds}-${c.memberIds.join(",")}`,
      conditionId: c.conditionId,
      label: def.label,
      cls: def.cls,
      who: `${names} (${tags})`,
      seconds: c.seconds,
      timeText: inBay && c.seconds === longest ? `${spanText(c.seconds)} (${leftText(team.stepEndsAt as number, now)})` : spanText(c.seconds),
      widthPct: longest > 0 ? pct(c.seconds / longest) : 0,
      longest: c.seconds === longest,
      stoneskin: c.stoneskin,
    };
  });
  const careTotal = Math.max(0, care.medicalShare) + Math.max(0, care.rapidRecoveryShare) + Math.max(0, care.officerFacetShare);
  const kind = runKind(team);
  const name = runTeamName(ship, team.index);
  const mult = Math.round((STONESKIN_INJURY_MULT - 1) * 100);
  return {
    teamIndex: team.index,
    letter: groundTeamShortLabel(team.index),
    name,
    kind,
    title: `Medical bay · ${name}`,
    inBay,
    rows,
    baySeconds: longest,
    bayText: `Bay time: ${spanText(longest)} (the longest one)`,
    statusText: inBay ? leftText(team.stepEndsAt as number, now) : team.step === "offload" ? "Starts after the offload" : "Starts once the team is aboard",
    stoneskinNote:
      stoneskinNames.length > 0
        ? `${stoneskinNames.join(", ")} ${stoneskinNames.length === 1 ? "is" : "are"} Ossir: Stoneskin makes injuries last ${mult}% longer.`
        : null,
    careText: careTotal > 0 ? "Times include the ship's medical care." : null,
  };
}

// Every team's bay card that shows now, ascending team index. Pure.
export function bayCardsView(exp: Expedition, ship: ShipInstance | null | undefined, now: number, members: MemberLookup): BayCardView[] {
  const out: BayCardView[] = [];
  for (const team of exp.groundOps?.teams ?? []) {
    const card = bayCardView(exp, ship, team, now, members);
    if (card) out.push(card);
  }
  return out;
}

// The activities phase's name on a Ground Ops run (plan GO-14) [PROVISIONAL copy]; legacy runs keep "Activities".
export const GROUND_OPS_PHASE_LABEL = "Ground Operations";
export function activitiesPhaseLabel(exp: Pick<Expedition, "groundOps">): string {
  return exp.groundOps ? GROUND_OPS_PHASE_LABEL : "Activities";
}
