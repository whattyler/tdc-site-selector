/**
 * Parcel lookup. Stub until Phase 3b.
 *
 * Acreage is typed by hand for now. When Regrid is wired, `lookupParcel` calls
 * it from a route handler with REGRID_API_KEY and returns the parcel geometry,
 * acreage and APN; nothing else in the page has to change, because the hook
 * already returns this shape.
 *
 * Deliberately a no-op rather than absent: the call site exists, so turning it
 * on is a change in one file instead of a change in the Deal section.
 */

export interface Parcel {
  /** Assessor's parcel number. */
  apn: string | null;
  acreage: number | null;
  /** GeoJSON polygon, for outlining the parcel on the aerial. */
  geometry: unknown | null;
  source: "regrid";
}

export interface ParcelLookup {
  parcel: Parcel | null;
  loading: boolean;
  /** Null while the feature is off, so callers can tell "off" from "failed". */
  error: string | null;
  enabled: boolean;
}

const DISABLED: ParcelLookup = {
  parcel: null,
  loading: false,
  error: null,
  enabled: false,
};

/**
 * Returns a disabled lookup until Phase 3b. Takes the coordinates it will need
 * so the call site is already correct.
 */
export function useParcelLookup(
  lat: number | null,
  lng: number | null,
): ParcelLookup {
  // Phase 3b fetches on these. Referenced now so the signature is the real one
  // and turning the feature on does not change any call site.
  void lat;
  void lng;
  return DISABLED;
}
