# Prospecting Squads (0.14.0, built HIDDEN): DESIGN DRAFT

Status: DRAFT for the user's approval (user, 2026-10-16: "I draft, you approve"). Every NAME below is a [PROPOSAL] for
the user to rename, and every number is [PROVISIONAL] (first pass, tunable). Nothing here is decided until the user
answers section 12. Mockup: the scratch file `prospecting-squads-mockup.html` (title "Prospecting Squads").

Text rules (inherited): US English; no em dashes and no double hyphen anywhere; "install" is the only verb for putting
gear on; player-facing text says "objective", never "task"; graphics are SVG glyphs in `src/lib/ui/icons.ts`, no emoji.

## 0. Sources (authority order: user decisions > design > code)

- **User, group 3 (2026-10-16, safe-first-runs plan):** "add in the wiring for a third team. Because remember, combat
  and prospecting are getting their own more involved set of quests and gameplay, and having a set of teams for
  prospecting for those will required. Also, security squads could have their own role as well. A special mission to
  infiltrate an enemy base or a combatant's vessel."
- **User, group 4 (2026-10-16):** third team = "Prospecting squad type (Recommended)"; use it now? "2. Because there's
  no real use for them yet. It's building in the foundation for them as is, rather than building them in after the
  fact. Since we're building 2/3 of the squads, we might as well build all 3." So Prospecting is built FULLY (specs,
  recruits, gear rules, slots, tests) but HIDDEN until the prospecting quests patch: an explicit, user-approved
  exception to the no-placeholders rule (registry status: deferred, owner = the prospecting quests patch).
- **User, Standard-Issue stats (2026-10-16):** "Each piece of gear gets stats. Similar to ship systems. Except with far
  fewer slots ... Weapon provides offensive stats. Armor provides defensive stats. Kit provides utility and potentially
  stats associated with that based on the role the tool is designed for." Member slots stay Weapon, Armor, Tool +
  Implant x1 (x2 for Martian / Stheni): "Keep this as is."
- **E-CREW design D2** (2026-10-02): "A third type, PROSPECTING, is WIRED ONLY (data + gear compatibility, no ship
  fields it, no activity uses it). Team types are a data list, never a binary." This draft supersedes "wired only" with
  "built, hidden", per group 4.
- **E-CREW D17** (party composition is the player's choice, no rails), **D18** (an expedition needs 1 Security AND 1
  Science), **D20** (skills gate kits; grenades for anyone), **D23** (diminishing returns, never hard caps), **D26**
  (Science gear stopped rolling combat lines because Science never fights: no dead stats).
- **Squads design** (`2026-10-12-squads-and-subspace-telescope-design.md`): teams are PAIRS of squads; kinds Ground /
  Strike / Survey (user names); "Always require one of each type minimum"; a backup roster of one squad's worth of
  berths; Survey teams never fight, and an ambushed Survey team RETREATS with light injuries (user answer 5).
- **Wiring plan** (`2026-10-15-wiring-registry-and-audit-plan.md`) OC-F11 proposed removing the Prospecting type; the
  user's group 4 answer closes OC-F11 the other way (build it, hidden).
- **SUGGESTIONS.md** (2026-10-16 entry): "PROSPECTING TEAMS + SECURITY INFILTRATION (future)".
- **Code today:** `model.ts` `AwayTeamType` / `AWAY_TEAM_TYPES` already carry "prospecting"; every `SHIP_TYPES` hull lists
  `{ teamType: "prospecting", size: 3, count: 0 }`; `awayTeam.ts` `SPECS_BY_TEAM.prospecting = []`,
  `RECRUITABLE_TEAM_TYPES = ["security", "science"]`, `shipSquadSlots` and `squadHasRoom` return 0 / false for it;
  `awayTraits.ts` has no Prospecting traits; `MemberVarietyTraits.teamTypes` never lists it; `quartermaster.ts` issues
  no Prospecting rows; `groundTeamSlots.ts` `GroundSquadType` and `groundComposition.ts` `CompositionSquadType` are
  Security / Science only; `awayTeamDisplay.ts` `SQUAD_META.prospecting = { name: "Prospecting Crew", role: "surveys for
  ore", icon: "ore" }` (a code placeholder, never user-named); the wiring registry entry `away:audit:prospectingTeam` is
  `pending("WR-10, OC-F11")`.

## 1. Purpose: what Prospecting squads will do

[PROPOSAL] Prospecting squads are the GROUND half of the game's gathering pillar. Captains and prospector hulls already
gather from orbit and the asteroid belt (`MISSIONS` extraction runs: cargo capacity, extraction rate,
`extractionYieldMult`, the Prospecting Rig's yield / survey / quality lines). Prospecting squads go where a hull cannot:
onto a body's surface and into its rock, to work DEPOSITS on prospecting quests.

On a prospecting quest [PROPOSAL shape; the quests patch designs the content]:
1. **Find**: the claim's deposits are read (the telescope and scan already do the finding; squads do not re-roll it).
2. **Extract**: the squad works each deposit over time. More YIELD = more units per deposit; more FIELD = faster work.
3. **Grade**: each extracted unit rolls its material tier (common / uncommon / rare, the existing loot triad). More
   GRADE = more units land in the better tiers.
4. **Hazard**: cave-ins, heat and gas slow the work; HAZ cuts the slowdown, as it does for Science today.

Outputs are EXISTING material lines (the ore and material triads, volatiles, the material-lines design), never a new
currency, so prospecting quests feed the same refine and craft economy the ship missions feed.

**How this differs from Science geology.** A Science geologist raises the HAUL of a fieldwork find at Mineral Outcrop,
Cave Network and Geothermal Chamber during an expedition (a study lens, relic odds included). A Prospecting squad is an
industrial crew: volume, grade and pace of extraction on a claim, no relics. The two never stack on the same objective
unless the user later says so (section 12, call 9).

**Prospecting never fights** [PROPOSAL], matching the user's Survey rule: an ambushed Prospecting squad RETREATS with
light injuries and the objective pauses. Protection comes from pairing with Security (section 6), never from turning
miners into soldiers (D26: no dead combat lines).

**Security infiltration is a SEPARATE future role.** The user's "special mission to infiltrate an enemy base or a
combatant's vessel" belongs to Security squads (Strike-flavored quests), not to Prospecting. This design touches
nothing on the Security side; it only notes that a protection pairing (Security + Prospecting) is a different job from
infiltration.

## 2. The three specs

Like Security's offense / defense / debuff (a base stat lift, `gambit.ts` `SECURITY_SPEC_BASE`) and unlike Science's
PoI disciplines, Prospecting specs are ROLES, each lifting one base stat [PROPOSAL]:

- **Excavation** [PROPOSAL name] (the offense analog): a bigger haul. Base YIELD lift, first pass +15% [PROVISIONAL]
  (mirrors Science's `SPEC_POI_YIELD` 0.15).
- **Drilling** [PROPOSAL name] (the defense analog): faster, safer work. Base FIELD lift +10% and HAZ lift +10%
  [PROVISIONAL].
- **Assaying** [PROPOSAL name] (the debuff / utility analog): a better grade. Base GRADE lift +10% [PROVISIONAL].

Type: `export type ProspectingSpec = "excavation" | "drilling" | "assaying";` joins `AwayMemberSpec`.
`SPECS_BY_TEAM.prospecting = ["excavation", "drilling", "assaying"]` (fixed order: the recruit roll indexes it).
`PROSPECTING_SPEC_BASE: Record<ProspectingSpec, { oreYield; fieldwork; hazardResist; oreGrade }>` lives with the future
consumer (section 9). `awayTeamDisplay.ts` gains the three labels and spec lines (EXHAUSTIVE Records: the compiler
forces them), each line with no numbers of its own, the existing tooltip rule.

## 3. Member stats

Reuse the existing vocabulary wherever it serves; add only what has no home [PROPOSAL]:

- **FIELD** (reused, `fieldwork` / `groundFieldwork`): work pace and strength, as for Science.
- **HAZ** (reused, `hazardResist` / `groundHazardResist`): hazard slowdown cut, as for Science (the D23 hazard curve and
  its 75% ceiling apply unchanged).
- **YIELD** (NEW [PROPOSAL]): member stat `oreYield`, gear key `groundOreYield`. Units per deposit, a fraction of base.
- **GRADE** (NEW [PROPOSAL]): member stat `oreGrade`, gear key `groundOreGrade`. The lift on the better-tier roll.

Why two new stats and not a PoI-family yield line like `groundOrganicsYield`: those lines only lift one find family at
an expedition PoI and map to no card stat; YIELD and GRADE are the squad's whole job on every claim, so they read on the
card (FIELD / YIELD / GRADE / HAZ) like Security's HP / PWR / ARM / ACC and Science's FIELD / RELIC / HAZ.

Wiring of the new keys (all in the existing CONVERSION CONTRACT, `awayTeam.ts`):
- `MEMBER_GROUND_STAT_KEYS` gains `groundOreYield`, `groundOreGrade`; `GROUND_STAT_MEMBER_STAT` maps them to `oreYield`,
  `oreGrade`; `GEAR_POINT_BUMP` gains both at 0.01 per point [PROVISIONAL]; `AWAY_STAT_TEXT` gains "yield" and "grade".
- **Golden-neutral snapshot rule** [PROPOSAL]: `convertGroundPoints` writes `oreYield` / `oreGrade` into
  `SnapshotMember.groundStats` only when nonzero (the `perks` precedent), so every Security and Science snapshot keeps
  its exact shape and no stored expedition or golden hash moves.
- Rank: the future consumer multiplies by `rankMagnitudeFactor` from day one (the open `away:audit:scienceRank` gap is
  not repeated).

## 4. Traits

A Prospecting pool of six [PROPOSAL names; numbers PROVISIONAL], built from the EXISTING effect kinds only (no new
`AwayTraitEffect` kind):

- **Strong Back**: "Hauls more out of every seam." +8% yield (`stat` oreYield).
- **Assayer's Eye**: "Knows good rock at a glance." +5% grade (`stat` oreGrade).
- **Tireless**: "Keeps the drill turning." +8% fieldwork (`stat` fieldwork).
- **Rockhound**: "Lives for an open seam." +10% yield at Mineral Outcrop (`poiYield`).
- **Deep Vein**: "Follows the ore underground." +10% yield at Cave Network and Geothermal Chamber (`poiYield`).
- **Steady** (EXISTING Science trait, +10% hazard resistance): its `teamTypes` becomes `["science", "prospecting"]`
  [PROPOSAL] rather than inventing a duplicate. Adding a team to an existing trait leaves the Science pool, and so every
  Science roll, unchanged.

Six covers the rank 7 and 8 draw of 3 traits with room. Ids are stable save keys (the catalog rule). Flavor lines carry
no numbers; `traitDisplayText` generates them.

## 5. Gear rules

**Slots.** Exactly the user's rule, unchanged: Weapon, Armor, Tool (the "kit") + Implant x1 (x2 for the augment-affinity
races Martian and Stheni, `implantSlotsFor`). Same install gate (`memberEquipment.ts` `pieceWearableBy` reads
`teamTypes`), same Armory, Warehouse, salvage, Lock / Favorite and Fabricator path (D4).

**What each slot means for a non-fighting squad** [PROPOSAL, section 12 call 4]: the user's slot roles, read for
miners. Weapon = the cutting implement, whose "offensive" stats are offense against rock (YIELD). Armor = the work suit,
whose "defensive" stats are hazard defense (HAZ). Tool = the role kit (GRADE for the assayer's scanner, YIELD and FIELD
for the mapper). No Prospecting piece rolls a combat line (D26).

**Standard-Issue Prospecting kit** (the Quartermaster's free floor, one per slot, implants never issued), following the
Standard-Issue stats slice's budget rule exactly as the Security and Science rows do:
- Weapon: **Standard-Issue Plasma Cutter** [PROPOSAL]: YIELD primary, FIELD secondary.
- Armor: **Standard-Issue Excavator Suit** [PROPOSAL]: HAZ primary, FIELD secondary.
- Tool: **Standard-Issue Assay Scanner** [PROPOSAL]: GRADE primary, FIELD secondary.

**Crafted catalog** (blueprints on the existing pattern: the three Standard-Issue varieties at tier 1, the specialists
and implants at tier 2; costs and inputs PROVISIONAL, existing producible materials only). statRatios PROVISIONAL:
- Weapon: Plasma Cutter (YIELD 0.5, FIELD 0.4, GRADE 0.1); **Rock Breaker** [PROPOSAL] (YIELD 0.75, FIELD 0.25: the
  heavy hauler); **Sampling Lance** [PROPOSAL] (GRADE 0.5, YIELD 0.4, FIELD 0.1).
- Armor: Excavator Suit (HAZ 0.6, FIELD 0.4); plus the EXISTING Science **Hazard Suit** shared [PROPOSAL].
- Tool: Assay Scanner (GRADE 0.6, FIELD 0.3, HAZ 0.1); **Seismic Mapper** [PROPOSAL] (YIELD 0.5, FIELD 0.4, HAZ 0.1).
- Implants (Cybernetics Bay): **Ore-Sense Optic** [PROPOSAL] (GRADE 0.8, FIELD 0.2); **Myo-Lift Frame** [PROPOSAL]
  (YIELD 0.6, FIELD 0.4); plus the EXISTING Science **Environmental Adaptation** shared [PROPOSAL].

Each Prospecting variety carries its own `implicitStats` and `affixPool` (the E4d per-variety override) so it never
falls back to a slot pool that holds combat or relic lines. Sharing a piece means adding "prospecting" to that variety's
`teamTypes`; it changes no existing roll.

## 6. Team kinds and slots

Squads sit in TEAMS (pairs), with the user's minimum of one Security and one Science squad per ship. [PROPOSAL,
section 12 call 3, recommended option] Prospecting rides the same model:

- **Generic third squad type.** `GroundSquadType` / `CompositionSquadType` gain "prospecting"; `SQUADS_BY_KIND` gains a
  `prospecting` count (0 for Ground, Strike and Survey); `ShipGroundTeam` gains an OPTIONAL flat slot list
  `prospecting?: (string | null)[]` (absent = [], length = prospecting squads of the kind x
  `groundSquadSize(hull, "prospecting")`, which reads the existing `awayTeams` prospecting `size`, 3 on every hull);
  `shipCrewCapacity`, `reserveBerthsUsed`, `shipCrewRoom.aboard` and `squadGate` count three types; the shared reserve
  berths stay one squad's worth.
- **Two new kinds, hidden** [PROPOSAL names]: **Claim** = 1 Security + 1 Prospecting (the protection pairing the user
  hinted at: Security guards the dig), **Dig** = 2 Prospecting. On a 4-squad hull the minimum rule then allows three more
  compositions: Ground + Claim (2 Security, 1 Science, 1 Prospecting), Ground + Dig (1, 1, 2) and Survey + Claim (1, 2,
  1); Strike + Dig, Claim + Claim and Survey + Dig fail it.
- **While hidden**, `validCompositions` and the picker leave out any kind that fields a locked squad type, and
  `setGroundTeamKind` refuses one with a new reason (text [PROPOSAL] "Not available yet"), so no real save can ever hold
  a Claim or Dig team.
- **Deployment while unlocked but before the quests define it:** Prospecting slots never join an expedition crew
  (`deployableGroundTeams` reads Security and Science only) [PROPOSAL]; D18 is unchanged.

## 7. Save shape

What exists already and needs nothing: `AwayTeamType` "prospecting" and `AWAY_TEAM_TYPES`; `AwayMember` (every field is
squad-generic; `teamType` and `spec` are stored strings); the hull `awayTeams` prospecting entries; `teamTypes` on member
varieties; the recruit board (derived, never persisted); `EquipmentInstance.fittedToMemberId`.

What changes, all ADDITIVE and ABSENT-SAFE, so **no SAVE_VERSION bump** [PROPOSAL]:
- Type-only widenings: `ProspectingSpec` in `AwayMemberSpec`; two `GroundTeamKind` ids ("claim", "dig"); two
  `MemberGroundStatKey`s; two `AwayMemberStat`s.
- `ShipGroundTeam.prospecting?` (absent reads as []; `isWellFormedShipGroundTeams` and `shipGroundTeams` accept and
  normalize it).
- The unlock flag (section 8): one optional `GameState` field, absent = hidden.
- `AwayRosterSnapshot` stays `{ security, science }` in 0.14.0; the quests patch adds an optional `prospecting` list.

SAVE_VERSION is 69 today. If review finds any piece that is not absent-safe, it folds into the then-unreleased bump
(v70, shared with G2-1 and SF-1) under that plan's rule: check `git log` for G2-1 or another slice's bump first, frozen
idempotent helper, no member moves.

## 8. How "hidden" works

One predicate decides visibility [PROPOSAL names]: `squadTypeUnlocked(state, teamType)` is always true for Security and
Science, and for Prospecting reads `state.prospectingSquadsUnlocked` (optional; absent = locked). The quests patch sets
it through the shared GRANT seam (group 2: "add it now"). Recommended: the flag stores the roster WINDOW it was set in,
and the board adds Prospecting only from the NEXT window, so a board the player is looking at never reshuffles
(section 12, call 7).

While locked:
- **Recruit board:** the roll keeps today's exact draw (`rng.nextInt(2)` over Security and Science), so every board is
  byte-identical to today (pinned by a golden). Unlocked: a weighted pick over three types, first pass 40 / 40 / 20
  [PROVISIONAL, call 6].
- **No UI anywhere:** the Away Team tab, composition picker, Quartermaster rows, Research list, Fabricator, Archive (and
  its completion totals: hidden blueprints do not count, so 100% stays reachable), Armory filters, install target lists,
  recruit board, Help topics and patch notes show nothing Prospecting. A shared piece (Hazard Suit, Environmental
  Adaptation) stays visible, but its "worn by" text names only unlocked squads.
- **Engine:** hire, move and slot gates refuse Prospecting (`noSquad`), exactly as today, because no unlocked kind
  fields a Prospecting squad.
- **Wiring registry:** `away:audit:prospectingTeam` flips from `pending("WR-10, OC-F11")` to
  `{ kind: "deferred", owner: "prospecting quests patch", userRef: "safe-first-runs plan, user answers group 4" }`, and
  every new Prospecting source (the three spec bases, the five new traits and Steady's Prospecting reach, the two gear
  keys, each Prospecting variety's lines) gets its own deferred entry. Deferred entries must not move a probe and do not
  block the 0.14.0 release gate; the completeness test still enumerates them, so nothing can hide unregistered.

## 9. The future consumer (the quests patch, sketched so the data is right)

[PROPOSAL] A Prospecting snapshot member yields, per deposit: `units = base x (1 + diminishing(Y))` where Y sums the
squad's YIELD (spec base + traits + gear, rank-scaled) and the matching `poiYield` traits; pace follows FIELD through
the existing fieldwork pace curve; GRADE shifts the tier roll toward uncommon and rare through a diminishing curve
(D23: no hard cap); HAZ joins the existing hazard-resist curve and its 75% ceiling. Same STACKING RULE (same-stat bumps
add). Nothing reads any of this in 0.14.0.

## 10. Tests

1. **Board golden (locked):** `awayRecruitCandidates` over many seeds and windows serializes identically to a hash
   captured BEFORE the change.
2. **Board (unlocked):** Prospecting appears near its weight over thousands of rolls, only from the window after the
   unlock; every Prospecting candidate holds a Prospecting spec and only Prospecting-pool traits; `specsFor` is non-empty
   for every recruitable type (the existing throw stays).
3. **Specs and traits:** three specs in fixed order; trait ids unique and stable; Steady rolls for both Science and
   Prospecting; display Records exhaustive (compile).
4. **Gear rules:** every Prospecting variety lists "prospecting"; Security and Science cannot install Prospecting-only
   pieces and vice versa; shared pieces install on both; no Prospecting variety's pools hold a combat or relic line.
5. **Quartermaster:** locked = no Prospecting rows; unlocked = Weapon, Armor and Tool rows naming real varieties, with
   the Standard-Issue stats slice's budget.
6. **Snapshot shape:** Security and Science snapshots are byte-identical to before (no `oreYield` / `oreGrade` keys);
   a Prospecting member's snapshot carries them.
7. **Composition:** locked = `validCompositions` unchanged for every hull and `setGroundTeamKind` refuses Claim and Dig;
   unlocked = Ground + Claim, Ground + Dig, Survey + Claim valid, Strike + Dig, Claim + Claim, Survey + Dig invalid;
   capacity and berths count three types; a Prospecting hire refuses `noSquad` on Ground + Ground and slots on Claim.
8. **Save:** a save with a Prospecting member and a Claim team round-trips; an absent flag reads locked; old saves load
   with no change and SAVE_VERSION stays 69; every `stateHash` golden is unmoved.
9. **Hidden surfaces:** each pure display helper (squad blocks, picker options, requisition entries, research and
   Archive lists, completion totals, help topics) lists nothing Prospecting while locked.
10. **Wiring:** completeness enumerates every new source with status deferred; deferred entries do not move; the
    release gate passes; `no-dead-stats` lists `groundOreYield` / `groundOreGrade` as deferred, not dead.

## 11. Build slices [PROPOSAL]

- **PS-1 data:** types, specs, traits, stat keys, gear varieties and blueprints, the flag and `squadTypeUnlocked`, the
  deferred registry entries, tests 3, 4, 6, 10.
- **PS-2 recruits:** the flag-gated board roll and its golden (tests 1, 2).
- **PS-3 slots:** the generic third squad type and the hidden kinds (tests 7, 8).
- **PS-4 hidden surfaces + Quartermaster rows** (tests 5, 9), then the holistic review. QA sheet: a delta "nothing new
  is visible" check on desktop and mobile, plus the Debug path if call 10 adds one.

Scope note (the push-back rule): about four small slices, no engine reader changes, no migration. It sits beside a very
large 0.14.0; if the release is tight, PS-3 is the slice that could wait without retrofit cost growing much.

## 12. OPEN CALLS for the user (recommended first in each)

1. **Spec set.** (a) Excavation / Drilling / Assaying: yield, pace + safety, grade (Recommended). (b) Seismics /
   Excavation / Assaying, where Seismics finds extra deposits. (c) Blasting / Excavation / Assaying, where Blasting ties
   to the Field Kits explosives category.
2. **Card stats.** (a) Reuse FIELD and HAZ, add YIELD and GRADE (Recommended). (b) Reuse FIELD and HAZ only; specs act
   through favored deposits like Science. (c) Add YIELD only; grade comes from the Assaying spec alone.
3. **Where Prospecting squads sit.** (a) A generic third squad type in the team model plus two hidden kinds, Claim
   (Security + Prospecting) and Dig (2 Prospecting) (Recommended). (b) The generic third squad type only; kinds are
   designed with the quests. (c) A standalone per-ship Prospecting squad outside the teams, converted later by a
   migration.
4. **The weapon slot on a non-fighting squad.** (a) A cutting implement whose "offensive" stats are YIELD (Recommended:
   no dead combat lines). (b) A real sidearm with combat lines for ambushes (dead until Prospecting fights exist).
   (c) No weapon slot for Prospecting: Armor, Tool and implants only.
5. **Shared gear.** (a) Share the pure-hazard pieces with Prospecting: Hazard Suit, Environmental Adaptation and the
   Steady trait (Recommended). (b) Prospecting wears only its own pieces. (c) Also share Science's Core Drill and Thermal
   Rig.
6. **Recruit weights after unlock.** (a) Security 40, Science 40, Prospecting 20 (Recommended). (b) Equal thirds.
   (c) A separate Prospecting slot count on the board.
7. **The unlock.** (a) A per-save flag the quests patch sets through the grant seam, applied from the next board window
   (Recommended). (b) One code constant flipped in the quests patch, every save at once. (c) A per-save flag that applies
   immediately.
8. **Fights.** (a) Prospecting never fights; an ambushed squad retreats with light injuries, like Survey (Recommended).
   (b) Weak self-defense fights.
9. **Uses beyond the prospecting quests (later).** (a) Prospecting quests only (Recommended). (b) Also lift Mineral
   Outcrop, Cave Network and Geothermal Chamber objectives on expeditions. (c) Also boost the ship's own extraction
   missions.
10. **QA access before the quests.** (a) A Debug-only (`?dev`) "Unlock Prospecting squads" toggle on a test save
    (Recommended). (b) No access; tests only.
11. **Names.** (a) Keep every proposed name: Excavation, Drilling, Assaying, YIELD, GRADE, Strong Back, Assayer's Eye,
    Tireless, Rockhound, Deep Vein, Plasma Cutter, Rock Breaker, Sampling Lance, Excavator Suit, Assay Scanner, Seismic
    Mapper, Ore-Sense Optic, Myo-Lift Frame, Claim, Dig, and the code's existing squad label "Prospecting Crew"
    (Recommended). (b) Rename some (tell me which).

## USER ANSWERS (2026-10-16)

- **Roles:** "Excavation / Drilling / Assaying (Recommended)" (Excavation +15% YIELD; Drilling +10% FIELD and +10% HAZ;
  Assaying +10% GRADE).
- **Stats:** "Add YIELD + GRADE (Recommended)": reuse FIELD and HAZ, add YIELD and GRADE.
- **Fights:** "Never, retreat (Recommended)": like Survey teams; Security protects them.
- **Team kinds:** "Type + two team kinds (Recommended)": the squad type plus two hidden team kinds (Security +
  Prospecting; 2 Prospecting); kind names still [PROPOSAL].
- **Weapon slot:** "A cutting tool (Recommended)": a work implement adding YIELD, no damage (name [PROPOSAL]).
- **Shared gear:** "Hazard gear + Steady (Recommended)".
- **Later uses (multi):** prospecting quests, expedition mineral sites, AND ship mining missions (all three).
- **QA access:** "Tests only" (NOT a Debug toggle): no in-game way to see them until the quests patch.
- **Recruit odds:** "Separate board slots": Prospecting recruits get their own slots on the recruit board (Security /
  Science rolls unchanged).
- **Unlock:** user answered "Something else" with no detail: re-asked 2026-10-16.
- **Names:** "Keep them (Recommended)".
- **Unlock (re-asked):** "A quest step unlocks it" (per save; the earlier "Something else" was a misclick).

## CARRY NOTE: built HIDDEN (2026-10-19, builder branch off feat/crew-0.14.0 at 5f9342a)

Built per the USER ANSWERS above; nothing a player can see moves while the flag is unset (proved by
`prospectingHidden.golden.test.ts`, captured BEFORE any edit: recruit board over 5 seeds x 20 windows x 2 sizes,
Quartermaster rows, every hull's compositions and crew caps, a fresh save, Security / Science specs and trait pools,
the worn-by lines, two roster snapshots; all unchanged, plus every existing stateHash golden).

- **Unlock seam:** `prospecting.ts` `squadTypeUnlocked(state, type)` (the one predicate) and
  `unlockProspectingSquads(state)` (sets optional `GameState.prospectingSquadsUnlocked: true`, idempotent). Nothing
  calls it in 0.14.0; the quests patch's quest step calls it through the shared grant seam. No Debug toggle (user:
  tests only). Applies IMMEDIATELY: with separate board slots no board reshuffles, so call 7's "next window" was not
  needed [builder call, revisit if wanted].
- **Built:** `ProspectingSpec` (Excavation / Drilling / Assaying, `PROSPECTING_SPEC_BASE` +15% YIELD; +10% FIELD and
  HAZ; +10% GRADE); `groundOreYield` / `groundOreGrade` keys, member stats `oreYield` / `oreGrade` (snapshot writes
  them only when nonzero); five traits + Steady shared; eight Prospecting-only varieties (Plasma Cutter, Rock Breaker,
  Sampling Lance, Excavator Suit, Assay Scanner, Seismic Mapper, Ore-Sense Optic, Myo-Lift Frame) with own pools, no
  combat or relic line, no weaponRange; Hazard Suit and Environmental Adaptation shared; Standard-Issue rows Plasma
  Cutter / Excavator Suit / Assay Scanner (`requisitionEntriesFor(state)`; `REQUISITION_ENTRIES` unchanged); recruit
  board: `PROSPECTING_BOARD_SLOTS` = 3 [PROVISIONAL] separate slots, own seed and id space
  (`away-candidate-p-<window>-<slot>`); team kinds Claim (1 Security + 1 Prospecting) and Dig (2 Prospecting),
  `ShipGroundTeam.prospecting?` present only on those kinds, `setGroundTeamKind` / `applyComposition` refuse
  "kindLocked" ("Not available yet") while locked, `validCompositions(h, { prospecting: true })` lists them; crew caps
  and reserve berths count three types (absent keys on visible compositions).
- **Never fights / never deploys:** Prospecting slots stay out of expedition crews (`GROUND_SQUAD_TYPES` unchanged).
- **Later uses (all three, user):** `PROSPECTING_USES` = quest, mineralSite, miningMission and the shared reader
  `prospectingCrewStats(members, poi?)` (role base + gear + traits + site traits, rank-scaled). Each use designs its
  own D23 curve; whether mineralSite stacks with a Science geologist is still the user's call.
- **Blueprints:** `PROSPECTING_BLUEPRINTS` (eight) live OUTSIDE `BLUEPRINTS`, because Research / Fabricator / Archive
  and completion totals read BLUEPRINTS whole with no hidden-entry rule. The quests patch merges them in.
- **Wiring:** every Prospecting source is `deferred`, owner "prospecting quests patch" (25 gear lines, 5 traits, 3
  roles, 8 blueprints, 3 uses, 7 audit rows incl. Steady's reach and the shared hazard gear).
- **Save:** optional fields only, SAVE_VERSION stays 70, no migration.
- **Open for the quests patch:** Claim / Dig glyphs (they borrow the ore glyph [PROVISIONAL]; needs mockup + SVG
  review), Armory loadouts carry no Prospecting kits, the visible UI (Away Team tab, picker, Quartermaster console via
  `requisitionEntriesFor`), and a Claim team's Security squad deploys like any Security squad.
