# 0.14.0 user decisions: safe first runs, everything wired, scope, staging (capture, 2026-10-15)

Status: CAPTURE of the user's answers to the 0.14.0 decision board (T1, T2, T3, S15) plus a new request. The user's
words are authoritative. Items marked **[PROPOSAL]** are mine. Board: https://claude.ai/artifact/28FApaYfSLxUHKgMgaG8k8

## 1. T2: difficulty baseline, safe first runs (user, verbatim)

"So this can be a baseline. The entirety of the very first planet visited should be hard-set to be completable with no
changes to the ship or the crew. You should be able to build your first exploratation cruiser (the ship type will be a
heavy cruiser for expeditions), get the default crew compliment, set it all to auto so you don't manage it, and be able
to fully 100% the entire first expedition without a chance of losing, and then start scaling things up from there.
Every mission should be this way. One mission of each type will allow for players to be able to experience the content
in a safe and educational way to show them how it works, and when it's complete, the difficulty starts creeping in
slowly. Perhaps on a slightly curved line versus a linear progression. Exponential is too fast. But the first time
someone completes exploration, they can't lose. Hell, perhaps the very first tier can be completed as long as you've
built a cruiser. That being said, once the character moves on to tier 2, that will be different. The universe is not
safe. It's not meant to be. If you go in unprepared, you'll have a tough time in tier 2. If you keep doing that, and
you go into higher tiers or higher difficulty levels, you will undoubtedly fail. If you do so with safety interlocks
disengaged, you will die."

Reading:
- HARD RULE: the first expedition (and the first planet visited) is 100% completable, no chance of losing, with a
  freshly built explorer hull, its default crew complement, everything on auto, no gear or crew changes.
- "Every mission should be this way. One mission of each type": the FIRST run of each mission type is a safe,
  educational run that cannot be lost. Then difficulty creeps in on a gently curved line (not linear, not exponential).
- "Perhaps the very first tier can be completed as long as you've built a cruiser": a "perhaps"; OPEN (asked).
- Tier II and up: not safe by design; unprepared play struggles in II and fails higher; with safety interlocks
  disengaged, "you will die".
- "Heavy cruiser for expeditions": NO heavy cruiser hull exists today (explorer hulls are Orion, Aurora, Eir, all
  tier 2). OPEN (asked): a new hull, a rename, or a description of an existing explorer.
- This supersedes the T2 options offered (no boost / warn) as the governing rule; the vault-site stall fix must satisfy
  it.

## 2. T1: everything wired, no placeholders, across ALL systems (user, verbatim)

"Option 2. We're building the foundation and everything should work. Everything should be wired in and if we have a
configured value for everything we build, it wil work. No placeholders. No non-functional systems. After the
tutorial/campaign/quest patch, we're going for balancing/content, and we will need those to function. We will do bug
fixes as needed of course, but we do not want to have to wire up the foundation as this is the time to be doing that.
Let's make sure that everything is working. That every function we've built in is actually wired in and is doing
something. Not just with what we're doing for exploration, but for past systems as well. If something is not properly
wired in and does nothing with or without an initialized and/or assigned value, then it needs to be wired in."

Reading: wire all 38 inert captain secondary talents in 0.14.0, AND audit every past system for configured values
that do nothing; wire each one. No "coming later" labels. Patch order the user stated: 0.14.0 (foundation), then the
tutorial / campaign / quest patch, then balancing / content.

## 3. T3: scope (user)

"Move all five (Recommended)": patrol cloak detection, the Spacer long-haul ramp, the candidate board expansion,
graph color options and the antimatter burn move to 0.14.x.

## 4. S15: staging (user, verbatim)

"So, I want to go with 1. But with the mention of making sure wiring is indeed working, we want to ensure that
everything is working."
Reading: push to staging AFTER the T2 fix lands AND the wiring check passes.

## 5. New request: a wiring test framework / simulated player (user, verbatim)

"Also, how about this. Is there a method/scaffolding/framework you can build that would make testing for certain things
work at a glance for testing? Or would it not be a problem for you to be able to basically simulate a player playing
the game and speccing into things like aplayer normally would, in order to make absolutely sure that everything we've
built so far includes no broken wiring or placeholders that don't actually function. So if you spec into something
that provides 8% to a stat, it provides that 8%. The 8% will change, but the effect of that 8% will not. The form of
how that 8% might change (linear, logarithmic diminishing returns, etc), but the fact that it impacts the game does
not."

[PROPOSAL] three layers (presented to the user):
1. An effect registry + sensitivity test: every configured bonus (talent, officer bonus, crew buff, trait, gear line,
   module, relic, facility) is listed once with the game value it should move; a test turns each on and asserts that
   value moves, in the right direction, by the configured amount through its curve. A new bonus that is not in the
   registry fails the build. Extends the existing no-dead-stats test to everything.
2. A simulated player: a scripted headless run that builds, hires, specs talents, installs gear and runs missions and
   expeditions like a player, comparing a run with each choice against one without it (also the balance-pass speedrun
   sim's base).
3. A Debug "Wiring" panel (`?dev`): every bonus with its live contribution on the current save, so a dead line is
   visible at a glance.

## 6. Working rule (user, 2026-10-15)

"Keep writing all of the things down and keep presenting them until you get your answers." Re-present unanswered
calls every time until answered.
