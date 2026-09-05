/**
 * Drizzle schema. Build spec B4.
 *
 * Will become packages/db. Nothing here imports from src/app or src/lib/scoring.
 *
 * Money and rates are `numeric` in `{ mode: "number" }` so they arrive in the
 * engine as plain numbers rather than strings, while keeping exact decimal
 * storage. Scores and shares are double precision — they are computed values,
 * not ledger amounts.
 */

import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const productTypeEnum = pgEnum("product_type", [
  "auto",
  "mixed_use",
  "multifamily",
]);

export const dealStatusEnum = pgEnum("deal_status", [
  "draft",
  "screened",
  "pursuing",
  "passed",
  "archived",
]);

export const demographicsSourceEnum = pgEnum("demographics_source", [
  "api",
  "manual",
]);

export const demographicBandEnum = pgEnum("demographic_band", [
  "GO",
  "WATCH",
  "NO-GO",
]);

export const costSourceEnum = pgEnum("cost_source", ["medley", "ccc", "custom"]);

export const costBasisEnum = pgEnum("cost_basis", [
  "per_resi_gsf",
  "per_retail_sf",
  "per_office_sf",
  "per_space",
  "per_unit",
  "per_acre",
  "pct_hard",
  "pct_soft",
  "pct_total",
  "lump",
]);

/** Which subtotal a line rolls into. Not the same as its basis. */
export const costCategoryEnum = pgEnum("cost_category", ["hard", "soft", "other"]);

/**
 * What a percentage line is a percentage *of*.
 *
 * Needed because a mixed-use deal carries two GC fees — a residential GMP fee
 * and a commercial one — and applying both to the whole hard base would double
 * count them at ~26%. Meaningless for the non-percentage bases.
 */
export const costAppliesToEnum = pgEnum("cost_applies_to", [
  "resi_hard",
  "commercial_hard",
  "hard",
  "soft",
  "total",
]);

export const compTypeEnum = pgEnum("comp_type", ["apartment", "retail", "office"]);

export const screenAnswerEnum = pgEnum("screen_answer", ["yes", "maybe", "no"]);

export const koResultEnum = pgEnum("ko_result", ["PASS", "FAIL"]);

export const combinedVerdictEnum = pgEnum("combined_verdict", [
  "DOUBLE GO",
  "GO — LAND FAIL",
  "WATCH",
  "INCOMPLETE",
  "NO-GO",
  "NOT SCORED",
]);

export const verdictEnum = pgEnum("verdict", [
  "GO",
  "WATCH",
  "NO-GO",
  "INCOMPLETE",
  "NOT SCORED",
]);

// ---------------------------------------------------------------------------
// Deal and its one-to-one sections
// ---------------------------------------------------------------------------

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Seven-character geohash — the demographics cache key (spec A4). */
    geohash7: text("geohash7"),
    acreage: numeric("acreage", { precision: 12, scale: 4, mode: "number" }),
    jurisdiction: text("jurisdiction"),
    submarket: text("submarket"),
    productType: productTypeEnum("product_type").notNull().default("auto"),
    askingPrice: numeric("asking_price", {
      precision: 16,
      scale: 2,
      mode: "number",
    }),
    /**
     * Public money credited against cost ex-land: TAD/CID reimbursements,
     * bond proceeds, abatement NPV. On the deal rather than in `cost_library`
     * because it is negotiated per site, not a rate that describes a build.
     */
    incentives: numeric("incentives", {
      precision: 16,
      scale: 2,
      mode: "number",
    }),
    incentivesNote: text("incentives_note"),
    /**
     * The date library rates are escalated to. Deal-level: it says when this
     * deal is being priced, not anything about a particular rate. Null means
     * price at whatever today is when it is opened.
     */
    costPricingDate: date("cost_pricing_date"),
    createdBy: text("created_by").notNull(),
    /** Who last pressed Save. Stamped on every write, not just the first. */
    updatedBy: text("updated_by"),
    /** Deal-wide cost multiplier. A per-line one lives on `cost_lines`. */
    costGlobalMultiplier: numeric("cost_global_multiplier", {
      precision: 6,
      scale: 4,
      mode: "number",
    })
      .notNull()
      .default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: dealStatusEnum("status").notNull().default("draft"),
  },
  (table) => [
    index("deals_geohash7_idx").on(table.geohash7),
    index("deals_created_by_idx").on(table.createdBy),
  ],
);

export const demographics = pgTable("demographics", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deals.id, { onDelete: "cascade" }),
  muScore: doublePrecision("mu_score"),
  mfScore: doublePrecision("mf_score"),
  population3mi: integer("population_3mi"),
  radiusMi: numeric("radius_mi", { precision: 5, scale: 2, mode: "number" }),
  /** The nine dashboard metrics with their weights, so the page can show why. */
  metrics: jsonb("metrics"),
  pulledAt: timestamp("pulled_at", { withTimezone: true }),
  dashboardVersion: text("dashboard_version"),
  source: demographicsSourceEnum("source").notNull().default("api"),
});

export const programs = pgTable("programs", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deals.id, { onDelete: "cascade" }),
  resiUnits: integer("resi_units"),
  /** Weighted average unit size. Residential NOI is built off this. */
  avgNsf: integer("avg_nsf"),
  /** [{ type, count, avgNsf }] */
  unitMix: jsonb("unit_mix"),
  resiNrsf: integer("resi_nrsf"),
  resiGsf: integer("resi_gsf"),
  retailSf: integer("retail_sf"),
  officeSf: integer("office_sf"),
  parkingSpaces: integer("parking_spaces"),
  parkingType: text("parking_type"),
  hotelKeys: integer("hotel_keys"),
  thLots: integer("th_lots"),
  outparcels: integer("outparcels"),
  stories: integer("stories"),
  constructionType: text("construction_type"),
});

export const revenue = pgTable("revenue", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deals.id, { onDelete: "cascade" }),
  resiRentPsfMo: numeric("resi_rent_psf_mo", {
    precision: 10,
    scale: 4,
    mode: "number",
  }),
  retailRentPsf: numeric("retail_rent_psf", {
    precision: 10,
    scale: 4,
    mode: "number",
  }),
  officeRentPsf: numeric("office_rent_psf", {
    precision: 10,
    scale: 4,
    mode: "number",
  }),
  /** { resi, retail, office } vacancy fractions. */
  vacancy: jsonb("vacancy"),
  opexPerUnit: numeric("opex_per_unit", {
    precision: 12,
    scale: 2,
    mode: "number",
  }),
  /**
   * Split per component. A single non-recoverable column could not hold a
   * mixed-use deal: retail and office are quoted on different structures and
   * routinely differ.
   */
  retailNonrecovPsf: numeric("retail_nonrecov_psf", {
    precision: 10,
    scale: 4,
    mode: "number",
  }),
  officeNonrecovPsf: numeric("office_nonrecov_psf", {
    precision: 10,
    scale: 4,
    mode: "number",
  }),
  /** Per field: "manual" or "ai_confirmed". Never "ai_draft" — see comps. */
  rentSource: jsonb("rent_source"),
});

export const screenResults = pgTable("screen_results", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deals.id, { onDelete: "cascade" }),
  weightedScore: doublePrecision("weighted_score").notNull(),
  unknownShare: doublePrecision("unknown_share").notNull(),
  koPass: koResultEnum("ko_pass").notNull(),
  demoBand: demographicBandEnum("demo_band"),
  verdict: verdictEnum("verdict").notNull(),
  prob: doublePrecision("prob").notNull(),
  probWeighted: doublePrecision("prob_weighted").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Gate 2 as of the last save. Denormalised on purpose: the pipeline lists every
 * deal at once and must not re-resolve a cost stack per row to draw a table.
 */
export const firstLookResults = pgTable("first_look_results", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deals.id, { onDelete: "cascade" }),
  totalNoi: numeric("total_noi", { precision: 16, scale: 2, mode: "number" }),
  totalCostExLand: numeric("total_cost_ex_land", {
    precision: 16,
    scale: 2,
    mode: "number",
  }),
  /** The credit applied, and the cost actually funded after it. */
  incentives: numeric("fl_incentives", {
    precision: 16,
    scale: 2,
    mode: "number",
  }),
  netCostExLand: numeric("net_cost_ex_land", {
    precision: 16,
    scale: 2,
    mode: "number",
  }),
  maxLandPrice: numeric("max_land_price", {
    precision: 16,
    scale: 2,
    mode: "number",
  }),
  /** Headroom over the ask as a share of it. Null when there is no ask. */
  headroomPctOfAsk: doublePrecision("headroom_pct_of_ask"),
  yocOnCost: doublePrecision("yoc_on_cost"),
  blendedYoc: doublePrecision("blended_yoc"),
  retailShareOfNoi: doublePrecision("retail_share_of_noi"),
  /** Null is the workbook em-dash: the test ran with no ask to test against. */
  landTest: koResultEnum("land_test"),
  combinedVerdict: combinedVerdictEnum("combined_verdict").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Census results keyed the way the dashboard keys them. Spec A4.
 *
 * A geohash7 cell is about 150 m across, so two addresses on the same parcel
 * share a row. `version` carries the ACS vintage and scoring revision, so a
 * change to either invalidates every cached row without a delete.
 */
export const demographicsCache = pgTable(
  "demographics_cache",
  {
    geohash7: text("geohash7").notNull(),
    radiusMi: numeric("radius_mi", {
      precision: 5,
      scale: 2,
      mode: "number",
    }).notNull(),
    version: text("version").notNull(),
    /** The whole computed response, as the route would have returned it. */
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.geohash7, table.radiusMi, table.version] }),
  ],
);

// ---------------------------------------------------------------------------
// Per-deal collections
// ---------------------------------------------------------------------------

export const costLines = pgTable(
  "cost_lines",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    lineKey: text("line_key").notNull(),
    source: costSourceEnum("source").notNull(),
    multiplier: numeric("multiplier", {
      precision: 6,
      scale: 4,
      mode: "number",
    })
      .notNull()
      .default(1),
    customRate: numeric("custom_rate", {
      precision: 14,
      scale: 4,
      mode: "number",
    }),
    /** Escalated, multiplied rate. Safe to send to the client. */
    resolvedRate: numeric("resolved_rate", {
      precision: 14,
      scale: 4,
      mode: "number",
    }),
    /** Resolved rate x quantity. Safe to send to the client. */
    resolvedAmount: numeric("resolved_amount", {
      precision: 16,
      scale: 2,
      mode: "number",
    }),
  },
  (table) => [primaryKey({ columns: [table.dealId, table.lineKey] })],
);

export const comps = pgTable(
  "comps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    placeId: text("place_id"),
    name: text("name").notNull(),
    address: text("address"),
    type: compTypeEnum("type").notNull(),
    rating: doublePrecision("rating"),
    /** Below the ratings floor the row is flagged low-signal and starts unticked. */
    ratingCount: integer("rating_count"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    distanceMi: numeric("distance_mi", {
      precision: 8,
      scale: 3,
      mode: "number",
    }),
    yearBuilt: integer("year_built"),
    units: integer("units"),
    rentPsf: numeric("rent_psf", { precision: 10, scale: 4, mode: "number" }),
    rentSource: text("rent_source"),
    /** Drafted by Claude. Excluded from NOI until a human confirms it. */
    aiDraft: boolean("ai_draft").notNull().default(false),
    include: boolean("include").notNull().default(true),
  },
  (table) => [index("comps_deal_id_idx").on(table.dealId)],
);

export const padSourceEnum = pgEnum("pad_source", ["convention", "custom"]);

export const padParcelEnum = pgEnum("pad_parcel", [
  "hotel",
  "townhome",
  "outparcel",
]);

/**
 * Per-deal pad rate overrides. Mirrors `cost_lines`: the convention lives in
 * assumptions, and a row here says this deal has a real contract instead.
 */
export const padLines = pgTable(
  "pad_lines",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    parcel: padParcelEnum("parcel").notNull(),
    source: padSourceEnum("source").notNull().default("convention"),
    customRate: numeric("custom_rate", {
      precision: 14,
      scale: 4,
      mode: "number",
    }),
    note: text("note"),
  },
  (table) => [primaryKey({ columns: [table.dealId, table.parcel] })],
);

export const screenAnswers = pgTable(
  "screen_answers",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    criterionKey: text("criterion_key").notNull(),
    /** Null means not yet answered, which counts toward neither test. */
    answer: screenAnswerEnum("answer"),
    note: text("note"),
    answeredBy: text("answered_by"),
  },
  (table) => [primaryKey({ columns: [table.dealId, table.criterionKey] })],
);

// ---------------------------------------------------------------------------
// Admin-only reference data
// ---------------------------------------------------------------------------

/**
 * ADMIN ONLY. Rows here never reach the client. Server code resolves a line and
 * returns only `resolved_rate` and `resolved_amount`; any route that would
 * return library rows must call `requireRole(session, "admin")` first.
 */
export const costLibrary = pgTable("cost_library", {
  lineKey: text("line_key").primaryKey(),
  label: text("label").notNull(),
  basis: costBasisEnum("basis").notNull(),
  category: costCategoryEnum("category").notNull(),
  /** Only meaningful for the `pct_*` bases. */
  appliesTo: costAppliesToEnum("applies_to"),
  /** Display order in the Costs section. */
  sortOrder: integer("sort_order").notNull().default(0),
  medleyRate: numeric("medley_rate", {
    precision: 14,
    scale: 4,
    mode: "number",
  }),
  medleyAsof: date("medley_asof"),
  cccRate: numeric("ccc_rate", { precision: 14, scale: 4, mode: "number" }),
  cccAsof: date("ccc_asof"),
  notes: text("notes"),
});

export const costLibraryLog = pgTable(
  "cost_library_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    who: text("who").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    lineKey: text("line_key").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
  },
  (table) => [index("cost_library_log_line_key_idx").on(table.lineKey)],
);

/**
 * Mirrors the workbook's Assumptions tab, plus the app-level levers the
 * workbook does not have (geography bands, cost escalation).
 *
 * Seeded from docs/assumptions.csv. Every weight, KO flag, threshold, yield,
 * land convention, pad rate and band the engine uses comes from here.
 */
export const assumptions = pgTable("assumptions", {
  key: text("key").primaryKey(),
  value: text("value"),
  source: text("source"),
  asof: date("asof"),
});

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type DemographicsRow = typeof demographics.$inferSelect;
export type Program = typeof programs.$inferSelect;
export type RevenueRow = typeof revenue.$inferSelect;
export type CostLine = typeof costLines.$inferSelect;
export type Comp = typeof comps.$inferSelect;
export type ScreenAnswer = typeof screenAnswers.$inferSelect;
export type PadLine = typeof padLines.$inferSelect;
export type ScreenResult = typeof screenResults.$inferSelect;
export type FirstLookRow = typeof firstLookResults.$inferSelect;
export type DemographicsCacheRow = typeof demographicsCache.$inferSelect;
export type CostLibraryRow = typeof costLibrary.$inferSelect;
export type CostLibraryLogRow = typeof costLibraryLog.$inferSelect;
export type AssumptionRecord = typeof assumptions.$inferSelect;
