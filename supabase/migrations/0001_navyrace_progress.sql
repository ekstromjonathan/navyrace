-- Fremdrift per bruker for Navy Race-appen.
-- Én rad per bruker: hvilken økt du står på, og RPE-loggen per fullførte økt.
-- Speiler localStorage-nøkkelen `navyrace:v1` ({ index, logs }).

create table if not exists public.navyrace_progress (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  session_index integer     not null default 0 check (session_index >= 0),
  logs          jsonb       not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

comment on table public.navyrace_progress is
  'Navy Race treningsfremdrift, én rad per bruker. Synkes fra klienten; localStorage er lokal sannhet.';
comment on column public.navyrace_progress.session_index is
  'Indeks inn i SESSIONS — neste økt som skal gjøres. Heter ikke "index" fordi det er et nøkkelord i Postgres.';
comment on column public.navyrace_progress.updated_at is
  'Settes av klienten, ikke av databasen. Synken bruker den til last-write-wins på tvers av enheter.';

alter table public.navyrace_progress enable row level security;

-- Hver bruker ser og skriver kun sin egen rad. Ingen policy for delete:
-- nullstilling skjer ved å skrive index=0, og raden ryddes av cascade
-- når brukeren slettes.
create policy "les egen fremdrift"
  on public.navyrace_progress for select
  to authenticated
  using (auth.uid() = user_id);

create policy "opprett egen fremdrift"
  on public.navyrace_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "oppdater egen fremdrift"
  on public.navyrace_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
