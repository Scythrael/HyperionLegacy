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
