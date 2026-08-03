// MAI — samtalemanus som ren logikk (GUIDES/WOZ_ONBOARDING_AND_SESSION_SCRIPT.md).
//
// Ingen Deno-, nett- eller DB-avhengigheter: inn = profil + brukertekst,
// ut = svar + ny profil. Det gjør manuset testbart uten WhatsApp, og det er
// nøyaktig sømmen der en LLM kan overta `replyFor()` senere.

/* --------------------------------------------------------------- profile -- */

export type Profile = {
  step?: string;
  goal?: string;
  days_per_week?: number;
  mode?: "calendar" | "flexible";
  mode_detail?: string;
  level?: string;
  equipment?: string;
  first_session?: string;
  awaiting_rpe?: boolean;
  session_kind?: "full" | "min";
};

const LEVELS: Record<string, string> = {
  ny: "Ny",
  "har trent litt": "Har trent litt",
  litt: "Har trent litt",
  solid: "Solid base",
  "solid base": "Solid base",
  annen: "Annen idrett",
  "annen idrett": "Annen idrett",
};

export const MINIMUM_PACK = [
  "20 knebøy med kroppsvekt",
  "10 push-ups (knær er helt greit)",
  "2 × 30 s planke",
  "1 min rolig marsj eller gange",
].join("\n• ");

export function planCard(p: Profile): string {
  const uke = `${p.days_per_week} dager · ${
    p.mode === "calendar" ? `faste dager (${p.mode_detail ?? "—"})` : `fleksibelt (${p.mode_detail ?? "—"})`
  }`;
  return [
    "Sånn hørte jeg deg:",
    `*Mål:* ${p.goal}`,
    `*Uke:* ${uke}`,
    `*Nivå:* ${p.level}`,
    `*Utstyr:* ${p.equipment}`,
    `*Første økt:* ${p.first_session}`,
    "",
    "Stemmer? (ja / juster)",
  ].join("\n");
}

/* ----------------------------------------------------------------- reply -- */

/** Sømmen mot en LLM senere: inn = profil + tekst, ut = svar + ny profil. */
export function replyFor(profile: Profile, text: string): { reply: string; next: Profile } {
  const p: Profile = { ...profile };
  const t = text.trim();
  const low = t.toLowerCase();
  const step = p.step ?? "q0_goal";

  // Alltid tilgjengelig: dårlig dag / pause (manus §4)
  if (["pause", "pause 3 dager"].includes(low)) {
    return {
      reply: "Notert — jeg holder meg unna i tre dager. Skriv *hei* når du vil i gang igjen.",
      next: p,
    };
  }

  switch (step) {
    case "q0_goal": {
      if (!t) return { reply: "Hva trener du mest mot akkurat nå?", next: p };
      p.goal = t;
      p.step = "q1_days";
      return {
        reply:
          `${t} — notert.\n\nHvor mange dager i uka er *realistisk* — ikke idealet? Svar med et tall (2–6).`,
        next: p,
      };
    }

    case "q1_days": {
      const n = parseInt(low.match(/\d+/)?.[0] ?? "", 10);
      if (!n || n < 2 || n > 6) {
        return { reply: "Gi meg et tall mellom 2 og 6 — hva er realistisk i en vanlig uke?", next: p };
      }
      p.days_per_week = n;
      p.step = "q2_mode";
      return {
        reply:
          `${n} dager. Vil du ha *faste ukedager* (f.eks. tir/tor/lør), eller *når det passer* (jeg minner deg innen et vindu)?`,
        next: p,
      };
    }

    case "q2_mode": {
      if (low.includes("fast")) {
        p.mode = "calendar";
        p.step = "q2_detail";
        return { reply: "Hvilke dager passer best?", next: p };
      }
      if (low.includes("passer") || low.includes("fleks")) {
        p.mode = "flexible";
        p.step = "q2_detail";
        return { reply: "Når på dagen passer vanligvis best — morgen, lunsj eller kveld?", next: p };
      }
      return { reply: "Faste ukedager, eller når det passer?", next: p };
    }

    case "q2_detail": {
      p.mode_detail = t;
      p.step = "q3_level";
      return { reply: "Nivå akkurat nå — helt ærlig?\nNy · Har trent litt · Solid base · Annen idrett", next: p };
    }

    case "q3_level": {
      const hit = Object.keys(LEVELS).find((k) => low.includes(k));
      if (!hit) return { reply: "Ny, har trent litt, solid base eller annen idrett?", next: p };
      p.level = LEVELS[hit];
      p.step = "q4_equipment";
      return {
        reply: `${p.level}. Hva har du tilgang til? Skriv alt som gjelder (kroppsvekt, hjemme, gym, ute …).`,
        next: p,
      };
    }

    case "q4_equipment": {
      if (!t) return { reply: "Hva har du tilgang til?", next: p };
      p.equipment = t;
      p.step = "q5_first";
      return { reply: "Når tar vi første økt? Si dag + ca. klokkeslett — helst innen 48 timer.", next: p };
    }

    case "q5_first": {
      if (!t) return { reply: "Dag og omtrent klokkeslett?", next: p };
      p.first_session = t;
      p.step = "confirm";
      return { reply: planCard(p), next: p };
    }

    case "confirm": {
      if (low.startsWith("ja")) {
        p.step = "ready";
        return {
          reply: [
            `Notert. Jeg skriver til deg ${p.first_session}.`,
            "",
            "Første økt blir ~25–30 min — eller 8–12 min hvis dagen er tung, si bare *lett*.",
            "Du trenger ikke åpne noen app. Vi tar det her.",
          ].join("\n"),
          next: p,
        };
      }
      p.step = "q0_goal";
      return { reply: "Greit — vi tar den på nytt. Hva trener du mot?", next: p };
    }

    case "ready":
    case "done": {
      if (p.awaiting_rpe) {
        const rpe = parseInt(low.match(/\d+/)?.[0] ?? "", 10);
        if (!rpe || rpe < 1 || rpe > 10) return { reply: "Tall fra 1 til 10 — hvor hardt føltes det?", next: p };
        p.awaiting_rpe = false;
        p.step = "ready";
        const line = rpe >= 9
          ? "Tungt i dag — vi letter litt neste gang."
          : rpe <= 3
          ? "Det satt løst. Vi skrur opp litt neste gang."
          : "Bra jobba. Du er en som møter opp.";
        return { reply: `${line} Neste økt holder vi som planlagt — jeg minner deg.`, next: p };
      }

      // Merk: awaiting_rpe settes først av «ferdig». Settes den her, tolkes
      // «ferdig» som et RPE-tall og økta kan aldri lukkes.
      if (low === "start") {
        p.session_kind = "full";
        return {
          reply: [
            "Kjør. 4 øvelser, ca. 25 min.",
            "",
            "*1/4 · Knebøy* — 3×8–10, rolig tempo.",
            "Si *ferdig* når du er klar — eller *for tungt* / *for lett*.",
          ].join("\n"),
          next: p,
        };
      }

      if (low === "lett" || low.includes("minimum")) {
        p.session_kind = "min";
        return {
          reply: [
            "Minimum i dag — det teller fullt ut.",
            "",
            `• ${MINIMUM_PACK}`,
            "",
            "Si *ferdig* når du er gjennom.",
          ].join("\n"),
          next: p,
        };
      }

      if (low === "ferdig") {
        p.awaiting_rpe = true;
        return { reply: "RPE 1–10 — hvor hardt føltes det?", next: p };
      }

      if (low.startsWith("flytt")) {
        return { reply: "Klart. Når passer det bedre?", next: p };
      }

      if (["sliten", "ikke tid", "dårlig dag"].some((s) => low.includes(s))) {
        return {
          reply:
            "Ser ut som en tung dag. Tar vi *8 min minimum* i kveld, eller flytter vi til i morgen?\n(minimum / flytt / pause 3 dager)",
          next: p,
        };
      }

      return { reply: "Si *start* når du er klar, *lett* for minimum, eller *flytt* + ny tid.", next: p };
    }

    default:
      p.step = "q0_goal";
      return { reply: "Hei! Jeg er MAI. Hva trener du mest mot akkurat nå?", next: p };
  }
}
