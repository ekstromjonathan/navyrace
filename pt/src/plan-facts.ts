import type { UserFacts } from "./types.ts";

/** Fields the floor coach needs before drafting a training plan. */
export const PLAN_FACT_KEYS = ["goal", "level", "daysPerWeek", "equipment"] as const;

export function missingForPlan(facts: UserFacts): string[] {
  const missing: string[] = [];
  if (!String(facts.goal ?? "").trim() && !String(facts.identity ?? "").trim()) {
    missing.push("goal");
  }
  if (!String(facts.level ?? "").trim()) missing.push("level");
  if (facts.daysPerWeek == null || Number(facts.daysPerWeek) < 1) missing.push("daysPerWeek");
  const gear = facts.equipment;
  const hasGear = Array.isArray(gear) ? gear.length > 0 : Boolean(String(gear ?? "").trim());
  if (!hasGear) missing.push("equipment");
  return missing;
}

export function readyForPlan(facts: UserFacts): boolean {
  return missingForPlan(facts).length === 0;
}
