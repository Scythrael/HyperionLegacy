// tabGuard.ts: ONE game tab at a time (HOTFIX 0.13.11.5, ledger PF-3, user 2026-11-20).
//
// THE BUG. Every game tab autosaved its own in-memory state (every 30 s and on unload) to the one localStorage
// save, with no cross-tab check, so the last writer won: an old tab left open silently overwrote a newer tab's
// progress, and Export Save (which copies the stored save) could even hand out the other tab's game.
//
// THE RULE (user, verbatim): "If you open a new tab, the old one should die in a way that doesn't lose you
// experience." So the NEWEST tab wins:
//   1. A game tab starting up CLAIMS the game before it loads the save. If another tab holds a FRESH owner mark,
//      it asks that tab to hand over and waits briefly (HANDOFF_WAIT_MS) for the answer.
//   2. The owner, on a claim, saves ONE last time (while it still owns the save, so the new tab loads its latest
//      progress), retires for good (no ticking, no saving), and answers "handed over" with a fingerprint of that
//      last save. The new tab waits (briefly) until it can see that very save, then marks itself the owner and loads.
//   3. A frozen or crashed old tab never answers; the new tab claims after the wait anyway, loading the old tab's
//      last save (every player action already saves at once, and time-based progress is caught up on load, so
//      nothing earned is lost). The owner mark carries a heartbeat (refreshed on every save), so a mark left by a
//      closed or discarded tab goes stale and the next tab does not wait at all.
//   4. BEFORE EVERY WRITE a tab checks the owner mark (mayWrite). A retired tab, or an old tab waking from a freeze
//      after the takeover, can therefore never write over the owner's save again; it retires instead.
//   5. A tab still running an OLDER build (no guard) cannot be stopped by new code. The owner notices its writes
//      (the storage event on the save), re-saves its own progress at once, and asks the player to close that tab.
//
// One login in one place across devices is the 0.14.1 account version of the same rule (roadmap).
// No GameState or simulation code is touched here, so determinism is unaffected.

import { safeGetItem, safeSetItem, safeRemoveItem } from "./safeStorage";

export const TAB_OWNER_KEY = "fleet_admiral_tab_owner";
export const TAB_CHANNEL_NAME = "fleet_admiral_tabs";
// The main save's key (save.ts SAVE_KEY; a test pins the two together). Read here only to fingerprint it.
export const GUARDED_SAVE_KEY = "fleet_admiral_save";
// How long a new tab waits for a live owner to hand over. An open, awake tab answers within milliseconds.
export const HANDOFF_WAIT_MS = 1200;
// After "handed over", how long to wait for the old tab's last save to become visible here (storage and the channel
// are separate pipes, so their order is not guaranteed).
export const SAVE_VISIBLE_WAIT_MS = 600;
export const SAVE_VISIBLE_POLL_MS = 25;
// An owner mark not refreshed for this long belongs to a tab that is gone, frozen or discarded: claim without waiting.
// The owner refreshes it on every save (autosave every 30 s; a throttled background tab still saves about once a
// minute), so a live owner's mark is never this old.
export const STALE_MARK_MS = 3 * 60 * 1000;
// Right after taking over, the old tab's last save can still arrive here (the storage event is asynchronous). Writes
// seen in this window are the handover itself, not an older build, so they raise no warning.
export const FOREIGN_WRITE_GRACE_MS = 3000;

export type TabMessage = { t: "claim"; id: string; since: number } | { t: "handedOver"; to: string; save: string | null };

export interface OwnerMark {
  id: string;
  since: number; // when this tab started its claim: the NEWER claim wins (ties broken by id)
  at: number; // when the owner last refreshed the mark (wall clock; only compared with this device's own clock)
}

// True when claim (aSince, aId) is newer than (bSince, bId): the newest tab wins, ties settled by id.
export function newerClaim(aSince: number, aId: string, bSince: number, bId: string): boolean {
  return aSince > bSince || (aSince === bSince && aId > bId);
}

export interface TabGuardDeps {
  readOwner(): OwnerMark | null;
  writeOwner(mark: OwnerMark): void;
  clearOwner(): void;
  // A short fingerprint of the stored main save (null: none), to tell when the old tab's last save is visible.
  readSaveFingerprint(): string | null;
  // null: no cross-tab channel in this browser (the owner mark and the write check still protect the save).
  channel: { post(msg: TabMessage): void; listen(cb: (msg: TabMessage) => void): void; close(): void } | null;
  // Fires when ANOTHER tab changes the owner mark (the browser "storage" event). Returns an unsubscribe.
  onOwnerChanged(cb: () => void): () => void;
  // Fires when ANOTHER tab writes the main save. Returns an unsubscribe.
  onSaveWritten(cb: () => void): () => void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId(): string;
}

export interface TabGuardHooks {
  // Write this tab's current progress now (the last save before handing over).
  flushSave(): void;
  // Stop this tab for good: no loop, no saving, and show the "moved to your newest tab" window.
  retire(): void;
  // A tab without the guard (an older build) wrote the save while this tab owns the game: re-save and warn.
  foreignWrite(): void;
}

export interface TabGuard {
  readonly id: string;
  // Resolves once this tab owns the game (immediately when no other live tab holds it).
  claim(): Promise<void>;
  // True when this tab may write the save: it owns it, or nobody does (storage blocked or cleared).
  mayWrite(): boolean;
  retired(): boolean;
  // The owner refreshes its mark (called after each save), so the mark never looks stale while this tab lives.
  heartbeat(): void;
  // App retired this tab itself (a refused write): keep the guard's own state in step, without calling retire again.
  noteRetired(): void;
  // Page unload: give the mark back (only if it is still ours), so a reload of this same tab never waits.
  release(): void;
  dispose(): void;
}

export function createTabGuard(deps: TabGuardDeps, hooks: TabGuardHooks): TabGuard {
  const id = deps.newId();
  let owner = false; // this tab has claimed the game
  let isRetired = false;
  let waiting: { done: () => void; timer: unknown } | null = null;
  let disposed = false;
  let ownedSince = 0;
  let since = 0; // this tab's claim time (set when claim() starts)

  const markIsLive = (m: OwnerMark | null): m is OwnerMark => m !== null && deps.now() - m.at < STALE_MARK_MS;

  const retire = (): void => {
    if (isRetired) return;
    isRetired = true;
    owner = false;
    hooks.retire();
  };

  // Resolve the claim once the given save fingerprint is visible here (or after a short bound).
  const finishWhenSaveVisible = (fingerprint: string | null): void => {
    if (!waiting) return;
    deps.clearTimer(waiting.timer);
    const done = waiting.done;
    waiting = null;
    if (fingerprint === null || deps.readSaveFingerprint() === fingerprint) {
      done();
      return;
    }
    let waited = 0;
    const poll = (): void => {
      if (disposed) return;
      waited += SAVE_VISIBLE_POLL_MS;
      if (deps.readSaveFingerprint() === fingerprint || waited >= SAVE_VISIBLE_WAIT_MS) done();
      else deps.setTimer(poll, SAVE_VISIBLE_POLL_MS);
    };
    deps.setTimer(poll, SAVE_VISIBLE_POLL_MS);
  };

  deps.channel?.listen((msg) => {
    if (msg.t === "claim" && msg.id !== id) {
      // Only an owner hands over, and only to a NEWER claim. Two tabs claiming together both briefly own the game;
      // the older one hands over to the newer, the newer ignores the older (see newerClaim).
      if (!owner || isRetired) return;
      if (!newerClaim(msg.since, msg.id, since, id)) return;
      hooks.flushSave(); // still the owner here, so this last save goes through
      const fingerprint = deps.readSaveFingerprint();
      retire();
      deps.channel?.post({ t: "handedOver", to: msg.id, save: fingerprint });
    } else if (msg.t === "handedOver" && msg.to === id) {
      finishWhenSaveVisible(msg.save);
    }
  });

  const unsubscribeOwner = deps.onOwnerChanged(() => {
    // Re-read the mark rather than trusting the event's value. A NEWER claim's mark retires this tab; an OLDER one
    // (two tabs claimed together and the older write landed last) is overwritten again, so every tab converges on
    // the newest claim.
    if (!owner || isRetired) return;
    const current = deps.readOwner();
    if (current === null || current.id === id) return;
    if (newerClaim(current.since, current.id, since, id)) retire();
    else deps.writeOwner({ id, since, at: deps.now() });
  });

  const unsubscribeSave = deps.onSaveWritten(() => {
    if (!owner || isRetired) return;
    if (deps.now() - ownedSince < FOREIGN_WRITE_GRACE_MS) return; // the handover's own last save, arriving late
    const current = deps.readOwner();
    if (current !== null && current.id !== id) return; // another guarded tab is mid-claim; the mark settles it
    hooks.foreignWrite(); // the mark is still ours: a tab without the guard (an older build) wrote
  });

  const take = (): void => {
    if (isRetired || disposed) return;
    deps.writeOwner({ id, since, at: deps.now() });
    owner = true;
    ownedSince = deps.now();
  };

  return {
    id,
    claim(): Promise<void> {
      return new Promise<void>((resolve) => {
        const current = deps.readOwner();
        // Always newer than any mark this tab can see, so a device clock set backward cannot make it look older.
        since = Math.max(deps.now(), current !== null ? current.since + 1 : 0);
        // Ask any live owner to hand over (even a stale-looking one may just be throttled; it still saves and stops).
        deps.channel?.post({ t: "claim", id, since });
        if (!markIsLive(current) || current.id === id || deps.channel === null) {
          // Nobody live holds it (the usual reload: the last tab gave the mark back on unload), or there is no
          // channel to ask over. Claim at once; a tab still running sees the new mark and retires.
          take();
          resolve();
          return;
        }
        waiting = {
          done: () => {
            take();
            resolve();
          },
          timer: deps.setTimer(() => finishWhenSaveVisible(null), HANDOFF_WAIT_MS),
        };
      });
    },
    mayWrite(): boolean {
      if (isRetired) return false;
      const current = deps.readOwner();
      return current === null || current.id === id;
    },
    retired: () => isRetired,
    heartbeat(): void {
      if (!owner || isRetired) return;
      const current = deps.readOwner();
      if (current === null || current.id === id) deps.writeOwner({ id, since, at: deps.now() });
    },
    noteRetired(): void {
      isRetired = true;
      owner = false;
    },
    release(): void {
      if (deps.readOwner()?.id === id) deps.clearOwner();
    },
    dispose(): void {
      disposed = true;
      if (waiting) deps.clearTimer(waiting.timer);
      waiting = null;
      unsubscribeOwner();
      unsubscribeSave();
      deps.channel?.close();
    },
  };
}

// The mark as stored: "id|since|at". Anything else (a damaged value) reads as no mark.
export function parseOwnerMark(raw: string | null): OwnerMark | null {
  if (raw === null) return null;
  const parts = raw.split("|");
  if (parts.length < 3) return null;
  const at = Number(parts.pop());
  const since = Number(parts.pop());
  const id = parts.join("|");
  return id !== "" && Number.isFinite(at) && Number.isFinite(since) ? { id, since, at } : null;
}

export function saveFingerprint(raw: string | null): string | null {
  return raw === null ? null : `${raw.length}:${raw.slice(-32)}`;
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
  const onStorageKey = (key: string, cb: () => void): (() => void) => {
    const handler = (e: StorageEvent) => {
      if (e.key === key) cb();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  };
  const guard = createTabGuard(
    {
      readOwner: () => parseOwnerMark(safeGetItem(TAB_OWNER_KEY)),
      writeOwner: (m) => void safeSetItem(TAB_OWNER_KEY, `${m.id}|${m.since}|${m.at}`),
      clearOwner: () => safeRemoveItem(TAB_OWNER_KEY),
      readSaveFingerprint: () => saveFingerprint(safeGetItem(GUARDED_SAVE_KEY)),
      channel: bc
        ? {
            post: (msg) => bc!.postMessage(msg),
            listen: (cb) => {
              bc!.onmessage = (e: MessageEvent) => cb(e.data as TabMessage);
            },
            close: () => bc!.close(),
          }
        : null,
      onOwnerChanged: (cb) => onStorageKey(TAB_OWNER_KEY, cb),
      onSaveWritten: (cb) => onStorageKey(GUARDED_SAVE_KEY, cb),
      now: () => Date.now(),
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

// For every other writer of this game's saves (the secret game's save, the trusted clock): true unless another tab
// owns the game. No guard running (tests, the landing page): writes are allowed, exactly as before.
export function tabMayWrite(): boolean {
  return active ? active.mayWrite() : true;
}
