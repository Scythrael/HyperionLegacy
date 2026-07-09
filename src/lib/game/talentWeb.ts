// --- Radial Skill Web — fog-of-war visible-set derivation ------------------
// Author: Radial Skill Web feature (Task 4)
// Created: 2026-07-08 (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 4)
//
// Description:
//   Pure, side-effect-free derivation of which talent nodes are currently
//   VISIBLE for a single branch/category, given the set of owned nodes. This
//   is the fog-of-war rule from design §2: a node is visible iff it is the
//   branch hub, is owned, or is a direct neighbor of an owned node. Everything
//   else is Hidden and (per §2.1) absent from the DOM entirely — the caller
//   renders only what this function returns.
//
//   Visibility is purely a VIEW over existing ownership + the static
//   `neighbors` graph (design §1.4): no new ownership storage, no mutation.
//   The same function serves BOTH talent tables (CAPTAIN_TALENTS and
//   HOMEWORLD_TALENTS) via the generic `K` key parameter — hence it accepts
//   only the minimal structural shape it actually reads (`branch`, `neighbors`,
//   `isHub`) rather than the full *Def, so either table's key/def type slots in.
//
//   NOTE — visibility is NOT affordability. A visible node may cost more points
//   than the player has; that is the caller's styling concern (design §2.3),
//   not this function's. This function answers only "does it render at all?"

// --- Functions -------------------------------------------------------------

/**
 * Compute the fog-of-war visible set for one branch/category.
 *
 * Returns: (the branch's hub) ∪ (owned nodes in the branch) ∪ (direct
 * neighbors of those owned nodes). The `branch` filter restricts the whole
 * computation to a single branch/category, so a stray key from a DIFFERENT
 * branch passed in `owned` contributes nothing (neither itself nor its
 * neighbors) — the tree only ever shows its own nodes.
 *
 * Pure: reads `table`/`owned`, allocates and returns a fresh Set, mutates
 * nothing the caller passed in.
 *
 * @param table  a talent table keyed by K; only the `branch`, `neighbors`, and
 *               optional `isHub` fields are read (minimal structural shape so
 *               both CAPTAIN_TALENTS and HOMEWORLD_TALENTS satisfy it).
 * @param branch the branch/category to derive visibility for.
 * @param owned  the keys the player currently owns (any branch; filtered here).
 * @returns      the set of keys to render for this branch.
 */
export function computeVisibleTalents<K extends string>(
  table: Record<K, { branch: string; neighbors: K[]; isHub?: boolean }>,
  branch: string,
  owned: K[]
): Set<K> {
  const ownedSet = new Set(owned);
  const visible = new Set<K>();

  // Pass 1 — seed with this branch's hub(s) and any owned node in this branch.
  // The hub is the always-visible bootstrap (design §2.2): with zero owned
  // nodes it is the ONLY thing that shows, so its neighbors can be revealed by
  // learning it. Owned nodes are trivially visible.
  for (const key of Object.keys(table) as K[]) {
    const def = table[key];
    if (def.branch !== branch) continue; // different branch/category — never visible here
    if (def.isHub) visible.add(key); // hub is the always-visible seed
    if (ownedSet.has(key)) visible.add(key); // owned nodes are visible
  }

  // Pass 2 — reveal the direct neighbors of every owned node (in this branch).
  // This is the outward "fog lifts one hop" step: own a node, see what it
  // connects to. The `!def || def.branch !== branch` guard means an owned key
  // that is missing or belongs to another branch reveals nothing (defends the
  // branch boundary even if `owned` is passed cross-branch).
  for (const key of ownedSet) {
    const def = table[key];
    if (!def || def.branch !== branch) continue;
    for (const n of def.neighbors) visible.add(n);
  }

  return visible;
}
