// ============================================================================
// Derived SALVAGE RESERVATIONS (Crafting 0.13.3, Phase 2 Unit 2.1)
// Author: Scythrael (via Claude) | 2026-09-01
// Design: docs/plans/2026-09-01-crafting-0.13.3-design.md section 7.3
// Plan:   docs/plans/2026-09-01-crafting-0.13.3-plan.md (Phase 2, Unit 2.1)
//
// WHY THIS EXISTS
//   Every other timed process deducts its inputs at START, which is what closes the
//   double-spend window (startProcess's header is explicit about that being its only
//   reason). Salvage deliberately deviates: it consumes AND rewards atomically at
//   COMPLETION, because splitting the three proven salvage functions into a consume
//   half and a reward half would mean inventing a serializable snapshot payload for
//   each and carrying it through the save (a large amount of surgery on working code,
//   Omega 15a). This module closes the SAME window a different way: while a salvage
//   order is queued (and, from Unit 2.2 on, while its job is in flight) its target is
//   RESERVED, so nothing else may consume it.
//
// DERIVED, NEVER STORED. The reservation set is recomputed from state.processQueue on
// every read, exactly the way allocation.ts's allocatedItem is recomputed from the
// active craft lines. There is no second ledger, so there is nothing that can drift
// out of sync with the queue, and cancelling an order releases its reservation with no
// unwind step (removeQueuedOrder drops the entry and the reservation simply stops
// being derived).
//
// WHY ITS OWN MODULE AND NOT salvage.ts (the file the build plan named):
//   salvage.ts already imports onMissionLock FROM equipment.ts (one source of truth for
//   the "this hull's captain is flying" lock). canFitEquipment lives in equipment.ts and
//   is the seam that has to consult the reservation (design risk 4), so putting these
//   helpers in salvage.ts would make equipment.ts import salvage.ts and create an
//   equipment <-> salvage import CYCLE. A leaf module both can depend on keeps the graph
//   a DAG. salvage.ts RE-EXPORTS all four helpers, so the public surface the plan
//   documented ("import it from salvage.ts") is still true.
//   The file name deliberately avoids the substring "./salvage" so that tick.ts can
//   import it without tripping salvage.test.ts's load-bearing source-grep guard (which
//   asserts tick.ts contains no "./salvage" import while salvage is still live-only).
//
// TYPE-ONLY IMPORTS ON PURPOSE: this module pulls in no runtime value from anywhere, so
// it can never participate in an import cycle no matter who consumes it later.
//
// Contents (core -> accessors -> predicate):
//   SalvageReservations          the one-pass result shape (all three target arms)
//   salvageReservations          THE single pass over the queue; call this once per render
//   salvageReservedInstanceIds   accessor: equipment instance ids spoken for
//   salvageReservedShipIds       accessor: hull ids spoken for
//   salvageReservedMaterialCount accessor: how many units of one salvaged material are spoken for
//   isDuplicateSalvageTarget     the enqueue-time "already queued" predicate
// ============================================================================

import type { GameState, SalvageTargetRef } from "./model";

// ----------------------------------------------------------------------------
// SalvageReservations
// ----------------------------------------------------------------------------
// One shape carrying all three SalvageTargetRef arms, because they need three
// different containers and a caller usually wants more than one of them:
//   instanceIds     a Set: an EquipmentInstance is UNIQUE, so it is either spoken for
//                   or it is not. Membership is the whole question.
//   shipIds         a Set for the same reason: a hull is unique.
//   materialCounts  a Map itemId -> COUNT, because a salvaged material is FUNGIBLE.
//                   Holding five Damaged Reactor Housings and queueing three salvages
//                   is legitimate, so the useful question is "how many units are
//                   already spoken for" (free = held - queued, design section 7.3),
//                   not "is this item id present".
// Every container is freshly allocated per call; nothing here is shared or cached.
export interface SalvageReservations {
  instanceIds: Set<string>;
  shipIds: Set<string>;
  materialCounts: Map<string, number>;
}

// ----------------------------------------------------------------------------
// salvageReservations
// ----------------------------------------------------------------------------
// THE single pass. Walks state.processQueue once and bins every salvage order's target
// by arm.
//
// ⚠️ CALL THIS ONCE, NOT PER TILE. The three accessors below are thin wrappers that
// each re-run this pass, which is correct but linear in the queue; a Salvage Bay grid
// rendering dozens of material tiles should call salvageReservations(state) ONE time
// and read the returned containers, the same "one pass, indexed" posture
// craftQueue.ts's runningRowsFor takes over activeProcesses.
//
// ⚠️ IN-FLIGHT JOBS ARE NOT SCANNED YET, AND THAT IS NOT AN OVERSIGHT. Design section
// 7.3 defines the reserved set as "queued OR in flight", but the "salvageJob"
// TimedProcessKind and the { type: "salvageResolve"; target } ProcessEffect do not
// exist until Unit 2.2, so there is literally no in-flight salvage to enumerate and no
// effect arm to narrow on (a `effect.type === "salvageResolve"` comparison against
// today's ProcessEffect union is a compile error, not a no-op). THE EXTENSION POINT IS
// MARKED BELOW: Unit 2.2/2.4 adds a second loop over state.activeProcesses that feeds
// the SAME three bins, and every consumer of this module then picks the in-flight case
// up for free. Landing the guard one unit before the thing it guards is deliberate
// (build plan Unit 2.1, "the guard exists before the thing it guards"): until 2.2 lands
// both loops would return the same empty result anyway.
//
// PURE: reads state, allocates fresh containers, mutates nothing.
export function salvageReservations(state: GameState): SalvageReservations {
  const instanceIds = new Set<string>();
  const shipIds = new Set<string>();
  const materialCounts = new Map<string, number>();

  // `?? []` mirrors every other processQueue reader (queuedForFacility, removeQueuedOrder):
  // the field is additive as of SAVE_VERSION 40, and a state object built by an older
  // fixture can legitimately not carry it.
  for (const job of state.processQueue ?? []) {
    // Only salvage orders reserve anything. A queued craftLine order reserves NOTHING by
    // design (section 5.3: material allocation stays derived from ACTIVE lines only), so
    // it is skipped here rather than folded in.
    if (job.order.type !== "salvage") continue;
    bin(job.order.target, instanceIds, shipIds, materialCounts);
  }

  // --- EXTENSION POINT (Unit 2.2 / 2.4) -------------------------------------
  // for (const process of state.activeProcesses) {
  //   if (process.effect.type === "salvageResolve") bin(process.effect.target, ...);
  // }
  // Add it HERE, feeding the same bin() helper, and nothing downstream changes.

  return { instanceIds, shipIds, materialCounts };
}

// Files one target into the right bin. Factored out (rather than inlined in the loop)
// precisely so the in-flight loop above can reuse it verbatim when Unit 2.2 lands, which
// is what guarantees a queued and an in-flight salvage reserve IDENTICALLY.
//
// The switch is EXHAUSTIVE over SalvageTargetRef's three arms with no default branch, so
// adding a fourth arm to the union is a COMPILE ERROR here rather than a target that
// silently reserves nothing (the same trick QUEUE_ADAPTERS' Record uses).
function bin(
  target: SalvageTargetRef,
  instanceIds: Set<string>,
  shipIds: Set<string>,
  materialCounts: Map<string, number>
): void {
  switch (target.kind) {
    case "equipment":
      // A Set DEDUPES for free. Two queued orders on one instance is refused at enqueue
      // (isDuplicateSalvageTarget), but a hand-edited save could still present it, and a
      // unique thing must count once however it got here.
      instanceIds.add(target.instanceId);
      return;
    case "ship":
      shipIds.add(target.shipId);
      return;
    case "material":
      // Fungible: ACCUMULATE. Three queued salvages of one material id reserve three
      // units, which is what makes "Held: N (M queued)" honest.
      materialCounts.set(target.itemId, (materialCounts.get(target.itemId) ?? 0) + 1);
      return;
  }
}

// ----------------------------------------------------------------------------
// Accessors (the names design section 7.3 declared)
// ----------------------------------------------------------------------------
// Every equipment instance id currently spoken for by a queued (later: in-flight)
// salvage. This is the set canFitEquipment consults so a reserved piece cannot be
// installed out from under its job, and the set the Phase 4 Salvage Bay / Ships tiles
// read to render the "queued for salvage" marker.
export function salvageReservedInstanceIds(state: GameState): Set<string> {
  return salvageReservations(state).instanceIds;
}

// Every hull id currently spoken for by a queued (later: in-flight) teardown. Exported
// for the Phase 4 Docks / Ships readouts and for the enqueue duplicate check; the fit
// gate deliberately does NOT consult it (see isDuplicateSalvageTarget's header).
export function salvageReservedShipIds(state: GameState): Set<string> {
  return salvageReservations(state).shipIds;
}

// How many UNITS of one salvaged material are already spoken for. The Salvage Bay tile
// renders `Held: N (M queued)` from this, with free = held - queued (design 7.3), the
// same reservation-aware stock idiom the warehouse already uses for allocated materials.
// Zero for an item with nothing queued (never undefined, so callers can subtract it
// unconditionally).
export function salvageReservedMaterialCount(state: GameState, itemId: string): number {
  return salvageReservations(state).materialCounts.get(itemId) ?? 0;
}

// ----------------------------------------------------------------------------
// isDuplicateSalvageTarget
// ----------------------------------------------------------------------------
// "Is this exact target ALREADY queued?" The enqueue gate's question, and the reason
// design section 7.3 says a reserved instance cannot be queued twice.
//
// ⚠️ THE MATERIAL ARM ALWAYS ANSWERS FALSE, DELIBERATELY. Two rules meet here and only
// one reading satisfies both:
//   - A UNIQUE target (an equipment instance, a hull) queued twice is a guaranteed dead
//     entry: the first order consumes it and the second can only ever resolve as a stale
//     no-op, occupying a depth slot that shows a block reason no player action can clear.
//     Refusing it at enqueue is the honest answer.
//   - A FUNGIBLE salvaged material is different: queueing three salvages while holding
//     one is exactly the "queue work you cannot afford yet" case the queue exists to
//     serve, and canEnqueueOrder's header states plainly that affordability is NEVER an
//     enqueue gate (design section 5.3). Blocking the second material order would be an
//     affordability check wearing a duplicate check's clothes. The bound is applied at
//     PROMOTION instead, where canStartSalvage (Unit 2.3) refuses with the existing
//     `noneHeld` reason and the order simply waits, so no double-consume is possible
//     either way.
//
// PURE predicate, spends nothing, same posture as canEnqueueOrder / canStartLine.
export function isDuplicateSalvageTarget(state: GameState, target: SalvageTargetRef): boolean {
  const reserved = salvageReservations(state);
  switch (target.kind) {
    case "equipment":
      return reserved.instanceIds.has(target.instanceId);
    case "ship":
      return reserved.shipIds.has(target.shipId);
    case "material":
      return false; // fungible, bounded at promotion, see the header above
  }
}
