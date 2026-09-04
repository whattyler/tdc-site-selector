# tdc-site-selector

Address in, GO / NO-GO and a max land price out.

Standalone Next.js 16 App Router app, built to be lifted into the `tdc-tools`
Turborepo later (build spec Part A, deferred). Served under `/site-selector`.

Spec: [`docs/build-spec-v2.md`](docs/build-spec-v2.md).
Assumptions: [`docs/assumptions.csv`](docs/assumptions.csv), extracted from
`docs/2026_Toro_Deal_Filter.xlsx`.

## Layout

| Path | Becomes | Rule |
|---|---|---|
| `src/app` | the app | routes, `proxy.ts` |
| `src/lib/scoring` | `packages/scoring` | pure TS. No React, no DB, no fetch. Golden-tested |
| `src/lib/db` | `packages/db` | Drizzle schema + Neon client |
| `src/lib/auth` | `packages/auth` | NextAuth v5 + Entra, `requireRole` |
| `src/components` | `packages/ui` | shadcn |
| `tests/golden` | — | JSON cases from the Deal Filter workbook |

`src/lib/scoring` imports nothing from `src/app` or `src/lib/db`. The dependency
runs the other way: `src/lib/db/assumptions.ts` reads the `assumptions` table and
hands the engine a typed object.

## Commands

```
pnpm dev          # http://localhost:3000/site-selector
pnpm build
pnpm test         # vitest: engine tests + golden cases
pnpm typecheck
pnpm lint

pnpm db:generate  # generate a migration from src/lib/db/schema.ts
pnpm db:migrate   # apply migrations (runs in the Vercel build, not from a laptop)
pnpm db:seed      # seed `assumptions` from docs/assumptions.csv
```

## Environment

Set manually in Vercel; nothing goes in git. See spec A7 for the full list. The
minimum to run locally:

| Var | Note |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `http://localhost:3000/site-selector` locally |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | issuer carries the tenant ID and is what restricts sign-in |
| `ADMIN_UPNS` | comma-separated UPNs granted the `admin` role |
| `DATABASE_URL` | Neon; `vercel env pull .env.local` |

## Phase status

Phase 0 (scaffold, schema, assumptions seeded) and Phase 1 (engine, golden
harness) are in. Phase 2 is the screen page.
