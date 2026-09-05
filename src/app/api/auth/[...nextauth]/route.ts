import { NextRequest } from "next/server";

import { handlers, NEXT_BASE_PATH } from "@/lib/auth";

/**
 * NextAuth, with the app's basePath put back on the request.
 *
 * Next strips `/site-selector` before a route handler runs, so NextAuth is
 * handed "/api/auth/signin". It uses that path for two different jobs: parsing
 * which action was requested, and building the sign-in and callback URLs it
 * hands to Entra. Configure it for one and the other breaks — a basePath of
 * "/site-selector/api/auth" makes every request an `UnknownAction` 400, while
 * "/api/auth" renders the page but emits a callback URL of
 * `/api/auth/callback/microsoft-entra-id`, which 404s here and does not match
 * the redirect URI registered on the Entra app.
 *
 * Restoring the prefix lets NextAuth see the same URL the browser used, so
 * both jobs agree and `basePath` can stay the real, public one.
 */
async function withBasePath(request: NextRequest): Promise<NextRequest> {
  const url = new URL(request.url);
  if (url.pathname.startsWith(`${NEXT_BASE_PATH}/`)) return request;

  url.pathname = `${NEXT_BASE_PATH}${url.pathname}`;

  // Typed from NextRequest's own constructor rather than the DOM RequestInit,
  // whose nullable `signal` is not assignable to it.
  const init: ConstructorParameters<typeof NextRequest>[1] = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
  };
  // Read the body eagerly rather than piping it: a stream body would need
  // `duplex: "half"`, and the auth POSTs are small form posts.
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  // NextAuth's handlers are typed for NextRequest, which carries `cookies`
  // and `nextUrl` on top of Request; rebuild as one rather than casting.
  return new NextRequest(url, init);
}

export async function GET(request: NextRequest) {
  return handlers.GET(await withBasePath(request));
}

export async function POST(request: NextRequest) {
  return handlers.POST(await withBasePath(request));
}

export const runtime = "nodejs";
