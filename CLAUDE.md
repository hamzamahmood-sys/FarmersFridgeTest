# CLAUDE.md

## App: Farmer's Fridge Smart Outreach Engine

A Next.js 14 (App Router) lead-to-draft outreach tool. Signs users in with Google (Auth.js v5), sources leads from Apollo, enriches them, generates a personalized pitch with OpenAI, and drops a Gmail draft using the same Google session.

## Core workflow

1. Unauthenticated traffic is redirected to `/signin` by [middleware.ts](middleware.ts). Google consent grants identity + `gmail.compose` scope in one flow.
2. `POST /api/companies/search` → Apollo `mixed_companies/search`. Search is now company-first: broad queries like `law firm NYC` or exact-company queries like `Rush Hospital` return company candidates before we look for people.
3. User selects a company in the UI, then `POST /api/leads/by-company` → Apollo `mixed_people/api_search` with `organization_ids` to find contacts inside that chosen org. The contact load depth is now separate from the company search limit, so the user can expand a selected company from the initial run and fetch more contacts later without re-running the whole company search.
4. `POST /api/leads/enrich-email` → optional Tomba email fallback when Apollo lacks an address.
5. `POST /api/pitch` → OpenAI returns `{ subject, body, talkingPoints, bridgeInsight, summary, painPoints, variableEvidence }`. User can edit talking points before drafting.
6. `POST /api/gmail/drafts` → `users.drafts.create` using tokens pulled from the signed-in user's row in the `accounts` table.
7. Recent searches / fetched leads persist in Postgres via [lib/db.ts](lib/db.ts) (pg pool + raw SQL).

## Recent Iteration Notes

- 2026-04-20: Apollo search was refactored from people-first to company-first because broad market searches like `law firm NYC` were too brittle when we searched people directly with narrow title filters.
- 2026-04-21: Added incremental contact expansion after the initial company open. The contact detail view now offers a `Search 10 More` action, and `Refresh Contacts` reuses the expanded per-company contact depth instead of falling back to the original company-search limit.
- Contact search depth is now tracked separately from company result count inside `components/outreach-dashboard.tsx`, so the top-level "Company Limit" no longer controls every later contact refresh for a selected account.
- `app/api/leads/by-company/route.ts` now accepts higher per-company contact limits up to `100`, using shared constants from `lib/constants.ts`.
- New server routes:
  `app/api/companies/search/route.ts` for company lookup and `app/api/leads/by-company/route.ts` for loading contacts after a company is chosen.
- New Apollo helper:
  `lib/apollo/company-search.ts` owns the new flow. It searches organizations first, then searches people with `organization_ids`.
- Query parsing was tightened so category phrases survive company search:
  `law firm NYC` now preserves `law firm` as a phrase instead of collapsing only to `law`.
- The dashboard UI in `components/outreach-dashboard.tsx` now has two explicit states:
  company results first, then contact results for the selected company.
- `lib/apollo/search.ts` still exists with tests, but it is no longer the primary UI path. Treat it as legacy / fallback logic unless we wire it back in intentionally.
- Local verification completed in this session:
  `npm run typecheck` and `npm test` passed after the refactor.
- Local verification for the incremental contact expansion work also passed:
  `npm run typecheck` and `npm test` succeeded after the dashboard + route update.
- Live Apollo verification also succeeded locally with a fresh key:
  `law firm NYC` returned real firms when we used richer company keyword tags like `["law firm", "law"]`, and selecting the first company returned real contacts via `organization_ids`.
- Deployment note:
  the code was pushed to GitHub `main` in commit `85c1a93` (`Refactor Apollo search to company-first flow`), which should trigger Railway auto-deploy.
- Deployment note:
  the incremental contact expansion work was pushed to GitHub `main` in commit `1417357` (`Add incremental contact expansion controls`), which should also trigger Railway auto-deploy.
- Important env handoff:
  the fresh Apollo key used for local verification was updated in local `.env` only. If live search is still failing on Railway, update `APOLLO_API_KEY` in Railway env settings too.

## Layout

- `app/page.tsx` — renders `OutreachDashboard`.
- `app/signin/page.tsx` — Google sign-in screen.
- `app/api/auth/[...nextauth]/route.ts` — Auth.js handlers.
- `app/api/` — `companies/search`, `leads/{by-company,enrich-email,recent,search}`, `pitch`, `gmail/{drafts,status}`. `leads/search` is the older people-first route; the dashboard now uses `companies/search` + `leads/by-company`.
- `auth.config.ts` — edge-safe Auth.js config (Google provider + callbacks, **no** pg adapter). Imported by `middleware.ts` so it runs in the Edge Runtime. The Google provider is only registered when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set — otherwise `providers: []`, which keeps dev-bypass boots from crashing.
- `auth.ts` — wraps `authConfig` with the pg adapter + `session: { strategy: "database" }` for server-side use. Never imported by middleware.
- `middleware.ts` — forces sign-in on all routes except `/api/auth/*` and `/signin`. When `AUTH_DEV_BYPASS=true`, exports a no-op middleware so the whole app is reachable without Google creds (used for Railway preview deploys).
- `components/outreach-dashboard.tsx` — still a single-file client UI, but now renders company selection first and contact review second, with a separate per-location contact search depth so users can load more contacts after the initial run.
- `lib/` — `apollo/` (split into `client`, `query-parser`, `normalize`, `company-search`, `search`, `enrich`, `index`), `openai.ts` (pitch generation), `gmail.ts` (reads tokens from `accounts` table), `tavily.ts`, `tomba.ts`, `db.ts` (pg pool), plus `env.ts`, `types.ts`, `constants.ts`, `utils.ts`.
- `db/schema.sql` — Auth.js tables (`users`, `accounts`, `sessions`, `verification_token`) + app tables (`leads`, `pitches`).
- `scripts/migrate.cjs` — applies `db/schema.sql` using `DATABASE_URL`.
- `tests/` — Vitest suite covering company-first Apollo search, legacy search fallbacks, scoring, zone matching, query parsing, and normalization.

## Stack

Next.js 14.2, React 18, TypeScript, `next-auth@beta` (Auth.js v5) + `@auth/pg-adapter`, `pg`, `googleapis`, `openai`, `@tavily/core`, `zod`, `lucide-react`. Tests: `vitest` + `vite-tsconfig-paths`.

## Scripts

- `npm run dev` / `build` / `start`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` / `npm run test:watch` — Vitest
- `npm run lint` — next lint
- `node scripts/migrate.cjs` — apply schema

## Env vars

Required: `AUTH_SECRET`, `AUTH_URL`, `DATABASE_URL`, `APOLLO_API_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY`.
Required unless `AUTH_DEV_BYPASS=true`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Optional: `DATABASE_SSL` (default true — set `false` only for local Postgres), `AUTH_DEV_BYPASS` (skip auth gating; Gmail drafting is disabled while on), `TOMBA_API_KEY`/`TOMBA_API_SECRET`, `NEXT_PUBLIC_APP_URL`.

Tomba requests must send `X-Tomba-Key` / `X-Tomba-Secret` headers (not `X-Tomain-*`).

## Auth + tokens

- Auth.js v5 with `session: { strategy: "database" }` — session rows live in `sessions`, user in `users`, Google refresh/access tokens in `accounts`.
- `lib/gmail.ts` loads tokens from `accounts` for the current user and uses `google.auth.OAuth2` to call the Gmail API; token refreshes are persisted back via the `"tokens"` event.
- To force a re-consent (e.g. after revoking), users hit the "Reauthorize Gmail" link which routes to `/signin`.

## Deploy

Railway: add the Postgres plugin, reference it in the web service as `DATABASE_URL=${{Postgres.DATABASE_URL}}`, set remaining env vars, deploy. Run `node scripts/migrate.cjs` once in a Railway shell to create tables.

Live: https://farmersfridgetest-production.up.railway.app (GitHub repo: `hamzamahmood-sys/FarmersFridgeTest`, auto-deploys on push to `main`).

Operational note: pushing code to GitHub does **not** update Railway secrets. If Apollo behavior diverges between local and live, check `APOLLO_API_KEY` in Railway first.

### Build notes

- `package-lock.json` is **gitignored**. Railway's Railpack detects no lockfile and runs `npm install` instead of `npm ci`. This sidesteps an npm 10 bug where cross-platform optional native deps (e.g. `@emnapi/core` under `@rolldown/binding-wasm32-wasi`) aren't recorded when the lockfile is generated on macOS, which caused `npm ci` to fail on Linux. Before shipping to prod we should regenerate the lockfile on Linux (or `npm install --force` in CI) and re-commit it.
- Railway build runs `npm install` → `npm run build` → `npm run start`. Node 22 is auto-detected.
