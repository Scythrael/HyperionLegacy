// testReport.ts: print a measurement from a test. Test-only.
// This repo's vitest run swallows console.log, but stdout reaches the terminal, so measurements
// (catch-up timings, the simulated timeline) still show up in the gate output. The app's tsconfig
// has no node types, hence the narrow structural cast instead of a bare `process`.
type Stdout = { stdout?: { write(s: string): void } };

export function report(line: string): void {
  (globalThis as { process?: Stdout }).process?.stdout?.write(`${line}\n`);
}
