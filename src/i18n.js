const dictionaries = {
  en: {
    slogan: "A personal trainer in iMessage.",
    tryBrowser: "Try in browser",
    signupCta: "Sign up for iMessage",
    choose: "Choose",
    close: "Close",
    language: "Language",
    signupTitle: "Get your trainer in iMessage",
    signupLead: "You text. Your trainer texts back.",
    name: "Name",
    phone: "Phone",
    send: "Send iMessage",
    back: "← Back",
    consent: "By sending, you agree to be contacted.",
    terms: "Terms",
    missing: "Add your name and number.",
    opening: "Opening Messages…",
    signupPageTitle: "Sign up · lodd.ai",
    termsPageTitle: "Terms · lodd.ai",
    termsTitle: "Terms",
    termsKicker: "lodd.ai · 15 August 2026",
    termsIntro: "You send name and number so we can text you about lodd.ai.",
    termsUseTitle: "What we use",
    termsUse: "Only to reach you. We don’t sell it or use it for ads.",
    termsContactTitle: "Contact",
    termsContact: "We iMessage or SMS you. Reply stop, and we stop.",
    termsDeleteTitle: "Delete",
    termsDelete: "Ask in the thread, and we delete your name and number.",
    smsName: "Name",
    smsPhone: "Phone",
  },
  no: {
    slogan: "En personlig trener i iMessage.",
    tryBrowser: "Prøv i nettleseren",
    signupCta: "Meld deg på i iMessage",
    choose: "Velg",
    close: "Lukk",
    language: "Språk",
    signupTitle: "Få treneren din i iMessage",
    signupLead: "Du skriver. Treneren svarer.",
    name: "Navn",
    phone: "Telefon",
    send: "Send iMessage",
    back: "← Tilbake",
    consent: "Ved å sende inn godtar du å bli kontaktet.",
    terms: "Vilkår",
    missing: "Fyll inn navn og nummer.",
    opening: "Åpner Meldinger…",
    signupPageTitle: "Meld deg på · lodd.ai",
    termsPageTitle: "Vilkår · lodd.ai",
    termsTitle: "Vilkår",
    termsKicker: "lodd.ai · 15. august 2026",
    termsIntro: "Du sender navn og nummer så vi kan skrive til deg om lodd.ai.",
    termsUseTitle: "Hva vi bruker",
    termsUse: "Bare for å ta kontakt. Vi selger det ikke, og bruker det ikke til reklame.",
    termsContactTitle: "Kontakt",
    termsContact: "Vi sender iMessage eller SMS. Svar stopp, så slutter vi.",
    termsDeleteTitle: "Slett",
    termsDelete: "Si ifra i tråden, så sletter vi navn og nummer.",
    smsName: "Navn",
    smsPhone: "Telefon",
  },
};

const KEY = "lodd:lang";

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

function stored() {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "no" || value === "en") return value;
  } catch {
    /* private mode */
  }
  return null;
}

export let lang = stored() || fromCountry();

export function t(key) {
  return dictionaries[lang]?.[key] ?? dictionaries.en[key] ?? key;
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
  for (const btn of document.querySelectorAll("[data-lang]")) {
    btn.setAttribute("aria-current", btn.dataset.lang === lang ? "true" : "false");
  }
}

export function setLang(next) {
  lang = next === "no" ? "no" : "en";
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode */
  }
  applyI18n();
}

document.querySelector(".lang")?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-lang]");
  if (btn) setLang(btn.dataset.lang);
});

applyI18n();
