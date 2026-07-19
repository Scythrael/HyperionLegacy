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

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here); `shipId` selects the ship
  // this panel is fitting. The three callbacks route every side-effect back to
  // the host so persistence + logging happen exactly once, in App.svelte.
  export let state: GameState;
  export let shipId: string;
  export let onInstall: (shipId: string, instanceId: string) => void;
  export let onUninstall: (shipId: string, slotType: EquipmentSlotType) => void;
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
    { slotType: "cockpit", code: "COK", label: "Cockpit", live: false, top: 24, left: 50 },
    { slotType: "quarters", code: "QTR", label: "Crew Quarters", live: false, top: 25, left: 32 },
    { slotType: "thrusters", code: "THR", label: "Thrusters", live: false, top: 25, left: 68 },
    { slotType: "cargoBay", code: "CRG", label: "Cargo Bay", live: true, top: 41, left: 50 },
    // FLANK ROW across the engineering hull + nacelles (far left -> far right):
    { slotType: "shieldEmitters", code: "SHD", label: "Shield Emitters", live: false, top: 59, left: 13 },
    { slotType: "propellantTanks", code: "PRP", label: "Propellant Tanks", live: false, top: 59, left: 35 },
    { slotType: "reactorCore", code: "RCT", label: "Reactor Core", live: true, top: 59, left: 50 },
    { slotType: "specUtility", code: "SUS", label: "Spec Utility", live: true, prospectorOnly: true, top: 59, left: 65 },
    { slotType: "hullPlating", code: "HUL", label: "Hull Plating", live: false, top: 59, left: 87 },
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
  // The currently opened slot (its install/uninstall control is shown), or null.
  let selectedSlot: string | null = null;

  // Reset the open slot whenever the panel switches to a different ship, so a
  // stale selection from the previous ship never carries over. Guarded on a
  // change of `shipId` only (not a general reactive) so it cannot loop.
  let lastShipId: string | null = null;
  $: if (shipId !== lastShipId) {
    lastShipId = shipId;
    selectedSlot = null;
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

  // The slots actually shown for THIS hull (drops specUtility on non-Prospectors).
  $: visibleSlots = SLOT_LAYOUT.filter((s) => !s.prospectorOnly || isProspectorHull);

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

  // The Defensive-section rows (INERT 0.12.0 placeholders). No equipment folds
  // into these this patch, so base == fitted; we just print the hull base value.
  $: defensiveRows = shipDef
    ? [
        { label: "Hull Integrity", value: shipDef.hullIntegrity },
        { label: "Shield Capacity", value: shipDef.shieldCapacity },
        { label: "Shield Recharge Rate", value: shipDef.shieldRecharge },
      ]
    : [];

  // Reserved bottom-bar counts, capped at 7 empty display slots each.
  $: weaponCount = shipDef ? Math.min(7, shipDef.weaponHardpoints) : 0;
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
        return "captain is on a mission (fitment locked)";
      case "hullSpec":
        return "wrong hull type for this system";
      case "captainSpec":
        return "captain specialization does not match";
      case "captainSpecParked":
        return "assign a matching captain first (hull is parked)";
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

  // --- Interaction ------------------------------------------------------------
  // Clicking a slot toggles its control open/closed. Reserved slots still open
  // (to show their "reserved" note), so the click target is consistent.
  function selectSlot(meta: SlotMeta): void {
    selectedSlot = selectedSlot === meta.slotType ? null : meta.slotType;
  }
  function handleInstall(instanceId: string): void {
    onInstall(shipId, instanceId);
  }
  function handleUninstall(slotType: EquipmentSlotType): void {
    onUninstall(shipId, slotType);
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
              {#if onMission}· on mission (fitment locked){/if}
            </div>
          {:else}
            <div class="ss-captain-name ss-parked">Unassigned / Parked</div>
          {/if}
        </div>
        <div class="ss-portrait" aria-hidden="true">{assignedCaptain ? "🧑‍🚀" : "⚓"}</div>
      </div>
      <button class="ss-close" on:click={onClose} aria-label="Close Ship Systems">✕</button>
    </header>

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

        <!-- Selected-slot control: install / uninstall for a live slot, or the
             reserved note for a 0.12.0 slot. Nothing shown until a slot is
             tapped, keeping the graphic uncluttered by default. -->
        {#if selectedMeta}
          <div class="ss-control">
            <div class="ss-control-title">{selectedMeta.label}</div>

            {#if !selectedMeta.live}
              <p class="ss-note">Reserved for the 0.12.0 combat update. No system to install yet.</p>
            {:else}
              <!-- Currently installed system (if any) + Uninstall. -->
              {#if selectedFitted}
                <div class="ss-fitted-row">
                  <div class="ss-fitted-info">
                    <div class="ss-fitted-name">{pieceDesc(selectedFitted)}</div>
                    <div class="ss-fitted-sub">{pieceSubline(selectedFitted)}</div>
                  </div>
                  <button
                    class="ss-btn ss-btn-uninstall"
                    disabled={onMission}
                    title={onMission ? "Recall the captain first, fitment is locked on mission" : undefined}
                    on:click={() => handleUninstall(selectedMeta.slotType)}
                  >
                    Uninstall
                  </button>
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
        {:else}
          <p class="ss-note ss-note-dim ss-control-hint">Tap a slot on the hull to install or uninstall a system.</p>
        {/if}
      </div>

      <!-- RIGHT: the scrollable, categorized stats panel. -->
      <div class="ss-stats-col">
        <div class="ss-stats-section-title">SHIP STATS</div>
        <div class="ss-stats-head">
          <span class="ss-stats-head-label"></span>
          <span class="ss-stats-head-col">Base</span>
          <span class="ss-stats-head-col">Fitted</span>
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

        <!-- Defensive section: exists from day one, but explicitly PENDING the
             0.12.0 combat update (inert placeholders, not broken). -->
        <div class="ss-stats-section-title ss-defensive-title">
          DEFENSIVE
          <span class="ss-pending-badge">pending combat · 0.12.0</span>
        </div>
        {#each defensiveRows as row (row.label)}
          <div class="ss-stat-row">
            <span class="ss-stat-label">{row.label}</span>
            <span class="ss-stat-val ss-stat-inert">{fmtFlat(row.value)}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- BOTTOM BAR: reserved weapon + module rows (empty this patch, 0.12.0). -->
    <div class="ss-bottom">
      <div class="ss-bottom-row">
        <span class="ss-bottom-label">WEAPONS</span>
        <div class="ss-bottom-slots">
          {#each Array.from({ length: weaponCount }) as _, wi}
            <span class="ss-hardpoint" title="Weapon hardpoint, reserved for 0.12.0">✦</span>
          {/each}
          {#if weaponCount === 0}
            <span class="ss-note ss-note-dim">none on this hull</span>
          {/if}
        </div>
      </div>
      <div class="ss-bottom-row">
        <span class="ss-bottom-label">MODULES</span>
        <div class="ss-bottom-slots">
          {#each Array.from({ length: moduleCount }) as _, mi}
            <span class="ss-hardpoint ss-module" title="Module slot, reserved for 0.12.0">◇</span>
          {/each}
          {#if moduleCount === 0}
            <span class="ss-note ss-note-dim">none on this hull</span>
          {/if}
        </div>
      </div>
      <div class="ss-bottom-note">Weapons and modules are reserved for the 0.12.0 combat update. Count varies by hull.</div>
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
  .ss-fitted-row,
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
  .ss-pending-badge {
    font-size: 9px;
    color: var(--color-text-dim);
    text-transform: none;
    letter-spacing: 0;
    font-style: italic;
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
  /* Inert defensive value: spans the base/fitted/delta columns, dimmed to read
     as "not live yet". (colspan is not valid on a span; the flex-grow here does
     the visual spanning.) */
  .ss-stat-inert {
    flex: 0 0 auto;
    min-width: 192px;
    color: var(--color-text-dim);
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
