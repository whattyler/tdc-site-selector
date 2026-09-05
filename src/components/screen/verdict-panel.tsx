"use client";

import { compact, money, percent, percent0, score as fmtScore } from "@/lib/format";
import type {
  CombinedVerdict,
  DemographicsResult,
  FirstLookResult,
  Gate2Result,
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
            label="Blended YoC"
            value={firstLook ? percent(firstLook.blendedYoc) : "—"}
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
        <PanelButton disabled>Sensitivity</PanelButton>
        <PanelButton disabled>PDF</PanelButton>
        <PanelButton disabled primary>
          Save to pipeline
        </PanelButton>
      </div>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 leading-[1.65]">
      <dt className="text-sm text-ink">{label}</dt>
      <dd className={cn("num text-sm", value === "—" && "font-normal text-ink-3")}>
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
}: {
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Lands in a later phase" : undefined}
      className={cn(
        "micro border px-3 py-1.5 transition-colors",
        primary
          ? "border-[var(--toro-red)] bg-[var(--toro-red)] text-white hover:bg-[var(--toro-red-hover)]"
          : "border-line-strong bg-transparent text-ink-2 hover:bg-surface-3",
        disabled && "cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
