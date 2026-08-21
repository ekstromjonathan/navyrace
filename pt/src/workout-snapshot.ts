import type {
  PlanSession,
  WorkoutBlock,
  WorkoutSnapshot,
  WorkoutTimerSpec,
} from "./types.ts";

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function normalizeWorkoutTimer(input: WorkoutTimerSpec | null | undefined): WorkoutTimerSpec | null {
  if (!input || !["countdown", "intervals", "tabata"].includes(input.mode)) return null;
  const mode = input.mode;
  return {
    mode,
    workSeconds: clampInt(input.workSeconds, 5, 3600, mode === "tabata" ? 20 : 60),
    restSeconds: clampInt(input.restSeconds, 0, 1800, mode === "tabata" ? 10 : 0),
    rounds: clampInt(input.rounds, 1, 99, mode === "tabata" ? 8 : 1),
    prepareSeconds: clampInt(input.prepareSeconds ?? 5, 0, 60, 5),
  };
}

function seconds(value: number, unit: string): number {
  return /min/i.test(unit) ? value * 60 : value;
}

function parseTimerText(text: string): WorkoutTimerSpec | null {
  if (/\btabata\b/i.test(text)) {
    return normalizeWorkoutTimer({
      mode: "tabata",
      workSeconds: 20,
      restSeconds: 10,
      rounds: 8,
      prepareSeconds: 5,
    });
  }
  const match = text.match(
    /(\d{1,2})\s*[×x]\s*(\d{1,3})\s*(s|sek(?:und(?:er)?)?|min(?:utt(?:er)?)?)\b[^/]*(?:\/\s*(\d{1,3})\s*(s|sek(?:und(?:er)?)?|min(?:utt(?:er)?)?))?/i,
  );
  if (!match) return null;
  const rounds = Number(match[1]);
  const workSeconds = seconds(Number(match[2]), match[3]);
  const restSeconds = match[4] ? seconds(Number(match[4]), match[5]) : 0;
  return normalizeWorkoutTimer({
    mode: "intervals",
    workSeconds,
    restSeconds,
    rounds,
    prepareSeconds: 5,
  });
}

export function timerForSession(session: PlanSession): WorkoutTimerSpec | null {
  const explicit =
    normalizeWorkoutTimer(session.timer) ??
    (session.items ?? []).map((item) => normalizeWorkoutTimer(item.timer)).find(Boolean) ??
    null;
  if (explicit) return explicit;
  return parseTimerText(
    [session.title, session.est, ...(session.items ?? []).flatMap((item) => [item.name, item.detail])]
      .filter(Boolean)
      .join(" "),
  );
}

function adaptedDetail(
  detail: string | undefined,
  originalLoad: number | undefined,
  adaptedLoad: number | null,
): string | null {
  if (!detail) return null;
  if (originalLoad == null || adaptedLoad == null || originalLoad === adaptedLoad) return detail;
  return detail.replace(new RegExp(`\\b${originalLoad}\\b`), String(adaptedLoad));
}

export function buildWorkoutSnapshot(input: {
  session: PlanSession;
  load: number | null;
  adapt: "lett" | "brutalt" | null;
  localDate: string;
  goal?: string | null;
}): WorkoutSnapshot {
  const { session } = input;
  const blocks: WorkoutBlock[] = [];
  const timer = timerForSession(session);
  const items = session.items ?? [];

  blocks.push({
    id: "start",
    kind: "instruction",
    title: "Før du starter",
    detail: "Begynn kontrollert. Det skal være lett å justere underveis.",
    exercises: [],
    timer: null,
  });

  if (items.length) {
    blocks.push({
      id: "main",
      kind: "sets",
      title: "Øvelser",
      detail:
        input.load != null && session.unit
          ? `Dagens dose: ${input.load} ${session.unit}`
          : null,
      exercises: items.map((item, index) => ({
        id: `exercise-${index + 1}`,
        name: item.name,
        detail: adaptedDetail(item.detail, session.load, input.load),
        cue: item.cue?.trim() || null,
      })),
      timer: null,
    });
  } else {
    blocks.push({
      id: "main",
      kind: "instruction",
      title: session.title,
      detail:
        input.load != null && session.unit
          ? `${input.load} ${session.unit}`
          : "Følg økta i et kontrollert tempo.",
      exercises: [],
      timer: null,
    });
  }

  if (timer) {
    blocks.push({
      id: "timer",
      kind: timer.mode === "tabata" ? "tabata" : "intervals",
      title: timer.mode === "tabata" ? "Tabata" : "Intervallklokke",
      detail: `${timer.rounds} runder · ${timer.workSeconds} s arbeid · ${timer.restSeconds} s pause`,
      exercises: [],
      timer,
    });
  }

  blocks.push({
    id: "finish",
    kind: "cooldown",
    title: "Avslutt rolig",
    detail: "Ta ned tempoet og kjenn etter hvordan kroppen svarer.",
    exercises: [],
    timer: null,
  });

  const reason =
    input.adapt === "lett"
      ? "Forrige lignende økt kjentes lett, så dosen er justert litt opp."
      : input.adapt === "brutalt"
        ? "Forrige lignende økt var tung, så dosen er justert litt ned."
        : input.goal
          ? `Bygger mot ${input.goal.trim().slice(0, 120)}.`
          : "Dagens planlagte økt.";

  return {
    version: 1,
    sessionRef: session.id,
    localDate: input.localDate,
    title: session.title,
    estimate: session.est ?? null,
    reason,
    blocks,
  };
}
