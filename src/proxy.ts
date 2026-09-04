/**
 * Auth gate. Build spec A3.
 *
 * Next 16 replaces `middleware.ts` with `proxy.ts`. Auth checks live here, on
 * the nodejs runtime, not in page components.
 *
 * Path note: with `basePath` set, `req.nextUrl.pathname` is normally delivered
 * without the prefix, but a request arriving through the hub's rewrite can
 * carry it. Both forms are tolerated below rather than assuming one.
 */

import { auth, AUTH_BASE_PATH } from "@/lib/auth";

const BASE_PATH = "/site-selector";
const SIGN_IN_PATH = `${AUTH_BASE_PATH}/signin`;

/** Path with the app's basePath removed, so comparisons are unambiguous. */
function normalize(pathname: string): string {
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(`${BASE_PATH}/`)) {
    return pathname.slice(BASE_PATH.length);
  }
  return pathname;
}

export default auth((req) => {
  const pathname = normalize(req.nextUrl.pathname);

  // NextAuth's own routes must stay reachable or sign-in can never complete.
  if (pathname.startsWith("/api/auth")) return;

  if (!req.auth) {
    const url = new URL(SIGN_IN_PATH, req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return Response.redirect(url);
  }
});

// Spec A3 sets `runtime: "nodejs"` here. Next 16 rejects any route segment
// config in a proxy file — proxy already always runs on the Node.js runtime,
// which is what that line was for.
export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
