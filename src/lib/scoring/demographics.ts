/**
 * Demographics tab.
 *
 * The dashboard returns two scores per site: a Mixed-Use score and a
 * Multifamily score. The deal's product type picks which one governs, and the
 * governing score falls into a GO / WATCH / NO-GO band.
 *
 * Workbook reference — Demographics!C14:C17.
 */

import type { Assumptions } from "./assumptions";
import type { DemographicBand, ProductType, ProductTypeSetting } from "./types";

export interface DemographicScores {
  /** Mixed-Use score from the dashboard, 0-100. Null when not yet pulled. */
  mu: number | null;
  /** Multifamily score from the dashboard, 0-100. Null when not yet pulled. */
  mf: number | null;
}

export interface DemographicsResult {
  /** The score the product type selects, or null when either is missing. */
  governingScore: number | null;
  /** Threshold at or above which the band is GO. */
  goThreshold: number;
  /** Threshold at or below which the band is NO-GO. */
  nogoThreshold: number;
  band: DemographicBand;
}

/**
 * Which of the two dashboard scores governs.
 *
 * Workbook: `=IF(C13="Mixed-Use",C9,IF(C13="Multifamily",C10,""))`. A product
 * type that is neither yields no governing score, and therefore no band.
 */
export function governingScore(
  scores: DemographicScores,
  productType: ProductTypeSetting,
): number | null {
  if (productType === "mixed_use") return scores.mu;
  if (productType === "multifamily") return scores.mf;
  return null;
}

/**
 * Band the governing score.
 *
 * Workbook: `=IF(C14="","—",IF(C14>=C15,"GO",IF(C14<=C16,"NO-GO","WATCH")))`.
 * GO is inclusive at the top threshold, NO-GO inclusive at the bottom, WATCH is
 * the open interval between them.
 */
export function band(
  score: number | null,
  productType: ProductTypeSetting,
  assumptions: Assumptions,
): DemographicBand {
  if (score === null || !isResolved(productType)) return null;
  const thresholds = assumptions.demoBands[productType];
  if (score >= thresholds.go) return "GO";
  if (score <= thresholds.nogo) return "NO-GO";
  return "WATCH";
}

/** Governing score plus its thresholds and band, in one pass. */
export function evaluateDemographics(
  scores: DemographicScores,
  productType: ProductTypeSetting,
  assumptions: Assumptions,
): DemographicsResult {
  // Thresholds default to the Mixed-Use pair, matching the workbook's
  // `IF(C13="Multifamily", <mf>, <mu>)` which treats anything not Multifamily
  // as Mixed-Use for threshold display purposes.
  const thresholds =
    productType === "multifamily"
      ? assumptions.demoBands.multifamily
      : assumptions.demoBands.mixed_use;
  const score = governingScore(scores, productType);
  return {
    governingScore: score,
    goThreshold: thresholds.go,
    nogoThreshold: thresholds.nogo,
    band: band(score, productType, assumptions),
  };
}

function isResolved(productType: ProductTypeSetting): productType is ProductType {
  return productType === "mixed_use" || productType === "multifamily";
}
