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
    assert.equal(parseMessage("Hvilket program går vi for?").kind, "today");
    assert.equal(parseMessage("hva er programmet").kind, "today");
    assert.equal(parseMessage("what's my program").kind, "today");
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
    assert.equal(parseMessage("Hva har du?").kind, "unknown");
  });

  it("detects LLM failure fallback copy", async () => {
    const { isAgentFailureReply, agentError } = await import("../src/copy.ts");
    assert.equal(isAgentFailureReply(agentError("nb", new Error("429 rate limit"))), true);
    assert.equal(isAgentFailureReply(agentError("nb", new Error("401 unauthorized"))), true);
    assert.equal(isAgentFailureReply("I dag: Styrke for hele kroppen"), false);
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

  it("parses free-form session logs even when they diverge from the plan", () => {
    const custom = parseMessage(
      "Gjorde dagens økt nå. Logger nå 20 min kettlebell, og stretching. 3x 10 øvelser.",
    );
    assert.equal(custom.kind, "session_log");
    if (custom.kind === "session_log") {
      assert.equal(custom.day, "today");
      assert.equal(custom.claimsPlanned, true);
      assert.match(custom.note, /kettlebell/i);
    }
    const extra = parseMessage("Trente 20 min yoga i går");
    assert.equal(extra.kind, "session_log");
    if (extra.kind === "session_log") {
      assert.equal(extra.day, "yesterday");
      assert.equal(extra.claimsPlanned, false);
    }
    const unclear = parseMessage("Trente kettlebell og stretching");
    assert.equal(unclear.kind, "session_log");
    if (unclear.kind === "session_log") {
      assert.equal(unclear.day, null);
    }
    assert.equal(parseMessage("Hva logget du?").kind, "unknown");
  });

  it("parses daily training reminders", () => {
    const set = parseMessage("Kan du minne meg på å trene hver dag kl 8");
    assert.equal(set.kind, "reminder_set");
    if (set.kind === "reminder_set") {
      assert.equal(set.hour, 8);
      assert.equal(set.minute, 0);
      assert.equal(set.scope, "daily");
    }
    const half = parseMessage("minn meg kl 7.30");
    assert.equal(half.kind, "reminder_set");
    if (half.kind === "reminder_set") {
      assert.equal(half.hour, 7);
      assert.equal(half.minute, 30);
      assert.equal(half.scope, "daily");
    }
    const tonight = parseMessage("Kan du minne meg på å trene kl 19 i kveld");
    assert.equal(tonight.kind, "reminder_set");
    if (tonight.kind === "reminder_set") {
      assert.equal(tonight.hour, 19);
      assert.equal(tonight.scope, "once");
    }
    const once = parseMessage("Minn meg bare i dag kl 19");
    assert.equal(once.kind, "reminder_set");
    if (once.kind === "reminder_set") {
      assert.equal(once.hour, 19);
      assert.equal(once.scope, "once");
    }
    const def = parseMessage("minn meg på å trene");
    assert.equal(def.kind, "reminder_set");
    if (def.kind === "reminder_set") {
      assert.equal(def.hour, 8);
      assert.equal(def.minute, 0);
      assert.equal(def.scope, "daily");
    }
    assert.equal(parseMessage("remind me to train at 8").kind, "reminder_set");
    assert.equal(parseMessage("stop reminding me").kind, "reminder_cancel");
    assert.equal(parseMessage("Hva har du logget til nå?").kind, "unknown");
  });

  it("extracts waitlist names and owner yes/no", async () => {
    const { extractApplicantName, isInviteYes, isInviteNo } = await import("../src/invite.ts");
    assert.equal(extractApplicantName("Hei, jeg heter Inger"), "Inger");
    assert.equal(extractApplicantName("Hei, jeg heter Inger Ekstrøm. Jeg vil være med."), "Inger Ekstrøm");
    assert.equal(extractApplicantName("Hej, jag heter Inger. Jag vill vara med."), "Inger");
    assert.equal(extractApplicantName("lodd.ai signup\nNavn: Inger\nTelefon: +4711111111"), "Inger");
    assert.equal(extractApplicantName("Hei, kan jeg være med?"), null);
    assert.equal(isInviteYes("Ja"), true);
    assert.equal(isInviteYes("slipp inn"), true);
    assert.equal(isInviteYes("ok kjør"), false);
    assert.equal(isInviteNo("nei"), true);
    assert.equal(isInviteNo("gjorde økt"), false);
  });

  it("parses video reminders with URLs", () => {
    const yt = "https://youtu.be/XTbJZXXccpE";
    const withTime = parseMessage(`${yt} minn meg kl 19 om å se videoen`);
    assert.equal(withTime.kind, "reminder_set");
    if (withTime.kind === "reminder_set") {
      assert.equal(withTime.hour, 19);
      assert.equal(withTime.url, yt);
    }
    const linkOnly = parseMessage(yt);
    assert.equal(linkOnly.kind, "video_link");
    if (linkOnly.kind === "video_link") {
      assert.equal(linkOnly.url, yt);
    }
  });

  it("extracts URLs from text", async () => {
    const { extractUrl, isVideoUrl } = await import("../src/urls.ts");
    const url = extractUrl("Se denne https://youtu.be/abc123?is=foo i kveld");
    assert.equal(url, "https://youtu.be/abc123?is=foo");
    assert.equal(isVideoUrl("https://youtu.be/abc"), true);
    assert.equal(isVideoUrl("https://example.com"), false);
  });

  it("parses reminder scope replies", async () => {
    const { isReminderDailyReply, isReminderOnceReply } = await import("../src/gates.ts");
    assert.equal(isReminderDailyReply("hver dag"), true);
    assert.equal(isReminderDailyReply("gjentagende"), true);
    assert.equal(isReminderOnceReply("bare i dag"), true);
    assert.equal(isReminderOnceReply("i kveld"), true);
    assert.equal(isReminderOnceReply("engang"), true);
    assert.equal(isReminderDailyReply("bare i dag"), false);
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
    assert.equal(isActivatePhrase("kör"), true);
    assert.equal(isArchivePhrase("arkivera och gör nytt"), true);
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
    assert.equal(detectLang("Hej, jag heter Inger. Jag vill vara med."), "sv");
    assert.equal(detectLang("Are we on?"), "en");
    assert.equal(detectLang("Hi, remind me to train at 8"), "en");
  });
});
