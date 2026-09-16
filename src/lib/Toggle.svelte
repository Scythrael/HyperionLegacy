<script lang="ts">
  import { createEventDispatcher } from "svelte";
  // ============================================================================
  // Toggle: the square-cornered on/off switch. 0.13.5, from the approved mockup.
  //
  // ⚠️ A REAL `role="switch"`, NOT A STYLED DIV, AND THAT IS NOT NEGOTIABLE. A div with a click
  // handler is invisible to a screen reader and unreachable from a keyboard, so it is a control a
  // whole class of players cannot operate at all. This is the same defect the color-blot theme
  // picker had, and 0.13.5 exists partly to fix that one; shipping its replacement with the same
  // hole would be absurd. It is a <button> (so it is focusable and Enter/Space already activate it)
  // carrying aria-checked, plus an explicit Space handler because a button would otherwise scroll
  // the page on Space.
  //
  // ⚠️ THE OFF STATE USES THE *DIM* TOKEN, NEVER --color-text-disabled. The user asked for off to be
  // "grayed out a bit", and the obvious token is the wrong one: an OFF toggle is fully interactive,
  // while --color-text-disabled means "you cannot use this". Borrowing it would tell a player the
  // control is unavailable and, worse, would reintroduce the exact contrast problem this release
  // measured and fixed (that token sits at the AA floor precisely because nothing needs to read it
  // carefully; a knob the player is about to click does).
  //
  // The ON glow is theme-linked through --color-accent-rgb, so it recolors with the player's theme
  // and with any future skin, rather than being a literal that only looks right on cyan.
  // ============================================================================

  // Current state. Two-way: the parent binds it, or reads it in on:change.
  export let checked: boolean = false;
  // What the switch controls, for assistive tech. Required, because a switch with no name is a
  // switch a screen-reader user cannot identify.
  export let label: string;
  // Renders non-interactive. Genuinely disabled controls DO use the disabled token; see above for
  // why "off" does not.
  export let disabled: boolean = false;

  // ⚠️ CONTROLLED, NOT SELF-MUTATING. This DISPATCHES the new value; it does NOT flip its own
  // `checked` prop. The first version did `checked = !checked` and bound the button's click to it
  // internally, which was a silent bug: `on:click` on a Svelte COMPONENT is not forwarded unless
  // the component dispatches it, so every parent handler (`on:click={...}`) never fired, the parent
  // state never changed, and nothing saved. The knob appeared to do nothing. Now the parent owns
  // the state and listens with `on:change`, exactly like the native checkboxes elsewhere in the app.
  const dispatch = createEventDispatcher<{ change: boolean }>();

  function flip(): void {
    if (disabled) return;
    dispatch("change", !checked);
  }

  function onKeydown(event: KeyboardEvent): void {
    // Enter already activates a <button>. Space scrolls the page unless it is claimed here, which
    // is the one keyboard behavior a native checkbox gives free and a button does not.
    if (event.key === " ") {
      event.preventDefault();
      flip();
    }
  }
</script>

<button
  type="button"
  class="toggle"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  on:click={flip}
  on:keydown={onKeydown}
>
  <span class="toggle-knob" aria-hidden="true"></span>
</button>

<style>
  .toggle {
    /* Squared off, per the user: the usual fully-rounded pill was explicitly not wanted. A 2px
       radius still softens the corner enough not to look like a rendering bug at small sizes. */
    --toggle-h: 22px;
    --toggle-w: 44px;
    width: var(--toggle-w);
    height: var(--toggle-h);
    flex: none;
    padding: 2px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    transition:
      background 0.18s ease,
      border-color 0.18s ease;
  }
  .toggle-knob {
    display: block;
    width: calc(var(--toggle-h) - 6px);
    height: calc(var(--toggle-h) - 6px);
    border-radius: var(--corner);
    /* OFF: the DIM text token. Readable, clearly inactive, and NOT the disabled token. */
    background: var(--color-text-dim);
    transform: translateX(0);
    transition:
      transform 0.18s ease,
      background 0.18s ease,
      box-shadow 0.18s ease;
  }
  .toggle[aria-checked="true"] {
    background: rgba(var(--color-accent-rgb), 0.18);
    border-color: var(--color-border-strong);
  }
  .toggle[aria-checked="true"] .toggle-knob {
    transform: translateX(calc(var(--toggle-w) - var(--toggle-h)));
    background: var(--color-accent);
    /* The glow the user approved. Theme-linked, so it follows the accent. */
    box-shadow:
      0 0 7px rgba(var(--color-accent-rgb), 0.85),
      0 0 2px rgba(var(--color-accent-rgb), 1);
  }
  .toggle:hover:not(:disabled) {
    border-color: var(--color-border-strong);
  }
  /* A VISIBLE focus ring. Without it the keyboard support above is theoretical: you can reach the
     control but cannot see that you have. */
  .toggle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .toggle:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  /* Reduced motion: the knob still MOVES (its position is the state, so it must), it simply stops
     easing. Same principle as the tick bar, where the fix was to keep the information and drop the
     animation rather than the other way round. */
  @media (prefers-reduced-motion: reduce) {
    .toggle,
    .toggle-knob {
      transition: none;
    }
  }
</style>
