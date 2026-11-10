// Material Lines ML-5 Quality blanks (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md "ML-5 Quality blanks
// (call L7 a)"): the plan's tests. Counts preserved into quality 0; a quality-g blank inspects to g or more; inspect
// takes the highest quality first, deterministically; reload parity; a job in flight from before the slice lands Q0.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState, type TimedProcess } from "./model";
import { inspectBlank, inspectBlanks, resolveProcesses, startProcess } from "./tick";
import { deserialize, migrate, serialize } from "./save";
import { blankTotal, depositBlanks, highestBlankQuality, takeBlank } from "./qualityBlanks";
import { craftStateQ } from "./materialQualityGoldens.fixture";

const D = (n: number) => new Decimal(n);
const show = (b: Decimal[] | undefined) => (b ?? []).map((x) => x.toString());
const KEY = "yieldRigBp";

function holding(buckets: number[]): GameState {
  let blanks = {};
  buckets.forEach((n, q) => {
    if (n > 0) blanks = depositBlanks(blanks, KEY, n, q);
  });
  return { ...freshState(), blanks };
}

describe("qualityBlanks.ts helpers", () => {
  it("deposits into the quality's bucket, growing lazily; totals every bucket", () => {
    let b = depositBlanks({}, KEY, 2);
    expect(show(b[KEY])).toEqual(["2"]);
    b = depositBlanks(b, KEY, D(1), 3);
    expect(show(b[KEY])).toEqual(["2", "0", "0", "1"]);
    expect(blankTotal(b, KEY).toString()).toBe("3");
    expect(blankTotal(b, "absent").toString()).toBe("0");
    // A quality outside Q0 to Q5 (a hand-edited stamp) is clamped, never a hole.
    expect(show(depositBlanks({}, KEY, 1, 9)[KEY])).toEqual(["0", "0", "0", "0", "0", "1"]);
    expect(show(depositBlanks({}, KEY, 1, -2)[KEY])).toEqual(["1"]);
  });

  it("takes from the highest held quality; trims empty top buckets; drops an empty key", () => {
    const b = depositBlanks(depositBlanks({}, KEY, 1, 0), KEY, 1, 4);
    expect(highestBlankQuality(b, KEY)).toBe(4);
    const one = takeBlank(b, KEY, 4);
    expect(show(one[KEY])).toEqual(["1"]);
    expect(highestBlankQuality(one, KEY)).toBe(0);
    const none = takeBlank(one, KEY, 0);
    expect(KEY in none).toBe(false);
    expect(highestBlankQuality(none, KEY)).toBeNull();
    expect(b[KEY].length).toBe(5); // pure: the input store is untouched
  });
});

describe("ML-5 engine", () => {
  it("a fabricate job stamps its carried quality on the blank; the blank lands in that bucket", () => {
    const s0 = craftStateQ({ frameSegment: [0, 0, 0, 2], polysilicateWafer: [0, 0, 0, 2] }, [KEY]);
    const r = startProcess(s0, "fabricateJob", { frameSegment: D(2), polysilicateWafer: D(2) }, 1, { type: "addBlank", blueprintKey: KEY });
    expect(r.started).toBe(true);
    const job = r.next.activeProcesses[r.next.activeProcesses.length - 1];
    expect(job.effect).toEqual({ type: "addBlank", blueprintKey: KEY, inputQuality: 3 });
    const done = resolveProcesses(r.next, 1, () => 0.5).next;
    expect(show(done.blanks[KEY])).toEqual(["0", "0", "0", "1"]);
  });

  it("a job on Q0 stock stamps nothing (the pre-ML-5 job shape)", () => {
    const s0 = craftStateQ({ frameSegment: [2], polysilicateWafer: [2] }, [KEY]);
    const r = startProcess(s0, "fabricateJob", { frameSegment: D(2), polysilicateWafer: D(2) }, 1, { type: "addBlank", blueprintKey: KEY });
    expect(r.next.activeProcesses[r.next.activeProcesses.length - 1].effect).toEqual({ type: "addBlank", blueprintKey: KEY });
  });

  it("a blank job already in flight (no stamp) completes at Q0", () => {
    const inFlight: TimedProcess = { id: "proc-900", kind: "fabricateJob", remainingTicks: 1, durationTicks: 1, effect: { type: "addBlank", blueprintKey: KEY } };
    const s = { ...holding([0, 0, 1]), activeProcesses: [inFlight] };
    const done = resolveProcesses(s, 1, () => 0.5).next;
    expect(show(done.blanks[KEY])).toEqual(["1", "0", "1"]);
  });

  it("a quality-g blank inspects to g or more, for every g", () => {
    for (let g = 0; g <= 5; g++) {
      for (let seed = 0; seed < 20; seed++) {
        const s = { ...holding([0, 0, 0, 0, 0, 0].map((_, q) => (q === g ? 1 : 0))), inspectSeed: seed };
        const after = inspectBlank(s, KEY);
        const piece = after.equipment[after.equipment.length - 1];
        expect(piece.quality, `g ${g} seed ${seed}`).toBeGreaterThanOrEqual(g);
        expect(piece.quality).toBeLessThanOrEqual(5);
        expect(KEY in after.blanks).toBe(false);
      }
    }
  });

  it("inspect takes the highest quality first, one by one, deterministically", () => {
    const s = holding([2, 1, 0, 1]);
    const { state, inspected, pieces } = inspectBlanks(s, KEY, 4);
    expect(inspected).toBe(4);
    expect(pieces[0].quality).toBeGreaterThanOrEqual(3);
    expect(pieces[1].quality).toBeGreaterThanOrEqual(1);
    expect(KEY in state.blanks).toBe(false);
    // Step by step: Q3, then Q1, then the two Q0.
    let t = s;
    const left: string[][] = [];
    for (let i = 0; i < 4; i++) {
      t = inspectBlank(t, KEY);
      left.push(show(t.blanks[KEY]));
    }
    expect(left).toEqual([["2", "1"], ["2"], ["1"], []]);
    // The same save inspects to the same pieces every time.
    expect(inspectBlanks(s, KEY, 4).pieces).toEqual(pieces);
  });

  it("the carry adds to the same seeded roll (same draws): a Q2 blank is the Q0 piece two qualities up", () => {
    const q0 = inspectBlank({ ...holding([1]), inspectSeed: 7 }, KEY);
    const q2 = inspectBlank({ ...holding([0, 0, 1]), inspectSeed: 7 }, KEY);
    const a = q0.equipment[q0.equipment.length - 1];
    const b = q2.equipment[q2.equipment.length - 1];
    expect(b.quality).toBe(Math.min(5, a.quality + 2));
    expect(b.rarity).toBe(a.rarity);
    expect(b.iLevel).toBe(a.iLevel);
    expect(q2.inspectSeed).toBe(q0.inspectSeed);
  });

  it("reload before inspect re-rolls the same piece (the buckets round-trip through the save)", () => {
    const s = { ...holding([1, 0, 2]), inspectSeed: 41 };
    const loaded = migrate(deserialize(serialize(s, 1, 2))!, 3);
    expect(show(loaded.blanks[KEY])).toEqual(["1", "0", "2"]);
    expect(inspectBlank(loaded, KEY).equipment.at(-1)).toEqual(inspectBlank(s, KEY).equipment.at(-1));
  });

  it("an old save's flat blank counts load into Q0, count for count", () => {
    const old = { ...freshState(), blanks: { [KEY]: D(5), sprintDriveBp: D(1) } } as unknown as GameState;
    const loaded = migrate(deserialize(serialize(old, 1, 2))!, 3);
    expect(show(loaded.blanks[KEY])).toEqual(["5"]);
    expect(show(loaded.blanks.sprintDriveBp)).toEqual(["1"]);
    expect(blankTotal(loaded.blanks, KEY).toString()).toBe("5");
    // Loading twice changes nothing more (idempotent).
    const again = migrate(deserialize(serialize(loaded, 1, 2))!, 3);
    expect(show(again.blanks[KEY])).toEqual(["5"]);
  });
});
