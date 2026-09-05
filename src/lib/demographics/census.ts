/**
 * Census ACS fetch and radius interpolation. Server-only.
 *
 * Ported from the demographics dashboard, with the two defects the audit found
 * corrected (docs/demographics-port-report.md):
 *
 *   1. Geometry comes from `tigerWMS_Census2020` layer 8, whose block groups
 *      match the 2020 geography the 2022 ACS tables are published on. The
 *      dashboard queried `tigerWMS_ACS2022` layer 8, which is pre-2020 and
 *      joined only 251 of Fulton County's 858 block groups — the rest were
 *      silently dropped, and 3-mile populations came out at roughly 5% of
 *      true.
 *   2. Block groups are found by envelope intersection around the radius
 *      circle, not by county. The counties touched are an output. The
 *      dashboard filtered to the single county the address geocoded into and
 *      lost everything across a county line — which for Medley is most of
 *      Gwinnett.
 *
 * CENSUS_API_KEY is read here and never leaves the server.
 */

import area from "@turf/area";
import circle from "@turf/circle";
import { featureCollection } from "@turf/helpers";
import intersect from "@turf/intersect";
import type { Feature, Polygon, MultiPolygon } from "geojson";

import type { DemographicMetrics } from "@/lib/scoring";

import { migrationSignal } from "./migration";

const TIGER_BG =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query";
const ACS_BASE = "https://api.census.gov/data";

/** Only what the nine metrics need. The dashboard pulls ~84 for its UI. */
const ACS_VARIABLES = [
  "B01003_001E", // total population
  "B19025_001E", // aggregate household income
  "B11001_001E", // total households
  "B15003_001E", // population 25+
  "B15003_022E", // bachelor's
  "B15003_023E", // master's
  "B15003_024E", // professional
  "B15003_025E", // doctorate
  "B25064_001E", // median gross rent
  // Age 18-34 (young adult) and 30-44 (prime renter), male then female.
  "B01001_007E", "B01001_008E", "B01001_009E", "B01001_010E", "B01001_011E",
  "B01001_012E", "B01001_013E", "B01001_014E",
  "B01001_031E", "B01001_032E", "B01001_033E", "B01001_034E", "B01001_035E",
  "B01001_036E", "B01001_037E", "B01001_038E",
] as const;

/** Median gross rent is a median; everything else sums. */
const MEDIAN_VARIABLES = new Set<string>(["B25064_001E"]);

export interface CensusAggregate {
  metrics: DemographicMetrics;
  population: number;
  households: number;
  /** `SSCCC` FIPS for every county whose block groups fell inside the radius. */
  counties: string[];
  /** The county the site point sits in — the one migration is looked up on. */
  migrationCounty: string | null;
  blockGroupCount: number;
  /** Share of the circle covered by the block groups that were included. */
  coverage: number;
  acsYear: number;
}

export class CensusError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "CensusError";
    this.status = status;
  }
}

interface BlockGroupGeometry {
  geoid: string;
  state: string;
  county: string;
  areaLand: number;
  feature: Feature<Polygon | MultiPolygon>;
}

type AcsRow = Record<string, string>;

function censusKey(): string {
  const key = process.env.CENSUS_API_KEY;
  if (!key) {
    throw new CensusError(
      "CENSUS_API_KEY is not set on the server. api.census.gov refuses unkeyed requests.",
      500,
    );
  }
  return key;
}

async function fetchJson(url: string, what: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    throw new CensusError(
      `Could not reach ${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CensusError(
      `${what} returned ${response.status}: ${body.slice(0, 160).replace(/\s+/g, " ")}`,
    );
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    // An unkeyed or malformed Census request 302s to an HTML error page.
    const body = await response.text().catch(() => "");
    throw new CensusError(
      `${what} returned ${type || "no content-type"}: ${body.slice(0, 160).replace(/\s+/g, " ")}`,
    );
  }
  return response.json();
}

/**
 * Block groups whose geometry intersects the bounding envelope of the radius
 * circle. Crosses county and state lines, which is the point.
 */
async function fetchBlockGroupGeometries(
  lat: number,
  lng: number,
  radiusMi: number,
): Promise<BlockGroupGeometry[]> {
  // Degrees of latitude are ~69 mi everywhere; longitude shrinks with cosine.
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.cos((lat * Math.PI) / 180));

  const params = new URLSearchParams({
    geometry: `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "GEOID,STATE,COUNTY,AREALAND",
    returnGeometry: "true",
    f: "geojson",
  });

  const payload = (await fetchJson(`${TIGER_BG}?${params}`, "TIGERweb")) as {
    features?: Feature<Polygon | MultiPolygon, Record<string, unknown>>[];
  };

  const out: BlockGroupGeometry[] = [];
  for (const feature of payload.features ?? []) {
    const props = feature.properties ?? {};
    const geoid = String(props.GEOID ?? "");
    if (!geoid || !feature.geometry) continue;
    const areaLand = Number(props.AREALAND) || 0;
    // Pure-water block groups carry no population and would divide by zero.
    if (areaLand <= 0) continue;
    out.push({
      geoid,
      state: String(props.STATE ?? ""),
      county: String(props.COUNTY ?? ""),
      areaLand,
      feature,
    });
  }
  return out;
}

/** ACS rows for one county, keyed by 12-character block group GEOID. */
async function fetchCountyAcs(
  state: string,
  county: string,
  year: number,
): Promise<Map<string, AcsRow>> {
  const url =
    `${ACS_BASE}/${year}/acs/acs5?get=${ACS_VARIABLES.join(",")}` +
    `&for=block%20group:*&in=state:${state}%20county:${county}%20tract:*` +
    `&key=${censusKey()}`;

  const payload = (await fetchJson(url, "Census ACS")) as string[][];
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new CensusError(`Census ACS returned no rows for ${state}/${county}.`);
  }

  const header = payload[0];
  const rows = new Map<string, AcsRow>();
  for (const raw of payload.slice(1)) {
    const row: AcsRow = {};
    header.forEach((name, index) => {
      row[name] = raw[index];
    });
    rows.set(
      `${row.state}${row.county}${row.tract}${row["block group"]}`,
      row,
    );
  }
  return rows;
}

/** Ray casting against one linear ring. */
function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Outer ring minus holes, across every polygon in the feature. */
function pointInFeature(
  lng: number,
  lat: number,
  feature: Feature<Polygon | MultiPolygon>,
): boolean {
  const polygons: number[][][][] =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  for (const rings of polygons) {
    if (rings.length === 0) continue;
    if (!inRing(lng, lat, rings[0])) continue;
    const inHole = rings.slice(1).some((hole) => inRing(lng, lat, hole));
    if (!inHole) return true;
  }
  return false;
}

function numeric(row: AcsRow, key: string): number {
  const value = Number(row[key]);
  // ACS uses large negative sentinels (-666666666) for suppressed cells.
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Area-weighted aggregation over the block groups intersecting the circle.
 *
 * Weight is `intersection area / block-group LAND area`, clamped to 1, so
 * water inside a block group does not dilute its population credit. Sums are
 * weighted; the rent median is weighted by the population inside the
 * intersection.
 */
export async function fetchDemographics(
  lat: number,
  lng: number,
  radiusMi: number,
  acsYear: number,
): Promise<CensusAggregate> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new CensusError("lat and lng must be finite numbers.", 400);
  }
  if (!Number.isFinite(radiusMi) || radiusMi <= 0 || radiusMi > 25) {
    throw new CensusError("radius must be between 0 and 25 miles.", 400);
  }

  const geometries = await fetchBlockGroupGeometries(lat, lng, radiusMi);
  if (geometries.length === 0) {
    throw new CensusError(
      "No census block groups found near that point. Is it inside the United States?",
      404,
    );
  }

  // Migration is a county-level signal, so it is looked up on the county the
  // site itself sits in — not on every county the circle happens to clip.
  const containing = geometries.find((bg) => pointInFeature(lng, lat, bg.feature));
  const migrationCounty = containing
    ? `${containing.state}${containing.county}`
    : null;

  const ring = circle([lng, lat], radiusMi, { units: "miles", steps: 64 });
  const circleArea = area(ring);

  const weighted: { geoid: string; state: string; county: string; weight: number; iArea: number }[] =
    [];

  for (const bg of geometries) {
    let clipped: Feature<Polygon | MultiPolygon> | null = null;
    try {
      clipped = intersect(featureCollection([ring, bg.feature]));
    } catch {
      // A self-intersecting TIGER polygon; skip it rather than fail the site.
      continue;
    }
    if (!clipped) continue;

    const iArea = area(clipped);
    if (iArea <= 0) continue;

    weighted.push({
      geoid: bg.geoid,
      state: bg.state,
      county: bg.county,
      weight: Math.min(iArea / bg.areaLand, 1),
      iArea,
    });
  }

  if (weighted.length === 0) {
    throw new CensusError("No block groups intersect that radius.", 404);
  }

  // One ACS request per county actually touched, not per county guessed.
  const countyKeys = [...new Set(weighted.map((w) => `${w.state}/${w.county}`))].sort();
  const acsByCounty = new Map<string, Map<string, AcsRow>>();
  await Promise.all(
    countyKeys.map(async (key) => {
      const [state, county] = key.split("/");
      acsByCounty.set(key, await fetchCountyAcs(state, county, acsYear));
    }),
  );

  const sums: Record<string, number> = {};
  let rentNumerator = 0;
  let rentWeight = 0;
  let matched = 0;
  let matchedIArea = 0;

  for (const w of weighted) {
    const row = acsByCounty.get(`${w.state}/${w.county}`)?.get(w.geoid);
    if (!row) continue;
    matched++;
    matchedIArea += w.iArea;

    for (const key of ACS_VARIABLES) {
      if (MEDIAN_VARIABLES.has(key)) continue;
      sums[key] = (sums[key] ?? 0) + numeric(row, key) * w.weight;
    }

    const rent = numeric(row, "B25064_001E");
    const popInside = numeric(row, "B01003_001E") * w.weight;
    if (rent > 0 && popInside > 0) {
      rentNumerator += rent * popInside;
      rentWeight += popInside;
    }
  }

  if (matched === 0) {
    throw new CensusError(
      `None of the ${weighted.length} block groups in radius matched an ACS ${acsYear} row. ` +
        "This is the geography vintage mismatch the port was written to avoid.",
    );
  }

  const population = sums.B01003_001E ?? 0;
  const households = sums.B11001_001E ?? 0;
  const aggregateIncome = sums.B19025_001E ?? 0;
  const pop25 = sums.B15003_001E ?? 0;
  const bachelorsPlus =
    (sums.B15003_022E ?? 0) +
    (sums.B15003_023E ?? 0) +
    (sums.B15003_024E ?? 0) +
    (sums.B15003_025E ?? 0);

  const youngAdult = [
    "B01001_007E", "B01001_008E", "B01001_009E", "B01001_010E", "B01001_011E",
    "B01001_012E", "B01001_031E", "B01001_032E", "B01001_033E", "B01001_034E",
    "B01001_035E", "B01001_036E",
  ].reduce((total, key) => total + (sums[key] ?? 0), 0);

  const primeRenter = [
    "B01001_012E", "B01001_013E", "B01001_014E",
    "B01001_036E", "B01001_037E", "B01001_038E",
  ].reduce((total, key) => total + (sums[key] ?? 0), 0);

  const medianRent = rentWeight > 0 ? rentNumerator / rentWeight : null;
  const avgIncome = households > 0 ? aggregateIncome / households : null;
  const annualRent = medianRent === null ? null : medianRent * 12;

  const metrics: DemographicMetrics = {
    avgIncome,
    totalPop: population,
    educationPct: pop25 > 0 ? bachelorsPlus / pop25 : null,
    discretionary:
      avgIncome === null ? null : annualRent === null ? avgIncome : avgIncome - annualRent,
    // Null when the site's county is outside the 29-county IRS table, so the
    // absence is visible rather than defaulted to a neutral 0.5.
    migrationSignal: migrationCounty ? migrationSignal(migrationCounty) : null,
    hhFormation: population > 0 ? households / population : null,
    youngAdultPct: population > 0 ? youngAdult / population : null,
    rentToIncome:
      avgIncome && avgIncome > 0 && annualRent !== null ? annualRent / avgIncome : null,
    primeRenterPct: population > 0 ? primeRenter / population : null,
  };

  return {
    metrics,
    population,
    households,
    counties: countyKeys.map((key) => key.replace("/", "")),
    migrationCounty,
    blockGroupCount: matched,
    coverage: circleArea > 0 ? matchedIArea / circleArea : 0,
    acsYear,
  };
}
