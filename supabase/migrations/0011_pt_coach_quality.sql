-- Structured coaching outcomes and safety routing. Raw message text stays in message_log.

create table if not exists pt.coach_events (
  id uuid primary key,
  user_id uuid not null references pt.users (id) on delete cascade,
  kind text not null,
  source text not null check (source in ('user', 'coach', 'system', 'integration')),
  ref_id text,
  dedupe_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pt_coach_events_user_time
  on pt.coach_events (user_id, created_at desc);

create index if not exists pt_coach_events_kind_time
  on pt.coach_events (kind, created_at desc);

alter table pt.coach_events enable row level security;

revoke all on pt.coach_events from anon, authenticated;
grant all on pt.coach_events to service_role;

comment on table pt.coach_events is
  'Structured coaching outcomes and safety routes. Metadata must not duplicate raw message bodies.';
