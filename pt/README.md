# lodd.ai PT — iMessage personal trainer

Journal + Linq webhook. The Vite app is unchanged. V1 is one allowlisted phone, inbound-first.

## Storage

Production journal is **Supabase Postgres** (`pt` schema). Set:

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...   # Settings → API Keys → Secret keys (never ship to the browser)
# Legacy: SUPABASE_SERVICE_ROLE_KEY=eyJ...  (Legacy API Keys tab) still works
```

Supabase renamed keys: new projects show **Secret keys** (`sb_secret_…`) instead of a `service_role` JWT. Same privileges (bypasses RLS). Find them under [Settings → API Keys](https://supabase.com/dashboard/project/_/settings/api-keys) — use the **API Keys** tab (create if needed), or **Legacy API Keys** for the old JWT.

Apply migrations `supabase/migrations/0003_pt_journal.sql` … `0008_pt_reminder_url.sql`, then expose schema `pt` under Project Settings → API → Exposed schemas (or Data API settings).

Without those env vars the process falls back to local SQLite (`PT_DB_PATH`) so unit tests stay offline.

User rows store `chat_id` + `phone_e164`. Tracks, entries, notes, `message_log`, and reminders all reference `users.id`.

## Model

OpenRouter. Floor: `PT_MODEL` (e.g. `x-ai/grok-4.3`). Programmer hat: `PT_MODEL_SMART` (`x-ai/grok-4.6`) writes draft plans only.

Obvious logs skip the model. Drafts go live after a normal yes/ok/kjør (soft confirm).

## Memory

Journal (tracks, entries, notes, facts) is the source of truth. iMessage is not dumped.

A rolling `message_log` keeps the last ~50 turns per user (bodies truncated to 500 chars). The floor coach sees the last 8 as working memory so short follow-ups like «ja» / «den» / «ok» resolve. Heuristic logs (water, plunge, RPE) still skip the model.

## Reminders

If you ask the PT to remind you (e.g. «minn meg på å trene kl 8» or «kl 19 i kveld»), it sets the ping immediately and confirms briefly — no extra confirmation gate. The process sends one iMessage at that local time (`Europe/Oslo`).

- Daily (default, or «hver dag»): skips the day if you already logged a training entry, or if you opted out.
- One-shot (`once_on`, from «i kveld» / «i dag» / «bare i dag»): fires on that local calendar day only, then turns itself off.
- Video/link (optional `url` on reminder): include a YouTube or other URL — ping sends the link; fires even if you already trained that day.
- Catch-up window is 3 hours (process down at 08:00 can still ping at 10:00, not at 22:00).
- «slutt å minne meg» turns it off.
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
| Daily training reminder | `minn meg på å trene kl 8` / `remind me to train at 8` (or «hver dag») |
| One-shot reminder | `…kl 19 i kveld` / `bare i dag` / `tonight` — set immediately |
| Cancel reminder | `slutt å minne meg` / `stop reminding me` |
| Video reminder | Send a link + `minn meg kl 19 om å se videoen` — or just the link, then reply with a time |

Locking a program is ordinary assent. Only archiving the whole program uses a strict phrase. Nothing is hard-deleted.

## Product patterns (future changes)

These are the choices from recent PT work (#16–#19). Prefer them unless the product owner overrides.

1. **Confirmation ladder** — Destructive → strict phrase. Lock/activate → soft `ja`/`ok`/`kjør`. Set reminder / log / similar → immediate action + short confirm. Never invent an ask-gate for non-destructive flows. Exception: if a session log has no clear day (`i dag` / `i går` / `nå`), ask once which day — then log.
2. **Pending is sticky for soft confirms** — Clarifying questions (“more details?”) must not clear `activate_confirm`. Soft cancel only on clear nei/avbryt. `log_day` / `rpe_followup` are sticky until answered or clearly cancelled.
3. **Infer from wording** — e.g. `i kveld`/`i dag` → one-shot reminder; `hver dag` or bare `minn meg kl 8` → daily. Prefer inference over a second turn.
4. **Journal over chat dump** — Persist facts/notes/entries; use `message_log` + `recall_chat` for short follow-ups. LLM coach may fail: degrade to journal answers (`today`/program) with clearer provider errors when possible. Free-form sessions (“gjorde økt”, kettlebell, etc.) must `log_entry` even when they diverge from the plan (`session_ref` plan id vs `extra:YYYY-MM-DD`).
5. **Delivery debugging** — Check `/health`, `pt.webhook_events`, `pt.message_log` before assuming Linq is broken. `agentError` copy means the model path failed after inbound was accepted.
6. **Tone** — Short iMessage replies, one next action, assume training will happen; no mid-chat re-intros or re-asks for fields already in facts.

## iMessage rules baked in

Opt-out keywords first, one reply per inbound, contact card at most daily, `chat_id` as user key, webhook HMAC when `LINQ_WEBHOOK_SECRET` is set, dedup on `event_id` + `message.id`. Daily reminders are the only unsolicited outbound, and only after you asked.
