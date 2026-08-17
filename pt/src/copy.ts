import type { Lang } from "./locale.ts";
import type { DayView } from "./calendar.ts";
import type { PlanSession } from "./types.ts";

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function pick(lang: Lang, en: string, nb: string, sv: string): string {
  if (lang === "en") return en;
  if (lang === "sv") return sv;
  return nb;
}

const WEEKDAYS = {
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  nb: ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"],
  sv: ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"],
} as const;

export function weekdayName(lang: Lang, day: number): string {
  const list = WEEKDAYS[lang] ?? WEEKDAYS.nb;
  return list[Math.max(0, Math.min(6, day))] ?? list[0];
}

export function restDayTips(lang: Lang, weekday: number): string {
  const name = weekdayName(lang, weekday);
  const rotate = weekday % 3;
  if (rotate === 1) {
    return pick(
      lang,
      `${name} is a rest day. Easy walk if you want to move, eat well, sleep. Don't "make up" a hard session.`,
      `${name} er hviledag. Gå en tur hvis du vil røre deg, spis skikkelig, sov. Ikke ta igjen med en hard økt.`,
      `${name} är vilodag. Gå en promenad om du vill röra på dig, ät ordentligt, sov. Ta inte igen med ett hårt pass.`,
    );
  }
  if (rotate === 2) {
    return pick(
      lang,
      `${name} is rest. Light mobility if something's stiff — food and water do more than another workout today.`,
      `${name} er hvile. Lett mobilitet hvis noe er stivt — mat og vann gir mer enn en ekstra økt i dag.`,
      `${name} är vila. Lätt mobilitet om något är stelt — mat och vatten ger mer än ett extra pass idag.`,
    );
  }
  return pick(
    lang,
    `${name} is a rest day. A 20–40 min walk, a proper meal, and sleep — that's the work today.`,
    `${name} er hviledag. En tur på 20–40 min, skikkelig mat og søvn — det er jobben i dag.`,
    `${name} är vilodag. En promenad på 20–40 min, ordentlig mat och sömn — det är jobbet idag.`,
  );
}

export function sessionHeading(
  lang: Lang,
  session: PlanSession,
  load: number | null,
): string {
  const dose = load != null ? `${load}${session.unit ? ` ${session.unit}` : ""}` : "";
  const est = session.est ? ` · ${session.est}` : "";
  const extra = dose ? ` (${dose})` : "";
  return pick(
    lang,
    `Today: ${session.title}${extra}${est}`,
    `I dag: ${session.title}${extra}${est}`,
    `Idag: ${session.title}${extra}${est}`,
  );
}

export function greetingReply(
  lang: Lang,
  view: DayView,
  opts: { missingForPlan?: string[]; draftName?: string | null } = {},
): string {
  if (view.kind === "rest") {
    const hi = pick(lang, "Hey.", "Hei.", "Hej.");
    return `${hi} ${restDayTips(lang, view.weekday)}`;
  }
  if (view.kind === "logged") {
    return pick(
      lang,
      `Hey. Today's session (“${view.session.title}”) is already in the log — enjoy the rest of the day.`,
      `Hei. Dagens økt («${view.session.title}») er allerede i boks — kos deg med resten av dagen.`,
      `Hej. Dagens pass («${view.session.title}») är redan i loggen — njut av resten av dagen.`,
    );
  }
  if (view.kind === "complete") {
    return pick(
      lang,
      "Hey. This block is logged out. Want a new one, or pull an archive?",
      "Hei. Blokka er ferdig ut. Vil du ha en ny, eller hente et arkiv?",
      "Hej. Blocket är slutloggat. Vill du ha ett nytt, eller hämta ett arkiv?",
    );
  }
  if (view.kind === "session") {
    return pick(
      lang,
      `Hey. ${view.session.title} is on the plan today when you're ready — ask if you want the details.`,
      `Hei. ${view.session.title} står på planen i dag når du er klar — spør hvis du vil ha detaljene.`,
      `Hej. ${view.session.title} står på planen idag när du är redo — fråga om du vill ha detaljerna.`,
    );
  }
  if (opts.draftName) {
    return pick(
      lang,
      `Hey. You've got a draft (“${opts.draftName}”). Say yes / ok / run it to lock it, or tell me what to change.`,
      `Hei. Du har et utkast («${opts.draftName}»). Si ja / ok / kjør for å låse, eller fortell hva som skal endres.`,
      `Hej. Du har ett utkast («${opts.draftName}»). Säg ja / ok / kör för att låsa, eller berätta vad som ska ändras.`,
    );
  }
  const missing = opts.missingForPlan ?? [];
  if (missing.length) {
    const field = missing[0];
    const ask =
      field === "goal"
        ? pick(lang, "What are you training toward?", "Hva trener du mot?", "Vad tränar du mot?")
        : field === "level"
          ? pick(lang, "What's your training experience like?", "Hvordan er erfaringsnivået ditt?", "Hur ser träningsvanan ut?")
          : field === "daysPerWeek"
            ? pick(lang, "How many days a week can you train?", "Hvor mange dager i uka kan du trene?", "Hur många dagar i veckan kan du träna?")
            : pick(lang, "What gear do you have?", "Hva har du av utstyr?", "Vilken utrustning har du?");
    return pick(lang, `Hey. ${ask}`, `Hei. ${ask}`, `Hej. ${ask}`);
  }
  return pick(
    lang,
    "Hey. Tell me what you want to keep on top of — I'll take it from there.",
    "Hei. Fortell hva du vil holde styr på — så tar vi det derfra.",
    "Hej. Berätta vad du vill hålla koll på — så tar vi det därifrån.",
  );
}

export function optOutReply(lang: Lang): string {
  return pick(
    lang,
    "Ok, I'll stay quiet. Write when you want to pick it up.",
    "Ok, jeg er stille. Skriv når du vil igjen.",
    "Ok, jag är tyst. Skriv när du vill igen.",
  );
}

export function reminderConfirm(lang: Lang, hour: number, minute: number, tz: string): string {
  const t = hhmm(hour, minute);
  return pick(
    lang,
    `Ok — daily training reminder at ${t} (${tz}). I'll skip the day if you already logged a session. Say “stop reminding me” to turn it off.`,
    `Ok — daglig treningspåminnelse kl ${t} (${tz}). Jeg hopper over dagen hvis du allerede har logget økt. Si «slutt å minne meg» for å skru av.`,
    `Ok — daglig träningspåminnelse kl ${t} (${tz}). Jag hoppar över dagen om du redan har loggat pass. Säg «sluta påminna mig» för att stänga av.`,
  );
}

export function reminderConfirmOnce(lang: Lang, hour: number, minute: number, onceOn: string, tz: string): string {
  const t = hhmm(hour, minute);
  return pick(
    lang,
    `Ok — one reminder on ${onceOn} at ${t} (${tz}). Say “stop reminding me” to cancel.`,
    `Ok — én påminnelse ${onceOn} kl ${t} (${tz}). Si «slutt å minne meg» for å avbryte.`,
    `Ok — en påminnelse ${onceOn} kl ${t} (${tz}). Säg «sluta påminna mig» för att avbryta.`,
  );
}

export function reminderConfirmWithUrl(
  lang: Lang,
  hour: number,
  minute: number,
  tz: string,
  url: string,
): string {
  const t = hhmm(hour, minute);
  return pick(
    lang,
    `Ok — daily reminder at ${t} (${tz}) with your link:\n${url}\nSay “stop reminding me” to turn it off.`,
    `Ok — daglig påminnelse kl ${t} (${tz}) med lenken:\n${url}\nSi «slutt å minne meg» for å skru av.`,
    `Ok — daglig påminnelse kl ${t} (${tz}) med länken:\n${url}\nSäg «sluta påminna mig» för att stänga av.`,
  );
}

export function reminderConfirmOnceWithUrl(
  lang: Lang,
  hour: number,
  minute: number,
  onceOn: string,
  tz: string,
  url: string,
): string {
  const t = hhmm(hour, minute);
  return pick(
    lang,
    `Ok — one reminder on ${onceOn} at ${t} (${tz}) with your link:\n${url}\nSay “stop reminding me” to cancel.`,
    `Ok — én påminnelse ${onceOn} kl ${t} (${tz}) med lenken:\n${url}\nSi «slutt å minne meg» for å avbryte.`,
    `Ok — en påminnelse ${onceOn} kl ${t} (${tz}) med länken:\n${url}\nSäg «sluta påminna mig» för att avbryta.`,
  );
}

export function videoLinkAsk(lang: Lang): string {
  return pick(
    lang,
    "Got the link. What time should I ping you?",
    "Har lenken. Når skal jeg minne deg?",
    "Har länken. När ska jag påminna dig?",
  );
}

export function inviteAsk(lang: Lang, name: string | null, phone: string): string {
  const who = name?.trim() || phone;
  if (name?.trim()) {
    return pick(
      lang,
      `${who} wants in. Should I let them in?`,
      `${who} vil være med. Skal jeg slippe henne inn?`,
      `${who} vill vara med. Ska jag släppa in henne?`,
    );
  }
  return pick(
    lang,
    `${phone} wants in. Should I let them in?`,
    `${phone} vil være med. Skal jeg slippe inn?`,
    `${phone} vill vara med. Ska jag släppa in?`,
  );
}

export function inviteApproved(lang: Lang, name: string | null, phone: string): string {
  const who = name?.trim() || phone;
  return pick(
    lang,
    `Ok — ${who} is in. I'll start onboarding.`,
    `Ok — ${who} er inne. Jeg tar onboarding.`,
    `Ok — ${who} är inne. Jag tar onboarding.`,
  );
}

export function inviteDenied(lang: Lang, name: string | null, phone: string): string {
  const who = name?.trim() || phone;
  return pick(
    lang,
    `Ok, ${who} is not getting in.`,
    `Ok, ${who} kommer ikke inn.`,
    `Ok, ${who} kommer inte in.`,
  );
}

/** Greeting uses the first given name, not the full legal name. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first || null;
}

export function inviteWelcome(lang: Lang, name: string | null, coach: string): string {
  const who = firstName(name);
  const hello = who
    ? pick(lang, `Hi ${who}`, `Hei ${who}`, `Hej ${who}`)
    : pick(lang, "Hi", "Hei", "Hej");
  return pick(
    lang,
    `${hello} — I'm ${coach}. Your new coach.\n\nI want to help you become a better version of yourself. Workouts, habits, reminders — tell me, I'll keep track.\n\nWhat do you want to keep on top of?`,
    `${hello} — jeg er ${coach}. Din nye coach.\n\nJeg vil hjelpe deg å bli en bedre versjon av deg selv. Økter, vaner, påminnelser — si ifra, så tar jeg det.\n\nHva har du lyst å holde styr på?`,
    `${hello} — jag är ${coach}. Din nya coach.\n\nJag vill hjälpa dig att bli en bättre version av dig själv. Pass, vanor, påminnelser — säg till, så tar jag det.\n\nVad vill du hålla koll på?`,
  );
}

export function reminderScopeAsk(lang: Lang, hour: number, minute: number): string {
  const t = hhmm(hour, minute);
  return pick(
    lang,
    `Got it — ${t}. Should that be every day, or just once (today/tonight)?`,
    `Skjønner — kl ${t}. Skal det være hver dag, eller bare i dag/i kveld?`,
    `Uppfattat — kl ${t}. Ska det vara varje dag, eller bara idag/ikväll?`,
  );
}

export function reminderScopeCancelled(lang: Lang): string {
  return pick(lang, "Ok, no reminder set.", "Ok, ingen påminnelse satt.", "Ok, ingen påminnelse satt.");
}

export function reminderCancel(lang: Lang, had: boolean): string {
  if (had) {
    return pick(lang, "Ok, no more training reminders.", "Ok, ingen flere treningspåminnelser.", "Ok, inga fler träningspåminnelser.");
  }
  return pick(
    lang,
    "You don't have a reminder to turn off.",
    "Du har ingen påminnelse å skru av.",
    "Du har ingen påminnelse att stänga av.",
  );
}

export function noDraft(lang: Lang): string {
  return pick(lang, "There's no draft to lock in.", "Det finnes ikke noe utkast å låse.", "Det finns inget utkast att låsa.");
}

export function noActivePlan(lang: Lang): string {
  return pick(lang, "No active plan to archive.", "Ingen aktiv plan å arkivere.", "Ingen aktiv plan att arkivera.");
}

export function noRpePlan(lang: Lang): string {
  return pick(
    lang,
    "No active plan to log how a session felt. Tell me what you did and I'll log it as a track.",
    "Ingen aktiv plan å logge hvordan en økt føltes på. Si hva du gjorde, så logger jeg det som et spor.",
    "Ingen aktiv plan att logga hur ett pass kändes. Säg vad du gjorde, så loggar jag det som ett spår.",
  );
}

export function rpeLogged(lang: Lang, quality: string): string {
  if (quality === "hoppet") {
    return pick(
      lang,
      "Noted — skipped. It doesn't count toward the dose. Next when you're ready.",
      "Notert — hoppet. Den teller ikke i dosen. Neste når du er klar.",
      "Noterat — hoppat. Det räknas inte i dosen. Nästa när du är redo.",
    );
  }
  if (quality === "brutalt") {
    return pick(
      lang,
      "Noted as brutal. I'll ease the next similar session.",
      "Notert som brutalt. Jeg letter neste like økt.",
      "Noterat som brutalt. Jag lättar nästa likadana pass.",
    );
  }
  if (quality === "lett") {
    return pick(
      lang,
      "Noted as easy. I'll bump the next similar session a little.",
      "Notert som lett. Jeg skrur opp neste like økt litt.",
      "Noterat som lätt. Jag skrur upp nästa likadana pass lite.",
    );
  }
  return pick(
    lang,
    "Noted as about right. Holding the plan.",
    "Notert som passe. Holder planen.",
    "Noterat som lagom. Håller planen.",
  );
}

export function sessionLogged(
  lang: Lang,
  opts: { title: string; dayLabel: string; planned: boolean; askRpe: boolean },
): string {
  const where = opts.planned
    ? pick(
        lang,
        `“${opts.title}” is in the log (${opts.dayLabel}) — nice one.`,
        `«${opts.title}» i boks (${opts.dayLabel}) — bra jobba.`,
        `«${opts.title}» i loggen (${opts.dayLabel}) — snyggt.`,
      )
    : pick(
        lang,
        `Logged extra session “${opts.title}” (${opts.dayLabel}) — plan stays as-is. Nice.`,
        `Ekstraøkt «${opts.title}» logget (${opts.dayLabel}) — planen står. Bra jobba.`,
        `Extrapass «${opts.title}» loggat (${opts.dayLabel}) — planen står. Snyggt.`,
      );
  if (!opts.askRpe) return where;
  const ask = pick(
    lang,
    "How hard was it? (easy / about right / brutal)",
    "Hvor hardt var det? (lett / passe / brutalt)",
    "Hur hårt var det? (lätt / lagom / brutalt)",
  );
  return `${where}\n${ask}`;
}

export function sessionDayAsk(lang: Lang): string {
  return pick(
    lang,
    "Got it — which day should I log that on? Today or yesterday?",
    "Skjønner — hvilken dag skal jeg logge det på? I dag eller i går?",
    "Uppfattat — vilken dag ska jag logga det på? Idag eller igår?",
  );
}

export function sessionDayCancelled(lang: Lang): string {
  return pick(lang, "Ok, nothing logged.", "Ok, ingenting logget.", "Ok, ingenting loggat.");
}

export function sessionNoPlan(lang: Lang): string {
  return pick(
    lang,
    "No active program yet — I'll still note what you did once we lock a plan. Want to lock the draft?",
    "Ingen aktivt program ennå — jeg noterer det når vi har låst et opplegg. Vil du låse utkastet?",
    "Inget aktivt program än — jag noterar det när vi har låst ett upplägg. Vill du låsa utkastet?",
  );
}

export function rpeNeedSession(lang: Lang): string {
  return pick(
    lang,
    "Tell me what you did first (even if it wasn't the planned session), then easy / about right / brutal.",
    "Si først hva du gjorde (selv om det ikke var den planlagte økta), så lett / passe / brutalt.",
    "Säg först vad du gjorde (även om det inte var det planerade passet), sen lätt / lagom / brutalt.",
  );
}

export function loggedItem(lang: Lang, name: string, qty: string, n: number): string {
  return pick(
    lang,
    `Logged ${name.toLowerCase()}${qty}. ${n} on that track.`,
    `Logget ${name.toLowerCase()}${qty}. ${n} på det sporet.`,
    `Loggat ${name.toLowerCase()}${qty}. ${n} på det spåret.`,
  );
}

export function duplicateLog(lang: Lang): string {
  return pick(lang, "I already had that one.", "Den hadde jeg allerede.", "Den hade jag redan.");
}

export function entryArchived(lang: Lang, name: string): string {
  return pick(
    lang,
    `Archived — “${name}” is out of the live log. It sits as a snapshot.`,
    `Arkivert — «${name}» er tatt ut av den levende loggen. Den ligger som snapshot.`,
    `Arkiverad — «${name}» är tagen ur den levande loggen. Den ligger som snapshot.`,
  );
}

export function noEntryToArchive(lang: Lang): string {
  return pick(lang, "No log to archive.", "Fant ingen logg å arkivere.", "Hittade ingen logg att arkivera.");
}

export function activatePrompt(lang: Lang, name: string, sessionCount: number): string {
  return pick(
    lang,
    [
      `Draft “${name}” — ${sessionCount} sessions.`,
      "It adapts from how each session felt (easy / about right / brutal).",
      "Say yes / ok / run it when you want to lock it and start.",
    ].join("\n"),
    [
      `Utkast «${name}» — ${sessionCount} økter.`,
      "Det tilpasses etter hvordan hver økt føles (lett / passe / brutalt).",
      "Si ja / ok / kjør når du vil låse og starte.",
    ].join("\n"),
    [
      `Utkast «${name}» — ${sessionCount} pass.`,
      "Det anpassas efter hur varje pass känns (lätt / lagom / brutalt).",
      "Säg ja / ok / kör när du vill låsa och starta.",
    ].join("\n"),
  );
}

export function archivePrompt(lang: Lang, name: string, entryCount: number, noteCount: number): string {
  return pick(
    lang,
    [
      `“${name}” is active — ${entryCount} logs and ${noteCount} notes.`,
      "Nothing is deleted. It archives as a snapshot you can pull later.",
      'Write exactly “archive and start new” if you want that. Anything else cancels.',
    ].join("\n"),
    [
      `«${name}» er aktivt — ${entryCount} logger og ${noteCount} notater.`,
      "Det slettes ikke. Det arkiveres som snapshot du kan hente senere.",
      'Skriv nøyaktig «arkiver og lag nytt» hvis du vil det. Alt annet avbryter.',
    ].join("\n"),
    [
      `«${name}» är aktivt — ${entryCount} loggar och ${noteCount} anteckningar.`,
      "Det raderas inte. Det arkiveras som snapshot du kan hämta senare.",
      'Skriv exakt «arkivera och gör nytt» om du vill det. Allt annat avbryter.',
    ].join("\n"),
  );
}

export function activated(lang: Lang): string {
  return pick(
    lang,
    "Program is locked.",
    "Programmet er låst.",
    "Programmet är låst.",
  );
}

export function activateFailed(lang: Lang, detail: string): string {
  return detail || pick(lang, "Couldn't activate.", "Klarte ikke å aktivere.", "Kunde inte aktivera.");
}

export function activateCancelled(lang: Lang): string {
  return pick(
    lang,
    "Cancelled — the program is still a draft.",
    "Avbrutt — programmet ligger fortsatt som utkast.",
    "Avbrutet — programmet ligger kvar som utkast.",
  );
}

export function archived(lang: Lang): string {
  return pick(
    lang,
    "Archived. It sits as a snapshot. Tell me what the new setup should aim at.",
    "Arkivert. Det ligger som snapshot. Fortell hva det nye opplegget skal styre mot.",
    "Arkiverat. Det ligger som snapshot. Berätta vad det nya upplägget ska styra mot.",
  );
}

export function archiveCancelled(lang: Lang): string {
  return pick(lang, "Cancelled — nothing was archived.", "Avbrutt — ingenting ble arkivert.", "Avbrutet — ingenting arkiverades.");
}

export function savedField(lang: Lang, field: string): string {
  return pick(lang, `Saved ${field}.`, `Lagret ${field}.`, `Sparat ${field}.`);
}

export function todayNoPlan(lang: Lang): string {
  return pick(
    lang,
    "No active plan yet. Tell me goal, training experience, days per week and gear — I'll draft a week you confirm, and we'll tune it from how sessions feel.",
    "Ingen aktiv plan ennå. Fortell mål, erfaring, dager i uka og utstyr — så lager jeg et utkast du bekrefter, og vi justerer etter hvordan øktene føles.",
    "Ingen aktiv plan än. Berätta mål, erfarenhet, dagar i veckan och utrustning — så gör jag ett utkast du bekräftar, och vi justerar efter hur passen känns.",
  );
}

export function todayDraft(lang: Lang, name: string): string {
  return pick(
    lang,
    `You have a draft (“${name}”). Say yes / ok / run it to lock it, or tell me what to change.`,
    `Du har et utkast («${name}»). Si ja / ok / kjør for å låse, eller fortell hva som skal endres.`,
    `Du har ett utkast («${name}»). Säg ja / ok / kör för att låsa, eller berätta vad som ska ändras.`,
  );
}

export function todayDone(lang: Lang, name: string): string {
  return pick(
    lang,
    `“${name}” is logged out. Want a new block, or pull an archive?`,
    `«${name}» er ferdig ut logg-messig. Vil du ha en ny blokk, eller hente et arkiv?`,
    `«${name}» är slutloggat. Vill du ha ett nytt block, eller hämta ett arkiv?`,
  );
}

export function todayLogged(lang: Lang, title: string): string {
  return pick(
    lang,
    `Today's session (“${title}”) is already logged. Rest, eat, sleep — ping me if something's tight.`,
    `Dagens økt («${title}») er allerede i boks. Hvil, spis, sov — si ifra hvis noe strammer.`,
    `Dagens pass («${title}») är redan loggat. Vila, ät, sov — säg till om något stramar.`,
  );
}

export function todayFooter(lang: Lang): string {
  return pick(
    lang,
    "When you're done: how hard was it, and how did it feel? (easy / about right / brutal)",
    "Når du er ferdig: hvor hardt var det, og hvordan føltes det? (lett / passe / brutalt)",
    "När du är klar: hur hårt var det, och hur kändes det? (lätt / lagom / brutalt)",
  );
}

export function adaptNote(lang: Lang, prev: string): string {
  if (prev === "lett") {
    return pick(lang, "Last one felt easy — nudging up a bit.", "Forrige føltes lett — skrur opp litt.", "Förra kändes lätt — skruvar upp lite.");
  }
  return pick(lang, "Last one was hard — easing off a bit.", "Forrige var hard — letter litt.", "Förra var hård — lättar lite.");
}

export function reminderPingNoPlan(lang: Lang): string {
  return pick(
    lang,
    "Training day. Tell me goal, experience, days and gear — I'll put a week together.",
    "Treningsdag. Fortell mål, erfaring, dager og utstyr — så setter jeg sammen ei uke.",
    "Träningsdag. Berätta mål, erfarenhet, dagar och utrustning — så sätter jag ihop en vecka.",
  );
}

export function reminderPingDone(lang: Lang, name: string): string {
  return pick(
    lang,
    `Reminder — “${name}” is logged out. Want a new block?`,
    `Påminnelse — «${name}» er ferdig ut. Vil du ha en ny blokk?`,
    `Påminnelse — «${name}» är slutloggat. Vill du ha ett nytt block?`,
  );
}

export function reminderPingRest(lang: Lang, tips: string): string {
  return pick(
    lang,
    [`Rest day.`, tips].join("\n"),
    [`Hviledag.`, tips].join("\n"),
    [`Vilodag.`, tips].join("\n"),
  );
}

export function reminderPingToday(lang: Lang, line: string): string {
  return pick(
    lang,
    [`Training today.`, line, "Say easy / about right / brutal when you're done."].join("\n"),
    [`Trening i dag.`, line, "Si lett / passe / brutalt når du er ferdig."].join("\n"),
    [`Träning idag.`, line, "Säg lätt / lagom / brutalt när du är klar."].join("\n"),
  );
}

export function reminderPingVideo(lang: Lang, url: string): string {
  return pick(
    lang,
    [`Reminder — time to watch this:`, url].join("\n"),
    [`Påminnelse — tid for å se dette:`, url].join("\n"),
    [`Påminnelse — dags att se det här:`, url].join("\n"),
  );
}

export function handlerError(lang: Lang): string {
  return pick(
    lang,
    'I heard you, but something broke on my side. Try again, or say e.g. “meditated for 30 seconds”.',
    "Jeg hørte deg, men noe røk på min side. Prøv igjen, eller si f.eks. «mediterte i 30 sekunder».",
    "Jag hörde dig, men något gick sönder på min sida. Försök igen, eller säg t.ex. «mediterade i 30 sekunder».",
  );
}

export function noLlm(lang: Lang): string {
  return pick(
    lang,
    "I can log simple things (water, cold plunge, meditation, easy/ok/brutal), but I need OPENROUTER_API_KEY to talk freely.",
    "Jeg kan logge enkle ting (vann, kaldt bad, meditasjon, lett/passe/brutalt), men trenger OPENROUTER_API_KEY (eller Anthropic) for å svare fritt.",
    "Jag kan logga enkla saker (vatten, kallt bad, meditation, lätt/lagom/brutalt), men behöver OPENROUTER_API_KEY (eller Anthropic) för att svara fritt.",
  );
}

export function agentStopped(lang: Lang): string {
  return pick(
    lang,
    "I had to stop — send one thing at a time.",
    "Jeg måtte stoppe — send gjerne én ting om gangen.",
    "Jag var tvungen att stanna — skicka gärna en sak i taget.",
  );
}

export function agentError(lang: Lang, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("agent failed", msg);
  if (/deprecated|not_found_error|404.*model|model.*(not found|unavailable)/i.test(msg)) {
    return pick(
      lang,
      "I heard you, but the model name is invalid on OpenRouter. Fix PT_MODEL.",
      "Jeg hørte deg, men modellnavnet er ugyldig hos OpenRouter. Bytt PT_MODEL i pt/.env.",
      "Jag hörde dig, men modellnamnet är ogiltigt hos OpenRouter. Byt PT_MODEL i pt/.env.",
    );
  }
  if (/401|unauthorized|invalid.?api.?key|authentication_error|no cookie auth/i.test(msg)) {
    return pick(
      lang,
      "I heard you, but the LLM key was rejected. Check OPENROUTER_API_KEY on the host.",
      "Jeg hørte deg, men LLM-nøkkelen ble avvist. Sjekk OPENROUTER_API_KEY på hosten.",
      "Jag hörde dig, men LLM-nyckeln avvisades. Kolla OPENROUTER_API_KEY på hosten.",
    );
  }
  if (/402|credit balance|too low|purchase credits|insufficient.?credits/i.test(msg)) {
    return pick(
      lang,
      "I heard you, but the LLM account is out of credit. Top up OpenRouter, or log something simple.",
      "Jeg hørte deg, men LLM-kontoen er tom for kreditt. Fyll på OpenRouter, eller bruk en enkel logg: «mediterte i 30 sekunder».",
      "Jag hörde dig, men LLM-kontot är tomt på kredit. Fyll på OpenRouter, eller använd en enkel logg: «mediterade i 30 sekunder».",
    );
  }
  if (/429|rate.?limit|too many requests/i.test(msg)) {
    return pick(
      lang,
      "I heard you, but the model is rate-limited. Try again in a minute, or say “today”.",
      "Jeg hørte deg, men modellen er rate-begrenset. Prøv igjen om litt, eller skriv «i dag».",
      "Jag hörde dig, men modellen är rate-begränsad. Försök igen om en stund, eller skriv «idag».",
    );
  }
  if (/5\d\d|timeout|timed out|ECONNRESET|fetch failed|network/i.test(msg)) {
    return pick(
      lang,
      "I heard you, but the model connection hiccuped. Try again, or ask “today”.",
      "Jeg hørte deg, men modell-tilkoblingen hakket. Prøv igjen, eller spør «i dag».",
      "Jag hörde dig, men modellanslutningen hakade. Försök igen, eller fråga «idag».",
    );
  }
  return pick(
    lang,
    "I heard you, but couldn't put together a proper reply. Try a short log, or ask “today”.",
    "Jeg hørte deg, men fikk ikke laget et skikkelig svar. Prøv en kort logg, eller spør «i dag».",
    "Jag hörde dig, men fick inte till ett ordentligt svar. Prova en kort logg, eller fråga «idag».",
  );
}

/** True when the coach reply is a known LLM-failure fallback (not a real answer). */
export function isAgentFailureReply(text: string): boolean {
  const t = text.trim();
  return (
    /modellnavnet er ugyldig|model name is invalid|modellnamnet är ogiltigt/i.test(t) ||
    /LLM-nøkkelen ble avvist|LLM key was rejected|LLM-nyckeln avvisades/i.test(t) ||
    /tom for kreditt|out of credit|tomt på kredit/i.test(t) ||
    /rate-begrenset|rate-limited|rate-begränsad/i.test(t) ||
    /modell-tilkoblingen hakket|model connection hiccuped|modellanslutningen hakade/i.test(t) ||
    /fikk ikke laget et skikkelig svar|couldn't put together a proper reply|fick inte till ett ordentligt svar/i.test(t) ||
    /trenger OPENROUTER_API_KEY|need OPENROUTER_API_KEY|behöver OPENROUTER_API_KEY/i.test(t)
  );
}
