<script lang="ts">
  // ============================================================================
  // MuseumPanel.svelte
  // Author: Claude (Opus 5.5) | Exploration 0.14.0 phase E4c (Relic + Museum UI)
  //
  // The Archive facility's MUSEUM sub-tab. It realizes "The Museum" half of the approved "Relic Museum"
  // mockup (2026-10-01): for each of the four relic sets, a header (the set's emblem, name, how many of
  // its relics are discovered, its per-copy passive), a ROSTER of relic tiles in K-piece order (an
  // undiscovered relic is masked and never named early), and the RELIC BONUSES tier rows (K-piece /
  // relics 1-K, five level pips on the doubling copy ladder, the next threshold or the BOTTLENECK relic
  // holding the tier back, the tier's live bonus, and the LOCKED state).
  //
  // POSTURE (mirrors ExpeditionPanel / GambitEditorPanel): PURE PRESENTATION. It reads the Tier I museum record (generalMuseumRecord) /
  // state.relicDiscovered through the relics.ts readers (setTierLevels, setCompletion, relicCopies,
  // setTierBonus, setPerCopyBonus), so every number on screen is the engine's own number. It has no
  // actions and never mutates state.
  //
  // RESPONSIVE the container-query way (ONE shared DOM, NO isMobile JS): a narrow container (<= 560px)
  // stacks each tier row as [name + bonus] over [pips + next], the mockup's phone layout. Works at 375px.
  // EVERY GRAPHIC IS SVG via <Icon> (user hard requirement): glyphs come from ui/relicIcons.ts.
  // ============================================================================

  import { generalMuseumRecord, type GameState } from "./game/model";
  import {
    RELIC_SETS,
    MUSEUM_COPY_LADDER,
    MUSEUM_TIER_LEVEL_BONUS,
    MUSEUM_PER_COPY_BONUS,
    getRelicById,
    relicCopies,
    setCompletion,
    setTierLevels,
    setTierBonus,
    setPerCopyBonus,
    type RelicSetDef,
    type SetTierLevel,
  } from "./game/relics";
  import { getPoiById } from "./game/expeditionContent";
  import Icon from "./ui/Icon.svelte";
  import {
    relicIcon,
    relicSetEmblem,
    relicRarityColor,
    RELIC_RARITY_LABEL,
    MUSEUM_STAT_LABEL,
    formatMuseumPct,
    formatMuseumStatBonus,
    museumPerCopyText,
  } from "./ui/relicIcons";

  // --- Props ------------------------------------------------------------------
  export let state: GameState;

  // --- Derived reads ----------------------------------------------------------
  $: museum = generalMuseumRecord(state);
  $: discovered = new Set(state.relicDiscovered ?? []);
  $: totalRelics = RELIC_SETS.reduce((n, s) => n + s.relicIds.length, 0);
  $: discoveredCount = RELIC_SETS.reduce((n, s) => n + s.relicIds.filter((rid) => isDiscovered(rid, museum, discovered)).length, 0);
  $: totalCopies = RELIC_SETS.reduce((n, s) => n + setCompletion(museum, s.id).totalCopies, 0);

  // One view per set, recomputed whenever the museum changes.
  $: setViews = RELIC_SETS.map((set) => buildSetView(set, museum, discovered));

  // A relic counts as discovered once it has an identified copy (copies never decrease) or sits in the
  // first-find registry. Undiscovered relics are masked: their NAME is never shown early.
  function isDiscovered(rid: string, m: Record<string, number>, d: Set<string>): boolean {
    return relicCopies(m, rid) > 0 || d.has(rid);
  }

  interface TierView {
    tier: SetTierLevel;
    nextText: string;
    warn: boolean; // a single relic is holding the tier back (the bottleneck call-out)
    bonusText: string;
  }

  // The tier's "what next" line. LOCKED names only the relic's POSITION (never its name, it may be
  // undiscovered). A SINGLE holdout (every other required relic already meets the next rung) is the
  // BOTTLENECK call-out; otherwise the rung applies to every required relic ("copies each").
  function tierNext(set: RelicSetDef, t: SetTierLevel, m: Record<string, number>): { text: string; warn: boolean; holdout: string | null } {
    if (t.locked) {
      const idx = getRelicById(t.bottleneckRelicId)?.index ?? t.pieces;
      return { text: `Locked · discover relic ${idx}`, warn: false, holdout: null };
    }
    if (t.nextThreshold === null) return { text: `Lv ${t.level} · max level`, warn: false, holdout: null };
    const required = set.relicIds.slice(0, t.pieces);
    const below = required.filter((rid) => relicCopies(m, rid) < (t.nextThreshold as number));
    if (below.length === 1) {
      const label = getRelicById(below[0])?.label ?? below[0];
      return {
        text: `Lv ${t.level} · ${label} needs ${t.copiesToNextLevel} more (${t.nextThreshold})`,
        warn: true,
        holdout: below[0],
      };
    }
    return { text: `Lv ${t.level} · next at ${t.nextThreshold} copies each`, warn: false, holdout: null };
  }

  // The tier's live bonus, from the engine's own per-tier formula (setTierBonus). A locked capstone reads
  // "capstone bonus" (the mockup's wording); any other locked tier names its stat(s) without a number.
  function tierBonusText(t: SetTierLevel): string {
    const labels = t.stats.map((s) => MUSEUM_STAT_LABEL[s]);
    if (t.locked) return t.capstone ? "capstone bonus" : labels.join(" + ");
    const each = setTierBonus(t);
    // GO-6: hazard resist reads its EFFECTIVE value on the curve toward the cap (formatMuseumStatBonus).
    return t.stats.map((s) => formatMuseumStatBonus(s, each)).join(", ");
  }

  function buildSetView(set: RelicSetDef, m: Record<string, number>, d: Set<string>) {
    const completion = setCompletion(m, set.id);
    const holdouts = new Set<string>();
    const tiers: TierView[] = setTierLevels(m, set.id).map((t) => {
      const next = tierNext(set, t, m);
      if (next.holdout !== null) holdouts.add(next.holdout);
      return { tier: t, nextText: next.text, warn: next.warn, bonusText: tierBonusText(t) };
    });
    const relics = set.relicIds.map((rid) => {
      const def = getRelicById(rid);
      return {
        id: rid,
        index: def?.index ?? 0,
        label: def?.label ?? rid,
        rarity: def?.rarity ?? "common",
        flavor: def?.flavor ?? "",
        copies: relicCopies(m, rid),
        discovered: isDiscovered(rid, m, d),
        bottleneck: holdouts.has(rid),
      };
    });
    return {
      set,
      completion,
      relics,
      tiers,
      perCopyTotal: setPerCopyBonus(completion.totalCopies),
      sources: set.sources.map((poi) => getPoiById(poi)?.label ?? poi).join(", "),
    };
  }
</script>

<div class="mu">
  <div class="mu-summary">
    <span class="mu-summary-n">{discoveredCount}</span>
    <span class="mu-summary-l">of {totalRelics} relics discovered</span>
    <span class="mu-summary-c">{totalCopies} {totalCopies === 1 ? "copy" : "copies"} on display</span>
  </div>
  <p class="mu-ladder">
    <b>How set bonuses level:</b> owning relics 1 through K unlocks a K-piece tier. Each level needs every required relic at the next copy threshold,
    <b>{MUSEUM_COPY_LADDER.join(" / ")}</b>, and adds {formatMuseumPct(MUSEUM_TIER_LEVEL_BONUS)}. A tier is only as strong as its least-collected relic.
  </p>

  {#each setViews as v (v.set.id)}
    <section class="mu-set">
      <div class="mu-set-h">
        <span class="mu-emblem"><Icon name={relicSetEmblem(v.set.id)} size={20} /></span>
        <span class="mu-set-name">{v.set.label}</span>
        <span class="mu-set-count">{v.completion.collected} of {v.completion.total} discovered</span>
      </div>
      <div class="mu-set-sub">
        {museumPerCopyText(v.set.perCopyStat, v.completion.totalCopies, v.perCopyTotal)}
      </div>
      <div class="mu-set-src">From: {v.sources}</div>

      <!-- ROSTER, in K-piece order. -->
      <div class="mu-roster">
        {#each v.relics as r (r.id)}
          {#if r.discovered}
            <div class="mu-relic" class:bottleneck={r.bottleneck} style="--ring: {relicRarityColor(r.rarity)};" title={r.flavor}>
              <span class="mu-ic"><Icon name={relicIcon(r.id)} size={20} /></span>
              <span class="mu-rt">
                <span class="mu-nm">{r.index} · {r.label}</span>
                <span class="mu-ct"><b>{r.copies}</b> {r.copies === 1 ? "copy" : "copies"} · {formatMuseumPct(MUSEUM_PER_COPY_BONUS)}/copy{#if r.bottleneck} · <span class="mu-warn">bottleneck</span>{/if}</span>
              </span>
            </div>
          {:else}
            <div class="mu-relic missing" style="--ring: {relicRarityColor(r.rarity)};">
              <span class="mu-ic"><Icon name="relic" size={20} /></span>
              <span class="mu-rt">
                <span class="mu-nm">{r.index} · undiscovered</span>
                <span class="mu-ct">{RELIC_RARITY_LABEL[r.rarity].toLowerCase()}</span>
              </span>
            </div>
          {/if}
        {/each}
      </div>

      <!-- RELIC BONUSES: the K-piece set tiers. -->
      <p class="mu-field">Relic Bonuses · set tiers</p>
      <div class="mu-tiers">
        {#each v.tiers as tv (tv.tier.pieces)}
          <div class="mu-tier" class:locked={tv.tier.locked}>
            <span class="mu-tk">{tv.tier.pieces}-piece<small>relics 1-{tv.tier.pieces}{tv.tier.capstone ? " · capstone" : ""}</small></span>
            <span class="mu-pips">
              {#each MUSEUM_COPY_LADDER as _rung, i}
                <i class="mu-pip" class:on={i < tv.tier.level}></i>
              {/each}
              <span class="mu-next" class:warn={tv.warn}>{tv.nextText}</span>
            </span>
            <span class="mu-bonus" class:zero={!tv.tier.locked && tv.tier.level === 0}>{tv.bonusText}</span>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .mu {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .mu-summary {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px 8px;
  }
  .mu-summary-n {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--color-text-primary);
  }
  .mu-summary-l {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .mu-summary-c {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .mu-ladder {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--color-text-dim);
  }
  .mu-ladder b {
    color: var(--color-text-secondary);
    font-weight: 600;
  }

  /* SET CARD */
  .mu-set {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .mu-set-h {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .mu-emblem {
    display: inline-flex;
    color: var(--rarity-radiant);
  }
  .mu-set-name {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--color-text-primary);
  }
  .mu-set-count {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .mu-set-sub {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .mu-set-src {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }

  /* ROSTER */
  .mu-roster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    margin: 8px 0 6px;
  }
  .mu-relic {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    background: var(--color-bg-mid);
    min-width: 0;
  }
  .mu-ic {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: var(--corner);
    color: var(--ring);
    background: rgba(var(--color-accent-rgb), 0.05);
    box-shadow: inset 0 0 0 1px var(--ring);
  }
  .mu-rt {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .mu-nm {
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    line-height: 1.25;
  }
  .mu-ct {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-variant-numeric: tabular-nums;
  }
  .mu-ct b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .mu-warn {
    color: var(--color-warning);
  }
  .mu-relic.bottleneck {
    border-color: rgba(var(--color-warning-rgb), 0.6);
    background: color-mix(in srgb, var(--color-warning) 7%, var(--color-bg-mid));
  }
  .mu-relic.missing {
    border-style: dashed;
    opacity: 0.55;
  }
  .mu-relic.missing .mu-ic {
    color: var(--color-text-dim);
    box-shadow: inset 0 0 0 1px rgba(var(--color-accent-rgb), 0.2);
  }

  /* TIER ROWS */
  .mu-field {
    margin: 6px 0 2px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .mu-tiers {
    display: grid;
    gap: 6px;
  }
  .mu-tier {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px 11px;
    padding: 8px 11px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    background: var(--color-bg-mid);
    font-size: var(--text-xs);
  }
  .mu-tk {
    font-family: var(--font-display);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .mu-tk small {
    display: block;
    font-family: var(--font-body);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .mu-pips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }
  .mu-pip {
    width: 16px;
    height: 7px;
    border-radius: 3px;
    background: rgba(var(--color-accent-rgb), 0.16);
  }
  .mu-pip.on {
    background: var(--color-accent);
  }
  .mu-next {
    margin-left: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .mu-next.warn {
    color: var(--color-warning);
  }
  .mu-bonus {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-success);
    text-align: right;
  }
  .mu-bonus.zero {
    color: var(--color-text-dim);
    font-weight: 400;
  }
  .mu-tier.locked {
    opacity: 0.6;
  }
  .mu-tier.locked .mu-bonus {
    color: var(--color-text-dim);
    font-weight: 400;
  }

  /* NARROW (phones): [name + bonus] on one line, pips + next below, the mockup's 560px layout. */
  @container (max-width: 560px) {
    .mu-tier {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .mu-tk {
      order: 1;
    }
    .mu-bonus {
      order: 2;
    }
    .mu-pips {
      order: 3;
      grid-column: 1 / -1;
    }
    .mu-next {
      margin-left: 4px;
    }
  }
</style>
