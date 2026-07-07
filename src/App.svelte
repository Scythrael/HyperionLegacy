<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Starfield from "./lib/Starfield.svelte";
  import Panel from "./lib/Panel.svelte";
  import {
    freshState,
    MISSIONS,
    requiredTicksForPhase,
    RECIPES,
    xpForNextLevel,
    type GameState,
    type MissionKey,
    type MissionPhase,
    type LootMaterialKey,
    type RecipeKey,
    type HomePlanetMaterialKey,
  } from "./lib/game/model";
  import {
    tick,
    tickCaptainMission,
    dispatchCaptainOnMission,
    recallCaptain,
    craftRecipe,
    recomputeFleetAdmin,
  } from "./lib/game/tick";
  import { formatNumber } from "./lib/game/format";
  import { saveToLocalStorage, loadFromLocalStorage, clearSave, exportRawSave } from "./lib/game/save";
  import { loadTheme, saveTheme, THEME_NAMES, THEME_PREVIEW_COLORS, type ThemeName } from "./lib/theme";

  // DEV_MODE — Vercel §9.5.3: true on Preview, false on Production. Locally,
  // set VITE_DEV_MODE=true in .env.local (see .env.example).
  const DEV_MODE_ENV = import.meta.env.VITE_DEV_MODE === "true";

  // Display-only phase labels for the MISSIONS panel's phase readout. Purely
  // a UI concern -- nothing outside this file needs to map a MissionPhase to
  // display text, so it lives here rather than in model.ts. Must stay in
  // sync with MissionPhase's literal union -- a new phase added there
  // without a matching entry here would silently render "undefined" instead
  // of a label.
  const MISSION_PHASE_LABEL: Record<MissionPhase, string> = {
    ordersReceived: "Orders Received",
    transitOut: "Transiting Out",
    extracting: "Extracting",
    transitBack: "Transiting Back",
    unloading: "Unloading",
  };

  let state: GameState = freshState();
  let createdAt = Date.now();
  let devPanelOpen = false;
  let currentTheme: ThemeName = "cyan";
  let deleteModalOpen = false;
  let deleteConfirmText = "";
  let speed = 1;
  let logEntries: string[] = [];
  let activeCaptainIndex = 0;
  let paused = false;

  // Outer bottom nav (Task 1, Phase 4) -- 5 tabs, no router library (see
  // design doc: single-page idle game, no deep-linking/history need). Default
  // lands on Fleet Ops since captains/missions are the core loop today.
  type TabKey = "homeworld" | "sectorSpace" | "fleetOps" | "battlespace" | "system";
  let activeTab: TabKey = "fleetOps";
  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;
  let lastPollTime = Date.now();

  // Per-captain cycle tracking, keyed by captain id. Each captain's own
  // tickDurationSeconds can diverge from the others' (nothing does that yet,
  // but the data model is built for it -- see design doc), so each needs its
  // own independent barCycleStart/nowTick rather than one shared pair.
  interface CaptainCycle {
    barCycleStart: number;
    nowTick: number;
  }
  let captainCycles: Record<number, CaptainCycle> = {};

  function ensureCaptainCycles(now: number) {
    for (const captain of state.captains) {
      if (!captainCycles[captain.id]) {
        captainCycles[captain.id] = { barCycleStart: now, nowTick: now };
      }
    }
    captainCycles = captainCycles; // reassign to trigger Svelte reactivity on the mutated object
  }

  function pushLog(msg: string) {
    logEntries = [msg, ...logEntries].slice(0, 8);
  }

  function doSave() {
    saveToLocalStorage(state, createdAt);
  }

  onMount(() => {
    // Browsers restore scroll position across reloads by default (an
    // absolute pixel offset from the LAST time this page was open). This
    // page's height changes as content is added (more captain tabs, new
    // panels like Skill Tree), so an old offset can land well below the top
    // on a reload -- confirmed live in production after the Skill Tree
    // panel shipped. This is a single-page app with no in-page anchors to
    // preserve, so we take control of scroll position ourselves instead of
    // trusting the browser's restoration.
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);

    currentTheme = loadTheme();
    document.documentElement.dataset.theme = currentTheme;

    const loadedSave = loadFromLocalStorage();
    if (loadedSave) {
      createdAt = loadedSave.createdAt;
      const offlineSeconds = Math.max(0, (Date.now() - loadedSave.lastSavedAt) / 1000);
      state = offlineSeconds > 5 ? tick(offlineSeconds, loadedSave.state) : loadedSave.state;
      if (offlineSeconds > 5) pushLog(`Welcome back. Advanced ${formatNumber(offlineSeconds)}s offline.`);
    } else {
      pushLog("New save initialized.");
    }
    lastPollTime = Date.now();
    ensureCaptainCycles(lastPollTime);

    // Tick-bar loop — checks EVERY captain's own cycle progress every 100ms,
    // firing tickCaptainMission (Phase 3a) independently for whichever
    // mission captain(s) complete a cycle on this poll. Idle captains
    // (mission === null) have no passive economy anymore -- see the
    // Phase 4 comment on tick()'s loop body below -- so only mission
    // captains ever have anything to fire here. Fleet-wide gameTimeSeconds
    // advances continuously off real elapsed time every poll, decoupled from
    // any single captain's cadence (gameTimeSeconds is fleet bookkeeping; it
    // is never read by tickCaptainMission's production math, so this
    // decoupling cannot desync production from time).
    // barSeconds is floored at 1 real second per captain so dev-speed
    // presets never make that captain's bar flicker unreadably — multiple
    // game-ticks just batch into one visual cycle, which is still correct
    // because tickCaptainMission is closed-form.
    tickHandle = setInterval(() => {
      const now = Date.now();

      if (speed === 0) {
        paused = true;
        lastPollTime = now; // freeze the fleet clock too while paused
        return;
      }

      if (paused) {
        // Resuming: discard the paused wall-clock gap entirely for the fleet
        // clock AND every captain's cycle, rather than letting it read as
        // elapsed time (which would fire unearned progress on resume).
        lastPollTime = now;
        for (const id of Object.keys(captainCycles)) {
          captainCycles[Number(id)].barCycleStart = now;
        }
        captainCycles = captainCycles;
        paused = false;
        return;
      }

      const realElapsedSeconds = (now - lastPollTime) / 1000;
      lastPollTime = now;
      state = { ...state, gameTimeSeconds: state.gameTimeSeconds + realElapsedSeconds * speed };

      ensureCaptainCycles(now);
      let captains = state.captains;
      let anyFired = false;

      // Mirrors tick()'s own homePlanetDelta accumulation in tick.ts: summed
      // locally across every captain whose mission advances THIS poll, then
      // merged into state.homePlanet.storage once below -- same "accumulate
      // locally, apply once" shape as gameTimeSeconds and captains itself.
      // Starts all-zero and stays that way (anyLootDelivered stays false) on
      // a poll where no captain's bar completes or no completed captain is on
      // a mission, so the homePlanet merge below can be skipped entirely on
      // the (overwhelmingly common) no-op poll -- same reactivity-churn
      // discipline as the existing anyFired guard.
      let anyLootDelivered = false;
      const homePlanetDelta: Record<LootMaterialKey, number> = { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };

      for (let i = 0; i < captains.length; i++) {
        const captain = captains[i];
        const cycle = captainCycles[captain.id];
        const barSeconds = Math.max(1, captain.tickDurationSeconds / speed);
        cycle.nowTick = now;
        const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;
        // Idle captains (mission === null) have no passive economy anymore --
        // missions are the only way a captain does anything (mirrors
        // tick.ts's tick(), which returns idle captains completely
        // unchanged). Only a captain WITH an active mission has anything to
        // advance when their bar completes; an idle captain's bar is simply
        // never reset, which is harmless since nothing reads it once the
        // TICK panel (the only consumer of per-captain idle bar progress) is
        // gone -- see this commit's message for the removal reasoning.
        if (progress >= 1 && captain.mission) {
          const gameSecondsThisCycle = barSeconds * speed;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          // Same deltaSeconds -> ticksElapsed conversion tick() uses in
          // tick.ts (divide by THIS captain's own tickDurationSeconds) --
          // keeps the live loop's mission cadence identical to the offline
          // catch-up path's, which is the whole point of this task.
          const ticksElapsed = gameSecondsThisCycle / captain.tickDurationSeconds;
          const { captain: updatedCaptain, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
          captains[i] = updatedCaptain;
          if (delta.commonOre !== 0 || delta.uncommonMaterial !== 0 || delta.rareMaterial !== 0) {
            anyLootDelivered = true;
            homePlanetDelta.commonOre += delta.commonOre;
            homePlanetDelta.uncommonMaterial += delta.uncommonMaterial;
            homePlanetDelta.rareMaterial += delta.rareMaterial;
          }
          cycle.barCycleStart = now;
        }
      }

      captainCycles = captainCycles; // reassign to trigger reactivity on the mutated cycle map
      if (anyFired) {
        state = { ...state, captains };
      }
      if (anyLootDelivered) {
        // Field-by-field, matching tick.ts's own homePlanet merge exactly --
        // added ONTO existing totals, never replacing them. The
        // `...state.homePlanet.storage` spread MUST come first, before the 3
        // named-field overwrites below -- otherwise this object literal would
        // silently drop any OTHER field on homePlanet.storage that this loop
        // doesn't itself touch (refinedMaterial, components, added by the
        // Homeworld crafting system) on every poll that delivers loot. This is
        // the exact class of bug tick.ts's own tick() function already
        // guards against (see its comment referencing the "prestige silently
        // dropped homePlanet" production incident) -- this live-loop poll path
        // is a second, independent place doing the same merge, and needed the
        // same fix. Do not remove this spread.
        state = {
          ...state,
          homePlanet: {
            storage: {
              ...state.homePlanet.storage,
              commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
              uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
              rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
            },
          },
        };
      }

      // recomputeFleetAdmin (Task 3, Captain & Homeworld Talent Trees) --
      // same "both the pure tick() path and the live-loop path need the same
      // hook" pattern tickCaptainMission's own XP award already established
      // in Phase 4. Runs unconditionally every poll (not gated behind
      // anyFired/anyLootDelivered above) since it's a cheap no-op read of
      // `state` when the aggregate captain-level sum hasn't changed --
      // recomputeFleetAdmin itself returns the SAME state reference in that
      // case, so this line doesn't introduce any extra reactivity churn on
      // the overwhelmingly common poll where nobody just leveled up.
      state = recomputeFleetAdmin(state);
    }, 100);

    // Autosave every 30s — tech spec §6.
    saveHandle = setInterval(doSave, 30000);

    const onUnload = () => doSave();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  });

  onDestroy(() => {
    clearInterval(tickHandle);
    clearInterval(saveHandle);
  });

  function doDispatchCaptainOnMission(missionKey: MissionKey) {
    const captain = activeCaptain;
    const { next, success } = dispatchCaptainOnMission(state, captain.id, missionKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Dispatched on mission: ${MISSIONS[missionKey].label}.`);
    doSave();
  }

  function doRecallCaptain() {
    const captain = activeCaptain;
    const missionLabel = MISSIONS[captain.mission!.missionKey].label; // captured before the state swap below, same pre-swap-capture idiom as doDispatchCaptainOnMission's `captain.label` above
    const { next, success } = recallCaptain(state, captain.id);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Recall ordered — returning to base from: ${missionLabel}.`);
    doSave();
  }

  function simulateOffline(hours: number) {
    state = tick(hours * 3600, state); // fleet-wide: advances every captain, matches real offline catch-up
    pushLog(`[DEV] Simulated ${hours}h offline for the whole fleet.`);
  }

  function doCraftRecipe(recipeKey: RecipeKey) {
    const { next, success } = craftRecipe(state, recipeKey);
    if (!success) return;
    state = next;
    pushLog(`Crafted: ${RECIPES[recipeKey].label}.`);
    doSave();
  }

  function doExportSave() {
    const raw = exportRawSave();
    if (!raw) return;
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleet-admiral-save-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetSave() {
    clearSave();
    state = freshState();
    createdAt = Date.now();
    pushLog("Save reset.");
  }

  function confirmDelete() {
    if (deleteConfirmText !== "DELETE") return;
    resetSave();
    deleteModalOpen = false;
    deleteConfirmText = "";
  }

  function cancelDelete() {
    deleteModalOpen = false;
    deleteConfirmText = "";
  }

  function setTheme(name: ThemeName) {
    currentTheme = name;
    document.documentElement.dataset.theme = name;
    saveTheme(name);
  }

  $: activeCaptain = state.captains[activeCaptainIndex];
  // Re-added per user request after Phase 4's panel cleanup dropped it --
  // shown on EVERY tab now (not just Fleet Ops), since it's a persistent
  // per-captain cadence readout, not something scoped to any one screen.
  // Fallback only covers the one-frame window before onMount's
  // ensureCaptainCycles seeds an entry (same assumption noted at
  // ensureCaptainCycles itself: roster size never shrinks below 1).
  $: activeCycle = captainCycles[activeCaptain?.id] ?? { barCycleStart: Date.now(), nowTick: Date.now() };
  $: activeBarSeconds = Math.max(1, (activeCaptain?.tickDurationSeconds ?? 10) / (speed || 1));
  $: activeTickProgress = Math.min(1, Math.max(0, (activeCycle.nowTick - activeCycle.barCycleStart) / 1000 / activeBarSeconds));
  $: activeTickRemaining = Math.max(0, activeBarSeconds * (1 - activeTickProgress));
</script>

<div class="root">
  <Starfield />
  <div class="frame">
    <Panel class="header">
      <div class="header-left">
        <span class="title">FLEET ADMIRAL</span>
        <span class="subtitle">prototype build · multi-captain · single sector</span>
      </div>
      <div class="header-right">
        {#if DEV_MODE_ENV}
          <button class="icon-btn" on:click={() => (devPanelOpen = !devPanelOpen)} title="Toggle debug panel">Dev</button>
        {/if}
      </div>
    </Panel>

    <main class="main">
      <div class="nav-tabs">
        <button class="nav-tab" class:active={activeTab === "homeworld"} on:click={() => (activeTab = "homeworld")}>Homeworld</button>
        <button class="nav-tab" class:active={activeTab === "sectorSpace"} on:click={() => (activeTab = "sectorSpace")}>Sector Space</button>
        <button class="nav-tab" class:active={activeTab === "fleetOps"} on:click={() => (activeTab = "fleetOps")}>Fleet Ops</button>
        <button class="nav-tab" class:active={activeTab === "battlespace"} on:click={() => (activeTab = "battlespace")}>Battlespace</button>
        <button class="nav-tab" class:active={activeTab === "system"} on:click={() => (activeTab = "system")}>System</button>
      </div>

      <Panel>
        <div class="panel-title">TICK — {activeCaptain?.label ?? ""}</div>
        <div class="tick-bar-track">
          <div class="tick-bar-fill" style="width:{activeTickProgress * 100}%"></div>
        </div>
        <div class="tick-bar-readout">{activeTickRemaining.toFixed(1)}s</div>
      </Panel>

      {#if activeTab === "homeworld"}
      <Panel>
        <div class="panel-title">HOME PLANET</div>
        <div class="resource-grid resource-grid-3">
          <div class="resource-card">
            <div class="resource-label">Common Ore</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.commonOre)}</div>
          </div>
          <div class="resource-card">
            <div class="resource-label">Uncommon Material</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.uncommonMaterial)}</div>
          </div>
          <div class="resource-card">
            <div class="resource-label">Rare Material</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.rareMaterial)}</div>
          </div>
        </div>
      </Panel>

      <!-- Refinery/Fabrication (Task 8, Phase 4) -- one panel per RECIPES
           entry, fleet-wide (not per-captain -- Homeworld structures belong
           to the whole fleet, unlike the per-captain MISSIONS panel under
           Fleet Ops). Iterates RECIPES rather than hardcoding each recipe's
           markup twice, so a 3rd recipe added to RECIPES later (per that
           object's own header comment) picks up a panel automatically. -->
      {#each Object.entries(RECIPES) as [recipeKey, recipe]}
        {@const inputEntries = Object.entries(recipe.inputs) as [HomePlanetMaterialKey, number][]}
        {@const affordable = inputEntries.every(([key, amount]) => state.homePlanet.storage[key] >= amount)}
        <Panel>
          <div class="panel-title">{recipeKey === "refineUnobtainium" ? "REFINERY" : "FABRICATION"}</div>
          <div class="research-name">{recipe.label}</div>
          <div class="research-cost">
            Requires:
            {#each inputEntries as [key, amount], i}
              {formatNumber(amount)} {key}{i < inputEntries.length - 1 ? ", " : ""}
              (have {formatNumber(state.homePlanet.storage[key])})
            {/each}
          </div>
          <div class="research-cost">Produces: {formatNumber(recipe.output.amount)} {recipe.output.key}</div>
          <button class="buy-btn" disabled={!affordable} on:click={() => doCraftRecipe(recipeKey as RecipeKey)}>
            Craft · {recipe.label}
          </button>
        </Panel>
      {/each}
      {/if}

      {#if activeTab === "sectorSpace"}
      <Panel>
        <div class="panel-title">SECTOR SPACE</div>
        <p class="prestige-text">Shipyard and Starbase are still under construction.</p>
      </Panel>
      {/if}

      {#if activeTab === "fleetOps"}
      <div class="captain-tabs">
        {#each state.captains as captain, i}
          <button class="captain-tab" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
            {captain.label}
          </button>
        {/each}
      </div>

      <Panel>
        <div class="panel-title">MISSIONS</div>
        {#if activeCaptain.mission === null}
          <div class="mission-list">
            {#each Object.entries(MISSIONS) as [key, def]}
              <div class="mission-card">
                <div class="research-name">{def.label}</div>
                <div class="research-cost">Cargo capacity: {formatNumber(def.cargoCapacity)}</div>
                <button class="buy-btn" on:click={() => doDispatchCaptainOnMission(key as MissionKey)}>
                  Dispatch · {def.label}
                </button>
              </div>
            {/each}
          </div>
        {:else}
          {@const mission = activeCaptain.mission!}
          {@const missionDef = MISSIONS[mission.missionKey]}
          {@const requiredTicks = requiredTicksForPhase(mission.phase, missionDef)}
          {@const progress = Math.min(1, mission.phaseProgressTicks / requiredTicks)}
          {@const remainingTicks = Math.max(0, requiredTicks - mission.phaseProgressTicks)}
          <div class="research-name">{missionDef.label}</div>
          <div class="research-cost">Phase: {MISSION_PHASE_LABEL[mission.phase]}</div>
          <div class="research-bar-track">
            <div class="research-bar-fill" style="width:{progress * 100}%"></div>
          </div>
          <div class="research-readout">{remainingTicks.toFixed(1)} ticks remaining in phase</div>
          <div class="research-cost">
            Cargo so far: {formatNumber(mission.cargo.commonOre)} ore, {formatNumber(mission.cargo.uncommonMaterial)} uncommon,
            {formatNumber(mission.cargo.rareMaterial)} rare
          </div>
          {#if mission.recalled}
            <p class="prestige-text mission-recalled-text">Recall ordered — returning to base once the current cycle's unloading completes.</p>
          {:else}
            <button class="recall-btn" on:click={doRecallCaptain}>Recall Captain</button>
          {/if}
        {/if}
      </Panel>

      <!-- Captain Leveling (Task 8, Phase 4) -- per-captain-scoped, like
           MISSIONS above (reads activeCaptain, not the whole fleet), replacing
           the spot Captain Prestige used to occupy. The old Unlock section
           here (spending a captain's own level/statPoints/Components to add a
           new captain slot) was removed in Task 4 of
           docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md --
           captain slot growth is now purchased fleet-wide through the
           Homeworld Talents panel's Fleet Logistics branch instead. -->
      <Panel>
        <div class="panel-title">CAPTAIN LEVELING</div>
        <div class="research-name">Level {activeCaptain.level}</div>
        <div class="research-bar-track">
          <div class="research-bar-fill" style="width:{Math.min(100, (activeCaptain.xp / xpForNextLevel(activeCaptain.level)) * 100)}%"></div>
        </div>
        <div class="research-readout">{formatNumber(activeCaptain.xp)} / {formatNumber(xpForNextLevel(activeCaptain.level))} XP</div>
        <div class="research-cost">Stat Points: {formatNumber(activeCaptain.statPoints)}</div>
      </Panel>
      {/if}

      {#if activeTab === "battlespace"}
      <Panel>
        <div class="panel-title">BATTLESPACE</div>
        <p class="prestige-text">PvP and PvE fleet operations will live here.</p>
      </Panel>
      {/if}

      {#if activeTab === "system"}
      <Panel>
        <div class="panel-title">OPTIONS</div>
        <div class="theme-row">
          {#each THEME_NAMES as name}
            <button
              class="theme-swatch"
              class:active={currentTheme === name}
              style="background:{THEME_PREVIEW_COLORS[name]}"
              title={name}
              aria-label={name}
              on:click={() => setTheme(name)}
            ></button>
          {/each}
        </div>
        <div class="dev-row">
          <button class="dev-btn" on:click={doExportSave}>Export Save</button>
          <button class="dev-btn danger" on:click={() => (deleteModalOpen = true)}>Delete Save</button>
        </div>
      </Panel>

      {#if DEV_MODE_ENV && devPanelOpen}
        <Panel class="dev-panel">
          <div class="panel-title dev-title">DEBUG PANEL (dev-only)</div>
          <div class="dev-row">
            <span class="dev-label">Speed</span>
            {#each [1, 10, 100, 1000, 0] as s}
              <button class="dev-btn" class:active={speed === s} on:click={() => (speed = s)}>
                {s === 0 ? "Pause" : `${s}x`}
              </button>
            {/each}
          </div>
          <div class="dev-row">
            <span class="dev-label">Offline sim</span>
            <button class="dev-btn" on:click={() => simulateOffline(1)}>+1h</button>
            <button class="dev-btn" on:click={() => simulateOffline(8)}>+8h</button>
            <button class="dev-btn" on:click={() => simulateOffline(24)}>+24h</button>
          </div>
          <div class="dev-row">
            <button class="dev-btn" on:click={doSave}>Save now</button>
            <button class="dev-btn danger" on:click={resetSave}>Reset save</button>
          </div>
        </Panel>
      {/if}

      <Panel>
        <div class="panel-title">LOG</div>
        <div class="log-list">
          {#if logEntries.length === 0}
            <div class="log-empty">No events yet.</div>
          {/if}
          {#each logEntries as entry}
            <div class="log-entry">{entry}</div>
          {/each}
        </div>
      </Panel>
      {/if}
    </main>
  </div>

  {#if deleteModalOpen}
    <div class="modal-backdrop">
      <Panel class="modal-dialog">
        <div class="panel-title">DELETE SAVE</div>
        <p class="modal-warning">This will permanently erase your progress. This can't be undone.</p>
        <p class="modal-instruction">Type <strong>DELETE</strong> to confirm.</p>
        <input class="modal-input" type="text" bind:value={deleteConfirmText} aria-label="Type DELETE to confirm" />
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelDelete}>Cancel</button>
          <button class="dev-btn danger" disabled={deleteConfirmText !== "DELETE"} on:click={confirmDelete}>Delete</button>
        </div>
      </Panel>
    </div>
  {/if}
</div>

<style>
  .root {
    min-height: 100vh;
    position: relative;
    overflow: hidden;
  }
  .frame {
    position: relative;
    z-index: 1;
    max-width: 720px;
    margin: 0 auto;
    /* Bottom padding enlarged (60px -> 96px) to clear the fixed .nav-tabs bar
       (Task 1, Phase 4) -- without this, the LOG panel (or whatever ends up
       last in the active tab) would render partially underneath the bar. */
    padding: 20px 16px 96px;
  }
  .header-left { display: flex; flex-direction: column; }
  .title {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 2px;
    color: var(--color-accent-bright);
  }
  .subtitle { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; }
  .header-right { display: flex; align-items: center; gap: 8px; }
  .stat-pill {
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    text-align: right;
  }
  .stat-label { font-size: 9px; color: var(--color-text-secondary); text-transform: uppercase; }
  .stat-value { font-family: var(--font-mono); font-size: 13px; color: var(--color-accent); }
  .icon-btn {
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
    border-radius: 8px;
    padding: 6px 10px;
    color: var(--color-accent);
    cursor: pointer;
  }
  .main { display: flex; flex-direction: column; gap: 14px; }
  /* Outer nav (Task 1, Phase 4) -- fixed to the bottom of the viewport per
     the design doc ("tabs along the bottom of the screen"). Deliberately
     distinct from .captain-tab below (solid panel-strength background,
     no rounded corners, uppercase+letter-spaced labels) so it reads as the
     OUTER shell nav rather than a second row of the same widget as the
     INNER captain switcher. .frame's bottom padding (see above) is sized to
     clear this bar's height so it never overlaps whatever renders last in
     the active tab (e.g. the LOG panel under System). */
  .nav-tabs {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    background: var(--color-panel-bg-strong);
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
  }
  .nav-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-top: 2px solid transparent;
    padding: 12px 4px 10px;
    color: var(--color-text-secondary);
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .nav-tab.active {
    color: var(--color-accent-bright);
    border-top-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.08);
  }
  .captain-tabs { display: flex; gap: 8px; }
  .captain-tab {
    flex: 1;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 8px;
    padding: 8px 10px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
  }
  .captain-tab.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .panel-title {
    font-size: 11px;
    letter-spacing: 1.5px;
    color: var(--color-accent);
    margin-bottom: 12px;
    font-weight: 600;
  }
  .resource-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  /* HOME PLANET has exactly 3 loot materials, not 4 -- reusing .resource-grid
     as-is would use its hardcoded repeat(4, 1fr) and leave an empty 4th
     column (uneven, oddly gapped), since that column count is a literal, not
     auto-fill/auto-fit. This modifier overrides just the column count; every
     other .resource-grid rule (gap) and all of .resource-card/-label/-value
     are reused unchanged. */
  .resource-grid-3 { grid-template-columns: repeat(3, 1fr); }
  .resource-card {
    padding: 10px 8px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    text-align: center;
  }
  .resource-label { font-size: 10px; color: var(--color-text-secondary); margin-bottom: 4px; }
  .resource-value { font-family: var(--font-mono); font-size: 16px; }
  .resource-value.locked { color: var(--color-text-dim); }
  .tick-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    clip-path: polygon(
      4px 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% calc(100% - 4px),
      calc(100% - 4px) 100%,
      4px 100%,
      0 calc(100% - 4px),
      0 4px
    );
  }
  .tick-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.1s linear;
  }
  .tick-bar-readout {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-secondary);
    text-align: right;
  }
  .research-name { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .research-cost { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 10px; }
  .research-status { font-size: 13px; color: var(--color-success); margin: 0; }
  .research-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    margin-bottom: 6px;
    clip-path: polygon(
      4px 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% calc(100% - 4px),
      calc(100% - 4px) 100%,
      4px 100%,
      0 calc(100% - 4px),
      0 4px
    );
  }
  .research-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.2s linear;
  }
  .research-readout { font-size: 11px; color: var(--color-text-secondary); text-align: right; }
  .mission-list { display: flex; flex-direction: column; gap: 10px; }
  .mission-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .mission-recalled-text { margin-top: 10px; margin-bottom: 0; }
  /* No existing non-dev-panel "danger" button style to reuse -- .dev-btn.danger
     is scoped to the amber dev-panel look, and .prestige-btn's warning color
     is for a different semantic (fleet prestige), not "cancel an in-progress
     action." Shaped like .spec-btn (same padding/border-radius/font-size)
     but colored with --color-danger to read as a distinct, cautionary action. */
  .recall-btn {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.4);
    border-radius: 8px;
    padding: 8px 12px;
    color: var(--color-danger);
    font-size: 11px;
    cursor: pointer;
    margin-top: 10px;
  }
  .module-list { display: flex; flex-direction: column; gap: 10px; }
  .module-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .module-card.locked { opacity: 0.5; }
  .module-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .module-name { font-size: 13px; font-weight: 600; }
  .module-rate { font-size: 11px; color: var(--color-text-secondary); font-family: var(--font-mono); margin-top: 2px; }
  .buy-btn {
    background: rgba(var(--color-accent-rgb), 0.15);
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    padding: 8px 10px;
    color: var(--color-accent-bright);
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .buy-btn:disabled { cursor: not-allowed; }
  .prestige-text { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; margin: 0 0 12px; }
  .prestige-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
  .prestige-yield { font-size: 12px; }
  .prestige-btn {
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.5);
    color: var(--color-warning);
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 12px;
    letter-spacing: 1px;
    cursor: pointer;
  }
  .spec-current { font-size: 11px; color: var(--color-text-secondary); margin: 10px 0; }
  .spec-picker { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .spec-btn {
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: 8px;
    padding: 8px 12px;
    color: var(--color-accent-bright);
    font-size: 11px;
    cursor: pointer;
  }
  .spec-btn:disabled { cursor: not-allowed; }
  .skill-branch { margin-bottom: 14px; }
  .skill-branch:last-child { margin-bottom: 0; }
  .skill-branch-title {
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin-bottom: 8px;
  }
  .skill-node {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    margin-bottom: 6px;
    gap: 8px;
  }
  .skill-node:last-child { margin-bottom: 0; }
  .skill-node.owned { border-color: var(--color-success); }
  .skill-node.locked { opacity: 0.5; }
  .skill-node-label { font-size: 12px; font-weight: 600; }
  .skill-node-status { font-size: 11px; color: var(--color-text-secondary); }
  .theme-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .theme-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .theme-swatch.active {
    border-color: var(--color-text-primary);
  }
  .dev-title { color: var(--color-warning) !important; }
  .dev-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .dev-label { font-size: 11px; color: var(--color-text-secondary); width: 78px; }
  .dev-btn {
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: #fcd34d;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
  }
  .dev-btn.active { background: rgba(251, 191, 36, 0.3); color: #fff; }
  .dev-btn.danger { color: var(--color-danger); }
  .dev-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .log-list { display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; }
  .log-empty { font-size: 12px; color: var(--color-text-dim); }
  .log-entry { font-size: 12px; color: #9fc4cc; font-family: var(--font-mono); }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }
  .modal-dialog {
    max-width: 360px;
    width: 100%;
  }
  .modal-warning { font-size: 13px; color: var(--color-danger); line-height: 1.5; margin: 0 0 10px; }
  .modal-instruction { font-size: 12px; color: var(--color-text-secondary); margin: 0 0 8px; }
  .modal-input {
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 14px;
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .modal-row { display: flex; justify-content: flex-end; gap: 8px; }
</style>
