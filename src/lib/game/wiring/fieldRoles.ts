// WR-1 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.4): the ROLE of every field
// of every catalog def type. A NEW field on any def fails the completeness test until it is classified here, which
// is how a future "+5% something" field cannot ship silently:
//   effect   the field changes an outcome: the def (or the (def, field) pair, for the data catalogs) must carry a
//            registry entry, live or with an owner
//   display  a label, flavor or description that claims no effect (its text is scanned: a number with a percent or
//            a plus sign fails unless the def has a registry entry)
//   identity an id, key, kind or record field
//   gate     an unlock, cost or requirement (a dispatch / install / purchase gate)
//   seam     a framework hook or a field that does nothing yet, with the slice that owns it

export type FieldRole = "effect" | "display" | "identity" | "gate" | { readonly seam: string };

export const FIELD_ROLES: Readonly<Record<string, Readonly<Record<string, FieldRole>>>> = {
  SHIP_TYPES: {
    label: "display",
    description: "display",
    spec: "gate",
    tier: "gate",
    cargoCapacity: "effect",
    transitSpeedMult: "effect",
    extractionYieldMult: "effect",
    fuelCapacity: "effect",
    engineEfficiency: "effect",
    moduleSlots: "effect",
    equipmentSlots: "effect",
    hullIntegrity: "effect",
    shieldCapacity: "effect",
    shieldRecharge: "effect",
    weaponHardpoints: "effect",
    droneBays: "effect",
    groundSquads: "effect",
    colonistCapacity: "effect",
    basePowerOutput: "effect", // E-MOD EM-1 (P1): the hull's own power output
    buildRecipe: "gate",
    requiresBlueprint: "gate",
    awayTeams: "gate",
  },
  MISSIONS: {
    label: "display",
    tier: "display",
    missionType: "identity",
    transitOutTicks: "effect",
    transitBackTicks: "effect",
    unloadTicks: "effect",
    extractionRatePerTick: "effect",
    cargoCapacity: "effect",
    uncommonChance: "effect",
    rareChance: "effect",
    lootTable: "effect",
    primaryMaterial: "effect",
    fleetAdminXpPerTick: "effect",
    creditsPerCycle: "effect",
    unlockLevel: "effect",
    requiresCaptainLevel: "effect",
    requiresCargoCapacity: "effect",
    supplyCostPerCargo: "effect",
    rewardMargin: "effect",
  },
  // G1-2: the short-range templates (shortRange.ts). `destinations` picks a placeholder designation list.
  SHORT_RANGE_TEMPLATES: { key: "identity", label: "display", destinations: "display", rolls: "effect", work: "effect", reward: "effect" },
  PIRATE_HULLS: {
    id: "identity",
    name: "display",
    hullIntegrity: "effect",
    shieldCapacity: "effect",
    shieldRecharge: "effect",
    weapons: "effect",
    droneRoles: "effect",
    stance: "effect",
    // WR-8 (OC-D12 "pirate hulls get armor and evasion"), applied under the combat rules.
    ablativeArmor: "effect",
    kineticDampening: "effect",
    evasion: "effect",
  },
  PLANET_TYPES: {
    id: "identity",
    label: "display",
    hazardTier: "identity",
    hazard: "effect",
    orbitalOnly: "effect",
    surfaceBias: "effect",
    undergroundBias: "effect",
  },
  SENSOR_ARRAYS: {
    id: "identity",
    label: "display",
    slot: "identity",
    kind: "identity",
    scanRateMult: "effect",
    coverageWidth: "effect",
    landmarkOddsBias: "effect",
    undergroundPoiOddsBias: "effect",
    relicFindBonus: "effect",
  },
  ITEMS: {
    label: "display",
    unlockHint: "display",
    flavor: "display",
    category: "identity",
    subCategory: "identity",
    tier: "identity", // which warehouse cap holds it
    rarity: "identity", // which salvage multiplier times it
    // ML-1: a produced item with no consumer yet; each one is a pending registry entry owned by the named slice.
    reserved: "effect",
    sellValue: "effect",
    // Gas Giant Study GG-1: the quality band a gas canister belongs to (which band draw files it, GG-3).
    band: "identity",
  },
  // Gas Giant Study GG-1 (gasGiantContent.ts): the giant classes and the nebula kinds. The texts are display; the
  // class roll's weight and mass band (GG-2), the physics inputs and the band odds and item weights (GG-3, GG-4) are
  // the effects, each a pending registry entry owned by its slice.
  GIANT_CLASSES: {
    id: "identity",
    name: "display",
    sudarsky: "display",
    weight: "effect",
    massMinMilliJ: "effect",
    massMaxMilliJ: "effect",
    radiusModel: "effect",
    inflation: "effect",
    bandOdds: "effect",
    itemWeights: "effect",
    temperature: "display",
    example: "display",
    gases: "display",
    feature: "display",
  },
  NEBULA_KINDS: {
    id: "identity",
    name: "display",
    stage: "display", // its place on the Survey Log's life-cycle strip (GG-6)
    bandOdds: "effect",
    itemWeights: "effect",
    example: "display",
    gases: "display",
    feature: "display",
  },
  SENIOR_STAFF_BONUSES: { id: "identity", label: "display", description: "display", seat: "gate", statKey: "identity", magnitude: "effect", rollTier: "effect" },
  CREW_BUFFS: { id: "identity", label: "display", statKey: "identity", magnitude: "effect" },
  SUBSPACE_TELESCOPE_LEVELS: { level: "identity", credits: "gate", durationTicks: "gate", fleetAdminLevel: "gate", reachTier: "effect", detail: "effect" },
  AFFIX_DEFS: {
    id: "identity",
    name: "display",
    catalog: "identity",
    maxRank: "gate",
    alignments: "gate",
    appliesTo: "gate",
    minTier: "gate",
    minDifficulty: "gate",
    requiredFromDifficulty: "gate",
    rollWeight: "gate",
    tooltip: "display",
    help: "display",
    hooks: "effect",
  },
  CREW_RACES: { id: "identity", label: "display", species: "display", lean: "display", names: "display", racialBonus: "effect" },
  AWAY_TRAITS: { id: "identity", label: "display", description: "display", teamTypes: "gate", effects: "effect" },
  GAMBIT_STATUSES: { id: "identity", label: "display", kind: "identity", effect: "identity", magnitude: "effect", duration: "effect" },
  GAMBIT_PRESETS: { id: "identity", title: "display", programs: "effect" },
  GROUND_CONDITIONS: { id: "identity", label: "display", cls: "identity", cureSeconds: "effect" },
  CAPTAIN_TALENTS: { branch: "identity", label: "display", flavor: "display", x: "display", y: "display", cost: "gate", isHub: "gate", neighbors: "gate", effect: "effect" },
  SECONDARY_CAPTAIN_TALENTS: {
    tree: "identity",
    branch: "identity",
    rung: "identity",
    label: "display",
    flavor: "display",
    x: "display",
    y: "display",
    cost: "gate",
    isHub: "gate",
    neighbors: "gate",
    effect: "effect",
  },
  HOMEWORLD_TALENTS: {
    branch: "identity",
    label: "display",
    flavor: "display",
    x: "display",
    y: "display",
    cost: "gate",
    isHub: "gate",
    neighbors: "gate",
    requiresFleetAdminLevel: "gate",
    effect: "effect",
  },
  FACILITIES: { label: "display", upgrades: "effect" },
  // G1-6: requiresMissionCompletions (the Short-Range board rung at Mission Control level 2, the kept 50-completion
  // hook) is a gate.
  FACILITY_UPGRADES: { materials: "gate", credits: "gate", durationTicks: "gate", requiresFleetAdminLevel: "gate", requiresHomeworldTalents: "gate", requiresMissionCompletions: "gate", effect: "effect" },
  REFINE_RECIPES: { input: "effect", output: "effect", durationTicks: "effect" },
  BLUEPRINTS: {
    key: "identity",
    label: "display",
    flavor: "display",
    unlockHint: "display",
    unlockOnly: "identity",
    tier: "gate",
    researchCreditCost: "gate",
    requiresRelicDiscovery: "gate",
    researchDurationTicks: "effect",
    craftDurationTicks: "effect",
    recipe: "effect",
    equipmentOutput: "effect",
    weaponOutput: "effect",
    droneOutput: "effect",
    driveClass: "effect", // Expedition Tiers G2-4: the drive's class (propulsion.ts shipDriveClass; EM-1's x1.6 power draw)
  },
  QUARTERS_MODULES: {
    id: "identity",
    label: "display",
    slot: "identity",
    kind: "identity",
    division: "identity",
    focusBoost: "effect",
    offBoost: "effect",
    baseCapacity: "effect",
    capacityScales: "effect",
  },
  BRIDGE_MODULES: { id: "identity", label: "display", slot: "identity", kind: "identity", amp: "effect" },
  WEAPON_DEFS: {
    id: "identity",
    weaponType: "identity",
    cooldownAccumulator: "identity", // per-battle runtime state
    family: "effect",
    yieldMin: "effect",
    yieldMax: "effect",
    cooldownDeciSec: "effect",
    accuracy: "effect",
    projectileCount: "effect",
    shieldAttenuation: "effect",
    effectSlots: "effect",
    ambushEligible: "effect",
    durability: "effect",
    durabilityMax: "effect",
    quality: "effect",
    range: "effect", // WR-8: fights open at range (the firing gate and the stance reach read it)
    powerDraw: "effect", // E-MOD EM-1: a crafted weapon's draw joins the ship's power budget
    armorPen: "effect", // WR-8: pirate hulls carry armor and dampening
  },
  ROLE_TEMPLATE: {
    droneHp: "effect",
    family: "effect",
    accuracy: "effect",
    yieldMin: "effect",
    yieldMax: "effect",
    evasion: "effect",
    attackCooldownDeciSec: "effect",
    interceptChance: "effect",
    reflectChance: "effect",
    supportHullRepair: "effect",
    droneReplenishRate: "effect",
    range: "effect", // WR-8: the squadron reach gate
  },
  STATUS_EFFECT_DEFS: {
    id: "identity",
    kind: "identity",
    system: "display",
    displayName: "display",
    flavor: "display",
    mechanic: "effect",
    durationDeciSec: "effect",
    color: { seam: "WR-11 (use in the combat view or delete)" },
  },
  RELIC_SETS: { id: "identity", label: "display", relicIds: "identity", sources: "effect", perCopyStat: "effect", tiers: "effect" },
  RELICS: { id: "identity", label: "display", flavor: "display", setId: "identity", index: "identity", rarity: "effect" },
  // Relics v2 R2-1: the general pool and the exceptional sets; each effect field names the slice that reads it.
  // R2-3: band, siteSet and weight are read by every new study's reveal (relicIdentify.ts rollRelicIdentification: the
  // band pick, the site bias, the in-band pick); only the stats wait for R2-4.
  RELIC_TYPES: {
    id: "identity",
    label: "display",
    flavor: "display",
    band: "effect",
    siteSet: "effect",
    stats: { seam: "Relics v2 R2-4 (museum math v2 sums each type's stats per tier)" },
    weight: "effect",
  },
  EXCEPTIONAL_SETS: {
    id: "identity",
    tier: "identity",
    label: "display",
    pieces: { seam: "Relics v2 R2-4 + R2-5 (the piece values; the content sign-off sheet)" },
    fullSet: { seam: "Relics v2 R2-4 + R2-5 (the full-set bonus; the content sign-off sheet)" },
  },
  PATROLS: {
    label: "display",
    factionId: "identity", // the fought faction's id; since WR-4 (B14) only a combatant id prefix, never turn order
    hullPool: "effect",
    minWaves: "effect",
    maxWaves: "effect",
    enemyCountMin: "effect",
    enemyCountMax: "effect",
    transitOutTicks: "effect",
    rollWindowTicks: "effect",
    transitBackTicks: "effect",
    waveChanceNumerator: "effect",
    waveChanceDenominator: "effect",
  },
  POI_CATALOG: { id: "identity", label: "display", pool: "effect", planetWeights: "effect", flavor: { seam: "WR-11, OC-G4 (never rendered)" } },
  EQUIPMENT_SLOTS: { slotType: "identity", label: "display", varieties: "identity", implicitStats: "effect", affixPool: "effect", equipRequirement: "gate" },
  EQUIPMENT_VARIETIES: {
    key: "identity",
    label: "display",
    equipRequirement: "gate",
    implicitStats: "effect",
    affixPool: "effect",
    statRatios: "effect",
    member: "effect",
    favorsSpec: { seam: "WR-7, OC-D5 (no reader)" },
  },
};

// The fields of `catalog` classified as effect.
export function effectFieldsOf(catalog: string): string[] {
  const roles = FIELD_ROLES[catalog];
  if (!roles) throw new Error(`no FIELD_ROLES for ${catalog}`);
  return Object.entries(roles)
    .filter(([, r]) => r === "effect")
    .map(([f]) => f);
}

// The exported UPPER_CASE constants in src/lib/game that nothing outside their declaration reads (the source scan in
// wiring.completeness.test.ts), each with its role: a seam with an owner, or bookkeeping that is not a game value.
export const UNREAD_CONSTANTS: Readonly<Record<string, string>> = {
  AFFIX_ALIGNMENTS: "display: the alignment vocabulary in order (the affix chips read the type)",
  OFFICER_BONUSES_PENDING_IN_RELEASE: "bookkeeping: read by the wiring registry (the officer bonuses whose system lands later)",
  NEUTRAL_SHIP_EVENT_PROFILE: "seam: the profile a pre-GO-8 flagged run carries (OC-G1, the legacy path)",
  STAT_KEYS: "identity: the stat vocabulary bundle (LIVE / RESERVED / ground)",
  // Gas Giant Study GG-1 (data only): read by the engine slices that wire them (GG-3 reads ITEM_BANDS: the study's band
  // draw, gasGiantStudy.ts rollCanister).
  GAS_STUDY_SOURCE_OWNER: "bookkeeping: the slice that gives the source-pending study items their source (GG-3, GG-4)",
  ALL_AUTO_SALVAGE_QUALITIES: "display: every quality tier for the auto-salvage picker",
  CUNNING_PENDING_SEATS: "bookkeeping: the seats with no Cunning over-delivery yet (Pilot Cunning, WR-9 OC-E4)",
  ECONOMY_FLOOR_SLOTS: "display: the Quartermaster's economy floor set, named for its readers",
  ENEMY_RANK_IDS: "bookkeeping: the enemy ranks in order, read by the wiring registry (one entry per rank, Field Kits FKR-1) and FKR-3's rank chips",
  GRENADE_IDS: "bookkeeping: the grenade family in catalog order, read by the wiring registry (its GRENADES entries, Field Kits FKR-5) and FKR-9's charge readout",
  PROSPECTING_USES: "seam: the prospecting quests patch (the three later Prospecting uses, read by the wiring registry; deferred)",
  PROSPECTING_BLUEPRINTS: "seam: the prospecting quests patch merges these hidden blueprints into BLUEPRINTS (read by the wiring registry; deferred)",
  // Relics v2 R2-1 (dormant catalog; plan 2026-10-17 section 4): each is read by the slice named, tested in relicsV2Catalog.test.ts.
  // (R2-2 reads RELIC_BAND_ODDS, RELIC_SITE_BIAS_MULT and CULTURE_ROSTER: relicBlanks.ts; R2-3 reads EXCEPTIONAL_PER_100K:
  // relicIdentify.ts, the exceptional check.)
  RELIC_SOFT_CAP: "seam: Relics v2 R2-4 (the per-tier soft cap freeze, user call 3)",
  CULTURE_STUDY_POINTS: "seam: Relics v2 R2-6 (a culture is named at this many study points, user call 9)",
  // WR-8 (0.14.0): the per-family resist line keys (the craft pools in model.ts spell them, since model.ts never imports
  // combat at runtime): read by the wiring registry's roll probe and the test switch.
  PLATING_RESIST_LINES: "bookkeeping: the Hull Plating resist line keys (WR-8), read by the wiring registry and the combat rules test switch",
  EMITTER_RESIST_LINES: "bookkeeping: the Shield Emitter resist line keys (WR-8), read by the wiring registry and the combat rules test switch",
};
