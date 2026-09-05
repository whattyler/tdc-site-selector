/**
 * Census results, cached in the `demographics_cache` table. Spec A4, Phase 8.
 *
 * Replaces the per-instance Map this used to be. A serverless deploy runs many
 * instances and recycles them freely, so an in-memory memo mostly missed —
 * every cold start paid the full Census round trip again, and two people
 * screening the same site never shared a result.
 *
 * With no database configured the whole thing degrades to a miss, which is
 * correct rather than fatal: the route just fetches.
 */

import { and, eq } from "drizzle-orm";

import { getDb } from "./client";
import { demographicsCache } from "./schema";

/** A day. The ACS does not move; this is about picking up scoring fixes. */
const TTL_MS = 24 * 60 * 60 * 1000;

export interface CacheKey {
  geohash7: string;
  radiusMi: number;
  /** ACS vintage plus scoring revision, so either change invalidates. */
  version: string;
}

export async function readCache<T>(key: CacheKey): Promise<T | null> {
  if (!process.env.DATABASE_URL) return null;

  try {
    const rows = await getDb()
      .select({
        payload: demographicsCache.payload,
        fetchedAt: demographicsCache.fetchedAt,
      })
      .from(demographicsCache)
      .where(
        and(
          eq(demographicsCache.geohash7, key.geohash7),
          eq(demographicsCache.radiusMi, key.radiusMi),
          eq(demographicsCache.version, key.version),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (Date.now() - row.fetchedAt.getTime() > TTL_MS) return null;
    return row.payload as T;
  } catch {
    // A cache that cannot be read is a miss, never an error. The caller has a
    // perfectly good way to get the answer.
    return null;
  }
}

export async function writeCache(key: CacheKey, payload: unknown): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  try {
    await getDb()
      .insert(demographicsCache)
      .values({
        geohash7: key.geohash7,
        radiusMi: key.radiusMi,
        version: key.version,
        payload,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          demographicsCache.geohash7,
          demographicsCache.radiusMi,
          demographicsCache.version,
        ],
        set: { payload, fetchedAt: new Date() },
      });
  } catch {
    // Same reasoning: failing to cache must not fail the request.
  }
}
