# 2026-10-21 capture: reactor fuel ladder, a new Deuterium-bearing mission, recipe realism, reactor tech foundation

Captured verbatim from the user's answers on 2026-10-21 (multiple-choice "Other" text). Authoritative; nothing here is
built yet. Follow-up multiple-choice calls are listed at the end.

## 1. The user's words (verbatim)

**Reactor fuel in every core** (first answer): "There should be some sort of material like deuterium in all cores. After
all, the tech before antimatter reactors (which would likely be a high-tier tech later on, which is honestly where
antimatter canisters could ultimately be used over a burn option. But the burn option might be useful as well. We'll see
on that one. Might be a tech only available with antimatter reactors that can have an overburn option in exchange for
extra canisters or something. But I digress. All reactor core crafting recipes should ultimately require something like
this since that makes sense."

**Fuel ladder:** "Deuterium, then Helium-3 (Recommended)": early and mid cores take Deuterium Canisters (Deuterium Ice via
the Refinery); high-tier cores take Helium-3; Antimatter Cells are saved for the future antimatter reactor tech.

**The Deuterium source:** "Yeah, but don't make it the same mission as before. Make it a mission that can provide
additional resources as well, with deuterium as one of the more common items. BAsically, crafting recipes should make
sense for every item. A light bulb shouldn't require antimatter, and an antimatter wouldn't require a scoop of ice cream
in its actual component structure. So we'd have to ensure we are keeping things real. IF that requires adjusting items as
well, then so be it. Just don't do it in a way that turns player items into broken useless items like we did with fuel v1
that just got sold to a vendor."

**Reactor tech foundation:** "Well, the reactor will be a top tier system. Probably a requirement of power generation on
T7 ships. Which likely won't appear until at least the balancing patch. We might even start introducing a transitional
unit between fusion and antimatter tech. We can even dig into proper science for theorized and realistic options. So we
should engineer and build in the structure/foundation for this system. Remember, I mentioned that the systems will need
to be structured and wired in correctly for functionality across the board. So when we start the balancing run, we're
basically creating content tiers, new missions, and so forth. The more time we spend then on designing the systems, the
less we're able to properly balance them because we're trying to balance while foundational development is still
underway."

## 2. Reading (my record, to confirm)

- **Every Reactor Core recipe takes a fuel canister:** Deuterium Canister for early and mid tiers, Helium-3 for high
  tiers. Existing crafted reactors keep working unchanged (recipes only change future crafts).
- **A NEW Tier I mission** (not the retired Local Deuterium Skim) yields several resources, Deuterium Ice among the more
  common ones. Supersedes Material Lines call L8's "Local Deuterium Skim returns".
- **Recipe realism pass:** every item's recipe should make physical sense (no antimatter in a light bulb). Items may be
  adjusted, BUT no player item may become broken or useless (the fuel v1 lesson: it ended up vendor trash). Any changed
  item keeps a real use or converts fairly via migration.
- **Reactor tech ladder foundation (build the structure now, content in the balancing patch):** fusion reactors today, a
  transitional tech between fusion and antimatter, then antimatter reactors as a top-tier system (likely the power
  requirement for Tier VII ships), fueled by Antimatter Containment Cells, possibly with an "overburn" option (extra
  canisters for a boost; relation to the 0.14.x antimatter burn undecided, "We'll see on that one"). Realistic and
  theorized science to guide the tiers.
- **Standing principle restated:** systems must be structured and wired for functionality across the board BEFORE the
  balancing patch, so balancing is content and tuning, not foundation work. (Pairs with "everything wired" and "clean
  foundation now".)

## 3. Scope flag (push-back rule)

The recipe realism pass touches every recipe in the game and is the largest new item here. Recommended shape: an audit
document first (every recipe, its inputs, a realism verdict, a proposed change, and the save impact for items players
already hold), signed off by the user in multiple-choice groups, then small build slices. The reactor ladder foundation
is a data-model and seam slice (tiers, fuel per tier, a per-hull-tier power-generation requirement hook), not content.

## 4. Follow-up calls (asked by multiple choice)

1. The new mission: name, what it yields beside Deuterium Ice, which tier and unlock.
2. Recipe realism pass: audit-first in 0.14.0, or audit now and changes in the balancing patch.
3. Reactor ladder foundation: what the transitional tech is called and which real or theorized science each tier follows.
4. Overburn vs the 0.14.x burn: kept open per the user.

## 5. USER ANSWERS (2026-10-21)

- **New mission:** "Cometary Ice Harvest (Recommended)": [PROPOSAL name accepted] mine a passing comet's ice: Deuterium Ice
  common, plus Titanium Ore and a rare chance of Iridium. Tier I.
- **Recipe realism pass (verbatim):** "1. Definitely." = audit now, fix in 0.14.0: a full audit doc (every recipe, realism
  verdict, proposed fix, what happens to items players already hold), signed off in small groups, then build; no item
  ever becomes useless. Plus, verbatim: "Also note that our QA will be running deep. I'm actually going to consider adding
  in 2 options. Each playing to their own strengths. You're an all-rounder and are amazing at everything. But in
  combination with ChatGPT's ability to quickly browse things as a human would to find things we might miss from that
  perspective, Gemini will be doing a read-only simulating pass across the codebase at the same time. Neither allowed to
  make a single change to the code. But both could provide incredible insights into things not working properly, or not
  working as intended. Everything being wired in important, but if the thing wired in is malfunctioning, that's equally
  important."
- **Transitional reactor tech:** "Antimatter-catalyzed fusion (Recommended)". Ladder: fusion, antimatter-catalyzed fusion,
  antimatter.
- **Foundation scope:** "Data model + hooks (Recommended)": reactor tech tiers, fuel per tier, a per-hull-tier
  power-generation requirement seam (Tier VII = antimatter later), wired and tested; no new reactors in 0.14.0.

## 6. USER DATADUMP (2026-10-21, verbatim): beyond antimatter

"Though, I do have another idea. Though it's incredibly theoretical in nature, and I'm not even sure how we'd be able to
make it work, but I know of a reactor tech that could work for the next tier above antimatter. Zero-point Energy.
Romulans even use a miniature singularity and contain it within their ships. I don't think I want to go that route.
However, imagine a weaponized black hole or something similar to their singularity drives. That'd be an incredibly
destructive weapon."

Reading: a possible reactor tier ABOVE antimatter: zero-point energy (theoretical; open how it works). Contained
singularity reactors are NOT the route for power. Separately, a future WEAPON idea: a weaponized black hole /
singularity (incredibly destructive). Both are far-future content, not 0.14.0. The reactor foundation keeps tiers as
data so a fourth tier can be added without redesign.
