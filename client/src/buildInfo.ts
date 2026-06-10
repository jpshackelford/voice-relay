/**
 * Build metadata injected at compile time via Vite `define`.
 *
 * Set by `client/vite.config.ts`:
 *   - `__BUILD_SHA__`  -> `process.env.BUILD_SHA  || 'dev'`
 *   - `__BUILD_TIME__` -> `process.env.BUILD_TIME || ISO timestamp at config eval`
 *
 * Deploy passes `BUILD_SHA=$(git rev-parse --short HEAD)` /
 * `BUILD_TIME=$(date -u …)` before `npm run build` so the running
 * bundle carries the exact commit it was built from. We surface
 * `buildSha` in every `reportClientError` payload's context and in
 * a tiny on-screen tag — that way "is the iPhone running the latest
 * bundle?" is answerable from a single server log line.
 */

// These two are replaced as string literals by Vite at build time.
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

export const BUILD_SHA: string =
  typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev';
