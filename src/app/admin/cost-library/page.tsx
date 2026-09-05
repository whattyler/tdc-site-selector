import { Fragment } from "react";

import { auth, requireRole } from "@/lib/auth";
import { loadCostLibrary } from "@/lib/costs/library-source";
import { money } from "@/lib/format";
import { BASIS_LABEL } from "@/lib/scoring";

/**
 * Cost library editor. Spec B5 §4, admin only.
 *
 * This is the one place library rates are visible. `requireRole("admin")`
 * throws before any row is read, and the check is here as well as in proxy.ts
 * because this page is the whole reason the rule exists.
 *
 * Read-only for now: seeing the library and its provenance is the useful half,
 * and every save has to write `cost_library_log`, which needs the database
 * that Phase 8 provisions.
 */
export default async function CostLibraryPage() {
  const session = await auth();
  requireRole(session, "admin");

  const { library, origin } = await loadCostLibrary();
  const ordered = [...library].sort((a, b) => a.sortOrder - b.sortOrder);
  const unpriced = ordered.filter((l) => l.medleyRate === null && l.cccRate === null);

  return (
    <main
      className="mx-auto flex-1 px-6 py-6"
      style={{ maxWidth: "var(--content-max)" }}
    >
      <header className="mb-4 flex items-baseline justify-between border-b border-line-strong pb-2">
        <h1 className="section-head">Cost library · admin</h1>
        <span className="caption">
          {ordered.length} lines · {origin}
        </span>
      </header>

      <p className="caption mb-4 max-w-[52rem]">
        Library rates never reach the screen page. It receives resolved rates and
        amounts only. Editing writes <code className="text-ink">cost_library_log</code>{" "}
        and lands with the database in Phase 8.
      </p>

      {unpriced.length > 0 && (
        <p className="mb-4 border-l-[3px] border-l-maybe py-1 pl-3 text-sm text-maybe">
          {unpriced.length} line{unpriced.length === 1 ? "" : "s"} carry no rate on
          either source and will throw if a program gives them a quantity:{" "}
          {unpriced.map((l) => l.lineKey).join(", ")}.
        </p>
      )}

      <table className="w-full border-collapse border border-line bg-surface text-left">
        <thead>
          <tr className="border-b border-line-strong bg-surface-2">
            <th className="micro px-3 py-2">Line</th>
            <th className="micro px-3 py-2">Basis</th>
            <th className="micro px-3 py-2">Rolls into</th>
            <th className="micro px-3 py-2">% of</th>
            <th className="micro num px-3 py-2">Medley</th>
            <th className="micro px-3 py-2">as of</th>
            <th className="micro num px-3 py-2">CCC</th>
            <th className="micro px-3 py-2">as of</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((line, index) => {
            const pct = line.basis.startsWith("pct_");
            const rate = (value: number | null) =>
              value === null ? "—" : pct ? `${(value * 100).toFixed(2)}%` : money(value);
            return (
              <Fragment key={line.lineKey}>
                <tr
                  className={index % 2 === 1 ? "bg-surface-2" : "bg-surface"}
                >
                  <td className="px-3 py-1.5 text-ink">
                    {line.label}
                    <span className="caption ml-2">{line.lineKey}</span>
                  </td>
                  <td className="px-3 py-1.5 text-sm text-ink">
                    {BASIS_LABEL[line.basis]}
                  </td>
                  <td className="px-3 py-1.5 text-sm text-ink">{line.category}</td>
                  <td className="px-3 py-1.5 text-sm text-ink-3">
                    {line.appliesTo ?? "—"}
                  </td>
                  <td className="num px-3 py-1.5 text-sm">{rate(line.medleyRate)}</td>
                  <td className="px-3 py-1.5 text-sm text-ink-3">
                    {line.medleyAsof ?? "—"}
                  </td>
                  <td className="num px-3 py-1.5 text-sm">{rate(line.cccRate)}</td>
                  <td className="px-3 py-1.5 text-sm text-ink-3">
                    {line.cccAsof ?? "—"}
                  </td>
                </tr>
                {line.notes && (
                  <tr
                    className={index % 2 === 1 ? "bg-surface-2" : "bg-surface"}
                  >
                    <td className="caption px-3 pb-2" colSpan={8}>
                      ↳ {line.notes}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
