<script lang="ts">
  // EnterCodeModal: Settings > Codes > "Enter code" (0.13.11, design section 4).
  //
  // Two ways in: a gift code box with Redeem (0.13.11 ships no codes, so every code answers "not
  // recognized"; redeemCode is the seam a later patch fills), and "Combo input", which opens a
  // twelve-slot pad. Correct presses light the slots; a wrong press clears them silently. The
  // window never shows or hints at the sequence. On the twelfth correct press it calls
  // onComboComplete and the host opens the secret game.
  //
  // Keys (event.code, so layouts cannot change them) are only read while the combo area is open and
  // focus is not in the code field; every rule lives in secret/combo.ts, where it is tested.
  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import type { IconName } from "./ui/icons";
  import { redeemCode, redeemMessage } from "./secret/codes";
  import { COMBO_SEQUENCE, COMBO_LENGTH, comboActionForKey, advanceCombo, type ComboKey } from "./secret/combo";

  export let onClose: () => void;
  export let onComboComplete: () => void;

  let code = "";
  let message = "";
  let comboOpen = false;
  let pos = 0;
  let codeInput: HTMLInputElement | null = null;

  const GLYPH: Partial<Record<ComboKey, IconName>> = { up: "arrowUp", down: "arrowDown", left: "arrowLeft", right: "arrowRight" };
  const TEXT: Partial<Record<ComboKey, string>> = { b: "B", a: "A", select: "SEL", start: "STA" };
  const SLOTS = Array.from({ length: COMBO_LENGTH }, (_, i) => i);

  function redeem(): void {
    message = redeemMessage(redeemCode(code));
  }

  function toggleCombo(): void {
    comboOpen = !comboOpen;
    pos = 0;
  }

  function press(key: ComboKey): void {
    pos = advanceCombo(pos, key);
    if (pos === COMBO_LENGTH) {
      pos = 0;
      onComboComplete();
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!comboOpen || event.target === codeInput) return;
    if (event.code === "Escape") return; // the window's own Escape closes it
    const targetIsButton = event.target instanceof HTMLButtonElement;
    const action = comboActionForKey(event.code, event.repeat, targetIsButton);
    if (action === "ignore") {
      // A held arrow still must not scroll the page.
      if (event.repeat && event.code.startsWith("Arrow")) event.preventDefault();
      return;
    }
    if (action === "other") {
      pos = 0;
      return;
    }
    // preventDefault: arrows must not scroll, and Enter on a focused button must not click it.
    event.preventDefault();
    press(action);
  }
</script>

<svelte:window on:keydown={onKeydown} />

<ActionModal title="ENTER CODE" ariaLabel="Enter code" {onClose}>
  <div class="ec">
    <form class="ec-section" on:submit|preventDefault={redeem}>
      <div class="ec-label" id="ec-gift-label">GIFT CODE</div>
      <div class="ec-field">
        <input
          bind:this={codeInput}
          bind:value={code}
          class="ec-input"
          type="text"
          placeholder="XXXX-XXXX"
          aria-labelledby="ec-gift-label"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="32"
        />
        <button class="ec-btn primary" type="submit">Redeem</button>
      </div>
      <div class="ec-msg" aria-live="polite">{message}</div>
    </form>

    <div class="ec-divider" aria-hidden="true">OR</div>

    <button class="ec-btn ec-wide" type="button" aria-expanded={comboOpen} aria-controls="ec-combo" on:click={toggleCombo}>
      Combo input
    </button>

    {#if comboOpen}
      <div class="ec-combo" id="ec-combo">
        <div class="ec-slots" role="status" aria-label={`Combo progress: ${pos} of ${COMBO_LENGTH}`}>
          {#each SLOTS as i}
            {@const key = COMBO_SEQUENCE[i]}
            {@const glyph = GLYPH[key]}
            <div class="ec-slot" class:lit={i < pos} aria-hidden="true">
              {#if i < pos}
                {#if glyph}<Icon name={glyph} size={14} />{:else}{TEXT[key]}{/if}
              {/if}
            </div>
          {/each}
        </div>

        <div class="ec-pad">
          <div class="ec-dpad">
            <span></span>
            <button type="button" class="ec-btn ec-dir" aria-label="Up" on:click={() => press("up")}><Icon name="arrowUp" size={18} /></button>
            <span></span>
            <button type="button" class="ec-btn ec-dir" aria-label="Left" on:click={() => press("left")}><Icon name="arrowLeft" size={18} /></button>
            <span></span>
            <button type="button" class="ec-btn ec-dir" aria-label="Right" on:click={() => press("right")}><Icon name="arrowRight" size={18} /></button>
            <span></span>
            <button type="button" class="ec-btn ec-dir" aria-label="Down" on:click={() => press("down")}><Icon name="arrowDown" size={18} /></button>
            <span></span>
          </div>
          <div class="ec-mid">
            <div class="ec-row">
              <button type="button" class="ec-btn ec-small" aria-label="Select" on:click={() => press("select")}>SELECT</button>
              <button type="button" class="ec-btn ec-small" aria-label="Start" on:click={() => press("start")}>START</button>
            </div>
          </div>
          <div class="ec-face">
            <button type="button" class="ec-btn ec-round" aria-label="B" on:click={() => press("b")}>B</button>
            <button type="button" class="ec-btn ec-round ec-raised" aria-label="A" on:click={() => press("a")}>A</button>
          </div>
        </div>
        <div class="ec-hint">Keyboard: arrows, <kbd>B</kbd> <kbd>A</kbd>, <kbd>Right Shift</kbd>, <kbd>Enter</kbd></div>
      </div>
    {/if}
  </div>
</ActionModal>

<style>
  .ec {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
  }
  .ec-section {
    display: grid;
    gap: var(--space-3);
    margin: 0;
  }
  .ec-label {
    font-family: var(--font-display);
    font-size: var(--text-2xs);
    letter-spacing: 0.16em;
    color: var(--color-accent);
  }
  .ec-field {
    display: flex;
    gap: var(--space-4);
    min-width: 0;
  }
  .ec-input {
    flex: 1;
    min-width: 0;
    min-height: 36px;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-primary);
    background: var(--color-bg-deep);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    padding: 6px 10px;
  }
  .ec-input:focus-visible,
  .ec-btn:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .ec-msg {
    min-height: 1.4em;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .ec-divider {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    font-size: var(--text-2xs);
    letter-spacing: 0.14em;
    color: var(--color-text-dim);
  }
  .ec-divider::before,
  .ec-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }
  .ec-btn {
    min-height: 36px;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-accent);
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    padding: 6px 12px;
    cursor: pointer;
  }
  .ec-btn:hover {
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .ec-btn.primary {
    background: rgba(var(--color-accent-rgb), 0.18);
    color: var(--color-text-primary);
  }
  .ec-wide {
    width: 100%;
  }
  .ec-combo {
    display: grid;
    gap: var(--space-5);
  }
  .ec-slots {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .ec-slot {
    height: 26px;
    display: grid;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .ec-slot.lit {
    border-color: var(--color-accent);
    color: var(--color-accent-bright);
    background: rgba(var(--color-accent-rgb), 0.12);
    box-shadow: 0 0 10px rgba(var(--color-accent-rgb), 0.25) inset;
  }
  .ec-pad {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-6);
    align-items: center;
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.25);
  }
  .ec-dpad {
    display: grid;
    grid-template-columns: repeat(3, 40px);
    grid-template-rows: repeat(3, 40px);
    gap: 3px;
  }
  .ec-dir {
    padding: 0;
    display: grid;
    place-items: center;
  }
  .ec-mid {
    display: grid;
    justify-items: center;
  }
  .ec-row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    justify-content: center;
  }
  .ec-small {
    font-family: var(--font-display);
    font-size: var(--text-3xs);
    letter-spacing: 0.14em;
    padding: 4px 10px;
  }
  .ec-face {
    display: flex;
    gap: var(--space-5);
  }
  .ec-round {
    width: 46px;
    height: 46px;
    padding: 0;
    border-radius: 50%;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: var(--text-lg);
  }
  .ec-raised {
    margin-top: -14px;
  }
  .ec-hint {
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .ec-hint kbd {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    border: 1px solid var(--color-border);
    border-bottom-width: 2px;
    padding: 0 4px;
    border-radius: var(--corner);
    color: var(--color-text-secondary);
  }
  @media (max-width: 420px) {
    .ec-slots {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .ec-pad {
      gap: var(--space-4);
      padding: var(--space-4);
    }
    .ec-dpad {
      grid-template-columns: repeat(3, 36px);
      grid-template-rows: repeat(3, 36px);
    }
    .ec-round {
      width: 40px;
      height: 40px;
    }
    .ec-small {
      padding: 4px 6px;
    }
  }
</style>
