-- Short-lived capability links for focused browser workouts.

create table if not exists pt.workout_instances (
  id uuid primary key,
  user_id uuid not null references pt.users (id) on delete cascade,
  track_id uuid not null references pt.tracks (id) on delete cascade,
  session_ref text not null,
  local_date date not null,
  plan_version integer not null,
  snapshot jsonb not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  opened_at timestamptz,
  completed_at timestamptz,
  completion_entry_id uuid references pt.entries (id) on delete set null,
  client_completion_id text,
  feedback jsonb,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pt_workout_instances_live_identity
  on pt.workout_instances (user_id, track_id, session_ref, local_date, plan_version)
  where revoked_at is null;

create unique index if not exists pt_workout_instances_client_completion
  on pt.workout_instances (client_completion_id)
  where client_completion_id is not null;

create index if not exists pt_workout_instances_user_time
  on pt.workout_instances (user_id, created_at desc);

alter table pt.workout_instances enable row level security;

revoke all on pt.workout_instances from anon, authenticated;
grant all on pt.workout_instances to service_role;

comment on table pt.workout_instances is
  'Short-lived capability links for one immutable workout snapshot. URL tokens are stored as SHA-256 hashes only.';
