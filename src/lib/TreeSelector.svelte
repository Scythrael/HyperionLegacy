<script lang="ts">
  // --- TreeSelector.svelte — card selector + live description panel ----------
  // Author: Radial Skill Web feature (Task 13)
  // Created: 2026-07-08 (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 13)
  //
  // Description:
  //   The reusable "mockup A" card-selector front-end (design §5.1): a row of
  //   cards (each a title + a wireframe-art placeholder box) above a single live
  //   description panel that swaps to whichever card is currently FOCUSED, ending
  //   in a commit button. It is PURELY PRESENTATIONAL — it owns only its own
  //   focus state and never decides what "commit" means. The parent supplies the
  //   card list, the button label, and the onCommit callback; commit SEMANTICS
  //   (set a captain's spec vs. navigate into a homeworld category) live entirely
  //   in the parent (Tasks 14/15), NOT here.
  //
  //   Two configs from one component (design §5.4), wired later:
  //     - Captain Talents (Task 14): cards={specCards}, commitLabel="Choose this
  //       spec", onCommit sets CaptainState.spec.
  //     - Homeworld Talents (Task 15): cards={categoryCards}, commitLabel="View
  //       Tree", onCommit navigates into that category's web.
  //   Task 13 is JUST this component + its data; the WIRING is Tasks 14/15 — this
  //   file does not touch App.svelte.
  //
  //   Interaction model (design §5.1):
  //     - Cards render in a row that WRAPS (never sprawls horizontally); on a
  //       narrow screen it wraps to more rows / scrolls rather than overflowing.
  //     - Clicking/tapping a card FOCUSES it (click is authoritative). Desktop
  //       hover ALSO focuses as a convenience, but hover never commits and a real
  //       click always wins. Keyboard focus (Tab) + Enter/Space activate the card
  //       button, which focuses it — cards are real <button>s, so keyboard and
  //       screen-reader users reach every card and the commit action.
  //     - The description panel is bound to the focused card and swaps LIVE as
  //       focus changes. NOTHING commits until the commit button is pressed;
  //       focusing a card has no side effect beyond updating the description.
  //
  //   Theme: colors/fonts come entirely from app.css theme vars (the 6 themes
  //   reskin it) — no hardcoded hex, matching RadialWeb.svelte / SubTabs.svelte.

  import type { SelectorCard } from "./game/model";

  // --- Props ----------------------------------------------------------------
  // `cards`           — the card list to show (specCards | categoryCards, or any
  //                     SelectorCard[]). The row and description panel both read
  //                     from this. An empty list renders an empty row + no panel
  //                     (defensive; the real tables are never empty).
  // `commitLabel`     — the commit button's text ("Choose this spec" | "View
  //                     Tree"). Purely a label; the button's ACTION is onCommit.
  // `onCommit`        — parent callback, called with the FOCUSED card's key when
  //                     the commit button is pressed. This is the only way the
  //                     component reports a decision outward; focus alone never
  //                     calls it. Defaulted to a no-op so an un-wired parent can
  //                     mount the component without crashing.
  // `initialFocusKey` — OPTIONAL key of the card focused first. Falls back to the
  //                     first card's key when omitted or when it doesn't resolve
  //                     to a real card (defensive: a stale/typo'd key must not
  //                     leave the panel blank).
  export let cards: SelectorCard[];
  export let commitLabel: string;
  export let onCommit: (key: string) => void = () => {};
  export let initialFocusKey: string | undefined = undefined;

  // --- Focus state ----------------------------------------------------------
  // `focusedKey` is the single piece of internal state: the key of the currently
  // highlighted card. Seeded from initialFocusKey when that resolves to a real
  // card, else the first card's key (or null if the list is somehow empty).
  //
  // Seeded ONCE at construction (not a reactive `$:` off initialFocusKey) on
  // purpose: after mount, focus is driven by the user's clicks/hover, so we must
  // NOT let a later prop change (or a parent re-render passing the same
  // initialFocusKey) yank the user's chosen focus back. initialFocusKey is a
  // first-render hint, not a controlling prop.
  function resolveInitialKey(): string | null {
    if (cards.length === 0) return null;
    // Use initialFocusKey only if it actually names a card in the list.
    if (initialFocusKey !== undefined && cards.some((c) => c.key === initialFocusKey)) {
      return initialFocusKey;
    }
    return cards[0].key;
  }
  let focusedKey: string | null = resolveInitialKey();

  // The resolved focused card (the description panel's data source). Reactive so
  // it follows focusedKey AND `cards` (if the parent swaps the list). Null when
  // nothing is focused OR the key no longer resolves — the panel then renders
  // nothing rather than crashing on undefined fields.
  $: focusedCard = focusedKey !== null ? cards.find((c) => c.key === focusedKey) ?? null : null;

  // --- Handlers -------------------------------------------------------------

  /**
   * Focus a card (click/tap, or hover on desktop). This is the ONLY thing that
   * changes which card the description panel shows. It has NO commit side effect
   * — the player can browse every card freely before deciding. Click is the
   * authoritative path; hover calls this too as a desktop convenience, but since
   * both funnel through here and neither commits, hover can never "accidentally"
   * choose anything.
   */
  function focusCard(key: string) {
    focusedKey = key;
  }

  /**
   * Commit the currently-focused card: report its key to the parent via
   * onCommit. Guarded so it only fires when a card is actually focused (the
   * button is also hidden when focusedCard is null, so this is belt-and-
   * suspenders against a synthesized/stale click). The parent decides what
   * committing MEANS (set spec / navigate) — this component just names the card.
   */
  function commit() {
    if (focusedKey !== null) {
      onCommit(focusedKey);
    }
  }
</script>

<!-- The whole selector. .tree-selector stacks the card row above the live
     description panel. -->
<div class="tree-selector">
  <!-- Card row. A full-width flex row whose cards each flex:1 1 0 (see <style>),
       so N cards split the width into equal 1/N shares and line up with the
       description panel below (design §5.1). Each card is a real <button> so it's keyboard- and
       screen-reader-reachable; class:focused highlights the active one.
       on:click/tap is what SELECTS (focuses) a card; hover only LIGHTS IT UP via
       CSS :hover (no focus change), so drifting the mouse across the row can never
       re-select a card you didn't intend (user request, 2026-07-09). aria-pressed
       exposes which card is currently focused to assistive tech. -->
  <div class="card-row" role="group" aria-label="Selection cards">
    {#each cards as card (card.key)}
      <button
        type="button"
        class="selector-card"
        class:focused={card.key === focusedKey}
        aria-pressed={card.key === focusedKey}
        on:click={() => focusCard(card.key)}
      >
        <!-- Wireframe-art placeholder box (mockup A): a simple bordered box with
             muted "art placeholder" text, standing in for real card art. -->
        <span class="card-art" aria-hidden="true">art placeholder</span>
        <span class="card-title">{card.title}</span>
      </button>
    {/each}
  </div>

  <!-- Live description panel, bound to the focused card. Everything here swaps
       the instant focus changes; only the commit button reports outward. -->
  {#if focusedCard}
    <div class="description-panel">
      <h3 class="description-title">{focusedCard.title}</h3>
      <p class="description-flavor">{focusedCard.flavor}</p>
      <ul class="description-bullets">
        {#each focusedCard.bullets as bullet}
          <li>{bullet}</li>
        {/each}
      </ul>
      <!-- Commit button — its label is the commitLabel prop; its action is the
           parent's onCommit(focusedKey). This is the ONLY control that commits. -->
      <div class="commit-row">
        <button type="button" class="commit-button" on:click={commit}>
          {commitLabel}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* --- Layout -----------------------------------------------------------
     Vertical stack: card row on top, description panel below (mockup A). */
  .tree-selector {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
  }

  /* --- Card row ---------------------------------------------------------
     Equal-share row (design intent, Checkpoint A→B): the row fills 100% width
     and each card flexes to an equal 1/N slice (flex:1 1 0 on .selector-card),
     so 3 captain-spec cards each take ~33% and the row lines up flush with the
     full-width description panel below it. No wrap/scroll: the cards divide the
     available width rather than sitting at a fixed size, which is why the old
     flex-wrap/overflow-x treatment is gone. The hidden-scrollbar rules are kept
     off since there's no scroll strip to hide now. */
  .card-row {
    display: flex;
    gap: 10px;
    width: 100%;
  }

  /* --- Card -------------------------------------------------------------
     Square-cornered "panel" look matching the app's chamfer idiom (same flat
     accent-tinted style as RadialWeb's nodes / SubTabs' tabs). flex:1 1 0 gives
     every card an EQUAL basis that grows to fill the row, so N cards each take
     ~1/N of the width (3 spec cards → 33% each) and align to the description
     panel below. Colors are all theme vars. */
  .selector-card {
    flex: 1 1 0; /* TUNABLE: equal 1/N share — verify fill/alignment on phone at Checkpoint B */
    min-width: 0; /* allow the equal slices to shrink below content width on narrow screens */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-text-secondary);
    font-family: var(--font-body);
    cursor: pointer;
    text-align: center;
    border-radius: 0; /* square, matching the node/panel/tab chamfer idiom */
  }
  /* Hover: "light up" the card (brighter border + a soft accent glow) as a desktop
     affordance. PURELY visual — hover no longer focuses/selects (that's on:click
     only), so drifting across the row can't change the preview. Kept distinct from
     .focused below (no background fill) so a hovered card doesn't read as selected.
     Touch ignores :hover. TUNABLE (glow strength) — Checkpoint B. */
  .selector-card:hover {
    border-color: rgba(var(--color-accent-rgb), 0.55);
    box-shadow: 0 0 8px 0 rgba(var(--color-accent-rgb), 0.35);
    color: var(--color-text-primary);
  }
  /* Focused card: the active highlight (accent border + bright text), matching
     SubTabs' .sub-tab.active idiom so the two selectors read consistently. */
  .selector-card.focused {
    background: rgba(var(--color-accent-rgb), 0.14);
    border-color: var(--color-accent);
    color: var(--color-accent-bright);
  }

  /* Wireframe-art placeholder box (mockup A): a bordered box with muted text.
     A dashed border + dim text reads clearly as "placeholder art goes here",
     not a real asset. Fixed aspect-ish height so cards line up in the row. */
  .card-art {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 64px; /* TUNABLE: art box height — Checkpoint B */
    border: 1px dashed rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-dim);
    font-size: 10px;
    font-style: italic;
    text-align: center;
  }
  .card-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
  }

  /* --- Description panel ------------------------------------------------
     Full-width panel below the row, bound to the focused card. Same
     panel-strong background + accent border as RadialWeb's tooltip card, so the
     "detail" surface reads consistently across the feature. */
  .description-panel {
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    padding: 14px 16px;
    border-radius: 0;
  }
  .description-title {
    margin: 0 0 8px;
    font-family: var(--font-body);
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-primary);
    line-height: 1.2;
  }
  .description-flavor {
    margin: 0 0 10px;
    font-size: 13px;
    font-style: italic;
    color: var(--color-text-secondary);
    line-height: 1.4;
  }
  .description-bullets {
    margin: 0 0 14px;
    padding-left: 18px;
    color: var(--color-text-primary);
    font-size: 13px;
    line-height: 1.5;
  }
  .description-bullets li {
    margin-bottom: 4px;
  }

  /* --- Commit button ----------------------------------------------------
     Accent-bordered primary action (matches RadialWeb's Learn button idiom).
     Right-aligned so it reads as the terminal "do it" control of the panel. */
  .commit-row {
    display: flex;
    justify-content: flex-end;
  }
  .commit-button {
    padding: 8px 18px; /* TUNABLE: commit button size — Checkpoint B */
    background: rgba(var(--color-accent-rgb), 0.12);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-bright);
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border-radius: 0; /* square, matching the node/panel chamfer idiom */
  }
  .commit-button:hover {
    background: rgba(var(--color-accent-rgb), 0.22);
  }
</style>
