const dictionaries = {
  en: {
    signupTitle: "Your  iMessage coach",
    signupLead: "You text. Your coach texts back.",
    name: "Name",
    phone: "Phone",
    send: "Send  iMessage",
    tryApp: "Try the app instead",
    back: "← Back",
    consent: "By sending, you agree to be contacted.",
    terms: "Terms",
    language: "Language",
    missing: "Add your name and number.",
    opening: "Opening Messages…",
    termsPageTitle: "Terms · lodd.ai",
    termsTitle: "Terms",
    termsKicker: "lodd.ai · 19 August 2026",
    termsIntro: "lodd.ai is an AI fitness coach over iMessage. It supports training and routines, but it is not medical care or an emergency service.",
    termsAiTitle: "AI coach",
    termsAi: "Messages are processed by our messaging, hosting, and selected AI providers to produce replies. The coach can be wrong; important health decisions need a qualified professional.",
    termsDataTitle: "Data",
    termsData: "We process the name, number, messages, goals, workouts, reminders, and health or injury details you choose to share so the coach can remember and adapt.",
    termsUseTitle: "What we use",
    termsUse: "We use the data to operate, personalize, and secure the coach. We don’t sell it or use it for advertising.",
    termsSafetyTitle: "Safety",
    termsSafety: "Don’t use lodd.ai for emergencies. Stop exercise and call local emergency services (113 in Norway) for chest pain, fainting, severe breathlessness, or immediate danger.",
    termsContactTitle: "Contact",
    termsContact: "We text you on  iMessage or SMS. Reply stop, and we stop.",
    termsDeleteTitle: "Delete",
    termsDelete: "Ask in the same thread to see, correct, export, or delete your data. A short working chat history is limited; coaching facts and logs remain until deletion is requested.",
    smsBody: "Hi, my name is {name}. I also want to become the best version of myself. Can I join?",
  },
  sv: {
    signupTitle: "Din  iMessage-coach",
    signupLead: "Du skriver. Coachen svarar.",
    name: "Namn",
    phone: "Telefon",
    send: "Skicka  iMessage",
    tryApp: "Prova appen istället",
    back: "← Tillbaka",
    consent: "Genom att skicka godkänner du att bli kontaktad.",
    terms: "Villkor",
    language: "Språk",
    missing: "Fyll i namn och nummer.",
    opening: "Öppnar Meddelanden…",
    termsPageTitle: "Villkor · lodd.ai",
    termsTitle: "Villkor",
    termsKicker: "lodd.ai · 19 augusti 2026",
    termsIntro: "lodd.ai är en AI-träningscoach i iMessage. Den stödjer träning och rutiner, men är inte sjukvård eller en räddningstjänst.",
    termsAiTitle: "AI-coach",
    termsAi: "Meddelanden behandlas av våra leverantörer för meddelanden, drift och utvald AI för att skapa svar. Coachen kan ha fel; viktiga hälsobeslut kräver kvalificerad vårdpersonal.",
    termsDataTitle: "Data",
    termsData: "Vi behandlar namn, nummer, meddelanden, mål, pass, påminnelser och hälso- eller skadeuppgifter du väljer att dela så att coachen kan minnas och anpassa.",
    termsUseTitle: "Vad vi använder",
    termsUse: "Vi använder data för att driva, anpassa och säkra coachen. Vi säljer den inte och använder den inte för reklam.",
    termsSafetyTitle: "Säkerhet",
    termsSafety: "Använd inte lodd.ai i en nödsituation. Avbryt träning och ring 112 vid bröstsmärta, svimning, svår andnöd eller omedelbar fara.",
    termsContactTitle: "Kontakt",
    termsContact: "Vi skriver på  iMessage eller SMS. Svara stopp, så slutar vi.",
    termsDeleteTitle: "Radera",
    termsDelete: "Be i samma tråd om att se, rätta, exportera eller radera dina data. Den korta chatthistoriken är begränsad; coachfakta och loggar sparas tills du begär radering.",
    smsBody: "Hej, jag heter {name}. Jag vill också bli den bästa versionen av mig själv. Kan jag få vara med?",
  },
  no: {
    signupTitle: "Din  iMessage coach",
    signupLead: "Du skriver. Coachen svarer.",
    name: "Navn",
    phone: "Telefon",
    send: "Send  iMessage",
    tryApp: "Prøv appen isteden",
    back: "← Tilbake",
    consent: "Ved å sende inn godtar du å bli kontaktet.",
    terms: "Vilkår",
    language: "Språk",
    missing: "Fyll inn navn og nummer.",
    opening: "Åpner Meldinger…",
    termsPageTitle: "Vilkår · lodd.ai",
    termsTitle: "Vilkår",
    termsKicker: "lodd.ai · 19. august 2026",
    termsIntro: "lodd.ai er en AI-treningscoach på iMessage. Den støtter trening og rutiner, men er ikke helsehjelp eller en nødtjeneste.",
    termsAiTitle: "AI-coach",
    termsAi: "Meldinger behandles av leverandørene våre for meldingstjeneste, drift og utvalgt AI for å lage svar. Coachen kan ta feil; viktige helsevalg krever kvalifisert helsepersonell.",
    termsDataTitle: "Data",
    termsData: "Vi behandler navn, nummer, meldinger, mål, økter, påminnelser og helse- eller skadeopplysninger du velger å dele, slik at coachen kan huske og tilpasse.",
    termsUseTitle: "Hva vi bruker",
    termsUse: "Vi bruker data til å drive, tilpasse og sikre coachen. Vi selger dem ikke og bruker dem ikke til reklame.",
    termsSafetyTitle: "Sikkerhet",
    termsSafety: "Ikke bruk lodd.ai i en nødsituasjon. Stopp trening og ring 113 ved brystsmerter, besvimelse, alvorlig tungpust eller umiddelbar fare.",
    termsContactTitle: "Kontakt",
    termsContact: "Vi skriver på  iMessage eller SMS. Svar stopp, så slutter vi.",
    termsDeleteTitle: "Slett",
    termsDelete: "Be i samme tråd om å se, rette, eksportere eller slette dataene dine. Den korte chathistorikken er begrenset; coachfakta og logger beholdes til du ber om sletting.",
    smsBody: "Hei, jeg heter {name}. Jeg vil også bli den beste versjonen av meg selv. Kan jeg få bli med?",
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
      if (language === "sv" || region === "SE") return "sv";
      if (language === "nb" || language === "nn" || language === "no" || region === "NO") {
        return "no";
      }
    } catch {
      if (/^(sv)([-_]|$)/i.test(tag) || /[-_]SE$/i.test(tag)) return "sv";
      if (/^(nb|nn|no)([-_]|$)/i.test(tag) || /[-_]NO$/i.test(tag)) return "no";
    }
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Europe/Stockholm") return "sv";
    if (tz === "Europe/Oslo") return "no";
  } catch {
    /* ignore */
  }
  return "en";
}

function stored() {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "no" || value === "en" || value === "sv") return value;
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
  document.documentElement.lang = lang === "no" ? "nb" : lang;
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
  lang = next === "no" || next === "sv" ? next : "en";
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode */
  }
  applyI18n();
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-lang]");
  if (btn) setLang(btn.dataset.lang);
});

applyI18n();
