/**
 * The assumptions object. Every lever the engine uses lives here.
 *
 * Nothing in screen.ts, firstLook.ts or demographics.ts may contain a scoring
 * constant. They all read from an `Assumptions` value passed in by the caller,
 * which is built from the `assumptions` table (seeded from docs/assumptions.csv,
 * which mirrors the workbook's Assumptions tab).
 */

import type {
  AssumptionRow,
  BucketKey,
  CriterionDef,
  CriterionKind,
  ProductType,
} from "./types";

export interface Assumptions {
  /** Informational: bucket weights as fractions. Criterion weights already sum to 100. */
  bucketWeights: Record<BucketKey, number>;
  answerPoints: { yes: number; maybe: number; no: number; max: number };
  verdict: {
    goMin: number;
    watchMin: number;
    maxUnknownShare: number;
    knockoutActive: boolean;
    requiredAnswered: number;
  };
  probability: { default: number; min: number; max: number };
  /** Target yield on cost per component. */
  yoc: Record<ComponentYoc, number>;
  land: {
    /** Financing and contingency carried on incremental land. */
    carryRate: number;
    retailPsf: number;
    officePsf: number;
    multifamilyPerUnit: number;
  };
  /**
   * Pad sale rates. Null where the workbook leaves the cell blank; a rate may
   * also be non-null and still be a placeholder — check `placeholders`.
   */
  pad: {
    hotelPerKey: number | null;
    townhomePerLot: number | null;
    outparcelPerParcel: number | null;
  };
  productType: { maxRetailNoiShareForMf: number };
  demoBands: Record<ProductType, { go: number; nogo: number }>;
  /** Denominator converting a 0-100 dashboard score to criterion points. */
  demoScoreMax: number;
  geographyBands: { yesMaxMinutes: number; maybeMaxMinutes: number };
  sensitivity: { commYocAxis: number[]; mfYocAxis: number[] };
  /** Annual cost escalation. Currently a placeholder — see `placeholders`. */
  cost: { escalationAnnual: number | null };
  /** All scored criteria, in Deal Screen order. */
  criteria: CriterionDef[];
  /**
   * Keys whose `source` column is exactly "placeholder": a value that is
   * standing in for a real one nobody has supplied yet. The engine refuses to
   * compute with these rather than quietly returning a number built on a guess.
   */
  placeholders: ReadonlySet<string>;
}

type ComponentYoc = "retail" | "office" | "multifamily";

const BUCKETS: readonly BucketKey[] = ["real_estate", "site", "deal", "toro"];
const KINDS: readonly CriterionKind[] = ["answered", "computed"];

export class AssumptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssumptionsError";
  }
}

/**
 * Thrown when a calculation would have to rely on a placeholder assumption.
 *
 * A wrong number that looks right is worse than no number: a placeholder pad
 * rate understates the land basis we can recover, which raises the price we
 * think we can pay.
 */
export class PlaceholderAssumptionError extends Error {
  readonly key: string;
  constructor(key: string, context: string) {
    super(
      `assumptions: "${key}" is a placeholder, but ${context}. ` +
        `Set a real value in docs/assumptions.csv and re-run pnpm db:seed.`,
    );
    this.name = "PlaceholderAssumptionError";
    this.key = key;
  }
}

/** The exact `source` value that marks a row as standing in for a real one. */
export const PLACEHOLDER_SOURCE = "placeholder";

/** Whether this assumption key is a placeholder. */
export function isPlaceholder(assumptions: Assumptions, key: string): boolean {
  return assumptions.placeholders.has(key);
}

/** Every placeholder key, sorted. For seed output and admin warnings. */
export function placeholderKeys(assumptions: Assumptions): string[] {
  return [...assumptions.placeholders].sort();
}

/**
 * Build the typed assumptions object from raw key/value rows.
 *
 * Throws on a missing or unparseable required key rather than defaulting —
 * a silently defaulted weight is a wrong verdict nobody notices.
 */
export function buildAssumptions(rows: readonly AssumptionRow[]): Assumptions {
  const map = new Map<string, string>();
  const placeholders = new Set<string>();
  for (const row of rows) {
    if (row.value !== null && row.value !== undefined) {
      map.set(row.key, row.value);
    }
    // Registered from the source column regardless of whether a value is
    // present: a placeholder can carry a stand-in number (cost escalation) or
    // no number at all (the two blank pad rates).
    if ((row.source ?? "").trim().toLowerCase() === PLACEHOLDER_SOURCE) {
      placeholders.add(row.key);
    }
  }

  const raw = (key: string): string => {
    const value = map.get(key);
    if (value === undefined || value.trim() === "") {
      throw new AssumptionsError(`assumptions: missing required key "${key}"`);
    }
    return value.trim();
  };

  const num = (key: string): number => {
    const value = Number(raw(key));
    if (!Number.isFinite(value)) {
      throw new AssumptionsError(
        `assumptions: key "${key}" is not a finite number (got "${map.get(key)}")`,
      );
    }
    return value;
  };

  const bool = (key: string): boolean => {
    const value = raw(key).toLowerCase();
    if (value === "true" || value === "active" || value === "yes") return true;
    if (value === "false" || value === "inactive" || value === "no") return false;
    throw new AssumptionsError(
      `assumptions: key "${key}" is not a boolean (got "${map.get(key)}")`,
    );
  };

  const numList = (key: string): number[] => {
    const parts = raw(key)
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (parts.length === 0) {
      throw new AssumptionsError(`assumptions: key "${key}" is an empty list`);
    }
    return parts.map((part) => {
      const value = Number(part);
      if (!Number.isFinite(value)) {
        throw new AssumptionsError(
          `assumptions: key "${key}" contains a non-numeric entry "${part}"`,
        );
      }
      return value;
    });
  };

  /** Optional numeric key: absent or blank yields null. */
  const optionalNum = (key: string): number | null => {
    const value = map.get(key);
    if (value === undefined || value.trim() === "") return null;
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) {
      throw new AssumptionsError(
        `assumptions: key "${key}" is not a finite number (got "${value}")`,
      );
    }
    return parsed;
  };

  return {
    bucketWeights: {
      real_estate: num("bucket.weight.real_estate"),
      site: num("bucket.weight.site"),
      deal: num("bucket.weight.deal"),
      toro: num("bucket.weight.toro"),
    },
    answerPoints: {
      yes: num("answer.points.yes"),
      maybe: num("answer.points.maybe"),
      no: num("answer.points.no"),
      max: num("answer.points.max"),
    },
    verdict: {
      goMin: num("verdict.go_min"),
      watchMin: num("verdict.watch_min"),
      maxUnknownShare: num("verdict.max_unknown_share"),
      knockoutActive: bool("verdict.knockout_active"),
      requiredAnswered: num("verdict.required_answered"),
    },
    probability: {
      default: num("screen.probability.default"),
      min: num("screen.probability.min"),
      max: num("screen.probability.max"),
    },
    yoc: {
      retail: num("yoc.target.retail"),
      office: num("yoc.target.office"),
      multifamily: num("yoc.target.multifamily"),
    },
    land: {
      carryRate: num("land.carry_rate"),
      retailPsf: num("land.rate.retail_psf"),
      officePsf: num("land.rate.office_psf"),
      multifamilyPerUnit: num("land.rate.multifamily_per_unit"),
    },
    pad: {
      hotelPerKey: optionalNum("pad.rate.hotel_per_key"),
      townhomePerLot: optionalNum("pad.rate.townhome_per_lot"),
      outparcelPerParcel: optionalNum("pad.rate.outparcel_per_parcel"),
    },
    productType: {
      maxRetailNoiShareForMf: num("product_type.max_retail_noi_share_for_mf"),
    },
    demoBands: {
      mixed_use: {
        go: num("demo.band.mixed_use.go"),
        nogo: num("demo.band.mixed_use.nogo"),
      },
      multifamily: {
        go: num("demo.band.multifamily.go"),
        nogo: num("demo.band.multifamily.nogo"),
      },
    },
    demoScoreMax: num("demo.score.max"),
    geographyBands: {
      yesMaxMinutes: num("geography.band.yes_max_minutes"),
      maybeMaxMinutes: num("geography.band.maybe_max_minutes"),
    },
    sensitivity: {
      commYocAxis: numList("sensitivity.comm_yoc_axis"),
      mfYocAxis: numList("sensitivity.mf_yoc_axis"),
    },
    cost: { escalationAnnual: optionalNum("cost.escalation.annual") },
    criteria: buildCriteria(map),
    placeholders,
  };
}

const CRITERION_PREFIX = "criterion.";

function buildCriteria(map: ReadonlyMap<string, string>): CriterionDef[] {
  const keys = new Set<string>();
  for (const key of map.keys()) {
    if (!key.startsWith(CRITERION_PREFIX)) continue;
    const rest = key.slice(CRITERION_PREFIX.length);
    const dot = rest.lastIndexOf(".");
    if (dot > 0) keys.add(rest.slice(0, dot));
  }

  const field = (criterion: string, name: string): string => {
    const value = map.get(`${CRITERION_PREFIX}${criterion}.${name}`);
    if (value === undefined || value.trim() === "") {
      throw new AssumptionsError(
        `assumptions: criterion "${criterion}" is missing "${name}"`,
      );
    }
    return value.trim();
  };

  const criteria = [...keys].map((key): CriterionDef => {
    const bucket = field(key, "bucket") as BucketKey;
    if (!BUCKETS.includes(bucket)) {
      throw new AssumptionsError(
        `assumptions: criterion "${key}" has unknown bucket "${bucket}"`,
      );
    }
    const kind = field(key, "kind") as CriterionKind;
    if (!KINDS.includes(kind)) {
      throw new AssumptionsError(
        `assumptions: criterion "${key}" has unknown kind "${kind}"`,
      );
    }
    const weight = Number(field(key, "weight"));
    const order = Number(field(key, "order"));
    if (!Number.isFinite(weight) || !Number.isFinite(order)) {
      throw new AssumptionsError(
        `assumptions: criterion "${key}" has a non-numeric weight or order`,
      );
    }
    const ko = field(key, "ko").toLowerCase();
    if (ko !== "true" && ko !== "false") {
      throw new AssumptionsError(
        `assumptions: criterion "${key}" has a non-boolean ko flag "${ko}"`,
      );
    }
    return {
      key,
      label: field(key, "label"),
      bucket,
      weight,
      ko: ko === "true",
      kind,
      order,
    };
  });

  if (criteria.length === 0) {
    throw new AssumptionsError("assumptions: no criteria defined");
  }
  criteria.sort((a, b) => a.order - b.order);
  return criteria;
}

/**
 * Consistency checks worth running once at seed or boot time. Returns a list of
 * human-readable problems; empty means the table hangs together.
 *
 * These are warnings about the *table*, not about any particular deal, which is
 * why they are separate from buildAssumptions' hard failures.
 */
export function validateAssumptions(assumptions: Assumptions): string[] {
  const problems: string[] = [];

  const totalWeight = assumptions.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(totalWeight - 100) > 1e-9) {
    problems.push(`criterion weights sum to ${totalWeight}, expected 100`);
  }

  for (const bucket of BUCKETS) {
    const bucketTotal = assumptions.criteria
      .filter((c) => c.bucket === bucket)
      .reduce((sum, c) => sum + c.weight, 0);
    const expected = assumptions.bucketWeights[bucket] * 100;
    if (Math.abs(bucketTotal - expected) > 1e-9) {
      problems.push(
        `bucket "${bucket}" criterion weights sum to ${bucketTotal}, ` +
          `but bucket.weight.${bucket} implies ${expected}`,
      );
    }
  }

  const answered = assumptions.criteria.filter((c) => c.kind === "answered").length;
  if (answered !== assumptions.verdict.requiredAnswered) {
    problems.push(
      `${answered} criteria are kind "answered" but ` +
        `verdict.required_answered is ${assumptions.verdict.requiredAnswered}`,
    );
  }

  if (assumptions.verdict.watchMin > assumptions.verdict.goMin) {
    problems.push("verdict.watch_min is above verdict.go_min");
  }

  for (const type of ["mixed_use", "multifamily"] as const) {
    const band = assumptions.demoBands[type];
    if (band.nogo >= band.go) {
      problems.push(`demo band for "${type}" has nogo >= go`);
    }
  }

  if (
    assumptions.geographyBands.yesMaxMinutes >= assumptions.geographyBands.maybeMaxMinutes
  ) {
    problems.push("geography.band.yes_max_minutes is not below maybe_max_minutes");
  }

  return problems;
}
