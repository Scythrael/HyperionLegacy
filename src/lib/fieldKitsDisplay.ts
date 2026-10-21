// fieldKitsDisplay.ts: the display decisions of the Field Kits screens (0.14.0, Field Kits FKR-9 and FKR-10;
// docs/plans/2026-10-14-field-kits-plan.md, built to the signed-off packing mockup, USER ANSWERS 2026-10-20).
//
//   - DISPATCH PACKING (dispatchPackView): per deploying team, one card per Security member: their spec mark, Medical
//     Training, where their pack comes from (the default, their team's worn loadout, or edited with a Reset), the
//     installed tool with its charges, the free set, and one stepper per kit they can use, pre-filled from their pack
//     preference. Each kit row says where it comes from: the Warehouse, "N short" (quiet, top-up off) or "N bought at
//     launch" (top-up on). Non-medics get ONE dim "needs Medical Training" line instead of the three Advanced Medical
//     rows. Per team: the "Top up from the Quartermaster at launch" toggle with its cost preview (remembered on the
//     team, never blocks a launch). The Warehouse stock left after the launch, the Science / Survey ghost lines.
//   - IN THE RUN (runSuppliesView, runCardLine): per Security member, the free set left, the extras and grenade charges
//     left (with the grenade's fuse: timed grenades, user 2026-10-21), and their condition with its bay time; the objective's "Final fight: Elite" chip; the one-line summary on
//     the expedition card.
//   - THE CLAIM (claimKitsView): "Kits home" and what the run used.
//   - LOGISTICS + QUARTERMASTER (fieldKitStockRows, fieldKitShopRows): the stock view and the kit sale rows.
//
// WHY a .ts beside the components: this repo has no Svelte component test harness, so every choice worth gating lives
// here as pure functions over the tested engine (fieldKitsRun.ts planDispatchPacks is THE plan the dispatch settles, so
// the screen can never promise a pack the launch would not make). Nothing here changes a rule or writes state.

import type {
  AwayMember,
  EnemyRank,
  EquipmentInstance,
  Expedition,
  ExpeditionActivity,
  GambitProgram,
  GameState,
  GrenadeTraits,
  GroundTeamKind,
  GroundTeamRun,
  ShipInstance,
  SnapshotMember,
} from "./game/model";
import { GRENADE_CARRY_PER_LINE, memberVariety } from "./game/model";
import {
  CONDITION_LINES,
  FIELD_KITS,
  FIELD_KITS_CATALOG_VERSION,
  FIELD_KITS_RUNS_LIVE,
  FIELD_KIT_IDS,
  FIELD_KIT_PRICES,
  INJURY_KIT_TREATMENT_SHARE,
  KIT_CATEGORY_RULES,
  SPLINT_HEAL_ROUNDS,
  canUseKit,
  fieldKitsLive,
  freeBasicFirstAid,
  kitClears,
  timedFusesLive,
  type FieldKitId,
} from "./game/fieldKits";
import {
  carriedExtras,
  defaultMemberPack,
  freeBasicsOf,
  memberHasMedicalTraining,
  memberPackPreference,
  planDispatchPacks,
  usedExtras,
  type DispatchPackPlan,
  type KitCounts,
  type PackTeam,
} from "./game/fieldKitsRun";
import { chargesLeftFor } from "./game/fieldKitsGrenades";
import { pieceCarryLines, snapshotMembers, toolCharges } from "./game/awayTeam";
import { GAMBIT_STATUSES, shipSupportHeads, type GambitLogEvent } from "./game/gambit";
import { fieldKitsFightProgram, memberGambitProgram } from "./game/memberGambits";
import { deployableGroundTeams, groundTeamName, type GroundTeamReadiness } from "./game/groundTeams";
import { shipGroundTeams } from "./game/groundTeamSlots";
import { teamKindName } from "./game/groundComposition";
import { groundTeamWornLoadout } from "./game/armory";
import { ENEMY_RANKS, fightLeadRank, isTrainingRun, ranksLive } from "./game/enemyRanks";
import { GROUND_CONDITIONS, conditionCureSeconds } from "./game/medicalBay";
import { groundOpsBayCare } from "./game/groundOps";
import { canBuyFieldKits, fieldKitBuyBlockText } from "./game/quartermaster";
import { itemCap } from "./game/tick";
import { itemTotal } from "./game/inventory";
import { memberPieceName } from "./awayGearDisplay";
import { BONE_CONDITION_ICON, ENEMY_RANK_ICON, FIELD_KIT_ICON } from "./ui/fieldKitIcons";
import type { IconName } from "./ui/icons";
import { spanText } from "./groundOpsTimelineDisplay";
import { runTeamName, taskName } from "./groundTaskQueueDisplay";

// ===== Words =====

// The stepper's ceiling per kit per member: the signed-off mockup's 9 (a UI bound only; the engine packs any count).
export const PACK_STEPPER_MAX = 9;

const KIT_PLURAL: Readonly<Record<FieldKitId, string>> = {
  firstAidKit: "First Aid Kits",
  antitoxin: "Antitoxins",
  combatStim: "Combat Stims",
  splint: "Splints",
  traumaKit: "Trauma Kits",
  injuryKit: "Injury Kits",
};

// "1 First Aid Kit", "3 First Aid Kits". Pure.
export function kitCountText(kit: FieldKitId, n: number): string {
  return `${n} ${n === 1 ? FIELD_KITS[kit].label : KIT_PLURAL[kit]}`;
}

// "3 First Aid Kits, 1 Antitoxin" in kit order (zero counts left out); "" for none. Pure.
export function kitListText(counts: KitCounts): string {
  return FIELD_KIT_IDS.filter((id) => (counts[id] ?? 0) > 0)
    .map((id) => kitCountText(id, counts[id] ?? 0))
    .join(", ");
}

function kitTotal(counts: KitCounts): number {
  return FIELD_KIT_IDS.reduce((n, id) => n + Math.max(0, counts[id] ?? 0), 0);
}

function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function whole(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// The Advanced Medical kits (Medical Training gates them, D20), in kit order.
export const MEDICAL_ONLY_KITS: readonly FieldKitId[] = FIELD_KIT_IDS.filter((id) => KIT_CATEGORY_RULES[FIELD_KITS[id].category].requiresMedicalTraining);

// The one dim line under a non-medic's kits: "Splint, Trauma Kit and Injury Kit need Medical Training, so they stay home."
export const NEEDS_MEDICAL_TRAINING_TEXT = `${andList(MEDICAL_ONLY_KITS.map((id) => FIELD_KITS[id].label))} need Medical Training, so they stay home.`;

// What one kit does, read from the catalog (fieldKits.ts) so the words follow the numbers. Pure.
export function kitEffectText(kit: FieldKitId): string {
  const def = FIELD_KITS[kit];
  const bone = CONDITION_LINES.bone.map((r) => r.label);
  const clears = andList(kitClears(kit).map((id) => GAMBIT_STATUSES[id]?.label ?? id));
  const needs = KIT_CATEGORY_RULES[def.category].requiresMedicalTraining ? " Needs Medical Training." : "";
  let what: string;
  switch (kit) {
    case "firstAidKit":
      what = `Clears ${clears}, and heals a little.`;
      break;
    case "antitoxin":
      what = `Clears ${clears}.`;
      break;
    case "combatStim":
      what = def.buff ? `${GAMBIT_STATUSES[def.buff.id].label} for ${def.buff.rounds} rounds.` : "A combat stimulant.";
      break;
    case "splint":
      what = `Heals a ${bone[0]} in ${SPLINT_HEAL_ROUNDS} rounds and turns a ${bone[1]} into a ${bone[0]}.`;
      break;
    case "traumaKit": {
      const upTo = def.lines?.bone?.upTo ?? 0;
      what = `Clears ${clears}, and a ${bone.slice(0, upTo).join(" or ")}.`;
      break;
    }
    case "injuryKit":
      what = `On a downed squadmate: their medical bay time is divided by ${1 + INJURY_KIT_TREATMENT_SHARE}.`;
      break;
  }
  return `${what}${needs}`;
}

// ===== Security specs: the role mark =====

const SPEC_GLYPH: Readonly<Record<string, IconName>> = { offense: "roleOffense", defense: "roleDefense", debuff: "roleDebuff" };
const SPEC_LABEL: Readonly<Record<string, string>> = { offense: "Offense", defense: "Defense", debuff: "Debuff" };

// A Security member's spec mark (the shield for anything else). Pure.
export function specGlyph(spec: string): IconName {
  return SPEC_GLYPH[spec] ?? "security";
}
export function specLabel(spec: string): string {
  return SPEC_LABEL[spec] ?? spec;
}

// ===== The program's grenade rules =====

// The program a member fights with on a Field Kits run: their own, else the Field Kits default (groundFight.ts swaps it
// in for a member on D19's default). Pure.
export function fieldKitsProgramOf(member: Pick<AwayMember, "gambit" | "teamType">): GambitProgram {
  return fieldKitsFightProgram(memberGambitProgram(member));
}

// What a program does with grenades, as a note: "program keeps 1 for an Elite or a Boss", "no rule throws it", or ""
// (it throws freely). A throw rule gated on "Elite or stronger" with no reserve of its own spends the kept charge on an
// Elite; one gated on "a Boss" keeps it for a Boss. Pure.
export function grenadeProgramNote(program: GambitProgram): string {
  if (!program.some((r) => r.action === "throwGrenade")) return "no rule in the program throws it";
  const keep = grenadeReserve(program);
  return keep ? `program keeps ${keep.count} for ${keep.forText}` : "";
}

// The charges a program's throw rules keep back ("keep N for a Boss"), and what spends them: an "Elite or stronger"
// throw rule with no reserve of its own spends them on an Elite too. Null when nothing is kept. Pure.
export function grenadeReserve(program: GambitProgram): { count: number; forText: string } | null {
  const throws = program.filter((r) => r.action === "throwGrenade");
  const count = throws.reduce((n, r) => Math.max(n, whole(r.params?.reserveForBoss)), 0);
  if (count === 0) return null;
  const elite = throws.some((r) => r.params?.minRank === "elite" && whole(r.params?.reserveForBoss) === 0);
  return { count, forText: elite ? "an Elite or a Boss" : "a Boss" };
}

// ===== Timed grenades (user 2026-10-21: "Impact Grenade is the default and explodes on contact; Stun and Toxin grenades
// detonate at the start of the thrower's next turn (enemies may move out of a cluster first)") =====

export const CONTACT_FUSE_TEXT = "Detonates on contact";
export const TIMED_FUSE_TEXT = "Timed fuse: detonates at the start of the thrower's next turn; foes may move clear first";

// How a grenade detonates on a run: timed only when it carries a fuse AND the run reads fuses (fieldKits.ts
// timedFusesLive: a catalog 1 run, in flight before the fuse, detonates every grenade on contact). Pure.
export function grenadeFuseText(grenade: Pick<GrenadeTraits, "fuse">, timedFuses: boolean): string {
  return timedFuses && grenade.fuse ? TIMED_FUSE_TEXT : CONTACT_FUSE_TEXT;
}

// The battle log's two fuse lines, or null for any other event: a timed throw ("Security primes a grenade at enemy
// Bruiser: it detonates at the start of their next turn") and its detonation ("Security's grenade detonates: 2 hit,
// 1 moved clear: -34 HP, affliction applied, 1 DOWNED"). `who` and `target` are the readout's names for the actor and
// the target. Pure.
export function fuseLogLine(ev: GambitLogEvent, who: string, target: string): string | null {
  if (ev.action === "throwGrenade" && ev.primed) {
    return `${who} primes a grenade${target ? ` at ${target}` : ""}: it detonates at the start of their next turn`;
  }
  if (ev.action !== "grenadeDetonates") return null;
  const b = ev.blast ?? { hit: 0, movedClear: 0, missed: 0, downed: 0, afflicted: 0 };
  const reach: string[] = [];
  if (b.hit > 0) reach.push(`${b.hit} hit`);
  if (b.movedClear > 0) reach.push(`${b.movedClear} moved clear`);
  if (b.missed > 0) reach.push(`${b.missed} missed`);
  const tail: string[] = [];
  if (ev.hpDelta && ev.hpDelta < 0) tail.push(`${ev.hpDelta} HP`);
  if (b.afflicted > 0) tail.push("affliction applied");
  if (b.downed > 0) tail.push(`${b.downed} DOWNED`);
  const head = `${who}'s grenade detonates${target ? ` on the ${target} group` : ""}`;
  if (reach.length === 0) return `${head}: nobody left in reach`;
  return tail.length > 0 ? `${head}: ${reach.join(", ")}: ${tail.join(", ")}` : `${head}: ${reach.join(", ")}`;
}

// ===== The free set =====

export interface FreeSetView {
  perMember: number; // First Aid Kits every Security member starts each objective with
  text: string; // "Free every objective: 3 First Aid Kits per Security member."
  detail: string;
  note: string; // where it comes from and where it grows next
}

// The free set a ship's Medical and Operations crew give (fieldKits.ts freeBasicFirstAid, the curve the dispatch
// freezes). Pure.
export function freeSetView(supportHeads: number): FreeSetView {
  const heads = Math.max(0, Math.floor(Number.isFinite(supportHeads) ? supportHeads : 0));
  const n = freeBasicFirstAid(heads);
  let next = heads + 1;
  while (freeBasicFirstAid(next) <= n && next < heads + 100_000) next += 1;
  const from = heads === 0 ? "No Medical or Operations crew aboard yet." : `From ${heads} Medical and Operations crew aboard.`;
  return {
    perMember: n,
    text: `Free every objective: ${kitCountText("firstAidKit", n)} per Security member.`,
    detail: "Included, never charged, refilled at every objective and every reload.",
    note: `${from} At ${next} crew the free set grows to ${n + 1}.`,
  };
}

// ===== Dispatch packing =====

export interface PackToolView {
  name: string; // "Impact Grenade", "Med Kit", "No tool installed"
  glyph: IconName;
  base: number; // the grenade's own charges per objective (0 for any other tool)
  carry: number; // charges its carry capacity lines add
  chargesText: string | null; // "5 charges (4 + 1 carry)"; null for a tool without charges
  note: string; // "1 throw per battle · program keeps 1 for an Elite or a Boss", "No charges: works every battle"
  fuseText: string | null; // a grenade's fuse on the run this dispatch makes (grenadeFuseText); null for any other tool
}

export interface PackKitRowView {
  kit: FieldKitId;
  label: string;
  glyph: IconName;
  want: number; // the stepper's value (the member's pack preference)
  fromStock: number;
  bought: number; // bought at launch by the team's top-up
  short: number; // still short after stock and the top-up
  note: string; // "From the Warehouse", "1 short, packs 1", "1 bought at launch", "Not packed"
  quiet: boolean; // the soft "short" note (top-up off)
  canLess: boolean;
  canMore: boolean;
}

export type PackSourceView =
  | { kind: "default"; text: string }
  | { kind: "loadout"; text: string }
  | { kind: "edited"; text: string; resetPack: KitCounts | null; resetLabel: string };

export interface PackMemberView {
  id: string;
  name: string;
  glyph: IconName;
  specText: string; // "Security · Offense"
  medic: boolean;
  source: PackSourceView;
  tool: PackToolView;
  free: number; // free First Aid Kits each objective
  kits: PackKitRowView[];
  noUseText: string | null; // the one dim "needs Medical Training" line (non-medics)
  pack: KitCounts; // the preference the steppers edit
}

export interface PackPreviewView {
  on: boolean;
  text: string;
  costText: string | null; // "1,320 credits of 12,480" / "1,320 credits"
}

export interface PackTeamView {
  index: number;
  name: string;
  kind: GroundTeamKind;
  kindText: string; // "Ground team · 3 Security, 2 Science"
  members: PackMemberView[];
  scienceNote: string | null; // the Science squad ghost line
  topUp: boolean;
  topUpNote: string; // "Buys only what Alpha's packs are short. Launch never waits on it."
  preview: PackPreviewView;
  summaryText: string; // "6 extras from stock, 2 short"
}

export interface PackStockRowView {
  kit: FieldKitId;
  label: string;
  glyph: IconName;
  text: string; // "3 of 5 left", "None in stock"
}

// A team that packs nothing, keyed by its ship team index (team names need not be unique: renameGroundTeam allows two
// "Alpha"s).
export interface PackGhostView {
  index: number;
  text: string;
}

export interface DispatchPackView {
  free: FreeSetView;
  teams: PackTeamView[];
  ghosts: PackGhostView[]; // teams that pack nothing, and why
  stock: PackStockRowView[];
  readyText: string; // "Packs ready" / "Packs ready · top-up buys 3 at launch"
  stockNote: string;
  summaryText: string; // the setup rail's one line: "8 extras packed"
}

export const STOCK_NOTE =
  "Extras leave the Warehouse at launch, lowest quality first (quality never changes what a kit does). Unused extras come home at claim.";

function wornTool(state: Pick<GameState, "equipment">, memberId: string): EquipmentInstance | undefined {
  return state.equipment.find((e) => e.fittedToMemberId === memberId && e.slotType === "memberTool");
}

// The installed tool line of one member. Pure.
export function packToolView(piece: EquipmentInstance | undefined, program: GambitProgram): PackToolView {
  if (!piece) return { name: "No tool installed", glyph: "tool", base: 0, carry: 0, chargesText: null, note: "Install a grenade in the Tool slot to throw one.", fuseText: null };
  const grenade = memberVariety(piece.slotType, piece.moduleVariant ?? "")?.member.grenade;
  const name = memberPieceName(piece);
  if (!grenade) return { name, glyph: "tool", base: 0, carry: 0, chargesText: null, note: "No charges: works every battle.", fuseText: null };
  const base = grenade.charges.perObjective;
  const carry = pieceCarryLines(piece) * GRENADE_CARRY_PER_LINE;
  const perBattle = grenade.charges.perBattle;
  const programNote = grenadeProgramNote(program);
  return {
    name,
    glyph: "grenade",
    base,
    carry,
    chargesText: `${base + carry} charges${carry > 0 ? ` (${base} + ${carry} carry)` : ""}`,
    note: `${perBattle} throw${perBattle === 1 ? "" : "s"} per battle${programNote ? ` · ${programNote}` : ""}`,
    // The dispatch makes a run on today's catalog (fieldKitsRun.ts fieldKitsStamp), so its fuse is the one it will use.
    fuseText: grenadeFuseText(grenade, timedFusesLive({ fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION } })),
  };
}

function sameCounts(a: KitCounts, b: KitCounts): boolean {
  return FIELD_KIT_IDS.every((id) => (a[id] ?? 0) === (b[id] ?? 0));
}

// A team copy with every team's top-up forced (`on` per index); the planner reads ShipGroundTeam.topUp.
function withTopUps(ship: ShipInstance, on: (index: number, current: boolean) => boolean): ShipInstance {
  return {
    ...ship,
    groundTeams: shipGroundTeams(ship).map((t, i) => {
      const next = { ...t };
      if (on(i, t.topUp === true)) next.topUp = true;
      else delete next.topUp;
      return next;
    }),
  };
}

function packOf(plan: DispatchPackPlan, team: number, memberId: string, kit: FieldKitId): number {
  return plan.packs[team]?.[memberId]?.[kit] ?? 0;
}

// The pack screen of `shipId`'s next dispatch, or null when kits are not live in runs (fieldKits.ts
// FIELD_KITS_RUNS_LIVE) or the ship is gone. `runsLive` overrides the switch for a test. Pure.
export function dispatchPackView(state: GameState, shipId: string, runsLive: boolean = FIELD_KITS_RUNS_LIVE): DispatchPackView | null {
  if (!runsLive) return null;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return null;
  const check = deployableGroundTeams(state, shipId);
  const shipTeams = shipGroundTeams(ship);
  const deploying = check.teams.filter((t) => t.deploys && t.security.length > 0);
  const packTeams: PackTeam[] = deploying.map((t) => ({ index: t.index, securityIds: t.security.map((m) => m.id) }));
  const snaps = snapshotMembers(state, deploying.flatMap((t) => t.security));
  const snapOf = (id: string): SnapshotMember | undefined => snaps.find((s) => s.memberId === id);
  const stockOnly = planDispatchPacks(state, withTopUps(ship, () => false), packTeams, snaps);
  const real = planDispatchPacks(state, ship, packTeams, snaps);
  const free = freeSetView(shipSupportHeads(state, ship));
  const credits = Math.max(0, state.credits.toNumber());
  const ghosts: PackGhostView[] = [];

  const teams: PackTeamView[] = deploying.map((t) => {
    const stored = shipTeams[t.index];
    const topUp = stored?.topUp === true;
    // "If on" for a team that is off: the same launch with only its toggle flipped (credits go to earlier teams first).
    const ifOn = topUp ? real : planDispatchPacks(state, withTopUps(ship, (i, cur) => (i === t.index ? true : cur)), packTeams, snaps);
    const worn = groundTeamWornLoadout(state, shipId, t.index);
    let fromStockTotal = 0;
    let shortTotal = 0;
    let boughtTotal = 0;
    const wouldBuy: KitCounts = {};
    const members: PackMemberView[] = t.security.map((m) => {
      const snap = snapOf(m.id);
      const medic = snap ? memberHasMedicalTraining(snap) : false;
      const pack = memberPackPreference(stored, m.id, medic);
      const kits: PackKitRowView[] = FIELD_KIT_IDS.filter((id) => canUseKit({ medic }, id)).map((kit) => {
        const want = pack[kit] ?? 0;
        const fromStock = packOf(stockOnly, t.index, m.id, kit);
        const bought = Math.max(0, packOf(real, t.index, m.id, kit) - fromStock);
        const short = Math.max(0, want - fromStock - bought);
        const could = Math.max(0, packOf(ifOn, t.index, m.id, kit) - fromStock);
        if (could > 0) wouldBuy[kit] = (wouldBuy[kit] ?? 0) + could;
        fromStockTotal += fromStock;
        shortTotal += short;
        boughtTotal += bought;
        let note = want === 0 ? "Not packed" : "From the Warehouse";
        if (bought > 0) note = short > 0 ? `${bought} bought at launch, ${short} short` : `${bought} bought at launch`;
        else if (short > 0) note = `${short} short, packs ${fromStock}`;
        return {
          kit,
          label: FIELD_KITS[kit].label,
          glyph: FIELD_KIT_ICON[kit],
          want,
          fromStock,
          bought,
          short,
          note,
          quiet: short > 0 && !topUp,
          canLess: want > 0,
          canMore: want < PACK_STEPPER_MAX,
        };
      });
      // Where the pack comes from: the worn loadout's kit for this slot, else the default (N16).
      const slot = stored ? stored.security.indexOf(m.id) : -1;
      const loadoutRaw = worn && slot >= 0 ? worn.security[slot]?.consumables : undefined;
      const loadoutPack = loadoutRaw ? memberPackPreference({ packs: { [m.id]: loadoutRaw } }, m.id, medic) : null;
      const sourcePack = loadoutPack ?? defaultMemberPack(medic);
      const source: PackSourceView = sameCounts(pack, sourcePack)
        ? loadoutPack
          ? { kind: "loadout", text: `Same as loadout: ${worn!.name}` }
          : { kind: "default", text: "Default: 1 of each kit they can use" }
        : { kind: "edited", text: "Edited", resetPack: loadoutPack ? { ...loadoutPack } : null, resetLabel: loadoutPack ? `Reset to ${worn!.name}` : "Reset to default" };
      return {
        id: m.id,
        name: m.name,
        glyph: specGlyph(m.spec),
        specText: `Security · ${specLabel(m.spec)}`,
        medic,
        source,
        tool: packToolView(wornTool(state, m.id), fieldKitsProgramOf(m)),
        free: free.perMember,
        kits,
        noUseText: medic ? null : NEEDS_MEDICAL_TRAINING_TEXT,
        pack,
      };
    });
    const wouldCost = FIELD_KIT_IDS.reduce((n, id) => n + (wouldBuy[id] ?? 0) * FIELD_KIT_PRICES[id], 0);
    const shortBefore: KitCounts = {};
    for (const mv of members) for (const r of mv.kits) if (r.want > r.fromStock) shortBefore[r.kit] = (shortBefore[r.kit] ?? 0) + (r.want - r.fromStock);
    let preview: PackPreviewView;
    if (kitTotal(shortBefore) === 0) {
      preview = { on: topUp, text: "Every pack is covered by the Warehouse. Nothing to buy.", costText: null };
    } else if (topUp) {
      const boughtList = kitListText(wouldBuy);
      preview = {
        on: true,
        text: boughtList
          ? `At launch: buys ${boughtList}.${shortTotal > 0 ? ` ${shortTotal} still short: not enough credits.` : ""}`
          : `Not enough credits to buy anything: ${kitTotal(shortBefore)} short.`,
        costText: boughtList ? `${formatInt(wouldCost)} credits of ${formatInt(credits)}` : null,
      };
    } else {
      const list = kitListText(wouldBuy);
      preview = {
        on: false,
        text: list ? `Off: ${t.name} packs what the Warehouse holds. If on, it would buy ${list}.` : `Off: ${t.name} packs what the Warehouse holds. Not enough credits to buy the rest.`,
        costText: list ? `${formatInt(wouldCost)} credits` : null,
      };
    }
    const scienceNames = t.science.map((m) => m.name);
    const parts = [`${fromStockTotal} extra${fromStockTotal === 1 ? "" : "s"} from stock`];
    if (boughtTotal > 0) parts.push(`${boughtTotal} bought`);
    if (shortTotal > 0) parts.push(`${shortTotal} short`);
    return {
      index: t.index,
      name: t.name,
      kind: t.kind,
      kindText: `${teamKindName(t.kind)} team · ${t.security.length} Security${t.science.length > 0 ? `, ${t.science.length} Science` : ""}`,
      members,
      scienceNote:
        scienceNames.length > 0 ? `Science squad (${scienceNames.join(", ")}): does the fieldwork and never fights, so it packs nothing.` : null,
      topUp,
      topUpNote: `Buys only what ${t.name}'s packs are short. Launch never waits on it.`,
      preview,
      summaryText: parts.join(", "),
    };
  });

  for (const t of check.teams) {
    if (deploying.includes(t)) continue;
    if (!t.staffed) continue;
    ghosts.push({ index: t.index, text: ghostText(t) });
  }

  const boughtAll = kitTotal(real.bought);
  const packedAll = kitTotal(real.fromStock) + boughtAll;
  const stock: PackStockRowView[] = FIELD_KIT_IDS.map((kit) => {
    const total = Math.max(0, Math.floor(itemTotal(state.inventory, kit).toNumber()));
    const left = total - (real.fromStock[kit] ?? 0);
    return { kit, label: FIELD_KITS[kit].label, glyph: FIELD_KIT_ICON[kit], text: total === 0 ? "None in stock" : `${left} of ${total} left` };
  });
  return {
    free,
    teams,
    ghosts,
    stock,
    readyText: boughtAll > 0 ? `Packs ready · top-up buys ${boughtAll} at launch` : "Packs ready",
    stockNote: STOCK_NOTE,
    summaryText: teams.length === 0 ? "No Security member deploys, so nobody packs." : `${packedAll} extra${packedAll === 1 ? "" : "s"} packed, plus the free set`,
  };
}

// Why a staffed team packs nothing this launch. Pure.
function ghostText(t: GroundTeamReadiness): string {
  if (t.security.length === 0) return `${t.name} · ${teamKindName(t.kind)} team: no Security members, nothing to pack.`;
  return `${t.name} is not deploying this launch, so it packs nothing.`;
}

// The pack after one stepper press: the member's preference with `kit` moved by `delta`, kept inside 0..PACK_STEPPER_MAX
// (setMemberPack keeps only counts of 1 or more). Pure.
export function steppedPack(pack: KitCounts, kit: FieldKitId, delta: number): KitCounts {
  const next = { ...pack };
  const n = Math.max(0, Math.min(PACK_STEPPER_MAX, (pack[kit] ?? 0) + Math.trunc(delta)));
  if (n > 0) next[kit] = n;
  else delete next[kit];
  return next;
}

// ===== In the run =====

export interface RankChipView {
  rank: EnemyRank;
  glyph: IconName;
  text: string; // "Final fight: Elite" / "Final fight: Elite Bruiser"
}

const ROLE_WORD: Readonly<Record<string, string>> = { bruiser: "Bruiser", striker: "Striker", healer: "Healer", caster: "Caster", swarm: "Swarm" };

// The role word of an enemy id ("enemy-bruiser-1" -> "Bruiser"); null when the id carries none. Pure.
export function enemyRoleWord(enemyId: string): string | null {
  const role = /^enemy-([a-z]+)-/.exec(enemyId)?.[1];
  return role ? ROLE_WORD[role] ?? null : null;
}

function taskOf(exp: Pick<Expedition, "bodies">, taskId: string | undefined): ExpeditionActivity | null {
  if (!taskId) return null;
  for (const body of exp.bodies) for (const a of body.activities) if (a.id === taskId) return a;
  return null;
}

// The objective's final fight rank chip on a ranked run (enemyRanks.ts fightLeadRank on its last fight point): null for
// a Normal lead, a training run, an unranked run or an objective with no fight point. Once the team's pending fight IS
// that fight, the chip names the lead's role ("Elite Bruiser"). Pure.
export function finalFightChip(
  exp: Pick<Expedition, "enemyRanks" | "difficulty">,
  task: Pick<ExpeditionActivity, "difficulty" | "fightPoints"> | null,
  team?: Pick<GroundTeamRun, "pendingFight">,
): RankChipView | null {
  if (!task || !ranksLive(exp)) return null;
  const points = task.fightPoints?.length ?? 0;
  if (points === 0) return null;
  const rank = fightLeadRank({ grade: task.difficulty, pointIndex: points - 1, fightPointCount: points, kind: "point", trainingRun: isTrainingRun(exp) });
  if (rank === "normal") return null;
  const fight = team?.pendingFight;
  let role: string | null = null;
  if (fight && fight.pointIndex === points - 1 && !fight.surprise && !fight.reinforcement) {
    const lead = Object.entries(fight.ranks ?? {}).find(([, r]) => r === rank);
    role = lead ? enemyRoleWord(lead[0]) : null;
  }
  const label = ENEMY_RANKS[rank].label;
  return { rank, glyph: ENEMY_RANK_ICON[rank], text: `Final fight: ${role ? `${label} ${role}` : label}` };
}

export interface RunExtraView {
  kit: FieldKitId;
  glyph: IconName;
  label: string;
  left: number;
  packed: number;
}

export interface RunConditionView {
  key: string;
  glyph: IconName | null;
  text: string; // "Fracture, splinted", "Broken Bone"
  bayText: string | null; // "no bay time", "bay 1h after this objective"
}

export interface RunSupplyRowView {
  id: string;
  name: string;
  glyph: IconName;
  medic: boolean;
  freeLeft: number;
  freeTotal: number;
  extras: RunExtraView[];
  charges: { left: number; total: number } | null;
  fuseNote: string | null; // a grenade's fuse on THIS run (grenadeFuseText: a catalog 1 run reads "on contact"); null otherwise
  toolNote: string | null; // "Med Kit: no charges"
  conditions: RunConditionView[];
  healthText: string; // "Healthy", "72 of 90 HP", "Downed"
}

export interface RunSuppliesTeamView {
  index: number;
  name: string;
  title: string; // "Alpha · supplies"
  objectiveText: string;
  chip: RankChipView | null;
  rows: RunSupplyRowView[];
  refreshText: string;
}

type MemberNames = readonly Pick<AwayMember, "id" | "name">[];

function boneGlyph(id: string): IconName | null {
  return (BONE_CONDITION_ICON as Readonly<Record<string, IconName>>)[id] ?? null;
}

// The conditions one member carries right now (the in-objective carry's persisting statuses, the trip's bay
// conditions, downed), each with its bay time on the run's frozen care. Pure.
function memberConditions(exp: Expedition, team: GroundTeamRun, memberId: string): RunConditionView[] {
  const ops = exp.groundOps;
  if (!ops) return [];
  const care = groundOpsBayCare(ops.factors);
  const perks = [...(exp.roster?.security ?? []), ...(exp.roster?.science ?? [])].find((m) => m.memberId === memberId)?.perks ?? [];
  const share = team.treatment?.[memberId];
  const treated = typeof share === "number" && Number.isFinite(share) && share > 0 ? share : 0;
  const carried = team.carry?.[memberId]?.statuses ?? [];
  const bay = (team.conditions[memberId] ?? []).filter((id) => id !== "health" && id !== "downed");
  const ids: string[] = [];
  for (const s of carried) if (GAMBIT_STATUSES[s.id]?.kind === "debuff" && !ids.includes(s.id)) ids.push(s.id);
  for (const id of bay) if (!ids.includes(id)) ids.push(id);
  const out: RunConditionView[] = [];
  for (const id of ids) {
    const label = GAMBIT_STATUSES[id as keyof typeof GAMBIT_STATUSES]?.label ?? GROUND_CONDITIONS[id]?.label ?? id;
    const held = carried.find((s) => s.id === id);
    const splinted = id === "fracture" && held !== undefined && held.remaining <= SPLINT_HEAL_ROUNDS && !bay.includes(id);
    const def = Object.prototype.hasOwnProperty.call(GROUND_CONDITIONS, id) ? GROUND_CONDITIONS[id] : undefined;
    out.push({
      key: id,
      glyph: boneGlyph(id),
      text: splinted ? `${label}, splinted` : label,
      bayText: splinted ? "no bay time" : def ? `bay ${spanText(conditionCureSeconds(def, perks, care, treated))} after this objective` : null,
    });
  }
  return out;
}

// One deployed team's supplies readout (the detail view's table). Pure.
function runTeamView(exp: Expedition, ship: ShipInstance | null | undefined, team: GroundTeamRun, names: MemberNames): RunSuppliesTeamView {
  const name = runTeamName(ship, team.index);
  const free = freeBasicsOf(exp).firstAidKit ?? 0;
  const security = exp.roster?.security ?? [];
  const task = taskOf(exp, team.taskId);
  const reserveNotes: string[] = [];
  const rows: RunSupplyRowView[] = team.securityIds.map((id) => {
    const snap = security.find((m) => m.memberId === id);
    const memberName = names.find((m) => m.id === id)?.name ?? id;
    const packed = team.packed?.[id] ?? {};
    const left = team.kits?.[id] ?? {};
    const extras: RunExtraView[] = FIELD_KIT_IDS.filter((k) => whole(packed[k]) > 0 || whole(left[k]) > 0).map((k) => ({
      kit: k,
      glyph: FIELD_KIT_ICON[k],
      label: FIELD_KITS[k].label,
      left: whole(left[k]),
      packed: Math.max(whole(packed[k]), whole(left[k])),
    }));
    const total = snap ? toolCharges(snap) : 0;
    const toolPiece = snap?.gear.find((g) => g.slotType === "memberTool");
    const toolLabel = toolPiece ? memberVariety(toolPiece.slotType, toolPiece.varietyKey)?.label ?? null : null;
    const worn = toolPiece ? memberVariety(toolPiece.slotType, toolPiece.varietyKey)?.member.grenade : undefined;
    if (total > 0 && snap) {
      const keep = grenadeReserve(runProgramOf(snap.gambit));
      if (keep) reserveNotes.push(`${memberName}'s program keeps ${keep.count} grenade charge${keep.count === 1 ? "" : "s"} for ${keep.forText}`);
    }
    const downed = team.downedThisTask.includes(id);
    const carry = team.carry?.[id];
    const healthText = downed ? "Downed" : carry && carry.hp < carry.hpMax ? `${Math.max(0, Math.round(carry.hp))} of ${Math.round(carry.hpMax)} HP` : "Healthy";
    return {
      id,
      name: memberName,
      glyph: specGlyph(snap?.spec ?? ""),
      medic: snap ? memberHasMedicalTraining(snap) : false,
      freeLeft: team.basics ? whole(team.basics[id]?.firstAidKit) : free,
      freeTotal: free,
      extras,
      charges: total > 0 && snap ? { left: chargesLeftFor(snap, team.charges), total } : null,
      fuseNote: total > 0 && worn ? grenadeFuseText(worn, timedFusesLive(exp)) : null,
      toolNote: total === 0 && toolLabel ? `${toolLabel}: no charges` : null,
      conditions: memberConditions(exp, team, id),
      healthText,
    };
  });
  const objectiveText = objectiveLine(exp, team, task);
  const refresh = `At the next objective the free set refills to ${free} each and every grenade resets to full. Extras carry on until used.`;
  return {
    index: team.index,
    name,
    title: `${name} · supplies`,
    objectiveText,
    chip: finalFightChip(exp, task, team),
    rows,
    refreshText: reserveNotes.length > 0 ? `${refresh} ${reserveNotes.map((n) => `${n}.`).join(" ")}` : refresh,
  };
}

// The program a snapshotted member fights with on a Field Kits run: a snapshot on D19's default is swapped for the Field
// Kits default (groundFight.ts, fieldKitsBattle.ts withFieldKitsDefaultProgram). Pure.
export function runProgramOf(program: GambitProgram): GambitProgram {
  return fieldKitsFightProgram(program);
}

// The detail header's objective line (the mockup's "Objective 2 of 4: Collapsed Relay"): the team's own objectives
// (its queue, skipped ones left out), the one it is on counted after the ones it finished. A borrowed objective (a
// helper on another team's) reads "Helping on"; between objectives, how many of its own are done. Pure.
export function objectiveLine(
  exp: Pick<Expedition, "bodies">,
  team: Pick<GroundTeamRun, "queue" | "taskId" | "borrowed">,
  task: Pick<ExpeditionActivity, "poiId"> | null,
): string {
  const own = team.queue.map((id) => taskOf(exp, id)).filter((t): t is ExpeditionActivity => t !== null && t.status !== "skipped");
  const done = own.filter((t) => t.status === "done").length;
  if (task && team.taskId && !team.borrowed && own.some((t) => t.id === team.taskId)) {
    return `Objective ${Math.min(own.length, done + 1)} of ${own.length}: ${taskName(task)}`;
  }
  if (task) return `Helping on ${taskName(task)}`;
  return own.length > 0 ? `Between objectives · ${done} of ${own.length} done` : "Between objectives";
}

// Every deployed team's supplies readout on a Field Kits run, ascending team index; [] on any other run. Pure.
export function runSuppliesView(exp: Expedition, ship: ShipInstance | null | undefined, names: MemberNames): RunSuppliesTeamView[] {
  if (!fieldKitsLive(exp) || !exp.groundOps) return [];
  return exp.groundOps.teams.filter((t) => t.securityIds.length > 0).map((t) => runTeamView(exp, ship, t, names));
}

export interface RunCardLineView {
  teams: { index: number; text: string; charges: number }[]; // "Alpha kits 6 left", the charges left
  chip: RankChipView | null;
}

// The expedition card's one-line summary on a Field Kits run: per team, the kits left (free set and extras) and the
// grenade charges left; the hardest final fight among the teams' current objectives. Null on any other run. Pure.
export function runCardLine(exp: Expedition, ship: ShipInstance | null | undefined): RunCardLineView | null {
  if (!fieldKitsLive(exp) || !exp.groundOps) return null;
  const free = freeBasicsOf(exp).firstAidKit ?? 0;
  const security = exp.roster?.security ?? [];
  let chip: RankChipView | null = null;
  const teams = exp.groundOps.teams
    .filter((t) => t.securityIds.length > 0)
    .map((t) => {
      let kits = 0;
      let charges = 0;
      for (const id of t.securityIds) {
        kits += t.basics ? whole(t.basics[id]?.firstAidKit) : free;
        kits += kitTotal(t.kits?.[id] ?? {});
        const snap = security.find((m) => m.memberId === id);
        if (snap && toolCharges(snap) > 0) charges += chargesLeftFor(snap, t.charges);
      }
      const c = finalFightChip(exp, taskOf(exp, t.taskId), t);
      if (c && (!chip || ENEMY_RANKS[c.rank].order > ENEMY_RANKS[chip.rank].order)) chip = c;
      return { index: t.index, text: `${runTeamName(ship, t.index)} kits ${kits} left`, charges };
    });
  return { teams, chip };
}

export interface ClaimKitsView {
  homeText: string; // "Kits home: 3 First Aid Kits, 1 Antitoxin"
  subText: string;
}

export const CLAIM_KITS_NOTE = "Free kits are never carried home; they refill every objective. Returning kits may sit above the Warehouse cap.";

// The claim's kit line: what comes home and what the run used. Null on a run that packed nothing (and any run without
// Field Kits). Pure.
export function claimKitsView(exp: Expedition): ClaimKitsView | null {
  if (!fieldKitsLive(exp)) return null;
  const home = carriedExtras(exp);
  const used = usedExtras(exp);
  if (kitTotal(home) === 0 && kitTotal(used) === 0) return null;
  const homeList = kitListText(home);
  const usedList = kitListText(used);
  return {
    homeText: homeList ? `Kits home: ${homeList}` : "Kits home: none",
    subText: `${homeList ? "Back in the Warehouse at claim. " : ""}${usedList ? `Used on the run: ${usedList}. ` : ""}${CLAIM_KITS_NOTE}`,
  };
}

// ===== Logistics and the Quartermaster =====

export interface KitStockRow {
  kit: FieldKitId;
  label: string;
  glyph: IconName;
  owned: number;
  cap: number;
  text: string; // "5 of 200"
  effect: string;
  medical: boolean; // needs Medical Training
}

// The Field Kits stock (Logistics, the reserved Consumables spot, call 14): every kit with its count and the
// warehouse cap. Pure.
export function fieldKitStockRows(state: GameState): KitStockRow[] {
  return FIELD_KIT_IDS.map((kit) => {
    const owned = Math.max(0, Math.floor(itemTotal(state.inventory, kit).toNumber()));
    const cap = Math.max(0, Math.floor(itemCap(state, kit).toNumber()));
    return {
      kit,
      label: FIELD_KITS[kit].label,
      glyph: FIELD_KIT_ICON[kit],
      owned,
      cap,
      text: `${formatInt(owned)} of ${formatInt(cap)}`,
      effect: kitEffectText(kit),
      medical: KIT_CATEGORY_RULES[FIELD_KITS[kit].category].requiresMedicalTraining,
    };
  });
}

export interface KitShopRow extends KitStockRow {
  price: number;
  priceText: string; // "60 CR each"
  qty: number;
  totalText: string; // "Total: 120 CR"
  canBuy: boolean;
  blockText: string | null; // the engine's refusal, in words
}

// The Quartermaster's kit sale rows: each kit at its price, the quantity the row would buy (`qtyOf`, at least 1) and
// the engine's own gate (quartermaster.ts canBuyFieldKits), so the button and the refusal never diverge. Pure.
export function fieldKitShopRows(state: GameState, qtyOf: (kit: FieldKitId) => number): KitShopRow[] {
  return fieldKitStockRows(state).map((row) => {
    const qty = Math.max(1, Math.floor(qtyOf(row.kit) || 1));
    const price = FIELD_KIT_PRICES[row.kit];
    const gate = canBuyFieldKits(state, row.kit, qty);
    return {
      ...row,
      price,
      priceText: `${formatInt(price)} CR each`,
      qty,
      totalText: `Total: ${formatInt(price * qty)} CR`,
      canBuy: gate.ok,
      blockText: gate.ok ? null : fieldKitBuyBlockText(gate.reason),
    };
  });
}

// The shop quantity a row may step to: 1 up to what the warehouse has room for (at least 1). Pure.
export function shopQtyMax(row: Pick<KitStockRow, "owned" | "cap">): number {
  return Math.max(1, row.cap - row.owned);
}

// The ship-side name of a team index, for the do* handlers' log lines. Pure.
export function packTeamName(ship: ShipInstance, index: number): string {
  return groundTeamName(ship, index);
}
