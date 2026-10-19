// WR-6 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-6, open calls OC-A40 to
// OC-A42): the captain PRIMARY tree's combat and science bonuses, and the tactical / science spec bonuses, as pure
// readers. The Prospector hub, its tree and its spec bonus are read by tick.ts (missions); this module reads the
// rest:
//   tacticianHub Combat Readiness + the tactical spec : weapon damage (weaponDamageMult)
//   explorerHub Survey Doctrine                       : expedition scan rate (scanRateMult)
//   the science spec                                  : relic find chance (relicFindMult)
//
// The user's rulings that apply (USER ANSWERS 2026-10-15 and the WR-5a calls 2026-10-17):
//   OC-A1 + "Always multiply": each source is its own x (1 + mult) factor on the value it names.
//   OC-A2 "own ship": it acts on the ship the captain commands, frozen at dispatch for runs and per cycle for
//     patrols. It does that by folding into the records the secondary tree already freezes: the captain combat
//     record (captainTacticianEffects.ts captainCombatMods), the scan params and the explorer run record
//     (captainExplorerEffects.ts), so every reader of those records reads these too.
// The sizes are [PROVISIONAL] constants in model.ts (TACTICIAN_HUB_WEAPON_DAMAGE, EXPLORER_HUB_SCAN_RATE,
// TACTICAL_SPEC_WEAPON_DAMAGE, SCIENCE_SPEC_RELIC_FIND), read through the catalogs so a retune is a data edit.
//
// This module imports only model.ts. Every reader returns exactly 1 without a source, so a captain without one
// changes nothing, byte for byte.

import { CAPTAIN_SPEC_BONUS, CAPTAIN_TALENTS, type CaptainState } from "./model";

export type CaptainPrimaryMultKind = "weaponDamageMult" | "scanRateMult" | "relicFindMult";

// The product of (1 + mult) over the captain's owned primary talents and spec bonus of effect type `kind`; exactly
// 1 without one. Reads only the two fields it needs, so a partial captain (a test's or a dispatch record's) reads
// as owning nothing it does not carry. Pure.
export function captainPrimaryMult(
  captain: Partial<Pick<CaptainState, "unlockedCaptainTalents" | "spec">> | undefined | null,
  kind: CaptainPrimaryMultKind,
): number {
  if (!captain) return 1;
  let f = 1;
  for (const key of captain.unlockedCaptainTalents ?? []) {
    const e = CAPTAIN_TALENTS[key]?.effect;
    if (e && e.type === kind) f *= 1 + e.mult;
  }
  const spec = captain.spec ? CAPTAIN_SPEC_BONUS[captain.spec] : undefined;
  if (spec && spec.type === kind) f *= 1 + spec.mult;
  return f;
}
