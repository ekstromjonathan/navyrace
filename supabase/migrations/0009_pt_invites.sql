-- Waitlist: unknown senders stay silent until the owner admits them.

create table if not exists pt.invites (
  id uuid primary key,
  phone_e164 text not null unique,
  chat_id text not null,
  name text,
  first_body text not null default '',
  status text not null check (status in ('pending', 'approved', 'denied')),
  notified_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pt_invites_status_created on pt.invites (status, created_at);

alter table pt.invites enable row level security;

revoke all on pt.invites from anon, authenticated;
grant all on pt.invites to service_role;

comment on table pt.invites is
  'Inbound from unknown numbers. PT does not reply until the owner approves.';
