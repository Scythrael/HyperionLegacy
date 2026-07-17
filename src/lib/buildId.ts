// buildId.ts -- pure resolution of the per-build id used by the update detector.
// Prefers Vercel's commit SHA (set on every deploy) so the id is meaningful;
// falls back to a timestamp for local/off-Vercel builds so it is NEVER empty
// (an empty id would make the client's "did the build change?" compare useless).
export function resolveBuildId(
  sha: string | undefined,
  now: number = Date.now(),
): string {
  return sha && sha.length > 0 ? sha : String(now);
}
