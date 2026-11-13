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
