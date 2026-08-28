// ============================================================================
// savePersist.ts: the cross-component bridge for the "your save did not persist"
// warning.
//
// WHY THIS EXISTS. The failure is DETECTED deep inside App.svelte (its doSave
// calls saveToLocalStorage, which returns false on a blocked or full store), but
// the WARNING is rendered by SavePersistWarning.svelte, which is mounted up in
// Root.svelte as a sibling of App (so it can share the app-shell flex column and
// push the app down instead of overlaying it, exactly like UpdateBanner). Sibling
// components cannot pass state to each other directly, so a tiny shared module
// carries it, mirroring how updateDetector's `updateAvailable` store feeds
// UpdateBanner.
//
// TWO pieces cross the boundary:
//   1. savePersistFailed : a boolean store the banner subscribes to. True while the
//      most recent save write FAILED; back to false the moment a write succeeds
//      again (the store recovered). App.svelte owns the writes to it.
//   2. a registered LIVE-SAVE exporter : the banner's "Export save" button must
//      download the player's CURRENT in-memory progress, but the live GameState
//      lives in App.svelte, not here and not in the banner. App registers a closure
//      over its state (via registerLiveSaveExporter) on mount; the banner invokes it
//      (via exportLiveSaveNow) on click. This keeps the big reactive GameState OUT
//      of the store (no per-tick churn) while still giving the banner a way to reach
//      the live bytes.
//
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
// ============================================================================
import { writable } from "svelte/store";

// The banner's single source of truth. Starts false (a fresh session is assumed to
// be persisting fine until a write actually fails). App.svelte's doSave is the ONLY
// writer: it sets true on a failed write and false on the next successful one.
export const savePersistFailed = writable(false);

// The registered live-state exporter, or null until App.svelte registers one on
// mount. Module-scoped singleton: there is exactly one running App and one banner,
// so an instance/class would add ceremony for no benefit (same posture as
// updateDetector's module singletons).
let liveExporter: (() => boolean) | null = null;

// App.svelte calls this once on mount with a closure that serializes and downloads
// its CURRENT state (see save.ts downloadLiveSave). The closure reads App's reactive
// `state` at CALL time, so a click minutes later still exports the latest progress.
export function registerLiveSaveExporter(exporter: () => boolean): void {
  liveExporter = exporter;
}

// The banner's "Export save" handler. Invokes the registered exporter and returns
// its success boolean. Returns false if no exporter is registered yet, which cannot
// happen in practice (the banner only shows AFTER a failed save, which is AFTER App
// has mounted and registered), but is defended so a stray early call is a safe no-op
// rather than a crash.
export function exportLiveSaveNow(): boolean {
  return liveExporter ? liveExporter() : false;
}
