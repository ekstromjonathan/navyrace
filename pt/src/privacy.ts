export type PrivacyRequestKind = "access" | "correction" | "export" | "deletion";

/**
 * Narrow, explicit data-rights requests. Ordinary memory questions and single
 * log corrections stay in the normal coaching flow.
 */
export function detectPrivacyRequest(body: string): PrivacyRequestKind | null {
  const text = body.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text) return null;
  if (
    /\b(slett|fjern|delete|erase|radera|ta bort)\b.*\b(alle|all|mina|mine)\b.*\b(data\p{L}*|opplysning\p{L}*|personopplysning\p{L}*|information\p{L}*)\b/iu.test(
      text,
    ) ||
    /\b(delete|erase) all (?:of )?my data\b/iu.test(text)
  ) {
    return "deletion";
  }
  if (
    /\b(eksporter|last ned|export|download|exportera|ladda ner)\b.*\b(data\p{L}*|opplysning\p{L}*|information\p{L}*)\b/iu.test(
      text,
    )
  ) {
    return "export";
  }
  if (
    /\b(rett|korriger|correct|rectify|rätta|korrigera)\b.*\b(personopplysning\p{L}*|personal data|personuppgift\p{L}*)\b/iu.test(
      text,
    )
  ) {
    return "correction";
  }
  if (
    /\b(innsyn|registerutdrag|data access|access request|access to (?:all )?my (?:personal )?data)\b/iu.test(text) ||
    /\b(se|vis|show)\b.*\b(alle|all|mina|mine)\b.*\b(data\p{L}*|personopplysning\p{L}*|personal data|personuppgift\p{L}*)\b/iu.test(
      text,
    )
  ) {
    return "access";
  }
  return null;
}
