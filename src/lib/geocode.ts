/**
 * Shared shape between the geocode route handler and its caller.
 *
 * The route is the only thing that ever sees GOOGLE_MAPS_SERVER_KEY; the client
 * gets this object and nothing else.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** Google's formatted_address, which is what goes back in the field. */
  formattedAddress: string;
  city: string | null;
  county: string | null;
  /** Two-letter state code. */
  state: string | null;
  postalCode: string | null;
  geohash7: string;
  /** Google's own id for the place, for later Places calls. */
  placeId: string | null;
}

export interface GeocodeError {
  error: string;
}

export type GeocodeResponse = GeocodeResult | GeocodeError;

export function isGeocodeError(
  response: GeocodeResponse,
): response is GeocodeError {
  return "error" in response;
}

/** `Johns Creek, GA` — what the submarket field gets filled with. */
export function submarketFrom(result: GeocodeResult): string {
  return [result.city, result.state].filter(Boolean).join(", ");
}
