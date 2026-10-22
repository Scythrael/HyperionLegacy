// testStorage.ts: localStorage shims for the secret game's tests (node has no localStorage).
// Imported only by *.test.ts files.

let hadLocalStorage = false;
let previous: unknown;

export function installMemoryStorage(): Map<string, string> {
  const data = new Map<string, string>();
  hadLocalStorage = "localStorage" in globalThis;
  previous = (globalThis as Record<string, unknown>).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
    },
  });
  return data;
}

export function installBlockedStorage(): void {
  hadLocalStorage = "localStorage" in globalThis;
  previous = (globalThis as Record<string, unknown>).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: access to localStorage is blocked");
    },
  });
}

export function restoreStorage(): void {
  if (hadLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: previous });
  } else {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
}
