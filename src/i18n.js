const dictionaries = {
  en: {
    slogan: "Text your new excellent personal trainer.",
    tryBrowser: "Try in browser",
    signupCta: "Sign up for iMessage",
    choose: "Choose",
    close: "Close",
    signupTitle: "Sign up for your personal coach in iMessage",
    signupLead: "You text what you trained. Your trainer texts back — no app.",
    name: "Name",
    phone: "Phone",
    send: "Send iMessage",
    back: "← Back",
    consent: "By submitting, you agree to be contacted for more information.",
    terms: "Terms",
    missing: "Add your name and number.",
    opening: "Opening Messages…",
    signupPageTitle: "Sign up · lodd.ai",
    termsPageTitle: "Terms · lodd.ai",
    termsTitle: "Terms",
    termsKicker: "lodd.ai · updated 15 August 2026",
    termsIntro:
      "When you send your name and phone number, you ask to be contacted about lodd.ai — a personal trainer in iMessage.",
    termsUseTitle: "What we use",
    termsUse:
      "Name and number are used only to reach you and show you the concept. We don’t sell your details, and we don’t use them for ads from others.",
    termsContactTitle: "How we contact you",
    termsContact:
      "You’ll get an iMessage or SMS. Reply any time that you don’t want to hear more, and we’ll stop writing.",
    termsDeleteTitle: "Deleting",
    termsDelete: "Tell us in the same thread, and we’ll delete the name and number we have for you.",
    smsName: "Name",
    smsPhone: "Phone",
  },
  no: {
    slogan: "Send en melding til din nye, dyktige personlige trener.",
    tryBrowser: "Prøv i nettleseren",
    signupCta: "Meld deg på i iMessage",
    choose: "Velg",
    close: "Lukk",
    signupTitle: "Meld deg på din personlige trener i iMessage",
    signupLead: "Du skriver hva du trente. Treneren skriver tilbake — ingen app.",
    name: "Navn",
    phone: "Telefon",
    send: "Send iMessage",
    back: "← Tilbake",
    consent: "Ved å sende inn godtar du å bli kontaktet for mer informasjon.",
    terms: "Vilkår",
    missing: "Fyll inn navn og nummer.",
    opening: "Åpner Meldinger…",
    signupPageTitle: "Meld deg på · lodd.ai",
    termsPageTitle: "Vilkår · lodd.ai",
    termsTitle: "Vilkår",
    termsKicker: "lodd.ai · oppdatert 15. august 2026",
    termsIntro:
      "Når du sender navn og telefonnummer, ber du om å bli kontaktet om lodd.ai — en personlig trener i iMessage.",
    termsUseTitle: "Hva vi bruker",
    termsUse:
      "Navn og nummer brukes bare til å ta kontakt og vise deg konseptet. Vi selger ikke opplysningene, og vi bruker dem ikke til reklame fra andre.",
    termsContactTitle: "Hvordan vi tar kontakt",
    termsContact:
      "Du får en iMessage eller SMS. Du kan når som helst svare at du ikke vil høre mer, så slutter vi å skrive.",
    termsDeleteTitle: "Sletting",
    termsDelete: "Si ifra i samme tråd, så sletter vi navn og nummer vi har lagret om deg.",
    smsName: "Navn",
    smsPhone: "Telefon",
  },
};

function fromCountry() {
  const tags = [...(navigator.languages || []), navigator.language].filter(Boolean);
  for (const tag of tags) {
    try {
      const loc = new Intl.Locale(tag);
      const language = loc.language;
      let region = loc.region;
      if (!region && typeof loc.maximize === "function") {
        region = loc.maximize().region;
      }
      if (language === "nb" || language === "nn" || language === "no" || region === "NO") {
        return "no";
      }
    } catch {
      if (/^(nb|nn|no)([-_]|$)/i.test(tag) || /[-_]NO$/i.test(tag)) return "no";
    }
  }
  try {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Oslo") return "no";
  } catch {
    /* ignore */
  }
  return "en";
}

export const lang = fromCountry();
export const copy = dictionaries[lang] ?? dictionaries.en;

export function t(key) {
  return copy[key] ?? dictionaries.en[key] ?? key;
}

export function applyI18n() {
  document.documentElement.lang = lang === "no" ? "nb" : "en";
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const value = t(el.dataset.i18n);
    if (value) el.textContent = value;
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
}

applyI18n();
