// Prospecting squads (0.14.0, built HIDDEN): design docs/plans/2026-10-16-prospecting-squads-design.md and its
// USER ANSWERS (2026-10-16). The third away squad type is built FULLY (specs, traits, stats, recruits, gear,
// Standard-Issue rows, team slots and kinds) and stays HIDDEN until a quest step in the prospecting quests patch
// unlocks it per save (user: "A quest step unlocks it"). QA access before then is TESTS ONLY (user: no Debug
// toggle). Prospecting never fights: an ambushed squad retreats like a Survey team (user: "Never, retreat").
//
// This module holds the pieces with no older home:
//   - THE UNLOCK: squadTypeUnlocked (the ONE visibility predicate) and unlockProspectingSquads (the seam the
//     quest step calls; nothing calls it in 0.14.0).
//   - PROSPECTING_SPEC_BASE: what each role lifts (user: Excavation +15% YIELD; Drilling +10% FIELD and +10%
//     HAZ; Assaying +10% GRADE).
//   - PROSPECTING_BLUEPRINTS: the crafted Prospecting catalog's blueprints, kept OUT of model.ts BLUEPRINTS on
//     purpose: the Research list, Fabricator, Archive and their completion totals read BLUEPRINTS whole and have
//     no hidden-entry rule, so a hidden blueprint there would show. The quests patch merges this record into
//     BLUEPRINTS when those surfaces go visible.
//   - The THREE LATER USES (user: prospecting quests, expedition mineral sites AND ship mining missions) as one
//     typed list plus the crew reader each use will call (prospectingCrewStats). Nothing reads them in 0.14.0.
//
// Imports model.ts (and the leaf crewRank.ts) only, so awayTeam.ts, groundTeams.ts and quartermaster.ts can all
// ask squadTypeUnlocked without an import cycle. Every function is pure.
//
// WIRING: every Prospecting source carries a registry entry with status deferred, owner "prospecting quests
// patch" (wiring/registry.ts), the user-approved exception to "no placeholders" (user group 4, 2026-10-16:
// "It's building in the foundation for them as is, rather than building them in after the fact").

import type { AwayTeamType, BlueprintDef, GameState, ProspectingSpec, SnapshotMember } from "./model";

// ============================================================================
// The unlock (design section 8)
// ============================================================================

// The squad types a save may see. Security and Science always; Prospecting only once its per-save flag is set.
// The ONE predicate every hidden surface asks (recruit board, team kinds, Quartermaster rows, worn-by lines).
// Pure.
export function squadTypeUnlocked(state: Pick<GameState, "prospectingSquadsUnlocked">, teamType: AwayTeamType): boolean {
  if (teamType === "prospecting") return state.prospectingSquadsUnlocked === true;
  return true;
}

// THE UNLOCK SEAM: the quests patch's quest step calls this (through the shared grant seam once it exists). It
// sets the per-save flag; everything Prospecting appears from that moment (the board's Prospecting slots are
// SEPARATE slots, so no board the player is looking at reshuffles). Idempotent: an unlocked save comes back as
// the SAME ref. Nothing calls it in 0.14.0. Pure.
export function unlockProspectingSquads(state: GameState): GameState {
  if (state.prospectingSquadsUnlocked === true) return state;
  return { ...state, prospectingSquadsUnlocked: true };
}

// ============================================================================
// The three roles (design section 2; user "Excavation / Drilling / Assaying")
// ============================================================================

// What one Prospecting member's ROLE adds to their stats, each a FRACTION on the member stat scale (awayTeam.ts
// AwayMemberStat: oreYield / oreGrade / fieldwork / hazardResist), the Security SECURITY_SPEC_BASE analog.
// Excavation mirrors Science's SPEC_POI_YIELD 0.15. [PROVISIONAL] numbers (the user named the roles and lifts).
export interface ProspectingSpecBase {
  readonly oreYield: number;
  readonly fieldwork: number;
  readonly hazardResist: number;
  readonly oreGrade: number;
}

export const PROSPECTING_SPEC_BASE: Readonly<Record<ProspectingSpec, ProspectingSpecBase>> = {
  excavation: { oreYield: 0.15, fieldwork: 0, hazardResist: 0, oreGrade: 0 },
  drilling: { oreYield: 0, fieldwork: 0.1, hazardResist: 0.1, oreGrade: 0 },
  assaying: { oreYield: 0, fieldwork: 0, hazardResist: 0, oreGrade: 0.1 },
};

// ============================================================================
// The board's Prospecting slots (user "Separate board slots")
// ============================================================================

// How many SEPARATE Prospecting candidates the recruit board adds once unlocked (awayTeam.ts
// awayRecruitCandidates). The Security / Science slots and their rolls are untouched. [PROVISIONAL]
export const PROSPECTING_BOARD_SLOTS = 3;

// ============================================================================
// The later uses (user 2026-10-16, multi-select: all three) and the crew reader they share
// ============================================================================
//
//   quest        , the prospecting quests (the quests patch): a squad works a claim's deposits; YIELD = units
//                  per deposit, FIELD = pace, GRADE = the better-tier roll, HAZ = the hazard slowdown cut.
//   mineralSite  , expedition mineral sites (Mineral Outcrop, Cave Network, Geothermal Chamber): fieldwork.ts is
//                  the seam (its PoI haul multiplier). Whether it stacks with a Science geologist is the user's
//                  call when the use is designed (design section 1).
//   miningMission, the ship's own extraction missions (tick.ts, the extractionYieldMult the Prospecting Rig
//                  lifts): a Prospecting squad aboard the mining ship.
export type ProspectingUse = "quest" | "mineralSite" | "miningMission";
export const PROSPECTING_USES: readonly ProspectingUse[] = ["quest", "mineralSite", "miningMission"];

// A Prospecting crew's summed stats, the reader all three uses call (design section 9). Per member: the role's
// base (PROSPECTING_SPEC_BASE) + the snapshot's gear and trait bumps (awayTeam.ts snapshotMember groundStats,
// the additive STACKING RULE) + its poiYield traits matching `poi` (yield only), all scaled by the member's rank
// (rankFactor, so the open away:audit:scienceRank gap is not repeated). Non-Prospecting members are skipped (a
// Claim team's Security members guard; they do not dig). Each use applies its own D23 curve on top (no hard
// cap). Pure.
export interface ProspectingCrewStats {
  oreYield: number;
  oreGrade: number;
  fieldwork: number;
  hazardResist: number;
}

export function prospectingCrewStats(members: readonly SnapshotMember[], poi?: string): ProspectingCrewStats {
  const out: ProspectingCrewStats = { oreYield: 0, oreGrade: 0, fieldwork: 0, hazardResist: 0 };
  for (const m of members) {
    if (m.teamType !== "prospecting") continue;
    const base = PROSPECTING_SPEC_BASE[m.spec as ProspectingSpec] ?? { oreYield: 0, fieldwork: 0, hazardResist: 0, oreGrade: 0 };
    const stat = (k: string): number => m.groundStats[k] ?? 0;
    let siteYield = 0;
    if (poi !== undefined) {
      for (const e of m.effects) if (e.kind === "poiYield" && e.pois.includes(poi)) siteYield += e.value;
    }
    const rf = m.rankFactor;
    out.oreYield += (base.oreYield + stat("oreYield") + siteYield) * rf;
    out.oreGrade += (base.oreGrade + stat("oreGrade")) * rf;
    out.fieldwork += (base.fieldwork + stat("fieldwork")) * rf;
    out.hazardResist += (base.hazardResist + stat("hazardResist")) * rf;
  }
  return out;
}

// ============================================================================
// The crafted Prospecting catalog's blueprints (design section 5), HIDDEN (see the header)
// ============================================================================
//
// One equipmentOutput blueprint per Prospecting-only variety (the shared Hazard Suit and Environmental
// Adaptation keep their existing Science blueprints). Inputs are EXISTING producible materials only, the member
// gear pattern: cutters and suits lean titanium, tools and implants lean wafers and couplings. TIERS as the
// member gear: the three Standard-Issue varieties at tier 1, the specialists and implants at tier 2.
// [PROVISIONAL] every tier, cost, duration and input amount.
const HINT_T1 = "Researched at the Research Lab; crafted at the Fabricator. Away-team gear, worn by a squad member.";
const HINT_T2 = "Researched at the Research Lab (needs a higher lab tier); crafted at the Fabricator. Away-team gear, worn by a squad member.";

export const PROSPECTING_BLUEPRINTS: Readonly<Record<string, BlueprintDef>> = {
  plasmaCutterBp: {
    key: "plasmaCutterBp",
    label: "Plasma Cutter Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberWeapon", varietyKey: "plasmaCutter" },
    recipe: { inputs: { titaniumIngot: 2, powerCoupling: 2 } },
    flavor: "A hand-held torch that slices ore loose from the seam. Pointed at rock, never at people.",
    unlockHint: HINT_T1,
  },
  rockBreakerBp: {
    key: "rockBreakerBp",
    label: "Rock Breaker Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberWeapon", varietyKey: "rockBreaker" },
    recipe: { inputs: { titaniumIngot: 4, frameSegment: 1 } },
    flavor: "A percussion hammer that turns a cliff face into a cart load. Heavy, loud, and very productive.",
    unlockHint: HINT_T2,
  },
  samplingLanceBp: {
    key: "samplingLanceBp",
    label: "Sampling Lance Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberWeapon", varietyKey: "samplingLance" },
    recipe: { inputs: { titaniumIngot: 2, polysilicateWafer: 2, powerCoupling: 1 } },
    flavor: "Cuts clean cores instead of rubble, so the best rock comes out whole.",
    unlockHint: HINT_T2,
  },
  excavatorSuitBp: {
    key: "excavatorSuitBp",
    label: "Excavator Suit Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberArmor", varietyKey: "excavatorSuit" },
    recipe: { inputs: { titaniumIngot: 3, polysilicateWafer: 1 } },
    flavor: "A sealed work suit with braced knees and a dust filter that never quits.",
    unlockHint: HINT_T1,
  },
  assayScannerBp: {
    key: "assayScannerBp",
    label: "Assay Scanner Blueprint",
    tier: 1,
    researchDurationTicks: 60,
    researchCreditCost: 700,
    craftDurationTicks: 150,
    equipmentOutput: { slotType: "memberTool", varietyKey: "assayScanner" },
    recipe: { inputs: { polysilicateWafer: 2, powerCoupling: 1 } },
    flavor: "A handheld spectrometer that tells good ore from pretty rock in a heartbeat.",
    unlockHint: HINT_T1,
  },
  seismicMapperBp: {
    key: "seismicMapperBp",
    label: "Seismic Mapper Blueprint",
    tier: 2,
    researchDurationTicks: 120,
    researchCreditCost: 1600,
    craftDurationTicks: 300,
    equipmentOutput: { slotType: "memberTool", varietyKey: "seismicMapper" },
    recipe: { inputs: { polysilicateWafer: 3, frameSegment: 1 } },
    flavor: "Thumps the ground and listens to the echo, then draws the seam before anyone digs.",
    unlockHint: HINT_T2,
  },
  oreSenseOpticBp: {
    key: "oreSenseOpticBp",
    label: "Ore-Sense Optic Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "oreSenseOptic" },
    recipe: { inputs: { polysilicateWafer: 4, powerCoupling: 1 } },
    flavor: "A retinal overlay that paints rich ore in warm colors.",
    unlockHint: HINT_T2,
  },
  myoLiftFrameBp: {
    key: "myoLiftFrameBp",
    label: "Myo-Lift Frame Blueprint",
    tier: 2,
    researchDurationTicks: 160,
    researchCreditCost: 2000,
    craftDurationTicks: 320,
    equipmentOutput: { slotType: "implant", varietyKey: "myoLiftFrame" },
    recipe: { inputs: { titaniumIngot: 2, powerCoupling: 2 } },
    flavor: "Powered tendons along the spine and arms. A full cart feels like an empty one.",
    unlockHint: HINT_T2,
  },
};
