// ============================================================================
// setShoutouts.ts: RARITY READINESS RR-7 (docs/plans/2026-10-23-rarity-readiness-plan.md; relics v2 plan call 16 "Every
// exceptional set completion is a ledger event"; the user's "completing any set bonus should deserve a shoutout in the
// system chat"). The system chat is not built yet, so the shoutout is a log line the App pushes; this module is the one
// place that decides WHAT is shouted, as a pure diff of two states:
//   - a relic set: every id that is in after.museumV2.setsCompleted and not in before's (relicIdentify.ts appends a set
//     there once, when its last exceptional piece is identified);
//   - a gear set (RR-6): every set whose EVERY tier is active for one wearer (a ship's installed gear, or one away-team
//     member's worn gear) in `after` and was not in `before`. Breaking a set says nothing.
// The App calls it around the offline catch-up (before / after the one tick) and on every live state change, so a set
// completed while away is announced on return exactly like one completed while watching. Review of RR-7: the gear half
// costs nothing on a state with no set piece or with the same equipment, ships and members, and groups pieces by wearer
// in one pass.
// ============================================================================

import { SHIP_TYPES, type EquipmentInstance, type GameState } from "./model";
import { EXCEPTIONAL_SETS } from "./relics";
import { GEAR_SETS, activeGearSetTiers, pieceSetId, type GearSetScope } from "./gearSets";

// A [PROPOSAL] gear set label shown without its tag (the gear set names await their sign-off; the exceptional relic set
// names are the approved ones, R2-5, and read as they are).
function plainLabel(label: string): string {
  return label.replace(/^\[PROPOSAL\]\s*/, "");
}

// The ids of the gear sets one wearer has COMPLETE (all of the set's tiers active).
function completeSets(pieces: readonly EquipmentInstance[], scope: GearSetScope): Set<string> {
  const active = activeGearSetTiers(pieces, scope);
  const out = new Set<string>();
  for (const set of GEAR_SETS) {
    if (set.scope !== scope) continue;
    if (set.tiers.every((t) => active.some((a) => a.setId === set.id && a.pieces === t.pieces))) out.add(set.id);
  }
  return out;
}

interface SetWearer {
  readonly name: string;
  readonly scope: GearSetScope;
  readonly pieces: EquipmentInstance[];
}

// Every wearer holding at least one SET piece, with its set pieces, grouped in ONE pass over the equipment. Pure.
function setWearers(s: GameState): Map<string, SetWearer> {
  const out = new Map<string, SetWearer>();
  const ships = new Map((s.ships ?? []).map((sh) => [sh.id, sh] as const));
  const members = new Map((s.awayMembers ?? []).map((m) => [m.id, m] as const));
  for (const e of s.equipment ?? []) {
    if (pieceSetId(e) === undefined) continue;
    const ship = e.fittedToShipId ? ships.get(e.fittedToShipId) : undefined;
    const member = e.fittedToMemberId ? members.get(e.fittedToMemberId) : undefined;
    let key: string;
    let w: SetWearer;
    if (ship) {
      key = `ship:${ship.id}`;
      w = out.get(key) ?? { name: ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.id, scope: "ship", pieces: [] };
    } else if (member) {
      key = `member:${member.id}`;
      w = out.get(key) ?? { name: member.name, scope: "member", pieces: [] };
    } else {
      continue; // in storage: counts toward no wearer
    }
    w.pieces.push(e);
    out.set(key, w);
  }
  return out;
}

// How many gear wearer scans setCompletionShoutouts has run: a cheap counter its test reads to prove that a state with no
// set piece, or an unchanged install state, does no scan work.
let gearScans = 0;
export function gearShoutoutScanCount(): number {
  return gearScans;
}

// The shoutout lines for what `after` completed that `before` had not. Pure (apart from the scan counter).
export function setCompletionShoutouts(before: GameState, after: GameState): string[] {
  const lines: string[] = [];
  const had = new Set(before.museumV2?.setsCompleted ?? []);
  for (const id of after.museumV2?.setsCompleted ?? []) {
    if (had.has(id)) continue;
    const set = EXCEPTIONAL_SETS.find((x) => x.id === id);
    lines.push(`Set complete: ${set ? set.label : id} is whole in the Museum.`);
  }
  // Gear sets: nothing to do when the install state did not change, or when no piece in `after` counts toward a set
  // (every save today).
  if (before.equipment === after.equipment && before.ships === after.ships && before.awayMembers === after.awayMembers) return lines;
  if (!(after.equipment ?? []).some((e) => pieceSetId(e) !== undefined)) return lines;
  gearScans++;
  const prior = setWearers(before);
  for (const [key, w] of setWearers(after)) {
    const p = prior.get(key);
    const was = p ? completeSets(p.pieces, p.scope) : new Set<string>();
    for (const id of completeSets(w.pieces, w.scope)) {
      if (was.has(id)) continue;
      const set = GEAR_SETS.find((x) => x.id === id)!;
      lines.push(`Set complete: ${w.name} wears the full ${plainLabel(set.label)} set.`);
    }
  }
  return lines;
}
