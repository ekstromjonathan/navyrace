/** Soft confirm to lock a draft — normal chat assent, not a destructive gate. */
export const ACTIVATE_PHRASE =
  /^(ja|jepp|yes|yep|ok|okay|sure|kjør|kjør det|kjør programmet|kjør opplegget|kör|kör det|kör programmet|låse?|låses?|run|run it|run the program|lock|lock it|lock the program|godkjenn|sett i gang|begynn|start|start da|start nå|la oss (kjøre|starte|begynne)|let'?s (go|start|run( it)?))$/i;

/** Longer affirmations that clearly mean “lock it / start training”. */
const ACTIVATE_INTENT =
  /\b(kjør( programmet| opplegget| det)?|låse? (det|programmet)|run the program|lock (it|the program)|sett i gang|la oss (kjøre|starte|begynne)|vi kan begynne|klar til å (kjøre|starte)|ready to (go|start|run))\b/i;

export const ARCHIVE_PHRASE = /^(arkiver og lag nytt|archive and start new|arkivera och gör nytt)$/i;

const ACTIVATE_CANCEL =
  /^(nei|nej|no|nope|avbryt|ikke nå|ikke enda|vent|cancel|never ?mind|drop it|ikke lås)$/i;

const REMINDER_DAILY =
  /^(hver dag|daglig|gjentagende|permanent|daily|every day|recurring)(\s+.*)?$/i;
const REMINDER_ONCE =
  /^(bare i dag|bare i kveld|kun i dag|kun i kveld|i dag|i kveld|engang|engangs|once|only today|only tonight|just today|just tonight|just once|today|tonight)(\s+.*)?$/i;
const REMINDER_SCOPE_CANCEL =
  /^(nei|no|nope|avbryt|glem det|ikke|cancel|never ?mind|drop it)$/i;

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

export function isReminderDailyReply(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 120) return false;
  if (REMINDER_DAILY.test(t)) return true;
  return /\b(hver dag|daglig|gjentagende|every day|daily|recurring)\b/i.test(t);
}

export function isReminderOnceReply(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 120) return false;
  if (REMINDER_ONCE.test(t)) return true;
  return /\b(bare i dag|bare i kveld|kun i dag|engang|only today|just (today|once)|one[- ]?shot)\b/i.test(t);
}

export function isReminderScopeCancel(body: string): boolean {
  return REMINDER_SCOPE_CANCEL.test(body.trim());
}

/** Reply to “which day?” — today / yesterday only. */
export function parseLogDayReply(body: string): "today" | "yesterday" | null {
  const t = body.trim().toLowerCase();
  if (!t || t.length > 80) return null;
  if (/^(i\s*dag|idag|today|nå|naa|nettopp)(\s*[.!]*)?$/i.test(t)) return "today";
  if (/^(i\s*går|i\s*gaar|igår|yesterday)(\s*[.!]*)?$/i.test(t)) return "yesterday";
  if (/\b(i\s*går|i\s*gaar|igår|yesterday)\b/i.test(t) && !/\b(i\s*dag|idag|today)\b/i.test(t)) return "yesterday";
  if (/\b(i\s*dag|idag|today)\b/i.test(t)) return "today";
  return null;
}
