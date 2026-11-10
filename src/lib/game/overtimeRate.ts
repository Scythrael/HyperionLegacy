// OVERTIME's rate (0.14.0 speed seam, docs/plans/2026-10-16-credit-sinks-pass.md USER ANSWERS: "+25% steps, rising
// cost"), in a leaf of its own so the gear wear engine (gear repair Overtime, gear wear step 5) reads the SAME rule as
// processSpeed.ts without importing it (processSpeed.ts imports the tick, which imports the gear wear engine).
// processSpeed.ts re-exports both names; every Overtime reader shares them.

// (user) Each step adds 25% of the job's normal rate.
export const OVERTIME_STEP_RATE = 0.25;

// A job's rate after `steps` Overtime steps, as a multiple of its normal rate. Pure.
export function overtimeRate(steps: number): number {
  return 1 + OVERTIME_STEP_RATE * steps;
}

// OT-UI (the 2026-11-10 Overtime buttons mockup, user "Chip + no jump"): the rate chip's text, "1.25x", "1.5x", "1.75x"
// (the gear card's own format), or null at the normal rate (no chip). Pure.
export function overtimeRateText(steps: number): string | null {
  return steps > 0 ? `${Math.round(overtimeRate(steps) * 100) / 100}x` : null;
}
