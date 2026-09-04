/**
 * Seed the `assumptions` table from docs/assumptions.csv.
 *
 * Idempotent: upserts on key, so re-running after editing the CSV updates the
 * table in place. Run with `pnpm db:seed`.
 *
 * Rows already in the table but absent from the CSV are reported and left
 * alone — dropping a key silently would take a lever out of the engine's reach,
 * and the engine would only fail later, at score time.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import {
  buildAssumptions,
  placeholderKeys,
  validateAssumptions,
} from "@/lib/scoring";

import { getDb } from "./client";
import { parseCsvRecords } from "./csv";
import { assumptions as assumptionsTable } from "./schema";

const CSV_PATH = path.join(process.cwd(), "docs", "assumptions.csv");

export interface SeedRow {
  key: string;
  value: string | null;
  source: string | null;
  asof: string | null;
}

/** Parse the CSV text into rows ready for insert. Exported for tests. */
export function readAssumptionsCsv(text: string): SeedRow[] {
  const records = parseCsvRecords(text);
  const seen = new Set<string>();

  return records.flatMap((record) => {
    const key = (record.key ?? "").trim();
    if (key === "") return [];
    if (seen.has(key)) {
      throw new Error(`assumptions.csv: duplicate key "${key}"`);
    }
    seen.add(key);

    return [
      {
        key,
        // A blank value is meaningful: it marks a lever that is defined but not
        // yet set (cost.escalation.annual). Keep it null rather than "".
        value: blankToNull(record.value),
        source: blankToNull(record.source),
        asof: blankToNull(record.asof),
      },
    ];
  });
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export async function seedAssumptions(): Promise<void> {
  const text = await readFile(CSV_PATH, "utf8");
  const rows = readAssumptionsCsv(text);

  if (rows.length === 0) {
    throw new Error(`assumptions.csv at ${CSV_PATH} produced no rows`);
  }

  // Fail before touching the database if the CSV cannot produce a usable
  // engine configuration.
  const parsed = buildAssumptions(rows);
  const problems = validateAssumptions(parsed);
  for (const problem of problems) {
    console.warn(`  warning: ${problem}`);
  }

  const db = getDb();

  const existing = await db
    .select({ key: assumptionsTable.key })
    .from(assumptionsTable);
  const incoming = new Set(rows.map((row) => row.key));
  const orphaned = existing
    .map((row) => row.key)
    .filter((key) => !incoming.has(key));

  await db
    .insert(assumptionsTable)
    .values(rows)
    .onConflictDoUpdate({
      target: assumptionsTable.key,
      set: {
        value: sql`excluded.value`,
        source: sql`excluded.source`,
        asof: sql`excluded.asof`,
      },
    });

  console.log(`seeded ${rows.length} assumption rows from ${CSV_PATH}`);
  console.log(`  ${parsed.criteria.length} criteria`);
  if (problems.length > 0) {
    console.log(`  ${problems.length} validation warning(s) above`);
  }

  const placeholders = placeholderKeys(parsed);
  if (placeholders.length > 0) {
    console.log(
      `  ${placeholders.length} placeholder value(s) — the engine refuses to ` +
        `compute with these: ${placeholders.join(", ")}`,
    );
  }
  if (orphaned.length > 0) {
    console.log(
      `  ${orphaned.length} key(s) in the table but not in the CSV, left in ` +
        `place: ${orphaned.join(", ")}`,
    );
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedAssumptions().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
