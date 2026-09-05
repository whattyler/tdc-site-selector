"use client";

import { money } from "@/lib/format";
import type {
  PadParcel,
  PadSelection,
  PadSelections,
} from "@/lib/scoring";
import { cn } from "@/lib/utils";

import {
  DerivedField,
  FieldGrid,
  InputSection,
  NumberField,
  SubHead,
  TextField,
} from "./fields";

/**
 * First Look entry. Component NOI now derives from Revenue and cost ex-land
 * from Costs, so what is left to type is the land itself: the pads sold rather
 * than built, and the price being asked for the dirt.
 */
export type FirstLookFieldKey =
  | "hotelKeys"
  | "townhomeLots"
  | "outparcels"
  | "askingPrice"
  | "incentives"
  | "incentivesNote";

export type FirstLookFields = Record<FirstLookFieldKey, string>;

export const EMPTY_FIRST_LOOK: FirstLookFields = {
  hotelKeys: "",
  townhomeLots: "",
  outparcels: "",
  askingPrice: "",
  incentives: "",
  incentivesNote: "",
};

interface FirstLookInputsProps {
  values: FirstLookFields;
  /** Derived from Program, not typed. Spec B5 §4. */
  sanity: { retailSf: number; officeSf: number; multifamilyUnits: number };
  /** Derived from Revenue. Null where the component has no rent. Spec B5 §5. */
  noi: { retail: number | null; office: number | null; multifamily: number | null };
  onChange: (key: FirstLookFieldKey, value: string) => void;
  /** Convention rates that would throw if the quantity goes above zero. */
  placeholderPads: { hotel: boolean; townhome: boolean; outparcel: boolean };
  padSelections: PadSelections;
  onPadSelection: (parcel: PadParcel, patch: Partial<PadSelection>) => void;
}

/**
 * One pad line: how many, priced off which source, and why.
 *
 * Laid out like a cost line because it is one — a rate from a table, or a rate
 * this deal actually struck. The note only appears on Custom, since a
 * convention needs no explanation beyond its name.
 */
function PadRow({
  label,
  unit,
  parcel,
  quantity,
  onQuantity,
  selection,
  onSelection,
  conventionIsPlaceholder,
}: {
  label: string;
  unit: string;
  parcel: PadParcel;
  quantity: string;
  onQuantity: (value: string) => void;
  selection: PadSelection | undefined;
  onSelection: (parcel: PadParcel, patch: Partial<PadSelection>) => void;
  conventionIsPlaceholder: boolean;
}) {
  const source = selection?.source ?? "convention";
  const isCustom = source === "custom";

  return (
    <div className="col-span-full grid grid-cols-4 gap-x-6 gap-y-1 border-b border-line pb-3">
      <NumberField
        label={label}
        suffix={unit}
        value={quantity}
        onChange={onQuantity}
        hint={
          !isCustom && conventionIsPlaceholder
            ? `Convention rate is a placeholder — set it, or price this pad Custom`
            : undefined
        }
      />

      <label className="block">
        <span className="micro block leading-none">Source</span>
        <span className="mt-1 block">
          <select
            value={source}
            aria-label={`${label} rate source`}
            onChange={(event) =>
              onSelection(parcel, {
                source: event.target.value as PadSelection["source"],
              })
            }
            className="w-full cursor-pointer border-b border-line-strong bg-transparent px-0 py-1 text-ink focus:border-[var(--toro-red)] focus:outline-none"
          >
            <option value="convention">Convention</option>
            <option value="custom">Custom</option>
          </select>
        </span>
      </label>

      {isCustom ? (
        <>
          <NumberField
            label="Custom rate"
            prefix="$"
            suffix={`/${unit.replace(/s$/, "")}`}
            value={
              selection?.customRate === null || selection?.customRate === undefined
                ? ""
                : String(selection.customRate)
            }
            onChange={(value) => {
              const parsed = value.trim() === "" ? null : Number(value);
              onSelection(parcel, {
                customRate:
                  parsed !== null && Number.isFinite(parsed) ? parsed : null,
              });
            }}
          />
          <TextField
            label="What it is"
            value={selection?.note ?? ""}
            onChange={(value) => onSelection(parcel, { note: value })}
            placeholder="Contract or source"
          />
        </>
      ) : (
        <div className={cn("col-span-2")} />
      )}
    </div>
  );
}

export function FirstLookInputs({
  values,
  sanity,
  noi,
  onChange,
  placeholderPads,
  padSelections,
  onPadSelection,
}: FirstLookInputsProps) {
  const set = (key: FirstLookFieldKey) => (value: string) => onChange(key, value);

  return (
    <InputSection
      title="Gate 2 · First Look"
      note="NOI from Revenue, cost from Costs"
    >
      <FieldGrid columns={4}>
        <SubHead>
          Stabilized NOI, all phases combined. Built by the Revenue section above;
          cost ex-land is resolved by Costs.
        </SubHead>

        <DerivedField
          label="Retail NOI"
          from="Revenue"
          value={noi.retail}
          format={money}
        />
        <DerivedField
          label="Office NOI"
          from="Revenue"
          value={noi.office}
          format={money}
        />
        <DerivedField
          label="Multifamily NOI"
          from="Revenue"
          value={noi.multifamily}
          format={money}
        />
        <div />

        <SubHead>
          Parcels sold rather than built — Convention is the TDC rate,
          Custom is a contract
        </SubHead>

        <PadRow
          label="Hotel pad"
          unit="keys"
          parcel="hotel"
          quantity={values.hotelKeys}
          onQuantity={set("hotelKeys")}
          selection={padSelections.hotel}
          onSelection={onPadSelection}
          conventionIsPlaceholder={placeholderPads.hotel}
        />
        <PadRow
          label="Townhome pad"
          unit="lots"
          parcel="townhome"
          quantity={values.townhomeLots}
          onQuantity={set("townhomeLots")}
          selection={padSelections.townhome}
          onSelection={onPadSelection}
          conventionIsPlaceholder={placeholderPads.townhome}
        />
        <PadRow
          label="Other / outparcel"
          unit="parcels"
          parcel="outparcel"
          quantity={values.outparcels}
          onQuantity={set("outparcels")}
          selection={padSelections.outparcel}
          onSelection={onPadSelection}
          conventionIsPlaceholder={placeholderPads.outparcel}
        />

        <SubHead>
          Incentives and reimbursements — a credit against cost, before the
          residual
        </SubHead>

        <NumberField
          label="Incentives"
          prefix="$"
          value={values.incentives}
          onChange={set("incentives")}
          hint="TAD / CID reimbursements, bond proceeds, abatement NPV"
        />
        <TextField
          label="What it is"
          className="col-span-3"
          value={values.incentivesNote}
          onChange={set("incentivesNote")}
          placeholder="Source and basis — this number is deal-specific, not a library rate"
        />

        <SubHead>Against the asking price</SubHead>

        <NumberField
          label="Asking price / land basis"
          prefix="$"
          value={values.askingPrice}
          onChange={set("askingPrice")}
        />
        <div />
        <div />

        <SubHead>Sanity check — quantities at TDC land conventions</SubHead>

        <DerivedField label="Retail" suffix="SF" value={sanity.retailSf} />
        <DerivedField label="Office" suffix="SF" value={sanity.officeSf} />
        <DerivedField label="Multifamily" suffix="units" value={sanity.multifamilyUnits} />
        <div />
      </FieldGrid>
    </InputSection>
  );
}
