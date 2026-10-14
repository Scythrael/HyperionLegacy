// gambitEditorDisplay.ts: the display decisions behind the per-member gambit editor (0.14.0, Ground Operations
// GO-16, absorbs E-CREW Task 17's editor). The player picks a ship, one of its ground teams (Alpha / Bravo /
// Charlie, or the custom name), then a Security member of that team, and edits that member's own program.
//
// WHY a .ts beside GambitEditorPanel.svelte: this repo has no Svelte component test harness, so the picker's
// fallbacks, the program labels, the copy target and every empty-state line live here as pure functions over
// the tested engine (memberGambits.ts, groundTeams.ts). The component only draws and routes clicks.

import type { GambitProgram, GameState, GroundTeamKind } from "./game/model";
import { DEFAULT_GAMBIT_PROGRAMS, groundSquadSize, groundTeamCount } from "./game/model";
import { squadsOfType, teamKindName } from "./game/groundComposition";
import { cleanShipGroundTeams, groundTeamName } from "./game/groundTeams";
import {
  gambitProgramEquals,
  matchedMemberPreset,
  memberGambitProgram,
  memberHasOwnGambit,
  memberSecuritySquadmates,
  squadmatesCopyWouldChange,
} from "./game/memberGambits";
import { awayShipName } from "./awayTeamDisplay";

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

// The line under the editor about the old account-wide pair (Q21: kept stored and hidden, never read).
export const ACCOUNT_PAIR_NOTICE =
  "Your older account-wide gambit rules are still saved, but no battle uses them: each Security member fights with their own program.";

// Whether the account-pair notice shows: only when the stored pair differs from the fresh default (the player
// set it up in the old editor), so a player who never touched it is not told about a page they never saw.
// Pure.
export function accountPairNoticeShown(state: Pick<GameState, "gambitPrograms">): boolean {
  const pair = state.gambitPrograms;
  if (!pair) return false;
  return (
    !gambitProgramEquals(pair.security ?? [], DEFAULT_GAMBIT_PROGRAMS.security) ||
    !gambitProgramEquals(pair.science ?? [], DEFAULT_GAMBIT_PROGRAMS.science)
  );
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
      program: memberGambitProgram(m),
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
    },
  };
}
