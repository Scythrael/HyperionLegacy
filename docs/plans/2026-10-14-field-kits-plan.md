# Field Kits (E-CREW Task 16b, 0.14.0) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan slice by slice
> (the user's standing workflow: one fresh implementer per slice, two-stage review per slice, holistic review at the
> end, QA sheet to the user, deploy only on the user's word).

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

## 3. Data model (all optional and absent-safe; no SAVE_VERSION bump expected, still 68)

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

## 4. Slices (one implementer + two-stage review each)

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

## 5. OPEN CALLS for the user (each has a [PROPOSAL] build default and alternatives)

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

## 6. QA checklist (desktop 1280 px and mobile 375 px, light and dark)

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
