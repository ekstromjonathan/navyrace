# MAI PT — iMessage personal trainer

Journal + Linq webhook. The Vite app is unchanged. V1 is one allowlisted phone, inbound-first, SQLite locally.

## Model

OpenRouter. Floor: `PT_MODEL` (e.g. `x-ai/grok-4.1-fast`). Programmer hat: `PT_MODEL_SMART` (`x-ai/grok-4.6`) writes draft plans only.

Obvious logs skip the model. Drafts go live only after `kjør programmet`.

## Memory

Journal (tracks, entries, notes, facts) is the source of truth. iMessage is not dumped.

A rolling `message_log` keeps the last ~50 turns per user (bodies truncated to 500 chars). The floor coach sees the last 8 as working memory so short follow-ups like «ja» / «den» / «ok» resolve. Heuristic logs (water, plunge, RPE) still skip the model.

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
| Activate a draft program | `kjør programmet` (twice: first shows summary) |
| Archive the active program | `arkiver og lag nytt` (twice: first shows what would be archived) |

Nothing is hard-deleted. Archives stay in the same DB.

## iMessage rules baked in

Opt-out keywords first, one reply per inbound, contact card at most daily, `chat_id` as user key, webhook HMAC when `LINQ_WEBHOOK_SECRET` is set, dedup on `event_id` + `message.id`.
