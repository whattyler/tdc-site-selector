/**
 * Shared domain types for the scoring engine.
 *
 * Pure TypeScript. This module (and everything else under src/lib/scoring)
 * imports nothing from src/app or src/lib/db. It will become packages/scoring.
 */

/** The four scoring buckets on the Deal Screen tab. */
export type BucketKey = "real_estate" | "site" | "deal" | "toro";

/** Yes / Maybe / No. `null` means the criterion has not been answered yet. */
export type Answer = "yes" | "maybe" | "no" | null;

/**
 * A criterion is either answered by hand (17 of them) or computed from another
 * tab (demographics). Geography is `answered` — the app pre-fills it from drive
 * time, but the user can override it, so it still counts toward the 17.
 */
export type CriterionKind = "answered" | "computed";

/** Product type governing the demographic band and the land conventions. */
export type ProductType = "mixed_use" | "multifamily";

/**
 * `auto` defers to the retail-share-of-NOI test on the First Look tab.
 * Stored on the deal; resolved before scoring.
 */
export type ProductTypeSetting = ProductType | "auto";

/** Demographic band. `null` renders as the workbook's em-dash. */
export type DemographicBand = "GO" | "WATCH" | "NO-GO" | null;

/** Screen verdict, exactly the five strings the workbook can produce. */
export type Verdict = "GO" | "WATCH" | "NO-GO" | "INCOMPLETE" | "NOT SCORED";

/** Knockout check result. */
export type KnockoutResult = "PASS" | "FAIL";

/** Land test on the First Look tab. `null` renders as the workbook's em-dash. */
export type LandTest = "PASS" | "FAIL" | null;

/** The three built components. Pads are sold, not built, and are separate. */
export type ComponentKey = "retail" | "office" | "multifamily";

/** One row of the `assumptions` table. */
export interface AssumptionRow {
  key: string;
  value: string | null;
  source?: string | null;
  asof?: string | null;
}

/** Definition of one scored criterion, sourced entirely from `assumptions`. */
export interface CriterionDef {
  key: string;
  label: string;
  bucket: BucketKey;
  /** Weight in points. All criterion weights sum to 100. */
  weight: number;
  /** Knockout-flagged: a `no` here forces NO-GO. */
  ko: boolean;
  kind: CriterionKind;
  /** Display order, matching the Deal Screen tab. */
  order: number;
}
