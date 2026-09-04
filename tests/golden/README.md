# Golden cases

One JSON file per case. `golden.test.ts` loads every `*.json` in this
directory, runs the scoring engine against `input`, and asserts the result
matches `expected`.

Target set (spec B6): three real deals — one GO, one NO-GO via knockout, one
INCOMPLETE.

## Filling a case

1. Fill the workbook for the deal. Save it.
2. Copy the **inputs** into `input`:
   - `demographics.mu` / `.mf` — Demographics!C9 and C10.
   - `productType` — Deal Screen!C9, as `mixed_use` or `multifamily`.
   - `screen.answers` — Deal Screen!C16:C36, as `yes` / `maybe` / `no`, or
     `null` for a blank cell. Seventeen keys; `demographics` is not among them
     because it is computed.
   - `screen.probability` — Deal Screen!C31.
   - `firstLook.components` — First Look UW!C8:D10.
   - `firstLook.pads` — First Look UW!C15:C17.
   - `firstLook.askingPrice` / `.acreage` — First Look UW!C29 and C32.
   - `firstLook.sanity` — First Look UW!C38:C40.
3. Copy the **outputs** into `expected`. Every field is optional — state only
   what you have transcribed, and the harness ignores the rest. Field-to-cell
   map:

   | `expected` field | Workbook cell |
   |---|---|
   | `demographics.governingScore` | Demographics!C14 |
   | `demographics.band` | Demographics!C17 |
   | `screen.weightedScore` | Deal Screen!I6 |
   | `screen.answeredCount` | Deal Screen!I7 |
   | `screen.unknownShare` | Deal Screen!I8 |
   | `screen.koPass` | Deal Screen!I9 |
   | `screen.demoBand` | Deal Screen!I10 |
   | `screen.verdict` | Deal Screen!I11 |
   | `screen.probabilityWeightedScore` | Deal Screen!C41 |
   | `screen.criterionScores` | Deal Screen!F15:F36, keyed by criterion |
   | `firstLook.totalNoi` | First Look UW!C11 |
   | `firstLook.totalCostExLand` | First Look UW!D11 |
   | `firstLook.blendedYoc` | First Look UW!E11 |
   | `firstLook.totalCostSupported` | First Look UW!F11 |
   | `firstLook.padProceedsTotal` | First Look UW!E18 |
   | `firstLook.landValueBeforeCarry` | First Look UW!C24 |
   | `firstLook.maxLandPrice` | First Look UW!C26 |
   | `firstLook.headroom` | First Look UW!C30 |
   | `firstLook.headroomPctOfAsk` | First Look UW!C31 |
   | `firstLook.maxLandPricePerAcre` | First Look UW!C33 |
   | `firstLook.landTest` | First Look UW!C34 |
   | `firstLook.landAtTdcRates` | First Look UW!E41 |
   | `firstLook.maxLandPriceVsTdcRates` | First Look UW!C42 |
   | `firstLook.retailShareOfNoi` | First Look UW!C43 |
   | `firstLook.productTypeTest` | First Look UW!C44 |
   | `firstLook.sensitivityCells` | First Look UW!C49:G53 |

4. Set `"pending": false`.

## Notes

- **Strings are lowercased and snake_cased on the way in.** The workbook writes
  `Mixed-Use`; a case writes `mixed_use`. Verdict, band, knockout and land test
  strings keep the workbook's exact casing (`GO`, `NO-GO`, `PASS`, `NOT SCORED`).
- **Tolerance** defaults to `1e-6` absolute. Raise `tolerance` when the values
  were read off a rounded workbook display rather than the underlying cell.
- **Assumptions** come from `docs/assumptions.csv`. If a case was filled under
  different assumptions, pin them per-case with `assumptionOverrides`, e.g.
  `{"yoc.target.multifamily": "0.06"}`. Do not edit the CSV to make a case pass.
- **Placeholders.** Rows whose `source` is `placeholder` are stand-ins, and the
  engine throws rather than computing with them. Today that is the townhome and
  outparcel pad rates and the cost escalation rate. A case with townhome lots or
  outparcels must supply the real rate through `assumptionOverrides` — an
  override replaces the source, which clears the placeholder. A case with zero
  of both needs nothing: the rate cannot affect the answer, so it is not read.
- A case with an empty `expected` block fails rather than passing quietly.
