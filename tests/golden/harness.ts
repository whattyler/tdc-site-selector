/**
 * Golden test harness.
 *
 * Loads every tests/golden/*.json case, runs the scoring engine against the
 * case's inputs, and asserts the engine reproduces the workbook's outputs.
 *
 * Assumptions come from docs/assumptions.csv rather than the database, so the
 * suite is pure and runs offline. That CSV is also what seeds the `assumptions`
 * table, so the two cannot drift.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsvRecords } from "@/lib/db/csv";
import {
  type Answer,
  type AssumptionRow,
  type Assumptions,
  buildAssumptions,
  type DemographicBand,
  evaluateDemographics,
  firstLook,
  type FirstLookResult,
  type KnockoutResult,
  type LandTest,
  type ProductType,
  type ProductTypeSetting,
  screenDeal,
  type ScreenResult,
  type Verdict,
} from "@/lib/scoring";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const ASSUMPTIONS_CSV = path.join(REPO_ROOT, "docs", "assumptions.csv");

// ---------------------------------------------------------------------------
// Case file shape
// ---------------------------------------------------------------------------

export interface GoldenCase {
  /** Human-readable case name, used as the test title. */
  name: string;
  /** What this case is meant to prove. */
  description?: string;
  /** Where the numbers came from — deal name, workbook file, date. */
  source?: string;
  /**
   * True while the case is still a stub. Pending cases are reported as skipped
   * rather than failing the suite.
   */
  pending?: boolean;
  /**
   * Absolute tolerance for numeric comparisons. Defaults to 1e-6. Raise it for
   * expectations copied off a rounded workbook display.
   */
  tolerance?: number;
  /** Product type governing the demographic band and the land conventions. */
  productType: ProductTypeSetting;
  /**
   * Per-case overrides applied on top of docs/assumptions.csv, as raw string
   * values exactly like a row of the assumptions table. Use this to pin a case
   * to the assumptions in force when the workbook was filled.
   */
  assumptionOverrides?: Record<string, string>;
  input: GoldenInput;
  expected: GoldenExpected;
}

export interface GoldenInput {
  demographics: { mu: number | null; mf: number | null };
  screen: {
    probability?: number;
    /** criterion key -> "yes" | "maybe" | "no" | null */
    answers: Record<string, Answer>;
  };
  firstLook: {
    components: Record<
      "retail" | "office" | "multifamily",
      { noi: number; costExLand: number }
    >;
    pads: { hotelKeys: number; townhomeLots: number; outparcels: number };
    askingPrice: number;
    /** Optional in a case file: a deal with no incentive simply omits it. */
    incentives?: number;
    acreage: number;
    sanity: {
      retailSf: number;
      officeSf: number;
      multifamilyUnits: number;
    };
    yocOverrides?: Partial<
      Record<"retail" | "office" | "multifamily", number>
    >;
  };
}

/**
 * Every field is optional. The harness asserts only what a case actually
 * states, so a case can be filled in stages — screen outputs first, First Look
 * outputs later — without failing on the parts not yet transcribed.
 */
export interface GoldenExpected {
  demographics?: {
    governingScore?: number | null;
    goThreshold?: number;
    nogoThreshold?: number;
    band?: DemographicBand;
  };
  screen?: {
    weightedScore?: number;
    answeredCount?: number;
    unknownCount?: number;
    unknownShare?: number;
    koPass?: KnockoutResult;
    knockedOutBy?: string[];
    demoBand?: DemographicBand;
    verdict?: Verdict;
    probability?: number;
    probabilityWeightedScore?: number;
    /** Per-criterion weighted scores, keyed by criterion key. */
    criterionScores?: Record<string, number>;
  };
  firstLook?: {
    totalNoi?: number;
    totalCostExLand?: number;
    incentives?: number;
    netCostExLand?: number;
    totalCostSupported?: number;
    blendedYoc?: number;
    yocOnCost?: number;
    yocGapBps?: number;
    padProceedsTotal?: number;
    landValueBeforeCarry?: number;
    maxLandPrice?: number;
    headroom?: number;
    headroomPctOfAsk?: number;
    maxLandPricePerAcre?: number;
    landTest?: LandTest;
    landAtTdcRates?: number;
    maxLandPriceVsTdcRates?: number;
    retailShareOfNoi?: number;
    productTypeTest?: ProductType | null;
    /** `[mfIndex][commIndex]`, matching the workbook's grid layout. */
    sensitivityCells?: number[][];
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Build the engine assumptions from docs/assumptions.csv. */
export function loadAssumptionsFromCsv(
  overrides?: Record<string, string>,
): Assumptions {
  const records = parseCsvRecords(readFileSync(ASSUMPTIONS_CSV, "utf8"));
  const rows: AssumptionRow[] = records
    .filter((record) => (record.key ?? "").trim() !== "")
    .map((record) => ({
      key: record.key.trim(),
      value: (record.value ?? "").trim() === "" ? null : record.value.trim(),
      source: record.source ?? null,
      asof: record.asof ?? null,
    }));

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      const existing = rows.find((row) => row.key === key);
      // The override replaces the source too, so overriding a placeholder with
      // the rate a workbook was actually filled at clears the placeholder.
      if (existing) {
        existing.value = value;
        existing.source = "golden case override";
      } else {
        rows.push({ key, value, source: "golden case override", asof: null });
      }
    }
  }

  return buildAssumptions(rows);
}

/** Every golden case file, sorted by filename. */
export function loadGoldenCases(): { file: string; testCase: GoldenCase }[] {
  return readdirSync(HERE)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = readFileSync(path.join(HERE, file), "utf8");
      let parsed: GoldenCase;
      try {
        parsed = JSON.parse(raw) as GoldenCase;
      } catch (error) {
        throw new Error(
          `${file} is not valid JSON: ${(error as Error).message}`,
        );
      }
      return { file, testCase: parsed };
    });
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface GoldenActual {
  demographics: ReturnType<typeof evaluateDemographics>;
  screen: ScreenResult;
  firstLook: FirstLookResult;
}

export function runGoldenCase(
  testCase: GoldenCase,
  assumptions: Assumptions,
): GoldenActual {
  const demographics = evaluateDemographics(
    testCase.input.demographics,
    testCase.productType,
    assumptions,
  );

  const screen = screenDeal(
    {
      answers: testCase.input.screen.answers,
      demographics: {
        governingScore: demographics.governingScore,
        band: demographics.band,
      },
      probability: testCase.input.screen.probability,
    },
    assumptions,
  );

  const result = firstLook(
    // A case file may omit `incentives`; most deals have none.
    { incentives: 0, ...testCase.input.firstLook },
    assumptions,
  );

  return { demographics, screen, firstLook: result };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface Mismatch {
  path: string;
  expected: unknown;
  actual: unknown;
}

const DEFAULT_TOLERANCE = 1e-6;

/**
 * Compare the stated expectations against the actual result, ignoring any
 * expectation the case did not state. Returns every mismatch rather than
 * throwing on the first, so one run shows the whole picture.
 */
export function compare(
  expected: unknown,
  actual: unknown,
  tolerance = DEFAULT_TOLERANCE,
  atPath = "",
): Mismatch[] {
  if (expected === undefined) return [];

  if (typeof expected === "number") {
    const ok = typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
    return ok ? [] : [{ path: atPath, expected, actual }];
  }

  if (expected === null || typeof expected !== "object") {
    return Object.is(expected, actual)
      ? []
      : [{ path: atPath, expected, actual }];
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [{ path: atPath, expected, actual }];
    if (expected.length !== actual.length) {
      return [
        {
          path: `${atPath}.length`,
          expected: expected.length,
          actual: actual.length,
        },
      ];
    }
    return expected.flatMap((item, index) =>
      compare(item, actual[index], tolerance, `${atPath}[${index}]`),
    );
  }

  if (actual === null || typeof actual !== "object") {
    return [{ path: atPath, expected, actual }];
  }

  const actualRecord = actual as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>).flatMap(
    ([key, value]) =>
      compare(
        value,
        actualRecord[key],
        tolerance,
        atPath === "" ? key : `${atPath}.${key}`,
      ),
  );
}

/** Flatten the engine output into the shape a case's `expected` block uses. */
export function toComparable(actual: GoldenActual) {
  const criterionScores: Record<string, number> = {};
  for (const row of actual.screen.rows) criterionScores[row.key] = row.score;

  return {
    demographics: {
      governingScore: actual.demographics.governingScore,
      goThreshold: actual.demographics.goThreshold,
      nogoThreshold: actual.demographics.nogoThreshold,
      band: actual.demographics.band,
    },
    screen: {
      weightedScore: actual.screen.weightedScore,
      answeredCount: actual.screen.answeredCount,
      unknownCount: actual.screen.unknownCount,
      unknownShare: actual.screen.unknownShare,
      koPass: actual.screen.koPass,
      knockedOutBy: actual.screen.knockedOutBy,
      demoBand: actual.screen.demoBand,
      verdict: actual.screen.verdict,
      probability: actual.screen.probability,
      probabilityWeightedScore: actual.screen.probabilityWeightedScore,
      criterionScores,
    },
    firstLook: {
      totalNoi: actual.firstLook.totalNoi,
      totalCostExLand: actual.firstLook.totalCostExLand,
      incentives: actual.firstLook.incentives,
      netCostExLand: actual.firstLook.netCostExLand,
      totalCostSupported: actual.firstLook.totalCostSupported,
      blendedYoc: actual.firstLook.blendedYoc,
      yocOnCost: actual.firstLook.yocOnCost,
      yocGapBps: actual.firstLook.yocGapBps,
      padProceedsTotal: actual.firstLook.padProceeds.total,
      landValueBeforeCarry: actual.firstLook.landValueBeforeCarry,
      maxLandPrice: actual.firstLook.maxLandPrice,
      headroom: actual.firstLook.headroom,
      headroomPctOfAsk: actual.firstLook.headroomPctOfAsk,
      maxLandPricePerAcre: actual.firstLook.maxLandPricePerAcre,
      landTest: actual.firstLook.landTest,
      landAtTdcRates: actual.firstLook.landAtTdcRates,
      maxLandPriceVsTdcRates: actual.firstLook.maxLandPriceVsTdcRates,
      retailShareOfNoi: actual.firstLook.retailShareOfNoi,
      productTypeTest: actual.firstLook.productTypeTest,
      sensitivityCells: actual.firstLook.sensitivity.cells,
    },
  };
}

export function formatMismatches(mismatches: readonly Mismatch[]): string {
  return mismatches
    .map(
      (mismatch) =>
        `  ${mismatch.path}: expected ${JSON.stringify(mismatch.expected)}, ` +
        `got ${JSON.stringify(mismatch.actual)}`,
    )
    .join("\n");
}
