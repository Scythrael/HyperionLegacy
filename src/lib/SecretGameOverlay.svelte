<script lang="ts">
  // SecretGameOverlay: "Hyperion Legacy v0.0000001a", the secret generator game (0.13.11; layout
  // reworked in 0.13.11.1, design section 4, mockup frames 4 to 7).
  //
  // A full-viewport layer above the whole app; the app behind it is blurred and dimmed but keeps
  // running and saving exactly as before (this component never touches the main state or loop;
  // the secret game ticks in secret/runtime.ts on its own clock). Drawn in the game's own tokens,
  // so it re-hues with the player's accent theme. Close with the X or Escape.
  //
  // 0.13.11.1: the whole panel stays within one screen and only its body scrolls. The goal bar, the run bar and
  // the "makes X" lines left the main view (their space stays empty on purpose); the goal and the
  // records live in the Stats view, the rules in the [?] Help view. Overclock moved to the new
  // Upgrades tab beside the four e1,000,000 upgrades. Anything not reachable yet reads "???".
  //
  // Every number the player sees goes through the effective scale (engine.displayOre and
  // friends), which is the raw value up to e777,777 and the softened one above it.
  import { onMount, tick } from "svelte";
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
    overclockQuote,
    upgradeQuote,
    allSkillsLearned,
    upgradeUnlocked,
    upgradeBlocked,
    type BuyQuote,
    canOverclock,
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
    captainMultiplier,
    augmentMultiplier,
    dreamSpeedMultiplier,
    prestigePreview,
    upgradesUnlocked,
    upgradeLevel,
    upgradePriceExponent,
    canBuyUpgrade,
    buyUpgrade,
    milestoneVisible,
    type BuyMode,
  } from "./secret/engine";
  import {
    TIERS,
    SKILLS,
    MILESTONES,
    UPGRADES,
    COPY,
    HELP_SECTIONS,
    AUTO_TARGET_CHOICES,
    FINALE_EXPONENT,
    LONG_EXPONENT,
    STARFALL_EXPONENT,
    OC_FACTOR,
    type SkillId,
    type UpgradeId,
  } from "./secret/config";
  import { cloneSecret, type SecretState, type AutoLayer } from "./secret/state";
  import { formatSecret, formatExponent, formatMultiplier } from "./secret/format";
  import { tabKeyTarget, overlayClosesOn } from "./secret/overlayKeys";

  export let onClose: () => void;

  type Tab = "generators" | "upgrades" | "prestige" | "skills" | "milestones";
  const TABS: { key: Tab; label: string }[] = [
    { key: "generators", label: "Generators" },
    { key: "upgrades", label: "Upgrades" },
    { key: "prestige", label: "Prestige" },
    { key: "skills", label: "Skills" },
    { key: "milestones", label: "Milestones" },
  ];
  let tab: Tab = "generators";
  // The main view, or one of the two header views.
  let view: "game" | "stats" | "help" = "game";

  let root: HTMLDivElement | null = null;
  let closeButton: HTMLButtonElement | null = null;
  let keepGoing: HTMLButtonElement | null = null;
  const tabButtons: Record<string, HTMLButtonElement | null> = {};

  // The panel is portaled to <body> after it renders, and moving a node drops its focus, so focus
  // is placed here, after mount, rather than trusting the focus trap's mount-time move.
  function focusInside(): void {
    (keepGoing ?? closeButton ?? root)?.focus();
  }

  onMount(() => {
    catchUpSecretNow();
    void tick().then(focusInside);
    // Anything underneath (a main-game window opening on its own, for example) that takes focus
    // while this is the top layer gets it taken straight back. Nothing in the main game changes.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (root && target && !root.contains(target) && !isPopup(target)) focusInside();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  });

  // The achievement popup sits above this layer and may take focus to be dismissed.
  function isPopup(target: Node): boolean {
    return target instanceof Element && target.closest(".ach-host") !== null;
  }

  // Escape closes it from anywhere: it is the top layer while open.
  function onWindowKeydown(event: KeyboardEvent): void {
    if (overlayClosesOn(event)) {
      event.preventDefault();
      onClose();
    }
  }

  function onTabKeydown(event: KeyboardEvent, index: number): void {
    const target = tabKeyTarget(index, event.key, TABS.length);
    if (target === null) return;
    event.preventDefault();
    selectTab(TABS[target].key);
    tabButtons[tab]?.focus();
  }

  function toggleView(next: "stats" | "help"): void {
    view = view === next ? "game" : next;
  }

  $: s = $secretGame;
  $: busy = $secretCatchingUp;
  $: bestE = effectiveExponent(s.bestOre);
  $: celebration = s.milestones.finale !== undefined && !s.finaleSeen ? "finale" : s.milestones.long !== undefined && !s.longSeen ? "long" : null;
  // A celebration that appears mid-play takes focus onto its "Keep going" button.
  let shownCelebration: string | null = null;
  $: if (celebration !== shownCelebration) {
    shownCelebration = celebration;
    if (celebration) void tick().then(() => keepGoing?.focus());
  }
  $: canOc = canOverclock(s);
  // Buy 10 and Max say what they will do (0.13.11.1, staging: Buy 10 looked like Max and showed no
  // price): Buy 10 buys at most ten levels, fewer only when Ore or the cap runs out.
  $: oc10 = overclockQuote(s, 10);
  $: ocMax = overclockQuote(s, Infinity);
  function tenLabel(q: BuyQuote): string {
    if (q.limitedBy === "cap" && q.count === 0) return COPY.maxed;
    if (q.limitedBy === "cap") return `Buy ${q.count} (to the cap)`;
    if (q.limitedBy === "ore" && q.count > 0) return `Buy ${q.count} of 10`;
    return "Buy 10";
  }
  function tenTitle(q: BuyQuote): string {
    if (q.limitedBy === "cap") return `Only ${q.count} level${q.count === 1 ? "" : "s"} left before the cap`;
    if (q.limitedBy === "ore") return q.count > 0 ? `Ore runs out after ${q.count} level${q.count === 1 ? "" : "s"}` : "Not enough Ore for one level";
    return "Buys ten levels";
  }
  const levelsLabel = (n: number) => `${formatSecret(n)} level${n === 1 ? "" : "s"}`;
  $: ore = s.ore;
  $: cg = captainGain(s);
  $: fg = fleetGain(s);
  $: pg = prestigeceptionGain(s);
  // 0.13.11.2: what resetting NOW does to each layer's multiplier, read off a real reset run on a
  // copy (engine prestigePreview). null hides the line while the layer pays nothing yet.
  $: previews = tab === "prestige" ? { captain: prestigePreview(s, "captain"), fleet: prestigePreview(s, "fleet"), pc: prestigePreview(s, "pc") } : null;
  const times = (d: Decimal) => `×${formatMultiplier(d)}`;
  $: upOpen = upgradesUnlocked(s);

  // The one-time Upgrades joke (user copy): shown on the first visit to the tab after the unlock.
  let showUpgradesNote = false;
  function selectTab(next: Tab): void {
    tab = next;
    if (next !== "upgrades") showUpgradesNote = false;
  }
  $: if (tab === "upgrades" && upOpen && !s.upgradesNoteSeen && !busy) {
    showUpgradesNote = true;
    secretAct((x) => ({ ...cloneSecret(x), upgradesNoteSeen: true }));
  }

  const fmt = (d: Decimal) => formatSecret(displayOre(d));
  const pct = (p: number) => Math.max(0, Math.min(100, p));

  function buy(tier: number, mode: BuyMode): void {
    secretAct((x) => buyTier(x, tier, mode));
  }
  function nextTenCost(x: SecretState, tier: number): Decimal {
    return unitPrice(x, tier).mul(10 - (x.bought[tier] % 10));
  }
  // Names no locked generator (they read "???" until unlocked).
  function nextUnlock(x: SecretState): string {
    const locked = TIERS.map((t, i) => ({ t, i })).filter(({ i }) => !isTierUnlocked(x, i));
    if (locked.length === 0) return "All unlocked";
    const n = locked[0].t.unlockFleet;
    return `Generator ${locked[0].t.numeral} at ${n} Fleet${n === 1 ? "" : "s"}`;
  }
  function skillOwnedLabel(id: SkillId, x: SecretState): string {
    const def = SKILLS.find((d) => d.id === id)!;
    if (!hasSkill(x, id)) return `${def.cost} Skill Point${def.cost === 1 ? "" : "s"}`;
    if (!def.auto) return "Owned";
    return autoActive(x, id) ? "On" : "Off";
  }
  function targetChange(layer: AutoLayer, event: Event): void {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    secretAct((x) => setAutoTarget(x, layer, value));
  }
  function dismissCelebration(kind: "finale" | "long"): void {
    secretAct((x) => ({ ...x, finaleSeen: kind === "finale" ? true : x.finaleSeen, longSeen: kind === "long" ? true : x.longSeen }));
  }
  function when(ms: number | undefined | null): string {
    if (ms === undefined || ms === null) return "";
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function duration(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60000));
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return d > 0 ? `${d}d ${h}h` : `${h}h ${m % 60}m`;
  }
  const LAYERS: { layer: AutoLayer; skill: SkillId }[] = [
    { layer: "captain", skill: "autoCaptain" },
    { layer: "fleet", skill: "autoFleet" },
    { layer: "pc", skill: "autoPc" },
  ];
  const autoSkill = (layer: AutoLayer) => LAYERS.find((l) => l.layer === layer)!.skill;

  // Overclock's per-level factor, after Overclock Overclocker.
  function ocPerLevel(x: SecretState): number {
    const step = UPGRADES.find((u) => u.id === "ocOverclocker")!.step;
    return Math.pow(OC_FACTOR, 1 + step * upgradeLevel(x, "ocOverclocker"));
  }
  function perLevelLabel(v: number): string {
    return v < 10 ? v.toFixed(3) : v < 1000 ? v.toFixed(1) : formatSecret(v);
  }
  function upgradePriceLabel(x: SecretState, id: UpgradeId): string {
    const e = upgradePriceExponent(x, id);
    return e === null ? "Maxed" : `${formatExponent(Math.ceil(e))} Ore`;
  }

  // Stats: the next Ore goal on a log scale, then the run against the best.
  const ORE_GOALS = [100, 1000, 100000, FINALE_EXPONENT, LONG_EXPONENT, STARFALL_EXPONENT];
  $: goal = ORE_GOALS.find((g) => bestE < g) ?? null;
  $: goalPct = goal === null ? 100 : pct((bestE / goal) * 100);
  $: runE = effectiveExponent(s.ore);
  $: runPct = bestE <= 0 ? 0 : pct((runE / bestE) * 100);
  $: visibleMilestones = MILESTONES.filter((m) => milestoneVisible(s, m.id));
  $: reachedCount = MILESTONES.filter((m) => s.milestones[m.id] !== undefined).length;
  function milestoneReward(id: string, reached: boolean): string {
    if (id === "starfall") return reached ? COPY.starfallRewardDone : COPY.starfallRewardLater;
    return reached ? COPY.rewardRecorded : COPY.rewardLater;
  }

  // Portal to <body> (the ActionModal pattern) so no transformed or clipped ancestor can trap the
  // fixed layer, and the blur covers the whole app.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<svelte:window on:keydown={onWindowKeydown} />

<div class="sg-backdrop" use:portal>
  <div class="sg" role="dialog" aria-modal="true" aria-labelledby="sg-title" tabindex="-1" bind:this={root} use:focusTrap={onClose}>
    <header class="sg-head">
      <div class="sg-titles">
        <div class="sg-title" id="sg-title">{COPY.title}</div>
        <div class="sg-sub">{COPY.subtitle}</div>
      </div>
      <div class="sg-tools">
        <button class="sg-tool" type="button" aria-pressed={view === "stats"} on:click={() => toggleView("stats")}><Icon name="chart" size={16} /><span>Stats</span></button>
        <button class="sg-tool sg-tool-square" type="button" aria-label="Help" aria-pressed={view === "help"} on:click={() => toggleView("help")}><Icon name="help" size={18} /></button>
        <button class="sg-tool sg-tool-square" type="button" aria-label="Close" bind:this={closeButton} on:click={onClose}><Icon name="close" size={18} /></button>
      </div>
    </header>

    <div class="sg-top">
      <div class="sg-ore">
        <b class="num">{fmt(ore)}</b>
        <span>Ore · <span class="num">+{formatSecret(displayIncome(s))}</span>/s</span>
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
        <button class="sg-btn primary" type="button" bind:this={keepGoing} disabled={busy} on:click={() => dismissCelebration("finale")}>Keep going</button>
      </section>
    {:else if celebration === "long"}
      <section class="sg-celebrate" aria-live="polite">
        <span class="sg-star"><Icon name="star" size={56} /></span>
        <h2>{COPY.longTitle}</h2>
        <p>{COPY.longBody}</p>
        <p class="muted">{COPY.longAfter}</p>
        <button class="sg-btn primary" type="button" bind:this={keepGoing} disabled={busy} on:click={() => dismissCelebration("long")}>Keep going</button>
      </section>
    {:else if view === "stats"}
      <section class="sg-body sg-view" aria-labelledby="sg-stats-title">
        <div class="sg-view-head">
          <h3 id="sg-stats-title" class="sg-section-name">STATS</h3>
          <button class="sg-btn" type="button" on:click={() => (view = "game")}>Back to the stack</button>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="k">Goal</div>
            {#if goal === null}
              <div class="v">Every goal reached</div>
            {:else}
              <div class="v"><span class="num">{formatExponent(goal)}</span> Ore · <span class="num">{goalPct.toFixed(2)}%</span></div>
            {/if}
            <div class="sg-track" role="progressbar" aria-label={goal === null ? "Every goal reached" : `Progress to ${formatExponent(goal)} Ore, on a log scale`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(goalPct)}><i style={`width:${goalPct}%`}></i></div>
          </div>
          <div class="stat">
            <div class="k">This run</div>
            <div class="v num">{formatExponent(Math.floor(runE))}</div>
            <div class="sg-track" aria-hidden="true"><i style={`width:${runPct}%`}></i></div>
          </div>
          <div class="stat"><div class="k">Most Ore ever</div><div class="v num">{fmt(s.bestOre)}</div></div>
          <div class="stat stat-wide">
            <div class="k">Most of each generator</div>
            <div class="v small">
              {#each TIERS as t, i}
                {#if isTierUnlocked(s, i)}<span class="peak"><span class="tier-label">{t.numeral}</span> <span class="num">{formatSecret(s.peakOwned[i])}</span></span>{/if}
              {/each}
            </div>
          </div>
          <div class="stat"><div class="k">Highest Overclock</div><div class="v">Lv <span class="num">{formatSecret(s.peakOverclock)}</span></div></div>
          <div class="stat">
            <div class="k">Prestiges</div>
            <div class="v small">Captain <span class="num">{formatSecret(s.captainCount)}</span> · Fleet <span class="num">{formatSecret(s.fleetTotal)}</span> · Prestigeception <span class="num">{formatSecret(s.pcCount)}</span></div>
          </div>
          <div class="stat">
            <div class="k">Points</div>
            <div class="v small">Captain <span class="num">{formatSecret(s.captainPoints)}</span> · Augment <span class="num">{formatSecret(s.augmentPoints)}</span> · Dream <span class="num">{formatSecret(s.dreamPoints)}</span></div>
          </div>
          <div class="stat"><div class="k">Milestones</div><div class="v"><span class="num">{reachedCount}</span> of <span class="num">{visibleMilestones.length}</span></div></div>
          <div class="stat"><div class="k">Time since found</div><div class="v">{s.foundAt === null ? "Since before 0.13.11.1" : duration(s.lastTickAt - s.foundAt)}</div></div>
          <div class="stat"><div class="k">First found</div><div class="v">{s.foundAt === null ? "Before 0.13.11.1" : when(s.foundAt)}</div></div>
        </div>
      </section>
    {:else if view === "help"}
      <section class="sg-body sg-view help" aria-labelledby="sg-help-title">
        <div class="sg-view-head">
          <h3 id="sg-help-title" class="sg-section-name">HOW IT WORKS</h3>
          <button class="sg-btn" type="button" on:click={() => (view = "game")}>Back to the stack</button>
        </div>
        {#each HELP_SECTIONS as h}
          <h4>{h.title}</h4>
          <p>{h.body}</p>
        {/each}
      </section>
    {:else}
      <div class="sg-tabs" role="tablist" aria-label="Secret game sections">
        {#each TABS as t, i}
          <button
            type="button"
            role="tab"
            id={`sg-tab-${t.key}`}
            class="sg-tab"
            class:on={tab === t.key}
            aria-selected={tab === t.key}
            aria-controls="sg-panel"
            tabindex={tab === t.key ? 0 : -1}
            bind:this={tabButtons[t.key]}
            on:click={() => selectTab(t.key)}
            on:keydown={(e) => onTabKeydown(e, i)}
          >{t.label}</button>
        {/each}
      </div>

      <div class="sg-body" role="tabpanel" id="sg-panel" aria-labelledby={`sg-tab-${tab}`}>
        {#if tab === "generators"}
          <div class="sg-section-name">GENERATOR STACK</div>
          {#each TIERS as t, i}
            {#if isTierUnlocked(s, i)}
              {@const price = unitPrice(s, i)}
              {@const ten = nextTenCost(s, i)}
              <div class="gen">
                <div class="tier">{t.numeral}</div>
                <div class="gname"><b>{t.name}</b><em>{t.flavor}</em></div>
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
                <div class="tier">?</div>
                <div class="gname"><b>???</b><em>???</em></div>
                <div class="gstats dim">{COPY.upgradesLocked}</div>
                <div class="buys"><button class="sg-btn" type="button" disabled>Locked</button></div>
              </div>
            {/if}
          {/each}
        {:else if tab === "upgrades"}
          {#if showUpgradesNote}
            <div class="sg-note" role="status">{COPY.upgradesNote}</div>
          {/if}
          <div class="sg-section-name">UPGRADES</div>
          <div class="gen">
            <div class="tier">OC</div>
            <div class="gname"><b>Overclock</b><em>{COPY.overclockFlavor}</em></div>
            <div class="gstats">Lv <span class="num">{formatSecret(s.overclock)}</span> · <span class="num">×{perLevelLabel(ocPerLevel(s))}</span> each</div>
            <div class="buys">
              <button class="sg-btn" type="button" disabled={busy || !canOc || ore.lt(overclockPrice(s))} on:click={() => secretAct((x) => buyOverclock(x, "one"))}>Buy 1<span class="num">{fmt(overclockPrice(s))}</span></button>
              <button class="sg-btn" type="button" title={tenTitle(oc10)} disabled={busy || !canOc || oc10.count === 0} on:click={() => secretAct((x) => buyOverclock(x, "ten"))}>{tenLabel(oc10)}<span class="num">{fmt(oc10.count > 0 && oc10.limitedBy ? oc10.cost : oc10.fullCost)}</span></button>
              <button class="sg-btn primary" type="button" disabled={busy || !canOc || ocMax.count === 0} on:click={() => secretAct((x) => buyOverclock(x, "max"))}>Max<span class="num">{levelsLabel(ocMax.count)}</span></button>
            </div>
          </div>
          {#each UPGRADES as u}
            <!-- 0.13.11.1 content pacing: each upgrade wakes at its own best Ore (upgradeUnlocked). A save
                 that already owns levels in one that now wakes later shows it, with buying blocked. -->
            {#if upgradeUnlocked(s, u.id) || upgradeLevel(s, u.id) > 0}
              {@const level = upgradeLevel(s, u.id)}
              {@const can = !busy && canBuyUpgrade(s, u.id)}
              {@const q10 = upgradeQuote(s, u.id, 10)}
              {@const qMax = upgradeQuote(s, u.id, Infinity)}
              {@const block = upgradeBlocked(s, u.id)}
              <div class="gen">
                <div class="tier">+</div>
                <div class="gname"><b>{u.name}</b><em>{u.flavor}</em></div>
                <div class="gstats">Lv <span class="num">{level} / {u.cap}</span> · {u.effect}</div>
                {#if block && level < u.cap}<div class="gstats dim">{block.kind === "asleep" ? `Wakes at ${formatExponent(block.unlockAt)} Ore` : COPY.needsOverdrive}</div>{/if}
                <div class="buys">
                  <button class="sg-btn" type="button" disabled={!can} on:click={() => secretAct((x) => buyUpgrade(x, u.id, "one"))}>Buy 1<span class="num">{upgradePriceLabel(s, u.id)}</span></button>
                  <button class="sg-btn" type="button" title={tenTitle(q10)} disabled={!can} on:click={() => secretAct((x) => buyUpgrade(x, u.id, "ten"))}>{tenLabel(q10)}{#if q10.fullCost.gt(0)}<span class="num">{fmt(q10.count > 0 && q10.limitedBy === "ore" ? q10.cost : q10.fullCost)}</span>{/if}</button>
                  <button class="sg-btn primary" type="button" disabled={!can} on:click={() => secretAct((x) => buyUpgrade(x, u.id, "max"))}>Max<span class="num">{level >= u.cap ? COPY.maxed : levelsLabel(qMax.count)}</span></button>
                </div>
              </div>
            {:else}
              <div class="gen locked">
                <div class="tier">?</div>
                <div class="gname"><b>???</b><em>???</em></div>
                <div class="gstats dim">{COPY.upgradesLocked}</div>
                <div class="buys"><button class="sg-btn" type="button" disabled>Locked</button></div>
              </div>
            {/if}
          {/each}
        {:else if tab === "prestige"}
          <div class="split">
            <div class="layer captain">
              <h3>CAPTAIN PRESTIGE</h3>
              <p class="muted">{COPY.captainBlurb}</p>
              <dl class="kv">
                <div><dt>Points</dt><dd class="num">{formatSecret(s.captainPoints)}</dd></div>
                <div><dt>Multiplier</dt><dd class="num">×{formatSecret(captainMultiplier(s))}</dd></div>
                <div><dt>Needs</dt><dd class="num">1e60 Ore</dd></div>
                <div><dt>Pays</dt><dd class="num">+{formatSecret(cg)} points</dd></div>
              </dl>
              {#if previews?.captain}
                <p class="preview">Captain Prestige now: <span class="num">{times(previews.captain.before.captain)}</span> to <span class="num">{times(previews.captain.after.captain)}</span> on the whole stack.</p>
              {/if}
              <button class="sg-btn primary" type="button" disabled={busy || cg.lte(0)} on:click={() => secretAct((x, t) => doCaptain(x, t))}>Captain Prestige</button>
            </div>
            <div class="layer fleet">
              <h3>FLEET PRESTIGE</h3>
              <p class="muted">{allSkillsLearned(s) ? COPY.fleetBlurbAllSkills : COPY.fleetBlurb}</p>
              <dl class="kv">
                <div><dt>Fleets</dt><dd class="num">{s.fleetCount} ({s.fleetTotal} lifetime)</dd></div>
                <div><dt>Points</dt><dd class="num">{formatSecret(s.augmentPoints)}</dd></div>
                <div><dt>Multiplier</dt><dd class="num">×{formatSecret(augmentMultiplier(s))}</dd></div>
                <div><dt>Skill Points</dt><dd class="num">{allSkillsLearned(s) ? COPY.allSkillsLearned : `${s.skillPoints} unspent`}</dd></div>
                <div><dt>Next unlock</dt><dd class="num">{nextUnlock(s)}</dd></div>
                <div><dt>Needs</dt><dd class="num">1.8e308 Ore</dd></div>
                <div><dt>Pays</dt><dd class="num">+{formatSecret(fg)} points{allSkillsLearned(s) ? "" : " + 1 Skill Point"}</dd></div>
              </dl>
              {#if previews?.fleet}
                <p class="preview">
                  Fleet Prestige now: Augment <span class="num">{times(previews.fleet.before.augment)}</span> to <span class="num">{times(previews.fleet.after.augment)}</span>. Captain Points go
                  back to 0, so the whole stack goes <span class="num">{times(previews.fleet.before.stack)}</span> to <span class="num">{times(previews.fleet.after.stack)}</span>.
                </p>
              {/if}
              <button class="sg-btn primary" type="button" disabled={busy || fg.lte(0)} on:click={() => secretAct((x, t) => doFleet(x, t))}>
                {fg.lte(0) ? "Fleet Prestige (needs 1.8e308 Ore)" : "Fleet Prestige"}
              </button>
            </div>
            <div class="layer pc">
              <h3>PRESTIGECEPTION</h3>
              <p class="muted">{COPY.pcBlurb}</p>
              <dl class="kv">
                <div><dt>Points</dt><dd class="num">{formatSecret(s.dreamPoints)}</dd></div>
                <div><dt>Gain boost</dt><dd class="num">×{formatSecret(gainMultiplier(s))}</dd></div>
                {#if upgradeLevel(s, "lucidDreaming") > 0}<div><dt>Speed boost</dt><dd class="num">×{formatSecret(dreamSpeedMultiplier(s))}</dd></div>{/if}
                <div><dt>Needs</dt><dd class="num">{formatExponent(10000)} Ore in one climb</dd></div>
                <div><dt>Pays</dt><dd class="num">+{formatSecret(pg)} points</dd></div>
              </dl>
              {#if previews?.pc}
                <p class="preview">
                  Prestigeception now: Captain and Augment gains <span class="num">{times(previews.pc.before.gains)}</span> to <span class="num">{times(previews.pc.after.gains)}</span>. Captain and
                  Augment Points go back to 0, so the whole stack goes <span class="num">{times(previews.pc.before.stack)}</span> to <span class="num">{times(previews.pc.after.stack)}</span>.{#if upgradeLevel(s, "lucidDreaming") > 0}
                    Dream Points speed the stack <span class="num">{times(previews.pc.before.dreamSpeed)}</span> to <span class="num">{times(previews.pc.after.dreamSpeed)}</span>.{/if}
                </p>
              {/if}
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
                    <select value={s.autoTarget[l.layer]} disabled={busy} on:change={(e) => targetChange(l.layer, e)}>
                      {#each AUTO_TARGET_CHOICES as choice}<option value={choice}>{choice}% of what you have</option>{/each}
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
                      disabled={busy}
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
              {#if milestoneVisible(s, m.id)}
                <li class="ms" class:done={at !== undefined} class:final={m.achievement}>
                  <span class="ms-icon">
                    {#if m.achievement}<Icon name="star" size={18} />{:else if at !== undefined}<Icon name="check" size={18} />{:else}<Icon name="circle" size={18} />{/if}
                  </span>
                  <span class="ms-name"><b>{m.name}</b><span class="muted">{m.detail}{at !== undefined ? ` · ${when(at)}` : ""}</span></span>
                  <span class="rw">{milestoneReward(m.id, at !== undefined)}</span>
                </li>
              {:else}
                <li class="ms hidden">
                  <span class="ms-icon"><Icon name="circle" size={18} /></span>
                  <span class="ms-name"><b>???</b><span class="muted">???</span></span>
                  <span class="rw">???</span>
                </li>
              {/if}
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
    /* The Fleet and Prestigeception hues: the mockup's violet and rose, mixed with the player's
       accent so they shift with the theme while keeping the look. */
    --sg-fleet: color-mix(in oklab, #b57bff 70%, var(--color-accent));
    --sg-fleet-border: color-mix(in srgb, var(--sg-fleet) 50%, transparent);
    --sg-pc: color-mix(in oklab, #f472b6 70%, var(--color-accent));
    --sg-pc-border: color-mix(in srgb, var(--sg-pc) 50%, transparent);
    position: fixed;
    inset: 0;
    z-index: 2000;
    overflow: hidden;
    padding: 22px 16px;
    background: rgba(6, 10, 18, 0.55);
    -webkit-backdrop-filter: blur(6px) saturate(0.8);
    backdrop-filter: blur(6px) saturate(0.8);
    display: grid;
    place-items: start center;
  }
  /* 0.13.11.1: the whole panel stays within one screen; only its body scrolls. */
  .sg {
    width: min(860px, 100%);
    min-width: 0;
    max-height: calc(100vh - 44px);
    max-height: calc(100dvh - 44px);
    display: flex;
    flex-direction: column;
    /* Theme-derived: the deep panel tones tinted by the player's accent, so it re-hues per theme. */
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-bg-mid) 88%, rgb(var(--color-accent-rgb)) 6%),
      color-mix(in srgb, var(--color-bg-deep) 94%, rgb(var(--color-accent-rgb)) 3%)
    );
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
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .sg-titles {
    min-width: 0;
    flex: 1 1 220px;
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
  .sg-tools {
    display: flex;
    gap: var(--space-3);
    margin-left: auto;
  }
  .sg-tool {
    height: 36px;
    min-width: 36px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-accent);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .sg-tool-square {
    padding: 0;
  }
  .sg-tool[aria-pressed="true"] {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
  }
  .sg-top {
    display: flex;
    gap: var(--space-6);
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
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
    margin: 10px 12px 0;
    padding: 6px 10px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border: 1px dashed var(--color-border);
    border-radius: var(--corner);
    flex-shrink: 0;
  }
  .sg-tabs {
    display: flex;
    gap: var(--space-3);
    padding: 10px 12px 0;
    flex-wrap: wrap;
    flex-shrink: 0;
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
    padding: 10px 12px 14px;
    display: grid;
    gap: var(--space-3);
    align-content: start;
    min-width: 0;
    min-height: 0;
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .sg-section-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-2xs);
    letter-spacing: 0.16em;
    color: var(--color-accent);
  }
  .sg-view-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .sg-note {
    padding: 8px 10px;
    font-size: var(--text-sm);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.25);
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
  .sg-tool:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .gen {
    display: grid;
    grid-template-columns: 30px minmax(150px, 1.3fr) minmax(130px, 1fr) auto;
    gap: var(--space-5);
    align-items: center;
    padding: 7px 10px;
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
    border-color: var(--sg-fleet-border);
  }
  .layer.fleet h3 {
    color: var(--sg-fleet);
  }
  .layer.pc h3 {
    color: var(--sg-pc);
  }
  .layer.pc {
    border-color: var(--sg-pc-border);
  }
  /* 0.13.11.2 (user: "Looks like the text is clipping a bit."): each row is a label and a value. The
     label never breaks; when the value has no room beside it, the value drops onto its own line under
     the label, right aligned, so the two can never collide. Nothing scrolls sideways. */
  .kv {
    display: grid;
    gap: 3px;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .kv > div {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0 10px;
    min-width: 0;
  }
  .kv dt {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .kv dd {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    margin: 0 0 0 auto;
    color: var(--color-text-primary);
    text-align: right;
    overflow-wrap: anywhere;
  }
  .layer .sg-btn {
    white-space: normal;
  }
  /* 0.13.11.2 prestige previews: the weight of resetting now, right above the button. */
  .layer p.preview {
    padding: 6px 8px;
    border-left: 3px solid var(--color-warning);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .layer.fleet p.preview {
    border-left-color: var(--sg-fleet);
  }
  .layer.pc p.preview {
    border-left-color: var(--sg-pc);
  }
  .preview .num {
    font-weight: 700;
    white-space: nowrap;
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
    border-color: var(--sg-fleet-border);
    background: color-mix(in srgb, var(--sg-fleet) 10%, transparent);
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
  .ms.hidden {
    opacity: 0.55;
    border-style: dashed;
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
  /* Stats (mockup frame 5): tiles in as many columns as there is room for, two on a phone. */
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-4);
  }
  .stat {
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.2);
  }
  .stat-wide {
    grid-column: span 2;
  }
  .stat .k {
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .stat .v {
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }
  .stat .v.small {
    font-size: var(--text-sm);
    line-height: 1.6;
  }
  .peak {
    display: inline-block;
    margin-right: 10px;
  }
  .tier-label {
    font-family: var(--font-display);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .help h4 {
    margin: 6px 0 0;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    letter-spacing: 0.1em;
    color: var(--color-accent);
  }
  .help p {
    margin: 0;
    max-width: 72ch;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .sg-celebrate {
    display: grid;
    justify-items: center;
    gap: var(--space-5);
    text-align: center;
    padding: 28px 20px;
    overflow-y: auto;
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
    padding: 8px 12px 10px;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    flex-shrink: 0;
  }
  @media (max-width: 860px) {
    .split,
    .nodes {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 480px) {
    .sg-backdrop {
      padding: 10px 8px;
    }
    /* Phones (user, 2026-10-23: the tabs were too large and overflowed): smaller tabs on ONE row
       that scrolls inside itself if a narrow phone still cannot hold all five; the page never
       scrolls sideways. */
    .sg-tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: thin;
      gap: var(--space-2);
      padding: 8px 10px 4px;
    }
    .sg-tab {
      flex: 0 0 auto;
      min-height: 32px;
      padding: 3px 8px;
      font-size: var(--text-xs);
    }
    .sg-head {
      padding: 8px 10px;
    }
    .sg-tool {
      height: 34px;
      min-width: 34px;
      padding: 0 8px;
      font-size: var(--text-xs);
    }
    .sg-tool-square {
      padding: 0;
    }
    .sg {
      max-height: calc(100vh - 20px);
      max-height: calc(100dvh - 20px);
    }
    .ms {
      grid-template-columns: 22px minmax(0, 1fr);
    }
    .ms .rw {
      grid-column: 2;
      text-align: left;
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .stat .v {
      font-size: var(--text-md);
    }
  }
  @media (max-width: 760px) {
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
