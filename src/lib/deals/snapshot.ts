import type { Comp } from "@/app/api/comps/route";
import type { DealFields } from "@/components/screen/deal-inputs";
import type { FirstLookFields } from "@/components/screen/first-look-inputs";
import type { ProgramFields } from "@/components/screen/program-inputs";
import type {
  RentFields,
  RentFieldKey,
  RentSource,
} from "@/components/screen/revenue-section";
import type {
  Answer,
  CombinedVerdict,
  CostSelection,
  LandTest,
  ScoredMetric,
  Verdict,
} from "@/lib/scoring";

/**
 * The whole deal, as the page holds it. Spec B4.
 *
 * One shape crosses the wire in both directions: the page posts it to save and
 * receives it back to restore. That is deliberate — a save and a load that
 * describe the deal differently is how a "saved" deal quietly comes back
 * missing a field.
 *
 * `computed` carries what the engine already worked out. It is denormalised
 * into `screen_results` and `first_look_results` so the pipeline can draw
 * twenty rows without re-resolving twenty cost stacks; it is never read back
 * into the page, which recomputes from the inputs on every render.
 */

export interface DealComputed {
  weightedScore: number;
  unknownShare: number;
  koPass: "PASS" | "FAIL";
  demoBand: "GO" | "WATCH" | "NO-GO" | null;
  verdict: Verdict;
  prob: number;
  probWeighted: number;

  totalNoi: number | null;
  totalCostExLand: number | null;
  maxLandPrice: number | null;
  headroomPctOfAsk: number | null;
  yocOnCost: number | null;
  blendedYoc: number | null;
  retailShareOfNoi: number | null;
  landTest: LandTest | null;
  combinedVerdict: CombinedVerdict;
}

export interface DealSnapshot {
  /** Absent on a first save; the server mints one and returns it. */
  id?: string;
  deal: DealFields;
  answers: Record<string, Answer>;
  notes: Record<string, string>;
  probability: number;
  program: ProgramFields;
  costSelections: Record<string, CostSelection>;
  globalMultiplier: number;
  rents: RentFields;
  rentSources: Partial<Record<RentFieldKey, RentSource>>;
  firstLook: FirstLookFields;
  comps: Comp[];
  /** Only explicit ticks and unticks. Absent means the low-signal default. */
  compsIncluded: Record<string, boolean>;
  demographicMetrics: ScoredMetric[] | null;
  computed: DealComputed;
}

/** What the pipeline table needs, and nothing else. Spec B8. */
export interface PipelineRow {
  id: string;
  name: string;
  submarket: string | null;
  productType: DealFields["productType"];
  mu: number | null;
  mf: number | null;
  verdict: Verdict;
  probWeighted: number;
  landTest: LandTest | null;
  combinedVerdict: CombinedVerdict;
  maxLandPrice: number | null;
  askingPrice: number | null;
  headroomPctOfAsk: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Pipeline order: combined verdict first, then prob-weighted score descending.
 *
 * The rank is fixed here rather than in SQL because it is a judgement about
 * what to look at first, not a property of the data — a DOUBLE GO belongs at
 * the top even if something unscored happens to carry a higher raw score.
 */
export const COMBINED_RANK: Record<CombinedVerdict, number> = {
  "DOUBLE GO": 0,
  "GO — LAND FAIL": 1,
  WATCH: 2,
  INCOMPLETE: 3,
  "NO-GO": 4,
  "NOT SCORED": 5,
};

export function comparePipelineRows(a: PipelineRow, b: PipelineRow): number {
  const rank = COMBINED_RANK[a.combinedVerdict] - COMBINED_RANK[b.combinedVerdict];
  if (rank !== 0) return rank;
  return b.probWeighted - a.probWeighted;
}
