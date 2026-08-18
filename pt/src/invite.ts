/** Name + yes/no for the owner waitlist gate. */

export function extractApplicantName(body: string): string | null {
  const text = body.trim();
  if (!text) return null;

  const labeled =
    text.match(/^(?:navn|name)\s*:\s*([^\n,]+)/im) ||
    text.match(/\b(?:navn|name)\s*:\s*([^\n,]+)/i);
  if (labeled) return cleanName(labeled[1]);

  const heter = text.match(
    /\b(?:jeg heter|mitt navn er|eg heiter|jag heter|mitt namn är)\s+([A-Za-zÆØÅæøåÄÖäöÉé]+(?:[ \t]+[A-Za-zÆØÅæøåÄÖäöÉé\-]+){0,3})/i,
  );
  if (heter) return cleanName(heter[1]);

  const english = text.match(
    /\b(?:my name is|i am|i'm)\s+([A-Za-zÆØÅæøåÄÖäöÉé]+(?:[ \t]+[A-Za-zÆØÅæøåÄÖäöÉé\-]+){0,3})/i,
  );
  if (english) return cleanName(english[1]);

  const named = text.match(/\b(?:jeg er|eg er)\s+([A-ZÆØÅÄÖÉ][A-Za-zÆØÅæøåÄÖäöé\-]+)/);
  if (named) return cleanName(named[1]);

  return null;
}

function cleanName(raw: string): string | null {
  const cut = raw.replace(/\s+/g, " ").replace(/[.:;!?]+$/g, "").trim();
  const parts: string[] = [];
  for (const word of cut.split(" ")) {
    if (/^(og|and|och)$/i.test(word)) break;
    parts.push(word);
  }
  const name = parts.join(" ").trim();
  if (!name || name.length < 2 || name.length > 60) return null;
  if (/^(jeg|eg|hei|hi|hey|pt|lodd|ja|nei|ok|the|a)$/i.test(name)) return null;
  return name[0].toUpperCase() + name.slice(1);
}

export function isInviteYes(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 80) return false;
  return /^(ja|jepp|yes|yep|ja takk|slipp inn|slip inn|slipp henne inn|slip henne inn|godkjenn|let them in|admit)([.!]*)?$/i.test(
    t,
  );
}

export function isInviteNo(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 80) return false;
  return /^(nei|nej|no|nope|avvis|nei takk|ikke|ikke slipp inn|deny)([.!]*)?$/i.test(t);
}
