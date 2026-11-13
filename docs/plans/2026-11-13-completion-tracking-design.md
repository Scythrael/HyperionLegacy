# Completion tracking (0.14.0): design answers

Status: DESIGN ANSWERED 2026-11-13; MOCKUP FIRST, then build. Sources: E-CREW plan G7 ("Per-planet / per-system
completion %", S2-65; D25: "When the task is complete on that planet, it's done. You got all of the goodies. You get
your % completion of the system, and you move on from there.") and G4 ("Chat-event ledger: record chat-worthy events
(first: a relic set completed) for when chat lands"); the relics capture ("completing any set bonus should deserve a
shoutout in the system chat").

## USER ANSWERS (2026-11-13)

- What counts: "Bodies + objectives (Recommended)": each body scanned plus each objective cleared on it, weighted
  evenly; 100% means every body charted and every objective done.
- Where shown (multi): "Expedition console (Recommended)" (each system and body row), "Telescope map (Recommended)" (a
  small ring or tag on charted systems), and "Survey Log / Archive" (a list of every visited system with its %).
- At 100%: "A badge + log line (Recommended)": a completed mark and a ledger entry; no stat reward, no grind pressure.
- Chat-event ledger: "Hidden until chat (Recommended)": record events now (no new screen in 0.14.0).
- Older note S2-65 (completion % gating relic rarity): "No, region tiers cover it (Recommended)". Not built.

## Next

A mockup of the three surfaces and the badge for the user's approval, then a builder slice (goldens first; deterministic;
old saves derive their % from stored records where possible, wrap-on-load if needed).

## USER ANSWERS (2026-11-13) on the mockup (docs/mockups/2026-11-13-completion-tracking-mockup.html)

1. Counting: "B: each body an equal share (Recommended)": a body's scan is half its share, its objectives split the other
   half (a body with none: the scan is all of it); the % never dips.
2. Revisits: "B: one row, best % kept (Recommended)": one row per system; its candidate card shows "Visited: N%" or the
   badge when it comes up again.
3. Skipped objectives: "B: count as done (Recommended)": 100% stays reachable after a skip.
4. Studies and sweeps: "A: both count (Recommended)": a giant's study is its body's objective; a nebula sweep is one
   objective of the system.
5. Old saves: "A: start at the update (Recommended)": in-flight and Resume systems list from day one; earlier claimed
   systems are not shown.
6. Telescope map: "B: arcs on region badges (Recommended)": a green arc per region badge (share completed); no
   per-system % on the map.
7. Console: "A: compact line (Recommended)": "Bodies 2/3 · Objectives 3/5 · 63%" with a small ring.
8. List home: "A: top of the Survey Log (Recommended)": a Systems section at the top of the Survey Log tab.
9. Resume %: "A: one number everywhere (Recommended)": "Completion 40% · Bodies 1/3 · Objectives 1/2".
10. Log line: "B: a line on the claim card (Recommended)": "<System> completed: every body scanned, every objective
    done." (plus the hidden ledger entry).
11. Abandoned: "A: keep its row, marked (Recommended)": stays at the % it reached, marked "Abandoned".
