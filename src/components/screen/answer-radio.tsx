"use client";

import { useRef } from "react";

import type { Answer } from "@/lib/scoring";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Exclude<Answer, null>; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
];

interface AnswerRadioProps {
  name: string;
  value: Answer;
  onChange: (value: Answer) => void;
  /** Renders a selected "no" as a knockout rather than a plain selection. */
  ko?: boolean;
  label: string;
}

/**
 * Yes | Maybe | No as one segmented control.
 *
 * Three joined segments on a shared hairline. The selected segment fills Toro
 * red; on a knockout row a selected "No" fills slate and inverts instead, so it
 * matches the chip and the left rule the row picks up — a knockout is a NO-GO
 * signal, and NO-GO is never a second red.
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
}: AnswerRadioProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  function move(delta: number) {
    const index = OPTIONS.findIndex((option) => option.value === value);
    const next = OPTIONS[(index + delta + OPTIONS.length) % OPTIONS.length];
    onChange(next.value);
    const buttons = groupRef.current?.querySelectorAll("button");
    buttons?.[OPTIONS.indexOf(next)]?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={`${label} answer`}
      className="inline-flex border border-line-strong"
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
      {OPTIONS.map((option, index) => {
        const selected = value === option.value;
        const knockedOut = selected && ko && option.value === "no";
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            tabIndex={
              selected || (value === null && option.value === "yes") ? 0 : -1
            }
            onClick={() => onChange(selected ? null : option.value)}
            title={selected ? "Click again to clear" : undefined}
            className={cn(
              "px-2.5 py-1 text-sm leading-none transition-colors",
              "cursor-pointer",
              index > 0 && "border-l border-l-line-strong",
              selected
                ? knockedOut
                  ? "bg-nogo font-[700] text-ink-inverse"
                  : "bg-go font-[700] text-white"
                : "bg-transparent text-ink hover:bg-surface-3",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
