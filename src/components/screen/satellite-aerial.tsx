"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Satellite aerial of the site. Spec B5 §1.
 *
 * Maps JS with the browser key only — the server key never reaches the client.
 * Scroll to zoom, drag to pan, so the shape of the parcel and what surrounds it
 * can be read without leaving the page.
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

interface SatelliteAerialProps {
  lat: number | null;
  lng: number | null;
  /** Shown as the link text target; the pin needs no label of its own. */
  label: string;
}

export function SatelliteAerial({ lat, lng, label }: SatelliteAerialProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  const hasPin = lat !== null && lng !== null;

  // A missing key is knowable at render, so it is derived rather than pushed
  // into state from inside the effect.
  const error = key
    ? loadError
    : "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not set.";

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
            mapTypeId: "satellite",
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

        if (marker.current) {
          marker.current.setPosition(position);
        } else {
          marker.current = new google.maps.Marker({
            position,
            map: map.current,
            title: label,
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
  }, [hasPin, lat, lng, label, key]);

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

      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-sm text-ink underline underline-offset-2 hover:text-[var(--toro-red)]"
        >
          Open in Google Maps ↗
        </a>
      ) : (
        <span className="caption mt-1.5 inline-block">Open in Google Maps ↗</span>
      )}
    </div>
  );
}
