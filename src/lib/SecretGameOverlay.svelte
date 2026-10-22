<script lang="ts">
  // SecretGameOverlay: "Hyperion Legacy v0.0000001a", the secret generator game (0.13.11).
  //
  // A full-viewport layer above the whole app; the app behind it is blurred and dimmed but keeps
  // running and saving exactly as before (this component never touches the main state or loop;
  // the secret game ticks in secret/runtime.ts on its own clock). Drawn in the game's own tokens,
  // so it re-hues with the player's accent theme. Close with the X or Escape.
  //
  // Every number the player sees goes through the effective scale (engine.displayOre and
  // friends), which is the raw value up to e777,777 and the softened one above it.
  import { onMount } from "svelte";
  import Decimal from "break_infinity.js";
  import { focusTrap } from "./focusTrap";
  import Icon from "./ui/Icon.svelte";
  import { secretGame, secretCatchingUp, secretAct, catchUpSecretNow } from "./secret/runtime";
  import {
    effectiveExponent,
    displayOre,
    displayIncome,
    unitPrice,
    buyTier,
    overclockPrice,
    buyOverclock,
    tierMultiplier,
    isTierUnlocked,
    captainGain,
    fleetGain,
    prestigeceptionGain,
    doCaptain,
    doFleet,
    doPrestigeception,
    canBuySkill,
    buySkill,
    hasSkill,
    autoActive,
    setAuto,
    setAutoTarget,
    gainMultiplier,
    type BuyMode,
  } from "./secret/engine";
  import {
    TIERS,
    SKILLS,
    MILESTONES,
    COPY,
    AUTO_TARGET_CHOICES,
    FINALE_EXPONENT,
    LONG_EXPONENT,
    CP_POW,
    AP_POW,
    OC_FACTOR,
    type SkillId,
  } from "./secret/config";
  import type { SecretState, AutoLayer } from "./secret/state";
  import { formatSecret, formatExponent } from "./secret/format";

  export let onClose: () => void;

  type Tab = "generators" | "prestige" | "skills" | "milestones";
  const TABS: { key: Tab; label: string }[] = [
    { key: "generators", label: "Generators" },
    { key: "prestige", label: "Prestige" },
    { key: "skills", label: "Skills" },
    { key: "milestones", label: "Milestones" },
  ];
  let tab: Tab = "generators";

  onMount(() => {
    catchUpSecretNow();
  });

  $: s = $secretGame;
  $: busy = $secretCatchingUp;
  $: bestE = effectiveExponent(s.bestOre);
  $: goal = bestE < FINALE_EXPONENT ? FINALE_EXPONENT : bestE < LONG_EXPONENT ? LONG_EXPONENT : null;
  $: goalPct = goal === null ? 100 : Math.max(0, Math.min(100, (bestE / goal) * 100));
  $: celebration = s.milestones.finale !== undefined && !s.finaleSeen ? "finale" : s.milestones.long !== undefined && !s.longSeen ? "long" : null;
  $: ore = s.ore;
  $: cg = captainGain(s);
  $: fg = fleetGain(s);
  $: pg = prestigeceptionGain(s);

  const fmt = (d: Decimal) => formatSecret(displayOre(d));
  const pctLabel = (p: number) => (p >= 10 ? p.toFixed(1) : p.toFixed(2));

  function buy(tier: number, mode: BuyMode): void {
    secretAct((x) => buyTier(x, tier, mode));
  }
  function nextTenCost(x: SecretState, tier: number): Decimal {
    return unitPrice(x, tier).mul(10 - (x.bought[tier] % 10));
  }
  function nextUnlock(x: SecretState): string {
    const locked = TIERS.map((t, i) => ({ t, i })).filter(({ i }) => !isTierUnlocked(x, i));
    if (locked.length === 0) return "Every generator unlocked";
    return `${locked[0].t.name} at ${locked[0].t.unlockFleet} Fleet Prestiges`;
  }
  function skillOwnedLabel(id: SkillId, x: SecretState): string {
    const def = SKILLS.find((d) => d.id === id)!;
    if (!hasSkill(x, id)) return `${def.cost} Skill Point${def.cost === 1 ? "" : "s"}`;
    if (!def.auto) return "Owned";
    return autoActive(x, id) ? "On" : "Off";
  }
  function targetChange(layer: AutoLayer, event: Event): void {
    const pct = Number((event.currentTarget as HTMLSelectElement).value);
    secretAct((x) => setAutoTarget(x, layer, pct));
  }
  function dismissCelebration(kind: "finale" | "long"): void {
    secretAct((x) => ({ ...x, finaleSeen: kind === "finale" ? true : x.finaleSeen, longSeen: kind === "long" ? true : x.longSeen }));
  }
  function when(ms: number | undefined): string {
    if (ms === undefined) return "";
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const LAYERS: { layer: AutoLayer; skill: SkillId }[] = [
    { layer: "captain", skill: "autoCaptain" },
    { layer: "fleet", skill: "autoFleet" },
    { layer: "pc", skill: "autoPc" },
  ];
  const autoSkill = (layer: AutoLayer) => LAYERS.find((l) => l.layer === layer)!.skill;

  // Portal to <body> (the ActionModal pattern) so no transformed or clipped ancestor can trap the
  // fixed layer, and the blur covers the whole app.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<div class="sg-backdrop" use:portal>
  <div class="sg" role="dialog" aria-modal="true" aria-labelledby="sg-title" use:focusTrap={onClose}>
    <header class="sg-head">
      <div class="sg-titles">
        <div class="sg-title" id="sg-title">{COPY.title}</div>
        <div class="sg-sub">{COPY.subtitle}</div>
      </div>
      <div class="sg-ore">
        <b class="num">{fmt(ore)}</b>
        <span>Ore · <span class="num">+{formatSecret(displayIncome(s))}</span>/s</span>
      </div>
      <button class="sg-close" type="button" aria-label="Close" on:click={onClose}><Icon name="close" size={18} /></button>
    </header>

    <div class="sg-goal">
      <div class="sg-goal-row">
        {#if goal === null}
          <span>Goal complete. More is coming later.</span><span class="num">100%</span>
        {:else}
          <span>Goal: <span class="num">{formatExponent(goal)}</span> Ore</span><span class="num">{pctLabel(goalPct)}%</span>
        {/if}
      </div>
      <div
        class="sg-track"
        role="progressbar"
        aria-label={goal === null ? "Goal complete" : `Progress to ${formatExponent(goal)} Ore, on a log scale`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(goalPct)}
      >
        <i style={`width:${goalPct}%`}></i>
      </div>
    </div>

    {#if busy}
      <div class="sg-busy" role="status">Catching up on the time you were away...</div>
    {/if}

    {#if celebration === "finale"}
      <section class="sg-celebrate" aria-live="polite">
        <span class="sg-star"><Icon name="star" size={56} /></span>
        <h2>{COPY.finaleTitle}</h2>
        <p>{COPY.finaleBody}</p>
        <p class="muted">{COPY.finaleAfter}</p>
        <button class="sg-btn primary" type="button" on:click={() => dismissCelebration("finale")}>Keep going</button>
      </section>
    {:else if celebration === "long"}
      <section class="sg-celebrate" aria-live="polite">
        <span class="sg-star"><Icon name="star" size={56} /></span>
        <h2>{COPY.longTitle}</h2>
        <p>{COPY.longBody}</p>
        <p class="muted">{COPY.longAfter}</p>
        <button class="sg-btn primary" type="button" on:click={() => dismissCelebration("long")}>Keep going</button>
      </section>
    {:else}
      <div class="sg-tabs" role="tablist" aria-label="Secret game sections">
        {#each TABS as t}
          <button
            type="button"
            role="tab"
            class="sg-tab"
            class:on={tab === t.key}
            aria-selected={tab === t.key}
            on:click={() => (tab = t.key)}
          >{t.label}</button>
        {/each}
      </div>

      <div class="sg-body" role="tabpanel">
        {#if tab === "generators"}
          <div class="sg-section-name">GENERATOR STACK</div>
          {#each TIERS as t, i}
            {#if isTierUnlocked(s, i)}
              {@const price = unitPrice(s, i)}
              {@const ten = nextTenCost(s, i)}
              <div class="gen">
                <div class="tier">{t.numeral}</div>
                <div class="gname"><b>{t.name}</b><span>{t.makes}</span><em>{t.flavor}</em></div>
                <div class="gstats">
                  <span class="num">{formatSecret(s.owned[i])}</span> owned · <span class="num">×{formatSecret(tierMultiplier(s, i))}</span>
                  <div class="ten" aria-hidden="true"><i style={`width:${(s.bought[i] % 10) * 10}%`}></i></div>
                </div>
                <div class="buys">
                  <button class="sg-btn" type="button" disabled={busy || ore.lt(price)} on:click={() => buy(i, "one")}>Buy 1<span class="num">{fmt(price)}</span></button>
                  <button class="sg-btn" type="button" disabled={busy || ore.lt(ten)} on:click={() => buy(i, "ten")}>Buy 10<span class="num">{fmt(ten)}</span></button>
                  <button class="sg-btn primary" type="button" disabled={busy || ore.lt(price)} on:click={() => buy(i, "max")}>Max</button>
                </div>
              </div>
            {:else}
              <div class="gen locked">
                <div class="tier">{t.numeral}</div>
                <div class="gname"><b>{t.name}</b><span>Unlocks at Fleet Prestige {t.unlockFleet}</span></div>
                <div class="gstats dim">{t.makes}</div>
                <div class="buys"><button class="sg-btn" type="button" disabled>Locked</button></div>
              </div>
            {/if}
          {/each}
          <div class="sg-oc">
            <span>Overclock ×{OC_FACTOR} per level · level <span class="num">{formatSecret(s.overclock)}</span></span>
            <span class="buys">
              <button class="sg-btn" type="button" disabled={busy || ore.lt(overclockPrice(s))} on:click={() => secretAct((x) => buyOverclock(x, "one"))}>Overclock<span class="num">{fmt(overclockPrice(s))}</span></button>
              <button class="sg-btn primary" type="button" disabled={busy || ore.lt(overclockPrice(s))} on:click={() => secretAct((x) => buyOverclock(x, "max"))}>Max</button>
            </span>
          </div>
        {:else if tab === "prestige"}
          <div class="split">
            <div class="layer captain">
              <h3>CAPTAIN PRESTIGE</h3>
              <p class="muted">{COPY.captainBlurb}</p>
              <div class="kv">
                <span>Captain Points</span><span class="num">{formatSecret(s.captainPoints)}</span>
                <span>Multiplier from them</span><span class="num">×{formatSecret(s.captainPoints.add(1).pow(CP_POW))}</span>
                <span>Ready at</span><span class="num">1e60 Ore</span>
                <span>Prestige now for</span><span class="num">+{formatSecret(cg)} points</span>
              </div>
              <button class="sg-btn primary" type="button" disabled={busy || cg.lte(0)} on:click={() => secretAct((x, t) => doCaptain(x, t))}>Captain Prestige</button>
            </div>
            <div class="layer fleet">
              <h3>FLEET PRESTIGE</h3>
              <p class="muted">{COPY.fleetBlurb}</p>
              <div class="kv">
                <span>Fleet Prestiges</span><span class="num">{s.fleetCount} (lifetime {s.fleetTotal})</span>
                <span>Augment Points</span><span class="num">{formatSecret(s.augmentPoints)}</span>
                <span>Multiplier from them</span><span class="num">×{formatSecret(s.augmentPoints.add(1).pow(AP_POW))}</span>
                <span>Skill Points</span><span class="num">{s.skillPoints} unspent</span>
                <span>Next unlock</span><span class="num">{nextUnlock(s)}</span>
                <span>Prestige now for</span><span class="num">+{formatSecret(fg)} points</span>
              </div>
              <button class="sg-btn primary" type="button" disabled={busy || fg.lte(0)} on:click={() => secretAct((x, t) => doFleet(x, t))}>
                {fg.lte(0) ? "Fleet Prestige (needs 1.8e308 Ore)" : "Fleet Prestige"}
              </button>
            </div>
            <div class="layer pc">
              <h3>PRESTIGECEPTION</h3>
              <p class="muted">{COPY.pcBlurb}</p>
              <div class="kv">
                <span>Dream Points</span><span class="num">{formatSecret(s.dreamPoints)}</span>
                <span>Captain and Augment gains</span><span class="num">×{formatSecret(gainMultiplier(s))}</span>
                <span>Ready at</span><span class="num">{formatExponent(10000)} Ore</span>
                <span>Prestige now for</span><span class="num">+{formatSecret(pg)} points</span>
              </div>
              <button class="sg-btn primary" type="button" disabled={busy || pg.lte(0)} on:click={() => secretAct((x, t) => doPrestigeception(x, t))}>
                {pg.lte(0) ? `Prestigeception (needs ${formatExponent(10000)} Ore)` : "Prestigeception"}
              </button>
            </div>
          </div>
          {#if LAYERS.some((l) => hasSkill(s, l.skill))}
            <div class="layer autos">
              <h3>AUTO PRESTIGE</h3>
              {#each LAYERS as l}
                {#if hasSkill(s, l.skill)}
                  <label class="auto-row">
                    <span>{SKILLS.find((d) => d.id === autoSkill(l.layer))?.name}: when the gain is at least</span>
                    <select value={s.autoTarget[l.layer]} on:change={(e) => targetChange(l.layer, e)}>
                      {#each AUTO_TARGET_CHOICES as pct}<option value={pct}>{pct}% of what you have</option>{/each}
                    </select>
                  </label>
                {/if}
              {/each}
            </div>
          {/if}
        {:else if tab === "skills"}
          <div class="layer">
            <h3 class="skills-title">SKILLS <span class="muted">({s.skillPoints} Skill Point{s.skillPoints === 1 ? "" : "s"} to spend)</span></h3>
            <div class="nodes">
              {#each SKILLS as d}
                <div class="node" class:own={hasSkill(s, d.id)}>
                  <b>{d.name}</b>
                  <span class="muted">{d.blurb}</span>
                  {#if !hasSkill(s, d.id)}
                    <button class="sg-btn" type="button" disabled={busy || !canBuySkill(s, d.id)} on:click={() => secretAct((x, t) => buySkill(x, d.id, t))}>Learn · {skillOwnedLabel(d.id, s)}</button>
                  {:else if d.auto}
                    <button
                      class="sg-btn"
                      type="button"
                      aria-pressed={autoActive(s, d.id)}
                      on:click={() => secretAct((x) => setAuto(x, d.id, !autoActive(x, d.id)))}
                    >{skillOwnedLabel(d.id, s)}</button>
                  {:else}
                    <span class="owned">{skillOwnedLabel(d.id, s)}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <ul class="ms-list">
            {#each MILESTONES as m}
              {@const at = s.milestones[m.id]}
              <li class="ms" class:done={at !== undefined} class:final={m.achievement}>
                <span class="ms-icon">
                  {#if m.achievement}<Icon name="star" size={18} />{:else if at !== undefined}<Icon name="check" size={18} />{:else}<Icon name="circle" size={18} />{/if}
                </span>
                <span class="ms-name"><b>{m.name}</b><span class="muted">{m.detail}{at !== undefined ? ` · ${when(at)}` : ""}</span></span>
                <span class="rw">{at !== undefined ? COPY.rewardRecorded : COPY.rewardLater}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <footer class="sg-foot">
      <span>Esc or the X closes it. {COPY.footer}</span>
    </footer>
  </div>
</div>

<style>
  .sg-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 22px 16px;
    background: rgba(6, 10, 18, 0.55);
    -webkit-backdrop-filter: blur(6px) saturate(0.8);
    backdrop-filter: blur(6px) saturate(0.8);
    display: grid;
    place-items: start center;
  }
  .sg {
    width: min(860px, 100%);
    min-width: 0;
    background: linear-gradient(180deg, rgba(14, 28, 42, 0.96), rgba(8, 16, 26, 0.97));
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.65);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--text-md);
  }
  @media (prefers-reduced-motion: no-preference) {
    .sg {
      animation: sg-rise 0.35s ease-out;
    }
    @keyframes sg-rise {
      from {
        transform: translateY(14px);
        opacity: 0;
      }
    }
  }
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .dim {
    color: var(--color-text-dim);
  }
  .sg-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--space-6);
    align-items: start;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  .sg-title {
    font-family: var(--font-display);
    font-weight: 900;
    letter-spacing: 0.18em;
    font-size: var(--text-lg);
    color: var(--color-accent);
    overflow-wrap: anywhere;
  }
  .sg-sub {
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }
  .sg-ore {
    text-align: right;
    min-width: 0;
  }
  .sg-ore b {
    display: block;
    font-size: var(--text-2xl);
    font-weight: 600;
    line-height: 1.1;
  }
  .sg-ore span {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .sg-close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: var(--color-accent);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .sg-goal {
    padding: 8px 16px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  .sg-goal-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .sg-track {
    height: 6px;
    margin-top: 5px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    overflow: hidden;
  }
  .sg-track i {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--color-accent), var(--color-accent-bright));
  }
  .sg-busy {
    margin: 10px 16px 0;
    padding: 6px 10px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border: 1px dashed var(--color-border);
    border-radius: var(--corner);
  }
  .sg-tabs {
    display: flex;
    gap: var(--space-3);
    padding: 10px 16px 0;
    flex-wrap: wrap;
  }
  .sg-tab {
    min-height: 36px;
    font-size: var(--text-sm);
    padding: 4px 12px;
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .sg-tab.on {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
    background: rgba(var(--color-accent-rgb), 0.1);
  }
  .sg-body {
    padding: 10px 16px 16px;
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .sg-section-name {
    font-family: var(--font-display);
    font-size: var(--text-2xs);
    letter-spacing: 0.16em;
    color: var(--color-accent);
  }
  .sg-btn {
    min-height: 36px;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-accent);
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    padding: 5px 9px;
    cursor: pointer;
    white-space: nowrap;
  }
  .sg-btn:hover:not(:disabled) {
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .sg-btn.primary {
    background: rgba(var(--color-accent-rgb), 0.18);
    color: var(--color-text-primary);
  }
  .sg-btn:disabled {
    color: var(--color-text-disabled);
    border-color: var(--color-border);
    background: transparent;
    cursor: default;
    opacity: 0.7;
  }
  .sg-btn .num {
    display: block;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .sg-btn:focus-visible,
  .sg-tab:focus-visible,
  .sg-close:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .gen {
    display: grid;
    grid-template-columns: 30px minmax(150px, 1.3fr) minmax(130px, 1fr) auto;
    gap: var(--space-5);
    align-items: center;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.18);
    min-width: 0;
  }
  .gen.locked {
    opacity: 0.55;
    border-style: dashed;
  }
  .tier {
    font-family: var(--font-display);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    text-align: center;
  }
  .gname {
    min-width: 0;
  }
  .gname b {
    display: block;
    font-weight: 600;
  }
  .gname span {
    display: block;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .gname em {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
  }
  .gstats {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .gstats .num {
    color: var(--color-text-primary);
  }
  .ten {
    height: 3px;
    margin-top: 4px;
    background: rgba(0, 0, 0, 0.4);
  }
  .ten i {
    display: block;
    height: 100%;
    background: var(--color-warning);
  }
  .buys {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .sg-oc {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-5);
    flex-wrap: wrap;
    margin-top: var(--space-3);
    padding-top: var(--space-5);
    border-top: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .split {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
  }
  .layer {
    display: grid;
    gap: var(--space-4);
    align-content: start;
    padding: 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.18);
    min-width: 0;
  }
  .layer h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-md);
    letter-spacing: 0.12em;
  }
  .layer p {
    margin: 0;
    font-size: var(--text-sm);
  }
  .layer.captain h3 {
    color: var(--color-warning);
  }
  .layer.fleet {
    border-color: rgba(160, 32, 240, 0.45);
  }
  .layer.fleet h3,
  .layer.pc h3 {
    color: #c58cff;
  }
  .layer.pc {
    border-color: rgba(244, 114, 182, 0.45);
  }
  .kv {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 3px 10px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .kv .num {
    color: var(--color-text-primary);
    text-align: right;
    overflow-wrap: anywhere;
  }
  .layer .sg-btn {
    white-space: normal;
  }
  .autos {
    margin-top: var(--space-6);
  }
  .auto-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: center;
    font-size: var(--text-sm);
  }
  .auto-row select {
    min-height: 36px;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-deep);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    max-width: 100%;
  }
  .skills-title .muted {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    letter-spacing: 0;
  }
  .nodes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .node {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    font-size: var(--text-sm);
    min-width: 0;
  }
  .node.own {
    border-color: rgba(160, 32, 240, 0.6);
    background: rgba(160, 32, 240, 0.1);
  }
  .node .sg-btn {
    white-space: normal;
  }
  .owned {
    color: var(--color-accent);
  }
  .ms-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .ms {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: center;
    padding: 7px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    font-size: var(--text-sm);
  }
  .ms-icon {
    display: grid;
    place-items: center;
    color: var(--color-text-dim);
  }
  .ms.done .ms-icon {
    color: var(--color-success);
  }
  .ms.final {
    border-color: rgba(var(--color-warning-rgb), 0.5);
    background: rgba(var(--color-warning-rgb), 0.05);
  }
  .ms.final .ms-icon {
    color: var(--color-warning);
  }
  .ms-name b {
    display: block;
  }
  .ms-name .muted {
    font-size: var(--text-xs);
  }
  .rw {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    text-align: right;
  }
  .ms.done .rw {
    color: var(--color-accent);
  }
  .sg-celebrate {
    display: grid;
    justify-items: center;
    gap: var(--space-5);
    text-align: center;
    padding: 28px 20px;
  }
  .sg-celebrate h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: 0.14em;
    color: var(--color-warning);
  }
  .sg-celebrate p {
    margin: 0;
    max-width: 52ch;
  }
  .sg-star {
    color: var(--color-warning);
  }
  .sg-foot {
    padding: 10px 16px 14px;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }
  @media (max-width: 860px) {
    .split,
    .nodes {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 760px) {
    .sg-head {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .sg-ore {
      grid-column: 1 / -1;
      grid-row: 2;
      text-align: left;
    }
    .sg-ore b {
      font-size: var(--text-xl);
    }
    .gen {
      grid-template-columns: 26px minmax(0, 1fr);
    }
    .gen .gstats {
      grid-column: 2;
    }
    .gen .buys {
      grid-column: 1 / -1;
    }
    .gen .buys .sg-btn {
      flex: 1;
    }
  }
</style>
