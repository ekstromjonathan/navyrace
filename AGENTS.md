# AGENTS.md

## Cursor Cloud specific instructions

This repo is a **Vite + React 19** app (Norwegian fitness training app, "MAI/Navy Race TRAINER") with a static landing page at `/` (lodd.ai). The trainer lives at `/app/`. Package manager is **npm** (`package-lock.json`); Node 22 is used in CI. There is no separate backend to run and there are **no lint or automated test scripts** — CI (`.github/workflows/deploy.yml`) only runs `npm ci` + `npm run build`.

### Services / commands

Only one service — the Vite frontend. All commands are the standard scripts in `package.json`:

- Dev server: `npm run dev` → http://localhost:8080 (this is what to run for development; not 3000).
- Build: `npm run build` (outputs to `dist/`).
- Preview a build: `npm run preview`.

The dev server is started for you as the `vite` terminal on startup; it does not auto-expose to the network (no `--host`).

### Storage / Supabase (non-obvious)

- Cloud sync via Supabase is **optional and off by default**. Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `.env.example`), the app runs localStorage-only and is fully functional — no setup needed to develop or test the core flow.
- App state persists in `localStorage` under key `navyrace:v1`. To re-trigger the first-run onboarding flow during manual testing, clear that key (or use a fresh/incognito browser profile), since a completed profile skips onboarding on reload.
- The Supabase keys committed in `deploy.yml` are public client keys (access control lives in Supabase RLS), so they are safe to see there.

### Testing note

The landing (`/`) is the iMessage signup. The Navy Race trainer is at `/app/`. Terms live at `/vilkar/`. The trainer flow to exercise is chat-style onboarding, which generates a weekly training program and lands on the workout dashboard.
