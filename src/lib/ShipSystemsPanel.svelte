<script lang="ts">
  // ============================================================================
  // ShipSystemsPanel.svelte
  // Author: Claude (Opus 4.8) | 2026-07-18, reworked 2026-08-21 (Combat 1.0 QA round 1)
  //
  // The REAL, player-facing "Ship Systems" screen for one selected ship. It is a
  // pure PRESENTATION + INTERACTION piece:
  //   - It READS live state through the already-tested equipment helpers
  //     (equippedFor / fittedInSlot / canFitEquipment) and the derived-stat
  //     projection (shipDerivedStats) plus the combat fold (computeCombatReadout).
  //     It does NOT reimplement any game logic.
  //   - It never mutates game state directly. Install / Uninstall / Repair bubble
  //     UP to the host (App.svelte) via callbacks, so the single source of truth
  //     for the installed loadout + its persistence stays in one place. When the host reassigns
  //     the `state` prop after an action, every derived value below recomputes.
  //
  // 2026-08-21 REWORK (QA round 1 items 3/4/5/8), matches the user-approved mockup
  // (scratchpad ship-systems-rework-mockup.html):
  //   - Every installable slot, hardpoint and drone bay is now an ICON TILE
  //     (rarity-colored top border + corner dot + variety glyph + iLevel badge),
  //     grouped by function (Weapons / Defense / Ship Systems / Drone Bays).
  //   - A filled tile's detail is a FLOATING EquipmentTooltip shown on hover
  //     (desktop) or tap (mobile), with an Install / Uninstall button injected into
  //     the tooltip's action <slot> (QA #8: no inline detail div pushing content
  //     down). The floating wrapper is JS-positioned so the tooltip is always
  //     CLAMPED inside the viewport (flip above/below + horizontal clamp), a hard
  //     acceptance requirement. EquipmentTooltip.svelte itself is UNCHANGED.
  //   - Tapping a slot opens the spare-pool PICKER (spares are tiles too, each with
  //     its own tooltip); tapping a spare installs it. One consistent flow for every
  //     slot type (QA #4).
  //   - The right column splits stats into titled CATEGORIES shown for ALL hulls:
  //     Combat / Prospecting / Logistics / Exploration (placeholder) (QA #5).
  //   - A DAMAGED ship shows a prominent repair banner (progress bar + ETA + a
  //     manual Repair trigger) and BLOCKS install + uninstall until repaired (QA #3).
  //
  // Every hull is now combat-capable (the model-layer commit made combatHullTypeOf
  // non-null for all hulls: an economy hull carries a weak Standard-Issue combat set
  // and is dispatchable), so the combat slots / weapon strip / combat readout render
  // for ALL hulls. Drone bays stay CARRIER-ONLY (a hangar capacity, not a universal
  // slot), gated by hasDroneBays.
  //
  // USER-FACING WORDING: this screen says "Ship Systems" and "Install / Uninstall".
  // The CODE vocabulary underneath is unchanged (equipment / fitEquipment /
  // EquipmentInstance); only the display strings differ.
  // ============================================================================

  import { onMount, onDestroy, tick } from "svelte";
  import type {
    GameState,
    EquipmentInstance,
    EquipmentSlotType,
    ShipDerivedStats,
  } from "./game/model";
  import { SHIP_TYPES, EQUIPMENT_SLOTS, shipDerivedStats } from "./game/model";
  import type { EquipFitBlockReason } from "./game/equipment";
  import { equippedFor, fittedInSlot, canFitEquipment } from "./game/equipment";
  // The combat-loadout read helpers. combatHullTypeOf resolves the hull's combat class
  // (now non-null for every hull); computeCombatReadout folds the installed combat
  // gear into the readout the panel shows; weaponDisplayName + WEAPON_DEFS resolve a
  // weapon's player-facing name + family. shipToCombatant + battleRating build the
  // ship's advisory Battle Rating from the SAME installed gear the sim would fight
  // (single source of truth). These are READ-ONLY: the panel presents them, it never
  // reimplements the combat fold (that stays in combat/bridge.ts).
  import { combatHullTypeOf, shipToCombatant } from "./game/combat/bridge";
  import { computeCombatReadout, type RequiredCombatSlot } from "./game/combatFit";
  import { weaponDisplayName } from "./game/combat/combatView";
  import { WEAPON_DEFS } from "./game/combat/weapons";
  import { battleRating } from "./game/combat/rating";
  import { formatNumber } from "./game/format";
  // The SAME reusable rarity-bordered card the Warehouse Ship Systems bay uses, plus
  // its module-exported single-source helpers (rarity color + variety glyph). Reused
  // here so a tile + its tooltip read the piece's identity in EXACTLY the format the
  // bay does, one card component, no second renderer to drift. The Install / Uninstall
  // control is injected into the card's footer <slot>. EquipmentTooltip is UNCHANGED.
  import EquipmentTooltip, { equipmentRarityColor, equipmentIcon } from "./EquipmentTooltip.svelte";
  // Shared PURE viewport-clamp math for the floating tooltip (prefer-above / flip-below
  // / clamp). Extracted so this panel and the Combat View pip tooltips share ONE clamp
  // implementation; the measure + await-tick + reflow flow below stays local.
  import { clampFloatingTip } from "./floatingTip";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here); `shipId` selects the ship
  // this panel installs systems on. The callbacks route every side-effect back to the host
  // so persistence + logging happen exactly once, in App.svelte.
  export let state: GameState;
  export let shipId: string;
  export let onInstall: (shipId: string, instanceId: string) => void;
  // Uninstall is BY INSTANCE ID (a weapon is a MULTI slot, so "uninstall the weapon"
  // is ambiguous without an id). The host routes this to unfitEquipmentInstance.
  export let onUninstall: (shipId: string, instanceId: string) => void;
  // Manual repair trigger (QA #3). The host runs the SAME auto-repair pass
  // (processShipRepairs) immediately so the player can kick a repair off without
  // waiting a tick; when no Shipyard bay is free it is a safe no-op and the banner
  // explains the wait. Augments (never replaces) the existing auto-repair.
  export let onRepair: (shipId: string) => void;
  export let onClose: () => void;

  // --- Slot metadata ----------------------------------------------------------
  // The installable SINGLETON slots, grouped by function to match the mockup. Each
  // slot holds at most one piece (install replaces, uninstall leaves it bare for a
  // combat slot or auto-restores a Standard-Issue baseline for an economy slot).
  //   prospectorOnly, specUtility (the Prospecting Rig slot) exists only on Prospector
  //                   hulls (design: the Freighter has no Spec Utility slot).
  type SlotMeta = { slotType: EquipmentSlotType; label: string; prospectorOnly?: boolean };
  // DEFENSE singletons (combat): shown for every hull (all hulls are combat-capable).
  const DEFENSE_SLOTS: SlotMeta[] = [
    { slotType: "shieldEmitters", label: "Shield Emitter" },
    { slotType: "hullPlating", label: "Hull Plating" },
  ];
  // SHIP-SYSTEM singletons (economy): the four live economy slots.
  const SYSTEM_SLOTS: SlotMeta[] = [
    { slotType: "cargoBay", label: "Cargo Bay" },
    { slotType: "ftlDrive", label: "FTL Drive" },
    { slotType: "reactorCore", label: "Reactor Core" },
    { slotType: "specUtility", label: "Spec Utility", prospectorOnly: true },
  ];

  // A stable per-slotType glyph for the combat slots (weapon / shield / plating /
  // drone), which carry no economy "variety" and so are not covered by the shared
  // equipmentIcon map. Economy slots fall through to equipmentIcon (the single-source
  // variety glyph), so cargo / FTL / reactor / rig tiles stay identical to the bay.
  function tileIcon(piece: EquipmentInstance): string {
    switch (piece.slotType) {
      case "weapon":
        return "\u{1F52B}"; // pistol: a mounted weapon
      case "shieldEmitters":
        return "\u{1F6E1}\u{FE0F}"; // shield
      case "hullPlating":
        return "\u{1F9F1}"; // brick: hull plating
      case "droneBay":
        return "\u{1F6F0}\u{FE0F}"; // satellite: a drone squadron pod
      default:
        return equipmentIcon(piece); // economy slots -> the shared variety glyph
    }
  }

  // Captain-specialization display names (the CaptainTalentBranch -> title map the
  // spec cards already establish). Shown as flavor under the commanding captain.
  const SPEC_LABEL: Record<string, string> = {
    resourcefulness: "Prospector",
    tactical: "Tactician",
    science: "Explorer",
  };

  // --- Local UI state ---------------------------------------------------------
  // The currently OPEN slot for the install picker. Exactly one of these three is
  // ever non-null (they are mutually exclusive), so only one picker shows:
  //   selectedSlot      , a singleton slotType (economy or combat singleton)
  //   selectedHardpoint , a 0-based weapon hardpoint index (weapons are a MULTI slot)
  //   selectedBay       , a 0-based drone bay index (drone pods are a MULTI slot)
  let selectedSlot: EquipmentSlotType | null = null;
  let selectedHardpoint: number | null = null;
  let selectedBay: number | null = null;

  // The floating EquipmentTooltip currently shown (hover on desktop, tap-pin on
  // mobile). `action` picks which button is injected into the card's footer.
  //   pinned, opened by a tap/click (persists until dismissed) vs a transient hover.
  type TipAction = "install" | "uninstall";
  let activeTip: { piece: EquipmentInstance; action: TipAction; el: HTMLElement } | null = null;
  let tipPinned = false;
  // The floating wrapper element + its JS-computed viewport-clamped position. Kept
  // invisible (tipVisible false) for one frame after opening so it can be MEASURED
  // before it is placed, so it never flashes in the wrong spot.
  let tipEl: HTMLDivElement | undefined;
  let tipLeft = 0;
  let tipTop = 0;
  let tipVisible = false;
  // GRACE-DELAY hide for the HOVER (unpinned) tooltip. The floating tooltip is a
  // detached position:fixed element sitting a small gap (TIP_GAP) off the tile, and it
  // carries the Install / Uninstall button (pointer-events:auto). On a hover-capable
  // device the tooltip is NOT pinned, so a naive "hide on the tile's pointerleave"
  // fires the instant the cursor starts crossing that gap toward the button, killing
  // the tooltip before the cursor can reach it (the button was unreachable, the bug
  // this addresses). The standard interactive-hover-tooltip fix: on pointerleave do not
  // hide at once, schedule the hide after a short grace window via a cancelable timer,
  // and cancel that timer when the cursor lands on the tooltip (or on another tile).
  // The pinned (touch) path is unaffected: the scheduled close routes through
  // closeTip(false), which a pin ignores. Guarded / cleared on destroy (no leak).
  const TIP_HIDE_GRACE_MS = 275; // cursor travel window from tile to floating tooltip
  let tipHideTimer: ReturnType<typeof setTimeout> | null = null;
  // Cancel a pending grace-delay hide (cursor re-entered a tile or the tooltip itself).
  function cancelTipHide(): void {
    if (tipHideTimer !== null) {
      clearTimeout(tipHideTimer);
      tipHideTimer = null;
    }
  }
  // Schedule the hover tooltip to hide after the grace window, cancelable. Routes
  // through closeTip(false) so a PINNED (touch) tooltip is left alone (mobile tap-pin
  // still dismisses via re-tap / outside-press, never by this timer).
  function scheduleTipHide(): void {
    cancelTipHide();
    tipHideTimer = setTimeout(() => {
      tipHideTimer = null;
      closeTip(false);
    }, TIP_HIDE_GRACE_MS);
  }
  // Does this device have a hover-capable pointer (a real mouse / trackpad)? On such
  // devices the tooltip is already previewed on hover, so we do NOT pin on click:
  // pinning exists only so a TOUCH tap can reveal a tile's detail (a coarse pointer
  // cannot hover). Gating the pin to coarse pointers is what lets a desktop user hover
  // the spare tiles in the just-opened install picker and see their stats even after
  // clicking a filled slot (QA follow-up: a pin used to suppress every later hover).
  // Guarded for jsdom / SSR where matchMedia may be absent (then treated as touch).
  const hoverCapable =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover)").matches;

  // Reset every open selection + the floating tooltip whenever the panel switches to
  // a different ship, so nothing stale carries over. Guarded on a change of `shipId`
  // only (not a general reactive) so it cannot loop.
  let lastShipId: string | null = null;
  $: if (shipId !== lastShipId) {
    lastShipId = shipId;
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = null;
    activeTip = null;
    tipPinned = false;
    tipVisible = false;
  }

  // --- Derived reads ----------------------------------------------------------
  // DELIBERATE render-boundary defense: a malformed / partially-migrated state
  // reaching this panel should degrade to an empty "no gear" view rather than
  // white-screen the whole app, so this one surface keeps the `?? []` guard (the
  // engine reads state.equipment directly and throws, on purpose, elsewhere).
  $: equipmentPool = state.equipment ?? [];
  $: safeState = { ...state, equipment: equipmentPool };

  $: ship = state.ships.find((s) => s.id === shipId) ?? null;
  $: shipDef = ship ? SHIP_TYPES[ship.typeKey] : null;
  $: assignedCaptain =
    ship && ship.assignedCaptainId !== null
      ? state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null
      : null;
  $: isProspectorHull = shipDef?.spec === "prospector";
  $: onMission = assignedCaptain !== null && assignedCaptain.mission !== null;

  // The SHIP-SYSTEM singleton slots actually shown for THIS hull: the Spec Utility
  // slot is Prospector-only, so it is dropped on other hulls. The Defense singletons
  // and the weapon strip show on every hull (all hulls are combat-capable now).
  $: visibleSystemSlots = SYSTEM_SLOTS.filter((s) => !s.prospectorOnly || isProspectorHull);

  // Reactive per-slot "what is installed here" map, keyed by slotType. CRITICAL for
  // correct redraws: reading fittedInSlot(...) inside a template expression hides the
  // safeState dependency from the compiler, so a tile bound to such a call would go
  // stale after an install / uninstall. Precomputing this real reactive var (that DOES
  // change when safeState / ship change) and reading map[slotType] in the template
  // makes the dependency visible, so the tiles refresh correctly.
  $: fittedBySlot = (() => {
    const map: Record<string, EquipmentInstance | null> = {};
    for (const meta of [...DEFENSE_SLOTS, ...SYSTEM_SLOTS]) {
      map[meta.slotType] = ship ? fittedInSlot(safeState, shipId, meta.slotType) : null;
    }
    return map;
  })();

  // BASE (bare hull) vs FITTED (equipped pieces folded in) derived stats.
  $: baseStats = ship ? shipDerivedStats(ship, []) : null;
  $: fittedPieces = ship ? equippedFor(safeState, shipId) : [];
  $: fitStats = ship ? shipDerivedStats(ship, fittedPieces) : null;

  // The economy stat rows (real numbers). `kind` picks the formatter: percent for the
  // multiplier / 0-based-bonus stats, flat for capacities / power / mass. Split into
  // Prospecting (the two prospecting-relevant stats) and Logistics (the rest) for the
  // categorized right column, each row keeping its base -> installed delta.
  type StatRow = { label: string; base: number; fitted: number; kind: "flat" | "pct" };
  function buildLiveRows(base: ShipDerivedStats, fit: ShipDerivedStats): StatRow[] {
    return [
      { label: "Extraction Yield", base: base.extractionYieldMult, fitted: fit.extractionYieldMult, kind: "pct" },
      { label: "Cargo Capacity", base: base.cargoCapacity, fitted: fit.cargoCapacity, kind: "flat" },
      { label: "FTL Speed", base: base.transitSpeedMult, fitted: fit.transitSpeedMult, kind: "pct" },
      { label: "Fuel Efficiency", base: base.engineEfficiency, fitted: fit.engineEfficiency, kind: "pct" },
      { label: "Fuel Capacity", base: base.fuelCapacity, fitted: fit.fuelCapacity, kind: "flat" },
      { label: "Power Output", base: base.powerOutput, fitted: fit.powerOutput, kind: "flat" },
      { label: "Power Draw", base: base.powerDraw, fitted: fit.powerDraw, kind: "flat" },
      { label: "Mass", base: base.mass, fitted: fit.mass, kind: "flat" },
    ];
  }
  $: liveStatRows = baseStats && fitStats ? buildLiveRows(baseStats, fitStats) : [];
  const PROSPECTING_LABELS = new Set(["Extraction Yield", "Cargo Capacity"]);
  $: prospectingRows = liveStatRows.filter((r) => PROSPECTING_LABELS.has(r.label));
  $: logisticsRows = liveStatRows.filter((r) => !PROSPECTING_LABELS.has(r.label));

  // --- Combat reads -----------------------------------------------------------
  // combatHullTypeOf now returns non-null for every hull, so isCombatHull is true for
  // all hulls: the combat slots, the weapon strip and the combat readout render on an
  // economy hull too (it carries a weak Standard-Issue combat set). Only DRONE BAYS
  // stay carrier-only (see hasDroneBays).
  $: combatHullType = ship ? combatHullTypeOf(ship.typeKey) : null;
  $: isCombatHull = combatHullType !== null;

  // The folded combat readout (hull frame+plating, shield pool/recharge, mounted
  // weapons + pods, and which required slots are still empty). Derived from the SAME
  // fittedPieces the economy stats use, so it recomputes on every install / uninstall.
  $: combatReadout =
    ship && shipDef && isCombatHull
      ? computeCombatReadout(fittedPieces, shipDef.hullIntegrity, shipDef.weaponHardpoints, shipDef.droneBays ?? 0)
      : null;

  $: mountedWeapons = combatReadout ? combatReadout.mountedWeapons : [];
  $: hardpointCap = combatReadout ? combatReadout.hardpointCap : 0;
  $: spareWeapons = equipmentPool.filter((e) => e.fittedToShipId === null && e.slotType === "weapon");
  $: missingRequired = combatReadout ? combatReadout.missingRequired : [];

  // Drone reads (carrier-only). hasDroneBays gates the whole drone strip + the DRONES
  // readout, so a non-carrier never shows an empty drone strip it can never fill.
  $: mountedPods = combatReadout ? combatReadout.mountedPods : [];
  $: droneBayCap = combatReadout ? combatReadout.droneBayCap : 0;
  $: hasDroneBays = droneBayCap > 0;
  $: sparePods = equipmentPool.filter((e) => e.fittedToShipId === null && e.slotType === "droneBay");

  // The ship's advisory Battle Rating: build the SAME player Combatant the dispatch
  // card + sim build (installed gear folded in) and score it. Null only if the hull
  // does not resolve to a combat class (a corrupt typeKey). Recomputes with the installed loadout.
  $: battleRatingValue =
    ship && shipDef && combatHullType
      ? battleRating(
          shipToCombatant({ id: ship.id, team: "player", stats: shipDef, hullType: combatHullType, installedGear: fittedPieces }),
        )
      : null;

  // --- Repair reads (QA #3) ---------------------------------------------------
  // A ship is DAMAGED after limping home from a lost patrol (ship.damaged). While
  // true, install + uninstall are BLOCKED and a repair banner is shown. The auto-
  // repair pass (tick.ts processShipRepairs) starts a shipRepair process whenever a
  // Shipyard bay is free; we surface that process's live progress + ETA, or explain
  // the wait when every bay is busy.
  $: shipDamaged = ship?.damaged === true;
  $: repairProcess =
    ship
      ? state.activeProcesses.find(
          (p) => p.kind === "shipRepair" && p.effect.type === "clearShipDamage" && p.effect.shipId === shipId,
        ) ?? null
      : null;
  $: repairRunning = repairProcess !== null;
  $: repairProgress =
    repairProcess && repairProcess.durationTicks > 0
      ? (repairProcess.durationTicks - repairProcess.remainingTicks) / repairProcess.durationTicks
      : 0;
  $: repairEtaSeconds = repairProcess ? Math.max(0, repairProcess.remainingTicks) * state.tickDurationSeconds : 0;

  // --- Install picker reads ---------------------------------------------------
  // The spare pool + label for whichever slot is currently open. One picker at a time
  // (the three selections are mutually exclusive), so this reads the active one.
  $: pickerActive = selectedSlot !== null || selectedHardpoint !== null || selectedBay !== null;
  $: pickerSpares =
    selectedSlot !== null
      ? equipmentPool.filter((e) => e.fittedToShipId === null && e.slotType === selectedSlot)
      : selectedHardpoint !== null
        ? spareWeapons
        : selectedBay !== null
          ? sparePods
          : [];
  $: pickerLabel =
    selectedSlot !== null
      ? EQUIPMENT_SLOTS[selectedSlot]?.label ?? selectedSlot
      : selectedHardpoint !== null
        ? "Weapon"
        : selectedBay !== null
          ? "Drone Pod"
          : "";

  // --- Formatting helpers -----------------------------------------------------
  function fmtFlat(v: number): string {
    return Number.isInteger(v) ? v.toString() : v.toFixed(1);
  }
  function fmtStatValue(row: StatRow): string {
    return row.kind === "pct" ? "×" + row.fitted.toFixed(2) : fmtFlat(Number(row.fitted.toFixed(1)));
  }
  // The signed base -> installed change, or null when it is effectively zero (so a row
  // simply omits the note rather than showing "+0"). Percent stats report in points.
  function fmtDelta(row: StatRow): string | null {
    const d = row.fitted - row.base;
    if (Math.abs(d) < 1e-9) return null;
    const sign = d > 0 ? "+" : "";
    if (row.kind === "pct") return `${sign}${(d * 100).toFixed(0)} pts`;
    return `${sign}${fmtFlat(Number(d.toFixed(1)))} gear`;
  }
  // Repair ETA in the mockup's "~3m 20s left" shape (seconds only under a minute).
  function formatEta(sec: number): string {
    const s = Math.max(0, Math.ceil(sec));
    if (s < 60) return `~${s}s left`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `~${m}m left` : `~${m}m ${r}s left`;
  }

  // Human-readable text for a blocked-install reason. Total over EquipFitBlockReason
  // (a switch, no default) so a new token surfaces as a compile error here.
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

  // --- Combat display helpers -------------------------------------------------
  // Player-facing label for each required combat slot, for the dispatch-blocker
  // banner. Total over RequiredCombatSlot (a switch, no default).
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
  // The dispatch-blocker sentence BODY (the markup prepends a bold "Cannot patrol:").
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

  // A weapon's FAMILY color for the offense readout dot (kinetic amber / particle
  // accent / ew violet), read as stable tokens so it holds across the theme accent.
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
  function weaponName(piece: EquipmentInstance): string {
    return weaponDisplayName(piece.weaponType);
  }
  // A weapon's yield range for the offense readout: the base template yield plus the
  // piece's weaponYield bonus, matching the sim's weaponInstanceFromGear fold.
  function weaponYieldRange(piece: EquipmentInstance): string {
    const def = piece.weaponType ? WEAPON_DEFS[piece.weaponType as keyof typeof WEAPON_DEFS] : undefined;
    if (!def) return "";
    const bonus = (piece.implicitStats.weaponYield ?? 0) + (piece.rolledStats.weaponYield ?? 0);
    return `${def.yieldMin + bonus}-${def.yieldMax + bonus}`;
  }
  // A drone pod's role color + name for the DRONES readout (attack danger / defense
  // accent / support success).
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

  // --- Floating tooltip: JS viewport clamping (hard requirement) ---------------
  // The mockup's pure-CSS tooltips clip off the page edge; production MUST keep the
  // tooltip fully inside the viewport regardless of which tile it anchors to (top row,
  // bottom row, right edge, mobile). We render ONE floating wrapper at fixed position
  // and compute its coordinates from the anchor tile's rect + the tooltip's measured
  // size + the viewport: prefer above the tile, flip below when there is no room, and
  // clamp horizontally (and, as a final safety, vertically) within a small margin. The
  // wrapper is position:fixed so it escapes the panel's inner scroll clipping. This
  // lives HERE, around EquipmentTooltip, so EquipmentTooltip itself stays unchanged.
  //
  // CLAMP DEPENDENCY (see the matching note on .ss-tip-float in the style block): the
  // left/top below are VIEWPORT coordinates, which line up with this fixed element only
  // while the host .modal-backdrop stays a full-viewport, origin (0,0), unbordered,
  // untransformed fixed element (its backdrop-filter is what makes it the containing
  // block for position:fixed). A very tall tooltip is capped by the CSS max-height, and
  // because we read offsetHeight AFTER that cap, the vertical clamp here already fits
  // the (capped) element inside the 8px top / 8px bottom margins with no extra math.
  const TIP_MARGIN = 8; // min gap from any viewport edge (px)
  const TIP_GAP = 8; // gap between the tile and the tooltip (px)

  function positionTip(): void {
    if (!activeTip || !tipEl) return;
    // Measure the anchor tile + the (already max-height-capped) tooltip, then defer
    // the prefer-above / flip-below / clamp arithmetic to the shared pure helper so
    // this panel and the Combat View share ONE clamp implementation. The measuring +
    // await-tick reveal + reflow wiring stay here (they touch the DOM and this
    // panel's state); only the math moved out (behavior-preserving extraction).
    const anchor = activeTip.el.getBoundingClientRect();
    const { left, top } = clampFloatingTip({
      anchorRect: anchor,
      tipWidth: tipEl.offsetWidth,
      tipHeight: tipEl.offsetHeight,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      margin: TIP_MARGIN,
      gap: TIP_GAP,
    });

    tipLeft = left;
    tipTop = top;
    tipVisible = true;
  }

  // Open the floating tooltip for a piece. Rendered invisibly for one frame, then
  // measured + positioned + shown, so it never flashes at the wrong spot. Blocked
  // while the ship is damaged (tiles are locked then).
  async function openTip(piece: EquipmentInstance, action: TipAction, el: HTMLElement, pinned: boolean): Promise<void> {
    if (shipDamaged) return;
    // A fresh open (hover swap, click-pin, or picker open) supersedes any pending
    // grace-delay hide, so a stale timer can never close the tooltip we just opened.
    cancelTipHide();
    activeTip = { piece, action, el };
    // A pin only sticks on a coarse (touch) pointer. On a hover-capable device the
    // click still opens the tooltip, but leaving it UNPINNED means a subsequent hover
    // (e.g. onto a spare tile in the picker) can replace it, so desktop previewing is
    // never blocked by an earlier click. Touch keeps the pin so a tap reveals detail.
    tipPinned = pinned && !hoverCapable;
    tipVisible = false;
    await tick();
    positionTip();
  }
  // Close the tooltip. A pinned (tapped) tooltip ignores a transient (hover-out) close
  // so it stays put until it is explicitly dismissed (force) or replaced.
  function closeTip(force = false): void {
    if (tipPinned && !force) return;
    // Actually closing now, so drop any pending grace-delay hide (it would be a no-op
    // once activeTip is null, but clearing it keeps the timer state honest / leak-free).
    cancelTipHide();
    activeTip = null;
    tipPinned = false;
    tipVisible = false;
  }
  // Desktop hover preview: only when nothing is pinned (a pin outranks a hover). Entering
  // ANOTHER tile during the grace window cancels the pending hide and swaps the preview
  // (openTip cancels it), so moving between tiles keeps the spare-hover-preview working.
  function hoverTip(piece: EquipmentInstance, action: TipAction, el: HTMLElement): void {
    if (tipPinned) return;
    void openTip(piece, action, el, false);
  }
  // Pointer / focus left the tile. Do NOT hide at once: schedule the grace-delay hide so
  // the cursor can travel the gap onto the floating tooltip (which cancels it on enter)
  // to reach the Install / Uninstall button. A pinned (touch) tooltip is untouched: the
  // scheduled close routes through closeTip(false), which a pin ignores.
  function hoverOut(): void {
    scheduleTipHide();
  }
  // Keep the fixed tooltip glued to its tile as the panel / window scrolls or resizes
  // (capture:true catches the inner column's scroll, which does not bubble to window).
  function reflowTip(): void {
    if (activeTip) positionTip();
  }
  // Outside-press dismiss for a PINNED (touch) tooltip: a press that lands neither on
  // the anchor tile nor inside the tooltip itself closes the pin. This is safe for the
  // host modal because the Ship Systems .modal-backdrop has NO backdrop click-close
  // handler (App.svelte), so this only hides the floating tooltip: it never closes the
  // modal and never touches its focus trap. A press on the tile toggles via the tile's
  // own click, and a press on a spare tile pins that spare's tooltip (its click runs
  // after this and re-opens the tooltip onto the tapped tile).
  function onOutsidePointerDown(e: Event): void {
    if (!tipPinned || !activeTip) return;
    const target = e.target as Node | null;
    if (target && (activeTip.el.contains(target) || (tipEl && tipEl.contains(target)))) return;
    closeTip(true);
  }
  onMount(() => {
    window.addEventListener("scroll", reflowTip, true);
    window.addEventListener("resize", reflowTip);
    window.addEventListener("pointerdown", onOutsidePointerDown, true);
  });
  onDestroy(() => {
    window.removeEventListener("scroll", reflowTip, true);
    window.removeEventListener("resize", reflowTip);
    window.removeEventListener("pointerdown", onOutsidePointerDown, true);
    // Clear any pending grace-delay hide timer so it cannot fire after teardown (leak).
    cancelTipHide();
  });

  // --- Interaction ------------------------------------------------------------
  // Selecting a slot / hardpoint / bay opens its install picker, clearing the other
  // two (mutual exclusivity) and closing any open tooltip. Re-selecting the same one
  // toggles the picker closed.
  function selectSlot(slotType: EquipmentSlotType): void {
    const willOpen = selectedSlot !== slotType;
    selectedHardpoint = null;
    selectedBay = null;
    selectedSlot = willOpen ? slotType : null;
    closeTip(true);
  }
  function selectHardpoint(index: number): void {
    const willOpen = selectedHardpoint !== index;
    selectedSlot = null;
    selectedBay = null;
    selectedHardpoint = willOpen ? index : null;
    closeTip(true);
  }
  function selectBay(index: number): void {
    const willOpen = selectedBay !== index;
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = willOpen ? index : null;
    closeTip(true);
  }

  // Clicking a SLOT tile (singleton / hardpoint / bay): open (toggle) its picker, and
  // for a FILLED tile also pin its floating tooltip so a mobile tap reveals the piece
  // detail + Uninstall (QA #8). Empty tiles just open the picker. Locked while damaged.
  function clickSingleton(e: MouseEvent, meta: SlotMeta, fitted: EquipmentInstance | null): void {
    if (shipDamaged) return;
    const willOpen = selectedSlot !== meta.slotType;
    selectSlot(meta.slotType);
    if (willOpen && fitted) void openTip(fitted, "uninstall", e.currentTarget as HTMLElement, true);
  }
  function clickHardpoint(e: MouseEvent, index: number, weapon: EquipmentInstance | null): void {
    if (shipDamaged) return;
    const willOpen = selectedHardpoint !== index;
    selectHardpoint(index);
    if (willOpen && weapon) void openTip(weapon, "uninstall", e.currentTarget as HTMLElement, true);
  }
  function clickBay(e: MouseEvent, index: number, pod: EquipmentInstance | null): void {
    if (shipDamaged) return;
    const willOpen = selectedBay !== index;
    selectBay(index);
    if (willOpen && pod) void openTip(pod, "uninstall", e.currentTarget as HTMLElement, true);
  }
  // Clicking a SPARE tile OPENS + PINS its floating tooltip (the same "see the stats,
  // then confirm" flow a FILLED tile already uses for Uninstall), rather than installing
  // on the spot. The spare tooltip renders the Install button in EquipmentTooltip's action
  // slot; THAT button is the real install action (it calls handleInstall). This gives a
  // deliberate confirm step that matters most on MOBILE, where a direct tap-installs was
  // easy to misfire. openTip pins only on a coarse (touch) pointer, so desktop keeps its
  // hover preview and a keyboard Enter/Space (which fires this same click) pins like a tap.
  function clickSpare(e: MouseEvent, spare: EquipmentInstance): void {
    if (shipDamaged) return;
    void openTip(spare, "install", e.currentTarget as HTMLElement, true);
  }

  function handleInstall(instanceId: string): void {
    onInstall(shipId, instanceId);
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = null;
    closeTip(true);
  }
  function handleUninstall(instanceId: string): void {
    onUninstall(shipId, instanceId);
    closeTip(true);
  }
  function handleRepair(): void {
    onRepair(shipId);
  }
</script>

<div class="ss-dialog">
  {#if !ship || !shipDef}
    <!-- Defensive: the target ship vanished (deleted / stale id). Never crash the
         modal; show a recoverable message with a way out. -->
    <div class="ss-header">
      <div class="ss-title">SHIP SYSTEMS</div>
      <button class="ss-close" on:click={onClose} aria-label="Close Ship Systems">&#10005;</button>
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
              {#if onMission}&middot; on mission (install locked){/if}
            </div>
          {:else}
            <div class="ss-captain-name ss-parked">Unassigned / Parked</div>
          {/if}
        </div>
        <div class="ss-portrait" aria-hidden="true">{assignedCaptain ? "\u{1F9D1}‍\u{1F680}" : "⚓"}</div>
      </div>
      <button class="ss-close" on:click={onClose} aria-label="Close Ship Systems">&#10005;</button>
    </header>

    <!-- DAMAGED BANNER (QA #3): a prominent repair strip while the ship is damaged. It
         states the install lock, shows the running repair's progress + ETA, and offers
         a manual Repair trigger. When every Shipyard bay is busy no process exists yet,
         so it explains the wait (the auto-repair claims a bay the instant one frees). -->
    {#if shipDamaged}
      <div class="ss-repair" role="status">
        <div class="ss-repair-top"><span aria-hidden="true">&#128295;</span> Ship damaged &middot; returned from a lost patrol</div>
        <div class="ss-repair-msg">Your ship is damaged. It needs repair before you can install new ship systems.</div>
        {#if repairRunning}
          <div class="ss-repair-row">
            <div class="ss-repair-bar"><i style="width: {Math.round(repairProgress * 100)}%"></i></div>
            <div class="ss-repair-eta">{formatEta(repairEtaSeconds)}</div>
          </div>
        {:else}
          <div class="ss-repair-row">
            <div class="ss-repair-wait">Waiting for a free repair bay at the Shipyard.</div>
            <button class="ss-repair-btn" on:click={handleRepair}>Repair now</button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- DISPATCH-BLOCKER BANNER: a combat hull with any required combat slot stripped
         bare cannot patrol, so a red banner names the missing slot(s). Every hull is a
         combat hull now, so this can show on an economy hull whose combat gear was
         uninstalled. Mirrors canDispatchPatrol's per-slot gate. -->
    {#if isCombatHull && missingRequired.length > 0}
      <div class="ss-blocker" role="alert">
        <span class="ss-blocker-dot" aria-hidden="true"></span>
        <span><strong>Cannot patrol:</strong> {blockerText(missingRequired)}</span>
      </div>
    {/if}

    <div class="ss-main">
      <!-- LEFT: the function-grouped install tiles + the spare-pool picker. -->
      <div class="ss-fit-col">
        <!-- WEAPONS: one tile per hardpoint (every hull has hardpoints now). -->
        <div class="ss-group">
          <div class="ss-group-head">
            Weapons <span class="ss-group-cap">{mountedWeapons.length} / {hardpointCap} hardpoints</span>
          </div>
          <div class="ss-tiles">
            {#each Array.from({ length: hardpointCap }) as _, hpIndex (hpIndex)}
              {@const weapon = mountedWeapons[hpIndex] ?? null}
              {#if weapon}
                <button
                  type="button"
                  class="ss-tile"
                  class:sel={selectedHardpoint === hpIndex}
                  class:locked={shipDamaged}
                  disabled={shipDamaged}
                  style="--tc: {equipmentRarityColor(weapon.rarity)}"
                  aria-label={`Weapon hardpoint: ${weaponName(weapon)}, iL ${weapon.iLevel}`}
                  on:click={(e) => clickHardpoint(e, hpIndex, weapon)}
                  on:mouseenter={(e) => hoverTip(weapon, "uninstall", e.currentTarget)}
                  on:mouseleave={hoverOut}
                  on:focus={(e) => hoverTip(weapon, "uninstall", e.currentTarget)}
                  on:blur={hoverOut}
                >
                  <span class="ss-tile-dot"></span>
                  <span class="ss-tile-ic">{tileIcon(weapon)}</span>
                  <span class="ss-tile-il">iL {weapon.iLevel}</span>
                </button>
              {:else}
                <button
                  type="button"
                  class="ss-tile ss-tile-empty"
                  class:sel={selectedHardpoint === hpIndex}
                  class:locked={shipDamaged}
                  disabled={shipDamaged}
                  title="Empty hardpoint, tap to install a weapon"
                  on:click={(e) => clickHardpoint(e, hpIndex, null)}
                >
                  <span class="ss-tile-ic">+</span>
                  <span class="ss-tile-il">empty</span>
                </button>
              {/if}
            {/each}
          </div>
        </div>

        <!-- DEFENSE: shield emitter + hull plating singletons (combat, all hulls). -->
        <div class="ss-group">
          <div class="ss-group-head">Defense</div>
          <div class="ss-tiles">
            {#each DEFENSE_SLOTS as meta (meta.slotType)}
              {@const fitted = fittedBySlot[meta.slotType]}
              {#if fitted}
                <button
                  type="button"
                  class="ss-tile"
                  class:sel={selectedSlot === meta.slotType}
                  class:locked={shipDamaged}
                  disabled={shipDamaged}
                  style="--tc: {equipmentRarityColor(fitted.rarity)}"
                  aria-label={`${meta.label}: ${fitted.rarity} grade, iL ${fitted.iLevel}`}
                  on:click={(e) => clickSingleton(e, meta, fitted)}
                  on:mouseenter={(e) => hoverTip(fitted, "uninstall", e.currentTarget)}
                  on:mouseleave={hoverOut}
                  on:focus={(e) => hoverTip(fitted, "uninstall", e.currentTarget)}
                  on:blur={hoverOut}
                >
                  <span class="ss-tile-dot"></span>
                  <span class="ss-tile-ic">{tileIcon(fitted)}</span>
                  <span class="ss-tile-il">iL {fitted.iLevel}</span>
                </button>
              {:else}
                <button
                  type="button"
                  class="ss-tile ss-tile-empty"
                  class:sel={selectedSlot === meta.slotType}
                  class:locked={shipDamaged}
                  disabled={shipDamaged}
                  title={`Empty ${meta.label}, tap to install`}
                  on:click={(e) => clickSingleton(e, meta, null)}
                >
                  <span class="ss-tile-ic">+</span>
                  <span class="ss-tile-il">empty</span>
                </button>
              {/if}
            {/each}
          </div>
        </div>

        <!-- SHIP SYSTEMS: the economy singleton slots (never truly empty, an uninstall
             auto-restores a Standard-Issue baseline). -->
        <div class="ss-group">
          <div class="ss-group-head">
            Ship Systems <span class="ss-group-cap">{visibleSystemSlots.length} slots</span>
          </div>
          <div class="ss-tiles">
            {#each visibleSystemSlots as meta (meta.slotType)}
              {@const fitted = fittedBySlot[meta.slotType]}
              {#if fitted}
                <button
                  type="button"
                  class="ss-tile"
                  class:sel={selectedSlot === meta.slotType}
                  class:locked={shipDamaged}
                  disabled={shipDamaged}
                  style="--tc: {equipmentRarityColor(fitted.rarity)}"
                  aria-label={`${meta.label}: ${fitted.rarity} grade, iL ${fitted.iLevel}`}
                  on:click={(e) => clickSingleton(e, meta, fitted)}
                  on:mouseenter={(e) => hoverTip(fitted, "uninstall", e.currentTarget)}
                  on:mouseleave={hoverOut}
                  on:focus={(e) => hoverTip(fitted, "uninstall", e.currentTarget)}
                  on:blur={hoverOut}
                >
                  <span class="ss-tile-dot"></span>
                  <span class="ss-tile-ic">{tileIcon(fitted)}</span>
                  <span class="ss-tile-il">iL {fitted.iLevel}</span>
                </button>
              {:else}
                <button
                  type="button"
                  class="ss-tile ss-tile-empty"
                  class:sel={selectedSlot === meta.slotType}
                  class:locked={shipDamaged}
                  disabled={shipDamaged}
                  title={`Empty ${meta.label}, tap to install`}
                  on:click={(e) => clickSingleton(e, meta, null)}
                >
                  <span class="ss-tile-ic">+</span>
                  <span class="ss-tile-il">empty</span>
                </button>
              {/if}
            {/each}
          </div>
        </div>

        <!-- DRONE BAYS: carrier-only (a hangar capacity, not a universal slot). -->
        {#if hasDroneBays}
          <div class="ss-group">
            <div class="ss-group-head">
              Drone Bays <span class="ss-group-cap">{mountedPods.length} / {droneBayCap} bays</span>
            </div>
            <div class="ss-tiles">
              {#each Array.from({ length: droneBayCap }) as _, bayIndex (bayIndex)}
                {@const pod = mountedPods[bayIndex] ?? null}
                {#if pod}
                  <button
                    type="button"
                    class="ss-tile"
                    class:sel={selectedBay === bayIndex}
                    class:locked={shipDamaged}
                    disabled={shipDamaged}
                    style="--tc: {equipmentRarityColor(pod.rarity)}"
                    aria-label={`Drone bay: ${droneRoleName(pod.droneRole)}, iL ${pod.iLevel}`}
                    on:click={(e) => clickBay(e, bayIndex, pod)}
                    on:mouseenter={(e) => hoverTip(pod, "uninstall", e.currentTarget)}
                    on:mouseleave={hoverOut}
                    on:focus={(e) => hoverTip(pod, "uninstall", e.currentTarget)}
                    on:blur={hoverOut}
                  >
                    <span class="ss-tile-dot"></span>
                    <span class="ss-tile-ic">{tileIcon(pod)}</span>
                    <span class="ss-tile-il">iL {pod.iLevel}</span>
                  </button>
                {:else}
                  <button
                    type="button"
                    class="ss-tile ss-tile-empty"
                    class:sel={selectedBay === bayIndex}
                    class:locked={shipDamaged}
                    disabled={shipDamaged}
                    title="Empty drone bay, tap to install a pod"
                    on:click={(e) => clickBay(e, bayIndex, null)}
                  >
                    <span class="ss-tile-ic">+</span>
                    <span class="ss-tile-il">empty</span>
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        {/if}

        <!-- INSTALL PICKER (the reduced ss-control, QA #8): opens when a slot is tapped.
             The spares are TILES too, each with its own tooltip + Install button; tapping
             a spare tile OPENS + PINS that tooltip so the player sees the stats and then
             installs from its Install button. One consistent flow for every slot type. -->
        {#if pickerActive}
          <div class="ss-picker">
            <div class="ss-picker-head">Install &middot; {pickerLabel}</div>
            {#if shipDamaged}
              <p class="ss-note ss-note-dim">Repair the ship before installing new ship systems.</p>
            {:else if pickerSpares.length === 0}
              <p class="ss-note ss-note-dim">No spare {pickerLabel} systems in storage. Fabricate one, or uninstall from another ship.</p>
            {:else}
              <div class="ss-tiles">
                {#each pickerSpares as spare (spare.id)}
                  {@const gate = canFitEquipment(safeState, shipId, spare.id)}
                  <button
                    type="button"
                    class="ss-tile"
                    class:blocked={!gate.ok}
                    style="--tc: {equipmentRarityColor(spare.rarity)}"
                    disabled={!gate.ok}
                    title={gate.ok ? undefined : reasonText(gate.reason)}
                    on:click={(e) => clickSpare(e, spare)}
                    on:mouseenter={(e) => hoverTip(spare, "install", e.currentTarget)}
                    on:mouseleave={hoverOut}
                    on:focus={(e) => hoverTip(spare, "install", e.currentTarget)}
                    on:blur={hoverOut}
                  >
                    <span class="ss-tile-dot"></span>
                    <span class="ss-tile-ic">{tileIcon(spare)}</span>
                    <span class="ss-tile-il">iL {spare.iLevel}</span>
                  </button>
                {/each}
              </div>
              <p class="ss-note ss-note-dim">Tap a spare to view its stats, then Install. Hover for a preview.</p>
            {/if}
          </div>
        {:else}
          <p class="ss-note ss-note-dim ss-picker-hint">Tap a slot to install or uninstall a system. Hover a tile for its details.</p>
        {/if}
      </div>

      <!-- RIGHT: the categorized, scrollable stats panel (QA #5). -->
      <div class="ss-stats-col">
        <!-- COMBAT: the folded combat readout, shown for every hull. Hull integrity
             carries its frame + plating breakdown so a low number reads as weak gear,
             not damage (QA #3). -->
        {#if combatReadout}
          <div class="ss-cat">
            <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#9876;&#65039;</span> Combat</div>
            <div class="ss-srow">
              <span class="ss-sk">Hull integrity</span>
              <span class="ss-sv">
                {fmtFlat(combatReadout.hullTotal)}
                <small>(frame {fmtFlat(combatReadout.frameHp)} + plating {fmtFlat(combatReadout.platingHp)})</small>
              </span>
            </div>
            <div class="ss-srow"><span class="ss-sk">Shield capacity</span><span class="ss-sv">{fmtFlat(combatReadout.shieldCapacity)}</span></div>
            <div class="ss-srow"><span class="ss-sk">Shield recharge</span><span class="ss-sv">{fmtFlat(combatReadout.shieldRecharge)} / s</span></div>
            <div class="ss-srow"><span class="ss-sk">Weapons mounted</span><span class="ss-sv">{mountedWeapons.length} / {hardpointCap}</span></div>
            {#each mountedWeapons as weapon (weapon.id)}
              <div class="ss-srow ss-srow-sub">
                <span class="ss-sk"><span class="ss-fam" style="background: {weaponFamilyColor(weapon.weaponType)}"></span>{weaponName(weapon)}</span>
                <span class="ss-sv ss-sv-dim">{weaponYieldRange(weapon)}</span>
              </div>
            {/each}
            {#if combatReadout.ablativeArmor > 0}
              <div class="ss-srow"><span class="ss-sk">Ablative armor</span><span class="ss-sv">{fmtFlat(combatReadout.ablativeArmor)}</span></div>
            {/if}
            {#if battleRatingValue !== null}
              <div class="ss-srow"><span class="ss-sk">Battle Rating</span><span class="ss-sv ss-sv-accent">{formatNumber(battleRatingValue)}</span></div>
            {/if}
            <!-- DRONES: carrier-only, from the same fold. -->
            {#if hasDroneBays}
              <div class="ss-srow"><span class="ss-sk">Drone bays used</span><span class="ss-sv">{mountedPods.length} / {droneBayCap}</span></div>
              {#each mountedPods as pod (pod.id)}
                <div class="ss-srow ss-srow-sub">
                  <span class="ss-sk"><span class="ss-fam" style="background: {droneRoleColor(pod.droneRole)}"></span>{droneRoleName(pod.droneRole)}</span>
                  <span class="ss-sv ss-sv-dim">iL {pod.iLevel}</span>
                </div>
              {/each}
            {/if}
          </div>
        {/if}

        <!-- PROSPECTING: the two prospecting stats, each with its base -> installed
             gear delta (kept from the old base-vs-installed rows). -->
        <div class="ss-cat">
          <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#9935;</span> Prospecting</div>
          {#each prospectingRows as row (row.label)}
            {@const delta = fmtDelta(row)}
            <div class="ss-srow">
              <span class="ss-sk">{row.label}</span>
              <span class="ss-sv">{fmtStatValue(row)}{#if delta}<small> ({delta})</small>{/if}</span>
            </div>
          {/each}
        </div>

        <!-- LOGISTICS: the remaining economy stats (FTL / fuel / power / mass), each
             with its base -> installed delta. Kept so the base-vs-installed comparison
             the old panel showed is not lost (the mockup folded these away). -->
        <div class="ss-cat">
          <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#128666;</span> Logistics</div>
          {#each logisticsRows as row (row.label)}
            {@const delta = fmtDelta(row)}
            <div class="ss-srow">
              <span class="ss-sk">{row.label}</span>
              <span class="ss-sv">{fmtStatValue(row)}{#if delta}<small> ({delta})</small>{/if}</span>
            </div>
          {/each}
        </div>

        <!-- EXPLORATION: a forward placeholder, dimmed (user decision). -->
        <div class="ss-cat ss-cat-soon">
          <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#128301;</span> Exploration <span class="ss-cat-soon-tag">Coming soon</span></div>
          <p class="ss-cat-placeholder">Exploration systems and stats arrive in a later update.</p>
        </div>
      </div>
    </div>
  {/if}

  <!-- FLOATING TOOLTIP: one JS-positioned wrapper around the reusable EquipmentTooltip,
       clamped inside the viewport (see positionTip). The Install / Uninstall button is
       injected into EquipmentTooltip's action <slot>; EquipmentTooltip is unchanged. -->
  {#if activeTip}
    {@const tipPiece = activeTip.piece}
    {@const tipAction = activeTip.action}
    <div
      class="ss-tip-float"
      bind:this={tipEl}
      role="tooltip"
      style="left: {tipLeft}px; top: {tipTop}px; visibility: {tipVisible ? 'visible' : 'hidden'}"
      on:pointerenter={cancelTipHide}
      on:pointerleave={scheduleTipHide}
    >
      <EquipmentTooltip piece={tipPiece}>
        {#if tipAction === "uninstall"}
          <!-- Every installed system, economy OR combat, Standard-Issue baseline OR crafted, can be
               uninstalled to an empty slot (user call 2026-08-26). Uninstalling an economy baseline
               destroys the free floor and empties the slot (equipment.ts unfitEquipmentInstance);
               uninstalling a crafted piece returns it to the warehouse. An empty economy slot is
               economically identical to its baseline (+0), so this never costs the player a stat. -->
          <button
            class="ss-btn ss-btn-uninstall"
            disabled={onMission || shipDamaged}
            title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
            on:click={() => handleUninstall(tipPiece.id)}
          >
            Uninstall
          </button>
        {:else}
          {@const gate = canFitEquipment(safeState, shipId, tipPiece.id)}
          <button
            class="ss-btn ss-btn-install"
            disabled={!gate.ok || shipDamaged}
            title={gate.ok ? undefined : reasonText(gate.reason)}
            on:click={() => handleInstall(tipPiece.id)}
          >
            {gate.ok ? "Install" : "Blocked"}
          </button>
        {/if}
      </EquipmentTooltip>
    </div>
  {/if}
</div>

<style>
  /* The dialog is the panel body itself (NOT wrapped in Panel.svelte). OPAQUE
     background so it reads solid on Brave (no backdrop-filter). max-height:100%
     bounds it against the fixed .modal-backdrop (scroll-containment invariant).
     Flex column: header + banners stay pinned, .ss-main flexes and scrolls. */
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

  /* DAMAGED REPAIR BANNER (QA #3): a danger-toned strip below the header. */
  .ss-repair {
    flex-shrink: 0;
    padding: 11px 14px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.25);
    background: rgba(248, 113, 113, 0.12);
  }
  .ss-repair-top {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 650;
    color: var(--color-danger);
  }
  .ss-repair-msg {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin: 4px 0 8px;
    line-height: 1.4;
  }
  .ss-repair-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ss-repair-bar {
    flex: 1;
    height: 8px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .ss-repair-bar i {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--color-warning), var(--color-success));
  }
  .ss-repair-eta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  .ss-repair-wait {
    flex: 1;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .ss-repair-btn {
    flex: 0 0 auto;
    font-size: 12px;
    font-weight: 650;
    padding: 6px 13px;
    cursor: pointer;
    border: 1px solid var(--color-warning);
    background: rgba(251, 191, 36, 0.14);
    color: var(--color-warning);
  }
  .ss-repair-btn:hover {
    background: rgba(251, 191, 36, 0.24);
  }

  /* DISPATCH-BLOCKER BANNER: a red danger strip when a required combat slot is empty. */
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

  /* MAIN: two columns on wide screens; each column scrolls independently. On narrow
     (mobile) screens the columns stack and .ss-main itself scrolls. min-height:0 lets
     the flex children shrink and hand scrolling to the inner overflow. */
  .ss-main {
    display: flex;
    gap: 14px;
    padding: 12px 14px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .ss-fit-col {
    flex: 0 0 52%;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .ss-fit-col::-webkit-scrollbar {
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
    .ss-fit-col,
    .ss-stats-col {
      flex: none;
      width: auto;
      overflow: visible;
    }
  }

  /* FUNCTION GROUP (Weapons / Defense / Ship Systems / Drone Bays). */
  .ss-group-head {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ss-group-cap {
    margin-left: auto;
    font-size: 9px;
    color: var(--color-text-dim);
    letter-spacing: 0.05em;
  }
  .ss-tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* ONE ICON TILE: rarity-colored top border + corner dot (--tc), variety glyph, iL
     badge. Mirrors App.svelte's .systems-tile (the Warehouse bay) so the two read
     alike. A real <button> so it is keyboard-focusable with no a11y tabindex warning. */
  .ss-tile {
    position: relative;
    width: 60px;
    height: 60px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
    border-top: 3px solid var(--tc, var(--color-border));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 4px;
    cursor: pointer;
    font-family: var(--font-body);
    transition: border-color 0.12s, transform 0.1s;
  }
  .ss-tile:hover,
  .ss-tile:focus-visible {
    border-color: var(--color-border-strong);
    transform: translateY(-1px);
    outline: none;
  }
  .ss-tile.sel {
    box-shadow: 0 0 0 2px var(--color-accent);
    border-color: var(--color-accent);
  }
  .ss-tile-dot {
    position: absolute;
    top: 5px;
    right: 6px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tc, var(--color-text-dim));
  }
  .ss-tile-ic {
    font-size: 24px;
    line-height: 1;
  }
  .ss-tile-il {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
  /* An empty slot: dashed, dim, a "+" affordance. */
  .ss-tile-empty {
    border-top-color: var(--color-border);
    border-style: dashed;
    background: transparent;
  }
  .ss-tile-empty .ss-tile-ic {
    font-size: 22px;
    color: var(--color-text-dim);
  }
  .ss-tile-empty .ss-tile-il {
    color: var(--color-text-dim);
  }
  /* A spare that cannot be installed right now (gate blocked): dimmed + not-allowed. */
  .ss-tile.blocked {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* Locked while the ship is damaged: dimmed, non-interactive (QA #3). */
  .ss-tile.locked,
  .ss-tile:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }
  .ss-tile.blocked:disabled {
    opacity: 0.4;
  }

  /* INSTALL PICKER (the reduced ss-control): a dashed panel holding spare tiles. */
  .ss-picker {
    border: 1px dashed rgba(var(--color-accent-rgb), 0.35);
    background: var(--color-bg-deep);
    padding: 11px;
  }
  .ss-picker-head {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    margin-bottom: 9px;
  }
  .ss-picker-hint {
    text-align: center;
    padding: 8px 0 2px;
  }

  /* STATS CATEGORY (Combat / Prospecting / Logistics / Exploration). */
  .ss-cat {
    margin-bottom: 14px;
  }
  .ss-cat-head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 700;
    color: var(--color-accent);
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.2);
  }
  .ss-cat-glyph {
    font-size: 14px;
  }
  .ss-cat-soon {
    opacity: 0.55;
  }
  .ss-cat-soon-tag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    font-weight: 400;
  }
  .ss-cat-placeholder {
    font-size: 11px;
    color: var(--color-text-dim);
    font-style: italic;
    padding: 4px 0;
    margin: 0;
  }
  .ss-srow {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    font-size: 12px;
    padding: 3px 0;
  }
  .ss-srow-sub {
    padding-left: 10px;
  }
  .ss-sk {
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .ss-sv {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    text-align: right;
    white-space: nowrap;
  }
  .ss-sv small {
    color: var(--color-text-dim);
    font-size: 10px;
  }
  .ss-sv-accent {
    color: var(--color-accent-bright);
  }
  .ss-sv-dim {
    color: var(--color-text-secondary);
  }
  /* Weapon-family / drone-role indicator dot in the readout (color set inline). */
  .ss-fam {
    display: inline-block;
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 2px;
    margin-right: 5px;
  }

  /* ACTION BUTTONS injected into the floating tooltip's footer slot. */
  .ss-btn {
    flex: 0 0 auto;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
    background: rgba(var(--color-accent-rgb), 0.12);
    border: 1px solid rgba(var(--color-accent-rgb), 0.5);
    color: var(--color-accent-bright);
  }
  .ss-btn:hover:not(:disabled) {
    background: rgba(var(--color-accent-rgb), 0.22);
  }
  .ss-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ss-btn-uninstall {
    color: var(--color-danger);
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.1);
  }
  .ss-btn-uninstall:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
  }
  /* FLOATING TOOLTIP WRAPPER: position:fixed so it escapes the panel's inner scroll
     clipping; JS sets left/top (viewport-clamped) + toggles visibility. High z-index
     so it sits above the modal surface.

     CLAMP DEPENDENCY (do not break): positionTip() computes left/top in VIEWPORT
     coordinates and this element is position:fixed, so the two only coincide while the
     nearest fixed-positioning containing block is the viewport itself. The host
     .modal-backdrop (App.svelte) provides that: its backdrop-filter makes it the
     containing block for position:fixed descendants, and it is a full-viewport,
     origin (0,0), unbordered, untransformed fixed element (position:fixed; inset:0),
     so its padding box top-left sits exactly at viewport (0,0). If .modal-backdrop
     ever gains a border, a transform, or stops covering the whole viewport, this
     tooltip's placement math goes wrong and must be revisited.

     max-height caps an over-tall tooltip (a legendary piece with many rolled affixes
     on a short/landscape phone) to the viewport minus the 8px top + 8px bottom margins
     positionTip() reserves, and overflow-y lets the capped tooltip scroll INTERNALLY
     instead of clipping off the bottom edge unreachably. positionTip() reads
     offsetHeight AFTER this cap applies, so its vertical clamp already fits the capped
     element inside those margins with no extra math. */
  .ss-tip-float {
    position: fixed;
    z-index: 60;
    width: 244px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    pointer-events: auto;
    /* SOLID OPAQUE backing so nothing behind the tooltip bleeds through. The inner
       EquipmentTooltip .et card already declares an opaque background, but it stays
       PRESERVE-UNCHANGED, so we guarantee opacity from the wrapper: a solid theme dark
       (never an rgba with alpha). The .et card is SQUARE (no border-radius) and, with
       the global box-sizing:border-box, fills this 244px wrapper exactly, so a square
       (unrounded) backing sits precisely behind it and no opaque backing pokes outside
       the card's border. */
    background: var(--color-bg-deep);
  }

  /* Shared small-note text. */
  .ss-note {
    font-size: 11px;
    color: var(--color-text-secondary);
    margin: 8px 0 0;
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
