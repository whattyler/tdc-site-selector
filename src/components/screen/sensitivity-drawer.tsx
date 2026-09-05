"use client";

import { useEffect, useState } from "react";

import { compact, money, percent } from "@/lib/format";
import type { FirstLookResult } from "@/lib/scoring";
import type { CostRentGrid, ScenarioCell } from "@/lib/sensitivity";
import { cn } from "@/lib/utils";

/**
 * Sensitivity. Spec B5 §6.
 *
 * Slides in over the verdict panel rather than replacing it: the point of the
 * grids is to be read against the current case, so the current case has to
 * still be on screen behind them.
 *
 * Two questions. The first grid moves the hurdle — what if we have to accept a
 * different yield? The second moves the estimate — what if the build costs more
 * and the flats let for less? Every cell is the same number, the most we can
 * pay for the land, so the two grids are directly comparable.
 */

/**
 * How a cell reads against the asking price.
 *
 * Red is this app's GO colour, so a cell that clears the ask takes a muted
 * Toro red and a cell that falls short takes amber — the same pairing the
 * verdict uses, at fill strength rather than text strength so a 5×5 of them
 * does not shout. With no asking price there is nothing to clear, and the
 * grid stays unshaded rather than inventing a threshold.
 */
function cellTone(
  value: number | null,
  askingPrice: number,
): "clears" | "short" | "none" {
  if (value === null || askingPrice <= 0) return "none";
  return value >= askingPrice ? "clears" : "short";
}

const TONE_CLASS: Record<"clears" | "short" | "none", string> = {
  clears: "bg-[color-mix(in_srgb,var(--toro-red)_22%,transparent)]",
  short: "bg-[color-mix(in_srgb,var(--maybe-fill)_22%,transparent)]",
  none: "",
};

/** The line under each grid. Hovering a cell replaces the current case. */
function Readout({
  cell,
  label,
}: {
  cell: ScenarioCell | null;
  label: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-line pt-2">
      <span className="micro leading-none">{label}</span>
      {cell === null ? (
        <span className="caption">—</span>
      ) : (
        <>
          <span className="text-sm text-ink-2">
            Max land{" "}
            <span className="num text-ink">{money(cell.maxLand)}</span>
          </span>
          <span className="text-sm text-ink-2">
            YoC on cost{" "}
            <span className="num text-ink">{percent(cell.yocOnCost)}</span>
          </span>
          <span className="text-sm text-ink-2">
            NOI <span className="num text-ink">{money(cell.totalNoi)}</span>
          </span>
          <span className="text-sm text-ink-2">
            Target blend{" "}
            <span className="num text-ink">{percent(cell.blendedYoc)}</span>
          </span>
        </>
      )}
    </div>
  );
}

interface SensitivityDrawerProps {
  open: boolean;
  onClose: () => void;
  dealName: string;
  firstLook: FirstLookResult;
  askingPrice: number;
  /** Per-cell detail for grid A, computed on hover by the page. */
  yocCellAt: (mfIndex: number, commIndex: number) => ScenarioCell | null;
  costRentGrid: CostRentGrid | null;
  costRentLoading: boolean;
  /** Which row of grid B is the case on the page right now. */
  currentMultiplier: number;
}

export function SensitivityDrawer({
  open,
  onClose,
  dealName,
  firstLook,
  askingPrice,
  yocCellAt,
  costRentGrid,
  costRentLoading,
  currentMultiplier,
}: SensitivityDrawerProps) {
  const [hoverA, setHoverA] = useState<[number, number] | null>(null);
  const [hoverB, setHoverB] = useState<[number, number] | null>(null);

  // Escape closes it. A drawer that can only be dismissed by finding a small
  // target is a drawer people leave open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const { commYocAxis, mfYocAxis, cells } = firstLook.sensitivity;
  const centre: [number, number] = [
    (mfYocAxis.length - 1) / 2,
    (commYocAxis.length - 1) / 2,
  ];

  const readoutA = hoverA
    ? yocCellAt(hoverA[0], hoverA[1])
    : yocCellAt(centre[0], centre[1]);

  const readoutB =
    costRentGrid && hoverB
      ? costRentGrid.cells[hoverB[0]][hoverB[1]]
      : (costRentGrid?.cells[
          costRentGrid.multipliers.indexOf(currentMultiplier) === -1
            ? 2
            : costRentGrid.multipliers.indexOf(currentMultiplier)
        ][2] ?? null);

  return (
    <>
      {/* Scrim dims the page without hiding it — the current case stays
          legible behind the grids, which is the whole point. */}
      <div
        className="fixed inset-0 z-40 bg-black/45"
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-label="Sensitivity"
        className="fixed right-0 z-50 flex flex-col border-l border-line-strong bg-surface shadow-[-16px_0_40px_rgba(0,0,0,0.45)]"
        style={{
          top: "var(--header-h)",
          bottom: 0,
          width: "min(760px, 88vw)",
        }}
      >
        <header className="flex items-baseline justify-between border-b border-line-strong bg-surface-2 px-5 py-3">
          <h2 className="section-head">Sensitivity</h2>
          <div className="flex items-baseline gap-4">
            <span className="caption">{dealName}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sensitivity"
              className="micro leading-none text-ink hover:text-[var(--toro-red)]"
            >
              Close ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <p className="caption mb-5">
            Every cell is the maximum land price at that scenario.{" "}
            {askingPrice > 0 ? (
              <>
                Shaded against the {money(askingPrice)} ask — red clears it,
                amber falls short.
              </>
            ) : (
              <>
                No asking price entered, so nothing is shaded: there is no
                threshold to colour against.
              </>
            )}
          </p>

          {/* ── Grid A — the hurdle ───────────────────────────────────── */}
          <section>
            <h3 className="bucket-head border-b border-line-strong pb-1">
              MF YoC × Commercial YoC
            </h3>

            <table className="mt-2 w-full border-collapse text-right">
              <thead>
                <tr>
                  <th className="micro w-24 py-2 pr-3 text-left">MF ╲ Comm</th>
                  {commYocAxis.map((comm, commIndex) => (
                    <th
                      key={comm}
                      className={cn(
                        "micro py-2 pr-3",
                        commIndex === centre[1] && "text-ink",
                      )}
                    >
                      {percent(comm, 2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mfYocAxis.map((mf, mfIndex) => (
                  <tr key={mf} className="border-t border-line">
                    <th
                      className={cn(
                        "micro py-1 pr-3 text-left",
                        mfIndex === centre[0] && "text-ink",
                      )}
                    >
                      {percent(mf, 2)}
                    </th>
                    {commYocAxis.map((comm, commIndex) => {
                      const value = cells[mfIndex][commIndex];
                      const isCurrent =
                        mfIndex === centre[0] && commIndex === centre[1];
                      return (
                        <td
                          key={comm}
                          onMouseEnter={() => setHoverA([mfIndex, commIndex])}
                          onMouseLeave={() => setHoverA(null)}
                          className={cn(
                            "num cursor-default py-1 pr-3 text-sm",
                            TONE_CLASS[cellTone(value, askingPrice)],
                            isCurrent &&
                              "outline outline-1 -outline-offset-1 outline-[var(--line-strong)] text-ink",
                          )}
                          style={{ height: "var(--row-h)" }}
                        >
                          {compact(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <Readout
              cell={readoutA}
              label={hoverA ? "Hovered" : "Current case"}
            />
            <p className="caption mt-1">
              Only the hurdle moves here, so NOI and yield on cost are the same
              in every cell — the target blend is what changes. Outlined cell is
              the current pair.
            </p>
          </section>

          {/* ── Grid B — the estimate ─────────────────────────────────── */}
          <section className="mt-8">
            <h3 className="bucket-head border-b border-line-strong pb-1">
              Cost multiplier × residential rent
            </h3>

            {costRentLoading && <p className="caption mt-2">Resolving five cost stacks…</p>}

            {costRentGrid?.error && (
              <p className="mt-2 border-l-[3px] border-l-maybe py-1 pl-3 text-sm text-maybe">
                {costRentGrid.error}
              </p>
            )}

            {costRentGrid && !costRentGrid.error && (
              <>
                <table className="mt-2 w-full border-collapse text-right">
                  <thead>
                    <tr>
                      <th className="micro w-24 py-2 pr-3 text-left">
                        Mult ╲ Rent
                      </th>
                      {costRentGrid.rentFactors.map((factor) => (
                        <th
                          key={factor}
                          className={cn(
                            "micro py-2 pr-3",
                            factor === 1 && "text-ink",
                          )}
                        >
                          {factor === 1
                            ? "base"
                            : `${factor > 1 ? "+" : "−"}${Math.round(
                                Math.abs(factor - 1) * 100,
                              )}%`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {costRentGrid.multipliers.map((multiplier, rowIndex) => (
                      <tr key={multiplier} className="border-t border-line">
                        <th
                          className={cn(
                            "micro py-1 pr-3 text-left",
                            multiplier === currentMultiplier && "text-ink",
                          )}
                          title={
                            costRentGrid.costExLand[rowIndex] === null
                              ? undefined
                              : `Cost ex-land ${money(
                                  costRentGrid.costExLand[rowIndex],
                                )}`
                          }
                        >
                          {multiplier.toFixed(2)}
                        </th>
                        {costRentGrid.rentFactors.map((factor, colIndex) => {
                          const cell = costRentGrid.cells[rowIndex][colIndex];
                          const isCurrent =
                            multiplier === currentMultiplier && factor === 1;
                          return (
                            <td
                              key={factor}
                              onMouseEnter={() => setHoverB([rowIndex, colIndex])}
                              onMouseLeave={() => setHoverB(null)}
                              className={cn(
                                "num cursor-default py-1 pr-3 text-sm",
                                TONE_CLASS[
                                  cellTone(cell?.maxLand ?? null, askingPrice)
                                ],
                                isCurrent &&
                                  "outline outline-1 -outline-offset-1 outline-[var(--line-strong)] text-ink",
                              )}
                              style={{ height: "var(--row-h)" }}
                            >
                              {cell === null ? "—" : compact(cell.maxLand)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Readout
                  cell={readoutB}
                  label={hoverB ? "Hovered" : "Current case"}
                />
                <p className="caption mt-1">
                  The multiplier re-resolves the whole cost stack on the server;
                  rent moves residential NOI only, so retail and office are held
                  where you set them. Row header carries that row&rsquo;s cost
                  ex-land.
                </p>
              </>
            )}
          </section>

          <p className="caption mt-8 pb-2">
            Nothing here is saved. Closing the drawer leaves the deal exactly as
            you set it.
          </p>
        </div>
      </aside>
    </>
  );
}
