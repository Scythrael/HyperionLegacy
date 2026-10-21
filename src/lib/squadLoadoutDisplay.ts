// squadLoadoutDisplay.ts: the display decisions behind the Armory's Squad Loadouts tab (0.14.0, Ground
// Operations GO-17 UI half; the approved squad loadouts mockup, user S14 "All as proposed").
//
// WHY a .ts beside SquadLoadoutsPanel.svelte: this repo has no Svelte component test harness, so every
// decision worth gating (the card status and kit summary, which teams can take a loadout and why not, the
// save preview, the install report) lives here as pure functions over the tested engine (armory.ts). No game
// rule lives here: every gate is read from the engine, usually by calling the engine action itself on the
// current state and reading its refusal, so a control is enabled exactly when the engine would accept it.

import type { GameState, GroundTeamKind, GroundTeamLoadout, ShipInstance, SquadLoadoutKit } from "./game/model";
import { shipDisplayLabels } from "./game/model";
import {
  applyGroundTeamLoadout,
  checkInGroundTeamLoadout,
  createGroundTeamLoadout,
  groundLoadoutBlockText,
  groundLoadoutSkipText,
  groundTeamWornLoadout,
  loadoutCap,
  loadoutsUsed,
  type GroundLoadoutBlockReason,
  type GroundLoadoutSkip,
} from "./game/armory";
import { GROUND_SQUAD_TYPES, cleanShipGroundTeams, shipGroundTeams, type GroundSquadType } from "./game/groundTeamSlots";
import { groundTeamName } from "./game/groundTeams";
import { DEFAULT_GROUND_TEAM_KIND, teamKindName } from "./game/groundComposition";
import { crewLockText, crewLockTextAmong } from "./game/crewLock";
import { memberWornIndex } from "./game/memberEquipment";
import { memberPieceName } from "./awayGearDisplay";
import { SQUAD_TYPE_NAME } from "./groundTeamDisplay";
import { FIELD_KITS_RUNS_LIVE } from "./game/fieldKits";
import { kitListText } from "./fieldKitsDisplay";

// --- The tab header ------------------------------------------------------------------------------------

// The shared Armory count (ship + squad loadouts draw from ONE cap, design 5.7): "7 of 25 loadouts (ship +
// squad)". Reads loadoutsUsed, the engine's one count. Pure.
export function armoryCountText(state: GameState): string {
  return `${loadoutsUsed(state)} of ${loadoutCap(state)} loadouts (ship + squad)`;
}

// The short form for a phone header and the Facilities pane: "7 / 25 loadouts". Pure.
export function armoryCountShort(state: GameState): string {
  return `${loadoutsUsed(state)} / ${loadoutCap(state)} loadouts`;
}

export type SquadKindFilter = "all" | GroundTeamKind;

// The filter chips, in the mockup's order.
export const SQUAD_KIND_FILTERS: readonly { key: SquadKindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "strike", label: "Strike" },
  { key: "survey", label: "Survey" },
  { key: "ground", label: "Ground" },
];

// A loadout's team kind (an absent stored kind reads as Ground, the engine's rule). Pure.
export function loadoutKind(loadout: Pick<GroundTeamLoadout, "kind">): GroundTeamKind {
  return loadout.kind ?? DEFAULT_GROUND_TEAM_KIND;
}

// "Security 1": a kit slot's label by squad type and its 1-based index in the team's flat list. Pure.
export function kitSlotLabel(teamType: GroundSquadType, slotIndex: number): string {
  return `${SQUAD_TYPE_NAME[teamType]} ${slotIndex + 1}`;
}

// A kit's piece ids in kit order (armor, weapon, tool, then implants). Pure.
export function kitPieceIds(kit: SquadLoadoutKit): string[] {
  return [kit.armor, kit.weapon, kit.tool, ...kit.implants].filter((id): id is string => id !== null);
}

// Every piece id a loadout holds, Security kits then Science. Pure.
export function loadoutPieceIds(loadout: GroundTeamLoadout): string[] {
  return GROUND_SQUAD_TYPES.flatMap((t) => loadout[t].flatMap(kitPieceIds));
}

// A piece's display name by id, "Missing piece" when the pool no longer has it. Pure.
export function pieceNameById(state: GameState, pieceId: string): string {
  const piece = state.equipment.find((e) => e.id === pieceId);
  return piece ? memberPieceName(piece) : "Missing piece";
}

// A ship's numbered fleet label ("Kestrel", or "General Freighter #2" when two share a name). Pure.
function shipLabelOf(state: GameState, shipId: string): string | null {
  return state.ships.some((s) => s.id === shipId) ? shipDisplayLabels(state.ships).get(shipId) ?? shipId : null;
}

// "Kestrel · Alpha", the place a loadout is worn or put. Pure.
export function teamPlaceLabel(state: GameState, shipId: string, teamIndex: number): string {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return "a ship no longer in the fleet";
  return `${shipLabelOf(state, shipId)} · ${groundTeamName(ship, teamIndex)}`;
}

// --- The loadout cards ---------------------------------------------------------------------------------

export interface KitSlotView {
  teamType: GroundSquadType;
  slotIndex: number;
  label: string; // "Security 1"
  gear: string; // "Ballistic Weave, Pulse Rifle, Stun Grenade", or "Empty kit"
  extra: string | null; // "+1 implant" / "+2 implants", null when none
  empty: boolean; // the kit holds nothing
  // Field Kits FKR-10 (user S14 "the kit slot holds per-member kits once Field Kits ships"): a Security kit's pack, "Pack:
  // 2 First Aid Kits, 1 Antitoxin" / "Pack: default kits" / "Pack: no extra kits"; null for Science or while kits are off.
  pack: string | null;
}

// The pack line of a Security kit (or a team member's stored preference): its kits, the default when there is none
// (N16 "1 of each usable kit", the loadout then leaves the member's preference as it is), nothing for an empty record.
// Null while kits are not live in runs. Pure.
export function packLineText(consumables: Readonly<Record<string, number>> | undefined, kitsLive: boolean = FIELD_KITS_RUNS_LIVE): string | null {
  if (!kitsLive) return null;
  if (consumables === undefined) return "Pack: default kits";
  const list = kitListText(consumables);
  return `Pack: ${list || "no extra kits"}`;
}

// One kit's summary line. An empty kit reads "Empty kit" (user S14: empty slots save empty kits). Pure.
export function kitSlotView(state: GameState, teamType: GroundSquadType, slotIndex: number, kit: SquadLoadoutKit): KitSlotView {
  const names = [kit.armor, kit.weapon, kit.tool].filter((id): id is string => id !== null).map((id) => pieceNameById(state, id));
  const implants = kit.implants.length;
  const empty = names.length === 0 && implants === 0;
  return {
    teamType,
    slotIndex,
    label: kitSlotLabel(teamType, slotIndex),
    gear: empty ? "Empty kit" : names.length === 0 ? "No armor, weapon or tool" : names.join(", "),
    extra: implants === 0 ? null : `+${implants} implant${implants === 1 ? "" : "s"}`,
    empty,
    pack: teamType === "security" ? packLineText(kit.consumables) : null,
  };
}

// A visible gate: ok, or the reason the control is off (shown as text, never color alone).
export type GateView = { ok: true } | { ok: false; reason: string };

export interface LoadoutCardView {
  id: string;
  name: string;
  kind: GroundTeamKind;
  kindName: string; // "Strike"
  worn: boolean;
  status: string; // "Worn by Kestrel · Alpha" / "In the locker · 8 pieces"
  stale: string | null; // a worn loadout whose team no longer matches it: what happened + "check it in"
  pieces: number; // pieces the loadout holds
  slots: KitSlotView[];
  checkIn: GateView | null; // worn only
}

// The words for a refusal, with the accurate crew lock (mission vs expedition) for onMission. Pure.
export function blockReasonText(state: GameState, reason: GroundLoadoutBlockReason, shipIds: readonly string[]): string {
  if (reason === "onMission") return crewLockTextAmong(state, shipIds) ?? groundLoadoutBlockText(reason);
  return groundLoadoutBlockText(reason);
}

// Can this worn loadout be checked in right now? The engine's own answer (checkInGroundTeamLoadout), with the
// lock naming the real cause. Pure.
export function checkInGate(state: GameState, loadout: GroundTeamLoadout): GateView {
  const r = checkInGroundTeamLoadout(state, loadout.id);
  if (r.ok) return { ok: true };
  const wearers = state.equipment
    .filter((e) => e.committedToLoadoutId === loadout.id && !!e.fittedToMemberId)
    .map((e) => state.awayMembers.find((m) => m.id === e.fittedToMemberId)?.assignedShipId ?? null)
    .filter((id): id is string => id !== null);
  return { ok: false, reason: blockReasonText(state, r.reason, [loadout.checkedOutTo?.shipId ?? "", ...wearers]) };
}

// Why a worn loadout's team no longer matches it (carry note: checkedOutTo can go stale; check-in always works
// and is the way back), or null when it is current. Pure.
export function staleWornText(state: GameState, loadout: GroundTeamLoadout): string | null {
  const to = loadout.checkedOutTo;
  if (to === null) return null;
  const ship = state.ships.find((s) => s.id === to.shipId);
  if (!ship) return "That ship is no longer in the fleet. Check it in to return its pieces to the locker.";
  const team = shipGroundTeams(ship)[to.teamIndex];
  if (!team) return "That team no longer exists. Check it in to return its pieces to the locker.";
  if (team.kind !== loadoutKind(loadout)) {
    return `That team is now a ${teamKindName(team.kind)} team. Check it in to use this loadout again.`;
  }
  return null;
}

// One card per loadout, in Armory order, narrowed by the kind filter. Pure.
export function squadLoadoutCards(state: GameState, filter: SquadKindFilter = "all"): LoadoutCardView[] {
  return (state.squadLoadouts ?? [])
    .filter((l) => filter === "all" || loadoutKind(l) === filter)
    .map((l) => {
      const kind = loadoutKind(l);
      const pieces = loadoutPieceIds(l).length;
      const worn = l.checkedOutTo !== null;
      return {
        id: l.id,
        name: l.name,
        kind,
        kindName: teamKindName(kind),
        worn,
        status:
          l.checkedOutTo !== null
            ? `Worn by ${teamPlaceLabel(state, l.checkedOutTo.shipId, l.checkedOutTo.teamIndex)}`
            : `In the locker · ${pieces} piece${pieces === 1 ? "" : "s"}`,
        stale: staleWornText(state, l),
        pieces,
        slots: GROUND_SQUAD_TYPES.flatMap((t) => l[t].map((kit, i) => kitSlotView(state, t, i, kit))),
        checkIn: worn ? checkInGate(state, l) : null,
      };
    });
}

// The empty-list line, by filter. Pure.
export function emptyListText(state: GameState, filter: SquadKindFilter): string {
  if ((state.squadLoadouts ?? []).length === 0) {
    return "No squad loadouts yet. Save a team's gear to make one.";
  }
  const kind = SQUAD_KIND_FILTERS.find((f) => f.key === filter)?.label ?? "";
  return `No ${kind} squad loadouts.`;
}

// --- Save a team's gear --------------------------------------------------------------------------------

export interface SaveTeamOption {
  teamIndex: number;
  name: string; // "Alpha"
  kind: GroundTeamKind;
  summary: string; // "Strike · 4 Security" / "Ground · 2 Security + 2 Science"
}

export interface SaveShipOption {
  shipId: string;
  label: string;
  teams: SaveTeamOption[];
}

// "Strike · 4 Security", "Ground · 3 Security + 3 Science": the team's kind and its slots. Pure.
export function teamSlotSummary(team: { kind: GroundTeamKind; security: unknown[]; science: unknown[] }): string {
  const parts: string[] = [];
  if (team.security.length > 0) parts.push(`${team.security.length} Security`);
  if (team.science.length > 0) parts.push(`${team.science.length} Science`);
  return `${teamKindName(team.kind)} · ${parts.join(" + ") || "no slots"}`;
}

// Every ship that fields at least one ground team, with its teams, in fleet order. Pure.
export function saveShipOptions(state: GameState): SaveShipOption[] {
  const labels = shipDisplayLabels(state.ships);
  return state.ships
    .map((ship: ShipInstance) => ({
      shipId: ship.id,
      label: labels.get(ship.id) ?? ship.id,
      teams: shipGroundTeams(ship).map((t, teamIndex) => ({
        teamIndex,
        name: groundTeamName(ship, teamIndex),
        kind: t.kind,
        summary: teamSlotSummary(t),
      })),
    }))
    .filter((o) => o.teams.length > 0);
}

// The default name for a new loadout (mockup: "Bravo Ground set": team name + type). Pure.
export function defaultSquadLoadoutName(state: GameState, shipId: string, teamIndex: number): string {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return "New Loadout";
  const team = shipGroundTeams(ship)[teamIndex];
  return team ? `${groundTeamName(ship, teamIndex)} ${teamKindName(team.kind)} set` : "New Loadout";
}

export interface SavePreviewRow {
  teamType: GroundSquadType;
  slotIndex: number;
  label: string; // "Security 1"
  member: string | null; // the slotted member's name, null = an empty slot
  armor: string | null;
  weapon: string | null;
  tool: string | null;
  implants: number;
  pack: string | null; // Field Kits FKR-10: the Security member's pack the save keeps (packLineText); null otherwise
}

export interface SavePreviewSkip {
  label: string; // "Security 1"
  piece: string;
  reason: string; // groundLoadoutSkipText + what happens to it
}

export type SaveGateView =
  | { ok: true }
  | { ok: false; reason: string; wornLoadoutId: string | null; wornLoadoutName: string | null };

export interface SavePreviewView {
  rows: SavePreviewRow[];
  pieces: number; // pieces the save commits
  skipped: SavePreviewSkip[]; // worn pieces left out (locked, or already in another loadout)
  gate: SaveGateView;
  saveLabel: string; // "Save loadout (8 of 25)"
}

// What saving (shipId, teamIndex) would capture, row per slot in kit order, and whether the engine would accept
// it now. The rows mirror createGroundTeamLoadout's snapshot (a locked piece or one already committed elsewhere
// is left on the member and listed as skipped); the gate is the engine's own refusal, so a team that still
// wears a loadout (even a stale one) names it, and the panel offers its Check in right there. Null when the
// ship or team is gone. Pure.
export function savePreview(state: GameState, shipId: string, teamIndex: number): SavePreviewView | null {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return null;
  const team = cleanShipGroundTeams(ship, state.awayMembers)[teamIndex];
  if (!team) return null;
  const worn = memberWornIndex(state);
  const teamWears = groundTeamWornLoadout(state, shipId, teamIndex);
  const rows: SavePreviewRow[] = [];
  const skipped: SavePreviewSkip[] = [];
  let pieces = 0;
  for (const teamType of GROUND_SQUAD_TYPES) {
    team[teamType].forEach((memberId, slotIndex) => {
      const label = kitSlotLabel(teamType, slotIndex);
      const member = memberId === null ? undefined : state.awayMembers.find((m) => m.id === memberId);
      const stored = member && teamType === "security" ? shipGroundTeams(ship)[teamIndex]?.packs?.[member.id] : undefined;
      const pack = member && teamType === "security" ? packLineText(stored as Record<string, number> | undefined) : null;
      const row: SavePreviewRow = { teamType, slotIndex, label, member: member?.name ?? null, armor: null, weapon: null, tool: null, implants: 0, pack };
      for (const p of member ? worn.get(member.id) ?? [] : []) {
        if (p.committedToLoadoutId !== undefined || p.locked === true) {
          const why = p.committedToLoadoutId !== undefined ? "committedElsewhere" : "locked";
          const reason =
            teamWears !== null && p.committedToLoadoutId === teamWears.id
              ? `Part of "${teamWears.name}", which this team wears.`
              : `${groundLoadoutSkipText(why)}. It stays on the member, not saved.`;
          skipped.push({ label, piece: memberPieceName(p), reason });
          continue;
        }
        pieces += 1;
        if (p.slotType === "memberArmor") row.armor = memberPieceName(p);
        else if (p.slotType === "memberWeapon") row.weapon = memberPieceName(p);
        else if (p.slotType === "memberTool") row.tool = memberPieceName(p);
        else if (p.slotType === "implant") row.implants += 1;
      }
      rows.push(row);
    });
  }
  const trial = createGroundTeamLoadout(state, shipId, teamIndex, "preview");
  let gate: SaveGateView = { ok: true };
  if (!trial.ok) {
    const wornLoadout = trial.reason === "teamHasLoadout" ? groundTeamWornLoadout(state, shipId, teamIndex) : null;
    gate = {
      ok: false,
      reason: wornLoadout
        ? `This team already wears "${wornLoadout.name}" (check it in first)`
        : blockReasonText(state, trial.reason, [shipId]),
      wornLoadoutId: wornLoadout?.id ?? null,
      wornLoadoutName: wornLoadout?.name ?? null,
    };
  }
  return { rows, pieces, skipped, gate, saveLabel: `Save loadout (${loadoutsUsed(state) + 1} of ${loadoutCap(state)})` };
}

// --- Put it on a team ----------------------------------------------------------------------------------

export interface ApplyTargetView {
  key: string; // "ship-1:0"
  shipId: string;
  teamIndex: number;
  kind: GroundTeamKind;
  title: string; // "Harrow · Alpha"
  sub: string; // "Survey · docked", or the reason it is off
  disabled: boolean;
  reason: string | null; // the visible reason when disabled (also in `sub`)
}

// Every team in the fleet as a target for `loadoutId`, enabled exactly when applyGroundTeamLoadout would accept
// it (the engine is called on the current state and its refusal read). Only a team of the loadout's own type
// can take it; the others show why not. Pure.
export function applyTargets(state: GameState, loadoutId: string): ApplyTargetView[] {
  const loadout = (state.squadLoadouts ?? []).find((l) => l.id === loadoutId);
  if (!loadout) return [];
  const want = loadoutKind(loadout);
  const labels = shipDisplayLabels(state.ships);
  const out: ApplyTargetView[] = [];
  for (const ship of state.ships) {
    shipGroundTeams(ship).forEach((team, teamIndex) => {
      const title = `${labels.get(ship.id) ?? ship.id} · ${groundTeamName(ship, teamIndex)}`;
      const trial = applyGroundTeamLoadout(state, loadoutId, ship.id, teamIndex);
      let reason: string | null = null;
      if (!trial.ok) {
        // A team of another type can never take it, so that reason wins over a passing one (a worn loadout, a
        // lock) even where the engine checks those first.
        if (trial.reason === "wrongKind" || team.kind !== want) reason = `${teamKindName(team.kind)} team: this is a ${teamKindName(want)} loadout`;
        else if (trial.reason === "onMission") reason = crewLockText(state, ship.id) ?? groundLoadoutBlockText("onMission");
        else if (trial.reason === "teamHasLoadout") {
          const worn = groundTeamWornLoadout(state, ship.id, teamIndex);
          reason = worn ? `Wears "${worn.name}" (check it in first)` : groundLoadoutBlockText(trial.reason);
        } else reason = groundLoadoutBlockText(trial.reason);
      }
      out.push({
        key: `${ship.id}:${teamIndex}`,
        shipId: ship.id,
        teamIndex,
        kind: team.kind,
        title,
        sub: reason ?? `${teamKindName(team.kind)} · docked`,
        disabled: reason !== null,
        reason,
      });
    });
  }
  return out;
}

// --- The report ----------------------------------------------------------------------------------------

export interface ReportLine {
  ok: boolean; // true = went on / saved; false = skipped (with a reason)
  text: string;
  reason: string | null;
}

export interface LoadoutReportView {
  title: string;
  noSkips: boolean;
  lines: ReportLine[];
}

// "Security 1, 2 and Science 1". Pure.
function slotListText(slots: readonly { teamType: GroundSquadType; slotIndex: number }[]): string {
  const parts = GROUND_SQUAD_TYPES.map((t) => {
    const nums = slots.filter((s) => s.teamType === t).map((s) => s.slotIndex + 1);
    return nums.length === 0 ? null : `${SQUAD_TYPE_NAME[t]} ${nums.join(", ")}`;
  }).filter((p): p is string => p !== null);
  return parts.join(" and ");
}

// The skip lines in kit order: an empty slot (or a slot this team lacks) is ONE line for the whole kit ("the kit
// stays in the locker", user S14), any other skip one line per piece with the engine's reason. Pure.
function skipLines(state: GameState, skipped: readonly GroundLoadoutSkip[], verb: string): ReportLine[] {
  const lines: ReportLine[] = [];
  const kitDone = new Set<string>();
  for (const s of skipped) {
    const label = kitSlotLabel(s.teamType, s.slotIndex);
    if (s.reason === "emptySlot" || s.reason === "noSlot") {
      const key = `${s.teamType}:${s.slotIndex}`;
      if (kitDone.has(key)) continue;
      kitDone.add(key);
      lines.push({
        ok: false,
        text: s.reason === "emptySlot" ? `${label} · nobody in this slot` : `${label} · no such slot on this team`,
        reason: "The kit stays in the locker",
      });
      continue;
    }
    lines.push({ ok: false, text: `${label} · ${pieceNameById(state, s.pieceId)} ${verb}`, reason: groundLoadoutSkipText(s.reason) });
  }
  return lines;
}

// The install report after "Put it on a team": what installed, what was skipped and why (never forced).
// `next` is the state after the install. Pure.
export function applyReportView(
  next: GameState,
  loadoutId: string,
  shipId: string,
  teamIndex: number,
  pieces: number,
  skipped: readonly GroundLoadoutSkip[],
): LoadoutReportView {
  const loadout = (next.squadLoadouts ?? []).find((l) => l.id === loadoutId);
  const total = loadout ? loadoutPieceIds(loadout).length : pieces;
  const skippedIn = (t: GroundSquadType, i: number) => skipped.filter((s) => s.teamType === t && s.slotIndex === i).length;
  const kits = loadout
    ? GROUND_SQUAD_TYPES.flatMap((t) =>
        loadout[t].map((kit, slotIndex) => ({ teamType: t, slotIndex, n: kitPieceIds(kit).length, off: skippedIn(t, slotIndex) })),
      )
    : [];
  const clean = kits.filter((k) => k.n > 0 && k.off === 0);
  const lines: ReportLine[] = [];
  if (clean.length > 0) lines.push({ ok: true, text: `${slotListText(clean)}: all pieces installed`, reason: null });
  // A kit that partly went on says how much, before its skips below.
  for (const k of kits.filter((x) => x.off > 0 && x.off < x.n)) {
    lines.push({ ok: true, text: `${kitSlotLabel(k.teamType, k.slotIndex)}: ${k.n - k.off} of ${k.n} pieces installed`, reason: null });
  }
  lines.push(...skipLines(next, skipped, "skipped"));
  return {
    title: `Installed ${pieces} of ${total} piece${total === 1 ? "" : "s"} on ${teamPlaceLabel(next, shipId, teamIndex)}`,
    noSkips: skipped.length === 0,
    lines,
  };
}

// The report after "Save a team's gear": what was saved and what stayed on the members. Pure.
export function createReportView(
  next: GameState,
  loadoutId: string,
  pieces: number,
  skipped: readonly GroundLoadoutSkip[],
): LoadoutReportView {
  const loadout = (next.squadLoadouts ?? []).find((l) => l.id === loadoutId);
  const name = loadout?.name ?? "the loadout";
  const lines: ReportLine[] = [];
  if (loadout?.checkedOutTo) {
    lines.push({
      ok: true,
      text: `Worn by ${teamPlaceLabel(next, loadout.checkedOutTo.shipId, loadout.checkedOutTo.teamIndex)} now`,
      reason: "Check it in to rest the pieces in the locker",
    });
  }
  lines.push(...skipLines(next, skipped, "not saved"));
  return { title: `Saved "${name}" with ${pieces} piece${pieces === 1 ? "" : "s"}`, noSkips: skipped.length === 0, lines };
}

// The log line for an install or save report: the title, then each skip with its reason. Pure.
export function reportLogText(report: LoadoutReportView): string {
  const skips = report.lines.filter((l) => !l.ok).map((l) => `${l.text} (${l.reason})`);
  return skips.length === 0 ? `${report.title}.` : `${report.title}. ${skips.join("; ")}.`;
}

// --- Personnel Rosters (one squad loadout link per team) ------------------------------------------------

export interface RosterSquadOption {
  id: string;
  label: string; // "Breach and Hold (Strike)"
}

// The squad loadouts a roster can link, labeled with their type. Pure.
export function rosterSquadOptions(state: GameState): RosterSquadOption[] {
  return (state.squadLoadouts ?? []).map((l) => ({ id: l.id, label: `${l.name} (${teamKindName(loadoutKind(l))})` }));
}
