/**
 * Component NOI. Spec B5 §5.
 *
 * Pure. The three formulas verbatim from the spec:
 *
 *   resi NOI   = units x avg NSF x rent/SF/mo x 12 x (1 - vac) - units x opex/unit
 *   retail NOI = GLA x NNN rent x (1 - vac) - GLA x non-recoverable/SF
 *   office NOI = RSF x rent x (1 - vac) - RSF x non-recoverable/SF
 *
 * Every input is nullable and null means "not entered", not zero. A component
 * with no rent produces a null NOI, which the panel shows as an em-dash — the
 * same rule the placeholder assumptions follow. Silently returning 0 would let
 * a deal underwrite a component nobody has priced.
 */

import type { ComponentKey } from "./types";

export interface RevenueInputs {
  /** Residential. */
  resiUnits: number | null;
  resiAvgNsf: number | null;
  resiRentPsfMo: number | null;
  resiVacancy: number | null;
  opexPerUnit: number | null;

  /** Retail, NNN. */
  retailSf: number | null;
  retailRentPsf: number | null;
  retailVacancy: number | null;
  retailNonRecovPsf: number | null;

  /** Office. */
  officeSf: number | null;
  officeRentPsf: number | null;
  officeVacancy: number | null;
  officeNonRecovPsf: number | null;
}

export interface ComponentNoi {
  component: ComponentKey;
  /** Gross potential rent before vacancy. */
  grossRent: number | null;
  effectiveRent: number | null;
  operatingCost: number | null;
  /** Null when the component has not been priced. */
  noi: number | null;
}

export interface RevenueResult {
  retail: ComponentNoi;
  office: ComponentNoi;
  multifamily: ComponentNoi;
  /** Sum of the components that have a number. Null when none do. */
  totalNoi: number | null;
  /** Retail share of total NOI, which drives the product-type test. */
  retailShareOfNoi: number | null;
}

const has = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

/** Vacancy defaults to zero only when rent exists — an unpriced component stays null. */
function vacancyOr(value: number | null): number {
  return has(value) ? value : 0;
}

function resiNoi(inputs: RevenueInputs): ComponentNoi {
  const { resiUnits, resiAvgNsf, resiRentPsfMo, opexPerUnit } = inputs;
  if (!has(resiUnits) || !has(resiAvgNsf) || !has(resiRentPsfMo)) {
    return {
      component: "multifamily",
      grossRent: null,
      effectiveRent: null,
      operatingCost: null,
      noi: null,
    };
  }

  const grossRent = resiUnits * resiAvgNsf * resiRentPsfMo * 12;
  const effectiveRent = grossRent * (1 - vacancyOr(inputs.resiVacancy));
  const operatingCost = has(opexPerUnit) ? resiUnits * opexPerUnit : 0;

  return {
    component: "multifamily",
    grossRent,
    effectiveRent,
    operatingCost,
    noi: effectiveRent - operatingCost,
  };
}

/** Retail and office share a shape: area x rent, less vacancy and non-recoverables. */
function areaNoi(
  component: "retail" | "office",
  area: number | null,
  rentPsf: number | null,
  vacancy: number | null,
  nonRecovPsf: number | null,
): ComponentNoi {
  if (!has(area) || !has(rentPsf)) {
    return {
      component,
      grossRent: null,
      effectiveRent: null,
      operatingCost: null,
      noi: null,
    };
  }

  const grossRent = area * rentPsf;
  const effectiveRent = grossRent * (1 - vacancyOr(vacancy));
  const operatingCost = has(nonRecovPsf) ? area * nonRecovPsf : 0;

  return {
    component,
    grossRent,
    effectiveRent,
    operatingCost,
    noi: effectiveRent - operatingCost,
  };
}

export function computeRevenue(inputs: RevenueInputs): RevenueResult {
  const retail = areaNoi(
    "retail",
    inputs.retailSf,
    inputs.retailRentPsf,
    inputs.retailVacancy,
    inputs.retailNonRecovPsf,
  );
  const office = areaNoi(
    "office",
    inputs.officeSf,
    inputs.officeRentPsf,
    inputs.officeVacancy,
    inputs.officeNonRecovPsf,
  );
  const multifamily = resiNoi(inputs);

  const priced = [retail, office, multifamily].filter((c) => c.noi !== null);
  const totalNoi =
    priced.length === 0 ? null : priced.reduce((sum, c) => sum + (c.noi ?? 0), 0);

  return {
    retail,
    office,
    multifamily,
    totalNoi,
    retailShareOfNoi:
      totalNoi === null || totalNoi === 0 ? null : (retail.noi ?? 0) / totalNoi,
  };
}
