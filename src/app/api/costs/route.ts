import type { NextRequest } from "next/server";

import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { loadCostLibrary } from "@/lib/costs/library-source";
import {
  type CostProgram,
  type CostResolution,
  CostResolutionError,
  type CostSelection,
  resolveCosts,
} from "@/lib/scoring";

/**
 * Resolve the cost stack for a program. Spec B5 §4.
 *
 * POST because the program and the per-line selections are a body, not a query
 * string. Authentication is handled by proxy.ts.
 *
 * The response carries resolved rates and amounts only. The library rows —
 * Medley's and CCC's actual pricing — never leave the server. A resolved rate
 * at multiplier 1.00 does back-derive the library rate, which the spec calls
 * friction rather than security; access control is the real control.
 */

export interface CostsRequest {
  program: CostProgram;
  selections: CostSelection[];
  globalMultiplier: number;
  /**
   * The date every library rate is escalated to, as YYYY-MM-DD. Absent means
   * today. Deal-level rather than per-line: it is a statement about when this
   * deal is being priced, not about any one rate.
   */
  pricingDate?: string;
}

export type CostsResponse = CostResolution & { libraryOrigin: string };

/** Every quantity the bases draw from. Derived from the type, so a new field
 *  cannot be added to `CostProgram` and quietly skip validation. */
const PROGRAM_KEYS: (keyof CostProgram)[] = [
  "resiUnits",
  "resiGsf",
  "retailSf",
  "officeSf",
  "parkingStructuredSpaces",
  "parkingSurfaceSpaces",
  "acreage",
];

function isProgram(value: unknown): value is CostProgram {
  if (typeof value !== "object" || value === null) return false;
  const program = value as Record<string, unknown>;
  return PROGRAM_KEYS.every(
    (key) => typeof program[key] === "number" && Number.isFinite(program[key]),
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const payload = body as Partial<CostsRequest>;
  if (!isProgram(payload.program)) {
    return Response.json(
      { error: "program must carry finite numbers for every quantity." },
      { status: 400 },
    );
  }

  // Parsed as UTC midnight so the same string gives the same escalation
  // wherever the server happens to be.
  const pricingDate =
    payload.pricingDate && /^\d{4}-\d{2}-\d{2}$/.test(payload.pricingDate)
      ? new Date(`${payload.pricingDate}T00:00:00Z`)
      : new Date();
  if (Number.isNaN(pricingDate.getTime())) {
    return Response.json(
      { error: "pricingDate must be YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const globalMultiplier = payload.globalMultiplier ?? 1;
  if (!Number.isFinite(globalMultiplier) || globalMultiplier <= 0) {
    return Response.json(
      { error: "globalMultiplier must be a positive number." },
      { status: 400 },
    );
  }

  try {
    const [{ assumptions }, { library, origin }] = await Promise.all([
      loadAssumptionsForRequest(),
      loadCostLibrary(),
    ]);

    const resolution = resolveCosts(
      library,
      payload.selections ?? [],
      payload.program,
      globalMultiplier,
      assumptions,
      pricingDate,
    );

    return Response.json(
      { ...resolution, libraryOrigin: origin } satisfies CostsResponse,
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    // A line with no rate that the program gave a quantity. Surface it as an
    // error rather than costing the deal at zero for that line.
    if (error instanceof CostResolutionError) {
      return Response.json(
        { error: error.message, lineKey: error.lineKey },
        { status: 422 },
      );
    }
    return Response.json(
      {
        error: `Cost resolution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
