# Big-Number (Decimal) Migration — Design

## Context

The user wants Hyperion Legacy's economy to support truly unbounded scale — up to and beyond
`e1,000,000` (an exponent in the millions), not just "very large" numbers. `format.ts`'s
`formatNumber` already anticipates large values (named tiers up to Octillion, `10^27`, then an
`n.toExponential(2)` fallback), but the underlying values are still plain JS `number` (IEEE-754
double), which has two hard ceilings:

- **Integer precision** breaks down past `2^53` (~9.007 quadrillion) — "quintillions" already
  exceeds this, so stored values would silently drift even though the display still looks fine.
- **Range** overflows to `Infinity` past `Number.MAX_VALUE` (~1.8×10^308). `e1,000,000` is not
  representable as a JS number at all, at any precision.

Reaching `e1,000,000` requires a genuine big-number type: a mantissa+exponent pair stored and
operated on directly, never collapsed into a native `number`. This is the same approach used by
incremental games like Cookie Clicker and Antimatter Dimensions.

**This is a large, invasive migration** touching nearly every numeric line in the game: every
resource/currency field in `GameState`, every arithmetic operation in `tick.ts`, the save schema
in `save.ts`, and every display/comparison call site in `App.svelte`. The user has explicitly asked
for extra care and triple-checking on this one, given the blast radius.

**Critical environment constraint, unchanged from every other feature this session**: Node.js/npm/
tsc are NOT available in this dev environment. This migration can only ever be verified by manual
code tracing here — the only place it actually compiles/runs is Vercel's build step, after a push
to `main`. This raises the stakes on getting the design and hand-traced verification right *before*
any task is marked complete, more so than any prior feature.

## Scope — confirmed field split

Only fields that genuinely need unbounded growth become `Decimal`. Everything else — including
some fields the user's first-pass framing might have implied should convert — stays a plain
`number`. The split below was corrected once already during design (see "Design correction" below)
and is now confirmed:

| Goes `Decimal` | Stays plain `number` |
|---|---|
| `homePlanet.storage` (`commonOre`, `uncommonMaterial`, `rareMaterial`, `refinedMaterial`, `components`) | `level` (per-captain), `fleetAdminLevel` |
| Mission `cargo` (`commonOre`, `uncommonMaterial`, `rareMaterial`) | `statPoints`, `adminPoints` |
| Captain `xp` | `CAPTAIN_TALENTS[].cost`, `HOMEWORLD_TALENTS[].cost` |
| `fleetAdminXp` | All tick/phase counters (`phaseProgressTicks`, `ticksElapsed`, `tickDurationSeconds`) |
| `RECIPES[].inputs[key]`, `RECIPES[].output.amount` | All percentages/progress-bar math |

### Design correction made during brainstorming (recorded so the "why" isn't lost)

The first-pass proposal put talent/recipe costs entirely in the `Decimal` bucket. That was wrong
for talent costs specifically: `CAPTAIN_TALENTS[].cost` is compared against and subtracted from
`captain.statPoints` (`tick.ts` around the `buyCaptainTalent` logic), and `HOMEWORLD_TALENTS[].cost`
against `adminPoints`. Since `statPoints`/`adminPoints` are small counters tied to `level` (which
stays a plain number, incrementing by exactly 1 per level-up regardless of how large XP gets), a
`Decimal` cost compared against a plain-number balance would force constant unnecessary wrapping
for no real benefit — those balances will never need unbounded scale. Talent costs stay plain
`number`. Recipe inputs/outputs are different: they're compared against `homePlanet.storage`, which
*does* need unbounded scale, so those two fields go `Decimal`.

## Dependency: `break_infinity.js`

Verified directly against the library's README and repo (not from training-data memory, per this
project's source-discipline rule — WebFetch was used to confirm the following at design time):

- **npm package name**: `break_infinity.js`, latest version `2.2.0`.
- Ships its own bundled TypeScript definitions (`dist/index.d.ts`) — no separate `@types` package
  needed, and the library itself is written in TypeScript.
- **Class**: `Decimal`. Constructors: `new Decimal(number)`, `new Decimal(string)`,
  `new Decimal(Decimal)`.
- **Arithmetic** (all return NEW instances — `Decimal` is not mutated in place):
  `.plus()`, `.minus()`, `.times()`, `.dividedBy()`.
- **Comparisons**: `.equals()`, `.lessThan()`/`.lt()`, `.greaterThan()`/`.gt()`,
  `.lessThanOrEqualTo()`/`.lte()`, `.greaterThanOrEqualTo()`/`.gte()`.
- **Static**: `Decimal.min()`, `Decimal.max()` (replacements for `Math.min`/`Math.max` call sites
  that operate on `Decimal` values).
- **Serialization**: no confirmed built-in `toJSON()` hook in the docs reviewed. Design decision:
  `save.ts` will explicitly call `.toString()` when writing a `Decimal` field into the save shape,
  and `new Decimal(str)` when reading it back — explicit and unambiguous, matching this codebase's
  existing manual (de)serialization style in `save.ts` rather than relying on an implicit hook.

### Rewrite pattern (every call site touching a `Decimal` field must follow this)

| Old (plain `number`) | New (`Decimal`) |
|---|---|
| `a += b` | `a = a.plus(b)` |
| `a -= b` | `a = a.minus(b)` |
| `a * b` | `a.times(b)` |
| `a / b` | `a.dividedBy(b)` |
| `a < b` | `a.lt(b)` |
| `a >= b` | `a.gte(b)` |
| `Math.min(a, b)` | `Decimal.min(a, b)` |
| `Math.max(a, b)` | `Decimal.max(a, b)` |
| `0` (initial value) | `new Decimal(0)` |

## `format.ts` rewrite

`formatNumber` currently derives tier/magnitude via `Math.log10(abs) / 3` and `Math.pow(10, tier*3)`
on a raw `number` — this breaks down once a value can exceed double range entirely. `Decimal`
instances store their magnitude as a mantissa+exponent pair internally and expose `.log10()` and
related methods directly, so the rewritten formatter reads magnitude from the `Decimal` itself
rather than re-deriving it via `Math.log10` on a value that may no longer fit in a double. Named
tiers (K/M/B/T/Qa/Qi/Sx/Sp/Oc) stay for the low range; anything past the tier table's cap falls back
to scientific notation exactly as today, just computed from the `Decimal`'s own exponent instead of
`Math.log10`.

## `save.ts` migration (v11 → v12)

Current `SAVE_VERSION` is `11` (`MIGRATIONS[10]` implements v10→v11, collapsing
`tickDurationSeconds` back to fleet-wide). This migration becomes `MIGRATIONS[11]`, v11→v12:

- Every field listed in the "Goes `Decimal`" column above is read as a plain `number` from the old
  save shape and converted via `new Decimal(oldValue)`.
- The migration does NOT touch any field in the "stays plain `number`" column.
- Going forward, `save.ts`'s serialize/deserialize functions call `.toString()` on write and
  `new Decimal(str)` on read for every `Decimal`-typed field (see Serialization above).
- `freshState()`/`freshCaptains()` in `model.ts` seed all `Decimal` fields with `new Decimal(0)`
  instead of `0`.

## The XP/level-up loop risk (flagged during design, not discovered mid-implementation)

`tick.ts` currently awards XP via a loop shaped like
`while (xp >= xpForNextLevel(level)) { level += 1; xp -= xpForNextLevel(level); }` (both for
per-captain XP and Fleet Admiral XP). Today this is safe because XP only grows from a flat
per-mission-cycle award, so the loop runs at most a handful of times per `tick()` call. Once `xp`
is `Decimal`-scale (e.g. from a very large `ticksElapsed` after offline catch-up producing many
mission cycles in one call), this loop could iterate an enormous, unbounded number of times in a
single `tick()` call if `xpForNextLevel`'s growth curve doesn't outpace it — a real hang risk.

**Chosen fix**: cap the loop at a fixed maximum number of level-ups processed per `tick()` call
(exact constant TBD in the plan, e.g. `MAX_LEVEL_UPS_PER_TICK = 10_000`). If the cap is hit, any
remaining `xp` is carried forward unresolved — it will simply keep processing on subsequent
`tick()` calls (which happen continuously during live play) rather than blocking the current call.
This is intentionally the simple, safe option: an alternative closed-form solution (inverting the
XP curve algebraically, e.g. via `.log10()`, to jump directly to the correct level) was considered
and rejected for now — log-based inversion on `Decimal`-scale values is exactly the kind of
precision-sensitive math most likely to introduce a subtle bug, which cuts against the "no
mistakes, triple-check" goal for this migration. A closed-form optimization can be revisited later
if the capped-loop approach proves too slow in practice.

## Rollout sequencing

This migration is its own worktree/branch (e.g. `feat/big-number-migration`), started **after**
`feat/loot-tier-rework` merges — both touch `tick.ts`/`model.ts` directly, and doing them
concurrently invites avoidable merge conflicts. Given the explicit request for extra care, this is
split into more, smaller, independently-reviewed tasks than a typical feature this session:

1. **Dependency + smoke test**: add `break_infinity.js` to `package.json`, write one small isolated
   hand-traced test file exercising `new Decimal()`, `.plus()`, `.toString()` to confirm the
   library's actual behavior matches the verified API surface above, before touching any real game
   code. If anything about the library surprises us, it surfaces here, cheaply.
2. **`model.ts` type migration**: change the confirmed field list's types to `Decimal`, update
   `freshState()`/`freshCaptains()` initializers to `new Decimal(0)`.
3. **`save.ts` v11→v12 migration**: convert existing plain-number fields to `Decimal` on load;
   `.toString()`/`new Decimal(str)` for ongoing serialization.
4. **`tick.ts` — extraction & cargo arithmetic**: rewrite the loot-roll and cargo-delivery call
   sites per the rewrite-pattern table above.
5. **`tick.ts` — XP/leveling arithmetic + the bounded level-up loop fix**: both captain XP and Fleet
   Admiral XP, including the `MAX_LEVEL_UPS_PER_TICK` cap.
6. **`tick.ts` — recipe crafting & talent-cost comparisons**: careful attention to the
   `Decimal`/plain-`number` boundary here specifically (recipe inputs/outputs are `Decimal`,
   compared against `Decimal` storage; talent costs stay plain `number`, compared against plain
   `statPoints`/`adminPoints` — these must NOT be mixed).
7. **`format.ts` rewrite**: `Decimal`-aware tier/exponential formatting, per the section above.
8. **`App.svelte` call sites**: display (`formatNumber` call sites), affordability checks, and
   progress-bar percentage math, updated to use `Decimal` methods where the underlying field is now
   `Decimal`.
9. **Test file updates**: `model.test.ts`, `tick.test.ts`, `save.test.ts` updated for the new types
   and the migration.
10. **Docs + session log**.

Each task gets the full two-stage review (spec-compliance, then code-quality) before moving to the
next, exactly as established for every other feature this session — with extra emphasis, per the
user's request, on independently re-deriving hand-traced math rather than trusting subagent
self-reports, especially around the `Decimal`/plain-`number` boundary in tasks 6 and 8.
