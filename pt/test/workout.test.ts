process.env.PT_JOURNAL_BACKEND = "sqlite";
process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-workout-${process.hrtime.bigint()}.sqlite`;
process.env.PT_TODAY = "2026-08-18";
process.env.LINQ_API_TOKEN = "test-token";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";
import * as journal from "../src/journal.ts";
import { buildWorkoutSnapshot } from "../src/workout-snapshot.ts";
import { generateWorkoutToken, hashWorkoutToken, isValidWorkoutTokenFormat } from "../src/workout-token.ts";
import { completeWorkout, issueTodayWorkout, resolveWorkoutToken } from "../src/workouts.ts";
import { mountWorkoutApi } from "../src/workout-routes.ts";
import { buildTimerPhases, timerMoment } from "../../src/workout/timer.js";
import type { UserRow } from "../src/types.ts";

async function seededUser(chatId: string): Promise<UserRow> {
  const user = await journal.upsertUser(chatId, "+4740000000");
  await journal.setFacts(user.id, { uiLang: "nb", goal: "bli sterk og utholdende" });
  const track = await journal.createTrack({
    userId: user.id,
    kind: "training",
    slug: `program-${chatId}`,
    name: "Testuke",
    status: "draft",
    plan: {
      weeks: 1,
      daysPerWeek: 2,
      startedOn: "2026-08-17",
      sessions: [
        {
          id: "w1d1",
          week: 1,
          day: 1,
          title: "Styrke + Tabata",
          est: "30 min",
          loadKey: "strength",
          load: 3,
          unit: "runder",
          items: [
            { name: "Knebøy", detail: "3 × 8", cue: "Rolig ned." },
            { name: "Push-ups", detail: "3 × 10", cue: "Hold kroppen strak." },
          ],
          timer: {
            mode: "tabata",
            workSeconds: 20,
            restSeconds: 10,
            rounds: 8,
            prepareSeconds: 5,
          },
        },
      ],
    },
  });
  await journal.activateTrack(track.id);
  return (await journal.getUser(user.id)) ?? user;
}

describe("workout capability tokens", () => {
  it("creates opaque 256-bit tokens and stable hashes", () => {
    const first = generateWorkoutToken();
    const second = generateWorkoutToken();
    assert.equal(isValidWorkoutTokenFormat(first.token), true);
    assert.equal(first.token.length, 43);
    assert.equal(hashWorkoutToken(first.token), first.tokenHash);
    assert.notEqual(first.token, second.token);
    assert.equal(isValidWorkoutTokenFormat("not-a-token"), false);
  });
});

describe("workout snapshot and timer", () => {
  it("materializes a bounded Tabata block", () => {
    const snapshot = buildWorkoutSnapshot({
      session: {
        id: "w1d1",
        title: "Tabata",
        timer: { mode: "tabata", workSeconds: 20, restSeconds: 10, rounds: 8 },
      },
      load: null,
      adapt: null,
      localDate: "2026-08-18",
      goal: "bedre kapasitet",
    });
    const timer = snapshot.blocks.find((block) => block.kind === "tabata")?.timer;
    assert.equal(timer?.rounds, 8);
    assert.equal(timer?.workSeconds, 20);
    const phases = buildTimerPhases(timer);
    assert.equal(phases.filter((phase) => phase.kind === "work").length, 8);
    assert.equal(phases.filter((phase) => phase.kind === "rest").length, 8);
    assert.equal(timerMoment(timer, 5_000).phase?.kind, "work");
    assert.equal(timerMoment(timer, 245_000).done, true);
  });
});

describe("workout issue and completion", { concurrency: 1 }, () => {
  it("keeps issued links valid and completes exactly once", async () => {
    const user = await seededUser("chat-workout-main");
    const first = await issueTodayWorkout(user);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.match(first.url, /^https:\/\/lodd\.ai\/w\/[A-Za-z0-9_-]{43}$/);
    assert.equal(first.url.includes(user.id), false);
    const token1 = first.url.split("/").at(-1) ?? "";
    const opened = await resolveWorkoutToken(token1, { markOpened: true });
    assert.equal(opened.snapshot.sessionRef, "w1d1");
    assert.equal(opened.instance.token_hash, hashWorkoutToken(token1));
    assert.equal(opened.instance.opened_at != null, true);

    const second = await issueTodayWorkout(user);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.rotated, false);
    const token2 = second.url.split("/").at(-1) ?? "";
    assert.notEqual(token2, token1);
    assert.equal((await resolveWorkoutToken(token1)).snapshot.sessionRef, "w1d1");

    const feedback = {
      quality: "passe",
      body: "good",
      note: "Fin økt",
      clientCompletionId: "550e8400-e29b-41d4-a716-446655440000",
    };
    const completed = await completeWorkout(token2, feedback);
    assert.equal(completed.duplicate, false);
    const duplicate = await completeWorkout(token2, feedback);
    assert.equal(duplicate.duplicate, true);
    const entries = await journal.recentEntries(user.id, 10);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.session_ref, "w1d1");
    assert.equal(entries[0]?.quality, "passe");
    const events = await journal.listCoachEvents(user.id);
    assert.equal(events.filter((event) => event.kind === "workout_opened").length, 1);
    assert.equal(events.filter((event) => event.kind === "workout_completed").length, 1);
  });

  it("serializes concurrent issue/completion races across valid links", async () => {
    const user = await seededUser("chat-workout-race");
    const [first, second] = await Promise.all([issueTodayWorkout(user), issueTodayWorkout(user)]);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    const token1 = first.url.split("/").at(-1) ?? "";
    const token2 = second.url.split("/").at(-1) ?? "";
    const [a, b] = await Promise.all([
      completeWorkout(token1, {
        quality: "passe",
        body: "good",
        clientCompletionId: "650e8400-e29b-41d4-a716-446655440001",
      }),
      completeWorkout(token2, {
        quality: "brutalt",
        body: "tight",
        clientCompletionId: "650e8400-e29b-41d4-a716-446655440002",
      }),
    ]);
    assert.equal([a, b].filter((result) => result.newlyCompleted).length, 1);
    assert.equal((await journal.recentEntries(user.id, 10)).length, 1);
    assert.equal(
      (await journal.listCoachEvents(user.id)).filter((event) => event.kind === "workout_completed").length,
      1,
    );
  });

  it("does not issue on rest days or without a plan", async () => {
    const noPlan = await journal.upsertUser("chat-workout-no-plan", "+4740000001");
    assert.deepEqual(await issueTodayWorkout(noPlan), { ok: false, reason: "no_plan" });
    const restUser = await journal.upsertUser("chat-workout-rest", "+4740000002");
    const track = await journal.createTrack({
      userId: restUser.id,
      kind: "training",
      slug: "rest-plan",
      name: "Rest",
      status: "draft",
      plan: {
        weeks: 1,
        startedOn: "2026-08-17",
        sessions: [{ id: "w1d0", week: 1, day: 0, title: "Mandagsøkt" }],
      },
    });
    await journal.activateTrack(track.id);
    assert.deepEqual(await issueTodayWorkout(restUser), { ok: false, reason: "rest" });
  });

  it("serves a no-store API without PII", async () => {
    const user = await seededUser("chat-workout-api");
    const issued = await issueTodayWorkout(user);
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const token = issued.url.split("/").at(-1) ?? "";
    const app = new Hono();
    mountWorkoutApi(app);

    const get = await app.request(`/api/workouts/${token}`);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("cache-control"), "no-store");
    const payload = await get.json();
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(user.id), false);
    assert.equal(/phone|chat_id|token_hash/i.test(serialized), false);

    const bad = await app.request("/api/workouts/bad");
    assert.equal(bad.status, 404);
    const invalid = await app.request(`/api/workouts/${token}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality: "perfekt" }),
    });
    assert.equal(invalid.status, 400);
  });
});
