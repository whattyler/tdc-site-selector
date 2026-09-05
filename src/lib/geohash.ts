/**
 * Geohash encoding. Pure, dependency-free.
 *
 * Seven characters is roughly a 153m × 153m cell — close enough that two
 * addresses on the same site collide, far enough apart that neighbouring sites
 * do not. That is the granularity the demographics cache keys on (spec A4).
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("geohash: lat and lng must be finite");
  }

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  let hash = "";
  let bits = 0;
  let bit = 0;
  let evenBit = true; // longitude first

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        bit = (bit << 1) + 1;
        lngMin = mid;
      } else {
        bit = bit << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bit = (bit << 1) + 1;
        latMin = mid;
      } else {
        bit = bit << 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;

    if (++bits === 5) {
      hash += BASE32[bit];
      bits = 0;
      bit = 0;
    }
  }

  return hash;
}
