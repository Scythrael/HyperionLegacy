// relicGoldens.test.ts: R2-10 (relic boosts in the minigame) goldens.
//
// "relicFree" was captured on the UNCHANGED engine before any R2-10 engine edit: the WHOLE secret save
// (every field, not only the 0.13.11 ones goldens.test.ts pins) of fixed states stepped live and caught
// up, plus the engine's multiplier and gain readouts. A minigame with no relics must stay byte-identical,
// so these never move. Regenerate ONLY on purpose: GOLDEN_WRITE=1 npx vitest run src/lib/secret/relicGoldens.test.ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { serializeSecret, type SecretState } from "./state";
import { advanceTo } from "./catchUp";
import { captainGain, fleetGain, prestigeceptionGain, tierMultiplier, overclockMultiplier, tenBonusFactor, prestigeMultiplier, augmentMultiplier, captainMultiplier } from "./engine";
import { TIER_COUNT } from "./config";
import { earlyManualState, midAutoState, pastFinaleState, postPrestigeceptionState, live } from "./testStates";

const PATH = "src/lib/secret/relicGoldens.json";

function readouts(s: SecretState): string {
  const tiers: string[] = [];
  for (let k = 0; k < TIER_COUNT; k++) tiers.push(tierMultiplier(s, k).toString());
  return JSON.stringify({
    tiers,
    overclock: overclockMultiplier(s).toString(),
    ten: tenBonusFactor(s),
    stack: prestigeMultiplier(s).toString(),
    captainMult: captainMultiplier(s).toString(),
    augmentMult: augmentMultiplier(s).toString(),
    captainGain: captainGain(s).toString(),
    fleetGain: fleetGain(s).toString(),
    pcGain: prestigeceptionGain(s).toString(),
  });
}

function relicFreeCases(): Record<string, string> {
  const early = earlyManualState();
  const mid = midAutoState();
  const past = pastFinaleState();
  const pc = postPrestigeceptionState();
  return {
    earlyLive1h: serializeSecret(live(early, 3600)),
    midLive1h: serializeSecret(live(mid, 3600)),
    midCoarse2d: serializeSecret(advanceTo(mid, mid.lastTickAt + 2 * 86400 * 1000).state),
    pastFinaleLive1h: serializeSecret(live(past, 3600)),
    pastFinaleCoarse1d: serializeSecret(advanceTo(past, past.lastTickAt + 86400 * 1000).state),
    readEarly: readouts(early),
    readMid: readouts(mid),
    readPostPc: readouts(pc),
    readPastFinale: readouts(past),
  };
}

const writing = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GOLDEN_WRITE === "1";

type Goldens = { relicFree: Record<string, string> };

describe("R2-10 goldens", () => {
  it("a minigame with no relics is byte-identical to the engine before relic boosts", () => {
    const now = relicFreeCases();
    const prior: Partial<Goldens> = existsSync(PATH) ? (JSON.parse(readFileSync(PATH, "utf-8")) as Partial<Goldens>) : {};
    if (writing) writeFileSync(PATH, JSON.stringify({ ...prior, relicFree: now }, null, 1) + "\n");
    const golden = (JSON.parse(readFileSync(PATH, "utf-8")) as Goldens).relicFree;
    expect(Object.keys(golden).sort()).toEqual(Object.keys(now).sort());
    for (const k of Object.keys(golden)) expect(now[k], k).toBe(golden[k]);
  }, 400000);
});
