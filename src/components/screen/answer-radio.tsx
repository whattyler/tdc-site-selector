"use client";

import { useRef } from "react";

import type { Answer } from "@/lib/scoring";
import { cn } from "@/lib/utils";

type Choice = Exclude<Answer, null>;

const CHOICES: readonly Choice[] = ["yes", "maybe", "no"];

/** Fallback when a criterion has no entry in the label map. */
export const DEFAULT_ANSWER_LABELS: readonly [string, string, string] = [
  "Yes",
  "Maybe",
  "No",
];

/** The underlying answer, for the tooltip. The label can say anything. */
const ANSWER_WORD: Record<Choice, string> = {
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

interface AnswerRadioProps {
  name: string;
  value: Answer;
  onChange: (value: Answer) => void;
  /** Renders a selected "no" as a knockout rather than a plain selection. */
  ko?: boolean;
  label: string;
  /** Display-only labels in [yes, maybe, no] order. Scoring is unaffected. */
  labels?: readonly [string, string, string];
}

/**
 * Yes | Maybe | No as one segmented control, under whatever words the criterion
 * uses for them. The labels are presentation only — the value sent up is always
 * yes / maybe / no, and the engine scores 3 / 1 / 0 regardless.
 *
 * Laid out as a three-column grid rather than a flex row so all three segments
 * take the width of the longest label in that row; "Sophisticated | Mixed |
 * Unsophisticated" stays as clickable as "Low | Normal | High".
 *
 * The selected segment fills Toro red; on a knockout row a selected "No" fills
 * slate and inverts instead, matching the chip and the left rule the row picks
 * up — a knockout is a NO-GO signal, and NO-GO is never a second red.
 *
 * Arrow keys move within the row, Tab moves to the next row. Clicking the
 * selected segment clears it back to unanswered.
 */
export function AnswerRadio({
  name,
  value,
  onChange,
  ko = false,
  label,
  labels = DEFAULT_ANSWER_LABELS,
}: AnswerRadioProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  function move(delta: number) {
    const index = CHOICES.indexOf(value as Choice);
    const nextIndex = (index + delta + CHOICES.length) % CHOICES.length;
    onChange(CHOICES[nextIndex]);
    const buttons = groupRef.current?.querySelectorAll("button");
    buttons?.[nextIndex]?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={`${label} answer`}
      className="inline-grid grid-cols-3 border border-line-strong"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {CHOICES.map((choice, index) => {
        const selected = value === choice;
        const knockedOut = selected && ko && choice === "no";
        const word = ANSWER_WORD[choice];
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            tabIndex={selected || (value === null && choice === "yes") ? 0 : -1}
            // Says what the label actually scores as, since the words vary.
            title={selected ? `${word} — click again to clear` : word}
            onClick={() => onChange(selected ? null : choice)}
            className={cn(
              "cursor-pointer px-2.5 py-1 text-center text-sm leading-none",
              "transition-colors",
              index > 0 && "border-l border-l-line-strong",
              selected
                ? knockedOut
                  ? "bg-nogo font-[700] text-ink-inverse"
                  : "bg-go font-[700] text-white"
                : "bg-transparent text-ink hover:bg-surface-3",
            )}
          >
            {labels[index]}
          </button>
        );
      })}
    </div>
  );
}
