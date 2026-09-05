/**
 * Seed the `cost_library` table from docs/cost_library.csv.
 *
 * The CSV carries line_key, label, basis, both source rates with their as-of
 * dates, and Tyler's notes. It does **not** carry two things the resolver
 * needs, and both are judgement calls recorded here rather than invented at
 * runtime:
 *
 *   `category`   — which subtotal a line rolls into (hard / soft / other).
 *                  Not derivable from basis: a&e design is a soft cost billed
 *                  as a percentage of hard.
 *   `appliesTo`  — what a percentage is a percentage *of*. Without it a
 *                  mixed-use deal applies both its residential GC fee (12.7%)
 *                  and its commercial one (13.2%) to the whole hard base and
 *                  double counts fees at ~26%.
 *
 * Both are stored on the row so the admin editor can correct them without a
 * deploy.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import type { CostAppliesTo, CostBasis, CostCategory } from "@/lib/scoring";

import { getDb } from "./client";
import { parseCsvRecords } from "./csv";
import { costLibrary } from "./schema";

const CSV_PATH = path.join(process.cwd(), "docs", "cost_library.csv");

/**
 * Which subtotal each line rolls into.
 *
 * Tenant improvement allowances sit in hard: they are construction dollars,
 * whoever writes the cheque. Leasing commissions are soft. Financing and
 * carry-cost-of-ownership during construction are neither, so they are `other`
 * — which also keeps them visible rather than buried in soft.
 */
const CATEGORY: Record<string, CostCategory> = {
  resi_shell: "hard",
  resi_interiors: "hard",
  resi_mep: "hard",
  resi_gc_fee_gcs: "hard",
  resi_sitework: "hard",
  resi_ffe: "hard",
  retail_shell: "hard",
  retail_ti_allowance: "hard",
  retail_leasing_commissions: "soft",
  office_shell: "hard",
  office_ti_allowance: "hard",
  parking_structured: "hard",
  parking_surface: "hard",
  sitework_utilities: "hard",
  offsite_utilities: "hard",
  hardscape_landscape_placemaking: "hard",
  gc_fee_gcs: "hard",
  hard_contingency: "hard",
  ae_design: "soft",
  permits_impact_fees: "soft",
  dev_fee: "soft",
  legal_title_closing: "soft",
  marketing_leaseup: "soft",
  financing_carry: "other",
  taxes_insurance_construction: "other",
  soft_contingency: "soft",
};

/**
 * What each percentage line applies to. Taken from the CSV notes:
 *   resi_gc_fee_gcs  "Applied to resi shell+interiors+MEP+resi sitework"
 *   gc_fee_gcs       "over buildings+sitework+landscape" — the commercial GMP
 *   hard_contingency "over $286M hard" — the whole hard cost, fees included
 *   ae_design        "over $286M hard"
 *   soft_contingency "5% of soft"
 *   dev_fee          "over $433.6M gross"
 *   financing_carry  "over $433.6M gross"
 *   taxes_insurance  "over $433.6M"
 */
const APPLIES_TO: Record<string, CostAppliesTo> = {
  resi_gc_fee_gcs: "resi_hard",
  gc_fee_gcs: "commercial_hard",
  hard_contingency: "hard",
  ae_design: "hard",
  soft_contingency: "soft",
  dev_fee: "total",
  financing_carry: "total",
  taxes_insurance_construction: "total",
};

const VALID_BASES = new Set<CostBasis>([
  "per_resi_gsf",
  "per_retail_sf",
  "per_office_sf",
  "per_space",
  "per_unit",
  "per_acre",
  "pct_hard",
  "pct_soft",
  "pct_total",
  "lump",
]);

export interface CostLibrarySeedRow {
  lineKey: string;
  label: string;
  basis: CostBasis;
  category: CostCategory;
  appliesTo: CostAppliesTo | null;
  sortOrder: number;
  medleyRate: number | null;
  medleyAsof: string | null;
  cccRate: number | null;
  cccAsof: string | null;
  notes: string | null;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function rate(value: string | undefined, lineKey: string, column: string): number | null {
  const raw = blankToNull(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`cost_library.csv: ${lineKey} has a non-numeric ${column} "${raw}"`);
  }
  return parsed;
}

/** Parse the CSV into rows ready for insert. Exported for tests. */
export function readCostLibraryCsv(text: string): CostLibrarySeedRow[] {
  const records = parseCsvRecords(text);
  const seen = new Set<string>();

  return records.flatMap((record, index) => {
    const lineKey = (record.line_key ?? "").trim();
    if (lineKey === "") return [];
    if (seen.has(lineKey)) {
      throw new Error(`cost_library.csv: duplicate line_key "${lineKey}"`);
    }
    seen.add(lineKey);

    const basis = (record.basis ?? "").trim() as CostBasis;
    if (!VALID_BASES.has(basis)) {
      throw new Error(`cost_library.csv: ${lineKey} has unknown basis "${basis}"`);
    }

    const category = CATEGORY[lineKey];
    if (!category) {
      throw new Error(
        `cost_library.csv: ${lineKey} has no category mapping. Add it to CATEGORY ` +
          `in cost-library-seed.ts — a line with no subtotal cannot be totalled.`,
      );
    }

    const appliesTo = APPLIES_TO[lineKey] ?? null;
    if (basis.startsWith("pct_") && appliesTo === null) {
      throw new Error(
        `cost_library.csv: ${lineKey} is a ${basis} line with no APPLIES_TO ` +
          `mapping. A percentage of nothing is not a cost.`,
      );
    }

    return [
      {
        lineKey,
        label: (record.label ?? "").trim(),
        basis,
        category,
        appliesTo,
        // CSV order is the display order; Tyler grouped it deliberately.
        sortOrder: (index + 1) * 10,
        medleyRate: rate(record.medley_rate, lineKey, "medley_rate"),
        medleyAsof: blankToNull(record.medley_asof),
        cccRate: rate(record.ccc_rate, lineKey, "ccc_rate"),
        cccAsof: blankToNull(record.ccc_asof),
        notes: blankToNull(record.notes),
      },
    ];
  });
}

export async function seedCostLibrary(): Promise<void> {
  const rows = readCostLibraryCsv(await readFile(CSV_PATH, "utf8"));
  if (rows.length === 0) {
    throw new Error(`cost_library.csv at ${CSV_PATH} produced no rows`);
  }

  await getDb()
    .insert(costLibrary)
    .values(rows)
    .onConflictDoUpdate({
      target: costLibrary.lineKey,
      set: {
        label: sql`excluded.label`,
        basis: sql`excluded.basis`,
        category: sql`excluded.category`,
        appliesTo: sql`excluded.applies_to`,
        sortOrder: sql`excluded.sort_order`,
        medleyRate: sql`excluded.medley_rate`,
        medleyAsof: sql`excluded.medley_asof`,
        cccRate: sql`excluded.ccc_rate`,
        cccAsof: sql`excluded.ccc_asof`,
        notes: sql`excluded.notes`,
      },
    });

  const placeholders = rows.filter((r) => r.medleyRate === null && r.cccRate === null);
  console.log(`seeded ${rows.length} cost library lines from ${CSV_PATH}`);
  console.log(
    `  ${rows.filter((r) => r.category === "hard").length} hard, ` +
      `${rows.filter((r) => r.category === "soft").length} soft, ` +
      `${rows.filter((r) => r.category === "other").length} other`,
  );
  if (placeholders.length > 0) {
    console.log(
      `  ${placeholders.length} line(s) with no rate on either source — these ` +
        `throw if the program gives them a quantity: ` +
        placeholders.map((r) => r.lineKey).join(", "),
    );
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedCostLibrary().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
