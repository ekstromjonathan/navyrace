# Navy Race · 10

10-ukers treningsprogram for Navy Race — løping, styrke, hinder og drivstoffplan.
React-app, opprinnelig bygget som en Claude-artifact og nå pakket som et Vite-prosjekt.

## Kjøre lokalt

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # produksjonsbygg til dist/
npm run preview  # server dist/ lokalt
```

## Struktur

| Fil | Innhold |
|-----|---------|
| `src/NavyRaceTrainer.jsx` | Hele appen — programdata, økter, timer og CSS i én komponent |
| `src/main.jsx` | React-rot, monterer appen |
| `index.html` | Vite-entrypoint |

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

State lagres under nøkkelen `navyrace:v1` som `{ index, logs }` — hvilken økt du står
på, og RPE-loggen per fullførte økt. Lagringen er per enhet; Supabase-synk for historikk
på tvers av telefon og laptop er neste steg hvis det trengs.
