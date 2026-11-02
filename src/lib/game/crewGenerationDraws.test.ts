// Complement and Acquisition CP-0 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-0 and CP-1
// "Determinism"): the complement generator's DRAW COUNT per crewmember, captured before any complement engine edit.
// CP-1 removes craft duplicate from the exclusive pick, which may change WHICH exclusive buff a pick names but never
// how many draws a crewmember takes (section 0: "A removed catalog entry may change WHICH item one existing draw
// picks, never the draw count"). So across CP-1 the "draws" and "masked" goldens below stay identical, and only
// "signatures" (the full rolled signatures, buff2 included) may move.
//
// The count comes from a passthrough wrapper around makeRng (combat/rng.ts) that tallies every Rng call. Each Rng
// method is exactly one generator step (nextInt, nextRange and chance each take one next()), so calls == steps. The
// wrapper returns the real values, so every roll is unchanged; it lives in its own file so no other golden runs under
// the mock.

import { describe, expect, it, vi } from "vitest";

const tally = { calls: 0 };

vi.mock("./combat/rng", async (importOriginal) => {
  const real = await importOriginal<typeof import("./combat/rng")>();
  return {
    ...real,
    makeRng: (seed: number) => {
      const rng = real.makeRng(seed);
      return {
        next: () => {
          tally.calls += 1;
          return rng.next();
        },
        nextInt: (n: number) => {
          tally.calls += 1;
          return rng.nextInt(n);
        },
        nextRange: (a: number, b: number) => {
          tally.calls += 1;
          return rng.nextRange(a, b);
        },
        chance: (num: number, den: number) => {
          tally.calls += 1;
          return rng.chance(num, den);
        },
      };
    },
  };
});

import { generateComplementCrew } from "./crewGeneration";
import { SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { buffCountForRank } from "./crewRank";
import type { CrewSignature } from "./model";
import { withWr9Off } from "./wr9Switch.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const EXCLUSIVE_IDS = new Set(SECOND_LEVEL_EXCLUSIVE.map((b) => b.id));
const N = 10_000;
const SEED = 0x7ea5e;

function rollAll(): { sigs: CrewSignature[]; draws: number[] } {
  const sigs: CrewSignature[] = [];
  const draws: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const before = tally.calls;
    sigs.push(generateComplementCrew(SEED, i));
    draws.push(tally.calls - before);
  }
  return { sigs, draws };
}

// Captured before any complement engine edit (CP-0, on top of e304b94). CP-1 (D14) re-pinned "signatures" only (CP-0:
// "9f4d5086"): exclusive picks now name one of the three rollable buffs; "draws" and "masked" are the CP-0 capture.
const GOLDEN = {
  draws: "2b306f83",
  masked: "667724a1",
  signatures: "3c974ab5",
};

// Wiring WR-9 (OC-E12, user 2026-10-15 "Roll a third buff"): a 3-buff rank takes ONE more draw, its third buff, drawn
// LAST, so every earlier draw of every crewmember is unchanged. With WR-9 off the CP-0 / CP-1 capture above reproduces
// exactly; live, the three pins move by the third buff alone (WR9_GOLDEN).
const WR9_GOLDEN = {
  draws: "4d8fc39c",
  masked: "3ee805aa",
  signatures: "bb916c40",
};

function pins(sigs: CrewSignature[], draws: number[]) {
  const masked = sigs.map((sig) => ({ ...sig, buff2Id: sig.buff2Id !== null && EXCLUSIVE_IDS.has(sig.buff2Id) ? "exclusive" : sig.buff2Id }));
  return { draws: fnv(JSON.stringify(draws)), masked: fnv(JSON.stringify(masked)), signatures: fnv(JSON.stringify(sigs)) };
}

describe("CP-0 complement generator draws: one fixed draw count per crewmember", () => {
  it("the draw count per crewmember, the signatures with the exclusive pick masked, and the full signatures match the capture", () => {
    const { sigs, draws } = rollAll();
    // Every crewmember takes profession, rarity, rank, race and buff1 (5 draws), one more for a 2-buff rank, and two
    // more (the exclusive chance, and since WR-9 the third buff) for a 3-buff rank: a function of the rank alone.
    sigs.forEach((sig, i) => {
      const count = buffCountForRank(sig.rank);
      expect(draws[i]).toBe(5 + (count >= 2 ? 1 : 0) + (count >= 3 ? 2 : 0));
    });
    // The pin is not vacuous: some crewmembers drew an exclusive buff.
    expect(sigs.some((sig) => sig.buff2Id !== null && EXCLUSIVE_IDS.has(sig.buff2Id))).toBe(true);
    expect(pins(sigs, draws)).toEqual(WR9_GOLDEN);
  });

  it("with WR-9 off, the CP-0 / CP-1 capture reproduces (one draw fewer per 3-buff rank, no third buff)", () => {
    const { sigs, draws } = withWr9Off(rollAll);
    sigs.forEach((sig, i) => {
      const count = buffCountForRank(sig.rank);
      expect(draws[i]).toBe(5 + (count >= 2 ? 1 : 0) + (count >= 3 ? 1 : 0));
    });
    expect(pins(sigs, draws)).toEqual(GOLDEN);
    // and the live roll is the same crew with a third buff added
    const live = rollAll().sigs;
    expect(live.map(({ buff3Id: _b3, ...rest }) => rest)).toEqual(sigs);
  });
});
