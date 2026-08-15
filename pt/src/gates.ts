/** Soft confirm to lock a draft — normal chat assent, not a destructive gate. */
export const ACTIVATE_PHRASE =
  /^(ja|jepp|yes|yep|ok|okay|sure|kjør|kjør det|kjør programmet|kjør opplegget|låse?|låses?|run|run it|run the program|lock|lock it|lock the program|godkjenn|sett i gang|begynn|start|start da|start nå|la oss (kjøre|starte|begynne)|let'?s (go|start|run( it)?))$/i;

/** Longer affirmations that clearly mean “lock it / start training”. */
const ACTIVATE_INTENT =
  /\b(kjør( programmet| opplegget| det)?|låse? (det|programmet)|run the program|lock (it|the program)|sett i gang|la oss (kjøre|starte|begynne)|vi kan begynne|klar til å (kjøre|starte)|ready to (go|start|run))\b/i;

export const ARCHIVE_PHRASE = /^(arkiver og lag nytt|archive and start new)$/i;

const ACTIVATE_CANCEL =
  /^(nei|no|nope|avbryt|ikke nå|ikke enda|vent|cancel|never ?mind|drop it|ikke lås)$/i;

export function isActivatePhrase(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 160) return false;
  if (ACTIVATE_PHRASE.test(t)) return true;
  if (/^(ja|jepp|yes|yep|ok|okay)\b/i.test(t) && ACTIVATE_INTENT.test(t)) return true;
  // “Vi kan begynne …?” is assent to start, even as a question.
  if (/\b(vi kan begynne|la oss (kjøre|starte|begynne)|klar til å (kjøre|starte)|ready to (go|start|run))\b/i.test(t)) {
    return true;
  }
  if (ACTIVATE_INTENT.test(t) && !/\?/.test(t)) return true;
  return false;
}

export function isActivateCancel(body: string): boolean {
  return ACTIVATE_CANCEL.test(body.trim());
}

export function isArchivePhrase(body: string): boolean {
  return ARCHIVE_PHRASE.test(body.trim());
}
