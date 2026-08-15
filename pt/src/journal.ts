import { journalBackend } from "./db.ts";
import * as sqlite from "./journal-sqlite.ts";
import * as supabase from "./journal-supabase.ts";
import { missingForPlan, readyForPlan } from "./plan-facts.ts";
import type {
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

export type { ArchivedEntry } from "./journal-sqlite.ts";

type Backend = typeof sqlite | typeof supabase;

function api(): Backend {
  return journalBackend() === "supabase" ? supabase : sqlite;
}

function asAsync<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value);
}

export function factsOf(user: UserRow): UserFacts {
  return api().factsOf(user);
}

export function pendingOf(user: UserRow): Pending | null {
  return api().pendingOf(user);
}

export function planOf(track: TrackRow): Plan | null {
  return api().planOf(track);
}

export function shouldShareContactCard(user: UserRow): boolean {
  return api().shouldShareContactCard(user);
}

export function hhmm(hour: number, minute: number): string {
  return api().hhmm(hour, minute);
}

export async function claimEvent(eventId: string): Promise<boolean> {
  return asAsync(api().claimEvent(eventId));
}

export async function claimMessage(messageId: string): Promise<boolean> {
  return asAsync(api().claimMessage(messageId));
}

export async function releaseEvent(eventId: string): Promise<void> {
  return asAsync(api().releaseEvent(eventId));
}

export async function releaseMessage(messageId: string): Promise<void> {
  return asAsync(api().releaseMessage(messageId));
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  return asAsync(api().getUser(id));
}

export async function upsertUser(chatId: string, phone: string | null): Promise<UserRow> {
  return asAsync(api().upsertUser(chatId, phone));
}

export async function setPending(userId: string, pending: Pending | null): Promise<void> {
  return asAsync(api().setPending(userId, pending));
}

export async function setHealth(userId: string, status: string): Promise<void> {
  return asAsync(api().setHealth(userId, status));
}

export async function setFacts(userId: string, patch: UserFacts): Promise<UserFacts> {
  return asAsync(api().setFacts(userId, patch));
}

export async function setLocale(userId: string, locale: string): Promise<void> {
  return asAsync(api().setLocale(userId, locale));
}

export async function isFreshStart(userId: string): Promise<boolean> {
  return asAsync(api().isFreshStart(userId));
}

export async function touchContactCard(userId: string): Promise<void> {
  return asAsync(api().touchContactCard(userId));
}

export async function getTrack(id: string): Promise<TrackRow | undefined> {
  return asAsync(api().getTrack(id));
}

export async function listTracks(userId: string, status?: TrackStatus): Promise<TrackRow[]> {
  return asAsync(api().listTracks(userId, status));
}

export async function findTrackBySlug(
  userId: string,
  slug: string,
  status?: TrackStatus,
): Promise<TrackRow | undefined> {
  return asAsync(api().findTrackBySlug(userId, slug, status));
}

export async function activeTraining(userId: string): Promise<TrackRow | undefined> {
  return asAsync(api().activeTraining(userId));
}

export async function draftTraining(userId: string): Promise<TrackRow | undefined> {
  return asAsync(api().draftTraining(userId));
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
  return asAsync(api().createTrack(input));
}

export async function ensureTrack(input: {
  userId: string;
  kind: TrackKind;
  slug: string;
  name: string;
  tags?: string[];
}): Promise<TrackRow> {
  return asAsync(api().ensureTrack(input));
}

export async function setPlan(trackId: string, plan: Plan): Promise<TrackRow> {
  return asAsync(api().setPlan(trackId, plan));
}

export async function activateTrack(trackId: string): Promise<TrackRow> {
  return asAsync(api().activateTrack(trackId));
}

export async function archiveTrack(trackId: string, reason: string): Promise<TrackRow> {
  return asAsync(api().archiveTrack(trackId, reason));
}

export async function entryCount(trackId: string): Promise<number> {
  return asAsync(api().entryCount(trackId));
}

export async function noteCount(trackId: string): Promise<number> {
  return asAsync(api().noteCount(trackId));
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
  return asAsync(api().logEntry(input));
}

export async function archiveEntry(input: {
  userId: string;
  entryId?: string;
  slug?: string;
  trackKind?: TrackKind;
  reason?: string;
}): Promise<sqlite.ArchivedEntry | null> {
  return asAsync(api().archiveEntry(input));
}

export async function addNote(input: {
  userId: string;
  trackId?: string | null;
  kind: string;
  body: string;
}): Promise<string> {
  return asAsync(api().addNote(input));
}

export async function recentEntries(userId: string, limit = 8): Promise<Record<string, unknown>[]> {
  return asAsync(api().recentEntries(userId, limit));
}

export async function recentNotes(
  userId: string,
  limit = 5,
): Promise<{ kind: string; body: string; created_at: string }[]> {
  return asAsync(api().recentNotes(userId, limit));
}

export async function logMessage(
  userId: string,
  role: "user" | "pt",
  body: string,
  linqMessageId?: string | null,
): Promise<void> {
  return asAsync(api().logMessage(userId, role, body, linqMessageId));
}

export async function recentChat(
  userId: string,
  limit = 8,
  excludeLinqMessageId?: string | null,
): Promise<import("./types.ts").ChatTurn[]> {
  return asAsync(api().recentChat(userId, limit, excludeLinqMessageId));
}

export async function recallChat(
  userId: string,
  opts: { limit?: number; contains?: string } = {},
): Promise<import("./types.ts").ChatTurn[]> {
  return asAsync(api().recallChat(userId, opts));
}

export async function lastRpeForLoadKey(userId: string, loadKey: string): Promise<string | null> {
  return asAsync(api().lastRpeForLoadKey(userId, loadKey));
}

export async function nextSession(
  userId: string,
  track: TrackRow,
): Promise<{ session: PlanSession; load: number | null; adapt: "lett" | "brutalt" | null } | null> {
  return asAsync(api().nextSession(userId, track));
}

export async function snapshot(user: UserRow) {
  const snap = await asAsync(api().snapshot(user));
  const facts = factsOf(user);
  return {
    ...snap,
    missingForPlan: missingForPlan(facts),
    readyForPlan: readyForPlan(facts),
  };
}

export async function upsertReminder(
  userId: string,
  kind: ReminderKind,
  hour: number,
  minute: number,
): Promise<ReminderRow> {
  return asAsync(api().upsertReminder(userId, kind, hour, minute));
}

export async function getReminder(id: string): Promise<ReminderRow | undefined> {
  return asAsync(api().getReminder(id));
}

export async function listReminders(userId: string): Promise<ReminderRow[]> {
  return asAsync(api().listReminders(userId));
}

export async function disableReminder(
  userId: string,
  kind: ReminderKind = "train",
): Promise<ReminderRow | undefined> {
  return asAsync(api().disableReminder(userId, kind));
}

export async function markReminderFired(id: string, day: string): Promise<void> {
  return asAsync(api().markReminderFired(id, day));
}

export async function listEnabledReminders(): Promise<ReminderRow[]> {
  return asAsync(api().listEnabledReminders());
}

export async function trainedOnDay(userId: string, day: string, tz: string): Promise<boolean> {
  return asAsync(api().trainedOnDay(userId, day, tz));
}
