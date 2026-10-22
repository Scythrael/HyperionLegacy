// testStates.ts: representative secret game states for the catch-up tests. Test-only.
import { freshSecretState, cloneSecret, type SecretState } from "./state";
import { stepMut, buyOverclockMut, buyTierMut, effectiveExponent } from "./engine";
import { SKILLS, FINALE_EXPONENT, type SkillId } from "./config";

function grant(s: SecretState, ids: readonly SkillId[]): void {
  for (const id of ids) s.skills[id] = true;
}

function play(s: SecretState, seconds: number, dt: number, until?: (s: SecretState) => boolean): SecretState {
  let t = 0;
  while (t < seconds) {
    stepMut(s, dt, s.lastTickAt + (t + dt) * 1000);
    t += dt;
    if (until && until(s)) break;
  }
  return s;
}

// A first session with no skills: the player bought Max a few times and walked away.
export function earlyManualState(): SecretState {
  const s = freshSecretState(0);
  for (let i = 0; i < 12; i++) {
    buyOverclockMut(s, s.ore.mul(0.5));
    for (let k = 3; k >= 0; k--) buyTierMut(s, k, s.ore);
    play(s, 180, 1);
  }
  return s;
}

// Mid game: the first four autos, Captain and Fleet Prestige cycling on their own.
export function midAutoState(): SecretState {
  const s = freshSecretState(0);
  grant(s, ["autoOverclock", "autoBuyLow", "autoCaptain", "autoFleet"]);
  return play(s, 6 * 3600, 1);
}

// Just after the first Prestigeception, everything automated.
export function postPrestigeceptionState(): SecretState {
  const s = freshSecretState(0);
  grant(s, SKILLS.map((d) => d.id));
  play(s, 30 * 86400, 5, (x) => x.pcCount >= 1);
  return play(s, 60, 1);
}

// Past the finale, everything automated.
export function pastFinaleState(): SecretState {
  const s = freshSecretState(0);
  grant(s, SKILLS.map((d) => d.id));
  play(s, 60 * 86400, 10, (x) => effectiveExponent(x.bestOre) > FINALE_EXPONENT + 5000);
  return play(s, 60, 1);
}

export function live(s: SecretState, seconds: number): SecretState {
  const x = cloneSecret(s);
  for (let i = 1; i <= seconds; i++) stepMut(x, 1, s.lastTickAt + i * 1000);
  x.lastTickAt = s.lastTickAt + seconds * 1000;
  return x;
}
