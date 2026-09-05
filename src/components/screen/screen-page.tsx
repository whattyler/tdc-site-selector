"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { asset } from "@/lib/base-path";
import { parseNumber } from "@/lib/format";
import type { Comp, CompsResponse } from "@/app/api/comps/route";
import type { DemographicsResponse } from "@/app/api/demographics/route";
import type {
  RentDraft,
  RentDraftField,
  RentDraftResponse,
} from "@/app/api/rent-draft/route";
import { type GeocodeResult, submarketFrom } from "@/lib/geocode";
import {
  type Answer,
  type Assumptions,
  combinedVerdict,
  computeRevenue,
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
import {
  buildCostRentGrid,
  type CostRentGrid,
  type ScenarioCell,
} from "@/lib/sensitivity";

import type { DealSnapshot } from "@/lib/deals/snapshot";

import {
  DealInputs,
  type DealFields,
  DEFAULT_DEAL,
  EMPTY_DEAL,
} from "./deal-inputs";
import {
  EMPTY_FIRST_LOOK,
  FirstLookInputs,
  type FirstLookFieldKey,
  type FirstLookFields,
} from "./first-look-inputs";
import { CostSection } from "./cost-section";
import { Gate1Table } from "./gate1-table";
import {
  compIncluded,
  CompsSection,
  DRAFT_TARGET,
  EMPTY_RENTS,
  type RentFieldKey,
  type RentFields,
  type RentSource,
  RevenueSection,
} from "./revenue-section";
import {
  EMPTY_PROGRAM,
  MEDLEY_PROGRAM,
  ProgramInputs,
  type ProgramFields,
} from "./program-inputs";
import { SensitivityDrawer } from "./sensitivity-drawer";
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
  /** A deal read back from the database. Absent means a new one. */
  initial?: DealSnapshot | null;
  /** Seeds a new deal with Medley. Only from `?demo=medley`. */
  demo?: boolean;
  /** False when there is nowhere to save to, which disables the button. */
  canSave: boolean;
}

/**
 * The screen page.
 *
 * Every input lives in page state and the engine recomputes from it on each
 * render — a saved deal restores the inputs, never the answers, so a change to
 * a weight or a rate shows up on the next open rather than being frozen into
 * whatever was true the day someone pressed Save.
 */
export function ScreenPage({
  assumptions,
  assumptionsOrigin,
  user,
  initial = null,
  demo = false,
  canSave,
}: ScreenPageProps) {
  const router = useRouter();
  const seedDeal = initial?.deal ?? (demo ? DEFAULT_DEAL : EMPTY_DEAL);
  const seedProgram = initial?.program ?? (demo ? MEDLEY_PROGRAM : EMPTY_PROGRAM);

  const [dealId, setDealId] = useState<string | null>(initial?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(
    initial ? "Loaded from the pipeline" : null,
  );

  const [deal, setDeal] = useState<DealFields>(seedDeal);
  const [answers, setAnswers] = useState<Record<string, Answer>>(
    initial?.answers ?? {},
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    initial?.notes ?? {},
  );
  const [probability, setProbability] = useState(
    initial?.probability ?? assumptions.probability.default,
  );
  const [fl, setFl] = useState<FirstLookFields>(
    initial?.firstLook ?? EMPTY_FIRST_LOOK,
  );
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading">("idle");
  const [demoMetrics, setDemoMetrics] = useState<ScoredMetric[] | null>(
    initial?.demographicMetrics ?? null,
  );
  const [program, setProgram] = useState<ProgramFields>(seedProgram);
  const [costSelections, setCostSelections] = useState<
    Record<string, CostSelection>
  >(initial?.costSelections ?? (demo ? DEFAULT_COST_SELECTIONS : {}));
  const [globalMultiplier, setGlobalMultiplier] = useState(
    initial?.globalMultiplier ?? 1,
  );
  const [costs, setCosts] = useState<CostResolution | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [libraryOrigin, setLibraryOrigin] = useState<string | null>(null);
  const [comps, setComps] = useState<Comp[] | null>(initial?.comps ?? null);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  // Absent means "untouched", which resolves to the default in `compIncluded`:
  // ticked, unless the comp is below the ratings floor.
  const [compsIncluded, setCompsIncluded] = useState<Record<string, boolean>>(
    initial?.compsIncluded ?? {},
  );
  const [rents, setRents] = useState<RentFields>(initial?.rents ?? EMPTY_RENTS);
  const [rentSources, setRentSources] = useState<
    Partial<Record<RentFieldKey, RentSource>>
  >(initial?.rentSources ?? {});
  const [drafts, setDrafts] = useState<RentDraft[] | null>(null);
  const [draftNotes, setDraftNotes] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  // Page state only. Closing the drawer leaves nothing behind.
  const [sensitivityOpen, setSensitivityOpen] = useState(false);
  const [costRentGrid, setCostRentGrid] = useState<CostRentGrid | null>(null);
  const [costRentLoading, setCostRentLoading] = useState(false);

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

  /**
   * Nearby apartment complexes and retail centres. Runs off the same geocode
   * the demographics do; the radius matches the demographic radius so the two
   * are describing the same neighbourhood.
   */
  async function pullComps(lat: number, lng: number) {
    setCompsLoading(true);
    setCompsError(null);
    try {
      const response = await fetch(
        `${asset("/api/comps")}?lat=${lat}&lng=${lng}&radius=${assumptions.demo.defaultRadiusMi}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as CompsResponse | { error: string };
      setCompsLoading(false);
      if (!response.ok || "error" in payload) {
        setComps(null);
        setCompsError("error" in payload ? payload.error : "Could not reach Places.");
        return;
      }
      setComps(payload.comps);
      // A fresh search drops every manual tick and goes back to the default.
      setCompsIncluded({});
    } catch (error) {
      setCompsLoading(false);
      setComps(null);
      setCompsError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Ask Claude to find each included comp's advertised asking rent. What comes
   * back is a draft: it is displayed with its sources and stays out of the NOI
   * until the user presses Use on it.
   */
  async function draftRents(list: Comp[]) {
    setDraftLoading(true);
    setDraftError(null);
    try {
      const response = await fetch(asset("/api/rent-draft"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          comps: list.map((comp) => ({
            name: comp.name,
            address: comp.address,
            type: comp.type,
          })),
          market: deal.submarket || deal.address || undefined,
        }),
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | RentDraftResponse
        | { error: string };
      setDraftLoading(false);
      if (!response.ok || "error" in payload) {
        setDrafts(null);
        setDraftError("error" in payload ? payload.error : "Rent draft failed.");
        return;
      }
      setDrafts(payload.drafts);
      setDraftNotes(payload.notes);
      setDraftModel(payload.model);
    } catch (error) {
      setDraftLoading(false);
      setDrafts(null);
      setDraftError(error instanceof Error ? error.message : String(error));
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

  // ── Revenue ─────────────────────────────────────────────────────────────
  // Vacancy is typed as a percentage because that is how it is quoted; the
  // engine wants a fraction.
  const share = (raw: string): number | null => {
    const value = parseNumber(raw);
    return value === null ? null : value / 100;
  };

  const revenue = computeRevenue({
    resiUnits: costProgram.resiUnits || null,
    resiAvgNsf: parseNumber(program.avgNsf),
    resiRentPsfMo: parseNumber(rents.resiRentPsfMo),
    resiVacancy: share(rents.resiVacancy),
    opexPerUnit: parseNumber(rents.opexPerUnit),
    retailSf: costProgram.retailSf || null,
    retailRentPsf: parseNumber(rents.retailRentPsf),
    retailVacancy: share(rents.retailVacancy),
    retailNonRecovPsf: parseNumber(rents.retailNonRecovPsf),
    officeSf: costProgram.officeSf || null,
    officeRentPsf: parseNumber(rents.officeRentPsf),
    officeVacancy: share(rents.officeVacancy),
    officeNonRecovPsf: parseNumber(rents.officeNonRecovPsf),
  });

  const includedComps = (comps ?? []).filter((comp) =>
    compIncluded(comp, compsIncluded),
  );
  const includedCompIds = new Set(includedComps.map((comp) => comp.placeId));

  // ── Gate 2 ──────────────────────────────────────────────────────────────
  // NOI is no longer typed: Gate 2 runs once Revenue has priced at least one
  // component. An unpriced component contributes nothing rather than a zero.
  const gate2Attempted = revenue.totalNoi !== null;

  // The TDC land-rate sanity check measures the same program the costs do, so
  // it derives rather than being typed a second time and drifting.
  const sanity = {
    retailSf: costProgram.retailSf,
    officeSf: costProgram.officeSf,
    multifamilyUnits: costProgram.resiUnits,
  };

  // Cost ex-land is resolved, never typed. Split across the three components
  // by direct attribution with the shared lines spread pro rata.
  const allocated = costs
    ? allocateCostExLand(costs, costProgram)
    : { retail: 0, office: 0, multifamily: 0 };

  // Hoisted so sensitivity can re-run the same deal with one input changed
  // rather than rebuilding the shape and letting the two drift apart.
  const pads = {
    hotelKeys: parseNumber(fl.hotelKeys) ?? 0,
    townhomeLots: parseNumber(fl.townhomeLots) ?? 0,
    outparcels: parseNumber(fl.outparcels) ?? 0,
  };
  const askingPrice = parseNumber(fl.askingPrice) ?? 0;
  const firstLookInput = {
    components: {
      retail: { noi: revenue.retail.noi ?? 0, costExLand: allocated.retail },
      office: { noi: revenue.office.noi ?? 0, costExLand: allocated.office },
      multifamily: {
        noi: revenue.multifamily.noi ?? 0,
        costExLand: allocated.multifamily,
      },
    },
    pads,
    askingPrice,
    // Acreage is a site attribute, so it is typed in the Deal section.
    acreage: parseNumber(deal.acreage) ?? 0,
    sanity,
  };

  let firstLookResult: FirstLookResult | null = null;
  let gate2Error: string | null = null;

  if (gate2Attempted) {
    try {
      firstLookResult = firstLook(firstLookInput, assumptions);
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

  // ── Sensitivity ─────────────────────────────────────────────────────────
  /**
   * Grid A detail, on demand. The cell values come from `sensitivityGrid()`
   * exactly as the workbook builds them; the hover readout re-runs the whole
   * First Look at that yield pair instead of re-deriving the arithmetic here.
   */
  const yocCellAt = (mfIndex: number, commIndex: number): ScenarioCell | null => {
    if (!firstLookResult) return null;
    const { commYocAxis, mfYocAxis } = firstLookResult.sensitivity;
    const comm = commYocAxis[commIndex];
    const mf = mfYocAxis[mfIndex];
    if (comm === undefined || mf === undefined) return null;

    try {
      const scenario = firstLook(
        {
          ...firstLookInput,
          yocOverrides: { retail: comm, office: comm, multifamily: mf },
        },
        assumptions,
      );
      return {
        // Read from the workbook grid, not from this call, so the readout can
        // never quietly disagree with the cell it is describing.
        maxLand: firstLookResult.sensitivity.cells[mfIndex][commIndex],
        totalNoi: scenario.totalNoi,
        yocOnCost: scenario.yocOnCost,
        blendedYoc: scenario.blendedYoc,
      };
    } catch {
      return null;
    }
  };

  // Grid B costs five server round trips, so it is built when the drawer opens
  // and rebuilt only if the deal underneath it changes.
  const gridRequestKey = JSON.stringify({
    costProgram,
    costSelections,
    revenue: {
      resiRentPsfMo: parseNumber(rents.resiRentPsfMo),
      resiVacancy: share(rents.resiVacancy),
      opexPerUnit: parseNumber(rents.opexPerUnit),
      retailRentPsf: parseNumber(rents.retailRentPsf),
      retailVacancy: share(rents.retailVacancy),
      retailNonRecovPsf: parseNumber(rents.retailNonRecovPsf),
      officeRentPsf: parseNumber(rents.officeRentPsf),
      officeVacancy: share(rents.officeVacancy),
      officeNonRecovPsf: parseNumber(rents.officeNonRecovPsf),
    },
    pads,
    askingPrice,
    acreage: parseNumber(deal.acreage) ?? 0,
    sanity,
  });

  useEffect(() => {
    if (!sensitivityOpen) return;

    const request = JSON.parse(gridRequestKey) as {
      costProgram: typeof costProgram;
      costSelections: Record<string, CostSelection>;
      revenue: Omit<
        Parameters<typeof computeRevenue>[0],
        "resiUnits" | "resiAvgNsf" | "retailSf" | "officeSf"
      >;
      pads: typeof pads;
      askingPrice: number;
      acreage: number;
      sanity: typeof sanity;
    };
    const controller = new AbortController();

    setCostRentLoading(true);
    buildCostRentGrid(
      {
        program: request.costProgram,
        selections: Object.values(request.costSelections),
        revenue: {
          ...request.revenue,
          resiUnits: request.costProgram.resiUnits || null,
          resiAvgNsf: parseNumber(program.avgNsf),
          retailSf: request.costProgram.retailSf || null,
          officeSf: request.costProgram.officeSf || null,
        },
        pads: request.pads,
        askingPrice: request.askingPrice,
        acreage: request.acreage,
        sanity: request.sanity,
        assumptions,
      },
      controller.signal,
    )
      .then((grid) => {
        if (controller.signal.aborted) return;
        setCostRentLoading(false);
        setCostRentGrid(grid);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCostRentLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensitivityOpen, gridRequestKey]);

  // ── Save ────────────────────────────────────────────────────────────────
  /**
   * Write the deal. The first save creates and mints an id; every later save
   * updates in place, so a deal has one row however many times it is screened.
   *
   * The verdicts go with it, denormalised, because the pipeline lists every
   * deal at once and must not resolve a cost stack per row to draw a table.
   */
  async function save() {
    setSaving(true);
    setSaveError(null);

    const snapshot: DealSnapshot = {
      id: dealId ?? undefined,
      deal,
      answers,
      notes,
      probability,
      program,
      costSelections,
      globalMultiplier,
      rents,
      rentSources,
      firstLook: fl,
      comps: comps ?? [],
      compsIncluded,
      demographicMetrics: demoMetrics,
      computed: {
        weightedScore: screen.weightedScore,
        unknownShare: screen.unknownShare,
        koPass: screen.koPass,
        demoBand: demographics.band,
        verdict: screen.verdict,
        prob: probability,
        probWeighted: screen.probabilityWeightedScore,
        totalNoi: firstLookResult?.totalNoi ?? null,
        totalCostExLand: firstLookResult?.totalCostExLand ?? null,
        maxLandPrice: firstLookResult?.maxLandPrice ?? null,
        headroomPctOfAsk: firstLookResult?.headroomPctOfAsk ?? null,
        yocOnCost: firstLookResult?.yocOnCost ?? null,
        blendedYoc: firstLookResult?.blendedYoc ?? null,
        retailShareOfNoi: firstLookResult?.retailShareOfNoi ?? null,
        landTest: firstLookResult?.landTest ?? null,
        combinedVerdict: combined,
      },
    };

    try {
      const response = await fetch(asset("/api/deals"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | { id: string; updatedAt: string; updatedBy: string }
        | { error: string };

      setSaving(false);
      if (!response.ok || "error" in payload) {
        setSaveError("error" in payload ? payload.error : "Save failed.");
        return;
      }

      setSavedAt(
        `Saved ${new Date(payload.updatedAt).toLocaleTimeString()} by ${payload.updatedBy}`,
      );

      // First save: move to the deal's own URL so a reload restores it and the
      // address bar is something you can send to someone.
      if (!dealId) {
        setDealId(payload.id);
        router.replace(`/deals/${payload.id}`);
      }
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }

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
      <SiteHeader deal={deal} active="screen" />

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
                void pullComps(result.lat, result.lng);
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
              comps={comps ?? undefined}
              includedCompIds={includedCompIds}
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

            <CompsSection
              comps={comps}
              error={compsError}
              loading={compsLoading}
              radiusMi={assumptions.demo.defaultRadiusMi}
              included={compsIncluded}
              canRefresh={deal.lat !== null && deal.lng !== null}
              onToggle={(placeId, next) =>
                setCompsIncluded((current) => ({ ...current, [placeId]: next }))
              }
              onToggleAll={(next) =>
                setCompsIncluded(
                  Object.fromEntries(
                    (comps ?? []).map((comp) => [comp.placeId, next]),
                  ),
                )
              }
              onRefresh={() => {
                if (deal.lat === null || deal.lng === null) return;
                void pullComps(deal.lat, deal.lng);
              }}
            />

            <RevenueSection
              values={rents}
              sources={rentSources}
              program={{
                resiUnits: costProgram.resiUnits,
                avgNsf: parseNumber(program.avgNsf) ?? 0,
                retailSf: costProgram.retailSf,
                officeSf: costProgram.officeSf,
              }}
              revenue={revenue}
              drafts={drafts}
              draftNotes={draftNotes}
              draftError={draftError}
              draftLoading={draftLoading}
              draftModel={draftModel}
              includedCompCount={includedComps.length}
              onChange={(key, value) => {
                setRents((current) => ({ ...current, [key]: value }));
                // Typing over a confirmed draft makes it yours again.
                setRentSources((current) => ({ ...current, [key]: "manual" }));
              }}
              onDraft={() => void draftRents(includedComps)}
              onConfirmDraft={(draft: RentDraft) => {
                const key = DRAFT_TARGET[draft.field as RentDraftField];
                setRents((current) => ({ ...current, [key]: String(draft.value) }));
                setRentSources((current) => ({ ...current, [key]: "ai_confirmed" }));
              }}
            />

            <FirstLookInputs
              values={fl}
              sanity={sanity}
              noi={{
                retail: revenue.retail.noi,
                office: revenue.office.noi,
                multifamily: revenue.multifamily.noi,
              }}
              onChange={(key: FirstLookFieldKey, value) =>
                setFl((current) => ({ ...current, [key]: value }))
              }
              placeholderPads={{
                townhome: assumptions.placeholders.has(PAD_RATE_KEYS.townhome),
                outparcel: assumptions.placeholders.has(PAD_RATE_KEYS.outparcel),
              }}
            />

            <p className="caption pb-8">
              Phase 6 · page state only. Nothing is saved yet; reloading clears
              the deal, the comps and any drafted rents.
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
            resiUnits={sanity.multifamilyUnits || null}
            demographicMetrics={demoMetrics}
            onSensitivity={() => setSensitivityOpen(true)}
            onSave={canSave ? () => void save() : undefined}
            saving={saving}
            saveError={saveError}
            savedAt={savedAt}
            saveLabel={dealId ? "Update pipeline" : "Save to pipeline"}
            pdfHref={dealId ? asset(`/api/deals/${dealId}/pdf`) : null}
          />
        </div>
      </div>

      {firstLookResult && (
        <SensitivityDrawer
          open={sensitivityOpen}
          onClose={() => setSensitivityOpen(false)}
          dealName={deal.name || deal.address || "Untitled"}
          firstLook={firstLookResult}
          askingPrice={askingPrice}
          yocCellAt={yocCellAt}
          costRentGrid={costRentGrid}
          costRentLoading={costRentLoading}
          currentMultiplier={globalMultiplier}
        />
      )}

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
