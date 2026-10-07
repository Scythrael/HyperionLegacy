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
| Constitution | long-haul ramp on expeditions + patrols (capped) + shorter post-mission turnaround | fatigue, if it ever exists |

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
