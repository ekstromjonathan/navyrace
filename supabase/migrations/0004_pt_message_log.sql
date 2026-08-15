-- Rolling iMessage working memory for the PT. Journal remains source of truth.
-- Access only via service role / the PT process.

create table if not exists pt.message_log (
  id uuid primary key,
  user_id uuid not null references pt.users (id) on delete cascade,
  role text not null check (role in ('user', 'pt')),
  body text not null,
  linq_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists pt_message_log_user_time
  on pt.message_log (user_id, created_at desc);

alter table pt.message_log enable row level security;

revoke all on pt.message_log from anon, authenticated;
grant all on pt.message_log to service_role;

comment on table pt.message_log is
  'Short rolling chat memory for follow-ups (ja/den/ok). Not the source of truth.';
