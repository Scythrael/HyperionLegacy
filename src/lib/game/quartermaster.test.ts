// ============================================================================
// Quartermaster Requisition (0.13.3.1). See quartermaster.ts for the design.
//
// WHAT THIS SUITE FENCES, in the order the risks matter:
//   (1) THE CATALOGUE IS DERIVED, NOT HAND-LISTED. The console renders
//       REQUISITION_ENTRIES, which is built from the total REQUISITION_CATALOGUE
//       Record, so the tests here check the DATA relationship rather than a fixed
//       list of names: every blessed economy floor has a row, every non-null row
//       really can mint, and every null row really has no floor to mint.
//   (2) EVERY STANDARD-ISSUE SLOT IS REQUISITIONABLE, and what comes out is a
//       well-formed baseline: a spare, standard, quality-0, blueprint-less piece
//       that is byte-identical to the one a ship is born with, plus the grace stamp.
//   (3) THE GRACE STAMP IS PRESENT. Baselines became auto-salvageable this release,
//       so an unstamped requisition could be swept before the player reached a ship.
//   (4) CAP BEHAVIOUR. A baseline occupies no spare storage by definition, so a full
//       pool neither blocks the counter nor is grown by it. This is the anti-softlock
//       guarantee and it is asserted, not assumed.
//   (5) THE BOUND. One free spare per slot, reservation-aware, and never a silent
//       no-op: every refusal carries a typed reason.
//   (6) THE TICK IS UNTOUCHED. Requisition writes exactly two state keys.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  ECONOMY_FLOOR_SLOTS,
  REQUISITION_CATALOGUE,
  REQUISITION_ENTRIES,
  canRequisition,
  freeSpareBaselinesFor,
  requisitionBlockText,
  requisitionStandardIssue,
  type MemberRequisitionSlot,
  type RequisitionBlockReason,
  type RequisitionRow,
} from "./quartermaster";
import {
  AWAY_TEAM_TYPES,
  DEFAULT_EQUIPMENT_VARIETY,
  EQUIPMENT_SLOTS,
  EQUIPMENT_STORAGE_CAP_BASE,
  SI_EMITTER_CAP,
  SI_EMITTER_RECHARGE,
  SI_PLATING_HP,
  equipmentAtCap,
  freshState,
  generateCombatStandardIssue,
  generateStandardIssue,
  isMemberSlotType,
  isStandardIssueBaseline,
  memberVariety,
  spareEquipmentCount,
  type AwayMember,
  type AwayTeamType,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
} from "./model";
import { COMBAT_DEFAULT_LOADOUT } from "./combat/bridge";
import { canFitToMember, fitToMember } from "./memberEquipment";
import { autoSalvageProtectionForTarget, salvageEquipment } from "./salvage";

// A state with NOTHING in the equipment pool. freshState seeds the starting ship with a
// full set of INSTALLED baselines, which is correct for the game but noise for these
// assertions: an installed baseline is not a spare, so it never reaches the gate. Clearing
// the pool makes every count below mean exactly one thing.
function emptyPoolState(): GameState {
  return { ...freshState(), equipment: [] };
}

// Every row the catalogue can actually issue, read off the DERIVED list rather than
// re-typed here. That is the point: if a new slot gains a Standard-Issue floor, every
// per-slot test below covers it automatically, with no edit to this file. E-CREW (Task 9):
// a row is a (slot, squad) pair, since a member slot issues one row per squad type; ship
// rows carry teamType null.
const ISSUABLE_ROWS: { slot: EquipmentSlotType; teamType: AwayTeamType | null }[] = REQUISITION_ENTRIES.map(
  (e) => ({ slot: e.slotType, teamType: e.teamType })
);

// Every slot the catalogue explicitly declares has NO floor.
const NON_ISSUABLE_SLOTS: EquipmentSlotType[] = (
  Object.keys(REQUISITION_CATALOGUE) as EquipmentSlotType[]
).filter((slot) => REQUISITION_CATALOGUE[slot] === null);

describe("REQUISITION_CATALOGUE: the list is DERIVED from data, never hand-listed", () => {
  it("covers every blessed ECONOMY floor slot, so the two cannot drift", () => {
    // DEFAULT_EQUIPMENT_VARIETY's keys ARE the economy slots that have a Standard-Issue
    // floor (seedStandardIssueForShip iterates exactly this map). Adding a fifth economy
    // slot there without a catalogue row would make this fail, which is the drift guard.
    for (const slot of Object.keys(DEFAULT_EQUIPMENT_VARIETY) as EquipmentSlotType[]) {
      const row = REQUISITION_CATALOGUE[slot] as RequisitionRow | null;
      expect(row, `no requisition row for economy floor slot "${slot}"`).not.toBeNull();
      expect(row?.mint.kind).toBe("economy");
    }
  });

  it("covers the combat floors: shield emitter, hull plating, weapon and drone pod", () => {
    // Named explicitly because these four are the WHOLE POINT of the release (a required
    // combat slot left empty is what blocks a patrol). A regression that quietly dropped
    // one would restore the softlock, so it is checked by name as well as by derivation.
    expect(REQUISITION_CATALOGUE.shieldEmitters?.mint.kind).toBe("shieldEmitter");
    expect(REQUISITION_CATALOGUE.hullPlating?.mint.kind).toBe("hullPlating");
    expect(REQUISITION_CATALOGUE.weapon?.mint.kind).toBe("weapon");
    expect(REQUISITION_CATALOGUE.droneBay?.mint.kind).toBe("dronePod");
  });

  it("REQUISITION_ENTRIES is exactly the non-null rows, in catalogue order", () => {
    // A ship slot yields one row; a member slot yields one row per squad it lists (E-CREW Task 9). The hidden
    // Prospecting rows stay off the rendered list (prospecting squads design 2026-10-16; requisitionEntriesFor).
    const expected: string[] = [];
    for (const slot of Object.keys(REQUISITION_CATALOGUE) as EquipmentSlotType[]) {
      const value = REQUISITION_CATALOGUE[slot];
      if (value === null) continue;
      if (isMemberSlotType(slot)) {
        for (const team of AWAY_TEAM_TYPES) {
          if (team === "prospecting") continue;
          if ((value as MemberRequisitionSlot).perTeam[team] !== undefined) expected.push(`${slot}:${team}`);
        }
      } else {
        expected.push(slot);
      }
    }
    expect(REQUISITION_ENTRIES.map((e) => e.key)).toEqual(expected);
    // Every key is unique (the console's keyed each relies on it).
    expect(new Set(REQUISITION_ENTRIES.map((e) => e.key)).size).toBe(REQUISITION_ENTRIES.length);
    // Non-vacuous: there really are rows, and there really are declared-empty slots too.
    expect(REQUISITION_ENTRIES.length).toBeGreaterThan(0);
    expect(NON_ISSUABLE_SLOTS.length).toBeGreaterThan(0);
  });

  it("takes each label from EQUIPMENT_SLOTS wherever that table defines one", () => {
    // Single-source labels: renaming a slot in the blessed table renames the requisition
    // row too. weapon and droneBay have no EQUIPMENT_SLOTS entry (they mint through their
    // own tables) and legitimately carry their own name.
    for (const entry of REQUISITION_ENTRIES.filter((e) => e.teamType === null)) {
      const slotDef = EQUIPMENT_SLOTS[entry.slotType];
      if (slotDef !== undefined) expect(entry.label).toBe(slotDef.label);
      else expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("every row declared null really has NO Standard-Issue floor", () => {
    // The honest check that a null is a fact and not a forgotten row: generateStandardIssue
    // throws for a slot with no definition, which is precisely what "no floor" means.
    for (const slot of NON_ISSUABLE_SLOTS) {
      expect(() =>
        generateStandardIssue({ slotType: slot, fittedToShipId: null, allocateId: () => "equip-x" })
      ).toThrow();
    }
  });

  it("the issued WEAPON is the roster's floor gun, fenced against COMBAT_DEFAULT_LOADOUT", () => {
    // WHY THIS FENCE EXISTS: a Standard-Issue weapon's per-shot stats come entirely from its
    // base WEAPON_DEF, so whichever gun this row names is handed out free. The floor gun is
    // the one issued to more hulls than any other. If a retune moves that, this fails and
    // someone re-decides the row instead of the counter quietly becoming a weapon shop.
    const row = REQUISITION_CATALOGUE.weapon;
    expect(row).not.toBeNull();
    const issuedBy = new Map<string, number>();
    for (const loadout of Object.values(COMBAT_DEFAULT_LOADOUT)) {
      for (const weaponId of loadout.weapons) {
        issuedBy.set(weaponId, (issuedBy.get(weaponId) ?? 0) + 1);
      }
    }
    const chosen = row!.mint.kind === "weapon" ? row!.mint.weaponType : "";
    const chosenCount = issuedBy.get(chosen) ?? 0;
    expect(chosenCount, `"${chosen}" is not issued as Standard-Issue by any hull`).toBeGreaterThan(0);
    for (const [weaponId, count] of issuedBy) {
      if (weaponId === chosen) continue;
      expect(chosenCount, `"${weaponId}" is issued more widely than the requisition gun`).toBeGreaterThan(count);
    }
  });

  it("the issued DRONE ROLE is one a hull is already given for free", () => {
    const row = REQUISITION_CATALOGUE.droneBay;
    expect(row).not.toBeNull();
    const chosen = row!.mint.kind === "dronePod" ? row!.mint.droneRole : "";
    const issuedRoles = Object.values(COMBAT_DEFAULT_LOADOUT).flatMap((l) => l.droneRoles as string[]);
    expect(issuedRoles).toContain(chosen);
  });
});

describe("requisitionStandardIssue: every Standard-Issue slot is requisitionable", () => {
  it("issues a well-formed SPARE baseline for each issuable slot", () => {
    for (const { slot, teamType } of ISSUABLE_ROWS) {
      const state = emptyPoolState();
      const result = requisitionStandardIssue(state, slot, teamType);

      expect(result.reason, `refused a requisition for "${slot}"`).toBeNull();
      const piece = result.minted as EquipmentInstance;
      expect(piece, `nothing minted for "${slot}"`).not.toBeNull();

      expect(piece.slotType).toBe(slot);
      expect(piece.fittedToShipId).toBeNull(); // lands in the pool, never pre-installed
      expect(piece.blueprintKey).toBeNull();   // craft-less floor
      expect(piece.rarity).toBe("standard");
      expect(piece.quality).toBe(0);
      // The STRICT baseline predicate, which is what every protection path reads.
      expect(isStandardIssueBaseline(piece)).toBe(true);

      // It is a genuine member of the spare pool, reachable by the pool query.
      expect(result.next.equipment).toContain(piece);
      expect(result.next.equipment.length).toBe(state.equipment.length + 1);
      // The id counter advanced exactly once, so two mints can never collide.
      expect(result.next.nextEquipmentId).toBe(state.nextEquipmentId + 1);
      expect(piece.id).toBe("equip-" + state.nextEquipmentId);

      // Immutable: the input state is untouched and a NEW object came back.
      expect(result.next).not.toBe(state);
      expect(state.equipment.length).toBe(0);
    }
  });

  it("carries the auto-salvage GRACE stamp, at game time", () => {
    // The release that makes this necessary is the same one that ships it: baselines became
    // auto-salvageable, so an unstamped requisition could be queued for teardown before the
    // player got it onto a ship. Game time, never a wall clock, for parity.
    for (const { slot, teamType } of ISSUABLE_ROWS) {
      const state = { ...emptyPoolState(), gameTimeSeconds: 4242 };
      const piece = requisitionStandardIssue(state, slot, teamType).minted as EquipmentInstance;
      expect(piece.graceStartedAtGameSeconds, `no grace stamp on a requisitioned "${slot}"`).toBe(4242);
    }
  });

  it("mints an ECONOMY baseline identical to the one a ship is born with", () => {
    // The requisitioned piece must be the SAME object a seeded ship carries, or a
    // replacement would silently differ from the original. Compared field-for-field against
    // the generator itself, minus the grace stamp (which a clock-free seed cannot carry).
    for (const slot of Object.keys(DEFAULT_EQUIPMENT_VARIETY) as EquipmentSlotType[]) {
      const state = emptyPoolState();
      const got = requisitionStandardIssue(state, slot).minted as EquipmentInstance;
      const reference = generateStandardIssue({
        slotType: slot,
        fittedToShipId: null,
        allocateId: () => got.id,
      });
      const { graceStartedAtGameSeconds: _grace, ...withoutStamp } = got;
      expect(withoutStamp).toEqual(reference);
    }
  });

  it("mints COMBAT baselines at the fixed SI dials, so a hull recomposes to its own numbers", () => {
    // The dials are hull-INDEPENDENT since the 2026-08-27 defense rework (the hull's identity
    // moved into its bare frame + its shield effectiveness ratios). That is exactly what makes
    // a single free counter possible: there are no per-ship variants to model. Asserted so a
    // return to per-hull magnitudes cannot pass silently.
    const state = emptyPoolState();

    const emitter = requisitionStandardIssue(state, "shieldEmitters").minted as EquipmentInstance;
    expect(emitter.implicitStats.shieldCapacity).toBe(SI_EMITTER_CAP);
    expect(emitter.implicitStats.shieldRecharge).toBe(SI_EMITTER_RECHARGE);
    const emitterRef = generateCombatStandardIssue({
      slotType: "shieldEmitters",
      shieldCapacity: SI_EMITTER_CAP,
      shieldRecharge: SI_EMITTER_RECHARGE,
      fittedToShipId: null,
      allocateId: () => emitter.id,
    });
    const { graceStartedAtGameSeconds: _g1, ...emitterNoStamp } = emitter;
    expect(emitterNoStamp).toEqual(emitterRef);

    const plating = requisitionStandardIssue(state, "hullPlating").minted as EquipmentInstance;
    expect(plating.implicitStats.hullStrength).toBe(SI_PLATING_HP);

    // A weapon baseline must name its gun (the base WEAPON_DEF carries the real stats) and a
    // drone pod must name its role; without them the combat bridge cannot reconstruct either.
    const weapon = requisitionStandardIssue(state, "weapon").minted as EquipmentInstance;
    expect(weapon.weaponType).toBeDefined();
    const pod = requisitionStandardIssue(state, "droneBay").minted as EquipmentInstance;
    expect(pod.droneRole).toBeDefined();
  });

  it("is economy-neutral: no mass and no power draw", () => {
    // A baseline that dragged speed or ate reactor budget would make requisitioning one a
    // BALANCE event rather than a floor restoration, and on the economy side it would move
    // mission timings on every save. Both generators mint 0/0; this holds them to it.
    for (const { slot, teamType } of ISSUABLE_ROWS) {
      const piece = requisitionStandardIssue(emptyPoolState(), slot, teamType).minted as EquipmentInstance;
      expect(piece.mass, `"${slot}" baseline has mass`).toBe(0);
      expect(piece.powerDraw, `"${slot}" baseline draws power`).toBe(0);
    }
  });
});

describe("requisitionStandardIssue: storage cap behaviour", () => {
  // Build a state whose spare pool is FULL of crafted systems, so equipmentAtCap is true.
  // Crafted == blueprintKey non-null, which is the exact predicate spareEquipmentCount reads.
  function cappedState(): GameState {
    const base = emptyPoolState();
    const crafted: EquipmentInstance[] = [];
    for (let i = 0; i < EQUIPMENT_STORAGE_CAP_BASE; i++) {
      const piece = generateStandardIssue({
        slotType: "cargoBay",
        fittedToShipId: null,
        allocateId: () => `craft-${i}`,
      });
      crafted.push({ ...piece, blueprintKey: "balancedHoldBp", rarity: "augmented" });
    }
    return { ...base, equipment: crafted };
  }

  it("a requisitioned baseline does NOT occupy spare storage", () => {
    // The cap counts unfitted CRAFTED systems only (spareEquipmentCount, model.ts): a
    // baseline is the free slot floor, not collectible inventory. So the counter cannot push
    // a player over their cap, which is why the gate has no business reading the cap.
    const state = emptyPoolState();
    const before = spareEquipmentCount(state);
    const after = requisitionStandardIssue(state, "hullPlating").next;
    expect(spareEquipmentCount(after)).toBe(before);
  });

  it("STILL ISSUES at a full spare pool: the escape valve is intact", () => {
    // ⚠️ THE ANTI-SOFTLOCK GUARANTEE. A player whose bay is full and whose required combat
    // slot is empty must still be able to fly. Refusing here would recreate the exact dead
    // end this facility was built to remove, and it would refuse on the strength of a number
    // the minted piece cannot even move. Mirrors salvage's own "equipmentAtCap is NOT
    // consulted" posture, pointing the other way.
    const state = cappedState();
    expect(equipmentAtCap(state)).toBe(true); // non-vacuous: the pool really is full
    const result = requisitionStandardIssue(state, "shieldEmitters");
    expect(result.reason).toBeNull();
    expect(result.minted).not.toBeNull();
    // And it still did not grow the capped set.
    expect(spareEquipmentCount(result.next)).toBe(spareEquipmentCount(state));
  });
});

describe("requisitionStandardIssue: the bound, and never a silent no-op", () => {
  it("refuses a SECOND free spare of the same slot, with a stated reason", () => {
    // The bound exists because a free, cap-exempt mint would otherwise grow state.equipment
    // without limit on a held button. It reads as a rule: the counter issues a floor, it does
    // not stock a warehouse.
    const first = requisitionStandardIssue(emptyPoolState(), "reactorCore");
    expect(first.reason).toBeNull();

    const second = requisitionStandardIssue(first.next, "reactorCore");
    expect(second.reason).toBe<RequisitionBlockReason>("alreadyHoldingOne");
    expect(second.minted).toBeNull();
    // Untouched state, not a quietly-mutated one: a refusal must change nothing.
    expect(second.next).toBe(first.next);
    expect(second.next.equipment.length).toBe(first.next.equipment.length);
    expect(second.next.nextEquipmentId).toBe(first.next.nextEquipmentId);
  });

  it("the bound is PER SLOT: holding one does not block a different slot", () => {
    let state = emptyPoolState();
    for (const { slot, teamType } of ISSUABLE_ROWS) {
      const result = requisitionStandardIssue(state, slot, teamType);
      expect(result.reason, `holding other baselines blocked "${slot}" (${teamType})`).toBeNull();
      state = result.next;
    }
    expect(state.equipment.length).toBe(ISSUABLE_ROWS.length);
  });

  it("CANNOT block recovery: installing the spare re-opens the requisition", () => {
    // The property that makes the bound safe. The only way to be refused is to be holding an
    // installable baseline for that very slot; putting it on a ship immediately re-opens the
    // counter, so a player can always fill every empty slot they have.
    const first = requisitionStandardIssue(emptyPoolState(), "weapon");
    const installed = {
      ...first.next,
      equipment: first.next.equipment.map((p) => ({ ...p, fittedToShipId: "ship-1" })),
    };
    const second = requisitionStandardIssue(installed, "weapon");
    expect(second.reason).toBeNull();
    expect(second.minted).not.toBeNull();
  });

  it("a baseline already QUEUED FOR SALVAGE does not count as one you hold", () => {
    // ⚠️ THE HOLE THIS CLOSES. A reserved piece cannot be installed, so counting it would
    // refuse the replacement for a piece that is on its way to being destroyed: the softlock
    // back again, by a quieter route. Both queues reserve identically (reservation.ts), so
    // the player's queue is enough to prove the behaviour.
    const first = requisitionStandardIssue(emptyPoolState(), "hullPlating");
    const held = first.minted as EquipmentInstance;
    expect(freeSpareBaselinesFor(first.next, "hullPlating")).toHaveLength(1);

    const queued: GameState = {
      ...first.next,
      processQueue: [
        {
          id: "q-1",
          facility: "salvageBay",
          order: {
            type: "salvage",
            target: { kind: "equipment", instanceId: held.id },
            mode: { kind: "batch", remaining: 1 },
          },
        },
      ],
    };
    expect(freeSpareBaselinesFor(queued, "hullPlating")).toHaveLength(0);
    const second = requisitionStandardIssue(queued, "hullPlating");
    expect(second.reason).toBeNull();
    expect(second.minted).not.toBeNull();
  });

  it("0.13.9: a baseline COMMITTED to a resting Armory loadout does not count as one you hold", () => {
    // A committed piece belongs to its loadout: the install picker excludes it, so the player
    // cannot put it on a ship from the spare pool. Counting it would refuse a requisition on the
    // strength of a piece that is not actually available.
    const first = requisitionStandardIssue(emptyPoolState(), "hullPlating");
    expect(freeSpareBaselinesFor(first.next, "hullPlating")).toHaveLength(1);

    const committed: GameState = {
      ...first.next,
      equipment: first.next.equipment.map((p) => ({ ...p, committedToLoadoutId: "lo-1" })),
    };
    expect(freeSpareBaselinesFor(committed, "hullPlating")).toHaveLength(0);
    expect(canRequisition(committed, "hullPlating")).toEqual({ ok: true });
    const second = requisitionStandardIssue(committed, "hullPlating");
    expect(second.reason).toBeNull();
    expect(second.minted).not.toBeNull();
  });

  it("dev-granted blueprint-less gear is NOT mistaken for a baseline", () => {
    // isStandardIssueBaseline is strict (blueprint-less AND standard rarity) precisely because
    // dev grants are also blueprint-less while being radiant items. Counting one here would
    // refuse a requisition on the strength of something that is not a floor at all.
    const base = emptyPoolState();
    const grant = {
      ...generateStandardIssue({ slotType: "cargoBay", fittedToShipId: null, allocateId: () => "equip-dev" }),
      rarity: "radiant" as const,
    };
    const state: GameState = { ...base, equipment: [grant] };
    expect(canRequisition(state, "cargoBay").ok).toBe(true);
  });

  it("refuses a slot with no Standard-Issue pattern, and changes nothing", () => {
    for (const slot of NON_ISSUABLE_SLOTS) {
      const state = emptyPoolState();
      const result = requisitionStandardIssue(state, slot);
      expect(result.reason).toBe<RequisitionBlockReason>("noBaselineForSlot");
      expect(result.minted).toBeNull();
      expect(result.next).toBe(state);
    }
  });

  it("every refusal reason has player-facing text", () => {
    // Exhaustive by construction (requisitionBlockText has no default branch), so this only
    // has to prove the strings are real and distinct rather than placeholders.
    const reasons: RequisitionBlockReason[] = ["noBaselineForSlot", "alreadyHoldingOne"];
    const texts = reasons.map((r) => requisitionBlockText(r));
    for (const text of texts) expect(text.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(reasons.length);
  });
});

describe("requisitionStandardIssue: it is a player action, not a tick behaviour", () => {
  it("writes exactly two state keys, so nothing a tick reads can move", () => {
    // ⚠️ THE PARITY CLAIM, ASSERTED RATHER THAN ASSUMED. Requisition resolves immediately in
    // its own pure transform: no timed process, no queue entry, no tick branch. The offline
    // == live parity gate compares what a TICK does, so a transform that touches only the
    // equipment pool and the id counter cannot move it. A key diff is the honest proof.
    const state = emptyPoolState();
    const next = requisitionStandardIssue(state, "cargoBay").next;

    const changed = (Object.keys(next) as (keyof GameState)[]).filter(
      (key) => next[key] !== state[key]
    );
    expect(changed.sort()).toEqual(["equipment", "nextEquipmentId"]);
    // And no key was added or removed: the save SHAPE is identical, which is why this needed
    // no SAVE_VERSION bump.
    expect(Object.keys(next).sort()).toEqual(Object.keys(state).sort());
  });
});

// ============================================================================
// E-CREW 0.14.0 (Task 9): the away-team MEMBER Standard-Issue kit.
// One free Armor / Weapon / Tool per squad (Security, Science), never an implant and never
// Prospecting. Each row mints through generateStandardIssue with its squad's basic variety
// stamped, so the member install gate accepts it for that squad and refuses it for the other.
// ============================================================================
describe("E-CREW Task 9: the away-team member Standard-Issue kit", () => {
  // The deliberate picks (quartermaster.ts records why each is the basic variety for its squad).
  const KIT: { slot: EquipmentSlotType; teamType: AwayTeamType; variety: string; other: AwayTeamType }[] = [
    { slot: "memberArmor", teamType: "security", variety: "ballisticWeave", other: "science" },
    { slot: "memberWeapon", teamType: "security", variety: "pulseRifle", other: "science" },
    { slot: "memberTool", teamType: "security", variety: "medKit", other: "science" },
    { slot: "memberArmor", teamType: "science", variety: "fieldSuit", other: "security" },
    { slot: "memberWeapon", teamType: "science", variety: "sidearm", other: "security" },
    { slot: "memberTool", teamType: "science", variety: "floraScanner", other: "security" },
  ];

  function awayMember(id: string, teamType: AwayTeamType): AwayMember {
    return {
      id,
      teamType,
      spec: teamType === "science" ? "geology" : "offense",
      name: `Member ${id}`,
      race: "earthBorn",
      gender: "female",
      rank: 1,
      traits: [],
      assignedShipId: null, // benched: never crew-locked, so the gate reaches the team check
    };
  }

  it("REQUISITION_ENTRIES carries exactly the six member rows, each keyed by (slot, squad)", () => {
    const memberRows = REQUISITION_ENTRIES.filter((e) => e.teamType !== null);
    expect(memberRows.map((e) => `${e.slotType}:${e.teamType}`).sort()).toEqual(
      KIT.map((k) => `${k.slot}:${k.teamType}`).sort()
    );
    for (const row of memberRows) {
      expect(isMemberSlotType(row.slotType), row.key).toBe(true);
      expect(row.mint.kind).toBe("member");
    }
    // Ship rows never carry a squad and are never member slots.
    for (const row of REQUISITION_ENTRIES.filter((e) => e.teamType === null)) {
      expect(isMemberSlotType(row.slotType), row.key).toBe(false);
    }
    // No implant floor (implants are earned) and no Prospecting row (wired only).
    expect(REQUISITION_CATALOGUE.implant).toBeNull();
    expect(REQUISITION_ENTRIES.some((e) => e.slotType === "implant")).toBe(false);
    expect(REQUISITION_ENTRIES.some((e) => e.teamType === "prospecting")).toBe(false);
  });

  it("each pick is a real variety its squad may wear, labeled from the catalog", () => {
    for (const k of KIT) {
      const variety = memberVariety(k.slot, k.variety);
      expect(variety, `${k.slot}/${k.variety} is not a member variety`).toBeDefined();
      expect(variety!.member.teamTypes).toContain(k.teamType);
      const entry = REQUISITION_ENTRIES.find((e) => e.slotType === k.slot && e.teamType === k.teamType)!;
      expect(entry.mint).toEqual({ kind: "member", varietyKey: k.variety });
      expect(entry.label).toContain(`Standard-Issue ${variety!.label}`);
      expect(entry.blurb.length).toBeGreaterThan(0);
    }
  });

  it("each mints a stat-neutral Standard-Issue baseline stamped with its variety", () => {
    for (const k of KIT) {
      const state = { ...emptyPoolState(), gameTimeSeconds: 77 };
      const result = requisitionStandardIssue(state, k.slot, k.teamType);
      expect(result.reason, `${k.slot}:${k.teamType} refused`).toBeNull();
      const piece = result.minted as EquipmentInstance;
      expect(isStandardIssueBaseline(piece)).toBe(true);
      expect(piece.blueprintKey).toBeNull();
      expect(piece.rarity).toBe("standard");
      expect(piece.quality).toBe(0);
      expect(piece.slotType).toBe(k.slot);
      expect(piece.moduleVariant).toBe(k.variety);
      expect(piece.fittedToShipId).toBeNull();
      expect(piece.fittedToMemberId ?? null).toBeNull(); // a spare worn by nobody
      expect(piece.rolledStats).toEqual({});
      // The variety's own signature lines (or the slot's), every one at the floor magnitude.
      const variety = memberVariety(k.slot, k.variety)!;
      const keys = variety.implicitStats ?? EQUIPMENT_SLOTS[k.slot]!.implicitStats;
      expect(Object.keys(piece.implicitStats).sort()).toEqual([...keys].sort());
      for (const v of Object.values(piece.implicitStats)) expect(v).toBe(0);
      expect(piece.graceStartedAtGameSeconds).toBe(77);
      // Byte-identical to the shared generator told the same variety (minus the grace stamp).
      const reference = generateStandardIssue({
        slotType: k.slot,
        varietyKey: k.variety,
        fittedToShipId: null,
        allocateId: () => piece.id,
      });
      const { graceStartedAtGameSeconds: _g, ...withoutStamp } = piece;
      expect(withoutStamp).toEqual(reference);
    }
  });

  it("canFitToMember accepts it for its squad and refuses it (wrongTeam) for the other", () => {
    for (const k of KIT) {
      const minted = requisitionStandardIssue(emptyPoolState(), k.slot, k.teamType);
      const piece = minted.minted as EquipmentInstance;
      const state: GameState = {
        ...minted.next,
        awayMembers: [awayMember("member-own", k.teamType), awayMember("member-other", k.other)],
      };
      expect(canFitToMember(state, "member-own", piece.id), `${k.slot}:${k.teamType}`).toEqual({ ok: true });
      expect(canFitToMember(state, "member-other", piece.id)).toEqual({ ok: false, reason: "wrongTeam" });
    }
  });

  it("the bound is per (slot, squad): a Security spare never blocks the Science row", () => {
    const sec = requisitionStandardIssue(emptyPoolState(), "memberWeapon", "security");
    expect(sec.reason).toBeNull();
    expect(freeSpareBaselinesFor(sec.next, "memberWeapon", "security")).toHaveLength(1);
    expect(freeSpareBaselinesFor(sec.next, "memberWeapon", "science")).toHaveLength(0);

    // A second Security weapon is refused with the stated reason; the Science one still issues.
    const again = requisitionStandardIssue(sec.next, "memberWeapon", "security");
    expect(again.reason).toBe<RequisitionBlockReason>("alreadyHoldingOne");
    expect(again.next).toBe(sec.next);
    const sci = requisitionStandardIssue(sec.next, "memberWeapon", "science");
    expect(sci.reason).toBeNull();
    expect((sci.minted as EquipmentInstance).moduleVariant).toBe("sidearm");
    expect(requisitionStandardIssue(sci.next, "memberWeapon", "science").reason).toBe("alreadyHoldingOne");
  });

  it("installing the spare on a member re-opens the row (it cannot block recovery)", () => {
    const first = requisitionStandardIssue(emptyPoolState(), "memberArmor", "science");
    const piece = first.minted as EquipmentInstance;
    const state: GameState = { ...first.next, awayMembers: [awayMember("member-1", "science")] };
    expect(canRequisition(state, "memberArmor", "science").ok).toBe(false);
    const worn = fitToMember(state, "member-1", piece.id);
    expect(canRequisition(worn, "memberArmor", "science")).toEqual({ ok: true });
  });

  it("refuses a squad the slot has no row for, and a ship slot asked for a squad", () => {
    const state = emptyPoolState();
    // A member slot needs a squad; Prospecting has no floor; implants have none at all.
    expect(canRequisition(state, "memberWeapon")).toEqual({ ok: false, reason: "noBaselineForSlot" });
    expect(canRequisition(state, "memberWeapon", "prospecting")).toEqual({ ok: false, reason: "noBaselineForSlot" });
    expect(canRequisition(state, "implant", "security")).toEqual({ ok: false, reason: "noBaselineForSlot" });
    // A ship row is never keyed by a squad.
    expect(canRequisition(state, "cargoBay", "security")).toEqual({ ok: false, reason: "noBaselineForSlot" });
    const refused = requisitionStandardIssue(state, "memberTool");
    expect(refused.minted).toBeNull();
    expect(refused.next).toBe(state);
  });

  it("the ship floors are untouched: no member slot is an economy floor, and economy baselines gain no stamp", () => {
    for (const slot of ECONOMY_FLOOR_SLOTS) expect(isMemberSlotType(slot), slot).toBe(false);
    for (const slot of Object.keys(DEFAULT_EQUIPMENT_VARIETY) as EquipmentSlotType[]) {
      const piece = generateStandardIssue({ slotType: slot, fittedToShipId: null, allocateId: () => "equip-1" });
      expect("moduleVariant" in piece, slot).toBe(false);
    }
    // A member slot has no default variety, so the generator refuses it without an explicit one,
    // and refuses a variety its slot does not have.
    expect(() =>
      generateStandardIssue({ slotType: "memberArmor", fittedToShipId: null, allocateId: () => "equip-1" })
    ).toThrow();
    expect(() =>
      generateStandardIssue({
        slotType: "memberArmor",
        varietyKey: "pulseRifle",
        fittedToShipId: null,
        allocateId: () => "equip-1",
      })
    ).toThrow();
  });

  it("a spare member baseline follows the baseline salvage rules: destroyed for nothing, auto-protected by default", () => {
    const first = requisitionStandardIssue(emptyPoolState(), "memberTool", "security");
    const piece = first.minted as EquipmentInstance;
    // Auto-salvage: protected as a Standard-Issue baseline until the player's rules reach it.
    expect(autoSalvageProtectionForTarget(first.next, { kind: "equipment", instanceId: piece.id })).toBe("baseline");
    // Manual salvage: the zero-reward declutter every spare baseline gets (never a crafted recycle).
    const result = salvageEquipment(first.next, piece.id, () => 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a declutter");
    expect(result.next.equipment.find((e) => e.id === piece.id)).toBeUndefined();
    expect(Object.keys(result.recovered)).toHaveLength(0);
    expect(result.next.inventory).toBe(first.next.inventory);
  });
});

describe("E-CREW Task 10: requisition text names the piece once and the squad on member rows", () => {
  it("every row's issued name carries the Standard-Issue prefix exactly once", () => {
    for (const e of REQUISITION_ENTRIES) {
      expect(e.issuedName.startsWith("Standard-Issue "), e.key).toBe(true);
      expect(e.issuedName.split("Standard-Issue").length - 1, e.key).toBe(1);
    }
    const rifle = REQUISITION_ENTRIES.find((e) => e.slotType === "memberWeapon" && e.teamType === "security")!;
    expect(rifle.issuedName).toBe("Standard-Issue Pulse Rifle");
    expect(REQUISITION_ENTRIES.find((e) => e.slotType === "weapon")!.issuedName).toBe("Standard-Issue Autocannon");
    expect(REQUISITION_ENTRIES.find((e) => e.slotType === "cargoBay")!.issuedName).toBe(
      `Standard-Issue ${EQUIPMENT_SLOTS.cargoBay!.label}`
    );
  });

  it("a member row's held-one refusal speaks of the squad, a ship row's of the slot", () => {
    expect(requisitionBlockText("alreadyHoldingOne")).toContain("for this slot");
    expect(requisitionBlockText("alreadyHoldingOne", "security")).toContain("for this squad");
    expect(requisitionBlockText("alreadyHoldingOne", "security")).not.toContain("slot");
  });
});
