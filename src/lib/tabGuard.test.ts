import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  createTabGuard,
  parseOwnerMark,
  saveFingerprint,
  GUARDED_SAVE_KEY,
  HANDOFF_WAIT_MS,
  STALE_MARK_MS,
  FOREIGN_WRITE_GRACE_MS,
  RELEASED_MARK_PREFIX,
  type OwnerMark,
  type TabGuardDeps,
  type TabMessage,
} from "./tabGuard";
import { SAVE_KEY } from "./game/save";

// HOTFIX 0.13.11.5 (ledger PF-3): two open game tabs overwrote each other's save. These tests drive several guards
// through ONE shared fake store, channel and storage events, the way real tabs share localStorage. Deliveries are
// asynchronous (microtasks), and `deferWrites` makes the owner mark land a microtask after the write, so two tabs can
// both read "no owner" before either write is visible, as in a real browser.

interface World {
  owner: OwnerMark | null;
  save: string | null;
  storageBlocked: boolean;
  ownerWriteFails: boolean; // storage full: reads work, writing the mark throws (safeSetItem returns false)
  deferWrites: boolean;
  listeners: Map<string, (msg: TabMessage) => void>;
  ownerWatchers: Map<string, () => void>;
  saveWatchers: Map<string, () => void>;
  frozen: Set<string>;
}

function world(): World {
  return {
    owner: null,
    save: null,
    storageBlocked: false,
    ownerWriteFails: false,
    deferWrites: false,
    listeners: new Map(),
    ownerWatchers: new Map(),
    saveWatchers: new Map(),
    frozen: new Set(),
  };
}

const deliver = (fn: () => void) => queueMicrotask(fn);
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let seq = 0;
function tab(w: World, opts: { channel?: boolean; saveDelayMs?: number } = {}) {
  const id = `tab${++seq}`;
  const log: string[] = [];
  const notifyOthers = (watchers: Map<string, () => void>) => {
    for (const [other, cb] of watchers) if (other !== id && !w.frozen.has(other)) deliver(cb);
  };
  const setOwner = (m: OwnerMark | null) => {
    const apply = () => {
      w.owner = m;
      notifyOthers(w.ownerWatchers);
    };
    if (w.deferWrites) deliver(apply);
    else apply();
  };
  const deps: TabGuardDeps = {
    readOwner: () => (w.storageBlocked ? null : w.owner),
    writeOwner: (m) => {
      if (w.storageBlocked || w.ownerWriteFails) return false;
      setOwner(m);
      return true;
    },
    // A tab always reads its own write at once (localStorage is synchronous within a tab); others see it when it lands.
    readSaveFingerprint: () => saveFingerprint(mine ?? w.save),
    channel:
      opts.channel === false
        ? null
        : {
            post: (msg) => {
              for (const [other, cb] of w.listeners) if (other !== id && !w.frozen.has(other)) deliver(() => cb(msg));
            },
            listen: (cb) => void w.listeners.set(id, cb),
            close: () => void w.listeners.delete(id),
          },
    onOwnerChanged: (cb) => {
      w.ownerWatchers.set(id, cb);
      return () => void w.ownerWatchers.delete(id);
    },
    onSaveWritten: (cb) => {
      w.saveWatchers.set(id, cb);
      return () => void w.saveWatchers.delete(id);
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: () => id,
  };
  let mine: string | null = null;
  let guardRef: ReturnType<typeof createTabGuard> | null = null;
  // Writes the save the way App does: only when allowed. saveDelayMs: the write reaches the shared store late (the
  // storage pipe running behind the channel).
  const writeSave = (content: string) => {
    if (!guardRef!.mayWrite()) return false;
    mine = content;
    const land = () => {
      w.save = content;
      mine = null;
      notifyOthers(w.saveWatchers);
    };
    if (opts.saveDelayMs) setTimeout(land, opts.saveDelayMs);
    else land();
    return true;
  };
  const guard = createTabGuard(deps, {
    flushSave: () => {
      log.push(`flush(mayWrite=${guardRef!.mayWrite()})`);
      writeSave(`${id}-final`);
    },
    retire: () => log.push("retire"),
    foreignWrite: () => log.push("foreignWrite"),
  });
  guardRef = guard;
  return { id, guard, log, writeSave };
}

describe("tabGuard (PF-3: one game tab at a time, the newest wins)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("a lone tab claims at once and may write", async () => {
    const w = world();
    const a = tab(w);
    let done = false;
    void a.guard.claim().then(() => (done = true));
    await settle();
    expect(done).toBe(true);
    expect(w.owner?.id).toBe(a.id);
    expect(a.guard.mayWrite()).toBe(true);
  });

  it("a new tab takes over: the old one saves while it still owns the game, THEN retires; the new tab loads that save", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    a.writeSave("a-progress");
    const b = tab(w);
    let bDone = false;
    void b.guard.claim().then(() => (bDone = true));
    await settle();
    expect(a.log).toEqual(["flush(mayWrite=true)", "retire"]);
    expect(bDone).toBe(true); // answered: no waiting out the timeout
    expect(w.save).toBe(`${a.id}-final`); // B boots from A's very last save
    expect(w.owner?.id).toBe(b.id);
    expect(a.guard.mayWrite()).toBe(false);
    expect(a.writeSave("a-late")).toBe(false); // the old tab can never write over the new one again
    expect(b.guard.mayWrite()).toBe(true);
  });

  it("the new tab waits until the old tab's last save is visible, even when the answer arrives first", async () => {
    const w = world();
    const a = tab(w, { saveDelayMs: 100 }); // A's writes reach the shared store 100 ms late
    await a.guard.claim();
    const b = tab(w);
    let bDone = false;
    void b.guard.claim().then(() => (bDone = true));
    await settle();
    expect(a.log).toEqual(["flush(mayWrite=true)", "retire"]);
    expect(bDone).toBe(false); // "handed over" arrived, the save has not
    await vi.advanceTimersByTimeAsync(50);
    expect(bDone).toBe(false);
    await vi.advanceTimersByTimeAsync(75);
    expect(w.save).toBe(`${a.id}-final`);
    expect(bDone).toBe(true);
  });

  it("a frozen old tab never answers: the new tab claims after the wait, and the old tab, waking, cannot write", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    w.frozen.add(a.id);
    const b = tab(w);
    let bDone = false;
    void b.guard.claim().then(() => (bDone = true));
    await settle();
    expect(bDone).toBe(false);
    await vi.advanceTimersByTimeAsync(HANDOFF_WAIT_MS);
    expect(bDone).toBe(true);
    expect(w.owner?.id).toBe(b.id);
    w.frozen.delete(a.id);
    expect(a.writeSave("a-woke")).toBe(false); // App then retires it
    expect(a.log).toEqual([]);
  });

  it("a stale mark (a tab closed or discarded without unloading) costs no wait", async () => {
    const w = world();
    w.owner = { id: "ghost", since: Date.now() - STALE_MARK_MS - 5, at: Date.now() - STALE_MARK_MS - 1 };
    const b = tab(w);
    let done = false;
    void b.guard.claim().then(() => (done = true));
    await settle();
    expect(done).toBe(true);
    expect(w.owner?.id).toBe(b.id);
  });

  it("the owner's heartbeat keeps its mark live for as long as it runs", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      a.guard.heartbeat();
    }
    w.frozen.add(a.id); // ten minutes in, the tab freezes right after a save
    const b = tab(w);
    let done = false;
    void b.guard.claim().then(() => (done = true));
    await settle();
    expect(done).toBe(false); // the mark is fresh, so B waits for an answer before giving up
    await vi.advanceTimersByTimeAsync(HANDOFF_WAIT_MS);
    expect(done).toBe(true);
  });

  it("two tabs that both read 'no owner' before either write lands end with exactly one owner", async () => {
    const w = world();
    w.deferWrites = true;
    const a = tab(w);
    const b = tab(w);
    void a.guard.claim();
    void b.guard.claim();
    await settle();
    await vi.advanceTimersByTimeAsync(HANDOFF_WAIT_MS);
    const owners = [a, b].filter((t) => t.guard.mayWrite());
    expect(owners).toHaveLength(1);
    expect(owners[0].id).toBe(w.owner?.id);
    const loser = owners[0] === a ? b : a;
    expect(loser.log).toContain("retire");
    expect(owners[0].log).not.toContain("retire");
  });

  it("a third tab takes over from the second; the first stays retired", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    const b = tab(w);
    await b.guard.claim();
    const c = tab(w);
    await c.guard.claim();
    await settle();
    expect([a.guard.mayWrite(), b.guard.mayWrite(), c.guard.mayWrite()]).toEqual([false, false, true]);
    expect(a.log).toEqual(["flush(mayWrite=true)", "retire"]);
    expect(b.log).toEqual(["flush(mayWrite=true)", "retire"]);
  });

  it("a reload of the same tab never waits: unload gives the mark back, the new page claims at once", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    a.guard.release();
    expect(w.owner?.id).toBe(`${RELEASED_MARK_PREFIX}${a.id}`); // a "given back" mark, not a deleted one (PF-4)
    const a2 = tab(w);
    let done = false;
    void a2.guard.claim().then(() => (done = true));
    await settle();
    expect(done).toBe(true);
    expect(w.owner?.id).toBe(a2.id);
    expect(a2.guard.mayWrite()).toBe(true);
  });

  it("the closing tab's own last writes on the same unload still go through after release", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    a.guard.release();
    // The secret game and the trusted clock save on beforeunload AFTER App's handler released the mark.
    expect(a.guard.mayWrite()).toBe(true);
  });

  it("a page that keeps running after its unload (a cancelled navigation) takes the mark back at its next save", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    a.guard.release();
    a.writeSave("a-still-here");
    a.guard.heartbeat();
    expect(w.owner?.id).toBe(a.id);
    const b = tab(w);
    let done = false;
    void b.guard.claim().then(() => (done = true));
    await settle();
    expect(a.log).toEqual(["flush(mayWrite=true)", "retire"]); // a normal handover, nothing lost
    expect(done).toBe(true);
    expect(w.save).toBe(`${a.id}-final`);
  });

  it("a given-back mark with the same claim time competes under its tab's own id", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    // Another tab that claimed in the same millisecond with a higher id gave the game back.
    w.owner = { id: `${RELEASED_MARK_PREFIX}zz`, since: w.owner!.since, at: Date.now() };
    w.ownerWatchers.get(a.id)!();
    await settle();
    expect(a.log).toEqual(["retire"]); // "zz" outranks "tabN"; the raw "released:zz" would not
  });

  // HOTFIX 0.13.11.6 (ledger PF-4): a frozen tab woke after the newer tab had been CLOSED. Closing used to DELETE the
  // owner mark, and "no mark" allowed any write, so the woken tab wrote its older progress over the newer tab's.
  describe("PF-4: a frozen tab waking after the newer tab was closed", () => {
    const setup = async () => {
      const w = world();
      const a = tab(w);
      await a.guard.claim();
      a.writeSave("a-progress");
      w.frozen.add(a.id); // the browser freezes A in the background (phones do this routinely)
      const b = tab(w);
      void b.guard.claim();
      await settle();
      await vi.advanceTimersByTimeAsync(HANDOFF_WAIT_MS); // A never answers; B takes the game
      expect(w.owner?.id).toBe(b.id);
      const bSince = w.owner!.since;
      b.writeSave("b-progress");
      b.guard.release(); // the player closes B normally
      w.frozen.delete(a.id); // and goes back to A, which thaws
      return { w, a, b, bSince };
    };

    it("its autosave cannot write over the newer tab's progress", async () => {
      const { w, a } = await setup();
      expect(a.writeSave("a-stale")).toBe(false);
      expect(w.save).toBe("b-progress");
    });

    it("B's queued claim, delivered on waking, retires it without a write", async () => {
      const { w, a, b, bSince } = await setup();
      w.listeners.get(a.id)!({ t: "claim", id: b.id, since: bSince });
      await settle();
      expect(a.log).toEqual(["flush(mayWrite=false)", "retire"]);
      expect(w.save).toBe("b-progress");
      expect(a.guard.mayWrite()).toBe(false);
    });

    it("the queued owner-mark change, delivered on waking, retires it", async () => {
      const { w, a } = await setup();
      w.ownerWatchers.get(a.id)!();
      await settle();
      expect(a.log).toEqual(["retire"]);
      expect(a.writeSave("a-stale")).toBe(false);
      expect(w.save).toBe("b-progress");
    });

    it("the next tab opened claims at once and loads B's progress", async () => {
      const { w } = await setup();
      const c = tab(w);
      let done = false;
      void c.guard.claim().then(() => (done = true));
      await settle();
      expect(done).toBe(true); // a given-back mark costs no wait
      expect(w.owner?.id).toBe(c.id);
      expect(w.save).toBe("b-progress");
    });
  });

  it("release never removes another tab's mark", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    const b = tab(w);
    await b.guard.claim();
    a.guard.release(); // the player closes the retired old tab
    expect(w.owner?.id).toBe(b.id);
  });

  it("without a channel (an old browser) the owner mark alone still stops the old tab", async () => {
    const w = world();
    const a = tab(w, { channel: false });
    await a.guard.claim();
    const b = tab(w, { channel: false });
    await b.guard.claim();
    await settle();
    expect(a.log).toEqual(["retire"]);
    expect(a.guard.mayWrite()).toBe(false);
    expect(b.guard.mayWrite()).toBe(true);
  });

  it("FAIL OPEN: storage full, an older page's mark left behind never stops the only tab from saving", async () => {
    const w = world();
    w.owner = { id: "previous-page", since: Date.now() - 1000, at: Date.now() - 1000 }; // live-looking, nobody answers
    w.ownerWriteFails = true;
    const a = tab(w);
    let done = false;
    void a.guard.claim().then(() => (done = true));
    await settle();
    await vi.advanceTimersByTimeAsync(HANDOFF_WAIT_MS);
    expect(done).toBe(true);
    expect(w.owner?.id).toBe("previous-page"); // the browser refused our mark
    expect(a.guard.mayWrite()).toBe(true); // the guard steps aside: saving works as it did before the guard
    expect(a.writeSave("a-progress")).toBe(true);
    expect(w.save).toBe("a-progress");
    expect(a.log).toEqual([]); // never retired
  });

  it("storage full on close: the live mark stays, so a frozen older tab still cannot write", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    w.frozen.add(a.id);
    const b = tab(w);
    void b.guard.claim();
    await settle();
    await vi.advanceTimersByTimeAsync(HANDOFF_WAIT_MS);
    b.writeSave("b-progress");
    w.ownerWriteFails = true;
    b.guard.release(); // the given-back mark cannot be written; B's own mark remains
    w.frozen.delete(a.id);
    expect(w.owner?.id).toBe(b.id);
    expect(a.writeSave("a-stale")).toBe(false);
    expect(w.save).toBe("b-progress");
  });

  it("storage blocked (private mode): claims at once and writes are allowed, as before the fix", async () => {
    const w = world();
    w.storageBlocked = true;
    const a = tab(w);
    await a.guard.claim();
    expect(a.guard.mayWrite()).toBe(true);
  });

  it("a tab running an older build (no guard) writes the save: the owner hears it and calls foreignWrite", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    await vi.advanceTimersByTimeAsync(FOREIGN_WRITE_GRACE_MS);
    // An unguarded writer: it just writes the store and fires the storage event, never touching the mark.
    w.save = "legacy-tab-state";
    for (const [, cb] of w.saveWatchers) deliver(cb);
    await settle();
    expect(a.log).toEqual(["foreignWrite"]);
    expect(a.guard.mayWrite()).toBe(true); // it stays the owner and re-saves
  });

  it("the old owner's last save arriving just after a takeover is not mistaken for an older build", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    const b = tab(w);
    await b.guard.claim();
    w.save = `${a.id}-final`; // a late echo of the handover save
    for (const [, cb] of w.saveWatchers) deliver(cb);
    await settle();
    expect(b.log).toEqual([]);
  });

  it("the mark format: 'id|since|at'; anything else reads as no mark", () => {
    expect(parseOwnerMark("abc|100|123")).toEqual({ id: "abc", since: 100, at: 123 });
    expect(parseOwnerMark("a|b|100|456")).toEqual({ id: "a|b", since: 100, at: 456 });
    expect(parseOwnerMark(null)).toBeNull();
    expect(parseOwnerMark("no-bar")).toBeNull();
    expect(parseOwnerMark("abc|123")).toBeNull();
    expect(parseOwnerMark("abc|x|123")).toBeNull();
    expect(parseOwnerMark("|1|2")).toBeNull();
  });

  it("a device clock set backward cannot make the new tab look older than the owner", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z")); // a day back
    const b = tab(w);
    await b.guard.claim();
    await settle();
    expect(a.log).toEqual(["flush(mayWrite=true)", "retire"]);
    expect(w.owner?.id).toBe(b.id);
  });

  it("guards the real main save key", () => {
    expect(GUARDED_SAVE_KEY).toBe(SAVE_KEY);
  });
});

describe("App wiring (source anchors)", () => {
  const app = readFileSync("src/App.svelte", "utf8").replace(/\r\n/g, "\n");
  it("claims the tab before the save loads, and boots the game only once claimed", () => {
    const claimAt = app.indexOf("void tabGuard.claim().then(");
    const bootDef = app.indexOf("const bootGame = (): (() => void) => {");
    const loadAt = app.indexOf("const loadedSave = loadFromLocalStorage();");
    expect(claimAt).toBeGreaterThan(bootDef);
    expect(bootDef).toBeGreaterThan(0);
    expect(loadAt).toBeGreaterThan(bootDef); // the load lives inside bootGame
    expect(app).toContain("gameCleanup = bootGame();");
  });
  it("every save write checks the owner first, refreshes the mark after, and an outranked tab retires", () => {
    expect(app).toMatch(/function writeSave\([^)]*\) \{\s*\n\s*\/\/[^\n]*\n\s*if \(!tabMayWrite\(\)\) \{ retireThisTab\(\); return; \}/);
    const ws = app.slice(app.indexOf("function writeSave("));
    expect(ws.indexOf("tabGuard?.heartbeat();")).toBeGreaterThan(ws.indexOf("saveToLocalStorage("));
  });
  it("retiring stops the game, drops a catch-up window, and keeps the guard in step", () => {
    const r = app.slice(app.indexOf("function retireThisTab(): void {"), app.indexOf("function retireThisTab(): void {") + 900);
    expect(r).toContain("suppressSave = true;");
    expect(r).toContain("catchUpView = null;");
    expect(r).toContain("tabGuard?.noteRetired();");
    expect(r).toContain("gameCleanup?.();");
  });
  it("a page restored from the back-forward cache reloads instead of resuming old in-memory progress", () => {
    expect(app).toMatch(/if \(e\.persisted\) window\.location\.reload\(\);/);
  });
  it("Export Save writes the current progress first", () => {
    expect(app).toMatch(/function doExportSave\(\) \{[\s\S]{0,500}doSave\(\);\s*downloadRawSave\(\);/);
  });
  it("the secret game's save and the trusted clock are guarded the same way", () => {
    expect(readFileSync("src/lib/secret/runtime.ts", "utf8")).toMatch(/if \(readOnly \|\| !tabMayWrite\(\)\) return;/);
    expect(readFileSync("src/lib/trustedTime.ts", "utf8")).toMatch(/if \(!initialized \|\| !tabMayWrite\(\)\) return;/);
  });
  it("the overlay covers the unloaded game completely while claiming", () => {
    const ov = readFileSync("src/lib/TabHandoffOverlay.svelte", "utf8");
    expect(ov).toContain('class:th-opaque={mode === "claiming"}');
  });
});
