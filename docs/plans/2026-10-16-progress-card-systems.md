# 0.14.0 fan progress card: the system list behind the numbers

The public card (https://claude.ai/artifact/QS6u5o8rH57FqX77qB6D24) shows only the bar and percentages (user: "Not
showing the checklist really"). This file records which systems the counts mean, so every update counts the same way.
Overall % = (done + building / 2) / total.

## 2026-10-16 (v5): 26 systems, 14 done, 6 building, 6 designed = 65%

Done and tested (14): crew made real (complement, officers, officer stats, diminishing returns); exploration core
expeditions; relics and the Museum (v1); away-team combat and gambits; Ground Operations engine (teams, objectives,
medical bay, threat odds); squads and team types; Subspace Telescope (engine + Facilities card); risk factors and
objective difficulty; objective affixes (Reinforcing, Rocky Outcroppings); ship scan events and field repair; Ground
Operations screens (queue, timelines, scan track, per-team gambit editor); exploration Help pages; salvage safety and
the crew lock; the wiring audit (every bonus inventoried).

Building (6): Squad Loadouts (engine done, screen awaiting mockup sign-off); the wiring framework and fixes (registry +
tests landed); safe first runs and the difficulty curve; crew complement and acquisition; expedition tiers (regions,
travel, homeworlds, recall); Field Kits.

Designed, build queued (6): short-range missions; gas giant study; Relics v2; completion tracking (with the chat-event
ledger); Material Lines; universal modules (E-MOD, incl. the power budget).

History: v4 (2026-10-14) 24 systems, 11 / 5 / 8 = 56%.

## 2026-10-17 (v6): 30 systems, 14 done, 6 building, 10 designed = 57%

Same 14 done and 6 building as v5 (the building six all advanced: wiring registry + simulated player + bug fixes, run
counters and the training-run rule, enemy ranks). Four systems ADDED to the plan (designed): gear wear; Prospecting
squads (built hidden); Overtime and credit sinks; tutorial hooks (time skip, grant, expedite seam). User chose to show
the honest 57% with the note "The plan grew by four systems since the last update, so the percentage dipped even
though a lot got built."

## 2026-10-19 (v7): 30 systems, 16 done, 10 building, 4 designed = 70%

Done (16): the v6 fourteen plus Squad Loadouts (engine + screen merged) and Prospecting squads (built hidden, merged).
Building (10): wiring framework (WR-1 to WR-5 and the Debug Wiring panel built; WR-6 to WR-12 left); safe first runs
(SF-0 to SF-2 merged, SF-3 building); crew complement (CP-0 to CP-2, CP-6, CP-7 built); expedition tiers (G2-1, G2-2);
Field Kits (FKR-0 to FKR-4); short-range missions (G1-0, G1-1); gas giant study (GG-0, GG-1 building); gear wear
(steps 1 to 2 building); Overtime and credit sinks (speed seam merged, UI left); tutorial hooks (time skip, grant,
expedite seam in the speed seam; tutorial wiring left).
Designed (4): Relics v2; completion tracking; Material Lines; universal modules (E-MOD).
Note shown on the card: "Still in production: once building wraps, a full QA pass begins, more in-depth than any
before it."

## 2026-10-21 (v8): 32 systems, 16 done, 14 building, 2 designed = 72%

Done (16): unchanged from v7. Building (14): the v7 ten (wiring WR-1 to WR-6; safe first runs SF-0 to SF-3; complement
CP-0 to CP-2, CP-6 to CP-8 and the racials; expedition tiers G2-1 to G2-3; Field Kits FKR-0 to FKR-10, live for players,
FKR-11 close-out left; short-range G1-0 to G1-4; gas giant GG-0 to GG-1; gear wear steps 1 to 2; Overtime and credit
sinks; tutorial hooks) plus Relics v2 (R2-0 to R2-1), Material Lines (ML-0 to ML-1), universal modules / power (EM-0 to
EM-1) and the NEW reactor fuel ladder and tech foundation (built, awaiting one balance call). Designed (2): completion
tracking; the NEW recipe realism pass (audit signed off in groups). Two systems added since v7, noted on the card.

## 2026-10-22 (v9): road to release; build 32 systems, 17 done, 14 building, 1 designed = 75% built, 53% to release

User (2026-10-22): "please generate a new progress report... These are likely going to be a thing. Also, let's build
in all of the polish steps. QA and everything into the report as well. Just note that QA is going to be much much much
much more involved than ever before this time. It usually takes hours overall. I'm envisioning a number of passes.
Multiple agents doing multiple things, a round of fixes, then another round of QA, then more fixes. Multiple times
through. So what was hours may become a week in comparison."

New headline (the card now covers the whole road): to-release % = 0.70 x build % + 0.10 x polish % + 0.18 x QA % +
0.02 x release %. Stage weights [PROPOSAL, user may retune]: Building 70, Polish 10, QA rounds 18, Release 2. Build %
keeps the old rule, (done + building / 2) / total. Polish = cross-cutting passes not inside any one system's close-out
slice (balance pass, Help review, phone layouts, visual touch-ups, patch notes). QA rounds = QA round, fixes, QA round,
fixes, repeated until clean; testers per round are several in parallel (agents playing desktop and phone, code readers
checking behavior not just wiring, plus the planned external reviewers in [[2026-10-21-reactor-fuel-and-recipe-realism-capture]]).
Release = final staging check and promotion. Suggested QA % rule for later cards: each finished QA round plus its fixes
counts as one step of a planned three, extended if more rounds are needed.

Done (17): the v8 sixteen plus reactor fuel ladder and reactor tech foundation (with Cometary Ice Harvest; ice price
answered). Building (14): the v8 fourteen minus reactor, plus the recipe realism pass (built recipes fixed in the ML-2
merge; planned recipes follow their own builds). Designed (1): completion tracking. Card shows 53% to release, 75%
built, with a note that the drop from 72% is the new scope of the number, not lost work.

USER ANSWER (2026-10-22): headline = "53% to release (Recommended)": keep the whole-road number with weights Building 70, Polish 10, QA rounds 18, Release 2 (the [PROPOSAL] above is now approved).

## 2026-10-23 (v10): 33 systems, 18 done, 14 building, 1 designed = 76% built, 53% to release

Done (18): the v9 seventeen plus the NEW rarity and quality readiness system (RR-0 to RR-8 merged e4246d5; added to the plan and finished the same day). Building (14): unchanged set (WR-8 combat descriptors, EM-3 power in combat and EM-4 reactor speed merged as progress inside wiring / E-MOD; G2-6 merged inside expedition tiers). Designed (1): completion tracking. To release stays 53% (0.70 x 75.8% = 53.0%) because the plan grew by one system while building moved; the card says so.

## 2026-10-29 (v11): 34 systems, 19 done, 14 building, 1 designed = 76% built, 54% to release

Done (19): the v10 eighteen plus Field Kits (FKR-8 field device roll and FKR-11 close-out merged; no release blockers).
Building (14): wiring framework (WR-7, WR-9 to WR-12 left); safe first runs (SF-5/6 merged, SF-7 close-out left); crew
complement; expedition tiers; short-range missions; gas giant study (Survey Log live, GG-7 crafting and special
blueprints merged, GG-8 close-out left); gear wear (step 4 combat wear with projected repair merged, step 5 UI left);
Overtime and credit sinks; tutorial hooks; Relics v2 (R2-10 minigame boosts and the tier stagger merged; R2-5 to R2-9
left); Material Lines (ML-7 legibility merged); universal modules / power (EM-7 and EM-10 Modules row and power bar
merged; EM-8, EM-9 left); recipe realism; plus the NEW minigame prestige redesign (Slices 0 to 2 merged, 3 and 4 on a
branch awaiting the parity fix round, 5 to 7 left), shown on the public card only as "one under wraps" (the minigame is
a secret). Designed (1): completion tracking. Build % = (19 + 14 / 2) / 34 = 76.5%; to release = 0.70 x 76.5% = 53.5%,
shown as 54%. The card also lists the landed items in fan language (Tactical Protocols rename included).
