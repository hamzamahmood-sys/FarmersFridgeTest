# Farmer's Fridge Smart Outreach Engine

Next.js app that connects Apollo.io, OpenAI, and Gmail into a lead-to-draft workflow for Farmer's Fridge. Auth via Google (Auth.js v5), data in Postgres. Deploys to Railway.

## Setup

1. Copy `.env.example` to `.env` and fill in keys.
2. Generate `AUTH_SECRET`: `openssl rand -base64 32`.
3. In Google Cloud:
   - Enable the Gmail API.
   - OAuth consent screen scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/gmail.readonly`.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (and your production URL).
4. Run the schema: `node scripts/migrate.cjs` (reads `DATABASE_URL`).

## Run

```bash
npm install
npm run dev
```

You'll be redirected to `/signin` — sign in with Google. The same consent grants Gmail compose access, so there's no separate Gmail connect step.

## Deploy (Railway)

1. Create a Railway project, add a Postgres plugin — `DATABASE_URL` is injected automatically.
2. Set the remaining env vars from `.env.example` in the service settings.
3. Push. Run `node scripts/migrate.cjs` once via Railway shell to create tables.

## Workflow

- Apollo `mixed_people/api_search` finds ICP leads (configurable 1-50, default 10) using only free endpoints. Firmographics come from the embedded organization object — no separate enrichment call.
- Optional Tomba fallback finds emails when Apollo has none.
- OpenAI generates a personalized subject, body, bridge insight, and editable talking points.
- The user can edit talking points before draft creation.
- Placement fit scoring highlights the best accounts by delivery zone, location type, employee count, and food/access signals.
- Outreach sequences carry scheduled dates, quality scores, Gmail draft/message/thread IDs, sent timestamps, and reply detection timestamps.
- Gmail draft is created using the signed-in user's Google tokens via `users.drafts.create`; Gmail sync uses read-only access to detect sent messages and replies.

## Scripts

- `npm run dev` — Next.js dev server.
- `npm run build` / `start` — production build + server.
- `npm run typecheck` — TypeScript check.
- `npm test` / `npm run test:watch` — Vitest.
- `node scripts/migrate.cjs` — apply `db/schema.sql`.

## Notes

- Lead prioritization boosts HQ matches in Chicago, NYC, and New Jersey.
- Credit transparency: UI shows 1 Apollo operation per search (the mixed_people search is free).
- Google refresh tokens are stored on the `accounts` row (Auth.js pg adapter) and rotated automatically when the Gmail client refreshes.
- Reauthorize Gmail after adding the read-only scope so existing accounts can use sent/reply sync.
