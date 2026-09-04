/**
 * The two gates. Build spec B0.
 *
 * Gate 1 is John's deal filter: is this a Toro deal? Gate 2 is the First Look
 * underwriting: does the math work? The combined verdict is what the panel
 * leads with, under the two gate lines.
 *
 * Pure. Takes the two gate outputs and nothing else.
 */

import type { LandTest, Verdict } from "./types";

/**
 * Gate 2's state as the panel sees it. `null` is the workbook's em-dash — the
 * land test ran but had no asking price to test against. `"NOT RUN"` is Gate 2
 * not having happened at all, which is every deal until the First Look sections
 * are filled in.
 */
export type Gate2Result = LandTest | "NOT RUN";

export type CombinedVerdict =
  | "DOUBLE GO"
  | "GO — LAND FAIL"
  | "WATCH"
  | "INCOMPLETE"
  | "NO-GO"
  | "NOT SCORED";

/**
 * Combine the two gates.
 *
 * Gate 2 only moves the answer when Gate 1 is a GO — that is the only state
 * where the land test decides between acting and not. Everything else is
 * already settled by Gate 1:
 *
 * | Gate 1     | PASS      | FAIL           | null       | NOT RUN    |
 * |------------|-----------|----------------|------------|------------|
 * | GO         | DOUBLE GO | GO — LAND FAIL | INCOMPLETE | INCOMPLETE |
 * | WATCH      | WATCH     | WATCH          | WATCH      | WATCH      |
 * | INCOMPLETE | INCOMPLETE| INCOMPLETE     | INCOMPLETE | INCOMPLETE |
 * | NO-GO      | NO-GO     | NO-GO          | NO-GO      | NO-GO      |
 * | NOT SCORED | NOT SCORED| NOT SCORED     | NOT SCORED | NOT SCORED |
 *
 * Spec B0 says Gate 2 does not run on a Gate 1 NO-GO. That is a rule about what
 * the panel shows, not a precondition on this function: a deal can be underwritten
 * to a PASS and then knocked out by a single changed answer, and the stale land
 * test is still sitting in state. So a Gate 1 NO-GO or NOT SCORED disregards
 * Gate 2 rather than rejecting it — the caller renders Gate 2 as NOT RUN.
 *
 * A GO with no land answer is not a DOUBLE GO and is not a land failure. It is
 * INCOMPLETE: the Toro test passed and the money question is unanswered.
 */
export function combinedVerdict(
  gate1: Verdict,
  landTest: Gate2Result,
): CombinedVerdict {
  switch (gate1) {
    case "NOT SCORED":
      return "NOT SCORED";
    case "NO-GO":
      return "NO-GO";
    case "INCOMPLETE":
      return "INCOMPLETE";
    case "WATCH":
      return "WATCH";
    case "GO":
      if (landTest === "PASS") return "DOUBLE GO";
      if (landTest === "FAIL") return "GO — LAND FAIL";
      return "INCOMPLETE";
  }
}
