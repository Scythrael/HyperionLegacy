// awayTeamDisplay.ts: player-facing labels shared by the Away Team tab (AwayTeamPanel.svelte) and the
// Recruitment Board (RecruitmentBoard.svelte), E-CREW "Crew Made Real" Task 6.
//
// Pure presentation data + tiny pure helpers, kept out of the two components so both read ONE set of
// labels (and so the logic is node-testable: this repo has no Svelte component test harness). Nothing
// here is game logic; the engine lives in game/awayTeam.ts and game/awayTraits.ts.

import type { AwayMember, AwayMemberSpec, AwayTeamType, CrewRace, CrewRank, GameState, ScienceSpec, ShipInstance } from "./game/model";
import { SHIP_TYPES } from "./game/model";
import { formatCountdown } from "./game/format";
import { CREW_RACES, CREW_RACE_IDS } from "./game/crewRaces";
import { AUGMENT_AFFINITY_RACES, awayCrewBlockText, canFireAwayMember, canReassignAwayMember, implantSlotsFor } from "./game/awayTeam";
import { crewLockTextAmong } from "./game/crewLock";
import type { AwayCrewGate } from "./game/awayTeam";
import { SCIENCE_SPEC_POIS } from "./game/fieldwork";
import { getPoiById } from "./game/expeditionContent";
import type { IconName } from "./ui/icons";

export interface SquadMeta {
  name: string; // the squad's header name ("Security Detail")
  short: string; // the one-word type ("Security"), used in "Aurora · Security"
  role: string; // the one-line role under the header (lower case, it follows "N aboard for M slots · ")
  icon: IconName;
}

// EXHAUSTIVE over AwayTeamType, so a new squad type is a compile error until it has labels. Prospecting is
// built but HIDDEN (prospecting.ts): only the hidden Claim and Dig kinds field it, so its row never renders
// while locked. "Prospecting Crew" is the name the user kept (design 2026-10-16, call 11).
export const SQUAD_META: Record<AwayTeamType, SquadMeta> = {
  security: { name: "Security Detail", short: "Security", role: "fights during objectives", icon: "security" },
  science: { name: "Science Party", short: "Science", role: "does the objective fieldwork", icon: "research" },
  prospecting: { name: "Prospecting Crew", short: "Prospecting", role: "extracts ore", icon: "ore" },
};

// Spec display labels (US English). EXHAUSTIVE over AwayMemberSpec.
const SPEC_LABEL: Record<AwayMemberSpec, string> = {
  offense: "Offense",
  defense: "Defense",
  debuff: "Debuff",
  archaeology: "Archaeology",
  xenobiology: "Xenobiology",
  geology: "Geology",
  cryptography: "Cryptography",
  excavation: "Excavation",
  drilling: "Drilling",
  assaying: "Assaying",
};

export function awaySpecLabel(spec: AwayMemberSpec): string {
  return SPEC_LABEL[spec];
}

// ===== Chip explanations (the hover / tap / focus tooltips on the member and candidate cards) =====
//
// Each line says only what the engine actually does, and carries NO numbers of its own (a hand-typed
// figure would go stale on the next tuning pass). EXHAUSTIVE over AwayMemberSpec, so a new spec is a
// compile error until it is described. Sources:
//   - Security specs: gambit.ts SECURITY_SPEC_BASE, added to the Security base line in
//     buildRosterCombatants (Offense: power; Defense: HP + armor; Debuff: a base statusChance, the chance
//     an `inflict` piece's statuses land on a hit, which is zero for the other specs without a bump).
//   - Science specs (E-CREW Task 15): fieldwork.ts SCIENCE_SPEC_POIS. A member whose spec favors a task's
//     PoI raises that task's haul. The PoI names are READ from the mapping + the content catalog's labels,
//     so remapping a PoI can never leave a stale name here.
function scienceSpecLine(spec: ScienceSpec, subject: string): string {
  const names = SCIENCE_SPEC_POIS[spec].map((id) => getPoiById(id)?.label ?? id);
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Science specialty: ${subject}. Brings back a bigger haul from these finds: ${list}.`;
}

const SPEC_DESCRIPTION: Record<AwayMemberSpec, string> = {
  offense: "Security specialty: hits harder in battle, with extra base power.",
  defense: "Security specialty: lasts longer in battle, with extra base health and armor.",
  debuff:
    "Security specialty: lands afflictions. Gives a base chance for the statuses this member's gear inflicts to take hold on a hit.",
  archaeology: scienceSpecLine("archaeology", "ancient ruins, old wrecks and lost civilizations"),
  xenobiology: scienceSpecLine("xenobiology", "alien life and plant blooms"),
  geology: scienceSpecLine("geology", "rock, minerals and deep caves"),
  cryptography: scienceSpecLine("cryptography", "old codes, locks and sealed vaults"),
  // Prospecting roles (hidden; prospecting.ts PROSPECTING_SPEC_BASE): each lifts one or two base stats.
  excavation: "Prospecting role: a bigger haul, with extra base yield from every deposit.",
  drilling: "Prospecting role: faster, safer work, with extra base fieldwork pace and hazard resistance.",
  assaying: "Prospecting role: a better grade, with extra base grade, so more ore lands in the better tiers.",
};

export function awaySpecDescription(spec: AwayMemberSpec): string {
  return SPEC_DESCRIPTION[spec];
}

// The "Augment affinity" chip. The slot counts are READ from implantSlotsFor (one affinity race vs one
// without), so retuning the slot rule can never leave a stale number here.
function affinitySlotCounts(): { withAffinity: number; without: number } {
  const races: readonly CrewRace[] = CREW_RACE_IDS;
  const aff = races.find((r) => AUGMENT_AFFINITY_RACES.has(r));
  const plain = races.find((r) => !AUGMENT_AFFINITY_RACES.has(r));
  return {
    withAffinity: aff !== undefined ? implantSlotsFor({ race: aff }) : 0,
    without: plain !== undefined ? implantSlotsFor({ race: plain }) : 0,
  };
}
const SLOTS = affinitySlotCounts();
export const AUGMENT_AFFINITY_TEXT = `This race integrates cybernetics well: ${SLOTS.withAffinity} implant slots instead of ${SLOTS.without}.`;

// The "Unique" tag on a unique-equipped piece (the install gate's uniqueEquippedElsewhere rule: one WORN
// copy in the whole fleet; spare copies may sit in storage).
export const UNIQUE_TAG_TEXT = "Only one can be installed in the whole fleet. Spare copies can wait in storage.";

// A recruit's rank label. Rank is rolled with the candidate (awayRecruitCandidates) and never changes; it
// sets the trait count (traitCountForRank), and the Security battle multiplies it into base HP, power and
// armor (rankMagnitudeFactor in buildRosterCombatants). Wiring WR-10 (OC-F7): a Science member's own fieldwork is x the same
// factor (fieldwork.ts memberFieldworkFactor, on every run dispatched since WR-10).
export const RANK_TEXT =
  "Rolled at hiring and never changes. A higher rank carries more traits. A Security member also gets a little more base health, power and armor from it, and a Science member's own fieldwork (from gear and traits) counts a little more.";

// The visual emphasis band for a rank on the recruit board: a Lieutenant or Lieutenant Commander is the
// rare find (hi), the upper enlisted through Ensign are mid, the first three ranks are lo.
export type RankTier = "lo" | "mid" | "hi";
export function rankTier(rank: CrewRank): RankTier {
  if (rank >= 7) return "hi";
  if (rank >= 4) return "mid";
  return "lo";
}

// A ship's player-facing name: its custom name, else the hull label, else the raw id (the roster rule).
export function awayShipName(ship: Pick<ShipInstance, "id" | "name" | "typeKey">): string {
  return ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.id;
}

// A race's display label (the CREW_RACES catalog), the raw id only for a race the catalog lost.
export function awayRaceLabel(race: CrewRace): string {
  return CREW_RACES[race]?.label ?? race;
}

// A ship + squad target as one line, "Aurora · Science": the hire and move pickers' option label.
export function awayTargetLabel(ship: Pick<ShipInstance, "id" | "name" | "typeKey">, teamType: AwayTeamType): string {
  return `${awayShipName(ship)} · ${SQUAD_META[teamType].short}`;
}

// The picked Move target among a member's targets, or null when nothing is picked or the pick is no
// longer a target the move would go through to (a blocked or vanished ship). The pick is a PARAMETER,
// never read from component state, so a legacy-mode template that calls this re-renders as soon as
// the pick changes (a variable read inside a function is invisible to the template's tracking). Pure.
export function pickedMoveTarget<T extends { shipId: string; gate: { ok: boolean } }>(
  targets: readonly T[],
  pick: string | undefined,
): T | null {
  if (pick === undefined || pick === "") return null;
  const t = targets.find((x) => x.shipId === pick);
  return t && t.gate.ok ? t : null;
}

// A short countdown for a span in seconds: "1h 12m", "41m", "35s". A non-positive span reads "0s".
// Minutes round UP so "refreshes in 1m" never shows while a full minute is still left to wait. The ONE
// implementation lives in game/format.ts formatCountdown (Ground Ops GO-2 moved it there so the engine's
// UI-free wait text, groundTeams.ts groundTeamWaitText, reads the same countdown); this name stays for the
// Away Team tab and the Recruitment Board.
export function awayCountdownText(seconds: number): string {
  return formatCountdown(seconds);
}

// ============================================================================
// CP-6: the Unassigned list ([PROPOSAL] name, OC-12). Away members with no ship (assignedShipId null), for
// example everyone a hull salvage released. NOT the reserve (members aboard but in no slot): these are aboard
// nothing. The Away Team tab lists them on every ship, so each can be moved aboard the ship being viewed or
// fired, through the same engine gates the crew cards use.
// ============================================================================
export const UNASSIGNED_INTRO =
  "Not aboard any ship, so they never deploy. They keep their gear. Move one aboard this ship, or fire them.";

export interface UnassignedMemberView {
  member: AwayMember;
  join: AwayCrewGate; // canReassignAwayMember onto the viewed ship (its squad cap and lock)
  joinText: string | undefined; // why join is refused (the accurate lock, crewLockText), undefined when ok
  fire: AwayCrewGate; // canFireAwayMember (an unassigned member is never locked)
  gearText: string | null; // CP-10: what they still wear (unassignedGearText), null for nothing
}

// CP-6: the accurate words for a crew-locked ship (mission vs expedition) live with the one lock in
// game/crewLock.ts; re-exported here for the Away Team surfaces.
export { crewLockText } from "./game/crewLock";

// The player text for an away-crew refusal: an "onMission" lock names the real cause for the FIRST locked
// ship among `shipIds` (the ships the action involves), every other reason reads awayCrewBlockText.
// undefined when the gate is open. Pure.
export function awayGateText(state: GameState, gate: AwayCrewGate, shipIds: readonly (string | null | undefined)[]): string | undefined {
  if (gate.ok) return undefined;
  if (gate.reason === "onMission") return crewLockTextAmong(state, shipIds) ?? awayCrewBlockText(gate.reason);
  return awayCrewBlockText(gate.reason);
}

// CP-6 follow-up: a member card's "Move to..." control. When the member's OWN ship is crew-locked, nobody
// can leave it, so the whole control is disabled and the reason is shown ONCE (lockText), rather than on
// every option, where it read as if each TARGET ship were out. Otherwise each blocked option names only
// that target's own refusal ([t.shipId]). Pure.
export interface AwayMoveOption {
  shipId: string;
  text: string; // the option label, plus "(reason)" when blocked
  enabled: boolean;
}
export interface AwayMoveControl {
  lockText: string | null; // the member's own ship is locked: disable the select and Move, show this once
  options: AwayMoveOption[];
}

export function awayMoveControl(
  state: GameState,
  fromShipId: string,
  targets: readonly { shipId: string; label: string; gate: AwayCrewGate }[],
): AwayMoveControl {
  const lockText = crewLockTextAmong(state, [fromShipId]);
  return {
    lockText,
    options: targets.map((t) => {
      const why = lockText !== null ? undefined : awayGateText(state, t.gate, [t.shipId]);
      return { shipId: t.shipId, text: why === undefined ? t.label : `${t.label} (${why})`, enabled: lockText === null && t.gate.ok };
    }),
  };
}

// Every unassigned member in roster order, with the gates for moving aboard `shipId` and for firing. Pure.
export function unassignedMembersView(state: GameState, shipId: string): UnassignedMemberView[] {
  return state.awayMembers
    .filter((m) => m.assignedShipId === null)
    .map((member) => {
      const join = canReassignAwayMember(state, member.id, shipId);
      const joinText = awayGateText(state, join, [shipId]);
      return { member, join, joinText, fire: canFireAwayMember(state, member.id), gearText: unassignedGearText(state, member.id) };
    });
}

// CP-10 (signed mockup section 5, option A): the gear an unassigned member still wears, in one line ("Armor, Weapon,
// Tool installed · 1 implant"; "Tool installed"; "1 implant"), or null when they wear nothing. They keep their gear.
export function unassignedGearText(state: GameState, memberId: string): string | null {
  const worn = state.equipment.filter((e) => e.fittedToMemberId === memberId);
  const named: string[] = [];
  if (worn.some((e) => e.slotType === "memberArmor")) named.push("Armor");
  if (worn.some((e) => e.slotType === "memberWeapon")) named.push("Weapon");
  if (worn.some((e) => e.slotType === "memberTool")) named.push("Tool");
  const implants = worn.filter((e) => e.slotType === "implant").length;
  const parts: string[] = [];
  if (named.length > 0) parts.push(`${named.join(", ")} installed`);
  if (implants > 0) parts.push(implants === 1 ? "1 implant" : `${implants} implants`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
