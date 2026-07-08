<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Starfield from "./lib/Starfield.svelte";
  import Panel from "./lib/Panel.svelte";
  import SubTabs from "./lib/SubTabs.svelte";
  import {
    freshState,
    MISSIONS,
    requiredTicksForPhase,
    RECIPES,
    xpForNextLevel,
    xpForNextFleetAdminLevel,
    CAPTAIN_TALENTS,
    HOMEWORLD_TALENTS,
    type GameState,
    type MissionKey,
    type MissionPhase,
    type LootMaterialKey,
    type RecipeKey,
    type HomePlanetMaterialKey,
    type CaptainTalentBranch,
    type HomeworldTalentBranch,
    type CaptainTalentKey,
    type HomeworldTalentKey,
  } from "./lib/game/model";
  import {
    tick,
    tickCaptainMission,
    dispatchCaptainOnMission,
    recallCaptain,
    craftRecipe,
    recomputeFleetAdmin,
    buyCaptainTalent,
    buyHomeworldTalent,
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
  let currentTheme: ThemeName = "cyan";
  let deleteModalOpen = false;
  let deleteConfirmText = "";
  let speed = 1;
  let logEntries: string[] = [];
  let activeCaptainIndex = 0;
  let paused = false;

  // Outer bottom nav (Task 1, Phase 4; split from 5 to 6 tabs in the UI
  // Redesign, Task 7 -- see docs/plans/2026-07-07-ui-redesign-plan.md), no
  // router library (see design doc: single-page idle game, no deep-linking/
  // history need). Default lands on Fleet Captain's since captains/missions
  // are the core loop today.
  type TabKey = "homeworld" | "sectorSpace" | "fleetCaptains" | "fleetOperations" | "battlespace" | "system";
  let activeTab: TabKey = "fleetCaptains";

  // Fleet Captain's tab sub-tabs (UI Redesign, Task 8 -- see
  // docs/plans/2026-07-07-ui-redesign-plan.md). Overview holds the relocated
  // CAPTAIN LEVELING content; Talents holds the relocated CAPTAIN TALENTS
  // content. Defaults to Overview since level/XP is the more commonly
  // checked view.
  type FleetCaptainSubTab = "overview" | "talents";
  let activeFleetCaptainSubTab: FleetCaptainSubTab = "overview";

  // Homeworld tab sub-tabs (UI Redesign, Task 10 -- see
  // docs/plans/2026-07-07-ui-redesign-plan.md). Resources holds the
  // relocated HOME PLANET content; Refinery holds the relocated
  // Refinery/Fabrication RECIPES content; Talents holds the relocated
  // HOMEWORLD TALENTS content. Defaults to Resources as the most commonly
  // checked view.
  type HomeworldSubTab = "resources" | "refinery" | "talents";
  let activeHomeworldSubTab: HomeworldSubTab = "resources";

  // System tab sub-tabs (UI Redesign, Task 10). Options holds the relocated
  // theme picker + Export/Delete Save content; Log holds the relocated LOG
  // panel; Debug holds the relocated dev debug panel (only reachable when
  // DEV_MODE_ENV is true -- see the <SubTabs> usage under the System tab
  // below, which omits the "debug" entry from its tabs array entirely when
  // DEV_MODE_ENV is false, so non-dev-mode players never see a Debug button
  // at all). Defaults to Options since theme/save actions are the most
  // commonly checked view.
  type SystemSubTab = "options" | "log" | "debug";
  let activeSystemSubTab: SystemSubTab = "options";

  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;
  let lastPollTime = Date.now();

  // Fleet-wide tick cycle (collapsed from a per-captain-id-keyed map during
  // the UI Redesign, Task 4 -- see docs/plans/2026-07-07-ui-redesign-plan.md
  // and docs/plans/2026-07-07-ui-redesign-design.md). tickDurationSeconds is
  // now a single field on GameState (Task 1 of this same plan), so every
  // captain advances in lockstep on ONE shared cycle instead of each
  // captain owning its own independent barCycleStart/nowTick pair.
  let cycle: { barCycleStart: number; nowTick: number } = { barCycleStart: Date.now(), nowTick: Date.now() };

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
    cycle = { barCycleStart: lastPollTime, nowTick: lastPollTime };

    // Tick-bar loop — checks the ONE shared fleet-wide cycle's progress every
    // 100ms, firing tickCaptainMission (Phase 3a) for EVERY mission captain
    // in lockstep whenever that shared cycle completes on this poll (Task 4
    // of the UI Redesign plan collapsed this from a per-captain-cycle loop --
    // see docs/plans/2026-07-07-ui-redesign-plan.md -- since
    // tickDurationSeconds is fleet-wide now, per Task 1 of that same plan).
    // Idle captains (mission === null) have no passive economy anymore -- see
    // the Phase 4 comment on tick()'s loop body below -- so only mission
    // captains ever have anything to fire here. Fleet-wide gameTimeSeconds
    // advances continuously off real elapsed time every poll, decoupled from
    // the shared cycle's cadence (gameTimeSeconds is fleet bookkeeping; it
    // is never read by tickCaptainMission's production math, so this
    // decoupling cannot desync production from time).
    // barSeconds is floored at 1 real second so dev-speed presets never make
    // the shared bar flicker unreadably — multiple game-ticks just batch
    // into one visual cycle, which is still correct because
    // tickCaptainMission is closed-form.
    tickHandle = setInterval(() => {
      const now = Date.now();

      if (speed === 0) {
        paused = true;
        lastPollTime = now; // freeze the fleet clock too while paused
        return;
      }

      if (paused) {
        // Resuming: discard the paused wall-clock gap entirely for the fleet
        // clock AND the shared cycle, rather than letting it read as elapsed
        // time (which would fire unearned progress on resume).
        lastPollTime = now;
        cycle.barCycleStart = now;
        paused = false;
        return;
      }

      const realElapsedSeconds = (now - lastPollTime) / 1000;
      lastPollTime = now;
      state = { ...state, gameTimeSeconds: state.gameTimeSeconds + realElapsedSeconds * speed };

      // barSeconds/progress computed ONCE per poll now, from the fleet-wide
      // state.tickDurationSeconds -- not per-captain (there's only one cycle
      // to check now, not a map keyed by captain id).
      const barSeconds = Math.max(1, state.tickDurationSeconds / speed);
      cycle.nowTick = now;
      const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;

      let captains = state.captains;
      let anyFired = false;

      // Mirrors tick()'s own homePlanetDelta accumulation in tick.ts: summed
      // locally across every captain whose mission advances THIS poll, then
      // merged into state.homePlanet.storage once below -- same "accumulate
      // locally, apply once" shape as gameTimeSeconds and captains itself.
      // Starts all-zero and stays that way (anyLootDelivered stays false) on
      // a poll where the shared cycle doesn't complete, or no captain on a
      // mission delivers loot this cycle, so the homePlanet merge below can
      // be skipped entirely on the (overwhelmingly common) no-op poll --
      // same reactivity-churn discipline as the existing anyFired guard.
      let anyLootDelivered = false;
      const homePlanetDelta: Record<LootMaterialKey, number> = { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };

      if (progress >= 1) {
        const gameSecondsThisCycle = barSeconds * speed;
        // Same deltaSeconds -> ticksElapsed conversion tick() uses in
        // tick.ts (divide by the fleet's shared tickDurationSeconds) --
        // computed ONCE here and reused for every captain below, keeping the
        // live loop's mission cadence identical to the offline catch-up
        // path's, which is the whole point of this task.
        const ticksElapsed = gameSecondsThisCycle / state.tickDurationSeconds;

        for (let i = 0; i < captains.length; i++) {
          const captain = captains[i];
          // Idle captains (mission === null) have no passive economy anymore
          // -- missions are the only way a captain does anything (mirrors
          // tick.ts's tick(), which returns idle captains completely
          // unchanged).
          if (captain.mission === null) continue;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          const { captain: updatedCaptain, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
          captains[i] = updatedCaptain;
          if (delta.commonOre !== 0 || delta.uncommonMaterial !== 0 || delta.rareMaterial !== 0) {
            anyLootDelivered = true;
            homePlanetDelta.commonOre += delta.commonOre;
            homePlanetDelta.uncommonMaterial += delta.uncommonMaterial;
            homePlanetDelta.rareMaterial += delta.rareMaterial;
          }
        }

        // Reset once for the whole fleet, not per-captain -- there's only
        // one shared cycle now.
        cycle.barCycleStart = now;
      }

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

  function doDispatchCaptainOnMission(captainId: number, missionKey: MissionKey) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    const { next, success } = dispatchCaptainOnMission(state, captainId, missionKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Dispatched on mission: ${MISSIONS[missionKey].label}.`);
    doSave();
  }

  function doRecallCaptain(captainId: number) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    const missionLabel = MISSIONS[captain.mission!.missionKey].label; // captured before the state swap below, same pre-swap-capture idiom as doDispatchCaptainOnMission's `captain.label` above
    const { next, success } = recallCaptain(state, captainId);
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

  // Captain Talents (Task 6) -- per-captain-scoped, like doDispatchCaptainOnMission
  // above (reads activeCaptain.id, spends THIS captain's own statPoints).
  // Same "same state reference on failure" convention as buyCaptainTalent
  // itself -- success is just checked and bailed on here, no extra validation
  // duplicated in the UI layer.
  function doBuyCaptainTalent(talentKey: CaptainTalentKey) {
    const captain = activeCaptain;
    const { next, success } = buyCaptainTalent(state, captain.id, talentKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Talent learned: ${CAPTAIN_TALENTS[talentKey].label}.`);
    doSave();
  }

  // Homeworld Talents (Task 6) -- fleet-wide, spends the shared adminPoints
  // pool. Unlike doBuyCaptainTalent above, this never touches state.captains
  // directly here (buyHomeworldTalent itself appends a new captain internally
  // for unlockCaptainSlot-effect nodes -- see tick.ts) -- App.svelte just
  // swaps in whatever `next` comes back, same as every other do* handler.
  function doBuyHomeworldTalent(talentKey: HomeworldTalentKey) {
    const { next, success } = buyHomeworldTalent(state, talentKey);
    if (!success) return;
    state = next;
    pushLog(`Homeworld talent unlocked: ${HOMEWORLD_TALENTS[talentKey].label}.`);
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
  // Fleet-wide tick readout (collapsed from per-captain activeCycle/
  // activeBarSeconds/activeTickProgress/activeTickRemaining during the UI
  // Redesign, Task 4 -- see docs/plans/2026-07-07-ui-redesign-plan.md).
  // There's only ONE cycle to read now (the shared `cycle` object above), so
  // these are no longer scoped to activeCaptain at all -- consumed by the new
  // global header bar landing in Task 6 of that same plan.
  $: globalBarSeconds = Math.max(1, state.tickDurationSeconds / (speed || 1));
  $: globalTickProgress = Math.min(1, Math.max(0, (cycle.nowTick - cycle.barCycleStart) / 1000 / globalBarSeconds));
  $: globalTickRemaining = Math.max(0, globalBarSeconds * (1 - globalTickProgress));
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
      </div>
    </Panel>

    <div class="top-bar">
      <div class="top-bar-row">
        <span class="top-bar-label">Fleet Admiral · Level {state.fleetAdminLevel}</span>
        <span class="top-bar-value">{formatNumber(state.fleetAdminXp)} / {formatNumber(xpForNextFleetAdminLevel(state.fleetAdminLevel))} XP</span>
      </div>
      <div class="research-bar-track">
        <div class="research-bar-fill" style="width:{Math.min(100, (state.fleetAdminXp / xpForNextFleetAdminLevel(state.fleetAdminLevel)) * 100)}%"></div>
      </div>
      <div class="tick-bar-track">
        <div class="tick-bar-fill" style="width:{globalTickProgress * 100}%"></div>
      </div>
      <div class="tick-bar-readout">{globalTickRemaining.toFixed(1)}s</div>
    </div>

    <main class="main">
      <div class="nav-tabs">
        <button class="nav-tab" class:active={activeTab === "homeworld"} on:click={() => (activeTab = "homeworld")}>Homeworld</button>
        <button class="nav-tab" class:active={activeTab === "sectorSpace"} on:click={() => (activeTab = "sectorSpace")}>Sector Space</button>
        <button class="nav-tab" class:active={activeTab === "fleetCaptains"} on:click={() => (activeTab = "fleetCaptains")}>Fleet Captain's</button>
        <button class="nav-tab" class:active={activeTab === "fleetOperations"} on:click={() => (activeTab = "fleetOperations")}>Fleet Operations</button>
        <button class="nav-tab" class:active={activeTab === "battlespace"} on:click={() => (activeTab = "battlespace")}>Battlespace</button>
        <button class="nav-tab" class:active={activeTab === "system"} on:click={() => (activeTab = "system")}>System</button>
      </div>

      {#if activeTab === "homeworld"}
      <SubTabs
        tabs={[{ key: "resources", label: "Resources" }, { key: "refinery", label: "Refinery/Fabrication" }, { key: "talents", label: "Homeworld Talents" }]}
        active={activeHomeworldSubTab}
        onSelect={(key) => (activeHomeworldSubTab = key as HomeworldSubTab)}
      />

      {#if activeHomeworldSubTab === "resources"}
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
      {/if}

      {#if activeHomeworldSubTab === "refinery"}
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

      {#if activeHomeworldSubTab === "talents"}
      <!-- Homeworld Talents (Task 6, Captain & Homeworld Talent Trees) --
           fleet-wide (not per-captain -- reads state.adminPoints /
           state.unlockedHomeworldTalents directly, never activeCaptain),
           placed after Refinery/Fabrication above. Same fixed-5-branch
           iteration pattern as the Captain Talents panel under Fleet Ops, so
           Homeland Defense/Citizenry (zero entries today, see model.ts)
           render as labeled, empty columns.

           Homeworld Talents are Fleet Admiral prestige, gated ENTIRELY on
           adminPoints -- deliberately independent of any individual
           captain's own level/statPoints (those only ever gate that
           captain's OWN Captain Talents, above under Fleet Ops). Confirmed
           with the user rather than inventing a captain-scoped gate for a
           fleet-wide purchase. -->
      <Panel>
        <div class="panel-title">HOMEWORLD TALENTS</div>
        <div class="research-cost">Admin Points: {formatNumber(state.adminPoints)}</div>
        {#each (["fleetLogistics", "homelandDefense", "citizenry", "economy", "industry"] as HomeworldTalentBranch[]) as branch}
          {@const nodes = Object.entries(HOMEWORLD_TALENTS).filter(([, def]) => def.branch === branch)}
          <div class="skill-branch">
            <div class="skill-branch-title">{branch}</div>
            {#if nodes.length === 0}
              <p class="prestige-text">Not yet available.</p>
            {:else}
              {#each nodes as [key, talent]}
                {@const owned = state.unlockedHomeworldTalents.includes(key as HomeworldTalentKey)}
                {@const locked = !owned && talent.requires !== null && !state.unlockedHomeworldTalents.includes(talent.requires)}
                {@const buyable = !owned && !locked && state.adminPoints >= talent.cost}
                <div class="skill-node" class:owned={owned} class:locked={locked}>
                  <div>
                    <div class="skill-node-label">{talent.label}</div>
                    <div class="skill-node-status">
                      {#if owned}
                        Owned
                      {:else if locked}
                        Requires: {HOMEWORLD_TALENTS[talent.requires!].label}
                      {:else}
                        Cost: {formatNumber(talent.cost)} Admin Points
                      {/if}
                    </div>
                  </div>
                  {#if !owned}
                    <button class="buy-btn" disabled={!buyable} on:click={() => doBuyHomeworldTalent(key as HomeworldTalentKey)}>
                      Unlock
                    </button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/each}
      </Panel>
      {/if}
      {/if}

      {#if activeTab === "sectorSpace"}
      <Panel>
        <div class="panel-title">SECTOR SPACE</div>
        <p class="prestige-text">Shipyard and Starbase are still under construction.</p>
      </Panel>
      {/if}

      {#if activeTab === "fleetCaptains"}
      <SubTabs
        tabs={[{ key: "overview", label: "Overview" }, { key: "talents", label: "Talents" }]}
        active={activeFleetCaptainSubTab}
        onSelect={(key) => (activeFleetCaptainSubTab = key as FleetCaptainSubTab)}
      />

      <div class="fleet-captains-layout">
        <div class="captain-list">
          {#each state.captains as captain, i}
            <button class="captain-list-item" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
              {captain.label}
            </button>
          {/each}
        </div>

        <div class="fleet-captains-content">
          {#if activeFleetCaptainSubTab === "overview"}
            <!-- Captain Leveling (Task 8, Phase 4; relocated into the Fleet
                 Captain's tab's Overview sub-tab during the UI Redesign,
                 Task 8 -- see docs/plans/2026-07-07-ui-redesign-plan.md) --
                 per-captain-scoped (reads activeCaptain, not the whole
                 fleet), replacing the spot Captain Prestige used to occupy.
                 The old Unlock section here (spending a captain's own
                 level/statPoints/Components to add a new captain slot) was
                 removed in Task 4 of
                 docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md
                 -- captain slot growth is now purchased fleet-wide through
                 the Homeworld Talents panel's Fleet Logistics branch
                 instead. The "Currently: Idle" / "Currently on: ..." line
                 below is new in the UI Redesign -- the MISSIONS panel itself
                 (dispatch/recall UI) does NOT live here; it moved to the
                 Fleet Operations tab (Task 9) instead. -->
            <Panel>
              <div class="panel-title">CAPTAIN LEVELING</div>
              <div class="research-name">Level {activeCaptain.level}</div>
              <div class="research-bar-track">
                <div class="research-bar-fill" style="width:{Math.min(100, (activeCaptain.xp / xpForNextLevel(activeCaptain.level)) * 100)}%"></div>
              </div>
              <div class="research-readout">{formatNumber(activeCaptain.xp)} / {formatNumber(xpForNextLevel(activeCaptain.level))} XP</div>
              <div class="research-cost">Stat Points: {formatNumber(activeCaptain.statPoints)}</div>
              <div class="research-cost">
                {#if activeCaptain.mission === null}
                  Currently: Idle
                {:else}
                  Currently on: {MISSIONS[activeCaptain.mission.missionKey].label}
                {/if}
              </div>
            </Panel>
          {:else if activeFleetCaptainSubTab === "talents"}
            <!-- Captain Talents (Task 6, Captain & Homeworld Talent Trees;
                 relocated into the Fleet Captain's tab's Talents sub-tab
                 during the UI Redesign, Task 8) -- per-captain-scoped, like
                 Captain Leveling above (reads activeCaptain, not the whole
                 fleet) -- spends THIS captain's own statPoints, records the
                 unlock on THIS captain only
                 (activeCaptain.unlockedCaptainTalents), never touches any
                 other captain's state. Iterates the FIXED 5-branch list, not
                 Object.keys(CAPTAIN_TALENTS) -- so Tactical/Science/Diplomacy
                 (currently zero entries, see model.ts) still render as
                 labeled, empty columns rather than not appearing at all. -->
            <Panel>
              <div class="panel-title">CAPTAIN TALENTS — {activeCaptain.label}</div>
              {#each (["command", "tactical", "science", "resourcefulness", "diplomacy"] as CaptainTalentBranch[]) as branch}
                {@const nodes = Object.entries(CAPTAIN_TALENTS).filter(([, def]) => def.branch === branch)}
                <div class="skill-branch">
                  <div class="skill-branch-title">{branch}</div>
                  {#if nodes.length === 0}
                    <p class="prestige-text">Not yet available.</p>
                  {:else}
                    {#each nodes as [key, talent]}
                      {@const owned = activeCaptain.unlockedCaptainTalents.includes(key as CaptainTalentKey)}
                      {@const locked = !owned && talent.requires !== null && !activeCaptain.unlockedCaptainTalents.includes(talent.requires)}
                      {@const buyable = !owned && !locked && activeCaptain.statPoints >= talent.cost}
                      <div class="skill-node" class:owned={owned} class:locked={locked}>
                        <div>
                          <div class="skill-node-label">{talent.label}</div>
                          <div class="skill-node-status">
                            {#if owned}
                              Owned
                            {:else if locked}
                              Requires: {CAPTAIN_TALENTS[talent.requires!].label}
                            {:else}
                              Cost: {formatNumber(talent.cost)} Stat Points
                            {/if}
                          </div>
                        </div>
                        {#if !owned}
                          <button class="buy-btn" disabled={!buyable} on:click={() => doBuyCaptainTalent(key as CaptainTalentKey)}>
                            Learn
                          </button>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              {/each}
            </Panel>
          {/if}
        </div>
      </div>
      {/if}

      {#if activeTab === "fleetOperations"}
      <!-- Fleet Operations (UI Redesign, Task 9 --
           docs/plans/2026-07-07-ui-redesign-plan.md) -- mission-first, NOT
           captain-scoped (deliberately does not read activeCaptain anywhere
           in this block). One Panel per MISSIONS entry, listing every
           captain currently embarked on THAT mission (progress + Recall)
           above a Dispatch list of every fleet-wide idle captain
           (mission === null). `eligible` is computed fleet-wide per mission
           iteration -- a captain already committed to mission A will show up
           in mission A's embarked list, but NOT in mission B's eligible
           list, since eligible only checks mission === null, not "not on
           THIS specific mission." -->
      {#each Object.entries(MISSIONS) as [missionKey, missionDef]}
        {@const embarked = state.captains.filter((c) => c.mission?.missionKey === missionKey)}
        {@const eligible = state.captains.filter((c) => c.mission === null)}
        <Panel>
          <div class="panel-title">{missionDef.label.toUpperCase()}</div>
          <div class="research-cost">Cargo capacity: {formatNumber(missionDef.cargoCapacity)}</div>

          {#each embarked as captain}
            {@const mission = captain.mission!}
            {@const requiredTicks = requiredTicksForPhase(mission.phase, missionDef)}
            {@const progress = Math.min(1, mission.phaseProgressTicks / requiredTicks)}
            {@const remainingTicks = Math.max(0, requiredTicks - mission.phaseProgressTicks)}
            <div class="mission-card">
              <div class="research-name">{captain.label}</div>
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
                <button class="recall-btn" on:click={() => doRecallCaptain(captain.id)}>Recall Captain</button>
              {/if}
            </div>
          {/each}

          {#if eligible.length > 0}
            <div class="mission-list">
              {#each eligible as captain}
                <div class="mission-card">
                  <div class="research-name">{captain.label}</div>
                  <button class="buy-btn" on:click={() => doDispatchCaptainOnMission(captain.id, missionKey as MissionKey)}>
                    Dispatch · {missionDef.label}
                  </button>
                </div>
              {/each}
            </div>
          {:else if embarked.length === 0}
            <p class="prestige-text">No eligible captains available.</p>
          {/if}
        </Panel>
      {/each}
      {/if}

      {#if activeTab === "battlespace"}
      <Panel>
        <div class="panel-title">BATTLESPACE</div>
        <p class="prestige-text">PvP and PvE fleet operations will live here.</p>
      </Panel>
      {/if}

      {#if activeTab === "system"}
      <SubTabs
        tabs={[{ key: "options", label: "Options" }, { key: "log", label: "Log" }, ...(DEV_MODE_ENV ? [{ key: "debug", label: "Debug" }] : [])]}
        active={activeSystemSubTab}
        onSelect={(key) => (activeSystemSubTab = key as SystemSubTab)}
      />

      {#if activeSystemSubTab === "options"}
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
      {/if}

      {#if DEV_MODE_ENV && activeSystemSubTab === "debug"}
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

      {#if activeSystemSubTab === "log"}
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
    min-height: 100dvh; /* see app.css's html/body comment -- same mobile-viewport issue */
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
       last in the active tab) would render partially underneath the bar.
       Also adds env(safe-area-inset-bottom) so devices with a gesture-nav
       home indicator (which eats into the same bottom region .nav-tabs sits
       in) get proportionally more clearance instead of a fixed guess that
       assumes no inset -- falls back to 0px on devices/browsers without it.
       Top padding grows to clear the new fixed .top-bar (added in the UI
       Redesign) -- mirrors how the bottom padding already clears the fixed
       .nav-tabs bar below. 90px is a generous estimate of .top-bar's real
       height (2 rows of text + 2 progress bars + padding); this is the one
       piece of this plan that genuinely benefits from a live-device check
       once deployed, since pixel-exact panel heights can't be verified
       without a renderer in this environment -- flag as such in the PR/
       session log if it's ever visibly off. */
    padding: calc(90px + env(safe-area-inset-top, 0px)) 16px calc(96px + env(safe-area-inset-bottom, 0px));
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
  /* Fixed to the TOP of the viewport, mirroring .nav-tabs' fixed-to-bottom
     treatment -- "always on top" per the design doc, visible regardless of
     which tab/sub-tab is active. Sits below the (non-fixed, scrolls-away)
     FLEET ADMIRAL title panel in document order, but visually pins above it
     once that panel scrolls out of view. */
  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--color-panel-bg-strong);
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    padding: 10px 16px;
    /* Devices with a notch/status-bar inset reserve a safe area at the TOP of
       the screen -- this bar sits flush against it (position: fixed, top: 0),
       so its own top padding needs to grow to clear that inset, same pattern
       as .nav-tabs' bottom padding already handles for the bottom inset. */
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }
  .top-bar-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .top-bar-label { font-size: 11px; letter-spacing: 0.5px; color: var(--color-accent); text-transform: uppercase; }
  .top-bar-value { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-secondary); }
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
    /* Devices with a gesture-nav home indicator reserve a safe area at the
       bottom of the screen -- without this, the bar's own bottom edge (and
       its tap targets) can sit under/behind that indicator. Matches
       .frame's own safe-area addition above so both grow together. */
    padding-bottom: env(safe-area-inset-bottom, 0px);
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
  /* Fleet Captain's tab layout (UI Redesign, Task 8) -- left-hand vertical
     captain list + right-hand content pane, replacing the old horizontal
     .captain-tabs row above (left in place for now; see this task's plan
     section and KNOWN_ISSUES.md re: whether it's still used anywhere once
     Task 11 does its final sweep). .captain-list-item is the SAME visual
     language as .captain-tab (rounded pill, accent-tinted background/
     border) -- deliberately reused styling, just in a vertical column
     instead of a horizontal row, since it's now sharing space with the
     content pane beside it rather than spanning the full width. */
  .fleet-captains-layout { display: flex; gap: 12px; align-items: flex-start; }
  .captain-list { display: flex; flex-direction: column; gap: 6px; flex: 0 0 96px; }
  .captain-list-item {
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 8px;
    padding: 10px 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .captain-list-item.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .fleet-captains-content { flex: 1; min-width: 0; }
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
