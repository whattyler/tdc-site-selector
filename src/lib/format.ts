/**
 * Display formatting. Every number on the page goes through here so a column
 * of figures lines up and reads the same way twice.
 */

/** `$9.40M`, `$412k`, `$0` — compact money for the verdict panel. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** `31.3k`, `2.20M` — compact count without the currency mark. */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${abs.toFixed(0)}`;
}

/** `6.90%` — a decimal rendered as a percentage. */
export function percent(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}${(Math.abs(value) * 100).toFixed(digits)}%`;
}

/** `12%` — whole-number percentage, for the unknown share. */
export function percent0(value: number | null | undefined): string {
  return percent(value, 0);
}

/** `73.0` — a score to one decimal. */
export function score(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

/** Parse a typed field. Blank, whitespace or unparseable becomes null. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s%]/g, "").replace(/−/g, "-");
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Remove grouping separators. Applied on every keystroke, so state stays raw. */
export function stripGrouping(raw: string): string {
  return raw.replace(/,/g, "");
}

/**
 * `10424289` → `10,424,289`. For displaying a typed field while it is not
 * being edited.
 *
 * Keeps exactly the decimals that were typed rather than rounding to a fixed
 * precision — a half-entered `1.` or a rate like `0.0725` must survive a blur
 * unchanged. Anything unparseable is handed back untouched so a typo stays
 * visible instead of vanishing.
 */
export function groupNumber(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  const value = parseNumber(trimmed);
  if (value === null) return raw;

  const decimals = (trimmed.split(".")[1] ?? "").replace(/[^0-9]/g, "").length;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
