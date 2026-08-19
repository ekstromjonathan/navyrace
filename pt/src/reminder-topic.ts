export type ReminderTopic = { slug: string; title: string };

/** JS \\b is ASCII-only; å/ø/æ in «på» / «økt» would not match. */
const EDGE = String.raw`(?<![\p{L}\p{N}])`;
const EDGE_END = String.raw`(?![\p{L}\p{N}])`;

const BOILERPLATE = [
  "kan du",
  "could you",
  "please",
  "minn meg",
  "minne meg",
  "påminn meg",
  "påminn mig",
  "påminn mej",
  "påminnelse",
  "påminnelser",
  "remind me",
  "reminders?",
  "reminder",
  "slutt å minne",
  "ikke minn meg",
  "avbryt",
  "skru av",
  "stop reminding",
  "don't remind",
  "sluta påminna",
  String.raw`kl\.?`,
  "klokken",
  "klockan",
  "at",
  "hver dag",
  "hver kveld",
  "daglig",
  "every day",
  "daily",
  "every evening",
  "i kveld",
  "i kväll",
  "ikväll",
  "i dag",
  "idag",
  "tonight",
  "today",
  "this evening",
  "bare i dag",
  "bare i kveld",
  "om å",
  "to",
  "på å",
  "på",
  "om",
  "se",
  "watch",
  "denne",
  "this",
  "lenken",
  "linken",
  "link",
  "videoen",
  "video",
  "ny",
  "kveldsrutine",
].join("|");

function hasTerm(text: string, pattern: string): boolean {
  return new RegExp(`${EDGE}(?:${pattern})${EDGE_END}`, "iu").test(text);
}

export function inferReminderTopic(text: string, url: string | null): ReminderTopic {
  if (url) return { slug: "video", title: "video" };
  const t = text.toLowerCase();
  if (hasTerm(t, "meditasjon|mediter|meditation")) return { slug: "meditasjon", title: "meditasjon" };
  if (hasTerm(t, String.raw`vann|water glasses?|glass vann`)) return { slug: "vann", title: "vann" };
  if (hasTerm(t, String.raw`kaldt\s*bad|isbad|cold\s*plunge`)) return { slug: "kaldt-bad", title: "kaldt bad" };
  if (hasTerm(t, String.raw`videoen|video|youtube|youtu\.be`)) return { slug: "video", title: "video" };
  if (hasTerm(t, String.raw`trene|trening|økt|okt|workout|train(?:ing)?`)) return { slug: "train", title: "trening" };

  const leftover = t
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(new RegExp(`${EDGE}(?:${BOILERPLATE})${EDGE_END}`, "giu"), " ")
    .replace(/\d{1,2}(?:[:.]\d{2})?/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const generic =
    /^(ny|new|den|det|dette|this|en|et|a|an|på|om|å|og|to|the|for|meg|rutine|routine)$/iu;
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
