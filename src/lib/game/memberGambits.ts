// memberGambits.ts: the PER-MEMBER gambit program actions (Ground Operations 0.14.0 GO-16, absorbs E-CREW
// Task 17's editor; design D16: gambits are per member, Security only; D19: a member with no program of their
// own runs DEFAULT_MEMBER_GAMBIT).
//
// The program lives on the member (AwayMember.gambit, optional: ABSENT = the default). Combat reads it ONLY
// through the dispatch snapshot (awayTeam.ts snapshotMember), so an edit here never changes a run already in
// flight and no combat outcome moves until the next launch. No SAVE_VERSION change: the field already exists.
//
// Every action is pure and refuses by returning the SAME state (the App.svelte do* same-ref guard): an unknown
// member, a member who is not Security (Science never fights, design D2), an index out of range, or an edit
// that would leave the stored program exactly as it is. A successful edit replaces only that member's object;
// every other member, the ships and the account-level pair (state.gambitPrograms, inert since D19) keep their
// references.
//
// Imports model.ts, gambit.ts and groundTeamSlots.ts only.

import type { AwayMember, GambitProgram, GambitRule, GameState } from "./model";
import { DEFAULT_MEMBER_GAMBIT, groundSquadSize } from "./model";
import { GAMBIT_PRESETS, gambitPresetPrograms, type GambitPreset } from "./gambit";
import { cleanShipGroundTeams, findGroundSlot } from "./groundTeamSlots";

function cloneRule(r: GambitRule): GambitRule {
  return r.params ? { target: r.target, action: r.action, params: { ...r.params } } : { target: r.target, action: r.action };
}
function cloneProgram(p: readonly GambitRule[]): GambitProgram {
  return p.map(cloneRule);
}

// Structural rule / program equality (params compared by value, an absent param equal to an absent one). Field Kits
// FKR-6: the kit, rank condition and Boss reserve params count too (absent on every rule written before them).
export function gambitRuleEquals(a: GambitRule, b: GambitRule): boolean {
  return (
    a.target === b.target &&
    a.action === b.action &&
    (a.params?.hpThreshold ?? null) === (b.params?.hpThreshold ?? null) &&
    (a.params?.statusId ?? null) === (b.params?.statusId ?? null) &&
    (a.params?.kitId ?? null) === (b.params?.kitId ?? null) &&
    (a.params?.minRank ?? null) === (b.params?.minRank ?? null) &&
    (a.params?.reserveForBoss ?? null) === (b.params?.reserveForBoss ?? null)
  );
}
export function gambitProgramEquals(a: readonly GambitRule[], b: readonly GambitRule[]): boolean {
  return a.length === b.length && a.every((r, i) => gambitRuleEquals(r, b[i]));
}

// Whether the member has a program of their own (an empty one counts: Custom makes a member hold). Pure.
export function memberHasOwnGambit(member: Pick<AwayMember, "gambit">): boolean {
  return Array.isArray(member.gambit);
}

// The program the member fights with: their own, else DEFAULT_MEMBER_GAMBIT for Security (D19), else empty
// (Science never fights). Always a fresh copy, never the shared default. Pure.
export function memberGambitProgram(member: Pick<AwayMember, "gambit" | "teamType">): GambitProgram {
  if (Array.isArray(member.gambit)) return cloneProgram(member.gambit);
  return member.teamType === "security" ? cloneProgram(DEFAULT_MEMBER_GAMBIT) : [];
}

// The preset whose Security program the member's OWN program matches, else null (the default is not a preset,
// and an edited preset reads as custom). Pure.
export function matchedMemberPreset(member: Pick<AwayMember, "gambit">): GambitPreset | null {
  if (!Array.isArray(member.gambit)) return null;
  const own = member.gambit;
  return GAMBIT_PRESETS.find((p) => gambitProgramEquals(p.programs.security, own)) ?? null;
}

// `state` with Security member `memberId`'s program replaced by `program` (null = clear back to the default).
// Refuses (same state) for an unknown or non-Security member, or when nothing would change.
function writeMemberGambit(state: GameState, memberId: string, program: readonly GambitRule[] | null): GameState {
  const index = state.awayMembers.findIndex((m) => m.id === memberId);
  if (index < 0) return state;
  const member = state.awayMembers[index];
  if (member.teamType !== "security") return state;
  if (program === null) {
    if (!memberHasOwnGambit(member)) return state;
    const { gambit: _cleared, ...rest } = member;
    return replaceMember(state, index, rest);
  }
  if (Array.isArray(member.gambit) && gambitProgramEquals(member.gambit, program)) return state;
  return replaceMember(state, index, { ...member, gambit: cloneProgram(program) });
}

function replaceMember(state: GameState, index: number, member: AwayMember): GameState {
  const awayMembers = state.awayMembers.slice();
  awayMembers[index] = member;
  return { ...state, awayMembers };
}

function securityMember(state: GameState, memberId: string): AwayMember | null {
  const m = state.awayMembers.find((x) => x.id === memberId);
  return m && m.teamType === "security" ? m : null;
}

// SET: replace rule `index` of the member's program. A member on the default gets the default stored as
// their own, with that one rule changed. Pure.
export function setMemberGambitRule(state: GameState, memberId: string, index: number, rule: GambitRule): GameState {
  const m = securityMember(state, memberId);
  if (!m) return state;
  const program = memberGambitProgram(m);
  if (!Number.isInteger(index) || index < 0 || index >= program.length) return state;
  if (gambitRuleEquals(program[index], rule)) return state;
  program[index] = cloneRule(rule);
  return writeMemberGambit(state, memberId, program);
}

// ADD: append a rule to the member's program. Pure.
export function addMemberGambitRule(state: GameState, memberId: string, rule: GambitRule): GameState {
  const m = securityMember(state, memberId);
  if (!m) return state;
  return writeMemberGambit(state, memberId, [...memberGambitProgram(m), cloneRule(rule)]);
}

// REMOVE: drop rule `index`. Pure.
export function removeMemberGambitRule(state: GameState, memberId: string, index: number): GameState {
  const m = securityMember(state, memberId);
  if (!m) return state;
  const program = memberGambitProgram(m);
  if (!Number.isInteger(index) || index < 0 || index >= program.length) return state;
  return writeMemberGambit(state, memberId, program.filter((_, i) => i !== index));
}

// MOVE: swap rule `index` with its neighbor (reorder == priority). Pure.
export function moveMemberGambitRule(state: GameState, memberId: string, index: number, dir: "up" | "down"): GameState {
  const m = securityMember(state, memberId);
  if (!m) return state;
  const program = memberGambitProgram(m);
  const target = dir === "up" ? index - 1 : index + 1;
  if (!Number.isInteger(index) || index < 0 || index >= program.length || target < 0 || target >= program.length) return state;
  [program[index], program[target]] = [program[target], program[index]];
  return writeMemberGambit(state, memberId, program);
}

// PRESET: give the member a copy of a preset's Security program (the six locked titles, D16). Pure.
export function applyMemberGambitPreset(state: GameState, memberId: string, presetId: string): GameState {
  const pair = gambitPresetPrograms(presetId);
  if (!pair) return state;
  return writeMemberGambit(state, memberId, pair.security);
}

// RESET: clear the member's own program, so they run the built-in default again (D19). Pure.
export function resetMemberGambit(state: GameState, memberId: string): GameState {
  return writeMemberGambit(state, memberId, null);
}

// The OTHER Security members of `memberId`'s own Security squad on `shipId`, in slot order: the squad the
// member is slotted in (a Strike team's two Security squads are separate), read from the CLEANED slots so a
// stale id never counts. Empty for a member in the reserve, a Science member, or an unknown ship. Pure.
export function memberSecuritySquadmates(state: GameState, shipId: string, memberId: string): string[] {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return [];
  const teams = cleanShipGroundTeams(ship, state.awayMembers);
  const at = findGroundSlot(teams, memberId);
  if (!at || at.teamType !== "security") return [];
  const size = groundSquadSize(ship.typeKey, "security");
  if (size <= 0) return [];
  const start = Math.floor(at.slotIndex / size) * size;
  return teams[at.teamIndex].security
    .slice(start, start + size)
    .filter((id): id is string => id !== null && id !== memberId);
}

// The squadmates (memberSecuritySquadmates) whose stored program a COPY TO SQUAD would actually change, in
// slot order: empty when every squadmate already runs the member's program (or the member is not Security).
// The editor disables the copy on empty; the host's log names exactly these. Pure.
export function squadmatesCopyWouldChange(state: GameState, shipId: string, memberId: string): string[] {
  const source = securityMember(state, memberId);
  if (!source) return [];
  const program = Array.isArray(source.gambit) ? source.gambit : null;
  return memberSecuritySquadmates(state, shipId, memberId).filter((id) => writeMemberGambit(state, id, program) !== state);
}

// COPY TO SQUAD: give each squadmate (memberSecuritySquadmates) the member's program as their own copy. A
// member on the default puts the squadmates back on the default (their own programs cleared), so they keep
// following the built-in one. Refuses (same state) when nobody would change. Pure.
export function copyMemberGambitToSquad(state: GameState, shipId: string, memberId: string): GameState {
  const source = securityMember(state, memberId);
  if (!source) return state;
  const program = Array.isArray(source.gambit) ? source.gambit : null;
  let next = state;
  for (const id of memberSecuritySquadmates(state, shipId, memberId)) next = writeMemberGambit(next, id, program);
  return next;
}
