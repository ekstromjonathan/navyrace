import type { Lang } from "./locale.ts";

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function optOutReply(lang: Lang): string {
  return lang === "en" ? "Ok, I'll stay quiet. Write when you want to pick it up." : "Ok, jeg er stille. Skriv når du vil igjen.";
}

export function reminderConfirm(lang: Lang, hour: number, minute: number, tz: string): string {
  if (lang === "en") {
    return `Ok — daily training reminder at ${hhmm(hour, minute)} (${tz}). I'll skip the day if you already logged a session. Say “stop reminding me” to turn it off.`;
  }
  return `Ok — daglig treningspåminnelse kl ${hhmm(hour, minute)} (${tz}). Jeg hopper over dagen hvis du allerede har logget økt. Si «slutt å minne meg» for å skru av.`;
}

export function reminderConfirmOnce(lang: Lang, hour: number, minute: number, onceOn: string, tz: string): string {
  if (lang === "en") {
    return `Ok — one reminder on ${onceOn} at ${hhmm(hour, minute)} (${tz}). Say “stop reminding me” to cancel.`;
  }
  return `Ok — én påminnelse ${onceOn} kl ${hhmm(hour, minute)} (${tz}). Si «slutt å minne meg» for å avbryte.`;
}

export function reminderConfirmWithUrl(
  lang: Lang,
  hour: number,
  minute: number,
  tz: string,
  url: string,
): string {
  if (lang === "en") {
    return `Ok — daily reminder at ${hhmm(hour, minute)} (${tz}) with your link:\n${url}\nSay “stop reminding me” to turn it off.`;
  }
  return `Ok — daglig påminnelse kl ${hhmm(hour, minute)} (${tz}) med lenken:\n${url}\nSi «slutt å minne meg» for å skru av.`;
}

export function reminderConfirmOnceWithUrl(
  lang: Lang,
  hour: number,
  minute: number,
  onceOn: string,
  tz: string,
  url: string,
): string {
  if (lang === "en") {
    return `Ok — one reminder on ${onceOn} at ${hhmm(hour, minute)} (${tz}) with your link:\n${url}\nSay “stop reminding me” to cancel.`;
  }
  return `Ok — én påminnelse ${onceOn} kl ${hhmm(hour, minute)} (${tz}) med lenken:\n${url}\nSi «slutt å minne meg» for å avbryte.`;
}

export function videoLinkAsk(lang: Lang): string {
  return lang === "en"
    ? "Got the link. What time should I remind you? e.g. «remind me at 7»."
    : "Fikk lenken. Når skal jeg minne deg? Si f.eks. «minn meg kl 19».";
}

export function reminderScopeAsk(lang: Lang, hour: number, minute: number): string {
  if (lang === "en") {
    return `Got it — ${hhmm(hour, minute)}. Should that be every day, or just once (today/tonight)?`;
  }
  return `Skjønner — kl ${hhmm(hour, minute)}. Skal det være hver dag, eller bare i dag/i kveld?`;
}

export function reminderScopeCancelled(lang: Lang): string {
  return lang === "en" ? "Ok, no reminder set." : "Ok, ingen påminnelse satt.";
}

export function reminderCancel(lang: Lang, had: boolean): string {
  if (lang === "en") {
    return had ? "Ok, no more training reminders." : "You don't have a reminder to turn off.";
  }
  return had ? "Ok, ingen flere treningspåminnelser." : "Du har ingen påminnelse å skru av.";
}

export function noDraft(lang: Lang): string {
  return lang === "en" ? "There's no draft to lock in." : "Det finnes ikke noe utkast å låse.";
}

export function noActivePlan(lang: Lang): string {
  return lang === "en" ? "No active plan to archive." : "Ingen aktiv plan å arkivere.";
}

export function noRpePlan(lang: Lang): string {
  return lang === "en"
    ? "No active plan to log how a session felt. Tell me what you did and I'll log it as a track."
    : "Ingen aktiv plan å logge hvordan en økt føltes på. Si hva du gjorde, så logger jeg det som et spor.";
}

export function rpeLogged(lang: Lang, quality: string): string {
  if (lang === "en") {
    if (quality === "hoppet") return "Noted — skipped. It doesn't count toward the dose. Next when you're ready.";
    if (quality === "brutalt") return "Noted as brutal. I'll ease the next similar session.";
    if (quality === "lett") return "Noted as easy. I'll bump the next similar session a little.";
    return "Noted as about right. Holding the plan.";
  }
  if (quality === "hoppet") return "Notert — hoppet. Den teller ikke i dosen. Neste når du er klar.";
  if (quality === "brutalt") return "Notert som brutalt. Jeg letter neste like økt.";
  if (quality === "lett") return "Notert som lett. Jeg skrur opp neste like økt litt.";
  return "Notert som passe. Holder planen.";
}

export function sessionLogged(
  lang: Lang,
  opts: { title: string; dayLabel: string; planned: boolean; askRpe: boolean },
): string {
  if (lang === "en") {
    const where = opts.planned
      ? `Logged against “${opts.title}” (${opts.dayLabel}).`
      : `Logged extra session “${opts.title}” (${opts.dayLabel}) — plan stays as-is.`;
    return opts.askRpe ? `${where}\nHow hard was it? (easy / about right / brutal)` : where;
  }
  const where = opts.planned
    ? `Logget mot «${opts.title}» (${opts.dayLabel}).`
    : `Logget ekstraøkt «${opts.title}» (${opts.dayLabel}) — planen står.`;
  return opts.askRpe ? `${where}\nHvor hardt var det? (lett / passe / brutalt)` : where;
}

export function sessionDayAsk(lang: Lang): string {
  return lang === "en"
    ? "Got it — which day should I log that on? Today or yesterday?"
    : "Skjønner — hvilken dag skal jeg logge det på? I dag eller i går?";
}

export function sessionDayCancelled(lang: Lang): string {
  return lang === "en" ? "Ok, nothing logged." : "Ok, ingenting logget.";
}

export function sessionNoPlan(lang: Lang): string {
  return lang === "en"
    ? "No active program yet — I'll still note what you did once we lock a plan. Want to lock the draft?"
    : "Ingen aktivt program ennå — jeg noterer det når vi har låst et opplegg. Vil du låse utkastet?";
}

export function rpeNeedSession(lang: Lang): string {
  return lang === "en"
    ? "Tell me what you did first (even if it wasn't the planned session), then easy / about right / brutal."
    : "Si først hva du gjorde (selv om det ikke var den planlagte økta), så lett / passe / brutalt.";
}

export function loggedItem(lang: Lang, name: string, qty: string, n: number): string {
  if (lang === "en") return `Logged ${name.toLowerCase()}${qty}. ${n} on that track.`;
  return `Logget ${name.toLowerCase()}${qty}. ${n} på det sporet.`;
}

export function duplicateLog(lang: Lang): string {
  return lang === "en" ? "I already had that one." : "Den hadde jeg allerede.";
}

export function entryArchived(lang: Lang, name: string): string {
  if (lang === "en") {
    return `Archived — “${name}” is out of the live log. It sits as a snapshot.`;
  }
  return `Arkivert — «${name}» er tatt ut av den levende loggen. Den ligger som snapshot.`;
}

export function noEntryToArchive(lang: Lang): string {
  return lang === "en" ? "No log to archive." : "Fant ingen logg å arkivere.";
}

export function activatePrompt(lang: Lang, name: string, sessionCount: number): string {
  if (lang === "en") {
    return [
      `Draft “${name}” — ${sessionCount} sessions.`,
      "It adapts from how each session felt (easy / about right / brutal).",
      "Say yes / ok / run it when you want to lock it and start.",
    ].join("\n");
  }
  return [
    `Utkast «${name}» — ${sessionCount} økter.`,
    "Det tilpasses etter hvordan hver økt føles (lett / passe / brutalt).",
    "Si ja / ok / kjør når du vil låse og starte.",
  ].join("\n");
}

export function archivePrompt(lang: Lang, name: string, entryCount: number, noteCount: number): string {
  if (lang === "en") {
    return [
      `“${name}” is active — ${entryCount} logs and ${noteCount} notes.`,
      "Nothing is deleted. It archives as a snapshot you can pull later.",
      'Write exactly “archive and start new” if you want that. Anything else cancels.',
    ].join("\n");
  }
  return [
    `«${name}» er aktivt — ${entryCount} logger og ${noteCount} notater.`,
    "Det slettes ikke. Det arkiveres som snapshot du kan hente senere.",
    'Skriv nøyaktig «arkiver og lag nytt» hvis du vil det. Alt annet avbryter.',
  ].join("\n");
}

export function activated(lang: Lang): string {
  return lang === "en"
    ? "Program is locked. Here's today's session — say easy / about right / brutal when you're done so I can tune the next one."
    : "Programmet er låst. Her er dagens økt — si lett / passe / brutalt når du er ferdig, så justerer jeg neste.";
}

export function activateFailed(lang: Lang, detail: string): string {
  return detail || (lang === "en" ? "Couldn't activate." : "Klarte ikke å aktivere.");
}

export function activateCancelled(lang: Lang): string {
  return lang === "en"
    ? "Cancelled — the program is still a draft."
    : "Avbrutt — programmet ligger fortsatt som utkast.";
}

export function archived(lang: Lang): string {
  return lang === "en"
    ? "Archived. It sits as a snapshot. Tell me what the new setup should aim at."
    : "Arkivert. Det ligger som snapshot. Fortell hva det nye opplegget skal styre mot.";
}

export function archiveCancelled(lang: Lang): string {
  return lang === "en" ? "Cancelled — nothing was archived." : "Avbrutt — ingenting ble arkivert.";
}

export function savedField(lang: Lang, field: string): string {
  return lang === "en" ? `Saved ${field}.` : `Lagret ${field}.`;
}

export function todayNoPlan(lang: Lang): string {
  return lang === "en"
    ? "No active plan yet. Tell me goal, training experience, days per week and gear — I'll draft a week you confirm, and we'll tune it from how sessions feel."
    : "Ingen aktiv plan ennå. Fortell mål, erfaring, dager i uka og utstyr — så lager jeg et utkast du bekrefter, og vi justerer etter hvordan øktene føles.";
}

export function todayDraft(lang: Lang, name: string): string {
  return lang === "en"
    ? `You have a draft (“${name}”). Say yes / ok / run it to lock it, or tell me what to change.`
    : `Du har et utkast («${name}»). Si ja / ok / kjør for å låse, eller fortell hva som skal endres.`;
}

export function todayDone(lang: Lang, name: string): string {
  return lang === "en"
    ? `“${name}” is logged out. Want a new block, or pull an archive?`
    : `«${name}» er ferdig ut logg-messig. Vil du ha en ny blokk, eller hente et arkiv?`;
}

export function todayFooter(lang: Lang): string {
  return lang === "en"
    ? "When you're done: how hard was it, and how did it feel? (easy / about right / brutal)"
    : "Når du er ferdig: hvor hardt var det, og hvordan føltes det? (lett / passe / brutalt)";
}

export function adaptNote(lang: Lang, prev: string): string {
  if (lang === "en") {
    return prev === "lett" ? "Last one felt easy — nudging up a bit." : "Last one was hard — easing off a bit.";
  }
  return prev === "lett" ? "Forrige føltes lett — skrur opp litt." : "Forrige var hard — letter litt.";
}

export function reminderPingNoPlan(lang: Lang): string {
  return lang === "en"
    ? "Training day. Tell me goal, experience, days and gear — I'll put a week together."
    : "Treningsdag. Fortell mål, erfaring, dager og utstyr — så setter jeg sammen ei uke.";
}

export function reminderPingDone(lang: Lang, name: string): string {
  return lang === "en"
    ? `Reminder — “${name}” is logged out. Want a new block?`
    : `Påminnelse — «${name}» er ferdig ut. Vil du ha en ny blokk?`;
}

export function reminderPingToday(lang: Lang, line: string): string {
  if (lang === "en") {
    return [`Training today.`, line, "Say easy / about right / brutal when you're done."].join("\n");
  }
  return [`Trening i dag.`, line, "Si lett / passe / brutalt når du er ferdig."].join("\n");
}

export function reminderPingVideo(lang: Lang, url: string): string {
  if (lang === "en") {
    return [`Reminder — time to watch this:`, url].join("\n");
  }
  return [`Påminnelse — tid for å se dette:`, url].join("\n");
}

export function handlerError(lang: Lang): string {
  return lang === "en"
    ? "I heard you, but something broke on my side. Try again, or say e.g. “meditated for 30 seconds”."
    : "Jeg hørte deg, men noe røk på min side. Prøv igjen, eller si f.eks. «mediterte i 30 sekunder».";
}

export function noLlm(lang: Lang): string {
  return lang === "en"
    ? "I can log simple things (water, cold plunge, meditation, easy/ok/brutal), but I need OPENROUTER_API_KEY to talk freely."
    : "Jeg kan logge enkle ting (vann, kaldt bad, meditasjon, lett/passe/brutalt), men trenger OPENROUTER_API_KEY (eller Anthropic) for å svare fritt.";
}

export function agentStopped(lang: Lang): string {
  return lang === "en" ? "I had to stop — send one thing at a time." : "Jeg måtte stoppe — send gjerne én ting om gangen.";
}

export function agentError(lang: Lang, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("agent failed", msg);
  if (/deprecated|not_found_error|404.*model|model.*(not found|unavailable)/i.test(msg)) {
    return lang === "en"
      ? "I heard you, but the model name is invalid on OpenRouter. Fix PT_MODEL."
      : "Jeg hørte deg, men modellnavnet er ugyldig hos OpenRouter. Bytt PT_MODEL i pt/.env.";
  }
  if (/401|unauthorized|invalid.?api.?key|authentication_error|no cookie auth/i.test(msg)) {
    return lang === "en"
      ? "I heard you, but the LLM key was rejected. Check OPENROUTER_API_KEY on the host."
      : "Jeg hørte deg, men LLM-nøkkelen ble avvist. Sjekk OPENROUTER_API_KEY på hosten.";
  }
  if (/402|credit balance|too low|purchase credits|insufficient.?credits/i.test(msg)) {
    return lang === "en"
      ? "I heard you, but the LLM account is out of credit. Top up OpenRouter, or log something simple."
      : "Jeg hørte deg, men LLM-kontoen er tom for kreditt. Fyll på OpenRouter, eller bruk en enkel logg: «mediterte i 30 sekunder».";
  }
  if (/429|rate.?limit|too many requests/i.test(msg)) {
    return lang === "en"
      ? "I heard you, but the model is rate-limited. Try again in a minute, or say “today”."
      : "Jeg hørte deg, men modellen er rate-begrenset. Prøv igjen om litt, eller skriv «i dag».";
  }
  if (/5\d\d|timeout|timed out|ECONNRESET|fetch failed|network/i.test(msg)) {
    return lang === "en"
      ? "I heard you, but the model connection hiccuped. Try again, or ask “today”."
      : "Jeg hørte deg, men modell-tilkoblingen hakket. Prøv igjen, eller spør «i dag».";
  }
  return lang === "en"
    ? "I heard you, but couldn't put together a proper reply. Try a short log, or ask “today”."
    : "Jeg hørte deg, men fikk ikke laget et skikkelig svar. Prøv en kort logg, eller spør «i dag».";
}

/** True when the coach reply is a known LLM-failure fallback (not a real answer). */
export function isAgentFailureReply(text: string): boolean {
  const t = text.trim();
  return (
    /modellnavnet er ugyldig|model name is invalid/i.test(t) ||
    /LLM-nøkkelen ble avvist|LLM key was rejected/i.test(t) ||
    /tom for kreditt|out of credit/i.test(t) ||
    /rate-begrenset|rate-limited/i.test(t) ||
    /modell-tilkoblingen hakket|model connection hiccuped/i.test(t) ||
    /fikk ikke laget et skikkelig svar|couldn't put together a proper reply/i.test(t) ||
    /trenger OPENROUTER_API_KEY|need OPENROUTER_API_KEY/i.test(t)
  );
}
