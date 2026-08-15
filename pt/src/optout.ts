/** Opt-out must run before parser/LLM. Linq keywords + Norwegian intent. */

const LINQ_EXACT = new Set(["STOP", "UNSUBSCRIBE", "OPTOUT", "CANCEL", "END", "QUIT"]);

export function isLinqKeywordOptOut(body: string): boolean {
  const text = body.trim();
  if (LINQ_EXACT.has(text)) return true;
  return /^opt[-\s]?out$/i.test(text);
}

export function isConversationalOptOut(body: string): boolean {
  const t = body.trim().toLowerCase();
  if (!t) return false;
  return (
    /^(stopp|stop|slutt)$/i.test(t) ||
    /slutt å skrive/.test(t) ||
    /ikke (skriv|kontakt|send)/.test(t) ||
    /stop messaging me/.test(t) ||
    /don't text me/.test(t) ||
    /ikke kontakt meg/.test(t)
  );
}

export function isOptOut(body: string): boolean {
  return isLinqKeywordOptOut(body) || isConversationalOptOut(body);
}
