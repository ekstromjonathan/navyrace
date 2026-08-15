process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-sched-${process.hrtime.bigint()}.sqlite`;
process.env.LINQ_API_TOKEN = "test-token";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as journal from "../src/journal.ts";
import { fireDueReminders, isReminderDue } from "../src/scheduler.ts";

describe("scheduler", () => {
  const user = journal.upsertUser("chat-sched", "+4740343295");
  const reminder = journal.upsertReminder(user.id, "train", 8, 0);
  const at805 = new Date("2026-08-15T06:05:00.000Z"); // 08:05 Europe/Oslo (UTC+2)
  const at750 = new Date("2026-08-15T05:50:00.000Z"); // 07:50
  const at1400 = new Date("2026-08-15T12:00:00.000Z"); // 14:00

  it("is due shortly after the scheduled time", () => {
    assert.equal(isReminderDue(reminder, user, at805), true);
    assert.equal(isReminderDue(reminder, user, at750), false);
    assert.equal(isReminderDue(reminder, user, at1400), false);
  });

  it("sends once then skips the rest of the day", async () => {
    const sent: string[] = [];
    const n = await fireDueReminders(at805, async (_chat, body) => {
      sent.push(body);
    });
    assert.equal(n, 1);
    assert.match(sent[0] ?? "", /Påminnelse/);
    const again = await fireDueReminders(at805, async () => {
      sent.push("nope");
    });
    assert.equal(again, 0);
  });

  it("skips when opted out", async () => {
    const other = journal.upsertUser("chat-optout", "+4740343296");
    journal.upsertReminder(other.id, "train", 8, 0);
    journal.setHealth(other.id, "OPTED_OUT");
    const n = await fireDueReminders(at805, async () => {
      throw new Error("should not send");
    });
    assert.equal(n, 0);
  });
});
