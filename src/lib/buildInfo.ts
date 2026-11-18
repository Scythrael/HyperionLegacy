// Which kind of build is running, for the version line (user, 2026-11-18). A development build is a Vercel
// Preview deploy (staging) or a local build with VITE_DEV_MODE=true: the same test as App.svelte's DEV_MODE,
// so the label shows exactly where the Debug tab does and never on the production build.
export const IS_DEV_BUILD: boolean = import.meta.env.VITE_DEV_MODE === "true" || __IS_PREVIEW_BUILD__;

// "0.14.0 (development build)" on staging and local dev; the plain version on production.
export function versionLabel(version: string, devBuild: boolean): string {
  return devBuild ? `${version} (development build)` : version;
}
