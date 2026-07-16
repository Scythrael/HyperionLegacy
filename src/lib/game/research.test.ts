// Research feature -- Task R1 (docs/plans/2026-07-15-research-{design,plan}.md).
// The BLUEPRINT DATA MODEL only: the BLUEPRINTS registry + BlueprintDef shape, the
// GameState.researchedBlueprints unlocked-keys field, and the two pure availability
// helpers (blueprintUnlocked / blueprintResearchable). The Research facility (R2),
// the research-project engine (R3), the canResearch gate (R4), and the UI (R5) are
// LATER tasks -- nothing here exercises them.
//
// These tests are the R1 contract:
//   1. Every BLUEPRINTS entry is well-formed: tier >= 1, positive duration + credit
//      cost, an outputItem + every recipe input key resolving to a REAL ITEMS entry,
//      positive outputQty + input amounts.
//   2. The proposed first-pass set exists at the expected tiers (tier-1 components +
//      a tier-2 major component) so the tier gate has something real to gate.
//   3. A fresh state seeds researchedBlueprints as [].
//   4. blueprintUnlocked is false on a fresh state, true once a key is added.
//   5. blueprintResearchable gates on the research-facility LEVEL: a tier-1 blueprint
//      is researchable once the facility is level >= 1 (R2 seeds it there), a tier-2
//      one is NOT until level >= 2; an already-unlocked blueprint is not researchable.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  BLUEPRINTS,
  ITEMS,
  FACILITIES,
  blueprintUnlocked,
  blueprintResearchable,
  RESEARCH_FACILITY_KEY,
} from "./model";
import type { GameState } from "./model";
import type { TimedProcess } from "./model";
import {
  researchSlotCount,
  canBuildFacilityUpgrade,
  startFacilityUpgrade,
  startResearch,
  canResearch,
  resolveProcesses,
  economyTick,
  tick,
} from "./tick";
import type { ResearchBlockReason } from "./tick";

describe("Research R1 — BLUEPRINTS registry is well-formed", () => {
  it("is non-empty", () => {
    expect(Object.keys(BLUEPRINTS).length).toBeGreaterThan(0);
  });

  it("every entry: key matches its map key, tier >= 1, positive duration + credit cost", () => {
    for (const [key, bp] of Object.entries(BLUEPRINTS)) {
      expect(bp.key).toBe(key); // the `key` field mirrors the registry key (no drift)
      expect(typeof bp.label).toBe("string");
      expect(bp.label.length).toBeGreaterThan(0);
      expect(Number.isInteger(bp.tier)).toBe(true);
      expect(bp.tier).toBeGreaterThanOrEqual(1);
      expect(bp.researchDurationTicks).toBeGreaterThan(0);
      expect(bp.researchCreditCost).toBeGreaterThan(0);
    }
  });

  it("every recipe resolves to REAL ITEMS keys, with positive quantities", () => {
    for (const [key, bp] of Object.entries(BLUEPRINTS)) {
      // outputItem must be a real registry item, output quantity positive.
      expect(ITEMS[bp.recipe.outputItem], `${key} outputItem`).toBeDefined();
      expect(bp.recipe.outputQty).toBeGreaterThan(0);
      // Every recipe INPUT key must be a real registry item with a positive amount.
      const inputKeys = Object.keys(bp.recipe.inputs);
      expect(inputKeys.length, `${key} has >=1 input`).toBeGreaterThan(0);
      for (const inputKey of inputKeys) {
        expect(ITEMS[inputKey], `${key} input ${inputKey}`).toBeDefined();
        expect(bp.recipe.inputs[inputKey]).toBeGreaterThan(0);
      }
    }
  });

  it("seeds the proposed first-pass set at the expected tiers", () => {
    // Tier 1 -- basic components (minorComponent items).
    expect(BLUEPRINTS.frameSegmentBp).toBeDefined();
    expect(BLUEPRINTS.frameSegmentBp.tier).toBe(1);
    expect(BLUEPRINTS.frameSegmentBp.recipe.outputItem).toBe("frameSegment");

    expect(BLUEPRINTS.powerCouplingBp).toBeDefined();
    expect(BLUEPRINTS.powerCouplingBp.tier).toBe(1);
    expect(BLUEPRINTS.powerCouplingBp.recipe.outputItem).toBe("powerCoupling");

    // Tier 2 -- a major component built from tier-1 minor components + refined mats.
    expect(BLUEPRINTS.structuralAssemblyBp).toBeDefined();
    expect(BLUEPRINTS.structuralAssemblyBp.tier).toBe(2);
    expect(BLUEPRINTS.structuralAssemblyBp.recipe.outputItem).toBe("structuralAssembly");
  });
});

describe("Research R1 — GameState.researchedBlueprints seed", () => {
  it("fresh state seeds researchedBlueprints as an empty array", () => {
    expect(freshState().researchedBlueprints).toEqual([]);
  });
});

describe("Research R1 — blueprintUnlocked", () => {
  it("is false for every blueprint on a fresh state", () => {
    const state = freshState();
    for (const key of Object.keys(BLUEPRINTS)) {
      expect(blueprintUnlocked(state, key)).toBe(false);
    }
  });

  it("is true once a key is present in researchedBlueprints", () => {
    const state = freshState();
    state.researchedBlueprints = ["frameSegmentBp"];
    expect(blueprintUnlocked(state, "frameSegmentBp")).toBe(true);
    expect(blueprintUnlocked(state, "powerCouplingBp")).toBe(false);
  });

  it("is false for an unknown key", () => {
    expect(blueprintUnlocked(freshState(), "notABlueprint")).toBe(false);
  });
});

describe("Research R1 — blueprintResearchable (tier gated by research-facility level)", () => {
  // Helper: a fresh state with the research facility seeded at a chosen level. R2 will
  // add FACILITIES.research + seed it at level 1 in freshState; R1 has no facility yet,
  // so we inject the level directly here to prove the tier-gate logic works the moment
  // that level exists. RESEARCH_FACILITY_KEY is the single source of truth for the key.
  function stateWithResearchLevel(level: number): GameState {
    const state = freshState();
    state.facilities[RESEARCH_FACILITY_KEY] = { level };
    return state;
  }

  it("is FALSE for a tier-1 blueprint when the facility is absent (level 0 default)", () => {
    // R2 UPDATE: freshState now SEEDS the research facility at level 1 (see the R2
    // block below), so a bare freshState makes tier-1 researchable. To still exercise
    // the DEFENSIVE absent-facility read (absent key -> level 0 -> tier 1 > 0), we
    // explicitly DELETE the seeded facility here. The intent of this R1 test -- that a
    // missing facility reads as level 0 and gates tier-1 out -- is unchanged.
    const state = freshState();
    delete (state.facilities as Record<string, { level: number }>)[RESEARCH_FACILITY_KEY];
    expect(blueprintResearchable(state, "frameSegmentBp")).toBe(false);
  });

  it("is TRUE for a tier-1 blueprint once the facility is level >= 1", () => {
    const state = stateWithResearchLevel(1);
    expect(blueprintResearchable(state, "frameSegmentBp")).toBe(true);
    expect(blueprintResearchable(state, "powerCouplingBp")).toBe(true);
  });

  it("is FALSE for a tier-2 blueprint at facility level 1, TRUE at level 2", () => {
    expect(blueprintResearchable(stateWithResearchLevel(1), "structuralAssemblyBp")).toBe(false);
    expect(blueprintResearchable(stateWithResearchLevel(2), "structuralAssemblyBp")).toBe(true);
  });

  it("is FALSE for an already-researched blueprint even when tier-available", () => {
    const state = stateWithResearchLevel(1);
    state.researchedBlueprints = ["frameSegmentBp"];
    expect(blueprintResearchable(state, "frameSegmentBp")).toBe(false);
  });

  it("is FALSE for an unknown blueprint key", () => {
    expect(blueprintResearchable(stateWithResearchLevel(5), "notABlueprint")).toBe(false);
  });
});

// ============================================================================
// Task R2 -- the Research Lab FACILITY (docs/plans/2026-07-15-research-{design,
// plan}.md R2 + design §1). A finite upgrade track that gates blueprint TIERS
// (via the facility LEVEL, which blueprintResearchable already reads) and derives
// the number of concurrent research SLOTS. Fresh state seeds it at level 1 so
// tier-1 is researchable from the start (no soft-lock, mirrors Mission Control).
//
// COST MODEL (locked design decision #3 + §6): the level 1->2 upgrade is gated on
// CREDITS, NOT materials -- "credits get a real long-term sink; materials are the
// Fabricator's job". The facility-upgrade framework had no credits gate before R2;
// R2 adds an OPTIONAL `credits` field to FacilityUpgradeDef (inert for every existing
// facility, none of which set it). These tests pin that credit gate + the deduct.
// ============================================================================
describe("Research R2 — Research Lab facility (tier + slot upgrade track)", () => {
  it("FACILITIES.research exists, is labelled 'Research Lab', with a FINITE 2-level track", () => {
    const research = FACILITIES[RESEARCH_FACILITY_KEY];
    expect(research).toBeDefined();
    expect(research.label).toBe("Research Lab");
    // Caps at REAL content: level 1 (founding = tier-1) + level 2 (tier-2). Only tiers
    // 1 and 2 of blueprints exist today, so there is NO rung beyond tier 2 (no placeholder).
    expect(research.upgrades.length).toBe(2);
  });

  it("the founding rung (level 0->1) is zero-cost/ungated and grants the FIRST research slot", () => {
    const founding = FACILITIES[RESEARCH_FACILITY_KEY].upgrades[0];
    expect(Object.keys(founding.materials).length).toBe(0); // no material cost
    expect(founding.credits).toBeUndefined();               // pre-granted -> no credit gate
    expect(founding.requiresFleetAdminLevel).toBeUndefined();
    expect(founding.effect).toEqual({ addResearchSlots: 1 }); // establishes the lab's first slot
  });

  it("the level 1->2 rung is CREDIT-gated (no materials), and adds the 2nd research slot", () => {
    const rung = FACILITIES[RESEARCH_FACILITY_KEY].upgrades[1];
    expect(Object.keys(rung.materials).length).toBe(0);      // locked design #3: NO materials
    expect(rung.credits).toBeDefined();
    expect((rung.credits as Decimal).gt(0)).toBe(true);      // a real credit cost
    expect(rung.effect).toEqual({ addResearchSlots: 1 });    // +1 slot on this chosen rung
  });

  it("fresh state seeds the research facility at level 1", () => {
    expect(freshState().facilities[RESEARCH_FACILITY_KEY]).toEqual({ level: 1 });
  });

  it("researchSlotCount is 1 on a fresh state (level 1 = one slot)", () => {
    expect(researchSlotCount(freshState())).toBe(1);
  });

  it("researchSlotCount rises to 2 once the research facility reaches level 2", () => {
    const state = freshState();
    state.facilities[RESEARCH_FACILITY_KEY] = { level: 2 };
    expect(researchSlotCount(state)).toBe(2);
  });

  it("researchSlotCount is 0 when the facility is absent (defensive level-0 read)", () => {
    const state = freshState();
    delete (state.facilities as Record<string, { level: number }>)[RESEARCH_FACILITY_KEY];
    expect(researchSlotCount(state)).toBe(0);
  });

  it("tier-1 blueprints are researchable from a FRESH state; tier-2 is not (until upgrade)", () => {
    const state = freshState();
    expect(blueprintResearchable(state, "frameSegmentBp")).toBe(true);       // tier 1 <= level 1
    expect(blueprintResearchable(state, "powerCouplingBp")).toBe(true);      // tier 1 <= level 1
    expect(blueprintResearchable(state, "structuralAssemblyBp")).toBe(false); // tier 2 > level 1
  });

  it("leveling the research facility to 2 makes the tier-2 blueprint researchable", () => {
    const state = freshState();
    state.facilities[RESEARCH_FACILITY_KEY] = { level: 2 };
    expect(blueprintResearchable(state, "structuralAssemblyBp")).toBe(true);
  });

  it("the upgrade track CAPS at real content: a level-2 lab reports fully upgraded", () => {
    const state = freshState();
    state.facilities[RESEARCH_FACILITY_KEY] = { level: 2 };
    const check = canBuildFacilityUpgrade(state, RESEARCH_FACILITY_KEY);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/fully upgraded/i); // no rung beyond tier 2
  });

  it("the level 1->2 CREDIT gate blocks when broke even if all other gates pass", () => {
    // High FA level clears the FA-level prereq, so CREDITS are the sole remaining gate.
    const state: GameState = { ...freshState(), fleetAdminLevel: 99, credits: new Decimal(0) };
    const check = canBuildFacilityUpgrade(state, RESEARCH_FACILITY_KEY);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/credit/i); // the credit gate names itself
  });

  it("the level 1->2 rung is buildable once affordable + FA-level met", () => {
    const rung = FACILITIES[RESEARCH_FACILITY_KEY].upgrades[1];
    const funded: GameState = {
      ...freshState(),
      fleetAdminLevel: 99,
      credits: (rung.credits as Decimal).plus(1),
    };
    expect(canBuildFacilityUpgrade(funded, RESEARCH_FACILITY_KEY).ok).toBe(true);
  });

  it("startFacilityUpgrade DEDUCTS the rung's credits at start and queues the level-up", () => {
    const rung = FACILITIES[RESEARCH_FACILITY_KEY].upgrades[1];
    const cost = rung.credits as Decimal;
    const state: GameState = { ...freshState(), fleetAdminLevel: 99, credits: cost.plus(500) };
    const { next, started } = startFacilityUpgrade(state, RESEARCH_FACILITY_KEY);
    expect(started).toBe(true);
    expect(next.credits.equals(500)).toBe(true); // credits deducted atomically at start
    // A facilityUpgrade process targeting the research facility is now in flight.
    const queued = next.activeProcesses.some(
      (p) =>
        p.kind === "facilityUpgrade" &&
        p.effect.type === "facilityLevelUp" &&
        (p.effect as { facility: string }).facility === RESEARCH_FACILITY_KEY
    );
    expect(queued).toBe(true);
  });
});

// ============================================================================
// Task R3 -- the research-project ENGINE (docs/plans/2026-07-15-research-{design,
// plan}.md R3 + design §3). startResearch starts a timed research project on a
// researchable blueprint (deduct credits at start, respect the slot cap); when the
// project's TimedProcess completes inside resolveProcesses its `unlockBlueprint`
// effect adds the blueprint key to researchedBlueprints. Research runs as an ORDINARY
// timed process stepped inside economyTick, so tick(bigSpan) == looping
// economyTick(_,1) bit-identical -- the ⚠️ offline-parity seam the controller re-verifies.
//
// NOTE (return contract): startResearch mirrors the START family (startProcess /
// startRefineJob / startFacilityUpgrade) with { next, started }, and is a same-REFERENCE
// no-op on any failed gate -- the basic gate R3 ships. R4 adds the full typed-reason
// canResearch and refactors startResearch to use it.
// ============================================================================
describe("Research R3 — startResearch (start a timed research project)", () => {
  it("deducts researchCreditCost at start and pushes a researchProject process", () => {
    const cost = BLUEPRINTS.frameSegmentBp.researchCreditCost; // 500
    const state: GameState = { ...freshState(), credits: new Decimal(cost + 250) };
    const { next, started } = startResearch(state, "frameSegmentBp");
    expect(started).toBe(true);
    // Credits deducted ONCE at start (a discrete event -> parity-safe).
    expect(next.credits.equals(250)).toBe(true);
    // Exactly one researchProject process, carrying the unlockBlueprint effect for this key,
    // with remainingTicks seeded from the blueprint's researchDurationTicks.
    const proj = next.activeProcesses.filter((p) => p.kind === "researchProject");
    expect(proj.length).toBe(1);
    expect(proj[0].effect).toEqual({ type: "unlockBlueprint", key: "frameSegmentBp" });
    expect(proj[0].remainingTicks).toBe(BLUEPRINTS.frameSegmentBp.researchDurationTicks);
    expect(proj[0].durationTicks).toBe(BLUEPRINTS.frameSegmentBp.researchDurationTicks);
  });

  it("is a same-REFERENCE no-op when the blueprint is unaffordable", () => {
    const cost = BLUEPRINTS.frameSegmentBp.researchCreditCost;
    const state: GameState = { ...freshState(), credits: new Decimal(cost - 1) };
    const result = startResearch(state, "frameSegmentBp");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state); // no clone -- nothing changed
  });

  it("is a same-REFERENCE no-op when the blueprint is not researchable (tier-locked)", () => {
    // freshState research level is 1 -> the tier-2 structuralAssemblyBp is NOT researchable.
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    const result = startResearch(state, "structuralAssemblyBp");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
  });

  it("is a same-REFERENCE no-op for an already-researched blueprint", () => {
    const state: GameState = {
      ...freshState(),
      credits: new Decimal(1_000_000),
      researchedBlueprints: ["frameSegmentBp"],
    };
    const result = startResearch(state, "frameSegmentBp");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
  });

  it("is a same-REFERENCE no-op for an unknown blueprint key", () => {
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    const result = startResearch(state, "notABlueprint");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
  });

  it("does NOT let two projects run against the SAME blueprint (in-progress gate)", () => {
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    const once = startResearch(state, "frameSegmentBp");
    expect(once.started).toBe(true);
    // A project for frameSegmentBp is now in flight -> blueprintResearchable is false for it.
    const twice = startResearch(once.next, "frameSegmentBp");
    expect(twice.started).toBe(false);
    expect(twice.next).toBe(once.next);
  });

  it("respects the slot cap: a 2nd concurrent project is blocked when all slots are full", () => {
    // freshState research level 1 -> researchSlotCount 1. One project fills the only slot.
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    expect(researchSlotCount(state)).toBe(1);
    const first = startResearch(state, "frameSegmentBp");
    expect(first.started).toBe(true);
    const second = startResearch(first.next, "powerCouplingBp"); // a DIFFERENT researchable tier-1 bp
    expect(second.started).toBe(false); // no free slot
    expect(second.next).toBe(first.next);
  });

  it("allows TWO concurrent projects once the lab is level 2 (2 slots)", () => {
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    state.facilities[RESEARCH_FACILITY_KEY] = { level: 2 };
    expect(researchSlotCount(state)).toBe(2);
    const first = startResearch(state, "frameSegmentBp");
    expect(first.started).toBe(true);
    const second = startResearch(first.next, "powerCouplingBp");
    expect(second.started).toBe(true);
    expect(second.next.activeProcesses.filter((p) => p.kind === "researchProject").length).toBe(2);
  });
});

describe("Research R3 — resolveProcesses completes a research project", () => {
  it("unlocks the blueprint on completion (idempotent add) and awards NO Fleet Admiral XP", () => {
    const cost = BLUEPRINTS.frameSegmentBp.researchCreditCost;
    const dur = BLUEPRINTS.frameSegmentBp.researchDurationTicks;
    const state: GameState = { ...freshState(), credits: new Decimal(cost) };
    const { next } = startResearch(state, "frameSegmentBp");
    // Advance past the full duration in one resolve.
    const { next: done, fleetAdminXpDelta } = resolveProcesses(next, dur);
    expect(done.researchedBlueprints).toContain("frameSegmentBp");
    expect(blueprintUnlocked(done, "frameSegmentBp")).toBe(true);
    // The project process is consumed (resolved exactly once, removed).
    expect(done.activeProcesses.filter((p) => p.kind === "researchProject").length).toBe(0);
    // No FA XP for research (automated infra -- mirrors the fuel-refine exclusion).
    expect(fleetAdminXpDelta).toBe(0);
  });

  it("is idempotent: a completing project never duplicates an already-present key", () => {
    // Craft a state where the key is ALREADY researched AND a matching project is mid-flight
    // (a state normal play can't reach, but resolveProcesses must still not double-add).
    const proc: TimedProcess = {
      id: "proc-test",
      kind: "researchProject",
      remainingTicks: 1,
      durationTicks: 1,
      effect: { type: "unlockBlueprint", key: "frameSegmentBp" },
    };
    const state: GameState = {
      ...freshState(),
      researchedBlueprints: ["frameSegmentBp"],
      activeProcesses: [proc],
    };
    const { next: done } = resolveProcesses(state, 1);
    expect(done.researchedBlueprints).toEqual(["frameSegmentBp"]); // no duplicate
  });
});

describe("⚠️ Research R3 REQUIRED offline==live PARITY — a research project completes mid-span", () => {
  // Research runs as an ordinary timed process stepped inside economyTick, so a big
  // offline catch-up (tick(bigSpan), which internally steps economyTick(_,1)) must be
  // BIT-IDENTICAL to looping economyTick(_,1) live -- for researchedBlueprints, credits,
  // and activeProcesses -- across a span where the project COMPLETES mid-span. rng ()=>0
  // is irrelevant (no captain is on a mission) but pinned per the parity idiom.
  const DUR = BLUEPRINTS.frameSegmentBp.researchDurationTicks; // 60
  const COST = BLUEPRINTS.frameSegmentBp.researchCreditCost; // 500
  const BIG_SPAN = 100; // > DUR, so the project completes well inside the span
  const RNG = () => 0;

  // A fresh, research-started state (project in flight, credits already deducted once).
  // Built per path so neither path mutates the other's input.
  const seed = (): GameState => {
    const s: GameState = { ...freshState(), credits: new Decimal(COST + 250) };
    const { next, started } = startResearch(s, "frameSegmentBp");
    expect(started).toBe(true);
    return next;
  };

  // The three fields the parity claim covers, in a JSON-comparable shape.
  const snap = (st: GameState) => ({
    researchedBlueprints: st.researchedBlueprints,
    credits: st.credits.toString(),
    activeProcesses: st.activeProcesses.map((p) => ({
      id: p.id,
      kind: p.kind,
      remainingTicks: p.remainingTicks,
      durationTicks: p.durationTicks,
      effect: p.effect,
    })),
  });

  it("tick(BIG_SPAN) == looping economyTick(_,1) bit-identical (research completed mid-span)", () => {
    const offline = tick(BIG_SPAN, seed(), RNG); // internally steps economyTick(_,1)

    let live = seed();
    for (let i = 0; i < BIG_SPAN; i++) live = economyTick(live, 1, RNG);

    // BIT-IDENTICAL across every field the parity claim covers.
    expect(snap(offline)).toEqual(snap(live));

    // NON-VACUOUS: the research actually COMPLETED within the span.
    expect(offline.researchedBlueprints).toContain("frameSegmentBp"); // blueprint unlocked
    expect(offline.activeProcesses.filter((p) => p.kind === "researchProject").length).toBe(0); // process consumed
    // Credits were deducted EXACTLY once (at start), never per-tick.
    expect(offline.credits.equals(250)).toBe(true);
  });
});

// ============================================================================
// Task R4 -- the availability GATE + typed reasons (docs/plans/2026-07-15-research-
// {design,plan}.md R4 + design §3). canResearch consolidates startResearch's three
// inline R3 gates (researchable / free slot / affordable) into ONE pure predicate
// that returns { ok: true } or { ok: false; reason } -- MIRRORING canDispatch, the
// mission-rework gate. The reason union lets the R5 UI switch on each block to render
// a disabled Research button with its cause. startResearch is refactored to a THIN
// WRAPPER: it consults canResearch, and on a block returns the SAME state ref +
// started:false + the reason (additive `reason?`, mirroring dispatchCaptainOnMission).
//
// GATE ORDER (cheapest/most-fundamental first -- determines WHICH reason surfaces when
// several fail at once; ok itself is order-independent, all must pass):
//   notFound -> alreadyResearched -> inProgress -> tierLocked -> noSlot -> credits
// ============================================================================
describe("Research R4 — canResearch (typed-reason availability gate)", () => {
  // A fresh, funded state: research level 1 (tier-1 researchable), one free slot, and
  // plenty of credits -- so tier-1 blueprints pass EVERY gate unless a test unmeets one.
  const funded = (): GameState => ({ ...freshState(), credits: new Decimal(1_000_000) });

  it("returns { ok: true } when researchable + a free slot + affordable", () => {
    const result = canResearch(funded(), "frameSegmentBp");
    expect(result.ok).toBe(true);
  });

  it("reason 'notFound' for an unknown blueprint key", () => {
    const result = canResearch(funded(), "notABlueprint");
    expect(result).toEqual({ ok: false, reason: "notFound" });
  });

  it("reason 'alreadyResearched' for a blueprint already in researchedBlueprints", () => {
    const state: GameState = { ...funded(), researchedBlueprints: ["frameSegmentBp"] };
    const result = canResearch(state, "frameSegmentBp");
    expect(result).toEqual({ ok: false, reason: "alreadyResearched" });
  });

  it("reason 'inProgress' when a project for this key is already in flight", () => {
    const { next, started } = startResearch(funded(), "frameSegmentBp");
    expect(started).toBe(true);
    const result = canResearch(next, "frameSegmentBp");
    expect(result).toEqual({ ok: false, reason: "inProgress" });
  });

  it("reason 'tierLocked' when the blueprint's tier exceeds the research-facility level", () => {
    // freshState research level 1 -> the tier-2 structuralAssemblyBp is above the lab tier.
    const result = canResearch(funded(), "structuralAssemblyBp");
    expect(result).toEqual({ ok: false, reason: "tierLocked" });
  });

  it("reason 'noSlot' when every research slot is busy", () => {
    // Level 1 -> 1 slot. Fill it with a DIFFERENT researchable tier-1 project, then ask
    // about a second tier-1 blueprint: researchable + affordable, but no free slot.
    const { next, started } = startResearch(funded(), "frameSegmentBp");
    expect(started).toBe(true);
    expect(researchSlotCount(next)).toBe(1);
    const result = canResearch(next, "powerCouplingBp");
    expect(result).toEqual({ ok: false, reason: "noSlot" });
  });

  it("reason 'credits' when the blueprint is unaffordable", () => {
    const cost = BLUEPRINTS.frameSegmentBp.researchCreditCost; // 500
    const state: GameState = { ...freshState(), credits: new Decimal(cost - 1) };
    const result = canResearch(state, "frameSegmentBp");
    expect(result).toEqual({ ok: false, reason: "credits" });
  });

  // --- Gate-ORDER precedence: when several conditions fail at once, the EARLIER gate
  // wins. These pin the documented order so a future reshuffle is caught.
  it("alreadyResearched OUTRANKS credits (earlier gate wins when both fail)", () => {
    // Already researched AND broke -> the earlier alreadyResearched gate surfaces.
    const state: GameState = {
      ...freshState(),
      credits: new Decimal(0),
      researchedBlueprints: ["frameSegmentBp"],
    };
    const result = canResearch(state, "frameSegmentBp");
    expect(result).toEqual({ ok: false, reason: "alreadyResearched" });
  });

  it("tierLocked OUTRANKS credits (a broke, tier-locked blueprint reports tierLocked)", () => {
    // Tier-2 blueprint at lab level 1 AND zero credits -> tierLocked precedes credits.
    const state: GameState = { ...freshState(), credits: new Decimal(0) };
    const result = canResearch(state, "structuralAssemblyBp");
    expect(result).toEqual({ ok: false, reason: "tierLocked" });
  });

  it("a ResearchBlockReason value narrows on ok:false (type-level sanity)", () => {
    const result = canResearch(funded(), "notABlueprint");
    if (!result.ok) {
      const reason: ResearchBlockReason = result.reason;
      expect(reason).toBe("notFound");
    }
  });
});

// ============================================================================
// Task R4 -- startResearch is refactored to CONSUME canResearch. Behavior-preserving:
// the success + credit-deduct + process-start path is UNCHANGED (still covered by the
// R3 startResearch block above); this block pins the NEW additive `reason?` field --
// undefined on success, the canResearch reason on each block -- and re-confirms the
// same-REFERENCE no-op convention on every blocked path.
// ============================================================================
describe("Research R4 — startResearch exposes canResearch's reason", () => {
  it("on success: started true, reason undefined, credits deducted, process pushed", () => {
    const cost = BLUEPRINTS.frameSegmentBp.researchCreditCost; // 500
    const state: GameState = { ...freshState(), credits: new Decimal(cost + 250) };
    const result = startResearch(state, "frameSegmentBp");
    expect(result.started).toBe(true);
    expect(result.reason).toBeUndefined(); // no reason on a successful start
    // The R3 success path is intact: credits deducted once, one researchProject queued.
    expect(result.next.credits.equals(250)).toBe(true);
    expect(result.next.activeProcesses.filter((p) => p.kind === "researchProject").length).toBe(1);
  });

  it("on unaffordable: same-ref no-op + reason 'credits'", () => {
    const cost = BLUEPRINTS.frameSegmentBp.researchCreditCost;
    const state: GameState = { ...freshState(), credits: new Decimal(cost - 1) };
    const result = startResearch(state, "frameSegmentBp");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
    expect(result.reason).toBe("credits");
  });

  it("on unknown key: same-ref no-op + reason 'notFound'", () => {
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    const result = startResearch(state, "notABlueprint");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
    expect(result.reason).toBe("notFound");
  });

  it("on tier-locked: same-ref no-op + reason 'tierLocked'", () => {
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    const result = startResearch(state, "structuralAssemblyBp");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
    expect(result.reason).toBe("tierLocked");
  });

  it("on already-researched: same-ref no-op + reason 'alreadyResearched'", () => {
    const state: GameState = {
      ...freshState(),
      credits: new Decimal(1_000_000),
      researchedBlueprints: ["frameSegmentBp"],
    };
    const result = startResearch(state, "frameSegmentBp");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
    expect(result.reason).toBe("alreadyResearched");
  });

  it("on in-progress: same-ref no-op + reason 'inProgress'", () => {
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    const once = startResearch(state, "frameSegmentBp");
    expect(once.started).toBe(true);
    const twice = startResearch(once.next, "frameSegmentBp");
    expect(twice.started).toBe(false);
    expect(twice.next).toBe(once.next);
    expect(twice.reason).toBe("inProgress");
  });

  it("on no free slot: same-ref no-op + reason 'noSlot'", () => {
    const state: GameState = { ...freshState(), credits: new Decimal(1_000_000) };
    const first = startResearch(state, "frameSegmentBp");
    expect(first.started).toBe(true);
    const second = startResearch(first.next, "powerCouplingBp");
    expect(second.started).toBe(false);
    expect(second.next).toBe(first.next);
    expect(second.reason).toBe("noSlot");
  });
});
