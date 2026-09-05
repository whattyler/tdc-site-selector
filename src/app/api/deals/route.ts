import type { NextRequest } from "next/server";

import { listPipeline, saveDeal } from "@/lib/deals/repository";
import type { DealSnapshot } from "@/lib/deals/snapshot";
import { currentActor } from "@/lib/deals/who";

/**
 * Deals. Spec B4, Phase 8.
 *
 * POST saves — creating when the snapshot carries no id and updating when it
 * does. GET lists the pipeline. Authentication is handled by proxy.ts; the
 * session is read here only to stamp who.
 */

export interface SaveDealResponse {
  id: string;
  updatedAt: string;
  updatedBy: string;
}

function missingDatabase() {
  return Response.json(
    {
      error:
        "DATABASE_URL is not set, so there is nowhere to save. Deals live in " +
        "page state until a database is configured.",
    },
    { status: 503 },
  );
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) return missingDatabase();

  let snapshot: DealSnapshot;
  try {
    snapshot = (await request.json()) as DealSnapshot;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (typeof snapshot?.deal?.name !== "string") {
    return Response.json(
      { error: "Snapshot must carry a deal." },
      { status: 400 },
    );
  }

  try {
    const who = await currentActor();
    const id = await saveDeal(snapshot, who);
    return Response.json(
      {
        id,
        updatedAt: new Date().toISOString(),
        updatedBy: who,
      } satisfies SaveDealResponse,
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET() {
  if (!process.env.DATABASE_URL) return missingDatabase();

  try {
    return Response.json(
      { deals: await listPipeline() },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
