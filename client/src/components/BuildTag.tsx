import { BUILD_SHA, BUILD_TIME } from '../buildInfo';

/**
 * Tiny fixed-position build identifier shown in the bottom-right of
 * every page. Lets us eyeball whether a given device (especially
 * iOS Safari, which caches aggressively) is on the latest deployed
 * bundle without needing to dig through `[ClientError]` logs.
 *
 * Hidden when the build tag is `'dev'` so local development doesn't
 * get a stale-looking overlay.
 */
export function BuildTag() {
  if (BUILD_SHA === 'dev') return null;
  return (
    <div
      className="build-tag"
      title={`Built ${BUILD_TIME}`}
      aria-label={`Build ${BUILD_SHA}`}
    >
      {BUILD_SHA}
    </div>
  );
}
