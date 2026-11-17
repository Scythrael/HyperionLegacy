// catchUpGate.ts: true while the catch-up overlay blocks the game (HOTFIX 0.13.11.4).
//
// App.svelte makes the game inert while an asynchronous catch-up runs (or after one failed), but the
// game's own windows and popovers that are portaled to <body> (ActionModal, which the Enter Code
// window also uses, and the MultiSelect checklist) live outside that inert subtree. They read this
// store and go inert too, so nothing can write into the game state behind the overlay, where the
// catch-up's result would overwrite it. The minigame layers (the Minigames list, the minigame window,
// the toasts) are deliberately NOT gated: they stay above everything and never write the main game.

import { writable } from "svelte/store";

export const catchUpBlocking = writable(false);
