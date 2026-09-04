# Golden case fill sheet

Cell order, one line each. Companion to `tests/golden/README.md`.

## INPUTS

### Deal Screen

```
C9   Product type                    → productType                                  ("Mixed-Use"→mixed_use, "Multifamily"→multifamily)
C16  Geography                       → input.screen.answers.geography
C17  Market                          → input.screen.answers.market
C18  Location                        → input.screen.answers.location
C20  Barriers to Entry               → input.screen.answers.barriers_to_entry
C21  Entitlements                    → input.screen.answers.entitlements
C22  Competition                     → input.screen.answers.competition
C23  Physical                        → input.screen.answers.physical
C25  Seller Sophistication           → input.screen.answers.seller_sophistication
C26  Control                         → input.screen.answers.control
C27  Market viability of all products→ input.screen.answers.market_viability
C28  Partner Quality                 → input.screen.answers.partner_quality
C29  Pursuit costs                   → input.screen.answers.pursuit_costs
C30  Timing                          → input.screen.answers.timing
C31  Probability                     → input.screen.probability
C33  Brand fit                       → input.screen.answers.brand_fit
C34  Capability                      → input.screen.answers.capability
C35  Capacity                        → input.screen.answers.capacity
C36  Fee Potential                   → input.screen.answers.fee_potential
```

C15 is not an input — Demographics is computed. C6, C7, C8, C10, C11 are labels the engine doesn't read.

### First Look UW

```
C8   Retail — Stabilized NOI         → input.firstLook.components.retail.noi
D8   Retail — Cost excl. land        → input.firstLook.components.retail.costExLand
E8   Retail — Target YoC             → input.firstLook.yocOverrides.retail        (only if typed over the Assumptions link)
C9   Office — Stabilized NOI         → input.firstLook.components.office.noi
D9   Office — Cost excl. land        → input.firstLook.components.office.costExLand
E9   Office — Target YoC             → input.firstLook.yocOverrides.office        (only if typed over)
C10  Multifamily — Stabilized NOI    → input.firstLook.components.multifamily.noi
D10  Multifamily — Cost excl. land   → input.firstLook.components.multifamily.costExLand
E10  Multifamily — Target YoC        → input.firstLook.yocOverrides.multifamily   (only if typed over)
C15  Hotel pad (keys)                → input.firstLook.pads.hotelKeys
C16  Townhome pad (lots)             → input.firstLook.pads.townhomeLots          (non-zero ⇒ assumptionOverrides["pad.rate.townhome_per_lot"])
C17  Other / outparcel               → input.firstLook.pads.outparcels            (non-zero ⇒ assumptionOverrides["pad.rate.outparcel_per_parcel"])
C29  Asking price / land basis       → input.firstLook.askingPrice                (0 if not set)
C32  Site acreage                    → input.firstLook.acreage                    (0 if not set)
C38  Retail (SF)                     → input.firstLook.sanity.retailSf
C39  Office (SF)                     → input.firstLook.sanity.officeSf
C40  Multifamily (units)             → input.firstLook.sanity.multifamilyUnits
```

### Demographics — outside the two tabs you asked for, but the JSON needs it

```
C9   Mixed-Use score                 → input.demographics.mu
C10  Multifamily score               → input.demographics.mf
```

## OUTPUTS → `expected`

### Deal Screen

```
F15  Demographics score              → expected.screen.criterionScores.demographics
F16  Geography score                 → expected.screen.criterionScores.geography
F17  Market score                    → expected.screen.criterionScores.market
F18  Location score                  → expected.screen.criterionScores.location
F20  Barriers to Entry score         → expected.screen.criterionScores.barriers_to_entry
F21  Entitlements score              → expected.screen.criterionScores.entitlements
F22  Competition score               → expected.screen.criterionScores.competition
F23  Physical score                  → expected.screen.criterionScores.physical
F25  Seller Sophistication score     → expected.screen.criterionScores.seller_sophistication
F26  Control score                   → expected.screen.criterionScores.control
F27  Market viability score          → expected.screen.criterionScores.market_viability
F28  Partner Quality score           → expected.screen.criterionScores.partner_quality
F29  Pursuit costs score             → expected.screen.criterionScores.pursuit_costs
F30  Timing score                    → expected.screen.criterionScores.timing
F33  Brand fit score                 → expected.screen.criterionScores.brand_fit
F34  Capability score                → expected.screen.criterionScores.capability
F35  Capacity score                  → expected.screen.criterionScores.capacity
F36  Fee Potential score             → expected.screen.criterionScores.fee_potential
I6   Weighted screen score           → expected.screen.weightedScore
I7   Criteria answered (of 17)       → expected.screen.answeredCount
I8   Unknown share                   → expected.screen.unknownShare               (decimal, not %)
I9   Knockout check                  → expected.screen.koPass                     ("PASS" / "FAIL")
I10  Demographic band                → expected.screen.demoBand                   ("—" → null)
I11  SCREEN VERDICT                  → expected.screen.verdict
C39  Unknowns                        → expected.screen.unknownCount
C40  Probability                     → expected.screen.probability
C41  Probability-weighted score      → expected.screen.probabilityWeightedScore
C42  Land test (mirror of FL!C34)    → expected.firstLook.landTest                (same cell as below; state once)
```

### First Look UW

```
C11  Total — Stabilized NOI          → expected.firstLook.totalNoi
D11  Total — Cost excl. land         → expected.firstLook.totalCostExLand
E11  Total — blended YoC             → expected.firstLook.blendedYoc              (decimal, not %)
F11  Total cost supported            → expected.firstLook.totalCostSupported
E18  Total pad sale proceeds         → expected.firstLook.padProceedsTotal
C24  Land value before carry         → expected.firstLook.landValueBeforeCarry
C26  Maximum land price              → expected.firstLook.maxLandPrice
C30  Headroom / (shortfall)          → expected.firstLook.headroom
C31  Headroom as % of ask            → expected.firstLook.headroomPctOfAsk         (decimal, not %)
C33  Maximum land price per acre     → expected.firstLook.maxLandPricePerAcre
C34  LAND TEST                       → expected.firstLook.landTest                 ("—" → null)
E41  Land at TDC standard rates      → expected.firstLook.landAtTdcRates
C42  Max land price vs. TDC rates    → expected.firstLook.maxLandPriceVsTdcRates
C43  Retail share of NOI             → expected.firstLook.retailShareOfNoi         (decimal, not %)
C44  Product type test suggests      → expected.firstLook.productTypeTest          ("Multifamily"→multifamily, "Mixed-Use"→mixed_use, "—"→null)
C49:G53  Sensitivity grid            → expected.firstLook.sensitivityCells
```

Sensitivity grid, row by row — `sensitivityCells[mfRow][commCol]`, MF yield down the side, commercial across the top:

```
C49 D49 E49 F49 G49  (MF 6.00%)     → sensitivityCells[0][0..4]
C50 D50 E50 F50 G50  (MF 6.25%)     → sensitivityCells[1][0..4]
C51 D51 E51 F51 G51  (MF 6.50%)     → sensitivityCells[2][0..4]
C52 D52 E52 F52 G52  (MF 6.75%)     → sensitivityCells[3][0..4]
C53 D53 E53 F53 G53  (MF 7.00%)     → sensitivityCells[4][0..4]
```

`sensitivityCells[2][2]` (E51) should equal `maxLandPrice` — free check that you transcribed the grid the right way round.

### Demographics — again, outside the two tabs, needed for a complete case

```
C14  Governing score                 → expected.demographics.governingScore
C15  GO threshold                    → expected.demographics.goThreshold
C16  NO-GO threshold                 → expected.demographics.nogoThreshold
C17  DEMOGRAPHIC BAND                → expected.demographics.band                  ("—" → null)
```

### Cells with no JSON path — skip them

`Deal Screen` D15:D36 (points before weighting), E15:E36 (weights, they come from assumptions), G15:G36 (KO flags, ditto). `First Look UW` F8:F10 (per-component support), D15:D17 and E15:E17 (per-line pad rates and proceeds), C21/C22/C23 (mirrors of F11, −D11, E18), C25 (carry rate, from assumptions), E38:E40 (per-component land at TDC rates), D38:D40 (TDC rates, from assumptions).

### Conversions

Answers `Yes`/`Maybe`/`No`/blank → `"yes"`/`"maybe"`/`"no"`/`null`. Anything Excel displays as a percent goes in as its decimal (7.50% → `0.075`). Em-dash `—` → `null`. `GO`, `WATCH`, `NO-GO`, `PASS`, `FAIL`, `INCOMPLETE`, `NOT SCORED` keep workbook casing; product type is snake_cased. If you read a number off a rounded display rather than the formula bar, raise `tolerance` on the case.
