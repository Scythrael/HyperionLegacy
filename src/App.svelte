<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Starfield from "./lib/Starfield.svelte";
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

  // DEV_MODE — Vercel §9.5.3: true on Preview, false on Production. Locally,
  // set VITE_DEV_MODE=true in .env.local (see .env.example).
  const DEV_MODE_ENV = import.meta.env.VITE_DEV_MODE === "true";

  let state: GameState = freshState();
  let createdAt = Date.now();
  let devPanelOpen = false;
  let speed = 1;
  let logEntries: string[] = [];
  let lastTick = Date.now();
  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;

  function pushLog(msg: string) {
    logEntries = [msg, ...logEntries].slice(0, 8);
  }

  function doSave() {
    saveToLocalStorage(state, createdAt);
  }

  onMount(() => {
    const loadedSave = loadFromLocalStorage();
    if (loadedSave) {
      createdAt = loadedSave.createdAt;
      const offlineSeconds = Math.max(0, (Date.now() - loadedSave.lastSavedAt) / 1000);
      state = offlineSeconds > 5 ? tick(offlineSeconds, loadedSave.state) : loadedSave.state;
      if (offlineSeconds > 5) pushLog(`Welcome back. Advanced ${formatNumber(offlineSeconds)}s offline.`);
    } else {
      pushLog("New save initialized.");
    }
    lastTick = Date.now();

    // Active tick loop — tech spec §2, nominal 10 Hz.
    tickHandle = setInterval(() => {
      const now = Date.now();
      const delta = ((now - lastTick) / 1000) * speed;
      lastTick = now;
      state = tick(delta, state);
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

  $: mult = globalMultiplier(state);
</script>

<div class="root">
  <Starfield />
  <div class="frame">
    <header class="panel header">
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
          <button class="icon-btn" on:click={() => (devPanelOpen = !devPanelOpen)} title="Toggle debug panel">⚙</button>
        {/if}
      </div>
    </header>

    <main class="main">
      <section class="panel">
        <div class="panel-title">RESOURCES</div>
        <div class="resource-grid">
          {#each RESOURCE_ORDER as r}
            <div class="resource-card">
              <div class="resource-label">{RESOURCE_LABEL[r]}</div>
              <div class="resource-value">{formatNumber(state.resources[r])}</div>
            </div>
          {/each}
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">GENERATOR STACK</div>
        <div class="module-list">
          {#each Object.entries(MODULES) as [key, m]}
            {@const count = state.modules[key as ModuleKey]}
            {@const cost = costFor(key as ModuleKey, count)}
            {@const rate = m.baseRate * count * mult}
            {@const affordable = state.resources.ore >= cost}
            <div class="module-card">
              <div class="module-top">
                <div>
                  <div class="module-name">{m.label}</div>
                  <div class="module-rate">{formatNumber(rate)} {m.unit} · owned {count}</div>
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
      </section>

      <section class="panel">
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
      </section>

      {#if DEV_MODE_ENV && devPanelOpen}
        <section class="panel dev-panel">
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
        </section>
      {/if}

      <section class="panel">
        <div class="panel-title">LOG</div>
        <div class="log-list">
          {#if logEntries.length === 0}
            <div class="log-empty">No events yet.</div>
          {/if}
          {#each logEntries as entry}
            <div class="log-entry">{entry}</div>
          {/each}
        </div>
      </section>
    </main>
  </div>
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
  .panel {
    padding: 16px;
    border-radius: 14px;
    background: var(--color-panel-bg);
    backdrop-filter: blur(10px);
    border: 1px solid var(--color-border);
    box-shadow: 0 0 24px rgba(30, 80, 100, 0.15);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
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
    background: rgba(103, 232, 249, 0.08);
    border: 1px solid rgba(103, 232, 249, 0.2);
    text-align: right;
  }
  .stat-label { font-size: 9px; color: var(--color-text-secondary); text-transform: uppercase; }
  .stat-value { font-family: var(--font-mono); font-size: 13px; color: var(--color-accent); }
  .icon-btn {
    background: rgba(103, 232, 249, 0.1);
    border: 1px solid rgba(103, 232, 249, 0.25);
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
    border: 1px solid rgba(103, 232, 249, 0.14);
    text-align: center;
  }
  .resource-label { font-size: 10px; color: var(--color-text-secondary); margin-bottom: 4px; }
  .resource-value { font-family: var(--font-mono); font-size: 16px; }
  .module-list { display: flex; flex-direction: column; gap: 10px; }
  .module-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(103, 232, 249, 0.12);
  }
  .module-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .module-name { font-size: 13px; font-weight: 600; }
  .module-rate { font-size: 11px; color: var(--color-text-secondary); font-family: var(--font-mono); margin-top: 2px; }
  .buy-btn {
    background: rgba(103, 232, 249, 0.15);
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
  .dev-panel { border-color: rgba(251, 191, 36, 0.5); }
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
</style>
