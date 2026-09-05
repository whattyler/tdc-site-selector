import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

/**
 * AI rent draft. Spec B5 §5.
 *
 * Takes the comps the user ticked, asks Claude to go and find their currently
 * advertised asking rents on the web, and returns a suggested rent per
 * component with the URL it came from.
 *
 * Everything this returns is a draft. The client flags it `ai_draft` and keeps
 * it out of the NOI until a human confirms each row — which is why every draft
 * carries its sources: a number nobody can trace is a number nobody should
 * underwrite.
 *
 * Direct Anthropic API, per CLAUDE.md. No gateway, no proxy.
 */

const MODEL = "claude-opus-5";

/** The three rent fields the Revenue section will take a draft for. */
const DRAFT_FIELDS = [
  "resiRentPsfMo",
  "retailRentPsf",
  "officeRentPsf",
] as const;

export type RentDraftField = (typeof DRAFT_FIELDS)[number];

export interface RentDraftSource {
  label: string;
  url: string;
}

export interface RentDraft {
  field: RentDraftField;
  value: number;
  unit: string;
  /** One line on how the number was arrived at. Shown under the draft. */
  basis: string;
  confidence: "high" | "medium" | "low";
  sources: RentDraftSource[];
}

export interface RentDraftRequest {
  comps: { name: string; address: string | null; type: string }[];
  /** Submarket or address, for context. Not used to widen the search. */
  market?: string;
}

export interface RentDraftResponse {
  drafts: RentDraft[];
  /** Anything Claude wanted to say that is not a number. Shown as a caption. */
  notes: string | null;
  model: string;
}

const UNITS: Record<RentDraftField, string> = {
  resiRentPsfMo: "$/SF/month",
  retailRentPsf: "$/SF/year NNN",
  officeRentPsf: "$/SF/year",
};

function buildPrompt(body: RentDraftRequest): string {
  const list = body.comps
    .map((comp, index) => {
      const address = comp.address ? ` — ${comp.address}` : "";
      return `${index + 1}. ${comp.name} (${comp.type})${address}`;
    })
    .join("\n");

  return `You are helping underwrite a mixed-use development${
    body.market ? ` in ${body.market}` : ""
  }. Below are nearby comparable properties.

${list}

Search the web for each one and find its CURRENTLY ADVERTISED ASKING RENT.
Prefer the property's own website, then a listing site (apartments.com,
Zillow, LoopNet, Crexi, CoStar, a leasing brochure). Note the date if the page
carries one.

Then propose one rent for each of these three fields, using only what you
actually found:

- resiRentPsfMo — apartment asking rent in dollars per square foot per MONTH.
  Listing sites quote a monthly rent for a unit; divide by that unit's square
  footage to get $/SF/month. Do not report the unit rent.
- retailRentPsf — retail asking rent in dollars per square foot per YEAR, NNN
  (base rent only, excluding CAM/tax/insurance).
- officeRentPsf — office asking rent in dollars per square foot per YEAR.

Rules:
- Omit a field entirely if you did not find real advertised rents for it. A
  missing field is correct and useful; an invented one is not.
- Every draft must carry at least one source URL you actually opened.
- \`basis\` says in one line what the number is (e.g. "median of 3 advertised
  1BR/2BR rents at two comps, Sept 2026").
- \`confidence\`: high = several current listings agree; medium = one or two
  listings, or a wide spread; low = stale, indirect, or a single data point.

When you are done searching, reply with ONE fenced JSON block and nothing after
it, in exactly this shape:

\`\`\`json
{
  "drafts": [
    {
      "field": "resiRentPsfMo",
      "value": 2.35,
      "unit": "$/SF/month",
      "basis": "...",
      "confidence": "medium",
      "sources": [{ "label": "Prelude at Medley — apartments.com", "url": "https://..." }]
    }
  ],
  "notes": "anything that matters and is not a number, or null"
}
\`\`\``;
}

/**
 * Pull the JSON object out of the reply.
 *
 * Web search turns interleave prose and citations, so the object is found
 * rather than assumed: last fenced block first, then the last balanced object
 * in the text.
 */
function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of fenced.reverse()) {
    try {
      return JSON.parse(match[1]);
    } catch {
      // Try the next block down.
    }
  }

  const end = text.lastIndexOf("}");
  for (let start = text.indexOf("{"); start !== -1 && start < end; ) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      start = text.indexOf("{", start + 1);
    }
  }
  return null;
}

function coerceDrafts(payload: unknown): { drafts: RentDraft[]; notes: string | null } {
  if (typeof payload !== "object" || payload === null) {
    return { drafts: [], notes: null };
  }
  const record = payload as { drafts?: unknown; notes?: unknown };
  const raw = Array.isArray(record.drafts) ? record.drafts : [];

  const drafts: RentDraft[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const draft = item as Record<string, unknown>;
    const field = draft.field;
    const value = Number(draft.value);

    if (!DRAFT_FIELDS.includes(field as RentDraftField)) continue;
    if (!Number.isFinite(value) || value <= 0) continue;

    const sources = Array.isArray(draft.sources)
      ? draft.sources
          .map((source) => source as Record<string, unknown>)
          .filter((source) => typeof source?.url === "string")
          .map((source) => ({
            label:
              typeof source.label === "string" && source.label.trim() !== ""
                ? source.label
                : new URL(String(source.url)).hostname,
            url: String(source.url),
          }))
      : [];

    // No URL, no draft: an untraceable number is the thing this route exists
    // to avoid.
    if (sources.length === 0) continue;

    drafts.push({
      field: field as RentDraftField,
      value,
      unit: UNITS[field as RentDraftField],
      basis: typeof draft.basis === "string" ? draft.basis : "",
      confidence:
        draft.confidence === "high" || draft.confidence === "low"
          ? draft.confidence
          : "medium",
      sources,
    });
  }

  return {
    drafts,
    notes: typeof record.notes === "string" && record.notes.trim() !== ""
      ? record.notes
      : null,
  };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  let body: RentDraftRequest;
  try {
    body = (await request.json()) as RentDraftRequest;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.comps) || body.comps.length === 0) {
    return Response.json(
      { error: "Include at least one comp before drafting rents." },
      { status: 400 },
    );
  }
  if (body.comps.length > 25) {
    return Response.json(
      { error: "Drafting is capped at 25 comps per run." },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  try {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: buildPrompt(body) },
    ];

    // Streamed because a web-search turn is long enough to hit the default
    // request timeout, and resumed on pause_turn because a paused turn
    // otherwise returns as a silently truncated answer.
    let final: Anthropic.Message | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 32_000,
        thinking: { type: "adaptive" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 15 }],
        messages,
      });
      final = await stream.finalMessage();
      if (final.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: final.content });
    }

    if (!final) {
      return Response.json({ error: "No response from Claude." }, { status: 502 });
    }
    if (final.stop_reason === "refusal") {
      return Response.json(
        {
          error:
            "Claude declined this request" +
            (final.stop_details?.explanation
              ? `: ${final.stop_details.explanation}`
              : "."),
        },
        { status: 502 },
      );
    }

    const text = final.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const parsed = extractJson(text);
    if (parsed === null) {
      return Response.json(
        { error: "Claude replied without a JSON block. Try again." },
        { status: 502 },
      );
    }

    const { drafts, notes } = coerceDrafts(parsed);

    return Response.json(
      { drafts, notes, model: final.model } satisfies RentDraftResponse,
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY was rejected." },
        { status: 502 },
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json(
        { error: "Anthropic rate limit hit. Try again in a moment." },
        { status: 502 },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
