# tdc-site-selector

Standalone Next.js 16 App Router app. TypeScript, Tailwind, shadcn, Drizzle +
Neon, NextAuth v5 (Microsoft Entra ID), Vitest. pnpm. Node 22 on Vercel (engines >=22).

Spec: docs/build-spec-v2.md. Part A (monorepo/hub/OIDC) is DEFERRED. Build this
as a single app that can be lifted into a Turborepo later. That means:

## Layout
src/app            routes, proxy.ts
src/lib/scoring    pure TS. No React, no DB, no fetch. Will become packages/scoring
src/lib/db         Drizzle schema + client. Will become packages/db
src/lib/auth       NextAuth + Entra, requireRole. Will become packages/auth
src/components     UI
public/brand       logo files
tests/golden       JSON inputs + expected outputs from the 2026 Deal Filter workbook

## Rules
- src/lib/scoring imports nothing from src/app or src/lib/db. Golden-tested.
- 18 scored criteria: 17 answered Yes/Maybe/No + Demographics computed. Probability
  is a multiplier, not a criterion. validateAssumptions enforces this.
- Weights, KO flags, thresholds, yields, land conventions, pad rates, demographic
  bands, geography bands, escalation rate: from the assumptions table. Never hardcoded.
- Placeholder assumptions (source = "placeholder") throw if they reach a verdict.
- Demographics are typed manually until Phase 4. No dashboard call yet.
- cost_library rows never reach the client. Server returns resolved_rate and
  resolved_amount only. Any route returning library rows checks requireRole("admin").
- Google Maps server key only in route handlers. Browser key for Maps JS only.
- Anthropic API direct. No AI Gateway, no proxies.
- AI-drafted values flagged ai_draft and excluded from calculations until confirmed.
- Auth checks live in proxy.ts, not in page components.
- cacheComponents: false.
- Migrations run in the Vercel build command, never from a laptop against prod.
- Bounded steps. Stop before each commit. Don't commit. Main only, fast-forward,
  except changes to src/lib/scoring go through a branch + preview.
- Env vars are set manually in Vercel. Never write .env files with real values.

## Brand
- Toro red: #C7202E. Used for the wordmark, primary action, GO state, active nav.
  Nowhere else.
- Neutrals: near-black text (#1A1A1A), warm grays, white surfaces. No blue-tinted grays.
- Semantic: GO = Toro red. MAYBE / INCOMPLETE = amber. NO-GO = charcoal, not a
  second red.
- Type: one sans, tight. Tabular figures on every number. Numbers right-aligned.
- Logo: public/brand/toro-logo-red.png in the header, left. Never stretched, never
  on red.
- Density: this is an underwriting tool, not a marketing page. Tables over cards.
  No hero sections, no gradients, no rounded-everything. Whitespace comes from
  margin, not padding.
- Verdict panel is the one thing allowed to be loud.
- Before building any new page: propose design tokens and an ASCII wireframe,
  stop, get approval, then build.
