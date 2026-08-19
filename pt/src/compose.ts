import { env } from "./env.ts";
import { chatModels, completePlain, hasLlm } from "./llm.ts";
import { agendaForSnapshot, loadAgenda } from "./fallback.ts";
import * as journal from "./journal.ts";
import * as copy from "./copy.ts";
import type { Lang } from "./locale.ts";
import type { UserRow } from "./types.ts";

/** Journal packet the composer answers from — tools already ran. */
export type CoachPacket = {
  userMessage: string;
  facts: Record<string, unknown>;
  pending: unknown;
  today: unknown;
  agenda: unknown;
  reminders: unknown;
  recentChat: { role: string; body: string }[];
  actions: string[];
};

export async function gatherPacket(
  user: UserRow,
  userMessage: string,
  actions: string[] = [],
): Promise<CoachPacket> {
  const snap = await journal.snapshot(user);
  let agenda: unknown = {};
  try {
    agenda = agendaForSnapshot(await loadAgenda(user));
  } catch {
    agenda = {};
  }
  const chat = await journal.recentChat(user.id, 16);
  return {
    userMessage,
    facts: snap.facts as Record<string, unknown>,
    pending: snap.pending,
    today: snap.today,
    agenda,
    reminders: snap.reminders,
    recentChat: chat.map((m) => ({ role: m.role, body: m.body })),
    actions,
  };
}

function composeSystem(lang: Lang): string {
  const language = lang === "en" ? "English" : lang === "sv" ? "Swedish" : "Norwegian (bokmål)";
  return `You are ${env.coachName}, an iMessage coach. Reply only in ${language}.

The receive layer already loaded the journal and ran any tools. You do NOT call tools. Answer the user's latest message from the packet.

Rules:
- Meet the actual message (awake? status? reminders? what do you know about me?). Never paste today's workout as a non-answer.
- Packet is truth. Don't invent logs, reminders, or history.
- Reminders: if packet.reminders has a clock, that ping is on — don't ask when again. If a url is there, you have the link.
- Typical 2–6 short lines. At most one question, only if you need it.
- Informal. No jargon (RPE, OCR, HIIT, zone 2).
- Rest day → recovery, not the next session. Greeting → short, one hint. Week/status → N sessions and weekdays.
- You are not a doctor.`.trim();
}

/** LLM writes the user-facing reply after storage/retrieval. No tool calls. */
export async function composeFromPacket(
  lang: Lang,
  packet: CoachPacket,
  opts?: { onboarding?: boolean },
): Promise<string | null> {
  if (!hasLlm()) return null;
  const onboard = opts?.onboarding
    ? " They are still in onboarding — one missing field at a time, no week-1 dump unless they asked."
    : "";
  const user = `Packet (journal + any actions already taken):\n${JSON.stringify(packet)}\n\nUser message:\n${packet.userMessage}`;
  for (const model of chatModels()) {
    try {
      const text = await completePlain({
        model,
        maxTokens: 500,
        system: `${composeSystem(lang)}${onboard}`,
        user,
      });
      const clipped = text.trim().slice(0, 1200);
      if (clipped && clipped.length > 2 && !copy.isAgentFailureReply(clipped)) return clipped;
    } catch (err) {
      console.error("compose failed", model, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
