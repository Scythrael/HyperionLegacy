// WR-8b (enemy torpedoes): the wiring registry READ-BACK the registry golden chains apply, since their pins were taken
// before it (the wr10ReadBack precedent). TEST-ONLY.
//
// WR-8b changes the registry in two ways:
//   pending -> live : ship:wr8:defensiveMissileIntercept (its claim and its check change with it);
//   added           : ship:wr8b:waveTorpedoes, ship:wr8b:marauderTorpedoRamp, ship:wr8b:shipEventTorpedoes.
// wr8bReadBack drops the added rows and puts the flipped row back exactly as it stood on f8d3623. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

export const WR8B_ADDED_IDS: ReadonlySet<string> = new Set(["ship:wr8b:waveTorpedoes", "ship:wr8b:marauderTorpedoRamp", "ship:wr8b:shipEventTorpedoes"]);
const INTERCEPT = "ship:wr8:defensiveMissileIntercept";
const INTERCEPT_BEFORE: Partial<WiringEntry> = {
  claim: "A Defensive ship with working Point Defense or EMP shoots down DEFENSIVE_STANCE.missileInterceptPct of incoming missiles (the engine reads it; no enemy fires a missile in 0.14.0)",
  status: { kind: "pending", owner: "the first enemy loadout with a missile (WR-8 review: no pirate or ship event vessel installs a torpedo yet)" } as WiringEntry["status"],
  probe: undefined,
  contexts: [],
  direction: "up",
  curve: { kind: "linearAbsolute" },
  // The registry builder's defaults (wiring/registry.ts entry): an audit row with no check.
  magnitude: () => 0,
  on: (s) => s,
};

export function wr8bReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !WR8B_ADDED_IDS.has(e.id)).map((e) => (e.id === INTERCEPT ? ({ ...e, ...INTERCEPT_BEFORE } as WiringEntry) : e));
}
