export type SafetyRoute = {
  kind: "cardiorespiratory" | "serious_injury" | "mental_crisis";
  signal: string;
};

type Signal = {
  kind: SafetyRoute["kind"];
  id: string;
  pattern: RegExp;
};

const SIGNALS: Signal[] = [
  {
    kind: "mental_crisis",
    id: "self-harm",
    pattern:
      /\b(jeg (?:vil|ønsker å) dø|jeg (?:vil|skal|kommer til å) ta livet mitt|i (?:want to|am going to|will) (?:die|kill myself)|jag (?:vill|ska|kommer att) (?:dö|ta livet av mig))\b/iu,
  },
  {
    kind: "cardiorespiratory",
    id: "chest-discomfort",
    pattern:
      /\b(brystsmerter?|smerter? i brystet|trykk i brystet|press i brystet|chest pain|pressure in (?:my|the) chest|chest tightness|bröstsmärta|ont i bröstet|tryck över bröstet)\b/iu,
  },
  {
    kind: "cardiorespiratory",
    id: "fainting",
    pattern:
      /\b(jeg besvimte|har besvimt|besvimelse|i fainted|i passed out|loss of consciousness|jag svimmade|har svimmat|medvetslös)\b/iu,
  },
  {
    kind: "cardiorespiratory",
    id: "breath-at-rest",
    pattern:
      /\b(tungpust(?:et)? i ro|klarer ikke (?:å )?puste|får ikke puste|short of breath at rest|can(?:not|'t) breathe|andfådd i vila|kan inte andas)\b/iu,
  },
  {
    kind: "serious_injury",
    id: "deformity-or-open-fracture",
    pattern:
      /\b(åpent brudd|beinet stikker ut|tydelig feilstilling|open fracture|bone (?:is )?sticking out|obvious deformity|öppen fraktur|benet sticker ut|tydlig felställning)\b/iu,
  },
  {
    kind: "serious_injury",
    id: "cannot-bear-weight",
    pattern:
      /\b(kan ikke belaste (?:beinet|foten)|kan ikke stå på (?:beinet|foten)|cannot bear weight|can(?:not|'t) stand on (?:my|the) (?:leg|foot)|kan inte belasta (?:benet|foten))\b/iu,
  },
];

const NEGATION =
  /\b(?:ingen|ikke|aldri|uten|no|not|never|without|don't|doesn't|didn't|inga|inte|aldrig|utan)\b(?:\s+\p{L}+){0,3}[\s,:-]*$/iu;

function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 36), index);
  const words = before.split(/\s+/).slice(-4).join(" ");
  return NEGATION.test(words);
}

/**
 * Deliberately narrow red-flag routing. It is better to leave ordinary soreness
 * to coaching than to turn every mention of pain into an emergency response.
 */
export function detectSafetyRoute(body: string): SafetyRoute | null {
  const text = body.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  if (!text) return null;
  for (const signal of SIGNALS) {
    const flags = signal.pattern.flags.includes("g") ? signal.pattern.flags : `${signal.pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(signal.pattern.source, flags))) {
      if (match.index == null || isNegated(text, match.index)) continue;
      return { kind: signal.kind, signal: signal.id };
    }
  }
  return null;
}

/** Safety status updates must never be consumed as answers to an older pending question. */
export function isSafetyFollowup(body: string): boolean {
  const text = body.replace(/[’‘]/g, "'").trim();
  return /\b(på legevakt(?:a|en)?|ringt 113|snakket med lege|får hjelp nå|er trygg nå|at the emergency room|called 911|called 113|getting help now|safe now|på akuten|ringt 112|får hjälp nu|är trygg nu)\b/iu.test(
    text,
  );
}
