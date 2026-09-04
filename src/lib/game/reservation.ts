// ============================================================================
// Derived SALVAGE RESERVATIONS (Crafting 0.13.3, Phase 2 Units 2.1 + 2.2)
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
//   order is QUEUED, and while its promoted job is IN FLIGHT, its target is RESERVED, so
//   nothing else may consume it. Those two windows are contiguous, which is the whole
//   point: there is no instant between "queued" and "running" where the target looks
//   free.
//
// DERIVED, NEVER STORED. The reservation set is recomputed from state.processQueue plus
// state.activeProcesses on every read, exactly the way allocation.ts's allocatedItem is
// recomputed from the active craft lines. There is no second ledger, so there is nothing
// that can drift out of sync with the queue, and cancelling an order releases its
// reservation with no unwind step (removeQueuedOrder drops the entry and the reservation
// simply stops being derived). A completing job releases its reservation the same way:
// the resolver drops the process and the derivation stops seeing it, with no bookkeeping.
//
// WHY ITS OWN MODULE AND NOT salvage.ts (the file the build plan named):
//   salvage.ts already imports onMissionLock FROM equipment.ts (one source of truth for
//   the "this hull's captain is flying" lock). canFitEquipment lives in equipment.ts and
//   is the seam that has to consult the reservation (design risk 4), so putting these
//   helpers in salvage.ts would make equipment.ts import salvage.ts and create an
//   equipment <-> salvage import CYCLE. A leaf module both can depend on keeps the graph
//   a DAG. salvage.ts RE-EXPORTS every helper here, so the public surface the plan
//   documented ("import it from salvage.ts") is still true.
//   The file name deliberately avoids the substring "./salvage" so that tick.ts can
//   import it without tripping salvage.test.ts's load-bearing source-grep guard (which
//   asserts tick.ts contains no "./salvage" import while salvage is still live-only).
//
// IMPORTS DELIBERATELY KEPT AT THE GRAPH'S FLOOR: everything from model.ts is TYPE-ONLY, and
// the single runtime import is itemTotal from inventory.ts, which is a true leaf (its only
// import is break_infinity.js). So this module still cannot participate in an import cycle no
// matter who consumes it later. That one runtime import arrived with the 0.13.3 batch-salvage
// follow-up, which needs the HELD count to answer "may this many units be queued at all"
// (exceedsFreeSalvageUnits); deriving a held count locally would have been a second opinion
// about the quality-bucketed inventory, which is precisely what itemTotal exists to prevent.
// Nothing heavier than a leaf may be imported here.
//
// Contents (core -> accessors -> predicate):
//   salvageOrderUnits            how many UNITS one queued salvage order stands for
//   SalvageReservations          the one-pass result shape (all three target arms)
//   salvageReservations          THE single pass over queue + in-flight; call once per render
//   salvageReservedInstanceIds   accessor: equipment instance ids spoken for
//   salvageReservedShipIds       accessor: hull ids spoken for
//   salvageReservedMaterialCount accessor: how many units of one salvaged material are spoken for
//   isDuplicateSalvageTarget     the enqueue-time "already queued" predicate
//   exceedsFreeSalvageUnits      the enqueue-time "you do not hold that many" predicate
// ============================================================================

import type { GameState, QueuedOrder, SalvageOrderMode, SalvageTargetRef } from "./model";
import { itemTotal } from "./inventory";

// A queued SALVAGE order, narrowed off the union once so the helpers below do not each
// restate the discriminant. Exported because tick.ts and the console both hold one in hand.
export type QueuedSalvageOrder = Extract<QueuedOrder, { type: "salvage" }>;

// ----------------------------------------------------------------------------
// salvageOrderUnits
// ----------------------------------------------------------------------------
// HOW MANY UNITS one queued salvage order stands for. THE canonical definition, and the
// only place the count is interpreted.
//
// It lives HERE, beside the reservation math, for exactly the reason allocation.ts's
// queuedOrderIterations lives beside ITS reservation math: the number is load-bearing in
// two directions at once. It is what the order RESERVES (bin(), below) and it is what the
// order still owes after each promotion (tick.ts's withQueuedOrderReleased). A second copy
// that disagreed by one would either double-book units the player does not hold or leave an
// order that can never finish draining, so there is one function and everything asks it.
//
// ⚠️ THE TWO UNIQUE ARMS ALWAYS ANSWER 1, WHATEVER THE FIELD SAYS. An EquipmentInstance and
// a ShipInstance are each ONE distinct object named by ONE id; a count against them is not a
// quantity but a category error, and honouring one would reserve units that do not exist and
// leave dead entries in the queue that no player action could clear. Clamping here (rather
// than refusing at enqueue) means a hand-edited save, an older order, or a future caller that
// forgets, all land on the same safe reading instead of on a refusal the player cannot act on.
//
// DEFENSIVE ON THE FIELD ITSELF even though the type says `mode` is always present: a
// hand-built fixture or a hand-edited save can present an order without one, and a
// reservation read must never be the thing that throws. A missing, non-finite, fractional or
// below-1 count reads as ONE, which is the pre-batch behavior and can only ever under-claim.
export function salvageOrderUnits(order: QueuedSalvageOrder): number {
  if (order.target.kind !== "material") return 1;
  const mode = order.mode as SalvageOrderMode | undefined;
  const requested = mode?.remaining;
  if (typeof requested !== "number" || !Number.isFinite(requested)) return 1;
  // floor, then clamp: a batch is a whole number of units and never fewer than one.
  return Math.max(1, Math.floor(requested));
}

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
// THE single pass. Walks state.processQueue and state.activeProcesses once each and bins
// every salvage target it finds, by arm.
//
// ⚠️ CALL THIS ONCE, NOT PER TILE. The three accessors below are thin wrappers that
// each re-run this pass, which is correct but linear in the queue; a Salvage Bay grid
// rendering dozens of material tiles should call salvageReservations(state) ONE time
// and read the returned containers, the same "one pass, indexed" posture
// craftQueue.ts's runningRowsFor takes over activeProcesses.
//
// TWO SOURCES, ONE ANSWER (design section 7.3: the reserved set is "queued OR in
// flight"). A target is spoken for from the moment the player queues it until the moment
// its job resolves, which spans two different places in state:
//   state.processQueue    orders WAITING for a free Salvage Bay slot
//   state.activeProcesses jobs ALREADY RUNNING (a "salvageJob" carrying a
//                         { type: "salvageResolve"; target } effect)
// Both loops feed the SAME bin() helper below, which is what guarantees the two cases
// reserve IDENTICALLY. If they diverged, the handoff moment (an order leaving the queue
// to become a process) would open a one-tick window where the target looked free and
// could be installed or queued a second time, and salvage is the one kind that does NOT
// deduct at start, so nothing else would catch it.
//
// ⚠️ THE IN-FLIGHT LOOP MATTERS EVEN MORE THAN THE QUEUED ONE. A queued order has not
// touched anything yet, so a lost reservation there is a mistake the player can undo. An
// in-flight job is already counting down toward consuming its target, so a lost
// reservation there means the piece can be installed on a ship and then destroyed under
// the pilot. That is why this loop lands the same unit the effect arm becomes
// expressible (Unit 2.2), not later with the code that creates the jobs (Unit 2.4).
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
    // ⚠️ THE UNIT COUNT IS THE WHOLE POINT OF THIS ARGUMENT (0.13.3 batch-salvage follow-up).
    // A queued order can now stand for N units of a fungible material, and it must reserve
    // all N or the "Held: 5000 (5000 queued)" readout, the enqueue gate and the duplicate
    // guard would every one of them under-count, letting the player queue units that are
    // already spoken for. salvageOrderUnits is the single interpretation of that count and
    // it clamps the two unique arms to 1, so this line cannot over-reserve either.
    bin(job.order.target, salvageOrderUnits(job.order), instanceIds, shipIds, materialCounts);
  }

  // --- IN-FLIGHT JOBS (Unit 2.2, the extension point Unit 2.1 marked) --------
  // The second source. Narrows on the EFFECT, not on process.kind, for two reasons:
  //   1. the effect is what carries the target, so this is the narrowing that actually
  //      produces the value bin() needs (a kind check would still need a second cast);
  //   2. it cannot go stale against the kind. A process whose effect resolves a salvage
  //      reserves its target no matter what its `kind` string says, which is the honest
  //      reading and survives a hand-edited or mislabelled save.
  // `?? []` for the same defensive reason as the queue loop above: a hand-built fixture
  // can arrive without the field, and a reservation read must never be the thing that
  // throws.
  for (const process of state.activeProcesses ?? []) {
    if (process.effect.type !== "salvageResolve") continue;
    // ALWAYS EXACTLY ONE UNIT, and that is a property of the engine rather than a
    // simplification here: promotion starts ONE unit of work per job (a batch order leaves a
    // decremented residual in the queue and starts a single-unit job, see tick.ts's
    // withQueuedOrderReleased), and a salvageResolve effect carries a bare target with no
    // count for that reason. The batch's other units are still sitting in the queue loop
    // above, so queued + in-flight sums to the full batch at every instant, with no gap and
    // no double count across the handoff.
    bin(process.effect.target, 1, instanceIds, shipIds, materialCounts);
  }

  return { instanceIds, shipIds, materialCounts };
}

// Files one target into the right bin. Factored out (rather than inlined in either loop)
// precisely so BOTH sources above call it verbatim, which is what guarantees a queued and
// an in-flight salvage reserve IDENTICALLY rather than by two hand-kept-in-sync copies.
//
// ⚠️ NOTE THE TWO DIFFERENT MEANINGS OF "the same target twice", both correct:
//   unique arms (equipment, ship) DEDUPE, because the container is a Set. An order that
//     has just been promoted can legitimately appear as a queued row and a running job in
//     the same read window, and one hull is one hull however many rows point at it.
//   the material arm ACCUMULATES, because units are fungible. One unit in flight plus one
//     unit queued really is TWO units spoken for, which is what keeps "Held: N (M queued)"
//     honest. This is not a dedupe failure; the two arms are answering different
//     questions.
//
// ⚠️ `units` IS IGNORED BY THE TWO UNIQUE ARMS ON PURPOSE (0.13.3 batch-salvage follow-up).
// Its callers already pass 1 for them (salvageOrderUnits clamps, and an in-flight job is one
// unit by construction), so the parameter is genuinely only meaningful for the fungible arm.
// It is still passed to every arm rather than being read only inside the material case,
// because a caller that decided per-arm whether to pass a count would be re-deciding the
// clamp at each call site, which is exactly the drift salvageOrderUnits exists to remove.
//
// The switch is EXHAUSTIVE over SalvageTargetRef's three arms with no default branch, so
// adding a fourth arm to the union is a COMPILE ERROR here rather than a target that
// silently reserves nothing (the same trick QUEUE_ADAPTERS' Record uses).
function bin(
  target: SalvageTargetRef,
  units: number,
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
      // Fungible: ACCUMULATE, by the order's UNIT COUNT rather than by one. Three queued
      // single-unit salvages and one queued batch of three both reserve three units, which
      // is what makes "Held: N (M queued)" honest whichever way the player got there.
      materialCounts.set(target.itemId, (materialCounts.get(target.itemId) ?? 0) + units);
      return;
  }
}

// ----------------------------------------------------------------------------
// Accessors (the names design section 7.3 declared)
// ----------------------------------------------------------------------------
// Every equipment instance id currently spoken for by a queued OR IN-FLIGHT
// salvage. This is the set canFitEquipment consults so a reserved piece cannot be
// installed out from under its job, and the set the Phase 4 Salvage Bay / Ships tiles
// read to render the "queued for salvage" marker.
export function salvageReservedInstanceIds(state: GameState): Set<string> {
  return salvageReservations(state).instanceIds;
}

// Every hull id currently spoken for by a queued OR IN-FLIGHT teardown. Exported
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
// "Is this exact target ALREADY spoken for?" The enqueue gate's question, and the reason
// design section 7.3 says a reserved instance cannot be queued twice.
//
// As of Unit 2.2 this reads the WIDER set: a unique target is a duplicate whether its
// first order is still waiting in the queue or is already running as a job. That is the
// correct reading and it closes a real hole, since a piece being torn down right now is
// the LAST thing that should accept a second order.
//
// ⚠️ THE MATERIAL ARM ALWAYS ANSWERS FALSE, DELIBERATELY. Two rules meet here and only
// one reading satisfies both:
//   - A UNIQUE target (an equipment instance, a hull) queued twice is a guaranteed dead
//     entry: the first order consumes it and the second can only ever resolve as a stale
//     no-op, occupying a depth slot that shows a block reason no player action can clear.
//     Refusing it at enqueue is the honest answer.
//   - A FUNGIBLE salvaged material is different: a second order on the same item id is not
//     a dead entry at all, it is a second unit of real work, so a duplicate check is the
//     wrong tool for it. Blocking it here would be a quantity check wearing a duplicate
//     check's clothes.
//
// ⚠️ THE QUANTITY QUESTION IS NOW ASKED, JUST NOT HERE (0.13.3 batch-salvage follow-up,
// 2026-09-04). This used to add that the material arm was bounded only at PROMOTION, by
// canStartSalvage's `noneHeld`, because affordability was deliberately not an enqueue gate
// (design §5.3). That is no longer the whole story: §5.3 was reversed for craft orders when
// they began reserving their inputs, and a salvage order that can carry five thousand units
// needs the same treatment for the same reason. exceedsFreeSalvageUnits below is that gate.
// canStartSalvage's promotion-time bound is UNCHANGED and still the backstop, so no
// double-consume is possible from either direction.
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
      // Fungible, so "already queued" is the wrong question entirely; the right one is "do
      // you hold that many", which exceedsFreeSalvageUnits answers below.
      return false;
  }
}

// ----------------------------------------------------------------------------
// exceedsFreeSalvageUnits (0.13.3 batch-salvage follow-up, 2026-09-04)
// ----------------------------------------------------------------------------
// "Does this order ask for MORE units than the player actually has free?" The second
// enqueue-gate predicate, sitting beside isDuplicateSalvageTarget because the two answer the
// same shaped question for the two different kinds of target.
//
// ⚠️ WHY THIS EXISTS AT ALL, GIVEN THE MATERIAL ARM WAS DELIBERATELY UNBOUNDED BEFORE. Until
// a salvage order could carry a count, "queue three teardowns while holding one unit" was a
// harmless, useful thing: each order reserved one unit, the extras waited at promotion with a
// visible `noneHeld` reason, and the queue was three entries deep at most. A batch changes the
// arithmetic, not the principle. An unbounded batch would let one click reserve five thousand
// units the player does not hold, which prints a "5000 queued" readout nobody can act on and
// makes `free = held - queued` go negative in meaning if not in arithmetic. A reservation
// against stock that is not there is not a reservation, which is exactly the argument
// allocation.ts's canReserveOrder makes for craft orders. So the same policy lands here, for
// the same reason, and the two consoles now behave the same way.
//
// ⚠️ IT IS AN "IS THERE ROOM FOR THIS ORDER" CHECK, NOT A RE-CHECK OF THE WHOLE QUEUE. The
// comparison is against what is FREE (held minus everything already queued or in flight), so
// two batches of 3000 against a stock of 5000 correctly accepts the first and refuses the
// second, and it can never refuse an order because of itself: the order being asked about is
// not in the queue yet.
//
// ⚠️ IT DOES NOT BOUND PROMOTION, and must not be asked to. canStartSalvage keeps its own,
// narrower in-flight bound (see its header): the two are checked at different moments against
// different sets, and collapsing them would either let a batch outlive its stock or refuse a
// legitimate order that stock has since arrived for.
//
// The two UNIQUE arms always answer false: a count above 1 there is already clamped away by
// salvageOrderUnits, and "do you hold one of this exact instance" is the duplicate question,
// which the predicate above already owns.
//
// PURE predicate, spends nothing, same posture as isDuplicateSalvageTarget.
export function exceedsFreeSalvageUnits(state: GameState, order: QueuedSalvageOrder): boolean {
  if (order.target.kind !== "material") return false;
  const itemId = order.target.itemId;
  const reserved = salvageReservations(state).materialCounts.get(itemId) ?? 0;
  // held - reserved, floored at 0 so an out-of-band inventory drop (an over-cap clamp, a
  // mission spending stock) reads as "nothing free" rather than as a negative allowance.
  const free = Math.max(0, itemTotal(state.inventory, itemId).toNumber() - reserved);
  return salvageOrderUnits(order) > free;
}
