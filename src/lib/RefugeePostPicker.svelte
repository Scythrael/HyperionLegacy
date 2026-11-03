<script lang="ts" context="module">
  import type { RefugeeFacilityKey } from "./game/refugees";
  // What the picker is choosing: someone for a facility's post (the strip's "Post someone", or a swap on a full
  // facility with a preset person to replace), or a post for one person ("Move to another post"; E5-6's "Post...").
  export type RefugeePickerMode =
    | { kind: "facility"; facility: RefugeeFacilityKey; replaceId?: number }
    | { kind: "person"; refugeeId: number };
</script>

<script lang="ts">
  // ============================================================================
  // RefugeePostPicker.svelte
  // E5 Refugee Posts, slice E5-5 (plan docs/plans/2026-11-02-refugee-posts-e5-plan.md; the signed mockup
  // docs/mockups/2026-11-02-e5-refugee-posts-mockup.html section 2, calls 6 A, 7 A and 10 A as drawn).
  //
  // A modal on desktop and a bottom sheet on a phone (the shared ActionModal). PURE PRESENTATION: every row, gain and
  // "total becomes" is refugeeDisplay.ts over the engine (refugeeBonusIfPosted runs the real postRefugee, swap
  // included). The one action bubbles up to App.svelte (onPost), whose handler runs postRefugee and saves.
  // ONE DOM: the rows switch to the phone layout on the dialog's own width (a container query on .am-dialog).
  // ============================================================================

  import type { GameState } from "./game/model";
  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import RefugeePortrait from "./ui/RefugeePortrait.svelte";
  import { REFUGEE_BACKGROUND_ICONS, personPostView, postPickerView } from "./refugeeDisplay";

  export let state: GameState;
  export let mode: RefugeePickerMode;
  export let onPost: (refugeeId: number, facility: RefugeeFacilityKey, replaceId?: number) => void;
  export let onClose: () => void;

  // The player's pick of who a newcomer replaces on a full facility (starts at the preset, else the engine's fallback).
  let replaceId: number | undefined = mode.kind === "facility" ? mode.replaceId : undefined;

  $: fview = mode.kind === "facility" ? postPickerView(state, mode.facility, replaceId) : null;
  $: pview = mode.kind === "person" ? personPostView(state, mode.refugeeId) : null;
  $: title = fview ? fview.title : pview ? pview.title : "Posts";

  function post(refugeeId: number, facility: RefugeeFacilityKey, target?: number) {
    onPost(refugeeId, facility, target);
    onClose();
  }
</script>

<ActionModal {title} {onClose} iconClose>
  {#if fview}
    <div class="rpk">
      <div class="rpk-meta"><Icon name="refugeePosts" size={14} /><span class="rpk-long">{fview.meta}</span><span class="rpk-short">{fview.shortTitle}</span></div>
      <div class="rpk-sum"><span class="rpk-long">{fview.summary}</span><span class="rpk-short">{fview.summaryShort}</span></div>
      {#if fview.swap}
        <div class="rpk-swap" role="group" aria-label="Who goes back to the waiting list">
          <span class="rpk-swap-lbl">Replace</span>
          {#each fview.swap.targets as t (t.id)}
            <button
              class="rpk-chip"
              class:on={t.id === fview.swap.replaceId}
              aria-pressed={t.id === fview.swap.replaceId}
              on:click={() => (replaceId = t.id)}
            >{t.name} <span class="rpk-dim">{t.shareText}</span></button>
          {/each}
        </div>
      {/if}
      {#if fview.waiting.length === 0 && fview.posted.length === 0}
        <p class="rpk-empty">Nobody to post yet. Evacuations on the short-range board bring people home.</p>
      {:else}
        <div class="rpk-colh">Waiting at home <span>sorted by what they'd give here</span></div>
        <div class="rpk-list">
          {#if fview.waiting.length === 0}
            <div class="rpk-none">Nobody is waiting.</div>
          {/if}
          {#each fview.waiting as r (r.id)}
            <div class="rpk-row" class:top={r.top}>
              <span class="rpk-pt"><RefugeePortrait hair={r.portrait.hair} palette={r.portrait.palette} /></span>
              <div class="rpk-who">
                <div class="rpk-name">{r.name} <span class="rpk-match" class:ok={r.matched}>{r.matchText}</span></div>
                <div class="rpk-sub">
                  <span class="rpk-bg"><Icon name={REFUGEE_BACKGROUND_ICONS[r.background]} size={12} />{r.backgroundLabel}</span>
                  <span class="rpk-skill"><span>skill</span> {r.skill}</span>
                  <span class="rpk-where rpk-long">{r.originText}</span>
                </div>
              </div>
              <div class="rpk-gain" class:ok={r.matched}>
                <span class="rpk-long">{r.gainText}<small>{r.detail}</small></span>
                <span class="rpk-short">{r.gainShort}{#if r.detailShort} · {r.detailShort}{/if}</span>
              </div>
              <span class="rpk-act">
                <button class="rpk-btn" class:pri={r.top} on:click={() => post(r.id, fview.facility, fview.swap?.replaceId)}>
                  {fview.full ? "Swap in" : "Post"}
                </button>
              </span>
            </div>
          {/each}
          {#if fview.posted.length > 0}
            <div class="rpk-sep">Posted elsewhere <span class="rpk-long">moving is free · their old post goes empty</span><span class="rpk-short">{fview.posted.length}</span></div>
            {#each fview.posted as r (r.id)}
              <div class="rpk-row">
                <span class="rpk-pt"><RefugeePortrait hair={r.portrait.hair} palette={r.portrait.palette} /></span>
                <div class="rpk-who">
                  <div class="rpk-name">{r.name} <span class="rpk-match" class:ok={r.matched}>{r.matchText}</span></div>
                  <div class="rpk-sub">
                    <span class="rpk-bg"><Icon name={REFUGEE_BACKGROUND_ICONS[r.background]} size={12} />{r.backgroundLabel}</span>
                    <span class="rpk-skill rpk-long"><span>skill</span> {r.skill}</span>
                    <span class="rpk-where"><span class="rpk-long">{r.whereText}</span><span class="rpk-short">{r.whereShort}</span></span>
                  </div>
                </div>
                <div class="rpk-gain" class:ok={r.matched}>
                  <span class="rpk-long">{r.gainText}<small>{r.detail}</small></span>
                  <span class="rpk-short">{r.gainShort}</span>
                </div>
                <span class="rpk-act">
                  <button class="rpk-btn ghost" on:click={() => post(r.id, fview.facility, fview.swap?.replaceId)}>
                    <span class="rpk-long">Move here</span><span class="rpk-short">Move</span>
                  </button>
                </span>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {:else if pview}
    <div class="rpk">
      <div class="rpk-person">
        <RefugeePortrait hair={pview.person.portrait.hair} palette={pview.person.portrait.palette} />
        <div class="rpk-who">
          <div class="rpk-name">{pview.person.name}</div>
          <div class="rpk-sub">
            <span class="rpk-bg"><Icon name={REFUGEE_BACKGROUND_ICONS[pview.person.background]} size={12} />{pview.person.backgroundLabel}</span>
            <span class="rpk-skill"><span>skill</span> {pview.person.skill}</span>
          </div>
        </div>
      </div>
      <div class="rpk-sum">{pview.currentText ?? "Waiting at home."} Moving is free, any time; an old post goes empty.</div>
      <div class="rpk-colh">Posts <span>sorted by what they'd give</span></div>
      <div class="rpk-list">
        {#if pview.choices.length === 0}
          <div class="rpk-none">No other facility has a post yet. Facilities open posts at Level 1.</div>
        {/if}
        {#each pview.choices as c, i (c.facility)}
          <div class="rpk-frow" class:top={i === 0 && c.gain > 0}>
            <div class="rpk-who">
              <div class="rpk-name">{c.facilityLabel} {#if c.matched}<span class="rpk-match ok">match</span>{/if}</div>
              <div class="rpk-sub"><span>Level {c.level}</span><span class="rpk-open" class:full={!c.open}>{c.openText}</span></div>
            </div>
            <div class="rpk-gain" class:ok={c.matched}>
              <span>{c.gainText}<small>{c.totalText}</small></span>
            </div>
            {#if c.open}
              <span class="rpk-act">
                <button class="rpk-btn" class:pri={i === 0 && c.gain > 0} on:click={() => post(pview.person.id, c.facility)}>
                  {pview.person.posting === null ? "Post here" : "Move here"}
                </button>
              </span>
            {:else}
              <div class="rpk-swaps" role="group" aria-label="Replace someone at the {c.facilityLabel}">
                {#each c.swaps as w (w.id)}
                  <button class="rpk-btn ghost" on:click={() => post(pview.person.id, c.facility, w.id)}>
                    Replace {w.name.split(" ")[0]} <span class="rpk-dim">{w.shareText}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
  <div slot="footer" class="rpk-foot">
    {#if fview}<span class="rpk-foot-note rpk-long">{fview.footText}</span>{/if}
    <button class="rpk-btn ghost rpk-close" on:click={onClose}>Close</button>
  </div>
</ActionModal>

<style>
  .rpk { display: grid; gap: 10px; font-size: var(--text-sm); color: var(--color-text-secondary); min-width: 0; }
  .rpk-meta { display: flex; gap: 6px; align-items: center; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-dim); }
  .rpk-meta :global(svg) { color: var(--color-accent); }
  .rpk-sum { font-size: var(--text-sm); color: var(--color-text-secondary); padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--corner); background: rgba(0, 0, 0, 0.2); }
  .rpk-swap { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .rpk-swap-lbl { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-dim); }
  .rpk-chip { font: inherit; font-family: var(--font-mono); font-size: var(--text-xs); padding: 5px 9px; min-height: 32px; border: 1px solid var(--color-border); border-radius: var(--corner); background: transparent; color: var(--color-text-secondary); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  .rpk-chip.on { color: var(--color-text-primary); border-color: var(--color-accent-bright); background: rgba(var(--color-accent-rgb), 0.14); }
  .rpk-dim { color: var(--color-text-dim); }
  .rpk-colh { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-accent-bright); display: flex; justify-content: space-between; gap: 8px; }
  .rpk-colh span { color: var(--color-text-dim); letter-spacing: 0.02em; text-transform: none; }
  .rpk-list { border: 1px solid rgba(var(--color-accent-rgb), 0.16); border-radius: var(--corner); background: rgba(var(--color-accent-rgb), 0.03); min-width: 0; }
  .rpk-row { display: grid; grid-template-columns: 34px minmax(0, 1.3fr) minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.08); }
  .rpk-frow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.08); }
  .rpk-row:last-child, .rpk-frow:last-child { border-bottom: 0; }
  .rpk-row.top, .rpk-frow.top { background: rgba(52, 211, 153, 0.05); }
  .rpk-who { min-width: 0; }
  .rpk-name { font-weight: 600; font-size: var(--text-md); color: var(--color-text-primary); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .rpk-sub { font-size: var(--text-xs); color: var(--color-text-secondary); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .rpk-bg { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
  .rpk-bg :global(svg) { color: var(--color-accent); }
  .rpk-skill { font-family: var(--font-mono); color: var(--color-text-primary); white-space: nowrap; }
  .rpk-skill span { color: var(--color-text-dim); }
  .rpk-where { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-text-dim); }
  .rpk-match { font-family: var(--font-mono); font-size: var(--text-3xs); letter-spacing: 0.06em; padding: 0 5px; border-radius: var(--corner); border: 1px solid rgba(98, 133, 145, 0.45); color: var(--color-text-dim); text-transform: uppercase; white-space: nowrap; font-weight: 400; }
  .rpk-match.ok { color: var(--color-success); border-color: rgba(52, 211, 153, 0.45); }
  .rpk-gain { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-secondary); min-width: 0; }
  .rpk-gain.ok { color: var(--color-success); }
  .rpk-gain small { display: block; color: var(--color-text-dim); font-size: var(--text-3xs); }
  .rpk-open { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-success); }
  .rpk-open.full { color: var(--color-text-dim); }
  .rpk-sep { padding: 6px 10px; font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-dim); background: rgba(var(--color-accent-rgb), 0.04); border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.08); display: flex; justify-content: space-between; gap: 8px; }
  .rpk-sep span { text-transform: none; letter-spacing: 0; }
  .rpk-none, .rpk-empty { padding: 8px 10px; color: var(--color-text-dim); font-size: var(--text-xs); margin: 0; }
  .rpk-person { display: flex; gap: 10px; align-items: center; }
  .rpk-swaps { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .rpk-btn { font: inherit; font-size: var(--text-sm); color: var(--color-accent); background: rgba(var(--color-accent-rgb), 0.06); border: 1px solid var(--color-border-strong); border-radius: var(--corner); padding: 3px 9px; min-height: 32px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .rpk-btn.pri { background: rgba(var(--color-accent-rgb), 0.18); color: var(--color-text-primary); }
  .rpk-btn.ghost { background: transparent; border-color: var(--color-border); color: var(--color-text-secondary); }
  .rpk-btn:hover, .rpk-chip:hover { border-color: var(--color-accent-bright); }
  .rpk-btn:focus-visible, .rpk-chip:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .rpk-foot { display: flex; gap: 8px; align-items: center; justify-content: flex-end; width: 100%; flex-wrap: wrap; }
  .rpk-foot-note { font-size: var(--text-xs); color: var(--color-text-dim); margin-right: auto; }
  .rpk-short { display: none; }

  /* The phone layout (the bottom sheet, mockup section 2 phone frame), on the dialog's own width. */
  @container (max-width: 480px) {
    .rpk-long { display: none; }
    .rpk-short { display: inline; }
    .rpk-row { grid-template-columns: 34px minmax(0, 1fr) auto; }
    .rpk-row .rpk-pt { grid-row: 1 / 4; align-self: start; }
    .rpk-row .rpk-who, .rpk-row .rpk-gain { grid-column: 2; }
    .rpk-row .rpk-act { grid-column: 3; grid-row: 1 / 4; align-self: center; }
    .rpk-frow { grid-template-columns: minmax(0, 1fr) auto; }
    .rpk-frow .rpk-gain { grid-column: 1; }
    .rpk-frow .rpk-act { grid-column: 2; grid-row: 1 / 3; align-self: center; }
    .rpk-frow .rpk-swaps { grid-column: 1 / 3; justify-content: flex-start; }
    .rpk-foot { display: grid; grid-template-columns: 1fr; }
    .rpk-close { justify-content: center; }
  }
</style>
