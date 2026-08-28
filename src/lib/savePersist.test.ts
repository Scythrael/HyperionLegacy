// savePersist.test.ts: locks the cross-component bridge contract behind the
// "your save did not persist" warning (src/lib/savePersist.ts).
//
// This covers the PURE, DOM-free half of the safeguard: the savePersistFailed
// store and the live-save exporter registration/invocation. The DOM-dependent
// half (doSave capturing the write boolean, the banner raising/clearing, and
// downloadLiveSave serializing live state past a blocked store) is exercised
// end-to-end in a live browser during QA, not here, since it needs a mounted
// component + a real Storage that can be made to throw.
//
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { savePersistFailed, registerLiveSaveExporter, exportLiveSaveNow } from "./savePersist";

describe("savePersist bridge", () => {
  it("savePersistFailed starts false (a fresh session is assumed to persist fine)", () => {
    expect(get(savePersistFailed)).toBe(false);
  });

  it("savePersistFailed round-trips true then false (doSave's only writes to it)", () => {
    savePersistFailed.set(true);
    expect(get(savePersistFailed)).toBe(true);
    savePersistFailed.set(false);
    expect(get(savePersistFailed)).toBe(false);
  });

  // MUST run before the registration case below: liveExporter is a module singleton
  // with no unregister, so this asserts the pre-registration no-op while it is still
  // null (vitest runs a file's tests in definition order).
  it("exportLiveSaveNow is a safe no-op returning false before any exporter is registered", () => {
    expect(exportLiveSaveNow()).toBe(false);
  });

  it("exportLiveSaveNow invokes the registered exporter and forwards its boolean result", () => {
    let calls = 0;
    registerLiveSaveExporter(() => {
      calls++;
      return true;
    });
    expect(exportLiveSaveNow()).toBe(true);
    expect(calls).toBe(1);

    // A re-register replaces the exporter (last registration wins), and a false
    // result (a serialize failure in the real downloadLiveSave) is forwarded as-is.
    registerLiveSaveExporter(() => false);
    expect(exportLiveSaveNow()).toBe(false);
  });
});
