import type { NextRequest } from "next/server";

/**
 * Nearby comps. Spec B5 §5.
 *
 * Places API (New) `searchNearby`, server key only. Two passes — apartment
 * complexes and retail centres — because a single call cannot rank two
 * unrelated types sensibly.
 *
 * Google returns buildings, not rents. Year built is not a Places field at
 * all, so `yearBuilt` is always null here; it stays in the shape because the
 * table has a column for it and Regrid (Phase 3b) can fill it.
 */

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

/** What the client gets. No Places internals leak through. */
export interface Comp {
  placeId: string;
  name: string;
  type: "apartment" | "retail";
  address: string | null;
  lat: number;
  lng: number;
  distanceMi: number;
  /** Places does not carry construction year. Always null today. */
  yearBuilt: number | null;
  rating: number | null;
  userRatingCount: number | null;
  /**
   * Below the ratings floor. Still returned and still shown — it is a flag,
   * not a filter.
   */
  lowSignal: boolean;
}

export interface CompsResponse {
  comps: Comp[];
  radiusMi: number;
}

interface PlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
}

/**
 * Ratings floor.
 *
 * `apartment_complex` is the only Places type for multifamily, and it catches
 * single houses — a real complex carries hundreds of reviews, a house carries
 * none. Retail gets the same floor for the same reason.
 *
 * It marks rather than removes, because the same test that catches a house
 * catches a building too new to have collected reviews — which is the comp you
 * would most want to see. Below the floor a comp arrives unticked and flagged;
 * whether it belongs in the set is a judgement, not a threshold.
 */
const MIN_RATING_COUNT = 5;

const EARTH_MI = 3958.8;

function haversineMi(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return EARTH_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchNearby(
  key: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  includedTypes: string[],
): Promise<PlaceResult[]> {
  const response = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      // Field mask is mandatory and is also what we are billed on, so it asks
      // for exactly what the table renders.
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.userRatingCount",
      ].join(","),
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
      },
      rankPreference: "POPULARITY",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Places returned ${response.status}: ${body.slice(0, 200).replace(/\s+/g, " ")}`,
    );
  }

  const payload = (await response.json()) as { places?: PlaceResult[] };
  return payload.places ?? [];
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const radiusMi = Number(params.get("radius") ?? 3);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat and lng are required." }, { status: 400 });
  }
  if (!Number.isFinite(radiusMi) || radiusMi <= 0 || radiusMi > 31) {
    // Places caps locationRestriction at 50,000 m.
    return Response.json(
      { error: "radius must be between 0 and 31 miles." },
      { status: 400 },
    );
  }

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    return Response.json(
      { error: "GOOGLE_MAPS_SERVER_KEY is not set on the server." },
      { status: 500 },
    );
  }

  const radiusMeters = Math.min(radiusMi * 1609.344, 50_000);

  try {
    const [apartments, retail] = await Promise.all([
      searchNearby(key, lat, lng, radiusMeters, ["apartment_complex"]),
      searchNearby(key, lat, lng, radiusMeters, ["shopping_mall"]),
    ]);

    const toComp = (place: PlaceResult, type: Comp["type"]): Comp | null => {
      const placeLat = place.location?.latitude;
      const placeLng = place.location?.longitude;
      if (!place.id || placeLat === undefined || placeLng === undefined) return null;
      return {
        placeId: place.id,
        name: place.displayName?.text ?? "(unnamed)",
        type,
        address: place.formattedAddress ?? null,
        lat: placeLat,
        lng: placeLng,
        distanceMi: haversineMi(lat, lng, placeLat, placeLng),
        yearBuilt: null,
        rating: place.rating ?? null,
        userRatingCount: place.userRatingCount ?? null,
        lowSignal: (place.userRatingCount ?? 0) < MIN_RATING_COUNT,
      };
    };

    const seen = new Set<string>();
    // Distance orders the list outright: the ratings floor is a flag on the
    // row, so it must not also reorder what sits next to what.
    const comps = [
      ...apartments.map((p) => toComp(p, "apartment")),
      ...retail.map((p) => toComp(p, "retail")),
    ]
      .filter((comp): comp is Comp => comp !== null)
      // The circle restriction is approximate at the edges; trim to the radius.
      .filter((comp) => comp.distanceMi <= radiusMi)
      .filter((comp) => {
        if (seen.has(comp.placeId)) return false;
        seen.add(comp.placeId);
        return true;
      })
      .sort((a, b) => a.distanceMi - b.distanceMi);

    return Response.json(
      { comps, radiusMi } satisfies CompsResponse,
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
