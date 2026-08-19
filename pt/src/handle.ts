import { env, isAllowlisted } from "./env.ts";
import { parseMessage, parseAdaptChoice, parseTimeReply, isDidYouHearMe } from "./parser.ts";
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
import { hasLlm } from "./llm.ts";
import * as journal from "./journal.ts";
import * as copy from "./copy.ts";
import * as linq from "./linq.ts";
import { normalizeEvent } from "./webhook.ts";
import { detectLang, isLang, type Lang } from "./locale.ts";
import { missingForPlan } from "./plan-facts.ts";
import { addLocalDays, dayAnchorIso, resolveOnceOn, todayInTz } from "./db.ts";
import { isExtraWording, inferModality, modalityLabel } from "./activity.ts";
import { adaptAfterLog, applyAdaptChoice } from "./adapt.ts";
import { startedOnOf, assignSessionDays } from "./calendar.ts";
import { consecutiveConflict, coachFallback, loadAgenda, plannedSessionOf } from "./fallback.ts";
import { composeFromPacket, gatherPacket } from "./compose.ts";
import { inferReminderTopic } from "./reminder-topic.ts";
import { detectSafetyRoute, isSafetyFollowup } from "./safety.ts";
import { detectPrivacyRequest } from "./privacy.ts";
import type { Inbound, InviteRow, ReminderRow, UserRow } from "./types.ts";

type ReplyResult = { text: string; effect?: string };

function asReply(value: string | ReplyResult | null): ReplyResult | null {
  if (!value) return null;
  return typeof value === "string" ? { text: value } : value;
}

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
  opts?: { overrideOptout?: boolean; replyTo?: string; userId?: string; effect?: string },
) {
  const clipped = text.trim().slice(0, 1200);
  if (!clipped) return;
  try {
    await linq.sendText(chatId, clipped, opts);
  } catch (err) {
    if (linq.isOptOutRejected(err)) return;
    throw err;
  }
  if (opts?.userId) {
    try {
      await journal.logMessage(opts.userId, "pt", clipped);
    } catch (err) {
      /* The user already received the reply. Never emit a second error reply because telemetry failed. */
      console.error("outbound message log failed", opts.userId, err);
    }
  }
}

async function withTyping<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
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
    await linq.ensureContactCard();
    await linq.shareContactCard(chatId);
    await journal.touchContactCard(user.id);
  } catch {
    /* share is best-effort; iMessage name/photo may already be saved */
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
  const pending = await journal.pendingOf(owner);
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
  const ownerPending = await journal.pendingOf(owner);
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
    extra?: boolean;
    messageId?: string;
  },
): Promise<ReplyResult> {
  const training = await journal.activeTraining(user.id);
  if (!training) return { text: copy.sessionNoPlan(lang) };

  const today = todayInTz(user.tz);
  const dayYmd = opts.day === "today" ? today : addLocalDays(today, -1);
  const view = await journal.todayView(user, dayYmd);
  const extraExplicit = Boolean(opts.extra || isExtraWording(opts.note));
  const fillToday = !extraExplicit && view.kind === "session";
  const sessionRef = fillToday ? view.session.id : `extra:${dayYmd}`;
  const title = fillToday ? shortSessionTitle(opts.note) || view.session.title : shortSessionTitle(opts.note);

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
  if (result.duplicate) return { text: copy.duplicateLog(lang) };

  let adaptLine: string | null = null;
  const plan = journal.planOf(training);
  if (plan && fillToday) {
    const planned = view.kind === "session" ? view.session : null;
    const adapted = adaptAfterLog(plan, {
      startedOn: startedOnOf(training, plan, user.tz),
      loggedOnYmd: dayYmd,
      planned,
      actualText: opts.note,
    });
    if (adapted.changed) {
      await journal.patchPlan(training.id, assignSessionDays(adapted.plan));
      await journal.addNote({
        userId: user.id,
        trackId: training.id,
        kind: "adapt",
        body: adapted.summaryNb.slice(0, 240),
      });
      adaptLine = adapted.summaryNb;
    }
  } else if (plan && !fillToday && inferModality(opts.note)) {
    const adapted = adaptAfterLog(plan, {
      startedOn: startedOnOf(training, plan, user.tz),
      loggedOnYmd: dayYmd,
      planned: view.kind === "session" || view.kind === "logged" ? view.session : null,
      actualText: opts.note,
    });
    if (adapted.changed) {
      await journal.patchPlan(training.id, assignSessionDays(adapted.plan));
      adaptLine = adapted.summaryNb;
    }
  }

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

  const text = copy.sessionLogged(lang, {
    title,
    dayLabel: dayLabel(lang, opts.day),
    planned: fillToday,
    askRpe,
    adaptLine,
  });
  const celebrate = opts.quality !== "hoppet";
  return { text, effect: celebrate ? "confetti" : undefined };
}

async function maybePendingAdapt(user: UserRow, text: string) {
  if (!copy.isAdaptOffer(text)) return;
  await journal.setPending(user.id, { type: "adapt_choice", askedAt: new Date().toISOString() });
}

async function commitAdaptChoice(
  user: UserRow,
  lang: Lang,
  choice: "swap" | "ease" | "keep",
): Promise<ReplyResult> {
  const agenda = await loadAgenda(user);
  const today = plannedSessionOf(agenda.today.view);
  if (!agenda.plan || !agenda.track || !agenda.startedOn || !today || agenda.today.view.kind !== "session") {
    await journal.setPending(user.id, null);
    return { text: await formatWeek(user, lang) };
  }
  if (choice === "keep") {
    await journal.setPending(user.id, null);
    return { text: copy.adaptedKeep(lang, today.title) };
  }
  const result = applyAdaptChoice(agenda.plan, choice, {
    startedOn: agenda.startedOn,
    yesterdayYmd: agenda.yesterday.ymd,
    yesterdayPlanned: plannedSessionOf(agenda.yesterday.view),
    yesterdayModality: agenda.yesterday.actual?.modality ?? consecutiveConflict(agenda)?.yesterdayMod ?? null,
    yesterdayNote: agenda.yesterday.actual?.note ?? undefined,
    todaySession: today,
  });
  if (result.changed) {
    await journal.patchPlan(agenda.track.id, assignSessionDays(result.plan));
    await journal.addNote({
      userId: user.id,
      trackId: agenda.track.id,
      kind: "adapt",
      body: result.summaryNb.slice(0, 240),
    });
  }
  await journal.setPending(user.id, null);
  const next =
    result.swappedToday?.title ??
    result.plan.sessions.find((s) => s.id === today.id)?.title ??
    today.title;
  if (choice === "swap") return { text: copy.adaptedSwap(lang, next) };
  if (!result.changed) return { text: copy.adaptedAlreadyEase(lang, next) };
  return { text: copy.adaptedEase(lang, next) };
}

async function handlePending(user: UserRow, lang: Lang, body: string): Promise<string | ReplyResult | null> {
  const pending = await journal.pendingOf(user);
  if (!pending) return null;
  if (isSafetyFollowup(body)) return null;

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
    const timed = parseTimeReply(body);
    if (timed) {
      await journal.setPending(user.id, null);
      return commitReminderSet(user, lang, timed.hour, timed.minute, timed.scope, pending.url);
    }
    /* Not a clock — never trap the dialogue on “når skal jeg minne deg?”. Attach the URL if a ping already exists. */
    const live = (await journal.listReminders(user.id)).filter((r) => r.enabled === 1);
    const target = pickAttachTarget(live);
    if (target) {
      await attachUrlToReminder(target, pending.url);
    } else {
      await journal.addNote({ userId: user.id, trackId: null, kind: "video", body: pending.url.slice(0, 240) });
    }
    await journal.setPending(user.id, null);
    return null;
  }

  if (pending.type === "reminder_scope") {
    // Legacy pending from older ask-flow: soft resolve, no magic phrase.
    if (isReminderScopeCancel(body)) {
      await journal.setPending(user.id, null);
      return copy.reminderScopeCancelled(lang);
    }
    if (isReminderDailyReply(body)) {
      await journal.upsertReminder(user.id, "train", pending.hour, pending.minute, { onceOn: null, title: "trening" });
      await journal.setPending(user.id, null);
      return copy.reminderConfirm(lang, pending.hour, pending.minute, user.tz);
    }
    if (isReminderOnceReply(body) || isActivatePhrase(body)) {
      const onceOn = resolveOnceOn(user.tz, pending.hour, pending.minute);
      await journal.upsertReminder(user.id, "train", pending.hour, pending.minute, { onceOn, title: "trening" });
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
      extra: pending.extra,
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

  if (pending.type === "adapt_choice") {
    const choice = parseAdaptChoice(body);
    if (choice) return commitAdaptChoice(user, lang, choice);
    if (isActivateCancel(body)) {
      await journal.setPending(user.id, null);
      const agenda = await loadAgenda(user);
      const today = plannedSessionOf(agenda.today.view);
      return copy.adaptedKeep(lang, today?.title ?? "");
    }
    return null;
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
  const view = await journal.todayView(user);
  if (view.kind === "complete") return copy.todayDone(lang, training.name);
  if (view.kind === "rest") return copy.restDayTips(lang, view.weekday);
  if (view.kind === "logged") return copy.todayLogged(lang, view.session.title);
  if (view.kind !== "session") return copy.todayNoPlan(lang);
  const items = (view.session.items ?? []).slice(0, 5).map((it) => `• ${it.name}${it.detail ? ` — ${it.detail}` : ""}`);
  return [
    copy.sessionHeading(lang, view.session, view.load),
    ...items,
    view.adapt ? copy.adaptNote(lang, view.adapt) : null,
    copy.todayFooter(lang),
  ]
    .filter(Boolean)
    .join("\n");
}

async function formatGreeting(user: UserRow, lang: Lang): Promise<string> {
  const view = await journal.todayView(user);
  const draft = await journal.draftTraining(user.id);
  let consecutive: { yesterday: string; today: string } | null = null;
  try {
    const agenda = await loadAgenda(user);
    const conflict = consecutiveConflict(agenda);
    if (conflict && (await journal.pendingOf(user))?.type !== "adapt_choice") {
      consecutive = {
        yesterday: modalityLabel(lang, conflict.yesterdayMod),
        today: conflict.todaySession.title,
      };
    }
  } catch {
    /* keep the short greeting */
  }
  return copy.greetingReply(lang, view, {
    missingForPlan: missingForPlan(journal.factsOf(user)),
    draftName: draft?.name ?? null,
    consecutive,
  });
}

async function formatWeek(user: UserRow, lang: Lang): Promise<string> {
  try {
    const agenda = await loadAgenda(user);
    return copy.fallbackWeek(lang, agenda);
  } catch {
    return formatToday(user, lang);
  }
}

function pickAttachTarget(live: ReminderRow[]): ReminderRow | null {
  return live.find((r) => r.slug === "video" || r.url) ?? (live.length === 1 ? live[0] : null);
}

async function attachUrlToReminder(target: ReminderRow, url: string): Promise<ReminderRow> {
  const slug = target.slug === "train" ? "video" : target.slug;
  const title = !target.title || target.title === "trening" ? "video" : target.title;
  const rec = await journal.patchReminder(target.id, { url, slug, title });
  return rec ?? target;
}

async function commitReminderSet(
  user: UserRow,
  lang: Lang,
  hour: number,
  minute: number,
  scope: "daily" | "once",
  url: string | null,
  topic?: { slug: string; title: string },
): Promise<string> {
  const inferred = topic ?? inferReminderTopic("", url);
  const slug = inferred.slug;
  const title = inferred.title;
  const urlOpt = url ? { url } : { url: null as string | null };
  if (scope === "once") {
    const onceOn = resolveOnceOn(user.tz, hour, minute);
    await journal.upsertReminder(user.id, slug, hour, minute, { onceOn, title, ...urlOpt });
    return url
      ? copy.reminderConfirmOnceWithUrl(lang, hour, minute, onceOn, user.tz, url, title)
      : copy.reminderConfirmOnce(lang, hour, minute, onceOn, user.tz, title);
  }
  await journal.upsertReminder(user.id, slug, hour, minute, { onceOn: null, title, ...urlOpt });
  return url
    ? copy.reminderConfirmWithUrl(lang, hour, minute, user.tz, url, title)
    : copy.reminderConfirm(lang, hour, minute, user.tz, title);
}

async function applyHeuristic(
  user: UserRow,
  lang: Lang,
  inbound: Inbound,
  opts?: { onboarding?: boolean },
): Promise<string | ReplyResult | null> {
  const parsed = parseMessage(inbound.body);
  if (!parsed.confident) return null;

  /* Conversational turns go to the model (or the welcome) — heuristics stay for actions. */
  const conversational =
    parsed.kind === "greeting" || parsed.kind === "today" || parsed.kind === "program" || parsed.kind === "alive";
  if (conversational && (hasLlm() || opts?.onboarding)) {
    return null;
  }

  if (parsed.kind === "greeting") {
    const text = await formatGreeting(user, lang);
    await maybePendingAdapt(user, text);
    return text;
  }

  if (parsed.kind === "today") return formatToday(user, lang);

  if (parsed.kind === "program") return formatWeek(user, lang);

  if (parsed.kind === "alive") return copy.fallbackAlive(lang);

  if (parsed.kind === "reminder_list") {
    const reminders = (await journal.listReminders(user.id))
      .filter((r) => r.enabled === 1)
      .map((r) => ({ hour: r.hour, minute: r.minute, url: r.url, title: r.title, onceOn: r.once_on }));
    return copy.fallbackReminders(lang, reminders);
  }

  if (parsed.kind === "adapt_choice") {
    try {
      const agenda = await loadAgenda(user);
      if (consecutiveConflict(agenda) || (await journal.pendingOf(user))?.type === "adapt_choice" || agenda.today.view.kind === "session") {
        return commitAdaptChoice(user, lang, parsed.choice);
      }
    } catch {
      /* fall through */
    }
  }

  if (parsed.kind === "video_link") {
    const live = (await journal.listReminders(user.id)).filter((r) => r.enabled === 1);
    const target = pickAttachTarget(live);
    if (target) {
      const rec = await attachUrlToReminder(target, parsed.url);
      if (rec.once_on) {
        return copy.reminderConfirmOnceWithUrl(lang, rec.hour, rec.minute, rec.once_on, user.tz, parsed.url, rec.title);
      }
      return copy.reminderConfirmWithUrl(lang, rec.hour, rec.minute, user.tz, parsed.url, rec.title);
    }
    await journal.setPending(user.id, {
      type: "video_reminder_time",
      url: parsed.url,
      askedAt: new Date().toISOString(),
    });
    return copy.videoLinkAsk(lang);
  }

  if (parsed.kind === "reminder_set") {
    return commitReminderSet(user, lang, parsed.hour, parsed.minute, parsed.scope, parsed.url, {
      slug: parsed.slug,
      title: parsed.title,
    });
  }

  if (parsed.kind === "reminder_cancel") {
    const disabled = await journal.disableReminders(user.id, {
      slug: parsed.slug,
      hour: parsed.hour,
      minute: parsed.minute,
    });
    return copy.reminderCancel(lang, disabled.length);
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
        extra: parsed.extra,
        askedAt: new Date().toISOString(),
      });
      return copy.sessionDayAsk(lang);
    }
    return commitSessionLog(user, lang, {
      day: parsed.day,
      note: parsed.note,
      quality: parsed.quality,
      claimsPlanned: parsed.claimsPlanned,
      extra: parsed.extra,
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

    const view = await journal.todayView(user);
    if (view.kind !== "session" && parsed.quality !== "hoppet") {
      return copy.rpeNeedSession(lang);
    }
    await journal.logEntry({
      trackId: training.id,
      userId: user.id,
      quality: parsed.quality,
      sessionRef: view.kind === "session" ? view.session.id : null,
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

    const chat = await journal.recentChat(current.id, 20, inbound.messageId);
    const firstContact = chat.length === 0;
    const disclose = (text: string) =>
      firstContact ? copy.withAiCoachDisclosure(lang, env.coachName, text) : text;
    const previousUser = [...chat].reverse().find((m) => m.role === "user" && m.body.trim() !== inbound.body.trim());
    const lastPt = [...chat].reverse().find((m) => m.role === "pt")?.body ?? null;
    const work: Inbound = isDidYouHearMe(inbound.body) && previousUser
      ? { ...inbound, body: previousUser.body }
      : inbound;

    const safety = detectSafetyRoute(work.body);
    if (safety) {
      const text =
        safety.kind === "mental_crisis"
          ? copy.safetyMentalCrisis(lang)
          : copy.safetyMedicalUrgent(lang, safety.kind);
      await reply(inbound.chatId, text, {
        replyTo: inbound.messageId,
        userId: current.id,
      });
      try {
        await journal.recordCoachEvent({
          userId: current.id,
          kind: "safety_routed",
          source: "system",
          refId: inbound.messageId,
          dedupeKey: `safety:${inbound.messageId}`,
          metadata: { route: safety.kind, signal: safety.signal },
        });
      } catch (err) {
        /* Safety guidance is primary; analytics must never suppress it. */
        console.error("safety event record failed", current.id, err);
      }
      await maybeCard(current, inbound.chatId);
      return;
    }

    const privacyRequest = detectPrivacyRequest(work.body);
    if (privacyRequest) {
      await journal.recordCoachEvent({
        userId: current.id,
        kind: "privacy_requested",
        source: "user",
        refId: inbound.messageId,
        dedupeKey: `privacy:${inbound.messageId}`,
        metadata: { request: privacyRequest },
      });
      await reply(inbound.chatId, disclose(copy.privacyRequestReceived(lang, privacyRequest)), {
        replyTo: inbound.messageId,
        userId: current.id,
      });
      if (!isAllowlisted(inbound.phone)) {
        try {
          const owner = await ownerUser();
          if (owner) {
            const who = current.display_name || current.phone_e164 || current.chat_id;
            await reply(owner.chat_id, copy.privacyOwnerAlert(ownerLang(owner), privacyRequest, who), {
              userId: owner.id,
            });
          }
        } catch (err) {
          /* Durable event is the request queue; owner ping is best-effort. */
          console.error("privacy owner notification failed", current.id, err);
        }
      }
      await maybeCard(current, inbound.chatId);
      return;
    }

    const pendingOut = asReply(await handlePending(current, lang, work.body));
    if (pendingOut) {
      const text = disclose(pendingOut.text);
      await reply(inbound.chatId, text, {
        replyTo: inbound.messageId,
        userId: current.id,
        effect: pendingOut.effect,
      });
      const pendingParsed = parseMessage(work.body);
      if (pendingParsed.kind === "rpe" && pendingParsed.quality !== "hoppet") {
        await linq.reactLove(inbound.messageId);
      }
      await maybeCard(current, inbound.chatId);
      return;
    }

    const heuristicOut = asReply(await applyHeuristic(current, lang, work, { onboarding }));
    if (heuristicOut) {
      const text = disclose(heuristicOut.text);
      await maybePendingAdapt(current, text);
      await reply(inbound.chatId, text, {
        replyTo: inbound.messageId,
        userId: current.id,
        effect: heuristicOut.effect,
      });
      const parsed = parseMessage(work.body);
      if (parsed.kind === "rpe" && parsed.quality !== "hoppet") {
        await linq.reactLove(inbound.messageId);
      }
      await maybeCard(current, inbound.chatId);
      return;
    }

    /* Receive: journal is already loaded. Compose the reply from that packet — no tool-calling. */
    const packet = await gatherPacket(current, work.body);
    const composed = await withTyping(inbound.chatId, () =>
      composeFromPacket(lang, packet, { onboarding }),
    );
    if (composed) {
      const text = disclose(composed);
      await maybePendingAdapt(current, text);
      await reply(inbound.chatId, text, { replyTo: inbound.messageId, userId: current.id });
      await maybeCard(current, inbound.chatId);
      return;
    }

    let agent = await withTyping(inbound.chatId, () =>
      runAgent(current, work.body, inbound.messageId, { lang, onboarding, chatId: inbound.chatId }),
    );
    /* If OpenRouter hiccups: answer the actual message from the journal — never loop the same canned line. */
    if (copy.isAgentFailureReply(agent.text) && !onboarding) {
      const choice = parseAdaptChoice(work.body);
      if (choice) {
        const acted = asReply(await commitAdaptChoice(current, lang, choice));
        if (acted) agent = { text: acted.text, celebrate: Boolean(acted.effect) };
      } else {
        const again = asReply(await applyHeuristic(current, lang, work));
        if (again) agent = { text: again.text, celebrate: Boolean(again.effect) };
        else {
          const parsed = parseMessage(work.body);
          let text =
            parsed.kind === "greeting"
              ? await formatGreeting(current, lang)
              : parsed.kind === "today"
                ? await formatToday(current, lang)
                : parsed.kind === "program"
                  ? await formatWeek(current, lang)
                  : parsed.kind === "alive"
                    ? copy.fallbackAlive(lang)
                    : await coachFallback(current, lang, work.body, {
                        lastPt,
                        previousUser: previousUser?.body ?? null,
                      });
          if (copy.isAdaptOffer(lastPt ?? "") && copy.isAdaptOffer(text)) {
            text = await coachFallback(current, lang, work.body, {
              lastPt,
              previousUser: previousUser?.body ?? null,
            });
          }
          agent = {
            text: copy.isHardLlmFailureReply(agent.text) ? `${agent.text}\n${text}` : text,
          };
        }
      }
    }
    const agentText = disclose(agent.text);
    await maybePendingAdapt(current, agentText);
    await reply(inbound.chatId, agentText, {
      replyTo: inbound.messageId,
      userId: current.id,
      effect: agent.celebrate ? "confetti" : undefined,
    });
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
