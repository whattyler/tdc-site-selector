/**
 * Neon client. Will become packages/db.
 *
 * The HTTP driver is the right one here: every query in this app is a short,
 * independent read or write from a serverless function. No transactions across
 * requests, no connection pooling to manage.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. It is injected by the Neon integration in " +
        "Vercel, and pulled into .env.local with `vercel env pull` locally.",
    );
  }
  return url;
}

/**
 * Lazily constructed so importing this module never throws at build time in an
 * environment without a database URL.
 */
let cached: ReturnType<typeof create> | undefined;

function create() {
  return drizzle(neon(connectionString()), { schema });
}

export function getDb() {
  cached ??= create();
  return cached;
}

export type Database = ReturnType<typeof getDb>;

export { schema };
