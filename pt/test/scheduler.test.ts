process.env.PT_JOURNAL_BACKEND = "sqlite";
process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-sched-${process.hrtime.bigint()}.sqlite`;
process.env.LINQ_API_TOKEN = "test-token";

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import * as journal from "../src/journal.ts";
import { fireDueReminders, isReminderDue, reminderBody } from "../src/scheduler.ts";
import type { ReminderRow, UserRow } from "../src/types.ts";

describe("scheduler", () => {
  let user: UserRow;
  let reminder: ReminderRow;
  const at805 = new Date("2026-08-15T06:05:00.000Z"); // 08:05 Europe/Oslo (UTC+2)
  const at750 = new Date("2026-08-15T05:50:00.000Z"); // 07:50
  const at1400 = new Date("2026-08-15T12:00:00.000Z"); // 14:00

  before(async () => {
    user = await journal.upsertUser("chat-sched", "+4740343295");
    reminder = await journal.upsertReminder(user.id, "train", 8, 0);
  });

  it("is due shortly after the scheduled time", async () => {
    assert.equal(await isReminderDue(reminder, user, at805), true);
    assert.equal(await isReminderDue(reminder, user, at750), false);
    assert.equal(await isReminderDue(reminder, user, at1400), false);
  });

  it("sends once then skips the rest of the day", async () => {
    const sent: string[] = [];
    const n = await fireDueReminders(at805, async (_chat, body) => {
      sent.push(body);
    });
    assert.equal(n, 1);
    assert.match(sent[0] ?? "", /Trening/);
    const again = await fireDueReminders(at805, async () => {
      sent.push("nope");
    });
    assert.equal(again, 0);
  });

  it("skips when opted out", async () => {
    const other = await journal.upsertUser("chat-optout", "+4740343296");
    await journal.upsertReminder(other.id, "train", 8, 0);
    await journal.setHealth(other.id, "OPTED_OUT");
    const n = await fireDueReminders(at805, async () => {
      throw new Error("should not send");
    });
    assert.equal(n, 0);
  });

  it("fires a one-shot reminder only on once_on day then disables", async () => {
    const onceUser = await journal.upsertUser("chat-once-sched", "+4740343298");
    const once = await journal.upsertReminder(onceUser.id, "train", 8, 0, { onceOn: "2026-08-15" });
    assert.equal(await isReminderDue(once, onceUser, at805), true);
    const wrongDay = await journal.upsertReminder(onceUser.id, "train", 8, 0, { onceOn: "2026-08-16" });
    assert.equal(await isReminderDue(wrongDay, onceUser, at805), false);

    const onDay = await journal.upsertReminder(onceUser.id, "train", 8, 0, { onceOn: "2026-08-15" });
    const n = await fireDueReminders(at805, async () => {});
    assert.ok(n >= 1);
    const after = await journal.getReminder(onDay.id);
    assert.equal(after?.enabled, 0);
    assert.equal(after?.last_fired_on, "2026-08-15");
  });

  it("sends a video reminder with the stored URL and ignores trained-today skip", async () => {
    const videoUser = await journal.upsertUser("chat-video-sched", "+4740343299");
    const training = await journal.createTrack({
      userId: videoUser.id,
      kind: "training",
      slug: "program",
      name: "Test",
      status: "active",
      plan: { sessions: [{ id: "w1d1", title: "Styrke", loadKey: "str", load: 3, unit: "runder" }] },
    });
    await journal.logEntry({
      trackId: training.id,
      userId: videoUser.id,
      sessionRef: "w1d1",
      source: "heuristic",
      occurredAt: "2026-08-15T06:00:00.000Z",
    });
    assert.equal(await journal.trainedOnDay(videoUser.id, "2026-08-15", "Europe/Oslo"), true);

    const yt = "https://youtu.be/XTbJZXXccpE";
    await journal.upsertReminder(videoUser.id, "train", 8, 0, { url: yt });

    const sent: string[] = [];
    const n = await fireDueReminders(at805, async (_chat, body) => {
      sent.push(body);
    });
    assert.ok(n >= 1);
    const mine = sent.find((s) => s.includes(yt));
    assert.ok(mine);
    assert.match(mine ?? "", /Påminnelse|Reminder/);
  });

  it("fires a habit reminder even if they already trained", async () => {
    const habitUser = await journal.upsertUser("chat-habit-sched", "+4740343301");
    const training = await journal.createTrack({
      userId: habitUser.id,
      kind: "training",
      slug: "program-habit",
      name: "Test",
      status: "active",
      plan: { sessions: [{ id: "w1d1", title: "Styrke", loadKey: "str", load: 3, unit: "runder" }] },
    });
    await journal.logEntry({
      trackId: training.id,
      userId: habitUser.id,
      sessionRef: "w1d1",
      source: "heuristic",
      occurredAt: "2026-08-15T06:00:00.000Z",
    });
    await journal.upsertReminder(habitUser.id, "meditasjon", 8, 0, { title: "meditasjon" });
    const sent: string[] = [];
    const n = await fireDueReminders(at805, async (_chat, body) => {
      sent.push(body);
    });
    assert.ok(n >= 1);
    const mine = sent.find((s) => /meditasjon/i.test(s));
    assert.ok(mine);
  });

  it("redacts sensitive titles through the real scheduler path", async () => {
    const privateUser = await journal.upsertUser("chat-private-reminder", "+4740343302");
    const privateReminder = await journal.upsertReminder(privateUser.id, "rehab-kne", 8, 0, {
      title: "kneskade rehab",
    });
    const body = await reminderBody(privateUser, privateReminder);
    assert.equal(body, "Påminnelse: rutinen din.");
    assert.equal(/kne|skade|rehab/i.test(body), false);
  });
});
