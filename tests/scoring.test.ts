/**
 * Engine tests for the mechanics ported from the workbook.
 *
 * These are not golden cases — they pin the behaviour of each rule so a
 * refactor cannot quietly change a verdict. The golden cases in tests/golden
 * pin the numbers against real filled workbooks.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  type Answer,
  type Assumptions,
  band,
  buildAssumptions,
  AssumptionsError,
  type DemographicBand,
  evaluateDemographics,
  firstLook,
  isPlaceholder,
  padProceeds,
  placeholderKeys,
  PlaceholderAssumptionError,
  productTypeTest,
  screenDeal,
  validateAssumptions,
} from "@/lib/scoring";

import { loadAssumptionsFromCsv } from "./golden/harness";

let A: Assumptions;

beforeAll(() => {
  A = loadAssumptionsFromCsv();
});

/** The 17 answered criterion keys, in Deal Screen order. */
const ANSWERED = [
  "geography",
  "market",
  "location",
  "barriers_to_entry",
  "entitlements",
  "competition",
  "physical",
  "seller_sophistication",
  "control",
  "market_viability",
  "partner_quality",
  "pursuit_costs",
  "timing",
  "brand_fit",
  "capability",
  "capacity",
  "fee_potential",
] as const;

function answers(fill: Answer, overrides: Record<string, Answer> = {}) {
  const result: Record<string, Answer> = {};
  for (const key of ANSWERED) result[key] = fill;
  return { ...result, ...overrides };
}

function screen(
  answerMap: Record<string, Answer>,
  demographics: { score: number | null; band: DemographicBand },
) {
  return screenDeal(
    {
      answers: answerMap,
      demographics: { governingScore: demographics.score, band: demographics.band },
    },
    A,
  );
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

describe("assumptions", () => {
  it("has 18 criteria, 17 of them answered, weights summing to 100", () => {
    expect(A.criteria).toHaveLength(18);
    expect(A.criteria.filter((c) => c.kind === "answered")).toHaveLength(17);
    expect(A.criteria.filter((c) => c.kind === "computed")).toHaveLength(1);
    expect(A.criteria.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
    expect(validateAssumptions(A)).toEqual([]);
  });

  it("flags the five knockout criteria from the workbook", () => {
    expect(A.criteria.filter((c) => c.ko).map((c) => c.key).sort()).toEqual([
      "brand_fit",
      "capacity",
      "control",
      "entitlements",
      "geography",
    ]);
  });

  it("throws rather than defaulting when a key is missing", () => {
    expect(() => buildAssumptions([{ key: "verdict.go_min", value: "70" }])).toThrow(
      AssumptionsError,
    );
  });

  it("marks the three stand-in values as placeholders", () => {
    expect(placeholderKeys(A)).toEqual([
      "cost.escalation.annual",
      "pad.rate.outparcel_per_parcel",
    ]);
    expect(isPlaceholder(A, "pad.rate.hotel_per_key")).toBe(false);
    // A placeholder may still carry a stand-in number.
    expect(A.cost.escalationAnnual).toBe(0.04);
    expect(A.pad.outparcelPerParcel).toBeNull();
  });

  it("has a real townhome pad rate, sourced and no longer a placeholder", () => {
    expect(isPlaceholder(A, "pad.rate.townhome_per_lot")).toBe(false);
    expect(A.pad.townhomePerLot).toBe(75_000);
  });
});

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

describe("demographics", () => {
  it("picks the governing score from the product type", () => {
    const scores = { mu: 93, mf: 80 };
    expect(evaluateDemographics(scores, "mixed_use", A).governingScore).toBe(93);
    expect(evaluateDemographics(scores, "multifamily", A).governingScore).toBe(80);
    expect(evaluateDemographics(scores, "auto", A).governingScore).toBeNull();
  });

  it("bands inclusively at both thresholds", () => {
    expect(band(80, "mixed_use", A)).toBe("GO");
    expect(band(79, "mixed_use", A)).toBe("WATCH");
    expect(band(51, "mixed_use", A)).toBe("WATCH");
    expect(band(50, "mixed_use", A)).toBe("NO-GO");
    expect(band(70, "multifamily", A)).toBe("GO");
    expect(band(40, "multifamily", A)).toBe("NO-GO");
    expect(band(null, "mixed_use", A)).toBeNull();
  });

  it("reproduces the Overlook calibration: NO-GO mixed-use, WATCH multifamily", () => {
    const overlook = { mu: 16, mf: 55 };
    expect(evaluateDemographics(overlook, "mixed_use", A).band).toBe("NO-GO");
    expect(evaluateDemographics(overlook, "multifamily", A).band).toBe("WATCH");
  });
});

// ---------------------------------------------------------------------------
// Deal Screen
// ---------------------------------------------------------------------------

describe("deal screen", () => {
  it("scores a perfect deal at 100", () => {
    const result = screen(answers("yes"), { score: 100, band: "GO" });
    expect(result.weightedScore).toBeCloseTo(100, 9);
    expect(result.answeredCount).toBe(17);
    expect(result.verdict).toBe("GO");
  });

  it("converts the demographic score to points, capped at the answer maximum", () => {
    const half = screen(answers("yes"), { score: 50, band: "WATCH" });
    // Demographics carries weight 10; at half score it contributes 5.
    expect(half.rows.find((r) => r.key === "demographics")?.score).toBeCloseTo(5, 9);
    expect(half.weightedScore).toBeCloseTo(95, 9);

    // The workbook's MIN(3, ...) means a score above 100 cannot buy more.
    const over = screen(answers("yes"), { score: 150, band: "GO" });
    expect(over.rows.find((r) => r.key === "demographics")?.score).toBeCloseTo(10, 9);
    expect(over.weightedScore).toBeCloseTo(100, 9);
  });

  it("is NOT SCORED until all 17 are answered", () => {
    const result = screen(answers("yes", { timing: null }), {
      score: 100,
      band: "GO",
    });
    expect(result.answeredCount).toBe(16);
    expect(result.verdict).toBe("NOT SCORED");
  });

  it("divides unknowns by the answered count, not the criterion count", () => {
    const result = screen(answers("yes", { market: "maybe", location: "maybe" }), {
      score: 100,
      band: "GO",
    });
    expect(result.unknownCount).toBe(2);
    expect(result.unknownShare).toBeCloseTo(2 / 17, 9);
  });

  it("applies the INCOMPLETE ceiling strictly above 25%", () => {
    // 4 of 17 maybes is 23.5% — under the ceiling.
    const under = screen(
      answers("yes", {
        market: "maybe",
        location: "maybe",
        physical: "maybe",
        timing: "maybe",
      }),
      { score: 100, band: "GO" },
    );
    expect(under.unknownShare).toBeLessThan(A.verdict.maxUnknownShare);
    expect(under.verdict).toBe("GO");

    // 5 of 17 is 29.4% — over it.
    const over = screen(
      answers("yes", {
        market: "maybe",
        location: "maybe",
        physical: "maybe",
        timing: "maybe",
        capability: "maybe",
      }),
      { score: 100, band: "GO" },
    );
    expect(over.unknownShare).toBeGreaterThan(A.verdict.maxUnknownShare);
    expect(over.verdict).toBe("INCOMPLETE");
  });

  it("forces NO-GO on a knockout, ahead of the unknown ceiling", () => {
    const result = screen(
      answers("maybe", { entitlements: "no", control: "no" }),
      { score: 100, band: "GO" },
    );
    expect(result.koPass).toBe("FAIL");
    expect(result.knockedOutBy.sort()).toEqual(["control", "entitlements"]);
    expect(result.unknownShare).toBeGreaterThan(A.verdict.maxUnknownShare);
    expect(result.verdict).toBe("NO-GO");
  });

  it("does not knock out on a No against an unflagged criterion", () => {
    const result = screen(answers("yes", { market: "no" }), {
      score: 100,
      band: "GO",
    });
    expect(result.koPass).toBe("PASS");
    expect(result.weightedScore).toBeCloseTo(94, 9);
    expect(result.verdict).toBe("GO");
  });

  it("forces NO-GO on a NO-GO demographic band regardless of score", () => {
    const result = screen(answers("yes"), { score: 20, band: "NO-GO" });
    expect(result.verdict).toBe("NO-GO");
  });

  it("bands the score into GO, WATCH and NO-GO at the thresholds", () => {
    // Answer everything Maybe: 1 of 3 points on every criterion.
    const allMaybe = screen(answers("maybe"), { score: 100, band: "GO" });
    // 10 (demographics, full) + 90/3 = 40. Below the WATCH floor.
    expect(allMaybe.weightedScore).toBeCloseTo(40, 9);
    // ...but 100% unknown, so the ceiling wins first.
    expect(allMaybe.verdict).toBe("INCOMPLETE");

    const noneKo = answers("yes", {
      market: "no",
      location: "no",
      physical: "no",
      timing: "no",
      capability: "no",
      fee_potential: "no",
      partner_quality: "no",
    });
    const watch = screen(noneKo, { score: 100, band: "GO" });
    expect(watch.weightedScore).toBeCloseTo(67, 9);
    expect(watch.verdict).toBe("WATCH");
  });

  it("treats probability as a ranking multiplier, not a verdict input", () => {
    const base = screenDeal(
      {
        answers: answers("yes"),
        demographics: { governingScore: 100, band: "GO" },
        probability: 0.5,
      },
      A,
    );
    expect(base.probability).toBe(0.5);
    expect(base.probabilityWeightedScore).toBeCloseTo(50, 9);
    expect(base.verdict).toBe("GO");
  });

  it("defaults probability to the assumption", () => {
    const result = screen(answers("yes"), { score: 100, band: "GO" });
    expect(result.probability).toBe(A.probability.default);
    expect(result.probabilityWeightedScore).toBeCloseTo(75, 9);
  });
});

// ---------------------------------------------------------------------------
// First Look UW
// ---------------------------------------------------------------------------

const DEAL = {
  components: {
    retail: { noi: 1_000_000, costExLand: 8_000_000 },
    office: { noi: 0, costExLand: 0 },
    multifamily: { noi: 5_000_000, costExLand: 60_000_000 },
  },
  pads: { hotelKeys: 100, townhomeLots: 0, outparcels: 0 },
  askingPrice: 20_000_000,
  acreage: 25,
  sanity: { retailSf: 40_000, officeSf: 0, multifamilyUnits: 300 },
};

describe("first look", () => {
  it("supports each component at its own target yield and blends the hurdle", () => {
    const result = firstLook(DEAL, A);
    expect(result.totalNoi).toBe(6_000_000);
    expect(result.totalCostExLand).toBe(68_000_000);
    expect(result.totalCostSupported).toBeCloseTo(
      1_000_000 / 0.075 + 5_000_000 / 0.065,
      6,
    );
    // The blend falls out of the mix rather than being a fixed number.
    expect(result.blendedYoc).toBeCloseTo(6_000_000 / result.totalCostSupported, 9);
    expect(result.blendedYoc).toBeGreaterThan(A.yoc.multifamily);
    expect(result.blendedYoc).toBeLessThan(A.yoc.retail);
  });

  it("measures yield against the cost incurred, not the cost supported", () => {
    const result = firstLook(DEAL, A);
    expect(result.yocOnCost).toBeCloseTo(6_000_000 / 68_000_000, 12);
    // The gap is what the panel reads: short of the hurdle is negative.
    expect(result.yocGapBps).toBeCloseTo(
      (result.yocOnCost - result.blendedYoc) * 10_000,
      6,
    );
    // This deal beats its hurdle: $6M on $68M is 8.82% against a ~6.6% blend.
    expect(result.yocGapBps).toBeGreaterThan(0);

    // Double the cost and the same income falls short of the same hurdle.
    const dear = firstLook(
      {
        ...DEAL,
        components: {
          retail: { ...DEAL.components.retail, costExLand: 16_000_000 },
          office: { ...DEAL.components.office, costExLand: 0 },
          multifamily: { ...DEAL.components.multifamily, costExLand: 120_000_000 },
        },
      },
      A,
    );
    expect(dear.blendedYoc).toBeCloseTo(result.blendedYoc, 12);
    expect(dear.yocGapBps).toBeLessThan(0);
  });

  it("closes the gap to zero when cost incurred equals cost supported", () => {
    const result = firstLook(DEAL, A);
    // Rebuild the same deal with the cost the income exactly supports.
    const exact = firstLook(
      {
        ...DEAL,
        components: {
          retail: {
            noi: DEAL.components.retail.noi,
            costExLand: DEAL.components.retail.noi / A.yoc.retail,
          },
          office: {
            noi: DEAL.components.office.noi,
            costExLand: DEAL.components.office.noi / A.yoc.office,
          },
          multifamily: {
            noi: DEAL.components.multifamily.noi,
            costExLand: DEAL.components.multifamily.noi / A.yoc.multifamily,
          },
        },
      },
      A,
    );
    expect(exact.totalCostExLand).toBeCloseTo(result.totalCostSupported, 6);
    expect(exact.yocGapBps).toBeCloseTo(0, 6);
  });

  it("refuses to price a parcel off a placeholder rate", () => {
    expect(() =>
      padProceeds({ hotelKeys: 0, townhomeLots: 0, outparcels: 3 }, A),
    ).toThrow(PlaceholderAssumptionError);

    expect(() =>
      firstLook(
        { ...DEAL, pads: { hotelKeys: 100, townhomeLots: 0, outparcels: 2 } },
        A,
      ),
    ).toThrow(/pad\.rate\.outparcel_per_parcel/);
  });

  it("does not throw when the placeholder parcel quantity is zero", () => {
    const result = padProceeds(
      { hotelKeys: 100, townhomeLots: 0, outparcels: 0 },
      A,
    );
    expect(result.total).toBe(2_000_000);
    // The rate is reported as null rather than a misleading zero.
    expect(result.lines.find((l) => l.parcel === "outparcel")?.rate).toBeNull();
    expect(result.lines.find((l) => l.parcel === "outparcel")?.proceeds).toBe(0);
  });

  it("prices townhome lots off the real rate, no override needed", () => {
    const result = padProceeds(
      { hotelKeys: 0, townhomeLots: 40, outparcels: 0 },
      A,
    );
    expect(result.total).toBe(40 * 75_000);
    expect(result.lines.find((l) => l.parcel === "townhome")?.rate).toBe(75_000);
  });

  it("prices a placeholder parcel once a real rate is supplied", () => {
    const withRate: typeof A = {
      ...A,
      pad: { ...A.pad, outparcelPerParcel: 900_000 },
      placeholders: new Set(
        [...A.placeholders].filter((k) => k !== "pad.rate.outparcel_per_parcel"),
      ),
    };
    const result = padProceeds(
      { hotelKeys: 0, townhomeLots: 0, outparcels: 3 },
      withRate,
    );
    expect(result.total).toBe(3 * 900_000);
  });

  it("adds pad proceeds back and carries the land", () => {
    const result = firstLook(DEAL, A);
    expect(result.padProceeds.total).toBe(2_000_000);
    expect(result.landValueBeforeCarry).toBeCloseTo(
      result.totalCostSupported - 68_000_000 + 2_000_000,
      6,
    );
    // The carry divides rather than subtracts: land is levered too.
    expect(result.maxLandPrice).toBeCloseTo(
      result.landValueBeforeCarry / 1.055,
      6,
    );
    expect(result.maxLandPrice).toBeLessThan(result.landValueBeforeCarry);
  });

  it("tests the max land price against the ask", () => {
    const result = firstLook(DEAL, A);
    expect(result.landTest).toBe("PASS");
    expect(result.headroom).toBeCloseTo(result.maxLandPrice - 20_000_000, 6);
    expect(result.headroomPctOfAsk).toBeCloseTo(result.headroom / 20_000_000, 9);
    expect(result.maxLandPricePerAcre).toBeCloseTo(result.maxLandPrice / 25, 6);

    const rich = firstLook({ ...DEAL, askingPrice: 90_000_000 }, A);
    expect(rich.landTest).toBe("FAIL");
    expect(rich.headroom).toBeLessThan(0);
  });

  it("suppresses the land test and headroom until an ask is entered", () => {
    const result = firstLook({ ...DEAL, askingPrice: 0 }, A);
    expect(result.landTest).toBeNull();
    expect(result.headroom).toBe(0);
    expect(result.headroomPctOfAsk).toBe(0);
  });

  it("prices land at TDC conventions for the sanity check", () => {
    const result = firstLook(DEAL, A);
    // 40,000 SF retail x $20 + 300 units x $40,000
    expect(result.landAtTdcRates).toBe(40_000 * 20 + 300 * 40_000);
    expect(result.maxLandPriceVsTdcRates).toBeCloseTo(
      result.maxLandPrice - result.landAtTdcRates,
      6,
    );
  });

  it("tests product type on retail share of NOI, inclusive at the threshold", () => {
    expect(productTypeTest(15, 100, A).suggested).toBe("multifamily");
    expect(productTypeTest(15.01, 100, A).suggested).toBe("mixed_use");
    expect(productTypeTest(0, 0, A).suggested).toBeNull();

    const result = firstLook(DEAL, A);
    expect(result.retailShareOfNoi).toBeCloseTo(1 / 6, 9);
    expect(result.productTypeTest).toBe("mixed_use");
  });

  it("returns a 5x5 sensitivity grid whose centre is the base case", () => {
    const result = firstLook(DEAL, A);
    expect(result.sensitivity.mfYocAxis).toHaveLength(5);
    expect(result.sensitivity.commYocAxis).toHaveLength(5);
    expect(result.sensitivity.cells).toHaveLength(5);
    for (const row of result.sensitivity.cells) expect(row).toHaveLength(5);

    // Axis index 2 is 0.065 MF and 0.075 commercial — the base assumptions.
    expect(result.sensitivity.mfYocAxis[2]).toBe(A.yoc.multifamily);
    expect(result.sensitivity.commYocAxis[2]).toBe(A.yoc.retail);
    expect(result.sensitivity.cells[2][2]).toBeCloseTo(result.maxLandPrice, 6);

    // A higher required yield supports less cost, so less land.
    expect(result.sensitivity.cells[4][4]).toBeLessThan(
      result.sensitivity.cells[0][0],
    );
  });

  it("survives a zero yield without producing Infinity", () => {
    const result = firstLook(DEAL, { ...A, yoc: { ...A.yoc, retail: 0 } });
    expect(Number.isFinite(result.totalCostSupported)).toBe(true);
    expect(Number.isFinite(result.maxLandPrice)).toBe(true);
  });

  it("returns zeros for an empty deal rather than NaN", () => {
    const empty = firstLook(
      {
        components: {
          retail: { noi: 0, costExLand: 0 },
          office: { noi: 0, costExLand: 0 },
          multifamily: { noi: 0, costExLand: 0 },
        },
        pads: { hotelKeys: 0, townhomeLots: 0, outparcels: 0 },
        askingPrice: 0,
        acreage: 0,
        sanity: { retailSf: 0, officeSf: 0, multifamilyUnits: 0 },
      },
      A,
    );
    expect(empty.totalCostSupported).toBe(0);
    expect(empty.blendedYoc).toBe(0);
    expect(empty.maxLandPrice).toBe(0);
    expect(empty.maxLandPricePerAcre).toBe(0);
    expect(empty.landTest).toBeNull();
    expect(empty.productTypeTest).toBeNull();
  });
});
