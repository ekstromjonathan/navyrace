/* App state shape (mai:v1). Clean break — no navyrace:v1 migration. */

export const KEY = "mai:v1";
export const BUILTIN_PROGRAM_ID = "builtin";

export function defaultBrand() {
  return { appName: "MAI TRAINER", coachName: "MAI" };
}

export function emptyProgress() {
  return {
    index: 0,
    logsByProgram: { [BUILTIN_PROGRAM_ID]: {} },
    archive: {},
    updatedAt: 0,
  };
}

/** Active session logs for the current program. */
export function activeLogs(progress, programId = BUILTIN_PROGRAM_ID) {
  return progress?.logsByProgram?.[programId] ?? {};
}

export function withActiveLogs(progress, logs, programId = BUILTIN_PROGRAM_ID) {
  return {
    ...progress,
    logsByProgram: { ...(progress.logsByProgram || {}), [programId]: logs },
  };
}

/** Pace vs timeline: expected sessions by now vs completed index. */
export function paceInfo(profile, index) {
  if (!profile?.startedAt || !profile?.schedule?.daysPerWeek) return null;
  const days = Math.max(0, (Date.now() - profile.startedAt) / 86400000);
  const weeksElapsed = days / 7;
  const expected = Math.floor(weeksElapsed * profile.schedule.daysPerWeek);
  const delta = index - expected;
  if (Math.abs(delta) < 1) return { kind: "on", label: "I rute", delta: 0 };
  if (delta > 0) return { kind: "ahead", label: `${delta} økt${delta === 1 ? "" : "er"} foran`, delta };
  return { kind: "behind", label: `${-delta} økt${delta === -1 ? "" : "er"} bak`, delta };
}

/** Calendar mode: JS getDay() Sun=0 → our DAYS Mon=0. */
export function todaySlot() {
  const js = new Date().getDay(); // 0 Sun … 6 Sat
  return js === 0 ? 6 : js - 1;
}

export function serializeApp(profile, program, progress) {
  return JSON.stringify({
    v: 1,
    profile,
    program,
    activeProgramId: program?.id ?? BUILTIN_PROGRAM_ID,
    progress,
  });
}

export function parseApp(raw) {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || s.v !== 1) return null;
    return s;
  } catch {
    return null;
  }
}
