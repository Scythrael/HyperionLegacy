// ============================================================================
// safeStorage.ts: a single guarded wrapper around window.localStorage.
//
// WHY THIS EXISTS. Every touch of `localStorage` can throw, and not only on
// setItem:
//   - In browsers where the user has BLOCKED site data (Chrome "block third
//     party cookies + site data", some enterprise / privacy configs), merely
//     READING the `window.localStorage` property throws a SecurityError. A bare
//     `localStorage.getItem(...)` at module load or component mount then crashes
//     the view before it can render (e.g. CombatView's top-level preference
//     loaders ran at mount and took the whole panel down).
//   - In Safari Private Browsing, `localStorage` is present and readable but
//     `setItem` throws QuotaExceededError on the FIRST write, so an Options
//     toggle that persists a preference threw on click.
//
// POSTURE. A blocked or full store should degrade to "no persistence", never a
// crash: reads return null (so each caller falls back to its documented default)
// and writes silently no-op. This is the wrapped-storage posture the preference
// modules' own header comments already claim to follow; this module makes it real
// and shared instead of re-implemented per file.
//
// SCOPE. Presentation preferences (theme, tick bar, combat log, salvage/refine
// confirms) AND save.ts's own localStorage accessors route through here. For the
// preferences a failed read simply yields the default; for the save file a failed
// read means "no save found" (start fresh) and a failed write means "ran but did
// not persist" (saveToLocalStorage already reports that via its boolean return).
//
// The try/catch wraps the localStorage ACCESS ITSELF (not just the method call),
// because in the blocked-site-data case it is the property access that throws.
// This also makes the module safe under SSR / the node test runner where
// `localStorage` is simply undefined (a ReferenceError is caught the same way).
//
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
// ============================================================================

// Read a key. Returns the stored string, or null when the key is absent OR the
// store is unreachable (blocked site data, SSR, a throwing accessor). Callers
// treat null as "not set" and fall back to their own default, so a blocked store
// is indistinguishable from an empty one, which is exactly the graceful outcome.
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Blocked site data throws on the property access or the call; a wiped/foreign
    // store simply has no value. Either way there is nothing to return.
    return null;
  }
}

// Write a key. Returns true when the value was persisted, false when the store
// rejected it (blocked site data, a full/quota-exceeded store, SSR). The boolean
// lets a caller that cares (save.ts's saveToLocalStorage) surface "did not persist"
// while a preference setter can simply ignore it (best-effort persistence).
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // QuotaExceeded (Safari private mode, or a genuinely full store) and blocked
    // site data both land here. The value is not persisted; the caller decides
    // whether that matters.
    return false;
  }
}

// Remove a key. Best-effort: a store that cannot be reached had nothing to remove
// from the caller's point of view, so a failure is a silent no-op.
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do: an unreachable store holds no value to clear.
  }
}
