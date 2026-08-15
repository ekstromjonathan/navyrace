# AGENTS.md

## Cursor Cloud specific instructions

This repo is a **Vite + React 19** training app ("MAI/Navy Race TRAINER") plus an optional iMessage PT in `pt/`. Package manager is **npm**; Node 22 is used in CI. Frontend CI (`.github/workflows/deploy.yml`) runs `npm ci` + `npm run build`. PT tests live in `.github/workflows/pt.yml`.

### iMessage PT (`pt/`)

Separate Node service (Hono + SQLite journal + Linq webhook). Not started by default.

```bash
cd pt && npm install && npm test && npm start   # http://localhost:8787/webhook
```

Forward events with `linq webhooks listen --forward-to http://localhost:8787/webhook`. See `pt/README.md`.

### Services / commands

The Vite frontend is the original app. All commands are the standard scripts in `package.json`:

- Dev server: `npm run dev` → http://localhost:5173 (this is what to run for development).
- Build: `npm run build` (outputs to `dist/`).
- Preview a build: `npm run preview`.

The dev server is started for you as the `vite` terminal on startup; it does not auto-expose to the network (no `--host`).

### Storage / Supabase (non-obvious)

- Cloud sync via Supabase is **optional and off by default**. Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `.env.example`), the app runs localStorage-only and is fully functional — no setup needed to develop or test the core flow.
- App state persists in `localStorage` under key `navyrace:v1`. To re-trigger the first-run onboarding flow during manual testing, clear that key (or use a fresh/incognito browser profile), since a completed profile skips onboarding on reload.
- The Supabase keys committed in `deploy.yml` are public client keys (access control lives in Supabase RLS), so they are safe to see there.

### Testing note

The main flow to exercise is the chat-style onboarding, which generates a weekly training program and lands on the workout dashboard.
