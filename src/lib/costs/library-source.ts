/**
 * Where the cost library comes from at request time. Server-only.
 *
 * Reads the `cost_library` table when a database is configured, and falls back
 * to docs/cost_library.csv otherwise — the same arrangement as assumptions, and
 * for the same reason: the CSV is what seeds the table, so the two cannot
 * disagree.
 *
 * Library rows never leave the server. Anything that returns them to a client
 * checks `requireRole("admin")` first.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { readCostLibraryCsv } from "@/lib/db/cost-library-seed";
import type { CostLibraryLine } from "@/lib/scoring";

const CSV_PATH = path.join(process.cwd(), "docs", "cost_library.csv");

export type CostLibraryOrigin = "database" | "docs/cost_library.csv";

export interface LoadedCostLibrary {
  library: CostLibraryLine[];
  origin: CostLibraryOrigin;
}

export async function loadCostLibrary(): Promise<LoadedCostLibrary> {
  if (process.env.DATABASE_URL) {
    const { getDb } = await import("@/lib/db/client");
    const { costLibrary } = await import("@/lib/db/schema");
    let rows = await getDb().select().from(costLibrary);

    // First run against a fresh database, same as assumptions.
    if (rows.length === 0) {
      const { seedCostLibrary } = await import("@/lib/db/cost-library-seed");
      await seedCostLibrary();
      rows = await getDb().select().from(costLibrary);
    }

    return {
      library: rows.map((row) => ({
        lineKey: row.lineKey,
        label: row.label,
        basis: row.basis,
        category: row.category,
        appliesTo: row.appliesTo,
        sortOrder: row.sortOrder,
        medleyRate: row.medleyRate,
        medleyAsof: row.medleyAsof,
        cccRate: row.cccRate,
        cccAsof: row.cccAsof,
        notes: row.notes,
      })),
      origin: "database",
    };
  }

  const rows = readCostLibraryCsv(await readFile(CSV_PATH, "utf8"));
  return { library: rows, origin: "docs/cost_library.csv" };
}
