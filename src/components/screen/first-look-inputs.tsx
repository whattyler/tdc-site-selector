"use client";

import { money } from "@/lib/format";

import { DerivedField, FieldGrid, InputSection, NumberField, SubHead } from "./fields";

/**
 * First Look entry. Component NOI now derives from Revenue and cost ex-land
 * from Costs, so what is left to type is the land itself: the pads sold rather
 * than built, and the price being asked for the dirt.
 */
export type FirstLookFieldKey =
  | "hotelKeys"
  | "townhomeLots"
  | "outparcels"
  | "askingPrice";

export type FirstLookFields = Record<FirstLookFieldKey, string>;

export const EMPTY_FIRST_LOOK: FirstLookFields = {
  hotelKeys: "",
  townhomeLots: "",
  outparcels: "",
  askingPrice: "",
};

interface FirstLookInputsProps {
  values: FirstLookFields;
  /** Derived from Program, not typed. Spec B5 §4. */
  sanity: { retailSf: number; officeSf: number; multifamilyUnits: number };
  /** Derived from Revenue. Null where the component has no rent. Spec B5 §5. */
  noi: { retail: number | null; office: number | null; multifamily: number | null };
  onChange: (key: FirstLookFieldKey, value: string) => void;
  /** Placeholder pad rates that would throw if the quantity goes above zero. */
  placeholderPads: { townhome: boolean; outparcel: boolean };
}

export function FirstLookInputs({
  values,
  sanity,
  noi,
  onChange,
  placeholderPads,
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

        <SubHead>Parcels sold rather than built</SubHead>

        <NumberField
          label="Hotel pad"
          suffix="keys"
          value={values.hotelKeys}
          onChange={set("hotelKeys")}
        />
        <NumberField
          label="Townhome pad"
          suffix="lots"
          value={values.townhomeLots}
          onChange={set("townhomeLots")}
          hint={
            placeholderPads.townhome
              ? "Rate is a placeholder — set it before using lots"
              : undefined
          }
        />
        <NumberField
          label="Other / outparcel"
          suffix="parcels"
          value={values.outparcels}
          onChange={set("outparcels")}
          hint={
            placeholderPads.outparcel
              ? "Rate is a placeholder — set it before using parcels"
              : undefined
          }
        />
        <div />

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
