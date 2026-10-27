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
  import ActionModal from "./ActionModal.svelte";
  import type {
    GameState,
    EquipmentInstance,
    EquipmentSlotType,
    ShipDerivedStats,
  } from "./game/model";
  import { BLUEPRINTS, SHIP_TYPES, EQUIPMENT_SLOTS, shipDerivedStats, isSparePiece, pieceVarietyDef, shipDisplayLabel, outboundLegSpeed, returnLegSpeed, guestQuartersShown } from "./game/model";
  import { LY_PER_TICK } from "./game/fuel";
  // WR-4 (OC-C1): the Fuel Depot's fleet reach, so the Range row matches the dispatch gates (tick.ts shipReachDef).
  import { fleetReachBonus } from "./game/tick";
  // Renamable Ships: the shared name-length ceiling, so this panel's rename input
  // is capped at EXACTLY the same limit renameShip (the pure seam) enforces. One
  // source of truth for the number, no drift between the input's maxlength and the
  // validation the save runs.
  import { MAX_CAPTAIN_NAME } from "./game/captainName";
  import type { EquipFitRefusal, EquipFitVerdict } from "./game/equipment";
  // E-MOD EM-2: the power gate's refusal wording and the over-budget warning (P2: never evict, a warning chip).
  import { overBudgetNotice, overPowerReasonText, shipPowerBudget, type ShipPowerBudget } from "./game/shipPower";
  import { POWER_SUPPLY_FLOOR_PERCENT } from "./game/combat/power";
  import { duplicateModuleReasonText, hullHasSpecUtilitySlot, moduleArmoryOnlyReasonText, moduleSlotsFullReasonText, pieceModuleDef } from "./game/shipModules";
  // E-MOD EM-10: the Power bar and the Modules row (the signed-off mockup, section C), as pure view models, and the
  // module card lines the install compare shows. Icon draws the SVG glyphs (icons.ts), never an emoji.
  import {
    activeModuleSetLines,
    drawReductionTotal,
    driveDrawText,
    moduleCompareKeepsRow,
    pointsDeltaText,
    moduleRowTiles,
    moduleTileCategory,
    moduleTileDrawText,
    pieceConditionPercent,
    piecePowerDraw,
    powerBarView,
  } from "./ui/powerBarDisplay";
  import { pieceModuleLines } from "./ui/moduleEffectText";
  import Icon from "./ui/Icon.svelte";
  // The Help topic the Power bar links to (helpTopics.ts; powerBarDisplay.test.ts holds the id to a real topic).
  const POWER_HELP_TOPIC_ID = "powerAndModules";
  import { equippedFor, fittedInSlot, canFitEquipment } from "./game/equipment";
  // S2 (user 2026-10-17 "Lock it"): the one crew lock names why a ship's gear is locked (a mission, a patrol, a
  // short-range run, or an expedition until it is claimed), the same lock the engine's install gate reads.
  import { crewLockReason, shipGearLockHint, shipGearLockReasonText } from "./game/crewLock";
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
  // The SAME reusable rarity-bordered card the Warehouse Ship Systems bay uses, plus
  // its module-exported single-source helpers (rarity color + variety glyph). Reused
  // here so a tile + its tooltip read the piece's identity in EXACTLY the format the
  // bay does, one card component, no second renderer to drift. The Install / Uninstall
  // control is injected into the card's footer <slot>. EquipmentTooltip was extended on
  // this branch (commit df53dd5) for weapon/drone blueprint name resolution and is
  // otherwise preserved.
  import EquipmentTooltip, { equipmentRarityColor, equipmentIcon, equipmentSvgIcon } from "./EquipmentTooltip.svelte";
  // Shared PURE viewport-clamp math for the floating tooltip (prefer-above / flip-below
  // / clamp). Extracted so this panel and the Combat View pip tooltips share ONE clamp
  // implementation; the measure + await-tick + reflow flow below stays local.
  import { clampFloatingTip } from "./floatingTip";
  // 0.14.0 crew C-4c: the crew -> ship-stat overlay. effectiveShipStats is the SAME crew-boosted
  // fold every engine consumer routes through (so the readout shows Senior Staff + Complement
  // boosts); shipCrewContribution + applyCrewOverlay let the source popover split the crew delta by
  // source using the EXACT engine functions (never a reimplementation of the fold). READ-ONLY here.
  import {
    effectiveShipStats,
    shipCrewContribution,
    applyCrewOverlay,
    shipStatsBeforeCaptain,
    crewMissionOutputBonus,
    crewRepairSpeedBonus,
    shipMissionOutputBonus,
    shipRepairSpeedBonus,
    gearSheetWithReactorDrive,
    shipReactorSurplus,
  } from "./game/crewOverlay";
  import { reactorSurplusSpeedLift } from "./game/reactorSurplus";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here); `shipId` selects the ship
  // this panel installs systems on. The callbacks route every side-effect back to the host
  // so persistence + logging happen exactly once, in App.svelte.
  export let state: GameState;
  export let shipId: string;
  // 0.13.9: the optional third argument names the installed weapon / drone pod a Swap replaces
  // (a targeted swap on a MULTI slot); the host passes it to fitEquipment.
  export let onInstall: (shipId: string, instanceId: string, replacingInstanceId?: string) => void;
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
  // 0.13.6: when a checked-out Armory loadout drives this ship, its install screen is READ-ONLY
  // (edit the set in the Armory instead). The host passes whether a loadout is checked out here +
  // its name for the banner. The engine also refuses committed-piece uninstalls (defense in depth),
  // but this locks the controls so the player is not left mashing a button that only logs a refusal.
  export let loadoutLocked = false;
  export let loadoutName = "";
  // E-MOD EM-10 review: opens a Help topic (the Power bar links to "Power and modules"). The host owns the Help center
  // (App.svelte openHelpTopic); without a host handler the link is not drawn.
  export let onOpenHelp: ((topicId: string) => void) | undefined = undefined;

  // --- Slot metadata ----------------------------------------------------------
  // The installable SINGLETON slots, grouped by function to match the mockup. Each
  // slot holds at most one piece (install replaces, uninstall leaves it bare for a
  // combat slot or auto-restores a Standard-Issue baseline for an economy slot).
  //   specUtility exists only on SPECIALIZED hulls (design: the Freighter has no Spec Utility
  //   slot; see hasSpecUtilitySlot). E-MOD EM-10: it is listed here for the per-slot map and the
  //   compare, but DRAWN as the first tile of the Modules row (it shares the module slots).
  type SlotMeta = { slotType: EquipmentSlotType; label: string };
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
    { slotType: "specUtility", label: "Spec Utility" },
    // The scanning array (0.14.0). The sensor slot has existed on EVERY hull since the sensor
    // foundation (an allow-empty catalog singleton), and the Expedition console tells players to
    // "Install a sensor array (Ships tab)", but this tile was never added, so a crafted array
    // (first craftable: the Bio-Resonance Array) had no way to be installed. Label matches the
    // engine's EQUIPMENT_SLOTS.sensor.label.
    { slotType: "sensor", label: "Sensor Array" },
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
  // 0.14.0 crew C-4c: the stat readout's floating POPOVER. ONE element, two modes:
  //   "info"   -> the stat's plain-language definition (the (i) affordance)
  //   "source" -> the stat's SOURCE buckets (tapping the VALUE)
  // A POPOVER floating over the rows, never an inline accordion (explicit user correction). It is
  // click/tap-toggled (works the same on desktop hover devices + touch), and opening one closes the
  // tile tooltip + any other stat popover (one floater at a time). Positioned with the SAME
  // clampFloatingTip recipe + containing-block dependency as .ss-tip-float, so it stays inside the
  // viewport on mobile. Purely informational: it carries no interactive controls.
  let statPop: { key: string; mode: "info" | "source"; el: HTMLElement } | null = null;
  let statPopEl: HTMLDivElement | undefined;
  let statPopLeft = 0;
  let statPopTop = 0;
  let statPopVisible = false;
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
    // 0.14.0 crew C-4c: drop any open stat popover so it never carries onto the newly-shown ship.
    statPop = null;
    statPopVisible = false;
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
  // E4d: every specialized hull (prospector / tactician / explorer) shows the Spec Utility slot.
  // EM-7 review: the one predicate the install gate's shared module slots and the Armory read (shipModules.ts).
  $: hasSpecUtilitySlot = shipDef !== null && shipDef !== undefined && hullHasSpecUtilitySlot(shipDef.spec);
  // S2: the gear lock (crewLock.ts crewLockReason, null when the ship is home). `onMission` keeps its old name for the
  // controls it disables; it is true for every way the ship can be out, an expedition included.
  $: gearLock = ship ? crewLockReason(state, ship.id) : null;
  $: onMission = gearLock !== null;
  $: gearLockHint = gearLock === null ? undefined : shipGearLockHint(gearLock);

  // --- Ship name (Renamable Ships) --------------------------------------------
  // The header title is the ship's DISPLAY name: its custom `name` if set, else the
  // hull-type label (e.g. "General Freighter"). `shipHasCustomName` gates the hull-
  // class SUBTITLE so an UN-named ship does not show its hull label twice (title +
  // subtitle): a renamed ship shows name-over-class, an un-named ship shows just
  // the class as the title. 0.13.9: the shared shipDisplayLabel, so an unnamed hull that
  // shares its class with another reads "General Freighter #2", matching every list.
  $: shipDisplayName = ship ? shipDisplayLabel(state, ship) : "";
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
  // slot exists on every SPECIALIZED hull (prospector rigs; since E4d also the tactician
  // Damage Control Suite and the explorer Pathfinder Suite) and is dropped only on the
  // general Freighter (design: the Freighter has no Spec Utility slot). The Defense
  // singletons and the weapon strip show on every hull (all hulls are combat-capable now).
  // E-MOD EM-10 (the signed-off mockup's pick "spec utility as a tile in the Modules row"): the Spec Utility shares the
  // hull's module slots (user M1), so it is drawn as the first tile of the Modules row, never in this list.
  $: visibleSystemSlots = SYSTEM_SLOTS.filter((s) => s.slotType !== "specUtility");

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
  // 0.14.0 crew C-4c: the CREW-INCLUSIVE fitted stats (Senior Staff + Complement folded on top of the
  // gear fold) the readout DISPLAYS as the current value. This is the SAME effectiveShipStats every
  // engine consumer reads, so the number the player sees matches what the ship actually does.
  // ⚠️ fitStats above stays GEAR-ONLY on purpose: the install candidate COMPARE (compareRows) diffs
  // gear loadouts off fitStats, and installing a system changes GEAR, not crew, so the compare must
  // never fold crew in (that would double-count it). Only this readout display becomes crew-inclusive.
  $: effectiveStats = ship ? effectiveShipStats(safeState, ship) : null;
  // E-MOD EM-4: the same sheet without the reactor surplus drive lift (layered last), so the FTL Speed source split
  // shows the lift as its own "Reactor surplus" bucket and the Captain bucket stops before it.
  $: preLiftStats = ship ? effectiveShipStats(safeState, ship, { reactorLift: false }) : null;
  // E-MOD EM-4 review: the gear-only sheet WITH the Reactor Core's drive rule (crewOverlay.ts
  // gearSheetWithReactorDrive), which the install compare and the readout's gear note read, so a crafted core never
  // shows as slower than the Standard-Issue one there (the user's "Never slower"). fitStats stays the raw gear fold
  // the source buckets are built on.
  $: fitDriveStats = ship ? gearSheetWithReactorDrive(ship, fittedPieces) : null;
  // Whether the never-slower floor is what sets this ship's speed (the lift alone would leave it slower): the
  // source popover then names the bucket for the floor, not for surplus.
  $: reactorFloorBinds =
    ship && preLiftStats && effectiveStats
      ? effectiveStats.transitSpeedMult > preLiftStats.transitSpeedMult * reactorSurplusSpeedLift(shipReactorSurplus(safeState, ship)) * (1 + 1e-12)
      : false;
  // The crew delta split by SOURCE, folded through the EXACT engine functions (shipCrewContribution +
  // applyCrewOverlay) the live fold uses, so a source bucket can never drift from the shown value.
  // Complement = the complement folded ALONE (no officers) off the gear baseline; Senior Staff = everything
  // the officers add ON TOP of it (crewOnlyStats - complementOnlyStats): their bonuses, racials and lifts,
  // any bridge-module amp, and (E-CREW Task 21) the Strength facet's lift of the complement's buffs. The two
  // buckets therefore always sum to the crew total, even where an officer MULTIPLIES the complement (an
  // honest coarse grouping, not a faked per-source split the exported functions do not expose).
  // WR-5c: the crew-side buckets read the save with the commanding captain's secondary nodes set aside, so Inspiring
  // Leader, Mentor and Legendary Captain (which scale the complement and the officers inside the crew map) land in
  // the Captain bucket with the captain's other nodes, not in Complement or Senior Staff. The buckets still sum to the
  // shown value (Captain = effective - preCaptainStats, both off this one baseline). Without a node it is safeState.
  $: noCaptainNodesState =
    ship && ship.assignedCaptainId !== null
      ? {
          ...safeState,
          captains: safeState.captains.map((c) =>
            c.id === ship.assignedCaptainId && c.unlockedSecondaryTalents.length > 0 ? { ...c, unlockedSecondaryTalents: [] } : c,
          ),
        }
      : safeState;
  $: complementOnlyStats =
    ship && fitStats ? applyCrewOverlay(fitStats, shipCrewContribution({ ...noCaptainNodesState, officers: [] }, ship)) : null;
  // 0.14.0 E4b: the crew-inclusive stats WITHOUT the museum overlay (both crew sources folded, exactly the
  // value effectiveShipStats overlays the museum onto). The MUSEUM bucket is effective - this, so the
  // source buckets still sum to the shown value once the museum's ship-stat bonuses apply. (The museum's
  // crewBonuses amplification lives INSIDE the crew contribution, so it already shows in the Senior Staff
  // + Complement buckets above.) With an empty museum this equals effectiveStats and the bucket hides.
  $: crewOnlyStats = ship && fitStats ? applyCrewOverlay(fitStats, shipCrewContribution(noCaptainNodesState, ship)) : null;
  // WR-5a / WR-5c: the stats before every secondary node of the commanding captain (the Prospector overlay and Keen
  // Sensors are layered last; the crew nodes are set aside above), so the Museum bucket stops there and the Captain
  // bucket is effective - this. With no node it equals effectiveStats.
  $: preCaptainStats = ship ? shipStatsBeforeCaptain(noCaptainNodesState, ship) : null;

  // The economy stat rows (real numbers). `kind` picks the formatter: percent for the
  // multiplier / 0-based-bonus stats, flat for capacities / power / mass. Split into
  // Prospecting (the two prospecting-relevant stats) and Logistics (the rest) for the
  // categorized right column, each row keeping its base -> installed delta.
  type StatRow = { label: string; base: number; fitted: number; kind: "flat" | "pct" | "ly" };
  // 0.13.6 fuel-to-reach (user 2026-09-18): the old "Fuel Efficiency ×0.00" + "Fuel Capacity" rows
  // were vestigial fuel vocabulary. Fuel is retired; what the player cares about is travel RANGE in
  // lightyears (the same "Range" the dispatch modal + roster already use). One honest Range row
  // replaces the two, derived the same way as rangeLightYears (fuelCapacity x (1+engineEfficiency) x
  // LY_PER_TICK) so it agrees with the dispatch/roster readouts and moves as an FTL drive changes.
  // WR-4 (OC-C1): times (1 + the Fuel Depot's fleet reach bonus), the same factor shipReachDef applies, so the row
  // reads the reach the gates use. The bonus is fleet-wide, so base and installed scale alike (the gear delta keeps
  // its meaning). Reads the `state` prop at call time (props update before the reactive rows rebuild).
  const shipRangeLyOf = (s: ShipDerivedStats): number => s.fuelCapacity * (1 + s.engineEfficiency) * LY_PER_TICK * (1 + fleetReachBonus(state));
  function buildLiveRows(base: ShipDerivedStats, fit: ShipDerivedStats): StatRow[] {
    return [
      { label: "Extraction Yield", base: base.extractionYieldMult, fitted: fit.extractionYieldMult, kind: "pct" },
      { label: "Cargo Capacity", base: base.cargoCapacity, fitted: fit.cargoCapacity, kind: "flat" },
      { label: "FTL Speed", base: base.transitSpeedMult, fitted: fit.transitSpeedMult, kind: "pct" },
      { label: "Range", base: shipRangeLyOf(base), fitted: shipRangeLyOf(fit), kind: "ly" },
      { label: "Power Output", base: base.powerOutput, fitted: fit.powerOutput, kind: "flat" },
      { label: "Power Draw", base: base.powerDraw, fitted: fit.powerDraw, kind: "flat" },
      { label: "Mass", base: base.mass, fitted: fit.mass, kind: "flat" },
      // G1-1: guest quarters, only when either loadout has some (a ship with none never shows the row), and only once
      // Short-Range Missions are in (model.ts GUEST_QUARTERS_DISPLAY_LIVE, user 2026-10-19).
      ...(guestQuartersShown(base.colonistCapacity ?? 0) || guestQuartersShown(fit.colonistCapacity ?? 0)
        ? [{ label: "Guest Quarters", base: base.colonistCapacity ?? 0, fitted: fit.colonistCapacity ?? 0, kind: "flat" as const }]
        : []),
    ];
  }
  // 0.14.0 crew C-4c readout descriptors: ONE list per economy stat the readout shows, so the
  // crew-inclusive VALUE, the (i) definition, and the tap-value SOURCE popover all key off the same
  // stat. Order + labels MIRROR buildLiveRows above (which the gear-only install compare still uses,
  // untouched). `get` reads the stat off any derived-stat fold (base / gear / crew-inclusive).
  type StatDescriptor = { key: string; label: string; kind: "flat" | "pct" | "ly"; get: (s: ShipDerivedStats) => number };
  const STAT_DESCRIPTORS: StatDescriptor[] = [
    { key: "extractionYield", label: "Extraction Yield", kind: "pct", get: (s) => s.extractionYieldMult },
    { key: "cargoCapacity", label: "Cargo Capacity", kind: "flat", get: (s) => s.cargoCapacity },
    { key: "ftlSpeed", label: "FTL Speed", kind: "pct", get: (s) => s.transitSpeedMult },
    // CP-2 (OC-E5): Fast Departure / Fast Return lift one leg each; these two rows show only when a leg differs from
    // the FTL Speed row (readoutRows below).
    { key: "outLeg", label: "Departure Speed", kind: "pct", get: outboundLegSpeed },
    { key: "backLeg", label: "Return Speed", kind: "pct", get: returnLegSpeed },
    { key: "range", label: "Range", kind: "ly", get: shipRangeLyOf },
    { key: "powerOutput", label: "Power Output", kind: "flat", get: (s) => s.powerOutput },
    { key: "powerDraw", label: "Power Draw", kind: "flat", get: (s) => s.powerDraw },
    { key: "mass", label: "Mass", kind: "flat", get: (s) => s.mass },
    // G1-1 (Short-Range Missions): the berths passengers ride in; shown only when non-zero (readoutRows below).
    { key: "guestQuarters", label: "Guest Quarters", kind: "flat", get: (s) => s.colonistCapacity ?? 0 },
  ];
  // Plain-language definition per stat for the (i) affordance: what it does + how it affects play,
  // one sentence each (US English, first-pass). Keyed by StatDescriptor.key.
  const STAT_INFO: Record<string, string> = {
    extractionYield: "How much raw material a mining or salvage mission pulls in; higher yield means more resources per run.",
    cargoCapacity: "How much a ship can carry home in a single trip; a bigger hold means fewer runs to move the same haul.",
    ftlSpeed: "How fast the ship crosses between sectors; higher speed shortens every mission's travel time. A crafted Reactor Core's unused power speeds the drive too, with diminishing returns. Powered systems use it only once they draw more than the hull's own power, and the core's own weight eats into it first, but a Reactor Core never makes the ship slower than the Standard-Issue one.",
    outLeg: "The ship's speed on the outbound leg of a mission: FTL Speed plus the Fast Departure crew aboard.",
    backLeg: "The ship's speed on the return leg of a mission: FTL Speed plus the Fast Return crew aboard.",
    range: "How far the ship can travel before it must turn back, in light-years; more range reaches farther destinations. The Fuel Depot extends it for the whole fleet.",
    powerOutput: "Total power the ship supplies: the hull's own generation plus any crafted Reactor Core. It needs to cover everything the installed systems draw. Reactor Core power the systems leave unused speeds the drive (see FTL Speed).",
    powerDraw: `Total power the installed systems consume, after any power efficiency from Engineering crew, Reactor Overdrive or Martian crew. An install that would put it over power output is refused. If the ship is already over (an officer left or a Reactor Core came off), nothing is removed and only installs that would make it worse are refused, but in combat its weapons and shield recharge run weaker: the square root of output over draw, never below ${POWER_SUPPLY_FLOOR_PERCENT}%. Lower is better.`,
    mass: "The ship's combined mass from its hull and installed systems; lower mass is generally easier to move.",
    guestQuarters: "Berths for passengers such as refugees, separate from the crew and the cargo hold. Passenger runs need enough of them for everyone aboard.",
  };
  // The economy readout rows: base (bare hull), gear (gear-only fold), and effective (crew-inclusive)
  // for each stat. The row VALUE shows `effective`; the inline "(...)" note stays the GEAR delta
  // (gear - base), so crew is surfaced in the value + the source popover, never mislabeled as gear.
  type ReadoutRow = { key: string; label: string; kind: "flat" | "pct" | "ly"; base: number; gear: number; effective: number };
  $: readoutRows =
    baseStats && fitStats && effectiveStats
      ? STAT_DESCRIPTORS.map((d) => ({
          key: d.key,
          label: d.label,
          kind: d.kind,
          base: d.get(baseStats),
          gear: d.get(fitDriveStats ?? fitStats),
          effective: d.get(effectiveStats),
        }))
          .filter((r) => (r.key !== "outLeg" && r.key !== "backLeg") || Math.abs(r.effective - effectiveStats.transitSpeedMult) > 1e-9)
          // G1-1: Guest Quarters (and its (i) definition) shows only on a ship that has some, once Short-Range Missions
          // are in (model.ts GUEST_QUARTERS_DISPLAY_LIVE, user 2026-10-19).
          .filter((r) => r.key !== "guestQuarters" || guestQuartersShown(r.effective))
      : ([] as ReadoutRow[]);
  // CP-2: the two complement-fed shares that are not ship-sheet stats (each shown only when non-zero): the repair
  // speed-up every repair divides by (Damage Control, Mission Turnaround, Rapid Recovery, Veteran Instincts) and the
  // mission output share (Crew Output Multiplier, Command Presence). The note splits out the complement's part.
  type ShareRow = { key: string; label: string; total: number; crew: number };
  $: shareRows = ship
    ? ([
        { key: "repair", label: "Repair Speed", total: shipRepairSpeedBonus(safeState, ship), crew: crewRepairSpeedBonus(safeState, ship) },
        { key: "output", label: "Mission Output", total: shipMissionOutputBonus(safeState, ship), crew: crewMissionOutputBonus(safeState, ship) },
      ] as ShareRow[]).filter((r) => r.total > 1e-9)
    : ([] as ShareRow[]);
  const fmtShare = (v: number): string => `+${(v * 100).toFixed(1)}%`;
  // The SOURCE buckets for one readout stat: Base/hull (absolute), then the non-zero contributors as
  // signed deltas off the bare hull -> Ship systems (gear), Senior Staff (officers), Complement, Museum
  // (0.14.0 E4b: the account-level relic museum's ship-stat bonuses, layered last). Only
  // non-negligible buckets show (plus Base always), so a stat nothing modifies reads honestly as base.
  type SourceBucket = { label: string; text: string; delta: boolean };
  function sourceBucketsFor(key: string): SourceBucket[] {
    const d = STAT_DESCRIPTORS.find((x) => x.key === key);
    if (!d || !baseStats || !fitStats) return [];
    const base = d.get(baseStats);
    const gear = d.get(fitStats);
    const out: SourceBucket[] = [{ label: "Base / hull", text: fmtStatUnit(d.kind, base), delta: false }];
    const gearDelta = gear - base;
    if (Math.abs(gearDelta) > 1e-9) out.push({ label: "Ship systems", text: fmtDeltaUnit(d.kind, gearDelta), delta: true });
    if (crewOnlyStats && complementOnlyStats) {
      const od = d.get(crewOnlyStats) - d.get(complementOnlyStats);
      if (Math.abs(od) > 1e-9) out.push({ label: "Senior Staff", text: fmtDeltaUnit(d.kind, od), delta: true });
    }
    if (complementOnlyStats) {
      const cd = d.get(complementOnlyStats) - gear;
      if (Math.abs(cd) > 1e-9) out.push({ label: "Complement", text: fmtDeltaUnit(d.kind, cd), delta: true });
    }
    if (crewOnlyStats && preCaptainStats) {
      const md = d.get(preCaptainStats) - d.get(crewOnlyStats);
      if (Math.abs(md) > 1e-9) out.push({ label: "Museum", text: fmtDeltaUnit(d.kind, md), delta: true });
    }
    if (preCaptainStats && preLiftStats) {
      const kd = d.get(preLiftStats) - d.get(preCaptainStats);
      if (Math.abs(kd) > 1e-9) out.push({ label: "Captain", text: fmtDeltaUnit(d.kind, kd), delta: true });
    }
    // E-MOD EM-4: the Reactor Core's unused power speeding the drive (only the speed rows ever move).
    if (preLiftStats && effectiveStats) {
      const rd = d.get(effectiveStats) - d.get(preLiftStats);
      if (Math.abs(rd) > 1e-9) out.push({ label: reactorFloorBinds ? "Reactor Core (never slower)" : "Reactor surplus", text: fmtDeltaUnit(d.kind, rd), delta: true });
    }
    return out;
  }

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
  $: spareWeapons = equipmentPool.filter((e) => isSparePiece(e) && e.slotType === "weapon");

  // Combat-gear readiness (combat-defense rework, Unit 3/6, design S5 "inform, don't forbid"):
  //   - The REACTOR is the ONLY hard dispatch block. A ship with an empty reactorCore slot has no
  //     power and physically cannot be dispatched (canDispatchPatrol: noReactor). Read off the same
  //     fittedBySlot map the tiles use.
  //   - A missing WEAPON is a non-blocking ADVISORY: the ship can dispatch but cannot return fire.
  //   - Missing plating / shield emitter are OPTIONAL, silent player choices (a bare hull keeps its
  //     nonzero frame armor; no emitter means 0 shields, an emitter being the shield source), surfaced
  //     in the Defensive readout, not a banner.
  $: reactorMissing = ship !== null && fittedBySlot["reactorCore"] == null;
  // E-MOD EM-2 (user answer P2, 2026-10-17): the ship draws more power than it supplies (an officer left, a Reactor
  // Core came off). Nothing is evicted; this warning names the shortfall and its cause. null while in budget.
  $: powerNotice = ship !== null ? overBudgetNotice(safeState, shipId) : null;
  // E-MOD EM-10: the Power bar (the signed-off mockup: one bar, the efficiency cut hatched, the unused reactor power
  // shaded) and the Modules row. Read through shipPowerBudget, the one reader the gate, the combat penalty and the drive
  // lift share. Guarded like equipmentPool: a stray piece degrades to no bar rather than a white screen.
  $: powerBudgetNow = ((): ShipPowerBudget | null => {
    if (ship === null) return null;
    try {
      return shipPowerBudget(safeState, shipId);
    } catch {
      return null;
    }
  })();
  $: powerBar = powerBudgetNow !== null ? powerBarView(powerBudgetNow, powerNotice) : null;
  // Where the draw goes (the mockup's systems strip): every installed powered system but the module-row pieces (those
  // show their draw on their own tiles), and the rolled draw reductions, so the strip sums to the gross draw.
  $: drawRows = fittedPieces
    .filter((p) => p.slotType !== "module" && p.slotType !== "specUtility" && piecePowerDraw(p) > 0)
    .map((p) => ({ id: p.id, label: drawRowLabel(p), name: pieceName(p), draw: piecePowerDraw(p) }));
  $: drawReduction = drawReductionTotal(fittedPieces);
  // The drive's speed gain from the unused reactor power, as the sheet folds it (the readout's "Reactor surplus"
  // bucket): 0 when the core's weight takes the lift first (the never-slower floor).
  $: driveLiftPercent =
    effectiveStats && preLiftStats && preLiftStats.transitSpeedMult > 0
      ? Math.max(0, (effectiveStats.transitSpeedMult / preLiftStats.transitSpeedMult - 1) * 100)
      : 0;
  $: reactorPiece = fittedBySlot["reactorCore"] ?? null;
  $: moduleRow = shipDef ? moduleRowTiles(fittedPieces, shipDef.moduleSlots, hasSpecUtilitySlot) : null;
  $: utilityEmpty = hasSpecUtilitySlot && fittedBySlot["specUtility"] == null;
  $: spareModules = equipmentPool.filter((e) => isSparePiece(e) && e.slotType === "module").length;
  $: moduleSetLines = activeModuleSetLines(fittedPieces);
  $: noWeaponInstalled = combatReadout ? combatReadout.missingRequired.includes("weapon") : false;

  // Drone reads (carrier-only). hasDroneBays gates the whole drone strip + the DRONES
  // readout, so a non-carrier never shows an empty drone strip it can never fill.
  $: mountedPods = combatReadout ? combatReadout.mountedPods : [];
  $: droneBayCap = combatReadout ? combatReadout.droneBayCap : 0;
  $: hasDroneBays = droneBayCap > 0;
  $: sparePods = equipmentPool.filter((e) => isSparePiece(e) && e.slotType === "droneBay");

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
  // Either a damaged hull OR a checked-out loadout makes the board read-only. Every install /
  // uninstall / swap control and its click guard keys off this, so the two lock reasons behave
  // identically; each keeps its own explanatory banner.
  $: editsBlocked = shipDamaged || loadoutLocked;
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
      ? equipmentPool.filter(
          (e) =>
            isSparePiece(e) &&
            e.slotType === selectedSlot &&
            // E4d: the Spec Utility slot now holds several hull-gated FAMILIES (prospecting rigs, the
            // tactician Damage Control Suite, the explorer Pathfinder Suite). A family built for a
            // different hull class can never go in, so it is left out of this hull's list entirely rather
            // than shown as a wall of dimmed "wrong hull" tiles. (A prospector hull's list is therefore
            // exactly what it was before E4d: only rigs.) Every other slot is unfiltered, as before.
            (selectedSlot !== "specUtility" || !isHullSpecBlocked(e.id)),
        )
      : selectedHardpoint !== null
        ? spareWeapons
        : selectedBay !== null
          ? sparePods
          : [];
  // E4d: true when this spare is refused by THIS hull's class gate (the per-variety equipRequirement).
  function isHullSpecBlocked(instanceId: string): boolean {
    const gate = canFitEquipment(safeState, shipId, instanceId);
    return !gate.ok && gate.reason === "hullSpec";
  }
  $: pickerLabel =
    selectedSlot !== null
      ? // E4d: the Spec Utility slot's catalog label is "Prospecting Rig" (its original single family); on a
        // non-prospector hull it now holds a different family, so the picker uses the neutral slot name.
        selectedSlot === "specUtility" && !isProspectorHull
        ? "Spec Utility"
        : EQUIPMENT_SLOTS[selectedSlot]?.label ?? selectedSlot
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

  // 0.13.9 TARGETED SWAP: on a FILLED weapon hardpoint or drone bay, Swap replaces THAT piece. Its id
  // rides into the gate, the preview, and the install, so a full hull is no longer refused with
  // hardpointsFull / baysFull and the compare is against the piece being replaced. Singleton slots
  // already swap on their own (undefined here), and an empty cell is a plain install.
  $: replacingId =
    (selectedHardpoint !== null || selectedBay !== null) && installedPiece !== null ? installedPiece.id : undefined;

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
    installCandidate !== null && (SYSTEM_SLOTS.some((s) => s.slotType === installCandidate.slotType) || installCandidate.slotType === "module");
  // E-MOD EM-10: a module candidate's card lines (what it does, when it acts, its draw) head its compare.
  $: candidateModuleLines = installCandidate !== null ? pieceModuleLines(installCandidate, fittedPieces) : null;

  // The hypothetical gear array with the candidate installed (the SAME shape fitEquipment
  // would produce), and the two readouts (current vs candidate) folded through the pure
  // helper. Guarded on the hull resolving (shipDef + combat class + an open target).
  $: candidateGear =
    installCandidate !== null && installTarget !== null
      ? applyHypotheticalInstall(fittedPieces, installCandidate, installTarget, replacingId)
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
    if (row.kind === "pct") return "×" + v.toFixed(2);
    if (row.kind === "ly") return `${Math.floor(v)} LY`; // 0.13.9: floored like every range readout
    return fmtFlat(Number(v.toFixed(1)));
  }
  $: compareRows = ((): CompareRow[] => {
    if (!installCandidate || !candidateGear) return [];
    // ECONOMY: diff the derived stats with base = the CURRENTLY-installed loadout and
    // fitted = the hypothetical candidate loadout, reusing the exact rows the live board shows.
    if (candidateIsEconomy) {
      if (!ship || !fitStats) return [];
      // E-MOD EM-4 review: both sides through the Reactor Core's drive rule (gear only), so a crafted core never
      // compares as slower than the Standard-Issue one.
      const candStats = gearSheetWithReactorDrive(ship, candidateGear);
      // E-MOD EM-10: a module shows its power rows and every other row it really moves (its draw changes the Reactor
      // Core surplus, so FTL Speed and Range can move); its effect is in the card lines above them.
      const rows = buildLiveRows(fitDriveStats ?? fitStats, candStats).filter(
        (r) => installCandidate?.slotType !== "module" || moduleCompareKeepsRow(r),
      );
      return rows.map((r) => {
        // 0.13.9: a Range row diffs the FLOORED values it displays (floor(fitted) - floor(base)), so the
        // delta always equals the difference of the two numbers shown beside it.
        const delta = r.kind === "ly" ? Math.floor(r.fitted) - Math.floor(r.base) : r.fitted - r.base;
        const zero = Math.abs(delta) < 1e-9;
        const lowerBetter = ECON_LOWER_IS_BETTER.has(r.label);
        const good = !zero && (lowerBetter ? delta < 0 : delta > 0);
        const bad = !zero && !good;
        // Percent stats report the change in points, flat stats as the raw number.
        const deltaText = zero
          ? null
          : r.kind === "pct"
            ? pointsDeltaText(delta)
            : r.kind === "ly"
              ? `${delta > 0 ? "+" : ""}${delta} LY`
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
  // 0.14.0 crew C-4c: format a raw stat value / signed delta in its display units for the source
  // popover (percent multipliers as "×1.20" / "+20 pts", range in LY, flats as a rounded number).
  function fmtStatUnit(kind: "flat" | "pct" | "ly", v: number): string {
    if (kind === "pct") return "×" + v.toFixed(2);
    if (kind === "ly") return `${Math.round(v)} LY`;
    return fmtFlat(Number(v.toFixed(1)));
  }
  function fmtDeltaUnit(kind: "flat" | "pct" | "ly", dv: number): string {
    const sign = dv > 0 ? "+" : "";
    if (kind === "pct") return `${sign}${(dv * 100).toFixed(0)} pts`;
    if (kind === "ly") return `${sign}${Math.round(dv)} LY`;
    return `${sign}${fmtFlat(Number(dv.toFixed(1)))}`;
  }
  // A defensive-stat EFFECTIVENESS ratio (combat-defense "Effectiveness %" model) as a whole-percent
  // string, e.g. 1.2 -> "120%", 0.667 -> "67%". May read below or above 100% (a glass hull is < 100%,
  // a capital hull > 100%). Rounded to the nearest point so the readout stays clean.
  function fmtPct(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
  }
  function fmtStatValue(row: StatRow): string {
    if (row.kind === "pct") return "×" + row.fitted.toFixed(2);
    if (row.kind === "ly") return `${Math.floor(row.fitted)} LY`; // 0.13.9: floored like every range readout
    return fmtFlat(Number(row.fitted.toFixed(1)));
  }
  // The signed base -> installed change, or null when it is effectively zero (so a row
  // simply omits the note rather than showing "+0"). Percent stats report in points.
  function fmtDelta(row: StatRow): string | null {
    // 0.13.9: Range diffs the FLOORED values it shows, so the note matches the displayed numbers.
    const d = row.kind === "ly" ? Math.floor(row.fitted) - Math.floor(row.base) : row.fitted - row.base;
    if (Math.abs(d) < 1e-9) return null;
    const sign = d > 0 ? "+" : "";
    if (row.kind === "pct") return `${sign}${(d * 100).toFixed(0)} pts`;
    if (row.kind === "ly") return `${sign}${d} LY`;
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
  function reasonText(refusal: EquipFitRefusal): string {
    switch (refusal.reason) {
      case "noInstance":
        return "system no longer exists";
      case "noShip":
        return "ship no longer exists";
      case "onMission":
        return shipGearLockReasonText(refusal.lock);
      case "hullSpec":
        return "wrong hull type for this system";
      case "captainSpec":
        return "captain specialization does not match";
      case "captainSpecParked":
        return "assign a matching captain first (hull is parked)";
      case "slotNotInstallable":
        return "this system cannot be installed";
      // Crafting 0.13.3 (Unit 2.1): the system is reserved by a queued salvage order.
      // Actionable on purpose (cancel the order), because it is fully reversible.
      case "queuedForSalvage":
        return "queued for salvage (cancel the salvage order to install it)";
      case "committedToLoadout":
        return "committed to an Armory loadout (uninstall it there, or check that loadout out)";
      case "locked":
        return "locked (unlock it in Ship Equipment first)";
      case "hardpointsFull":
        return "all weapon hardpoints are full (uninstall a weapon first)";
      case "baysFull":
        return "all drone bays are full (uninstall a drone pod first)";
      case "replaceTargetInvalid":
        return "the system being swapped out is no longer installed here";
      // 0.13.9: the system this install would move out belongs to a checked-out loadout.
      case "occupantInLoadout":
        return "the installed system belongs to a checked-out loadout (check that loadout in at the Armory first)";
      // E-MOD EM-2: the install would leave the ship over its power budget.
      case "overPower":
        return overPowerReasonText(refusal.powerShortfall);
      // E-MOD EM-5: the shared module slots are full, or this module is already aboard.
      case "moduleSlotsFull":
        return moduleSlotsFullReasonText();
      case "duplicateModule":
        return duplicateModuleReasonText();
      // E-MOD EM-7 (user "Armory loadouts only"): only Install on... returns it; listed so the switch stays exhaustive.
      case "moduleArmoryOnly":
        return moduleArmoryOnlyReasonText();
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

  // 0.14.0 crew C-4c: position the stat popover with the SAME clamp recipe as positionTip (measured
  // AFTER the CSS max-height cap, so the returned top already fits the capped element in the margins).
  function positionStatPop(): void {
    if (!statPop || !statPopEl) return;
    const anchor = statPop.el.getBoundingClientRect();
    const { left, top } = clampFloatingTip({
      anchorRect: anchor,
      tipWidth: statPopEl.offsetWidth,
      tipHeight: statPopEl.offsetHeight,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      margin: TIP_MARGIN,
      gap: TIP_GAP,
    });
    statPopLeft = left;
    statPopTop = top;
    statPopVisible = true;
  }
  // Toggle the stat popover for a stat's (i) definition or its source buckets. Re-tapping the SAME
  // affordance closes it; opening one closes the tile tooltip + supersedes any other stat popover
  // (one floater at a time). Rendered invisible for one frame, then measured + placed, so it never
  // flashes at the wrong spot (mirrors openTip). NOT gated on editsBlocked: it is read-only info.
  async function toggleStatPop(key: string, mode: "info" | "source", el: HTMLElement): Promise<void> {
    if (statPop && statPop.key === key && statPop.mode === mode) {
      closeStatPop();
      return;
    }
    closeTip(true); // never show a tile tooltip and a stat popover at the same time
    statPop = { key, mode, el };
    statPopVisible = false;
    await tick();
    positionStatPop();
  }
  function closeStatPop(): void {
    statPop = null;
    statPopVisible = false;
  }

  // Open the floating tooltip for a piece. Rendered invisibly for one frame, then
  // measured + positioned + shown, so it never flashes at the wrong spot. Blocked
  // while the ship is damaged (tiles are locked then).
  async function openTip(piece: EquipmentInstance, el: HTMLElement, pinned: boolean): Promise<void> {
    if (editsBlocked) return;
    // A fresh open (hover swap, click-pin, or picker open) supersedes any pending
    // grace-delay hide, so a stale timer can never close the tooltip we just opened.
    cancelTipHide();
    closeStatPop(); // one floater at a time: opening a tile tooltip closes any stat popover
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
    if (statPop) positionStatPop();
  }
  // Outside-press dismiss for a PINNED (touch) tooltip: a press that lands neither on
  // the anchor tile nor inside the tooltip itself closes the pin. This is safe for the
  // host modal because the Ship Systems .modal-backdrop has NO backdrop click-close
  // handler (App.svelte), so this only hides the floating tooltip: it never closes the
  // modal and never touches its focus trap. A press on the tile toggles via the tile's
  // own click, and a press on a spare tile pins that spare's tooltip (its click runs
  // after this and re-opens the tooltip onto the tapped tile).
  function onOutsidePointerDown(e: Event): void {
    const target = e.target as Node | null;
    // Stat popover (0.14.0 crew C-4c): a press landing neither on its anchor affordance nor inside
    // the popover closes it. A press ON the affordance is left to its own click handler (which
    // toggles), so this only dismisses a click-away. Same modal-safe reasoning as the tile tooltip.
    if (statPop && target && !statPop.el.contains(target) && !(statPopEl && statPopEl.contains(target))) {
      closeStatPop();
    }
    if (!tipPinned || !activeTip) return;
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
    const gear = applyHypotheticalInstall(fittedPieces, spare, installTarget, replacingId);
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
    if (editsBlocked) return;
    void openTip(piece, e.currentTarget as HTMLElement, true);
  }

  function handleInstall(instanceId: string): void {
    onInstall(shipId, instanceId, replacingId);
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

  // Portal action (0.13.2 QA): move the install modal's backdrop to <body> on mount so it
  // escapes this panel's DEEPLY-NESTED ancestors. A position:fixed element is trapped (sized to
  // an ancestor instead of the viewport) if ANY ancestor establishes a containing block via
  // transform / filter / backdrop-filter / will-change / contain / perspective, which is why the
  // app's root-level modals cover the screen but this one, buried inside the ships panel, did not
  // (the board was left undimmed and the sheet rendered low). Re-parenting to <body> guarantees
  // the backdrop is viewport-fixed. Scoped styles survive the move (Svelte keeps the hash class on
  // the node), and Svelte still drives its reactivity + events by node reference. node.remove() on
  // destroy is safe whether Svelte already detached it or not.

  // A short label for a spare in the picker list + its info button aria-label. Weapons
  // and drone pods carry no economy "variety" label in EQUIPMENT_SLOTS, so they resolve
  // through the same helpers the readout uses (weaponDisplayName / droneRoleName); every
  // other slot uses its EQUIPMENT_SLOTS display label. The floating tooltip still shows
  // the full identity on hover / tap; this is just the row's at-a-glance name.
  function spareLabel(piece: EquipmentInstance): string {
    if (piece.slotType === "weapon") return weaponName(piece);
    if (piece.slotType === "droneBay") return `${droneRoleName(piece.droneRole)} drone`;
    // E4d: a relic-unlocked family in the shared Spec Utility slot (stamped moduleVariant with its own
    // identity) reads as its OWN name ("Damage Control Suite"), not the slot's original "Prospecting Rig".
    // Every other piece (no such variety) keeps the slot label exactly as before.
    // Resolved through the shared pieceVarietyDef (model.ts), never a hand-rolled lookup. Still scoped to
    // specUtility so crew modules and sensors keep their slot label exactly as before.
    if (piece.slotType === "specUtility") {
      const v = pieceVarietyDef(piece);
      if (v !== undefined) return v.label;
    }
    // E-MOD EM-10: a universal module reads as its own catalog name ("Arc Discharger"), never the slot's "Module".
    if (piece.slotType === "module") return pieceModuleDef(piece)?.label ?? "Module";
    return EQUIPMENT_SLOTS[piece.slotType]?.label ?? piece.slotType;
  }

  // E-MOD EM-10: a piece's own name for the Power bar's lines (its blueprint's, or "Standard-Issue <slot>").
  function pieceName(piece: EquipmentInstance): string {
    if (piece.slotType === "weapon" || piece.slotType === "droneBay" || piece.slotType === "module") return spareLabel(piece);
    const bp = piece.blueprintKey === null ? undefined : BLUEPRINTS[piece.blueprintKey];
    return bp?.label ?? `Standard-Issue ${spareLabel(piece)}`;
  }
  // The strip label of a powered system: its board slot's name.
  function drawRowLabel(piece: EquipmentInstance): string {
    if (piece.slotType === "weapon") return "Weapon";
    if (piece.slotType === "droneBay") return "Drone pod";
    return [...DEFENSE_SLOTS, ...SYSTEM_SLOTS].find((m) => m.slotType === piece.slotType)?.label ?? spareLabel(piece);
  }
  // E-MOD EM-10: the short status a module spare shows in the install list (the mockup's chips), from the gate's own
  // refusal: "+8 draw" when it can go on, else the reason in a few words. The full sentence is on the compare.
  function moduleStatusText(gate: EquipFitVerdict, spare: EquipmentInstance): string {
    if (gate.ok) return `+${spare.powerDraw} draw`;
    switch (gate.reason) {
      case "overPower":
        return `Needs ${gate.powerShortfall} more power`;
      case "moduleSlotsFull":
        return "No free slot";
      case "duplicateModule":
        return "Already aboard";
      case "onMission":
        return "Ship is out";
      default:
        return "Blocked";
    }
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
              {#if gearLock !== null}&middot; {shipGearLockReasonText(gearLock)}{/if}
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

    <!-- LOADOUT-LOCK BANNER (0.13.6): a checked-out Armory loadout drives this ship, so its install
         screen is read-only. Names the loadout (so the ship's own overview tells you which one it
         runs) and points to where to edit it. Every install / uninstall / swap control is disabled
         via editsBlocked; the engine also refuses committed-piece uninstalls. -->
    {#if loadoutLocked}
      <div class="ss-advisory" role="status">
        <span class="ss-advisory-dot" aria-hidden="true"></span>
        <span><strong>Running the {loadoutName || "checked-out"} loadout.</strong> This ship's systems are managed in the Armory. Check the loadout in there to edit or uninstall them.</span>
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
    <!-- E-MOD EM-2 / EM-3 (user answers P2, P6): the over-budget warning now lives in the Power bar at the top of the
         board (EM-10, the signed-off mockup: the chip, then the strength line, the gentle-cut sentence and the cause). -->

    <div class="ss-main" class:embedded>
      <!-- LEFT: the loadout board (0.13.2 Unit 4, Layout C). Function-grouped slots, each
           slot / tile carrying STABLE Install-Swap + Uninstall BUTTONS (never an action in a
           tooltip). Offense is an auto-scaling weapon-tile grid; Defense + Systems are rows;
           Drone Bays (carrier-only) mirror Offense. The spare-pool PICKER opens below when a
           slot's Install / Swap is pressed. Info is a DISPLAY-ONLY floating tooltip on
           hover / tap of a tile (no button lives inside it). -->
      <div class="ss-fit-col">
        <!-- E-MOD EM-10 POWER (the signed-off mockup, section C: ONE bar, the efficiency cut hatched, the unused Reactor
             Core power shaded, the output marked). "Power N / M" is the net draw against the output; the chip is the
             headroom, or the shortfall with the strength the next fight runs at (overBudgetNotice().supplyPercent).
             Never evicts and never blocks dispatch (P2): power gates installs only. -->
        {#if powerBar}
          <div class="ss-group ss-power" class:over={powerBar.over}>
            <div class="ss-group-head">
              <span class="ss-head-ic" aria-hidden="true"><Icon name="power" /></span> Power
              {#if onOpenHelp}
                <button type="button" class="ss-help-link" on:click={() => onOpenHelp?.(POWER_HELP_TOPIC_ID)} aria-label="Help: Power and modules">
                  <Icon name="help" /> Power and modules
                </button>
              {/if}
              <span class="ss-power-chip" class:warn={powerBar.over}>
                <Icon name={powerBar.over ? "warning" : "check"} />
                {powerBar.chip}
              </span>
            </div>
            <div class="ss-power-num">
              <span class="ss-pnum">{powerBar.headline}</span>
              <span class="ss-power-unit">net draw / output</span>
            </div>
            <div class="ss-pbar" class:over={powerBar.over} role="img" aria-label={powerBar.ariaLabel}>
              <span class="ss-pbar-used" style="width: {powerBar.usedPct}%"></span>
              {#if powerBar.cut > 0}
                <span class="ss-pbar-cut" style="left: {powerBar.cutLeftPct}%; width: {powerBar.cutPct}%"></span>
              {/if}
              {#if powerBar.surplus > 0}
                <span class="ss-pbar-surplus" style="left: {powerBar.surplusLeftPct}%; width: {powerBar.surplusPct}%"></span>
              {/if}
              <span class="ss-pbar-mark" style="left: {powerBar.outputMarkPct}%"></span>
            </div>
            <div class="ss-legend">
              {#each powerBar.legend as item (item.label)}
                <span>{item.label} <b>{item.value}</b></span>
              {/each}
            </div>
            <p class="ss-power-note">{powerBar.efficiencyText}. {reactorPiece ? `Reactor Core: ${pieceName(reactorPiece)}.` : "No Reactor Core installed."}</p>
            {#if powerNotice !== null}
              <div class="ss-power-warn" role="status">
                <strong>{powerNotice.strength}</strong> {powerNotice.gentleNote} {powerNotice.cause}
              </div>
            {:else if powerBar.surplus > 0}
              <p class="ss-power-surplus">
                {#if driveLiftPercent >= 0.05}
                  <span class="ss-power-chip ok"><Icon name="drive" /> Drive +{driveLiftPercent.toFixed(1)}%</span>
                  {powerBar.surplus} unused Reactor Core power speeds the drive.
                {:else}
                  {powerBar.surplus} unused Reactor Core power. The core's own weight takes its drive lift first, so the drive is not faster yet (a Reactor Core never makes it slower).
                {/if}
              </p>
            {/if}
            {#if drawRows.length > 0}
              <div class="ss-power-systems">
                {#each drawRows as row (row.id)}
                  <div><span class="ss-power-sys-k">{row.label}</span><span class="ss-power-sys-v">{row.name} <b>{row.draw}</b></span></div>
                {/each}
                {#if drawReduction > 0}
                  <div><span class="ss-power-sys-k">Draw reduction</span><span class="ss-power-sys-v">Rolled lines <b>&minus;{drawReduction}</b></span></div>
                {/if}
              </div>
            {/if}
          </div>
        {:else if powerNotice !== null}
          <!-- The budget reader failed (a stray piece) but the ship is over budget: the warning still shows. -->
          <div class="ss-power-warn" role="status">
            <strong>{powerNotice.chip}: {powerNotice.strength}</strong> {powerNotice.gentleNote} {powerNotice.cause}
          </div>
        {/if}

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
              <div class="ss-hp" class:sel={selectedHardpoint === hpIndex} class:locked={editsBlocked}>
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
                      disabled={editsBlocked}
                      on:click={() => selectHardpoint(hpIndex)}
                    >Swap</button>
                    <button
                      class="ss-act ss-act-uninstall"
                      disabled={onMission || editsBlocked}
                      title={gearLockHint}
                      on:click={() => handleUninstall(weapon.id)}
                    >Uninstall</button>
                  </div>
                {:else}
                  <div class="ss-hp-info ss-hp-empty">
                    <span class="ss-tile ss-tile-empty">
                      <span class="ss-tile-ic">+</span>
                    </span>
                    <span class="ss-hp-name">Empty</span>
                    <!-- Reserve the rarity line a filled tile shows below its name (0.13.2 QA
                         nitpick), so an empty tile's Install button aligns with a filled tile's
                         Swap button across the hardpoint grid instead of sitting one line higher. -->
                    <span class="ss-hp-q" aria-hidden="true">&nbsp;</span>
                  </div>
                  <div class="ss-slot-actions">
                    <button
                      class="ss-act ss-act-install"
                      disabled={editsBlocked}
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
              <div class="ss-slot" class:sel={selectedSlot === meta.slotType} class:locked={editsBlocked}>
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
                    <button class="ss-act ss-act-swap" disabled={editsBlocked} on:click={() => selectSlot(meta.slotType)}>Swap</button>
                    <button
                      class="ss-act ss-act-uninstall"
                      disabled={onMission || editsBlocked}
                      title={gearLockHint}
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
                    <button class="ss-act ss-act-install" disabled={editsBlocked} on:click={() => selectSlot(meta.slotType)}>Install</button>
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
              <div class="ss-slot" class:sel={selectedSlot === meta.slotType} class:locked={editsBlocked}>
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
                      {#if fitted.slotType === "ftlDrive"}
                        <span class="ss-slot-sub">{driveDrawText(fitted)}</span>
                      {/if}
                    </span>
                  </button>
                  <div class="ss-slot-actions">
                    <button class="ss-act ss-act-swap" disabled={editsBlocked} on:click={() => selectSlot(meta.slotType)}>Swap</button>
                    <button
                      class="ss-act ss-act-uninstall"
                      disabled={onMission || editsBlocked}
                      title={gearLockHint}
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
                    <button class="ss-act ss-act-install" disabled={editsBlocked} on:click={() => selectSlot(meta.slotType)}>Install</button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- E-MOD EM-10 MODULES (the signed-off mockup, section C): one tile per shared module slot
             (SHIP_TYPES[hull].moduleSlots, user M1): the Spec Utility first (the mockup's pick), then each installed
             module, then the empty slots. A filled tile opens its details (the floating card: what it does, when it acts,
             its draw); Remove takes it off and leaves the slot empty. An empty tile says how to fill it. The bridge,
             quarters and sensor keep their own slots and are never counted here. -->
        {#if moduleRow && (moduleRow.slots > 0 || moduleRow.used > 0)}
          <div class="ss-group">
            <div class="ss-group-head">
              <span class="ss-head-ic" aria-hidden="true"><Icon name="module" /></span> Modules
              <span class="ss-group-cap">{moduleRow.used} / {moduleRow.slots} slots</span>
            </div>
            <p class="ss-mod-note">
              {shipDef.label} hull: {moduleRow.slots} module slot{moduleRow.slots === 1 ? "" : "s"}.{hasSpecUtilitySlot ? " The Spec Utility counts here." : ""} The bridge, quarters and sensor keep their own slots.
            </p>
            <div class="ss-mod-grid">
              {#each moduleRow.tiles as t (t.kind === "empty" ? `empty-${t.index}` : t.piece.id)}
                {#if t.kind === "empty"}
                  <div class="ss-mod-tile ss-mod-empty" class:locked={editsBlocked}>
                    <span class="ss-mod-glyph" aria-hidden="true"><Icon name="module" size={22} /></span>
                    <span class="ss-mod-name">Empty module slot</span>
                    <span class="ss-mod-sub">{spareModules > 0 ? "Install one from your spare modules." : "Craft a module at the Fabricator (its Modules group), then install it here."}</span>
                    <div class="ss-slot-actions">
                      <button class="ss-act ss-act-install" disabled={editsBlocked} on:click={() => selectSlot("module")}>Install</button>
                      {#if utilityEmpty && t.index === moduleRow.used}
                        <button class="ss-act ss-act-install" disabled={editsBlocked} on:click={() => selectSlot("specUtility")}>Spec Utility</button>
                      {/if}
                    </div>
                  </div>
                {:else}
                  {@const piece = t.piece}
                  {@const svg = equipmentSvgIcon(piece)}
                  {@const cond = pieceConditionPercent(piece)}
                  <div class="ss-mod-tile" class:sel={selectedSlot === piece.slotType && piece.slotType === "specUtility"} class:locked={editsBlocked} style="--tc: {equipmentRarityColor(piece.rarity)}">
                    <button
                      type="button"
                      class="ss-mod-info"
                      aria-label={`${spareLabel(piece)}: ${piece.rarity} grade, iL ${piece.iLevel}, ${moduleTileDrawText(piece)}, condition ${cond}%. Details.`}
                      on:click={(e) => clickInfo(e, piece)}
                      on:mouseenter={(e) => hoverTip(piece, e.currentTarget)}
                      on:mouseleave={hoverOut}
                      on:focus={(e) => hoverTip(piece, e.currentTarget)}
                      on:blur={hoverOut}
                    >
                      <span class="ss-mod-cat">{moduleTileCategory(piece)}</span>
                      <span class="ss-mod-glyph" aria-hidden="true">{#if svg !== null}<Icon name={svg} size={22} />{:else}{tileIcon(piece)}{/if}</span>
                      <span class="ss-mod-name">{spareLabel(piece)}</span>
                      <span class="ss-mod-sub">{piece.rarity} &middot; iL {piece.iLevel} &middot; {moduleTileDrawText(piece)}</span>
                      <span class="ss-mod-wear" title={`Condition ${cond}%`} aria-hidden="true"><i style="width: {cond}%"></i></span>
                      <span class="ss-mod-sub">Condition {cond}%</span>
                    </button>
                    <div class="ss-slot-actions">
                      {#if t.kind === "utility"}
                        <button class="ss-act ss-act-swap" disabled={editsBlocked} on:click={() => selectSlot("specUtility")}>Swap</button>
                      {/if}
                      <button
                        class="ss-act ss-act-uninstall"
                        disabled={onMission || editsBlocked}
                        title={gearLockHint}
                        on:click={() => handleUninstall(piece.id)}
                      >Remove</button>
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
            {#each moduleSetLines as line (line.chip)}
              <p class="ss-mod-set"><span class="ss-power-chip ok"><Icon name="check" /> {line.chip}</span> {line.text}</p>
            {/each}
          </div>
        {/if}

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
                <div class="ss-hp" class:sel={selectedBay === bayIndex} class:locked={editsBlocked}>
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
                      <button class="ss-act ss-act-swap" disabled={editsBlocked} on:click={() => selectBay(bayIndex)}>Swap</button>
                      <button
                        class="ss-act ss-act-uninstall"
                        disabled={onMission || editsBlocked}
                        title={gearLockHint}
                        on:click={() => handleUninstall(pod.id)}
                      >Uninstall</button>
                    </div>
                  {:else}
                    <div class="ss-hp-info ss-hp-empty">
                      <span class="ss-tile ss-tile-empty"><span class="ss-tile-ic">+</span></span>
                      <span class="ss-hp-name">Empty</span>
                    </div>
                    <div class="ss-slot-actions">
                      <button class="ss-act ss-act-install" disabled={editsBlocked} on:click={() => selectBay(bayIndex)}>Install</button>
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
          <!-- 0.13.6: the install flow now uses the shared ActionModal shell (backdrop, portal,
               centered/bottom-sheet, sticky head + X, focus-trap). The body (installed banner +
               master-detail flow) is unchanged; the ss-flow container query resolves against
               ActionModal's dialog (container-type: inline-size), same width as the old .ss-picker. -->
          <ActionModal title={`Install · ${pickerLabel}`} ariaLabel={`Install ${pickerLabel}`} onClose={closePicker}>
            {#if shipDamaged}
              <p class="ss-note ss-note-dim">Repair the ship before installing new ship systems.</p>
            {:else if pickerSpares.length === 0}
              {#if selectedSlot === "module"}
                <p class="ss-note ss-note-dim">No spare modules in storage. Craft one at the Fabricator (its Modules group), or remove one from another ship.</p>
              {:else}
                <p class="ss-note ss-note-dim">No spare {pickerLabel} systems in storage. Fabricate one, or uninstall from another ship.</p>
              {/if}
            {:else}
              <!-- 1. INSTALLED banner: the piece currently in this slot / hardpoint / bay. -->
              <div class="ss-installed">
                <span class="ss-installed-tag">Installed</span>
                {#if installedPiece}
                  {@const installedSvg = equipmentSvgIcon(installedPiece)}
                  <span class="ss-tile" style="--tc: {equipmentRarityColor(installedPiece.rarity)}">
                    <span class="ss-tile-dot"></span>
                    <span class="ss-tile-ic">{#if installedSvg !== null}<Icon name={installedSvg} />{:else}{tileIcon(installedPiece)}{/if}</span>
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
                      {@const gate = canFitEquipment(safeState, shipId, spare.id, replacingId)}
                      {@const net = spareNetRating(spare)}
                      {@const spareSvg = equipmentSvgIcon(spare)}
                      <button
                        type="button"
                        class="ss-spare-tile"
                        class:sel={installCandidateId === spare.id}
                        class:blocked={!gate.ok}
                        aria-pressed={installCandidateId === spare.id}
                        aria-label={`${spareLabel(spare)}: ${spare.rarity} grade, iL ${spare.iLevel}.${gate.ok ? "" : " Cannot install: " + reasonText(gate) + "."} Compare.`}
                        on:click={() => selectCandidate(spare.id)}
                        on:mouseenter={(e) => hoverTip(spare, e.currentTarget)}
                        on:mouseleave={hoverOut}
                        on:focus={(e) => hoverTip(spare, e.currentTarget)}
                        on:blur={hoverOut}
                      >
                        <span class="ss-tile" style="--tc: {equipmentRarityColor(spare.rarity)}">
                          <span class="ss-tile-dot"></span>
                          <span class="ss-tile-ic">{#if spareSvg !== null}<Icon name={spareSvg} />{:else}{tileIcon(spare)}{/if}</span>
                          <span class="ss-tile-il">iL {spare.iLevel}</span>
                        </span>
                        <span class="ss-slot-text">
                          <span class="ss-slot-label">{spareLabel(spare)}</span>
                          <span class="ss-slot-sub">{spare.rarity} &middot; iL {spare.iLevel}</span>
                          <!-- E-MOD EM-10: a module spare's status in the mockup's words ("+8 draw", "Needs 6 more power"). -->
                          {#if spare.slotType === "module"}
                            <span class="ss-mod-status" class:bad={!gate.ok}>{moduleStatusText(gate, spare)}</span>
                          {/if}
                        </span>
                        <span class="ss-spare-net">
                          {#if spare.slotType === "module"}
                            {#if !gate.ok}<span class="ss-blocked-tag">Blocked</span>{/if}
                          {:else if !gate.ok}
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
                    {@const gate = canFitEquipment(safeState, shipId, installCandidate.id, replacingId)}
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
                      <!-- E-MOD EM-10: a module says what it does, when it acts and its draw (the card's lines). -->
                      {#if candidateModuleLines}
                        <div class="ss-compare-mod">
                          <div class="ss-compare-mod-kind">{candidateModuleLines.kind}</div>
                          <div>{candidateModuleLines.effect}</div>
                          <div>{candidateModuleLines.when}</div>
                          {#if candidateModuleLines.rule}<div><b>{candidateModuleLines.rule}</b></div>{/if}
                          <div>{candidateModuleLines.draw}</div>
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
                      <!-- E-MOD EM-10: a refused install says why in the mockup's words ("Can't install Shield Surge:
                           needs 6 more power. ..."), every reason through the one exhaustive reasonText switch. -->
                      {#if !gate.ok}
                        <div class="ss-refuse" role="alert">
                          <Icon name="warning" />
                          <span>Can't install {spareLabel(installCandidate)}: {reasonText(gate)}.</span>
                        </div>
                      {/if}
                      <!-- Commit: the stable Install button (never in a tooltip). Gated per
                           candidate; on-mission / damaged locks preserved via the gate + shipDamaged. -->
                      <button
                        class="ss-act ss-act-install ss-install-commit"
                        disabled={!gate.ok || shipDamaged}
                        title={gate.ok ? undefined : reasonText(gate)}
                        on:click={() => handleInstall(installCandidate.id)}
                      >{gate.ok ? (replacingId !== undefined ? "Swap" : "Install") : "Blocked"}</button>
                    </div>
                  {:else}
                    <p class="ss-note ss-note-dim ss-compare-empty">Select a system to compare it with what is installed.</p>
                  {/if}
                </div>
              </div>
            {/if}
          </ActionModal>
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

        <!-- EXPLORATION / PROSPECTING: the economy stats (extraction, cargo, FTL, range,
             power, mass). 0.14.0 crew C-4c: the VALUE is now CREW-INCLUSIVE (effectiveShipStats),
             the inline "(...)" note stays the gear-only delta, an (i) button opens the stat's
             definition popover, and tapping the value opens its SOURCE-buckets popover. -->
        <div class="ss-cat">
          <div class="ss-cat-head"><span class="ss-cat-glyph" aria-hidden="true">&#9935;</span> Exploration / Prospecting</div>
          {#each readoutRows as row (row.key)}
            {@const gearNote = fmtDelta({ label: row.label, base: row.base, fitted: row.gear, kind: row.kind })}
            <div class="ss-srow">
              <span class="ss-sk">
                {row.label}
                <button
                  type="button"
                  class="ss-info-btn"
                  aria-label={"About " + row.label}
                  on:click|stopPropagation={(e) => toggleStatPop(row.key, "info", e.currentTarget)}
                >&#9432;</button>
              </span>
              <button
                type="button"
                class="ss-sv ss-sv-btn"
                aria-label={"Show sources for " + row.label}
                on:click|stopPropagation={(e) => toggleStatPop(row.key, "source", e.currentTarget)}
              >{fmtStatValue({ label: row.label, base: row.base, fitted: row.effective, kind: row.kind })}{#if gearNote}{" "}<small>({gearNote})</small>{/if}</button>
            </div>
          {/each}
          {#each shareRows as row (row.key)}
            <div class="ss-srow">
              <span class="ss-sk">{row.label}</span>
              <span class="ss-sv">{fmtShare(row.total)}{#if row.crew > 1e-9 && row.crew < row.total - 1e-9}{" "}<small>(complement {fmtShare(row.crew)})</small>{/if}</span>
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
      <EquipmentTooltip piece={tipPiece} shipPieces={fittedPieces} />
    </div>
  {/if}

  <!-- STAT POPOVER (0.14.0 crew C-4c): one JS-positioned floater over the readout rows, clamped
       inside the viewport (see positionStatPop), toggled from the (i) affordance ("info": a
       plain-language definition) or the tapped stat VALUE ("source": the stat's source buckets).
       A POPOVER, not an inline accordion (explicit user correction). Display-only: no controls. -->
  {#if statPop}
    {@const pop = statPop}
    <div
      class="ss-statpop"
      bind:this={statPopEl}
      role="tooltip"
      style="left: {statPopLeft}px; top: {statPopTop}px; visibility: {statPopVisible ? 'visible' : 'hidden'}"
    >
      {#if pop.mode === "info"}
        <p class="ss-statpop-def">{STAT_INFO[pop.key] ?? ""}</p>
      {:else}
        {@const buckets = sourceBucketsFor(pop.key)}
        <div class="ss-statpop-head">Sources</div>
        {#each buckets as b (b.label)}
          <div class="ss-statpop-row">
            <span class="ss-statpop-src">{b.label}</span>
            <span class="ss-statpop-val" class:delta={b.delta}>{b.text}</span>
          </div>
        {/each}
        {#if buckets.length <= 1}
          <p class="ss-statpop-note">Nothing is modifying this stat yet: it reads at the bare-hull value.</p>
        {/if}
      {/if}
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
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .ss-header-br {
    font-size: var(--text-2xs);
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
    font-size: var(--text-lg);
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
    font-size: var(--text-sm);
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
    border-radius: var(--corner);
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
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-inset, rgba(0, 0, 0, 0.25));
    border: 1px solid var(--color-accent);
    border-radius: var(--corner);
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
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .ss-captain-name {
    font-size: var(--text-xs);
    color: var(--color-accent);
  }
  .ss-captain-name.ss-parked {
    color: var(--color-text-dim);
  }
  .ss-captain-spec {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .ss-portrait {
    flex: 0 0 44px;
    height: 44px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: calc(20px * var(--ui-scale));
    background: rgba(var(--color-accent-rgb), 0.04);
  }
  .ss-close {
    flex: 0 0 auto;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
    width: 30px;
    height: 30px;
    font-size: calc(14px * var(--ui-scale));
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
    font-size: var(--text-md);
    font-weight: 650;
    color: var(--color-danger);
  }
  .ss-repair-msg {
    font-size: var(--text-sm);
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
    border-radius: var(--corner);
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  /* The repair fill. ⚠️ --bar-step-seconds is the LIVE TICK LENGTH, published on documentElement by
     App.svelte, so this bar smooths on exactly the cadence its value updates on, like every other
     progress bar in the game. Reduced motion collapses the transition via app.css's blanket rule,
     which makes it STEP, matching the tick bar's behavior under the same setting. */
  .ss-repair-bar i {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--color-warning), var(--color-success));
    transition: width var(--bar-step-seconds, 0.2s) linear;
  }
  .ss-repair-eta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  .ss-repair-wait {
    flex: 1;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .ss-repair-btn {
    flex: 0 0 auto;
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
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
    font-size: var(--text-2xs);
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
    font-size: var(--text-3xs);
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
    font-size: var(--text-2xl);
    line-height: 1;
  }
  .ss-tile-il {
    font-size: var(--text-3xs);
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
    font-size: calc(20px * var(--ui-scale));
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
    font-size: calc(8px * var(--ui-scale));
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
    border-radius: var(--corner);
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
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
    text-align: center;
    line-height: 1.2;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ss-hp-q {
    font-size: var(--text-3xs);
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
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ss-slot-sub {
    font-size: var(--text-2xs);
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

  /* E-MOD EM-10: the POWER bar and the MODULES row (the signed-off mockup, section C), in the board's own tokens. */
  .ss-head-ic {
    display: inline-flex;
    margin-right: 6px;
    color: var(--color-accent);
    font-size: calc(13px * var(--ui-scale));
  }
  .ss-power-chip {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border: 1px solid rgba(52, 211, 153, 0.45);
    background: rgba(52, 211, 153, 0.1);
    color: var(--color-success);
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
    letter-spacing: 0.04em;
    text-transform: none;
    white-space: nowrap;
  }
  .ss-help-link {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 10px;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--text-3xs);
    letter-spacing: 0.04em;
    text-transform: none;
    color: var(--color-accent-bright);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .ss-power-chip.warn {
    border-color: rgba(var(--color-warning-rgb), 0.5);
    background: rgba(var(--color-warning-rgb), 0.12);
    color: var(--color-warning);
  }
  .ss-power-chip.ok {
    margin-left: 0;
  }
  .ss-power-num {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin-bottom: 6px;
  }
  .ss-pnum {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: calc(20px * var(--ui-scale));
    color: var(--color-text-primary);
  }
  .ss-power-unit {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .ss-pbar {
    position: relative;
    height: 16px;
    border: 1px solid var(--color-border);
    background: rgba(var(--color-accent-rgb), 0.08);
    border-radius: var(--corner);
    overflow: hidden;
  }
  .ss-pbar-used {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--color-accent);
    opacity: 0.75;
  }
  .ss-pbar.over .ss-pbar-used {
    background: var(--color-warning);
  }
  .ss-pbar-cut {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(135deg, var(--color-success) 0 3px, transparent 3px 7px);
    opacity: 0.7;
  }
  .ss-pbar-surplus {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(52, 211, 153, 0.18);
    border-left: 1px dashed var(--color-success);
  }
  .ss-pbar-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--color-text-primary);
  }
  .ss-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .ss-legend b {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .ss-power-note,
  .ss-power-surplus,
  .ss-mod-note,
  .ss-mod-set {
    margin: 6px 0 0;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .ss-power-surplus,
  .ss-mod-set {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .ss-power-warn {
    margin-top: 8px;
    padding: 8px 10px;
    border: 1px solid rgba(var(--color-warning-rgb), 0.45);
    background: rgba(var(--color-warning-rgb), 0.1);
    color: var(--color-text-secondary);
    font-size: var(--text-2xs);
    line-height: 1.45;
  }
  .ss-power-warn strong {
    color: var(--color-warning);
  }
  .ss-power-systems {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
    gap: 6px;
    margin-top: 8px;
  }
  .ss-power-systems > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 8px;
    border: 1px solid var(--color-border);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    min-width: 0;
  }
  .ss-power-sys-k {
    font-size: var(--text-3xs);
    color: var(--color-text-dim);
  }
  .ss-power-sys-v {
    overflow-wrap: anywhere;
  }
  .ss-power-sys-v b {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
  }
  .ss-mod-note {
    margin: 0 0 8px;
  }
  .ss-mod-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
    gap: 8px;
  }
  .ss-mod-tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    min-height: 112px;
    border: 1px solid var(--color-border);
    border-top: 2px solid var(--tc, var(--color-border));
    background: var(--color-panel-bg-strong);
    min-width: 0;
  }
  .ss-mod-tile.sel {
    border-color: var(--color-accent);
  }
  .ss-mod-tile.locked {
    opacity: 0.45;
  }
  .ss-mod-empty {
    border-style: dashed;
    border-top-width: 1px;
    background: none;
    color: var(--color-text-dim);
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .ss-mod-info {
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    display: grid;
    gap: 4px;
    width: 100%;
    min-width: 0;
  }
  .ss-mod-cat {
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-accent);
  }
  .ss-mod-glyph {
    display: inline-flex;
    color: var(--color-accent);
    font-size: calc(20px * var(--ui-scale));
    line-height: 1;
  }
  .ss-mod-name {
    font-weight: 650;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .ss-mod-empty .ss-mod-name {
    color: var(--color-text-secondary);
    font-weight: 500;
  }
  .ss-mod-sub {
    font-size: var(--text-3xs);
    color: var(--color-text-dim);
    overflow-wrap: anywhere;
  }
  .ss-mod-wear {
    display: block;
    height: 4px;
    background: rgba(var(--color-accent-rgb), 0.1);
    overflow: hidden;
  }
  .ss-mod-wear i {
    display: block;
    height: 100%;
    background: var(--color-success);
  }
  .ss-mod-tile .ss-slot-actions {
    margin-top: auto;
    flex-wrap: wrap;
  }
  .ss-mod-status {
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
    color: var(--color-text-secondary);
  }
  .ss-mod-status.bad {
    color: var(--color-danger);
  }
  .ss-compare-mod {
    display: grid;
    gap: 3px;
    margin: 6px 0 8px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    line-height: 1.4;
  }
  .ss-compare-mod-kind {
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-accent);
  }
  .ss-refuse {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 8px 0;
    padding: 8px 10px;
    border: 1px solid var(--color-danger);
    background: rgba(248, 113, 113, 0.08);
    color: var(--color-danger);
    font-size: var(--text-2xs);
    line-height: 1.4;
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
    font-size: var(--text-xs);
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
    font-size: calc(8px * var(--ui-scale));
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
    font-size: var(--text-xs);
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
    font-size: var(--text-2xs);
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
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-left: auto;
  }
  .ss-back {
    appearance: none;
    font: inherit;
    font-size: var(--text-xs);
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
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .ss-compare-br-tag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
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
    font-size: var(--text-sm);
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
    font-size: var(--text-2xs);
  }
  /* The compare's commit button: full-width so it reads as the primary action of the pane. */
  .ss-install-commit {
    width: 100%;
    padding: 8px 10px;
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-accent);
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.2);
  }
  .ss-cat-glyph {
    font-size: calc(14px * var(--ui-scale));
  }
  /* Small dim subtitle after a category name (e.g. Innate "the hull itself"). */
  .ss-cat-note {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    font-weight: 400;
  }
  .ss-cat-placeholder {
    font-size: var(--text-xs);
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
    font-size: var(--text-sm);
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
    font-size: var(--text-2xs);
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
    border-radius: var(--corner);
    margin-right: 5px;
  }

  /* 0.14.0 crew C-4c: the readout row's (i) definition affordance + the tappable stat VALUE.
     Both are native <button>s (keyboard-accessible + focusable for free, so no a11y role /
     tabindex / keydown needed), reset to sit inline in the .ss-srow layout. */
  .ss-info-btn {
    appearance: none;
    -webkit-appearance: none;
    background: none;
    border: none;
    padding: 0;
    margin-left: 5px;
    flex: 0 0 auto;
    font-size: var(--text-xs);
    line-height: 1;
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .ss-info-btn:hover,
  .ss-info-btn:focus-visible {
    color: var(--color-accent-bright);
  }
  /* The value button keeps the .ss-sv look (mono, right-aligned, primary) and adds a dotted
     underline hint that it is tappable (opens the source popover). */
  .ss-sv-btn {
    appearance: none;
    -webkit-appearance: none;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: underline dotted rgba(var(--color-accent-rgb), 0.55);
    text-underline-offset: 3px;
  }
  .ss-sv-btn:hover,
  .ss-sv-btn:focus-visible {
    color: var(--color-accent-bright);
  }

  /* STAT POPOVER: floats over the readout rows (position:fixed, JS-clamped, SAME recipe +
     containing-block dependency as .ss-tip-float below). NOT an inline accordion (explicit
     user correction). Opaque backing so nothing behind it bleeds through. */
  .ss-statpop {
    position: fixed;
    z-index: 61;
    width: 232px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    pointer-events: auto;
    background: var(--color-bg-deep);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
    padding: 10px 12px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  }
  .ss-statpop-def {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.45;
    color: var(--color-text-secondary);
  }
  .ss-statpop-head {
    font-size: var(--text-3xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    font-weight: 700;
    margin-bottom: 6px;
  }
  .ss-statpop-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--text-xs);
    padding: 2px 0;
  }
  .ss-statpop-src {
    color: var(--color-text-secondary);
  }
  .ss-statpop-val {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    white-space: nowrap;
  }
  .ss-statpop-val.delta {
    color: var(--color-accent-bright);
  }
  .ss-statpop-note {
    margin: 6px 0 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-style: italic;
    line-height: 1.4;
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
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: 8px 0 0;
    line-height: 1.4;
  }
  .ss-note-dim {
    color: var(--color-text-dim);
  }
  .ss-empty {
    padding: 20px 14px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
