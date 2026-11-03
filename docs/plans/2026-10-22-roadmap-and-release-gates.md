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
