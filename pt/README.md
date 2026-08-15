# MAI PT — iMessage personal trainer

Journal + Linq webhook. The Vite app is unchanged. V1 is one allowlisted phone, inbound-first, SQLite locally.

## Model

**Claude Sonnet 4.6 via OpenRouter** (`anthropic/claude-sonnet-4.6`) for both hats. Set `OPENROUTER_API_KEY`. Direct `ANTHROPIC_API_KEY` is a fallback.

- Floor PT (every unclear message): tools against the journal
- Programmer (rare): same model writes a **draft** plan; it does not go live until you text `kjør programmet`

Obvious logs (`mediterte i 30 sekunder`, `drakk et glass`, `lett`/`passe`/`brutalt`) skip the model.

Set `ANTHROPIC_API_KEY`. Override with `PT_MODEL` if needed.

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
