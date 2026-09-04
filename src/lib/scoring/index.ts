/**
 * packages/scoring in waiting.
 *
 * Pure TypeScript: no React, no DB, no fetch. Golden-tested against the
 * 2026 Deal Filter workbook. Every number the engine uses arrives on an
 * `Assumptions` object built from the `assumptions` table.
 */

export type {
  Answer,
  AssumptionRow,
  BucketKey,
  ComponentKey,
  CriterionDef,
  CriterionKind,
  DemographicBand,
  KnockoutResult,
  LandTest,
  ProductType,
  ProductTypeSetting,
  Verdict,
} from "./types";

export {
  type Assumptions,
  AssumptionsError,
  buildAssumptions,
  isPlaceholder,
  PLACEHOLDER_SOURCE,
  PlaceholderAssumptionError,
  placeholderKeys,
  validateAssumptions,
} from "./assumptions";

export {
  combinedVerdict,
  type CombinedVerdict,
  type Gate2Result,
} from "./combined";

export {
  band,
  type DemographicScores,
  type DemographicsResult,
  evaluateDemographics,
  governingScore,
} from "./demographics";

export {
  type AnswerMap,
  answeredCount,
  criterionPoints,
  type CriterionScore,
  geographyAnswer,
  koCheck,
  scoreCriteria,
  screenDeal,
  type ScreenInput,
  type ScreenResult,
  unknownShare,
  verdict,
  type VerdictInput,
  weightedScore,
} from "./screen";

export {
  type ComponentInput,
  type ComponentInputs,
  componentSupport,
  type ComponentSupport,
  firstLook,
  type FirstLookInput,
  type FirstLookResult,
  landAtTdcRates,
  maxLandPrice,
  PAD_RATE_KEYS,
  type PadInput,
  padProceeds,
  type PadProceedsLine,
  type PadProceedsResult,
  productTypeTest,
  type SanityQuantities,
  sensitivityGrid,
  type SensitivityGrid,
  targetYoc,
} from "./firstLook";
