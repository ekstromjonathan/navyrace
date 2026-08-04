-- MAI messaging trainer — migrasjon 1 (skive 1: inbound).
--
-- Egen `mai`-schema. Rører ikke public.navyrace_progress: den er klient-autoritativ
-- og offline-først, denne er server-autoritativ og append-only. Motsatt form.
--
-- Låste constraints fra arkitektur-review §2b er markert [1]–[5] og [A]–[C].
-- `plans` / `memory` er bevisst løs jsonb her — normaliseres i migrasjon 2 når
-- ekte samtaler har vist hvilke felter treneren faktisk trenger.

-- ------------------------------------------------------------- extensions --
-- Rekkefølge: extensions → schema/tabeller/funksjoner → køer → cron.schedule.
create extension if not exists pg_net;
create extension if not exists pgmq;
create extension if not exists pg_cron;

create schema if not exists mai;

comment on schema mai is
  'Proaktiv meldings-trener. Server-autoritativ; kun service_role har tilgang.';

-- ----------------------------------------------------------------- config --
-- Singleton. Outbound-capen er plattformoverlevelse (quality rating), så den
-- er data og ikke en konstant i applikasjonskoden.
create table if not exists mai.config (
  id                      boolean primary key default true check (id),
  max_outbound_per_day    int  not null default 2 check (max_outbound_per_day between 0 and 10),
  quiet_hours_start       time not null default '21:00',
  quiet_hours_end         time not null default '07:00',
  raw_body_retention_days int  not null default 30 check (raw_body_retention_days > 0),
  outbound_max_attempts   int  not null default 5  check (outbound_max_attempts > 0),
  updated_at              timestamptz not null default now()
);

insert into mai.config (id) values (true) on conflict (id) do nothing;

comment on column mai.config.raw_body_retention_days is
  'Personvern-default: rå meldingstekst nulles etter 30 dager. Events beholdes.';

-- ------------------------------------------------------------------ users --
create table if not exists mai.users (
  id                uuid primary key default gen_random_uuid(),
  wa_id             text not null unique,
  display_name      text,
  timezone          text not null default 'Europe/Oslo',
  last_inbound_at   timestamptz,
  paused_until      timestamptz,
  opted_out_at      timestamptz,
  profile           jsonb not null default '{}'::jsonb,
  memory            jsonb not null default '{}'::jsonb,
  memory_rebuilt_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- [B] 24-timersvinduet er en kolonne, ikke en antakelse. Sendestien forgrener
--     på denne: innenfor vinduet = fri tekst, utenfor = godkjent template.
comment on column mai.users.last_inbound_at is
  '[B] Siste innkommende melding. Styrer fri tekst (<24t) vs template (>24t).';

-- [A] memory er en CACHE, ikke sannheten. Skal kunne rebygges fra mai.events,
--     slik at en dårlig LLM-skriving blir en re-kjøring og ikke datatap.
comment on column mai.users.memory is
  '[A] Cache for LLM-lesestien. Sannheten er mai.events — denne kan rebygges.';

comment on column mai.users.profile is
  'Løs jsonb i migrasjon 1 (mål, dager/uke, nivå, utstyr). Normaliseres i migrasjon 2.';

comment on column mai.users.timezone is
  '[C] Cues planlegges i UTC og filtreres mot denne — ikke én cron-jobb per bruker.';

-- ----------------------------------------------------------------- events --
-- Append-only. Ingen UPDATE utenom retention-nulling av `body`.
create table if not exists mai.events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references mai.users (id) on delete cascade,
  kind          text not null,
  direction     text check (direction in ('in', 'out')),
  wa_message_id text,
  body          text,
  payload       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- [3] WhatsApp retry-er webhooks. Uten denne blir én retry til dobbelt
--     LLM-trekk og dobbelt utgående svar. WA sine message-id-er er globalt
--     unike, så indeksen dekker både inn og ut.
create unique index if not exists events_wa_message_id_key
  on mai.events (wa_message_id)
  where wa_message_id is not null;

create index if not exists events_user_time_idx on mai.events (user_id, occurred_at desc);
create index if not exists events_kind_time_idx on mai.events (kind, occurred_at desc);

comment on column mai.events.kind is
  'Konvensjon (ikke check — formen er ikke låst ennå): message, cue_sent, '
  'session_completed, session_minimum, session_skipped, rpe, onboarding_step, system.';
comment on column mai.events.body is
  'Rå meldingstekst. Nulles av mai.purge_raw_bodies() etter config-vinduet.';

-- --------------------------------------------------------------- outbound --
-- [1] pg_net er asynk: net.http_post gir en request_id med én gang, svaret
--     kommer senere i net._http_response — og den ryddes etter noen timer.
--     Derfor tofase: net_request_id ved send, wa_message_id ved reconcile.
create table if not exists mai.outbound (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references mai.users (id) on delete cascade,
  kind           text not null default 'freeform' check (kind in ('freeform', 'template')),
  template_name  text,
  body           text,
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'queued'
                 check (status in ('queued', 'sending', 'sent', 'failed', 'dead')),
  scheduled_for  timestamptz not null default now(),
  attempts       int not null default 0,
  net_request_id bigint,
  wa_message_id  text,
  last_error     text,
  sent_at        timestamptz,
  reconciled_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint outbound_template_needs_name
    check (kind <> 'template' or template_name is not null)
);

create index if not exists outbound_due_idx on mai.outbound (status, scheduled_for);
create index if not exists outbound_net_req_idx on mai.outbound (net_request_id)
  where net_request_id is not null;

comment on column mai.outbound.net_request_id is
  '[1] Fase 1: pg_net request-id. Fase 2 kopierer wa_message_id hit fra svaret.';
comment on column mai.outbound.wa_message_id is
  '[1] Må hentes ut av net._http_response FØR den ryddes, ellers mister vi '
  'koblingen til WhatsApp sine delivery-webhooks.';

-- ------------------------------------------------------- outbound dagscap --
-- [4] Capen håndheves i databasen. Ligger den bare i worker-logikk, blåser en
--     cron-overlapp eller en pgmq-retry rett gjennom den.
create table if not exists mai.outbound_daily (
  user_id    uuid not null references mai.users (id) on delete cascade,
  day        date not null,
  sent_count int  not null default 0 check (sent_count >= 0),
  primary key (user_id, day)
);

-- Atomisk: UPDATE-en teller bare opp hvis den er under taket, så to samtidige
-- workere ikke kan begge se "1 av 2" og begge sende.
create or replace function mai.claim_outbound_slot(p_user uuid, p_day date default current_date)
returns boolean
language plpgsql
as $$
declare
  v_max   int;
  v_count int;
begin
  select max_outbound_per_day into v_max from mai.config where id;

  insert into mai.outbound_daily (user_id, day, sent_count)
  values (p_user, p_day, 0)
  on conflict (user_id, day) do nothing;

  update mai.outbound_daily
     set sent_count = sent_count + 1
   where user_id = p_user
     and day     = p_day
     and sent_count < v_max
  returning sent_count into v_count;

  return v_count is not null;
end;
$$;

comment on function mai.claim_outbound_slot(uuid, date) is
  '[4] Returnerer false når dagens cap er brukt opp. Kall FØR enhver utgående '
  'melding — dette er quality-rating-vernet, ikke en preferanse.';

-- ------------------------------------------------------------- WA-token ----
-- [2] Tokenet ligger i Vault, aldri i tabell og aldri i denne fila.
--     Opprettes utenfor migrasjonen:
--       select vault.create_secret('EAAG...', 'wa_access_token');
create or replace function mai.wa_token()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'wa_access_token'
   limit 1;
$$;

revoke all on function mai.wa_token() from public, anon, authenticated;

comment on function mai.wa_token() is
  '[2] Leser WA-tokenet fra Vault. Secret må opprettes manuelt før skive 1 sender.';

-- ------------------------------------------------------------------- DLQ ---
-- [5] pgmq gir gratis retry via visibility timeout, men en melding som alltid
--     feiler (ugyldig nummer, avvist template) looper i det uendelige.
create or replace function mai.fail_outbound(p_id bigint, p_error text)
returns text
language plpgsql
as $$
declare
  v_max      int;
  v_attempts int;
begin
  select outbound_max_attempts into v_max from mai.config where id;

  update mai.outbound
     set attempts   = attempts + 1,
         last_error = p_error,
         status     = case when attempts + 1 >= v_max then 'dead' else 'failed' end,
         updated_at = now()
   where id = p_id
  returning attempts into v_attempts;

  if v_attempts is null then
    return 'missing';
  end if;

  if v_attempts >= v_max then
    perform pgmq.send('mai_outbound_dlq', jsonb_build_object('outbound_id', p_id, 'error', p_error));
    return 'dead';
  end if;

  return 'retry';
end;
$$;

comment on function mai.fail_outbound(bigint, text) is
  '[5] Teller forsøk og flytter til DLQ ved makstak i stedet for evig retry.';

-- ------------------------------------------------------------------ tick ---
-- [C] Én global tick, ikke én cron-jobb per bruker.
-- [4] Advisory lock: pg_cron hindrer ikke overlappende kjøringer av samme jobb
--     hvis en runde tar lengre tid enn intervallet.
create or replace function mai.tick()
returns int
language plpgsql
as $$
declare
  v_locked boolean;
  v_queued int := 0;
begin
  select pg_try_advisory_lock(hashtext('mai.tick')::bigint) into v_locked;
  if not v_locked then
    return -1;  -- forrige runde kjører fortsatt; hopp over stille
  end if;

  begin
    -- Skive 1 er inbound-only: ingen cues å plukke ennå.
    -- Skive 2 fyller inn her: velg forfalte cues i UTC, sjekk paused_until /
    -- opted_out_at / quiet hours, claim_outbound_slot(), pgmq.send().
    v_queued := 0;
  exception when others then
    perform pg_advisory_unlock(hashtext('mai.tick')::bigint);
    raise;
  end;

  perform pg_advisory_unlock(hashtext('mai.tick')::bigint);
  return v_queued;
end;
$$;

comment on function mai.tick() is
  '[C] Global 5-min tick. Returnerer -1 når forrige runde fortsatt holder låsen.';

-- ------------------------------------------------------------- retention ---
create or replace function mai.purge_raw_bodies()
returns int
language plpgsql
as $$
declare
  v_days int;
  v_n    int;
begin
  select raw_body_retention_days into v_days from mai.config where id;

  update mai.events
     set body = null
   where body is not null
     and occurred_at < now() - make_interval(days => v_days);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function mai.purge_raw_bodies() is
  'Personvern: nuller rå meldingstekst etter config-vinduet. Events beholdes.';

-- ------------------------------------------------------------------- RLS ---
-- Ingen policies: alt går via Edge Function med service_role, som omgår RLS.
-- RLS på + null policies = default deny for anon/authenticated.
alter table mai.config         enable row level security;
alter table mai.users          enable row level security;
alter table mai.events         enable row level security;
alter table mai.outbound       enable row level security;
alter table mai.outbound_daily enable row level security;

-- ----------------------------------------------------------------- queues --
do $$
begin
  perform pgmq.create('mai_outbound');
exception when others then null;  -- allerede opprettet
end $$;

do $$
begin
  perform pgmq.create('mai_outbound_dlq');
exception when others then null;
end $$;

-- ------------------------------------------------------------------- cron --
-- SIST: den planlagte SQL-en refererer funksjonene over. Scheduler du før de
-- finnes, feiler jobben stille hvert intervall til noen leser cron-loggen.
select cron.schedule('mai-tick', '*/5 * * * *', $$select mai.tick()$$);
select cron.schedule('mai-purge-raw-bodies', '17 3 * * *', $$select mai.purge_raw_bodies()$$);
