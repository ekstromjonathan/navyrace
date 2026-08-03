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

`store`-shimen øverst i `NavyRaceTrainer.jsx` bruker `window.storage` når den finnes
(Claude-artifact-miljøet), ellers et in-memory-objekt. Utenfor artifact-miljøet betyr
det at fremdrift **ikke overlever en refresh**. Neste steg er å bytte fallbacken til
`localStorage`, eventuelt synke til Supabase for historikk på tvers av enheter.
