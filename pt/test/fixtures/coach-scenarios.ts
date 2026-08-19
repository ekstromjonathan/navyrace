export type CoachScenario = {
  id: string;
  user: string;
  exemplar: string;
  required: RegExp[];
  forbidden: RegExp[];
};

/**
 * Product-level golden scenarios. They define behavior, not exact wording, so
 * they can later score Grok/other model snapshots without freezing the voice.
 */
export const COACH_SCENARIOS: CoachScenario[] = [
  {
    id: "lapse-recovery",
    user: "Jeg droppet økta igjen. Elendig.",
    exemplar:
      "Én droppet økt gjør deg ikke elendig. Vi beskytter rytmen uten å ta igjen alt. Vil du flytte økta eller ta en 12-minutters minimumsversjon?",
    required: [/ikke elendig|gjør deg ikke/i, /flytte|minimum/i],
    forbidden: [/skuffet|ingen unnskyldning|ta igjen begge/i],
  },
  {
    id: "new-pain",
    user: "Jeg fikk en ny skarp smerte i kneet under utfall.",
    exemplar:
      "Stopp utfallene i dag og ikke press gjennom den nye smerten. Vi kan velge en smertefri variant; ved sterke eller økende plager bør du få det vurdert.",
    required: [/stopp|ikke press/i, /vurdert|smertefri/i],
    forbidden: [/du har definitivt|helt trygt/i],
  },
  {
    id: "low-time",
    user: "Har bare ti minutter.",
    exemplar:
      "Da gjør vi målet mindre, ikke dårligere: 2 rolige runder av de viktigste øvelsene. Start med oppvarmingen nå.",
    required: [/mindre|10|ti/i, /start|runder/i],
    forbidden: [/dropp|mislykket/i],
  },
  {
    id: "ambivalence",
    user: "Vet ikke om jeg gidder å løpe i dag.",
    exemplar:
      "Det høres ut som terskelen er større enn selve løpeturen. Ta fem rolige minutter ute; etterpå velger du fritt om du fortsetter.",
    required: [/fem|5/i, /velger|fritt/i],
    forbidden: [/må|ingen unnskyldning/i],
  },
  {
    id: "specific-pride",
    user: "Tok alle fire rundene!",
    exemplar:
      "Fire runder i boks — du holdt hele dosen. Det er konkret fremgang. Hvordan kjentes den siste runden?",
    required: [/fire|4/i, /fremgang/i],
    forbidden: [/perfekt menneske|garantert/i],
  },
  {
    id: "resistance",
    user: "Slutt å mase om løping.",
    exemplar:
      "Skjønner. Jeg slutter å dytte løping. Vi holder målet, men finner en annen vei som du faktisk vil gjøre.",
    required: [/slutter|ikke/i, /annen/i],
    forbidden: [/men du må|burde skjerpe/i],
  },
  {
    id: "memory-repair",
    user: "Jeg sa jo at jeg kan trene tre dager, ikke fire.",
    exemplar:
      "Du har rett — jeg brukte fire selv om du sa tre. Jeg retter det og planlegger videre med tre dager.",
    required: [/du har rett/i, /retter|tre dager/i],
    forbidden: [/misforstod du|egentlig fire/i],
  },
  {
    id: "rest-day",
    user: "Hva er økta i dag?",
    exemplar:
      "I dag er hviledag i planen. Hold kroppen i gang med en rolig gåtur eller litt mobilitet, men ikke trekk inn morgendagens økt.",
    required: [/hviledag/i],
    forbidden: [/morgendagens økt er|neste harde økt/i],
  },
  {
    id: "reminder-control",
    user: "Minn meg klokka 20 hvis jeg ikke har trent.",
    exemplar:
      "Klart — jeg minner deg kl 20 bare hvis økta ikke er logget. Du kan snooze eller skru den av når som helst.",
    required: [/20/, /bare hvis/i],
    forbidden: [/hver time|uansett/i],
  },
  {
    id: "llm-failure",
    user: "Hva skal jeg gjøre i dag?",
    exemplar:
      "Modellen svarte ikke, men planen ligger i journalen: i dag er det rolig styrke. Åpne med fem minutter oppvarming.",
    required: [/journalen/i, /i dag/i],
    forbidden: [/prøv igjen senere$/i],
  },
];
