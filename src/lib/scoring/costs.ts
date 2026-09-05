/**
 * Cost stack resolution. Spec B5 §4.
 *
 * Pure: no DB, no fetch. The caller supplies library rates it has already read
 * server-side; this turns them into resolved rates and amounts.
 *
 * Resolution per line:
 *   escalated rate = rate x (1 + annual escalation) ^ years(asOf → today)
 *   resolved rate  = escalated rate x line multiplier x global multiplier
 *   amount         = resolved rate x quantity
 *
 * Percentage lines have no quantity; their "quantity" is whichever subtotal
 * they apply to, which is why the cascade below runs in stages.
 */

import type { Assumptions } from "./assumptions";

export type CostBasis =
  | "per_resi_gsf"
  | "per_retail_sf"
  | "per_office_sf"
  | "per_space"
  | "per_unit"
  | "per_acre"
  | "pct_hard"
  | "pct_soft"
  | "pct_total"
  | "lump";

export type CostCategory = "hard" | "soft" | "other";

export type CostAppliesTo =
  | "resi_hard"
  | "commercial_hard"
  | "hard"
  | "soft"
  | "total";

export type CostSource = "medley" | "ccc" | "custom";

/** A library row, as the server reads it. Never sent to the client. */
export interface CostLibraryLine {
  lineKey: string;
  label: string;
  basis: CostBasis;
  category: CostCategory;
  appliesTo: CostAppliesTo | null;
  sortOrder: number;
  medleyRate: number | null;
  medleyAsof: string | null;
  cccRate: number | null;
  cccAsof: string | null;
  notes: string | null;
}

/** What the user chose for one line. */
export interface CostSelection {
  lineKey: string;
  source: CostSource;
  multiplier: number;
  /** Only read when source is "custom". Already in today's dollars. */
  customRate: number | null;
}

/** The program quantities every basis draws from. */
export interface CostProgram {
  resiUnits: number;
  resiGsf: number;
  retailSf: number;
  officeSf: number;
  /**
   * Split, not a single count: structured and surface parking are separate
   * library lines on the same per_space basis, and a deal with a deck should
   * not also be charged for a surface lot it does not have.
   */
  parkingStructuredSpaces: number;
  parkingSurfaceSpaces: number;
  acreage: number;
}

/** One resolved line. This shape is safe to send to the client. */
export interface ResolvedCostLine {
  lineKey: string;
  label: string;
  basis: CostBasis;
  category: CostCategory;
  source: CostSource;
  multiplier: number;
  /** The quantity the basis drew, or the subtotal a percentage applied to. */
  quantity: number;
  /** Escalated and multiplied. Safe to show; see the spec's note on friction. */
  resolvedRate: number | null;
  resolvedAmount: number;
  /** Sources that actually carry a rate, so the UI offers only those. */
  availableSources: CostSource[];
  /** Years of escalation applied, for the tooltip. */
  escalationYears: number;
  notes: string | null;
}

export interface CostTotals {
  hard: number;
  soft: number;
  other: number;
  /** hard + soft + other. This is what Gate 2 consumes as cost ex-land. */
  costExLand: number;
}

export interface CostResolution {
  lines: ResolvedCostLine[];
  totals: CostTotals;
  /** Escalation actually applied, and whether it is still a placeholder. */
  escalation: { annual: number; isPlaceholder: boolean };
  globalMultiplier: number;
}

/**
 * Split the resolved stack across the three built components, which is the
 * shape First Look wants.
 *
 * Lines whose key names a component are attributed directly — `resi_*` to
 * multifamily, `retail_*` to retail, `office_*` to office. Everything shared
 * (sitework, parking, GC fees, contingency, soft costs, financing) is spread
 * pro rata on those direct shares, falling back to the program's floor area
 * when nothing is directly attributed yet.
 *
 * It is an allocation, not an accounting: the total is exact, the split is a
 * convention. Phase 7 can refine it without changing the total.
 */
export function allocateCostExLand(
  resolution: CostResolution,
  program: CostProgram,
): Record<"retail" | "office" | "multifamily", number> {
  const direct = { retail: 0, office: 0, multifamily: 0 };
  let shared = 0;

  for (const line of resolution.lines) {
    if (line.lineKey.startsWith("resi_")) direct.multifamily += line.resolvedAmount;
    else if (line.lineKey.startsWith("retail_")) direct.retail += line.resolvedAmount;
    else if (line.lineKey.startsWith("office_")) direct.office += line.resolvedAmount;
    else shared += line.resolvedAmount;
  }

  const directTotal = direct.retail + direct.office + direct.multifamily;
  const areaBasis = {
    retail: program.retailSf,
    office: program.officeSf,
    multifamily: program.resiGsf,
  };
  const areaTotal = areaBasis.retail + areaBasis.office + areaBasis.multifamily;

  const share = (component: "retail" | "office" | "multifamily"): number => {
    if (directTotal > 0) return direct[component] / directTotal;
    if (areaTotal > 0) return areaBasis[component] / areaTotal;
    return 0;
  };

  return {
    retail: direct.retail + shared * share("retail"),
    office: direct.office + shared * share("office"),
    multifamily: direct.multifamily + shared * share("multifamily"),
  };
}

export class CostResolutionError extends Error {
  readonly lineKey: string;
  constructor(lineKey: string, message: string) {
    super(message);
    this.name = "CostResolutionError";
    this.lineKey = lineKey;
  }
}

const PERCENTAGE_BASES = new Set<CostBasis>(["pct_hard", "pct_soft", "pct_total"]);

export function isPercentageBasis(basis: CostBasis): boolean {
  return PERCENTAGE_BASES.has(basis);
}

/** Human label for a basis, used by the admin editor and the tooltip. */
export const BASIS_LABEL: Record<CostBasis, string> = {
  per_resi_gsf: "per resi GSF",
  per_retail_sf: "per retail SF",
  per_office_sf: "per office SF",
  per_space: "per space",
  per_unit: "per unit",
  per_acre: "per acre",
  pct_hard: "% of hard",
  pct_soft: "% of soft",
  pct_total: "% of total",
  lump: "lump sum",
};

function quantityFor(
  basis: CostBasis,
  lineKey: string,
  program: CostProgram,
): number {
  // Two lines share the per_space basis, so the line decides which count.
  if (lineKey === "parking_structured") return program.parkingStructuredSpaces;
  if (lineKey === "parking_surface") return program.parkingSurfaceSpaces;

  switch (basis) {
    case "per_resi_gsf":
      return program.resiGsf;
    case "per_retail_sf":
      return program.retailSf;
    case "per_office_sf":
      return program.officeSf;
    case "per_space":
      return program.parkingStructuredSpaces + program.parkingSurfaceSpaces;
    case "per_unit":
      return program.resiUnits;
    case "per_acre":
      return program.acreage;
    case "lump":
      return 1;
    default:
      // Percentage bases take their quantity from a subtotal, not the program.
      return 0;
  }
}

/** Years between an as-of date and today, fractional. */
export function escalationYears(asOf: string | null, today: Date): number {
  if (!asOf) return 0;
  const from = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return 0;
  const years = (today.getTime() - from.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  // Never de-escalate: a rate dated in the future stays as priced.
  return Math.max(0, years);
}

interface SourceRate {
  rate: number | null;
  asOf: string | null;
}

function rateFor(line: CostLibraryLine, selection: CostSelection): SourceRate {
  switch (selection.source) {
    case "medley":
      return { rate: line.medleyRate, asOf: line.medleyAsof };
    case "ccc":
      return { rate: line.cccRate, asOf: line.cccAsof };
    case "custom":
      // A custom rate is typed in today's dollars, so it is not escalated.
      return { rate: selection.customRate, asOf: null };
  }
}

/** Sources that carry a rate. Custom is always available. */
export function availableSources(line: CostLibraryLine): CostSource[] {
  const sources: CostSource[] = [];
  if (line.medleyRate !== null) sources.push("medley");
  if (line.cccRate !== null) sources.push("ccc");
  sources.push("custom");
  return sources;
}

/**
 * Resolve the whole stack.
 *
 * The cascade runs in stages so percentage lines never depend on each other
 * circularly, and so a mixed-use deal's two GC fees each apply to their own
 * half of the hard cost rather than both to the whole:
 *
 *   1. direct lines (every non-percentage basis)
 *   2. `resi_hard` and `commercial_hard` percentages, on their own subtotals
 *   3. `hard` percentages, on all hard including stage 2
 *   4. `soft` percentages, on all soft
 *   5. `total` percentages, on hard + soft
 *
 * Throws when a line with no rate is given a non-zero quantity — the same rule
 * the placeholder assumptions follow. A blank rate is not a zero cost.
 */
export function resolveCosts(
  library: readonly CostLibraryLine[],
  selections: readonly CostSelection[],
  program: CostProgram,
  globalMultiplier: number,
  assumptions: Assumptions,
  today: Date = new Date(),
): CostResolution {
  const annual = assumptions.cost.escalationAnnual ?? 0;
  const isPlaceholder = assumptions.placeholders.has("cost.escalation.annual");

  const byKey = new Map(selections.map((s) => [s.lineKey, s]));
  const ordered = [...library].sort((a, b) => a.sortOrder - b.sortOrder);

  const resolved = new Map<string, ResolvedCostLine>();

  /** Escalate, multiply, and record. `quantity` is supplied by the stage. */
  const resolve = (line: CostLibraryLine, quantity: number): ResolvedCostLine => {
    const selection = byKey.get(line.lineKey) ?? {
      lineKey: line.lineKey,
      source: (availableSources(line)[0] ?? "custom") as CostSource,
      multiplier: 1,
      customRate: null,
    };
    const { rate, asOf } = rateFor(line, selection);

    if (rate === null) {
      if (quantity !== 0) {
        throw new CostResolutionError(
          line.lineKey,
          `"${line.label}" has no rate for source "${selection.source}", but the ` +
            `program gives it a quantity of ${quantity}. Set a rate or a custom ` +
            `value before this line can be costed.`,
        );
      }
      return {
        lineKey: line.lineKey,
        label: line.label,
        basis: line.basis,
        category: line.category,
        source: selection.source,
        multiplier: selection.multiplier,
        quantity: 0,
        resolvedRate: null,
        resolvedAmount: 0,
        availableSources: availableSources(line),
        escalationYears: 0,
        notes: line.notes,
      };
    }

    const years = escalationYears(asOf, today);
    const percentage = isPercentageBasis(line.basis);

    // Escalation and the global multiplier move unit rates, not percentages.
    // A GC fee is 13.2% of hard whether or not construction got 10% dearer —
    // its amount already scales because the base it applies to scales. Scaling
    // the percentage as well compounds, and a 1.10 global multiplier lands the
    // total at 1.14x instead of 1.10x.
    //
    // The per-line multiplier does apply: "this deal's fee should run 5% over
    // Medley's" is a real judgement, and it is the point of the control.
    const escalated = percentage ? rate : rate * Math.pow(1 + annual, years);
    const resolvedRate =
      escalated * selection.multiplier * (percentage ? 1 : globalMultiplier);

    return {
      lineKey: line.lineKey,
      label: line.label,
      basis: line.basis,
      category: line.category,
      source: selection.source,
      multiplier: selection.multiplier,
      quantity,
      resolvedRate,
      resolvedAmount: resolvedRate * quantity,
      availableSources: availableSources(line),
      escalationYears: percentage ? 0 : years,
      notes: line.notes,
    };
  };

  const sumWhere = (predicate: (line: ResolvedCostLine) => boolean): number =>
    [...resolved.values()]
      .filter(predicate)
      .reduce((total, line) => total + line.resolvedAmount, 0);

  const isResi = (key: string) => key.startsWith("resi_");

  // ── Stage 1: direct lines ────────────────────────────────────────────────
  for (const line of ordered) {
    if (isPercentageBasis(line.basis)) continue;
    resolved.set(
      line.lineKey,
      resolve(line, quantityFor(line.basis, line.lineKey, program)),
    );
  }

  // ── Stage 2: percentages scoped to one half of the hard cost ─────────────
  for (const line of ordered) {
    if (!isPercentageBasis(line.basis)) continue;
    if (line.appliesTo !== "resi_hard" && line.appliesTo !== "commercial_hard") {
      continue;
    }
    const wantResi = line.appliesTo === "resi_hard";
    const base = sumWhere(
      (l) => l.category === "hard" && isResi(l.lineKey) === wantResi,
    );
    resolved.set(line.lineKey, resolve(line, base));
  }

  // ── Stage 3: percentages on the whole hard cost, GC fees included ────────
  for (const line of ordered) {
    if (!isPercentageBasis(line.basis) || line.appliesTo !== "hard") continue;
    resolved.set(line.lineKey, resolve(line, sumWhere((l) => l.category === "hard")));
  }

  // ── Stage 4: percentages on soft ─────────────────────────────────────────
  for (const line of ordered) {
    if (!isPercentageBasis(line.basis) || line.appliesTo !== "soft") continue;
    resolved.set(line.lineKey, resolve(line, sumWhere((l) => l.category === "soft")));
  }

  // ── Stage 5: percentages on hard + soft ──────────────────────────────────
  for (const line of ordered) {
    if (!isPercentageBasis(line.basis) || line.appliesTo !== "total") continue;
    const base = sumWhere((l) => l.category === "hard" || l.category === "soft");
    resolved.set(line.lineKey, resolve(line, base));
  }

  const lines = ordered
    .map((line) => resolved.get(line.lineKey))
    .filter((line): line is ResolvedCostLine => line !== undefined);

  const hard = sumWhere((l) => l.category === "hard");
  const soft = sumWhere((l) => l.category === "soft");
  const other = sumWhere((l) => l.category === "other");

  return {
    lines,
    totals: { hard, soft, other, costExLand: hard + soft + other },
    escalation: { annual, isPlaceholder },
    globalMultiplier,
  };
}
