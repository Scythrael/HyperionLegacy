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
  import { EQUIPMENT_SLOTS, BLUEPRINTS, DEFAULT_EQUIPMENT_VARIETY, ITEMS, SHIP_TYPES, equipmentSlotLabel, guestQuartersShown, isMemberSlotType } from "./game/model";
  // E-CREW 0.14.0 (Task 10): the one member-piece namer ("Standard-Issue Pulse Rifle"), shared with every
  // away-team gear surface so the tooltip and the rows can never name a piece two ways.
  import { memberPieceName } from "./awayGearDisplay";
  import { pieceHazardResistText } from "./ui/hazardResistText";
  // RR-8 (rarity readiness): a Luminous piece's legendary affix and a Constellar piece's set, one line each.
  import { pieceLegendaryAffixText, pieceSetText } from "./ui/rarityPieceText";
  // E-MOD EM-7: what a universal module does (its effect at this piece's scale, an Active's preset rule).
  import { MODULE_CARD_NOTE, moduleEffectSentence, moduleKindText, moduleRuleText, moduleWhenText, pieceModuleLines, type PieceModuleLines } from "./ui/moduleEffectText";
  import { universalModuleDef } from "./game/shipModules";
  import { pieceMaterialQualityText, shipMaterialQualityText } from "./ui/materialQualityText";
  // WR-7 follow-up (OC-D5): a favored-variety piece's "+10% on its ship type" line, and its lines as a favored hull reads them.
  import { favoredReadPiece, favoredReadPieces, favoredSpecText } from "./ui/favoredSpecText";
  import type { IconName } from "./ui/icons";
  import { previewCraftOutcome, type CraftPreview } from "./game/itemgen";
  // RR-4 (rarity readiness): the grade label with its ascension ("Nova Luminous"); the band label when there is none.
  import { ascensionLabel } from "./game/ascension";
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
    // Spec Utility rigs and suites: E-MOD EM-10 review moved all five to SVG (EQUIPMENT_VARIETY_SVG_ICON below).
    // Exploration 0.14.0 (E4d): the relic-unlocked sensor (same placeholder-emoji surface as above; the game-wide SVG
    // migration of this map is a separate pass).
    sensorBioResonance: "🧬",
  };

  // G1-1 (Short-Range Missions): the varieties that ship an SVG glyph (icons.ts, classified in ICON_SEMANTICS) in
  // place of an emoji. Every NEW variety glyph is SVG (the icon migration policy); iconFor returns "" for these so no
  // emoji draws, and the hosts (this card's header, the Armory and Ships storage tiles) render <Icon> from
  // varietySvgIcon / equipmentSvgIcon instead.
  const EQUIPMENT_VARIETY_SVG_ICON: Partial<Record<string, IconName>> = {
    quartersGuestWing: "guestWing",
    // E-MOD EM-7: the v1 universal modules (the signed-off modules mockup's glyphs).
    auxiliaryCapacitor: "moduleCapacitor",
    structuralBracing: "moduleBracing",
    arcDischarger: "moduleArc",
    prospectorsEcho: "moduleEcho",
    lastStandProtocol: "moduleLastStand",
    shieldSurge: "moduleSurge",
    longBaselineArray: "telescope",
    signalIntegrator: "moduleSignal",
    // E-MOD EM-10 review (SVG only, never emoji): every Spec Utility variety, drawn on the Modules row, its picker, the
    // card header, the Logistics bay and the Armory.
    yieldRig: "rigYield",
    surveyRig: "rigSurvey",
    refineryFeedRig: "rigRefineryFeed",
    damageControlSuite: "suiteDamageControl",
    pathfinderSuite: "suitePathfinder",
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
    // E4d: a piece whose variety is stamped on it (catalog slots + the relic-unlocked utility families)
    // names its own variety, so even a craft-less (dev-minted) one resolves its glyph. For every other
    // piece moduleVariant is absent and the original resolution below is unchanged.
    if (piece.moduleVariant !== undefined) return piece.moduleVariant;
    if (piece.blueprintKey === null) return DEFAULT_EQUIPMENT_VARIETY[piece.slotType] ?? null;
    return BLUEPRINTS[piece.blueprintKey]?.equipmentOutput?.varietyKey ?? null;
  }

  // Glyph from a (variety, slot) pair, shared by equipmentIcon(piece) and the craft path.
  // E-CREW 0.14.0 (Task 10): an away-team MEMBER piece has no emoji glyph on purpose (member gear ships with
  // SVG glyphs only, icons.ts armor / weaponHand / tool / implant, drawn by the host surfaces), so this
  // returns "" and the card's existing {#if view.icon} guard renders no icon rather than the satellite fallback.
  function iconFor(varietyKey: string | null, slotType: string): string {
    if (isMemberSlotType(slotType)) return "";
    if (varietyKey !== null && EQUIPMENT_VARIETY_SVG_ICON[varietyKey] !== undefined) return ""; // G1-1: drawn as SVG
    if (varietyKey !== null && EQUIPMENT_VARIETY_ICON[varietyKey] !== undefined) return EQUIPMENT_VARIETY_ICON[varietyKey];
    return SLOT_ICON_FALLBACK[slotType] ?? "🛰️";
  }

  export function equipmentIcon(piece: EquipmentInstance): string {
    return iconFor(resolveVarietyKey(piece), piece.slotType);
  }

  // G1-1: the SVG glyph a variety draws with (EQUIPMENT_VARIETY_SVG_ICON), or null for an emoji-glyph variety.
  export function varietySvgIcon(varietyKey: string | null): IconName | null {
    return varietyKey === null ? null : EQUIPMENT_VARIETY_SVG_ICON[varietyKey] ?? null;
  }
  export function equipmentSvgIcon(piece: EquipmentInstance): IconName | null {
    return varietySvgIcon(resolveVarietyKey(piece));
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
    // Exploration 0.14.0 (E4d): the relic-unlocked utility items' lines.
    repairSpeed: "Repair Speed",
    waveHullRegen: "Hull Regen Between Waves",
    expeditionScanSpeed: "Expedition Scan Speed",
    hazardResist: "Hazard Resist",
    // G1-1 (Short-Range Missions): the berths passengers ride in (user 2026-10-19: "Guest quarters").
    colonistCapacity: "Guest Quarters",
    hullStrength: "Hull Plating",
    hullIntegrity: "Hull Integrity",
    shieldCapacity: "Shield Capacity",
    shieldRecharge: "Shield Recharge",
    weaponHardpoints: "Weapon Hardpoints",
    weaponYield: "Weapon Yield",
    weaponAccuracy: "Weapon Accuracy",
    droneHp: "Drone HP",
    droneAccuracy: "Drone Accuracy",
    // WR-8 (0.14.0): the per-family resist lines and the drone pod counter lines.
    damageResist_kinetic: "Kinetic Damage Resist",
    damageResist_particle: "Particle Damage Resist",
    damageResist_ew: "EW Damage Resist",
    disruptionResist_kinetic: "Kinetic Disruption Resist",
    disruptionResist_particle: "Particle Disruption Resist",
    disruptionResist_ew: "EW Disruption Resist",
    droneInCombatReplenish: "In-Combat Replenish",
    droneSmartReflect: "Smart Reflect",
    moduleSlots: "Module Slots",
    // E-CREW 0.14.0: the away-team member gear GROUND lines (model.ts MEMBER_GROUND_STAT_KEYS).
    groundHp: "Health",
    groundPower: "Power",
    groundArmor: "Armor",
    groundAccuracy: "Accuracy",
    groundStatusChance: "Status Chance",
    groundStatusResist: "Status Resist",
    groundFieldwork: "Fieldwork",
    groundRelicFind: "Relic Find",
    groundHazardResist: "Hazard Resist",
    groundOrganicsYield: "Organics Yield",
    groundVaultYield: "Vault Yield",
    // Field Kits FKR-5: a grenade's extra charge per objective (FK11 "+1 carry capacity").
    groundCarryCapacity: "Carry Capacity",
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
    // Gas Giant Study GG-1.
    gasCanister: "Gas Storage Canister",
    researchData: "Research Data",
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
  import Icon from "./ui/Icon.svelte";

  // NEW primary API: the tagged subject. LEGACY: `piece` alone still works and maps to an
  // equipment subject, so the finished-gear call sites need no change.
  export let subject: ItemTooltipSubject | undefined = undefined;
  export let piece: EquipmentInstance | undefined = undefined;

  // COLLAPSIBLE (Crafted Blanks 0.13.7 bulk-inspect reveal): when true AND the subject is an
  // equipment instance, the header becomes a toggle that starts CLOSED (name + chip + chevron
  // only) and expands to the full card on click, so a batch reveal is a scannable stack of
  // accordions. Default false keeps every existing call site (single reveal, warehouse, install
  // flow) byte-identical: always open, no chevron, header is a plain div. Non-equipment kinds
  // ignore it entirely (they carry no such reveal).
  export let collapsible = false;
  let open = !collapsible;
  // Material Lines ML-3: the pieces installed on the same ship as `piece`, when the host knows them (Ship Systems),
  // so a piece whose Material Quality stacks with another's also shows the ship's combined chance. Absent elsewhere.
  export let shipPieces: EquipmentInstance[] | undefined = undefined;
  // WR-7 follow-up (OC-D5): the hull the host shows `piece` on, when it knows one (Ship Systems), so a favored-variety
  // piece says whether its "+10% on its ship type" applies there and its derived readouts read the favored lines.
  export let hostTypeKey: ShipTypeKey | undefined = undefined;

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
    // E-CREW (Task 10): a Standard-Issue MEMBER piece names its variety ("Standard-Issue Pulse Rifle"),
    // since one member slot holds many squads' floors; ship baselines keep the bare "Standard-Issue".
    if (p.blueprintKey === null) return isMemberSlotType(p.slotType) ? memberPieceName(p) : "Standard-Issue";
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
    // E-CREW (Task 10): a member slot has no default variety; a Standard-Issue member piece carries its own
    // stamped variety, so its flavor is that variety's blueprint flavor.
    const defaultVariety = isMemberSlotType(p.slotType) ? p.moduleVariant : DEFAULT_EQUIPMENT_VARIETY[p.slotType];
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
  // E4d: variety-aware (equipmentSlotLabel), so a relic-unlocked family in the shared Spec Utility slot
  // reads "Spec Utility" rather than the slot's original "Prospecting Rig"; every existing piece is unchanged.
  function slotLabelFor(slotType: string, varietyKey: string | null = null): string {
    if (EQUIPMENT_SLOTS[slotType] !== undefined) return equipmentSlotLabel(slotType, varietyKey);
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
        // GO-6: the piece's EFFECTIVE hazard resist on the curve toward the cap, or null (no hazard line).
        hazardResist: string | null;
        // Material Lines ML-3: what the piece's Material Quality points buy on a delivery, or null (no such line).
        materialQuality: string | null;
        // RR-8: "Legendary affix: <name>" on a Luminous piece, "Set: <name> (2 / 3 / 5 pieces)" on a set piece, else null.
        legendaryAffix: string | null;
        setLine: string | null;
        // E-MOD EM-7: a universal module's kind, effect and (an Active) rule, or null for any other piece. EM-10 adds
        // when it acts (its trigger in plain words) and its power draw.
        moduleLines: PieceModuleLines | null;
        // WR-7 follow-up (OC-D5): a favored-variety piece's favored-hull line, else null.
        favored: string | null;
        flavor: string | null;
        piece: EquipmentInstance;
        // WR-7 follow-up (OC-D5): the piece and the ship's pieces as the host hull reads them (favored lines there).
        readPiece: EquipmentInstance;
        readShipPieces: EquipmentInstance[] | undefined;
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
        // E-MOD EM-7: a module craft's effect at Standard quality 0 (the roll scales it), or null. EM-10: when it acts.
        moduleLines: { kind: string; effect: string; rule: string | null; when: string } | null;
        flavor: string | null;
      }
    | null;

  // G1-1: the header's SVG glyph for a variety that draws one (the Guest Wing), else null (the emoji `icon` draws).
  $: svgIcon = view === null ? null : view.kind === "equipment" ? equipmentSvgIcon(view.piece) : view.kind === "craft" ? varietySvgIcon(view.preview?.varietyKey ?? null) : null;

  const NEUTRAL = "var(--color-text-secondary)";
  const DIM = "var(--color-text-dim)";
  const ACCENT = "var(--color-accent)";

  $: view = ((): View => {
    if (resolved === null) return null;
    if (resolved.kind === "equipment") {
      const p = resolved.piece;
      const accent = equipmentRarityColor(p.rarity);
      const grade = ascensionLabel(p.rarity, p.ascension);
      // WR-7 follow-up (OC-D5): the readouts derived from the lines read them as the host hull folds them.
      const readPiece = favoredReadPiece(p, hostTypeKey);
      return {
        kind: "equipment",
        accent,
        icon: equipmentIcon(p),
        name: equipmentName(p),
        chip: `${grade} · Q${p.quality}`,
        chipColor: accent,
        iLevel: p.iLevel,
        slotLabel: slotLabelFor(p.slotType, resolveVarietyKey(p)),
        // A weapon's DAMAGE and other combat stats live on its base def, folded with the rolled
        // yield/accuracy by the SAME function combat uses, so the card shows what the ship fires.
        weaponCombat:
          p.slotType === "weapon" && p.weaponType !== undefined
            ? weaponCombatRows(weaponInstanceFromGear(p, p.id))
            : null,
        implicit: Object.entries(p.implicitStats),
        primaries: Object.entries(p.rolledStats),
        hazardResist: pieceHazardResistText(readPiece),
        materialQuality: pieceMaterialQualityText(readPiece),
        legendaryAffix: pieceLegendaryAffixText(p),
        setLine: pieceSetText(p),
        moduleLines: pieceModuleLines(p, shipPieces),
        favored: favoredSpecText(p, hostTypeKey),
        flavor: equipmentFlavor(p),
        piece: p,
        readPiece,
        readShipPieces: favoredReadPieces(shipPieces, hostTypeKey),
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
        // G1-1: a transport hull's base guest quarters, only when it has some, once Short-Range Missions are in
        // (model.ts GUEST_QUARTERS_DISPLAY_LIVE, user 2026-10-19).
        ...(guestQuartersShown(def.colonistCapacity ?? 0) ? [{ label: "Guest Quarters", value: fmtNum(def.colonistCapacity ?? 0) }] : []),
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
    const craftModule = bp?.equipmentOutput?.slotType === "module" ? universalModuleDef(bp.equipmentOutput.varietyKey) : undefined;
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
      slotLabel: preview ? slotLabelFor(preview.slotType, preview.varietyKey) : "",
      preview,
      weaponBase,
      moduleLines: craftModule ? { kind: moduleKindText(craftModule), effect: `${moduleEffectSentence(craftModule, 1)} (Standard; better rarity and quality do more.)`, rule: moduleRuleText(craftModule), when: moduleWhenText(craftModule) } : null,
      flavor: bp?.flavor ?? null,
    };
  })();

  // The header only becomes an interactive accordion for an equipment card asked to be
  // collapsible; every other kind (and every non-collapsible call) keeps the plain, always-open
  // header. `collapsed` gates the body + sub-line so the closed state shows just the r1 header.
  $: interactive = collapsible && view !== null && view.kind === "equipment";
  $: collapsed = interactive && !open;
</script>

{#if view !== null}
  <!-- ONE skeleton: header (icon + name + chip) -> STATS block -> divider -> flavor.
       --et-accent drives the border + name tint from one variable. Opaque bg (no blur)
       so it reads solid on Brave. -->
  <div class="et" class:open={collapsible && open} style="--et-accent: {view.accent};">
    <!-- HEADER. Plain <div> for every non-collapsible card (byte-identical to before); a real
         <button> toggle for a collapsible equipment card, so it has native keyboard + focus and
         a rotating chevron. svelte:element keeps ONE block for both. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- The interactive case is a native <button> (real keyboard + focus); the non-interactive
         case is a genuinely static <div> whose click handler is a deliberate no-op, so no ARIA
         role is warranted. The lint cannot see the element is dynamic. -->
    <svelte:element
      this={interactive ? "button" : "div"}
      class="et-hd"
      type={interactive ? "button" : undefined}
      aria-expanded={interactive ? open : undefined}
      on:click={() => {
        if (interactive) open = !open;
      }}
    >
      <div class="et-r1">
        {#if svgIcon !== null}<span class="et-icon"><Icon name={svgIcon} /></span>{:else if view.icon}<span class="et-icon">{view.icon}</span>{/if}
        <span class="et-name-text">{view.name}</span>
        <span class="et-q" style="color: {view.chipColor}; border-color: {view.chipColor};">{view.chip}</span>
        {#if interactive}<span class="et-chev" aria-hidden="true">▶</span>{/if}
      </div>
      {#if !collapsed}
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
      {/if}
    </svelte:element>

    {#if !collapsed}
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
      <!-- WR-7 follow-up (OC-D5): the lines above are as rolled; this says what a favored hull adds to them (the
           readouts below already read the favored lines when the host hull is favored). -->
      {#if view.favored}
        <div class="et-detail">{view.favored}</div>
      {/if}
      <!-- GO-6: the Hazard Resist lines above are stat POINTS; this is what they buy in a run (the effective
           resist on the curve toward the 75% cap, never full immunity). -->
      {#if view.hazardResist}
        <div class="et-detail">{view.hazardResist}</div>
      {/if}
      <!-- Material Lines ML-3: the Material Quality line is stat POINTS; this is the chance they buy per delivered unit. -->
      {#if view.materialQuality}
        {@const shipTotal = shipMaterialQualityText(view.readPiece, view.readShipPieces)}
        <div class="et-detail">{view.materialQuality}</div>
        {#if shipTotal}
          <div class="et-detail">{shipTotal}</div>
        {/if}
      {/if}
      <!-- RR-8 (rarity readiness): the legendary affix's value is already in the lines above; these name it and the set. -->
      {#if view.legendaryAffix}
        <div class="et-detail">{view.legendaryAffix}</div>
      {/if}
      {#if view.setLine}
        <div class="et-detail">{view.setLine}</div>
      {/if}
      <!-- E-MOD EM-7: a module carries no stat lines; these say what it does (the modules mockup's details card). EM-10:
           when it acts (its trigger in plain words), its power draw and the one-per-ship note, as the mockup draws them. -->
      {#if view.moduleLines}
        <div class="et-detail">{view.moduleLines.kind}</div>
        <div class="et-detail">{view.moduleLines.effect}</div>
        <div class="et-detail">{view.moduleLines.when}</div>
        {#if view.moduleLines.rule}
          <div class="et-detail"><b>{view.moduleLines.rule}</b></div>
        {/if}
        <div class="et-detail">{view.moduleLines.draw}</div>
        {#if view.moduleLines.condition}
          <div class="et-detail">{view.moduleLines.condition}</div>
        {/if}
        <div class="et-detail">{MODULE_CARD_NOTE}</div>
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
      {#if view.moduleLines}
        <div class="et-detail">{view.moduleLines.kind}</div>
        <div class="et-detail">{view.moduleLines.effect}</div>
        <div class="et-detail">{view.moduleLines.when}</div>
        {#if view.moduleLines.rule}
          <div class="et-detail"><b>{view.moduleLines.rule}</b></div>
        {/if}
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
  /* Collapsible variant (bulk-inspect reveal): the header is a real button. Reset its native
     chrome to match the plain-div header, drop the divider while closed, and restore it on open.
     Only a <button.et-hd> matches, so every non-collapsible card is untouched. */
  button.et-hd {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    border-radius: 0;
    cursor: pointer;
  }
  button.et-hd:hover {
    background: rgba(var(--color-accent-rgb), 0.03);
  }
  .et.open button.et-hd {
    border-bottom: 1px solid var(--color-border);
  }
  .et-chev {
    flex: 0 0 auto;
    color: var(--color-text-dim);
    font-size: var(--text-2xs);
    transition: transform 0.14s;
  }
  .et.open .et-chev {
    transform: rotate(90deg);
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
