// ML-5 Quality blanks (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md "ML-5 Quality blanks (call
// L7 a)"; USER ANSWERS 2026-10-19 "L7 crafted gear inherits quality: Yes, gear too"): golden hashes captured on
// feat/crew-0.14.0 (5339682) BEFORE the slice touches the engine (the ML-0 / CP-0 pattern). Each capture is the whole
// state (stateHash) plus the number of draws the run took from the SHARED injected rng.
//
//   blankBest   : a Yield Rig fabricate line (batch 2, "Use best materials") on Q0 and Q2 stock, through completion,
//                 stepped and as one offline tick() span, then both blanks inspected (inspectBlanks).
//   blankLowest : the same on the default lowest-first order.
//   blankQ0     : the same line on Q0 stock only. Must HOLD (a Q0 blank is quality 0, the old blank).
//   grant       : a gear grant (processSpeed.ts grant: two uninspected Yield Rigs). Must HOLD.
//   load        : a save holding 3 Yield Rig blanks in the old scalar shape, loaded. Must HOLD (into quality 0).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type GameState } from "./model";
import { economyTick, inspectBlanks, startLine, tick } from "./tick";
import { grant } from "./processSpeed";
import { deserialize, migrate, serialize } from "./save";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { countedLcg, craftStateQ } from "./materialQualityGoldens.fixture";

const ML5_GOLDEN = {
  blankBest: ["59bec629:0", "9083e26c", "6c330713"],
  blankLowest: ["d226a429:0", "9083e26c", "ff724513"],
  blankQ0: ["5d1b3747:0", "9083e26c", "1e4f88e9"],
  grant: "25565e23",
  load: "4c603b0a",
};

const RIG_STOCK = { frameSegment: [0, 0, 4], polysilicateWafer: [2, 0, 4] };
const Q0_STOCK = { frameSegment: [4], polysilicateWafer: [4] };
const RUN_TICKS = 400;

// The Yield Rig line, stepped and offline off one seed (offline == live), then every blank inspected:
// ["<state>:<draws>", "<pieces>", "<state after inspect>"].
function blankRun(stock: Record<string, number[]>, best: boolean, seed: number): string[] {
  const started = startLine(craftStateQ(stock, ["yieldRigBp"]), "fabricate", "yieldRigBp", { kind: "batch", remaining: 2 }, best ? "best" : undefined);
  expect(started.started).toBe(true);
  const s0 = started.next;
  const live = countedLcg(seed);
  let s = s0;
  for (let i = 0; i < RUN_TICKS; i++) s = economyTick(s, 1, live.rng);
  const off = countedLcg(seed);
  const o = tick(RUN_TICKS * s0.tickDurationSeconds, s0, off.rng);
  expect(stateHash(o)).toBe(stateHash(s));
  expect(off.draws()).toBe(live.draws());
  expect(s.fabricateLines).toHaveLength(0);
  const inspected = inspectBlanks(s, "yieldRigBp", 5);
  expect(inspected.inspected).toBe(2);
  return [`${stateHash(s)}:${live.draws()}`, hash(inspected.pieces), stateHash(inspected.state)];
}

describe("ML-5 quality blanks: pre-change goldens", () => {
  it("blankBest: a Yield Rig line on Q0 and Q2 stock, best materials first, then inspected", () => {
    expect(blankRun(RIG_STOCK, true, 0x5b1)).toEqual(ML5_GOLDEN.blankBest);
  });

  it("blankLowest: the same line, lowest first", () => {
    expect(blankRun(RIG_STOCK, false, 0x5b2)).toEqual(ML5_GOLDEN.blankLowest);
  });

  it("blankQ0: the same line on Q0 stock", () => {
    expect(blankRun(Q0_STOCK, false, 0x5b3)).toEqual(ML5_GOLDEN.blankQ0);
  });

  it("grant: two uninspected Yield Rigs granted", () => {
    const s = craftStateQ({}, []);
    const g = grant(s, { gear: { yieldRigBp: 2 } }, "Test");
    expect(g.granted).toBe(true);
    expect(stateHash(g.next)).toBe(ML5_GOLDEN.grant);
  });

  it("load: a save holding blanks in the old scalar shape", () => {
    const s: GameState = { ...craftStateQ({}, []), blanks: { yieldRigBp: new Decimal(3) } as unknown as GameState["blanks"] };
    const file = deserialize(serialize(s, 1, 2));
    expect(file).not.toBeNull();
    expect(stateHash(migrate(file!, 7))).toBe(ML5_GOLDEN.load);
  });
});
