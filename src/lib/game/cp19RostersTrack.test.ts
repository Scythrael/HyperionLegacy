// Complement CP-19 (the candidate board expansion; plan 2026-10-14 CP-19 / OC-17; user 2026-11-02 "Personnel Rosters
// track (Recommended)"): the Personnel Rosters upgrade track. Five bought rungs on a pre-granted Level 1, +2 slots on
// both candidate boards each (10 -> 20), 3,000 x the rung's number in credits plus time; slot-keyed boards (a larger
// board appends, the earlier slots hold); the seed for old saves; and the tick parity with a rung finishing mid-span.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  FACILITIES,
  PERSONNEL_ROSTERS_FACILITY_KEY,
  PERSONNEL_ROSTERS_LEVELS,
  SENIOR_STAFF_ROSTER_BASE,
  freshState,
  personnelRostersBoardSlots,
  personnelRostersLevel,
  type GameState,
} from "./model";
import { canBuildFacilityUpgrade, economyTick, startFacilityUpgrade } from "./tick";
import { seniorStaffCandidates } from "./seniorStaff";
import { awayRecruitCandidates } from "./awayTeam";
import { candidateBoardSize } from "./captainExplorerEffects";
import { deserialize, migrate, serialize, withPersonnelRostersTrackV71 } from "./save";
import { stateHash } from "./firstRunsGoldens.fixture";
import { cp16MissionStart, steppedBy } from "./cp16Goldens.fixture";
import { atWindow, withRecruiter, withoutTrackKey } from "./cp19Goldens.fixture";
import { withoutCp19 } from "./cp19Switch.fixture";
import { wiringBase } from "./wiring/probes";

const KEY = PERSONNEL_ROSTERS_FACILITY_KEY;
const atLevel = (s: GameState, level: number): GameState => ({ ...s, facilities: { ...s.facilities, [KEY]: { level } } });
const officerIds = (s: GameState): string[] => seniorStaffCandidates(s).map((c) => JSON.stringify(c));
const recruitIds = (s: GameState): string[] => awayRecruitCandidates(s).map((c) => JSON.stringify(c));

describe("CP-19 the track's table (the user's numbers)", () => {
  it("a pre-granted Level 1 and five bought rungs: +2 slots each, 3,000 x the rung's number, credits and time only", () => {
    const track = FACILITIES[KEY].upgrades;
    expect(track).toHaveLength(6);
    expect(PERSONNEL_ROSTERS_LEVELS.map((r) => r.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(track[0].credits).toBeUndefined();
    expect(track[0].durationTicks).toBe(0);
    expect(track[0].effect).toEqual({ addCandidateSlots: 0 });
    for (let rung = 1; rung <= 5; rung++) {
      const up = track[rung];
      expect(up.credits?.toNumber(), `rung ${rung}`).toBe(3_000 * rung);
      expect(up.durationTicks, `rung ${rung}`).toBeGreaterThan(0);
      expect(up.effect).toEqual({ addCandidateSlots: 2 });
      expect(up.materials).toEqual({});
      expect(up.requiresFleetAdminLevel).toBeUndefined();
      expect(up.requiresHomeworldTalents).toBeUndefined();
    }
    expect(SENIOR_STAFF_ROSTER_BASE + PERSONNEL_ROSTERS_LEVELS.reduce((n, r) => n + r.boardSlots, 0)).toBe(20);
  });
});

describe("CP-19 the boards", () => {
  it("a new game starts at Level 1 with today's board of 10 on both boards", () => {
    const s = freshState();
    expect(personnelRostersLevel(s)).toBe(1);
    expect(personnelRostersBoardSlots(s)).toBe(0);
    expect(seniorStaffCandidates(s)).toHaveLength(10);
    expect(awayRecruitCandidates(s)).toHaveLength(10);
  });

  it("each level grows both boards by 2, to 20 at Level 6 (a level past the track reads the top)", () => {
    const base = wiringBase();
    for (let level = 0; level <= 7; level++) {
      const want = 10 + 2 * Math.max(0, Math.min(6, level) - 1);
      const s = atLevel(base, level);
      expect(candidateBoardSize(s), `level ${level}`).toBe(want);
      expect(seniorStaffCandidates(s), `officers @ ${level}`).toHaveLength(want);
      expect(awayRecruitCandidates(s), `recruits @ ${level}`).toHaveLength(want);
    }
  });

  it("an absent key (an old save before its load) reads the base board of 10", () => {
    const s = wiringBase();
    const { [KEY]: _gone, ...rest } = s.facilities;
    expect(candidateBoardSize({ ...s, facilities: rest })).toBe(10);
  });

  it("slots 0 to 9 are identical before and after an upgrade, on both boards, at several windows; new slots append", () => {
    for (const w of [0, 1, 7, 40]) {
      const before = atWindow(wiringBase(), w);
      for (let level = 2; level <= 6; level++) {
        const after = atLevel(before, level);
        expect(officerIds(after).slice(0, 10), `officers w${w} L${level}`).toEqual(officerIds(before));
        expect(recruitIds(after).slice(0, 10), `recruits w${w} L${level}`).toEqual(recruitIds(before));
        const prev = atLevel(before, level - 1);
        expect(officerIds(after).slice(0, officerIds(prev).length), `officers grow by append w${w} L${level}`).toEqual(officerIds(prev));
        expect(recruitIds(after).slice(0, recruitIds(prev).length), `recruits grow by append w${w} L${level}`).toEqual(recruitIds(prev));
      }
    }
  });

  it("the Recruiter multiplies the whole board (best one counts): 11 at Level 1, 22 at Level 6", () => {
    const s = withRecruiter(wiringBase());
    expect(candidateBoardSize(s)).toBe(11);
    expect(candidateBoardSize(atLevel(s, 6))).toBe(22);
    expect(officerIds(atLevel(s, 6)).slice(0, 11)).toEqual(officerIds(s));
  });
});

describe("CP-19 buying a rung", () => {
  it("costs 3,000 credits and its time, then the boards read 12", () => {
    const s = { ...wiringBase(), credits: new Decimal(5_000) };
    expect(canBuildFacilityUpgrade(s, KEY)).toEqual({ ok: true });
    const r = startFacilityUpgrade(s, KEY);
    expect(r.started).toBe(true);
    expect(r.next.credits.toNumber()).toBe(2_000);
    expect(canBuildFacilityUpgrade(r.next, KEY).ok).toBe(false);
    const ticks = FACILITIES[KEY].upgrades[1].durationTicks;
    const before = economyTick(r.next, ticks - 1, () => 0.5);
    expect(personnelRostersLevel(before)).toBe(1);
    expect(candidateBoardSize(before)).toBe(10);
    const done = economyTick(before, 1, () => 0.5);
    expect(personnelRostersLevel(done)).toBe(2);
    expect(candidateBoardSize(done)).toBe(12);
  });

  it("refuses without the credits, and once the track is at its top rung", () => {
    expect(canBuildFacilityUpgrade({ ...wiringBase(), credits: new Decimal(2_999) }, KEY).ok).toBe(false);
    expect(canBuildFacilityUpgrade(atLevel(wiringBase(), 6), KEY)).toEqual({ ok: false, reason: "Personnel Rosters is fully upgraded" });
  });

  it("offline equals live: one call, 997 s chunks and 1 s steps agree with a rung finishing mid-span (a mission in flight)", () => {
    const start = { ...cp16MissionStart(), credits: new Decimal(1_000_000) };
    const r = startFacilityUpgrade(start, KEY);
    expect(r.started).toBe(true);
    const steps = steppedBy(r.next, 1000, 1);
    const oneCall = steppedBy(r.next, 1000, 1000);
    const chunks = steppedBy(r.next, 1000, 997);
    expect(personnelRostersLevel(steps)).toBe(2);
    expect(stateHash(oneCall)).toBe(stateHash(steps));
    expect(stateHash(chunks)).toBe(stateHash(steps));
    expect(candidateBoardSize(oneCall)).toBe(12);
  });

  it("a rung bought and finished in the same span as the next start: the second rung's parity holds too", () => {
    const one = atLevel({ ...cp16MissionStart(), credits: new Decimal(1_000_000) }, 2);
    const r = startFacilityUpgrade(one, KEY);
    expect(r.started).toBe(true);
    const span = FACILITIES[KEY].upgrades[2].durationTicks + 37;
    const steps = steppedBy(r.next, span, 1);
    expect(personnelRostersLevel(steps)).toBe(3);
    expect(stateHash(steppedBy(r.next, span, span))).toBe(stateHash(steps));
    expect(stateHash(steppedBy(r.next, span, 97))).toBe(stateHash(steps));
  });
});

describe("CP-19 the save", () => {
  it("SAVE_VERSION stays 71; a fresh save round-trips its Level", () => {
    const s = atLevel(freshState(), 4);
    const back = migrate(deserialize(serialize(s, 0, 0))!, 1);
    expect(personnelRostersLevel(back)).toBe(4);
  });

  it("a v71 save from before CP-19 (no key) loads at Level 1 with the board of 10; a v70 save gets it from the step", () => {
    const file = deserialize(serialize(freshState(), 0, 0))!;
    for (const old of [withoutTrackKey(file), withoutTrackKey(file, 70)]) {
      expect((old.state as { facilities: Record<string, unknown> }).facilities[KEY]).toBeUndefined();
      const loaded = migrate(old, 1);
      expect(loaded.facilities[KEY]).toEqual({ level: 1 });
      expect(seniorStaffCandidates(loaded)).toHaveLength(10);
      expect(awayRecruitCandidates(loaded)).toHaveLength(10);
    }
  });

  it("the seed is idempotent, keeps an existing level and is hardened", () => {
    const at3 = { facilities: { [KEY]: { level: 3 } } };
    expect(withPersonnelRostersTrackV71(at3)).toBe(at3);
    const seeded = withPersonnelRostersTrackV71({ facilities: { refinery: { level: 0 } } });
    expect(seeded.facilities).toEqual({ refinery: { level: 0 }, [KEY]: { level: 1 } });
    expect(withPersonnelRostersTrackV71(seeded)).toBe(seeded);
    expect(withPersonnelRostersTrackV71(null)).toBe(null);
    const junk = { facilities: [1] };
    expect(withPersonnelRostersTrackV71(junk)).toBe(junk);
    expect(withPersonnelRostersTrackV71({}).facilities).toEqual({ [KEY]: { level: 1 } });
  });

  it("with the slice switched off a new game and a loaded save carry no key and the boards read the stored size", () => {
    withoutCp19(() => {
      expect(freshState().facilities[KEY]).toBeUndefined();
      const file = deserialize(serialize(freshState(), 0, 0))!;
      expect(migrate(file, 1).facilities[KEY]).toBeUndefined();
      expect(candidateBoardSize(atLevel(wiringBase(), 6))).toBe(10);
    });
  });
});
