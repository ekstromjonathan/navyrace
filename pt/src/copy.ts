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
  if (/deprecated|not_found_error/i.test(msg)) {
    return lang === "en"
      ? "I heard you, but the model name is invalid on OpenRouter. Fix PT_MODEL."
      : "Jeg hørte deg, men modellnavnet er ugyldig hos OpenRouter. Bytt PT_MODEL i pt/.env.";
  }
  if (/credit balance|too low|purchase credits/i.test(msg)) {
    return lang === "en"
      ? "I heard you, but the LLM account is out of credit. Set OPENROUTER_API_KEY, or log something simple."
      : "Jeg hørte deg, men LLM-kontoen er tom for kreditt. Sett OPENROUTER_API_KEY i pt/.env, eller bruk en enkel logg: «mediterte i 30 sekunder».";
  }
  return lang === "en"
    ? "I heard you, but couldn't put together a proper reply. Try a short log, or try again in a bit."
    : "Jeg hørte deg, men fikk ikke laget et skikkelig svar. Prøv en kort logg, eller prøv igjen om litt.";
}
