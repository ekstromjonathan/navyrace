# lodd.ai PT — iMessage personal trainer

Journal + Linq webhook. The Vite app is unchanged. Unknown numbers stay silent until the owner admits them.

## Storage

Production journal is **Supabase Postgres** (`pt` schema). Set:

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...   # Settings → API Keys → Secret keys (never ship to the browser)
# Legacy: SUPABASE_SERVICE_ROLE_KEY=eyJ...  (Legacy API Keys tab) still works
```

Supabase renamed keys: new projects show **Secret keys** (`sb_secret_…`) instead of a `service_role` JWT. Same privileges (bypasses RLS). Find them under [Settings → API Keys](https://supabase.com/dashboard/project/_/settings/api-keys) — use the **API Keys** tab (create if needed), or **Legacy API Keys** for the old JWT.

Apply migrations `supabase/migrations/0003_pt_journal.sql` … `0011_pt_coach_quality.sql`, then expose schema `pt` under Project Settings → API → Exposed schemas (or Data API settings).

Without those env vars the process falls back to local SQLite (`PT_DB_PATH`) so unit tests stay offline.

User rows store `chat_id` + `phone_e164`. Tracks, entries, notes, `message_log`, and reminders all reference `users.id`.

## Data layer

Production journal is **Supabase** schema `pt` (project `lodd.ai`). SQLite is tests-only.

| Table | Role |
|---|---|
| `users` | chat_id, phone, facts (goal/days/gear), **pending** (sticky ask), locale |
| `tracks` | programs (draft/active/archived) + plan JSON |
| `entries` | logs (training, water, …) — never hard-deleted |
| `notes` | short PT memory |
| `reminders` | daily/once ping + optional url |
| `message_log` | last ~50 turns (working memory, not truth) |
| `webhook_events` / `processed_messages` | idempotency |
| `invites` | unknown numbers until owner says ja |

## Receive pipeline

Inbound iMessage is **not** handed raw to the LLM.

1. **Mottak** — admit / opt-out / invite, persist the user line.
2. **Rute** — if pending is a *real* answer (klokke, ja/kjør, lett/passe), commit it. If pending is stale (e.g. waiting for a video time but they asked «er du våken?»), attach the URL to an existing reminder and **continue**.
3. **Verktøy / lagring / henting** — log, set reminder, ease/swap, then load the journal packet (facts, today, week, reminders, recent chat).
4. **LLM svarer** — Grok writes from that packet. **No tool calls** on the talk path. Programmer-hat tools stay for onboarding drafts.

Keys you already have (no extras): `OPENROUTER_API_KEY`, `PT_MODEL` / `PT_MODEL_SMART`, `SUPABASE_URL` + `SUPABASE_SECRET_KEY`, `LINQ_API_TOKEN`. Anthropic is optional fallback only. `/health` should show `provider: openrouter`, `chatModel: x-ai/grok-4.6`, `journal: supabase`.

## Model

OpenRouter **Chat Completions**. Conversation: `PT_MODEL_SMART` (`x-ai/grok-4.6`) when set, else `PT_MODEL` (`x-ai/grok-4.3`). The talk path does not use Anthropic `/v1/messages` or tool-calling — those failed on Grok and made every reply a canned loop.

Obvious logs (water, plunge, session done, reminders with a clock) still skip the model and confirm immediately. Questions go through the packet → Grok. Drafts lock with ja/ok/kjør.

## Memory

Journal (tracks, entries, notes, facts) is the source of truth. iMessage is not dumped.

A rolling `message_log` keeps the last ~50 turns per user (bodies truncated to 500 chars). The floor coach sees the last 8 as working memory so short follow-ups like «ja» / «den» / «ok» resolve. Heuristic logs (water, plunge, RPE) still skip the model.

## Waitlist

`LINQ_ALLOWLIST` is the **owner** (always admitted). Everyone else can text the PT number; they get **no reply** until you say yes.

1. Inger texts the PT (`+14044465379`) — silence on her side.
2. You get: `Inger vil være med. Skal jeg slippe henne inn?`
3. Reply `ja` — she is approved, stored as a member, and the PT texts her our welcome, then shares the iMessage name + photo (`lodd.ai` and the brand avatar).
4. `nei` — she stays out, still no reply to her.

Name is inferred from the first message (`jeg heter Inger`, landing `Hei, jeg heter Inger. Jeg vil også bli den beste versjonen av meg selv. Kan jeg få bli med?`). Otherwise the ask uses the phone number. Further messages from a waiting sender do not ping you again.

## Reminders

If you ask the PT to remind you (e.g. «minn meg på å trene kl 8» or «kl 19 i kveld»), it sets the ping immediately and confirms briefly — no extra confirmation gate. **Several reminders can be on at once** (morning training, evening video, meditation, one-shot tonight). Identity is routine (`slug`) + clock + daily/once.

- Daily (default, «hver dag» / «hver kveld»): training pings skip the day if you already logged a session. Other routines still fire.
- One-shot (`once_on`, from «i kveld» / «i dag» / «bare i dag»): fires on that local calendar day only, then turns itself off.
- Video/link: include a URL — ping sends the link; fires even if you already trained. A bare link attaches to the only live reminder, or to an existing video reminder; otherwise it asks for a time.
- Catch-up window is 3 hours (process down at 08:00 can still ping at 10:00, not at 22:00).
- «slutt å minne meg» turns all off. «slutt å minne meg på videoen» / «ikke minn meg kl 8» turns off that one.
- Only fires while `npm start` is running.

## Hosting

Railway auto-deploys `main` to [lodd.ai](https://lodd.ai). The root `Dockerfile` runs this PT (webhook + scheduler) and serves the Vite app from the same process so `/webhook` is not swallowed by the static host.

**Railway service settings that must stay true:** Root Directory empty (repo root), Builder = Dockerfile. Do not set Root Directory to `pt/` — that ships the webhook without the landing page (`spa: false`, `/` → 404). Apex HTTPS is handled by Railway/Let’s Encrypt; add `www.lodd.ai` as a custom domain in Railway if you want www (otherwise the cert won’t cover it).

After a `main` deploy, `GET https://lodd.ai/health` must return JSON (`ok: true`, `spa: true`). Then:

```bash
linq webhooks create --url https://lodd.ai/webhook --events message.received
```

Set these in the Railway service variables (not in git): `LINQ_API_TOKEN`, `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`). A Railway volume is optional now (only needed if you still run without Supabase).

## Run locally

```bash
cd pt
cp .env.example .env
# LINQ_API_TOKEN from `linq tokens show` or ../.env.local
# ANTHROPIC_API_KEY for free-form coaching
npm install
npm test
npm start
```

In another terminal:

```bash
linq webhooks listen --forward-to http://localhost:8787/webhook
```

Text `+14044465379` from the allowlisted number.

## Confirmation

| Action | How |
|---|---|
| Activate a draft program | Soft confirm: `ja` / `ok` / `kjør` / `run it` (also works as a direct command when a draft exists) |
| Archive the active program | Exact: `arkiver og lag nytt` / `archive and start new` |
| Archive one log | `slett siste` / `fjern loggen` / `delete the last log` (no extra confirm) |
| Daily / one-shot reminder | `minn meg på å trene kl 8` / `minn meg på meditasjon hver dag kl 7` / `…kl 19 i kveld` |
| Cancel reminder | `slutt å minne meg` (all) / `slutt å minne meg på videoen` / `ikke minn meg kl 8` |
| Video reminder | Send a link + `minn meg kl 19 om å se videoen` — or just the link, then reply with a time |
| Admit a waitlisted sender | Owner replies `ja` (or `nei`) to the invite ask |

Locking a program is ordinary assent. Only archiving the whole program uses a strict phrase. Nothing is hard-deleted.

## Product patterns (future changes)

These are the choices from recent PT work (#16–#19). Prefer them unless the product owner overrides.

1. **Confirmation ladder** — Destructive → strict phrase. Lock/activate → soft `ja`/`ok`/`kjør`. Set reminder / log / similar → immediate action + short confirm. Never invent an ask-gate for non-destructive flows. Exception: if a session log has no clear day (`i dag` / `i går` / `nå`), ask once which day — then log.
2. **Pending is sticky for soft confirms** — Clarifying questions (“more details?”) must not clear `activate_confirm`. Soft cancel only on clear nei/avbryt. `log_day` / `rpe_followup` are sticky until answered or clearly cancelled.
3. **Infer from wording** — e.g. `i kveld`/`i dag` → one-shot reminder; `hver dag` or bare `minn meg kl 8` → daily. Prefer inference over a second turn.
4. **Journal over chat dump** — Persist facts/notes/entries; use `message_log` + `recall_chat` for short follow-ups. LLM coach may fail: answer the question from the journal (week shape, yesterday vs today) — never dump today’s workout as a fake reply, and never repeat the same offer. If they already answered (`bytte` / `rolig dag` / «svarte nettopp»), do that. If the model is down: one honest line *and* a useful answer. Free-form sessions (“gjorde økt”, tennis, padling, “løp 7k”) must `log_entry` even when they diverge from the plan. Different activity **instead of** today’s slot fills `session_ref` with the plan id and `adapt_plan` updates the next days; `extra:YYYY-MM-DD` only when they said *i tillegg* or it was a rest day.
5. **Delivery debugging** — Check `/health`, `pt.webhook_events`, `pt.message_log` before assuming Linq is broken. `agentError` copy means the model path failed after inbound was accepted.
6. **Tone** — Short iMessage replies, one next action, assume training will happen; no mid-chat re-intros or re-asks for fields already in facts. Meet the user. Explain the greia. The coach cares.
7. **Onboarding** — Casual coach: “your new coach”, help them become a better version of themselves, then that you track whatever they send (workouts, habits, reminders), then one open question. No week-1 funnel, no feature tour. Later turns follow what they answered.
8. **Calendar days** — Sessions belong to weekdays (`day` 0=Mon…6=Sun). Rest days: recovery tips, never the next session. Bare hei/hallo: short dialogue + one-line hint, not the workout dump. Completed sessions: celebrate (Linq screen effect `confetti`).
9. **The plan is a starting point** — Locked program + lived training. Two of the same family in a row → explain and offer to swap, then *act* on bytte/rolig. Research: ping *«bra spørsmål, la meg sjekke litt»*, then answer.
10. **Coach contract + deterministic safety** — `coach-contract.ts` is shared by composer and agent: journal-grounded, autonomy-supportive, one useful next step, no shame or medical certainty. `safety.ts` intercepts only narrow explicit red flags before pending/LLM, sends one emergency-oriented reply, preserves pending context, and records a structured `coach_events` row without copying the raw message.

## Quality and privacy foundation

- `test/coach-quality.test.ts` keeps product-level golden scenarios for lapse recovery, pain, low time, ambivalence, pride, resistance, memory repair, rest days, reminders, and model failure. It checks behavioral invariants rather than exact prose.
- `pt.coach_events` stores compact outcomes (`kind`, `source`, references, small JSON metadata). Raw message bodies belong only in the rolling `message_log`; never duplicate them into analytics metadata.
- `/vilkar/` describes the AI/wellness boundary, categories of data used, model/provider processing, emergency limits, and how a user requests access, correction, export, or deletion.
- The deterministic router is deliberately narrow. Ordinary soreness and non-urgent pain stay in the coaching flow; a model must never diagnose or declare it safe to continue.

## iMessage rules baked in

Opt-out keywords first, one reply per inbound, `chat_id` as user key, webhook HMAC when `LINQ_WEBHOOK_SECRET` is set, dedup on `event_id` + `message.id`. After the first outbound in a chat we share Linq’s iMessage contact card (name + photo only — not a linqapp.com page). First outbound to a new member is `inviteWelcome`. Unsolicited outbound: owner-requested reminders, and one invite ask to the owner when someone new texts in.
