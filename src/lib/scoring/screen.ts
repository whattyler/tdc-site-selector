/**
 * Deal Screen tab.
 *
 * 18 weighted criteria totalling 100 points: 17 answered Yes / Maybe / No, plus
 * Demographics, which is computed from the governing dashboard score. Geography
 * is one of the 17 — the app pre-fills it from drive time, but it is still an
 * answer the user can override, and it still counts toward the 17.
 *
 * Workbook reference — Deal Screen!I6:I11 and Deal Screen!D15:F36.
 */

import type { Assumptions } from "./assumptions";
import type {
  Answer,
  CriterionDef,
  DemographicBand,
  KnockoutResult,
  Verdict,
} from "./types";

/** Answers keyed by criterion key. A missing key is treated as unanswered. */
export type AnswerMap = Readonly<Record<string, Answer>>;

export interface ScreenInput {
  answers: AnswerMap;
  /** Governing score and band carried from the Demographics tab. */
  demographics: {
    governingScore: number | null;
    band: DemographicBand;
  };
  /** Ranking multiplier, not a scored criterion. Defaults to the assumption. */
  probability?: number;
}

/** One criterion's contribution, mirroring columns C through G of the tab. */
export interface CriterionScore {
  key: string;
  label: string;
  bucket: CriterionDef["bucket"];
  weight: number;
  ko: boolean;
  kind: CriterionDef["kind"];
  /** Null for computed criteria and for anything not yet answered. */
  answer: Answer;
  /** Points before weighting. Null when the criterion is unscored. */
  points: number | null;
  /** `points / answerPoints.max * weight`, or 0 when unscored. */
  score: number;
  /** True when this criterion is KO-flagged and answered "no". */
  isKnockout: boolean;
}

export interface ScreenResult {
  rows: CriterionScore[];
  /** Sum of every criterion's weighted score. Max 100. */
  weightedScore: number;
  /** How many of the answered criteria have a Yes / Maybe / No. */
  answeredCount: number;
  /** How many answered criteria are "maybe". */
  unknownCount: number;
  /** `unknownCount / answeredCount`, or 0 when nothing is answered. */
  unknownShare: number;
  koPass: KnockoutResult;
  /** Keys of the KO-flagged criteria answered "no". */
  knockedOutBy: string[];
  demoBand: DemographicBand;
  verdict: Verdict;
  probability: number;
  /** `weightedScore * probability`. Ranks deals; does not drive the verdict. */
  probabilityWeightedScore: number;
}

/**
 * Points for one criterion, before weighting.
 *
 * Answered criteria map Yes / Maybe / No onto the answer scale. The Demographics
 * criterion converts its 0-100 governing score instead:
 * `=MIN(3, score/100*3)` in the workbook, generalised here to the answer scale
 * and the score maximum from assumptions.
 */
export function criterionPoints(
  criterion: CriterionDef,
  input: ScreenInput,
  assumptions: Assumptions,
): number | null {
  if (criterion.kind === "computed") {
    const score = input.demographics.governingScore;
    if (score === null) return null;
    const scaled = (score / assumptions.demoScoreMax) * assumptions.answerPoints.max;
    return Math.min(assumptions.answerPoints.max, scaled);
  }

  const answer = input.answers[criterion.key] ?? null;
  if (answer === null) return null;
  return assumptions.answerPoints[answer];
}

/** Score every criterion, in Deal Screen order. */
export function scoreCriteria(
  input: ScreenInput,
  assumptions: Assumptions,
): CriterionScore[] {
  return assumptions.criteria.map((criterion) => {
    const answer =
      criterion.kind === "answered" ? (input.answers[criterion.key] ?? null) : null;
    const points = criterionPoints(criterion, input, assumptions);
    const score =
      points === null ? 0 : (points / assumptions.answerPoints.max) * criterion.weight;
    return {
      key: criterion.key,
      label: criterion.label,
      bucket: criterion.bucket,
      weight: criterion.weight,
      ko: criterion.ko,
      kind: criterion.kind,
      answer,
      points,
      score,
      isKnockout: criterion.ko && answer === "no",
    };
  });
}

/**
 * Weighted screen score.
 *
 * Workbook: `=SUM(F15:F36)`.
 */
export function weightedScore(rows: readonly CriterionScore[]): number {
  return rows.reduce((sum, row) => sum + row.score, 0);
}

/**
 * How many criteria carry a Yes / Maybe / No.
 *
 * Workbook: `=COUNTIF(C15:C36,"Yes")+COUNTIF(...,"Maybe")+COUNTIF(...,"No")`.
 * Demographics holds a band string rather than an answer, so it never counts.
 */
export function answeredCount(rows: readonly CriterionScore[]): number {
  return rows.filter((row) => row.answer !== null).length;
}

/**
 * Share of answered criteria that are "maybe".
 *
 * Workbook: `=IFERROR(COUNTIF(C15:C36,"Maybe")/I7,0)`. Note the denominator is
 * the answered count, not the total criterion count — so a deal with two
 * answers, one of them Maybe, sits at 50% unknown.
 */
export function unknownShare(rows: readonly CriterionScore[]): number {
  const answered = answeredCount(rows);
  if (answered === 0) return 0;
  return rows.filter((row) => row.answer === "maybe").length / answered;
}

/**
 * Knockout check.
 *
 * Workbook: `=IF(SUMPRODUCT((G15:G36="KO")*(C15:C36="No"))>0,"FAIL","PASS")`.
 * Returns PASS unconditionally when the knockout override is switched off in
 * assumptions.
 */
export function koCheck(
  rows: readonly CriterionScore[],
  assumptions: Assumptions,
): { result: KnockoutResult; knockedOutBy: string[] } {
  if (!assumptions.verdict.knockoutActive) {
    return { result: "PASS", knockedOutBy: [] };
  }
  const knockedOutBy = rows.filter((row) => row.isKnockout).map((row) => row.key);
  return { result: knockedOutBy.length > 0 ? "FAIL" : "PASS", knockedOutBy };
}

export interface VerdictInput {
  answered: number;
  ko: KnockoutResult;
  demoBand: DemographicBand;
  unknown: number;
  score: number;
}

/**
 * Screen verdict.
 *
 * Workbook: `=IF(I7<17,"NOT SCORED",IF(I9="FAIL","NO-GO",IF(I10="NO-GO","NO-GO",
 * IF(I8>Assumptions!$C$23,"INCOMPLETE",IF(I6>=$C$21,"GO",IF(I6>=$C$22,"WATCH",
 * "NO-GO"))))))`
 *
 * Order matters: an incomplete screen is never scored, a knockout beats the
 * unknown ceiling, and the unknown ceiling beats the score. The ceiling is a
 * strict `>` — exactly 25% unknown still scores.
 */
export function verdict(input: VerdictInput, assumptions: Assumptions): Verdict {
  const { verdict: thresholds } = assumptions;
  if (input.answered < thresholds.requiredAnswered) return "NOT SCORED";
  if (input.ko === "FAIL") return "NO-GO";
  if (input.demoBand === "NO-GO") return "NO-GO";
  if (input.unknown > thresholds.maxUnknownShare) return "INCOMPLETE";
  if (input.score >= thresholds.goMin) return "GO";
  if (input.score >= thresholds.watchMin) return "WATCH";
  return "NO-GO";
}

/** Run the whole Deal Screen tab. */
export function screenDeal(
  input: ScreenInput,
  assumptions: Assumptions,
): ScreenResult {
  const rows = scoreCriteria(input, assumptions);
  const score = weightedScore(rows);
  const answered = answeredCount(rows);
  const unknown = unknownShare(rows);
  const ko = koCheck(rows, assumptions);
  const probability = input.probability ?? assumptions.probability.default;

  return {
    rows,
    weightedScore: score,
    answeredCount: answered,
    unknownCount: rows.filter((row) => row.answer === "maybe").length,
    unknownShare: unknown,
    koPass: ko.result,
    knockedOutBy: ko.knockedOutBy,
    demoBand: input.demographics.band,
    verdict: verdict(
      {
        answered,
        ko: ko.result,
        demoBand: input.demographics.band,
        unknown,
        score,
      },
      assumptions,
    ),
    probability,
    probabilityWeightedScore: score * probability,
  };
}

/**
 * Pre-fill the Geography answer from drive time to the site.
 *
 * Spec B5 section 1: at or under the Yes band it is a Yes, up to the Maybe band
 * it is a Maybe, beyond that a No. The user can override the result; this only
 * supplies the default.
 */
export function geographyAnswer(
  driveTimeMinutes: number | null,
  assumptions: Assumptions,
): Answer {
  if (driveTimeMinutes === null || !Number.isFinite(driveTimeMinutes)) return null;
  const { yesMaxMinutes, maybeMaxMinutes } = assumptions.geographyBands;
  if (driveTimeMinutes <= yesMaxMinutes) return "yes";
  if (driveTimeMinutes <= maybeMaxMinutes) return "maybe";
  return "no";
}
