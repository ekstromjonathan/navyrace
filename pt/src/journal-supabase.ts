import { randomUUID } from "node:crypto";
import { getSupabase, jsonText, nowIso, parseJson, todayInTz } from "./db.ts";
import {
  applyLoadAdapt,
  buildDayView,
  snapshotToday,
  stampPlanOnActivate,
  startedOnOf,
  type DayView,
} from "./calendar.ts";
import type {
  ChatTurn,
  CoachEventKind,
  CoachEventRow,
  CoachEventSource,
  InviteRow,
  Pending,
  Plan,
  PlanSession,
  Quantity,
  ReminderKind,
  ReminderRow,
  TrackKind,
  TrackRow,
  TrackStatus,
  UserFacts,
  UserRow,
  ReminderFilter,
} from "./types.ts";
import { titleForSlug } from "./reminder-topic.ts";
import type { ArchivedEntry } from "./journal-sqlite.ts";

type SbError = { code?: string; message: string } | null;

function throwIf(error: SbError): void {
  if (error) throw new Error(error.message);
}

function isUniqueViolation(error: SbError): boolean {
  return Boolean(error && (error.code === "23505" || /duplicate|unique/i.test(error.message)));
}

function asUser(row: Record<string, unknown>): UserRow {
  return {
    id: String(row.id),
    chat_id: String(row.chat_id),
    phone_e164: row.phone_e164 == null ? null : String(row.phone_e164),
    tz: String(row.tz ?? "Europe/Oslo"),
    locale: String(row.locale ?? "nb"),
    display_name: row.display_name == null ? null : String(row.display_name),
    facts: jsonText(row.facts, "{}"),
    pending: row.pending == null ? null : jsonText(row.pending),
    health_status: String(row.health_status ?? "HEALTHY"),
    last_contact_card_at: row.last_contact_card_at == null ? null : String(row.last_contact_card_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function asTrack(row: Record<string, unknown>): TrackRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    kind: row.kind as TrackKind,
    slug: String(row.slug),
    name: String(row.name),
    tags: jsonText(row.tags, "[]"),
    status: row.status as TrackStatus,
    plan: row.plan == null ? null : jsonText(row.plan),
    version: Number(row.version ?? 1),
    supersedes_id: row.supersedes_id == null ? null : String(row.supersedes_id),
    archive_reason: row.archive_reason == null ? null : String(row.archive_reason),
    archived_at: row.archived_at == null ? null : String(row.archived_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function asReminder(row: Record<string, unknown>): ReminderRow {
  const slug = row.slug == null || String(row.slug).trim() === "" ? String(row.kind || "train") : String(row.slug);
  const title =
    row.title == null || String(row.title).trim() === ""
      ? slug === "train"
        ? "trening"
        : slug.replace(/-/g, " ")
      : String(row.title);
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    kind: (row.kind as ReminderKind) || "train",
    slug,
    title,
    hour: Number(row.hour),
    minute: Number(row.minute ?? 0),
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === "1" ? 1 : 0,
    last_fired_on: row.last_fired_on == null ? null : String(row.last_fired_on).slice(0, 10),
    once_on: row.once_on == null ? null : String(row.once_on).slice(0, 10),
    url: row.url == null ? null : String(row.url),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function asCoachEvent(row: Record<string, unknown>): CoachEventRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    kind: row.kind as CoachEventKind,
    source: row.source as CoachEventSource,
    ref_id: row.ref_id == null ? null : String(row.ref_id),
    dedupe_key: row.dedupe_key == null ? null : String(row.dedupe_key),
    metadata: jsonText(row.metadata, "{}"),
    created_at: String(row.created_at),
  };
}

export async function claimEvent(eventId: string): Promise<boolean> {
  const { error } = await getSupabase().from("webhook_events").insert({ event_id: eventId, received_at: nowIso() });
  if (isUniqueViolation(error)) return false;
  throwIf(error);
  return true;
}

export async function claimMessage(messageId: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from("processed_messages")
    .insert({ linq_message_id: messageId, processed_at: nowIso() });
  if (isUniqueViolation(error)) return false;
  throwIf(error);
  return true;
}

export async function releaseEvent(eventId: string): Promise<void> {
  const { error } = await getSupabase().from("webhook_events").delete().eq("event_id", eventId);
  throwIf(error);
}

export async function releaseMessage(messageId: string): Promise<void> {
  const { error } = await getSupabase().from("processed_messages").delete().eq("linq_message_id", messageId);
  throwIf(error);
}

export async function recordCoachEvent(input: {
  userId: string;
  kind: CoachEventKind;
  source: CoachEventSource;
  refId?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<CoachEventRow> {
  const encoded = JSON.stringify(input.metadata ?? {});
  if (encoded.length > 2048) throw new Error("coach event metadata exceeds 2048 characters");
  const body = {
    id: randomUUID(),
    user_id: input.userId,
    kind: input.kind,
    source: input.source,
    ref_id: input.refId ?? null,
    dedupe_key: input.dedupeKey ?? null,
    metadata: input.metadata ?? {},
    created_at: nowIso(),
  };
  const { data, error } = await getSupabase().from("coach_events").insert(body).select("*").single();
  if (isUniqueViolation(error) && input.dedupeKey) {
    const { data: existing, error: existingError } = await getSupabase()
      .from("coach_events")
      .select("*")
      .eq("dedupe_key", input.dedupeKey)
      .maybeSingle();
    throwIf(existingError);
    if (existing) return asCoachEvent(existing as Record<string, unknown>);
  }
  throwIf(error);
  return asCoachEvent(data as Record<string, unknown>);
}

export async function listCoachEvents(userId: string, limit = 50): Promise<CoachEventRow[]> {
  const n = Math.max(1, Math.min(200, Math.round(limit)));
  const { data, error } = await getSupabase()
    .from("coach_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(n);
  throwIf(error);
  return (data ?? []).map((r) => asCoachEvent(r as Record<string, unknown>));
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const { data, error } = await getSupabase().from("users").select("*").eq("id", id).maybeSingle();
  throwIf(error);
  return data ? asUser(data as Record<string, unknown>) : undefined;
}

export async function getUserByPhone(phone: string): Promise<UserRow | undefined> {
  const { data, error } = await getSupabase().from("users").select("*").eq("phone_e164", phone).maybeSingle();
  throwIf(error);
  return data ? asUser(data as Record<string, unknown>) : undefined;
}

export async function upsertUser(chatId: string, phone: string | null): Promise<UserRow> {
  const sb = getSupabase();
  const { data: existing, error: findErr } = await sb.from("users").select("*").eq("chat_id", chatId).maybeSingle();
  throwIf(findErr);
  const ts = nowIso();
  if (existing) {
    const row = asUser(existing as Record<string, unknown>);
    if (phone && row.phone_e164 !== phone) {
      const { data, error } = await sb
        .from("users")
        .update({ phone_e164: phone, updated_at: ts })
        .eq("id", row.id)
        .select("*")
        .single();
      throwIf(error);
      return asUser(data as Record<string, unknown>);
    }
    return row;
  }
  const id = randomUUID();
  const { data, error } = await sb
    .from("users")
    .insert({
      id,
      chat_id: chatId,
      phone_e164: phone,
      tz: "Europe/Oslo",
      locale: "nb",
      facts: {},
      created_at: ts,
      updated_at: ts,
    })
    .select("*")
    .single();
  throwIf(error);
  return asUser(data as Record<string, unknown>);
}

export function factsOf(user: UserRow): UserFacts {
  return parseJson<UserFacts>(user.facts, {});
}

export function pendingOf(user: UserRow): Pending | null {
  return parseJson<Pending | null>(user.pending, null);
}

export async function setPending(userId: string, pending: Pending | null): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({ pending: pending ?? null, updated_at: nowIso() })
    .eq("id", userId);
  throwIf(error);
}

export async function setHealth(userId: string, status: string): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({ health_status: status, updated_at: nowIso() })
    .eq("id", userId);
  throwIf(error);
}

export async function setFacts(userId: string, patch: UserFacts): Promise<UserFacts> {
  const user = await getUser(userId);
  if (!user) throw new Error("user missing");
  const next = { ...factsOf(user), ...patch };
  const { error } = await getSupabase()
    .from("users")
    .update({ facts: next, updated_at: nowIso() })
    .eq("id", userId);
  throwIf(error);
  return next;
}

export async function setLocale(userId: string, locale: string): Promise<void> {
  const { error } = await getSupabase().from("users").update({ locale, updated_at: nowIso() }).eq("id", userId);
  throwIf(error);
}

export async function setDisplayName(userId: string, name: string | null): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({ display_name: name, updated_at: nowIso() })
    .eq("id", userId);
  throwIf(error);
}

export async function isFreshStart(userId: string): Promise<boolean> {
  const sb = getSupabase();
  const [{ count: entries }, { count: notes }] = await Promise.all([
    sb.from("entries").select("id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if ((entries ?? 0) > 0 || (notes ?? 0) > 0) return false;
  return !(await activeTraining(userId)) && !(await draftTraining(userId));
}

export async function touchContactCard(userId: string): Promise<void> {
  const ts = nowIso();
  const { error } = await getSupabase()
    .from("users")
    .update({ last_contact_card_at: ts, updated_at: ts })
    .eq("id", userId);
  throwIf(error);
}

export function shouldShareContactCard(user: UserRow): boolean {
  if (!user.last_contact_card_at) return true;
  const last = user.last_contact_card_at.slice(0, 10);
  return last !== todayInTz(user.tz);
}

export async function getTrack(id: string): Promise<TrackRow | undefined> {
  const { data, error } = await getSupabase().from("tracks").select("*").eq("id", id).maybeSingle();
  throwIf(error);
  return data ? asTrack(data as Record<string, unknown>) : undefined;
}

export async function listTracks(userId: string, status?: TrackStatus): Promise<TrackRow[]> {
  let q = getSupabase().from("tracks").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  throwIf(error);
  return (data ?? []).map((r) => asTrack(r as Record<string, unknown>));
}

export async function findTrackBySlug(
  userId: string,
  slug: string,
  status?: TrackStatus,
): Promise<TrackRow | undefined> {
  let q = getSupabase()
    .from("tracks")
    .select("*")
    .eq("user_id", userId)
    .eq("slug", slug)
    .order("version", { ascending: false })
    .limit(1);
  if (status) q = q.eq("status", status);
  else q = q.neq("status", "archived");
  const { data, error } = await q.maybeSingle();
  throwIf(error);
  return data ? asTrack(data as Record<string, unknown>) : undefined;
}

export async function activeTraining(userId: string): Promise<TrackRow | undefined> {
  const { data, error } = await getSupabase()
    .from("tracks")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "training")
    .eq("status", "active")
    .maybeSingle();
  throwIf(error);
  return data ? asTrack(data as Record<string, unknown>) : undefined;
}

export async function draftTraining(userId: string): Promise<TrackRow | undefined> {
  const { data, error } = await getSupabase()
    .from("tracks")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "training")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIf(error);
  return data ? asTrack(data as Record<string, unknown>) : undefined;
}

export async function createTrack(input: {
  userId: string;
  kind: TrackKind;
  slug: string;
  name: string;
  tags?: string[];
  status?: TrackStatus;
  plan?: Plan | null;
}): Promise<TrackRow> {
  const sb = getSupabase();
  const { data: versions, error: vErr } = await sb
    .from("tracks")
    .select("version")
    .eq("user_id", input.userId)
    .eq("slug", input.slug)
    .order("version", { ascending: false })
    .limit(1);
  throwIf(vErr);
  const version = (versions?.[0] ? Number((versions[0] as { version: number }).version) : 0) + 1;
  const id = randomUUID();
  const ts = nowIso();
  const { data, error } = await sb
    .from("tracks")
    .insert({
      id,
      user_id: input.userId,
      kind: input.kind,
      slug: input.slug,
      name: input.name,
      tags: input.tags ?? [],
      status: input.status ?? "active",
      plan: input.plan ?? null,
      version,
      created_at: ts,
      updated_at: ts,
    })
    .select("*")
    .single();
  throwIf(error);
  return asTrack(data as Record<string, unknown>);
}

export async function ensureTrack(input: {
  userId: string;
  kind: TrackKind;
  slug: string;
  name: string;
  tags?: string[];
}): Promise<TrackRow> {
  return (
    (await findTrackBySlug(input.userId, input.slug, "active")) ||
    (await findTrackBySlug(input.userId, input.slug, "draft")) ||
    (await createTrack({ ...input, status: input.kind === "training" ? "draft" : "active" }))
  );
}

export async function setPlan(trackId: string, plan: Plan): Promise<TrackRow> {
  const { data, error } = await getSupabase()
    .from("tracks")
    .update({ plan, status: "draft", updated_at: nowIso() })
    .eq("id", trackId)
    .select("*")
    .single();
  throwIf(error);
  return asTrack(data as Record<string, unknown>);
}

export async function patchPlan(trackId: string, plan: Plan): Promise<TrackRow> {
  const current = await getTrack(trackId);
  const version = (current?.version ?? 0) + 1;
  const { data, error } = await getSupabase()
    .from("tracks")
    .update({ plan, version, updated_at: nowIso() })
    .eq("id", trackId)
    .select("*")
    .single();
  throwIf(error);
  return asTrack(data as Record<string, unknown>);
}

export function planOf(track: TrackRow): Plan | null {
  return parseJson<Plan | null>(track.plan, null);
}

export async function activateTrack(trackId: string): Promise<TrackRow> {
  const track = await getTrack(trackId);
  if (!track) throw new Error("track missing");
  if (track.status === "archived") throw new Error("cannot activate archived track");
  if (track.kind === "training") {
    const current = await activeTraining(track.user_id);
    if (current && current.id !== trackId) {
      throw new Error("active training exists — archive it first");
    }
  }
  const user = await getUser(track.user_id);
  const tz = user?.tz || "Europe/Oslo";
  const stamped = stampPlanOnActivate(planOf(track), todayInTz(tz));
  const patch: Record<string, unknown> = { status: "active", updated_at: nowIso() };
  if (stamped) patch.plan = stamped;
  const { data, error } = await getSupabase()
    .from("tracks")
    .update(patch)
    .eq("id", trackId)
    .select("*")
    .single();
  throwIf(error);
  return asTrack(data as Record<string, unknown>);
}

export async function archiveTrack(trackId: string, reason: string): Promise<TrackRow> {
  const ts = nowIso();
  const { data, error } = await getSupabase()
    .from("tracks")
    .update({ status: "archived", archive_reason: reason, archived_at: ts, updated_at: ts })
    .eq("id", trackId)
    .select("*")
    .single();
  throwIf(error);
  return asTrack(data as Record<string, unknown>);
}

export async function entryCount(trackId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("entries")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)
    .is("archived_at", null);
  throwIf(error);
  return count ?? 0;
}

export async function noteCount(trackId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId);
  throwIf(error);
  return count ?? 0;
}

export async function logEntry(input: {
  trackId: string;
  userId: string;
  quantity?: Quantity | null;
  quality?: string | null;
  note?: string | null;
  sessionRef?: string | null;
  source: "heuristic" | "llm" | "user";
  linqMessageId?: string | null;
  occurredAt?: string;
}): Promise<{ id: string; duplicate: boolean }> {
  const id = randomUUID();
  const { error } = await getSupabase().from("entries").insert({
    id,
    track_id: input.trackId,
    user_id: input.userId,
    occurred_at: input.occurredAt ?? nowIso(),
    quantity: input.quantity ?? null,
    quality: input.quality ?? null,
    note: input.note ?? null,
    session_ref: input.sessionRef ?? null,
    source: input.source,
    linq_message_id: input.linqMessageId ?? null,
    created_at: nowIso(),
  });
  if (input.linqMessageId && isUniqueViolation(error)) return { id: "", duplicate: true };
  throwIf(error);
  return { id, duplicate: false };
}

export async function patchEntry(
  entryId: string,
  patch: { quality?: string | null; note?: string | null },
): Promise<boolean> {
  const updates: Record<string, unknown> = {};
  if ("quality" in patch) updates.quality = patch.quality ?? null;
  if ("note" in patch) updates.note = patch.note ?? null;
  if (!Object.keys(updates).length) return false;
  const { data, error } = await getSupabase()
    .from("entries")
    .update(updates)
    .eq("id", entryId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  throwIf(error);
  return Boolean(data?.id);
}

type EntryLookup = {
  id: string;
  user_id: string;
  archived_at: string | null;
  occurred_at: string;
  quantity: string | null;
  quality: string | null;
  note: string | null;
  session_ref: string | null;
  slug: string;
  name: string;
  kind: TrackKind;
};

function quantityText(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toArchived(rec: EntryLookup, alreadyArchived?: boolean): ArchivedEntry {
  return {
    id: rec.id,
    slug: rec.slug,
    name: rec.name,
    kind: rec.kind,
    occurred_at: rec.occurred_at,
    quantity: rec.quantity,
    quality: rec.quality,
    note: rec.note,
    session_ref: rec.session_ref,
    alreadyArchived,
  };
}

function mapJoinedEntry(row: Record<string, unknown>): EntryLookup {
  const track = (row.tracks ?? row.track) as Record<string, unknown> | undefined;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    archived_at: row.archived_at == null ? null : String(row.archived_at),
    occurred_at: String(row.occurred_at),
    quantity: quantityText(row.quantity),
    quality: row.quality == null ? null : String(row.quality),
    note: row.note == null ? null : String(row.note),
    session_ref: row.session_ref == null ? null : String(row.session_ref),
    slug: String(track?.slug ?? ""),
    name: String(track?.name ?? ""),
    kind: (track?.kind as TrackKind) ?? "custom",
  };
}

async function entryLookup(id: string): Promise<EntryLookup | undefined> {
  const { data, error } = await getSupabase()
    .from("entries")
    .select("id, user_id, archived_at, occurred_at, quantity, quality, note, session_ref, tracks!inner(slug, name, kind)")
    .eq("id", id)
    .maybeSingle();
  throwIf(error);
  return data ? mapJoinedEntry(data as Record<string, unknown>) : undefined;
}

export async function archiveEntry(input: {
  userId: string;
  entryId?: string;
  slug?: string;
  trackKind?: TrackKind;
  reason?: string;
}): Promise<ArchivedEntry | null> {
  let rec: EntryLookup | undefined;
  if (input.entryId) {
    rec = await entryLookup(input.entryId);
    if (!rec || rec.user_id !== input.userId) return null;
    if (rec.archived_at) return toArchived(rec, true);
  } else {
    let q = getSupabase()
      .from("entries")
      .select(
        "id, user_id, archived_at, occurred_at, quantity, quality, note, session_ref, created_at, tracks!inner(slug, name, kind)",
      )
      .eq("user_id", input.userId)
      .is("archived_at", null)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);
    const slug = input.slug?.trim() || null;
    const kind = input.trackKind ?? null;
    const { data, error } = await q;
    throwIf(error);
    const mapped = (data ?? []).map((r) => mapJoinedEntry(r as Record<string, unknown>));
    rec = mapped.find((e) => (!slug || e.slug === slug) && (!kind || e.kind === kind));
    if (!rec) return null;
  }
  const ts = nowIso();
  const { error: updErr } = await getSupabase()
    .from("entries")
    .update({ archived_at: ts, archive_reason: input.reason ?? "user_requested" })
    .eq("id", rec.id)
    .eq("user_id", input.userId)
    .is("archived_at", null);
  throwIf(updErr);
  const updated = await entryLookup(rec.id);
  return updated ? toArchived(updated) : null;
}

export async function addNote(input: {
  userId: string;
  trackId?: string | null;
  kind: string;
  body: string;
}): Promise<string> {
  const id = randomUUID();
  const { error } = await getSupabase().from("notes").insert({
    id,
    user_id: input.userId,
    track_id: input.trackId ?? null,
    kind: input.kind,
    body: input.body,
    created_at: nowIso(),
  });
  throwIf(error);
  return id;
}

export async function recentEntries(userId: string, limit = 8): Promise<Record<string, unknown>[]> {
  const { data, error } = await getSupabase()
    .from("entries")
    .select("id, occurred_at, quantity, quality, note, session_ref, tracks!inner(slug, name, kind)")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  throwIf(error);
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const track = (row.tracks ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      occurred_at: row.occurred_at,
      quantity: quantityText(row.quantity),
      quality: row.quality,
      note: row.note,
      session_ref: row.session_ref,
      slug: track.slug,
      name: track.name,
      kind: track.kind,
    };
  });
}

export async function recentNotes(
  userId: string,
  limit = 5,
): Promise<{ kind: string; body: string; created_at: string }[]> {
  const { data, error } = await getSupabase()
    .from("notes")
    .select("kind, body, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  throwIf(error);
  return (data ?? []) as { kind: string; body: string; created_at: string }[];
}

const MAX_LOG_CHARS = 800;
const MAX_LOG_ROWS = 100;

export async function logMessage(
  userId: string,
  role: "user" | "pt",
  body: string,
  linqMessageId?: string | null,
): Promise<void> {
  const trimmed = body.trim().slice(0, MAX_LOG_CHARS);
  if (!trimmed) return;
  const sb = getSupabase();
  const { error } = await sb.from("message_log").insert({
    id: randomUUID(),
    user_id: userId,
    role,
    body: trimmed,
    linq_message_id: linqMessageId ?? null,
    created_at: nowIso(),
  });
  throwIf(error);

  const { data: old, error: listErr } = await sb
    .from("message_log")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(MAX_LOG_ROWS, MAX_LOG_ROWS + 200);
  throwIf(listErr);
  const ids = (old ?? []).map((r) => String((r as { id: string }).id));
  if (ids.length) {
    const { error: delErr } = await sb.from("message_log").delete().in("id", ids);
    throwIf(delErr);
  }
}

export async function recentChat(
  userId: string,
  limit = 8,
  excludeLinqMessageId?: string | null,
): Promise<ChatTurn[]> {
  const { data, error } = await getSupabase()
    .from("message_log")
    .select("role, body, linq_message_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(excludeLinqMessageId ? limit + 4 : limit);
  throwIf(error);
  const chronological = ([...(data ?? [])] as ChatTurn[]).reverse();
  if (!excludeLinqMessageId) return chronological.slice(-limit);
  return chronological
    .filter((m) => !(m.role === "user" && m.linq_message_id === excludeLinqMessageId))
    .slice(-limit);
}

/** Look further back in the rolling chat log. Optional substring filter (case-insensitive). */
export async function recallChat(
  userId: string,
  opts: { limit?: number; contains?: string } = {},
): Promise<ChatTurn[]> {
  const limit = Math.min(40, Math.max(1, opts.limit ?? 20));
  const terms = (opts.contains ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const recent = await recentChat(userId, limit);
  if (terms.length === 0) return recent;

  const { data, error } = await getSupabase()
    .from("message_log")
    .select("role, body, linq_message_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  throwIf(error);
  const list = (data ?? []) as ChatTurn[];
  const matched = list.filter((m) => {
    const body = m.body.toLowerCase();
    return terms.some((t) => body.includes(t));
  });

  // Keep recent context even when the keyword only appears in PT questions,
  // so user answers like «3-4 ganger» still show up next to «dager».
  const byKey = new Map<string, ChatTurn>();
  for (const m of [...matched.reverse(), ...recent]) {
    const key = `${m.created_at}|${m.role}|${m.body}`;
    byKey.set(key, m);
  }
  return [...byKey.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-Math.max(limit, Math.min(40, matched.length + recent.length)));
}

export async function lastRpeForLoadKey(userId: string, loadKey: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("entries")
    .select("quality, session_ref")
    .eq("user_id", userId)
    .is("archived_at", null)
    .not("quality", "is", null)
    .neq("quality", "hoppet")
    .like("session_ref", `%${loadKey}%`)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIf(error);
  return data?.quality ? String(data.quality) : null;
}

async function doneSessionRefs(trackId: string): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from("entries")
    .select("session_ref, quality")
    .eq("track_id", trackId)
    .is("archived_at", null)
    .not("session_ref", "is", null);
  throwIf(error);
  return new Set(
    (data ?? [])
      .filter((r) => String((r as { quality: string | null }).quality ?? "") !== "hoppet")
      .map((r) => (r as { session_ref: string | null }).session_ref)
      .filter((v): v is string => Boolean(v)),
  );
}

export async function nextSession(
  userId: string,
  track: TrackRow,
): Promise<{ session: PlanSession; load: number | null; adapt: "lett" | "brutalt" | null } | null> {
  const plan = planOf(track);
  if (!plan?.sessions?.length) return null;
  const done = await doneSessionRefs(track.id);
  const session = plan.sessions.find((s) => !done.has(s.id)) ?? null;
  if (!session) return null;
  const prev = session.loadKey ? await lastRpeForLoadKey(userId, session.loadKey) : null;
  const adapted = applyLoadAdapt(session, prev);
  return { session, load: adapted.load, adapt: adapted.adapt };
}

export async function todayView(user: UserRow, at?: string): Promise<DayView> {
  const training = await activeTraining(user.id);
  if (!training) return { kind: "none" };
  const plan = planOf(training);
  if (!plan?.sessions?.length) return { kind: "none" };
  const today = at ?? todayInTz(user.tz);
  const startedOn = startedOnOf(training, plan, user.tz);
  const done = await doneSessionRefs(training.id);
  const view = buildDayView(plan, done, today, startedOn);
  if (view.kind === "session" && (done.has(`extra:${today}`) || (await trainedOnDay(user.id, today, user.tz)))) {
    return { kind: "logged", weekday: view.weekday, week: view.week, session: view.session };
  }
  if (view.kind === "session" && view.session.loadKey) {
    const prev = await lastRpeForLoadKey(user.id, view.session.loadKey);
    const adapted = applyLoadAdapt(view.session, prev);
    return { ...view, load: adapted.load, adapt: adapted.adapt };
  }
  return view;
}

export async function snapshot(user: UserRow) {
  const tracks = (await listTracks(user.id)).filter((t) => t.status !== "archived");
  const training = await activeTraining(user.id);
  const draft = await draftTraining(user.id);
  const view = await todayView(user);
  const trackStats = await Promise.all(
    tracks.map(async (t) => ({
      id: t.id,
      kind: t.kind,
      slug: t.slug,
      name: t.name,
      status: t.status,
      version: t.version,
      hasPlan: Boolean(t.plan),
      entries: await entryCount(t.id),
    })),
  );
  return {
    facts: factsOf(user),
    pending: pendingOf(user),
    tracks: trackStats,
    activeTraining: training
      ? { id: training.id, name: training.name, version: training.version }
      : null,
    draftTraining: draft ? { id: draft.id, name: draft.name, version: draft.version } : null,
    today: snapshotToday(view),
    recentEntries: await recentEntries(user.id, 8),
    recentNotes: await recentNotes(user.id, 8),
    recentChat: await recentChat(user.id, 24),
    reminders: (await listReminders(user.id))
      .filter((r) => r.enabled === 1)
      .map((r) => ({
        slug: r.slug,
        title: r.title,
        kind: r.kind,
        hour: r.hour,
        minute: r.minute,
        onceOn: r.once_on,
        lastFiredOn: r.last_fired_on,
        url: r.url,
      })),
  };
}

export function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export async function upsertReminder(
  userId: string,
  slug: string,
  hour: number,
  minute: number,
  opts?: { onceOn?: string | null; url?: string | null; title?: string },
): Promise<ReminderRow> {
  const h = Math.min(23, Math.max(0, Math.round(hour)));
  const m = Math.min(59, Math.max(0, Math.round(minute)));
  const onceOn = opts?.onceOn === undefined ? null : opts.onceOn;
  const url = opts && "url" in opts ? (opts.url ?? null) : undefined;
  const cleanSlug = (slug || "train").trim().slice(0, 40) || "train";
  const title = (opts?.title?.trim() || titleForSlug(cleanSlug)).slice(0, 48);
  const sb = getSupabase();
  let find = sb.from("reminders").select("*").eq("user_id", userId).eq("slug", cleanSlug).eq("hour", h).eq("minute", m);
  find = onceOn == null ? find.is("once_on", null) : find.eq("once_on", onceOn);
  const { data: existing, error: findErr } = await find.maybeSingle();
  throwIf(findErr);
  const ts = nowIso();
  if (existing) {
    const patch: Record<string, unknown> = {
      hour: h,
      minute: m,
      slug: cleanSlug,
      title,
      enabled: true,
      once_on: onceOn,
      updated_at: ts,
    };
    if (url !== undefined) patch.url = url;
    const { data, error } = await sb
      .from("reminders")
      .update(patch)
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();
    throwIf(error);
    return asReminder(data as Record<string, unknown>);
  }
  const id = randomUUID();
  const { data, error } = await sb
    .from("reminders")
    .insert({
      id,
      user_id: userId,
      kind: "train",
      slug: cleanSlug,
      title,
      hour: h,
      minute: m,
      enabled: true,
      once_on: onceOn,
      url: url ?? null,
      created_at: ts,
      updated_at: ts,
    })
    .select("*")
    .single();
  throwIf(error);
  return asReminder(data as Record<string, unknown>);
}

export async function getReminder(id: string): Promise<ReminderRow | undefined> {
  const { data, error } = await getSupabase().from("reminders").select("*").eq("id", id).maybeSingle();
  throwIf(error);
  return data ? asReminder(data as Record<string, unknown>) : undefined;
}

export async function listReminders(userId: string): Promise<ReminderRow[]> {
  const { data, error } = await getSupabase()
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .order("hour")
    .order("minute");
  throwIf(error);
  return (data ?? []).map((r) => asReminder(r as Record<string, unknown>));
}

export async function disableReminders(userId: string, filter: ReminderFilter = {}): Promise<ReminderRow[]> {
  const live = (await listReminders(userId)).filter((r) => r.enabled === 1);
  const hits = live.filter((r) => reminderMatches(r, filter));
  const out: ReminderRow[] = [];
  for (const r of hits) {
    const { data, error } = await getSupabase()
      .from("reminders")
      .update({ enabled: false, updated_at: nowIso() })
      .eq("id", r.id)
      .select("*")
      .single();
    throwIf(error);
    out.push(asReminder(data as Record<string, unknown>));
  }
  return out;
}

export async function disableReminder(
  userId: string,
  slug?: string,
): Promise<ReminderRow | undefined> {
  const rows = await disableReminders(userId, slug ? { slug } : {});
  return rows[0];
}

export async function patchReminder(
  id: string,
  patch: { url?: string | null; slug?: string; title?: string },
): Promise<ReminderRow | undefined> {
  const existing = await getReminder(id);
  if (!existing) return undefined;
  const body: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.url !== undefined) body.url = patch.url;
  if (patch.slug?.trim()) body.slug = patch.slug.trim().slice(0, 40);
  if (patch.title?.trim()) body.title = patch.title.trim().slice(0, 48);
  const { data, error } = await getSupabase()
    .from("reminders")
    .update(body)
    .eq("id", id)
    .select("*")
    .single();
  throwIf(error);
  return asReminder(data as Record<string, unknown>);
}

function reminderMatches(r: ReminderRow, filter: ReminderFilter): boolean {
  if (filter.slug && r.slug !== filter.slug) return false;
  if (filter.hour != null && r.hour !== filter.hour) return false;
  if (filter.minute != null && r.minute !== filter.minute) return false;
  return true;
}

export async function markReminderFired(id: string, day: string): Promise<void> {
  const existing = await getReminder(id);
  const patch: Record<string, unknown> = { last_fired_on: day, updated_at: nowIso() };
  if (existing?.once_on) patch.enabled = false;
  const { error } = await getSupabase().from("reminders").update(patch).eq("id", id);
  throwIf(error);
}

export async function listEnabledReminders(): Promise<ReminderRow[]> {
  const { data, error } = await getSupabase().from("reminders").select("*").eq("enabled", true);
  throwIf(error);
  return (data ?? []).map((r) => asReminder(r as Record<string, unknown>));
}

export async function trainedOnDay(userId: string, day: string, tz: string): Promise<boolean> {
  const recs = await recentEntries(userId, 40);
  return recs.some((e) => e.kind === "training" && todayInTz(tz, String(e.occurred_at)) === day);
}

function asInvite(row: Record<string, unknown>): InviteRow {
  return {
    id: String(row.id),
    phone_e164: String(row.phone_e164),
    chat_id: String(row.chat_id),
    name: row.name == null ? null : String(row.name),
    first_body: String(row.first_body ?? ""),
    status: row.status as InviteRow["status"],
    notified_at: row.notified_at == null ? null : String(row.notified_at),
    decided_at: row.decided_at == null ? null : String(row.decided_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function getInvite(id: string): Promise<InviteRow | undefined> {
  const { data, error } = await getSupabase().from("invites").select("*").eq("id", id).maybeSingle();
  throwIf(error);
  return data ? asInvite(data as Record<string, unknown>) : undefined;
}

export async function getInviteByPhone(phone: string): Promise<InviteRow | undefined> {
  const { data, error } = await getSupabase().from("invites").select("*").eq("phone_e164", phone).maybeSingle();
  throwIf(error);
  return data ? asInvite(data as Record<string, unknown>) : undefined;
}

export async function listPendingInvites(): Promise<InviteRow[]> {
  const { data, error } = await getSupabase()
    .from("invites")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  throwIf(error);
  return (data ?? []).map((r) => asInvite(r as Record<string, unknown>));
}

export async function upsertPendingInvite(input: {
  phone: string;
  chatId: string;
  name: string | null;
  firstBody: string;
}): Promise<InviteRow> {
  const existing = await getInviteByPhone(input.phone);
  const ts = nowIso();
  if (existing) {
    if (existing.status !== "pending") return existing;
    const { data, error } = await getSupabase()
      .from("invites")
      .update({
        chat_id: input.chatId,
        name: input.name ?? existing.name,
        updated_at: ts,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    throwIf(error);
    return asInvite(data as Record<string, unknown>);
  }
  const id = randomUUID();
  const { data, error } = await getSupabase()
    .from("invites")
    .insert({
      id,
      phone_e164: input.phone,
      chat_id: input.chatId,
      name: input.name,
      first_body: input.firstBody.slice(0, 500),
      status: "pending",
      created_at: ts,
      updated_at: ts,
    })
    .select("*")
    .single();
  throwIf(error);
  return asInvite(data as Record<string, unknown>);
}

export async function markInviteNotified(id: string): Promise<void> {
  const ts = nowIso();
  const { error } = await getSupabase().from("invites").update({ notified_at: ts, updated_at: ts }).eq("id", id);
  throwIf(error);
}

export async function decideInvite(id: string, status: "approved" | "denied"): Promise<InviteRow | undefined> {
  const existing = await getInvite(id);
  if (!existing || existing.status !== "pending") return existing;
  const ts = nowIso();
  const { data, error } = await getSupabase()
    .from("invites")
    .update({ status, decided_at: ts, updated_at: ts })
    .eq("id", id)
    .select("*")
    .single();
  throwIf(error);
  return asInvite(data as Record<string, unknown>);
}

export async function isApprovedPhone(phone: string): Promise<boolean> {
  const rec = await getInviteByPhone(phone);
  return rec?.status === "approved";
}
