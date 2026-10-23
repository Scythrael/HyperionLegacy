// achievements.ts: the achievement popup's data (0.13.11.1, design section 5).
//
// The small-scale prototype of the future main-game achievements system: one shape for anything
// worth celebrating, shown by AchievementToasts.svelte.

export interface Achievement {
  id: string; // unique per achievement, used to de-duplicate the queue
  title: string; // shown as "Achievement obtained: <title>"
  requirement: string; // how it was earned
  flavor?: string; // optional joke line
  reward: string; // the green line at the bottom
}
