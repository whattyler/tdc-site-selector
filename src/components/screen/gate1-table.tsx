"use client";

import { score as fmtScore } from "@/lib/format";
import type { Answer, BucketKey, CriterionScore, ScreenResult } from "@/lib/scoring";

import { CriterionRow } from "./criterion-row";

/**
 * Bucket names verbatim from John's filter (Deal Screen!B14, B19, B24, B32).
 * Display only — the weights behind them live in `assumptions`.
 */
const BUCKET_LABELS: Record<BucketKey, string> = {
  real_estate: "Real Estate Considerations",
  site: "Site Considerations",
  deal: "Deal Considerations",
  toro: "Toro Considerations",
};

const BUCKET_ORDER: BucketKey[] = ["real_estate", "site", "deal", "toro"];

/**
 * Answer labels per criterion, in [yes, maybe, no] order.
 *
 * Presentation only. The control still sends yes / maybe / no and the engine
 * still scores 3 / 1 / 0 — these just put the question in the language the
 * criterion is actually asked in. A criterion missing from this map falls back
 * to Yes / Maybe / No.
 *
 * Barriers to Entry is the one to read carefully: John's prompt is "can this be
 * replicated a mile away within 24 months?", where a plain Yes means replicable,
 * which is the bad answer but scores 3. High / Some / None re-anchors the
 * control to the criterion name so the row cannot be answered backwards.
 */
const ANSWER_LABELS: Record<string, readonly [string, string, string]> = {
  geography: ["≤30 min", "30–45 min", ">45 min"],
  market: ["Strong", "Mixed", "Weak"],
  location: ["Prime", "Adequate", "Poor"],
  barriers_to_entry: ["High", "Some", "None"],
  entitlements: ["In place", "Achievable", "At risk"],
  competition: ["Light", "Moderate", "Heavy"],
  physical: ["Clean", "Manageable", "Problem"],
  seller_sophistication: ["Sophisticated", "Mixed", "Unsophisticated"],
  control: ["Full", "Partial", "Thin"],
  market_viability: ["All clear", "Some risk", "One fails"],
  partner_quality: ["Strong", "Unproven", "None"],
  pursuit_costs: ["Low", "Normal", "High"],
  timing: ["Good window", "Tight", "Wrong window"],
  brand_fit: ["On brand", "Adjacent", "Off brand"],
  capability: ["Proven", "Stretch", "New to us"],
  capacity: ["Available", "Tight", "None"],
  fee_potential: ["Strong", "Modest", "Thin"],
};

interface Gate1TableProps {
  screen: ScreenResult;
  notes: Record<string, string>;
  probability: number;
  probabilityMin: number;
  probabilityMax: number;
  demographicsCaption: string;
  geographyCaption: string;
  demographicsDisplay: string;
  onAnswer: (key: string, value: Answer) => void;
  onNote: (key: string, value: string) => void;
  onProbability: (value: number) => void;
}

export function Gate1Table({
  screen,
  notes,
  probability,
  probabilityMin,
  probabilityMax,
  demographicsCaption,
  geographyCaption,
  demographicsDisplay,
  onAnswer,
  onNote,
  onProbability,
}: Gate1TableProps) {
  // WebKit paints the filled part of a range track from this, since it has no
  // ::-moz-range-progress equivalent.
  const probabilitySpan = probabilityMax - probabilityMin;
  const probabilityFilled =
    probabilitySpan === 0
      ? 0
      : Math.min(1, Math.max(0, (probability - probabilityMin) / probabilitySpan));

  const byBucket = new Map<BucketKey, CriterionScore[]>();
  for (const row of screen.rows) {
    const list = byBucket.get(row.bucket) ?? [];
    list.push(row);
    byBucket.set(row.bucket, list);
  }

  return (
    <section className="border border-line bg-surface">
      <header className="flex items-baseline justify-between border-b border-line-strong bg-surface-2 px-4 py-2">
        <h2 className="section-head">Gate 1 · Deal Screen</h2>
        <span className="text-ink">
          <span className="num">{screen.answeredCount}</span> / 17 answered
        </span>
      </header>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line-strong">
            <th className="micro py-2 pl-6 pr-3 text-left">Criterion</th>
            <th className="micro w-12 py-2 pr-4 text-right">Wt</th>
            <th className="micro w-14 py-2 pr-4 text-left">KO</th>
            <th className="micro w-[330px] py-2 pr-4 text-left">Answer</th>
            <th className="micro w-20 py-2 pr-5 text-right">Score</th>
            <th className="micro w-10 py-2 pr-5 text-left">Note</th>
          </tr>
        </thead>

        <tbody>
          {BUCKET_ORDER.map((bucket, bucketIndex) => {
            const rows = byBucket.get(bucket) ?? [];
            const earned = rows.reduce((sum, row) => sum + row.score, 0);
            const available = rows.reduce((sum, row) => sum + row.weight, 0);
            // Zebra runs continuously across buckets, so the stripe never
            // resets mid-table and re-doubles on a bucket boundary.
            const startIndex = BUCKET_ORDER.slice(0, bucketIndex).reduce(
              (sum, key) => sum + (byBucket.get(key)?.length ?? 0),
              0,
            );

            return (
              <BucketGroup
                key={bucket}
                label={BUCKET_LABELS[bucket]}
                earned={earned}
                available={available}
                rows={rows}
                startIndex={startIndex}
                notes={notes}
                demographicsCaption={demographicsCaption}
                geographyCaption={geographyCaption}
                demographicsDisplay={demographicsDisplay}
                onAnswer={onAnswer}
                onNote={onNote}
              />
            );
          })}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-t-line-strong bg-surface-2">
            <td className="micro py-2.5 pl-6 pr-3" colSpan={4}>
              Weighted score
            </td>
            <td className="num py-2.5 pr-5 text-[1.0625rem] font-[650]">
              {fmtScore(screen.weightedScore)}
            </td>
            <td className="num py-2.5 pr-5 font-normal text-ink-3">/ 100</td>
          </tr>
        </tfoot>
      </table>

      <div className="border-t border-line px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="micro shrink-0">Probability</span>
          <span className="caption">{probabilityMin.toFixed(2)}</span>
          <input
            type="range"
            min={probabilityMin}
            max={probabilityMax}
            step={0.05}
            value={probability}
            onChange={(event) => onProbability(Number(event.target.value))}
            aria-label="Probability"
            className="slider max-w-[26rem] flex-1"
            style={
              {
                "--slider-pct": `${probabilityFilled * 100}%`,
              } as React.CSSProperties
            }
          />
          <span className="caption">{probabilityMax.toFixed(2)}</span>
          <span className="num w-12">{probability.toFixed(2)}</span>
        </div>
        <p className="caption mt-1">
          Ranks deals against each other. Not a criterion, not a gate.
        </p>
      </div>
    </section>
  );
}

interface BucketGroupProps {
  label: string;
  earned: number;
  available: number;
  rows: CriterionScore[];
  /** Position of this bucket's first row in the whole table, for the zebra. */
  startIndex: number;
  notes: Record<string, string>;
  demographicsCaption: string;
  geographyCaption: string;
  demographicsDisplay: string;
  onAnswer: (key: string, value: Answer) => void;
  onNote: (key: string, value: string) => void;
}

function BucketGroup({
  label,
  earned,
  available,
  rows,
  startIndex,
  notes,
  demographicsCaption,
  geographyCaption,
  demographicsDisplay,
  onAnswer,
  onNote,
}: BucketGroupProps) {
  const filled = available === 0 ? 0 : Math.max(0, Math.min(1, earned / available));

  return (
    <>
      <tr
        className="bg-surface-2"
        style={{ height: "var(--row-h-bucket)" }}
      >
        <td className="bucket-head pl-4 pr-3" colSpan={3}>
          {label}
        </td>
        <td />
        <td className="num pr-5">{fmtScore(earned)}</td>
        <td className="num pr-5 font-normal text-ink-3">/ {available}</td>
      </tr>

      {/* Earned against available for this bucket — which one is dragging,
          without reading eighteen numbers. */}
      <tr aria-hidden className="bg-surface-2">
        <td colSpan={6} className="p-0">
          <div className="h-[3px] w-full bg-line">
            <div
              className="h-full bg-[var(--toro-red)] transition-[width]"
              style={{ width: `${filled * 100}%` }}
            />
          </div>
        </td>
      </tr>

      {rows.map((row, index) => (
        <CriterionRow
          key={row.key}
          row={row}
          zebra={(startIndex + index) % 2 === 1}
          note={notes[row.key] ?? ""}
          onAnswer={(value) => onAnswer(row.key, value)}
          onNote={(value) => onNote(row.key, value)}
          labels={ANSWER_LABELS[row.key]}
          caption={
            row.key === "demographics"
              ? demographicsCaption
              : row.key === "geography"
                ? geographyCaption
                : undefined
          }
          computedDisplay={
            row.kind === "computed" ? demographicsDisplay : undefined
          }
        />
      ))}
    </>
  );
}
