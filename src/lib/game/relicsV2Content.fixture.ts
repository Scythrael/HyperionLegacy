// Relics v2 R2-5 / R2-6 test fixture: the identification chain the content goldens (relicsV2ContentGoldens.test.ts) and
// the content tests share. Tests only.
import { freshState, type EquipmentRarity, type GameState, type RegionTier, type RelicVaultToken } from "./model";
import { CULTURE_ROSTER, EXCEPTIONAL_SETS } from "./relics";
import { queueAllRelicStudies, resolveProcesses } from "./tick";

const RARITIES: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];

// `count` blanks: tier (n % 7) + 1, rarity n % 4 (radiant every fourth), culture slot n % 2 of its tier's roster, no
// site, the tier stagger stamp on the odd ones.
export function contentGoldenVault(count = 160): RelicVaultToken[] {
  const out: RelicVaultToken[] = [];
  for (let n = 0; n < count; n++) {
    const tier = ((n % 7) + 1) as RegionTier;
    out.push({
      id: `cg-${n}`,
      tier: RARITIES[n % 4],
      quality: 0,
      regionTier: tier,
      cultureId: CULTURE_ROSTER[tier][n % 2],
      source: "expedition",
      ...(n % 2 === 1 ? { stagger: 1 as const } : {}),
    });
  }
  return out;
}

// The Museum holds every exceptional piece but the last of each set, so every exceptional reveal completes a set (call 7:
// the reveal prefers the missing piece).
export function contentGoldenHeld(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const set of EXCEPTIONAL_SETS) for (const p of set.pieces.slice(0, -1)) out[p.id] = 1;
  return out;
}

// A Lab VII save (four lanes) with the blanks queued at once and the Museum above.
export function contentGoldenStart(count = 160): GameState {
  const base = freshState();
  const s: GameState = {
    ...base,
    museumV2: { ...base.museumV2, exceptional: contentGoldenHeld() },
    facilities: { ...base.facilities, research: { level: 7 } },
    relicVault: contentGoldenVault(count),
    relicSeed: 0x2b3c4d5e,
    nextRelicStudyIndex: 1,
  };
  return queueAllRelicStudies(s).next;
}

// Resolve until no relic study runs and the queue is empty, in chunks of `chunk` ticks (Infinity = one call).
export function resolveChain(s: GameState, chunk: number): GameState {
  if (chunk === Infinity) return resolveProcesses(s, 160 * 40 * 60 * 10, () => 0).next; // far past the chain's end
  const pending = (x: GameState) => x.activeProcesses.some((p) => p.kind === "relicStudy") || (x.relicQueue ?? []).length > 0;
  let cur = s;
  let guard = 0;
  while (pending(cur) && guard++ < 100_000) cur = resolveProcesses(cur, chunk, () => 0).next;
  return cur;
}
