/**
 * NextAuth v5 with Microsoft Entra ID. Build spec A3.
 *
 * Tenant-restricted: `AUTH_MICROSOFT_ENTRA_ID_ISSUER` carries the directory
 * (tenant) ID, so tokens minted by any other tenant fail issuer validation.
 * The `signIn` callback re-checks the `tid` claim so a misconfigured issuer
 * (for example the `common` endpoint) cannot quietly open the app to every
 * Microsoft account.
 *
 * Will become packages/auth.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { roleForUpn, type Role } from "./roles";

/**
 * The sign-in URL as a browser sees it, basePath included. Used by proxy.ts to
 * build the redirect, and by anything else pointing a user at sign-in.
 */
export const AUTH_BASE_PATH = "/site-selector/api/auth";

/**
 * The app's Next.js basePath. The auth route handler puts this back on the
 * request before NextAuth sees it — see that file for why.
 */
export const NEXT_BASE_PATH = "/site-selector";

/** Tenant ID parsed out of the issuer URL, when it is a specific tenant. */
function expectedTenantId(): string | null {
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  if (!issuer) return null;
  const match = issuer.match(
    /login\.microsoftonline\.com\/([0-9a-f-]{36}|[^/]+)\/v2\.0/i,
  );
  const tenant = match?.[1];
  if (!tenant || tenant.toLowerCase() === "common") return null;
  return tenant.toLowerCase();
}

export const authOptions: NextAuthConfig = {
  basePath: AUTH_BASE_PATH,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ profile }) {
      const tenant = expectedTenantId();
      if (tenant === null) return true;
      const tid =
        typeof profile?.tid === "string" ? profile.tid.toLowerCase() : null;
      return tid === tenant;
    },

    jwt({ token, profile }) {
      // `profile` is present only on the sign-in pass; persist what the session
      // needs so later requests do not have to hit Entra again.
      if (profile) {
        const upn =
          (typeof profile.upn === "string" ? profile.upn : null) ??
          (typeof profile.preferred_username === "string"
            ? profile.preferred_username
            : null) ??
          (typeof profile.email === "string" ? profile.email : null);
        token.upn = upn;
        token.role = roleForUpn(upn);
      }
      return token;
    },

    session({ session, token }) {
      session.user.upn = typeof token.upn === "string" ? token.upn : null;
      // Recompute rather than trusting the token: removing a UPN from
      // ADMIN_UPNS should take effect on the next request, not on next sign-in.
      session.user.role = roleForUpn(
        typeof token.upn === "string" ? token.upn : null,
      );
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

declare module "next-auth" {
  interface Session {
    user: {
      role: Role;
      upn: string | null;
    } & DefaultSessionUser;
  }
}

type DefaultSessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};
