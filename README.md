# Navy Race · 10

10-ukers treningsprogram for Navy Race — løping, styrke, hinder og drivstoffplan.
React-app, opprinnelig bygget som en Claude-artifact og nå pakket som et Vite-prosjekt.

## Kjøre lokalt

```bash
npm install
npm run dev      # http://localhost:8080
```

```bash
npm run build    # produksjonsbygg til dist/
npm run preview  # server dist/ lokalt
```

## Struktur

| Fil | Innhold |
|-----|---------|
| `index.html` | lodd.ai-landing — logo + to knapper |
| `signup/index.html` | iMessage-signup (fullside) |
| `vilkar/index.html` | Vilkår |
| `app/index.html` | Navy Race-appen |
| `src/NavyRaceTrainer.jsx` | Hele appen — programdata, økter, timer og CSS i én komponent |
| `src/main.jsx` | React-rot, monterer appen |

Eneste eksterne avhengigheter er `react`, `react-dom` og `lucide-react` (ikoner).
All styling ligger som en `CSS`-konstant i `NavyRaceTrainer.jsx` og injiseres via `<style>`.

## Lagring

`store`-shimen øverst i `NavyRaceTrainer.jsx` prøver tre nivåer i rekkefølge:

1. `window.storage` — Claude-artifact-miljøet, hvis appen kjøres der
2. `localStorage` — vanlig nettleser. Fremdrift overlever refresh
3. In-memory — siste utvei hvis `localStorage` er blokkert (Safari privat modus,
   avslått tredjeparts-lagring). Appen kjører, men husker ingenting

Nivå 2 sjekkes med en faktisk skrivetest, ikke bare `typeof`, fordi `localStorage`
kan finnes og likevel kaste ved skriving. Resultatet caches.

State lagres under nøkkelen `navyrace:v1` som `{ index, logs, updatedAt }` — hvilken økt
du står på, loggen per økt (RPE `lett` / `passe` / `brutalt`, eller `hoppet`), og
tidspunkt for last-write-wins. Hoppede økter teller ikke inn i dose-tilpasningen.

## Valgfri sky-synk (Supabase)

Uten env-variabler er synk av, og appen oppfører seg som localStorage-only.

```bash
# .env.local
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Schema: `supabase/migrations/0001_navyrace_progress.sql` (RLS: hver bruker leser/skriver
kun egen rad). Magic link-auth; redirect URL må inkludere appen sin origin.
