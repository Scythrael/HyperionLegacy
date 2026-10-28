# Minigame prestige redesign: every layer meaningful (design)

Status: APPROVED by the user 2026-10-27 ("Approve, six skills (Recommended)"); v2 adds the design-check answers and the relic ceiling. Ships with 0.14.0 (user pick "With 0.14.0", 2026-10-27), on the
`feat/crew-0.14.0` branch, re-simmed. Game: the secret minigame "Hyperion Legacy v0.0000001a" (`src/lib/secret/*`).
Every user quote below is verbatim; the full record is in
`docs/plans/2026-10-23-minigame-fast-progress-investigation.md`, section "USER DIRECTION (2026-10-27)" and the
brainstorm entries after it. Names and numbers not given by the user are marked [PROPOSAL] or [PROVISIONAL].

## 1. Intent and why

The user, playing prod, found every Fleet Prestige needs the same 1.8e308 Ore: "if it stays at 1e308 forever, it
doesn't really feel like you're making a ton of progress once you blast past 1e308." And: "Fleet prestige should get
harder and harder to push through, as should prestigeception. All 3 prestige systems should feel meaningful, otherwise
there's no point for all 3." The fixed bar came from Claude over-reading the 2026-10-23 answer ("don't gate the skills,
lengthen the curve"); that reading is withdrawn.

Success: from the first Captain Prestige to e10,000,000, each of the three layers always has something worth earning;
Fleet and Prestigeception get harder each time; the Skill Point economy lands so that, about when a player can reliably
reach e10,000,000, "the points stop and the costs have hit the maximum, so you're left with close to 0 skill points,
and maxed upgrades."

## 2. Goals, non-goals, anti-goals

Goals
1. Rising bars: each Fleet Prestige needs more Ore than the last; each Prestigeception needs more than the last.
2. Automation by milestone: "Only have the automations at the milestone levels." The six automation skills (Auto
   Overclock, Auto-buy I to IV, Auto-buy V to VIII, Auto Captain, Auto Fleet, Auto Prestigeception) unlock at
   milestones, never for Skill Points.
3. Skill Points buy LEVELED stat skills: "The actual stat boosts should be skill level-based. Those upgrades can
   definitely have a cap to them, but they scale off of your prestiges. Potentially lifetime in some cases, and within
   the current prestige at a different level in others."
4. The first few Fleets pay more Skill Points ("increase the total skill points we get for the first few fleet
   prestiges while scaling up the difficulty a bit with each to start").
5. The points economy endpoint (section 1, last sentence).
6. A SECRET prize ("super secret surprise") that is "a visualization to go with the new theme style" (the Starfall wash
   plus shine style), at e25,000,000 (user, relic ceiling answer: relics "will help you push from e10m to e25m for the
   prize of that visualization").
7. The relic ceiling (3.6): "All of the bonuses that the relics provide to the minigame will all combine together to be
   equivalent to a 2.5x increase when reaching the asymptotic limit. So if you have 10k relics of each of the 16, then
   you're pretty much right on the 2.5x multiplier mark. So if you have e10m, with those 10k in each, you'd have e25m."
8. A study of how long the main game takes to get there (3.7): "We should also plan how long it will take to get to
   that theoretical soft cap".

Non-goals
- No change to the main game (the minigame never multiplies the main game; milestones pay main-game rewards only in a
  later patch, as already decided).
- R2-10's whole-climb relic boost stays ("Whole climb, as built", user pick 2026-10-27), but its curve changes shape to
  meet the ceiling in 3.6.
- No change to the e1,000,000 Upgrades tab (the seven Ore-bought upgrades) beyond what the re-sim needs to keep pace.

Anti-goals (would be a failure even if it works)
- A layer that goes hollow (nothing left to earn) before e10,000,000.
- A pile of Skill Points with nothing to spend them on, or points that arrive too late to matter.
- Automation locked so late the early game turns into a click chore (sell peace: QoL first).
- Existing players losing anything (see section 6).

## 3. The design

### 3.1 Rising bars

- Fleet Prestige bar: the first Fleet since the last Prestigeception stays at 1.8e308; each further Fleet in the same
  Prestigeception needs more, rising by a fixed factor per Fleet [PROPOSAL shape: exponent 308 x r^n, n = Fleets
  since the last Prestigeception, r set by the sim]. A Prestigeception resets n to 0 (the layer above makes the layer
  below easy again, the usual shape of stacked prestiges). [PROPOSAL: reset at Prestigeception; the alternative is a
  lifetime count that never resets.]
- Prestigeception bar: e10,000 for the first; each lifetime Prestigeception raises the next bar [PROPOSAL shape:
  10,000 x q^m, m = lifetime Prestigeceptions, q set by the sim]. Nothing above it resets m.
- Captain Prestige keeps its bar (1e60) and its growing payout; it is meaningful through its points (the multiplier
  and, new, the skills that scale off Captain counts, 3.3).
- Harder pays more (user, 2026-10-27, "Harder pays more"): Augment and Dream Point payouts keep measuring from the BASE
  bars (1.8e308, e10,000), so clearing a risen bar pays more than the last one.
- Claude's call (design check): the Fleet count n resets at each Prestigeception (the proposal above, kept). If the
  Fleet bar ever climbs past the Prestigeception bar, that is by design the signal to Prestigeception; the cards say so
  ("Prestigeception first" [PROPOSAL wording]).
- The Prestige tab cards show the current bar (they already show Needs) and, new, "Next one needs" [PROPOSAL] so the
  rise is visible (user approved the proposals, 2026-10-27).

### 3.2 Automations at milestones

Each automation unlocks at a milestone and keeps its on/off switch and target setting. [PROPOSAL mapping, timed near
when the steady player buys each today (sim: Auto Overclock 4.1 h, Auto-buy I to IV 18.6 h, Auto Captain 28 h, Auto
Fleet 42.6 h, Auto Prestigeception 3.0 d, Auto-buy V to VIII 6.6 d)]:

| Automation | Unlocks at |
|---|---|
| Auto Overclock | "Fleet Week" (first Fleet Prestige) |
| Auto-buy I to IV | "A Thousand Zeros, Give or Take" (e1,000 Ore) |
| Auto Captain Prestige | a new milestone [PROPOSAL] "Second Fleet" style beat, or e3,000 Ore |
| Auto Fleet Prestige | a new milestone [PROPOSAL] at e10,000 Ore or the second Fleet |
| Auto Prestigeception | "Prestiged Your Prestige" (first Prestigeception) |
| Auto-buy V to VIII | "Do Not Look Directly at It" (own a Singularity Engine) |

The milestone list and the popup say what each unlocked ("Reward: Auto Overclock unlocked"). Any new milestone gets a
name and flavor line in the game's humor [PROPOSAL]. The "Fully Automated Luxury Mining" milestone ("Own every skill")
becomes "every automation unlocked" or moves to "every skill maxed" [PROPOSAL: every skill maxed].

### 3.3 Leveled skills (Skill Points)

The Skills tab keeps its name. The three stat skills of today (Head Start, Ten Bonus x2.2, Overdrive) become leveled
skills, and new ones join them. Each has a level cap shown as "X / Y" (the user-approved minigame exception to D23),
a Skill Point cost that rises per level, and a strength that scales off a prestige count. [PROPOSAL roster; names,
caps, costs and steps set by the sim]:

| Skill | What a level does | Scales off |
|---|---|---|
| Head Start | resets begin with more Ore (1e10 at level 1, more per level) | lifetime Fleet Prestiges |
| Tenfold Training | each ten bonus a little stronger (today's x2.2 is reached partway up) | Captain Prestiges in the current Fleet |
| Overdrive | Ore production to a higher power (today's ^1.05 reached partway up) | lifetime Prestigeceptions |
| Captain's Academy | more Captain Points per Captain Prestige | lifetime Fleet Prestiges |
| Fleet Logistics | more Augment Points per Fleet Prestige | Fleets in the current Prestigeception |
| Lucid Planning | more Dream Points per Prestigeception | lifetime Prestigeceptions |

"Scales off" means the level's effect is multiplied by a concave function of that count (more prestiges, stronger
skill, never a cliff). Claude's call (design check): the scaling factor is exactly 1 at a count of 0 and only grows,
so a skill at count 0 gives its full listed level effect (a converted save never loses strength after a reset). The
e1,000,000 Upgrades tab (Ore-bought) is separate and unchanged. Roster size: six (three reworked, three new); the user
asked whether to expand, Claude recommended six for 0.14.0 (more skills need more points or thinner levels for the
endpoint in 3.4) with new skills coming from a future prestige layer (user 2026-10-27: "Approve, six skills").

### 3.4 Skill Point schedule and the endpoint

- Each Fleet Prestige pays Skill Points by a schedule over LIFETIME Fleets that front-loads the first few [PROPOSAL
  shape: 3, 3, 2, 2, then 1 each], as the user asked.
- The total of all points the schedule ever pays equals the total cost of maxing every skill. The sim tunes costs and
  the schedule so the average player's last point lands around the time e10,000,000 becomes reliably reachable (today
  about day 100 to 120); after that no more points are paid (the existing cutoff once everything is maxed) and the
  player holds close to 0.

### 3.5 The secret prize at e25,000,000

- A milestone at e25,000,000 shows "???" until reached (name, detail, reward all hidden; never hinted in Help). An
  e20,000,000 milestone beat stays on the way [PROPOSAL, approved with the proposals].
- Its prize is a cosmetic visualization that goes with the Starfall wash plus shine theme style, for the main game's
  UI [PROPOSAL: an animated shine or starfield layer that rides on the Starfall style, toggle in Settings, off for
  reduced motion]. The exact visualization needs its own mockup sign-off; this build ships the hidden milestone and the
  reward hook, the visualization itself comes after that sign-off.
- Relic-free: "The same scaling plan up to e10m without a single relic. You can still progress beyond e10m, and it
  might even help a little bit overall" (the existing post-e10M slowdown stays; a relic-free player creeps past e10M).

### 3.6 The relic ceiling (replaces R2-10's per-lever uncapped curve)

- All relic boosts to the minigame COMBINED approach a 2.5x limit on how far a player gets: the plateau that is about
  e10,000,000 without relics becomes about e25,000,000 at the limit, about reached with 10,000 copies of every relic
  type. Asymptotic: always still growing, ever more slowly. A minigame-only exception to D23 (user, 2026-10-27: "Yes.
  Keep it that way. Because while the relic asymptotically caps for this game, it won't for endless mode nearly as
  quickly."). The main game keeps D23.
- The 17-row lever table (user, 2026-10-26) and the past-cap 5x weight stay; what changes is the curve: each lever's
  share is set so the combined effect meets the ceiling. The early boost stays gentle (a typical 0.14.0 collection
  about 15% faster, as approved); the sims pin relic-free bands exactly.
- All 17 relic types count toward the ceiling, Heart of the Archive included (user 2026-10-27, "All 17").
- How the 2.5x is realized in the engine is left to the builder, measured in the sim as the plateau exponent.

### 3.7 Study: how long to the relic limit

Before tuning, measure in the MAIN game (real drop rates, region tiers, expedition cadence, short-range relic drops)
how long a steady player takes to reach 1,000 identified relics per tier and 10,000 copies of each type, and report it
to the user as a table (steady and heavy players). User: "Remember that getting up to 1k total relics is not meant to
be quick or easy. You'll need to get into higher tier content to be able to even unlock the last of that 16." The
minigame ceiling is tuned against these real timelines.

## 4. Constraints

- Pacing bands as shipped unless the user changes them: first Captain about 45 min, finale e777,777 3 to 5 days,
  e1,000,000 about a month, e10,000,000 about 4 months (about 120 days) average; optimal and casual reported.
- Determinism and offline parity: offline == live, one call == chunked, the trusted clock rules of 0.13.11.1.
- Relic boosts (R2-10) unchanged and re-simmed with the new curve (relic-free bands exact, typical about 15% faster).
- Never roll back past 0.13.11.1's Captain Points conversion; the save keeps its marker.
- Text rules: no em dashes and no "--" substitutes, US English, humor in the game's voice, SVG glyphs only.
- The secret game's errors never reach the main game.

## 5. UI

- Skills tab: leveled rows (name, flavor, level X / Y, what the next level does, cost, Buy), the scaling line ("x1.6
  from your 4 lifetime Fleets"), automations shown as milestone-unlocked toggles (locked ones read "???" until their
  milestone is visible, as today's hidden milestones do).
- Prestige cards: Needs plus "Next one needs" (3.1). Milestones tab: reward lines name the automation.
- Help ("THE FINE PRINT" and the skills section) rewritten to match. Layout changes beyond these rows need a mockup
  sign-off (the visual-UI rule); the rows themselves reuse the Upgrades tab's row style.

## 6. Existing saves (conversion)

User picks "With 0.14.0" and "Recompute from history" (2026-10-27): a save gets exactly the Skill Points the new
schedule would have paid for its lifetime Fleets (front-loaded points included), with no double pay; automations are
granted by milestones already reached; every automation the save owns stays owned and switched as it was, even if its
milestone was not reached; owned Head Start, Ten Bonus and Overdrive convert to the level that matches today's effect
(the points for those levels count as spent from the recomputed total), so nobody loses strength on load. A save that
hit today's "all learned" cutoff earns again under the deeper caps. One-time, marked in the secret save (like `captainScale: 2`).

## 7. Left to the builder

Exact engine structure, the sim harness changes, the save marker name, test layout, and every [PROVISIONAL] number the
sim sets, within the bands in section 4.

## User addition (2026-10-28, verbatim)

"Oh, and don't forget: The automation unlocks for milestones. Make sure that they cover the new upgrades that are coming
along in the new update to the minigame coming in 0.14.0! Other than that, so far so good! I'm having a good time with
the system, even as it is now. It'll feel even better!"
Reading: the milestone-unlocked automations (3.2) also cover the NEW things to buy in this update: automation for the
leveled Skill Point skills and/or the e1,000,000 Upgrades tab (details confirmed by multiple choice below).

### Automation and skills answers (2026-10-28, verbatim)

Q "Which new purchases should get milestone-unlocked automation?": "Okay, so I would like to give the player the choice.
While automation unlocks are based on milestones that make sense. Just ensure that hte popups indicate that this was
unlocked. While adding in updates to that ? help menu to ensure that the updated process is shown there. Automation
should then likely have it's own tab, and we can adjust it accordingly. Buy 1 at a time. Buy maximum. Buy 10. ETc. As
for skills, that's the player choice I was referring to. The same process should exist as it does now. However, the way
we prevent someone from becoming too overpowered too quickly is to unlock upgrades alongside automation, or by number of
current prestiges in a given tier (that way, it doesn't just create some overpowered way to get back up to where you
were. Plus, once you reach a certain prestigeception level, we can remove the restriction and just unlock all currently
unlocked upgrades at the start, so as you get your first skill point, if you drop it in a skill that you normally can't
until you're somewhere around fleet admiral prestige 5, (please don't turn that into an acronym lol....) it leads to what
feels like a power boost, but it's just the player having some choice on the curve that is already hard-set by us."

Q "How should auto-learn / auto-buy choose what to buy?": "With the last question's answer, the context changes but the
answer remains the same. Unless you're specifically talking about a "auto-buy" automation that unlocks later for skills.
In that case, then what I said in the previous question only affects how the game would work until you unlock the
auto-skill allocation automation. This would just unlock cheapest first. We don't want to build logic to efficiently
play the game on auto. Automation in cases like this should provide QoL but should never optimally play the game. That's
why I set defaults in a very particular way, while players hav to have at least some involvement (from manual control to
building gambits (gambits being something we should rename. Tactical protocols?)). 1 feels like the best approach for
cheapest available/round-robin."

Reading (to play back before building):
1. Automations unlock at milestones that make sense; the achievement popup says what unlocked; the [?] Help explains the
   new process.
2. A new Automation tab holds every automation, each with its settings (on/off and how much it buys at a time: Buy 1,
   Buy 10, Buy max, etc.).
3. Skills stay a player choice, bought by hand with Skill Points as today. Pacing guard: each leveled skill (and its
   levels) becomes AVAILABLE either alongside an automation milestone or at a count of current prestiges in a layer
   (e.g. a skill normally available around the 5th Fleet Prestige), so a reset cannot rush back to full power.
4. Past a certain Prestigeception count the gate lifts: every skill already unlocked is available from the start of
   each climb, so the first Skill Point can go into a normally-later skill (it feels like a power boost; it is the
   player choosing along the curve we set).
5. A later automation, auto-skill allocation, spends Skill Points cheapest first, round-robin. Automation is QoL and
   never plays optimally (no efficiency logic).
6. Naming: never abbreviate "Fleet Admiral Prestige" (or any prestige) to an acronym anywhere.
7. Main-game idea, separate from this design: rename "gambits" (suggestion: "Tactical Protocols"); to confirm.
