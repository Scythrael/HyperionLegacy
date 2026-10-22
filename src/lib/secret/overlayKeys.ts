// overlayKeys.ts: the keyboard rules of the secret game overlay (0.13.11), kept pure so they are
// unit tested (this repo has no Svelte component harness).

// The tab a key moves to in a horizontal tablist (WAI-ARIA tabs pattern): Left and Right wrap,
// Home and End jump to the ends. Any other key: null (not a tab key).
export function tabKeyTarget(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// The overlay is always the top layer while open, so Escape closes it even when focus has somehow
// landed outside it. A key some other handler already used (defaultPrevented) is left alone.
export function overlayClosesOn(event: { key: string; defaultPrevented: boolean }): boolean {
  return event.key === "Escape" && !event.defaultPrevented;
}
