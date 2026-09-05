import type { NextRequest } from "next/server";

import type { GeocodeResult } from "@/lib/geocode";
import { encodeGeohash } from "@/lib/geohash";

/**
 * Address → lat/lng and jurisdiction. Spec B5 §1.
 *
 * The server key lives here and only here — it is never sent to the client, and
 * the browser key cannot call this API. Authentication is already handled by
 * proxy.ts, which gates everything except /api/auth.
 *
 * Not cached: an address lookup is per-deal and the result is stored on the
 * deal, so there is nothing to gain and a stale hit would be confusing.
 */

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodeResult {
  formatted_address: string;
  place_id?: string;
  geometry: { location: { lat: number; lng: number } };
  address_components: GoogleAddressComponent[];
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: GoogleGeocodeResult[];
}

/** First component carrying `type`, by short or long name. */
function component(
  components: GoogleAddressComponent[],
  type: string,
  form: "long" | "short" = "long",
): string | null {
  const match = components.find((item) => item.types.includes(type));
  if (!match) return null;
  return form === "short" ? match.short_name : match.long_name;
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return Response.json({ error: "Enter an address first." }, { status: 400 });
  }

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    return Response.json(
      { error: "GOOGLE_MAPS_SERVER_KEY is not set on the server." },
      { status: 500 },
    );
  }

  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);
  // Bias to the US; TDC does not screen sites outside it.
  url.searchParams.set("components", "country:US");

  let payload: GoogleGeocodeResponse;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return Response.json(
        { error: `Geocoding service returned ${response.status}.` },
        { status: 502 },
      );
    }
    payload = (await response.json()) as GoogleGeocodeResponse;
  } catch {
    return Response.json(
      { error: "Could not reach the geocoding service." },
      { status: 502 },
    );
  }

  // Status first. A denied or over-quota key also comes back with zero
  // results, and reporting that as "no match for that address" sends you
  // looking at the address instead of at the key.
  if (payload.status === "ZERO_RESULTS") {
    return Response.json(
      { error: "No match for that address." },
      { status: 404 },
    );
  }

  if (payload.status !== "OK") {
    // REQUEST_DENIED usually means the key is missing the Geocoding API or is
    // restricted to the wrong referrers — say which, rather than "failed".
    return Response.json(
      {
        error: `Geocoding failed: ${payload.status}${
          payload.error_message ? ` — ${payload.error_message}` : ""
        }`,
      },
      { status: 502 },
    );
  }

  if (!payload.results || payload.results.length === 0) {
    return Response.json(
      { error: "No match for that address." },
      { status: 404 },
    );
  }

  const top = payload.results[0];
  const { lat, lng } = top.geometry.location;
  const components = top.address_components;

  const result: GeocodeResult = {
    lat,
    lng,
    formattedAddress: top.formatted_address,
    city:
      component(components, "locality") ??
      component(components, "sublocality") ??
      component(components, "administrative_area_level_3"),
    // Google says "Fulton County"; the field wants "Fulton".
    county:
      component(components, "administrative_area_level_2")?.replace(
        /\s+County$/i,
        "",
      ) ?? null,
    state: component(components, "administrative_area_level_1", "short"),
    postalCode: component(components, "postal_code"),
    geohash7: encodeGeohash(lat, lng, 7),
    placeId: top.place_id ?? null,
  };

  return Response.json(result, {
    headers: { "cache-control": "private, no-store" },
  });
}
