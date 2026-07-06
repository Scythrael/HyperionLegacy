# Fleet Admiral Skill Tree — Design (Phase 2)

## Context

Phase 1 (`docs/plans/2026-07-03-captain-ship-design.md`) explicitly deferred a fleet-wide skill
tree to "Phase 2," with two concrete placeholders already sketched: a Command branch that unlocks
additional captain slots (replacing Phase 1's fixed count of 2), and a Research branch with one
buff node. This design fills in what Phase 1 left open, incorporating two things that changed since
Phase 1 shipped:

- Phase 1 ended up with **two** prestige tiers (Fleet Prestige, Captain Prestige), not one — the
  "Skill Points earned per prestige" idea from Phase 1's brainstorm needs re-anchoring to a specific
  tier now that there are two.
- Phase 1's final review flagged a real gap in `KNOWN_ISSUES.md`: Fleet Prestige always collapses
  the roster back to a hardcoded 2 captains, which this skill tree needs to fix now that captain
  count becomes a real, earned, persistent number.

A related, bigger idea also came up during this brainstorm — restructuring captain specializations
into resourcing/combat/science categories, with combat-type ships and a "fleet starbase" entity for
fabrication. **That is explicitly out of scope here.** It depends on combat ships existing, and
combat mechanics remain an open, unresolved design question even in the master design doc (§5.1).
Today's 3 specializations (Mining/Refining/Fabrication Specialist) are untouched by this design.

Also raised: a future UI direction with a "Fleet Starbase" tab, sub-tabs for shipyard/refining
progress, an EXP bar tied to missions, and the Skill Tree eventually living under a "Talent Tree"
sub-tab per captain/fleet area. **None of that navigation is built in this pass** — none of that
content exists yet (no missions, no shipyard, no fleet starbase), and building empty scaffolding for
an unvalidated future shape would be pure speculative cost. This is captured here as a **noted
future direction**, not a task.

## Data model

A generic, extensible skill tree — not two hardcoded booleans — since branches/effect types are
expected to grow later:

```ts
export type SkillBranchKey = "command" | "research";

export type SkillNodeKey = "commandRank1" | "commandRank2" | "commandRank3" | "researchAlloySynthesisSpeed";

export type SkillNodeEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "researchSpeedMult"; researchKey: ResearchKey; mult: number };

export interface SkillNodeDef {
  branch: SkillBranchKey;
  label: string;
  costSkillPoints: number;
  requires: SkillNodeKey | null; // prerequisite node in the same branch, enforces linear rank order
  effect: SkillNodeEffect;
}

export const SKILL_TREE: Record<SkillNodeKey, SkillNodeDef> = {
  commandRank1: { branch: "command", label: "Recruit Captain (2nd slot)", costSkillPoints: 1, requires: null, effect: { type: "unlockCaptainSlot" } },
  commandRank2: { branch: "command", label: "Recruit Captain (3rd slot)", costSkillPoints: 2, requires: "commandRank1", effect: { type: "unlockCaptainSlot" } },
  commandRank3: { branch: "command", label: "Recruit Captain (4th slot)", costSkillPoints: 3, requires: "commandRank2", effect: { type: "unlockCaptainSlot" } },
  researchAlloySynthesisSpeed: { branch: "research", label: "Synthesis Efficiency", costSkillPoints: 1, requires: null, effect: { type: "researchSpeedMult", researchKey: "alloySynthesis", mult: 0.75 } },
};
```

`GameState` gains `skillPoints: number` (unspent) and `unlockedSkillNodes: SkillNodeKey[]`. Both are
fleet-wide persistent progression — same tier as `augmentPoints`, not reset by Fleet Prestige.

## Skill Points

Earned **1 per Fleet Prestige only** (not Captain Prestige) — re-anchoring Phase 1's original "one
per Tier-1 prestige" intent to the bigger, slower-to-reach tier now that two exist. Captain Prestige
stays purely about specialization/`captainPoints`, untouched by this design.

## Captain count becomes derived, not hardcoded

`freshCaptains()` becomes `freshCaptains(count: number)`, generating `count` sequentially-id'd
captains from the shared `freshCaptainStack()` baseline (the same 1-free-miner floor established by
the Captain-2-softlock fix — every captain, however it's created, gets this floor; there is no
second way to create one). A new helper `captainSlotCount(state: GameState): number` returns
`1 + (number of unlocked "unlockCaptainSlot" nodes)`.

- **A brand-new game now starts with 1 captain**, not 2 — the Command branch is how the roster
  grows from here.
- **Buying a Command node** appends exactly one new captain (via `freshCaptainStack()`) to the
  roster, with the next sequential id/label.
- **Fleet Prestige's reset** changes from `captains: freshCaptains()` (hardcoded 2) to
  `captains: freshCaptains(captainSlotCount(state))` — this is the fix for the exact gap flagged in
  `KNOWN_ISSUES.md`. Earned slot count survives Fleet Prestige; captain stacks/specializations reset
  as before.

## Research speed buff — reaching `tickCaptainStack`

`tickCaptainStack` currently only sees `(deltaSeconds, captain, fleetMult)` — it has no visibility
into fleet-wide skill tree state. A new `researchDurationMults: Record<ResearchKey, number>` is
computed once per `tick()` call (the same "compute once, apply to every captain" pattern already
used for `fleetMult`) and passed into `tickCaptainStack`, which multiplies each research project's
`durationSeconds` by the corresponding entry (defaulting to `1` if no node targets that project)
before the existing progress-clamping logic runs.

## Migration (v6 → v7)

Existing saves already have 2 captains from Phase 1 — rather than shrinking their roster to match
the new "starts at 1" default (which would delete a captain's progress), the migration backfills
`unlockedSkillNodes: ["commandRank1"]` (grandfathering their existing 2nd captain as if already
earned) and `skillPoints: 0` (no bonus, per explicit confirmation — just "don't lose what you
already have"). Existing players see no visible roster change, just a new Skill Tree panel showing
rank 1 already purchased.

## UI

A new "SKILL TREE" panel, fleet-wide (shown once, alongside the Fleet Prestige panel — not
per-captain-tab, since this state isn't per-captain). Shows unspent Skill Points and both branches'
nodes in their rank order, each showing locked (prerequisite not met) / purchasable (prerequisite
met, affordable) / owned state, with a buy button gated the same way every other buy-style action in
this codebase already is: disabled at the UI layer, guarded again at the function layer.

## Testing

- `captainSlotCount`, `SKILL_TREE` shape (branch/prerequisite/cost values), `freshCaptains(count)`
  for various counts.
- `buySkillNode`: prerequisite gating, cost deduction, captain-slot-unlock appending exactly one new
  captain seeded with the 1-free-miner baseline, research-speed node requiring no prerequisite.
- `tick()`/`tickCaptainStack`'s closed-form invariant re-verified with a non-1 `researchDurationMults`
  value in the mix, alongside the existing fleet/captain/specialization multipliers.
- Fleet Prestige extended test: with N unlocked Command ranks, prestiging rebuilds exactly
  `1 + N` captains, not a hardcoded 2; `skillPoints`/`unlockedSkillNodes` survive Fleet Prestige
  unchanged.
- Migration: a genuine v6 save (2 captains, no skill tree fields at all) becomes v7 with
  `unlockedSkillNodes: ["commandRank1"]`, `skillPoints: 0`, and its 2 existing captains fully intact
  — plus the full v1→v7 chain extended from the existing chained test.

## Explicitly out of scope for this pass

- The resourcing/combat/science specialization redesign and the "fleet starbase" concept for
  fabrication — depends on combat ships existing (still unresolved per master doc §5.1); deferred to
  its own future design.
- Any new top-level navigation (a "Fleet Starbase" tab, Shipyard/Refining sub-tabs, an EXP bar tied
  to missions, reorganizing existing panels under Captain/Fleet tab groups) — none of that content
  exists yet; noted here as a **future direction** so it isn't lost, not built now.
- More than 3 Command ranks or more than 1 Research node.
- Any change to today's 3 specializations (Mining/Refining/Fabrication Specialist).
