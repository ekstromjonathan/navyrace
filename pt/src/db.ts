import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env.ts";

const here = dirname(fileURLToPath(import.meta.url));

let sqlite: DatabaseSync | null = null;
// Schema `pt` is not in the default Database generics; keep the client loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: SupabaseClient<any, "pt", any> | null = null;

export type JournalBackend = "supabase" | "sqlite";

export function journalBackend(): JournalBackend {
  const forced = process.env.PT_JOURNAL_BACKEND?.trim().toLowerCase();
  if (forced === "sqlite") return "sqlite";
  if (forced === "supabase") return "supabase";
  return env.supabaseUrl && env.supabaseServiceRoleKey ? "supabase" : "sqlite";
}

export function getSupabase(): SupabaseClient<any, "pt", any> {
  if (supabase) return supabase;
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)");
  }
  supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "pt" },
  });
  return supabase;
}

/** SQLite fallback for unit tests / local without Supabase credentials. */
export function getDb(): DatabaseSync {
  if (sqlite) return sqlite;
  if (journalBackend() === "supabase") {
    throw new Error("SQLite journal disabled when Supabase credentials are set");
  }
  const path = resolve(process.cwd(), env.dbPath);
  mkdirSync(dirname(path), { recursive: true });
  sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(readFileSync(resolve(here, "schema.sql"), "utf8"));
  ensureEntryArchiveColumns(sqlite);
  ensureReminderOnceColumn(sqlite);
  ensureReminderUrlColumn(sqlite);
  return sqlite;
}

function ensureEntryArchiveColumns(database: DatabaseSync) {
  const cols = database.prepare("PRAGMA table_info(entries)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("archived_at")) {
    database.exec("ALTER TABLE entries ADD COLUMN archived_at TEXT");
  }
  if (!names.has("archive_reason")) {
    database.exec("ALTER TABLE entries ADD COLUMN archive_reason TEXT");
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS entries_user_live ON entries(user_id, occurred_at DESC) WHERE archived_at IS NULL",
  );
}

function ensureReminderOnceColumn(database: DatabaseSync) {
  const cols = database.prepare("PRAGMA table_info(reminders)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "once_on")) {
    database.exec("ALTER TABLE reminders ADD COLUMN once_on TEXT");
  }
}

function ensureReminderUrlColumn(database: DatabaseSync) {
  const cols = database.prepare("PRAGMA table_info(reminders)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "url")) {
    database.exec("ALTER TABLE reminders ADD COLUMN url TEXT");
  }
}

export function initJournal(): JournalBackend {
  const backend = journalBackend();
  if (backend === "supabase") {
    getSupabase();
    return backend;
  }
  const hosted = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);
  if ((hosted || process.env.NODE_ENV === "production") && process.env.PT_ALLOW_SQLITE !== "1") {
    throw new Error(
      "Production journal requires SUPABASE_URL + SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY); set PT_ALLOW_SQLITE=1 to force SQLite",
    );
  }
  getDb();
  return backend;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function localParts(tz = env.tz, at: Date | string = new Date()): { date: string; hour: number; minute: number } {
  const d = typeof at === "string" ? new Date(at) : at;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function todayInTz(tz = env.tz, at?: Date | string): string {
  if (at == null && process.env.PT_TODAY) return process.env.PT_TODAY;
  return localParts(tz, at ?? new Date()).date;
}

/** Stable ISO timestamp for a local calendar day (noon UTC — safe for Europe/Oslo date bucketing). */
export function dayAnchorIso(dayYmd: string): string {
  return `${dayYmd}T12:00:00.000Z`;
}

/** Add calendar days to a YYYY-MM-DD string (UTC noon arithmetic — safe for date-only). */
export function addLocalDays(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

/**
 * Local date for a one-shot reminder. If the clock already passed the catch-up
 * window today, schedule for tomorrow instead.
 */
export function resolveOnceOn(
  tz: string,
  hour: number,
  minute: number,
  now: Date = new Date(),
  catchupMinutes = 180,
): string {
  const local = localParts(tz, now);
  const scheduled = hour * 60 + minute;
  const current = local.hour * 60 + local.minute;
  if (current - scheduled > catchupMinutes) return addLocalDays(local.date, 1);
  return local.date;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function jsonText(value: unknown, fallback = "{}"): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}
