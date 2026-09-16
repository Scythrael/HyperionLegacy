<script lang="ts">
  // PatchNotesEntry: renders ONE patch-note entry in the approved Blizzard-style
  // layout (marquee features with a header + lead + bullets, then flat category
  // buckets), or, for a legacy 0.13.4-and-earlier entry, its original prose.
  //
  // ONE renderer, two hosts: the in-game System > Patch Notes tab and the public
  // patch-notes page on the site both mount this, so the two can never drift.
  // Every colour and font reads an app.css theme token, so it matches whichever
  // surface (and theme) it renders in. No markdown is processed here: a bullet's
  // emphasis is the STRUCTURED `lead`, never markup in a string.
  import { isStructuredNote, type PatchNote } from "./patchNotes";

  export let entry: PatchNote;

  // 0.13.6 polish: legacy entries (0.13.4 and earlier) were one wall of prose. Their
  // summaries already carry ALL-CAPS "SECTION LABEL:" markers, so we split on those into a
  // lead paragraph + sub-headed sections for readability. This changes only the RENDERING,
  // never a word: the headings and bodies are exact slices of the original string, and if
  // no marker is found we fall back to the untouched single paragraph. The label pattern is
  // an uppercase phrase (letters/digits with spaces, commas, ampersands, apostrophes,
  // hyphens) of at least two characters, ending in a colon, matching only the intentional
  // section markers the legacy summaries use (verified against patchNotes.ts).
  type LegacySection = { heading: string; body: string };
  function parseLegacy(summary: string): { intro: string; sections: LegacySection[] } {
    const re = /([A-Z][A-Z0-9]+(?:[ ,&'-]+[A-Z0-9]+)*):/g;
    const marks: { label: string; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(summary)) !== null) {
      marks.push({ label: m[1], start: m.index, end: m.index + m[0].length });
    }
    if (marks.length === 0) return { intro: summary, sections: [] };
    const intro = summary.slice(0, marks[0].start).trim();
    const sections = marks.map((mk, i) => ({
      heading: mk.label,
      body: summary.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : summary.length).trim(),
    }));
    return { intro, sections };
  }
</script>

<article class="pn-entry">
  {#if isStructuredNote(entry)}
    <header class="pn-banner">
      <span class="pn-ver">{entry.version}</span>
      {#if entry.name}<span class="pn-name">{entry.name}</span>{/if}
    </header>
    {#if entry.lede}<p class="pn-lede">{entry.lede}</p>{/if}

    {#if entry.features}
      {#each entry.features as f}
        <section class="pn-feat">
          <h3 class="pn-feat-title">
            {f.title}{#if f.isNew}<span class="pn-new">New</span>{/if}
          </h3>
          <div class="pn-rule" aria-hidden="true"></div>
          {#if f.lead}<p class="pn-feat-lead">{f.lead}</p>{/if}
          <ul class="pn-bullets">
            {#each f.bullets as b}
              <li>{#if b.lead}<b class="pn-lead">{b.lead}</b>{/if}{b.text}</li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}

    {#if entry.categories}
      {#each entry.categories as c}
        <section class="pn-cat pn-cat-{c.tone ?? 'default'}">
          <h4 class="pn-cat-title">{c.title}</h4>
          <ul class="pn-bullets">
            {#each c.bullets as b}
              <li>{#if b.lead}<b class="pn-lead">{b.lead}</b>{/if}{b.text}</li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}

    {#if entry.save}
      <p class="pn-save"><b>Save compatibility.</b> {entry.save}</p>
    {/if}
  {:else}
    <header class="pn-banner"><span class="pn-ver">{entry.version}</span></header>
    {@const parsed = parseLegacy(entry.summary)}
    {#if parsed.sections.length === 0}
      <p class="pn-legacy">{entry.summary}</p>
    {:else}
      {#if parsed.intro}<p class="pn-legacy pn-legacy-lede">{parsed.intro}</p>{/if}
      {#each parsed.sections as s}
        <section class="pn-legacy-sec">
          <h4 class="pn-legacy-h">{s.heading}</h4>
          {#if s.body}<p class="pn-legacy">{s.body}</p>{/if}
        </section>
      {/each}
    {/if}
  {/if}
</article>

<style>
  .pn-entry {
    display: block;
    text-align: left;
  }
  .pn-banner {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 4px;
  }
  .pn-ver {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 2rem;
    line-height: 0.9;
    color: var(--color-accent);
  }
  .pn-name {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 0.95rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    padding-bottom: 3px;
  }
  .pn-lede {
    color: var(--color-text-secondary);
    font-size: 0.98rem;
    line-height: 1.55;
    margin: 14px 0 26px;
  }

  .pn-feat {
    margin: 0 0 26px;
  }
  .pn-feat-title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.1rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--color-text-primary);
    margin: 0 0 3px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pn-new {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-bg-deep);
    background: var(--color-accent);
    border-radius: var(--corner);
    padding: 2px 6px;
  }
  .pn-rule {
    height: 2px;
    background: linear-gradient(90deg, var(--color-accent), transparent 70%);
    margin: 0 0 10px;
  }
  .pn-feat-lead {
    color: var(--color-text-dim);
    font-size: 0.9rem;
    margin: 0 0 9px;
  }

  .pn-cat {
    margin: 30px 0 0;
  }
  .pn-cat-title {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 0.8rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin: 0 0 11px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--color-border);
  }

  .pn-bullets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .pn-bullets li {
    position: relative;
    padding-left: 18px;
    color: var(--color-text-primary);
    font-size: 0.94rem;
    line-height: 1.5;
  }
  .pn-bullets li::before {
    content: "";
    position: absolute;
    left: 2px;
    top: 0.55em;
    width: 5px;
    height: 5px;
    background: var(--color-accent);
    border-radius: var(--corner);
  }
  .pn-cat-fixes .pn-bullets li::before {
    background: var(--color-success);
  }
  .pn-cat-balance .pn-bullets li::before {
    background: var(--color-warning);
  }
  .pn-lead {
    font-weight: 600;
    margin-right: 0.32em;
  }

  .pn-save {
    margin-top: 30px;
    padding: 11px 13px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: var(--color-panel-bg);
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }
  .pn-save b {
    color: var(--color-text-primary);
  }

  /* Legacy prose entries (0.13.4 and earlier), rendered as their original text. */
  .pn-legacy {
    color: var(--color-text-secondary);
    font-size: 0.95rem;
    line-height: 1.6;
    margin: 14px 0 0;
  }
  /* 0.13.6: legacy entries split on their own ALL-CAPS section markers. The lead paragraph
     reads like the structured lede; each section gets a quiet uppercase sub-head so an old
     wall of prose scans like the new layout without a word being changed. */
  .pn-legacy-lede {
    color: var(--color-text-secondary);
    margin: 14px 0 22px;
  }
  .pn-legacy-sec {
    margin: 0 0 20px;
  }
  .pn-legacy-h {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 0.8rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin: 0 0 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--color-border);
  }
  .pn-legacy-sec .pn-legacy {
    margin: 0;
  }

  @media (max-width: 560px) {
    .pn-ver {
      font-size: 1.6rem;
    }
  }
</style>
