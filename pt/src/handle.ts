import { env, isAllowlisted } from "./env.ts";
import { parseMessage } from "./parser.ts";
import { isOptOut } from "./optout.ts";
import { activatePrompt, archivePrompt, isActivatePhrase, isArchivePhrase } from "./gates.ts";
import { runAgent } from "./agent.ts";
import * as journal from "./journal.ts";
import * as linq from "./linq.ts";
import { normalizeEvent } from "./webhook.ts";
import type { Inbound, UserRow } from "./types.ts";

async function reply(chatId: string, text: string, opts?: { overrideOptout?: boolean; replyTo?: string }) {
  const clipped = text.trim().slice(0, 1200);
  if (!clipped) return;
  try {
    await linq.sendText(chatId, clipped, opts);
  } catch (err) {
    if (linq.isOptOutRejected(err)) return;
    throw err;
  }
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

function handlePending(user: UserRow, body: string): string | null {
  const pending = journal.pendingOf(user);
  if (!pending) return null;

  if (pending.type === "activate_confirm") {
    if (isActivatePhrase(body)) {
      try {
        journal.activateTrack(pending.trackId);
        journal.setPending(user.id, null);
        return "Programmet er låst. Si «hva trener jeg i dag» når du er klar.";
      } catch (e) {
        journal.setPending(user.id, null);
        return e instanceof Error ? e.message : "Klarte ikke å aktivere.";
      }
    }
    journal.setPending(user.id, null);
    if (parseMessage(body).kind === "unknown") {
      return "Avbrutt — programmet ligger fortsatt som utkast.";
    }
    return null;
  }

  if (pending.type === "archive_confirm") {
    if (isArchivePhrase(body)) {
      journal.archiveTrack(pending.trackId, "user_requested_new");
      journal.setPending(user.id, null);
      return "Arkivert. Det ligger som snapshot. Fortell hva det nye opplegget skal styre mot.";
    }
    journal.setPending(user.id, null);
    if (parseMessage(body).kind === "unknown") {
      return "Avbrutt — ingenting ble arkivert.";
    }
    return null;
  }

  if (pending.type === "question") {
    journal.setFacts(user.id, { [pending.field]: body.trim() });
    journal.setPending(user.id, null);
    return `Lagret ${pending.field}.`;
  }

  return null;
}

function formatToday(user: UserRow): string {
  const training = journal.activeTraining(user.id);
  if (!training) {
    const draft = journal.draftTraining(user.id);
    if (draft) {
      return `Du har et utkast («${draft.name}»), men det er ikke låst. Skriv «kjør programmet» for å aktivere, eller fortell hva som skal endres.`;
    }
    return "Ingen aktiv treningsplan ennå. Fortell mål, dager i uka og utstyr — så lager jeg et utkast du må bekrefte.";
  }
  const next = journal.nextSession(user.id, training);
  if (!next) return `«${training.name}» er ferdig ut logg-messig. Vil du ha en ny blokk, eller hente et arkiv?`;
  const items = (next.session.items ?? []).slice(0, 5).map((it) => `• ${it.name}${it.detail ? ` — ${it.detail}` : ""}`);
  const load = next.load != null ? `${next.load}${next.session.unit ? ` ${next.session.unit}` : ""}` : "";
  return [
    `I dag: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`,
    ...items,
    next.note,
    "Si lett / passe / brutalt når du er ferdig.",
  ]
    .filter(Boolean)
    .join("\n");
}

function applyHeuristic(user: UserRow, inbound: Inbound): string | null {
  const parsed = parseMessage(inbound.body);
  if (!parsed.confident) return null;

  if (parsed.kind === "today") return formatToday(user);

  if (parsed.kind === "activate") {
    const draft = journal.draftTraining(user.id);
    if (!draft) return "Det finnes ikke noe utkast å låse.";
    const sessions = journal.planOf(draft)?.sessions.length ?? 0;
    const summary = activatePrompt(draft.name, sessions);
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
    if (!training) return "Ingen aktiv plan å arkivere.";
    const summary = archivePrompt(training.name, journal.entryCount(training.id), journal.noteCount(training.id));
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
    if (!training) return "Ingen aktiv plan å logge RPE på. Si hva du gjorde, så logger jeg det som et spor.";
    const next = journal.nextSession(user.id, training);
    journal.logEntry({
      trackId: training.id,
      userId: user.id,
      quality: parsed.quality,
      sessionRef: next?.session.id ?? null,
      source: "heuristic",
      linqMessageId: inbound.messageId,
    });
    if (parsed.quality === "hoppet") return "Notert — hoppet. Den teller ikke i dosen. Neste når du er klar.";
    if (parsed.quality === "brutalt") return "Notert som brutalt. Jeg letter neste like økt.";
    if (parsed.quality === "lett") return "Notert som lett. Jeg skrur opp neste like økt litt.";
    return "Notert som passe. Holder planen.";
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
    if (result.duplicate) return "Den hadde jeg allerede.";
    const qty = parsed.quantity ? ` ${parsed.quantity.value} ${parsed.quantity.unit}` : "";
    const n = journal.entryCount(track.id);
    return `Logget ${parsed.name.toLowerCase()}${qty}. ${n} på det sporet.`;
  }

  return null;
}

export async function handleInbound(inbound: Inbound): Promise<void> {
  if (inbound.direction && inbound.direction !== "inbound") return;
  if (inbound.isGroup) return;
  if (!inbound.body.trim()) return;
  if (!isAllowlisted(inbound.phone)) return;
  if (!journal.claimMessage(inbound.messageId)) return;

  try {
  const user = journal.upsertUser(inbound.chatId, inbound.phone);
  if (inbound.healthStatus) journal.setHealth(user.id, inbound.healthStatus);
  if (user.health_status === "OPTED_OUT" && !isOptOut(inbound.body)) {
    /* Linq clears OPTED_OUT on any non-keyword reply; treat as re-opt-in locally. */
    journal.setHealth(user.id, inbound.healthStatus || "HEALTHY");
  }

  if (isOptOut(inbound.body)) {
    journal.setHealth(user.id, "OPTED_OUT");
    await reply(inbound.chatId, "Ok, jeg er stille. Skriv når du vil igjen.", { overrideOptout: true });
    return;
  }

  if (user.health_status === "CRITICAL") return;

  const pendingReply = handlePending(user, inbound.body);
  if (pendingReply) {
    await reply(inbound.chatId, pendingReply, { replyTo: inbound.messageId });
    await maybeCard(user, inbound.chatId);
    return;
  }

  const heuristic = applyHeuristic(user, inbound);
  if (heuristic) {
    await reply(inbound.chatId, heuristic, { replyTo: inbound.messageId });
    if (parseMessage(inbound.body).kind === "rpe" && inbound.body.toLowerCase() !== "hoppet") {
      await linq.reactLove(inbound.messageId);
    }
    await maybeCard(user, inbound.chatId);
    return;
  }

  const text = await withTyping(inbound.chatId, () => runAgent(user, inbound.body, inbound.messageId));
  await reply(inbound.chatId, text, { replyTo: inbound.messageId });
  await maybeCard(user, inbound.chatId);
  } catch (err) {
    console.error("handleInbound failed", err);
    try {
      await linq.stopTyping(inbound.chatId);
      await reply(
        inbound.chatId,
        "Jeg hørte deg, men noe røk på min side. Prøv igjen, eller si f.eks. «mediterte i 30 sekunder».",
      );
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
