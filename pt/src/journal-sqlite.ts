import { randomUUID } from "node:crypto";
import { getDb, nowIso, parseJson, todayInTz } from "./db.ts";
import type {
  ChatTurn,
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
} from "./types.ts";

type SqlValue = string | number | bigint | null | Uint8Array;

function row<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

function rows<T>(sql: string, ...params: SqlValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

function run(sql: string, ...params: SqlValue[]) {
  return getDb().prepare(sql).run(...params);
}

export function claimEvent(eventId: string): boolean {
  const info = run(
    "INSERT OR IGNORE INTO webhook_events (event_id, received_at) VALUES (?, ?)",
    eventId,
    nowIso(),
  );
  return Number(info.changes) === 1;
}

export function claimMessage(messageId: string): boolean {
  const info = run(
    "INSERT OR IGNORE INTO processed_messages (linq_message_id, processed_at) VALUES (?, ?)",
    messageId,
    nowIso(),
  );
  return Number(info.changes) === 1;
}

export function releaseEvent(eventId: string): void {
  run("DELETE FROM webhook_events WHERE event_id = ?", eventId);
}

export function releaseMessage(messageId: string): void {
  run("DELETE FROM processed_messages WHERE linq_message_id = ?", messageId);
}

export function getUser(id: string): UserRow | undefined {
  return row<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export function getUserByPhone(phone: string): UserRow | undefined {
  return row<UserRow>("SELECT * FROM users WHERE phone_e164 = ?", phone);
}

export function upsertUser(chatId: string, phone: string | null): UserRow {
  const existing = row<UserRow>("SELECT * FROM users WHERE chat_id = ?", chatId);
  const ts = nowIso();
  if (existing) {
    if (phone && existing.phone_e164 !== phone) {
      run("UPDATE users SET phone_e164 = ?, updated_at = ? WHERE id = ?", phone, ts, existing.id);
      return { ...existing, phone_e164: phone, updated_at: ts };
    }
    return existing;
  }
  const id = randomUUID();
  run(
    `INSERT INTO users (id, chat_id, phone_e164, tz, locale, facts, created_at, updated_at)
     VALUES (?, ?, ?, 'Europe/Oslo', 'nb', '{}', ?, ?)`,
    id,
    chatId,
    phone,
    ts,
    ts,
  );
  return row<UserRow>("SELECT * FROM users WHERE id = ?", id)!;
}

export function factsOf(user: UserRow): UserFacts {
  return parseJson<UserFacts>(user.facts, {});
}

export function pendingOf(user: UserRow): Pending | null {
  return parseJson<Pending | null>(user.pending, null);
}

export function setPending(userId: string, pending: Pending | null): void {
  run("UPDATE users SET pending = ?, updated_at = ? WHERE id = ?", pending ? JSON.stringify(pending) : null, nowIso(), userId);
}

export function setHealth(userId: string, status: string): void {
  run("UPDATE users SET health_status = ?, updated_at = ? WHERE id = ?", status, nowIso(), userId);
}

export function setFacts(userId: string, patch: UserFacts): UserFacts {
  const user = row<UserRow>("SELECT * FROM users WHERE id = ?", userId);
  if (!user) throw new Error("user missing");
  const next = { ...factsOf(user), ...patch };
  run("UPDATE users SET facts = ?, updated_at = ? WHERE id = ?", JSON.stringify(next), nowIso(), userId);
  return next;
}

export function setLocale(userId: string, locale: string): void {
  run("UPDATE users SET locale = ?, updated_at = ? WHERE id = ?", locale, nowIso(), userId);
}

export function setDisplayName(userId: string, name: string | null): void {
  run("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?", name, nowIso(), userId);
}

export function isFreshStart(userId: string): boolean {
  const entries = row<{ n: number }>("SELECT COUNT(*) AS n FROM entries WHERE user_id = ?", userId)?.n ?? 0;
  const notes = row<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE user_id = ?", userId)?.n ?? 0;
  if (entries > 0 || notes > 0) return false;
  return !activeTraining(userId) && !draftTraining(userId);
}

export function touchContactCard(userId: string): void {
  run("UPDATE users SET last_contact_card_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), userId);
}

export function shouldShareContactCard(user: UserRow): boolean {
  if (!user.last_contact_card_at) return true;
  const last = user.last_contact_card_at.slice(0, 10);
  return last !== todayInTz(user.tz);
}

export function getTrack(id: string): TrackRow | undefined {
  return row<TrackRow>("SELECT * FROM tracks WHERE id = ?", id);
}

export function listTracks(userId: string, status?: TrackStatus): TrackRow[] {
  if (status) return rows<TrackRow>("SELECT * FROM tracks WHERE user_id = ? AND status = ? ORDER BY updated_at DESC", userId, status);
  return rows<TrackRow>("SELECT * FROM tracks WHERE user_id = ? ORDER BY updated_at DESC", userId);
}

export function findTrackBySlug(userId: string, slug: string, status?: TrackStatus): TrackRow | undefined {
  if (status) {
    return row<TrackRow>(
      "SELECT * FROM tracks WHERE user_id = ? AND slug = ? AND status = ? ORDER BY version DESC",
      userId,
      slug,
      status,
    );
  }
  return row<TrackRow>(
    "SELECT * FROM tracks WHERE user_id = ? AND slug = ? AND status != 'archived' ORDER BY version DESC",
    userId,
    slug,
  );
}

export function activeTraining(userId: string): TrackRow | undefined {
  return row<TrackRow>(
    "SELECT * FROM tracks WHERE user_id = ? AND kind = 'training' AND status = 'active'",
    userId,
  );
}

export function draftTraining(userId: string): TrackRow | undefined {
  return row<TrackRow>(
    "SELECT * FROM tracks WHERE user_id = ? AND kind = 'training' AND status = 'draft' ORDER BY updated_at DESC",
    userId,
  );
}

export function createTrack(input: {
  userId: string;
  kind: TrackKind;
  slug: string;
  name: string;
  tags?: string[];
  status?: TrackStatus;
  plan?: Plan | null;
}): TrackRow {
  const existingMax = row<{ v: number }>(
    "SELECT COALESCE(MAX(version), 0) AS v FROM tracks WHERE user_id = ? AND slug = ?",
    input.userId,
    input.slug,
  );
  const version = (existingMax?.v ?? 0) + 1;
  const id = randomUUID();
  const ts = nowIso();
  run(
    `INSERT INTO tracks (id, user_id, kind, slug, name, tags, status, plan, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.userId,
    input.kind,
    input.slug,
    input.name,
    JSON.stringify(input.tags ?? []),
    input.status ?? "active",
    input.plan ? JSON.stringify(input.plan) : null,
    version,
    ts,
    ts,
  );
  return getTrack(id)!;
}

export function ensureTrack(input: {
  userId: string;
  kind: TrackKind;
  slug: string;
  name: string;
  tags?: string[];
}): TrackRow {
  return (
    findTrackBySlug(input.userId, input.slug, "active") ||
    findTrackBySlug(input.userId, input.slug, "draft") ||
    createTrack({ ...input, status: input.kind === "training" ? "draft" : "active" })
  );
}

export function setPlan(trackId: string, plan: Plan): TrackRow {
  run("UPDATE tracks SET plan = ?, status = 'draft', updated_at = ? WHERE id = ?", JSON.stringify(plan), nowIso(), trackId);
  return getTrack(trackId)!;
}

export function planOf(track: TrackRow): Plan | null {
  return parseJson<Plan | null>(track.plan, null);
}

export function activateTrack(trackId: string): TrackRow {
  const track = getTrack(trackId);
  if (!track) throw new Error("track missing");
  if (track.status === "archived") throw new Error("cannot activate archived track");
  if (track.kind === "training") {
    const current = activeTraining(track.user_id);
    if (current && current.id !== trackId) {
      throw new Error("active training exists — archive it first");
    }
  }
  run("UPDATE tracks SET status = 'active', updated_at = ? WHERE id = ?", nowIso(), trackId);
  return getTrack(trackId)!;
}

export function archiveTrack(trackId: string, reason: string): TrackRow {
  const ts = nowIso();
  run(
    "UPDATE tracks SET status = 'archived', archive_reason = ?, archived_at = ?, updated_at = ? WHERE id = ?",
    reason,
    ts,
    ts,
    trackId,
  );
  return getTrack(trackId)!;
}

export function entryCount(trackId: string): number {
  return (
    row<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entries WHERE track_id = ? AND archived_at IS NULL",
      trackId,
    )?.n ?? 0
  );
}

export function noteCount(trackId: string): number {
  return (row<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE track_id = ?", trackId)?.n ?? 0);
}

export function logEntry(input: {
  trackId: string;
  userId: string;
  quantity?: Quantity | null;
  quality?: string | null;
  note?: string | null;
  sessionRef?: string | null;
  source: "heuristic" | "llm" | "user";
  linqMessageId?: string | null;
  occurredAt?: string;
}): { id: string; duplicate: boolean } {
  const id = randomUUID();
  try {
    run(
      `INSERT INTO entries (id, track_id, user_id, occurred_at, quantity, quality, note, session_ref, source, linq_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.trackId,
      input.userId,
      input.occurredAt ?? nowIso(),
      input.quantity ? JSON.stringify(input.quantity) : null,
      input.quality ?? null,
      input.note ?? null,
      input.sessionRef ?? null,
      input.source,
      input.linqMessageId ?? null,
      nowIso(),
    );
    return { id, duplicate: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (input.linqMessageId && /UNIQUE/i.test(msg)) return { id: "", duplicate: true };
    throw err;
  }
}

export function patchEntry(
  entryId: string,
  patch: { quality?: string | null; note?: string | null },
): boolean {
  const sets: string[] = [];
  const args: SqlValue[] = [];
  if ("quality" in patch) {
    sets.push("quality = ?");
    args.push(patch.quality ?? null);
  }
  if ("note" in patch) {
    sets.push("note = ?");
    args.push(patch.note ?? null);
  }
  if (!sets.length) return false;
  args.push(entryId);
  const info = run(
    `UPDATE entries SET ${sets.join(", ")} WHERE id = ? AND archived_at IS NULL`,
    ...args,
  );
  return Number(info.changes) > 0;
}

export type ArchivedEntry = {
  id: string;
  slug: string;
  name: string;
  kind: TrackKind;
  occurred_at: string;
  quantity: string | null;
  quality: string | null;
  note: string | null;
  session_ref: string | null;
  alreadyArchived?: boolean;
};

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

function entryLookup(id: string): EntryLookup | undefined {
  return row<EntryLookup>(
    `SELECT e.id, e.user_id, e.archived_at, e.occurred_at, e.quantity, e.quality, e.note, e.session_ref,
            t.slug, t.name, t.kind
     FROM entries e JOIN tracks t ON t.id = e.track_id
     WHERE e.id = ?`,
    id,
  );
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

export function archiveEntry(input: {
  userId: string;
  entryId?: string;
  slug?: string;
  trackKind?: TrackKind;
  reason?: string;
}): ArchivedEntry | null {
  let rec: EntryLookup | undefined;
  if (input.entryId) {
    rec = entryLookup(input.entryId);
    if (!rec || rec.user_id !== input.userId) return null;
    if (rec.archived_at) return toArchived(rec, true);
  } else {
    const slug = input.slug?.trim() || null;
    const kind = input.trackKind ?? null;
    rec = row<EntryLookup>(
      `SELECT e.id, e.user_id, e.archived_at, e.occurred_at, e.quantity, e.quality, e.note, e.session_ref,
              t.slug, t.name, t.kind
       FROM entries e JOIN tracks t ON t.id = e.track_id
       WHERE e.user_id = ? AND e.archived_at IS NULL
         AND (? IS NULL OR t.slug = ?)
         AND (? IS NULL OR t.kind = ?)
       ORDER BY e.occurred_at DESC, e.created_at DESC
       LIMIT 1`,
      input.userId,
      slug,
      slug,
      kind,
      kind,
    );
    if (!rec) return null;
  }
  const ts = nowIso();
  run(
    "UPDATE entries SET archived_at = ?, archive_reason = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL",
    ts,
    input.reason ?? "user_requested",
    rec.id,
    input.userId,
  );
  const updated = entryLookup(rec.id);
  return updated ? toArchived(updated) : null;
}

export function addNote(input: { userId: string; trackId?: string | null; kind: string; body: string }): string {
  const id = randomUUID();
  run(
    "INSERT INTO notes (id, user_id, track_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    input.userId,
    input.trackId ?? null,
    input.kind,
    input.body,
    nowIso(),
  );
  return id;
}

export function recentEntries(userId: string, limit = 8): Record<string, unknown>[] {
  return rows(
    `SELECT e.id, e.occurred_at, e.quantity, e.quality, e.note, e.session_ref, t.slug, t.name, t.kind
     FROM entries e JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = ? AND e.archived_at IS NULL
     ORDER BY e.occurred_at DESC LIMIT ?`,
    userId,
    limit,
  );
}

export function recentNotes(userId: string, limit = 5): { kind: string; body: string; created_at: string }[] {
  return rows("SELECT kind, body, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", userId, limit);
}

const MAX_LOG_CHARS = 800;
const MAX_LOG_ROWS = 100;

export function logMessage(
  userId: string,
  role: "user" | "pt",
  body: string,
  linqMessageId?: string | null,
): void {
  const trimmed = body.trim().slice(0, MAX_LOG_CHARS);
  if (!trimmed) return;
  run(
    `INSERT INTO message_log (id, user_id, role, body, linq_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    userId,
    role,
    trimmed,
    linqMessageId ?? null,
    nowIso(),
  );
  run(
    `DELETE FROM message_log WHERE user_id = ? AND id IN (
       SELECT id FROM (
         SELECT id FROM message_log WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )
     )`,
    userId,
    userId,
    MAX_LOG_ROWS,
  );
}

export function recentChat(userId: string, limit = 8, excludeLinqMessageId?: string | null): ChatTurn[] {
  const list = rows<ChatTurn>(
    `SELECT role, body, linq_message_id, created_at FROM message_log
     WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    userId,
    excludeLinqMessageId ? limit + 4 : limit,
  );
  const chronological = list.reverse();
  if (!excludeLinqMessageId) return chronological.slice(-limit);
  return chronological
    .filter((m) => !(m.role === "user" && m.linq_message_id === excludeLinqMessageId))
    .slice(-limit);
}

/** Look further back in the rolling chat log. Optional substring filter (case-insensitive). */
export function recallChat(
  userId: string,
  opts: { limit?: number; contains?: string } = {},
): ChatTurn[] {
  const limit = Math.min(40, Math.max(1, opts.limit ?? 20));
  const terms = (opts.contains ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const recent = recentChat(userId, limit);
  if (terms.length === 0) return recent;

  const list = rows<ChatTurn>(
    `SELECT role, body, linq_message_id, created_at FROM message_log
     WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`,
    userId,
  );
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

export function lastRpeForLoadKey(userId: string, loadKey: string): string | null {
  const rec = row<{ quality: string }>(
    `SELECT e.quality FROM entries e
     JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = ? AND e.session_ref LIKE ? AND e.archived_at IS NULL
       AND e.quality IS NOT NULL AND e.quality != 'hoppet'
     ORDER BY e.occurred_at DESC LIMIT 1`,
    userId,
    `%${loadKey}%`,
  );
  return rec?.quality ?? null;
}

const RPE_MULT: Record<string, number> = { lett: 1.08, passe: 1, brutalt: 0.9 };

export function nextSession(userId: string, track: TrackRow): { session: PlanSession; load: number | null; adapt: "lett" | "brutalt" | null } | null {
  const plan = planOf(track);
  if (!plan?.sessions?.length) return null;
  const done = new Set(
    rows<{ session_ref: string }>(
      "SELECT session_ref FROM entries WHERE track_id = ? AND archived_at IS NULL AND session_ref IS NOT NULL AND quality != 'hoppet'",
      track.id,
    )
      .map((r) => r.session_ref)
      .filter(Boolean),
  );
  const session = plan.sessions.find((s) => !done.has(s.id)) ?? null;
  if (!session) return null;
  let load = session.load ?? null;
  let adapt: "lett" | "brutalt" | null = null;
  if (load != null && session.loadKey) {
    const prev = lastRpeForLoadKey(userId, session.loadKey);
    const m = prev ? RPE_MULT[prev] : null;
    if (m && m !== 1) {
      const unit = session.unit === "km" ? Math.round(load * m * 2) / 2 : Math.round(load * m);
      if (unit !== load) {
        load = unit;
        adapt = prev === "lett" ? "lett" : "brutalt";
      }
    }
  }
  return { session, load, adapt };
}

export function snapshot(user: UserRow) {
  const tracks = listTracks(user.id).filter((t) => t.status !== "archived");
  const training = activeTraining(user.id);
  const draft = draftTraining(user.id);
  const today = training ? nextSession(user.id, training) : null;
  return {
    facts: factsOf(user),
    pending: pendingOf(user),
    tracks: tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      slug: t.slug,
      name: t.name,
      status: t.status,
      version: t.version,
      hasPlan: Boolean(t.plan),
      entries: entryCount(t.id),
    })),
    activeTraining: training
      ? { id: training.id, name: training.name, version: training.version }
      : null,
    draftTraining: draft ? { id: draft.id, name: draft.name, version: draft.version } : null,
    today: today
      ? {
          id: today.session.id,
          title: today.session.title,
          load: today.load,
          unit: today.session.unit,
          items: (today.session.items ?? []).slice(0, 6),
          est: today.session.est,
          adapt: today.adapt,
        }
      : null,
    recentEntries: recentEntries(user.id, 8),
    recentNotes: recentNotes(user.id, 8),
    recentChat: recentChat(user.id, 24),
    reminders: listReminders(user.id).filter((r) => r.enabled === 1).map((r) => ({
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

export function upsertReminder(
  userId: string,
  kind: ReminderKind,
  hour: number,
  minute: number,
  opts?: { onceOn?: string | null; url?: string | null },
): ReminderRow {
  const h = Math.min(23, Math.max(0, Math.round(hour)));
  const m = Math.min(59, Math.max(0, Math.round(minute)));
  const onceOn = opts?.onceOn === undefined ? null : opts.onceOn;
  const url = opts && "url" in opts ? (opts.url ?? null) : undefined;
  const existing = row<ReminderRow>("SELECT * FROM reminders WHERE user_id = ? AND kind = ?", userId, kind);
  const ts = nowIso();
  if (existing) {
    if (url !== undefined) {
      run(
        "UPDATE reminders SET hour = ?, minute = ?, enabled = 1, once_on = ?, url = ?, updated_at = ? WHERE id = ?",
        h,
        m,
        onceOn,
        url,
        ts,
        existing.id,
      );
    } else {
      run(
        "UPDATE reminders SET hour = ?, minute = ?, enabled = 1, once_on = ?, updated_at = ? WHERE id = ?",
        h,
        m,
        onceOn,
        ts,
        existing.id,
      );
    }
    return getReminder(existing.id)!;
  }
  const id = randomUUID();
  run(
    `INSERT INTO reminders (id, user_id, kind, hour, minute, enabled, once_on, url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    id,
    userId,
    kind,
    h,
    m,
    onceOn,
    url ?? null,
    ts,
    ts,
  );
  return getReminder(id)!;
}

export function getReminder(id: string): ReminderRow | undefined {
  return row<ReminderRow>("SELECT * FROM reminders WHERE id = ?", id);
}

export function listReminders(userId: string): ReminderRow[] {
  return rows<ReminderRow>("SELECT * FROM reminders WHERE user_id = ? ORDER BY hour, minute", userId);
}

export function disableReminder(userId: string, kind: ReminderKind = "train"): ReminderRow | undefined {
  const existing = row<ReminderRow>("SELECT * FROM reminders WHERE user_id = ? AND kind = ?", userId, kind);
  if (!existing) return undefined;
  run("UPDATE reminders SET enabled = 0, updated_at = ? WHERE id = ?", nowIso(), existing.id);
  return getReminder(existing.id);
}

export function markReminderFired(id: string, day: string): void {
  const existing = getReminder(id);
  if (existing?.once_on) {
    run(
      "UPDATE reminders SET last_fired_on = ?, enabled = 0, updated_at = ? WHERE id = ?",
      day,
      nowIso(),
      id,
    );
    return;
  }
  run("UPDATE reminders SET last_fired_on = ?, updated_at = ? WHERE id = ?", day, nowIso(), id);
}

export function listEnabledReminders(): ReminderRow[] {
  return rows<ReminderRow>("SELECT * FROM reminders WHERE enabled = 1");
}

export function trainedOnDay(userId: string, day: string, tz: string): boolean {
  const recs = recentEntries(userId, 40);
  return recs.some((e) => e.kind === "training" && todayInTz(tz, String(e.occurred_at)) === day);
}

export function getInvite(id: string): InviteRow | undefined {
  return row<InviteRow>("SELECT * FROM invites WHERE id = ?", id);
}

export function getInviteByPhone(phone: string): InviteRow | undefined {
  return row<InviteRow>("SELECT * FROM invites WHERE phone_e164 = ?", phone);
}

export function listPendingInvites(): InviteRow[] {
  return rows<InviteRow>("SELECT * FROM invites WHERE status = 'pending' ORDER BY created_at ASC");
}

export function upsertPendingInvite(input: {
  phone: string;
  chatId: string;
  name: string | null;
  firstBody: string;
}): InviteRow {
  const existing = getInviteByPhone(input.phone);
  const ts = nowIso();
  if (existing) {
    if (existing.status !== "pending") return existing;
    run(
      "UPDATE invites SET chat_id = ?, name = COALESCE(?, name), updated_at = ? WHERE id = ?",
      input.chatId,
      input.name,
      ts,
      existing.id,
    );
    return getInvite(existing.id)!;
  }
  const id = randomUUID();
  run(
    `INSERT INTO invites (id, phone_e164, chat_id, name, first_body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id,
    input.phone,
    input.chatId,
    input.name,
    input.firstBody.slice(0, 500),
    ts,
    ts,
  );
  return getInvite(id)!;
}

export function markInviteNotified(id: string): void {
  run("UPDATE invites SET notified_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), id);
}

export function decideInvite(id: string, status: "approved" | "denied"): InviteRow | undefined {
  const existing = getInvite(id);
  if (!existing || existing.status !== "pending") return existing;
  const ts = nowIso();
  run("UPDATE invites SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?", status, ts, ts, id);
  return getInvite(id);
}

export function isApprovedPhone(phone: string): boolean {
  const rec = getInviteByPhone(phone);
  return rec?.status === "approved";
}
