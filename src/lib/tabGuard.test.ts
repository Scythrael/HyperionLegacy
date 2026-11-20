import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createTabGuard, HANDOFF_WAIT_MS, type TabGuardDeps, type TabMessage } from "./tabGuard";

// HOTFIX 0.13.11.5 (ledger PF-3): two open game tabs overwrote each other's save. These tests drive several
// guards through ONE shared fake store and channel, the way real tabs share localStorage and a BroadcastChannel.

interface World {
  owner: string | null;
  storageBlocked: boolean;
  listeners: Map<string, (msg: TabMessage) => void>;
  ownerWatchers: Map<string, (v: string | null) => void>;
  frozen: Set<string>;
}

function world(): World {
  return { owner: null, storageBlocked: false, listeners: new Map(), ownerWatchers: new Map(), frozen: new Set() };
}

let seq = 0;
function tab(w: World, opts: { channel?: boolean } = {}) {
  const id = `tab${++seq}`;
  const log: string[] = [];
  const deliver = (fn: () => void) => queueMicrotask(fn); // channels and storage events are asynchronous
  const deps: TabGuardDeps = {
    readOwner: () => (w.storageBlocked ? null : w.owner),
    writeOwner: (v) => {
      if (w.storageBlocked) return;
      w.owner = v;
      for (const [other, cb] of w.ownerWatchers) if (other !== id && !w.frozen.has(other)) deliver(() => cb(v));
    },
    clearOwner: () => {
      if (w.storageBlocked) return;
      w.owner = null;
      for (const [other, cb] of w.ownerWatchers) if (other !== id && !w.frozen.has(other)) deliver(() => cb(null));
    },
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
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: () => id,
  };
  let guardRef: ReturnType<typeof createTabGuard> | null = null;
  const guard = createTabGuard(deps, {
    flushSave: () => log.push(`flush(mayWrite=${guardRef!.mayWrite()})`),
    retire: () => log.push("retire"),
  });
  guardRef = guard;
  return { id, guard, log };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("tabGuard (PF-3: one game tab at a time, the newest wins)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a lone tab claims at once and may write", async () => {
    const w = world();
    const a = tab(w);
    let done = false;
    void a.guard.claim().then(() => (done = true));
    await settle();
    expect(done).toBe(true);
    expect(w.owner).toBe(a.id);
    expect(a.guard.mayWrite()).toBe(true);
  });

  it("a new tab takes over: the old one saves while it still owns the game, THEN retires, then hands over", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    const b = tab(w);
    let bDone = false;
    void b.guard.claim().then(() => (bDone = true));
    await settle();
    expect(a.log).toEqual(["flush(mayWrite=true)", "retire"]); // the last save went through, then it stopped
    expect(bDone).toBe(true); // answered: no waiting out the timeout
    expect(w.owner).toBe(b.id);
    expect(a.guard.mayWrite()).toBe(false); // the old tab can never write over the new one again
    expect(b.guard.mayWrite()).toBe(true);
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
    vi.advanceTimersByTime(HANDOFF_WAIT_MS);
    await settle();
    expect(bDone).toBe(true);
    expect(w.owner).toBe(b.id);
    w.frozen.delete(a.id);
    expect(a.guard.mayWrite()).toBe(false); // its next autosave is refused (App then retires it)
    expect(a.log).toEqual([]); // it never flushed: the takeover happened while it slept
  });

  it("two tabs opened together end with exactly one owner", async () => {
    const w = world();
    const a = tab(w);
    const b = tab(w);
    void a.guard.claim();
    void b.guard.claim();
    await settle();
    const owners = [a, b].filter((t) => t.guard.mayWrite());
    expect(owners).toHaveLength(1);
    const loser = owners[0] === a ? b : a;
    expect(loser.log).toContain("retire");
  });

  it("a third tab takes over from the second, the first stays retired", async () => {
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
    expect(w.owner).toBeNull();
    const a2 = tab(w);
    let done = false;
    void a2.guard.claim().then(() => (done = true));
    await settle();
    expect(done).toBe(true);
  });

  it("release never removes another tab's mark", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    const b = tab(w);
    await b.guard.claim();
    a.guard.release(); // the user closes the retired old tab
    expect(w.owner).toBe(b.id);
  });

  it("without a channel (an old browser) the owner mark alone still stops the old tab", async () => {
    const w = world();
    const a = tab(w, { channel: false });
    await a.guard.claim();
    const b = tab(w, { channel: false });
    await b.guard.claim();
    await settle();
    expect(a.log).toEqual(["retire"]); // saw the newer mark (storage event); no flush possible without a channel
    expect(a.guard.mayWrite()).toBe(false);
    expect(b.guard.mayWrite()).toBe(true);
  });

  it("storage blocked (private mode): claims at once and writes are allowed, as before the fix", async () => {
    const w = world();
    w.storageBlocked = true;
    const a = tab(w);
    await a.guard.claim();
    expect(a.guard.mayWrite()).toBe(true);
  });

  it("a page restored from the back-forward cache retires if another tab owns the game, else takes it back", async () => {
    const w = world();
    const a = tab(w);
    await a.guard.claim();
    a.guard.release(); // left the page
    const b = tab(w);
    await b.guard.claim();
    a.guard.resumed();
    expect(a.log).toContain("retire");
    const c = tab(w);
    await c.guard.claim();
    c.guard.release();
    c.guard.resumed(); // nobody holds it: c takes it back
    expect(w.owner).toBe(c.id);
  });
});

describe("App wiring (source anchors)", () => {
  const app = readFileSync("src/App.svelte", "utf8");
  it("claims the tab before the save loads, and boots the game only once claimed", () => {
    const claimAt = app.indexOf("void tabGuard.claim().then(");
    const bootDef = app.indexOf("const bootGame = (): (() => void) => {");
    const loadAt = app.indexOf("const loadedSave = loadFromLocalStorage();");
    expect(claimAt).toBeGreaterThan(0);
    expect(bootDef).toBeGreaterThan(0);
    expect(loadAt).toBeGreaterThan(bootDef); // the load lives inside bootGame
    expect(app).toContain("gameCleanup = bootGame();");
  });
  it("every save write checks the owner first, and an outranked tab retires instead of writing", () => {
    expect(app).toMatch(/function writeSave\([^)]*\) \{\s*\n\s*\/\/[^\n]*\n\s*if \(!tabMayWrite\(\)\) \{\s*retireThisTab\(\);\s*return;\s*\}/);
  });
  it("Export Save writes the current progress first, so the file is this tab's latest game", () => {
    expect(app).toMatch(/function doExportSave\(\) \{[\s\S]{0,400}doSave\(\);\s*downloadRawSave\(\);/);
  });
  it("the secret game's save is guarded the same way", () => {
    const rt = readFileSync("src/lib/secret/runtime.ts", "utf8");
    expect(rt).toMatch(/if \(readOnly \|\| !tabMayWrite\(\)\) return;/);
  });
});
