import { env } from "./env.ts";
import { localParts } from "./db.ts";
import * as journal from "./journal.ts";
import * as copy from "./copy.ts";
import * as linq from "./linq.ts";
import { isLang } from "./locale.ts";
import type { ReminderRow, UserRow } from "./types.ts";

const CATCHUP_MINUTES = 180;
const TICK_MS = 30_000;

export async function reminderBody(user: UserRow): Promise<string> {
  const raw = journal.factsOf(user).uiLang;
  const lang = isLang(raw) ? raw : isLang(user.locale) ? user.locale : "nb";
  const training = await journal.activeTraining(user.id);
  if (!training) return copy.reminderPingNoPlan(lang);
  const next = await journal.nextSession(user.id, training);
  if (!next) return copy.reminderPingDone(lang, training.name);
  const load = next.load != null ? `${next.load}${next.session.unit ? ` ${next.session.unit}` : ""}` : "";
  const line =
    lang === "en"
      ? `Today: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`
      : `I dag: ${next.session.title}${load ? ` (${load})` : ""}${next.session.est ? ` · ${next.session.est}` : ""}`;
  return copy.reminderPingToday(lang, line);
}

export async function isReminderDue(reminder: ReminderRow, user: UserRow, now: Date): Promise<boolean> {
  if (!reminder.enabled) return false;
  if (user.health_status === "OPTED_OUT" || user.health_status === "CRITICAL") return false;
  const local = localParts(user.tz, now);
  if (reminder.last_fired_on === local.date) return false;
  const scheduled = reminder.hour * 60 + reminder.minute;
  const current = local.hour * 60 + local.minute;
  if (current < scheduled) return false;
  if (current - scheduled > CATCHUP_MINUTES) return false;
  if (await journal.trainedOnDay(user.id, local.date, user.tz)) return false;
  return true;
}

export async function fireDueReminders(
  now = new Date(),
  send: (chatId: string, body: string, userId: string) => Promise<void> = sendReminder,
): Promise<number> {
  let sent = 0;
  for (const reminder of await journal.listEnabledReminders()) {
    const user = await journal.getUser(reminder.user_id);
    if (!user) continue;
    if (!(await isReminderDue(reminder, user, now))) continue;
    const body = await reminderBody(user);
    try {
      await send(user.chat_id, body, user.id);
      await journal.markReminderFired(reminder.id, localParts(user.tz, now).date);
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
  await journal.logMessage(userId, "pt", clipped);
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
