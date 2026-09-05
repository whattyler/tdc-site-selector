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
import type {
  DemographicBand,
  DemographicMetricKey,
  ProductType,
  ProductTypeSetting,
} from "./types";

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

// ===========================================================================
// MU / MF SCORING
//
// Ported from the demographics dashboard's src/lib/site-score.js (MU revised
// April 2026, MF reweighted May 2026). Normalizers, weights, gates and floors
// are reproduced exactly; see docs/demographics-port-report.md for the audit.
//
// Two deliberate departures from the source, both about honesty:
//   - No safeGate(). The dashboard turns a thrown error into "below all
//     floors", which renders as a legitimate NO-GO. Here a bad input throws
//     and the caller reports a failure.
//   - A missing migration county yields null, not 0.5. The dashboard
//     mid-scores an unknown; we score it 0 and flag it.
//
// Weights and floors come from `assumptions` (`demo.weight.*`, `demo.floor.*`)
// like every other lever, so a reweight is a data edit. The normalizer curves
// stay here — they are shapes, not numbers, and there is no sane CSV for them.
// ===========================================================================

/** Raw metric inputs, straight off the ACS aggregation. */
export interface DemographicMetrics {
  avgIncome: number | null;
  totalPop: number | null;
  educationPct: number | null;
  discretionary: number | null;
  /** Null when the county is absent from the IRS SOI table. */
  migrationSignal: number | null;
  hhFormation: number | null;
  youngAdultPct: number | null;
  rentToIncome: number | null;
  primeRenterPct: number | null;
}

/** Whether a metric's value breaches a gate floor on either profile. */
export type FloorStatus = "none" | "soft" | "hard";

export interface ScoredMetric {
  key: DemographicMetricKey;
  label: string;
  value: number | null;
  normalized: number;
  weightMu: number | null;
  weightMf: number | null;
  /** Worst breach across the profiles that gate on this metric. */
  floor: FloorStatus;
  flag?: string;
}

export interface ProfileScore {
  score: number;
  raw: number;
  belowSoft: number;
  belowHard: number;
  multiplier: number;
}

export interface DemographicScoreResult {
  mu: number;
  mf: number;
  muDetail: ProfileScore;
  mfDetail: ProfileScore;
  metrics: ScoredMetric[];
}


/**
 * Piecewise linear interpolation over checkpoints sorted ascending by x.
 * Below the first x yields 0; above the last, the last y. Used where a linear
 * value/cap model would reward mediocrity — $100k income should not earn half
 * the credit of $200k.
 */
function piecewise(value: number, points: readonly (readonly [number, number])[]): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= points[0][0]) return 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (value <= x1) {
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

function linearCap(value: number, cap: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(1, value / cap);
}

interface ComponentDef {
  label: string;
  extract: (m: DemographicMetrics) => number | null;
  normalize: (value: number) => number;
  flag?: string;
}

/**
 * The MU income curve returns 1.10 at $250k, so one component can exceed its
 * nominal weight. Ported as-is from the dashboard.
 */
const COMPONENTS: Record<DemographicMetricKey, ComponentDef> = {
  avgIncome: {
    label: "Average HH Income",
    extract: (m) => m.avgIncome,
    // MU and MF share the raw input but not the curve; the MU curve is the
    // stricter one and is used for the reported `normalized`.
    normalize: (v) =>
      piecewise(v, [
        [80_000, 0],
        [100_000, 0.1],
        [130_000, 0.4],
        [160_000, 0.85],
        [200_000, 1.0],
        [250_000, 1.1],
      ]),
  },
  totalPop: {
    label: "Total Population",
    extract: (m) => m.totalPop,
    normalize: (v) =>
      piecewise(v, [
        [15_000, 0],
        [25_000, 0.1],
        [45_000, 0.4],
        [70_000, 0.85],
        [100_000, 1.0],
      ]),
  },
  education: {
    label: "Bachelor's+",
    extract: (m) => m.educationPct,
    normalize: (v) =>
      piecewise(v, [
        [0.25, 0],
        [0.35, 0.1],
        [0.5, 0.4],
        [0.65, 0.85],
        [0.75, 1.0],
      ]),
  },
  discretionary: {
    label: "Discretionary Spend",
    extract: (m) => m.discretionary,
    normalize: (v) => linearCap(v, 90_000),
  },
  migration: {
    label: "Migration Signal",
    extract: (m) => m.migrationSignal,
    normalize: (v) => linearCap(v, 1.0),
  },
  hhFormation: {
    label: "HH Formation",
    extract: (m) => m.hhFormation,
    normalize: (v) => linearCap(v, 0.5),
    // households / population, so ~0.38 for any ordinary market against a cap
    // of 0.5. It contributes about 4 of its 5 points regardless of the site.
    flag: "near-saturated",
  },
  youngAdult: {
    label: "Young Adult Share",
    extract: (m) => m.youngAdultPct,
    normalize: (v) => linearCap(v, 0.4),
  },
  rentToIncome: {
    label: "Rent-to-Income",
    extract: (m) => m.rentToIncome,
    normalize: (v) => {
      if (v <= 0) return 0;
      if (v < 0.18) return 1;
      if (v > 0.35) return 0;
      return 1 - (v - 0.18) / (0.35 - 0.18);
    },
  },
  primeRenter: {
    label: "Prime Renter Age (30-44)",
    extract: (m) => m.primeRenterPct,
    normalize: (v) =>
      piecewise(v, [
        [0.1, 0],
        [0.15, 0.2],
        [0.2, 0.5],
        [0.25, 0.85],
        [0.3, 1.0],
      ]),
  },
};

/** MF uses a lower income and population bar than MU on the same raw inputs. */
const MF_CURVES: Partial<Record<DemographicMetricKey, (v: number) => number>> = {
  avgIncome: (v) =>
    piecewise(v, [
      [50_000, 0],
      [70_000, 0.3],
      [90_000, 0.5],
      [120_000, 0.75],
      [160_000, 1.0],
    ]),
  totalPop: (v) =>
    piecewise(v, [
      [15_000, 0],
      [30_000, 0.3],
      [80_000, 0.7],
      [150_000, 0.95],
      [200_000, 1.0],
    ]),
};

const GATE_MULTIPLIERS = [1.0, 0.85, 0.55, 0.3] as const;


function normalizeFor(
  key: DemographicMetricKey,
  profile: ProductType,
  value: number | null,
): number {
  if (value === null || !Number.isFinite(value)) return 0;
  const curve = profile === "multifamily" ? MF_CURVES[key] : undefined;
  return curve ? curve(value) : COMPONENTS[key].normalize(value);
}

function rawScore(
  metrics: DemographicMetrics,
  profile: ProductType,
  assumptions: Assumptions,
): number {
  let total = 0;
  for (const [key, weight] of Object.entries(
    assumptions.demo.weights[profile],
  ) as [DemographicMetricKey, number][]) {
    total += normalizeFor(key, profile, COMPONENTS[key].extract(metrics)) * weight;
  }
  return total;
}

function applyGate(
  raw: number,
  metrics: DemographicMetrics,
  profile: ProductType,
  assumptions: Assumptions,
): ProfileScore {
  let belowSoft = 0;
  let belowHard = 0;

  // The gate is exactly the set of metrics that carry floors for this profile:
  // MU's Big 3, MF's Big 2.
  for (const [key, floors] of Object.entries(
    assumptions.demo.floors[profile],
  ) as [DemographicMetricKey, { soft: number; hard: number }][]) {
    const value = COMPONENTS[key].extract(metrics);
    if (value === null || value < floors.soft) belowSoft++;
    if (value === null || value < floors.hard) belowHard++;
  }

  const multiplier = GATE_MULTIPLIERS[Math.min(belowSoft, 3)];
  let gated = raw * multiplier;
  if (belowHard > 0) gated = Math.min(gated, 35);

  return { score: gated, raw, belowSoft, belowHard, multiplier };
}

/** Worst floor breach across the profiles that gate on this metric. */
function floorStatus(
  key: DemographicMetricKey,
  metrics: DemographicMetrics,
  assumptions: Assumptions,
): FloorStatus {
  const value = COMPONENTS[key].extract(metrics);
  let status: FloorStatus = "none";
  for (const profile of ["mixed_use", "multifamily"] as const) {
    const f = assumptions.demo.floors[profile][key];
    if (!f) continue;
    if (value === null || value < f.hard) return "hard";
    if (value < f.soft) status = "soft";
  }
  return status;
}

export class DemographicScoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemographicScoreError";
  }
}

/**
 * Score a site's metrics into MU and MF.
 *
 * MU is anchored so Avalon scores 100: `muScale = 100 / demo.mu.anchor_raw`.
 * MF is absolute. Both clamp at 150, matching the dashboard.
 *
 * Throws rather than returning a low score when the anchor is unusable — a
 * broken anchor would silently rescale every deal in the pipeline.
 */
export function scoreDemographics(
  metrics: DemographicMetrics,
  assumptions: Assumptions,
): DemographicScoreResult {
  const anchor = assumptions.demo.muAnchorRaw;
  if (!Number.isFinite(anchor) || anchor <= 0) {
    throw new DemographicScoreError(
      `assumptions: demo.mu.anchor_raw must be a positive number (got ${anchor})`,
    );
  }

  const muRaw = rawScore(metrics, "mixed_use", assumptions);
  const muGate = applyGate(muRaw, metrics, "mixed_use", assumptions);
  const mu = Math.round(Math.min(150, muGate.score * (100 / anchor)));

  const mfRaw = rawScore(metrics, "multifamily", assumptions);
  const mfGate = applyGate(mfRaw, metrics, "multifamily", assumptions);
  const mf = Math.round(Math.min(150, mfGate.score));

  const scored: ScoredMetric[] = (
    Object.keys(COMPONENTS) as DemographicMetricKey[]
  ).map((key) => {
    const comp = COMPONENTS[key];
    const value = comp.extract(metrics);
    const flags: string[] = [];
    if (comp.flag) flags.push(comp.flag);
    if (key === "migration" && value === null) {
      flags.push("county-missing: scored 0, not defaulted");
    }
    return {
      key,
      label: comp.label,
      value,
      normalized: normalizeFor(key, "mixed_use", value),
      weightMu: assumptions.demo.weights.mixed_use[key] ?? null,
      weightMf: assumptions.demo.weights.multifamily[key] ?? null,
      floor: floorStatus(key, metrics, assumptions),
      ...(flags.length > 0 ? { flag: flags.join(" · ") } : {}),
    };
  });

  return {
    mu,
    mf,
    muDetail: { ...muGate, score: mu },
    mfDetail: { ...mfGate, score: mf },
    metrics: scored,
  };
}

/** The raw, ungated MU score. Used once to establish the Avalon anchor. */
export function muRawScore(metrics: DemographicMetrics, assumptions: Assumptions): number {
  return rawScore(metrics, "mixed_use", assumptions);
}
