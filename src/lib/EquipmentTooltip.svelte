<script context="module" lang="ts">
  // ============================================================================
  // EquipmentTooltip.svelte  (module script)
  // Author: Claude (Opus 4.8) | 2026-07-20
  //
  // equipmentRarityColor: the SINGLE source of truth for an equipment rarity's
  // accent color, exported from the module context so BOTH this tooltip AND its
  // host tiles (App.svelte's Ship Systems bay) read ONE mapping instead of two
  // that could drift. Exhaustive switch (no default) over EquipmentRarity, so a
  // new rarity is a COMPILE error here, not a silent gray tile.
  //
  // WHY fixed hex / stable tokens (not --color-accent): the accent color is a
  // user-picked theme token that changes per [data-theme]; rarity color is a
  // stable game-convention ladder (silver -> green -> blue -> purple -> legendary)
  // that must read the SAME regardless of the chosen UI accent. --color-success /
  // --color-warning are :root-only (never re-declared in a [data-theme] block, see
  // app.css), so they are safe stable tokens; the remaining rungs use fixed hex,
  // matching App.svelte's existing warehouseRarityColor posture.
  // ============================================================================
  import type { EquipmentRarity } from "./game/model";

  export function equipmentRarityColor(rarity: EquipmentRarity): string {
    switch (rarity) {
      case "derelict":
        return "#6b7280"; // slate: below-standard junk tier
      case "standard":
        return "#a9b7c8"; // silver: the baseline / crafted floor
      case "augmented":
        return "var(--color-success)"; // green (stable :root token)
      case "stellar":
        return "#4fa3f2"; // blue (matches the item-rarity "rare" hue)
      case "radiant":
        return "#b07cf2"; // purple (matches the item-rarity "epic" hue)
      case "luminous":
        return "var(--color-warning)"; // amber (stable :root token): legendary-class
      case "constellar":
        return "#f472b6"; // rose: the PARALLEL legendary flavor (shares the tier, distinct color)
    }
  }
</script>

<script lang="ts">
  // ============================================================================
  // EquipmentTooltip.svelte  (instance script)
  //
  // A REUSABLE presentation card for one EquipmentInstance, with a rarity-colored
  // border (the centerpiece of the 0.11.0 Phase D UI). Given a piece it derives
  // EVERYTHING it needs (name, rarity color/label, slot label, stat rows) so any
  // host can drop it in with just <EquipmentTooltip {piece} />. It NEVER mutates
  // state and holds NO game logic; it only reads static tables (EQUIPMENT_SLOTS /
  // BLUEPRINTS) to resolve display labels.
  //
  // ACTION BAR: the footer is a DEFAULT <slot>, so the host injects whatever
  // buttons fit its context, the Ship Systems bay (App.svelte) passes a Salvage
  // button; the 0.12.0 slot-readout (Task D2) will pass Swap / Uninstall. The
  // tooltip stays agnostic about actions, which is what keeps it reusable.
  //
  // FORWARD LAYOUT (0.12.0): the structural comment below the Primaries section
  // marks where a SECONDARIES band (descriptive effect-text) and weapon DMG/DPS
  // rows slot in, so combat gear reuses this exact card without a rewrite. No
  // weapon/secondary content is invented now (current systems carry none).
  // ============================================================================
  import type { EquipmentInstance } from "./game/model";
  import { EQUIPMENT_SLOTS, BLUEPRINTS } from "./game/model";

  // The piece to render. Required, the whole component is a function of it.
  export let piece: EquipmentInstance;

  // Full-name stat labels for the live 0.11.0 stat vocabulary. Parallels
  // ShipSystemsPanel.svelte's compact STAT_LABEL (that one abbreviates for tight
  // slot chips; this one spells the stat out for the roomy tooltip). Kept a small
  // local map per the task's "reuse the helper if one exists, else a small local
  // map", the existing one is neither exported nor full-name, so a local map is
  // the lower-risk choice over editing the working panel. An unknown key falls
  // back to a prettified camelCase split (below), so a reserved 0.12.0 stat still
  // renders a readable label the day it goes live.
  const STAT_LABEL: Record<string, string> = {
    cargoCapacity: "Cargo Capacity",
    transitSpeedMult: "FTL Speed",
    engineEfficiency: "Fuel Efficiency",
    fuelCapacity: "Fuel Capacity",
    extractionYieldMult: "Extraction Yield",
    powerOutput: "Power Output",
    powerDrawReduction: "Power Draw Reduction",
    massReduction: "Mass Reduction",
    sensors: "Sensors",
    materialQualityChance: "Material Quality",
  };

  // Prettify an unmapped stat key ("shieldRecharge" -> "Shield Recharge") so a
  // forward/reserved stat is still human-readable without a map entry.
  function labelFor(key: string): string {
    if (STAT_LABEL[key]) return STAT_LABEL[key];
    const spaced = key.replace(/([A-Z])/g, " $1");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  // Raw stat magnitudes are stored as "plus" values (see model.ts equipmentStatMods).
  // Render them as "+N" (integers bare, otherwise one decimal), mirroring
  // ShipSystemsPanel's pieceDesc formatting so the two surfaces read consistently.
  function fmtStat(v: number): string {
    const body = Number.isInteger(v) ? v.toString() : v.toFixed(1);
    return `+${body}`;
  }

  // The piece's display NAME = its variety label, resolved from the blueprint that
  // crafted it (BLUEPRINTS[key].equipmentOutput.varietyKey -> the slot's variety
  // def label), the SAME derivation App.svelte's equipmentOutputLabel uses. A
  // Standard-Issue baseline has no blueprint (blueprintKey null), so it is named
  // literally "Standard-Issue"; a crafted piece whose blueprint/variety can't be
  // resolved falls back to the slot label (never blank).
  $: name = (() => {
    if (piece.blueprintKey === null) return "Standard-Issue";
    const eqOut = BLUEPRINTS[piece.blueprintKey]?.equipmentOutput;
    if (!eqOut) return EQUIPMENT_SLOTS[piece.slotType]?.label ?? piece.slotType;
    const variety = EQUIPMENT_SLOTS[eqOut.slotType]?.varieties.find((v) => v.key === eqOut.varietyKey);
    return variety?.label ?? eqOut.varietyKey;
  })();

  // "{Rarity} Grade" over "{Slot} System" (the top-right identity block). Rarity
  // is title-cased from the raw ladder token; the slot label comes from the slot
  // table (single source), suffixed " System" per the approved mockup.
  $: rarityLabel = piece.rarity.charAt(0).toUpperCase() + piece.rarity.slice(1);
  $: slotLabel = EQUIPMENT_SLOTS[piece.slotType]?.label ?? piece.slotType;

  // The accent color for the border + name tint (module-exported single source).
  $: accent = equipmentRarityColor(piece.rarity);

  // Stat rows, split into the implicit (slot-signature) band and the rolled
  // primaries. Object insertion order is stable, so the rows render in the order
  // the engine stored them.
  $: implicitEntries = Object.entries(piece.implicitStats);
  $: primaryEntries = Object.entries(piece.rolledStats);
</script>

<!-- The card. --et-accent drives the border + name color from ONE variable so the
     whole card recolors with the rarity in one place. Opaque background (never a
     blur) so it reads solid on Brave, which lacks backdrop-filter. -->
<div class="et" style="--et-accent: {accent};">
  <!-- HEADER: name + quality badge (left); rarity grade + slot system (right). -->
  <div class="et-hd">
    <div class="et-nm">
      <span class="et-name-text">{name}</span>
      <span class="et-q">Q{piece.quality}</span>
    </div>
    <div class="et-type">
      {rarityLabel} Grade<b>{slotLabel} System</b>
    </div>
  </div>

  <!-- IMPLICITS: the slot-signature line(s), tinted band. One row per implicit
       stat (FTL Drive carries two), with a single "slot signature" caption. -->
  <div class="et-imp">
    <div class="et-imp-stats">
      {#each implicitEntries as [key, value] (key)}
        <div class="et-imp-line">{fmtStat(value)} {labelFor(key)}</div>
      {/each}
    </div>
    <span class="et-imp-cap">slot signature</span>
  </div>

  <!-- PRIMARIES: the rolled affixes, in the positive/accent color. Omitted
       entirely when a piece rolled none (e.g. a Standard-Issue baseline). -->
  {#if primaryEntries.length > 0}
    <div class="et-sec">
      <div class="et-lblrow">Primaries</div>
      {#each primaryEntries as [key, value] (key)}
        <div class="et-prim">{fmtStat(value)} {labelFor(key)}</div>
      {/each}
    </div>
  {/if}

  <!-- ============================================================================
       0.12.0 FORWARD SLOT (structural reservation, intentionally empty now):
       A SECONDARIES band (descriptive effect-text lines) and weapon DMG / DPS
       rows will slot in HERE, between the Primaries and the action footer, so
       combat gear reuses this same card. Current systems carry no secondary or
       weapon content, so nothing is rendered yet, do NOT invent it.
       ============================================================================ -->

  <!-- ACTION FOOTER: host-provided (Salvage in the bay; Swap/Uninstall in D2's
       slot readout). Rendered only when the host actually passes buttons. -->
  {#if $$slots.default}
    <div class="et-foot">
      <slot />
    </div>
  {/if}
</div>

<style>
  /* The rarity-bordered card. Opaque background (accent wash over the solid deep
     bg) so it stays legible on Brave (no backdrop-filter). The 2px border reads
     the rarity via --et-accent. */
  .et {
    border: 2px solid var(--et-accent);
    background: linear-gradient(rgba(var(--color-accent-rgb), 0.04), rgba(var(--color-accent-rgb), 0.04)), var(--color-bg-deep);
    overflow: hidden;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
    color: var(--color-text-primary);
    font-family: var(--font-body);
  }

  /* HEADER */
  .et-hd {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 11px 13px 9px;
    border-bottom: 1px solid var(--color-border);
  }
  .et-nm {
    font-weight: 700;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  /* Name tinted the rarity color (the mockup's centerpiece cue). */
  .et-name-text {
    color: var(--et-accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .et-q {
    flex: 0 0 auto;
    font-size: 11px;
    font-weight: 700;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid var(--color-border);
    border-radius: 5px;
    padding: 1px 6px;
    color: var(--color-text-secondary);
  }
  .et-type {
    text-align: right;
    font-size: 11.5px;
    color: var(--color-text-secondary);
    align-self: center;
    flex: 0 0 auto;
  }
  .et-type b {
    display: block;
    color: var(--color-text-primary);
    font-size: 12px;
    font-weight: 700;
  }

  /* IMPLICITS band: tinted with the accent so the signature reads distinct. */
  .et-imp {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 9px 13px;
    font-size: 13px;
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--et-accent) 8%, transparent);
  }
  .et-imp-stats {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .et-imp-cap {
    flex: 0 0 auto;
    color: var(--color-text-dim);
    font-size: 11.5px;
  }

  /* PRIMARIES */
  .et-sec {
    padding: 9px 13px;
  }
  .et-lblrow {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin: 0 0 3px;
  }
  .et-prim {
    color: var(--color-success);
    font-size: 13px;
    padding: 1px 0;
  }

  /* ACTION FOOTER */
  .et-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 9px 13px 11px;
    border-top: 1px solid var(--color-border);
  }
</style>
