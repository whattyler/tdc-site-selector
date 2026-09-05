"use client";

import type { Comp } from "@/app/api/comps/route";
import type { RentDraft, RentDraftField } from "@/app/api/rent-draft/route";
import { money, percent } from "@/lib/format";
import type { RevenueResult } from "@/lib/scoring";
import { cn } from "@/lib/utils";

import { FieldGrid, InputSection, NumberField, SubHead } from "./fields";

/**
 * Revenue and comps. Spec B5 §5.
 *
 * Rents are typed. Nothing here defaults to zero: a blank rent means nobody has
 * priced that component, and the NOI below shows an em-dash rather than a
 * number, which is what Gate 2 then refuses to run on.
 */

export type RentFieldKey =
  | "resiRentPsfMo"
  | "resiVacancy"
  | "opexPerUnit"
  | "retailRentPsf"
  | "retailVacancy"
  | "retailNonRecovPsf"
  | "officeRentPsf"
  | "officeVacancy"
  | "officeNonRecovPsf";

export type RentFields = Record<RentFieldKey, string>;

/**
 * No assumption rows exist for rents yet, so every field opens blank. Once
 * `revenue.rent.*` rows land in docs/assumptions.csv this becomes a function of
 * the assumptions object; until then a seeded number would be a fiction.
 */
export const EMPTY_RENTS: RentFields = {
  resiRentPsfMo: "",
  resiVacancy: "",
  opexPerUnit: "",
  retailRentPsf: "",
  retailVacancy: "",
  retailNonRecovPsf: "",
  officeRentPsf: "",
  officeVacancy: "",
  officeNonRecovPsf: "",
};

/** Which typed field each AI draft lands in when it is confirmed. */
export const DRAFT_TARGET: Record<RentDraftField, RentFieldKey> = {
  resiRentPsfMo: "resiRentPsfMo",
  retailRentPsf: "retailRentPsf",
  officeRentPsf: "officeRentPsf",
};

export type RentSource = "manual" | "ai_confirmed";

// ── Comps ─────────────────────────────────────────────────────────────────

/**
 * Whether a comp counts as included.
 *
 * An absent entry means nobody has touched the row, so the default stands:
 * everything is ticked except the low-signal rows, which have to be opted into
 * deliberately. Exported because the page and the map read the same rule.
 */
export function compIncluded(
  comp: Comp,
  included: Record<string, boolean>,
): boolean {
  return included[comp.placeId] ?? !comp.lowSignal;
}

const COMP_TYPE_LABEL: Record<Comp["type"], string> = {
  apartment: "Apartment",
  retail: "Retail",
};

interface CompsSectionProps {
  comps: Comp[] | null;
  error: string | null;
  loading: boolean;
  radiusMi: number;
  included: Record<string, boolean>;
  onToggle: (placeId: string, next: boolean) => void;
  onToggleAll: (next: boolean) => void;
  onRefresh: () => void;
  /** False until there is a geocoded point to search around. */
  canRefresh: boolean;
}

export function CompsSection({
  comps,
  error,
  loading,
  radiusMi,
  included,
  onToggle,
  onToggleAll,
  onRefresh,
  canRefresh,
}: CompsSectionProps) {
  const includedCount = (comps ?? []).filter((comp) =>
    compIncluded(comp, included),
  ).length;
  const allIncluded = comps !== null && comps.length > 0 && includedCount === comps.length;

  const note = loading
    ? "Searching…"
    : comps
      ? `${comps.length} within ${radiusMi} mi · ${includedCount} included`
      : "";

  return (
    <InputSection title="Comps" note={note}>
      <div className="mb-3 flex items-baseline gap-4 border-b border-line pb-3">
        <button
          type="button"
          onClick={onRefresh}
          disabled={!canRefresh || loading}
          className={cn(
            "micro leading-none",
            canRefresh && !loading
              ? "text-ink underline underline-offset-4 hover:text-[var(--toro-red)]"
              : "text-ink-3",
          )}
        >
          {loading ? "Searching…" : "Search nearby"}
        </button>
        <span className="caption">
          Apartment complexes and retail centres from Google Places, ranked by
          distance. Included comps are what the rent draft below reads.
        </span>
      </div>

      {error && (
        <p className="mb-3 border-l-[3px] border-l-maybe py-1 pl-3 text-sm text-maybe">
          {error}
        </p>
      )}

      {!comps && !error && !loading && (
        <p className="caption">Geocode an address to pull comps.</p>
      )}

      {comps && comps.length === 0 && (
        <p className="caption">Places found nothing of either type inside {radiusMi} mi.</p>
      )}

      {comps && comps.length > 0 && (
        <>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong">
                <th className="w-8 py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={allIncluded}
                    aria-label="Include every comp"
                    onChange={(event) => onToggleAll(event.target.checked)}
                    className="accent-[var(--toro-red)]"
                  />
                </th>
                <th className="micro py-2 pr-3 text-left">Comp</th>
                <th className="micro w-28 py-2 pr-3 text-left">Type</th>
                <th className="micro w-24 py-2 pr-3 text-right">Distance</th>
                <th className="micro w-24 py-2 pr-3 text-right">Year built</th>
                <th className="micro w-24 py-2 pr-1 text-right">Rating</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((comp) => {
                const isIncluded = compIncluded(comp, included);
                return (
                  <tr
                    key={comp.placeId}
                    className={cn(
                      "border-b border-line hover:bg-surface-3",
                      !isIncluded && "opacity-55",
                    )}
                    style={{ height: "var(--row-h)" }}
                  >
                    <td className="pr-2">
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        aria-label={`Include ${comp.name}`}
                        onChange={(event) => onToggle(comp.placeId, event.target.checked)}
                        className="accent-[var(--toro-red)]"
                      />
                    </td>
                    <td
                      className="whitespace-nowrap py-1 pr-3 text-ink"
                      title={comp.address ?? undefined}
                    >
                      {comp.name}
                      {comp.lowSignal && (
                        <span
                          className="caption ml-2"
                          title="Fewer than 5 ratings. Places files single houses under apartment_complex, but a building too new to have collected reviews looks the same."
                        >
                          low signal
                        </span>
                      )}
                    </td>
                    <td className="pr-3 text-sm text-ink-2">
                      {COMP_TYPE_LABEL[comp.type]}
                    </td>
                    <td className="num pr-3 text-sm">{comp.distanceMi.toFixed(2)} mi</td>
                    <td className="num pr-3 text-sm text-ink-3">
                      {comp.yearBuilt ?? "—"}
                    </td>
                    <td className="num pr-1 text-sm text-ink-2">
                      {comp.rating === null
                        ? "—"
                        : `${comp.rating.toFixed(1)}${
                            comp.userRatingCount ? ` (${comp.userRatingCount})` : ""
                          }`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="caption mt-2">
            <span className="text-ink-2">Low signal</span> means fewer than 5
            ratings, and starts unticked. Places files single houses under{" "}
            <code>apartment_complex</code> where a real complex carries hundreds
            of reviews — but so does a building too new to have collected any, so
            the row stays on the list for you to judge. Google Places carries no
            construction year, so that column stays empty until Regrid parcel data
            arrives in Phase 3b. Distance is straight-line from the geocoded point.
          </p>
        </>
      )}
    </InputSection>
  );
}

// ── Revenue ───────────────────────────────────────────────────────────────

/**
 * A rent field with any AI draft for it hanging underneath. The draft is inert
 * until Use is pressed — that is the whole `ai_draft` rule made visible.
 */
function RentField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  draft,
  source,
  onConfirm,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  draft?: RentDraft;
  source?: RentSource;
  onConfirm?: (draft: RentDraft) => void;
}) {
  const applied =
    draft !== undefined &&
    source === "ai_confirmed" &&
    value !== "" &&
    Number(value) === draft.value;

  return (
    <div>
      <NumberField
        label={label}
        value={value}
        onChange={onChange}
        prefix={prefix}
        suffix={suffix}
      />

      {draft && (
        <div className="mt-1.5 border-l-[3px] border-l-maybe pl-2">
          <div className="flex items-baseline gap-2">
            <span className="num text-sm text-maybe">
              {prefix}
              {draft.value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            {applied ? (
              <span className="micro leading-none text-ink-2">confirmed</span>
            ) : (
              <button
                type="button"
                onClick={() => onConfirm?.(draft)}
                className="micro leading-none text-ink underline underline-offset-4 hover:text-[var(--toro-red)]"
              >
                Use
              </button>
            )}
            <span className="micro leading-none text-ink-3">
              ai_draft · {draft.confidence}
            </span>
          </div>
          {draft.basis && <p className="caption mt-0.5">{draft.basis}</p>}
          <p className="caption mt-0.5 flex flex-wrap gap-x-2">
            {draft.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-ink"
                title={source.url}
              >
                {source.label} ↗
              </a>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

interface RevenueSectionProps {
  values: RentFields;
  sources: Partial<Record<RentFieldKey, RentSource>>;
  onChange: (key: RentFieldKey, value: string) => void;
  /** Quantities come from Program, never typed a second time. */
  program: { resiUnits: number; avgNsf: number; retailSf: number; officeSf: number };
  revenue: RevenueResult;
  drafts: RentDraft[] | null;
  draftNotes: string | null;
  draftError: string | null;
  draftLoading: boolean;
  draftModel: string | null;
  includedCompCount: number;
  onDraft: () => void;
  onConfirmDraft: (draft: RentDraft) => void;
}

const NOI_ROWS = [
  { key: "retail", label: "Retail" },
  { key: "office", label: "Office" },
  { key: "multifamily", label: "Multifamily" },
] as const;

export function RevenueSection({
  values,
  sources,
  onChange,
  program,
  revenue,
  drafts,
  draftNotes,
  draftError,
  draftLoading,
  draftModel,
  includedCompCount,
  onDraft,
  onConfirmDraft,
}: RevenueSectionProps) {
  const set = (key: RentFieldKey) => (value: string) => onChange(key, value);
  const draftFor = (field: RentDraftField) =>
    drafts?.find((draft) => draft.field === field);

  const qty = (value: number) => (value === 0 ? "—" : value.toLocaleString());

  return (
    <InputSection
      title="Revenue"
      note={
        revenue.totalNoi === null
          ? "No component priced"
          : `Total NOI ${money(revenue.totalNoi)}`
      }
    >
      <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-3">
        <button
          type="button"
          onClick={onDraft}
          disabled={draftLoading || includedCompCount === 0}
          className={cn(
            "micro leading-none",
            !draftLoading && includedCompCount > 0
              ? "text-ink underline underline-offset-4 hover:text-[var(--toro-red)]"
              : "text-ink-3",
          )}
        >
          {draftLoading
            ? "Searching the web…"
            : `Draft asking rents from ${includedCompCount} comp${
                includedCompCount === 1 ? "" : "s"
              }`}
        </button>
        <span className="caption">
          Claude searches for each comp&rsquo;s advertised rent and drafts a
          number with its source. Drafts stay out of the NOI until you press Use.
          {draftModel ? ` Last run: ${draftModel}.` : ""}
        </span>
      </div>

      {draftError && (
        <p className="mb-3 border-l-[3px] border-l-maybe py-1 pl-3 text-sm text-maybe">
          {draftError}
        </p>
      )}
      {draftNotes && <p className="caption mb-3">{draftNotes}</p>}
      {drafts !== null && drafts.length === 0 && !draftError && (
        <p className="caption mb-3">
          The search came back without a traceable asking rent for any component.
          Nothing was drafted.
        </p>
      )}

      <FieldGrid columns={4}>
        <SubHead>
          Residential · {qty(program.resiUnits)} units × {qty(program.avgNsf)} NSF
          from Program
        </SubHead>
        <RentField
          label="Rent"
          prefix="$"
          suffix="/SF/mo"
          value={values.resiRentPsfMo}
          onChange={set("resiRentPsfMo")}
          draft={draftFor("resiRentPsfMo")}
          source={sources.resiRentPsfMo}
          onConfirm={onConfirmDraft}
        />
        <NumberField
          label="Vacancy"
          suffix="%"
          value={values.resiVacancy}
          onChange={set("resiVacancy")}
        />
        <NumberField
          label="Opex"
          prefix="$"
          suffix="/unit/yr"
          value={values.opexPerUnit}
          onChange={set("opexPerUnit")}
        />
        <div />

        <SubHead>Retail · {qty(program.retailSf)} SF from Program, NNN</SubHead>
        <RentField
          label="NNN rent"
          prefix="$"
          suffix="/SF/yr"
          value={values.retailRentPsf}
          onChange={set("retailRentPsf")}
          draft={draftFor("retailRentPsf")}
          source={sources.retailRentPsf}
          onConfirm={onConfirmDraft}
        />
        <NumberField
          label="Vacancy"
          suffix="%"
          value={values.retailVacancy}
          onChange={set("retailVacancy")}
        />
        <NumberField
          label="Non-recoverable"
          prefix="$"
          suffix="/SF/yr"
          value={values.retailNonRecovPsf}
          onChange={set("retailNonRecovPsf")}
        />
        <div />

        <SubHead>Office · {qty(program.officeSf)} SF from Program</SubHead>
        <RentField
          label="Rent"
          prefix="$"
          suffix="/SF/yr"
          value={values.officeRentPsf}
          onChange={set("officeRentPsf")}
          draft={draftFor("officeRentPsf")}
          source={sources.officeRentPsf}
          onConfirm={onConfirmDraft}
        />
        <NumberField
          label="Vacancy"
          suffix="%"
          value={values.officeVacancy}
          onChange={set("officeVacancy")}
        />
        <NumberField
          label="Non-recoverable"
          prefix="$"
          suffix="/SF/yr"
          value={values.officeNonRecovPsf}
          onChange={set("officeNonRecovPsf")}
        />
        <div />
      </FieldGrid>

      <table className="mt-6 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line-strong">
            <th className="micro py-2 pr-3 text-left">Stabilized NOI</th>
            <th className="micro w-36 py-2 pr-3 text-right">Gross rent</th>
            <th className="micro w-36 py-2 pr-3 text-right">Less vacancy</th>
            <th className="micro w-36 py-2 pr-3 text-right">Operating cost</th>
            <th className="micro w-36 py-2 pr-1 text-right">NOI</th>
          </tr>
        </thead>
        <tbody>
          {NOI_ROWS.map(({ key, label }) => {
            const line = revenue[key];
            const unpriced = line.noi === null;
            return (
              <tr
                key={key}
                className={cn(
                  "border-b border-line hover:bg-surface-3",
                  unpriced && "opacity-60",
                )}
                style={{ height: "var(--row-h)" }}
              >
                <td className="py-1 pr-3 text-ink">
                  {label}
                  {unpriced && <span className="caption ml-2">not priced</span>}
                </td>
                <td className="num pr-3 text-sm text-ink-2">
                  {line.grossRent === null ? "—" : money(line.grossRent)}
                </td>
                <td className="num pr-3 text-sm text-ink-2">
                  {line.grossRent === null || line.effectiveRent === null
                    ? "—"
                    : money(line.effectiveRent - line.grossRent)}
                </td>
                <td className="num pr-3 text-sm text-ink-2">
                  {line.operatingCost === null ? "—" : money(-line.operatingCost)}
                </td>
                <td className={cn("num pr-1", unpriced && "text-ink-3")}>
                  {line.noi === null ? "—" : money(line.noi)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-t-line-strong bg-surface-2">
            <td className="micro py-2.5 pr-3" colSpan={4}>
              Total NOI
              {revenue.retailShareOfNoi !== null && (
                <span className="caption ml-2">
                  retail {percent(revenue.retailShareOfNoi, 1)} of NOI
                </span>
              )}
            </td>
            <td className="num py-2.5 pr-1 text-[1.0625rem] font-[650]">
              {revenue.totalNoi === null ? "—" : money(revenue.totalNoi)}
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="caption mt-2">
        Feeds Gate 2 as component NOI. A component with no rent stays null rather
        than zero, so Gate 2 does not underwrite something nobody has priced.
      </p>
    </InputSection>
  );
}
