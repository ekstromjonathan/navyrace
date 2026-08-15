import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { env } from "./env.ts";
import { initJournal, journalBackend } from "./db.ts";
import { verifySignature } from "./webhook.ts";
import { handlePayload } from "./handle.ts";
import { startScheduler } from "./scheduler.ts";
import * as journal from "./journal.ts";

const backend = initJournal();

function findStaticRoot(): string | null {
  const candidates = [
    process.env.PT_STATIC_DIR,
    "dist",
    "../dist",
    "/srv/pt/dist",
    "/srv/dist",
    "/app/pt/dist",
    "/app/dist",
  ].filter((v): v is string => Boolean(v && String(v).trim()));

  let fallbackWithDotDot: string | null = null;
  for (const raw of candidates) {
    const abs = resolve(process.cwd(), raw);
    if (!existsSync(join(abs, "index.html"))) continue;
    const rel = relative(process.cwd(), abs);
    const root = rel === "" ? "." : rel;
    /* Prefer roots that stay under cwd — serve-static is happier without "..". */
    if (root === "." || (!root.startsWith(`..${"/"}`) && root !== "..")) return root;
    fallbackWithDotDot ??= root;
  }
  return fallbackWithDotDot;
}

const staticRoot = findStaticRoot();
if (!staticRoot && process.env.PT_REQUIRE_SPA === "1") {
  console.error(
    "PT_REQUIRE_SPA=1 but no Vite dist/ found (tried PT_STATIC_DIR, dist, ../dist). Rebuild with root Dockerfile or npm run build.",
  );
  process.exit(1);
}

const app = new Hono();

app.get("/health", async (c) =>
  c.json({
    ok: true,
    coach: env.coachName,
    provider: env.provider,
    model: env.model,
    smartModel: env.smartModel || null,
    journal: backend || journalBackend(),
    reminders: (await journal.listEnabledReminders()).length,
    linq: env.hasLinqToken,
    spa: Boolean(staticRoot),
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

if (staticRoot) {
  const abs = resolve(process.cwd(), staticRoot);
  app.use("/*", serveStatic({ root: staticRoot }));
  app.get("*", (c) => c.html(readFileSync(join(abs, "index.html"), "utf8")));
}

serve({ fetch: app.fetch, port: env.port, hostname: env.hostname }, (info) => {
  console.log(`${env.coachName} PT listening on http://${info.address}:${info.port}/webhook`);
  console.log(
    `journal=${backend} model=${env.model} smart=${env.smartModel || "—"} allowlist=${env.allowlist.join(",")} spa=${staticRoot || "off"} linq=${env.hasLinqToken}`,
  );
  startScheduler();
});
