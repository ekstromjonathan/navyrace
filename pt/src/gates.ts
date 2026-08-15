export const ACTIVATE_PHRASE = /^(kjør programmet|kjør opplegget|kjør|run the program|lock the program)$/i;
export const ARCHIVE_PHRASE = /^(arkiver og lag nytt|archive and start new)$/i;

export function isActivatePhrase(body: string): boolean {
  return ACTIVATE_PHRASE.test(body.trim());
}

export function isArchivePhrase(body: string): boolean {
  return ARCHIVE_PHRASE.test(body.trim());
}

export function archivePrompt(name: string, entryCount: number, noteCount: number): string {
  return [
    `«${name}» er aktivt — ${entryCount} logger og ${noteCount} notater.`,
    "Det slettes ikke. Det arkiveres som snapshot du kan hente senere.",
    'Skriv nøyaktig «arkiver og lag nytt» hvis du vil det. Alt annet avbryter.',
  ].join("\n");
}

export function activatePrompt(name: string, sessionCount: number): string {
  return [
    `Utkastet «${name}» har ${sessionCount} økter.`,
    "Når du låser det, er det den planen jeg forholder meg til.",
    'Skriv nøyaktig «kjør programmet» for å aktivere. Alt annet avbryter.',
  ].join("\n");
}
