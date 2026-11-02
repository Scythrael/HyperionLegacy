# E5 Refugee Posts: design (0.14.0)

Status: DESIGN for sign-off, 2026-11-02. It closes the short-range plan's open call 2 and phase E5 of the exploration
plan. Brainstormed with the user on 2026-11-02; every **(user)** line below is their answer, and every **(guess,
confirmed)** line is a guess of mine the user confirmed ("I like the guesses as well").

## 1. Intent and why

The saga design locked this loop on 2026-09-15 (C.3): "Evacuation missions (a peacetime job for big explorers) award
**refugees**, who get **posted at facilities** and act like mini-Senior-Staff, buffing that facility. This closes a
loop: exploration produces people, people improve the homeworld, and it gives large-hold hulls a reason to exist beyond
the frontier."

Short-range missions (G1, built) already carry refugees *outward* to new camps, using the hull's guest quarters. E5 is
the other direction: evacuations bring people *home*, and those people make the homeworld better. Peace is the product
here. Rescuing someone should feel good and stay useful. Nothing is lost, nothing is punished, and nothing needs
babysitting.

## 2. What the player experiences

1. **(guess, confirmed)** An **Evacuation** job appears among the short-range board's templates ("Evacuate [planet]").
   It uses the existing requirement sheet, so guest quarters matter, and the Eir medical transport and other big
   explorers are its natural ships.
2. **(user)** **Each successful evacuation run brings home one named refugee**, with a name, a background and a skill.
3. **(user)** Refugees are **a few named people** you get to know, close to Senior Staff in feel. They are not a
   population counter.
4. **(user)** **A refugee's background fits certain facilities.** At a fitting facility they give a strong buff; at any
   other facility, a small one. Placement matters.
5. **(user)** **Each facility's posts grow with its level:** one post at first, more as the facility is upgraded.
6. **(user)** **Everyone not yet posted waits at home** on a waiting list, with no limit. Nobody is ever lost.
7. **(user)** **Reassigning is free, any time:** move people between posts and the waiting list with no cost and no
   cooldown.
8. **(user)** **Skill is fixed when a refugee arrives, and it varies by person.** There is no leveling.
9. **(guess, confirmed)** **Harder evacuations bring more capable people:** a higher-tier evacuation rolls a stronger
   skill.
10. **(user)** **Facility cards show a "Posts" row:** faces in filled posts, empty slots to fill from the waiting list.
    **(user)** The waiting list lives under Personnel.
11. **(guess, confirmed)** **A new save starts with zero refugees.** The Posts rows appear only once the first refugee
    arrives.

## 3. Goals, non-goals, anti-goals

**Goals**
- The evacuation -> person -> facility buff loop works end to end and is measurable: every refugee buff measurably
  acts (the "everything wired" rule).
- Big guest-quarters hulls get a peaceful reason to fly.
- A player can see each person's name, background and skill, and their effect on the facility.

**Non-goals (0.14.0)**
- Refugees never fly, never fight, never take officer or crew seats, and never join away teams. They are not Senior
  Staff and do not use the officer systems.
- No refugee leveling, traits trees, morale or needs.
- No story or quest content around refugees (0.15.0 may add some).

**Anti-goals (a failure even if it works)**
- Anything that punishes: losing a refugee, upkeep, unhappiness, or a refugee leaving.
- Busywork: forced re-posting, timers to babysit, or a cost for moving people.
- Hard caps on stacked buffs. Use diminishing returns (D23).
- Emoji graphics. Portraits and icons are SVG (the graphics rule).

## 4. Constraints (project rules)

- **Determinism:** offline == live; one call == chunked == 1 s steps. A refugee's rolls happen at a defined moment (the
  run's completion) from a seeded stream, and runs in flight replay byte-identically.
- **Save:** new optional fields with safe defaults. Old saves load with zero refugees.
- **Goldens first** for any engine change; every moved pin is traced by a switch fixture; never loosen a tolerance.
- **Wiring registry:** each facility buff a refugee gives is a registry row with a consumer and a measuring audit.
- **Text:** US English, no em dashes, no "--", say "install" never "fit".
- **UI:** the facility "Posts" row and the waiting list need a **mockup the user signs off before the build** (the
  mockup rule). Desktop and phone (375 px).
- **Names:** original names, generated the same seeded way the game makes other crew names.

## 5. Decided shape (for the builder)

- **Refugee record:** id, name, background, skill (fixed at arrival), origin (the evacuation's planet and tier), and
  posting (facility id or none).
- **Backgrounds:** a small set, one per facility family the homeworld has (e.g. mining, refining, research, shipyard,
  medical, logistics). The builder maps them onto the actual facility list in code. **(guess, confirmed)**
- **Buff:** each background names the facility stat it improves. Fit = strong, other = small (a ratio, e.g. fit 1.0 and
  off-fit 0.25 [PROPOSAL]). Several refugees on one facility stack on the D23 diminishing curve.
- **Posts per facility:** a function of facility level, starting at 1 [PROPOSAL: +1 post every N levels, N in the
  plan].
- **Skill roll:** seeded at the run's completion; the evacuation tier sets the range, so higher tiers roll higher
  [PROPOSAL numbers].
- **Evacuation template:** a short-range template like the existing ones; its success yields exactly one refugee. It
  follows short-range's rules (training runs, Pilot Cunning, safe first runs).

## 6. Left to the builder and plan

- The exact facility list, background list, stats and numbers ([PROPOSAL] or [PROVISIONAL], for the balance pass).
- Where the evacuation template sits in the board's template weights and tiers.
- Help topic, QA sheet, registry rows, goldens and switch fixture.
- Build order: likely (1) data and save, (2) the evacuation template and refugee roll, (3) facility buffs and posts,
  (4) UI after the mockup sign-off, (5) Help, QA and close-out.

## 7. Builder-check answers (2026-11-02)

**The user's answers:**
- **Arrival rate (verbatim):** "Arrivals taper off, but as we should account for the total slots available for refugees
  on the planet to be able to work in a given spot, then the tapering is based off of that, but the arrivals can keep
  coming. Especially since they will eventually be able to be relocated to colonies if you run missions with refugees.
  That was the idea, anyway. A mission to bring refugees to a new colony. Perhaps refugees on the planet can be
  accounted for that way. That'll have to be planned out as you don't want to burn all of your refugees on these
  missions, but you don't want to sit at the hard cap forever. Perhaps there's a better way to do this."
  The hub proposed a balance, and the user picked "Yes, build it that way (Recommended)":
  1. **Arrivals taper against open posts.** While empty posts exist or the waiting list is short, an evacuation always
     brings someone. As the waiting list grows past the number of empty posts, the arrival chance falls smoothly and
     never reaches zero [PROPOSAL curve, e.g. chance = 1 / (1 + max(0, waiting - openPosts) / K)]. Upgrading facilities
     opens posts, which raises it again. The chance is rolled at the run's completion from a seeded stream.
  2. **Relocation drains the waiting list.** The existing outbound Refugee Relocation template takes ONE waiting
     refugee along as the new camp's leader whenever the list is non-empty (a farewell log line). It never takes a
     posted refugee. Without anyone waiting, it runs exactly as today.
  3. **Posted refugees are safe.** Nothing ever removes them.
  4. A real colony system (relocated people founding colonies that matter) is LOGGED for a later patch, not built.
- **Evacuation template:** "Random, like the others (Recommended)": an eighth template the board rolls at random;
  the player can't aim for refugees. NOTE for the builder: adding a key changes the draw on existing saves. Keep old
  boards byte-identical (stamp or version the template draw so upcoming jobs on existing saves don't change), with
  goldens first and a switch fixture.

**Hub calls (the user can override):**
- **Reward:** evacuations pay the board's normal credits and XP for their tier, PLUS the refugee, so board income
  (call 13, ~1,000 to 1,300 cr/h) holds.
- **Skill** is one strength number. The background picks which facility stat it improves. The card shows both.
- **No race for refugees:** they don't go through generateCrewIdentity's race and racial bonus. They get names from the
  same seeded name generator; portraits are SVG (the officer-art style or a simpler silhouette, decided at the mockup).

**Facility list (fact):** refinery, fuelStorage, missionControl, research, fabricator, shipyard, salvageBay,
subspaceTelescope. There is no mining or medical facility, so backgrounds map onto these eight (e.g. refiner, fuel
handler, dispatcher, scholar, machinist, shipwright, salvager, stargazer) [PROPOSAL].

## APPROVED (user, 2026-11-02)

"Approve, start the mockup (Recommended)". Next: a mockup of the facility Posts row + the Personnel waiting list for sign-off, then the build plan.
