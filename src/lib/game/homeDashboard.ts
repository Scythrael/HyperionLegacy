// ---------------------------------------------------------------------------
// homeDashboard.ts, the pure derivation behind the Home mission-control board.
//
// Author: Claude (Opus 4.8), for the user. Date: 2026-08-31.
// Design: docs/plans/2026-08-28-home-dashboard-0.13.1-design.md.
// Build plan: docs/plans/2026-08-28-home-dashboard-0.13.1-plan.md (Unit 1).
//
// PURPOSE: turn a raw GameState into ONE compact, normalized view model the Home
// Overview screen renders straight from, so the screen never re-scans state per row
// (design Section 5 / Section 10). This module is a PURE function of GameState: no
// side effects, no I/O, no DOM, no formatting of clocks (the UI formats ETA via the
// existing App.svelte remainingReadout off the raw ticks this model carries). That
// keeps every hard derivation unit-testable in the node vitest env.
//
// UNIT 1 SCOPE (this file, this pass): the IN-PROGRESS list ONLY. It enumerates
// state.activeProcesses generically (one branch per TimedProcessKind) plus the two
// captain-mission arms (patrol + extraction). needsOrders / locked / allCaughtUp are
// deliberate stubs here, they are Units 2 and 3, not Unit 1 (see the builder).
//
// NO-DRIFT NOTE: the label + progress derivations mirror the SOURCE panels in
// App.svelte so a running job reads the same on Home as on its own panel. Each
// mapping below cites the App.svelte line it mirrors. The DATA lookups (ITEMS /
// BLUEPRINTS / SHIP_TYPES / FACILITIES / FACTIONS / MISSIONS label maps,
// requiredTicksForPhase, extractionMissionOf) are shared with those panels; only the
// compact Home phrasing is local (see labelForProcess).
// ---------------------------------------------------------------------------

import {
  type GameState,
  type TimedProcess,
  type TimedProcessKind,
  type CompletionLogEntry,
  type ItemRarity,
  type CaptainState,
  type PatrolMissionState,
  type PatrolPhase,
  type ShipInstance,
  type MissionKey,
  type PatrolKey,
  // Crafting 0.13.3 Unit 4.6: the queue-capable facility union, so the queued-work summary
  // is keyed by the SAME literal the engine's adapter table and QUEUE_FACILITY_ORDER use.
  type QueueFacilityKey,
  ITEMS,
  BLUEPRINTS,
  SHIP_TYPES,
  FACILITIES,
  FACTIONS,
  MISSIONS,
  PATROLS,
  REFINE_RECIPES,
  MISSION_PHASE_LABEL,
  PATROL_PHASE_LABEL,
  requiredTicksForPhase,
  extractionMissionOf,
} from "./model";

// The game's REAL "can I start this?" gates (Unit 2). Each is the single source of truth
// the corresponding setup UI's Start/Dispatch button already reads, so the dashboard's
// idle-and-actionable detection asks the EXACT questions the pickers ask (design Section 7:
// reuse the availability logic, never re-derive economy math). See buildNeedsOrders below
// for how each gate's own idle/slot condition is folded into "actionable".
import {
  canDispatch,
  canDispatchPatrol,
  canResearch,
  canStartLine,
  canBuildShip,
  canBuildFacilityUpgrade,
} from "./tick";

// The queue's OWN pure view model (Crafting 0.13.3, Unit 4.6). The board learns about
// QUEUED orders by asking the module that already answers every queue question, exactly as
// it learns about start gates by asking tick.ts, so Home and the Refinery / Fabricator /
// Salvage Bay consoles can never tell the player two different stories about the queue.
//
// ⚠️ DEPENDENCY DIRECTION. craftQueue.ts imports FROM tick.ts and tick.ts never imports
// craftQueue.ts (that module's header states the rule). This file already imported tick.ts,
// so adding craftQueue.ts here points one more arrow the SAME way (homeDashboard ->
// craftQueue -> tick) and introduces no cycle. Nothing in the engine imports this file.
import { buildAllCraftQueues, salvageTargetLabel, type CraftQueueView } from "./craftQueue";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

// The nav destinations a Home row/prompt can jump to (design Section 8). A flat
// string union, one literal per setup tab the dashboard routes into, so the Unit 3
// jumpToActivity(target) dispatcher is a single typed switch. The first seven are the
// Section-8 setup destinations; "facilities" (0.13.1 follow-up) is the Facilities
// OVERVIEW (the dashboard of all facility cards), the landing for the aggregate
// "facility upgrade(s) ready" prompt (buildNeedsOrders below), which points at no single
// facility, so it routes to the overview where every card + its Build button lives, not
// into one foundry console. A running row whose real destination is not one of these (a
// Warehouse or Ship-Systems-storage upgrade, see labelForProcess) carries a null
// jumpTarget instead of an invented one, and the UI renders it as a plain, non-navigable
// status row.
export type JumpTarget =
  | "gathering"
  | "combat"
  | "research"
  | "refinery"
  | "fabricator"
  | "shipyard"
  | "fuelDepot"
  | "facilities"
  // Crafting 0.13.3 Unit 4.6: the Salvage Bay console. Added because 0.13.3 turned the bay
  // into a real, queued, timed facility: a salvage now RUNS (an in-flight salvageJob row on
  // this board) and COMPLETES (a Recently-completed row), and both of those rows have an
  // obvious place to send the player that did not exist when the union was written. Before
  // this, a completed salvage carried a null target and rendered as a non-navigable row.
  | "salvageBay";

// Which FLAVOR of in-progress row this is. Drives how the UI reads the optional
// fields: a "patrol" row is the only kind that carries `combat` (and has a null ETA,
// design Section 4 honest-progress: missions have no whole-clock countdown); a
// "timed-job" and an "extraction" row both carry remaining/duration ticks for the ETA
// readout. Extensible in lockstep with the two mission arms + the generic process loop.
export type ActivityRowKind = "timed-job" | "patrol" | "extraction";

// The combat-only detail block, present ONLY on a patrol row (null on every other
// kind). Mirrors the IN PROGRESS patrol card (App.svelte:8100-8137): waves resolved of
// total, hull + shield as fractions of the ship's MAX pool, and the raw PatrolPhase so
// the UI can style the defeat phase ("limpingHome") in danger color exactly as the
// source card does. Fractions are pre-clamped 0..1 here so the UI never has to.
export interface CombatRowDetail {
  hullFraction: number;   // 0..1, playerHull / hull max (clamped)
  shieldFraction: number; // 0..1, playerShield / shield max (clamped)
  wavesResolved: number;  // wavesWon + wavesLost (App.svelte:8101)
  totalWaves: number;     // patrol.waveTicks.length (App.svelte:8100)
  phase: PatrolPhase;     // raw phase, so the UI can label + danger-style it
}

// One compact IN PROGRESS row, carrying everything a UI needs to render WITHOUT
// re-reading GameState (design Section 5). `remainingTicks` / `durationTicks` are the
// RAW ticks (not a formatted string), so the UI runs them through the existing
// remainingReadout with the player's tick-count preference; they are null for a patrol
// (no honest whole-clock ETA). `progress` is a ready 0..1 fraction for the slim bar.
export interface ActivityRow {
  id: string;                    // stable row id: the TimedProcess.id, or "patrol-<captainId>" / "extraction-<captainId>"
  icon: string;                  // icon HINT the UI maps to a glyph (e.g. "refine", "research", "patrol"); kept as a flat string, not a UI asset
  primaryLabel: string;          // the main line (e.g. "Researching, Sprint Drive")
  secondaryLabel: string | null; // optional dim line (e.g. a mission phase); null when there is nothing to add
  kind: ActivityRowKind;         // discriminator (see ActivityRowKind)
  progress: number;              // 0..1 for the progress bar
  remainingTicks: number | null; // raw ticks left, for remainingReadout; null for a patrol (no ETA)
  durationTicks: number | null;  // raw total ticks, for remainingReadout; null for a patrol
  jumpTarget: JumpTarget | null; // where a tap routes; null = a non-navigable status row (no Section-8 destination)
  combat: CombatRowDetail | null; // present ONLY on a patrol row; null otherwise
}

// One actionable-idle prompt (NEEDS YOUR ORDERS). STUB in Unit 1 (see the builder);
// the shape is declared now so the model type is stable for Units 2/3. An idle slot
// the player can act on (dispatch a captain, start research, craft, build a hull).
export interface Prompt {
  id: string;                    // stable prompt id (e.g. "idle-research")
  icon: string;                  // icon hint, same convention as ActivityRow.icon
  label: string;                 // the amber prompt line (e.g. "Research bay idle, 1 slot free")
  detail: string | null;         // optional amber sub-line
  jumpTarget: JumpTarget;        // a prompt ALWAYS routes somewhere (it is actionable by definition)
  // A specific FACILITIES key when this prompt is about ONE named facility (the sole
  // available facility upgrade), so the UI can deep-link to THAT facility's upgrade
  // location rather than the generic Facilities overview. Absent/undefined for every
  // other prompt (they route by jumpTarget alone). See buildNeedsOrders + App's
  // jumpToFacilityUpgrade. Only meaningful alongside jumpTarget "facilities".
  facilityKey?: string;
}

// One NOT-YET-UNLOCKED slot (dimmed chip, bottom). STUB in Unit 1 (Unit 3 fills it).
// A feature the player has not unlocked yet, shown via the game's "coming soon" idiom.
export interface LockedSlot {
  id: string;          // stable slot id (e.g. "locked-crewEquipment")
  icon: string;        // icon hint
  label: string;       // the locked feature's name
  note: string | null; // optional "Coming soon" / unlock-hint sub-line
}

// ---------------------------------------------------------------------------
// RECENTLY COMPLETED (Crafting 0.13.3, Unit 4.4b)
//
// The companion to IN PROGRESS: "what is running" above, "what just finished" below.
// Reads GameState.completionLog, the ring buffer resolveProcesses writes (see
// CompletionLogEntry in model.ts). It re-renders the STORED record; it never re-derives
// what happened, because the only place that knows is the tick.
// ---------------------------------------------------------------------------

// One reward line, resolved from a stored item ID to everything the UI needs EXCEPT the
// color itself: the row carries the `rarity`, and the UI applies warehouseRarityColor to
// it, exactly as the Warehouse and the drop tables do. `amount` stays the raw Decimal
// STRING off the record so the UI runs it through the app's own formatNumber rather than
// this module inventing a second number format.
export interface CompletionRewardChip {
  itemId: string;
  label: string;
  rarity: ItemRarity;
  amount: string;
}

// One "Recently completed" row. Timestamps stay RAW (millisecond stamps, not formatted
// clock strings) for the same reason ActivityRow keeps raw ticks: formatting is a view
// concern and this module is pure. `atMs === 0` means the record was written with no
// injected clock (see UNKNOWN_COMPLETION_TIME_MS), which the UI renders as an unknown time
// rather than as a 1970 date.
export interface CompletionRow {
  id: string;
  icon: string;
  primaryLabel: string;          // "Refined, Titanium Ingot"
  secondaryLabel: string | null; // the run detail, e.g. "40 runs" or "Level 3"
  atMs: number;                  // when the order completed; 0 = unknown clock
  elapsedMs: number | null;      // how long the run took; null when either stamp is unknown
  rewards: CompletionRewardChip[]; // item rewards, ids resolved to label + rarity + amount
  jumpTarget: JumpTarget | null; // where a tap routes; null = a plain, non-navigable row
}

// ---------------------------------------------------------------------------
// QUEUED WORK (Crafting 0.13.3, Unit 4.6)
//
// WHY A COUNT AND NOT ROWS. A queued order is NOT running. Padding IN PROGRESS with
// three not-yet-started orders would make the board claim work that no bay has touched,
// which is the exact dishonesty the section exists to avoid (design section 4's
// honest-progress rule: a row carries real progress or it does not belong in the list).
// A queued order has no progress, no ETA and no bay, so it gets a COUNT beside the
// section instead: "3 queued" says the truth in three characters, and the place to act
// on those three orders is the console that owns them, one tap away.
//
// THE SECOND, LOAD-BEARING REASON THIS EXISTS: buildNeedsOrders needs it. A facility
// whose free bays are already spoken for by queued orders must not be prompted as
// "idle, go configure it" (see buildNeedsOrders' suppression rule), and that question is
// answered from these same per-facility numbers rather than from a second scan.
// ---------------------------------------------------------------------------

// One queue-capable facility's waiting work, as the board needs it.
export interface QueuedFacilitySummary {
  facility: QueueFacilityKey; // "refinery" / "fabricator" / "salvageBay"
  queued: number;             // orders WAITING here (CraftQueueView.depthUsed)
  // How many of those waiting orders the engine's OWN gate would start right now
  // (CraftQueueRow.canStart, which is QUEUE_ADAPTERS[facility].canStart, which is the
  // predicate promoteQueuedOrders itself runs). This is an UPPER BOUND on how many
  // actually promote next tick, because each row is gated against the CURRENT state and
  // a promotion consumes materials the next row was counted as affording. It is honest
  // as "at least one of these is going to take a bay", which is all the suppression rule
  // below asks of it.
  readyToStart: number;
  // Bays standing empty here right now (slotsTotal - runningCount, floored at 0; 0 when
  // a future facility has no slot model yet). This is the same arithmetic canStartLine's
  // `noSlot` gate performs, read off the queue view instead of recomputed.
  freeSlots: number;
}

// Every queue-capable facility's waiting work, plus the one number the header shows.
export interface QueuedWorkSummary {
  total: number;                        // every waiting order, all facilities
  byFacility: QueuedFacilitySummary[];  // in QUEUE_FACILITY_ORDER (the engine's own order)
}

// The ONE view model the Home screen renders from (design Section 5). `allCaughtUp`
// true => the UI shows the "All caught up, Admiral" banner instead of prompts.
export interface HomeDashboardModel {
  needsOrders: Prompt[];   // actionable idle only (Unit 2)
  inProgress: ActivityRow[]; // every running job + mission (Unit 1, this file)
  recentlyCompleted: CompletionRow[]; // finished orders, newest first (0.13.3 Unit 4.4b)
  queuedWork: QueuedWorkSummary; // orders WAITING to start, counted not listed (0.13.3 Unit 4.6)
  locked: LockedSlot[];    // not-yet-unlocked features (Unit 3)
  allCaughtUp: boolean;    // true => show the caught-up banner (Unit 2)
}

// ---------------------------------------------------------------------------
// Phase-label maps
//
// MISSION_PHASE_LABEL / PATROL_PHASE_LABEL now live in model.ts as the SINGLE source
// both this pure module and App.svelte import (0.13.1 DRY consolidation, Unit 5). They
// used to be duplicated (a file-local mirror here + one in App.svelte); the shared
// consts eliminate the drift risk. Imported at the top of this file.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

// Find the ship a captain is flying. WHY needed: a patrol row's hull/shield bars are
// fractions of the ASSIGNED ship's max pools (SHIP_TYPES[typeKey].hullIntegrity /
// shieldCapacity), and assignedCaptainId on the ship is the single source of truth for
// assignment (model.ts ShipInstance note). Returns null if no ship is assigned (the
// bars then read 0, mirroring App.svelte:8107-8110's 0-max guard).
function shipForCaptain(state: GameState, captainId: number): ShipInstance | null {
  return state.ships.find((s) => s.assignedCaptainId === captainId) ?? null;
}

// Player-facing display name for a ship: its player-chosen name if it has one, else the
// hull-type label (the same `name ?? SHIP_TYPES[typeKey].label` rule the roster uses,
// App.svelte:7462). Falls back to the raw id if the type is somehow unknown, never
// renders "undefined".
function shipDisplayName(ship: ShipInstance): string {
  return ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? ship.id;
}

// Map a facility KEY (the string carried by a facilityLevelUp effect) to its Section-8
// jump destination, or null when the facility has no Section-8 tab (Warehouse tiers
// live in the Stores bucket, which is not one of the seven jump targets). WHY a map and
// not a hard-coded target on the row: several facility kinds share the facilityUpgrade
// process, so the destination depends on WHICH facility is upgrading.
function facilityJumpTarget(facilityKey: string): JumpTarget | null {
  switch (facilityKey) {
    case "refinery":
      return "refinery";
    case "research":
      return "research";
    case "fabricator":
      return "fabricator";
    case "shipyard":
      return "shipyard";
    case "fuelStorage":
      return "fuelDepot";
    // missionControl gates the gathering/patrol missions, so its upgrade routes to the
    // Operations gathering tab (the closest Section-8 destination).
    case "missionControl":
      return "gathering";
    // warehouseT1 / warehouseT2 (and any future non-Section-8 facility): no jump target.
    default:
      return null;
  }
}

// What a generic TimedProcess renders as: its icon hint, compact primary label, and
// jump destination. Branches on `kind`, then reads the effect for the noun (item /
// blueprint / ship / facility). The DATA lookups mirror the source panels (each cited);
// the compact comma-phrasing is Home's own (design Section 6), a verb prefix added
// uniformly so a mixed board is self-describing (the source panels prefix with an arrow,
// "Refining -> [X]"; Home reads "Refining, X"). A malformed effect for a kind falls back
// to a safe, non-"undefined" label rather than throwing (this is a pure function; the UI
// still shows an honest, if generic, row).
function labelForProcess(
  process: TimedProcess,
  state: GameState,
): { icon: string; primaryLabel: string; jumpTarget: JumpTarget | null } {
  const effect = process.effect;

  switch (process.kind) {
    // Refinery (mirrors App.svelte:5162, ITEMS[itemId].label).
    case "refineJob": {
      const itemLabel = effect.type === "addItem" ? ITEMS[effect.itemId]?.label ?? effect.itemId : "material";
      return { icon: "refine", primaryLabel: `Refining, ${itemLabel}`, jumpTarget: "refinery" };
    }

    // Fabricator (mirrors App.svelte:5441). A fabricate job mints either a stackable
    // component (addItem -> ITEMS label) or a first-class equipment/weapon/drone piece
    // (addEquipment -> the blueprint's own label; the source uses instance-label helpers
    // for the exact rolled name, Home uses the blueprint label, a small simplification).
    case "fabricateJob": {
      let label = "component";
      if (effect.type === "addItem") {
        label = ITEMS[effect.itemId]?.label ?? effect.itemId;
      } else if (effect.type === "addEquipment") {
        label = BLUEPRINTS[effect.blueprintKey]?.label ?? effect.blueprintKey;
      }
      return { icon: "fabricate", primaryLabel: `Fabricating, ${label}`, jumpTarget: "fabricator" };
    }

    // Research (mirrors App.svelte:5732, BLUEPRINTS[key].label).
    case "researchProject": {
      const bpLabel = effect.type === "unlockBlueprint" ? BLUEPRINTS[effect.key]?.label ?? effect.key : "blueprint";
      return { icon: "research", primaryLabel: `Researching, ${bpLabel}`, jumpTarget: "research" };
    }

    // Shipyard (mirrors App.svelte:6581/6594, SHIP_TYPES[typeKey].label).
    case "shipBuild": {
      const hullLabel = effect.type === "addShip" ? SHIP_TYPES[effect.typeKey]?.label ?? effect.typeKey : "hull";
      return { icon: "shipBuild", primaryLabel: `Building, ${hullLabel}`, jumpTarget: "shipyard" };
    }

    // Fuel Depot (mirrors App.svelte:4992, "Status: Topping up"). The batch's own
    // progress bar + ETA convey the fill; a live tank-percent readout is a separate
    // status concern, not this process, so it is not on the row.
    case "fuelRefineJob": {
      return { icon: "fuel", primaryLabel: "Fuel Depot, topping up", jumpTarget: "fuelDepot" };
    }

    // Facility upgrade (mirrors App.svelte:3610 FACILITIES[key].label; target level is
    // the current level + 1, since the level only bumps on completion). The jump target
    // depends on WHICH facility (facilityJumpTarget), and can be null for a Warehouse tier.
    case "facilityUpgrade": {
      const facilityKey = effect.type === "facilityLevelUp" ? effect.facility : "";
      const facilityLabel = FACILITIES[facilityKey]?.label ?? facilityKey ?? "Facility";
      const currentLevel = state.facilities[facilityKey]?.level ?? 0;
      return {
        icon: "facility",
        primaryLabel: `${facilityLabel}, upgrade to Level ${currentLevel + 1}`,
        jumpTarget: facilityJumpTarget(facilityKey),
      };
    }

    // Ship Systems (equipment) storage upgrade. equipmentStorageLevel bumps on
    // completion, so the target rung is level + 1. No Section-8 tab (the Warehouse /
    // Stores bucket is not a jump target), so this is a non-navigable status row.
    case "equipmentStorageUpgrade": {
      const nextLevel = (state.equipmentStorageLevel ?? 0) + 1;
      return {
        icon: "storage",
        primaryLabel: `Ship Systems storage, upgrade to Level ${nextLevel}`,
        jumpTarget: null,
      };
    }

    // Docks expansion (docksCapacityUp bumps shipStorageCapacity by one on completion).
    // Docks share the Drydock bucket with the Shipyard, the closest Section-8 destination.
    case "docksExpansion": {
      return { icon: "docks", primaryLabel: "Docks, expand capacity", jumpTarget: "shipyard" };
    }

    // Ship repair (mirrors App.svelte:2964-2968, "Repairing <ship> ... at the Shipyard").
    // The target ship is looked up by the effect's shipId; a stale id (ship salvaged
    // mid-repair) falls back to the id string.
    case "shipRepair": {
      let shipLabel = effect.type === "clearShipDamage" ? effect.shipId : "ship";
      if (effect.type === "clearShipDamage") {
        const ship = state.ships.find((s) => s.id === effect.shipId) ?? null;
        if (ship !== null) shipLabel = shipDisplayName(ship);
      }
      return { icon: "repair", primaryLabel: `Repairing, ${shipLabel} hull`, jumpTarget: "shipyard" };
    }

    // Salvage Bay (Crafting 0.13.3, Unit 4.6). ⚠️ THIS CASE WAS THE UNIT 2.2 FLAG: when
    // "salvageJob" joined TimedProcessKind, only the COMPLETION view got a row (Unit 4.4b's
    // exhaustive COMPLETION_KIND_VIEW), so an IN-FLIGHT salvage fell through the defensive
    // default below and rendered as a bare, non-navigable "In progress". It now reads like
    // every other row: a verb, the thing it is working on, and somewhere to go.
    //
    // NAMED THROUGH craftQueue.ts's salvageTargetLabel, the SAME function the bay's queued
    // rows and its running rows already use, so one job reads identically in all three
    // places and a stale target (already gone, a fail-safe no-op at completion) degrades to
    // the raw id here exactly as it does there.
    //
    // ONE VERB FOR BOTH ARMS, deliberately. A Standard-Issue baseline is DESTROYED for
    // nothing while a crafted piece is SALVAGED, and that distinction is non-negotiable
    // where it is load-bearing: the Salvage Bay's ACTION button, which is what commits the
    // player. Once queued, the engine runs one kind of job, and the queue's own vocabulary
    // ("salvage") already carries the distinction in the NAME (a baseline names itself
    // "<Slot> · Standard-Issue"). Inventing a second verb here would give the same job two
    // readings on two screens.
    case "salvageJob": {
      const target = effect.type === "salvageResolve" ? salvageTargetLabel(state, effect.target) : null;
      return {
        icon: "salvage",
        primaryLabel: target !== null ? `Salvaging, ${target}` : "Salvaging",
        jumpTarget: "salvageBay",
      };
    }

    // Defensive fallback: an unknown TimedProcessKind (a future kind from a newer save,
    // or one added to the union without a case here). Renders an honest generic row
    // rather than "undefined". A new kind SHOULD add a case above.
    default: {
      return { icon: "activity", primaryLabel: "In progress", jumpTarget: null };
    }
  }
}

// Build the ActivityRow for one generic TimedProcess. Progress is elapsed / duration,
// guarded against a 0 duration (reads as complete, mirroring every source bar, e.g.
// App.svelte:5159). The raw remaining/duration ticks ride along for the UI's ETA.
function rowForProcess(process: TimedProcess, state: GameState): ActivityRow {
  const { icon, primaryLabel, jumpTarget } = labelForProcess(process, state);
  const progress = process.durationTicks > 0
    ? (process.durationTicks - process.remainingTicks) / process.durationTicks
    : 1;
  return {
    id: process.id,
    icon,
    primaryLabel,
    secondaryLabel: null,
    kind: "timed-job",
    progress,
    remainingTicks: process.remainingTicks,
    durationTicks: process.durationTicks,
    jumpTarget,
    combat: null,
  };
}

// Build the ActivityRow for a captain on an EXTRACTION mission (mirrors the Gathering
// IN PROGRESS card, App.svelte:7863-7874). Progress + ETA are PER-PHASE (the engine has
// no whole-mission clock for a mission, design Section 4), so remaining/duration are the
// phase's remaining/required ticks and the UI appends "in phase" itself.
function rowForExtraction(
  captain: CaptainState,
  mission: NonNullable<ReturnType<typeof extractionMissionOf>>,
): ActivityRow {
  const missionDef = MISSIONS[mission.missionKey];
  const requiredTicks = requiredTicksForPhase(mission.phase, missionDef);
  const progress = Math.min(1, mission.phaseProgressTicks / requiredTicks);
  const remainingTicks = Math.max(0, Math.ceil(requiredTicks - mission.phaseProgressTicks));
  return {
    id: `extraction-${captain.id}`,
    icon: "extraction",
    primaryLabel: `${captain.label}, ${missionDef.label}`,
    secondaryLabel: MISSION_PHASE_LABEL[mission.phase],
    kind: "extraction",
    progress,
    remainingTicks,
    durationTicks: Math.ceil(requiredTicks),
    jumpTarget: "gathering",
    combat: null,
  };
}

// Build the ActivityRow for a captain on a PATROL (mirrors the Combat IN PROGRESS card,
// App.svelte:8095-8137). A patrol has NO honest whole-clock ETA (design Section 4), so
// remaining/duration are null and `progress` is the WAVE-based fraction (resolved of
// total), never a fabricated countdown. Hull/shield are fractions of the assigned ship's
// max pools, clamped 0..1 (0 when no ship / a 0-max pool, exactly as the source guards).
function rowForPatrol(captain: CaptainState, patrol: PatrolMissionState, state: GameState): ActivityRow {
  const ship = shipForCaptain(state, captain.id);
  const shipDef = ship ? SHIP_TYPES[ship.typeKey] : null;
  const faction = FACTIONS[patrol.factionId];

  const totalWaves = patrol.waveTicks.length;
  const wavesResolved = patrol.wavesWon + patrol.wavesLost;

  const hullMax = shipDef ? shipDef.hullIntegrity : 0;
  const shieldMax = shipDef ? shipDef.shieldCapacity : 0;
  const hullFraction = hullMax > 0 ? Math.max(0, Math.min(1, patrol.playerHull / hullMax)) : 0;
  const shieldFraction = shieldMax > 0 ? Math.max(0, Math.min(1, patrol.playerShield / shieldMax)) : 0;

  const versus = faction ? ` vs ${faction.name}` : "";

  return {
    id: `patrol-${captain.id}`,
    icon: "patrol",
    primaryLabel: `${captain.label}${versus}`,
    secondaryLabel: PATROL_PHASE_LABEL[patrol.phase],
    kind: "patrol",
    progress: totalWaves > 0 ? wavesResolved / totalWaves : 0,
    remainingTicks: null,
    durationTicks: null,
    jumpTarget: "combat",
    combat: {
      hullFraction,
      shieldFraction,
      wavesResolved,
      totalWaves,
      phase: patrol.phase,
    },
  };
}

// ---------------------------------------------------------------------------
// NEEDS YOUR ORDERS: idle + actionable detection (Unit 2)
//
// THE RULE (design Section 7): a slot becomes a prompt ONLY when it is BOTH idle (no job
// running there / the captain has no mission) AND actionable (there is genuinely something
// the player could start there right now). An idle slot with NOTHING available (all
// blueprints researched, no affordable recipe, docks full, no dispatchable mission) yields
// NO prompt, so a prompt never dead-ends on an empty picker; allCaughtUp is simply "no
// prompts anywhere" (see the builder).
//
// NO RE-DERIVED ECONOMY MATH (the critical constraint): every predicate below REUSES the
// game's own single-source START gate, the EXACT function the setup UI's Start/Dispatch
// button reads, so the caught-up state cannot lie (it asks the same questions the pickers
// ask). Crucially, each of those gates ALREADY FOLDS IN the idle/slot condition for its
// slot type, so "idle AND actionable" collapses to "the real gate returns ok for at least
// one candidate", there is no separate isIdle predicate to keep in sync:
//   - Captain : canDispatch (tick.ts) returns `busy` for a captain already on a mission,
//               so only a genuinely-idle captain can produce an ok; canDispatchPatrol is
//               the combat twin. Both fold in the fuel + unlock + hull gates too.
//   - Research: canResearch (tick.ts) returns `noSlot` when every research slot is busy,
//               so an ok already implies a FREE slot (idle) plus a researchable, affordable
//               blueprint.
//   - Refinery / Fabricator: canStartLine (tick.ts) returns `noSlot` when the facility's
//               lines already fill its slot count, so an ok implies a FREE bay plus an
//               affordable recipe. (The older canFabricate/startRefineJob "jobs" path is
//               RETIRED from the UI, App.svelte:348 + :469: the LIVE model is Material
//               Lines, so canStartLine is the current Start-button source of truth. count 1
//               is the minimal startable unit the per-slot configurator itself gates on.)
//   - Shipyard: canBuildShip (tick.ts) folds in `notFounded` (shipyard established), `noSlot`
//               (no build already running), and `storageFull` (a free dock, i.e. docks NOT
//               full) plus full BOM + credit affordability, so a single ok answers "idle AND
//               a dock is free AND a hull is affordable" outright.
//
// One prompt per slot TYPE (not per candidate): a facility with several free bays still
// routes to one place, so one prompt suffices; the captain prompt aggregates the idle-and-
// dispatchable captains into a single count (they all land in the same Operations tab).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE QUEUE SUPPRESSION RULE (Crafting 0.13.3, Unit 4.6)
//
// THE BUG THIS FIXES. Before 0.13.3 a free refine/craft bay could only be filled by the
// player walking to the console, so "a bay is free and something is startable" was the
// same statement as "you need to give orders". The queue broke that equivalence: with
// orders waiting, promoteQueuedOrders fills the free bay on the NEXT TICK, entirely
// without the player. Prompting them to go configure a bay the engine is about to take
// is a prompt that clears itself one second later, and a self-clearing prompt trains the
// player to distrust the whole board.
//
// THE RULE, and why it is this and not "any queued order suppresses". Suppression is
// arithmetic on BAYS, not a boolean on "is anything queued":
//
//   suppress when  freeSlots > 0  AND  readyToStart >= freeSlots
//
//   - 1 free bay, 1 startable order queued  -> suppressed. The engine takes that bay next
//     tick. Nothing is being asked of the player.
//   - 2 free bays, 1 startable order queued -> NOT suppressed. One bay is still going to
//     be sitting empty after promotion, and the player can genuinely fill it. Blanket
//     suppression here would HIDE real idle capacity, which is the opposite failure and
//     just as dishonest.
//   - 1 free bay, 3 queued orders that are ALL BLOCKED (short on materials) -> NOT
//     suppressed. The queue is stuck, the bay will stay empty indefinitely, and something
//     else IS startable there. This is precisely when the player most needs telling.
//
// THE ONE KNOWN IMPRECISION, stated rather than hidden: readyToStart is an upper bound
// (see QueuedFacilitySummary), because each queued row is gated against the current state
// and a promotion can consume the materials the next row was counted as affording. So a
// contested-materials queue can suppress a prompt for a bay that ends up staying free for
// one more tick. Chosen deliberately: the alternative is simulating the promotion pass
// here, which would be a second implementation of the engine's own loop living in the view
// (exactly what craftQueue.ts's header forbids), and the cost of the imprecision is one
// tick of a missing prompt against a guaranteed stream of false ones.
// ---------------------------------------------------------------------------
function queueWouldFillEveryFreeBay(summary: QueuedFacilitySummary | undefined): boolean {
  if (summary === undefined) return false; // a facility with no queue view: nothing to suppress
  return summary.freeSlots > 0 && summary.readyToStart >= summary.freeSlots;
}

// Build the NEEDS YOUR ORDERS prompt list: one prompt per slot type that is idle AND
// actionable right now. PURE (reads state + the static registries, mutates nothing). An
// empty result means nothing is actionable anywhere, which the builder turns into the
// allCaughtUp banner state. Each `.some(...)` short-circuits on the first ok candidate, so
// a busy/unavailable slot costs only as many gate calls as it takes to find the first ok
// (or to exhaust a small static registry), keeping this cheap enough for the once-per-tick
// derivation (design Section 10).
//
// `queuedWork` (Unit 4.6) is passed IN rather than derived here so the whole board pays for
// exactly one buildAllCraftQueues pass: the same numbers feed the suppression rule above and
// the "N queued" readout the UI shows.
function buildNeedsOrders(state: GameState, queuedWork: QueuedWorkSummary): Prompt[] {
  const prompts: Prompt[] = [];

  // Per-facility lookup for the suppression rule (three entries, so a find is cheaper than
  // building a Map and reads more plainly).
  const queueFor = (facility: QueueFacilityKey): QueuedFacilitySummary | undefined =>
    queuedWork.byFacility.find((s) => s.facility === facility);

  // --- Captain (idle = mission == null): one aggregate prompt when at least one IDLE
  // captain can be dispatched on some unlocked mission (canDispatch) or patrol
  // (canDispatchPatrol). canGather short-circuits on the first dispatchable mission;
  // canPatrol is asked ONLY when no gathering mission is available for that captain (a
  // combat-only hull), so a freighter never pays the patrol scan.
  const missionKeys = Object.keys(MISSIONS) as MissionKey[];
  const patrolKeys = Object.keys(PATROLS) as PatrolKey[];
  let dispatchableCaptains = 0;
  let anyGathering = false; // any idle captain that can start a GATHERING mission
  for (const captain of state.captains) {
    const canGather = missionKeys.some((k) => canDispatch(state, captain.id, k).ok);
    const canPatrol = canGather
      ? false
      : patrolKeys.some((k) => canDispatchPatrol(state, captain.id, k).ok);
    if (canGather || canPatrol) {
      dispatchableCaptains += 1;
      if (canGather) anyGathering = true;
    }
  }
  if (dispatchableCaptains > 0) {
    prompts.push({
      id: "idle-captain",
      icon: "dispatch",
      label:
        dispatchableCaptains === 1
          ? "A captain is awaiting orders"
          : `${dispatchableCaptains} captains are awaiting orders`,
      detail: null,
      // Route to gathering when ANY idle captain can gather (the primary income path); fall
      // to combat only when no idle captain can gather but at least one can patrol.
      jumpTarget: anyGathering ? "gathering" : "combat",
    });
  }

  // --- Research (idle = a free research slot): a prompt when some unresearched, prereq-met,
  // affordable blueprint can be started. canResearch's noSlot gate folds in the free-slot
  // (idle) condition, so an ok answers both halves at once.
  if (Object.keys(BLUEPRINTS).some((k) => canResearch(state, k).ok)) {
    prompts.push({
      id: "idle-research",
      icon: "research",
      label: "Research bay idle",
      detail: null,
      jumpTarget: "research",
    });
  }

  // --- Refinery (idle = a free refine bay): a prompt when some refine recipe can start now.
  // count 1 is the minimal startable unit (the SAME gate + count the per-slot configurator's
  // Start button reads, App.svelte:5235); canStartLine's noSlot gate folds in the free-bay
  // (idle) condition.
  //
  // 0.13.3 Unit 4.6: ...UNLESS the queue is already going to take every free bay (see
  // queueWouldFillEveryFreeBay). The queue check runs FIRST because it is a field comparison
  // and the recipe scan is a registry walk with an affordability gate per candidate.
  if (
    !queueWouldFillEveryFreeBay(queueFor("refinery")) &&
    Object.keys(REFINE_RECIPES).some((k) => canStartLine(state, "refine", k, 1).ok)
  ) {
    prompts.push({
      id: "idle-refinery",
      icon: "refine",
      label: "Refinery bay idle",
      detail: null,
      jumpTarget: "refinery",
    });
  }

  // --- Fabricator (idle = a free fabricate bay): same shape as refinery, over the blueprint
  // registry on the "fabricate" line kind (App.svelte:5534 uses the identical gate + count),
  // including the same 0.13.3 Unit 4.6 queue suppression.
  if (
    !queueWouldFillEveryFreeBay(queueFor("fabricator")) &&
    Object.keys(BLUEPRINTS).some((k) => canStartLine(state, "fabricate", k, 1).ok)
  ) {
    prompts.push({
      id: "idle-fabricator",
      icon: "fabricate",
      label: "Fabricator bay idle",
      detail: null,
      jumpTarget: "fabricator",
    });
  }

  // --- Shipyard (idle = founded + no active build): a prompt when a hull can be built RIGHT
  // NOW. canBuildShip folds in founded (notFounded), a free build slot (noSlot), a FREE DOCK
  // (storageFull blocks when ships.length >= shipStorageCapacity), and full BOM + credit
  // affordability, so a single ok answers "idle AND a dock is free AND a hull is affordable".
  if (Object.keys(SHIP_TYPES).some((k) => canBuildShip(state, k).ok)) {
    prompts.push({
      id: "idle-shipyard",
      icon: "shipBuild",
      label: "Shipyard idle",
      detail: null,
      jumpTarget: "shipyard",
    });
  }

  // --- Facility upgrades (idle = no upgrade in flight for that facility): ONE aggregate
  // prompt counting the facilities whose NEXT upgrade is startable RIGHT NOW. canBuildFacilityUpgrade
  // (tick.ts) is the EXACT gate the facility Upgrades-tab Build button reads: it folds in the
  // track-maxed, one-upgrade-per-facility-in-flight (so an upgrade ALREADY running yields
  // not-ok and never double-counts, matching the In-Progress list), FA-level, talent,
  // research, facility-level, credit, and material gates, so this re-derives NO cost/level
  // math. Unlike the per-slot prompts above, this iterates the whole FACILITIES registry and
  // AGGREGATES into a single prompt (not one per facility) to avoid clutter at a progressed
  // player's scale (each facility routes to the same Facilities overview anyway). Up to
  // FACILITIES.length gate calls per tick, each cheap (structural checks + a tiny materials
  // loop), well within the once-per-tick budget (design Section 10).
  let upgradesReady = 0;
  let soleUpgradeKey: string | null = null; // the ONLY startable facility (meaningful iff upgradesReady === 1)
  for (const facilityKey of Object.keys(FACILITIES)) {
    if (canBuildFacilityUpgrade(state, facilityKey).ok) {
      upgradesReady += 1;
      soleUpgradeKey = facilityKey;
    }
  }
  if (upgradesReady > 0) {
    // With EXACTLY ONE upgrade available we already know WHICH facility it is, so naming it
    // and deep-linking straight to that facility (App's jumpToFacilityUpgrade maps the key to
    // its upgrade location) beats a generic "1 facility upgrade ready" that hides the info we
    // have. With several, there is no single destination, so we aggregate the count and route
    // to the Facilities OVERVIEW where every card + its live Build button is visible.
    const single = upgradesReady === 1 && soleUpgradeKey !== null;
    prompts.push({
      id: "idle-facility-upgrade",
      icon: "facility",
      label: single
        ? `${FACILITIES[soleUpgradeKey!]?.label ?? soleUpgradeKey} upgrade ready`
        : `${upgradesReady} facility upgrades ready`,
      detail: null,
      jumpTarget: "facilities",
      // Carry the facility key ONLY in the single case, so the UI deep-links to it; the
      // aggregate case leaves it unset and falls back to the overview via jumpTarget.
      ...(single ? { facilityKey: soleUpgradeKey! } : {}),
    });
  }

  return prompts;
}

// ---------------------------------------------------------------------------
// NOT YET UNLOCKED: the locked / coming-soon chips (Unit 3)
//
// TWO sources, in this order (design Section 6):
//   1. RESERVED features the game ALREADY marks locked in its own nav (the ConsoleTabs
//      carrying `locked: true`). These are STATIC (independent of save state): the reserved
//      Logistics "Crew Equipment" tab (App.svelte:1059) and the three reserved Home meta
//      tabs Achievements / Completion / Leaderboards (App.svelte:8545-8547, the reserved-tab
//      comment at App.svelte:790). Labels are mirrored VERBATIM so a rename of the real tab
//      is a one-place edit there + here (KEEP IN SYNC, same discipline as the phase-label
//      maps above). This is a CURATED subset of every `locked:true` tab, matching the
//      design's Section-6 pick (the meta / coming-soon features), NOT every locked sub-tab
//      in the app (Exploration / Battlespace / mission tiers are gameplay-tier locks the
//      dashboard intentionally does not surface here).
//   2. NOT-YET-BUILT facilities, DERIVED from state: any facility sitting at level 0 (its
//      founding / first-build rung not yet bought). In a fresh save that is the Refinery and
//      the Shipyard (plus the level-0-seeded Warehouse tiers and Fuel Depot, see the review
//      FLAG in the build report). Each renders with the real FACILITIES[key].label.
// ---------------------------------------------------------------------------

// The reserved coming-soon nav features, mirrored from the app's own `locked: true`
// ConsoleTabs (cited above). STATIC: these do not depend on GameState, so they always
// appear on the board until the corresponding feature actually ships (at which point the
// real tab loses `locked: true` and its entry here is removed in the same edit). Held as a
// module constant (allocated once) and SPREAD into a fresh array per call, so the shared
// list is never mutated and buildLocked stays pure.
const RESERVED_COMING_SOON: LockedSlot[] = [
  { id: "locked-crewEquipment", icon: "crewEquipment", label: "Crew Equipment", note: "Coming soon" },
  { id: "locked-achievements", icon: "achievements", label: "Achievements", note: "Coming soon" },
  { id: "locked-completion", icon: "completion", label: "Completion", note: "Coming soon" },
  { id: "locked-leaderboards", icon: "leaderboards", label: "Leaderboards", note: "Coming soon" },
];

// The friendly "why is this dimmed" note for a level-0 facility. The Shipyard uses the
// game's own FOUNDING language (canBuildShip's notFounded gate, tick.ts; the "FOUNDING rung"
// in model.ts), so it reads "Not founded yet"; every other facility reads "Not built yet"
// (the Facilities dashboard card's own "Status: Not built" idiom, App.svelte:4904). A tiny
// explicit mapping rather than a new data field, so it needs no model change.
function facilityLockedNote(facilityKey: string): string {
  return facilityKey === "shipyard" ? "Not founded yet" : "Not built yet";
}

// The facilities a player BUILDS FROM SCRATCH (founding), and ONLY these belong in the
// not-yet-built chip list. NOT every level-0 facility: warehouseT1 and fuelStorage are
// OPERATIONAL at level 0 (their cap / storage is usable from the start, per their model.ts
// notes), so a "Not built yet" chip would LIE about a facility that is already working;
// warehouseT2 is an internal storage tier the player does not found as a separate building.
// So this is a curated allowlist (refinery + shipyard, the design's examples and the two
// real founding rungs), keyed off level 0 so a founded one drops off automatically. A future
// foundable facility is added here EXPLICITLY, which is safer than a raw level-0 scan that
// would re-admit the operational-at-0 facilities.
const NOT_YET_BUILT_FACILITIES = ["refinery", "shipyard"] as const;

// Build the NOT YET UNLOCKED chip list (design Section 6): the static reserved features
// first, then one chip per not-yet-built FOUNDABLE facility (a NOT_YET_BUILT_FACILITIES entry
// still at level 0). PURE (reads state, mutates nothing, spreads the shared constant). A
// facility at level >= 1 (built / founded) contributes nothing. The label comes from the
// shared FACILITIES registry (never re-typed here), falling back to the raw key rather than
// rendering "undefined" if the registry somehow lacks the facility.
function buildLocked(state: GameState): LockedSlot[] {
  const locked: LockedSlot[] = [...RESERVED_COMING_SOON];

  for (const facilityKey of NOT_YET_BUILT_FACILITIES) {
    if ((state.facilities[facilityKey]?.level ?? 0) === 0) {
      locked.push({
        id: `locked-facility-${facilityKey}`,
        icon: "facility",
        label: FACILITIES[facilityKey]?.label ?? facilityKey,
        note: facilityLockedNote(facilityKey),
      });
    }
  }

  return locked;
}

// ---------------------------------------------------------------------------
// RECENTLY COMPLETED: turning stored records back into rows (0.13.3 Unit 4.4b)
// ---------------------------------------------------------------------------

// How many finished orders the Home board shows. The SAVE keeps up to
// COMPLETION_LOG_CAP (50) of them; this is just the first cut's display window, kept short
// so "what just finished" stays scannable next to IN PROGRESS. The richer, filterable
// completions interface the user asked for later reads the SAME records, deeper.
export const HOME_RECENT_COMPLETIONS_LIMIT = 8;

// How one completed KIND reads on the board.
//
// ⚠️ EXHAUSTIVE Record over TimedProcessKind, the same guard PROCESS_XP_AWARDS and
// PROCESS_COMPLETION_LOG use: a new kind cannot ship without someone writing the sentence
// the player will read. Deliberately NOT a switch with a default, unlike labelForProcess
// above (whose defensive default predates this discipline): a silent generic row is
// exactly the "silent completion" this feature exists to end.
const COMPLETION_KIND_VIEW: Record<TimedProcessKind, { verb: string; icon: string; jumpTarget: JumpTarget | null }> = {
  refineJob:               { verb: "Refined",     icon: "refine",     jumpTarget: "refinery" },
  fabricateJob:            { verb: "Fabricated",  icon: "fabricate",  jumpTarget: "fabricator" },
  researchProject:         { verb: "Researched",  icon: "research",   jumpTarget: "research" },
  shipBuild:               { verb: "Built",       icon: "shipBuild",  jumpTarget: "shipyard" },
  fuelRefineJob:           { verb: "Refined",     icon: "fuel",       jumpTarget: "fuelDepot" },
  facilityUpgrade:         { verb: "Upgraded",    icon: "facility",   jumpTarget: "facilities" },
  // No Section-8 destination for either storage track (Stores is not a jump target), so
  // these render as plain, non-navigable rows rather than routing somewhere invented.
  equipmentStorageUpgrade: { verb: "Expanded",    icon: "storage",    jumpTarget: null },
  docksExpansion:          { verb: "Expanded",    icon: "docks",      jumpTarget: "shipyard" },
  shipRepair:              { verb: "Repaired",    icon: "repair",     jumpTarget: "shipyard" },
  // 0.13.3 Unit 4.6: routes to the Salvage Bay console now that JumpTarget has a literal for
  // it. It shipped as `null` in Unit 4.4b only because the union had no Salvage Bay
  // destination at the time, not because a completed salvage has nowhere to send the player.
  salvageJob:              { verb: "Salvaged",    icon: "salvage",    jumpTarget: "salvageBay" },
};

// Resolve a record's `subjectKey` (a raw id, never a rendered string) to a display name.
// The lookup depends on the reward SHAPE, because the same field holds a blueprint key, a
// hull type key, a facility key, an item id or a ship id depending on what completed. An
// unknown key falls back to the key itself rather than rendering "undefined".
function completionSubjectLabel(entry: CompletionLogEntry, state: GameState): string | null {
  const key = entry.subjectKey;
  if (key === null) return null;
  switch (entry.reward) {
    case "blueprint":
    case "systems":
      return BLUEPRINTS[key]?.label ?? key;
    case "hull":
      // SHIP_TYPES is keyed by the narrow ShipTypeKey union while the record stores a plain
      // string (the shape rule: ids only, forward-loose). The cast is the same widening
      // labelForProcess makes above, and the `?? key` fallback keeps an unknown hull honest.
      return SHIP_TYPES[key as keyof typeof SHIP_TYPES]?.label ?? key;
    case "level":
      // The two standalone storage tracks are not FACILITIES entries, so they are named
      // here; every other key is a real facility.
      if (key === "equipmentStorage") return "Ship Systems storage";
      if (key === "docks") return "Docks";
      return FACILITIES[key]?.label ?? key;
    case "repair": {
      const ship = state.ships.find((s) => s.id === key) ?? null;
      return ship !== null ? shipDisplayName(ship) : key;
    }
    case "materials":
    case "nothing": {
      // A refine / material-fabricate subject is an item id. A salvage subject is the
      // TARGET's id, which for the material arm is also an item id and for the equipment /
      // ship arms is an instance id with no stable label left to look up (the thing was
      // consumed), so the honest answer there is no subject name at all.
      const item = ITEMS[key];
      if (item !== undefined) return item.label;
      return entry.kind === "salvageJob" ? null : key;
    }
    case "fuel":
      return null; // fuel has one name and the verb already carries it
  }
}

// The dim second line: the run detail that makes the summary honest at a glance. A batch
// says how many runs folded in; an upgrade says the level reached; a stale salvage says
// nothing was consumed. Null when there is nothing worth adding.
function completionDetail(entry: CompletionLogEntry): string | null {
  if (entry.stale) return "Nothing was consumed";
  if (entry.reward === "level" && entry.level !== null) {
    // The docks store a capacity rather than a level, so it reports berths.
    return entry.subjectKey === "docks" ? `${entry.level} berths` : `Level ${entry.level}`;
  }
  if (entry.iterations > 1) return `${entry.iterations} runs`;
  return null;
}

// Build one row from one stored record. PURE: static registry lookups plus the ship roster,
// no state mutation, no formatting of clocks or numbers (both stay the UI's job).
function rowForCompletion(entry: CompletionLogEntry, state: GameState): CompletionRow {
  const view = COMPLETION_KIND_VIEW[entry.kind];
  const subject = completionSubjectLabel(entry, state);
  // "Refined, Titanium Ingot" mirrors IN PROGRESS's own "Refining, Titanium Ingot" comma
  // phrasing, so the two sections read as one board rather than two conventions.
  const primaryLabel = subject !== null ? `${view.verb}, ${subject}` : view.verb;
  return {
    id: entry.id,
    icon: view.icon,
    primaryLabel,
    secondaryLabel: completionDetail(entry),
    atMs: entry.atMs,
    // Only honest when BOTH stamps are real; a record written without an injected clock
    // reports no duration rather than a fabricated zero.
    elapsedMs: entry.atMs > 0 && entry.startedAtMs > 0 ? Math.max(0, entry.atMs - entry.startedAtMs) : null,
    rewards: entry.items.map((r) => ({
      itemId: r.itemId,
      label: ITEMS[r.itemId]?.label ?? r.itemId,
      // Carried, not resolved to a color: the UI owns warehouseRarityColor.
      rarity: ITEMS[r.itemId]?.rarity ?? "common",
      amount: r.amount,
    })),
    jumpTarget: view.jumpTarget,
  };
}

// The NEWEST-FIRST display window over the stored ring buffer. The record array is
// chronological (oldest at index 0, the eviction end), so "newest first" is the tail
// reversed. Never mutates the stored array.
function buildRecentlyCompleted(state: GameState): CompletionRow[] {
  const log = state.completionLog ?? [];
  const window = log.slice(Math.max(0, log.length - HOME_RECENT_COMPLETIONS_LIMIT));
  return window.reverse().map((entry) => rowForCompletion(entry, state));
}

// ---------------------------------------------------------------------------
// QUEUED WORK: counting what is waiting (Crafting 0.13.3, Unit 4.6)
// ---------------------------------------------------------------------------

// Fold ONE facility's CraftQueueView into the board's summary. Reads only fields the view
// already computed (nothing is re-derived, and no gate is called a second time).
function summariseQueue(view: CraftQueueView): QueuedFacilitySummary {
  return {
    facility: view.facility,
    queued: view.depthUsed,
    readyToStart: view.queued.reduce((n, row) => (row.canStart ? n + 1 : n), 0),
    // slotsTotal is null only for a future queue-capable facility with no slot model yet;
    // "no known slots" reads as no free bays, which makes the suppression rule inert there
    // rather than making up a number (see QueuedFacilitySummary.freeSlots).
    freeSlots: view.slotsTotal === null ? 0 : Math.max(0, view.slotsTotal - view.runningCount),
  };
}

// Every queue-capable facility's waiting work, in the engine's own QUEUE_FACILITY_ORDER
// (buildAllCraftQueues iterates that tuple), so the board lists facilities in the order the
// promotion pass actually walks them.
function buildQueuedWork(state: GameState): QueuedWorkSummary {
  const byFacility = buildAllCraftQueues(state).map(summariseQueue);
  return {
    total: byFacility.reduce((n, s) => n + s.queued, 0),
    byFacility,
  };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

// Derive the Home dashboard view model from GameState. PURE: reads state, allocates a
// fresh model, mutates nothing. UNIT 1 fills the IN-PROGRESS list; UNIT 2 fills needsOrders
// (idle AND actionable slots, via buildNeedsOrders) + allCaughtUp (no prompts anywhere);
// UNIT 3 fills `locked` (reserved coming-soon features + level-0 facilities, via
// buildLocked). The signature stays (state) only: a `derived` counts
// argument (design Section 5) proved UNNECESSARY, the availability gates buildNeedsOrders
// reuses already compute their own slot counts internally (researchSlotCount /
// fabricateSlotCount / refineSlotCount / shipBuildSlotCount), so threading counts in would
// only duplicate what the gates already do. If a future unit needs a precomputed count for
// display, add it then rather than carry an unused ghost parameter now.
//
// IN-PROGRESS assembly order: every generic TimedProcess first (in state order), then
// each captain currently on a mission (patrol or extraction). Idle captains (mission ==
// null) contribute NO row (App.svelte's lists filter them out the same way).
export function buildHomeDashboard(state: GameState): HomeDashboardModel {
  const inProgress: ActivityRow[] = [];

  // 1. Every timed job (refine / fabricate / research / ship build / fuel / facility +
  //    storage + docks upgrades / repair), enumerated generically off the one array.
  for (const process of state.activeProcesses) {
    inProgress.push(rowForProcess(process, state));
  }

  // 2. Every captain mission, split into its two arms. extractionMissionOf narrows the
  //    extraction arm; the patrol arm is hand-narrowed on the kind discriminant (there is
  //    no patrolMissionOf helper, matching App.svelte:8095). An idle captain matches
  //    neither and adds nothing.
  for (const captain of state.captains) {
    const extraction = extractionMissionOf(captain);
    if (extraction !== null) {
      inProgress.push(rowForExtraction(captain, extraction));
      continue;
    }
    if (captain.mission !== null && captain.mission.kind === "patrol") {
      inProgress.push(rowForPatrol(captain, captain.mission, state));
    }
  }

  // Unit 4.6: what is WAITING to start, counted per facility. Derived BEFORE needsOrders
  // because the prompts depend on it: a bay the queue is about to fill is not a bay that
  // needs orders (see queueWouldFillEveryFreeBay). One pass serves both.
  const queuedWork = buildQueuedWork(state);

  // Unit 2: the idle-and-actionable prompts. allCaughtUp is exactly "no prompts anywhere"
  // (design Section 7 outcome 3): every bay is busy or has nothing available, so the UI
  // shows the earned-breather banner instead of a prompt list. This is independent of
  // whether anything is IN PROGRESS, an all-busy fleet with no new work is still caught up.
  const needsOrders = buildNeedsOrders(state, queuedWork);

  // Unit 3: the not-yet-unlocked chips (reserved coming-soon nav features + any level-0
  // facility). Independent of needsOrders / inProgress: a locked slot is a "here's what's
  // coming" affordance, not an action, so it never affects allCaughtUp.
  const locked = buildLocked(state);

  // Unit 4.4b: the finished-orders companion to inProgress, newest first. Independent of
  // every other section: a completed order is a RECORD, not an action, so it never affects
  // allCaughtUp (a caught-up fleet with a full history is still caught up).
  const recentlyCompleted = buildRecentlyCompleted(state);

  return {
    needsOrders,
    inProgress,
    recentlyCompleted,
    // Unit 4.6: a COUNT, never rows. Like recentlyCompleted it never affects allCaughtUp:
    // a queued order is work the player has ALREADY ordered, so a fleet with a full queue
    // and nothing else to decide is genuinely caught up (indeed the suppression rule above
    // is what makes that reading true rather than merely tidy).
    queuedWork,
    locked,
    allCaughtUp: needsOrders.length === 0,
  };
}
