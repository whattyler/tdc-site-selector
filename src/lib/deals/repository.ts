import { eq } from "drizzle-orm";

import type { Comp } from "@/app/api/comps/route";
import type { DealFields } from "@/components/screen/deal-inputs";
import type { ProgramFields } from "@/components/screen/program-inputs";
import type {
  RentFields,
  RentFieldKey,
  RentSource,
} from "@/components/screen/revenue-section";
import { getDb } from "@/lib/db/client";
import {
  comps as compsTable,
  costLines,
  padLines,
  deals,
  demographics,
  firstLookResults,
  programs,
  revenue,
  screenAnswers,
  screenResults,
} from "@/lib/db/schema";
import type {
  Answer,
  CostSelection,
  PadParcel,
  PadSelection,
  PadSelections,
  ScoredMetric,
} from "@/lib/scoring";

import type { DealSnapshot, PipelineRow } from "./snapshot";
import { comparePipelineRows } from "./snapshot";

/**
 * Deals in and out of Postgres. Spec B4, Phase 8.
 *
 * The page holds most numbers as strings, because a half-typed "1." has to be
 * representable and `null` has to mean "not entered" rather than zero. The
 * database holds them as numbers. Every crossing of that boundary happens in
 * this file, in one pair of functions, so a field cannot be saved one way and
 * read back another.
 */

const num = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

const str = (value: number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value);

/**
 * Percentages live in the page as "6" and in the engine as 0.06.
 *
 * Rounded on the way out because binary floating point cannot hold 0.07: a
 * saved 7% came back as "7.000000000000001" and rendered that way in the
 * field. Six decimals is far finer than any vacancy anyone types and well
 * inside the column's own scale.
 */
const pctToString = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? ""
    : String(Number((value * 100).toFixed(6)));

const stringToPct = (raw: string): number | null => {
  const value = num(raw);
  return value === null ? null : value / 100;
};

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function saveDeal(
  snapshot: DealSnapshot,
  who: string,
): Promise<string> {
  const db = getDb();
  const { deal, program, rents, firstLook, computed } = snapshot;
  const now = new Date();

  const dealRow = {
    name: deal.name.trim() === "" ? "Untitled deal" : deal.name.trim(),
    address: deal.address || null,
    lat: deal.lat,
    lng: deal.lng,
    geohash7: deal.geohash7,
    acreage: num(deal.acreage),
    jurisdiction: deal.county,
    submarket: deal.submarket || null,
    productType: deal.productType,
    askingPrice: num(firstLook.askingPrice),
    incentives: num(firstLook.incentives),
    incentivesNote: firstLook.incentivesNote.trim() || null,
    costGlobalMultiplier: snapshot.globalMultiplier,
    costPricingDate: snapshot.pricingDate || null,
    updatedAt: now,
    updatedBy: who,
  };

  // Create or update. `createdBy` is only ever written once — a later save by
  // someone else moves `updatedBy`, never the authorship.
  let id: string;
  if (snapshot.id) {
    const updated = await db
      .update(deals)
      .set(dealRow)
      .where(eq(deals.id, snapshot.id))
      .returning({ id: deals.id });
    if (updated.length === 0) {
      throw new Error(`No deal with id ${snapshot.id}.`);
    }
    id = updated[0].id;
  } else {
    const inserted = await db
      .insert(deals)
      .values({ ...dealRow, createdBy: who, createdAt: now })
      .returning({ id: deals.id });
    id = inserted[0].id;
  }

  // ── One-to-one sections ────────────────────────────────────────────────
  await db
    .insert(demographics)
    .values({
      dealId: id,
      muScore: num(deal.mu),
      mfScore: num(deal.mf),
      radiusMi: null,
      metrics: snapshot.demographicMetrics,
      pulledAt: deal.demoSource === "api" ? now : null,
      source: deal.demoSource === "api" ? "api" : "manual",
    })
    .onConflictDoUpdate({
      target: demographics.dealId,
      set: {
        muScore: num(deal.mu),
        mfScore: num(deal.mf),
        metrics: snapshot.demographicMetrics,
        source: deal.demoSource === "api" ? "api" : "manual",
        // Must be in the update set too, not just the insert. A deal first
        // saved with hand-typed scores and later re-saved after a Census pull
        // would otherwise keep a null pull time next to source "api" — the
        // caption would then claim a pull it could not date.
        pulledAt: deal.demoSource === "api" ? now : null,
      },
    });

  const programRow = {
    dealId: id,
    resiUnits: num(program.resiUnits),
    avgNsf: num(program.avgNsf),
    resiNrsf: num(program.resiNrsf),
    resiGsf: num(program.resiGsf),
    retailSf: num(program.retailSf),
    officeSf: num(program.officeSf),
    parkingSpaces: num(program.parkingSpaces),
    parkingType: program.parkingType,
    stories: num(program.stories),
    constructionType: program.constructionType,
    hotelKeys: num(firstLook.hotelKeys),
    thLots: num(firstLook.townhomeLots),
    outparcels: num(firstLook.outparcels),
  };
  await db
    .insert(programs)
    .values(programRow)
    .onConflictDoUpdate({ target: programs.dealId, set: programRow });

  const revenueRow = {
    dealId: id,
    resiRentPsfMo: num(rents.resiRentPsfMo),
    retailRentPsf: num(rents.retailRentPsf),
    officeRentPsf: num(rents.officeRentPsf),
    vacancy: {
      resi: stringToPct(rents.resiVacancy),
      retail: stringToPct(rents.retailVacancy),
      office: stringToPct(rents.officeVacancy),
    },
    opexPerUnit: num(rents.opexPerUnit),
    retailNonrecovPsf: num(rents.retailNonRecovPsf),
    officeNonrecovPsf: num(rents.officeNonRecovPsf),
    rentSource: snapshot.rentSources,
  };
  await db
    .insert(revenue)
    .values(revenueRow)
    .onConflictDoUpdate({ target: revenue.dealId, set: revenueRow });

  const screenRow = {
    dealId: id,
    weightedScore: computed.weightedScore,
    unknownShare: computed.unknownShare,
    koPass: computed.koPass,
    demoBand: computed.demoBand,
    verdict: computed.verdict,
    prob: computed.prob,
    probWeighted: computed.probWeighted,
    computedAt: now,
  };
  await db
    .insert(screenResults)
    .values(screenRow)
    .onConflictDoUpdate({ target: screenResults.dealId, set: screenRow });

  const firstLookRow = {
    dealId: id,
    totalNoi: computed.totalNoi,
    totalCostExLand: computed.totalCostExLand,
    incentives: computed.incentives,
    netCostExLand: computed.netCostExLand,
    maxLandPrice: computed.maxLandPrice,
    headroomPctOfAsk: computed.headroomPctOfAsk,
    yocOnCost: computed.yocOnCost,
    blendedYoc: computed.blendedYoc,
    retailShareOfNoi: computed.retailShareOfNoi,
    landTest: computed.landTest,
    combinedVerdict: computed.combinedVerdict,
    computedAt: now,
  };
  await db
    .insert(firstLookResults)
    .values(firstLookRow)
    .onConflictDoUpdate({ target: firstLookResults.dealId, set: firstLookRow });

  // ── Collections ────────────────────────────────────────────────────────
  // Replaced wholesale rather than diffed. These are small, and an upsert that
  // leaves deleted rows behind is how a comp you unticked reappears next week.
  await db.delete(costLines).where(eq(costLines.dealId, id));
  const lines = Object.values(snapshot.costSelections);
  if (lines.length > 0) {
    await db.insert(costLines).values(
      lines.map((line: CostSelection) => ({
        dealId: id,
        lineKey: line.lineKey,
        source: line.source,
        multiplier: line.multiplier,
        customRate: line.customRate,
      })),
    );
  }

  await db.delete(padLines).where(eq(padLines.dealId, id));
  const pads = Object.entries(snapshot.padSelections).filter(
    // A pad left on the convention with nothing typed is the default; storing
    // it would only make the absence of a row ambiguous.
    ([, selection]) =>
      selection !== undefined &&
      (selection.source === "custom" ||
        selection.customRate !== null ||
        (selection.note ?? "") !== ""),
  );
  if (pads.length > 0) {
    await db.insert(padLines).values(
      pads.map(([parcel, selection]) => ({
        dealId: id,
        parcel: parcel as PadParcel,
        source: selection!.source,
        customRate: selection!.customRate,
        note: selection!.note,
      })),
    );
  }

  await db.delete(compsTable).where(eq(compsTable.dealId, id));
  if (snapshot.comps.length > 0) {
    await db.insert(compsTable).values(
      snapshot.comps.map((comp) => ({
        dealId: id,
        placeId: comp.placeId,
        name: comp.name,
        address: comp.address,
        type: comp.type,
        rating: comp.rating,
        ratingCount: comp.userRatingCount,
        lat: comp.lat,
        lng: comp.lng,
        distanceMi: comp.distanceMi,
        yearBuilt: comp.yearBuilt,
        // An explicit tick wins; absent falls back to the ratings-floor default.
        include: snapshot.compsIncluded[comp.placeId] ?? !comp.lowSignal,
      })),
    );
  }

  await db.delete(screenAnswers).where(eq(screenAnswers.dealId, id));
  const answerKeys = new Set([
    ...Object.keys(snapshot.answers),
    ...Object.keys(snapshot.notes),
  ]);
  if (answerKeys.size > 0) {
    await db.insert(screenAnswers).values(
      [...answerKeys].map((criterionKey) => ({
        dealId: id,
        criterionKey,
        answer: snapshot.answers[criterionKey] ?? null,
        note: snapshot.notes[criterionKey] ?? null,
        answeredBy: who,
      })),
    );
  }

  return id;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadDeal(id: string): Promise<DealSnapshot | null> {
  const db = getDb();

  const dealRows = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  const row = dealRows[0];
  if (!row) return null;

  const [
    demoRows,
    programRows,
    revenueRows,
    lineRows,
    compRows,
    answerRows,
    screenRows,
    padRows,
  ] = await Promise.all([
      db.select().from(demographics).where(eq(demographics.dealId, id)).limit(1),
      db.select().from(programs).where(eq(programs.dealId, id)).limit(1),
      db.select().from(revenue).where(eq(revenue.dealId, id)).limit(1),
      db.select().from(costLines).where(eq(costLines.dealId, id)),
      db.select().from(compsTable).where(eq(compsTable.dealId, id)),
      db.select().from(screenAnswers).where(eq(screenAnswers.dealId, id)),
      db.select().from(screenResults).where(eq(screenResults.dealId, id)).limit(1),
      db.select().from(padLines).where(eq(padLines.dealId, id)),
    ]);

  const demo = demoRows[0];
  const prog = programRows[0];
  const rev = revenueRows[0];
  const vacancy = (rev?.vacancy ?? {}) as {
    resi?: number | null;
    retail?: number | null;
    office?: number | null;
  };

  const deal: DealFields = {
    name: row.name,
    address: row.address ?? "",
    submarket: row.submarket ?? "",
    productType: row.productType,
    mu: str(demo?.muScore),
    mf: str(demo?.mfScore),
    acreage: str(row.acreage),
    lat: row.lat,
    lng: row.lng,
    geohash7: row.geohash7,
    county: row.jurisdiction,
    state: null,
    // A restored submarket is the saved one, not one this session's geocoder
    // produced, so nothing may silently overwrite it.
    lastSubmarketFromGeocode: null,
    demoSource: demo ? (demo.source === "api" ? "api" : "manual") : "none",
    demoDetail: demo?.pulledAt
      ? `Saved with the deal · pulled ${demo.pulledAt.toISOString().slice(0, 10)}`
      : demo
        ? "Saved with the deal · typed by hand"
        : null,
  };

  const program: ProgramFields = {
    resiUnits: str(prog?.resiUnits),
    avgNsf: str(prog?.avgNsf),
    resiNrsf: str(prog?.resiNrsf),
    resiGsf: str(prog?.resiGsf),
    retailSf: str(prog?.retailSf),
    officeSf: str(prog?.officeSf),
    parkingSpaces: str(prog?.parkingSpaces),
    stories: str(prog?.stories),
    parkingType: (prog?.parkingType ??
      "structured") as ProgramFields["parkingType"],
    constructionType: (prog?.constructionType ??
      "podium") as ProgramFields["constructionType"],
  };

  const rents: RentFields = {
    resiRentPsfMo: str(rev?.resiRentPsfMo),
    resiVacancy: pctToString(vacancy.resi),
    opexPerUnit: str(rev?.opexPerUnit),
    retailRentPsf: str(rev?.retailRentPsf),
    retailVacancy: pctToString(vacancy.retail),
    retailNonRecovPsf: str(rev?.retailNonrecovPsf),
    officeRentPsf: str(rev?.officeRentPsf),
    officeVacancy: pctToString(vacancy.office),
    officeNonRecovPsf: str(rev?.officeNonrecovPsf),
  };

  const comps: Comp[] = compRows
    .filter((comp): comp is typeof comp & { placeId: string } =>
      comp.placeId !== null,
    )
    .map((comp) => ({
      placeId: comp.placeId,
      name: comp.name,
      // The table's enum carries an office type the Places search does not
      // produce; a legacy row folds into retail rather than being dropped.
      type: comp.type === "office" ? "retail" : comp.type,
      address: comp.address,
      lat: comp.lat ?? 0,
      lng: comp.lng ?? 0,
      distanceMi: comp.distanceMi ?? 0,
      yearBuilt: comp.yearBuilt,
      rating: comp.rating,
      userRatingCount: comp.ratingCount,
      lowSignal: (comp.ratingCount ?? 0) < 5,
    }))
    .sort((a, b) => a.distanceMi - b.distanceMi);

  // Every restored comp carries an explicit tick, because the saved decision is
  // the user's and must survive even where it matches the default.
  const compsIncluded: Record<string, boolean> = {};
  for (const comp of compRows) {
    if (comp.placeId) compsIncluded[comp.placeId] = comp.include;
  }

  const answers: Record<string, Answer> = {};
  const notes: Record<string, string> = {};
  for (const answer of answerRows) {
    if (answer.answer) answers[answer.criterionKey] = answer.answer;
    if (answer.note) notes[answer.criterionKey] = answer.note;
  }

  const costSelections: Record<string, CostSelection> = {};
  for (const line of lineRows) {
    costSelections[line.lineKey] = {
      lineKey: line.lineKey,
      source: line.source,
      multiplier: line.multiplier,
      customRate: line.customRate,
    };
  }

  return {
    id: row.id,
    deal,
    answers,
    notes,
    // The one computed value that is also an input: the slider position is a
    // judgement the user made, so it is restored rather than recomputed.
    probability: screenRows[0]?.prob ?? 0,
    program,
    costSelections,
    globalMultiplier: row.costGlobalMultiplier,
    // A deal saved before pricing dates existed prices at today, which is what
    // it did when it was saved.
    pricingDate: row.costPricingDate ?? new Date().toISOString().slice(0, 10),
    padSelections: Object.fromEntries(
      padRows.map((pad) => [
        pad.parcel,
        {
          source: pad.source,
          customRate: pad.customRate,
          note: pad.note,
        } satisfies PadSelection,
      ]),
    ) as PadSelections,
    rents,
    rentSources: (rev?.rentSource ?? {}) as Partial<
      Record<RentFieldKey, RentSource>
    >,
    firstLook: {
      hotelKeys: str(prog?.hotelKeys),
      townhomeLots: str(prog?.thLots),
      outparcels: str(prog?.outparcels),
      askingPrice: str(row.askingPrice),
      incentives: str(row.incentives),
      incentivesNote: row.incentivesNote ?? "",
    },
    comps,
    compsIncluded,
    demographicMetrics: (demo?.metrics ?? null) as ScoredMetric[] | null,
    // Recomputed by the page from the inputs above. Never trusted on the way in.
    computed: {
      weightedScore: 0,
      unknownShare: 0,
      koPass: "PASS",
      demoBand: null,
      verdict: "NOT SCORED",
      prob: 0,
      probWeighted: 0,
      totalNoi: null,
      totalCostExLand: null,
      incentives: null,
      netCostExLand: null,
      maxLandPrice: null,
      headroomPctOfAsk: null,
      yocOnCost: null,
      blendedYoc: null,
      retailShareOfNoi: null,
      landTest: null,
      combinedVerdict: "NOT SCORED",
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function listPipeline(): Promise<PipelineRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: deals.id,
      name: deals.name,
      submarket: deals.submarket,
      productType: deals.productType,
      askingPrice: deals.askingPrice,
      updatedAt: deals.updatedAt,
      updatedBy: deals.updatedBy,
      createdBy: deals.createdBy,
      mu: demographics.muScore,
      mf: demographics.mfScore,
      verdict: screenResults.verdict,
      probWeighted: screenResults.probWeighted,
      landTest: firstLookResults.landTest,
      combinedVerdict: firstLookResults.combinedVerdict,
      maxLandPrice: firstLookResults.maxLandPrice,
      headroomPctOfAsk: firstLookResults.headroomPctOfAsk,
    })
    .from(deals)
    .leftJoin(demographics, eq(demographics.dealId, deals.id))
    .leftJoin(screenResults, eq(screenResults.dealId, deals.id))
    .leftJoin(firstLookResults, eq(firstLookResults.dealId, deals.id));

  return rows
    .map(
      (row): PipelineRow => ({
        id: row.id,
        name: row.name,
        submarket: row.submarket,
        productType: row.productType,
        mu: row.mu,
        mf: row.mf,
        verdict: row.verdict ?? "NOT SCORED",
        probWeighted: row.probWeighted ?? 0,
        landTest: row.landTest,
        combinedVerdict: row.combinedVerdict ?? "NOT SCORED",
        maxLandPrice: row.maxLandPrice,
        askingPrice: row.askingPrice,
        headroomPctOfAsk: row.headroomPctOfAsk,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy ?? row.createdBy,
      }),
    )
    .sort(comparePipelineRows);
}
