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
    type ModuleKey,
    type GameState,
  } from "./lib/game/model";
  import { tick, prestige } from "./lib/game/tick";
  import { formatNumber } from "./lib/game/format";
  import { saveToLocalStorage, loadFromLocalStorage, clearSave } from "./lib/game/save";
  import { loadTheme, saveTheme, THEME_NAMES, THEME_PREVIEW_COLORS, type ThemeName } from "./lib/theme";

  // DEV_MODE — Vercel §9.5.3: true on Preview, false on Production. Locally,
  // set VITE_DEV_MODE=true in .env.local (see .env.example).
  const DEV_MODE_ENV = import.meta.env.VITE_DEV_MODE === "true";

  let state: GameState = freshState();
  let createdAt = Date.now();
  let devPanelOpen = false;
  let currentTheme: ThemeName = "cyan";
  let optionsPanelOpen = false;
  let deleteModalOpen = false;
  let deleteConfirmText = "";
  let speed = 1;
  let logEntries: string[] = [];
  let barCycleStart = Date.now();
  let nowTick = Date.now();
  let paused = false;
  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;

  function pushLog(msg: string) {
    logEntries = [msg, ...logEntries].slice(0, 8);
  }

  function doSave() {
    saveToLocalStorage(state, createdAt);
  }

  onMount(() => {
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
    barCycleStart = Date.now();
    nowTick = Date.now();

    // Tick-bar loop — checks cycle progress every 100ms, fires a discrete
    // tick() call once per full cycle. barSeconds is floored at 1 real
    // second so dev-speed presets never make the bar flicker unreadably;
    // multiple game-ticks just batch into that one visual cycle, which is
    // still correct because tick() is closed-form (see design doc).
    tickHandle = setInterval(() => {
      if (speed === 0) {
        paused = true;
        return; // paused — bar and resources both freeze
      }
      const now = Date.now();
      if (paused) {
        // Resuming: discard the paused wall-clock gap entirely rather than
        // letting it read as elapsed cycle time (which would fire an
        // instant, unearned tick on resume).
        barCycleStart = now;
        nowTick = now;
        paused = false;
        return;
      }
      const barSeconds = Math.max(1, state.tickDurationSeconds / speed);
      nowTick = now;
      const progress = (now - barCycleStart) / 1000 / barSeconds;
      if (progress >= 1) {
        const gameSecondsThisCycle = barSeconds * speed;
        state = tick(gameSecondsThisCycle, state);
        barCycleStart = now;
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

  function buyModule(key: ModuleKey) {
    const cost = costFor(key, state.modules[key]);
    if (state.resources.ore < cost) return;
    state = {
      ...state,
      resources: { ...state.resources, ore: state.resources.ore - cost },
      modules: { ...state.modules, [key]: state.modules[key] + 1 },
    };
  }

  function doPrestige() {
    const { next, gained } = prestige(state);
    if (gained <= 0) return;
    state = next;
    pushLog(`Prestige performed. +${gained} Augment Points.`);
    doSave();
  }

  function grantResource(resource: keyof GameState["resources"], amount: number) {
    state = { ...state, resources: { ...state.resources, [resource]: state.resources[resource] + amount } };
    pushLog(`[DEV] Granted ${formatNumber(amount)} ${resource}.`);
  }

  function simulateOffline(hours: number) {
    state = tick(hours * 3600, state);
    pushLog(`[DEV] Simulated ${hours}h offline.`);
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

  $: mult = globalMultiplier(state);
  $: barSeconds = Math.max(1, state.tickDurationSeconds / (speed || 1));
  $: tickProgress = Math.min(1, Math.max(0, (nowTick - barCycleStart) / 1000 / barSeconds));
  $: tickRemaining = Math.max(0, barSeconds * (1 - tickProgress));
</script>

<div class="root">
  <Starfield />
  <div class="frame">
    <Panel class="header">
      <div class="header-left">
        <span class="title">FLEET ADMIRAL</span>
        <span class="subtitle">prototype build · single ship · single sector</span>
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
      <Panel>
        <div class="panel-title">RESOURCES</div>
        <div class="resource-grid">
          {#each RESOURCE_ORDER as r}
            <div class="resource-card">
              <div class="resource-label">{RESOURCE_LABEL[r]}</div>
              <div class="resource-value">{formatNumber(state.resources[r])}</div>
            </div>
          {/each}
        </div>
      </Panel>

      {#if optionsPanelOpen}
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
          <button class="dev-btn danger" on:click={() => (deleteModalOpen = true)}>Delete Save</button>
        </Panel>
      {/if}

      <Panel>
        <div class="panel-title">TICK</div>
        <div class="tick-bar-track">
          <div class="tick-bar-fill" style="width:{tickProgress * 100}%"></div>
        </div>
        <div class="tick-bar-readout">{tickRemaining.toFixed(1)}s</div>
      </Panel>

      <Panel>
        <div class="panel-title">GENERATOR STACK</div>
        <div class="module-list">
          {#each Object.entries(MODULES) as [key, m]}
            {@const count = state.modules[key as ModuleKey]}
            {@const cost = costFor(key as ModuleKey, count)}
            {@const rate = m.baseRate * count * mult}
            {@const perTick = rate * state.tickDurationSeconds}
            {@const affordable = state.resources.ore >= cost}
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
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">PRESTIGE — TIER 1</div>
        <p class="prestige-text">
          Retire this run for Augment Points (√ of lifetime components produced). Resources and modules reset;
          Augment Points and the global multiplier persist.
        </p>
        <div class="prestige-row">
          <div class="prestige-yield">
            Would yield <strong>{formatNumber(Math.floor(Math.sqrt(state.lifetimeComponents)))}</strong> Augment Points
          </div>
          <button class="prestige-btn" on:click={doPrestige}>Prestige</button>
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

  {#if deleteModalOpen}
    <div class="modal-backdrop">
      <Panel class="modal-dialog">
        <div class="panel-title">DELETE SAVE</div>
        <p class="modal-warning">This will permanently erase your progress. This can't be undone.</p>
        <p class="modal-instruction">Type <strong>DELETE</strong> to confirm.</p>
        <input class="modal-input" type="text" bind:value={deleteConfirmText} />
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
  .panel-title {
    font-size: 11px;
    letter-spacing: 1.5px;
    color: var(--color-accent);
    margin-bottom: 12px;
    font-weight: 600;
  }
  .resource-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .resource-card {
    padding: 10px 8px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    text-align: center;
  }
  .resource-label { font-size: 10px; color: var(--color-text-secondary); margin-bottom: 4px; }
  .resource-value { font-family: var(--font-mono); font-size: 16px; }
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
  .module-list { display: flex; flex-direction: column; gap: 10px; }
  .module-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
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
  .log-list { display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; }
  .log-empty { font-size: 12px; color: var(--color-text-dim); }
  .log-entry { font-size: 12px; color: #9fc4cc; font-family: var(--font-mono); }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
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
