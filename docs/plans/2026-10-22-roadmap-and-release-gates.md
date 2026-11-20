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
| 0.16.x (idea, 2026-11-20) | One content tier per patch: 0.16.1 = tier 8, and so on (see "0.16.x content patches and 0.17.0") |
| 0.17.0 (idea, 2026-11-20) | Perhaps the storyline plus the full Dimensional Traversal experience; conflicts with the 2026-11-18 answers, open |

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

## 0.16.0: tuning items from the 0.14.0 fix round (user, 2026-11-17)

Logged for the 0.16.0 balance pass (answers in docs/qa/2026-11-13-fable-sweep-ledger.md, "USER ANSWERS (2026-11-17)"):
- Repair pause share on Repeat patrols (destroyer 90%, carrier 87%, battleship 74% of patrol time paused): tune gear
  wear rows and the home repair rate together.
- Repeat difficulty climbs one step every 20 routes (`PATROL_CLIMB_EVERY_ROUTES`, [PROVISIONAL]).
- Deuterium canister sell value 50 cr (margin 1.25, [PROVISIONAL]) and the salvage recovery knee 0.5 ([PROVISIONAL]).
- Early expeditions with the free Standard-Issue Balanced Array (user 2026-11-17, "Accept, tune in 0.16.0"): its +0.05
  landmark and underground odds surface a few more sites and fights (Orion sample: runs with a loss 4 to 5 of 10, lost
  fights 83 to 89); first runs stay safe.
- Patrols with the free crew set are a little easier for the General Freighter and the warships (Freighter Warband
  curve 1: 285 to 303 wins of 400; Destroyer Warband full strength: 33 to 42); first patrol still safe.

## 0.16.0: minigame scale cut to e1,000 (user, 2026-11-14)

User, verbatim: "I think we should cut down the scaling of tje minigame massively. I think we should top out at e1000
instead. What are your thoughts on it? I feel like e25m is way too massive. Plus, we will quickly run out of maximum
number to hit before long." After the facts below, the user chose "Log it for 0.16.0" (0.14.0 ships at the current
scale).

Facts given (2026-11-14):
- Range is not a risk: the minigame runs on `break_infinity.js` (exponents to about 9e15); e1,000 is already past
  a plain JS number (about e308), so the library stays either way.
- What the cut touches: every Ore milestone above e1,000 (e10k, e100k, e777,777 finale, e1,000,000, e2m to e7m,
  e10,000,000 Starfall theme, e20m, the secret e25,000,000 Faster Than Light background; several names joke about
  the zeros), the prestige bars, both softening curves (FINALE_EXPONENT, STARFALL_EXPONENT), the relic ceiling
  (RELIC_CEILING_MULT 2.5, user-locked 2026-10-27), Help, goldens and minigame QA.
- Prod saves already past e1,000 need a remap that keeps every earned milestone and reward.

Direction for 0.16.0 (to confirm when the patch starts): same TIME to each beat (10-22 pacing: finale in days,
e1,000,000-equivalent in about a month, e10,000,000-equivalent in about 6 months), smaller numbers, top beat at
e1,000. Use the balancing method above (optimal, average, casual profiles). Open questions then: new thresholds and
names, the save remap rule, and where the relic ceiling's plateau lands.

## News ticker, story timing, and Dimensional Traversal timing (user, 2026-11-18): OPEN

User (verbatim): "The scrolling marquee can be an easy add to 0.15.0. It builds the lore of the game a bit. That will
start the actual storyline of the game when we get to that point, so we will hold off until then. Or, we don't actually
push any of that story and that particular aspect remains disabled under the hood until 0.16.0. So it's more incentive
to start over after the save wipe. We should also determine how far we want to push content and if we want to actually
implement DR capability for that point or not."

Context: the news ticker and the red-giant dimension are in docs/lore/first-cause-dimensional-traversal.md (2026-11-18).
0.16.0 carries the announced save wipe (SUGGESTIONS.md founder save-wipe entry).

Open calls (the user's):
1. **News ticker / storyline timing:** live in 0.15.0, or built in 0.15.0 and kept switched off until 0.16.0 so the
   story starts fresh after the wipe (or a middle path: ambient world news in 0.15.0, story beats from 0.16.0).
2. **How much content 0.16.0 pushes**, and whether Dimensional Traversal (DR) ships in 0.16.0 or later.

Facts for those calls (found 2026-11-18):
- The First Traversal unlocks at the END of a campaign (lore doc: "a hopelessness cliffhanger that ENDS one of the
  campaigns"), so DT needs at least one complete story campaign to exist first.
- DT is designed so DT 0 is today's game byte-identical; the balance pass can tune the base game without DT.
- Switched-off story text still ships in the game files, so dataminers could read it early unless it is held back
  from the build (or served once online features exist).

USER ANSWERS (2026-11-18):
1. Story timing: **"Middle path (Recommended)"**. 0.15.0 ships the news ticker with everyday world news (lore grows
   right away); the story beats that start the plot arrive in 0.16.0, after the wipe, so everyone starts the story
   fresh.
2. DT timing (verbatim): "We should add in the system in another patch. Perhaps one of the 0.15.x patches and wire it
   in but don't activate it. In fact, we should have the ability to completely disable systems. Especially if they're
   causing problems. So we can temporarily disable them in the event that something catastrophic is bugged with them,
   and we're working on a hot fix. This would be no different. disabled by default. A control panel in the dev panel
   that gets a nice redesign with 0.14.1 because it'll be used in a different way with online accounts and
   permissions."
   - DT is built and wired in a **0.15.x** patch, **disabled by default**, activated later.
   - NEW requirement: **system kill switches.** Any system can be completely disabled (for example while a
     catastrophic bug waits on a hotfix). DT's "off by default" is the same switch.
   - The switches live in a **control panel in the dev panel**, which gets a **redesign in 0.14.1** for online
     accounts and permissions.

Notes for designing the kill switches (PROPOSALS, the user decides):
- Today's code has only TEST-ONLY switches (for example `REFUGEE_ECHO_SWITCH`, "Never written by app code"); a
  runtime switch is new.
- Turning a system off must PAUSE it, never lose its state (a mission in flight, items in a queue), and turning it back
  on resumes exactly. Offline catch-up must stay exact across a toggle (which state did the switch have each second?).
- Once online, the switch could come from the server, so a hotfix-in-progress outage reaches every player at once.
- Players should see a calm note when a system is paused for maintenance, not a missing tab.
- Older note: SUGGESTIONS.md put the dev-panel spin-out with 0.15.1; the roadmap now has online as 0.14.1, which
  matches the user's "redesign with 0.14.1".

## 0.14.1: scheduled cloud save backups (user, 2026-11-18): REQUIREMENT, design open

The user (verbatim): "One thing for 0.14.1 as well. We will have the system working within the actual database for
Vercel. However we handle that one, I'm not 100% sure yet. We will work that out when this is done, however, we will
want a cloud save backup option that backs up the save on a timer (perhaps every 24 hours, or at a cadence I can set
in the admin level control panel) that backs up the JSON string or something akin to that in a way that would prevent
save game loss."

- REQUIREMENT: a **cloud backup of each player's save on a timer**, separate from the live cloud save, so a save can
  always be recovered. Default cadence "perhaps every 24 hours"; the cadence is **set in the admin control panel**
  (the same 0.14.1 dev-panel redesign as the system kill switches above).
- The database and hosting choice is still open (the user will work it out when 0.14.0 is done).

Facts (2026-11-18): the save today is one string, LZ-compressed base64 of the JSON (`serialize` in save.ts; a fresh
save is about 11 KB). Export Save downloads that string; Import Save writes it back unchanged, keeping its save time,
so a restored save pays the time since it was made as a normal absence (4-day cap). Import refuses a save from a newer
build (CX-1). Why it matters: playtest session 2 lost a day-1 save when the agent's browser storage went away.

Questions for the design (PROPOSALS, the user decides):
- Keep several backups (for example the last 7 daily ones) rather than only the newest, so a save that went bad is
  not backed up over the last good copy.
- Also back up at risky moments (just before a save-version migration on a new release), not only on the timer.
- Who can restore: the player from a list, an admin from the control panel, or both; restore uses the same path as
  Import (migrations run on load).
- Backups are server-side copies the player cannot edit, which fits the online threat model (Fable pass 2 lane 2).

USER FOLLOW-UP (2026-11-18, verbatim): "Mmhmm. Exactly. That works for me. It's mainly to prevent something from nuking
the game. Plus, we can create a process before each patch (even a hotfix) that we can use to trigger a full backup for
a specialized developer field that only we can make use of that can't be restored without our express action. As for
my thoughts on the matter. I am not sure if we should allow restores by players or not. At the same time, we might
want to. If you want to know why I am on the fence, if you can check the CIFI discussion I have with you in the LLM
chat side, you can see why. It's a great tool. But we'd have to design it rather carefully to ensure nothing goes
wrong with whatever we choose."
- Purpose: mainly to keep anything from nuking the game.
- REQUIREMENT: a **pre-patch full backup** step in the release process, before EVERY patch, hotfixes included, into a
  **developer-only store** that only the owner and the developer can use. Nothing restores from it without their
  **express action** (no automatic or player-triggered restore).
- OPEN: **player self-restore** (yes or no). The user is on the fence: a great tool, but it needs careful design so
  nothing goes wrong. The reasons are in a claude.ai chat about CIFI, which Claude Code cannot read; to be pasted
  or summarized here before the design.

USER FOLLOW-UP 2 (2026-11-18, verbatim), why the user is on the fence (from playing CIFI, whose community guide says
"Cloud save before every TR and turn off auto cloud save until you're sure nothing broke"): "Long story short is
that I will often force a cloud save, and then turn off cloud saving (which I don't really want to do, unless we have
a forced cloud save option and we mention that turning off cloud saving does not turn off all cloud saving, and that
there is a cloud save that happens every 24 hours, so rollbacks are possible if needed. Anyway, I would force a cloud
save, and then do something like a reset that could take an hour or two. Then if I feel that the prestige reset was
worth doing at that point, I turn on cloud saving. If I feel it was not worth it, I restore the cloud save back."
- The player use case: **try a prestige reset, play an hour or two, then keep it or roll back.** A real, valued tool.
- Pieces the user named for that flow (design inputs, not yet decided as a package):
  - a **forced cloud save** ("save to cloud now") the player can trigger;
  - a player **auto cloud save on/off** setting;
  - clear text that turning auto cloud save off does **not** stop every cloud save: the **scheduled (about 24 h)
    backup still runs**, so a rollback stays possible;
  - a **restore** from the cloud copy.
- Design care the user asked for ("design it rather carefully"), for later (PROPOSALS, the user decides):
  - Keep several backups, so the scheduled backup can never overwrite the only good copy (the CIFI failure mode).
  - The same restore that undoes a prestige can also undo bad luck (a lost Tier II mission, a bad roll), so once
    leaderboards or other online fairness exist, player restores may need limits (cooldown, only before a prestige,
    leaderboard entries frozen at the restore point). Fits Fable pass 2 lane 2.
  - Dimensional Traversal (the prestige) could offer a built-in "preview" instead, which would cover this use case
    without a general restore. Only an idea; DT is 0.15.x.

USER (2026-11-18): none of this is set in stone; Claude is to play DEVIL'S ADVOCATE here. The user's example: "You
could cheese the system with ease if you crafted a bunch of blanks, rolled them, then reverted your save over and over
until you got what you wanted."
Devil's advocate (Claude, 2026-11-18; for the 0.14.1 design, the user decides):
1. Save-scumming RNG. TRUE TODAY: the live loop feeds Math.random into each poll (App.svelte beginPollCatchUp /
   runPollEconomy), so a restored save re-rolls a craft. Counter: pin randomness to the save (the save carries its
   own seed stream, so a restore replays the same rolls), better still a roll fixed when the blank is made or the
   craft is queued, so reordering actions cannot shift it. Also strengthens offline == live.
2. Losses become optional (Tier II+ can be lost by design); forgiving but hollow.
3. Anything that leaves the save duplicates on restore: gifts, trades, event or leaderboard rewards, gift codes. All
   of these must be recorded server-side, never only in the save.
4. Leaderboards: a restore is a free retry; needs entries frozen or rolled back on restore, or no restores in a
   ranked season.
5. Support: players will restore the wrong backup; confirm clearly and back up the current save first, so a restore
   can itself be undone.
6. Forced cloud saves need a rate limit (cost, flooding).
Middle grounds: A) no player restore, developer restore on request; B) prestige-only undo: an automatic checkpoint
just before a prestige, returnable within a window (for example 2 h), nothing else; C) full player restore with
pinned rolls, cooldown, leaderboard freeze, server-side records. Claude's lean: B covers the user's real use case with
the least to cheese; pinned rolls are worth doing whichever is chosen.

USER DECISION (2026-11-18, verbatim): "Hmmm. Yeah, I'm thinking that we have a variant of A. In the event of a rollback,
I can do it. I can do so in a targeted fashion like choose a player, and then choose which one to roll back to. Or, if
a save is corrupted and the game attempts to load it and fails, there is an option to be able to roll back to the
cloud save."
- **Variant of A.** No general player restore. Rollbacks are done by the owner: **pick a player, then pick which backup
  to roll back to** (admin control panel).
- **One player-facing exception:** when a save is **corrupted and fails to load**, the player is offered a **rollback to
  the cloud save**.
- Notes for that design (Claude, PROPOSALS): the corruption rollback should go to the NEWEST good cloud copy only (no
  choosing an older one), and "corrupted" should be decided by the game or server, not by anything the player can
  trigger, or a player could break their local copy on purpose to get a free undo (worst if auto cloud save was off,
  so the newest cloud copy is old). Owner rollbacks should leave an audit record (who, when, which backup). Open: with
  no player restore, does the player's "auto cloud save off" setting still have a purpose?
- USER ANSWER (2026-11-18, verbatim): "Yeah, there would be no purpose to automatic cloud save off. Not only that,
  but we want to account for this from a legitimizing accounts and creating things like a leaderboard and the like.
  It's one more avenue that we can harden against would be malicious actors who would try and use the system to get
  ahead where they shouldn't." So: **no player setting to turn automatic cloud save off** (cloud saving is always on),
  and the forced cloud save button is no longer needed for rollbacks. The rollback rules are part of hardening accounts
  and leaderboards against bad actors (Fable pass 2 lane 2, the online threat model).
- Same loophole, other door (Claude): today's Export Save / Import Save is exactly a player restore (export, roll,
  import, repeat), and an edited export imports unchecked (Codex round 8). For accounts and leaderboards, 0.14.1
  needs a decision on Import Save (remove it, or owner-only from the admin panel). Export can stay as a read-only copy.

## 0.16.x content patches and 0.17.0 (user, 2026-11-20): PLAN IDEA, open

The user (verbatim): "Also, future plan for 0.16.x patches before whatever we plan out specifically for 0.17.0 ( I don't
know if I ever mentioned that patch yet), will be additional content additions to the game. So if 0.16.0 launches with
7 tiers of content, then 0.16.1 might include all tier 8 content, and so forth. Should the first version of the game
release with up to tier 10 content? Perhaps 0.17.0 includes the storyline and actually designing and implementing the
full DR experience."

- PLAN (user): **0.16.x patches add content one tier at a time**: 0.16.0 launches with 7 tiers, 0.16.1 adds all of
  tier 8, and so on. First mention of **0.17.0** anywhere in the docs (checked 2026-11-20).
- OPEN QUESTION (user): should the first version (read as 1.0) ship with content up to **tier 10**?
- PROPOSAL (user, "perhaps"): **0.17.0 = the storyline plus the full Dimensional Traversal (DR) experience**, designed
  and built.
- CONFLICT to resolve (Claude): the 2026-11-18 answers above put the story beats in **0.16.0** (after the save wipe, so
  everyone starts the story fresh) and DT's build in a **0.15.x** patch, switched off. Story in 0.17.0 means players who
  start fresh at 0.16.0 are several tiers deep before the plot begins, which loses the fresh-start reason for the
  middle path unless the early story beats can reach players who are already past them. Both 2026-11-18 answers
  stand until the user changes them.
- Facts (Claude, 2026-11-20): today's content runs to tier VII (Lab and Fabricator tracks, drive Classes II to VII
  with Deuterium and Antimatter, since OC-15 "Add tiers 3-7 now"). The 1.0 target is about 2 years from start to
  finish (below), and 0.16.0 is the balancing pass toward it.
- Note for the tier-10 call (Claude): the 2-year target is spread across every tier. If 0.16.0 balances 7 tiers to
  2 years and tiers 8 to 10 arrive afterward, either the game grows past 2 years or the balance pass is redone. If 1.0
  is tier 10, the 0.16.0 balance pass should plan the curve for 10 tiers from the start (tiers 8 to 10 as pacing
  targets in the balance model, not as content in the game), so 0.16.1 to 0.16.3 slot in without re-tuning.

## Minor safety, age-gated features, and in-game chat (user, 2026-11-20): STANDING RULES

The user (verbatim): "One thing that I actually have to really plan out because of how regulation (and understandable
protection for our youngest family members) towards those under 18, I have to figure out the best possible approach
for the in-game chat that will exist in the game. The in-game chat will have unlocks like name colors and effects like
bold/underline/glow/font/etc, as well as chat badges (an icon you can hover over for flavor text). So you might get a
bomb icon that says "Survived the great save nuke of 2026." and such.

Because I'm sure that most parents would want to know that in the event that their child plays a game for all ages,
that features that should not be available to them are not. I'm not going to ask for ID verification, but signing up
for your account will determine your current age based on the DOB that is entered, and based on that age, certain
features will be available. The ToS that accompanies the signup process coming in 0.14.1 will indicate that the game
itself is appropriate for all ages, but some features are not available to those under the age of 18. The chat
enabling option is literally not in the game for those under 18. Analytics (even though they are non-identifying)
cannot be opted into. Etc.

Because moderation is not 100% perfect, and someone saying something questionable in chat might result in a bit of time
passing before I repeatedly hit them with the banhammer (or a future moderator). Plus, I look at Roblox and I shudder
hard enough to cramp. I will not allow that kind of culture to occur here. No. Never. If I can't find a solid way of
enacting this without risking the kiddos out there, I won't have it in my game. Period.

Plus things like potentially censoring the story from things that might cause concerns from parents will be
untoggleable at under 18. Slight word changes and so forth."

STANDING RULES (user; every online, chat, story and analytics design must follow them):
1. **The game is for all ages; some features are 18+.** No ID verification. The **date of birth entered at signup**
   decides the player's current age, and features follow from it.
2. **Chat does not exist for under-18 players**: the enabling option is not in the game for them at all (not hidden,
   not greyed out).
3. **Analytics cannot be opted into under 18**, even though analytics are non-identifying.
4. **Story wording for under-18 players is the family-friendly version, and they cannot toggle it** ("slight word
   changes and so forth").
5. **The ToS at signup (0.14.1)** says the game is appropriate for all ages and some features are unavailable under 18.
6. **Hard stance on chat:** moderation is never instant, and the user will not allow a Roblox-style culture. If there
   is no solid way to run chat without risking children, **chat does not ship. Period.**
7. **Chat cosmetics when chat exists:** name colors; text effects (bold, underline, glow, font, and the like); chat
   badges, each an icon with hover flavor text (the user's example: a bomb icon, "Survived the great save nuke of
   2026.", which matches the founder badge the wipe grants, SUGGESTIONS.md).

What this updates in older notes (SUGGESTIONS.md, 2026-08-28 privacy entries), Claude 2026-11-20:
- The **chat threshold is now 18** (the older entry carried Claude's "recommend CHAT = 16+"; that was a suggestion,
  never the user's decision). The **analytics threshold is now 18** (the older entry blocked opt-in only under 13).
- Still standing from the older entries: chat deferred and switched off in the code itself (no endpoint, no stored
  messages) until its safety work is done; opt-in-only analytics with no passive collection; consent re-acceptance
  when a new field is added; rewards never tied to the data opt-in; the professional privacy and legal review before
  online launches (the old "0.14.0 HARD LAUNCH GATE", which now applies to 0.14.1 since online moved there).
- Open design point (Claude, the user decides): the older entry said to keep only an over/under flag and discard the
  birthdate (a birthdate is personal data). Rule 1 needs the age to change over time (a 17-year-old turns 18), so a
  single flag is not enough. Options include storing only the date the player turns 18, or only the birth year and
  month. Bring this to the legal review.
- Note on the badge example: the year in "great save nuke of 2026" should match when the 0.16.0 wipe actually happens.

## Pre-0.16.0: referral system (user, 2026-11-20): REQUIREMENT, design open

Earlier capture of the same idea: SUGGESTIONS.md "REFERRAL BONUSES (user 2026-08-31, 100% wants)" (link or code,
tiered rewards for 1 / 5 / 10 referrals, flex not power, the playtime-gate farming trap). Read both together.

The user (verbatim): "Pre-0.16.0: We need a referral system of some sort. A generatable link that gives credit to a
player for referring a friend to the game, as well as some sort of reward structure for this. It needs to be properly
balanced as well. Perhaps something like getting some sort of reward any time certain milestones are reached by another
player. So you can't just spam-create accounts and get instant referral bonuses. An idea (that is not set in stone)
would be something like silver and gold level achievements presenting the referrer with a bonus of some sort, and/or
purchases by the referred will reward the referrer in some way as well."

- REQUIREMENT: a **generatable referral link** that credits the referrer; a **reward structure** that is properly
  balanced; rewards come from **milestones the referred player reaches**, never at sign-up, so spam accounts earn
  nothing. Lands **before 0.16.0**, and needs accounts, so after the 0.14.1 online work.
- IDEAS, not set in stone (user): silver and gold tier achievements that give the referrer a bonus; purchases by the
  referred player reward the referrer.
- Facts (Claude, 2026-11-20): no referral code exists; no tiered (silver/gold) achievement system exists; no real-money
  purchases exist; accounts arrive with 0.14.1. The closest existing piece is gift-code redemption
  (accountExtras.ts redeemGift), a server-delivered grant into the save, which is the deterministic way a referral
  reward would arrive too.
- Devil's advocate (Claude, for the design pass; nothing decided):
  1. **Milestones must be server-verified.** Progress is client-side today and an edited save imports unchecked (Codex
     round 8), so a referral milestone read from the client can be faked. It needs the same server-side progress
     record that 0.14.1's leaderboard and rollback hardening needs.
  2. **Idle games are cheap to farm.** Progress accrues offline, so one person can run several alt accounts in
     parallel for little effort. Milestones that need real calendar time and real play (returning on several days,
     choices only a person makes) cost a farmer far more than a raw progress number. Per the standing rule, a limit
     on rewarded referrals would be diminishing returns, not a hard cap (if the user wants a limit at all).
  3. **What the reward is matters for fairness.** Permanent power bonuses (multipliers) would leak into leaderboards
     and favor players with big friend lists. Cosmetics, titles, or one-time grants keep it fair. Whether the
     referred friend also gets a welcome reward is open.
  4. **Purchase-based rewards** need a hold period (refunds and chargebacks would otherwise mint free rewards), must
     never show the referrer what the friend bought (privacy: show only "your referral reached Gold"), and come under
     app-store rules if the game ever ships in a store.
  5. **The link must not expose the referrer:** a random code, never an email or account id.
- Open for the user: the milestones (what silver and gold mean), the reward kinds for each side, whether purchases
  count, and any limit on rewarded referrals.

## Future (unscheduled): research tech trees (user, 2026-11-17)

Research by TYPE picked like a spec (ship classes, ship systems, crew equipment, components, ...), each opening a
radial tech tree with prerequisites; several trees with several starting points so it does not timegate. The user
leans toward it and will ask players; 0.14.0 ships search and filter instead. Full capture:
docs/plans/2026-11-17-research-tech-tree-idea.md.

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

### Fable pass 2: cost measurement (user, 2026-11-18)

User: "Once we are ready to start that, then I will want to have a proper analysis of how much each of those passes
costs in terms of session and weekly limit so I don't overdo it."
- Claude reads the plan limits itself (get_usage: 5-hour, weekly all models, weekly Fable) BEFORE and AFTER each lane
  and reports a per-lane table, so the user can stop or reorder lanes partway.
- Lanes run ONE AT A TIME with no other builders running, so each lane's cost is attributable (slower than four at
  once; this hub session's own small use is noted alongside). Readings are whole percents, so a lane under 1% reads as 0.
- Before launching: show the current readings and an estimate (the first sweep, four lanes in parallel, used about
  10% of the weekly Fable limit; confirmed 2026-11-18 as Fable weekly 10% still in that week's window), and the user
  says go.

### Fable pass 2: additions after the 2026-11-16 fix round

What the fix round changed that pass 2 must cover (merged to feat at 9190eaa8, emoji sweep ee5cc47a, follow-ups
4ad2189b; carrier crew chunking fix pending):
- New save state to validate on import and to treat as client-claimed online: `Expedition.listNotes`, `heldLaunch`,
  `HeldSystem.listSeed` / `scanStepsRolled` / `anomalyCharted`, `GameState.listRewinds`, `repairPause.target` /
  `jobMinutes`, `craftOrders` and `joined` lanes, `recapTally` (with the 200-entry `promoted` ring), the completion
  log's `auto` stamp, the ship roster view preference (device storage). Lane 1 checks schema, bounds and NaN for each.
- Never discard over cap: deliveries now land in full and a load trims nothing. Lane 1/3: can any path grow an
  inventory or the save without bound (mission secondary finds are open user question 12), and what does that do to
  save size, export/import and a future server.
- Seed rewind on recall (`rewindExpeditionSeed`, list restore): lane 2 (a server must own or verify the list seed) and
  lane 3 (any recall/relaunch order that rerolls, re-pays or rewinds; FR-E review found two such chains, both fixed).
- Lane join (borrowed lanes, Cancel stops the whole order), the welcome batch's max-flow seating, Sell's Free
  (minus queued salvage), Overtime refusal epsilon, the salvage refund curve and the 50 cr canister: lane 3 for
  sell/refund/craft loops at the new prices; lane 4 for regressions.
- Repeat patrols: resume when safe, climb every 20 routes [PROVISIONAL], the outmatched stop. Lane 3: can a player farm
  a floor route or force a cheap pause loop; lane 4: patrol and gear wear regressions.
- Emoji sweep: the guard test (noEmoji.test.ts) is the regression check; lane 1 also confirms no `{@html}` path was
  introduced by the icon conversions.
- Performance as a stability issue: Repeat patrols simulate about 20% slower after FR-E; include it in the phone
  catch-up measurement (user: "Measure first").
- Model note (user 2026-11-16 check): the first sweep ran on Fable 5.2 (4 lanes); everything since (automated QA,
  builders, reviews) ran on Opus 5.5. Pass 2 runs on Fable 5.2, so its regression lane also double-checks the Opus fixes.
