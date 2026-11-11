// telescopeCardDisplay.test.ts: the Subspace Telescope Facilities card (Squads SQ-7 section 7.4). The card's
// words, the development-cycle ladder and the galaxy map's geometry are pure functions of the facility level, so
// they are pinned here; the Svelte card only draws them.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { FACILITIES, SUBSPACE_TELESCOPE_FACILITY_KEY, SUBSPACE_TELESCOPE_LEVELS, freshState, type GameState, type RegionTier } from "./game/model";
import { startFacilityUpgrade } from "./game/tick";
import { PROVISIONAL_HOMEWORLD, TELESCOPE_DEVELOPMENT_CYCLES, TELESCOPE_LORE, stateHomeworld, telescopeReadingAtLevel } from "./game/telescope";
import {
  enemySectorInReach,
  SECTOR_LABEL_BESIDE_PX,
  SECTOR_LABEL_SIZE,
  telescopeCardView,
  telescopeMapBearingPoint,
  telescopeMapLabelBox,
  telescopeMapEnemyView,
  telescopeMapRingRadius,
  telescopeMapSectorRadii,
  telescopeMapView,
  TELESCOPE_MAP_RADIUS,
} from "./telescopeCardDisplay";
import { BEARING_TURN, ENEMY_SECTOR_WIDTH_PERMILLE, bearingDirection, homeworldPlacement, inEnemySector, type HomeworldPlacement } from "./game/galaxy";
import { tierCandidateSystems } from "./game/expedition";

// G2-1 (the SQ-7.4 carry note): the map's bounds, ring-fit, overlap and in-band tests run over the provisional
// fixture AND 200 per-save placements.
const HOMES: HomeworldPlacement[] = [
  PROVISIONAL_HOMEWORLD,
  ...Array.from({ length: 200 }, (_, i) => homeworldPlacement((Math.imul(i + 1, 0x9e3779b1) ^ 0x2545f491) >>> 0)),
];

function atLevel(level: number, base: GameState = freshState()): GameState {
  return { ...base, facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level } } };
}

const TOP = SUBSPACE_TELESCOPE_LEVELS.length;
const NO_EM_DASH = new RegExp(`${String.fromCharCode(0x2014)}|-{2}`); // an em dash, or two hyphens in a row

describe("telescopeCardView: the card's headline numbers", () => {
  // G2-1: the pinned light-years below are measured from the provisional fixture (Sol's spot); a save's own homeworld
  // moves them by up to a few hundred light-years (the next test).
  const SOL = { homeworld: PROVISIONAL_HOMEWORLD };

  it("a fresh save reads Level 1 of 8: 150 ly from Sol, Tier I, Graded detail, and the user's lore line", () => {
    const view = telescopeCardView(freshState(), SOL);
    expect(view.level).toBe(1);
    expect(view.maxLevel).toBe(TOP);
    expect(view.maxed).toBe(false);
    expect(view.subtitle).toBe("Level 1 of 8 · Graded detail");
    expect(view.rangeText).toBe("150 ly");
    expect(view.reachText).toBe("Tier I");
    expect(view.reachNames).toBe("Local Bubble");
    expect(view.detailText).toBe("2 · Graded");
    expect(view.lore).toBe(TELESCOPE_LORE);
  });

  it("G2-1: by default the card is measured from the save's own homeworld", () => {
    for (const seed of [1, 99, 123_456_789]) {
      const s = freshState(seed);
      const home = stateHomeworld(s);
      expect(home).not.toEqual(PROVISIONAL_HOMEWORLD);
      expect(telescopeCardView(s)).toEqual(telescopeCardView(s, { homeworld: home }));
      expect(telescopeCardView(s).rangeText).toBe(`${home.regionBandsLy[1].far.toLocaleString("en-US")} ly`);
    }
  });

  it("every level's numbers are the engine reading's (never re-derived)", () => {
    for (let level = 1; level <= TOP; level++) {
      const reading = telescopeReadingAtLevel(level, stateHomeworld(atLevel(level)));
      const view = telescopeCardView(atLevel(level));
      expect(view.rangeText).toBe(`${reading.rangeLy.toLocaleString("en-US")} ly`);
      expect(view.detail).toBe(reading.detail);
      expect(view.detailText).toBe(`${reading.detail} · ${reading.detailName}`);
    }
  });

  it("the reach reads as a span of tiers once it covers more than one", () => {
    expect(telescopeCardView(atLevel(2)).reachText).toBe("Tiers I to II");
    expect(telescopeCardView(atLevel(4)).reachText).toBe("Tiers I to IV");
    expect(telescopeCardView(atLevel(4)).reachNames).toBe("Local Bubble to the Sagittarius Arm");
    expect(telescopeCardView(atLevel(8)).reachText).toBe("Tiers I to VII");
  });
});

describe("telescopeCardView: the next development cycle", () => {
  it("names the next rung's credits, time and FA gate, plus the derived cycle line", () => {
    const next = telescopeCardView(freshState(), { homeworld: PROVISIONAL_HOMEWORLD }).next!;
    expect(next.level).toBe(2);
    expect(next.credits).toBe(4_000);
    expect(next.durationTicks).toBe(120);
    expect(next.fleetAdminLevel).toBe(3);
    expect(next.rangeText).toBe("3,000 ly");
    expect(next.sameRange).toBe(false);
    expect(next.detailUp).toBe(false);
    expect(next.gainLine).toBe(TELESCOPE_DEVELOPMENT_CYCLES[2]);
  });

  it("matches FACILITIES' rung exactly at every level, and a detail-only rung says so", () => {
    for (let level = 1; level < TOP; level++) {
      const rung = FACILITIES[SUBSPACE_TELESCOPE_FACILITY_KEY].upgrades[level];
      const next = telescopeCardView(atLevel(level)).next!;
      expect(next.credits).toBe(rung.credits!.toNumber());
      expect(next.durationTicks).toBe(rung.durationTicks);
      expect(next.fleetAdminLevel).toBe(rung.requiresFleetAdminLevel);
    }
    const toThree = telescopeCardView(atLevel(2)).next!;
    expect(toThree.sameRange).toBe(true);
    expect(toThree.detailUp).toBe(true);
    expect(toThree.detailName).toBe("Per body");
  });

  it("Level 8 has no next cycle", () => {
    const view = telescopeCardView(atLevel(8));
    expect(view.maxed).toBe(true);
    expect(view.next).toBeNull();
  });
});

describe("telescopeCardView: the ladder", () => {
  it("one row per level, marked reached / current / next / later, with costs in words", () => {
    const view = telescopeCardView(atLevel(3), { homeworld: PROVISIONAL_HOMEWORLD });
    expect(view.ladder.map((r) => r.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(view.ladder.map((r) => r.status)).toEqual(["reached", "reached", "current", "next", "later", "later", "later", "later"]);
    expect(view.ladder[0].costText).toBe("Pre-granted");
    expect(view.ladder[1].costText).toBe("4,000 credits · 120 ticks · Fleet Admiral level 3");
    expect(view.ladder[3].reachText).toBe("Perseus Arm and Sagittarius Arm");
    expect(view.ladder[2].reachText).toBe("Orion Arm");
    expect(view.ladder[2].rangeText).toBe("3,000 ly");
    expect(view.ladder[2].detailName).toBe("Per body");
    // The status in words too (the row's border is not the only signal).
    expect(view.ladder.map((r) => r.statusText)).toEqual(["Reached", "Reached", "Current", "Next", "", "", "", ""]);
  });

  it("formats the time with the caller's duration reader (the card honors the tick-count preference)", () => {
    const view = telescopeCardView(freshState(), { duration: (t) => `${t / 60}m` });
    expect(view.ladder[1].costText).toBe("4,000 credits · 2m · Fleet Admiral level 3");
  });

  it("while a cycle is in progress the next rung reads building", () => {
    const ready = { ...freshState(), fleetAdminLevel: 3, credits: new Decimal(5_000) };
    const { next: building, started } = startFacilityUpgrade(ready, SUBSPACE_TELESCOPE_FACILITY_KEY);
    expect(started).toBe(true);
    const view = telescopeCardView(building);
    expect(view.building).toBe(true);
    expect(view.ladder[1].status).toBe("building");
    expect(view.ladder[1].statusText).toBe("In progress");
    expect(telescopeCardView(ready).building).toBe(false);
  });

  it("at the top every row is reached and the last is current", () => {
    const statuses = telescopeCardView(atLevel(8)).ladder.map((r) => r.status);
    expect(statuses).toEqual(["reached", "reached", "reached", "reached", "reached", "reached", "reached", "current"]);
  });

  it("no card text carries an em dash or a double hyphen", () => {
    for (let level = 1; level <= TOP; level++) {
      const view = telescopeCardView(atLevel(level));
      const map = telescopeMapView(level);
      const texts = [view.subtitle, view.reachText, view.reachNames, view.detailText, view.lore, view.next?.gainLine ?? "",
        ...view.ladder.flatMap((r) => [r.costText, r.reachText, r.rangeText]), map.ariaLabel, ...map.legend,
        ...map.badges.map((b) => b.label)];
      for (const t of texts) expect(t).not.toMatch(NO_EM_DASH);
    }
  });
});

describe("telescopeMapView: the galaxy map", () => {
  it("rings grow with range on a square-root scale, the next ring is dashed only when the range grows", () => {
    const one = telescopeMapView(1);
    const two = telescopeMapView(2);
    expect(one.ringR).toBeGreaterThan(0);
    expect(two.ringR).toBeGreaterThan(one.ringR);
    expect(one.nextRingR).toBeCloseTo(two.ringR, 6);
    expect(Math.abs(two.ringR / one.ringR - Math.sqrt(3_000 / 150))).toBeLessThan(0.05); // radii are rounded to 0.1 px
    // Level 2 -> 3 adds detail, not range: no second ring, the legend says why.
    expect(two.nextRingR).toBeNull();
    expect(two.legend.join(" ")).toContain("Level 3 adds detail, not range");
    // The top has no next ring.
    expect(telescopeMapView(8).nextRingR).toBeNull();
    expect(telescopeMapView(8).legend.join(" ")).toContain("Fully upgraded");
  });

  it("the Level 8 ring reaches the Galactic Core, from every homeworld", { timeout: 60_000 }, () => {
    for (const home of HOMES) {
      const top = telescopeMapView(8, home);
      const d = Math.hypot(top.core.x - top.home.x, top.core.y - top.home.y);
      expect(Math.abs(d - top.ringR), home.id).toBeLessThan(0.5);
    }
  });

  it("every level's rings stay inside the view box on every side (never clipped), from every homeworld", { timeout: 60_000 }, () => {
    for (const home of HOMES) for (let level = 1; level <= TOP; level++) {
      const map = telescopeMapView(level, home);
      const [vx, vy, vw, vh] = map.viewBox.split(" ").map(Number);
      for (const r of [map.ringR, map.nextRingR ?? 0]) {
        expect(map.home.x - r, `level ${level} left`).toBeGreaterThanOrEqual(vx);
        expect(map.home.x + r, `level ${level} right`).toBeLessThanOrEqual(vx + vw);
        expect(map.home.y - r, `level ${level} top`).toBeGreaterThanOrEqual(vy);
        expect(map.home.y + r, `level ${level} bottom`).toBeLessThanOrEqual(vy + vh);
      }
    }
  });

  it("a homeworld farther from the core scales the map down instead of clipping the top ring (G2 guard)", () => {
    const far = {
      ...PROVISIONAL_HOMEWORLD,
      id: "farOut",
      galactic: { x: 0, y: 45_000 },
      distanceFromCoreLy: 45_000,
      regionBandsLy: { ...PROVISIONAL_HOMEWORLD.regionBandsLy, 6: { near: 13_000, far: 43_000 }, 7: { near: 43_000, far: 45_000 } },
    };
    const top = telescopeMapView(8, far);
    const [, vy, , vh] = top.viewBox.split(" ").map(Number);
    expect(top.home.y + top.ringR).toBeLessThanOrEqual(vy + vh);
    expect(top.home.y - top.ringR).toBeGreaterThanOrEqual(vy);
    expect(top.ringR).toBeLessThan(TELESCOPE_MAP_RADIUS);
  });

  it("nothing overlaps: badges, the home and core dots, and the two labels, from every homeworld", { timeout: 60_000 }, () => {
    // Approximate text boxes: about 0.56 em per character, the cap height above the baseline.
    const box = (l: { x: number; y: number; text: string; size: number; anchor: "start" | "middle" | "end" }) => {
      const w = l.text.length * l.size * 0.56;
      const x0 = l.anchor === "start" ? l.x : l.anchor === "middle" ? l.x - w / 2 : l.x - w;
      return { x0, x1: x0 + w, y0: l.y - l.size * 0.75, y1: l.y + l.size * 0.2 };
    };
    const hitsCircle = (b: ReturnType<typeof box>, cx: number, cy: number, r: number) => {
      const nx = Math.max(b.x0, Math.min(cx, b.x1));
      const ny = Math.max(b.y0, Math.min(cy, b.y1));
      return Math.hypot(nx - cx, ny - cy) < r;
    };
    for (const home of HOMES) for (let level = 1; level <= TOP; level++) {
      const map = telescopeMapView(level, home);
      const R = map.badgeR;
      const dots = [
        { x: map.home.x, y: map.home.y, r: 4 },
        { x: map.core.x, y: map.core.y, r: 3.5 },
      ];
      map.badges.forEach((a, i) => {
        map.badges.slice(i + 1).forEach((b) => expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.numeral}/${b.numeral}`).toBeGreaterThanOrEqual(2 * R + 2));
        for (const d of dots) expect(Math.hypot(a.x - d.x, a.y - d.y), `${a.numeral} on a dot`).toBeGreaterThanOrEqual(R + d.r);
      });
      for (const label of [map.homeLabel, map.coreLabel]) {
        const b = box(label);
        for (const badge of map.badges) expect(hitsCircle(b, badge.x, badge.y, R), `${label.text} / ${badge.numeral}`).toBe(false);
        for (const d of dots) expect(hitsCircle(b, d.x, d.y, d.r), `${label.text} on a dot`).toBe(false);
      }
    }
  });

  it("at Level 1 badge I touches the solid ring, so in range reads true on the map, from every homeworld", { timeout: 60_000 }, () => {
    for (const home of HOMES) {
      const map = telescopeMapView(1, home);
      const one = map.badges[0];
      expect(Math.hypot(one.x - map.home.x, one.y - map.home.y), home.id).toBeLessThanOrEqual(map.ringR + map.badgeR + 0.5);
    }
  });

  it("seven badges, I to VII, each inside its own region's band of distances from that homeworld (band-relative)", { timeout: 60_000 }, () => {
    for (const home of HOMES) {
      const map = telescopeMapView(1, home);
      expect(map.badges.map((b) => b.numeral)).toEqual(["I", "II", "III", "IV", "V", "VI", "VII"]);
      for (const b of map.badges) {
        if (b.tier === 1) continue; // the Local Bubble is too small to draw: its badge sits beside the homeworld
        const band = home.regionBandsLy[b.tier as RegionTier];
        expect(b.distanceLy, `${home.id} tier ${b.tier}`).toBeGreaterThan(band.near);
        expect(b.distanceLy, `${home.id} tier ${b.tier}`).toBeLessThanOrEqual(band.far);
      }
    }
  });

  it("G2-1: the map is centered on the homeworld's own position; the provisional fixture keeps the pre-G2 map", () => {
    const home = HOMES[1];
    const map = telescopeMapView(8, home);
    expect(map.home).toEqual({ x: 200, y: 200 });
    // The core dot sits in the direction of the Galactic Core as seen from this homeworld.
    const toCore = Math.atan2(-home.galactic.y, -home.galactic.x);
    expect(Math.atan2(map.core.y - map.home.y, map.core.x - map.home.x)).toBeCloseTo(toCore, 2);
    expect(telescopeMapView(8)).toEqual(telescopeMapView(8, PROVISIONAL_HOMEWORLD));
  });

  it("a badge is reached exactly when its tier is within the telescope's reach, and says so in words", () => {
    for (let level = 1; level <= TOP; level++) {
      const reach = telescopeReadingAtLevel(level).reachTier;
      const map = telescopeMapView(level);
      for (const b of map.badges) {
        expect(b.reached).toBe(b.tier <= reach);
        expect(b.label).toBe(`${b.numeral} ${b.name}, ${b.reached ? "in range" : "beyond range"}`);
      }
    }
  });

  it("the accessible summary names the level, the reach and the next reach", () => {
    expect(telescopeMapView(1).ariaLabel).toBe(
      "Galaxy map centered on your homeworld. Subspace Telescope Level 1 reaches 150 light-years, Tier I. Level 2 would reach 3,000 light-years, Tiers I to II.",
    );
    expect(telescopeMapView(2).ariaLabel).toBe(
      "Galaxy map centered on your homeworld. Subspace Telescope Level 2 reaches 3,000 light-years, Tiers I to II. Level 3 adds detail, not range.",
    );
    expect(telescopeMapView(8).ariaLabel).toBe(
      "Galaxy map centered on your homeworld. Subspace Telescope Level 8 reaches 26,500 light-years, Tiers I to VII. Fully upgraded: every region is in range.",
    );
  });

  it("the legend states the rings in words (color is never the only signal)", () => {
    expect(telescopeMapView(1).legend).toEqual(["Solid ring: your range now, 150 ly.", "Dashed ring: Level 2, 3,000 ly."]);
  });

  // Expedition Tiers G2-7 (the SQ-7.4 carry note, per homeworld): the homeworld dot at its own position, the badges
  // inside their bands at every level, and the dispatch console's longer "Your homeworld" label (expeditionConsoleDisplay.ts
  // regionMapView draws it at the same spot) clear of every badge and dot, over 200 placements.
  it("G2-7: the homeworld dot sits at the homeworld's own position; every badge and the core are measured from it", { timeout: 60_000 }, () => {
    for (const home of HOMES) {
      const map = telescopeMapView(8, home);
      expect(map.home).toEqual({ x: 200, y: 200 });
      // The core lies at the homeworld's own distance from the core, on the square-root scale the rings use.
      const core = map.badges.find((b) => b.tier === 7)!;
      expect(core.distanceLy, home.id).toBe(Math.round(Math.hypot(home.galactic.x, home.galactic.y)));
      expect(Math.abs(Math.hypot(map.core.x - map.home.x, map.core.y - map.home.y) - map.ringR), home.id).toBeLessThan(0.5);
    }
    // Two different homeworlds draw the same galaxy from two different centers (the core dot moves with the home).
    const a = telescopeMapView(8, HOMES[1]);
    const b = telescopeMapView(8, HOMES[2]);
    expect(HOMES[1].galactic).not.toEqual(HOMES[2].galactic);
    expect(a.core).not.toEqual(b.core);
  });

  it("G2-7: every badge stays inside its band, and inside the view box, at every level from every homeworld", { timeout: 60_000 }, () => {
    for (const home of HOMES) for (let level = 1; level <= TOP; level++) {
      const map = telescopeMapView(level, home);
      const [vx, vy, vw, vh] = map.viewBox.split(" ").map(Number);
      for (const b of map.badges) {
        expect(b.x - map.badgeR, `${home.id} L${level} ${b.numeral}`).toBeGreaterThanOrEqual(vx);
        expect(b.x + map.badgeR, `${home.id} L${level} ${b.numeral}`).toBeLessThanOrEqual(vx + vw);
        expect(b.y - map.badgeR, `${home.id} L${level} ${b.numeral}`).toBeGreaterThanOrEqual(vy);
        expect(b.y + map.badgeR, `${home.id} L${level} ${b.numeral}`).toBeLessThanOrEqual(vy + vh);
        if (b.tier === 1) continue;
        const band = home.regionBandsLy[b.tier as RegionTier];
        expect(b.distanceLy).toBeGreaterThan(band.near);
        expect(b.distanceLy).toBeLessThanOrEqual(band.far);
      }
    }
  });

  it("G2-7: the console map's \"Your homeworld\" label clears every badge and dot, at every level from every homeworld", { timeout: 60_000 }, () => {
    const box = (l: { x: number; y: number; text: string; size: number }) => {
      const w = l.text.length * l.size * 0.56;
      return { x0: l.x, x1: l.x + w, y0: l.y - l.size * 0.75, y1: l.y + l.size * 0.2 };
    };
    const hits = (b: ReturnType<typeof box>, cx: number, cy: number, r: number) =>
      Math.hypot(Math.max(b.x0, Math.min(cx, b.x1)) - cx, Math.max(b.y0, Math.min(cy, b.y1)) - cy) < r;
    for (const home of HOMES) for (let level = 1; level <= TOP; level++) {
      const map = telescopeMapView(level, home);
      const label = box({ ...map.homeLabel, text: "Your homeworld" });
      for (const badge of map.badges) expect(hits(label, badge.x, badge.y, map.badgeR), `${home.id} L${level} ${badge.numeral}`).toBe(false);
      expect(hits(label, map.core.x, map.core.y, 3.5), `${home.id} L${level} core`).toBe(false);
      expect(hits(label, map.home.x, map.home.y, 4), `${home.id} L${level} home`).toBe(false);
    }
  });

  it("paths are finite SVG path data and everything sits inside the view box, from every homeworld", { timeout: 60_000 }, () => {
    for (const home of HOMES) {
      const map = telescopeMapView(5, home);
      for (const d of [map.diskPath, map.bulgePath, ...map.armPaths]) {
        expect(d).toMatch(/^M[-\d.]+ [-\d.]+(L[-\d.]+ [-\d.]+)*Z?$/);
        expect(d).not.toContain("NaN");
      }
      const [vx, vy, vw, vh] = map.viewBox.split(" ").map(Number);
      for (const p of [map.home, map.core, ...map.badges]) {
        expect(p.x).toBeGreaterThanOrEqual(vx);
        expect(p.x).toBeLessThanOrEqual(vx + vw);
        expect(p.y).toBeGreaterThanOrEqual(vy);
        expect(p.y).toBeLessThanOrEqual(vy + vh);
      }
    }
  });
});

// Expedition Tiers G2-7: the enemy territory shading (the approved 2026-11-09 mockup; user: "Hatch + dashed edge",
// legend "Once a sector is in range", "\"Enemy territory\", hide out-of-range"). Display only.
describe("telescopeMapEnemyView: enemy territory on the map", () => {
  const SEEDED = HOMES.slice(1);
  // The screen bearing (tenths of a degree, 0 up, clockwise) of a map point, from the homeworld at (200, 200).
  const screenBearing = (x: number, y: number): number => {
    const deg = (Math.atan2(x - 200, -(y - 200)) * 180) / Math.PI;
    return (((deg * 10) % BEARING_TURN) + BEARING_TURN) % BEARING_TURN;
  };
  const insideWedge = (b: number, start: number, width: number): boolean => (b - start + BEARING_TURN) % BEARING_TURN < width;
  const NONE = { sectors: [], tiers: [], legend: null, ariaSentence: "" };

  it("each slice is its tier's band (near to far edge as ring radii) across its fixed wedge of bearings, from every homeworld", { timeout: 60_000 }, () => {
    for (const home of SEEDED) {
      expect(home.enemySectors.map((s) => s.tier), home.id).toEqual([2, 3, 4, 5, 6, 7]);
      const view = telescopeMapEnemyView(TOP, home);
      expect(view.sectors).toHaveLength(home.enemySectors.length);
      for (const s of view.sectors) {
        const src = home.enemySectors.find((e) => e.tier === s.tier)!;
        const band = home.regionBandsLy[s.tier];
        expect(s.startBearing).toBe(src.startBearing);
        expect(s.widthBearing).toBe(src.widthBearing);
        expect(s.widthBearing).toBe((ENEMY_SECTOR_WIDTH_PERMILLE[s.tier] * BEARING_TURN) / 1000);
        expect(s.innerR).toBe(telescopeMapRingRadius(home, band.near));
        expect(s.outerR).toBe(telescopeMapRingRadius(home, band.far));
        expect(telescopeMapSectorRadii(home, s.tier)).toEqual({ innerR: s.innerR, outerR: s.outerR });
        expect(s.outerR).toBeGreaterThan(s.innerR);
        // The path starts on the inner arc at the start bearing and runs out to the outer arc.
        const i0 = telescopeMapBearingPoint(s.startBearing, s.innerR);
        expect(s.path.startsWith(`M${i0.x.toFixed(1)} ${i0.y.toFixed(1)} L`)).toBe(true);
        expect(s.path).toMatch(/^M[-\d.]+ [-\d.]+ L[-\d.]+ [-\d.]+ A[\d.]+ [\d.]+ 0 [01] 1 [-\d.]+ [-\d.]+ L[-\d.]+ [-\d.]+ A[\d.]+ [\d.]+ 0 [01] 0 [-\d.]+ [-\d.]+Z$/);
        expect(s.path).not.toContain("NaN");
      }
    }
  });

  it("the map's screen bearings are galaxy.ts bearings: 0 toward the Galactic Core, a quarter turn on to the right", () => {
    for (const b of [0, 450, 900, 1_800, 2_700, 3_599]) {
      const p = telescopeMapBearingPoint(b, 50);
      const g = bearingDirection(b);
      expect(p.x - 200).toBeCloseTo(g.x * 50, 6);
      expect(p.y - 200).toBeCloseTo(g.y * 50, 6);
    }
    // From Sol's own spot (straight out from the core) the core dot lies along bearing 0, straight up.
    const sol = telescopeMapView(8);
    expect(sol.core.x).toBeCloseTo(200, 1);
    expect(sol.core.y).toBeLessThan(200);
  });

  it("every candidate flagged enemy territory lands inside its tier's drawn slice, and no other candidate does", { timeout: 60_000 }, () => {
    let flagged = 0;
    for (let i = 0; i < 200; i++) {
      const seed = (Math.imul(i + 7, 0x85ebca6b) ^ 0x1b873593) >>> 0;
      const state = { ...freshState(seed), expeditionSeed: (Math.imul(i + 1, 0xc2b2ae35) >>> 0) || 1 };
      const home = stateHomeworld(state);
      const view = telescopeMapEnemyView(TOP, home);
      for (const tier of [2, 3, 4, 5, 6, 7] as RegionTier[]) {
        for (const c of tierCandidateSystems(state, tier, home)) {
          // The candidate's map point, from its galactic direction and its distance on the rings' scale.
          const dir = bearingDirection(c.bearing);
          const r = telescopeMapRingRadius(home, c.distanceLy);
          const b = Math.round(screenBearing(200 + dir.x * r, 200 + dir.y * r)) % BEARING_TURN;
          const inSlice = view.sectors.some((s) => s.tier === tier && r >= s.innerR && r <= s.outerR && insideWedge(b, s.startBearing, s.widthBearing));
          expect(inSlice, `${home.id} ${c.id}`).toBe(c.region.enemyTerritory);
          expect(c.region.enemyTerritory).toBe(inEnemySector(home, tier, c.bearing));
          if (c.region.enemyTerritory) flagged++;
        }
      }
    }
    expect(flagged).toBeGreaterThan(100);
  });

  it("the in-reach rule: a slice is drawn exactly when its tier is within the telescope's reach, never past the solid ring", { timeout: 60_000 }, () => {
    for (const home of SEEDED) {
      for (let level = 0; level <= TOP; level++) {
        const reach = telescopeReadingAtLevel(level, home).reachTier;
        const view = telescopeMapEnemyView(level, home);
        const map = telescopeMapView(level, home);
        expect(view.sectors.map((s) => s.tier), `${home.id} L${level}`).toEqual(home.enemySectors.filter((s) => s.tier <= reach).map((s) => s.tier));
        for (const s of home.enemySectors) expect(enemySectorInReach(s, reach)).toBe(s.tier <= reach);
        for (const s of view.sectors) expect(s.outerR, `${home.id} L${level} ${s.numeral}`).toBeLessThanOrEqual(map.ringR);
        expect(view.tiers).toEqual(view.sectors.map((s) => s.tier));
      }
    }
  });

  it("every slice stays inside the view box, from every homeworld", { timeout: 60_000 }, () => {
    for (const home of SEEDED) {
      const map = telescopeMapView(TOP, home);
      const [vx, vy, vw, vh] = map.viewBox.split(" ").map(Number);
      for (const s of telescopeMapEnemyView(TOP, home).sectors) {
        // A slice lies inside the disk of its outer radius around the homeworld.
        expect(200 - s.outerR, `${home.id} ${s.numeral}`).toBeGreaterThanOrEqual(vx);
        expect(200 + s.outerR).toBeLessThanOrEqual(vx + vw);
        expect(200 - s.outerR).toBeGreaterThanOrEqual(vy);
        expect(200 + s.outerR).toBeLessThanOrEqual(vy + vh);
      }
    }
  });

  it("the legend line, the key's tiers and the accessible sentence show only once a slice is in range", () => {
    const home = SEEDED[0];
    expect(telescopeReadingAtLevel(1, home).reachTier).toBe(1);
    expect(telescopeMapEnemyView(1, home)).toEqual(NONE);
    const l2 = telescopeMapEnemyView(2, home);
    expect(l2.tiers).toEqual([2]);
    expect(l2.legend).toBe("Hatched: enemy territory. Combat risk is one step higher there.");
    expect(l2.ariaSentence).toBe("Hatched sectors are enemy territory in Tier II.");
    expect(telescopeReadingAtLevel(TOP, home).reachTier).toBe(7);
    expect(telescopeMapEnemyView(TOP, home).ariaSentence).toBe("Hatched sectors are enemy territory in Tiers II, III, IV, V, VI and VII.");
    for (const h of SEEDED) {
      for (let level = 0; level <= TOP; level++) {
        const v = telescopeMapEnemyView(level, h);
        expect(v.legend !== null).toBe(v.sectors.length > 0);
        expect(v.ariaSentence !== "").toBe(v.sectors.length > 0);
        for (const t of [v.legend ?? "", v.ariaSentence]) expect(t).not.toMatch(NO_EM_DASH);
      }
    }
  });

  // G2-9 close-out (user 2026-11-11, "Label + point inward (Recommended)"): every hatched slice carries its tier's
  // numeral inside it (Tiers III and IV share a ring), clear of everything else on the map; Tier VI and VII slices
  // point at the drawn core.
  // How far (px) a map point lies from a slice: 0 inside it, else the distance to its nearest edge.
  const gapToSlice = (x: number, y: number, s: { startBearing: number; widthBearing: number; innerR: number; outerR: number }): number => {
    const r = Math.hypot(x - 200, y - 200);
    const b = screenBearing(x, y);
    if (insideWedge(b, s.startBearing, s.widthBearing)) return Math.max(0, s.innerR - r, r - s.outerR);
    const toSegment = (bearing: number): number => {
      const a = telescopeMapBearingPoint(bearing, s.innerR);
      const c = telescopeMapBearingPoint(bearing, s.outerR);
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
      return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    };
    return Math.min(toSegment(s.startBearing), toSegment(s.startBearing + s.widthBearing));
  };

  it("each slice is labeled with its own numeral, inside its slice, clear of badges, dots, labels and the view box", { timeout: 60_000 }, () => {
    const hitsCircle = (b: ReturnType<typeof telescopeMapLabelBox>, cx: number, cy: number, r: number) => {
      const nx = Math.max(b.x0, Math.min(cx, b.x1));
      const ny = Math.max(b.y0, Math.min(cy, b.y1));
      return Math.hypot(nx - cx, ny - cy) < r;
    };
    const meet = (a: ReturnType<typeof telescopeMapLabelBox>, b: ReturnType<typeof telescopeMapLabelBox>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    let labeled = 0;
    let beside = 0;
    let apart = 0;
    for (const home of SEEDED) {
      for (let level = 1; level <= TOP; level++) {
        const map = telescopeMapView(level, home);
        const [vx, vy, vw, vh] = map.viewBox.split(" ").map(Number);
        const view = telescopeMapEnemyView(level, home);
        const boxes = view.sectors.map((s) => telescopeMapLabelBox(s.label));
        view.sectors.forEach((s, i) => {
          const tag = `${home.id} L${level} ${s.numeral}`;
          expect(s.label.text, tag).toBe(s.numeral);
          expect(s.label.size).toBe(SECTOR_LABEL_SIZE);
          // The label's anchor point (its baseline lifted back by the centering offset) lies inside its own slice, or (a
          // slice too small or crowded to hold it) just outside it.
          const gap = gapToSlice(s.label.x, s.label.y - SECTOR_LABEL_SIZE * 0.3, s);
          expect(gap, tag).toBeLessThanOrEqual(SECTOR_LABEL_BESIDE_PX + 0.3);
          if (gap > 0.3) beside++;
          const b = boxes[i];
          expect(b.x0 >= vx && b.x1 <= vx + vw && b.y0 >= vy && b.y1 <= vy + vh, `${tag} in view`).toBe(true);
          for (const badge of map.badges) expect(hitsCircle(b, badge.x, badge.y, map.badgeR), `${tag} / badge ${badge.numeral}`).toBe(false);
          expect(hitsCircle(b, map.home.x, map.home.y, 4), `${tag} / home`).toBe(false);
          expect(hitsCircle(b, map.core.x, map.core.y, 3.5), `${tag} / core`).toBe(false);
          for (const l of [map.homeLabel, map.coreLabel]) expect(meet(b, telescopeMapLabelBox(l)), `${tag} / ${l.text}`).toBe(false);
          boxes.forEach((o, j) => {
            if (j !== i) expect(meet(b, o), `${tag} / ${view.sectors[j].numeral}`).toBe(false);
          });
          labeled++;
        });
        // III and IV share a ring: their two labels never sit on the same spot.
        const three = view.sectors.find((s) => s.tier === 3);
        const four = view.sectors.find((s) => s.tier === 4);
        if (three && four) {
          expect(Math.hypot(three.label.x - four.label.x, three.label.y - four.label.y)).toBeGreaterThan(SECTOR_LABEL_SIZE);
          apart++;
        }
      }
    }
    expect(labeled).toBeGreaterThan(500);
    // Most labels sit inside their slice.
    expect(beside).toBeLessThan(labeled / 5);
    expect(apart).toBeGreaterThan(50);
  });

  it("Tier VI and VII slices point toward the drawn Galactic Core, from every homeworld", { timeout: 60_000 }, () => {
    for (const home of SEEDED) {
      const map = telescopeMapView(TOP, home);
      const coreBearing = Math.round(screenBearing(map.core.x, map.core.y)) % BEARING_TURN;
      for (const s of telescopeMapEnemyView(TOP, home).sectors.filter((x) => x.tier >= 6)) {
        // The drawn core lies in the middle half of the slice (a tenth of a degree of rounding allowed).
        const into = (coreBearing - s.startBearing + BEARING_TURN) % BEARING_TURN;
        expect(into, `${home.id} ${s.numeral}`).toBeGreaterThanOrEqual(s.widthBearing / 4 - 2);
        expect(into, `${home.id} ${s.numeral}`).toBeLessThanOrEqual((3 * s.widthBearing) / 4 + 2);
      }
    }
  });

  it("the provisional fixture has no enemy territory, so its map reads exactly as before", () => {
    for (let level = 0; level <= TOP; level++) expect(telescopeMapEnemyView(level)).toEqual(NONE);
  });
});
