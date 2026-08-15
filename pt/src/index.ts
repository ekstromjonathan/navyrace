import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "./env.ts";
import { getDb } from "./db.ts";
import { verifySignature } from "./webhook.ts";
import { handlePayload } from "./handle.ts";
import { startScheduler } from "./scheduler.ts";
import * as journal from "./journal.ts";

getDb();

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    coach: env.coachName,
    provider: env.provider,
    model: env.model,
    smartModel: env.smartModel || null,
    reminders: journal.listEnabledReminders().length,
  }),
);

app.post("/webhook", async (c) => {
  const raw = await c.req.text();
  if (env.webhookSecret) {
    const ok = verifySignature(env.webhookSecret, raw, c.req.raw.headers);
    if (!ok) return c.json({ error: "invalid signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  /* Return 200 quickly; Linq retries 5xx. Work is short for V1 (one user). */
  try {
    const result = await handlePayload(payload);
    return c.json(result);
  } catch (err) {
    console.error("webhook handler failed", err);
    /* 200: Linq retries 5xx and would restart the typing bubble. */
    return c.json({ ok: true, skipped: "handler-error" });
  }
});

serve({ fetch: app.fetch, port: env.port, hostname: env.hostname }, (info) => {
  console.log(`${env.coachName} PT listening on http://${info.address}:${info.port}/webhook`);
  console.log(`model=${env.model} smart=${env.smartModel || "—"} allowlist=${env.allowlist.join(",")}`);
  startScheduler();
});
