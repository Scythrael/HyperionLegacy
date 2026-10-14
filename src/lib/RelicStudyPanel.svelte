<script lang="ts">
  // ============================================================================
  // RelicStudyPanel.svelte
  // Author: Claude (Opus 5.5) | Exploration 0.14.0 phase E4c (Relic + Museum UI)
  //
  // The Research facility's RELICS sub-tab. It realizes the "Study the Relics" half of the approved
  // "Relic Museum" mockup (2026-10-01) inside the facility console: the RELIC VAULT of unidentified
  // tokens, the STUDY LANE (select a token -> Study, the in-flight study with its real countdown, the
  // facility / lane gates with their reasons, the tier-skew hint), and the IDENTIFICATION REVEAL card
  // for the most recently completed study (first-find banner, copy number, View in Museum).
  //
  // POSTURE (mirrors ExpeditionPanel / GambitEditorPanel exactly):
  //   - PURE PRESENTATION + INTERACTION. It READS live state through the already-tested engine readers
  //     (tick.ts canStartRelicStudy / relicStudiesInFlight / relicStudySlotCount /
  //     museumResearchDurationTicks, relics.ts relicStudyDurationTicks / museumBonuses) and NEVER mutates
  //     state: Study bubbles UP to the host via onStudy (App.svelte runs startRelicStudy + pushLog +
  //     doSave in one place). The reveal is computed by the host's OBSERVER (it reads the completed-events
  //     record, never an inventory diff) and handed in as a prop.
  //   - TIME READOUTS come from the host as formatter props (formatRemaining / formatDuration), so this
  //     panel shows exactly the strings every other console shows, including the tick-count preference.
  //   - RESPONSIVE the container-query way (ONE shared DOM, split by CSS only, NO isMobile JS): a narrow
  //     container stacks the cards, a fresh reveal ABOVE the vault (the payoff first on a phone), the
  //     empty "Identified" card below it; a wide one (>= 769px)
  //     puts the vault + lane on the left and the reveal on the right, like the mockup. Works at 375px.
  //   - EVERY GRAPHIC IS SVG via <Icon> (user hard requirement): glyphs come from ui/relicIcons.ts.
  // ============================================================================

  import type { GameState, RelicVaultToken, EquipmentRarity, TimedProcess } from "./game/model";
  import { rarityIndex } from "./game/model";
  import {
    canStartRelicStudy,
    relicStudiesInFlight,
    relicStudySlotCount,
    museumResearchDurationTicks,
    type RelicStudyBlockReason,
  } from "./game/tick";
  import { relicStudyDurationTicks, museumBonuses } from "./game/relics";
  import { groundSiteLabel } from "./game/expeditionContent";
  import { equipmentRarityColor } from "./EquipmentTooltip.svelte";
  import Icon from "./ui/Icon.svelte";
  import { relicIcon, relicSetShortLabel, relicRarityColor, RELIC_RARITY_LABEL, RELIC_SET_IDS } from "./ui/relicIcons";
  import type { RelicReveal } from "./relicReveal";

  // --- Props ------------------------------------------------------------------
  export let state: GameState;
  // The most recently completed study's reveal (the host's observer), or null when none this session.
  export let reveal: RelicReveal | null = null;
  // Study a vault token. Host: startRelicStudy -> pushLog -> doSave.
  export let onStudy: (tokenId: string) => void;
  // Jump to the Archive's Museum sub-tab.
  export let onViewMuseum: () => void;
  // Clear the reveal card.
  export let onDismissReveal: () => void;
  // Live countdown text (the host's remainingReadout, with the tick-count preference applied).
  export let formatRemaining: (remainingTicks: number, totalTicks: number) => string;
  // Static duration text (the host's durationReadout, with the tick-count preference applied).
  export let formatDuration: (ticks: number) => string;

  // --- Local UI state ---------------------------------------------------------
  let selectedTokenId: string | null = null;

  // --- Derived reads ----------------------------------------------------------
  function setOrder(t: RelicVaultToken): number {
    const i = RELIC_SET_IDS.indexOf(t.setId);
    return i < 0 ? RELIC_SET_IDS.length : i;
  }
  // The vault, rarest tier first (the mockup's order), then by set, then by arrival (stable sort).
  $: vault = [...(state.relicVault ?? [])].sort((a, b) => rarityIndex(b.tier) - rarityIndex(a.tier) || setOrder(a) - setOrder(b));
  // Default / repair the selection: keep the pick while it is still in the vault, else the first token.
  $: if (vault.length > 0 && (selectedTokenId === null || !vault.some((t) => t.id === selectedTokenId))) {
    selectedTokenId = vault[0].id;
  }
  $: if (vault.length === 0 && selectedTokenId !== null) selectedTokenId = null;
  $: selected = vault.find((t) => t.id === selectedTokenId) ?? null;

  $: studies = relicStudiesInFlight(state);
  $: lanes = relicStudySlotCount(state);
  $: researchSpeed = museumBonuses(state).researchSpeed;
  $: gate = selected ? canStartRelicStudy(state, selected.id) : null;

  // The REAL study time a token would take if started now: the tier-scaled base, shortened by the
  // museum's research speed, through the exact two functions startRelicStudy uses.
  function studyTicks(tier: EquipmentRarity): number {
    return museumResearchDurationTicks(relicStudyDurationTicks(tier), researchSpeed);
  }

  // --- Display helpers --------------------------------------------------------
  function tierLabel(tier: EquipmentRarity): string {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }
  function poiLabel(id: string): string {
    return groundSiteLabel(id) ?? id;
  }
  function blockText(reason: RelicStudyBlockReason): string {
    switch (reason) {
      case "noFacility":
        return "Build the Research Lab to study relics.";
      case "noSlot":
        return lanes === 1
          ? "The study lane is busy. This relic can be studied when the current study finishes."
          : `All ${lanes} study lanes are busy. This relic can be studied when one finishes.`;
      case "notFound":
        return "That relic is no longer in the vault.";
    }
  }
  // The token a running study carries (the identifyRelic effect), or null for a malformed process.
  function studyToken(p: TimedProcess): RelicVaultToken | null {
    return p.effect.type === "identifyRelic" ? p.effect.token : null;
  }
  function progressPct(p: TimedProcess): number {
    if (!(p.durationTicks > 0)) return 100;
    return Math.max(0, Math.min(100, ((p.durationTicks - p.remainingTicks) / p.durationTicks) * 100));
  }
</script>

<div class="rs-wrap">
  <div class="rs" class:has-reveal={reveal !== null}>
    <!-- ============================ VAULT + STUDY LANE ============================ -->
    <section class="rs-card rs-vault-card">
      <div class="rs-card-h">
        <span class="rs-card-glyph"><Icon name="relic" size={16} /></span>
        <span class="rs-card-title">Relic Vault</span>
        <span class="rs-card-tag">{vault.length} unidentified</span>
      </div>

      {#if lanes === 0}
        <p class="rs-gate"><Icon name="warning" size={13} /> Relic study needs the Research Lab. Build it to start identifying relics.</p>
      {/if}

      {#if vault.length === 0 && studies.length === 0}
        <p class="rs-empty">
          No unidentified relics. Away teams recover them on expeditions; claim a finished expedition and its relics land here.
        </p>
      {:else}
        <div class="rs-vault">
          <!-- In-flight studies first, dashed (the token left the vault at start, so it is shown from the
               study itself). Not selectable: it is already being studied. -->
          {#each studies as p (p.id)}
            {@const tok = studyToken(p)}
            {#if tok}
              <div class="rs-token studying" style="--tier: {equipmentRarityColor(tok.tier)};" title="Being studied">
                <span class="rs-token-glyph"><Icon name="study" size={24} /></span>
                <span class="rs-token-set">{relicSetShortLabel(tok.setId)}</span>
                <span class="rs-token-tier">{tierLabel(tok.tier)}</span>
              </div>
            {/if}
          {/each}
          {#each vault as tok (tok.id)}
            <button
              type="button"
              class="rs-token"
              class:active={selectedTokenId === tok.id}
              style="--tier: {equipmentRarityColor(tok.tier)};"
              aria-pressed={selectedTokenId === tok.id}
              title="{tierLabel(tok.tier)} {relicSetShortLabel(tok.setId)} relic"
              on:click={() => (selectedTokenId = tok.id)}
            >
              <span class="rs-token-glyph"><Icon name="relic" size={24} /></span>
              <span class="rs-token-set">{relicSetShortLabel(tok.setId)}</span>
              <span class="rs-token-tier">{tierLabel(tok.tier)}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- IN-FLIGHT STUDY: set, tier, progress, the real remaining time. -->
      {#each studies as p (p.id)}
        {@const tok = studyToken(p)}
        <div class="rs-study-row">
          <span class="rs-study-label">
            <Icon name="study" size={13} />
            Studying a {#if tok}<b style="color: {equipmentRarityColor(tok.tier)};">{tierLabel(tok.tier)}</b> {relicSetShortLabel(tok.setId)}{/if} relic
          </span>
          <span class="rs-bar"><span class="rs-bar-fill" style="width: {progressPct(p)}%;"></span></span>
          <span class="rs-eta">{formatRemaining(p.remainingTicks, p.durationTicks)}</span>
        </div>
      {/each}

      <!-- STUDY ACTION for the selected token. -->
      {#if selected}
        <div class="rs-selected" style="--tier: {equipmentRarityColor(selected.tier)};">
          <span class="rs-sel-glyph"><Icon name="relic" size={22} /></span>
          <span class="rs-sel-text">
            <span class="rs-sel-name">{tierLabel(selected.tier)} {relicSetShortLabel(selected.setId)} relic</span>
            <span class="rs-sel-sub">From {poiLabel(selected.poiId)} · study time {formatDuration(studyTicks(selected.tier))}</span>
          </span>
          <button
            type="button"
            class="rs-btn primary"
            disabled={!gate || !gate.ok}
            on:click={() => selected && onStudy(selected.id)}
          ><Icon name="study" size={13} /> Study</button>
        </div>
        {#if gate && !gate.ok}
          <p class="rs-note">{blockText(gate.reason)}</p>
        {/if}
      {/if}

      <p class="rs-hint">
        <b>Tier matters:</b> the away-team roll sets a relic's tier. A higher tier skews the reveal toward the rarer relics in its set, so a Radiant relic is your best shot at a capstone.
      </p>
    </section>

    <!-- ============================ IDENTIFICATION REVEAL ============================ -->
    <section class="rs-card rs-reveal-card" aria-live="polite">
      <div class="rs-card-h">
        <span class="rs-card-glyph"><Icon name="discovery" size={16} /></span>
        <span class="rs-card-title">Identified</span>
        {#if reveal}
          <span class="rs-card-tag">study complete</span>
          <button type="button" class="rs-x" on:click={onDismissReveal}><Icon name="close" size={13} title="Dismiss" /></button>
        {/if}
      </div>
      {#if reveal}
        {#key reveal.recordId}
          <div class="rs-reveal">
            <div class="rs-big" style="--ring: {relicRarityColor(reveal.rarity)};">
              <Icon name={relicIcon(reveal.relicId)} size={40} />
            </div>
            <div class="rs-rn">{reveal.relicLabel}</div>
            <div class="rs-rs">{reveal.setLabel} · relic {reveal.index} of {reveal.setSize} · <span style="color: {relicRarityColor(reveal.rarity)};">{RELIC_RARITY_LABEL[reveal.rarity]}</span></div>
            <div class="rs-rf">{reveal.flavor}</div>
            {#if reveal.firstFind}
              <div class="rs-first">
                <div class="rs-first-h"><Icon name="discovery" size={12} /> First find</div>
                <div class="rs-first-t">Discovered: {reveal.relicLabel}</div>
                <div class="rs-first-d">The first {reveal.relicLabel} your fleet has identified. It now has a place in the Museum.</div>
                <!-- E4d: a first find that opens discovery-gated research names each project it unlocked
                     (buildRelicReveal's researchUnlocked, empty for a relic that gates nothing). -->
                {#each reveal.researchUnlocked ?? [] as project (project)}
                  <div class="rs-first-r"><Icon name="research" size={12} /> Research unlocked: <b>{project}</b></div>
                {/each}
              </div>
            {/if}
            <div class="rs-copy">
              Copy <b>#{reveal.copyNumber}</b> sent to the Museum · {reveal.setLabel} now has <b>{reveal.setCollected} of {reveal.setSize}</b> relics
            </div>
            <button type="button" class="rs-btn" on:click={onViewMuseum}><Icon name="museum" size={13} /> View in Museum</button>
          </div>
        {/key}
      {:else}
        <p class="rs-empty">
          Nothing identified yet this session. Study a relic and its identity is revealed here the moment the study completes.
        </p>
      {/if}
    </section>
  </div>
</div>

<style>
  /* CONTAINER-QUERY layout (mirrors ExpeditionPanel). The WRAP is the container (a container query
     styles descendants, never the container itself); the inner grid swaps its AREA order by width. */
  .rs-wrap {
    container-type: inline-size;
  }
  .rs {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "vault"
      "reveal";
    gap: 12px;
  }
  /* Narrow + a fresh reveal: the payoff goes FIRST on a phone (it is what the player came back for). */
  .rs.has-reveal {
    grid-template-areas:
      "reveal"
      "vault";
  }
  .rs-vault-card {
    grid-area: vault;
  }
  .rs-reveal-card {
    grid-area: reveal;
  }
  @container (min-width: 769px) {
    .rs,
    .rs.has-reveal {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
      grid-template-areas: "vault reveal";
      align-items: start;
    }
  }

  /* CARD */
  .rs-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    min-width: 0;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .rs-card-h {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .rs-card-glyph {
    color: var(--color-accent-bright);
    display: inline-flex;
  }
  .rs-card-title {
    font-family: var(--font-display);
    font-size: var(--text-md);
    color: var(--color-text-primary);
    letter-spacing: 0.02em;
  }
  .rs-card-tag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .rs-x {
    display: inline-flex;
    padding: 3px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--corner);
    color: var(--color-text-dim);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .rs-x:hover {
    color: var(--color-text-primary);
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }

  .rs-empty,
  .rs-hint,
  .rs-note,
  .rs-gate {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  .rs-empty {
    color: var(--color-text-dim);
    padding: 10px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
  }
  .rs-hint {
    color: var(--color-text-dim);
  }
  .rs-hint b {
    color: var(--color-text-secondary);
    font-weight: 600;
  }
  .rs-note {
    color: var(--color-text-secondary);
  }
  .rs-gate {
    color: var(--color-warning);
    padding: 8px 10px;
    border: 1px solid rgba(var(--color-warning-rgb), 0.35);
    background: rgba(var(--color-warning-rgb), 0.08);
    border-radius: var(--corner);
  }

  /* VAULT GRID: square tokens, tier-colored ring. */
  .rs-vault {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 8px;
  }
  .rs-token {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    aspect-ratio: 1;
    padding: 6px 4px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    border-radius: var(--corner);
    box-shadow: inset 0 0 0 1px var(--tier);
    color: var(--color-text-secondary);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    min-width: 0;
  }
  button.rs-token:hover {
    border-color: rgba(var(--color-accent-rgb), 0.45);
  }
  .rs-token.active {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 2px var(--tier), 0 0 0 1px var(--color-accent);
  }
  .rs-token.studying {
    cursor: default;
    outline: 2px dashed var(--color-accent);
    outline-offset: 2px;
  }
  .rs-token-glyph {
    color: var(--tier);
    display: inline-flex;
  }
  .rs-token-set {
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rs-token-tier {
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--tier);
  }

  /* IN-FLIGHT STUDY ROW */
  .rs-study-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 9px 11px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.07);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .rs-study-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .rs-bar {
    flex: 1 1 80px;
    min-width: 60px;
    height: 7px;
    border-radius: 4px;
    background: rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
  }
  .rs-bar-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
  }
  .rs-eta {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    white-space: nowrap;
  }

  /* SELECTED TOKEN + Study */
  .rs-selected {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.05);
  }
  .rs-sel-glyph {
    color: var(--tier);
    display: inline-flex;
    flex: 0 0 auto;
  }
  .rs-sel-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .rs-sel-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .rs-sel-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }

  /* BUTTONS (the ExpeditionPanel .exp-btn idiom) */
  .rs-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    background: rgba(var(--color-accent-rgb), 0.1);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
    -webkit-tap-highlight-color: transparent;
  }
  .rs-btn.primary {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-bg-deep);
  }
  .rs-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* REVEAL */
  .rs-reveal {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 4px;
    padding: 8px 4px 2px;
  }
  .rs-big {
    width: 76px;
    height: 76px;
    margin-bottom: 6px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: var(--color-bg-mid);
    color: var(--ring);
    box-shadow: inset 0 0 0 1px var(--ring), 0 0 28px -8px var(--ring);
  }
  .rs-rn {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--color-text-primary);
  }
  .rs-rs {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .rs-rf {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-style: italic;
    max-width: 44ch;
    margin: 6px auto 0;
    line-height: 1.5;
  }
  .rs-first {
    align-self: stretch;
    margin-top: 10px;
    text-align: left;
    padding: 10px 12px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-warning-rgb), 0.5);
    background: rgba(var(--color-warning-rgb), 0.08);
  }
  .rs-first-h {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-warning);
  }
  .rs-first-t {
    font-size: var(--text-md);
    color: var(--color-text-primary);
    margin-top: 3px;
  }
  .rs-first-d {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin-top: 2px;
  }
  .rs-first-r {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .rs-first-r b {
    color: var(--color-success);
  }
  .rs-copy {
    margin: 10px 0 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .rs-copy b {
    color: var(--color-success);
  }
</style>
