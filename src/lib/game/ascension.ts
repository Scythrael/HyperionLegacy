// ============================================================================
// ascension.ts: RARITY READINESS RR-4 (docs/plans/2026-10-23-rarity-readiness-plan.md; user answer 3 "Plumbing only").
//
// Nova and Celestial, the post-legendary ASCENSION states (epic design 2026-07-17 section 3, :149-155, :215):
//   - only ever non-"none" on Luminous or Constellar (model.ts ascensionAllowedFor); a stray ascension on any other band
//     is IGNORED by every reader here (effectiveAscension), never stripped from the save;
//   - Nova: +25% budget (design :215) and a guaranteed Artisan line; Celestial: its own, higher boost, the guaranteed
//     Artisan and one more secondary (the design's "all Luminous-effect stats guaranteed"), and it is never swept by the
//     auto-salvage rules (salvage.ts, the "celestial" reason; the design's "cannot be sold");
//   - labels "Nova Luminous", "Celestial Constellar" (design naming registry :491); the reveal sort and the auto-salvage
//     keep-best rank Celestial above Nova above none within one band.
//
// THE SWITCH is producibility (a [PROVISIONAL] reading, put to the user): ASCENSION_PRODUCIBLE = false, so no player
// path mints an ascension (the Fabricator, inspect and Standard-Issue mints all stamp "none"; the Debug minter is the
// only source, answer 4). The math above is LIVE for any piece that carries a valid ascension, so a dev-minted Nova
// piece measurably acts and nothing is inert. The Celestial Constellar set reduction (one fewer piece) is RR-6's.
//
// Leaf: imports model.ts and rarityProfiles.ts only, so itemgen.ts, inspectSort.ts and salvage.ts can all read it.
// ============================================================================

import {
  ASCENSION_BUDGET_MULT,
  CELESTIAL_BUDGET_MULT,
  NOVA_BUDGET_MULT,
  ascensionAllowedFor,
  equipmentRarityLabel,
  isEquipmentAscension,
  type EquipmentAscension,
  type EquipmentRarity,
} from "./model";
// The ascension multipliers moved to model.ts (review of RR-4: the module effect scale reads them there too); re-exported.
export { ASCENSION_BUDGET_MULT, CELESTIAL_BUDGET_MULT, NOVA_BUDGET_MULT };
import { rarityProfile, type RarityProfile } from "./rarityProfiles";

// The switch (answer 3): false = nothing a player does can produce an ascended piece. Read by every producer that
// could mint one; today that is none (the Fabricator mint never rolls an ascension), and the test pins that the mints
// stamp "none". Flipping it is the decision the user takes when Nova / Celestial ship (with a producer designed then).
export const ASCENSION_PRODUCIBLE = false;

// [PROVISIONAL] (design :151-153, "2 Luminous-effect stats guaranteed" / "all Luminous-effect stats guaranteed", a
// reading put to the user): what each ascension guarantees beyond the budget. TOTAL like the table above.
export const ASCENSION_EXTRAS: Readonly<Record<EquipmentAscension, { readonly guaranteedArtisan: boolean; readonly extraSecondaries: number }>> = {
  none: { guaranteedArtisan: false, extraSecondaries: 0 },
  nova: { guaranteedArtisan: true, extraSecondaries: 0 },
  celestial: { guaranteedArtisan: true, extraSecondaries: 1 },
};

// The ascension a piece of this band really has: the stored one when the band may carry it and it is a known value,
// else "none". Every reader goes through this, so a stray value can never boost, relabel or reorder a piece. Pure.
export function effectiveAscension(rarity: EquipmentRarity, ascension: EquipmentAscension): EquipmentAscension {
  return ascensionAllowedFor(rarity) && isEquipmentAscension(ascension) ? ascension : "none";
}

// The budget multiplier an ascension adds for this band (1 when it does not apply). Pure.
export function ascensionBudgetMult(rarity: EquipmentRarity, ascension: EquipmentAscension): number {
  return ASCENSION_BUDGET_MULT[effectiveAscension(rarity, ascension)];
}

// The profile a mint of (band, ascension) rolls by. "none" (and every stray ascension) returns the band's OWN row object,
// so every live mint reads exactly what it read before RR-4. Pure.
export function ascendedProfile(rarity: EquipmentRarity, ascension: EquipmentAscension): RarityProfile {
  const base = rarityProfile(rarity);
  const eff = effectiveAscension(rarity, ascension);
  if (eff === "none") return base;
  const extras = ASCENSION_EXTRAS[eff];
  return {
    ...base,
    budgetMult: base.budgetMult * ASCENSION_BUDGET_MULT[eff],
    secondaries: base.secondaries + extras.extraSecondaries,
    artisanPermille: extras.guaranteedArtisan ? 1000 : base.artisanPermille,
  };
}

// The display name of a piece's grade: "Nova Luminous", "Celestial Constellar", or the band's own label. Pure.
export function ascensionLabel(rarity: EquipmentRarity, ascension: EquipmentAscension): string {
  const eff = effectiveAscension(rarity, ascension);
  const band = equipmentRarityLabel(rarity);
  return eff === "none" ? band : `${eff.charAt(0).toUpperCase()}${eff.slice(1)} ${band}`;
}

// The ascension's rank within a band for the order readers (none 0, Nova 1, Celestial 2; a stray value 0). Pure.
export function ascensionOrder(rarity: EquipmentRarity, ascension: EquipmentAscension): number {
  const eff = effectiveAscension(rarity, ascension);
  return eff === "celestial" ? 2 : eff === "nova" ? 1 : 0;
}

// Is this piece a real Celestial (a Celestial Luminous or Celestial Constellar)? The auto-salvage exemption. Pure.
export function isCelestialPiece(piece: { rarity: EquipmentRarity; ascension: EquipmentAscension }): boolean {
  return effectiveAscension(piece.rarity, piece.ascension) === "celestial";
}
