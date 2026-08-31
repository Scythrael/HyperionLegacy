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
  type CaptainState,
  type PatrolMissionState,
  type PatrolPhase,
  type MissionPhase,
  type ShipInstance,
  ITEMS,
  BLUEPRINTS,
  SHIP_TYPES,
  FACILITIES,
  FACTIONS,
  MISSIONS,
  requiredTicksForPhase,
  extractionMissionOf,
} from "./model";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

// The nav destinations a Home row/prompt can jump to (design Section 8). A flat
// string union, one literal per setup tab the dashboard routes into, so the Unit 3
// jumpToActivity(target) dispatcher is a single typed switch. Kept to EXACTLY the
// seven Section-8 destinations; a running row whose real destination is not one of
// these (a Warehouse or Ship-Systems-storage upgrade, see labelForProcess) carries a
// null jumpTarget instead of an invented one, and the UI renders it as a plain,
// non-navigable status row.
export type JumpTarget =
  | "gathering"
  | "combat"
  | "research"
  | "refinery"
  | "fabricator"
  | "shipyard"
  | "fuelDepot";

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
}

// One NOT-YET-UNLOCKED slot (dimmed chip, bottom). STUB in Unit 1 (Unit 3 fills it).
// A feature the player has not unlocked yet, shown via the game's "coming soon" idiom.
export interface LockedSlot {
  id: string;          // stable slot id (e.g. "locked-crewEquipment")
  icon: string;        // icon hint
  label: string;       // the locked feature's name
  note: string | null; // optional "Coming soon" / unlock-hint sub-line
}

// The ONE view model the Home screen renders from (design Section 5). `allCaughtUp`
// true => the UI shows the "All caught up, Admiral" banner instead of prompts.
export interface HomeDashboardModel {
  needsOrders: Prompt[];   // actionable idle only (Unit 2)
  inProgress: ActivityRow[]; // every running job + mission (Unit 1, this file)
  locked: LockedSlot[];    // not-yet-unlocked features (Unit 3)
  allCaughtUp: boolean;    // true => show the caught-up banner (Unit 2)
}

// ---------------------------------------------------------------------------
// Phase-label maps (local mirror)
//
// WHY these live here and not imported: App.svelte's MISSION_PHASE_LABEL /
// PATROL_PHASE_LABEL are file-local `const`s (not exported), and this pure module
// must not depend on the Svelte component. They are duplicated here verbatim so the
// module stays UI-agnostic and testable. KEEP IN SYNC: a phase added to MissionPhase
// or PatrolPhase in model.ts must be added in BOTH places (App.svelte and here); a
// missing entry renders "undefined". A future consolidation could move these maps into
// model.ts as the single source, that is a deferred nicety, not Unit 1's job.
// ---------------------------------------------------------------------------

// Mirrors App.svelte:611-617 (MISSION_PHASE_LABEL).
const MISSION_PHASE_LABEL: Record<MissionPhase, string> = {
  ordersReceived: "Orders Received",
  transitOut: "Transiting Out",
  extracting: "Extracting",
  transitBack: "Transiting Back",
  unloading: "Unloading",
};

// Mirrors App.svelte:625-630 (PATROL_PHASE_LABEL).
const PATROL_PHASE_LABEL: Record<PatrolPhase, string> = {
  transitOut: "Transiting Out",
  engaging: "Engaging",
  transitBack: "Returning",
  limpingHome: "Limping Home",
};

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
// The builder
// ---------------------------------------------------------------------------

// Derive the Home dashboard view model from GameState. PURE: reads state, allocates a
// fresh model, mutates nothing. UNIT 1 fills the IN-PROGRESS list ONLY; needsOrders,
// locked, and allCaughtUp are deliberate stubs (Units 2 and 3). The signature is
// intentionally (state) only for now: Units 2/3 will add a `derived` counts argument
// (design Section 5) rather than have Unit 1 carry an unused ghost parameter.
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

  return {
    needsOrders: [], // STUB: Unit 2 (idle detection + isActionable predicates)
    inProgress,
    locked: [],      // STUB: Unit 3 (locked slots)
    allCaughtUp: false, // STUB: Unit 2 (nothing actionable anywhere)
  };
}
