-- Optional URL payload on training reminders (e.g. YouTube video to watch).

alter table pt.reminders
  add column if not exists url text;

comment on column pt.reminders.url is
  'Optional link included in the reminder ping (video, article, etc.).';
