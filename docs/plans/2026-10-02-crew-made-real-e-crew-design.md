# 0.14.0 Phase E-CREW "Crew Made Real": Design

**Status:** APPROVED by the user 2026-10-02 ("this all works for me. Proceed!").
**Mockup (whole-build sign-off):** https://claude.ai/artifact/UYTkL2q9PyDHKGbeERcvuj (version 2).
**Branch:** `feat/crew-0.14.0`. Ships inside 0.14.0 (the one massive patch); no separate release.
**Source of every decision:** the exploration plan's "THE AWAY TEAM ROSTER" + "E-CREW DESIGN ANSWERS" sections
(`2026-09-24-exploration-0.14.0-plan.md`) and the inventory ([PLANNED_FEATURES_INVENTORY.md](../PLANNED_FEATURES_INVENTORY.md),
sections A1 to A3). Row IDs below point into the inventory tables.

## 1. Goal

Make the crew layer do what it shows. The away team becomes a persistent, named, outfitted roster per ship (the
plan all along). Every crew bonus a player can roll or see gets a live effect. The two blocked acquisition paths
(crew modules, early sensors) open. The small locked crew features land.

## 2. Decisions (all user, 2026-10-01 to 2026-10-02)

| # | Decision |
|---|---|
| D1 | Away team = a DEDICATED roster of persistent NAMED members per ship (not derived per battle). |
| D2 | Squads: SECURITY fights, SCIENCE does fieldwork. A third type, PROSPECTING, is WIRED ONLY (data + gear compatibility, no ship fields it, no activity uses it). Team types are a data list, never a binary. |
| D3 | Gear is PER MEMBER: Armor + Weapon + Tool + implants. Squad LOADOUTS in the Armory answer the management load. |
| D4 | Gear runs on the SHIP-SYSTEM GEAR ENGINE: blueprints, Fabricator blanks + inspect, quality/rarity/iLevel, salvage, Lock/Favorite, Warehouse, Armory. |
| D5 | Recruitment like Senior Staff: an hourly-refresh candidate board; hire into a ship's squad; fire to free the spot (gear returns to storage first). |
| D6 | Member rank works like the Complement: ROLLED at generation on the 8-tier ladder, never levels, gates trait count + nudges magnitude. (User's lean; revisit at the balance pass.) |
| D7 | Squad size per SHIP TYPE, 3 or 4 members (table in section 5.2, numbers first-pass). |
| D8 | Implants: 1 slot per member; 2 with RACE AFFINITY (proposed Martian + Stheni). Balance pass watches for an always-hire-race-X meta. |
| D9 | A downed member is INJURED and recovers (timer; Medical shortens it); gear + implants stay. Built so a future opt-in SAFETY INTERLOCK can add a permadeath chance, sharing the ship-combat interlock design. |
| D10 | Ground battles are RANDOM ENCOUNTERS during scan progress. The Security-tool encounter dial scales the chance both ways. |
| D11 | Neural Backup is UNIQUE-EQUIPPED: one in the entire fleet; once per battle, ~50%, revives the first downed member. |
| D12 | Officers are EXEMPT from the "crew never double-dips weapons/shields" rule (stays Complement-only). Every dormant officer bonus gets a live consumer. |
| D13 | Officer stats Strength / Integrity / Cunning / Constitution ARE IN, as FACETS of the department the officer heads (section 7). They act on the ship + on-ship crew only, never ground teams. |
| D14 | Craft-duplicate crew buff is HELD (future FA talent or homeworld staffing); it stops rolling on ship crew. |
| D15 | The 1,017-crew flagship is a LATER hull tier (3rd/4th, a class generation), not this pass. |
| D16 | Gambits are PER MEMBER (Security only). The six preset titles stay. |

**D17. PARTY COMPOSITION IS THE PLAYER'S CHOICE (user, 2026-10-06). No rails.** "You choose your party. If you don't
want a healer and want to go full-on assault, or if you want a team of medic/support based personnel, then you can do
that. It's all about player choice ... If they want to be tanky with dots that kill enemies over time while they never
die, that's fine. If they want glass cannons, that's fine too. Let's not force them onto rails." Consequences: no
squad-composition requirement anywhere (no mandatory medic, tank, or spec mix); every archetype (assault, medic/support,
DoT-tank, glass cannon) must be BUILDABLE from specs + traits + gear + gambits; content may be harder for some builds but
never hard-gated to one; the no-roster stand-in detail gets nothing auto-added (it is not a player choice). Balance passes
check archetype viability, not a "correct" composition.

**D18. MINIMUM AWAY TEAM (user, 2026-10-06):** "A ship with no roster should not be able to fight." An expedition needs
at least **1 Security AND 1 Science** member to launch. There is NO anonymous stand-in team anymore (supersedes the E3
derive-from-crew fallback and the D17 stand-in note): no roster, no expedition.

**D19. DEFAULT MEMBER GAMBITS (user, 2026-10-06):** "A default set of gambits that covers everything but automatic kit
use should be assigned by default unless one is set up." Each member runs a built-in default program (complete
targeting/attack/defense coverage, NO automatic Use Item / kit rules) until the player sets that member's own program.
Not linked to an account-wide program.

**D20. SKILLSETS GATE KITS; MEDICAL TRAINING (user datadump, 2026-10-06, verbatim intent):**
- "Combat characters should have specific skillsets, and certain skillsets should be required. If you have medical
  experience, certain kits can be used." The skill is **Medical Training**.
- The **Med Kit tool requires Medical Training** ("Number 1").
- **Consumables (first aid) work for anyone, at reduced effectiveness without training** ("Maybe at 50% effectiveness");
  Medical Training gives "something like a 25% or 50% boost to them".
- "Certain types of medical consumables might require proper training, especially with some that can cure some things
  like **bone fractures** or **high-level debuffs**." Other debuffs "are easily cured under standard first aid training".
- Examples the user named: "a **splint** might help with a fracture after X amount of ticks", "an **injury kit** might
  decrease the time spent recovering from an injury when an item is used to cure it".
- **Grenades need no spec**: "Pull a pin and toss it."
- **Lure Beacon / Shroud Emitter**: anyone can use them, but they "work at reduced ability ... unless you have someone who
  improves the efficacy of certain categories of kits by 5%/6%" (category-efficacy specialists).
- "Specific kits would include tools that an experienced medical professional would need to learn how to use."
Implied model: kits belong to CATEGORIES (medical first aid, advanced medical, explosives, field devices, ...); each kit
has an optional REQUIRED skill (hard gate) and/or an UNTRAINED efficacy multiplier; members' traits/skills add
category-efficacy boosts. Exact numbers are first-pass and tunable.
- **Field Kits mockup "Open for You" answers (user, 2026-10-09):**
  1. Names: First Aid Kit, Antitoxin, Trauma Kit, Combat Stim, Hemorrhage, Neurotoxin are kept ("the rest are
     fantastic"). ADD two conditions: **Concussion** ("May fail to take an action due to feeling disoriented") and
     **Blindness** ("Enemy combatants could throw flash grenades and have a chance to cause a turn or two of
     blindness"). So enemies gain a flash grenade action.
  2. Explosives: usable by ANYONE (matches D20 "Pull a pin and toss it"): "It doesn't take a true amount of skill to
     use a grenade. But it takes mastery to throw them. Velocity. Acceleration, timing, etc. So something should
     improve use of grenades, but not prevent others from using them." (The mockup's Saboteur +6% was already a boost,
     never a gate; Codebreaker for field devices was not separately answered.)
  3. Untrained field devices: "How about a chance between 50-75%. The fluctuation might help to account for innate
     knowledge, etc. Or would that cause problems later?" (Implementation shape asked, 2026-10-09.)
  4. Fracture: after a Splint it heals in 3 rounds; untreated, the member comes home injured. Approved.
- **Follow-up answers (user, 2026-10-09):**
  - Untrained field devices ROLL PER USE, uniformly 50% to 75% each time the effect fires (user corrected a
    "fixed per member" pick, 2026-10-09: "I was thinking it would be calculated as a range on rolling the effect").
    Safe for determinism: the roll comes from its OWN keyed stream (battle seed ^ salt ^ round ^ actor), never the
    shared battle stream, so no other draw shifts and offline == live holds. Tooltips show "50 to 75%".
  - Grenade mastery: **Saboteur** (+6% to grenade effects), never a gate.
  - Treatment split by training: **Blindness** (from enemy flash grenades; attacks mostly miss for 1 to 2 turns) is
    cleared by anyone's First Aid Kit. **Concussion** (from enemy heavy hits and explosions; first-pass 35% chance to
    lose each action for 3 turns) needs Medical Training + a Trauma Kit to clear early; otherwise it wears off.
  - Still a proposal, not separately answered: Codebreaker as the field-device specialist (+6%).

**D21. SOLO-FIGHT DIFFICULTY IS A GAMBIT CHOICE, NOT A BUG (user, 2026-10-07).** A lone Security member running a
"finish the weakest" program (Default, Triage, Turtle Club President) loses to two strikers on Crashed Ship, while
threat-first programs (Decapitate, Balanced) win ~35/60. Investigation showed it is TARGET ORDER, not a self-heal
stall (that diagnosis was wrong; the attempted heal-priority rule made results worse and was reverted). User: change
nothing; per D17 the player picks gambits. "Ally" selectors stay FFXII-faithful (they include the actor).

**D22. GAS GIANTS ARE STUDIED FROM THE SHIP, NEVER LANDED ON (user, 2026-10-08).** "Gas Giants are a bad idea for
local landing. It should only be from the ship. Probably something like studying the gas giant, and analyzing it.
Things like figuring out how close it got to becoming a star, etc." Consequences: a gas-giant body gets NO ground
activities (no surface PoIs, no away-team landing, no random ground battles while scanning it); instead it offers a
ship-based STUDY / ANALYSIS of the giant itself (e.g. its near-star mass, composition, storms). This supersedes the
mockup's "Atmo Probe lets fieldwork run on gas giants" line and today's code (gas giants currently get PoIs and land
teams).
- **Study rewards (user, 2026-10-08):** "the first 3 are all good ideas. Perhaps you can get one from a pool of different
  rewards." A gas-giant study grants ONE reward rolled from a pool of: (1) atmospheric samples (volatile/rare gas
  materials skimmed from orbit), (2) research data (speeds or unlocks research), (3) a lore readout for the Archive
  (the giant's analysis card: mass, how close it came to becoming a star, storm/composition data).
- **The probe (user, 2026-10-08):** keep the Atmo Probe's spirit with possibly a slightly different name: "A reinforced
  probe unit that can better survive the crushing gravity of a gas giant, resistant against the intense forces and
  dangerously corrosive elements often found within a gas giant ... I want genuine science behind it." It is dropped
  from orbit (no landing) and improves the study. **Name (user, 2026-10-08): Galileo-Class Probe** (after NASA's real
  Galileo probe), replacing "Atmo Probe".
- **Reward pool detail (user datadump, 2026-10-08, verbatim):**
  - Samples: "Another category. Canisters of compressed gases. Deuterium Ice would fit this as well. Processed into a
    canister-stored version. \"Gas Storage Canisters\" as the warehouse category. It's a whole new set of additional
    items for crafting. Perhaps you'll be able to pull a bunch of gas, and it just happens to be a few different types
    of gas that results in enough for a few different gas canisters depending on the location." So: a new warehouse
    category GAS STORAGE CANISTERS; a study pulls a MIX of gas types that varies by location, enough for several
    canisters; Deuterium Ice gets a processed, canister-stored version; the canisters are new crafting inputs.
    Specific gas names are NOT yet chosen (proposals only).
  - Research data: "it could result in different types of research data that can bestow research progress. Full on
    specific research data types. Plus some that can be fed into another tab within the research lab that would be
    used for studying data from an ancient race that can lead to special crafting blueprints being unlocked." So:
    TYPED research data items that grant research progress, plus a second family fed into a NEW Research Lab tab that
    studies an ancient race's data and unlocks special crafting blueprints. (The race is unnamed; never name it
    without the user.)
  - Lore readout home: a new **Survey Log** tab in the Archive (user chose 2026-10-08), the same home SUGGESTIONS
    proposes for the ship-class lore compendium.
  - Probe effect: faster and richer study (user chose option 1, 2026-10-08): "Because it's durable enough to go deeper
    into the crushing gravity and can survive not being crushed by it. Could even involve larger and more dense gas
    giants, increasing that further." So gas giants gain a SIZE / DENSITY property; bigger, denser giants make the
    probe's depth matter more (on the D23 curve).
- **Genuine science to build on:** gas giants have no solid surface; NASA's Galileo atmospheric probe (1995) survived
  about 58 minutes, descending to roughly 22 bar before heat and pressure ended it. Hazards: ammonia / ammonium
  hydrosulfide / water clouds, winds above 600 km/h, steeply rising pressure and temperature. "How close it came to
  becoming a star": ~13 Jupiter masses = deuterium burning (brown dwarf threshold); ~75 to 80 Jupiter masses = hydrogen
  fusion (a true star). A study readout can express mass as a share of those thresholds.

**D23. DIMINISHING RETURNS, NEVER HARD CAPS (user, 2026-10-08).** Asked whether the Science crew layer (a tier-2
explorer's ~225 Science strength gave about +112% haul by itself, burying the party's gear, specs and traits) should
get a haul cap: "Diminishing returns will 100% come into play, but without removing the entire ability to push past a
certain point. Numbers get bigger and bigger and as you get more, they mean less and less. I plan on diminishing
returns affecting quite a few things." Consequences: fieldwork's crew layer and total yield bonus pass through an
UNBOUNDED concave curve (keeps growing, each point worth less), not a ceiling. This is a cross-cutting principle for
future bonuses; existing asymptotic curves (model.ts, utilityGear.ts) are a balance-pass review item, not changed here.
Fieldwork SPEED follows too (user, 2026-10-08, asked whether the 3x pace limit should stay: "curve please!"): the
cap is replaced by its own pace curve; a task is floored at 1 second.

**D24. TASK 16 REVIEW CALLS (user, 2026-10-09).**
- **Squad wipe (answer recorded verbatim, shape being clarified):** "If the squad goes down, then the entire team for
  that specific mission returns to the ship, not impacting any of the others going on in the area. Since ships can
  have multiple ground teams, this wouldn't make any sense to have perfectly healthy teams retreat because one other
  one lost." So a wiped team must never drag healthy teams down with it.
- **Injury clock starts when the run FINISHED** (not at claim), so unclaimed time counts as recovery; "unless a team
  member's physical traits have something like \"can slowly recover from [ailment] within combat\" or a specific class
  of ailment."
- **RACIAL PHYSICAL TRAITS for members (user datadump):** "Something that might help a given senior staff/ground team
  member like a racial perk or something. The stony friends have stone skin and even more durable bones. Chances of
  receiving physical ailments is reduced by 25%, but if they do land, they last for 25% longer. Imagine trying to mend
  stone." So the **Ossir** (the existing stone race, crewRaces.ts) get a racial perk: physical ailments (Fracture,
  Bleed, Hemorrhage, Concussion: the bodily conditions) land 25% less often but last 25% longer (in battle and as
  injury recovery). Name proposal: **Stoneskin**. Other races' physical perks: the user's to name later.
- **Recovery formula:** keep 2h / (1 + Medical + Rapid Recovery + treatment), floor 15m (D23), but FREEZE the ship's
  medical factors at DISPATCH like the run's other crew bonuses.

**D25. GROUND TEAMS ARE ASSIGNED TO TASKS; A WIPE FAILS THE TASK AND IT IS RETRIED AFTER RECOVERY (user datadump,
2026-10-09, verbatim).** "If you have 3 ground teams, and a task requires 1 (note that tasks should be built to be able
to scale to include multiple ground teams if that wasn't already apparent) of those ground teams, and another task
requires 2, this should answer the question. I hope. If you're doing a mission that involves 1 team and the security
team is incapacitated, you fail that task, and it must be redone. You don't gain any of the rewards from the task that
you had gotten up to that point. The task stops, it is reported as failed, and you have to wait to send someone out
again. (note, this will require a system similar to combat to provide an indicator of whether or not your security
team is strong enough to handle threats of that level on the planet), so you don't send your B team where the A team
should go because they have the best stuff. You choose which ground team to send, and they go through the mission,
and if the entire security force is wiped, the mission ends and your team returns to teh ship, the recovery timer
starts, and when recovered and ready to go, they retry the mission. If it completes, then you move on to the next one
in the list that has been selected by the player before starting."
Implied model (to confirm before design): a ship fields SEVERAL ground teams; each TASK requires N ground teams
(scalable); the player picks WHICH team(s) go and an ORDERED TASK LIST before the run starts; a THREAT INDICATOR (like
the combat forecast) compares a team's strength to the planet's threat; a Security wipe FAILS the task (no partial
rewards), the team returns to the ship, its recovery timer runs, and it RETRIES the same task when recovered; success
moves on to the next listed task. Other teams are never pulled back by one team's wipe. This supersedes the Task 16
"sits out the rest of the run" behavior and redesigns how a run walks its tasks.
- **Clarified (user, 2026-10-09):** "A ground team is one selected party (anywhere from 1 to the full team capacity)
  for security and 1 for science. The thought is: equip your ground team members with their equipment set like you
  would a ship. Then you equip those ground team members into their appropriate slot on the team you want them on. You
  can pick and choose where they go in the overall assignment for which ground team members make up which squad in
  which ground team (security squad and science squad)." So: GROUND TEAM = one Security squad (1 to capacity) + one
  Science squad (1 to capacity); members are outfitted first, then SLOTTED into a squad of a chosen ground team.
- **Scope (user, 2026-10-09): fold into 0.14.0.** "this was my originally envisioned plan for how this system would
  work, so it doesn't change my planned scope of 0.14.0."
- **A member downed in a WON fight sits out until recovered** (injured on the spot; the team continues one short;
  rejoins when the recovery timer ends).
- **Follow-up answers (user, 2026-10-09):**
  - Multi-team: WIRE it (tasks can need N ground teams, several teams run in parallel); every current hull keeps 1
    ground team for now.
  - Escape hatch: a task retries until done or the player skips it by hand.
  - Tasks are picked AFTER the planet's scan completes; if the player has not picked, a DEFAULT PLAN runs (editable
    any time). Verbatim: "these tasks will ultimately be balanced to respect the player's choice to play them. They
    will have to be weighed appropriately, include a proper number of tasks to do this, and then be able to set it and
    run it while away. If you have 5 different things pop up and they take a minute each, that's not great. If you
    have 200 things come up and they all take 5 minutes to complete, you can auto-assign randomly if you don't want to
    pick and choose, otherwise, you will choose a queue of what you want each of the teams to do. So if you have an
    A/B/C team, you can have the harder tasks assigned to the A team, the middling tasks to the B team, and the easy
    tasks to the C team. Which might result in B and C finishing their assignments early, in which case they go back
    to the ship and idle/recover. Or, we build in an option in the selection screen for ground teams that \"when
    completing their assignment, this team can join other teams in progress\" which basically selects missions from
    their list that they qualify for. However, this can run the risk of basically getting team C into a losing loop
    forever. ... So perhaps if the team is set to try tasks for the team with tasks remaining, if they fail that task,
    the team set to join other teams in progress once assignments are complete will skip and move on to the next one.
    So they do what they can successfully complete, and leave the hard one to the team that was originally selected to
    do so in the first place."
  - **TASK PROGRESS PERSISTS (user reversed "no saved progress", 2026-10-09):** "these post-scan tasks aren't [a new
    mission]. It's a list of things discovered during the scan, and you can't just repeat it on completion. When the
    task is complete on that planet, it's done. You got all of the goodies. You get your % completion of the system,
    and you move on from there. So perhaps the thing I discounted before is best. Post-scan tasks have a progress bar,
    and they continue from where they left off if they lose."
  - **THE MEDICAL BAY + TURNAROUND LOOP (verbatim):** "The team set to perform them goes back to the ship and are \"in
    the medical bay recovering\". They will need to recover full health and heal all ailments and injuries (there we
    go, ailments for non-physical debuffs like poisons and so forth) and injuries (fractures, concussion, etc). Each
    type of injury should have a set number of ticks to cure while they're in the medical bay, and they all tick down
    at the same time. So basically, if you have 1000 ailments and 1 fracture, and the fracture takes 10 ticks to cure
    and your 1000 ailments take 9 ticks (there won't be 1000 different ailments), then you wait for 10 ticks and you're
    ready to go. Health regen is probably something like 5 ticks. So between tasks you return to the ship, recover as
    needed, and move to the next one. ... They've \"returned to the ship to recover from injuries and present their
    report and offload their findings\" to not only heal up, but to return the items they received from their task.
    Then they head out once that's all done. Tick count would apply to that as well. That'd be loading things up, so
    perhaps crew compliment with the bonus impacting loading could be changed to improve offloading cargo and loading
    cargo to impact stages like this as well. The faster you load the cargo from the last task, the faster your team
    can deploy on the next."
  - **TERMS (user):** AILMENTS = non-physical debuffs (poisons and so forth); INJURIES = physical (fractures,
    concussion, etc). Each type has its own cure time in the medical bay; all tick down at once (wait = the longest).
  - Ship patrols keep their per-wave loot (verified 2026-10-09: a patrol banks each WON wave; a lost wave earns
    nothing), unchanged.

## 3. Scope (rows this phase closes)

- **Away team (A1):** S1-106, S2-43, S4-C06, S4-C09, S4-C11 (superseded by D3), S4-C12, S4-I19 (wiring), S79, S94, S4-EX12.
- **Crew that does nothing (A2):** S4-CP12, S4-CP04, S4-CP05, S4-C24, S4-C18, S4-C25, S1-62, S4-CP16, S4-CP19,
  S4-CP20, S4-CP21, S4-CP38, S4-CP39, S4-CP36, S4-C03, S4-CP08 / S4-C19 (per-hull caps), S1-68 / S4-C33 / S5-148 (officer stats).
- **Acquisition (A3 + A5 part):** S4-CP23 + S4-CP17 (crew module blueprints + install tile), S4-I12 (early sensor blueprints).
- **Also here:** S5-151 (install from the item side) for every gear type, since this pass adds the item-side flow anyway.
- **Not here:** Material Lines (own design doc, `2026-10-02-material-lines-0.14.0-design.md`); the 1,017 flagship (D15);
  boarding party (inventory D3); E-MOD power budget (Reactor Overdrive and the Engineering power facet go live with it).

## 4. Data model

All new fields are additive. One SAVE_VERSION bump (65) for the officer-stat backfill and the away-team containers.

```ts
type AwayTeamType = "security" | "science" | "prospecting";        // data list; prospecting wired only

interface AwayMember {                    // stored like SeniorStaffOfficer: few, named, full objects
  id: string;                             // "member-N", from GameState.nextAwayMemberId; never reused
  teamType: AwayTeamType;
  spec: AwayMemberSpec;                   // Security: offense | defense | debuff; Science: archaeology | xenobiology | geology | cryptography
  name: string; race: CrewRace; gender: string;
  rank: CrewRank;                         // rolled, never levels (D6)
  traits: AwayTraitId[];                  // count = traitCountForRank(rank)
  assignedShipId: string | null;          // the ship whose squad holds them (authority, like officers)
  injuredUntilSeconds?: number;           // absent = ready (D9)
  favorite?: boolean;
}
GameState.awayMembers: AwayMember[]
// The hourly board is NOT persisted: like seniorStaffCandidates (seniorStaff.ts) it is a pure function of
// (awayRecruitSeed, rosterWindowIndex, slot), regenerated identically live and offline. Hiring copies a
// candidate into awayMembers. Board size reads seniorStaffRosterSize (one shared expansion upgrade).
GameState.awayRecruitSeed: number         // per-save seed, set at v65 migration / freshState
GameState.nextAwayMemberId: number
GameState.squadLoadouts: SquadLoadout[]   // Armory, shares loadout capacity rules
SeniorStaffOfficer.stats: OfficerStats    // { strength, integrity, cunning, constitution }, 1..20 (+promotion)
EquipmentInstance.fittedToMemberId?: string | null   // member gear authority (see 4.1)
```

**New equipment slot types:** `memberArmor`, `memberWeapon`, `memberTool`, `implant`. Each catalog variety carries a
`teamTypes` allow-list (Security / Science / Prospecting) and implants carry `uniqueEquipped?: true` (D11).

### 4.1 The one real risk: "spare" predicates
Today `fittedToShipId === null` means "spare" in many places: storage caps, the spare-pool pickers, auto-salvage,
Quartermaster requisition, Armory commit, the Archive. Member gear has `fittedToShipId === null` but is NOT spare.
**Rule:** introduce one `isSparePiece(piece)` helper (`fittedToShipId === null && !fittedToMemberId && not
loadout-committed`) and route EVERY spare predicate through it, with a test that greps for raw
`fittedToShipId === null` spare checks outside the helper. This mirrors how `isStandardIssueBaseline` was made the
single safety-critical predicate.

## 5. Away team

### 5.1 Recruitment board
Mirrors the Senior Staff roster: deterministic per-refresh seed, refreshes each real hour, base size shared with
the officer board's expansion upgrade (S4-CP16 adds the upgrade). Candidate = rolled rank (weighted toward low
ranks), race (affinity flag from D8), spec, traits. Hire assigns a squad slot on a chosen ship (blocked when the
squad is full or the ship is locked, see 5.6). Fire returns the member's gear and implants to storage, then
removes them.

### 5.2 Squad sizes (first-pass, per ship type)
| Ship type | Security | Science | Prospecting |
|---|---|---|---|
| General Freighter | 3 | 3 | wired |
| Hauler, Runner, Prospector | 3 | 3 | wired |
| Destroyer, Battleship, Carrier | 4 | 3 | wired |
| Orion, Aurora | 3 | 4 | wired |
| Eir | 4 | 4 | wired |

Stored on `ShipTypeDef.awayTeams: { type, size, count }[]` so a future hull can list two Security details (S4-I19)
with no engine change.

### 5.3 Member power
Member combat stats = base (by team type + spec) + rank factor + gear + implants, plus the existing crew-derived
squad strength (the ship's division + the matching officer) as a squad-wide layer. Empty slots work bare-handed at
lower strength. **Floor:** a ship with an empty squad still resolves activities exactly as E3 does today (anonymous
fallback members), so no ship is ever blocked by an empty roster.

### 5.4 Gear catalog (first-pass, every name a proposal shown in the mockup)
- Security: Pulse Rifle (long), Scattergun (short, group), Shock Baton (short, stun); Ballistic Weave / Assault
  Hardsuit; Stun Grenade, Toxin Grenade, Med Kit, Shroud Emitter / Lure Beacon (encounter dial).
- Science: Sidearm; Field Suit / Hazard Suit (hazard slow cut); Flora Scanner (terrestrial/ocean/toxic), Thermal Rig
  (volcanic/frozen), Core Drill (arid/barren), Decryptor (vaults/civilizations), Atmo Probe (gas giant).
- Implants: the Cybernetics Bay catalog (Security combat set + Science fieldwork set) + Neural Backup.
- Quartermaster free baseline for Armor / Weapon / Tool per team type (S94), via the existing requisition path.

### 5.5 Expedition flow (replaces "every activity is a battle")
While a body scans, each scan step rolls a RANDOM ENCOUNTER chance (keyed RNG: expedition seed ^ salt ^ step index).
Base chance by planet hazard; the squad's encounter-dial tools scale it (Shroud lowers, Lure raises and raises
drops). An encounter runs the Security-only gambit battle (per-member programs, D16). Win: drops + continue.
Lose: the team pulls back with what it found, the scan pauses until the next attempt, downed members are injured.
Fieldwork finds and the relic chance roll from Science strength + gear + implants + Museum Science power. Enemy drops
and random-event drops (S4-I18) join the haul.

**Determinism:** the away team (members, gear stats, implants, programs) is SNAPSHOTTED onto the Expedition at
dispatch, exactly like today's E3a snapshot, so resolution stays a pure function of the stored expedition.
Injuries are recorded on the expedition result and applied to the live members at claim. Offline == live holds by
construction.

### 5.6 Locks + injuries
A ship on any mission locks officer, complement and away-team changes (S1-62); the UI shows the lock and why.
Injured members cannot deploy until `injuredUntilSeconds`; Medical division + Rapid Recovery shorten new timers.

### 5.7 Squad loadouts (Armory)
`SquadLoadout { id, name, teamType, kits: { memberRole?, armor, weapon, tool, implants[] }[], checkedOutToShipId }`.
Apply fills the squad's members in slot order; a missing or locked piece is skipped and reported, never forced.
Shares the Armory capacity rule with ship loadouts. Unique-equipped implants respect the fleet-wide check on apply.

## 6. Crew bonuses go live

### 6.1 Officer bonuses (D12), consumers first-pass
Weapons Command and Shield Command fold into the combat bridge's weapon damage / shield effectiveness. Evasive
Command adds ship-battle evasion and lowers expedition encounter chance. Discovery Instinct raises the expedition
relic chance and survey rare drops. Fleet Triage strengthens in-battle squad healing and cures. Rapid Recovery
speeds Shipyard repair and shortens injuries. Morale Anchor gives the away team Fear resistance. Command Presence
scales mission output. Inspiring Leader adds a small lift to every ship stat. Veteran Instincts cuts turnaround.
Reactor Overdrive waits for the E-MOD power budget (same release). Officer bonus rolls become WEIGHTED (S4-C03).

### 6.2 Complement division pools + exclusive pool
Security: away-team protection (squad HP), counter-infiltration (resists enemy Debuff). Science: survey aptitude
(scan speed), rare find (relic and rare-drop odds). Medical: squad healing + injury length. Flight Deck: carrier
drone handling. Engineering: Shipyard repair rate (power efficiency with the power budget). Exclusive pool: output
mult, turnaround cut, prevent crew loss (shorter injuries); craft duplicate stops rolling (D14).

### 6.3 Complement management
Active mode gets a TRANSFER action (move selected buckets between a ship and the pool or another ship, cap-aware).
Sort + filter + multi-select. GRADUATE moves one crewmember out of a bucket into `notableCrew` with a generated name
(nothing created a notable before; the GL-1 fold that applies assigned notables already exists). MANIFEST is a lazy
view: names are generated on open from the bucket seed, never stored. Complement caps move from per-spec to
PER-HULL values (S4-CP08 / S4-C19).

## 7. Officer stats (D13)

Rolled 1..20 when the candidate appears; each promotion adds points. Each officer applies their stats to the
department they head (Tactical -> Security, Science -> Science, Medical -> Medical, Engineering -> Engineering,
Operations -> Operations, Pilot -> Flight Deck); the XO applies to every department at a reduced share.

| Stat | Live in 0.14.0 | Later |
|---|---|---|
| Strength | scales the department's complement buffs | homeworld staffing |
| Integrity | "steady under fire": below 50% hull in a battle or patrol wave, the department's buffs get a boost (a bonus, never a new penalty) | boarding defense + boarding party; crew losses |
| Cunning | per-mission chance the department over-delivers (Science bonus rare-find roll, Operations bonus cargo, Engineering free repair tick, Security softens ambush, Medical quicker recovery) | counter-infiltration |
| Constitution | long-haul ramp on expeditions + patrols (D23 curve, knee ~5 hours, no hard cap: user OK 2026-10-09, "Long voyages are all about crew morale.") + shorter post-mission turnaround | fatigue, if it ever exists |

**Task 21 review calls (user, 2026-10-09):** (1) a stat at or below 10 gives NO penalty, just nothing (approved);
(2) Cunning scopes approved as built: Security softens EXPEDITION scan ambushes, Engineering's free repair tick after
a patrol loss, Science and Operations on captain mission cycles, Medical on expedition injuries; (3) Integrity and
the patrol half of Constitution get PER-SEAT effects like Cunning (they only touched battle bonuses, which 4 of 7
seats rarely carry). Table proposed to the user 2026-10-09.

Migration rolls stats for existing officers from a deterministic per-officer seed, so a loaded save gets stable
stats. With all stats at their neutral point the fold is byte-identical (additive-neutral test).

## 8. Acquisition: crew modules + early sensors
Blueprints (research tiers first-pass) for the 3 bridge and 9 quarters variants and for the Wide-Beam, Focused-Beam
and Balanced sensor arrays. Ships Loadout gains Bridge Module + Crew Quarters install tiles beside the Sensor Array
tile. Recipes use existing materials now; Material Lines may re-theme them later.

## 9. Small fixes
Final-retirement warning (5th retirement), Hall of Command honor roll, roster dropdown on the ship personnel screen,
linked Armory loadout applies with its roster, soft captain level cap, candidate-board expansion upgrade (officers +
recruits), per-graph color option in Settings.

## 10. Gambits after the split
Programs move from account-wide per role to PER MEMBER, seeded from a preset on hire. The Science tab goes. Curing
comes from medic traits + kit items inside Security. A battle ends when the enemies are cleared or the team falls.
Migration: every existing account program becomes the default program a newly hired Security member starts with.

## 11. Testing
- Additive-neutral: a save with no members, no new gear and neutral officer stats resolves byte-identically to today.
- Determinism: offline catch-up == live for an expedition with a full roster, encounters, injuries and Neural Backup.
- Spare-predicate guard (4.1) + unique-equipped fleet-wide guard (install, loadout apply, transfer).
- Fire / salvage / lock flows never lose or duplicate member gear.
- Every officer bonus, division buff and officer stat facet has a test proving it changes a derived value (the
  "no dead stats" standing test: iterate every rollable key and assert a consumer exists).
- Migration v64 -> v65: officer stats backfilled deterministically; gambit program carried over.

## 12. Build order
1. Data model + save v65 + `isSparePiece` refactor.
2. Recruitment board + hire/fire + squad sizes + member UI.
3. Member gear slot types + catalog + Fabricator/Warehouse/item-side install + Quartermaster baseline.
4. Implants + unique-equipped guard.
5. Expedition rework: snapshot, random encounters, per-member gambits, injuries, drops.
6. Squad loadouts.
7. Officer bonuses live + weighted rolls + officer stats.
8. Complement: division pools, transfer, sort/filter, graduate, manifest, per-hull caps, mission lock.
9. Crew module + early sensor blueprints and install tiles.
10. Small fixes.
Each step: its own gated commit (`npm run check` + full vitest), additive-neutral, then the standing two-stage
review at the end of the phase.
