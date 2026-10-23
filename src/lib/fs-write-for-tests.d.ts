// 0.13.11.1: a second, one-function node:fs declaration for tests (see fs-for-tests.d.ts for why
// these exist instead of node types in the app config). secret/goldens.test.ts rewrites its goldens
// file ONLY when run on purpose with GOLDEN_WRITE=1; secret/wiring.test.ts lists src/lib to
// compare every layer's z-index. Kept in its own file so it merges into any
// branch that declares more of node:fs without touching the shared shim.
declare module "node:fs" {
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
}