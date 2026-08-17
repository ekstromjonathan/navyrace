import { env } from "./env.ts";

const BASE = "https://api.linqapp.com/api/partner/v3";

async function linq<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.linqToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new Error(`Linq ${res.status} ${path}: ${text.slice(0, 400)}`);
    (err as Error & { status: number; body: unknown }).status = res.status;
    (err as Error & { status: number; body: unknown }).body = body;
    throw err;
  }
  return body as T;
}

export async function startTyping(chatId: string): Promise<void> {
  await linq(`/chats/${chatId}/typing`, { method: "POST", body: JSON.stringify({}) }).catch(() => {});
}

export async function stopTyping(chatId: string): Promise<void> {
  await linq(`/chats/${chatId}/typing?stop=true`, { method: "POST", body: JSON.stringify({}) }).catch(async () => {
    await linq(`/chats/${chatId}/typing`, {
      method: "POST",
      body: JSON.stringify({ stop: true }),
    }).catch(() => {});
  });
}

export async function sendText(
  chatId: string,
  text: string,
  opts: { replyTo?: string; effect?: string; overrideOptout?: boolean } = {},
): Promise<void> {
  const effect = opts.effect
    ? { type: "screen" as const, name: opts.effect }
    : undefined;
  await linq(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      override_optout: opts.overrideOptout || undefined,
      message: {
        parts: [{ type: "text", value: text }],
        effect,
        reply_to: opts.replyTo ? { message_id: opts.replyTo, part_index: 0 } : undefined,
      },
    }),
  });
}

export async function reactLove(messageId: string): Promise<void> {
  await linq(`/messages/${messageId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ type: "love", operation: "add" }),
  }).catch(() => {});
}

export async function shareContactCard(chatId: string): Promise<void> {
  await linq(`/chats/${chatId}/share_contact_card`, { method: "POST" });
}

/** iMessage header name. Keep the coach label as a single first name. */
export function contactCardFields(coachName: string): { first_name: string; last_name: string } {
  const first_name = coachName.trim() || "lodd.ai";
  return { first_name, last_name: "" };
}

function linqCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: number; body?: { error?: { code?: number } } };
  return e.body?.error?.code;
}

function linqStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  return (err as { status?: number }).status;
}

/** Create or update the name + photo on the PT line. Best-effort. */
export async function ensureContactCard(): Promise<void> {
  const phone = env.linqFromNumber.trim();
  if (!phone || !env.hasLinqToken) return;
  const { first_name, last_name } = contactCardFields(env.coachName);
  const payload = {
    first_name,
    last_name,
    image_url: env.contactCardImageUrl,
  };
  try {
    await linq("/contact_card", {
      method: "POST",
      body: JSON.stringify({ phone_number: phone, ...payload }),
    });
    return;
  } catch (err) {
    if (linqCode(err) !== 2014 && linqStatus(err) !== 409) {
      console.error("contact card create failed", err);
      return;
    }
  }
  try {
    await linq(`/contact_card?phone_number=${encodeURIComponent(phone)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("contact card update failed", err);
  }
}

export function isOptOutRejected(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; body?: { error?: { code?: number } } };
  return e.status === 403 || e.body?.error?.code === 2024;
}
