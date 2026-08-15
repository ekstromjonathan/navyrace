import { env, isAllowlisted } from "./env.ts";
import { parseMessage } from "./parser.ts";
import { isOptOut } from "./optout.ts";
import { isActivatePhrase, isArchivePhrase } from "./gates.ts";
import { runAgent } from "./agent.ts";
import * as journal from "./journal.ts";
import * as copy from "./copy.ts";
import * as linq from "./linq.ts";
import { normalizeEvent } from "./webhook.ts";
import { detectLang, isLang, type Lang } from "./locale.ts";
import type { Inbound, UserRow } from "./types.ts";

function lockLang(user: UserRow, body: string): { user: UserRow; lang: Lang; onboarding: boolean } {
  const facts = journal.factsOf(user);
  const onboarding = journal.isFreshStart(user.id);
  const locked = isLang(facts.uiLang) ? facts.uiLang : null;
  const detected = detectLang(body);
  const lang = locked ?? detected ?? "nb";
  if (!locked && detected) {
    journal.setFacts(user.id, { uiLang: detected });
    journal.setLocale(user.id, detected);
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
  if (opts?.userId) journal.logMessage(opts.userId, "pt", clipped);
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
    journal.touchContactCard(user.id);
  } catch {
    /* share is best-effort; card may be unconfigured */
  }
}

function handlePending(user: UserRow, lang: Lang, body: string): string | null {
  const pending = journal.pendingOf(user);
  if (!pending) return null;

  if (pending.type === "activate_confirm") {
    if (isActivatePhrase(body)) {
      try {
        journal.activateTrack(pending.trackId);
        journal.setPending(user.id, null);
        return copy.activated(lang);
      } catch (e) {
        journal.setPending(user.id, null);
        return copy.activateFailed(lang, e instanceof Error ? e.message : "");
      }
    }
    journal.setPending(user.id, null);
    if (parseMessage(body).kind === "unknown") {
      return copy.activateCancelled(lang);
    }
    return null;
  }

  if (pending.type === "archive_confirm") {
    if (isArchivePhrase(body)) {
      journal.archiveTrack(pending.trackId, "user_requested_new");
      journal.setPending(user.id, null);
      return copy.archived(lang);
    }
    journal.setPending(user.id, null);
    if (parseMessage(body).kind === "unknown") {
      return copy.archiveCancelled(lang);
    }
    return null;
  }

  if (pending.type === "question") {
    journal.setFacts(user.id, { [pending.field]: body.trim() });
    journal.setPending(user.id, null);
    return copy.savedField(lang, pending.field);
  }

  return null;
}

function formatToday(user: UserRow, lang: Lang): string {
  const training = journal.activeTraining(user.id);
  if (!training) {
    const draft = journal.draftTraining(user.id);
    if (draft) return copy.todayDraft(lang, draft.name);
    return copy.todayNoPlan(lang);
  }
  const next = journal.nextSession(user.id, training);
  if (!next) return copy.todayDone(lang, training.name);
  const items = (next.session.items ?? []).slice(0, 5).map((it) => `• ${it.name}${it.detail ? ` — ${it.detail}` : ""}`);
  const load = next.load != null ? `${next.load}${next.session.unit ? ` ${next.session.unit}` : ""}` : "";
  const heading =
    lang === "en"
      ? `Today: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`
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

function applyHeuristic(user: UserRow, lang: Lang, inbound: Inbound): string | null {
  const parsed = parseMessage(inbound.body);
  if (!parsed.confident) return null;

  if (parsed.kind === "today") return formatToday(user, lang);

  if (parsed.kind === "reminder_set") {
    journal.upsertReminder(user.id, "train", parsed.hour, parsed.minute);
    return copy.reminderConfirm(lang, parsed.hour, parsed.minute, user.tz);
  }

  if (parsed.kind === "reminder_cancel") {
    const had = journal.disableReminder(user.id, "train");
    return copy.reminderCancel(lang, Boolean(had));
  }

  if (parsed.kind === "activate") {
    const draft = journal.draftTraining(user.id);
    if (!draft) return copy.noDraft(lang);
    const sessions = journal.planOf(draft)?.sessions.length ?? 0;
    const summary = copy.activatePrompt(lang, draft.name, sessions);
    journal.setPending(user.id, {
      type: "activate_confirm",
      trackId: draft.id,
      summary,
      askedAt: new Date().toISOString(),
    });
    return summary;
  }

  if (parsed.kind === "archive") {
    const training = journal.activeTraining(user.id);
    if (!training) return copy.noActivePlan(lang);
    const summary = copy.archivePrompt(lang, training.name, journal.entryCount(training.id), journal.noteCount(training.id));
    journal.setPending(user.id, {
      type: "archive_confirm",
      trackId: training.id,
      summary,
      askedAt: new Date().toISOString(),
    });
    return summary;
  }

  if (parsed.kind === "rpe") {
    const training = journal.activeTraining(user.id);
    if (!training) return copy.noRpePlan(lang);
    const next = journal.nextSession(user.id, training);
    journal.logEntry({
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
    const track = journal.ensureTrack({
      userId: user.id,
      kind: parsed.trackKind,
      slug: parsed.slug,
      name: parsed.name,
      tags: parsed.tags,
    });
    const result = journal.logEntry({
      trackId: track.id,
      userId: user.id,
      quantity: parsed.quantity,
      note: parsed.note ?? null,
      source: "heuristic",
      linqMessageId: inbound.messageId,
    });
    if (result.duplicate) return copy.duplicateLog(lang);
    const qty = parsed.quantity ? ` ${parsed.quantity.value} ${parsed.quantity.unit}` : "";
    const n = journal.entryCount(track.id);
    return copy.loggedItem(lang, parsed.name, qty, n);
  }

  return null;
}

export async function handleInbound(inbound: Inbound): Promise<void> {
  if (inbound.direction && inbound.direction !== "inbound") return;
  if (inbound.isGroup) return;
  if (!inbound.body.trim()) return;
  if (!isAllowlisted(inbound.phone)) return;
  if (!journal.claimMessage(inbound.messageId)) return;

  let user: UserRow | undefined;
  try {
    const current0 = journal.upsertUser(inbound.chatId, inbound.phone);
    const locked = lockLang(current0, inbound.body);
    const current = locked.user;
    const { lang, onboarding } = locked;
    user = current;
    journal.logMessage(current.id, "user", inbound.body, inbound.messageId);
    if (inbound.healthStatus) journal.setHealth(current.id, inbound.healthStatus);
    if (current.health_status === "OPTED_OUT" && !isOptOut(inbound.body)) {
      /* Linq clears OPTED_OUT on any non-keyword reply; treat as re-opt-in locally. */
      journal.setHealth(current.id, inbound.healthStatus || "HEALTHY");
    }

    if (isOptOut(inbound.body)) {
      journal.setHealth(current.id, "OPTED_OUT");
      await reply(inbound.chatId, copy.optOutReply(lang), {
        overrideOptout: true,
        userId: current.id,
      });
      return;
    }

    if (current.health_status === "CRITICAL") return;

    const pendingReply = handlePending(current, lang, inbound.body);
    if (pendingReply) {
      await reply(inbound.chatId, pendingReply, { replyTo: inbound.messageId, userId: current.id });
      await maybeCard(current, inbound.chatId);
      return;
    }

    if (!onboarding) {
      const heuristic = applyHeuristic(current, lang, inbound);
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

    const text = await withTyping(inbound.chatId, () =>
      runAgent(current, inbound.body, inbound.messageId, { lang, onboarding }),
    );
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
  if (norm.eventId && !journal.claimEvent(norm.eventId)) return { ok: true, skipped: "dup-event" };
  try {
    if (!norm.inbound) return { ok: true, skipped: norm.eventType };
    await handleInbound(norm.inbound);
    return { ok: true };
  } catch (err) {
    if (norm.eventId) journal.releaseEvent(norm.eventId);
    throw err;
  }
}

export function coachName(): string {
  return env.coachName;
}
