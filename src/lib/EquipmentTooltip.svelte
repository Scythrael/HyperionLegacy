<script context="module" lang="ts">
  // ============================================================================
  // EquipmentTooltip.svelte  (module script)
  // Author: Claude (Opus 4.8) | 2026-07-20 | generalized 2026-09-13 (0.13.5)
  //
  // 0.13.5 TOOLTIP REWORK: this was the finished-equipment card; it is now the ONE
  // generalized ITEM tooltip. It takes a discriminated `subject` (equipment | material
  // | ship | craft) and renders every item type on ONE skeleton:
  //     header (name + a rarity/type CHIP)  ->  a STATS block  ->  divider  ->  flavor.
  // The finished-equipment path is unchanged in substance (rarity border, signature
  // band, rolled primaries); only its flavor moved to the bottom under a divider, per
  // the approved mock. The filename is kept (the 4 finished-gear call sites still pass
  // `piece`, which back-compat-maps to {kind:"equipment"}); a rename to ItemTooltip is
  // logged as a trivial follow-up.
  //
  // equipmentRarityColor: the SINGLE source of truth for an equipment rarity's accent
  // color, exported so both this tooltip AND its host tiles read ONE mapping. Exhaustive
  // switch (no default) over EquipmentRarity, so a new rarity is a COMPILE error here.
  //
  // WHY fixed hex / stable tokens (not --color-accent): rarity color is a stable game-
  // convention ladder that must read the SAME regardless of the user's chosen UI accent.
  // --color-success / --color-warning are :root-only (safe stable tokens); the rest use
  // fixed hex, matching App.svelte's warehouseRarityColor posture.
  // ============================================================================
  import type { EquipmentRarity, EquipmentInstance, ItemRarity, ShipTypeKey } from "./game/model";
  import { EQUIPMENT_SLOTS, BLUEPRINTS, DEFAULT_EQUIPMENT_VARIETY, ITEMS, SHIP_TYPES } from "./game/model";
  import { previewCraftOutcome, type CraftPreview } from "./game/itemgen";
  // Weapon combat stats (damage / accuracy / etc.) do NOT live on the EquipmentInstance's rolled
  // lines — they come from the weapon's base def, scaled by the rolled weaponYield/accuracy. We
  // reuse the SAME pure fold combat uses (weaponInstanceFromGear) so the tooltip's numbers equal
  // what the ship actually fires, and read the base template for the pre-roll craft preview.
  import { WEAPON_DEFS } from "./game/combat/weapons";
  import { weaponInstanceFromGear } from "./game/combat/bridge";
  import type { CombatWeapon, WeaponFamily } from "./game/combat/types";

  // Family display names + the range-band + fire-rate readouts, so a weapon card reads its identity.
  const WEAPON_FAMILY_LABEL: Record<WeaponFamily, string> = {
    kinetic: "Kinetic",
    particle: "Particle",
    ew: "Electronic Warfare",
  };
  function weaponFamilyLabel(f: WeaponFamily): string {
    return WEAPON_FAMILY_LABEL[f] ?? f;
  }
  // range is a scalar on the 1D axis (weapons.ts RANGE_LONG/MEDIUM/SHORT anchors 300/200/100).
  function rangeBand(range: number): string {
    return range >= 250 ? "Long" : range >= 150 ? "Medium" : "Short";
  }
  // cooldownDeciSec is tenths of a second (10 = 1.0s); shots/sec = 10 / cooldownDeciSec.
  function fireRate(cooldownDeciSec: number): string {
    return `${(10 / cooldownDeciSec).toFixed(2)}/s`;
  }
  // The combat-stat rows for a weapon, given its effective CombatWeapon (folded instance for a
  // finished piece, or the base template for a pre-roll preview). Damage is the per-shot range.
  function weaponCombatRows(w: CombatWeapon): { label: string; value: string }[] {
    const rows: { label: string; value: string }[] = [
      { label: "Damage", value: w.yieldMin === w.yieldMax ? `${w.yieldMin}` : `${w.yieldMin}–${w.yieldMax}` },
    ];
    if (w.projectileCount > 1) rows.push({ label: "Projectiles", value: `×${w.projectileCount}` });
    rows.push({ label: "Accuracy", value: `${w.accuracy}%` });
    rows.push({ label: "Fire rate", value: fireRate(w.cooldownDeciSec) });
    rows.push({ label: "Weapons Range", value: rangeBand(w.range) });
    rows.push({ label: "Family", value: weaponFamilyLabel(w.family) });
    return rows;
  }

  // Rarity -> CSS token. Returns var(--rarity-*) (defined in app.css :root) rather than raw hex, so a
  // color-blind or future skin palette can remap the whole ladder from ONE place. The DEFAULT values
  // behind these tokens are unchanged — this is where the single source of truth now lives (app.css),
  // and every usage feeds the result straight into an inline style, so a var() reference resolves.
  export function equipmentRarityColor(rarity: EquipmentRarity): string {
    switch (rarity) {
      case "derelict":
        return "var(--rarity-derelict)"; // slate: below-standard junk tier
      case "standard":
        return "var(--rarity-standard)"; // silver: the baseline / crafted floor
      case "augmented":
        return "var(--rarity-augmented)"; // green (tracks --color-success)
      case "stellar":
        return "var(--rarity-stellar)"; // blue (matches the item-rarity "rare" hue)
      case "radiant":
        return "var(--rarity-radiant)"; // violet (epic-tier hue)
      case "luminous":
        return "var(--rarity-luminous)"; // amber (tracks --color-warning): legendary-class
      case "constellar":
        return "var(--rarity-constellar)"; // rose: the PARALLEL legendary flavor (shares the tier, distinct color)
    }
  }

  // Item-rarity (materials) accent, the PARALLEL ladder to equipmentRarityColor for the
  // ItemDef.rarity vocabulary (common..legendary). Kept here so the material chip reads a
  // rarity cue from ONE mapping; exhaustive over ItemRarity (new tier -> compile error).
  export function itemRarityColor(rarity: ItemRarity): string {
    switch (rarity) {
      case "common":
        return "var(--rarity-standard)"; // silver
      case "uncommon":
        return "var(--rarity-augmented)"; // green
      case "rare":
        return "var(--rarity-stellar)"; // blue
      case "epic":
        return "var(--rarity-radiant)"; // purple (matches radiant)
      case "legendary":
        return "var(--rarity-luminous)"; // amber
    }
  }

  // ============================================================================
  // equipmentIcon: the SINGLE source of truth for a system's display glyph, keyed by
  // its VARIETY, so both the Ship Systems tiles and this tooltip render ONE mapping.
  // WHY emoji placeholders: final art is a later polish pass; chosen to differentiate
  // at a glance across the live slots and within each slot.
  // ============================================================================
  const EQUIPMENT_VARIETY_ICON: Record<string, string> = {
    // Cargo Bay holds:
    prospectorHold: "⛏️",
    balancedHold: "📦",
    haulerHold: "🏗️",
    // FTL Drives:
    sprintDrive: "🚀",
    economyDrive: "⛽",
    balancedDrive: "🧭",
    // Reactor Cores:
    highOutputCore: "⚛️",
    efficientCore: "🔋",
    balancedCore: "⚖️",
    // Spec Utility rigs:
    yieldRig: "💎",
    surveyRig: "📡",
    refineryFeedRig: "🧪",
  };

  // Fallback glyph per SLOT, used if a variety is unmapped OR a slot has no variety
  // (weapons/drone pods roll no EQUIPMENT_SLOTS variety), so a card never renders blank.
  const SLOT_ICON_FALLBACK: Record<string, string> = {
    cargoBay: "📦",
    ftlDrive: "🚀",
    reactorCore: "⚛️",
    specUtility: "🛠️",
    hullPlating: "🛡️",
    shieldEmitters: "🔰",
    weapon: "🔫",
    droneBay: "🛸",
  };

  // Resolve a piece's VARIETY key: a crafted piece from its blueprint's equipmentOutput,
  // a Standard-Issue baseline from the slot's blessed default variety.
  function resolveVarietyKey(piece: EquipmentInstance): string | null {
    if (piece.blueprintKey === null) return DEFAULT_EQUIPMENT_VARIETY[piece.slotType] ?? null;
    return BLUEPRINTS[piece.blueprintKey]?.equipmentOutput?.varietyKey ?? null;
  }

  // Glyph from a (variety, slot) pair, shared by equipmentIcon(piece) and the craft path.
  function iconFor(varietyKey: string | null, slotType: string): string {
    if (varietyKey !== null && EQUIPMENT_VARIETY_ICON[varietyKey] !== undefined) return EQUIPMENT_VARIETY_ICON[varietyKey];
    return SLOT_ICON_FALLBACK[slotType] ?? "🛰️";
  }

  export function equipmentIcon(piece: EquipmentInstance): string {
    return iconFor(resolveVarietyKey(piece), piece.slotType);
  }

  // Crafted Blanks 0.13.7: the glyph for an UNROLLED blank, keyed off its BLUEPRINT (a blank
  // has no rolled instance yet). Resolves the same (variety, slot) pair the minted piece would
  // carry, so a blank tile and its inspected system share one icon. Weapon / drone blueprints
  // roll no variety, so they fall back to the "weapon" / "droneBay" slot glyph via iconFor.
  export function blueprintIcon(blueprintKey: string): string {
    const bp = BLUEPRINTS[blueprintKey];
    if (bp === undefined) return "🛰️";
    if (bp.equipmentOutput) return iconFor(bp.equipmentOutput.varietyKey, bp.equipmentOutput.slotType);
    if (bp.weaponOutput) return iconFor(null, "weapon");
    if (bp.droneOutput) return iconFor(null, "droneBay");
    return "🛰️";
  }

  // The generalized subject: exactly one item, tagged by kind. `equipment` carries a rolled
  // instance; `material` an ITEMS key; `ship` a SHIP_TYPES key; `craft` a blueprint being
  // fabricated plus the crafter's level inputs (mirrors the mint, see previewCraftOutcome).
  export type ItemTooltipSubject =
    | { kind: "equipment"; piece: EquipmentInstance }
    | { kind: "material"; itemId: string }
    | { kind: "ship"; typeKey: ShipTypeKey }
    | { kind: "craft"; blueprintKey: string; craftingLevel: number; faTalentBonus?: number };

  // Human labels for the stat vocabulary (equipment + ship + craft-signature keys). An
  // unmapped key prettifies its camelCase, so a reserved/forward stat still reads.
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
    hullStrength: "Hull Plating",
    hullIntegrity: "Hull Integrity",
    shieldCapacity: "Shield Capacity",
    shieldRecharge: "Shield Recharge",
    weaponHardpoints: "Weapon Hardpoints",
    weaponYield: "Weapon Yield",
    weaponAccuracy: "Weapon Accuracy",
    droneHp: "Drone HP",
    droneAccuracy: "Drone Accuracy",
    moduleSlots: "Module Slots",
    equipmentSlots: "Equipment Slots",
  };
  export function statLabel(key: string): string {
    if (STAT_LABEL[key]) return STAT_LABEL[key];
    const spaced = key.replace(/([A-Z])/g, " $1");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  // Player-facing category label for a material's ItemDef.category.
  const ITEM_CATEGORY_LABEL: Record<string, string> = {
    raw: "Raw Material",
    refined: "Refined Material",
    minorComponent: "Minor Component",
    majorComponent: "Major Component",
    shipModule: "Ship Module",
    shipSystem: "Ship System",
    salvagedMaterial: "Salvaged Material",
  };
  const SUBCATEGORY_LABEL: Record<string, string> = {
    oresMetals: "Ores & Metals",
    volatiles: "Volatiles",
    organicCompounds: "Organic Compounds",
    recoveredTech: "Recovered Tech",
  };

  // Preview of a craft (the roll ranges + rarity/quality/affix options). Re-exported through
  // a thin wrapper so the instance script computes it in one place.
  function craftPreviewFor(blueprintKey: string, craftingLevel: number, faTalentBonus: number): CraftPreview | null {
    const bp = BLUEPRINTS[blueprintKey];
    if (bp === undefined) return null;
    return previewCraftOutcome(bp, { craftingLevel, faTalentBonus });
  }
</script>

<script lang="ts">
  // ============================================================================
  // EquipmentTooltip.svelte  (instance script) — the generalized item card.
  //
  // Given a `subject` (or the legacy `piece` shorthand) it derives a normalized VIEW
  // (accent, icon, name, chip, sub-line, stat rows, flavor) and renders the shared
  // skeleton. It NEVER mutates state and holds no game logic; it only reads the static
  // tables (EQUIPMENT_SLOTS / BLUEPRINTS / ITEMS / SHIP_TYPES) + the pure craft preview.
  //
  // ACTION BAR: the footer is a default <slot>, so a host injects context buttons (the
  // Ship Systems bay passes Salvage). Only rendered when the host passes children AND the
  // subject is an equipment instance (materials/ships/crafts carry no per-item actions).
  // ============================================================================

  // NEW primary API: the tagged subject. LEGACY: `piece` alone still works and maps to an
  // equipment subject, so the finished-gear call sites need no change.
  export let subject: ItemTooltipSubject | undefined = undefined;
  export let piece: EquipmentInstance | undefined = undefined;

  $: resolved = subject ?? (piece !== undefined ? ({ kind: "equipment", piece } as const) : null);

  function fmtStat(v: number): string {
    const body = Number.isInteger(v) ? v.toString() : v.toFixed(1);
    return `+${body}`;
  }
  // A range "+min … +max" (or a single "+n" when the ends coincide).
  function fmtRange(min: number, max: number): string {
    return min === max ? fmtStat(min) : `${fmtStat(min)} … ${fmtStat(max)}`;
  }
  // Plain (non-"+") number for ship base stats, one decimal only when needed.
  function fmtNum(v: number): string {
    return Number.isInteger(v) ? v.toString() : v.toFixed(1);
  }

  // ---- EQUIPMENT view (a rolled instance) -----------------------------------
  function equipmentName(p: EquipmentInstance): string {
    if (p.blueprintKey === null) return "Standard-Issue";
    const bp = BLUEPRINTS[p.blueprintKey];
    const eqOut = bp?.equipmentOutput;
    if (eqOut) {
      const variety = EQUIPMENT_SLOTS[eqOut.slotType]?.varieties.find((v) => v.key === eqOut.varietyKey);
      return variety?.label ?? eqOut.varietyKey;
    }
    if (bp?.label) return bp.label.replace(/\s+Blueprint$/, "");
    return EQUIPMENT_SLOTS[p.slotType]?.label ?? p.slotType;
  }
  function equipmentFlavor(p: EquipmentInstance): string | null {
    if (p.blueprintKey !== null) return BLUEPRINTS[p.blueprintKey]?.flavor ?? null;
    const defaultVariety = DEFAULT_EQUIPMENT_VARIETY[p.slotType];
    if (defaultVariety === undefined) return null;
    const bp = Object.values(BLUEPRINTS).find(
      (b) => b.equipmentOutput?.slotType === p.slotType && b.equipmentOutput?.varietyKey === defaultVariety,
    );
    return bp?.flavor ?? null;
  }

  // ---- CRAFT view (a blueprint being fabricated) ----------------------------
  // Name + flavor come from the blueprint exactly like a finished piece; the stat ranges +
  // roll options come from the pure preview. slot label = the friendly module/slot name.
  function blueprintName(blueprintKey: string): string {
    const bp = BLUEPRINTS[blueprintKey];
    if (bp === undefined) return blueprintKey;
    const eqOut = bp.equipmentOutput;
    if (eqOut) {
      const variety = EQUIPMENT_SLOTS[eqOut.slotType]?.varieties.find((v) => v.key === eqOut.varietyKey);
      return variety?.label ?? eqOut.varietyKey;
    }
    return bp.label.replace(/\s+Blueprint$/, "");
  }
  function slotLabelFor(slotType: string): string {
    if (EQUIPMENT_SLOTS[slotType] !== undefined) return EQUIPMENT_SLOTS[slotType].label;
    if (slotType === "weapon") return "Weapon";
    if (slotType === "droneBay") return "Drone Pod";
    return slotType;
  }

  // The normalized VIEW the markup renders. Discriminated by kind; every kind fills the same
  // slots (accent / icon / name / chip / sub / flavor) plus a kind-specific stats payload.
  type View =
    | {
        kind: "equipment";
        accent: string;
        icon: string;
        name: string;
        chip: string;
        chipColor: string;
        iLevel: number;
        slotLabel: string;
        weaponCombat: { label: string; value: string }[] | null;
        implicit: [string, number][];
        primaries: [string, number][];
        flavor: string | null;
        piece: EquipmentInstance;
      }
    | {
        kind: "material";
        accent: string;
        icon: string;
        name: string;
        chip: string;
        chipColor: string;
        sub: string | null;
        detail: string | null;
        flavor: string | null;
      }
    | {
        kind: "ship";
        accent: string;
        icon: string;
        name: string;
        chip: string;
        chipColor: string;
        sub: string | null;
        stats: { label: string; value: string }[];
        flavor: string | null;
      }
    | {
        kind: "craft";
        accent: string;
        icon: string;
        name: string;
        chip: string;
        chipColor: string;
        slotLabel: string;
        preview: CraftPreview | null;
        // For a WEAPON craft: the base def's fixed combat stats (family / projectiles / fire rate /
        // range / base damage), which are known pre-roll. The rolled weaponYield (shown as the
        // signature range) adds to the base damage; base damage is shown so the range reads in context.
        weaponBase: { label: string; value: string }[] | null;
        flavor: string | null;
      }
    | null;

  const NEUTRAL = "var(--color-text-secondary)";
  const DIM = "var(--color-text-dim)";
  const ACCENT = "var(--color-accent)";

  $: view = ((): View => {
    if (resolved === null) return null;
    if (resolved.kind === "equipment") {
      const p = resolved.piece;
      const accent = equipmentRarityColor(p.rarity);
      const grade = p.rarity.charAt(0).toUpperCase() + p.rarity.slice(1);
      return {
        kind: "equipment",
        accent,
        icon: equipmentIcon(p),
        name: equipmentName(p),
        chip: `${grade} · Q${p.quality}`,
        chipColor: accent,
        iLevel: p.iLevel,
        slotLabel: slotLabelFor(p.slotType),
        // A weapon's DAMAGE and other combat stats live on its base def, folded with the rolled
        // yield/accuracy by the SAME function combat uses, so the card shows what the ship fires.
        weaponCombat:
          p.slotType === "weapon" && p.weaponType !== undefined
            ? weaponCombatRows(weaponInstanceFromGear(p, p.id))
            : null,
        implicit: Object.entries(p.implicitStats),
        primaries: Object.entries(p.rolledStats),
        flavor: equipmentFlavor(p),
        piece: p,
      };
    }
    if (resolved.kind === "material") {
      const def = ITEMS[resolved.itemId];
      if (def === undefined) return null;
      const catLabel = ITEM_CATEGORY_LABEL[def.category] ?? def.category;
      const subLabel = def.subCategory ? SUBCATEGORY_LABEL[def.subCategory] ?? def.subCategory : null;
      return {
        kind: "material",
        accent: itemRarityColor(def.rarity),
        icon: "",
        name: def.label,
        chip: catLabel,
        chipColor: itemRarityColor(def.rarity),
        sub: subLabel,
        detail: def.unlockHint ?? null,
        flavor: def.flavor ?? null,
      };
    }
    if (resolved.kind === "ship") {
      const def = SHIP_TYPES[resolved.typeKey];
      if (def === undefined) return null;
      const stats: { label: string; value: string }[] = [
        { label: "Cargo Capacity", value: fmtNum(def.cargoCapacity) },
        { label: "Fuel Capacity", value: fmtNum(def.fuelCapacity) },
        { label: "Hull Integrity", value: fmtNum(def.hullIntegrity) },
        { label: "Shield Capacity", value: fmtNum(def.shieldCapacity) },
        { label: "Weapon Hardpoints", value: fmtNum(def.weaponHardpoints) },
      ];
      return {
        kind: "ship",
        accent: NEUTRAL,
        icon: "🛰️",
        name: def.label,
        chip: "Hull",
        chipColor: NEUTRAL,
        sub: `Tier ${def.tier} · ${def.spec}`,
        stats,
        flavor: def.description ?? null,
      };
    }
    // craft
    const bp = BLUEPRINTS[resolved.blueprintKey];
    const preview = craftPreviewFor(resolved.blueprintKey, resolved.craftingLevel, resolved.faTalentBonus ?? 0);
    // A weapon craft's fixed combat stats come straight from the base def (no roll needed for
    // family / projectiles / fire rate / range / base damage). The rolled weaponYield adds to the
    // base damage and is shown separately as the signature range.
    const weaponType = bp?.weaponOutput?.weaponType;
    const weaponBase =
      weaponType !== undefined && WEAPON_DEFS[weaponType] !== undefined
        ? weaponCombatRows(WEAPON_DEFS[weaponType])
        : null;
    return {
      kind: "craft",
      accent: ACCENT,
      icon: iconFor(preview?.varietyKey ?? null, preview?.slotType ?? ""),
      name: blueprintName(resolved.blueprintKey),
      chip: "In progress",
      chipColor: DIM,
      slotLabel: preview ? slotLabelFor(preview.slotType) : "",
      preview,
      weaponBase,
      flavor: bp?.flavor ?? null,
    };
  })();
</script>

{#if view !== null}
  <!-- ONE skeleton: header (icon + name + chip) -> STATS block -> divider -> flavor.
       --et-accent drives the border + name tint from one variable. Opaque bg (no blur)
       so it reads solid on Brave. -->
  <div class="et" style="--et-accent: {view.accent};">
    <div class="et-hd">
      <div class="et-r1">
        {#if view.icon}<span class="et-icon">{view.icon}</span>{/if}
        <span class="et-name-text">{view.name}</span>
        <span class="et-q" style="color: {view.chipColor}; border-color: {view.chipColor};">{view.chip}</span>
      </div>
      {#if view.kind === "equipment"}
        <div class="et-r2">
          <span>iLevel {view.iLevel}</span>
          <span class="et-sep">·</span>
          <span>{view.slotLabel}</span>
        </div>
      {:else if view.kind === "craft"}
        <div class="et-r2">
          {#if view.preview}
            <span>iLevel {view.preview.iLevel}</span>
            <span class="et-sep">·</span>
          {/if}
          <span>{view.slotLabel}</span>
        </div>
      {:else if view.sub}
        <div class="et-r2"><span>{view.sub}</span></div>
      {/if}
    </div>

    <!-- STATS block (above the divider) — varies by kind. -->
    {#if view.kind === "equipment"}
      <!-- WEAPON COMBAT stats (damage range / accuracy / fire rate / range / family). These come
           from the weapon's base def folded with the rolled yield/accuracy, NOT the raw rolled
           lines below, so a weapon card shows what it actually fires. Shown first (the result), with
           the rolled signature/affix lines below as the "what rolled" detail. -->
      {#if view.weaponCombat}
        <div class="et-sec">
          <div class="et-lblrow">Combat</div>
          {#each view.weaponCombat as row (row.label)}
            <div class="et-statrow"><span class="et-k">{row.label}</span><span class="et-v">{row.value}</span></div>
          {/each}
        </div>
      {/if}
      <div class="et-imp">
        <div class="et-imp-stats">
          {#each view.implicit as [key, value] (key)}
            <div class="et-imp-line">{fmtStat(value)} {statLabel(key)}</div>
          {/each}
        </div>
        <span class="et-imp-cap">slot signature</span>
      </div>
      {#if view.primaries.length > 0}
        <div class="et-sec">
          <div class="et-lblrow">Primaries</div>
          {#each view.primaries as [key, value] (key)}
            <div class="et-prim">{fmtStat(value)} {statLabel(key)}</div>
          {/each}
        </div>
      {/if}
    {:else if view.kind === "ship"}
      <div class="et-stats">
        {#each view.stats as row (row.label)}
          <div class="et-statrow"><span class="et-k">{row.label}</span><span class="et-v">{row.value}</span></div>
        {/each}
      </div>
    {:else if view.kind === "material"}
      {#if view.detail}
        <div class="et-detail">{view.detail}</div>
      {/if}
    {:else if view.kind === "craft"}
      <!-- WEAPON base combat stats (fixed, known pre-roll): family / projectiles / fire rate /
           range / base damage. The rolled weaponYield (the signature range below) adds to the base
           damage, so both read together. Non-weapon crafts have no base block. -->
      {#if view.weaponBase}
        <div class="et-sec">
          <div class="et-lblrow">Base combat</div>
          {#each view.weaponBase as row (row.label)}
            <div class="et-statrow"><span class="et-k">{row.label}</span><span class="et-v">{row.value}</span></div>
          {/each}
        </div>
      {/if}
      {#if view.preview}
        {@const p = view.preview}
        <div class="et-stats">
          {#each p.implicit as line (line.stat)}
            <div class="et-statrow">
              <span class="et-k">{statLabel(line.stat)} <span class="et-sig">signature</span></span>
              <span class="et-v et-range">{fmtRange(line.min, line.max)}</span>
            </div>
          {/each}
        </div>
        <div class="et-rolls">
          <div class="et-rollrow">
            <span class="et-rk">Rarity</span>
            <span class="et-rv">
              {#each p.rarities as r (r)}
                <span class="et-rt" style="color: {equipmentRarityColor(r)};">{r.charAt(0).toUpperCase() + r.slice(1)}</span>
              {/each}
            </span>
          </div>
          <div class="et-rollrow">
            <span class="et-rk">Quality</span>
            <span class="et-rv et-mono">Q{p.qualityMin} – Q{p.qualityMax}</span>
          </div>
          <div class="et-rollrow">
            <span class="et-rk">Affixes</span>
            <span class="et-rv et-mono">{p.affixCountMin === p.affixCountMax ? p.affixCountMin : `${p.affixCountMin}–${p.affixCountMax}`} of:</span>
          </div>
          <div class="et-pool">
            {#each p.affixPool as stat (stat)}
              <span class="et-pchip">{statLabel(stat)}</span>
            {/each}
          </div>
        </div>
      {:else}
        <div class="et-detail">Rolls its stats when the craft completes.</div>
      {/if}
    {/if}

    <!-- FLAVOR: secondary, under a divider (the reworked order — flavor last). -->
    {#if view.flavor}
      <div class="et-flavor">{view.flavor}</div>
    {/if}

    <!-- ACTION FOOTER: host-provided, equipment only (per-item actions like Salvage). -->
    {#if view.kind === "equipment" && $$slots.default}
      <div class="et-foot">
        <slot />
      </div>
    {/if}
  </div>
{/if}

<style>
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
    padding: 11px 13px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  .et-r1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .et-icon {
    flex: 0 0 auto;
    font-size: calc(20px * var(--ui-scale));
    line-height: 1;
  }
  .et-name-text {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 700;
    font-size: var(--text-lg);
    color: var(--et-accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The chip: type/quality/rarity marker, colored per kind (inline style sets the color). */
  .et-q {
    flex: 0 0 auto;
    font-size: var(--text-xs);
    font-weight: 700;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    padding: 1px 7px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .et-r2 {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 5px;
    font-size: calc(11.5px * var(--ui-scale));
    color: var(--color-text-secondary);
  }
  .et-sep {
    opacity: 0.5;
  }

  /* IMPLICITS band (equipment) */
  .et-imp {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 9px 13px;
    font-size: var(--text-md);
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
    font-size: calc(11.5px * var(--ui-scale));
  }

  /* PRIMARIES (equipment) */
  .et-sec {
    padding: 9px 13px;
  }
  .et-lblrow {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin: 0 0 3px;
  }
  .et-prim {
    color: var(--color-success);
    font-size: var(--text-md);
    padding: 1px 0;
  }

  /* GENERIC STATS block (ship + craft signature) */
  .et-stats {
    padding: 9px 13px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .et-statrow {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    font-size: var(--text-md);
  }
  .et-k {
    color: var(--color-text-secondary);
  }
  .et-sig {
    color: var(--color-text-dim);
    font-size: var(--text-3xs);
    font-style: italic;
  }
  .et-v {
    font-family: var(--font-mono, var(--font-body));
    color: var(--color-text-primary);
  }
  .et-v.et-range {
    color: var(--color-accent);
  }

  /* ROLL-PREVIEW block (craft): possible rarities / quality / affix pool. */
  .et-rolls {
    padding: 8px 13px 9px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px dashed rgba(var(--color-accent-rgb), 0.16);
  }
  .et-rollrow {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: var(--text-sm);
  }
  .et-rk {
    flex: 0 0 54px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--text-3xs);
  }
  .et-rv {
    color: var(--color-text-secondary);
  }
  .et-rv.et-mono {
    font-family: var(--font-mono, var(--font-body));
  }
  .et-rt {
    font-size: var(--text-3xs);
    margin-right: 4px;
  }
  .et-pool {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: 64px;
  }
  .et-pchip {
    font-size: var(--text-3xs);
    color: var(--color-text-secondary);
    padding: 0 5px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.05);
  }

  /* MATERIAL detail line (the functional "how to get" clue). */
  .et-detail {
    padding: 9px 13px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* FLAVOR: secondary, under a divider (border-top), at the bottom. */
  .et-flavor {
    padding: 9px 13px;
    font-style: italic;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border-top: 1px solid var(--color-border);
    background: rgba(var(--color-accent-rgb), 0.02);
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
