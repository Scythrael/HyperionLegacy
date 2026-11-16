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

// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// FR-C R2-5 / R8-6 (the finite-work FA XP folded into lifetimeStats, the auto-salvage log stamp) came after every pin
// here: the file runs with them off (recapFoldsSwitch.fixture.ts), so its pins keep proving their own slice;
// faXpAwardedStat.test.ts and offlineRecapSections.test.ts pin the moves.
import { recapFoldsOffForThisFile } from "./recapFoldsSwitch.fixture";
recapFoldsOffForThisFile();
// FR-C lane 1 I3 (the lane join wired: startLine opens an order for a batch) came after every pin here: the file runs
// with it off (laneJoinSwitch.fixture.ts), so its pins keep proving their own slice; laneJoinWired.test.ts traces it.
import { laneJoinOffForThisFile } from "./laneJoinSwitch.fixture";
laneJoinOffForThisFile();
import Decimal from "break_infinity.js";
import { type GameState } from "./model";
import { economyTick, inspectBlanks, startLine, tick } from "./tick";
import { grant } from "./processSpeed";
import { deserialize, migrate, serialize } from "./save";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { countedLcg, craftStateQ } from "./materialQualityGoldens.fixture";
import { withoutMl5 } from "./ml5Switch.fixture";
import { ML5_ADDED_IDS, ml5ReadBack } from "./ml5Registry.fixture";
import { CATALOGS, WIRING_REGISTRY } from "./wiring/registry";
import { INSPECT_PROBE_QUALITY, readProbe } from "./wiring/probes";
import { QUALITY_TIERS } from "./inventory";
import { blankTotal } from "./qualityBlanks";

// The pre-change capture.
const ML5_GOLDEN = {
  blankBest: ["59bec629:0", "9083e26c", "6c330713"],
  blankLowest: ["d226a429:0", "9083e26c", "ff724513"],
  blankQ0: ["5d1b3747:0", "9083e26c", "1e4f88e9"],
  grant: "25565e23",
  load: "4c603b0a",
};

// Re-pinned by ML-5 (by design: each fabricate job stamps the quality it carried on its blank, the blank lands in
// that bucket, and the inspect starts the piece from it, highest quality first; the shared draw count is unchanged).
// With the slice switched off (withoutMl5) each row is ML5_GOLDEN again (asserted below).
const ML5_LIVE = {
  blankBest: ["65f6c923:0", "c068c67c", "ee7ed143"],
  blankLowest: ["d9ea4c59:0", "80817b7f", "f33b7bd0"],
};

const RIG_STOCK = { frameSegment: [0, 0, 4], polysilicateWafer: [2, 0, 4] };
const Q0_STOCK = { frameSegment: [4], polysilicateWafer: [4] };
const RUN_TICKS = 400;

interface BlankRun {
  pins: string[];
  crafted: GameState;
  qualities: number[];
}

// One run three ways off one seed: 1 s steps (economyTick, the live loop), 997 s chunks and one offline call. Each
// must hold the SAME bytes (the serialized save) and take the same draws. Returns the stepped state and its draw count.
// The chunks are tick() calls, as the relic identify queue's parity does (relicIdentify.test.ts): a fabricate line is
// a process queue, and resolveProcesses' header records that the real economy never hands economyTick more than one
// tick (a line starts its next job only after the call's ticks were counted, so a single economyTick(s, 997) starts
// one job and drops the rest of the span), so tick() in 997 s pieces is the chunked path a player who returns several
// times actually takes.
function threeWays(s0: GameState, seconds: number, seed: number): { s: GameState; draws: number } {
  expect(s0.tickDurationSeconds).toBe(1); // economyTick takes ticks: at 1 s a tick, a tick is a second
  const live = countedLcg(seed);
  let s = s0;
  for (let i = 0; i < seconds; i++) s = economyTick(s, 1, live.rng);
  const chunk = countedLcg(seed);
  let c = s0;
  for (let left = seconds; left > 0; left -= 997) c = tick(Math.min(997, left), c, chunk.rng);
  const off = countedLcg(seed);
  const o = tick(seconds, s0, off.rng);
  const bytes = serialize(s, 1, 2);
  expect(serialize(c, 1, 2)).toBe(bytes);
  expect(serialize(o, 1, 2)).toBe(bytes);
  expect(stateHash(c)).toBe(stateHash(s));
  expect(stateHash(o)).toBe(stateHash(s));
  expect(chunk.draws()).toBe(live.draws());
  expect(off.draws()).toBe(live.draws());
  return { s, draws: live.draws() };
}

// The Yield Rig line, stepped, chunked and offline off one seed (offline == live), then every blank inspected:
// pins ["<state>:<draws>", "<pieces>", "<state after inspect>"], the state before the inspect and the pieces' qualities.
// Both blanks land inside the run's one chunk (game seconds 171 and 341 of 400).
function blankRun(stock: Record<string, number[]>, best: boolean, seed: number): BlankRun {
  const started = startLine(craftStateQ(stock, ["yieldRigBp"]), "fabricate", "yieldRigBp", { kind: "batch", remaining: 2 }, best ? "best" : undefined);
  expect(started.started).toBe(true);
  const { s, draws } = threeWays(started.next, RUN_TICKS, seed);
  expect(s.fabricateLines).toHaveLength(0);
  const inspected = inspectBlanks(s, "yieldRigBp", 5);
  expect(inspected.inspected).toBe(2);
  return {
    pins: [`${stateHash(s)}:${draws}`, hash(inspected.pieces), stateHash(inspected.state)],
    crafted: s,
    qualities: inspected.pieces.map((p) => p.quality),
  };
}

const buckets = (s: GameState): string[] => (s.blanks.yieldRigBp ?? []).map((b) => b.toString());

describe("ML-5 quality blanks: goldens", () => {
  it("blankBest: a Yield Rig line on Q0 and Q2 stock, best materials first, then inspected", () => {
    const run = blankRun(RIG_STOCK, true, 0x5b1);
    expect(run.pins).toEqual(ML5_LIVE.blankBest);
    // Both jobs draw Q2 frames and Q2 wafers: two Q2 blanks, each inspected to Q2 or more.
    expect(buckets(run.crafted)).toEqual(["0", "0", "2"]);
    expect(run.qualities.every((q) => q >= 2)).toBe(true);
    expect(withoutMl5(() => blankRun(RIG_STOCK, true, 0x5b1).pins)).toEqual(ML5_GOLDEN.blankBest);
  });

  it("blankLowest: the same line, lowest first", () => {
    const run = blankRun(RIG_STOCK, false, 0x5b2);
    expect(run.pins).toEqual(ML5_LIVE.blankLowest);
    // Job 1 draws 2 Q2 frames + 2 Q0 wafers (average 1.00 = Q1), job 2 Q2 of both (Q2): one Q1 and one Q2 blank.
    // The inspect takes the Q2 blank first.
    expect(buckets(run.crafted)).toEqual(["0", "1", "1"]);
    expect(run.qualities[0]).toBeGreaterThanOrEqual(2);
    expect(run.qualities[1]).toBeGreaterThanOrEqual(1);
    expect(withoutMl5(() => blankRun(RIG_STOCK, false, 0x5b2).pins)).toEqual(ML5_GOLDEN.blankLowest);
  });

  it("blankQ0: the same line on Q0 stock (held)", () => {
    const run = blankRun(Q0_STOCK, false, 0x5b3);
    expect(run.pins).toEqual(ML5_GOLDEN.blankQ0);
    expect(buckets(run.crafted)).toEqual(["2"]);
  });

  it("parity: an 8-job line over 1,500 s, blanks landing mid-chunk in both 997 s chunks, agrees byte for byte", () => {
    // Lowest first on 2 Q0 wafers under Q2 stock: job 1 lands Q1, jobs 2 to 8 land Q2. A job completes every 170 s
    // (game seconds 171, 341, ..., 1361), so blanks land inside the first chunk (0 to 997) AND the second (997 to
    // 1,500), never on a chunk boundary.
    const stock = { frameSegment: [0, 0, 16], polysilicateWafer: [2, 0, 14] };
    const started = startLine(craftStateQ(stock, ["yieldRigBp"]), "fabricate", "yieldRigBp", { kind: "batch", remaining: 8 }, undefined);
    expect(started.started).toBe(true);
    const s0 = started.next;
    // Where each blank lands, from 1 s steps: some inside each chunk, none on its edge.
    const rng = countedLcg(0x5b4);
    const lands: number[] = [];
    let s = s0;
    for (let i = 1; i <= 1500; i++) {
      const before = blankTotal(s.blanks, "yieldRigBp");
      s = economyTick(s, 1, rng.rng);
      if (blankTotal(s.blanks, "yieldRigBp").gt(before)) lands.push(i);
    }
    expect(lands).toHaveLength(8);
    expect(lands.some((t) => t < 997)).toBe(true);
    expect(lands.some((t) => t > 997)).toBe(true);
    expect(lands.every((t) => t % 997 !== 0)).toBe(true);
    const run = threeWays(s0, 1500, 0x5b4);
    expect(stateHash(run.s)).toBe(stateHash(s));
    expect(run.s.fabricateLines).toHaveLength(0);
    expect(buckets(run.s)).toEqual(["0", "1", "7"]);
  });

  it("grant: two uninspected Yield Rigs granted (held, at Q0)", () => {
    const s = craftStateQ({}, []);
    const g = grant(s, { gear: { yieldRigBp: 2 } }, "Test");
    expect(g.granted).toBe(true);
    expect(stateHash(g.next)).toBe(ML5_GOLDEN.grant);
    expect(buckets(g.next)).toEqual(["2"]);
  });

  it("load: a save holding blanks in the old scalar shape (held, into Q0)", () => {
    const s: GameState = { ...craftStateQ({}, []), blanks: { yieldRigBp: new Decimal(3) } as unknown as GameState["blanks"] };
    const file = deserialize(serialize(s, 1, 2));
    expect(file).not.toBeNull();
    const loaded = migrate(file!, 7);
    expect(stateHash(loaded)).toBe(ML5_GOLDEN.load);
    expect(buckets(loaded)).toEqual(["3"]);
  });

  it("registry: ML-5 adds exactly its two live audit rows, and the read-back takes only those out", () => {
    const added = WIRING_REGISTRY.filter((e) => ML5_ADDED_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...ML5_ADDED_IDS].sort());
    for (const e of added) expect([e.status.kind, e.probe !== undefined], e.id).toEqual(["live", true]);
    const back = ml5ReadBack(WIRING_REGISTRY);
    expect(back).toHaveLength(WIRING_REGISTRY.length - ML5_ADDED_IDS.size);
    const live = new Map(WIRING_REGISTRY.map((e) => [e.id, e]));
    expect(back.every((e) => live.get(e.id) === e)).toBe(true);
  });

  it("registry: each row's probe moves by its magnitude (on against off)", () => {
    for (const id of ML5_ADDED_IDS) {
      const e = WIRING_REGISTRY.find((x) => x.id === id)!;
      const base = e.base();
      const on = readProbe(e.probe!, e.on(base), "craft");
      const off = readProbe(e.probe!, e.off(base), "craft");
      expect(off, id).toBeGreaterThanOrEqual(0);
      expect(on - off, id).toBe(e.magnitude(CATALOGS));
    }
    // The inspect row's move is exact only while its base roll leaves room under the Q5 cap (INSPECT_PROBE_QUALITY).
    const inspect = WIRING_REGISTRY.find((x) => x.id === "facility:audit:inspectCarriedQuality")!;
    const ib = inspect.base();
    expect(readProbe(inspect.probe!, inspect.off(ib), "craft")).toBeLessThanOrEqual(QUALITY_TIERS - 1 - INSPECT_PROBE_QUALITY);
    // And with the slice switched off, the blank row reads no move (the stamp is ML-5's).
    const carry = WIRING_REGISTRY.find((x) => x.id === "facility:audit:blankCarriedQuality")!;
    const b = carry.base();
    expect(withoutMl5(() => readProbe(carry.probe!, carry.on(b), "craft") - readProbe(carry.probe!, carry.off(b), "craft"))).toBe(0);
  });
});
