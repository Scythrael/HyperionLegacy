<script lang="ts">
  // BackgroundConfigure: the CONFIGURE BACKGROUND window (0.14.0 Slice 5b, signed-off mockup v2,
  // docs/plans/2026-10-29-background-settings-mockup.html section 2). Every background sits on top
  // (locked ones with the generic hint), a live preview below, then the picked background's own
  // controls (Default: nothing to tune). Reset to default and Done in the footer.
  import ActionModal from "./ActionModal.svelte";
  import Toggle from "./Toggle.svelte";
  import Starfield from "./Starfield.svelte";
  import FasterThanLight from "./FasterThanLight.svelte";
  import {
    BACKGROUNDS,
    FTL_DEFAULTS,
    LOCKED_HINT,
    SLIDER_MAX,
    SLIDER_MIN,
    backgroundUnlocked,
    effectiveStill,
    type BackgroundId,
    type FtlSettings,
    type Rgb,
  } from "./backgroundStyle";

  export let unlocked: readonly string[];
  export let selected: BackgroundId;
  export let ftl: FtlSettings;
  // The streak colors for the theme and for white (Ignore theme colors), from the parent's look.
  export let themePalette: readonly Rgb[];
  export let whitePalette: readonly Rgb[];
  export let reducedMotion: boolean;
  export let onPick: (id: BackgroundId) => void;
  export let onChange: (ftl: FtlSettings) => void;
  export let onClose: () => void;

  let jumpToken = 0;

  type Slider = { key: "speed" | "streakLength" | "stars" | "brightness"; label: string };
  const SLIDERS: readonly Slider[] = [
    { key: "speed", label: "Speed" },
    { key: "streakLength", label: "Streak length" },
    { key: "stars", label: "Stars" },
    { key: "brightness", label: "Brightness" },
  ];

  function set(patch: Partial<FtlSettings>): void {
    onChange({ ...ftl, ...patch });
  }

  function reset(): void {
    onChange({ ...FTL_DEFAULTS });
    jumpToken += 1;
  }

  $: still = effectiveStill(ftl, reducedMotion);
  $: palette = ftl.ignoreThemeColors ? whitePalette : themePalette;
</script>

<ActionModal title="Configure background" ariaLabel="Configure background" iconClose {onClose}>
  <div class="bc">
    <div class="bc-vis" role="group" aria-label="Background">
      {#each BACKGROUNDS as bg (bg.id)}
        {#if backgroundUnlocked(bg.id, unlocked)}
          <button type="button" class="bc-vbtn" aria-pressed={selected === bg.id} on:click={() => onPick(bg.id)}>{bg.label}</button>
        {:else}
          <button type="button" class="bc-vbtn locked" disabled>Locked<small>{LOCKED_HINT}</small></button>
        {/if}
      {/each}
    </div>

    <div class="bc-preview" role="img" aria-label="Live preview of the background">
      {#if selected === "fasterThanLight"}
        <FasterThanLight settings={ftl} {palette} {still} {jumpToken} />
      {:else}
        <div class="bc-default"><Starfield /></div>
      {/if}
    </div>

    {#if selected === "fasterThanLight"}
      <div class="bc-grid">
        {#each SLIDERS as s (s.key)}
          <div class="bc-slider">
            <label for="bc-{s.key}">{s.label}</label>
            <input
              id="bc-{s.key}"
              type="range"
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step="1"
              value={ftl[s.key]}
              on:input={(e) => set({ [s.key]: Number((e.target as HTMLInputElement).value) } as Partial<FtlSettings>)}
            />
            <span class="bc-v">{ftl[s.key]}</span>
          </div>
        {/each}
        <div class="bc-tog">
          <Toggle label="Ignore theme colors" checked={ftl.ignoreThemeColors} on:change={(e) => set({ ignoreThemeColors: e.detail })} />
          <span>Ignore theme colors (classic white streaks)</span>
        </div>
        <div class="bc-tog">
          <Toggle
            label="Jump to warp when it turns on"
            checked={ftl.jumpOnStart}
            on:change={(e) => {
              set({ jumpOnStart: e.detail });
              if (e.detail) jumpToken += 1;
            }}
          />
          <span>Jump to warp when it turns on</span>
        </div>
        <div class="bc-tog">
          <Toggle label="Still" checked={still} disabled={reducedMotion} on:change={(e) => set({ still: e.detail })} />
          <span>Still (no motion). On automatically when your system asks for reduced motion.</span>
        </div>
      </div>
    {:else}
      <p class="bc-note">The classic backdrop has nothing to tune.</p>
    {/if}
  </div>

  <svelte:fragment slot="footer">
    <button type="button" class="bc-btn bc-reset" on:click={reset} disabled={selected !== "fasterThanLight"}>Reset to default</button>
    <button type="button" class="bc-btn" on:click={onClose}>Done</button>
  </svelte:fragment>
</ActionModal>

<style>
  .bc {
    display: grid;
    gap: var(--space-4);
  }
  .bc-vis {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .bc-vbtn {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    padding: 7px 12px;
    min-height: 36px;
    cursor: pointer;
    text-align: left;
  }
  .bc-vbtn[aria-pressed="true"] {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .bc-vbtn.locked {
    border-style: dashed;
    color: var(--color-text-dim);
    cursor: not-allowed;
  }
  .bc-vbtn.locked small {
    display: block;
    font-size: var(--text-2xs);
  }
  .bc-preview {
    position: relative;
    height: 210px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    overflow: hidden;
    background: #03050b;
  }
  .bc-default {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, var(--color-bg-deep) 0%, var(--color-bg-mid) 60%, #081018 100%);
  }
  .bc-grid {
    display: grid;
    gap: var(--space-4);
  }
  .bc-slider {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr) 40px;
    gap: 10px;
    align-items: center;
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .bc-slider input[type="range"] {
    width: 100%;
    accent-color: var(--color-accent);
  }
  .bc-v {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-align: right;
  }
  .bc-tog {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .bc-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .bc-btn {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    padding: 7px 12px;
    min-height: 36px;
    cursor: pointer;
  }
  .bc-btn:disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }
  /* The mockup's footer: Reset on the left, Done on the right. */
  .bc-reset {
    margin-right: auto;
  }
  .bc-vbtn:focus-visible,
  .bc-btn:focus-visible,
  .bc-slider input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (max-width: 460px) {
    .bc-slider {
      grid-template-columns: 1fr 40px;
    }
    .bc-slider label {
      grid-column: 1 / -1;
    }
  }
</style>
