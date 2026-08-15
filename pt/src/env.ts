import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env.local")]) {
    if (!existsSync(candidate)) continue;
    const text = readFileSync(candidate, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = value;
    }
  }
}

loadDotEnv();

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  port: Number(optional("PORT", optional("PT_PORT", "8787"))),
  hostname: optional("PT_HOST", "0.0.0.0"),
  tz: optional("PT_TZ", "Europe/Oslo"),
  coachName: optional("PT_COACH_NAME", "lodd.ai"),
  /** Prefer SUPABASE_URL; fall back to the Vite public URL when set in the same process. */
  get supabaseUrl() {
    return optional("SUPABASE_URL", optional("VITE_SUPABASE_URL"));
  },
  get supabaseServiceRoleKey() {
    return optional("SUPABASE_SERVICE_ROLE_KEY");
  },
  get dbPath() {
    const volume = optional("RAILWAY_VOLUME_MOUNT_PATH");
    if (volume) return `${volume.replace(/\/$/, "")}/journal.sqlite`;
    return optional("PT_DB_PATH", "./data/journal.sqlite");
  },
  get openrouterKey() {
    return optional("OPENROUTER_API_KEY");
  },
  get model() {
    const raw = optional("PT_MODEL", "");
    if (env.openrouterKey) {
      if (raw.includes("/")) return raw;
      if (raw === "claude-sonnet-4-6" || raw === "") return "anthropic/claude-sonnet-4.6";
      return raw;
    }
    return raw || "claude-sonnet-4-6";
  },
  get smartModel() {
    return optional("PT_MODEL_SMART");
  },
  get provider() {
    return env.openrouterKey ? "openrouter" : env.anthropicKey ? "anthropic" : "none";
  },
  get allowlist() {
    return optional("LINQ_ALLOWLIST", "+4740343295")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get hasLinqToken() {
    return Boolean(optional("LINQ_API_TOKEN"));
  },
  get linqToken() {
    return required("LINQ_API_TOKEN");
  },
  get webhookSecret() {
    return optional("LINQ_WEBHOOK_SECRET");
  },
  get anthropicKey() {
    return optional("ANTHROPIC_API_KEY");
  },
};

export function isAllowlisted(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\s+/g, "");
  return env.allowlist.some((n) => n === digits);
}
