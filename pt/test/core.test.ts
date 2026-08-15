import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMessage } from "../src/parser.ts";
import { isOptOut, isLinqKeywordOptOut } from "../src/optout.ts";
import { isActivatePhrase, isArchivePhrase } from "../src/gates.ts";
import { normalizeEvent } from "../src/webhook.ts";

describe("parser", () => {
  it("logs cold plunge with duration", () => {
    const p = parseMessage("Tok et kaldt bad i 30 sekunder");
    assert.equal(p.kind, "log");
    if (p.kind === "log") {
      assert.equal(p.slug, "kaldt-bad");
      assert.deepEqual(p.quantity, { value: 30, unit: "s" });
    }
  });

  it("logs meditation", () => {
    const p = parseMessage("mediterte i 30 sekunder");
    assert.equal(p.kind, "log");
    if (p.kind === "log") {
      assert.equal(p.slug, "meditasjon");
      assert.deepEqual(p.quantity, { value: 30, unit: "s" });
    }
  });

  it("logs water glasses", () => {
    const p = parseMessage("Drakk et glass vann");
    assert.equal(p.kind, "log");
    if (p.kind === "log") {
      assert.equal(p.slug, "vann");
      assert.deepEqual(p.quantity, { value: 1, unit: "glass" });
    }
  });

  it("parses rpe and today", () => {
    assert.equal(parseMessage("brutalt").kind, "rpe");
    assert.equal(parseMessage("hva trener jeg i dag").kind, "today");
    assert.equal(parseMessage("kjør programmet").kind, "activate");
    assert.equal(parseMessage("arkiver og lag nytt").kind, "archive");
  });

  it("does not treat a full sentence as rpe", () => {
    assert.equal(parseMessage("det var brutalt i går og kneet hovnet").kind, "unknown");
  });
});

describe("opt-out", () => {
  it("matches Linq keywords exactly", () => {
    assert.equal(isLinqKeywordOptOut("STOP"), true);
    assert.equal(isLinqKeywordOptOut("please STOP"), false);
    assert.equal(isLinqKeywordOptOut("opt-out"), true);
  });

  it("matches Norwegian intent", () => {
    assert.equal(isOptOut("slutt å skrive"), true);
    assert.equal(isOptOut("ikke kontakt meg"), true);
    assert.equal(isOptOut("stopp"), true);
    assert.equal(isOptOut("jeg stoppet løpinga"), false);
  });
});

describe("gates", () => {
  it("requires exact confirmation phrases", () => {
    assert.equal(isActivatePhrase("kjør programmet"), true);
    assert.equal(isActivatePhrase("ok kjør"), false);
    assert.equal(isArchivePhrase("arkiver og lag nytt"), true);
    assert.equal(isArchivePhrase("slett alt"), false);
  });
});

describe("webhook normalize", () => {
  it("reads message.received envelope", () => {
    const n = normalizeEvent({
      event_type: "message.received",
      event_id: "evt-1",
      data: {
        id: "msg-1",
        body: "Hei",
        direction: "inbound",
        chat: { id: "chat-1", is_group: false, health_status: { status: "HEALTHY" } },
        sender_handle: { handle: "+4740343295" },
      },
    });
    assert.ok(n);
    assert.equal(n?.inbound?.body, "Hei");
    assert.equal(n?.inbound?.chatId, "chat-1");
    assert.equal(n?.inbound?.phone, "+4740343295");
  });
});
