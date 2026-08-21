-- Personal trainer journal. SQLite fallback for unit tests.
-- Production uses Supabase Postgres (schema pt) — see supabase/migrations/0003+.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  phone_e164 TEXT,
  tz TEXT NOT NULL DEFAULT 'Europe/Oslo',
  locale TEXT NOT NULL DEFAULT 'nb',
  display_name TEXT,
  facts TEXT NOT NULL DEFAULT '{}',
  pending TEXT,
  health_status TEXT NOT NULL DEFAULT 'HEALTHY',
  last_contact_card_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('training', 'nutrition', 'habit', 'recovery', 'custom')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  plan TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT,
  archive_reason TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (user_id, slug, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS tracks_one_active_training
  ON tracks(user_id) WHERE kind = 'training' AND status = 'active';

CREATE INDEX IF NOT EXISTS tracks_user_status ON tracks(user_id, status);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  quantity TEXT,
  quality TEXT,
  note TEXT,
  session_ref TEXT,
  source TEXT NOT NULL CHECK (source IN ('heuristic', 'llm', 'user')),
  linq_message_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  FOREIGN KEY (track_id) REFERENCES tracks(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS entries_track_time ON entries(track_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  track_id TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS notes_user_time ON notes(user_id, created_at DESC);

-- Rolling working memory (last ~50). Journal remains source of truth.
CREATE TABLE IF NOT EXISTS message_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'pt')),
  body TEXT NOT NULL,
  linq_message_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS message_log_user_time ON message_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('train')),
  slug TEXT NOT NULL DEFAULT 'train',
  title TEXT NOT NULL DEFAULT 'trening',
  hour INTEGER NOT NULL,
  minute INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_on TEXT,
  once_on TEXT,
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- NULL once_on (daily) must collide with another daily at the same clock; expression unique matches Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS reminders_identity
  ON reminders (user_id, slug, hour, minute, ifnull(once_on, ''));

CREATE INDEX IF NOT EXISTS reminders_enabled ON reminders(enabled, hour, minute);

-- Structured product outcomes. Never duplicate raw chat bodies in metadata.
CREATE TABLE IF NOT EXISTS coach_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'coach', 'system', 'integration')),
  ref_id TEXT,
  dedupe_key TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS coach_events_user_time ON coach_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_events_kind_time ON coach_events(kind, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS coach_events_user_dedupe
  ON coach_events(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS workout_instances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  session_ref TEXT NOT NULL,
  local_date TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  opened_at TEXT,
  completed_at TEXT,
  completion_entry_id TEXT,
  client_completion_id TEXT,
  feedback TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id),
  FOREIGN KEY (completion_entry_id) REFERENCES entries(id)
);

CREATE INDEX IF NOT EXISTS workout_instances_identity
  ON workout_instances(user_id, track_id, session_ref, local_date, plan_version)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workout_instances_client_completion
  ON workout_instances(client_completion_id) WHERE client_completion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workout_instances_user_time
  ON workout_instances(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_messages (
  linq_message_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  name TEXT,
  first_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  notified_at TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS invites_status_created ON invites(status, created_at);
