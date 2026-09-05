"use client";

import type { ProductTypeSetting } from "@/lib/scoring";

import { FieldGrid, InputSection, NumberField, SelectField, TextField } from "./fields";

export interface DealFields {
  name: string;
  submarket: string;
  productType: ProductTypeSetting;
  driveTimeMinutes: string;
  mu: string;
  mf: string;
}

export const EMPTY_DEAL: DealFields = {
  name: "",
  submarket: "",
  productType: "mixed_use",
  driveTimeMinutes: "",
  mu: "",
  mf: "",
};

interface DealInputsProps {
  values: DealFields;
  onChange: <K extends keyof DealFields>(key: K, value: DealFields[K]) => void;
  /** What the product type selects, for the hint under the score fields. */
  governing: "Mixed-Use" | "Multifamily" | "neither";
}

export function DealInputs({ values, onChange, governing }: DealInputsProps) {
  return (
    <InputSection
      title="Deal · Site · Demographics"
      note="Demographics typed by hand until Phase 4"
    >
      <FieldGrid columns={3}>
        <TextField
          label="Deal name"
          value={values.name}
          onChange={(value) => onChange("name", value)}
          placeholder="Medley"
        />
        <TextField
          label="Submarket"
          value={values.submarket}
          onChange={(value) => onChange("submarket", value)}
          placeholder="Johns Creek, GA"
        />
        <SelectField
          label="Product type"
          value={values.productType}
          onChange={(value) => onChange("productType", value)}
          options={[
            { value: "mixed_use", label: "Mixed-Use" },
            { value: "multifamily", label: "Multifamily" },
            { value: "auto", label: "Auto — not set" },
          ]}
          hint="Selects which dashboard score governs"
        />

        <NumberField
          label="Drive time from Alpharetta"
          suffix="min"
          value={values.driveTimeMinutes}
          onChange={(value) => onChange("driveTimeMinutes", value)}
          hint="Pre-fills Geography · Phase 3 computes it"
        />
        <NumberField
          label="Mixed-Use score"
          value={values.mu}
          onChange={(value) => onChange("mu", value)}
          hint={governing === "Mixed-Use" ? "Governing" : undefined}
        />
        <NumberField
          label="Multifamily score"
          value={values.mf}
          onChange={(value) => onChange("mf", value)}
          hint={governing === "Multifamily" ? "Governing" : undefined}
        />
      </FieldGrid>
    </InputSection>
  );
}
