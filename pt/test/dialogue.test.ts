process.env.PT_JOURNAL_BACKEND = "sqlite";
process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-dialogue-${process.hrtime.bigint()}.sqlite`;
process.env.PT_TODAY = "2026-08-18";
process.env.LINQ_API_TOKEN = "test-token";
process.env.LINQ_ALLOWLIST = "+4740343295";
process.env.OPENROUTER_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const outbound: string[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("linqapp.com")) {
    if (url.includes("/messages") && String(init?.method || "GET").toUpperCase() === "POST") {
      try {
        const body = JSON.parse(String(init?.body || "{}")) as {
          message?: { parts?: { value?: string }[] };
        };
        outbound.push(String(body.message?.parts?.[0]?.value ?? ""));
      } catch {
        outbound.push("");
      }
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return origFetch(input, init);
}) as typeof fetch;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleInbound } from "../src/handle.ts";
import * as journal from "../src/journal.ts";
import { dayAnchorIso } from "../src/db.ts";
import type { Inbound } from "../src/types.ts";

function inbound(body: string, n: number): Inbound {
  return {
    eventId: `e-dialogue-${n}`,
    messageId: `m-dialogue-${n}`,
    chatId: "chat-dialogue-jon",
    phone: "+4740343295",
    body,
    direction: "inbound",
    isGroup: false,
    healthStatus: "HEALTHY",
    service: "imessage",
  };
}

function lastOut(): string {
  return outbound.at(-1) ?? "";
}

function isConsecutiveLoop(text: string): boolean {
  return /to av samme type på rad/i.test(text) && /hva føles rett/i.test(text);
}

describe("dialogue replay", () => {
  it("answers Jonathan's Tuesday thread instead of looping", async () => {
    const user = await journal.upsertUser("chat-dialogue-jon", "+4740343295");
    await journal.setFacts(user.id, { uiLang: "nb", daysPerWeek: 4, goal: "kroppen skal ikke være et hinder" });
    await journal.touchContactCard(user.id);
    const draft = await journal.createTrack({
      userId: user.id,
      kind: "training",
      slug: "program",
      name: "Uke",
      status: "draft",
      plan: {
        weeks: 2,
        daysPerWeek: 4,
        startedOn: "2026-08-10",
        sessions: [
          { id: "w1d1", week: 1, title: "Styrke", loadKey: "styrke" },
          { id: "w1d2", week: 1, title: "Løping med fartslek", loadKey: "loping" },
          { id: "w1d3", week: 1, title: "Klatring", loadKey: "klatring" },
          { id: "w1d4", week: 1, title: "Kajakk", loadKey: "padling" },
          { id: "w2d1", week: 2, title: "Styrke for hele kroppen", loadKey: "styrke" },
          { id: "w2d2", week: 2, title: "Løping med fartslek", loadKey: "loping", load: 9, unit: "kilometer" },
          { id: "w2d3", week: 2, title: "Klatring og grep", loadKey: "klatring" },
          { id: "w2d4", week: 2, title: "Kajakk med tak i rykk", loadKey: "padling", load: 45, unit: "minutter" },
        ],
      },
    });
    const active = await journal.activateTrack(draft.id);
    await journal.logEntry({
      trackId: active.id,
      userId: user.id,
      sessionRef: "w1d2",
      note: "Løp 7k",
      quality: "passe",
      source: "heuristic",
      occurredAt: dayAnchorIso("2026-08-17"),
    });

    await handleInbound(inbound("Hvor er vi nå denne uka?", 1));
    assert.match(lastOut(), /4 økter/);
    assert.match(lastOut(), /ikke hver dag/);
    assert.equal(isConsecutiveLoop(lastOut()), false);
    assert.equal(/Modellen svarte ikke/.test(lastOut()), false);

    await handleInbound(inbound("Tenker vi kan ta en rolig dag og tilpasse programmet der etter", 2));
    assert.match(lastOut(), /letter i dag/i);
    assert.equal(isConsecutiveLoop(lastOut()), false);
    const afterEase = journal.planOf((await journal.getTrack(active.id))!);
    assert.match(afterEase?.sessions.find((s) => s.id === "w2d2")?.title ?? "", /roligere/i);

    await handleInbound(inbound("Svarte nettopp på det?", 3));
    assert.equal(isConsecutiveLoop(lastOut()), false);
    assert.match(lastOut(), /letter|allerede letter/i);

    await handleInbound(inbound("Holde det veldig rolig", 4));
    assert.equal(isConsecutiveLoop(lastOut()), false);
    assert.match(lastOut(), /allerede letter/i);

    await handleInbound(inbound("Hva er status nå?", 5));
    assert.match(lastOut(), /4 økter/);
    assert.equal(isConsecutiveLoop(lastOut()), false);

    await handleInbound(inbound("Er du våken?", 6));
    assert.match(lastOut(), /jeg er her/i);
    assert.equal(isConsecutiveLoop(lastOut()), false);

    await handleInbound(inbound("Kan gjerne ta en rolig dag i dag", 7));
    assert.equal(isConsecutiveLoop(lastOut()), false);
    assert.match(lastOut(), /letter|allerede letter/i);
  });

  it("lists reminders, attaches a late URL, and does not re-ask the clock", async () => {
    const user = await journal.upsertUser("chat-dialogue-jon", "+4740343295");
    await journal.setFacts(user.id, { uiLang: "nb" });
    await journal.touchContactCard(user.id);

    await handleInbound(inbound("Ny kveldsrutine: minn meg på denne hver kveld kl 22", 20));
    assert.match(lastOut(), /22:00/);
    assert.equal(/når skal jeg minne/i.test(lastOut()), false);

    await handleInbound(inbound("https://youtu.be/XTbJZXXccpE", 21));
    assert.match(lastOut(), /22:00/);
    assert.match(lastOut(), /youtu/);
    assert.equal(/når skal jeg minne/i.test(lastOut()), false);

    await handleInbound(inbound("Hvilke reminders ligger inneV", 22));
    assert.match(lastOut(), /22:00/);
    assert.match(lastOut(), /youtu/);
    assert.equal(isConsecutiveLoop(lastOut()), false);
  });

  it("accepts 22 hver dag while waiting for a video time", async () => {
    const user = await journal.upsertUser("chat-dialogue-video", "+4740343295");
    await journal.setFacts(user.id, { uiLang: "nb" });
    await journal.touchContactCard(user.id);

    await handleInbound({
      eventId: "e-dialogue-30",
      messageId: "m-dialogue-30",
      chatId: "chat-dialogue-video",
      phone: "+4740343295",
      body: "https://youtu.be/abc999",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /når skal jeg minne/i);

    await handleInbound({
      eventId: "e-dialogue-31",
      messageId: "m-dialogue-31",
      chatId: "chat-dialogue-video",
      phone: "+4740343295",
      body: "22 hver dag",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /22:00/);
    assert.match(lastOut(), /youtu/);
  });

  it("picks an easy day when they say usikker after a swap offer", async () => {
    const user = await journal.upsertUser("chat-dialogue-jon", "+4740343295");
    await journal.setPending(user.id, { type: "adapt_choice", askedAt: new Date().toISOString() });
    await handleInbound(inbound("Usikker", 40));
    assert.match(lastOut(), /letter|allerede letter|bytter/i);
    assert.equal(isConsecutiveLoop(lastOut()), false);
  });

  it("does not trap later messages on a stale video-time pending", async () => {
    const user = await journal.upsertUser("chat-dialogue-jon", "+4740343295");
    await journal.upsertReminder(user.id, "train", 22, 0, { onceOn: null });
    await journal.setPending(user.id, {
      type: "video_reminder_time",
      url: "https://youtu.be/stuck999",
      askedAt: new Date().toISOString(),
    });
    await handleInbound(inbound("Våken?", 50));
    assert.equal(/når skal jeg minne/i.test(lastOut()), false);
    assert.match(lastOut(), /jeg er her/i);
    assert.equal(await journal.pendingOf(user), null);
    const rem = (await journal.listReminders(user.id)).find((r) => String(r.url ?? "").includes("stuck999"));
    assert.match(String(rem?.url ?? ""), /stuck999/);
  });

  it("gives the week plan, not rest-day copy, for Gi meg ukeplanen min", async () => {
    const user = await journal.upsertUser("chat-dialogue-week", "+4740343295");
    await journal.setFacts(user.id, { uiLang: "nb", daysPerWeek: 4, goal: "kroppen skal ikke være et hinder" });
    await journal.touchContactCard(user.id);
    const draft = await journal.createTrack({
      userId: user.id,
      kind: "training",
      slug: "program-week",
      name: "Uke",
      status: "draft",
      plan: {
        weeks: 1,
        daysPerWeek: 4,
        startedOn: "2026-08-17",
        sessions: [
          { id: "w1d1", week: 1, title: "Styrke", loadKey: "styrke" },
          { id: "w1d2", week: 1, title: "Løping med fartslek", loadKey: "loping" },
          { id: "w1d3", week: 1, title: "Klatring", loadKey: "klatring" },
          { id: "w1d4", week: 1, title: "Kajakk", loadKey: "padling" },
        ],
      },
    });
    await journal.activateTrack(draft.id);

    await handleInbound({
      eventId: "e-dialogue-60",
      messageId: "m-dialogue-60",
      chatId: "chat-dialogue-week",
      phone: "+4740343295",
      body: "Gi meg ukeplanen min",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /4 økter/);
    assert.match(lastOut(), /mandag|tirsdag|onsdag|torsdag|fredag/i);
    assert.equal(/Modellen svarte ikke/.test(lastOut()), false);
    assert.equal(/er hviledag/i.test(lastOut()), false);
  });

  it("answers Skjer'a with a short greeting, not a workout dump", async () => {
    const user = await journal.upsertUser("chat-dialogue-week", "+4740343295");
    await journal.setFacts(user.id, { uiLang: "nb" });
    await journal.touchContactCard(user.id);

    await handleInbound({
      eventId: "e-dialogue-61",
      messageId: "m-dialogue-61",
      chatId: "chat-dialogue-week",
      phone: "+4740343295",
      body: "Skjer’a?",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /^Hei/i);
    assert.equal(/Modellen svarte ikke/.test(lastOut()), false);
    assert.equal(/• /.test(lastOut()), false);
    assert.equal(isConsecutiveLoop(lastOut()), false);
  });

  it("keeps several reminders at once, daily and one-shot", async () => {
    const user = await journal.upsertUser("chat-dialogue-multi-rem", "+4740343295");
    await journal.setFacts(user.id, { uiLang: "nb" });
    await journal.touchContactCard(user.id);

    await handleInbound({
      eventId: "e-dialogue-70",
      messageId: "m-dialogue-70",
      chatId: "chat-dialogue-multi-rem",
      phone: "+4740343295",
      body: "Minn meg på å trene hver dag kl 8",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /08:00/);

    await handleInbound({
      eventId: "e-dialogue-71",
      messageId: "m-dialogue-71",
      chatId: "chat-dialogue-multi-rem",
      phone: "+4740343295",
      body: "Minn meg på meditasjon hver dag kl 7",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /07:00/);
    assert.match(lastOut(), /meditasjon/i);

    await handleInbound({
      eventId: "e-dialogue-72",
      messageId: "m-dialogue-72",
      chatId: "chat-dialogue-multi-rem",
      phone: "+4740343295",
      body: "Kan du minne meg på å trene kl 19 i kveld",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /19:00/);

    await handleInbound({
      eventId: "e-dialogue-73",
      messageId: "m-dialogue-73",
      chatId: "chat-dialogue-multi-rem",
      phone: "+4740343295",
      body: "Hvilke påminnelser",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.match(lastOut(), /08:00/);
    assert.match(lastOut(), /07:00/);
    assert.match(lastOut(), /19:00/);
    assert.match(lastOut(), /meditasjon/i);

    const live = (await journal.listReminders(user.id)).filter((r) => r.enabled === 1);
    assert.equal(live.length, 3);

    await handleInbound({
      eventId: "e-dialogue-74",
      messageId: "m-dialogue-74",
      chatId: "chat-dialogue-multi-rem",
      phone: "+4740343295",
      body: "slutt å minne meg på meditasjon",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    const after = (await journal.listReminders(user.id)).filter((r) => r.enabled === 1);
    assert.equal(after.length, 2);
    assert.equal(after.some((r) => r.slug === "meditasjon"), false);
    assert.equal(after.some((r) => r.slug === "train" && r.hour === 8), true);
  });

  it("routes an exercise red flag before pending or the LLM", async () => {
    const user = await journal.upsertUser("chat-dialogue-safety", "+4740343295");
    await journal.setFacts(user.id, { uiLang: "nb" });
    await journal.touchContactCard(user.id);
    await journal.setPending(user.id, {
      type: "question",
      field: "equipment",
      askedAt: new Date().toISOString(),
    });
    const before = outbound.length;
    await handleInbound({
      eventId: "e-dialogue-safety-1",
      messageId: "m-dialogue-safety-1",
      chatId: "chat-dialogue-safety",
      phone: "+4740343295",
      body: "Jeg fikk trykk i brystet under intervallene",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.equal(outbound.length, before + 1, "one reply per inbound");
    assert.match(lastOut(), /stopp økta/i);
    assert.match(lastOut(), /113/);
    assert.equal(/OPENROUTER|modell/i.test(lastOut()), false);
    assert.equal((await journal.pendingOf(user))?.type, "question", "safety does not erase pending context");
    const events = await journal.listCoachEvents(user.id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, "safety_routed");
    assert.equal(events[0]?.metadata.includes("trykk i brystet"), false, "event metadata has no raw message");

    await handleInbound({
      eventId: "e-dialogue-safety-2",
      messageId: "m-dialogue-safety-2",
      chatId: "chat-dialogue-safety",
      phone: "+4740343295",
      body: "Jeg er på legevakta nå",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.equal((await journal.pendingOf(user))?.type, "question");
    const fresh = await journal.getUser(user.id);
    assert.equal(journal.factsOf(fresh ?? user).equipment, undefined, "safety status is not stored as equipment");
  });

  it("discloses AI on the first deterministic coach reply", async () => {
    const before = outbound.length;
    await handleInbound({
      eventId: "e-dialogue-disclosure-1",
      messageId: "m-dialogue-disclosure-1",
      chatId: "chat-dialogue-disclosure",
      phone: "+4740343295",
      body: "Minn meg på meditasjon hver dag kl 7",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.equal(outbound.length, before + 1);
    assert.match(lastOut(), /^Jeg er .+, AI-coachen din\./i);
    assert.equal((lastOut().match(/AI-coach/gi) ?? []).length, 1);
    assert.match(lastOut(), /07:00/);
  });

  it("registers explicit privacy requests before pending or the LLM", async () => {
    const before = outbound.length;
    await handleInbound({
      eventId: "e-dialogue-privacy-1",
      messageId: "m-dialogue-privacy-1",
      chatId: "chat-dialogue-privacy",
      phone: "+4740343295",
      body: "Eksporter alle dataene mine",
      direction: "inbound",
      isGroup: false,
      healthStatus: "HEALTHY",
      service: "imessage",
    });
    assert.equal(outbound.length, before + 1);
    assert.match(lastOut(), /AI-coach/i);
    assert.match(lastOut(), /registrert|manuell/i);
    const user = await journal.upsertUser("chat-dialogue-privacy", "+4740343295");
    const privacyEvents = (await journal.listCoachEvents(user.id)).filter(
      (event) => event.kind === "privacy_requested",
    );
    assert.ok(privacyEvents.some((event) => event.ref_id === "m-dialogue-privacy-1"));
  });
});
