# Ground Operations (0.14.0, D25): DESIGN DRAFT

Status: DRAFT for user review (2026-10-09). Source decisions: D24 and D25 in `2026-10-02-crew-made-real-e-crew-design.md`
(read those first; the user's words there are authoritative). Everything marked **[PROPOSAL]** is mine and is the
user's to accept, change or reject. Scope: in 0.14.0 (user: "this was my originally envisioned plan").

## 1. The loop in one paragraph

A ship fields one or more GROUND TEAMS (each = a Security squad + a Science squad, 1 to capacity each). The ship
scans each planet; when a planet's scan completes its TASKS appear. The player queues tasks per team (or lets a
default plan run). A team drops, works its task (a progress bar with fights along the way), then RETURNS TO THE SHIP:
it offloads its findings, recovers in the MEDICAL BAY (health, ailments, injuries all tick down at once), reloads, and
deploys on its next task. A Security wipe stops the task's progress where it was; the team returns, recovers, and
resumes from that point. A task, once complete, is done for that planet.

## 2. Teams and assignment

- `ShipTypeDef.awayTeams` already carries `count`. A ship's ground-team count = its Security count (paired 1:1 with
  Science). Every hull stays at 1 for now (user); the engine supports N. **[PROPOSAL]** teams are labeled A, B, C.
- New per-ship state: each ground team has a Security slot list and a Science slot list (squad sizes from the hull).
  The player outfits members (existing gear UI), then SLOTS them into a team's squad. Replaces today's implicit
  "first N ready members in hire order".
- Per team: a **"When done, help other teams"** toggle (user's "join other teams in progress"). A helper takes
  unfinished tasks from other teams' queues that it qualifies for; **if a helper fails a borrowed task it skips it and
  moves on**, leaving it to the team it was assigned to (the user's anti fail-loop rule). **[PROPOSAL]** "qualifies" =
  its one-go clear chance on that task is at least the "Favorable" threat tier.
- Squad Loadouts (Task 18) save per ground team, not per team type.

## 3. Tasks

- Generated when a planet's scan completes (unchanged discovery rules).
- New task fields: `requiredTeams` (default 1; wired so content can ask for 2+), `progress` (0 to 1, PERSISTS across
  losses), `assignedTeamIds`, `status` (queued, active, done, skipped), and the fight points along the bar.
- **Work and fights [PROPOSAL]:** a task's work time is today's `activityDurationSeconds` (Science fieldwork speeds it,
  D23 pace curve). It holds a few fight points spaced along the bar (count from the PoI's threat). Security must win a
  fight to pass its point. A loss (Security wiped) freezes progress at that point; on return the team re-fights that
  point (a fresh keyed encounter per attempt) and carries on.
- **Rewards [PROPOSAL, OPEN]:** the haul accrues as progress passes each segment and is OFFLOADED at every return
  (kept on a loss, since progress is kept); the relic roll happens once, at completion. User words to reconcile:
  "When the task is complete on that planet, it's done. You got all of the goodies" and "return the items they
  received from their task".
- A multi-team task (`requiredTeams` 2+) fields all its teams together: their Security squads fight as one side,
  their Science fieldwork sums.
- Skip by hand any time; a skipped task can be re-queued later.

## 4. Choosing tasks (user: default plan, editable)

- When a planet's tasks appear, the player can assign them per team in a queue screen. If the player has not chosen,
  the **default plan** runs: **[PROPOSAL]** hardest task to the strongest team (by threat indicator), and so on down;
  plus the user's **"Auto-assign randomly"** button for players who do not want to pick.
- The queue can be reordered, reassigned or skipped any time. Edits apply from "now" (the run is resolved up to the
  edit first), so a run stays a pure function of its stored record (offline == live).
- Teams that finish their queue early return to the ship and idle (or help, if toggled).
- Content note for the balance pass (user): tasks must be "weighed appropriately, include a proper number of tasks"
  so set-and-forget works ("5 things that take a minute each" is too few; many 5 minute tasks with auto-assign is
  the intended shape).

## 5. The return trip: offload, medical bay, reload

After every task (won or lost) the team returns:
1. **Offload** findings. **[PROPOSAL]** a base time scaled by the crew's existing Operations unload bonus
   (`unloadSpeed`), per the user's "crew complement with the bonus impacting loading".
2. **Medical bay:** every member recovers full health and every condition. Each condition TYPE has its own cure time;
   all tick down at once, so the bay time is the LONGEST one (user: "1000 ailments and 1 fracture ... you wait for 10
   ticks"). Terms (user): **ailments** = non-physical (poisons and so on); **injuries** = physical (fracture,
   concussion and so on).
3. **Reload** gear and kits (same unload bonus).
Then the team deploys on its next task.

**Cure times [PROPOSAL, first pass; 1 tick = 1 second]:** the user's "health ~5 ticks, fracture 10" were illustrative
of the rule. Proposed: full health 60s; Poison / Bleed / Blindness 60s; Neurotoxin, Hemorrhage 5 min; Concussion 15
min; Fracture 30 min; Downed (knocked out) 20 min. Divided by (1 + Medical + Rapid Recovery) frozen at dispatch (D23,
D24); Ossir Stoneskin x1.25 on injuries; the Injury Kit (Field Kits) cuts a member's bay time.

## 6. Within a fight and a task

- A member downed in a fight their squad WINS sits out the REST OF THAT TASK (the team continues one short) and heals
  in the bay on the return trip. (Refines D25's "until recovered": the return trip is when recovery happens.)
- A wipe during a SCAN pauses that planet's scan until the watch team has been through the bay. **[PROPOSAL]** team A
  stands scan watch.
- At run end, anyone still in the bay comes home with the remaining time (this replaces Task 16's flat 2h-on-claim).

## 7. Threat indicator

Mirror ship combat: sample the real ground battle (`resolveGroundBattle`) for a team against a task's fights, many
seeded runs, and show the chance to clear the WHOLE task in one go as the existing 7 named tiers (Guaranteed Victory
down to Impossible, `threatAssessment`). Display only; never changes outcomes. Shown per team in the queue screen and
on each task card, so the B team is not sent where the A team belongs.

## 8. Engine shape and determinism

- The run becomes an event schedule of team timelines (deploy, work segments, fights, return, offload, bay, reload),
  each step a pure function of the stored Expedition (keyed streams per team, task and attempt; no draws from shared
  streams). Live queue edits are stored on the run and apply from their timestamp.
- New runs carry a flag field (like `encounterSteps`); runs launched before this resolve on the legacy path.
- SAVE_VERSION bump (team slot state, task fields, queue edits).

## 9. What this supersedes

Task 16 "sit out the rest of the run" (now: rest of the task), `MAX_BATTLE_ATTEMPTS` retries and the 40% evacuation
haul (now: progress persists, retry after the bay), the flat 2h injury on claim and D24's "clock starts at run end"
(now: per-condition bay times during the run, remainder carried home), Task 17's single-squad gambit UI and Task 18's
per-team-type loadouts (now per ground team).

## 9b. User answers (2026-10-09)

1. Rewards on a lost task: keep the haul from finished segments, relic at 100%. User: "Only if we don't go with a
   progress marker. If the progress meter is there, then they can't re-farm the same portion over and over and over.
   They would hit the same wall that killed them last time!" (Progress persists, so a kept segment can never be farmed
   again; the team resumes at the fight that beat it.)
2. Fight points along the bar set by the site's threat, a fresh encounter per retry: approved.
3. Default plan (hardest to strongest) + "Auto-assign randomly": approved.
4. Helpers only borrow tasks rated at least "Favorable": approved.
5. Cure and offload/reload times as proposed: approved.
6. Scan watch: user asked what it means ("The ship's scanning would be done if someone's on a planet fighting");
   clarification sent.
7. Team labels: user asked "ABC?"; clarification sent.

## 10. OPEN CALLS for the user

1. Rewards on a lost task: haul kept per completed segment, relic only at completion (section 3)?
2. Fight points per task from the PoI's threat, and a fresh encounter per retry (section 3)?
3. Default plan = hardest to strongest, plus an "Auto-assign randomly" button (section 4)?
4. Helper qualification = at least the "Favorable" threat tier (section 2)?
5. Cure times (section 5) and the offload / reload base times.
6. Team A stands scan watch (section 6)?
7. Team labels A, B, C (section 2)?
