// gambitEditorDisplay.ts: the display decisions behind the per-member gambit editor (0.14.0, Ground Operations
// GO-16, absorbs E-CREW Task 17's editor). The player picks a ship, one of its ground teams (Alpha / Bravo /
// Charlie, or the custom name), then a Security member of that team, and edits that member's own program.
//
// WHY a .ts beside GambitEditorPanel.svelte: this repo has no Svelte component test harness, so the picker's
// fallbacks, the program labels, the copy target and every empty-state line live here as pure functions over
// the tested engine (memberGambits.ts, groundTeams.ts). The component only draws and routes clicks.

import type { EnemyRank, GambitActionId, GambitProgram, GambitRule, GambitStatusId, GambitTargetSelector, GameState, GroundTeamKind } from "./game/model";
import { DEFAULT_GAMBIT_PROGRAMS, EQUIPMENT_SLOTS, groundSquadSize, groundTeamCount, memberVariety } from "./game/model";
import { FALL_BACK_SHIELD_ROUNDS, GAMBIT_STATUSES, SUPPRESS_LINGER_EXTRA_ROUNDS, isActionLegalForRole } from "./game/gambit";
import { FIELD_KITS, FIELD_KITS_CATALOG_VERSION, FIELD_KITS_RUNS_LIVE, FIELD_KIT_IDS, FIELD_KIT_STATUS_IDS, KIT_CATEGORY_RULES, severityOf, CONDITION_LINES, timedFusesLive, type FieldKitId } from "./game/fieldKits";
import { LEGACY_USE_ITEM_KIT } from "./game/fieldKitsBattle";
import { hasMedicalTraining } from "./game/awayTraits";
import { squadsOfType, teamKindName } from "./game/groundComposition";
import { cleanShipGroundTeams, groundTeamName } from "./game/groundTeams";
import {
  accountHireDefaultSet,
  gambitProgramEquals,
  matchedMemberPreset,
  memberEditableProgram,
  memberHasOwnGambit,
  memberSecuritySquadmates,
  mergeWithBuiltInDefault,
  squadmatesCopyWouldChange,
} from "./game/memberGambits";
import { awayShipName } from "./awayTeamDisplay";
import { nameList } from "./groundTeamDisplay";

export interface GambitShipOption {
  id: string;
  name: string;
}

export interface GambitTeamOption {
  index: number;
  name: string; // groundTeamName: the custom name, else Alpha / Bravo / Charlie
  kind: GroundTeamKind;
  securityMembers: number; // Security members slotted in the team
}

export interface GambitMemberOption {
  id: string;
  name: string;
  programLabel: string; // "Default", a preset title, or "Custom"
}

export interface GambitSquadOption {
  label: string; // "Security squad", or "Security squad 2" on a Strike team
  members: GambitMemberOption[];
}

export interface GambitMemberEditView {
  id: string;
  name: string;
  program: GambitProgram; // the program they fight with (their own, else the default)
  programLabel: string;
  presetId: string | null; // the preset their own program matches, else null
  hasOwn: boolean; // false = running the built-in default
  squadLabel: string;
  squadmates: string[]; // names of the other members of the squad
  copyTargets: string[]; // names of the squadmates a copy would actually change
  copyLabel: string;
  copyBlockedText: string | null; // why the copy is off, or null
  // Field Kits FKR-10: the facts the rule hints read (Medical Training gates Advanced Medical kits; a throw needs a
  // grenade installed in the Tool slot).
  medic: boolean;
  grenade: string | null; // the installed grenade's name, or null
}

export interface GambitEditorView {
  ships: GambitShipOption[];
  shipId: string | null;
  teams: GambitTeamOption[];
  teamIndex: number | null;
  squads: GambitSquadOption[]; // the picked team's Security squads (a Survey team has none)
  member: GambitMemberEditView | null;
  emptyText: string | null; // why there is no member to edit
  launchedText: string | null; // the ship is out: changes reach the next launch
}

export interface GambitEditorPick {
  shipId?: string | null;
  teamIndex?: number | null;
  memberId?: string | null;
}

// ============================================================================
// OC-F12 control (user answers 2026-11-12, docs/mockups/2026-11-11-account-default-control-mockup.html Option A): the
// "Set for new hires" row on a member's program and the "New hires" status line with Clear, which replace the old dashed
// notice about the account pair (Q21, WR-10). The engine is memberGambits.ts setAccountHireDefaultFromMember /
// clearAccountHireDefault; a hire reads the pair through awayTeam.ts accountProgramForHire, merged (mergeWithBuiltInDefault:
// the built-in support rules the program lacks, placed first, user 2026-11-10 "Built-in first").
// ============================================================================

// The short word for each support rule kind the merge brings in.
const MERGE_KIND_WORD: Readonly<Partial<Record<GambitActionId, string>>> = { cure: "cure", aidHeal: "heal", brace: "brace", throwGrenade: "grenade" };

// The support rule kinds the merge would add to `program` ("cure, heal, brace and grenade"), in the built-in order, or
// "" when it adds none. Pure.
export function mergeAddedKindsText(program: readonly GambitRule[], kitsLive: boolean = FIELD_KITS_RUNS_LIVE): string {
  const merged = mergeWithBuiltInDefault(program, kitsLive);
  const added = merged.slice(0, merged.length - program.length).map((r) => MERGE_KIND_WORD[r.action] ?? r.action);
  return nameList([...new Set(added)]);
}

// The status line: what a new Security hire starts with, as words around one bold part.
export interface HireDefaultStatus {
  set: boolean; // a default is set (the stored Security program is not the fresh one)
  before: string;
  bold: string;
  after: string;
}

// The status line for the stored pair. Set: the program's preset title (or "a custom program"), where it was set from
// when that member is still on the roster, and "the built-in support rules first" when the merge adds any. Pure.
export function hireDefaultStatus(state: Pick<GameState, "gambitPrograms" | "gambitDefaultFrom" | "awayMembers">, kitsLive: boolean = FIELD_KITS_RUNS_LIVE): HireDefaultStatus {
  if (!accountHireDefaultSet(state)) {
    return { set: false, before: "New Security hires start on the ", bold: "built-in default", after: "." };
  }
  const program = state.gambitPrograms.security;
  const preset = matchedMemberPreset({ gambit: program });
  const name = preset && preset.id !== "custom" ? preset.title : "a custom program";
  const from = state.gambitDefaultFrom ? state.awayMembers.find((m) => m.id === state.gambitDefaultFrom)?.name : undefined;
  const support = mergeAddedKindsText(program, kitsLive) !== "";
  return {
    set: true,
    before: "New Security hires start with ",
    bold: name,
    after: `${from ? ` (from ${from})` : ""}${support ? ", the built-in support rules first" : ""}.`,
  };
}

// The "Set for new hires" row for the picked member: whether the button acts, and the note beside it.
export interface HireSetRow {
  enabled: boolean;
  note: string;
  warn: boolean; // the note is a warning (an empty program)
}

export const HIRE_SET_ALREADY = "This is already the program new Security hires start with.";
export const HIRE_SET_SAVED = "Saved. Your next Security hire starts with this program.";
export const HIRE_CLEARED = "Cleared. New hires start on the built-in default again.";
export const HIRE_NO_PICK = "Pick a Security member above to set their program for new hires.";

// The row for `member` (from gambitEditorView). Mirrors setAccountHireDefaultFromMember's refusals: a member on the built-in
// default, the stored program already, and Balanced with nothing set are off; Balanced with a default set clears it (user
// 2026-11-12 "Treat as no default"). Pure.
export function hireSetRow(
  state: Pick<GameState, "gambitPrograms">,
  member: Pick<GambitMemberEditView, "name" | "hasOwn" | "program">,
  kitsLive: boolean = FIELD_KITS_RUNS_LIVE,
): HireSetRow {
  const set = accountHireDefaultSet(state);
  if (!member.hasOwn) {
    return {
      enabled: false,
      warn: false,
      note: set
        ? `${member.name} runs the built-in default. To give new hires the built-in default, use Clear.`
        : `${member.name} runs the built-in default, which new Security hires already start on.`,
    };
  }
  if (gambitProgramEquals(member.program, DEFAULT_GAMBIT_PROGRAMS.security)) {
    return set
      ? { enabled: true, warn: false, note: "Balanced means no default: this clears it, and new Security hires start on the built-in default." }
      : { enabled: false, warn: false, note: "Balanced means no default, and none is set: new Security hires start on the built-in default." };
  }
  if (set && gambitProgramEquals(member.program, state.gambitPrograms.security)) return { enabled: false, warn: false, note: HIRE_SET_ALREADY };
  const kinds = mergeAddedKindsText(member.program, kitsLive);
  if (member.program.length === 0) {
    return { enabled: true, warn: true, note: `Hires would get only the built-in ${kinds} rules, and no attack rule.` };
  }
  return {
    enabled: true,
    warn: false,
    note: `Every Security member you hire from now on starts with a copy of ${member.name}'s program${kinds ? `, plus the built-in ${kinds} rules it lacks, placed first` : ""}. Nobody already hired changes.`,
  };
}

export const LAUNCHED_TEXT =
  "This ship is on an expedition: its teams fight with the programs they launched with. Changes apply from the next launch.";
// A finished run still waiting for its claim (phase "complete"): nobody fights any more, the ship is back.
export const AWAITING_CLAIM_TEXT = "This ship is back from an expedition, awaiting its claim. Changes apply from the next launch.";

function programLabel(member: Parameters<typeof matchedMemberPreset>[0]): string {
  if (!memberHasOwnGambit(member)) return "Default";
  return matchedMemberPreset(member)?.title ?? "Custom";
}

// Everything the editor draws for a pick. Each level falls back when the pick no longer applies: the first ship
// that fields ground teams, then the first team with a Security member slotted (else the first team), then
// that team's first Security member. Pure.
export function gambitEditorView(state: GameState, pick: GambitEditorPick): GambitEditorView {
  const fielding = state.ships.filter((s) => groundTeamCount(s.typeKey) > 0);
  const ships = fielding.map((s) => ({ id: s.id, name: awayShipName(s) }));
  const ship = fielding.find((s) => s.id === pick.shipId) ?? fielding[0];
  if (!ship) {
    return { ships, shipId: null, teams: [], teamIndex: null, squads: [], member: null, emptyText: "No ship fields a ground team yet.", launchedText: null };
  }
  const byId = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const teamsRaw = cleanShipGroundTeams(ship, state.awayMembers);
  const size = groundSquadSize(ship.typeKey, "security");
  const securityIds = (i: number) => teamsRaw[i].security.filter((id): id is string => id !== null);
  const teams: GambitTeamOption[] = teamsRaw.map((t, index) => ({
    index,
    name: groundTeamName(ship, index),
    kind: t.kind,
    securityMembers: securityIds(index).length,
  }));
  // A ship pick that fell back (sold, gone) drops the old ship's team and member picks too. NO ship pick yet
  // (the panel's first state, before the Ship dropdown is used) keeps them: they belong to the default ship.
  const sameShip = pick.shipId == null || pick.shipId === ship.id;
  const picked = sameShip && typeof pick.teamIndex === "number" ? teams[pick.teamIndex] : undefined;
  const team = picked ?? teams.find((t) => t.securityMembers > 0) ?? teams[0];
  const run = state.expeditions.find((e) => e.shipId === ship.id);
  const launchedText = !run ? null : run.phase === "complete" ? AWAITING_CLAIM_TEXT : LAUNCHED_TEXT;

  const squadCount = squadsOfType(team.kind, "security");
  const squads: GambitSquadOption[] = [];
  for (let k = 0; k < squadCount; k += 1) {
    const ids = teamsRaw[team.index].security.slice(k * size, (k + 1) * size).filter((id): id is string => id !== null);
    squads.push({
      label: squadCount > 1 ? `Security squad ${k + 1}` : "Security squad",
      members: ids.flatMap((id) => {
        const m = byId.get(id);
        return m ? [{ id, name: m.name, programLabel: programLabel(m) }] : [];
      }),
    });
  }

  const base = { ships, shipId: ship.id, teams, teamIndex: team.index, squads, launchedText };
  if (squadCount === 0) {
    return { ...base, member: null, emptyText: `${team.name} is a ${teamKindName(team.kind)} team: it fields no Security squad, so nobody on it fights.` };
  }
  const all = squads.flatMap((q, k) => q.members.map((m) => ({ ...m, k })));
  const chosen = (sameShip ? all.find((m) => m.id === pick.memberId) : undefined) ?? all[0];
  if (!chosen) {
    return { ...base, member: null, emptyText: `No Security member is slotted in ${team.name}. Slot one on the ship's Away Team tab.` };
  }
  const m = byId.get(chosen.id);
  if (!m) return { ...base, member: null, emptyText: null };
  const squadLabel = squads[chosen.k].label;
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const squadmates = memberSecuritySquadmates(state, ship.id, m.id).map(nameOf);
  const copyTargets = squadmatesCopyWouldChange(state, ship.id, m.id).map(nameOf);
  return {
    ...base,
    emptyText: null,
    member: {
      id: m.id,
      name: m.name,
      program: memberEditableProgram(m),
      programLabel: programLabel(m),
      presetId: matchedMemberPreset(m)?.id ?? null,
      hasOwn: memberHasOwnGambit(m),
      squadLabel,
      squadmates,
      copyTargets,
      copyLabel: squadmates.length === 0 || squadCount === 1 ? "Copy to squad" : `Copy to ${squadLabel}`,
      copyBlockedText:
        squadmates.length === 0
          ? "Nobody else is slotted in this squad."
          : copyTargets.length === 0
            ? "Everyone in this squad already runs it."
            : null,
      medic: hasMedicalTraining(m),
      grenade: installedGrenadeName(state, m.id),
    },
  };
}

// ============================================================================
// Field Kits FKR-10: the editor's vocabulary and rule hints (moved here from GambitEditorPanel.svelte so they are
// tested: SELECTOR_LABEL / ACTION_LABEL exhaustive by type, the offered lists checked against them).
// ============================================================================

// The installed grenade's name on `memberId` (the member's Tool slot), or null. Pure.
export function installedGrenadeName(state: Pick<GameState, "equipment">, memberId: string): string | null {
  const piece = state.equipment.find((e) => e.fittedToMemberId === memberId && e.slotType === "memberTool");
  const variety = piece ? memberVariety(piece.slotType, piece.moduleVariant ?? "") : undefined;
  return variety?.member.grenade ? variety.label : null;
}

// Timed grenades (user 2026-10-21): the fuse hint for the grenade named `grenadeName` (installedGrenadeName's label), on
// a run dispatched today: "Stun Grenade: a timed fuse, ..." or "Impact Grenade: detonates on contact, ...". Null for a
// name that is no grenade. Pure.
export function installedGrenadeFuse(grenadeName: string): string | null {
  const v = EQUIPMENT_SLOTS.memberTool.varieties.find((x) => x.label === grenadeName && x.member?.grenade);
  const grenade = v?.member?.grenade;
  if (!grenade) return null;
  const timed = grenade.fuse !== undefined && timedFusesLive({ fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION } });
  return timed
    ? `${grenadeName}: a timed fuse. It detonates at the start of this member's next turn, on the foes of that group still there (some may move clear first).`
    : `${grenadeName}: detonates on contact, the turn it is thrown.`;
}

// The target dropdown, grouped. "Ally: downed" joins the Ally group with the Field Kits pass (it fires only as a Use
// Item, the Injury Kit's target); while kits are off it stays out (editorSelectorGroups).
const SELECTOR_GROUPS: readonly { label: string; ids: readonly GambitTargetSelector[] }[] = [
  {
    label: "Foe",
    ids: ["foeNearest", "foeFarthest", "foeHighestHp", "foeLowestHp", "foeHighestThreat", "foeIsHealer", "foeIsCaster", "foeHasStatus", "foeLargestGroup"],
  },
  { label: "Ally / Self", ids: ["allyLowestHp", "allyHpBelow", "allyHasStatus", "allyDowned", "self", "selfHpBelow", "selfHasStatus"] },
  { label: "Conditions", ids: ["openingRound", "outnumbered"] },
];
export function editorSelectorGroups(kitsLive: boolean = FIELD_KITS_RUNS_LIVE): { label: string; ids: GambitTargetSelector[] }[] {
  return SELECTOR_GROUPS.map((g) => ({ label: g.label, ids: g.ids.filter((id) => kitsLive || id !== "allyDowned") }));
}

export const SELECTOR_LABEL: Readonly<Record<GambitTargetSelector, string>> = {
  foeNearest: "Foe: nearest",
  foeFarthest: "Foe: farthest",
  foeHighestHp: "Foe: highest HP",
  foeLowestHp: "Foe: lowest HP",
  foeHighestThreat: "Foe: highest threat",
  foeIsHealer: "Foe: is healer",
  foeIsCaster: "Foe: is caster",
  foeHasStatus: "Foe: has status",
  foeLargestGroup: "Foe: largest group",
  allyLowestHp: "Ally: lowest HP",
  allyHpBelow: "Ally: HP below",
  allyHasStatus: "Ally: has status",
  allyDowned: "Ally: downed",
  self: "Self",
  selfHpBelow: "Self: HP below",
  selfHasStatus: "Self: has status",
  openingRound: "Opening round",
  outnumbered: "Outnumbered",
};

export const ACTION_LABEL: Readonly<Record<GambitActionId, string>> = {
  attack: "Attack",
  suppress: "Suppress",
  taunt: "Taunt",
  execute: "Execute",
  brace: "Brace",
  cure: "Cure",
  aidHeal: "Aid Heal",
  shieldAlly: "Shield Ally",
  analyze: "Analyze",
  secureObjective: "Secure Objective",
  takeCover: "Take Cover",
  useItem: "Use Item",
  throwGrenade: "Throw Grenade",
  fallBack: "Fall Back",
  hold: "Hold",
  // Field Kits FKR-4: an enemy-only action (never legal for Security, so never offered).
  flashGrenade: "Flash Grenade",
};

// The action dropdown in a stable order, FILTERED to Security's legal set, so a rule can never pick an action a
// Security member cannot perform. Throw Grenade sits after Use Item, offered once kits are live in runs.
const ACTION_ORDER: readonly GambitActionId[] = [
  "attack",
  "suppress",
  "taunt",
  "execute",
  "brace",
  "cure",
  "aidHeal",
  "shieldAlly",
  "analyze",
  "secureObjective",
  "takeCover",
  "useItem",
  "throwGrenade",
  "fallBack",
  "hold",
];
export function editorActions(kitsLive: boolean = FIELD_KITS_RUNS_LIVE): GambitActionId[] {
  return ACTION_ORDER.filter((a) => isActionLegalForRole("security", a) && (kitsLive || a !== "throwGrenade"));
}

// Every status the status picker offers, the Field Kits conditions included once kits are live in runs. Pure.
export function editorStatuses(kitsLive: boolean = FIELD_KITS_RUNS_LIVE): GambitStatusId[] {
  return (Object.keys(GAMBIT_STATUSES) as GambitStatusId[]).filter((id) => kitsLive || !(FIELD_KIT_STATUS_IDS as readonly string[]).includes(id));
}

// A status's picker label: a severity rank reads its place on its line ("Broken Bone (severity 2 of 3)"). Pure.
export function statusOptionLabel(id: GambitStatusId): string {
  const label = GAMBIT_STATUSES[id]?.label ?? id;
  const sev = severityOf(id);
  return sev ? `${label} (severity ${sev.rank} of ${CONDITION_LINES[sev.line].length})` : label;
}

// The Use Item kit picker: every kit; a rule with no kit spends a First Aid Kit (call 15, "Means First Aid Kit").
export const KIT_OPTIONS: readonly { id: FieldKitId; label: string }[] = FIELD_KIT_IDS.map((id) => ({ id, label: FIELD_KITS[id].label }));
export const DEFAULT_RULE_KIT: FieldKitId = LEGACY_USE_ITEM_KIT;

// The rank condition picker (group 7 "Rank rules + reserve"): "" = any target.
export const RANK_OPTIONS: readonly { value: "" | EnemyRank; label: string }[] = [
  { value: "", label: "Any rank" },
  { value: "elite", label: "Target is Elite or stronger" },
  { value: "boss", label: "Target is a Boss" },
];
// The "Keep N for a Boss" stepper's ceiling (a UI bound; the engine reads any whole count).
export const RESERVE_MAX = 9;

const HAS_STATUS_SELECTORS: readonly GambitTargetSelector[] = ["foeHasStatus", "allyHasStatus", "selfHasStatus"];
const HP_THRESHOLD_SELECTORS: readonly GambitTargetSelector[] = ["allyHpBelow", "selfHpBelow"];

export function ruleNeedsThreshold(rule: Pick<GambitRule, "target">): boolean {
  return HP_THRESHOLD_SELECTORS.includes(rule.target);
}
export function ruleNeedsStatus(rule: Pick<GambitRule, "target" | "action">): boolean {
  return HAS_STATUS_SELECTORS.includes(rule.target) || rule.action === "cure" || rule.action === "useItem";
}
// Whether the status picker may offer "Any debuff": every case except foeHasStatus (it must name a status).
export function ruleStatusAllowsAny(rule: Pick<GambitRule, "target">): boolean {
  return rule.target !== "foeHasStatus";
}
// The kit picker shows on a Use Item rule once kits are live in runs.
export function ruleNeedsKit(rule: Pick<GambitRule, "action">, kitsLive: boolean = FIELD_KITS_RUNS_LIVE): boolean {
  return kitsLive && rule.action === "useItem";
}
// The rank condition shows on a rule that targets a foe (an ally or a condition reads Normal, so it would never fire).
export function ruleTakesRank(rule: Pick<GambitRule, "target">, kitsLive: boolean = FIELD_KITS_RUNS_LIVE): boolean {
  return kitsLive && rule.target.startsWith("foe");
}
// The Boss reserve shows on a rule that spends something: a throw (charges) or a Use Item (that kit).
export function ruleTakesReserve(rule: Pick<GambitRule, "action">, kitsLive: boolean = FIELD_KITS_RUNS_LIVE): boolean {
  return kitsLive && (rule.action === "throwGrenade" || rule.action === "useItem");
}

// A rule with only the params it needs, so a stored rule stays minimal (and matches the preset shapes): the HP
// threshold on an HP selector, the status where one is read (foeHasStatus defaults to the first status), and (Field
// Kits) the kit on a Use Item, the rank condition on a foe target, the reserve (1 or more) on a spending rule. Pure.
export function normalizeEditorRule(rule: GambitRule, kitsLive: boolean = FIELD_KITS_RUNS_LIVE): GambitRule {
  const params: NonNullable<GambitRule["params"]> = {};
  if (ruleNeedsThreshold(rule)) params.hpThreshold = rule.params?.hpThreshold ?? 0.5;
  if (ruleNeedsStatus(rule)) {
    if (rule.params?.statusId) params.statusId = rule.params.statusId;
    else if (rule.target === "foeHasStatus") params.statusId = editorStatuses(kitsLive)[0];
  }
  if (ruleNeedsKit(rule, kitsLive) && rule.params?.kitId) params.kitId = rule.params.kitId;
  if (ruleTakesRank(rule, kitsLive) && rule.params?.minRank) params.minRank = rule.params.minRank;
  const keep = rule.params?.reserveForBoss;
  if (ruleTakesReserve(rule, kitsLive) && typeof keep === "number" && Number.isFinite(keep) && keep >= 1) params.reserveForBoss = Math.min(RESERVE_MAX, Math.floor(keep));
  return Object.keys(params).length > 0 ? { target: rule.target, action: rule.action, params } : { target: rule.target, action: rule.action };
}

// The quiet hints under a rule (FKR-10): what keeps it from firing for THIS member. Pure.
export function ruleHints(rule: GambitRule, member: Pick<GambitMemberEditView, "medic" | "grenade">, kitsLive: boolean = FIELD_KITS_RUNS_LIVE): string[] {
  // Wiring WR-10 (OC-F6 "Brace for the round") and its fix round (OC-F4 "Chance to last longer"): what Fall Back and
  // Suppress do in a fight, kits or not (every run dispatched since WR-10).
  const rules: string[] = [];
  if (rule.action === "fallBack") rules.push(FALL_BACK_HINT);
  if (rule.action === "suppress") rules.push(SUPPRESS_HINT);
  if (!kitsLive) return rules;
  const out: string[] = rules;
  if (rule.action === "useItem") {
    const kit = rule.params?.kitId ?? DEFAULT_RULE_KIT;
    if (KIT_CATEGORY_RULES[FIELD_KITS[kit].category].requiresMedicalTraining && !member.medic) out.push("Fires only for a member with Medical Training.");
    out.push("Skips when no kit of that kind is left.");
  }
  if (rule.action === "throwGrenade") {
    out.push(member.grenade ? "Skips when no charge is left, or after this battle's throw." : "No grenade installed in the Tool slot: this rule never fires.");
    // Timed grenades (user 2026-10-21): the installed grenade's fuse on a run dispatched today (catalog 2).
    const fuse = member.grenade ? installedGrenadeFuse(member.grenade) : null;
    if (fuse) out.push(fuse);
  }
  if (rule.target === "allyDowned" && rule.action !== "useItem") out.push("Ally: downed fires only for Use Item (the Injury Kit's target).");
  return out;
}

// Wiring WR-10 (OC-F6): Fall Back's effect, read from its constants (gambit.ts FALL_BACK_SHIELD_ROUNDS, GAMBIT_STATUSES).
export const FALL_BACK_HINT = `Falls back behind cover: ${GAMBIT_STATUSES.shielded.label} (${Math.round(GAMBIT_STATUSES.shielded.magnitude * 100)}% less damage taken) for ${FALL_BACK_SHIELD_ROUNDS === 1 ? "that round" : `${FALL_BACK_SHIELD_ROUNDS} rounds`}, and no attack.`;
// Wiring WR-10 fix round (OC-F4): Suppress's status always lands (a resist aside); the member's status chance may stretch it.
export const SUPPRESS_HINT = `A light hit that always leaves the target ${GAMBIT_STATUSES.suppressed.label} (it may resist). The member's status chance is the chance it lasts ${SUPPRESS_LINGER_EXTRA_ROUNDS === 1 ? "one round" : `${SUPPRESS_LINGER_EXTRA_ROUNDS} rounds`} longer.`;

// What the built-in default does, for the "Use default" line. Once kits are live in runs a member on the default
// throws grenades too (FIELD_KITS_DEFAULT_MEMBER_GAMBIT, user N15 and "Save for Elite or Boss"). Pure.
export function defaultProgramText(kitsLive: boolean = FIELD_KITS_RUNS_LIVE): string {
  return kitsLive
    ? "full targeting, attack and defense, grenades at the largest group (one charge kept for an Elite or a Boss), no automatic kit use"
    : "full targeting, attack and defense, no automatic kit use";
}
