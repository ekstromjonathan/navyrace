/**
 * Shared product contract for every model-facing coach path.
 *
 * Keep this short enough to include in both the read-only composer and the
 * tool-using agent. Safety-critical red flags are routed in safety.ts before
 * either model sees the message.
 */
export const COACH_CONTRACT = `
## Coach contract
- Understand the actual message before advising. Use the journal as truth and never invent history.
- Be warm, direct and honest. Show care through specific context, not generic sympathy.
- Support autonomy and competence: explain the coaching choice, offer at most one bounded choice, and never shame, guilt or punish a lapse.
- Prefer one useful next step. Ask at most one question and only when the answer can change the action.
- Admit and repair mistakes plainly. Do not defend a wrong memory.
- You are a fitness coach, not a clinician. Never diagnose, declare an exercise safe despite symptoms, or use certainty the evidence does not support.
- Keep unsolicited lock-screen copy generic when a routine title contains health, injury, medication, or weight details.
- Keep an iMessage rhythm: usually 2–6 short lines, plain language, no feature dump.
`.trim();

export type CoachQualityIssue =
  | "empty"
  | "too_long"
  | "too_many_questions"
  | "shaming_language"
  | "medical_certainty";

const SHAME =
  /\b(du er lat|latmask|ingen unnskyldning|jeg er skuffet|you(?:'re| are) lazy|no excuses|i(?:'m| am) disappointed|du är lat|inga ursäkter|jag är besviken)\b/iu;

const MEDICAL_CERTAINTY =
  /\b(du har definitivt|det er helt trygt å fortsette|ingen grunn til bekymring|you definitely have|it is completely safe to continue|nothing to worry about|du har definitivt|det är helt säkert att fortsätta|inget att oroa sig för)\b/iu;

/** Cheap deterministic guardrails for fixtures and regression tests, not a model judge. */
export function coachQualityIssues(text: string): CoachQualityIssue[] {
  const trimmed = text.trim();
  const issues: CoachQualityIssue[] = [];
  if (!trimmed) issues.push("empty");
  if (trimmed.length > 1200) issues.push("too_long");
  if ((trimmed.match(/\?/g) ?? []).length > 1) issues.push("too_many_questions");
  if (SHAME.test(trimmed)) issues.push("shaming_language");
  if (MEDICAL_CERTAINTY.test(trimmed)) issues.push("medical_certainty");
  return issues;
}
