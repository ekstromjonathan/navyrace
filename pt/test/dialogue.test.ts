process.env.PT_JOURNAL_BACKEND = "sqlite";
process.env.PT_DB_PATH = `${process.env.TMPDIR || "/tmp"}/mai-pt-dialogue-${process.hrtime.bigint()}.sqlite`;
process.env.PT_TODAY = "2026-08-18";
process.env.LINQ_API_TOKEN = "test-token";
process.env.LINQ_ALLOWLIST = "+4740343295";
delete process.env.OPENROUTER_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

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
});
