"use client";

import { useEffect, useRef, useState } from "react";

import type { Comp } from "@/app/api/comps/route";
import { cn } from "@/lib/utils";

/**
 * Satellite aerial of the site. Spec B5 §1, extended in §5 to carry comps.
 *
 * Maps JS with the browser key only — the server key never reaches the client.
 * Scroll to zoom, drag to pan, so the shape of the parcel and what surrounds it
 * can be read without leaving the page.
 *
 * Two views, because they answer different questions. Satellite at zoom 17 is
 * the parcel: what is on it, what abuts it. Map zooms out to hold every comp,
 * where labelled roads and place names are what you are actually reading —
 * a 3-mile radius of aerial photography tells you nothing.
 */

const MAPS_SRC = "https://maps.googleapis.com/maps/api/js?v=weekly&libraries=maps";

/** Global Maps calls back into this once the API is genuinely ready. */
const READY_CALLBACK = "__tdcMapsReady";

/** One loader for the whole page, however many maps end up on it. */
let mapsPromise: Promise<void> | null = null;

function loadMapsApi(key: string): Promise<void> {
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Maps JS can only load in the browser"));
      return;
    }
    if (window.google?.maps) {
      resolve();
      return;
    }

    // `loading=async` is what Google asks for, but with it the script's onload
    // fires before google.maps exists — the callback is the ready signal.
    (window as unknown as Record<string, unknown>)[READY_CALLBACK] = () =>
      resolve();

    const script = document.createElement("script");
    script.src =
      `${MAPS_SRC}&loading=async&callback=${READY_CALLBACK}` +
      `&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      mapsPromise = null;
      reject(new Error("Could not load Google Maps."));
    };
    document.head.appendChild(script);
  });

  return mapsPromise;
}

type MapView = "satellite" | "roadmap";

/** Brand semantics: amber for the rental comps, slate for retail. */
const COMP_FILL: Record<Comp["type"], string> = {
  apartment: "#D9A441",
  retail: "#9AA3AD",
};

interface SatelliteAerialProps {
  lat: number | null;
  lng: number | null;
  /** Shown as the link text target; the pin needs no label of its own. */
  label: string;
  comps?: Comp[];
  /** Included comps read solid; the rest stay on the map but recede. */
  includedCompIds?: ReadonlySet<string>;
}

export function SatelliteAerial({
  lat,
  lng,
  label,
  comps = [],
  includedCompIds,
}: SatelliteAerialProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const compMarkers = useRef<google.maps.Marker[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<MapView>("satellite");
  // The map is built inside a promise, so a ref alone leaves the marker and
  // view effects racing it — they read `map.current` as null and never re-run.
  // This is the signal they wait on.
  const [mapReady, setMapReady] = useState(false);

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  const hasPin = lat !== null && lng !== null;

  // A missing key is knowable at render, so it is derived rather than pushed
  // into state from inside the effect.
  const error = key
    ? loadError
    : "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not set.";

  // Serialised so the marker effect re-runs on a change of comps or ticks,
  // not on every render of the parent.
  const compsKey = JSON.stringify(
    comps.map((comp) => [
      comp.placeId,
      comp.lat,
      comp.lng,
      comp.type,
      includedCompIds ? includedCompIds.has(comp.placeId) : true,
    ]),
  );

  useEffect(() => {
    if (!hasPin || !container.current || !key) return;

    let cancelled = false;
    const position = { lat, lng };

    loadMapsApi(key)
      .then(() => {
        if (cancelled || !container.current) return;
        setLoadError(null);

        if (!map.current) {
          map.current = new google.maps.Map(container.current, {
            center: position,
            zoom: 17,
            mapTypeId: view,
            tilt: 0,
            // Scroll to zoom without holding a modifier: this is a working
            // surface, not an embed someone scrolls past.
            gestureHandling: "greedy",
            scrollwheel: true,
            disableDefaultUI: true,
            zoomControl: true,
            fullscreenControl: true,
            keyboardShortcuts: false,
            // Keeps the controls dark rather than the default white chrome.
            colorScheme: "DARK",
          } as google.maps.MapOptions);
        } else {
          map.current.setCenter(position);
        }
        setMapReady(true);

        if (marker.current) {
          marker.current.setPosition(position);
        } else {
          marker.current = new google.maps.Marker({
            position,
            map: map.current,
            title: label,
            zIndex: 100,
          });
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
    // `view` is deliberately not a dependency: the toggle effect below owns it,
    // so a view change does not re-run map construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPin, lat, lng, label, key]);

  // ── Comp markers ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !map.current || !window.google?.maps) return;

    for (const existing of compMarkers.current) existing.setMap(null);
    compMarkers.current = [];

    for (const comp of comps) {
      const included = includedCompIds ? includedCompIds.has(comp.placeId) : true;
      compMarkers.current.push(
        new google.maps.Marker({
          position: { lat: comp.lat, lng: comp.lng },
          map: map.current,
          title: `${comp.name} · ${comp.distanceMi.toFixed(2)} mi`,
          zIndex: included ? 50 : 10,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: included ? 6 : 4.5,
            fillColor: COMP_FILL[comp.type],
            fillOpacity: included ? 0.95 : 0.3,
            strokeColor: "#1B1F24",
            strokeWeight: 1.5,
          },
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compsKey, mapReady]);

  // ── View toggle ─────────────────────────────────────────────────────────
  // Satellite goes back to the parcel; map opens out far enough to hold every
  // comp, which is the only reason to be on the road map at all.
  useEffect(() => {
    if (!mapReady || !map.current || !window.google?.maps || !hasPin) return;
    map.current.setMapTypeId(view);

    if (view === "satellite" || comps.length === 0) {
      map.current.setCenter({ lat, lng });
      map.current.setZoom(17);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat, lng });
    for (const comp of comps) bounds.extend({ lat: comp.lat, lng: comp.lng });
    map.current.fitBounds(bounds, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, compsKey, hasPin, lat, lng, mapReady]);

  const mapsUrl = hasPin
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : null;

  return (
    <div className="shrink-0" style={{ width: "420px" }}>
      <div
        className="relative border border-line-strong bg-surface-2"
        style={{ height: "280px" }}
      >
        {hasPin && !error ? (
          <div ref={container} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <p className="caption">
              {error ?? "Geocode an address to see the site from above."}
            </p>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-ink underline underline-offset-2 hover:text-[var(--toro-red)]"
          >
            Open in Google Maps ↗
          </a>
        ) : (
          <span className="caption">Open in Google Maps ↗</span>
        )}

        {hasPin && !error && (
          <span className="flex items-baseline gap-3">
            {(["satellite", "roadmap"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={cn(
                  "micro leading-none",
                  view === option
                    ? "text-ink underline underline-offset-4"
                    : "hover:text-ink-2",
                )}
              >
                {option === "satellite" ? "Satellite" : `Map · ${comps.length} comps`}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
