"use client";

import { useEffect, useRef, useState } from "react";

import { asset } from "@/lib/base-path";
import {
  type GeocodeResponse,
  type GeocodeResult,
  isGeocodeError,
  submarketFrom,
} from "@/lib/geocode";
import { useParcelLookup } from "@/lib/parcel";
import type { ProductTypeSetting } from "@/lib/scoring";
import { cn } from "@/lib/utils";

import type { Comp } from "@/app/api/comps/route";

import { FieldGrid, InputSection, NumberField, SelectField, TextField } from "./fields";
import { SatelliteAerial } from "./satellite-aerial";

export interface DealFields {
  name: string;
  address: string;
  submarket: string;
  productType: ProductTypeSetting;
  mu: string;
  mf: string;
  acreage: string;
  /** Filled by the geocoder, not typed. */
  lat: number | null;
  lng: number | null;
  geohash7: string | null;
  county: string | null;
  state: string | null;
  /**
   * The submarket the last geocode produced. Lets the page tell a value it
   * filled in from one the user typed, so a re-geocode never overwrites a hand
   * correction.
   */
  lastSubmarketFromGeocode: string | null;
  /**
   * Where MU/MF came from. Flips to `manual` the moment either field is
   * edited, and never flips back on its own.
   */
  demoSource: "none" | "api" | "manual" | "failed";
  demoDetail: string | null;
}

/** A deal with nothing in it. What "New deal" opens. */
export const EMPTY_DEAL: DealFields = {
  name: "",
  address: "",
  submarket: "",
  productType: "auto",
  mu: "",
  mf: "",
  acreage: "",
  lat: null,
  lng: null,
  geohash7: null,
  county: null,
  state: null,
  lastSubmarketFromGeocode: null,
  demoSource: "none",
  demoDetail: null,
};

/**
 * Medley, the reference deal. Reachable at `?demo=medley`.
 *
 * This used to be what the root opened on, so the page never showed eleven
 * blank fields. Phase 8 made that dangerous rather than friendly: with a Save
 * button and a shared pipeline, a pre-filled default is one keystroke away from
 * putting a deal called Medley, with Medley's program and Medley's acreage,
 * into everyone's list. A new deal is now blank, and the worked example is
 * something you ask for.
 */
export const DEFAULT_DEAL: DealFields = {
  name: "Medley",
  address: "11650 Johns Creek Pkwy, Johns Creek, GA 30097",
  submarket: "",
  productType: "mixed_use",
  mu: "",
  mf: "",
  // Medley's site. Without it the per-acre sitework line resolves to zero and
  // the default cost stack is ~$26M light.
  acreage: "55.47",
  lat: null,
  lng: null,
  geohash7: null,
  county: null,
  state: null,
  lastSubmarketFromGeocode: null,
  demoSource: "none",
  demoDetail: null,
};

const DEMO_SOURCE_LABEL: Record<DealFields["demoSource"], string> = {
  none: "Not pulled yet",
  api: "Census ACS",
  manual: "Typed by hand",
  failed: "Pull failed — type them",
};

interface DealInputsProps {
  values: DealFields;
  onChange: <K extends keyof DealFields>(key: K, value: DealFields[K]) => void;
  onGeocoded: (result: GeocodeResult) => void;
  /** Editing either score by hand flips the source to manual. */
  onDemographicEdit: (key: "mu" | "mf", value: string) => void;
  demographicsStatus: "idle" | "loading";
  /** What the product type selects, for the hint under the score fields. */
  governing: "Mixed-Use" | "Multifamily" | "neither";
  /** Drawn on the aerial's road-map view. Spec B5 §5. */
  comps?: Comp[];
  includedCompIds?: ReadonlySet<string>;
}

export function DealInputs({
  values,
  onChange,
  onGeocoded,
  onDemographicEdit,
  demographicsStatus,
  governing,
  comps,
  includedCompIds,
}: DealInputsProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // The address a lookup last ran for, so blurring an untouched field is free.
  const lastLookedUp = useRef<string | null>(null);
  const bootstrapped = useRef(false);

  // No-op until Phase 3b. Acreage stays typed.
  const parcel = useParcelLookup(values.lat, values.lng);

  async function geocode() {
    const address = values.address.trim();
    if (address === "" || address === lastLookedUp.current) return;

    lastLookedUp.current = address;
    setStatus("loading");
    setError(null);

    try {
      const response = await fetch(
        `${asset("/api/geocode")}?address=${encodeURIComponent(address)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as GeocodeResponse;

      if (!response.ok || isGeocodeError(payload)) {
        // Leave the typed address exactly as it is — a failed lookup should
        // never cost you what you typed.
        setStatus("error");
        setError(
          isGeocodeError(payload) ? payload.error : "Could not geocode that address.",
        );
        lastLookedUp.current = null;
        return;
      }

      setStatus("idle");
      onGeocoded(payload);
    } catch {
      setStatus("error");
      setError("Could not reach the geocoder.");
      lastLookedUp.current = null;
    }
  }

  /**
   * Geocode and score the default deal once, on mount. Runs the same path a
   * blur does, so a failure here reports itself the same way.
   *
   * Deferred by a tick so the first state update lands after mount rather than
   * during the effect body.
   */
  useEffect(() => {
    if (values.address.trim() === "" || values.lat !== null) return;
    const timer = setTimeout(() => {
      // The guard lives inside the timer, not in the effect body. React's dev
      // double-invoke runs the effect, cancels it, and runs it again — a ref
      // set on the first pass would make the second pass skip, and the work
      // would never happen at all.
      if (bootstrapped.current) return;
      bootstrapped.current = true;
      void geocode();
    }, 0);
    return () => clearTimeout(timer);
    // Mount only: re-running this on every address keystroke is exactly what
    // the blur and Enter handlers are for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <InputSection title="Deal · Site · Demographics">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <FieldGrid columns={3}>
            <TextField
              label="Deal name"
              value={values.name}
              onChange={(value) => onChange("name", value)}
              placeholder="Deal name"
            />

            <label className="col-span-2 block">
              <span className="micro block leading-none">Address</span>
              <span className="mt-1 block">
                <input
                  type="text"
                  value={values.address}
                  placeholder="Street, city, state"
                  onChange={(event) => onChange("address", event.target.value)}
                  onBlur={() => void geocode()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void geocode();
                    }
                  }}
                  className={cn(
                    "w-full border-b bg-transparent px-0 py-1 text-ink",
                    "placeholder:text-ink-3 focus:outline-none",
                    status === "error"
                      ? "border-maybe focus:border-maybe"
                      : "border-line-strong focus:border-[var(--toro-red)]",
                  )}
                />
              </span>
              <span className="mt-0.5 block">
                {status === "loading" && (
                  <span className="caption">Geocoding…</span>
                )}
                {status === "error" && error && (
                  <span className="text-sm text-maybe">{error}</span>
                )}
                {status === "idle" && values.county && (
                  <span className="caption">
                    {values.county} County
                    {values.state ? `, ${values.state}` : ""}
                    {values.lat !== null && values.lng !== null
                      ? ` · ${values.lat.toFixed(5)}, ${values.lng.toFixed(5)}`
                      : ""}
                    {values.geohash7 ? ` · ${values.geohash7}` : ""}
                  </span>
                )}
                {status === "idle" && !values.county && (
                  <span className="caption">
                    Blur or press Enter to geocode
                  </span>
                )}
              </span>
            </label>

            <TextField
              label="Submarket"
              value={values.submarket}
              onChange={(value) => onChange("submarket", value)}
              placeholder="City, ST"
              hint="Filled from the geocode · overridable"
            />
            <SelectField
              label="Product type"
              value={values.productType}
              onChange={(value) => onChange("productType", value)}
              options={[
                { value: "mixed_use", label: "Mixed-Use" },
                { value: "multifamily", label: "Multifamily" },
                { value: "auto", label: "Auto — not set" },
              ]}
              hint="Selects which dashboard score governs"
            />
            <NumberField
              label="Site acreage"
              suffix="ac"
              value={values.acreage}
              onChange={(value) => onChange("acreage", value)}
              hint={parcel.enabled ? undefined : "Typed · Regrid lands in Phase 3b"}
            />

            <NumberField
              label="Mixed-Use score"
              value={values.mu}
              onChange={(value) => onDemographicEdit("mu", value)}
              hint={governing === "Mixed-Use" ? "Governing" : undefined}
            />
            <NumberField
              label="Multifamily score"
              value={values.mf}
              onChange={(value) => onDemographicEdit("mf", value)}
              hint={governing === "Multifamily" ? "Governing" : undefined}
            />
            <div className="self-end pb-1">
              <span className="micro block leading-none">Source</span>
              <span
                className={cn(
                  "mt-1 block text-sm",
                  values.demoSource === "failed" ? "text-maybe" : "text-ink",
                )}
              >
                {demographicsStatus === "loading"
                  ? "Pulling from the Census…"
                  : DEMO_SOURCE_LABEL[values.demoSource]}
              </span>
              {values.demoDetail && (
                <span
                  className={cn(
                    "mt-0.5 block text-sm",
                    values.demoSource === "failed" ? "text-maybe" : "text-ink-3",
                  )}
                >
                  {values.demoDetail}
                </span>
              )}
            </div>
          </FieldGrid>
        </div>

        <SatelliteAerial
          lat={values.lat}
          lng={values.lng}
          label={values.name || values.address || "Site"}
          comps={comps}
          includedCompIds={includedCompIds}
        />
      </div>
    </InputSection>
  );
}

export { submarketFrom };
