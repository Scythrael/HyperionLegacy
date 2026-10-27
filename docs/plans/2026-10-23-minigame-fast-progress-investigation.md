# Why a player reached e100,000 Ore in under 24 hours (investigation, 2026-10-23)

Trigger (user): "Also, there's someone that already has e100000 ore....It's been less than 24 hours." User hypothesis:
"the minigame didn't scale prestiges properly, so once you were fast enough you could probably instantly fleet admiral
prestige to get everything you wanted with just e308, which would also unlock additional generators quickly."
Method: the real 0.13.11 engine (origin/main 5186046) in a scratch worktree; scripts and outputs in the session
scratchpad `fastore\`.

Reference (re-measured): steady e100,000 51.2 h, finale 102 h, e1,000,000 30.0 d; keen 38.1 h / 79.7 h / 27.8 d.

Ranked explanations
1. Fair play with auto targets above 100% (MOST LIKELY). The pacing was pinned on the default 100% auto targets, but
   the UI offers up to 1000%, and prestige gains rise linearly with the peak exponent, so fewer bigger prestiges win.
   Aggressive player, 100% targets: e100,000 26 to 29 h. Same player, 1000/1000/1000%: e100,000 10.96 h, finale 23.3 h
   (acting only every 5 minutes: 12.7 h / 25.8 h). Keen check-ins at 1000%: e100,000 22 h, finale 45 h, e1M 36 d;
   steady check-ins at 1000%: 28 h / 53 h / 35 d. e1,000,000 gets slower at high targets.
2. Device clock forward or a hand-edited save (confirmed possible, needs intent). No catch-up cap; a far-future clock
   pays everything (+7 d from a 4.3 h state reaches e100,000; +30 d the finale). FARMABLE: setting the clock back
   re-anchors lastTickAt down and keeps everything (four "+7 d then back" rounds beat one 28-day jump). The save is
   plain JSON in localStorage `hl_secret_v0`. The main game caps offline at 2 days per absence (OFFLINE_CAP_DAYS_BASE)
   but also rebases on a backward clock.
3. The user's Fleet-spam hypothesis: TRUE for Skill Points (Fleets every 5 to 20 minutes after the first at 1.33 h;
   all 14 Skill Points and all 8 tiers by 4.25 h) but MINOR for e100,000 (26.2 h vs 28.6 h). Not how this player did it.
4. Coarse catch-up margin: temporary +9 to +11% on some gaps, does not compound.
5. Multi-tab / reload: no double pay (last writer wins can lose, never add).
6. Engine bugs: none found (Overclock pricing, Max-buy rounding, best-Ore payouts behave).

How to tell which: the player's `hl_secret_v0` (milestone dates after their post or a future lastTickAt = clock or
edit; autoTarget 500 or 1000 with ~9 Fleets and e100k 11 to 22 h after firstCaptain = fair play).

Fixes proposed
A. Clock farm: lastTickAt becomes a high-water mark (never re-anchored backward); while the device clock is behind it,
   advance live from performance.now() deltas; optional server-time check via a same-origin no-store HEAD Date header
   (pay up to server time, hold the rest until verified; delayed, never lost). Hand-edited saves wait for anti-cheat.
B. Pacing vs targets (the real cause, a balance call): pin the pacing gate on the BEST target choice and either make
   the default the best choice and retune, or reshape gains so ~100% is near optimal. Removing 500/1000% does not fix
   it (manual waiting gives the same).
C. Fleet spam: Fleet threshold = e308 x 2^(Fleets since the last Prestigeception, minus 1). Tested: steady, steady+1h,
   light and keen timelines unchanged to the hundredth of an hour; spam then behaves like normal play.
D. Coarse margin: leave.
0.13.11.1 inherits all of 1 to 3; the e10,000,000 Starfall prize can be reached by the clock jump or farm.

## USER ANSWERS (2026-10-23, verbatim)

- Clock fix: "Make sure this is the case across the board for everything in the game. Imperative that this is the case
  so you can't jump from 1970 to 2099 and so forth." So: clock-manipulation protection for the MAIN game and the
  minigame alike (and anything else that reads wall-clock time): time is never paid twice after the clock goes back,
  a device clock far ahead of the server's is not trusted, and progress is delayed never lost for honest players.
- Targets: "Retune so default is best" (reshape prestige gains so about 100% auto targets is the best choice; retune to
  the planned bands; current players keep their progress).
- Fleet spam: "Yes, double it" (Fleet threshold e308 x 2^(Fleets since the last Prestigeception, minus 1)).
- User (2026-10-23, verbatim): "Yeah, playing offline won't be a thing eventually anyway, because the game will be entirely online and can be based off of the server clock at all times at that point. It is essentially just bringing that philosophy into line with what we're doing now." (Direction: server time is the source of truth; the trusted-time module is built so 0.14.1 online can swap its source to the server clock with no gameplay change. The no-network fallback is a stopgap until then.)
- Built (0fe462a, 2026-10-23): trusted clock (main game and minigame), retune (default best within 3%), Fleet bar [PROPOSAL]: the literal e308 x 2^(n-1) ladder did not stop spam (spam still learned all skills sooner and reached e1M at 25.3 d vs 30.0 d), so the build ships "first Fleet at 1.8e308, then each Fleet must at least double the Augment Points held" (equals the approved ladder when every Fleet lands on its bar; spam now plays like the default; side effect: Auto Fleet 10/25/50% act like 100%). Needs the user's yes. Minigames list floats above everything (z-index 1900).
- Fleet bar answer (user, 2026-10-23, verbatim): "I don't want to stop people from learning those skills. Those skills make the game easier by automating a bunch of it. So those should work well. We should adjust the curve of the game a little to make things take a little while longer overall. Then run a few sims as an optimal player, an average player, and a casual player to see how long it would take." Reading: do NOT gate Skill Points behind Fleet spam (revert the Fleet bar to the shipped fixed 1.8e308, so automation skills come easily); instead lengthen the overall curve a little; run optimal, average and casual player sims and report how long each goal takes (user picks the stretch).
- User (2026-10-23, verbatim, on staging): "Okay. Very good. Wverything is looking good, and progress slowed down quite a bit. Also, Captain resets feel rather useless after one or two honestly." Add to the curve round: measure how much each Captain Prestige improves things over a run (multiplier gained per reset, time saved) for the three player types, and propose options so a Captain reset always feels worthwhile (user picks).
- User (2026-10-23, verbatim): "I doubled my total points and went from 3.99x to 4.55x. We might keep it this way, but i am not sure as of yet. Just feels like we might want to loosen captains a bit while keeping fleet admiral tight where they are, but make the captain feel more useful without speeding the game up." (Math: the Captain bonus is (1 + points)^0.195, so doubling points gives x2^0.195 = x1.145. Direction: a bigger felt effect per Captain reset, Fleet unchanged, overall pace NOT faster: compensate elsewhere, user picks among options.)
- Curve pick (user, 2026-10-23): "Q3 + S15 (Recommended)" (Captain bonus exponent 0.4875 with the matching gain bend and x0.5 compensation, about x1.40 per Captain reset; plus the whole game about 15% slower). Sim the combination first and show the table before it ships.
- Curve FINAL (user, 2026-10-23): "Ship PC 0.5 (Recommended)" (Q3 Captain exponent 0.4875 with the gain bend, Q3 gain scale x0.5, plus a game clock 1/1.15 slower starting after the first Prestigeception; Fleet untouched). Sim: average first Fleet 4.2 h, all skills 2.0 d, finale 5.2 d, e1M 32.3 d, e10M 213.2 d; optimal 2.7 h / 29 h / 5.6 d / 32.5 d / 194.3 d; casual 14.2 h / 3.6 d / 7.2 d / 33.1 d / 204.2 d; Captain about x1.31 to x1.49 per reset.
- BUG (user, 2026-10-23, verbatim): "If you get enough ore to get both a fleet admiral prestige and have the 10k prestigeception, you can do one and then the other." One climb pays two layers (Fleet, then Prestigeception from the best-Ore-since-last peak). Fix in 0.13.11.1: one climb pays one layer; check Captain then Fleet too.
- BUG (user, 2026-10-23, verbatim): "Also, buy 10 for the new overclock upgrade seems to act like the max button, and shows no cost." Fix in 0.13.11.1: Buy 10 buys up to 10 levels with its total price shown; check Buy 1 / Buy 10 / Max on the four e1M upgrades too.
- User (2026-10-23, verbatim): "Unless this is intentional. I reset and got my third fleet admiral prestige, then got my prestigeception. The fleet admiral setup reset so I was able to fleet admiral reset. Was that intentional? The skill points become pointless pretty quickly, but I digress haha." (Prestigeception resetting Fleet is intended.) Spare SP decision: "Hmmm. I think they shouldn't be awarded afterward. If we do add in new systems to this in the future, we should have a new prestige layer that starts scaling things again at some point, etc etc." So: no Skill Points once all skills are owned (held spares kept); future minigame content comes as a new prestige layer.
- PC 0.5 built (cfe8cbf). User answers: old saves "Convert (Recommended)" (Captain Points converted once, CP' = (1+CP)^0.4 - 1, same bonus, smaller number); casual e10M 247 d "Accept it"; after e10M "Slow it after e10M (Recommended)" (a gentle slowdown past e10,000,000, never a hard stop).
- User (2026-10-23, verbatim): "The e10m should be around 180 days for average play." (Retune only the e1M to e10M stretch so the average player reaches e10M at ~180 d; earlier milestones unchanged.)
- Content-pacing review (2026-10-23): after day 5 most new content arrived in one burst at e1M (day ~32), leaving ~5
  months without a new unlock. User picks (multi): "Stagger the upgrades (Recommended)", "More milestones
  (Recommended)", "More upgrades", "Shorter goal", with the note: "The first one is great, but only if we don't make
  these upgrades affect the main game. If you're referring to uupgrades on the upgrades tab, then that's perfectly
  fine!" (minigame Upgrades tab only, never the main game). Goal length: "About 4 months" (e10M ~120 d for the average
  player; supersedes the ~180 d note). So: stagger the four upgrades (e1M, e2M, e3.5M, e5M or similar), add 2 to 4
  more late upgrades unlocking across the months, add funny milestones every few weeks (e2M, e3M, e5M, e7.77M ...),
  each with its popup and recorded reward; new names and copy are [PROPOSAL] for the user's sign-off.
- Four-month curve built (56231e7): average e10M 119.2 d, beats every few weeks (Turbo Encabulator, Overdrive Overdrive, Singularity Sharpener; milestones Forever Twice / Third Time's the Charm / Halfway to Too Big / Seven Sevens Fully Grown). User: "Approve all" (pacing, names and copy).
- Final pre-prod re-check (56231e7): "ship after fixes": H1 Vercel Age header inflates server time (drop Age); M2 parity test past e10M with all upgrades; M3 Overdrive Overdrive inert without the Overdrive skill; lows (captain marker absent-only, rollback double-conversion hazard, copy at the cap and after the SP cutoff, owned-but-sleeping rows, Debug jump SP, HEAD backoff, devGrantStarfall guard, test coverage). Merge into feat will need 4 conflict hunks resolved and feat's new Date.now() progress sites routed through trustedNow(). Design note for the user: the optimal player reaches e10M later (130 d) than the average (119 d).
- 0.13.11.2 (user, 2026-10-26): "So when you changed up captain prestiges, was the only thing that changed the point number? It's hard to tell if the actual weight of what these prestiges accomplishes changes." Answers: preview line on all three prestige cards ("Yes, all three layers": each card shows "now: xA to xB" for the multiplier that layer affects), shipped as a small display hotfix 0.13.11.2 off prod.
- 0.13.11.2 answers (2026-10-26): locked lines hidden (as built); Prestigeception line adds that Captain and Augment Points go back to 0; patch note "Small polish and fixes. Your save carries over untouched." approved.
- User (2026-10-26, screenshot of the Prestige tab): "Looks like the text is clipping a bit. Something we will want to fix up." / "Could just simplify it and add anything that needs explanation to the ? menu." Folded into 0.13.11.2: shorter card labels and values, explanations moved to the Help view, robust label/value rows.

## USER DIRECTION (2026-10-27, verbatim): all three prestige layers must stay meaningful

Context: the user, playing prod, found every Fleet Prestige still needs 1e308 Ore ("I have reset twice already and the
third time also requires 1e308"). Asked keep / rising / double / discuss, the user wrote:

"I propose a change. A way of keeping those skill points while making fleet prestiging feel useful. Because if it stays
at 1e308 forever, it doesn't really feel like you're making a ton of progress once you blast past 1e308. So we might
increase the total skill points we get for the first few fleet prestiges while scaling up the difficulty a bit with each
to start. But fleet prestige should scale accordingly, because once you max all skills, it'd feel pretty pointless once
you have a few under your belt for resets. Perhaps an upgrade tree is needed for this. I must have missed the memo
because I Wouldn't have agreed to make fleet prestige useless aside from skill points. I would have suggested at that
point to append it to the captain prestige and require prestige minimums for captain. Fleet prestige should get harder
and harder to push through, as should prestigeception. All 3 prestige systems should feel meaningful, otehrwise there's
no point for all 3."

Correction owned (2026-10-27): the 2026-10-23 answer said "don't gate the skills, lengthen the curve"; the step to "revert
the Fleet bar to a fixed 1.8e308" was Claude's reading, not the user's words. Requirements now:
1. Fleet's bar rises with each Fleet Prestige (harder and harder to push through).
2. The first few Fleets pay MORE Skill Points (so the skills still arrive at a good pace despite the rising bar).
3. Fleet stays meaningful after every skill is owned (the user's idea: an upgrade tree).
4. Prestigeception's bar rises too (harder and harder).
5. All three layers (Captain, Fleet, Prestigeception) must each feel meaningful.
(Mentioned as what the user would have suggested on 10-23: put Skill Points on Captain Prestige with prestige minimums.
Not a pick; an alternative for the design.)

Brainstorm Q1 (2026-10-27): "Three or four Fleets in, every skill owned: what should a Fleet Prestige give you that
makes the next one worth pushing for?" User, verbatim: "Hmmm. My thought on that one is that fleet admiral prestiges
would still feel useful. Whether that be an upgrade set or something to that end. But every prestige should have a use
from start to finish, with things trailing off after e10,000,000 by design before you start seeing the relics start to
affect the game. Then perhaps we might introduce an e20m or something that could lead to another prize."

Brainstorm playback 1 agreed (2026-10-27, "YEah, this sounds good to me as well"), then the user's idea, verbatim:
"But here is an idea we can weigh. Move the unlocks to some of the milestones at appropriate points in the game. So you
unlock those at a particular point. You would still get points from the fleet reset, and the new upgrades could replace
these. Only have the automations at the milestone levels. The actual stat boosts should be skill level-based. Those
upgrades can definitely have a cap to them, but they scale off of your prestiges. Potentially lifetime in some cases,
and within the current prestige at a different level in others. So for example, scales off of your current captain
prestiges, or lifetime prestigeceptions, etc. Just a few examples."
Reading (to play back): the automation skills unlock at milestones (no Skill Point cost); Fleet still pays points; those
points buy LEVELED stat-boost upgrades that replace today's stat skills (Head Start, Ten Bonus, Overdrive); each has a
level cap (X / Y, the approved minigame exception to D23) and its strength scales off a prestige count, some lifetime
(e.g. lifetime Prestigeceptions), some current (e.g. Captain Prestiges in the current Fleet).
Open from playback 1: relics boost the whole climb (as built in R2-10) or only past e10M? (unanswered)

Brainstorm (2026-10-27), on Skill Points after the caps, verbatim: "Yeah, my thought is that after a while, you might end
up hitting the cap on all skills at that point, and then you may keep accruing skill points from there. We will want to
balance this around keeping skill points that you earn from each prestige important and once you get to that point
where you should be able to reliably hit e10,000,000, the points stop and the costs have hit the maximum, so you're left
with close to 0 skill points, and maxed upgrades."
Reading: the points economy is tuned so every Fleet's points matter (costs rise with level); the total points a player
can earn and the total cost of maxing every upgrade meet at about the point where e10,000,000 is reliably reachable;
there the points stop, every upgrade is maxed, and the player holds close to 0 spare points (no pile of useless points).
Brainstorm (2026-10-27) picks: relics "Whole climb, as built (Recommended)" (R2-10 stays: a gentle boost throughout; past
e10M, where the curve trails off, relics are what still moves you); shipping "With 0.14.0 (Recommended)" (built and
re-simmed on the 0.14.0 branch with a save conversion: spent Skill Points refunded into the new upgrades, automations
granted by milestones already reached).
Brainstorm (2026-10-27), asked for upgrade or e20M prize ideas, verbatim: "I don't know what I should have just yet. I
wonder if we should make that a super secret surprise and then make e20m's prize a visualization to go with the new
theme style." Reading: Claude drafts the upgrade roster; the e20,000,000 prize stays a secret ("???" until reached)
and is a visualization that goes with the Starfall wash plus shine theme style (a visual effect, cosmetic only).

Design check answers (2026-10-27, on docs/plans/2026-10-27-minigame-prestige-redesign-design.md): payout "Harder pays
more (Recommended)"; old saves "Recompute from history (Recommended)"; proposals "Approve as drafted (Recommended)".
On e20M reachability, verbatim: "Think that set of 3 upgrades is enough for now? Or should we expand it beyond those 3?
Also, think about it this way. e20m won't be reachable until you get up to the 1k cap of relics and start earning those,
then get those bonuses up high enough to be able to continue to push through. The maxed out skills, and everything will
basically largely only result in e10m. But with the relics scaling, it'll likely only get you up to e20m. Unless we want
to give them e25m and make those 16 relics stretch out to a 2.5x multiplier at the maximum (since they will scale
logarithmically toward the limit with diminishing returns). Then future options might just bump the increase up
slightly as we add in new multipliers. The next one might only be 2x at the maximum, and pushes you into range for
e50m. But that's a future system. Basically, the entirety of the relic system reaching the soft cap beyond what you get
at 1000x+ relics would equal out to ~2.5x and allow for reaching e25m."
Reading: without relics, maxed skills and upgrades plateau around e10M (trailing off by design). Relic copies PAST the
1,000 soft cap are what push beyond: the whole relic system at its limit is worth about 2.5x, approached with
diminishing returns (never quite reached), which puts e25M in reach; e20M (the secret prize) sits on the way. Future
systems add their own ceilings (the next maybe about 2x, toward e50M). Open: confirm e25M as the relic ceiling, the
limit shape (a D23 exception like the minigame upgrade caps), and the user's question about expanding the skill roster.

Relic ceiling answers (2026-10-27), verbatim:
- Ceiling: "e25m ceiling. The same scaling plan up to e10m without a single relic. You can still progress beyond e10m,
  and it might even help a little bit overall, but compared to the increases you'll get with the 16 relics, you'll get
  more out of it with that, and those 16 relics over time will help you push from e10m to e25m for the prize of that
  visualization."
- D23: "Yes. Keep it that way. Because while the relic asymptotically caps for this game, it won't for endless mode
  nearly as quickly. Remember that getting up to 1k total relics is not meant to be quick or easy. You'll need to get
  into higher tier content to be able to even unlock the last of that 16."
- Split: "All of the bonuses that the relics provide to the minigame will all combine together to be equivalent to a
  2.5x increase when reaching the asymptotic limit. So if you have 10k relics of each of the 16, then you're pretty
  much right on the 2.5x multiplier mark. So if you have e10m, with those 10k in each, you'd have e25m. We should also
  plan how long it will take to get to that theoretical soft cap"
Reading: relic-free pacing to e10M unchanged; past e10M a relic-free player still creeps forward a little; ALL relic
boosts combined approach a 2.5x limit on the reachable exponent (e10M becomes e25M), about there at 10,000 copies of
each type; asymptotic (a minigame-only D23 exception; Endless Mode will scale further); the visualization prize sits at
e25M. Plus a study: how long the main game takes to reach 1,000 per tier and 10,000 of each type. Note: the code has 17
relic types (the user says 16): to confirm.
