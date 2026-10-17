// ============================================================================
// gambit.ts -- Exploration 0.14.0 (Phase E3a): the AWAY-TEAM GAMBIT COMBAT ENGINE.
//
// A full FFXII-grade, DETERMINISTIC, OFFLINE-SAFE gambit interpreter + ground-combat resolver. It swaps
// into the expedition ACTIVITY seam (expedition.ts resolveActivitiesPhase): when a ground-team task
// resolves, the away team's gambit programs drive a headless battle whose outcome becomes a REAL finding
// (materials + credits + a chance at an unidentified relic). ENGINE + PURE FUNCTIONS ONLY, no UI (E3b
// builds the editor). The persisted rule shapes live in model.ts; this file owns the behavior.
//
// ⚠️ THE CROWN-JEWEL INVARIANT (offline == live parity), preserved BY CONSTRUCTION:
//   1. Every random draw comes from makeRng (combat/rng.ts, mulberry32), seeded from a fixed key
//      (expedition seed ^ a fixed salt ^ the activity's flat index ^ the attempt index). NEVER
//      Date.now() / Math.random(), NEVER a live PRNG stream position. So a battle's outcome depends only
//      on those fixed inputs, not on HOW the elapsed span was chunked into ticks. This is the SAME keyed
//      device the rest of the expedition engine uses (expedition.ts): re-resolving an activity at a later
//      `consumed` value yields the identical battle, and the done-latch stops any re-award.
//   2. The away-team strength + team kit are SNAPSHOTTED onto the Expedition at dispatch
//      (Expedition.securityStrength / scienceStrength / teamKit), and since E-CREW Task 12 so is the named
//      roster (Expedition.roster: each member's converted stats, effects and OWN program, which since D19
//      is DEFAULT_MEMBER_GAMBIT when the member has none). No battle reads the account program pair.
//      Resolution reads ONLY the stored expedition, so advanceExpedition needs no GameState and one-big ==
//      many-small holds. E-CREW Task 16: who SITS OUT a battle (downed earlier in the run) is read off the
//      stored run too (scanDownedBefore / activityDownedBefore), and Neural Backup rolls on its own keyed
//      stream, never the battle's.
//
// E-CREW 0.14.0 (Task 13), THE SQUAD SPLIT (design D2 / D16 / section 10): SECURITY FIGHTS, SCIENCE NEVER
// ENTERS A BATTLE. Each Security member runs its OWN program; curing (cure / aidHeal) comes from a member
// with MEDICAL TRAINING (D20: the trait id "fieldMedic"; a Med Kit only strengthens a trained member's
// heal); a battle ends ONLY when the enemies are cleared or the team falls (the old "secure the objective"
// mid-fight win is gone).
// D18 (user, 2026-10-06): there is NO anonymous stand-in team any more. startExpedition refuses a ship
// without 1 Security + 1 Science member, so only the named roster fights. An expedition launched before D18
// with no Security member fields no team: its ground tasks evacuate WITHOUT a battle (see
// resolveExpeditionActivity), deterministically and with no draw.
//   3. ADDITIVE-NEUTRAL: nothing here runs on a no-expedition tick. The catalogs are static data touched
//      only inside the activities path, so a save with no expedition is byte-identical to before.
//
// ⚠️ GENERALIZABLE ON PURPOSE (SUGGESTIONS: gambits-everywhere). The INTERPRETER core
// (evaluateProgram + applyAction over a generic GroundCombatant[] + an injected Rng) is NOT hard-wired
// to ground combat. The eventual auto-vs-gambit layer on SHIP combat can build a different combatant set
// (each combatant carrying its own program) and reuse resolveGroundBattle's evaluate/apply loop. We deliberately do NOT contort the
// heavyweight ship Combatant type (combat/types.ts): a lighter GroundCombatant is the right model here,
// and the SEAM the ship layer reuses is the pure evaluate/apply core, not the combatant shape.
//
// ⚠️ ALL NUMERIC CONSTANTS BELOW ARE FIRST-PASS TUNABLE launch placeholders (team/enemy stats, status
// magnitudes/durations, encounter scaling, reward tables, relic odds), the same posture as SHIP_TYPES /
// expeditionContent.ts / the expedition.ts engine constants. The balance pass owns the real numbers.
// ============================================================================

import type {
  GameState,
  ShipInstance,
  Expedition,
  ExpeditionBody,
  ExpeditionActivity,
  ExpeditionFinding,
  ExpeditionRelicToken,
  GambitRule,
  GambitProgram,
  GambitPrograms,
  GambitRole,
  GambitActionId,
  GambitStatusId,
  GambitTargetSelector,
  EquipmentRarity,
  CrewProfession,
  SeniorStaffSeat,
  SecuritySpec,
  SnapshotMember,
  GroundStatus,
  EnemyRank,
} from "./model";
import { SALVAGE_LOOT_POOLS, DEFAULT_GAMBIT_PROGRAMS, DEFAULT_MEMBER_GAMBIT, memberVariety } from "./model";
import { makeRng, type Rng } from "./combat/rng";
import { crewRarityMultiplier } from "./crewRarity";
import { rankMagnitudeFactor } from "./crewRank";
// E4a: the PoI -> relic-set single source of truth (pure data; imports no engine module, so no cycle).
import { RELIC_BEARING_POIS, isRelicBearingPoi, museumBonuses, resistedHazard } from "./relics";
// E-CREW Task 15: the Science party's fieldwork (pure; imports only model + content, so no cycle).
import { fieldworkEffect, type FieldworkEffect } from "./fieldwork";
// E-CREW 0.14.0 (Task 21): the Constitution ramp (a pure leaf; no cycle).
import { constitutionRamp } from "./officerStats";

// ============================================================================
// FIRST-PASS TUNABLE constants
// ============================================================================

// --- Ground combatant base stats (before crew/hazard scaling) ---
const SECURITY_BASE_HP = 45;
const SECURITY_BASE_POWER = 11;
const SECURITY_BASE_ARMOR = 3;
const SECURITY_BASE_ACCURACY = 0.9; // 0..1 hit chance before Suppressed

// How crew strength scales a team member. securityStrength (deriveAwayTeam) is a unit-ish scalar; each
// point adds a fraction to power + HP so more/better crew hits harder + lasts. It is the SQUAD-WIDE crew
// layer, shared evenly across the deployed named members.
const STRENGTH_POWER_COEFF = 0.9; // +0.9 power per strength point (shared across the squad)
const STRENGTH_HP_COEFF = 4; // +4 HP per strength point

// --- E-CREW (Task 13): named Security members (FIRST-PASS TUNABLE) ---
// Base adjustments by Security spec, on top of the Security base line above. Offense hits harder, Defense
// is tougher, Debuff lands afflictions (a small base status chance, an absolute chance).
const SECURITY_SPEC_BASE: Record<SecuritySpec, { hp: number; power: number; armor: number; statusChance: number }> = {
  offense: { hp: 0, power: 2, armor: 0, statusChance: 0 },
  defense: { hp: 10, power: 0, armor: 1, statusChance: 0 },
  debuff: { hp: 0, power: 0, armor: 0, statusChance: 0.1 },
};
const MEMBER_ACCURACY_CAP = 0.99; // gear + traits can never make a member a sure hit
const MEMBER_STATUS_CHANCE_CAP = 0.9; // the most any member's on-hit affliction chance reaches
const MEDIC_BASE_HEAL = 12; // aidHeal amount a Medical Training member brings bare-handed
// GEAR EFFECTS SCALE WITH STAT LINES (a piece's summed ground points). A Standard-Issue baseline has every
// line at 0, so its effect has no strength: a Standard-Issue Med Kit heals nothing on its own.
// D20 (user, 2026-10-06): "The Med Kit tool requires Medical Training." A Med Kit adds its points to the
// heal of a member WITH Medical Training only; on anyone else it does nothing in battle (no medic actions,
// no heal).
const HEAL_PER_GEAR_POINT = 0.6; // aidHeal per point of a heal tool (an iLevel 10 crafted Med Kit, ~20 points, heals ~12)
const GROUP_HIT_PER_POINT = 0.015; // splash fraction per point of a group-hit weapon
const GROUP_HIT_CAP = 0.6; // the most of a strike's damage that splashes onto the target's group

// --- Team kit (consumable cures/stims) ---
// D20 FIRST AID (user, 2026-10-06): "Consumables (first aid) work for anyone, at reduced effectiveness
// without training ... Maybe at 50% effectiveness"; Medical Training gives "something like a 25% or 50%
// boost". A team-kit consumable (the "Use Item" action) is usable by ANY Security member; its effect is
// scaled by the user's effectiveness: UNTRAINED (no Medical Training) or TRAINED. One use spends one kit
// and does two things, both scaled (applyFirstAid): it CLEANSES the targeted debuff(s), cutting each one's
// remaining rounds by ceil(remaining * effectiveness) (so at 1.0 or more it clears them, at 0.5 it halves
// them), and it PATCHES the target for round(FIRST_AID_HEAL * effectiveness) HP. No rng, no draw.
// FIRST-PASS TUNABLE.
export const FIRST_AID_UNTRAINED_EFFECTIVENESS = 0.5;
export const FIRST_AID_TRAINED_EFFECTIVENESS = 1.25;
export const FIRST_AID_HEAL = 10; // the HP a first-aid use restores at 1.0 effectiveness
const TEAM_KIT_BASE = 2; // a bare team carries this many kit consumables per battle
const TEAM_KIT_PER_MEDICAL = 1; // +1 kit per this many medical/operations crew (headcount)
const TEAM_KIT_MEDICAL_DIVISOR = 4;
const TEAM_KIT_MAX = 8;

// --- Officer contribution to team strength ---
const OFFICER_STRENGTH = 3; // a relevant assigned officer adds this much strength (before rank scaling)

// --- Battle loop ---
export const MAX_ROUNDS = 40; // hard bound so a stalemate can never loop forever (a timeout counts as a loss)
export const MAX_BATTLE_ATTEMPTS = 3; // deterministic retries before an activity EVACUATES (see resolveExpeditionActivity)

// --- Damage / action tuning ---
const DAMAGE_VARIANCE_MIN_PERMILLE = 850; // damage roll in [0.85, 1.15]x
const DAMAGE_VARIANCE_SPAN_PERMILLE = 300;
const EXECUTE_HP_FRACTION = 0.35; // "low HP" for Execute: target below this fraction of its max
const EXECUTE_BONUS_MULT = 2.0; // Execute deals this multiple vs a low-HP foe (else a normal hit)
const SUPPRESS_DAMAGE_MULT = 0.6; // Suppress deals reduced damage (its value is the debuff)
const MIN_DAMAGE = 1; // a landed hit always does at least this (armor can never fully zero a hit)

// --- Status effect magnitudes / durations (FIRST-PASS TUNABLE) ---
interface StatusEffectDef {
  id: GambitStatusId;
  label: string;
  kind: "debuff" | "buff";
  // The mechanical lever the resolver reads (see the status application/tick sites for how each is honored).
  effect:
    | "dotDamage" // deals `magnitude` HP at end of round (poison/bleed)
    | "skipTurn" // the combatant cannot act (stun)
    | "damageDown" // outgoing damage x (1 - magnitude) (weakened)
    | "accuracyDown" // hit chance x (1 - magnitude) (suppressed)
    | "armorDown" // armor x (1 - magnitude) (corroded)
    | "mayFallBack" // chance per turn to fall back instead of acting (fear)
    | "damageTakenDown" // incoming damage x (1 - magnitude) (shielded)
    | "damageUp"; // outgoing damage x (1 + magnitude) (inspired)
  magnitude: number;
  duration: number; // rounds
}

export const GAMBIT_STATUSES: Record<GambitStatusId, StatusEffectDef> = {
  poison: { id: "poison", label: "Poison", kind: "debuff", effect: "dotDamage", magnitude: 5, duration: 4 },
  bleed: { id: "bleed", label: "Bleed", kind: "debuff", effect: "dotDamage", magnitude: 7, duration: 3 },
  stun: { id: "stun", label: "Stun", kind: "debuff", effect: "skipTurn", magnitude: 1, duration: 1 },
  weakened: { id: "weakened", label: "Weakened", kind: "debuff", effect: "damageDown", magnitude: 0.35, duration: 3 },
  suppressed: { id: "suppressed", label: "Suppressed", kind: "debuff", effect: "accuracyDown", magnitude: 0.4, duration: 3 },
  corroded: { id: "corroded", label: "Corroded", kind: "debuff", effect: "armorDown", magnitude: 0.5, duration: 3 },
  fear: { id: "fear", label: "Fear", kind: "debuff", effect: "mayFallBack", magnitude: 0.4, duration: 2 },
  shielded: { id: "shielded", label: "Shielded", kind: "buff", effect: "damageTakenDown", magnitude: 0.4, duration: 2 },
  inspired: { id: "inspired", label: "Inspired", kind: "buff", effect: "damageUp", magnitude: 0.3, duration: 2 },
};

// The DEBUFF ids a Cure with no explicit statusId clears (every debuff; buffs are never cleared).
const DEBUFF_IDS: GambitStatusId[] = (Object.keys(GAMBIT_STATUSES) as GambitStatusId[]).filter(
  (id) => GAMBIT_STATUSES[id].kind === "debuff",
);

// --- Decorrelation salts (distinct from expedition.ts's salts; do NOT reuse across purposes) ---
// Exported (GO-4) so salts.test.ts can assert every engine salt is odd and distinct; read-only constants.
export const COMBAT_SALT = 0x5a3c9d17; // the per-battle stream (encounter generation + the fight)
export const REWARD_SALT = 0x3f27b1e5; // the per-activity reward roll (materials + relic), independent of attempts
// E-CREW (Task 14): the scan-step random ENCOUNTER battle (enemy generation + the fight) and its drops,
// and the scan-step supply-cache haul. Distinct from every salt above (never reuse a salt across purposes).
export const SCAN_BATTLE_SALT = 0x6b43a9b5;
export const SCAN_DROP_SALT = 0x1d8e4b2f;
export const SUPPLY_CACHE_SALT = 0x4cf5ad43;
// E-CREW (Task 16): Neural Backup's revive roll. Its OWN stream (the battle's seed ^ this salt), never a
// draw on the battle's shared stream, so adding the implant shifts no other roll in any battle.
export const NEURAL_BACKUP_SALT = 0x2f6e9c31;

// ============================================================================
// Enemy roles + role behaviors
// ============================================================================

// The enemy archetypes that make target selection LOAD-BEARING. A Healer keeps the pack alive (so
// "target the healer" wins); a Caster slings afflictions; a Striker spikes damage; a Bruiser tanks +
// draws fire; Swarm is many weak bodies. An encounter MIXES roles (generateEncounter) so a naive
// attack-nearest program loses to attrition while a smart one decapitates.
export type EnemyRole = "bruiser" | "striker" | "healer" | "caster" | "swarm";

// A ground combatant's role is a team role OR an enemy role. The interpreter treats them uniformly; role
// only picks which program drives the combatant + gates legal actions for team roles. Since E-CREW Task 13
// the only team role that ever fights is "security" ("science" stays in the union so old data types check).
export type GroundRole = GambitRole | EnemyRole;

// ============================================================================
// Ground weapon RANGE (objective affixes AF-2; docs/plans/2026-10-14-objective-affixes-capture.md)
// ============================================================================
// Every ground attack is LONG range (a shot from cover, a cast from the back line) or SHORT range (a close-in
// blast, a baton, claws). DATA ONLY on its own: nothing reads it unless a target has evasion against long-range
// attacks (GroundCombatant.longRangeEvasion, the Rocky Outcroppings affix), so every fight without such cover
// draws and resolves exactly as before. [PROVISIONAL classification]
//   MEMBER weapons: the catalog's own MemberVarietyTraits.weaponRange (model.ts memberWeapon varieties): Pulse
//     Rifle long; Scattergun, Shock Baton (melee) and Sidearm short. A member with NO weapon fights unarmed:
//     short (UNARMED_RANGE). Implants (the Targeting Optic) and tools never change the range.
//   ENEMY attacks by role (ENEMY_ROLE_RANGE): Strikers (gunners), Casters and Healers (back line) long; Bruisers
//     (close-in brawlers) and Swarm (claws and teeth) short.
export type GroundRange = "long" | "short";
export const UNARMED_RANGE: GroundRange = "short";
export const ENEMY_ROLE_RANGE: Readonly<Record<EnemyRole, GroundRange>> = {
  bruiser: "short",
  striker: "long",
  healer: "long",
  caster: "long",
  swarm: "short",
};

// A snapshotted member's attack range: the first worn Away-Team Weapon's catalog range, else UNARMED_RANGE. Pure.
export function memberWeaponRange(member: Pick<SnapshotMember, "gear">): GroundRange {
  for (const piece of member.gear ?? []) {
    if (piece.slotType !== "memberWeapon") continue;
    const range = memberVariety(piece.slotType, piece.varietyKey)?.member.weaponRange;
    if (range) return range;
  }
  return UNARMED_RANGE;
}

// A combatant's attack range: its stamped `range`, else an enemy role's ENEMY_ROLE_RANGE, else UNARMED_RANGE. Pure.
export function attackRange(c: Pick<GroundCombatant, "range" | "side" | "role">): GroundRange {
  if (c.range) return c.range;
  if (c.side === "enemy" && Object.prototype.hasOwnProperty.call(ENEMY_ROLE_RANGE, c.role)) return ENEMY_ROLE_RANGE[c.role as EnemyRole];
  return UNARMED_RANGE;
}

// Enemy behaviors expressed as gambit programs, run through the SAME interpreter (proving it is
// generalizable). "ally" resolves to a fellow ENEMY (same side), so the Healer heals wounded enemies.
// A Caster's affliction comes from its combatant `statusOnHit` (its attack applies it), keeping the
// action vocabulary shared. FIRST-PASS TUNABLE.
export const ENEMY_ROLE_PROGRAMS: Record<EnemyRole, GambitProgram> = {
  bruiser: [
    { target: "foeHighestThreat", action: "attack" },
    { target: "foeNearest", action: "attack" },
  ],
  striker: [
    { target: "foeLowestHp", action: "execute" },
    { target: "foeNearest", action: "attack" },
  ],
  healer: [
    { target: "allyHpBelow", params: { hpThreshold: 0.7 }, action: "aidHeal" },
    { target: "foeNearest", action: "attack" },
  ],
  caster: [
    // The affliction rides the caster's statusOnHit; the action stays a plain attack.
    { target: "foeHighestThreat", action: "attack" },
    { target: "foeNearest", action: "attack" },
  ],
  swarm: [{ target: "foeNearest", action: "attack" }],
};

// ============================================================================
// The ground combatant model (a lighter shape than the ship Combatant, on purpose)
// ============================================================================

// One active status on a combatant: GroundStatus lives in model.ts since GO-7b (the run-side carry stores it;
// model.ts must not import this module) and is re-exported here unchanged.
export type { GroundStatus } from "./model";

// A single fighter in a ground battle. Team members carry a security/science role; enemies carry an enemy
// role. `threat` drives foeHighestThreat; `groupTag` drives foeLargestGroup; `statusOnHit` lets a caster's
// (or a special attacker's) plain attack apply an affliction, keeping the action set shared.
export interface GroundCombatant {
  id: string;
  side: "team" | "enemy";
  role: GroundRole;
  hp: number;
  hpMax: number;
  power: number;
  accuracy: number; // 0..1 base hit chance
  armor: number;
  heal: number; // aidHeal amount (Science / Healer)
  threat: number; // for foeHighestThreat (first-pass: == power)
  groupTag: string; // for foeLargestGroup (enemies of the same archetype share a tag)
  statuses: GroundStatus[];
  statusOnHit?: { id: GambitStatusId; permille: number }; // e.g. a Caster applies this on a landed attack
  downed: boolean;
  // --- E-CREW (Task 13): a NAMED Security member (buildRosterCombatants). Every field is OPTIONAL and
  // absent on enemies (and on a hand-built test combatant), so their turns draw and act exactly as before. ---
  memberId?: string; // the AwayMember this combatant is
  program?: GambitProgram; // the member's OWN program (overrides the role-wide program)
  medic?: boolean; // has MEDICAL TRAINING (D20): may cure / aidHeal, a Med Kit counts, first aid is TRAINED
  onHitStatuses?: { id: GambitStatusId; permille: number }[]; // inflict gear: rolled after a landed strike
  groupHit?: number; // fraction of a landed attack/execute that splashes onto the target's group
  resists?: Partial<Record<GambitStatusId, number>>; // permille chance to shrug off each status
  firstStrike?: boolean; // acts before the other team members on the opening round
  guardBelow?: number; // takes enemy strikes meant for an ally below this HP fraction
  // E-CREW (Task 16): this member wears NEURAL BACKUP (D11). Once per battle, the FIRST ally downed rolls
  // `permille` / 1000 to come back at `hpFraction` of their max HP (resolveGroundBattle).
  revive?: { permille: number; hpFraction: number };
  // E-CREW (Task 20): FLEET TRIAGE (the ship's Medical officer bonus, Expedition.squadTriage). The member's
  // first-aid effectiveness (Use Item) is multiplied by this; its Aid / Heal amount is already scaled at
  // build. Absent on enemies and on a squad without the officer (exactly the pre-Task-20 first aid).
  careMult?: number;
  // Objective affixes (AF-2): the attack's RANGE (see GroundRange; absent: attackRange's default) and this
  // combatant's EVASION against LONG-RANGE attacks (Rocky Outcroppings cover, a fraction 0..1: a long-range strike's
  // hit chance x (1 - this)). Both absent on every combatant of a fight without cover, so it is the fight as before.
  range?: GroundRange;
  longRangeEvasion?: number;
  // Field Kits FKR-1 (enemy ranks): an ENEMY's rank on a ranked run (groundFight.ts withEnemyRanks stamps every
  // enemy of such a fight, its HP and power already scaled). Absent = Normal (every fight of an unranked run, and
  // every member). No battle rule reads it yet; FKR-6's gambit rank conditions will.
  rank?: EnemyRank;
}

// E-CREW (Task 20): the away team's frozen Senior Staff bonuses (stored on the Expedition at dispatch), as
// buildRosterCombatants reads them. Both optional; absent / 0 leaves every combatant byte-identical.
//   triage     : Fleet Triage. A medic's Aid / Heal and every member's first aid work at (1 + triage).
//   fearResist : Morale Anchor. Each member's chance to shrug off Fear becomes 1 - (1 - own)(1 - this):
//                independent chances, so it stacks with a member's own resist with diminishing returns
//                (D23) and can never reach certainty without a hard cap.
export interface SquadOfficerCare {
  triage?: number;
  fearResist?: number;
}

// ============================================================================
// Role-legality (the resolver enforces it; validateGambitProgram flags it for the E3b editor)
// ============================================================================

const SECURITY_LEGAL: ReadonlySet<GambitActionId> = new Set<GambitActionId>([
  "attack",
  "suppress",
  "taunt",
  "execute",
  "brace",
  "useItem",
  "fallBack",
  "hold",
]);
// E-CREW (Task 13): the MEDIC actions. A Security program MAY contain them (the editor offers them and the
// Triage preset leads with them), but at runtime they fire only for a member with Medical Training
// (GroundCombatant.medic; D20: a Med Kit alone no longer qualifies); for anyone else the rule is skipped
// and the next one is tried. Use Item is NOT a medic action: anyone may use it (see FIRST AID above).
const MEDIC_ACTIONS: ReadonlySet<GambitActionId> = new Set<GambitActionId>(["cure", "aidHeal"]);
// The legacy Science action set. Science NEVER enters a battle since Task 13, so nothing executes a
// Science program any more; the set stays only so validateGambitProgram("science", ...) still answers for
// an old save's stored Science program (GambitPrograms keeps its shape for backward compatibility).
const SCIENCE_LEGAL: ReadonlySet<GambitActionId> = new Set<GambitActionId>([
  "cure",
  "aidHeal",
  "shieldAlly",
  "analyze",
  "secureObjective",
  "takeCover",
  "useItem",
  "fallBack",
  "hold",
]);

// May a program for this role CONTAIN the action? Team roles are gated to their action set (Security
// includes the medic actions, which fire only for a medic: see canActorUse); enemy roles run controlled
// internal programs, so every action they use is legal (the gate exists to constrain PLAYER programs).
export function isActionLegalForRole(role: GroundRole, action: GambitActionId): boolean {
  if (role === "security") return SECURITY_LEGAL.has(action) || MEDIC_ACTIONS.has(action);
  if (role === "science") return SCIENCE_LEGAL.has(action);
  return true; // enemy roles
}

// Can THIS combatant perform the action right now? The role gate, plus the medic gate: a Security member
// may cure / aidHeal only with Medical Training (design section 10 + D20). Grenades and every other tool
// need no training (D20: "Pull a pin and toss it"), and Use Item is open to anyone. The resolver's
// legality check. Pure.
export function canActorUse(actor: GroundCombatant, action: GambitActionId): boolean {
  if (!isActionLegalForRole(actor.role, action)) return false;
  if (actor.role === "security" && MEDIC_ACTIONS.has(action)) return actor.medic === true;
  return true;
}

// A single flagged illegal rule (its index in the program + why), for the E3b editor.
export interface GambitProgramIssue {
  index: number;
  action: GambitActionId;
  reason: "illegalActionForRole";
}

// Validate a program for a role: return the rules whose action is not legal for that role. PURE. The E3b
// editor surfaces these; the resolver independently SKIPS illegal rules (defense in depth), so a stored
// program can never make a member do what its role cannot. A Security medic action is NOT an issue: it is
// legal to write and simply does not fire for a member who is not a medic.
export function validateGambitProgram(role: GambitRole, program: GambitProgram): GambitProgramIssue[] {
  const issues: GambitProgramIssue[] = [];
  program.forEach((rule, index) => {
    if (!isActionLegalForRole(role, rule.action)) {
      issues.push({ index, action: rule.action, reason: "illegalActionForRole" });
    }
  });
  return issues;
}

// ============================================================================
// PRESETS (the 6 LOCKED titles, user 2026-09-30). Genuinely distinct so the choice matters.
// ============================================================================

export interface GambitPreset {
  id: string;
  title: string;
  programs: GambitPrograms;
}

// Deep-copy a program pair so a preset hand-out never aliases the shared literal (the E3b editor mutates
// its working copy). PURE.
function cloneProgramsData(p: GambitPrograms): GambitPrograms {
  const cloneRule = (r: GambitRule): GambitRule => ({ ...r, params: r.params ? { ...r.params } : undefined });
  return { security: p.security.map(cloneRule), science: p.science.map(cloneRule) };
}

// E-CREW (Task 13): rewritten for SECURITY ONLY (design D16: "the six preset titles stay"). Science never
// enters a battle, so every preset's Science program is empty and nothing executes one. Each Security
// program runs PER MEMBER; a member with none runs DEFAULT_MEMBER_GAMBIT (D19), which is not a preset.
// Medic rules (cure / aidHeal) fire only for a member with Medical Training and are skipped by everyone
// else, so one preset serves a mixed squad.
export const GAMBIT_PRESETS: readonly GambitPreset[] = [
  {
    // Establish Dominance: "punch the biggest guy in the room". Taunt ONCE, on the opening round, to pull
    // the room's attention, take out the enemy medic (or the biggest guy just gets healed back up), then
    // focus the highest-HP foe. FIX (2026-10-06): it used to lead with an always-firing taunt, so every
    // member taunted every round and the preset never won (0 of 60 on every encounter type). A taunt with
    // no living ally to protect does not fire (ruleFires), so a solo member skips straight to its attacks.
    id: "establishDominance",
    title: "Establish Dominance",
    programs: {
      security: [
        { target: "openingRound", action: "taunt" },
        { target: "foeIsHealer", action: "attack" },
        { target: "foeHighestHp", action: "attack" },
        { target: "foeNearest", action: "attack" },
      ],
      science: [],
    },
  },
  {
    // Decapitate: kill the enemy healer, then the caster, then the biggest threat.
    id: "decapitate",
    title: "Decapitate",
    programs: {
      security: [
        { target: "foeIsHealer", action: "attack" },
        { target: "foeIsCaster", action: "attack" },
        { target: "foeHighestThreat", action: "attack" },
        { target: "foeNearest", action: "attack" },
      ],
      science: [],
    },
  },
  {
    // Turtle Club President: defense first. Brace when badly hurt, a medic patches the wounded, and a member
    // taunts only to pull fire off an ally in real danger; otherwise steady attacks (the healer first, then
    // finish the weakest). No kit use. FIX (2026-10-06): it used to lead with an always-firing taunt, so
    // every member taunted every round and the preset never won (0 of 60 on every encounter type).
    id: "turtleClubPresident",
    title: "Turtle Club President",
    programs: {
      security: [
        { target: "selfHpBelow", params: { hpThreshold: 0.2 }, action: "brace" },
        { target: "allyHpBelow", params: { hpThreshold: 0.5 }, action: "aidHeal" },
        { target: "allyHpBelow", params: { hpThreshold: 0.2 }, action: "taunt" },
        { target: "foeIsHealer", action: "attack" },
        { target: "foeLowestHp", action: "execute" },
        { target: "foeNearest", action: "attack" },
      ],
      science: [],
    },
  },
  {
    // Triage: MEDIC PRIORITY. A medic cures and heals above all; everyone spends team kit on an afflicted
    // ally, then finishes the wounded. Keeps a squad alive through affliction-heavy fights.
    id: "triage",
    title: "Triage",
    programs: {
      security: [
        { target: "allyHasStatus", action: "cure" },
        { target: "allyHpBelow", params: { hpThreshold: 0.75 }, action: "aidHeal" },
        { target: "allyHasStatus", action: "useItem" },
        { target: "foeLowestHp", action: "execute" },
        { target: "foeNearest", action: "attack" },
      ],
      science: [],
    },
  },
  {
    // Balanced: the sensible general program == DEFAULT_GAMBIT_PROGRAMS (single source of truth, so the
    // fresh-save default and this preset can never drift).
    id: "balanced",
    title: "Balanced",
    programs: DEFAULT_GAMBIT_PROGRAMS,
  },
  {
    // Custom: an empty starter the player fills in. An empty program makes a member HOLD every round (it
    // does nothing), so a fresh Custom loses, which is the point of a starter you must build.
    id: "custom",
    title: "Custom",
    programs: { security: [], science: [] },
  },
];

// Look up a preset by id and hand back a DEEP COPY of its program pair (safe for the editor to mutate).
// Undefined for an unknown id. PURE.
export function gambitPresetPrograms(presetId: string): GambitPrograms | undefined {
  const preset = GAMBIT_PRESETS.find((p) => p.id === presetId);
  return preset ? cloneProgramsData(preset.programs) : undefined;
}

// ============================================================================
// Status helpers (pure over a working combatant)
// ============================================================================

export function hasStatus(c: GroundCombatant, id: GambitStatusId): boolean {
  return c.statuses.some((s) => s.id === id);
}

// Apply (or refresh) a status on a combatant IN PLACE (called on the working battle clone only). A
// re-application refreshes to the longer remaining duration + the stronger magnitude (no infinite stack).
export function applyStatus(c: GroundCombatant, id: GambitStatusId, magnitude?: number, duration?: number): void {
  const def = GAMBIT_STATUSES[id];
  const mag = magnitude ?? def.magnitude;
  const dur = duration ?? def.duration;
  const existing = c.statuses.find((s) => s.id === id);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, dur);
    existing.magnitude = Math.max(existing.magnitude, mag);
    return;
  }
  c.statuses.push({ id, magnitude: mag, remaining: dur });
}

// Clear debuffs from a combatant IN PLACE. With a specific id, clears only that one; otherwise clears
// EVERY debuff (buffs are never cleared). Returns whether anything was removed (so Cure only "fires" when
// there is something to cleanse, which lets a lower gambit rule take over when there is not).
export function clearDebuffs(c: GroundCombatant, id?: GambitStatusId): boolean {
  const before = c.statuses.length;
  c.statuses = c.statuses.filter((s) => {
    if (id) return s.id !== id ? true : false; // keep everything except the named debuff
    return GAMBIT_STATUSES[s.id].kind !== "debuff"; // keep only buffs
  });
  return c.statuses.length < before;
}

// D20: the first-aid effectiveness a member's Use Item works at (Medical Training or not). Pure.
export function firstAidEffectiveness(actor: Pick<GroundCombatant, "medic">): number {
  return actor.medic === true ? FIRST_AID_TRAINED_EFFECTIVENESS : FIRST_AID_UNTRAINED_EFFECTIVENESS;
}

// Apply one first-aid use to `target` IN PLACE at `effectiveness` (see FIRST AID above): each targeted debuff
// (the named one, else every debuff; buffs are never touched) loses ceil(remaining * effectiveness) rounds
// and is pruned at 0, then (only if a debuff was cut) the target heals round(FIRST_AID_HEAL * effectiveness)
// HP, capped at max. Returns whether a debuff was cut. No rng.
export function applyFirstAid(c: GroundCombatant, effectiveness: number, id?: GambitStatusId): boolean {
  let cut = false;
  c.statuses = c.statuses
    .map((s) => {
      const targeted = id ? s.id === id : GAMBIT_STATUSES[s.id].kind === "debuff";
      if (!targeted) return s;
      cut = true;
      return { ...s, remaining: s.remaining - Math.ceil(s.remaining * effectiveness) };
    })
    .filter((s) => s.remaining > 0);
  // The patch rides the cleanse: no debuff to work on means no use (and no kit spent, see useItem).
  if (cut && !c.downed) c.hp = Math.min(c.hpMax, c.hp + Math.round(FIRST_AID_HEAL * effectiveness));
  return cut;
}

// A combatant's outgoing-damage multiplier from its buffs/debuffs (Weakened down, Inspired up).
function outgoingDamageMult(c: GroundCombatant): number {
  let mult = 1;
  if (hasStatus(c, "weakened")) mult *= 1 - GAMBIT_STATUSES.weakened.magnitude;
  if (hasStatus(c, "inspired")) mult *= 1 + GAMBIT_STATUSES.inspired.magnitude;
  return mult;
}

// A combatant's hit chance (0..1) after Suppressed.
function effectiveAccuracy(c: GroundCombatant): number {
  let acc = c.accuracy;
  if (hasStatus(c, "suppressed")) acc *= 1 - GAMBIT_STATUSES.suppressed.magnitude;
  return Math.max(0, Math.min(1, acc));
}

// A target's effective armor after Corroded.
function effectiveArmor(c: GroundCombatant): number {
  let armor = c.armor;
  if (hasStatus(c, "corroded")) armor *= 1 - GAMBIT_STATUSES.corroded.magnitude;
  return Math.max(0, armor);
}

// The hit chance (0..1) of `attacker`'s strike on `target`: effectiveAccuracy, then (AF-2) the target's evasion
// against LONG-RANGE attacks when it has some and the attack is long range (attackRange). A target without cover
// reads effectiveAccuracy exactly. Pure.
export function strikeHitChance(attacker: GroundCombatant, target: Pick<GroundCombatant, "longRangeEvasion">): number {
  const acc = effectiveAccuracy(attacker);
  const evade = target.longRangeEvasion;
  if (!(typeof evade === "number" && evade > 0) || attackRange(attacker) !== "long") return acc;
  return Math.max(0, Math.min(1, acc * (1 - Math.min(1, evade))));
}

// ============================================================================
// Target resolution (the tactical heart) -- pure over the current combatant lists
// ============================================================================

function aliveFoes(state: BattleState, actor: GroundCombatant): GroundCombatant[] {
  return state.combatants.filter((c) => !c.downed && c.side !== actor.side);
}
function aliveAllies(state: BattleState, actor: GroundCombatant): GroundCombatant[] {
  return state.combatants.filter((c) => !c.downed && c.side === actor.side);
}

// Is a combatant an enemy "healer" / "caster" for the is-Healer / is-Caster selectors? These read the
// combatant's role, so they work whichever side is evaluating (a team member sees an enemy healer; an
// enemy would see a team science member as the "healer", which is the same tactical truth).
function isHealerRole(c: GroundCombatant): boolean {
  return c.role === "healer" || c.role === "science";
}
function isCasterRole(c: GroundCombatant): boolean {
  return c.role === "caster";
}

// Resolve a rule's TARGET to a concrete combatant, or null when nothing matches (which makes the rule
// "not fire" so the next rule is tried). Deterministic tie-breaks: ties resolve to the LOWEST combatant
// id (stable, order-independent) so the same battle always picks the same target. `rng` is unused here
// (targeting is deterministic); it is threaded only for symmetry with applyAction.
export function resolveTarget(
  selector: GambitTargetSelector,
  params: GambitRule["params"],
  actor: GroundCombatant,
  state: BattleState,
): GroundCombatant | null {
  const foes = aliveFoes(state, actor);
  const allies = aliveAllies(state, actor);
  const byLowestId = (a: GroundCombatant, b: GroundCombatant) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Pick the extreme of a metric, tie-broken by lowest id (stable + deterministic).
  const pick = (list: GroundCombatant[], metric: (c: GroundCombatant) => number, want: "max" | "min") => {
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => {
      const d = metric(a) - metric(b);
      if (d !== 0) return want === "max" ? -d : d;
      return byLowestId(a, b);
    });
    return sorted[0];
  };

  switch (selector) {
    // --- Foe selectors ---
    case "foeNearest":
      // "nearest" == first by id (no spatial grid in the idle model; a stable, deterministic proxy).
      return foes.length ? [...foes].sort(byLowestId)[0] : null;
    case "foeFarthest":
      return foes.length ? [...foes].sort(byLowestId)[foes.length - 1] : null;
    case "foeHighestHp":
      return pick(foes, (c) => c.hp, "max");
    case "foeLowestHp":
      return pick(foes, (c) => c.hp, "min");
    case "foeHighestThreat":
      return pick(foes, (c) => c.threat, "max");
    case "foeIsHealer":
      return foes.filter(isHealerRole).sort(byLowestId)[0] ?? null;
    case "foeIsCaster":
      return foes.filter(isCasterRole).sort(byLowestId)[0] ?? null;
    case "foeHasStatus": {
      const sid = params?.statusId;
      if (!sid) return null;
      return foes.filter((c) => hasStatus(c, sid)).sort(byLowestId)[0] ?? null;
    }
    case "foeLargestGroup": {
      if (foes.length === 0) return null;
      const counts = new Map<string, number>();
      for (const f of foes) counts.set(f.groupTag, (counts.get(f.groupTag) ?? 0) + 1);
      // The largest group's tag (tie -> lexically lowest tag for determinism), then its lowest-id member.
      let bestTag: string | null = null;
      let bestN = -1;
      for (const [tag, n] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (n > bestN) {
          bestN = n;
          bestTag = tag;
        }
      }
      return foes.filter((c) => c.groupTag === bestTag).sort(byLowestId)[0] ?? null;
    }
    // --- Ally / Self selectors ---
    case "allyLowestHp":
      return pick(allies, (c) => c.hp, "min");
    case "allyHpBelow": {
      const thr = params?.hpThreshold ?? 0.5;
      const below = allies.filter((c) => c.hp < c.hpMax * thr);
      return pick(below, (c) => c.hp, "min"); // the MOST wounded below the line
    }
    case "allyHasStatus": {
      const sid = params?.statusId;
      const afflicted = allies.filter((c) =>
        sid ? hasStatus(c, sid) : c.statuses.some((s) => GAMBIT_STATUSES[s.id].kind === "debuff"),
      );
      return pick(afflicted, (c) => c.hp, "min"); // cure the most-wounded afflicted ally first
    }
    case "self":
      return actor.downed ? null : actor;
    case "selfHpBelow": {
      const thr = params?.hpThreshold ?? 0.5;
      return actor.hp < actor.hpMax * thr ? actor : null;
    }
    case "selfHasStatus": {
      const sid = params?.statusId;
      const match = sid
        ? hasStatus(actor, sid)
        : actor.statuses.some((s) => GAMBIT_STATUSES[s.id].kind === "debuff");
      return match ? actor : null;
    }
    // --- Non-target conditions: fire against a contextual default (a foe) when the condition holds ---
    case "openingRound":
      return state.round === 0 && foes.length ? [...foes].sort(byLowestId)[0] : null;
    case "outnumbered":
      return foes.length > allies.length && foes.length ? [...foes].sort(byLowestId)[0] : null;
  }
}

// ============================================================================
// Action application (pure over the working battle state + the injected rng)
// ============================================================================

// Roll a damage number for an attacker vs a target (variance + buffs/debuffs + armor). Consumes ONE rng
// draw (the variance), plus the caller's hit-check draw. A miss is decided by the caller.
function rollDamage(attacker: GroundCombatant, target: GroundCombatant, rng: Rng, mult: number): number {
  const variance =
    (DAMAGE_VARIANCE_MIN_PERMILLE + rng.nextInt(DAMAGE_VARIANCE_SPAN_PERMILLE + 1)) / 1000; // [0.85, 1.15]
  const base = attacker.power * outgoingDamageMult(attacker) * mult * variance;
  let dmg = base - effectiveArmor(target);
  if (dmg < MIN_DAMAGE) dmg = MIN_DAMAGE;
  if (hasStatus(target, "shielded")) dmg *= 1 - GAMBIT_STATUSES.shielded.magnitude;
  return Math.max(MIN_DAMAGE, Math.round(dmg));
}

// Deal `amount` to a target IN PLACE, downing it at 0. Pure over the working clone.
function dealDamage(target: GroundCombatant, amount: number): void {
  target.hp -= amount;
  if (target.hp <= 0) {
    target.hp = 0;
    target.downed = true;
  }
}

// Try to apply a status to a target that may RESIST it (E-CREW Task 13: a named member's resists, from
// traits + resistStatus gear). The resist roll draws ONE rng step, and ONLY when the target has a resist
// above 0 for that status, so a target with no resists (every enemy, a member without one) draws exactly
// as before. Returns whether the status landed.
function tryApplyStatus(target: GroundCombatant, id: GambitStatusId, rng: Rng): boolean {
  const resist = target.resists?.[id] ?? 0;
  if (resist > 0 && rng.chance(resist, 1000)) return false;
  applyStatus(target, id);
  return true;
}

// Perform an offensive strike (attack / suppress / execute): a hit-check, then damage + any on-hit
// affliction. `mult` scales base damage (execute bonus / suppress reduction). Draw order, fixed and
// documented: hit-check, then (on hit) the damage variance, then the group-hit splash (no draw), then (on
// hit, if any) the attacker's statusOnHit roll (+ the target's resist roll), then each of the attacker's
// onHitStatuses in order (its chance roll, + the target's resist roll). Combatants with no splash, no
// onHitStatuses and no resists (enemies, a plain member) draw exactly the pre-E-CREW sequence.
function doStrike(
  attacker: GroundCombatant,
  target: GroundCombatant,
  rng: Rng,
  mult: number,
  applyOnHit: boolean,
  state: BattleState,
): void {
  // AF-2: cover against long-range attacks lowers the threshold of the SAME single hit-check draw.
  const hit = rng.chance(Math.round(strikeHitChance(attacker, target) * 1000), 1000);
  if (!hit) return; // a clean miss (the hit-check draw was still consumed, keeping the stream position fixed)
  const dmg = rollDamage(attacker, target, rng, mult);
  dealDamage(target, dmg);
  // Group hit (Scattergun): a share of the landed damage splashes onto every OTHER alive foe of the
  // target's group, in id order. No draw. Its share comes from the weapon's own stat lines.
  if (applyOnHit && attacker.groupHit && attacker.groupHit > 0) {
    const splash = Math.round(dmg * attacker.groupHit);
    if (splash >= 1) {
      const group = state.combatants
        .filter((c) => !c.downed && c.side === target.side && c.id !== target.id && c.groupTag === target.groupTag)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const c of group) dealDamage(c, splash);
    }
  }
  if (applyOnHit && attacker.statusOnHit && !target.downed) {
    if (rng.chance(attacker.statusOnHit.permille, 1000)) tryApplyStatus(target, attacker.statusOnHit.id, rng);
  }
  if (applyOnHit && attacker.onHitStatuses) {
    for (const inflict of attacker.onHitStatuses) {
      if (target.downed) break;
      if (rng.chance(inflict.permille, 1000)) tryApplyStatus(target, inflict.id, rng);
    }
  }
}

// Apply a resolved rule's action. Mutates the working battle clone (combatants + battle state) in place.
// Returns whether the action DID something (used only for readability; the resolver already committed to
// this rule). Unknown/illegal actions are treated as hold.
function applyAction(
  action: GambitActionId,
  actor: GroundCombatant,
  target: GroundCombatant | null,
  rng: Rng,
  state: BattleState,
): void {
  switch (action) {
    case "attack":
      if (target) doStrike(actor, target, rng, 1, true, state);
      return;
    case "suppress":
      if (target) {
        doStrike(actor, target, rng, SUPPRESS_DAMAGE_MULT, false, state);
        if (!target.downed) tryApplyStatus(target, "suppressed", rng);
      }
      return;
    case "execute": {
      if (!target) return;
      const low = target.hp < target.hpMax * EXECUTE_HP_FRACTION;
      doStrike(actor, target, rng, low ? EXECUTE_BONUS_MULT : 1, true, state);
      return;
    }
    case "taunt":
      // Force enemy focus onto the taunter for a couple of rounds (the tank pulls aggro). Recorded on the
      // battle state (see enemyTargetOverride); no rng.
      state.tauntedBy = { id: actor.id, remaining: 2 };
      return;
    case "brace":
      applyStatus(actor, "shielded");
      return;
    case "takeCover":
      applyStatus(actor, "shielded");
      return;
    case "shieldAlly":
      if (target) applyStatus(target, "shielded");
      return;
    case "analyze":
      if (target) applyStatus(target, "corroded"); // reveal weakness == armor down
      return;
    case "aidHeal":
      if (target && !target.downed) {
        target.hp = Math.min(target.hpMax, target.hp + Math.max(1, Math.round(actor.heal)));
      }
      return;
    case "cure":
      // Clear the named debuff (or all debuffs) from the target ally. Params carried on the rule are
      // threaded via the resolver (see evaluateAndAct).
      if (target) clearDebuffs(target, state.pendingCureStatusId);
      return;
    case "secureObjective":
      // E-CREW (Task 13): the objective track is GONE (a battle ends only on clear or wipe). The id stays in
      // the action union for old stored Science programs; it is Science-only, and Science never fights.
      return;
    case "useItem":
      // Spend a team-kit consumable on FIRST AID for the target ally (D20: anyone may, at the user's
      // first-aid effectiveness). Only fires when kit remains AND there is something to cleanse (the
      // resolver gated the target already).
      // E-CREW (Task 20): Fleet Triage (actor.careMult) strengthens the first aid; absent = unchanged.
      if (
        target &&
        state.teamKit > 0 &&
        applyFirstAid(
          target,
          actor.careMult === undefined ? firstAidEffectiveness(actor) : firstAidEffectiveness(actor) * actor.careMult,
          state.pendingCureStatusId,
        )
      ) {
        state.teamKit -= 1;
      }
      return;
    case "fallBack":
    case "hold":
      return; // deliberate no-op this round
  }
}

// ============================================================================
// The interpreter core (generalizable: evaluate a program, act on the first match)
// ============================================================================

// ============================================================================
// TRANSIENT battle log (E3b, DISPLAY-ONLY -- never persisted, never on the parity deep-equal)
// ============================================================================
// A single round-event the E3b battle readout renders. This is a PURE OBSERVATION of what the interpreter
// did in a round: it is populated ONLY when a caller attaches a log sink to the BattleState / resolver, and
// recording only READS combatant state around applyAction (it never draws rng and never mutates combat
// state), so a battle with logging on is byte-identical to one with it off. The UI RE-DERIVES this
// on demand from the stored expedition seed (deriveExpeditionActivityLog); it is NEVER written to the save,
// so it stays out of the crown-jewel parity deep-equal by construction.
export interface GambitLogEvent {
  round: number; // 1-based round number
  side: "team" | "enemy";
  role: GroundRole; // the acting combatant's role
  memberId?: string; // E-CREW (Task 13): the acting named member, when the actor is one
  // "hold" == no rule matched this round. "neuralBackup" (E-CREW Task 16) == the Neural Backup roll on the
  // first ally downed: the actor is the wearer, the target the downed ally, hpDelta the HP they came back
  // with, `missed` when the roll failed.
  action: GambitActionId | "hold" | "neuralBackup";
  targetSide?: "team" | "enemy";
  targetRole?: GroundRole;
  targetMemberId?: string; // E-CREW (Task 13): the target named member, when the target is one
  hpDelta?: number; // negative = damage dealt to the target, positive = healed
  downed?: boolean; // the action downed the target
  missed?: boolean; // an offensive strike that missed (no hp change, target still up)
  statusApplied?: boolean; // the action put a new status on the target (suppress/analyze/brace/shield/...)
  statusCleared?: boolean; // a cure/useItem cleansed a debuff off the target
}

// The mutable per-battle state the interpreter reads + writes. GENERIC over combatants, so a future
// ship-combat gambit layer can build its own combatant set + programs and reuse evaluateAndAct.
export interface BattleState {
  combatants: GroundCombatant[];
  round: number;
  teamKit: number; // remaining team-kit consumables (useItem draws from this)
  tauntedBy: { id: string; remaining: number } | null; // a team member currently pulling enemy aggro
  pendingCureStatusId?: GambitStatusId; // the statusId a firing cure/useItem rule targets (threaded per-eval)
  log?: GambitLogEvent[]; // OPTIONAL transient sink; when present, fired rules append a display-only event
}


// Does a candidate rule actually FIRE for this actor right now? A rule fires when the actor can use its
// action (canActorUse: the role gate + the medic gate), its target selector resolves, and any
// resource/precondition holds (useItem needs kit + a cleansable target; cure needs a cleansable target;
// aidHeal needs an actor that actually heals, so a Standard-Issue Med Kit with no stat lines does not waste
// the turn). Returns the resolved target when it fires, else { fires: false } (try the next rule). This is
// what makes FIRST-MATCH meaningful: a rule that cannot do anything is skipped, not wasted.
// ENGINE FIX (2026-10-06, found while building D19's default program; not a D19 decision): the selector
// is the rule's CONDITION for EVERY action, targetless ones included. A targetless action (brace /
// takeCover / secureObjective / hold / fallBack) used to fire even when its selector resolved nothing, so
// "selfHpBelow 60% -> brace" braced every round at full HP (Turtle Club President's "brace when hurt"
// never meant that). It now fires only when the condition holds; "self" still always resolves for a
// standing actor, so a plain "self -> brace" is unchanged.
function ruleFires(
  rule: GambitRule,
  actor: GroundCombatant,
  state: BattleState,
): { fires: true; target: GroundCombatant | null } | { fires: false } {
  if (!canActorUse(actor, rule.action)) return { fires: false };
  // A taunt only matters when there is an ally to draw fire AWAY from. With no living ally the taunter is
  // already every enemy's only target, so the taunt would just waste the turn: it does not fire, and the
  // next rule acts (2026-10-07: a solo Establish Dominance member used to burn its opening round on it).
  if (rule.action === "taunt" && !state.combatants.some((c) => !c.downed && c.side === actor.side && c.id !== actor.id)) {
    return { fires: false };
  }
  if (rule.action === "aidHeal" && Math.round(actor.heal) < 1) return { fires: false };
  const target = resolveTarget(rule.target, rule.params, actor, state);
  if (!target) return { fires: false };

  // Cure/useItem only fire when the target actually carries a cleansable debuff (else fall through so a
  // lower rule can act). The selector often already found an afflicted ally, but a bare "self"/"allyLowestHp"
  // selector paired with cure must not waste the turn on a clean ally.
  if (rule.action === "cure" || rule.action === "useItem") {
    const sid = rule.params?.statusId;
    const cleansable = sid
      ? hasStatus(target, sid)
      : target.statuses.some((s) => GAMBIT_STATUSES[s.id].kind === "debuff");
    if (!cleansable) return { fires: false };
    if (rule.action === "useItem" && state.teamKit <= 0) return { fires: false };
  }
  return { fires: true, target };
}

// Apply a firing rule's action, threading the cure-status param, and (ONLY when a log sink is attached to
// the battle state) record a transient, display-only GambitLogEvent describing what happened. The no-log
// path is BYTE-IDENTICAL to the pre-E3b sequence (set pendingCureStatusId -> applyAction -> clear), so
// parity is preserved by construction; the log branch merely READS combatant/objective state around
// applyAction (it never draws rng and never changes combat state), so the same battle results either way.
function fireRule(
  rule: GambitRule,
  actor: GroundCombatant,
  target: GroundCombatant | null,
  state: BattleState,
  rng: Rng,
): void {
  if (!state.log) {
    state.pendingCureStatusId = rule.params?.statusId;
    applyAction(rule.action, actor, target, rng, state);
    state.pendingCureStatusId = undefined;
    return;
  }
  // --- logging path (observation only) ---
  const hpBefore = target ? target.hp : 0;
  const downedBefore = target ? target.downed : false;
  const statusesBefore = target ? target.statuses.length : 0;
  const debuffRoundsBefore = target ? debuffRounds(target) : 0;
  state.pendingCureStatusId = rule.params?.statusId;
  applyAction(rule.action, actor, target, rng, state);
  state.pendingCureStatusId = undefined;
  const ev: GambitLogEvent = { round: state.round + 1, side: actor.side, role: actor.role, action: rule.action };
  if (actor.memberId) ev.memberId = actor.memberId;
  if (target) {
    ev.targetSide = target.side;
    ev.targetRole = target.role;
    if (target.memberId) ev.targetMemberId = target.memberId;
    const delta = target.hp - hpBefore;
    if (delta !== 0) ev.hpDelta = delta;
    if (target.downed && !downedBefore) ev.downed = true;
    if (target.statuses.length > statusesBefore) ev.statusApplied = true;
    // A cleanse that only shortened a debuff (untrained first aid, D20) still counts as cleansing.
    if ((rule.action === "cure" || rule.action === "useItem") && debuffRounds(target) < debuffRoundsBefore) ev.statusCleared = true;
    const offensive = rule.action === "attack" || rule.action === "suppress" || rule.action === "execute";
    if (offensive && delta === 0 && !target.downed) ev.missed = true;
  }
  state.log.push(ev);
}

// The total rounds of debuff left on a combatant (display-only, for the log's statusCleared). Pure.
function debuffRounds(c: GroundCombatant): number {
  let n = 0;
  for (const s of c.statuses) if (GAMBIT_STATUSES[s.id].kind === "debuff") n += s.remaining;
  return n;
}

// Record an actor holding (no rule matched) -- only when a log sink is present.
function recordHold(state: BattleState, actor: GroundCombatant): void {
  if (!state.log) return;
  const ev: GambitLogEvent = { round: state.round + 1, side: actor.side, role: actor.role, action: "hold" };
  if (actor.memberId) ev.memberId = actor.memberId;
  state.log.push(ev);
}

// Evaluate a program TOP-DOWN for one actor and ACT on the FIRST matching rule. Returns nothing; mutates
// the battle state. This is the reusable interpreter core (ground + future ship combat both call it).
export function evaluateAndAct(program: GambitProgram, actor: GroundCombatant, state: BattleState, rng: Rng): void {
  for (const rule of program) {
    const res = ruleFires(rule, actor, state);
    if (!res.fires) continue;
    fireRule(rule, actor, res.target, state, rng);
    return; // first match fired: done for this actor this round
  }
  // No rule matched: the actor holds this round (does nothing).
  recordHold(state, actor);
}

// The program that drives a combatant: a named member's OWN program (E-CREW Task 13, per-member gambits;
// the snapshot already resolved an absent one to DEFAULT_MEMBER_GAMBIT); else, for a Security combatant
// with no program at all (only a hand-built one), the same built-in DEFAULT_MEMBER_GAMBIT (D19: never the
// account-level pair); else the enemy role program. A "science" combatant never reaches a battle (nothing
// executes a Science program); it holds.
function programFor(actor: GroundCombatant): GambitProgram {
  if (actor.program) return actor.program;
  if (actor.role === "security") return DEFAULT_MEMBER_GAMBIT;
  if (actor.role === "science") return [];
  return ENEMY_ROLE_PROGRAMS[actor.role as EnemyRole] ?? [];
}

// When enemies pick a foe target, a live taunt overrides their selector: they focus the taunter (as long
// as it is alive). Returns the override combatant, or null to use the normal selector.
function enemyTargetOverride(state: BattleState): GroundCombatant | null {
  if (!state.tauntedBy) return null;
  const taunter = state.combatants.find((c) => c.id === state.tauntedBy!.id && !c.downed);
  return taunter ?? null;
}

// E-CREW (Task 13, the Bulwark trait): an enemy strike aimed at a team member below a guard's HP line is
// taken by that guard instead (the lowest-id alive guard that is not the target itself). Null when there
// is no such guard (a squad with no Bulwark member). No rng.
function guardFor(state: BattleState, target: GroundCombatant | null): GroundCombatant | null {
  if (!target || target.side !== "team") return null;
  const guards = state.combatants
    .filter(
      (c) =>
        !c.downed &&
        c.side === "team" &&
        c.id !== target.id &&
        c.guardBelow !== undefined &&
        target.hp < target.hpMax * c.guardBelow
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return guards[0] ?? null;
}

// ============================================================================
// The battle resolver (deterministic; one atomic fight)
// ============================================================================

export interface GroundBattleResult {
  result: "win" | "loss";
  rounds: number;
  teamAliveCount: number;
  enemyAliveCount: number;
  teamHpRemaining: number; // summed team HP at the end (a "how decisively" signal for tests/telemetry)
  // E-CREW (Task 14, for Task 16 injuries): the named members (GroundCombatant.memberId) DOWN when the
  // battle ended, win or lose, in combatant order. Unnamed combatants (enemies, hand-built test allies)
  // never appear.
  downedMemberIds: string[];
  // E-CREW (Task 16): present ONLY when a Neural Backup roll happened this battle: whom it rolled for (the
  // first ally downed) and whether they came back. Absent in every battle without a wearer or a down, so
  // such a battle's result is exactly the pre-Task-16 shape.
  neuralBackup?: { memberId?: string; revived: boolean };
}

// Run ONE ground battle to completion. Deterministic in (combatants, programs, rng). WIN when every enemy
// is down; LOSS when the team is wiped or the round cap is hit (E-CREW Task 13: a battle ends ONLY on a
// clear or a wipe; the old objective track that could win mid-fight is gone). Each named member runs its
// own program (GroundCombatant.program; see programFor). D19: no program pair is passed in. Mutates
// the passed combatants' clones inside a fresh BattleState (the caller owns cloning if it must preserve
// inputs; buildRosterCombatants + generateEncounter both mint fresh combatants, so callers here pass throwaways).
//
// E-CREW (Task 16) NEURAL BACKUP (D11): when a team combatant carries `revive` (the wearer, the first such
// in combatant order; the implant is unique-equipped, so there is at most one), the FIRST team member
// downed (the wearer included; on a tick that downs several at once, the first in combatant order) rolls
// ONCE, from its own keyed stream makeRng(reviveSeed ^ NEURAL_BACKUP_SALT): on a hit they stand back up at
// hpFraction of their max HP with their statuses cleared. Win or lose, the backup is then spent for this
// battle, so it never fires twice and never on a second member. The check runs after every action and
// after the end-of-round upkeep, reads state only, and draws NOTHING from `rng`: a battle without a wearer
// (or one where nobody goes down) is identical to the pre-Task-16 battle, and a failed roll changes
// nothing but one log line. `reviveSeed` defaults to 0 (a hand-built battle); the expedition callers pass
// the battle's own keyed seed.
export function resolveGroundBattle(
  team: GroundCombatant[],
  enemies: GroundCombatant[],
  teamKit: number,
  rng: Rng,
  log?: GambitLogEvent[], // OPTIONAL transient sink (E3b); undefined => byte-identical no-log behavior
  reviveSeed: number = 0,
): GroundBattleResult {
  const state: BattleState = {
    combatants: [...team, ...enemies],
    round: 0,
    teamKit,
    tauntedBy: null,
    log,
  };

  const teamAlive = () => state.combatants.filter((c) => c.side === "team" && !c.downed);
  const enemyAlive = () => state.combatants.filter((c) => c.side === "enemy" && !c.downed);

  // Neural Backup: the wearer (if any) and the once-per-battle latch.
  const wearer = state.combatants.find((c) => c.side === "team" && c.revive !== undefined) ?? null;
  let backup: GroundBattleResult["neuralBackup"] | undefined;
  const checkNeuralBackup = (): void => {
    if (!wearer || backup) return;
    const fallen = state.combatants.find((c) => c.side === "team" && c.downed);
    if (!fallen) return;
    const spec = wearer.revive!;
    const revived = makeRng((reviveSeed ^ NEURAL_BACKUP_SALT) >>> 0).chance(spec.permille, 1000);
    backup = fallen.memberId !== undefined ? { memberId: fallen.memberId, revived } : { revived };
    let hp = 0;
    if (revived) {
      hp = Math.max(1, Math.round(fallen.hpMax * spec.hpFraction));
      fallen.hp = hp;
      fallen.downed = false;
      fallen.statuses = [];
    }
    if (state.log) {
      const ev: GambitLogEvent = { round: state.round + 1, side: "team", role: wearer.role, action: "neuralBackup" };
      if (wearer.memberId) ev.memberId = wearer.memberId;
      ev.targetSide = "team";
      ev.targetRole = fallen.role;
      if (fallen.memberId) ev.targetMemberId = fallen.memberId;
      if (revived) ev.hpDelta = hp;
      else ev.missed = true;
      state.log.push(ev);
    }
  };

  const summarize = (result: "win" | "loss"): GroundBattleResult => {
    const out: GroundBattleResult = {
      result,
      rounds: state.round,
      teamAliveCount: teamAlive().length,
      enemyAliveCount: enemyAlive().length,
      teamHpRemaining: teamAlive().reduce((sum, c) => sum + c.hp, 0),
      downedMemberIds: state.combatants
        .filter((c) => c.side === "team" && c.downed && c.memberId !== undefined)
        .map((c) => c.memberId as string),
    };
    if (backup) out.neuralBackup = backup;
    return out;
  };

  while (state.round < MAX_ROUNDS) {
    // Fixed acting order: team first (by id), then enemies (by id). Stable => deterministic. On the
    // opening round a First Strike member (Quick Draw) acts ahead of the rest of the team.
    const opening = state.round === 0;
    const order = [...state.combatants].sort((a, b) => {
      if (a.side !== b.side) return a.side === "team" ? -1 : 1;
      if (opening && !!a.firstStrike !== !!b.firstStrike) return a.firstStrike ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    for (const actor of order) {
      if (actor.downed) continue;
      // Stun: skip the action (the stun still ticks down at end of round).
      if (hasStatus(actor, "stun")) continue;
      // Fear: a chance to fall back (do nothing) instead of acting.
      if (hasStatus(actor, "fear") && rng.chance(Math.round(GAMBIT_STATUSES.fear.magnitude * 1000), 1000)) continue;

      const program = programFor(actor);
      if (actor.side === "enemy") {
        // Enemies obey a live taunt (an offensive strike retargets onto the taunter) and a guard (a strike
        // at a hurt ally is taken by a Bulwark member). With neither in play this is evaluateAndAct exactly.
        evaluateEnemy(program, actor, state, rng);
        checkNeuralBackup();
        continue;
      }
      evaluateAndAct(program, actor, state, rng);
      checkNeuralBackup();
    }

    // End-of-round upkeep: DoT ticks + status duration decrement + taunt decrement.
    tickEndOfRound(state);
    checkNeuralBackup();

    // Win/loss checks: a clear wins, a wipe loses. Nothing else ends a fight.
    if (enemyAlive().length === 0) return summarize("win");
    if (teamAlive().length === 0) return summarize("loss");
    state.round += 1;
  }
  // Round cap reached without a decision: treat as a LOSS (the away team disengages / evacuates).
  return summarize("loss");
}

// An enemy's turn: the same first-match evaluation as evaluateAndAct, except an offensive strike retargets
// onto a live taunter, else onto a guard covering a hurt ally (E-CREW Task 13), else keeps its own target.
// Non-offensive actions (a healer's aidHeal on a wounded ally) are unaffected. With no taunt and no guard
// in play this is byte-identical to evaluateAndAct.
function evaluateEnemy(program: GambitProgram, actor: GroundCombatant, state: BattleState, rng: Rng): void {
  const taunter = enemyTargetOverride(state);
  for (const rule of program) {
    const res = ruleFires(rule, actor, state);
    if (!res.fires) continue;
    const offensive = rule.action === "attack" || rule.action === "suppress" || rule.action === "execute";
    const target = offensive ? taunter ?? guardFor(state, res.target) ?? res.target : res.target;
    fireRule(rule, actor, target, state, rng);
    return;
  }
  recordHold(state, actor);
}

// End-of-round upkeep, IN PLACE: apply DoT damage, then decrement every status' remaining (pruning at 0),
// then decrement a live taunt. DoT draws no rng (fixed magnitude). Done in a fixed order so the stream +
// state stay deterministic.
export function tickEndOfRound(state: BattleState): void {
  for (const c of state.combatants) {
    if (c.downed) continue;
    for (const s of c.statuses) {
      if (GAMBIT_STATUSES[s.id].effect === "dotDamage") dealDamage(c, Math.round(s.magnitude));
    }
  }
  for (const c of state.combatants) {
    c.statuses = c.statuses
      .map((s) => ({ ...s, remaining: s.remaining - 1 }))
      .filter((s) => s.remaining > 0);
  }
  if (state.tauntedBy) {
    state.tauntedBy.remaining -= 1;
    if (state.tauntedBy.remaining <= 0) state.tauntedBy = null;
  }
}

// ============================================================================
// Team derivation from crew (no new gear layer) -- snapshotted at dispatch
// ============================================================================

// The away team's derived strengths + kit, read from the ship's CREW (crewOverlay's division vocabulary:
// Security + Science are professions; tactical/science/medical are the relevant officer seats). PURE:
// reads ship.complement + state.officers + state.notableCrew + the static rarity/rank scalars, mutates
// nothing. A bare ship (no crew) yields 0 strengths + the base kit (the named members still fight at their
// own base stats). FIRST-PASS TUNABLE derivation.
export interface AwayTeamSnapshot {
  securityStrength: number;
  scienceStrength: number;
  teamKit: number;
}

// Sum a bucket-list's strength for a given profession: count * rarity multiplier * rank factor (the same
// scalars crew.ts contributionForSignature uses), so better/higher-rank crew is worth more.
function professionStrength(
  buckets: { profession: CrewProfession; rarity: EquipmentRarity; rank: Parameters<typeof rankMagnitudeFactor>[0]; count: number }[],
  profession: CrewProfession,
): number {
  let total = 0;
  for (const b of buckets) {
    if (b.profession !== profession) continue;
    total += b.count * crewRarityMultiplier(b.rarity) * rankMagnitudeFactor(b.rank);
  }
  return total;
}

// Headcount of a profession (for the team-kit derivation).
function professionHeadcount(
  buckets: { profession: CrewProfession; count: number }[],
  profession: CrewProfession,
): number {
  return buckets.filter((b) => b.profession === profession).reduce((n, b) => n + b.count, 0);
}

export function deriveAwayTeam(state: GameState, ship: ShipInstance): AwayTeamSnapshot {
  const buckets = ship.complement?.buckets ?? [];
  // Assigned notables sit on top of the bucket bulk (same authority as officer seating; mirrors
  // crewOverlay's assignedNotables handling), each as a single crew of its signature.
  const notables = state.notableCrew.filter((n) => (n.assignedShipId ?? null) === ship.id);
  const notableBuckets = notables.map((n) => ({ profession: n.profession, rarity: n.rarity, rank: n.rank, count: 1 }));
  const all = [...buckets, ...notableBuckets];

  let security = professionStrength(all, "security");
  let science = professionStrength(all, "science");

  // Officers assigned to this ship add strength by seat: tactical -> Security, science/medical -> Science.
  // Rank-scaled via the same rank magnitude factor family (officer ranks map through their bonus
  // magnitudes; first-pass we use a flat OFFICER_STRENGTH scaled by the number of rolled bonuses as a
  // simple rank proxy, since officer combat power is not in the crew overlay).
  const securitySeats: ReadonlySet<SeniorStaffSeat> = new Set<SeniorStaffSeat>(["tactical"]);
  const scienceSeats: ReadonlySet<SeniorStaffSeat> = new Set<SeniorStaffSeat>(["science", "medical"]);
  for (const officer of state.officers) {
    if (officer.assignedShipId !== ship.id) continue;
    const strength = OFFICER_STRENGTH * (1 + officer.bonuses.length * 0.25);
    if (securitySeats.has(officer.seat)) security += strength;
    else if (scienceSeats.has(officer.seat)) science += strength;
  }

  // Team kit: a base plus a share of the ship's medical + operations crew (the support branches that
  // stock cures/stims). Clamped to a sane max.
  const supportHeads = professionHeadcount(all, "medical") + professionHeadcount(all, "operations");
  const teamKit = Math.min(
    TEAM_KIT_MAX,
    TEAM_KIT_BASE + TEAM_KIT_PER_MEDICAL * Math.floor(supportHeads / TEAM_KIT_MEDICAL_DIVISOR),
  );

  // Exploration 0.14.0 (Phase E4b): the account-level museum's scienceTeamPower multiplies the derived
  // Science strength by (1 + b). Applied HERE (not at the dispatch call site) so the dispatch console's
  // away-team preview and the snapshot startExpedition stores are the SAME number. startExpedition
  // snapshots the result, so a museum that grows mid-flight never changes an in-flight team. b = 0 for an
  // empty museum: the multiply is skipped entirely, so the snapshot is bit-identical to E4a.
  const sciencePower = museumBonuses(state).scienceTeamPower;
  if (sciencePower !== 0) science = science * (1 + sciencePower);

  return { securityStrength: security, scienceStrength: science, teamKit };
}

// Build the NAMED Security squad from the roster snapshot (E-CREW Task 13, design section 5.3): one
// combatant per snapshotted member, in snapshot (deploy) order. Member power =
//   (Security base + spec base + crew layer) * rank factor * (1 + the member's summed gear/trait bump)
// for hp / power / armor; accuracy = base * (1 + bump), capped; the crew layer is the squad-wide
// securityStrength shared evenly across the deployed members (STRENGTH_HP_COEFF / STRENGTH_POWER_COEFF).
// Effects become combatant fields: Medical Training (the medic trait) makes the member a medic, and D20: a
// heal tool (Med Kit) adds to a TRAINED member's heal only, doing nothing for anyone else; heal, inflict
// and group-hit strength come from the pieces' own stat lines (GEAR EFFECTS SCALE WITH STAT LINES;
// weaponRange is positioning only and changes no number here). Each member carries its OWN program.
// PURE: mints fresh combatants from plain snapshot data. An empty list yields [] (no team: see
// resolveExpeditionActivity).
// E-CREW (Task 16): `sittingOut` names the members DOWNED in an earlier battle of the run (user rule,
// 2026-10-07: they sit out the rest of the run). They are left out of the team, but the crew layer share
// and every combatant id stay as at dispatch (the share is split over the whole deployed squad, the id is
// the member's deploy index), so a member's numbers never change because a squadmate is out, and a battle
// with nobody out is exactly the pre-Task-16 battle. Neural Backup (a `revive` effect) becomes `revive`.
export function buildRosterCombatants(
  members: readonly SnapshotMember[],
  securityStrength: number,
  idPrefix: string,
  sittingOut?: ReadonlySet<string>,
  care: SquadOfficerCare = {},
): GroundCombatant[] {
  if (members.length === 0) return [];
  const crewPer = securityStrength / members.length;
  // E-CREW (Task 20): the squad's officer care (see SquadOfficerCare). Negative or absent reads as 0.
  const triage = Math.max(0, care.triage ?? 0);
  const fearResist = Math.max(0, Math.min(1, care.fearResist ?? 0));
  const team = members.map((m, i) => {
    const spec = SECURITY_SPEC_BASE[m.spec as SecuritySpec] ?? { hp: 0, power: 0, armor: 0, statusChance: 0 };
    const bump = (stat: string): number => m.groundStats[stat] ?? 0;
    const rf = m.rankFactor;
    const hp = Math.max(1, Math.round((SECURITY_BASE_HP + spec.hp + crewPer * STRENGTH_HP_COEFF) * rf * (1 + bump("hp"))));
    const power = Math.max(0, (SECURITY_BASE_POWER + spec.power + crewPer * STRENGTH_POWER_COEFF) * rf * (1 + bump("power")));
    const armor = Math.max(0, (SECURITY_BASE_ARMOR + spec.armor) * rf * (1 + bump("armor")));
    const accuracy = Math.max(0, Math.min(MEMBER_ACCURACY_CAP, SECURITY_BASE_ACCURACY * (1 + bump("accuracy"))));
    const statusChance = Math.max(0, Math.min(MEMBER_STATUS_CHANCE_CAP, spec.statusChance + bump("statusChance")));

    let medicTrait = false;
    let healPoints = 0;
    let groupPoints = 0;
    let firstStrike = false;
    let guardBelow: number | undefined;
    let revive: GroundCombatant["revive"];
    const inflicts: GambitStatusId[] = [];
    for (const e of m.effects) {
      switch (e.kind) {
        case "medic":
          medicTrait = true;
          break;
        case "heal":
          healPoints += e.points; // counts only with Medical Training (below)
          break;
        case "groupHit":
          groupPoints += e.points;
          break;
        case "inflict":
          if (!inflicts.includes(e.status)) inflicts.push(e.status);
          break;
        case "firstStrike":
          firstStrike = true;
          break;
        case "guard":
          guardBelow = Math.max(guardBelow ?? 0, e.allyHpBelow);
          break;
        case "revive":
          // Neural Backup (Task 16): the catalog's fixed chance and HP share (D11, "~50%" at 30% HP). The
          // implant has no free Quartermaster floor, so a worn one always carries rolled lines.
          revive = { permille: Math.round(e.chance * 1000), hpFraction: e.hpFraction };
          break;
        // poiYield (fieldwork, Task 15) is not a battle stat.
      }
    }
    // D20: the Med Kit requires Medical Training. Untrained, the kit adds nothing and the member heals 0.
    // E-CREW (Task 20): Fleet Triage strengthens a medic's heal (0 stays 0: an untrained member never heals).
    const baseHeal = medicTrait ? (MEDIC_BASE_HEAL + healPoints * HEAL_PER_GEAR_POINT) * rf : 0;
    const heal = triage > 0 ? baseHeal * (1 + triage) : baseHeal;
    const permille = Math.round(statusChance * 1000);

    const c: GroundCombatant = {
      id: `${idPrefix}-sec-${i}`,
      side: "team",
      role: "security",
      hp,
      hpMax: hp,
      power,
      accuracy,
      armor,
      heal,
      threat: power,
      groupTag: "security",
      statuses: [],
      downed: false,
      memberId: m.memberId,
      program: m.gambit,
    };
    if (medicTrait) c.medic = true;
    if (permille > 0 && inflicts.length > 0) c.onHitStatuses = inflicts.map((id) => ({ id, permille }));
    const groupHit = Math.min(GROUP_HIT_CAP, groupPoints * GROUP_HIT_PER_POINT);
    if (groupHit > 0) c.groupHit = groupHit;
    const resists: Partial<Record<GambitStatusId, number>> = {};
    for (const [id, chance] of Object.entries(m.resists) as [GambitStatusId, number][]) {
      // E-CREW (Task 20): Morale Anchor folds into a member's OWN Fear resist (independent chances).
      const own = id === "fear" && fearResist > 0 ? 1 - (1 - chance) * (1 - fearResist) : chance;
      const r = Math.round(own * 1000);
      if (r > 0) resists[id] = r;
    }
    // E-CREW (Task 20): a member with no Fear resist of their own still gets Morale Anchor's.
    if (fearResist > 0 && m.resists.fear === undefined) {
      const r = Math.round(fearResist * 1000);
      if (r > 0) resists.fear = r;
    }
    if (Object.keys(resists).length > 0) c.resists = resists;
    if (triage > 0) c.careMult = 1 + triage;
    if (firstStrike) c.firstStrike = true;
    if (guardBelow !== undefined) c.guardBelow = guardBelow;
    if (revive && revive.permille > 0) c.revive = revive;
    return c;
  });
  return sittingOut && sittingOut.size > 0 ? team.filter((c) => !sittingOut.has(c.memberId as string)) : team;
}

// The team an expedition activity fields: the named Security roster. Science NEVER fights. D18: there is
// no anonymous stand-in, so an expedition with no Security member in its roster (only possible for one
// launched before D18) fields an EMPTY team, and the caller resolves the task without a battle. E-CREW
// Task 16: members in `sittingOut` (downed earlier in the run) stay out; an all-out squad is an empty team
// too. PURE.
// E-CREW Task 20: the run's frozen officer care (Fleet Triage, Morale Anchor) rides along.
export function expeditionTeamCombatants(exp: Expedition, idPrefix: string, sittingOut?: ReadonlySet<string>): GroundCombatant[] {
  return buildRosterCombatants(exp.roster?.security ?? [], exp.securityStrength, idPrefix, sittingOut, {
    triage: exp.squadTriage,
    fearResist: exp.squadFearResist,
  });
}

// ============================================================================
// E-CREW (Task 16): who SITS OUT (user rule, 2026-10-07, "Sits out the rest" chosen 2026-10-09)
// ============================================================================
//
// A member DOWNED at the end of any battle of a run (a scan encounter, an activity battle, or an earlier
// attempt of the same task) takes no part in any later battle of that run, and comes home injured. The
// record is the run itself: ExpeditionScanEvent.downedMemberIds (in scan order) and
// ExpeditionActivity.downedMemberIds (in flat task order). The run resolves in ONE fixed order however the
// time is chunked: every scan boundary (body by body, step by step) before any task, then the tasks in flat
// order. So "everyone downed before this battle" is a pure function of the stored run, keyed by the
// battle's place in that order, and reads the same live, offline, and in a later display re-derivation
// (offline == live by construction).
//
// FIELDWORK is untouched on purpose: only Security fights, so only Security goes down, and a Security
// member does no fieldwork (fieldwork.ts reads roster.science only). If a later mechanic could down a
// Science member, note that fieldwork pace sets the activities phase length: a mid-phase change there would
// need the phase math reworked first.

// Everyone downed at a scan boundary STRICTLY BEFORE `body` boundary `step` (scan order). Pure.
export function scanDownedBefore(exp: Pick<Expedition, "scanEvents">, bodyIndex: number, step: number): Set<string> {
  const out = new Set<string>();
  const key = scanStepKey(bodyIndex, step);
  for (const ev of exp.scanEvents ?? []) {
    if (scanStepKey(ev.bodyIndex, ev.step) >= key) continue;
    for (const id of ev.downedMemberIds ?? []) out.add(id);
  }
  return out;
}

// Everyone downed before the task at flat index `globalIndex`: every scan boundary (all of scanning
// precedes the tasks) plus every task with a lower flat index. Pure.
export function activityDownedBefore(exp: Pick<Expedition, "scanEvents" | "bodies">, globalIndex: number): Set<string> {
  const out = new Set<string>();
  for (const ev of exp.scanEvents ?? []) for (const id of ev.downedMemberIds ?? []) out.add(id);
  let i = 0;
  for (const body of exp.bodies) {
    for (const act of body.activities) {
      if (i >= globalIndex) return out;
      for (const id of act.downedMemberIds ?? []) out.add(id);
      i++;
    }
  }
  return out;
}

// Everyone downed anywhere in the run so far, in order of first going down (scan boundaries, then tasks).
// At claim this is the list of members who come home injured. Pure.
export function expeditionDownedMemberIds(exp: Pick<Expedition, "scanEvents" | "bodies">): string[] {
  const out: string[] = [];
  const add = (ids: readonly string[] | undefined): void => {
    for (const id of ids ?? []) if (!out.includes(id)) out.push(id);
  };
  for (const ev of exp.scanEvents ?? []) add(ev.downedMemberIds);
  for (const body of exp.bodies) for (const act of body.activities) add(act.downedMemberIds);
  return out;
}

// ============================================================================
// Encounter generation (seeded; scaled by planet HAZARD + the PoI)
// ============================================================================

// --- Enemy base stats per role (before hazard scaling), FIRST-PASS TUNABLE ---
const ENEMY_ROLE_STATS: Record<EnemyRole, { hp: number; power: number; armor: number; accuracy: number; heal: number }> = {
  bruiser: { hp: 70, power: 9, armor: 6, accuracy: 0.85, heal: 0 },
  striker: { hp: 34, power: 15, armor: 2, accuracy: 0.9, heal: 0 },
  healer: { hp: 40, power: 5, armor: 3, accuracy: 0.8, heal: 16 },
  caster: { hp: 36, power: 8, armor: 2, accuracy: 0.85, heal: 0 },
  swarm: { hp: 18, power: 6, armor: 1, accuracy: 0.8, heal: 0 },
};

// Which enemy roles a PoI fields (the "guardians" of each find). Chosen so a find's flavor drives its
// threat mix: a Buried Vault is guarded by a Healer + Bruisers behind the fight; a Subterranean
// Civilization mixes a Caster in (the big prize is dangerous); an Outpost is Strikers; a Cave Network is
// a Swarm. Every PoI has a fallback (its own list + a default). FIRST-PASS TUNABLE + LOCKED-shape content.
const POI_ENCOUNTER_ROLES: Record<string, EnemyRole[]> = {
  buriedVault: ["healer", "bruiser", "bruiser"],
  subterraneanCivilization: ["healer", "caster", "bruiser", "striker"],
  ancientRuins: ["bruiser", "striker"],
  crashedShip: ["striker", "swarm"],
  derelictOutpost: ["striker", "striker", "swarm"],
  geothermalChamber: ["caster", "bruiser"],
  caveNetwork: ["swarm", "swarm", "swarm"],
  xenoFloraBloom: ["caster", "swarm"],
  mineralOutcrop: ["bruiser", "swarm"],
  // Squads SQ-4 hostile sites (riskFactors.ts; never drawn as discoveries) [PROPOSAL guards for the content pass]:
  // a colony's defenders, and a fortification's garrison with its medic and caster behind the line.
  enemyColony: ["striker", "striker", "bruiser", "healer"],
  enemyFortification: ["bruiser", "bruiser", "striker", "striker", "caster", "healer"],
  // Squads SQ-6 follow-up clearing tasks (riskFactors.ts CLEARING_SITE_RULES) [PROPOSAL guards]: an armed band, and
  // the predators around the landing zone.
  clearHostiles: ["striker", "striker", "bruiser"],
  secureLandingZone: ["swarm", "swarm", "bruiser"],
};
const DEFAULT_ENCOUNTER_ROLES: EnemyRole[] = ["striker", "bruiser"];

// Hazard scales enemy count + stats: a more hazardous body fields a slightly larger, stronger guard. The
// count add is seeded (so two same-hazard bodies vary), and the stat multiplier rises with hazard.
const HAZARD_EXTRA_ENEMY_PERMILLE = 600; // per hazard point, the chance to add one extra enemy body
const HAZARD_STAT_COEFF = 0.8; // enemy HP/power scale by (1 + hazard * this)

// Generate a seeded, role-tagged enemy set for one activity, scaled by the body's hazard + the PoI. PURE:
// mints fresh combatants from the injected seed. The Healer presence (Vault / Subterranean) is what makes
// "target the healer" the winning line on hard finds.
//
// Safe first runs SF-2: an optional PROFILE scales the guard (absent = exactly today's encounter): HP, power and heal
// (threat follows power) times `scale` after the hazard multiplier, and at most `maxEnemies` enemies (the first ones in
// role order; null = no cap). Every draw is taken as before (the extra-enemy roll included), so the stream is unchanged.
export interface EncounterProfile {
  scale: number;
  maxEnemies: number | null;
}
export function generateEncounter(seed: number, hazard: number, poiId: string, profile?: EncounterProfile): GroundCombatant[] {
  const rng = makeRng(seed >>> 0);
  const roles = (POI_ENCOUNTER_ROLES[poiId] ?? DEFAULT_ENCOUNTER_ROLES).slice();
  // Hazard may add one extra body (a seeded roll), drawn from the PoI's own role list so the extra fits
  // the encounter's flavor.
  if (rng.chance(Math.round(Math.min(1, Math.max(0, hazard)) * HAZARD_EXTRA_ENEMY_PERMILLE), 1000)) {
    roles.push(roles[rng.nextInt(roles.length)]);
  }
  if (profile && profile.maxEnemies !== null && roles.length > profile.maxEnemies) roles.length = Math.max(1, Math.floor(profile.maxEnemies));
  const statMult = (1 + Math.max(0, hazard) * HAZARD_STAT_COEFF) * (profile ? Math.max(0, profile.scale) : 1);
  const groupCounts = new Map<EnemyRole, number>();
  return roles.map((role) => {
    const n = (groupCounts.get(role) ?? 0) + 1;
    groupCounts.set(role, n);
    const base = ENEMY_ROLE_STATS[role];
    const hp = Math.round(base.hp * statMult);
    const power = base.power * statMult;
    const combatant: GroundCombatant = {
      id: `enemy-${role}-${n}`,
      side: "enemy",
      role,
      hp,
      hpMax: hp,
      power,
      accuracy: base.accuracy,
      armor: base.armor,
      heal: base.heal * statMult,
      threat: power,
      groupTag: role, // enemies of the same archetype share a group (foeLargestGroup)
      statuses: [],
      downed: false,
    };
    // A Caster's plain attack applies an affliction (alternating poison/weakened by count for variety),
    // which is what forces the "cure the poisoned ally" gambit to matter.
    if (role === "caster") {
      combatant.statusOnHit = { id: n % 2 === 0 ? "weakened" : "poison", permille: 600 };
    }
    return combatant;
  });
}

// ============================================================================
// Rewards (findings become REAL) -- REUSE the salvage tiered-rarity roll
// ============================================================================

// --- Planet-type-flavored material tables (FIRST-PASS TUNABLE; existing item ids so E4 can deposit) ---
// Each entry is a small pool of {itemId, weight}; a win grants a seeded quantity of one drawn item.
const MATERIAL_BY_PLANET_TYPE: Record<string, { itemId: string; weight: number }[]> = {
  terrestrial: [{ itemId: "scrapAlloy", weight: 3 }, { itemId: "titaniumIngot", weight: 1 }],
  ocean: [{ itemId: "scrapAlloy", weight: 2 }, { itemId: "salvagedCircuitry", weight: 1 }],
  arid: [{ itemId: "scrapAlloy", weight: 2 }, { itemId: "titaniumIngot", weight: 1 }],
  volcanic: [{ itemId: "titaniumIngot", weight: 2 }, { itemId: "anomalousAlloy", weight: 1 }],
  frozen: [{ itemId: "scrapAlloy", weight: 2 }, { itemId: "salvagedCircuitry", weight: 1 }],
  gasGiant: [{ itemId: "salvagedCircuitry", weight: 2 }, { itemId: "anomalousAlloy", weight: 1 }],
  barren: [{ itemId: "scrapAlloy", weight: 3 }, { itemId: "titaniumIngot", weight: 1 }],
  toxic: [{ itemId: "anomalousAlloy", weight: 2 }, { itemId: "titaniumIngot", weight: 1 }],
};
const DEFAULT_MATERIALS: { itemId: string; weight: number }[] = [{ itemId: "scrapAlloy", weight: 1 }];

const MATERIAL_QTY_MIN = 2;
const MATERIAL_QTY_MAX = 6;
const CREDITS_BASE = 40; // base credit reward for a task
const CREDITS_HAZARD_COEFF = 120; // + this * hazard (harder finds pay more)
const EVAC_REWARD_FRACTION = 0.4; // an EVACUATED (lost) task keeps this fraction of the material/credit haul, no relic

// The PoIs whose findings can carry a RELIC lead. E4a: no longer a hand-kept list here. It is DERIVED
// from relics.ts RELIC_SET_BY_POI (each relic set's own `sources`), the ONE source of truth that the E2c
// foreknowledge relic signature (expedition.ts) reads too, so the reward roll and the signature cannot
// drift. Re-exported under the E3a name so existing importers keep working. (relics.ts imports no engine
// module, so there is no import cycle.)
export { RELIC_BEARING_POIS };

// The base per-win chance a relic-bearing PoI yields a relic token, before the hazard bonus.
const RELIC_BASE_PERMILLE = 350; // 35% on a relic-bearing PoI win
const RELIC_HAZARD_PERMILLE = 400; // + up to this much at hazard 1.0

// Weighted pick over {weight}-carrying items using ONE integer draw over the total weight (the same
// device as expedition.ts pickWeightedPoi + salvage.ts weightedPick, kept local to avoid a cross-module
// import). Assumes a non-empty list with positive total weight.
function pickWeighted<T extends { weight: number }>(rng: Rng, items: T[]): T {
  let total = 0;
  for (const it of items) total += it.weight;
  let roll = rng.nextInt(Math.max(1, total));
  for (const it of items) {
    roll -= it.weight;
    if (roll < 0) return it;
  }
  return items[items.length - 1];
}

// Roll a relic's rarity TIER by REUSING the salvage tiered-rarity machinery (SALVAGE_LOOT_POOLS): we draw
// a tier from the intactReactorCore pool's ordered tier list, weighted by each tier's own weight, with a
// hazard-scaled CEILING that mirrors salvage's baseCeilingForLevel + slice (a more hazardous find can
// reach a higher relic tier). The relic keeps the tier's rarity NAME + quality bucket but stays
// UNIDENTIFIED (E4 owns the concrete relic + its bonus). Returns the token, or null if the chance missed.
// Draw order: relic chance, then (on hit) the tier pick -- fixed + documented.
//
// E4b: `findBonus` is the expedition's SNAPSHOTTED museum relicFindChance. It multiplies the permille chance
// by (1 + findBonus), rounded to a whole permille and capped at 1000 (a certain drop, never more). It only
// moves the threshold of the SAME single chance draw, so the draw order above is unchanged. 0 (the
// default, an empty museum) skips the multiply entirely, so the chance is bit-identical to E4a.
export function rollRelicToken(
  seed: number,
  hazard: number,
  poiId: string,
  relicId: string,
  findBonus: number = 0,
): ExpeditionRelicToken | null {
  if (!isRelicBearingPoi(poiId)) return null;
  const rng = makeRng(seed >>> 0);
  const baseChance = Math.min(1000, RELIC_BASE_PERMILLE + Math.round(Math.max(0, Math.min(1, hazard)) * RELIC_HAZARD_PERMILLE));
  const chance = findBonus > 0 ? Math.min(1000, Math.round(baseChance * (1 + findBonus))) : baseChance;
  if (!rng.chance(chance, 1000)) return null;
  // REUSE the salvage tier ladder: hazard sets how far up the ordered tiers the roll can reach.
  const pool = SALVAGE_LOOT_POOLS.intactReactorCore;
  const ceiling = Math.min(pool.length - 1, Math.max(0, Math.round(hazard * (pool.length - 1))));
  const eligible = pool.slice(0, ceiling + 1);
  const tier = pickWeighted(rng, eligible);
  return { id: relicId, tier: tier.tier as EquipmentRarity, quality: tier.quality, unidentified: true };
}

// Roll the full material + credit haul for a task, seeded. Materials are planet-type flavored; credits
// scale with hazard. `scale` reduces the haul on an evacuation (keep-what-you-gathered). PURE. Draw order:
// material item, then material quantity (fixed). Exported (GO-4): Ground Ops rolls a task's full haul with it
// (groundTasks.ts taskFullHaul) on the same taskRewardSeed.
export function rollHaul(
  seed: number,
  planetType: string,
  hazard: number,
  scale: number,
): { materials: Record<string, number>; credits: number } {
  const rng = makeRng(seed >>> 0);
  const table = MATERIAL_BY_PLANET_TYPE[planetType] ?? DEFAULT_MATERIALS;
  const item = pickWeighted(rng, table);
  const qty = Math.max(1, Math.round(rng.nextRange(MATERIAL_QTY_MIN, MATERIAL_QTY_MAX) * scale));
  const credits = Math.max(0, Math.round((CREDITS_BASE + CREDITS_HAZARD_COEFF * Math.max(0, hazard)) * scale));
  return { materials: { [item.itemId]: qty }, credits };
}

// Ground Operations (GO-4): THE task reward seed, one definition shared by the legacy resolver (a win's haul
// and relic roll, an evacuation's haul) and Ground Ops (groundTasks.ts taskFullHaul, GO-7b's relic at 100%).
// Keyed by the task's FLAT index across bodies and independent of attempts, so one task keeps one reward roll
// whichever engine resolves it. The extraction is byte-identical (groundTasks.test.ts pins legacy outputs).
// The flat-index MULTIPLIER 0x27d4eb2f is the same constant as combat/waveSeed.ts RELAUNCH_SEED_SALT, in a
// different role (here it spreads the index inside the key; there it is a top-level salt on the wave seed).
// Harmless: REWARD_SALT and the base seed differ, so the streams never meet. Never change it (every task
// reward roll would move).
export function taskRewardSeed(exp: Pick<Expedition, "seed">, flatIndex: number): number {
  return (exp.seed ^ REWARD_SALT ^ Math.imul(flatIndex + 1, 0x27d4eb2f)) >>> 0;
}

// The relic roll's sub-stream of a task's reward seed (rollRelicToken's seed): a fixed mix on the reward
// seed, so the relic chance never shares a draw with the haul. The mix is NOT a top-level salt (it never
// meets exp.seed alone), which is why salts.test.ts does not list it; it happens to equal combat/waveSeed.ts
// WAVE_LOOT_SEED_SALT, harmless because the two mix different base seeds. Never change it (it would move
// every relic roll).
const TASK_RELIC_SEED_MIX = 0x165667b1;
export function taskRelicSeed(exp: Pick<Expedition, "seed">, flatIndex: number): number {
  return (taskRewardSeed(exp, flatIndex) ^ TASK_RELIC_SEED_MIX) >>> 0;
}

// ============================================================================
// The activity resolver (the E3 swap-in for resolveActivitiesPhase)
// ============================================================================

// Resolve ONE ground-team activity into a REAL finding: run up to MAX_BATTLE_ATTEMPTS deterministic
// gambit battles; the FIRST win yields the full haul (materials + credits + a relic chance). If EVERY
// attempt loses, the task EVACUATES but still completes with a reduced "always win something" haul (no
// relic). Deterministic: every draw is keyed off (exp.seed, a fixed salt, the activity's flat index, the
// attempt index); see the module header. Returns { finding, outcome, attempts } so the tick appends the
// finding + tests can assert the outcome.
//
// ⚠️ WHY BOUNDED IN-RESOLUTION RETRIES (a documented judgment call): the design says a lost task
// "evacuates + retries next pass", but the ExpeditionActivity record must NOT gain fields (its shape is
// frozen: id/bodyId/poiId/done), and the activities phase gives each activity exactly ONE time slot (the
// phase duration is the sum of every task's activityDurationSeconds: ACTIVITY_SECONDS each without a
// Science party, shorter with one, E-CREW Task 15). A cross-pass retry with the SAME keyed seed would
// reproduce the SAME loss forever (an infinite stall). So the retry is realized DETERMINISTICALLY as
// bounded attempts WITHIN the one resolution, each reseeded by the attempt index; after the cap the task
// evacuates with a partial haul. This keeps the frozen record, the phase-duration/parity model, "always
// win something", and offline==live parity all intact.
//
// E-CREW (Task 16): members downed EARLIER in the run sit this task out (activityDownedBefore), and a member
// downed in one attempt sits out the task's later attempts too ("any battle", user rule). An attempt with
// nobody left to field does not happen: the task evacuates after the attempts already fought (0 when the
// whole squad was out before the task began, with no battle, like the D18 no-team path). Each attempt's
// battle passes its own seed as Neural Backup's reviveSeed.
export interface ActivityResolution {
  finding: ExpeditionFinding;
  outcome: "win" | "evacuated";
  attempts: number;
  // E-CREW (Task 16): the members down at the end of this task's battles, every attempt, in order of first
  // going down (resolveActivitiesPhase stores it on the activity when non-empty).
  downedMemberIds: string[];
}

export function resolveExpeditionActivity(
  exp: Expedition,
  body: ExpeditionBody,
  activity: ExpeditionActivity,
  globalIndex: number,
  logSink?: GambitLogEvent[], // OPTIONAL (E3b): when passed, filled with the DECIDING battle's transient log
  // E-CREW (Task 21): the task's hours since dispatch (the Science Constitution ramp's clock on the relic
  // roll, expedition.ts resolveActivitiesPhase). Default 0 = no ramp; the battle never reads it.
  hoursOut: number = 0,
): ActivityResolution {
  const findingId = activityFindingId(exp, activity.id);
  const relicId = `${exp.id}-relic-${activity.id}`;
  // Copy an attempt's transient events into the caller's sink (last write wins == the deciding battle).
  const commitLog = (attemptLog: GambitLogEvent[] | undefined): void => {
    if (!logSink || !attemptLog) return;
    logSink.length = 0;
    for (const e of attemptLog) logSink.push(e);
  };

  // D18: no Security member deployed (an expedition launched before D18 with no roster, or a Science-only
  // one) means NO team: there is no anonymous stand-in any more. The task resolves at once WITHOUT a battle
  // as an evacuation (0 attempts, an empty log), keeping the reduced "always win something" haul from the
  // same keyed reward roll as any evacuation. Deterministic, draws nothing from a battle stream, and safe
  // for an old in-flight save (it can never crash on an empty team or stall the activities phase).
  if ((exp.roster?.security ?? []).length === 0) {
    commitLog([]);
    return evacuatedResolution(exp, body, activity, globalIndex, 0, findingId, []);
  }

  // E-CREW (Task 16): who is already out before this task, and who goes down during it.
  const out = activityDownedBefore(exp, globalIndex);
  const downed: string[] = [];
  let attempts = 0;
  let lastAttemptLog: GambitLogEvent[] | undefined;
  for (let attempt = 0; attempt < MAX_BATTLE_ATTEMPTS; attempt++) {
    // E-CREW (Task 13): the named Security roster. Never Science. Task 16: minus everyone out.
    const team = expeditionTeamCombatants(exp, `${exp.id}-${activity.id}-a${attempt}`, out);
    if (team.length === 0) break; // nobody left to field: no battle, the task evacuates
    attempts = attempt + 1;
    const battleSeed =
      (exp.seed ^
        COMBAT_SALT ^
        Math.imul(globalIndex + 1, 0x9e3779b9) ^
        Math.imul(attempt + 1, 0x85ebca6b)) >>>
      0;
    const rng = makeRng(battleSeed);
    // E4b: the guard is scaled by the hazard the body PRESENTS to this run (the snapshotted museum
    // hazardResist shrinks it, bounded + never negative; 0 -> the raw hazard, bit-identical). The REWARD
    // rolls below keep the body's RAW hazard on purpose: resisting a world's danger makes the fight
    // easier, it does not make the find poorer.
    const enemies = generateEncounter(battleSeed, resistedHazard(body.hazard, exp.hazardResist ?? 0), activity.poiId);
    const attemptLog = logSink ? [] : undefined;
    const result = resolveGroundBattle(team, enemies, exp.teamKit, rng, attemptLog, battleSeed);
    if (attemptLog) lastAttemptLog = attemptLog;
    for (const id of result.downedMemberIds) {
      out.add(id);
      if (!downed.includes(id)) downed.push(id);
    }
    if (result.result === "win") {
      commitLog(attemptLog);
      const rewardSeed = taskRewardSeed(exp, globalIndex);
      // E-CREW Task 15: the Science party scales the haul (yieldMult; exactly 1 without a party) and lifts
      // the relic chance. Both only reshape the SAME keyed draws, so the draw order is unchanged.
      const fw = fieldworkEffect(exp, body.planetType, activity.poiId);
      const haul = rollHaul(rewardSeed, body.planetType, body.hazard, fw.yieldMult);
      const relic = rollRelicToken(
        taskRelicSeed(exp, globalIndex),
        body.hazard,
        activity.poiId,
        relicId,
        activityRelicFindBonus(exp, fw, hoursOut),
      );
      return {
        finding: {
          id: findingId,
          source: "activity",
          poiId: activity.poiId,
          materials: haul.materials,
          credits: haul.credits,
          relic,
        },
        outcome: "win",
        attempts,
        downedMemberIds: downed,
      };
    }
  }
  // Every attempt lost (or nobody was left to field): EVACUATE with a reduced haul (always win something),
  // no relic.
  commitLog(lastAttemptLog ?? []);
  return evacuatedResolution(exp, body, activity, globalIndex, attempts, findingId, downed);
}

// E-CREW Task 15: the relic roll's find bonus for one won task, the SUM of every frozen lift (each a
// fraction; rollRelicToken multiplies the chance by 1 + this, capped at certain):
//   relicFindBonus (E4b museum relicFindChance + E4d gear, snapshotted)
//   + the Science party's relicFind on this body (fieldwork.ts: Keen Eye, Archaeo-Scanner, relic lines)
//   + crewRareFind (Discovery Instinct + the Science division's rare find, snapshotted at dispatch)
// Every term is 0 for a run launched before Task 15 without a party, so the bonus is the museum's
// bit-for-bit. Pure.
// E-CREW Task 21: the crew rare find grows by the Science department's Constitution ramp at `hoursOut` hours
// since dispatch (exp.rampScience; constitutionRamp is exactly 0 without it, so the term is the frozen value).
export function activityRelicFindBonus(exp: Expedition, fw: Pick<FieldworkEffect, "relicFind">, hoursOut: number = 0): number {
  const base = exp.relicFindBonus ?? 0;
  const crew = Math.max(0, exp.crewRareFind ?? 0);
  const ramp = constitutionRamp(exp.rampScience ?? 0, hoursOut);
  const extra = fw.relicFind + (ramp === 0 ? crew : crew * (1 + ramp));
  return extra > 0 ? base + extra : base;
}

// The stable id of the finding an activity resolves into: ONE template shared by the resolver and the UI
// (ExpeditionPanel matches an activity to its finding by it). Pure.
export function activityFindingId(exp: Pick<Expedition, "id">, activityId: string): string {
  return `${exp.id}-find-act-${activityId}`;
}

// An EVACUATED task's resolution: the reduced haul from the activity's keyed reward roll (the same seed a
// win uses, scaled by EVAC_REWARD_FRACTION), no relic. Shared by the all-attempts-lost path and the D18
// no-team path. PURE.
function evacuatedResolution(
  exp: Expedition,
  body: ExpeditionBody,
  activity: ExpeditionActivity,
  globalIndex: number,
  attempts: number,
  findingId: string,
  downedMemberIds: string[],
): ActivityResolution {
  const rewardSeed = taskRewardSeed(exp, globalIndex);
  // E-CREW Task 15: what the Science party gathered before the pull-back is richer too (yieldMult is
  // exactly 1 without a party, so EVAC_REWARD_FRACTION * 1 keeps an old run's haul bit-for-bit).
  const yieldMult = fieldworkEffect(exp, body.planetType, activity.poiId).yieldMult;
  const haul = rollHaul(rewardSeed, body.planetType, body.hazard, EVAC_REWARD_FRACTION * yieldMult);
  return {
    finding: {
      id: findingId,
      source: "activity",
      poiId: activity.poiId,
      materials: haul.materials,
      credits: haul.credits,
      relic: null,
      evacuated: true,
    },
    outcome: "evacuated",
    attempts,
    downedMemberIds,
  };
}

// ============================================================================
// E3b: on-demand transient battle-log derivation (DISPLAY-ONLY, parity-safe)
// ============================================================================

// The transient readout the E3b battle log renders for ONE resolved activity: its outcome + attempt count +
// the deciding battle's round-by-round events. PURE + deterministic: it RE-RUNS resolveExpeditionActivity
// from the stored expedition seed (the exact inputs the tick used), so it reproduces the identical battle
// WITHOUT persisting anything. The engine tick never calls this, so it lives entirely outside the save /
// parity deep-equal. The UI calls it lazily (only when a player expands an activity's log), passing the
// activity's stable FLAT index across bodies (== the resolver's globalIndex).
export interface ActivityBattleLog {
  outcome: "win" | "evacuated";
  attempts: number;
  events: GambitLogEvent[];
}

export function deriveExpeditionActivityLog(
  exp: Expedition,
  body: ExpeditionBody,
  activity: ExpeditionActivity,
  globalIndex: number,
): ActivityBattleLog {
  const events: GambitLogEvent[] = [];
  const res = resolveExpeditionActivity(exp, body, activity, globalIndex, events);
  return { outcome: res.outcome, attempts: res.attempts, events };
}

// ============================================================================
// E-CREW (Task 14): RANDOM ENCOUNTERS during scan progress (design D10)
// ============================================================================
//
// While a body scans, each step boundary may fire an encounter (expedition.ts owns the step roll + the
// timeline). The encounter is ONE Security battle through the same Task 13 path as an activity
// (expeditionTeamCombatants + generateEncounter + resolveGroundBattle), keyed off (exp.seed, its own salt,
// the boundary key), never a live stream. It is not a PoI guardian fight: the body has no discoveries yet
// while it scans, so the enemy set is the default roaming guard (generateEncounter's fallback roles for an
// unknown PoI, striker + bruiser), scaled by the hazard the body presents (museum hazardResist applied, as
// for an activity). ONE attempt only: a loss is a withdrawal (expedition.ts pauses the scan), never a retry.
//
// FIRST-PASS TUNABLE: a won encounter's drops REUSE the activity reward machinery (rollHaul: the planet-
// flavored material table + hazard-scaled credits) at ENCOUNTER_DROP_SCALE, never a relic; a supply cache
// is the same haul at SUPPLY_CACHE_SCALE.
export const ENCOUNTER_DROP_SCALE = 0.5;
export const SUPPLY_CACHE_SCALE = 0.3;

// The PoI id a scan encounter passes to generateEncounter: none (the default roaming guard).
const SCAN_ENCOUNTER_POI = "";

// The stable integer key of one step boundary (the plan's bodyIndex * 100 + step). Pure.
export function scanStepKey(bodyIndex: number, step: number): number {
  return bodyIndex * 100 + step;
}

// The finding ids a scan event adds: one template shared by the resolver and the UI. Pure.
export function scanEncounterFindingId(exp: Pick<Expedition, "id">, bodyIndex: number, step: number): string {
  return `${exp.id}-find-enc-b${bodyIndex}-s${step}`;
}
export function supplyCacheFindingId(exp: Pick<Expedition, "id">, bodyIndex: number, step: number): string {
  return `${exp.id}-find-cache-b${bodyIndex}-s${step}`;
}

export interface ScanEncounterResolution {
  outcome: "win" | "loss";
  rounds: number;
  downedMemberIds: string[]; // Security members down at the battle's end (Task 16 injuries)
  finding: ExpeditionFinding | null; // the enemy drops on a win, else null
}

// Resolve the random encounter at `body`'s step boundary `step`. PURE + deterministic (keyed seed; mints
// fresh combatants). With no Security member in the roster (only an expedition launched before D18), or
// with every Security member already downed earlier in the run (Task 16), there is no team: the encounter
// is a loss with no battle (0 rounds), the same "no team, no fight" rule as an activity. expedition.ts never
// rolls an encounter for such a run or boundary (its chance is 0), so this is defensive.
export function resolveScanEncounter(
  exp: Expedition,
  body: ExpeditionBody,
  bodyIndex: number,
  step: number,
  logSink?: GambitLogEvent[], // OPTIONAL: filled with the battle's transient log (display only)
): ScanEncounterResolution {
  const key = scanStepKey(bodyIndex, step);
  // E-CREW (Task 16): members downed at an earlier boundary sit this one out.
  const team = expeditionTeamCombatants(exp, `${exp.id}-scan-b${bodyIndex}-s${step}`, scanDownedBefore(exp, bodyIndex, step));
  if (team.length === 0) return { outcome: "loss", rounds: 0, downedMemberIds: [], finding: null };
  const battleSeed = (exp.seed ^ SCAN_BATTLE_SALT ^ Math.imul(key + 1, 0x9e3779b9)) >>> 0;
  const enemies = softenAmbush(
    generateEncounter(battleSeed, resistedHazard(body.hazard, exp.hazardResist ?? 0), SCAN_ENCOUNTER_POI),
    exp.ambushSoften ?? 0,
  );
  const result = resolveGroundBattle(team, enemies, exp.teamKit, makeRng(battleSeed), logSink, battleSeed);
  if (result.result !== "win") {
    return { outcome: "loss", rounds: result.rounds, downedMemberIds: result.downedMemberIds, finding: null };
  }
  // The drops keep the body's RAW hazard (resisting a world's danger does not make the find poorer).
  const dropSeed = (exp.seed ^ SCAN_DROP_SALT ^ Math.imul(key + 1, 0x27d4eb2f)) >>> 0;
  const haul = rollHaul(dropSeed, body.planetType, body.hazard, ENCOUNTER_DROP_SCALE);
  return {
    outcome: "win",
    rounds: result.rounds,
    downedMemberIds: result.downedMemberIds,
    finding: {
      id: scanEncounterFindingId(exp, bodyIndex, step),
      source: "encounter",
      materials: haul.materials,
      credits: haul.credits,
      relic: null,
    },
  };
}

// E-CREW 0.14.0 (Task 21): the Security department's CUNNING over-delivery ("softens an enemy ambush"):
// a run whose dispatch roll succeeded (exp.ambushSoften) meets its random scan encounters with every enemy
// at (1 - soften) of its health, power and healing (health stays a whole number, at least 1). A post-
// generation scale, so generateEncounter's draws are untouched; 0 returns the SAME array. Pure.
export function softenAmbush(enemies: GroundCombatant[], soften: number): GroundCombatant[] {
  if (!(soften > 0)) return enemies;
  const k = Math.max(0, 1 - soften);
  return enemies.map((e) => {
    const hp = Math.max(1, Math.round(e.hp * k));
    const power = e.power * k;
    return { ...e, hp, hpMax: hp, power, heal: e.heal * k, threat: power };
  });
}

// The supply-cache EVENT's finding at `body`'s step boundary `step`: a small keyed material + credit haul.
// PURE.
export function rollSupplyCache(exp: Expedition, body: ExpeditionBody, bodyIndex: number, step: number): ExpeditionFinding {
  const seed = (exp.seed ^ SUPPLY_CACHE_SALT ^ Math.imul(scanStepKey(bodyIndex, step) + 1, 0x85ebca6b)) >>> 0;
  const haul = rollHaul(seed, body.planetType, body.hazard, SUPPLY_CACHE_SCALE);
  return {
    id: supplyCacheFindingId(exp, bodyIndex, step),
    source: "supplyCache",
    materials: haul.materials,
    credits: haul.credits,
    relic: null,
  };
}

// The transient battle log of one scan encounter, for the UI (Task 17). DISPLAY ONLY: re-runs the keyed
// battle from the stored expedition, persists nothing, and the tick never calls it. Null unless the run's
// scanEvents record an encounter at that boundary (so the UI can never show a battle that did not happen).
// Pure.
export function deriveScanEncounterLog(
  exp: Expedition,
  bodyIndex: number,
  step: number,
): { outcome: "win" | "loss"; events: GambitLogEvent[] } | null {
  const body = exp.bodies[bodyIndex];
  if (!body) return null;
  const recorded = (exp.scanEvents ?? []).some((ev) => ev.kind === "encounter" && ev.bodyIndex === bodyIndex && ev.step === step);
  if (!recorded) return null;
  const events: GambitLogEvent[] = [];
  const res = resolveScanEncounter(exp, body, bodyIndex, step, events);
  return { outcome: res.outcome, events };
}
