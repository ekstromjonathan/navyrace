export type HeuristicIntent =
  | {
      kind: "log";
      confident: true;
      trackKind: "habit" | "recovery";
      slug: string;
      name: string;
      tags: string[];
      quantity: { value: number; unit: string } | null;
      note?: string;
    }
  | {
      kind: "session_log";
      confident: true;
      /** null → PT must ask which day */
      day: "today" | "yesterday" | null;
      quality: "lett" | "passe" | "brutalt" | "hoppet" | null;
      note: string;
      /** User claimed today's/planned session (even if content differs). */
      claimsPlanned: boolean;
    }
  | { kind: "rpe"; confident: true; quality: "lett" | "passe" | "brutalt" | "hoppet" }
  | { kind: "today"; confident: true }
  | { kind: "activate"; confident: true }
  | { kind: "archive"; confident: true }
  | { kind: "reminder_set"; confident: true; hour: number; minute: number; scope: "daily" | "once" }
  | { kind: "reminder_cancel"; confident: true }
  | { kind: "archive_entry"; confident: true; slug?: string; trackKind?: "training" }
  | { kind: "unknown"; confident: false };

const NUM = "(\\d+(?:[.,]\\d+)?)";

function num(s: string): number {
  return Number(s.replace(",", "."));
}

function glasses(raw: string): number {
  const t = raw.toLowerCase();
  if (t === "et" || t === "ett" || t === "et glass" || t === "a") return 1;
  return num(raw);
}

export function parseMessage(body: string): HeuristicIntent {
  const text = body.trim();
  if (!text) return { kind: "unknown", confident: false };

  const lower = text.toLowerCase();

  if (/^(kjør programmet|kjør opplegget|kjør|run the program|lock the program)$/i.test(text)) {
    return { kind: "activate", confident: true };
  }
  // Soft lock phrases when they clearly mean start/lock the draft.
  if (
    /^(ja|ok|okay|yes)\s*,?\s*(kjør|låse?|start|begynn|run|lock)\b/i.test(text) ||
    /^(sett i gang|la oss (kjøre|starte|begynne)|let'?s (go|start))$/i.test(text)
  ) {
    return { kind: "activate", confident: true };
  }
  if (/^(arkiver og lag nytt|archive and start new)$/i.test(text)) {
    return { kind: "archive", confident: true };
  }

  const archiveEntry = parseArchiveEntry(text);
  if (archiveEntry) return archiveEntry;

  if (/\b(slutt å minne|ikke minn meg|avbryt påminnelse|skru av påminnelse|stop reminding|don't remind)\b/i.test(lower)) {
    return { kind: "reminder_cancel", confident: true };
  }

  if (
    /\b(minn meg|minne meg|påminn meg)\b/i.test(lower) ||
    (/\bpåminnelse\b/i.test(lower) && /\b(kl|hver dag|trene|trening|i kveld|i dag)\b/i.test(lower)) ||
    /\bremind me\b/i.test(lower) ||
    (/\breminder\b/i.test(lower) && /\b(train|training|daily|every day|tonight|today)\b/i.test(lower))
  ) {
    const clock = parseClock(lower);
    const scope = detectReminderScope(lower);
    let hour = clock.hour;
    let minute = clock.minute;
    // “i kveld” / tonight without an explicit clock → early evening default.
    if (!clock.explicit && (scope === "once" || /\b(i kveld|tonight|this evening)\b/i.test(lower))) {
      hour = 18;
      minute = 0;
    }
    return { kind: "reminder_set", confident: true, hour, minute, scope };
  }

  if (
    /^(hva (trener|gjør) jeg( i dag)?|i dag\??|neste økt)$/i.test(lower) ||
    /^(what am i training( today)?|today'?s (workout|session)|next session)$/i.test(lower) ||
    /^(hvilket program( går vi for)?|hva er programmet|mitt program|hvilken plan|hva har vi)\??$/i.test(lower) ||
    /^(which program|what'?s (my|the) program|my program)\??$/i.test(lower)
  ) {
    return { kind: "today", confident: true };
  }

  if (/^(lett|passe|brutalt|hoppet|easy|ok|okay|brutal|skipped)$/i.test(lower) || /^hoppet over$/i.test(lower) || /^skip(ped)?$/i.test(lower)) {
    let quality: "lett" | "passe" | "brutalt" | "hoppet";
    if (lower.startsWith("hoppet") || lower.startsWith("skip")) quality = "hoppet";
    else if (lower === "easy" || lower === "lett") quality = "lett";
    else if (lower === "brutal" || lower === "brutalt") quality = "brutalt";
    else quality = "passe";
    return { kind: "rpe", confident: true, quality };
  }

  const water =
    text.match(new RegExp(`(?:drakk|drukket|drank)\\s+(et|ett|a|${NUM})\\s*glass`, "i")) ||
    text.match(new RegExp(`(${NUM}|et|ett|a)\\s*glasses?(?:\\s+of\\s+water)?`, "i")) ||
    text.match(new RegExp(`(${NUM}|et|ett)\\s*glass(?:\\s+vann)?`, "i")) ||
    text.match(/vannglass/i);
  if (water) {
    const raw = water[1] && water[1] !== "vannglass" ? water[1] : "1";
    return {
      kind: "log",
      confident: true,
      trackKind: "habit",
      slug: "vann",
      name: "Vann",
      tags: ["vann"],
      quantity: { value: glasses(raw), unit: "glass" },
    };
  }

  const cold = text.match(
    new RegExp(`(?:kaldt\\s*bad|isbad|isbadet|cold\\s*plunge).{0,20}?(?:i\\s*)?${NUM}\\s*(sek(?:under)?|min(?:utt(?:er)?)?)`, "i"),
  );
  const coldBare = /kaldt\s*bad|isbad|cold\s*plunge/i.test(text);
  if (cold) {
    const unit = /min/i.test(cold[2]) ? "min" : "s";
    return {
      kind: "log",
      confident: true,
      trackKind: "recovery",
      slug: "kaldt-bad",
      name: "Kaldt bad",
      tags: ["kaldt", "bad"],
      quantity: { value: num(cold[1]), unit },
    };
  }
  if (coldBare && text.length < 80) {
    return {
      kind: "log",
      confident: true,
      trackKind: "recovery",
      slug: "kaldt-bad",
      name: "Kaldt bad",
      tags: ["kaldt", "bad"],
      quantity: null,
    };
  }

  const med = text.match(
    new RegExp(`(?:mediterte|meditasjon|mediterer|meditated).{0,20}?(?:i\\s*|for\\s*)?${NUM}\\s*(sek(?:under)?|min(?:utt(?:er)?)?|sec(?:onds)?|minutes?)`, "i"),
  );
  const medBare = /mediterte|meditasjon|meditated/i.test(text);
  if (med) {
    const unit = /min/i.test(med[2]) ? "min" : "s";
    return {
      kind: "log",
      confident: true,
      trackKind: "habit",
      slug: "meditasjon",
      name: "Meditasjon",
      tags: ["meditasjon"],
      quantity: { value: num(med[1]), unit },
    };
  }
  if (medBare && text.length < 80) {
    return {
      kind: "log",
      confident: true,
      trackKind: "habit",
      slug: "meditasjon",
      name: "Meditasjon",
      tags: ["meditasjon"],
      quantity: null,
    };
  }

  const session = parseSessionLog(text);
  if (session) return session;

  return { kind: "unknown", confident: false };
}

function parseSessionQuality(lower: string): "lett" | "passe" | "brutalt" | "hoppet" | null {
  if (/\b(hoppet(\s+over)?|skipped)\b/i.test(lower)) return "hoppet";
  if (/\bbrutalt\b|\bbrutal\b/i.test(lower)) return "brutalt";
  if (/\blett\b|\beasy\b/i.test(lower)) return "lett";
  if (/\bpasse\b|\babout right\b/i.test(lower)) return "passe";
  return null;
}

function parseSessionDay(lower: string): "today" | "yesterday" | null {
  if (/\b(i\s*går|i\s*gaar|yesterday)\b/i.test(lower)) return "yesterday";
  if (
    /\b(i\s*dag|today|tonight|i\s*kveld|nå|naa|nettopp|dagens|this morning|i\s*morges|i\s*formiddag|i\s*ettermiddag)\b/i.test(
      lower,
    )
  ) {
    return "today";
  }
  return null;
}

/** Free-form training session — even when it doesn't match the prescribed plan. */
export function parseSessionLog(text: string): Extract<HeuristicIntent, { kind: "session_log" }> | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 500) return null;
  const lower = trimmed.toLowerCase();

  // Don't steal habit/recovery lines that already matched above; those return earlier.
  if (/^(lett|passe|brutalt|hoppet|easy|ok|okay|brutal|skipped)$/i.test(trimmed)) return null;

  const claimsPlanned =
    /\b(dagens\s+økt|dagens\s+okt|today'?s\s+(workout|session)|planlagte?\s+økt|denne\s+økt(a|en)?)\b/i.test(
      lower,
    );

  const didSession =
    /\b(gjorde|gjort|ferdig(\s+med)?|fullført|trente|har\s+trent|tok\s+en\s+økt|tok\s+økt)\b/i.test(lower) ||
    /\b(did|finished|completed|trained|worked\s+out)\b/i.test(lower);
  const logVerb =
    /\b(logg(?:er|et|a)?|logger\s+nå|logged|logging)\b/i.test(lower) &&
    /\b(økt|okt|trening|workout|session|kettlebell|styrke|løp|lop|yoga|klatring|padling|svøm|swim|kb)\b/i.test(
      lower,
    );
  const bareDone =
    /^(ferdig|done|ferdig\s+nå|done\s+now|økt\s+ferdig|session\s+done)([.!]*)?$/i.test(trimmed);

  if (!didSession && !logVerb && !bareDone && !claimsPlanned) return null;

  // “hva logget du” / questions — not a log.
  if (/^(hva|what|hvordan|how)\b/i.test(lower) || /\?\s*$/.test(trimmed)) return null;

  const day = parseSessionDay(lower);
  const quality = parseSessionQuality(lower);
  return {
    kind: "session_log",
    confident: true,
    day,
    quality,
    note: trimmed.slice(0, 400),
    claimsPlanned: claimsPlanned || bareDone,
  };
}

export function parseClock(text: string): { hour: number; minute: number; explicit: boolean } {
  const m =
    text.match(/\bkl\.?\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
    text.match(/\bklokken\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
    text.match(/\bat\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
    text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) {
    const hour = Number(m[1]);
    const minute = m[2] != null ? Number(m[2]) : 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute, explicit: true };
    }
  }
  return { hour: 8, minute: 0, explicit: false };
}

/** Infer daily vs one-shot from wording — no confirmation gate. */
export function detectReminderScope(text: string): "daily" | "once" {
  const t = text.toLowerCase();
  if (
    /\b(hver dag|daglig|every day|daily|hver morgen|recurring|gjentagende|permanent)\b/i.test(t)
  ) {
    return "daily";
  }
  if (
    /\b(i kveld|i dag|tonight|today|this evening|bare i dag|bare i kveld|kun i dag|kun i kveld|engang|engangs|one[- ]?shot|only (today|tonight)|just (today|tonight|once))\b/i.test(
      t,
    )
  ) {
    return "once";
  }
  // Bare «minn meg kl 8» → daily (previous default).
  return "daily";
}

function parseArchiveEntry(text: string): Extract<HeuristicIntent, { kind: "archive_entry" }> | null {
  const lower = text.toLowerCase().trim();
  if (/arkiver og lag nytt|archive and start new/i.test(lower)) return null;
  if (
    /\b(slett|fjern|delete|remove)\b/.test(lower) &&
    /\b(alt|alle|everything|all (logs|entries)|hele programmet|programmet)\b/.test(lower) &&
    !/\b(siste|last|latest)\b/.test(lower)
  ) {
    return null;
  }

  const nb =
    /\b(slett|fjern|ta bort|arkiver)\b/.test(lower) &&
    (/\b(siste|loggen|logg(?:en)?)\b/.test(lower) || /økt(en)?/i.test(lower));
  const en =
    /\b(delete|remove|archive)\b/.test(lower) &&
    /\b(last|latest)\b/.test(lower) &&
    /\b(log|entry|session|workout)\b/.test(lower);
  const shortNb = /^(slett|fjern|ta bort) (siste|loggen)(\s+\S+)?$/i.test(lower);
  const shortEn = /^(delete|remove) (the )?last(\s+\S+)?( log| entry)?$/i.test(lower);
  if (!nb && !en && !shortNb && !shortEn) return null;

  let slug: string | undefined;
  if (/\b(vann|water|glasses?)\b/i.test(lower)) slug = "vann";
  else if (/\b(meditasjon|meditation)\b/i.test(lower)) slug = "meditasjon";
  else if (/\b(kaldt\s*bad|isbad|cold\s*plunge)\b/i.test(lower)) slug = "kaldt-bad";

  const trackKind =
    !slug && /(økt|trening|workout|session)/i.test(lower) ? ("training" as const) : undefined;
  return { kind: "archive_entry", confident: true, slug, trackKind };
}
