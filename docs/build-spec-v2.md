# TDC Site Selector — Build Spec v2

One page. Address in, GO / NO-GO and a max land price out. Everything in the 2026 Deal Filter workbook, plus the parts the workbook makes you do by hand: find the site, pull demographics, build the cost stack, find comps.

v2 adds Part A: monorepo, hosting under the hub, OIDC to the demographics dashboard, and the deploy pipeline. Part B is the app itself (unchanged from v1 except Next.js 16 and the shared packages).

> **Build note (Sept 2026):** Part A is DEFERRED. Site Selector is being built standalone first (see CLAUDE.md). Part A remains here as the target shape for the later migration.

---

# PART A — Platform

## A1. Shape

The hub is a links page. It stays a links page. Site Selector is its own app, its own Vercel project, served under the hub's domain via a rewrite so it looks native. The demographics dashboard gets one API route. All three live in one repo.

```
tdc-tools/                          ← one GitHub repo, Turborepo
  apps/
    hub/                            ← existing links page, moved in as-is
    demographics/                   ← existing dashboard, moved in, + /api/score
    site-selector/                  ← new
  packages/
    ui/                             ← shadcn components, TDC theme, logo, fonts
    auth/                           ← NextAuth + Entra config, session helpers, role check
    scoring/                        ← demographics band logic + deal screen + first look (pure TS)
    db/                             ← Drizzle schema + client, shared by site-selector (and later others)
    oidc/                           ← verifyVercelOidc() helper used by any internal API route
    config/                         ← shared tsconfig, eslint, tailwind preset
  turbo.json
  pnpm-workspace.yaml
  package.json
  .github/workflows/ci.yml
```

Each `apps/*` is a separate Vercel project pointed at the same repo with a different Root Directory. Vercel's Turborepo integration skips the build when nothing in that app's dependency graph changed.

Other existing tools (the six on the hub) stay in their own repos until you next touch one. Then move it. Don't migrate everything in one weekend.

## A2. Domains and routing

| Project | Vercel project name | Root Directory | Served at |
|---|---|---|---|
| Hub | `tdc-hub` (existing) | `apps/hub` | `tools.<yourdomain>` |
| Demographics | `tdc-demographics` (existing) | `apps/demographics` | `demo.<yourdomain>` (own subdomain, also proxied) |
| Site Selector | `tdc-site-selector` | `apps/site-selector` | `tools.<yourdomain>/site-selector` |

Hub `next.config.ts`:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/site-selector",
        destination: `${process.env.SITE_SELECTOR_URL}/site-selector`,
      },
      {
        source: "/site-selector/:path*",
        destination: `${process.env.SITE_SELECTOR_URL}/site-selector/:path*`,
      },
      {
        source: "/demographics/:path*",
        destination: `${process.env.DEMOGRAPHICS_URL}/:path*`,
      },
    ];
  },
};
export default config;
```

Site Selector `next.config.ts` sets `basePath: "/site-selector"` so its internal links, assets and API routes all resolve under the prefix whether hit directly or through the hub. The rewrite target `SITE_SELECTOR_URL` is the project's production domain (`tdc-site-selector.vercel.app` or a custom one), set in the hub's env.

Multi-zone gotcha: hard navigations between zones (`<a href>`, not `<Link>`) — the hub links out to `/site-selector` with a plain anchor. Inside Site Selector, `<Link>` works normally.

## A3. Auth

One Entra app registration for the whole tools domain. `packages/auth` exports:

```ts
// packages/auth/src/index.ts
export { authOptions } from "./options";     // NextAuth v5, Microsoft Entra ID provider, tenant-restricted
export { auth } from "./options";            // server-side session getter
export { requireRole } from "./roles";       // requireRole(session, "admin")
export const ROLES = { admin: [...], user: "default" } // admin = list of UPNs from env ADMIN_UPNS
```

Every app mounts the same handler at `app/api/auth/[...nextauth]/route.ts` and adds a `proxy.ts` (Next 16 replaces `middleware.ts`) that redirects unauthenticated requests to sign-in:

```ts
// apps/site-selector/proxy.ts
import { auth } from "@tdc/auth";
export default auth((req) => {
  if (!req.auth && !req.nextUrl.pathname.startsWith("/site-selector/api/auth")) {
    const url = new URL("/site-selector/api/auth/signin", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(url);
  }
});
export const config = { matcher: ["/((?!_next|favicon.ico).*)"], runtime: "nodejs" };
```

Cookies: set `AUTH_URL` per app and use the same `AUTH_SECRET` across all three so a session on the hub is valid in Site Selector when proxied (same top-level domain). If you keep `demo.<yourdomain>` as a separate subdomain, set the cookie domain to `.<yourdomain>` in `authOptions`.

Retire the password gate on the hub. Keep it only on the Goose download page (that project doesn't move).

## A4. Site Selector → Demographics: OIDC, no shared secret

Dashboard side. New route in `apps/demographics/app/api/score/route.ts`:

```ts
import { verifyVercelOidc } from "@tdc/oidc";
import { scoreAddress } from "@/lib/score";   // the dashboard's existing scoring, refactored to a function

export async function GET(req: Request) {
  const caller = await verifyVercelOidc(req, {
    allowedProjects: ["tdc-site-selector"],   // project name claims
  });
  if (!caller.ok) return Response.json({ error: caller.reason }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const radius = Number(searchParams.get("radius") ?? 3);
  if (!address) return Response.json({ error: "address required" }, { status: 400 });

  const result = await scoreAddress(address, radius);
  // { mu, mf, population, metrics: [{key, value, weightMu, weightMf, floorHit}], version, pulledAt }
  return Response.json(result, { headers: { "cache-control": "private, max-age=0" } });
}
```

`packages/oidc`:

```ts
import * as jose from "jose";

const ISSUER = `https://oidc.vercel.com/${process.env.VERCEL_TEAM_SLUG}`;
const JWKS = jose.createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export async function verifyVercelOidc(
  req: Request,
  opts: { allowedProjects: string[]; allowedEnvs?: string[] },
) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer /, "");
  if (!token) return { ok: false as const, reason: "no token" };
  try {
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: `https://vercel.com/${process.env.VERCEL_TEAM_SLUG}`,
    });
    const project = payload.project as string;
    const env = payload.environment as string;
    if (!opts.allowedProjects.includes(project)) return { ok: false as const, reason: `project ${project} not allowed` };
    if (opts.allowedEnvs && !opts.allowedEnvs.includes(env)) return { ok: false as const, reason: `env ${env} not allowed` };
    return { ok: true as const, project, env, sub: payload.sub };
  } catch (e) {
    return { ok: false as const, reason: (e as Error).message };
  }
}
```

Site Selector side, in a server action or route:

```ts
import { getVercelOidcToken } from "@vercel/oidc";

export async function fetchDemographics(address: string, radius = 3) {
  const token = await getVercelOidcToken();
  const res = await fetch(
    `${process.env.DEMOGRAPHICS_URL}/api/score?address=${encodeURIComponent(address)}&radius=${radius}`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`demographics ${res.status}`);
  return res.json();
}
```

Setup once: Vercel → Team Settings → Security → enable OIDC Federation, issuer mode Team. Local dev: `vercel link` in `apps/site-selector`, then `vercel env pull` drops a 12-hour `VERCEL_OIDC_TOKEN` into `.env.local`. Re-pull when it expires.

Cache: Site Selector stores every result in `demographics` keyed on `(geohash7, radius, version)`. A second screen of the same site is instant, and the dashboard's version bump invalidates cleanly.

Deployment Protection: if the dashboard has Vercel Authentication on, the OIDC-authenticated call from Site Selector still gets blocked at the edge. Either scope protection to previews only, or add a Protection Bypass for Automation secret and send it as `x-vercel-protection-bypass` on that one call.

## A5. Next.js 16

New apps start on 16. Hub and dashboard get upgraded when they move in:

```
npx @next/codemod@canary upgrade latest
```

Rules for these apps:

| Item | Rule |
|---|---|
| Bundler | Turbopack, default. Nothing to do unless a webpack plugin is in `next.config` — remove it |
| `middleware.ts` | Rename to `proxy.ts`, export `proxy`, set `runtime: "nodejs"`. Auth lives here |
| Cache Components | Off. They're for content sites. These are live-calculating pages with per-user data. `cacheComponents: false` |
| React Compiler | On. Free memoization, no code change |
| Async request APIs | `params`, `searchParams`, `cookies()`, `headers()` are all awaited. Codemod handles it |
| Images | Not used. Leave `images.unoptimized` off, doesn't matter |

## A6. Database

Neon via Vercel Marketplace (this is what "Vercel Postgres" became). One Neon project for the monorepo, one database per app that needs one. Site Selector is the only one on day one.

Branching: turn on Neon branch per preview deployment in the Vercel integration. Preview builds get a copy-on-write branch of prod; nothing a preview does touches real deal data. Branches auto-delete when the preview is deleted.

Migrations: Drizzle. `pnpm --filter site-selector db:generate` locally, commit the SQL, and `db:migrate` runs as the first step of the Vercel build command for that app. Never run migrations from a laptop against prod.

## A7. Environment variables

Set manually in each Vercel project. Nothing goes in git.

**`tdc-hub`**

| Var | Value |
|---|---|
| `AUTH_SECRET` | shared, `openssl rand -base64 32` |
| `AUTH_URL` | `https://tools.<domain>` |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | from the app registration |
| `ADMIN_UPNS` | `tyler@…,allen@…` |
| `SITE_SELECTOR_URL` | `https://tdc-site-selector.vercel.app` |
| `DEMOGRAPHICS_URL` | `https://demo.<domain>` |

**`tdc-demographics`** — the three `AUTH_*`, `ADMIN_UPNS`, `VERCEL_TEAM_SLUG`, plus whatever it already has.

**`tdc-site-selector`**

| Var | Note |
|---|---|
| `AUTH_SECRET`, `AUTH_URL`, `AUTH_MICROSOFT_ENTRA_ID_*`, `ADMIN_UPNS` | same as above; `AUTH_URL` = `https://tools.<domain>/site-selector` |
| `DATABASE_URL` | injected by Neon integration |
| `DEMOGRAPHICS_URL` | `https://demo.<domain>` |
| `DEMOGRAPHICS_BYPASS_SECRET` | only if Deployment Protection is on there |
| `VERCEL_TEAM_SLUG` | for the OIDC issuer |
| `GOOGLE_MAPS_SERVER_KEY` | restricted by API (Geocoding, Places, Distance Matrix) and by IP if you pin one; used only in route handlers |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | restricted by HTTP referrer to `tools.<domain>/*` and the `.vercel.app` preview pattern; Maps JS only |
| `ANTHROPIC_API_KEY` | direct. Not AI Gateway |
| `REGRID_API_KEY` | optional, Phase 3b |
| `HQ_LAT`, `HQ_LNG` | TDC Alpharetta, for drive time |

Two Google keys on purpose. The browser key can only render maps; the server key can only be called from your functions.

## A8. CI and deploy

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck test --filter=...[origin/main]
```

`--filter=...[origin/main]` only runs the apps and packages that changed. A `packages/scoring` change runs its tests plus every app that depends on it.

> **Known bug:** on pushes to `main`, HEAD == origin/main so the filter is empty and nothing runs. Use `[HEAD^1]` for the push job and `[origin/main]` for PRs.

Vercel side, per project:

| Setting | Value |
|---|---|
| Framework | Next.js |
| Root Directory | `apps/<name>` |
| Build Command | leave default; for site-selector: `pnpm db:migrate && next build` |
| Ignored Build Step | `npx turbo-ignore` — skips deploy when the app's graph is unchanged |
| Node | 22 |
| Deployment Protection | Vercel Authentication on previews; off on production (Entra handles it) |
| Git → Deploy Hooks | none |
| Checks | Enable GitHub → Vercel required checks so a red `ci` blocks the production promote |

Branching rule for this repo, an exception to your main-only habit: anything touching `packages/scoring` or `cost_library` goes through a branch and a preview. Everything else, straight to main, fast-forward. The preview is the review; you don't need PR ceremony beyond that.

Turn on Vercel Agent PR review on the repo. It's cheap and it catches the boring stuff before you look.

Do not use Vercel AI Gateway for the Anthropic calls. Same failure shape as the Tetrate router.

## A9. Local dev

```
git clone … tdc-tools && cd tdc-tools
pnpm install
cd apps/site-selector && vercel link && vercel env pull .env.local && cd ../..
pnpm turbo dev --filter=site-selector    # http://localhost:3000/site-selector
```

Local hits the production dashboard via OIDC with the pulled dev token. Local DB is a Neon dev branch — create one named `dev-tyler` and put its URL in `.env.local` over the pulled one.

## A10. Migration order

| Step | What | Time |
|---|---|---|
| 1 | Create `tdc-tools` repo, Turborepo scaffold, `packages/config` | 1 hr |
| 2 | `git subtree add` the hub into `apps/hub`. Repoint the `tdc-hub` Vercel project at the new repo with Root Directory `apps/hub`. Deploy. Nothing else changes yet | 1 hr |
| 3 | Same for the demographics dashboard → `apps/demographics` | 1 hr |
| 4 | `packages/auth` with Entra. Wire into hub. Remove the password gate. Deploy | 3 hr |
| 5 | Wire `packages/auth` into demographics. Deploy | 1 hr |
| 6 | `packages/oidc`; `/api/score` on the dashboard, refactoring its scoring into `scoreAddress()`. Deploy. `curl` it with a pulled dev token to prove it | 3 hr |
| 7 | Move demographics band logic into `packages/scoring`; dashboard imports it back | 2 hr |
| 8 | Upgrade hub and dashboard to Next 16 via codemod. Deploy each | 2 hr |
| 9 | Scaffold `apps/site-selector`, new Vercel project, Neon, rewrites in the hub | 2 hr |

About two working days before Part B Phase 0 starts. Each step ends with a working deploy; you can stop anywhere.

---

# PART B — The app

## B0. Two gates

| Gate | Source | Question | Output |
|---|---|---|---|
| 1 | John Kelley's 2026 Toro Deal Filter (docs/john_deal_filter.xlsx) | Is this a Toro deal? 19 criteria, four buckets, Yes/Maybe/No, knockouts, 25% unknown ceiling | GO / MAYBE / NO-GO / INCOMPLETE |
| 2 | Tyler's First Look UW | Does the math work? Demographics, program, cost stack, comps, residual land | Max land price, land test vs ask (CLEAR / SHORT) |
| Both | — | DOUBLE GO | The land price we'd pay |

Rules:
- Gate 1 uses John's 19 criteria, his four bucket names, and his labels verbatim. Do not rename. Weights, KO flags and thresholds sit underneath, from `assumptions`.
- Gate 2 does not run on a Gate 1 NO-GO. It runs on GO, MAYBE and INCOMPLETE.
- Verdict panel leads with three lines: Gate 1 verdict · Gate 2 land test · Combined. Everything else is drawer detail.

## B1. What this is and isn't

The workbook already has the logic: 19 weighted criteria, five knockouts, 25% unknown ceiling, component-blended YoC, residual land with 5.5% carry, pad sale add-backs, TDC land-rate sanity check, MF×Comm sensitivity grid. Port all of that exactly, as pure functions in `packages/scoring`, and test it against the workbook. That's the spine.

| Gap in the workbook | Site Selector |
|---|---|
| First Look asks for NOI and cost ex-land as typed inputs | Builds both from a program, a cost library and a rent set |
| Demographics score typed from the dashboard | Pulled from the dashboard by address (A4) |
| Geography answered by hand | Drive time from Alpharetta computed, criterion pre-answered |
| Competition / Market answered from memory | Nearby apartment and retail comps mapped and listed |
| Costs are whatever you remember | Line-item library from Medley and Overlook/CCC, source and multiplier per line, budgets never exposed |
| One deal at a time, paste to Pipeline | Every screen saved; pipeline is a view |

This is a first look, not the proforma tool. Separate project. They share `cost_library` later; nothing else.

## B2. Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 App Router, TS, Tailwind, shadcn from `packages/ui` |
| DB | Neon Postgres + Drizzle, schema in `packages/db` |
| Auth | `packages/auth` (Entra). Roles: `admin` / `user` |
| Maps | Google Maps Platform: Geocoding, Places (Nearby + Details), Distance Matrix, Maps JS. Server key in route handlers only |
| Parcel | Regrid API, optional (Phase 3b). Otherwise acreage typed |
| Demographics | `/api/score` on the dashboard over OIDC (A4) |
| AI | Anthropic API, direct. Comp rent drafting, memo prose. Never in the scoring path |
| PDF | `@react-pdf/renderer` |
| Tests | Vitest, golden cases from the workbook |

## B3. The page

```
┌──────────────────────────────────────────────┬─────────────────────────┐
│ 1  SITE                                       │  VERDICT (sticky)       │
│    address ▸ geocode ▸ map, parcel, acreage   │  MU 84  ·  MF 71        │
│    drive time from HQ, jurisdiction           │  Band: GO               │
│                                               │  Screen: 73  GO         │
│ 2  DEMOGRAPHICS                               │  KO: PASS  Unk: 12%     │
│    pulled from dashboard, metrics table       │  ───────────────        │
│    band per product type                      │  Blended YoC 6.9%       │
│                                               │  Cost ex-land $84.2M    │
│ 3  PROGRAM                                    │  NOI $6.1M              │
│    resi units + mix, retail, office, parking  │  Max land  $9.4M        │
│    pads (hotel keys, TH lots, outparcels)     │  $/unit 31k · $/ac 2.2M │
│                                               │  Ask $11.0M  (−15%)     │
│ 4  COSTS                                      │  Land test: SHORT       │
│    line items × [Medley | CCC | Custom] × mult│  ───────────────        │
│    global multiplier, escalation to today     │  [Sensitivity] [PDF]    │
│                                               │  [Save to pipeline]     │
│ 5  REVENUE & COMPS                            │                         │
│    comps map + table, rent/SF per component   │                         │
│                                               │                         │
│ 6  DEAL SCREEN                                │                         │
│    17 questions, Yes/Maybe/No, KO flags       │                         │
│    probability, notes per criterion           │                         │
└──────────────────────────────────────────────┴─────────────────────────┘
```

Criteria: John's 19, verbatim, in his four buckets.

| Bucket | Criteria |
|---|---|
| Real Estate Considerations | Demographics (computed), Geography (pre-filled from drive time, overridable), Market, Location |
| Site Considerations | Barriers to Entry, Entitlements, Competition, Physical |
| Deal Considerations | Seller Sophistication, Control, Market viability of all products, Partner Quality, Pursuit costs, Timing, Probability |
| Toro Considerations | Brand fit, Capability, Capacity, Fee Potential |

Probability: Tyler's workbook decides whether this is a Yes/Maybe/No criterion or the 0.5–1.0 slider. Follow the Deal Screen tab, not this doc.

## B4. Data model (`packages/db`)

```
deals            id, name, address, lat, lng, geohash7, acreage, jurisdiction, submarket,
                 product_type (auto | mixed_use | multifamily), asking_price,
                 created_by, created_at, updated_at, status
demographics     deal_id, mu_score, mf_score, population_3mi, radius_mi,
                 metrics jsonb, pulled_at, dashboard_version, source (api | manual)
programs         deal_id, resi_units, unit_mix jsonb, resi_nrsf, resi_gsf,
                 retail_sf, office_sf, parking_spaces, parking_type,
                 hotel_keys, th_lots, outparcels, stories, construction_type
cost_lines       deal_id, line_key, source (medley|ccc|custom), multiplier,
                 custom_rate, resolved_rate, resolved_amount
revenue          deal_id, resi_rent_psf_mo, retail_rent_psf, office_rent_psf,
                 vacancy jsonb, opex_per_unit, nonrecov_psf, rent_source
comps            deal_id, place_id, name, type (apartment|retail|office),
                 lat, lng, distance_mi, year_built, units, rent_psf,
                 rent_source, ai_draft boolean, include boolean
screen_answers   deal_id, criterion_key, answer (yes|maybe|no|null),
                 note, answered_by
screen_results   deal_id, weighted_score, unknown_share, ko_pass,
                 demo_band, verdict, prob, prob_weighted, computed_at

cost_library     line_key, label, basis (per_resi_gsf | per_retail_sf | per_office_sf
                 | per_space | per_unit | pct_hard | pct_total | lump),
                 medley_rate, medley_asof, ccc_rate, ccc_asof, notes
                 -- ADMIN ONLY. Never serialized to the client.
cost_library_log who, when, line_key, field, old, new
assumptions      key, value, source, asof      -- yields, land conventions, pads,
                                               -- thresholds, weights, geography bands,
                                               -- escalation rate. Mirrors the Assumptions tab.
```

## B5. Sections

### 1 · Site

Address → Geocoding → lat/lng, formatted address, county, city, geohash. Map with pin. Distance Matrix from `HQ_LAT/LNG` (drive time, peak and off-peak) → shown in the panel and pre-fills Geography from `assumptions` bands (`≤30 = Yes`, `30–45 = Maybe`, `>45 = No`). Jurisdiction from geocode components. Acreage typed, or Regrid if on. Asking price typed.

**Satellite aerial.** Top-right of the Deal section, Maps JS in `satellite` view centred on the geocoded pin. Scrollable — scroll to zoom, drag to pan — so the shape of the parcel and what surrounds it can be read without leaving the page. A click-out link opens the same coordinates in Google Maps in a new tab (`target="_blank" rel="noopener noreferrer"`) for anything the embed cannot do: Street View, measuring, directions. Browser key only, referrer-restricted, Maps JS alone — the server key never reaches the client. Phase 3.

### 2 · Demographics

`fetchDemographics()` per A4, cached on `(geohash7, radius, version)`. Store mu, mf, population, and the nine metrics with weights so the page shows why. Bands from `assumptions`. Governing score follows product type exactly as the workbook does. Calibration chips: Avalon 100/85, Carmel 101/85, Medley 93/80, Overlook 16/55. If the call fails, fields become editable and `source = manual`. Never silently zero.

### 3 · Program

Units, mix with avg NSF, NRSF, GSF or efficiency, retail SF, office SF, parking spaces and type, stories, construction type, pads. Inline cross-checks: units × NSF ≈ NRSF; efficiency 0.78–0.86; parking ratio; FAR vs acreage.

### 4 · Costs

`cost_library` holds one row per line with a Medley rate and a CCC rate, each with basis and as-of. Suggested lines (finalize from the budgets):

| line_key | basis |
|---|---|
| resi_shell | per_resi_gsf |
| resi_interiors | per_resi_gsf |
| resi_mep | per_resi_gsf |
| retail_shell | per_retail_sf |
| retail_ti_allowance | per_retail_sf |
| office_shell | per_office_sf |
| parking_structured | per_space |
| parking_surface | per_space |
| sitework_utilities | per_unit or lump |
| hardscape_landscape_placemaking | per_unit or lump |
| gc_fee_gcs | pct_hard |
| hard_contingency | pct_hard |
| ae_design | pct_hard |
| permits_impact_fees | per_unit |
| dev_fee | pct_total |
| legal_title_closing | lump |
| marketing_leaseup | per_unit |
| financing_carry | pct_total |
| soft_contingency | pct_hard |

Per line the user sees: label · source `[Medley | CCC | Custom]` · multiplier `[0.90, 0.925, 0.95, 0.975, 1.00, 1.025, 1.05, 1.075, 1.10]` · resolved rate · resolved amount. Never: the library table, the other project's rate, any project totals. The server resolves and returns only resolved numbers.

Decision: the resolved rate is visible. Without it nobody can sanity-check a line. Hide-from-`user` is a flag, opt-in. (Note: resolved rate at multiplier 1.00 back-derives the library rate — treat the wall as friction, not security. Access control is the real control.)

Global multiplier on top (default 1.00). Escalation: `as_of` + annual escalation from `assumptions` brings Medley (2022–24) and CCC (2025) to today before the multiplier. Skip this and the Medley toggle is 10–15% light every time.

Cost ex-land = Σ resolved lines → First Look.

Admin editor at `/admin/cost-library`, `requireRole("admin")`, every save writes `cost_library_log`.

### 5 · Revenue & comps

Places Nearby around the pin: apartments within 3 mi, retail within 3 mi. Each → comp row with name, distance, place_id, include checkbox. Rent is not something Google returns:

- Manual from CoStar. Default.
- AI draft: one button sends included comp names to Claude with web search, asks for advertised rents with source URLs, writes rows flagged `ai_draft`. Excluded from NOI until confirmed.

```
resi NOI   = units × avg NSF × rent/SF/mo × 12 × (1 − vac) − units × opex/unit
retail NOI = GLA × NNN rent × (1 − vac) − GLA × non-recoverable/SF
office NOI = RSF × rent × (1 − vac) − RSF × non-recoverable/SF
```

### 6 · Deal screen

17 questions, four buckets, weights and KO flags from `assumptions`. Yes / Maybe / No control, note, who answered. Demographics row computed. Geography pre-filled, overridable. Probability slider 0.5–1.0. Everything the workbook does — 3/1/0, weighted score, unknown share, KO, band override, INCOMPLETE ceiling — in `packages/scoring/screen.ts`.

### Verdict panel

Live. Top three lines, always visible:

```
GATE 1   GO          (screen 73 · KO pass · unk 12%)
GATE 2   SHORT       (max land $9.4M vs ask $11.0M, −15%)
         ————
         NO — land
```

Combined states: `DOUBLE GO` · `GO — land short` · `MAYBE` · `INCOMPLETE` · `NO-GO` (Gate 2 not run).

Below the fold: MU/MF, band, weighted score, KO, unknown share, blended YoC, NOI, cost ex-land, max land, $/unit, $/acre, land at TDC rates, gap vs ask. Sensitivity drawer: MF YoC × Comm YoC (workbook's) and cost multiplier × rent (new).

## B6. `packages/scoring`

Pure TypeScript. No React, no DB, no fetch.

```
screen.ts        weightedScore, unknownShare, koCheck, verdict
firstLook.ts     componentSupport, padProceeds, maxLandPrice,
                 landAtTdcRates, productTypeTest, sensitivityGrid
costs.ts         resolveLine, escalate, costExLand
revenue.ts       componentNoi
demographics.ts  band, governingScore        ← also imported by apps/demographics
```

Golden tests: fill the workbook for three real deals (one GO, one NO-GO via knockout, one INCOMPLETE), save every output cell, assert the engine reproduces them. For NOI and cost buildup, the golden is your back-of-envelope, written down first.

## B7. Phases

| # | Phase | Deliverable | Days |
|---|---|---|---|
| A | Platform | A10 migration, steps 1–9 (DEFERRED) | 2 |
| 0 | Setup | Scaffold, Neon, `assumptions` seeded from the workbook | 1 |
| 1 | Engine | `packages/scoring` ported, golden tests green | 2 |
| 2 | Screen page | Section 6 + verdict panel, manual demographics. Ship | 2 |
| 3 | Site | Geocode, map, drive time, Geography pre-fill. 3b Regrid | 1–2 |
| 4 | Demographics | Wire A4, metric table, manual fallback, cache | 1 |
| 5 | Costs | Library, admin editor, resolver, escalation, multipliers, log | 2 + a day of pulling rates |
| 6 | Revenue & comps | Places, comp table, NOI, AI draft | 2 |
| 7 | First Look wired | Cost and NOI into residual; sensitivity drawer | 1 |
| 8 | Output | PDF, pipeline view, save/compare | 2 |
| 9 | Harden | Roles audit, Maps rate limits, log drain | 1 |

Ship after 2, again after 5.

## B8. Where it'll bite

| Risk | Note |
|---|---|
| Rent comps | Google finds buildings, not rents. CoStar manual is the honest default |
| Cost library prep | Only Tyler can pull ~20 clean line rates from two budgets. Before Phase 5, not during |
| Escalation | Skip it and the Medley toggle is wrong every time |
| Multi-zone cookies | Session must be valid through the hub proxy. Test sign-in via `tools.<domain>/site-selector` first, not the `.vercel.app` URL |
| Deployment Protection on the dashboard | Blocks the OIDC call at the edge. Scope it to previews or use the bypass header |
| Product type | Workbook derives from retail share of NOI but lets you override. Keep both; warn on disagreement |
| Scope creep | First Look only. Draw schedules and phasing are the other project |
