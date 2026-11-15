# Roadmap order and release gates (living doc)

Set by the user 2026-10-22 ("0.14.1 online, 0.15 story, 0.16 balance"); supersedes the older orders in
docs/plans/2026-09-15-exploration-crew-saga-0.14.0-design.md (:31 and :590-591).

| Patch | Content |
|---|---|
| 0.13.11 | Hotfix route: Settings > Codes + the secret game (docs/plans/2026-10-22-hotfix-0.13.11-secret-generator-design.md) |
| 0.14.0 | Crew + Exploration (active, `feat/crew-0.14.0`) |
| 0.13.11.1 | Codes and minigame follow-up (strip, SUPERDUPERLEET, joke lines, Help/Minigames/Settings block, Upgrades tab, e10,000,000 stretch, Starfall prize theme) |
| 0.14.1 (or 0.14.x) | Online, a subpatch right after 0.14.0; also the developer's personal red/gray/gold theme once accounts can tell who is who |
| 0.14.2 | Desktop layout pass (mobile stays; inspired by a friend's project, screenshot to come) |
| 0.14.3 | Achievements: main-game achievements, the theme builder (moved from 0.14.2), minigame rewards paying out (back pay), real codes and giveaways; systems fully wired, numbers balanced in 0.16.0 (outline: docs/plans/2026-10-23-0.14.3-achievements-outline.md) |
| 0.15.0 | Tutorial, story and quests |
| 0.16.0 | Balancing (and content) patch |

## Release gates (a patch cannot START until its gate items are done)

0.16.0 balancing:
- Quality on ships and field kits implemented end to end (user 2026-10-22, "make absolutely sure that it's
  implemented in time for the balancing patch (0.16.0)"; source: docs/plans/2026-10-22-rarity-quality-readiness-capture.md
  answer 11b).
- Every planned rarity tier switch-on ready (0.14.0 builds the readiness work; same doc, answers 1 to 10).
- Weapon-specific crafted components (Plasma Cannon, Point-Defense Array realism fixes; recipe realism audit:464).

## Tutorial AI line (user, 2026-10-23, for 0.15.0)
The tutorial AI should voice humor in adversity, for example: "Studies have found that a little humor in the face of adversity results in an improved mood and extra productivity." (source: docs/plans/2026-10-22-hotfix-0.13.11-secret-generator-capture.md, answer F3)

Future theme work (user 2026-10-23): a theme STYLE dropdown with the gradient types (A wash, B edges, C one sweep, D wash plus shine) next to the color theme selector.

0.14.2 theme builder idea (user 2026-10-23, verbatim): "Also. another idea for 0.14.2 as well. The theme unlocks. We
might consider theme style unlocks, and then a color selector section where we select from teh colors we want. So, for
example. The game then uses the selected colors and the theme style to generate one. So if blue/purple are selected
and the wash plus shine style are selected, we get the reward offered now. If I choose red/black, we get a red and
black version. We will want to make sure that when super dark colors are chosen (like black), the text doesn't become
unreadable, so we might have a light gray in the text where black would appear."
Reading: unlockable theme STYLES (A wash, B edges, C one sweep, D wash plus shine) plus a color picker for the gradient
stops; the game generates the theme from style + colors (blue/purple + D = today's Starfall). Guard readability: when a
chosen color is very dark (for example black), text and accents that would use it switch to a light gray, with an
automatic contrast check (AA). Build note for 0.13.11.1: implement Starfall's two gradient stops as tokens (start =
accent, end = purple) so 0.14.2 can feed user-picked colors into the same tokens.
User (2026-10-23): "Once that is live, the unlock the e10,000,000 provides is the wash plus shine style." So once the 0.14.2 theme builder ships, the e10,000,000 reward becomes the wash-plus-shine STYLE unlock (usable with any picked colors); until then it is the fixed Starfall theme (accent to purple). Players who earned Starfall before 0.14.2 keep it and get the style unlock.

0.14.2 theme presets idea (user 2026-10-23, verbatim): "Ooooh. here's an idea as well. We have presets that unlock
along with features. So you can select a preset. Default is the starting theme that the game ships with, witht eh same
color. When you unlock Starfall, you get that preset, but when you click "Manual" you get the options for Theme Style,
and appropriate dropdowns that become active or inactive based on the theme style you select. Colors are unlockables
too. So we'll keep the ones we have now, but we may have to add in new colors and so forth haha."
Reading: Settings > UI gets a PRESET picker (Default = today's shipped theme and color; Starfall unlocks as a preset at
e10,000,000; more presets unlock with features) plus a "Manual" mode that reveals Theme Style and the dropdowns that
style needs (enabled or disabled by style, for example one color for flat, two stops for gradients). COLORS are
unlockables too: today's accent colors stay unlocked for everyone, new colors get added and unlocked later. Build note
for 0.13.11.1: keep Starfall as data (a preset record: style id + color stops) so it slots into this picker as-is.

Balancing method (user 2026-10-23: "Then we will build off of this for our balancing plans and such as well."): the 0.13.11.1 minigame tuning approach is the template for the 0.16.0 balance pass: simulate OPTIMAL, AVERAGE and CASUAL player profiles; report time to each milestone; measure the FELT effect of each reset or upgrade (multiplier gained per action), not just totals; check that no setting or strategy beats the default by more than a small margin; tune one layer while holding the overall pace; present options with numbers and let the user pick.

## 1.0 content length target (user, 2026-10-27, verbatim)

"I'm thinking ~2 years of content from start to finish for 1.0 overall." (Said about relic collection pacing: "we will
be able to handle the proper balancing to ensure that the game doesn't take 700 years to complete.") The 0.16.0
balancing pass tunes drop rates and pacing toward about 2 years from start to finish for 1.0.

## 0.14.x CLEANUP PASS (user, 2026-11-03, verbatim)

"I think that we should also have a 0.14.x pass where we do a check through the code for culling redundancy and do
some optimization without causing issues with the overall game, making sure that any changes we plan on making cause
no changes whatsoever to the actual operation of the game. To ensure that everything is AOK and won't come back to bite
us later."
Hub reading for the plan (when 0.14.x starts): a behavior-PRESERVING pass only. Every change must leave the game's
operation identical, proven the way this codebase already proves it: all goldens and pins unchanged (no re-pins
allowed in this pass), offline == live and chunked == 1 s steps suites green, save round trips byte-identical, the
perf suite equal or faster. Scope ideas: duplicate helpers and dead code (the switch fixtures and *ReadBack layers
that only serve finished slices), large files split (App.svelte, model.ts, tick.ts), the per-tick costs noted in
reviews (e.g. the CP-10 transfer preview, the chunked catch-up on phones in SUGGESTIONS.md). Done as small reviewed
slices, each tagged in the dev repo so any one can be rolled back.

**Ordering wrinkles found by CP-14 / CP-16 parity tests (2026-11-06, hub log):** values match across chunkings, but
(1) `state.discovered` lists the same items in a different order after one big `economyTick` call than after 1 s
steps, and (2) with two captains, the key order of `lifetimeStats.missionsCompleted` differs between chunkings.
Production only steps 1 s or less, so players are unaffected today. Fixing it changes output order, so it is NOT part of
the behavior-preserving pass: give it its own small determinism slice (goldens first) before the release QA rounds.
Related: survey parity at 997 s chunks differs because an extraction's berth budget is per call (EM-4 precedent).
**Perf finding (2026-11-09, gear wear step 5 verification, NOT caused by step 5):** offline catch-up costs about 4 ms
per crew transport window, and `crewPool` has no size bound (a test save that skipped 1,666 windows built a 172 KB pool
and slowed later ticks to 1.4 to 2 ms on both old and new code). Real saves keep `lastTransportWindow` current, so play
is unaffected today; look at it with the chunked offline catch-up item in SUGGESTIONS.md (long absences on phones).

## Ordering determinism slice BUILT (2026-11-11)

Both wrinkles above are fixed at the source (`src/lib/game/canonicalOrder.ts`). Root cause: economyTick runs each
captain over the whole call before the next, then processes and the other passes, so a big call meets captain 1's later
find (or first completion) before captain 2's earlier one; 1 s steps meet them in time order. Fix: `discovered` and the
four lifetime tally maps (itemsGathered, itemsRefined, itemsCrafted, missionsCompleted) are re-sorted into canonical
(code unit) order whenever an entry is ADDED (addToInventory, a salvage payout's reveal, the carried field kits'
return, the lifetime fold, the refine and fabricate tallies). Sorting at insert rather than first-seen time order: time order would need the exact game
second of every grant from every pass, and two events inside one live step would still tie; nothing reads either list's
order (the UI reads `discovered` as a set, the tallies by key or as a sum). Values unchanged; old saves load as they are
(no reorder on load, no SAVE_VERSION bump), and their first new entry sorts the whole list the same way in every
chunking. The first-find relic registry (`relicDiscovered`) is not touched: the relic study lanes already deposit it in
completion order in every chunking (a parity case proves it). Goldens first: `orderingGoldens.*` (pins
captured on 2c66d749), switch `orderingSwitch.fixture.ts`, parity `orderingParity.test.ts` (one call == 997 s chunks ==
1 s steps, byte for byte); `cp16HallOfCommand`, `cp14HullSensors` and `emodEm4` no longer normalize `discovered`. 49 older golden files (cp4FlightDeckGoldens among them, merged from feat)
moved; each now runs with the slice off (`canonicalOrderOffForThisFile`), and a trace run (every JSON.stringify seen
with these lists in canonical order, slice on against off) matched hash for hash in all of them except save stamps that
also differ between two runs with the slice on.
Still open, same family: the key ORDER of `inventory` differs between chunkings when one call meets two new items in
another order (shortRangeCycle, refugeeGoldens and emodEm4 parity tests sort object keys for it); a fix would put
inventory keys in canonical order and move most whole-state goldens, so it needs its own call. Also found: the
completion log lists relic studies that finish inside one call in process array order, 1 s steps in completion order
(a player-visible list, so its fix wants the completion time order, not a sort). NOT fixed, different
family: one economyTick call spends one transit berth budget (the EM-4 precedent), so a call spanning more homecomings
than the free berths differs in VALUES (a 4 hour one-call run of two captains lands 10 long-run cycles instead of 60);
making it chunk-independent needs a time-ordered berth scheduler across captains. Production and the offline catch-up
step 1 s, so players are unaffected.

## Ordering determinism part 2 BUILT (2026-11-11)

Both "still open" order wrinkles above are fixed at the source (`src/lib/game/canonicalOrder.ts`, part 2 section).
(1) `inventory` key order: every inventory write goes through ONE seam, `inventory.ts setItemBuckets` (addItemQuality,
removeItemQuality, removeItemLowestFirst, removeItemHighestFirst and ensureItem return through it, and every engine
writer uses those: addToInventory, refining and fabricating, salvage, expedition claims, transports, the Quartermaster,
field kits, relic and Museum flows, debug grants; the field kits switch probe now calls it too). A NEW key puts the
whole map in canonical (code unit) order; a key already held keeps its place (the hot path: one spread, no sort). A
deleted key leaves the rest in their order (only the save migration and a dev probe delete). Not routed, by design: the
save migration builds an old save's map in its stored order (old saves load as they are, no SAVE_VERSION bump; their
first new key sorts them the same way in every chunking), and the Material Lines explainer builds a local example map,
not state. No UI reads the order (the Warehouse and every surface iterate the ITEMS catalog; the engine's own key walks,
the cap clamp and the load-time discovery reconcile, act per key). (2) The completion log: resolveProcesses now queues
each completion's record (with the levels as they stood) and folds them by the whole tick each completed on, then by
process id ("proc-9" before "proc-10"), so one call logs and numbers them as 1 s steps do. Entry text and stamps are
unchanged; only the order and the `done-N` numbering of entries completing in one call can differ from before (within
one 1 s step, same-tick completions now go by process id, not array position: relicsV2IdentifyGoldens golden 3).
Goldens first: `ordering2Goldens.*` (pins captured on 29993f09), switch `ordering2Switch.fixture.ts`, parity
`ordering2Parity.test.ts` (one call == 997 s chunks == 1 s steps, byte for byte, its inventory and log cases failing with the switch
off; an old save in first-seen order and a same-tick tie in non-id array order included; compareProcessIds unit tested; relicsV2IdentifyGoldens golden 3 also pins its new order with part 2 on). The shortRangeCycle, refugeeGoldens and emodEm4 parity checks and the
orderingParity salvage and relic cases are now strict JSON compares (shortRangeCycle and orderingParity fail with part 2
off; refugeeGoldens and emodEm4 already agreed once part 1 held). 55 older golden files moved; each runs with part 2 off
(`ordering2OffForThisFile`), and a trace run (every JSON.stringify with the inventory keys and the log normalized, part 2
on against off) matched hash for hash in all 55 except save stamps that also differ between two runs with it on.
Perf: addToInventory on a held key (55 keys) about 820 ns before, 780 ns after (noise); a 4 hour catch-up in 1 s steps
about 775 to 835 ms before, 645 to 665 ms after (noise, no regression). Still open (found reading the code, not
fixed): economyTick appends the patrol endings and appendShortRangeLog's three line types (short-range relic finds,
run ends and refugee arrival lines) AFTER resolveProcesses' records, and the patrol endings always before every
short-range or refugee line whatever their tick. So a call in which a patrol ends, or a short-range or refugee line
lands, BEFORE a process completes logs the process first while 1 s steps log them in time order; and a call in which a
short-range or refugee line lands before a patrol ends logs the patrol first (ordering across passes would need every
pass's completion tick). No parity run meets it; production and the catch-up step 1 s.

## QA PROCESS ADDITION (user, 2026-11-12): a Fable QA and bug-check run

User, verbatim: "once we get to the point where we're ready for QA, I decided to throw in a small wrench into the gears
as our normal process from now on. At least, tentatively. It'll be fun!" and "A full QA and bug check run using Fable
5.2 since the token use has improved dramatically. So more planning, and potentially checking for things we should add
to the QA list, and so forth would be quite fantastic, I think. But I know we're not quite there yet. We'll have to build
every system first."

How it slots in (proposal, the user decides the details when QA starts):
- WHEN: after every 0.14.0 system is built and closed out (the wiring gate passes), before the QA rounds on the road map.
- WHAT: Fable runs (subagent model "fable") for (1) QA planning: read every system's plan, answers and QA sheet and list
  what the QA list is missing; (2) a full bug check across systems, read-only, with concrete failure scenarios; (3) its
  findings feed the existing loop (fix, verify, next round) next to the planned human and AI testers.
- Tentative: the user said "at least, tentatively"; confirm the scope and cost estimate with the user before launching.

## 0.14.0 on staging (2026-11-13)

User answers: holistic review "Fold into the Fable sweep (Recommended)"; staging "Go to staging now" (pushed
feat/crew-0.14.0:staging, eaf1fb80..c8a29e66, fast-forward; production unchanged); patch notes "Draft now (Recommended)".
Release QA sheet: docs/qa/2026-11-13-0140-release-qa.html. Next: the Fable QA sweep (confirm scope and cost with the user
first) and the QA rounds.
- (2026-11-13) Fable QA sweep scope: "Full sweep, 4 lanes (Recommended)": four Fable agents in parallel, each owning a
  slice (economy and crafting; crew, complement and refugees; expeditions, ground ops, relics and completion; combat,
  patrols, gear wear and Overtime): plan, find QA-list gaps, bug-check read-only; the hub merges one findings ledger.
  Patch notes drafted (docs/patch-notes/0.14.0-DRAFT.md, discord-0.14.0-DRAFT.md) for the user's review.

## Fable pass 2 PROPOSAL (2026-11-14): bug, security and online readiness

User ask (verbatim): "A full bug amd security check, as well as any vulnerabilities that could cause problems with online
capability." APPROVED by the user 2026-11-14 ("Yes indeed"; finish the current QA first, then update this plan with anything needed). Run AFTER the QA fixes and Codex's pass land:
1. Security lane: XSS / unsafe HTML on any player text or imported save, save import validation (schema, size, NaN or
   Infinity poisoning), dependency audit, secrets or debug code in the production build, Vercel headers and CSP.
2. Online readiness lane (threat model for 0.14.1): what the client decides that a server must not trust (rewards,
   credits, rolls, the CLOCK: offline catch-up trusts device time), which actions the server must re-check, replay-based
   validation (strict offline == live makes replay checks possible), id collisions, idempotency, version skew.
3. Exploit and economy abuse lane: repeatable free actions, re-pay and reroll loops, sell/refund loops, overflow.
4. Regression lane: verify every first-sweep fix and look for breakage.
Outputs: one findings ledger plus a separate online threat model doc (input to 0.14.1 design). First sweep used ~10% of
the weekly Fable allowance.
