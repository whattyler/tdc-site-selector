import { describe, expect, it } from "vitest";

import { validateAssumptions } from "@/lib/scoring";

import {
  compare,
  formatMismatches,
  loadAssumptionsFromCsv,
  loadGoldenCases,
  runGoldenCase,
  toComparable,
} from "./harness";

describe("assumptions table", () => {
  it("parses from docs/assumptions.csv and hangs together", () => {
    const assumptions = loadAssumptionsFromCsv();
    expect(validateAssumptions(assumptions)).toEqual([]);
  });
});

describe("golden cases", () => {
  const cases = loadGoldenCases();

  it("finds at least one case file", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const { file, testCase } of cases) {
    const title = `${file} — ${testCase.name}`;

    // A case still being transcribed from the workbook is reported as skipped
    // rather than failing the suite.
    const run = testCase.pending ? it.skip : it;

    run(title, () => {
      const assumptions = loadAssumptionsFromCsv(testCase.assumptionOverrides);
      const actual = runGoldenCase(testCase, assumptions);
      const mismatches = compare(
        testCase.expected,
        toComparable(actual),
        testCase.tolerance,
      );

      if (mismatches.length > 0) {
        throw new Error(
          `${mismatches.length} mismatch(es) in ${file}:\n` +
            formatMismatches(mismatches),
        );
      }

      // A case that states nothing asserts nothing. Catch that rather than
      // letting it pass quietly.
      expect(Object.keys(testCase.expected).length).toBeGreaterThan(0);
    });
  }
});
