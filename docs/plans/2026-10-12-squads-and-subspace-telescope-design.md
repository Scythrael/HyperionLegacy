# Squads, Team Types, Risk Factors and the Subspace Telescope (0.14.0): DESIGN DRAFT

Status: DRAFT for user review (2026-10-12). Nothing here is built. Scope: in 0.14.0 (user, 2026-10-12: "Let's get
this done in 0.14.0").

**Authority order:** the user's decisions, then this design, then code. Source decisions (read first):
- `2026-10-09-relics-v2-and-expedition-tiers-capture.md` section 3b (item 10 verbatim: difficulty ratings, Strike /
  Survey / Ground, mix-and-match squads, risk factors, telescopy) and section 3c (CONFIRMED: every hull doubles to 4
  squads; teams are PAIRS of squads; "Always require one of each type minimum"; the Subspace Telescope: range =
  which systems it can pre-survey, nearer regions first; sensor effectiveness = detail; out-of-range systems launch
  blind).
- `2026-10-02-crew-made-real-e-crew-design.md` D18 (1 Security AND 1 Science to launch), D25 (ground teams assigned to
  tasks, N-team tasks, threat indicator, medical bay loop), D26 (Science gear rolls fieldwork lines, not combat).
- `2026-10-09-ground-operations-design.md` + `-plan.md` (what is built: GO-0 to GO-7c and their carry notes).
- `2026-10-08-gas-giant-study-design.md` 1c (Tiers I to VII approved, Roman numerals for every tier shown in game).

**Markers.** `(user)` = the user's decision, quoted or confirmed. **[PROPOSAL]** = mine: every name, number, rule and
formula so marked is the user's to accept, change or reject. Nothing marked [PROPOSAL] is a game entity until the
user approves it.

**The philosophy this serves (user, 2026-10-12, verbatim):** "The universe is not a safe place, but we want to be
able to practice our skills and grow in a place that feels safer before everything starts to try to kill us."

## 1. The loop in one paragraph

Every hull fields **4 squads** (user), grouped into **2 teams of 2 squads** (user). The player picks each team's
**type**: **Strike** (2 Security), **Survey** (2 Science) or **Ground** (1 + 1) (user), with **at least one Security
and one Science squad on the ship** (user). Before launch, the homeworld's **Subspace Telescope** (user) pre-surveys
every candidate system within its **range** and reads its **risk factors** (combat, fauna, flora, hazard) at its
level of **detail**; at high detail it puts a **squad recommendation** on the expedition card ("Launch with Strike +
Ground") so the player does not "mis-spec" and arrive with "a poorly made team" (user). Systems beyond range launch
**blind** (user). On the planet, every task states a **squad requirement** and carries a **difficulty rating** that
weights the system's completion % (user). The nearby regions are mostly safe survey work; the far regions need
several Strike squads (user).

## 2. Squads and teams: data model

### 2.1 Terms

- **Squad** (existing term): a typed group of member slots, **Security** or **Science** (user). Its size is the
  hull's existing per-type squad size (`ShipTypeDef.awayTeams[].size`: 3 / 3, 3 / 4 or 4 / 4 by hull), unchanged.
- **Team** (existing term, ground team): a PAIR of squads (user). Default names stay Alpha / Bravo, short labels
  A / B (user, GO 9b.7).
- **Team type** (user names): **Strike** = Security + Security; **Survey** = Science + Science; **Ground** = Security
  + Science.
- **Composition** [PROPOSAL term]: a ship's team types, e.g. "Strike + Ground".
- **Crew** (existing internal term from GO-7c `crewOf`): the team or teams working one task together.

### 2.2 Hull data

- Every hull gets **4 squads** (user: "DOUBLE EVERY HULL"). New field **[PROPOSAL]**
  `ShipTypeDef.groundSquads: number` (4 on every hull today; "bigger hulls get more later", user). Team count =
  `groundSquads / 2` (an odd future value is a data error caught by a test).
- `awayTeams[].size` keeps the squad SIZE per type. `awayTeams[].count` for Security / Science stops meaning anything
  (the composition decides how many squads of each type); it stays in the data for Prospecting (count 0, wired only)
  and a test pins that Security / Science `count` is no longer read **[PROPOSAL]**.
- `groundTeamCount(typeKey)` becomes `groundSquads / 2` (2 on every hull). `groundSquadSize(typeKey, type)` is
  unchanged.

### 2.3 Persisted shape (SAVE v68)

The smallest change to GO-1's `ShipGroundTeam` is to add the team's type and let the existing flat slot lists grow or
shrink with it **[PROPOSAL]**:

```ts
export type GroundTeamKind = "ground" | "strike" | "survey";     // user names; stored ids lowercase [PROPOSAL]

export interface ShipGroundTeam {
  name?: string;                     // unchanged (GO-1)
  kind: GroundTeamKind;              // NEW (v68)
  // Squad-major flat slot lists, as GO-1 stores them, sized by the kind:
  //   security.length = securitySquadsOf(kind) * groundSquadSize(hull, "security")
  //   science.length  = scienceSquadsOf(kind)  * groundSquadSize(hull, "science")
  // Squad k of a type holds slots [k * size, (k + 1) * size). Ground = 1 + 1 (GO-1's exact shape),
  // Strike = 2 Security squads + an empty science list, Survey = the mirror.
  security: (string | null)[];
  science: (string | null)[];
  helpOthers: boolean;               // unchanged (GO-1)
  kindPending?: true;                // NEW (v68): set on the pair the migration adds; cleared the first time
                                     // the player confirms or changes this team's type (UI prompt, section 7.1)
}
```

Why flat lists and not a `squads[]` array: every GO reader (fights read `security`, fieldwork reads `science`, the
union snapshot, the slot invariants, `findGroundSlot`) keeps working unchanged; the squad index is derived
(`slotIndex / size`) wherever the UI needs it. The alternative (an explicit `squads: { type, members }[]` per team)
reads closer to the user's words but touches every GO-1 to GO-7c reader. **[PROPOSAL]** flat lists.

Pure helpers **[PROPOSAL names]** in a new `groundComposition.ts` (imports model.ts only):
`securitySquadsOf(kind)`, `scienceSquadsOf(kind)`, `teamKindLabel(kind)` ("Strike team"), `shipComposition(ship)`
(squad counts per type), `isValidComposition(kinds)`, `validCompositions(typeKey)`, `compositionLabel(kinds)`
("Strike + Ground").

### 2.4 Valid compositions under "one of each type minimum"

The user's rule: "Always require one of each type minimum." Applied at TWO points:

1. **Composition (per ship):** the ship's 4 squads must include at least 1 Security and 1 Science squad. On a 4-squad
   hull that leaves exactly four valid compositions (order of the two teams does not matter):

   | Composition       | Security squads | Science squads | Valid |
   |-------------------|-----------------|----------------|-------|
   | Ground + Ground   | 2               | 2              | yes (the default) [PROPOSAL default] |
   | Strike + Survey   | 2               | 2              | yes |
   | Strike + Ground   | 3               | 1              | yes |
   | Survey + Ground   | 1               | 3              | yes |
   | Strike + Strike   | 4               | 0              | NO: no Science squad |
   | Survey + Survey   | 0               | 4              | NO: no Security squad |

   The picker refuses the two invalid ones with the reason (section 7.1). Consequence: **a 4-squad hull fields at most
   3 Security squads.** A task needing "2 Strike teams" (4 Security squads) needs a bigger hull (OPEN CALL 3).

2. **Deployment (across the deployed teams):** D18 stands (user, 3c): what actually deploys must include at least 1
   ready Security member AND 1 ready Science member. GO-2's ship-level check already sums across deploying teams;
   it stays. A ship whose Strike team is in the bay and whose Survey team is ready cannot launch, and the dispatch
   attempt says what it waits on (user, GO 4b "not-ready slotted members").

**Per team [PROPOSAL]:** a team deploys when every slotted member is ready AND each of its two squads has at least 1
member slotted (a "Strike team" with an empty second squad would be a mislabel; the dispatch line reads "Bravo:
squad 2 has nobody slotted"). This REPLACES GO-2's per-team "1 Security AND 1 Science" check, which a Strike or Survey
team could never pass.

### 2.5 The hire cap

Today the cap is `squadSlots(hull, type)` = size x count (count 1), so a ship holds one squad of each type. New
**[PROPOSAL]**: the cap is per SHIP and follows its composition:

```
shipSquadSlots(ship, type) = groundSquadSize(hull, type) * (squads of `type` in shipComposition(ship))
```

Ground + Ground doubles both caps (the user's "doubling the number of ground team totals"); Strike + Ground on a
3 / 3 hull holds 9 Security and 3 Science. Reserves (members aboard but unslotted) still count toward the cap (GO-2
rule), and benched members do not.

### 2.6 Changing a team's type

Action **[PROPOSAL]** `setGroundTeamKind(state, shipId, teamIndex, kind)` in `groundTeams.ts`:
- Refuses while the ship is crew-locked (out on a run), like every slot write (GO-2).
- Refuses a change that would leave the ship with no Security or no Science squad (reason **[PROPOSAL]**
  `needsBothTypes`, text "A ship needs at least one Security squad and one Science squad").
- Keeps every member whose type the new kind still holds, in slot order (Ground -> Strike keeps the Security squad as
  squad 1; Ground -> Survey keeps the Science squad as squad 1). Members of the dropped type go to the RESERVE (aboard,
  unslotted). Then the new empty squad auto-fills from the reserve of its type in hire order (the GO-2 auto-slot QoL)
  **[PROPOSAL]**.
- If the new composition's cap is below the members of a type aboard, the change is ALLOWED and the extras stay in
  the reserve over the cap; hiring that type is refused until the count drops (text "Science is over capacity: 3 in
  reserve"). The UI confirms first, naming who moves ("Sho and Vela move to the reserve") **[PROPOSAL]**. The
  alternative (refuse the change until the player benches the extras) adds clicks; OPEN CALL 4.
- Clears `kindPending`. Docked ships only (the crew lock above).

### 2.7 Migration: SAVE v67 -> v68

`MIGRATIONS[67]` **[PROPOSAL]**, one bump for the squad state and the telescope's founding level (section 6.2):
- Every ship's EXISTING team (index 0) gets `kind: "ground"`; its slots are untouched (GO-1's shape IS Ground).
- Every ship gets a SECOND team appended: `{ kind: "ground", security: [nulls], science: [nulls], helpOthers: false,
  kindPending: true }`. It reads as Ground until the player picks (user: "a second empty pair whose composition the
  player picks"); the Away Team tab shows a "Pick a type" prompt on it. **[PROPOSAL]** a pending team still deploys as
  Ground if the player slots people into it without choosing (no friction); the alternative (a pending team never
  deploys) is OPEN CALL 2.
- A ship whose `groundTeams` is not well formed is backfilled by hire order exactly as v67 did, then extended.
- No member moves. Every member aboard already sat in team 0 (the old cap was one squad per type), so nothing lands
  in the reserve; the doubled cap simply opens team 1 for the next hires (auto-slot puts them there).
- `GroundTeamLoadout` gains optional `kind` (absent = "ground"); a loadout applies only to a team of the same kind.
  (`squadLoadouts` is still always `[]` in real saves: GO-17 is not built.)
- `facilities.subspaceTelescope = { level: 1 }` (section 6.2).
- **In-flight runs are untouched.** `GroundOpsState.teams[]` (GO-7a/7b) records member ids per deployed team and
  never reads `kind`; a run launched on v67 keeps resolving byte-identically (parity test: an in-flight v67 run, its
  claim, and an hour of `tick` serialize identically after migration, the same proof GO-1 used).
- Ships minted after v68 (shipBuild, the captain grant) read as `emptyGroundTeams(hull)` = Ground + Ground, no
  pending flag **[PROPOSAL]**.
- `isWellFormedShipGroundTeams` checks `kind` and the kind-sized lengths; `shipGroundTeams` normalizes to them.

## 3. Deployment and the engine, generalized

Principle: a team is 2 typed squads; **fights use every Security squad of the crew, fieldwork every Science squad of
the crew** (user brief). The GO-7c joint machinery (staging, the lead, `crewOf`, one fight side, summed fieldwork,
team-set banking) already does exactly this for N teams, so most of the engine carries forward.

### 3.1 `deployableGroundTeams`

- `GroundTeamReadiness` gains `kind` and per-squad counts (`squads: { type, members }[]`, derived) **[PROPOSAL]**.
- Waits gain `{ kind: "emptySquad"; squadIndex }` in place of `needSecurity` / `needScience` per team; the ship-level
  `noTeamReady` reason splits into `noTeamReady` and **[PROPOSAL]** `missingType` ("Nothing ready covers Science:
  Bravo (Survey) waits on Lio, back in 12m").
- The ship-level D18 sum is unchanged.

### 3.2 Task requirements in squads (replaces `requiredTeams` N)

New optional task field **[PROPOSAL]** on `ExpeditionActivity`:

```ts
needs?: { security: number; science: number };   // minimum SQUADS of each type the crew must bring
```

- **Carry-forward of the joint wiring:** a stored or content `requiredTeams: N` reads as
  `{ security: N, science: N }` (N Ground teams' worth). `requiredTeamsOf` becomes `taskNeedsOf(task)` **[PROPOSAL]**.
  No content sets either today, so no stored run changes.
- **Generated needs (risk-aware runs, section 5.3) [PROPOSAL]:**
  - `security` = 0 when the task has no fight points; 1 for 1 to 3 fight points; 2 for 4 or 5.
  - `science` = 1 for every fieldwork site; 2 for Ancient Ruins, Buried Vault and Subterranean Civilization from
    Tier II up (big archaeology: "going survey squad heavy makes sense", user); 0 for a pure clearing task (the
    hostile sites in section 5.3).
- **Shown as team types where it maps** (section 7.3): {1,1} "Ground team"; {2,0} "Strike team"; {0,2} "Survey team";
  {0,1} "1 Science squad (Survey or Ground)"; {2,1} "Strike + Ground, or 2 Ground teams"; {4,0} "2 Strike teams".

### 3.3 Planning: crews instead of team counts

- **A task's crew** = the SMALLEST set of deployed teams whose summed squads meet its `needs` **[PROPOSAL]**. One team
  if any single team qualifies (the GO-7c default plan then ranks as today: hardest to the strongest); else the
  smallest pair, strongest first by threat. This is GO-7c's "joint task goes to the N strongest teams", with "N
  teams" replaced by "teams that cover the squads".
- A Ground + Ground ship covers everything up to {2,2}; Strike + Survey covers {2,2} too but only as a pair for any
  task needing both types; Strike + Ground covers {3,1}. That trade-off is the whole point of the composition choice.
- A task no crew of the deployed teams can cover is `skipped` at planning with the existing log line, reworded
  **[PROPOSAL]** "Skipped Enemy Fortification: needs 4 Security squads, 3 deployed" (GO-7c `skippedNeedsTeams`
  becomes `skippedNeedsSquads`).
- **Helpers** borrow only tasks the helper covers ALONE (`needs` within its own squads) and that rate at least
  `HELPER_MIN_TIER` (unchanged). GO-7c's `requiredTeams === 1` test becomes "a crew of one".
- **Live edits (GO-7d)** validate `notEnoughSquads` instead of `notEnoughTeams`.

### 3.4 Fights and fieldwork

- **Fights:** one side = every standing Security member of the crew, team then slot order (GO-7c, unchanged). A
  Survey team alone has no Security, so it can only take tasks with no fight points (`needs.security` 0).
- **Fieldwork:** `taskWorkSeconds` over every standing Science member of the crew (GO-7c union, unchanged). A crew with
  no Science (a Strike team on a clearing task) works at the bare pace (`fieldworkSpeedMult` of an empty run = 1)
  **[PROPOSAL]**; Security Assault Hardsuit hazard lines still count (D26).
- **Crew layers (GO-7a `securityShare` / `scienceShare`):** split per SQUAD instead of per team **[PROPOSAL]**: the
  crew-complement Security layer divides evenly across the deployed Security squads, Science likewise. A Strike team
  then carries two Security shares and no Science share.

### 3.5 The joint return (GO-7c review item c)

GO-7c makes every team of a joint crew run its own offload though one set of findings pays. **[PROPOSAL]** the crew
returns and OFFLOADS ONCE as a unit (the lead's offload step; partners mirror it), then each team runs its own medical
bay and reload, and goes back to its own queue. Totals are unchanged; the partners just stop paying a phantom offload.

### 3.6 Threat indicator

`groundTaskThreat` (GO-6) samples a CREW (one team or the covering set) against the task. The queue screen shows the
odds of the crew the plan would send, and a team that cannot cover the task alone shows "Needs a partner" instead of
a tier **[PROPOSAL]**.

### 3.7 Unchanged

Medical bay, cure times, back of the line after 3 losses, recovery legs ("can't leave them to die"), carry damage,
ship-side scan events, field repair (GO-8b), Alpha / Bravo names.

## 4. Task difficulty and completion %

User (3b.10): "tasks should honestly have a difficulty rating to them (based on what is involved. A simple scan with
no combat and a scan with huge risk for example) that can impact completion."

**Rating [PROPOSAL]:** a score from what is involved, then five named grades with a completion WEIGHT:

```
score = fightPoints (0..5)
      + hazardBand(raw body hazard: < 0.3 -> 0, < 0.6 -> 1, else 2)
      + max(0, needs.security + needs.science - 1)        // every squad beyond the first
      + floor(bodyCombatGrade / 2)                          // section 5: None 0 ... Extreme 4 -> 0, 0, 1, 1, 2
```

| Score | Grade [PROPOSAL names] | Pips | Completion weight [PROPOSAL] |
|-------|------------------------|------|------------------------------|
| 0-1   | Simple                 | 1    | 1 |
| 2-3   | Standard               | 2    | 2 |
| 4-5   | Challenging            | 3    | 3 |
| 6-7   | Dangerous              | 4    | 5 |
| 8+    | Deadly                 | 5    | 8 |

- **System completion %** (G7) = sum(weight x task progress) / sum(weight) over the system's tasks **[PROPOSAL]**.
  A Deadly fortification moves the % eight times as much as a Simple outcrop. Whether the scan itself counts is G7's
  open item (expedition tiers mockup, open call 8) and is not decided here.
- Rated once when the task is generated (stored on the task as `difficulty?: 1..5`, optional, absent on legacy runs)
  **[PROPOSAL]**; display never recomputes from live state.
- Difficulty does NOT change the haul or relic odds in this draft (rewards stay as GO-4 rolls them); OPEN CALL 6.
- Grades use their own words so they never collide with Roman-numeral TIERS (user: tiers are Roman numerals).

## 5. Risk factors

User (3b.10): "perhaps it might be based on a set of \"risk factors\" or something. If it's in a known enemy
territory, the combat risk is high. Fauna and flora from deep-space telescopy could indicate the general
\"atmosphere\" to expect. This system could also be reused for things like combat campaigns later on."

### 5.1 The four factors

Every factor uses one five-step scale **[PROPOSAL]**: **None, Low, Moderate, High, Extreme** (0 to 4), with a flavor
line per step so a reading says something:

| Factor [PROPOSAL names] | Source (user words) | Low | Moderate | High | Extreme |
|---|---|---|---|---|---|
| Combat risk | "known enemy territory" | Patrol traffic | Hostile activity | Enemy territory | Enemy stronghold |
| Fauna | "deep-space telescopy" | Benign life signs | Territorial fauna | Predators detected | Apex predators |
| Flora | "deep-space telescopy" | Sparse growth | Dense growth | Aggressive flora | Toxic biosphere |
| Hazard | existing body hazard scalar | < 0.3 | < 0.5 | < 0.7 | >= 0.7 (None below 0.15) |

### 5.2 Generation (deterministic, previewable, never lies)

- A system's risk profile is drawn at generation from the candidate's seed on its own keyed stream (new salt
  **[PROPOSAL]** `RISK_SALT`, registered in `salts.test.ts`), from the REGION TIER's tables below. Because the
  candidate's seed IS the committed expedition's seed (E2c), the telescope's reading, the tasks it predicts and the
  run that follows are the same draw: the forecast cannot lie (the same posture as `previewRelicSets`).
- **Per system:** `combat` and `fauna` and `flora` grades drawn from the tier table; `combat` +1 (cap Extreme) when the
  system lies in known enemy territory, a zone on the per-player galaxy map **[PROPOSAL; the map and its zones belong
  to G2's region design]**.
- **Per body:** each grade = the system grade, then a keyed jitter of -1 / 0 (weights 30 / 70) **[PROPOSAL]**. Fauna
  and Flora read None on worlds that cannot hold life (barren, volcanic, gas giant; flora also None on frozen)
  **[PROPOSAL]**. Hazard is the body's existing hazard, banded.
- New module **[PROPOSAL]** `riskFactors.ts` (pure: seed, tier, planet types in; a profile out), reusable by combat
  campaigns later (user).

**Tier tables, system grade weights None / Low / Moderate / High / Extreme [ALL PROPOSAL]:**

| Tier | Region (approved ladder) | Combat risk | Fauna and Flora |
|------|--------------------------|-------------|-----------------|
| I    | Local Bubble             | 60 / 35 / 5 / 0 / 0   | 30 / 50 / 18 / 2 / 0 |
| II   | Orion Arm                | 35 / 40 / 20 / 5 / 0  | 20 / 40 / 30 / 10 / 0 |
| III  | Perseus Arm              | 15 / 30 / 35 / 15 / 5 | 15 / 30 / 35 / 15 / 5 |
| IV   | Sagittarius Arm          | 10 / 25 / 35 / 22 / 8 | 10 / 30 / 35 / 20 / 5 |
| V    | Scutum-Centaurus Arm     | 5 / 15 / 30 / 35 / 15 | 5 / 20 / 35 / 30 / 10 |
| VI   | Galactic Bulge           | 0 / 10 / 25 / 40 / 25 | 5 / 15 / 30 / 35 / 15 |
| VII  | Galactic Core            | 0 / 5 / 15 / 40 / 40  | 5 / 10 / 25 / 35 / 25 |

### 5.3 How the factors shape the tasks (risk-aware runs only)

Risk-aware generation is gated like GO's `groundOps` flag: a run launched after this ships carries its profile
(`Expedition.risk?`, optional); legacy runs keep today's fight points.

- **Fight points [PROPOSAL]:** `clamp(FIGHT_POINTS_BY_POI[poi] + combatMod + lifeMod + hazardStep, 0, 5)`, with
  combatMod by the body's combat grade: None -2, Low -1, Moderate 0, High +1, Extreme +2; lifeMod at life sites
  (Cave Network, Xeno-Flora Bloom, Subterranean Civilization) by fauna grade: None -1, Low 0, Moderate +1, High +1,
  Extreme +2; hazardStep as GO-4. **The floor drops from 1 to 0 for these runs** so a calm site is pure survey work
  (a Survey team can take it). `FIGHT_POINTS_MIN` stays 1 for legacy runs.
- **Flora [PROPOSAL]:** adds 5% task work time per grade on that body (dense growth slows the dig) and raises the
  Poison ailment chance in that body's fights; a High or Extreme flora body draws Xeno-Flora Bloom sites more often.
- **Hostile sites (user words "an enemy colony", "an enemy fortification") [PROPOSAL as task/PoI names]:**
  - **Enemy Colony:** from Tier III, on a body with combat High (15% per eligible body) or Extreme (30%); 4 fight
    points; `needs` {2,1} (a Strike team plus a Science squad: "you might have to use multiple teams", user).
  - **Enemy Fortification:** from Tier VI, on a body with combat Extreme (10%); 5 fight points; `needs` {4,0} ("later
    options require multiple strike teams to clear an enemy fortification", user). Needs a hull with more than 4
    squads (section 2.4): OPEN CALL 3.
  - Both need POI_CATALOG + FIGHT_POINTS_BY_POI + reward entries in the content pass.

### 5.4 The safe-to-dangerous gradient

| Tier | What a typical system asks for [PROPOSAL] | The hardest thing there |
|------|-------------------------------------------|-------------------------|
| I    | Most tasks 0 to 1 fights; a Survey team handles half the sites alone; one Ground team does everything | "caverns that contain indigenous life" needing a Security squad (user) |
| II   | Ground work; big archaeology wants 2 Science squads (Survey + Ground) | Territorial fauna at caves and blooms |
| III  | Ground + some Strike; Enemy Colony appears | Enemy Colony {2,1} |
| IV   | Strike + Ground becomes the common pick | Colonies on High combat bodies |
| V    | Strike heavy; predators at life sites | Colonies are common |
| VI   | 3 Security squads on most bodies | Enemy Fortification {4,0} (bigger hulls) |
| VII  | Everything "starts to try to kill us" (user) | Fortifications common |

## 6. The Subspace Telescope (user-named facility)

User (3c): "Upgrading it increases range, and sensor effectiveness, so as you upgrade it, the scans become refined
enough to be able to determine details like \"yeah, you need more strike teams than science teams for this one\"
where you even potentially get a recommendation on the expedition card on what to launch with. So you don't run the
risk of mis-speccing to get there and suddenly wind up with a poorly made team."

### 6.1 Facility definition

- `FACILITIES.subspaceTelescope` **[PROPOSAL key]**, label "Subspace Telescope" (user), on the existing facility
  framework (a finite `upgrades[]` track; each rung a timed `facilityUpgrade` process; no new mechanism).
- New effect member **[PROPOSAL]** `{ telescope: { reachTier: number; detail: number } }`: ABSOLUTE values per rung,
  read from the highest reached rung (`telescopeReading(state)` in a new `telescope.ts`). Property-presence
  narrowing like every other effect, so existing consumers ignore it.
- Rungs cost CREDITS + an FA-level gate, no materials, no talent gates (the Shipyard / Salvage Bay console rule: a
  gate the card cannot show is a trap).
- Lives in the Facilities bucket as a dashboard card (section 7.4).

### 6.2 Levels [ALL NUMBERS PROPOSAL]

Range is shown in light-years, measured from the player's own homeworld (user: each player's homeworld sits somewhere
different). Each rung is defined by the REGION it reaches, and the light-years shown are that region's far edge as
measured on that player's map, so every player's Level 3 reaches the same region **[PROPOSAL]**. The light-years
below are for a homeworld near the Sun's position (the tiers mockup's bands).

| Level | Credits | Time (ticks) | FA gate | Range (ly) | Reaches | Detail |
|-------|---------|--------------|---------|------------|---------|--------|
| 1 (founding, pre-granted) | 0 | 0 | none | 150 | I Local Bubble | 2 Graded |
| 2 | 4,000 | 120 | 3 | 3,000 | II Orion Arm | 2 Graded |
| 3 | 10,000 | 240 | 5 | 3,000 | II | 3 Per body |
| 4 | 25,000 | 420 | 8 | 7,600 | III Perseus + IV Sagittarius | 3 Per body |
| 5 | 60,000 | 720 | 11 | 7,600 | III + IV | 4 Recommendation |
| 6 | 150,000 | 1,200 | 14 | 13,000 | V Scutum-Centaurus | 4 Recommendation |
| 7 | 375,000 | 1,800 | 17 | 25,000 | VI Galactic Bulge | 5 Forecast |
| 8 | 900,000 | 2,700 | 20 | 26,500 | VII Galactic Core | 5 Forecast |

- **Pre-granted at Level 1** (freshState and the v68 migration), like the Research Lab and Mission Control: T-I is
  read from day one with graded factors, so the practice zone is never a blind launch (the user's philosophy).
- One Level 4 rung reaches both Tier III (Perseus, ~6,400 ly outward) and Tier IV (Sagittarius, ~5,000 ly inward),
  which sidesteps the "Sagittarius is closer than Perseus" ordering note from the tiers mockup.
- Credits step x2.5, the Shipyard's own credit step; FA gates step +3, the Shipyard / Salvage Bay stride.

### 6.3 Detail levels [PROPOSAL names]

| Detail | Name | What the expedition card shows |
|--------|------|--------------------------------|
| 0 | Blind | Name, region, distance. "Beyond telescope range" |
| 1 | Contact | Which factors are PRESENT (Combat, Fauna, Flora, Hazard: yes / no), system level |
| 2 | Graded | Each factor's grade and flavor line, system level |
| 3 | Per body | Grades per body, plus the task demand: "Security work on 3 of 5 bodies; 2 tasks need 2 Science squads" |
| 4 | Recommendation | The squad recommendation (section 6.5) with a one-click "Set composition" |
| 5 | Forecast | The threat tier of your crew the plan would send on the system's hardest task (GO-6 sampling, display only) |

The founding level already reads at detail 2, so detail 1 (Contact) is used only by the falloff option (OPEN CALL 8):
a system in the outermost reached region would read one level lower.

### 6.4 How it combines with the ship's own sensors

Split by job **[PROPOSAL]**: **the telescope reads how DANGEROUS a system is; the ship's sensors read WHAT is there.**
- **Range is the telescope's alone.** Beyond it the system is BLIND (user): risk factors unknown, no
  recommendation, AND no ship-sensor content layers either (a ship parked at the homeworld cannot see thousands of
  light-years) **[PROPOSAL; OPEN CALL 7]**. Today every candidate is effectively Tier I (G2 not built), so Level 1's
  150 ly covers them all and today's previews do not regress.
- **Inside range** the ship's existing layers stay exactly as built (sensors 8 / 20 / 40 / 65: body count, planet
  types, hazard, relic signature).
- **The ship lifts the reading:** the launching ship's crew-inclusive `sensors` power at or above 40
  (`SENSOR_REVEAL_HAZARD`) adds +1 detail, never past 5 and never past range **[PROPOSAL]**. So a Sensor Suite with a
  strong Science crew turns a Level 3 "Per body" read into a recommendation for that ship (G6's sensor roles).
- Hazard can be revealed by either source; whichever is higher wins.

### 6.5 The recommendation logic [PROPOSAL]

Runs on the SAME preview the card already builds (generate the system, assign discoveries and tasks from the
committed seed), so it reads the real tasks with their `needs` and difficulty weights:

1. List the hull's valid compositions (section 2.4).
2. For each: **coverage** = difficulty-weighted share of the system's tasks some crew of that composition can cover;
   **solo share** = weighted share a SINGLE team of it can cover (more solo tasks run in parallel, so the run is
   faster).
3. Pick the highest coverage; then the highest solo share; then the best BALANCE (the composition's Security share of
   its 4 squads closest to the system's difficulty-weighted Security demand, i.e. the share of required squads that
   are Security: "you need more strike teams than science teams for this one", user); then the one closest to the
   ship's CURRENT composition (fewest squads changed, so the player is never asked to re-slot for nothing); then
   Ground + Ground. Worked examples in the mockup: a calm Tier I system recommends Survey + Ground, a mixed Tier II
   system keeps Ground + Ground, a Tier IV system in enemy territory recommends Strike + Ground.
4. Say it in one line plus one reason:
   - Current already best: "Your Ground + Ground suits this system."
   - Otherwise: "Launch with Strike + Ground" / "Enemy territory on 3 of 5 bodies; 4 tasks need 2 Security squads."
   - When nothing on the hull covers everything: "Nothing on this hull covers 2 tasks (Enemy Fortification needs 4
     Security squads). They will be skipped."
5. **"Set composition"** applies it in one click when the ship is docked (section 2.6 rules and confirm apply); it
   changes the team whose change moves the fewest members (ties: the later team, so Alpha stays put).

### 6.6 Blind launches

Allowed (user). The card shows a "Blind launch" chip and the range gap ("Level 2 reads 3,000 ly; this system is 6,420
ly"); no confirm dialog (QoL rule: inform, do not add friction) **[PROPOSAL]**. On arrival the ship's own scan reveals
the risk profile body by body as today's scan reveals discoveries, so the queue screen still shows each task's needs;
the price of a blind launch is that the composition cannot change mid-run (crew lock), which is exactly the "planning
ahead" the user asked for.

## 7. UI

### 7.1 Away Team tab: the composition picker (AwayTeamPanel)

- A **Composition** block above the team cards: four squad pips in two pairs, colored Security / Science, the summary
  "2 Security squads, 2 Science squads", and the rule line "At least one Security and one Science squad" with a check
  or the reason it fails.
- Per team: a segmented radio group **Ground / Strike / Survey** (arrow keys move, Space picks). An option that would
  break the rule is disabled with the reason inline ("Bravo is Strike: Alpha must keep a Science squad").
- A change that moves members asks inline: "Sho and Vela move to the reserve. Change Bravo to Strike?" Confirm /
  Cancel. Then the squads re-render with the auto-filled reserve members.
- The migrated pair shows **"Pick a type"** (amber) until confirmed; "Keep Ground" is one click.
- Hire caps per type follow the composition and read "Security 6 / 6, Science 2 / 6" on the recruitment board.
- Locked while the ship is out (existing crew lock text).

### 7.2 Expedition card: the telescope block (ExpeditionPanel dispatch console)

Under the existing foreknowledge rows: a "Subspace Telescope" header with the detail chip (Graded, Per body, ...),
then the four factor rows (a 5-step meter + flavor line), the per-body strip at detail 3, the recommendation box at
detail 4 (with "Set composition" and "Your ship: Ground + Ground"), and the forecast line at detail 5. A blind
candidate shows only name, region, distance and the "Blind launch" chip.

### 7.3 Task card (queue screen, GO-13; team timelines, GO-14)

- Header: task name, body, difficulty pips + grade + "counts x3 toward completion".
- Requirement chips in squads with the team-type phrasing (section 3.2), each chip marked met / unmet by your
  deployed teams ("Bravo (Strike) + Alpha (Ground)").
- The fight-point bar (GO-M2 / GO-M4), now possibly with zero pips ("No fights expected").
- The threat tier of the crew the plan would send (section 3.6).

### 7.4 Facilities: the Subspace Telescope card

Level, range in ly, detail name, the next rung's credits / time / FA gate with the Upgrade button (existing facility
card pattern), and a galaxy map with the homeworld, the seven regions badged I to VII, the current range ring and the
next rung's ring dashed.

### 7.5 Help topics

New entries **[PROPOSAL]**: "Team types and squads", "Risk factors", "Subspace Telescope", "Task difficulty".

## 8. Determinism, save and tests

- New stored fields are all optional on runs (`needs`, `difficulty`, `Expedition.risk`); the only save bump is v68
  (ship teams + telescope seed). Legacy runs resolve on their old path; GO-7b's legacy goldens stay green.
- Risk profile, task needs and difficulty are pure functions of the seed and tier; the preview and the run share them.
- Tests **[PROPOSAL]**: composition validity (all 9 ordered pairs on a 4-squad hull), the change action (reserve,
  auto-fill, over-cap, refusals with same-reference return), the v67 -> v68 migration (byte-identical except the new
  fields; an in-flight run unchanged), crew selection (smallest covering set), helper coverage, risk generation
  distribution per tier (seeded histogram within tolerance), preview == run for risk and needs, recommendation picks
  on hand-built task lists, detail gating per telescope level with and without the ship's +1, parity (big == chunked)
  on a Strike + Survey run with a joint {2,1} task.

## 9. What this changes in the Ground Operations plan

- GO-2 per-team D18 check -> per-squad "at least 1 slotted" (section 2.4); the hire cap follows composition (2.5).
- GO-7c `requiredTeams` / `requiredTeamsOf` / `skippedNeedsTeams` -> `needs` / `taskNeedsOf` / `skippedNeedsSquads`;
  joint crews chosen by squad coverage; the joint offload happens once (3.5).
- GO-7d validates `notEnoughSquads`.
- GO-11 (slotting UI) gains the composition picker; build it ONCE on the new shape (so the squad redesign lands
  before GO-11) **[PROPOSAL order]**.
- GO-13 / GO-14 task cards gain needs + difficulty; GO-17 loadouts gain `kind`; GO-18 Help gains section 7.5.
- G2 (expedition tiers) supplies regions, distances, homeworld placement and enemy territory zones; G7 (completion %)
  uses the difficulty weights.

## 10. Build slices [PROPOSAL]

- **SQ-1** Composition data + `groundComposition.ts` + SAVE v68 (ship teams + telescope Level 1).
- **SQ-2** `setGroundTeamKind`, the composition-following hire cap, per-squad deploy check.
- **SQ-3** `needs` + crew planning + helpers + the single joint offload (engine; parity tests).
- **SQ-4** `riskFactors.ts`, risk-aware fight points, flora effects, difficulty rating, completion weights.
- **SQ-5** `FACILITIES.subspaceTelescope`, `telescope.ts` reading, detail gating, the ship's +1.
- **SQ-6** Recommendation + forecast on the preview.
- **SQ-7** UI: composition picker (with GO-11), telescope block, task cards, Facilities card, Help.
- Hostile sites (Enemy Colony, Enemy Fortification) ride the content pass after approval.

## 11. OPEN CALLS for the user

1. **Data shape:** keep GO-1's flat slot lists plus a team `kind` (smallest change, section 2.3), or store explicit
   squads per team?
2. **The migrated second pair:** it reads as Ground and deploys if you slot people into it before picking (with a
   "Pick a type" prompt), or it stays undeployable until you pick?
3. **"2 Strike teams" on a 4-squad hull:** with one of each type required, a 4-squad ship tops out at 3 Security
   squads. Should Enemy Fortification ({4,0}) wait for bigger hulls, become {3,1} so Strike + Ground can clear it, or
   should two ships be able to work one system later?
4. **Changing type with too many members aboard:** allow it and park the extras in the reserve over the cap (proposed),
   or refuse until you bench them?
5. **Task needs rules (section 3.2):** Security 0 / 1 / 2 by fight points; Science 2 for Ancient Ruins, Buried Vault
   and Subterranean Civilization from Tier II; does that feel right, and should a Survey team (no Security) ever face
   a fight?
6. **Difficulty (section 4):** the five grades Simple, Standard, Challenging, Dangerous, Deadly with completion weights
   1 / 2 / 3 / 5 / 8. Should difficulty also raise the haul or relic odds, or only weight completion?
7. **Blind means blind:** beyond telescope range, hide the ship-sensor content layers too (proposed), or keep showing
   the ship's own body count / planet types everywhere?
8. **Telescope falloff:** flat detail across the whole range (proposed), or one detail level lower in the outermost
   region it reaches ("nearer regions first" applied to detail as well as range)?
9. **Telescope ladder (section 6.2):** 8 levels, credits x2.5 per step from 4,000 to 900,000, FA gates 3 to 20,
   pre-granted Level 1 covering Tier I at Graded detail. Right pace, and should the recommendation come sooner than
   Level 5?
10. **The ship's lift:** sensors 40+ add one detail level for that ship. Keep, scale with more thresholds, or drop?
11. **Risk factor names and scale:** Combat risk, Fauna, Flora, Hazard on None / Low / Moderate / High / Extreme with the
    flavor lines in section 5.1, and the tier tables in 5.2?
12. **Hostile site names:** "Enemy Colony" and "Enemy Fortification" are taken from your words; keep them as the
    task names, or rename?
13. **Joint offload once (section 3.5)**, and still open from GO-7c (d): one shared pickup leg for a joint wipe on one
    body, or one leg per wiped team (built)?
14. **Strike pace:** a crew with no Science squad works a clearing task at the bare pace (no fieldwork bonus); OK?

## USER ANSWERS (2026-10-12, verbatim where quoted; these override the proposals above)

- **Telescope lore:** "the lore behind the way the upgrades work is that we're funding a new development cycle to
  improve the telescope, in the hopes that we can find a jump gate that wasn't destroyed, etc etc." So each upgrade
  is a funded DEVELOPMENT CYCLE, motivated by the search for an intact jump gate.
- **Mockup:** sections 1 and 2 approved; on the expedition card "The difficulty rating should match up alignments
  between each of the lines. The bars look great though!" (align the grade labels in one column).
1. Data shape (flat slots + team kind): approved; "Testing will ensure that all is well!"
2. The migrated second pair defaults to Ground: approved.
3. Enemy Fortification: "the first one should be at a point that you can build a ship that includes a third squad. It
   would make sense, because without a science squad, you'd be unable to continue if you don't have someone capable of
   doing the job. You could softlock it if you're not careful. Then waste hours going back." So a squad-heavy task only
   appears once hulls can field it AND still keep Science aboard; task generation must never require a mix the
   deployed ship cannot field (no softlock).
4. Changing type with too many members: "I feel like you should have a set number of crew. otherwise, the teams option
   wouldn't make a whole lot of sense. Unless you feel like we should have a backup roster that allows for a bit of
   customization. I'm open to that option." (A fixed crew count per ship; a small backup roster is welcome: proposal
   pending.)
5. Survey teams and fights: "Survey teams shouldn't face any fights. But realistically, you could be ambushed by
   something you don't know. So we can always consider that option, but they're not going to be great, and they won't
   be able to spec themselves into some sort of high-powered support type team who can murder with specialty tech.
   Maybe. I don't know." (Survey tasks have no fight points; an ambush from unknown risk is possible but weak: proposal
   pending.)
6. Difficulty raises the haul and relic odds: YES, "The greater the risk, the greater the reward."
7. Blind launches: a WARNING that this is truly unknown territory, "Are you sure you wish to go"; idea: an achievement
   for going in blind. (Overrides "notice, no confirm".)
8. Telescope falloff: the user asked what it means (explanation sent).
9. Telescope costs: "we should ultimately revisit the credits. Unless we can find a proper sink for credits. Something
   that needs a bit of additional planning." (Costs are placeholders; credit sinks need their own planning.)
10. Ship sensors 40+ add one detail level: keep, balance later.
11. Risk factor names, the None to Extreme scale and the per-tier odds: approved.
12. "Enemy Colony" and "Enemy Fortification": approved for now.
13. Joint crew tasks: "that should end the same way the rest should. Once you finish. So everyone has to finish the
   portion of their task(s) before it completes, and only once." A joint task completes ONCE when the whole crew is
   done and pays ONCE. (The shared-pickup vs per-team pickup question is restated to the user.)
14. Clearing tasks without Science work at the base speed: approved. PLUS TASK CHAINS: "That task could lead to a new
   task that could need a science team to explore a cache of rare relics stored by the enemies you just took out.
   Speaking of: required completion to unlock new options that are behind some different tasks. Like clearing out some
   fortifications and then unlocking new things that are hidden behind that." So completing a task can REVEAL a
   follow-up task (e.g. a relic cache behind a cleared fortification).
- **Follow-up answers (user, 2026-10-12):** (4) YES to a small BACKUP ROSTER: a fixed crew per ship plus about 2
  reserve berths aboard, so changing a team's type never forces benching [count PROVISIONAL]; (5) YES: an ambushed
  Survey team RETREATS with light injuries instead of fighting (the task pauses, they come back later; Survey never
  becomes a combat team); (13) ONE SHARED pickup trip when several teams wipe together on one body. (8) Telescope
  falloff: explained; no answer yet, so build FLAT detail across the whole range [PROVISIONAL].

## Carry notes

**Carry from SQ-1 (built 2026-10-12, commit `feat(0.14.0): squad composition data + SAVE v68 (SQ-1)`):**
- **Hull data.** `ShipTypeDef.groundSquads: number` (REQUIRED), 4 on all 10 SHIP_TYPES hulls. `groundTeamCount(typeKey)`
  (model.ts) = `floor(groundSquads / 2)` = 2 everywhere; a test pins every hull at 4 and even. `awayTeams[].size` is the
  per-type squad size, unchanged. `awayTeams[].count` is still in the data and still read in two places: the hire cap
  (`awayTeam.ts squadSlots` = size x count = ONE squad per type, deliberately untouched: SQ-2 replaces it with the
  composition cap) and the FROZEN v67 shape (`groundTeams.ts v67GroundTeamCount`). The section 2.2 "count no longer
  read" pin belongs to SQ-2.
- **Persisted shape (model.ts).** `GroundTeamKind = "ground" | "strike" | "survey"`; `ShipGroundTeam.kind` (required)
  and `kindPending?: true`; flat squad-major slot lists sized by kind (`teamSlotCount`). `GroundTeamLoadout.kind?`
  (absent = Ground; `isWellFormedGroundTeamLoadout` accepts absent or a known kind). `emptyGroundTeams` = Ground +
  Ground, no pending flag (fresh ships, ships minted without the field).
- **`groundComposition.ts`** (imports model.ts only; graph model <- groundComposition <- groundTeamSlots <- awayTeam <-
  groundTeams): `GROUND_TEAM_KINDS`, `DEFAULT_GROUND_TEAM_KIND`, `isGroundTeamKind`, `squadsOfType` /
  `securitySquadsOf` / `scienceSquadsOf`, `teamKindName` ("Strike"), `teamKindLabel` ("Strike team"), `teamSlotCount`,
  `groundSquadsOf`, `compositionSquads`, `isValidComposition` (>= 1 Security AND >= 1 Science squad, every kind known,
  at least one team), `validCompositions(typeKey)` (multisets in kind order, Ground + Ground first: Ground + Ground,
  Strike + Ground, Survey + Ground, Strike + Survey), `compositionLabel` (Strike, then Survey, then Ground, whatever
  the team order), `shipTeamKinds(ship)` (the one kind reader: stored known kind, else Ground, sized to the team
  count) and `shipComposition(ship)`.
- **BACKUP ROSTER (user follow-up (4)) [PROVISIONAL count].** Data shape is DERIVED, not stored: the reserve stays what
  GO-2 calls it (members aboard with a ground squad type in no slot), and `GROUND_RESERVE_BERTHS = 2` (one constant)
  is how many of them a ship may carry past its slots, SHARED by both types. `shipReserveBerths(typeKey)` (2 when the
  hull fields teams, else 0), `shipCrewCapacity(typeKey, kinds)` = `{ security, science, reserveBerths, total }` (the
  fixed crew: 14 on a 3 / 3 freighter for every composition), `reserveBerthsUsed(aboard, capacity)` (members past each
  type's slots, summed; may exceed the berths, the caller decides). Nothing reads them yet: SQ-2 wires the hire cap
  and `setGroundTeamKind` on top. **Question for the user (SQ-2):** one type change drops a whole squad (3 or 4
  members) into the reserve, more than 2 berths, so "changing a team's type never forces benching" needs either more
  berths, a confirm that names who is benched, or allowing over-capacity until the player sorts it (design 2.6).
- **Normalization.** `groundTeamSlots.ts shipGroundTeams` sizes each team by its kind (a v67 kindless team reads as
  Ground) and keeps `kindPending` only when stored `true`. `isWellFormedShipGroundTeams` is the v68 shape guard (known
  kind, kind-sized lists, optional name, optional `kindPending: true`); shape only, it does not check the composition.
- **Frozen v67 helpers.** `isWellFormedV67ShipGroundTeams`, `backfillV67ShipGroundTeams` (GO-1's guard and fill under
  their v67 names; `backfillShipGroundTeams` is gone) and `V67ShipGroundTeam`, so `MIGRATIONS[66]` keeps writing the
  one-team v67 shape. It now also passes a v68-shaped value through (no real v66 save has one; a fixture built from a
  current `freshState` keeps its teams through the whole chain).
- **SAVE v68 (`MIGRATIONS[67]`).** Per ship: a v68 value is kept (idempotent); a v67 value keeps every team, stamped
  Ground (slots, name, help untouched); a malformed or absent one is backfilled by hire order exactly as v67 did (one
  team, overflow stays in the reserve), then `v68ShipGroundTeamsFromV67(ship, v67, true)` appends an EMPTY Ground pair
  with `kindPending: true`. No member moves, no `awayMembers` record changes, nobody lands in the new pair.
  `facilities.subspaceTelescope = { level: 1 }` is seeded (an existing value kept) and `freshState` seeds it too; there
  is NO `FACILITIES` entry until SQ-5 and nothing iterates `state.facilities`, so it is inert. Hardened like v67.
- **Behavior neutrality.** The second pair is always empty on a real save (the hire / reassign cap is still one squad
  per type, so auto-slot never reaches team 1), and an empty team never deploys, so dispatch, the GO-7a snapshot, the
  plan and every run are unchanged. Proof (save.test.ts v67 -> v68 block): a v67 save with an in-flight FLAGGED run
  loads via the step and via no step; with exactly the SQ-1 fields taken off (`asV67GroundState`) the two loads are
  byte-identical; the run resolves identically (one call == 997 s chunks), the claim lands identically, the NEXT
  dispatch is the same expedition (one deployed team), and an hour of `tick` serializes identically. Legacy goldens
  (groundOpsLegacy): checkpoints untouched; the whole-state claim hash now reads through `asV67GroundState` and
  matches the pre-switch capture unchanged. The officer goldens hash through `withoutGroundSquadState` (renamed from
  `withoutGroundTeams`; also drops the telescope), golden values unchanged. Every parity test unchanged.
- **One visible text fix.** The dispatch block listed every team's waits, so the empty Bravo would add "Bravo: Needs a
  Security member in a slot" noise. New pure `groundTeams.ts groundWaitTeams(check)`: the staffed teams, else the first
  team alone. ExpeditionPanel uses it, so the block reads as it did before SQ-1.
- **Fixtures.** `registerSyntheticHull(key, awayTeams, groundSquads?)` (default 2 x the Security `count`, so the GO-7c
  3-team hulls still field 3 teams and their v67 count matches); `withSlottedAwayTeams` = the v67 hire-order fill
  stamped Ground plus an empty Ground pair (no pending), i.e. the team the pre-switch rule picked; new
  `asV67GroundState(state)`.
- **For SQ-2:** `setGroundTeamKind` clears `kindPending`; the per-squad deploy check replaces the per-team D18 check
  (a Strike or Survey team cannot pass today's `needSecurity` / `needScience`); the composition-following hire cap
  replaces `squadSlots` in `squadGate` (only then can team 1 fill), and needs the backup roster answer above. A
  primitive-level note: `shipsWithMemberAutoSlotted` already reaches team 1 when team 0 is full (tested), so the cap
  is the only thing keeping the pair empty today.
- Tests: new `groundComposition.test.ts` (17); `groundTeams.test.ts` 68 -> 78 (v68 shapes, kind sizing, frozen v67
  guard, the upgrade helper, `groundWaitTeams`, the empty pair); `save.test.ts` +10 (the v67 -> v68 block) with the
  v66 -> v67 block and facility lists updated for the chain. Suite 4248 -> 4285 passed (1 skipped); `npm run check` 0
  errors.
- **Backup roster size (user, 2026-10-12): ONE SQUAD'S WORTH.** Reserve berths = the larger of the hull's Security and
  Science squad sizes (3 or 4 today), so a single type change always fits aboard and nobody is forced off the ship.
  Supersedes GROUND_RESERVE_BERTHS = 2 (SQ-2 changes it).

**Carry from SQ-2 (built 2026-10-12, commits `fix(0.14.0): freeze the v67 / v68 migration helpers + Bravo proof (SQ-1
review)` and `feat(0.14.0): team kinds, composition hire cap, per-squad deploy check (SQ-2)`):**
- **SQ-1 review fixes.** (1) FROZEN migrations: `MIGRATIONS[66]` / `[67]` read only `groundTeams.ts`
  `FROZEN_GROUND_SQUAD_SIZES` (the per-hull squad sizes when v67 / v68 shipped), `V67_GROUND_TEAM_COUNT` 1 and
  `V68_GROUND_TEAM_COUNT` 2; `v67GroundTeamCount`, `isWellFormedV67ShipGroundTeams`, `backfillV67ShipGroundTeams`,
  `v68ShipGroundTeamsFromV67` are frozen and the new `isWellFormedV68ShipGroundTeams` is both steps' pass-through /
  idempotency guard (the live `isWellFormedShipGroundTeams` is no longer used by save.ts). A hull unknown at v67 / v68
  gets no teams from the steps (the live normalizer builds them on first read). Proof: save.test.ts "the v66 -> v67 and
  v67 -> v68 steps are FROZEN" retunes the live General Freighter and Destroyer (groundSquads 6, sizes 5 / 2, count 4)
  and the raw v66 / v67 / malformed v67 saves migrate to the same teams. The fixture `withSlottedAwayTeams(state,
  fillTeams = 1)` now fills over the LIVE empty teams (it serves synthetic hulls the frozen fill does not know); the
  GO-7c tests pass their team count. (2) ONE AUTHORITY for team and squad counts: `groundSquads` (team count) + the
  ship's team kinds; `awayTeams[].count` is read by nothing (model.ts documents it; kept in the data for Prospecting's
  "wired only" marker, design 2.2; awayTeam.test.ts "ONE authority" retunes count and nothing moves). The only
  remaining count reader is the test fixture `registerSyntheticHull`'s default `groundSquads` (test code).
  `awayTeam.ts squadSlots` is GONE; `deployableMembers` (the legacy pre-GO-7b reference behind `snapshotAwayRoster`,
  read only by tests) caps at ONE squad (`groundSquadSize`), exactly what count 1 gave. (3) The v67 -> v68 parity test
  asserts Bravo is still the empty `kindPending` Ground pair after the migration, the claim and the hour of ticks.
- **`setGroundTeamKind(state, shipId, teamIndex, kind)`** (groundTeams.ts) with `canSetGroundTeamKind` and
  `previewGroundTeamKind` (`{ ok, toReserve, fromReserve }`: who moves, for the SQ-7 confirm "Sho and Vela move to the
  reserve"). Gate order: noShip, onMission (crew lock), noSuchTeam, noSuchKind, sameKind, needsBothTypes; every refusal
  returns the SAME state. Kept members stay IN PLACE (squad 1 stays squad 1); members of a dropped squad go to the
  RESERVE (aboard, unslotted, slot order); the slots the new kind ADDS auto-fill from the reserve of their type, first
  by hire order (gaps the player left in a kept squad stay). Clears `kindPending`; picking the type a pending team
  already has is the "Keep Ground" confirm (a real change), a second pick is `sameKind`. No `awayMembers` record ever
  changes (nobody leaves the ship). New reasons + text: `noSuchKind` "No such team type", `sameKind` "Already this team
  type", `needsBothTypes` "A ship needs at least one Security squad and one Science squad".
- **Hire cap = the composition + the backup roster.** `groundComposition.ts shipReserveBerths(typeKey)` = ONE SQUAD'S
  WORTH = max(Security size, Science size) (3 on the 3 / 3 hulls, 4 on Destroyer / Battleship / Carrier / Orion /
  Aurora / Eir), 0 without teams; `GROUND_RESERVE_BERTHS` is gone. `awayTeam.ts squadGate`: type T fits when aboard(T)
  < T's composition slots (`shipSquadSlots(ship, T)`) OR one more reserve member still fits the SHARED berths
  (`reserveBerthsUsed` after the arrival <= berths). Reserves count, benched members do not. Example, General Freighter
  (3 / 3, 3 berths): Ground + Ground 6 Security + 6 Science slots + 3 berths = 15 crew; Strike + Ground 9 + 3 + 3 = 15
  (so 12 Security if no Science sits in the reserve, or 9 Security and 6 Science); Survey + Ground 3 + 9 + 3. Destroyer
  (4 / 3, 4 berths): Ground + Ground 8 + 6 + 4 = 18; Strike + Ground 12 + 3 + 4 = 19. New readers `shipSquadSlots`,
  `shipCrewRoom(state, ship)` (`{ capacity, aboard, berthsUsed }`, for the SQ-7 "Security 6 / 6" line); `squadHasRoom`
  kept (now the cap). Reasons: `squadFull` text changed to "No open slot or reserve berth"; NEW `overCapacity`
  "Reserve is over capacity" (all slots of T taken and the ship already past its berths). Hire / reassign / bench
  auto-slot and unslot as before (lowest team first, so Bravo fills once Alpha is full).
- **Over capacity is allowed, never forced.** A change from a ship with an empty reserve that moves ONE squad (Ground
  <-> Strike, Ground <-> Survey) always fits the berths (property test over every hull and composition). It can go
  over when the reserve was already in use, or on a direct **Strike <-> Survey** change, which drops BOTH squads of
  the team (6 to 8 members) into the reserve. Built per design 2.6: allowed, nobody leaves, hiring that type reads
  `overCapacity` until members move or the composition changes back. **Question for the user:** keep that, have the
  picker route Strike <-> Survey through Ground, or confirm-and-bench the overflow?
- **Per-squad deploy check** (`deployableGroundTeams`). A team deploys only when EACH of its squads has at least
  `MIN_SQUAD_MEMBERS` (1) slotted and every slotted member is ready (no stand-ins). Readiness gains `kind` and
  `squads: { index, teamType, members }[]` (Security squads first, then Science: the flat lists' order); `security` /
  `science` stay the flattened lists. Waits: `injured` (unchanged) and NEW `emptySquad { squadIndex, teamType,
  typeSquadIndex, typeSquads }` replacing `needSecurity` / `needScience` ("Needs a Science member in a slot" for a
  team's only squad of a type, so Ground text is unchanged; "Security squad 2 needs a member in a slot" for a Strike
  team). Ship level: D18 (`MIN_SECURITY_MEMBERS` / `MIN_SCIENCE_MEMBERS`) across the deploying teams, unchanged sum;
  reasons `noTeamReady` and NEW `missingType` (+ `missingType: "security" | "science"`) when something deploys but
  lacks a type. `readyAtSeconds` is now the first time the waitable teams cover D18 BETWEEN them (a Strike team back
  in 1m does not make the ship ready; the Survey team in 15m does); identical to before on Ground-only ships. Texts:
  "No ground team is ready: slot at least 1 member into each squad of a team" (was "... 1 Security and 1 Science member
  into one team"), "Nothing ready covers Science: ready in 10m", "Nothing ready covers Science: a team with a Science
  squad must deploy too".
- **Engine between SQ-2 and SQ-3 (heads up, not reachable by players):** the engine can now be handed a Strike or
  Survey team, but nothing in the game sets a kind yet (no UI until GO-11 / SQ-7, no dev hook). If one were deployed
  today, GO-7c planning would still give a Survey team fight tasks (its fights resolve as losses with no Security) and
  a Strike team fieldwork at the bare pace; SQ-3's `needs` planning is what makes that correct. Do not expose the
  picker on staging before SQ-3.
- **For GO-11 (slotting UI):** the player's slot / swap actions into a second team must respect the composition:
  `slotMember` / `swapGroundMembers` / `canSlotMember` already read each team's KIND-sized slot lists (a Strike team has
  no Science slot, so `noSuchSlot` / `wrongTeamType`), so they are engine-correct after SQ-2; GO-11 lands AFTER SQ-2
  and builds the composition picker on `setGroundTeamKind` / `previewGroundTeamKind`, with `shipCrewRoom` for the caps.
  AwayTeamPanel's squad header now reads `shipSquadSlots` (so "0 of 6" on a fresh Ground + Ground freighter; members in
  the berths can read "8 of 6" until GO-11 / SQ-7 redraws it per team).
- Tests: groundTeams.test.ts 78 -> 92 (setGroundTeamKind: Ground -> Strike, Ground -> Survey, Strike -> Ground,
  refusals, pending, over capacity, minted-without-teams, auto-slot after a change; per-squad deploy: Strike + Survey,
  empty squad 2, missingType both ways, D18-covering readyAt, an injured member holds a Strike team; frozen helpers);
  awayTeam.test.ts 49 -> 51 (squadSlots tests replaced by shipSquadSlots / sizes / ONE authority; the caps at 10
  Science on a Destroyer, shared berths, Strike + Ground caps, overCapacity); groundComposition.test.ts 17 -> 18
  (berths = one squad's worth, capacity totals, the one-squad-change property); save.test.ts 205 -> 206 (the frozen
  migrations, plus the Bravo assertions); expedition.test.ts wait kinds. Suite 4285 -> 4303 passed (1 skipped);
  `npm run check` 0 errors. Legacy goldens, parity and every engine test unchanged.
- **Direct Strike <-> Survey switch (user, 2026-10-13):** "You have reserve squad members that don't belong to a given
  squad, so it shouldn't really matter too much." So KEEP AS BUILT: the switch is allowed; the reserve is a general pool
  not tied to a squad; a temporary over-capacity reserve is fine (hiring that type pauses until members move; dispatch
  unaffected). The SQ-7 picker shows it plainly, no confirm, no forced benching.

**Carry from SQ-3 (built 2026-10-13, commit `feat(0.14.0): squad needs, crew planning, shared pickup, Survey retreat
(SQ-3)`):**
- **Needs (model.ts `ExpeditionActivity.needs?: GroundTaskNeeds` = `{ security, science }` squads).** `groundOps.ts
  taskNeedsOf(task)`: stored needs when both are whole numbers >= 0; else the carry-forward of `requiredTeams` N (whole
  >= 1) as `{ N, N }`; else `{ 1, 1 }`. `requiredTeamsOf` is GONE (taskNeedsOf replaces it). `initGroundTasks` now
  stamps `needs` and DELETES any content `requiredTeams` (read into needs, never stored twice), with the needs floored
  to at least 1 Security squad whenever the task holds a fight point (a Security-less crew can never be sent at a
  fight). Today's content sets neither field and FIGHT_POINTS_MIN is 1, so every new task reads `{ 1, 1 }` until SQ-4's
  generated needs. Tasks stamped before SQ-3 keep `requiredTeams: 1` and read `{ 1, 1 }`.
- **Team squads.** `GroundTeamRun.kind?` written at dispatch (absent = Ground: every run dispatched before SQ-3, when
  no kind could be set). `teamSquadsOf(team)` (Ground 1 / 1, Strike 2 / 0, Survey 0 / 2, unknown = Ground),
  `crewSquadsOf(teams)`, `squadsCover(squads, needs)`.
- **Crew layer per SQUAD.** `factors.securityShare[i]` / `scienceShare[i]` = team i's squads of that type / every
  deployed squad of that type (GO-7a split by member count). Strike + Survey = `[1, 0]` / `[0, 1]`; Strike + Ground
  `[2/3, 1/3]` / `[0, 1]`; Ground + Ground `[0.5, 0.5]` whatever the member counts. One team stays `[1]`.
- **Crew planning (`planTasksForTeams`).** A task's CREW is the smallest set of deployed teams whose squads cover its
  needs and is written as `assignedTeamIds`; a task is JOINT exactly when that crew has 2+ teams (`isJointTask`; GO-7c
  read `requiredTeams > 1`; a pre-SQ-3 joint task was assigned its N teams the same way, so in-flight runs read the
  same). SOLO tasks (some single team covers): teams ranked by mean fresh wins over the solo tasks THEY cover (GO-7c
  review (a): joint tasks never rank a team; a team covering none ranks last); tasks hardest first by the strongest
  COVERING team; the GO-7c chunks of ceil(n / teams) where "teams" = the teams covering at least one solo task, each
  task to the first covering team in rank order with room, else the covering team holding the fewest (ties rank). With
  every team covering every task this is exactly GO-7c's split (the GO-7c plan test is unchanged). JOINT tasks
  (`jointCrewFor`): among the SMALLEST covering sets, the most fresh clear wins as a whole, ties to the set whose teams
  rank best **[PROVISIONAL]** (design 3.3 "the smallest pair, strongest first by threat"). Examples: Strike + Survey
  sends the PAIR to every `{ 1, 1 }` task, Strike alone to a clearing task, Survey alone to a survey-only task; Strike +
  Ground sends Ground ALONE to `{ 1, 1 }` (so on today's content the Strike team idles: the composition trade-off),
  Strike alone to `{ 2, 0 }`, both to `{ 3, 1 }` / `{ 2, 1 }`.
- **No softlock (user).** `planNewTasks` skips a task whose needs exceed every deployed squad summed (the only case no
  crew covers) and logs `skippedNeedsSquads` (`{ at, kind, taskId, needs, deployed }`); `planTasksForTeams` also skips
  (silently) anything uncoverable it is handed, so GO-7d's re-plan can never queue one. Text: "Skipped Crashed Ship:
  needs 3 Security squads, 2 deployed" and, both short, "...: needs 3 Security squads, 2 deployed; 3 Science squads, 2
  deployed". The GO-7c `skippedNeedsTeams` kind stays in the union and keeps its text (a run planned before SQ-3).
- **Assignment.** `stageOn` deploys the lead once every crew team is staging AND the crew's squads cover the needs
  (was `crew.length < requiredTeams`). Helpers: `borrowableTask` takes only a task planned for a crew of one that the
  helper's OWN squads cover (`teamCovers`) and that rates at least HELPER_MIN_TIER (unchanged). Same-instant batch rule,
  own-work-first, joining first, helper never touching the owner's streak, back of the line: all unchanged.
- **Fights / fieldwork.** Unchanged machinery: one side = every Security member of the crew, union fieldwork; a crew
  with no Science works at the bare pace (fieldworkSpeedMult of an empty party = 1).
- **ONE completion, ONE offload (user #13 + design 3.5).** A joint task completes once (the lead's work reaching 100%)
  and pays once. At a joint return every partner is marked `GroundTeamRun.jointPartner` (cleared at idle) and goes from
  its return STRAIGHT to its own bay (no phantom offload); the LEAD runs the one offload (whenever it gets aboard: a
  lead on a recovery leg offloads on arrival). Totals unchanged.
- **Wipes + ONE SHARED PICKUP (user).** `wipedTeams(crew)`: a team is wiped when it has at least one Security member and
  all are down (the SQ-2 review Minor 1 guard: a team with no Security member is never a wipe on its own); when the
  WHOLE crew's Security (at least one member) is down, every crew team is wiped, so a Survey partner waits with its
  Strike team. All wiped teams of one crew share ONE leg (`scheduleRecoveryLeg`): `GroundShipLeg.teamIndices?` lists
  them when 2+ (absent for one, so a one-team leg keeps GO-7b's exact shape), `teamIndex` = the first. Every wiped
  team's return ends at that leg's `arrivesAt` (history `recovered: true`; `groundLegTeams(leg)` reads either shape).
  Separate crews still queue for separate legs (the GO-7c "two teams wiped close together" test is unchanged). **Note
  (interpretation):** a partner with no Security member waits for the pickup with a wiped crew (300 s) instead of
  shuttling up alone (60 s); that is what makes the shared pickup reachable on a Strike + Survey ship.
- **THE SURVEY AMBUSH (user #5).** Only a crew with NO Security squad on a task with `ambushChance > 0` (stamped by the
  hook `groundTaskAmbushChance(task)`, which returns `SURVEY_AMBUSH_CHANCE` for a task with no fight points and 0
  otherwise) can be ambushed. Rolled at the work step's START on `makeRng(groundAmbushSeed(exp, flatIndex, ambushes))`
  (new odd salt `GROUND_AMBUSH_SALT` 0x2b6f9d35, groundOps.ts registered in salts.test.ts): `next() < chance`, then the
  second it strikes `1 + nextInt(secs - 1)` (a step under 2 s is never cut). The step ends there with `workTo` at the
  ambush progress and `GroundTeamRun.ambushed`; at its end (`ambushRetreat`) the progress is kept, nothing is banked,
  `task.ambushes += 1`, the task goes back to `queued`, every crew member gains SURVEY_AMBUSH_CONDITIONS, and the crew
  takes an ordinary RETURN_SECONDS return (history `ambushed: true` on the cut work step), then bay, reload, retry. No
  fight, no leg, no loss streak (progress was made); a helper lists it in skippedBorrowed. A crew WITH a Security squad
  is never ambushed in SQ-3 (SQ-4 may decide whether such a crew fights one).
- **[PROVISIONAL] constants (groundOps.ts, one line each):** `SURVEY_AMBUSH_CHANCE = 0` (the unknown-risk gate; SQ-4's
  risk factors replace the hook's body); `SURVEY_AMBUSH_CONDITIONS = ["health"]` (the existing minor-injury condition,
  60 s before care; no new condition was invented); `SURVEY_AMBUSH_MAX_PER_TASK = 2` (a hard cap so a survey task can
  never be ambushed forever: no softlock); the joint-crew tie rule above.
- **For SQ-4:** set `needs` from fight points and site (design 3.2), drop the fight-point floor to 0 on risk-aware runs
  (only then can a Security-less crew take a task alone), and read the body's risk in `groundTaskAmbushChance`.
  **For GO-7d:** validate `notEnoughSquads` with `squadsCover(crewSquadsOf(target teams), taskNeedsOf(task))`; an
  "assign" of a joint task must write its whole crew into `assignedTeamIds` (that list IS the joint flag now).
  **For SQ-7 / GO-13:** the crew the plan sends is `assignedTeamIds`; "Needs a partner" =
  `!squadsCover(teamSquadsOf(team), taskNeedsOf(task))`.
- **In-flight runs.** A run dispatched before SQ-3 (Ground teams, requiredTeams 1, solo crews) resolves the same: the
  frozen shares are untouched, solo crews never get a partner flag or a shared leg, the plan for later bodies is the
  same split. Only the stored shape of tasks stamped after the update differs (`needs` in place of `requiredTeams`).
  Legacy goldens and every parity test unchanged.
- Tests: new `groundOpsSquads.test.ts` (18: needs reader, squads + coverage, stamping and the floor, the hook at 0,
  per-squad shares on three compositions, crews on Strike + Survey and Strike + Ground, the skip log both ways plus the
  GO-7c text, a joint crew's one side / union work / one offload / pay once, the 3-squad fight side, the helper rule,
  the empty-Security wipe guard, the shared pickup on Strike + Survey and on Ground + Ground, the ambush retreat and
  cap, no ambush without a chance or with Security, parity one call == 997 s == 1 s over 2 h on a Strike + Survey
  needs-split run with a shared pickup and a Survey retreat, and a real dispatched Strike + Survey run big == 997 s);
  groundOps.test.ts (snapshot `kind`, per-squad shares), groundOpsTeams.test.ts (needs carry-forward, the joint
  task's needs, the joint wipe is now ONE shared leg, the skip log is needs-based), groundOpsTimeline.test.ts
  (stamped needs, no requiredTeams), salts.test.ts (groundOps.ts + GROUND_AMBUSH_SALT). Suite 4303 -> 4321 passed (1
  skipped); `npm run check` 0 errors.
- **SQ-3 calls (user, 2026-10-13):** (a) a Security-less partner on a wiped joint crew WAITS for the ship's shared pickup
  (the crew comes up together); (b) Survey ambushes CAP AT 2 per task; (c) an ambush on a crew WITH a Security squad is
  a SURPRISE FIGHT at the current spot (win: work continues; lose: a normal wipe), built in SQ-4 with risk factors.
- **SQ-3 review, carried forward:** GO-7d must validate that an edited joint crew still covers the task's needs (else
  it stages forever) beside `notEnoughSquads`; move the "Skipped ..." log into `planTasksForTeams` so a GO-7d
  re-plan logs too; SQ-4 tests a Survey team clearing a 0-fight task end to end, ambush included.

**Carry from SQ-4 (built 2026-10-13, commit `feat(0.14.0): risk factors, difficulty, risk rewards, armed ambushes
(SQ-4)`):**
- **The flag.** `Expedition.risk?: ExpeditionRiskProfile` (`{ version: 1, tier, enemyTerritory, system: { combat, fauna,
  flora } }`) plus `ExpeditionBody.risk?: BodyRiskGrades` (`{ combat, fauna, flora, hazard, site? }`), grades 0 None to
  4 Extreme (model.ts `RiskGrade`, `RegionTier`, `HostileSiteId`). Written by `startExpedition` alongside `groundOps`,
  so every run dispatched from now on is risk-aware; a flagged run dispatched before SQ-4 has neither and stamps,
  plans and resolves exactly as before (groundOpsRisk.test.ts goldens captured BEFORE the change: three flagged
  dispatches, one team / Ground + Ground / Strike + Survey, with the profile stripped by the new fixture
  `withoutRisk`, match the pre-SQ-4 hashes at five checkpoints, the 2,000,000 s phase and the claim). Legacy
  (unflagged) goldens unchanged: `withoutGroundOps` now also strips the profile (a legacy run never had one). No
  SAVE bump (optional fields).
- **`riskFactors.ts`** (new, pure; imports model types, combat/rng, diminishing; imported by groundTasks, groundFight,
  groundThreat, groundOps, expedition). `RISK_SALT` 0x58f3a1c7 (registered in salts.test.ts). System stream
  `makeRng(seed ^ RISK_SALT)`: combat, fauna, flora drawn from `RISK_TIER_ODDS[tier]` (the approved table; fauna and
  flora share the life row, drawn independently), enemy territory +1 combat (capped). Body i's stream
  `seed ^ RISK_SALT ^ imul(i + 1, 0x9e3779b9)`: five draws always, in order (combat, fauna, flora jitter at 30% one
  step down; the fortification roll; the colony roll). Fauna / Flora None on barren, volcanic, gas giant; Flora None
  on frozen. Hazard banded (None below 0.15, Low below 0.3, Moderate below 0.5, High below 0.7, else Extreme: today's
  planet types read terrestrial / gas giant / barren None, arid Low, ocean / frozen Moderate, volcanic High, toxic
  Extreme). `expeditionRegion(seed)` = Tier I, no enemy territory **[PROVISIONAL: G2's map replaces this one
  function]**, so today's systems are all Tier I. `expedition.ts expeditionRiskPreview(seed)` is the pre-launch read
  (pure, ship-independent); startExpedition stores exactly it (tested on 36 candidates: preview == run).
- **Hostile sites** (expeditionContent.ts `HOSTILE_SITE_CATALOG`, outside POI_CATALOG so no discovery pool can draw
  one; `groundSiteLabel(id)` names either kind and ExpeditionPanel / the ops log use it). Rules (riskFactors.ts
  `HOSTILE_SITE_RULES`): Enemy Fortification Tier VI+, 10% on an Extreme combat body, 5 fight points, `{ 4, 0 }`;
  Enemy Colony Tier III+, 15% High / 30% Extreme, 4 fight points, `{ 2, 1 }`; fortification rolled first, at most one
  site per body **[PROPOSAL]**. The roll places `body.risk.site`; at the body's scan the site joins as the LAST
  discovery + task only when `hostileSiteFieldable(site, deployed squads)`: the deployment covers the needs AND keeps
  a Science squad (user #3). So no 4-squad ship ever meets a fortification, and a colony needs 2 deployed Security
  squads (Ground + Ground, Strike + Survey, Strike + Ground; not Survey + Ground, not a lone team). Neither appears
  today (Tier I). Guards (gambit.ts POI_ENCOUNTER_ROLES) **[PROPOSAL]**: colony striker, striker, bruiser, healer;
  fortification bruiser x2, striker x2, caster, healer. Hauls use the planet tables; neither is relic-bearing (the
  relic cache behind a cleared fortification is the TASK CHAIN hook).
- **Stamping a risk-aware body** (groundOps.ts `initGroundTasks`): fight points = groundTasks.ts `riskFightPointCount`
  = clamp(FIGHT_POINTS_BY_POI + combat mod [-2, -1, 0, +1, +2] + fauna mod at Cave Network / Xeno-Flora Bloom /
  Subterranean Civilization [-1, 0, +1, +1, +2] + 1 at hazard >= 0.6, 0, 5) (a hostile site: its own count). Needs =
  `generatedTaskNeeds` (Security 0 / 1 / 2 at 0 / 1-3 / 4-5 fights; Science 1, or 2 at Ancient Ruins, Buried Vault,
  Subterranean Civilization from Tier II; content needs still win), then **NO SOFTLOCK [PROVISIONAL]**: each type
  capped at the squads the ship DEPLOYED (`fieldableNeeds`), floor 1 Security with a fight point, so a risk-aware task
  is never skipped for squads (user #3: "task generation must never require a mix the deployed ship cannot field").
  The design's alternative (skip at planning, 3.3) is what a content `needs` still gets. **Question for the user:**
  keep the cap (a lone Ground team takes a 4-fight outpost with one Security squad), or skip such tasks (the
  composition trade-off the SQ-6 recommendation is built around; it can read the raw needs either way)? Difficulty is
  rated once from the GENERATED (uncapped) needs, so the grade is the site's, not the ship's.
- **Difficulty** (`taskDifficultyScore`, `difficultyGradeOf`): score = fights + hazard band (below 0.3: 0, below 0.6:
  1, else 2) + max(0, squads - 1) + floor(combat / 2); grades 1 Simple (0-1), 2 Standard (2-3), 3 Challenging (4-5),
  4 Dangerous (6-7), 5 Deadly (8+). Stored as `ExpeditionActivity.difficulty` (1..5). COMPLETION: `groundOpsProgress`
  (the activities bar) = sum(weight x progress) / sum(weight) with weights 1 / 2 / 3 / 5 / 8 **[PROPOSAL]**; an
  unrated task weighs 1, so a pre-SQ-4 run reads the plain mean bit for bit.
- **Risk reward (user #6)** `riskRewardBonus(d)` = D23 `diminishing(0.1 x (weight - 1), knee 0.5)` **[PROVISIONAL]**:
  Simple 0, Standard ~0.092, Challenging ~0.171, Dangerous ~0.306, Deadly ~0.475. At offload the haul scale
  (yieldMult) is x (1 + bonus) on the same draws (`taskFullHaul(..., riskBonus)`), and the bonus is added to the relic
  find bonus (on the same draw a Deadly task finds a relic wherever an unrated one does; tested over 40 seeds). The
  curve is unbounded and concave; the relic chance itself still caps at certain (rollRelicToken).
- **Ambush (user #5 + SQ-3 calls (b), (c))**: `groundTaskAmbushChance(task, body)` = for a calm task (0 fight points)
  on a risk body, `riskAmbushChance` = [0, 0.05, 0.10, 0.15, 0.20] by the worse of combat and fauna
  **[PROVISIONAL]**; no risk = SURVEY_AMBUSH_CHANCE (0). The roll no longer requires a Security-less crew; the cap
  (SURVEY_AMBUSH_MAX_PER_TASK 2) covers every ambush of a task. At the cut step's end: no standing Security member =
  the SQ-3 retreat; else **THE SURPRISE FIGHT** (`surpriseFight`): progress kept at the ambush point, ambushes + 1,
  the crew's Security fights on the task's ordinary keyed fight stream (fightCount moves on) with its carry;
  `GroundFightRecord.surprise` / `GroundStepRecord.surprise` mark it. Win: no fight point passes (pointsCleared,
  lossStreak untouched), the work resumes from the same spot. Loss: the ordinary loss path (queued, progress kept,
  loss streak, a wipe waits for the ship's leg).
- **Flora**: work time x (1 + 0.05 x flora) (`floraWorkMult`, exactly 1 without flora); fights: every guard's attack
  gains 50 permille Poison per flora grade (`groundFight.ts withFloraToxins`: added to a poisoner's own chance, a
  guard with no affliction gains Poison, Weakened casters untouched; no new draw) **[PROVISIONAL]**; groundThreat's
  memo key now includes the flora grade; High / Extreme flora multiply the Bloom's pool weight x2 / x3 on the SAME
  discovery draws (`floraWeightedPools`) **[PROVISIONAL]**.
- **SQ-3 review items folded in**: the "Skipped ..." log now lives in `planTasksForTeams(exp, refs, t)` (new `t`
  argument, so a GO-7d re-plan logs too; planNewTasks only collects the refs); a Survey team clears a 0-fight task end
  to end with an ambush (stamped from the body's risk, retreats, comes back, finishes, pays once).
- **TASK CHAINS (user #14): HOOK ONLY.** `riskFactors.ts taskChainFollowUp(poiId)` returns null and is not called; the
  call site is marked in groundOps.ts finishWork where a task reaches 100%.
- **Tests that moved:** groundOpsSquads "a crew WITH a Security squad never retreats" now asserts the surprise fight;
  two GO-7c / SQ-3 REAL-dispatch scenario tests pin the pre-SQ-4 run with `withoutRisk` (their scenarios are about the
  pre-SQ-4 needs). groundOpsParity's real run is now risk-aware and passes unchanged. New `riskFactors.test.ts` (19:
  names, bands, odds histograms per tier within 2.5 points, enemy territory, jitter and lifeless worlds, determinism,
  hostile rates and the fieldable gate, needs, cap, difficulty, weights, the reward curve, ambush, flora, the chain
  hook) and `groundOpsRisk.test.ts` (24: the pre-SQ-4 goldens, preview == run, stamping calm / dangerous / capped,
  the ambush chance, the colony both ways, flora work / poison / Blooms, completion weights, haul and relic, the
  surprise fight win and loss, the Survey end to end, parity one call == 997 s == 1 s over 2 h with a surprise fight
  and a Survey retreat, a real risk-aware run big == 997 s). Suite 4321 -> 4364 passed (1 skipped); `npm run check`
  0 errors.
- **Pacing (observed, 40 seeds, a plain rank-4 crew, Tier I):** risk-aware Tier I runs hold about 60% FEWER fight
  points (8.6 vs 21 per run: combat None / Low dominate Tier I and take 2 / 1 points off each task), so runs that
  finish do so sooner (typically 0 to 45% shorter; a few longer from ambush retreats and flora), and pay about 13%
  more credits, 9% more materials and 10% more relics (the risk bonus on Standard and Challenging tasks). The weak
  test crew stalls about two thirds of runs on BOTH paths (unchanged). Content tuned for today's run length should be
  rechecked against the shorter Tier I runs.
- **For SQ-5 / SQ-6:** `expeditionRiskPreview(candidate.seed)` is the telescope's raw reading; a recommendation that
  needs the uncapped needs can call `generatedTaskNeeds` on the same preview (the stamped `needs` are capped per
  ship). **For SQ-7 / GO-13:** `difficultyName(task.difficulty)`, `difficultyWeight` ("counts x3"), `riskFlavor`,
  `RISK_FACTOR_NAMES`, `RISK_GRADE_NAMES`, `groundSiteLabel`.
- **Needs cap (user, 2026-10-13): SAFE TIERS ADAPT, LATER SKIP.** Tiers I and II never ask for more than one squad of
  each type (the "practice somewhere safer" rule), so nothing is ever skipped early; from Tier III a task the deployed
  ship cannot field is left unfinished on the planet with a log line (no softlock: the run continues), which is what
  makes the telescope's launch recommendation matter. Replaces SQ-4's always-adapt `fieldableNeeds` cap.

**Carry from the SQ-4 follow-up (built 2026-10-13, commit `feat(0.14.0): safe tiers adapt, Tier III+ skips unfieldable
tasks (SQ-4 follow-up)`):**
- **SAFE TIERS ADAPT, LATER SKIP (user, above).** `fieldableNeeds` is GONE. riskFactors.ts `tierNeeds(raw, tier)`:
  at Tiers I and II (`SAFE_NEEDS_MAX_TIER` 2) each type is capped at `SAFE_NEEDS_SQUADS_PER_TYPE` (1), so a generated
  task there never asks for more than `{ 1, 1 }` (D18 guarantees one squad of each type deployed: nothing is skipped).
  This also means the big digs' 2 Science squads first ask at Tier III. From Tier III the generated needs stand as
  rolled and the existing planning skip applies: `planTasksForTeams` marks the task skipped with its "Skipped ..." log
  line (left unfinished; the window still closes). The stamped needs no longer depend on the ship. Content needs and
  hostile sites keep their own needs (a hostile site is placed only where the deployed squads field it). Difficulty
  is still rated from the generated needs. Tests force a Tier III region (expeditionRegion is Tier I today): one
  Ground team skips the 2-Security outpost and deep dig with the two log lines and finishes the rest; Ground +
  Ground plans the same tasks as joint crews; Tiers I and II give one team every task at `{ 1, 1 }`.
- **Review Minor 1.** groundThreat.ts `taskFightTotal` counts an UNSTAMPED task on a risk body with
  `riskFightPointCount` (the count the stamping will give it). The memo key adds the body's combat and fauna grades
  next to the flora grade (absent risk keys as "u").
- **Review Minor 4: label readers.** Every reader of a task, discovery or finding `poiId` label now names hostile
  sites: ExpeditionPanel `poiLabel` and groundOps.ts `groundOpsLogText` (both already in SQ-4), plus
  RelicStudyPanel `poiLabel` (now `groundSiteLabel`, defensive: hostile sites are not relic-bearing today, but a
  task-chain relic cache could be). Left on `getPoiById` on purpose, because they only ever take discovery PoI ids:
  awayTeamDisplay.ts (SCIENCE_SPEC_POIS), awayTraits.ts (poiYield trait PoIs), MuseumPanel (relic set sources).
- **[PROVISIONAL, user list]** A Deadly task worked by a crew with fewer squads than its generated needs (possible
  only at Tiers I and II, where the stamp is capped at one squad a type) still pays the Deadly risk bonus: the bonus
  reads the stored grade, which reflects the site, not the crew.
- **GO-18 Help line:** a surprise-fight LOSS is an ordinary loss. It feeds the task's loss streak, so three losses
  in a row without a new fight point send the task to the back of the line (and can raise the Stuck flag). The
  per-task ambush cap (2) bounds how often that can happen on one calm task.
- Tests: riskFactors.test.ts 19 (the cap test now pins `tierNeeds` per tier); groundOpsRisk.test.ts 24 -> 27 (the
  dangerous body moved to Tier III, safe tiers I and II, the Tier III skip with log text and a closing window, the
  Tier III joint plan, the unstamped threat read and memo key). Suite 4364 -> 4367 passed (1 skipped); `npm run
  check` 0 errors. Pre-SQ-4 goldens, legacy goldens and every parity test unchanged.
