export type Lang = "nb" | "en" | "sv";

const NB_RE =
  /\b(jeg|ikke|hva|hvordan|trene|trening|minn|kjør|hei|påminnelse|økt|vann|mediterte|kaldt|programmet|arkiver|slutt|i dag|er vi|påminn|være)\b|[æøÆØ]/gi;
const SV_RE =
  /\b(jag|inte|heter|träna|träning|påminn|mig|varje|kväll|idag|igår|vill|vara|hej|passet|släpp)\b|[äöÄÖ]/gi;
const EN_RE =
  /\b(the|you|are|what|train|training|remind|hello|hey|hi|we|today|workout|please|don't|program|log|logged|water|meditation)\b/gi;

export function isLang(v: unknown): v is Lang {
  return v === "nb" || v === "en" || v === "sv";
}

export function detectLang(text: string): Lang | null {
  const t = text.trim();
  if (!t) return null;
  const nb = t.match(NB_RE)?.length ?? 0;
  const sv = t.match(SV_RE)?.length ?? 0;
  const en = t.match(EN_RE)?.length ?? 0;
  const best = Math.max(nb, sv, en);
  if (best === 0) return null;
  if (sv === best && sv > nb && sv > en) return "sv";
  if (nb === best && nb > sv && nb > en) return "nb";
  if (en === best && en > nb && en > sv) return "en";
  return null;
}
