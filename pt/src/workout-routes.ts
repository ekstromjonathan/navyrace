import type { Hono } from "hono";
import { completeWorkout, resolveWorkoutToken, WorkoutError } from "./workouts.ts";

type CompleteResult = Awaited<ReturnType<typeof completeWorkout>>;

function noStore(c: { header: (name: string, value: string) => void }): void {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
}

function errorBody(err: unknown): { status: number; code: string } {
  if (err instanceof WorkoutError) {
    if (err.status === 404) return { status: 404, code: "not_found" };
    return { status: err.status, code: err.code };
  }
  console.error("workout route failed", err);
  return { status: 500, code: "server_error" };
}

export function mountWorkoutApi(
  app: Hono,
  opts: { onCompleted?: (result: CompleteResult) => Promise<void> } = {},
): void {
  app.get("/api/workouts/:token", async (c) => {
    noStore(c);
    try {
      const result = await resolveWorkoutToken(c.req.param("token"), { markOpened: true });
      return c.json({
        status: result.status,
        completed: Boolean(result.instance.completed_at),
        expiresAt: result.instance.expires_at,
        workout: result.snapshot,
      });
    } catch (err) {
      const failure = errorBody(err);
      return c.json({ error: failure.code }, failure.status as 400 | 404 | 409 | 500);
    }
  });

  app.post("/api/workouts/:token/complete", async (c) => {
    noStore(c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_feedback" }, 400);
    }
    try {
      const result = await completeWorkout(c.req.param("token"), body);
      if (!result.duplicate && opts.onCompleted) {
        void opts.onCompleted(result).catch((err) =>
          console.error("workout completion callback failed", result.instance.id, err),
        );
      }
      return c.json({
        completed: true,
        duplicate: result.duplicate,
        quality: result.feedback.quality,
      });
    } catch (err) {
      const failure = errorBody(err);
      return c.json({ error: failure.code }, failure.status as 400 | 404 | 409 | 500);
    }
  });
}
