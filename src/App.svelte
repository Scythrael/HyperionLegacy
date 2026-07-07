<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Starfield from "./lib/Starfield.svelte";
  import Panel from "./lib/Panel.svelte";
  import {
    MODULES,
    RESOURCE_ORDER,
    RESOURCE_LABEL,
    freshState,
    costFor,
    globalMultiplier,
    captainMultiplier,
    specializationMultiplier,
    fleetLifetimeComponents,
    isModuleUnlocked,
    isResourceUnlocked,
    RESEARCH_PROJECTS,
    SPECIALIZATIONS,
    SKILL_TREE,
    researchDurationMult,
    MISSIONS,
    requiredTicksForPhase,
    type ModuleKey,
    type ResearchKey,
    type SpecializationKey,
    type SkillNodeKey,
    type GameState,
    type CaptainState,
    type MissionKey,
    type MissionPhase,
    type LootMaterialKey,
  } from "./lib/game/model";
  import {
    tick,
    tickCaptainStack,
    tickCaptainMission,
    dispatchCaptainOnMission,
    recallCaptain,
    prestige,
    captainPrestige,
    buySkillNode,
  } from "./lib/game/tick";
  import { formatNumber } from "./lib/game/format";
  import { saveToLocalStorage, loadFromLocalStorage, clearSave } from "./lib/game/save";
  import { loadTheme, saveTheme, THEME_NAMES, THEME_PREVIEW_COLORS, type ThemeName } from "./lib/theme";

  // DEV_MODE — Vercel §9.5.3: true on Preview, false on Production. Locally,
  // set VITE_DEV_MODE=true in .env.local (see .env.example).
  const DEV_MODE_ENV = import.meta.env.VITE_DEV_MODE === "true";

  // Display-only phase labels for the MISSIONS panel's phase readout. Purely
  // a UI concern (unlike RESOURCE_LABEL in model.ts, nothing outside this
  // file needs to map a MissionPhase to display text), so it lives here
  // rather than in model.ts. Must stay in sync with MissionPhase's literal
  // union -- a new phase added there without a matching entry here would
  // silently render "undefined" instead of a label.
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
  let optionsPanelOpen = false;
  let deleteModalOpen = false;
  let deleteConfirmText = "";
  let speed = 1;
  let logEntries: string[] = [];
  let activeCaptainIndex = 0;
  let paused = false;
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
    // firing tickCaptainStack (idle captains) or tickCaptainMission (captains
    // with an active mission -- Phase 3a) independently for whichever
    // captain(s) complete a cycle on this poll. Fleet-wide gameTimeSeconds
    // advances continuously off real elapsed time every poll, decoupled from
    // any single captain's cadence (gameTimeSeconds is fleet bookkeeping; it
    // is never read by tickCaptainStack's or tickCaptainMission's production
    // math, so this decoupling cannot desync production from time).
    // barSeconds is floored at 1 real second per captain so dev-speed
    // presets never make that captain's bar flicker unreadably — multiple
    // game-ticks just batch into one visual cycle, which is still correct
    // because both tickCaptainStack and tickCaptainMission are closed-form.
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
      const fleetMult = globalMultiplier(state); // invariant for this whole poll -- nothing in this loop touches augmentPoints
      const researchMults = {} as Record<ResearchKey, number>;
      for (const key of Object.keys(RESEARCH_PROJECTS) as ResearchKey[]) {
        researchMults[key] = researchDurationMult(state, key);
      }

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
        if (progress >= 1) {
          const gameSecondsThisCycle = barSeconds * speed;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          if (captain.mission) {
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
          } else {
            captains[i] = tickCaptainStack(gameSecondsThisCycle, captain, fleetMult, researchMults);
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
        // added ONTO existing totals, never replacing them.
        state = {
          ...state,
          homePlanet: {
            storage: {
              commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
              uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
              rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
            },
          },
        };
      }
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

  // Read the active captain via the `activeCaptain` derivation (or a local
  // `const captain = activeCaptain` alias) BEFORE calling this -- the `c`
  // argument passed into `updater` is the source of truth for the write.
  // Don't reference the outer `activeCaptain` inside the updater callback;
  // it's a closure-captured pre-update snapshot, not guaranteed to match `c`.
  function updateActiveCaptain(updater: (c: CaptainState) => CaptainState) {
    const captains = [...state.captains];
    captains[activeCaptainIndex] = updater(captains[activeCaptainIndex]);
    state = { ...state, captains };
  }

  function buyModule(key: ModuleKey) {
    const captain = activeCaptain;
    if (!isModuleUnlocked(key, captain)) return;
    const cost = costFor(key, captain.modules[key]);
    if (captain.resources.ore < cost) return;
    updateActiveCaptain((c) => ({
      ...c,
      resources: { ...c.resources, ore: c.resources.ore - cost },
      modules: { ...c.modules, [key]: c.modules[key] + 1 },
    }));
  }

  function doPrestige() {
    const { next, gained } = prestige(state);
    if (gained <= 0) return;
    state = next;
    activeCaptainIndex = 0; // Captain 1's slot always survives a Fleet Prestige reset, regardless of roster size
    pushLog(`Fleet Prestige performed. +${gained} Augment Points, +1 Skill Point. Captain roster reset.`);
    doSave();
  }

  function doCaptainPrestige(spec: SpecializationKey) {
    const { next, gained } = captainPrestige(state, activeCaptain.id, spec);
    if (gained <= 0) return;
    const label = activeCaptain.label;
    state = next;
    pushLog(`[${label}] Captain Prestige performed. +${gained} Captain Points (${SPECIALIZATIONS[spec].label}).`);
    doSave();
  }

  function doBuySkillNode(nodeKey: SkillNodeKey) {
    const { next, success } = buySkillNode(state, nodeKey);
    if (!success) return;
    state = next;
    pushLog(`Skill unlocked: ${SKILL_TREE[nodeKey].label}.`);
    doSave();
  }

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
    const missionLabel = MISSIONS[captain.mission!.missionKey].label; // captured before the state swap below, mirrors doCaptainPrestige's `label` capture
    const { next, success } = recallCaptain(state, captain.id);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Recall ordered — returning to base from: ${missionLabel}.`);
    doSave();
  }

  function grantResource(resource: keyof CaptainState["resources"], amount: number) {
    updateActiveCaptain((c) => ({ ...c, resources: { ...c.resources, [resource]: c.resources[resource] + amount } }));
    pushLog(`[${activeCaptain.label}] [DEV] Granted ${formatNumber(amount)} ${resource}.`);
  }

  function simulateOffline(hours: number) {
    state = tick(hours * 3600, state); // fleet-wide: advances every captain, matches real offline catch-up
    pushLog(`[DEV] Simulated ${hours}h offline for the whole fleet.`);
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

  function startResearch(key: ResearchKey) {
    const project = RESEARCH_PROJECTS[key];
    const captain = activeCaptain;
    const entry = captain.research[key];
    if (entry.started || entry.completed) return; // not safe to call twice by construction otherwise
    if (captain.resources.components < project.costComponents) return;
    updateActiveCaptain((c) => ({
      ...c,
      resources: { ...c.resources, components: c.resources.components - project.costComponents },
      research: { ...c.research, [key]: { ...entry, started: true } },
    }));
    pushLog(`[${captain.label}] Research started: ${project.label}.`);
  }

  $: mult = globalMultiplier(state);
  $: activeCaptain = state.captains[activeCaptainIndex];
  // Fallback only covers the one-frame window before onMount's
  // ensureCaptainCycles seeds an entry. It assumes captains.length never
  // shrinks and activeCaptainIndex never points past the end -- true today
  // since only freshCaptains() ever replaces the whole array, and the
  // roster can be any size >= 1 (Command-branch skill nodes and Fleet
  // Prestige only ever grow it or reset it back to captainSlotCount(state),
  // never shrink it below 1). If a future feature ever removes a captain
  // slot, this fallback would silently show 0% progress instead of
  // erroring; revisit this assumption then.
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
        <div class="stat-pill">
          <div class="stat-label">Augment Pts</div>
          <div class="stat-value">{formatNumber(state.augmentPoints)}</div>
        </div>
        <div class="stat-pill">
          <div class="stat-label">Multiplier</div>
          <div class="stat-value">×{mult.toFixed(2)}</div>
        </div>
        {#if DEV_MODE_ENV}
          <button class="icon-btn" on:click={() => (devPanelOpen = !devPanelOpen)} title="Toggle debug panel">Dev</button>
        {/if}
        <button class="icon-btn" on:click={() => (optionsPanelOpen = !optionsPanelOpen)} title="Options" aria-label="Options">⚙</button>
      </div>
    </Panel>

    <main class="main">
      <div class="captain-tabs">
        {#each state.captains as captain, i}
          <button class="captain-tab" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
            {captain.label}
          </button>
        {/each}
      </div>

      <Panel>
        <div class="panel-title">RESOURCES</div>
        <div class="resource-grid">
          {#each RESOURCE_ORDER as r}
            {@const unlocked = isResourceUnlocked(r, activeCaptain)}
            <div class="resource-card">
              <div class="resource-label">{RESOURCE_LABEL[r]}</div>
              {#if unlocked}
                <div class="resource-value">{formatNumber(activeCaptain.resources[r])}</div>
              {:else}
                <div class="resource-value locked">🔒</div>
              {/if}
            </div>
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">TICK</div>
        <div class="tick-bar-track">
          <div class="tick-bar-fill" style="width:{activeTickProgress * 100}%"></div>
        </div>
        <div class="tick-bar-readout">{activeTickRemaining.toFixed(1)}s</div>
      </Panel>

      <Panel>
        <div class="panel-title">GENERATOR STACK</div>
        <div class="module-list">
          {#each Object.entries(MODULES) as [key, m]}
            {@const unlocked = isModuleUnlocked(key as ModuleKey, activeCaptain)}
            {#if unlocked}
              {@const count = activeCaptain.modules[key as ModuleKey]}
              {@const cost = costFor(key as ModuleKey, count)}
              {@const specMult = specializationMultiplier(activeCaptain, m.resource)}
              {@const rate = m.baseRate * count * mult * captainMultiplier(activeCaptain) * specMult}
              {@const perTick = rate * activeCaptain.tickDurationSeconds}
              {@const affordable = activeCaptain.resources.ore >= cost}
              <div class="module-card">
                <div class="module-top">
                  <div>
                    <div class="module-name">{m.label}</div>
                    <div class="module-rate">
                      {formatNumber(perTick)} {m.unit.replace("/s", "")}/tick · {formatNumber(rate)} {m.unit} · owned {count}
                    </div>
                  </div>
                  <button
                    class="buy-btn"
                    disabled={!affordable}
                    style="opacity:{affordable ? 1 : 0.4}"
                    on:click={() => buyModule(key as ModuleKey)}
                  >
                    Buy · {formatNumber(cost)} ore
                  </button>
                </div>
              </div>
            {:else}
              <div class="module-card locked">
                <div class="module-top">
                  <div>
                    <div class="module-name">{m.label}</div>
                    <div class="module-rate">🔒 Locked — requires {RESEARCH_PROJECTS.alloySynthesis.label} research</div>
                  </div>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">RESEARCH</div>
        {#if activeCaptain.research.alloySynthesis.completed}
          <p class="research-status">✓ {RESEARCH_PROJECTS.alloySynthesis.label} — Complete</p>
        {:else if activeCaptain.research.alloySynthesis.started}
          {@const project = RESEARCH_PROJECTS.alloySynthesis}
          {@const effectiveDuration = project.durationSeconds * researchDurationMult(state, "alloySynthesis")}
          {@const progress = Math.min(1, activeCaptain.research.alloySynthesis.progressSeconds / effectiveDuration)}
          {@const remaining = Math.max(0, effectiveDuration - activeCaptain.research.alloySynthesis.progressSeconds)}
          <div class="research-name">{project.label}</div>
          <div class="research-bar-track">
            <div class="research-bar-fill" style="width:{progress * 100}%"></div>
          </div>
          <div class="research-readout">{remaining.toFixed(0)}s remaining</div>
        {:else}
          {@const project = RESEARCH_PROJECTS.alloySynthesis}
          {@const effectiveDuration = project.durationSeconds * researchDurationMult(state, "alloySynthesis")}
          {@const affordable = activeCaptain.resources.components >= project.costComponents}
          <div class="research-name">{project.label}</div>
          <div class="research-cost">Cost: {formatNumber(project.costComponents)} components</div>
          <div class="research-cost">Duration: {effectiveDuration.toFixed(0)}s</div>
          <button
            class="buy-btn"
            disabled={!affordable}
            style="opacity:{affordable ? 1 : 0.4}"
            on:click={() => startResearch("alloySynthesis")}
          >
            Start Research
          </button>
        {/if}
      </Panel>

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
          {#if mission.recalled}
            <p class="prestige-text mission-recalled-text">Recall ordered — returning to base once the current cycle's unloading completes.</p>
          {:else}
            <button class="recall-btn" on:click={doRecallCaptain}>Recall Captain</button>
          {/if}
        {/if}
      </Panel>

      <Panel>
        <div class="panel-title">CAPTAIN PRESTIGE — TIER 1</div>
        {@const captainGain = Math.floor(Math.sqrt(activeCaptain.lifetimeComponents))}
        <p class="prestige-text">
          Retire {activeCaptain.label}'s current run for Captain Points (√ of THIS captain's lifetime
          components). Resets {activeCaptain.label}'s resources, modules, and research. Choose a
          specialization as part of the reset — picking again later respecs. If {activeCaptain.label}
          is on an active mission, prestiging cancels it immediately and any in-transit cargo is lost.
        </p>
        <div class="prestige-row">
          <div class="prestige-yield">
            Would yield <strong>{formatNumber(captainGain)}</strong> Captain Points
          </div>
        </div>
        {#if activeCaptain.specialization}
          <div class="spec-current">
            Current specialization: <strong>{SPECIALIZATIONS[activeCaptain.specialization].label}</strong>
            · {formatNumber(activeCaptain.captainPoints)} Captain Points · {activeCaptain.captainPrestigeCount} prestiges
          </div>
        {/if}
        <div class="spec-picker">
          {#each Object.entries(SPECIALIZATIONS) as [key, def]}
            <button
              class="spec-btn"
              disabled={captainGain <= 0}
              style="opacity:{captainGain <= 0 ? 0.4 : 1}"
              on:click={() => doCaptainPrestige(key as SpecializationKey)}
            >
              {def.label}
            </button>
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">FLEET PRESTIGE — TIER 2</div>
        {@const fleetGain = Math.floor(Math.sqrt(fleetLifetimeComponents(state)))}
        <p class="prestige-text">
          Retire the WHOLE FLEET for Augment Points and a Skill Point (√ of combined lifetime
          components across every captain). Resets every captain back to your currently unlocked
          roster size — wiping all specializations, Captain Points, and individual progress along
          with resources and modules. Augment Points, the global multiplier, and your unlocked
          skills all persist. Any captain on an active mission has it cancelled immediately, losing
          any in-transit cargo.
        </p>
        <div class="prestige-row">
          <div class="prestige-yield">
            Would yield <strong>{formatNumber(fleetGain)}</strong> Augment Points
          </div>
          <button
            class="prestige-btn"
            disabled={fleetGain <= 0}
            style="opacity:{fleetGain <= 0 ? 0.4 : 1}"
            on:click={doPrestige}
          >
            Fleet Prestige
          </button>
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">SKILL TREE</div>
        <p class="prestige-text">
          Unspent Skill Points: <strong>{formatNumber(state.skillPoints)}</strong>
        </p>
        <div class="skill-branch">
          <div class="skill-branch-title">Command</div>
          {#each Object.entries(SKILL_TREE).filter(([, n]) => n.branch === "command") as [key, node]}
            {@const nodeKey = key as SkillNodeKey}
            {@const owned = state.unlockedSkillNodes.includes(nodeKey)}
            {@const prereqMet = !node.requires || state.unlockedSkillNodes.includes(node.requires)}
            {@const affordable = state.skillPoints >= node.costSkillPoints}
            <div class="skill-node" class:owned class:locked={!prereqMet && !owned}>
              <div class="skill-node-label">{node.label}</div>
              {#if owned}
                <span class="skill-node-status">✓ Unlocked</span>
              {:else if !prereqMet}
                <span class="skill-node-status">🔒 Requires previous rank</span>
              {:else}
                <button
                  class="buy-btn"
                  disabled={!affordable}
                  style="opacity:{affordable ? 1 : 0.4}"
                  on:click={() => doBuySkillNode(nodeKey)}
                >
                  Unlock · {node.costSkillPoints} Skill Points
                </button>
              {/if}
            </div>
          {/each}
        </div>
        <div class="skill-branch">
          <div class="skill-branch-title">Research</div>
          {#each Object.entries(SKILL_TREE).filter(([, n]) => n.branch === "research") as [key, node]}
            {@const nodeKey = key as SkillNodeKey}
            {@const owned = state.unlockedSkillNodes.includes(nodeKey)}
            {@const prereqMet = !node.requires || state.unlockedSkillNodes.includes(node.requires)}
            {@const affordable = state.skillPoints >= node.costSkillPoints}
            <div class="skill-node" class:owned class:locked={!prereqMet && !owned}>
              <div class="skill-node-label">{node.label}</div>
              {#if owned}
                <span class="skill-node-status">✓ Unlocked</span>
              {:else if !prereqMet}
                <span class="skill-node-status">🔒 Requires previous rank</span>
              {:else}
                <button
                  class="buy-btn"
                  disabled={!affordable}
                  style="opacity:{affordable ? 1 : 0.4}"
                  on:click={() => doBuySkillNode(nodeKey)}
                >
                  Unlock · {node.costSkillPoints} Skill Points
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </Panel>

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
            <span class="dev-label">Grant</span>
            <button class="dev-btn" on:click={() => grantResource("ore", 1000)}>+1K ore</button>
            <button class="dev-btn" on:click={() => grantResource("ingots", 1000)}>+1K ingots</button>
            <button class="dev-btn" on:click={() => grantResource("components", 1000)}>+1K components</button>
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
    </main>
  </div>

  {#if optionsPanelOpen}
    <div class="modal-backdrop">
      <Panel class="modal-dialog">
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
        <button class="dev-btn danger" on:click={() => (deleteModalOpen = true)}>Delete Save</button>
        <div class="modal-row">
          <button class="dev-btn" on:click={() => (optionsPanelOpen = false)}>Close</button>
        </div>
      </Panel>
    </div>
  {/if}

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
    padding: 20px 16px 60px;
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
