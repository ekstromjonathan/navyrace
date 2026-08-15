import { createHmac, timingSafeEqual } from "node:crypto";
import type { Inbound } from "./types.ts";

export function verifySignature(secret: string, rawBody: string, headers: Headers): boolean {
  const msgId = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");
  if (!msgId || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretStr = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Buffer.from(secretStr, "base64");
  const expected = createHmac("sha256", keyBytes).update(`${msgId}.${timestamp}.${rawBody}`).digest("base64");

  return signature.split(" ").some((sig) => {
    if (!sig.startsWith("v1,")) return false;
    const got = Buffer.from(sig.slice(3), "base64");
    const exp = Buffer.from(expected, "base64");
    if (got.length !== exp.length) return false;
    return timingSafeEqual(got, exp);
  });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function normalizeEvent(payload: unknown): { eventType: string; eventId: string; inbound: Inbound | null } | null {
  const root = asRecord(payload);
  if (!root) return null;

  const eventType = str(root.type) || str(root.event_type) || str(root.event) || "";
  const eventId = str(root.event_id) || str(root.id) || "";
  const data = asRecord(root.data) ?? root;

  if (!eventType) return null;

  if (eventType !== "message.received") {
    return { eventType, eventId: eventId || eventType, inbound: null };
  }

  const chat = asRecord(data.chat) ?? {};
  const sender = asRecord(data.sender_handle) ?? asRecord(data.from_handle) ?? {};
  const health = asRecord(asRecord(chat.health_status) ? chat.health_status : data.health_status);
  const body =
    str(data.body) ||
    (Array.isArray(data.parts)
      ? data.parts
          .map((p) => {
            const r = asRecord(p);
            return r && r.type === "text" ? str(r.value) : "";
          })
          .filter(Boolean)
          .join("\n")
      : "") ||
    "";

  const inbound: Inbound = {
    eventId: eventId || str(data.id) || crypto.randomUUID(),
    messageId: str(data.id) || eventId || crypto.randomUUID(),
    chatId: str(chat.id) || str(data.chat_id) || "",
    phone: str(sender.handle) || str(data.from) || null,
    body,
    direction: str(data.direction) || "inbound",
    isGroup: Boolean(chat.is_group),
    healthStatus: str(health?.status) || null,
    service: str(data.service) || str(sender.service) || null,
  };

  if (!inbound.chatId) return { eventType, eventId: inbound.eventId, inbound: null };
  return { eventType, eventId: inbound.eventId, inbound };
}
