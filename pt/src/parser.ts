export type HeuristicIntent =
  | {
      kind: "log";
      confident: true;
      trackKind: "habit" | "recovery";
      slug: string;
      name: string;
      tags: string[];
      quantity: { value: number; unit: string } | null;
      note?: string;
    }
  | { kind: "rpe"; confident: true; quality: "lett" | "passe" | "brutalt" | "hoppet" }
  | { kind: "today"; confident: true }
  | { kind: "activate"; confident: true }
  | { kind: "archive"; confident: true }
  | { kind: "reminder_set"; confident: true; hour: number; minute: number }
  | { kind: "reminder_cancel"; confident: true }
  | { kind: "unknown"; confident: false };

const NUM = "(\\d+(?:[.,]\\d+)?)";

function num(s: string): number {
  return Number(s.replace(",", "."));
}

function glasses(raw: string): number {
  const t = raw.toLowerCase();
  if (t === "et" || t === "ett" || t === "et glass") return 1;
  return num(raw);
}

export function parseMessage(body: string): HeuristicIntent {
  const text = body.trim();
  if (!text) return { kind: "unknown", confident: false };

  const lower = text.toLowerCase();

  if (/^(kjør programmet|kjør opplegget|kjør)$/i.test(text)) {
    return { kind: "activate", confident: true };
  }
  if (/^arkiver og lag nytt$/i.test(text)) {
    return { kind: "archive", confident: true };
  }

  if (/\b(slutt å minne|ikke minn meg|avbryt påminnelse|skru av påminnelse)\b/i.test(lower)) {
    return { kind: "reminder_cancel", confident: true };
  }

  if (/\b(minn meg|minne meg|påminn meg)\b/i.test(lower) || (/\bpåminnelse\b/i.test(lower) && /\b(kl|hver dag|trene|trening)\b/i.test(lower))) {
    return { kind: "reminder_set", confident: true, ...parseClock(lower) };
  }

  if (/^(hva (trener|gjør) jeg( i dag)?|i dag\??|neste økt)$/i.test(lower)) {
    return { kind: "today", confident: true };
  }

  if (/^(lett|passe|brutalt|hoppet)$/i.test(lower) || /^hoppet over$/i.test(lower)) {
    const q = lower.startsWith("hoppet") ? "hoppet" : (lower as "lett" | "passe" | "brutalt");
    return { kind: "rpe", confident: true, quality: q };
  }

  const water =
    text.match(new RegExp(`(?:drakk|drukket)\\s+(et|ett|${NUM})\\s*glass`, "i")) ||
    text.match(new RegExp(`(${NUM}|et|ett)\\s*glass(?:\\s+vann)?`, "i")) ||
    text.match(/vannglass/i);
  if (water) {
    const raw = water[1] && water[1] !== "vannglass" ? water[1] : "1";
    return {
      kind: "log",
      confident: true,
      trackKind: "habit",
      slug: "vann",
      name: "Vann",
      tags: ["vann"],
      quantity: { value: glasses(raw), unit: "glass" },
    };
  }

  const cold = text.match(
    new RegExp(`(?:kaldt\\s*bad|isbad|isbadet|cold\\s*plunge).{0,20}?(?:i\\s*)?${NUM}\\s*(sek(?:under)?|min(?:utt(?:er)?)?)`, "i"),
  );
  const coldBare = /kaldt\s*bad|isbad|cold\s*plunge/i.test(text);
  if (cold) {
    const unit = /min/i.test(cold[2]) ? "min" : "s";
    return {
      kind: "log",
      confident: true,
      trackKind: "recovery",
      slug: "kaldt-bad",
      name: "Kaldt bad",
      tags: ["kaldt", "bad"],
      quantity: { value: num(cold[1]), unit },
    };
  }
  if (coldBare && text.length < 80) {
    return {
      kind: "log",
      confident: true,
      trackKind: "recovery",
      slug: "kaldt-bad",
      name: "Kaldt bad",
      tags: ["kaldt", "bad"],
      quantity: null,
    };
  }

  const med = text.match(
    new RegExp(`(?:mediterte|meditasjon|mediterer).{0,20}?(?:i\\s*)?${NUM}\\s*(sek(?:under)?|min(?:utt(?:er)?)?)`, "i"),
  );
  const medBare = /mediterte|meditasjon/i.test(text);
  if (med) {
    const unit = /min/i.test(med[2]) ? "min" : "s";
    return {
      kind: "log",
      confident: true,
      trackKind: "habit",
      slug: "meditasjon",
      name: "Meditasjon",
      tags: ["meditasjon"],
      quantity: { value: num(med[1]), unit },
    };
  }
  if (medBare && text.length < 80) {
    return {
      kind: "log",
      confident: true,
      trackKind: "habit",
      slug: "meditasjon",
      name: "Meditasjon",
      tags: ["meditasjon"],
      quantity: null,
    };
  }

  return { kind: "unknown", confident: false };
}

export function parseClock(text: string): { hour: number; minute: number } {
  const m =
    text.match(/\bkl\.?\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
    text.match(/\bklokken\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) ||
    text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) {
    const hour = Number(m[1]);
    const minute = m[2] != null ? Number(m[2]) : 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }
  return { hour: 8, minute: 0 };
}
