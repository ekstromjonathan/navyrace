process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.PT_MODEL = "x-ai/grok-4.3";
process.env.PT_MODEL_SMART = "x-ai/grok-4.6";
process.env.ANTHROPIC_API_KEY = "";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatModels, completeChat, hasLlm, isModelFallbackError, llmHealth, probeOpenRouterKey } from "../src/llm.ts";
import { env } from "../src/env.ts";

describe("openrouter chat completions", { concurrency: 1 }, () => {
  it("uses grok chat completions with OpenAI-style tools, not Anthropic /v1/messages", async () => {
    assert.equal(hasLlm(), true);
    assert.deepEqual(chatModels(), ["x-ai/grok-4.6", "x-ai/grok-4.3"]);
    assert.equal(env.chatModel, "x-ai/grok-4.6");

    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      calls.push({ url, body });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Ja. Jeg er her — tre påminnelser, ingen i kveld.",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const turn = await completeChat({
        model: env.chatModel,
        tools: [
          {
            name: "get_snapshot",
            description: "les journalen",
            parameters: { type: "object", properties: {} },
          },
        ],
        messages: [
          { role: "system", content: "Du er coachen." },
          { role: "user", content: "Er du våken?" },
        ],
      });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /openrouter\.ai\/api\/v1\/chat\/completions/);
      assert.equal(/\/v1\/messages/.test(calls[0].url), false);
      assert.equal(calls[0].body.model, "x-ai/grok-4.6");
      assert.equal((calls[0].body.reasoning as { effort?: string; exclude?: boolean }).effort, "low");
      assert.equal((calls[0].body.reasoning as { effort?: string; exclude?: boolean }).exclude, true);
      assert.equal((calls[0].body.max_tokens as number) >= 2000, true);
      const tools = calls[0].body.tools as { type: string; function: { name: string } }[];
      assert.equal(tools[0].type, "function");
      assert.equal(tools[0].function.name, "get_snapshot");
      assert.match(turn.content, /jeg er her/i);
      assert.equal(turn.toolCalls.length, 0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("runs an OpenAI-style tool call then answers", async () => {
    const orig = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      n += 1;
      const body = JSON.parse(String(init?.body || "{}")) as {
        messages?: { role?: string }[];
      };
      if (n === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "get_snapshot", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      assert.equal(body.messages?.some((m) => m.role === "tool"), true);
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Påminnelse kl 22:00 hver dag." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const first = await completeChat({
        model: "x-ai/grok-4.6",
        tools: [{ name: "get_snapshot", description: "x", parameters: { type: "object", properties: {} } }],
        messages: [
          { role: "system", content: "coach" },
          { role: "user", content: "hvilke reminders?" },
        ],
      });
      assert.equal(first.toolCalls[0]?.name, "get_snapshot");
      const second = await completeChat({
        model: "x-ai/grok-4.6",
        tools: [{ name: "get_snapshot", description: "x", parameters: { type: "object", properties: {} } }],
        messages: [
          { role: "system", content: "coach" },
          { role: "user", content: "hvilke reminders?" },
          { role: "assistant", content: "", toolCalls: first.toolCalls },
          { role: "tool", toolCallId: first.toolCalls[0].id, content: JSON.stringify({ reminders: [] }) },
        ],
      });
      assert.match(second.content, /22:00/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("uses reasoning text when content is empty", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "", reasoning: "Ja, jeg er her." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;
    try {
      const turn = await completeChat({
        model: "x-ai/grok-4.6",
        messages: [
          { role: "system", content: "coach" },
          { role: "user", content: "våken?" },
        ],
      });
      assert.match(turn.content, /jeg er her/i);
      assert.equal(llmHealth().ok, true);
      assert.equal(llmHealth().lastError, null);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("records lastError on OpenRouter 401 and does not treat timeout as model fallback", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "User not found." } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await assert.rejects(
        () =>
          completeChat({
            model: "x-ai/grok-4.6",
            messages: [{ role: "user", content: "hei" }],
          }),
        /openrouter 401/,
      );
      const health = llmHealth();
      assert.equal(health.ok, false);
      assert.equal(health.lastError?.status, 401);
      assert.equal(health.lastError?.model, "x-ai/grok-4.6");
      assert.equal(isModelFallbackError(new Error("openrouter 401: User not found.")), true);
      assert.equal(isModelFallbackError(new Error("timeout")), false);
      assert.equal(isModelFallbackError(new Error("This operation was aborted")), false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("probes OpenRouter key expiry without leaking the secret", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      assert.match(url, /openrouter\.ai\/api\/v1\/key/);
      return new Response(
        JSON.stringify({
          data: {
            expires_at: "2026-08-16T00:00:00Z",
            limit_remaining: 12.5,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const key = await probeOpenRouterKey({ force: true });
      assert.equal(key?.status, 200);
      assert.equal(key?.expired, true);
      assert.equal(key?.ok, false);
      assert.equal(key?.expiresAt, "2026-08-16T00:00:00Z");
      assert.equal(key?.limitRemaining, 12.5);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("treats a live OpenRouter key as ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            expires_at: "2027-12-31T23:59:59Z",
            limit_remaining: 40,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;
    try {
      const key = await probeOpenRouterKey({ force: true });
      assert.equal(key?.ok, true);
      assert.equal(key?.expired, false);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
