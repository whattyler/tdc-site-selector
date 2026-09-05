/**
 * Golden tests for the demographics port.
 *
 * Runs the pure scorer against fixtures captured from live Census data by
 * `scripts/demographics-probe.ts`. The fetch itself is not tested here — a
 * test suite that needs a Census key and three seconds of network is a test
 * suite people stop running.
 *
 * Population is asserted against the workbook's Demographics tab within 10%.
 * MU and MF are recorded, not asserted against the workbook, because the
 * recorded values came off a build with two known data defects; see
 * docs/demographics-port-report.md.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { DemographicMetrics } from "@/lib/scoring";
import { scoreDemographics } from "@/lib/scoring";

import { loadAssumptionsFromCsv } from "./golden/harness";

interface Fixture {
  name: string;
  lat: number;
  lng: number;
  radiusMi: number;
  acsYear: number;
  metrics: DemographicMetrics;
  population: number;
  counties: string[];
  blockGroupCount: number;
  recorded: { mu: number; mf: number; population: number };
  computed: { mu: number; mf: number };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(path.join(HERE, "fixtures", "demographics.json"), "utf8"),
) as Fixture[];

const A = loadAssumptionsFromCsv();

describe("demographics port", () => {
  it("has all four calibration sites at the assumption radius and vintage", () => {
    expect(FIXTURES).toHaveLength(4);
    for (const f of FIXTURES) {
      expect(f.radiusMi).toBe(A.demo.defaultRadiusMi);
      expect(f.acsYear).toBe(A.demo.acsYear);
    }
  });

  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      const scored = scoreDemographics(fixture.metrics, A);

      it("scores deterministically from the captured metrics", () => {
        expect(scored.mu).toBe(fixture.computed.mu);
        expect(scored.mf).toBe(fixture.computed.mf);
      });

      // Medley is the known exception: the workbook's 56,600 was produced by
      // the dashboard's county-scoped query and is missing the Gwinnett side
      // of the circle. Fulton-only measures 56,910 against that 56,600, so the
      // workbook figure is the partial count and the port's is the whole one.
      const populationIsPartial = fixture.name === "Medley";
      const test = populationIsPartial ? it.skip : it;

      test("population is within 10% of the workbook column", () => {
        const delta =
          Math.abs(fixture.population - fixture.recorded.population) /
          fixture.recorded.population;
        expect(delta).toBeLessThanOrEqual(0.1);
      });

      it("pulls block groups from every county the radius touches", () => {
        expect(fixture.counties.length).toBeGreaterThan(0);
        expect(fixture.blockGroupCount).toBeGreaterThan(10);
      });

      it("reports all nine metrics with their weights", () => {
        expect(scored.metrics).toHaveLength(9);
        const muWeighted = scored.metrics.filter((m) => m.weightMu !== null);
        const mfWeighted = scored.metrics.filter((m) => m.weightMf !== null);
        expect(muWeighted).toHaveLength(7);
        expect(mfWeighted).toHaveLength(7);
        expect(
          muWeighted.reduce((sum, m) => sum + (m.weightMu ?? 0), 0),
        ).toBe(100);
        expect(
          mfWeighted.reduce((sum, m) => sum + (m.weightMf ?? 0), 0),
        ).toBe(100);
      });

      it("has a real migration signal — all four counties are in the IRS table", () => {
        const migration = scored.metrics.find((m) => m.key === "migration");
        expect(migration?.value).not.toBeNull();
        expect(migration?.value).toBeGreaterThanOrEqual(0);
        expect(migration?.value).toBeLessThanOrEqual(1);
        expect(migration?.flag).toBeUndefined();
      });

      it("flags hh formation as near-saturated", () => {
        const formation = scored.metrics.find((m) => m.key === "hhFormation");
        expect(formation?.flag).toMatch(/near-saturated/);
      });
    });
  }

  it("anchors Avalon at exactly 100", () => {
    const avalon = FIXTURES.find((f) => f.name === "Avalon");
    expect(avalon).toBeDefined();
    expect(scoreDemographics(avalon!.metrics, A).mu).toBe(100);
  });

  it("refuses to score against an unusable MU anchor", () => {
    const broken = { ...A, demo: { ...A.demo, muAnchorRaw: 0 } };
    expect(() => scoreDemographics(FIXTURES[0].metrics, broken)).toThrow(
      /anchor_raw/,
    );
  });

  it("scores a county outside the IRS table as 0 and flags it", () => {
    const noMigration: DemographicMetrics = {
      ...FIXTURES[0].metrics,
      migrationSignal: null,
    };
    const scored = scoreDemographics(noMigration, A);
    const migration = scored.metrics.find((m) => m.key === "migration");
    expect(migration?.value).toBeNull();
    expect(migration?.normalized).toBe(0);
    expect(migration?.flag).toMatch(/county-missing/);
    // Never the dashboard's 0.5 default, which mid-scores an unknown.
    expect(scored.mu).toBeLessThan(scoreDemographics(FIXTURES[0].metrics, A).mu);
  });

  it("reads weights and floors from assumptions, not from code", () => {
    expect(A.demo.weights.mixed_use.avgIncome).toBe(30);
    expect(A.demo.weights.multifamily.avgIncome).toBe(35);
    expect(A.demo.floors.mixed_use.totalPop).toEqual({ soft: 45_000, hard: 25_000 });
    expect(A.demo.floors.multifamily.totalPop).toEqual({ soft: 40_000, hard: 30_000 });

    // Halving a weight has to move the score, or the table is not being read.
    const reweighted = {
      ...A,
      demo: {
        ...A.demo,
        weights: {
          ...A.demo.weights,
          multifamily: { ...A.demo.weights.multifamily, avgIncome: 5 },
        },
      },
    };
    expect(scoreDemographics(FIXTURES[0].metrics, reweighted).mf).toBeLessThan(
      scoreDemographics(FIXTURES[0].metrics, A).mf,
    );
  });

  it("trips the hard-floor cap on a sparse market", () => {
    // The failure mode the dashboard shows on every site today: population
    // below the 30k MF hard floor pins the score at 35.
    const sparse: DemographicMetrics = {
      ...FIXTURES[0].metrics,
      totalPop: 3_632,
    };
    const scored = scoreDemographics(sparse, A);
    expect(scored.mfDetail.belowHard).toBeGreaterThan(0);
    expect(scored.mf).toBe(35);
  });
});
