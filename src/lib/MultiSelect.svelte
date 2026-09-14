<script context="module" lang="ts">
  // ============================================================================
  // MultiSelect: a compact squared trigger that opens a floating CHECKLIST you tick in any
  // combination. 0.13.5, from the approved auto-salvage mockup (2026-09-14).
  //
  // WHY IT EXISTS. The auto-salvage Quality and Rarity axes are arbitrary multi-picks (any set of
  // tiers / bands, not an "and below" threshold). Inline checkbox rows read as a wall, and Quality's
  // Q0..Q5 checkboxes were indistinguishable from the Confirm-by-quality checkboxes right above them
  // (the "duplicate rows" bug). One compact multi-select trigger per axis fixes both: it shows the
  // current picks and opens a checklist, so the row stays scannable and the two controls read apart.
  //
  // ⚠️ CONTROLLED, per-item events. It does NOT own the selection; the parent passes `selected` and
  // listens to `toggle` ({ value, selected }) + `clear`, so the writes stay the SAME per-item
  // handlers the checkboxes used (no logic / no save change). Re-rendering from the parent's
  // `selected` is what keeps a cancelled/blocked write visually correct.
  //
  // ⚠️ PORTAL TO document.body + FIXED positioning, the SAME overflow-proof idiom HelpTip uses. The
  // settings modal body scrolls (overflow-y:auto) and has a transformed ancestor, so an absolute
  // popover would be clipped and a bare fixed one mis-anchored. Portaling escapes both; we measure
  // the trigger's rect and place the popover below it (flipping above when it would fall off).
  // ============================================================================
  import { createEventDispatcher, tick as svelteTick } from "svelte";

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
</script>

<script lang="ts">
  export let label: string; // names the control for assistive tech
  // The options, in display order. `color` (optional) draws a swatch (rarity bands use it).
  export let options: { value: string; label: string; color?: string }[];
  // The currently-selected values (a subset of options' values). CONTROLLED by the parent.
  export let selected: string[];
  // What the trigger reads when nothing is selected (e.g. "Any quality") — an empty axis does not
  // narrow, so this is a real state, not a placeholder.
  export let summaryEmpty: string = "None";
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<{ toggle: { value: string; selected: boolean }; clear: void }>();

  let open = false;
  let btn: HTMLButtonElement | null = null;
  let pop: HTMLDivElement | null = null;
  let popStyle = "";

  $: selectedSet = new Set(selected);
  // Comma list of the picked labels (CSS ellipsis truncates a long one); the empty-axis wording else.
  $: summary =
    selected.length === 0
      ? summaryEmpty
      : options.filter((o) => selectedSet.has(o.value)).map((o) => o.label).join(", ");

  async function place(): Promise<void> {
    await svelteTick();
    if (!btn || !pop) return;
    const b = btn.getBoundingClientRect();
    const ph = pop.offsetHeight;
    const pw = pop.offsetWidth;
    const below = b.bottom + 5;
    const flipUp = below + ph > window.innerHeight - 8;
    const top = flipUp ? Math.max(8, b.top - ph - 5) : below;
    // Right-align to the trigger by default (the trigger sits at the right of a SettingRow), then
    // clamp so a wide popover never spills off the left/right edge.
    let left = b.right - pw;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    if (left < 8) left = 8;
    popStyle = `top:${top}px; left:${left}px;`;
  }

  function openPop(): void {
    if (disabled) return;
    open = true;
    popStyle = "";
    void place();
  }
  function close(): void {
    open = false;
  }
  function toggleOpen(event: MouseEvent): void {
    // Stop the document closer below from immediately undoing the tap that just opened it.
    event.stopPropagation();
    if (open) close();
    else openPop();
  }
  function onOption(value: string): void {
    // Multi-pick: toggling one option does NOT close the popover, so several can be set in a row.
    dispatch("toggle", { value, selected: !selectedSet.has(value) });
  }
  function onClear(): void {
    dispatch("clear");
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close();
    }
  }
</script>

<!-- Tap anywhere else closes it (touch has no blur to rely on). The trigger + popover both stop
     propagation so their own clicks never reach this. -->
<svelte:document on:click={close} on:keydown={onKeydown} />

<span class="ms">
  <button
    type="button"
    class="ms-btn"
    bind:this={btn}
    {disabled}
    aria-haspopup="true"
    aria-expanded={open}
    aria-label={label}
    on:click={toggleOpen}
  >
    <span class="ms-summary" class:empty={selected.length === 0}>{summary}</span>
    <span class="ms-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
  </button>
  {#if open}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions a11y-no-noninteractive-element-interactions -->
    <!-- The click handler only STOPS PROPAGATION so ticking an option does not reach the document
         close listener; the interactive controls inside (checkboxes + Clear) carry their own
         keyboard support, so the group container needs none. -->
    <div class="ms-pop" use:portal style={popStyle} bind:this={pop} role="group" aria-label={label} on:click={(e) => e.stopPropagation()}>
      {#each options as opt (opt.value)}
        <label class="ms-opt" class:on={selectedSet.has(opt.value)}>
          <input
            type="checkbox"
            checked={selectedSet.has(opt.value)}
            on:change={() => onOption(opt.value)}
          />
          {#if opt.color}<span class="ms-swatch" style="background: {opt.color};" aria-hidden="true"></span>{/if}
          <span class="ms-opt-label">{opt.label}</span>
        </label>
      {/each}
      <button type="button" class="ms-clear" on:click={onClear} disabled={selected.length === 0}>Clear</button>
    </div>
  {/if}
</span>

<style>
  .ms {
    position: relative;
    display: inline-flex;
  }
  /* The trigger: squared, shows the current picks, matches the .setting-select chrome. */
  .ms-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 140px;
    max-width: 220px;
    padding: var(--space-1) var(--space-2);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .ms-btn:hover:not(:disabled) {
    border-color: var(--color-accent);
  }
  .ms-btn:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .ms-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ms-summary {
    flex: 1 1 auto;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ms-summary.empty {
    color: var(--color-text-dim);
  }
  .ms-caret {
    flex: none;
    color: var(--color-accent);
    font-size: var(--text-2xs);
  }
  /* The checklist popover: fixed + portaled (see module note), opaque bg over the deep ground so it
     reads solid on Brave, accent-bordered like the other floating surfaces. */
  .ms-pop {
    position: fixed;
    z-index: 1000;
    min-width: 168px;
    max-width: min(280px, 80vw);
    background:
      linear-gradient(rgba(var(--color-accent-rgb), 0.06), rgba(var(--color-accent-rgb), 0.06)),
      var(--color-bg-mid);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: var(--space-1);
  }
  .ms-opt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    border-radius: var(--corner);
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .ms-opt:hover {
    background: rgba(var(--color-accent-rgb), 0.09);
  }
  .ms-swatch {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
  }
  .ms-opt-label {
    flex: 1 1 auto;
  }
  .ms-clear {
    width: 100%;
    margin-top: var(--space-1);
    padding: var(--space-2) 0 var(--space-1);
    border: none;
    border-top: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-dim);
    font-family: var(--font-mono, var(--font-body));
    font-size: var(--text-3xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: center;
    cursor: pointer;
  }
  .ms-clear:hover:not(:disabled) {
    color: var(--color-accent);
  }
  .ms-clear:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
