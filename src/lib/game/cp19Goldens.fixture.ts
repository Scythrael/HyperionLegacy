// Complement CP-19 GOLDENS (the candidate board expansion: the Personnel Rosters upgrade track; plan
// docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-19, OC-17, USER ANSWERS 2026-11-02 "Personnel Rosters
// track (Recommended)"): every path the slice can reach, through the live engine, captured on the code BEFORE the slice
// (CP19_PINS_PRE). TEST-ONLY (imported by *.test.ts files only).
//
// Rows:
//   fresh:facilities : a new game's facility levels (the slice seeds the track's pre-granted Level 1 here).
//   fresh:raw        : a new game, every field (the same move, nothing else).
//   fresh:stateHash  : a new game through the shared whole-state golden view (firstRunsGoldens.fixture.ts stateHash).
//   board:<w>        : both candidate boards (officers, then away-team recruits: their sizes and every candidate) at
//                      three roster windows, on a fresh save.
//   board:recruiter  : the same with captain 1 owning the Recruiter (commandCrew4), at window 0.
//   mission:<cut>    : a Short Ore Run for 1000 s in 1 s steps, one call and 997 s chunks (the three agree).
//   save:fresh       : a fresh save serialized, and through deserialize + migrate.
//   save:noTrack     : the same save with the track's key taken off the raw bytes (a v71 save from a build before the
//                      slice), through deserialize + migrate.
//   save:v70         : the same save stamped v70 (the v70 -> v71 step runs), through deserialize + migrate.

import { freshState, type GameState } from "./model";
import { seniorStaffCandidates, OFFICER_ROSTER_WINDOW_SECONDS } from "./seniorStaff";
import { awayRecruitCandidates } from "./awayTeam";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { cp16MissionStart, steppedBy } from "./cp16Goldens.fixture";
import { editCaptain, wiringBase } from "./wiring/probes";

const TRACK_KEY = "personnelRosters";

// Both boards of `s`: [officer count, officer hash, recruit count, recruit hash].
export function boards(s: GameState): unknown[] {
  const officers = seniorStaffCandidates(s);
  const recruits = awayRecruitCandidates(s);
  return [officers.length, hash(officers), recruits.length, hash(recruits)];
}

export const CP19_WINDOWS: readonly number[] = [0, 1, 7];

export function atWindow(s: GameState, w: number): GameState {
  return { ...s, gameTimeSeconds: w * OFFICER_ROSTER_WINDOW_SECONDS };
}

export function withRecruiter(s: GameState): GameState {
  return editCaptain(s, { unlockedSecondaryTalents: ["commandCrew4"] });
}

// The loaded save file with the track's facility key taken off (no-op where the save never had it), stamped
// `version` when given. Works on the deserialized SaveFile (the raw bytes are compressed). A fresh copy.
export function withoutTrackKey(file: SaveFile, version?: number): SaveFile {
  const copy = JSON.parse(JSON.stringify(file)) as SaveFile & { state: { facilities?: Record<string, unknown> } };
  if (copy.state.facilities) delete copy.state.facilities[TRACK_KEY];
  if (version !== undefined) copy.version = version;
  return copy;
}

function loaded(file: SaveFile | null): string {
  return hash(file === null ? null : serialize(migrate(file, 1), 0, 0));
}

// Every row.
export function cp19Rows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  const fresh = freshState();
  got["fresh:facilities"] = hash(fresh.facilities);
  got["fresh:raw"] = hash(fresh);
  got["fresh:stateHash"] = stateHash(fresh);
  for (const w of CP19_WINDOWS) got[`board:${w}`] = boards(atWindow(wiringBase(), w));
  got["board:recruiter"] = boards(withRecruiter(wiringBase()));
  const start = cp16MissionStart();
  got["mission:steps"] = stateHash(steppedBy(start, 1000, 1));
  got["mission:oneCall"] = stateHash(steppedBy(start, 1000, 1000));
  got["mission:chunks"] = stateHash(steppedBy(start, 1000, 997));
  const raw = serialize(fresh, 0, 0);
  const file = deserialize(raw);
  if (file === null) throw new Error("cp19 goldens: the fresh save did not load");
  got["save:fresh"] = [hash(raw), loaded(deserialize(raw))];
  got["save:noTrack"] = loaded(withoutTrackKey(file));
  got["save:v70"] = loaded(withoutTrackKey(file, 70));
  return got;
}

// Captured on feat 3a7c544, before the slice.
export const CP19_PINS_PRE: Record<string, unknown> = {
  "fresh:facilities": "6dd6a95b",
  "fresh:raw": "654ea6af",
  "fresh:stateHash": "f74b0831",
  "board:0": [10, "395ffda9", 10, "810463ea"],
  "board:1": [10, "22117c51", 10, "d6831831"],
  "board:7": [10, "bb2fec00", 10, "52a22504"],
  "board:recruiter": [11, "544d0573", 11, "d01f97c"],
  "mission:steps": "69db926a",
  "mission:oneCall": "69db926a",
  "mission:chunks": "69db926a",
  "save:fresh": ["6f9bd221", "25799eb1"],
  "save:noTrack": "25799eb1",
  "save:v70": "e194d109",
};
