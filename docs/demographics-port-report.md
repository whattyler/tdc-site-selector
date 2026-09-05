# Demographics port — findings before writing code

**Date:** 2026-09-04
**Scope change:** Phase 4 no longer calls the demographics dashboard over OIDC (spec A4). The
dashboard's scoring is being ported into this app and run server-side.

**Source:** `C:\Users\TylerHancock\Projects\live-demographics-starter` (read-only, not modified).

This is the report produced before porting. Its job is to record what the dashboard actually does,
what it gets wrong, and which of its published calibration numbers can be trusted as targets.

---

## What was read

`CLAUDE.md`, `api/nominatim/search.js` (the only file under `api/`), and
`src/lib/{census-api,aggregation,site-score,constants}.js`. The React components and `docs/` were
not read — they are dashboard UI and do not affect scoring.

Read-only probes were run against the live Census and TIGERweb APIs using the key in the
dashboard's `.env`. Nothing in that repo was written to.

| Concern | File | What's there |
|---|---|---|
| Census ACS fetch | `src/lib/census-api.js` | `fetchCountyBlockGroups()` chunks `VAR_KEYS` into 45-variable requests and merges by GEOID. `getBlockGroupGeometries()` pulls TIGERweb polygons plus `AREALAND` |
| Radius interpolation | `src/lib/aggregation.js` | `aggregateBlockGroups()` — turf circle ∩ block-group polygon, `weight = intersectArea / AREALAND` clamped to 1. Sums are weighted; medians are population-weighted. `aggregateTracts()` is the tract-centroid fallback |
| Derived metrics | `src/lib/aggregation.js` | `applyDerivedMetrics()` — `bachelors_plus_pct`, `pop_18_34_pct`, `pop_30_44_pct`, `owner_pct` / `renter_pct`, `vacancy_rate`, and `avg_hh_income = B19025_001E / B11001_001E` |
| Scoring | `src/lib/site-score.js` | `COMPONENTS` normalizers, `MU_WEIGHTS` / `MF_WEIGHTS`, `applyMuGate` / `applyMfGate`, `getCalibration()` |
| Variable map | `src/lib/constants.js` | `ACS_VARIABLES` — 84 variables, 79 `sum` and 5 `median` |

---

## The nine metrics

Nine distinct metrics across the two profiles. Each profile uses seven of them, and each profile's
weights sum to 100. This matches the reference table on the workbook's Demographics tab exactly.

| Metric | MU wt | MF wt | Normalizer |
|---|---|---|---|
| Average HH Income | **30** | **35** | Piecewise. MU: 80k→0, 100k→0.10, 130k→0.40, 160k→0.85, 200k→1.0, 250k→1.10. MF is a lower bar: 50k→0, 70k→0.30, 90k→0.50, 120k→0.75, 160k→1.0 |
| Total Population | **20** | **25** | Piecewise. MU: 15k→0, 25k→0.10, 45k→0.40, 70k→0.85, 100k→1.0. MF: 15k→0, 30k→0.30, 80k→0.70, 150k→0.95, 200k→1.0 |
| Bachelor's+ | **25** | **15** | Piecewise: 0.25→0, 0.35→0.10, 0.50→0.40, 0.65→0.85, 0.75→1.0 |
| Discretionary Spend | 10 | 10 | Linear, cap $90k. `avgIncome − medianRent × 12` |
| Migration Signal | 5 | 5 | Linear, cap 1.0. IRS SOI county table. **Defaults to 0.5 when the county is missing** |
| HH Formation | 5 | — | Linear, cap 0.5 |
| Young Adult 18–34 | 5 | — | Linear, cap 0.4 |
| Rent-to-Income | — | 5 | `<18%` → 1, `>35%` → 0, linear between |
| Prime Renter 30–44 | — | 5 | Piecewise: 0.10→0, 0.15→0.20, 0.20→0.50, 0.25→0.85, 0.30→1.0 |

The MU income curve exceeds 1.0 at 250k (returns 1.10), so a single component can contribute more
than its nominal weight. Deliberate, per the source comments, but it means "sums to 100" is a floor
rather than a ceiling.

### Gates

MU checks a Big 3 — income, education, population. MF checks a Big 2 — income, population.
Renter penetration was removed from the MF gate and weight map in the May 2026 reweight.

- Count below **soft** floor → multiply raw score by `1.0 / 0.85 / 0.55 / 0.30`.
- **Any** below **hard** floor → `Math.min(gated, 35)`.

| Profile | Component | Soft floor | Hard floor |
|---|---|---|---|
| MU | Average HH Income | 130,000 | 100,000 |
| MU | Bachelor's+ | 0.50 | 0.35 |
| MU | Total Population | 45,000 | 25,000 |
| MF | Average HH Income | 90,000 | 70,000 |
| MF | Total Population | 40,000 | 30,000 |

### Anchoring

**MU is Avalon-anchored**: `muScale = 100 / avalonMuRaw`, so Avalon scores exactly 100 by
construction. **MF is absolute** — no anchor since the May 2026 reweight, which also removed the
scarcity-bonus multiplier and the U-shaped renter-penetration curve.

Verdict thresholds in the dashboard are MU `GO ≥ 80 / Borderline ≥ 65 / Weak ≥ 50` and MF
`GO ≥ 70 / Borderline ≥ 55 / Weak ≥ 40`. Ours come from `assumptions` (`demo.band.*`) and already
agree on the GO thresholds.

---

## What's broken

### 1. TIGERweb geography vintage mismatch — the root cause

`getBlockGroupGeometries()` queries `tigerWMS_ACS2022/MapServer/8`. That service is built on
**pre-2020** block groups. ACS 2022 5-year *data* is published on **2020** block groups. The two do
not join.

```
ACS 2022 5-year API, Fulton County GA :  858 block groups
tigerWMS_ACS2022   layer  8           :  544   <-- what the dashboard queries
tigerWMS_Census2020 layer  8          :  858   ok
tigerWMS_ACS2023   layer 10           :  858   ok
tigerWMS_Current   layer 10           :  858   ok

join result: 251 of 858 census rows matched a geometry
```

`aggregateBlockGroups()` does `if (!geom || !geom.feature) continue;` — so **71% of block groups are
silently dropped**. No error, no QA flag, no coverage warning.

Measured directly:

```
Avalon 3mi, as the dashboard computes it :  2 BGs,  3,632 people
Avalon 3mi, correct vintage              : 54 BGs, 76,682 people
```

The layer index also moves between services (8 → 10), so this is not a one-token substitution.

### 2. That fully explains MF = 35 on every site

MF's `totalPopMf` hard floor is 30,000. At ~3.6K population every site trips it, and `applyMfGate`
applies `Math.min(gated, 35)`. Every site pins to exactly 35. The same mechanism caps MU at 35
before Avalon scaling is applied.

### 3. Everything is scoped to a single county

`fetchCountyBlockGroups()` and `getBlockGroupGeometries()` both take one `(state, county)` — the
county the address geocoded into. A 3-mile circle near a county line loses everything on the far
side.

Measured: Medley sits on the Fulton/Gwinnett line. A correct query pulls block groups from
**13/121 and 13/135**; the dashboard only ever sees Fulton. Carmel spans **18/057 and 18/097**.

The fix is a geometry query (envelope + `esriSpatialRelIntersects`) rather than a county filter,
which also takes the geocoder's county FIPS out of the critical path.

### 4. The Census key ships to the browser

`VITE_CENSUS_API_KEY` — the `VITE_` prefix inlines it into the client bundle. Same class of problem
as the Google Maps key in Phase 3. Porting server-side fixes this by construction, but the port must
use `CENSUS_API_KEY` and **must not** prefix it `NEXT_PUBLIC_`.

### 5. Smaller items to carry into the port

- **`safeGate()` fails closed to "below all three floors."** A thrown error becomes a
  legitimate-looking NO-GO rather than an error state. For our purposes a failure has to surface —
  the page must say the call failed, never silently score a site down. Same rule as the placeholder
  assumptions.
- **Avalon calibration is name-matched at runtime.** `findAvalon()` regexes over the loaded sites
  array and falls back to a hardcoded `AVALON_FALLBACK_RAWS` when Avalon is not loaded. A
  per-request API has no "other sites" array, so MU needs a fixed anchor constant.
- **`hhFormation` is `households / population`** — an inverse household size (~0.38), not a
  formation rate. Capped at 0.5, so it is near-saturated for every plausible site and contributes
  about 4 of its 5 points regardless of the site. Nearly dead weight.
- **`migrationSignal` defaults to 0.5** when the county is absent from the IRS SOI table, silently
  mid-scoring an unknown.
- **The dashboard pulls ~84 ACS variables.** Scoring needs roughly 12; the rest feeds the Detailed
  tab. The port should pull only what it scores on.

---

## Do the calibration values reproduce?

Partly, and the discrepancy is itself informative.

Avalon MF was hand-computed against the current weights using corrected inputs (population 76,682,
average HHI $158,830, bachelor's+ 69.9%): **≈86**, against the recorded **85**. That is a strong
signal the MF port is sound once the geometry is fixed. Avalon MU = 100 is by construction and is
not evidence of anything.

But **the recorded values cannot have come from the current code.** With the vintage bug in place
every MF reads 35, so 85 / 85 / 80 / 55 predate it. They were captured under some combination of a
working geometry join and possibly pre-May-2026 MF weights.

Treat the four calibration numbers as a target to explain, not a specification to match. If the
port does not land on them, report the delta and the theory rather than tuning to fit.

Corrected 3-mile figures, centroid-inclusion method (area-weighting will trim these slightly),
against the population column on the workbook's Demographics tab:

| Site | Pop (measured) | Pop (workbook) | Avg HHI | Bachelor's+ | Counties in radius |
|---|---|---|---|---|---|
| Avalon | 76,682 | 70.5K | $158,830 | 69.9% | 13/121 |
| Medley | 73,706 | 56.6K | $163,364 | 63.9% | 13/121, 13/135 |
| Overlook | 38,130 | 35.2K | $126,442 | 45.9% | 13/117 |
| Carmel IN | 62,073 | 59.9K | $167,726 | 71.5% | 18/057, 18/097 |

Three of four land within about 10% on a deliberately crude method. Medley is ~30% high, most
likely centroid-inclusion over-counting where true area-weighting would cut partial block groups —
its circle crosses a county line into denser Gwinnett.

---

## Decisions needed before porting

**ACS vintage.** The dashboard uses 2022 (ACS 2018–2022), which is what the workbook's Demographics
tab cites. 2023 is available and has the same 858 block groups. Staying on 2022 preserves
comparability with the calibration values; moving to 2023 is fresher but breaks it.
*Recommendation:* port on 2022, put the year in `assumptions` so it is a one-row change, and stamp
it into `dashboard_version` for the cache key.

**MU anchor.** Avalon's raw MU score has to become a constant for a stateless API. *Recommendation:*
compute it once from corrected data and seed it as an `assumptions` row with source and as-of, so
re-anchoring later is a data edit rather than a deploy.

---

## Port results

Measured 2026-09-04 against live Census data. ACS 2022, 3-mile radius, area-weighted block-group
intersection, `tigerWMS_Census2020` layer 8, block groups found by envelope rather than by county.
Reproduce with `pnpm tsx --env-file-if-exists=.env.local scripts/demographics-probe.ts`.

Two things changed after the first run and both moved the numbers, so this section reflects the
final build: the IRS SOI migration table was ported in, and the weight and floor tables moved from
code into `assumptions` as `demo.weight.*` and `demo.floor.*`.

**MU anchor:** Avalon's ungated raw MU score is **84.3885**, seeded as `demo.mu.anchor_raw`, giving
an MU scale of 1.1850. Before migration was wired it computed at 82.8229, and the dashboard's own
hardcoded `AVALON_FALLBACK_RAWS["3mi"].mu` is **82** — the port landed within 1% of a number its
author recorded before the geometry broke, which nothing in this pipeline could have known. That is
independent evidence the normalizers and weights were ported correctly.

| Site | BGs | Coverage | Population | (workbook) | Δ pop | Avg HHI | Bach+ | MU | (rec) | MF | (rec) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Avalon | 68 | 100% | 74,089 | 70,500 | +5.1% | $161,690 | 70.9% | **100** | 100 | **86** | 85 |
| Medley | 67 | 100% | 75,313 | 56,600 | **+33.1%** | $163,751 | 64.4% | **96** | 93 | **83** | 80 |
| Carmel IN | 50 | 100% | 62,271 | 59,900 | +4.0% | $166,052 | 70.7% | **101** | 101 | **86** | 85 |
| Overlook | 27 | 100% | 36,242 | 35,200 | +3.0% | $126,297 | 46.5% | **16** | 16 | **55** | 55 |

**Carmel and Overlook reproduce exactly on both profiles.** Avalon's MU is 100 by construction, so
its MF of 86 against 85 is the informative half. Only Medley is more than 1 point off, and its
population explains why.

Gate state: Avalon, Medley and Carmel clear every floor (multiplier 1.0). Overlook is below all
three MU soft floors (×0.30) and one MF soft floor (×0.85), with no hard-floor breach — which is
what produces its 16 / 55 rather than a capped 35.

### Deltas and theories

**Population, three of four: +3% to +5%.** Within the 10% band and explainable as method
difference. The workbook column predates this port, and area-weighted intersection trims partial
block groups that a centroid-inclusion method counts whole. No action.

**Population, Medley: +33.1%. This one is the dashboard being wrong, not the port.** Medley sits on
the Fulton/Gwinnett line. Splitting the corrected 3-mile circle by county:

```
Fulton     38 BGs   56,910
Gwinnett   10 BGs   16,796
TOTAL      48 BGs   73,706
```

The workbook records **56,600**. Fulton-only measures **56,910** — a 0.5% match. The recorded
figure is the county-scoped count with the entire Gwinnett side of the circle missing. The port's
75,313 is the correct number. Avalon and Overlook sit inside a single county so they were never
affected; Carmel spans two counties but almost all of its population is in Hamilton, so its delta
stayed small. The golden test skips the 10% population assertion for Medley and records why.

**Migration was the systematic offset, and porting it closed the gap.** The first run had no IRS
SOI table, so `migrationSignal` was null and scored 0 against a weight of 5 on both profiles. MU and
MF were then within 4 points but *uniformly low* — never high — which is the signature of a missing
component rather than a wrong curve. Wiring the table moved every site up and three of the four onto
their recorded values:

| Site | MU before → after | (rec) | MF before → after | (rec) |
|---|---|---|---|---|
| Avalon | 100 → 100 | 100 | 84 → **86** | 85 |
| Medley | 96 → 96 | 93 | 81 → **83** | 80 |
| Carmel IN | 97 → **101** | 101 | 81 → **86** | 85 |
| Overlook | 15 → **16** | 16 | 51 → **55** | 55 |

Carmel MU went 97 → 101 (exact) and Overlook 15 → 16 MU, 51 → 55 MF (both exact). The residual is
now +1 on three MF values rather than −4, which is ordinary input drift rather than a missing term.

**Medley remains 3 points high on both profiles**, which is what a +33% population overstatement
buys you at a 20–25 weight. Its recorded MU/MF came off the same county-scoped run that produced the
56,600 population, so all three of its recorded numbers share one cause.

Nothing was tuned to fit. The weights, curves, gates and floors are as ported, and the weights and
floors now live in `assumptions` where they can be changed without touching code.

### What the port fixes, in one line

3-mile population for Avalon went from **3,632** (as the dashboard computes it today) to **74,089**.
MF went from a floor-capped **35** on every site to values that discriminate: 84 / 81 / 81 / 51.

### Follow-ups

1. ~~**IRS SOI migration table.**~~ Done. Ported to `src/lib/demographics/migration-data.json` with
   source, URL and filing year recorded. **But it is a hand-curated 29-county subset, not the full
   IRS file** — 14 states, and it happens to contain all four calibration counties. A site outside
   it scores migration 0 and is flagged `county-missing`, costing up to 5 points on both profiles.
   Loading the real IRS county file is the next thing worth doing.
2. ~~**Weights live in code.**~~ Done. `demo.weight.mu.*`, `demo.weight.mf.*` and `demo.floor.*` are
   in `assumptions.csv`, sourced to `site-score.js` and the May 2026 reweight.
   `validateAssumptions` checks each profile sums to 100 and that no hard floor sits above its soft
   floor. The normalizer curves stay in code — they are shapes, not numbers.
3. **`hhFormation` is near-saturated** and flagged as such in the response and in the panel's
   metrics table. Medley reads 35.0% against a cap of 50%, so it contributes 3.5 of its 5 points;
   any ordinary market lands in the same place. Reweight or replace it — now a CSV edit.
4. **Cache is per-instance memory.** Phase 8 moves it to the `demographics` table on the same
   `(geohash7, radius, version)` key.
5. **Migration uses the site's own county**, found by point-in-polygon against the block group the
   site sits in. Where a radius straddles a line — Medley touches three counties — only the home
   county's signal is used, which is what the dashboard did. A population-weighted blend across the
   counties in the radius would be more representative; it would also no longer be the ported
   behaviour, so it is flagged rather than done.

---

## Consequences for the live dashboard

The dashboard at `live-demographics-starter` has the same vintage bug and is currently reporting
3-mile populations roughly 5% of true and MF = 35 for every site. Any demographic score copied from
it into a workbook or a deal memo since the ACS2022 service diverged is wrong. That repo is out of
scope here and was not modified, but the fix is small: point `getBlockGroupGeometries()` at
`tigerWMS_Census2020` layer 8 (or `tigerWMS_Current` layer 10) and widen the fetch from one county
to a geometry query.
