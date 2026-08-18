import { env } from "./env.ts";

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

export async function completePlain(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  if (env.openrouterKey) {
    const res = await fetch(OPENROUTER, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/ekstromjonathan/navyrace",
        "X-Title": `${env.coachName} PT`,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 700,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`openrouter ${res.status}: ${text.slice(0, 240)}`);
    const json = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    return String(json.choices?.[0]?.message?.content ?? "").trim();
  }
  if (env.anthropicKey) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: env.anthropicKey });
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 700,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    return res.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
  }
  throw new Error("no llm");
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
