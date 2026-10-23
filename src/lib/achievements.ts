// achievements.ts: the achievement popup's queue (0.13.11.1, design section 5).
//
// The small-scale prototype of the future main-game achievements system: one shape for anything
// worth celebrating, one queue, one component (AchievementToasts.svelte) mounted once at the top of
// App so a popup shows over the minigame when it is open and over the main game when it is not.
// Several landing at once (an offline catch-up) simply queue and show one after another.

import { writable, type Readable } from "svelte/store";

export interface Achievement {
  id: string; // unique per achievement, used to de-duplicate the queue
  title: string; // shown as "Achievement obtained: <title>"
  requirement: string; // how it was earned
  flavor?: string; // optional joke line
  reward: string; // the green line at the bottom
}

// How long one popup stays before it fades on its own (design: "about 4 seconds").
export const ACHIEVEMENT_SHOW_MS = 4000;

// Pure: the queue with `a` appended, unless an achievement with the same id is already waiting.
export function enqueueAchievement(queue: readonly Achievement[], a: Achievement): Achievement[] {
  return queue.some((x) => x.id === a.id) ? [...queue] : [...queue, a];
}

const queue = writable<Achievement[]>([]);

export const achievementQueue: Readable<Achievement[]> = { subscribe: queue.subscribe };

export function pushAchievement(a: Achievement): void {
  queue.update((q) => enqueueAchievement(q, a));
}

export function dismissAchievement(id: string): void {
  queue.update((q) => q.filter((x) => x.id !== id));
}

// Tests only.
export function clearAchievements(): void {
  queue.set([]);
}
