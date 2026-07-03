// Save file contract — tech spec §6. Versioned from commit one (Ops §8.E.1),
// even though there is exactly one version and zero migrations right now.
// When the schema changes: bump SAVE_VERSION, add a migrate_vN_to_vN+1
// function to MIGRATIONS, and never touch old migrations again.

import LZString from "lz-string";
import { type GameState } from "./model";

export const SAVE_VERSION = 1;
export const SAVE_KEY = "fleet_admiral_save";

export interface SaveFile {
  version: number;
  created_at: number;
  last_saved_at: number;
  game_time_seconds: number;
  state: GameState;
}

// Migration stub. Empty today; this is intentional per Ops §8.E.1 —
// retrofitting versioning after real saves exist is the thing to avoid.
// Example of what a future entry looks like:
//   2: (state: any): GameState => ({ ...state, newField: 0 }),
type Migration = (state: any) => any;
const MIGRATIONS: Record<number, Migration> = {};

export function migrate(save: SaveFile): GameState {
  let state = save.state;
  let version = save.version;
  while (MIGRATIONS[version]) {
    state = MIGRATIONS[version](state);
    version += 1;
  }
  return state as GameState;
}

export function serialize(state: GameState, createdAt: number): string {
  const payload: SaveFile = {
    version: SAVE_VERSION,
    created_at: createdAt,
    last_saved_at: Date.now(),
    game_time_seconds: state.gameTimeSeconds,
    state,
  };
  return LZString.compressToBase64(JSON.stringify(payload));
}

export function deserialize(raw: string): SaveFile | null {
  try {
    const json = LZString.decompressFromBase64(raw);
    if (!json) return null;
    return JSON.parse(json) as SaveFile;
  } catch {
    // Corrupt save — tech spec §6 says preserve raw data and surface it
    // rather than silently discarding. The caller decides what to show.
    return null;
  }
}

export function saveToLocalStorage(state: GameState, createdAt: number): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state, createdAt));
    localStorage.setItem(`${SAVE_KEY}_created_at`, String(createdAt));
    return true;
  } catch {
    return false;
  }
}

export function loadFromLocalStorage(): { state: GameState; lastSavedAt: number; createdAt: number } | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  const save = deserialize(raw);
  if (!save) return null;
  return { state: migrate(save), lastSavedAt: save.last_saved_at, createdAt: save.created_at };
}

export function exportRawSave(): string | null {
  return localStorage.getItem(SAVE_KEY);
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(`${SAVE_KEY}_created_at`);
}
