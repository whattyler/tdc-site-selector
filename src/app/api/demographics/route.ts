import type { NextRequest } from "next/server";

import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { readCache, writeCache } from "@/lib/db/demographics-cache";
import { CensusError, fetchDemographics } from "@/lib/demographics/census";
import { encodeGeohash } from "@/lib/geohash";
import { scoreDemographics, type ScoredMetric } from "@/lib/scoring";

/**
 * Demographics for a point. Spec B5 §2.
 *
 * The scoring is ported from the dashboard rather than fetched from it over
 * OIDC — see docs/demographics-port-report.md for why, and for the two data
 * defects this port corrects.
 *
 * CENSUS_API_KEY stays on the server. Authentication is handled by proxy.ts.
 */

export interface DemographicsResponse {
  mu: number;
  mf: number;
  population: number;
  radius: number;
  acsYear: number;
  /** `SSCCC` FIPS for every county whose block groups fell in the radius. */
  counties: string[];
  metrics: ScoredMetric[];
  version: string;
  pulledAt: string;
}

/**
 * Bump when the scoring model changes — weights, curves, gates, or the shape
 * of the aggregation. It joins the ACS year in the cache key so a model change
 * invalidates cached results the same way a vintage change does.
 */
const SCORING_REVISION = 1;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json(
      { error: "lat and lng are required." },
      { status: 400 },
    );
  }

  let assumptions;
  try {
    ({ assumptions } = await loadAssumptionsForRequest());
  } catch (error) {
    return Response.json(
      {
        error: `Could not load assumptions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }

  const radiusParam = params.get("radius");
  const radius =
    radiusParam === null ? assumptions.demo.defaultRadiusMi : Number(radiusParam);
  if (!Number.isFinite(radius) || radius <= 0) {
    return Response.json({ error: "radius must be a positive number." }, { status: 400 });
  }

  const acsYear = assumptions.demo.acsYear;
  const version = `acs${acsYear}/s${SCORING_REVISION}`;
  const geohash7 = encodeGeohash(lat, lng, 7);
  const key = { geohash7, radiusMi: radius, version };

  const hit = await readCache<DemographicsResponse>(key);
  if (hit) {
    return Response.json(hit, {
      headers: { "cache-control": "private, no-store", "x-cache": "hit" },
    });
  }

  try {
    const aggregate = await fetchDemographics(lat, lng, radius, acsYear);
    const scored = scoreDemographics(aggregate.metrics, assumptions);

    const body: DemographicsResponse = {
      mu: scored.mu,
      mf: scored.mf,
      population: Math.round(aggregate.population),
      radius,
      acsYear,
      counties: aggregate.counties,
      metrics: scored.metrics,
      version,
      pulledAt: new Date().toISOString(),
    };

    await writeCache(key, body);

    return Response.json(body, {
      headers: { "cache-control": "private, no-store", "x-cache": "miss" },
    });
  } catch (error) {
    // Errors surface as errors. The dashboard turns a failure into a
    // floor-tripped score, which reads as a legitimate NO-GO; never do that.
    if (error instanceof CensusError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      {
        error: `Demographics failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
