// ============================================================================
// shipLoadout.ts: pure "what if I installed this?" simulation for the Ships-tab
// install flow (0.13.2, Unit 5). Author: Claude (Opus 4.8) | 2026-09-01
//
// WHY THIS EXISTS. The Ships-tab install flow (INSTALLED banner + compatible-spare
// tiles + a current-vs-candidate comparison) needs to answer, for a spare the player
// is considering, "what would my ship's stats be if I installed this?" There is NO
// "stats if X were installed" function in the game, so this module builds a
// HYPOTHETICAL gear array and re-runs the EXACT SAME pure functions the real install
// fold uses (never a re-derivation):
//   - shipToCombatant  (combat/bridge.ts) folds gear into a sim Combatant,
//   - battleRating     (combat/rating.ts) scores that Combatant,
//   - computeCombatReadout (combatFit.ts) folds the panel's combat readout.
// Because the preview reads THROUGH those same helpers, the number the flow shows can
// never drift from the number the ship actually fights with after fitEquipment. That
// no-drift property is pinned by shipLoadout.test.ts's fidelity test: previewing a
// candidate and actually installing it (fitEquipment, then read the ship) produce the
// SAME readout.
//
// THE INSTALL SEMANTICS MIRROR fitEquipment EXACTLY (equipment.ts). This is the whole
// point, so it is spelled out here and re-verified by the fidelity test:
//   - SINGLETON slot (the four economy slots + shieldEmitters + hullPlating): a slot
//     holds at most one piece, so installing REPLACES that slot's current occupant.
//     applyHypotheticalInstall drops any piece of the candidate's slotType and appends
//     the candidate, exactly as fitEquipment evicts the same-slot occupant to the pool.
//   - MULTI slot (weapon / droneBay): a hull holds several pieces (up to its hardpoint /
//     bay cap), and installing ADDS the piece without evicting a sibling. So
//     applyHypotheticalInstall APPENDS the candidate, exactly as fitEquipment does. This
//     is why the preview for a weapon reads as "+1 gun", the real result of pressing
//     Install (a "Swap" onto a FULL loadout is blocked by canFitEquipment, uninstall
//     first, so the preview never has to model an eviction the install would not do).
// The `target` parameter carries which hardpoint / bay the flow opened on so the caller
// can pin the INSTALLED banner to it; it does NOT change the gear MATH (a MULTI install
// always appends, and the readout is position-agnostic), but it keeps the API honest to
// the flow's intent and lets a future position-aware install slot in without a reshape.
//
// PURE: every function reads its inputs and returns fresh values, mutating NOTHING (no
// GameState write, no input-array mutation). Node-testable, no DOM, no Svelte.
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
// ============================================================================

import type { EquipmentInstance, GameState, ShipTypeDef } from "./model";
import { SHIP_TYPES } from "./model";
import { equippedFor } from "./equipment";
import { computeCombatReadout, type CombatReadout } from "./combatFit";
import {
  shipToCombatant,
  combatHullTypeOf,
  type CombatHullType,
  type CombatShipStats,
} from "./combat/bridge";
import { battleRating } from "./combat/rating";

// ----------------------------------------------------------------------------
// InstallTarget: which slot / hardpoint / bay the install flow opened on
// ----------------------------------------------------------------------------
// A discriminated union mirroring the panel's three mutually-exclusive selections:
//   slot       , a SINGLETON slot (an economy slot, or a shield / plating combat slot).
//                The candidate's own slotType names which slot; there is nothing more to
//                carry, so this variant holds no index.
//   hardpoint  , a 0-based WEAPON hardpoint index (weapons are a MULTI slot).
//   bay        , a 0-based DRONE BAY index (drone pods are a MULTI slot).
// Only the MULTI variants carry an index, and that index is used ONLY to pin the
// INSTALLED banner to the tapped cell, never to change the gear math (see the header).
export type InstallTarget =
  | { kind: "slot" }
  | { kind: "hardpoint"; index: number }
  | { kind: "bay"; index: number };

// The MULTI slot types: a hull holds more than one of these at once, so installing ADDS
// (does not evict a sibling). Every other installable slotType is a SINGLETON (install
// replaces the occupant). Kept in lockstep with equipment.ts MULTI_SLOT_TYPES so the two
// can never disagree about which slots add vs replace.
const MULTI_SLOT_TYPES: ReadonlySet<EquipmentInstance["slotType"]> = new Set<
  EquipmentInstance["slotType"]
>(["weapon", "droneBay"]);

// ----------------------------------------------------------------------------
// applyHypotheticalInstall: build the gear array a real install would produce
// ----------------------------------------------------------------------------
// Return a NEW EquipmentInstance[] representing `currentGear` with `candidate` installed,
// WITHOUT mutating the input and WITHOUT touching any GameState. The result is the exact
// set of pieces equippedFor() would return after fitEquipment(state, shipId, candidate.id):
//   - SINGLETON candidate slot: drop any current piece of the SAME slotType (the evicted
//     occupant) and append the candidate. A slot that was empty simply gains the candidate.
//   - MULTI candidate slot (weapon / droneBay): append the candidate, evicting nothing (the
//     hull fills its hardpoints / bays one piece at a time; the cap is the caller's gate).
// The candidate is appended LAST. Readout / rating are order-independent (they filter by
// slotType and sum), so the append position never changes the previewed numbers; it just
// gives a deterministic, easy-to-reason-about array.
//
// DUPE GUARD: if the candidate id is somehow already present in currentGear (a stale caller
// passing a fitted piece as the candidate), it is dropped from the base before appending so
// the piece appears exactly once, mirroring fitEquipment's `id !== instanceId` no-op guard.
// `target` is accepted for API symmetry with the flow (which hardpoint / bay was tapped);
// the gear math does not branch on the index (see the header), only on singleton-vs-multi.
export function applyHypotheticalInstall(
  currentGear: EquipmentInstance[],
  candidate: EquipmentInstance,
  target: InstallTarget,
): EquipmentInstance[] {
  // Void-read the target so the parameter is genuinely part of the signature (it documents
  // the flow's intent and is used by callers for banner pinning) without the gear math
  // depending on the index. Singleton-vs-multi is decided by the candidate's slotType, the
  // same authority fitEquipment uses, so the preview and the real install can never diverge.
  void target;

  const isMulti = MULTI_SLOT_TYPES.has(candidate.slotType);

  // Base = current gear minus (a) the candidate itself if already present (dupe guard) and,
  // for a SINGLETON, (b) any existing occupant of the candidate's slot (the evicted piece).
  const base = currentGear.filter((piece) => {
    if (piece.id === candidate.id) return false; // dupe guard (fitEquipment no-op equivalent)
    if (!isMulti && piece.slotType === candidate.slotType) return false; // singleton eviction
    return true;
  });

  return [...base, candidate];
}

// ----------------------------------------------------------------------------
// LoadoutReadout: the two numbers the compare view reads for a gear array
// ----------------------------------------------------------------------------
// rating : the advisory Battle Rating for the ship flying this gear, scored through the
//          SAME shipToCombatant + battleRating path the install panel and the dispatch
//          card use (so the compare's BR equals every other BR the game shows).
// combat : the folded combat readout (hull / shield / recharge totals, mounted weapons +
//          pods, still-empty required slots), from the SAME computeCombatReadout the live
//          board renders. The compare view diffs two of these for the per-stat rows.
export interface LoadoutReadout {
  rating: number;
  combat: CombatReadout;
}

// ----------------------------------------------------------------------------
// readoutFor: fold one gear array into its LoadoutReadout
// ----------------------------------------------------------------------------
// Score `gear` for the given hull. `shipDef` is the hull's SHIP_TYPES entry (it satisfies
// both battleRating's CombatShipStats slice and computeCombatReadout's stats input);
// `hullType` is the hull's combat class (drives the Combatant's weapon / drone build);
// `hardpointCap` / `droneBayCap` are SHIP_TYPES[hull].weaponHardpoints / .droneBays. Reuses
// the real pure fold fns verbatim, so the preview can never drift from the real install.
// PURE.
export function readoutFor(
  gear: EquipmentInstance[],
  shipDef: CombatShipStats,
  hullType: CombatHullType,
  hardpointCap: number,
  droneBayCap: number,
): LoadoutReadout {
  const rating = battleRating(
    shipToCombatant({
      // A stable throwaway id: nothing is fought here, we only read the folded rating.
      id: "loadout-preview",
      team: "player",
      stats: shipDef,
      hullType,
      installedGear: gear,
    }),
  );
  const combat = computeCombatReadout(gear, shipDef, hardpointCap, droneBayCap);
  return { rating, combat };
}

// ----------------------------------------------------------------------------
// StatDelta: one labelled current -> candidate comparison row
// ----------------------------------------------------------------------------
// A single combat-readout stat the compare view can render as "current -> candidate
// (+delta)". `delta` is candidate - current (positive == the candidate is higher on that
// stat). All the combat stats here are "higher is better" (more hull / shield / recharge /
// weapons), so the caller colors a positive delta green and a negative one red. Economy
// stats (cargo / FTL / etc.) are NOT included here: they fold through shipDerivedStats,
// not the combat readout, so the panel derives those rows directly from shipDerivedStats
// over the hypothetical gear array (this helper owns only the combat side, which is the
// load-bearing no-drift surface).
export interface StatDelta {
  key: string;
  label: string;
  current: number;
  candidate: number;
  delta: number;
}

// The combat-readout stats the compare surfaces, in display order. Each reads one numeric
// field off a CombatReadout. Kept as data (Omega 9: rule-based, readable) so adding a row
// is a one-line edit and the list is obviously exhaustive of what the compare shows.
const COMBAT_STAT_ROWS: ReadonlyArray<{ key: string; label: string; read: (r: CombatReadout) => number }> = [
  { key: "hullTotal", label: "Hull integrity", read: (r) => r.hullTotal },
  { key: "shieldTotal", label: "Shield capacity", read: (r) => r.shieldTotal },
  { key: "rechargeTotal", label: "Shield recharge", read: (r) => r.rechargeTotal },
  { key: "ablativeArmor", label: "Ablative armor", read: (r) => r.ablativeArmor },
  { key: "weaponsMounted", label: "Weapons mounted", read: (r) => r.mountedWeapons.length },
  { key: "podsMounted", label: "Drone pods", read: (r) => r.mountedPods.length },
];

// ----------------------------------------------------------------------------
// InstallComparison: the whole current-vs-candidate result
// ----------------------------------------------------------------------------
// current    : the LoadoutReadout for the ship as it is fitted now.
// candidate  : the LoadoutReadout for the ship with the candidate installed.
// netRating  : candidate.rating - current.rating (the headline "+68 BR" / "-22 BR").
// statDeltas : one COMBAT_STAT_ROWS entry per combat stat, current -> candidate.
export interface InstallComparison {
  current: LoadoutReadout;
  candidate: LoadoutReadout;
  netRating: number;
  statDeltas: StatDelta[];
}

// ----------------------------------------------------------------------------
// compareInstall: the state-level convenience the flow can call with (state, ship, spare)
// ----------------------------------------------------------------------------
// Read the ship + its current gear off `state`, apply the hypothetical install, and return
// the full current-vs-candidate comparison. A convenience over
// applyHypotheticalInstall + readoutFor for a caller that has only the GameState (the panel
// already holds the reactive gear / hull in scope and can call the finer fns directly, but
// other consumers, and the tests, want a one-call entry point). Returns null when the ship
// or its hull cannot be resolved (a stale id / corrupt typeKey), so the caller renders a
// safe empty state instead of throwing. PURE (reads state, mutates nothing).
export function compareInstall(
  state: GameState,
  shipId: string,
  candidate: EquipmentInstance,
  target: InstallTarget,
): InstallComparison | null {
  const ship = state.ships.find((s) => s.id === shipId) ?? null;
  if (ship === null) return null;

  const hullType = combatHullTypeOf(ship.typeKey);
  const shipDef: ShipTypeDef | undefined = SHIP_TYPES[ship.typeKey];
  // Both are needed to fold the combat readout + rating; a corrupt hull that resolves to
  // neither degrades to null (no comparison) rather than crashing the flow.
  if (hullType === null || shipDef === undefined) return null;

  const hardpointCap = shipDef.weaponHardpoints;
  const droneBayCap = shipDef.droneBays ?? 0;

  const currentGear = equippedFor(state, shipId);
  const candidateGear = applyHypotheticalInstall(currentGear, candidate, target);

  const current = readoutFor(currentGear, shipDef, hullType, hardpointCap, droneBayCap);
  const candidateReadout = readoutFor(candidateGear, shipDef, hullType, hardpointCap, droneBayCap);

  const statDeltas: StatDelta[] = COMBAT_STAT_ROWS.map((row) => {
    const cur = row.read(current.combat);
    const cand = row.read(candidateReadout.combat);
    return { key: row.key, label: row.label, current: cur, candidate: cand, delta: cand - cur };
  });

  return {
    current,
    candidate: candidateReadout,
    netRating: candidateReadout.rating - current.rating,
    statDeltas,
  };
}
