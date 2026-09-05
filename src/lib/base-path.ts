/**
 * The app's Next.js basePath, in one place.
 *
 * Must stay in step with `basePath` in next.config.ts.
 *
 * `asset()` is for URLs this app serves and Next does not rewrite for you:
 * `fetch()` to a route handler, and `href` on a plain anchor. Both are bare
 * strings as far as Next is concerned, so the prefix has to be explicit.
 *
 * It is NOT for files in /public. Those are served at the deployment root on
 * Vercel and under the basePath by `next dev`, so no single hardcoded string
 * is right in both — reference them with `next/image`, which prefixes its own
 * optimizer endpoint and leaves `src` alone, and let it resolve the
 * difference. `next/link` likewise adds the prefix itself; do not double it.
 */
export const BASE_PATH = "/site-selector";

/** Absolute URL for a route this app serves. Not for /public files. */
export function asset(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
