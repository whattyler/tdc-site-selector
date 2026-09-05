"use client";

import {
  bps,
  compact,
  money,
  percent,
  percent0,
  score as fmtScore,
} from "@/lib/format";
import type {
  CombinedVerdict,
  DemographicsResult,
  FirstLookResult,
  Gate2Result,
  ScoredMetric,
  ScreenResult,
} from "@/lib/scoring";
import { cn } from "@/lib/utils";

/**
 * Land test as the panel says it. Spec B0 wants CLEAR / SHORT; the engine and
 * the workbook speak PASS / FAIL. The mapping lives here, at the display layer,
 * and nowhere else.
 */
function landTestLabel(result: Gate2Result): string {
  if (result === "PASS") return "CLEAR";
  if (result === "FAIL") return "SHORT";
  if (result === "NOT RUN") return "NOT RUN";
  return "—";
}

/** Which semantic colour a combined verdict takes. */
function verdictTone(verdict: CombinedVerdict): "go" | "maybe" | "nogo" {
  switch (verdict) {
    case "DOUBLE GO":
      return "go";
    case "WATCH":
    case "INCOMPLETE":
    // A Gate 1 GO the land cannot pay for is not actionable and is not a
    // NO-GO. Amber, not red — brand red belongs to a GO you can act on.
    case "GO — LAND FAIL":
      return "maybe";
    case "NO-GO":
    case "NOT SCORED":
      return "nogo";
  }
}

/**
 * The amber fill is the one light surface on the page, so it takes near-black
 * text; the other two are darker than the panel and take white.
 */
const VERDICT_FILL: Record<"go" | "maybe" | "nogo", string> = {
  go: "bg-go text-white",
  maybe: "bg-maybe-fill text-ink-inverse",
  nogo: "bg-verdict-dark text-white",
};

interface VerdictPanelProps {
  screen: ScreenResult;
  demographics: DemographicsResult;
  firstLook: FirstLookResult | null;
  gate2: Gate2Result;
  combined: CombinedVerdict;
  gate2Error: string | null;
  mu: number | null;
  mf: number | null;
  resiUnits: number | null;
  /** The nine metrics behind the pull, when there has been one. */
  demographicMetrics: ScoredMetric[] | null;
  /** Opens the sensitivity drawer. Undefined until there is a First Look to vary. */
  onSensitivity?: () => void;
  /** Undefined when there is no database to save to. */
  onSave?: () => void;
  saving?: boolean;
  saveError?: string | null;
  savedAt?: string | null;
  saveLabel?: string;
  /** Null until the deal has an id — a PDF needs something to read back. */
  pdfHref?: string | null;
}

export function VerdictPanel({
  screen,
  demographics,
  firstLook,
  gate2,
  combined,
  gate2Error,
  mu,
  mf,
  resiUnits,
  demographicMetrics,
  onSensitivity,
  onSave,
  saving = false,
  saveError = null,
  savedAt = null,
  saveLabel = "Save to pipeline",
  pdfHref = null,
}: VerdictPanelProps) {
  const tone = verdictTone(combined);

  return (
    <aside
      className="sticky border border-line bg-surface"
      style={{ top: "calc(var(--header-h) + var(--space-4))" }}
    >
      {/* ── Above the fold: the B0 three lines ─────────────────────────── */}
      <div className="px-4 pt-4">
        <GateLine
          gate="Gate 1"
          value={screen.verdict}
          tone={
            screen.verdict === "GO"
              ? "go"
              : screen.verdict === "NO-GO" || screen.verdict === "NOT SCORED"
                ? "nogo"
                : "maybe"
          }
          detail={[
            `screen ${fmtScore(screen.weightedScore)} · KO ${screen.koPass.toLowerCase()}`,
            `unk ${percent0(screen.unknownShare)}`,
          ]}
        />

        <div className="mt-4">
          <GateLine
            gate="Gate 2"
            value={landTestLabel(gate2)}
            tone={
              gate2 === "PASS" ? "go" : gate2 === "FAIL" ? "maybe" : "nogo"
            }
            detail={
              gate2Error
                ? [gate2Error]
                : gate2 === "NOT RUN"
                  ? ["No First Look figures entered yet"]
                  : firstLook
                    ? [
                        `max land ${money(firstLook.maxLandPrice)}`,
                        firstLook.askingPrice
                          ? `vs ask ${money(firstLook.askingPrice)} · ${percent(firstLook.headroomPctOfAsk, 0)}`
                          : "no asking price entered",
                      ]
                    : []
            }
          />
        </div>
      </div>

      {/* The one thing allowed to be loud. */}
      <div className={cn("mt-4 px-4 py-6", VERDICT_FILL[tone])}>
        {/* Inherits the fill's foreground so it works on amber and on slate. */}
        <div className="micro text-current opacity-70">Combined</div>
        <div
          className="display mt-1 font-[700] uppercase"
          style={{
            fontSize: combined.length > 11 ? "1.875rem" : "var(--toro-text-loud)",
            lineHeight: 1.02,
            letterSpacing: "-0.01em",
          }}
        >
          {combined}
        </div>
      </div>

      {/* ── Below the fold ─────────────────────────────────────────────── */}
      <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
        <DetailGroup title="Demographics">
          <DetailRow label="Mixed-Use" value={mu === null ? "—" : String(mu)} />
          <DetailRow label="Multifamily" value={mf === null ? "—" : String(mf)} />
          <DetailRow label="Band" value={demographics.band ?? "—"} />
          <DetailRow
            label="Governing"
            value={
              demographics.governingScore === null
                ? "—"
                : String(demographics.governingScore)
            }
          />
        </DetailGroup>

        {demographicMetrics && demographicMetrics.length > 0 && (
          <MetricsTable metrics={demographicMetrics} />
        )}

        <DetailGroup title="Screen">
          <DetailRow label="Weighted" value={fmtScore(screen.weightedScore)} />
          <DetailRow
            label="Answered"
            value={`${screen.answeredCount} / 17`}
          />
          <DetailRow
            label="Unknown share"
            value={percent0(screen.unknownShare)}
          />
          <DetailRow label="Knockouts" value={screen.koPass} />
          <DetailRow label="Probability" value={screen.probability.toFixed(2)} />
          <DetailRow
            label="Prob-weighted"
            value={fmtScore(screen.probabilityWeightedScore)}
          />
        </DetailGroup>

        <DetailGroup title="First Look" muted={!firstLook}>
          <DetailRow
            label="YoC on cost"
            value={firstLook ? percent(firstLook.yocOnCost) : "—"}
          />
          <DetailRow
            label="Target blend"
            value={firstLook ? percent(firstLook.blendedYoc) : "—"}
          />
          <DetailRow
            label="Gap"
            value={firstLook ? bps(firstLook.yocGapBps) : "—"}
            // Short of the hurdle is the thing this row is here to say.
            tone={firstLook && firstLook.yocGapBps < 0 ? "short" : undefined}
          />
          <DetailRow
            label="NOI"
            value={firstLook ? money(firstLook.totalNoi) : "—"}
          />
          <DetailRow
            label="Cost ex-land"
            value={firstLook ? money(firstLook.totalCostExLand) : "—"}
          />
          <DetailRow
            label="Pad proceeds"
            value={firstLook ? money(firstLook.padProceeds.total) : "—"}
          />
          <DetailRow
            label="Max land"
            value={firstLook ? money(firstLook.maxLandPrice) : "—"}
          />
          <DetailRow
            label="$/unit"
            value={
              firstLook && resiUnits
                ? compact(firstLook.maxLandPrice / resiUnits)
                : "—"
            }
          />
          <DetailRow
            label="$/acre"
            value={
              firstLook && firstLook.maxLandPricePerAcre
                ? compact(firstLook.maxLandPricePerAcre)
                : "—"
            }
          />
          <DetailRow
            label="Land @ TDC rates"
            value={firstLook ? money(firstLook.landAtTdcRates) : "—"}
          />
          <DetailRow
            label="Gap vs TDC"
            value={firstLook ? money(firstLook.maxLandPriceVsTdcRates) : "—"}
          />
          <DetailRow
            label="Retail NOI share"
            value={firstLook ? percent(firstLook.retailShareOfNoi, 1) : "—"}
          />
          <DetailRow
            label="Type test"
            value={
              firstLook?.productTypeTest === "mixed_use"
                ? "Mixed-Use"
                : firstLook?.productTypeTest === "multifamily"
                  ? "Multifamily"
                  : "—"
            }
          />
        </DetailGroup>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <PanelButton
          onClick={onSensitivity}
          disabled={!firstLook || !onSensitivity}
          disabledReason="Needs a First Look to vary"
        >
          Sensitivity
        </PanelButton>
        {pdfHref ? (
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="micro border border-line-strong bg-transparent px-3 py-1.5 text-ink transition-colors hover:bg-surface-3"
          >
            PDF
          </a>
        ) : (
          <PanelButton disabled disabledReason="Save the deal first — a PDF is generated from the saved record">
            PDF
          </PanelButton>
        )}
        <PanelButton
          primary
          onClick={onSave}
          disabled={!onSave || saving}
          disabledReason="No database configured, so there is nowhere to save"
        >
          {saving ? "Saving…" : saveLabel}
        </PanelButton>
      </div>

      {(saveError || savedAt) && (
        <p
          className={cn(
            "border-t border-line px-4 pb-3 text-sm",
            saveError ? "text-maybe" : "caption",
          )}
        >
          {saveError ?? savedAt}
        </p>
      )}
    </aside>
  );
}

function GateLine({
  gate,
  value,
  tone,
  detail,
}: {
  gate: string;
  value: string;
  tone: "go" | "maybe" | "nogo";
  detail: string[];
}) {
  return (
    <div className="border-l-[3px] border-l-[var(--toro-red)] pl-3">
      <div className="micro text-ink-3">{gate}</div>
      <div
        className={cn(
          "display font-[700] leading-[var(--leading-tight)]",
          tone === "go" && "text-go",
          tone === "maybe" && "text-maybe",
          tone === "nogo" && "text-nogo",
        )}
        style={{
          fontSize: "var(--toro-text-gate)",
          letterSpacing: "-0.005em",
        }}
      >
        {value}
      </div>
      {detail.map((line) => (
        <div key={line} className="text-sm text-ink">
          {line}
        </div>
      ))}
    </div>
  );
}

/**
 * The nine metrics behind MU and MF, with the weight each profile gives them
 * and what the raw value was. This is the "show why" the spec asks for — a
 * score with no visible inputs is a number nobody can argue with.
 */
function MetricsTable({ metrics }: { metrics: ScoredMetric[] }) {
  const format = (metric: ScoredMetric): string => {
    if (metric.value === null) return "—";
    switch (metric.key) {
      case "avgIncome":
      case "discretionary":
        return money(metric.value);
      case "totalPop":
        return compact(metric.value);
      case "education":
      case "hhFormation":
      case "youngAdult":
      case "rentToIncome":
      case "primeRenter":
        return percent(metric.value, 1);
      default:
        return metric.value.toFixed(2);
    }
  };

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="section-head mb-1.5">Metrics</div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="micro pb-1 text-left font-normal">Metric</th>
            <th className="micro pb-1 pl-2 text-right font-normal">Value</th>
            <th className="micro pb-1 pl-2 text-right font-normal">MU</th>
            <th className="micro pb-1 pl-2 text-right font-normal">MF</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric.key} className="align-baseline">
              <td className="py-[2px] text-sm text-ink">
                {metric.label}
                {metric.flag && (
                  <span
                    className="ml-1.5 text-maybe"
                    title={metric.flag}
                    aria-label={metric.flag}
                  >
                    ⚑
                  </span>
                )}
                {metric.floor !== "none" && (
                  <span
                    className={cn(
                      "micro ml-1.5 border px-1 py-[1px] leading-none",
                      metric.floor === "hard"
                        ? "border-nogo bg-nogo text-ink-inverse"
                        : "border-line-strong text-maybe",
                    )}
                    title={`Below the ${metric.floor} floor`}
                  >
                    {metric.floor}
                  </span>
                )}
              </td>
              <td className="num py-[2px] pl-2 text-sm">{format(metric)}</td>
              <td
                className={cn(
                  "num py-[2px] pl-2 text-sm",
                  metric.weightMu === null && "font-normal text-ink-3",
                )}
              >
                {metric.weightMu ?? "—"}
              </td>
              <td
                className={cn(
                  "num py-[2px] pl-2 text-sm",
                  metric.weightMf === null && "font-normal text-ink-3",
                )}
              >
                {metric.weightMf ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {metrics.some((m) => m.flag) && (
        <p className="caption mt-1.5">⚑ hover for why this metric is qualified</p>
      )}
    </div>
  );
}

function DetailGroup({
  title,
  children,
  muted = false,
}: {
  title: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={cn("border-t border-line px-4 py-3", muted && "opacity-55")}>
      <div className="section-head mb-1.5">{title}</div>
      <dl>{children}</dl>
    </div>
  );
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "short";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 leading-[1.65]">
      <dt className="text-sm text-ink">{label}</dt>
      <dd
        className={cn(
          "num text-sm",
          tone === "short" && "text-maybe",
          value === "—" && "font-normal text-ink-3",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Primary is solid Toro red at full strength — never dimmed to pink, because a
 * washed-out brand red reads as a rendering fault rather than a disabled state.
 * Secondary and not-yet-built actions are charcoal outline instead.
 */
function PanelButton({
  children,
  primary = false,
  disabled = false,
  onClick,
  disabledReason = "Lands in a later phase",
}: {
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledReason : undefined}
      className={cn(
        "micro border px-3 py-1.5 transition-colors",
        primary
          ? "border-[var(--toro-red)] bg-[var(--toro-red)] text-white hover:bg-[var(--toro-red-hover)]"
          : "border-line-strong bg-transparent text-ink-2 hover:bg-surface-3",
        // Enabled and secondary reads brighter than the two that are not yet
        // built, so the one live action is findable among them.
        !disabled && !primary && "text-ink",
        disabled && "cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
