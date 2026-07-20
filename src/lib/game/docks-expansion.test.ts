// ============================================================================
// Docks capacity upgrade (raise the max ships at the docks), Fleet Management.
//
// GameState.shipStorageCapacity (base 8) caps the fleet at ship build
// (canStartShipBuild -> "storageFull"). This suite covers the TIMED, costed
// "Expand Docks" upgrade that raises that cap by +1 per rung, MIRRORING the
// equipment Systems-Bay upgrade (equipment-storage.test.ts): a dedicated
// TimedProcessKind ("docksExpansion") + a ProcessEffect ("docksCapacityUp") +
// a canX/startX pair delegating to startProcess + a deterministic completion
// branch in resolveProcesses.
//
// KEY DIVERGENCE from the equipment track: there is NO separate stored level.
// shipStorageCapacity is the SINGLE SOURCE, so the current rung index is
// DERIVED (shipStorageCapacity - SHIP_DOCKS_BASE) and the effect mutates
// shipStorageCapacity directly (+1). canStartShipBuild is UNCHANGED and still
// reads the same field, so the raised cap immediately lets more hulls be built.
//
// Coverage: (1) the timed upgrade spends + queues + resolves to
// shipStorageCapacity + 1; (2) the one-in-flight guard (guards the rung-skip
// exploit); (3) the max-rung clamp; (4) an unaffordable no-op (both the credit
// gate and the material gate); (5) a serialize/migrate round-trip preserving a
// raised capacity (NO migration change: the field already exists).
// ============================================================================
import { describe, it, expect } from "vitest";
import { canUpgradeDocks, startDocksExpansion, resolveProcesses } from "./tick";
import {
  freshState,
  SHIP_DOCKS_BASE,
  SHIP_DOCKS_RUNGS,
  type GameState,
} from "./model";
import { serialize, deserialize, migrate } from "./save";
import Decimal from "break_infinity.js";

// The FULL cost of the NEXT docks rung for a state at `rungIndex`, split into the
// credit cost and the per-item material map (as plain numbers), so a fixture can
// stock EXACTLY (or one short of) what the upgrade needs. Reads the real rung table
// so the test tracks any retune of the first-pass costs automatically.
function rungCostAt(rungIndex: number): { credits: number; materials: Record<string, number> } {
  const rung = SHIP_DOCKS_RUNGS[rungIndex];
  const materials: Record<string, number> = {};
  for (const itemId of Object.keys(rung.materials)) {
    materials[itemId] = rung.materials[itemId].toNumber();
  }
  return { credits: rung.credits.toNumber(), materials };
}

// A fresh state with the docks at `capacity`, holding `credits` and the given
// per-item material amounts (quality-0 buckets), everything else default. Used to
// make the NEXT docks upgrade exactly affordable / unaffordable.
function stockedState(opts: {
  capacity?: number;
  credits: number;
  materials: Record<string, number>;
}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  for (const itemId of Object.keys(opts.materials)) {
    inventory[itemId] = [new Decimal(opts.materials[itemId])];
  }
  return {
    ...s,
    inventory,
    credits: new Decimal(opts.credits),
    shipStorageCapacity: opts.capacity ?? s.shipStorageCapacity,
  };
}

describe("SHIP_DOCKS_RUNGS: the docks expansion track shape (first-pass tunable)", () => {
  it("is a finite track that raises the cap +1 per rung from the base", () => {
    // Base 8, one +1 rung each, up to a sensible cap.
    expect(SHIP_DOCKS_BASE).toBe(8);
    expect(SHIP_DOCKS_RUNGS.length).toBeGreaterThan(0);
    // Costs strictly escalate per rung (credits climb), so a later berth is a bigger sink.
    for (let i = 1; i < SHIP_DOCKS_RUNGS.length; i++) {
      expect(SHIP_DOCKS_RUNGS[i].credits.gt(SHIP_DOCKS_RUNGS[i - 1].credits)).toBe(true);
    }
  });
});

describe("startDocksExpansion: timed purchase raises shipStorageCapacity by 1 (Fleet Management)", () => {
  it("when affordable, spends credits + materials at start, queues the timed process, and resolves to capacity+1", () => {
    const cost = rungCostAt(0); // rung 0 = the 8 -> 9 step
    const s = stockedState({ credits: cost.credits, materials: cost.materials });
    expect(canUpgradeDocks(s)).toEqual({ ok: true });
    expect(s.shipStorageCapacity).toBe(SHIP_DOCKS_BASE); // 8 before

    const started = startDocksExpansion(s);
    expect(started.started).toBe(true);
    // Credits deducted ATOMICALLY at start (spent to 0).
    expect(started.next.credits.toNumber()).toBe(0);
    // Materials deducted ATOMICALLY at start (spent from the stocked buckets to 0).
    for (const itemId of Object.keys(cost.materials)) {
      expect(started.next.inventory[itemId]?.[0]?.toNumber() ?? 0).toBe(0);
    }
    // One docksExpansion process queued; the cap has NOT bumped yet (bumps at completion).
    const proc = started.next.activeProcesses.find((p) => p.kind === "docksExpansion");
    expect(proc).toBeTruthy();
    expect(proc!.effect.type).toBe("docksCapacityUp");
    expect(proc!.durationTicks).toBe(SHIP_DOCKS_RUNGS[0].durationTicks);
    expect(started.next.shipStorageCapacity).toBe(SHIP_DOCKS_BASE);

    // Resolve to completion: the cap bumps 8 -> 9.
    const resolved = resolveProcesses(started.next, SHIP_DOCKS_RUNGS[0].durationTicks);
    expect(resolved.next.shipStorageCapacity).toBe(SHIP_DOCKS_BASE + 1);
    // No docks-expansion process left in flight after completion.
    expect(resolved.next.activeProcesses.some((p) => p.kind === "docksExpansion")).toBe(false);
  });

  it("resolves ONCE and PARITY-SAFE: one big offline resolve lands the same +1 as many small live steps", () => {
    const cost = rungCostAt(0);
    const s = stockedState({ credits: cost.credits, materials: cost.materials });
    const started = startDocksExpansion(s);
    const dur = SHIP_DOCKS_RUNGS[0].durationTicks;

    // One big resolve.
    const big = resolveProcesses(started.next, dur);

    // Many one-tick steps.
    let small = started.next;
    for (let t = 0; t < dur; t++) small = resolveProcesses(small, 1).next;

    expect(big.next.shipStorageCapacity).toBe(SHIP_DOCKS_BASE + 1);
    expect(small.shipStorageCapacity).toBe(big.next.shipStorageCapacity);
    // The upgrade fires exactly once (never a second +1).
    expect(small.shipStorageCapacity).toBe(SHIP_DOCKS_BASE + 1);
  });

  it("is SEQUENTIAL: with an expansion already in flight, a second is refused (guards the rung-skip exploit)", () => {
    // Stock DOUBLE rung-0's cost so affordability alone would allow a second start; the
    // in-flight gate (not affordability) must be what refuses it.
    const cost = rungCostAt(0);
    const doubledMats: Record<string, number> = {};
    for (const itemId of Object.keys(cost.materials)) doubledMats[itemId] = cost.materials[itemId] * 2;
    const s = stockedState({ credits: cost.credits * 2, materials: doubledMats });

    const first = startDocksExpansion(s);
    expect(first.started).toBe(true);

    expect(canUpgradeDocks(first.next)).toEqual({ ok: false, reason: "Expansion already in progress" });
    const second = startDocksExpansion(first.next);
    expect(second.started).toBe(false);
    expect(second.next).toBe(first.next); // same reference (no-op)
  });

  it("cannot exceed the max rung: at the top capacity the action is a no-op with a fully-expanded reason", () => {
    const maxCapacity = SHIP_DOCKS_BASE + SHIP_DOCKS_RUNGS.length;
    // Stock plenty so ONLY the maxed gate can refuse.
    const s = stockedState({
      capacity: maxCapacity,
      credits: 1_000_000,
      materials: { structuralAssembly: 100000 },
    });
    expect(canUpgradeDocks(s)).toEqual({ ok: false, reason: "Docks are fully expanded" });
    const started = startDocksExpansion(s);
    expect(started.started).toBe(false);
    expect(started.next).toBe(s);
  });

  it("blocks (same-ref no-op) when CREDITS are unaffordable, with a clear reason", () => {
    const cost = rungCostAt(0);
    const s = stockedState({ credits: cost.credits - 1, materials: cost.materials });

    const check = canUpgradeDocks(s);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("credits");

    const started = startDocksExpansion(s);
    expect(started.started).toBe(false);
    expect(started.next).toBe(s);
  });

  it("blocks (same-ref no-op) when MATERIALS are unaffordable, with a clear reason", () => {
    const cost = rungCostAt(0);
    const firstItem = Object.keys(cost.materials)[0];
    const shortMats = { ...cost.materials, [firstItem]: cost.materials[firstItem] - 1 };
    const s = stockedState({ credits: cost.credits, materials: shortMats });

    const check = canUpgradeDocks(s);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("Need");

    const started = startDocksExpansion(s);
    expect(started.started).toBe(false);
    expect(started.next).toBe(s);
  });
});

describe("docks capacity round-trips through serialize/migrate (Fleet Management)", () => {
  it("a save at a raised capacity loads back to the SAME capacity (no migration change needed)", () => {
    const expanded: GameState = { ...freshState(), shipStorageCapacity: 11 };

    const raw = serialize(expanded, Date.now());
    const save = deserialize(raw);
    expect(save).not.toBeNull();
    const loaded = migrate(save!);

    expect(loaded.shipStorageCapacity).toBe(11);
  });
});
