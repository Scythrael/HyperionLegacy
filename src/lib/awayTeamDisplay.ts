// awayTeamDisplay.ts: player-facing labels shared by the Away Team tab (AwayTeamPanel.svelte) and the
// Recruitment Board (RecruitmentBoard.svelte), E-CREW "Crew Made Real" Task 6.
//
// Pure presentation data + tiny pure helpers, kept out of the two components so both read ONE set of
// labels (and so the logic is node-testable: this repo has no Svelte component test harness). Nothing
// here is game logic; the engine lives in game/awayTeam.ts and game/awayTraits.ts.

import type { AwayMemberSpec, AwayTeamType, CrewRace, CrewRank, ShipInstance } from "./game/model";
import { SHIP_TYPES } from "./game/model";
import { CREW_RACES } from "./game/crewRaces";
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
