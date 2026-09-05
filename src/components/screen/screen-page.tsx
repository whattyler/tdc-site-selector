"use client";

import { useState } from "react";

import { parseNumber } from "@/lib/format";
import { type GeocodeResult, submarketFrom } from "@/lib/geocode";
import {
  type Answer,
  type Assumptions,
  combinedVerdict,
  evaluateDemographics,
  firstLook,
  type FirstLookResult,
  type Gate2Result,
  PAD_RATE_KEYS,
  screenDeal,
} from "@/lib/scoring";

import { DealInputs, type DealFields, EMPTY_DEAL } from "./deal-inputs";
import {
  EMPTY_FIRST_LOOK,
  FirstLookInputs,
  type FirstLookFieldKey,
  type FirstLookFields,
} from "./first-look-inputs";
import { Gate1Table } from "./gate1-table";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { VerdictPanel } from "./verdict-panel";

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
  const [deal, setDeal] = useState<DealFields>(EMPTY_DEAL);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [probability, setProbability] = useState(assumptions.probability.default);
  const [fl, setFl] = useState<FirstLookFields>(EMPTY_FIRST_LOOK);

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
  const componentFields = [
    fl.retailNoi,
    fl.retailCost,
    fl.officeNoi,
    fl.officeCost,
    fl.mfNoi,
    fl.mfCost,
  ];
  const gate2Attempted = componentFields.some(
    (value) => parseNumber(value) !== null,
  );

  let firstLookResult: FirstLookResult | null = null;
  let gate2Error: string | null = null;

  if (gate2Attempted) {
    try {
      firstLookResult = firstLook(
        {
          components: {
            retail: {
              noi: parseNumber(fl.retailNoi) ?? 0,
              costExLand: parseNumber(fl.retailCost) ?? 0,
            },
            office: {
              noi: parseNumber(fl.officeNoi) ?? 0,
              costExLand: parseNumber(fl.officeCost) ?? 0,
            },
            multifamily: {
              noi: parseNumber(fl.mfNoi) ?? 0,
              costExLand: parseNumber(fl.mfCost) ?? 0,
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
  const demographicsCaption =
    mu === null && mf === null
      ? "Type the two dashboard scores above · Phase 4 pulls them by address"
      : `typed from the dashboard · ${
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
              onGeocoded={(result: GeocodeResult) =>
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
                }))
              }
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
