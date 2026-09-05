/**
 * Where the app gets its assumptions at request time. Server-side only.
 *
 * Reads the `assumptions` table when a database is configured, and falls back
 * to docs/assumptions.csv otherwise — that CSV is the seed source, so the two
 * cannot disagree. The fallback is what makes `pnpm dev` work before Neon is
 * provisioned; it is not a place to put different numbers.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseCsvRecords } from "@/lib/db/csv";
import { buildAssumptions, type Assumptions } from "@/lib/scoring";
import type { AssumptionRow } from "@/lib/scoring";

const CSV_PATH = path.join(process.cwd(), "docs", "assumptions.csv");

export type AssumptionsOrigin = "database" | "docs/assumptions.csv";

export interface LoadedAssumptions {
  assumptions: Assumptions;
  origin: AssumptionsOrigin;
}

export async function loadAssumptionsForRequest(): Promise<LoadedAssumptions> {
  if (process.env.DATABASE_URL) {
    const { loadAssumptions } = await import("@/lib/db/assumptions");
    return { assumptions: await loadAssumptions(), origin: "database" };
  }

  const text = await readFile(CSV_PATH, "utf8");
  const rows: AssumptionRow[] = parseCsvRecords(text)
    .filter((record) => (record.key ?? "").trim() !== "")
    .map((record) => ({
      key: record.key.trim(),
      value: (record.value ?? "").trim() === "" ? null : record.value.trim(),
      source: record.source ?? null,
      asof: record.asof ?? null,
    }));

  return {
    assumptions: buildAssumptions(rows),
    origin: "docs/assumptions.csv",
  };
}
