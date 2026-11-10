// Wiring WR-10 (the away team and ground beyond Field Kits): the wiring registry READ-BACK the registry golden chains
// apply, since their pins were taken before it (the cp19ReadBack / wr11ReadBack precedent). TEST-ONLY.
//
// WR-10 changes the registry by FLIPPING rows; its fix round (WR10_FIX_BEFORE below) also added one.
//   pending -> live : Corroded's status row (OC-F9), the Fall Back action (OC-F6), the account gambit pair (OC-F12), and
//                     four audit rows (Neural Backup's claim OC-F2, the Med Kit's claim OC-F3, Science rank OC-F7, the
//                     status picker OC-F9);
//   pending -> seam : the four Science actions (OC-F10) and the fall-outcome hook (OC-F13).
// Seven rows also changed their claim (the account pair, five audit rows and Neural Backup's revive effect).
// wr10ReadBack puts each flipped row's status, contexts and probe, and each changed claim, back as they stood. Apply it
// innermost.

import type { WiringEntry } from "./wiring/registry";

type Before = { status: WiringEntry["status"]; contexts: string[]; probe: undefined };
const was = (owner: string): Before => ({ status: { kind: "pending", owner } as WiringEntry["status"], contexts: [], probe: undefined });
const SCIENCE_ACTION = "WR-10, OC-F10 (a Science action: never offered or run)";

export const WR10_FLIPPED_BEFORE: Readonly<Record<string, Before>> = {
  "away:GAMBIT_STATUSES:corroded": was("WR-10, OC-F9 (only analyze, never run, inflicts it)"),
  "away:GAMBIT_ACTIONS:fallBack": was("WR-10, OC-F6 (identical to Hold, gambit.ts:887)"),
  "away:GAMBIT_ACTIONS:shieldAlly": was(SCIENCE_ACTION),
  "away:GAMBIT_ACTIONS:analyze": was(SCIENCE_ACTION),
  "away:GAMBIT_ACTIONS:secureObjective": was(SCIENCE_ACTION),
  "away:GAMBIT_ACTIONS:takeCover": was(SCIENCE_ACTION),
  "away:GAMBIT_PROGRAMS:account": was("WR-10, OC-F12 (D19: no battle reads it)"),
  "away:audit:neuralBackupClaim": was("WR-10, OC-F2"),
  "away:audit:medKitClaim": was("WR-10, OC-F3"),
  "away:audit:scienceRank": was("WR-10, OC-F7"),
  "away:audit:memberFallOutcome": was("OC-F13"),
  "away:audit:statusPicker": was("WR-10, OC-F9 (Corroded: only Analyze inflicts it)"),
};
export const WR10_FLIPPED_IDS: ReadonlySet<string> = new Set(Object.keys(WR10_FLIPPED_BEFORE));

export const WR10_CLAIM_BEFORE: Readonly<Record<string, string>> = {
  "away:GAMBIT_PROGRAMS:account": "The account gambit pair (DEFAULT_GAMBIT_PROGRAMS, state.gambitPrograms)",
  "away:groundEffect:revive": "Neural Backup: once per battle, a downed ally may come back",
  "away:audit:neuralBackupClaim": "Neural Backup revives the FIRST downed ally; its flavor says the wearer (B13)",
  "away:audit:medKitClaim": "Med Kit \"keeps a downed friend in the fight\" (no revive)",
  "away:audit:scienceRank": "Science member rank \"nudges magnitude\" (fieldwork never reads it)",
  "away:audit:memberFallOutcome": "memberFallOutcome (the Safety Interlock hook, one branch)",
  "away:audit:statusPicker": "Status picker entries that never match (Corroded: only Analyze inflicts it, and no battle runs Analyze)",
};

// The rows that gained a check had the registry's default shape before (direction up, a linear curve, no note); Neural
// Backup's revive effect only changed its note.
const DEFAULT_SHAPE_IDS: ReadonlySet<string> = new Set([
  "away:GAMBIT_STATUSES:corroded",
  "away:GAMBIT_PROGRAMS:account",
  "away:audit:neuralBackupClaim",
  "away:audit:medKitClaim",
  "away:audit:scienceRank",
  "away:audit:statusPicker",
]);
const REVIVE_NOTE_BEFORE = "revives the FIRST downed ally, not the wearer (B13, WR-10 OC-F2)";

// The WR-10 FIX ROUND (user answers 2026-11-10): two more rows flipped pending -> live, Saboteur's trait row (OC-F4: its status
// chance now stretches a landed Suppress with no inflict piece, measured in battle by the added row
// away:audit:saboteurLinger; the trait row keeps its exact inflict-piece measurement) and the Quick Draw audit row (OC-F5:
// the Stun and Fear shrug); the account pair row (OC-F12, the merge) and the Quick Draw trait row changed their claim or
// note; and two rows were ADDED, Saboteur's linger and the account default control (pending on OC-F12's mockup).
// Each is put back as it stood on 5339682.
export const WR10_FIX_ADDED_IDS: ReadonlySet<string> = new Set(["away:audit:saboteurLinger", "away:audit:accountDefaultControl"]);
type Shape = Pick<WiringEntry, "status" | "probe" | "contexts" | "direction" | "curve" | "note" | "claim">;
export const WR10_FIX_BEFORE: Readonly<Record<string, Partial<Shape>>> = {
  "away:AWAY_TRAITS:saboteur": {
    status: { kind: "pending", owner: "WR-10 OC-F4 (status chance without an inflict piece)", contexts: ["ground:noInflict"] },
    probe: "secInflictPermille",
    contexts: ["ground"],
    curve: { kind: "chanceAbsolute" },
    note: "live with an inflict piece worn (the base wears a bare Stun Grenade); the no-inflict context is pending",
  },
  "away:AWAY_TRAITS:quickDraw": { note: "weak: the team already acts first (OC-F5)" },
  "away:audit:quickDraw": {
    status: { kind: "pending", owner: "WR-10, OC-F5" },
    probe: undefined,
    contexts: [],
    direction: "up",
    curve: { kind: "linearAbsolute" },
    note: undefined,
    claim: "Quick Draw only reorders teammates (the team already acts first)",
  },
  "away:GAMBIT_PROGRAMS:account": { note: undefined },
};
export const WR10_FIX_FLIPPED_IDS: ReadonlySet<string> = new Set(["away:AWAY_TRAITS:saboteur", "away:audit:quickDraw"]);

export function wr10ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !WR10_FIX_ADDED_IDS.has(e.id)).map((e) => (WR10_FIX_BEFORE[e.id] ? ({ ...e, ...WR10_FIX_BEFORE[e.id] } as WiringEntry) : e)).map((e) => {
    const before = WR10_FLIPPED_BEFORE[e.id];
    const claim = WR10_CLAIM_BEFORE[e.id];
    if (!before && claim === undefined) return e;
    return {
      ...e,
      ...(before ? { status: before.status, contexts: before.contexts, probe: before.probe } : {}),
      ...(claim !== undefined ? { claim } : {}),
      ...(DEFAULT_SHAPE_IDS.has(e.id) ? { direction: "up", curve: { kind: "linearAbsolute" }, note: undefined } : {}),
      ...(e.id === "away:groundEffect:revive" ? { note: REVIVE_NOTE_BEFORE } : {}),
    } as unknown as WiringEntry;
  });
}
