import {
  inferModality,
  isHeavyDose,
  modalityOfSession,
  stacksHard,
  type Modality,
} from "./activity.ts";
import { upcomingSessions, sessionsInWeek } from "./calendar.ts";
import type { Plan, PlanSession } from "./types.ts";

export type AdaptResult = {
  plan: Plan;
  changed: boolean;
  summaryNb: string;
  swappedToday?: PlanSession | null;
};

function alreadyEased(session: PlanSession): boolean {
  return /^roligere /i.test(session.title) || session.items?.[0]?.name === "Tilpasset";
}

function easeSession(session: PlanSession, reason: string): PlanSession {
  if (alreadyEased(session)) return session;
  const load = session.load != null ? Math.max(1, Math.round(Number(session.load) * 0.7)) : session.load;
  const est = session.est
    ? session.est.replace(/(\d+)/, (n) => String(Math.max(15, Math.round(Number(n) * 0.7))))
    : session.est;
  const title = /rolig|lett|kort|easy/i.test(session.title)
    ? session.title
    : `Roligere ${session.title}`;
  const items = [
    { name: "Tilpasset", detail: reason },
    ...(session.items ?? []).slice(0, 4),
  ];
  return { ...session, load, est, title, items };
}

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    sessions: (plan.sessions ?? []).map((s) => ({
      ...s,
      items: (s.items ?? []).map((it) => ({ ...it })),
    })),
  };
}

function replaceSession(plan: Plan, id: string, next: PlanSession): Plan {
  return {
    ...plan,
    sessions: plan.sessions.map((s) => (s.id === id ? { ...next, id: s.id, week: s.week, day: s.day } : s)),
  };
}

/**
 * After a session is logged (possibly a substitute), rewrite upcoming sessions:
 * - same-family two days in a row → swap tomorrow with the missed planned work if we have it
 * - they already did a later slot's work (paddle on a run day) → ease that later slot
 * - heavy dose (2h paddle, long tennis) → ease the next day
 */
export function adaptAfterLog(
  plan: Plan,
  opts: {
    startedOn: string;
    loggedOnYmd: string;
    planned: PlanSession | null;
    actualText: string;
    actualModality?: Modality | null;
  },
): AdaptResult {
  const next = clonePlan(plan);
  const actual = opts.actualModality ?? inferModality(opts.actualText);
  const plannedMod = modalityOfSession(opts.planned);
  const upcoming = upcomingSessions(plan, opts.startedOn, opts.loggedOnYmd, 6);
  if (!upcoming.length) {
    return { plan: next, changed: false, summaryNb: "" };
  }

  const notes: string[] = [];
  let swappedToday: PlanSession | null = null;
  const heavy = isHeavyDose(opts.actualText);
  const diverged = Boolean(actual && plannedMod && actual !== plannedMod);
  const first = upcoming[0];
  const stackedSoon = Boolean(first && stacksHard(actual, modalityOfSession(first.session)));

  const laterExact = actual
    ? upcoming.find(
        (u) => modalityOfSession(u.session) === actual && (!first || u.session.id !== first.session.id),
      )
    : undefined;

  if (diverged && laterExact && !alreadyEased(laterExact.session)) {
    const eased = easeSession(
      laterExact.session,
      `Du tok ${opts.actualText.slice(0, 80)} ${opts.loggedOnYmd}. Denne økta letter så du ikke dobler stimulansen.`,
    );
    Object.assign(next, replaceSession(next, laterExact.session.id, eased));
    notes.push(`letter ${laterExact.session.title.toLowerCase()} senere i uka`);
  }

  if (stackedSoon && first && opts.planned && plannedMod && plannedMod !== actual) {
    const sameAlready =
      first.session.title === opts.planned.title && first.session.loadKey === opts.planned.loadKey;
    if (!sameAlready) {
      const moved = { ...opts.planned, id: first.session.id, week: first.session.week, day: first.session.day };
      Object.assign(next, replaceSession(next, first.session.id, moved));
      swappedToday = moved;
      notes.push(`bytter neste økt til ${opts.planned.title.toLowerCase()} så du ikke dobler ${actual}`);
    }
  } else if (first && heavy && !alreadyEased(first.session)) {
    const eased = easeSession(first.session, "Forrige økt var lang — letter denne så kroppen henter seg inn.");
    Object.assign(next, replaceSession(next, first.session.id, eased));
    notes.push("letter neste økt etter en lang økt");
  }

  const changed = notes.length > 0;
  return {
    plan: next,
    changed,
    summaryNb: changed ? notes.join("; ") : "",
    swappedToday,
  };
}

/** Ease today's session in place (they asked for a quiet day). */
export function easeToday(plan: Plan, today: PlanSession, reason: string): AdaptResult {
  if (alreadyEased(today)) {
    return { plan, changed: false, summaryNb: "" };
  }
  const eased = easeSession(today, reason);
  return {
    plan: replaceSession(clonePlan(plan), today.id, eased),
    changed: true,
    summaryNb: `letter ${today.title.toLowerCase()} i dag`,
  };
}

function otherFamilyThisWeek(plan: Plan, today: PlanSession, avoid: Modality): PlanSession | null {
  const week = today.week ?? 1;
  return (
    sessionsInWeek(plan, week).find(
      (s) => s.id !== today.id && !stacksHard(avoid, modalityOfSession(s)),
    ) ?? null
  );
}

/** Swap vs ease vs keep today's slot after stacked days. */
export function applyAdaptChoice(
  plan: Plan,
  choice: "swap" | "ease" | "keep",
  opts: {
    startedOn: string;
    yesterdayYmd: string;
    yesterdayPlanned: PlanSession | null;
    yesterdayModality: Modality | null;
    yesterdayNote?: string;
    todaySession: PlanSession | null;
  },
): AdaptResult {
  if (choice === "keep" || !opts.todaySession) {
    return { plan, changed: false, summaryNb: "" };
  }
  if (choice === "ease") {
    return easeToday(plan, opts.todaySession, "Du ville ha en rolig dag — letter dagens økt.");
  }
  const swapped = adaptForConsecutive(plan, opts);
  if (swapped.changed) return swapped;
  if (!opts.yesterdayModality) return swapped;
  const alt = otherFamilyThisWeek(plan, opts.todaySession, opts.yesterdayModality);
  if (!alt) return swapped;
  const moved = {
    ...alt,
    id: opts.todaySession.id,
    week: opts.todaySession.week,
    day: opts.todaySession.day,
  };
  return {
    plan: replaceSession(clonePlan(plan), opts.todaySession.id, moved),
    changed: true,
    summaryNb: `bytter i dag til ${alt.title.toLowerCase()}`,
    swappedToday: moved,
  };
}

/** When they question today's session (e.g. ran yesterday, fartlek today). */
export function adaptForConsecutive(
  plan: Plan,
  opts: {
    startedOn: string;
    yesterdayYmd: string;
    yesterdayPlanned: PlanSession | null;
    yesterdayModality: Modality | null;
    yesterdayNote?: string;
    todaySession: PlanSession | null;
  },
): AdaptResult {
  if (!opts.todaySession || !opts.yesterdayModality) {
    return { plan, changed: false, summaryNb: "" };
  }
  if (!stacksHard(opts.yesterdayModality, modalityOfSession(opts.todaySession))) {
    return { plan, changed: false, summaryNb: "" };
  }
  return adaptAfterLog(plan, {
    startedOn: opts.startedOn,
    loggedOnYmd: opts.yesterdayYmd,
    planned: opts.yesterdayPlanned,
    actualText: opts.yesterdayNote || opts.yesterdayModality,
    actualModality: opts.yesterdayModality,
  });
}
