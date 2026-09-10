// ============================================================================
// quantity.ts, the whole-unit arithmetic behind a batch-quantity control.
// Author: Scythrael. Added 2026-09-10 (Salvage Bay fractional-quantity fix).
// ============================================================================
//
// A PRESENTATION/INPUT helper, not engine logic, which is why it lives in
// src/lib/ui beside icons.ts rather than in src/lib/game: nothing here is
// consulted by the tick, by promotion, or by any enqueue gate. It exists so a
// quantity CONTROL can only ever offer a number the engine would accept, and so
// that number is testable without mounting App.svelte.
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// The Salvage Bay's clamp lived inline in App.svelte as:
//
//     const whole = Number.isFinite(raw) ? Math.floor(raw) : 1;
//     return Math.min(Math.max(1, whole), Math.max(1, max));
//
// `raw` (the form value) was floored. `max` was NOT. A salvaged material stack
// is a Decimal and is routinely fractional, so with 1.21K held and 1000 already
// queued, `max` arrived as 213.71000000000004 and the clamp handed that straight
// back. Three consequences, in increasing severity:
//
//   1. It printed. The button read "Salvage · ×213.71000000000004".
//   2. It DISAGREED WITH ITS OWN MAX READOUT, which floored separately for
//      display and said "(max 213)". One control, two numbers, both ours.
//   3. It was a promise the engine would not keep. doQueueSalvage floors the
//      count at the writer and reservation.ts's salvageOrderUnits floors again,
//      so the order actually queued was 213. The label lied about the action.
//
// A batch is a count of WHOLE JOBS (one unit promotes per bay per cycle), so a
// fractional count is not merely ugly, it is meaningless. Flooring BOTH ends is
// the fix, and putting it here is what lets it be pinned by tests.
//
// ── THE CONTRACT, and why 0 is a real return value ──────────────────────────
// The old clamp floored its max at 1, so a player holding 0.5 of a unit was
// offered a quantity of 1: an enabled button whose click the engine refused
// (exceedsFreeSalvageUnits: 1 > 0.5) with nothing but a log line to show for it.
// That is a dead control, which is the exact class of bug this console has been
// fought over before. So wholeUnitsFree returns 0 for a sub-unit stock and
// clampWholeQty propagates that 0, which gives the caller a single unambiguous
// signal to disable on. The invariant is absolute and testable: the returned
// quantity NEVER exceeds the whole units actually free.
//
// ⚠️ THESE TAKE AND RETURN PLAIN NUMBERS, AND ARE DISPLAY/INPUT ONLY. The
// caller's full-precision free value is untouched; only the QUANTITY derived
// from it is made whole. Nothing here may be used to decide whether the player
// holds something, which is reservation.ts's job and stays there.

// How many WHOLE units can be queued out of a possibly fractional free stock.
//
// Floors, because half a unit cannot be salvaged, and clamps at 0 so a caller
// gets "nothing is queueable" rather than a negative allowance from an
// out-of-band inventory drop. A non-finite input (NaN from an empty field, an
// Infinity from bad arithmetic) is treated as nothing free: guessing a quantity
// from a broken number is how a player loses stock they did not mean to spend.
export function wholeUnitsFree(free: number): number {
  if (!Number.isFinite(free)) return 0;
  return Math.max(0, Math.floor(free));
}

// The quantity a batch control will actually submit: the raw form value made
// whole and clamped into 1..maxWhole, or 0 when nothing is queueable at all.
//
// `raw` is an unsubmitted form value and may be anything: bind:value on a number
// <input> hands back NaN for a blank field and honours a pasted fraction or a
// negative. Non-finite raw falls back to 1, the smallest real order, which is
// what an empty field should mean while the player is still typing.
//
// `maxWhole` is expected to already be whole (pass wholeUnitsFree's result), but
// it is floored here too rather than trusted: this function's whole purpose is
// that a fraction cannot escape it, and a guarantee that depends on the caller
// getting it right is not a guarantee.
export function clampWholeQty(raw: number, maxWhole: number): number {
  const ceiling = wholeUnitsFree(maxWhole);
  if (ceiling <= 0) return 0; // nothing queueable: the control must be disabled, see header
  const whole = Number.isFinite(raw) ? Math.floor(raw) : 1;
  return Math.min(Math.max(1, whole), ceiling);
}
