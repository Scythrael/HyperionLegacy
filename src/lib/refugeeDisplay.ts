// refugeeDisplay.ts: E5 Refugee Posts display logic (plan docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-5;
// the signed mockup docs/mockups/2026-11-02-e5-refugee-posts-mockup.html, sections 1 and 2, every open call as drawn).
//
// PURE. Every number here is read from the engine: a posted person's share is refugeeShare, a facility's total is
// refugeeFacilityBonus, and every picker gain and "total becomes" is refugeeBonusIfPosted (which runs the real
// postRefugee, swap included), so what the strip and the picker show is what posting does. The components
// (RefugeePostsStrip.svelte, RefugeePostPicker.svelte) only draw these views.

import type { GameState } from "./game/model";
import { FACILITIES } from "./game/model";
import {
  REFUGEE_BACKGROUNDS,
  REFUGEE_FACILITY_KEYS,
  refugeeOpenPosts,
  refugeePostCount,
  refugeePostsAt,
  refugeesOf,
  refugeesPostedAt,
  refugeeShare,
  refugeeWaiting,
  postRefugee,
  unpostRefugee,
  type RefugeeBackground,
  type RefugeeFacilityKey,
  type RefugeeRecord,
} from "./game/refugees";
import { refugeeBonusIfPosted, refugeeFacilityBonus } from "./game/refugeeBuffs";
import { shortRangeDestinationLabel } from "./game/shortRange";
import { shortRangeTierNumeral } from "./shortRangeBoardDisplay";
import type { IconName } from "./ui/icons";

// The facility names the player reads (the Facilities dashboard's FACILITY_LABELS, plus Mission Control, which has no
// dashboard card and lives on the Operations tab).
export const REFUGEE_FACILITY_LABELS: Readonly<Record<RefugeeFacilityKey, string>> = {
  refinery: "Refinery",
  fuelStorage: "Fuel Depot",
  missionControl: "Mission Control",
  research: "Research Lab",
  fabricator: "Fabricator",
  shipyard: "Shipyard",
  salvageBay: "Salvage Bay",
  subspaceTelescope: "Subspace Telescope",
};

// Each background's SVG glyph (icons.ts), the chip beside the trade's name.
export const REFUGEE_BACKGROUND_ICONS: Readonly<Record<RefugeeBackground, IconName>> = {
  refiner: "refugeeRefiner",
  fuelHandler: "refugeeFuelHandler",
  dispatcher: "refugeeDispatcher",
  scholar: "refugeeScholar",
  machinist: "refugeeMachinist",
  shipwright: "refugeeShipwright",
  salvager: "refugeeSalvager",
  stargazer: "refugeeStargazer",
};

// The background each facility matches (the inverse of REFUGEE_BACKGROUNDS).
export function refugeeMatchOf(facility: RefugeeFacilityKey): RefugeeBackground {
  for (const [bg, def] of Object.entries(REFUGEE_BACKGROUNDS) as [RefugeeBackground, { facility: RefugeeFacilityKey }][]) {
    if (def.facility === facility) return bg;
  }
  return "refiner";
}

// The stat a facility's posts improve, in the player's words ("research speed").
export function refugeeStatLabel(facility: RefugeeFacilityKey): string {
  return REFUGEE_BACKGROUNDS[refugeeMatchOf(facility)].statLabel;
}

// A fraction as a signed percent: 0.042 -> "+4.2%". Below a tenth of a percent it keeps two decimals, so a small but
// real buff never reads "+0.0%". Pure.
export function percentText(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction === 0) return "+0.0%";
  const pct = Math.abs(fraction) * 100;
  const body = pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1);
  return `${fraction < 0 ? "-" : "+"}${body}%`;
}

// The same without the percent sign (the desktop readout's "Mira +4.2").
function shareNumber(fraction: number): string {
  return percentText(fraction).replace("%", "");
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function levelOf(state: GameState, facility: RefugeeFacilityKey): number {
  const raw = state.facilities?.[facility]?.level;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function firstName(name: string): string {
  return name.split(" ")[0] || name;
}

function backgroundPlural(bg: RefugeeBackground): string {
  return `${REFUGEE_BACKGROUNDS[bg].label.toLowerCase()}s`;
}

// ===== one person, as every surface draws them =====

export interface RefugeePersonView {
  id: number;
  name: string;
  firstName: string;
  background: RefugeeBackground;
  backgroundLabel: string;
  skill: number;
  originText: string; // "Body II, desert world · Tier I"
  portrait: { hair: number; palette: number };
  posting: RefugeeFacilityKey | null;
}

export function refugeePersonView(r: RefugeeRecord): RefugeePersonView {
  return {
    id: r.id,
    name: r.name,
    firstName: firstName(r.name),
    background: r.background,
    backgroundLabel: REFUGEE_BACKGROUNDS[r.background].label,
    skill: r.skill,
    originText: `${shortRangeDestinationLabel({ template: "evacuation", destinationIndex: r.origin.destinationIndex })} · Tier ${shortRangeTierNumeral(r.origin.tier)}`,
    portrait: { hair: r.portrait.hair, palette: r.portrait.palette },
    posting: r.posting,
  };
}

// ===== best post =====

// Where `refugeeId` would add the most right now: every facility with posts except the one they hold, by
// refugeeBonusIfPosted's gain (a full facility counts its default swap, the lowest share going back to waiting). Ties
// prefer a facility with an open post, then the facility order. `open`: that facility has a free post. Null for an
// unknown person or when no other facility has a post. Pure.
export function refugeeBestPost(
  state: GameState,
  refugeeId: number,
): { facility: RefugeeFacilityKey; gain: number; open: boolean } | null {
  const who = refugeesOf(state).list.find((r) => r.id === refugeeId);
  if (!who) return null;
  let best: { facility: RefugeeFacilityKey; gain: number; open: boolean } | null = null;
  for (const facility of REFUGEE_FACILITY_KEYS) {
    if (facility === who.posting) continue;
    const posts = refugeePostCount(state, facility);
    if (posts < 1) continue;
    const open = refugeesPostedAt(state, facility).length < posts;
    const { gain } = refugeeBonusIfPosted(state, refugeeId, facility);
    if (best === null || gain > best.gain + 1e-12 || (Math.abs(gain - best.gain) <= 1e-12 && open && !best.open)) {
      best = { facility, gain, open };
    }
  }
  return best;
}

// What `r`, posted at `facility`, adds to its total: the total minus the total without them (the engine's own unpost).
function contributionHere(state: GameState, r: RefugeeRecord, facility: RefugeeFacilityKey): number {
  const now = refugeeFacilityBonus(state, facility);
  const without = refugeeFacilityBonus(unpostRefugee(state, r.id).next, facility);
  return now - without;
}

// ===== the Posts strip (mockup section 1) =====

// The strip shows once anyone has ever arrived, on a facility that has posts (call 13 A's "no Posts rows on a new
// save"; an unbuilt, level 0, facility has no posts and no strip).
export function postsStripShown(state: GameState, facility: RefugeeFacilityKey): boolean {
  return refugeesOf(state).arrivedTotal > 0 && refugeePostCount(state, facility) > 0;
}

export interface PostsStripSlotView extends RefugeePersonView {
  matched: boolean;
  matchText: "match" | "other";
  share: number; // refugeeShare, before the curve
  shareText: string; // "+4.2%"
  shareShort: string; // "+4.2"
  hereText: string; // "+4.2% research speed"
}

export interface PostsStripView {
  facility: RefugeeFacilityKey;
  facilityLabel: string;
  statLabel: string;
  posts: number;
  filled: number;
  full: boolean;
  countText: string; // "2 / 3"
  nextPostText: string | null; // "4th post at Level 10" (null when the facility's top level opens no more)
  nextPostShort: string | null; // "4th at Level 10" (phone)
  slots: PostsStripSlotView[];
  emptyPosts: number; // the open posts, each drawn as one "Post someone" slot
  emptyText: string; // "5 waiting · 2 refiners"
  total: number; // refugeeFacilityBonus
  totalText: string | null; // "+7.4% research speed", null with nobody posted
  sharesLine: { firstName: string; shareShort: string }[]; // desktop readout "Mira +4.2 · Orrin +3.6"
  note: string | null; // the hint, the curve line, or the empty line
  noteIsHint: boolean;
  // Anyone (waiting or posted elsewhere) who could be posted here: whether the picker has anyone to offer.
  candidates: number;
}

// The strip under a facility pane, or null when it is not shown (postsStripShown). Pure.
export function postsStripView(state: GameState, facility: RefugeeFacilityKey): PostsStripView | null {
  if (!postsStripShown(state, facility)) return null;
  const level = levelOf(state, facility);
  const posts = refugeePostCount(state, facility);
  const here = refugeesPostedAt(state, facility);
  const statLabel = refugeeStatLabel(facility);
  const match = refugeeMatchOf(facility);

  // The next level that opens another post, within the facility's ladder.
  const maxLevel = FACILITIES[facility]?.upgrades?.length ?? level;
  let nextLevel: number | null = null;
  for (let l = level + 1; l <= maxLevel; l++) {
    if (refugeePostsAt(l) > posts) { nextLevel = l; break; }
  }
  const nth = ordinal(posts + 1);

  const slots: PostsStripSlotView[] = here.map((r) => {
    const share = refugeeShare(r, facility);
    const matched = r.background === match;
    return {
      ...refugeePersonView(r),
      matched,
      matchText: matched ? "match" : "other",
      share,
      shareText: percentText(share),
      shareShort: shareNumber(share),
      hereText: `${percentText(share)} ${statLabel}`,
    };
  });

  const waiting = refugeeWaiting(state);
  const matching = waiting.filter((r) => r.background === match).length;
  const plural = backgroundPlural(match);
  const singular = REFUGEE_BACKGROUNDS[match].label.toLowerCase();
  const matchPart = matching === 0 ? `no ${plural} yet` : matching === 1 && waiting.length === 1 ? `a ${singular}` : `${matching} ${matching === 1 ? singular : plural}`;
  const emptyText = waiting.length === 0 ? "nobody waiting" : `${waiting.length} waiting · ${matchPart}`;

  const total = refugeeFacilityBonus(state, facility);

  // The off-match hint (call 3 A): an off-match person here who would add more at their own match facility (built,
  // with posts). Only the match counts: between two off-match posts the difference is the curve's rounding, not a
  // reason to move anyone. The largest margin wins.
  let hint: string | null = null;
  let hintMargin = 0;
  for (const r of here) {
    const home = REFUGEE_BACKGROUNDS[r.background].facility;
    if (home === facility || refugeePostCount(state, home) < 1) continue;
    const homeGain = refugeeBonusIfPosted(state, r.id, home).gain;
    const margin = homeGain - contributionHere(state, r, facility);
    if (margin > 1e-12 && margin > hintMargin) {
      hintMargin = margin;
      hint = `${firstName(r.name)} would give ${percentText(homeGain)} ${refugeeStatLabel(home)} at the ${REFUGEE_FACILITY_LABELS[home]}`;
    }
  }
  const note = hint
    ?? (here.length === 0 ? "Empty posts give nothing; anyone posted here helps a little."
      : here.length >= 2 ? "stacked on the diminishing curve" : null);

  const elsewhere = refugeesOf(state).list.filter((r) => r.posting !== null && r.posting !== facility).length;

  return {
    facility,
    facilityLabel: REFUGEE_FACILITY_LABELS[facility],
    statLabel,
    posts,
    filled: here.length,
    full: here.length >= posts,
    countText: `${here.length} / ${posts}`,
    nextPostText: nextLevel === null ? null : `${nth} post at Level ${nextLevel}`,
    nextPostShort: nextLevel === null ? null : `${nth} at Level ${nextLevel}`,
    slots,
    emptyPosts: Math.max(0, posts - here.length),
    emptyText,
    total,
    totalText: here.length === 0 ? null : `${percentText(total)} ${statLabel}`,
    sharesLine: slots.map((s) => ({ firstName: s.firstName, shareShort: s.shareShort })),
    note,
    noteIsHint: hint !== null,
    candidates: waiting.length + elsewhere,
  };
}

// ===== the post picker, for one facility (mockup section 2) =====

export interface PostPickerRow extends RefugeePersonView {
  matched: boolean;
  matchText: "match" | "other";
  gain: number; // refugeeBonusIfPosted gain here (with the chosen swap target on a full facility)
  gainText: string; // "+6.1% research speed"
  gainShort: string; // "+6.1% here"
  detail: string; // desktop: "total becomes +12.6%" or "+6.8% discovery odds at the Subspace Telescope"
  detailShort: string | null; // phone: "+6.8% at Subspace Telescope" (off match only)
  whereText: string | null; // posted elsewhere: "now at Research Lab (+0.9%)"
  whereShort: string | null; // phone: "at Research Lab"
  top: boolean; // the best waiting row (highlighted, primary button)
}

export interface PostPickerSwapTarget {
  id: number;
  name: string;
  shareText: string;
}

export interface PostPickerView {
  facility: RefugeeFacilityKey;
  facilityLabel: string;
  title: string; // "Post someone at the Refinery"
  shortTitle: string; // "Refinery post 3"
  meta: string; // "post 3 of 3 · Level 7"
  full: boolean;
  summary: string;
  summaryShort: string;
  // A full facility (call 10 A): the people posted here, one of whom the newcomer replaces. `replaceId` is the chosen
  // one (the player's pick, else the engine's fallback: the lowest share, the last posted among equals).
  swap: { targets: PostPickerSwapTarget[]; replaceId: number } | null;
  waiting: PostPickerRow[]; // sorted by gain here, then arrival
  posted: PostPickerRow[]; // posted elsewhere, sorted by gain here
  footText: string; // "5 waiting · 1 more posted elsewhere"
}

// The person the engine replaces on a full facility when the player names nobody: read off the real postRefugee.
function defaultSwapTarget(state: GameState, facility: RefugeeFacilityKey, candidateId: number | undefined): number | undefined {
  if (candidateId === undefined) {
    // Nobody to post: the same rule the engine uses (lowest share, the last posted among equals).
    const here = refugeesPostedAt(state, facility);
    let out: RefugeeRecord | undefined = here[0];
    for (const r of here) if (out && refugeeShare(r, facility) <= refugeeShare(out, facility)) out = r;
    return out?.id;
  }
  return postRefugee(state, candidateId, facility).swappedOutId;
}

// The picker opened from `facility`'s posts. `replaceId`: on a full facility, the person the player picked to
// replace (ignored when it is not someone posted here). Pure.
export function postPickerView(state: GameState, facility: RefugeeFacilityKey, replaceId?: number): PostPickerView {
  const level = levelOf(state, facility);
  const posts = refugeePostCount(state, facility);
  const here = refugeesPostedAt(state, facility);
  const full = posts > 0 && here.length >= posts;
  const statLabel = refugeeStatLabel(facility);
  const match = refugeeMatchOf(facility);
  const label = REFUGEE_FACILITY_LABELS[facility];
  const list = refugeesOf(state).list;
  const waitingRecs = list.filter((r) => r.posting === null);
  const elsewhereRecs = list.filter((r) => r.posting !== null && r.posting !== facility);

  let swap: PostPickerView["swap"] = null;
  let target: number | undefined;
  if (full) {
    const firstCandidate = (waitingRecs[0] ?? elsewhereRecs[0])?.id;
    target = replaceId !== undefined && here.some((r) => r.id === replaceId) ? replaceId : defaultSwapTarget(state, facility, firstCandidate);
    if (target !== undefined) {
      swap = {
        targets: here.map((r) => ({ id: r.id, name: r.name, shareText: percentText(refugeeShare(r, facility)) })),
        replaceId: target,
      };
    }
  }

  const row = (r: RefugeeRecord): PostPickerRow & { order: number } => {
    const matched = r.background === match;
    const { gain, total } = refugeeBonusIfPosted(state, r.id, facility, full ? target : undefined);
    let detail = `total becomes ${percentText(total)}`;
    let detailShort: string | null = null;
    const home = REFUGEE_BACKGROUNDS[r.background].facility;
    if (!matched && r.posting !== home && refugeePostCount(state, home) > 0) {
      const homeGain = refugeeBonusIfPosted(state, r.id, home).gain;
      if (homeGain > 0) {
        detail = `${percentText(homeGain)} ${refugeeStatLabel(home)} at the ${REFUGEE_FACILITY_LABELS[home]}`;
        detailShort = `${percentText(homeGain)} at ${REFUGEE_FACILITY_LABELS[home]}`;
      }
    }
    const where = r.posting === null ? null : r.posting;
    // Posted elsewhere, off match here (the mockup's Dov): compare with what they add where they are now (their real
    // contribution there, curve included), "same as where they are now" when the two read alike.
    if (!matched && where !== null) {
      const there = contributionHere(state, r, where);
      if (percentText(gain) === percentText(there)) {
        detail = "same as where they are now";
        detailShort = "same as now";
      } else {
        detail = `vs ${percentText(there)} ${refugeeStatLabel(where)} now`;
        detailShort = `vs ${percentText(there)} now`;
      }
    }
    return {
      ...refugeePersonView(r),
      matched,
      matchText: matched ? "match" : "other",
      gain,
      gainText: `${percentText(gain)} ${statLabel}`,
      gainShort: `${percentText(gain)} here`,
      detail,
      detailShort,
      whereText: where === null ? null : `now at ${REFUGEE_FACILITY_LABELS[where]} (${percentText(refugeeShare(r, where))})`,
      whereShort: where === null ? null : `at ${REFUGEE_FACILITY_LABELS[where]}`,
      top: false,
      order: r.id,
    };
  };
  const byGain = (a: { gain: number; order: number }, b: { gain: number; order: number }) =>
    b.gain - a.gain || a.order - b.order;
  const waiting = waitingRecs.map(row).sort(byGain);
  const posted = elsewhereRecs.map(row).sort(byGain);
  if (waiting.length > 0 && waiting[0].gain > 0) waiting[0].top = true;
  const strip = (r: PostPickerRow & { order: number }): PostPickerRow => {
    const { order: _order, ...rest } = r;
    return rest;
  };

  const now = refugeeFacilityBonus(state, facility);
  const nowPart = here.length === 0 ? `Nobody is posted here yet` : `Now ${percentText(now)} ${statLabel}`;
  const plural = backgroundPlural(match);
  const lead = `${plural.charAt(0).toUpperCase()}${plural.slice(1)} give the most here.`;
  const summary = full
    ? `${lead} ${nowPart}. Every post is taken: the person you pick to replace goes back to the waiting list. Moving is free, any time.`
    : `${lead} ${nowPart}; one tap posts, and you can move anyone again later for free.`;
  const summaryShort = full
    ? `${nowPart}. Every post is taken; pick who goes back to waiting.`
    : `${nowPart}. Tap Post; moving later is free.`;

  const postNumber = full ? posts : here.length + 1;
  return {
    facility,
    facilityLabel: label,
    title: full ? `Swap someone in at the ${label}` : `Post someone at the ${label}`,
    shortTitle: full ? `${label} swap` : `${label} post ${postNumber}`,
    meta: `post ${postNumber} of ${posts} · Level ${level}`,
    full,
    summary,
    summaryShort,
    swap,
    waiting: waiting.map(strip),
    posted: posted.map(strip),
    footText: `${waiting.length} waiting · ${posted.length === 0 ? "nobody posted elsewhere" : `${posted.length} more posted elsewhere`}`,
  };
}

// ===== the facility chooser, for one person ("Move to another post"; E5-6's "Post..." reuses it) =====

export interface PersonPostChoiceSwap {
  id: number;
  name: string;
  shareText: string;
  gain: number; // the REAL gain of replacing this person (refugeeBonusIfPosted with them as the target): can be negative
  gainText: string; // "-1.4% research speed"
  total: number; // the facility's total after this replace
  totalText: string; // "total becomes +5.2%"
  isDefault: boolean;
}

export interface PersonPostChoice {
  facility: RefugeeFacilityKey;
  facilityLabel: string;
  level: number;
  matched: boolean;
  open: boolean;
  openText: string; // "1 open" or "full · swap"
  gain: number; // an open post: the gain of posting here. A full facility: the best of its swaps (for sorting only)
  gainText: string; // "+3.7% craft speed", or a full facility: "up to +3.7% craft speed" (each swap carries its own)
  totalText: string; // "total becomes +4.1%", or a full facility: "depends on who you replace"
  swaps: PersonPostChoiceSwap[]; // a full facility: replace each posted person (the player picks), each with its real result
}

export interface PersonPostView {
  person: RefugeePersonView;
  title: string; // "Move Mira Talven" or "Post Mira Talven"
  currentText: string | null; // "Now at the Refinery: +4.2% extra output chance"
  summary: string; // the line under the person: where they are now, that moving is free, what a Replace does
  choices: PersonPostChoice[]; // sorted by gain
}

// Every facility `refugeeId` could be posted at (each with posts, not the one they hold), sorted by gain (ties: open
// first, then facility order). A full facility lists a swap per person posted there, each with its own gain. Null for
// an unknown person. Pure.
export function personPostView(state: GameState, refugeeId: number): PersonPostView | null {
  const who = refugeesOf(state).list.find((r) => r.id === refugeeId);
  if (!who) return null;
  const choices: (PersonPostChoice & { order: number })[] = [];
  REFUGEE_FACILITY_KEYS.forEach((facility, order) => {
    if (facility === who.posting) return;
    const posts = refugeePostCount(state, facility);
    if (posts < 1) return;
    const here = refugeesPostedAt(state, facility);
    const open = here.length < posts;
    const statLabel = refugeeStatLabel(facility);
    const fallback = open ? undefined : postRefugee(state, refugeeId, facility).swappedOutId;
    const swaps: PersonPostChoiceSwap[] = open ? [] : here.map((r) => {
      const res = refugeeBonusIfPosted(state, refugeeId, facility, r.id);
      return {
        id: r.id,
        name: r.name,
        shareText: percentText(refugeeShare(r, facility)),
        gain: res.gain,
        gainText: `${percentText(res.gain)} ${statLabel}`,
        total: res.total,
        totalText: `total becomes ${percentText(res.total)}`,
        isDefault: r.id === fallback,
      };
    });
    // An open post: the one real result. A full facility: no single number is "the" result (it is whoever the player
    // replaces), so the row says "up to" the best swap and every Replace button shows its own gain and total.
    const openRes = open ? refugeeBonusIfPosted(state, refugeeId, facility) : null;
    const gain = openRes ? openRes.gain : Math.max(...swaps.map((w) => w.gain));
    const free = posts - here.length;
    choices.push({
      facility,
      facilityLabel: REFUGEE_FACILITY_LABELS[facility],
      level: levelOf(state, facility),
      matched: REFUGEE_BACKGROUNDS[who.background].facility === facility,
      open,
      openText: open ? `${free} open` : "full · swap",
      gain,
      gainText: openRes ? `${percentText(gain)} ${statLabel}` : `up to ${percentText(gain)} ${statLabel}`,
      totalText: openRes ? `total becomes ${percentText(openRes.total)}` : "depends on who you replace",
      swaps,
      order,
    });
  });
  choices.sort((a, b) => b.gain - a.gain || Number(b.open) - Number(a.open) || a.order - b.order);
  const person = refugeePersonView(who);
  const currentText = who.posting === null ? null
    : `Now at the ${REFUGEE_FACILITY_LABELS[who.posting]}: ${percentText(refugeeShare(who, who.posting))} ${refugeeStatLabel(who.posting)}.`;
  const anyFull = choices.some((c) => !c.open);
  const summary = `${currentText ?? "Waiting at home."} Moving is free, any time; an old post goes empty.`
    + (anyFull ? " On a full facility, Replace sends the person you replace back to the waiting list." : "");
  return {
    person,
    title: who.posting === null ? `Post ${who.name}` : `Move ${who.name}`,
    currentText,
    summary,
    choices: choices.map(({ order: _order, ...rest }) => rest),
  };
}

// ===== E5-6: the Personnel Refugees tab, the arrival card and the first-arrival hint (mockup sections 3 to 6) =====

// The Refugees tab exists once anyone has ever arrived (call 13 A), and stays even after relocations empty the list
// (Review Focus 3). Pure.
export function refugeesTabVisible(state: GameState): boolean {
  return refugeesOf(state).arrivedTotal > 0;
}

// Every post on the homeworld (the eight facilities at their levels). Pure.
export function refugeeTotalPosts(state: GameState): number {
  let total = 0;
  for (const facility of REFUGEE_FACILITY_KEYS) total += refugeePostCount(state, facility);
  return total;
}

// The best OPEN post for `refugeeId`: among facilities with a free post (not the one they hold), the largest
// refugeeBonusIfPosted gain (ties: the facility order). Null when no facility has a free post. Pure.
export function refugeeBestOpenPost(state: GameState, refugeeId: number): { facility: RefugeeFacilityKey; gain: number } | null {
  const who = refugeesOf(state).list.find((r) => r.id === refugeeId);
  if (!who) return null;
  let best: { facility: RefugeeFacilityKey; gain: number } | null = null;
  for (const facility of REFUGEE_FACILITY_KEYS) {
    if (facility === who.posting) continue;
    const posts = refugeePostCount(state, facility);
    if (posts < 1 || refugeesPostedAt(state, facility).length >= posts) continue;
    const { gain } = refugeeBonusIfPosted(state, refugeeId, facility);
    if (best === null || gain > best.gain + 1e-12) best = { facility, gain };
  }
  return best;
}

// The slowing-arrivals line (call 9 A): words only, never a number or a chance, and only while the waiting list is
// longer than the open posts (exactly when the engine's taper, refugeeArrivalChance, is below 1). Empty otherwise. Pure.
export function slowArrivalsLine(state: GameState): string {
  if (refugeeWaiting(state).length <= refugeeOpenPosts(state)) return "";
  return "Evacuations keep bringing people home, a little less often while this list is longer than your open posts.";
}

export type RefugeesTabFilter = "waiting" | "posted" | "everyone";
export type RefugeesTabSort = "skill" | "background" | "arrived";

export interface RefugeesTabRow extends RefugeePersonView {
  // Waiting: where they would add the most (refugeeBestPost). Posted: where they are.
  bestFacility: RefugeeFacilityKey | null;
  bestLabel: string | null; // "Refinery"
  bestOpen: boolean;
  bestText: string; // "1 open · +6.1%", "no open post", or posted: "posted · +4.2% extra output chance"
  bestShort: string; // phone: "Refinery open, +6.1%", "Telescope full", or "at Refinery, +4.2%"
  bestGood: boolean; // an open best post (drawn in the success color)
  action: "post" | "move";
  actionLabel: string; // "Post..." or "Move..."
  primary: boolean; // the waiting row whose best open post gains the most (the highlighted button)
}

export interface RefugeesTabView {
  waiting: number;
  posted: number;
  everyone: number;
  openPosts: number;
  totalPosts: number;
  calm: string; // the desktop calm line
  calmShort: string; // the phone calm line
  filter: RefugeesTabFilter;
  sort: RefugeesTabSort;
  rows: RefugeesTabRow[];
  emptyText: string | null; // the calm empty line when the filter lists nobody
}

function shortFacilityLabel(facility: RefugeeFacilityKey): string {
  return facility === "subspaceTelescope" ? "Telescope" : REFUGEE_FACILITY_LABELS[facility];
}

// The Personnel Refugees tab (mockup section 3). Every gain is refugeeBonusIfPosted (through refugeeBestPost); every
// posted share is refugeeShare. `filter` picks who is listed; `sort` the order: skill (highest first), background (the
// trade's name, then skill), arrived (newest first). Pure.
export function refugeesTabView(state: GameState, filter: RefugeesTabFilter, sort: RefugeesTabSort): RefugeesTabView {
  const list = refugeesOf(state).list;
  const waitingRecs = list.filter((r) => r.posting === null);
  const postedRecs = list.filter((r) => r.posting !== null);
  const openPosts = refugeeOpenPosts(state);
  const totalPosts = refugeeTotalPosts(state);
  const slowing = slowArrivalsLine(state);

  const shown = filter === "waiting" ? waitingRecs : filter === "posted" ? postedRecs : list;
  const gains = new Map<number, number>();
  const rows: RefugeesTabRow[] = shown.map((r) => {
    const person = refugeePersonView(r);
    if (r.posting !== null) {
      const share = refugeeShare(r, r.posting);
      return {
        ...person,
        bestFacility: r.posting,
        bestLabel: REFUGEE_FACILITY_LABELS[r.posting],
        bestOpen: false,
        bestText: `posted · ${percentText(share)} ${refugeeStatLabel(r.posting)}`,
        bestShort: `at ${shortFacilityLabel(r.posting)}, ${percentText(share)}`,
        bestGood: false,
        action: "move",
        actionLabel: "Move...",
        primary: false,
      };
    }
    const best = refugeeBestPost(state, r.id);
    if (best === null) {
      return { ...person, bestFacility: null, bestLabel: null, bestOpen: false, bestText: "no post yet", bestShort: "no post yet", bestGood: false, action: "post", actionLabel: "Post...", primary: false };
    }
    if (best.open) gains.set(r.id, best.gain);
    const free = refugeePostCount(state, best.facility) - refugeesPostedAt(state, best.facility).length;
    return {
      ...person,
      bestFacility: best.facility,
      bestLabel: REFUGEE_FACILITY_LABELS[best.facility],
      bestOpen: best.open,
      bestText: best.open ? `${free} open · ${percentText(best.gain)}` : "no open post",
      bestShort: best.open ? `${shortFacilityLabel(best.facility)} open, ${percentText(best.gain)}` : `${shortFacilityLabel(best.facility)} full`,
      bestGood: best.open,
      action: "post",
      actionLabel: "Post...",
      primary: false,
    };
  });

  const bySkill = (a: RefugeesTabRow, b: RefugeesTabRow) => b.skill - a.skill || a.id - b.id;
  if (sort === "skill") rows.sort(bySkill);
  else if (sort === "background") rows.sort((a, b) => a.backgroundLabel.localeCompare(b.backgroundLabel) || bySkill(a, b));
  else rows.sort((a, b) => b.id - a.id);

  // The highlighted Post...: the waiting row whose best post is open with the largest real gain (the first such row
  // in the shown order among equals).
  let top: RefugeesTabRow | null = null;
  let topGain = 0;
  for (const row of rows) {
    const gain = gains.get(row.id);
    if (gain !== undefined && gain > topGain + 1e-12) { top = row; topGain = gain; }
  }
  if (top !== null) top.primary = true;

  const calm = `Everyone here is safe at home and stays as long as you like. ${slowing || "Evacuations keep bringing people home."} Upgrading facilities opens more posts, and Refugee Relocation runs take one person along to lead each new camp.`;
  const calmShort = `${waitingRecs.length} waiting, ${openPosts} open ${openPosts === 1 ? "post" : "posts"}. Everyone is safe here. ${slowing ? "Evacuations keep bringing people home, a little less often while this list outgrows your open posts." : "Evacuations keep bringing people home."}`;

  let emptyText: string | null = null;
  if (rows.length === 0) {
    emptyText = list.length === 0
      ? "Nobody is here right now. Evacuations on the short-range board bring people home, and they wait here."
      : filter === "waiting"
        ? "Nobody is waiting: everyone at home is posted."
        : "Nobody is posted yet. Post someone from the waiting list.";
  }

  return { waiting: waitingRecs.length, posted: postedRecs.length, everyone: list.length, openPosts, totalPosts, calm, calmShort, filter, sort, rows, emptyText };
}

// ===== the arrival card (mockup sections 4 and 5, call 11 A) =====

export interface ArrivalCardView {
  person: RefugeePersonView;
  headline: string; // "Tamsin Corr joins your homeworld"
  runText: string; // "Evacuate Body II, desert world · complete"
  tierText: string; // "Tier II"
  matched: boolean; // the one-tap post is their background's own facility
  matchText: string; // "suits Refinery"
  // The one-tap post: the best OPEN post by refugeeBonusIfPosted. Null when no facility has a free post; the card then
  // offers the chooser (personPostView), which lists the swaps.
  post: { facility: RefugeeFacilityKey; gain: number; label: string; shortLabel: string } | null;
  laterLabel: string; // "Leave on the waiting list"
  laterShort: string; // "Later"
  toastLine: string; // the phone toast: the arrival's log sentence
}

// The arrival card for `refugeeId`, or null for an unknown or already posted person. Pure.
export function arrivalCardView(state: GameState, refugeeId: number): ArrivalCardView | null {
  const who = refugeesOf(state).list.find((r) => r.id === refugeeId);
  if (!who || who.posting !== null) return null;
  const home = REFUGEE_BACKGROUNDS[who.background].facility;
  const best = refugeeBestOpenPost(state, refugeeId);
  const label = REFUGEE_BACKGROUNDS[who.background].label.toLowerCase();
  const article = /^[aeiou]/.test(label) ? "an" : "a";
  return {
    person: refugeePersonView(who),
    headline: `${who.name} joins your homeworld`,
    runText: `Evacuate ${shortRangeDestinationLabel({ template: "evacuation", destinationIndex: who.origin.destinationIndex })} · complete`,
    tierText: `Tier ${shortRangeTierNumeral(who.origin.tier)}`,
    matched: best !== null && best.facility === home,
    matchText: `suits ${REFUGEE_FACILITY_LABELS[home]}`,
    post: best === null ? null : {
      facility: best.facility,
      gain: best.gain,
      label: `Post at the ${REFUGEE_FACILITY_LABELS[best.facility]} (${percentText(best.gain)})`,
      shortLabel: `Post at ${shortFacilityLabel(best.facility)}`,
    },
    laterLabel: "Leave on the waiting list",
    laterShort: "Later",
    toastLine: `Evacuation complete: ${who.name}, ${article} ${label}, joins your homeworld.`,
  };
}

// The arrival cards still to greet, newest first: the ids in `greet` whose person is at home and waiting. Pure.
export function arrivalCardIds(state: GameState): number[] {
  const refugees = refugeesOf(state);
  const waiting = new Set(refugees.list.filter((r) => r.posting === null).map((r) => r.id));
  return refugees.greet.filter((id) => waiting.has(id)).sort((a, b) => b - a);
}

// ===== the one-time first-arrival hint (mockup section 6, call 14 A) =====

export interface FirstArrivalHintView {
  text: string; // "Rescued people can work at your facilities. Post Ansel Rook at the Refinery for the strongest boost."
}

// The hint above the Facilities panes: once anyone has arrived, until dismissed (refugees.hintSeen, once per save).
// It names the waiting person and the open post with the strongest real gain (refugeeBestOpenPost; the
// longest-waiting among equals). Null before the first arrival and after the dismissal. Pure.
export function firstArrivalHintView(state: GameState): FirstArrivalHintView | null {
  const refugees = refugeesOf(state);
  if (refugees.arrivedTotal <= 0 || refugees.hintSeen === true) return null;
  const lead = "Rescued people can work at your facilities.";
  let pick: { name: string; facility: RefugeeFacilityKey; gain: number } | null = null;
  for (const r of refugeeWaiting(state)) {
    const best = refugeeBestOpenPost(state, r.id);
    if (best !== null && best.gain > 0 && (pick === null || best.gain > pick.gain + 1e-12)) pick = { name: r.name, facility: best.facility, gain: best.gain };
  }
  if (pick !== null) return { text: `${lead} Post ${pick.name} at the ${REFUGEE_FACILITY_LABELS[pick.facility]} for the strongest boost.` };
  return { text: `${lead} Each facility's Posts row shows who works there and what they add.` };
}
