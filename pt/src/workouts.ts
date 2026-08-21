import { env } from "./env.ts";
import { dayAnchorIso, parseJson, todayInTz } from "./db.ts";
import * as journal from "./journal.ts";
import { buildWorkoutSnapshot } from "./workout-snapshot.ts";
import {
  generateWorkoutToken,
  hashWorkoutToken,
  isValidWorkoutTokenFormat,
} from "./workout-token.ts";
import type {
  UserRow,
  WorkoutFeedback,
  WorkoutInstanceRow,
  WorkoutSnapshot,
} from "./types.ts";

const LINK_TTL_MS = 36 * 60 * 60 * 1000;
const COMPLETION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkoutIssueResult =
  | { ok: true; url: string; title: string; instanceId: string; rotated: boolean }
  | { ok: false; reason: "no_plan" | "rest" | "logged" | "complete" };

export class WorkoutError extends Error {
  constructor(
    public readonly code: "not_found" | "expired" | "revoked" | "invalid_feedback" | "completion_conflict",
    public readonly status: number,
  ) {
    super(code);
  }
}

function isExpired(instance: WorkoutInstanceRow): boolean {
  return Date.parse(instance.expires_at) <= Date.now();
}

function snapshotOf(instance: WorkoutInstanceRow): WorkoutSnapshot {
  const snapshot = parseJson<WorkoutSnapshot | null>(instance.snapshot, null);
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.blocks)) {
    throw new WorkoutError("not_found", 404);
  }
  return snapshot;
}

function feedbackNote(feedback: WorkoutFeedback, title: string): string {
  const body =
    feedback.body === "pain"
      ? "vondt etter økta"
      : feedback.body === "tight"
        ? "stram/støl etter økta"
        : "kroppen kjentes bra";
  const own = feedback.note?.trim().slice(0, 280);
  return [`Fullført i nettleseren: ${title}`, body, own].filter(Boolean).join(" · ").slice(0, 500);
}

export function validateWorkoutFeedback(input: unknown): WorkoutFeedback {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WorkoutError("invalid_feedback", 400);
  }
  const raw = input as Record<string, unknown>;
  const quality = String(raw.quality ?? "");
  const body = String(raw.body ?? "");
  const clientCompletionId = String(raw.clientCompletionId ?? "");
  if (!["lett", "passe", "brutalt"].includes(quality)) {
    throw new WorkoutError("invalid_feedback", 400);
  }
  if (!["good", "tight", "pain"].includes(body) || !COMPLETION_ID.test(clientCompletionId)) {
    throw new WorkoutError("invalid_feedback", 400);
  }
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 280) : "";
  return {
    quality: quality as WorkoutFeedback["quality"],
    body: body as WorkoutFeedback["body"],
    clientCompletionId,
    ...(note ? { note } : {}),
  };
}

export async function issueTodayWorkout(user: UserRow): Promise<WorkoutIssueResult> {
  const track = await journal.activeTraining(user.id);
  if (!track) return { ok: false, reason: "no_plan" };
  const view = await journal.todayView(user);
  if (view.kind === "rest" || view.kind === "none") return { ok: false, reason: view.kind === "rest" ? "rest" : "no_plan" };
  if (view.kind === "logged") return { ok: false, reason: "logged" };
  if (view.kind === "complete") return { ok: false, reason: "complete" };

  const localDate = todayInTz(user.tz);
  const facts = journal.factsOf(user);
  const snapshot = buildWorkoutSnapshot({
    session: view.session,
    load: view.load,
    adapt: view.adapt,
    localDate,
    goal: facts.goal ? String(facts.goal) : null,
  });
  const { token, tokenHash } = generateWorkoutToken();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
  const identity = {
    userId: user.id,
    trackId: track.id,
    sessionRef: view.session.id,
    localDate,
    planVersion: track.version,
  };
  const existing = await journal.findLiveWorkoutInstance(identity);
  if (existing?.completed_at) return { ok: false, reason: "logged" };
  let instance: WorkoutInstanceRow;
  let rotated = false;
  if (existing) {
    instance =
      (await journal.rotateWorkoutInstance(existing.id, tokenHash, snapshot, expiresAt)) ??
      existing;
    rotated = true;
  } else {
    instance = await journal.createWorkoutInstance({
      ...identity,
      snapshot,
      tokenHash,
      expiresAt,
    });
  }
  return {
    ok: true,
    url: `${env.publicOrigin}/w/${token}`,
    title: snapshot.title,
    instanceId: instance.id,
    rotated,
  };
}

export async function resolveWorkoutToken(
  token: string,
  opts: { markOpened?: boolean } = {},
): Promise<{
  instance: WorkoutInstanceRow;
  snapshot: WorkoutSnapshot;
  status: "ready" | "opened" | "completed";
}> {
  if (!isValidWorkoutTokenFormat(token)) throw new WorkoutError("not_found", 404);
  let instance = await journal.findWorkoutInstanceByTokenHash(hashWorkoutToken(token));
  if (!instance) throw new WorkoutError("not_found", 404);
  if (instance.revoked_at) throw new WorkoutError("revoked", 404);
  if (isExpired(instance)) throw new WorkoutError("expired", 404);
  const wasOpened = Boolean(instance.opened_at);
  if (opts.markOpened && !instance.opened_at) {
    instance = (await journal.markWorkoutOpened(instance.id)) ?? instance;
    await journal
      .recordCoachEvent({
        userId: instance.user_id,
        kind: "workout_opened",
        source: "integration",
        refId: instance.id,
        dedupeKey: `workout:${instance.id}:open`,
        metadata: { sessionRef: instance.session_ref, localDate: instance.local_date },
      })
      .catch((err) => console.error("workout open event failed", instance?.id, err));
  }
  return {
    instance,
    snapshot: snapshotOf(instance),
    status: instance.completed_at ? "completed" : wasOpened || instance.opened_at ? "opened" : "ready",
  };
}

export async function completeWorkout(
  token: string,
  input: unknown,
): Promise<{
  instance: WorkoutInstanceRow;
  snapshot: WorkoutSnapshot;
  feedback: WorkoutFeedback;
  user: UserRow;
  duplicate: boolean;
}> {
  const feedback = validateWorkoutFeedback(input);
  const resolved = await resolveWorkoutToken(token);
  const { instance, snapshot } = resolved;
  const user = await journal.getUser(instance.user_id);
  if (!user) throw new WorkoutError("not_found", 404);

  const completion = await journal.findWorkoutInstanceByClientCompletionId(feedback.clientCompletionId);
  if (completion && completion.id !== instance.id) {
    throw new WorkoutError("completion_conflict", 409);
  }
  if (instance.completed_at && instance.completion_entry_id) {
    return { instance, snapshot, feedback, user, duplicate: true };
  }

  const entryKey = `web-workout:${instance.user_id}:${instance.track_id}:${instance.session_ref}:${instance.local_date}`;
  const logged = await journal.logEntry({
    trackId: instance.track_id,
    userId: instance.user_id,
    quality: feedback.quality,
    note: feedbackNote(feedback, snapshot.title),
    sessionRef: instance.session_ref,
    source: "user",
    linqMessageId: entryKey,
    occurredAt: dayAnchorIso(instance.local_date),
  });
  const entryId = logged.duplicate
    ? await journal.entryIdByMessageId(entryKey)
    : logged.id;
  if (!entryId) throw new Error("workout completion entry was not recoverable");

  const completed =
    (await journal.markWorkoutCompleted(instance.id, entryId, feedback)) ??
    instance;
  await journal
    .recordCoachEvent({
      userId: instance.user_id,
      kind: "workout_completed",
      source: "integration",
      refId: instance.id,
      dedupeKey: `workout:${instance.id}:complete`,
      metadata: {
        sessionRef: instance.session_ref,
        localDate: instance.local_date,
        quality: feedback.quality,
        bodyState: feedback.body,
      },
    })
    .catch((err) => console.error("workout completion event failed", instance.id, err));
  return { instance: completed, snapshot, feedback, user, duplicate: logged.duplicate };
}
