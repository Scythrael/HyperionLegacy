// overlayRows.ts: the Automation tab's and the Skills tab's rows (0.14.0 prestige redesign, Slice 7), kept
// pure so they are unit tested (this repo has no Svelte component harness, the prestigeCards.ts pattern).
// Display only: every state comes from the engine, so a row never says something the engine does not do.
//
// Built to the signed-off mockup (docs/plans/2026-10-28-automation-skills-mockup.html): an automation is
// "???" until its milestone is visible (and a secret one until it reveals itself), then named with the
// milestone it is earned at, then live with its controls; a skill is "???" while it opens at a milestone not
// visible yet, "gated" while it waits for its gate (the row says exactly when it opens), else open.

import {
  automationUnlocked,
  automationRevealed,
  autoActive,
  autoCaptainWaiting,
  automationBuyAmount,
  milestoneVisible,
  skillLevel,
  skillLevelCost,
  skillStrength,
  skillScaleCount,
  skillScaleFactor,
  skillAvailable,
  skillGateCount,
  canBuySkillLevel,
} from "./engine";
import {
  AUTOMATION_IDS,
  AUTOMATION_NAMES,
  AUTOMATION_LINES,
  AUTOMATION_SHORT_LINES,
  AUTOMATION_UNLOCKS,
  AUTOMATION_BUY_DEFAULT,
  MYSTERY_AUTOMATIONS,
  MILESTONES,
  LEVELED_SKILLS,
  COPY,
  skillEffectParts,
  skillGateLine,
  skillScaleLine,
  automationUnlockedBy,
  automationListLine,
  type AutomationId,
  type AutomationBuy,
  type LeveledSkillId,
  type MilestoneId,
} from "./config";
import type { SecretState, AutoLayer } from "./state";

const milestoneName = (id: MilestoneId) => MILESTONES.find((m) => m.id === id)!.name;

// What an earned automation's controls are: a buy amount (1 / 10 / Max) for the ones that buy, a target
// menu for automatic Captain and Fleet Prestige, the switch alone for Auto Prestigeception (user
// 2026-10-29: it fires at the bar, so its target menu went away).
export type AutomationControl = { kind: "buy"; amount: AutomationBuy } | { kind: "target"; layer: AutoLayer } | { kind: "switch" };

export type AutomationRow =
  | { id: AutomationId; state: "hidden"; name: "???"; line: string; short: string }
  | { id: AutomationId; state: "ahead"; name: string; line: string; short: string; milestone: string }
  | { id: AutomationId; state: "open"; name: string; line: string; short: string; milestone: string; on: boolean; control: AutomationControl; note: string | null };

const TARGET_LAYERS: Partial<Record<AutomationId, AutoLayer>> = { autoCaptain: "captain", autoFleet: "fleet" };

function controlFor(s: SecretState, id: AutomationId): AutomationControl {
  const layer = TARGET_LAYERS[id];
  if (layer !== undefined) return { kind: "target", layer };
  if (AUTOMATION_BUY_DEFAULT[id] !== undefined) return { kind: "buy", amount: automationBuyAmount(s, id) };
  return { kind: "switch" };
}

export function automationRow(s: SecretState, id: AutomationId): AutomationRow {
  const milestone = AUTOMATION_UNLOCKS[id];
  // A secret one (Auto Prestigeception before the first Prestigeception) is ??? however far along it is.
  if (!automationRevealed(s, id)) {
    if (automationUnlocked(s, id) && MYSTERY_AUTOMATIONS[id] !== undefined) return { id, state: "hidden", name: "???", line: COPY.automationSecret, short: COPY.automationSecret };
    return { id, state: "hidden", name: "???", line: COPY.automationHidden, short: COPY.automationHiddenShort };
  }
  if (!automationUnlocked(s, id) && !milestoneVisible(s, milestone)) return { id, state: "hidden", name: "???", line: COPY.automationHidden, short: COPY.automationHiddenShort };
  const base = { id, name: AUTOMATION_NAMES[id], line: AUTOMATION_LINES[id], short: AUTOMATION_SHORT_LINES[id] ?? AUTOMATION_LINES[id], milestone: milestoneName(milestone) };
  if (!automationUnlocked(s, id)) return { ...base, state: "ahead" };
  return { ...base, state: "open", on: autoActive(s, id), control: controlFor(s, id), note: id === "autoCaptain" && autoCaptainWaiting(s) ? COPY.autoCaptainWaiting : null };
}

// Every automation, the earned ones first, then the ones named but not earned yet, then the ??? rows (the
// signed-off mockup lists the earned ones first); within each group the AUTOMATION_IDS order.
export function automationRows(s: SecretState): AutomationRow[] {
  const rows = AUTOMATION_IDS.map((id) => automationRow(s, id));
  const rank = { open: 0, ahead: 1, hidden: 2 } as const;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank[a.r.state] - rank[b.r.state] || a.i - b.i).map(({ r }) => r);
}

export interface SkillRow {
  id: LeveledSkillId;
  state: "open" | "gated" | "hidden";
  name: string; // "???" when hidden
  flavor: string;
  level: number;
  cap: number;
  maxed: boolean;
  // What it does now, split around the value (set in bold), and the next level's value (null when maxed).
  now: { before: string; value: string; after: string };
  next: string | null;
  scale: string | null; // the prestige-count chip, while the count is above 0
  gate: string | null; // how it opens, while it is gated
  cost: number | null; // the next level's Skill Points, null when maxed
  canBuy: boolean;
}

export function skillRow(s: SecretState, id: LeveledSkillId): SkillRow {
  const d = LEVELED_SKILLS.find((x) => x.id === id)!;
  const level = skillLevel(s, id);
  const cost = skillLevelCost(s, id);
  const gate = d.availableAt;
  const open = skillAvailable(s, id);
  const count = skillScaleCount(s, id);
  const row: SkillRow = {
    id,
    state: open || cost === null ? "open" : "gated",
    name: d.name,
    flavor: d.flavor,
    level,
    cap: d.cap,
    maxed: cost === null,
    now: skillEffectParts(id, skillStrength(s, id)),
    next: cost === null ? null : skillEffectParts(id, skillStrength(s, id, level + 1)).value,
    scale: count > 0 ? skillScaleLine(d.scalesOff, count, skillScaleFactor(s, id)) : null,
    gate: null,
    cost,
    canBuy: canBuySkillLevel(s, id),
  };
  if (row.state === "open") return row;
  // A skill that opens at a milestone not visible yet (and holds no level) stays ??? (the mockup's last row).
  if ("milestone" in gate && !milestoneVisible(s, gate.milestone) && level === 0) {
    return { ...row, state: "hidden", name: "???", flavor: "", gate: COPY.skillHidden, scale: null };
  }
  const name = "milestone" in gate ? milestoneName(gate.milestone) : "";
  return { ...row, gate: skillGateLine(gate, skillGateCount(s, id), name) };
}

export function skillRows(s: SecretState): SkillRow[] {
  return LEVELED_SKILLS.map((d) => skillRow(s, d.id));
}

// The Milestones list's reward column: the Starfall theme and the Faster Than Light background by name (the
// e25,000,000 one only once reached: its whole row is ??? before), else the automation it unlocks, else
// recorded for later.
export function milestoneRewardText(s: SecretState, id: MilestoneId, reached: boolean): string {
  if (id === "starfall") return reached ? COPY.starfallRewardDone : COPY.starfallRewardLater;
  if (id === "e25m") return reached ? COPY.ftlRewardDone : "???";
  const auto = automationUnlockedBy(id);
  if (auto !== undefined) return automationListLine(auto, reached, automationRevealed(s, auto));
  return reached ? COPY.rewardRecorded : COPY.rewardLater;
}
