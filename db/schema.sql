-- Farmer's Fridge Smart Outreach — schema
-- Run with: node scripts/migrate.cjs

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  user_id           INTEGER     NOT NULL DEFAULT 1,
  external_id       TEXT,
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

-- Backfill for installs created before per-user lead ownership existed.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id TEXT;
UPDATE leads SET external_id = id WHERE external_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_user_external_idx ON leads (user_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pitches (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER     NOT NULL DEFAULT 1,
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

ALTER TABLE pitches ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS pitches_user_lead_idx ON pitches (user_id, lead_id);

-- ─── Saved locations (pipeline) ───────────────────────────────────────────────
-- Companies the user has added to their pipeline. Contacts live in `leads` and
-- reference the location via organization_id.

CREATE TABLE IF NOT EXISTS saved_locations (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           INTEGER     NOT NULL DEFAULT 1,
  organization_id   TEXT,
  company_name      TEXT        NOT NULL,
  company_domain    TEXT,
  industry          TEXT,
  employee_count    INTEGER,
  hq_city           TEXT,
  hq_state          TEXT,
  hq_country        TEXT,
  about             TEXT,
  category          TEXT,
  location_type     TEXT        NOT NULL DEFAULT 'other',
  pipeline_stage    TEXT        NOT NULL DEFAULT 'prospect',
  pitch_type        TEXT        NOT NULL DEFAULT 'farmers_fridge',
  notes             TEXT,
  delivery_zone     TEXT        NOT NULL DEFAULT 'Other',
  fit_score         INTEGER     NOT NULL DEFAULT 0,
  fit_reasons       TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill for installs created before user_id existed.
ALTER TABLE saved_locations ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE saved_locations ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE saved_locations ADD COLUMN IF NOT EXISTS fit_score   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE saved_locations ADD COLUMN IF NOT EXISTS fit_reasons TEXT[]  NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS saved_locations_user_idx     ON saved_locations (user_id);
CREATE INDEX IF NOT EXISTS saved_locations_pipeline_idx ON saved_locations (pipeline_stage);
CREATE INDEX IF NOT EXISTS saved_locations_type_idx     ON saved_locations (location_type);
CREATE INDEX IF NOT EXISTS saved_locations_updated_idx  ON saved_locations (updated_at DESC);
CREATE INDEX IF NOT EXISTS saved_locations_fit_idx      ON saved_locations (fit_score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS saved_locations_user_org_idx
  ON saved_locations (user_id, organization_id)
  WHERE organization_id IS NOT NULL;

-- Add location_id on leads so contacts can be grouped under a saved location.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS location_id TEXT REFERENCES saved_locations(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS department   TEXT;
-- Provenance: where the contact record itself came from (apollo | ai). Nullable for legacy rows.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source        TEXT;
-- Provenance: where the email address was sourced (apollo | tomba | ai | existing). Nullable.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_source  TEXT;
CREATE INDEX IF NOT EXISTS leads_location_id_idx ON leads (location_id);
CREATE INDEX IF NOT EXISTS leads_user_location_idx ON leads (user_id, location_id);

-- ─── Emails (persisted drafts / sent) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS emails (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER     NOT NULL DEFAULT 1,
  location_id       TEXT        REFERENCES saved_locations(id) ON DELETE CASCADE,
  lead_id           TEXT        REFERENCES leads(id) ON DELETE SET NULL,
  contact_name      TEXT,
  contact_email     TEXT,
  contact_title     TEXT,
  company_name      TEXT,
  location_type     TEXT,
  sequence_step     INTEGER     NOT NULL DEFAULT 0,
  subject           TEXT        NOT NULL,
  body              TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'generated',
  gmail_draft_url   TEXT,
  gmail_draft_id    TEXT,
  gmail_message_id  TEXT,
  gmail_thread_id   TEXT,
  scheduled_for     TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  reply_detected_at TIMESTAMPTZ,
  quality_score     INTEGER     NOT NULL DEFAULT 0,
  quality_issues    TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill for installs created before user_id existed.
ALTER TABLE emails ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS gmail_draft_id    TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS gmail_message_id  TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS gmail_thread_id   TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS scheduled_for     TIMESTAMPTZ;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS reply_detected_at TIMESTAMPTZ;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS quality_score     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS quality_issues    TEXT[]  NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS emails_user_idx        ON emails (user_id);
CREATE INDEX IF NOT EXISTS emails_location_id_idx ON emails (location_id);
CREATE INDEX IF NOT EXISTS emails_status_idx      ON emails (status);
CREATE INDEX IF NOT EXISTS emails_created_at_idx  ON emails (created_at DESC);
CREATE INDEX IF NOT EXISTS emails_scheduled_idx   ON emails (scheduled_for);
CREATE INDEX IF NOT EXISTS emails_gmail_thread_idx ON emails (gmail_thread_id);

-- ─── Research evidence ───────────────────────────────────────────────────────
-- Web research snippets and sources used to personalize outreach.

CREATE TABLE IF NOT EXISTS research_evidence (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      INTEGER     NOT NULL DEFAULT 1,
  location_id  TEXT        REFERENCES saved_locations(id) ON DELETE CASCADE,
  lead_id      TEXT        REFERENCES leads(id) ON DELETE SET NULL,
  source_title TEXT,
  source_url   TEXT,
  snippet      TEXT        NOT NULL,
  confidence   NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS research_evidence_user_idx     ON research_evidence (user_id);
CREATE INDEX IF NOT EXISTS research_evidence_location_idx ON research_evidence (location_id);
CREATE INDEX IF NOT EXISTS research_evidence_lead_idx     ON research_evidence (lead_id);

-- ─── Tone of voice settings ───────────────────────────────────────────────────
-- One row per user (scoped by the Auth.js users.id). For the current single-
-- user deployment, row with id=1 is the shared tone.

CREATE TABLE IF NOT EXISTS tone_settings (
  user_id           INTEGER     PRIMARY KEY,
  voice_description TEXT        NOT NULL DEFAULT '',
  do_examples       TEXT        NOT NULL DEFAULT '',
  dont_examples     TEXT        NOT NULL DEFAULT '',
  sample_email      TEXT        NOT NULL DEFAULT '',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
