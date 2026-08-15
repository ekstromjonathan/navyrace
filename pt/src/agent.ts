import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import * as journal from "./journal.ts";
import * as copy from "./copy.ts";
import type { Lang } from "./locale.ts";
import type { Plan, TrackKind, UserRow } from "./types.ts";

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_snapshot",
    description: "Les journalen: spor, dagens økt, siste logger, notater, påminnelser og korte siste meldinger. Kall først.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "log_entry",
    description: "Logg noe brukeren gjorde (vane, restitusjon, eller RPE på en økt).",
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
      },
      required: ["slug", "kind", "name"],
    },
  },
  {
    name: "add_note",
    description: "Kort PT-notat (smerte, liv, mønster). Maks én-to setninger.",
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
    description: "Lagre et brukerfelt (mål, nivå, dager, utstyr, vekt, skade).",
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
      "Be programmer-hatten skrive et treningsutkast (draft). Aktiveres ikke før brukeren skriver «kjør programmet». Fyll brief + uker/dager; sessions kan være tomme.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        weeks: { type: "number" },
        daysPerWeek: { type: "number" },
        brief: { type: "string", description: "Mål, utstyr, skader, nivå — det programmeren trenger." },
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
    description: "Be om bekreftelse for å låse et draft-program. Brukeren må skrive «kjør programmet».",
    input_schema: {
      type: "object",
      properties: { trackId: { type: "string" } },
      required: ["trackId"],
    },
  },
  {
    name: "set_reminder",
    description:
      "Sett daglig treningspåminnelse (brukerens tidssone). Default kl 08:00. Kall bare når brukeren ber om å bli minnet.",
    input_schema: {
      type: "object",
      properties: {
        hour: { type: "number", description: "0–23, default 8" },
        minute: { type: "number", description: "0–59, default 0" },
      },
    },
  },
  {
    name: "cancel_reminder",
    description: "Skru av daglig treningspåminnelse.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function systemPrompt(lang: Lang, onboarding: boolean): string {
  const language = lang === "en" ? "English" : "Norwegian (bokmål)";
  const confirm =
    lang === "en"
      ? 'Activate with exactly “run the program”. Archive with exactly “archive and start new”.'
      : 'Aktiver med nøyaktig «kjør programmet». Arkiver med nøyaktig «arkiver og lag nytt».';
  const onboard = onboarding
    ? lang === "en"
      ? `The journal is empty. This is first contact. Introduce yourself as ${env.coachName}, their iMessage PT. You keep a private log (training, food, habits, recovery) and can draft a program they must confirm. One short intro, one question (what they want from this). Do not dump features. Do not invent history they haven't told you.`
      : `Journalen er tom. Dette er første møte. Presenter deg som ${env.coachName}, PT over iMessage. Du fører en privat logg (trening, mat, vaner, restitusjon) og kan lage et program de må bekrefte. Én kort intro, ett spørsmål (hva de vil ha ut av dette). Ikke dump funksjoner. Ikke finn på historikk de ikke har fortalt.`
    : "";
  return `You are ${env.coachName}, a personal trainer over iMessage.

Language: Reply only in ${language}. The user started in this language. Never switch. ${confirm}

You do not own the truth — the journal does. Call get_snapshot before you advise.
Recent messages are working memory for “yes/that/ok”, not truth.
Max 4–6 lines. One next action. At most one question, and only if that field is missing for *this* decision.
Don't dump the whole program. Send today / this week.
When they want a new plan: collect what's missing, then call propose_plan (the programmer hat writes sessions). Don't invent a 10-week plan in chat.
Don't delete or overwrite an active program. Use request_archive. Activation requires request_activate.
Never hard-delete logs. When they ask to remove/delete a single log, call archive_entry. No double-confirm for one log.
When they ask to be reminded (e.g. every day at 8): call set_reminder. Don't promise reminders without the tool. No nagging — one short ping, skip if a session is already logged.
You are not a doctor. On pain: log it, ease load, refer to a professional if it lasts.
No links unless they ask.
No effects, no spam. Sound like a friend who knows training.
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
Regler: utstyr og skader i facts styrer øvelsene. loadKey grupperer like økter for RPE-tilpasning. 3–6 økter per uke. Ikke prosa.`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          facts: journal.factsOf(user),
          notes: journal.recentNotes(user.id, 8),
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
      return JSON.stringify(journal.snapshot(user));
    case "log_entry": {
      const slug = String(input.slug);
      const kind = input.kind as TrackKind;
      const track = journal.ensureTrack({
        userId: user.id,
        kind,
        slug,
        name: String(input.name || slug),
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      });
      const quantity =
        input.value != null ? { value: Number(input.value), unit: String(input.unit || "") } : null;
      const result = journal.logEntry({
        trackId: track.id,
        userId: user.id,
        quantity,
        quality: input.quality ? String(input.quality) : null,
        note: input.note ? String(input.note) : null,
        sessionRef: input.sessionRef ? String(input.sessionRef) : null,
        source: "llm",
        linqMessageId: `${messageId}:${slug}`,
      });
      return JSON.stringify({ ok: true, trackId: track.id, duplicate: result.duplicate });
    }
    case "add_note":
      return JSON.stringify({
        id: journal.addNote({
          userId: user.id,
          trackId: input.trackId ? String(input.trackId) : null,
          kind: String(input.kind),
          body: String(input.body),
        }),
      });
    case "set_fact": {
      const { ...facts } = input;
      return JSON.stringify(journal.setFacts(user.id, facts));
    }
    case "create_track": {
      const track = journal.createTrack({
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
      let track = input.trackId ? journal.getTrack(String(input.trackId)) : journal.draftTraining(user.id);
      if (!track) {
        track = journal.createTrack({
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
        track = journal.setPlan(track.id, plan);
      }
      journal.setPending(user.id, {
        type: "activate_confirm",
        trackId: track.id,
        summary: copy.activatePrompt(lang, track.name, plan.sessions.length),
        askedAt: new Date().toISOString(),
      });
      return JSON.stringify({
        trackId: track.id,
        status: "draft",
        weeks: plan.weeks,
        daysPerWeek: plan.daysPerWeek,
        sessionCount: plan.sessions.length,
        titles: plan.sessions.slice(0, 8).map((s) => s.title),
        confirm: copy.activatePrompt(lang, track.name, plan.sessions.length),
        writer: env.smartModel || env.model,
      });
    }
    case "request_archive": {
      const track = journal.getTrack(String(input.trackId));
      if (!track) return JSON.stringify({ error: "missing track" });
      const summary = copy.archivePrompt(lang, track.name, journal.entryCount(track.id), journal.noteCount(track.id));
      journal.setPending(user.id, {
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
      const rec = journal.archiveEntry({
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
      const track = journal.getTrack(String(input.trackId));
      if (!track) return JSON.stringify({ error: "missing track" });
      const sessions = journal.planOf(track)?.sessions.length ?? 0;
      const summary = copy.activatePrompt(lang, track.name, sessions);
      journal.setPending(user.id, {
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
      const rec = journal.upsertReminder(user.id, "train", hour, minute);
      return JSON.stringify({
        ok: true,
        hour: rec.hour,
        minute: rec.minute,
        tz: user.tz,
        confirm: lang === "en" ? `daily at ${journal.hhmm(rec.hour, rec.minute)} (${user.tz})` : `daglig kl ${journal.hhmm(rec.hour, rec.minute)} (${user.tz})`,
      });
    }
    case "cancel_reminder": {
      const had = journal.disableReminder(user.id, "train");
      return JSON.stringify({ ok: true, disabled: Boolean(had) });
    }
    default:
      return JSON.stringify({ error: `unknown tool ${name}` });
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
    const snap = journal.snapshot(user);
    const { recentChat: _chatInSnap, ...journalSnap } = snap;
    const chat = journal.recentChat(user.id, 8, messageId);
    const chatLines =
      chat.length === 0
        ? "(none yet)"
        : chat.map((m) => `${m.role === "user" ? "User" : "PT"}: ${m.body}`).join("\n");
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: "user",
        content: `Recent messages (working memory, not truth):\n${chatLines}\n\nJournal (short):\n${JSON.stringify({ ...journalSnap, fresh: opts.onboarding, locale: opts.lang })}\n\nUser message:\n${body}`,
      },
    ];

    for (let i = 0; i < 4; i++) {
      const res = await client.messages.create({
        model: env.model,
        max_tokens: 800,
        system: systemPrompt(opts.lang, opts.onboarding),
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
