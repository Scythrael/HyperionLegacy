// relicGoldens.test.ts: R2-10 (relic boosts in the minigame) goldens.
//
// "relicFree" was captured on the UNCHANGED engine before any R2-10 engine edit: the WHOLE secret save
// (every field, not only the 0.13.11 ones goldens.test.ts pins) of fixed states stepped live and caught
// up, plus the engine's multiplier and gain readouts. A minigame with no relics must stay byte-identical,
// so these never move. Regenerate ONLY on purpose: GOLDEN_WRITE=1 npx vitest run src/lib/secret/relicGoldens.test.ts
// Regenerated on purpose by the 0.14.0 prestige redesign, Slice 2 (rising bars): the saves now carry
// captainSinceFleet, and the fleetGain / pcGain readouts read 0 below the risen bar (the play is unchanged).
// Regenerated on purpose by Slice 5a (relic ceiling): the relic cases move by the collections re-based on the tier
// stagger and the ceiling fraction in the snapshot; relicFree did not move (the relic-free plateau is e10,000,000).
// Regenerated on purpose by Slice 4 (leveled skills): every save carries the schedule's Skill Points
// (skillPoints, skillPointsEarned) and the gates opened (skillsOpened); the states that own the 0.13.11.2
// stat skills (past the finale, after a Prestigeception) play them as leveled skills scaled by the prestige
// counts (ten bonus, Overdrive, Head Start), so their runs and readouts move. The early and mid readouts
// (no stat skill) are unchanged.
// Then the combined pacing retune and its fix round: the states whose window holds a Prestigeception move
// (Auto Prestigeception now fires the instant its bar is reached, paying exactly the bar's Dream Points, and
// the retuned CP_K, PC_BAR_RATIO, skills and SOFT_SCALE); the early states without one do not.
// The Slice 5a retune (user 2026-10-29): the relic-free captures move with the 0.13.11 goldens (CP_K, pay at the bar,
// PC_BAR_RATIO 2, SOFT_SCALE 63), and the four Tier I levers' perCopy x6.5 move the typical and heavy boosts and states.
// Slice 7 review (the Automation tab's NEW marker): the six past-finale saves, whose window grants Auto Skill
// Allocation, end with "automationsNew":true; nothing else in any capture moved.
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { serializeSecret, type SecretState } from "./state";
import { advanceTo } from "./catchUp";
import { captainGain, fleetGain, prestigeceptionGain, tierMultiplier, overclockMultiplier, tenBonusFactor, prestigeMultiplier, augmentMultiplier, captainMultiplier } from "./engine";
import { TIER_COUNT } from "./config";
import { earlyManualState, midAutoState, pastFinaleState, postPrestigeceptionState, live } from "./testStates";
import { typicalBoosts, heavyBoosts } from "./relicCollections";

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

// R2-10 relic states (added with the relic boosts, after relicFree was captured): a typical and a heavy
// collection's snapshot on fixed states, stepped live and caught up, plus the readouts.
function relicCases(): Record<string, string> {
  const mid = midAutoState();
  const past = pastFinaleState();
  const out: Record<string, string> = {};
  for (const [name, boosts] of [["typical", typicalBoosts()], ["heavy", heavyBoosts()]] as const) {
    const m = { ...mid, relicBoosts: boosts };
    const p = { ...past, relicBoosts: boosts };
    out[`${name}Boosts`] = JSON.stringify(boosts);
    out[`${name}MidLive1h`] = serializeSecret(live(m, 3600));
    out[`${name}MidCoarse2d`] = serializeSecret(advanceTo(m, m.lastTickAt + 2 * 86400 * 1000).state);
    out[`${name}PastFinaleLive1h`] = serializeSecret(live(p, 3600));
    out[`${name}PastFinaleCoarse1d`] = serializeSecret(advanceTo(p, p.lastTickAt + 86400 * 1000).state);
    out[`${name}ReadMid`] = readouts(m);
    out[`${name}ReadPastFinale`] = readouts(p);
  }
  return out;
}

const writing = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GOLDEN_WRITE === "1";

type Goldens = { relicFree: Record<string, string>; relic: Record<string, string> };

// The goldens on disk (empty before the first capture).
function prior(): Partial<Goldens> {
  try {
    return JSON.parse(readFileSync(PATH, "utf-8")) as Partial<Goldens>;
  } catch {
    return {};
  }
}

describe("R2-10 goldens", () => {
  it("a minigame with no relics is byte-identical to the engine before relic boosts", () => {
    const now = relicFreeCases();
    if (writing) writeFileSync(PATH, JSON.stringify({ ...prior(), relicFree: now }, null, 1) + "\n");
    const golden = (JSON.parse(readFileSync(PATH, "utf-8")) as Goldens).relicFree;
    expect(Object.keys(golden).sort()).toEqual(Object.keys(now).sort());
    for (const k of Object.keys(golden)) expect(now[k], k).toBe(golden[k]);
  }, 400000);

  it("a typical and a heavy relic collection's minigame states are pinned", () => {
    const now = relicCases();
    if (writing) writeFileSync(PATH, JSON.stringify({ ...prior(), relic: now }, null, 1) + "\n");
    const golden = (JSON.parse(readFileSync(PATH, "utf-8")) as Goldens).relic;
    expect(Object.keys(golden).sort()).toEqual(Object.keys(now).sort());
    for (const k of Object.keys(golden)) expect(now[k], k).toBe(golden[k]);
  }, 400000);
});
