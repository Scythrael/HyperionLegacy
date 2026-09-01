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
  //     acceptance requirement. EquipmentTooltip.svelte was deliberately extended on
  //     this branch (commit df53dd5) to resolve weapon/drone blueprint display names;
  //     it is otherwise preserved as-is (this panel injects the action button via slot,
  //     it does not modify the card's internals).
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
  // Renamable Ships: the shared name-length ceiling, so this panel's rename input
  // is capped at EXACTLY the same limit renameShip (the pure seam) enforces. One
  // source of truth for the number, no drift between the input's maxlength and the
  // validation the save runs.
  import { MAX_CAPTAIN_NAME } from "./game/captainName";
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
  import { computeCombatReadout } from "./game/combatFit";
  // 0.13.2 Unit 5: the PURE "what if I installed this?" helper. applyHypotheticalInstall
  // builds the gear array a real fitEquipment would produce (never mutating state);
  // readoutFor folds that array's Battle Rating + combat readout through the SAME pure fns
  // the real install uses, so the compare view can NEVER drift from the installed result
  // (pinned by shipLoadout.test.ts's fidelity test). The install itself still routes through
  // the existing onInstall -> fitEquipment path; this only PREVIEWS the outcome.
  import { applyHypotheticalInstall, readoutFor, type InstallTarget } from "./game/shipLoadout";
  import { weaponDisplayName } from "./game/combat/combatView";
  import { WEAPON_DEFS } from "./game/combat/weapons";
  import { battleRating } from "./game/combat/rating";
  import { formatNumber } from "./game/format";
  // Shared modal a11y action (0.13.2 QA): traps Tab focus inside the install modal, closes it on
  // Escape, and restores focus to the opener on close. Same action the app's other modals use.
  import { focusTrap } from "./focusTrap";
  // The SAME reusable rarity-bordered card the Warehouse Ship Systems bay uses, plus
  // its module-exported single-source helpers (rarity color + variety glyph). Reused
  // here so a tile + its tooltip read the piece's identity in EXACTLY the format the
  // bay does, one card component, no second renderer to drift. The Install / Uninstall
  // control is injected into the card's footer <slot>. EquipmentTooltip was extended on
  // this branch (commit df53dd5) for weapon/drone blueprint name resolution and is
  // otherwise preserved.
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
  // Renamable Ships: routes a rename (or a clear) back to the host, which runs the
  // pure renameShip seam + doSave + pushLog exactly once. The panel owns only the
  // in-progress edit UI (the draft string + focus); it never mutates state itself.
  // `name` is the RAW draft: an empty / whitespace string is a valid request that
  // CLEARS the custom name back to the hull default (renameShip handles the trim).
  export let onRename: (shipId: string, name: string) => void;
  export let onClose: () => void;
  // 0.13.2 Unit 4 (Ships-tab redesign, Layout C loadout board): when EMBEDDED the panel
  // is no longer a modal-on-top, it IS the full-screen ship-detail equip surface rendered
  // inline in the Ships tab. Embedded drops the modal chrome (the "SHIP SYSTEMS" title +
  // the close button) and lets the host .tab-scroll-area own the page scroll (the two
  // inner columns stop scrolling independently), so there is ONE equip view, not a small
  // dialog floating over the ship page. Defaults false so the component stays reusable as
  // a standalone dialog if ever mounted that way again.
  export let embedded = false;
  // The host-computed status line (e.g. "On patrol, Sector Sweep") shown in the embedded
  // board header. The host (App.svelte) already owns MISSIONS / PATROLS + the exact status
  // wording the roster uses, so it is passed in rather than re-derived here (one source of
  // truth for the label, no drift). Empty string hides the row.
  export let statusLabel = "";

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
  // 0.13.2 Unit 7 (a11y focus management): the Swap / Install button that OPENED the install
  // flow, captured so a Cancel can return focus to it (the picker's Cancel button unmounts, so
  // without this focus would fall to <body>). The slot tiles stay mounted while the picker is
  // open and Cancel changes no gear, so the trigger is still connected on the Cancel path; we
  // guard on isConnected anyway. A committed Install does NOT restore here (its slot re-renders
  // into a filled tile), so this is Cancel-only, matching closePicker's single caller.
  let pickerTrigger: HTMLElement | null = null;
  // 0.13.2 Unit 5: the spare currently CHOSEN in the install flow (its id), driving the
  // current-vs-candidate compare. Null = no spare picked yet (the flow shows just the tile
  // list). This one shared reactive drives BOTH presentations: on a wide viewport the compare
  // renders beside the list and updates in place as this changes; on a narrow viewport the CSS
  // drills to the compare when it is set (see the .ss-flow container-query rules), so there is
  // no matchMedia code-fork and no duplicated markup.
  let installCandidateId: string | null = null;

  // The floating EquipmentTooltip currently shown (hover on desktop, tap-pin on mobile).
  // 0.13.2 Unit 4: the tooltip is DISPLAY-ONLY now. It carries NO Install / Uninstall
  // button anymore (those moved to the stable slot/tile buttons below), so it no longer
  // needs an `action` discriminator; it just previews the piece a player is hovering /
  // tapping for info. EquipmentTooltip itself renders its action footer only when the host
  // passes slot content, so passing none (see the markup) leaves it purely informational.
  //   pinned, opened by a tap/click (persists until dismissed) vs a transient hover.
  let activeTip: { piece: EquipmentInstance; el: HTMLElement } | null = null;
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
    installCandidateId = null;
    activeTip = null;
    tipPinned = false;
    tipVisible = false;
    // Also drop any in-progress rename edit, so an open name draft never commits onto
    // the newly-shown ship (commit() reads the live shipId + nameDraft). Latent today
    // (the modal blocks switching mid-edit) but a real footgun the moment that changes.
    editingName = false;
    nameDraft = "";
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

  // --- Ship name (Renamable Ships) --------------------------------------------
  // The header title is the ship's DISPLAY name: its custom `name` if set, else the
  // hull-type label (e.g. "General Freighter"). `shipHasCustomName` gates the hull-
  // class SUBTITLE so an UN-named ship does not show its hull label twice (title +
  // subtitle): a renamed ship shows name-over-class, an un-named ship shows just
  // the class as the title.
  $: shipDisplayName = ship ? (ship.name ?? shipDef?.label ?? shipId) : "";
  $: shipHasCustomName = ship?.name !== undefined && ship.name.length > 0;

  // Click-to-edit state for the name. `editingName` swaps the title text for an
  // input; `nameDraft` two-way binds it; `nameInputEl` is focused after the swap.
  // Kept LOCAL: the panel owns only the in-progress edit, the commit routes through
  // onRename -> renameShip (the pure seam that trims / validates / clears).
  let editingName = false;
  let nameDraft = "";
  let nameInputEl: HTMLInputElement | null = null;

  // Enter edit mode: seed the draft with the CURRENT custom name (empty when the
  // ship is un-named, so the placeholder shows the hull label and Enter-on-empty
  // simply leaves it un-named). Focus + select after the DOM swaps in the input.
  async function startNameEdit(): Promise<void> {
    if (!ship) return;
    nameDraft = ship.name ?? "";
    editingName = true;
    await tick();
    nameInputEl?.focus();
    nameInputEl?.select();
  }

  // Commit the draft. Guarded so the blur that Enter/Escape triggers (both call
  // .blur() after already flipping editingName) does NOT double-fire. Sending the
  // raw draft is intentional: renameShip trims it, and an empty draft CLEARS the
  // name back to the hull default. On a rejected name (charset / profanity) the
  // host's state does not change, so shipDisplayName re-derives to the old name and
  // the title visibly reverts.
  function commitNameEdit(): void {
    if (!editingName) return;
    editingName = false;
    onRename(shipId, nameDraft);
  }

  // Abandon the edit without committing (Escape). Leaves the stored name untouched.
  function cancelNameEdit(): void {
    editingName = false;
    nameDraft = "";
  }

  // Enter saves, Escape cancels. Both blur the input; the guard in commitNameEdit
  // keeps the follow-on blur from committing a second time (or committing a cancel).
  function onNameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitNameEdit();
      nameInputEl?.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      // This handler only exists while a rename edit is active, so Escape always has
      // its own thing to cancel here. Stop it bubbling to the focusTrap backdrop, or
      // the one keypress would BOTH cancel the edit AND close the whole Ship Systems
      // panel. (Enter needs no such guard: the trap ignores every key but Escape/Tab.)
      event.stopPropagation();
      cancelNameEdit();
      nameInputEl?.blur();
    }
  }

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
  // All economy stat rows, shown together under the "Exploration / Prospecting" readout
  // section (the mockup's grouping): extraction + cargo + FTL + fuel + power + mass, each
  // keeping its base -> installed delta so the comparison the panel has always shown holds.
  $: liveStatRows = baseStats && fitStats ? buildLiveRows(baseStats, fitStats) : [];

  // --- Combat reads -----------------------------------------------------------
  // combatHullTypeOf now returns non-null for every hull, so isCombatHull is true for
  // all hulls: the combat slots, the weapon strip and the combat readout render on an
  // economy hull too (it carries a weak Standard-Issue combat set). Only DRONE BAYS
  // stay carrier-only (see hasDroneBays).
  $: combatHullType = ship ? combatHullTypeOf(ship.typeKey) : null;
  $: isCombatHull = combatHullType !== null;

  // The folded combat readout (hull = frame + plating, shield pool/recharge, mounted
  // weapons + pods, and which required slots are still empty). Derived from the SAME
  // fittedPieces the economy stats use, so it recomputes on every install / uninstall.
  $: combatReadout =
    ship && shipDef && isCombatHull
      ? computeCombatReadout(fittedPieces, shipDef, shipDef.weaponHardpoints, shipDef.droneBays ?? 0)
      : null;

  $: mountedWeapons = combatReadout ? combatReadout.mountedWeapons : [];
  $: hardpointCap = combatReadout ? combatReadout.hardpointCap : 0;
  $: spareWeapons = equipmentPool.filter((e) => e.fittedToShipId === null && e.slotType === "weapon");

  // Combat-gear readiness (combat-defense rework, Unit 3/6, design S5 "inform, don't forbid"):
  //   - The REACTOR is the ONLY hard dispatch block. A ship with an empty reactorCore slot has no
  //     power and physically cannot be dispatched (canDispatchPatrol: noReactor). Read off the same
  //     fittedBySlot map the tiles use.
  //   - A missing WEAPON is a non-blocking ADVISORY: the ship can dispatch but cannot return fire.
  //   - Missing plating / shield emitter are OPTIONAL, silent player choices (a bare hull keeps its
  //     nonzero frame armor; no emitter means 0 shields, an emitter being the shield source), surfaced
  //     in the Defensive readout, not a banner.
  $: reactorMissing = ship !== null && fittedBySlot["reactorCore"] == null;
  $: noWeaponInstalled = combatReadout ? combatReadout.missingRequired.includes("weapon") : false;

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

  // --- Install flow reads (0.13.2 Unit 5: INSTALLED banner + compare) ----------
  // The open target as the pure helper's InstallTarget (which slot / hardpoint / bay was
  // tapped). Mirrors the three mutually-exclusive selections; null when no picker is open.
  // Used to pin the INSTALLED banner and to feed applyHypotheticalInstall.
  $: installTarget =
    selectedSlot !== null
      ? ({ kind: "slot" } as InstallTarget)
      : selectedHardpoint !== null
        ? ({ kind: "hardpoint", index: selectedHardpoint } as InstallTarget)
        : selectedBay !== null
          ? ({ kind: "bay", index: selectedBay } as InstallTarget)
          : null;

  // The piece CURRENTLY installed at the open target (the INSTALLED banner pins this). For a
  // singleton slot it is that slot's occupant; for a weapon hardpoint / drone bay it is the
  // piece in that indexed cell (null when the cell is empty, i.e. installing into a blank).
  $: installedPiece =
    selectedSlot !== null
      ? fittedBySlot[selectedSlot] ?? null
      : selectedHardpoint !== null
        ? mountedWeapons[selectedHardpoint] ?? null
        : selectedBay !== null
          ? mountedPods[selectedBay] ?? null
          : null;

  // If the chosen candidate is no longer among the compatible spares (it was just installed
  // elsewhere, salvaged, or the picker switched slots), drop the selection so the compare
  // never points at a vanished piece. Guarded to assign ONLY when stale, so it cannot loop.
  $: if (installCandidateId !== null && !pickerSpares.some((s) => s.id === installCandidateId)) {
    installCandidateId = null;
  }
  // The chosen spare instance (or null before one is picked).
  $: installCandidate =
    installCandidateId !== null ? pickerSpares.find((s) => s.id === installCandidateId) ?? null : null;
  // Is the chosen candidate an ECONOMY system (cargo / FTL / reactor / rig)? Economy pieces
  // change the economy-derived stats (shipDerivedStats), combat pieces change the combat
  // readout, so the compare rows below branch on this to show the RELEVANT stat set.
  $: candidateIsEconomy =
    installCandidate !== null && SYSTEM_SLOTS.some((s) => s.slotType === installCandidate.slotType);

  // The hypothetical gear array with the candidate installed (the SAME shape fitEquipment
  // would produce), and the two readouts (current vs candidate) folded through the pure
  // helper. Guarded on the hull resolving (shipDef + combat class + an open target).
  $: candidateGear =
    installCandidate !== null && installTarget !== null
      ? applyHypotheticalInstall(fittedPieces, installCandidate, installTarget)
      : null;
  // Only folded while a candidate is being compared (the compare's stat rows read it); the
  // headline current BR otherwise falls back to battleRatingValue, the SAME fold, so no
  // per-tick readout runs when the flow is idle.
  $: currentReadout =
    installCandidate && shipDef && combatHullType
      ? readoutFor(fittedPieces, shipDef, combatHullType, shipDef.weaponHardpoints, shipDef.droneBays ?? 0)
      : null;
  $: candidateReadout =
    candidateGear && shipDef && combatHullType
      ? readoutFor(candidateGear, shipDef, combatHullType, shipDef.weaponHardpoints, shipDef.droneBays ?? 0)
      : null;

  // The compare's Battle Rating headline: current -> candidate, and the net delta.
  $: compareCurrentBR = currentReadout ? currentReadout.rating : battleRatingValue;
  $: compareCandidateBR = candidateReadout ? candidateReadout.rating : null;
  $: compareNet =
    compareCurrentBR !== null && compareCandidateBR !== null ? compareCandidateBR - compareCurrentBR : null;

  // The per-stat compare rows shown when a candidate is chosen. Combat pieces read the two
  // CombatReadouts (hull / shield / recharge / weapons / pods); economy pieces read the two
  // shipDerivedStats folds (extraction / cargo / FTL / fuel / power / mass). Each row carries
  // the current + candidate display text, the raw delta, and good / bad flags so the markup
  // colors an improvement green and a regression red (higher is better for every stat here
  // EXCEPT Power Draw + Mass, where lower is better).
  type CompareRow = { label: string; curText: string; candText: string; deltaText: string | null; good: boolean; bad: boolean };
  const ECON_LOWER_IS_BETTER = new Set<string>(["Power Draw", "Mass"]);
  function statValueText(row: StatRow, which: "base" | "fitted"): string {
    const v = which === "base" ? row.base : row.fitted;
    return row.kind === "pct" ? "×" + v.toFixed(2) : fmtFlat(Number(v.toFixed(1)));
  }
  $: compareRows = ((): CompareRow[] => {
    if (!installCandidate || !candidateGear) return [];
    // ECONOMY: diff the derived stats with base = the CURRENTLY-installed loadout and
    // fitted = the hypothetical candidate loadout, reusing the exact rows the live board shows.
    if (candidateIsEconomy) {
      if (!ship || !fitStats) return [];
      const candStats = shipDerivedStats(ship, candidateGear);
      return buildLiveRows(fitStats, candStats).map((r) => {
        const delta = r.fitted - r.base;
        const zero = Math.abs(delta) < 1e-9;
        const lowerBetter = ECON_LOWER_IS_BETTER.has(r.label);
        const good = !zero && (lowerBetter ? delta < 0 : delta > 0);
        const bad = !zero && !good;
        // Percent stats report the change in points, flat stats as the raw number.
        const deltaText = zero
          ? null
          : r.kind === "pct"
            ? `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)} pts`
            : `${delta > 0 ? "+" : ""}${fmtFlat(Number(delta.toFixed(1)))}`;
        return { label: r.label, curText: statValueText(r, "base"), candText: statValueText(r, "fitted"), deltaText, good, bad };
      });
    }
    // COMBAT: diff the two folded combat readouts. Every stat here is higher-is-better.
    if (!currentReadout || !candidateReadout) return [];
    const cur = currentReadout.combat;
    const cand = candidateReadout.combat;
    const defs = [
      { label: "Hull integrity", cv: cur.hullTotal, dv: cand.hullTotal, show: true },
      { label: "Shield capacity", cv: cur.shieldTotal, dv: cand.shieldTotal, show: true },
      { label: "Shield recharge", cv: cur.rechargeTotal, dv: cand.rechargeTotal, show: true },
      { label: "Ablative armor", cv: cur.ablativeArmor, dv: cand.ablativeArmor, show: cur.ablativeArmor > 0 || cand.ablativeArmor > 0 },
      { label: "Weapons mounted", cv: cur.mountedWeapons.length, dv: cand.mountedWeapons.length, show: true },
      { label: "Drone pods", cv: cur.mountedPods.length, dv: cand.mountedPods.length, show: hasDroneBays },
    ];
    return defs
      .filter((d) => d.show)
      .map((d) => {
        const delta = d.dv - d.cv;
        const zero = Math.abs(delta) < 1e-9;
        const deltaText = zero ? null : `${delta > 0 ? "+" : ""}${fmtFlat(Number(delta.toFixed(1)))}`;
        return { label: d.label, curText: fmtFlat(d.cv), candText: fmtFlat(d.dv), deltaText, good: !zero && delta > 0, bad: !zero && delta < 0 };
      });
  })();

  // --- Formatting helpers -----------------------------------------------------
  function fmtFlat(v: number): string {
    return Number.isInteger(v) ? v.toString() : v.toFixed(1);
  }
  // A defensive-stat EFFECTIVENESS ratio (combat-defense "Effectiveness %" model) as a whole-percent
  // string, e.g. 1.2 -> "120%", 0.667 -> "67%". May read below or above 100% (a glass hull is < 100%,
  // a capital hull > 100%). Rounded to the nearest point so the readout stays clean.
  function fmtPct(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
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
  // A signed Battle-Rating delta for the tiles + the compare headline, e.g. "+68 BR" /
  // "-22 BR" / "±0 BR". formatNumber handles the magnitude (thousands separators); the sign
  // is prefixed here so a negative delta never mis-renders. 0.13.2 Unit 5.
  function fmtBRDelta(delta: number): string {
    if (delta === 0) return "±0 BR"; // plus-minus sign for a no-change swap
    const sign = delta > 0 ? "+" : "-";
    return `${sign}${formatNumber(Math.abs(delta))} BR`;
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
  // lives HERE, around EquipmentTooltip, so the card's internals stay untouched (the
  // only edit to EquipmentTooltip on this branch was the df53dd5 blueprint name resolver).
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
  async function openTip(piece: EquipmentInstance, el: HTMLElement, pinned: boolean): Promise<void> {
    if (shipDamaged) return;
    // A fresh open (hover swap, click-pin, or picker open) supersedes any pending
    // grace-delay hide, so a stale timer can never close the tooltip we just opened.
    cancelTipHide();
    activeTip = { piece, el };
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
  function hoverTip(piece: EquipmentInstance, el: HTMLElement): void {
    if (tipPinned) return;
    void openTip(piece, el, false);
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
  // Opening (or switching) a picker always clears the chosen compare candidate, so the flow
  // reopens on the tile LIST rather than a stale compare from a previous slot (0.13.2 Unit 5).
  // 0.13.2 Unit 7: remember which button opened the picker (the one the click just focused)
  // so a Cancel can hand focus back to it. Captured only when the picker is OPENING.
  function captureTrigger(willOpen: boolean): void {
    pickerTrigger = willOpen && typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
  }
  function selectSlot(slotType: EquipmentSlotType): void {
    const willOpen = selectedSlot !== slotType;
    captureTrigger(willOpen);
    selectedHardpoint = null;
    selectedBay = null;
    selectedSlot = willOpen ? slotType : null;
    installCandidateId = null;
    closeTip(true);
  }
  function selectHardpoint(index: number): void {
    const willOpen = selectedHardpoint !== index;
    captureTrigger(willOpen);
    selectedSlot = null;
    selectedBay = null;
    selectedHardpoint = willOpen ? index : null;
    installCandidateId = null;
    closeTip(true);
  }
  function selectBay(index: number): void {
    const willOpen = selectedBay !== index;
    captureTrigger(willOpen);
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = willOpen ? index : null;
    installCandidateId = null;
    closeTip(true);
  }
  // 0.13.2 Unit 5: choose / clear the spare being compared. selectCandidate drives the
  // current-vs-candidate compare (in place on wide, drill on narrow); clearCandidate is the
  // compare's Back control (returns to the tile list on narrow, clears the compare on wide).
  // Selecting dismisses any pinned info tooltip so it never floats over the compare.
  function selectCandidate(id: string): void {
    installCandidateId = id;
    closeTip(true);
  }
  function clearCandidate(): void {
    installCandidateId = null;
  }

  // The net Battle-Rating delta a spare would produce IF installed at the open target, shown
  // on each tile (e.g. "+68 BR"). Folds the hypothetical gear through the SAME pure readout
  // the compare uses (single source of truth), so a tile's number and the compare's headline
  // always agree. Null when the hull / target does not resolve (no number shown then). This
  // is a cheap per-tile fold (battleRating is a plain scalar composite, no sim), matching the
  // roster's per-row rating cost; no Monte-Carlo forecast runs here.
  function spareNetRating(spare: EquipmentInstance): number | null {
    if (!shipDef || !combatHullType || installTarget === null || compareCurrentBR === null) return null;
    const gear = applyHypotheticalInstall(fittedPieces, spare, installTarget);
    const r = readoutFor(gear, shipDef, combatHullType, shipDef.weaponHardpoints, shipDef.droneBays ?? 0);
    return r.rating - compareCurrentBR;
  }

  // 0.13.2 Unit 4: INFO-toggle for a filled tile. The tile is now a display-only info
  // affordance (the real Swap / Uninstall are separate stable buttons), so clicking /
  // tapping it just opens + pins the floating tooltip for that piece. openTip pins only on
  // a coarse (touch) pointer, so a desktop user keeps hover-preview and a keyboard
  // Enter/Space (which fires this same click) pins like a tap. Locked while damaged, matching
  // every other action on a damaged hull.
  function clickInfo(e: MouseEvent, piece: EquipmentInstance): void {
    if (shipDamaged) return;
    void openTip(piece, e.currentTarget as HTMLElement, true);
  }

  function handleInstall(instanceId: string): void {
    onInstall(shipId, instanceId);
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = null;
    installCandidateId = null;
    // Drop the captured trigger: a commit re-renders the slot into a filled tile, so the old
    // button node is gone and must not be refocused (the Cancel-only restore lives in closePicker).
    pickerTrigger = null;
    closeTip(true);
  }
  function handleUninstall(instanceId: string): void {
    onUninstall(shipId, instanceId);
    closeTip(true);
  }
  function handleRepair(): void {
    onRepair(shipId);
  }

  // 0.13.2 Unit 4: close the install picker (clear all three mutually-exclusive
  // selections + any open info tooltip). Routed to a stable Cancel button in the picker
  // and used when an install completes.
  function closePicker(): void {
    selectedSlot = null;
    selectedHardpoint = null;
    selectedBay = null;
    installCandidateId = null;
    closeTip(true);
    // 0.13.2 Unit 7 (a11y): return focus to the button that opened the flow so a keyboard
    // user is not dropped onto <body>. Guarded on isConnected (belt-and-suspenders: Cancel
    // changes no gear, so the trigger tile is still mounted here).
    if (pickerTrigger && pickerTrigger.isConnected) {
      pickerTrigger.focus();
    }
    pickerTrigger = null;
  }

  // (0.13.2 QA: the earlier scrollPickerIntoView action was removed. The install flow is now a
  // MODAL over a dimmed board, so it is always in view and needs no scroll-into-view hack.)

  // A short label for a spare in the picker list + its info button aria-label. Weapons
  // and drone pods carry no economy "variety" label in EQUIPMENT_SLOTS, so they resolve
  // through the same helpers the readout uses (weaponDisplayName / droneRoleName); every
  // other slot uses its EQUIPMENT_SLOTS display label. The floating tooltip still shows
  // the full identity on hover / tap; this is just the row's at-a-glance name.
  function spareLabel(piece: EquipmentInstance): string {
    if (piece.slotType === "weapon") return weaponName(piece);
    if (piece.slotType === "droneBay") return `${droneRoleName(piece.droneRole)} drone`;
    return EQUIPMENT_SLOTS[piece.slotType]?.label ?? piece.slotType;
  }
</script>

<div class="ss-dialog" class:embedded>
  {#if !ship || !shipDef}
    <!-- Defensive: the target ship vanished (deleted / stale id). Never crash the
         surface; show a recoverable message with a way out. Embedded hides the modal
         title/close (the host Ships tab owns the back control + the vanished-hull guard
         has already flipped to the grid, so this branch is belt-and-suspenders). -->
    <div class="ss-header">
      {#if !embedded}
        <div class="ss-title">SHIP SYSTEMS</div>
        <button class="ss-close" on:click={onClose} aria-label="Close Ship Systems">&#10005;</button>
      {/if}
    </div>
    <p class="ss-empty">This ship is no longer available.</p>
  {:else}
    <!-- HEADER: modal title (dialog only) + hull identity. Embedded, the title + close
         are dropped (the Ships-tab header supplies the back control + cross-perspective
         actions); the identity block carries the board's ship name / class / captain /
         status / Battle Rating. -->
    <header class="ss-header" class:embedded>
      {#if !embedded}
        <div class="ss-title">SHIP SYSTEMS</div>
      {/if}
      <div class="ss-ident">
        <div class="ss-ident-text">
          <!-- Renamable Ships: the ship's DISPLAY name is a click-to-edit title.
               Click it (or tab to it + Enter) to reveal an input; Enter or blur
               saves via onRename, Escape cancels. The hull class shows beneath as a
               subtitle ONLY when a custom name is set, so an un-named ship shows its
               hull label once (as the title) rather than twice. -->
          {#if editingName}
            <input
              class="ss-name-input"
              type="text"
              bind:this={nameInputEl}
              bind:value={nameDraft}
              maxlength={MAX_CAPTAIN_NAME}
              placeholder={shipDef.label}
              aria-label="Ship name"
              on:keydown={onNameKeydown}
              on:blur={commitNameEdit}
            />
          {:else}
            <button
              type="button"
              class="ss-hull-name ss-name-btn"
              on:click={startNameEdit}
              title="Rename this ship"
              aria-label={`Ship name: ${shipDisplayName}. Click to rename.`}
            >{shipDisplayName}</button>
          {/if}
          {#if shipHasCustomName}
            <div class="ss-hull-class">{shipDef.label}</div>
          {/if}
          {#if assignedCaptain}
            <div class="ss-captain-name">{assignedCaptain.label}</div>
            <div class="ss-captain-spec">
              {assignedCaptain.spec ? SPEC_LABEL[assignedCaptain.spec] ?? assignedCaptain.spec : "No specialization"}
              {#if onMission}&middot; on mission (install locked){/if}
            </div>
          {:else}
            <div class="ss-captain-name ss-parked">Unassigned / Parked</div>
          {/if}
          <!-- Embedded board header only: the host-computed status line + the ship's
               advisory Battle Rating, so the loadout board's header carries status + BR
               (the modal showed these only in the readout column). -->
          {#if embedded}
            {#if statusLabel}
              <div class="ss-status-line">{statusLabel}</div>
            {/if}
            {#if battleRatingValue !== null}
              <div class="ss-header-br">Battle Rating <strong>{formatNumber(battleRatingValue)}</strong></div>
            {/if}
          {/if}
        </div>
        <div class="ss-portrait" aria-hidden="true">{assignedCaptain ? "\u{1F9D1}‍\u{1F680}" : "⚓"}</div>
      </div>
      {#if !embedded}
        <button class="ss-close" on:click={onClose} aria-label="Close Ship Systems">&#10005;</button>
      {/if}
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

    <!-- READINESS BANNERS (combat-defense rework, design S5 "inform, don't forbid"): the
         ONLY hard dispatch block is an empty reactor (no power = cannot fly), so a stripped
         reactorCore shows a red blocker. A missing weapon is a non-blocking ADVISORY (the ship
         can dispatch, it just cannot return fire). Missing plating / shields are optional and
         raise no banner (their absence is shown in the Defensive readout). At most one banner
         shows, the reactor block taking precedence over the weapon advisory. -->
    {#if reactorMissing}
      <div class="ss-blocker" role="alert">
        <span class="ss-blocker-dot" aria-hidden="true"></span>
        <span><strong>Cannot dispatch:</strong> no reactor core installed. A reactor powers the ship, so install one before dispatching.</span>
      </div>
    {:else if isCombatHull && noWeaponInstalled}
      <div class="ss-advisory" role="status">
        <span class="ss-advisory-dot" aria-hidden="true"></span>
        <span><strong>No weapon installed:</strong> this ship cannot return fire in combat. You can still dispatch it.</span>
      </div>
    {/if}

    <div class="ss-main" class:embedded>
      <!-- LEFT: the loadout board (0.13.2 Unit 4, Layout C). Function-grouped slots, each
           slot / tile carrying STABLE Install-Swap + Uninstall BUTTONS (never an action in a
           tooltip). Offense is an auto-scaling weapon-tile grid; Defense + Systems are rows;
           Drone Bays (carrier-only) mirror Offense. The spare-pool PICKER opens below when a
           slot's Install / Swap is pressed. Info is a DISPLAY-ONLY floating tooltip on
           hover / tap of a tile (no button lives inside it). -->
      <div class="ss-fit-col">
        <!-- OFFENSE: an auto-scaling weapon-tile grid. One card per hardpoint, filled or
             empty; the grid template is repeat(auto-fill, minmax(...)) so it reflows from
             1 up to many hardpoints without crowding (4-, 7-, 8+-hardpoint hulls all lay
             out cleanly, and the hull identity never gets squeezed). -->
        <div class="ss-group">
          <div class="ss-group-head">
            Offense <span class="ss-group-cap">{mountedWeapons.length} / {hardpointCap} hardpoints</span>
          </div>
          <div class="ss-hp-grid">
            {#each Array.from({ length: hardpointCap }) as _, hpIndex (hpIndex)}
              {@const weapon = mountedWeapons[hpIndex] ?? null}
              <div class="ss-hp" class:sel={selectedHardpoint === hpIndex} class:locked={shipDamaged}>
                <div class="ss-hp-num">HP {hpIndex + 1}</div>
                {#if weapon}
                  <!-- INFO trigger (display-only tooltip): hover previews, tap pins on touch. -->
                  <button
                    type="button"
                    class="ss-hp-info"
                    style="--tc: {equipmentRarityColor(weapon.rarity)}"
                    aria-label={`Weapon on hardpoint ${hpIndex + 1}: ${weaponName(weapon)}, ${weapon.rarity} grade, iL ${weapon.iLevel}. Details.`}
                    on:click={(e) => clickInfo(e, weapon)}
                    on:mouseenter={(e) => hoverTip(weapon, e.currentTarget)}
                    on:mouseleave={hoverOut}
                    on:focus={(e) => hoverTip(weapon, e.currentTarget)}
                    on:blur={hoverOut}
                  >
                    <span class="ss-tile" style="--tc: {equipmentRarityColor(weapon.rarity)}">
                      <span class="ss-tile-dot"></span>
                      <span class="ss-tile-ic">{tileIcon(weapon)}</span>
                      <span class="ss-tile-il">iL {weapon.iLevel}</span>
                    </span>
                    <span class="ss-hp-name">{weaponName(weapon)}</span>
                    <span class="ss-hp-q">{weapon.rarity}</span>
                  </button>
                  <!-- STABLE ACTION BUTTONS (never in the tooltip). Swap opens the picker for
                       THIS hardpoint; Uninstall removes this exact weapon (a MULTI slot, so
                       uninstall is by instance id). Both locked while damaged; Uninstall also
                       locked on-mission (the same lock unfitEquipmentInstance enforces). -->
                  <div class="ss-slot-actions">
                    <button
                      class="ss-act ss-act-swap"
                      disabled={shipDamaged}
                      on:click={() => selectHardpoint(hpIndex)}
                    >Swap</button>
                    <button
                      class="ss-act ss-act-uninstall"
                      disabled={onMission || shipDamaged}
                      title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
                      on:click={() => handleUninstall(weapon.id)}
                    >Uninstall</button>
                  </div>
                {:else}
                  <div class="ss-hp-info ss-hp-empty">
                    <span class="ss-tile ss-tile-empty">
                      <span class="ss-tile-ic">+</span>
                    </span>
                    <span class="ss-hp-name">Empty</span>
                  </div>
                  <div class="ss-slot-actions">
                    <button
                      class="ss-act ss-act-install"
                      disabled={shipDamaged}
                      on:click={() => selectHardpoint(hpIndex)}
                    >Install</button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- DEFENSE: shield emitter + hull plating singletons (combat, all hulls), as rows. -->
        <div class="ss-group">
          <div class="ss-group-head">Defense</div>
          <div class="ss-rows">
            {#each DEFENSE_SLOTS as meta (meta.slotType)}
              {@const fitted = fittedBySlot[meta.slotType]}
              <div class="ss-slot" class:sel={selectedSlot === meta.slotType} class:locked={shipDamaged}>
                {#if fitted}
                  <button
                    type="button"
                    class="ss-slot-info"
                    aria-label={`${meta.label}: ${fitted.rarity} grade, iL ${fitted.iLevel}. Details.`}
                    on:click={(e) => clickInfo(e, fitted)}
                    on:mouseenter={(e) => hoverTip(fitted, e.currentTarget)}
                    on:mouseleave={hoverOut}
                    on:focus={(e) => hoverTip(fitted, e.currentTarget)}
                    on:blur={hoverOut}
                  >
                    <span class="ss-tile" style="--tc: {equipmentRarityColor(fitted.rarity)}">
                      <span class="ss-tile-dot"></span>
                      <span class="ss-tile-ic">{tileIcon(fitted)}</span>
                      <span class="ss-tile-il">iL {fitted.iLevel}</span>
                    </span>
                    <span class="ss-slot-text">
                      <span class="ss-slot-label">{meta.label}</span>
                      <span class="ss-slot-sub">{fitted.rarity} &middot; iL {fitted.iLevel}</span>
                    </span>
                  </button>
                  <div class="ss-slot-actions">
                    <button class="ss-act ss-act-swap" disabled={shipDamaged} on:click={() => selectSlot(meta.slotType)}>Swap</button>
                    <button
                      class="ss-act ss-act-uninstall"
                      disabled={onMission || shipDamaged}
                      title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
                      on:click={() => handleUninstall(fitted.id)}
                    >Uninstall</button>
                  </div>
                {:else}
                  <div class="ss-slot-info ss-slot-info-empty">
                    <span class="ss-tile ss-tile-empty"><span class="ss-tile-ic">+</span></span>
                    <span class="ss-slot-text">
                      <span class="ss-slot-label">{meta.label}</span>
                      <span class="ss-slot-sub">Empty</span>
                    </span>
                  </div>
                  <div class="ss-slot-actions">
                    <button class="ss-act ss-act-install" disabled={shipDamaged} on:click={() => selectSlot(meta.slotType)}>Install</button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- SYSTEMS: the economy singleton slots (never truly empty, an uninstall
             auto-restores an empty slot that is economically identical to its baseline). -->
        <div class="ss-group">
          <div class="ss-group-head">
            Systems <span class="ss-group-cap">{visibleSystemSlots.length} slots</span>
          </div>
          <div class="ss-rows">
            {#each visibleSystemSlots as meta (meta.slotType)}
              {@const fitted = fittedBySlot[meta.slotType]}
              <div class="ss-slot" class:sel={selectedSlot === meta.slotType} class:locked={shipDamaged}>
                {#if fitted}
                  <button
                    type="button"
                    class="ss-slot-info"
                    aria-label={`${meta.label}: ${fitted.rarity} grade, iL ${fitted.iLevel}. Details.`}
                    on:click={(e) => clickInfo(e, fitted)}
                    on:mouseenter={(e) => hoverTip(fitted, e.currentTarget)}
                    on:mouseleave={hoverOut}
                    on:focus={(e) => hoverTip(fitted, e.currentTarget)}
                    on:blur={hoverOut}
                  >
                    <span class="ss-tile" style="--tc: {equipmentRarityColor(fitted.rarity)}">
                      <span class="ss-tile-dot"></span>
                      <span class="ss-tile-ic">{tileIcon(fitted)}</span>
                      <span class="ss-tile-il">iL {fitted.iLevel}</span>
                    </span>
                    <span class="ss-slot-text">
                      <span class="ss-slot-label">{meta.label}</span>
                      <span class="ss-slot-sub">{fitted.rarity} &middot; iL {fitted.iLevel}</span>
                    </span>
                  </button>
                  <div class="ss-slot-actions">
                    <button class="ss-act ss-act-swap" disabled={shipDamaged} on:click={() => selectSlot(meta.slotType)}>Swap</button>
                    <button
                      class="ss-act ss-act-uninstall"
                      disabled={onMission || shipDamaged}
                      title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
                      on:click={() => handleUninstall(fitted.id)}
                    >Uninstall</button>
                  </div>
                {:else}
                  <div class="ss-slot-info ss-slot-info-empty">
                    <span class="ss-tile ss-tile-empty"><span class="ss-tile-ic">+</span></span>
                    <span class="ss-slot-text">
                      <span class="ss-slot-label">{meta.label}</span>
                      <span class="ss-slot-sub">Empty</span>
                    </span>
                  </div>
                  <div class="ss-slot-actions">
                    <button class="ss-act ss-act-install" disabled={shipDamaged} on:click={() => selectSlot(meta.slotType)}>Install</button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- DRONE BAYS: carrier-only (a hangar capacity, not a universal slot). Same
             auto-scaling tile grid as Offense. -->
        {#if hasDroneBays}
          <div class="ss-group">
            <div class="ss-group-head">
              Drone Bays <span class="ss-group-cap">{mountedPods.length} / {droneBayCap} bays</span>
            </div>
            <div class="ss-hp-grid">
              {#each Array.from({ length: droneBayCap }) as _, bayIndex (bayIndex)}
                {@const pod = mountedPods[bayIndex] ?? null}
                <div class="ss-hp" class:sel={selectedBay === bayIndex} class:locked={shipDamaged}>
                  <div class="ss-hp-num">Bay {bayIndex + 1}</div>
                  {#if pod}
                    <button
                      type="button"
                      class="ss-hp-info"
                      style="--tc: {equipmentRarityColor(pod.rarity)}"
                      aria-label={`Drone pod in bay ${bayIndex + 1}: ${droneRoleName(pod.droneRole)}, iL ${pod.iLevel}. Details.`}
                      on:click={(e) => clickInfo(e, pod)}
                      on:mouseenter={(e) => hoverTip(pod, e.currentTarget)}
                      on:mouseleave={hoverOut}
                      on:focus={(e) => hoverTip(pod, e.currentTarget)}
                      on:blur={hoverOut}
                    >
                      <span class="ss-tile" style="--tc: {equipmentRarityColor(pod.rarity)}">
                        <span class="ss-tile-dot"></span>
                        <span class="ss-tile-ic">{tileIcon(pod)}</span>
                        <span class="ss-tile-il">iL {pod.iLevel}</span>
                      </span>
                      <span class="ss-hp-name">{droneRoleName(pod.droneRole)}</span>
                      <span class="ss-hp-q">{pod.rarity}</span>
                    </button>
                    <div class="ss-slot-actions">
                      <button class="ss-act ss-act-swap" disabled={shipDamaged} on:click={() => selectBay(bayIndex)}>Swap</button>
                      <button
                        class="ss-act ss-act-uninstall"
                        disabled={onMission || shipDamaged}
                        title={onMission ? "Recall the captain first, installation is locked on mission" : undefined}
                        on:click={() => handleUninstall(pod.id)}
                      >Uninstall</button>
                    </div>
                  {:else}
                    <div class="ss-hp-info ss-hp-empty">
                      <span class="ss-tile ss-tile-empty"><span class="ss-tile-ic">+</span></span>
                      <span class="ss-hp-name">Empty</span>
                    </div>
                    <div class="ss-slot-actions">
                      <button class="ss-act ss-act-install" disabled={shipDamaged} on:click={() => selectBay(bayIndex)}>Install</button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- INSTALL FLOW (0.13.2 Unit 5): opens when a slot's Install / Swap button is pressed.
             Structure (the user-approved mockup cb4befba):
               1. INSTALLED banner: pins the currently-equipped piece for this slot at the top.
               2. A master-detail area (.ss-flow): a scrollable compatible-spare TILE LIST (each
                  tile shows its net Battle Rating delta) + a current-vs-candidate COMPARISON.
                  ONE responsive component: on a WIDE container the list + compare render side by
                  side and the compare updates in place as a tile is clicked; on a NARROW container
                  the CSS drills (list first, tap a tile -> the compare, Back returns). One shared
                  reactive (installCandidateId) drives both, never duplicated markup, no matchMedia.
               3. Cancel closes the whole flow.
             Every action is a STABLE button: selecting a tile, Back, Install, Cancel. NOTHING lives
             in a tooltip (tiles carry a display-only hover / focus info tooltip). Install routes
             through handleInstall -> onInstall -> fitEquipment, gated per candidate by
             canFitEquipment (disabled + reason when blocked). Damaged / on-mission locks preserved. -->
        {#if pickerActive}
          <!-- Install flow as a MODAL (0.13.2 QA fix): it reveals over a dimmed board (a bottom
               sheet on mobile, a centered popup on desktop, see the .ss-modal-backdrop CSS)
               instead of scroll-jumping to an inline section. Backdrop click (self only), Escape
               (the shared focusTrap action), and the header close button all dismiss it; focus is
               trapped inside while it is open. -->
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions, INTENTIONAL: the backdrop is a presentation dimmer whose only job is click-to-dismiss; keyboard users dismiss with Escape (the focusTrap on the dialog panel below) or the header close button, and every real control lives inside the panel. -->
          <div class="ss-modal-backdrop" on:click|self={closePicker}>
          <div
            class="ss-picker"
            role="dialog"
            aria-modal="true"
            aria-label={`Install ${pickerLabel}`}
            use:focusTrap={closePicker}
          >
            <div class="ss-picker-head">
              <span>Install &middot; {pickerLabel}</span>
              <button class="ss-picker-close" on:click={closePicker} aria-label="Close install">&times;</button>
            </div>
            {#if shipDamaged}
              <p class="ss-note ss-note-dim">Repair the ship before installing new ship systems.</p>
            {:else if pickerSpares.length === 0}
              <p class="ss-note ss-note-dim">No spare {pickerLabel} systems in storage. Fabricate one, or uninstall from another ship.</p>
            {:else}
              <!-- 1. INSTALLED banner: the piece currently in this slot / hardpoint / bay. -->
              <div class="ss-installed">
                <span class="ss-installed-tag">Installed</span>
                {#if installedPiece}
                  <span class="ss-tile" style="--tc: {equipmentRarityColor(installedPiece.rarity)}">
                    <span class="ss-tile-dot"></span>
                    <span class="ss-tile-ic">{tileIcon(installedPiece)}</span>
                    <span class="ss-tile-il">iL {installedPiece.iLevel}</span>
                  </span>
                  <span class="ss-slot-text">
                    <span class="ss-slot-label">{spareLabel(installedPiece)}</span>
                    <span class="ss-slot-sub">{installedPiece.rarity} &middot; iL {installedPiece.iLevel}</span>
                  </span>
                {:else}
                  <span class="ss-tile ss-tile-empty"><span class="ss-tile-ic">+</span></span>
                  <span class="ss-slot-text">
                    <span class="ss-slot-label">Nothing installed</span>
                    <span class="ss-slot-sub">{pickerLabel} slot is empty</span>
                  </span>
                {/if}
              </div>

              <!-- 2. Master-detail: tile list + compare (see .ss-flow container-query CSS). -->
              <div class="ss-flow" class:has-candidate={installCandidateId !== null}>
                <!-- LIST pane: compatible spares as tiles, each with its net BR delta. -->
                <div class="ss-flow-list">
                  <div class="ss-spare-list">
                    {#each pickerSpares as spare (spare.id)}
                      {@const gate = canFitEquipment(safeState, shipId, spare.id)}
                      {@const net = spareNetRating(spare)}
                      <button
                        type="button"
                        class="ss-spare-tile"
                        class:sel={installCandidateId === spare.id}
                        class:blocked={!gate.ok}
                        aria-pressed={installCandidateId === spare.id}
                        aria-label={`${spareLabel(spare)}: ${spare.rarity} grade, iL ${spare.iLevel}.${gate.ok ? "" : " Cannot install: " + reasonText(gate.reason) + "."} Compare.`}
                        on:click={() => selectCandidate(spare.id)}
                        on:mouseenter={(e) => hoverTip(spare, e.currentTarget)}
                        on:mouseleave={hoverOut}
                        on:focus={(e) => hoverTip(spare, e.currentTarget)}
                        on:blur={hoverOut}
                      >
                        <span class="ss-tile" style="--tc: {equipmentRarityColor(spare.rarity)}">
                          <span class="ss-tile-dot"></span>
                          <span class="ss-tile-ic">{tileIcon(spare)}</span>
                          <span class="ss-tile-il">iL {spare.iLevel}</span>
                        </span>
                        <span class="ss-slot-text">
                          <span class="ss-slot-label">{spareLabel(spare)}</span>
                          <span class="ss-slot-sub">{spare.rarity} &middot; iL {spare.iLevel}</span>
                        </span>
                        <span class="ss-spare-net">
                          {#if !gate.ok}
                            <span class="ss-blocked-tag">Blocked</span>
                          {:else if net !== null}
                            <span class="ss-br-delta" class:up={net > 0} class:down={net < 0}>{fmtBRDelta(net)}</span>
                          {/if}
                        </span>
                      </button>
                    {/each}
                  </div>
                </div>

                <!-- COMPARE pane: current (installed) vs the chosen candidate. -->
                <div class="ss-flow-compare">
                  {#if installCandidate}
                    {@const gate = canFitEquipment(safeState, shipId, installCandidate.id)}
                    <div class="ss-compare">
                      <div class="ss-compare-head">
                        <button class="ss-back" on:click={clearCandidate} aria-label="Back to the spare list">&#8592; Back</button>
                        <span class="ss-compare-title">Comparison</span>
                      </div>
                      <!-- Battle Rating headline: current -> candidate (net). -->
                      {#if compareCurrentBR !== null && compareCandidateBR !== null && compareNet !== null}
                        <div class="ss-compare-br">
                          <span class="ss-compare-br-vals">{formatNumber(compareCurrentBR)} &rarr; {formatNumber(compareCandidateBR)}</span>
                          <span class="ss-br-delta" class:up={compareNet > 0} class:down={compareNet < 0}>{fmtBRDelta(compareNet)}</span>
                          <span class="ss-compare-br-tag">Battle Rating</span>
                        </div>
                      {/if}
                      <!-- Per-stat deltas (combat stats for a combat piece, economy stats for an
                           economy piece). Green when the candidate is better, red when worse. -->
                      <div class="ss-compare-rows">
                        {#each compareRows as row (row.label)}
                          <div class="ss-crow">
                            <span class="ss-ck">{row.label}</span>
                            <span class="ss-cv">
                              <span class="ss-cv-old">{row.curText}</span>
                              <span class="ss-cv-arrow">&rarr;</span>
                              <span class="ss-cv-new" class:up={row.good} class:down={row.bad}>{row.candText}</span>
                              {#if row.deltaText}<small class="ss-cv-delta" class:up={row.good} class:down={row.bad}>({row.deltaText})</small>{/if}
                            </span>
                          </div>
                        {/each}
                      </div>
                      <!-- Commit: the stable Install button (never in a tooltip). Gated per
                           candidate; on-mission / damaged locks preserved via the gate + shipDamaged. -->
                      <button
                        class="ss-act ss-act-install ss-install-commit"
                        disabled={!gate.ok || shipDamaged}
                        title={gate.ok ? undefined : reasonText(gate.reason)}
                        on:click={() => handleInstall(installCandidate.id)}
                      >{gate.ok ? "Install" : "Blocked: " + reasonText(gate.reason)}</button>
                    </div>
                  {:else}
                    <p class="ss-note ss-note-dim ss-compare-empty">Select a system to compare it with what is installed.</p>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
          </div>
        {:else}
          <p class="ss-note ss-note-dim ss-picker-hint">Use a slot's Install or Swap button to change its system. Hover a tile for its details.</p>
        {/if}
      </div>

      <!-- RIGHT: the categorized, scrollable stats panel (QA #5). -->
      <div class="ss-stats-col">
        <!-- COMBAT READOUT (combat-defense rework, HYBRID model): split so the hull-vs-gear
             composition is legible. INNATE = the hull's own contribution (its bare frame armor + its
             shield effectiveness ratios); SYSTEMS = the installed gear grouped Offensive / Defensive /
             Support; the DEFENSIVE totals show their composition (hull = frame + plating; shield =
             emitter x effectiveness) so a low or high number reads as hull + gear, never as damage.
             Shown for every hull. -->
        {#if combatReadout}
          <!-- INNATE: the hull's own defense contribution: its bare frame HP (armored even with no
               plating) + how well it fields shields (effectiveness, freely below or above 100%) + its
               hardpoint / drone-bay capacity. -->
          <div class="ss-cat">
            <div class="ss-cat-head">
              <span class="ss-cat-glyph" aria-hidden="true">&#128640;</span> Innate
              <span class="ss-cat-note">the hull itself</span>
            </div>
            <div class="ss-srow"><span class="ss-sk">Hull frame</span><span class="ss-sv">{fmtFlat(combatReadout.innateHullArmor)}</span></div>
            <div class="ss-srow"><span class="ss-sk">Shield Effectiveness</span><span class="ss-sv">{fmtPct(combatReadout.shieldCapEffectiveness)} <small>cap</small></span></div>
            <div class="ss-srow"><span class="ss-sk">Recharge Effectiveness</span><span class="ss-sv">{fmtPct(combatReadout.shieldRechargeEffectiveness)} <small>regen</small></span></div>
            <div class="ss-srow"><span class="ss-sk">Weapon hardpoints</span><span class="ss-sv">{hardpointCap}</span></div>
            <div class="ss-srow"><span class="ss-sk">Drone bays</span><span class="ss-sv">{droneBayCap}</span></div>
          </div>

          <!-- SYSTEMS - OFFENSIVE: the installed weapons + the mounted / cap count + the
               advisory Battle Rating from the same folded loadout. -->
          <div class="ss-cat">
            <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#9876;&#65039;</span> Systems &middot; Offensive</div>
            {#each mountedWeapons as weapon (weapon.id)}
              <div class="ss-srow ss-srow-sub">
                <span class="ss-sk"><span class="ss-fam" style="background: {weaponFamilyColor(weapon.weaponType)}"></span>{weaponName(weapon)}</span>
                <span class="ss-sv ss-sv-dim">{weaponYieldRange(weapon)}</span>
              </div>
            {/each}
            {#if mountedWeapons.length === 0}
              <p class="ss-cat-placeholder">No weapon installed: this ship cannot return fire.</p>
            {/if}
            <div class="ss-srow"><span class="ss-sk">Weapons mounted</span><span class="ss-sv">{mountedWeapons.length} / {hardpointCap}</span></div>
            {#if battleRatingValue !== null}
              <div class="ss-srow"><span class="ss-sk">Battle Rating</span><span class="ss-sv ss-sv-accent">{formatNumber(battleRatingValue)}</span></div>
            {/if}
          </div>

          <!-- SYSTEMS - DEFENSIVE: the composed hull + shield totals. Hull is ADDITIVE (bare frame +
               plating; the frame alone, still nonzero, when no plating is installed). Shield is the
               emitter cap x the hull's shield effectiveness. Each shows its split so the source of the
               number is visible. -->
          <div class="ss-cat">
            <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#128737;&#65039;</span> Systems &middot; Defensive</div>
            <div class="ss-srow">
              <span class="ss-sk">Hull integrity</span>
              <span class="ss-sv">{fmtFlat(combatReadout.hullTotal)} <small>= {fmtFlat(combatReadout.innateHullArmor)} frame{#if combatReadout.platingHullStrength > 0} + {fmtFlat(combatReadout.platingHullStrength)} plating{/if}</small></span>
            </div>
            {#if combatReadout.shieldEmitter}
              <div class="ss-srow">
                <span class="ss-sk">Shield capacity</span>
                <span class="ss-sv">{fmtFlat(combatReadout.shieldTotal)} <small>= {fmtFlat(combatReadout.emitterCap)} installed &times; {fmtPct(combatReadout.shieldCapEffectiveness)}</small></span>
              </div>
              <div class="ss-srow">
                <span class="ss-sk">Shield recharge</span>
                <span class="ss-sv">{fmtFlat(combatReadout.rechargeTotal)} / s <small>= {fmtFlat(combatReadout.emitterRecharge)} installed &times; {fmtPct(combatReadout.shieldRechargeEffectiveness)}</small></span>
              </div>
            {:else}
              <div class="ss-srow"><span class="ss-sk">Shield capacity</span><span class="ss-sv ss-sv-dim">none &middot; no emitter installed</span></div>
            {/if}
            {#if combatReadout.ablativeArmor > 0}
              <div class="ss-srow"><span class="ss-sk">Ablative armor</span><span class="ss-sv">{fmtFlat(combatReadout.ablativeArmor)}</span></div>
            {/if}
          </div>

          <!-- SYSTEMS - SUPPORT: the installed drone pods (carrier-only). A hull with no
               bays shows a "no drone bays" empty state rather than an empty group. -->
          <div class="ss-cat">
            <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#128752;&#65039;</span> Systems &middot; Support</div>
            {#if hasDroneBays}
              <div class="ss-srow"><span class="ss-sk">Drone bays used</span><span class="ss-sv">{mountedPods.length} / {droneBayCap}</span></div>
              {#each mountedPods as pod (pod.id)}
                <div class="ss-srow ss-srow-sub">
                  <span class="ss-sk"><span class="ss-fam" style="background: {droneRoleColor(pod.droneRole)}"></span>{droneRoleName(pod.droneRole)}</span>
                  <span class="ss-sv ss-sv-dim">iL {pod.iLevel}</span>
                </div>
              {/each}
              {#if mountedPods.length === 0}
                <p class="ss-cat-placeholder">No drone pods installed.</p>
              {/if}
            {:else}
              <p class="ss-cat-placeholder">No drone bays on this hull: support systems unavailable.</p>
            {/if}
          </div>
        {/if}

        <!-- EXPLORATION / PROSPECTING: the economy stats (extraction, cargo, FTL, fuel,
             power, mass), each with its base -> installed gear delta preserved. -->
        <div class="ss-cat">
          <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#9935;</span> Exploration / Prospecting</div>
          {#each liveStatRows as row (row.label)}
            {@const delta = fmtDelta(row)}
            <div class="ss-srow">
              <span class="ss-sk">{row.label}</span>
              <span class="ss-sv">{fmtStatValue(row)}{#if delta}<small> ({delta})</small>{/if}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- FLOATING TOOLTIP (0.13.2 Unit 4: DISPLAY-ONLY): one JS-positioned wrapper around the
       reusable EquipmentTooltip, clamped inside the viewport (see positionTip). It carries
       NO action button anymore. Install / Uninstall / Swap are stable buttons on the slots
       above; EquipmentTooltip renders its action footer only when a host passes slot content,
       so passing NONE here leaves it purely informational. This is the display-only-tooltips
       principle (design S1): actions never live in a hover / float surface. EquipmentTooltip's
       internals stay preserved (the only branch edit was the df53dd5 blueprint name resolver). -->
  {#if activeTip}
    {@const tipPiece = activeTip.piece}
    <div
      class="ss-tip-float"
      bind:this={tipEl}
      role="tooltip"
      style="left: {tipLeft}px; top: {tipTop}px; visibility: {tipVisible ? 'visible' : 'hidden'}"
      on:pointerenter={cancelTipHide}
      on:pointerleave={scheduleTipHide}
    >
      <EquipmentTooltip piece={tipPiece} />
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
  /* EMBEDDED (0.13.2 Unit 4): the board is the full-width ship-detail surface inside the
     Ships tab's .tab-scroll-area, NOT a modal card. Drop the modal width cap + the hard
     max-height + the drop shadow (the host region owns the page scroll). Keep the accented
     border + full-surface tint so it still reads as the game's paneled surface. */
  .ss-dialog.embedded {
    width: 100%;
    max-height: none;
    box-shadow: none;
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
  /* Embedded header: no modal title pushing the identity right, so left-align the
     identity block and let the portrait sit beside it. */
  .ss-header.embedded {
    align-items: center;
  }
  .ss-header.embedded .ss-ident {
    flex: 1;
    gap: 12px;
  }
  .ss-header.embedded .ss-ident-text {
    text-align: left;
  }
  .ss-header.embedded .ss-name-btn,
  .ss-header.embedded .ss-name-input {
    text-align: left;
  }
  /* Status line + Battle Rating in the embedded board header. */
  .ss-status-line {
    font-size: 10px;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .ss-header-br {
    font-size: 10px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 1px;
  }
  .ss-header-br strong {
    color: var(--color-accent-bright);
    font-family: var(--font-mono);
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
  /* Renamable Ships: the title doubles as a click-to-edit control. Styled as bare
     text (no button chrome) so it reads as a heading, with a subtle affordance on
     hover / focus. Right-aligned to match the ss-ident-text column. */
  .ss-name-btn {
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    cursor: pointer;
    text-align: right;
    border-radius: 3px;
    transition: color 0.12s ease, background 0.12s ease;
  }
  .ss-name-btn:hover {
    color: var(--color-accent-bright);
  }
  .ss-name-btn:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 2px;
  }
  /* The inline rename input, sized to sit in place of the title text. */
  .ss-name-input {
    font-family: var(--font-body, inherit);
    font-size: 12px;
    color: var(--color-text-primary);
    background: var(--color-bg-inset, rgba(0, 0, 0, 0.25));
    border: 1px solid var(--color-accent);
    border-radius: 3px;
    padding: 2px 6px;
    text-align: right;
    letter-spacing: 0.5px;
    width: 15ch;
    max-width: 100%;
  }
  .ss-name-input:focus {
    outline: none;
    border-color: var(--color-accent-bright);
  }
  /* The hull-class subtitle shown beneath a CUSTOM name (so a renamed ship still
     states what hull it is). Matches the dim, small treatment of the captain spec. */
  .ss-hull-class {
    font-size: 10px;
    color: var(--color-text-secondary);
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

  /* WEAPON ADVISORY BANNER (design S5 "inform, don't forbid"): an amber, non-blocking
     note. Distinct from the red .ss-blocker so a player reads "you can still dispatch,
     but you cannot return fire", not "you are blocked". */
  .ss-advisory {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 14px 0;
    padding: 9px 12px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.45);
    color: var(--color-warning);
    font-size: 12px;
    line-height: 1.4;
    flex-shrink: 0;
  }
  .ss-advisory-dot {
    flex: 0 0 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-warning);
  }
  .ss-advisory strong {
    color: var(--color-warning);
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
  /* EMBEDDED (0.13.2 Unit 4): the host .tab-scroll-area is the ONE scroll region, so the
     two columns must NOT scroll independently here (that would trap content in a nested
     scroller inside the page). Let them flow at their natural height and hand all overflow
     to the page. The 720px stacking rule above still applies on phones. */
  .ss-main.embedded {
    overflow: visible;
  }
  .ss-main.embedded .ss-fit-col,
  .ss-main.embedded .ss-stats-col {
    overflow: visible;
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
  /* ONE ICON TILE: rarity-colored top border + corner dot (--tc), variety glyph, iL
     badge. Mirrors App.svelte's .systems-tile (the Warehouse bay) so the two read alike.
     0.13.2 Unit 4: this is now a NON-interactive <span> (the visual only); the interactive
     info affordance is the wrapping .ss-hp-info / .ss-slot-info button, and the real actions
     are the stable .ss-act buttons. So no cursor / hover / focus states live on the tile. */
  .ss-tile {
    position: relative;
    box-sizing: border-box;
    flex: 0 0 auto;
    width: 52px;
    height: 52px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
    border-top: 3px solid var(--tc, var(--color-border));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 4px;
    font-family: var(--font-body);
  }
  .ss-tile-dot {
    position: absolute;
    top: 4px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tc, var(--color-text-dim));
  }
  .ss-tile-ic {
    font-size: 22px;
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
    font-size: 20px;
    color: var(--color-text-dim);
  }

  /* OFFENSE / DRONE-BAY auto-scaling tile grid. repeat(auto-fill, minmax(...)) reflows the
     hardpoint cards from one column up to as many as fit, so a 4-, 7- or 8+-hardpoint hull
     all lay out without crowding and the hull identity never gets squeezed. */
  .ss-hp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 8px;
  }
  /* ONE HARDPOINT / DRONE-BAY CARD: numbered header, the tile visual + name + quality, then
     the stable action buttons. Full-surface accent tint (never a left-edge stripe). */
  .ss-hp {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 8px 6px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
  }
  .ss-hp.sel {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
  }
  .ss-hp.locked {
    opacity: 0.45;
  }
  .ss-hp-num {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  /* The display-only INFO trigger (hover / tap for the floating tooltip). Bare button
     chrome so it reads as the tile, with a subtle hover / focus affordance. */
  .ss-hp-info,
  .ss-slot-info {
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: 3px;
  }
  .ss-hp-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
  }
  .ss-hp-info:hover,
  .ss-hp-info:focus-visible,
  .ss-slot-info:hover,
  .ss-slot-info:focus-visible {
    outline: none;
    color: var(--color-accent-bright);
  }
  .ss-hp-info:focus-visible,
  .ss-slot-info:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 2px;
  }
  .ss-hp-name {
    font-size: 10px;
    color: var(--color-text-primary);
    text-align: center;
    line-height: 1.2;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ss-hp-q {
    font-size: 9px;
    text-transform: capitalize;
    color: var(--color-text-secondary);
  }
  .ss-hp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    color: var(--color-text-dim);
  }

  /* DEFENSE / SYSTEMS ROWS: tile + label/quality on the left, stable buttons on the right. */
  .ss-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ss-slot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 9px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
  }
  .ss-slot.sel {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
  }
  .ss-slot.locked {
    opacity: 0.45;
  }
  .ss-slot-info,
  .ss-slot-info-empty {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .ss-slot-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .ss-slot-label {
    font-size: 12px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ss-slot-sub {
    font-size: 10px;
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }
  .ss-slot-info-empty {
    color: var(--color-text-dim);
  }
  .ss-slot-info-empty .ss-slot-sub {
    color: var(--color-text-dim);
  }

  /* STABLE ACTION BUTTONS (Install / Swap / Uninstall) on every slot + in the picker. The
     display-only-tooltips principle: actions are ALWAYS visible buttons, never in a float. */
  .ss-slot-actions {
    display: flex;
    gap: 6px;
    flex: 0 0 auto;
  }
  /* Bug fix (0.13.2 QA): a weapon / drone-bay TILE is narrow in the multi-column grid
     (minmax 110px), so a side-by-side Swap + Uninstall overflowed the tile (worst at 2+
     hardpoints, when the grid splits into columns). Inside a tile ONLY, stack the actions
     vertically and fill the tile width so they always fit. The full-width Defense / Systems
     ROWS keep the horizontal .ss-slot-actions (they have room). */
  .ss-hp .ss-slot-actions {
    flex-direction: column;
    align-self: stretch;
    width: 100%;
    gap: 5px;
  }
  .ss-hp .ss-act {
    width: 100%;
    text-align: center;
  }
  .ss-act {
    flex: 0 0 auto;
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
    background: rgba(var(--color-accent-rgb), 0.12);
    border: 1px solid rgba(var(--color-accent-rgb), 0.5);
    color: var(--color-accent-bright);
    white-space: nowrap;
  }
  .ss-act:hover:not(:disabled) {
    background: rgba(var(--color-accent-rgb), 0.22);
  }
  .ss-act:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ss-act-uninstall {
    color: var(--color-danger);
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.1);
  }
  .ss-act-uninstall:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
  }

  /* INSTALL FLOW (0.13.2 Unit 5): a dashed panel holding the INSTALLED banner, the
     master-detail area (spare tile list + compare), and the Cancel control. It is the
     CONTAINER whose width the .ss-flow container query keys off, so the master-detail
     decision responds to the panel's OWN width (not the viewport): the left fit-col is only
     ~half the board on desktop, so a viewport media query would wrongly go side-by-side while
     the actual space is narrow. container-type: inline-size makes the query measure this box. */
  /* INSTALL MODAL (0.13.2 QA fix): the install flow reveals as a popup over a dimmed board
     instead of an inline scroll-to section. MOBILE (default) = a bottom sheet (thumb-reachable,
     slides up); DESKTOP (>= 700px) = a centered popup. The panel KEEPS container-type:inline-size
     so the master-detail flow's own container query still drives list-vs-side-by-side off the
     PANEL width (the mobile sheet is narrow -> drill list/compare; the desktop popup is wider ->
     side by side). position:fixed escapes the panel's scroll ancestor (verified: no transformed
     ancestor in the chain) to cover the viewport. */
  .ss-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: flex-end; /* mobile: sheet anchored to the bottom */
    justify-content: center;
    background: rgba(4, 6, 10, 0.66);
  }
  .ss-picker {
    width: 100%;
    max-height: 88vh;
    overflow-y: auto;
    padding: 12px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: 16px 16px 0 0; /* rounded top edge for the sheet */
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.6);
    container-type: inline-size;
  }
  @media (min-width: 700px) {
    .ss-modal-backdrop {
      align-items: center;
      padding: 24px;
    }
    .ss-picker {
      max-width: 540px;
      max-height: 85vh;
      border-radius: 14px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
    }
  }
  .ss-picker-head {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Sticky so the title + close X stay reachable while the modal body scrolls. */
    position: sticky;
    top: -12px; /* cancel the panel's 12px top padding so it pins flush to the panel top */
    background: var(--color-bg-mid);
    padding: 12px 0 9px;
    margin: -12px 0 9px;
    z-index: 1;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .ss-picker-close {
    margin-left: auto;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    color: var(--color-text-secondary);
    border-radius: 7px;
  }
  .ss-picker-close:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  /* INSTALLED BANNER (0.13.2 Unit 5): pins the currently-equipped piece at the top of the
     flow. Full-surface accent tint (never a left-edge stripe), tile + label like a slot row. */
  .ss-installed {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 9px;
    margin-bottom: 10px;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
  }
  .ss-installed-tag {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    align-self: flex-start;
  }

  /* MASTER-DETAIL FLOW. DEFAULT (and the container-query fallback when unsupported): a
     single column with BOTH panes visible. The narrow container query below turns it into a
     DRILL (list first, then the compare); the wide container query lays them side by side. */
  .ss-flow {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ss-flow-list,
  .ss-flow-compare {
    min-width: 0;
  }
  /* NARROW container (the phone / cramped-column case): drill. Show the list until a spare is
     chosen, then swap to the compare (Back returns). One shared reactive (has-candidate) gates
     which pane shows, so there is no matchMedia fork and no duplicated markup. */
  @container (max-width: 439px) {
    .ss-flow:not(.has-candidate) .ss-flow-compare {
      display: none;
    }
    .ss-flow.has-candidate .ss-flow-list {
      display: none;
    }
  }
  /* WIDE container (desktop / roomy board): list + compare side by side, both always present;
     clicking a tile updates the compare IN PLACE. The list takes a fixed-ish left column, the
     compare flexes to fill the rest. */
  @container (min-width: 440px) {
    .ss-flow {
      flex-direction: row;
      align-items: flex-start;
    }
    .ss-flow-list {
      flex: 0 0 44%;
    }
    .ss-flow-compare {
      flex: 1;
    }
  }

  /* Scrollable compatible-spare list: each entry is a stable SELECT button (tile + net BR). */
  .ss-spare-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    max-height: 300px;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .ss-spare-list::-webkit-scrollbar {
    display: none;
  }
  /* One spare TILE row: a stable button (click selects it for the compare). Bare-button chrome
     so it reads as a row, with a hover / focus / selected affordance. NOT an action-in-tooltip:
     the tooltip on hover is display-only; this button's action is SELECT (open the compare). */
  .ss-spare-tile {
    appearance: none;
    font: inherit;
    color: inherit;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid var(--color-border);
    cursor: pointer;
    width: 100%;
  }
  .ss-spare-tile:hover:not(.blocked),
  .ss-spare-tile:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.1);
  }
  .ss-spare-tile:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 1px;
  }
  .ss-spare-tile.sel {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
  }
  /* A blocked spare (canFitEquipment not ok): dimmed, but still clickable so the compare can
     explain WHY (the Install button there shows the reason). */
  .ss-spare-tile.blocked {
    opacity: 0.6;
  }
  .ss-spare-net {
    margin-left: auto;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }
  /* Net Battle-Rating delta chip: green when installing raises BR, red when it lowers it,
     neutral at zero. Reused for the tile chips AND the compare headline. */
  .ss-br-delta {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .ss-br-delta.up {
    color: var(--color-success);
  }
  .ss-br-delta.down {
    color: var(--color-danger);
  }
  .ss-blocked-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-danger);
    white-space: nowrap;
  }

  /* COMPARE PANE: current-vs-candidate. Full-surface accent tint, its own inset card. */
  .ss-compare {
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid var(--color-border);
    padding: 9px 10px;
  }
  .ss-compare-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .ss-compare-title {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-left: auto;
  }
  .ss-back {
    appearance: none;
    font: inherit;
    font-size: 11px;
    padding: 3px 9px;
    cursor: pointer;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    color: var(--color-text-secondary);
  }
  .ss-back:hover,
  .ss-back:focus-visible {
    outline: none;
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  /* Battle Rating headline: the current -> candidate values + the net delta chip. */
  .ss-compare-br {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 7px 9px;
    margin-bottom: 8px;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
  }
  .ss-compare-br-vals {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--color-text-primary);
  }
  .ss-compare-br-tag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .ss-compare-rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 10px;
  }
  .ss-crow {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    font-size: 12px;
    padding: 2px 0;
  }
  .ss-ck {
    color: var(--color-text-secondary);
    min-width: 0;
  }
  .ss-cv {
    font-family: var(--font-mono);
    text-align: right;
    white-space: nowrap;
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .ss-cv-old {
    color: var(--color-text-dim);
  }
  .ss-cv-arrow {
    color: var(--color-text-dim);
  }
  .ss-cv-new {
    color: var(--color-text-primary);
  }
  .ss-cv-new.up,
  .ss-cv-delta.up {
    color: var(--color-success);
  }
  .ss-cv-new.down,
  .ss-cv-delta.down {
    color: var(--color-danger);
  }
  .ss-cv-delta {
    font-size: 10px;
  }
  /* The compare's commit button: full-width so it reads as the primary action of the pane. */
  .ss-install-commit {
    width: 100%;
    padding: 8px 10px;
    font-size: 12px;
  }
  .ss-compare-empty {
    text-align: center;
    padding: 16px 8px;
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
  /* Small dim subtitle after a category name (e.g. Innate "the hull itself"). */
  .ss-cat-note {
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

  /* FLOATING TOOLTIP WRAPPER: position:fixed so it escapes the panel's inner scroll
     clipping; JS sets left/top (viewport-clamped) + toggles visibility. High z-index
     so it sits above the surface.

     CLAMP DEPENDENCY (do not break): positionTip() computes left/top in VIEWPORT
     coordinates and this element is position:fixed, so the two only coincide while the
     nearest fixed-positioning containing block is the viewport itself.
       - MODAL mode: the host .modal-backdrop (App.svelte) is that containing block: its
         backdrop-filter makes it the containing block for position:fixed descendants, and
         it is a full-viewport, origin (0,0), unbordered, untransformed fixed element
         (position:fixed; inset:0), so its padding box top-left sits exactly at viewport (0,0).
       - EMBEDDED mode (0.13.2 Unit 4): there is NO .modal-backdrop; the board renders inline
         in the Ships tab. None of its ancestors (.root / .frame / .tab-body / .tab-scroll-area)
         establishes a fixed-positioning containing block (no transform / filter / perspective /
         will-change / contain on any of them, verified 2026-09-01), so this fixed element
         resolves against the viewport DIRECTLY, at origin (0,0). Same coordinate space, so the
         clamp math is unchanged. If any of those ancestors ever gains a transform / filter /
         etc (or .modal-backdrop gains a border / transform / stops covering the viewport in the
         modal case), this tooltip's placement math goes wrong and must be revisited.

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
