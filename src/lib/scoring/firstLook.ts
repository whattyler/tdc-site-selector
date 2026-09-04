/**
 * First Look UW tab.
 *
 * Works backward. Each component's NOI and target yield imply a total cost the
 * deal can carry. Subtract everything that isn't land, add back the parcels we
 * sell rather than build, take the carry off the top, and what is left is the
 * most we can pay for the land.
 *
 * Workbook reference — First Look UW!C8:G53.
 */

import {
  type Assumptions,
  AssumptionsError,
  PlaceholderAssumptionError,
} from "./assumptions";
import type { ComponentKey, LandTest, ProductType } from "./types";

/** Stabilized NOI and cost excluding land, per built component, all phases. */
export interface ComponentInput {
  noi: number;
  costExLand: number;
}

export type ComponentInputs = Record<ComponentKey, ComponentInput>;

/** Parcels sold rather than built. Proceeds reduce the land basis. */
export interface PadInput {
  hotelKeys: number;
  townhomeLots: number;
  outparcels: number;
}

/** Quantities for the TDC land-rate sanity check. */
export interface SanityQuantities {
  retailSf: number;
  officeSf: number;
  multifamilyUnits: number;
}

export interface FirstLookInput {
  components: ComponentInputs;
  pads: PadInput;
  /** What the seller wants, or the basis in the model. 0 means not set. */
  askingPrice: number;
  /** Site acreage, for the per-acre check. 0 means not set. */
  acreage: number;
  sanity: SanityQuantities;
  /**
   * Per-component target yield overrides. The workbook pulls these from the
   * Assumptions tab but leaves the cells editable.
   */
  yocOverrides?: Partial<Record<ComponentKey, number>>;
}

export interface ComponentSupport {
  component: ComponentKey;
  noi: number;
  costExLand: number;
  targetYoc: number;
  /** `noi / targetYoc` — the total cost this component's income supports. */
  totalCostSupported: number;
}

export interface PadProceedsLine {
  parcel: "hotel" | "townhome" | "outparcel";
  quantity: number;
  /** Null where the assumption has no rate. Only reachable at quantity 0. */
  rate: number | null;
  proceeds: number;
}

/** Assumption key backing each pad line, for placeholder reporting. */
export const PAD_RATE_KEYS = {
  hotel: "pad.rate.hotel_per_key",
  townhome: "pad.rate.townhome_per_lot",
  outparcel: "pad.rate.outparcel_per_parcel",
} as const satisfies Record<PadProceedsLine["parcel"], string>;

export interface PadProceedsResult {
  lines: PadProceedsLine[];
  total: number;
}

export interface SensitivityGrid {
  /** Commercial (retail and office) target yields, across the top. */
  commYocAxis: number[];
  /** Multifamily target yields, down the side. */
  mfYocAxis: number[];
  /** `cells[mfIndex][commIndex]` = maximum land price at that pair. */
  cells: number[][];
}

export interface FirstLookResult {
  /** Step 1 — what the income supports. */
  support: ComponentSupport[];
  totalNoi: number;
  totalCostExLand: number;
  totalCostSupported: number;
  /** Blended hurdle implied by this component mix, not a fixed number. */
  blendedYoc: number;

  /** Step 2 — parcels we sell rather than build. */
  padProceeds: PadProceedsResult;

  /** Step 3 — the most we can pay for the land. */
  landValueBeforeCarry: number;
  carryRate: number;
  maxLandPrice: number;

  /** Step 4 — against the asking price. */
  askingPrice: number;
  headroom: number;
  headroomPctOfAsk: number;
  maxLandPricePerAcre: number;
  landTest: LandTest;

  /** Sanity checks. */
  landAtTdcRates: number;
  maxLandPriceVsTdcRates: number;
  retailShareOfNoi: number;
  /** Null when there is no NOI to test against. */
  productTypeTest: ProductType | null;

  sensitivity: SensitivityGrid;
}

const COMPONENTS: readonly ComponentKey[] = ["retail", "office", "multifamily"];

/**
 * Excel's `IFERROR(a/b, 0)`. A zero or non-finite denominator yields 0 rather
 * than Infinity or NaN, which is what every division on this tab is wrapped in.
 */
function safeDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator === 0) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

/** The target yield actually in force for a component. */
export function targetYoc(
  component: ComponentKey,
  assumptions: Assumptions,
  overrides?: Partial<Record<ComponentKey, number>>,
): number {
  const override = overrides?.[component];
  return override === undefined ? assumptions.yoc[component] : override;
}

/**
 * Step 1 — total cost each component's income supports.
 *
 * Workbook: `=IFERROR(C8/E8,0)` per component.
 */
export function componentSupport(
  components: ComponentInputs,
  assumptions: Assumptions,
  overrides?: Partial<Record<ComponentKey, number>>,
): ComponentSupport[] {
  return COMPONENTS.map((component) => {
    const input = components[component];
    const yoc = targetYoc(component, assumptions, overrides);
    return {
      component,
      noi: input.noi,
      costExLand: input.costExLand,
      targetYoc: yoc,
      totalCostSupported: safeDiv(input.noi, yoc),
    };
  });
}

/**
 * Step 2 — proceeds from parcels sold rather than built.
 *
 * Workbook: `=IFERROR(C15*D15,0)` per line, summed at E18.
 *
 * Throws `PlaceholderAssumptionError` if a parcel with a non-zero quantity
 * would be priced off a placeholder rate. Pad proceeds reduce the land basis,
 * so a stand-in rate here flows straight into the maximum land price — the
 * workbook's blank cells quietly cost us the whole townhome and outparcel
 * recovery. At quantity zero the rate cannot change the answer, so the line is
 * simply zero and nothing is thrown.
 */
export function padProceeds(
  pads: PadInput,
  assumptions: Assumptions,
): PadProceedsResult {
  const line = (
    parcel: PadProceedsLine["parcel"],
    quantity: number,
  ): PadProceedsLine => {
    const key = PAD_RATE_KEYS[parcel];
    const rate = assumptions.pad[PAD_FIELDS[parcel]];

    if (quantity === 0) return { parcel, quantity, rate, proceeds: 0 };

    if (assumptions.placeholders.has(key)) {
      throw new PlaceholderAssumptionError(
        key,
        `this deal has ${quantity} ${PAD_UNITS[parcel]} whose sale proceeds ` +
          `reduce the land basis`,
      );
    }
    if (rate === null) {
      throw new AssumptionsError(
        `assumptions: "${key}" has no value, but this deal has ${quantity} ` +
          `${PAD_UNITS[parcel]}`,
      );
    }

    // Workbook wraps each line in IFERROR, so a non-finite quantity is a zero
    // rather than a NaN propagating into the land price.
    const proceeds = quantity * rate;
    return {
      parcel,
      quantity,
      rate,
      proceeds: Number.isFinite(proceeds) ? proceeds : 0,
    };
  };

  const lines: PadProceedsLine[] = [
    line("hotel", pads.hotelKeys),
    line("townhome", pads.townhomeLots),
    line("outparcel", pads.outparcels),
  ];

  return { lines, total: lines.reduce((sum, item) => sum + item.proceeds, 0) };
}

const PAD_FIELDS = {
  hotel: "hotelPerKey",
  townhome: "townhomePerLot",
  outparcel: "outparcelPerParcel",
} as const satisfies Record<PadProceedsLine["parcel"], keyof Assumptions["pad"]>;

const PAD_UNITS = {
  hotel: "hotel keys",
  townhome: "townhome lots",
  outparcel: "outparcels",
} as const satisfies Record<PadProceedsLine["parcel"], string>;

/**
 * Step 3 — maximum land price.
 *
 * Workbook: `C24 = C21 + C22 + C23` where C22 is negative cost ex-land, then
 * `C26 = C24 / (1 + C25)`. The carry divides rather than subtracts: incremental
 * land is levered too, so the financing and contingency ride on top of whatever
 * we actually pay.
 */
export function maxLandPrice(
  totalCostSupported: number,
  totalCostExLand: number,
  totalPadProceeds: number,
  assumptions: Assumptions,
): { landValueBeforeCarry: number; carryRate: number; maxLandPrice: number } {
  const landValueBeforeCarry =
    totalCostSupported - totalCostExLand + totalPadProceeds;
  const carryRate = assumptions.land.carryRate;
  return {
    landValueBeforeCarry,
    carryRate,
    maxLandPrice: safeDiv(landValueBeforeCarry, 1 + carryRate),
  };
}

/**
 * What we would normally pay for these components at TDC land conventions.
 *
 * Workbook: `=SUM(E38:E40)` over quantity x rate.
 */
export function landAtTdcRates(
  sanity: SanityQuantities,
  assumptions: Assumptions,
): number {
  return (
    sanity.retailSf * assumptions.land.retailPsf +
    sanity.officeSf * assumptions.land.officePsf +
    sanity.multifamilyUnits * assumptions.land.multifamilyPerUnit
  );
}

/**
 * Which product type the retail share of NOI implies.
 *
 * Workbook: `=IF(C11=0,"—",IF(C43<=Assumptions!C47,"Multifamily","Mixed-Use"))`.
 * At or below the threshold it tests as Multifamily. The deal's own product type
 * can still override this; the spec warns on disagreement rather than forcing.
 */
export function productTypeTest(
  retailNoi: number,
  totalNoi: number,
  assumptions: Assumptions,
): { retailShareOfNoi: number; suggested: ProductType | null } {
  const retailShareOfNoi = safeDiv(retailNoi, totalNoi);
  if (totalNoi === 0) return { retailShareOfNoi, suggested: null };
  return {
    retailShareOfNoi,
    suggested:
      retailShareOfNoi <= assumptions.productType.maxRetailNoiShareForMf
        ? "multifamily"
        : "mixed_use",
  };
}

/**
 * Maximum land price across a grid of target yields.
 *
 * Workbook: `=IFERROR((($C$8/C$48)+($C$9/C$48)+($C$10/$B49)-$D$11+$E$18)/(1+$C$25),0)`
 *
 * Retail and office both take the commercial yield from the column header;
 * multifamily takes the row header. Cost ex-land and pad proceeds are held flat.
 */
export function sensitivityGrid(
  components: ComponentInputs,
  totalCostExLand: number,
  totalPadProceeds: number,
  assumptions: Assumptions,
): SensitivityGrid {
  const { commYocAxis, mfYocAxis } = assumptions.sensitivity;
  const carryRate = assumptions.land.carryRate;

  const cells = mfYocAxis.map((mfYoc) =>
    commYocAxis.map((commYoc) => {
      const supported =
        safeDiv(components.retail.noi, commYoc) +
        safeDiv(components.office.noi, commYoc) +
        safeDiv(components.multifamily.noi, mfYoc);
      return safeDiv(supported - totalCostExLand + totalPadProceeds, 1 + carryRate);
    }),
  );

  return { commYocAxis: [...commYocAxis], mfYocAxis: [...mfYocAxis], cells };
}

/** Run the whole First Look UW tab. */
export function firstLook(
  input: FirstLookInput,
  assumptions: Assumptions,
): FirstLookResult {
  const support = componentSupport(
    input.components,
    assumptions,
    input.yocOverrides,
  );

  const totalNoi = support.reduce((sum, row) => sum + row.noi, 0);
  const totalCostExLand = support.reduce((sum, row) => sum + row.costExLand, 0);
  const totalCostSupported = support.reduce(
    (sum, row) => sum + row.totalCostSupported,
    0,
  );
  const blendedYoc = safeDiv(totalNoi, totalCostSupported);

  const pads = padProceeds(input.pads, assumptions);

  const land = maxLandPrice(
    totalCostSupported,
    totalCostExLand,
    pads.total,
    assumptions,
  );

  // Workbook: headroom is suppressed entirely until an asking price is entered,
  // rather than showing the full max land price as headroom against zero.
  const askSet = input.askingPrice !== 0;
  const headroom = askSet ? land.maxLandPrice - input.askingPrice : 0;

  const tdcRates = landAtTdcRates(input.sanity, assumptions);
  const typeTest = productTypeTest(
    input.components.retail.noi,
    totalNoi,
    assumptions,
  );

  return {
    support,
    totalNoi,
    totalCostExLand,
    totalCostSupported,
    blendedYoc,

    padProceeds: pads,

    landValueBeforeCarry: land.landValueBeforeCarry,
    carryRate: land.carryRate,
    maxLandPrice: land.maxLandPrice,

    askingPrice: input.askingPrice,
    headroom,
    headroomPctOfAsk: safeDiv(headroom, input.askingPrice),
    maxLandPricePerAcre: safeDiv(land.maxLandPrice, input.acreage),
    landTest: askSet ? (land.maxLandPrice >= input.askingPrice ? "PASS" : "FAIL") : null,

    landAtTdcRates: tdcRates,
    maxLandPriceVsTdcRates: land.maxLandPrice - tdcRates,
    retailShareOfNoi: typeTest.retailShareOfNoi,
    productTypeTest: typeTest.suggested,

    sensitivity: sensitivityGrid(
      input.components,
      totalCostExLand,
      pads.total,
      assumptions,
    ),
  };
}
