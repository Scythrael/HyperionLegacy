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

## Completion tracking BUILT (2026-11-13): carry note

Built to the eleven mockup answers above. Engine `src/lib/game/completion.ts` (one pure function, `systemCompletion`, over
a tally of counts; `runCompletionTally`, `heldCompletionTally` and `recordTally` give a live run's, a held Resume system's
and a record's), the hidden ledger `src/lib/game/notableEvents.ts`, display `src/lib/completionDisplay.ts` (tested), the
Systems section `src/lib/SystemsSection.svelte`, the console in `ExpeditionPanel.svelte`, the arcs in `TelescopeMap.svelte`.

- Q1 B: each body an equal share, its scan half and its objectives the other half (none: whole once scanned); a half scan
  counts nothing; never dips. 100% only when complete (99 at most otherwise).
- Q2 B: one record per system (GameState.systemRecords, keyed by system id, canonical key order), the best % kept (an
  equal % from a visit that was not abandoned replaces an abandoned one). Candidate cards show "Visited: N%" or the badge.
- Q3 B: a skipped objective counts as done; the lines note "N skipped".
- Q4 A: a giant's ship study is its body's objective; the nebula sweep is one objective of the system.
- Q5 A: records start at the update; runs in flight and Resume systems are listed live from day one.
- Q6 B: a green arc outside each region badge (share of that region's listed systems completed), one legend line, "N charted
  · M completed" on the key row, one accessible-name sentence; the slice labels treat a badge with an arc as one obstacle.
- Q7 A: the compact line with a small ring under the header; each body card has its line; the badge joins the name at 100%.
- Q8 A: the Systems section at the top of the Survey Log tab (open, Hide remembered; sort By tier, By completion, Newest
  first, remembered per viewer); a table row from 620 px of panel width, a card below.
- Q9 A: the Resume card's row is "Completion" with the one number; the recall claim's "saved to Resume at N%" reads it too.
- Q10 B: the claim card's line at 100%, verbatim, plus the ledger event.
- Q11 A: an abandon writes the record at the % it reached, marked "Abandoned".
- Save: GameState.systemRecords and GameState.notableEvents, optional, appended, no SAVE_VERSION bump. The record keeps
  counts PER BODY (the mockup's notes listed totals; equal body shares need the per-body counts); the % is never stored.
- A claim writes the record unless the run was recalled and its system is held (listed In Resume) or nothing was charted.
- Ledger: `notableEvents` with the Relics v2 content slice's shape and helper names (hub note 2026-11-13): kinds
  "relicSetCompleted" (key `relic-set-completed:<setId>`, written when a study completes a set, at that instant) and
  "systemCompleted" (key `system-completed:<systemId>`, at the claim of a 100% run). Reconcile with that slice at merge.
- Glyph `systemComplete` (icons.ts, ICON_SEMANTICS "alert" like check), reviewed at 16 / 28 / 56 px.
- Help: a new "System Completion" topic (the rule, where the % shows, no reward; helpTopics.ts SYSTEM_COMPLETION_PARAGRAPHS),
  pointed to from Expedition Tiers (RESUME), Subspace Telescope (the arcs) and Survey Log (a SYSTEMS paragraph).
- Ledger kept hidden by a test: only its writers (completion.ts, model.ts, notableEvents.ts, tick.ts) name it
  (completionTracking.test.ts). The Relics v2 slice's `withNotableEventsOnLoad` is not in this branch; at the merge its
  file joins that list.
- RELEASE_GATE: 4 pending, all Relics v2 rows (relic:audit:completionBlank waits on open question 2 below).
- Goldens: completionTrackingGoldens.test.ts (captured before the edit, 2652ed7c); the switch is model.ts
  COMPLETION_TRACKING_SWITCH (completionTrackingSwitch.fixture.ts).
- QA sheet: docs/qa/2026-11-13-completion-tracking-qa.html.

OPEN QUESTIONS (not built, awaiting the user):
1. The nebula sweep's WEIGHT under equal body shares: built as one more equal share of the system (whole once swept),
   since it belongs to no body. Alternatives: fold it into every body's objective half, or count it in the numbers only.
2. Relics v2 call 15 ("Relics owns the roll: one extra blank, one rarity step up", G7 calls it) against this design's
   "no stat reward, no grind pressure": `planetCompletionRelicBlank` is NOT called; its registry row
   (relic:audit:completionBlank) stays pending. Should a body or system reaching 100% roll the bonus blank?

## USER ANSWERS (2026-11-13, after the build) and a hub correction

The hub missed an earlier answer when asking "What happens at 100%": on 2026-10-09 (Relics v2 capture, G2 call 11) the
user said: "based on the tier you get a roll with certain benefits to it. Let's say you finish a T1 planet up, the bonus
roll increases the chance of better relics or higher quality relics for completion. As well as the full planetary report
that should 100% have a reward behind full completion." The Relics v2 engine already has the roll
(`planetCompletionRelicBlank` / `rollCompletionRelicBlank`; registry row `relic:audit:completionBlank`, pending on G7).
Re-asked; answers:
- 100% rewards: "Planet roll + system badge (Recommended)": each planet (body) that reaches 100% gets the 2026-10-09 bonus
  relic roll; finishing the whole system adds the badge and the claim-card line (and the hidden ledger event).
- Nebula sweep weight: "One body's share (Recommended)" (as built).
