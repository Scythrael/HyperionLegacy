// RARITY READINESS RR-2 (docs/plans/2026-10-23-rarity-readiness-plan.md): the Debug minter offers EVERY rarity band and
// EVERY ascension (user answer 4, "Dev mint now, proc later"), so balancing can conjure a Luminous, Constellar, Nova or
// Celestial piece on demand, while no player path changes: PRODUCIBLE_EQUIPMENT_RARITIES and the Fabricator mint are
// untouched, and the picker lives only in the DEV_MODE Debug tab. Ascension follows the design's rule (epic design
// 2026-07-17 :149): it is only ever non-"none" on Luminous or Constellar.

import { describe, expect, it } from "vitest";
import {
  BLUEPRINTS,
  EQUIPMENT_ASCENSIONS,
  EQUIPMENT_RARITY_LADDER,
  PRODUCIBLE_EQUIPMENT_RARITIES,
  ascensionAllowedFor,
  type EquipmentAscension,
  type EquipmentRarity,
} from "./model";
import { DEV_MINT_ASCENSIONS, DEV_MINT_RARITIES, devMintAscension, devMintFromBlueprint } from "./devMint";
import appSource from "../../App.svelte?raw";

const rng = () => 0.5;
const allocateId = () => "equip-test-1";
const GEAR = ["plasmaBp", "defenseDronePodBp"]; // a weapon and a drone pod, plus the first equipment blueprint below
const firstEquipmentBp = Object.keys(BLUEPRINTS).find((k) => BLUEPRINTS[k].equipmentOutput !== undefined)!;

describe("RR-2: the ascension vocabulary and its rule", () => {
  it("lists none, nova and celestial in order", () => {
    expect([...EQUIPMENT_ASCENSIONS]).toEqual(["none", "nova", "celestial"]);
  });

  it("allows an ascension only on the two legendary bands", () => {
    const allowed = EQUIPMENT_RARITY_LADDER.filter((r) => ascensionAllowedFor(r));
    expect(allowed).toEqual(["luminous", "constellar"]);
  });

  it("devMintAscension keeps a requested ascension on a legendary band and drops it everywhere else", () => {
    for (const r of EQUIPMENT_RARITY_LADDER) {
      for (const a of EQUIPMENT_ASCENSIONS) {
        expect(devMintAscension(r, a), `${r} ${a}`).toBe(ascensionAllowedFor(r) ? a : "none");
      }
    }
    // a junk value never leaks through
    expect(devMintAscension("luminous", "supernova" as EquipmentAscension)).toBe("none");
  });
});

describe("RR-2: the Debug minter covers the whole ladder", () => {
  it("offers every rarity band and every ascension", () => {
    expect([...DEV_MINT_RARITIES]).toEqual([...EQUIPMENT_RARITY_LADDER]);
    expect([...DEV_MINT_ASCENSIONS]).toEqual([...EQUIPMENT_ASCENSIONS]);
  });

  it("mints every band with the chosen rarity, on every generator", () => {
    for (const key of [...GEAR, firstEquipmentBp]) {
      for (const rarity of DEV_MINT_RARITIES) {
        const piece = devMintFromBlueprint({ blueprint: BLUEPRINTS[key], iLevel: 40, quality: 5, rarity, rng, allocateId });
        expect(piece, `${key} ${rarity}`).not.toBeNull();
        expect(piece!.rarity).toBe(rarity);
        expect(piece!.ascension).toBe("none");
        expect(piece!.blueprintKey).toBe(key);
      }
    }
  });

  it("stamps Nova and Celestial on Luminous and Constellar, and never on any other band", () => {
    for (const key of [...GEAR, firstEquipmentBp]) {
      for (const rarity of DEV_MINT_RARITIES) {
        for (const ascension of DEV_MINT_ASCENSIONS) {
          const piece = devMintFromBlueprint({ blueprint: BLUEPRINTS[key], iLevel: 40, quality: 5, rarity, ascension, rng, allocateId });
          expect(piece!.ascension, `${key} ${rarity} ${ascension}`).toBe(ascensionAllowedFor(rarity) ? ascension : "none");
        }
      }
    }
  });

  it("an omitted ascension mints exactly what an explicit \"none\" mints (today's behavior)", () => {
    for (const rarity of ["radiant", "luminous"] as EquipmentRarity[]) {
      const a = devMintFromBlueprint({ blueprint: BLUEPRINTS.plasmaBp, iLevel: 40, quality: 5, rarity, rng, allocateId });
      const b = devMintFromBlueprint({ blueprint: BLUEPRINTS.plasmaBp, iLevel: 40, quality: 5, rarity, ascension: "none", rng, allocateId });
      expect(a).toEqual(b);
    }
  });

  it("does not widen what a player can produce", () => {
    expect([...PRODUCIBLE_EQUIPMENT_RARITIES]).toEqual(["standard", "augmented", "stellar", "radiant"]);
  });
});

describe("RR-2: the Debug tab wiring (App.svelte source)", () => {
  it("the picker reads the full lists and routes the ascension through devMintAscension", () => {
    expect(appSource).not.toMatch(/const DEV_MINT_RARITIES[^=]*=\s*PRODUCIBLE_EQUIPMENT_RARITIES/);
    expect(appSource).toMatch(/\{#each DEV_MINT_RARITIES as r\}/);
    expect(appSource).toMatch(/\{#each DEV_MINT_ASCENSIONS as a\}/);
    expect(appSource).toMatch(/ascension: devMintAscension\(devMintRarity, devMintAscensionChoice\)/);
    expect(appSource).toMatch(/disabled=\{!ascensionAllowedFor\(devMintRarity\)\}/);
  });

  it("the Mint gear row sits inside the DEV_MODE Debug block", () => {
    // Search the MARKUP only: HTML comments (and script line comments) quote the gate's text in prose, so a search
    // over the raw source would still pass with the real gate deleted (review of RR-2).
    const markup = appSource.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
    const row = markup.indexOf('<span class="dev-label">Mint gear</span>');
    expect(row).toBeGreaterThan(0);
    const GATE = '{#if DEV_MODE && activeSystemSubTab === "debug"}';
    const gate = markup.lastIndexOf(GATE, row);
    expect(gate).toBeGreaterThan(0);
    // Walk the blocks from the gate: its matching {/if} must come AFTER the row.
    const tokens = /\{#if\b|\{\/if\}/g;
    tokens.lastIndex = gate + GATE.length;
    let depth = 1;
    let close = -1;
    for (let m = tokens.exec(markup); m !== null; m = tokens.exec(markup)) {
      depth += m[0] === "{/if}" ? -1 : 1;
      if (depth === 0) {
        close = m.index;
        break;
      }
    }
    expect(close, "the Debug gate's closing {/if}").toBeGreaterThan(row);
  });
});
