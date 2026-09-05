/**
 * Runs the demographics port against live Census data for the four calibration
 * sites and prints what it gets.
 *
 * Two jobs:
 *   1. `--anchor` computes Avalon's ungated MU raw score, which seeds
 *      `demo.mu.anchor_raw` in docs/assumptions.csv.
 *   2. Without a flag, scores all four sites so the results can be compared to
 *      the values recorded on the workbook's Demographics tab.
 *
 * Not a test. Tests must not depend on a live API; tests/demographics.test.ts
 * asserts against the fixtures this produces.
 *
 *   pnpm tsx --env-file-if-exists=.env.local scripts/demographics-probe.ts [--anchor]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseCsvRecords } from "@/lib/db/csv";
import { fetchDemographics } from "@/lib/demographics/census";
import {
  type AssumptionRow,
  buildAssumptions,
  muRawScore,
  scoreDemographics,
} from "@/lib/scoring";

/** Calibration sites, with the values recorded on the Demographics tab. */
const SITES = [
  { name: "Avalon", lat: 34.0705, lng: -84.2711, mu: 100, mf: 85, pop: 70_500 },
  { name: "Medley", lat: 34.0316536, lng: -84.1875997, mu: 93, mf: 80, pop: 56_600 },
  { name: "Carmel IN", lat: 39.9653, lng: -86.1583, mu: 101, mf: 85, pop: 59_900 },
  { name: "Overlook", lat: 34.2073, lng: -84.1402, mu: 16, mf: 55, pop: 35_200 },
] as const;

async function loadAssumptions(anchorOverride?: number) {
  const text = await readFile(
    path.join(process.cwd(), "docs", "assumptions.csv"),
    "utf8",
  );
  const rows: AssumptionRow[] = parseCsvRecords(text)
    .filter((r) => (r.key ?? "").trim() !== "")
    .map((r) => ({
      key: r.key.trim(),
      value: (r.value ?? "").trim() === "" ? null : r.value.trim(),
      source: r.source ?? null,
      asof: r.asof ?? null,
    }));

  // The anchor is a chicken-and-egg: computing it needs assumptions to build.
  const anchor = rows.find((r) => r.key === "demo.mu.anchor_raw");
  if (anchor) {
    anchor.value = String(anchorOverride ?? Number(anchor.value) ?? 1) || "1";
    if (!Number.isFinite(Number(anchor.value))) anchor.value = "1";
  }
  return buildAssumptions(rows);
}

async function main() {
  const anchorMode = process.argv.includes("--anchor");
  const assumptions = await loadAssumptions(anchorMode ? 1 : undefined);
  const radius = assumptions.demo.defaultRadiusMi;
  const year = assumptions.demo.acsYear;

  if (anchorMode) {
    const avalon = SITES[0];
    const agg = await fetchDemographics(avalon.lat, avalon.lng, radius, year);
    const raw = muRawScore(agg.metrics, assumptions);
    console.log(`Avalon ${radius}mi ACS${year}`);
    console.log(`  block groups : ${agg.blockGroupCount}`);
    console.log(`  coverage     : ${(agg.coverage * 100).toFixed(1)}%`);
    console.log(`  population   : ${Math.round(agg.population).toLocaleString()}`);
    console.log(`  avg HHI      : $${Math.round(agg.metrics.avgIncome ?? 0).toLocaleString()}`);
    console.log(`  bachelors+   : ${((agg.metrics.educationPct ?? 0) * 100).toFixed(1)}%`);
    console.log(`\n  demo.mu.anchor_raw = ${raw.toFixed(4)}`);
    return;
  }

  console.log(
    `ACS${year} · ${radius}mi · anchor ${assumptions.demo.muAnchorRaw} ` +
      `(MU scale ${(100 / assumptions.demo.muAnchorRaw).toFixed(4)})\n`,
  );
  console.log(
    "site        BGs  cov    population  (workbook)   avgHHI     bach+    MU  (rec)   MF  (rec)",
  );

  const results = [];
  for (const site of SITES) {
    const agg = await fetchDemographics(site.lat, site.lng, radius, year);
    const scored = scoreDemographics(agg.metrics, assumptions);
    const pop = Math.round(agg.population);
    const delta = ((pop - site.pop) / site.pop) * 100;
    results.push({ site, agg, scored, pop, delta });

    console.log(
      `${site.name.padEnd(11)}${String(agg.blockGroupCount).padStart(3)}` +
        `${(agg.coverage * 100).toFixed(0).padStart(5)}%` +
        `${pop.toLocaleString().padStart(12)}` +
        `${`(${site.pop.toLocaleString()})`.padStart(11)}` +
        `${("$" + Math.round(agg.metrics.avgIncome ?? 0).toLocaleString()).padStart(10)}` +
        `${(((agg.metrics.educationPct ?? 0) * 100).toFixed(1) + "%").padStart(8)}` +
        `${String(scored.mu).padStart(6)}${`(${site.mu})`.padStart(6)}` +
        `${String(scored.mf).padStart(5)}${`(${site.mf})`.padStart(6)}` +
        `   pop ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
    );
  }

  console.log("\nGate detail:");
  for (const r of results) {
    console.log(
      `  ${r.site.name.padEnd(11)} MU raw ${r.scored.muDetail.raw.toFixed(1)} ` +
        `belowSoft ${r.scored.muDetail.belowSoft} belowHard ${r.scored.muDetail.belowHard} ` +
        `x${r.scored.muDetail.multiplier} | MF raw ${r.scored.mfDetail.raw.toFixed(1)} ` +
        `belowSoft ${r.scored.mfDetail.belowSoft} belowHard ${r.scored.mfDetail.belowHard} ` +
        `x${r.scored.mfDetail.multiplier}`,
    );
  }

  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "demographics.json");
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(
    fixturePath,
    JSON.stringify(
      results.map((r) => ({
        name: r.site.name,
        lat: r.site.lat,
        lng: r.site.lng,
        radiusMi: radius,
        acsYear: year,
        metrics: r.agg.metrics,
        population: r.agg.population,
        counties: r.agg.counties,
        blockGroupCount: r.agg.blockGroupCount,
        recorded: { mu: r.site.mu, mf: r.site.mf, population: r.site.pop },
        computed: { mu: r.scored.mu, mf: r.scored.mf },
      })),
      null,
      2,
    ) + "\n",
  );
  console.log(`\nwrote ${fixturePath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
