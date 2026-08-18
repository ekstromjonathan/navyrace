import { completePlain, fetchUrlText } from "./llm.ts";
import { env } from "./env.ts";
import * as copy from "./copy.ts";
import * as linq from "./linq.ts";
import * as journal from "./journal.ts";
import type { Lang } from "./locale.ts";

export async function pingResearchHold(chatId: string, userId: string, lang: Lang): Promise<void> {
  const text = copy.researchHold(lang);
  try {
    await linq.sendText(chatId, text);
  } catch {
    /* still continue the research; final reply is the important one */
  }
  await journal.logMessage(userId, "pt", text);
}

export async function research(query: string, urls: string[] = []): Promise<string> {
  const pages: string[] = [];
  for (const url of urls.slice(0, 3)) {
    try {
      pages.push(`URL ${url}:\n${await fetchUrlText(url)}`);
    } catch (err) {
      pages.push(`URL ${url}: kunne ikke hentes (${err instanceof Error ? err.message : "feil"})`);
    }
  }
  const model = env.smartModel || env.model;
  return completePlain({
    model,
    maxTokens: 500,
    system: `Du er research-hatten til en iMessage-PT. Svar kort, konkret, på norsk bokmål med mindre spørsmålet er på et annet språk. Ingen jargon. Maks 8 linjer. Si hva som er sikkert vs usikkert. Du er ikke lege.`,
    user: `${query}\n\n${pages.join("\n\n")}`.trim(),
  });
}
