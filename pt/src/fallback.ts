import { addLocalDays, localParts, todayInTz } from "./db.ts";
import { inferModality, modalityLabel, modalityOfSession, stacksHard, type Modality } from "./activity.ts";
import { assignSessionDays, startedOnOf } from "./calendar.ts";
import { parseAdaptChoice, isDidYouHearMe } from "./parser.ts";
import * as copy from "./copy.ts";
import * as journal from "./journal.ts";
import type { Lang } from "./locale.ts";
import type { Plan, PlanSession, UserRow } from "./types.ts";

export type ActualLog = {
  note: string | null;
  quality: string | null;
  sessionRef: string | null;
  modality: Modality | null;
  name?: string | null;
};

export type CoachAgenda = {
  week: number;
  daysPerWeek: number;
  yesterday: {
    ymd: string;
    view: Awaited<ReturnType<typeof journal.todayView>>;
    actual: ActualLog | null;
  };
  today: {
    ymd: string;
    view: Awaited<ReturnType<typeof journal.todayView>>;
    actual: ActualLog | null;
  };
  weekSessions: { weekday: number; title: string }[];
  reminders: { hour: number; minute: number; url: string | null }[];
  entries: Record<string, unknown>[];
  facts: ReturnType<typeof journal.factsOf>;
  plan: Plan | null;
  track: Awaited<ReturnType<typeof journal.activeTraining>>;
  startedOn: string | null;
};

function asTrainingEntries(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  return entries.filter((e) => String(e.kind ?? "") === "training");
}

export function actualOnDay(
  entries: Record<string, unknown>[],
  ymd: string,
  tz: string,
  plan: Plan | null,
): ActualLog | null {
  const hits = asTrainingEntries(entries).filter((e) => {
    const when = String(e.occurred_at ?? "");
    if (!when) return false;
    return localParts(tz, when).date === ymd;
  });
  if (!hits.length) return null;
  const e = hits[0];
  const ref = e.session_ref ? String(e.session_ref) : null;
  const planned = plan?.sessions?.find((s) => s.id === ref) ?? null;
  const blob = [e.note, e.name, planned?.title, planned?.loadKey, ref].filter(Boolean).join(" ");
  return {
    note: e.note ? String(e.note) : null,
    quality: e.quality ? String(e.quality) : null,
    sessionRef: ref,
    name: e.name ? String(e.name) : planned?.title ?? null,
    modality: inferModality(blob) ?? modalityOfSession(planned),
  };
}

export async function loadAgenda(user: UserRow): Promise<CoachAgenda> {
  const facts = journal.factsOf(user);
  const today = todayInTz(user.tz);
  const yesterday = addLocalDays(today, -1);
  const track = await journal.activeTraining(user.id);
  const plan = track ? journal.planOf(track) : null;
  const startedOn = track && plan ? startedOnOf(track, plan, user.tz) : null;
  const entries = await journal.recentEntries(user.id, 12);
  const reminders = (await journal.listReminders(user.id))
    .filter((r) => r.enabled === 1)
    .map((r) => ({ hour: r.hour, minute: r.minute, url: r.url }));
  const todayView = await journal.todayView(user, today);
  const yView = await journal.todayView(user, yesterday);
  const week = todayView.kind === "none" ? 1 : todayView.week;
  const assigned = plan ? assignSessionDays(plan) : null;
  const weekSessions = (assigned?.sessions ?? [])
    .filter((s) => (s.week ?? 1) === week)
    .slice()
    .sort((a, b) => (a.day ?? 0) - (b.day ?? 0))
    .map((s) => ({ weekday: s.day ?? 0, title: s.title }));
  return {
    week,
    daysPerWeek: plan?.daysPerWeek ?? (Number(facts.daysPerWeek) || weekSessions.length),
    yesterday: {
      ymd: yesterday,
      view: yView,
      actual: actualOnDay(entries, yesterday, user.tz, plan),
    },
    today: {
      ymd: today,
      view: todayView,
      actual: actualOnDay(entries, today, user.tz, plan),
    },
    weekSessions,
    reminders,
    entries,
    facts,
    plan,
    track: track ?? undefined,
    startedOn,
  };
}

export function plannedSessionOf(
  view: Awaited<ReturnType<typeof journal.todayView>>,
): PlanSession | null {
  if (view.kind === "session" || view.kind === "logged") return view.session;
  return null;
}

function isQuestion(body: string): boolean {
  return /\?/.test(body) || /^(hva|hvordan|hvorfor|hvilken|er det|bør|skal|sikker|kan vi|kan du)\b/i.test(body.trim());
}

function wantsProgram(body: string): boolean {
  return /\b(program|opplegg|ukeplan|planen som er satt|hvilken plan|days? per week|ganger (i|ila) uka|dager i uka|hvor er vi|hvor står vi|denne uka|denne uken|hva er status|status nå)\b/i.test(
    body,
  );
}

function wantsLog(body: string): boolean {
  return /\b(hva (har du )?(logget|lagret)|hva husker du|informasjon om meg)\b/i.test(body);
}

function wantsReminders(body: string): boolean {
  return /\b(minner du|påminnelse|påminnelser|hva minner|reminders?)\b/i.test(body);
}

function consecutiveQuestion(body: string): boolean {
  return (
    /\b(også|igjen|bør vi|skal vi løpe|to dager|på rad|løpe i dag)\b/i.test(body) ||
    (/\bi går\b/i.test(body) && /\b(i dag|også|igjen)\b/i.test(body))
  );
}

export function consecutiveConflict(agenda: CoachAgenda): {
  yesterdayMod: Modality;
  todaySession: PlanSession;
} | null {
  const yMod = agenda.yesterday.actual?.modality ?? null;
  const todaySess = plannedSessionOf(agenda.today.view);
  if (!yMod || !todaySess) return null;
  if (agenda.today.view.kind === "logged" || agenda.today.view.kind === "rest") return null;
  if (!stacksHard(yMod, modalityOfSession(todaySess))) return null;
  return { yesterdayMod: yMod, todaySession: todaySess };
}

function isAck(body: string): boolean {
  return /^(ok|okay|takk|tusen takk|thanks|thank you|konge[:\s]*takk|nice)[.!\s]*$/i.test(body.trim());
}

/** Journal-backed reply when the LLM path fails or as a coaching summary. */
export async function coachFallback(
  user: UserRow,
  lang: Lang,
  body: string,
  opts: { lastPt?: string | null; previousUser?: string | null } = {},
): Promise<string> {
  const text0 = body.trim();
  const text =
    isDidYouHearMe(text0) && opts.previousUser?.trim() ? opts.previousUser.trim() : text0;

  const agenda = await loadAgenda(user);

  if (parseAdaptChoice(text)) {
    /* Caller should have applied the choice; this is a last-resort line. */
    return copy.fallbackAck(lang);
  }
  if (isAck(text)) {
    return copy.fallbackAck(lang);
  }
  if (wantsReminders(text)) {
    return copy.fallbackReminders(lang, agenda.reminders);
  }
  if (wantsLog(text)) {
    return copy.fallbackMemory(lang, {
      facts: agenda.facts,
      entries: agenda.entries.slice(0, 5),
    });
  }
  if (wantsProgram(text) || (isQuestion(text) && /plan|program|uke|uka/i.test(text))) {
    return copy.fallbackWeek(lang, agenda);
  }

  const conflict = consecutiveConflict(agenda);
  const labeled = conflict
    ? { yesterdayMod: modalityLabel(lang, conflict.yesterdayMod), todaySession: conflict.todaySession }
    : null;
  const alreadyAsked = Boolean(opts.lastPt && copy.isAdaptOffer(opts.lastPt));
  if (labeled && consecutiveQuestion(text) && !alreadyAsked) {
    return copy.fallbackConsecutive(lang, {
      agenda,
      yesterdayMod: labeled.yesterdayMod,
      todayTitle: labeled.todaySession.title,
    });
  }

  if (agenda.today.view.kind === "logged") {
    const title = agenda.today.view.session.title;
    return copy.todayLogged(lang, title);
  }

  return copy.fallbackMeet(lang, agenda);
}

export function agendaForSnapshot(agenda: CoachAgenda) {
  const slot = (s: CoachAgenda["today"]) => ({
    ymd: s.ymd,
    kind: s.view.kind,
    weekday: "weekday" in s.view ? s.view.weekday : null,
    week: "week" in s.view ? s.view.week : null,
    title: plannedSessionOf(s.view)?.title ?? null,
    rest: s.view.kind === "rest",
    logged: s.view.kind === "logged",
    actual: s.actual,
  });
  return {
    week: agenda.week,
    daysPerWeek: agenda.daysPerWeek,
    weekSessions: agenda.weekSessions,
    yesterday: slot(agenda.yesterday),
    today: slot(agenda.today),
    goal: agenda.facts.goal ?? null,
    identity: agenda.facts.identity ?? null,
  };
}
