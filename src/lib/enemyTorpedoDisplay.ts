// WR-8b ENEMY TORPEDOES (0.14.0; docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, the USER ANSWERS 2026-11-10
// "Enemy torpedoes" bullet, "Simple now"): the player-facing text. Every number is read from the engine
// (combat/combatRules.ts, combat/patrolProfile.ts, runDifficulty.ts), so the card and Help can never disagree with the
// fight. Pure.
//
//   - patrolTorpedoLine: the patrol card's Encounter line for a patrol dispatched now (the training patrol fields none).
//   - PATROL_TORPEDO_HELP / SHIP_EVENT_TORPEDO_HELP: the Combat Patrols and Scan Events Help paragraphs.

import { DEFENSIVE_STANCE, MARAUDER_TORPEDO_PERMILLE, SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER } from "./game/combat/combatRules";
import { patrolMarauderTorpedoPermille } from "./game/combat/patrolProfile";
import { PIRATE_HULLS } from "./game/combat/enemyHulls";
import { weaponDisplayName } from "./game/combat/combatView";
import { N_FULL, RAMP_MAX_TIER, isFirstRun, patrolDifficultyAt, rampFraction, rampOddsFraction } from "./game/runDifficulty";
import type { GameState, PatrolDef, RegionTier } from "./game/model";
import { regionTierNumeral } from "./game/galaxy";

// "1.5%" (one decimal where the number has one).
function permillePct(permille: number): string {
  return `${Number((permille / 10).toFixed(1))}%`;
}
function tierName(t: number): string {
  return `Tier ${regionTierNumeral(t as RegionTier)}`;
}

const CARRIER = PIRATE_HULLS.corsairCarrier.name;
const MARAUDER = PIRATE_HULLS.marauder.name;
const INTERCEPT = permillePct(DEFENSIVE_STANCE.missileInterceptPct * 10);
// The weapons that shoot torpedoes down, by their display names (combat/combatView.ts).
const INTERCEPTORS = `a working ${weaponDisplayName("pointDefenseArray")} or ${weaponDisplayName("empCannon")}`;

// The Marauder's chance after `completed` patrol runs (the training patrol not counted), as a dispatch then stamps it:
// the curve's stamp while the odds ramp is below its top (runDifficulty.ts patrolDifficultyAt stamps one patrol past
// the enemy curve's top, the WR-8b fix round's smoothed step), full from there on (no stamp). Pure.
export function marauderTorpedoPermilleAfter(completed: number): number {
  if (rampOddsFraction(completed) >= 1) return MARAUDER_TORPEDO_PERMILLE;
  return patrolMarauderTorpedoPermille({ difficulty: { version: 1, firstRun: false, ramp: rampFraction(completed), tier: RAMP_MAX_TIER, completed } });
}
// The first completed-run count at which a Marauder carries one at full strength (the odds ramp at its top).
export const MARAUDER_FULL_AFTER = (() => {
  let c = 0;
  while (rampOddsFraction(c) < 1) c += 1;
  return c;
})();
// The first completed-run count at which a Marauder can carry a torpedo (the odds ramp lifts off 0).
const MARAUDER_FIRST_AFTER = (() => {
  for (let c = 0; c < N_FULL; c++) if (rampOddsFraction(c) > 0) return c;
  return N_FULL - 1;
})();

// The patrol card's torpedo line for `def` dispatched now, or null when no enemy on it carries one (the training
// patrol, or a route with neither torpedo hull). Pure.
export function patrolTorpedoLine(state: GameState, def: Pick<PatrolDef, "hullPool">): string | null {
  if (isFirstRun(state, "patrol")) return null;
  const parts: string[] = [];
  if (def.hullPool.includes("corsairCarrier")) parts.push(`every ${CARRIER} carries a Concussion Torpedo`);
  if (def.hullPool.includes("marauder")) {
    const permille = patrolMarauderTorpedoPermille({ difficulty: patrolDifficultyAt(state) });
    parts.push(permille > 0 ? `a ${MARAUDER} carries one ${permillePct(permille)} of the time` : `no ${MARAUDER} carries one yet (the chance grows over your next patrols)`);
  }
  if (parts.length === 0) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}. Point defense shoots torpedoes down only in the Defensive stance, with ${INTERCEPTORS}.`;
}

// The Combat Patrols Help paragraph.
export const PATROL_TORPEDO_HELP = `TORPEDOES: some pirates carry a Concussion Torpedo, a slow, heavy missile. Every ${CARRIER} installs one beside its plasma. A ${MARAUDER} may carry one: never on the training patrol or your first ${MARAUDER_FIRST_AFTER} patrols after it, then more often as your patrols go on (${permillePct(marauderTorpedoPermilleAfter(4))} after 4 completed patrols, ${permillePct(marauderTorpedoPermilleAfter(7))} after 7, ${permillePct(marauderTorpedoPermilleAfter(MARAUDER_FULL_AFTER - 1))} after ${MARAUDER_FULL_AFTER - 1}), and ${permillePct(MARAUDER_TORPEDO_PERMILLE)} from ${MARAUDER_FULL_AFTER} completed patrols on. Only a ship flying Defensive with ${INTERCEPTORS} can shoot torpedoes down (about ${INTERCEPT} of them); in Aggressive or Balanced every torpedo gets its shot. The patrol card's More info lists who carries them for a patrol you send now, and the Threat Assessment counts them.`;

const TIERS = Object.keys(SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER).map(Number).sort((a, b) => a - b) as (keyof typeof SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER)[];
const FIRST_TIER = TIERS[0];
const LAST_TIER = TIERS[TIERS.length - 1];

// The Scan Events Help paragraph.
export const SHIP_EVENT_TORPEDO_HELP = `TORPEDOES: a hostile probe or cloaked vessel may carry a Concussion Torpedo, more often the farther out you go: ${permillePct(SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER[FIRST_TIER])} of them at ${tierName(FIRST_TIER)} (less on your first runs there, none on the first runs after the training run), rising each tier to ${permillePct(SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER[LAST_TIER])} at ${tierName(LAST_TIER)}. A scan event has no stance, so point defense cannot shoot these torpedoes down. The training run never meets one.`;
