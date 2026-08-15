import { env } from "./env.ts";
import { localParts } from "./db.ts";
import * as journal from "./journal.ts";
import * as linq from "./linq.ts";
import type { ReminderRow, UserRow } from "./types.ts";

const CATCHUP_MINUTES = 180;
const TICK_MS = 30_000;

export function reminderBody(user: UserRow): string {
  const training = journal.activeTraining(user.id);
  if (!training) {
    return "Påminnelse — du ville trene i dag. Hva har du tid til?";
  }
  const next = journal.nextSession(user.id, training);
  if (!next) {
    return `Påminnelse — «${training.name}» er ferdig ut. Vil du ha en ny blokk?`;
  }
  const load = next.load != null ? `${next.load}${next.session.unit ? ` ${next.session.unit}` : ""}` : "";
  return [
    `Påminnelse — trening i dag.`,
    `I dag: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`,
    "Si «hva trener jeg i dag» når du starter.",
  ].join("\n");
}

export function isReminderDue(reminder: ReminderRow, user: UserRow, now: Date): boolean {
  if (!reminder.enabled) return false;
  if (user.health_status === "OPTED_OUT" || user.health_status === "CRITICAL") return false;
  const local = localParts(user.tz, now);
  if (reminder.last_fired_on === local.date) return false;
  const scheduled = reminder.hour * 60 + reminder.minute;
  const current = local.hour * 60 + local.minute;
  if (current < scheduled) return false;
  if (current - scheduled > CATCHUP_MINUTES) return false;
  if (journal.trainedOnDay(user.id, local.date, user.tz)) return false;
  return true;
}

export async function fireDueReminders(
  now = new Date(),
  send: (chatId: string, body: string, userId: string) => Promise<void> = sendReminder,
): Promise<number> {
  let sent = 0;
  for (const reminder of journal.listEnabledReminders()) {
    const user = journal.getUser(reminder.user_id);
    if (!user) continue;
    if (!isReminderDue(reminder, user, now)) continue;
    const body = reminderBody(user);
    try {
      await send(user.chat_id, body, user.id);
      journal.markReminderFired(reminder.id, localParts(user.tz, now).date);
      sent += 1;
    } catch (err) {
      console.error("reminder send failed", reminder.id, err);
    }
  }
  return sent;
}

async function sendReminder(chatId: string, body: string, userId: string): Promise<void> {
  const clipped = body.trim().slice(0, 1200);
  if (!clipped) return;
  await linq.sendText(chatId, clipped);
  journal.logMessage(userId, "pt", clipped);
}

let ticking = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (timer) return;
  const tick = () => {
    if (ticking) return;
    ticking = true;
    fireDueReminders()
      .catch((err) => console.error("scheduler tick failed", err))
      .finally(() => {
        ticking = false;
      });
  };
  tick();
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  console.log(`scheduler every ${TICK_MS / 1000}s tz=${env.tz}`);
}
