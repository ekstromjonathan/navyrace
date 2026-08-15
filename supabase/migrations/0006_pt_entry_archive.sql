-- Soft-archive individual journal logs. Never hard-delete.

alter table pt.entries
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

create index if not exists pt_entries_user_live
  on pt.entries (user_id, occurred_at desc)
  where archived_at is null;

comment on column pt.entries.archived_at is
  'Soft-archive. Individual logs are never hard-deleted; archived rows stay for history and linq_message_id dedup.';
