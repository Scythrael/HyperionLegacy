// OC-F14 (user answers 2026-11-12 on docs/mockups/2026-11-11-field-repair-order-mockup.html, Option A): the FIELD
// REPAIR STRIP under the Ship lane's track (FieldRepairStrip.svelte), in the approved Overtime strip's shape. It shows the
// run's hull readout whenever the hull is below full, the one-tap order with its preview (where the ship will repair, the
// faster of the nearest repair world and orbit, and how long), the order's progress with a one-tap Cancel,
// and each refusal in words. Every number is the engine's (groundOps.ts fieldRepairPlan, the stored repair legs); this
// module only words them. Pure.

import type { Expedition, GroundRepairLeg } from "./game/model";
import {
  FIELD_REPAIR_DAMAGE_SHARE,
  ORBIT_REPAIR_TIME_MULT,
  fieldRepairBlockText,
  fieldRepairCancelBlock,
  fieldRepairCancelBlockText,
  fieldRepairPlan,
  groundShipPosition,
  type FieldRepairBlockReason,
  type FieldRepairCancelBlockReason,
} from "./game/groundOps";
import { bodyDesignation, bodyTitle } from "./groundTaskQueueDisplay";
import { spanText } from "./groundOpsTimelineDisplay";
import type { IconName } from "./ui/icons";

// A run of text, bold or not (the strip renders the bold parts in the mono face, as drawn).
export interface TextPart {
  text: string;
  bold?: true;
}

export type FieldRepairStripState = "available" | "ordered" | "repairing" | "repaired" | "canceled" | "auto" | "over" | "older";

export interface FieldRepairStripView {
  state: FieldRepairStripState;
  tagOff: boolean; // the "Hull" tag dims when nothing can be ordered
  hull: { fillPct: number; markPct: number; title: string } | null; // the bar (null on an older run, as drawn)
  numbersWide: TextPart[] | null;
  numbersNarrow: TextPart[] | null;
  // The order button: enabled only when the order can be given; null when a state chip stands in its place.
  order: { enabled: boolean; text: string; glyph: IconName | null } | null;
  chip: { tone: "going" | "ok" | "off"; glyph: IconName | null; text: string } | null;
  cancel: boolean; // the one-tap Cancel (the player's own order, until its repair is done)
  progressPct: number | null;
  whenWide: TextPart[] | null;
  whenNarrow: TextPart[] | null;
  dim: string | null; // the dim line (wide only; the phone layout cuts it for space, as drawn)
  why: { glyph: IconName; text: string } | null;
}

const ORDER_TEXT = "Order field repair";
const b = (text: string): TextPart => ({ text, bold: true });
const t = (text: string): TextPart => ({ text });
const pct = (frac: number): number => Math.max(0, Math.min(100, Number.isFinite(frac) ? frac * 100 : 0));
const timesText = (n: number): string => (n === 2 ? "twice" : n === 3 ? "three times" : `${n} times`);

// The share of the hull pool that sends the ship down on its own, in whole hull points (the engine compares damage >= it).
export function autoRepairAt(hullMax: number): number {
  return Math.ceil(FIELD_REPAIR_DAMAGE_SHARE * hullMax);
}

// The repair leg the strip reports: an open one not canceled (the threshold's, or the player's order, at most one),
// else a canceled order still flying back, else null. Pure.
function openLeg(exp: Expedition): GroundRepairLeg | null {
  const open = (exp.groundOps?.repairLegs ?? []).filter((leg) => !leg.done);
  return open.find((leg) => leg.canceled !== true) ?? open.find((leg) => leg.canceled === true) ?? null;
}

// The strip for `exp` at `now`, or null when it is not shown: not a Ground Operations run, the window not open yet, a
// run without ship events, or a whole hull with no repair under way (user 2026-11-12: "shown when the hull is
// damaged"; a finished repair stays in the Ship's steps, the strip does not linger). Pure.
export function fieldRepairStripView(exp: Expedition, now: number): FieldRepairStripView | null {
  const ops = exp.groundOps;
  const battle = ops?.shipEventProfile?.battle;
  if (!ops || ops.startedAt === undefined || !battle) return null;
  const max = Math.round(battle.hullMax);
  const autoAt = autoRepairAt(battle.hullMax);
  const leg = openLeg(exp);
  // The repair's share is gone once its repairing ends (the engine settles it at the leg's end, after the flight back;
  // nothing can strike the ship on that flight, so the readout shows it repaired). Once the operations are over (a
  // recall) a leg left unsettled never settles: the recall settled every repair it keeps (groundOps.ts closeGroundOps),
  // so the readout is the hull the ship carries home.
  let carried = ops.hullDamage ?? 0;
  if (ops.endedAt === undefined) for (const l of ops.repairLegs ?? []) if (!l.done && now >= l.repairedAt) carried -= l.hullRepaired;
  const damage = Math.max(0, Math.round(carried));
  const scanning = exp.bodies.some((body) => !body.scanned);
  const hull = { fillPct: pct(damage / Math.max(1, battle.hullMax)), markPct: pct(FIELD_REPAIR_DAMAGE_SHARE), title: `${damage} of ${max} damage; the ship repairs on its own at ${autoAt}` };
  const short: TextPart[] = [b(String(damage)), t(` of ${max}`)];
  const base = { tagOff: false, hull, numbersWide: short, numbersNarrow: short, order: null, chip: null, cancel: false, progressPct: null, whenWide: null, whenNarrow: null, dim: null, why: null };
  const offOrder = { enabled: false, text: ORDER_TEXT, glyph: null };

  // A run launched before field repairs: the reason, no bar (as drawn).
  if (battle.repairSpeed === undefined) {
    if (damage <= 0) return null;
    return { ...base, state: "older", tagOff: true, hull: null, numbersWide: null, numbersNarrow: null, order: offOrder, why: { glyph: "info", text: `${fieldRepairBlockText("noFieldRepair")}.` } };
  }
  // The operations are over (heading home, or recalled): the Shipyard repairs what is left.
  if (ops.endedAt !== undefined) {
    if (damage <= 0) return null;
    return { ...base, state: "over", tagOff: true, order: offOrder, why: { glyph: "info", text: `${fieldRepairBlockText("runFinished")}.` } };
  }

  // A canceled order flying back with damage still to fix: the order is offered again (it waits for the ship), with
  // the canceled leg's line first.
  let canceledLine: TextPart[] = [];
  if (leg && leg.canceled === true && damage > 0) {
    canceledLine = [t("Canceled: "), b(String(Math.round(leg.hullRepaired))), t(` hull repaired, ${scanning ? "back on the scan" : "back"} in `), b(spanText(Math.ceil(leg.endsAt - now))), t(". ")];
  } else if (leg) {
    const progressPct = now >= leg.startsAt ? pct((now - leg.startsAt) / Math.max(1, leg.endsAt - leg.startsAt)) : null;
    const back = leg.endsAt - leg.repairedAt;
    const cancel = fieldRepairCancelBlock(exp, now) === null;
    const cancelDim = cancel ? "Cancel keeps the repair finished so far." : null;
    // The threshold's own repair (not the player's order): the reason, as drawn.
    if (leg.ordered !== true) {
      if (now < leg.repairedAt) {
        return { ...base, state: "auto", tagOff: true, chip: { tone: "going", glyph: "shipyard", text: "Repairing" }, why: { glyph: "info", text: `${fieldRepairBlockText("alreadyRepairing")} (after heavy damage).` } };
      }
      return { ...base, state: "repaired", chip: { tone: "ok", glyph: "check", text: "Repaired" }, progressPct };
    }
    if (now < leg.startsAt) {
      const pos = groundShipPosition(exp, now).kind;
      const what = pos === "recovery" ? "back from the pickup" : pos === "study" ? "done with its study" : pos === "repair" ? "back" : "free";
      const when = [t(`Starts when the ship is ${what}, in `), b(spanText(Math.ceil(leg.startsAt - now))), t(".")];
      // No dim line here: a cancel before the start just withdraws the order (nothing is repaired yet).
      return { ...base, state: "ordered", chip: { tone: "going", glyph: "clock", text: "Ordered" }, cancel, whenWide: when, whenNarrow: when };
    }
    if (now < leg.repairedAt) {
      let when: TextPart[];
      if (now < leg.arrivesAt) when = scanning ? [t("Back on the scan in "), b(spanText(Math.ceil(leg.endsAt - now))), t(".")] : [t("Done in "), b(spanText(Math.ceil(leg.endsAt - now))), t(".")];
      else if (back > 0) when = [t("Damage clears when the repair ends, then "), b(spanText(back)), t(" back.")];
      else when = [t("Damage clears when the repair ends, in "), b(spanText(Math.ceil(leg.repairedAt - now))), t(".")];
      return { ...base, state: "repairing", chip: { tone: "going", glyph: "shipyard", text: "Repairing" }, cancel, progressPct, whenWide: when, whenNarrow: when, dim: cancelDim };
    }
    if (leg.canceled) {
      const left = spanText(Math.ceil(leg.endsAt - now));
      const when = [t("Canceled: "), b(String(Math.round(leg.hullRepaired))), t(" hull repaired. "), t(scanning ? "Back on the scan in " : "Back in "), b(left), t(".")];
      return { ...base, state: "canceled", chip: { tone: "off", glyph: null, text: "Canceled" }, progressPct, whenWide: when, whenNarrow: when };
    }
    return { ...base, state: "repaired", chip: { tone: "ok", glyph: "check", text: "Repaired" }, progressPct };
  }

  // A whole hull with no repair under way: no strip (the finished repair stays in the Ship's steps).
  if (damage <= 0) return null;

  // Available: the order and its preview (the engine's plan, exactly what the order would store now).
  const plan = fieldRepairPlan(exp, now);
  if (!plan) return null;
  const at = plan.siteBodyIndex;
  const long = (i: number): string => bodyTitle(exp, exp.bodies[i], i);
  const brief = (i: number): string => `${exp.systemName} ${bodyDesignation(exp, i)}`;
  const waitsWide = scanning ? "The scan waits that long; the teams keep working." : "The teams keep working.";
  const waitsNarrow = scanning ? "The scan waits; the teams keep working." : "The teams keep working.";
  let whenWide: TextPart[];
  let whenNarrow: TextPart[];
  if (at !== null && plan.travelSeconds === 0) {
    const where = scanning ? "the body it scans" : "where it holds station";
    whenWide = [t("Sets down at "), b(long(at)), t(`, ${where}: repairs in `), b(spanText(plan.repairSeconds)), t(`, no flight. ${waitsWide}`)];
    whenNarrow = [t("Sets down at "), b(brief(at)), t(`, ${where}: `), b(spanText(plan.repairSeconds)), t(`, no flight. ${waitsNarrow}`)];
  } else if (at !== null) {
    const tail = (name: string): TextPart[] => [
      t("Flies to "),
      b(name),
      t(" ("),
      b(spanText(plan.travelSeconds)),
      t("), repairs "),
      b(spanText(plan.repairSeconds)),
      t(", flies back ("),
      b(spanText(plan.travelSeconds)),
      t(scanning ? "). The scan waits " : "). Back in "),
      b(spanText(plan.totalSeconds)),
      t("."),
    ];
    whenWide = tail(long(at));
    whenNarrow = tail(brief(at));
  } else if (plan.passedWorld) {
    const w = plan.passedWorld;
    const tail = (name: string, waits: string): TextPart[] => [t("Repairs "), b("in orbit"), t(", "), b(spanText(plan.repairSeconds)), t(": sooner than flying to "), b(name), t(" ("), b(spanText(w.totalSeconds)), t(`). ${waits}`)];
    whenWide = tail(long(w.bodyIndex), waitsWide);
    whenNarrow = tail(brief(w.bodyIndex), waitsNarrow);
  } else {
    whenWide = [t("No world here to set down on: repairs "), b("in orbit"), t(", "), b(spanText(plan.repairSeconds)), t(` (${timesText(ORBIT_REPAIR_TIME_MULT)} the Shipyard's time).`)];
    whenNarrow = whenWide;
  }
  if (plan.startsAt > now) {
    const later = [t(" Starts when the ship is free, in "), b(spanText(Math.ceil(plan.startsAt - now))), t(".")];
    whenWide = [...whenWide, ...later];
    whenNarrow = [...whenNarrow, ...later];
  }
  whenWide = [...canceledLine, ...whenWide];
  whenNarrow = [...canceledLine, ...whenNarrow];
  return {
    ...base,
    state: "available",
    progressPct: leg && leg.canceled === true ? pct((now - leg.startsAt) / Math.max(1, leg.endsAt - leg.startsAt)) : null,
    numbersWide: [b(String(damage)), t(` damage of ${max} · auto at ${autoAt}`)],
    numbersNarrow: [b(String(damage)), t(` of ${max} · auto at ${autoAt}`)],
    order: { enabled: true, text: ORDER_TEXT, glyph: "shipyard" },
    whenWide,
    whenNarrow,
    // Past the threshold with no repair under way (an order canceled after it crossed): the next hit sends it down.
    dim: `Free. Fixes all ${damage} damage. Without it the ship repairs on its own ${damage < autoAt ? `at ${autoAt}` : "after its next hit"}, or in the Shipyard at home.`,
  };
}

// The host's log line for an order or a cancel the engine applied (App.svelte doOrderFieldRepair /
// doCancelFieldRepair), read on the run AFTER it: the order names where and how long; the cancel names the hull it kept,
// or that the order was withdrawn before the ship set out. Pure.
export function fieldRepairLogText(after: Expedition, action: "order" | "cancel"): string {
  const legs = after.groundOps?.repairLegs ?? [];
  if (action === "cancel") {
    const cut = [...legs].reverse().find((l) => l.canceled === true && l.ordered === true);
    return cut ? `Field repair canceled: ${Math.round(cut.hullRepaired)} hull repaired.` : "Field repair order withdrawn before the ship set out.";
  }
  const leg = legs[legs.length - 1];
  if (!leg) return "Field repair ordered.";
  const site = leg.siteBodyIndex !== null ? after.bodies[leg.siteBodyIndex] : undefined;
  const where = site && leg.siteBodyIndex !== null ? `at ${bodyTitle(after, site, leg.siteBodyIndex)}` : "in orbit";
  return `Field repair ordered ${where}: ${spanText(leg.endsAt - leg.startsAt)}.`;
}

// A refusal of the order or the cancel in plain words (the engine's words for its own reasons). Exhaustive. Pure.
export function fieldRepairRefusalText(reason: "noExpedition" | "notGroundOps" | FieldRepairBlockReason | FieldRepairCancelBlockReason): string {
  switch (reason) {
    case "noExpedition":
      return "The expedition is no longer running";
    case "notGroundOps":
      return "This expedition has no ground operations";
    case "noOrder":
    case "repaired":
      return fieldRepairCancelBlockText(reason);
    case "noFieldRepair":
    case "noDamage":
    case "alreadyRepairing":
    case "runFinished":
      return fieldRepairBlockText(reason);
  }
}
