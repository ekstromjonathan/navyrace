-- Multiple named routines per user (daily + one-shot). Identity is slug + clock + once_on.

alter table pt.reminders add column if not exists slug text;
alter table pt.reminders add column if not exists title text;

update pt.reminders
set
  slug = coalesce(nullif(slug, ''), kind, 'train'),
  title = coalesce(
    nullif(title, ''),
    case when url is not null then 'video' when kind = 'train' then 'trening' else kind end
  );

alter table pt.reminders alter column slug set default 'train';
alter table pt.reminders alter column title set default 'trening';
alter table pt.reminders alter column slug set not null;
alter table pt.reminders alter column title set not null;

alter table pt.reminders drop constraint if exists reminders_user_id_kind_key;

create unique index if not exists pt_reminders_identity
  on pt.reminders (user_id, slug, hour, minute, (coalesce(once_on::text, '')));

comment on column pt.reminders.slug is
  'Routine identity (train, video, meditasjon, …). Several clocks per slug are allowed.';
comment on column pt.reminders.title is
  'Short human label used in confirmations and pings.';
