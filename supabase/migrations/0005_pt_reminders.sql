-- Daily training reminders. Opt-in via iMessage. PT process fires them.

create table if not exists pt.reminders (
  id uuid primary key,
  user_id uuid not null references pt.users (id) on delete cascade,
  kind text not null check (kind in ('train')),
  hour integer not null,
  minute integer not null default 0,
  enabled boolean not null default true,
  last_fired_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create index if not exists pt_reminders_enabled on pt.reminders (enabled, hour, minute);

alter table pt.reminders enable row level security;

revoke all on pt.reminders from anon, authenticated;
grant all on pt.reminders to service_role;

comment on table pt.reminders is
  'User-requested daily training pings. Skip if opted out or already trained that local day.';
