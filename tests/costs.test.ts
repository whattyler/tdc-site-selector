/**
 * Cost stack resolution. Spec B5 §4.
 *
 * The library is read from docs/cost_library.csv through the same parser the
 * seed uses, so the test and the table cannot drift.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { readCostLibraryCsv } from "@/lib/db/cost-library-seed";
import {
  allocateCostExLand,
  type CostLibraryLine,
  type CostProgram,
  type CostSelection,
  CostResolutionError,
  escalationYears,
  resolveCosts,
} from "@/lib/scoring";

import { loadAssumptionsFromCsv } from "./golden/harness";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY: CostLibraryLine[] = readCostLibraryCsv(
  readFileSync(path.join(REPO, "docs", "cost_library.csv"), "utf8"),
);

/** Medley Phase I, the program the library was priced off. */
const MEDLEY: CostProgram = {
  resiUnits: 340,
  resiGsf: 395_000,
  retailSf: 147_286,
  officeSf: 112_011,
  parkingStructuredSpaces: 586,
  parkingSurfaceSpaces: 0,
  acreage: 55.47,
};

/** Fixed so escalation is deterministic. */
const TODAY = new Date("2026-09-04T00:00:00Z");

let A: ReturnType<typeof loadAssumptionsFromCsv>;

beforeAll(() => {
  A = loadAssumptionsFromCsv();
});

/**
 * Every line on its Medley rate, multiplier 1.
 *
 * office_shell needs a custom rate: Medley has 112,011 RSF of office but no new
 * shell in the budget (Building 4000 is an existing-building renovation, ~$60/SF
 * all in). Without it the resolver throws, which is the correct behaviour.
 */
function medleySelections(): CostSelection[] {
  return LIBRARY.map((line) => ({
    lineKey: line.lineKey,
    source:
      line.lineKey === "office_shell"
        ? ("custom" as const)
        : line.medleyRate !== null
          ? ("medley" as const)
          : line.cccRate !== null
            ? ("ccc" as const)
            : ("custom" as const),
    multiplier: 1,
    customRate: line.lineKey === "office_shell" ? 60 : null,
  }));
}

describe("cost library CSV", () => {
  it("parses every line with a category and a basis", () => {
    expect(LIBRARY.length).toBe(26);
    for (const line of LIBRARY) {
      expect(["hard", "soft", "other"]).toContain(line.category);
      expect(line.label).not.toBe("");
    }
  });

  it("gives every percentage line something to be a percentage of", () => {
    for (const line of LIBRARY) {
      if (line.basis.startsWith("pct_")) {
        expect(line.appliesTo).not.toBeNull();
      }
    }
  });

  it("carries the two new bases", () => {
    const bases = new Set(LIBRARY.map((l) => l.basis));
    expect(bases.has("per_acre")).toBe(true);
    expect(bases.has("pct_soft")).toBe(true);
  });
});

describe("escalation", () => {
  it("counts forward from the as-of date and never backward", () => {
    expect(escalationYears("2024-06-01", TODAY)).toBeCloseTo(2.26, 1);
    expect(escalationYears(null, TODAY)).toBe(0);
    // A rate priced in the future stays as priced.
    expect(escalationYears("2030-01-01", TODAY)).toBe(0);
  });

  it("compounds the assumption onto the rate", () => {
    const resolution = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY);
    const shell = resolution.lines.find((l) => l.lineKey === "resi_shell");
    // $123,009 at 2024-06-01, escalated ~2.26y at 4%.
    const expected = 123_009 * Math.pow(1.04, escalationYears("2024-06-01", TODAY));
    expect(shell?.resolvedRate).toBeCloseTo(expected, 2);
    expect(shell?.resolvedAmount).toBeCloseTo(expected * 340, 0);
  });

  it("reports the escalation rate as a placeholder", () => {
    const resolution = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY);
    expect(resolution.escalation.annual).toBe(0.04);
    expect(resolution.escalation.isPlaceholder).toBe(true);
  });
});

describe("resolution", () => {
  it("totals hard, soft and other into cost ex-land", () => {
    const { totals } = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY);
    expect(totals.hard).toBeGreaterThan(0);
    expect(totals.soft).toBeGreaterThan(0);
    expect(totals.other).toBeGreaterThan(0);
    expect(totals.costExLand).toBeCloseTo(
      totals.hard + totals.soft + totals.other,
      6,
    );
  });

  it("scopes the two GC fees to their own half of the hard cost", () => {
    const resolution = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY);
    const resiFee = resolution.lines.find((l) => l.lineKey === "resi_gc_fee_gcs");
    const commFee = resolution.lines.find((l) => l.lineKey === "gc_fee_gcs");

    const resiHard = resolution.lines
      .filter((l) => l.category === "hard" && l.lineKey.startsWith("resi_"))
      .reduce((sum, l) => sum + l.resolvedAmount, 0);

    // The residential fee applies to residential hard only — itself excluded,
    // since it resolves after the direct lines.
    expect(resiFee?.quantity).toBeCloseTo(resiHard - (resiFee?.resolvedAmount ?? 0), 0);
    expect(commFee?.quantity).toBeGreaterThan(0);
    // If both applied to the whole base they would be equal; they must not be.
    expect(resiFee?.quantity).not.toBeCloseTo(commFee?.quantity ?? 0, 0);
  });

  it("applies the global multiplier on top of the line multiplier", () => {
    const base = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY);
    const scaled = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1.1, A, TODAY);

    // Exactly 1.1x. Percentage lines keep their percentage — their amounts
    // scale because the base scales, and scaling the rate too would compound
    // the total to ~1.14x.
    expect(scaled.totals.costExLand).toBeCloseTo(base.totals.costExLand * 1.1, 0);

    const baseFee = base.lines.find((l) => l.lineKey === "gc_fee_gcs");
    const scaledFee = scaled.lines.find((l) => l.lineKey === "gc_fee_gcs");
    expect(scaledFee?.resolvedRate).toBeCloseTo(baseFee?.resolvedRate ?? 0, 9);
    expect(scaledFee?.resolvedAmount).toBeCloseTo(
      (baseFee?.resolvedAmount ?? 0) * 1.1,
      0,
    );

    const withLine = medleySelections().map((s) =>
      s.lineKey === "resi_shell" ? { ...s, multiplier: 1.05 } : s,
    );
    const both = resolveCosts(LIBRARY, withLine, MEDLEY, 1.1, A, TODAY);
    const shell = both.lines.find((l) => l.lineKey === "resi_shell");
    const baseShell = base.lines.find((l) => l.lineKey === "resi_shell");
    expect(shell?.resolvedRate).toBeCloseTo(
      (baseShell?.resolvedRate ?? 0) * 1.05 * 1.1,
      4,
    );
  });

  it("offers only the sources that carry a rate", () => {
    const resolution = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY);
    const retailShell = resolution.lines.find((l) => l.lineKey === "retail_shell");
    // Medley priced retail; CCC has no retail at all.
    expect(retailShell?.availableSources).toEqual(["medley", "custom"]);

    const softContingency = resolution.lines.find((l) => l.lineKey === "soft_contingency");
    expect(softContingency?.availableSources).toEqual(["ccc", "custom"]);
  });

  it("throws when an unpriced line is given a quantity", () => {
    // office_shell has no rate on either source; give the program office SF.
    expect(() =>
      resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY),
    ).not.toThrow();

    // Give the program surface parking and parking_surface has no rate.
    const withSurface: CostProgram = { ...MEDLEY, parkingSurfaceSpaces: 200 };
    expect(() =>
      resolveCosts(LIBRARY, medleySelections(), withSurface, 1, A, TODAY),
    ).toThrow(CostResolutionError);

    // And an office program with no custom rate on the unpriced shell.
    const noCustom = medleySelections().map((s) =>
      s.lineKey === "office_shell" ? { ...s, customRate: null } : s,
    );
    expect(() => resolveCosts(LIBRARY, noCustom, MEDLEY, 1, A, TODAY)).toThrow(
      /Office shell/,
    );
  });

  it("leaves an unpriced line at zero when the program gives it nothing", () => {
    const noParking: CostProgram = { ...MEDLEY, parkingSurfaceSpaces: 0 };
    const resolution = resolveCosts(LIBRARY, medleySelections(), noParking, 1, A, TODAY);
    const surface = resolution.lines.find((l) => l.lineKey === "parking_surface");
    expect(surface?.resolvedRate).toBeNull();
    expect(surface?.resolvedAmount).toBe(0);
  });
});

describe("component allocation", () => {
  it("splits the exact total across the three components", () => {
    const resolution = resolveCosts(LIBRARY, medleySelections(), MEDLEY, 1, A, TODAY);
    const split = allocateCostExLand(resolution, MEDLEY);
    expect(split.retail + split.office + split.multifamily).toBeCloseTo(
      resolution.totals.costExLand,
      4,
    );
    expect(split.multifamily).toBeGreaterThan(0);
    expect(split.retail).toBeGreaterThan(0);
  });

  it("falls back to floor area when nothing is directly attributed", () => {
    const onlyShared = resolveCosts(
      LIBRARY.filter((l) => l.lineKey === "offsite_utilities"),
      medleySelections(),
      MEDLEY,
      1,
      A,
      TODAY,
    );
    const split = allocateCostExLand(onlyShared, MEDLEY);
    expect(split.retail + split.office + split.multifamily).toBeCloseTo(
      onlyShared.totals.costExLand,
      4,
    );
    // Residential GSF is the largest area, so it takes the largest share.
    expect(split.multifamily).toBeGreaterThan(split.office);
  });
});
