-- One-shot training reminders (null once_on = daily).

alter table pt.reminders
  add column if not exists once_on date;

comment on column pt.reminders.once_on is
  'Local calendar day (YYYY-MM-DD) for a one-shot ping. NULL means daily.';

comment on table pt.reminders is
  'User-requested training pings (daily or one-shot). Skip if opted out or already trained that local day.';
