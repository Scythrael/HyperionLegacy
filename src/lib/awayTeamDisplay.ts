// awayTeamDisplay.ts: player-facing labels shared by the Away Team tab (AwayTeamPanel.svelte) and the
// Recruitment Board (RecruitmentBoard.svelte), E-CREW "Crew Made Real" Task 6.
//
// Pure presentation data + tiny pure helpers, kept out of the two components so both read ONE set of
// labels (and so the logic is node-testable: this repo has no Svelte component test harness). Nothing
// here is game logic; the engine lives in game/awayTeam.ts and game/awayTraits.ts.

import type { AwayMemberSpec, AwayTeamType, CrewRace, CrewRank, ShipInstance } from "./game/model";
import { SHIP_TYPES } from "./game/model";
import { CREW_RACES, CREW_RACE_IDS } from "./game/crewRaces";
import { AUGMENT_AFFINITY_RACES, implantSlotsFor } from "./game/awayTeam";
import type { IconName } from "./ui/icons";

export interface SquadMeta {
  name: string; // the squad's header name ("Security Detail")
  short: string; // the one-word type ("Security"), used in "Aurora · Security"
  role: string; // the one-line role under the header (lower case, it follows "N of M · ")
  icon: IconName;
}

// EXHAUSTIVE over AwayTeamType, so a new squad type is a compile error until it has labels. Prospecting
// is wired only (no hull fields it), so its row never renders today; it exists to satisfy the Record.
export const SQUAD_META: Record<AwayTeamType, SquadMeta> = {
  security: { name: "Security Detail", short: "Security", role: "fights the random battles", icon: "security" },
  science: { name: "Science Party", short: "Science", role: "fieldwork while scanning", icon: "research" },
  prospecting: { name: "Prospecting Crew", short: "Prospecting", role: "surveys for ore", icon: "ore" },
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
//   - Science specs: no engine reader yet (fieldwork reads no spec), so the line says so plainly instead
//     of promising a bonus. Update these lines when fieldwork starts reading the spec.
const SPEC_DESCRIPTION: Record<AwayMemberSpec, string> = {
  offense: "Security specialty: hits harder in battle, with extra base power.",
  defense: "Security specialty: lasts longer in battle, with extra base health and armor.",
  debuff:
    "Security specialty: lands afflictions. Gives a base chance for the statuses this member's gear inflicts to take hold on a hit.",
  archaeology:
    "Science specialty: ancient ruins and lost civilizations. Specialties do not change fieldwork results yet.",
  xenobiology: "Science specialty: alien life and plant blooms. Specialties do not change fieldwork results yet.",
  geology: "Science specialty: rock, minerals and deep caves. Specialties do not change fieldwork results yet.",
  cryptography:
    "Science specialty: old codes, locks and sealed vaults. Specialties do not change fieldwork results yet.",
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
// armor (rankMagnitudeFactor in buildRosterCombatants). Science reads rank only for the trait count.
export const RANK_TEXT =
  "Rolled at hiring and never changes. A higher rank carries more traits, and a Security member also gets a little more base health, power and armor from it.";

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
// Minutes round UP so "refreshes in 1m" never shows while a full minute is still left to wait.
export function awayCountdownText(seconds: number): string {
  if (!(seconds > 0)) return "0s";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const totalMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
