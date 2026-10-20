# Field Kits (E-CREW Task 16b, 0.14.0) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan slice by slice
> (the user's standing workflow: one fresh implementer per slice, two-stage review per slice, holistic review at the
> end, QA sheet to the user, deploy only on the user's word).

## REVISED SLICES (2026-10-16): SUPERSEDES section 4, and sections 3, 5 and 6 where they conflict

**Why:** the user's answers at the end of this doc (USER ANSWERS 2026-10-15, groups 5, 6 with the FIELD KITS RESHAPE
verbatim, and 7) plus the credit sinks pass (`docs/plans/2026-10-16-credit-sinks-pass.md` USER ANSWERS: "Quartermaster
sells + top-up (Recommended)") reshape the build. Sections 0 (standing rules), 1 (source decisions) and 2
(reconciliation) still apply. Section 3's data model, section 4's FK-1..FK-10 (except the FK-3 carry, done), section
5's answered calls and section 6's QA list are SUPERSEDED by this section; they stay below as history. FK-3 is built
and stays the pre-Field-Kits golden set; the slices below are FKR-0..FKR-11 (one implementer + two-stage review
each, dependency order; FKR-0 commits alone before any engine edit).

### R1. What changed (the decided shape, in one place)

- **Grenades and field devices stay installed TOOLS** (open call 1) with **CHARGES**: a set number of uses per
  objective, reset to full for free at every objective start ("Free, every objective"), optionally capped per battle
  (grenades: 1 per battle, they deal AoE). Quantity by tool kind: a plain grenade about 4, a specialized one about 2,
  "a lower-level kit might contain 3". A new rollable tool line: **+1 carry capacity** (one more charge).
- **Grenade family:** the user-named **IMPACT GRENADE** (explodes on contact, AoE damage, a chance to inflict a
  debuff) is the plain grenade; Stun Grenade and Toxin Grenade (model.ts 2565 to 2587) become specialized types with
  their own debuff and quantity.
- **Consumable kits** (the six medical / stim kits) are carried **PER MEMBER** (FK4 answer; GO-17's
  `SquadLoadoutKit.consumables?` slot, model.ts 6461, is kept, not moved to the team). Every objective, each member
  starts with a **FREE basic set**; extras come from crafted (or bought) stock; unused extras come home at claim.
  The free floor reads the ship's Medical and Operations crew on a D23 curve (FK3: "Per trip, curved"), no cap.
- **Cure** (the medic's free action) clears basic debuffs only (FK2).
- **Condition SEVERITY RANKS:** Fracture, Broken Bone, Shattered Bone. Splint: a Fracture and a light Broken Bone;
  Trauma Kit (Medical Training): Hemorrhage, Neurotoxin, Concussion, Broken Bone; Shattered Bone: only the medical
  bay. First Aid: Bleed, Blindness, Weakened, Suppressed, Corroded + a small heal; Antitoxin: Poison; Combat Stim:
  Inspired 2 rounds; Injury Kit: shortens bay time (group 5).
- **Numbers as proposed** (FK13): Blindness hit x0.25 for 2 to 3 rounds; Fracture power and accuracy x0.8, worse at
  higher ranks; Hemorrhage 12 per round x4; Neurotoxin 5 per round + 25% turn loss x4; Concussion 35% x3.
- **Inflictors as proposed** (FK7): Bruisers Fracture + Concussion on a heavy hit; Strikers Hemorrhage on finishing a
  wounded target, plus one flash grenade each (Blindness); Casters Neurotoxin in place of Poison on Hard or harder
  objectives; Swarm and hostile garrisons Fear.
- **Cortex Shield resists Concussion** (FK6). **Codebreaker +6% on the 50 to 75% device roll** (FK8: 53 to 79.5%).
  **Saboteur: own grenades only** (FK10). **Kits count in threat odds** (FK12).
- **ENEMY RANKS** (Weak, Normal, Strong, Elite, Boss), built now as a ground-combat foundation: stats scale by rank;
  the final fight of harder objectives holds an Elite or a Boss; threat odds and Reinforcing account for ranks.
- **Gambits:** a rule needing a charge you lack, or a per-battle use already spent, does not fire (the next rule
  acts). New conditions "target is Elite or stronger" and "target is a Boss", and a per-rule "keep N charges for a
  Boss" reserve.
- **Quartermaster** sells kits for credits, plus a per-team "Top up from the Quartermaster at launch" toggle, OFF by
  default, buying only the shortfall against the members' pack preferences.
- **Cross-checks:** gear wear (`2026-10-16-gear-wear-design.md`: tools wear by fieldwork, "No wear on training"),
  safe first runs (`2026-10-15-safe-first-runs-plan.md`: the training run cannot be lost, so it fields no Elite or
  Boss), the wiring registry (`src/lib/game/wiring/registry.ts`: every new effect gets an entry with a sensitivity
  check in the slice that makes it live; pending entries flip live in that commit), the goldens already captured
  (`fieldKitsGoldens.test.ts`, `firstRunsGoldens*.test.ts`, G2-0), and SAVE_VERSION 69 (v70 is shared and may be
  taken by WR-4 or G2-1).

### R2. Data model (supersedes section 3; every field optional and absent-safe)

```ts
// == enemyRanks.ts (new, pure) ==
export type EnemyRank = "weak" | "normal" | "strong" | "elite" | "boss";
export const ENEMY_RANKS: Record<EnemyRank, { order: number; label: string; hp: number; power: number; heal: number }>;
                                                   // [PROVISIONAL multipliers, open call N1]; normal = 1 (today)
export const ENEMY_RANKS_VERSION = 1;
// == fieldKits.ts (new, pure) ==
export type FieldKitId = "firstAidKit" | "antitoxin" | "splint" | "injuryKit" | "traumaKit" | "combatStim";
export type ConditionLine = "bone" | "bleed" | "toxin";   // [PROPOSAL, open call N9]
export const CONDITION_LINES: Record<ConditionLine, readonly GambitStatusId[]>; // bone: fracture, brokenBone, shatteredBone
export const FIELD_DEVICE_SALT = 0x...;  // odd, new, registered (the per-use device roll)
export const SABOTEUR_GRENADE_BONUS = 0.06; export const CODEBREAKER_DEVICE_BONUS = 0.06; // user
// == model.ts ==
ItemCategory |= "fieldKit";
GambitStatusId |= "fracture" | "brokenBone" | "shatteredBone" | "hemorrhage" | "neurotoxin" | "concussion" | "blindness";
GambitActionId |= "flashGrenade" /* enemy only */ | "throwGrenade" /* member, spends a charge */;
GambitTargetSelector |= "allyDowned";
GambitRuleParams.kitId?: FieldKitId; GambitRuleParams.minRank?: EnemyRank; GambitRuleParams.reserveForBoss?: number;
GroundCombatant.rank?: EnemyRank;                        // absent = normal (today)
ToolVariety.charges?: { perObjective: number; perBattle?: number };   // grenades [PROVISIONAL, open call N4]
affix stat "toolCarryCapacity"                           // +1 charge per line (integer), grenade pools only
Expedition.enemyRanks?: { version: number };             // FLAG 1, stamped at dispatch from FKR-1
Expedition.fieldKits?: { catalog: number };              // FLAG 2, stamped at dispatch from FKR-7
GroundTeamRun.kits?: Record<memberId, Partial<Record<FieldKitId, number>>>;    // carried extras left (per member)
GroundTeamRun.basics?: Record<memberId, Partial<Record<FieldKitId, number>>>;  // this objective's free set left
GroundTeamRun.charges?: Record<memberId, number>;        // the member's tool charges left this objective
GroundTeamRun.treatment?: Record<memberId, number>;      // Injury Kit share this trip
GroundFightRecord.kitsUsed? / basicsUsed? / chargesUsed? / treated? / ranks?: per member or per enemy, record only
SquadLoadoutKit.consumables?: Partial<Record<FieldKitId, number>>;   // GO-17 slot, now WRITTEN (the member's pack)
ShipGroundTeam.packs?: Record<memberId, Partial<Record<FieldKitId, number>>>; // pack preference per member
ShipGroundTeam.topUp?: boolean;                          // Quartermaster top-up at launch; absent = off
```

**Save (every slice):** optional fields only, so SAVE_VERSION stays 69 and no slice needs a bump. If review finds a
slice must migrate (for example retiring `exp.teamKit` on stamped runs, which this plan does NOT do: unstamped runs
keep reading it), it rides the then-unreleased shared v70 step (whichever of WR-4 or G2-1 opened it, if v70 has not
reached staging) or takes its own next step; it never opens a second bump in the same release.

**Two flags, one rule:** a run without `enemyRanks` fields every enemy at Normal exactly as today; a run without
`fieldKits` fights, rolls, heals and claims byte-identically (passive grenade on-hit, `exp.teamKit`, the old Cure).
Both are stamped by `buildExpedition` (so `launchForecast`'s throwaway run reads what the run will do). Every
golden fixture already passes through `withoutFieldKits(exp)`; FKR-0 widens it to strip `enemyRanks` too.

### R3. The revised slices

#### FKR-0: Goldens extension (tests only, BEFORE any engine edit; own commit)

**Files:** `fieldKitsGoldens.test.ts` (new cases), `awayTeamTestFixtures.ts` (`withoutFieldKits` also strips
`enemyRanks`, `basics`, `charges`, `chargesUsed`, `basicsUsed`, `ranks`, team `packs` / `topUp`; identity today,
asserted).
**Behavior:** capture what FK-3 does not pin: (1) a Stun Grenade and a Toxin Grenade wearer's fight (today's passive
on-hit, the thing flagged runs replace); (2) a Deadly hostile fortification objective's final fight and an AF-1
Reinforcing reinforcement fight's enemy list (the ranks targets); (3) the threat odds at each difficulty grade 1 to 5;
(4) one crafted roll of each grenade variety at three seeds (FKR-5's new affix line moves these on purpose: they must
be NAMED as moved, never silently re-captured); (5) a loadout round trip with `consumables` absent. SF-0's `guards`
and `old:v69`, G2-0 golden 1 and every FK-3 hash must already be green.
**Acceptance:** green on today's code. Commit `test(0.14.0): Field Kits revised goldens (FKR-0)`.

**FKR-0 carry (2026-10-16, done):** committed as `test(0.14.0): pre-Field-Kits-revised golden hashes (FKR-0)`, tests
only, hashes captured on engine `32d64ff` (the WR-4 review commit; nothing in it touches a fight, a roll or a claim).
`fieldKitsGoldens.test.ts` now runs FK-3's three whole-run suites through one shared `wholeRunSuites` (FK-3's 35 hashes
unchanged) and adds 20 default tests plus 12 gated ones. `withoutFieldKits` also strips `enemyRanks`, team `basics` /
`charges` and the pending fight's `basicsUsed` / `chargesUsed` / `ranks`; the new state twin `withoutFieldKitsState`
strips ship team `packs` / `topUp` and runs every expedition through `withoutFieldKits`; every claim hash (FK-3 and
FKR-0) now hashes through it (identity today, asserted). Credits spent and kit stock are NOT in the twin: FKR-7 strips
them in its own comparison. Pinned: (1) `stunGrenade` / `toxinGrenade` (hand runs, a frozen 60-point grenade on
member-1) and `grenadesReal` (a real dispatch, one grenade per team) as whole runs with parity and event-boundary
parity, plus each wearer's first battle (the only on-hit status in the squad, applied at least once); (2) the final
fight of every graded objective on two bodies (Low, combat 1: Secure Landing Zone 1 Simple, Clear Hostiles 2 Standard,
Derelict Outpost 3 Challenging, Enemy Colony 4 Dangerous, Enemy Fortification 5 Deadly; High, combat 3: Ancient Ruins
Challenging, Buried Vault Dangerous, Derelict Outpost Deadly), every fight of a Deadly Enemy Fortification against a
full rank 6 ship (the final one won against 6), and every reinforcement fight seen on `affixCat1` (4) and `affixCat2`
(3, one escalated at alert 1 with 4 enemies), each re-resolved from the second before it to its stored record; the
fielded enemy list hashed is `resolveTaskFightOnSeed`'s chain BEFORE ranks, so FKR-1 must leave it alone and move
only the record and log on the stamped twin; (3) the odds per grade for one team at rank 3 and both teams at rank 6
(Low `1:32 2:5 3:0 4:0 5:0` and `1:32 2:32 3:32 4:30 5:0`; High `3:20 4:0 5:0` and `3:32 4:32 5:32`); (4) Stun and
Toxin Grenade inspects at seeds 2, 3, 27 (crafting level 20): `craftedRolls` MOVES AT FKR-5 and must be named there;
(5) a loadout create, check-in, apply and save round trip with no `consumables` key. Gated (`FKR_SWEEP=1` or vitest
mode "sweep"): the odds per grade at ranks 1, 3, 6, both sides, 256 samples, pinned as a table for FKR-1's tuning.
Slowest default test about 0.42 s.

#### FKR-1: ENEMY RANKS (engine; flag 1; it moves stamped fights)

**Files:** new `src/lib/game/enemyRanks.ts` + `enemyRanks.test.ts`; `model.ts` (`EnemyRank`, `GroundCombatant.rank`,
`Expedition.enemyRanks`); `groundFight.ts` (`withEnemyRanks(enemies, ctx)` applied in `resolveTaskFight` AFTER
`generateEncounter`, `withFloraToxins`, `withEscalation` and SF-2's scale when present; `TaskFightExp` widened); `groundThreat.ts`
(memo key lists ranks; odds read ranked enemies); `affixes.ts` (Reinforcing extras take a rank, open call N5);
`expedition.ts` (`buildExpedition` stamps); `salts.test.ts` only if a draw is added (the proposal adds none);
wiring `catalogs.ts` / `registry.ts` / `probes.ts` (catalog `ENEMY_RANKS`, one entry per rank multiplier).
**Behavior:** `rankFor({ grade, fightIndex, fightCount, slot, hostileSite, trainingRun })` is a PURE function of the
objective's stamped difficulty grade and the fight's place in it [PROPOSAL, open calls N2, N3]: the final fight of a
harder objective puts its strongest enemy (highest base power, then list order) at Elite or Boss; other enemies stay
Normal unless N3 says otherwise. An unrated objective (legacy, pre-SQ-4) is all Normal. **Training run** (SF
`difficulty.firstRun`): every enemy Normal, never Strong, Elite or Boss, read through one helper `trainingRun(exp)`
(if SF-1's stamp type is not merged yet, the helper reads the planned field shape and SF-2's proof test covers it);
the SF backstop and SF ramp are untouched (ranks multiply after the ramp scale). Rank multiplies hp, hpMax, power and
heal; `threat` follows power. A ranked enemy's id keeps its role tag (`enemy-bruiser-1`), and the record stores ranks
for the log ("Elite Bruiser").
**Determinism:** no draw (rank is arithmetic on stored values), so the fight stream and every generation draw are
untouched; unstamped runs never call `withEnemyRanks`. **Tests:** each rank's multipliers; final-fight placement per
grade; training run fields no Elite or Boss on all three fresh-save candidates; Reinforcing extras ranked; threat odds
move with ranks and the memo distinguishes them; parity one call == 997 s == 1 s on a stamped Deadly run; FK-3, SF-0
(`guards`, `old:v69`), G2-0 goldens unchanged; FKR-0 (2) and (3) move only on the stamped twin. **Wiring:** each rank
entry live with a sensitivity check (probe: the fight's enemy hp / power). **Save:** optional fields, none.
**Staging:** deployable on its own (ranks are complete; the reserve rules arrive in FKR-6).
Commit `feat(0.14.0): enemy ranks Weak to Boss in ground fights (FKR-1)`.

**FKR-1 carry (2026-10-16, done):** committed as `feat(0.14.0): enemy ranks Weak to Boss on ground fights (FKR-1)`.
`enemyRanks.ts` (pure): `ENEMY_RANKS` with ONE multiplier per rank (user N1 as answered: Weak 0.7, Normal 1, Strong
1.3, Elite 1.7, Boss 2.5) on hp, hpMax, power and heal, `threat` following power; `FINAL_FIGHT_LEAD` by grade
(Simple / Standard none, Challenging Elite, Dangerous and Deadly Boss, the 2026-10-16 correction); `REINFORCEMENT_RANK`
Normal (N5); `fightLeadRank` (only an ordinary fight for the objective's LAST fight point leads; surprise and
reinforcement fights, earlier points, unrated objectives and training runs are all Normal, N3); `withEnemyRanks`
(the lead is the strongest fielded enemy, highest power then list order: a Striker on most sites); `isTrainingRun`
(the ONE read of SF's `Expedition.difficulty.firstRun`, typed by SF-1, written by SF-2; absent = not a training run);
`rankedEnemies`, `rankedEnemyName` ("Elite Striker") and `rankAtLeast` for FKR-3 / FKR-6. `GroundCombatant.rank` is
stamped on every enemy of a ranked fight; `GroundFightRecord.ranks` lists the non-Normal ones only. Flag
`Expedition.enemyRanks: { version: 1 }` stamped by `buildExpedition`. `resolveTaskFight` / `resolveTaskFightOnSeed`
take a trailing `kind` ("point" default; groundOps `startFight` passes surprise / reinforcement) and rank AFTER
generation, flora and escalation; the fielded list FKR-0 hashes is untouched. Threat: `ThreatTask` carries
`difficulty`; the memo key appends `["ranks", version, grade, training]` on ranked runs only (every unranked key
byte-identical). No draw added (`salts.test.ts` untouched), no save change. Wiring: `expedition:ENEMY_RANKS:<rank>`
x5, live, equals curve, probe `content:enemyRank:<rank>` (the lead's power ratio through `withEnemyRanks` on a real
guard); `ENEMY_RANK_IDS` listed in `UNREAD_CONSTANTS` (read by the registry). Goldens: every FK-3, FKR-0, SF-0
(golden 4, 5, 7, sweep B), G2-0, CP-0, WR-4, AF-1, AF-2, SQ-4 and GO-7b hash unchanged; the fixtures that dispatch strip
the flag at dispatch (`withoutEnemyRanks`, `asPreRanksDispatch`; `withoutRisk`, `withoutAffixes`,
`withoutAffixCatalog` and `withoutFieldKits` strip it too), plus four scenario fixtures pinned to a pre-rank seed
(groundOpsParity, groundOpsRisk riskRun, groundOpsAffixes dispatch, save v67 to v68). Tests: `enemyRanks.test.ts`
(21) and `groundOpsRanks.test.ts` (13: the stamped twin of FKR-0 (2) and (3), surprise / reinforcement Normal, the
training seam test that FLIPS at SF-2, all three fresh-save candidates as training runs equal their unranked run,
whole ranked runs placed by the rule, parity one call == 997 s == 1 s on a stamped Deadly run). Measured (scratch,
deleted; FKR-0's graded bodies, clear odds out of 256, unranked to ranked): Simple / Standard unchanged everywhere;
Challenging one team rank 3 (High) 184 to 106, rank 6 (Low) 19 to 4; Dangerous both teams rank 3 (Low) 53 to 0, rank 6
(Low) 243 to 54, (High) both rank 3 255 to 105; Deadly both rank 3 (High) 256 to 242. UI: none (the rank word needs a
stored fight record in the readout; FKR-3 / FKR-9 own the chips and the "Elite Striker" line).

**FKR-1 follow-up (2026-10-17, done):** `fix(0.14.0): Dangerous ends with an Elite, Strong leads its earlier fights
(FKR-1 follow-up)`, per the 2026-10-16 rulings below ("Soften Dangerous", "Use them on the curve", "heal scales too").
`FINAL_FIGHT_LEAD` is now Simple / Standard none, Challenging and Dangerous Elite, Deadly Boss; the new
`EARLIER_FIGHT_LEAD` puts a Strong lead on every earlier fight POINT of a Dangerous objective only (surprise and
reinforcement fights stay Normal, N5; training runs stay all Normal). Weak stays in the catalog and is never placed
here: SF-3 owns it, and its two wiring entries are pending with owner SF-3. Heal keeps scaling with the rank. The
catalog stays version 1 (no ranked run had reached players). `groundFight.ts taskFightGuard` is the guard a task fight
fields (resolveTaskFightOnSeed calls it); the wiring probe `content:enemyRank:<rank>:<hp|power>` reads the lead's HP and
power on a real fight at the point the placement leads with that rank (Strong on a Dangerous earlier point, Elite on
a Challenging final, Boss on a Deadly final, Normal on a Simple final), ranked run vs the flag off, linearRelative
(HP within one rounding step): 8 live entries plus 2 pending. Every golden unchanged (flagged runs only). Re-measured
(same scratch method, out of 256, unranked to ranked): Simple / Standard unchanged; Challenging one team rank 3 (High)
184 to 106, rank 6 (Low) 19 to 4; Dangerous both teams rank 3 (Low) 53 to 5, rank 6 (Low) 243 to 108, both rank 3
(High) 255 to 133, both rank 6 (High) 256 to 255; Deadly both rank 3 (High) 256 to 242.

#### FKR-2: Kit catalog, condition lines and severity ranks (pure; no engine change)

**Files:** new `src/lib/game/fieldKits.ts` + `fieldKits.test.ts`; `salts.test.ts` (register the module).
**Behavior:** the six kits with categories and gates (First Aid untrained 0.5 / trained 1.25 by import from gambit.ts;
Splint, Trauma Kit, Injury Kit need Medical Training); `CONDITION_LINES` and `severityOf(status)`; `treatsUpTo(kit)`
per the group 5 coverage (Splint: Fracture, and a "light" Broken Bone per open call N8; Trauma Kit: rank 2 of every
line + Concussion; Shattered Bone: none, bay only); `BASIC_DEBUFFS` (what Cure and First Aid clear: Bleed, Blindness,
Weakened, Suppressed, Corroded, Poison for Cure only, plus stun and fear as today [PROVISIONAL]); `freeBasicSet(crew)`
on a D23 curve via `diminishing.ts` (open call N12); `fieldDevicePercent(seed, key)` = 50 + `nextInt(26)` on
FIELD_DEVICE_SALT; `fieldDeviceEffectiveness(percent, codebreakerAboard)` (x1.06); `saboteurGrenadeMult(thrower)`
(own throws only, no stacking). **Tests:** each gate, each `treatsUpTo`, the device roll integer in [50, 75] and both
ends reached, Codebreaker 53 to 79.5, the curve concave and uncapped. **Save / UI:** none.
Commit `feat(0.14.0): field kit catalog, condition lines and severity ranks (FKR-2)`.

**FKR-2 carry (2026-10-17, done):** committed as `feat(0.14.0): field kit catalog, severity ranks and category rules
(FKR-2)`. New pure `src/lib/game/fieldKits.ts` (nothing reads it yet; no engine, save or UI change) + `fieldKits.test.ts`
(33 tests). Catalog `FIELD_KITS`: First Aid Kit (First Aid; clears Bleed, Blindness, Weakened, Suppressed, Corroded,
plus Stun and Fear; heal `FIRST_AID_HEAL`), Antitoxin (First Aid; Poison), Combat Stim (First Aid; Inspired 2 rounds),
Splint (Advanced Medical; bone line up to rank 2, mode splint), Trauma Kit (Advanced Medical; Hemorrhage, Neurotoxin,
Concussion, bone up to rank 2, mode clear), Injury Kit (Advanced Medical; `treatmentShare` 0.5, open call 2's
proposal). `KIT_CATEGORY_RULES`: First Aid 0.5 / 1.25 imported from gambit.ts; Advanced Medical gated by Medical
Training (0 untrained, 1 trained); Explosives and Field Devices 1 for anyone. Helpers: `canUseKit`, `kitEffectiveness`
(careMult multiplies, as Use Item does), `kitClears`, `treatsUpTo`, `kitTreatment` (clear / heal in
`SPLINT_HEAL_ROUNDS` 3 / downgrade; null when the kit does not treat it, so FKR-6's rule does not fire), `severityOf`,
`CONDITION_LINES.bone` = Fracture, Broken Bone, Shattered Bone (no kit reaches rank 3), `BASIC_DEBUFFS` (Cure's list:
the First Aid list plus Poison). Free basic set: `FREE_BASIC_SET` { firstAidKit: base 1, crew curve },
`freeBasicSet(supportHeads)` = base + round(diminishing(heads / 8, knee 4)) per member per objective, whole, monotone,
uncapped (`freeBasicCrewCurve` is the unrounded curve). Device roll: `FIELD_DEVICE_SALT` 0x3a9d5c27 (registered in
salts.test.ts), `fieldDevicePercent(seed, key)` = 50 + nextInt(26), `fieldDeviceRollEffectiveness(percent,
codebreakerIsAboard)` x1.06 (53 to 79.5%), `codebreakerAboard(roster)` over Security and Science. Saboteur:
`isSaboteur(member)` and `saboteurGrenadeMult(throwerIsSaboteur)` x1.06 own throws only. `FIELD_KITS_CATALOG_VERSION`
1 (listed in UNREAD_CONSTANTS for FKR-7). Naming: the roll helper is `fieldDeviceRollEffectiveness`, not the plan's
`fieldDeviceEffectiveness`, so it never collides with expedition.ts's (FKR-8 retires that one); `saboteurGrenadeMult`
takes a boolean because `GroundCombatant` carries no traits (FKR-5 stamps the flag). The seven new conditions are a
local `FieldKitStatusId` union until FKR-4 folds them into `GambitStatusId`. Wiring: catalogs `FIELD_KITS` (6),
`KIT_CATEGORY_RULES` (4), `CONDITION_LINES` (3) and `FREE_BASIC_SET` (1) enumerated in `catalogs.ts` and added to
`CATALOGS`, plus the audit row `away:audit:fieldKitsCure`: 15 entries, all pending (kits and the First Aid / Advanced
Medical rules FKR-6, the Injury Kit FKR-6 + FKR-7, explosives / Saboteur FKR-5, field devices / Codebreaker FKR-8, the
bone ranks and Cure FKR-4, the free basic set FKR-7). **Confirmed by the user (2026-10-17):** N8 a Splint turns a
Broken Bone into a Fracture (and sets a Fracture to heal in 3 rounds); N9 bone is the only line; N10 bones start as
Fracture and worsen on repeat hits; N11 bay times 30 minutes / 1 hour / 2 hours (FKR-4); N12 1 First Aid Kit per member
plus the crew curve, per objective and trip; Stun and Fear are basic debuffs (First Aid Kit and Cure clear them); the
Injury Kit share 0.5. **[PROPOSAL]:** the crew curve's numbers (8 heads per kit at the start, knee 4 kits: 8 heads add
1, 16 add 2, 32 add 3, 80 add 6), never named by the user. N13, N14 and N16 belong to FKR-3 / FKR-4 / FKR-7.

**FKR-2 follow-up (2026-10-17, done):** review markings and minors. Settled [PROVISIONAL] marks removed from
`fieldKits.ts`; the crew curve's 8 / 4 marked [PROPOSAL]. Pinned: `freeBasicCrewCurve(8)` about 0.899,
`freeBasicFirstAid(8 / 16 / 32)` = 2 / 3 / 4. The device roll is keyed by the engine convention, `fieldDeviceSeed` =
`(seed ^ FIELD_DEVICE_SALT ^ Math.imul(key + 1, 0x9e3779b9)) >>> 0` (as shipScanEvents.ts / affixes.ts / groundOps.ts),
re-pinned (`fieldDevicePercent(424242, 0..7)` = 68 59 53 62 61 61 70 51). Fleet Triage's careMult now scales First Aid
kits only (plan FK-1 "Fleet Triage multiplies first aid as today"; design 373 "strengthens in-battle squad healing and
cures" could reach Advanced Medical: a [PROPOSAL] for the user, not built). `KitCategoryRule.specialistBonus` carries
Saboteur's and Codebreaker's 0.06 so the registry reads every magnitude from the catalog; Combat Stim's entry is a
buff (equals, its Inspired rounds), the Injury Kit's a divisor, the rest conditions treated (clears plus line ranks
reached). `kitTreatment`'s comment sits above the function. 39 tests.

#### FKR-3: Kit items, blueprints, the Fabricator group, glyphs (data)

As FK-2 (section 4) with: glyphs also for Broken Bone and Shattered Bone and the five rank chips (Weak to Boss), all
in `icons.ts` + `ICON_SEMANTICS`, reviewed at 16 / 28 / 56 px; recipes still [PROVISIONAL] (carried open call 3);
the Quartermaster price list `FIELD_KIT_PRICES` as data (about 3x crafting material value: First Aid Kit 60, Combat
Stim 150 [PROVISIONAL], open call N13). No reader yet, so the price entries are registered `pending` (owner FKR-7).
Commit `feat(0.14.0): field kit items, blueprints and glyphs (FKR-3)`.

**FKR-3 carry (2026-10-17, done):** committed as `feat(0.14.0): field kit items, blueprints and glyphs (FKR-3)`. Data
plus small UI hooks; no engine, save or battle change (no kit is usable in battle yet). `model.ts`: ItemCategory gains
`fieldKit`; six ITEMS rows keyed by the kit ids (`firstAidKit`, `antitoxin`, `combatStim`, `splint`, `traumaKit`,
`injuryKit`), labels from `FIELD_KITS`, warehouse tier 1, hint "Crafted at the Fabricator after research.", not
sellable; six MATERIAL blueprints per call 3 ("Two research tiers"): tier 1 (60 ticks, 700 credits, craft 120)
First Aid Kit (1 Purified Biomass + 1 Polysilicate Wafer makes 2), Antitoxin (1 Purified Biomass + 1 Volatile Resin
makes 2), Splint (1 Titanium Ingot + 1 Fibrous Biomass makes 2); tier 2 (120 ticks, 1600 credits, craft 300) Combat
Stim (1 Volatile Resin + 1 Purified Biomass makes 2), Trauma Kit (2 Purified Biomass + 1 Exotic Spore Cluster + 1
Polysilicate Wafer makes 1), Injury Kit (2 Purified Biomass + 1 Polysilicate Wafer + 1 Power Coupling makes 1).
`fieldKits.ts`: `FIELD_KIT_BLUEPRINT`, `FIELD_KIT_PRICE_MULTIPLE` 3 (N13), `FIELD_KIT_PRICE_STEP` 5,
`FIELD_KIT_MATERIAL_WORTH` [PROPOSAL: no material value table existed; refined Tier 1 = 20 and Volatile Resin = 80 are
anchored on the user's examples, Fibrous Biomass 20 / 6 by its refine ratio, Power Coupling 80 by its 4 wafers,
Exotic Spore Cluster 160], `fieldKitMaterialValue`, `FIELD_KIT_PRICES` [PROVISIONAL]: First Aid Kit 60, Antitoxin
150, Combat Stim 150, Splint 35, Trauma Kit 660, Injury Kit 420 (Antitoxin shares the Stim's recipe, so its price).
UI: `awayGearDisplay.ts` `isFieldKitBlueprint`, `fabricatorGroupOf`, `fabricateKeyGroups` (the Fabricator's
"Field Kits" group, last) and `researchSectionOf` (a trailing "Field Kits" Research section); App.svelte delegates
to them, the Research card and the offline "Materials banked" row show the kit glyph. Glyphs (icons.ts +
ICON_SEMANTICS, reviewed at 16 / 28 / 56 px light and dark): `kitFirstAid`, `kitAntitoxin`, `kitCombatStim`,
`kitSplint`, `kitTrauma`, `kitInjury` (subject); `boneFracture`, `boneBroken`, `boneShattered` (alert; a diagonal
bone, whole with a crack / two pieces / two stubs with splinters, redrawn after a vertical bone read as an hourglass
at 16 px) and `rankWeak` .. `rankBoss` (alert; a hexagonal chip with a down chevron, a level bar, one and two up
chevrons, a crown). `src/lib/ui/fieldKitIcons.ts` maps kits, bone ranks and enemy ranks to them (nothing renders
the bone or rank chips yet: FKR-9 / FKR-10). Wiring: `facility:BLUEPRINTS:<kitBp>:craft` x6 LIVE (probe
`content:craft:<bp>`, one craft deposits outputQty kits, equals), `facility:FIELD_KIT_PRICES:<kit>` x6 pending (owner
FKR-7), `FIELD_KIT_PRICES` in UNREAD_CONSTANTS; the six `facility:BLUEPRINTS:<kitBp>` research entries come from
the catalog walk; the kits' battle entries stay pending (FKR-6). Calls 16 (kits ignore quality) and 17 (returning
kits may exceed the cap) are FKR-6 / FKR-7's to honor; the craft deposits into a quality bucket like any material.
Tests: `fieldKitItems.test.ts` (16), `fieldKitIcons.test.ts` (5), 5 new in `awayGearDisplay.test.ts`, the ITEMS count
in `model.test.ts` 25 to 31.

#### FKR-4: Conditions and inflictors (engine, behind flag 2)

**Files:** as FK-4 (`model.ts`, `gambit.ts`, `groundFight.ts` `withFieldKitsGuard`, `groundThreat.ts`, `medicalBay.ts`
gains `brokenBone` and `shatteredBone` rows [PROVISIONAL bay times, open call N11]), `fieldKitsConditions.test.ts`.
**Behavior:** the seven statuses at the FK13 numbers; the bone line WORSENS (a bone hit on a member already holding a
bone condition raises it one rank; open call N10 for whether enemy rank sets the starting rank); Fracture x0.8, Broken
Bone x0.7, Shattered Bone x0.6 power and accuracy [PROPOSAL, "worse at higher ranks"]; inflictors per FK7 stamped
post-generation (no generation draw), a heavy hit = a landed strike of 25% or more of the target's max HP;
Strikers' flash grenade is an enemy action with 1 use per Striker per battle; Casters' Neurotoxin on grade 3
(Challenging) or harder [PROVISIONAL reading of "Hard or harder", open call N14]; Swarm and hostile garrisons Fear;
Cure clears `BASIC_DEBUFFS` only; Cortex Shield's stun resist also resists Concussion; Iron Will and Morale Anchor
read live; Stoneskin battle half (25% more resist, independent chance; ceil(duration x 1.25)); every carried
condition reaches the bay. Reads `fieldKitsLive(exp)`; tests stamp fixtures by hand until FKR-7 stamps at dispatch.
**Determinism:** new rolls only inside flagged fights on the fight's private stream; no generation draw.
**Wiring:** flips `FIELD_KITS_FEAR`, the Cortex resist, `ironWill`, `xo.moraleAnchor`, statuses bleed / fear, the
bay condition rows and Stoneskin's battle half from pending to live, each with a sensitivity check (probes: fight
win rate, a member's bay seconds); removes their `no-dead-stats` entries in the same commit. **Save:** none.
**Staging:** do not deploy between FKR-4 and FKR-7 (flag 2 is not stamped yet; nothing is visible, but the window
is unreviewed as a whole). Commit `feat(0.14.0): Field Kits conditions, severity and enemy inflictors (FKR-4)`.

**FKR-4 carry (2026-10-19, done):** committed as `feat(0.14.0): Field Kits conditions, severity and enemy inflictors
(FKR-4)`. Behind flag 2: `Expedition.fieldKits: { catalog }` is typed here and read ONLY through `fieldKits.ts
fieldKitsLive`; FKR-7 stamps it, so no player run moves yet (tests stamp it by hand). `model.ts`: GambitStatusId gains
the seven conditions, GambitActionId the enemy-only `flashGrenade`. `gambit.ts`: rows at FK13 (Hemorrhage 12 x4,
Neurotoxin 5 x4 plus `NEUROTOXIN_TURN_LOSS` 0.25, Concussion 0.35 x3, Blindness x0.25 for 2 or 3 rounds rolled on the
fight stream, Fracture x0.8 and [PROPOSAL] Broken Bone x0.7, Shattered Bone x0.6 on power AND accuracy;
`BONE_CONDITION_ROUNDS` 10000 so a bone condition rides every fight's carry until treated or bayed); `BONE_LINE` +
`applyBoneHit` (a bone hit starts at Fracture and worsens one rank, N10); `turnLossPermille` (independent chances, one
draw only while one is held); `BASIC_DEBUFFS` now lives here (fieldKits.ts re-exports it, `CONDITION_LINES` reads
`BONE_LINE`) and Cure and the team kit's Use Item never touch a SERIOUS condition (`isSeriousCondition`: every debuff
before Field Kits is basic, so old fights cure exactly as before; an any-debuff Cure or Use Item looks past an ally whose
only debuffs are serious, so a fractured squadmate never blocks the medic); `statusResistPermille` (FK6: a stun resist covers
Concussion, `RESIST_ALSO_FROM`; D24: Stoneskin folds `STONESKIN_BATTLE_RESIST` 0.25 into a physical status's roll, a
physical status being the bay's injury class, and one that lands lasts ceil(x1.25)). New `fieldKitsConditions.ts`
stamps the inflictors post-generation, after ranks, no draw: Bruisers `heavyHit` (`HEAVY_HIT_FRACTION` 0.25: Fracture
and Concussion, both through the resist roll), Strikers `executeAfflicts` Hemorrhage (a landed low-HP Execute on a
target still standing) and one flash grenade (`FLASH_GRENADE_RULE` leads their program, target foeHighestThreat
[PROPOSAL]), Casters' Poison becomes Neurotoxin from grade 3 (N14), Swarm and every hostile-site enemy Fear on a
landed attack (`FEAR_ON_HIT_PERMILLE` 200 [PROVISIONAL]); `withFieldKitsTeam` stamps Stoneskin on Ossir members.
`groundFight.ts` (two one-line calls: taskFightTeam, taskFightGuard; TaskFightExp gains `fieldKits`),
`groundThreat.ts` (the key appends `["fieldKits", catalog, grade]` on a flagged run only), `medicalBay.ts`
(`brokenBone` 3600 s, `shatteredBone` 7200 s, N11). UI: the editor's status picker hides the seven conditions until
FKR-10; ACTION_LABEL / the log verb name the flash grenade. Wiring: LIVE now: Morale Anchor (`runSecFearResist`), Iron
Will (`secFearResist`), Cortex Shield's resist line (`secConcussionResist`), GAMBIT_STATUSES fear and the seven,
GAMBIT_ACTIONS flashGrenade, every GROUND_CONDITIONS row but Bleed, CONDITION_LINES x3 (`content:bone`), the new
`away:MEMBER_PERKS:stoneskin:battle` (`runSecStoneskinResist`) and `away:audit:fieldKitsCure` (`content:fieldKitsCure`);
the Stoneskin bay entry keeps only OC-G1's legacy context pending; the liveness testkit gains a "field kits fights"
probe so no-dead-stats sees Morale Anchor and Cortex Shield live (their allow-list reasons are gone). STILL PENDING:
the Bleed status and its bay row (owner: a user call, FK7 names no enemy that inflicts Bleed). Goldens: every FK-3,
FKR-0, SF-0, G2-0 and later hash unchanged (no new golden commit: FKR-0 already pins the flag-less runs). Tests:
`fieldKitsConditions.test.ts` (26, incl. a stamped Deadly run's parity); `medicalBay.test.ts` and
`wiring.liveness.test.ts` updated for the two bay rows and the two flipped liveness entries. Observation for the balance pass: against a
strong squad on a calm body a Bruiser rarely reaches the heavy-hit line (a quarter of a member's max HP); hazardous
bodies and Elite or Boss leads do.
**FKR-4 review rulings (user 2026-10-19).** Bleed: a Striker's landed NORMAL hit (an attack, or an Execute on a target
not yet wounded) may inflict Bleed (`normalHitAfflicts`, `BLEED_ON_HIT_PERMILLE` 150 [PROVISIONAL: the user named the
inflictor, not the chance], one chance roll then the resist roll on the fight stream, the Fear style); Hemorrhage
stays the low-HP Execute's. The Bleed status and its bay row are LIVE (nothing pending in the bay rows now).
`FEAR_ON_HIT_PERMILLE` 200 ("20% per landed hit") and `FLASH_GRENADE_RULE` foeHighestThreat ("Squad's biggest
threat") are user-confirmed.

#### FKR-5: Tool charges, the carry capacity line, the grenade family (data + engine, behind flag 2)

**Files:** `model.ts` (`charges` on the grenade varieties; new variety `impactGrenade` with its blueprint and
research row; affix stat `toolCarryCapacity` in the three grenade pools; ITEM/blueprint drift guards),
`gambit.ts` (`throwGrenade` action: AoE on the target's group [PROVISIONAL, open call N6], damage + the variety's
debuff chance, Saboteur x1.06 on the thrower's own throw; `BattleState.charges` per member and a per-battle use
counter), `awayTeam.ts` (`toolCharges(member)` = base + carry lines), `fieldKitsCharges.test.ts`.
**Behavior:** on stamped runs a grenade is THROWN by a gambit rule and spends a charge (no longer a passive on-hit
on every strike [PROPOSAL, open call N7]); 1 throw per battle per grenade; a rule whose actor has no charge left or
has spent its per-battle throw does not fire; the Med Kit, Shroud Emitter and Lure Beacon carry no charges
[PROPOSAL, open call N4]. Unstamped runs keep today's passive on-hit exactly. **Wear:** charges are never reduced by
wear and a throw is not a wear source (tools wear by fieldwork only); if gear wear's member-tool efficiency has
landed, it scales the grenade's damage and debuff chance, never its charges; training runs apply no wear (W9).
**Determinism:** the AoE rolls one hit check per target in target order on the fight stream, flagged runs only; the
new affix line changes NEW grenade crafts only (existing instances keep their lines): FKR-0 (4) moves and is named.
**Wiring:** entries for the carry line (gate curve: charges +1), each grenade's damage and debuff chance, Saboteur's
grenade bonus (OC-F4's grenade half), each live with a sensitivity check. **Save:** optional fields; none.
Commit `feat(0.14.0): grenade charges, carry capacity and the Impact Grenade (FKR-5)`.

**FKR-5 carry (2026-10-19, done):** committed as `feat(0.14.0): grenade charges, carry capacity and the Impact Grenade
(FKR-5)`. Behind flag 2 (read only through `fieldKitsLive`; FKR-7 stamps it), so no flag-less run moves. `model.ts`:
`MemberVarietyTraits.grenade` (`GrenadeTraits`: `charges { perObjective, perBattle }`, `powerMult`, `status`, optional
fixed `statusChance`; the plan's `ToolVariety.charges` lives here) on the three grenades at N4 / N6 (Impact 4, Stun 2,
Toxin 2, 1 throw per battle; Impact x1.5 group blast, 30% Concussion); the new **Impact Grenade** variety (Security
tool, NO passive groundEffect, implicit groundPower, affixes groundAccuracy + carry) and `impactGrenadeBp` (tier 1, 60
ticks, 700 credits, craft 150, `IMPACT_GRENADE_RECIPE` (user 2026-10-20 "Approve") 1 Titanium Ingot + 1 Polysilicate Wafer + 1 Power
Coupling); the carry line is `groundCarryCapacity` (not the plan's `toolCarryCapacity`: every ground key carries the
`ground` prefix, member-gear.test.ts), in all three grenade pools (weight 1, variety share 0.15 [PROPOSAL], other
shares lowered to keep each sum 1), minted as `GRENADE_CARRY_PER_LINE` (1) whatever the budget (itemgen.ts
`rolledLineValue`); `GambitActionId` gains `throwGrenade`; `GroundFightRecord.chargesUsed?` and
`SnapshotGearPiece.carry?` (both written only when nonzero). `awayTeam.ts`: `pieceCarryLines`, `pieceToolCharges`,
`memberGrenade`, `toolCharges(member)` (base + carry lines; 0 for the Med Kit, Shroud, Lure); the carry line never
counts toward a piece's effect points. New `fieldKitsGrenades.ts`: `GRENADES` / `GRENADE_IDS` (read from the
varieties), `withThrownGrenades` (a Field Kits fight's squad: the grenade's passive on-hit comes off, a Shock Baton's
stays; each grenadier is armed with its throw, charges = `GroundFightTeam.charges[member]` else full, Saboteur x1.06 on
its own blast AND debuff chance), `chargesLeftFor`, `passiveInflictStatuses`. `gambit.ts`: `GroundCombatant.grenade`
(`ThrownGrenade`), `canThrowGrenade`, `memberStatusChance` (extracted, byte-identical), `throwGrenade` legal for
Security; it fires only with a charge and a throw left (FK11 "skip it": the next rule acts) and blasts the target plus
every standing foe of its group in id order: per body a hit check (`strikeHitChance`, the flash grenade's), the damage
roll at `powerMult`, then on a standing body the debuff chance roll and the resist roll, all on the fight stream;
`GroundBattleResult.chargesUsed`. Stun / Toxin blasts are `SPECIALIZED_GRENADE_POWER_MULT` 0.5 (user 2026-10-20 "Half
damage") and their debuff lands at the thrower's status chance [PROPOSAL: the
status-chance rule, so their groundStatusChance line keeps its meaning]. `groundFight.ts`: `GroundFightTeam.charges?`
(FKR-7 passes `GroundTeamRun.charges`), the arming beside FKR-4's Stoneskin, the record's `chargesUsed`.
`groundThreat.ts`: the Field Kits key tag appends each team's charges (unflagged keys unchanged). UI: ACTION_LABEL
"Throw Grenade" (not offered in the editor until FKR-10), the log verb, the tooltip's "Carry Capacity" (+1). No wear
(gear wear has not landed: a throw is never a wear source, charges never wear). **Not done here, on purpose:** the
default program's throw (N15, needs FKR-6's Boss reserve), so a stamped run on the default program arms grenades but
throws none; the per-objective charge bookkeeping across fights (FKR-7 writes `GroundTeamRun.charges`, subtracts
`chargesUsed`; until then every fight starts full); the threat sample threading charges between its fights (FKR-6).
Wiring: LIVE `gear:security:impactGrenade:{groundPower,groundAccuracy,groundCarryCapacity}` and the carry line on Stun
and Toxin (probe `runSecGrenadeCharges`, gate +1), `away:GRENADES:<grenade>:{charges,perBattle,blast,status}` x3
(content `grenade` probes on an armed reference thrower), `away:GAMBIT_ACTIONS:throwGrenade`, `facility:BLUEPRINTS:
impactGrenadeBp`, and `away:KIT_CATEGORY_RULES:explosives` flipped pending -> live (probe `runSecGrenadePower`,
Saboteur's x1.06); `GRENADES` joins CATALOGS, CONTENT_CATALOGS and the catalog walk; `GRENADE_IDS` in UNREAD_CONSTANTS;
liveness counts gear 99 -> 104 (the five new lines, all live; the field kits fights probe also fingerprints the armed
squad). Goldens: **MOVED, named:** FKR-0 (4) `craftedRolls` (four of six pieces: Stun seeds 3 and 27, Toxin 2 and 27;
the pool gained the carry line) with a proof test that the FKR-0 pools reproduce the FKR-0 hashes exactly. Held apart
(no pin moved): G1-0 golden 5's base registry pin (FKR-5's 19 added ids and its one flip read back, still 1181 /
74fa057) and the Prospecting hidden `wearers` pin (the Impact Grenade checked to read like its siblings). Every FK-3,
FKR-0 whole-run, SF-0, G2-0 and later hash unchanged. Tests: `fieldKitsCharges.test.ts` (23, incl. a stamped throwing
run's parity one call == 997 s == 1 s).

#### FKR-6: Kits in battle, rank conditions and reserves (engine, behind flag 2)

**Files:** as FK-5 (`gambit.ts`, `groundFight.ts`, `groundThreat.ts`), plus `GambitRuleParams.minRank` /
`reserveForBoss`, `fieldKitsBattle.test.ts`.
**Behavior:** a `useItem` rule names a kit; the actor spends from ITS OWN carried kits, free basics first, then
extras [PROPOSAL]; it fires only when the actor can use the kit, has one left, and the target needs it (a condition
the kit `treatsUpTo`, a downed ally for the Injury Kit via `allyDowned`). Rank conditions: `minRank: "elite"`
("target is Elite or stronger") and `minRank: "boss"` ("target is a Boss") gate any rule on its resolved target.
Reserve: `reserveForBoss: N` lets the rule fire on a non-Boss target only while the actor holds MORE than N of what
the rule spends (charges or that kit); on a Boss it spends freely. A rule that needs an unavailable charge or kit, a
spent per-battle use, or a reserve it would break does not fire; the next rule acts. Old kit-less `useItem` rules
follow carried open call 15 [PROVISIONAL: First Aid Kit]. Default program per open call N15. Splint on a Broken Bone
per open call N8. Threat odds simulate with the team's current kits and charges (FK12).
**Determinism:** no new draws. A stamped fight with no kits, no charges and no new rules equals the FKR-5 fight.
**Wiring:** each kit's effect (First Aid heal and clears, Antitoxin, Splint, Trauma Kit, Combat Stim / Inspired, the
Injury Kit `treatmentShare`) live with a sensitivity check; the gambit status picker row (FK-9 + WR-10) moves to
partial or live as its statuses become reachable. **Save:** none.
Commit `feat(0.14.0): kits in battle, rank conditions and Boss reserves (FKR-6)`.

**FKR-6 carry (2026-10-20, done):** goldens first (`fieldKitsBattleGoldens.test.ts`, FKR-5's stamped fights on
e1d6d06), then `feat(0.14.0): kits in battle, rank conditions and Boss reserves (FKR-6)`. Behind flag 2 only; every
flag-less golden unchanged. New pure `fieldKitsBattle.ts`: `FIELD_KITS_BATTLE` (the kit rules, injected into
`resolveGroundBattle` because fieldKits.ts imports gambit.ts), `kitUsable` / `applyKit` (First Aid Kit and Antitoxin at
the first aid cut, the heal riding the cleanse; Combat Stim Inspired 2 rounds x effectiveness, at least 1;
Splint heals a Fracture in 3 rounds or turns a Broken Bone into a Fracture; Trauma Kit clears its list in one use;
Injury Kit on a DOWNED ally once per battle, its 0.5 share on the record), `withFieldKitPacks` (every fielded member
carries `GroundFightTeam.basics` + `.kits`, absent = none), `withFieldKitsDefaultProgram`, `fightSuppliesAfter`
(charges, basics and extras left after a fight: the threat samples use it now, FKR-7's `finishFight` should too),
`LEGACY_USE_ITEM_KIT` (call 15). `gambit.ts`: `GroundCombatant.kits` / `.injuryTreated`, `spendKit` (a free basic
first, then an extra), selector `allyDowned` (fires only as a Field Kits Use Item), `kitFires` (the kit
gate, the need, the look-past), rank conditions `params.minRank` on the resolved target (read on EVERY run: an unranked
foe and an ally read Normal; no stored program carries one), `params.reserveForBoss` (`breaksReserve`: a foe target
lifts it when it is a Boss; a kit's ally target while a Boss stands among the foes), `GroundBattleResult` /
`GroundFightRecord` `basicsUsed` / `kitsUsed` / `treated`; Triage's explicit kit rules wait behind
`FIELD_KITS_PLAYER_LIVE`. `model.ts`: `FIELD_KITS_DEFAULT_GRENADE_RULES` (N15's "largest
group, keep 1 for a Boss" plus "throw the kept one at an Elite or a Boss") and `FIELD_KITS_DEFAULT_MEMBER_GAMBIT` (swapped in on a Field Kits
fight for a member whose program IS D19's default; still no Use Item). `groundFight.ts memberEndConditions`: a
splinted Fracture is no bay condition (call 18). `groundThreat.ts`: the samples spend supplies fight by fight and the
Field Kits key lists each team's basics and kits (FK12). `memberGambits.ts gambitRuleEquals` reads the three new
params. Editor: `SELECTOR_LABEL.allyDowned` only (not offered until FKR-10). Wiring: `away:FIELD_KITS:<kit>` x6 and
`away:KIT_CATEGORY_RULES:{firstAid,advancedMedical}` LIVE (probes `content:kit:*`, `content:kitCategory:*`; the
Injury Kit through the bay divisor), new LIVE `away:GAMBIT_SELECTORS:allyDowned`, `away:GAMBIT_PROGRAMS:{minRank:elite,
minRank:boss,reserveForBoss,fieldKitsDefault}`. Goldens MOVED, named: G1-0 golden 5 `registry` 1201 e6523a6f -> 1206
120f6d8b (FKR6_SLICE reproduces e6523a6f); the stamped `default` and `triage` pins (N15, call 15); FKR-5's "default
program throws none" test now expects the throw. **For FKR-7:** pass `GroundTeamRun.basics` / `.kits` / `.charges`
through the fight's team, subtract the record's spends with `fightSuppliesAfter`, sum `treated` into
`GroundTeamRun.treatment` and the bay's `treatmentShare`; FKR-10 shows the Field Kits default in the editor.
**FKR-6 review rulings (user 2026-10-20, merge-batch answers "Spacer bonus, FKR-6 and G1-3 picks"):** "Save for
Elite or Boss": the default's kept grenade goes on an Elite or a Boss (`minRank: "elite"`; the stamped `default` pin
did not move). "Approve all": basics before extras, Combat Stim rounds scale with skill (min 1), "on a Boss" = while a
Boss stands, one Injury Kit per downed member per battle, Triage's kit rules as built (tags dropped). Hardening:
`enemyRanks.ts rankAtLeast` never throws on an unknown rank or condition from a stored save (never met / reads Normal).

#### FKR-7: Run plumbing: flag 2, per-member packs, per-objective refresh, stock, Quartermaster (engine)

**Files:** `expedition.ts` (stamp `fieldKits`; deduct packs at dispatch; return at claim), `groundOps.ts`
(`snapshotGroundOps` writes `kits` per member; at each objective start set `basics` to `freeBasicSet` per member and
`charges` to full; `finishFight` subtracts `kitsUsed` / `basicsUsed` / `chargesUsed` per member and merges `treated`;
the bay reads `treatment`; `healTeam` clears it), `armory.ts` (`SquadLoadoutKit.consumables` written and applied as
the member's pack), `groundTeams.ts` (`ShipGroundTeam.packs` / `topUp`, `defaultPack(state, ship, member)` per open
call N16), `quartermaster.ts` (`buyFieldKits(state, kit, qty)` and `topUpAtLaunch(state, ship, team)`: buys only the
shortfall against each member's pack, never blocks a launch, buys what credits allow [PROPOSAL]), `fieldKitsRun.test.ts`, `groundOpsParity.test.ts` additions.
**Behavior:** stock leaves inventory at dispatch (lowest quality first), unused extras come home at claim (carried
open call 17 for the cap); basics never come home (they refresh); a Survey team packs nothing; joint crews need no
pooling (each member carries their own). Free basics refresh at each objective start and at each trip's reload step
[PROPOSAL, open call N12]. Training run: packs, basics and charges as normal; no wear.
**Determinism:** stored counts only; no draws. **Goldens:** FK-3 and FKR-0 hashes strip the flag and the new team
fields; the claim hashes cover the whole state, so `ShipGroundTeam.packs` / `topUp` and any credits spent are
stripped in the state twin (FK-3 carry note), never re-captured. **Tests:** dispatch deducts exactly the packs;
top-up off by default buys nothing; on, it buys the shortfall and charges the listed price; spent kits never return;
basics and charges reset each objective; parity one call == 997 s == 1 s with packs, a Reinforcing alert and a joint
crew; an Injury Kit shortens only that member's bay time. **Wiring:** `FIELD_KIT_PRICES` and the free-basics curve
flip live. **Save:** optional fields; none.
**Hidden pieces (user 2026-10-20 "Hide until kits are live"):** flip `model.ts` `FIELD_KITS_PLAYER_LIVE` to true. That
merges `FIELD_KITS_HIDDEN_BLUEPRINTS` (the Impact Grenade blueprint) into `BLUEPRINTS` (Research, Fabricator, Archive)
and gives new Stun and Toxin crafts the +1 Carry Capacity line (`GRENADE_CRAFT_POOLS.carry`); FKR-0 (4) `craftedRolls`
then reads FKR-5's capture, the G1-0 `registry` pin moves (the three hidden FKR-5 entries return), and the
`away:audit:fieldKitsHiddenPieces` row closes.
Commit `feat(0.14.0): per-member packs, per-objective supplies and Quartermaster kits (FKR-7)`.

#### FKR-8: Field devices roll per use (engine)

As FK-7 (section 4) with the Codebreaker answer built (+6% on the roll, anyone on the expedition) and no device
charges (open call N4). Flips `FIELD_DEVICE_TRAINED_EFFECTIVENESS` and the device effectiveness knob live (WR row 390,
434). Commit `feat(0.14.0): field devices roll 50 to 75% per use (FKR-8)`.

#### FKR-9: Dispatch packing per member and run readouts (UI) **[NEEDS A NEW USER MOCKUP SIGN-OFF]**

FK-M4's per-ship Squad Kit is obsolete (packs are per member, charges per tool, ranks on fights). Sketch FIRST and get
the user's sign-off (feedback "visual UI needs mockup"): per team, per member rows (portrait, installed tool with its
charges "Impact Grenade 4 (5 with carry)", the free basic set, extras with steppers and "in stock", "Needs Medical
Training" hints), the team's "Top up from the Quartermaster at launch" toggle (off) with its cost preview, rank chips
on fight readouts and the timeline ("Final fight: Elite Bruiser"), conditions with severity names and bay times.
**Files:** `ExpeditionPanel.svelte`, `expeditionDispatchDisplay.ts`, App.svelte `doSetMemberPack`, `doSetTeamTopUp`,
the GO-14 timeline / bay card. **Tests:** display helpers; preview at 1280 and 375 px, light and dark, keyboard path,
console clean; a `<select>` never acts on change.

#### FKR-10: Gambit editor, Logistics stock, Quartermaster sales, Squad Loadouts row (UI)

**Files:** `GambitEditorPanel.svelte` + `gambitEditorDisplay.ts` (kit picker; Throw Grenade; "Ally downed"; the rank
conditions "Target is Elite or stronger" / "Target is a Boss"; a "Keep N for a Boss" stepper; the new statuses with
severity; hints "Fires only for a member with Medical Training", "Skips when no charge is left"); App.svelte Logistics
(Field Kits stock view, carried open call 14); the Quartermaster kit sale rows (existing sell / requisition list
pattern); the Squad Loadouts per-member pack row (rides the GO-17 sketch). **Mockup:** the reserve stepper and rank
conditions go into FKR-9's sketch; the rest reuse existing patterns. **Tests:** as FKR-9; `SELECTOR_LABEL` /
`ACTION_LABEL` exhaustiveness.

#### FKR-11: Help, wiring and no-dead-stats close-out, QA sheet

As FK-10 (section 4), plus Help lines for charges and the carry line, enemy ranks (and that training runs field no
Elite or Boss), the Boss reserve, severity ranks, per-member packs and the Quartermaster top-up; `releaseBlockers()`
holds no Field Kits entry; the QA sheet R5 to the user. Commit `docs(0.14.0): Field Kits help and close-out (FKR-11)`.

**Text rules (every slice):** US English; no em dashes and no double hyphen; "install" only; player text says
"objective", never "task"; SVG glyphs only; names beyond the user's (Broken Bone and Shattered Bone are the user's;
rank names are the user's) are [PROPOSAL].

### R4. NEW open calls (multiple-choice ready; Recommended first) + carried calls

- **N1 Rank multipliers (hp / power).** (a) Weak 0.6 / 0.75, Normal 1 / 1, Strong 1.5 / 1.2, Elite 2.5 / 1.5, Boss
  4 / 2 (Rec). (b) One multiplier for all stats: 0.7, 1, 1.3, 1.8, 3. (c) Gentler: Elite 1.8 / 1.3, Boss 2.5 / 1.6.
- **N2 Elite vs Boss by objective.** (a) Final fight lead: Challenging Strong, Dangerous Elite, Deadly Boss (Rec).
  (b) Elite from Challenging, Boss from Dangerous. (c) By site: Vaults, Subterranean sites and fortifications hold a
  Boss, others an Elite from Dangerous.
- **N3 Where Weak and Strong appear.** (a) Only where N2 puts them; everyone else Normal (Rec). (b) Swarm bodies are
  Weak on Simple objectives. (c) The lead of every non-final fight on Dangerous+ is Strong.
- **N4 Charges per tool.** (a) Impact 4, Stun 2, Toxin 2, 1 throw per battle, carry line +1 on grenades only; Med Kit,
  Shroud and Lure no charges (Rec). (b) Same, plus +1 charge per tool tier ("lower-level kit 3"). (c) Shroud and Lure
  also get charges (a use per scan boundary).
- **N5 Reinforcement rank.** (a) Normal (Rec). (b) Weak. (c) One rank under the fight's lead.
- **N6 Impact Grenade numbers.** (a) AoE on the target's group, 1.5x the thrower's power, 30% Concussion (Rec).
  (b) Every foe at 1x, 25% Weakened. (c) Target 2x, splash 0.5x, 30% Fracture.
- **N7 Grenade on-hit on new runs.** (a) Thrown only, by a rule, spending charges (Rec). (b) Keep passive on-hit too.
- **N8 "Light Broken Bone".** (a) A Splint turns a Broken Bone into a Fracture (Rec). (b) A Splint clears a Broken
  Bone only in a trained hand. (c) A Broken Bone is light in its first 2 rounds.
- **N9 Other severity lines.** (a) Bone only in 0.14.0 (Rec). (b) Also Bleed then Hemorrhage, Poison then Neurotoxin.
- **N10 Bone starting rank.** (a) Always Fracture, worsening on repeat hits (Rec). (b) Elite starts at Broken Bone,
  Boss at Shattered Bone.
- **N11 Bay times.** (a) Fracture 1800 s, Broken Bone 3600 s, Shattered Bone 7200 s (Rec). (b) 1800 / 2700 / 5400.
- **N12 Free basic set.** (a) 1 First Aid Kit per member plus the crew curve, refreshed each objective and each
  reload (Rec). (b) Objective start only. (c) 1 First Aid Kit + 1 Antitoxin.
- **N13 Kit prices.** (a) 3x material value (First Aid 60, Stim 150) (Rec). (b) 2x. (c) Basic kits only.
- **N14 "Hard or harder".** (a) Challenging (grade 3) and up (Rec). (b) Dangerous (4) and up.
- **N15 Default program and grenades.** (a) Default gains "Throw grenade at the largest group, keep 1 for a Boss" (Rec).
  (b) No grenade rule by default (D19 reading).
- **N16 Default member pack.** (a) 1 extra of each kit the member can use, up to stock (Rec). (b) No extras (the
  free basics only). (c) 2 of each.
- **Carried, still unanswered (section 5):** 3 recipes, 14 Logistics home, 15 old Use Item rules, 16 kit quality, 17
  over-cap return, 18 splinted Fracture bay time.

### R5. QA sheet (supersedes section 6; desktop 1280 px and mobile 375 px, light and dark)

- [ ] Fabricator: research and craft each kit and the Impact Grenade; the "Field Kits" group; stock in Logistics.
- [ ] Quartermaster: buy kits for credits; the top-up toggle is off by default; on, launch buys only the shortfall.
- [ ] Dispatch: per-member packs, tool charges with the carry line, "Needs Medical Training" hints; Survey teams none.
- [ ] Every objective: basics refill and charges reset; extras carry on; unused extras come home, spent ones do not.
- [ ] Ranks: harder objectives end with an Elite or Boss; the training run fields neither; threat odds reflect both.
- [ ] Gambits: a rule out of charges, past its per-battle throw, or holding a Boss reserve skips to the next rule.
- [ ] Conditions: each from its enemy, with severity worsening; the right kit clears it; Shattered Bone only in the bay.
- [ ] Cure clears basic debuffs only; Cortex Shield resists Concussion; Fear resisted by Iron Will and Morale Anchor.
- [ ] Field devices: the ship-event odds vary per boundary between 50% and 75% (53% to 79.5% with Codebreaker).
- [ ] An in-flight run dispatched before the update finishes unchanged; no wear on the training run.
- [ ] Help, glyphs at 16 / 28 / 56 px, console clean, no horizontal scroll at 375 px, text rules.

> **[SUPERSEDED IN PART 2026-10-16]** The Goal, Architecture and sections 3 to 6 below predate the reshape (tool charges,
> per-member packs, enemy ranks, two flags). Read REVISED SLICES above first; the text below is kept as history.

**Goal:** Make kits real. Every kit belongs to a category with a skill rule (Medical Training gates Advanced Medical,
anyone throws a grenade, field devices work at a rolled 50% to 75% for the untrained). Real stackable consumables are
crafted at the Fabricator, packed per ground team at dispatch, spent by gambit rules in task fights, and the unused ones
come home. New conditions (Fracture, Hemorrhage, Neurotoxin, Concussion, Blindness) and enemy-inflicted Fear give the
kits something to fix, and the Injury Kit shortens a member's medical bay time.

**Architecture:** Additive and flag-gated, the Ground Operations way. A new optional `Expedition.fieldKits` record
(stamped at dispatch from FK-6 on) is the feature flag: a run without it (every run dispatched before FK-6, legacy and
Ground Ops alike) advances, fights, rolls and claims byte-identically, pinned by golden hashes captured BEFORE the first
engine edit (FK-3). Every new roll comes from a private keyed stream or from the fight's own private stream on flagged
runs only; nothing is added to a shared stream. Kit counts live on the run (`GroundTeamRun.kits`), so the run stays a
pure function of its stored record (offline == live).

**Tech stack:** Svelte 5 (legacy mode) + TypeScript, Vitest. Engine in `src/lib/game/*.ts` (pure), UI in
`src/lib/*.svelte` + `src/App.svelte` handlers.

**Sources (authority order: user decisions > design > code):**
- `docs/plans/2026-10-02-crew-made-real-e-crew-design.md`: D19 (50 to 53), D20 and its two answer blocks (55 to 93),
  D23 (143 to 155), D24 (157 to 172), D25 bay loop (226 to 240), D26 (244 to 259).
- `docs/plans/2026-10-02-crew-made-real-e-crew-plan.md`: Task 16b (549 to 567), Task 16 carry (544 to 545), D20 partial
  carry (412 to 415), Task 14 carry (439 to 440), Task 20 carry (669 to 671), Task 22 carry (839 to 852), Task 22b (856 to 860).
- `docs/plans/2026-10-09-ground-operations-plan.md`: section 1 rows (75, 79 to 81), GO-3 (366 to 393), GO-5 carry (571 to
  579), GO-17 (1760, 1766 to 1814), GO-18 carry (1857 to 1858), Q5 (1909 to 1910), Q6 (2055 to 2057), Q11 (2066 to 2067).
- `docs/plans/2026-10-12-squads-and-subspace-telescope-design.md` (team kinds Ground / Strike / Survey, joint crews).
- `docs/plans/2026-10-14-objective-affixes-capture.md` (Reinforcing, alert escalation, Rocky Outcroppings, catalog gate).
- `docs/plans/2026-09-15-exploration-crew-saga-0.14.0-design.md` 217 to 226 (user, 2026-09-17: grenades and the
  encounter levers are TOOLS in the member Tool slot).
- Field Kits mockup (the 2026-10-09 scratch file `field-kits-mockup.html`; published as artifact VFJ3UZGYmzAgF3tLJ1uxoV),
  sections 1 to 6, referenced as FK-M1..FK-M6.
- Session transcript `98207591-ca65-4871-8a5d-83c699d63043.jsonl`, lines 70901 (answers 1 to 4), 70973 (the question
  answers), 70979 (the per-use correction).

## 0. Standing rules (inherited; apply to every slice)

- **Gate** after every slice: `npm run check` (0 ERRORS; the 2 known RadialWeb warnings are fine) and `npx vitest run`
  (all files pass). A slice is not done until both are green.
- **Flag-neutral:** a run WITHOUT `Expedition.fieldKits` is byte-identical in every reader (fight records, threat odds,
  scan step rolls, bay times, claim). FK-3 captures the goldens before any engine slice; every engine slice keeps them
  green in the same commit.
- **Determinism:** `makeRng((seed ^ SALT ^ key) >>> 0)` only; integer draws (`nextInt`, `chance(permille, 1000)`); never
  `Math.random` or `Date.now()` in engine code; never a new draw on a shared stream. New salts are odd, distinct, exported,
  and their module joins `salts.test.ts` MODULES. Draws added INSIDE a task fight are allowed only on flagged runs (the
  fight stream is private per fight, and the flag keeps old runs on their exact sequence).
- **Mutation pattern:** UI handler `do*` in `src/App.svelte` calls a pure engine fn, then `state = next`, `pushLog`,
  `doSave`, with a same-ref guard.
- **Text rules:** US English; no em dashes and no double hyphen anywhere (text, comments, code: write `i -= 1`);
  "install" is the only verb for putting gear on; player-facing text says "objective", never "task"; graphics are SVG glyphs in
  `src/lib/ui/icons.ts` classified in `src/lib/ui/iconPacks.ts` `ICON_SEMANTICS`, reviewed at 16 / 28 / 56 px, no emoji.
- **Responsive:** one DOM, container queries; 375 px with no horizontal page scroll. A `<select>` never acts on change.
- **[PROVISIONAL]** marks a first-pass value or behavior picked so the build stays green while an open call (section 5)
  waits; each lives in ONE named constant or function. **[PROPOSAL]** marks anything the user has not named or decided.
  Never present either as decided.
- **No dead stats:** the slice that makes a `no-dead-stats.test.ts` entry live removes it in the same commit.
- **Commits:** one per slice (goldens get their own commit first), ending `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>`. Never push the branch; staging is the controller's call. Do not deploy to staging between
  FK-4 and FK-6 (new conditions without kits would be live only if the flag were stamped, and it is not until FK-6).

## 1. Source decisions (verbatim where the user's words exist)

1. **Skills gate kits** (D20, user 2026-10-06, design 56 to 68): "Combat characters should have specific skillsets, and
   certain skillsets should be required. If you have medical experience, certain kits can be used." The skill is
   Medical Training. "Certain types of medical consumables might require proper training, especially with some that can
   cure some things like bone fractures or high-level debuffs." Other debuffs "are easily cured under standard first aid
   training". "a splint might help with a fracture after X amount of ticks", "an injury kit might decrease the time
   spent recovering from an injury when an item is used to cure it".
2. **First aid for anyone** (D20, design 59 to 60): consumables "work for anyone, at reduced effectiveness without
   training" ("Maybe at 50% effectiveness"); training gives "something like a 25% or 50% boost". Built as 0.5x / 1.25x
   (gambit.ts 128 to 129).
3. **Grenades** (D20, design 65; transcript 70901 answer 2): "Pull a pin and toss it." "Explosives kit should be
   available for anyone ... It doesn't take a true amount of skill to use a grenade. But it takes mastery to throw them.
   Velocity. Acceleration, timing, etc. So something should improve use of grenades, but not prevent others from using
   them." Mastery: the user picked "Saboteur, as mocked (Rec.)" (transcript 70973): Saboteur +6% to grenade effects,
   never a gate (design 89).
4. **Field devices** (D20, design 66 to 67): Lure Beacon / Shroud Emitter: anyone can use them, but they "work at reduced
   ability ... unless you have someone who improves the efficacy of certain categories of kits by 5%/6%". Untrained
   (transcript 70901 answer 3): "How about a chance between 50-75%. The fluctuation might help to account for innate
   knowledge, etc." Corrected (transcript 70979): "Shouldn't be set per person for question 1. I was thinking it would
   be calculated as a range on rolling the effect." So the effect rolls uniformly 50% to 75% PER USE (design 85 to 88).
   Codebreaker +6% as the specialist is still a proposal (design 93).
5. **Names** (transcript 70901 answer 1): "Concussion. May fail to take an action due to feeling disoriented, etc. Also
   needs blindness. Enemy combatants could throw flash grenades and have a chance to cause a turn or two of blindness,
   etc. But the rest are fantastic." So First Aid Kit, Antitoxin, Trauma Kit, Combat Stim, Hemorrhage, Neurotoxin are
   kept (design 73 to 76), and enemies gain a flash grenade action.
6. **Fracture** (transcript 70901 answer 4, "Yes."; design 83): after a Splint it heals in 3 rounds; untreated, the member
   comes home injured.
7. **Treatment split by training** (transcript 70973, "Split by training (Rec.)"; design 90 to 92): Blindness (attacks
   mostly miss for 1 to 2 turns, from enemy flash grenades) is cleared by anyone's First Aid Kit; Concussion (from enemy
   heavy hits and explosions; first-pass 35% chance to lose each action for 3 turns) needs Medical Training plus a Trauma
   Kit to clear early, otherwise it wears off.
8. **No automatic kit use by default** (D19, design 50 to 53): "A default set of gambits that covers everything but
   automatic kit use should be assigned by default unless one is set up."
9. **Diminishing returns, never hard caps** (D23, design 145 to 148): "Diminishing returns will 100% come into play, but
   without removing the entire ability to push past a certain point." (The one ceiling kept is hazard resist.)
10. **Stoneskin** (D24, design 165 to 170): Ossir "Chances of receiving physical ailments is reduced by 25%, but if they
    do land, they last for 25% longer." GO-3 built the bay half; the in-battle half is carried here (GO plan 79 to 81).
11. **Terms and the bay** (D25, design 226 to 240): ailments = non-physical debuffs (poisons); injuries = physical
    (fractures, concussion); each type has its own cure time in the medical bay and all tick down at once.
12. **Fear from enemies** (D26, design 245 to 246): "SOME ENEMIES CAUSE FEAR (a Field Kits condition: certain enemies can
    terrify a member, a chance to lose a turn)." Status chance on the Pulse Rifle, Scattergun and Targeting Optic stays as
    is (design 257 to 259): Field Kits must not add signature statuses to those weapons.
13. **Tools are gear** (user 2026-09-17, exploration saga design 217 to 226): Security tools "skew to enemy
    DEBUFFS/DISRUPTIONS ... a grenade that STUNS or POISONS a target", plus "ENCOUNTER-RATE levers". These are member
    Tool-slot equipment today (model.ts 2565 to 2626).
14. **Mockup proposals the user did not object to** (FK-M4, FK-M5): kits come from a free floor plus the Fabricator in a
    new "Field Kits" group, stack in Logistics, are packed per expedition with the default "pack what the squad can use",
    unused kits come home, a loadout saves its packing, and "A rule asking for a kit that member can't use simply doesn't
    fire". All of these stay [PROPOSAL] until confirmed (section 5).

## 2. Reconciliation: the 16b steps against today's code

16b was written on 2026-10-09, before Ground Operations (GO-0 to GO-18), Squads (SQ-1 to SQ-7) and affixes (AF-1, AF-2).

| 16b step | What exists now | What the step must touch now |
|:-|:-|:-|
| 1. Kit categories + skill rules | First aid 0.5x / 1.25x by Medical Training (gambit.ts 120 to 130, `firstAidEffectiveness` 563); medic actions gated (`canActorUse` 387); grenades ungated; Med Kit heal needs training (1422 to 1425). `FIELD_DEVICE_UNTRAINED_EFFECTIVENESS = 1` and `fieldDeviceSpecialistAboard` false (expedition.ts 270 to 277, 1466 to 1473). Saboteur = +0.1 statusChance, Codebreaker = a Science fieldwork trait (awayTraits.ts 75 to 80, 125 to 130). | New pure `fieldKits.ts` (catalog, categories, effectiveness, the per-use device roll, specialist bonuses). The device roll now applies at the SHIP-EVENT chance (GO-8 kept the Shroud / Lure dial on ship events, Q11 provisional), the only place a device is "used". |
| 2. Consumables + Fabricator "Field Kits" group | No consumable items. `teamKit` is a count, not items (model.ts 7014; derived gambit.ts 1330 to 1336, `TEAM_KIT_MAX` 8). Grenades, Med Kit, Shroud Emitter and Lure Beacon are crafted member TOOLS with rolled lines (model.ts 2565 to 2626, blueprints 9620 to 9684). Inventory takes any ITEMS key with no migration (quality buckets, inventory.ts). Fabricator groups by `blueprintGearCategory` (App.svelte 9874 to 9895). Logistics has a reserved "Consumables" marker (App.svelte 1946). | **CONFLICT:** the step lists grenades and devices as stackable consumables; code and the user's 2026-09-17 intent make them installed tools. Plan: keep them tools; the six medical / stim kits become items (open call 1). New ItemCategory, ITEMS rows, material blueprints with `outputItem`, a "Field Kits" Fabricator group, glyphs. |
| 3. Conditions | Statuses: poison, bleed, stun, weakened, suppressed, corroded, fear + 2 buffs (gambit.ts 170 to 180). Bay table already lists Blindness, Neurotoxin, Hemorrhage, Concussion, Fracture (medicalBay.ts 60 to 65), and a status that is in BOTH tables is carried between fights and into the bay automatically (groundFight.ts `isCarriedStatus` 92). Enemies: only Casters inflict (poison / weakened, gambit.ts 1620 to 1622) plus SQ-4 flora poison. Nothing inflicts Fear (D26). Engine has no critical hits. | Add the five statuses with their effects; enemy inflicts post-generation (the `withFloraToxins` pattern, no draw at generation); a new enemy flash grenade action; Fear on some enemies; the Stoneskin battle half. **"Untreated: comes home injured" now means** the Fracture rides into the next fight of the objective and into the medical bay (1800 s) on the return trip (GO replaced the flat claim injury), and any bay time still running at the end is carried home at claim (`bayEnds`). |
| 4. Squad Kit at dispatch | Dispatch is per ground team (GO-2 / GO-7a `snapshotGroundOps`, groundOps.ts 184 to 215); team kinds Ground / Strike / Survey (SQ-1). The free kit refills every FIGHT (`exp.teamKit`, GO-5 carry, [PROVISIONAL]). GO-17 built per-ground-team loadouts and put an unused `consumables?` on each MEMBER kit (model.ts 6458 to 6461). | Packs per ground team on `GroundTeamRun.kits` (open call 9 for scope); dispatch deducts stock; joint crews pool their packs; unused kits deposit at claim. Move the loadout's packing to `GroundTeamLoadout.pack?` (the member-level field was never written: no migration). Squad Loadouts UI still waits on the GO-17 sketch. |
| 5. Gambit kit rules | One `useItem` action spending the generic count and cleansing ANY debuff (gambit.ts 870 to 886); the Triage preset uses it (497); `DEFAULT_MEMBER_GAMBIT` has no `useItem` (model.ts 6953 to 6961) but leads with a medic `cure` that clears ANY debuff for free. No downed-ally selector (selectors only see standing allies, gambit.ts 625). Injury Kit hooks: legacy `injuries.ts` treatmentShare (legacy runs only) and `medicalBay.ts` treatmentShare, which groundOps.ts 1674 does not pass yet. | `GambitRuleParams.kitId?`; a new `allyDowned` selector; per-kit fire checks ("cannot use" means the rule does not fire); per-member treatment on the trip feeding `memberBaySeconds`. **CONFLICT:** the medic's free `cure` would clear Hemorrhage, Neurotoxin, Fracture and Concussion with no kit, against D20 and the training split (open call 5). |
| 6. Logistics stock view + Help | Logistics tabs: Materials, Ship Equipment (reserved Modules / Consumables markers), Away-Team Gear, Crafted Blanks. Help: GO-18 topics; the cure list is hard-coded to what can occur today (helpTopics.ts 164 to 170, `CURE_IDS`). | A Field Kits stock view (fills the reserved Consumables marker, open call 14); Help topic "Field Kits"; widen `CURE_IDS`; Ground Operations topic lines for kits. |
| (new) Affixes, threat, squads | AF-1 Reinforcing adds mid-work fights and alert escalation; AF-2 cover; the threat indicator memoizes on `TaskFightExp` + `GroundFightTeam` (groundFight.ts 254 to 260; groundThreat.ts memo key with `satisfies`). Survey teams never fight. | Every new fight read widens `TaskFightExp` / `GroundFightTeam` and the memo key. Kits add no affix coupling (open call 12). Survey teams get no pack UI. |

## 3. Data model (all optional and absent-safe; no SAVE_VERSION bump expected, still 68) **[SUPERSEDED 2026-10-16 by REVISED SLICES R2]**

```ts
// == fieldKits.ts (new, pure) ==
export type KitCategory = "firstAid" | "advancedMedical" | "explosives" | "fieldDevices";
export type FieldKitId = "firstAidKit" | "antitoxin" | "splint" | "injuryKit" | "traumaKit" | "combatStim";
export interface FieldKitDef {
  id: FieldKitId; label: string; category: KitCategory;
  requiresMedic: boolean;            // Advanced Medical: a hard gate (D20)
  clears: readonly GambitStatusId[]; // what one use cleanses [PROPOSAL per kit, open call 2]
  heal?: number; buff?: GambitStatusId; treatmentShare?: number; splintRounds?: number;
  catalog: number;                   // the kit catalog that introduced it (the AF-2 gate pattern)
}
export const FIELD_KITS_CATALOG_VERSION = 1;
export const FIELD_DEVICE_SALT = 0x...;      // odd, new; the per-use device roll
export const FIELD_DEVICE_MIN_PERCENT = 50;  // user
export const FIELD_DEVICE_SPAN_PERCENT = 26; // nextInt(26) -> 50..75 inclusive, integer draw
export const SABOTEUR_GRENADE_BONUS = 0.06;  // user (mockup)
export const CODEBREAKER_DEVICE_BONUS = 0.06; // [PROPOSAL, open call 8]

// == model.ts ==
ItemCategory |= "fieldKit";                       // stackable, Logistics; capped like any item (itemCap by tier)
GambitStatusId |= "fracture" | "hemorrhage" | "neurotoxin" | "concussion" | "blindness";
GambitTargetSelector |= "allyDowned";            // the Injury Kit rule (FK-M5)
GambitActionId |= "flashGrenade";                // ENEMY-only action (never in SECURITY_LEGAL)
GambitRuleParams.kitId?: FieldKitId;             // which kit a useItem rule spends; absent = see open call 15
Expedition.fieldKits?: { catalog: number };      // THE FLAG, stamped at dispatch from FK-6
GroundTeamRun.kits?: Partial<Record<FieldKitId, number>>;          // packed kits remaining on this run
GroundTeamRun.treatment?: Record<string, number>; // memberId -> summed Injury Kit share this trip (cleared at heal)
GroundFightRecord.kitsUsed?: Partial<Record<FieldKitId, number>>;  // packed kits spent in the fight (free floor not counted)
GroundFightRecord.treated?: Record<string, number>;                // memberId -> Injury Kit share applied in the fight
GroundTeamLoadout.pack?: Partial<Record<FieldKitId, number>>;      // replaces the never-written SquadLoadoutKit.consumables?
ShipGroundTeam.pack?: Partial<Record<FieldKitId, number>>;         // the team's packing for its next dispatch [PROPOSAL]
```

## 4. Slices (one implementer + two-stage review each) **[SUPERSEDED 2026-10-16 by REVISED SLICES R3; FK-3 is built and stays]**

### FK-1: Kit catalog + category rules (pure; no engine change)

**Files:** create `src/lib/game/fieldKits.ts`, `fieldKits.test.ts`; modify `salts.test.ts` (register the module).
**Behavior:** the `FIELD_KITS` catalog (the six kits, FK-M2 descriptions, `clears` per open call 2 [PROVISIONAL]);
`KIT_CATEGORY_RULES` (First Aid: untrained 0.5, Medical Training 1.25, reusing gambit.ts constants by import, never
copies; Advanced Medical: `requiresMedic`, full effect when trained; Explosives: everyone at 1.0; Field Devices: rolled);
`canUseKit(actor, kit)`; `kitEffectiveness(actor, kit, careMult?)` (Fleet Triage multiplies first aid as today);
`fieldDevicePercent(seed, key)` = 50 + `makeRng((seed ^ FIELD_DEVICE_SALT ^ key) >>> 0).nextInt(26)` (one integer draw on
its own stream); `fieldDeviceEffectiveness(percent, codebreakerAboard)`; `saboteurGrenadeMult(saboteurCount)` per open
call 9 (a D23 curve via `diminishing.ts`, never a cap); `codebreakerAboard(roster)` (union roster, Science included:
"anyone on the expedition", FK-M1).
**Determinism:** pure; the only draw is the device roll on its own salt. **Tests:** each category rule; the device roll
is always an integer in [50, 75], deterministic per key, and covers both ends over keys; a medic gate refuses an untrained
actor; Saboteur / Codebreaker bonuses; FIELD_DEVICE_SALT registered. **Save:** none. **UI:** none.
Commit `feat(0.14.0): field kit catalog and category rules (Field Kits FK-1)`.

### FK-2: Items, blueprints, the Fabricator group, glyphs (data + a small UI hook)

**Files:** `model.ts` (ItemCategory `fieldKit`, six ITEMS rows with `unlockHint` + `flavor`, six MATERIAL blueprints with
`recipe.outputItem` / `outputQty`), `src/lib/awayGearDisplay.ts` or App.svelte `fabricateKeyGroupsForTier` (a "Field Kits"
group for blueprints whose output item is a `fieldKit`), the Research list sections, `icons.ts` + `ICON_SEMANTICS` (one
glyph per kit plus a category glyph if the stock view needs it), `model.test.ts` drift guards.
**Behavior:** recipes and research tiers per open call 3 [PROVISIONAL]; crafted kits deposit into inventory bucket 0 like
any material; caps by tier (tick.ts `itemCap`). No kit is usable yet (nothing reads them).
**Determinism / save:** static data; inventory keys are dynamic (no migration). **Tests:** each blueprint is a material
blueprint whose output is a `fieldKit` item; a craft deposits the kit; the Fabricator group lists them under "Field
Kits"; every glyph is classified. **UI:** the existing Fabricator dropdown pattern (no new mockup); glyphs reviewed at
16 / 28 / 56 px in the preview. **Text:** labels as named; hints honest ("Crafted at the Fabricator after research").
Commit `feat(0.14.0): field kit items and Fabricator blueprints (Field Kits FK-2)`.

### FK-3: Pre-Field-Kits goldens (tests only, BEFORE any engine edit)

**Files:** new `src/lib/game/fieldKitsGoldens.test.ts`, fixture `withoutFieldKits(exp)` (strips `fieldKits`, packs,
treatment, kitsUsed).
**Behavior:** capture hashes of: a legacy run (no `groundOps`); a GO run dispatched before SQ-4; a risk-aware run; affix
catalog 1 and catalog 2 runs (Reinforcing with an alert, negative Rocky Outcroppings); a Tier VII enemy territory run; an
Ossir member taking Bleed; a run with a Shroud Emitter and a Lure Beacon worn (the ship-event chance at every boundary);
the threat odds of three tasks; each at five checkpoints, the phase at 2,000,000 s, and the claim. Parity: one call ==
997 s chunks == 1 s steps on the same fixtures.
**Acceptance:** green on today's code; committed alone. Commit `test(0.14.0): pre-Field-Kits golden hashes (Field Kits FK-3)`.

**FK-3 carry (2026-10-14, done; review follow-up the same day):** `src/lib/game/fieldKitsGoldens.test.ts` (35 tests,
the slowest about 0.55 s) pins eleven fixtures (legacy, legacyDevices, preSq4 with BOTH teams deployed, riskAware,
affixCat1, affixCat2, tierSeven, ossirBleed, shroud, lure, bothDevices at +0.8: one Shroud, three Lures) at five
checkpoints, MID-RUN checkpoints read off each fixture's own history (the middle of the first bay stay and of the
first recovery leg; offsets pinned in the golden), the phase at 2,000,000 s and the claim (every fixture completes and
claims), plus the per-boundary device-read chance and step roll on every run that rolls at its boundaries (the ship-event
chance on Ground Ops runs, `scanEncounterChance` on legacy runs, both reading `fieldDeviceEffectiveness`, FK-7's
target), an Ossir member taking Bleed in a battle (guards stamped with a Bleed on-hit; the resolveGroundBattle call
FK-4 will widen), and the threat odds of three objectives. Parity per fixture: 997 s chunks to the last checkpoint; 1 s
steps over the busy stretch (legacy 60,000 s, a real Ground Ops run its window's first hour from a one-call advance, a
hand-built run its first 3 hours; 1 s over a whole real run blows the 5 s budget); an EVENT-BOUNDARY chain (t - 1, t,
t + 1 at every recorded step boundary, log line and ship leg) compared to one call; 61 s chunks over 60,000 s.
`withoutFieldKits(exp)` lives in `awayTeamTestFixtures.ts` (strips `fieldKits`, team `kits` / `treatment`, the pending
fight's `kitsUsed` / `treated`; identity today, asserted). Every fixture goes through it at build, so FK-6 stamping the
flag keeps the goldens. BUT the claim hashes cover the whole STATE: if FK-6 writes anything state-side at dispatch (a
`ShipGroundTeam.pack` preference, stock deducted for a default pack), the claim hash moves; FK-6 must strip it (in
`withoutFieldKits`'s state twin or the claim comparison), never re-capture. The fixtures hold no kits in inventory, so
nothing is drawn today. Cross-check: riskAware is the AF-1 gate's tierFourEnemy fixture and reproduces its capture.

### FK-4: Conditions, enemy inflicts, the flash grenade, Fear, Stoneskin in battle (engine, behind the flag)

**Files:** `model.ts` (status / action unions), `gambit.ts` (`GAMBIT_STATUSES` rows, new effect kinds, the turn-loss check
beside stun / fear at 1201 to 1204, `resolveGroundBattle` options), `groundFight.ts` (`withFieldKitsGuard`,
`TaskFightExp` widened with `fieldKits`), `groundThreat.ts` (memo key), `medicalBay.ts` (no table change; comments),
tests `fieldKitsConditions.test.ts`.
**Behavior (numbers [PROVISIONAL], open call 13):**
- Fracture: power and accuracy down (FK-M3) until splinted; lasts the fight (duration `MAX_ROUNDS`); carried between the
  objective's fights; 1800 s in the bay.
- Hemorrhage: a heavy Bleed (DoT above Bleed's 7); First Aid cannot clear it; a Trauma Kit can.
- Neurotoxin: Poison damage plus a chance to lose the turn; Antitoxin cannot clear it; a Trauma Kit can.
- Concussion: 35% to lose each action for 3 rounds (user first-pass); wears off; a trained Trauma Kit clears it early.
- Blindness: attacks mostly miss (accuracy cut [PROVISIONAL]) for "a turn or two" (open call 13); anyone's First Aid Kit clears it.
- Enemy sources [PROPOSAL, open call 7]: `withFieldKitsGuard(enemies, profile)` stamps on-hit afflictions AFTER
  `generateEncounter` (no generation draw), using the existing `onHitStatuses` field and its documented draw order.
- The flash grenade: an enemy-only action in an enemy program prefix, limited uses per enemy (a per-combatant counter on
  the working clone), its own hit check on the fight stream; it applies Blindness through the normal resist roll.
- Fear: some enemies inflict it (D26); Iron Will, Cortex Shield and Morale Anchor now read live.
- Stoneskin battle half: a physical status (Bleed, Hemorrhage, Concussion, Fracture) on an Ossir member is resisted
  25% more (folded as independent chances, 1 - (1 - own)(1 - 0.25)) and lasts ceil(duration x 1.25) [PROVISIONAL shape,
  open call 13].
- The medic's free `cure` follows open call 5 (proposal: it no longer clears the high-level conditions).
- Every change reads `fieldKits` through one helper `fieldKitsLive(exp)`; without it the fight is the fight as before.
**Determinism:** new draws only inside flagged fights (private per-fight stream); turn-loss and resist rolls use the
existing `rng.chance` shape; no generation draw added. **Tests:** each status's effect; each enemy source; flash grenade
use limit; Stoneskin both halves; Cortex Shield / Iron Will / Morale Anchor now change a fight outcome (no-dead-stats
entries removed: `FIELD_KITS_FEAR`, and `CORTEX_RESIST` only if open call 6 is answered yes); a carried Fracture reaches
the bay (1800 s, Ossir 2250 s); FK-3 goldens unchanged; a flagged fight is deterministic and log-neutral. **Save:** none.
**UI:** none (labels for the editor's status list come in FK-9).
Commit `feat(0.14.0): Field Kits conditions, enemy flash grenades and Fear (Field Kits FK-4)`.

### FK-5: Kits in battle (engine, behind the flag)

**Files:** `gambit.ts` (`BattleState.kits`, `useItem` per kit, `allyDowned` in `resolveTarget`, `ruleFires` per-kit checks,
`GroundBattleResult.kitsUsed` / `treated`), `groundFight.ts` (`GroundFightTeam.kits?`, record fields), `groundThreat.ts`
(memo key lists the kits), `model.ts` (DEFAULT_MEMBER_GAMBIT untouched: still no `useItem`), tests `fieldKitsBattle.test.ts`.
**Behavior:**
- A `useItem` rule names a kit (`params.kitId`). It fires only when the actor `canUseKit`, a kit of that id remains
  (free floor first, then the packed stock [PROPOSAL]), and the target needs it (a status the kit clears; for the Stim, a
  standing ally without Inspired; for the Injury Kit, a DOWNED ally via `allyDowned`). Otherwise it does not fire and the
  next rule acts (FK-M5).
- First Aid Kit: heal + clears its list at first-aid effectiveness (the existing `applyFirstAid` math). Antitoxin: Poison.
  Splint (trained): Fracture's remaining set to 3 rounds (user). Trauma Kit (trained): Hemorrhage, Neurotoxin, Concussion.
  Combat Stim: Inspired at first-aid effectiveness. Injury Kit (trained): adds its `treatmentShare` to the downed
  member's trip treatment (recorded in `treated`), no in-battle revival.
- Free floor: `exp.teamKit` First Aid Kits per fight as today, or per trip, per open call 4 [PROVISIONAL: per fight].
- Joint crews: packs are pooled in crew order (lead first) [PROPOSAL].
**Determinism:** no new draws (kit effects are arithmetic). A flagged fight with no packs and no `kitId` rules equals the
same fight under FK-4. **Tests:** each kit; the gate (untrained Splint / Trauma / Injury Kit never fire, the next rule
does); free floor before packed; kitsUsed counts only packed kits; `allyDowned` resolves only downed allies; threat
memo distinguishes packs; FK-3 goldens unchanged. **Save:** none.
Commit `feat(0.14.0): field kits spent by gambit rules in task fights (Field Kits FK-5)`.

### FK-6: Run plumbing: the flag, packing, the bay, claim (engine)

**Files:** `expedition.ts` (`startExpedition` stamps `fieldKits` and deducts packs; `claimExpedition` /
`depositExpeditionFindings` returns unused kits; `cloneGroundOps` path), `groundOps.ts` (`snapshotGroundOps` writes
`GroundTeamRun.kits`; `startFight` passes packs; `finishFight` subtracts `kitsUsed` per owner and merges `treated`;
`groundTeamBaySeconds` passes `treatment[id]` into `memberBaySeconds`; `healTeam` clears treatment), `armory.ts`
(`GroundTeamLoadout.pack` saved and applied as the team's packing; drop the never-written member-level `consumables?`),
`groundTeams.ts` (`ShipGroundTeam.pack` preference, `defaultPack(state, ship, teamIndex)`), tests
`fieldKitsRun.test.ts`, `groundOpsParity.test.ts` additions.
**Behavior:** the default packing is "pack what the squad can use" [PROPOSAL counts, open call 9]; a Survey team packs
nothing; dispatch refuses nothing for missing kits (packing only lowers to stock); stock leaves inventory at dispatch
(lowest quality first) and the unused return at claim (open call 17 for the cap); the bay reads treatment; a run without
the flag never reads packs.
**Determinism:** kit counts are stored values; no draws. **Tests:** dispatch deducts exactly the pack; spent kits never
return; one call == 997 s == 1 s parity with packs, a Reinforcing alert and a joint crew; an Injury Kit shortens that
member's bay time only; claim restores the remainder; a loadout round trip keeps the pack; FK-3 goldens unchanged (they
strip the flag). **Save:** optional fields only; SAVE_VERSION stays 68 (note in save.ts under v68). **UI:** none yet.
Commit `feat(0.14.0): field kits packed per ground team, spent, returned (Field Kits FK-6)`.

### FK-7: Field devices roll per use (engine)

**Files:** `expedition.ts` (`shipScanEventChance` / `squadEncounterBias` read the rolled effectiveness on flagged runs;
`FIELD_DEVICE_UNTRAINED_EFFECTIVENESS` and `fieldDeviceSpecialistAboard` replaced by `fieldKits.ts`), tests.
**Behavior:** at each scan step boundary of a flagged run with ship events, the device dial is multiplied by
`fieldDevicePercent(exp.seed, scanStepKey(body, step)) / 100` (x 1.06 with Codebreaker aboard, open call 8). The
boundary's own roll (draw 1 event, draw 2 cache) is untouched; the device roll is a separate keyed stream.
**Determinism:** new salt, integer draw, keyed by the boundary. **Tests:** the chance moves only by the rolled factor; no
dial worn means no roll is read; legacy and pre-FK runs keep effectiveness 1 (goldens); parity. **Save:** none.
Commit `feat(0.14.0): field devices roll 50 to 75% per use (Field Kits FK-7)`.

### FK-8: Dispatch packing and run readouts (UI) **[NEEDS A USER MOCKUP SIGN-OFF]**

FK-M4 drew a per-ship Squad Kit before ground teams existed; the dispatch screen now shows teams (Alpha / Bravo), kinds
and squads. Sketch first (feedback rule "visual UI needs mockup"); the engine is already in place.
**Files:** `src/lib/ExpeditionPanel.svelte` (replace the "Team kit" line 928 to 929 with per-team packing rows: kit,
"usable by" names or "No one here has Medical Training: can't be used", stepper, in stock), `expeditionDispatchDisplay.ts`,
App.svelte `doSetTeamPack`, the GO-14 timeline / bay card (kits left per team; the new conditions with their bay times;
log lines "used a Splint on Ysseth", "Concussed", "Blinded by a flash grenade").
**Tests:** display helpers (`*.test.ts`), the preview at 1280 and 375 px, light and dark, keyboard path, console clean.

### FK-9: Gambit editor, Logistics stock, Squad Loadouts packing (UI)

**Files:** `GambitEditorPanel.svelte` + `gambitEditorDisplay.ts` (a kit picker for Use Item, the "Ally downed" selector
label, the new statuses in the status list, a hint when the selected member cannot use the kit: "Fires only for a member
with Medical Training"); App.svelte Logistics (a Field Kits view in place of the reserved Consumables marker, the
materials tile pattern with counts and caps); the Squad Loadouts pack row rides the GO-17 UI half (which already waits on
the user's sketch).
**Mockup:** the editor and the stock view reuse existing patterns and FK-M5 covers the rules, so no new sketch unless
open call 14 picks a new Logistics tab; the loadout row goes into the GO-17 sketch.
**Tests:** display helpers; `SELECTOR_LABEL` / `ACTION_LABEL` exhaustiveness (compile); preview checks as FK-8.

### FK-10: Help, no-dead-stats, close-out

**Files:** `src/lib/helpTopics.ts` (new topic "Field Kits": categories, who can use what, the 50 to 75% device roll,
Saboteur, the conditions and what clears each, packing, the free floor, numbers read from constants; widen `CURE_IDS`;
cross-link Ground Operations and Return Trip and Medical Bay), `no-dead-stats.test.ts` (Task 22b categories for Iron Will
and the new effects), the E-CREW plan (Task 16b gets "SUPERSEDED by docs/plans/2026-10-14-field-kits-plan.md" plus a
carry note), the design doc (answers to section 5 recorded under D20), the QA sheet (section 6).
Commit `docs(0.14.0): Field Kits help and close-out (Field Kits FK-10)`.

## 5. OPEN CALLS for the user (each has a [PROPOSAL] build default and alternatives) **[ANSWERED except 3, 14, 15, 16, 17, 18: see the USER ANSWERS below and REVISED SLICES R4]**

1. **Grenades and field devices: gear or consumables?** 16b step 2 lists them as stackable consumables; today they are
   crafted Tool-slot gear with rolled lines (your 2026-09-17 note made them tools). [PROPOSAL] keep them installed tools;
   the category rules (anyone throws, Saboteur boosts, devices roll 50 to 75%) apply to them as gear; only the six
   medical / stim kits are consumables. Alt: convert grenades to consumables (one throw each, crafted pieces kept or
   salvaged); alt: both (a gear launcher plus consumable charges).
2. **What each kit clears and its numbers.** [PROPOSAL] First Aid Kit: heal 10 x effectiveness, clears Bleed, Blindness,
   Weakened, Suppressed, Corroded; Antitoxin: Poison; Splint: Fracture heals in 3 rounds (yours); Trauma Kit: Hemorrhage,
   Neurotoxin, Concussion; Combat Stim: Inspired for 2 rounds; Injury Kit: treatment share 0.5 (bay time / 1.5). Alt:
   First Aid keeps clearing every basic debuff including Poison (Antitoxin then only matters for Neurotoxin).
3. **Recipes, research, cost.** [PROPOSAL] tier 1 (60 ticks, 700 credits): First Aid Kit (1 Purified Biomass + 1
   Polysilicate Wafer makes 2), Antitoxin (1 Purified Biomass + 1 Volatile Resin makes 2), Splint (1 Titanium Ingot + 1
   Fibrous Biomass makes 2); tier 2 (120 ticks, 1600 credits): Combat Stim (1 Volatile Resin + 1 Purified Biomass makes
   2), Trauma Kit (2 Purified Biomass + 1 Exotic Spore Cluster + 1 Polysilicate Wafer makes 1), Injury Kit (2 Purified
   Biomass + 1 Polysilicate Wafer + 1 Power Coupling makes 1). Alt: everything tier 1; alt: no research gate for First Aid.
4. **The free floor.** Today the ship's Medical and Operations crew give 2 + 1 per 4 heads of free kit, capped at 8,
   refilled every fight. [PROPOSAL] they become free First Aid Kits, refilled each TRIP at the reload step (the ship
   restocks the team), the cap of 8 replaced by a D23 curve; the Quartermaster issues no separate free kits. Alt: keep per
   fight; alt: keep the cap of 8 on old saves only; alt: a Quartermaster free First Aid Kit requisition as FK-M4 floated.
5. **The medic's free Cure.** A Medical Training member's Cure clears any debuff with no kit, so Trauma Kits and Splints
   would never matter. [PROPOSAL] on new runs Cure clears basic debuffs only; Fracture, Hemorrhage, Neurotoxin and
   Concussion need their kit. Alt: Cure clears them at half strength; alt: leave Cure as is.
6. **Cortex Shield and Concussion.** [PROPOSAL] Cortex Shield's stun resist also resists Concussion (it was pending since
   Task 22). Alt: a flash grenade or a heavy hit also stuns, so stun resist reads live on its own.
7. **Which enemies inflict what.** [PROPOSAL] Bruisers: Fracture, and Concussion on a heavy hit (a landed strike of 25% or
   more of the target's max HP); Strikers: Hemorrhage on an Execute against a low-HP target (the engine has no critical
   hits); Casters: Neurotoxin in place of Poison on Hard or harder objectives; Strikers carry one flash grenade each;
   Swarm and hostile garrisons inflict Fear. "Explosions" wait for an enemy explosive. Alt: you assign per role or per site.
8. **Codebreaker for field devices.** [PROPOSAL] anyone on the expedition with Codebreaker adds +6% to the rolled 50 to 75%
   (so 53 to 79.5%). Alt: a specialist aboard makes devices work at full strength ("unless you have someone"); alt: a
   different trait or a new one you name.
9. **Pack scope and the default.** [PROPOSAL] one pack per ground team (shared by its Security squads); "pack what the
   squad can use" = for each kit some member can use, 2 per Security member, up to stock. Alt: per Security squad; alt: per
   member (the GO-17 field).
10. **Saboteur stacking.** [PROPOSAL] +6% to grenade inflict chances for the whole squad when any member has Saboteur; more
    Saboteurs add on a D23 curve. Alt: only the Saboteur's own grenades; alt: one Saboteur is enough (no stacking).
11. **Kit stacking (D23).** [PROPOSAL] no cap on how many kits a team packs (stock is the limit); several Injury Kits on one
    member add their shares in the bay divisor (already concave, never zero). Alt: one Injury Kit per member per trip.
12. **Kits and affixes / threat.** [PROPOSAL] no affix coupling in 0.14.0 (Reinforcing simply burns more kits); the threat
    odds read the team's current packs, so packing better shows better odds. Alt: odds read the free floor only
    (pessimistic, cheaper); alt: a future positive affix that refills kits (yours to name).
13. **Condition numbers.** [PROPOSAL] Blindness: hit chance x 0.25 for 2 or 3 rounds (rolled on the fight stream, so "a
    turn or two"); Fracture: power and accuracy x 0.8; Hemorrhage: 12 per round for 4 rounds; Neurotoxin: 5 per round plus
    25% turn loss for 4 rounds; Stoneskin: physical statuses resisted 25% more (independent chance), lasting ceil(x 1.25).
14. **Logistics home.** [PROPOSAL] a Field Kits section in the reserved Consumables spot. Alt: a new Logistics tab (needs a
    quick sketch); alt: inside Materials.
15. **Old "Use Item" rules on new runs.** A rule saved before kits names no kit (the Triage preset too). [PROPOSAL] it means
    First Aid Kit; the Triage preset gains explicit kit rules. Alt: such a rule does not fire until edited.
16. **Kit quality.** Inventory is quality-bucketed. [PROPOSAL] kits ignore quality in 0.14.0 (balance pass). Alt: quality
    scales the effect.
17. **Kits coming home over the cap.** [PROPOSAL] returning kits may exceed the cap (no loss), like a salvage payout. Alt:
    clamp at the cap.
18. **Splinted Fracture at the bay.** [PROPOSAL] a fracture splinted in the fight costs no Fracture bay time (only Health).
    Alt: half the Fracture time.

## 6. QA checklist (desktop 1280 px and mobile 375 px, light and dark) **[SUPERSEDED 2026-10-16 by REVISED SLICES R5]**

- [ ] Fabricator: research and craft each kit; the "Field Kits" group shows; counts land in Logistics with caps.
- [ ] Dispatch: each Security-bearing team shows its pack; Survey teams show none; "can't be used" reads when nobody has
      Medical Training; stock drops at launch; the default pack matches the rule.
- [ ] A fight: a Use Item rule for a kit the member cannot use is skipped; the next rule acts; the log names the kit.
- [ ] Each condition appears from its enemy, shows on the member, and clears with the right kit (Blindness by anyone's
      First Aid Kit; Concussion only by a trained Trauma Kit, else it wears off; Splint heals Fracture in 3 rounds).
- [ ] An untreated Fracture carries to the next fight and into the bay (1800 s; 2250 s on an Ossir member).
- [ ] An Injury Kit on a downed member shortens that member's bay time only.
- [ ] Fear lands from its enemies; Iron Will and Morale Anchor visibly resist it.
- [ ] Field devices: the ship-event odds vary per boundary between 50% and 75% of the device's effect.
- [ ] Claim: unused kits return; spent kits do not; an old in-flight run (dispatched before the update) finishes unchanged.
- [ ] Gambit editor: the kit picker, "Ally downed", the new statuses, the Medical Training hint; the default program still
      has no kit rule.
- [ ] Help: the Field Kits topic and the widened cure list; no em dashes, US English, "install", "objective".
- [ ] Glyphs at 16 / 28 / 56 px; console clean on every screen; no horizontal scroll at 375 px.

## USER ANSWERS (2026-10-15)

- **FK1 / open call 1 (grenades, Shroud Emitter, Lure Beacon):** "Keep as installed tools (Recommended)". Only the six
  medical / stim kits become consumables.
- **FK2 / open call 5 (the medic's free Cure):** "Basic debuffs only. Perhaps future debuff inflictions will have higher
  ranks to indicate more severe issues, and only medical training can resolve those. "Fracture -> Broken Bone ->
  Shattered Bone -> Sentient Mass of Pudding (Okay, not this one, but you get the gist). Progressively worsening
  ailments. A splint might be able to help a fracture and perhaps a light break, but certainly not a shattered bone."
  So: on new runs Cure clears basic debuffs only; serious conditions need their kit. IDEA captured: condition SEVERITY
  RANKS (e.g. Fracture, Broken Bone, Shattered Bone), each kit treating up to a rank (a Splint helps a fracture and
  perhaps a light break, never a shattered bone); "future" / "perhaps": whether ranks are in 0.14.0 is asked.
- **FK3 / open call 4 (free First Aid floor):** "Per trip, curved (Recommended)": free First Aid Kits restock each trip
  at the reload step; the cap of 8 becomes a D23 diminishing curve.
- **FK4 / open call 9 (pack scope):** "One per member" (NOT the team-pack proposal). Each member carries their own kits;
  this matches GO-17's per-member `SquadLoadoutKit.consumables?` slot (keep it, do not move the pack to the team).
  The dispatch packing UI (FK-8) and the default packing must be redesigned per member.
- **Severity ranks (2026-10-15):** "In 0.14.0 Field Kits (Recommended)": build condition severity ranks now (e.g.
  Fracture, Broken Bone, Shattered Bone); each kit and Medical Training treats up to a rank. Names beyond the user's
  examples are [PROPOSAL].
- **FK7 / open call 7 (2026-10-16):** "As proposed (Recommended)": Bruisers Fracture + Concussion on a heavy hit;
  Strikers Hemorrhage on finishing a wounded target and one flash grenade each (Blindness); Casters Neurotoxin instead
  of Poison on Hard or harder objectives; Swarm and hostile garrisons Fear.
- **Group 5 (2026-10-16):**
  - **FK2 / open call 2 kit coverage:** "Proposed coverage (Recommended)", with severity ranks: First Aid clears basic
    debuffs (Bleed, Blindness, Weakened, Suppressed, Corroded) + a small heal; Antitoxin Poison; Splint Fracture and a
    light Broken Bone; Trauma Kit (Medical Training) Hemorrhage, Neurotoxin, Concussion, Broken Bone; Shattered Bone
    only the medical bay; Combat Stim Inspired 2 rounds; Injury Kit shortens bay time.
  - **FK6 / open call 6 Cortex Shield:** "Yes, covers Concussion (Recommended)".
  - **FK8 / open call 8 Codebreaker:** "+6% to the roll (Recommended)": 53 to 79.5%.

## USER ANSWERS, group 6 (2026-10-16) + a FIELD KITS RESHAPE (verbatim, authoritative)

- **FK10 Saboteur:** "Own grenades only" (NOT squad-wide): only the Saboteur's own throws get +6%.
- **FK12 kits in odds:** "Yes, count packs (Recommended)".
- **FK13 condition numbers:** "Proposed numbers (Recommended)" (Blindness hit x0.25 for 2 to 3 rounds; Fracture power and
  accuracy x0.8, worse at higher ranks; Hemorrhage 12/round x4; Neurotoxin 5/round + 25% turn loss x4; Concussion 35%
  x3).
- **FK11 limits, verbatim:** "This should be the case for everything. Each objective will start with a fresh set of
  supplies for both things like this (first aid kits and so forth), and then the tools you bring have a set amount of
  uses per battle and/or per objective. So, a lower level kit might contain 3 grenades, and you have to use them
  sparingly because you only get 3 for the entire objective, and perhaps it's limited to 1 per battle as they deal AoE
  damage. So perhaps an impact grenade explodes on contact, deals AoE damage and has a chance to inflict a debuff, as do
  other grenade types. Different grenades carry different quantities. As well as a stat that can possibly roll on the
  tool +1 carry capacity. So a plain grenade might have 4 to start, while specialized ones might have 2 to start. Also,
  make sure this doesn't trip up gambits. IF a gambit line requires a grenade to be used, and you're out or you've used
  one already in that battle, skip it. Also, there should be a way to save at least one for the final battle, because
  most likely, the hardest battle awaits at the end. So if there's some sort of "boss" type enemy, if you go in there
  without a grenade or without a charge of the item left over, it makes that battle harder, so you have to plan your
  gambit around that too. So the gambit should include something that can help you differentiate. I wouldn't go by "if
  on the x-th battle, then use a grenade", because that wouldn't work well dynamically. So we'd have to find a way to
  make this work. Perhaps we can designate enemy types. Because that's 100% going to be a thing. Enemy types similar to
  how other games do them. Weak, normal, strong, elite, boss, etc."

Reading (this reshapes FK-1, FK-4, FK-5, FK-6, FK-8, FK-9):
- SUPPLIES REFRESH PER OBJECTIVE: each objective starts with a fresh set of consumable supplies (First Aid Kits etc.).
- TOOL CHARGES: installed tools (grenades, devices) carry a set number of USES per objective, optionally capped per
  battle (grenades: 1 per battle, AoE). Quantity varies by tool kind: a plain grenade about 4, specialized about 2; a
  lower-level kit about 3. A new rollable tool stat line: "+1 carry capacity" (charges).
- GRENADE TYPES (user-named example): the IMPACT GRENADE: explodes on contact, AoE damage, chance to inflict a debuff;
  other grenade types similar with their own debuffs and quantities.
- GAMBITS: a rule needing a charge you lack, or a per-battle use already spent, does not fire (skip to the next rule).
  Gambits need a way to SAVE charges for the hardest fight; not "the x-th battle", but by ENEMY TYPE.
- ENEMY TYPES / RANKS (user-named, "100% going to be a thing"): Weak, Normal, Strong, Elite, Boss, etc. The hardest
  fight usually waits at the end (a boss). Follow-ups asked 2026-10-16.
- **Group 7 (2026-10-16):**
  - **Supplies:** "Free basics + your stock (Recommended)": every objective each member gets a free basic set; extras
    carried come from crafted stock; unused extras come home.
  - **Tool charges:** "Free, every objective (Recommended)": installed tools reset to full charges each objective.
  - **Enemy ranks:** "Build ranks now (Recommended)": every ground enemy has a rank (Weak, Normal, Strong, Elite, Boss)
    that scales its stats; the final fight of harder objectives holds an Elite or Boss; threat odds and Reinforcing
    account for ranks. FOUNDATION for ground combat (needs its own slice + goldens first).
  - **Saving charges:** "Rank rules + reserve (Recommended)": gambit conditions "target is Elite or stronger" / "target
    is a Boss" plus a per-rule "keep N charges for a Boss" option.
  - NOTE: the FK plan's slices FK-1..FK-10 must be REVISED for groups 6-7 before FK-1 builds (per-objective supplies,
    charges, enemy ranks, gambit rank rules, per-member packs). DONE 2026-10-16: REVISED SLICES at the top of this doc.
- **Revised-slice calls (2026-10-16):** N1 rank strength "Weak 0.7 to Boss 2.5 (Recommended)" (Weak x0.7, Normal x1,
  Strong x1.3, Elite x1.7, Boss x2.5, HP and power); N2 "By difficulty (Recommended)": Challenging objectives end with
  an Elite, Hard and Deadly with a Boss, Simple / Standard none, never on a training run; N7 + N15 "Thrown, spend
  charges (Recommended)": grenades become thrown actions spending a charge (AoE + debuff chance), replacing the passive
  on-hit effect, and the DEFAULT program throws them sensibly, saving one for a Boss (so this is a user-approved change
  to D19's "no automatic kit use" for grenades).
- **Correction (2026-10-16):** my N2 question said "Hard"; the real grades are Simple, Standard, Challenging,
  Dangerous, Deadly. The user's pick maps to: Challenging ends with an Elite; Dangerous and Deadly end with a Boss.
  Likewise "Hard or harder" for Caster Neurotoxin (N14) is still open. N1 as answered applies one multiplier to both
  HP and power (Weak 0.7, Normal 1, Strong 1.3, Elite 1.7, Boss 2.5), superseding the plan's split HP / power table.
- **N3:** "Only final fights (Recommended)". **N4:** "Grenades only (Recommended)": Impact 4, Stun 2, Toxin 2, 1 throw
  per battle, +1 carry line on grenades only; Med Kit, Shroud, Lure no charges. **N6:** "Group blast + Concussion
  (Recommended)": the target's group at 1.5x the thrower's power, 30% Concussion. **N5:** "Normal (Recommended)".
- **Boss strength (2026-10-16):** "Soften Dangerous (Recommended)": Dangerous objectives end with an ELITE (x1.7);
  only Deadly gets the Boss (x2.5). Challenging stays Elite. (Supersedes the earlier mapping.)
- **Weak / Strong (2026-10-16):** "Use them on the curve (Recommended)": early-curve runs (a new player's first Tier I
  runs) use Weak enemies (the curve's low end expressed as the Weak rank, owned by SF-3); Dangerous objectives' NON-final
  fight leads are Strong. **Rank heals:** "Yes, heal scales too (Recommended)".
- **Build order:** "SF-2 next, then staging (Recommended)".
- **Field devices (2026-10-16, via the wiring plan OC-F1):** Shroud and Lure move to the GROUND (ground ambush and
  reinforcement chances; Lure adds a salvage drop scale); the 50 to 75% per-use roll (FKR-8) applies there.
- **N8 + N10 bones (2026-10-17):** "Start Fracture, worsen (Recommended)": every bone injury starts as a Fracture,
  worsens on repeat hits to Broken Bone then Shattered Bone; a Splint turns a Broken Bone back into a Fracture.
  **N11 bay times:** "30m / 1h / 2h (Recommended)". **N9:** "Bones only now (Recommended)". **N12 free basics:** "1
  First Aid Kit + crew curve (Recommended)", refreshed every objective and every trip. (Confirms FKR-2's provisional
  N8 / N9 / N12 picks.)
- **N14 Neurotoxin:** "Challenging and up (Recommended)". **N13 prices:** "3x material value (Recommended)". **N16
  default pack:** "1 of each usable kit (Recommended)". **Call 3 recipes:** "Two research tiers (Recommended)" (tier 1
  First Aid Kit, Antitoxin, Splint, 2 per craft; tier 2 Combat Stim, Trauma Kit, Injury Kit).
- **Calls 14 to 18 (2026-10-17):** 14 "The reserved Consumables spot (Recommended)"; 15 "Means First Aid Kit
  (Recommended)" (the Triage preset gets explicit kit rules); 16 + 17 "Ignore quality, allow over cap (Recommended)";
  18 "No Fracture bay time (Recommended)". => ALL Field Kits open calls are now answered.
- **Stun and Fear (2026-10-17):** "Yes, both clear them (Recommended)": Stun and Fear are basic debuffs; a First Aid Kit
  and the free Cure clear them (confirms FKR-2's provisional pick).
