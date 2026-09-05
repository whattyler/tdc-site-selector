import type { DealSnapshot } from "@/lib/deals/snapshot";
import {
  allocateCostExLand,
  type Assumptions,
  combinedVerdict,
  type CombinedVerdict,
  computeRevenue,
  type CostLibraryLine,
  type CostProgram,
  type CostResolution,
  type DemographicsResult,
  evaluateDemographics,
  firstLook,
  type FirstLookResult,
  type Gate2Result,
  resolveCosts,
  type RevenueResult,
  screenDeal,
  type ScreenResult,
} from "@/lib/scoring";

/**
 * Run a saved deal through the engine, server-side. Phase 8.
 *
 * The page does this in the browser, on every render, from page state. The PDF
 * needs the same answers without a browser, so the sequence lives here and both
 * follow it: program → costs → revenue → Gate 1 → Gate 2 → combined.
 *
 * Nothing here reads the stored verdicts. A report is generated from the deal's
 * inputs against today's assumptions, so it says what the deal is worth now,
 * not what it was worth the afternoon somebody pressed Save.
 */

export interface EvaluatedDeal {
  screen: ScreenResult;
  demographics: DemographicsResult;
  revenue: RevenueResult;
  costs: CostResolution | null;
  costError: string | null;
  firstLook: FirstLookResult | null;
  gate2: Gate2Result;
  gate2Error: string | null;
  combined: CombinedVerdict;
  costProgram: CostProgram;
}

const num = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

const share = (raw: string): number | null => {
  const value = num(raw);
  return value === null ? null : value / 100;
};

export function evaluateSnapshot(
  snapshot: DealSnapshot,
  assumptions: Assumptions,
  library: CostLibraryLine[],
): EvaluatedDeal {
  const { deal, program, rents, firstLook: fl } = snapshot;

  // ── Program ─────────────────────────────────────────────────────────────
  const spaces = num(program.parkingSpaces) ?? 0;
  const structuredShare =
    program.parkingType === "structured"
      ? 1
      : program.parkingType === "mixed"
        ? 0.5
        : 0;
  const structured = Math.round(spaces * structuredShare);

  const costProgram: CostProgram = {
    resiUnits: num(program.resiUnits) ?? 0,
    resiGsf: num(program.resiGsf) ?? 0,
    retailSf: num(program.retailSf) ?? 0,
    officeSf: num(program.officeSf) ?? 0,
    parkingStructuredSpaces: structured,
    parkingSurfaceSpaces: spaces - structured,
    acreage: num(deal.acreage) ?? 0,
  };

  // ── Costs ───────────────────────────────────────────────────────────────
  let costs: CostResolution | null = null;
  let costError: string | null = null;
  try {
    costs = resolveCosts(
      library,
      Object.values(snapshot.costSelections),
      costProgram,
      snapshot.globalMultiplier,
      assumptions,
    );
  } catch (error) {
    costError = error instanceof Error ? error.message : String(error);
  }

  // ── Revenue ─────────────────────────────────────────────────────────────
  const revenue = computeRevenue({
    resiUnits: costProgram.resiUnits || null,
    resiAvgNsf: num(program.avgNsf),
    resiRentPsfMo: num(rents.resiRentPsfMo),
    resiVacancy: share(rents.resiVacancy),
    opexPerUnit: num(rents.opexPerUnit),
    retailSf: costProgram.retailSf || null,
    retailRentPsf: num(rents.retailRentPsf),
    retailVacancy: share(rents.retailVacancy),
    retailNonRecovPsf: num(rents.retailNonRecovPsf),
    officeSf: costProgram.officeSf || null,
    officeRentPsf: num(rents.officeRentPsf),
    officeVacancy: share(rents.officeVacancy),
    officeNonRecovPsf: num(rents.officeNonRecovPsf),
  });

  // ── Gate 1 ──────────────────────────────────────────────────────────────
  const demographics = evaluateDemographics(
    { mu: num(deal.mu), mf: num(deal.mf) },
    deal.productType,
    assumptions,
  );

  const screen = screenDeal(
    {
      answers: snapshot.answers,
      demographics: {
        governingScore: demographics.governingScore,
        band: demographics.band,
      },
      probability: snapshot.probability,
    },
    assumptions,
  );

  // ── Gate 2 ──────────────────────────────────────────────────────────────
  const allocated = costs
    ? allocateCostExLand(costs, costProgram)
    : { retail: 0, office: 0, multifamily: 0 };

  let result: FirstLookResult | null = null;
  let gate2Error: string | null = null;

  if (revenue.totalNoi !== null) {
    try {
      result = firstLook(
        {
          components: {
            retail: { noi: revenue.retail.noi ?? 0, costExLand: allocated.retail },
            office: { noi: revenue.office.noi ?? 0, costExLand: allocated.office },
            multifamily: {
              noi: revenue.multifamily.noi ?? 0,
              costExLand: allocated.multifamily,
            },
          },
          pads: {
            hotelKeys: num(fl.hotelKeys) ?? 0,
            townhomeLots: num(fl.townhomeLots) ?? 0,
            outparcels: num(fl.outparcels) ?? 0,
          },
          askingPrice: num(fl.askingPrice) ?? 0,
          acreage: num(deal.acreage) ?? 0,
          sanity: {
            retailSf: costProgram.retailSf,
            officeSf: costProgram.officeSf,
            multifamilyUnits: costProgram.resiUnits,
          },
        },
        assumptions,
      );
    } catch (error) {
      gate2Error = error instanceof Error ? error.message : String(error);
    }
  }

  const gate2: Gate2Result =
    revenue.totalNoi === null || gate2Error !== null
      ? "NOT RUN"
      : (result?.landTest ?? null);

  return {
    screen,
    demographics,
    revenue,
    costs,
    costError,
    firstLook: result,
    gate2,
    gate2Error,
    combined: combinedVerdict(screen.verdict, gate2),
    costProgram,
  };
}
