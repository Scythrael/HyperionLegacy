// prestigeConversion.ts: the one-time prestige redesign conversion (0.14.0, plan
// docs/plans/2026-10-27-minigame-prestige-redesign-plan.md Slice 6; design section 6).
//
// A save without the marker (prestigeV: 1) is a 0.13.11.2 save: state.ts deserializeSecret converts it once
// on load, and the marker it sets is saved with it, so nothing is ever converted twice. A new game starts
// with the marker (state.ts newSecretGame). Like the 0.13.11.1 Captain Points conversion (captainScale),
// which this never touches.
//
// User picks (2026-10-27, "With 0.14.0" and "Recompute from history"):
// - Skill Points: exactly what the new schedule pays for the save's lifetime Fleets (front-loaded points
//   included), never paid twice: the 0.13.11.2 points held are replaced, not added to.
// - Head Start, Ten Bonus and Overdrive owned become the level that gives today's effect (config LEVELED_SKILLS
//   replaces), their cost counted as spent, so nobody loses strength on load.
// - Every automation owned as a skill stays owned and switched exactly as it was, even before its milestone;
//   the others come from the milestones already recorded (the same grant as a step, engine
//   grantMilestoneAutomationsMut). Auto Prestigeception bought as a skill (user 2026-10-29 "Back ON for buyers")
//   keeps its switch, so it stays hidden until the save's own first Prestigeception and is then on
//   (engine automationRevealed); granted by its milestone, it starts off.
import { cloneSecret, type SecretState } from "./state";
import { LEVELED_SKILLS, AUTOMATION_IDS, SKILL_POINT_SCHEDULE } from "./config";
import { totalSkillCost, skillCostToMax, skillPointScheduleEntry, grantMilestoneAutomationsMut } from "./engine";

// The Skill Points the schedule pays over a number of lifetime Fleets, up to the cost of maxing every skill
// (where earning stops).
export function scheduledSkillPoints(fleets: number): number {
  const listed = Math.min(fleets, SKILL_POINT_SCHEDULE.length - 1);
  let sum = 0;
  for (let n = 0; n < listed; n++) sum += skillPointScheduleEntry(n);
  sum += Math.max(0, fleets - listed) * skillPointScheduleEntry(SKILL_POINT_SCHEDULE.length - 1);
  return Math.min(totalSkillCost(), sum);
}

// Pure and idempotent: a marked save comes back as the same object.
export function convertPrestigeV1(s: SecretState): SecretState {
  if (s.prestigeV === 1) return s;
  const t = cloneSecret(s);
  const owned = t.skills as Partial<Record<string, true>>;
  for (const def of LEVELED_SKILLS) {
    if (def.replaces !== undefined && owned[def.replaces.skill] === true) t.skillLevels[def.id] = Math.max(t.skillLevels[def.id] ?? 0, def.replaces.level);
  }
  // Owned first, so the grant below never switches an owned one off.
  for (const id of AUTOMATION_IDS) if (owned[id] === true) t.automations[id] = true;
  grantMilestoneAutomationsMut(t);
  // The levels held count as spent. A save whose levels cost more than its history pays keeps every level
  // and holds 0 points (the earned count is raised to their cost, so later Fleets pay only what the levels
  // still to buy need): strength is never taken away [PROPOSAL, plan Slice 6 carry note].
  const spent = totalSkillCost() - skillCostToMax(t);
  t.skillPointsEarned = Math.max(scheduledSkillPoints(t.fleetTotal), spent);
  t.skillPoints = t.skillPointsEarned - spent;
  t.prestigeV = 1;
  return t;
}
