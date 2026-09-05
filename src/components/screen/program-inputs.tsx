"use client";

import { parseNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { FieldGrid, InputSection, NumberField, SelectField, SubHead } from "./fields";

/** Spec B5 §3. Acreage lives in the Deal section; it is a site attribute. */
export type ProgramFieldKey =
  | "resiUnits"
  | "avgNsf"
  | "resiNrsf"
  | "resiGsf"
  | "retailSf"
  | "officeSf"
  | "parkingSpaces"
  | "stories";

export type ProgramFields = Record<ProgramFieldKey, string> & {
  parkingType: ParkingType;
  constructionType: ConstructionType;
};

export type ParkingType = "structured" | "surface" | "mixed";
export type ConstructionType =
  | "garden"
  | "wrap"
  | "podium"
  | "mid_rise"
  | "high_rise";

export const EMPTY_PROGRAM: ProgramFields = {
  resiUnits: "",
  avgNsf: "",
  resiNrsf: "",
  resiGsf: "",
  retailSf: "",
  officeSf: "",
  parkingSpaces: "",
  stories: "",
  parkingType: "structured",
  constructionType: "podium",
};

/**
 * Medley Phase I, from the PF11 budget the cost library was built off. Gives
 * the Costs section something real to resolve against on first load.
 */
export const MEDLEY_PROGRAM: ProgramFields = {
  resiUnits: "340",
  avgNsf: "950",
  resiNrsf: "323000",
  resiGsf: "395000",
  retailSf: "147286",
  officeSf: "112011",
  parkingSpaces: "586",
  stories: "5",
  parkingType: "structured",
  constructionType: "podium",
};

/** A cross-check that failed, with what it expected. Spec B5 §3. */
interface Check {
  ok: boolean;
  label: string;
  detail: string;
}

/**
 * Inline cross-checks: units x NSF ≈ NRSF, efficiency 0.78–0.86, parking ratio,
 * FAR against acreage. Each is a warning, never a block — a real deal breaks
 * one of these for a reason often enough.
 */
export function programChecks(values: ProgramFields, acreage: number | null): Check[] {
  const units = parseNumber(values.resiUnits);
  const avgNsf = parseNumber(values.avgNsf);
  const nrsf = parseNumber(values.resiNrsf);
  const gsf = parseNumber(values.resiGsf);
  const retail = parseNumber(values.retailSf) ?? 0;
  const office = parseNumber(values.officeSf) ?? 0;
  const spaces = parseNumber(values.parkingSpaces);

  const checks: Check[] = [];

  if (units && avgNsf && nrsf) {
    const implied = units * avgNsf;
    const drift = Math.abs(implied - nrsf) / nrsf;
    checks.push({
      ok: drift <= 0.05,
      label: "Units × NSF ≈ NRSF",
      detail: `${implied.toLocaleString()} vs ${nrsf.toLocaleString()} · ${(drift * 100).toFixed(1)}% off`,
    });
  }

  if (nrsf && gsf) {
    const efficiency = nrsf / gsf;
    checks.push({
      ok: efficiency >= 0.78 && efficiency <= 0.86,
      label: "Efficiency 0.78–0.86",
      detail: efficiency.toFixed(3),
    });
  }

  if (units && spaces) {
    const ratio = spaces / units;
    checks.push({
      ok: ratio >= 1 && ratio <= 2.2,
      label: "Parking ratio 1.0–2.2 / unit",
      detail: `${ratio.toFixed(2)} per unit`,
    });
  }

  if (acreage && acreage > 0 && (gsf || retail || office)) {
    const far = ((gsf ?? 0) + retail + office) / (acreage * 43_560);
    checks.push({
      ok: far > 0 && far <= 3,
      label: "FAR vs acreage",
      detail: `${far.toFixed(2)} on ${acreage} ac`,
    });
  }

  return checks;
}

interface ProgramInputsProps {
  values: ProgramFields;
  onChange: <K extends keyof ProgramFields>(key: K, value: ProgramFields[K]) => void;
  acreage: number | null;
}

export function ProgramInputs({ values, onChange, acreage }: ProgramInputsProps) {
  const set = (key: ProgramFieldKey) => (value: string) => onChange(key, value);
  const checks = programChecks(values, acreage);
  const failing = checks.filter((check) => !check.ok);

  return (
    <InputSection
      title="Program"
      note={
        failing.length === 0
          ? `${checks.length} cross-check${checks.length === 1 ? "" : "s"} passing`
          : `${failing.length} cross-check${failing.length === 1 ? "" : "s"} to look at`
      }
    >
      <FieldGrid columns={4}>
        <SubHead>Residential</SubHead>
        <NumberField label="Units" value={values.resiUnits} onChange={set("resiUnits")} />
        <NumberField label="Avg NSF" suffix="SF" value={values.avgNsf} onChange={set("avgNsf")} />
        <NumberField label="Resi NRSF" suffix="SF" value={values.resiNrsf} onChange={set("resiNrsf")} />
        <NumberField label="Resi GSF" suffix="SF" value={values.resiGsf} onChange={set("resiGsf")} />

        <SubHead>Commercial</SubHead>
        <NumberField label="Retail" suffix="SF" value={values.retailSf} onChange={set("retailSf")} />
        <NumberField label="Office" suffix="SF" value={values.officeSf} onChange={set("officeSf")} />
        <div />
        <div />

        <SubHead>Parking and structure</SubHead>
        <NumberField
          label="Parking spaces"
          value={values.parkingSpaces}
          onChange={set("parkingSpaces")}
        />
        <SelectField
          label="Parking type"
          value={values.parkingType}
          onChange={(value) => onChange("parkingType", value)}
          options={[
            { value: "structured", label: "Structured" },
            { value: "surface", label: "Surface" },
            { value: "mixed", label: "Mixed" },
          ]}
        />
        <NumberField label="Stories" value={values.stories} onChange={set("stories")} />
        <SelectField
          label="Construction type"
          value={values.constructionType}
          onChange={(value) => onChange("constructionType", value)}
          options={[
            { value: "garden", label: "Garden" },
            { value: "wrap", label: "Wrap" },
            { value: "podium", label: "Podium" },
            { value: "mid_rise", label: "Mid-rise" },
            { value: "high_rise", label: "High-rise" },
          ]}
        />
      </FieldGrid>

      {checks.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="micro mb-1.5">Cross-checks</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {checks.map((check) => (
              <span
                key={check.label}
                className={cn("text-sm", check.ok ? "text-ink-3" : "text-maybe")}
              >
                {check.ok ? "✓" : "⚠"} {check.label}
                <span className="ml-1.5 text-ink-3">{check.detail}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </InputSection>
  );
}
