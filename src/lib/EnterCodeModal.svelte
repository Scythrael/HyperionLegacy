<script lang="ts">
  // EnterCodeModal: Settings > Codes > "Enter code" (0.13.11, design section 4; 0.13.11.1 section 1
  // and 2, mockup frames 1 and 2).
  //
  // Two ways in: a gift code box with Redeem, paid by the host's do* handler (onRedeem: a code is
  // paid once per account; re-entering says so, and from the third time in a row a humor line is
  // added), and "Combo input", which opens the pad. Correct presses fill the next segment of ONE
  // twelve-segment strip with their symbol (arrows as SVG, A and B in circles, SEL and STA in
  // squares); a wrong press clears it silently. The window never shows or hints at the sequence.
  // On the twelfth correct press it calls onComboComplete: the first time the host opens the game
  // over this window and the message here says where it lives now; after that the combo only says
  // it has already been found.
  //
  // Keys (event.code, so layouts cannot change them) are only read while the combo area is open,
  // focus is not in the code field, and the game is not open on top; every rule lives in
  // secret/combo.ts, where it is tested.
  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import type { IconName } from "./ui/icons";
  import type { RedeemOutcome } from "./accountExtras";
  import { COMBO_SEQUENCE, COMBO_LENGTH, comboActionForKey, advanceCombo, type ComboKey } from "./secret/combo";
  import { COPY } from "./secret/config";

  export let onClose: () => void;
  export let onComboComplete: () => "found" | "already";
  export let onRedeem: (raw: string) => RedeemOutcome;
  // True while the game is open over this window: its keys belong to the game, not the pad.
  export let suspended = false;

  type Message = { tone: "ok" | "info"; strong?: string; text: string; lore?: string };

  let code = "";
  let codeMessage: Message | null = null;
  let comboMessage: Message | null = null;
  // Bumped on every answer, so the same message twice in a row is re-drawn and re-announced.
  let codeSerial = 0;
  let comboSerial = 0;
  let comboOpen = false;
  let pos = 0;
  let codeInput: HTMLInputElement | null = null;

  const GLYPH: Partial<Record<ComboKey, IconName>> = { up: "arrowUp", down: "arrowDown", left: "arrowLeft", right: "arrowRight" };
  const CIRCLE: Partial<Record<ComboKey, string>> = { b: "B", a: "A" };
  const SQUARE: Partial<Record<ComboKey, string>> = { select: "SEL", start: "STA" };
  const SLOTS = Array.from({ length: COMBO_LENGTH }, (_, i) => i);

  // The unlock messages (approved 2026-10-23, mockup frame 2 tone).
  const FOUND: Message = { tone: "ok", strong: `Unlocked: ${COPY.listName}.`, text: "Find it any time under the Minigames button at the top, next to Help." };
  const ALREADY_FOUND: Message = { tone: "info", text: "You've already found this one. It lives under the Minigames button now." };

  function messageFor(outcome: RedeemOutcome): Message {
    switch (outcome.kind) {
      case "empty":
        return { tone: "info", text: "Type a code first." };
      case "unknown":
        return { tone: "info", text: "That code isn't recognized." };
      case "redeemed":
        return { tone: "ok", strong: "Code redeemed.", text: `+${outcome.credits.toLocaleString("en-US")} credits added to your fleet.` };
      case "already":
        return { tone: "info", text: "This code has been redeemed on this account.", lore: outcome.line?.text };
    }
  }

  function redeem(): void {
    codeMessage = messageFor(onRedeem(code));
    codeSerial += 1;
  }

  function toggleCombo(): void {
    comboOpen = !comboOpen;
    pos = 0;
  }

  function press(key: ComboKey): void {
    pos = advanceCombo(pos, key);
    if (pos === COMBO_LENGTH) {
      pos = 0;
      comboMessage = onComboComplete() === "found" ? FOUND : ALREADY_FOUND;
      comboSerial += 1;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (suspended || !comboOpen || event.target === codeInput) return;
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

<ActionModal title="ENTER CODE" ariaLabel="Enter code" iconClose {onClose}>
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
      <div class="ec-live" aria-live="polite">
        {#if codeMessage}{#key codeSerial}
          <div class="ec-msg" class:ok={codeMessage.tone === "ok"}>
            {#if codeMessage.strong}<b>{codeMessage.strong}</b>{/if}
            {codeMessage.text}
            {#if codeMessage.lore}<span class="ec-lore">"{codeMessage.lore}"</span>{/if}
          </div>
        {/key}{/if}
      </div>
    </form>

    <div class="ec-divider" aria-hidden="true">OR</div>

    <button class="ec-btn ec-wide" type="button" aria-expanded={comboOpen} aria-controls="ec-combo" on:click={toggleCombo}>
      Combo input
    </button>

    {#if comboOpen}
      <div class="ec-combo" id="ec-combo">
        <div class="ec-strip" role="status" aria-label={`Combo progress: ${pos} of ${COMBO_LENGTH}`}>
          {#each SLOTS as i}
            {@const key = COMBO_SEQUENCE[i]}
            {@const glyph = GLYPH[key]}
            <div class="ec-seg" class:lit={i < pos} aria-hidden="true">
              {#if i < pos}
                {#if glyph}<Icon name={glyph} size={15} />{:else if CIRCLE[key]}<span class="ec-circ">{CIRCLE[key]}</span>{:else}<span class="ec-sq">{SQUARE[key]}</span>{/if}
              {/if}
            </div>
          {/each}
        </div>
        <div class="ec-live" aria-live="polite">
          {#if comboMessage}{#key comboSerial}
            <div class="ec-msg" class:ok={comboMessage.tone === "ok"}>
              {#if comboMessage.strong}<b>{comboMessage.strong}</b>{/if}
              {comboMessage.text}
            </div>
          {/key}{/if}
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
  .ec-live:empty {
    display: none;
  }
  .ec-msg {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.25);
    overflow-wrap: anywhere;
  }
  .ec-msg.ok {
    border-color: color-mix(in srgb, var(--color-success) 50%, transparent);
  }
  .ec-msg.ok b {
    color: var(--color-success);
  }
  .ec-lore {
    display: block;
    margin-top: 4px;
    color: var(--color-text-secondary);
    font-style: italic;
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
  /* ONE segmented strip (0.13.11.1, mockup frame 1): twelve equal segments, one row at 375 px. */
  .ec-strip {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    overflow: hidden;
    background: rgba(0, 0, 0, 0.35);
  }
  .ec-seg {
    height: 34px;
    min-width: 0;
    display: grid;
    place-items: center;
    border-right: 1px solid var(--color-border);
    color: var(--color-text-dim);
  }
  .ec-seg:last-child {
    border-right: none;
  }
  .ec-seg.lit {
    background: rgba(var(--color-accent-rgb), 0.12);
    color: var(--color-accent-bright);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }
  .ec-circ {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-size: var(--text-3xs);
    font-weight: 700;
    line-height: 1;
  }
  .ec-sq {
    border: 1.5px solid currentColor;
    border-radius: 1px;
    padding: 2px 1px;
    font-family: var(--font-display);
    font-size: var(--text-3xs);
    line-height: 1;
    letter-spacing: 0;
  }  .ec-pad {
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
    .ec-seg {
      height: 30px;
    }
    .ec-circ {
      width: 15px;
      height: 15px;
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
