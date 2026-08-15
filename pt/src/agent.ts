import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import * as journal from "./journal.ts";
import { activatePrompt, archivePrompt } from "./gates.ts";
import type { Plan, TrackKind, UserRow } from "./types.ts";

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_snapshot",
    description: "Les journalen: spor, dagens økt, siste logger, notater og korte siste meldinger. Kall først.",
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
    name: "request_activate",
    description: "Be om bekreftelse for å låse et draft-program. Brukeren må skrive «kjør programmet».",
    input_schema: {
      type: "object",
      properties: { trackId: { type: "string" } },
      required: ["trackId"],
    },
  },
];

function systemPrompt(): string {
  return `Du er ${env.coachName}, en personlig trener over iMessage. Norsk, kort, konkret.

Du eier ikke sannheten — journalen gjør det. Kall get_snapshot før du anbefaler.
Siste meldinger er arbeidshukommelse for «ja/den/ok» og oppfølging. De er ikke sannhet.
Svar maks 4–6 linjer. Én neste handling. Still maks ett spørsmål, og bare hvis feltet mangler for *denne* avgjørelsen.
Ikke dump hele programmet. Send i dag / denne uken.
Når brukeren vil ha et nytt opplegg: samle det som mangler, så kall propose_plan (programmer-hatten skriver øktene). Ikke finn opp en 10-ukersplan i chatten.
Ikke slett eller overskriv et aktivt program. Bruk request_archive. Aktivering krever request_activate.
Du er ikke lege. Ved smerte: logg, lett belastning, henvis til fagperson hvis det vedvarer.
Ingen lenker i svaret med mindre brukeren ber om det.
Effekter og mas er forbudt. Høres ut som en venn som kan trening.`;
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

async function runTool(user: UserRow, name: string, input: Record<string, unknown>, messageId: string): Promise<string> {
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
        summary: activatePrompt(track.name, plan.sessions.length),
        askedAt: new Date().toISOString(),
      });
      return JSON.stringify({
        trackId: track.id,
        status: "draft",
        weeks: plan.weeks,
        daysPerWeek: plan.daysPerWeek,
        sessionCount: plan.sessions.length,
        titles: plan.sessions.slice(0, 8).map((s) => s.title),
        confirm: activatePrompt(track.name, plan.sessions.length),
        writer: env.smartModel || env.model,
      });
    }
    case "request_archive": {
      const track = journal.getTrack(String(input.trackId));
      if (!track) return JSON.stringify({ error: "missing track" });
      const summary = archivePrompt(track.name, journal.entryCount(track.id), journal.noteCount(track.id));
      journal.setPending(user.id, {
        type: "archive_confirm",
        trackId: track.id,
        summary,
        askedAt: new Date().toISOString(),
      });
      return JSON.stringify({ confirm: summary });
    }
    case "request_activate": {
      const track = journal.getTrack(String(input.trackId));
      if (!track) return JSON.stringify({ error: "missing track" });
      const sessions = journal.planOf(track)?.sessions.length ?? 0;
      const summary = activatePrompt(track.name, sessions);
      journal.setPending(user.id, {
        type: "activate_confirm",
        trackId: track.id,
        summary,
        askedAt: new Date().toISOString(),
      });
      return JSON.stringify({ confirm: summary });
    }
    default:
      return JSON.stringify({ error: `unknown tool ${name}` });
  }
}

function agentErrorReply(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("agent failed", msg);
  if (/deprecated|not_found_error/i.test(msg)) {
    return "Jeg hørte deg, men modellnavnet er ugyldig hos OpenRouter. Bytt PT_MODEL i pt/.env.";
  }
  if (/credit balance|too low|purchase credits/i.test(msg)) {
    return "Jeg hørte deg, men LLM-kontoen er tom for kreditt. Sett OPENROUTER_API_KEY i pt/.env, eller bruk en enkel logg: «mediterte i 30 sekunder».";
  }
  return "Jeg hørte deg, men fikk ikke laget et skikkelig svar. Prøv en kort logg, eller prøv igjen om litt.";
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

export async function runAgent(user: UserRow, body: string, messageId: string): Promise<string> {
  const client = llmClient();
  if (!client) {
    return "Jeg kan logge enkle ting (vann, kaldt bad, meditasjon, lett/passe/brutalt), men trenger OPENROUTER_API_KEY (eller Anthropic) for å svare fritt.";
  }
  try {
    const snap = journal.snapshot(user);
    const { recentChat: _chatInSnap, ...journalSnap } = snap;
    const chat = journal.recentChat(user.id, 8, messageId);
    const chatLines =
      chat.length === 0
        ? "(ingen ennå)"
        : chat.map((m) => `${m.role === "user" ? "Bruker" : "PT"}: ${m.body}`).join("\n");
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: "user",
        content: `Siste meldinger (arbeidshukommelse, ikke sannhet):\n${chatLines}\n\nJournal (kort):\n${JSON.stringify(journalSnap)}\n\nMelding fra bruker:\n${body}`,
      },
    ];

    for (let i = 0; i < 4; i++) {
      const res = await client.messages.create({
        model: env.model,
        max_tokens: 800,
        system: systemPrompt(),
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
          content: await runTool(user, tu.name, (tu.input ?? {}) as Record<string, unknown>, messageId),
        });
      }
      messages.push({ role: "user", content: results });
    }
    return "Jeg måtte stoppe — send gjerne én ting om gangen.";
  } catch (err) {
    return agentErrorReply(err);
  }
}
