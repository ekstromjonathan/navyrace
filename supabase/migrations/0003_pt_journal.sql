-- PT journal (server-side). Not exposed to the Vite app.
-- Access only via service role / the PT process. Anon+authenticated have no grants.

create schema if not exists pt;

create table if not exists pt.users (
  id uuid primary key,
  chat_id text not null unique,
  phone_e164 text,
  tz text not null default 'Europe/Oslo',
  locale text not null default 'nb',
  display_name text,
  facts jsonb not null default '{}'::jsonb,
  pending jsonb,
  health_status text not null default 'HEALTHY',
  last_contact_card_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pt.tracks (
  id uuid primary key,
  user_id uuid not null references pt.users (id) on delete cascade,
  kind text not null check (kind in ('training', 'nutrition', 'habit', 'recovery', 'custom')),
  slug text not null,
  name text not null,
  tags jsonb not null default '[]'::jsonb,
  status text not null check (status in ('draft', 'active', 'archived')),
  plan jsonb,
  version integer not null default 1,
  supersedes_id uuid,
  archive_reason text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug, version)
);

create unique index if not exists pt_tracks_one_active_training
  on pt.tracks (user_id)
  where kind = 'training' and status = 'active';

create table if not exists pt.entries (
  id uuid primary key,
  track_id uuid not null references pt.tracks (id) on delete cascade,
  user_id uuid not null references pt.users (id) on delete cascade,
  occurred_at timestamptz not null,
  quantity jsonb,
  quality text,
  note text,
  session_ref text,
  source text not null check (source in ('heuristic', 'llm', 'user')),
  linq_message_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists pt.notes (
  id uuid primary key,
  user_id uuid not null references pt.users (id) on delete cascade,
  track_id uuid references pt.tracks (id) on delete set null,
  kind text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists pt.webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

create table if not exists pt.processed_messages (
  linq_message_id text primary key,
  processed_at timestamptz not null default now()
);

alter table pt.users enable row level security;
alter table pt.tracks enable row level security;
alter table pt.entries enable row level security;
alter table pt.notes enable row level security;
alter table pt.webhook_events enable row level security;
alter table pt.processed_messages enable row level security;

revoke all on schema pt from anon, authenticated;
grant usage on schema pt to service_role;
grant all on all tables in schema pt to service_role;

comment on schema pt is
  'iMessage PT journal. Tracks (training/habits/recovery) with versioned plans; archive never deletes.';
