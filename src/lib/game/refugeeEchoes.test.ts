// E5-6b (echo refugees): the approved roster (docs/plans/2026-11-03-refugee-echo-roster-DRAFT.md, "Approve all"
// 2026-11-13), the pick, the once-per-save rule through the arrivals and the save, and the text rules.

import { describe, expect, it } from "vitest";
import { freshState, type GameState } from "./model";
import { rollShortRangeJob, type ShortRangeRoll } from "./shortRange";
import { shortRangeBoardSlots } from "./shortRangeBoard";
import { REFUGEE_ECHOES, REFUGEE_ECHO_CHANCE, isRefugeeEchoKey, refugeeEchoOf, refugeeEchoPick } from "./refugeeEchoes";
import { applyRefugeeDeliveries, rollRefugee, type RefugeeDelivery } from "./refugeeArrival";
import { hydrateRefugees, isWellFormedRefugeeRecord, type RefugeeBackground, type RefugeeRecord, type RefugeeState } from "./refugees";
import { withEchoRefugeesOff } from "./refugeeEchoSwitch.fixture";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { devGrantRefugee } from "./refugeeDevGrant";

const EMPTY: RefugeeState = { version: 1, list: [], nextId: 1, arrivedTotal: 0, greet: [] };

function rolls(n: number): ShortRangeRoll[] {
  const s = { ...freshState(), facilities: { ...freshState().facilities, missionControl: { ...freshState().facilities.missionControl, level: 3 } } };
  const slots = shortRangeBoardSlots(s);
  const out: ShortRangeRoll[] = [];
  for (let c = 0; out.length < n; c++) for (const slot of slots) if (out.length < n) out.push(rollShortRangeJob(s, slot, c));
  return out;
}

// Every roll whose arrival is an echo when nobody has arrived yet.
function echoRolls(n: number): ShortRangeRoll[] {
  return rolls(n).filter((r) => rollRefugee(r, 1, 0).echo !== undefined);
}

function evac(roll: ShortRangeRoll, atTick: number, slotId = 0): RefugeeDelivery {
  return { kind: "evacuation", atTick, slotId, roll: { ...roll, difficulty: { ...roll.difficulty, firstRun: false } } };
}

const CALL = { gameTimeSeconds: 0, tickDurationSeconds: 1 };

describe("E5-6b the approved roster", () => {
  it("59 echoes, unique keys and names, the roster's backgrounds (54 core plus the five extras)", () => {
    expect(REFUGEE_ECHOES).toHaveLength(59);
    expect(new Set(REFUGEE_ECHOES.map((e) => e.key)).size).toBe(59);
    expect(new Set(REFUGEE_ECHOES.map((e) => e.name)).size).toBe(59);
    const count: Partial<Record<RefugeeBackground, number>> = {};
    for (const e of REFUGEE_ECHOES) count[e.background] = (count[e.background] ?? 0) + 1;
    // The sheet's "Background spread (core 54)" plus the five approved extras (machinist, fuel handler, stargazer,
    // scholar, refiner, one each).
    expect(count).toEqual({ refiner: 8, fuelHandler: 8, dispatcher: 8, scholar: 8, machinist: 6, shipwright: 6, salvager: 7, stargazer: 8 });
  });

  it("the sheet's first and last rows, word for word", () => {
    expect(REFUGEE_ECHOES[0]).toEqual({ key: "lucan-skyward", name: "Lucan Skyward", background: "stargazer", flavor: "Grew up on a desert farm watching two suns set, and still swears the stars feel close." });
    expect(REFUGEE_ECHOES[58]).toEqual({ key: "sam-gamwell", name: "Sam Gamwell", background: "refiner", flavor: "A gardener at heart. If you cannot carry the load, he will carry you." });
  });

  it("text rules: no em or en dash, no double hyphen, no 'fit', no franchise or trademarked term", () => {
    const banned = [
      "jedi", "force", "stargate", "aes sedai", "saiyan", "quirk", "plus ultra", "soldier", "wookiee", "star wars",
      "babylon", "wheel of time", "final fantasy", "dragon ball", "hero academia", "firefly", "farscape", "hitchhiker",
      "lord of the rings", "star trek",
    ];
    for (const e of REFUGEE_ECHOES) {
      for (const text of [e.name, e.flavor]) {
        expect(text).not.toMatch(/[\u2013\u2014]|--/);
        expect(text).not.toMatch(/\bfit(s|ted|ting)?\b/i);
        for (const b of banned) expect(text.toLowerCase(), `${e.key}: ${b}`).not.toContain(b);
      }
      expect(e.flavor.length).toBeGreaterThan(20);
    }
  });

  it("refugeeEchoOf and isRefugeeEchoKey read the roster only", () => {
    expect(refugeeEchoOf("ody-dagby")?.name).toBe("Ody Dagby");
    expect(refugeeEchoOf("nobody")).toBeUndefined();
    expect(refugeeEchoOf(3)).toBeUndefined();
    expect(isRefugeeEchoKey("kayla-fry")).toBe(true);
    expect(isRefugeeEchoKey("")).toBe(false);
  });

  it("the chance is the user's 1 in 50", () => {
    expect(REFUGEE_ECHO_CHANCE).toBe(1 / 50);
  });
});

describe("E5-6b the pick: uniform among the echoes still to come, null when all have arrived", () => {
  it("draws map onto the open echoes in roster order", () => {
    expect(refugeeEchoPick([], 0)?.key).toBe(REFUGEE_ECHOES[0].key);
    expect(refugeeEchoPick([], 0.999999)?.key).toBe(REFUGEE_ECHOES[58].key);
    expect(refugeeEchoPick([REFUGEE_ECHOES[0].key], 0)?.key).toBe(REFUGEE_ECHOES[1].key);
    const allButOne = REFUGEE_ECHOES.slice(1).map((e) => e.key);
    for (const d of [0, 0.5, 0.999999]) expect(refugeeEchoPick(allButOne, d)?.key).toBe(REFUGEE_ECHOES[0].key);
    expect(refugeeEchoPick(REFUGEE_ECHOES.map((e) => e.key), 0.3)).toBeNull();
  });

  it("every echo is reachable, each with an equal share of the draw", () => {
    const hits = new Map<string, number>();
    for (let i = 0; i < 5900; i++) {
      const e = refugeeEchoPick([], (i + 0.5) / 5900)!;
      hits.set(e.key, (hits.get(e.key) ?? 0) + 1);
    }
    expect(hits.size).toBe(59);
    for (const n of hits.values()) expect(n).toBe(100);
  });
});

describe("E5-6b arrivals: once per save, then normal refugees", () => {
  it("an echo roll with every echo arrived brings the normal refugee, exactly as before E5-6b", () => {
    const all = REFUGEE_ECHOES.map((e) => e.key);
    const found = echoRolls(4000);
    expect(found.length).toBeGreaterThan(0);
    for (const roll of found) {
      const normal = rollRefugee(roll, 7, 5, all);
      expect(normal.echo).toBeUndefined();
      expect(normal).toEqual(withEchoRefugeesOff(() => rollRefugee(roll, 7, 5)));
    }
  });

  it("an echo keeps the normal skill roll, portrait and origin; takes the roster's name and background", () => {
    for (const roll of echoRolls(4000)) {
      const on = rollRefugee(roll, 9, 42);
      const off = withEchoRefugeesOff(() => rollRefugee(roll, 9, 42));
      const echo = refugeeEchoOf(on.echo)!;
      expect(on).toEqual({ ...off, name: echo.name, background: echo.background, echo: echo.key });
    }
  });

  it("the same echo roll twice in one save brings two different echoes; the arrived list grows by one each", () => {
    const roll = echoRolls(4000)[0];
    const out = applyRefugeeDeliveries(EMPTY, 1e9, [evac(roll, 1, 0), evac(roll, 1, 1)], CALL);
    const [a, b] = out.refugees.list;
    expect(a.echo).toBeDefined();
    expect(b.echo).toBeDefined();
    expect(a.echo).not.toBe(b.echo);
    expect(out.refugees.echoes).toEqual([a.echo, b.echo]);
    // And across calls: the second call reads the first call's echoes.
    const first = applyRefugeeDeliveries(EMPTY, 1e9, [evac(roll, 1, 0)], CALL);
    const second = applyRefugeeDeliveries(first.refugees, 1e9, [evac(roll, 1, 1)], CALL);
    expect(second.refugees).toEqual(out.refugees);
  });

  it("59 echo rolls bring all 59 echoes once each; the 60th is a normal refugee", () => {
    const roll = echoRolls(4000)[0];
    const ds = Array.from({ length: 60 }, (_, i) => evac(roll, i + 1));
    const out = applyRefugeeDeliveries(EMPTY, 1e9, ds, CALL);
    const keys = out.refugees.list.map((r) => r.echo);
    expect(new Set(keys.slice(0, 59)).size).toBe(59);
    expect(keys[59]).toBeUndefined();
    expect(out.refugees.echoes).toHaveLength(59);
  });

  it("an echo who leaves with a Refugee Relocation never comes back", () => {
    const roll = echoRolls(4000)[0];
    const arrived = applyRefugeeDeliveries(EMPTY, 1e9, [evac(roll, 1)], CALL).refugees;
    const key = arrived.list[0].echo!;
    const gone = applyRefugeeDeliveries(arrived, 1e9, [{ kind: "relocation", atTick: 2, slotId: 0, roll }], CALL).refugees;
    expect(gone.list).toHaveLength(0);
    expect(gone.echoes).toEqual([key]);
    const again = applyRefugeeDeliveries(gone, 1e9, [evac(roll, 3)], CALL).refugees;
    expect(again.list[0].echo).toBeDefined();
    expect(again.list[0].echo).not.toBe(key);
  });

  it("a normal arrival adds no echoes key (an old save's state shape is unchanged)", () => {
    const normal = rolls(400).find((r) => rollRefugee(r, 1, 0).echo === undefined)!;
    const out = applyRefugeeDeliveries(EMPTY, 1e9, [evac(normal, 1)], CALL).refugees;
    expect("echoes" in out).toBe(false);
    expect("echo" in out.list[0]).toBe(false);
  });
});

describe("E5-6b the [DEV] grant (Debug tab only)", () => {
  it("grants a normal refugee or the next echo through the real roll, queued for the arrival card", () => {
    const s0 = freshState(1);
    const a = devGrantRefugee(s0, "normal")!;
    expect(a.record.echo).toBeUndefined();
    expect(a.next.refugees).toMatchObject({ nextId: 2, arrivedTotal: 1, greet: [1] });
    expect("echoes" in a.next.refugees!).toBe(false);
    const b = devGrantRefugee(a.next, "echo")!;
    expect(b.record.id).toBe(2);
    expect(isRefugeeEchoKey(b.record.echo)).toBe(true);
    expect(b.record.name).toBe(refugeeEchoOf(b.record.echo)!.name);
    expect(b.next.refugees!.echoes).toEqual([b.record.echo]);
    expect(hydrateRefugees(b.next)).toBe(b.next); // a clean, loadable state
  });

  it("grants every echo once, then no more", () => {
    let s = freshState(1);
    for (let i = 0; i < 59; i++) s = devGrantRefugee(s, "echo")!.next;
    expect(new Set(s.refugees!.echoes).size).toBe(59);
    expect(devGrantRefugee(s, "echo")).toBeNull();
    expect(devGrantRefugee(s, "normal")!.record.echo).toBeUndefined();
  });
});

describe("E5-6b save: echoes round-trip; hydration keeps nobody twice and drops only unknown keys", () => {
  const rec = (id: number, echo?: string): RefugeeRecord => ({
    id,
    name: echo ? refugeeEchoOf(echo)!.name : `Person ${id}`,
    background: echo ? refugeeEchoOf(echo)!.background : "scholar",
    skill: 40,
    origin: { tier: 1, destinationIndex: 0 },
    portrait: { hair: 1, palette: 2 },
    arrivedAtSeconds: 10,
    posting: null,
    ...(echo ? { echo } : {}),
  });
  const withRefugees = (refugees: unknown): GameState => ({ ...freshState(), refugees } as GameState);

  it("a clean state with echoes loads as the same reference", () => {
    const s = withRefugees({ version: 1, list: [rec(1, "ody-dagby"), rec(2)], nextId: 3, arrivedTotal: 3, greet: [], echoes: ["lucan-skyward", "ody-dagby"] });
    expect(hydrateRefugees(s)).toBe(s);
    expect(isWellFormedRefugeeRecord(rec(1, "ody-dagby"))).toBe(true);
  });

  it("an unknown echo key on a record is taken off; the person stays", () => {
    const s = withRefugees({ version: 1, list: [{ ...rec(1), echo: "not-a-roster-key" }], nextId: 2, arrivedTotal: 1, greet: [] });
    const out = hydrateRefugees(s).refugees!;
    expect(out.list).toEqual([rec(1)]);
    expect("echoes" in out).toBe(false);
  });

  it("echoes keeps known keys once each and gains every record's echo", () => {
    const s = withRefugees({ version: 1, list: [rec(1, "kayla-fry")], nextId: 2, arrivedTotal: 4, greet: [], echoes: ["ody-dagby", "ody-dagby", "zzz", 4] });
    expect(hydrateRefugees(s).refugees!.echoes).toEqual(["ody-dagby", "kayla-fry"]);
    const bad = withRefugees({ version: 1, list: [], nextId: 1, arrivedTotal: 0, greet: [], echoes: "x" });
    expect("echoes" in hydrateRefugees(bad).refugees!).toBe(false);
  });

  it("serialize, deserialize and migrate keep the echoes and the record's key", () => {
    const refugees: RefugeeState = { version: 1, list: [rec(1, "mae-hatsuma")], nextId: 2, arrivedTotal: 2, greet: [1], echoes: ["lucan-skyward", "mae-hatsuma"] };
    const s = { ...freshState(), refugees };
    const loaded = migrate(deserialize(serialize(s, 0, 1_790_000_000_000)) as SaveFile, 1);
    expect(loaded.refugees).toEqual(refugees);
  });
});
