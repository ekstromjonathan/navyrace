# lodd.ai PT — iMessage personal trainer

Journal + Linq webhook. The Vite app is unchanged. V1 is one allowlisted phone, inbound-first, SQLite locally.

## Model

OpenRouter. Floor: `PT_MODEL` (e.g. `x-ai/grok-4.3`). Programmer hat: `PT_MODEL_SMART` (`x-ai/grok-4.6`) writes draft plans only.

Obvious logs skip the model. Drafts go live only after `kjør programmet`.

## Memory

Journal (tracks, entries, notes, facts) is the source of truth. iMessage is not dumped.

A rolling `message_log` keeps the last ~50 turns per user (bodies truncated to 500 chars). The floor coach sees the last 8 as working memory so short follow-ups like «ja» / «den» / «ok» resolve. Heuristic logs (water, plunge, RPE) still skip the model.

## Reminders

If you ask the PT to remind you (e.g. «minn meg på å trene kl 8»), it stores a daily ping in `reminders` and the process sends one iMessage at that local time (`Europe/Oslo`).

- Skips the day if you already logged a training entry, or if you opted out.
- Catch-up window is 3 hours (process down at 08:00 can still ping at 10:00, not at 22:00).
- «slutt å minne meg» turns it off.
- Only fires while `npm start` is running.

## Hosting

Railway auto-deploys `main` to [lodd.ai](https://lodd.ai). The root `Dockerfile` runs this PT (webhook + scheduler) and serves the Vite app from the same process so `/webhook` is not swallowed by the static host.

After a `main` deploy, `GET https://lodd.ai/health` must return JSON (`ok: true`). Then:

```bash
linq webhooks create --url https://lodd.ai/webhook --events message.received
```

Set these in the Railway service variables (not in git): `LINQ_API_TOKEN`, `OPENROUTER_API_KEY`. Attach a volume if you want the SQLite journal to survive redeploys (`RAILWAY_VOLUME_MOUNT_PATH` is picked up automatically).

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

| Action | Phrase (exact) |
|---|---|
| Activate a draft program | `kjør programmet` / `run the program` (twice: first shows summary) |
| Archive the active program | `arkiver og lag nytt` / `archive and start new` (twice) |
| Archive one log | `slett siste` / `fjern loggen` / `delete the last log` (no extra confirm) |
| Daily training reminder | `minn meg på å trene kl 8` / `remind me to train at 8` |
| Cancel reminder | `slutt å minne meg` / `stop reminding me` |

Nothing is hard-deleted. Program and individual log archives stay in the same DB.

## iMessage rules baked in

Opt-out keywords first, one reply per inbound, contact card at most daily, `chat_id` as user key, webhook HMAC when `LINQ_WEBHOOK_SECRET` is set, dedup on `event_id` + `message.id`. Daily reminders are the only unsolicited outbound, and only after you asked.
