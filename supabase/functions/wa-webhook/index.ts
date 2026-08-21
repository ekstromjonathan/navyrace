// MAI — WhatsApp inbound webhook (skive 1).
//
// GET  = Meta webhook verification (hub.challenge).
// POST = inbound melding → idempotent event → scripted MAI-svar innenfor
//        24-timersvinduet. Ingen templates, ingen cues: det er skive 2.
//
// Manuset er GUIDES/WOZ_ONBOARDING_AND_SESSION_SCRIPT.md. Svarene er
// deterministiske med vilje — skive 1 skal vise om samtalen bærer, uten
// LLM-nøkkel, kostnad eller ikke-reproduserbare svar. `replyFor()` er sømmen
// der en LLM kan overta senere.
//
// Hemmeligheter (Supabase function secrets, aldri i git):
//   WA_VERIFY_TOKEN     valgfri streng, må matche det du skriver i Meta
//   WA_APP_SECRET       app secret — signaturverifisering
//   WA_PHONE_NUMBER_ID  test-nummerets id
//   WA_ACCESS_TOKEN     Graph API-token
//
// NB: mai.wa_token() i Vault er for pg_net-workeren i skive 2. Denne funksjonen
// leser env. Samme tokenverdi må inn begge steder når skive 2 lander.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { type Profile, replyFor } from "./script.ts";

const GRAPH_VERSION = "v21.0";

const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WA_APP_SECRET") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const ACCESS_TOKEN = Deno.env.get("WA_ACCESS_TOKEN") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

/* ------------------------------------------------------------- signature -- */

/** Meta signerer body med app secret. Uten dette kan hvem som helst poste hit. */
async function signatureValid(raw: string, header: string | null): Promise<boolean> {
  // Feiler LUKKET. Funksjonen deployes på en offentlig URL før Meta-oppsettet
  // er ferdig, og uten denne ville alle usignerte POST-er blitt behandlet —
  // hvem som helst kunne skrevet brukere og events inn i basen.
  if (!APP_SECRET) {
    console.error("wa-webhook: WA_APP_SECRET mangler — avviser POST");
    return false;
  }
  if (!header?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const got = header.slice("sha256=".length);

  // konstant tid — unngå at lengde/prefiks lekker
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ send -- */

async function sendText(waId: string, body: string): Promise<string | null> {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("wa-webhook: mangler WA_ACCESS_TOKEN/WA_PHONE_NUMBER_ID — hopper over send");
    return null;
  }
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: waId,
        type: "text",
        text: { preview_url: false, body },
      }),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("wa-webhook: send feilet", res.status, JSON.stringify(json));
    return null;
  }
  return json?.messages?.[0]?.id ?? null;
}

/* ---------------------------------------------------------------- handle -- */

async function handleMessage(
  waId: string,
  msgId: string,
  text: string,
  tsMs: number,
  isText = true,
) {
  // 1. bruker
  const { data: user, error: uErr } = await db
    .schema("mai")
    .from("users")
    .upsert({ wa_id: waId, last_inbound_at: new Date(tsMs).toISOString() }, { onConflict: "wa_id" })
    .select("id, profile")
    .single();
  if (uErr || !user) throw new Error(`upsert user: ${uErr?.message}`);

  // 2. idempotens-porten: unique index på wa_message_id. Duplikat = webhook-retry
  //    som allerede er behandlet — da svarer vi IKKE en gang til.
  const { error: eErr } = await db.schema("mai").from("events").insert({
    user_id: user.id,
    kind: "message",
    direction: "in",
    wa_message_id: msgId,
    body: text,
    occurred_at: new Date(tsMs).toISOString(),
  });
  if (eErr) {
    if (eErr.code === "23505") {
      console.log("wa-webhook: duplikat webhook, hopper over", msgId);
      return;
    }
    throw new Error(`insert inbound: ${eErr.message}`);
  }

  // 3. svar. Ikke-tekst (bilde/lyd/sticker) får et fast svar, men går gjennom
  //    samme dedup-port over — ellers dobbeltsvarer vi på Meta-retry.
  const { reply, next } = isText
    ? replyFor((user.profile ?? {}) as Profile, text)
    : {
      reply: "Jeg leser bare tekst foreløpig — skriv det gjerne med ord.",
      next: (user.profile ?? {}) as Profile,
    };

  await db.schema("mai").from("users")
    .update({ profile: next, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  const outId = await sendText(waId, reply);

  await db.schema("mai").from("events").insert({
    user_id: user.id,
    kind: "message",
    direction: "out",
    wa_message_id: outId,
    body: reply,
    payload: { step: next.step ?? null, scripted: true },
  });
}

/* ------------------------------------------------------------------ http -- */

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN &&
      VERIFY_TOKEN !== ""
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await signatureValid(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("bad signature", { status: 401 });
  }

  // Meta retry-er på alt som ikke er 200. Inbound er idempotent, så vi svarer
  // 200 også når behandlingen feiler — og logger i stedet for å be om storm.
  try {
    const body = JSON.parse(raw);
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const m of change?.value?.messages ?? []) {
          await handleMessage(
            m.from,
            m.id,
            m.text?.body ?? "",
            Number(m.timestamp) * 1000 || Date.now(),
            m.type === "text",
          );
        }
      }
    }
  } catch (err) {
    console.error("wa-webhook:", err instanceof Error ? err.message : err);
  }

  return new Response("ok", { status: 200 });
});
