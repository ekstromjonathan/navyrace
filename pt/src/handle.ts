import { env, isAllowlisted } from "./env.ts";
import { parseMessage } from "./parser.ts";
import { isOptOut } from "./optout.ts";
import {
  isActivatePhrase,
  isActivateCancel,
  isArchivePhrase,
  isReminderDailyReply,
  isReminderOnceReply,
  isReminderScopeCancel,
  parseLogDayReply,
} from "./gates.ts";
import { extractApplicantName, isInviteNo, isInviteYes } from "./invite.ts";
import { runAgent } from "./agent.ts";
import * as journal from "./journal.ts";
import * as copy from "./copy.ts";
import * as linq from "./linq.ts";
import { normalizeEvent } from "./webhook.ts";
import { detectLang, isLang, type Lang } from "./locale.ts";
import { addLocalDays, dayAnchorIso, resolveOnceOn, todayInTz } from "./db.ts";
import type { Inbound, InviteRow, UserRow } from "./types.ts";

async function lockLang(user: UserRow, body: string): Promise<{ user: UserRow; lang: Lang; onboarding: boolean }> {
  const facts = journal.factsOf(user);
  const onboarding = await journal.isFreshStart(user.id);
  const locked = isLang(facts.uiLang) ? facts.uiLang : null;
  const detected = detectLang(body);
  const lang = locked ?? detected ?? "nb";
  if (!locked && detected) {
    await journal.setFacts(user.id, { uiLang: detected });
    await journal.setLocale(user.id, detected);
    user = { ...user, locale: detected };
  }
  return { user, lang, onboarding };
}

async function reply(
  chatId: string,
  text: string,
  opts?: { overrideOptout?: boolean; replyTo?: string; userId?: string },
) {
  const clipped = text.trim().slice(0, 1200);
  if (!clipped) return;
  try {
    await linq.sendText(chatId, clipped, opts);
  } catch (err) {
    if (linq.isOptOutRejected(err)) return;
    throw err;
  }
  if (opts?.userId) await journal.logMessage(opts.userId, "pt", clipped);
}

async function withTyping(chatId: string, fn: () => Promise<string>): Promise<string> {
  await linq.startTyping(chatId);
  try {
    return await fn();
  } finally {
    await linq.stopTyping(chatId);
  }
}

async function maybeCard(user: UserRow, chatId: string) {
  if (!journal.shouldShareContactCard(user)) return;
  try {
    await linq.shareContactCard(chatId);
    await journal.touchContactCard(user.id);
  } catch {
    /* share is best-effort; card may be unconfigured */
  }
}

function canonPhone(phone: string): string {
  return phone.replace(/\s+/g, "");
}

async function isAdmitted(phone: string | null): Promise<boolean> {
  if (!phone) return false;
  if (isAllowlisted(phone)) return true;
  return journal.isApprovedPhone(canonPhone(phone));
}

async function ownerUser(): Promise<UserRow | undefined> {
  for (const n of env.allowlist) {
    const u = await journal.getUserByPhone(n);
    if (u) return u;
  }
  return undefined;
}

function ownerLang(user: UserRow): Lang {
  const raw = journal.factsOf(user).uiLang;
  return isLang(raw) ? raw : isLang(user.locale) ? user.locale : "nb";
}

async function admitGuest(invite: InviteRow): Promise<void> {
  const decided = await journal.decideInvite(invite.id, "approved");
  if (!decided || decided.status !== "approved") return;
  const guest = await journal.upsertUser(invite.chat_id, invite.phone_e164);
  if (invite.name) await journal.setDisplayName(guest.id, invite.name);
  const lang = detectLang(invite.first_body) ?? "nb";
  await journal.setFacts(guest.id, { uiLang: lang });
  await journal.setLocale(guest.id, lang);
  if (invite.first_body.trim()) {
    await journal.logMessage(guest.id, "user", invite.first_body);
  }
  await reply(invite.chat_id, copy.inviteWelcome(lang, invite.name, env.coachName), { userId: guest.id });
  const fresh = (await journal.getUser(guest.id)) ?? guest;
  await maybeCard(fresh, invite.chat_id);
}

async function nextInviteAsk(owner: UserRow, lang: Lang): Promise<string | null> {
  const next = (await journal.listPendingInvites())[0];
  if (!next) {
    await journal.setPending(owner.id, null);
    return null;
  }
  await journal.setPending(owner.id, {
    type: "invite_approve",
    inviteId: next.id,
    askedAt: new Date().toISOString(),
  });
  await journal.markInviteNotified(next.id);
  return copy.inviteAsk(lang, next.name, next.phone_e164);
}

async function resolveOwnerInvite(owner: UserRow, lang: Lang, body: string): Promise<string | null> {
  if (!isInviteYes(body) && !isInviteNo(body)) return null;
  const pending = journal.pendingOf(owner);
  let invite: InviteRow | undefined;
  if (pending?.type === "invite_approve") {
    invite = await journal.getInvite(pending.inviteId);
  }
  if (!invite || invite.status !== "pending") {
    invite = (await journal.listPendingInvites())[0];
  }
  if (!invite || invite.status !== "pending") {
    if (pending?.type === "invite_approve") await journal.setPending(owner.id, null);
    return null;
  }
  if (isInviteNo(body)) {
    await journal.decideInvite(invite.id, "denied");
    const confirm = copy.inviteDenied(lang, invite.name, invite.phone_e164);
    const follow = await nextInviteAsk(owner, lang);
    return follow ? `${confirm}\n\n${follow}` : confirm;
  }
  await admitGuest(invite);
  const confirm = copy.inviteApproved(lang, invite.name, invite.phone_e164);
  const follow = await nextInviteAsk(owner, lang);
  return follow ? `${confirm}\n\n${follow}` : confirm;
}

async function handleUnknownSender(inbound: Inbound): Promise<void> {
  if (!inbound.phone || isOptOut(inbound.body)) return;
  const phone = canonPhone(inbound.phone);
  const existing = await journal.getInviteByPhone(phone);
  if (existing?.status === "denied") return;
  const invite = await journal.upsertPendingInvite({
    phone,
    chatId: inbound.chatId,
    name: extractApplicantName(inbound.body),
    firstBody: inbound.body,
  });
  if (invite.status !== "pending") return;

  const owner = await ownerUser();
  if (!owner) {
    console.error("invite waiting but owner chat is missing", invite.id, phone);
    return;
  }
  const ownerPending = journal.pendingOf(owner);
  if (ownerPending?.type === "invite_approve") {
    const current = await journal.getInvite(ownerPending.inviteId);
    if (current?.status === "pending") return;
  }
  if (invite.notified_at) return;
  const ask = copy.inviteAsk(ownerLang(owner), invite.name, invite.phone_e164);
  await reply(owner.chat_id, ask, { userId: owner.id });
  await journal.setPending(owner.id, {
    type: "invite_approve",
    inviteId: invite.id,
    askedAt: new Date().toISOString(),
  });
  await journal.markInviteNotified(invite.id);
}

function dayLabel(lang: Lang, day: "today" | "yesterday"): string {
  if (lang === "en") return day === "today" ? "today" : "yesterday";
  if (lang === "sv") return day === "today" ? "idag" : "igår";
  return day === "today" ? "i dag" : "i går";
}

function shortSessionTitle(note: string): string {
  const one = note.replace(/\s+/g, " ").trim();
  return one.length <= 72 ? one : `${one.slice(0, 69)}…`;
}

async function commitSessionLog(
  user: UserRow,
  lang: Lang,
  opts: {
    day: "today" | "yesterday";
    note: string;
    quality: string | null;
    claimsPlanned: boolean;
    messageId?: string;
  },
): Promise<string> {
  const training = await journal.activeTraining(user.id);
  if (!training) return copy.sessionNoPlan(lang);

  const today = todayInTz(user.tz);
  const dayYmd = opts.day === "today" ? today : addLocalDays(today, -1);
  const next = await journal.nextSession(user.id, training);
  const planned = Boolean(opts.claimsPlanned && next);
  const sessionRef = planned
    ? next!.session.id
    : opts.claimsPlanned
      ? null
      : `extra:${dayYmd}`;
  const title = planned ? next!.session.title : shortSessionTitle(opts.note);

  const result = await journal.logEntry({
    trackId: training.id,
    userId: user.id,
    quality: opts.quality,
    note: opts.note,
    sessionRef,
    source: "heuristic",
    linqMessageId: opts.messageId ?? null,
    occurredAt: dayAnchorIso(dayYmd),
  });
  if (result.duplicate) return copy.duplicateLog(lang);

  const askRpe = !opts.quality;
  if (askRpe && result.id) {
    await journal.setPending(user.id, {
      type: "rpe_followup",
      entryId: result.id,
      askedAt: new Date().toISOString(),
    });
  } else {
    await journal.setPending(user.id, null);
  }

  return copy.sessionLogged(lang, {
    title,
    dayLabel: dayLabel(lang, opts.day),
    planned,
    askRpe,
  });
}

async function handlePending(user: UserRow, lang: Lang, body: string): Promise<string | null> {
  const pending = journal.pendingOf(user);
  if (!pending) return null;

  if (pending.type === "activate_confirm") {
    if (isActivatePhrase(body)) {
      try {
        await journal.activateTrack(pending.trackId);
        await journal.setPending(user.id, null);
        const today = await formatToday(user, lang);
        return `${copy.activated(lang)}\n\n${today}`;
      } catch (e) {
        await journal.setPending(user.id, null);
        return copy.activateFailed(lang, e instanceof Error ? e.message : "");
      }
    }
    // Soft cancel only — questions like “more details?” must not kill the draft.
    if (isActivateCancel(body)) {
      await journal.setPending(user.id, null);
      return copy.activateCancelled(lang);
    }
    return null;
  }

  if (pending.type === "archive_confirm") {
    if (isArchivePhrase(body)) {
      await journal.archiveTrack(pending.trackId, "user_requested_new");
      await journal.setPending(user.id, null);
      return copy.archived(lang);
    }
    await journal.setPending(user.id, null);
    if (parseMessage(body).kind === "unknown") {
      return copy.archiveCancelled(lang);
    }
    return null;
  }

  if (pending.type === "question") {
    await journal.setFacts(user.id, { [pending.field]: body.trim() });
    await journal.setPending(user.id, null);
    return copy.savedField(lang, pending.field);
  }

  if (pending.type === "video_reminder_time") {
    if (isReminderScopeCancel(body) || isActivateCancel(body)) {
      await journal.setPending(user.id, null);
      return copy.reminderScopeCancelled(lang);
    }
    const parsed = parseMessage(body);
    if (parsed.kind === "reminder_set") {
      await journal.setPending(user.id, null);
      return commitReminderSet(user, lang, parsed.hour, parsed.minute, parsed.scope, pending.url);
    }
    return copy.videoLinkAsk(lang);
  }

  if (pending.type === "reminder_scope") {
    // Legacy pending from older ask-flow: soft resolve, no magic phrase.
    if (isReminderScopeCancel(body)) {
      await journal.setPending(user.id, null);
      return copy.reminderScopeCancelled(lang);
    }
    if (isReminderDailyReply(body)) {
      await journal.upsertReminder(user.id, "train", pending.hour, pending.minute, { onceOn: null });
      await journal.setPending(user.id, null);
      return copy.reminderConfirm(lang, pending.hour, pending.minute, user.tz);
    }
    if (isReminderOnceReply(body) || isActivatePhrase(body)) {
      const onceOn = resolveOnceOn(user.tz, pending.hour, pending.minute);
      await journal.upsertReminder(user.id, "train", pending.hour, pending.minute, { onceOn });
      await journal.setPending(user.id, null);
      return copy.reminderConfirmOnce(lang, pending.hour, pending.minute, onceOn, user.tz);
    }
    await journal.setPending(user.id, null);
    return null;
  }

  if (pending.type === "log_day") {
    if (isReminderScopeCancel(body) || isActivateCancel(body)) {
      await journal.setPending(user.id, null);
      return copy.sessionDayCancelled(lang);
    }
    const day = parseLogDayReply(body);
    if (!day) return copy.sessionDayAsk(lang);
    return commitSessionLog(user, lang, {
      day,
      note: pending.note,
      quality: pending.quality,
      claimsPlanned: pending.claimsPlanned,
    });
  }

  if (pending.type === "rpe_followup") {
    const parsed = parseMessage(body);
    if (parsed.kind === "rpe") {
      await journal.patchEntry(pending.entryId, { quality: parsed.quality });
      await journal.setPending(user.id, null);
      return copy.rpeLogged(lang, parsed.quality);
    }
    if (isReminderScopeCancel(body) || isActivateCancel(body)) {
      await journal.setPending(user.id, null);
      return copy.sessionDayCancelled(lang);
    }
    // Another clear intent → clear sticky RPE wait and let heuristics/agent handle.
    if (parsed.confident) {
      await journal.setPending(user.id, null);
      return null;
    }
    return lang === "en"
      ? "Still need how hard it felt: easy / about right / brutal."
      : lang === "sv"
        ? "Behöver fortfarande insats: lätt / lagom / brutalt."
        : "Trenger fortsatt innsats: lett / passe / brutalt.";
  }

  return null;
}

async function formatToday(user: UserRow, lang: Lang): Promise<string> {
  const training = await journal.activeTraining(user.id);
  if (!training) {
    const draft = await journal.draftTraining(user.id);
    if (draft) return copy.todayDraft(lang, draft.name);
    return copy.todayNoPlan(lang);
  }
  const next = await journal.nextSession(user.id, training);
  if (!next) return copy.todayDone(lang, training.name);
  const items = (next.session.items ?? []).slice(0, 5).map((it) => `• ${it.name}${it.detail ? ` — ${it.detail}` : ""}`);
  const load = next.load != null ? `${next.load}${next.session.unit ? ` ${next.session.unit}` : ""}` : "";
  const heading =
    lang === "en"
      ? `Today: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`
      : lang === "sv"
        ? `Idag: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`
        : `I dag: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`;
  return [
    heading,
    ...items,
    next.adapt ? copy.adaptNote(lang, next.adapt) : null,
    copy.todayFooter(lang),
  ]
    .filter(Boolean)
    .join("\n");
}

async function commitReminderSet(
  user: UserRow,
  lang: Lang,
  hour: number,
  minute: number,
  scope: "daily" | "once",
  url: string | null,
): Promise<string> {
  const urlOpt = url ? { url } : { url: null as string | null };
  if (scope === "once") {
    const onceOn = resolveOnceOn(user.tz, hour, minute);
    await journal.upsertReminder(user.id, "train", hour, minute, { onceOn, ...urlOpt });
    return url
      ? copy.reminderConfirmOnceWithUrl(lang, hour, minute, onceOn, user.tz, url)
      : copy.reminderConfirmOnce(lang, hour, minute, onceOn, user.tz);
  }
  await journal.upsertReminder(user.id, "train", hour, minute, { onceOn: null, ...urlOpt });
  return url
    ? copy.reminderConfirmWithUrl(lang, hour, minute, user.tz, url)
    : copy.reminderConfirm(lang, hour, minute, user.tz);
}

async function applyHeuristic(user: UserRow, lang: Lang, inbound: Inbound): Promise<string | null> {
  const parsed = parseMessage(inbound.body);
  if (!parsed.confident) return null;

  if (parsed.kind === "today") return formatToday(user, lang);

  if (parsed.kind === "video_link") {
    await journal.setPending(user.id, {
      type: "video_reminder_time",
      url: parsed.url,
      askedAt: new Date().toISOString(),
    });
    return copy.videoLinkAsk(lang);
  }

  if (parsed.kind === "reminder_set") {
    return commitReminderSet(user, lang, parsed.hour, parsed.minute, parsed.scope, parsed.url);
  }

  if (parsed.kind === "reminder_cancel") {
    const had = await journal.disableReminder(user.id, "train");
    return copy.reminderCancel(lang, Boolean(had));
  }

  if (parsed.kind === "activate") {
    const draft = await journal.draftTraining(user.id);
    if (!draft) return copy.noDraft(lang);
    try {
      await journal.activateTrack(draft.id);
      await journal.setPending(user.id, null);
      const today = await formatToday(user, lang);
      return `${copy.activated(lang)}\n\n${today}`;
    } catch (e) {
      return copy.activateFailed(lang, e instanceof Error ? e.message : "");
    }
  }

  if (parsed.kind === "archive") {
    const training = await journal.activeTraining(user.id);
    if (!training) return copy.noActivePlan(lang);
    const summary = copy.archivePrompt(
      lang,
      training.name,
      await journal.entryCount(training.id),
      await journal.noteCount(training.id),
    );
    await journal.setPending(user.id, {
      type: "archive_confirm",
      trackId: training.id,
      summary,
      askedAt: new Date().toISOString(),
    });
    return summary;
  }

  if (parsed.kind === "archive_entry") {
    const rec = await journal.archiveEntry({
      userId: user.id,
      slug: parsed.slug,
      trackKind: parsed.trackKind,
      reason: "user_requested",
    });
    if (!rec) return copy.noEntryToArchive(lang);
    return copy.entryArchived(lang, rec.name);
  }

  if (parsed.kind === "session_log") {
    if (!parsed.day) {
      await journal.setPending(user.id, {
        type: "log_day",
        note: parsed.note,
        quality: parsed.quality,
        claimsPlanned: parsed.claimsPlanned,
        askedAt: new Date().toISOString(),
      });
      return copy.sessionDayAsk(lang);
    }
    return commitSessionLog(user, lang, {
      day: parsed.day,
      note: parsed.note,
      quality: parsed.quality,
      claimsPlanned: parsed.claimsPlanned,
      messageId: inbound.messageId,
    });
  }

  if (parsed.kind === "rpe") {
    const training = await journal.activeTraining(user.id);
    if (!training) return copy.noRpePlan(lang);

    // Prefer attaching effort to a recent open training log (no quality yet).
    const recent = await journal.recentEntries(user.id, 8);
    const open = recent.find((e) => {
      if (String(e.kind) !== "training") return false;
      if (e.quality != null && String(e.quality).length > 0) return false;
      const when = String(e.occurred_at ?? "");
      if (!when) return false;
      const ageMs = Date.now() - new Date(when).getTime();
      return ageMs >= 0 && ageMs < 12 * 60 * 60 * 1000;
    });
    if (open?.id) {
      await journal.patchEntry(String(open.id), { quality: parsed.quality });
      await journal.setPending(user.id, null);
      return copy.rpeLogged(lang, parsed.quality);
    }

    const next = await journal.nextSession(user.id, training);
    if (!next && parsed.quality !== "hoppet") {
      return copy.rpeNeedSession(lang);
    }
    await journal.logEntry({
      trackId: training.id,
      userId: user.id,
      quality: parsed.quality,
      sessionRef: next?.session.id ?? null,
      source: "heuristic",
      linqMessageId: inbound.messageId,
    });
    return copy.rpeLogged(lang, parsed.quality);
  }

  if (parsed.kind === "log") {
    const track = await journal.ensureTrack({
      userId: user.id,
      kind: parsed.trackKind,
      slug: parsed.slug,
      name: parsed.name,
      tags: parsed.tags,
    });
    const result = await journal.logEntry({
      trackId: track.id,
      userId: user.id,
      quantity: parsed.quantity,
      note: parsed.note ?? null,
      source: "heuristic",
      linqMessageId: inbound.messageId,
    });
    if (result.duplicate) return copy.duplicateLog(lang);
    const qty = parsed.quantity ? ` ${parsed.quantity.value} ${parsed.quantity.unit}` : "";
    const n = await journal.entryCount(track.id);
    return copy.loggedItem(lang, parsed.name, qty, n);
  }

  return null;
}

export async function handleInbound(inbound: Inbound): Promise<void> {
  if (inbound.direction && inbound.direction !== "inbound") return;
  if (inbound.isGroup) return;
  if (!inbound.body.trim()) return;
  if (!(await journal.claimMessage(inbound.messageId))) return;

  if (!(await isAdmitted(inbound.phone))) {
    try {
      await handleUnknownSender(inbound);
    } catch (err) {
      console.error("waitlist failed", inbound.phone, err);
    }
    return;
  }

  let user: UserRow | undefined;
  try {
    const current0 = await journal.upsertUser(inbound.chatId, inbound.phone);
    const locked = await lockLang(current0, inbound.body);
    const current = locked.user;
    const { lang, onboarding } = locked;
    user = current;
    await journal.logMessage(current.id, "user", inbound.body, inbound.messageId);
    if (inbound.healthStatus) await journal.setHealth(current.id, inbound.healthStatus);
    if (current.health_status === "OPTED_OUT" && !isOptOut(inbound.body)) {
      /* Linq clears OPTED_OUT on any non-keyword reply; treat as re-opt-in locally. */
      await journal.setHealth(current.id, inbound.healthStatus || "HEALTHY");
    }

    if (isOptOut(inbound.body)) {
      await journal.setHealth(current.id, "OPTED_OUT");
      await reply(inbound.chatId, copy.optOutReply(lang), {
        overrideOptout: true,
        userId: current.id,
      });
      return;
    }

    if (current.health_status === "CRITICAL") return;

    if (isAllowlisted(inbound.phone)) {
      const inviteReply = await resolveOwnerInvite(current, lang, inbound.body);
      if (inviteReply) {
        await reply(inbound.chatId, inviteReply, { replyTo: inbound.messageId, userId: current.id });
        await maybeCard(current, inbound.chatId);
        return;
      }
    }

    const pendingReply = await handlePending(current, lang, inbound.body);
    if (pendingReply) {
      await reply(inbound.chatId, pendingReply, { replyTo: inbound.messageId, userId: current.id });
      const pendingParsed = parseMessage(inbound.body);
      if (pendingParsed.kind === "rpe" && pendingParsed.quality !== "hoppet") {
        await linq.reactLove(inbound.messageId);
      }
      await maybeCard(current, inbound.chatId);
      return;
    }

    if (!onboarding) {
      const heuristic = await applyHeuristic(current, lang, inbound);
      if (heuristic) {
        await reply(inbound.chatId, heuristic, { replyTo: inbound.messageId, userId: current.id });
        const parsed = parseMessage(inbound.body);
        if (parsed.kind === "rpe" && parsed.quality !== "hoppet") {
          await linq.reactLove(inbound.messageId);
        }
        await maybeCard(current, inbound.chatId);
        return;
      }
    }

    let text = await withTyping(inbound.chatId, () =>
      runAgent(current, inbound.body, inbound.messageId, { lang, onboarding }),
    );
    /* If OpenRouter hiccups: prefer session-log heuristic over dumping “today”. */
    if (copy.isAgentFailureReply(text) && !onboarding) {
      const again = await applyHeuristic(current, lang, inbound);
      text = again ?? (await formatToday(current, lang));
    }
    await reply(inbound.chatId, text, { replyTo: inbound.messageId, userId: current.id });
    await maybeCard(current, inbound.chatId);
  } catch (err) {
    console.error("handleInbound failed", err);
    try {
      await linq.stopTyping(inbound.chatId);
      const raw = user ? journal.factsOf(user).uiLang : null;
      const lang = isLang(raw) ? raw : "nb";
      await reply(inbound.chatId, copy.handlerError(lang), user ? { userId: user.id } : undefined);
    } catch {
      /* still return 200 so Linq does not retry the typing loop */
    }
  }
}

export async function handlePayload(payload: unknown): Promise<{ ok: true; skipped?: string }> {
  const norm = normalizeEvent(payload);
  if (!norm) return { ok: true, skipped: "malformed" };
  if (norm.eventId && !(await journal.claimEvent(norm.eventId))) return { ok: true, skipped: "dup-event" };
  try {
    if (!norm.inbound) return { ok: true, skipped: norm.eventType };
    await handleInbound(norm.inbound);
    return { ok: true };
  } catch (err) {
    if (norm.eventId) await journal.releaseEvent(norm.eventId);
    throw err;
  }
}

export function coachName(): string {
  return env.coachName;
}
