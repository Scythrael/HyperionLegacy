// HOMEWORLD RESERVE (user 2026-11-12, "Homeworld reserve (Recommended)"; docs/plans/2026-10-14-complement-and-acquisition-plan.md
// "USER ANSWERS (2026-11-12)"): surplus crew move out of the unassigned pool into a "Homeworld reserve" list, the same
// crew groups with their ranks and racials, shown as a count on the Crew Pool tab, ready for homeworld staffing when it
// is designed (SUGGESTIONS.md "CRAFT-DUPLICATE CREW BUFF": NOT built; nothing here staffs, buffs or defends anything).
//
// SURPLUS, with no new tuning constant: after the normal fill of every tick (crewOverlay.ts resolveCrew; memoized per
// pool list, so an idle pool is not re-scanned), each pool group keeps as many crew as the berths of the whole fleet could still seat of its
// division and rank, and the rest moves to the reserve. "The berths of the whole fleet" is every ship: passive ones
// (already filled, so their room is what the caps leave), passive ones crew-locked while out on a run (they fill when
// home), and manual ("active") ones, whose open berths the player fills by hand from the pool. The kept count is the SUM
// of each ship's own room for that division and rank (commandStructure.ts remainingCapacityForSignature, the filler's
// own reader, with the ship's assigned notables and its quarters bonus), so every seating the pool allowed before the
// sweep is still possible after it: no berth ever finds fewer of a group in the pool than it could take. With every
// berth in the fleet full, the whole leftover moves and the pool stays empty. A transport is the usual source; crew
// landing in the pool any other way (a salvage, a send back) with no berth for them move at the next tick too. WHY every
// fill and not only a transport: a big economyTick call that crosses a window AND a ship's return sweeps once, after
// both, while 1 s steps would sweep at the window, before the return; sweeping after every fill makes the split the
// same however the time is cut (cp16HallOfCommand.test.ts's short-range relic run is that case).
//
// REFILL: a passive ship fills from the pool first, then from the reserve with the same filler (autoCrewShip:
// top-rank-down, lean divisions first, the reserve's group order), so the reserve is never a loss. A Personnel roster's
// bulk fill (personnelRosters.ts applyRoster) draws the same way. Nothing moves crew from the reserve back to the pool.
//
// ORDER: CANONICAL (the canonicalOrder.ts rule): whenever the sweep adds to the reserve, the list is put in signature
// key order (code unit order), because a big call meets the groups in another order than 1 s steps do (one sweep of a
// day's pool against one sweep per window). Draws only remove, so the order holds. One call, 997 s chunks and 1 s steps
// leave the same list (homeworldReserveGoldens.test.ts).
//
// SAVES: the field is optional and never written empty, so a save that never had a surplus is byte-identical (no
// SAVE_VERSION bump). An existing save's pool is NOT touched at load: the engine moves its surplus at the first tick
// after (deterministic, by the same rule as every later tick), and a crewmember any berth could take never moves.
// withHomeworldReserveOnLoad (save.ts migrate, every load) only drops a malformed or empty field.

import type { CrewBucket, GameState, ShipInstance } from "./model";
import { coalesceBuckets, notableSignature, signatureKey, totalCrew } from "./crew";
import { HULL_CREW_CAPS_SWITCH, complementTotalCap, remainingCapacityForSignature } from "./commandStructure";
import { quartersCapacityBonus } from "./crewModules";

// The test-only switch golden files use to prove what the slice moved (homeworldReserveSwitch.fixture.ts). OFF: no sweep
// and no reserve draw, the game before the reserve exactly.
export const HOMEWORLD_RESERVE_SWITCH = { live: true };

// The ONE empty reserve (frozen, shared): resolveCrew's perf memo compares the reserve by reference, so an absent reserve
// must read as the same list on every tick (a fresh [] would miss the memo every time).
export const NO_RESERVE: CrewBucket[] = Object.freeze([]) as unknown as CrewBucket[];

// The reserve's crew groups (NO_RESERVE when the field is absent). Pure.
export function homeworldReserveOf(state: Pick<GameState, "homeworldReserve">): CrewBucket[] {
  return Array.isArray(state.homeworldReserve) && state.homeworldReserve.length > 0 ? state.homeworldReserve : NO_RESERVE;
}

// The reserve's headcount (the Crew Pool tab's count). Pure.
export function homeworldReserveCount(state: Pick<GameState, "homeworldReserve">): number {
  return totalCrew(homeworldReserveOf(state));
}

// `state` with `reserve` written: the key is left out when the list is empty (never written empty). Pure.
export function withHomeworldReserve(state: GameState, reserve: CrewBucket[]): GameState {
  if (reserve.length > 0) return { ...state, homeworldReserve: reserve };
  if (state.homeworldReserve === undefined) return state;
  const { homeworldReserve: _gone, ...rest } = state;
  return rest as GameState;
}

// One ship's occupancy as the filler sees it: its bulk plus one slot per assigned notable (the resolveCrew rule).
function seatedComplement(state: GameState, ship: ShipInstance): { buckets: CrewBucket[]; mode: "passive" | "active" } {
  const bulk = ship.complement?.buckets ?? [];
  const mode = ship.complement?.mode ?? "passive";
  const notables = state.notableCrew.filter((n) => (n.assignedShipId ?? null) === ship.id);
  if (notables.length === 0) return { buckets: bulk, mode };
  return { buckets: coalesceBuckets([...bulk, ...notables.map((n) => ({ ...notableSignature(n), count: 1 }))]), mode };
}

// Move the surplus of `pool` into `reserve` (see the module header): each group keeps min(count, the fleet's room for its
// division and rank), the rest is added to the reserve. Returns the SAME two lists when nothing moves. `state` supplies
// the ships (their complements as they stand after this tick's fill), the notables and the quarters bonuses. Pure.
export function sweepSurplusToReserve(
  state: GameState,
  pool: CrewBucket[],
  reserve: CrewBucket[],
): { pool: CrewBucket[]; reserve: CrewBucket[] } {
  if (pool.length === 0) return { pool, reserve };
  // A pool already swept against the same ships, notables, gear and caps keeps everything (nothing it holds moved then,
  // and nothing the room reads has changed since): skip the scan.
  const memo = SWEPT.get(pool);
  if (memo !== undefined && memo.ships === state.ships && memo.notables === state.notableCrew && memo.equipment === state.equipment && memo.caps === HULL_CREW_CAPS_SWITCH.live) {
    return { pool, reserve };
  }
  const out = sweepUncached(state, pool, reserve);
  SWEPT.set(out.pool, { ships: state.ships, notables: state.notableCrew, equipment: state.equipment, caps: HULL_CREW_CAPS_SWITCH.live });
  return out;
}

// The sweep's memo (weakly, by pool list; never saved): what the room was read from when that pool was swept.
const SWEPT = new WeakMap<CrewBucket[], { ships: GameState["ships"]; notables: GameState["notableCrew"]; equipment: GameState["equipment"]; caps: boolean }>();

function sweepUncached(
  state: GameState,
  pool: CrewBucket[],
  reserve: CrewBucket[],
): { pool: CrewBucket[]; reserve: CrewBucket[] } {
  // Every ship that has any berth open, with its occupancy and bonus (a ship at its total has room for no one).
  const open: { ship: ShipInstance; complement: { buckets: CrewBucket[]; mode: "passive" | "active" }; bonus: number }[] = [];
  for (const ship of state.ships) {
    const complement = seatedComplement(state, ship);
    const bonus = quartersCapacityBonus(state, ship);
    if (totalCrew(complement.buckets) >= complementTotalCap(ship.typeKey, bonus)) continue;
    open.push({ ship, complement, bonus });
  }
  // The fleet's room for a division and rank (room depends on nothing else of a signature), memoized for this sweep.
  const roomByKey = new Map<string, number>();
  const fleetRoom = (b: CrewBucket): number => {
    const key = `${b.profession}|${b.rank}`;
    const known = roomByKey.get(key);
    if (known !== undefined) return known;
    let room = 0;
    for (const o of open) room += Math.max(0, remainingCapacityForSignature(o.complement, o.ship.typeKey, b, o.bonus));
    roomByKey.set(key, room);
    return room;
  };
  let nextPool: CrewBucket[] | null = null;
  let nextReserve: CrewBucket[] | null = null;
  let reserveIndex: Map<string, number> | null = null;
  for (let i = 0; i < pool.length; i += 1) {
    const b = pool[i];
    const keep = Math.min(b.count, fleetRoom(b));
    const move = b.count - keep;
    if (move <= 0) {
      if (nextPool) nextPool.push(b);
      continue;
    }
    if (!nextPool) nextPool = pool.slice(0, i);
    if (keep > 0) nextPool.push({ ...b, count: keep });
    if (!nextReserve || !reserveIndex) {
      nextReserve = reserve.map((r) => ({ ...r }));
      reserveIndex = new Map();
      for (let j = 0; j < nextReserve.length; j += 1) {
        const k = signatureKey(nextReserve[j]);
        if (!reserveIndex.has(k)) reserveIndex.set(k, j);
      }
    }
    const k = signatureKey(b);
    const at = reserveIndex.get(k);
    if (at === undefined) {
      reserveIndex.set(k, nextReserve.length);
      nextReserve.push({ ...b, count: move });
    } else {
      nextReserve[at].count += move;
    }
  }
  if (!nextPool || !nextReserve) return { pool, reserve };
  // Canonical order (signature key, code unit order), so the list is the same however the time was cut.
  const keyed = nextReserve.map((b) => ({ b, k: signatureKey(b) }));
  keyed.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  return { pool: nextPool, reserve: keyed.map((e) => e.b) };
}

// Every-load normalizer (save.ts migrate; the withHomeworldV70 every-load posture): a well-formed reserve is kept (the
// SAME state); an empty, malformed or non-list field is dropped, and a group with no positive whole count is left out.
// No SAVE_VERSION bump: a save without the field is untouched.
export function withHomeworldReserveOnLoad(state: any): any {
  if (!state || typeof state !== "object" || !("homeworldReserve" in state)) return state;
  const raw = state.homeworldReserve;
  const valid = (b: any): boolean => !!b && typeof b === "object" && typeof b.profession === "string" && Number.isInteger(b.count) && b.count > 0;
  if (Array.isArray(raw) && raw.length > 0 && raw.every(valid)) return state;
  const kept = Array.isArray(raw) ? raw.filter(valid) : [];
  const { homeworldReserve: _gone, ...rest } = state;
  return kept.length > 0 ? { ...rest, homeworldReserve: kept } : rest;
}
