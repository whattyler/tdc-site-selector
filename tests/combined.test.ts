/**
 * Every cell of the two-gate matrix. Build spec B0.
 */

import { describe, expect, it } from "vitest";

import {
  combinedVerdict,
  type CombinedVerdict,
  type Gate2Result,
  type Verdict,
} from "@/lib/scoring";

const GATE1: readonly Verdict[] = [
  "GO",
  "WATCH",
  "INCOMPLETE",
  "NO-GO",
  "NOT SCORED",
];

const GATE2: readonly Gate2Result[] = ["PASS", "FAIL", null, "NOT RUN"];

/** [gate1][gate2] in the order of the arrays above. */
const MATRIX: Record<Verdict, Record<string, CombinedVerdict>> = {
  GO: {
    PASS: "DOUBLE GO",
    FAIL: "GO — LAND FAIL",
    null: "INCOMPLETE",
    "NOT RUN": "INCOMPLETE",
  },
  WATCH: {
    PASS: "WATCH",
    FAIL: "WATCH",
    null: "WATCH",
    "NOT RUN": "WATCH",
  },
  INCOMPLETE: {
    PASS: "INCOMPLETE",
    FAIL: "INCOMPLETE",
    null: "INCOMPLETE",
    "NOT RUN": "INCOMPLETE",
  },
  "NO-GO": {
    PASS: "NO-GO",
    FAIL: "NO-GO",
    null: "NO-GO",
    "NOT RUN": "NO-GO",
  },
  "NOT SCORED": {
    PASS: "NOT SCORED",
    FAIL: "NOT SCORED",
    null: "NOT SCORED",
    "NOT RUN": "NOT SCORED",
  },
};

const label = (gate2: Gate2Result) => (gate2 === null ? "null" : gate2);

describe("combinedVerdict", () => {
  for (const gate1 of GATE1) {
    for (const gate2 of GATE2) {
      const expected = MATRIX[gate1][label(gate2)];
      it(`${gate1} + ${label(gate2)} = ${expected}`, () => {
        expect(combinedVerdict(gate1, gate2)).toBe(expected);
      });
    }
  }

  it("covers all 20 cells", () => {
    expect(GATE1.length * GATE2.length).toBe(20);
  });

  it("only lets Gate 2 change the answer when Gate 1 is a GO", () => {
    for (const gate1 of GATE1) {
      const results = new Set(GATE2.map((g2) => combinedVerdict(gate1, g2)));
      expect(results.size).toBe(gate1 === "GO" ? 3 : 1);
    }
  });

  it("disregards a stale Gate 2 result on a knocked-out deal", () => {
    // Underwritten to a PASS, then a single answer flips a knockout.
    expect(combinedVerdict("NO-GO", "PASS")).toBe("NO-GO");
    expect(combinedVerdict("NOT SCORED", "PASS")).toBe("NOT SCORED");
  });

  it("never reports DOUBLE GO without a land test PASS", () => {
    for (const gate1 of GATE1) {
      for (const gate2 of GATE2) {
        if (combinedVerdict(gate1, gate2) === "DOUBLE GO") {
          expect(gate1).toBe("GO");
          expect(gate2).toBe("PASS");
        }
      }
    }
  });
});
