import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMessage } from "../src/parser.ts";
import { isOptOut, isLinqKeywordOptOut } from "../src/optout.ts";
import { isActivatePhrase, isActivateCancel, isArchivePhrase } from "../src/gates.ts";
import { normalizeEvent } from "../src/webhook.ts";
import { detectLang } from "../src/locale.ts";

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
    assert.equal(parseMessage("run the program").kind, "activate");
    assert.equal(parseMessage("kjør").kind, "activate");
    assert.equal(parseMessage("sett i gang").kind, "activate");
    assert.equal(parseMessage("ok kjør").kind, "activate");
    assert.equal(parseMessage("ja").kind, "unknown");
    assert.equal(parseMessage("arkiver og lag nytt").kind, "archive");
    assert.equal(parseMessage("archive and start new").kind, "archive");
    assert.equal(parseMessage("what am i training today").kind, "today");
    assert.equal(parseMessage("easy").kind, "rpe");
  });

  it("archives a single log instead of treating delete as a hard remove", () => {
    const last = parseMessage("slett siste");
    assert.equal(last.kind, "archive_entry");
    if (last.kind === "archive_entry") {
      assert.equal(last.slug, undefined);
      assert.equal(last.trackKind, undefined);
    }
    const water = parseMessage("fjern siste vann");
    assert.equal(water.kind, "archive_entry");
    if (water.kind === "archive_entry") assert.equal(water.slug, "vann");
    const en = parseMessage("delete the last log");
    assert.equal(en.kind, "archive_entry");
    const session = parseMessage("fjern siste økt");
    assert.equal(session.kind, "archive_entry");
    if (session.kind === "archive_entry") assert.equal(session.trackKind, "training");
    assert.equal(parseMessage("arkiver og lag nytt").kind, "archive");
    assert.equal(parseMessage("slett alt").kind, "unknown");
    assert.equal(parseMessage("fjern loggen").kind, "archive_entry");
  });

  it("does not treat a full sentence as rpe", () => {
    assert.equal(parseMessage("det var brutalt i går og kneet hovnet").kind, "unknown");
  });

  it("parses daily training reminders", () => {
    const set = parseMessage("Kan du minne meg på å trene hver dag kl 8");
    assert.equal(set.kind, "reminder_set");
    if (set.kind === "reminder_set") {
      assert.equal(set.hour, 8);
      assert.equal(set.minute, 0);
    }
    const half = parseMessage("minn meg kl 7.30");
    assert.equal(half.kind, "reminder_set");
    if (half.kind === "reminder_set") {
      assert.equal(half.hour, 7);
      assert.equal(half.minute, 30);
    }
    const def = parseMessage("minn meg på å trene");
    assert.equal(def.kind, "reminder_set");
    if (def.kind === "reminder_set") {
      assert.equal(def.hour, 8);
      assert.equal(def.minute, 0);
    }
    assert.equal(parseMessage("remind me to train at 8").kind, "reminder_set");
    assert.equal(parseMessage("stop reminding me").kind, "reminder_cancel");
    assert.equal(parseMessage("Hva har du logget til nå?").kind, "unknown");
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
  it("accepts soft assent to lock a draft, keeps archive exact", () => {
    assert.equal(isActivatePhrase("kjør programmet"), true);
    assert.equal(isActivatePhrase("run the program"), true);
    assert.equal(isActivatePhrase("kjør"), true);
    assert.equal(isActivatePhrase("ja"), true);
    assert.equal(isActivatePhrase("ok"), true);
    assert.equal(isActivatePhrase("Vi kan begynne"), true);
    assert.equal(isActivatePhrase("Vi kan begynne med første pass og heller tilpasse senere?"), true);
    assert.equal(isActivatePhrase("ok kjør"), true);
    assert.equal(isActivatePhrase("Får jeg mer detaljer for de ulike øktene?"), false);
    assert.equal(isActivateCancel("avbryt"), true);
    assert.equal(isActivateCancel("nei"), true);
    assert.equal(isActivateCancel("Får jeg mer detaljer?"), false);
    assert.equal(isArchivePhrase("arkiver og lag nytt"), true);
    assert.equal(isArchivePhrase("archive and start new"), true);
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

describe("locale", () => {
  it("detects the language the user starts with", () => {
    assert.equal(detectLang("Er vi på?"), "nb");
    assert.equal(detectLang("Hei, kan du minne meg på å trene"), "nb");
    assert.equal(detectLang("Are we on?"), "en");
    assert.equal(detectLang("Hi, remind me to train at 8"), "en");
  });
});
