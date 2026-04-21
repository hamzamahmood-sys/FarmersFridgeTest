# CLAUDE.md

## App: Farmer's Fridge Smart Outreach Engine

A Next.js 14 (App Router) lead-to-draft outreach tool. Signs users in with Google (Auth.js v5), sources leads from Apollo, enriches them, generates a personalized pitch with OpenAI, and drops a Gmail draft using the same Google session.

## Core workflow

1. Unauthenticated traffic is redirected to `/signin` by [middleware.ts](middleware.ts). Google consent grants identity + `gmail.compose` scope in one flow.
2. `POST /api/leads/search` → Apollo `mixed_people/api_search` (free). Firmographics extracted from the embedded organization; delivery zone tagged (Chicago / NYC / NJ / Other). HQ matches in those zones are boosted.
3. `POST /api/leads/enrich-email` → optional Tomba email fallback when Apollo lacks an address.
4. `POST /api/pitch` → OpenAI returns `{ subject, body, talkingPoints, bridgeInsight, summary, painPoints, variableEvidence }`. User can edit talking points before drafting.
5. `POST /api/gmail/drafts` → `users.drafts.create` using tokens pulled from the signed-in user's row in the `accounts` table.
6. Recent searches persisted in Postgres via [lib/db.ts](lib/db.ts) (pg pool + raw SQL).

## Layout

- `app/page.tsx` — renders `OutreachDashboard`.
- `app/signin/page.tsx` — Google sign-in screen.
- `app/api/auth/[...nextauth]/route.ts` — Auth.js handlers.
- `app/api/` — `leads/{search,enrich-email,recent}`, `pitch`, `gmail/{drafts,status}`. The old `gmail/oauth/*` routes are gone — sign-in IS Gmail connect.
- `auth.ts` — Auth.js config (Google provider + pg adapter, `gmail.compose` scope, `access_type: offline`).
- `middleware.ts` — forces sign-in on all routes except `/api/auth/*` and `/signin`.
- `components/outreach-dashboard.tsx` — single-file client UI for the whole flow (to be split).
- `lib/` — `apollo/` (split into `client`, `query-parser`, `normalize`, `search`, `enrich`, `index`), `openai.ts` (pitch generation), `gmail.ts` (reads tokens from `accounts` table), `tavily.ts`, `tomba.ts`, `db.ts` (pg pool), plus `env.ts`, `types.ts`, `constants.ts`, `utils.ts`.
- `db/schema.sql` — Auth.js tables (`users`, `accounts`, `sessions`, `verification_token`) + app tables (`leads`, `pitches`).
- `scripts/migrate.cjs` — applies `db/schema.sql` using `DATABASE_URL`.
- `tests/` — Vitest suite covering scoring, zone matching, query parsing, normalization.

## Stack

Next.js 14.2, React 18, TypeScript, `next-auth@beta` (Auth.js v5) + `@auth/pg-adapter`, `pg`, `googleapis`, `openai`, `@tavily/core`, `zod`, `lucide-react`. Tests: `vitest` + `vite-tsconfig-paths`.

## Scripts

- `npm run dev` / `build` / `start`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` / `npm run test:watch` — Vitest
- `npm run lint` — next lint
- `node scripts/migrate.cjs` — apply schema

## Env vars

Required: `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `APOLLO_API_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY`.
Optional: `DATABASE_SSL` (default true), `TOMBA_API_KEY`/`TOMBA_API_SECRET`, `NEXT_PUBLIC_APP_URL`.

Tomba requests must send `X-Tomba-Key` / `X-Tomba-Secret` headers (not `X-Tomain-*`).

## Auth + tokens

- Auth.js v5 with `session: { strategy: "database" }` — session rows live in `sessions`, user in `users`, Google refresh/access tokens in `accounts`.
- `lib/gmail.ts` loads tokens from `accounts` for the current user and uses `google.auth.OAuth2` to call the Gmail API; token refreshes are persisted back via the `"tokens"` event.
- To force a re-consent (e.g. after revoking), users hit the "Reauthorize Gmail" link which routes to `/signin`.

## Deploy

Railway: add the Postgres plugin (`DATABASE_URL` injected), set remaining env vars, deploy. Run `node scripts/migrate.cjs` once in a Railway shell to create tables.
