process.env.PT_JOURNAL_BACKEND = "sqlite";
process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-test-${process.hrtime.bigint()}.sqlite`;
process.env.LINQ_API_TOKEN = "test-token";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as journal from "../src/journal.ts";

describe("journal", () => {
  it("creates habit tracks and logs entries", async () => {
    const user = await journal.upsertUser("chat-1", "+4740343295");
    const track = await journal.ensureTrack({
      userId: user.id,
      kind: "habit",
      slug: "vann",
      name: "Vann",
      tags: ["vann"],
    });
    await journal.logEntry({
      trackId: track.id,
      userId: user.id,
      quantity: { value: 1, unit: "glass" },
      source: "heuristic",
      linqMessageId: "m1",
    });
    const again = await journal.logEntry({
      trackId: track.id,
      userId: user.id,
      quantity: { value: 1, unit: "glass" },
      source: "heuristic",
      linqMessageId: "m1",
    });
    assert.equal(again.duplicate, true);
    assert.equal(await journal.entryCount(track.id), 1);
  });

  it("keeps training as draft until activate, and archives instead of deleting", async () => {
    const user = await journal.upsertUser("chat-1", "+4740343295");
    const draft = await journal.createTrack({
      userId: user.id,
      kind: "training",
      slug: "program",
      name: "OCR",
      status: "draft",
      plan: {
        sessions: [
          { id: "w1d1", title: "Styrke A", loadKey: "strA", load: 4, unit: "runder" },
          { id: "w1d2", title: "Løp", loadKey: "easyrun", load: 5, unit: "km" },
        ],
      },
    });
    assert.equal(draft.status, "draft");
    const active = await journal.activateTrack(draft.id);
    assert.equal(active.status, "active");
    const next = await journal.nextSession(user.id, active);
    assert.equal(next?.session.id, "w1d1");
    await journal.logEntry({
      trackId: active.id,
      userId: user.id,
      quality: "brutalt",
      sessionRef: "w1d1",
      source: "heuristic",
    });
    const next2 = await journal.nextSession(user.id, (await journal.getTrack(active.id))!);
    assert.equal(next2?.session.id, "w1d2");
    await journal.archiveTrack(active.id, "user_requested_new");
    assert.equal((await journal.getTrack(active.id))?.status, "archived");
    assert.equal(await journal.activeTraining(user.id), undefined);
    assert.equal(await journal.entryCount(active.id), 1);
  });

  it("dedups webhook events", async () => {
    assert.equal(await journal.claimEvent("e1"), true);
    assert.equal(await journal.claimEvent("e1"), false);
    await journal.releaseEvent("e1");
    assert.equal(await journal.claimEvent("e1"), true);
  });

  it("keeps a rolling chat log and prunes old turns", async () => {
    const chatUser = await journal.upsertUser("chat-log", "+4740343295");
    await journal.logMessage(chatUser.id, "user", "hvilken økt?", "m-q");
    await journal.logMessage(chatUser.id, "pt", "Styrke A i dag.");
    await journal.logMessage(chatUser.id, "user", "ja den", "m-ja");
    const recent = await journal.recentChat(chatUser.id, 8);
    assert.equal(recent.length, 3);
    assert.equal(recent[0]?.role, "user");
    assert.equal(recent[2]?.body, "ja den");
    const withoutCurrent = await journal.recentChat(chatUser.id, 8, "m-ja");
    assert.equal(withoutCurrent.at(-1)?.body, "Styrke A i dag.");
    assert.equal((await journal.snapshot(chatUser)).recentChat.length, 3);
    assert.equal((await journal.snapshot(chatUser)).readyForPlan, false);
    assert.ok((await journal.snapshot(chatUser)).missingForPlan.includes("goal"));

    for (let i = 0; i < 60; i++) await journal.logMessage(chatUser.id, "user", `n${i}`, `m-${i}`);
    const kept = await journal.recentChat(chatUser.id, 100);
    assert.equal(kept.length, 63);
    assert.equal(kept[0]?.body, "hvilken økt?");
    assert.equal(kept.at(-1)?.body, "n59");

    const recalled = await journal.recallChat(chatUser.id, { contains: "n5", limit: 5 });
    assert.ok(recalled.some((m) => m.body.includes("n5")));
    // Keyword hits stay, and recent context is kept alongside them.
    assert.ok(recalled.length >= 1);
    assert.ok(recalled.at(-1)?.body === "n59" || recalled.some((m) => /^n5/.test(m.body)));
  });

  it("recall_chat keeps nearby user answers when searching a PT keyword", async () => {
    const u = await journal.upsertUser("chat-recall-ctx", "+4740343299");
    await journal.logMessage(u.id, "pt", "Hvor mange dager i uka kan du trene?");
    await journal.logMessage(u.id, "user", "Tenker 3-4 ganger kanskje?", "m-days");
    await journal.logMessage(u.id, "pt", "Har du noe utstyr?");
    await journal.logMessage(u.id, "user", "Ja, har kettlebell og ringer", "m-gear");
    const hit = await journal.recallChat(u.id, { contains: "dager", limit: 10 });
    assert.ok(hit.some((m) => /dager/i.test(m.body)));
    assert.ok(hit.some((m) => /3-4 ganger/i.test(m.body)), "user answer must stay visible next to dager");
  });

  it("stores a daily train reminder and can disable it", async () => {
    const user = await journal.upsertUser("chat-1", "+4740343295");
    const rec = await journal.upsertReminder(user.id, "train", 8, 0);
    assert.equal(rec.hour, 8);
    assert.equal(rec.enabled, 1);
    assert.equal(rec.once_on, null);
    const again = await journal.upsertReminder(user.id, "train", 7, 30);
    assert.equal(again.id, rec.id);
    assert.equal(again.hour, 7);
    assert.equal(again.minute, 30);
    assert.equal((await journal.snapshot(user)).reminders.length, 1);
    await journal.disableReminder(user.id, "train");
    assert.equal((await journal.listReminders(user.id))[0]?.enabled, 0);
    assert.equal((await journal.snapshot(user)).reminders.length, 0);
  });

  it("stores a one-shot reminder and disables after fire", async () => {
    const user = await journal.upsertUser("chat-once-journal", "+4740343299");
    const rec = await journal.upsertReminder(user.id, "train", 19, 0, { onceOn: "2026-08-16" });
    assert.equal(rec.once_on, "2026-08-16");
    assert.equal(rec.enabled, 1);
    await journal.markReminderFired(rec.id, "2026-08-16");
    const after = await journal.getReminder(rec.id);
    assert.equal(after?.last_fired_on, "2026-08-16");
    assert.equal(after?.enabled, 0);
  });

  it("treats a new user with no entries as a fresh start", async () => {
    const user = await journal.upsertUser("chat-1", "+4740343295");
    const fresh = await journal.upsertUser("chat-fresh", "+4740343297");
    assert.equal(await journal.isFreshStart(fresh.id), true);
    await journal.setLocale(fresh.id, "en");
    await journal.setFacts(fresh.id, { uiLang: "en" });
    assert.equal((await journal.getUser(fresh.id))?.locale, "en");
    assert.equal(await journal.isFreshStart(fresh.id), true);
    assert.equal(await journal.isFreshStart(user.id), false);
  });

  it("archives individual logs instead of deleting them", async () => {
    const u = await journal.upsertUser("chat-archive-entry", "+4740343298");
    const water = await journal.ensureTrack({
      userId: u.id,
      kind: "habit",
      slug: "vann",
      name: "Vann",
      tags: ["vann"],
    });
    await journal.logEntry({
      trackId: water.id,
      userId: u.id,
      quantity: { value: 1, unit: "glass" },
      source: "heuristic",
      linqMessageId: "ae-1",
    });
    await journal.logEntry({
      trackId: water.id,
      userId: u.id,
      quantity: { value: 2, unit: "glass" },
      source: "heuristic",
      linqMessageId: "ae-2",
    });
    assert.equal(await journal.entryCount(water.id), 2);
    const archived = await journal.archiveEntry({ userId: u.id, slug: "vann", reason: "user_requested" });
    assert.ok(archived);
    assert.equal(archived?.slug, "vann");
    assert.equal(archived?.alreadyArchived, undefined);
    assert.equal(await journal.entryCount(water.id), 1);
    assert.equal((await journal.recentEntries(u.id, 8)).length, 1);
    assert.equal(await journal.isFreshStart(u.id), false);

    const again = await journal.logEntry({
      trackId: water.id,
      userId: u.id,
      quantity: { value: 1, unit: "glass" },
      source: "heuristic",
      linqMessageId: "ae-2",
    });
    assert.equal(again.duplicate, true);

    const training = await journal.createTrack({
      userId: u.id,
      kind: "training",
      slug: "program",
      name: "OCR",
      status: "draft",
      plan: {
        sessions: [
          { id: "w1d1", title: "Styrke A", loadKey: "strA", load: 4, unit: "runder" },
          { id: "w1d2", title: "Løp", loadKey: "easyrun", load: 5, unit: "km" },
        ],
      },
    });
    await journal.activateTrack(training.id);
    await journal.logEntry({
      trackId: training.id,
      userId: u.id,
      quality: "passe",
      sessionRef: "w1d1",
      source: "heuristic",
    });
    assert.equal((await journal.nextSession(u.id, (await journal.getTrack(training.id))!))?.session.id, "w1d2");

    const extra = await journal.logEntry({
      trackId: training.id,
      userId: u.id,
      note: "20 min kettlebell + stretch",
      sessionRef: "extra:2026-08-16",
      source: "heuristic",
      occurredAt: "2026-08-16T18:00:00.000Z",
    });
    assert.equal(extra.duplicate, false);
    assert.equal((await journal.nextSession(u.id, (await journal.getTrack(training.id))!))?.session.id, "w1d2");
    assert.equal(await journal.trainedOnDay(u.id, "2026-08-16", "Europe/Oslo"), true);
    assert.equal(await journal.patchEntry(extra.id, { quality: "lett" }), true);
    const patched = (await journal.recentEntries(u.id, 4)).find((e) => e.id === extra.id);
    assert.equal(patched?.quality, "lett");

    const sessionLog = await journal.archiveEntry({ userId: u.id, entryId: extra.id, reason: "user_requested" });
    assert.equal(sessionLog?.session_ref, "extra:2026-08-16");
    assert.equal((await journal.nextSession(u.id, (await journal.getTrack(training.id))!))?.session.id, "w1d2");
    const plannedBack = await journal.archiveEntry({ userId: u.id, trackKind: "training" });
    assert.equal(plannedBack?.session_ref, "w1d1");
    assert.equal((await journal.nextSession(u.id, (await journal.getTrack(training.id))!))?.session.id, "w1d1");
    assert.equal(await journal.archiveEntry({ userId: u.id, entryId: "missing" }), null);
  });

  it("stores waitlist invites until approved", async () => {
    const invite = await journal.upsertPendingInvite({
      phone: "+4711223344",
      chatId: "chat-inger",
      name: "Inger",
      firstBody: "Hei, jeg heter Inger",
    });
    assert.equal(invite.status, "pending");
    assert.equal((await journal.listPendingInvites()).some((i) => i.id === invite.id), true);
    const approved = await journal.decideInvite(invite.id, "approved");
    assert.equal(approved?.status, "approved");
    assert.equal(await journal.isApprovedPhone("+4711223344"), true);
    assert.equal((await journal.listPendingInvites()).some((i) => i.id === invite.id), false);

    const user = await journal.upsertUser("chat-named", "+4799988877");
    await journal.setDisplayName(user.id, "Ola");
    assert.equal((await journal.getUserByPhone("+4799988877"))?.display_name, "Ola");
  });
});
