"use client";

import { useEffect, useState } from "react";

import { asset } from "@/lib/base-path";
import { parseNumber } from "@/lib/format";
import type { DemographicsResponse } from "@/app/api/demographics/route";
import { type GeocodeResult, submarketFrom } from "@/lib/geocode";
import {
  type Answer,
  type Assumptions,
  combinedVerdict,
  evaluateDemographics,
  firstLook,
  type FirstLookResult,
  type Gate2Result,
  allocateCostExLand,
  type CostResolution,
  type CostSelection,
  PAD_RATE_KEYS,
  type ScoredMetric,
  screenDeal,
} from "@/lib/scoring";

import { DealInputs, type DealFields, DEFAULT_DEAL } from "./deal-inputs";
import {
  EMPTY_FIRST_LOOK,
  FirstLookInputs,
  type FirstLookFieldKey,
  type FirstLookFields,
} from "./first-look-inputs";
import { CostSection } from "./cost-section";
import { Gate1Table } from "./gate1-table";
import {
  MEDLEY_PROGRAM,
  ProgramInputs,
  type ProgramFields,
} from "./program-inputs";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { VerdictPanel } from "./verdict-panel";

/**
 * Medley carries 112,011 RSF of office, but the budget has no new office shell
 * rate — Building 4000 is an existing-building renovation at $49/SF plus a
 * $1.22M mechanical scope, which is ~$60/SF all in. Without this the default
 * deal cannot resolve at all, because an unpriced line with a quantity throws.
 */
const DEFAULT_COST_SELECTIONS: Record<string, CostSelection> = {
  office_shell: {
    lineKey: "office_shell",
    source: "custom",
    multiplier: 1,
    customRate: 60,
  },
};

interface ScreenPageProps {
  assumptions: Assumptions;
  /** Shown in the header so it is obvious where the numbers came from. */
  assumptionsOrigin: string;
  user: { name: string | null; upn: string | null };
}

/**
 * Phase 2: the screen page.
 *
 * All state is local. Nothing is written to the database yet — reloading the
 * page loses the deal, which is the honest behaviour until Phase 8 adds save.
 */
export function ScreenPage({
  assumptions,
  assumptionsOrigin,
  user,
}: ScreenPageProps) {
  const [deal, setDeal] = useState<DealFields>(DEFAULT_DEAL);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [probability, setProbability] = useState(assumptions.probability.default);
  const [fl, setFl] = useState<FirstLookFields>(EMPTY_FIRST_LOOK);
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading">("idle");
  const [demoMetrics, setDemoMetrics] = useState<ScoredMetric[] | null>(null);
  const [program, setProgram] = useState<ProgramFields>(MEDLEY_PROGRAM);
  const [costSelections, setCostSelections] =
    useState<Record<string, CostSelection>>(DEFAULT_COST_SELECTIONS);
  const [globalMultiplier, setGlobalMultiplier] = useState(1);
  const [costs, setCosts] = useState<CostResolution | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [libraryOrigin, setLibraryOrigin] = useState<string | null>(null);

  /**
   * Pull MU/MF for a geocoded point. Fields stay editable throughout, and a
   * failure says why rather than leaving zeros behind.
   */
  async function pullDemographics(lat: number, lng: number) {
    setDemoStatus("loading");
    try {
      const response = await fetch(
        `${asset("/api/demographics")}?lat=${lat}&lng=${lng}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | DemographicsResponse
        | { error: string };

      if (!response.ok || "error" in payload) {
        setDemoStatus("idle");
        setDeal((current) => ({
          ...current,
          demoSource: "failed",
          demoDetail:
            "error" in payload ? payload.error : "Could not reach the Census.",
        }));
        return;
      }

      setDemoStatus("idle");
      setDemoMetrics(payload.metrics);
      setDeal((current) => ({
        ...current,
        mu: String(payload.mu),
        mf: String(payload.mf),
        demoSource: "api",
        demoDetail:
          `ACS ${payload.acsYear} · ${payload.radius} mi · ` +
          `pop ${payload.population.toLocaleString()} · ` +
          `${payload.counties.length} count${payload.counties.length === 1 ? "y" : "ies"}`,
      }));
    } catch (error) {
      setDemoStatus("idle");
      setDeal((current) => ({
        ...current,
        demoSource: "failed",
        demoDetail: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  // ── Costs ───────────────────────────────────────────────────────────────
  const spaces = parseNumber(program.parkingSpaces) ?? 0;
  // Structured and surface are separate library lines. "Mixed" splits evenly
  // for now — a real split needs a field the program does not yet carry.
  const structuredShare =
    program.parkingType === "structured" ? 1 : program.parkingType === "mixed" ? 0.5 : 0;

  const costProgram = {
    resiUnits: parseNumber(program.resiUnits) ?? 0,
    resiGsf: parseNumber(program.resiGsf) ?? 0,
    retailSf: parseNumber(program.retailSf) ?? 0,
    officeSf: parseNumber(program.officeSf) ?? 0,
    parkingStructuredSpaces: Math.round(spaces * structuredShare),
    parkingSurfaceSpaces: spaces - Math.round(spaces * structuredShare),
    acreage: parseNumber(deal.acreage) ?? 0,
  };
  // Serialised so the effect re-runs on a value change, not on every render.
  const costRequestKey = JSON.stringify({
    costProgram,
    costSelections,
    globalMultiplier,
  });

  useEffect(() => {
    let cancelled = false;
    const { costProgram: p, costSelections: s, globalMultiplier: g } = JSON.parse(
      costRequestKey,
    ) as {
      costProgram: typeof costProgram;
      costSelections: Record<string, CostSelection>;
      globalMultiplier: number;
    };

    setCostLoading(true);
    fetch(asset("/api/costs"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        program: p,
        selections: Object.values(s),
        globalMultiplier: g,
      }),
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          | (CostResolution & { libraryOrigin: string })
          | { error: string };
        if (cancelled) return;
        setCostLoading(false);
        if (!response.ok || "error" in payload) {
          setCosts(null);
          setCostError("error" in payload ? payload.error : "Cost resolution failed.");
          return;
        }
        setCostError(null);
        setLibraryOrigin(payload.libraryOrigin);
        setCosts(payload);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setCostLoading(false);
        setCosts(null);
        setCostError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [costRequestKey]);

  // ── Demographics ────────────────────────────────────────────────────────
  const mu = parseNumber(deal.mu);
  const mf = parseNumber(deal.mf);
  const demographics = evaluateDemographics(
    { mu, mf },
    deal.productType,
    assumptions,
  );

  // ── Gate 1 ──────────────────────────────────────────────────────────────
  // Geography is a plain answered criterion: there is no drive time to
  // pre-fill it from, and no Distance Matrix call behind it.
  const screen = screenDeal(
    {
      answers,
      demographics: {
        governingScore: demographics.governingScore,
        band: demographics.band,
      },
      probability,
    },
    assumptions,
  );

  // ── Gate 2 ──────────────────────────────────────────────────────────────
  const componentFields = [fl.retailNoi, fl.officeNoi, fl.mfNoi];
  const gate2Attempted = componentFields.some(
    (value) => parseNumber(value) !== null,
  );

  // Cost ex-land is resolved, never typed. Split across the three components
  // by direct attribution with the shared lines spread pro rata.
  const allocated = costs
    ? allocateCostExLand(costs, costProgram)
    : { retail: 0, office: 0, multifamily: 0 };

  let firstLookResult: FirstLookResult | null = null;
  let gate2Error: string | null = null;

  if (gate2Attempted) {
    try {
      firstLookResult = firstLook(
        {
          components: {
            retail: {
              noi: parseNumber(fl.retailNoi) ?? 0,
              costExLand: allocated.retail,
            },
            office: {
              noi: parseNumber(fl.officeNoi) ?? 0,
              costExLand: allocated.office,
            },
            multifamily: {
              noi: parseNumber(fl.mfNoi) ?? 0,
              costExLand: allocated.multifamily,
            },
          },
          pads: {
            hotelKeys: parseNumber(fl.hotelKeys) ?? 0,
            townhomeLots: parseNumber(fl.townhomeLots) ?? 0,
            outparcels: parseNumber(fl.outparcels) ?? 0,
          },
          askingPrice: parseNumber(fl.askingPrice) ?? 0,
          // Acreage is a site attribute, so it is typed in the Deal section.
          acreage: parseNumber(deal.acreage) ?? 0,
          sanity: {
            retailSf: parseNumber(fl.sanityRetailSf) ?? 0,
            officeSf: parseNumber(fl.sanityOfficeSf) ?? 0,
            multifamilyUnits: parseNumber(fl.sanityMfUnits) ?? 0,
          },
        },
        assumptions,
      );
    } catch (error) {
      // A placeholder pad rate refusing to compute. Surface it rather than
      // showing a land price built on a stand-in number.
      gate2Error = error instanceof Error ? error.message : String(error);
    }
  }

  const gate2: Gate2Result =
    !gate2Attempted || gate2Error !== null
      ? "NOT RUN"
      : (firstLookResult?.landTest ?? null);

  const combined = combinedVerdict(screen.verdict, gate2);

  // ── Captions ────────────────────────────────────────────────────────────
  const demographicsSource =
    deal.demoSource === "api"
      ? "pulled from the Census"
      : deal.demoSource === "manual"
        ? "typed by hand"
        : deal.demoSource === "failed"
          ? "pull failed, type them above"
          : "geocode an address to pull them";

  const demographicsCaption =
    mu === null && mf === null
      ? `No scores yet · ${demographicsSource}`
      : `${demographicsSource} · ${
          deal.productType === "auto"
            ? "set a product type to pick the governing score"
            : `governing ${demographics.governingScore ?? "—"} · GO ≥ ${demographics.goThreshold}, NO-GO ≤ ${demographics.nogoThreshold}`
        }`;

  const demographicsDisplay =
    demographics.governingScore === null
      ? "—"
      : `${deal.productType === "multifamily" ? "MF" : "MU"} ${demographics.governingScore} ▸ ${demographics.band ?? "—"}`;

  return (
    <>
      <SiteHeader deal={deal} />

      <div className="hidden flex-1 min-[1180px]:block">
        <div
          className="mx-auto grid items-start gap-[var(--panel-gap)] px-6 py-6"
          style={{
            maxWidth: "var(--content-max)",
            gridTemplateColumns: "2fr minmax(var(--panel-w), 1fr)",
          }}
        >
          <div className="flex min-w-0 flex-col gap-6">
            <DealInputs
              values={deal}
              onChange={(key, value) =>
                setDeal((current) => ({ ...current, [key]: value }))
              }
              onGeocoded={(result: GeocodeResult) => {
                setDeal((current) => ({
                  ...current,
                  address: result.formattedAddress,
                  // Only fill submarket if it is still empty or was itself
                  // machine-filled — never overwrite something typed by hand.
                  submarket:
                    current.submarket.trim() === "" ||
                    current.submarket === current.lastSubmarketFromGeocode
                      ? submarketFrom(result)
                      : current.submarket,
                  lastSubmarketFromGeocode: submarketFrom(result),
                  lat: result.lat,
                  lng: result.lng,
                  geohash7: result.geohash7,
                  county: result.county,
                  state: result.state,
                }));
                void pullDemographics(result.lat, result.lng);
              }}
              onDemographicEdit={(key, value) =>
                setDeal((current) => ({
                  ...current,
                  [key]: value,
                  demoSource: "manual",
                  demoDetail:
                    current.demoSource === "api"
                      ? "Overridden after the Census pull"
                      : null,
                }))
              }
              demographicsStatus={demoStatus}
              governing={
                deal.productType === "mixed_use"
                  ? "Mixed-Use"
                  : deal.productType === "multifamily"
                    ? "Multifamily"
                    : "neither"
              }
            />

            <Gate1Table
              screen={screen}
              notes={notes}
              probability={probability}
              probabilityMin={assumptions.probability.min}
              probabilityMax={assumptions.probability.max}
              demographicsCaption={demographicsCaption}
              demographicsDisplay={demographicsDisplay}
              onAnswer={(key, value) =>
                setAnswers((current) => ({ ...current, [key]: value }))
              }
              onNote={(key, value) =>
                setNotes((current) => ({ ...current, [key]: value }))
              }
              onProbability={setProbability}
            />

            <ProgramInputs
              values={program}
              onChange={(key, value) =>
                setProgram((current) => ({ ...current, [key]: value }))
              }
              acreage={parseNumber(deal.acreage)}
            />

            <CostSection
              resolution={costs}
              error={costError}
              loading={costLoading}
              libraryOrigin={libraryOrigin}
              selections={costSelections}
              globalMultiplier={globalMultiplier}
              onSelection={(lineKey, patch) =>
                setCostSelections((current) => {
                  const existing = current[lineKey] ??
                    costs?.lines.find((line) => line.lineKey === lineKey) ?? {
                      lineKey,
                      source: "custom" as const,
                      multiplier: 1,
                      customRate: null,
                    };
                  return {
                    ...current,
                    [lineKey]: {
                      lineKey,
                      source: existing.source,
                      multiplier: existing.multiplier,
                      customRate: "customRate" in existing ? existing.customRate : null,
                      ...patch,
                    },
                  };
                })
              }
              onGlobalMultiplier={setGlobalMultiplier}
            />

            <FirstLookInputs
              values={fl}
              onChange={(key: FirstLookFieldKey, value) =>
                setFl((current) => ({ ...current, [key]: value }))
              }
              placeholderPads={{
                townhome: assumptions.placeholders.has(PAD_RATE_KEYS.townhome),
                outparcel: assumptions.placeholders.has(PAD_RATE_KEYS.outparcel),
              }}
            />

            <p className="caption pb-8">
              Phase 2 · page state only. Nothing is saved yet; reloading clears
              the deal.
            </p>
          </div>

          <VerdictPanel
            screen={screen}
            demographics={demographics}
            firstLook={firstLookResult}
            gate2={gate2}
            combined={combined}
            gate2Error={gate2Error}
            mu={mu}
            mf={mf}
            resiUnits={parseNumber(fl.sanityMfUnits)}
            demographicMetrics={demoMetrics}
          />
        </div>
      </div>

      <div className="mx-auto max-w-md flex-1 px-6 py-16 text-center min-[1180px]:hidden">
        <h2 className="text-md font-[650] text-ink">Wider window needed</h2>
        <p className="mt-2 text-ink">
          The deal screen is a dense table next to a live verdict panel. It needs
          at least 1180px. Reflowing it onto a phone would cost you the one thing
          it is for: seeing all 18 criteria and the verdict at once.
        </p>
      </div>

      <SiteFooter assumptionsOrigin={assumptionsOrigin} user={user} />
    </>
  );
}
