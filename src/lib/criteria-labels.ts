/**
 * Display names for the Deal Screen. Shared by the page and the PDF.
 *
 * Lives outside the client component so the report cannot label a row
 * differently from the screen it was generated off.
 */

import type { BucketKey } from "@/lib/scoring";

/**
 * Bucket names verbatim from John's filter (Deal Screen!B14, B19, B24, B32).
 * Display only — the weights behind them live in `assumptions`.
 */
export const BUCKET_LABELS: Record<BucketKey, string> = {
  real_estate: "Real Estate Considerations",
  site: "Site Considerations",
  deal: "Deal Considerations",
  toro: "Toro Considerations",
};

export const BUCKET_ORDER: BucketKey[] = ["real_estate", "site", "deal", "toro"];

/**
 * Answer labels per criterion, in [yes, maybe, no] order.
 *
 * Presentation only. The control still sends yes / maybe / no and the engine
 * still scores 3 / 1 / 0 — these just put the question in the language the
 * criterion is actually asked in. A criterion missing from this map falls back
 * to Yes / Maybe / No.
 *
 * Barriers to Entry is the one to read carefully: John's prompt is "can this be
 * replicated a mile away within 24 months?", where a plain Yes means replicable,
 * which is the bad answer but scores 3. High / Some / None re-anchors the
 * control to the criterion name so the row cannot be answered backwards.
 */
export const ANSWER_LABELS: Record<string, readonly [string, string, string]> = {
  // Not drive-time bands: nothing computes minutes any more, and the
  // geography.band assumptions that backed those numbers were removed with the
  // Distance Matrix. This is the platform-reach judgement B0 actually asks for.
  geography: ["In market", "Edge", "Outside"],
  market: ["Strong", "Mixed", "Weak"],
  location: ["Prime", "Adequate", "Poor"],
  barriers_to_entry: ["High", "Some", "None"],
  entitlements: ["In place", "Achievable", "At risk"],
  competition: ["Light", "Moderate", "Heavy"],
  physical: ["Clean", "Manageable", "Problem"],
  seller_sophistication: ["Sophisticated", "Mixed", "Unsophisticated"],
  control: ["Full", "Partial", "Thin"],
  market_viability: ["All clear", "Some risk", "One fails"],
  partner_quality: ["Strong", "Unproven", "None"],
  pursuit_costs: ["Low", "Normal", "High"],
  timing: ["Good window", "Tight", "Wrong window"],
  brand_fit: ["On brand", "Adjacent", "Off brand"],
  capability: ["Proven", "Stretch", "New to us"],
  capacity: ["Available", "Tight", "None"],
  fee_potential: ["Strong", "Modest", "Thin"],
};
