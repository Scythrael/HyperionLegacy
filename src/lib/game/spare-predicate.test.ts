// E-CREW Task 1: the single spare predicate.
//
// Away-team members will wear equipment (fittedToMemberId). Member gear has fittedToShipId null,
// exactly like a spare, so every raw `fittedToShipId === null` check would silently treat a worn
// piece as free to salvage / install / count against storage. isSparePiece is the ONE answer to
// "is this piece free to take?" and isUninstalledPiece the ONE answer to "is it installed on
// anything?". The source scan below keeps raw comparisons from creeping back in: a line that truly
// needs the raw field (the helpers themselves, or a historical comment) carries `isSparePiece-ok`.
// Known blind spots of the scan: reversed operands (`null === x.fittedToShipId`), comparisons split
// across lines, and .js files are not caught; review keeps those out.
import { describe, it, expect } from "vitest";
// node:fs through the minimal test shim (src/lib/fs-for-tests.d.ts); node:path is deliberately not
// used, since the app tsconfig carries no node types and a "/" join works on every platform here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isSparePiece, isUninstalledPiece, type EquipmentInstance } from "./model";

// A loose, minimal piece; overrides set only the location fields under test.
function piece(overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id: "equip-1",
    slotType: "cargoBay",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    ...overrides,
  };
}

describe("isSparePiece", () => {
  it("a loose piece is spare", () => expect(isSparePiece(piece())).toBe(true));
  it("a ship-installed piece is not spare", () => expect(isSparePiece(piece({ fittedToShipId: "ship-1" }))).toBe(false));
  it("a member-installed piece is not spare", () => expect(isSparePiece(piece({ fittedToMemberId: "member-1" }))).toBe(false));
  it("a loadout-committed piece is not spare", () => expect(isSparePiece(piece({ committedToLoadoutId: "loadout-1" }))).toBe(false));
  it("an explicit null fittedToMemberId is still spare", () => expect(isSparePiece(piece({ fittedToMemberId: null }))).toBe(true));
});

describe("isUninstalledPiece", () => {
  it("a loose piece is uninstalled", () => expect(isUninstalledPiece(piece())).toBe(true));
  it("a ship-installed piece is installed", () => expect(isUninstalledPiece(piece({ fittedToShipId: "ship-1" }))).toBe(false));
  it("a member-installed piece is installed", () => expect(isUninstalledPiece(piece({ fittedToMemberId: "member-1" }))).toBe(false));
  // Commitment is NOT installation: a resting loadout's gear sits in the Armory, on nothing.
  it("a loadout-committed (not checked out) piece is uninstalled", () =>
    expect(isUninstalledPiece(piece({ committedToLoadoutId: "loadout-1" }))).toBe(true));
});

describe("no raw spare checks outside the helpers", () => {
  it("src has no raw fittedToShipId null / falsy comparison without an isSparePiece-ok tag", () => {
    const raw = [
      /fittedToShipId\s*[!=]==?\s*null/, // === null, !== null, == null, != null
      /fittedToShipId\s*[!=]==?\s*undefined/,
      /!\s*[\w$.?]*\bfittedToShipId\b(?!\s*[!=]==?)/, // !piece.fittedToShipId
    ];
    const hits: string[] = [];
    // Vacuity guard: the scan must actually see source, and must see the sanctioned helper line in
    // model.ts specifically (a tagged line elsewhere, like save.ts's history comment, does not count).
    let scanned = 0;
    let sawHelperInModel = false;
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = `${d}/${f}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|svelte)$/.test(f) && !f.endsWith(".test.ts")) {
          scanned++;
          readFileSync(p, "utf8").split("\n").forEach((l, i) => {
            if (!raw.some((re) => re.test(l))) return;
            if (!l.includes("isSparePiece-ok")) hits.push(`${p}:${i + 1}`);
            else if (p === "src/lib/game/model.ts") sawHelperInModel = true;
          });
        }
      }
    };
    walk("src");
    expect(scanned).toBeGreaterThan(50);
    expect(sawHelperInModel).toBe(true);
    expect(hits).toEqual([]);
  });
});
