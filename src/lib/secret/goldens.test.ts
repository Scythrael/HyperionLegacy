// goldens.test.ts: the 0.13.11 engine, frozen (0.13.11.1, plan Review Focus 4).
//
// Captured on the UNCHANGED 0.13.11 engine before any 0.13.11.1 engine edit. Fixed states are
// stepped live and caught up for fixed times; every 0.13.11 field must serialize byte-identically.
// 0.13.11.1 adds fields and the e1,000,000 upgrades, all of which are exactly 1 at level 0, so
// nothing before e1,000,000 may move. A failure here means players part way through moved.
// Regenerate ONLY on purpose: GOLDEN_WRITE=1 npx vitest run src/lib/secret/goldens.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { serializeSecret, type SecretState } from "./state";
import { advanceTo } from "./catchUp";
import { earlyManualState, midAutoState, pastFinaleState, live } from "./testStates";

const PATH = "src/lib/secret/goldens.json";

// The 0.13.11 save fields, in a fixed order (later fields are left out on purpose).
const FIELDS_0_13_11 = [
  "v", "ore", "bought", "owned", "overclock", "lastIncome", "runPeak", "fleetPeak", "pcPeak", "bestOre", "runSeconds",
  "captainPoints", "augmentPoints", "dreamPoints", "captainCount", "fleetCount", "fleetTotal", "pcCount", "tiersUnlocked",
  "skillPoints", "skills", "autoOn", "autoTarget", "milestones", "finaleSeen", "longSeen", "lastTickAt",
];

function fingerprint(s: SecretState): string {
  const all = JSON.parse(serializeSecret(s)) as Record<string, unknown>;
  return JSON.stringify(FIELDS_0_13_11.map((k) => [k, all[k]]));
}

function cases(): Record<string, string> {
  const early = earlyManualState();
  const mid = midAutoState();
  const past = pastFinaleState();
  return {
    earlyLive1h: fingerprint(live(early, 3600)),
    midLive1h: fingerprint(live(mid, 3600)),
    midCoarse2d: fingerprint(advanceTo(mid, mid.lastTickAt + 2 * 86400 * 1000).state),
    pastFinaleLive1h: fingerprint(live(past, 3600)),
    pastFinaleCoarse1d: fingerprint(advanceTo(past, past.lastTickAt + 86400 * 1000).state),
  };
}

const writing = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GOLDEN_WRITE === "1";

describe("the 0.13.11 engine is frozen below e1,000,000", () => {
  it("matches the captured goldens field for field", () => {
    const now = cases();
    if (writing) writeFileSync(PATH, JSON.stringify(now, null, 1) + "\n");
    const golden = JSON.parse(readFileSync(PATH, "utf-8")) as Record<string, string>;
    expect(Object.keys(golden).sort()).toEqual(Object.keys(now).sort());
    for (const k of Object.keys(golden)) expect(now[k], k).toBe(golden[k]);
  }, 240000);
});
