// ============================================================================
// A ONE-FUNCTION node:fs SHIM, for TESTS THAT READ SOURCE FILES.
// 0.13.5 Phase 1. Used by contrast.test.ts, which parses src/app.css directly.
//
// ⚠️ WHY THIS EXISTS RATHER THAN ADDING "node" TO tsconfig.app.json's `types`.
//
// @types/node IS installed (tsconfig.node.json already uses it), so the lazy fix would be to add
// "node" to the app config's types array. That is deliberately NOT done: it would put the entire
// node API into the global scope of every APP file, so browser code could reference `process`,
// `Buffer` or `fs` and typecheck perfectly while failing at runtime in a browser. The app is a
// browser bundle; letting it believe otherwise is a real hazard for a one-line convenience.
//
// A standalone .d.ts with no imports or exports is a MODULE DECLARATION rather than an
// augmentation, which is what makes this work where `declare module` inside the test file did not
// (inside a module, `declare module "node:fs"` tries to AUGMENT a module that the app config
// cannot see, and TypeScript rejects it).
//
// ⚠️ KEEP THIS SURFACE MINIMAL. It declares exactly what the tests use and nothing else, so it
// cannot quietly become a back door to the node API. If a test needs another function, add that
// one function here and say why.
// ============================================================================

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}
