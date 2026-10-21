// gasStudyIcons.ts: the ONE UI-side place the Gas Giant Study's items meet their glyphs (0.14.0 GG-1; plan
// docs/plans/2026-10-17-gas-giant-study-plan.md section 3.1 "Glyphs").
//
// EVERY GRAPHIC IS SVG (user hard requirement): the values are IconName keys into the shared registry (icons.ts,
// drawn by <Icon>, classified in iconPacks.ts ICON_SEMANTICS), never emoji. The engine module (game/gasGiantContent.ts)
// stays glyph-free. The research data glyphs come with their screen (GG-6): no data item reaches a list before then.

import type { IconName } from "./icons";
import { GAS_CANISTER_IDS, type GasCanisterId } from "../game/gasGiantContent";

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
