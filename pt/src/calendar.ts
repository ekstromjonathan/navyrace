import { addLocalDays, todayInTz } from "./db.ts";
import type { Plan, PlanSession, TrackRow } from "./types.ts";

/** Monday = 0 … Sunday = 6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DayView =
  | { kind: "none" }
  | { kind: "rest"; weekday: Weekday; week: number }
  | { kind: "complete"; weekday: Weekday; week: number }
  | {
      kind: "logged";
      weekday: Weekday;
      week: number;
      session: PlanSession;
    }
  | {
      kind: "session";
      weekday: Weekday;
      week: number;
      session: PlanSession;
      load: number | null;
      adapt: "lett" | "brutalt" | null;
    };

const RPE_MULT: Record<string, number> = { lett: 1.08, passe: 1, brutalt: 0.9 };

/** Spread N training days across Mon–Sun. Rest days are the gaps. */
export function trainDaysFor(daysPerWeek: number): Weekday[] {
  const n = Math.max(1, Math.min(7, Math.round(Number(daysPerWeek) || 3)));
  const map: Record<number, Weekday[]> = {
    1: [2],
    2: [1, 4],
    3: [0, 2, 4],
    4: [0, 1, 3, 5],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return map[n];
}

export function weekdayMon0(ymd: string): Weekday {
  const [y, m, d] = ymd.split("-").map(Number);
  const sun0 = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return ((sun0 + 6) % 7) as Weekday;
}

export function mondayOf(ymd: string): string {
  return addLocalDays(ymd, -weekdayMon0(ymd));
}

/** 1-based week index from the Monday of the start week. */
export function weekNumber(startedOn: string, today: string): number {
  const start = Date.parse(`${mondayOf(startedOn)}T12:00:00.000Z`);
  const now = Date.parse(`${mondayOf(today)}T12:00:00.000Z`);
  const days = Math.round((now - start) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

export function startedOnOf(track: TrackRow, plan: Plan | null, tz: string): string {
  if (plan?.startedOn) return plan.startedOn;
  return todayInTz(tz, track.created_at);
}

function inferWeek(session: PlanSession, index: number, daysPerWeek: number): number {
  if (session.week != null && Number.isFinite(session.week)) return Number(session.week);
  const m = /^w(\d+)/i.exec(session.id);
  if (m) return Number(m[1]);
  return Math.floor(index / Math.max(1, daysPerWeek)) + 1;
}

function isWeekday(n: unknown): n is Weekday {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6;
}

/** Fill missing `day` / `week` so each session belongs to a weekday. */
export function assignSessionDays(plan: Plan): Plan {
  const sessions = plan.sessions ?? [];
  if (!sessions.length) return plan;
  const weeksPresent = sessions.map((s, i) => inferWeek(s, i, plan.daysPerWeek ?? 3));
  const perWeek = new Map<number, number>();
  for (const w of weeksPresent) perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  const daysPerWeek = Math.max(
    1,
    plan.daysPerWeek ?? Math.max(...perWeek.values(), 1),
  );
  const slots = trainDaysFor(daysPerWeek);
  const used = new Map<number, number>();
  const next = sessions.map((s, i) => {
    const week = inferWeek(s, i, daysPerWeek);
    if (isWeekday(s.day)) return { ...s, week, day: s.day };
    const idx = used.get(week) ?? 0;
    used.set(week, idx + 1);
    return { ...s, week, day: slots[idx] ?? slots[slots.length - 1] };
  });
  return { ...plan, daysPerWeek, sessions: next };
}

export function stampPlanOnActivate(plan: Plan | null, todayYmd: string): Plan | null {
  if (!plan) return null;
  const withDays = assignSessionDays(plan);
  return { ...withDays, startedOn: plan.startedOn ?? todayYmd };
}

export function applyLoadAdapt(
  session: PlanSession,
  prevRpe: string | null,
): { load: number | null; adapt: "lett" | "brutalt" | null } {
  let load = session.load ?? null;
  let adapt: "lett" | "brutalt" | null = null;
  if (load != null && session.loadKey) {
    const m = prevRpe ? RPE_MULT[prevRpe] : null;
    if (m && m !== 1) {
      const unit = session.unit === "km" ? Math.round(load * m * 2) / 2 : Math.round(load * m);
      if (unit !== load) {
        load = unit;
        adapt = prevRpe === "lett" ? "lett" : "brutalt";
      }
    }
  }
  return { load, adapt };
}

export function buildDayView(
  plan: Plan | null,
  doneIds: Iterable<string>,
  todayYmd: string,
  startedOn: string,
  prevRpeFor?: (loadKey: string) => string | null,
): DayView {
  if (!plan?.sessions?.length) return { kind: "none" };
  const assigned = assignSessionDays(plan);
  const weekday = weekdayMon0(todayYmd);
  const week = weekNumber(startedOn, todayYmd);
  const maxWeek = Math.max(assigned.weeks ?? 1, ...assigned.sessions.map((s) => s.week ?? 1));
  if (week > maxWeek) return { kind: "complete", weekday, week };

  const session = assigned.sessions.find((s) => (s.week ?? 1) === week && s.day === weekday) ?? null;
  if (!session) return { kind: "rest", weekday, week };

  const done = doneIds instanceof Set ? doneIds : new Set(doneIds);
  if (done.has(session.id)) return { kind: "logged", weekday, week, session };

  const prev = session.loadKey && prevRpeFor ? prevRpeFor(session.loadKey) : null;
  const adapted = applyLoadAdapt(session, prev);
  return { kind: "session", weekday, week, session, load: adapted.load, adapt: adapted.adapt };
}

/** Sessions in `week` ordered by weekday. */
export function sessionsInWeek(plan: Plan | null, week: number): PlanSession[] {
  if (!plan?.sessions?.length) return [];
  return assignSessionDays(plan)
    .sessions.filter((s) => (s.week ?? 1) === week)
    .slice()
    .sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
}

/** Upcoming planned sessions after `fromYmd` (exclusive), same or later weeks. */
export function upcomingSessions(
  plan: Plan | null,
  startedOn: string,
  fromYmd: string,
  limit = 6,
): { ymd: string; session: PlanSession }[] {
  if (!plan?.sessions?.length) return [];
  const assigned = assignSessionDays(plan);
  const out: { ymd: string; session: PlanSession }[] = [];
  for (let i = 1; i <= 21 && out.length < limit; i++) {
    const ymd = addLocalDays(fromYmd, i);
    const view = buildDayView(assigned, [], ymd, startedOn);
    if (view.kind === "session") out.push({ ymd, session: view.session });
  }
  return out;
}

export function snapshotToday(view: DayView): Record<string, unknown> | null {
  if (view.kind === "none") return null;
  const base = {
    weekday: view.weekday,
    week: view.week,
    rest: view.kind === "rest",
    logged: view.kind === "logged",
    complete: view.kind === "complete",
    hint:
      view.kind === "rest"
        ? "Rest day. Recovery tips only — do not pitch the next training session."
        : view.kind === "logged"
          ? "Today's session is already logged. Celebrate, don't pitch tomorrow."
          : view.kind === "complete"
            ? "Program block is logged out."
            : "Training day. On a greeting, name the session in one line; details only if they ask.",
  };
  if (view.kind === "session") {
    return {
      ...base,
      id: view.session.id,
      title: view.session.title,
      load: view.load,
      unit: view.session.unit ?? null,
      items: (view.session.items ?? []).slice(0, 6),
      est: view.session.est ?? null,
      adapt: view.adapt,
    };
  }
  if (view.kind === "logged") {
    return {
      ...base,
      id: view.session.id,
      title: view.session.title,
    };
  }
  return base;
}
