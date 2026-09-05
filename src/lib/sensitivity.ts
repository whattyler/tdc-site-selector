import { asset } from "@/lib/base-path";
import {
  allocateCostExLand,
  type Assumptions,
  computeRevenue,
  type CostProgram,
  type CostResolution,
  type CostSelection,
  firstLook,
  type PadInput,
  type RevenueInputs,
  type SanityQuantities,
} from "@/lib/scoring";

/**
 * The second sensitivity grid. Spec B5 §6.
 *
 * The workbook's own 5×5 varies the target yields, which is a question about
 * the hurdle. This one varies the two things we actually control an estimate
 * of — what the build costs and what the flats let for — and asks what the
 * land is worth under each.
 *
 * It lives here rather than in `src/lib/scoring` because a cost multiplier can
 * only be resolved by the server: the library rates behind it never reach the
 * client. So this fetches, and every cell is then computed by the pure engine.
 */

/** Both axes, centred on the current case. */
export const COST_MULTIPLIERS = [0.9, 0.95, 1.0, 1.05, 1.1] as const;
export const RENT_FACTORS = [0.9, 0.95, 1.0, 1.05, 1.1] as const;

export interface ScenarioCell {
  maxLand: number;
  totalNoi: number;
  yocOnCost: number;
  blendedYoc: number;
}

export interface CostRentGrid {
  multipliers: number[];
  rentFactors: number[];
  /** `cells[multiplierIndex][rentIndex]`, null where that row failed to resolve. */
  cells: (ScenarioCell | null)[][];
  /** Cost ex-land per multiplier row, for the row header. */
  costExLand: (number | null)[];
  error: string | null;
}

export interface CostRentGridInput {
  program: CostProgram;
  selections: CostSelection[];
  /** Base revenue. Only `resiRentPsfMo` moves across the columns. */
  revenue: RevenueInputs;
  pads: PadInput;
  askingPrice: number;
  acreage: number;
  sanity: SanityQuantities;
  assumptions: Assumptions;
}

async function resolveAt(
  input: CostRentGridInput,
  globalMultiplier: number,
  signal: AbortSignal,
): Promise<CostResolution> {
  const response = await fetch(asset("/api/costs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      program: input.program,
      selections: input.selections,
      globalMultiplier,
    }),
    cache: "no-store",
    signal,
  });

  const payload = (await response.json()) as CostResolution | { error: string };
  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload ? payload.error : "Cost resolution failed.",
    );
  }
  return payload;
}

export async function buildCostRentGrid(
  input: CostRentGridInput,
  signal: AbortSignal,
): Promise<CostRentGrid> {
  const multipliers = [...COST_MULTIPLIERS];
  const rentFactors = [...RENT_FACTORS];

  const empty: CostRentGrid = {
    multipliers,
    rentFactors,
    cells: multipliers.map(() => rentFactors.map(() => null)),
    costExLand: multipliers.map(() => null),
    error: null,
  };

  let resolutions: CostResolution[];
  try {
    // One resolution per row: the multiplier is the only thing the server
    // needs to see, and rent never touches the cost stack.
    resolutions = await Promise.all(
      multipliers.map((multiplier) => resolveAt(input, multiplier, signal)),
    );
  } catch (error) {
    if (signal.aborted) return empty;
    return {
      ...empty,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const cells = resolutions.map((resolution) => {
    const allocated = allocateCostExLand(resolution, input.program);

    return rentFactors.map((factor): ScenarioCell | null => {
      const revenue = computeRevenue({
        ...input.revenue,
        resiRentPsfMo:
          input.revenue.resiRentPsfMo === null
            ? null
            : input.revenue.resiRentPsfMo * factor,
      });

      try {
        const result = firstLook(
          {
            components: {
              retail: {
                noi: revenue.retail.noi ?? 0,
                costExLand: allocated.retail,
              },
              office: {
                noi: revenue.office.noi ?? 0,
                costExLand: allocated.office,
              },
              multifamily: {
                noi: revenue.multifamily.noi ?? 0,
                costExLand: allocated.multifamily,
              },
            },
            pads: input.pads,
            askingPrice: input.askingPrice,
            acreage: input.acreage,
            sanity: input.sanity,
          },
          input.assumptions,
        );

        return {
          maxLand: result.maxLandPrice,
          totalNoi: result.totalNoi,
          yocOnCost: result.yocOnCost,
          blendedYoc: result.blendedYoc,
        };
      } catch {
        // A placeholder pad rate. The panel already says so; a cell just
        // stays blank rather than showing a number built on a stand-in.
        return null;
      }
    });
  });

  return {
    multipliers,
    rentFactors,
    cells,
    costExLand: resolutions.map((resolution) => resolution.totals.costExLand),
    error: null,
  };
}
