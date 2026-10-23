// gasStudyIcons.ts: the ONE UI-side place the Gas Giant Study's items meet their glyphs (0.14.0 GG-1; plan
// docs/plans/2026-10-17-gas-giant-study-plan.md section 3.1 "Glyphs").
//
// EVERY GRAPHIC IS SVG (user hard requirement): the values are IconName keys into the shared registry (icons.ts,
// drawn by <Icon>, classified in iconPacks.ts ICON_SEMANTICS), never emoji. The engine module (game/gasGiantContent.ts)
// stays glyph-free. GG-6 added the research data glyphs with their screen (the Research Lab's Data study tab): every
// research data item wears the data crystal, the Ancient Data Fragment its torn page.

import type { IconName } from "./icons";
import { ANCIENT_DATA_FRAGMENT_ID, GAS_CANISTER_IDS, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES, type GasCanisterId } from "../game/gasGiantContent";

// Canister id -> its glyph. Exhaustive over GasCanisterId (a new canister without a glyph is a compile error). The
// five gases share the cylinder (user 2026-10-21: "One shared glyph for the 5 cannisters"; distinct graphics later,
// SUGGESTIONS.md); the antimatter cell is its own container (user: "it will require its own specialized container").
export const GAS_CANISTER_ICON: Readonly<Record<GasCanisterId, IconName>> = {
  hydrogenCanister: "gasCanister",
  methaneCanister: "gasCanister",
  ammoniaCanister: "gasCanister",
  deuteriumCanister: "gasCanister",
  helium3Canister: "gasCanister",
  antimatterCell: "antimatterCell",
};

// The glyph of an ITEMS key that is a gas canister, or null for any other item.
export function gasCanisterIcon(itemId: string): IconName | null {
  return (GAS_CANISTER_IDS as readonly string[]).includes(itemId) ? GAS_CANISTER_ICON[itemId as GasCanisterId] : null;
}

// GG-6: the glyph of a research data item ("researchData") or of the Ancient Data Fragment ("ancientFragment"), or
// null for any other item.
const RESEARCH_DATA_IDS: ReadonlySet<string> = new Set(RESEARCH_FAMILIES.map((f) => RESEARCH_DATA_ITEM[f]));
export function researchDataIcon(itemId: string): IconName | null {
  if (itemId === ANCIENT_DATA_FRAGMENT_ID) return "ancientFragment";
  return RESEARCH_DATA_IDS.has(itemId) ? "researchData" : null;
}
