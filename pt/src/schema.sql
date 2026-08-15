-- Personal trainer journal. SQLite V1; Postgres cousin lives in supabase/migrations.

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
  hour INTEGER NOT NULL,
  minute INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (user_id, kind)
);

CREATE INDEX IF NOT EXISTS reminders_enabled ON reminders(enabled, hour, minute);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_messages (
  linq_message_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
