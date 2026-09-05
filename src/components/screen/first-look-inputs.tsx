"use client";

import { FieldGrid, InputSection, NumberField, SubHead } from "./fields";

/**
 * Manual First Look entry for Phase 2. Phases 3–7 replace the component NOI
 * and cost fields with the program, cost library and comps that build them.
 * The land basis, acreage and sanity quantities stay typed either way.
 */
export type FirstLookFieldKey =
  | "retailNoi"
  | "officeNoi"
  | "mfNoi"
  | "hotelKeys"
  | "townhomeLots"
  | "outparcels"
  | "askingPrice"
  | "sanityRetailSf"
  | "sanityOfficeSf"
  | "sanityMfUnits";

export type FirstLookFields = Record<FirstLookFieldKey, string>;

export const EMPTY_FIRST_LOOK: FirstLookFields = {
  retailNoi: "",
  officeNoi: "",
  mfNoi: "",
  hotelKeys: "",
  townhomeLots: "",
  outparcels: "",
  askingPrice: "",
  sanityRetailSf: "",
  sanityOfficeSf: "",
  sanityMfUnits: "",
};

interface FirstLookInputsProps {
  values: FirstLookFields;
  onChange: (key: FirstLookFieldKey, value: string) => void;
  /** Placeholder pad rates that would throw if the quantity goes above zero. */
  placeholderPads: { townhome: boolean; outparcel: boolean };
}

export function FirstLookInputs({
  values,
  onChange,
  placeholderPads,
}: FirstLookInputsProps) {
  const set = (key: FirstLookFieldKey) => (value: string) => onChange(key, value);

  return (
    <InputSection
      title="Gate 2 · First Look"
      note="Typed for now — Phases 3–7 build these"
    >
      <FieldGrid columns={4}>
        <SubHead>
          Stabilized NOI, all phases combined. Cost ex-land is resolved by the Costs section above.
        </SubHead>

        <NumberField
          label="Retail NOI"
          prefix="$"
          value={values.retailNoi}
          onChange={set("retailNoi")}
        />
        <NumberField
          label="Office NOI"
          prefix="$"
          value={values.officeNoi}
          onChange={set("officeNoi")}
        />
        <NumberField
          label="Multifamily NOI"
          prefix="$"
          value={values.mfNoi}
          onChange={set("mfNoi")}
        />

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

        <NumberField
          label="Retail"
          suffix="SF"
          value={values.sanityRetailSf}
          onChange={set("sanityRetailSf")}
        />
        <NumberField
          label="Office"
          suffix="SF"
          value={values.sanityOfficeSf}
          onChange={set("sanityOfficeSf")}
        />
        <NumberField
          label="Multifamily"
          suffix="units"
          value={values.sanityMfUnits}
          onChange={set("sanityMfUnits")}
          hint="Also drives $/unit in the panel"
        />
        <div />
      </FieldGrid>
    </InputSection>
  );
}
