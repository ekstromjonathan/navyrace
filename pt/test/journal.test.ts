process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-test-${process.hrtime.bigint()}.sqlite`;
process.env.LINQ_API_TOKEN = "test-token";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as journal from "../src/journal.ts";

describe("journal", () => {
  const user = journal.upsertUser("chat-1", "+4740343295");

  it("creates habit tracks and logs entries", () => {
    const track = journal.ensureTrack({
      userId: user.id,
      kind: "habit",
      slug: "vann",
      name: "Vann",
      tags: ["vann"],
    });
    journal.logEntry({
      trackId: track.id,
      userId: user.id,
      quantity: { value: 1, unit: "glass" },
      source: "heuristic",
      linqMessageId: "m1",
    });
    const again = journal.logEntry({
      trackId: track.id,
      userId: user.id,
      quantity: { value: 1, unit: "glass" },
      source: "heuristic",
      linqMessageId: "m1",
    });
    assert.equal(again.duplicate, true);
    assert.equal(journal.entryCount(track.id), 1);
  });

  it("keeps training as draft until activate, and archives instead of deleting", () => {
    const draft = journal.createTrack({
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
    const active = journal.activateTrack(draft.id);
    assert.equal(active.status, "active");
    const next = journal.nextSession(user.id, active);
    assert.equal(next?.session.id, "w1d1");
    journal.logEntry({
      trackId: active.id,
      userId: user.id,
      quality: "brutalt",
      sessionRef: "w1d1",
      source: "heuristic",
    });
    const next2 = journal.nextSession(user.id, journal.getTrack(active.id)!);
    assert.equal(next2?.session.id, "w1d2");
    journal.archiveTrack(active.id, "user_requested_new");
    assert.equal(journal.getTrack(active.id)?.status, "archived");
    assert.equal(journal.activeTraining(user.id), undefined);
    assert.equal(journal.entryCount(active.id), 1);
  });

  it("dedups webhook events", () => {
    assert.equal(journal.claimEvent("e1"), true);
    assert.equal(journal.claimEvent("e1"), false);
    journal.releaseEvent("e1");
    assert.equal(journal.claimEvent("e1"), true);
  });

  it("keeps a rolling chat log and prunes old turns", () => {
    const chatUser = journal.upsertUser("chat-log", "+4740343295");
    journal.logMessage(chatUser.id, "user", "hvilken økt?", "m-q");
    journal.logMessage(chatUser.id, "pt", "Styrke A i dag.");
    journal.logMessage(chatUser.id, "user", "ja den", "m-ja");
    const recent = journal.recentChat(chatUser.id, 8);
    assert.equal(recent.length, 3);
    assert.equal(recent[0]?.role, "user");
    assert.equal(recent[2]?.body, "ja den");
    const withoutCurrent = journal.recentChat(chatUser.id, 8, "m-ja");
    assert.equal(withoutCurrent.at(-1)?.body, "Styrke A i dag.");
    assert.equal(journal.snapshot(chatUser).recentChat.length, 3);

    for (let i = 0; i < 60; i++) journal.logMessage(chatUser.id, "user", `n${i}`, `m-${i}`);
    const kept = journal.recentChat(chatUser.id, 100);
    assert.equal(kept.length, 50);
    assert.equal(kept[0]?.body, "n10");
    assert.equal(kept.at(-1)?.body, "n59");
  });
});
