// ============================================================================
// craftQueue.ts: the pure, READ-ONLY view model behind every queue readout
// Crafting 0.13.3, Phase 1 Unit 1.5
// Author: Claude (Opus 5) | 2026-09-01
// Design: docs/plans/2026-09-01-crafting-0.13.3-design.md (section 5, section 8).
// Build plan: docs/plans/2026-09-01-crafting-0.13.3-plan.md (Phase 1 Unit 1.5).
//
// WHAT THIS IS. One pure builder that turns a raw GameState into the compact shape
// the Phase 4 consoles (Refinery, Fabricator, Salvage Bay, and the Facilities
// dashboard cards) render their "running above queued" panel straight from. It is
// the same posture homeDashboard.ts and shipRoster.ts already take: no Svelte, no
// DOM, no side effects, node-testable, and every hard question answered by the
// game's REAL gate rather than by a second opinion computed here.
//
// ⚠️ DEPENDENCY DIRECTION, THE ONE RULE THIS FILE EXISTS TO KEEP (build plan
// assumption 1). This module imports FROM tick.ts and tick.ts NEVER imports this.
// tick.ts owns the queue: the adapter table, the mutation API and the promotion
// pass all live there because the refine/fabricate adapters delegate wholesale to
// canStartLine / startLine, which live there too. Pointing the arrow one way means
// there is no import cycle to unpick, and, more importantly, it means the engine
// cannot end up asking the VIEW whether something may run. If a future unit is
// tempted to import craftQueue.ts from tick.ts, that is the signal the logic being
// reached for belongs in tick.ts instead.
//
// WHAT IT DELIBERATELY DOES NOT DO (Omega 15a: do not re-derive proven code):
//   - it never decides whether a queued order could start. It ASKS
//     QUEUE_ADAPTERS[facility].canStart, which for the Refinery and the Fabricator
//     is canStartLine itself, so a queued row and the configurator's disabled Start
//     button can never tell the player two different stories.
//   - it never re-counts the depth cap. It asks canEnqueueOrder, the single place
//     the cap is enforced, so the "queue is full" the UI shows is the same one the
//     enqueue click would hit.
//   - it never re-implements promotion. "What goes next" is a DISPLAY PREVIEW built
//     from the adapter's own two answers (see nextToPromoteId below); the pass in
//     tick.ts stays the only authority on what actually promotes.
//   - it stores NOTHING. Block state in particular is derived on every read (design
//     section 5.4), matching stepCraftLine's deliberate choice to drop the retired
//     pausedReason bookkeeping: a stored reason is a reason that can go stale.
//
// PURE + CHEAP. Every function reads its inputs and returns fresh values, mutating
// nothing it was handed. This model is rebuilt reactively (potentially every tick
// while a console is open), so the work is bounded by lines + queued entries (a
// handful each), never by inventory size: the only per-row scan is one Map lookup
// for a line's in-flight job, and that Map is built once per facility.
//
// Project punctuation rule: no em dashes, and no doubled hyphens standing in for
// one. Commas, colons, periods and parentheses only. (The // --- rules --- below
// are section dividers, which is the one sanctioned use.)
// ============================================================================

import {
  ITEMS,
  BLUEPRINTS,
  REFINE_RECIPES,
  EQUIPMENT_SLOTS,
  SHIP_TYPES,
  type GameState,
  type QueueFacilityKey,
  type QueuedOrder,
  // Queue-engine extension (2026-09-04): SHIP_TYPES is keyed by a literal union, so a queued
  // build's PLAIN-STRING typeKey needs the same narrowing cast canBuildShip performs before
  // it can index the table. Type-only.
  type ShipTypeKey,
  type SalvageTargetRef,
  type TimedProcess,
} from "./model";
import type { CraftLine, CraftLineKind, CraftLineMode } from "./allocation";
// The ONE interpretation of a queued salvage order's unit count (0.13.3 batch-salvage
// follow-up). Imported rather than re-derived for the same reason every other answer in this
// file is delegated: a row that counted a batch differently from the engine would be a row
// that lies about how much work is waiting.
import { salvageOrderUnits } from "./reservation";
// The engine's own queue vocabulary. Every one of these is the REAL thing the tick
// and the mutation API use; none is re-implemented below.
import {
  QUEUE_ADAPTERS,
  QUEUE_FACILITY_ORDER,
  canEnqueueOrder,
  fabricateSlotCount,
  queueDepth,
  queuedForFacility,
  refineSlotCount,
  // Queue-engine extension (2026-09-04): the two new facilities' own slot counts, read here
  // for the SAME reason refineSlotCount is, and read through the SAME helpers their adapters'
  // hasFreeSlot uses, so the panel's "N / M" and the engine's slot gate cannot disagree.
  researchSlotCount,
  shipBuildSlotCount,
  // Crafting 0.13.3 (Phase 2 Unit 2.4): the Salvage Bay's real slot count and the ONE
  // definition of "a salvage job is running". Both come from tick.ts for the same reason
  // refineSlotCount does: the engine owns the answer and this module only renders it.
  SALVAGE_SLOT_COUNT,
  salvageJobsInFlight,
  // Crafting 0.13.3 follow-up (2026-09-04): a queued craft order reserves its own inputs,
  // so its gate has to be asked about a state that has released that reservation, or it
  // refuses itself. This is the SAME helper promoteQueuedOrders uses, which is what keeps
  // a row's verdict and the tick's decision the identical answer. See its header.
  withQueuedOrderReleased,
  type EnqueueBlockReason,
  type QueueBlockReason,
} from "./tick";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

// One RUNNING piece of work at a facility: today always a production line holding a
// slot (the Refinery and Fabricator line cards, design section 8.2). It is carried
// on the same model as the queue so the console can render "running" above "queued"
// from ONE derivation instead of two, which is what keeps the two lists consistent
// about slot pressure (a queued row's block reason is frequently "noSlot", and the
// running list is the explanation for it sitting right above).
//
// Ticks are RAW here, never formatted. The console runs them through the existing
// remainingReadout / lineRemainingReadout helpers with the player's showTickCounts
// preference and state.tickDurationSeconds, per preservation inventory items 0.1
// and 0.2: this module must not mint a second "time remaining" string.
export interface CraftQueueRunningRow {
  id: string;                    // CraftLine.id ("craft-N"), the stable row key + Cancel target
  label: string;                 // what it produces ("Titanium Ingot"), see craftOrderOutputLabel
  modeLabel: string;             // "batch 5" / "continuous" / "finishing current run"
  continuous: boolean;           // true for a continuous line (drives the section 5.4 warning)
  remaining: number;             // iterations not yet started; 0 = finishing its last run
  progress: number;              // 0..1 for the slim bar; 0 while no iteration is in flight yet
  remainingTicks: number | null; // raw ticks left on the in-flight iteration; null = none in flight
  durationTicks: number | null;  // raw total ticks of that iteration; null = none in flight
}

// One WAITING order at a facility, in queue order. Everything the Phase 4 row needs
// to render itself, including its controls' enabled state, so the row template does
// no rescanning of GameState.
export interface CraftQueueRow {
  id: string;                          // QueuedJob.id ("q-N"): the Remove / Move target
  position: number;                    // 1-based position within THIS facility's queue
  label: string;                       // what it produces / what it destroys (craftOrderOutputLabel)
  modeLabel: string;                   // "batch 5" / "continuous" / "salvage"
  summary: string;                     // the compact one-liner: `${label} · ${modeLabel}`
  continuous: boolean;                 // true => show the section 5.4 "waits for another slot" warning
  order: QueuedOrder;                  // the raw order, so a console can re-open a configurator on it
  // WOULD THIS START RIGHT NOW? Answered by QUEUE_ADAPTERS[facility].canStart and by
  // nothing else. ⚠️ Note this INCLUDES the slot gate: while every line slot is busy
  // (the normal case for a queued order) canStartLine reports "noSlot", so a healthy
  // queue reads "waiting for a free line" rather than "ready". That is honest and it
  // is exactly what the promotion pass sees, so the row can never claim ready for
  // work the tick would refuse.
  canStart: boolean;
  // The RAW reason, never a sentence. The player-facing text is produced by
  // App.svelte's existing startLineBlockText seam (design section 5.4), so there is
  // one wording of "not enough Titanium Ingot" in the game and the queue borrows it.
  // ⚠️ PHASE 4 MUST ROUTE THIS BY ORDER TYPE, not by token alone (Unit 2.4).
  // QueueBlockReason spans BOTH gate vocabularies: canStartLine's for a craftLine
  // order (startLineBlockText) and salvage.ts's for a salvage order
  // (salvageRejectText, which App.svelte already has). `notFound` is in both with
  // two different readings, so the mapper picks its wording from `order.type`. The
  // shared `noSlot` and the queue-only `wrongFacility` are handled before that
  // split, since neither salvage mapper knows them.
  blockReason: QueueBlockReason | null;
  canMoveUp: boolean;                  // false at this facility's first position (moveQueuedOrder no-ops)
  canMoveDown: boolean;                // false at this facility's last position
  nextToPromote: boolean;              // display preview: this is the row a free slot would take
}

// The whole per-facility model. ONE of these is what a console binds to.
export interface CraftQueueView {
  facility: QueueFacilityKey;

  // --- running work (the slots) ---
  running: CraftQueueRunningRow[];
  runningCount: number;         // running.length, hoisted so the "N / M running" readout is field-only
  // Total SLOTS at this facility, or null for a future queue-capable facility whose
  // slot model has not landed yet. Every facility that exists today reports a real
  // number: Refinery and Fabricator delegate to the same refineSlotCount /
  // fabricateSlotCount the consoles already read, and the Salvage Bay reports
  // SALVAGE_SLOT_COUNT (Phase 2 Unit 2.4).
  slotsTotal: number | null;
  hasFreeSlot: boolean;         // delegated to the adapter, the same question promotion asks

  // --- the queue (the depth) ---
  queued: CraftQueueRow[];
  depthUsed: number;            // queuedForFacility(state, facility).length
  depthTotal: number;           // queueDepth(state), which applies PER facility (design section 5.2)
  depthFree: number;            // max(0, total - used), clamped so a respec can never show a negative
  // ⚠️ THE RESPEC DRAIN STATE. True when a facility holds MORE waiting orders than the
  // current depth allows, which happens when respecHomeworldTalents refunds queue-depth
  // nodes: existing entries are deliberately left alone to drain rather than being
  // truncated (see enqueueOrder's header). The console shows "2 / 1" and explains it;
  // nothing is destroyed and nothing new can be added until it is back under the cap.
  overDepth: boolean;
  canEnqueue: boolean;                          // delegated to canEnqueueOrder
  enqueueBlockReason: EnqueueBlockReason | null; // its reason, raw, null when canEnqueue

  // DISPLAY PREVIEW of which waiting order a free slot would take next: the first
  // queued row whose adapter canStart says ok, or null when nothing here could start
  // (no free slot, empty queue, or every entry blocked). Built ONLY from the adapter's
  // own two answers (hasFreeSlot + canStart), so it mirrors the promotion pass's
  // facility scan without re-deriving a single gate. It is a preview of ONE promotion,
  // not a simulation of a multi-slot tick: promoteQueuedOrders remains the authority,
  // and a tick can promote more than this row.
  nextToPromoteId: string | null;
}

// ---------------------------------------------------------------------------
// Labels (the ONE naming path for a queued or running craft order)
// ---------------------------------------------------------------------------

// What a craft line PRODUCES, as the player reads it.
//
// This mirrors, branch for branch, the derivation App.svelte's commitStartLine
// already uses for its start log (the weapon/drone stripped-blueprint name, the
// equipment "Slot · Variety" name, else the output item's label), and it is EXPORTED
// so Phase 4 has one function to call instead of writing a third naming path for the
// queue rows. Those helpers live inside App.svelte's instance script and cannot be
// imported, which is the only reason the branches are restated here rather than
// re-used verbatim; homeDashboard.ts's labelForProcess sits in exactly the same spot
// for exactly the same reason.
//
// DEFENSIVE by design, like every other lookup over these forward-loose registries:
// an unknown key falls back to the key string, so a save carrying a retired recipe
// renders an honest, ugly row instead of "undefined" or a throw.
export function craftLineOutputLabel(kind: CraftLineKind, recipeKey: string): string {
  if (kind === "refine") {
    const recipe = REFINE_RECIPES[recipeKey];
    if (recipe === undefined) return recipeKey;
    return ITEMS[recipe.output.itemId]?.label ?? recipe.output.itemId;
  }

  const bp = BLUEPRINTS[recipeKey];
  if (bp === undefined) return recipeKey;
  // A weapon or drone-pod blueprint mints a non-stacking instance and carries no
  // output item, so its name is its own label with the authored " Blueprint" suffix
  // stripped (App.svelte craftedInstanceBlueprintLabel).
  if (bp.weaponOutput !== undefined || bp.droneOutput !== undefined) {
    return bp.label.replace(/ Blueprint$/, "");
  }
  // An equipment blueprint likewise mints an instance; it is named by the slot and
  // variety it fills (App.svelte equipmentOutputLabel).
  if (bp.equipmentOutput !== undefined) {
    return equipmentVarietyLabel(bp.equipmentOutput.slotType, bp.equipmentOutput.varietyKey);
  }
  // Otherwise it is a MATERIAL blueprint, named by the stackable item it outputs.
  const outputItem = bp.recipe.outputItem;
  if (outputItem === undefined) return bp.label;
  return ITEMS[outputItem]?.label ?? outputItem;
}

// "Cargo Hold · Expanded Bay" style name for a slot + variety pair, the derivation
// App.svelte's equipmentOutputLabel uses. Shared by the fabricate label above and by
// the equipment arm of the salvage label below.
function equipmentVarietyLabel(slotType: string, varietyKey: string): string {
  const slot = EQUIPMENT_SLOTS[slotType];
  const variety = slot?.varieties.find((v) => v.key === varietyKey);
  return `${slot?.label ?? slotType} · ${variety?.label ?? varietyKey}`;
}

// An EXISTING piece of gear, named the way the rest of the game names it.
//
// ⚠️ A PIECE CARRIES NO VARIETY OF ITS OWN. EquipmentInstance stores slotType and
// blueprintKey, never a varietyKey, so its display name is resolved THROUGH the
// blueprint that minted it, which is precisely the derivation EquipmentTooltip's
// `name` and App.svelte's equipmentOutputLabel already use. Reusing it means a
// queued salvage row and the Ship Systems tile above it name the same piece the
// same way, and it is why this arm goes back through craftLineOutputLabel rather
// than reading a field that does not exist.
//
// A Standard-Issue baseline has no blueprint (blueprintKey null), so it is named for
// its slot plus the baseline word. That distinction is load-bearing on this console:
// a baseline is DESTROYED and yields nothing, a crafted piece is SALVAGED, and the
// Salvage Bay's label flip depends on the player being able to tell them apart in
// the queue as well as on the tile.
function equipmentInstanceLabel(piece: { slotType: string; blueprintKey: string | null }): string {
  const slotLabel = EQUIPMENT_SLOTS[piece.slotType]?.label ?? piece.slotType;
  if (piece.blueprintKey === null) return `${slotLabel} · Standard-Issue`;
  // An unknown blueprint key (a retired blueprint on an old save) falls back to the
  // slot label rather than rendering a raw internal key at the player.
  if (BLUEPRINTS[piece.blueprintKey] === undefined) return slotLabel;
  return craftLineOutputLabel("fabricate", piece.blueprintKey);
}

// What a queued SALVAGE order points at, as the player reads it.
//
// Needs `state` because two of the three arms name a live object by id. Every arm
// falls back to the raw id when the target has already gone (salvaged elsewhere,
// hull lost, instance installed and consumed), which is a real case the queue must
// render rather than crash on: a stale target is a fail-safe no-op at completion
// (Phase 2 Unit 2.3), so it has to be a legible row until then.
export function salvageTargetLabel(state: GameState, target: SalvageTargetRef): string {
  switch (target.kind) {
    case "equipment": {
      const piece = state.equipment.find((e) => e.id === target.instanceId);
      if (piece === undefined) return target.instanceId;
      return equipmentInstanceLabel(piece);
    }
    case "material":
      return ITEMS[target.itemId]?.label ?? target.itemId;
    case "ship": {
      const ship = state.ships.find((s) => s.id === target.shipId);
      if (ship === undefined) return target.shipId;
      // The same `name ?? hull-class label` rule the roster and Home use.
      return ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.id;
    }
  }
}

// The output/target name for ANY queued order, the single entry point a row uses.
//
// EXHAUSTIVE over QueuedOrder with no default branch (queue-engine extension, 2026-09-04),
// so a new order arm is a compile error here rather than a row that renders a raw internal
// key at the player. Every arm falls back to the raw key when its registry lookup misses,
// the same rule salvageTargetLabel already follows for a target that has gone: a stale order
// has to stay a legible row until the player clears it.
export function queuedOrderLabel(state: GameState, order: QueuedOrder): string {
  switch (order.type) {
    case "craftLine":
      return craftLineOutputLabel(order.kind, order.recipeKey);
    case "salvage":
      return salvageTargetLabel(state, order.target);
    case "research":
      // The blueprint's own authored label, with its " Blueprint" suffix intact: a research
      // row is about acquiring the BLUEPRINT, not about the thing it will eventually make.
      // That is the opposite of craftLineOutputLabel's fabricate arm, which strips the suffix
      // because a fabricate row IS about the output, and the difference is deliberate.
      return BLUEPRINTS[order.blueprintKey]?.label ?? order.blueprintKey;
    case "shipBuild":
      // The HULL CLASS label, never a ship name: nothing has been built yet, so there is no
      // instance to name. Same label the Shipyard's own build card carries.
      // The cast is the SAME one canBuildShip makes over the same plain-string field; the
      // optional chain is what makes an unknown key fall back to the raw string rather than
      // throwing, so the cast can never turn a stale save into a crash.
      return SHIP_TYPES[order.typeKey as ShipTypeKey]?.label ?? order.typeKey;
  }
}

// The run-mode phrase for a WAITING craft order: nothing has run yet, so there is no
// "finishing current run" case here (that one belongs to a running line, below).
// Wording matches the live line card so a row does not change vocabulary the moment
// it promotes.
// ⚠️ A MULTI-UNIT SALVAGE BATCH BORROWS THE CRAFT WORDING VERBATIM (0.13.3 batch-salvage
// follow-up), so a batch of 5000 housings reads "batch 5000" exactly as a batch of 5000
// ingots does. Sharing the phrase is the point: the two facilities now do the same thing and
// a player should not have to learn a second word for it. A SINGLE-unit salvage order keeps
// the literal "salvage" it has always read as, both because "batch 1" is a worse sentence and
// because every existing single-target row (and every auto-salvage order) then renders
// byte-identically to before this change.
// ⚠️ THE TWO COUNTLESS ARMS READ AS ONE PIECE OF WORK (queue-engine extension, 2026-09-04).
// A research order and a ship-build order carry no mode at all (see QueuedOrder), so there is
// no count to print and inventing "batch 1" would imply a quantity control that does not
// exist. They read as the VERB of the facility, matching the salvage arm's literal "salvage",
// so a row does not change vocabulary the moment it promotes.
function queuedModeLabel(order: QueuedOrder): string {
  switch (order.type) {
    case "salvage": {
      const units = salvageOrderUnits(order);
      return units > 1 ? `batch ${units}` : "salvage";
    }
    case "research":
      return "research";
    case "shipBuild":
      return "build";
    case "craftLine":
      return order.mode.kind === "batch" ? `batch ${order.mode.remaining}` : "continuous";
  }
}

// The run-mode phrase for a RUNNING line. EXACT mirror of the line card's own
// expression (App.svelte, the refine + fabricate line cards): a line at remaining 0
// is finishing its last in-flight iteration and has nothing left to cancel, which is
// why it reads differently from a line with work still queued inside it.
function runningModeLabel(line: CraftLine): string {
  if (line.remaining <= 0) return "finishing current run";
  return line.mode.kind === "batch" ? `batch ${line.remaining}` : "continuous";
}

// True when a mode never releases its slot. Hoisted so both row builders ask it the
// same way; it is what drives the design section 5.4 warning ("runs until cancelled;
// queued orders wait for another slot").
function isContinuous(mode: CraftLineMode): boolean {
  return mode.kind === "continuous";
}

// ---------------------------------------------------------------------------
// Running rows
// ---------------------------------------------------------------------------

// The production lines a facility is currently running, or an empty list for a
// facility that has none.
//
// ⚠️ THE SALVAGE BAY RUNS JOBS, NOT LINES (Phase 2 Unit 2.4). The Refinery and the
// Fabricator hold a CraftLine per slot with a TimedProcess attached to it; the Salvage
// Bay has no line layer at all, its job IS the unit of work. Both shapes land on the
// same row model on purpose, because the console renders "running above queued" from
// ONE derivation and a queued salvage row's block reason is frequently the noSlot the
// running list sits right above to explain.
//
// ⚠️ REWRITTEN FROM AN IF-CHAIN INTO AN EXHAUSTIVE SWITCH (queue-engine extension,
// 2026-09-04). The old shape ended in "anything that is not the Salvage Bay or the Refinery
// is the Fabricator", which was true of three facilities and would have silently rendered a
// Shipyard's running builds as the Fabricator's lines the moment there were six. Behavior for
// the original three is unchanged, line for line.
function runningRowsFor(state: GameState, facility: QueueFacilityKey): CraftQueueRunningRow[] {
  switch (facility) {
    case "salvageBay":
      return salvageRunningRows(state);
    case "researchLab":
      return timedJobRunningRows(state, "researchProject", "research", (process) =>
        process.effect.type === "unlockBlueprint"
          ? BLUEPRINTS[process.effect.key]?.label ?? process.effect.key
          : "Research"
      );
    case "shipyard":
      // ⚠️ BUILDS ONLY, NOT REPAIRS. The Shipyard's bays are SHARED between builds and repairs
      // (shipyardBayCount), but only a BUILD is queueable, and hasFreeSlot counts builds
      // against shipBuildSlotCount. Listing repairs here would put rows above the queue that
      // the slot readout beside them does not count, which is the one thing this list exists
      // not to do. A repair still shows on the Home board's in-progress rows.
      return timedJobRunningRows(state, "shipBuild", "build", (process) =>
        process.effect.type === "addShip"
          ? SHIP_TYPES[process.effect.typeKey]?.label ?? process.effect.typeKey
          : "Hull"
      );
    case "fuelDepot":
      // Deliberately empty: the Fuel Depot accepts no orders, so it has no queue panel to sit
      // above. Its running pipelines are the automatic engine's business, not the queue's.
      // See QUEUE_ADAPTERS' fuelDepot row.
      return [];
    case "refinery":
    case "fabricator":
      break; // falls through to the shared craft-line body below
  }

  const kind: CraftLineKind = facility === "refinery" ? "refine" : "fabricate";
  const lines = (kind === "refine" ? state.refineLines : state.fabricateLines) ?? [];
  if (lines.length === 0) return [];

  // ONE pass over activeProcesses, indexed by lineId, instead of a find() per line.
  // The live card does `activeProcesses.find(p => p.lineId === line.id)` per card,
  // which is fine for 3 cards; this model is rebuilt reactively, so the Map keeps it
  // linear in (lines + processes) rather than their product.
  const jobByLine = new Map<string, TimedProcess>();
  for (const process of state.activeProcesses) {
    if (process.lineId !== undefined) jobByLine.set(process.lineId, process);
  }

  return lines.map((line) => {
    const job = jobByLine.get(line.id);
    // Same 0-duration guard the card uses: a malformed job reads 0 progress rather
    // than dividing by zero.
    const progress = job !== undefined && job.durationTicks > 0
      ? (job.durationTicks - job.remainingTicks) / job.durationTicks
      : 0;
    return {
      id: line.id,
      label: craftLineOutputLabel(line.kind, line.recipeKey),
      modeLabel: runningModeLabel(line),
      continuous: isContinuous(line.mode),
      remaining: line.remaining,
      progress,
      remainingTicks: job?.remainingTicks ?? null,
      durationTicks: job?.durationTicks ?? null,
    };
  });
}

// The IN-FLIGHT salvage jobs as running rows, in activeProcesses order.
//
// Enumerated through tick.ts's salvageJobsInFlight, never by a local scan of
// activeProcesses: that helper is the single definition of "a salvage is running", and
// it is the same one the adapter's hasFreeSlot counts against SALVAGE_SLOT_COUNT. A
// second local predicate here could disagree, and the row list would then contradict the
// slot readout printed beside it.
//
// The three fields whose meaning differs from a craft line, and why:
//   id          the PROCESS id ("proc-N"), because a salvage job has no owning line. It is
//               stable for the job's whole life, which is all a row key needs. There is
//               deliberately no Cancel target: cancelling an in-flight salvage is not a
//               shipped action (a queued one is removed from the queue instead).
//   modeLabel   the literal "salvage", matching queuedModeLabel's salvage arm, so a row
//               does not change vocabulary the moment it promotes.
//   remaining   always 0: a job is one indivisible piece of work with nothing queued
//               behind it inside itself, which is exactly what the craft-line model calls
//               "finishing its current run".
function salvageRunningRows(state: GameState): CraftQueueRunningRow[] {
  return salvageJobsInFlight(state).map((job) => ({
    id: job.id,
    // Named through the same helper a QUEUED salvage row uses, so the target reads
    // identically before and after promotion (and falls back to the raw id if it has
    // gone, which is a real state: a stale target is a fail-safe no-op at completion).
    label: salvageTargetLabel(state, job.effect.target),
    modeLabel: "salvage",
    continuous: false, // a job ends; only a craft LINE can run until cancelled
    remaining: 0,
    // The same 0-duration guard the line rows use: a malformed job reads 0 progress
    // rather than dividing by zero.
    progress: job.durationTicks > 0 ? (job.durationTicks - job.remainingTicks) / job.durationTicks : 0,
    // RAW ticks, never formatted here (preservation inventory items 0.1 + 0.2): the
    // console runs them through the existing readout helpers with the player's
    // showTickCounts preference and state.tickDurationSeconds. Non-null on every salvage
    // row, because unlike a craft line the job IS the work: there is no "configured but
    // not yet started" state to represent.
    remainingTicks: job.remainingTicks,
    durationTicks: job.durationTicks,
  }));
}

// The IN-FLIGHT jobs of ONE process kind as running rows, in activeProcesses order
// (queue-engine extension, 2026-09-04).
//
// The Research Lab and the Shipyard both work the way the Salvage Bay does rather than the way
// the Refinery does: they have NO line layer, their unit of work IS one TimedProcess. So this
// is salvageRunningRows generalized by the two things that differ between them (which process
// kind to collect, and how to name one), written once instead of copied twice.
//
// The three fields whose meaning differs from a craft line are the SAME three, for the same
// reasons salvageRunningRows documents: `id` is the process id (there is no owning line),
// `remaining` is always 0 (a job is one indivisible piece of work with nothing queued inside
// itself), and there is deliberately no Cancel target (cancelling an in-flight research
// project or hull build is not a shipped action, and a build has spent its BOM already).
// `modeLabel` is PASSED IN rather than inferred from `kind`. Inferring it would mean a
// two-value ternary with a silent else, which is the exact shape this file just removed from
// runningRowsFor and orderMatchesFacility: correct for two kinds, a silent mislabel for three.
function timedJobRunningRows(
  state: GameState,
  kind: TimedProcess["kind"],
  modeLabel: string,
  label: (process: TimedProcess) => string
): CraftQueueRunningRow[] {
  return state.activeProcesses
    .filter((process) => process.kind === kind)
    .map((process) => ({
      id: process.id,
      label: label(process),
      // The facility's VERB, matching the queued row's modeLabel for the same order, so a row
      // does not change vocabulary the moment it promotes.
      modeLabel,
      continuous: false, // a job ends; only a craft LINE can run until cancelled
      remaining: 0,
      // The same 0-duration guard every other row builder uses: a malformed job reads 0
      // progress rather than dividing by zero.
      progress: process.durationTicks > 0 ? (process.durationTicks - process.remainingTicks) / process.durationTicks : 0,
      // RAW ticks, never formatted here: the console runs them through the existing readout
      // helpers with the player's showTickCounts preference.
      remainingTicks: process.remainingTicks,
      durationTicks: process.durationTicks,
    }));
}

// The facility's total SLOT count. Delegates to the exported slot helpers so the queue
// panel's "N / M running" and the console's own slot readout can never disagree about M.
//
// Returns `number | null` still, even though every facility now has a count: the null arm
// is the honest answer for a future queue-capable facility whose slot model has not landed
// yet, and removing it would force the next such facility to invent a fake number.
function slotsTotalFor(state: GameState, facility: QueueFacilityKey): number | null {
  switch (facility) {
    case "refinery":
      return refineSlotCount(state);
    case "fabricator":
      return fabricateSlotCount(state);
    case "salvageBay":
      // A flat constant, not a derivation: the Salvage Bay is deliberately non-leveled and
      // its throughput knob is QUEUE DEPTH, not parallel slots. See SALVAGE_SLOT_COUNT.
      return SALVAGE_SLOT_COUNT;
    case "researchLab":
      return researchSlotCount(state);
    case "shipyard":
      // ⚠️ shipBuildSlotCount, NOT shipyardBayCount, and the difference is load-bearing: the
      // build cap is deliberately bays MINUS ONE so a build can never take the last bay a
      // repair needs. Printing the bay count here would promise the player a build slot the
      // engine will not give them.
      return shipBuildSlotCount(state);
    case "fuelDepot":
      // THE null ARM, used for exactly the reason the header describes. The Fuel Depot has
      // pipelines, but it has no QUEUE, so it has no queue-slot model to report; printing
      // fuelPipelineCount here would attach a queue readout to a facility that accepts no
      // orders. See QUEUE_ADAPTERS' fuelDepot row.
      return null;
  }
}

// ---------------------------------------------------------------------------
// The enqueue probe
// ---------------------------------------------------------------------------

// A shape-only stand-in order per facility, used for ONE purpose: asking the REAL
// canEnqueueOrder "is there room here?" without a concrete order in hand.
//
// WHY A PROBE RATHER THAN A COUNT COMPARISON. canEnqueueOrder answers the "does this
// order belong at this facility" and "is the facility at depth" questions and it is
// the only place the depth cap is enforced. Comparing depthUsed against depthTotal
// here would be a second, drift-capable copy of that rule, which is exactly what
// this module is written to avoid. A probe that MATCHES its facility can only ever
// come back with the depth answer, so canEnqueue is the cap gate's own verdict.
//
// The probe is never enqueued and never leaves this module. Typed as an exhaustive
// Record so a new QueueFacilityKey is a compile error here too, the same discipline
// QUEUE_ADAPTERS uses.
//
// ⚠️ THE SALVAGE PROBE'S EMPTY instanceId IS LOAD-BEARING as of 0.13.3 Unit 2.1. That
// unit added the duplicate-target gate, so canEnqueueOrder now reads a salvage order's
// TARGET as well as its shape: a probe naming a REAL instance that the player had already
// queued would come back "alreadyQueued" and the console would report the Salvage Bay as
// unable to accept anything, which is a lie about the depth cap. The empty-string id can
// never match a minted EquipmentInstance id, so the probe still asks only the depth
// question. Keep it empty.
//
// ⚠️ THE CRAFT PROBES' EMPTY recipeKey IS LOAD-BEARING FOR THE SAME REASON as of the
// 0.13.3 follow-up, which added an enqueue-time AFFORDABILITY gate (canReserveOrder). A
// probe naming a REAL recipe the player cannot currently afford would come back
// "materials" and this view would report the whole facility as unable to accept anything,
// which is a lie about the depth cap and would blank the panel's "add an order" affordance
// for every player who happens to be short of one ingredient. An empty recipeKey resolves
// to no recipe, which reserves nothing, which passes canReserveOrder unconditionally, so
// the probe still asks only the depth question. Keep it empty.
//
// The REAL per-order affordability answer belongs to the configurator's own "Add to queue"
// button, which asks canEnqueueOrder about the actual recipe and quantity (App.svelte's
// craftQueueButtonBlockText). That is the right place for it: it is the only surface that
// knows which order the player is about to queue.
const ENQUEUE_PROBE: Record<QueueFacilityKey, QueuedOrder> = {
  refinery: { type: "craftLine", kind: "refine", recipeKey: "", mode: { kind: "continuous" } },
  fabricator: { type: "craftLine", kind: "fabricate", recipeKey: "", mode: { kind: "continuous" } },
  // ⚠️ THE SALVAGE PROBE'S SINGLE-UNIT batch IS LOAD-BEARING FOR THE SAME REASON as its
  // empty instanceId, as of the 0.13.3 batch-salvage follow-up, which added an enqueue-time
  // quantity gate (exceedsFreeSalvageUnits). A probe asking for many units would come back
  // "notEnoughHeld" and this view would report the whole bay as unable to accept anything.
  // One unit against an `equipment` target is exempt from that gate entirely (it applies only
  // to the fungible arm), so the probe still asks only the depth question. Keep it at 1.
  salvageBay: {
    type: "salvage",
    target: { kind: "equipment", instanceId: "" },
    mode: { kind: "batch", remaining: 1 },
  },
  // ⚠️ THE TWO NEW PROBES' EMPTY KEYS ARE LOAD-BEARING FOR EXACTLY THE REASONS ABOVE
  // (queue-engine extension, 2026-09-04). An empty blueprintKey names no blueprint, so it can
  // never match a queued sibling (alreadyQueued) and canResearch answers `notFound` rather
  // than the alreadyResearched / inProgress pair the enqueue gate forwards, which leaves the
  // depth question as the only one the probe can come back with. An empty ship typeKey
  // resolves to no hull, so queuedOrderInputs returns {} and canReserveOrder passes
  // unconditionally. Keep both empty.
  researchLab: { type: "research", blueprintKey: "" },
  shipyard: { type: "shipBuild", typeKey: "" },
  // ⚠️ THE FUEL DEPOT PROBE'S SHAPE IS IRRELEVANT, AND THAT IS THE HONEST ANSWER. No order
  // shape belongs at the Fuel Depot (orderMatchesFacility refuses every one of them), so this
  // probe comes back `wrongFacility` whatever it is and the view reports canEnqueue: false.
  // That is exactly right: nothing can be queued there. See QUEUE_ADAPTERS' fuelDepot row.
  fuelDepot: { type: "shipBuild", typeKey: "" },
};

// ---------------------------------------------------------------------------
// The builders
// ---------------------------------------------------------------------------

// Build the queue view for ONE facility. Pure: nothing on `state` is read for
// writing and nothing is cached between calls.
export function buildCraftQueue(state: GameState, facility: QueueFacilityKey): CraftQueueView {
  const adapter = QUEUE_ADAPTERS[facility];
  const hasFreeSlot = adapter.hasFreeSlot(state);

  // The facility's waiting orders, in queue order, from the engine's own filter. The
  // array index IS the queue order, so position is just the index plus one.
  const waiting = queuedForFacility(state, facility);
  const depthUsed = waiting.length;
  const depthTotal = queueDepth(state);

  // The promotion preview (see CraftQueueView.nextToPromoteId). Resolved BEFORE the
  // rows are built so each row can carry its own flag, and computed only when a slot
  // is actually free, which also means canStart is not asked twice per row.
  let nextToPromoteId: string | null = null;

  const queued: CraftQueueRow[] = waiting.map((job, index) => {
    // THE eligibility question, delegated. No local gate, no local affordability
    // math, no cached verdict: this is the same predicate the promotion pass runs,
    // asked about the same state the promotion pass asks it about.
    //
    // ⚠️ withQueuedOrderReleased IS NOT AN OPTIMIZATION, IT IS THE QUESTION (0.13.3
    // follow-up). This order's own inputs are reserved BY this order while it waits, so
    // gating it against the raw state would have it refuse itself with `materials` and
    // every healthy queued row would read "not enough" forever. Promotion is a handoff of
    // that reservation, not a second spend. Every OTHER queued order's reservation is
    // still counted, so a row that genuinely cannot be funded alongside the orders ahead
    // of it still says so honestly.
    //
    // ⚠️ FOR A SALVAGE BATCH this releases ONE unit rather than the whole entry (0.13.3
    // batch-salvage follow-up), which is the same state the promotion pass gates against.
    // canStartSalvage never reads processQueue, so the verdict is identical either way; the
    // call stays here so the row and the tick keep asking the literally identical question,
    // which is the property this line exists to preserve.
    const gate = adapter.canStart(withQueuedOrderReleased(state, job.id), job.order);
    if (gate.ok && hasFreeSlot && nextToPromoteId === null) nextToPromoteId = job.id;

    const label = queuedOrderLabel(state, job.order);
    const modeLabel = queuedModeLabel(job.order);
    return {
      id: job.id,
      position: index + 1,
      label,
      modeLabel,
      summary: `${label} · ${modeLabel}`,
      continuous: job.order.type === "craftLine" && isContinuous(job.order.mode),
      order: job.order,
      canStart: gate.ok,
      blockReason: gate.ok ? null : gate.reason,
      // Position-based on purpose, and equivalent to moveQueuedOrder's own scan:
      // that function swaps with the nearest SAME-FACILITY neighbour, and `waiting`
      // is that same per-facility filter, so first/last here is exactly where the
      // move becomes a no-op. The controls are therefore disabled precisely when the
      // action would do nothing.
      canMoveUp: index > 0,
      canMoveDown: index < waiting.length - 1,
      nextToPromote: false, // stamped below, once the winner is known
    };
  });

  // Stamp the preview flag. Done in a second pass rather than inside the map so the
  // "first eligible" decision is made once, in one place, and a row cannot claim the
  // flag before a lower-indexed row has been examined.
  if (nextToPromoteId !== null) {
    for (const row of queued) row.nextToPromote = row.id === nextToPromoteId;
  }

  const enqueueGate = canEnqueueOrder(state, facility, ENQUEUE_PROBE[facility]);
  const running = runningRowsFor(state, facility);

  return {
    facility,
    running,
    runningCount: running.length,
    slotsTotal: slotsTotalFor(state, facility),
    hasFreeSlot,
    queued,
    depthUsed,
    depthTotal,
    // Clamped at 0: a respec can leave used above total, and a negative "free"
    // readout would be a nonsense number on a console (see overDepth).
    depthFree: Math.max(0, depthTotal - depthUsed),
    overDepth: depthUsed > depthTotal,
    canEnqueue: enqueueGate.ok,
    enqueueBlockReason: enqueueGate.ok ? null : enqueueGate.reason,
    nextToPromoteId,
  };
}

// Every facility's view at once, in QUEUE_FACILITY_ORDER.
//
// WHY THIS EXISTS ALONGSIDE THE SINGLE-FACILITY BUILDER: the Facilities dashboard
// (design section 8.1) makes every card queue-aware ("2 / 3 running, 1 queued") on
// one screen, so it needs all three at once; a single console needs exactly one and
// should not pay for the other two. Both callers are real, so both entry points
// exist rather than one being forced to serve the other.
//
// Iterated over the declared tuple, never Object.keys, for the same reason the
// promotion pass is: the tuple is the stated order, so the dashboard lists
// facilities in the order the engine actually walks them.
export function buildAllCraftQueues(state: GameState): CraftQueueView[] {
  return QUEUE_FACILITY_ORDER.map((facility) => buildCraftQueue(state, facility));
}
