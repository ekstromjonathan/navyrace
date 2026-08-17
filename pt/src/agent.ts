import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import { resolveOnceOn, addLocalDays, dayAnchorIso, todayInTz } from "./db.ts";
import * as journal from "./journal.ts";
import * as copy from "./copy.ts";
import type { Lang } from "./locale.ts";
import type { Plan, TrackKind, UserRow } from "./types.ts";

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_snapshot",
    description:
      "Les journalen: facts, missingForPlan, spor, dagens økt, logger, notater, påminnelser. Kall tidlig. Dette er sannheten du bygger på.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "recall_chat",
    description:
      "Hent eldre meldinger fra dialogen (tilbake i tid). Bruk når brukeren sier de allerede har svart, «se i loggen», eller når facts mangler men de kan ha fortalt det før.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "1–40, default 20" },
        contains: { type: "string", description: "Valgfri tekstfilter (f.eks. «dager», «kettlebell»)" },
      },
    },
  },
  {
    name: "log_entry",
    description:
      "Logg noe brukeren gjorde. Viktig: når de sier de har trent / gjort en økt — også hvis det IKKE matcher planen — kall dette med en gang. Bruk kind=training, note=hva de faktisk gjorde. sessionRef=plan-id (f.eks. w1d1) hvis det er dagens/planlagte økt (eller de sier «dagens økt»); ellers sessionRef=extra:YYYY-MM-DD så det trackes uten å hoppe i planen. day=today|yesterday — hvis usikkert hvilken dag: IKKE gjett, spør «i dag eller i går?» først.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        kind: { type: "string", enum: ["training", "nutrition", "habit", "recovery", "custom"] },
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        value: { type: "number" },
        unit: { type: "string" },
        quality: { type: "string" },
        note: { type: "string" },
        sessionRef: { type: "string" },
        day: {
          type: "string",
          enum: ["today", "yesterday"],
          description: "Hvilken lokal kalenderdag økta tilhører. Påkrevd for treningsøkter.",
        },
      },
      required: ["slug", "kind", "name"],
    },
  },
  {
    name: "add_note",
    description:
      "Kort PT-notat du vil huske (smerte, liv, mønster, avklaring). Oppdater når noe endrer seg. Maks 1–2 setninger.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string" },
        body: { type: "string" },
        trackId: { type: "string" },
      },
      required: ["kind", "body"],
    },
  },
  {
    name: "set_fact",
    description:
      "Lagre/oppdater viktig brukerinfo med en gang de forteller det: goal, level (erfaring), identity, why, daysPerWeek (tall), equipment (liste), weightKg, injuries. Kall før du spør neste spørsmål. Oppdater hvis de endrer mening.",
    input_schema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  {
    name: "create_track",
    description: "Opprett et spor. Training opprettes som draft.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["training", "nutrition", "habit", "recovery", "custom"] },
        slug: { type: "string" },
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["kind", "slug", "name"],
    },
  },
  {
    name: "propose_plan",
    description:
      "Lag treningsutkast (draft) via programmer-hatten. Kall så snart missingForPlan er tom — ikke spør «skal jeg lage?» hvis de allerede har bedt om program eller sagt ja. Presenter uke 1 med korte detaljer per økt (ikke bare titler), si at det justeres etter hvordan øktene føles, og at de låser med ja/ok/kjør.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        weeks: { type: "number" },
        daysPerWeek: { type: "number" },
        brief: {
          type: "string",
          description: "Mål, hvem de vil bli, hvorfor, utstyr, skader, erfaring — det programmeren trenger.",
        },
        sessions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              week: { type: "number" },
              title: { type: "string" },
              loadKey: { type: "string" },
              load: { type: "number" },
              unit: { type: "string" },
              est: { type: "string" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, detail: { type: "string" } },
                  required: ["name"],
                },
              },
            },
            required: ["id", "title"],
          },
        },
      },
    },
  },
  {
    name: "request_archive",
    description: "Start arkivering av et spor. Sletter ingenting. Brukeren må bekrefte med «arkiver og lag nytt».",
    input_schema: {
      type: "object",
      properties: { trackId: { type: "string" } },
      required: ["trackId"],
    },
  },
  {
    name: "archive_entry",
    description:
      "Arkiver én logg. Sletting/fjerning = arkivering, aldri hard delete. Ingen dobbeltbekreftelse. Bruk entryId fra snapshot, eller siste live logg (valgfri slug / kind).",
    input_schema: {
      type: "object",
      properties: {
        entryId: { type: "string" },
        slug: { type: "string", description: "Hvis entryId mangler: siste live logg på dette sporet (f.eks. vann)." },
        kind: { type: "string", enum: ["training", "nutrition", "habit", "recovery", "custom"] },
        reason: { type: "string" },
      },
    },
  },
  {
    name: "request_activate",
    description:
      "Be om myk bekreftelse for å låse et draft-program. Brukeren kan svare ja / ok / kjør — ikke krev eksakt frase. Arkivering er den eneste handlingen som krever eksakt bekreftelse.",
    input_schema: {
      type: "object",
      properties: { trackId: { type: "string" } },
      required: ["trackId"],
    },
  },
  {
    name: "set_reminder",
    description:
      "Sett trenings- eller videopåminnelse (brukerens tidssone). Default kl 08:00. scope=once for i kveld/i dag/tonight; scope=daily for hver dag eller når uvisst. url=full lenke når brukeren deler video/link og vil minnes. Ingen ekstra bekreftelse — bare sett og bekreft kort.",
    input_schema: {
      type: "object",
      properties: {
        hour: { type: "number", description: "0–23, default 8" },
        minute: { type: "number", description: "0–59, default 0" },
        scope: {
          type: "string",
          enum: ["daily", "once"],
          description: "daily = recurring, once = one-shot today/tonight",
        },
        url: {
          type: "string",
          description: "Full http(s) URL to include in the ping (YouTube, Vimeo, etc.)",
        },
      },
    },
  },
  {
    name: "cancel_reminder",
    description: "Skru av treningspåminnelse (daglig eller engangs).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function systemPrompt(lang: Lang, opts: { onboarding: boolean; firstContact: boolean }): string {
  const language = lang === "en" ? "English" : lang === "sv" ? "Swedish" : "Norwegian (bokmål)";
  const confirm =
    lang === "en"
      ? 'Lock a draft with a normal yes/ok/run it. Archive still needs exactly “archive and start new”.'
      : lang === "sv"
        ? 'Lås ett utkast med vanligt ja/ok/kör. Arkivering kräver fortfarande exakt «arkivera och gör nytt».'
        : 'Lås et utkast med vanlig ja/ok/kjør. Arkivering krever fortsatt nøyaktig «arkiver og lag nytt».';

  let onboard = "";
  if (opts.firstContact) {
    onboard =
      lang === "en"
        ? `First message ever. Match the welcome: casual, not a PT pitch. (1) “I'm ${env.coachName}. Your new coach.” (2) one line that you keep track of whatever they send — workouts, habits, reminders. (3) one open question: what they want to keep on top of. No feature list, no week-1 funnel, no “save this number”.`
        : lang === "sv"
          ? `Första meddelandet någonsin. Samma välkomst: ledig, inte ett PT-pitch. (1) «Jag är ${env.coachName}. Din nya coach.» (2) en rad att du håller koll på det de skickar — pass, vanor, påminnelser. (3) en öppen fråga: vad de vill hålla koll på. Ingen funktionslista, ingen vecka-1-tratt, inte «spara numret».`
          : `Første melding noensinne. Samme velkomst: uformell, ikke et PT-pitch. (1) «Jeg er ${env.coachName}. Din nye coach.» (2) én linje at du holder styr på det de sender — økter, vaner, påminnelser. (3) ett åpent spørsmål: hva de har lyst å holde styr på. Ingen funksjonsliste, ingen uke-1-trakt, ikke «lagre nummeret».`;
  } else if (opts.onboarding) {
    onboard =
      lang === "en"
        ? `They already got the intro (coach who tracks workouts, habits, reminders). Do NOT re-introduce or re-list. Follow what they just said: training/program → set_fact toward a draft (goal/identity, level, daysPerWeek, equipment) and propose_plan when ready; a habit/log → log_entry / create_track; a reminder → set_reminder. Don't push week 1 unless they asked for training. One question if anything is missing.`
        : lang === "sv"
          ? `De har redan fått introt (coach som håller koll på pass, vanor, påminnelser). Presentera dig INTE på nytt. Följ det de just sa: träning/program → set_fact mot utkast (goal/identity, level, daysPerWeek, equipment) och propose_plan när det räcker; vana/logg → log_entry / create_track; påminnelse → set_reminder. Tryck inte vecka 1 om de inte bad om träning. En fråga om något saknas.`
          : `De har allerede fått introen (coach som holder styr på økter, vaner, påminnelser). IKKE presenter deg på nytt. Følg det de nettopp sa: trening/program → set_fact mot utkast (goal/identity, level, daysPerWeek, equipment) og propose_plan når det holder; vane/logg → log_entry / create_track; påminnelse → set_reminder. Ikke dytt uke 1 med mindre de ba om trening. Ett spørsmål hvis noe mangler.`;
  }

  return `You are ${env.coachName}, a coach over iMessage — training, habits, reminders, whatever they want tracked.

Language: Reply only in ${language}. The user started in this language. Never switch. ${confirm}

## Memory (critical)
- Journal facts/notes/entries are durable truth. Recent chat is evidence of what they already said.
- Call get_snapshot early. If they say they already answered or “check the log”, call recall_chat — then set_fact from what you find. Never claim the log is empty if chat shows otherwise.
- Whenever they tell you something important (goal, experience, days, gear, identity, why, injury), call set_fact / add_note before your next question. Update if they change their mind.
- If something doesn't add up (contradiction, vague number, conflicting gear), ask one short clarifying question — then continue.

## Speed to program
- Prefer 1 missing field per turn. Don't stack identity + why + experience if goal was already rich.
- Don't ask “should I make a program?” when they already said yes / “make a week plan” / readyForPlan is true — draft it.
- After propose_plan: present week 1 with short details per session (exercises/distance), say it adapts from how training feels, and that they lock with ja/ok/kjør (normal assent — not a magic phrase).
- If they ask for more detail on the draft, answer — do NOT treat that as cancelling. If pending activate and they say ja/ok/kjør, it's locked.
- Don't keep re-asking them to lock after they've already asked to start / said kjør.

## Training stance
- Assume they want to train and will train. Never ask “are you training today?” / “do you have time to train?”. Present today's session (or the next step toward a plan).
- When they report a workout (done / finished / “gjorde økt” / logged kettlebell etc.): ALWAYS call log_entry immediately — even if it wasn't exactly the prescribed session. Put what they actually did in note.
- If which calendar day is unclear (no “i dag” / “i går” / “nå”), ask one short question: today or yesterday? Do not guess.
- Planned session (“dagens økt” or matching today): sessionRef = today's plan id from snapshot. Extra/different session: sessionRef = extra:YYYY-MM-DD so it still tracks the day without skipping ahead in the plan.
- After a session is logged: ask how hard it felt — lett / passe / brutalt — and how it felt in the body. Log quality. Next similar planned session auto-adjusts.
- When a plan is active: lead with today's session, not a check-in about motivation to show up. Never answer a log with only the plan dump — persist first.

## Style
- Max 4–6 lines. One next action. At most one question.
- Plain, informal words. No jargon (RPE, OCR, HIIT, zone 2) — say how hard it felt, obstacle race, intervals, easy conversational pace.
- Sound like a friend who knows training. Short ack, then move forward. No effects, no spam. Include a link in replies only when the user shared one and asked for a reminder ping.
- You are not a doctor. On pain: log it, ease load, refer out if it lasts.
- Don't invent history. Don't delete active programs — request_archive. Don't hard-delete logs — archive_entry.
- Reminders via set_reminder when they ask. Infer once (i kveld/i dag) vs daily — no confirmation gate. Pass url when they share a video/link. Video/link pings fire even if they already logged training that day. Training pings skip if a session is already logged. One-shot disables after firing.
${onboard}`.trim();
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  return JSON.parse(raw.slice(start, end + 1));
}

async function generatePlanWithSmart(user: UserRow, input: Record<string, unknown>): Promise<Plan> {
  const hinted = Array.isArray(input.sessions) ? (input.sessions as Plan["sessions"]) : [];
  const client = llmClient();
  if (!client || !env.smartModel) {
    return {
      weeks: input.weeks != null ? Number(input.weeks) : undefined,
      daysPerWeek: input.daysPerWeek != null ? Number(input.daysPerWeek) : undefined,
      sessions: hinted,
    };
  }
  const res = await client.messages.create({
    model: env.smartModel,
    max_tokens: 4096,
    system: `Du er programmer-hatten til ${env.coachName}. Skriv KUN JSON:
{"weeks":number,"daysPerWeek":number,"sessions":[{"id":"w1d1","week":1,"title":string,"loadKey":string,"load":number,"unit":string,"est":string,"items":[{"name":string,"detail":string}]}]}
Regler: utstyr og skader i facts styrer øvelsene. loadKey grupperer like økter så innsats-tilbakemelding (lett/passe/brutalt) kan justere neste. 3–6 økter per uke. Enkelt språk i titler og detaljer — ingen forkortelser. Ikke prosa.`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          facts: journal.factsOf(user),
          notes: await journal.recentNotes(user.id, 8),
          brief: input.brief ?? null,
          weeks: input.weeks ?? null,
          daysPerWeek: input.daysPerWeek ?? null,
        }),
      },
    ],
  });
  const text = res.content
    .filter((c): c is Anthropic.Messages.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const parsed = extractJsonObject(text) as Plan;
  if (!Array.isArray(parsed.sessions) || parsed.sessions.length < 1) {
    throw new Error("programmer returned no sessions");
  }
  return parsed;
}

async function runTool(
  user: UserRow,
  lang: Lang,
  name: string,
  input: Record<string, unknown>,
  messageId: string,
): Promise<string> {
  switch (name) {
    case "get_snapshot":
      return JSON.stringify(await journal.snapshot(user));
    case "recall_chat":
      return JSON.stringify(
        await journal.recallChat(user.id, {
          limit: input.limit != null ? Number(input.limit) : 20,
          contains: input.contains ? String(input.contains) : undefined,
        }),
      );
    case "log_entry": {
      const slug = String(input.slug);
      const kind = input.kind as TrackKind;
      const track = await journal.ensureTrack({
        userId: user.id,
        kind,
        slug,
        name: String(input.name || slug),
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      });
      const quantity =
        input.value != null ? { value: Number(input.value), unit: String(input.unit || "") } : null;
      const dayRaw = input.day != null ? String(input.day) : "";
      let occurredAt: string | undefined;
      if (dayRaw === "today" || dayRaw === "yesterday") {
        const today = todayInTz(user.tz);
        const dayYmd = dayRaw === "today" ? today : addLocalDays(today, -1);
        occurredAt = dayAnchorIso(dayYmd);
      }
      if (kind === "training" && input.note && !dayRaw) {
        return JSON.stringify({
          ok: false,
          needDay: true,
          ask:
            lang === "en"
              ? "Which day should I log that on — today or yesterday?"
              : lang === "sv"
                ? "Vilken dag ska jag logga det på — idag eller igår?"
                : "Hvilken dag skal jeg logge det på — i dag eller i går?",
        });
      }
      const result = await journal.logEntry({
        trackId: track.id,
        userId: user.id,
        quantity,
        quality: input.quality ? String(input.quality) : null,
        note: input.note ? String(input.note) : null,
        sessionRef: input.sessionRef ? String(input.sessionRef) : null,
        source: "llm",
        linqMessageId: `${messageId}:${slug}`,
        occurredAt,
      });
      return JSON.stringify({ ok: true, trackId: track.id, duplicate: result.duplicate, id: result.id });
    }
    case "add_note":
      return JSON.stringify({
        id: await journal.addNote({
          userId: user.id,
          trackId: input.trackId ? String(input.trackId) : null,
          kind: String(input.kind),
          body: String(input.body),
        }),
      });
    case "set_fact": {
      const patch: Record<string, unknown> = { ...input };
      if (patch.daysPerWeek != null) {
        const n = Number(patch.daysPerWeek);
        if (Number.isFinite(n)) patch.daysPerWeek = n;
      }
      if (typeof patch.equipment === "string") {
        patch.equipment = patch.equipment
          .split(/[,;/]| og /i)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return JSON.stringify(await journal.setFacts(user.id, patch));
    }
    case "create_track": {
      const track = await journal.createTrack({
        userId: user.id,
        kind: input.kind as TrackKind,
        slug: String(input.slug),
        name: String(input.name),
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        status: input.kind === "training" ? "draft" : "active",
      });
      return JSON.stringify({ id: track.id, status: track.status });
    }
    case "propose_plan": {
      let plan: Plan;
      try {
        plan = env.smartModel
          ? await generatePlanWithSmart(user, input)
          : {
              weeks: input.weeks != null ? Number(input.weeks) : undefined,
              daysPerWeek: input.daysPerWeek != null ? Number(input.daysPerWeek) : undefined,
              sessions: (input.sessions as Plan["sessions"]) ?? [],
            };
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : "programmer failed" });
      }
      if (!plan.sessions?.length) return JSON.stringify({ error: "sessions required" });
      let track = input.trackId
        ? await journal.getTrack(String(input.trackId))
        : await journal.draftTraining(user.id);
      if (!track) {
        track = await journal.createTrack({
          userId: user.id,
          kind: "training",
          slug: "program",
          name: "Treningsprogram",
          tags: ["training"],
          status: "draft",
          plan,
        });
      } else {
        if (track.status === "active") return JSON.stringify({ error: "active program is locked — request_archive first" });
        track = await journal.setPlan(track.id, plan);
      }
      await journal.setPending(user.id, {
        type: "activate_confirm",
        trackId: track.id,
        summary: copy.activatePrompt(lang, track.name, plan.sessions.length),
        askedAt: new Date().toISOString(),
      });
      const week1 = plan.sessions.filter((s) => (s.week ?? 1) === 1);
      return JSON.stringify({
        trackId: track.id,
        status: "draft",
        weeks: plan.weeks,
        daysPerWeek: plan.daysPerWeek,
        sessionCount: plan.sessions.length,
        week1: week1.map((s) => ({
          title: s.title,
          est: s.est ?? null,
          load: s.load ?? null,
          unit: s.unit ?? null,
          items: (s.items ?? []).slice(0, 5).map((it) => ({
            name: it.name,
            detail: it.detail ?? null,
          })),
        })),
        titles: plan.sessions.slice(0, 8).map((s) => s.title),
        confirm: copy.activatePrompt(lang, track.name, plan.sessions.length),
        adaptHint:
          lang === "en"
            ? "Present week 1 with short details, say it adapts from how sessions feel, and that yes/ok/run it locks it."
            : lang === "sv"
              ? "Presentera vecka 1 med korta detaljer, säg att det anpassas efter känsla, och att ja/ok/kör låser."
              : "Presentér uke 1 med korte detaljer, si at det tilpasses etter følelse, og at ja/ok/kjør låser.",
        writer: env.smartModel || env.model,
      });
    }
    case "request_archive": {
      const track = await journal.getTrack(String(input.trackId));
      if (!track) return JSON.stringify({ error: "missing track" });
      const summary = copy.archivePrompt(
        lang,
        track.name,
        await journal.entryCount(track.id),
        await journal.noteCount(track.id),
      );
      await journal.setPending(user.id, {
        type: "archive_confirm",
        trackId: track.id,
        summary,
        askedAt: new Date().toISOString(),
      });
      return JSON.stringify({ confirm: summary });
    }
    case "archive_entry": {
      const kindRaw = input.kind ? String(input.kind) : "";
      const trackKind = (
        ["training", "nutrition", "habit", "recovery", "custom"] as const
      ).includes(kindRaw as TrackKind)
        ? (kindRaw as TrackKind)
        : undefined;
      const rec = await journal.archiveEntry({
        userId: user.id,
        entryId: input.entryId ? String(input.entryId) : undefined,
        slug: input.slug ? String(input.slug) : undefined,
        trackKind,
        reason: input.reason ? String(input.reason) : "user_requested",
      });
      if (!rec) return JSON.stringify({ error: "no live log to archive" });
      return JSON.stringify({
        ok: true,
        alreadyArchived: Boolean(rec.alreadyArchived),
        id: rec.id,
        slug: rec.slug,
        name: rec.name,
        confirm: copy.entryArchived(lang, rec.name),
      });
    }
    case "request_activate": {
      const track = await journal.getTrack(String(input.trackId));
      if (!track) return JSON.stringify({ error: "missing track" });
      const sessions = journal.planOf(track)?.sessions.length ?? 0;
      const summary = copy.activatePrompt(lang, track.name, sessions);
      await journal.setPending(user.id, {
        type: "activate_confirm",
        trackId: track.id,
        summary,
        askedAt: new Date().toISOString(),
      });
      return JSON.stringify({ confirm: summary });
    }
    case "set_reminder": {
      const hour = input.hour == null ? 8 : Number(input.hour);
      const minute = input.minute == null ? 0 : Number(input.minute);
      const scope = String(input.scope || "") === "once" ? "once" : "daily";
      const urlRaw = typeof input.url === "string" ? input.url.trim() : "";
      const url = urlRaw.startsWith("http") ? urlRaw.replace(/[.,!?;:]+$/, "") : null;
      const urlOpt = url ? { url } : { url: null as string | null };
      if (scope === "once") {
        const onceOn = resolveOnceOn(user.tz, hour, minute);
        const rec = await journal.upsertReminder(user.id, "train", hour, minute, { onceOn, ...urlOpt });
        return JSON.stringify({
          ok: true,
          hour: rec.hour,
          minute: rec.minute,
          onceOn,
          url: rec.url,
          tz: user.tz,
          confirm: url
            ? copy.reminderConfirmOnceWithUrl(lang, rec.hour, rec.minute, onceOn, user.tz, url)
            : copy.reminderConfirmOnce(lang, rec.hour, rec.minute, onceOn, user.tz),
        });
      }
      const rec = await journal.upsertReminder(user.id, "train", hour, minute, { onceOn: null, ...urlOpt });
      return JSON.stringify({
        ok: true,
        hour: rec.hour,
        minute: rec.minute,
        url: rec.url,
        tz: user.tz,
        confirm: url
          ? copy.reminderConfirmWithUrl(lang, rec.hour, rec.minute, user.tz, url)
          : copy.reminderConfirm(lang, rec.hour, rec.minute, user.tz),
      });
    }
    case "cancel_reminder": {
      const had = await journal.disableReminder(user.id, "train");
      return JSON.stringify({ ok: true, disabled: Boolean(had) });
    }
    default:
      return JSON.stringify({ error: `unknown tool ${name}` });
  }
}

function isTransientLlmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number } | null)?.status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  return /429|rate.?limit|5\d\d|timeout|timed out|ECONNRESET|fetch failed|overloaded/i.test(msg);
}

async function createWithRetry(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Messages.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (!isTransientLlmError(err)) throw err;
    await new Promise((r) => setTimeout(r, 600));
    return await client.messages.create(params);
  }
}

export async function runAgent(
  user: UserRow,
  body: string,
  messageId: string,
  opts: { lang: Lang; onboarding: boolean },
): Promise<string> {
  const client = llmClient();
  if (!client) {
    return copy.noLlm(opts.lang);
  }
  try {
    const snap = await journal.snapshot(user);
    const { recentChat: _chatInSnap, ...journalSnap } = snap;
    const chat = await journal.recentChat(user.id, 24, messageId);
    const firstContact = chat.length === 0;
    const chatLines =
      chat.length === 0
        ? "(none yet)"
        : chat.map((m) => `${m.role === "user" ? "User" : "PT"}: ${m.body}`).join("\n");
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: "user",
        content: `Recent messages (what they already said — use recall_chat if you need older turns):\n${chatLines}\n\nJournal:\n${JSON.stringify({ ...journalSnap, fresh: opts.onboarding, firstContact, locale: opts.lang })}\n\nUser message:\n${body}`,
      },
    ];

    for (let i = 0; i < 6; i++) {
      const res = await createWithRetry(client, {
        model: env.model,
        max_tokens: 900,
        system: systemPrompt(opts.lang, { onboarding: opts.onboarding, firstContact }),
        tools: TOOLS,
        messages,
      });
      const toolUses = res.content.filter((c): c is Anthropic.Messages.ToolUseBlock => c.type === "tool_use");
      const texts = res.content.filter((c): c is Anthropic.Messages.TextBlock => c.type === "text").map((c) => c.text);
      if (res.stop_reason === "end_turn" || toolUses.length === 0) {
        return (texts.join("\n").trim() || "Ok.").slice(0, 1200);
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: await runTool(user, opts.lang, tu.name, (tu.input ?? {}) as Record<string, unknown>, messageId),
        });
      }
      messages.push({ role: "user", content: results });
    }
    return copy.agentStopped(opts.lang);
  } catch (err) {
    return copy.agentError(opts.lang, err);
  }
}

function llmClient(): Anthropic | null {
  if (env.openrouterKey) {
    return new Anthropic({
      apiKey: env.openrouterKey,
      baseURL: "https://openrouter.ai/api",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/ekstromjonathan/navyrace",
        "X-Title": `${env.coachName} PT`,
      },
    });
  }
  if (env.anthropicKey) return new Anthropic({ apiKey: env.anthropicKey });
  return null;
}
