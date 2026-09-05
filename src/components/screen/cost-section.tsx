"use client";

import { money } from "@/lib/format";
import {
  BASIS_LABEL,
  type CostResolution,
  type CostSelection,
  type CostSource,
  type ResolvedCostLine,
  isPercentageBasis,
} from "@/lib/scoring";
import { cn } from "@/lib/utils";

import { InputSection } from "./fields";

/** The multiplier ladder from spec B5 §4. */
const MULTIPLIERS = [0.9, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075, 1.1];

const SOURCE_LABEL: Record<CostSource, string> = {
  medley: "Medley",
  ccc: "CCC",
  custom: "Custom",
};

const CATEGORY_LABEL = {
  hard: "Hard costs",
  soft: "Soft costs",
  other: "Financing and carry",
} as const;

/**
 * A percentage line shows its rate as a percentage and its quantity as the
 * subtotal it applied to; everything else shows dollars against a count.
 */
function rateText(line: ResolvedCostLine): string {
  if (line.resolvedRate === null) return "—";
  return isPercentageBasis(line.basis)
    ? `${(line.resolvedRate * 100).toFixed(2)}%`
    : money(line.resolvedRate);
}

function quantityText(line: ResolvedCostLine): string {
  if (line.quantity === 0) return "—";
  return isPercentageBasis(line.basis)
    ? money(line.quantity)
    : line.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface CostSectionProps {
  resolution: CostResolution | null;
  error: string | null;
  loading: boolean;
  libraryOrigin: string | null;
  selections: Record<string, CostSelection>;
  globalMultiplier: number;
  onSelection: (lineKey: string, patch: Partial<CostSelection>) => void;
  onGlobalMultiplier: (value: number) => void;
}

export function CostSection({
  resolution,
  error,
  loading,
  libraryOrigin,
  selections,
  globalMultiplier,
  onSelection,
  onGlobalMultiplier,
}: CostSectionProps) {
  const escalation = resolution?.escalation;

  const note = loading
    ? "Resolving…"
    : escalation
      ? `Escalation ${(escalation.annual * 100).toFixed(1)}%/yr` +
        (escalation.isPlaceholder ? " · PLACEHOLDER, not set" : "")
      : (libraryOrigin ?? "");

  const groups = (["hard", "soft", "other"] as const).map((category) => ({
    category,
    lines: (resolution?.lines ?? []).filter((line) => line.category === category),
  }));

  return (
    <InputSection title="Costs" note={note}>
      {escalation?.isPlaceholder && (
        <p className="mb-3 border-l-[3px] border-l-maybe bg-maybe-fill/10 py-1 pl-3 text-sm text-maybe">
          Cost escalation is a placeholder at {(escalation.annual * 100).toFixed(1)}%.
          Every rate below is escalated from its as-of date at that guess. Set
          <code className="mx-1 text-ink">cost.escalation.annual</code>
          in assumptions before anyone quotes these numbers.
        </p>
      )}

      {error && (
        <p className="mb-3 border-l-[3px] border-l-maybe py-1 pl-3 text-sm text-maybe">
          {error}
        </p>
      )}

      {!resolution && !error && !loading && (
        <p className="caption">Fill the program above to resolve the cost stack.</p>
      )}

      {resolution && (
        <>
          <div className="mb-4 flex items-center gap-4 border-b border-line pb-3">
            <span className="micro shrink-0">Global multiplier</span>
            <select
              value={globalMultiplier}
              onChange={(event) => onGlobalMultiplier(Number(event.target.value))}
              className="num border-b border-line-strong bg-transparent px-0 py-1 text-ink focus:border-[var(--toro-red)] focus:outline-none"
            >
              {MULTIPLIERS.map((value) => (
                <option key={value} value={value}>
                  {value.toFixed(3)}
                </option>
              ))}
            </select>
            <span className="caption">Applied on top of every line multiplier</span>
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong">
                <th className="micro py-2 pr-3 text-left">Line</th>
                <th className="micro w-[190px] py-2 pr-3 text-left">Source</th>
                <th className="micro w-24 py-2 pr-3 text-left">Mult</th>
                <th className="micro w-28 py-2 pr-3 text-right">Rate</th>
                <th className="micro w-28 py-2 pr-3 text-right">Qty</th>
                <th className="micro w-32 py-2 pr-1 text-right">Amount</th>
              </tr>
            </thead>

            {groups.map(({ category, lines }) => {
              const subtotal = resolution.totals[category];
              if (lines.length === 0) return null;
              return (
                <tbody key={category}>
                  <tr className="bg-surface-2" style={{ height: "var(--row-h-bucket)" }}>
                    <td className="bucket-head pr-3" colSpan={5}>
                      {CATEGORY_LABEL[category]}
                    </td>
                    <td className="num pr-1">{money(subtotal)}</td>
                  </tr>

                  {lines.map((line) => {
                    const selection = selections[line.lineKey];
                    const source = selection?.source ?? line.source;
                    const multiplier = selection?.multiplier ?? line.multiplier;
                    const unpriced = line.resolvedRate === null;

                    return (
                      <tr
                        key={line.lineKey}
                        className={cn(
                          "border-b border-line hover:bg-surface-3",
                          unpriced && "opacity-60",
                        )}
                        style={{ height: "var(--row-h)" }}
                      >
                        {/* Never wraps: the scope detail lives in the title,
                            which is why the label is a plain name. */}
                        <td
                          className="whitespace-nowrap py-1 pr-3 text-ink"
                          title={line.notes ?? undefined}
                        >
                          {line.label}
                          <span className="caption ml-2">
                            {BASIS_LABEL[line.basis]}
                            {line.escalationYears > 0 &&
                              ` · +${line.escalationYears.toFixed(1)}y`}
                          </span>
                        </td>

                        <td className="pr-3">
                          {/* Only sources that actually carry a rate. */}
                          <select
                            value={source}
                            aria-label={`${line.label} source`}
                            onChange={(event) =>
                              onSelection(line.lineKey, {
                                source: event.target.value as CostSource,
                              })
                            }
                            className="w-full border-b border-line-strong bg-transparent py-0.5 text-sm text-ink focus:border-[var(--toro-red)] focus:outline-none"
                          >
                            {line.availableSources.map((value) => (
                              <option key={value} value={value}>
                                {SOURCE_LABEL[value]}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="pr-3">
                          <select
                            value={multiplier}
                            aria-label={`${line.label} multiplier`}
                            onChange={(event) =>
                              onSelection(line.lineKey, {
                                multiplier: Number(event.target.value),
                              })
                            }
                            className="num w-full border-b border-line-strong bg-transparent py-0.5 text-sm text-ink focus:border-[var(--toro-red)] focus:outline-none"
                          >
                            {MULTIPLIERS.map((value) => (
                              <option key={value} value={value}>
                                {value.toFixed(3)}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className={cn("num pr-3 text-sm", unpriced && "text-ink-3")}>
                          {source === "custom" ? (
                            // Typed in today's dollars, so it is not escalated.
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`${line.label} custom rate`}
                              value={selection?.customRate ?? ""}
                              placeholder="rate"
                              onChange={(event) => {
                                const raw = event.target.value.replace(/[$,\s]/g, "");
                                const parsed = raw === "" ? null : Number(raw);
                                onSelection(line.lineKey, {
                                  customRate:
                                    parsed !== null && Number.isFinite(parsed)
                                      ? parsed
                                      : null,
                                });
                              }}
                              className="num w-full border-b border-line-strong bg-transparent py-0.5 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--toro-red)] focus:outline-none"
                            />
                          ) : (
                            rateText(line)
                          )}
                        </td>
                        <td className="num pr-3 text-sm font-normal text-ink-3">
                          {quantityText(line)}
                        </td>
                        <td className={cn("num pr-1", unpriced && "text-ink-3")}>
                          {line.resolvedAmount === 0 && unpriced
                            ? "—"
                            : money(line.resolvedAmount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}

            <tfoot>
              <tr className="border-t-2 border-t-line-strong bg-surface-2">
                <td className="micro py-2.5 pr-3" colSpan={5}>
                  Cost excluding land
                </td>
                <td className="num py-2.5 pr-1 text-[1.0625rem] font-[650]">
                  {money(resolution.totals.costExLand)}
                </td>
              </tr>
            </tfoot>
          </table>

          <p className="caption mt-2">
            Feeds Gate 2 as cost ex-land, split across components by program share.
            Rates shown are escalated to today and multiplied; the library rates
            behind them stay on the server.
          </p>
        </>
      )}
    </InputSection>
  );
}
