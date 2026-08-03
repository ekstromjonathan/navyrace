-- Profile + program jsonb on the same progress row (atomic LWW).
-- Additive: existing rows stay valid with nulls. RLS unchanged.

alter table public.navyrace_progress
  add column if not exists profile jsonb,
  add column if not exists program jsonb;

comment on column public.navyrace_progress.profile is
  'User profile from MAI onboarding (goal, schedule, equipment, brand, startedAt).';
comment on column public.navyrace_progress.program is
  'Generated or null (= builtin Navy Race template). Source of truth when non-null.';
