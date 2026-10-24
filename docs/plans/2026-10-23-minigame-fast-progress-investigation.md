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
