// Completion tracking (0.14.0; docs/plans/2026-11-13-completion-tracking-design.md, the user's mockup answers): the rule,
// the three tallies, the records (best % kept, abandoned), the Systems rows, and the save round trip.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { CompletionBodyTally, Expedition, GameState, SystemRecord } from "./model";
import {
  bodiesToRoll,
  heldCompletionTally,
  planetRollTokens,
  withAbandonRecord,
  recordCompletion,
  regionCompletionTally,
  runCompletion,
  runCompletionTally,
  systemCompletion,
  systemRows,
  visitedCompletion,
  withSystemRecord,
} from "./completion";
import { withNotableEvents, systemCompletedEvent, relicSetCompletedEvent, notableEventsOf } from "./notableEvents";
import { advanceExpedition, claimExpedition, editGroundOps, heldSystems } from "./expedition";
import { CT_FAR, ctClaimed, ctDispatch, ctRecalled } from "./completionTracking.fixture";
import { deserialize, migrate, serialize } from "./save";

const body = (scanned: boolean, objectives = 0, done = 0, skipped = 0): CompletionBodyTally => ({ scanned, objectives, done, skipped });

describe("the rule: each body an equal share (user Q1 B)", () => {
  it("the mockup's OR-9359 table, column B, start to finish (never dips)", () => {
    const steps = [
      { bodies: [body(false), body(false), body(false)], pct: 0 },
      { bodies: [body(true, 3), body(false), body(false)], pct: 17 },
      { bodies: [body(true, 3, 3), body(false), body(false)], pct: 33 },
      { bodies: [body(true, 3, 3), body(true, 2), body(false)], pct: 50 },
      { bodies: [body(true, 3, 3), body(true, 2, 2), body(true, 1)], pct: 83 },
      { bodies: [body(true, 3, 3), body(true, 2, 2), body(true, 1, 1)], pct: 100 },
    ];
    let last = -1;
    for (const s of steps) {
      const c = systemCompletion({ bodies: s.bodies, nebula: null });
      expect(c.percent).toBe(s.pct);
      expect(c.percent).toBeGreaterThanOrEqual(last);
      last = c.percent;
    }
    const end = systemCompletion({ bodies: steps[5].bodies, nebula: null });
    expect(end).toMatchObject({ bodies: 3, bodiesScanned: 3, objectives: 6, objectivesDone: 6, complete: true });
  });

  it("the drawn console line: Bodies 2/3 · Objectives 3/5", () => {
    const c = systemCompletion({ bodies: [body(true, 3, 3), body(true, 2), body(false)], nebula: null });
    expect([c.bodiesScanned, c.bodies, c.objectivesDone, c.objectives, c.percent]).toEqual([2, 3, 3, 5, 50]);
    expect(c.bodyLines.map((b) => b.percent)).toEqual([100, 50, 0]);
  });

  it("a body with no objectives is whole once scanned; a half scan counts nothing", () => {
    expect(systemCompletion({ bodies: [body(true)], nebula: null })).toMatchObject({ percent: 100, complete: true });
    expect(systemCompletion({ bodies: [body(false)], nebula: null })).toMatchObject({ percent: 0, complete: false });
  });

  it("skipped objectives count as done (user Q3 B), and are counted apart", () => {
    const c = systemCompletion({ bodies: [body(true, 6, 4, 2)], nebula: null });
    expect(c).toMatchObject({ percent: 100, complete: true, objectivesDone: 4, objectivesSkipped: 2, objectives: 6 });
  });

  it("the nebula sweep is one objective of the system, an equal share (user Q4 A)", () => {
    const open = systemCompletion({ bodies: [body(true, 1, 1)], nebula: { done: false } });
    expect(open).toMatchObject({ percent: 50, complete: false, objectives: 2, objectivesDone: 1 });
    expect(systemCompletion({ bodies: [body(true, 1, 1)], nebula: { done: true } })).toMatchObject({ percent: 100, complete: true });
  });

  it("never 100 short of complete (99 at most)", () => {
    const c = systemCompletion({ bodies: Array.from({ length: 199 }, () => body(true)).concat([body(true, 2, 1)]), nebula: null });
    expect(c.complete).toBe(false);
    expect(c.percent).toBe(99);
  });
});

describe("the three tallies agree", () => {
  it("a study body: its ship study is its objective (user Q4 A)", () => {
    const exp = {
      bodies: [{ scanned: true, planetType: "gasGiant", activities: [] }],
      study: 1,
      nebula: undefined,
      groundOps: { studyLegs: [] },
    } as unknown as Expedition;
    expect(runCompletionTally(exp).bodies[0]).toEqual(body(true, 1, 0, 0));
    const studied = { ...exp, groundOps: { studyLegs: [{ kind: "study", bodyIndex: 0, scanBodyIndex: null, startsAt: 0, endsAt: 1, done: true }] } } as unknown as Expedition;
    expect(runCompletion(studied)).toMatchObject({ percent: 100, complete: true });
  });

  it("a held Resume system reads the same as the run it came from, and its record the same again", () => {
    const r = ctRecalled(0x1001);
    const recalled = r.recalled.expeditions[0];
    const held = heldSystems(r.recalled).find((h) => h.kind === "resume")!;
    const live = runCompletion(recalled);
    const kept = systemCompletion(heldCompletionTally(held));
    // The held record keeps the charted bodies; objectives in progress go back to the queue but keep their counts.
    expect([kept.bodies, kept.bodiesScanned, kept.objectives, kept.objectivesDone, kept.percent]).toEqual([live.bodies, live.bodiesScanned, live.objectives, live.objectivesDone, live.percent]);
    const rec = Object.values(r.abandoned.systemRecords!)[0];
    expect(recordCompletion(rec).percent).toBe(kept.percent);
    expect(rec).toMatchObject({ systemId: held.systemId, systemName: held.systemName, tier: held.region.tier, abandoned: true });
    expect(rec.region).toEqual(held.region);
  });

  it("a real skip: the claimed run is still 100%, with the skip counted", { timeout: 120_000 }, () => {
    const { next, exp } = ctDispatch(0x5005);
    let t = exp.phaseAnchorSeconds;
    let e = exp;
    while (!e.bodies.some((b) => b.activities.some((a) => a.status === "queued"))) {
      t += 300;
      e = advanceExpedition(exp, t);
    }
    const task = e.bodies.flatMap((b) => b.activities).find((a) => a.status === "queued")!;
    const edited = editGroundOps({ ...next, gameTimeSeconds: t, expeditions: [e] }, exp.id, { kind: "skip", taskId: task.id });
    const done = advanceExpedition(edited.expeditions[0], CT_FAR);
    expect(done.phase).toBe("complete");
    const c = runCompletion(done);
    expect(c).toMatchObject({ percent: 100, complete: true, objectivesSkipped: 1 });
    const claimed = claimExpedition({ ...edited, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done.id).next;
    expect(notableEventsOf(claimed).map((x) => x.kind)).toEqual(["systemCompleted"]);
    expect(Object.values(claimed.systemRecords!)[0].bodies.reduce((n, b) => n + b.skipped, 0)).toBe(1);
  });
});

describe("records: one row per system, best % kept (user Q2 B)", () => {
  const rec = (pct: "low" | "full", abandoned = false, at = 0): SystemRecord => ({
    version: 1,
    systemId: "LB-0042",
    systemName: "LB-0042",
    tier: 1,
    at,
    fromExpeditionId: `expedition-${at}`,
    bodies: pct === "full" ? [body(true, 1, 1)] : [body(true, 2, 0), body(false)],
    ...(abandoned ? { abandoned: true as const } : {}),
  });
  it("a better visit replaces, a worse one is dropped (the SAME object)", () => {
    const a = withSystemRecord(undefined, rec("low", true, 1));
    const b = withSystemRecord(a, rec("full", false, 2));
    expect(b["LB-0042"].at).toBe(2);
    expect(withSystemRecord(b, rec("low", true, 3))).toBe(b);
  });
  it("an equal % from a visit that was not abandoned replaces an abandoned one, never the reverse", () => {
    const a = withSystemRecord(undefined, rec("low", true, 1));
    expect(withSystemRecord(a, rec("low", false, 2))["LB-0042"].abandoned).toBeUndefined();
    const c = withSystemRecord(undefined, rec("low", false, 1));
    expect(withSystemRecord(c, rec("low", true, 2))).toBe(c);
  });
  it("records are kept in canonical key order", () => {
    let m = withSystemRecord(undefined, { ...rec("full"), systemId: "SA-0002" });
    m = withSystemRecord(m, { ...rec("full"), systemId: "LB-0001" });
    expect(Object.keys(m)).toEqual(["LB-0001", "SA-0002"]);
  });
});

describe("the planet roll (user 2026-11-13 \"Planet roll + system badge\"): once per body, ever", () => {
  const rec = (bodies: CompletionBodyTally[], at: number, bodiesRolled?: number[], abandoned = false): SystemRecord => ({
    version: 1,
    systemId: "LB-0042",
    systemName: "LB-0042",
    tier: 1,
    at,
    fromExpeditionId: `expedition-${at}`,
    bodies,
    ...(abandoned ? { abandoned: true as const } : {}),
    ...(bodiesRolled ? { bodiesRolled } : {}),
  });
  it("bodiesToRoll: the bodies at 100% the record has not paid", () => {
    const t = { bodies: [body(true, 1, 1), body(true, 2, 1), body(true, 0), body(false)], nebula: { done: false } };
    expect(bodiesToRoll(t, undefined)).toEqual([0, 2]);
    expect(bodiesToRoll(t, { bodiesRolled: [0] })).toEqual([2]);
    expect(bodiesToRoll(t, { bodiesRolled: [0, 2] })).toEqual([]);
    // A skipped objective counts as done (Q3 B), so its body pays too.
    expect(bodiesToRoll({ bodies: [body(true, 2, 1, 1)], nebula: null }, undefined)).toEqual([0]);
  });
  it("the paid bodies survive a better visit replacing the record AND a worse visit that is dropped", () => {
    const a = withSystemRecord(undefined, rec([body(true, 1, 1), body(false)], 1, undefined, true), [0]);
    expect(a["LB-0042"].bodiesRolled).toEqual([0]);
    // A better visit replaces the counts and keeps body 0 paid, adding body 1.
    const b = withSystemRecord(a, rec([body(true, 1, 0), body(true, 1, 1)], 2), [1]);
    expect(b["LB-0042"].at).toBe(2);
    expect(b["LB-0042"].bodiesRolled).toEqual([0, 1]);
    // A worse visit whose counts are dropped still records a roll it paid (kept record, at unchanged).
    const c = withSystemRecord(undefined, rec([body(true, 1, 1), body(true, 1, 1), body(false)], 1, [0, 1]));
    const d = withSystemRecord(c, rec([body(false), body(false), body(true, 0)], 2), [2]);
    expect(d["LB-0042"].at).toBe(1);
    expect(d["LB-0042"].bodiesRolled).toEqual([0, 1, 2]);
    // Nothing new: the SAME object.
    expect(withSystemRecord(d, rec([body(false), body(false), body(false)], 3))).toBe(d);
  });
  it("a claim pays a body once, an abandon of the same system later pays only what is new", { timeout: 120_000 }, () => {
    const r = ctRecalled(0x1001, "bodyDone");
    const held = heldSystems(r.claimed).find((h) => h.kind === "resume")!;
    // The abandon paid body 0; abandoning a second Resume copy of that system pays nothing more.
    const again = withAbandonRecord(r.abandoned, held, r.abandoned.gameTimeSeconds + 5);
    expect(again.relicVault).toEqual(r.abandoned.relicVault);
    expect(Object.values(again.systemRecords!)[0].bodiesRolled).toEqual([0]);
  });
  it("planetRollTokens is the relics engine's hook (one blank per body), with the planet's name", () => {
    const { exp } = ctDispatch(0x3003);
    const t = planetRollTokens(exp, [1]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: `${exp.id}-relic-complete-${exp.bodies[1].id}`, source: "completion", regionTier: 1, planet: `${exp.systemName} c` });
  });
});

describe("the Systems rows", () => {
  it("a run under way, then its claim: one row, the record's", { timeout: 120_000 }, () => {
    const { next, exp } = ctDispatch(0x2002);
    const out = { ...next, expeditions: [advanceExpedition(exp, exp.phaseAnchorSeconds + 1)] } as GameState;
    const rows = systemRows(out);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ systemId: exp.targetSystemId, state: "underWay", tier: 1 });
    const claimed = ctClaimed(0x2002);
    const after = systemRows(claimed);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ state: null, completion: { percent: 100, complete: true } });
    expect(visitedCompletion(claimed, exp.targetSystemId)?.complete).toBe(true);
    expect(visitedCompletion(claimed, "nowhere")).toBeNull();
    expect(regionCompletionTally(after).get(1)).toEqual({ charted: 1, completed: 1 });
  });
  it("a Resume system is listed In Resume; abandoned, its row stays marked", { timeout: 120_000 }, () => {
    const r = ctRecalled(0x3003);
    const held = systemRows(r.claimed);
    expect(held).toHaveLength(1);
    expect(held[0].state).toBe("inResume");
    const gone = systemRows(r.abandoned);
    expect(gone).toHaveLength(1);
    expect(gone[0].state).toBe("abandoned");
    expect(gone[0].completion.percent).toBe(held[0].completion.percent);
  });
  it("a recalled run flying home lists its held system once", () => {
    const r = ctRecalled(0x4004);
    expect(systemRows(r.recalled)).toHaveLength(1);
    expect(systemRows(r.recalled)[0].state).toBe("inResume");
  });
});

describe("the hidden ledger (notableEvents)", () => {
  it("each event once by its key, in order", () => {
    const a = systemCompletedEvent({ systemId: "s1", systemName: "S 1", tier: 2 }, 10);
    const b = relicSetCompletedEvent("exc-t1-a", 1, 20);
    const l = withNotableEvents(undefined, [a, b, a])!;
    expect(l.map((e) => e.key)).toEqual(["systemCompleted:s1", "relicSetCompleted:exc-t1-a"]);
    expect(withNotableEvents(l, [b])).toBe(l);
  });
  // User "Hidden until chat (Recommended)": the ledger is written, and nothing in play or on screen reads it. Every
  // source file that names the field is one of its writers (or the type, the load cleanup, or a test): completion.ts
  // (a system completed, at its claim), tick.ts (a relic set completed, by the relic study that completed it),
  // processSpeed.ts (a set an exceptional piece of a grant bundle completed), save.ts (withNotableEventsOnLoad, the
  // every-load hygiene).
  it("nothing shows or reads it: only its writers name it", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = `${dir}/${f}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (/[.](ts|svelte)$/.test(f) && !/[.](test|fixture)[.]ts$/.test(f) && !/[.]d[.]ts$/.test(f)) files.push(p);
      }
    };
    walk("src");
    const named = files.filter((f) => /notableEvents|NotableEvent/.test(readFileSync(f, "utf-8"))).sort();
    expect(named).toEqual([
      "src/lib/game/completion.ts",
      "src/lib/game/model.ts",
      "src/lib/game/notableEvents.ts",
      "src/lib/game/processSpeed.ts",
      "src/lib/game/save.ts",
      "src/lib/game/tick.ts",
    ]);
  });
});

describe("the save round trip", () => {
  it("records and the ledger survive a save and load, the % derived the same", { timeout: 120_000 }, () => {
    const s = ctRecalled(0x1001).abandoned;
    const claimed = ctClaimed(0x2002);
    const both: GameState = { ...s, systemRecords: { ...s.systemRecords, ...claimed.systemRecords }, notableEvents: claimed.notableEvents };
    const back = migrate(deserialize(serialize(both, 0))!, 0x1357bdf1);
    expect(back.systemRecords).toEqual(both.systemRecords);
    expect(back.notableEvents).toEqual(both.notableEvents);
    expect(systemRows(back).map((r) => [r.systemId, r.completion.percent, r.state])).toEqual(systemRows(both).map((r) => [r.systemId, r.completion.percent, r.state]));
  });
  it("a save without them carries no key", () => {
    const s = ctDispatch(0x1001).next;
    expect("systemRecords" in s).toBe(false);
    expect("notableEvents" in s).toBe(false);
  });
});
