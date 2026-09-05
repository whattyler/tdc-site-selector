import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderToBuffer } from "@react-pdf/renderer";
import type { NextRequest } from "next/server";

import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { loadCostLibrary } from "@/lib/costs/library-source";
import { evaluateSnapshot } from "@/lib/deals/evaluate";
import { loadDeal } from "@/lib/deals/repository";
import { currentActor } from "@/lib/deals/who";
import {
  FirstLookDocument,
  registerFonts,
} from "@/lib/pdf/first-look-document";

/**
 * The First Look PDF. Spec B5 §7, Phase 8.
 *
 * Generated from the deal's saved inputs against today's assumptions, not from
 * the verdicts stored alongside them — a report that quietly reprints a stale
 * number is worse than no report.
 *
 * The aerial is fetched here with the server key. It never reaches the browser,
 * which is the whole reason this is a route rather than a client-side render.
 */

/** Static Maps, satellite, one marker on the site. */
async function fetchAerial(
  lat: number,
  lng: number,
): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  const url =
    "https://maps.googleapis.com/maps/api/staticmap" +
    `?center=${lat},${lng}` +
    "&zoom=17&size=640x414&scale=2&maptype=satellite&format=png" +
    `&markers=color:0xC7202E%7C${lat},${lng}` +
    `&key=${encodeURIComponent(key)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    // Static Maps answers an error with a PNG of the error text, which would
    // land in the report looking like a map. A tiny body is that.
    if (buffer.byteLength < 2048) return null;
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function readLogo(): Promise<string | null> {
  try {
    const file = await readFile(
      path.join(process.cwd(), "public", "toro-logo-red.png"),
    );
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null;
  }
}

/** `medley-first-look-2026-09-05.pdf` */
function filename(name: string, when: Date): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "deal";
  return `${slug}-first-look-${when.toISOString().slice(0, 10)}.pdf`;
}

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

    const [{ assumptions, origin }, { library }, generatedBy] = await Promise.all([
      loadAssumptionsForRequest(),
      loadCostLibrary(),
      currentActor(),
    ]);

    const evaluated = evaluateSnapshot(snapshot, assumptions, library);

    const [aerial, logo] = await Promise.all([
      snapshot.deal.lat !== null && snapshot.deal.lng !== null
        ? fetchAerial(snapshot.deal.lat, snapshot.deal.lng)
        : Promise.resolve(null),
      readLogo(),
    ]);

    registerFonts();
    const generatedAt = new Date();

    const buffer = await renderToBuffer(
      FirstLookDocument({
        snapshot,
        evaluated,
        assumptions,
        aerial,
        logo,
        assumptionsOrigin: origin,
        generatedAt,
        generatedBy,
      }),
    );

    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename(
          snapshot.deal.name,
          generatedAt,
        )}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
