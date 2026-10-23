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
// completed while away is announced on return exactly like one completed while watching.
// ============================================================================

import { SHIP_TYPES, type EquipmentInstance, type GameState } from "./model";
import { EXCEPTIONAL_SETS } from "./relics";
import { GEAR_SETS, activeGearSetTiers, type GearSetScope } from "./gearSets";

// A [PROPOSAL] catalog label shown without its tag (the names await the user's sign-off sheet).
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

// Every wearer of a state, with the pieces it wears and the name a line uses.
function wearers(s: GameState): { key: string; name: string; scope: GearSetScope; pieces: EquipmentInstance[] }[] {
  const out: { key: string; name: string; scope: GearSetScope; pieces: EquipmentInstance[] }[] = [];
  for (const ship of s.ships ?? []) {
    out.push({ key: `ship:${ship.id}`, name: ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.id, scope: "ship", pieces: (s.equipment ?? []).filter((e) => e.fittedToShipId === ship.id) });
  }
  for (const m of s.awayMembers ?? []) {
    out.push({ key: `member:${m.id}`, name: m.name, scope: "member", pieces: (s.equipment ?? []).filter((e) => e.fittedToMemberId === m.id) });
  }
  return out;
}

// The shoutout lines for what `after` completed that `before` had not. Pure.
export function setCompletionShoutouts(before: GameState, after: GameState): string[] {
  const lines: string[] = [];
  const had = new Set(before.museumV2?.setsCompleted ?? []);
  for (const id of after.museumV2?.setsCompleted ?? []) {
    if (had.has(id)) continue;
    const set = EXCEPTIONAL_SETS.find((x) => x.id === id);
    lines.push(`Set complete: ${set ? plainLabel(set.label) : id} is whole in the Museum.`);
  }
  // Gear sets only when a set piece exists at all (every save without one skips the scan).
  if ((after.equipment ?? []).some((e) => e.setId !== undefined || e.slotType === "module")) {
    const prior = new Map(wearers(before).map((w) => [w.key, completeSets(w.pieces, w.scope)] as const));
    for (const w of wearers(after)) {
      const was = prior.get(w.key) ?? new Set<string>();
      for (const id of completeSets(w.pieces, w.scope)) {
        if (was.has(id)) continue;
        const set = GEAR_SETS.find((x) => x.id === id)!;
        lines.push(`Set complete: ${w.name} wears the full ${plainLabel(set.label)} set.`);
      }
    }
  }
  return lines;
}
