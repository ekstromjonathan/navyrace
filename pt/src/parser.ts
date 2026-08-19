import { isExtraWording, looksLikeActivityReport } from "./activity.ts";
import { inferReminderTopic } from "./reminder-topic.ts";
import { extractUrl } from "./urls.ts";

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
      extra: boolean;
    }
  | { kind: "rpe"; confident: true; quality: "lett" | "passe" | "brutalt" | "hoppet" }
  | { kind: "today"; confident: true }
  | { kind: "program"; confident: true }
  | { kind: "alive"; confident: true }
  | { kind: "adapt_choice"; confident: true; choice: "swap" | "ease" | "keep" }
  | { kind: "greeting"; confident: true }
  | { kind: "activate"; confident: true }
  | { kind: "archive"; confident: true }
  | { kind: "reminder_set"; confident: true; hour: number; minute: number; scope: "daily" | "once"; url: string | null; slug: string; title: string }
  | { kind: "reminder_cancel"; confident: true; slug?: string; hour?: number; minute?: number }
  | { kind: "reminder_list"; confident: true }
  | { kind: "video_link"; confident: true; url: string }
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

function tidyGlitch(text: string): string {
  /* iMessage sometimes appends a stray capital V ("inneV", "VåkenV"). */
  return text.replace(/([A-Za-zÆØÅæøå])V$/u, "$1").trim();
}

export function parseMessage(body: string): HeuristicIntent {
  const text = tidyGlitch(body.trim());
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

  if (/\b(slutt å minne|ikke minn meg|avbryt påminnelse|skru av påminnelse|stop reminding|don't remind|sluta påminna|sluta minna)\b/i.test(lower)) {
    const clock = parseClock(lower);
    const topic = inferReminderTopic(text, extractUrl(text));
    const named =
      topic.slug !== "train" ||
      /\b(trene|trening|økt|workout|train(ing)?)\b/i.test(lower);
    return {
      kind: "reminder_cancel",
      confident: true,
      ...(named ? { slug: topic.slug } : {}),
      ...(clock.explicit ? { hour: clock.hour, minute: clock.minute } : {}),
    };
  }

  const url = extractUrl(text);
  const hasReminderIntent =
    /\b(minn meg|minne meg|påminn meg|påminn mig|påminn mej)\b/i.test(lower) ||
    (/\bpåminnelse\b/i.test(lower) &&
      /\b(kl|hver dag|varje dag|trene|träna|trening|träning|i kveld|i kväll|ikväll|i dag|idag|video|se|watch)\b/i.test(lower)) ||
    /\bremind me\b/i.test(lower) ||
    (/\breminder\b/i.test(lower) &&
      /\b(train|training|daily|every day|tonight|today|video|watch)\b/i.test(lower)) ||
    (url != null &&
      /\b(se (denne )?video(en)?|gå gjennom|watch (this )?video|videoen|denne lenken|this link|titta på)\b/i.test(lower));

  if (hasReminderIntent) {
    const clock = parseClock(lower);
    const scope = detectReminderScope(lower);
    let hour = clock.hour;
    let minute = clock.minute;
    // “i kveld” / tonight without an explicit clock → early evening default.
    if (!clock.explicit && (scope === "once" || /\b(i kveld|i kväll|ikväll|tonight|this evening)\b/i.test(lower))) {
      hour = 18;
      minute = 0;
    }
    const topic = inferReminderTopic(text, url);
    return {
      kind: "reminder_set",
      confident: true,
      hour,
      minute,
      scope,
      url,
      slug: topic.slug,
      title: topic.title,
    };
  }

  if (url && text.replace(url, "").trim().length < 24) {
    return { kind: "video_link", confident: true, url };
  }

  if (
    /\b(hvilke (reminders?|påminnelser)|hva (for )?(påminnelser|reminders)|hvilken påminnelse|hva minner du|reminders? (ligger|inne)|list(e)? (mine )?(påminnelser|reminders))\b/i.test(
      lower,
    ) ||
    /^(påminnelser|reminders)\??$/i.test(lower)
  ) {
    return { kind: "reminder_list", confident: true };
  }

  if (
    /^(hva (trener|gjør) jeg( i dag)?|i dag\??|neste økt)$/i.test(lower) ||
    /^(vad (tränar|gör) jag( idag)?|idag\??|nästa pass)$/i.test(lower) ||
    /^(what am i training( today)?|today'?s (workout|session)|next session)$/i.test(lower) ||
    /^(hva er dagens økt( igjen)?|dagens økt)\??$/i.test(lower)
  ) {
    return { kind: "today", confident: true };
  }
  if (
    /^(hvilket program( går vi for)?|hva er programmet|mitt program|hvilken plan|hva har vi)\??$/i.test(lower) ||
    /^(which program|what'?s (my|the) program|my program)\??$/i.test(lower) ||
    /^(vad är programmet|vilket program)\??$/i.test(lower) ||
    /^(hvor (er|står) vi( nå)?( denne uka)?|hvor er jeg i (uka|uken|programmet)|status (på )?(uka|uken|programmet)|hvor er vi nå denne uka|hva er status( nå)?|what's (my )?status)\??$/i.test(
      lower,
    ) ||
    /\bukeplanen\b/i.test(lower) ||
    /\b(gi meg|vis meg|send meg)\s+(ukeplan(en)?( min)?|planen min)\b/i.test(lower)
  ) {
    return { kind: "program", confident: true };
  }

  if (isAliveCheck(text)) {
    return { kind: "alive", confident: true };
  }

  const adaptChoice = parseAdaptChoice(text);
  if (adaptChoice) {
    return { kind: "adapt_choice", confident: true, choice: adaptChoice };
  }

  if (isBareGreeting(text)) {
    return { kind: "greeting", confident: true };
  }

  if (/^(lett|passe|brutalt|hoppet|easy|ok|okay|brutal|skipped|lätt|lagom|hoppade)$/i.test(lower) || /^hoppet over$/i.test(lower) || /^skip(ped)?$/i.test(lower) || /^hoppade över$/i.test(lower)) {
    let quality: "lett" | "passe" | "brutalt" | "hoppet";
    if (lower.startsWith("hoppet") || lower.startsWith("hoppade") || lower.startsWith("skip")) quality = "hoppet";
    else if (lower === "easy" || lower === "lett" || lower === "lätt") quality = "lett";
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

/** User answered a swap-vs-easy offer (or volunteered it). */
export function parseAdaptChoice(text: string): "swap" | "ease" | "keep" | null {
  const t = tidyGlitch(text.trim());
  if (!t || t.length > 280) return null;
  const lower = t.toLowerCase();
  if (/^(bytte|bytt|swap)([.!]*)?$/i.test(t)) return "swap";
  if (/\b(bytt(e)? (i dag|dagens|til (styrke|noe annet))|vi (kan|bør) bytte)\b/i.test(lower) && !/\?\s*$/.test(t)) {
    return "swap";
  }
  if (
    /\b(hold(e)? det (veldig )?rolig|rolig(e)? dag|ta det rolig|ta en rolig|kan gjerne ta en rolig|easy (day|version)|veldig rolig)\b/i.test(
      lower,
    )
  ) {
    return "ease";
  }
  if (/^(kjør|behold|som planlagt|keep it|kjøre planen)([.!]*)?$/i.test(t)) return "keep";
  if (/^(usikker|vet ikke|vet ikkje|du (får |kan )?bestemme|som du vil|whatever)\??[.!\s]*$/i.test(t)) {
    return "ease";
  }
  return null;
}

export function isAliveCheck(text: string): boolean {
  const t = tidyGlitch(text.trim());
  if (!t || t.length > 64) return false;
  return /^(er du (våken|der|derinne)\??|våkenv?\??|you there\??|are you (there|awake)\??|svarer (modellen|du|grok)( nå)?\??)$/i.test(
    t,
  );
}

/** They already answered and the coach repeated itself. */
export function isDidYouHearMe(text: string): boolean {
  return /\b(svarte (jeg |vi )?(nettopp|jo)|jeg (har )?svart|leste du|hørte du|sa jeg (ikke )?(akkurat|nettopp)|du (lyttet|leste) ikke)\b/i.test(
    text,
  );
}

/** hei / hallo / hey with nothing else — keep a dialogue, don't dump the workout. */
export function isBareGreeting(text: string): boolean {
  const t = text.trim().replace(/^[!?.\s]+|[!?.\s]+$/g, "");
  if (!t || t.length > 40) return false;
  const folded = t.replace(/[''`´’]/g, "").replace(/\s+/g, "").toLowerCase();
  if (folded === "skjera" || folded === "skjeraa") return true;
  return /^(?:hei|heia|heisann|hallo|hallois|hey+|hi+|yo|tja|tjena|hej|god\s*(?:morgen|morgon|formiddag|kveld|kväll|natt)|morning|evening|sup)(?:\s+(?:hei|heia|heisann|hallo|hey|hi|hej))*$/i.test(
    t,
  );
}

function parseSessionQuality(lower: string): "lett" | "passe" | "brutalt" | "hoppet" | null {
  if (/\b(hoppet(\s+over)?|hoppade(\s+över)?|skipped)\b/i.test(lower)) return "hoppet";
  if (/\bbrutalt\b|\bbrutal\b/i.test(lower)) return "brutalt";
  if (/\blett\b|\blätt\b|\beasy\b/i.test(lower)) return "lett";
  if (/\bpasse\b|\blagom\b|\babout right\b/i.test(lower)) return "passe";
  return null;
}

function parseSessionDay(lower: string): "today" | "yesterday" | null {
  if (/\b(i\s*går|i\s*gaar|igår|i\s*går|yesterday)\b/i.test(lower)) return "yesterday";
  if (
    /\b(i\s*dag|idag|today|tonight|i\s*kveld|i\s*kväll|ikväll|nå|naa|nettopp|dagens|this morning|i\s*morges|i\s*formiddag|i\s*ettermiddag)\b/i.test(
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
    /\b(dagens\s+økt|dagens\s+okt|dagens\s+pass|today'?s\s+(workout|session)|planlagte?\s+økt|denne\s+økt(a|en)?)\b/i.test(
      lower,
    );

  const didSession =
    /\b(gjorde|gjort|ferdig(\s+med)?|fullført|trente|har\s+trent|tok\s+en\s+økt|tok\s+økt)\b/i.test(lower) ||
    /\b(tränade|har\s+tränat|tog\s+ett\s+pass|gjorde\s+pass|klart)\b/i.test(lower) ||
    /\b(did|finished|completed|trained|worked\s+out)\b/i.test(lower) ||
    /\b(spilte|spelte|padlet|klatret|syklet|svømte|jogget)\b/i.test(lower);
  const logVerb =
    /\b(logg(?:er|et|a)?|logger\s+nå|logged|logging)\b/i.test(lower) &&
    /\b(økt|okt|trening|workout|session|kettlebell|styrke|løp|lop|yoga|klatring|padling|svøm|swim|kb|tennis|padel|kajakk)\b/i.test(
      lower,
    );
  const bareDone =
    /^(ferdig|done|ferdig\s+nå|done\s+now|økt\s+ferdig|session\s+done)([.!]*)?$/i.test(trimmed);
  const activityReport = looksLikeActivityReport(trimmed);

  if (!didSession && !logVerb && !bareDone && !claimsPlanned && !activityReport) return null;

  // “hva logget du” / questions — not a log.
  if (/^(hva|what|hvordan|how|bør|skal|kan)\b/i.test(lower) || /\?\s*$/.test(trimmed)) return null;

  const extra = isExtraWording(lower);
  const day = parseSessionDay(lower);
  const quality = parseSessionQuality(lower);
  return {
    kind: "session_log",
    confident: true,
    day,
    quality,
    note: trimmed.slice(0, 400),
    claimsPlanned: !extra && (claimsPlanned || bareDone),
    extra,
  };
}

export function parseClock(text: string): { hour: number; minute: number; explicit: boolean } {
  const m =
    text.match(/\bkl\.?\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
    text.match(/\bklokken\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
    text.match(/\bklockan\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
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

/** Clock reply while waiting for a video-reminder time — no “minn meg” required. */
export function parseTimeReply(text: string): { hour: number; minute: number; scope: "daily" | "once" } | null {
  const t = tidyGlitch(text.trim());
  if (!t || t.length > 80) return null;
  const parsed = parseMessage(t);
  if (parsed.kind === "reminder_set") {
    return { hour: parsed.hour, minute: parsed.minute, scope: parsed.scope };
  }
  const lower = t.toLowerCase();
  const clock = parseClock(lower);
  if (clock.explicit) {
    return { hour: clock.hour, minute: clock.minute, scope: detectReminderScope(lower) };
  }
  const bare =
    lower.match(/^kl\.?\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(hver dag|daglig|every day|i kveld|i dag))?[!?.]*$/i) ||
    lower.match(/^(\d{1,2})(?:[:.](\d{2}))?(?:\s*(hver dag|daglig|every day|i kveld|tonight|i dag))?[!?.]*$/);
  if (!bare) return null;
  const hour = Number(bare[1]);
  const minute = bare[2] != null ? Number(bare[2]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const rest = bare[3] ?? "";
  const scope = /i kveld|i dag|tonight/i.test(rest) ? "once" : detectReminderScope(lower);
  return { hour, minute, scope };
}

/** Infer daily vs one-shot from wording — no confirmation gate. */
export function detectReminderScope(text: string): "daily" | "once" {
  const t = text.toLowerCase();
  if (
    /\b(hver dag|daglig|every day|daily|hver morgen|hver kveld|recurring|gjentagende|permanent|varje dag|dagligen|every evening)\b/i.test(
      t,
    )
  ) {
    return "daily";
  }
  if (
    /\b(i kveld|i kväll|ikväll|i dag|idag|tonight|today|this evening|bare i dag|bare i kveld|kun i dag|kun i kveld|engang|engangs|one[- ]?shot|only (today|tonight)|just (today|tonight|once)|bara idag|bara ikväll)\b/i.test(
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
