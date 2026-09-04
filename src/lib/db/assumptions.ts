/**
 * Bridge from the `assumptions` table to the scoring engine's typed
 * `Assumptions` object.
 *
 * This direction only: db may import scoring, scoring never imports db.
 */

import { buildAssumptions, type Assumptions } from "@/lib/scoring";
import type { AssumptionRow } from "@/lib/scoring";

import { getDb } from "./client";
import { assumptions as assumptionsTable } from "./schema";

/** Read every assumption row and build the typed object. Server-side only. */
export async function loadAssumptions(): Promise<Assumptions> {
  const rows = await getDb()
    .select({
      key: assumptionsTable.key,
      value: assumptionsTable.value,
      source: assumptionsTable.source,
      asof: assumptionsTable.asof,
    })
    .from(assumptionsTable);

  return buildAssumptions(rows satisfies AssumptionRow[]);
}
