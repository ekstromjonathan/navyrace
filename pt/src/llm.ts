import { env } from "./env.ts";

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

export type LlmToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmTurn = {
  content: string;
  toolCalls: LlmToolCall[];
};

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export function hasLlm(): boolean {
  return Boolean(env.openrouterKey || env.anthropicKey);
}

export function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* empty */
    }
  }
  return {};
}

function uniqueModels(preferred: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const m of preferred) {
    const v = (m ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Conversation first (smart model when set), then the floor model. */
export function chatModels(): string[] {
  return uniqueModels([env.chatModel, env.model]);
}

export async function completePlain(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const turn = await completeChat({
    model: opts.model,
    maxTokens: opts.maxTokens,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  return turn.content.trim();
}

export async function completeChat(opts: {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  maxTokens?: number;
}): Promise<LlmTurn> {
  if (env.openrouterKey) return completeOpenRouter(opts);
  if (env.anthropicKey) return completeAnthropic(opts);
  throw new Error("no llm");
}

async function completeOpenRouter(opts: {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  maxTokens?: number;
}): Promise<LlmTurn> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1100,
    messages: opts.messages.map(toOpenAiMessage),
  };
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters?.type ? t.parameters : { type: "object", ...t.parameters },
      },
    }));
    body.tool_choice = "auto";
  }
  const res = await fetch(OPENROUTER, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/ekstromjonathan/navyrace",
      "X-Title": `${env.coachName} PT`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${text.slice(0, 240)}`);
  const json = JSON.parse(text) as {
    choices?: {
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
        tool_calls?: {
          id?: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
    error?: { message?: string };
  };
  if (json.error?.message) throw new Error(`openrouter: ${json.error.message}`);
  const msg = json.choices?.[0]?.message;
  const content = flattenContent(msg?.content);
  const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id || `call_${i}`,
    name: String(tc.function?.name || ""),
    arguments: parseToolArgs(tc.function?.arguments),
  })).filter((tc) => tc.name);
  return { content, toolCalls };
}

function toOpenAiMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function flattenContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n").trim();
  }
  return "";
}

async function completeAnthropic(opts: {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  maxTokens?: number;
}): Promise<LlmTurn> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: env.anthropicKey });
  const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const mapped = toAnthropicMessages(opts.messages);
  const res = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1100,
    system: system || undefined,
    tools: opts.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: (t.parameters?.type ? t.parameters : { type: "object", ...t.parameters }) as {
        type: "object";
        properties?: Record<string, unknown>;
      },
    })),
    messages: mapped as Parameters<typeof client.messages.create>[0] extends { messages: infer M } ? M : never,
  });
  const content = res.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  const toolCalls: LlmToolCall[] = res.content
    .filter((c): c is Extract<(typeof res.content)[number], { type: "tool_use" }> => c.type === "tool_use")
    .map((c) => ({
      id: c.id,
      name: c.name,
      arguments: parseToolArgs(c.input),
    }));
  return { content, toolCalls };
}

function toAnthropicMessages(messages: LlmMessage[]): { role: "user" | "assistant"; content: string | Record<string, unknown>[] }[] {
  const out: { role: "user" | "assistant"; content: string | Record<string, unknown>[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: Record<string, unknown>[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : m.content });
      continue;
    }
    const last = out[out.length - 1];
    const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
    if (last?.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

export async function fetchUrlText(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error("only http(s)");
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "lodd.ai-pt/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  const raw = await res.text();
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, 4000);
}
