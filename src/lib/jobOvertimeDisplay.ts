// OT-UI (0.14.0): the Overtime strip on every running job Overtime is offered on, a pure view model.
//
// Spec: the 2026-11-10 Overtime buttons mockup (docs/mockups/2026-11-10-overtime-buttons-mockup.html, user "The mockup
// is majestic. Make it so!") and the USER ANSWERS (2026-11-10): OT-UI in docs/plans/2026-10-16-credit-sinks-pass.md:
//   - "One tap, always visible": the strip sits under every running job's own progress row, the button buys the next
//     step at once (no confirm), the pips count 0 to 3 steps, a disabled state says why, the top state reads "At its
//     fastest". The house pattern is the gear card's strip (gearWearDisplay.ts gearOvertimeStrip).
//   - "Chip + no jump": a "1.25x" rate chip on the time line (overtimeRate.ts overtimeRateText); every bar on these rows
//     reads processSpeed.ts processWorkFraction, so a purchase never moves the bar.
//   - "Match each row": each strip speaks its host row's own clock (the host passes it in: "04:48" on Shipyard and
//     facility rows, "~3m 12s" on the repair banner, "12 min 40 s" on the data study).
// Every number is the engine's (processSpeed.ts canBuyOvertime: the step, its exact cost, the ticks it saves; the price
// rule is the job's FULL length x its tier, fixed when the job started). Pure: no DOM, no clock.

import { BLUEPRINTS, FACILITIES, ITEMS, SHIP_TYPES, type GameState, type TimedProcess } from "./game/model";
import { OVERTIME_MAX_STEPS, OVERTIME_PROCESS_KINDS, OVERTIME_STEP_RATE, buyOvertime, canBuyOvertime, overtimeTier } from "./game/processSpeed";
import { overtimeRateText } from "./game/overtimeRate";

// buy: the button buys the next step. credits: short of the step's price (the exact price and what is missing).
// paused: a data study while auto-study is off (the engine's "paused"). max: all steps bought ("At its fastest").
export type JobOvertimeState = "buy" | "credits" | "paused" | "max";

export interface JobOvertimeStrip {
  processId: string;
  steps: number; // bought so far (the pips)
  maxSteps: number;
  rateText: string | null; // "1.25x" once a step is bought
  state: JobOvertimeState;
  cost: number | null; // the next step's exact price (buy, credits)
  need: number | null; // the credits still missing (credits)
  // The button's face: "+25% · 200 cr" (buy), "1,200 cr · need 50 more" (credits), "Paused" (paused); null at max.
  button: string | null;
  // The time line, in the host row's own clock: "Done in" / "Next step: done in" + the new time + "instead of" the
  // time now (buy), or "Done in" + the time now (credits, max). Null on a paused study (the reason line instead).
  when: { lead: string; time: string; was: string | null } | null;
  // The dim pricing line (buy, credits); its tail is the long-form clause the phone layout drops (the mockup's
  // shortened phone line), and a note with a tail takes its closing period after it. Both empty when there is none.
  note: string;
  noteTail: string;
  // Why it is off (paused).
  why: string | null;
}

function credits(n: number): string {
  return `${n.toLocaleString("en-US")} cr`;
}

// A job's full length, as the pricing line names it: "10 min", "5 min 20 s", "45 s", "2 h 15 min". Pure.
export function jobLengthText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return r > 0 ? `${m} min ${r} s` : `${m} min`;
  return `${r} s`;
}

// What the job is, for the pricing line ("build", "repair", "project", "study", "rung", "cycle"). Pure.
export function jobNoun(p: TimedProcess): string {
  switch (p.kind) {
    case "shipBuild":
      return "build";
    case "shipRepair":
      return "repair";
    case "researchProject":
      return "project";
    case "dataStudy":
      return "study";
    case "facilityUpgrade":
      return p.effect.type === "facilityLevelUp" && p.effect.facility === "subspaceTelescope" ? "cycle" : "rung";
    default:
      return "rung";
  }
}

function isRung(p: TimedProcess): boolean {
  return p.kind === "facilityUpgrade" || p.kind === "docksExpansion" || p.kind === "transitBerthExpansion" || p.kind === "equipmentStorageUpgrade";
}

// The job by name, for the System Log line ("the Destroyer build", "Kestrel's hull repair"). Pure.
export function jobSubject(state: GameState, p: TimedProcess): string {
  const e = p.effect;
  if (e.type === "addShip") return `the ${SHIP_TYPES[e.typeKey]?.label ?? e.typeKey} build`;
  if (e.type === "clearShipDamage") {
    const ship = state.ships.find((s) => s.id === e.shipId);
    const name = ship ? ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.typeKey : e.shipId;
    return `${name}'s hull repair`;
  }
  if (e.type === "unlockBlueprint") return `the ${BLUEPRINTS[e.key]?.label ?? e.key} project`;
  if (e.type === "studyData") return `the ${ITEMS[e.itemId]?.label ?? e.itemId} study`;
  if (e.type === "facilityLevelUp") {
    const label = FACILITIES[e.facility]?.label ?? e.facility;
    const next = (state.facilities[e.facility]?.level ?? 0) + 1;
    return e.facility === "subspaceTelescope" ? `the ${label} cycle ${next}` : `the ${label} upgrade to level ${next}`;
  }
  if (p.kind === "docksExpansion") return "the Docks expansion";
  if (p.kind === "transitBerthExpansion") return "the docking bay expansion";
  if (p.kind === "equipmentStorageUpgrade") return "the Systems Bay upgrade";
  return "the job";
}

// The pricing line (the engine's rule: the job's whole length x its tier, fixed for the job). Pure.
function pricing(state: GameState, p: TimedProcess, steps: number): { note: string; noteTail: string } {
  const length = jobLengthText(p.durationTicks * state.tickDurationSeconds);
  const tier = overtimeTier(state, p);
  const level = isRung(p) ? " (the level being built)" : "";
  const head = `Priced on the whole ${length} ${jobNoun(p)} at Tier ${tier}${level}`;
  return steps === 0 ? { note: `Optional. ${head}`, noteTail: ", so a step costs the same whenever you buy it" } : { note: `${head}.`, noteTail: "" };
}

// The Overtime strip for a running job, in its host row's `clock` (ticks to the row's own time text), or null where
// the engine hides it: a kind Overtime is not offered on, a job on its last tick ("finishing": it would buy nothing),
// a job the tutorial time skip finished, a job that is gone. Pure.
export function jobOvertimeStrip(state: GameState, p: TimedProcess, clock: (ticks: number) => string): JobOvertimeStrip | null {
  if (!OVERTIME_PROCESS_KINDS.includes(p.kind)) return null;
  const steps = p.speed?.overtimeSteps ?? 0;
  const done = p.kind === "shipRepair" ? "Repaired in" : "Done in";
  const base = { processId: p.id, steps, maxSteps: OVERTIME_MAX_STEPS, rateText: overtimeRateText(steps) };
  const q = canBuyOvertime(state, { kind: "process", id: p.id });
  if (q.ok) {
    return {
      ...base,
      state: "buy",
      cost: q.cost,
      need: null,
      button: `+${Math.round(OVERTIME_STEP_RATE * 100)}% · ${credits(q.cost)}`,
      when: { lead: steps === 0 ? done : `Next step: ${done.toLowerCase()}`, time: clock(p.remainingTicks - q.ticksSaved), was: clock(p.remainingTicks) },
      ...pricing(state, p, steps),
      why: null,
    };
  }
  switch (q.reason) {
    case "credits": {
      const cost = q.cost ?? 0;
      const need = Math.max(0, Math.ceil(cost - state.credits.toNumber()));
      return {
        ...base,
        state: "credits",
        cost,
        need,
        button: `${credits(cost)} · need ${need.toLocaleString("en-US")} more`,
        when: { lead: done, time: clock(p.remainingTicks), was: null },
        note: "The job carries on at its current speed either way.",
        noteTail: "",
        why: null,
      };
    }
    case "paused":
      return {
        ...base,
        state: "paused",
        cost: null,
        need: null,
        button: "Paused",
        when: null,
        note: "",
        noteTail: "",
        why: "Auto-study is off, so this study is not counting down. Turn it back on to use Overtime.",
      };
    case "maxSteps":
      return {
        ...base,
        state: "max",
        cost: null,
        need: null,
        button: null,
        when: { lead: done, time: clock(p.remainingTicks), was: null },
        note: "",
        noteTail: "",
        why: null,
      };
    default:
      // notFound, notEligible, skipped, finishing: hidden (as the gear strip hides).
      return null;
  }
}

// The rate chip's text for a running job ("1.25x"), or null at the normal rate. Pure.
export function jobRateText(p: TimedProcess): string | null {
  return overtimeRateText(p.speed?.overtimeSteps ?? 0);
}

// One tap on a job strip's button (user "One tap, always visible": no confirm): the engine's buy and the System Log
// line the host pushes ("Overtime on the Destroyer build: step 1 of 3 for 200 cr. Done in 04:48."), the time in the
// host's `clock`. A refusal changes nothing and logs nothing (the strip already shows why). Pure.
export function jobOvertimePurchase(
  state: GameState,
  processId: string,
  clock: (ticks: number) => string,
): { next: GameState; bought: boolean; log: string | null } {
  const ref = { kind: "process" as const, id: processId };
  const p = state.activeProcesses.find((x) => x.id === processId);
  const q = canBuyOvertime(state, ref);
  if (!p || !q.ok) return { next: state, bought: false, log: null };
  const r = buyOvertime(state, ref);
  if (!r.bought) return { next: state, bought: false, log: null };
  const done = p.kind === "shipRepair" ? "Repaired in" : "Done in";
  return {
    next: r.next,
    bought: true,
    log: `Overtime on ${jobSubject(state, p)}: step ${q.step} of ${OVERTIME_MAX_STEPS} for ${credits(q.cost)}. ${done} ${clock(p.remainingTicks - q.ticksSaved)}.`,
  };
}

// The completion log's elapsed line for a job that ran with Overtime (user "Show both times"): "took 08:20 with
// Overtime" and "(10:00 at the normal rate)", in the host's duration format. Pure.
export function overtimeElapsedText(tookText: string, normalText: string): { took: string; normal: string } {
  return { took: `took ${tookText} with Overtime`, normal: `(${normalText} at the normal rate)` };
}
