<script lang="ts">
  // ============================================================================
  // RefugeeArrivalCard.svelte
  // E5 Refugee Posts, slice E5-6 (plan docs/plans/2026-11-02-refugee-posts-e5-plan.md; the signed mockup
  // docs/mockups/2026-11-02-e5-refugee-posts-mockup.html sections 4 and 5, call 11 A as drawn).
  //
  // The arrival moment: the person who just came home, with a one-tap Post at their best OPEN post (the largest
  // refugeeBonusIfPosted gain, arrivalCardView) and "Leave on the waiting list". Either one greets them (the id leaves
  // refugees.greet; a successful post greets inside postRefugee, by any path), so the card shows once. With no open
  // post anywhere the primary opens the chooser (the shared RefugeePostPicker in person mode, which lists the swaps). PURE PRESENTATION over refugeeDisplay.ts.
  // ONE DOM: `toast` draws the compact phone toast (the log sentence, then "Post at {facility}" and "Later"); the card
  // switches to its phone layout on its own width (a container query).
  // ============================================================================

  import type { GameState } from "./game/model";
  import type { RefugeeFacilityKey } from "./game/refugees";
  import Icon from "./ui/Icon.svelte";
  import RefugeePortrait from "./ui/RefugeePortrait.svelte";
  import RefugeePostPicker from "./RefugeePostPicker.svelte";
  import { REFUGEE_BACKGROUND_ICONS, REFUGEE_ECHO_MARK_LABEL, arrivalCardView } from "./refugeeDisplay";

  export let state: GameState;
  export let refugeeId: number;
  export let toast: boolean = false;
  export let onPost: (refugeeId: number, facility: RefugeeFacilityKey, replaceId?: number) => void;
  export let onGreet: (refugeeId: number) => void;

  $: view = arrivalCardView(state, refugeeId);
  // The chooser is open (the phone toast hides while it is, App.svelte, and keeps the card mounted so the picker stays).
  export let onChoosingChange: ((open: boolean) => void) | undefined = undefined;
  let choosing = false;
  $: onChoosingChange?.(choosing);

  // A post greets the person in the engine itself (postRefugee, on success only), so a failed post leaves the card.
  function postBest() {
    if (view === null) return;
    if (view.post === null) { choosing = true; return; }
    onPost(refugeeId, view.post.facility);
  }
  function later() {
    onGreet(refugeeId);
  }
</script>

{#if view}
  <div class="rac-wrap" class:toast>
    <section class="rac" aria-label="New arrival: {view.person.name}">
      {#if toast}
        <div class="rac-toastline"><RefugeePortrait hair={view.person.portrait.hair} palette={view.person.portrait.palette} size={24} /><span>{view.toastLine}</span></div>
      {:else}
        <div class="rac-head"><Icon name="check" size={14} /><span>{view.runText}</span><span class="rac-tier">{view.tierText}</span></div>
      {/if}
      <div class="rac-body">
        <span class="rac-pt"><RefugeePortrait hair={view.person.portrait.hair} palette={view.person.portrait.palette} size={toast ? 40 : 52} /></span>
        <div class="rac-who">
          <div class="rac-big">{view.headline}{#if view.person.echo}<span class="rac-echo"><Icon name="refugeeEcho" size={15} title={REFUGEE_ECHO_MARK_LABEL} /></span>{/if}</div>
          <div class="rac-line">
            <span class="rac-bg"><Icon name={REFUGEE_BACKGROUND_ICONS[view.person.background]} size={13} />{view.person.backgroundLabel}</span>
            <span class="rac-skill"><span>skill</span> {view.person.skill}</span>
            <span class="rac-match rac-long">{view.matchText}</span>
          </div>
          {#if view.person.flavor}<div class="rac-flavor">{view.person.flavor}</div>{/if}
        </div>
        <div class="rac-acts">
          <button type="button" class="rac-btn pri" on:click={postBest}>
            {#if view.post}
              <span class="rac-long">{view.post.label}</span><span class="rac-short">{view.post.shortLabel}</span>
            {:else}
              <span class="rac-long">Choose a post...</span><span class="rac-short">Choose a post</span>
            {/if}
          </button>
          <button type="button" class="rac-btn ghost" on:click={later}><span class="rac-long">{view.laterLabel}</span><span class="rac-short">{view.laterShort}</span></button>
        </div>
      </div>
    </section>
  </div>
  {#if choosing}
    <RefugeePostPicker {state} mode={{ kind: "person", refugeeId }} onPost={onPost} onClose={() => (choosing = false)} />
  {/if}
{/if}

<style>
  .rac-wrap { container-type: inline-size; min-width: 0; }
  .rac { border: 1px solid rgba(52, 211, 153, 0.35); border-radius: var(--corner); background: rgba(52, 211, 153, 0.05); min-width: 0; overflow: hidden; }
  .rac-head { display: flex; gap: 6px; align-items: center; padding: 7px 12px; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-success); border-bottom: 1px solid rgba(52, 211, 153, 0.18); }
  .rac-tier { margin-left: auto; color: var(--color-text-dim); white-space: nowrap; }
  .rac-toastline { display: flex; gap: 8px; align-items: center; padding: 7px 10px; font-size: var(--text-xs); color: var(--color-text-secondary); border-bottom: 1px solid rgba(52, 211, 153, 0.18); }
  .rac-body { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; padding: 10px 12px; }
  .rac-who { min-width: 0; }
  .rac-big { font-weight: 600; font-size: var(--text-md); color: var(--color-text-primary); }
  .rac-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: var(--text-xs); color: var(--color-text-secondary); margin-top: 2px; }
  .rac-bg { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
  .rac-bg :global(svg) { color: var(--color-accent); }
  .rac-skill { font-family: var(--font-mono); color: var(--color-text-primary); white-space: nowrap; }
  .rac-skill span { color: var(--color-text-dim); }
  /* E5-6b: an echo's shared mark beside the name, and their own flavor line under the trade line. */
  .rac-echo { display: inline-flex; vertical-align: -2px; margin-left: 6px; color: var(--color-accent-bright); }
  .rac-flavor { margin-top: 3px; font-size: var(--text-xs); font-style: italic; color: var(--color-text-secondary); overflow-wrap: anywhere; }
  .rac-match { font-family: var(--font-mono); font-size: var(--text-3xs); letter-spacing: 0.06em; text-transform: uppercase; padding: 0 5px; border-radius: var(--corner); color: var(--color-success); border: 1px solid rgba(52, 211, 153, 0.45); white-space: nowrap; }
  .rac-acts { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
  .rac-btn { font: inherit; font-size: var(--text-sm); color: var(--color-accent); background: rgba(var(--color-accent-rgb), 0.06); border: 1px solid var(--color-border-strong); border-radius: var(--corner); padding: 4px 10px; min-height: 32px; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; }
  .rac-btn.pri { background: rgba(var(--color-accent-rgb), 0.18); color: var(--color-text-primary); }
  .rac-btn.ghost { background: transparent; border-color: var(--color-border); color: var(--color-text-secondary); }
  .rac-btn:hover { border-color: var(--color-accent-bright); }
  .rac-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .rac-short { display: none; }

  /* The phone layout (mockup section 4 phone frame): portrait and name on one row, the two buttons side by side. */
  @container (max-width: 520px) {
    .rac-long { display: none; }
    .rac-short { display: inline; }
    .rac-body { grid-template-columns: auto minmax(0, 1fr); }
    .rac-acts { grid-column: 1 / 3; display: grid; grid-template-columns: 1fr 1fr; }
    .rac-big { font-size: var(--text-sm); }
  }
  .toast .rac { background: var(--color-bg-mid); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
</style>
