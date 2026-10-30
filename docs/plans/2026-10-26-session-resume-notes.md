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
