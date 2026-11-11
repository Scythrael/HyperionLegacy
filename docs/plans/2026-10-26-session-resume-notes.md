RESUME after 5-hour reset (2026-10-22 17:40 UTC):
- WR-8 builder aa5e07ebd4e9451cc paused by me at 82% 5-hour usage. Committed: 7106e0f (review fixes). UNCOMMITTED in its worktree: the stance system fix + Defensive + softened pirates (second commit in progress). Resume via SendMessage: continue the stance/pirate commit, full gates + sweeps, report the win table.
- 0.13.11 builder acdecb40b9b099957 still running.
- 0.13.11 builder acdecb40b9b099957 ALSO paused by me at 85% (2h20m to reset). Committed through a87b798 (plan, formatter, combo + code seam, state + own save, engine core, prestige/skills/autos/milestones tests); 6 uncommitted files in its worktree. Resume via SendMessage first after the reset (user priority), then WR-8.
- 0.13.11 PLAYTEST (me, 2026-10-22): PASS Codes tab + NEW tag, empty -> "Type a code first.", any code -> "That code isn't recognized.", Enter in the code box never drives the pad, combo 10 keys + ShiftRight + real Enter opens the overlay and closes both windows, ShiftLeft neither counts nor clears, NumpadEnter clears and does not count, backdrop blur 6px, main tick bar keeps moving under the overlay, Buy 1 -> +1/s, Debug +1d pays 2 lasers x 86400 (178K Ore), 375px no sideways scroll, overlay buttons >= 36px. BUGS: (1) the overlay does not take focus when opened by the combo (activeElement BODY), so Escape does nothing until the player clicks inside; (2) Enter Code close button is 28x28 (< 36px). Tool note: the browser tool sends empty event.code for Shift_L/Shift_R, so Shift was tested with synthetic events.
- 0.13.11 DONE: prod 5186046; merged into feat (1117ce1, 292b8de). NEXT (tomorrow, weekly budget): WR-8 review of 34a1f3e + c627efe + d7be269 (branch worktree-agent-aa5e07ebd4e9451cc, needs to merge current feat first), then merge; then rarity readiness slices; GG-6/EM-3/EM-4 etc.
- NEW 0.14.0 slice R2-10: relics feed the minigame (docs/plans/2026-10-17-relics-v2-plan.md, last USER ANSWERS). Needs a kind-to-lever [PROPOSAL] table for sign-off and a re-run of the minigame pacing sim.
- 2026-10-23 night: WR-8 merged (21ff7c8), EM-3 merged (060130b). Rarity readiness on branch rarity-readiness (worktree agent-aedd7d5667ee8eab6): RR-0..RR-6 built; RR-7 building; review of 4ac5e0e..d07c86d running. NEXT: EM-4 (transit lift), then RR-8 close-out + merge, R2-10 relic boosts in minigame, GG-6 UI (needs GG mockup v3 already signed), EM-7, etc.
- AT THE 4:17pm RESUME also tell the 0.13.11.1 builder: Captain resets feel useless after one or two (user); measure the gain per Captain reset and propose options so each feels worthwhile.
- 2026-10-26 STATE: PROD 0.13.11.1 @ e06c039. feat/crew-0.14.0 @ 26ae41a (0.13.11.1 merged 39f7713+0f99e69; EM-7 merged; 9491 tests green). NEXT 0.14.0 queue: EM-10 (Ship Systems Modules row + power bar + Fabricator Modules group + Help; NEEDS a mockup sign-off first; until then modules go on/off only via Armory loadouts, MODULE_INSTALL_ARMORY_ONLY), R2-10 (relic boosts in the minigame; needs a relic-type-to-lever table for user sign-off; diminishing returns), Survey Log mockup (GG-6, SURVEY_LOG_LIVE false), GG-7, R2-5..R2-9 (R2-5 needs exceptional sets + culture names sheet), ML-5/ML-7, gear wear step 4/5, FKR-11, SF-5..7, WR-7/WR-9..12, CP-3/4/5/9/10/11/13/14/16-18, EM-8. OPEN USER CALLS: rarity open calls 1-15 (rarity capture doc), EM-3 BR call, EM-4 worn-reactor + ordinary-core speed calls, R2-4 museum numbers, GG-4/5 picks, EM-7 PROVISIONAL numbers + tier/recipe PROPOSALs. Weekly 54% with 2d21h left (~15%/day ok); keep a prod-hotfix reserve.
- 2026-10-26 later: 0.13.11.2 PROMOTED to prod (main e06c039..cffd5bf, user "Promote now"); merge into feat with gates.
  CORRECTION: EM-10 and ML-7 did NOT need a new mockup: both were signed off AS DRAWN on 2026-10-21 (merge batch answers,
  "I approve all 4 mockups as is", mockup https://claude.ai/artifact/6Pat4nwfbWzsUsqKUdMpKo sections B and C). Both are
  building now. R2-10 table, strength (Gentle) and past-cap weight (5x) answered (relics v2 plan, last USER ANSWERS);
  R2-10 builds next.

## 2026-10-27 evening state and the user's question queue

feat/crew-0.14.0 @ bc0473e. Merged today: ML-7, EM-10, Survey Log live, R2-10, SF-5/6, GG-7, FKR-11 (9697 tests).
Building: FKR-8 (field device roll, worktree-agent-ad9f8f0efc07d898a). Built, NOT merged: gear wear step 4
(worktree-agent-a7ee00fa33710a9a5, 2f17c7d + 41e0fe8, 10151 tests green) held for the user's balance call below.
Minigame prestige redesign: design APPROVED (docs/plans/2026-10-27-minigame-prestige-redesign-design.md), plan
written (docs/plans/2026-10-27-minigame-prestige-redesign-plan.md); Slice 0 (goldens + relic timeline study) next.
User (2026-10-27, verbatim): "let's keep going with everything that doesn't need questions to be answered (that
doesn't have a requirement we'd have to skip to do so, of course). I'll let you know when I Get to that point!"
Usage: 5-hour 83%, weekly 75% with 1d13h left: slow pace, keep the prod-hotfix reserve.

QUESTION QUEUE (ask when the user is back, most important first):
1. Gear wear step 4: with true-condition combat (W3), Repeat patrols wear down until they LOSE (destroyer Repeat Sweep
   defeated after 14 cycles, battleship after 30; before step 4 they ran forever). Conflicts with W2 "nothing breaks or
   blocks a run" and sell peace. Options: (a) underway repair on Repeat keeps pace with average battle wear so a Repeat
   patrol settles at a steady condition and never loses to wear (Recommended); (b) a Repeat patrol pauses itself to
   repair at home when gear drops under a set line; (c) keep it (wear is a real cost; repair to keep going).
2. Gear wear step 4 smaller items: pod wear reduces drone hp and yield [PROVISIONAL]; battle raws first pass; patrols
   still record no use wear (reactor time, drive distance), logged for step 5; the Survey Pair set tier reads pristine
   (step 5).
3. Relic timeline study table (from minigame redesign Slice 0) before Slice 5 tunes the relic ceiling.
4. FKR-8 (field device roll): LURE_SALVAGE_PER_DIAL [PROVISIONAL] 1 (one Lure adds 20 to 30% salvage); whether the
   Lure's salvage boost should also cover cloaked-vessel battles (OC-F1 names only probe salvage; built for both). The
   stacked-device D23 fix was applied under the standing rule (no question needed).
5. Relic timeline study (docs/plans/2026-10-27-relic-timeline-study.md): 1,000 identified per tier takes a steady
   player 101 d (Tier I) to 3,761 d (Tier VII), heavy 15 to 848 d; first copy of all 17 types ~51 d steady, ~6 to 8 d
   heavy; 10,000 copies of EVERY type is ~744 years steady (~149 y counting past-cap 5x), ~88 y heavy (~18 y weighted),
   because the rarest type (Living Crystal) is 0.40% of drops. Calls: (a) where the relic ceiling's knee sits (the user's
   "10k of each" vs reachable timelines), or change drop rates; (b) no relic type is gated by tier today (Tier I can reveal
   every radiant type), which contradicts "you'll need higher tier content to unlock the last of that 16": gate the
   rarest types by tier?
6. Fix to schedule (no question): the R2-10 test helper relicCollections.ts bandShares applies the tier band odds twice
   (identification uses the Tier I row only), so the pinned heavy collection holds slightly too many rare copies; fix and
   re-pin with the relic ceiling slice.

2026-10-27 late: queue items 1, 3/5, 4 ANSWERED (gear wear "Pause to repair"; relic knee near full Tier VII + 1.0 ~2
years; tier stagger "Mix the T7 four" with 0.14.0; Lure keep both). feat @ 8c62a53 (9751 tests). PAUSED for the weekly
limit (user: pause at 80% until the Thu 10-29 reset). NEXT after the reset, in order: (1) resume the gear wear step 4
builder (worktree-agent-a7ee00fa33710a9a5) to build "Pause to repair", then review + merge; (2) relic tier stagger
build (relics v2 plan, 2026-10-27 table) + the bandShares test-helper fix; (3) minigame redesign Slices 1 to 7
(docs/plans/2026-10-27-minigame-prestige-redesign-plan.md); Slice 5 tunes the ceiling to a full Tier VII collection.
Gear wear step 4: pause to repair BUILT (c4785c2, 10224 green), reviewed "approve with fixes"; user calls answered
(repair first then go; count on the run). NEXT after the reset: resume worktree-agent-a7ee00fa33710a9a5 with the fix
list at the end of the gear wear design doc's 2026-10-27 block, then merge.
2026-10-28: user pacing "not beyond 95%" weekly until the Thu reset, then normal pace all week. Relic stagger empty-band
rule, user verbatim: "This is fine. Starting with standard/augmented is fine for Tier I." (sent to the stagger builder,
who records it in the relics v2 plan).
QUEUE (2026-10-28): minigame Slice 1 [PROPOSAL] picks for the user: Auto Captain at a second Fleet Prestige ("Fleet
Week, the Sequel"), Auto Fleet at e10,000 Ore, Auto Skill Allocation at 4 Prestigeceptions, names "Auto-buy Upgrades"
and the e20M / e25M milestone names and all flavor; skill caps/costs [PROVISIONAL] total 79 points (about 73 lifetime
Fleets, today's day-120 count). NAME CLASH: the minigame skill "Fleet Logistics" vs the main game's Homeworld talent
branch "Fleet Logistics": rename one.

## Model test queued (user, 2026-10-29)

User: "we should probably run a test on that first. The same task with both Opus and Sonnet, and see what happens. I
don't want to lose quality." Pick: "Yes, that task (Recommended)": after the Slice 5a retune finishes, build the WR-7
follow-up favorsSpec (OC-D5 "+10% on its ship type", per-run flag so in-flight runs stay byte-identical) twice from one
identical brief, Opus and Sonnet, each in its own worktree. Compare: gates, one blind combined review, fix rounds
needed, reported tokens. If Sonnet matches, it takes the wiring and UI slices; Opus keeps heavy balance work.

## Handoff (2026-10-30 ~02:30 UTC), feat @ 115bf35

Merged since the last notes: WR-7 a7e6a63 (gated 10,295 green), Captain's Sigil memorial 3383483 (keep its flavor
line as is), minigame Slices 3+4+5a 115bf35 (tree identical to the gated branch: 377 files green, check 0 errors).
User calls recorded in the wiring plan (2026-10-29) and the minigame plan (Slice 5a sections).
Next, in order (careful pace: one builder at a time, fresh builders, lean briefs; check get_usage before launching):
1. Opus vs Sonnet test: WR-7 favorsSpec (OC-D5 "+10% on its ship type", per-run stamp), identical brief, two
   worktrees, blind combined review, compare gates / fix rounds / tokens; report to the user.
2. Slice 5b: background visualization track + Faster Than Light per the signed-off mockup
   (docs/plans/2026-10-29-background-settings-mockup.html; design doc sections). The e25M popup already names it.
3. Slice 6 save conversion, Slice 7 UI + Help (Automation tab, leveled Skills tab; Auto PC row is on/off only).
4. Open: VARIETY_RESIST_RATIO 0.1 [PROVISIONAL]; WR-7 follow-up patrol legs (goldens first); remaining 0.14.0 queue
   (WR-8..12, ML-5/6, EM-8/9, R2-5..9, gear wear step 5, GG-8, SF-7, CP slices, wiring gate before staging).

## Handoff (2026-10-30 ~15:30 UTC), feat @ 2a69178

Merged since 502a0c8: favorsSpec b82ad72 (Opus build + fixes, 10,379 green; Opus vs Sonnet result in
feedback memory: keep Opus, marathon vs burn modes), Slice 5b 2a69178 (Background setting + Faster Than Light, 10,427
green; visually checked in dev, no console errors; dev unlock: Settings > Debug > "Grant Faster Than Light unlock").
Slice 5b deviations from the mockup to show the user at QA: only existing backgrounds listed (no future locked rows);
readability guard makes panels near-opaque while a visualization runs; Still follows the game's Reduce motion
setting; Jump burst also plays on game open; DPR capped at 1.5.
Backup: refresh the Proton Drive bundle after each merge (reference memory). 84 merged worktrees removed 2026-10-30.
Next: Slice 6 save conversion, Slice 7 UI + Help (Automation tab, leveled Skills tab; Auto PC on/off only), then the
remaining 0.14.0 queue in the earlier handoff. Pace: marathon mode, one fresh Opus builder at a time.

## Handoff (2026-10-30 later), feat @ af0320b

Slice 6 save conversion merged (af0320b: bb20c2e + daf83bf real 0.13.11.2 fixtures; 10,454 green, check 0 errors;
combined review approved, no correctness bug). User picks (2026-10-30): over-owned old skills keep every level with no
debt; a buyer who switched Auto Prestigeception off stays off on reveal; allSkills stays recorded as earned history.
Backup bundle refreshed. Next: Slice 7 UI + Help (Automation tab, leveled Skills tab; Auto PC row on/off only, no
target menu), then the remaining 0.14.0 queue. Pace: marathon mode, one fresh Opus builder at a time.

## SESSION PROTOCOL (user, 2026-10-30): one session per slice, reporting to the hub

User (verbatim): "Perhaps each slice/phase/etc is engaged in a new session that reports back to the main one, and you
two can communicate back and forth if there are specific questions on missing context for decisions, etc. Since that
session would report back to you, yes? That way, no assumptions are made, and the session reaches out to you if
something is missing."
- HUB: the Claude Desktop session titled "HL Hub" (address `HL Hub` via ListAgents/SendMessage). It holds the
  conversation with the user, the question queue and the decisions; it stays lean (short reports in, no file dumps).
- SLICE SESSION: a fresh session in the fleet-admiral folder per slice/phase. Starts from these notes, runs the usual
  workflow (fresh builder, goldens first, combined review, fixes, merge with full gates, Proton bundle refresh,
  handoff commit here), then ends.
- MISSING CONTEXT: never assume. SendMessage `HL Hub` with the specific question; wait for the answer. The hub answers
  from docs, git and the user's own words; a game DECISION is still the user's: the hub asks the user (multiple
  choice) and relays the answer verbatim, which also gets recorded in the plan doc.
- REPORT BACK: on finish (or when blocked), SendMessage `HL Hub` a report under 200 words: commits, gates, user calls
  needed, deviations, next step. The handoff commit here stays the durable record.
- One slice session at a time in marathon mode; parallel slice sessions only in burn mode.
- WORKTREE SAFETY (2026-10-30 incident, docs/ops/node-modules-incidents.md): every builder brief says "run `npm ci` in
  your own worktree; never junction, symlink or copy node_modules". Before any `git worktree remove`, check the
  worktree's node_modules for a link and remove the link alone first (`cmd /c rmdir`). Before ending, each slice
  session removes its own merged builder worktrees (stop a live agent first, then `git worktree unlock` and remove).
  If node_modules is ever found empty, follow the incident log's steps before reinstalling.
- The hub rotates too: when its context grows large, it writes a handoff here and the user opens a fresh hub with the
  same title.

## Handoff (2026-10-30 evening), feat @ 14c0e6e (+ this notes commit)

Slice 7 UI + Help merged (14c0e6e: 7842f84 + 39a9f7b review fixes and the Automation tab NEW marker). Gates on merged
feat: 10,478 passed, 308 skipped; check 0 errors (2 old RadialWeb warnings). relicGoldens re-pinned: six past-finale
states only gain "automationsNew":true (Auto Skill Allocation unlocks in their window); goldens.json unchanged.
User picks (2026-10-30): four new AUTOMATION_LINES approved as written; e25M reward line approved; dimmed "ahead"
automation rows kept; NEW marker built. QA sheet: docs/qa/2026-10-30-minigame-prestige-redesign-qa.html.
Minigame prestige redesign Slices 0 to 7 are all merged; the redesign awaits the user's QA pass.
Incident: the main checkout's node_modules was found empty (mtime 11:40:40 PDT, cause unknown; the hub ran no npm or
cleanup then); restored with npm ci from package-lock.json. Builder worktree agent-a4f30434476d21c47 still locked by
its agent process (branch worktree-agent-a4f30434476d21c47 merged; remove later). Builder note: vitest's dependency
cache would not rebuild in fresh worktrees ("Could not resolve 'node:module'"); builders used an uncommitted config.
Next: user QA of the redesign; then the remaining 0.14.0 queue (handoff 2026-10-30 ~02:30 UTC item 4).

## Hub note (2026-10-30 ~19:20 UTC), feat @ 7f38fad

User QA call: QA of the minigame prestige redesign is deferred. User (verbatim): "Later then. We'll just have a very
massive QA doc that we'll be going through in the end, which is perfectly fine. Let's continue forward with more of
0.14.0." So: collect every 0.14.0 QA sheet into one release QA doc before staging (start with
docs/qa/2026-10-30-minigame-prestige-redesign-qa.html). QA sheets POINT AT STAGING: user (verbatim, correcting me):
"QA should point me at staging. Devpreview exists solely for testing and QA purposes." 0.14.0 still reaches staging
only after the wiring gate passes and the user says go, so the release QA doc is run on staging then.
NEXT SLICE SESSION, in order:
1. Housekeeping: remove the merged, locked worktree agent-a4f30434476d21c47 (stop its agent if live, unlock, check
   node_modules is not a link, remove). Reproduce the "Could not resolve 'node:module'" vitest failure in a fresh
   worktree with its own `npm ci`; fix it or record why before any builder launches.
2. WR-7 follow-up patrol legs (goldens first), after reconciling the wiring plan's WR-7 notes ("verify notes before
   build").

## SESSION PROTOCOL SUPERSEDED (user, 2026-10-30 ~19:45 UTC)

User (verbatim): "Looks like our plans weren't working that well. Looks like we'll just continue doing what we're
doing now and keep using subagents until Anthropic allows for trusted sources to spawn sessions from a remote control
connection."
- ONE conversation again: the hub conversation does everything, and slice work goes to fresh builder SUBAGENTS as
  before. Do not ask the user to open sessions by hand. Revisit only when sessions can be spawned from a Remote
  Control connection.
- Still in force from the protocol: the WORKTREE SAFETY rules (builder briefs forbid node_modules links; check for a
  link before any `git worktree remove`; clean up merged builder worktrees), the incident log, and the QA calls
  (release QA doc at the end, on staging).
- Full gates = suite + check + test:perf (`npx vitest run --maxWorkers=4 --testTimeout=60000`, `npm run check`,
  `npm run test:perf`: the wall-clock tests, *.perf.test.ts, run alone and serially, never in the parallel suite).
- Next work is unchanged: housekeeping (the locked worktree agent-a4f30434476d21c47, the vitest "node:module" repro),
  then WR-7 patrol legs.

## RELEASE PIPELINE (user, 2026-10-30)

User (verbatim): "any time we're going between various slices, we want a slice to appear in that repo first. Bit by
bit as needed. So it makes rewinding our progress easier and better. It only deploys to that repo. Then, when ready
for testing, we use staging to do a live test. Then it pushes to prod after that."
1. DEV (every slice): after each slice merges into feat with full gates, push feat to the private remote `backup`
   (github.com/Scythrael/HyperionLegacy_Dev) with an annotated tag `slice/<id>` on the merge commit (rewind points),
   plus the Proton bundle. Tags and feat go to `backup` ONLY, never to origin.
2. STAGING (live test): when the release is ready (wiring gate passes + user go): `git push origin <local>:staging`.
3. PROD: promote main from staging only on the user's explicit trigger.
First tag: slice/wr7-oc-d8-patrol-legs at 336db4a.

## Hub queue (2026-10-30 ~23:10 UTC), feat @ 0ac9f40

Merged today after Slice 7: OC-D8 patrol legs 336db4a (tag slice/wr7-oc-d8-patrol-legs), OC-D8 follow-up 0ac9f40
(Fast Departure/Return on patrol legs, flown-tick run clock, exact crewHoursMs; tag slice/oc-d8-patrol-crew-lifts;
10,501 green). Both in the dev repo and Proton.
Dependency-ordered queue (planning pass): CP-3 (unblocks WR-9, WR-10) -> WR-11 -> GG-8; alternates EM-8, CP-5,
SF-7, G1-7, CP-4 rest, CP-14, CP-16, CP-17/18, ML-5, ML-6 (mostly superseded: verify and close), CP-11 -> CP-12 ->
CP-13; then WR-9, WR-10; R2-5..R2-9 and completion tracking after the name sheets; CP-21, G2-9, WR-12 last.
Moved to 0.14.x: EM-9, G2-8, CP-15, the Spacer ramp. Tutorial hooks: nothing left in 0.14.0.
USER CALLS THAT BLOCK WORK (most blocking first): (1) relic name sheets, 54 exceptional + 42 culture names, NOT
drafted yet (relics v2 plan 2026-10-19 "Still open: the name sign-offs"), block R2-5..R2-9 and completion tracking;
(2) gear wear step 5 UI sign-off (no approval recorded); (3) CP-10 mockup + CP-9 manifest sketch (not drafted);
(4) CP-19 home and cost (OC-17 / OC-C4); (5) endless telescope cycles name; (6) Wolf 359 nod; (7) CP-20 graph colors.
Before the release gate: VARIETY_RESIST_RATIO, EM-3 call 4 (Battle Rating), EM-4 worn-reactor + mass-cut, R2-4 Museum
numbers. Stale: registry.ts:517 says Pilot Cunning "pending user decision" but OC-E4 was answered 2026-10-15
("Quicker trips home"); WR-9 builds it.

## Hub note (2026-10-31 ~01:30 UTC): CP-3 and WR-11 merged

CP-3 a158982 (tag slice/cp-3-ground-ops-complement, 10,521 green; user calls in the complement plan 2026-10-30).
WR-11 f5c5284 (10,610 + the catchUp timing test, which flakes under parallel load and passes alone 40/40; release
gate pending 80 -> 47). WR-11 [PROVISIONAL] numbers for the balance pass (pre-release-gate list): PoI relic x1.5 /
x2 and materials x1.25; Ocean surface x1.25; anomaly sensor reference 40, haul scale 0.5; salvage tilt 0.5, knee 1;
sell prices Salvaged Circuitry 12 cr, Precursor Circuit 300 cr. Open (non-blocking): should the reserved FA 20 row
also tilt the salvage odds? Next: GG-8, then alternates (EM-8, CP-5, SF-7, G1-7, ...), WR-9 and WR-10 now unblocked.

## Hub note (2026-11-02): user calls closed

ANSWERED 2026-11-02: CP-19 (Personnel Rosters track), telescope cycles name ("Deep Field Refinement"), Wolf 359 nod
(quiet derelict field), CP-20 (Default / Colorblind / Mono). Gear wear step 5 UI: NOT approved yet; mockup
https://claude.ai/artifact/HRa9zUf1XRrPoh9tuinhEF shown to the user for sign-off. Relic name sheets and the CP-9 /
CP-10 mockups are being drafted. PROD is 0.13.11.3 @ eaf1fb8 (offline cap 4 days), merged into feat 7c553ac.

## Hub handoff (2026-11-02 ~23:40 UTC), feat @ 94e27b3

PROD 0.13.11.3 @ eaf1fb8 (offline cap 4 days). Merged into feat since 2026-10-30, each tagged slice/<id> in the
backup remote: OC-D8 patrol legs + follow-up, CP-3, WR-11, GG-8, WR-9 (+ catchUp perf split: full gates = suite +
`npm run test:perf` + check), hotfix 0.13.11.3, EM-8, CP-5, SF-7, G1-7, CP-9. 10,848 green. Release gate pending 37.
Systems DONE since the v12 card: gas giants, safe first runs, short-range missions (card update pending the user's
call).
Approved, ready to build: CP-10 (mockup + A/B picks in the complement plan), E5 Refugee Posts (design, mockup, plan
docs/plans/2026-11-02-refugee-posts-e5-plan.md, slices E5-0..E5-7), gear wear step 5 UI (mockup approved), CP-19
(Personnel Rosters track), CP-20 (graph presets), telescope "Deep Field Refinement", Wolf 359 quiet derelict field.
OPEN user calls: gear wear use floor (built 60% vs "no floor") and Quick Service (Oct 16 paid rush vs "none") block
gear wear step 5; relic names: structure answered, user loves the sheet, the Keelsong and Ember Court homage flavor
lines need drafting for sign-off, then "approve all".
Queue: CP-10 -> E5-0..E5-7 -> CP-11/12/13, CP-14, CP-16, CP-17/18, CP-19, CP-20, ML-5, ML-6 verify, WR-10, OT-UI,
G2-7, R2-5..R2-9 after names, completion tracking, close-outs, wiring gate, then staging on the user's go.

## Hub handoff (2026-11-04 ~03:20 UTC), feat @ 3c676c0

Merged since fa44a97 (each tagged slice/<id> in backup): CP-10, E5-0..E5-7 (refugee posts complete except E5-6b echo
refugees), the short-range fleet parity fix, CP-11. 11,085 green; release gate pending 37. Progress card v13 published
(84% built / 59% to release; 25/9/1 of 35).
OPEN for the user: (1) relic names: final read; Keelsong/Ember Court homage lines to draft; (2) echo roster names
(docs/plans/2026-11-03-refugee-echo-roster-DRAFT.md): final read, structure answered (59, once per save, one mark);
(3) gear wear use floor + Quick Service (block gear wear step 5); (4) CP-11 recipe swaps (Engineering/Science Quarters,
Guest Wing) sign-off; (5) talent web light stopped on devpreview: hub diagnosis = Reduce motion (game setting) or
device reduced-motion/battery saver; awaiting the user's check.
NEXT: CP-12 (Bridge/Quarters install tiles, mockup CMR-9; flips bridge+quarters:obtainable), then CP-13, CP-14, CP-16,
CP-17/18, CP-19, CP-20, ML-5, ML-6 verify, WR-10, OT-UI (Deep Field Refinement), G2-7 (Wolf 359 derelict field),
E5-6b (echoes + a [DEV] grant-refugees button, then browser-check toast tuck / Leave all / Help links), R2-5..R2-9.
0.14.x: the behavior-preserving cleanup pass (roadmap doc).

- WORKTREE SAFETY addendum (2026-11-04): a builder left its vite dev server running from its worktree, which locked the folder and made `git worktree remove` fail. Every builder brief says: stop any dev server you start before reporting. If a removal fails, find node processes whose command line names the worktree, stop them, then remove (after the link check).

## Hub handoff (2026-11-04, later), feat @ 658014c

Merged since 3c676c0 (tagged in backup): CP-12 (Bridge/Quarters install tiles), CP-13 (hull-family module bonuses).
11,146 green; perf 2/2; check 0. Progress card v14 (counts unchanged). Talent web light: closed (stale cache).
IN FLIGHT: CP-14 (hull base sensors + Science crew/officer sensor lifts) built (08bbf4d, fd346cc), reviewed (no
Critical/Important), fix round running in its worktree. User CP-14 answers (recorded in the complement plan by the fix
round): Science lifts stay separate from other crew boosts; bare explorers clearing Tier II to IV gates is intended;
"Retire the dead gates" (drop sensor gates that can no longer bind; drive class paces tiers).
OPEN for the user: unchanged items (1) to (4) from the 03:20 note.
NEXT after CP-14 merge: CP-16, CP-17/18, CP-19, CP-20, ML-5, ML-6 verify, WR-10, OT-UI, G2-7, E5-6b, R2-5..R2-9.
Stale worktrees under .claude/worktrees (7 besides CP-14): old, leave until a safe-removal pass.

## Hub handoff (2026-11-10), feat @ 8030689e

BURST mode (user 2026-11-09: parallel builders until weekly ~65%; reset Thu 11-12 12:00 UTC). Merged since 61664dd, each
tagged slice/<id> in backup: CP-14, CP-16, CP-17, CP-18, CP-20, G2-7 (Wolf 359 derelict field + enemy territory
shading), CP-19, gear wear step 5 (patrols wear by combat only, user "Combat only on patrols"; Quick Service dropped;
Overtime button on the gear card), ML-5, OT-UI (Overtime buttons on every job), WR-10. 11,540 green.
Deferred by the user: Deep Field Refinement waits for rare planet aspects ("Wait for aspects").
OPEN for the user: relic names final read (+ Keelsong / Ember Court homage lines to draft); echo roster names final
read; CP-11 recipe swaps sign-off; WR-10 OC-F14 (field repair button: answer + sketch) and the OC-F12 account default
control (mockup); ML-5 patch-note wording (at release).
Lessons this stretch (memory feedback_decisions_are_the_users): scope lists I write are not the user's words; state
test conditions with any measured number. Builder briefs now say: build only what traces to the user's answers.
Process: parallel builders branch from different feat heads, so golden read-back chains conflict at merge; resolve by
putting the newer slice's ReadBack innermost, then run every *Goldens file (cp18 needed a C1 trace after gear wear).

## HUB HANDOFF (2026-11-11 evening) @ 7615d73f

Burst day (user: burst until weekly 80%; weekly ~53% at handoff, reset Thu 2026-11-12 12:00 UTC). Merged today, each
tagged `slice/<id>` and pushed to `backup`, Proton bundle refreshed after each: WR-13 (old fuel economy removed, OC-C4
seams tested), WR-8b (enemy torpedoes, Marauder curve smoothed), OC-G1 (legacy expedition path deleted), patrol sweep
re-pin, CP-4 rest (Flight Deck Integrity, Flight Deck's own share), G2-9 close-out, ML close-out, CP-21 close-out (crew
pool perf guard), gear wear close-out, ordering determinism parts 1 and 2. All 91 stale worktree branches cleaned; the
superseded favorsSpec attempt kept as tag `archive/favorsspec-superseded-0f13a3aa` (backup).
Release gate: 6 pending rows (away:audit:fieldRepairOrder, away:audit:accountDefaultControl, four relic rows).

Hang guards (user 2026-11-11): timeouts on every long command; Windows task "HL Dev Watchdog" (C:\Users\berga\.hl-watchdog);
30-min check-in cron while work is out (deleted when idle; recreate when work starts).

OPEN USER QUESTIONS (asked in chat as text while the user was away; re-present as pop-ups when back, most important first):
1. Notable ticker: build the Personnel header ticker the user asked for (2026-10-16), or keep the per-ship strip.
2. crewPool size: send surplus crew to homeworld staffing, or leave unbounded (speed fix already merged).
3. Deck Handling in combat: keep it (and the Flight Deck lift) on the in-combat replenish pod, or limit to between waves.
4. Assign-to-ship button for an unassigned notable: log or mock up.
5. Audit call 14 sensors leg (Hydrogen/Methane): log for balancing or propose a sensor blueprint.
6. Class VI/VII drive fuel: keep Deuterium alongside antimatter, or antimatter only.
7. Comet run numbers and tier III+ reactor fuel: leave for 0.16.0 or review now.
8. Docked Overtime carrying into a repair-first pause (`DOCKED_OVERTIME_CARRIES_INTO_FIRST_PAUSE`, built, marked OPEN CALL).
Also open: OC-F14 field repair and OC-F12 new-hire default mockups (docs/mockups/2026-11-11-*.html, sent to the user);
CP-11 recipe sign-off; relic and echo names; credit sink to replace Quick Service; completion tracking plan; WR-12.
Status page: artifact tools were down this session; latest local version sent to the user as a file
(scratchpad status/progress-0140-v16.html: 93% built, 65% to release). Republish to the existing link in a new session.
