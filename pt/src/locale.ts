export type Lang = "nb" | "en";

const NB_RE =
  /\b(jeg|ikke|hva|hvordan|trene|trening|minn|kjør|hei|påminnelse|økt|vann|mediterte|kaldt|programmet|arkiver|slutt|i dag|er vi|påminn)\b|[æøåÆØÅ]/gi;
const EN_RE =
  /\b(the|you|are|what|train|training|remind|hello|hey|hi|we|today|workout|please|don't|program|log|logged|water|meditation)\b/gi;

export function isLang(v: unknown): v is Lang {
  return v === "nb" || v === "en";
}

export function detectLang(text: string): Lang | null {
  const t = text.trim();
  if (!t) return null;
  const nb = t.match(NB_RE)?.length ?? 0;
  const en = t.match(EN_RE)?.length ?? 0;
  if (nb === 0 && en === 0) return null;
  if (nb > en) return "nb";
  if (en > nb) return "en";
  return null;
}
