<script lang="ts">
  // ============================================================================
  // ShipSystemsPanel.svelte
  // Author: Claude (Opus 4.8) | 2026-07-18
  //
  // The REAL, player-facing "Ship Systems" screen for one selected ship (the
  // 0.11.0 equipment-fitting UI, replacing the DEV_MODE-only harness in
  // App.svelte for actual play). It is a pure PRESENTATION + INTERACTION piece:
  //   - It READS live state through the already-tested equipment helpers
  //     (equippedFor / fittedInSlot / canFitEquipment) and the derived-stat
  //     projection (shipDerivedStats). It does NOT reimplement any game logic.
  //   - It never mutates game state directly. Install / Uninstall bubble UP to
  //     the host (App.svelte) via the onInstall / onUninstall callbacks, so the
  //     single source of truth for the fit + its persistence (fitEquipment /
  //     unfitEquipment + doSave) stays in one place. When the host reassigns the
  //     `state` prop after a fit, every derived value below recomputes.
  //
  // USER-FACING WORDING: this screen says "Ship Systems" and "Install/Uninstall".
  // The CODE vocabulary underneath is unchanged (equipment / fitEquipment /
  // EquipmentInstance); only the display strings differ.
  //
  // Layout (matches the user-approved mockup):
  //   HEADER  , title + hull name + commanding captain (portrait placeholder).
  //   MAIN    , LEFT: an SVG placeholder ship with the singleton system slots
  //             overlaid at their hull positions + the install/uninstall control
  //             for the selected slot. RIGHT: a scrollable, categorized stats
  //             panel (Live section = real base-vs-fitted deltas; Defensive
  //             section = inert 0.12.0 combat placeholders).
  //   BOTTOM  , reserved WEAPONS + MODULES rows (empty, 0.12.0).
  // ============================================================================

  import type {
    GameState,
    EquipmentInstance,
    EquipmentSlotType,
    ShipDerivedStats,
  } from "./game/model";
  import { SHIP_TYPES, EQUIPMENT_SLOTS, shipDerivedStats } from "./game/model";
  import type { EquipFitBlockReason } from "./game/equipment";
  import { equippedFor, fittedInSlot, canFitEquipment } from "./game/equipment";
  // Combat 1.0 (Unit 1.8b): the combat-fit read helpers. combatHullTypeOf gates the
  // combat-only surfaces (weapon strip + banner + combat readout) to real combat hulls;
  // computeCombatReadout folds the installed combat gear into the readout the panel
  // shows; weaponDisplayName + WEAPON_DEFS resolve a weapon's player-facing name +
  // family (for the family-color dot). These are READ-ONLY: the panel presents them,
  // it never reimplements the combat fold (that stays in combat/bridge.ts).
  import { combatHullTypeOf, type CombatHullType } from "./game/combat/bridge";
  import { computeCombatReadout, type RequiredCombatSlot } from "./game/combatFit";
  import { weaponDisplayName } from "./game/combat/combatView";
  import { WEAPON_DEFS } from "./game/combat/weapons";
  // The SAME reusable rarity-bordered card the Warehouse Ship Systems bay uses (D1).
  // Reused here so a fitted slot's readout shows the piece's identity + granted stats
  // in EXACTLY the format the bay does, one card component, no second stat renderer to
  // drift. The Uninstall control is injected into its footer <slot>.
  import EquipmentTooltip from "./EquipmentTooltip.svelte";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here); `shipId` selects the ship
  // this panel is fitting. The three callbacks route every side-effect back to
  // the host so persistence + logging happen exactly once, in App.svelte.
  export let state: GameState;
  export let shipId: string;
  export let onInstall: (shipId: string, instanceId: string) => void;
  // Combat 1.0 (Unit 1.8b): uninstall is now BY INSTANCE ID, not by slotType. A weapon
  // is a MULTI slot (several pieces per hull), so "uninstall the weapon" is ambiguous
  // without an id; the host routes this to unfitEquipmentInstance, which uninstalls the
  // exact piece the player tapped (economy slots keep the never-empty restore, combat
  // slots are left bare). Every slot, singleton or weapon, uninstalls through this one
  // instance-targeted callback (the "one consistent flow" directive).
  export let onUninstall: (shipId: string, instanceId: string) => void;
  export let onClose: () => void;

  // --- Slot layout ------------------------------------------------------------
  // The 11 SINGLETON system slots and where they sit on the overhead ship
  // graphic. `top`/`left` are PERCENTAGES of the graphic box (which matches the
  // SVG's 300x400 viewBox), used to absolutely position each node's CENTER.
  //   live          , true for the four slots that actually accept gear this
  //                   patch (cargoBay / ftlDrive / reactorCore / specUtility).
  //                   The rest are RESERVED (0.12.0 combat/crew), shown as
  //                   dimmed, non-installable nodes so the grid is complete now.
  //   prospectorOnly, specUtility (the Prospecting Rig slot) exists only on
  //                   Prospector hulls (design doc: the Freighter has no Spec
  //                   Utility slot), so it is hidden on non-Prospector hulls.
  type SlotMeta = {
    slotType: EquipmentSlotType;
    code: string; // short node code (SNS / COK / ...)
    label: string; // full slot name shown in the hover tooltip
    live: boolean;
    prospectorOnly?: boolean;
    top: number; // % of the graphic box (node center)
    left: number; // % of the graphic box (node center)
  };
  const SLOT_LAYOUT: SlotMeta[] = [
    { slotType: "sensor", code: "SNS", label: "Sensor Array", live: false, top: 5, left: 50 },
    { slotType: "bridge", code: "BRG", label: "Bridge Module", live: false, top: 24, left: 50 },
    { slotType: "quarters", code: "QTR", label: "Crew Quarters", live: false, top: 25, left: 32 },
    { slotType: "thrusters", code: "THR", label: "Thrusters", live: false, top: 25, left: 68 },
    { slotType: "cargoBay", code: "CRG", label: "Cargo Bay", live: true, top: 41, left: 50 },
    // FLANK ROW across the engineering hull + nacelles (far left -> far right):
    // Combat 1.0 (Unit 1.8b): shieldEmitters + hullPlating are now LIVE (installable). They
    // are SINGLETONS exactly like the economy slots (install replaces, uninstall leaves the
    // slot bare), so they reuse the identical selected-slot + spare-pool flow below.
    { slotType: "shieldEmitters", code: "SHD", label: "Shield Emitter", live: true, top: 59, left: 13 },
    { slotType: "propellantTanks", code: "PRP", label: "Propellant Tanks", live: false, top: 59, left: 35 },
    { slotType: "reactorCore", code: "RCT", label: "Reactor Core", live: true, top: 59, left: 50 },
    { slotType: "specUtility", code: "SUS", label: "Spec Utility", live: true, prospectorOnly: true, top: 59, left: 65 },
    { slotType: "hullPlating", code: "HUL", label: "Hull Plating", live: true, top: 59, left: 87 },
    { slotType: "ftlDrive", code: "FTL", label: "FTL Drive", live: true, top: 90, left: 50 },
  ];

  // Short, human-readable label for each live equipment stat key, used in the
  // compact system descriptors below (the piece's signature stat line).
  const STAT_LABEL: Record<string, string> = {
    cargoCapacity: "Cargo",
    transitSpeedMult: "FTL Speed",
    engineEfficiency: "Fuel Eff",
    fuelCapacity: "Fuel Cap",
    extractionYieldMult: "Yield",
    powerOutput: "Power",
    massReduction: "-Mass",
    powerDrawReduction: "-Draw",
    sensors: "Sensors",
    materialQualityChance: "Mat Quality",
  };

  // Captain-specialization display names (the CaptainTalentBranch -> title map the
  // spec cards already establish). Shown as flavor under the commanding captain.
  const SPEC_LABEL: Record<string, string> = {
    resourcefulness: "Prospector",
    tactical: "Tactician",
    science: "Explorer",
  };

  // --- Local UI state ---------------------------------------------------------
  // The currently opened SINGLETON slot (economy + shieldEmitters + hullPlating);
  // its install/uninstall control is shown, or null when none is open.
  let selectedSlot: string | null = null;
  // The currently opened WEAPON HARDPOINT cell (Combat 1.0, Unit 1.8b): the 0-based
  // index of the tapped hardpoint, or null. Kept SEPARATE from selectedSlot because a
  // weapon is a MULTI slot (many pieces share slotType "weapon"), so a single slotType
  // key cannot identify which hardpoint is open. selectedSlot and selectedHardpoint are
  // MUTUALLY EXCLUSIVE (selecting one clears the other) so only ONE control shows.
  let selectedHardpoint: number | null = null;
  // The currently opened DRONE BAY cell (Combat 1.0, Unit 2.4): the 0-based index of the
  // tapped bay, or null. EXACTLY parallel to selectedHardpoint (a drone bay is the OTHER
  // MULTI slot, so an index, not a slotType, identifies which bay is open), and part of
  // the same MUTUAL EXCLUSIVITY set as selectedSlot + selectedHardpoint (selecting any one
  // clears the other two) so only ONE control ever shows.
  let selectedBay: number | null = null;

  // Reset the open selections whenever the panel switches to a different ship, so a
  // stale selection from the previous ship never carries over. Guarded on a
  // change of `shipId` only (not a general reactive) so it cannot loop.
  let lastShipId: string | null = null;
  $: if (shipId !== lastShipId) {
    lastShipId = shipId;
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = null;
  }

  // --- Derived reads ----------------------------------------------------------
  // DELIBERATE render-boundary defense, diverging from the engine's fail-loud posture
  // ON PURPOSE. The equipment pool is guaranteed present (freshState seeds it + the
  // v27->v28 migration backfills every save), so the ENGINE (tick.ts / save.ts) reads
  // state.equipment directly and THROWS on a genuinely-missing pool, because a missing
  // pool there is a real bug that would corrupt economy math. A UI RENDER is different:
  // a malformed / partially-migrated state reaching this panel should degrade to an
  // empty "no gear" view rather than white-screen the whole app, so this one surface
  // keeps the `?? []` guard.
  $: equipmentPool = state.equipment ?? [];
  // A state view with a guaranteed-present equipment array for the helper calls
  // (equippedFor / fittedInSlot / canFitEquipment all read state.equipment).
  $: safeState = { ...state, equipment: equipmentPool };

  $: ship = state.ships.find((s) => s.id === shipId) ?? null;
  $: shipDef = ship ? SHIP_TYPES[ship.typeKey] : null;
  $: assignedCaptain =
    ship && ship.assignedCaptainId !== null
      ? state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null
      : null;
  $: isProspectorHull = shipDef?.spec === "prospector";
  $: onMission = assignedCaptain !== null && assignedCaptain.mission !== null;

  // The slots actually shown for THIS hull: drop specUtility on non-Prospectors, and
  // drop the combat singleton slots (shield emitter / hull plating) on non-combat hulls.
  // The combat slots are gated to combat hulls to match the weapon strip / blocker banner /
  // combat readout (all isCombatHull-gated): an economy hull can never patrol, so showing it
  // installable combat gear would be a dead-end trap with no combat readout to explain it.
  $: visibleSlots = SLOT_LAYOUT.filter((s) => {
    if (s.prospectorOnly && !isProspectorHull) return false;
    if ((s.slotType === "shieldEmitters" || s.slotType === "hullPlating") && !isCombatHull) return false;
    return true;
  });

  // Reactive per-slot "what is installed here" map, keyed by slotType. CRITICAL
  // for correct redraws: the slot NODES (their gold install-status dot + hover
  // tooltip) must recompute when a fit changes, but Svelte only tracks the
  // reactive variables it sees SYNTACTICALLY in a template expression. A helper
  // like fittedInSlot(...) reads `safeState` INSIDE the function, hiding that
  // dependency from the compiler, so a title/class bound to such a call would go
  // stale after an install/uninstall. Precomputing this map (a real reactive var
  // that DOES change when safeState/ship change) and reading map[slotType] in the
  // template makes the dependency visible, so the nodes refresh correctly. Only
  // live slots can hold a piece; reserved slots map to null.
  $: fittedBySlot = (() => {
    const map: Record<string, EquipmentInstance | null> = {};
    for (const meta of SLOT_LAYOUT) {
      map[meta.slotType] = ship && meta.live ? fittedInSlot(safeState, shipId, meta.slotType) : null;
    }
    return map;
  })();

  // BASE (bare hull) vs FITTED (equipped pieces folded in) derived stats.
  $: baseStats = ship ? shipDerivedStats(ship, []) : null;
  $: fittedPieces = ship ? equippedFor(safeState, shipId) : [];
  $: fitStats = ship ? shipDerivedStats(ship, fittedPieces) : null;

  // The Live-section rows (real numbers). `kind` picks the formatter: percent for
  // the multiplier / 0-based-bonus stats, flat for capacities / power / mass.
  type StatRow = { label: string; base: number; fitted: number; kind: "flat" | "pct" };
  function buildLiveRows(base: ShipDerivedStats, fit: ShipDerivedStats): StatRow[] {
    return [
      { label: "Cargo Capacity", base: base.cargoCapacity, fitted: fit.cargoCapacity, kind: "flat" },
      { label: "FTL Speed", base: base.transitSpeedMult, fitted: fit.transitSpeedMult, kind: "pct" },
      { label: "Fuel Efficiency", base: base.engineEfficiency, fitted: fit.engineEfficiency, kind: "pct" },
      { label: "Fuel Capacity", base: base.fuelCapacity, fitted: fit.fuelCapacity, kind: "flat" },
      { label: "Extraction Yield", base: base.extractionYieldMult, fitted: fit.extractionYieldMult, kind: "pct" },
      { label: "Power Output", base: base.powerOutput, fitted: fit.powerOutput, kind: "flat" },
      { label: "Power Draw", base: base.powerDraw, fitted: fit.powerDraw, kind: "flat" },
      { label: "Mass", base: base.mass, fitted: fit.mass, kind: "flat" },
    ];
  }
  $: liveStatRows = baseStats && fitStats ? buildLiveRows(baseStats, fitStats) : [];

  // --- Combat reads (Combat 1.0, Unit 1.8b) -----------------------------------
  // A ship is a COMBAT hull (destroyer/battleship/carrier) or not. combatHullTypeOf
  // returns the CombatHullType or null; only combat hulls get the weapon strip, the
  // dispatch-blocker banner, and the combat readout (an economy hull can never patrol
  // and carries no combat gear, so those surfaces would be meaningless on one).
  $: combatHullType = ship ? combatHullTypeOf(ship.typeKey) : null;
  $: isCombatHull = combatHullType !== null;

  // The folded combat readout (hull frame+plating, shield pool/recharge, mounted
  // weapons, and which required slots are still empty). Derived from the SAME
  // fittedPieces the live stats use, so it recomputes on every install/uninstall.
  // Null for a non-combat hull (no combat section is shown there).
  $: combatReadout =
    ship && shipDef && isCombatHull
      ? computeCombatReadout(
          fittedPieces,
          shipDef.hullIntegrity,
          shipDef.weaponHardpoints,
          // Drone bays are carrier-only (SHIP_TYPES[hull].droneBays is absent/0 elsewhere);
          // the readout carries mountedPods + droneBayCap so the drone strip + DRONES section
          // read from the SAME fold as the weapon strip. Nullish-guarded to 0 for a combat
          // hull with no bays (destroyer / battleship).
          shipDef.droneBays ?? 0
        )
      : null;

  // The installed weapons, in fitted order, one per filled hardpoint cell (Combat
  // 1.0, Unit 1.8b). Empty cells run from mountedWeapons.length up to the hull's cap.
  $: mountedWeapons = combatReadout ? combatReadout.mountedWeapons : [];
  $: hardpointCap = combatReadout ? combatReadout.hardpointCap : 0;
  // hardpointsFull: every hardpoint is occupied, so no further weapon can be installed
  // (the strip disables install + shows "hardpoints full"). Mirrors canFitEquipment's
  // hardpointsFull gate so the two never disagree.
  $: hardpointsFull = combatReadout !== null && mountedWeapons.length >= hardpointCap;

  // The spare WEAPONS in storage (fittedToShipId null), the install pool for an empty
  // hardpoint. Weapons are the one MULTI slot, so this is queried by slotType directly
  // (parallel to selectedSpares for the singleton slots).
  $: spareWeapons = equipmentPool.filter((e) => e.fittedToShipId === null && e.slotType === "weapon");

  // The required combat slots still EMPTY (drives the dispatch-blocker banner). Empty
  // array => the ship's required combat slots are all filled (dispatchable, slot-wise).
  $: missingRequired = combatReadout ? combatReadout.missingRequired : [];

  // --- Drone bay reads (Combat 1.0, Unit 2.4) --------------------------------------
  // EXACTLY mirrors the weapon-hardpoint reads above, for the OTHER MULTI slot (droneBay).
  // The installed drone pods, in fitted order, one per filled bay cell. Empty cells run
  // from mountedPods.length up to the bay cap.
  $: mountedPods = combatReadout ? combatReadout.mountedPods : [];
  $: droneBayCap = combatReadout ? combatReadout.droneBayCap : 0;
  // hasDroneBays: this hull actually has drone bays (carriers only; droneBays > 0). Gates
  // the whole drone strip + the DRONES readout section, the way isCombatHull gates the
  // weapon surfaces, so a non-carrier never shows an empty drone strip it can never fill.
  $: hasDroneBays = droneBayCap > 0;
  // baysFull: every drone bay is occupied, so no further pod can be installed (the strip
  // disables install + shows "bays full"). Mirrors canFitEquipment's baysFull gate so the
  // two never disagree. The droneBayCap > 0 guard keeps it false on a non-carrier (where
  // 0 pods >= 0 bays would otherwise read "full"), though the strip is hidden there anyway.
  $: baysFull = combatReadout !== null && droneBayCap > 0 && mountedPods.length >= droneBayCap;

  // The spare DRONE PODS in storage (fittedToShipId null), the install pool for an empty
  // bay. Pods are a MULTI slot, so this is queried by slotType directly (parallel to
  // spareWeapons for weapons).
  $: sparePods = equipmentPool.filter((e) => e.fittedToShipId === null && e.slotType === "droneBay");

  // Reserved bottom-bar module count, capped at 7 empty display slots (weapons moved
  // to the live hardpoint strip; modules stay reserved for a later combat unit).
  $: moduleCount = shipDef ? Math.min(7, shipDef.moduleSlots) : 0;

  // The selected slot's context (only meaningful for a LIVE slot).
  $: selectedMeta = selectedSlot ? visibleSlots.find((s) => s.slotType === selectedSlot) ?? null : null;
  $: selectedFitted =
    selectedSlot && ship ? fittedInSlot(safeState, shipId, selectedSlot as EquipmentSlotType) : null;
  $: selectedSpares = selectedSlot
    ? equipmentPool.filter((e) => e.fittedToShipId === null && e.slotType === selectedSlot)
    : [];

  // --- Formatting helpers -----------------------------------------------------
  // shipDerivedStats returns PLAIN numbers (not Decimals), so we format locally.
  function fmtFlat(v: number): string {
    return Number.isInteger(v) ? v.toString() : v.toFixed(1);
  }
  function fmtPct(v: number): string {
    return (v * 100).toFixed(0) + "%";
  }
  // The signed base->fitted change, or null when it is effectively zero (so the
  // row simply omits a delta rather than showing "+0"). Percent stats report in
  // percentage POINTS; flat stats report the raw difference.
  function fmtDelta(row: StatRow): string | null {
    const d = row.fitted - row.base;
    if (Math.abs(d) < 1e-9) return null;
    const sign = d > 0 ? "+" : "";
    if (row.kind === "pct") return `${sign}${(d * 100).toFixed(1)} pts`;
    return `${sign}${fmtFlat(Number(d.toFixed(1)))}`;
  }
  function fmtStat(row: StatRow, which: "base" | "fitted"): string {
    const v = which === "base" ? row.base : row.fitted;
    return row.kind === "pct" ? fmtPct(v) : fmtFlat(v);
  }

  // Compact one-line descriptor for a system: rarity + quality + its signature
  // implicit stat, plus mass / power draw. Enough to tell two spares apart.
  function pieceDesc(p: EquipmentInstance): string {
    const keys = Object.keys(p.implicitStats);
    const sig =
      keys.length > 0 ? ` ${STAT_LABEL[keys[0]] ?? keys[0]} +${p.implicitStats[keys[0]].toFixed(1)}` : "";
    return `${p.rarity} q${p.quality}${sig}`;
  }
  function pieceSubline(p: EquipmentInstance): string {
    return `mass ${p.mass.toFixed(0)} · draw ${p.powerDraw.toFixed(0)}`;
  }

  // Human-readable text for a blocked-install reason (mirrors the dev panel's
  // mapper). Total over EquipFitBlockReason (a switch, no default) so a new token
  // surfaces as a compile error here rather than a silent blank.
  function reasonText(reason: EquipFitBlockReason): string {
    switch (reason) {
      case "noInstance":
        return "system no longer exists";
      case "noShip":
        return "ship no longer exists";
      case "onMission":
        return "captain is on a mission (install locked)";
      case "hullSpec":
        return "wrong hull type for this system";
      case "captainSpec":
        return "captain specialization does not match";
      case "captainSpecParked":
        return "assign a matching captain first (hull is parked)";
      case "slotNotInstallable":
        return "this system cannot be installed";
      case "hardpointsFull":
        return "all weapon hardpoints are full (uninstall a weapon first)";
      case "baysFull":
        return "all drone bays are full (uninstall a drone pod first)";
    }
  }

  // Tooltip text for a slot node: full slot name + what is installed (live) or a
  // "reserved" note. Takes the resolved fitted piece (from the reactive
  // fittedBySlot map) as an ARG so the compiler tracks the dependency at the call
  // site, rather than reading state inside here (see fittedBySlot above).
  function slotTitle(meta: SlotMeta, fitted: EquipmentInstance | null): string {
    if (!meta.live) return `${meta.label}: reserved (0.12.0 combat update)`;
    return fitted ? `${meta.label}: ${pieceDesc(fitted)}` : `${meta.label}: empty`;
  }

  // --- Combat display helpers (Combat 1.0, Unit 1.8b) -------------------------
  // Player-facing label for each required combat slot, for the dispatch-blocker
  // banner. Total over RequiredCombatSlot (a switch, no default) so a new required
  // slot is a compile error here rather than a silent blank in the banner.
  function requiredSlotLabel(slot: RequiredCombatSlot): string {
    switch (slot) {
      case "weapon":
        return "a weapon";
      case "shieldEmitters":
        return "a shield emitter";
      case "hullPlating":
        return "hull plating";
    }
  }

  // The dispatch-blocker sentence BODY (the markup prepends a bold "Cannot patrol:"):
  // "install a weapon, a shield emitter and hull plating to make this ship dispatchable."
  // Built from the missing-required list so it names EXACTLY the empty slots (the same
  // slots canDispatchPatrol would block on). Only shown when the list is non-empty (see
  // the {#if} in the markup), so this always has >=1 item.
  function blockerText(missing: RequiredCombatSlot[]): string {
    const parts = missing.map(requiredSlotLabel);
    const list =
      parts.length === 1
        ? parts[0]
        : parts.length === 2
          ? `${parts[0]} and ${parts[1]}`
          : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `install ${list} to make this ship dispatchable.`;
  }

  // A weapon's FAMILY color for the strip's family dot. The three families read a
  // stable, distinct color regardless of the user's theme accent: kinetic -> warning
  // (amber), particle -> accent (cyan), ew -> a fixed violet (the same purple the
  // EquipmentTooltip uses for its radiant rung). WEAPON_DEFS owns the family; an
  // unknown/absent weaponType falls back to the dim text color (never blank).
  function weaponFamilyColor(weaponType: string | undefined): string {
    const family = weaponType ? WEAPON_DEFS[weaponType as keyof typeof WEAPON_DEFS]?.family : undefined;
    switch (family) {
      case "kinetic":
        return "var(--color-warning)";
      case "particle":
        return "var(--color-accent)";
      case "ew":
        return "#a855f7";
      default:
        return "var(--color-text-dim)";
    }
  }

  // A weapon piece's display NAME (weapons.ts roster name via weaponDisplayName) and
  // its rarity + iL sub-line, for the strip cell + the offense readout.
  function weaponName(piece: EquipmentInstance): string {
    return weaponDisplayName(piece.weaponType);
  }
  function weaponSub(piece: EquipmentInstance): string {
    const rar = piece.rarity.charAt(0).toUpperCase() + piece.rarity.slice(1);
    return `${rar} · iL ${piece.iLevel}`;
  }
  // A weapon's yield range for the offense readout: the base template yield (WEAPON_DEFS)
  // plus the piece's weaponYield bonus (implicit signature + rolled affix), matching the
  // combat/bridge weaponInstanceFromGear fold so the readout equals what the sim fires.
  function weaponYieldRange(piece: EquipmentInstance): string {
    const def = piece.weaponType ? WEAPON_DEFS[piece.weaponType as keyof typeof WEAPON_DEFS] : undefined;
    if (!def) return "";
    const bonus = (piece.implicitStats.weaponYield ?? 0) + (piece.rolledStats.weaponYield ?? 0);
    return `${def.yieldMin + bonus}-${def.yieldMax + bonus}`;
  }

  // --- Drone display helpers (Combat 1.0, Unit 2.4) ---------------------------
  // The DRONE analogue of weaponFamilyColor / weaponName / weaponSub above. A pod's
  // identity in the strip is its squadron ROLE (attack / defense / support), so these
  // resolve the role color dot, the role name, and the rarity + iL sub-line. Typed on a
  // plain string (like weaponFamilyColor's weaponType) so no combat/ type is needed here.
  //
  // Role -> a stable, distinct indicator color, read as theme tokens so it recolors with
  // the theme: attack -> danger (its offense identity), defense -> accent (its shielding
  // identity), support -> success (its repair identity). An absent/unknown role falls back
  // to the dim text color (never blank), exactly as weaponFamilyColor does for a bad family.
  function droneRoleColor(role: string | undefined): string {
    switch (role) {
      case "attack":
        return "var(--color-danger)";
      case "defense":
        return "var(--color-accent)";
      case "support":
        return "var(--color-success)";
      default:
        return "var(--color-text-dim)";
    }
  }
  // A pod's player-facing ROLE name (Attack / Defense / Support). Fallback "Drone pod" for
  // an absent/unknown role, mirroring weaponName's "weapons" fallback (never blank).
  function droneRoleName(role: string | undefined): string {
    switch (role) {
      case "attack":
        return "Attack";
      case "defense":
        return "Defense";
      case "support":
        return "Support";
      default:
        return "Drone pod";
    }
  }
  // A pod's rarity + iL sub-line, IDENTICAL in shape to weaponSub (a pod carries rarity /
  // iLevel like any piece). Kept as its own explicit helper, parallel to weaponSub, so the
  // drone strip reads self-describingly rather than borrowing a weapon-named function.
  function podSub(piece: EquipmentInstance): string {
    const rar = piece.rarity.charAt(0).toUpperCase() + piece.rarity.slice(1);
    return `${rar} · iL ${piece.iLevel}`;
  }

  // --- Interaction ------------------------------------------------------------
  // Clicking a slot toggles its control open/closed. Reserved slots still open
  // (to show their "reserved" note), so the click target is consistent. Selecting a
  // singleton slot CLEARS any open hardpoint (mutual exclusivity: one control at a time).
  function selectSlot(meta: SlotMeta): void {
    selectedHardpoint = null;
    selectedBay = null;
    selectedSlot = selectedSlot === meta.slotType ? null : meta.slotType;
  }
  // Clicking a weapon hardpoint cell toggles its control open/closed, clearing any open
  // singleton slot + drone bay (mutual exclusivity). The index identifies WHICH hardpoint
  // is open.
  function selectHardpoint(index: number): void {
    selectedSlot = null;
    selectedBay = null;
    selectedHardpoint = selectedHardpoint === index ? null : index;
  }
  // Clicking a drone bay cell toggles its control open/closed, clearing any open singleton
  // slot + weapon hardpoint (mutual exclusivity). The index identifies WHICH bay is open.
  // EXACTLY parallel to selectHardpoint (a drone bay is the other MULTI slot).
  function selectBay(index: number): void {
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = selectedBay === index ? null : index;
  }
  function handleInstall(instanceId: string): void {
    onInstall(shipId, instanceId);
  }
  // Uninstall BY INSTANCE (Combat 1.0, Unit 1.8b): the host routes this to
  // unfitEquipmentInstance, so a weapon uninstalls the exact tapped piece and an economy
  // slot still gets its never-empty Standard-Issue restore. One flow for every slot.
  function handleUninstall(instanceId: string): void {
    onUninstall(shipId, instanceId);
  }
</script>

<div class="ss-dialog">
  {#if !ship || !shipDef}
    <!-- Defensive: the target ship vanished (deleted / stale id). Never crash the
         modal; show a recoverable message with a way out. -->
    <div class="ss-header">
      <div class="ss-title">SHIP SYSTEMS</div>
      <button class="ss-close" on:click={onClose} aria-label="Close Ship Systems">✕</button>
    </div>
    <p class="ss-empty">This ship is no longer available.</p>
  {:else}
    <!-- HEADER: title on the left; hull + commanding captain on the right. -->
    <header class="ss-header">
      <div class="ss-title">SHIP SYSTEMS</div>
      <div class="ss-ident">
        <div class="ss-ident-text">
          <div class="ss-hull-name">{shipDef.label}</div>
          {#if assignedCaptain}
            <div class="ss-captain-name">{assignedCaptain.label}</div>
            <div class="ss-captain-spec">
              {assignedCaptain.spec ? SPEC_LABEL[assignedCaptain.spec] ?? assignedCaptain.spec : "No specialization"}
              {#if onMission}· on mission (install locked){/if}
            </div>
          {:else}
            <div class="ss-captain-name ss-parked">Unassigned / Parked</div>
          {/if}
        </div>
        <div class="ss-portrait" aria-hidden="true">{assignedCaptain ? "🧑‍🚀" : "⚓"}</div>
      </div>
      <button class="ss-close" on:click={onClose} aria-label="Close Ship Systems">✕</button>
    </header>

    <!-- DISPATCH-BLOCKER BANNER (Combat 1.0, Unit 1.8b): a combat hull with any required
         combat slot stripped bare (no weapon / no shield emitter / no hull plating) cannot
         patrol, so a red banner names the missing slot(s). Mirrors canDispatchPatrol's
         per-slot gate, so what the banner says here is exactly what dispatch would block on.
         Only rendered for a combat hull that is actually missing a required slot. -->
    {#if isCombatHull && missingRequired.length > 0}
      <div class="ss-blocker" role="alert">
        <span class="ss-blocker-dot" aria-hidden="true"></span>
        <span><strong>Cannot patrol:</strong> {blockerText(missingRequired)}</span>
      </div>
    {/if}

    <div class="ss-main">
      <!-- LEFT: the ship graphic with overlaid slots + the selected slot control. -->
      <div class="ss-ship-col">
        <div class="ss-graphic">
          <!-- Overhead placeholder hull: saucer + bridge, engineering hull, two
               nacelles with pylons, and an aft deflector. Decorative only; every
               stroke/fill reads a theme token so it repaints on theme switch. -->
          <svg class="ss-svg" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <!-- nacelle pylons (drawn first, behind the hull) -->
            <line x1="130" y1="210" x2="65" y2="235" class="ss-svg-pylon" />
            <line x1="170" y1="210" x2="235" y2="235" class="ss-svg-pylon" />
            <!-- nacelles -->
            <rect x="52" y="175" width="26" height="150" rx="13" class="ss-svg-hull" />
            <rect x="222" y="175" width="26" height="150" rx="13" class="ss-svg-hull" />
            <!-- engineering hull -->
            <rect x="120" y="150" width="60" height="175" rx="20" class="ss-svg-hull" />
            <!-- aft deflector -->
            <ellipse cx="150" cy="352" rx="20" ry="10" class="ss-svg-accent" />
            <!-- saucer + bridge -->
            <ellipse cx="150" cy="95" rx="92" ry="62" class="ss-svg-hull" />
            <circle cx="150" cy="95" r="13" class="ss-svg-accent" />
          </svg>

          <!-- Slot nodes overlaid at their hull positions. Absolute, centered on
               top/left. Each is a real button (tap opens its control) with a
               native title tooltip and an install-status dot. -->
          {#each visibleSlots as meta (meta.slotType)}
            {@const fitted = fittedBySlot[meta.slotType]}
            <button
              class="ss-slot"
              class:live={meta.live}
              class:reserved={!meta.live}
              class:installed={!!fitted}
              class:selected={selectedSlot === meta.slotType}
              style="top: {meta.top}%; left: {meta.left}%;"
              title={slotTitle(meta, fitted)}
              on:click={() => selectSlot(meta)}
            >
              <span class="ss-slot-code">{meta.code}</span>
              <span class="ss-slot-dot" class:on={!!fitted}></span>
            </button>
          {/each}
        </div>

        <!-- WEAPON HARDPOINTS STRIP (Combat 1.0, Unit 1.8b): one cell per hardpoint on a
             combat hull (destroyer 4 / battleship 6 / carrier 2). A filled cell shows the
             installed weapon's family-color dot + name + rarity + iL; an empty cell reads
             "install a weapon". Tapping a cell opens its control below (same flow as a
             slot). Only combat hulls have hardpoints, so the strip is combat-hull-only. -->
        {#if isCombatHull}
          <div class="ss-hardpoints">
            <div class="ss-hardpoints-title">
              Weapon hardpoints · {mountedWeapons.length}/{hardpointCap}
              {#if hardpointsFull}<span class="ss-hp-full">hardpoints full</span>{/if}
            </div>
            <div class="ss-hp-row">
              {#each Array.from({ length: hardpointCap }) as _, hpIndex (hpIndex)}
                {@const weapon = mountedWeapons[hpIndex] ?? null}
                <button
                  class="ss-hp"
                  class:filled={!!weapon}
                  class:empty={!weapon}
                  class:selected={selectedHardpoint === hpIndex}
                  on:click={() => selectHardpoint(hpIndex)}
                >
                  <span class="ss-hp-slot">HP {hpIndex + 1}</span>
                  {#if weapon}
                    <span class="ss-hp-name">
                      <span class="ss-fam" style="background: {weaponFamilyColor(weapon.weaponType)};"></span>{weaponName(weapon)}
                    </span>
                    <span class="ss-hp-sub">{weaponSub(weapon)}</span>
                  {:else}
                    <span class="ss-hp-name ss-hp-empty-name">empty</span>
                    <span class="ss-hp-sub">install a weapon</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- DRONE BAYS STRIP (Combat 1.0, Unit 2.4): the DRONE analogue of the weapon
             hardpoints strip above, shown ONLY on a hull with drone bays (carriers). One
             cell per bay; a filled cell shows the installed pod's role-color dot + role name
             (Attack / Defense / Support) + rarity + iL; an empty cell reads "install a drone
             pod". Tapping a cell opens its control below (same flow as a hardpoint). -->
        {#if hasDroneBays}
          <div class="ss-bays">
            <div class="ss-bays-title">
              Drone bays · {mountedPods.length}/{droneBayCap}
              {#if baysFull}<span class="ss-bay-full">bays full</span>{/if}
            </div>
            <div class="ss-bay-row">
              {#each Array.from({ length: droneBayCap }) as _, bayIndex (bayIndex)}
                {@const pod = mountedPods[bayIndex] ?? null}
                <button
                  class="ss-bay"
                  class:filled={!!pod}
                  class:empty={!pod}
                  class:selected={selectedBay === bayIndex}
                  on:click={() => selectBay(bayIndex)}
                >
                  <span class="ss-bay-slot">BAY {bayIndex + 1}</span>
                  {#if pod}
                    <span class="ss-bay-name">
                      <span class="ss-fam" style="background: {droneRoleColor(pod.droneRole)};"></span>{droneRoleName(pod.droneRole)}
                    </span>
                    <span class="ss-bay-sub">{podSub(pod)}</span>
                  {:else}
                    <span class="ss-bay-name ss-bay-empty-name">empty</span>
                    <span class="ss-bay-sub">install a drone pod</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Selected-slot control: install / uninstall for a live slot, or the
             reserved note for a 0.12.0 slot. Nothing shown until a slot is
             tapped, keeping the graphic uncluttered by default. -->
        {#if selectedMeta}
          <div class="ss-control">
            <div class="ss-control-title">{selectedMeta.label}</div>

            {#if !selectedMeta.live}
              <p class="ss-note">Reserved for the 0.12.0 combat update. No system to install yet.</p>
            {:else}
              <!-- Currently installed system (if any): the reusable EquipmentTooltip
                   surfaces its full identity + granted stats INLINE (D1's inline
                   approach, not a fragile floating hover), with the Uninstall control
                   injected into the card's footer <slot>. The spare-install list below
                   is the swap path (install a different spare into this slot). -->
              {#if selectedFitted}
                {@const fitted = selectedFitted}
                <div class="ss-fitted-tt">
                  <EquipmentTooltip piece={fitted}>
                    <button
                      class="ss-btn ss-btn-uninstall"
                      disabled={onMission}
                      title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
                      on:click={() => handleUninstall(fitted.id)}
                    >
                      Uninstall
                    </button>
                  </EquipmentTooltip>
                </div>
              {:else}
                <p class="ss-note">Slot empty. Install a spare system from storage below.</p>
              {/if}

              <!-- Spare systems of this slot type, each with an Install action
                   (disabled + reasoned when canFitEquipment blocks it). -->
              <div class="ss-spares-label">Storage · {selectedMeta.label} systems</div>
              {#if selectedSpares.length === 0}
                <p class="ss-note ss-note-dim">No spare {selectedMeta.label} systems in storage.</p>
              {:else}
                {#each selectedSpares as spare (spare.id)}
                  {@const gate = canFitEquipment(safeState, shipId, spare.id)}
                  <div class="ss-spare-row">
                    <div class="ss-fitted-info">
                      <div class="ss-fitted-name">{pieceDesc(spare)}</div>
                      <div class="ss-fitted-sub">{pieceSubline(spare)}</div>
                    </div>
                    <button
                      class="ss-btn ss-btn-install"
                      disabled={!gate.ok}
                      title={gate.ok ? `Install ${spare.id}` : reasonText(gate.reason)}
                      on:click={() => handleInstall(spare.id)}
                    >
                      {gate.ok ? "Install" : "Blocked"}
                    </button>
                  </div>
                  {#if !gate.ok}
                    <div class="ss-blocked-reason">{reasonText(gate.reason)}</div>
                  {/if}
                {/each}
              {/if}
            {/if}
          </div>
        {:else if selectedHardpoint !== null}
          <!-- WEAPON HARDPOINT control (Combat 1.0, Unit 1.8b): the SAME flow as a slot,
               keyed by the hardpoint index instead of a slotType. A filled hardpoint shows
               its weapon's EquipmentTooltip + an Uninstall (by instance id); an empty
               hardpoint shows the spare-weapon pool to install from (each install routed
               through canFitEquipment, so a full hull disables further installs). -->
          {@const weapon = mountedWeapons[selectedHardpoint] ?? null}
          <div class="ss-control">
            <div class="ss-control-title">Weapon Hardpoint {selectedHardpoint + 1}</div>
            {#if weapon}
              <div class="ss-fitted-tt">
                <EquipmentTooltip piece={weapon}>
                  <button
                    class="ss-btn ss-btn-uninstall"
                    disabled={onMission}
                    title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
                    on:click={() => handleUninstall(weapon.id)}
                  >
                    Uninstall
                  </button>
                </EquipmentTooltip>
              </div>
            {:else}
              <p class="ss-note">Hardpoint empty. Install a spare weapon from storage below.</p>
            {/if}

            <!-- Spare weapons in storage. Each install routes through canFitEquipment, so a
                 hull whose hardpoints are all full disables every install with the
                 "hardpoints full" reason (the hardpointsFull gate). -->
            <div class="ss-spares-label">Storage · weapons</div>
            {#if spareWeapons.length === 0}
              <p class="ss-note ss-note-dim">No spare weapons in storage.</p>
            {:else}
              {#each spareWeapons as spare (spare.id)}
                {@const gate = canFitEquipment(safeState, shipId, spare.id)}
                <div class="ss-spare-row">
                  <div class="ss-fitted-info">
                    <div class="ss-fitted-name">
                      <span class="ss-fam" style="background: {weaponFamilyColor(spare.weaponType)};"></span>{weaponName(spare)}
                    </div>
                    <div class="ss-fitted-sub">{weaponSub(spare)}</div>
                  </div>
                  <button
                    class="ss-btn ss-btn-install"
                    disabled={!gate.ok}
                    title={gate.ok ? `Install ${spare.id}` : reasonText(gate.reason)}
                    on:click={() => handleInstall(spare.id)}
                  >
                    {gate.ok ? "Install" : "Blocked"}
                  </button>
                </div>
                {#if !gate.ok}
                  <div class="ss-blocked-reason">{reasonText(gate.reason)}</div>
                {/if}
              {/each}
            {/if}
          </div>
        {:else if selectedBay !== null}
          <!-- DRONE BAY control (Combat 1.0, Unit 2.4): the SAME flow as a weapon hardpoint,
               keyed by the bay index instead of a hardpoint index. A filled bay shows its
               pod's EquipmentTooltip + an Uninstall (by instance id); an empty bay shows the
               spare-pod pool to install from (each install routed through canFitEquipment, so
               a carrier whose bays are all full disables further installs with baysFull). -->
          {@const pod = mountedPods[selectedBay] ?? null}
          <div class="ss-control">
            <div class="ss-control-title">Drone Bay {selectedBay + 1}</div>
            {#if pod}
              <div class="ss-fitted-tt">
                <EquipmentTooltip piece={pod}>
                  <button
                    class="ss-btn ss-btn-uninstall"
                    disabled={onMission}
                    title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
                    on:click={() => handleUninstall(pod.id)}
                  >
                    Uninstall
                  </button>
                </EquipmentTooltip>
              </div>
            {:else}
              <p class="ss-note">Bay empty. Install a spare drone pod from storage below.</p>
            {/if}

            <!-- Spare drone pods in storage. Each install routes through canFitEquipment, so a
                 carrier whose bays are all full disables every install with the "bays full"
                 reason (the baysFull gate). -->
            <div class="ss-spares-label">Storage · drone pods</div>
            {#if sparePods.length === 0}
              <p class="ss-note ss-note-dim">No spare drone pods in storage.</p>
            {:else}
              {#each sparePods as spare (spare.id)}
                {@const gate = canFitEquipment(safeState, shipId, spare.id)}
                <div class="ss-spare-row">
                  <div class="ss-fitted-info">
                    <div class="ss-fitted-name">
                      <span class="ss-fam" style="background: {droneRoleColor(spare.droneRole)};"></span>{droneRoleName(spare.droneRole)}
                    </div>
                    <div class="ss-fitted-sub">{podSub(spare)}</div>
                  </div>
                  <button
                    class="ss-btn ss-btn-install"
                    disabled={!gate.ok}
                    title={gate.ok ? `Install ${spare.id}` : reasonText(gate.reason)}
                    on:click={() => handleInstall(spare.id)}
                  >
                    {gate.ok ? "Install" : "Blocked"}
                  </button>
                </div>
                {#if !gate.ok}
                  <div class="ss-blocked-reason">{reasonText(gate.reason)}</div>
                {/if}
              {/each}
            {/if}
          </div>
        {:else}
          <p class="ss-note ss-note-dim ss-control-hint">Tap a slot, hardpoint, or drone bay to install or uninstall a system.</p>
        {/if}
      </div>

      <!-- RIGHT: the scrollable, categorized stats panel. -->
      <div class="ss-stats-col">
        <div class="ss-stats-section-title">SHIP STATS</div>
        <div class="ss-stats-head">
          <span class="ss-stats-head-label"></span>
          <span class="ss-stats-head-col">Base</span>
          <span class="ss-stats-head-col">Installed</span>
          <span class="ss-stats-head-col ss-delta-col">Δ</span>
        </div>
        {#each liveStatRows as row (row.label)}
          {@const delta = fmtDelta(row)}
          <div class="ss-stat-row">
            <span class="ss-stat-label">{row.label}</span>
            <span class="ss-stat-val">{fmtStat(row, "base")}</span>
            <span class="ss-stat-val ss-stat-fitted">{fmtStat(row, "fitted")}</span>
            <span class="ss-stat-val ss-delta-col" class:up={delta && !delta.startsWith("-")} class:down={delta && delta.startsWith("-")}>
              {delta ?? ""}
            </span>
          </div>
        {/each}

        <!-- COMBAT READOUT (Combat 1.0, Unit 1.8b): REAL now (formerly the inert 0.12.0
             placeholder). Every value is derived from the ship's INSTALLED combat gear via
             computeCombatReadout, so it changes as the player installs / uninstalls. Only a
             combat hull carries combat gear, so the section is combat-hull-only. -->
        {#if combatReadout}
          <div class="ss-stats-section-title ss-defensive-title">DEFENSE</div>
          <!-- Hull integrity = intrinsic frame + installed hull plating (design 6a). The
               breakdown is shown so the plating's contribution reads at a glance. -->
          <div class="ss-stat-row">
            <span class="ss-stat-label">Hull integrity</span>
            <span class="ss-stat-val ss-stat-fitted ss-stat-val-auto">
              {fmtFlat(combatReadout.hullTotal)}
              <span class="ss-stat-breakdown">(frame {fmtFlat(combatReadout.frameHp)} + plating {fmtFlat(combatReadout.platingHp)})</span>
            </span>
          </div>
          <div class="ss-stat-row">
            <span class="ss-stat-label">Shield capacity</span>
            <span class="ss-stat-val ss-stat-fitted">{fmtFlat(combatReadout.shieldCapacity)}</span>
          </div>
          <div class="ss-stat-row">
            <span class="ss-stat-label">Shield recharge</span>
            <span class="ss-stat-val ss-stat-fitted">{fmtFlat(combatReadout.shieldRecharge)} / s</span>
          </div>
          <div class="ss-stat-row">
            <span class="ss-stat-label">Ablative armor</span>
            <span class="ss-stat-val">{fmtFlat(combatReadout.ablativeArmor)}</span>
          </div>

          <div class="ss-stats-section-title ss-defensive-title">OFFENSE</div>
          <div class="ss-stat-row">
            <span class="ss-stat-label">Weapons mounted</span>
            <span class="ss-stat-val ss-stat-fitted">{mountedWeapons.length} / {hardpointCap}</span>
          </div>
          {#each mountedWeapons as weapon (weapon.id)}
            <div class="ss-stat-row">
              <span class="ss-stat-label">
                <span class="ss-fam" style="background: {weaponFamilyColor(weapon.weaponType)};"></span>{weaponName(weapon)}
              </span>
              <span class="ss-stat-val">{weaponYieldRange(weapon)}</span>
            </div>
          {/each}

          <!-- DRONES readout (Combat 1.0, Unit 2.4): carrier-only (droneBayCap > 0),
               consistent with the OFFENSE / DEFENSE sections above. A "Bays used N / cap"
               summary row plus one row per installed pod naming its role, derived from the
               SAME computeCombatReadout fold, so it changes as pods are installed / uninstalled. -->
          {#if droneBayCap > 0}
            <div class="ss-stats-section-title ss-defensive-title">DRONES</div>
            <div class="ss-stat-row">
              <span class="ss-stat-label">Bays used</span>
              <span class="ss-stat-val ss-stat-fitted">{mountedPods.length} / {droneBayCap}</span>
            </div>
            {#each mountedPods as pod (pod.id)}
              <div class="ss-stat-row">
                <span class="ss-stat-label">
                  <span class="ss-fam" style="background: {droneRoleColor(pod.droneRole)};"></span>{droneRoleName(pod.droneRole)}
                </span>
                <span class="ss-stat-val">{podSub(pod)}</span>
              </div>
            {/each}
          {/if}
        {/if}
      </div>
    </div>

    <!-- BOTTOM BAR: reserved MODULE row. Weapons moved to the live hardpoint strip
         above (Combat 1.0, Unit 1.8b); modules stay reserved for a later combat unit. -->
    <div class="ss-bottom">
      <div class="ss-bottom-row">
        <span class="ss-bottom-label">MODULES</span>
        <div class="ss-bottom-slots">
          {#each Array.from({ length: moduleCount }) as _, mi}
            <span class="ss-hardpoint ss-module" title="Module slot, reserved for a later combat update">◇</span>
          {/each}
          {#if moduleCount === 0}
            <span class="ss-note ss-note-dim">none on this hull</span>
          {/if}
        </div>
      </div>
      <div class="ss-bottom-note">Modules are reserved for a later combat update. Count varies by hull.</div>
    </div>
  {/if}
</div>

<style>
  /* The dialog is the panel body itself (NOT wrapped in Panel.svelte, so these
     scoped styles actually reach it). OPAQUE background: an accent wash layered
     over the solid --color-bg-mid, so it reads as solid on Brave, which lacks
     backdrop-filter (never rely on blur for legibility). max-height:100% bounds
     it against the fixed .modal-backdrop (which is already viewport-sized), so
     no new hard 100vh/100dvh is introduced here (scroll-containment invariant).
     Flex column: header + bottom stay pinned, .ss-main flexes and scrolls. */
  .ss-dialog {
    display: flex;
    flex-direction: column;
    width: min(940px, 100%);
    max-height: 100%;
    background: linear-gradient(rgba(var(--color-accent-rgb), 0.06), rgba(var(--color-accent-rgb), 0.06)), var(--color-bg-mid);
    border: 1px solid var(--color-border-strong);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    color: var(--color-text-primary);
  }

  /* HEADER */
  .ss-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.25);
    flex-shrink: 0;
  }
  .ss-title {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 1px;
    color: var(--color-accent-bright);
    text-transform: uppercase;
    flex: 1;
  }
  .ss-ident {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .ss-ident-text {
    text-align: right;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ss-hull-name {
    font-size: 12px;
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .ss-captain-name {
    font-size: 11px;
    color: var(--color-accent);
  }
  .ss-captain-name.ss-parked {
    color: var(--color-text-dim);
  }
  .ss-captain-spec {
    font-size: 10px;
    color: var(--color-text-secondary);
  }
  /* Portrait placeholder: mirrors .mission-portrait-frame's dashed accent box. */
  .ss-portrait {
    flex: 0 0 44px;
    height: 44px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    background: rgba(var(--color-accent-rgb), 0.04);
  }
  .ss-close {
    flex: 0 0 auto;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
    width: 30px;
    height: 30px;
    font-size: 14px;
    cursor: pointer;
    line-height: 1;
  }
  .ss-close:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }

  /* MAIN: two columns on wide screens; the stats column scrolls independently.
     On narrow (mobile) screens the columns stack and .ss-main itself scrolls, so
     the whole thing stays usable on a phone. min-height:0 lets the flex children
     actually shrink and hand scrolling to the inner overflow (the standard idiom
     the app shell already relies on). */
  .ss-main {
    display: flex;
    gap: 14px;
    padding: 12px 14px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .ss-ship-col {
    flex: 0 0 46%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .ss-ship-col::-webkit-scrollbar {
    display: none;
  }
  .ss-stats-col {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .ss-stats-col::-webkit-scrollbar {
    display: none;
  }
  @media (max-width: 720px) {
    .ss-main {
      flex-direction: column;
      overflow-y: auto;
    }
    .ss-ship-col,
    .ss-stats-col {
      flex: none;
      width: auto;
      overflow: visible;
    }
  }

  /* SHIP GRAPHIC + overlaid slots. The box holds the SVG (full width, auto
     height by its 300x400 ratio) and the absolutely-positioned nodes. */
  .ss-graphic {
    position: relative;
    width: 100%;
    max-width: 300px;
    margin: 0 auto;
    aspect-ratio: 300 / 400;
  }
  .ss-svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .ss-svg-hull {
    fill: rgba(var(--color-accent-rgb), 0.05);
    stroke: rgba(var(--color-accent-rgb), 0.35);
    stroke-width: 1.5;
  }
  .ss-svg-accent {
    fill: rgba(var(--color-accent-rgb), 0.14);
    stroke: rgba(var(--color-accent-rgb), 0.45);
    stroke-width: 1;
  }
  .ss-svg-pylon {
    stroke: rgba(var(--color-accent-rgb), 0.3);
    stroke-width: 6;
  }

  /* One slot node: a small chamfered box (clip-path cuts the corners) centered on
     its top/left. Shows the code + an install-status dot. */
  .ss-slot {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 0;
    background: var(--color-bg-deep);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
    cursor: pointer;
    color: var(--color-text-secondary);
  }
  .ss-slot.live {
    border-color: rgba(var(--color-accent-rgb), 0.6);
    color: var(--color-accent);
  }
  .ss-slot.installed {
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
  }
  /* Reserved slots read as the quieter, unavailable state (same opacity dim the
     app uses for locked content), but stay tappable to show their reserved note. */
  .ss-slot.reserved {
    border-style: dashed;
    opacity: 0.55;
  }
  .ss-slot.selected {
    border-color: var(--color-accent-bright);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.4);
    opacity: 1;
  }
  .ss-slot-code {
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1;
    letter-spacing: 0.5px;
  }
  .ss-slot-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    background: transparent;
  }
  /* Installed indicator: a filled GOLD dot (design), distinct from the accent. */
  .ss-slot-dot.on {
    background: var(--color-warning);
    border-color: var(--color-warning);
    box-shadow: 0 0 4px var(--color-warning);
  }

  /* DISPATCH-BLOCKER BANNER (Combat 1.0, Unit 1.8b): a red danger strip below the
     header when a required combat slot is empty. Reads the danger token so it recolors
     with the theme; opaque wash over the deep bg (no blur) for Brave legibility. */
  .ss-blocker {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 14px 0;
    padding: 9px 12px;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.45);
    color: var(--color-danger);
    font-size: 12px;
    line-height: 1.4;
    flex-shrink: 0;
  }
  .ss-blocker-dot {
    flex: 0 0 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-danger);
  }
  .ss-blocker strong {
    color: var(--color-danger);
  }

  /* WEAPON HARDPOINTS STRIP (Combat 1.0, Unit 1.8b): one cell per hardpoint, laid out
     in a wrapping row below the ship graphic. */
  .ss-hardpoints {
    margin-top: 2px;
  }
  .ss-hardpoints-title {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 6px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .ss-hp-full {
    color: var(--color-danger);
    text-transform: none;
    letter-spacing: 0;
  }
  .ss-hp-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  /* One hardpoint cell: a small tap target showing the installed weapon or an empty
     prompt. Filled cells read the accent; empty cells are dashed + dim. */
  .ss-hp {
    flex: 1 1 92px;
    min-width: 88px;
    text-align: left;
    padding: 7px 8px;
    background: var(--color-bg-deep);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ss-hp.filled {
    border-color: rgba(var(--color-accent-rgb), 0.6);
  }
  .ss-hp.empty {
    border-style: dashed;
    opacity: 0.75;
  }
  .ss-hp.selected {
    border-color: var(--color-accent-bright);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.4);
    opacity: 1;
  }
  .ss-hp-slot {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .ss-hp-name {
    font-size: 12px;
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
  }
  .ss-hp-empty-name {
    color: var(--color-text-dim);
    font-style: italic;
  }
  .ss-hp-sub {
    font-size: 10px;
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
  }
  /* Weapon FAMILY color dot (kinetic/particle/ew), used in the strip cell, the spare
     list, and the offense readout. The color is set inline (weaponFamilyColor). */
  .ss-fam {
    display: inline-block;
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 2px;
    margin-right: 5px;
  }

  /* DRONE BAYS STRIP (Combat 1.0, Unit 2.4): the DRONE analogue of the weapon hardpoints
     strip, one cell per bay in a wrapping row below the hardpoints strip. Kept as its own
     explicit .ss-bay* class set (parallel to .ss-hp*) so a bay is independently tunable and
     the markup reads self-describingly, rather than borrowing the hardpoint classes. */
  .ss-bays {
    margin-top: 2px;
  }
  .ss-bays-title {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 6px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .ss-bay-full {
    color: var(--color-danger);
    text-transform: none;
    letter-spacing: 0;
  }
  .ss-bay-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  /* One drone bay cell: a small tap target showing the installed pod or an empty prompt.
     Filled cells read the accent; empty cells are dashed + dim. Mirrors .ss-hp. */
  .ss-bay {
    flex: 1 1 92px;
    min-width: 88px;
    text-align: left;
    padding: 7px 8px;
    background: var(--color-bg-deep);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ss-bay.filled {
    border-color: rgba(var(--color-accent-rgb), 0.6);
  }
  .ss-bay.empty {
    border-style: dashed;
    opacity: 0.75;
  }
  .ss-bay.selected {
    border-color: var(--color-accent-bright);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.4);
    opacity: 1;
  }
  .ss-bay-slot {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .ss-bay-name {
    font-size: 12px;
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
  }
  .ss-bay-empty-name {
    color: var(--color-text-dim);
    font-style: italic;
  }
  .ss-bay-sub {
    font-size: 10px;
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
  }

  /* SELECTED-SLOT CONTROL */
  .ss-control {
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
    background: var(--color-bg-deep);
    padding: 10px;
  }
  .ss-control-title {
    font-size: 12px;
    color: var(--color-accent-bright);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .ss-control-hint {
    text-align: center;
    padding: 10px 0 2px;
  }
  /* Inline fitted-system tooltip wrapper: a little breathing room below the control
     title. The card supplies its own border/padding, so only margin is needed here. */
  .ss-fitted-tt {
    margin: 4px 0 2px;
  }
  /* (.ss-fitted-row was retired when the fitted-system readout became the inline
     EquipmentTooltip; .ss-spare-row keeps this shared row layout for the spares list.) */
  .ss-spare-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .ss-fitted-info {
    flex: 1;
    min-width: 0;
  }
  .ss-fitted-name {
    font-size: 11px;
    color: var(--color-text-primary);
  }
  .ss-fitted-sub {
    font-size: 10px;
    color: var(--color-text-dim);
    font-family: var(--font-mono);
  }
  .ss-spares-label {
    font-size: 10px;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 10px;
    margin-bottom: 2px;
  }
  .ss-blocked-reason {
    font-size: 10px;
    color: var(--color-danger);
    padding-bottom: 4px;
  }
  .ss-btn {
    flex: 0 0 auto;
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    color: var(--color-accent-bright);
  }
  .ss-btn:hover:not(:disabled) {
    background: rgba(var(--color-accent-rgb), 0.2);
  }
  .ss-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ss-btn-uninstall {
    color: var(--color-danger);
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(248, 113, 113, 0.08);
  }

  /* STATS PANEL */
  .ss-stats-section-title {
    font-size: 11px;
    letter-spacing: 0.5px;
    color: var(--color-accent);
    text-transform: uppercase;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding-bottom: 4px;
    margin-bottom: 6px;
  }
  .ss-defensive-title {
    margin-top: 16px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .ss-stats-head {
    display: flex;
    align-items: center;
    font-size: 10px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    padding-bottom: 2px;
  }
  .ss-stats-head-label {
    flex: 1;
  }
  .ss-stats-head-col {
    flex: 0 0 64px;
    text-align: right;
  }
  .ss-stat-row {
    display: flex;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.08);
  }
  .ss-stat-label {
    flex: 1;
    font-size: 11px;
    color: var(--color-text-secondary);
  }
  .ss-stat-val {
    flex: 0 0 64px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-primary);
  }
  .ss-stat-fitted {
    color: var(--color-accent-bright);
  }
  .ss-delta-col {
    flex: 0 0 64px;
  }
  .ss-stat-val.up {
    color: var(--color-success);
  }
  .ss-stat-val.down {
    color: var(--color-danger);
  }
  /* Combat readout value that carries an inline breakdown (the hull integrity
     frame+plating split): auto width instead of the fixed 64px stat column, so the
     breakdown text sits on the same line rather than clipping. */
  .ss-stat-val-auto {
    flex: 0 0 auto;
    text-align: right;
  }
  /* The dim frame+plating breakdown after the hull total. */
  .ss-stat-breakdown {
    color: var(--color-text-dim);
    font-size: 10px;
  }

  /* BOTTOM BAR */
  .ss-bottom {
    flex-shrink: 0;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.25);
    padding: 10px 14px;
  }
  .ss-bottom-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .ss-bottom-label {
    flex: 0 0 72px;
    font-size: 10px;
    letter-spacing: 0.5px;
    color: var(--color-text-secondary);
    text-transform: uppercase;
  }
  .ss-bottom-slots {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .ss-hardpoint {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.35);
    color: var(--color-text-dim);
    opacity: 0.7;
  }
  .ss-bottom-note {
    font-size: 10px;
    color: var(--color-text-dim);
    margin-top: 2px;
  }

  /* Shared small-note text. */
  .ss-note {
    font-size: 11px;
    color: var(--color-text-secondary);
    margin: 4px 0;
    line-height: 1.4;
  }
  .ss-note-dim {
    color: var(--color-text-dim);
  }
  .ss-empty {
    padding: 20px 14px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
</style>
