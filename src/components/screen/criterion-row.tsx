"use client";

import { useState } from "react";

import { score as fmtScore } from "@/lib/format";
import type { Answer, CriterionScore } from "@/lib/scoring";
import { cn } from "@/lib/utils";

import { AnswerRadio } from "./answer-radio";

interface CriterionRowProps {
  row: CriterionScore;
  note: string;
  onAnswer: (value: Answer) => void;
  onNote: (value: string) => void;
  /** Caption under the label, e.g. where a pre-filled answer came from. */
  caption?: string;
  /** Replaces the segmented control for computed criteria. */
  computedDisplay?: string;
  /** Alternating stripe, counted across the whole table rather than per bucket. */
  zebra?: boolean;
  /** Display-only answer labels in [yes, maybe, no] order. */
  labels?: readonly [string, string, string];
}

/**
 * One of the 18 rows. Label verbatim from John's filter — never abbreviated,
 * so "Market viability of all products" wraps to two lines rather than losing
 * a word.
 */
export function CriterionRow({
  row,
  note,
  onAnswer,
  onNote,
  caption,
  computedDisplay,
  zebra = false,
  labels,
}: CriterionRowProps) {
  const [open, setOpen] = useState(false);
  const expanded = open || note !== "";

  // Exactly one background class, so precedence is decided here rather than by
  // the order Tailwind happens to emit them in. :hover outranks all of them.
  const rowBackground = row.isKnockout
    ? "bg-nogo-fill"
    : zebra
      ? "bg-surface-2"
      : "bg-surface";

  // Zero is data; a dash is absence. An unscored criterion has contributed
  // nothing yet, which is not the same as having earned nothing.
  const scoreText = row.points === null ? "—" : fmtScore(row.score);

  return (
    <>
      <tr
        className={cn(
          "border-b border-line align-middle hover:bg-surface-3",
          rowBackground,
        )}
        style={{ height: "var(--row-h)" }}
      >
        <td
          className={cn(
            "py-1 pr-3 text-ink",
            row.isKnockout
              ? "border-l-[3px] border-l-nogo pl-[21px]"
              : "border-l-[3px] border-l-transparent pl-[21px]",
          )}
        >
          {row.label}
        </td>

        <td className="num w-12 pr-4">{row.weight}</td>

        <td className="w-14 pr-4">
          {row.ko && (
            <span
              className={cn(
                "micro inline-block border px-1.5 py-[2px] leading-none",
                row.isKnockout
                  ? "border-nogo bg-nogo text-ink-inverse"
                  : "border-line-strong bg-transparent text-ko",
              )}
              title="Knockout: a No here forces NO-GO"
            >
              KO
            </span>
          )}
        </td>

        {/* Wide enough for the longest row — "Sophisticated | Mixed |
            Unsophisticated" — since every row's segments size to its own
            longest label. */}
        <td className="w-[330px] pr-4">
          {computedDisplay ? (
            <span className="text-ink">{computedDisplay}</span>
          ) : (
            <AnswerRadio
              name={row.key}
              value={row.answer}
              onChange={onAnswer}
              ko={row.ko}
              label={row.label}
              labels={labels}
            />
          )}
        </td>

        <td
          className={cn(
            "num w-20 pr-5",
            row.points === null && "font-normal text-ink-3",
          )}
        >
          {scoreText}
        </td>

        <td className="w-10 pr-5">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={expanded}
            aria-label={
              note ? `Edit note on ${row.label}` : `Add note on ${row.label}`
            }
            className={cn(
              "cursor-pointer text-sm leading-none",
              note ? "text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            {note ? "✎" : "—"}
          </button>
        </td>
      </tr>

      {(expanded || caption) && (
        <tr className={cn("border-b border-line", rowBackground)}>
          <td colSpan={6} className="pb-1.5 pl-6 pr-5">
            {caption && <div className="caption">↳ {caption}</div>}
            {expanded && (
              <input
                type="text"
                value={note}
                onChange={(event) => onNote(event.target.value)}
                placeholder="Note — what you know, and how you know it"
                className={cn(
                  "mt-1 w-full max-w-[46rem] border-b border-line-strong bg-transparent",
                  "px-0 py-1 text-sm text-ink",
                  "placeholder:text-ink-3 focus:border-[var(--toro-red)] focus:outline-none",
                )}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}
