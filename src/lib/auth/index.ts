/**
 * packages/auth in waiting. Build spec A3.
 */

export {
  AUTH_BASE_PATH,
  auth,
  authOptions,
  handlers,
  signIn,
  signOut,
} from "./options";

export {
  adminUpns,
  AuthorizationError,
  hasRole,
  requireRole,
  type Role,
  roleForUpn,
  ROLES,
} from "./roles";
