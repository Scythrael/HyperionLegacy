// tabGuard.ts: ONE game tab at a time (HOTFIX 0.13.11.5, ledger PF-3, user 2026-11-20).
//
// THE BUG. Every game tab autosaved its own in-memory state (every 30 s and on unload) to the one localStorage
// save, with no cross-tab check, so the last writer won: an old tab left open silently overwrote a newer tab's
// progress, and Export Save (which copies the stored save) could even hand out the other tab's game.
//
// THE RULE (user, verbatim): "If you open a new tab, the old one should die in a way that doesn't lose you
// experience." So the NEWEST tab wins:
//   1. A game tab starting up CLAIMS the game before it loads the save. If another tab owns it (the owner mark
//      below), it asks that tab to hand over and waits briefly (HANDOFF_WAIT_MS) for the answer.
//   2. The owner, on a claim, saves ONE last time (while it still owns the save, so the new tab loads its latest
//      progress), retires for good (no ticking, no saving), and answers "handed over".
//   3. The new tab then marks itself the owner and loads. A frozen or crashed old tab never answers; the new tab
//      claims after the wait anyway, loading the old tab's last save (every player action already saves at once,
//      and time-based progress is caught up on load, so nothing earned is lost).
//   4. BEFORE EVERY WRITE a tab checks the owner mark (mayWrite). A retired tab, or an old tab waking from a
//      freeze after the takeover, can therefore never write over the owner's save again; it retires instead.
//
// One login in one place across devices is the 0.14.1 account version of the same rule (roadmap).
// Display-only seam: nothing here touches GameState or the simulation, so determinism is unaffected.

import { safeGetItem, safeSetItem, safeRemoveItem } from "./safeStorage";

export const TAB_OWNER_KEY = "fleet_admiral_tab_owner";
export const TAB_CHANNEL_NAME = "fleet_admiral_tabs";
// How long a new tab waits for a live owner to hand over. A tab that is open and awake answers within
// milliseconds; this only bounds the wait for a frozen or crashed one.
export const HANDOFF_WAIT_MS = 1200;

export type TabMessage = { t: "claim"; id: string } | { t: "handedOver"; to: string };

export interface TabGuardDeps {
  readOwner(): string | null;
  writeOwner(id: string): void;
  clearOwner(): void;
  // null: no cross-tab channel in this browser (the owner mark and the write check still protect the save).
  channel: { post(msg: TabMessage): void; listen(cb: (msg: TabMessage) => void): void; close(): void } | null;
  // Fires when ANOTHER tab changes the owner mark (the browser "storage" event). Returns an unsubscribe.
  onOwnerChanged(cb: (newOwner: string | null) => void): () => void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId(): string;
}

export interface TabGuardHooks {
  // Write this tab's current progress now (the last save before handing over).
  flushSave(): void;
  // Stop this tab for good: no loop, no saving, and show the "moved to your newest tab" window.
  retire(): void;
}

export interface TabGuard {
  readonly id: string;
  // Resolves once this tab owns the game (immediately when no other tab holds it).
  claim(): Promise<void>;
  // True when this tab may write the save: it owns it, or nobody does (storage blocked or cleared).
  mayWrite(): boolean;
  retired(): boolean;
  // Page unload: give the mark back (only if it is still ours), so a reload of this same tab never waits.
  release(): void;
  // A page restored from the back-forward cache: take the game back if nobody holds it, else retire.
  resumed(): void;
  dispose(): void;
}

export function createTabGuard(deps: TabGuardDeps, hooks: TabGuardHooks): TabGuard {
  const id = deps.newId();
  let owner = false; // this tab has claimed the game and loaded it
  let isRetired = false;
  let waiting: { done: () => void; timer: unknown } | null = null;

  const retire = (): void => {
    if (isRetired) return;
    isRetired = true;
    owner = false;
    hooks.retire();
  };

  const finishClaim = (): void => {
    if (!waiting) return;
    deps.clearTimer(waiting.timer);
    const done = waiting.done;
    waiting = null;
    done();
  };

  deps.channel?.listen((msg) => {
    if (msg.t === "claim" && msg.id !== id) {
      // Only a tab that owns the game hands it over. A tab still claiming (two tabs opened together) ignores
      // the other's claim; the owner mark settles it (the later mark wins, the earlier tab sees it and retires).
      if (!owner || isRetired) return;
      hooks.flushSave(); // still the owner here, so this last save goes through
      retire();
      deps.channel?.post({ t: "handedOver", to: msg.id });
    } else if (msg.t === "handedOver" && msg.to === id) {
      finishClaim();
    }
  });

  const unsubscribe = deps.onOwnerChanged((newOwner) => {
    // Another tab marked itself the owner after this one: the newest tab wins.
    if (owner && newOwner !== null && newOwner !== id) retire();
  });

  return {
    id,
    claim(): Promise<void> {
      return new Promise<void>((resolve) => {
        const take = (): void => {
          if (!isRetired) {
            deps.writeOwner(id);
            owner = true;
          }
          resolve();
        };
        const current = deps.readOwner();
        if (current === null || current === id || deps.channel === null) {
          // Nobody holds it (the usual reload: the last tab gave the mark back on unload), or there is no
          // channel to ask over. Claim at once; an old tab still running sees the new mark and retires.
          take();
          return;
        }
        waiting = { done: take, timer: deps.setTimer(() => finishClaim(), HANDOFF_WAIT_MS) };
        deps.channel.post({ t: "claim", id });
      });
    },
    mayWrite(): boolean {
      if (isRetired) return false;
      const current = deps.readOwner();
      return current === null || current === id;
    },
    retired: () => isRetired,
    release(): void {
      if (deps.readOwner() === id) deps.clearOwner();
    },
    resumed(): void {
      if (isRetired) return;
      const current = deps.readOwner();
      if (current === null) {
        deps.writeOwner(id);
        owner = true;
      } else if (current !== id) {
        retire();
      }
    },
    dispose(): void {
      if (waiting) deps.clearTimer(waiting.timer);
      waiting = null;
      unsubscribe();
      deps.channel?.close();
    },
  };
}

// The guard App.svelte runs, wired to the real browser (localStorage, BroadcastChannel, the storage event).
let active: TabGuard | null = null;

export function startBrowserTabGuard(hooks: TabGuardHooks): TabGuard {
  active?.dispose();
  let bc: BroadcastChannel | null = null;
  try {
    bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(TAB_CHANNEL_NAME) : null;
  } catch {
    bc = null;
  }
  const guard = createTabGuard(
    {
      readOwner: () => safeGetItem(TAB_OWNER_KEY),
      writeOwner: (id) => void safeSetItem(TAB_OWNER_KEY, id),
      clearOwner: () => safeRemoveItem(TAB_OWNER_KEY),
      channel: bc
        ? {
            post: (msg) => bc!.postMessage(msg),
            listen: (cb) => {
              bc!.onmessage = (e: MessageEvent) => cb(e.data as TabMessage);
            },
            close: () => bc!.close(),
          }
        : null,
      onOwnerChanged: (cb) => {
        const onStorage = (e: StorageEvent) => {
          if (e.key === TAB_OWNER_KEY) cb(e.newValue);
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      newId: () =>
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    },
    hooks,
  );
  active = guard;
  return guard;
}

// For every other writer of this game's saves (the secret game's own save): true unless another tab owns the
// game. No guard running (tests, the landing page): writes are allowed, exactly as before.
export function tabMayWrite(): boolean {
  return active ? active.mayWrite() : true;
}
