process.env.PT_JOURNAL_BACKEND = "sqlite";
process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-sched-${process.hrtime.bigint()}.sqlite`;
process.env.LINQ_API_TOKEN = "test-token";

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import * as journal from "../src/journal.ts";
import { fireDueReminders, isReminderDue } from "../src/scheduler.ts";
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
});
