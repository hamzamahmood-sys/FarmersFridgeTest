-- Farmer's Fridge Smart Outreach — schema
-- Run with: node scripts/migrate.cjs

-- ─── NextAuth / Auth.js tables (@auth/pg-adapter) ─────────────────────────────
-- Schema from https://authjs.dev/getting-started/adapters/pg

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  "emailVerified" TIMESTAMPTZ,
  image TEXT
);

-- ─── Application tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  id                TEXT        PRIMARY KEY,
  name              TEXT        NOT NULL,
  email             TEXT,
  title             TEXT,
  linkedin_url      TEXT,
  company_name      TEXT        NOT NULL,
  company_domain    TEXT,
  organization_id   TEXT,
  industry          TEXT,
  employee_count    INTEGER,
  hq_city           TEXT,
  hq_state          TEXT,
  hq_country        TEXT,
  keywords          TEXT[]      NOT NULL DEFAULT '{}',
  tech_stack        TEXT[]      NOT NULL DEFAULT '{}',
  about             TEXT,
  delivery_zone     TEXT        NOT NULL DEFAULT 'Other',
  priority_score    INTEGER     NOT NULL DEFAULT 0,
  search_query      TEXT,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_search_query_idx ON leads (search_query);
CREATE INDEX IF NOT EXISTS leads_fetched_at_idx   ON leads (fetched_at DESC);

CREATE TABLE IF NOT EXISTS pitches (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           TEXT        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  subject           TEXT,
  body              TEXT,
  talking_points    TEXT,
  bridge_insight    TEXT,
  summary           TEXT,
  pain_points       TEXT[]      NOT NULL DEFAULT '{}',
  variable_evidence TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pitches_lead_id_idx    ON pitches (lead_id);
CREATE INDEX IF NOT EXISTS pitches_created_at_idx ON pitches (created_at DESC);
