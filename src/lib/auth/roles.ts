/**
 * Roles. Build spec A3.
 *
 * Two roles: `admin` and `user`. Admin is a list of UPNs in `ADMIN_UPNS`;
 * everyone else who can sign in through the tenant is a `user`.
 */

import type { Session } from "next-auth";

export type Role = "admin" | "user";

export const ROLES = {
  admin: "admin",
  user: "user",
} as const satisfies Record<Role, Role>;

/** Comma-separated UPNs from `ADMIN_UPNS`, lowercased and trimmed. */
export function adminUpns(): string[] {
  return (process.env.ADMIN_UPNS ?? "")
    .split(",")
    .map((upn) => upn.trim().toLowerCase())
    .filter((upn) => upn !== "");
}

/** The role for a given UPN. Unknown or missing UPN is `user`. */
export function roleForUpn(upn: string | null | undefined): Role {
  if (!upn) return ROLES.user;
  return adminUpns().includes(upn.toLowerCase()) ? ROLES.admin : ROLES.user;
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(required: Role) {
    super(`Forbidden: this action requires the "${required}" role`);
    this.name = "AuthorizationError";
  }
}

/** Non-throwing check. */
export function hasRole(session: Session | null, required: Role): boolean {
  if (!session?.user) return false;
  if (required === ROLES.user) return true;
  return session.user.role === ROLES.admin;
}

/**
 * Throwing check, for the top of a route handler or server action.
 *
 * Every route that would return `cost_library` rows calls this first — those
 * rows never reach the client.
 */
export function requireRole(session: Session | null, required: Role): Session {
  if (!session?.user) throw new AuthorizationError(required);
  if (!hasRole(session, required)) throw new AuthorizationError(required);
  return session;
}
