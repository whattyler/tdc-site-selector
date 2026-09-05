/**
 * IRS SOI county migration signal.
 *
 * Ported from the dashboard's `src/lib/migration-data.js` with the formula from
 * its `extractRaw()`. The table is a hand-curated 29-county subset, not the
 * full IRS file — a county outside it has no signal, and this returns null
 * rather than the dashboard's 0.5 default. See docs/demographics-port-report.md.
 */

import table from "./migration-data.json";

export interface MigrationRecord {
  county: string;
  inflows: number;
  outflows: number;
  agiIn: number;
  agiOut: number;
}

const COUNTIES = table.counties as Record<string, MigrationRecord>;

export const MIGRATION_SOURCE = `${table.source}, ${table.filingYear} filing year`;

/** Look up by 5-character `SSCCC` FIPS. */
export function migrationRecord(fips: string): MigrationRecord | null {
  return COUNTIES[fips] ?? null;
}

/**
 * Migration signal, 0..1, or null when the county is not in the table.
 *
 * Dashboard formula, unchanged:
 *   `0.5 + netRate * 2 + (agiRatio - 1) * 0.5`, clamped to [0, 1]
 * where `netRate = (in - out) / max(out, 1)` and `agiRatio = agiIn / max(agiOut, 1)`.
 *
 * 0.5 is the neutral midpoint for a county that is in the table and simply
 * breaking even. It is never used to stand in for a county we have no data for
 * — that case returns null and the caller flags it.
 */
export function migrationSignal(fips: string): number | null {
  const record = migrationRecord(fips);
  if (!record) return null;

  const net = record.inflows - record.outflows;
  const netRate = net / Math.max(record.outflows, 1);
  const agiRatio = record.agiIn / Math.max(record.agiOut, 1);

  const raw = 0.5 + netRate * 2 + (agiRatio - 1) * 0.5;
  return Math.min(1, Math.max(0, raw));
}

/** Every county in the table, for coverage reporting. */
export function migrationCoverage(): string[] {
  return Object.keys(COUNTIES).sort();
}
