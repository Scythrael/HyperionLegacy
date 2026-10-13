// Squads redesign 0.14.0 (SQ-1): the COMPOSITION math. Design docs/plans/2026-10-12-squads-and-subspace-
// telescope-design.md sections 2.1 to 2.4 plus its USER ANSWERS (flat slots + team kind approved; the migrated
// second pair defaults to Ground; a fixed crew per ship plus a small backup roster).
//
// Every hull fields ShipTypeDef.groundSquads squads (4 today, user "DOUBLE EVERY HULL"), grouped into teams of
// 2 squads (user: teams are PAIRS). A team's KIND names the pair (user names): Strike = 2 Security, Survey = 2
// Science, Ground = 1 + 1. A ship must keep at least one Security and one Science squad (user: "Always
// require one of each type minimum"), so a 4-squad hull has exactly four valid compositions.
//
// Imports model.ts ONLY (groundTeamSlots.ts normalizes slot lists with the kind sizes here, and awayTeam.ts
// sits above that). Module graph: model.ts <- groundComposition.ts <- groundTeamSlots.ts <- awayTeam.ts <-
// groundTeams.ts. Every function is pure. Nothing here changes engine behavior on its own: SQ-2 wires the
// kind change action, the composition-following hire cap and the per-squad deploy check.

import type { GroundTeamKind, ShipInstance, ShipTypeKey } from "./model";
import { SHIP_TYPES, groundSquadSize, groundTeamCount } from "./model";

// The squad types a ground team is built from (Prospecting is wired only and fields no ground squad).
export type CompositionSquadType = "security" | "science";

// The three team kinds, in their canonical order (stored ids are lowercase). Ground is the default: the
// shape GO-1 built, every freshly minted team, and the pair the v68 migration adds (user, open call 2).
export const GROUND_TEAM_KINDS: readonly GroundTeamKind[] = ["ground", "strike", "survey"];
export const DEFAULT_GROUND_TEAM_KIND: GroundTeamKind = "ground";

export function isGroundTeamKind(value: unknown): value is GroundTeamKind {
  return value === "ground" || value === "strike" || value === "survey";
}

// Squads of each type in one team of `kind`. Always 2 in total (a team is a pair of squads).
const SQUADS_BY_KIND: Readonly<Record<GroundTeamKind, Readonly<Record<CompositionSquadType, number>>>> = {
  ground: { security: 1, science: 1 },
  strike: { security: 2, science: 0 },
  survey: { security: 0, science: 2 },
};

export function squadsOfType(kind: GroundTeamKind, type: CompositionSquadType): number {
  return SQUADS_BY_KIND[kind][type];
}

export function securitySquadsOf(kind: GroundTeamKind): number {
  return squadsOfType(kind, "security");
}

export function scienceSquadsOf(kind: GroundTeamKind): number {
  return squadsOfType(kind, "science");
}

// The user's names for the kinds ("Ground" / "Strike" / "Survey") and the team label ("Strike team").
export function teamKindName(kind: GroundTeamKind): string {
  switch (kind) {
    case "ground":
      return "Ground";
    case "strike":
      return "Strike";
    case "survey":
      return "Survey";
  }
}

export function teamKindLabel(kind: GroundTeamKind): string {
  return `${teamKindName(kind)} team`;
}

// The member slots a team of `kind` holds of `type` on a hull: its squads of that type x the hull's squad
// size for the type (awayTeams[].size, unchanged by SQ-1). The flat slot list is squad-major: squad k holds
// slots [k * size, (k + 1) * size).
export function teamSlotCount(typeKey: ShipTypeKey, kind: GroundTeamKind, type: CompositionSquadType): number {
  return squadsOfType(kind, type) * groundSquadSize(typeKey, type);
}

// How many ground squads a hull fields (ShipTypeDef.groundSquads); 0 for an unknown hull.
export function groundSquadsOf(typeKey: ShipTypeKey): number {
  const squads = SHIP_TYPES[typeKey]?.groundSquads ?? 0;
  return Number.isFinite(squads) ? Math.max(0, Math.floor(squads)) : 0;
}

// Squad totals of a composition (a list of team kinds, one per team).
export interface CompositionSquads {
  security: number;
  science: number;
}

export function compositionSquads(kinds: readonly GroundTeamKind[]): CompositionSquads {
  let security = 0;
  let science = 0;
  for (const kind of kinds) {
    if (!isGroundTeamKind(kind)) continue;
    security += securitySquadsOf(kind);
    science += scienceSquadsOf(kind);
  }
  return { security, science };
}

// Whether a composition keeps the user's minimum: at least one Security AND one Science squad, every entry a
// known kind, at least one team. On a 4-squad hull this refuses exactly Strike + Strike (no Science squad)
// and Survey + Survey (no Security squad). Team order never matters.
export function isValidComposition(kinds: readonly GroundTeamKind[]): boolean {
  if (kinds.length === 0 || !kinds.every(isGroundTeamKind)) return false;
  const squads = compositionSquads(kinds);
  return squads.security >= 1 && squads.science >= 1;
}

// Every valid composition of a hull's team count, each a kind list in GROUND_TEAM_KINDS order (team order
// does not matter, so each multiset appears once), Ground + Ground first (the default). A 4-squad hull gives
// Ground + Ground, Strike + Ground, Survey + Ground, Strike + Survey. A hull with no teams gives none.
export function validCompositions(typeKey: ShipTypeKey): GroundTeamKind[][] {
  const teams = groundTeamCount(typeKey);
  if (teams <= 0) return [];
  const out: GroundTeamKind[][] = [];
  const walk = (from: number, acc: GroundTeamKind[]): void => {
    if (acc.length === teams) {
      if (isValidComposition(acc)) out.push([...acc]);
      return;
    }
    for (let i = from; i < GROUND_TEAM_KINDS.length; i += 1) walk(i, [...acc, GROUND_TEAM_KINDS[i]]);
  };
  walk(0, []);
  return out;
}

// The order kinds read in a composition label: Strike, Survey, Ground ("Strike + Ground", "Survey + Ground",
// "Strike + Survey", the design's phrasing).
const LABEL_ORDER: Readonly<Record<GroundTeamKind, number>> = { strike: 0, survey: 1, ground: 2 };

// "Strike + Ground" for any team order; "" for an empty list.
export function compositionLabel(kinds: readonly GroundTeamKind[]): string {
  return [...kinds]
    .filter(isGroundTeamKind)
    .sort((a, b) => LABEL_ORDER[a] - LABEL_ORDER[b])
    .map(teamKindName)
    .join(" + ");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// A ship's team kinds, absent-safe: exactly groundTeamCount(typeKey) entries, each the stored kind when it is
// a known kind, else Ground (a ship minted without teams, a v67 team with no kind, a corrupt value). The one
// kind reader, so groundTeamSlots.ts shipGroundTeams sizes its slot lists from the same answer.
export function shipTeamKinds(ship: Pick<ShipInstance, "typeKey" | "groundTeams">): GroundTeamKind[] {
  const stored: unknown[] = Array.isArray(ship.groundTeams) ? ship.groundTeams : [];
  return Array.from({ length: groundTeamCount(ship.typeKey) }, (_, i) => {
    const t = stored[i];
    return isRecord(t) && isGroundTeamKind(t.kind) ? t.kind : DEFAULT_GROUND_TEAM_KIND;
  });
}

// A ship's squad counts per type, from its team kinds.
export function shipComposition(ship: Pick<ShipInstance, "typeKey" | "groundTeams">): CompositionSquads {
  return compositionSquads(shipTeamKinds(ship));
}

// ============================================================================
// The BACKUP ROSTER (user follow-up 2026-10-12: "a fixed crew per ship plus about 2 reserve berths aboard,
// so changing a team's type never forces benching"). [PROVISIONAL count]
// ============================================================================
//
// Data shape: DERIVED, not stored. The reserve is what GO-2 already calls the ship's reserve: members aboard
// with a ground squad type who sit in no slot. The backup roster is how many of them a ship may carry past its
// slots: GROUND_RESERVE_BERTHS berths, shared by both types. A ship's fixed crew is then its composition's
// slots per type plus those berths. SQ-2 wires the hire cap and the kind change on top of this; nothing reads
// it yet.

// The reserve berths aboard every ship that fields ground teams. [PROVISIONAL: the user said "about 2".]
export const GROUND_RESERVE_BERTHS = 2;

// Reserve berths aboard a ship of `typeKey`: GROUND_RESERVE_BERTHS when the hull fields ground teams, else 0.
export function shipReserveBerths(typeKey: ShipTypeKey): number {
  return groundTeamCount(typeKey) > 0 ? GROUND_RESERVE_BERTHS : 0;
}

// A ship's fixed crew for a composition: the slots of each type, the shared reserve berths, and the total.
export interface ShipCrewCapacity {
  security: number; // Security slots across the teams
  science: number; // Science slots across the teams
  reserveBerths: number; // shared by both types (shipReserveBerths)
  total: number; // security + science + reserveBerths
}

export function shipCrewCapacity(typeKey: ShipTypeKey, kinds: readonly GroundTeamKind[]): ShipCrewCapacity {
  let security = 0;
  let science = 0;
  for (const kind of kinds) {
    if (!isGroundTeamKind(kind)) continue;
    security += teamSlotCount(typeKey, kind, "security");
    science += teamSlotCount(typeKey, kind, "science");
  }
  const reserveBerths = shipReserveBerths(typeKey);
  return { security, science, reserveBerths, total: security + science + reserveBerths };
}

// How many reserve berths `aboard` members fill: the members of each type past that type's slots, summed (an
// empty slot is not a berth). May exceed capacity.reserveBerths (an over-capacity ship); the caller decides
// what that refuses.
export function reserveBerthsUsed(aboard: { security: number; science: number }, capacity: Pick<ShipCrewCapacity, "security" | "science">): number {
  return Math.max(0, aboard.security - capacity.security) + Math.max(0, aboard.science - capacity.science);
}
