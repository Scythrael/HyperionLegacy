<script lang="ts">
  // ============================================================================
  // ComplementPanel.svelte
  // Author: Claude (Opus 4.8) | Crew 0.14.0 phase 4b (Complement UI)
  //
  // The player-facing COMPLEMENT screen for ONE selected ship, the "Complement" sub-tab of
  // the ship-detail page (sibling to the Loadout board / ShipSystemsPanel and the Senior Staff
  // pane). It mirrors SeniorStaffPanel's posture exactly:
  //   - PURE PRESENTATION. It READS live state through the already-tested crew engine
  //     (commandStructure.ts caps, crewModules.ts quarters bonus, the ship's complement buckets)
  //     and never reimplements game logic. The ONE side effect it can trigger, the Auto-crew
  //     toggle, bubbles UP to the host (App.svelte) via onSetMode, which flips
  //     ship.complement.mode + doSave in one place. When the host reassigns `state`, every
  //     derived value below recomputes.
  //   - RESPONSIVE via CSS CONTAINER-QUERIES ONLY (the ShipSystemsPanel / SeniorStaffPanel way):
  //     ONE shared DOM tree. The division grid is a multi-column auto-fit grid keyed off the
  //     panel's OWN width (container-type: inline-size), collapsing to one column when the
  //     container is narrow. There is NO isMobile JS branch and no duplicated markup.
  //
  // THE DIVISION CHART (per the plan's "Complement graph overhaul" spec + the approved mockup's
  // renderDivisionChart / utilFill): a DOUBLE-LAYER CLAMPED bar chart per division. Ranks run
  // HIGH -> LOW left to right (Lt Cmdr .. Petty Officer) then the uncapped Crewman. Each rank is
  // a GRAY cap bar (the rank's allocation ceiling) behind a colored UTILIZATION bar (current/cap)
  // whose hue tracks the fill (0% red -> 60% yellow -> 100% green) with a light->dark vertical
  // fade. The Y-axis is CLAMPED to just above the largest finite cap; the uncapped Crewman bar
  // sits just above it and the axis reads "N+". A single hover/tap zone spans the whole rank
  // column (a wide, finger-sized target) and reveals a tooltip. The GRAPH PALETTE is deliberately
  // its OWN hsl scale, NOT the console theme tokens (the spec: graphs are separately colorable).
  //
  // SCOPE (phase 4b): the capacity header + auto-crew toggle, the 6-division chart grid, and the
  // Notable Crew strip. Rosters / prestige / stats are OTHER phases.
  //
  // CP-9 (0.14.0, signed mockup docs/mockups/2026-11-02-cp9-complement-manifest-mockup.html, user picks 2026-11-02):
  // the CREW GROUPS table under the charts (one row per bucket; sort and division filter as chips; every buff as its
  // own chip; row tick boxes with a selection bar; "Graduate one" on each row), the Graduate confirm (the engine's
  // preview of the name), "Send back" on each notable card, and the read-only paged MANIFEST. Still one DOM: the rows
  // become cards and the selection bar sticks to the bottom when the panel is phone-narrow (container queries). Every
  // decision lives in complementTableDisplay.ts (tested); graduate and send back route to App.svelte.
  //
  // CP-10 (signed mockup docs/mockups/2026-11-02-cp10-transfer-picker-mockup.html): the table and the manifest moved
  // into CrewGroupsTable.svelte and CrewManifestModal.svelte (shared with the crew pool tab); "Transfer N selected..."
  // opens CrewTransferModal.svelte (greyed with the words only while the ship is crew-locked; an auto-crew ship opens
  // on the "Switch to manual" line); the lock line reads "crew changes are locked" and the toggle says "paused while out".
  // ============================================================================

  import Toggle from "./Toggle.svelte";
  import type { GameState, CrewProfession, CrewRank } from "./game/model";
  import { SHIP_TYPES } from "./game/model";
  import {
    CREW_PROFESSIONS,
    complementOverCap,
    type ComplementOverCap,
    complementTotalCap,
    divisionCap,
    rankAllocation,
  } from "./game/commandStructure";
  import { notableSignature } from "./game/crew";
  import { crewRankLabel } from "./game/crewRank";
  import { quartersCapacityBonus, installedQuartersModule } from "./game/crewModules";
  import { CREW_RACES } from "./game/crewRaces";
  import { canSetComplementMode, crewLockReason, crewLockReasonText, crewLockUntilText } from "./game/crewLock";
  import Icon from "./ui/Icon.svelte";
  import ActionModal from "./ActionModal.svelte";
  import { NOTABLE_CREW_CAP, shipDisplayLabel } from "./game/model";
  import { canGraduate, canRetireNotable, canSendBackNotable, graduateGateText, nextGraduateIdentity, retireGateText, sendBackGateText } from "./game/crewGraduation";
  import { marquee } from "./ui/marquee";
  import { DIVISION_LABEL, buffChips, crewGroupRows } from "./complementTableDisplay";
  import CrewGroupsTable from "./CrewGroupsTable.svelte";
  import CrewManifestModal from "./CrewManifestModal.svelte";
  import CrewTransferModal from "./CrewTransferModal.svelte";
  import type { CrewTransferEndpoint, CrewTransferPick, CrewTransferResult } from "./game/crewTransfer";
  import { transferSourceBlock } from "./crewTransferDisplay";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here); `shipId` selects the ship whose complement
  // this panel presents. onSetMode routes the auto-crew toggle back to the host so persistence
  // happens exactly once, in App.svelte (mirrors SeniorStaffPanel's callbacks).
  export let state: GameState;
  export let shipId: string;
  // Flip this ship's complement.mode: "passive" (auto-crew fills on the tick) or "active"
  // (player-curated). The host runs doSetComplementMode (state = next; doSave()).
  export let onSetMode: (shipId: string, mode: "passive" | "active") => void;
  // Toggle a notable crew member's `favorite` curation flag (host: toggleNotableFavorite + doSave).
  // Cosmetic: it drives sorting/pinning affordances + the roster builder, nothing mechanical.
  export let onToggleFavorite: (notableId: string) => void;
  // CP-9: graduate one crew member of a group (host: doGraduate, crewGraduation.ts graduateStandout + doSave). Returns
  // the new notable's id, or null when the engine refused.
  export let onGraduate: (shipId: string, signatureKey: string) => string | null;
  // CP-9 (OC-9): send a notable back (host: doSendBackNotable, crewGraduation.ts sendBackNotable + doSave).
  export let onSendBack: (notableId: string) => void;
  // CP-9 (user call 2026-11-02 "Allow Retire"): retire a notable after the confirm (host: doRetireNotable,
  // crewGraduation.ts retireNotable + doSave).
  export let onRetire: (notableId: string) => void = () => {};
  // CP-10: move crew between this ship and the pool or another ship (host: doTransferCrew, crewTransfer.ts
  // transferCrew + doSave + pushLog). Returns the engine's result for the picker's row-by-row report.
  export let onTransfer: (from: CrewTransferEndpoint, to: CrewTransferEndpoint, picks: CrewTransferPick[]) => CrewTransferResult | null = () => null;
  // The game's Reduce motion setting (the one the backgrounds use): the notable strip stays still while it is on.
  export let reducedMotion = false;

  // --- Static display metadata ------------------------------------------------
  // Division display labels (US English): complementTableDisplay.ts DIVISION_LABEL, shared with the table.

  // Compact single-line x-axis abbreviations per rank (never wrap; the full name is in the
  // tooltip). Rank 8 (Lt Cmdr) .. rank 1 (Crewman).
  const RANK_ABBR: Record<CrewRank, string> = {
    8: "LtC",
    7: "Lt",
    6: "En",
    5: "Cd",
    4: "MC",
    3: "Ch",
    2: "PO",
    1: "Crew",
  };

  // The chart's column order: the seven FINITE-capped ranks HIGH -> LOW, then Crewman (uncapped).
  const FINITE_RANKS: CrewRank[] = [8, 7, 6, 5, 4, 3, 2];
  const CREWMAN_RANK: CrewRank = 1;

  // --- Derived reads ----------------------------------------------------------
  $: ship = state.ships.find((s) => s.id === shipId) ?? null;
  $: hullType = ship?.typeKey ?? null;
  // The live complement (buckets + mode). A fresh ship may have none yet; treat it as empty/passive.
  $: complement = ship?.complement ?? { buckets: [], mode: "passive" as const };
  $: autoCrewOn = complement.mode === "passive";
  // CP-6: the one crew lock. While this ship is out (a captain mission, or an expedition until it is
  // claimed) the Auto-crew toggle is disabled with the reason shown (crewLock.ts canSetComplementMode
  // refuses the same switch). Favorites stay live.
  $: lockReason = ship ? crewLockReason(state, shipId) : null;
  $: lockText = lockReason === null ? null : crewLockReasonText(lockReason);
  $: modeGate = ship ? canSetComplementMode(state, shipId, autoCrewOn ? "active" : "passive") : null;
  $: modeLocked = modeGate !== null && !modeGate.ok && modeGate.reason === "onMission";

  // CP-5 (OC-6 "Never evict"): the ship's OCCUPANCY, the bulk plus every notable assigned here: the count every cap
  // gate (auto-crew, transfer, rosters) and complementOverCap read, so every number below matches the gate.
  $: occupancy = [
    ...complement.buckets,
    ...state.notableCrew.filter((n) => (n.assignedShipId ?? null) === shipId).map((n) => ({ ...notableSignature(n), count: 1 })),
  ];

  // Per-(division,rank) headcount from the occupancy (CP-5 review: notables count, as the gates count them),
  // precomputed as a real reactive so the chart's dependency on `state` is visible to the compiler (reading it inline
  // would hide it and go stale after a mode flip / tick).
  $: countByKey = (() => {
    const map = new Map<string, number>();
    for (const b of occupancy) {
      const key = `${b.profession}:${b.rank}`;
      map.set(key, (map.get(key) ?? 0) + b.count);
    }
    return map;
  })();
  function headcount(profession: CrewProfession, rank: CrewRank): number {
    return countByKey.get(`${profession}:${rank}`) ?? 0;
  }

  // --- Capacity header --------------------------------------------------------
  // Total berths = the hull's LOCKED base cap (commandStructure) + the installed quarters module's
  // capacity bonus (0 with no module). used = the occupancy across every division (bulk plus notables aboard, the
  // count the add gates read; CP-5 review: 234 bulk + 1 notable Medical on the Eir reads 235 / 234).
  $: baseCap = hullType ? complementTotalCap(hullType, 0) : 0;
  $: moduleBonus = ship ? quartersCapacityBonus(state, ship) : 0;
  $: totalCap = baseCap + moduleBonus;
  $: usedBerths = occupancy.reduce((sum, b) => sum + b.count, 0);
  $: capFillPct = totalCap > 0 ? Math.min(100, Math.round((usedBerths / totalCap) * 100)) : 0;
  // The installed quarters module (for the "Base N + <module> +M" contribution line).
  $: quartersModule = ship ? installedQuartersModule(state, ship) : null;

  // CP-5: the hull's display name for the berths line (the physical limit).
  $: hullLabel = hullType ? SHIP_TYPES[hullType].label : "";
  // CP-9: the ship's display name (the Graduate confirm and the Manifest title).
  $: shipName = ship ? shipDisplayLabel(state, ship) : "";

  // Whether this ship has any complement at all (a fresh ship's crew arrives via transports).
  $: isEmpty = usedBerths === 0;

  // CP-5 (OC-6 "Never evict"): how far the ship sits over its caps, read on the same occupancy the fill uses (the bulk
  // plus every notable assigned here). Nothing removes crew for being over; the fill just takes no more.
  $: overCap = hullType ? complementOverCap(occupancy, hullType, moduleBonus) : null;
  $: notablesAboard = occupancy.length - complement.buckets.length;

  // --- The double-layer clamped division charts -------------------------------
  // One column's resolved geometry: heights are % of the clamped axis; `fill` is the graph-palette
  // utilization gradient; `uncapped` marks the Crewman column (drawn with the striped cap layer).
  interface ChartColumn {
    rank: CrewRank;
    abbr: string;
    name: string;
    cur: number;
    cap: number; // the finite allocation ceiling (0 for the uncapped Crewman column)
    uncapped: boolean;
    capH: number; // cap-layer height, % of axis
    curH: number; // utilization-layer height, % of axis
    pct: number; // utilization fraction 0..1 (drives the hue)
    fill: string; // the utilization gradient (graph palette)
  }
  interface DivisionChart {
    profession: CrewProfession;
    label: string;
    total: number; // headcount in the division (all ranks)
    cap: number; // the division's total cap
    over: number; // CP-5: crew over the division's caps (its cap, or a rank cap); 0 when within
    overText: string | null; // CP-5: the over-cap explanation, null when within
    axisMax: number; // the clamped axis ceiling (label "N+")
    columns: ChartColumn[];
  }

  // The graph UTILIZATION color: hue 0 (red) -> 60 (yellow) -> 120 (green) by fill %, with a
  // VERTICAL light->dark fade tinted to that hue. Graph palette, deliberately separate from the
  // console theme (per the spec). pct is clamped to [0,1].
  function utilFill(pct: number): string {
    const h = Math.max(0, Math.min(1, pct)) * 120;
    return `linear-gradient(180deg, hsl(${h}, 80%, 62%), hsla(${h}, 72%, 42%, 0.4))`;
  }

  // Build one division's chart. axisMax clamps to just above the largest FINITE cap so the officer
  // ranks stay legible; the uncapped Crewman is clamped to the axis top and labeled "N+".
  function buildDivision(profession: CrewProfession, hull: NonNullable<typeof hullType>, bonus: number, oc: ComplementOverCap | null): DivisionChart {
    const finiteCaps = FINITE_RANKS.map((r) => rankAllocation(hull, profession, r, bonus));
    const axisMax = Math.max(1, Math.max(...finiteCaps) + 1);

    const columns: ChartColumn[] = FINITE_RANKS.map((rank, i) => {
      const cap = finiteCaps[i];
      const cur = headcount(profession, rank);
      const pct = cap > 0 ? cur / cap : 0;
      return {
        rank,
        abbr: RANK_ABBR[rank],
        name: crewRankLabel(rank),
        cur,
        cap,
        uncapped: false,
        capH: Math.min(100, Math.round((cap / axisMax) * 100)),
        curH: Math.min(100, Math.round((cur / axisMax) * 100)),
        pct,
        fill: utilFill(pct),
      };
    });

    // Crewman: uncapped. The bar is clamped to the axis top; its fill fraction reflects how full it
    // is relative to the clamped axis, so a fully-crewed ship reads green "N+" and a sparse/empty
    // one scales down (and shows nothing at zero) instead of always reading full.
    const crewCur = headcount(profession, CREWMAN_RANK);
    const crewFrac = Math.max(0, Math.min(1, crewCur / axisMax));
    columns.push({
      rank: CREWMAN_RANK,
      abbr: RANK_ABBR[CREWMAN_RANK],
      name: crewRankLabel(CREWMAN_RANK),
      cur: crewCur,
      cap: 0,
      uncapped: true,
      capH: 100,
      curH: Math.round(crewFrac * 100),
      pct: crewFrac,
      fill: utilFill(crewFrac),
    });

    const total = columns.reduce((sum, c) => sum + c.cur, 0);
    const over = oc?.divisions[profession] ?? 0;
    return {
      profession,
      label: DIVISION_LABEL[profession],
      total,
      cap: divisionCap(hull, profession, bonus),
      over,
      overText: divisionOverText(profession, over, oc?.divisionOver[profession] ?? 0),
      axisMax,
      columns,
    };
  }

  // CP-5 (OC-6): the over-cap line under a division's header. A division past its own cap takes no more crew at all;
  // one past a rank cap takes none at that rank or higher (lower ranks still fill).
  function divisionOverText(profession: CrewProfession, over: number, overDivision: number): string | null {
    if (over <= 0) return null;
    const crew = over === 1 ? "1 crewmember" : `${over} crew`;
    return overDivision > 0
      ? `Over cap by ${crew}. No one is removed; ${DIVISION_LABEL[profession]} takes no new crew until it is back under its cap.`
      : `Over a rank cap by ${crew}: more senior crew than its rank caps allow. No one is removed; it takes no new crew at those ranks until they are back under.`;
  }

  // NOTE the explicit `countByKey` reference: `buildDivision` reads headcount/countByKey inside a
  // function, which Svelte's `$:` dependency tracking does NOT see, so without naming countByKey here
  // `divisions` would only recompute when `hullType` changes (never, for a given ship) and the charts
  // would stay stale as crew arrive. Referencing countByKey (always a truthy Map) makes the dep visible.
  $: divisions = hullType && countByKey
    ? CREW_PROFESSIONS.map((p) => buildDivision(p, hullType as NonNullable<typeof hullType>, moduleBonus, overCap))
    : [];

  // --- Notable crew (assigned to this ship) -----------------------------------
  // The bounded named standouts the player graduated and assigned here. buff1's catalog label is a
  // compact one-liner. raceLabel / rankLabel resolve the signature to display strings.
  $: shipNotables = state.notableCrew.filter((n) => (n.assignedShipId ?? null) === shipId);
  function raceLabel(race: string): string {
    return CREW_RACES[race as keyof typeof CREW_RACES]?.label ?? race;
  }
  // CP-9: the fleet's notable count against the cap (assigned or not, the count canGraduate gates on).
  $: fleetNotables = state.notableCrew.length;

  // --- CP-9: the crew groups table (CrewGroupsTable.svelte owns the sort, filter and paging) ----------------
  let selected = new Set<string>();
  // The notable this panel just graduated: its card reads "just graduated" until the player opens another ship.
  let justGraduatedId: string | null = null;
  let graduateKey: string | null = null;
  let manifestOpen = false;
  // CP-10: the transfer picker, open on the groups picked when it opened.
  let transferKeys: string[] | null = null;
  // Reset the view when the player opens another ship (the table resets itself on its resetKey).
  let viewShipId = shipId;
  $: if (shipId !== viewShipId) {
    viewShipId = shipId;
    selected = new Set();
    justGraduatedId = null;
    graduateKey = null;
    manifestOpen = false;
    retireId = null;
    transferKeys = null;
  }

  $: groupRows = crewGroupRows(complement.buckets);

  // --- CP-10: Transfer (the selection bar's "Transfer N selected...") -------------------------------------------
  // A crew-locked ship cannot give (the button stays greyed with the words, mockup section 4); an auto-crew ship opens
  // the picker on its "Switch to manual" line (OC-7), so only the lock disables the button.
  $: sourceBlock = ship ? transferSourceBlock(state, shipId) : null;
  $: transferLockText = sourceBlock !== null && sourceBlock.kind === "locked" ? sourceBlock.text : null;
  function openTransfer(): void {
    const keys = groupRows.filter((r) => selected.has(r.key)).map((r) => r.key);
    if (keys.length > 0) transferKeys = keys;
  }
  function closeTransfer(moved: boolean): void {
    transferKeys = null;
    if (moved) selected = new Set();
  }
  // The player text of a row's Graduate gate (undefined when it is open).
  function graduateTitle(key: string, s: GameState): string | undefined {
    return graduateGateText(s, shipId, canGraduate(s, shipId, key));
  }

  // --- CP-9: the Graduate confirm -------------------------------------------------
  $: graduateRow = graduateKey === null ? null : (groupRows.find((r) => r.key === graduateKey) ?? null);
  $: graduateGate = graduateKey === null ? null : canGraduate(state, shipId, graduateKey);
  $: graduateBlock = graduateKey === null || graduateGate === null ? undefined : graduateGateText(state, shipId, graduateGate);
  $: graduateName = graduateRow === null ? "" : nextGraduateIdentity(state, graduateRow.sig).name;
  function confirmGraduate(): void {
    if (graduateKey === null) return;
    const id = onGraduate(shipId, graduateKey);
    if (id !== null) justGraduatedId = id;
    graduateKey = null;
  }

  // --- CP-9: send back -------------------------------------------------------------
  const SEND_BACK_TITLE = "Unassign from this ship. They keep their name, and a Personnel roster can assign them to a ship again.";
  function sendBackTitle(id: string, s: GameState): string {
    return sendBackGateText(s, id, canSendBackNotable(s, id)) ?? SEND_BACK_TITLE;
  }

  // --- CP-9: retire (the confirm) ---------------------------------------------------
  let retireId: string | null = null;
  $: retireTarget = retireId === null ? null : (state.notableCrew.find((n) => n.id === retireId) ?? null);
  $: retireBlock = retireId === null ? undefined : retireGateText(state, retireId, canRetireNotable(state, retireId));
  const RETIRE_TITLE = "Retire from the fleet with your thanks. No penalty, and it frees a notable slot.";
  function retireTitle(id: string, s: GameState): string {
    return retireGateText(s, id, canRetireNotable(s, id)) ?? RETIRE_TITLE;
  }
  function confirmRetire(): void {
    if (retireId === null) return;
    onRetire(retireId);
    retireId = null;
  }

  // --- CP-9: the manifest (read-only, one paged list; CrewManifestModal.svelte) ----------------------------
  function openManifest(): void {
    manifestOpen = true;
  }

  // --- Actions ----------------------------------------------------------------
  function onAutoCrewChange(next: boolean): void {
    // Toggle ON == passive (auto-crew fills), OFF == active (player-curated).
    onSetMode(shipId, next ? "passive" : "active");
  }
</script>

<div class="comp">
  {#if ship === null || hullType === null}
    <div class="comp-empty-hint">Ship not found.</div>
  {:else}
    <!-- CAPACITY HEADER: used / total berths, a thin fill bar, and the auto-crew toggle. -->
    <div class="comp-cap">
      <div class="comp-caprow">
        <div class="comp-capnums">
          <span class="comp-bignum">{usedBerths}<span class="comp-of"> / {totalCap} berths</span></span>
          {#if quartersModule}
            <span class="comp-modline">
              Base {baseCap} + {quartersModule.def.label} +{moduleBonus}
            </span>
          {/if}
        </div>
        <label class="comp-autoc" title={modeLocked && lockText !== null ? `${lockText}: the Auto-crew setting is locked` : undefined}>
          <span class="comp-autoc-label">Auto-crew{#if lockReason !== null && autoCrewOn}<span class="comp-paused"> (paused while out)</span>{/if}</span>
          <Toggle
            checked={autoCrewOn}
            disabled={modeLocked}
            label="Auto-crew this ship"
            on:change={(e) => onAutoCrewChange(e.detail)}
          />
        </label>
      </div>
      <div class="comp-bar"><span style="width:{capFillPct}%"></span></div>
      {#if lockReason !== null}
        <p class="comp-lock" role="note">
          <Icon name="lock" /> {lockText}: crew changes are locked {crewLockUntilText(lockReason)}. Favorites and the Manifest still work.
        </p>
      {/if}
      <div class="comp-mode-note">
        {autoCrewOn
          ? "Auto-crew fills this ship top-rank-down from the pool, within its caps."
          : "Manual: this ship's complement is player-curated and will not auto-fill."}
        The {hullLabel} has berths for {baseCap} crew before any quarters module.
      </div>
      {#if overCap !== null && overCap.any}
        <!-- CP-5 (OC-6 "Never evict"): the over-cap state, explained. -->
        <p class="comp-over" role="note">
          {#if overCap.totalOver > 0}
            Over capacity by {overCap.totalOver}: this ship holds more crew than its {totalCap} berths{notablesAboard > 0 ? " (its notable crew count too)" : ""}.
          {:else}
            Some divisions are over their caps (marked below).
          {/if}
          No one is removed, and it takes no new crew where it is over until it is back under. This happens when a quarters
          module comes off or is swapped for one with fewer berths.
        </p>
      {/if}
    </div>

    <!-- DIVISION GRID: one double-layer clamped chart per division. -->
    <div class="comp-section-tag">
      <span>Division Ranks</span>
      <span class="comp-section-hint">tap or hover a bar for rank detail</span>
    </div>
    <div class="comp-divgrid">
      {#each divisions as d (d.profession)}
        <div class="comp-div" class:is-over={d.over > 0}>
          <div class="comp-dvh">
            <span class="comp-dv-name">{d.label}</span>
            {#if d.over > 0}<span class="comp-dv-over">Over cap</span>{/if}
            <span class="comp-dv-count">{d.total}<span class="comp-of"> / {d.cap} cap</span></span>
          </div>
          {#if d.overText !== null}<p class="comp-dv-overnote">{d.overText}</p>{/if}
          <div class="comp-chart">
            <div class="comp-yaxis">
              <span>{d.axisMax}+</span>
              <span>{Math.round(d.axisMax / 2)}</span>
              <span>0</span>
            </div>
            {#each d.columns as col (col.rank)}
              <div
                class="comp-colwrap"
                tabindex="0"
                role="button"
                aria-label={col.uncapped
                  ? `${col.name}: ${col.cur} assigned, uncapped`
                  : `${col.name}: ${col.cur} of ${col.cap} assigned, ${Math.round(col.pct * 100)}% utilization`}
              >
                <div class="comp-btip" role="tooltip">
                  <div class="comp-bt-r">{col.name}</div>
                  <div class="comp-bt-row"><span>Assigned</span><b>{col.cur}</b></div>
                  <div class="comp-bt-row">
                    <span>Capacity</span><b>{col.uncapped ? "uncapped" : col.cap}</b>
                  </div>
                  <div class="comp-bt-row">
                    <span>{col.uncapped ? "Shown as" : "Utilization"}</span>
                    <b>{col.uncapped ? `${d.axisMax}+` : `${Math.round(col.pct * 100)}%`}</b>
                  </div>
                </div>
                <div class="comp-track">
                  <div
                    class="comp-capbar"
                    class:uncapped={col.uncapped}
                    style="height:{col.capH}%"
                  ></div>
                  <div class="comp-utilbar" style="height:{col.curH}%; background:{col.fill}"></div>
                </div>
                <div class="comp-xlab">{col.abbr}</div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- GRAPH KEY (graph palette, separate from the console theme). -->
    <div class="comp-gkey">
      <span><i class="comp-swatch cap"></i> Rank cap</span>
      <span><i class="comp-swatch util"></i> Utilization (low to full)</span>
      <span>Crewmen uncapped, axis reads "N+"</span>
    </div>

    {#if isEmpty}
      <div class="comp-empty-hint comp-empty-block">
        This ship's berths are empty. Crew arrives via transports over time; the caps above show
        where they will settle.
      </div>
    {/if}

    <!-- CP-9: CREW GROUPS. One row per bucket (crew with the same origin, division, rank, rarity and buffs). -->
    {#if usedBerths > 0}
      <div class="comp-groups">
        <div class="comp-section-tag">
          <span>Crew Groups</span>
          <span class="comp-section-hint cg-hint-wide">crew with the same origin, division, rank, rarity and buffs travel together</span>
          <span class="comp-section-hint cg-hint-narrow">{groupRows.length}</span>
        </div>
        <CrewGroupsTable
          rows={groupRows}
          bind:selected
          resetKey={shipId}
          ariaLabel="Crew groups"
          footTail={`${usedBerths} crew aboard${notablesAboard > 0 ? ` (${notablesAboard} notable)` : ""}`}
          emptyText="Every crew member aboard is a notable."
        >
          <button slot="tools" type="button" class="cg-btn ghost cg-manifest" on:click={openManifest}><Icon name="manifest" size={14} /> Manifest</button>
          <svelte:fragment slot="act" let:row let:isSelected>
            <button
              type="button"
              class="cg-btn sm"
              class:ghost={!isSelected}
              disabled={graduateTitle(row.key, state) !== undefined}
              title={graduateTitle(row.key, state) ?? "Make one crew member of this group a named notable"}
              on:click={() => (graduateKey = row.key)}
            ><Icon name="graduate" size={14} /> Graduate one</button>
          </svelte:fragment>
          <svelte:fragment slot="selbar" let:selection>
            <button
              type="button"
              class="cg-btn sm"
              disabled={transferLockText !== null}
              title={transferLockText ?? "Move the picked crew to the crew pool or another ship"}
              on:click={openTransfer}
            ><Icon name="transfer" size={14} /><span>Transfer<span class="cg-wide-only">{` ${selection.crew.toLocaleString("en-US")} selected`}</span>...</span></button>
          </svelte:fragment>
        </CrewGroupsTable>
      </div>
    {/if}

    <!-- NOTABLE CREW: the assigned standouts, every buff shown (CP-9), with Send back (OC-9). -->
    <div class="comp-notable">
      <div class="comp-section-tag">
        <span>Notable Crew</span>
        <span class="comp-section-hint">standouts assigned here · fleet {fleetNotables} / {NOTABLE_CREW_CAP}</span>
      </div>
      {#if shipNotables.length === 0}
        <div class="comp-empty-hint">
          No notable crew assigned to this ship yet. Use "Graduate one" on a crew group to name a standout; they stay
          aboard this ship.
        </div>
      {:else}
        <div class="comp-nstrip" use:marquee={{ still: reducedMotion, key: shipNotables.length }}>
          {#each shipNotables as n (n.id)}
            {@const sendGate = canSendBackNotable(state, n.id)}
            <div class="comp-ncard" class:new={justGraduatedId === n.id}>
              <div class="comp-nc-name">
                <span class="comp-nc-nm">{n.name}</span>
                <button
                  type="button"
                  class="comp-nc-fav"
                  class:on={n.favorite}
                  aria-label="Toggle favorite"
                  aria-pressed={n.favorite === true}
                  title={n.favorite ? "Favorited" : "Favorite this crew member"}
                  on:click={() => onToggleFavorite(n.id)}
                ><Icon name="star" size={13} /></button>
              </div>
              <div class="comp-nc-sub">
                {crewRankLabel(n.rank)} · {DIVISION_LABEL[n.profession]} · {raceLabel(n.race)}{#if justGraduatedId === n.id} · <span class="comp-nc-newtag">just graduated</span>{/if}
              </div>
              <div class="cg-buffchips">
                {#each buffChips(n) as c, ci (ci)}
                  <span class="cg-bf {c.kind}" title={c.title}>{#if c.kind === "exclusive"}<Icon name="diamond" size={11} />{/if}{c.label}</span>
                {/each}
              </div>
              <div class="comp-nc-act">
                <button
                  type="button"
                  class="cg-btn sm ghost"
                  disabled={!sendGate.ok}
                  title={sendBackTitle(n.id, state)}
                  on:click={() => onSendBack(n.id)}
                >Send back</button>
                <button
                  type="button"
                  class="cg-btn sm ghost"
                  disabled={!canRetireNotable(state, n.id).ok}
                  title={retireTitle(n.id, state)}
                  on:click={() => (retireId = n.id)}
                >Retire</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if graduateKey !== null && graduateRow !== null}
  <!-- CP-9: the Graduate confirm. The name shown is the one the notable gets (crewGraduation.ts nextGraduateIdentity). -->
  <ActionModal title="Graduate a standout" onClose={() => (graduateKey = null)}>
    <div class="gm">
      <p class="gm-lead">One crew member of the <b>{graduateRow.name}</b> becomes a named notable, assigned to <b>{shipName}</b>.</p>
      <div class="gm-namecard">
        <div class="gm-big"><Icon name="graduate" size={16} /> {graduateName}</div>
        <div class="gm-kv">
          <span>Rank</span><span>{graduateRow.rankLabel}</span>
          <span>Division</span><span>{graduateRow.divisionLabel}</span>
          <span>Origin</span><span>{raceLabel(graduateRow.race)}</span>
          <span>Rarity</span><span style="color: var(--rarity-{graduateRow.rarity})">{graduateRow.rarityLabel}</span>
        </div>
        <div class="cg-buffchips">
          {#each graduateRow.buffs as c, ci (ci)}
            <span class="cg-bf {c.kind}" title={c.title}>{#if c.kind === "exclusive"}<Icon name="diamond" size={11} />{/if}{c.label}</span>
          {/each}
        </div>
      </div>
      <div class="gm-delta">Group <s>{graduateRow.count}</s> &rarr; <b>{graduateRow.count - 1}</b> · Notables in the fleet <s>{fleetNotables}</s> &rarr; <b>{fleetNotables + 1}</b> / {NOTABLE_CREW_CAP}</div>
      {#if graduateBlock !== undefined}
        <p class="gm-warn"><Icon name="warning" size={14} /> <span>{graduateBlock}.</span></p>
      {:else}
        <p class="gm-note">Identity only: the ship's caps and buffs do not change. You can send a notable back later; they keep their name. Every notable counts toward the fleet's {NOTABLE_CREW_CAP}, aboard a ship or not.</p>
      {/if}
    </div>
    <svelte:fragment slot="footer">
      <button type="button" class="cg-btn ghost gm-fbtn" on:click={() => (graduateKey = null)}>Cancel</button>
      <button type="button" class="cg-btn pri gm-fbtn" disabled={graduateBlock !== undefined} on:click={confirmGraduate}><Icon name="graduate" size={14} /> Graduate</button>
    </svelte:fragment>
  </ActionModal>
{/if}

{#if retireId !== null && retireTarget !== null}
  <!-- CP-9 (user call 2026-11-02 "Allow Retire"): the Retire confirm. No penalty; it frees a notable slot. -->
  <ActionModal title="Retire a notable" onClose={() => (retireId = null)}>
    <div class="gm">
      <p class="gm-lead">Retire <b>{retireTarget.name}</b>? They leave the fleet with your thanks.</p>
      <div class="gm-delta">Notables in the fleet <s>{fleetNotables}</s> &rarr; <b>{fleetNotables - 1}</b> / {NOTABLE_CREW_CAP}</div>
      {#if retireBlock !== undefined}
        <p class="gm-warn"><Icon name="warning" size={14} /> <span>{retireBlock}.</span></p>
      {:else}
        <p class="gm-note">No penalty. {(retireTarget.assignedShipId ?? null) === null ? "They are not aboard a ship." : autoCrewOn ? "Their berth aboard opens, and auto-crew refills it from the pool." : "Their berth aboard opens."} This cannot be undone.</p>
      {/if}
    </div>
    <svelte:fragment slot="footer">
      <button type="button" class="cg-btn ghost gm-fbtn" on:click={() => (retireId = null)}>Cancel</button>
      <button type="button" class="cg-btn pri gm-fbtn" disabled={retireBlock !== undefined} on:click={confirmRetire}>Retire</button>
    </svelte:fragment>
  </ActionModal>
{/if}

{#if transferKeys !== null}
  <!-- CP-10: the transfer picker (the signed mockup's sections 1 and 2). -->
  <CrewTransferModal
    {state}
    from={shipId}
    keys={transferKeys}
    {onTransfer}
    onSetManual={(id) => onSetMode(id, "active")}
    onClose={closeTransfer}
  />
{/if}

{#if manifestOpen}
  <!-- CP-9: the read-only Manifest (CrewManifestModal.svelte, shared with the crew pool tab since CP-10). -->
  <CrewManifestModal
    {state}
    endpoint={shipId}
    title={`Manifest · ${shipName}`}
    subLine={`${usedBerths} aboard · ${notablesAboard} ${notablesAboard === 1 ? "notable" : "notables"}`}
    note="Names are made up when you open this list and are never saved. A crew member keeps the same name while they stay in their group aboard this ship."
    emptyText="No crew of this division aboard."
    onClose={() => (manifestOpen = false)}
  />
{/if}

<style>
  /* CONTAINER-QUERY CONTEXT (mirrors ShipSystemsPanel / SeniorStaffPanel). The wrap is the
     container the division grid keys off, so the layout responds to the panel's OWN width, not the
     viewport (the ship-detail body can be a narrow column on a wide screen). */
  /* CP-6: the crew lock line (warning hue + the lock glyph + words, so color is never the only signal). */
  .comp-lock {
    margin: 8px 0 0;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-warning);
  }
  .comp {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .comp-section-tag {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .comp-section-hint {
    color: var(--color-text-dim);
    letter-spacing: 0.02em;
    text-transform: none;
  }

  /* CAPACITY HEADER */
  .comp-cap {
    padding: 11px 12px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
  }
  .comp-caprow {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 9px;
  }
  .comp-capnums {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .comp-bignum {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .comp-of {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .comp-modline {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-warning, #fbbf24);
  }
  .comp-autoc {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .comp-paused {
    text-transform: none;
    letter-spacing: 0;
    color: var(--color-text-dim);
  }
  .comp-autoc-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .comp-bar {
    height: 9px;
    border-radius: var(--corner);
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }
  .comp-bar > span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--color-accent), var(--color-accent-bright));
  }
  .comp-mode-note {
    margin-top: 7px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    line-height: 1.5;
  }

  /* DIVISION GRID: multi-column on a wide container, one column when narrow. auto-fit keyed off the
     panel's own inline size (container-type above), so no matchMedia fork. */
  .comp-divgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(248px, 1fr));
    gap: 10px;
  }
  @container (max-width: 520px) {
    .comp-divgrid {
      grid-template-columns: 1fr;
    }
  }
  .comp-div {
    padding: 11px 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .comp-dvh {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 9px;
  }
  .comp-dv-name {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent);
  }
  .comp-dv-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  /* CP-5 (OC-6): the over-cap state. Warning hue plus words ("Over cap", the note), so color is never the only signal. */
  .comp-over {
    margin: 8px 0 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-warning);
  }
  .comp-div.is-over {
    border-color: var(--color-warning);
  }
  .comp-dv-over {
    margin-left: auto;
    padding: 1px 6px;
    border: 1px solid var(--color-warning);
    border-radius: var(--corner);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-warning);
    white-space: nowrap;
  }
  .comp-dv-overnote {
    margin: -4px 0 8px;
    font-size: var(--text-2xs);
    line-height: 1.4;
    color: var(--color-warning);
  }

  /* THE CHART: bars sit on a baseline, y-axis labels float in a fixed left gutter. */
  .comp-chart {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 96px;
    padding-left: 26px;
    position: relative;
  }
  .comp-yaxis {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 16px;
    width: 24px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    font-family: var(--font-mono);
    font-size: calc(8px * var(--ui-scale));
    color: var(--color-text-dim);
  }
  .comp-yaxis span {
    line-height: 1;
  }
  /* The whole column is the hover/tap zone (a WIDE, finger-sized target), not just the thin bar. */
  .comp-colwrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 2px 1px;
    cursor: pointer;
    position: relative;
    -webkit-tap-highlight-color: transparent;
  }
  .comp-track {
    width: 100%;
    max-width: 30px;
    height: 78px;
    position: relative;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.2);
  }
  /* CAP LAYER (graph palette): a subtle gray vertical gradient behind the utilization bar. */
  .comp-capbar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(180deg, #4c5666, #333b48);
    border-radius: 1px 1px 0 0;
  }
  .comp-capbar.uncapped {
    /* The uncapped Crewman cap layer reads as a striped "no ceiling" bar. */
    background: repeating-linear-gradient(180deg, #4a5568, #4a5568 3px, transparent 3px, transparent 5px);
  }
  /* UTILIZATION LAYER (graph palette): the fill gradient is set inline per column (hue by %). */
  .comp-utilbar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 1px 1px 0 0;
  }
  .comp-xlab {
    font-family: var(--font-mono);
    font-size: calc(8px * var(--ui-scale));
    letter-spacing: 0.02em;
    color: var(--color-text-dim);
    text-transform: uppercase;
    white-space: nowrap;
  }
  .comp-colwrap:hover .comp-track,
  .comp-colwrap:focus-visible .comp-track {
    outline: 1px solid rgba(var(--color-accent-rgb), 0.5);
    outline-offset: 2px;
  }

  /* SINGLE-ZONE TOOLTIP per rank column (shown on hover / focus-within). */
  .comp-btip {
    position: absolute;
    z-index: 30;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 148px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    background: var(--color-bg-raised, #0c1626);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
    padding: 8px 10px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }
  .comp-colwrap:hover .comp-btip,
  .comp-colwrap:focus-within .comp-btip {
    opacity: 1;
  }
  .comp-bt-r {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .comp-bt-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
  }
  .comp-bt-row b {
    color: var(--color-text-primary);
    font-weight: 600;
  }

  /* GRAPH KEY */
  .comp-gkey {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    letter-spacing: 0.04em;
  }
  .comp-gkey span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .comp-swatch {
    width: 20px;
    height: 8px;
    border-radius: 1px;
    flex: 0 0 auto;
  }
  .comp-swatch.cap {
    background: linear-gradient(180deg, #4c5666, #333b48);
  }
  .comp-swatch.util {
    background: linear-gradient(90deg, hsl(0, 80%, 55%), hsl(60, 80%, 55%), hsl(120, 60%, 45%));
  }

  /* NOTABLE CREW STRIP */
  .comp-notable {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .comp-nstrip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .comp-ncard {
    flex: 0 0 auto;
    min-width: 156px;
    padding: 8px 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-left: 2px solid var(--color-accent);
    border-radius: var(--corner);
  }
  .comp-nc-name {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .comp-nc-nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .comp-nc-fav {
    flex: 0 0 auto;
    background: none;
    border: none;
    padding: 0;
    line-height: 1;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .comp-nc-fav.on {
    color: var(--color-warning, #fbbf24);
  }
  .comp-nc-fav:hover,
  .comp-nc-fav:focus-visible {
    color: var(--color-warning, #fbbf24);
  }
  .comp-nc-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    margin-top: 1px;
  }
  .comp-nc-fav.on :global(svg) {
    fill: currentColor;
  }
  .comp-ncard {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-width: 280px;
  }
  .comp-ncard.new {
    border-color: rgba(52, 211, 153, 0.6);
    border-left-color: var(--color-success);
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.2);
  }
  .comp-nc-newtag {
    color: var(--color-success);
  }
  .comp-nc-act {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: auto;
  }

  /* CP-9: THE GRADUATE CONFIRM */
  .gm {
    display: grid;
    gap: 10px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gm b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .gm-lead,
  .gm-note {
    margin: 0;
    line-height: 1.45;
  }
  .gm-namecard {
    display: grid;
    gap: 8px;
    border: 1px solid rgba(52, 211, 153, 0.45);
    background: rgba(52, 211, 153, 0.06);
    border-radius: var(--corner);
    padding: 10px 12px;
  }
  .gm-big {
    font-family: var(--font-display);
    font-size: var(--text-md, 15px);
    letter-spacing: 0.06em;
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gm-big :global(svg) {
    color: var(--color-success);
  }
  .gm-kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
  }
  .gm-kv span:nth-child(odd) {
    color: var(--color-text-dim);
  }
  .gm-delta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .gm-delta s {
    color: var(--color-text-dim);
  }
  .gm-warn {
    margin: 0;
    color: var(--color-warning);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }

  /* The Graduate and Retire sheets' two buttons share the width on a phone (the mockup's bottom sheet). */
  @container (max-width: 700px) {
    .gm-fbtn {
      flex: 1;
      justify-content: center;
    }
  }

  /* EMPTY / FALLBACK HINTS */
  .comp-empty-hint {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
    line-height: 1.5;
  }
  .comp-empty-block {
    padding: 10px 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px dashed rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
  }
</style>
