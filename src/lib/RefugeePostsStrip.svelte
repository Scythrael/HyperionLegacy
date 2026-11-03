<script lang="ts">
  // ============================================================================
  // RefugeePostsStrip.svelte
  // E5 Refugee Posts, slice E5-5 (plan docs/plans/2026-11-02-refugee-posts-e5-plan.md; the signed mockup
  // docs/mockups/2026-11-02-e5-refugee-posts-mockup.html section 1, every call as drawn).
  //
  // The Posts strip: under each Facilities dashboard pane, OUTSIDE the pane's button (call 1 A, so tapping a face or an
  // empty post never opens the console), and on the Operations, Mission Control tab under its level readout (call
  // 4 A, `attached` false). A filled post opens a small popover with "Move to another post" and "Back to waiting
  // list" (call 2 A); the readout shows each person's share plus the curved total (call 3 A); on a phone each post is
  // one line with its share on the right and only the total underneath (call 5 A). Locked future posts are one text
  // line, never drawn slots.
  //
  // PURE PRESENTATION: refugeeDisplay.ts builds every line from the engine. Actions bubble up to App.svelte (onPost,
  // onUnpost), whose handlers run the engine's postRefugee / unpostRefugee and save. ONE DOM, CSS breakpoints only.
  // Nothing renders until the first refugee ever arrives, or on a facility with no posts (postsStripView is null).
  // ============================================================================

  import { tick } from "svelte";
  import type { GameState } from "./game/model";
  import type { RefugeeFacilityKey } from "./game/refugees";
  import Icon from "./ui/Icon.svelte";
  import RefugeePortrait from "./ui/RefugeePortrait.svelte";
  import RefugeePostPicker, { type RefugeePickerMode } from "./RefugeePostPicker.svelte";
  import { REFUGEE_BACKGROUND_ICONS, postsStripView } from "./refugeeDisplay";

  export let state: GameState;
  export let facility: RefugeeFacilityKey;
  // Attached under a dashboard pane (squared top, dashed seam) or standing alone (Mission Control).
  export let attached: boolean = true;
  export let onPost: (refugeeId: number, facility: RefugeeFacilityKey, replaceId?: number) => void;
  export let onUnpost: (refugeeId: number) => void;

  $: view = postsStripView(state, facility);

  // The open popover (a posted person's id) and the open picker.
  let popId: number | null = null;
  let picker: RefugeePickerMode | null = null;
  let root: HTMLElement | undefined;
  let slotButtons: Record<number, HTMLButtonElement> = {};

  // A person who left this facility (moved, unposted, swapped out) closes their popover.
  $: if (popId !== null && view && !view.slots.some((s) => s.id === popId)) popId = null;

  async function openPop(id: number) {
    popId = popId === id ? null : id;
    if (popId !== null) {
      await tick();
      root?.querySelector<HTMLButtonElement>(".rps-pop button")?.focus();
    }
  }
  function closePop(returnFocus: boolean) {
    const id = popId;
    popId = null;
    if (returnFocus && id !== null) slotButtons[id]?.focus();
  }
  function onWindowClick(e: MouseEvent) {
    if (popId === null || !root) return;
    const pop = root.querySelector(".rps-pop");
    const btn = slotButtons[popId];
    const t = e.target as Node | null;
    if (t && (pop?.contains(t) || btn?.contains(t))) return;
    popId = null;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && popId !== null && picker === null) closePop(true);
  }
  function openPicker(mode: RefugeePickerMode) {
    popId = null;
    picker = mode;
  }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKey} />

{#if view}
  <div class="rps" class:attached bind:this={root} aria-label="{view.facilityLabel} posts" role="group">
    <div class="rps-hd">
      <span class="rps-tag"><Icon name="refugeePosts" size={14} />Posts <span class="rps-ct">{view.countText}</span></span>
      {#if view.nextPostText}
        <span class="rps-next"><span class="rps-long">{view.nextPostText}</span><span class="rps-short">{view.nextPostShort}</span></span>
      {/if}
    </div>

    <div class="rps-slots">
      {#each view.slots as s (s.id)}
        <div class="rps-slotwrap">
          <button
            class="rps-slot"
            class:sel={popId === s.id}
            bind:this={slotButtons[s.id]}
            aria-expanded={popId === s.id}
            aria-haspopup="dialog"
            on:click={() => openPop(s.id)}
          >
            <span class="rps-pt"><RefugeePortrait hair={s.portrait.hair} palette={s.portrait.palette} /></span>
            <span class="rps-sn">{s.name}</span>
            <span class="rps-tail" class:off={!s.matched}>{s.shareText}</span>
            <span class="rps-sb">
              <span class="rps-bg"><Icon name={REFUGEE_BACKGROUND_ICONS[s.background]} size={12} />{s.backgroundLabel}</span>
              <span class="rps-match" class:ok={s.matched}>{s.matchText}</span>
            </span>
          </button>
          {#if popId === s.id}
            <div class="rps-pop" role="dialog" aria-label={s.name}>
              <div class="rps-pop-hd">
                <RefugeePortrait hair={s.portrait.hair} palette={s.portrait.palette} size={28} />
                <b>{s.name}</b>
                <span class="rps-match" class:ok={s.matched}>{s.matchText}</span>
              </div>
              <div class="rps-kv">
                <span>Background</span><span>{s.backgroundLabel}</span>
                <span>Skill</span><span>{s.skill}</span>
                <span>Here</span><span class:rps-ok={s.matched}>{s.hereText}</span>
                <span>From</span><span>{s.originText}</span>
              </div>
              <div class="rps-acts">
                <button class="rps-btn" on:click={() => openPicker({ kind: "person", refugeeId: s.id })}><Icon name="transfer" size={14} />Move to another post</button>
                <button class="rps-btn ghost" on:click={() => { onUnpost(s.id); closePop(false); }}>Back to waiting list</button>
                {#if view.full && view.candidates > 0}
                  <button class="rps-btn ghost" on:click={() => openPicker({ kind: "facility", facility, replaceId: s.id })}>Replace with someone else</button>
                {/if}
              </div>
              <div class="rps-free">Moving is free, any time.</div>
            </div>
          {/if}
        </div>
      {/each}
      {#each Array(view.emptyPosts) as _, i (i)}
        <button class="rps-slot empty" on:click={() => openPicker({ kind: "facility", facility })}>
          <span class="rps-ph"><Icon name="plus" size={14} /></span>
          <span class="rps-sn">Post someone</span>
          <span class="rps-tail pick">Pick</span>
          <span class="rps-sb">{view.emptyText}</span>
        </button>
      {/each}
    </div>

    <div class="rps-readout">
      {#if view.totalText}<span class="rps-tot">{view.totalText}</span>{/if}
      {#if view.sharesLine.length > 0}
        <span class="rps-ln rps-long">
          {#each view.sharesLine as sh, i (i)}{#if i > 0}<span class="rps-dot">&nbsp;·&nbsp;</span>{/if}{sh.firstName} <b>{sh.shareShort}</b>{/each}
        </span>
      {/if}
      {#if view.note}<span class="rps-dim" class:rps-long={view.noteIsHint}>{view.note}</span>{/if}
    </div>
  </div>

  {#if picker}
    <RefugeePostPicker {state} mode={picker} {onPost} onClose={() => (picker = null)} />
  {/if}
{/if}

<style>
  .rps {
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.025);
    padding: 8px 14px 9px;
    display: grid;
    grid-template-columns: 172px minmax(0, 1fr) 230px;
    gap: 16px;
    align-items: center;
    min-width: 0;
  }
  .rps.attached {
    border-top: 1px dashed rgba(var(--color-accent-rgb), 0.28);
    border-radius: 0 0 var(--corner) var(--corner);
  }
  .rps-hd { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .rps-tag { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-accent-bright); display: flex; gap: 6px; align-items: center; }
  .rps-ct { color: var(--color-text-primary); letter-spacing: 0; }
  .rps-next { font-family: var(--font-mono); font-size: var(--text-3xs); color: var(--color-text-dim); letter-spacing: 0.04em; }
  .rps-slots { display: flex; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .rps-slotwrap { position: relative; min-width: 0; display: flex; }
  .rps-slot {
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 1px 8px;
    align-items: center;
    padding: 4px 9px 4px 4px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
    min-width: 0;
    -webkit-tap-highlight-color: transparent;
  }
  .rps-slot:hover { border-color: rgba(var(--color-accent-rgb), 0.6); }
  .rps-slot:focus-visible, .rps-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .rps-slot.sel { border-color: var(--color-accent-bright); background: rgba(var(--color-accent-rgb), 0.1); }
  .rps-pt, .rps-ph { grid-row: 1 / 3; }
  .rps-sn { font-size: var(--text-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text-primary); }
  .rps-sb { font-size: var(--text-xs); color: var(--color-text-secondary); display: flex; gap: 5px; align-items: center; white-space: nowrap; min-width: 0; }
  .rps-bg { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
  .rps-bg :global(svg) { color: var(--color-accent); }
  .rps-match { font-family: var(--font-mono); font-size: var(--text-3xs); letter-spacing: 0.06em; padding: 0 5px; border-radius: var(--corner); border: 1px solid rgba(98, 133, 145, 0.45); color: var(--color-text-dim); text-transform: uppercase; white-space: nowrap; font-weight: 400; }
  .rps-match.ok { color: var(--color-success); border-color: rgba(52, 211, 153, 0.45); }
  .rps-tail { display: none; font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-success); text-align: right; }
  .rps-tail.off { color: var(--color-text-secondary); }
  .rps-tail.pick { color: var(--color-accent); }
  .rps-slot.empty { border-style: dashed; border-color: rgba(var(--color-accent-rgb), 0.35); background: transparent; }
  .rps-slot.empty .rps-sn { color: var(--color-accent); font-weight: 500; }
  .rps-slot.empty .rps-sb { color: var(--color-text-dim); font-family: var(--font-mono); font-size: var(--text-2xs); }
  .rps-ph { width: 34px; height: 34px; border: 1px dashed rgba(var(--color-accent-rgb), 0.4); border-radius: var(--corner); display: grid; place-items: center; color: var(--color-accent); box-sizing: border-box; }

  .rps-readout { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-text-secondary); display: grid; gap: 2px; justify-items: end; text-align: right; min-width: 0; }
  .rps-tot { color: var(--color-success); font-size: var(--text-sm); }
  .rps-ln b { color: var(--color-text-primary); font-weight: 400; }
  .rps-dim { color: var(--color-text-dim); font-size: var(--text-3xs); }
  .rps-short { display: none; }

  .rps-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 50;
    width: 260px;
    max-width: calc(100vw - 32px);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    background: var(--color-bg-raised, var(--color-bg-mid));
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
    padding: 8px;
    display: grid;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .rps-pop-hd { display: flex; gap: 8px; align-items: center; }
  .rps-pop-hd b { color: var(--color-text-primary); font-size: var(--text-sm); }
  .rps-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-family: var(--font-mono); font-size: var(--text-2xs); }
  .rps-kv span:nth-child(odd) { color: var(--color-text-dim); }
  .rps-kv span:nth-child(even) { color: var(--color-text-primary); }
  .rps-kv span.rps-ok { color: var(--color-success); }
  .rps-acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .rps-free { font-size: var(--text-2xs); color: var(--color-text-dim); }
  .rps-btn { font: inherit; font-size: var(--text-xs); color: var(--color-accent); background: rgba(var(--color-accent-rgb), 0.06); border: 1px solid var(--color-border-strong); border-radius: var(--corner); padding: 3px 9px; min-height: 32px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .rps-btn.ghost { background: transparent; border-color: var(--color-border); color: var(--color-text-secondary); }
  .rps-btn:hover { border-color: var(--color-accent-bright); }

  /* Phone (mockup section 1 phone frame, call 5 A): one line per post with its share on the right, only the total
     underneath. */
  @media (max-width: 768px) {
    .rps { grid-template-columns: minmax(0, 1fr); gap: 7px; padding: 8px 10px; }
    .rps-hd { flex-direction: row; justify-content: space-between; align-items: baseline; gap: 8px; }
    .rps-slots { flex-direction: column; flex-wrap: nowrap; gap: 5px; }
    .rps-slotwrap { display: block; }
    .rps-slot { width: 100%; grid-template-columns: 28px minmax(0, 1fr) auto; padding: 3px 8px 3px 3px; }
    .rps-slot :global(svg.rp) { width: 28px; height: 28px; }
    .rps-ph { width: 28px; height: 28px; }
    .rps-tail { display: block; grid-column: 3; grid-row: 1 / 3; }
    .rps-sb { grid-column: 2; }
    .rps-readout { justify-items: start; text-align: left; border-top: 1px solid rgba(var(--color-accent-rgb), 0.1); padding-top: 6px; }
    .rps-readout:empty { display: none; }
    .rps-long { display: none; }
    .rps-short { display: inline; }
    .rps-pop { width: auto; right: 0; max-width: none; }
  }
</style>
