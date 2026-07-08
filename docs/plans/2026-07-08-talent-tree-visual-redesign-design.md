# Talent Tree Visual Redesign — Design

## Motivation

Both talent trees (Captain Talents and Homeworld Talents) currently render as a flat list of
`.skill-node` rows per branch — no visual connectors showing which node unlocks which, and no
explanation of what a node's effect actually does beyond its raw name (per the user's own prior
feedback: "it's hard to tell what the talents actually do"). This design covers four bundled pieces,
per the user's explicit choice to build them together rather than across separate branches:

1. A real branching-tree visual (SVG connector lines between positioned nodes).
2. Tooltips showing each node's numeric effect and flavor text.
3. Respeccing (full reset + refund), which in turn requires introducing a new `credits` currency as
   its cost.
4. Captain Specialization — reviving the retired Phase 1 specialization mechanic: each captain picks one
   Captain Talent branch as their spec, earning an innate bonus for it, changeable via the same respec
   flow/cost (see its own section below).

## Credits currency

A new `Decimal`-typed `credits` field on `GameState`. Each `MissionDef` gains a `creditsPerCycle: number`
field, mirroring `fleetAdminXpPerCycle`'s existing shape exactly — `shortOreRun: 10`, `longOreRun: 20`
(placeholders, not balance-tested, same spirit as every other tunable constant in `MISSIONS`). Awarded
once per completed mission cycle inside `tickCaptainMission`, accumulated the same "collect locally,
apply once per call" way `fleetAdminXpDelta` already works, and added to `state.credits` in `tick()`.
Displayed fleet-wide, likely near the Admin Points readout in the Homeworld Talents panel since both are
fleet-wide currencies.

Explicitly out of scope for this design: a Homeworld "Market" to sell existing resources for additional
credits — a real future feature the user wants, logged to `SUGGESTIONS.md` as a follow-up, not built here.
This design only needs credits to exist as a mission-cycle reward, sufficient to fund respeccing.

## Respec mechanism

Full-reset only (not per-node refunds) — sidesteps prerequisite-chain refund complications entirely.
Two new functions in `tick.ts`, both costing a flat 50 credits (placeholder, not balance-tested), both
failing with the unchanged state reference if `state.credits < 50` (same "same state reference on
failure" convention every other buy/action function in this file already uses):

- `respecCaptainTalents(state, captainId)`: refunds this captain's `unlockedCaptainTalents` — sums each
  unlocked node's `cost` back into `statPoints`, clears the array to `[]`, deducts 50 credits from the
  fleet-wide pool.
- `respecHomeworldTalents(state)`: refunds every unlocked Homeworld Talent **except** the 3
  `unlockCaptainSlot` nodes (`fleetLogisticsSlot1/2/3`) — those stay permanently unlocked once bought,
  never refunded, since undoing one would mean deleting an existing captain and everything on it (their
  own Captain Talents, any in-progress mission, cargo). Sums the refundable nodes' `cost` back into
  `adminPoints`, removes only those keys from `unlockedHomeworldTalents` (any slot-unlock keys already
  present are left untouched), deducts 50 credits.

A "Reset" button appears on each talent panel, gated behind a confirmation step (this spends real
currency and wipes a tree — not something a stray misclick should trigger).

## Visual tree layout

Each branch's nodes form a `requires` chain — today, every branch is a single linear chain (e.g.
`resourcefulnessRareChanceI → II → BonusRollI → II`), no actual forks exist in the current data. Layout
algorithm, written generically so a future fork works without changes: compute each node's depth by
walking its `requires` chain back to the root (root = depth 0); nodes sharing a depth within a branch sit
side-by-side. Each branch renders as its own column; an absolutely-positioned node sits at
`(branch-column, depth-row)`. One shared inline `<svg>` per branch draws a straight line from each
non-root node up to its prerequisite's position, using `var(--color-accent)`/`currentColor` so it
re-themes automatically across the 6 existing presets — same approach the inline-SVG-art idea (logged to
`SUGGESTIONS.md`) already anticipated. Owned nodes get a bright/filled connector; locked nodes get a dim
one, so progress down a chain is visible at a glance without reading any text.

## Tooltips (numbers + flavor text)

A new `flavor: string` field on both `CaptainTalentDef` and `HomeworldTalentDef`. A small
`describeCaptainTalentEffect`/`describeHomeworldTalentEffect` helper converts each effect union member
into a human-readable numbers line at render time (e.g. `{ type: "commonYieldMult", mult: 0.1 }` →
`"+10% Common Ore yield"`), rather than storing redundant display text that could drift from the real
effect value. Tooltip content = flavor sentence + numbers line + cost/requires (repeated here for a
self-contained popup, even though it's already shown inline on the node itself). Interaction model: hover
to show on desktop (pointer devices), tap-to-toggle on touch — two small code paths sharing one
tooltip-content renderer, chosen over a single unified tap-only model for a more native desktop feel.

Flavor text is drafted here for every existing node (I wrote these; reviewable/editable afterward):

| Key | Label | Flavor text |
|---|---|---|
| `commandExtractionI` | Bulk Extraction | "Standard doctrine trades finesse for throughput — pull more common ore per cycle, no questions asked." |
| `commandExtractionII` | Refined Extraction | "Field engineers recalibrate the intake manifolds to favor uncommon deposits over raw volume." |
| `resourcefulnessRareChanceI` | Keen Eye I | "A trained eye catches what the sensors miss — subtle mineral banding invisible to standard scans." |
| `resourcefulnessRareChanceII` | Keen Eye II | "Years of fieldwork sharpen instinct into something the manuals can't teach." |
| `resourcefulnessBonusRollI` | Lucky Strike I | "Some captains just have a feel for where the good ore sits. Call it luck; call it experience." |
| `resourcefulnessBonusRollII` | Lucky Strike II | "When the feeling's right twice in a row, it stops being coincidence." |
| `fleetLogisticsSlot1` | Recruit Captain (2nd slot) | "Fleet Command approves a second commission — the roster grows." |
| `fleetLogisticsSlot2` | Recruit Captain (3rd slot) | "A third captain's chair, funded and ready. The fleet expands." |
| `fleetLogisticsSlot3` | Recruit Captain (4th slot) | "Four commands under one banner — logistics finally caught up with ambition." |
| `fleetLogisticsYield` | Fleet Requisitions | "Standing orders redirect a share of every rare find straight back to the fleet's reserves." |
| `industryBonusOutput` | Tooling Upgrade | "New jigs and fixtures on the fabrication line mean every batch stretches a little further." |
| `economyTrickle` | Trade Contacts | "A quiet arrangement with independent traders keeps a slow, steady trickle of ore flowing home." |

## Testing

`model.test.ts` gets new assertions for the `flavor`/`creditsPerCycle` fields on the affected tables.
`tick.test.ts` gets new tests for credits accumulating correctly through `tickCaptainMission`/`tick()`,
and for `respecCaptainTalents`/`respecHomeworldTalents` (refund math, the insufficient-credits failure
path, and confirming the 3 `unlockCaptainSlot` nodes survive a Homeworld reset untouched). `save.test.ts`
gets a new migration test for the version bump below.

## Captain Specialization (reviving the retired mechanic)

This game had a "Captain Prestige panel + specialization picker" system once (Phase 1), retired during
the Phase 4 Navigation/Progression Overhaul along with the old Generator Stack economy. This design
revives the concept in a new form, built on the Captain Talent tree rather than the old system.

`CaptainState` gains `spec: CaptainTalentBranch | null` (starts `null` for a fresh captain). A new
`CAPTAIN_SPEC_BONUS: Partial<Record<CaptainTalentBranch, CaptainTalentEffect>>` table grants an innate
bonus once a captain has that spec chosen — deliberately `Partial`, since only branches with a real entry
are selectable at all:

- `resourcefulness: { type: "bonusRollChance", chance: 0.01 }` — an innate 1% baseline that additively
  stacks with the Lucky Strike I/II talent chain: `0.02` base (node I) doubled to `0.04` by node II's
  `bonusRollChanceMult`, plus this `0.01` spec bonus, lands at exactly `0.05` (5%) when a Resourcefulness
  captain is fully specced AND fully talented.
- `command: { type: "commonYieldMult", mult: 0.05 }` — a "+5%" placeholder bonus, deliberately reusing an
  existing effect type so it's wireable now without inventing new mechanics; refine the actual value/type
  later once Command's role is better defined.
- `tactical`/`science`/`diplomacy` — **no entry**. These specs render locked in the spec picker (same
  "Not yet available" treatment their talent columns already get today), becoming selectable only once
  their real systems (Combat, a redefined Science mechanic) actually exist. Avoids inventing a meaningless
  bonus for a system that isn't built yet.

Choosing or changing a captain's spec is bundled into the SAME `respecCaptainTalents` flow (same 50-credit
cost, since credits already fund "at will" changes to a captain's build) — that function's signature
grows an optional new-spec parameter, applied atomically with the talent-tree wipe. A plain reset that
doesn't touch spec selection keeps the current one. The relevant stacking helper sums BOTH sources
additively — e.g. `captainBonusRollChance` sums `resourcefulnessBonusRollI`'s `chance` from the talent
tree AND (if this captain's `spec === "resourcefulness"`) `CAPTAIN_SPEC_BONUS.resourcefulness.chance`.

## Save/schema impact

Real migration needed — `credits` is a new persisted `GameState` field, and `spec` is a new persisted
per-captain field. `SAVE_VERSION` bumps (currently 13) with a backfill defaulting existing saves to
`credits: new Decimal(0)` and every existing captain's `spec: null`.

## Explicitly out of scope for THIS design

- The Homeworld Market (sell resources for credits) — a real future feature, logged to `SUGGESTIONS.md`.
- The broader credits economy (Auction House, a Bank protecting credits from a future death/failure
  mechanic) — logged to `SUGGESTIONS.md`, well beyond this branch.
- Per-node partial refunds for respec — full-reset-only for this pass; individual-node refunding (and its
  prerequisite-chain complications) is a possible future refinement, not built here.
- Real spec bonuses for Tactical/Science/Diplomacy — those specs stay locked until Combat/Science exist.
- Ships, ship-stat cargo capacity, the third "farming efficiency" mission type — unchanged, still
  deferred from earlier branches.
