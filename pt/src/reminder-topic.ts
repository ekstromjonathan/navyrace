export type ReminderTopic = { slug: string; title: string };

const BOILERPLATE =
  /\b(kan du|could you|please|minn meg|minne meg|påminn meg|påminn mig|påminn mej|påminnelse|påminnelser|remind me|reminder|reminders?|slutt å minne|ikke minn meg|avbryt|skru av|stop reminding|don't remind|sluta påminna|kl\.?|klokken|klockan|at|hver dag|daglig|every day|daily|i kveld|i kväll|ikväll|i dag|idag|tonight|today|this evening|bare i dag|bare i kveld|om å|to|på å|på|om|se|watch|denne|this|lenken|linken|link|videoen|video|ny|kveldsrutine)\b/gi;

export function inferReminderTopic(text: string, url: string | null): ReminderTopic {
  if (url) return { slug: "video", title: "video" };
  const t = text.toLowerCase();
  if (/\b(meditasjon|mediter|meditation)\b/i.test(t)) return { slug: "meditasjon", title: "meditasjon" };
  if (/\b(vann|water glasses?|glass vann)\b/i.test(t)) return { slug: "vann", title: "vann" };
  if (/\b(kaldt\s*bad|isbad|cold\s*plunge)\b/i.test(t)) return { slug: "kaldt-bad", title: "kaldt bad" };
  if (/\b(video|youtube|youtu\.be)\b/i.test(t)) return { slug: "video", title: "video" };
  if (/\b(trene|trening|økt|okt|workout|train(ing)?)\b/i.test(t)) return { slug: "train", title: "trening" };

  const leftover = t
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(BOILERPLATE, " ")
    .replace(/\b\d{1,2}(?:[:.]\d{2})?\b/g, " ")
    .replace(/[^a-zæøå0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const generic = /^(ny|new|den|det|dette|this|en|et|a|an|rutine|routine)$/i;
  if (leftover.length >= 2 && leftover.length <= 48 && !generic.test(leftover)) {
    const slug = leftover.replace(/\s+/g, "-").slice(0, 40);
    return { slug, title: leftover.slice(0, 48) };
  }
  return { slug: "train", title: "trening" };
}

export function titleForSlug(slug: string, fallback = "påminnelse"): string {
  if (slug === "train") return "trening";
  if (slug === "video") return "video";
  if (slug === "kaldt-bad") return "kaldt bad";
  return slug.replace(/-/g, " ") || fallback;
}

export function skipIfTrained(slug: string, url: string | null): boolean {
  return slug === "train" && !url;
}
