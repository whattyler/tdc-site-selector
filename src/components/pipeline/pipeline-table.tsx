"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { compact, percent, score as fmtScore } from "@/lib/format";
import type { PipelineRow } from "@/lib/deals/snapshot";
import { cn } from "@/lib/utils";

/**
 * The pipeline. Spec B8.
 *
 * One row per deal, ordered by combined verdict and then by prob-weighted
 * score. That order is the point of the page: the things worth acting on sit
 * at the top and nothing else can push them down.
 */

const PRODUCT_LABEL = {
  mixed_use: "Mixed-Use",
  multifamily: "Multifamily",
  auto: "—",
} as const;

/** Same palette as the verdict panel, at text weight — this is a list, not a verdict. */
function verdictClass(verdict: PipelineRow["combinedVerdict"]): string {
  switch (verdict) {
    case "DOUBLE GO":
      return "text-[var(--toro-red)]";
    case "GO — LAND FAIL":
    case "WATCH":
    case "INCOMPLETE":
      return "text-maybe";
    default:
      return "text-nogo";
  }
}

function landTestLabel(test: PipelineRow["landTest"]): string {
  if (test === "PASS") return "CLEAR";
  if (test === "FAIL") return "SHORT";
  return "—";
}

/** Relative where it helps, absolute where it does not. */
function updatedLabel(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return then.toLocaleDateString();
}

export function PipelineTable({ deals }: { deals: PipelineRow[] }) {
  const router = useRouter();

  if (deals.length === 0) {
    return (
      <section className="border border-line bg-surface px-6 py-10 text-center">
        <p className="text-ink">Nothing in the pipeline yet.</p>
        <p className="caption mt-1">
          Screen a deal and press Save to pipeline, and it lands here.
        </p>
        <Link
          href="/deals/new"
          className="micro mt-4 inline-block border border-[var(--toro-red)] bg-[var(--toro-red)] px-3 py-1.5 text-white hover:bg-[var(--toro-red-hover)]"
        >
          New deal
        </Link>
      </section>
    );
  }

  return (
    <section className="border border-line bg-surface">
      <header className="flex items-baseline justify-between border-b border-line-strong bg-surface-2 px-4 py-2">
        <h2 className="section-head">Pipeline</h2>
        <span className="caption">
          {deals.length} deal{deals.length === 1 ? "" : "s"} · verdict, then
          prob-weighted score
        </span>
      </header>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line-strong">
            <th className="micro py-2 pl-4 pr-3 text-left">Deal</th>
            <th className="micro w-40 py-2 pr-3 text-left">Submarket</th>
            <th className="micro w-28 py-2 pr-3 text-left">Type</th>
            <th className="micro w-20 py-2 pr-3 text-right">MU</th>
            <th className="micro w-20 py-2 pr-3 text-right">MF</th>
            <th className="micro w-24 py-2 pr-3 text-left">Gate 1</th>
            <th className="micro w-20 py-2 pr-3 text-left">Gate 2</th>
            <th className="micro w-36 py-2 pr-3 text-left">Combined</th>
            <th className="micro w-28 py-2 pr-3 text-right">Max land</th>
            <th className="micro w-28 py-2 pr-3 text-right">Ask</th>
            <th className="micro w-24 py-2 pr-3 text-right">Gap</th>
            <th className="micro w-28 py-2 pr-4 text-right">Updated</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((row) => (
            <tr
              key={row.id}
              onClick={() => router.push(`/deals/${row.id}`)}
              className="cursor-pointer border-b border-line hover:bg-surface-3"
              style={{ height: "var(--row-h)" }}
            >
              <td className="py-1 pl-4 pr-3 text-ink">
                {/* A real link inside the row, so middle-click and "open in new
                    tab" work rather than being swallowed by the row handler. */}
                <Link
                  href={`/deals/${row.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="hover:text-[var(--toro-red)]"
                >
                  {row.name}
                </Link>
              </td>
              <td className="truncate pr-3 text-sm text-ink-2">
                {row.submarket ?? "—"}
              </td>
              <td className="pr-3 text-sm text-ink-2">
                {PRODUCT_LABEL[row.productType]}
              </td>
              <td className="num pr-3 text-sm">{fmtScore(row.mu)}</td>
              <td className="num pr-3 text-sm">{fmtScore(row.mf)}</td>
              <td className="pr-3 text-sm text-ink-2">
                {row.verdict}
                <span className="caption ml-1.5">
                  {fmtScore(row.probWeighted)}
                </span>
              </td>
              <td className="pr-3 text-sm text-ink-2">
                {landTestLabel(row.landTest)}
              </td>
              <td
                className={cn("pr-3 text-sm", verdictClass(row.combinedVerdict))}
              >
                {row.combinedVerdict}
              </td>
              <td className="num pr-3 text-sm">{compact(row.maxLandPrice)}</td>
              <td className="num pr-3 text-sm">{compact(row.askingPrice)}</td>
              <td
                className={cn(
                  "num pr-3 text-sm",
                  row.headroomPctOfAsk !== null &&
                    row.headroomPctOfAsk < 0 &&
                    "text-maybe",
                )}
              >
                {row.headroomPctOfAsk === null
                  ? "—"
                  : percent(row.headroomPctOfAsk, 0)}
              </td>
              <td className="num pr-4 text-sm text-ink-3">
                <span title={`${new Date(row.updatedAt).toLocaleString()} · ${row.updatedBy ?? "unknown"}`}>
                  {updatedLabel(row.updatedAt)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="caption border-t border-line px-4 py-2">
        Max land and gap are as of each deal&rsquo;s last save. Opening a deal
        recomputes it against today&rsquo;s assumptions, so the two can differ —
        that difference is a change in the levers, not a bug.
      </p>
    </section>
  );
}
