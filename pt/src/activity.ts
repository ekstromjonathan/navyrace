export type Modality =
  | "run"
  | "strength"
  | "climb"
  | "paddle"
  | "racket"
  | "cycle"
  | "swim"
  | "team"
  | "other";

const MODALITY_PATTERNS: [Modality, RegExp][] = [
  ["racket", /\b(tennis|padel(?!\w)|squash|badminton)\b/i],
  ["paddle", /\b(padl\w*|kajakk|kano|sup\b|stand.?up.?paddle)\b/i],
  ["climb", /\b(klatr\w*|boulder)\b/i],
  ["cycle", /\b(sykl\w*|spinning|bike|cycling)\b/i],
  ["swim", /\b(svøm\w*|swim\w*)\b/i],
  ["team", /\b(fotball|håndball|handball|ishockey|basket)\b/i],
  ["run", /\b(løp\w*|loping|jogge\w*|fartslek|intervall|terske|easy run|running)\b/i],
  ["strength", /\b(styrke|kettlebell|\bkb\b|markløft|knebøy|base\b|styrkeøkt)\b/i],
];

const FAMILY: Record<Modality, string> = {
  run: "impact",
  racket: "impact",
  team: "impact",
  cycle: "impact",
  climb: "upper",
  paddle: "upper",
  swim: "upper",
  strength: "strength",
  other: "other",
};

export function inferModality(text: string | null | undefined): Modality | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  for (const [mod, re] of MODALITY_PATTERNS) {
    if (re.test(raw)) return mod;
  }
  return null;
}

export function modalityOfSession(session: { title?: string; loadKey?: string } | null | undefined): Modality | null {
  if (!session) return null;
  const fromTitle = inferModality(`${session.title ?? ""} ${session.loadKey ?? ""}`);
  if (fromTitle) return fromTitle;
  const key = String(session.loadKey ?? "").toLowerCase();
  if (/lop|run|easyrun/.test(key)) return "run";
  if (/styrke|str/.test(key)) return "strength";
  if (/klatr/.test(key)) return "climb";
  if (/padl|kajakk/.test(key)) return "paddle";
  return null;
}

export function sameFamily(a: Modality | null, b: Modality | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return FAMILY[a] === FAMILY[b] && FAMILY[a] !== "other";
}

/** Two sessions too close of the same hard family (run after tennis, etc.). */
export function stacksHard(a: Modality | null, b: Modality | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return FAMILY[a] === "impact" && FAMILY[b] === "impact";
}

export function parseDurationMinutes(text: string): number | null {
  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*(?:timer|timmar|hours?|hrs?)\b/i);
  if (hours) return Math.round(Number(hours[1].replace(",", ".")) * 60);
  const mins = text.match(/(\d+)\s*(?:min(?:utt(?:er)?)?|minutes?)\b/i);
  if (mins) return Number(mins[1]);
  return null;
}

export function parseDistanceKm(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:km|k)\b/i);
  if (!m) return null;
  return Number(m[1].replace(",", "."));
}

/** Long enough that the next day should usually ease off. */
export function isHeavyDose(text: string): boolean {
  const mins = parseDurationMinutes(text);
  if (mins != null && mins >= 90) return true;
  const km = parseDistanceKm(text);
  if (km != null && km >= 12) return true;
  return false;
}

export function isExtraWording(text: string): boolean {
  return /\b(i tillegg|ekstra(økt)?|utenom|on top|in addition|plus the plan|ved siden av)\b/i.test(text);
}

export function looksLikeActivityReport(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (inferModality(t) && (parseDurationMinutes(t) != null || parseDistanceKm(t) != null)) return true;
  return /\b(spilte|spelte|padlet|klatret|syklet|svømte|jogget|løp\b)\b/i.test(t);
}

export function modalityLabel(lang: "nb" | "en" | "sv", mod: Modality): string {
  const nb: Record<Modality, string> = {
    run: "løping",
    strength: "styrke",
    climb: "klatring",
    paddle: "padling",
    racket: "tennis/ball",
    cycle: "sykling",
    swim: "svømming",
    team: "lagidrett",
    other: "trening",
  };
  const en: Record<Modality, string> = {
    run: "running",
    strength: "strength",
    climb: "climbing",
    paddle: "paddling",
    racket: "tennis",
    cycle: "cycling",
    swim: "swimming",
    team: "team sport",
    other: "training",
  };
  const sv: Record<Modality, string> = {
    run: "löpning",
    strength: "styrka",
    climb: "klättring",
    paddle: "paddling",
    racket: "tennis",
    cycle: "cykling",
    swim: "simning",
    team: "lagidrott",
    other: "träning",
  };
  if (lang === "en") return en[mod];
  if (lang === "sv") return sv[mod];
  return nb[mod];
}
