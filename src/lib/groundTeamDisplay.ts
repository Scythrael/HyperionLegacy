// groundTeamDisplay.ts: the display decisions behind the Away Team tab's ground team cards and composition
// picker (0.14.0, Ground Operations GO-11 + Squads SQ-7 section 7.1).
//
// WHY a .ts beside AwayTeamPanel.svelte: this repo has no Svelte component test harness, so everything worth
// gating (which kind options are refused and why, who a type change moves, the over-capacity wording, the
// reserve list, the slot picker's candidates) lives here as pure functions over the tested engine
// (groundTeams.ts, groundComposition.ts, awayTeam.ts). The component only draws and routes clicks. No
// game rule lives here: every gate and every outcome is read from the engine.

import type { AwayMember, GameState, GroundTeamKind, ShipInstance } from "./game/model";
import {
  GROUND_TEAM_KINDS,
  compositionLabel,
  compositionSquads,
  isValidComposition,
  squadsOfType,
  teamKindLabel,
  teamKindName,
} from "./game/groundComposition";
import {
  GROUND_SQUAD_TYPES,
  deployableGroundTeams,
  groundSlotBlockText,
  groundSquadSize,
  groundTeamDefaultName,
  groundTeamName,
  groundTeamWaitText,
  previewGroundTeamKind,
  setGroundTeamKind,
  shipGroundTeams,
  type GroundSquadType,
} from "./game/groundTeams";
import { byIdNumber, isMemberReady, shipCrewLocked, shipCrewRoom, type ShipCrewRoom } from "./game/awayTeam";
import { crewLockReason, crewLockText, crewLockUntilText } from "./game/crewLock";

// The squad type's display word. Exhaustive over the two ground squad types.
export const SQUAD_TYPE_NAME: Record<GroundSquadType, string> = { security: "Security", science: "Science" };

// "A", "A and B", "A, B and C". Pure.
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The header line of the Ground teams section: what each squad type does on the ground (replaces the Task 6
// "Security fights the random battles, Science does fieldwork while scanning" line; ground fights moved off
// the scan, user 9b.6).
export const GROUND_TEAMS_INTRO =
  "Security fights during objectives. Science does the objective fieldwork. Scanning is ship-side: the ship scans while your teams work the planets.";

// The reserve section's plain-words lines (GO-11; GO-2 review note (c): reserves count toward the crew limit,
// so the board can report no room while a slot shows empty).
export const RESERVE_INTRO = "Reserve members stay aboard but do not deploy. Slot them into a team to send them down.";
export const RESERVE_CAP_NOTE =
  "Reserve members count toward the crew limit: when every berth is in use, the recruitment board reports no room even while a slot sits empty. Slot a reserve member to fill it.";

export interface GroundSlotView {
  teamType: GroundSquadType;
  slotIndex: number; // the index in the team's flat list of this type (what slotMember takes)
  member: AwayMember | null;
  readyInSeconds: number; // 0 when ready (or empty); else the seconds of recovery left
}

export interface GroundSquadView {
  teamType: GroundSquadType;
  typeSquadIndex: number; // 0 = this team's first squad of the type
  label: string; // "Security squad", or "Security squad 2" on a team with two of the type
  slots: GroundSlotView[];
}

export interface KindOptionView {
  kind: GroundTeamKind;
  name: string; // "Strike"
  disabled: boolean; // the change would break "one of each type minimum"
  reason: string | null; // the visible reason when disabled
}

export interface GroundTeamCardView {
  index: number;
  name: string; // groundTeamName
  defaultName: string; // "Alpha"
  renamed: boolean; // a custom name is set
  kind: GroundTeamKind;
  kindLabel: string; // "Strike team"
  pending: boolean; // the migration's "Pick a type" prompt is open
  helpOthers: boolean;
  squads: GroundSquadView[];
  options: KindOptionView[];
  staffed: boolean;
  deploys: boolean;
  waits: string[]; // groundTeamWaitText per wait (no stand-ins: the player swaps by hand)
}

export interface GroundTeamsPanelView {
  locked: boolean; // the ship is out: every slot and type write refuses (rename and the help default do not)
  lockText: string | null; // CP-6: the accurate words (crewLock.ts crewLockText: mission vs expedition)
  lockUntil: string | null; // CP-6: how long ("until it returns" / "until its expedition is claimed")
  compositionLabel: string; // "Strike + Ground"
  securitySquads: number;
  scienceSquads: number;
  valid: boolean; // at least one Security and one Science squad
  pips: GroundSquadType[][]; // per team, its squads in order (Security first)
  room: ShipCrewRoom;
  overCapacity: boolean;
  teams: GroundTeamCardView[];
  reserve: AwayMember[]; // aboard, a ground squad type, in no slot: Security first, then Science, hire order
}

// The reason a kind option is refused, or null when the composition with it is valid. Names the other teams'
// kinds ("Strike is off: Alpha is Strike, so the ship would have no Science squad."). Pure.
export function kindOptionReason(
  teams: readonly { name: string; kind: GroundTeamKind }[],
  teamIndex: number,
  kind: GroundTeamKind,
): string | null {
  const trial = teams.map((t) => t.kind);
  trial[teamIndex] = kind;
  if (isValidComposition(trial)) return null;
  const squads = compositionSquads(trial);
  const missing = squads.security === 0 ? "Security" : "Science";
  const others = teams.filter((_, i) => i !== teamIndex).map((t) => `${t.name} is ${teamKindName(t.kind)}`);
  return `${teamKindName(kind)} is off: ${nameList(others)}, so the ship would have no ${missing} squad.`;
}

// The members of `ship` in no slot (the reserve): aboard, a ground squad type, Security first then Science,
// each in hire order. Pure.
export function groundReserve(state: GameState, ship: ShipInstance): AwayMember[] {
  const slotted = new Set<string>();
  for (const t of shipGroundTeams(ship)) for (const id of [...t.security, ...t.science]) if (id !== null) slotted.add(id);
  const out: AwayMember[] = [];
  for (const teamType of GROUND_SQUAD_TYPES) {
    out.push(
      ...state.awayMembers
        .filter((m) => m.assignedShipId === ship.id && m.teamType === teamType && !slotted.has(m.id))
        .sort(byIdNumber),
    );
  }
  return out;
}

// Everything the ground team section draws for `shipId`, or null when the ship is gone. Pure.
export function groundTeamsPanelView(state: GameState, shipId: string): GroundTeamsPanelView | null {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return null;
  const now = state.gameTimeSeconds;
  const byId = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const stored = shipGroundTeams(ship);
  const named = stored.map((t, i) => ({ name: groundTeamName(ship, i), kind: t.kind }));
  const check = deployableGroundTeams(state, shipId);
  const locked = shipCrewLocked(state, shipId);
  const lockReason = crewLockReason(state, shipId);
  const teams: GroundTeamCardView[] = stored.map((t, index) => {
    const squads: GroundSquadView[] = [];
    for (const teamType of GROUND_SQUAD_TYPES) {
      const count = squadsOfType(t.kind, teamType);
      const size = groundSquadSize(ship.typeKey, teamType);
      for (let k = 0; k < count; k += 1) {
        const slots: GroundSlotView[] = [];
        for (let j = 0; j < size; j += 1) {
          const slotIndex = k * size + j;
          const id = t[teamType][slotIndex] ?? null;
          const m = id === null ? undefined : byId.get(id);
          const member = m && m.assignedShipId === shipId && m.teamType === teamType ? m : null;
          const readyInSeconds = member && !isMemberReady(member, now) ? (member.injuredUntilSeconds as number) - now : 0;
          slots.push({ teamType, slotIndex, member, readyInSeconds });
        }
        const label = count > 1 ? `${SQUAD_TYPE_NAME[teamType]} squad ${k + 1}` : `${SQUAD_TYPE_NAME[teamType]} squad`;
        squads.push({ teamType, typeSquadIndex: k, label, slots });
      }
    }
    const readiness = check.teams[index];
    return {
      index,
      name: named[index].name,
      defaultName: groundTeamDefaultName(index),
      renamed: typeof t.name === "string" && t.name.trim() !== "",
      kind: t.kind,
      kindLabel: teamKindLabel(t.kind),
      pending: t.kindPending === true,
      helpOthers: t.helpOthers,
      squads,
      options: GROUND_TEAM_KINDS.map((kind) => {
        const reason = kindOptionReason(named, index, kind);
        return { kind, name: teamKindName(kind), disabled: reason !== null, reason };
      }),
      staffed: readiness?.staffed ?? false,
      deploys: readiness?.deploys ?? false,
      waits: (readiness?.waits ?? []).map(groundTeamWaitText),
    };
  });
  const kinds = stored.map((t) => t.kind);
  const squads = compositionSquads(kinds);
  const room = shipCrewRoom(state, ship);
  return {
    locked,
    lockText: crewLockText(state, shipId),
    lockUntil: lockReason === null ? null : crewLockUntilText(lockReason),
    compositionLabel: compositionLabel(kinds),
    securitySquads: squads.security,
    scienceSquads: squads.science,
    valid: isValidComposition(kinds),
    pips: stored.map((t) => GROUND_SQUAD_TYPES.flatMap((type) => Array.from({ length: squadsOfType(t.kind, type) }, () => type))),
    room,
    overCapacity: room.berthsUsed > room.capacity.reserveBerths,
    teams,
    reserve: groundReserve(state, ship),
  };
}

// "2 Security squads, 1 Science squad". Pure.
export function compositionSummary(security: number, science: number): string {
  const one = (n: number, type: string) => `${n} ${type} squad${n === 1 ? "" : "s"}`;
  return `${one(security, "Security")}, ${one(science, "Science")}`;
}

// The crew line: members aboard (slotted or in the reserve) against each type's slots, and the reserve
// berths in use ("Security 7 / 6 · Science 2 / 6 · Reserve berths 1 / 3"). Pure.
export function crewRoomText(room: ShipCrewRoom): string {
  return [
    `Security ${room.aboard.security} / ${room.capacity.security}`,
    `Science ${room.aboard.science} / ${room.capacity.science}`,
    `Reserve berths ${room.berthsUsed} / ${room.capacity.reserveBerths}`,
  ].join(" · ");
}

// The plain over-capacity line (user 2026-10-13: allowed, shown plainly, no confirm, no forced benching), or
// null when the reserve fits its berths. Pure.
export function overCapacityText(room: ShipCrewRoom): string | null {
  if (room.berthsUsed <= room.capacity.reserveBerths) return null;
  return (
    `Over capacity: ${room.berthsUsed} members for ${room.capacity.reserveBerths} reserve berths. ` +
    "Nobody has to leave the ship, and launches are not affected. Hiring pauses until you move, bench or fire " +
    "reserve members, or change a team's type back."
  );
}

// What changing team `teamIndex` to `kind` would do, for the line beside the Change button: who moves (named,
// from previewGroundTeamKind) and, when the reserve would end up past its berths, that plainly, as TWO short
// lines (the count, then what it means) so a phone wraps them as two lines, not one long one (GO-11 review). On a
// refusal the gate's text. Pure.
export type KindChangeView =
  | { ok: true; moves: string; overCapacity: readonly [string, string] | null }
  | { ok: false; reason: string };

export function kindChangeView(state: GameState, shipId: string, teamIndex: number, kind: GroundTeamKind): KindChangeView {
  const preview = previewGroundTeamKind(state, shipId, teamIndex, kind);
  if (!preview.ok) return { ok: false, reason: groundSlotBlockText(preview.reason) };
  const nameOf = (id: string) => state.awayMembers.find((m) => m.id === id)?.name ?? id;
  const out = preview.toReserve.map(nameOf);
  const into = preview.fromReserve.map(nameOf);
  const parts: string[] = [];
  if (out.length > 0) parts.push(`${nameList(out)} ${out.length === 1 ? "moves" : "move"} to the reserve.`);
  if (into.length > 0) parts.push(`${nameList(into)} ${into.length === 1 ? "joins" : "join"} from the reserve.`);
  const moves = parts.length > 0 ? parts.join(" ") : "Nobody moves.";
  const next = setGroundTeamKind(state, shipId, teamIndex, kind);
  const ship = next.ships.find((s) => s.id === shipId);
  const room = ship ? shipCrewRoom(next, ship) : null;
  const overCapacity: readonly [string, string] | null =
    room !== null && room.berthsUsed > room.capacity.reserveBerths
      ? [
          `The reserve will be over capacity: ${room.berthsUsed} members for ${room.capacity.reserveBerths} berths.`,
          "Nobody has to leave; hiring pauses until it fits again.",
        ]
      : null;
  return { ok: true, moves, overCapacity };
}

export interface SlotPickCandidate {
  member: AwayMember;
  where: string | null; // null = in the reserve; else "Bravo, Security squad 2"
  readyInSeconds: number; // 0 when ready
}

// The members a slot picker offers for a `teamType` slot on `shipId`: the reserve of that type first (hire
// order); with `includeSlotted` (a Swap), also the members of that type slotted elsewhere, team then slot
// order, labeled with where they sit. `excludeMemberId` (the slot's own occupant) is left out. Pure.
export function slotPickCandidates(
  state: GameState,
  shipId: string,
  teamType: GroundSquadType,
  excludeMemberId: string | null,
  includeSlotted: boolean,
): SlotPickCandidate[] {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return [];
  const now = state.gameTimeSeconds;
  const ready = (m: AwayMember) => (isMemberReady(m, now) ? 0 : (m.injuredUntilSeconds as number) - now);
  const out: SlotPickCandidate[] = groundReserve(state, ship)
    .filter((m) => m.teamType === teamType && m.id !== excludeMemberId)
    .map((member) => ({ member, where: null, readyInSeconds: ready(member) }));
  if (!includeSlotted) return out;
  const byId = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const size = groundSquadSize(ship.typeKey, teamType);
  shipGroundTeams(ship).forEach((t, teamIndex) => {
    const count = squadsOfType(t.kind, teamType);
    t[teamType].forEach((id, slotIndex) => {
      if (id === null || id === excludeMemberId) return;
      const member = byId.get(id);
      if (!member || member.assignedShipId !== shipId || member.teamType !== teamType) return;
      const k = Math.floor(slotIndex / size);
      const squad = count > 1 ? `${SQUAD_TYPE_NAME[teamType]} squad ${k + 1}` : `${SQUAD_TYPE_NAME[teamType]} squad`;
      out.push({ member, where: `${groundTeamName(ship, teamIndex)}, ${squad}`, readyInSeconds: ready(member) });
    });
  });
  return out;
}
