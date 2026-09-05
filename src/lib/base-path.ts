/**
 * The app's Next.js basePath, in one place.
 *
 * Must stay in step with `basePath` in next.config.ts. Public asset URLs are
 * not rewritten by Next, so anything under /public has to be referenced
 * through `asset()` or it 404s behind the prefix.
 */
export const BASE_PATH = "/site-selector";

/** Absolute URL for a file in /public. */
export function asset(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
