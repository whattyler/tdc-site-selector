/**
 * Component NOI. Spec B5 §5.
 *
 * The three formulas are arithmetic, so the tests are arithmetic. What is
 * worth testing is the nullability rule: an unpriced component must produce a
 * null NOI, never a zero, because a zero underwrites as "this component earns
 * nothing" rather than "nobody has priced this yet".
 */

import { describe, expect, it } from "vitest";

import { computeRevenue, type RevenueInputs } from "@/lib/scoring";

const EMPTY: RevenueInputs = {
  resiUnits: null,
  resiAvgNsf: null,
  resiRentPsfMo: null,
  resiVacancy: null,
  opexPerUnit: null,
  retailSf: null,
  retailRentPsf: null,
  retailVacancy: null,
  retailNonRecovPsf: null,
  officeSf: null,
  officeRentPsf: null,
  officeVacancy: null,
  officeNonRecovPsf: null,
};

describe("computeRevenue", () => {
  it("returns null NOI for every component when nothing is priced", () => {
    const result = computeRevenue(EMPTY);
    expect(result.retail.noi).toBeNull();
    expect(result.office.noi).toBeNull();
    expect(result.multifamily.noi).toBeNull();
    expect(result.totalNoi).toBeNull();
    expect(result.retailShareOfNoi).toBeNull();
  });

  it("leaves a component null when it has quantity but no rent", () => {
    const result = computeRevenue({ ...EMPTY, retailSf: 147_286 });
    expect(result.retail.noi).toBeNull();
  });

  it("leaves a component null when it has rent but no quantity", () => {
    const result = computeRevenue({ ...EMPTY, retailRentPsf: 34 });
    expect(result.retail.noi).toBeNull();
  });

  it("computes retail as GLA x NNN rent less vacancy and non-recoverables", () => {
    const result = computeRevenue({
      ...EMPTY,
      retailSf: 100_000,
      retailRentPsf: 34,
      retailVacancy: 0.05,
      retailNonRecovPsf: 2,
    });
    // 3,400,000 gross → 3,230,000 effective → less 200,000 non-recoverable.
    expect(result.retail.grossRent).toBe(3_400_000);
    expect(result.retail.effectiveRent).toBeCloseTo(3_230_000, 6);
    expect(result.retail.noi).toBeCloseTo(3_030_000, 6);
  });

  it("computes office on the same shape as retail", () => {
    const result = computeRevenue({
      ...EMPTY,
      officeSf: 112_011,
      officeRentPsf: 30,
      officeVacancy: 0.1,
      officeNonRecovPsf: 3,
    });
    expect(result.office.noi).toBeCloseTo(
      112_011 * 30 * 0.9 - 112_011 * 3,
      6,
    );
  });

  it("computes residential monthly rent annualised, less opex per unit", () => {
    const result = computeRevenue({
      ...EMPTY,
      resiUnits: 340,
      resiAvgNsf: 950,
      resiRentPsfMo: 2.1,
      resiVacancy: 0.06,
      opexPerUnit: 7_200,
    });
    const gross = 340 * 950 * 2.1 * 12;
    expect(result.multifamily.grossRent).toBeCloseTo(gross, 6);
    expect(result.multifamily.noi).toBeCloseTo(gross * 0.94 - 340 * 7_200, 6);
  });

  it("treats a missing vacancy as zero only once the component is priced", () => {
    const priced = computeRevenue({
      ...EMPTY,
      retailSf: 1_000,
      retailRentPsf: 10,
    });
    expect(priced.retail.noi).toBe(10_000);
    expect(computeRevenue(EMPTY).retail.noi).toBeNull();
  });

  it("totals only the components that carry a number", () => {
    const result = computeRevenue({
      ...EMPTY,
      retailSf: 1_000,
      retailRentPsf: 10,
      officeSf: 1_000,
      officeRentPsf: 30,
    });
    expect(result.totalNoi).toBe(40_000);
    expect(result.multifamily.noi).toBeNull();
    expect(result.retailShareOfNoi).toBeCloseTo(0.25, 10);
  });

  it("does not divide by a zero total", () => {
    const result = computeRevenue({
      ...EMPTY,
      retailSf: 1_000,
      retailRentPsf: 0,
    });
    expect(result.totalNoi).toBe(0);
    expect(result.retailShareOfNoi).toBeNull();
  });
});
