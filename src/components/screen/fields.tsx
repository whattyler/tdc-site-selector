"use client";

import { useState } from "react";

import { groupNumber, stripGrouping } from "@/lib/format";
import { cn } from "@/lib/utils";

const inputBase =
  "w-full border-b border-line-strong bg-transparent px-0 py-1 text-ink " +
  "placeholder:text-ink-3 focus:border-[var(--toro-red)] focus:outline-none";

interface FieldShellProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

function FieldShell({ label, hint, children, className }: FieldShellProps) {
  return (
    <label className={cn("block", className)}>
      <span className="micro block leading-none">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && (
        <span className="caption mt-0.5 block">
          {hint}
        </span>
      )}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <FieldShell label={label} hint={hint} className={className}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={inputBase}
      />
    </FieldShell>
  );
}

/**
 * Numeric entry. Stays a string in state so a half-typed "1." or an empty
 * field is representable — the engine gets `null` until it parses.
 *
 * Grouped with thousands separators whenever the field is not being edited,
 * and stripped back to digits on focus so typing and caret movement are not
 * fighting commas that shift as you go. State is always the raw string; the
 * grouping is display only.
 */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  prefix,
  suffix,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <FieldShell label={label} hint={hint} className={className}>
      <span className="flex items-baseline gap-1 border-b border-line-strong focus-within:border-[var(--toro-red)]">
        {prefix && (
          <span className="text-sm text-ink-3">{prefix}</span>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={focused ? value : groupNumber(value)}
          placeholder={placeholder ?? "—"}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // Strip on the way in so a pasted "10,424,289" lands as digits.
          onChange={(event) => onChange(stripGrouping(event.target.value))}
          className={cn(inputBase, "num border-b-0")}
        />
        {suffix && (
          <span className="text-sm text-ink-3">{suffix}</span>
        )}
      </span>
    </FieldShell>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <FieldShell label={label} hint={hint} className={className}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={cn(inputBase, "cursor-pointer")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function InputSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-line bg-surface">
      <header className="flex items-baseline justify-between border-b border-line-strong bg-surface-2 px-4 py-2">
        <h2 className="section-head">{title}</h2>
        {note && (
          <span className="caption">{note}</span>
        )}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function FieldGrid({
  columns = 4,
  children,
}: {
  columns?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid gap-x-6 gap-y-4"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full border-b border-line pb-1 text-sm font-[530] text-ink">
      {children}
    </div>
  );
}
