// Wiring OC-G1 (user 2026-10-16 "Delete it": the legacy expedition path is deleted): the wiring registry READ-BACK the
// registry golden chains apply, since their pins were taken before it (the wr10ReadBack precedent). TEST-ONLY.
//
// OC-G1 changes the registry by FLIPPING rows and by dropping the `expedition:legacy` context:
//   pending -> live : Stoneskin's bay row (its legacy-claim context, and its flat check there, went with the legacy
//                     claim), and the two audit rows away:audit:legacyOnly and expedition:audit:legacyFallbacks (each
//                     now with its own check and a reworded claim);
//   contexts        : the Tactician quarters injury perk lost its `expedition:legacy` context (its note changed too).
// ocg1ReadBack puts each row back exactly as it stood. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

type Shape = Pick<WiringEntry, "status" | "probe" | "contexts" | "direction" | "curve" | "note" | "claim" | "flatChecks">;

const AUDIT_DEFAULT = { probe: undefined, contexts: [], direction: "up", curve: { kind: "linearAbsolute" }, note: undefined } as const;

export const OCG1_BEFORE: Readonly<Record<string, Partial<Shape>>> = {
  "away:MEMBER_PERKS:stoneskin": {
    status: { kind: "pending", owner: "OC-G1 (the legacy claim ignores perks, injuries.ts:93)", contexts: ["expedition:legacy" as never] },
    // The flat check's transforms were functions (never serialized); its probe named the deleted legacy claim.
    flatChecks: { ["expedition:legacy" as never]: { probe: "legacyInjurySeconds" } } as unknown as WiringEntry["flatChecks"],
  },
  "away:audit:legacyOnly": {
    ...AUDIT_DEFAULT,
    status: { kind: "pending", owner: "OC-G1" },
    claim: "Legacy-only: MAX_BATTLE_ATTEMPTS, EVAC_REWARD_FRACTION, ENCOUNTER_DROP_SCALE, scan ground battles, softenAmbush, the flat 2 h injury",
  } as Partial<Shape>,
  "expedition:audit:legacyFallbacks": {
    ...AUDIT_DEFAULT,
    status: { kind: "pending", owner: "OC-G1" },
    claim: "FIGHT_POINTS_DEFAULT / MIN, SURVEY_AMBUSH_CHANCE (old runs only)",
  } as Partial<Shape>,
  "ship:HULL_FAMILY_MODULE_BONUS:tactician:quarters:injuryRecovery": {
    contexts: ["medbay", "expedition:legacy" as never],
    note: "injury-class conditions only (a Fracture here; the legacy claim's 2 hour injury); its Health twin is ship:audit:hullFamilyInjuriesOnly",
  },
};

export function ocg1ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) => (OCG1_BEFORE[e.id] ? ({ ...e, ...OCG1_BEFORE[e.id] } as WiringEntry) : e));
}
