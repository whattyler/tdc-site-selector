import type { NextRequest } from "next/server";

import { loadDeal } from "@/lib/deals/repository";

/** One deal, whole. Spec B4. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "DATABASE_URL is not set." }, { status: 503 });
  }

  const { id } = await context.params;

  try {
    const snapshot = await loadDeal(id);
    if (!snapshot) {
      return Response.json({ error: "No deal with that id." }, { status: 404 });
    }
    return Response.json(snapshot, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
